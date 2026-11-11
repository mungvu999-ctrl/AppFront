import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { getSessionSnapshot, resetAuthState, setAuthenticatedSession } from '@/lib/auth/state';

import { isServerModel, modelSrcOf } from '../furnitureCatalog';
import {
  ASSET_EXPIRED_NOTICE,
  assetRefreshStatus,
  assetLoadedOk,
  ensureSceneLibrary,
  installAssetRefresh,
  refreshAssetUrl,
  resetSceneLibraryForTests,
  SIGNED_URL_MAX_AGE_MS,
  subscribeAssetRefresh,
  uninstallAssetRefreshForTests,
} from '../sceneLibrary';

/** URL ký MinIO hết hạn (~2 giờ): gia hạn theo quyền HIỆN TẠI, có giới hạn, bỏ request của phiên/người cũ. */
const { list } = vi.hoisted(() => ({ list: vi.fn() }));
vi.mock('@/routes/sessionSetup', () => ({ startAppSession: async () => true }));
vi.mock('@/api/appClient', () => ({ createAppApiClient: () => ({ library: { list }, designConcept: { read: vi.fn() } }) }));

const signIn = (id: string): void =>
  setAuthenticatedSession({ accessToken: `t-${id}`, expiresAt: Date.now() + 3_600_000, roles: [], user: { id } } as never);
const item = (id: string, sig: number) => ({ id, widthMm: 900, heightMm: 800, depthMm: 500, modelUrl: `https://minio.test/${id}.glb?sig=${sig}` });
const noWait = async (): Promise<void> => undefined;

let sig = 1;
beforeEach(() => {
  resetSceneLibraryForTests();
  sig = 1;
  list.mockReset();
  // Mỗi lượt đọc máy chủ ký lại URL (chữ ký mới), mẫu riêng theo người đang đăng nhập.
  list.mockImplementation(async () => ({ ok: true, data: [item('lib-a', sig++), item(`mine-${getSessionSnapshot().user?.id ?? 'x'}`, sig)] }));
  signIn('u1');
});
afterEach(() => {
  resetAuthState();
  vi.useRealTimers();
});

