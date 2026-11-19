import { z } from 'zod';

/**
 * Đề xuất cho cả nhà (Mức 3, lát cắt 1): `GET /api/projects/{projectId}/house-proposal`
 * (docs/muc-3-lat-cat-1-tich-hop.md mục 3).
 *
 * W2: trường tuỳ chọn VẮNG khi chưa biết, không `null` — `.optional()` chứ không `.nullish()`.
 * Máy chỉ đề xuất; không giá trị nào ở đây tự ghi vào tầng (luật A5).
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

const confidenceSchema = z.number().min(0).max(1);

export const HouseQuestionSchema = z.object({ code: z.enum(HOUSE_QUESTION_CODES) }).strict();

export const HouseFloorProposalSchema = z
  .object({
    floorId: z.string().min(1),
    kind: z.enum(HOUSE_VIEW_KINDS),
    kindConfidence: confidenceSchema,
    storeyLabel: z.enum(HOUSE_STOREY_LABELS).optional(),
    storeyNo: z.number().int().optional(),
    storeyConfidence: confidenceSchema,
    // Khoảng của `FloorRow` phía BE: cốt −30000…300000 mm, chiều cao 2000…10000 mm.
    elevationMm: z.number().int().min(-30000).max(300000).optional(),
    elevationConfidence: confidenceSchema.optional(),
    elevationSource: z.enum(HOUSE_LEVEL_SOURCES).optional(),
    heightMm: z.number().int().min(2000).max(10000).optional(),
    heightConfidence: confidenceSchema.optional(),
    heightSource: z.enum(HOUSE_LEVEL_SOURCES).optional(),
    questions: z.array(HouseQuestionSchema),
  })
  .strict();

export type HouseFloorProposal = z.infer<typeof HouseFloorProposalSchema>;

export const HouseProposalSchema = z
  .object({
    floors: z.array(HouseFloorProposalSchema),
    runIds: z.array(z.string().min(1)),
  })
  .strict();

export type HouseProposal = z.infer<typeof HouseProposalSchema>;
