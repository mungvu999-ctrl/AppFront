import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { resetAuthState, setAuthenticatedSession } from '@/lib/auth/state';

import { isServerModel, modelSrcOf } from '../furnitureCatalog';
import {
  abandonAssetRefresh,
  assetRefreshStatus,
  ensureSceneLibrary,
  ensureSceneLibraryFor,
  libraryLoadStatus,
  refreshAssetUrl,
  resetSceneLibraryForTests,
  SAVED_MODEL_CONCURRENCY,
  SAVED_MODEL_MISSING_NOTICE,
  SAVED_MODEL_RETRY_MS,
  SIGNED_URL_MAX_AGE_MS,
} from '../sceneLibrary';
import { LIBRARY_MAX_PAGES, LIBRARY_PAGE_LIMIT, LIBRARY_READ_ATTEMPTS } from '../serverLibrary';

/**
 * Vòng 14 — tải thư viện theo trang (`limit=500`, `X-Next-Cursor`, `X-Library-Revision`) + mẫu đã lưu theo id (#15).
 * Máy chủ giả giữ tập mục có thứ tự + revision; `onPage(n)` chạy TRƯỚC khi trả trang n (đổi tập giữa hai trang).
 */
const { listPage, read, list } = vi.hoisted(() => ({ listPage: vi.fn(), read: vi.fn(), list: vi.fn() }));
vi.mock('@/routes/sessionSetup', () => ({ startAppSession: async () => true }));
vi.mock('@/api/appClient', () => ({ createAppApiClient: () => ({ library: { list, listPage, read }, designConcept: { read: vi.fn() } }) }));

const signIn = (id: string): void =>
  setAuthenticatedSession({ accessToken: `t-${id}`, expiresAt: Date.now() + 3_600_000, roles: [], user: { id } } as never);
const item = (id: string, sig: number) => ({ id, widthMm: 900, heightMm: 800, depthMm: 500, modelUrl: `https://minio.test/${id}.glb?sig=${sig}` });
const ids = (n: number, prefix = 'srv'): string[] => Array.from({ length: n }, (_, k) => `${prefix}-${String(k).padStart(5, '0')}`);
const noWait = async (): Promise<void> => undefined;

interface FakeServer {
  ids: string[];
  revision: number;
  sig: number;
  /** Chạy trước khi trả trang thứ `n` (1 = trang đầu) của mỗi lượt. */
  onPage?: ((n: number) => void) | undefined;
  /** `false` = BE cũ: không header nào. */
  headers: boolean;
  failPage?: number;
}
let server: FakeServer;

const serve = async ({ cursor, limit = 500 }: { cursor?: string; limit?: number } = {}) => {
  const start = cursor === undefined ? 0 : Number(cursor);
  server.onPage?.(Math.floor(start / limit) + 1);
  if (server.failPage === Math.floor(start / limit) + 1) return { ok: false, error: { kind: 'http', status: 503, requestId: 'r', retryable: true, raw: null } };
  const slice = server.headers ? server.ids.slice(start, start + limit) : server.ids.slice(0, 500);
  const next = server.headers && start + limit < server.ids.length ? String(start + limit) : undefined;
  return {
    ok: true,
    data: {
      items: slice.map((id) => item(id, server.sig)),
      ...(next === undefined ? {} : { nextCursor: next }),
      ...(server.headers ? { revision: `rev-${server.revision}` } : {}),
      bytes: slice.length * 100,
    },
  };
};

beforeEach(() => {
  resetSceneLibraryForTests();
  server = { ids: ids(2100), revision: 1, sig: 1, headers: true };
  listPage.mockReset();
  listPage.mockImplementation(serve);
  read.mockReset();
  read.mockImplementation(async ({ libraryItemId }: { libraryItemId: string }) =>
    libraryItemId.startsWith('gone-')
      ? { ok: false, error: { kind: 'notFound' } }
      : libraryItemId.startsWith('locked-')
        ? { ok: false, error: { kind: 'forbidden' } }
        : { ok: true, data: item(libraryItemId, server.sig) },
  );
  list.mockReset();
  signIn('u1');
});
afterEach(() => {
  resetAuthState();
  vi.useRealTimers();
});

