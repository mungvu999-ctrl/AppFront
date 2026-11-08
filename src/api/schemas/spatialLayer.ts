import { z } from 'zod';

import { VersionedWriteSchema } from './common';
import { AxisSchema, DimensionSchema, LevelSchema, SpatialLayerSchema } from './spatial';
import { floorSuggestionsShape, SuggestionStateRowSchema } from './suggestions';

/**
 * `GET` và `PUT /api/projects/{project_id}/floors/{floor_id}/spatial/layer` —
 * lớp không gian của **một** tầng, là thứ sáu màn QC đọc và là thứ duy nhất
 * chúng ghi.
 *
 * ## Bọc `SpatialLayerSchema`, không `.extend()` nó
 *
 * `SpatialLayerSchema` (`./spatial.ts:306`) khai kiểu trả về là
 * `z.ZodType<SpatialLayerShape>`, và `ZodType` không có `.extend()` — chỉ
 * `ZodObject` mới có. Gỡ lời khai ấy ra để `.extend()` được thì mất luôn phép
 * kiểm mà nó tồn tại để giữ: thêm một trường bắt buộc vào `SpatialLayer` mà
 * quên sửa schema sẽ hết đỏ lúc `pnpm typecheck`.
 *
 * Nên tài liệu tầng **chứa** lớp trong một trường `layer` thay vì trải nó ra.
 * Hình dạng ấy cũng đúng hơn về nghiệp vụ: `revision`, `level` và `scaleStatus`
 * nói về *tầng*, còn bốn danh sách nói về *nội dung vẽ trên tầng* — trộn chín
 * khoá vào một mặt phẳng thì chỗ đọc không còn phân biệt được hai chuyện.
 *
 * ## `scaleStatus` chỉ có một giá trị, và đó là chủ ý
 *
 * Trên dây chỉ tồn tại `'unresolved'`, nghĩa là "tầng này có một tỉ lệ, nhưng
 * nó do pipeline suy ra hoặc lấy từ mặc định của dự án, chưa ai xác nhận".
 * Tầng đã hiệu chỉnh thì **vắng hẳn** khoá này — không phải mang một giá trị
 * `'resolved'` nào đó. Lý do là W2: vắng trường, không `null`, và cũng không
 * một giá trị canh gác. `SCALE_UNRESOLVED` mà pipeline dùng là mã **nội bộ**
 * của nó, không bao giờ lên dây (HOP-DONG-MOI §4.2).
 *
 * Hệ quả cho `ScaleCalibration`: nó coi tỉ lệ của một tầng `unresolved` là
 * `null`, tức chưa hiệu chỉnh (`screens/pipeline/ScaleCalibration/useScaleCalibration.ts:515-523`).
 *
 * ## Ghi: hai trường, cả hai tuỳ chọn, và ít nhất một phải có
 *
 * `PUT` nhận `layer`, hoặc tỉ lệ, hoặc cả hai. Cả hai cùng vắng là một request
 * rỗng — nó sẽ tiêu một `baseVersion`, sinh một `revision` mới và không đổi gì,
 * nên nó bị `.refine()` chặn ngay ở biên giới thay vì đi hết một vòng mạng.
 *
 * Đó cũng là lý do `FloorLayerWriteBodySchema` được nhét vào
 * `VersionedWriteSchema` **sau khi** đã refine: `zod` gắn tiền tố đường dẫn của
 * cha vào mọi issue của con, nên vi phạm ấy hiện ra ở `['body']` của thân ngoài
 * — đúng chỗ người đọc lỗi đang đứng.
 */

/** Số hiệu bản ghi của tài liệu tầng. */
const revisionSchema = z.number().int().nonnegative();

/**
 * Tỉ lệ bản vẽ mà người dùng vừa hiệu chỉnh, mm trên mỗi pixel của trang đã nắn.
 *
 * Không nhận nhãn `MillimetresPerPixel` ở đây, khác `LevelSchema`: đây là schema
 * **gửi đi**, và HOP-DONG-MOI §0 nói schema gửi chỉ `.strict()` — không
 * `.transform()`, nên không có chỗ nào để gán nhãn. Nhãn là chuyện của đường
 * đọc, nơi một số lạ mới thật sự đi vào ứng dụng.
 */
const scaleMillimetresPerPixelSchema = z.number().positive().finite();

/**
 * Thân `GET`: `revision`, siêu dữ liệu tầng, lớp vẽ, trục và kích thước.
 *
 * `axes` là `[]` ở v1 và `dimensions` chỉ để đọc — nhưng cả hai vẫn **bắt
 * buộc** có mặt, cùng lý do với `SpatialGraphSchema`: danh sách rỗng trả lời
 * được "chưa có", khoá vắng thì không.
 *
 * `notes` **không** ở đây, khác `SpatialGraphSchema`: không màn QC nào đọc ghi
 * chú, và W1 nói cái gì không màn nào cần thì không lên dây.
 */
