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
  sceneLibraryNow,
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
    expect(assetRefreshStatus()).toEqual({ refreshed: 1, retriedSame: 0, dropped: 0, failures: [], failureId: 0, notice: null });
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

  it('Request (như FileLoader) → thử lại GIỮ NGUYÊN mọi tuỳ chọn (Codex-2 #2: mode/redirect/cache/credentials/headers)', async () => {
    await ensureSceneLibrary();
    const old = modelSrcOf('lib-a');
    forbid = (u) => u === old;
    const seen: Request[] = [];
    const spy = (async (input: RequestInfo | URL, init?: RequestInit) => {
      if (typeof input === 'object' && !(input instanceof URL)) seen.push(input);
      return next(input, init);
    }) as typeof fetch;
    const req = new Request(old, { headers: { 'x-a': '1' }, credentials: 'include', mode: 'same-origin', redirect: 'manual', cache: 'no-store' });
    const res = await fetchWithAssetRefresh(req, undefined, spy, undefined, noWait);
    expect(res.status).toBe(200);
    const retry = seen[1];
    expect(retry?.url).toBe(modelSrcOf('lib-a'));
    expect([retry?.credentials, retry?.mode, retry?.redirect, retry?.cache]).toEqual(['include', 'same-origin', 'manual', 'no-store']);
    expect(retry?.headers.get('x-a')).toBe('1');
  });

  it('Codex-2 #2: POST/thân request → không gia hạn, không thử lại (đi thẳng)', async () => {
    await ensureSceneLibrary();
    forbid = () => true;
    const res = await fetchWithAssetRefresh(modelSrcOf('lib-a'), { method: 'POST', body: 'x' }, next, undefined, noWait);
    expect(res.status).toBe(403);
    expect(requested.length).toBe(1);
    expect(list).toHaveBeenCalledTimes(1);
  });

  it('Codex-2 #3: rời dự án khi phản hồi ĐẦU còn treo → 403 về sau không gia hạn/thử lại', async () => {
    await ensureSceneLibrary();
    const old = modelSrcOf('lib-a');
    let answer: (r: Response) => void = () => undefined;
    const slow = ((input: RequestInfo | URL) => {
      requested.push(String(input));
      return requested.length === 1 ? new Promise<Response>((r) => (answer = r)) : Promise.resolve(new Response('ok'));
    }) as typeof fetch;
    const pending = fetchWithAssetRefresh(old, undefined, slow, undefined, noWait);
    abandonAssetRefresh();
    answer(new Response('expired', { status: 403 }));
    expect((await pending).status).toBe(403);
    expect(requested.length).toBe(1);
    expect(list).toHaveBeenCalledTimes(1);
    expect(assetRefreshStatus()).toMatchObject({ dropped: 1, failures: [] });
  });

  it('Codex-2 #3: signal huỷ trong lúc chờ lùi → người gọi nhận ngay, không thử lại', async () => {
    await ensureSceneLibrary();
    forbid = () => true;
    const ctl = new AbortController();
    let sleeping: () => void = () => undefined;
    const sleep = () => new Promise<void>((r) => (sleeping = r));
    const pending = fetchWithAssetRefresh(modelSrcOf('lib-a'), { signal: ctl.signal }, next, undefined, sleep);
    await vi.waitFor(() => expect(requested.length).toBe(1));
    ctl.abort();
    expect((await pending).status).toBe(403);
    sleeping();
    expect(requested.length).toBe(1);
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

describe('review Codex-2 / Claude-A (lát 2)', () => {
  it('Codex-2 #1: đọc theo tuổi CŨ về sau lượt gia hạn mới hơn → không ghi đè danh mục mới hơn', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(0);
    await ensureSceneLibrary();
    vi.setSystemTime(SIGNED_URL_MAX_AGE_MS + 1);
    let releaseAge: (v: unknown) => void = () => undefined;
    list.mockImplementationOnce(() => new Promise((r) => (releaseAge = r)));
    const age = ensureSceneLibrary();
    await vi.waitFor(() => expect(list).toHaveBeenCalledTimes(2));
    list.mockResolvedValueOnce({ ok: true, data: [item('lib-a', 300)] });
    expect(await refreshAssetUrl(modelSrcOf('lib-a'), 403, undefined, noWait)).toContain('sig=300');
    releaseAge({ ok: true, data: [item('lib-a', 200), item('mine-u1', 200)] });
    await age;
    expect(modelSrcOf('lib-a')).toContain('sig=300');
    expect(isServerModel('mine-u1')).toBe(false); // không khôi phục mẫu lượt mới hơn đã gỡ
  });

  it('Codex-2 #1 (ngược lại): gia hạn CŨ về sau đọc theo tuổi mới hơn → giữ danh mục mới hơn', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(0);
    await ensureSceneLibrary();
    let releaseRefresh: (v: unknown) => void = () => undefined;
    list.mockImplementationOnce(() => new Promise((r) => (releaseRefresh = r)));
    const refresh = refreshAssetUrl(modelSrcOf('lib-a'), 403, undefined, noWait);
    await vi.waitFor(() => expect(list).toHaveBeenCalledTimes(2));
    vi.setSystemTime(SIGNED_URL_MAX_AGE_MS + 1);
    list.mockResolvedValueOnce({ ok: true, data: [item('lib-a', 500)] });
    await ensureSceneLibrary();
    releaseRefresh({ ok: true, data: [item('lib-a', 400), item('mine-u1', 400)] });
    expect(await refresh).toContain('sig=500');
    expect(isServerModel('mine-u1')).toBe(false);
  });

  it('Claude-A #11: đổi tài khoản giữa lượt đọc → nguồn fallback:stale (không giả server), không câu báo', async () => {
    let release: (v: unknown) => void = () => undefined;
    list.mockImplementationOnce(() => new Promise((r) => (release = r)));
    const first = ensureSceneLibrary();
    await vi.waitFor(() => expect(list).toHaveBeenCalledTimes(1));
    signIn('u2');
    release({ ok: true, data: [item('lib-a', 9), item('mine-u1', 9)] });
    const lib = await first;
    expect(lib).toMatchObject({ source: 'fallback:stale', notice: null });
    expect(isServerModel('mine-u1')).toBe(false);
    expect((await ensureSceneLibrary()).source).toBe('server'); // lượt sau đọc lại cho u2
    expect(isServerModel('mine-u2')).toBe(true);
  });

  it('Codex-2 #5: hai bó cùng tài liệu → MỘT lớp chặn, request giao cho bó sở hữu URL, đầu dò gộp', async () => {
    uninstallAssetRefreshForTests();
    const before = globalThis.fetch;
    vi.stubGlobal('location', { search: '?probe=1', href: 'http://app.test/' });
    const other = { abandon: vi.fn(), owns: (u: string) => u.startsWith('https://other.test/'), handle: vi.fn(async () => new Response('b')), status: () => ({ refreshed: 2, retriedSame: 0, dropped: 0, failures: [{ modelId: 'x', reason: 'exhausted' as const }], failureId: 1, notice: ASSET_EXPIRED_NOTICE }) };
    const hubKey = Symbol.for('appfront.assetRefresh.hub');
    installAssetRefresh(undefined, noWait);
    (globalThis as unknown as Record<symbol, { bundles: unknown[] }>)[hubKey]!.bundles.push(other);
    expect(globalThis.fetch).not.toBe(before);
    await globalThis.fetch('https://other.test/m.glb');
    expect(other.handle).toHaveBeenCalledTimes(1);
    const probe = (globalThis as { __assetRefreshStatus?: () => { refreshed: number; failures: unknown[]; notice: string | null } }).__assetRefreshStatus!();
    expect(probe.refreshed).toBe(2);
    expect(probe.notice).toBe(ASSET_EXPIRED_NOTICE);
    const bundles = (globalThis as unknown as Record<symbol, { bundles: unknown[] }>)[hubKey]!.bundles;
    bundles.splice(bundles.indexOf(other), 1);
    uninstallAssetRefreshForTests();
    expect(globalThis.fetch).toBe(before);
    vi.unstubAllGlobals();
  });

  it('Codex-2 #7 / Claude-A #12: failureId tăng dần, không đặt lại khi đổi người', async () => {
    await ensureSceneLibrary();
    list.mockResolvedValueOnce({ ok: false, error: { kind: 'forbidden' } });
    await refreshAssetUrl(modelSrcOf('lib-a'), 403, undefined, noWait);
    const firstId = assetRefreshStatus().failureId;
    expect(firstId).toBeGreaterThan(0);
    signIn('u2');
    await ensureSceneLibrary();
    expect(assetRefreshStatus().failures).toEqual([]);
    list.mockResolvedValueOnce({ ok: false, error: { kind: 'forbidden' } });
    await refreshAssetUrl(modelSrcOf('lib-a'), 403, undefined, noWait);
    expect(assetRefreshStatus().failureId).toBeGreaterThan(firstId);
  });
});

