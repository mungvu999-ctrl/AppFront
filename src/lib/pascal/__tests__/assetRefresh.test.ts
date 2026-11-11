import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { getSessionSnapshot, resetAuthState, setAuthenticatedSession } from '@/lib/auth/state';

import { isServerModel, modelSrcOf } from '../furnitureCatalog';
import {
  ASSET_EXPIRED_NOTICE,
  assetRefreshStatus,
  ensureSceneLibrary,
  refreshAssetUrl,
  resetSceneLibraryForTests,
  SIGNED_URL_MAX_AGE_MS,
  subscribeAssetRefresh,
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
    expect(assetRefreshStatus()).toEqual({ refreshed: 1, retriedSame: 0, failures: [], notice: null });
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
    expect(assetRefreshStatus()).toMatchObject({ failures: [{ modelId: 'mine-u1', reason: 'stale' }], notice: null });
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
