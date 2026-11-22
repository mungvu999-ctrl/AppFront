/**
 * Bơm `store.spatial` (và `floors`) bằng bộ mẫu chuẩn A14, qua cửa dev.
 *
 * **Hàm này CHẠM VÀO NỘI BỘ DEV.** Nó `import('/src/store/index.ts')` ngay trong
 * trang, nên chỉ sống được trên máy chủ dev của Vite (`scripts/run-playwright.mjs`
 * chạy `vite` dev, CI cũng vậy). Bản dựng production không có đường `/src/...`.
 * Kho dời chỗ thì hàm này vỡ — và nên vỡ ồn ào. Nó là cái nạng của Q1 = A′:
 * đường nạp thật của sản phẩm chưa có, và mỗi màn dùng nó phải kèm một ca mồi
 * KHÔNG bơm (`plan.md` mục 6.1).
 *
 * Quy tắc dùng:
 * 1. Bơm SAU khi đã tới màn: `goto` -> `seedSpatial` -> khẳng định.
 * 2. (Đã hết hiệu lực từ B-V7-04, 2026-10-03.) Trước đây lượt bơm là một bước `zundo` nên
 *    `Ctrl+Z` thừa hoàn tác chính lượt bơm; nay `setSpatial` xoá lịch sử hoàn tác sau mỗi
 *    lượt nạp (`src/store/spatialSlice.ts`), nên `Ctrl+Z` trong ca có bơm là an toàn.
 * 3. Tên bài phải nói ra rằng nó bơm.
 *
 * Bơm cả `floors`: chỉ `setSpatial` thì `ExportPanel` vẫn rỗng (đo lớp 2); màn đọc
 * `floors` từ `projectSlice`. `versionId` để `null`.
 *
 * `{ projectId }` — BẮT BUỘC trên mọi route có cổng nạp kho dự án (B-V12-01: luật,
 * xuất, dữ liệu, 3D, điện thoại). Hàm chờ trong trang tới khi cổng đã nạp đúng dự án
 * ấy (`project.id === projectId`) rồi mới bơm, để lượt nạp không ghi đè lượt bơm. Nó
 * KHÔNG gọi `setProject` giả: dự án trong kho là dự án cổng đã đọc từ máy chủ.
 */
import type { Page } from '@playwright/test';

export interface SeedSpatialOptions {
  /** Dự án mà cổng nạp kho phải nạp xong trước khi bơm — xem docblock. */
  readonly projectId?: string;
  /**
   * Bơm cả "máy chủ" của bộ mẫu (`simulateServerGraph`): N15 `readGraph`/`exportGraph` trả đúng
   * đồ thị vừa bơm. Cần khi màn đọc lại đồ thị từ máy chủ thay vì từ kho — vd màn xuất lấy đồ thị
   * qua tuyến xuất có kiểm quyền (87bb47d6). Bộ mẫu dev mặc định không có tường nào.
   */
  readonly onServer?: boolean;
}

export async function seedSpatial(page: Page, options: SeedSpatialOptions = {}): Promise<void> {
  await page.evaluate(async ({ projectId, onServer }) => {
    // Biến, không chuỗi trần: TypeScript không tìm tệp ở `/src/...` trong Node.
    const load = (path: string): Promise<unknown> => import(/* @vite-ignore */ path);

    interface SeedState {
      project: { id: string } | null;
      setSpatial: (
        spatial: unknown,
        versionId: null,
        source: { projectId: string; floorRevisions: Record<string, number> },
      ) => void;
      setFloors: (floors: unknown) => void;
    }

    const store = (await load('/src/store/index.ts')) as {
      useStore: {
        getState: () => SeedState;
        subscribe: (listener: (state: SeedState) => void) => () => void;
      };
    };
    const fixture = (await load('/src/domain/spatial/__fixtures__/sampleBuilding.ts')) as {
      createSampleBuilding: () => { levels: unknown };
    };
    const normalize = (await load('/src/domain/spatial/normalize.ts')) as {
      normalizeSpatial: (graph: unknown) => unknown;
    };

    if (projectId !== undefined) {
      /* Chờ một trạng thái dương — cổng đã ghi dự án — không chờ theo đồng hồ. */
      await new Promise<void>((resolve) => {
        if (store.useStore.getState().project?.id === projectId) {
          resolve();
          return;
        }

        const unsubscribe = store.useStore.subscribe((state) => {
          if (state.project?.id === projectId) {
            unsubscribe();
            resolve();
          }
        });
      });
    }

    const graph = fixture.createSampleBuilding();

    if (onServer) {
      const mockServer = (await load('/src/api/__mocks__/client.ts')) as {
        simulateServerGraph: (graph: unknown) => void;
      };
      mockServer.simulateServerGraph(graph);
    }

    const state = store.useStore.getState();
    /* Dự án của URL (hoặc `projectId` đã chờ) và revision 0 mỗi tầng: thiếu `source` thì bộ lưu lớp không lưu. */
    const sourceProject = projectId ?? /\/(?:projects|du-an)\/([^/]+)/.exec(location.pathname)?.[1] ?? '';
    const floorRevisions = Object.fromEntries(
      (graph.levels as readonly { id: string }[]).map((level) => [level.id, 0]),
    );
    state.setSpatial(normalize.normalizeSpatial(graph), null, { floorRevisions, projectId: sourceProject });
    state.setFloors(graph.levels);
  }, { projectId: options.projectId, onServer: options.onServer === true });
}