describe('review Codex-3 (lát 3)', () => {
  const hubKey = Symbol.for('appfront.assetRefresh.hub');
  interface HubLike { bundles: unknown[]; listeners: Set<() => void> }
  const hubOf = (): HubLike => (globalThis as unknown as Record<symbol, HubLike>)[hubKey]!;

  it('#5: hai bó CÙNG có một mẫu, bó A xử lý → abandon từ bó B vô hiệu A; câu báo của A tới người nghe của B', async () => {
    await ensureSceneLibrary(); // bó này (B) đã đăng ký
    const url = modelSrcOf('lib-a');
    let aFailures: { modelId: string; reason: 'exhausted' }[] = [];
    const a = {
      owns: (u: string) => u.split('?')[0] === url.split('?')[0],
      handle: vi.fn(async () => new Response('a')),
      status: () => ({ refreshed: 0, retriedSame: 0, dropped: 0, failures: aFailures, failureId: aFailures.length, notice: null }),
      abandon: vi.fn(),
    };
    hubOf().bundles.unshift(a); // A đăng ký TRƯỚC → lớp chặn giao request cho A
    try {
      await globalThis.fetch(url);
      expect(a.handle).toHaveBeenCalledTimes(1);
      abandonAssetRefresh();
      expect(a.abandon).toHaveBeenCalledTimes(1);
      const heard = vi.fn();
      const off = subscribeAssetRefresh(heard);
      aFailures = [{ modelId: 'lib-a', reason: 'exhausted' }];
      hubOf().listeners.forEach((l) => l()); // A gọi notify của nó = người nghe chung
      off();
      expect(heard).toHaveBeenCalled();
      expect(assetRefreshStatus()).toMatchObject({ failures: [{ modelId: 'lib-a', reason: 'exhausted' }], notice: ASSET_EXPIRED_NOTICE });
    } finally {
      hubOf().bundles.splice(hubOf().bundles.indexOf(a), 1);
    }
  });

  it('#3/#10: huỷ signal trong lúc chờ lùi → không gọi API, không ghi danh mục sau đó', async () => {
    await ensureSceneLibrary();
    const old = modelSrcOf('lib-a');
    const ctl = new AbortController();
    let wake: () => void = () => undefined;
    const sleep = () => new Promise<void>((r) => (wake = r));
    const pending = refreshAssetUrl(old, 403, undefined, sleep, ctl.signal);
    ctl.abort();
    wake();
    expect(await pending).toBeNull();
    expect(list).toHaveBeenCalledTimes(1);
    expect(modelSrcOf('lib-a')).toBe(old);
    expect(assetRefreshStatus().failures).toEqual([]);
  });

  it('N3: gia hạn thành công → gỡ người nghe abort khỏi signal', async () => {
    await ensureSceneLibrary();
    const old = modelSrcOf('lib-a');
    const ctl = new AbortController();
    const removed = vi.spyOn(ctl.signal, 'removeEventListener');
    const next = (async (input: RequestInfo | URL) =>
      new Response('x', { status: String(input) === old ? 403 : 200 })) as typeof fetch;
    const res = await fetchWithAssetRefresh(old, { signal: ctl.signal }, next, undefined, noWait);
    expect(res.status).toBe(200);
    expect(removed).toHaveBeenCalledWith('abort', expect.any(Function));
  });

  it('N4: đọc theo tuổi CŨ (rỗng) về sau lượt gia hạn mới hơn → không chốt nguồn/giờ cũ, danh mục giữ', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(0);
    const first = await ensureSceneLibrary();
    vi.setSystemTime(SIGNED_URL_MAX_AGE_MS + 1);
    let releaseAge: (v: unknown) => void = () => undefined;
    list.mockImplementationOnce(() => new Promise((r) => (releaseAge = r)));
    const age = ensureSceneLibrary();
    await vi.waitFor(() => expect(list).toHaveBeenCalledTimes(2));
    list.mockResolvedValueOnce({ ok: true, data: [item('lib-a', 300)] });
    await refreshAssetUrl(modelSrcOf('lib-a'), 403, undefined, noWait);
    releaseAge({ ok: true, data: [] });
    expect(await age).toBe(first);
    expect(sceneLibraryNow()?.source).toBe('server');
    expect(isServerModel('lib-a')).toBe(true);
    expect(await ensureSceneLibrary()).toBe(first); // không đọc lại vô cớ
    expect(list).toHaveBeenCalledTimes(3);
  });
});

