import { z } from 'zod';

import { CursorPageSchema, isoInstantSchema, VersionedWriteSchema } from './common';
import { HOUSE_QUESTION_CODES, HOUSE_STOREY_LABELS, HOUSE_VIEW_KINDS } from './houseProposal';

/**
 * Bộ hồ sơ nhiều bản vẽ (Mức 3, lát cắt 2): N54–N61 dưới `/api/projects/{projectId}/drawing-sets`
 * (K-32a §3, hợp đồng đã duyệt 23-11-2026). Khác bảng đề xuất lát cắt 1 (`houseProposal.ts`, dạng
 * lỏng vì chỉ để tham khảo), đây là dây ghi và duyệt nên **strict** (L4-N07): trường lạ, mã lạ hay
 * `null` ở trường tuỳ chọn (W2: tuỳ chọn VẮNG, không `null`) đều là lỗi giải mã, không lặng lẽ bỏ.
 *
 * Máy chỉ đề xuất: không giá trị nào ở đây tự tạo tầng (luật A5); chỉ N60 tạo.
 */

export const DRAWING_SET_STATUSES = ['receiving', 'analyzing', 'review', 'confirmed', 'failed'] as const;
export type DrawingSetStatus = (typeof DRAWING_SET_STATUSES)[number];

export const DRAWING_SET_FILE_STATUSES = ['receiving', 'complete', 'rejected'] as const;
export type DrawingSetFileStatus = (typeof DRAWING_SET_FILE_STATUSES)[number];

/** Chuỗi `errorCode` của `DrawingSet` (không phải mã HTTP). */
export const DRAWING_SET_FAILURE_CODES = ['DRAWING_SET_ALL_FILES_REJECTED', 'DRAWING_SET_ANALYSIS_FAILED'] as const;

/** Mã lỗi HTTP của bộ hồ sơ (BE-00 §4). */
export const DRAWING_SET_ERROR_CODES = {
  disabled: 'DRAWING_SET_DISABLED',
  notReceiving: 'DRAWING_SET_NOT_RECEIVING',
  notReady: 'DRAWING_SET_NOT_READY',
  confirmed: 'DRAWING_SET_CONFIRMED',
  revisionStale: 'DRAWING_SET_REVISION_STALE',
  floorHasDrawing: 'FLOOR_HAS_DRAWING',
  floorIdTaken: 'FLOOR_ID_TAKEN',
  noPlan: 'DRAWING_SET_NO_PLAN',
  tooManyPages: 'DRAWING_SET_TOO_MANY_PAGES',
} as const;

/** Giới hạn của hợp đồng (K-32a §3 "Giới hạn"). Nguồn duy nhất phía FE. */
export const DRAWING_SET_LIMITS = {
  maxFiles: 20,
  maxBytes: 200 * 1024 * 1024,
  maxPagesPerPdf: 20,
  maxPages: 40,
  maxViews: 60,
  maxPlansPerConfirm: 20,
} as const;

const idSchema = z.string().min(1);
const ratio = z.number().min(0).max(1);

/** Vùng cắt: tỉ lệ của cả trang, gốc trên-trái (như `CropRect` của #5). */
export const CropRectSchema = z
  .object({ xRatio: ratio, yRatio: ratio, widthRatio: ratio, heightRatio: ratio })
  .strict();
export type CropRect = z.infer<typeof CropRectSchema>;

export const DrawingSetFileSchema = z
  .object({
    id: idSchema,
    fileName: z.string().min(1),
    sizeBytes: z.number().int().nonnegative(),
    chunkCount: z.number().int().nonnegative(),
    status: z.enum(DRAWING_SET_FILE_STATUSES),
    rejectedCode: z.string().min(1).optional(),
    pageCount: z.number().int().nonnegative().optional(),
  })
  .strict();
export type DrawingSetFile = z.infer<typeof DrawingSetFileSchema>;

export const DrawingSetQuestionSchema = z
  .object({
    code: z.enum(HOUSE_QUESTION_CODES),
    reason: z.string().min(1).optional(),
    textStoreyNo: z.number().int().optional(),
  })
  .strict();

/** Đích của một hình: tầng có sẵn, tầng mới (id `L-…` do máy khách sinh) hoặc dòng mặt cắt. */
export const ViewTargetSchema = z.discriminatedUnion('mode', [
  z.object({ mode: z.literal('floor'), floorId: idSchema, replace: z.literal(true).optional() }).strict(),
  z.object({ mode: z.literal('newFloor'), floorId: idSchema, name: z.string().min(1) }).strict(),
  z.object({ mode: z.literal('section'), name: z.string().min(1) }).strict(),
]);
export type ViewTarget = z.infer<typeof ViewTargetSchema>;

