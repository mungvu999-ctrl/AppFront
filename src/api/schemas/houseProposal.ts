import { z } from 'zod';

/**
 * Đề xuất cho cả nhà (Mức 3, lát cắt 1): `GET /api/projects/{projectId}/house-proposal`
 * (docs/muc-3-lat-cat-1-tich-hop.md mục 3). Luôn 200; tính năng tắt = `{enabled: false, floors: [], runIds: []}`.
 *
 * Bảng đề xuất là phần phụ, chỉ để tham khảo: một trường hay một mã mới phía BE không được làm
 * màn Quản lý tầng báo lỗi. Vì vậy:
 * - đối tượng KHÔNG `.strict()` (trường lạ bị bỏ). R-08 chỉ đòi giải bằng zod; cổng hợp đồng
 *   (`AppBack/tools/contract/schema-map.ts`) chưa kiểm điểm cuối này, và khi thêm vào thì dùng bản
 *   strict riêng của harness như `auth_refresh` (W16);
 * - mã câu hỏi, loại bản vẽ, nhãn tầng, nguồn số đọc là CHUỖI; viewmodel chuẩn hoá (mã lạ bị bỏ
 *   và được đếm, nguồn lạ không bao giờ nhận được, nhãn lạ thành "Chưa rõ tầng");
 * - số ngoài khoảng chỉ bỏ số đó (`.catch`), dòng vẫn còn.
 *
 * W2: trường tuỳ chọn VẮNG khi chưa biết, không `null`. Máy chỉ đề xuất; không giá trị nào ở đây tự
 * ghi vào tầng (luật A5).
 */
export const HOUSE_VIEW_KINDS = ['plan', 'section', 'elevation', 'roof', 'site', 'detail', 'other'] as const;
export type HouseViewKind = (typeof HOUSE_VIEW_KINDS)[number];

export const HOUSE_STOREY_LABELS = ['ground', 'basement', 'mezzanine', 'attic', 'roof_terrace', 'floor'] as const;
export type HouseStoreyLabel = (typeof HOUSE_STOREY_LABELS)[number];

export const HOUSE_LEVEL_SOURCES = ['plan', 'plan+section', 'section', 'dims', 'convention', 'default'] as const;
export type HouseLevelSource = (typeof HOUSE_LEVEL_SOURCES)[number];

export const HOUSE_QUESTION_CODES = [
  'STOREY_UNSURE',
  'STOREY_CONFLICT',
  'ORDER_DIFFERS',
  'LEVEL_MISSING',
  'HEIGHT_ASSUMED',
  'NOT_A_PLAN',
  'NO_TEXT',
] as const;
export type HouseQuestionCode = (typeof HOUSE_QUESTION_CODES)[number];

/** Khoảng của `FloorRow` phía BE: cốt −30000…300000 mm, chiều cao 2000…10000 mm. */
export const HOUSE_ELEVATION_RANGE_MM = { min: -30000, max: 300000 } as const;
export const HOUSE_HEIGHT_RANGE_MM = { min: 2000, max: 10000 } as const;

/** Số ngoài khoảng (hoặc sai kiểu) thì bỏ, không làm hỏng cả câu trả lời. */
const optionalIntIn = (range: { readonly min: number; readonly max: number }) =>
  z.number().int().min(range.min).max(range.max).optional().catch(undefined);
const optionalConfidence = z.number().min(0).max(1).optional().catch(undefined);
/** Độ chắc bắt buộc mà hỏng: coi là 0 (không biết thì không tin). */
const confidence = z.number().min(0).max(1).catch(0);
const optionalText = z.string().optional().catch(undefined);

export const HouseQuestionSchema = z.object({ code: z.string() });

export const HouseFloorProposalSchema = z.object({
  floorId: z.string().min(1),
  kind: z.string(),
  kindConfidence: confidence,
  storeyLabel: optionalText,
  storeyNo: z.number().int().optional().catch(undefined),
  storeyConfidence: confidence,
  elevationMm: optionalIntIn(HOUSE_ELEVATION_RANGE_MM),
  elevationConfidence: optionalConfidence,
  elevationSource: optionalText,
  heightMm: optionalIntIn(HOUSE_HEIGHT_RANGE_MM),
  heightConfidence: optionalConfidence,
  heightSource: optionalText,
  questions: z.array(HouseQuestionSchema),
});

export type HouseFloorProposal = z.infer<typeof HouseFloorProposalSchema>;

export const HouseProposalSchema = z.object({
  enabled: z.boolean(),
  floors: z.array(HouseFloorProposalSchema),
  runIds: z.array(z.string().min(1)),
});

export type HouseProposal = z.infer<typeof HouseProposalSchema>;

/** Tính năng tắt (`enabled: false`) → `null`: bảng ẩn. Dùng chung cho client thật và mock. */
export const houseProposalOrNull = (proposal: HouseProposal): HouseProposal | null =>
  proposal.enabled ? proposal : null;

/** Hình câu trả lời khi công tắc `DRAWING_SET_ENABLED` tắt. */
export const HOUSE_PROPOSAL_OFF: HouseProposal = { enabled: false, floors: [], runIds: [] };