describe('ensureSceneLibrary — đọc theo trang', () => {
  it('> 2000 mục qua 5 trang: limit=500, theo X-Next-Cursor tới hết, đủ mục trong danh mục; đầu dò đếm đúng', async () => {
    const lib = await ensureSceneLibrary();
    expect(lib).toMatchObject({ source: 'server', count: 2100 });
    expect(listPage).toHaveBeenCalledTimes(5);
    expect(listPage.mock.calls.map(([input]) => (input as { cursor?: string }).cursor)).toEqual([undefined, '500', '1000', '1500', '2000']);
    expect(listPage.mock.calls.every(([input]) => (input as { limit: number }).limit === LIBRARY_PAGE_LIMIT)).toBe(true);
    expect(isServerModel('srv-00000') && isServerModel('srv-02099')).toBe(true);
    expect(libraryLoadStatus()).toMatchObject({ pages: 5, items: 2100, revision: 'rev-1', restarts: 0, bytes: 210_000, resolvedById: [], missingById: [] });
    expect(list).not.toHaveBeenCalled();
  });

  it('mục THÊM giữa hai trang (revision đổi) → đọc lại từ trang đầu, danh mục cuối nhất quán', async () => {
    server.onPage = (n) => {
      if (n === 3 && server.revision === 1) {
        server.ids.splice(10, 0, 'srv-added');
        server.revision = 2;
      }
    };
    const lib = await ensureSceneLibrary();
    expect(lib).toMatchObject({ source: 'server', count: 2101 });
    expect(isServerModel('srv-added') && isServerModel('srv-02099')).toBe(true);
    // Lượt 1 dừng ở trang 3 (revision khác), lượt 2 đọc đủ 5 trang.
    expect(listPage).toHaveBeenCalledTimes(3 + 5);
    expect(libraryLoadStatus()).toMatchObject({ pages: 5, items: 2101, revision: 'rev-2', restarts: 1 });
  });

  it('mục BỊ GỠ giữa hai trang → đọc lại, mục gỡ không còn, không sót mục bị dồn trang', async () => {
    server.onPage = (n) => {
      if (n === 2 && server.revision === 1) {
        server.ids.splice(0, 1);
        server.revision = 2;
      }
    };
    const lib = await ensureSceneLibrary();
    expect(lib.count).toBe(2099);
    expect(isServerModel('srv-00000')).toBe(false);
    // Mục 500 bị dồn về trang 1 khi gỡ mục 0: lượt đọc lại thấy nó.
    expect(isServerModel('srv-00500')).toBe(true);
    expect(libraryLoadStatus()).toMatchObject({ restarts: 1, items: 2099 });
  });

  it(`revision đổi mãi → sau ${LIBRARY_READ_ATTEMPTS} lượt là lỗi đọc (fallback:revision + câu báo), không ghi gì`, async () => {
    server.onPage = (n) => {
      if (n === 2) server.revision += 1;
    };
    const lib = await ensureSceneLibrary();
    expect(lib.source).toBe('fallback:revision');
    expect(lib.notice).not.toBeNull();
    expect(listPage).toHaveBeenCalledTimes(LIBRARY_READ_ATTEMPTS * 2);
    expect(isServerModel('srv-00000')).toBe(false);
  });

  it('lỗi ở trang 3 lượt đầu → không ghi nửa chừng (mục trang 1 không vào), báo lỗi đọc', async () => {
    server.failPage = 3;
    const lib = await ensureSceneLibrary();
    expect(lib.source).toBe('fallback:http');
    expect(lib.notice).not.toBeNull();
    expect(isServerModel('srv-00000')).toBe(false);
    expect(libraryLoadStatus().pages).toBe(0);
  });

  it('lỗi ở trang 3 khi đọc lại vì quá tuổi → GIỮ thư viện cũ nguyên vẹn, không trộn trang mới', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(0);
    const first = await ensureSceneLibrary();
    const oldUrl = modelSrcOf('srv-00000');
    vi.setSystemTime(SIGNED_URL_MAX_AGE_MS + 1);
    server.sig = 2;
    server.ids.unshift('srv-new');
    server.revision = 2;
    server.failPage = 3;
    expect(await ensureSceneLibrary()).toBe(first);
    expect(modelSrcOf('srv-00000')).toBe(oldUrl);
    expect(isServerModel('srv-new')).toBe(false);
    expect(isServerModel('srv-02099')).toBe(true);
  });

  it('đổi người giữa lúc đọc trang → kết quả bị bỏ (không ghi danh mục người trước); lượt sau đọc cho người mới', async () => {
    server.onPage = (n) => {
      if (n === 3) {
        server.onPage = undefined;
        signIn('u2');
      }
    };
    const lib = await ensureSceneLibrary();
    expect(lib.source).toBe('fallback:stale');
    expect(isServerModel('srv-00000')).toBe(false);
    const again = await ensureSceneLibrary();
    expect(again).toMatchObject({ source: 'server', count: 2100 });
  });

  it('BE cũ (không header) → một phản hồi là cả danh sách', async () => {
    server.headers = false;
    const lib = await ensureSceneLibrary();
    expect(lib).toMatchObject({ source: 'server', count: 500 });
    expect(listPage).toHaveBeenCalledTimes(1);
    expect(libraryLoadStatus()).toMatchObject({ pages: 1, items: 500, revision: null, restarts: 0 });
  });

  it('con trỏ lặp mãi → dừng ở trần trang (fallback:pages), không treo', async () => {
    listPage.mockImplementation(async () => ({ ok: true, data: { items: [item('loop', 1)], nextCursor: 'same', revision: 'r', bytes: 1 } }));
    const lib = await ensureSceneLibrary();
    expect(lib.source).toBe('fallback:pages');
    expect(listPage).toHaveBeenCalledTimes(LIBRARY_MAX_PAGES);
  });
});