describe('refreshAssetUrl — URL ký hết hạn', () => {
  it('403 của mẫu thư viện → đọc lại thư viện, trả URL ký mới; trạng thái đếm 1 lần gia hạn', async () => {
    await ensureSceneLibrary();
    const old = modelSrcOf('lib-a');
    const fresh = await refreshAssetUrl(old, 403, undefined, noWait);
    expect(fresh).not.toBeNull();
    expect(fresh).not.toBe(old);
    expect(fresh).toBe(modelSrcOf('lib-a'));
    expect(list).toHaveBeenCalledTimes(2);
    expect(assetRefreshStatus()).toEqual({ refreshed: 1, retriedSame: 0, dropped: 0, failures: [], notice: null });
  });

  it('máy chủ trả URL y hệt (ký theo mốc giờ): thử lại ĐÚNG MỘT lần URL cũ; 403 mãi → dừng ở trần, báo', async () => {
    await ensureSceneLibrary();
    const url = modelSrcOf('lib-a');
    list.mockImplementation(async () => ({ ok: true, data: [{ ...item('lib-a', 0), modelUrl: url }] }));
    const sleep = vi.fn<(ms: number) => Promise<void>>(noWait);
    expect(await refreshAssetUrl(url, 403, undefined, sleep)).toBe(url);
    expect(assetRefreshStatus()).toMatchObject({ refreshed: 0, retriedSame: 1, failures: [], notice: null });
    // URL cũ vẫn 403 → lượt 2 (trong trần) đọc lại, vẫn y hệt → dừng, không thử nữa.
    expect(await refreshAssetUrl(url, 403, undefined, sleep)).toBeNull();
    expect(await refreshAssetUrl(url, 403, undefined, sleep)).toBeNull();
    expect(sleep.mock.calls.map(([ms]) => ms)).toEqual([400, 2_000]);
    expect(assetRefreshStatus()).toMatchObject({
      retriedSame: 1,
      failures: [{ modelId: 'lib-a', reason: 'unchanged' }, { modelId: 'lib-a', reason: 'exhausted' }],
      notice: ASSET_EXPIRED_NOTICE,
    });
  });

  it('nhiều mẫu hết hạn cùng lúc → MỘT lượt đọc lại dùng chung', async () => {
    await ensureSceneLibrary();
    const urls = [modelSrcOf('lib-a'), modelSrcOf('mine-u1')];
    const out = await Promise.all(urls.map((u) => refreshAssetUrl(u, 401, undefined, noWait)));
    expect(out.every((u) => u !== null)).toBe(true);
    expect(list).toHaveBeenCalledTimes(2);
  });

  it('không phải mẫu thư viện, hoặc lỗi khác 401/403 → không thử lại, không gọi máy chủ', async () => {
    await ensureSceneLibrary();
    expect(await refreshAssetUrl('/items/sofa/model.glb', 403, undefined, noWait)).toBeNull();
    expect(await refreshAssetUrl(modelSrcOf('lib-a'), 404, undefined, noWait)).toBeNull();
    expect(await refreshAssetUrl(modelSrcOf('lib-a'), 500, undefined, noWait)).toBeNull();
    expect(list).toHaveBeenCalledTimes(1);
  });

  it('hết quyền: máy chủ trả 403 cho thư viện → null, câu báo rõ', async () => {
    await ensureSceneLibrary();
    list.mockResolvedValueOnce({ ok: false, error: { kind: 'forbidden' } });
    const listener = vi.fn();
    const off = subscribeAssetRefresh(listener);
    expect(await refreshAssetUrl(modelSrcOf('lib-a'), 403, undefined, noWait)).toBeNull();
    off();
    expect(listener).toHaveBeenCalled();
    expect(assetRefreshStatus()).toMatchObject({ failures: [{ modelId: 'lib-a', reason: 'no-permission' }], notice: ASSET_EXPIRED_NOTICE });
  });

  it('hết quyền với RIÊNG mẫu ấy (lượt đọc mới không còn nó) → no-permission', async () => {
    await ensureSceneLibrary();
    list.mockResolvedValueOnce({ ok: true, data: [item('lib-a', 99)] });
    expect(await refreshAssetUrl(modelSrcOf('mine-u1'), 403, undefined, noWait)).toBeNull();
    expect(assetRefreshStatus().failures).toEqual([{ modelId: 'mine-u1', reason: 'no-permission' }]);
  });

  it('hết lượt: tối đa 2 lần mỗi mẫu, có chờ lùi dần; lần 3 không gọi máy chủ', async () => {
    await ensureSceneLibrary();
    const sleep = vi.fn<(ms: number) => Promise<void>>(noWait);
    let url = modelSrcOf('lib-a');
    for (let k = 0; k < 2; k += 1) url = (await refreshAssetUrl(url, 403, undefined, sleep)) ?? 'x';
    expect(await refreshAssetUrl(url, 403, undefined, sleep)).toBeNull();
    expect(sleep.mock.calls.map(([ms]) => ms)).toEqual([400, 2_000]);
    expect(list).toHaveBeenCalledTimes(3);
    expect(assetRefreshStatus()).toMatchObject({ refreshed: 2, failures: [{ modelId: 'lib-a', reason: 'exhausted' }] });
  });

  it('đổi tài khoản giữa chừng: request cũ về muộn bị bỏ, không gộp mẫu của người trước', async () => {
    await ensureSceneLibrary();
    const old = modelSrcOf('mine-u1');
    let release: (v: unknown) => void = () => undefined;
    list.mockImplementationOnce(() => new Promise((r) => (release = r)));
    const pending = refreshAssetUrl(old, 403, undefined, noWait);
    await vi.waitFor(() => expect(list).toHaveBeenCalledTimes(2));
    signIn('u2');
    await ensureSceneLibrary(); // viewer mở lại cho người mới → quên thư viện người cũ
    release({ ok: true, data: [item('mine-u1', 77)] });
    expect(await pending).toBeNull();
    expect(isServerModel('mine-u1')).toBe(false);
    expect(isServerModel('mine-u2')).toBe(true);
    expect(assetRefreshStatus()).toMatchObject({ dropped: 1, failures: [], notice: null });
  });

  it('URL của người trước (đã đổi phiên) không được gia hạn', async () => {
    await ensureSceneLibrary();
    const old = modelSrcOf('mine-u1');
    signIn('u2');
    await ensureSceneLibrary();
    expect(await refreshAssetUrl(old, 403, undefined, noWait)).toBeNull();
  });

  it('đăng xuất giữa chừng → no-session, không thử lại', async () => {
    await ensureSceneLibrary();
    expect(await refreshAssetUrl(modelSrcOf('lib-a'), 403, async () => null, noWait)).toBeNull();
    expect(assetRefreshStatus().failures).toEqual([{ modelId: 'lib-a', reason: 'no-session' }]);
  });
});

describe('ensureSceneLibrary — URL quá tuổi', () => {
  it('sau SIGNED_URL_MAX_AGE_MS lượt dựng mới đọc lại thư viện (URL mới); trước đó dùng chung', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(0);
    const first = await ensureSceneLibrary();
    const url = modelSrcOf('lib-a');
    vi.setSystemTime(SIGNED_URL_MAX_AGE_MS - 1);
    expect(await ensureSceneLibrary()).toBe(first);
    vi.setSystemTime(SIGNED_URL_MAX_AGE_MS + 1);
    const second = await ensureSceneLibrary();
    expect(second).not.toBe(first);
    expect(second.version).toBe(first.version);
    expect(modelSrcOf('lib-a')).not.toBe(url);
    expect(list).toHaveBeenCalledTimes(2);
  });
});

