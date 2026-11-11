import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { getSessionSnapshot, resetAuthState, setAuthenticatedSession } from '@/lib/auth/state';

import { isServerModel, modelSrcOf } from '../furnitureCatalog';
import {
  abandonAssetRefresh,
  ASSET_EXPIRED_NOTICE,
  assetRefreshStatus,
  assetLoadedOk,
  ensureSceneLibrary,
  fetchWithAssetRefresh,
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

describe('fetchWithAssetRefresh — lớp chặn fetch dùng chung mọi bản three (vòng 11)', () => {
  const requested: string[] = [];
  let forbid: (url: string) => boolean = () => false;
  /** fetch giả: 403 cho URL bị chặn, 200 cho URL còn lại. */
  const next = (async (input: RequestInfo | URL) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
    requested.push(url);
    return new Response(forbid(url) ? 'expired' : `ok:${url}`, { status: forbid(url) ? 403 : 200 });
  }) as typeof fetch;
  const get = (url: string) => fetchWithAssetRefresh(url, undefined, next, undefined, noWait);

  beforeEach(() => {
    requested.length = 0;
    forbid = () => false;
  });

  it('403 một lần → tải lại bằng URL mới trong CÙNG lời gọi, người gọi nhận 200', async () => {
    await ensureSceneLibrary();
    const old = modelSrcOf('lib-a');
    forbid = (u) => u === old;
    const res = await get(old);
    expect(res.status).toBe(200);
    expect(await res.text()).toBe(`ok:${modelSrcOf('lib-a')}`);
    expect(requested).toEqual([old, modelSrcOf('lib-a')]);
  });

  it('403 mãi → dừng ở trần (gốc + 2 gia hạn), trả nguyên 403, có câu báo', async () => {
    await ensureSceneLibrary();
    forbid = () => true;
    const res = await get(modelSrcOf('lib-a'));
    expect(res.status).toBe(403);
    expect(requested.length).toBe(3);
    expect(list).toHaveBeenCalledTimes(3);
    expect(assetRefreshStatus().notice).toBe(ASSET_EXPIRED_NOTICE);
  });

  it('Request (như FileLoader) → URL tuyệt đối khớp mẫu; giữ header/credentials khi thử lại', async () => {
    await ensureSceneLibrary();
    const old = modelSrcOf('lib-a');
    forbid = (u) => u === old;
    const seen: RequestInit[] = [];
    const spy = (async (input: RequestInfo | URL, init?: RequestInit) => {
      if (init) seen.push(init);
      return next(input, init);
    }) as typeof fetch;
    const res = await fetchWithAssetRefresh(new Request(old, { headers: { 'x-a': '1' }, credentials: 'include' }), undefined, spy, undefined, noWait);
    expect(res.status).toBe(200);
    expect(seen[0]?.credentials).toBe('include');
    expect(new Headers(seen[0]?.headers).get('x-a')).toBe('1');
  });

  it('URL không phải mẫu thư viện (API 401) → không gia hạn, không đọc thư viện', async () => {
    await ensureSceneLibrary();
    forbid = () => true;
    const res = await get('https://api.test/projects');
    expect(res.status).toBe(403);
    expect(requested.length).toBe(1);
    expect(list).toHaveBeenCalledTimes(1);
  });

  it('rời dự án giữa chừng (abandonAssetRefresh) → kết quả bị bỏ, không tải lại, không câu báo', async () => {
    await ensureSceneLibrary();
    const old = modelSrcOf('lib-a');
    forbid = (u) => u === old;
    let release: (v: unknown) => void = () => undefined;
    list.mockImplementationOnce(() => new Promise((r) => (release = r)));
    const pending = get(old);
    await vi.waitFor(() => expect(list).toHaveBeenCalledTimes(2));
    abandonAssetRefresh();
    release({ ok: true, data: [item('lib-a', 99)] });
    expect((await pending).status).toBe(403);
    expect(requested).toEqual([old]);
    expect(modelSrcOf('lib-a')).toBe(old); // không gộp kết quả cũ
    expect(assetRefreshStatus()).toMatchObject({ dropped: 1, failures: [], notice: null });
  });

  it('installAssetRefresh đặt MỘT lớp chặn lên globalThis.fetch; ?disable=assetrefresh thì không', () => {
    uninstallAssetRefreshForTests();
    const before = globalThis.fetch;
    vi.stubGlobal('location', { search: '?disable=assetrefresh', href: 'http://app.test/' });
    installAssetRefresh(undefined, noWait);
    expect(globalThis.fetch).toBe(before);
    vi.stubGlobal('location', { search: '?probe=1', href: 'http://app.test/' });
    installAssetRefresh(undefined, noWait);
    const wrapped = globalThis.fetch;
    expect(wrapped).not.toBe(before);
    expect((globalThis as { __assetRefreshStatus?: unknown }).__assetRefreshStatus).toBe(assetRefreshStatus);
    installAssetRefresh(undefined, noWait);
    expect(globalThis.fetch).toBe(wrapped);
    uninstallAssetRefreshForTests();
    expect(globalThis.fetch).toBe(before);
    vi.unstubAllGlobals();
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

describe('review Codex vòng 11 (#1, #2, #3)', () => {
  it('#1: đổi tài khoản TRONG lúc chờ lùi → stale, không đọc/nạp thư viện của người mới, không thử lại', async () => {
    await ensureSceneLibrary();
    const old = modelSrcOf('lib-a');
    const switchDuringSleep = async (): Promise<void> => signIn('u2');
    expect(await refreshAssetUrl(old, 403, undefined, switchDuringSleep)).toBeNull();
    expect(list).toHaveBeenCalledTimes(1);
    expect(isServerModel('mine-u2')).toBe(false);
    expect(modelSrcOf('lib-a')).toBe(old);
    expect(assetRefreshStatus()).toMatchObject({ dropped: 1, failures: [] });
  });

  it('#1: đổi tài khoản trong lúc đọc lại thư viện → kết quả không nạp, mẫu cũ không nhận URL của người mới', async () => {
    await ensureSceneLibrary();
    const old = modelSrcOf('lib-a');
    let release: (v: unknown) => void = () => undefined;
    list.mockImplementationOnce(() => new Promise((r) => (release = r)));
    const pending = refreshAssetUrl(old, 403, undefined, noWait);
    await vi.waitFor(() => expect(list).toHaveBeenCalledTimes(2));
    signIn('u2');
    release({ ok: true, data: [item('lib-a', 50), item('mine-u2', 50)] });
    expect(await pending).toBeNull();
    expect(isServerModel('mine-u2')).toBe(false);
    expect(modelSrcOf('lib-a')).toBe(old);
  });

  it('#2: thư viện quá tuổi + nhiều lời gọi đồng thời → MỘT request đọc lại dùng chung', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(0);
    await ensureSceneLibrary();
    vi.setSystemTime(SIGNED_URL_MAX_AGE_MS + 1);
    const [a, b, c] = await Promise.all([ensureSceneLibrary(), ensureSceneLibrary(), ensureSceneLibrary()]);
    expect(list).toHaveBeenCalledTimes(2);
    expect(a).toBe(b);
    expect(b).toBe(c);
  });

  it('#2: phản hồi đọc lại của người cũ về SAU khi đổi người → không ghi vào danh mục của người mới', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(0);
    await ensureSceneLibrary();
    vi.setSystemTime(SIGNED_URL_MAX_AGE_MS + 1);
    let release: (v: unknown) => void = () => undefined;
    list.mockImplementationOnce(() => new Promise((r) => (release = r)));
    void ensureSceneLibrary();
    await vi.waitFor(() => expect(list).toHaveBeenCalledTimes(2));
    signIn('u2');
    await ensureSceneLibrary();
    expect(isServerModel('mine-u2')).toBe(true);
    release({ ok: true, data: [item('lib-a', 77), item('mine-u1', 77)] });
    await new Promise((r) => setTimeout(r, 0));
    expect(isServerModel('mine-u1')).toBe(false);
    expect(modelSrcOf('lib-a')).not.toContain('sig=77');
  });

  it('#3: gia hạn theo mẫu trả danh sách thiếu mẫu (mất quyền) → mẫu ấy bị gỡ khỏi danh mục', async () => {
    await ensureSceneLibrary();
    expect(isServerModel('mine-u1')).toBe(true);
    list.mockResolvedValueOnce({ ok: true, data: [item('lib-a', 40)] });
    expect(await refreshAssetUrl(modelSrcOf('lib-a'), 403, undefined, noWait)).not.toBeNull();
    expect(isServerModel('mine-u1')).toBe(false);
    expect(isServerModel('lib-a')).toBe(true);
  });
});
