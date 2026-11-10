// @vitest-environment node
/**
 * S1/S2 vòng 8 — H1 (đã chứng minh trên trình duyệt, ca ch-10): `loadServerLibrary` từng đua 3 s và trả 0 trong khi
 * `GET /library` vẫn chạy, nên lượt dựng đầu dùng danh mục đóng gói rồi mẫu máy chủ về sau, không ai dựng lại.
 * Nay nó chờ đúng kết quả lượt đọc: boot (lượt dựng đầu) chỉ chạy khi danh mục đã là danh mục cuối.
 */
import { describe, expect, it, vi } from 'vitest';

import { isServerModel } from '@/lib/pascal/furnitureCatalog';
import { loadServerLibrary } from '@/lib/pascal/serverLibrary';

describe('thư viện máy chủ về trễ (H1)', () => {
  it('về sau 5 s: boot chờ, lượt dựng đầu đã thấy mẫu máy chủ', async () => {
    vi.useFakeTimers();
    try {
      const id = 's1-late-wardrobe';
      const list = vi.fn(
        () =>
          new Promise<{ ok: true; data: unknown[] }>((resolve) =>
            setTimeout(
              () =>
                resolve({
                  ok: true,
                  data: [{ id, modelUrl: '/x.glb', widthMm: 1800, heightMm: 2200, depthMm: 600, furnitureKind: 'wardrobe' }],
                }),
              5000,
            ),
          ),
      );
      let booted: unknown;
      void loadServerLibrary({ list } as never).then((value) => (booted = value));
      await vi.advanceTimersByTimeAsync(3000);
      expect(booted).toBeUndefined(); // chưa boot: không có lượt dựng với danh mục tạm
      await vi.advanceTimersByTimeAsync(2000);
      expect(booted).toEqual({ count: 1, source: 'server' });
      expect(isServerModel(id)).toBe(true); // lượt dựng đầu chạy ở đây, đã có mẫu máy chủ
    } finally {
      vi.useRealTimers();
    }
  });
});