describe('review Codex-4 (lát 4)', () => {
  it('#1: A và B cùng chờ gia hạn một mẫu, A huỷ trong lúc chờ lùi → B vẫn nhận URL mới (1 lần đọc thư viện)', async () => {
    await ensureSceneLibrary();
    const old = modelSrcOf('lib-a');
    let wake: () => void = () => undefined;
    const sleep = () => new Promise<void>((r) => (wake = r));
    const a = new AbortController();
    const b = new AbortController();
    const pa = refreshAssetUrl(old, 403, undefined, sleep, a.signal);
    const pb = refreshAssetUrl(old, 403, undefined, sleep, b.signal);
    a.abort();
    wake();
    const fresh = await pb;
    expect(fresh).not.toBeNull();
    expect(fresh).toBe(modelSrcOf('lib-a'));
    expect(await pa).toBe(fresh); // promise chung; người huỷ đã được trả ngay ở lớp fetch (unlessAborted)
    expect(list).toHaveBeenCalledTimes(2);
  });

  it('#1: MỌI người chờ đều huỷ → không gọi API, không ghi danh mục; trần không tăng', async () => {
    await ensureSceneLibrary();
    const old = modelSrcOf('lib-a');
    let wake: () => void = () => undefined;
    const sleep = () => new Promise<void>((r) => (wake = r));
    const a = new AbortController();
    const b = new AbortController();
    const pa = refreshAssetUrl(old, 403, undefined, sleep, a.signal);
    void refreshAssetUrl(old, 403, undefined, sleep, b.signal);
    a.abort();
    b.abort();
    wake();
    expect(await pa).toBeNull();
    expect(list).toHaveBeenCalledTimes(1);
    expect(modelSrcOf('lib-a')).toBe(old);
    // Lượt sau (không huỷ) dùng lượt thứ 2 của trần rồi dừng: trần vẫn 2.
    expect(await refreshAssetUrl(old, 403, undefined, noWait)).not.toBeNull();
    expect(await refreshAssetUrl(modelSrcOf('lib-a'), 403, undefined, noWait)).toBeNull();
    expect(assetRefreshStatus().failures).toEqual([{ modelId: 'lib-a', reason: 'exhausted' }]);
  });

  it('#2: đổi tài khoản khi đọc theo tuổi đang chờ → người chờ nhận fallback:stale, không phải kết quả của người trước', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(0);
    await ensureSceneLibrary();
    vi.setSystemTime(SIGNED_URL_MAX_AGE_MS + 1);
    let release: (v: unknown) => void = () => undefined;
    list.mockImplementationOnce(() => new Promise((r) => (release = r)));
    const age = ensureSceneLibrary();
    await vi.waitFor(() => expect(list).toHaveBeenCalledTimes(2));
    signIn('u2');
    release({ ok: true, data: [item('lib-a', 60), item('mine-u1', 60)] });
    expect(await age).toMatchObject({ source: 'fallback:stale', count: 0 });
  });
});
