import { beforeEach, describe, expect, it, vi } from 'vitest';

import { ensureSceneLibrary, resetSceneLibraryForTests, sceneLibraryNow } from '../sceneLibrary';
import { BUNDLED_LIBRARY_VERSION, LIBRARY_FALLBACK_NOTICE, libraryVersionOf } from '../serverLibrary';

const item = (id: string, query = '') => ({
  id,
  widthMm: 900,
  heightMm: 800,
  depthMm: 500,
  modelUrl: `https://minio.test/library/${id}.glb${query}`,
});
const api = (result: unknown) => async () => ({ list: async () => result }) as never;

beforeEach(() => resetSceneLibraryForTests());

describe('ensureSceneLibrary — điểm vào chung của ba viewer', () => {
  it('một lượt đọc mỗi phiên: viewer thứ hai (đổi dự án) nhận lại đúng promise, không gọi lại máy chủ', async () => {
    const list = vi.fn(async () => ({ ok: true, data: [item('lib-chair-a')] }));
    const getApi = async () => ({ list }) as never;
    const [a, b] = await Promise.all([ensureSceneLibrary(getApi), ensureSceneLibrary(getApi)]);
    expect(list).toHaveBeenCalledTimes(1);
    expect(a).toBe(b);
    expect(a).toMatchObject({ source: 'server', count: 1, notice: null });
    expect(sceneLibraryNow()).toBe(a);
  });

  it('thư viện chậm: chờ ĐÚNG kết quả, không đua giờ ra dự phòng', async () => {
    vi.useFakeTimers();
    try {
      let release: (v: unknown) => void = () => undefined;
      const list = () => new Promise((r) => (release = r));
      let done: unknown = null;
      void ensureSceneLibrary(async () => ({ list }) as never).then((v) => (done = v));
      await vi.advanceTimersByTimeAsync(30_000);
      expect(done).toBeNull();
      release({ ok: true, data: [item('lib-slow')] });
      await vi.waitFor(() => expect(done).toMatchObject({ source: 'server' }));
    } finally {
      vi.useRealTimers();
    }
  });

  it.each([
    ['5xx', { kind: 'server' }, 'fallback:server', LIBRARY_FALLBACK_NOTICE],
    ['hết giờ', { kind: 'timeout' }, 'fallback:timeout', LIBRARY_FALLBACK_NOTICE],
    ['403', { kind: 'forbidden' }, 'fallback:forbidden', null],
    ['404', { kind: 'notFound' }, 'fallback:notFound', null],
  ])('%s → dự phòng danh mục đóng gói, phiên bản `bundled`, câu báo đúng loại', async (_n, error, source, notice) => {
    const lib = await ensureSceneLibrary(api({ ok: false, error }));
    expect(lib).toEqual({ count: 0, source, version: BUNDLED_LIBRARY_VERSION, notice });
  });

  it('chưa có phiên / getApi ném → dự phòng có lý do, không ném', async () => {
    expect(await ensureSceneLibrary(async () => null)).toMatchObject({ source: 'fallback:no-session', notice: null });
    resetSceneLibraryForTests();
    expect(await ensureSceneLibrary(() => Promise.reject(new Error('x')))).toMatchObject({
      source: 'fallback:threw',
      notice: LIBRARY_FALLBACK_NOTICE,
    });
  });

  it('phiên bản ổn định: không đổi theo thứ tự hay chữ ký URL, đổi khi kích thước/đường dẫn đổi', () => {
    const v = libraryVersionOf([item('a'), item('b')]);
    expect(libraryVersionOf([item('b', '?sig=2'), item('a', '?sig=1')])).toBe(v);
    expect(libraryVersionOf([item('a'), { ...item('b'), widthMm: 901 }])).not.toBe(v);
    expect(libraryVersionOf([item('a'), { ...item('b'), modelUrl: 'https://minio.test/x.glb' }])).not.toBe(v);
  });
});