/** Gốc toạ độ của tầng (mm nguyên); máy chủ trả `null` hoặc bỏ khoá khi chưa đặt (#35/N16, G4b-17). */
export const FloorOriginSchema = z.object({ x: z.number().int(), y: z.number().int() }).strict();

/** Lý do tầng chưa sẵn sàng (N16 `readiness.reasons`). */
export const ReadinessReasonSchema = z.enum([
  'scaleUnresolved',
  'criticalIssues',
  /** Kiểm hình học critical của lượt mới nhất (mã ở `readiness.checks`); `criticalIssues` giữ cho lỗi toàn vẹn dữ liệu. */
  'geometrySuspect',
  'fallbackWallModel',
  'fallbackObjectModel',
  'fallbackTextModel',
]);

/** Độ sẵn sàng của tầng do máy chủ đánh giá (FIX-P0-10); vắng = chưa có BE mới. */
export const ReadinessSchema = z
  .object({
    state: z.enum(['ready', 'needsReview', 'notEvaluated']),
    reasons: z.array(ReadinessReasonSchema),
    /**
     * Mã các kiểm hình học critical (`OPEN_ENVELOPE`, `MULTIPLE_PLANS`…), thứ tự máy chủ giữ cố định.
     * Chuỗi tự do, không enum: mã mới của BE không được làm vỡ cả tài liệu tầng — màn hiện câu chung.
     */
    checks: z.array(z.string().min(1)).optional(),
  })
  .strict()
  .transform(({ checks, ...readiness }) => ({
    ...readiness,
    ...(checks !== undefined && checks.length > 0 ? { checks } : {}),
  }));

export type FloorReadiness = z.infer<typeof ReadinessSchema>;
export type ReadinessReason = z.infer<typeof ReadinessReasonSchema>;

/**
 * Tỉ lệ của tầng lấy từ đâu: `chain`/`paired`/`note` đọc từ số trên bản vẽ; `door`/`wallThickness`/`default`
 * là ước lượng (nên hiệu chỉnh); `human` = người đặt.
 */
export const ScaleBasisSchema = z.enum(['chain', 'paired', 'note', 'door', 'wallThickness', 'default', 'human']);

export type ScaleBasis = z.infer<typeof ScaleBasisSchema>;

export const FloorLayerDocumentSchema = z
  .object({
    axes: z.array(AxisSchema),
    origin: FloorOriginSchema.nullish(),
    readiness: ReadinessSchema.optional(),
    dimensions: z.array(DimensionSchema),
    layer: SpatialLayerSchema,
    level: LevelSchema,
    revision: revisionSchema,
    scaleStatus: z.literal('unresolved').optional(),
    scaleBasis: ScaleBasisSchema.optional(),
    /** Nguồn tỉ lệ tạm, chỉ đi cùng `scaleStatus`: `project_default` = máy không đo được (UX-R1 K12). */
    scaleSource: z.enum(['pipeline', 'project_default']).optional(),
    /** Tỷ lệ máy ước từ độ dày tường (mm/px), để người dùng xác nhận khi chưa có tỷ lệ (UX-R2). */
    suggestedScaleMmPerPx: scaleMillimetresPerPixelSchema.optional(),
    /** DPI của ảnh máy đã xử lý khi biết (PDF dựng ở DPI nào); `null`/vắng = không biết. Có thì nhập thẳng 1:N (U01). */
    sourceDpi: z.number().positive().finite().nullish(),
    /** M2 — lớp đề xuất của tầng; vắng khi rỗng (hợp đồng M2 §2.1). */
    ...floorSuggestionsShape,
  })
  .strict()
  .refine(
    (document) =>
      document.scaleStatus === undefined || document.level.scaleMillimetresPerPixel !== undefined,
    { path: ['level', 'scaleMillimetresPerPixel'] },
  )
  .refine((document) => document.scaleSource === undefined || document.scaleStatus !== undefined, {
    path: ['scaleSource'],
  })
  .transform((wireDocument) => ({
    axes: wireDocument.axes,
    dimensions: wireDocument.dimensions,
    layer: wireDocument.layer,
    level: wireDocument.level,
    revision: wireDocument.revision,
    ...(wireDocument.origin != null ? { origin: wireDocument.origin } : {}),
    ...(wireDocument.readiness !== undefined ? { readiness: wireDocument.readiness } : {}),
    ...(wireDocument.scaleStatus !== undefined ? { scaleStatus: wireDocument.scaleStatus } : {}),
    ...(wireDocument.scaleBasis !== undefined ? { scaleBasis: wireDocument.scaleBasis } : {}),
    ...(wireDocument.scaleSource !== undefined ? { scaleSource: wireDocument.scaleSource } : {}),
    ...(wireDocument.suggestedScaleMmPerPx !== undefined
      ? { suggestedScaleMmPerPx: wireDocument.suggestedScaleMmPerPx }
      : {}),
    ...(wireDocument.sourceDpi != null ? { sourceDpi: wireDocument.sourceDpi } : {}),
    ...(wireDocument.suggestions !== undefined && wireDocument.suggestions.length > 0
      ? { suggestions: wireDocument.suggestions }
      : {}),
    ...(wireDocument.suggestionsMeta !== undefined ? { suggestionsMeta: wireDocument.suggestionsMeta } : {}),
    ...(wireDocument.suggestionsEnabled === true ? { suggestionsEnabled: true as const } : {}),
  }));