describe('đổi người / quá tuổi (review T2–T4)', () => {
  it('T2: phiên đã đổi người mà chưa qua ensureSceneLibrary → stale, không gọi máy chủ, không gộp mẫu người mới', async () => {
    await ensureSceneLibrary();
    const old = modelSrcOf('lib-a');
    signIn('u2');
    expect(await refreshAssetUrl(old, 403, undefined, noWait)).toBeNull();
    expect(list).toHaveBeenCalledTimes(1);
    expect(isServerModel('mine-u2')).toBe(false);
    expect(assetRefreshStatus()).toMatchObject({ dropped: 1, failures: [], notice: null });
  });

  it('T3: đổi người (forget) xoá danh sách lỗi → câu báo tắt, người nghe được báo', async () => {
    await ensureSceneLibrary();
    list.mockResolvedValueOnce({ ok: false, error: { kind: 'forbidden' } });
    await refreshAssetUrl(modelSrcOf('lib-a'), 403, undefined, noWait);
    expect(assetRefreshStatus().notice).toBe(ASSET_EXPIRED_NOTICE);
    const listener = vi.fn();
    const off = subscribeAssetRefresh(listener);
    signIn('u2');
    await ensureSceneLibrary();
    off();
    expect(listener).toHaveBeenCalled();
    expect(assetRefreshStatus()).toMatchObject({ failures: [], notice: null });
  });

  it('T4: quá tuổi mà đọc lại hỏng → giữ thư viện cũ (mẫu máy chủ không bị gỡ), lượt sau thử lại', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(0);
    const first = await ensureSceneLibrary();
    vi.setSystemTime(SIGNED_URL_MAX_AGE_MS + 1);
    let release: (v: unknown) => void = () => undefined;
    list.mockImplementationOnce(() => new Promise((r) => (release = r)));
    const pending = ensureSceneLibrary();
    await vi.waitFor(() => expect(list).toHaveBeenCalledTimes(2));
    expect(isServerModel('lib-a')).toBe(true); // trong lúc chờ: không gỡ
    release({ ok: false, error: { kind: 'server' } });
    expect(await pending).toBe(first);
    expect(isServerModel('lib-a')).toBe(true);
    const again = await ensureSceneLibrary();
    expect(list).toHaveBeenCalledTimes(3);
    expect(again.source).toBe('server');
  });
});

describe('installAssetRefresh — bản vá FileLoader (review T1)', () => {
  type Load = (url: string, onLoad?: (d: unknown) => void, onProgress?: unknown, onError?: (e: unknown) => void) => void;
  let proto: { load: Load };
  let original: Load;
  const requested: string[] = [];
  let forbid: (url: string) => boolean = () => false;

  beforeEach(async () => {
    const { FileLoader } = await import('three');
    uninstallAssetRefreshForTests();
    proto = FileLoader.prototype as unknown as { load: Load };
    original = proto.load;
    requested.length = 0;
    // Như FileLoader thật: lời gọi trùng URL đang tải dùng chung MỘT request, mọi người gọi nhận kết quả cùng nhịp.
    const waiting = new Map<string, { onLoad: ((d: unknown) => void) | undefined; onError: ((e: unknown) => void) | undefined }[]>();
    proto.load = (url, onLoad, _p, onError) => {
      const queue = waiting.get(url);
      if (queue !== undefined) {
        queue.push({ onLoad, onError });
        return;
      }
      waiting.set(url, [{ onLoad, onError }]);
      requested.push(url);
      setTimeout(() => {
        const all = waiting.get(url) ?? [];
        waiting.delete(url);
        for (const c of all) (forbid(url) ? c.onError?.({ response: { status: 403 } }) : c.onLoad?.(`ok:${url}`));
      }, 0);
    };
    const fake = proto.load;
    await installAssetRefresh(undefined, noWait);
    expect(proto.load).not.toBe(fake);
  });
  afterEach(() => {
    uninstallAssetRefreshForTests();
    proto.load = original;
  });

  const load = (url: string) =>
    new Promise<{ ok?: unknown; err?: unknown }>((resolve) => {
      proto.load.call({}, url, (d) => resolve({ ok: d }), undefined, (e) => resolve({ err: e }));
    });

  it('403 một lần → tải lại bằng URL mới, onLoad một lần', async () => {
    await ensureSceneLibrary();
    const old = modelSrcOf('lib-a');
    forbid = (u) => u === old;
    const out = await load(old);
    expect(out.ok).toBe(`ok:${modelSrcOf('lib-a')}`);
    expect(requested).toEqual([old, modelSrcOf('lib-a')]);
  });

  it('403 mãi → dừng ở trần, onError ĐÚNG MỘT lần', async () => {
    await ensureSceneLibrary();
    forbid = () => true;
    const onError = vi.fn();
    proto.load.call({}, modelSrcOf('lib-a'), undefined, undefined, onError);
    await vi.waitFor(() => expect(onError).toHaveBeenCalledTimes(1));
    await new Promise((r) => setTimeout(r, 20));
    expect(onError).toHaveBeenCalledTimes(1);
    expect(requested.length).toBe(3); // gốc + 2 lần gia hạn
    expect(assetRefreshStatus().notice).toBe(ASSET_EXPIRED_NOTICE);
  });

  it('hai lời gọi đồng thời cùng URL → dùng chung một lượt gia hạn, không báo exhausted sai', async () => {
    await ensureSceneLibrary();
    const old = modelSrcOf('lib-a');
    forbid = (u) => u === old;
    const [a, b] = await Promise.all([load(old), load(old)]);
    expect(a.ok).toBeDefined();
    expect(b.ok).toBeDefined();
    expect(list).toHaveBeenCalledTimes(2);
    expect(assetRefreshStatus()).toMatchObject({ failures: [], notice: null });
  });

  it('gỡ vá → FileLoader về bản gốc', () => {
    const patched = proto.load;
    uninstallAssetRefreshForTests();
    expect(proto.load).not.toBe(patched);
  });
});

