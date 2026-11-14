import { z } from 'zod';

import { CursorPageSchema } from './common';

/**
 * N7 — `GET /api/projects/{project_id}/drawings/uploads/latest`: lượt tải mới
 * nhất của từng tầng, để màn xử lý biết theo dõi `uploadId` nào
 * (HOP-DONG-MOI §2 N7).
 *
 * Mục sắp theo `Floor.order` là H1 ngữ cảnh, không zod.
 */

const uploadIdSchema = z.string().regex(/^upl_[0-9A-HJKMNP-TV-Z]{26}$/);

/**
 * Mã tầng: chuỗi không rỗng, không regex (HOP-DONG-MOI §0.1). Cố ý **không** gán
 * nhãn `LevelId` như `spatialGraph.ts`, `versions.ts`: `ProcessingFloorUpload.floorId`
 * là `string`, còn `LevelId` là `` `L-${string}` `` (`domain/spatial/types.ts:68`) —
 * gán nhãn là khẳng định một tiền tố mà §0.1 không đòi.
 */
const floorIdSchema = z.string().min(1);

/** `sourceImageUrl` là ảnh trang **đã nắn** (HOP-DONG-MOI §4.2), không phải tệp gốc. */
export const LatestFloorUploadSchema = z
  .object({
    floorId: floorIdSchema,
    floorName: z.string().min(1),
    sourceImageUrl: z.string().url().optional(),
    uploadId: uploadIdSchema,
  })
  .strict()
  .transform((wireUpload) => ({
    floorId: wireUpload.floorId,
    floorName: wireUpload.floorName,
    ...(wireUpload.sourceImageUrl !== undefined
      ? { sourceImageUrl: wireUpload.sourceImageUrl }
      : {}),
    uploadId: wireUpload.uploadId,
  }));

export type LatestFloorUpload = z.infer<typeof LatestFloorUploadSchema>;

/** N7. ≤ 50 tầng nên vừa một trang. */
export const LatestFloorUploadPageSchema = CursorPageSchema(LatestFloorUploadSchema);

export type LatestFloorUploadPage = z.infer<typeof LatestFloorUploadPageSchema>;

/**
 * N41 — `POST /api/projects/{project_id}/drawings/page-thumbnails` (UX41 U05):
 * ảnh nhỏ từng trang của một PDF chưa tải lên, phần tử thứ i là trang i (đếm
 * từ 0). Mỗi ảnh là `data:image/png;base64,…` — CSP `img-src` đã có `data:`.
 */
export const PageThumbnailsSchema = z
  .object({
    pages: z.array(z.string().startsWith('data:image/png;base64,')).max(20),
  })
  .strict();

export type PageThumbnails = z.infer<typeof PageThumbnailsSchema>;

/**
 * N49 — `GET …/drawings/uploads/{upload_id}/scan-results`: kết quả cuối của các bước
 * mô hình đã xong, toạ độ pixel trang đã nắn (cùng hệ `sourceImageUrl`). Bước chưa xong
 * là mảng rỗng.
 */
export const ScanResultsSchema = z
  .object({
    walls: z.array(z.object({ x1: z.number(), y1: z.number(), x2: z.number(), y2: z.number() }).strict()),
    boxes: z.array(
      z
        .object({
          label: z.string(),
          xMin: z.number(),
          yMin: z.number(),
          xMax: z.number(),
          yMax: z.number(),
        })
        .strict(),
    ),
  })
  .strict();

export type ScanResults = z.infer<typeof ScanResultsSchema>;
