import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { getSessionSnapshot, resetAuthState, setAnonymousSession, setAuthenticatedSession } from '@/lib/auth/state';

import { CATALOG_MODELS, clearServerLibrary, isServerModel, modelSrcOf, registerServerLibrary } from '../furnitureCatalog';
import { loadSceneConcept } from '../sceneConcept';
import { ensureSceneLibrary, resetSceneLibraryForTests } from '../sceneLibrary';

/**
 * Phiên đổi trong CÙNG thẻ (không tải lại trang) — các test parity mock `startAppSession: async () => true` nên không
 * bắt được: lượt khởi động đã nhớ `false` (vào app lúc chưa đăng nhập) và danh mục máy chủ của người trước.
 */
const { list, read } = vi.hoisted(() => ({
  list: vi.fn(),
  read: vi.fn(),
}));
// Lượt khởi động lúc tải trang: chưa đăng nhập → `false`, và `startAppSession` nhớ đúng promise ấy.
vi.mock('@/routes/sessionSetup', () => ({ startAppSession: async () => false }));
vi.mock('@/api/appClient', () => ({
  createAppApiClient: () => ({ library: { list }, designConcept: { read } }),
}));

const signIn = (id: string): void =>
  setAuthenticatedSession({ accessToken: `t-${id}`, expiresAt: Date.now() + 3_600_000, roles: [], user: { id } } as never);

const item = (id: string) => ({ id, widthMm: 900, heightMm: 800, depthMm: 500, modelUrl: `https://minio.test/${id}.glb?sig=1` });

beforeEach(() => {
  resetSceneLibraryForTests();
  list.mockReset();
  read.mockReset();
  // Thư viện máy chủ trả cả mẫu riêng (`mine`) của người đang đăng nhập.
  list.mockImplementation(async () => ({ ok: true, data: [item(`mine-${getSessionSnapshot().user?.id ?? 'x'}`)] }));
  read.mockResolvedValue({ ok: false, error: { kind: 'notFound' } });
});
afterEach(() => resetAuthState());

describe('đăng nhập SAU khi tải trang (cùng thẻ)', () => {
  it('thư viện: lượt trước khi đăng nhập là no-session, không bị nhớ; đăng nhập xong thì đọc máy chủ', async () => {
    setAnonymousSession({ refreshFailed: false });
    expect(await ensureSceneLibrary()).toMatchObject({ source: 'fallback:no-session' });
    expect(list).not.toHaveBeenCalled();

    signIn('a');
    expect(await ensureSceneLibrary()).toMatchObject({ source: 'server', count: 1 });
    expect(list).toHaveBeenCalledTimes(1);
    expect(isServerModel('mine-a')).toBe(true);
  });

  it('concept: chưa đăng nhập = không đọc; đăng nhập xong thì đọc N47 dù `startAppSession` vẫn nhớ `false`', async () => {
    setAnonymousSession({ refreshFailed: false });
    expect(await loadSceneConcept('p1')).toMatchObject({ source: 'none' });
    expect(read).not.toHaveBeenCalled();

    signIn('a');
    await loadSceneConcept('p1');
    expect(read).toHaveBeenCalledWith({ projectId: 'p1' });
  });
});

describe('đổi tài khoản trong cùng thẻ', () => {
  it('người sau không dùng danh mục (mẫu riêng, URL ký) của người trước, và có mẫu riêng của mình', async () => {
    signIn('a');
    await ensureSceneLibrary();
    expect(isServerModel('mine-a')).toBe(true);

    signIn('b');
    expect(await ensureSceneLibrary()).toMatchObject({ source: 'server', count: 1 });
    expect(list).toHaveBeenCalledTimes(2);
    expect(isServerModel('mine-a')).toBe(false);
    expect(Object.prototype.hasOwnProperty.call(CATALOG_MODELS, 'mine-a')).toBe(false);
    expect(isServerModel('mine-b')).toBe(true);
  });

  it('cùng người gọi lại: vẫn một lượt đọc (viewer khác, đổi dự án)', async () => {
    signIn('a');
    await ensureSceneLibrary();
    await ensureSceneLibrary();
    expect(list).toHaveBeenCalledTimes(1);
  });

  it('gỡ thư viện máy chủ trả lại mục đóng gói bị che', () => {
    const id = Object.keys(CATALOG_MODELS).find((key) => Object.getOwnPropertyDescriptor(CATALOG_MODELS, key)?.writable === true);
    if (id === undefined) throw new Error('không có mục đóng gói ghi được');
    const original = CATALOG_MODELS[id];
    registerServerLibrary([item(id)]);
    expect(modelSrcOf(id)).toContain('sig=1');
    clearServerLibrary();
    expect(CATALOG_MODELS[id]).toBe(original);
    expect(isServerModel(id)).toBe(false);
  });
});