describe('URL ký hết hạn — đường gia hạn với thư viện nhiều trang', () => {
  it('mẫu ở trang 5: gia hạn đọc lại ĐỦ trang, trả URL mới, mẫu khác không rơi', async () => {
    await ensureSceneLibrary();
    const old = modelSrcOf('srv-02099');
    server.sig = 2;
    listPage.mockClear();
    const fresh = await refreshAssetUrl(old, 403, undefined, noWait);
    expect(fresh).toBe(modelSrcOf('srv-02099'));
    expect(fresh).toContain('sig=2');
    expect(listPage).toHaveBeenCalledTimes(5);
    expect(isServerModel('srv-00000')).toBe(true);
  });

  it('mẫu resolve theo id: gia hạn bằng #15 (không đọc lại cả thư viện), giữ qua lượt thay danh sách', async () => {
    await ensureSceneLibraryFor([{ model: { src: '/items/shared-x/model.glb' } }]);
    const old = modelSrcOf('shared-x');
    expect(old).toContain('sig=1');
    server.sig = 2;
    listPage.mockClear();
    const fresh = await refreshAssetUrl(old, 403, undefined, noWait);
    expect(fresh).toContain('sig=2');
    expect(listPage).not.toHaveBeenCalled();
    expect(read).toHaveBeenLastCalledWith(expect.objectContaining({ libraryItemId: 'shared-x' }));
    // Một mẫu danh sách gia hạn → THAY danh sách: mẫu theo id vẫn còn.
    await refreshAssetUrl(modelSrcOf('srv-00001'), 403, undefined, noWait);
    expect(isServerModel('shared-x')).toBe(true);
    expect(libraryLoadStatus().resolvedById).toEqual(['shared-x']);
  });

  it('Codex #9: mẫu theo id bị gỡ quyền khi gia hạn → gỡ khỏi danh mục nhất quán, ghi kết cục, lượt dựng sau không hỏi lại', async () => {
    await ensureSceneLibraryFor([{ model: { src: '/items/shared-y/model.glb' } }]);
    read.mockResolvedValue({ ok: false, error: { kind: 'forbidden' } });
    expect(await refreshAssetUrl(modelSrcOf('shared-y'), 403, undefined, noWait)).toBeNull();
    expect(assetRefreshStatus().failures).toEqual([{ modelId: 'shared-y', reason: 'forbidden' }]);
    expect(isServerModel('shared-y')).toBe(false);
    expect(modelSrcOf('shared-y')).toBe('/items/shared-y/model.glb');
    expect(isServerModel('srv-02099')).toBe(true);
    expect(libraryLoadStatus()).toMatchObject({ resolvedById: [], missingById: [{ modelId: 'shared-y', reason: 'forbidden' }] });
    read.mockClear();
    await ensureSceneLibraryFor([{ model: { src: '/items/shared-y/model.glb' } }]);
    expect(read).not.toHaveBeenCalled();
  });

  it('Codex #3: kết quả gia hạn theo id về muộn không ghi đè mục mà danh sách vừa nhận (danh sách thắng)', async () => {
    await ensureSceneLibraryFor([{ model: { src: '/items/shared-w/model.glb' } }]);
    let release: () => void = () => undefined;
    read.mockImplementationOnce(async ({ libraryItemId }: { libraryItemId: string }) => {
      await new Promise<void>((r) => (release = r));
      return { ok: true, data: item(libraryItemId, 7) };
    });
    const pending = refreshAssetUrl(modelSrcOf('shared-w'), 403, undefined, noWait);
    await vi.waitFor(() => expect(read).toHaveBeenCalledTimes(2));
    // Danh sách nhận mục này (sig=3) trước khi lượt theo id về.
    server.ids.push('shared-w');
    server.revision = 2;
    server.sig = 3;
    await refreshAssetUrl(modelSrcOf('srv-00001'), 403, undefined, noWait);
    expect(modelSrcOf('shared-w')).toContain('sig=3');
    release();
    expect(await pending).toContain('sig=3');
    expect(modelSrcOf('shared-w')).toContain('sig=3');
    expect(libraryLoadStatus().resolvedById).toEqual([]);
  });
});