export const DrawingSetViewSchema = z
  .object({
    id: idSchema,
    fileId: idSchema,
    pageIndex: z.number().int().nonnegative(),
    crop: CropRectSchema,
    source: z.enum(['ai', 'user']),
    excluded: z.boolean(),
    imageUrl: z.string().min(1).optional(),
    kind: z.enum(HOUSE_VIEW_KINDS),
    kindConfidence: ratio,
    titleText: z.string().optional(),
    /** Số hiệu bản vẽ đọc từ khung tên (K-65); vắng khi máy không đọc được. */
    sheetNo: z.string().min(1).optional(),
    storeyLabel: z.enum(HOUSE_STOREY_LABELS).optional(),
    storeyNo: z.number().int().optional(),
    storeyConfidence: ratio.optional(),
    questions: z.array(DrawingSetQuestionSchema),
    target: ViewTargetSchema.optional(),
    uploadId: idSchema.optional(),
  })
  .strict();
export type DrawingSetView = z.infer<typeof DrawingSetViewSchema>;

/**
 * Khung tên chung của bộ (K-65): giá trị chung khi các trang khớp nhau; trang lệch thì máy chủ bỏ trường đó.
 * Mọi khoá tuỳ chọn và VẮNG khi không có (W2, không `null`); cả khoá `titleBlock` vắng khi không đọc được gì.
 */
export const DrawingSetTitleBlockSchema = z
  .object({
    owner: z.string().min(1).optional(),
    project: z.string().min(1).optional(),
    location: z.string().min(1).optional(),
    date: z.string().min(1).optional(),
  })
  .strict();
export type DrawingSetTitleBlock = z.infer<typeof DrawingSetTitleBlockSchema>;

export const DrawingSetSchema = z
  .object({
    id: idSchema,
    status: z.enum(DRAWING_SET_STATUSES),
    revision: z.number().int().nonnegative(),
    progressPercent: z.number().int().min(0).max(100),
    name: z.string().optional(),
    errorCode: z.string().min(1).optional(),
    createdAt: isoInstantSchema,
    confirmedAt: isoInstantSchema.optional(),
    titleBlock: DrawingSetTitleBlockSchema.optional(),
    files: z.array(DrawingSetFileSchema),
    views: z.array(DrawingSetViewSchema),
  })
  .strict();
export type DrawingSet = z.infer<typeof DrawingSetSchema>;

export const DrawingSetSummarySchema = z
  .object({
    id: idSchema,
    status: z.enum(DRAWING_SET_STATUSES),
    name: z.string().optional(),
    createdAt: isoInstantSchema,
    confirmedAt: isoInstantSchema.optional(),
    fileCount: z.number().int().nonnegative(),
    viewCount: z.number().int().nonnegative(),
  })
  .strict();
export type DrawingSetSummary = z.infer<typeof DrawingSetSummarySchema>;

/** N58: mới trước, trần 20, `cursor` tuỳ chọn (W22). */
export const DrawingSetSummaryPageSchema = CursorPageSchema(DrawingSetSummarySchema);
export type DrawingSetSummaryPage = z.infer<typeof DrawingSetSummaryPageSchema>;

/* -------------------------------------------------------------------------- */
/* Thân gửi đi.                                                                */
/* -------------------------------------------------------------------------- */

/** N54: 1–20 tệp; tên bộ tuỳ chọn. */
export const CreateDrawingSetSchema = z
  .object({
    name: z.string().min(1).optional(),
    files: z
      .array(
        z
          .object({ fileName: z.string().min(1), mimeType: z.string(), sizeBytes: z.number().int().positive() })
          .strict(),
      )
      .min(1)
      .max(DRAWING_SET_LIMITS.maxFiles),
  })
  .strict();
export type CreateDrawingSet = z.infer<typeof CreateDrawingSetSchema>;

/** N55: như #6 — base64, một khúc một lượt. */
export const DrawingSetChunkSchema = z.object({ chunk: z.string(), chunkIndex: z.number().int().nonnegative() }).strict();

/** `ViewEdit` = `DrawingSetView` chỉ giữ `{id?, fileId, pageIndex, crop, excluded, kind, storeyNo?, target?}`. */
export const ViewEditSchema = z
  .object({
    id: idSchema.optional(),
    fileId: idSchema,
    pageIndex: z.number().int().nonnegative(),
    crop: CropRectSchema,
    excluded: z.boolean(),
    kind: z.enum(HOUSE_VIEW_KINDS),
    storeyNo: z.number().int().optional(),
    target: ViewTargetSchema.optional(),
  })
  .strict();
export type ViewEdit = z.infer<typeof ViewEditSchema>;

/** N59: thay CẢ danh sách hình; `baseVersion` = `revision` người duyệt đã thấy (thiếu → 428). */
export const ReplaceViewsSchema = VersionedWriteSchema(
  z.object({ views: z.array(ViewEditSchema).max(DRAWING_SET_LIMITS.maxViews) }).strict(),
);
export type ReplaceViews = z.infer<typeof ReplaceViewsSchema>;

/** N60: `{setId, revision}` (C21). */
export const ConfirmDrawingSetSchema = z.object({ setId: idSchema, revision: z.number().int().nonnegative() }).strict();
export type ConfirmDrawingSet = z.infer<typeof ConfirmDrawingSetSchema>;
