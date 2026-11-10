// @vitest-environment node
/**
 * S1 vòng 8 — giả thuyết H1 (cảnh thiếu lớp bày đồ khi CPU bận): `main.tsx` cho Pascal dựng cảnh khi
 * `loadServerLibrary` trả về, mà hàm ấy trả 0 sau `timeoutMs` (3 s) trong khi lượt `GET /library` VẪN CHẠY và
 * đăng ký mẫu SAU ĐÓ. Lượt dựng đầu chọn mẫu theo danh mục lúc ấy (`sceneVariety.libraryModelOf` lọc `isServerModel`),
 * không lượt nào dựng lại khi thư viện về trễ. Bài này chứng minh nửa "danh mục đổi sau khi boot đã qua".
 */
import { describe, expect, it, vi } from 'vitest';

import { isServerModel } from '@/lib/pascal/furnitureCatalog';
import { loadServerLibrary } from '@/lib/pascal/serverLibrary';

describe('thư viện máy chủ về trễ (H1)', () => {
  it('quá 3 s: boot nhận 0 mẫu, rồi mẫu vẫn được đăng ký sau đó — cảnh đã dựng không biết', async () => {
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
      const boot = loadServerLibrary({ list } as never);
      await vi.advanceTimersByTimeAsync(3000);
      await expect(boot).resolves.toBe(0);
      expect(isServerModel(id)).toBe(false); // lượt dựng đầu chạy ở đây: không có mẫu máy chủ
      await vi.advanceTimersByTimeAsync(2000);
      expect(isServerModel(id)).toBe(true); // danh mục đổi SAU lượt dựng, không ai dựng lại
    } finally {
      vi.useRealTimers();
    }
  });
});