describe('ensureSceneLibraryFor — mẫu đã lưu ngoài danh sách', () => {
  const saved = (...folders: string[]) => folders.map((f) => ({ model: { src: `/items/${f}/model.glb` } }));

  it('mẫu không có trong danh sách → đọc #15, gộp vào danh mục, URL ký thay đường tĩnh /items/…', async () => {
    const lib = await ensureSceneLibraryFor([...saved('shared-a', 'srv-00042', 'sofa'), {}]);
    expect(lib.source).toBe('server');
    // Chỉ mẫu thiếu: mẫu trong danh sách (srv-00042) và mẫu đóng gói (sofa) không đọc.
    expect(read).toHaveBeenCalledTimes(1);
    expect(isServerModel('shared-a')).toBe(true);
    expect(modelSrcOf('shared-a')).toBe('https://minio.test/shared-a.glb?sig=1');
    expect(isServerModel('srv-02099')).toBe(true);
    expect(libraryLoadStatus()).toMatchObject({ items: 2100, resolvedById: ['shared-a'], missingById: [] });
  });

  it('404/403 → kết cục rõ: giữ đường lưu, câu báo chung, đầu dò missingById; không hỏi lại', async () => {
    await ensureSceneLibraryFor(saved('gone-a', 'locked-b'));
    expect(modelSrcOf('gone-a')).toBe('/items/gone-a/model.glb');
    expect(isServerModel('locked-b')).toBe(false);
    expect(libraryLoadStatus().missingById).toEqual([
      { modelId: 'gone-a', reason: 'not-found' },
      { modelId: 'locked-b', reason: 'forbidden' },
    ]);
    expect(assetRefreshStatus().notice).toBe(SAVED_MODEL_MISSING_NOTICE);
    read.mockClear();
    await ensureSceneLibraryFor(saved('gone-a', 'locked-b'));
    expect(read).not.toHaveBeenCalled();
  });

  it('Codex #7: 5xx/mạng khi đọc theo id → câu báo một mục, hỏi lại sau giãn cách (không mỗi lượt dựng), gỡ báo khi resolve', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(0);
    read.mockResolvedValueOnce({ ok: false, error: { kind: 'http', status: 503, requestId: 'r', retryable: true, raw: null } });
    read.mockRejectedValueOnce(new Error('offline'));
    await ensureSceneLibraryFor(saved('shared-flaky'));
    expect(libraryLoadStatus().missingById).toEqual([{ modelId: 'shared-flaky', reason: 'read-failed' }]);
    expect(assetRefreshStatus().notice).toBe(SAVED_MODEL_MISSING_NOTICE);
    // Trong giãn cách: lượt dựng sau KHÔNG hỏi lại.
    await ensureSceneLibraryFor(saved('shared-flaky'));
    expect(read).toHaveBeenCalledTimes(1);
    vi.setSystemTime(SAVED_MODEL_RETRY_MS + 1);
    await ensureSceneLibraryFor(saved('shared-flaky'));
    expect(read).toHaveBeenCalledTimes(2);
    expect(isServerModel('shared-flaky')).toBe(false);
    // Hỏng hai lần vẫn chỉ một mục báo.
    expect(assetRefreshStatus().failures).toEqual([{ modelId: 'shared-flaky', reason: 'read-failed' }]);
    vi.setSystemTime(2 * SAVED_MODEL_RETRY_MS + 2);
    await ensureSceneLibraryFor(saved('shared-flaky'));
    expect(read).toHaveBeenCalledTimes(3);
    expect(isServerModel('shared-flaky')).toBe(true);
    expect(libraryLoadStatus()).toMatchObject({ resolvedById: ['shared-flaky'], missingById: [] });
    expect(assetRefreshStatus()).toMatchObject({ failures: [], notice: null });
  });

  it('Codex #6: giới hạn đọc theo id là CHUNG cả module — hai lượt chồng nhau với id khác nhau vẫn tối đa 4', async () => {
    let live = 0;
    let peak = 0;
    read.mockImplementation(async ({ libraryItemId }: { libraryItemId: string }) => {
      live += 1;
      peak = Math.max(peak, live);
      await new Promise((r) => setTimeout(r, 1));
      live -= 1;
      return { ok: true, data: item(libraryItemId, 1) };
    });
    // Client trực tiếp: hai `import()` động cùng lúc của module bị vi.mock có lúc nhận module thật (chỉ trong test).
    const getApi = async () => ({ list, listPage, read });
    await ensureSceneLibrary(getApi);
    await Promise.all([ensureSceneLibraryFor(saved(...ids(6, 'left')), getApi), ensureSceneLibraryFor(saved(...ids(6, 'right')), getApi)]);
    expect(read).toHaveBeenCalledTimes(12);
    expect(peak).toBe(SAVED_MODEL_CONCURRENCY);
  });

  it('Codex #4: rời cảnh khi lượt theo id đang chạy → người gọi mới không bám lượt đã bị bỏ, tự đọc và resolve được', async () => {
    await ensureSceneLibrary();
    let release: () => void = () => undefined;
    read.mockImplementationOnce(async ({ libraryItemId }: { libraryItemId: string }) => {
      await new Promise<void>((r) => (release = r));
      return { ok: true, data: item(libraryItemId, 1) };
    });
    const first = ensureSceneLibraryFor(saved('shared-p'));
    await vi.waitFor(() => expect(read).toHaveBeenCalledTimes(1));
    abandonAssetRefresh();
    await ensureSceneLibraryFor(saved('shared-p'));
    expect(read).toHaveBeenCalledTimes(2);
    expect(isServerModel('shared-p')).toBe(true);
    release();
    await first;
    expect(assetRefreshStatus().dropped).toBe(1);
    expect(isServerModel('shared-p')).toBe(true);
  });

  it('Codex-2 #1: đổi chủ lúc vào → lượt ĐẦU của người mới vẫn resolve theo id (không bị bỏ vì thế hệ tăng)', async () => {
    await ensureSceneLibrary();
    signIn('u2');
    await ensureSceneLibraryFor(saved('shared-r'));
    expect(read).toHaveBeenCalledTimes(1);
    expect(isServerModel('shared-r')).toBe(true);
  });

  it('Codex-2 #3: rời cảnh khi hàng chờ đầy → lượt đã bỏ không gửi request, cảnh mới được chỗ', async () => {
    const releases: (() => void)[] = [];
    read.mockImplementation(async ({ libraryItemId }: { libraryItemId: string }) => {
      await new Promise<void>((r) => releases.push(r));
      return { ok: true, data: item(libraryItemId, 1) };
    });
    const getApi = async () => ({ list, listPage, read });
    await ensureSceneLibrary(getApi);
    const old = ensureSceneLibraryFor(saved(...ids(6, 'old')), getApi);
    await vi.waitFor(() => expect(read).toHaveBeenCalledTimes(4));
    abandonAssetRefresh();
    const fresh = ensureSceneLibraryFor(saved('fresh-1'), getApi);
    releases.splice(0).forEach((r) => r());
    await old;
    await vi.waitFor(() => expect(read).toHaveBeenCalledTimes(5));
    releases.splice(0).forEach((r) => r());
    await fresh;
    expect(read.mock.calls.map(([input]) => (input as { libraryItemId: string }).libraryItemId)).not.toContain('old-00004');
    expect(isServerModel('fresh-1')).toBe(true);
    expect(isServerModel('old-00000')).toBe(false);
  });

  it('Codex-2 #4: mẫu theo id vào rồi rời danh sách → vẫn còn (giá trị theo id), gia hạn đi đường #15', async () => {
    await ensureSceneLibraryFor(saved('shared-a'));
    server.ids.push('shared-a');
    server.revision = 2;
    server.sig = 3;
    await refreshAssetUrl(modelSrcOf('srv-00001'), 403, undefined, noWait);
    expect(modelSrcOf('shared-a')).toContain('sig=3');
    server.ids.pop();
    server.revision = 3;
    server.sig = 4;
    await refreshAssetUrl(modelSrcOf('srv-00002'), 403, undefined, noWait);
    expect(isServerModel('shared-a')).toBe(true);
    expect(modelSrcOf('shared-a')).toContain('sig=1');
    expect(libraryLoadStatus().resolvedById).toEqual(['shared-a']);
    listPage.mockClear();
    read.mockClear();
    const fresh = await refreshAssetUrl(modelSrcOf('shared-a'), 403, undefined, noWait);
    expect(fresh).toContain('sig=4');
    expect(read).toHaveBeenCalledTimes(1);
    expect(listPage).not.toHaveBeenCalled();
  });

  it('Codex-2 #5: danh sách cài được mục từng hỏng theo id → xoá kết cục thiếu + câu báo', async () => {
    await ensureSceneLibraryFor(saved('locked-c'));
    expect(assetRefreshStatus().notice).toBe(SAVED_MODEL_MISSING_NOTICE);
    server.ids.push('locked-c');
    server.revision = 2;
    server.sig = 2;
    await refreshAssetUrl(modelSrcOf('srv-00001'), 403, undefined, noWait);
    expect(isServerModel('locked-c')).toBe(true);
    expect(libraryLoadStatus().missingById).toEqual([]);
    expect(assetRefreshStatus()).toMatchObject({ failures: [], notice: null });
  });

  it('Codex #5: rời cảnh trong lúc chờ thư viện → lượt cũ không hỏi theo id (thế hệ chụp lúc vào)', async () => {
    let release: () => void = () => undefined;
    const gate = new Promise<void>((r) => (release = r));
    listPage.mockImplementation(async (input: { cursor?: string; limit?: number }) => {
      await gate;
      return serve(input);
    });
    const pending = ensureSceneLibraryFor(saved('shared-q'));
    await vi.waitFor(() => expect(listPage).toHaveBeenCalled());
    abandonAssetRefresh();
    release();
    await pending;
    expect(read).not.toHaveBeenCalled();
    expect(isServerModel('shared-q')).toBe(false);
  });

  it(`đọc theo id có giới hạn: tối đa ${SAVED_MODEL_CONCURRENCY} lượt cùng lúc`, async () => {
    let live = 0;
    let peak = 0;
    read.mockImplementation(async ({ libraryItemId }: { libraryItemId: string }) => {
      live += 1;
      peak = Math.max(peak, live);
      await new Promise((r) => setTimeout(r, 1));
      live -= 1;
      return { ok: true, data: item(libraryItemId, 1) };
    });
    await ensureSceneLibraryFor(saved(...ids(12, 'shared')));
    expect(read).toHaveBeenCalledTimes(12);
    expect(peak).toBe(SAVED_MODEL_CONCURRENCY);
    expect(libraryLoadStatus().resolvedById).toHaveLength(12);
  });

  it('đổi người giữa lúc đọc theo id → kết quả bị bỏ, không vào danh mục người sau', async () => {
    await ensureSceneLibrary();
    read.mockImplementation(async ({ libraryItemId }: { libraryItemId: string }) => {
      signIn('u2');
      return { ok: true, data: item(libraryItemId, 1) };
    });
    await ensureSceneLibraryFor(saved('shared-z'));
    expect(isServerModel('shared-z')).toBe(false);
    expect(libraryLoadStatus().resolvedById).toEqual([]);
    expect(assetRefreshStatus().dropped).toBe(1);
  });
});