describe('lát 4 (review N3, T3)', () => {
  it('N3: mẫu đã tải lại THÀNH CÔNG được tính lại trần lượt — phiên dài không báo exhausted mãi', async () => {
    await ensureSceneLibrary();
    let url = modelSrcOf('lib-a');
    for (let k = 0; k < 2; k += 1) url = (await refreshAssetUrl(url, 403, undefined, noWait)) ?? 'x';
    assetLoadedOk(url);
    expect(await refreshAssetUrl(url, 403, undefined, noWait)).not.toBeNull();
    expect(assetRefreshStatus().failures).toEqual([]);
  });

  it('N3: chỉ nhận URL mới mà chưa tải được thì KHÔNG xoá trần (403 mãi vẫn dừng)', async () => {
    await ensureSceneLibrary();
    let url = modelSrcOf('lib-a');
    for (let k = 0; k < 2; k += 1) url = (await refreshAssetUrl(url, 403, undefined, noWait)) ?? 'x';
    expect(await refreshAssetUrl(url, 403, undefined, noWait)).toBeNull();
    expect(assetRefreshStatus().failures).toEqual([{ modelId: 'lib-a', reason: 'exhausted' }]);
  });

  it('N3: đọc lại theo tuổi thành công → trần lượt từng mẫu tính lại', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(0);
    await ensureSceneLibrary();
    let url = modelSrcOf('lib-a');
    for (let k = 0; k < 2; k += 1) url = (await refreshAssetUrl(url, 403, undefined, noWait)) ?? 'x';
    vi.setSystemTime(SIGNED_URL_MAX_AGE_MS * 2);
    await ensureSceneLibrary();
    expect(await refreshAssetUrl(modelSrcOf('lib-a'), 403, undefined, noWait)).not.toBeNull();
  });

  it.each([
    ['rỗng', { ok: true, data: [] }],
    ['403', { ok: false, error: { kind: 'forbidden' } }],
  ])('N3: đọc lại theo tuổi trả %s (hợp lệ) → nhận, gỡ thư viện cũ, không giữ mãi', async (_n, reply) => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(0);
    await ensureSceneLibrary();
    vi.setSystemTime(SIGNED_URL_MAX_AGE_MS + 1);
    list.mockResolvedValueOnce(reply);
    const lib = await ensureSceneLibrary();
    expect(lib.source).not.toBe('server');
    expect(isServerModel('lib-a')).toBe(false);
    expect(await ensureSceneLibrary()).toBe(lib);
    expect(list).toHaveBeenCalledTimes(2);
  });

  it('T3: lỗi stale không vào danh sách, không báo người nghe (câu báo đã đóng không hiện lại)', async () => {
    await ensureSceneLibrary();
    const listener = vi.fn();
    const off = subscribeAssetRefresh(listener);
    signIn('u2');
    expect(await refreshAssetUrl(modelSrcOf('lib-a'), 403, undefined, noWait)).toBeNull();
    off();
    expect(listener).not.toHaveBeenCalled();
    expect(assetRefreshStatus()).toMatchObject({ dropped: 1, failures: [], notice: null });
  });
});