export type FloorLayerDocument = z.infer<typeof FloorLayerDocumentSchema>;

/**
 * Thân `PUT` trước khi bọc version: lớp mới, tỉ lệ mới, hoặc cả hai.
 *
 * Gửi cả hai thì `layer` được hiểu ở hệ tỉ lệ **cũ** và máy chủ tính lại —
 * nên "áp tỉ lệ cho mọi tầng" không phải gửi trọn lớp của từng tầng
 * (HOP-DONG-MOI §4, #35).
 */
export const FloorLayerWriteBodySchema = z
  .object({
    /** Thay CẢ danh sách trục đã lưu (`[]` xoá hết); vắng = không đụng (G4b-17). */
    axes: z.array(AxisSchema).optional(),
    /** Thay CẢ danh sách kích thước đã lưu (`[]` xoá hết); vắng = không đụng. `reviewed` chỉ khi `source === 'human'`. */
    dimensions: z.array(DimensionSchema).optional(),
    origin: FloorOriginSchema.optional(),
    layer: SpatialLayerSchema.optional(),
    scaleMillimetresPerPixel: scaleMillimetresPerPixelSchema.optional(),
    /**
     * M2 — trạng thái THƯA của lớp đề xuất cả tầng (`state ≠ active` hoặc có `override`); chỉ gửi khi bẩn.
     * Máy chủ bỏ qua `params`/`stale` client gửi; id lạ → 422 (hợp đồng M2 §4). Máy chủ chưa có thì 422 `VALIDATION`.
     */
    suggestionState: z.array(SuggestionStateRowSchema).optional(),
    /** M2 — bật/tắt lớp đề xuất của tầng (§8 quyết định 1); bật lại thì máy chủ chạy `reconcile` ngay lượt này. */
    suggestionsEnabled: z.boolean().optional(),
  })
  .strict()
  .refine(
    /*
     * Đếm **giá trị**, không đếm khoá.
     *
     * `Object.keys(body).length > 0` trông tương đương và không phải: `zod` 3
     * giữ lại khoá nào **có mặt** trên đầu vào, kể cả khi giá trị là
     * `undefined` (`alwaysSet`). Nên `{ layer: undefined }` có một khoá, lọt
     * refine, rồi `JSON.stringify` gửi đi đúng `{}` — chính cái request rỗng mà
     * refine này tồn tại để chặn. Một vòng mạng, một `baseVersion` bị tiêu, một
     * `revision` mới, không đổi gì.
     */
    (body) =>
      body.layer !== undefined ||
      body.scaleMillimetresPerPixel !== undefined ||
      body.dimensions !== undefined ||
      body.axes !== undefined ||
      body.origin !== undefined ||
      body.suggestionState !== undefined ||
      body.suggestionsEnabled !== undefined,
    { path: [] },
  );

export type FloorLayerWriteBody = z.infer<typeof FloorLayerWriteBodySchema>;

/** Thân `PUT` đầy đủ: `{baseVersion, body}`. */
export const FloorLayerWriteSchema = VersionedWriteSchema(FloorLayerWriteBodySchema);

export type FloorLayerWrite = z.infer<typeof FloorLayerWriteSchema>;

/**
 * Phản hồi của `PUT`: bản đã lưu, cộng `revision` mới.
 *
 * `layer` trả về là **nguồn thay kho** của F-04b, không phải một lời xác nhận
 * để bỏ đi: máy chủ tính lại `Room.areaM2` từ `outline` (W18) và quy đổi lại mm
 * cho mọi thực thể chưa duyệt khi tỉ lệ đổi, nên bản nó gửi về khác bản client
 * vừa gửi lên.
 */
export const FloorLayerWriteResultSchema = z
  .object({
    layer: SpatialLayerSchema,
    revision: revisionSchema,
    /** M2 — lớp đề xuất sau `reconcile` của chính lượt ghi (cùng `revision`); vắng = máy chủ chưa có M2 hoặc rỗng. */
    ...floorSuggestionsShape,
  })
  .strict();

export type FloorLayerWriteResult = z.infer<typeof FloorLayerWriteResultSchema>;
