import { describe, expect, it, vi } from 'vitest';

import {
  CATALOG_MODELS,
  isServerModel,
  modelSrcOf,
  serverAttributionOf,
  serverCatalogTiles,
  serverKindOf,
  thumbnailOf,
} from '../furnitureCatalog';
import { libraryReadFailed, loadServerLibrary } from '../serverLibrary';

const item = (id: string) => ({
  id,
  widthMm: 1200,
  heightMm: 750,
  depthMm: 600,
  modelUrl: `https://cdn.example.test/library/${id}.glb`,
  previewUrl: `https://cdn.example.test/library/${id}.webp`,
});
// Ép kiểu: test chỉ cần các trường danh mục đọc, không cần cả `LibraryItem`.
const okApi = (items: ReturnType<typeof item>[]) => ({ list: async () => ({ ok: true, data: items }) }) as never;

describe('loadServerLibrary', () => {
  it('gộp mục máy chủ: mục mới khả dụng, mục trùng id đóng gói thì máy chủ thắng', async () => {
    // Mục đóng gói thường (ghi được); mục swap realism (getter, vd `sofa`) thì giữ nguyên.
    const bundledId = Object.keys(CATALOG_MODELS).find((k) => Object.getOwnPropertyDescriptor(CATALOG_MODELS, k)?.writable === true) as string;
    const n = await loadServerLibrary(okApi([item('srv-desk-01'), item(bundledId), item('sofa')]));
    expect(n).toEqual({ count: 2, source: 'server' });
    expect(isServerModel('sofa')).toBe(false);
    expect(CATALOG_MODELS['srv-desk-01']?.dimensions).toEqual([1.2, 0.75, 0.6]);
    expect(modelSrcOf('srv-desk-01')).toBe('https://cdn.example.test/library/srv-desk-01.glb');
    expect(thumbnailOf('srv-desk-01')).toBe('https://cdn.example.test/library/srv-desk-01.webp');
    expect(isServerModel(bundledId)).toBe(true);
    expect(modelSrcOf(bundledId)).toBe(`https://cdn.example.test/library/${bundledId}.glb`);
    expect(CATALOG_MODELS[bundledId]?.dimensions).toEqual([1.2, 0.75, 0.6]);
  });

  it('ô bảng đồ Pascal chỉ cho mẫu tải về (có ghi công); nhóm → hạng mục, loại đồ, ghi công tra được', async () => {
    const withMeta = (id: string, group: string, attribution?: string) => ({
      ...item(id),
      name: `Mẫu ${id}`,
      group,
      furnitureKind: 'sanitaryFixture' as const,
      ...(attribution === undefined ? {} : { attribution }),
    });
    await loadServerLibrary(okApi([withMeta('srv-toilet', 'sanitary', 'Urpo · CC-BY 4.0'), withMeta('srv-box', 'table')] as never));
    const tiles = serverCatalogTiles();

    expect(tiles.find((tile) => tile.id === 'srv-box')).toBeUndefined();
    expect(tiles.find((tile) => tile.id === 'srv-toilet')).toMatchObject({
      category: 'bathroom',
      name: 'Mẫu srv-toilet',
      src: 'https://cdn.example.test/library/srv-toilet.glb',
      thumbnail: 'https://cdn.example.test/library/srv-toilet.webp',
      dimensions: [1.2, 0.75, 0.6],
    });
    expect(serverKindOf('srv-toilet')).toBe('sanitaryFixture');
    expect(serverAttributionOf('srv-toilet')).toBe('Urpo · CC-BY 4.0');
    expect(serverAttributionOf('srv-box')).toBeUndefined();
  });

  it('API lỗi / ném → dự phòng NGAY có lý do, danh mục đóng gói giữ nguyên', async () => {
    const before = CATALOG_MODELS['sofa'];
    const failed = await loadServerLibrary({ list: async () => ({ ok: false, error: { kind: 'timeout' } }) } as never);
    expect(failed).toEqual({ count: 0, source: 'fallback:timeout' });
    expect(libraryReadFailed(failed.source)).toBe(true);
    expect(await loadServerLibrary({ list: () => Promise.reject(new Error('offline')) } as never)).toEqual({
      count: 0,
      source: 'fallback:threw',
    });
    const empty = await loadServerLibrary(okApi([]));
    expect(empty).toEqual({ count: 0, source: 'fallback:empty' });
    expect(libraryReadFailed(empty.source)).toBe(false);
    expect(isServerModel('sofa')).toBe(false);
    expect(CATALOG_MODELS['sofa']).toBe(before);
    expect(modelSrcOf('sofa')).toMatch(/^\/items\/sofa(-ph)?\/model\.glb$/);
  });

  it('thư viện về sau 5 s → vẫn dùng mẫu máy chủ (không đua giờ riêng)', async () => {
    vi.useFakeTimers();
    try {
      const list = () =>
        new Promise((resolve) => setTimeout(() => resolve({ ok: true, data: [item('srv-slow-bed')] }), 5000));
      let settled: unknown;
      void loadServerLibrary({ list } as never).then((value) => (settled = value));
      await vi.advanceTimersByTimeAsync(3000);
      expect(settled).toBeUndefined(); // còn chờ: lượt dựng chưa được chạy
      await vi.advanceTimersByTimeAsync(2000);
      expect(settled).toEqual({ count: 1, source: 'server' });
      expect(isServerModel('srv-slow-bed')).toBe(true);
    } finally {
      vi.useRealTimers();
    }
  });
});
