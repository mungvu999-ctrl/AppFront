import { z } from 'zod';

import { HOUSE_ELEVATION_RANGE_MM, HOUSE_HEIGHT_RANGE_MM, HouseFloorProposalSchema } from './houseProposal';

/**
 * Đề xuất ngôi nhà của một bộ hồ sơ (NHA-06): phản hồi của `GET …/drawing-sets/{setId}/building` và thân
 * `building` mà N59 nhận. Đây là dây duyệt nên **strict** như `drawingSet.ts` (trường lạ, mã nguồn lạ hay
 * `null` ở trường tuỳ chọn là lỗi giải mã); riêng `floors` giải lỏng bằng schema của bảng N52 vì đó là giá
 * trị máy để tham khảo.
 *
 * Mỗi giá trị là một `Measured`: kèm độ tin, nguồn và các hình nó được đọc ra. `levels` là cốt và chiều cao
 * **đang hiệu lực** (số người duyệt nhập > nguồn họ chọn > máy). `violations[].key` do máy chủ phát: đánh dấu
 * "Đã xem" là gửi lại **nguyên văn** khoá đó trong `seen`, không tự ghép.
 */

export const BUILDING_SOURCES = [
  'reviewer',
  'plan+section',
  'roofPlan',
  'section',
  'elevation',
  'plan',
  'convention',
  'default',
] as const;
export type BuildingSource = (typeof BUILDING_SOURCES)[number];

export const BUILDING_RULE_LEVELS = ['error', 'warning', 'hint'] as const;
export const BUILDING_ROOF_FORMS = ['flat', 'shed', 'gable', 'hip'] as const;
export const BUILDING_ROOF_MATERIALS = ['tile', 'metal', 'shingle'] as const;

/** Giới hạn của thân `building` (BE `set_schemas.py`). Nguồn duy nhất phía FE. */
export const BUILDING_LIMITS = {
  maxDecisions: 60,
  maxPicks: 120,
  maxRefLength: 64,
  maxSeen: 500,
  maxKeyLength: 256,
  maxPickKeyLength: 96,
  maxRoofMm: 5000,
  maxPitchDeg: 85,
  maxQuarterTurns: 3,
} as const;

const idSchema = z.string().min(1);
const unit = z.number().min(0).max(1);
const scalar = z.union([z.number(), z.string().min(1)]);
const intIn = (range: { readonly min: number; readonly max: number }) => z.number().int().min(range.min).max(range.max);
const roofMm = z.number().int().min(0).max(BUILDING_LIMITS.maxRoofMm);
/** Chuỗi gửi đi không mang ký tự điều khiển (BE từ chối 422; JSONB của Postgres không lưu được `\u0000`). */
const isPrintable = (text: string): boolean => [...text].every((char) => char >= ' ' && char !== '\u007f');
const sentKey = (maxLength: number) => z.string().min(1).max(maxLength).refine(isPrintable);
const decisionRef = sentKey(BUILDING_LIMITS.maxRefLength);

export const MeasuredSchema = z
  .object({ value: scalar, confidence: unit, source: z.enum(BUILDING_SOURCES), viewIds: z.array(idSchema) })
  .strict();
export type Measured = z.infer<typeof MeasuredSchema>;

/** Mái đề xuất cho tầng có hình đại diện `levelRef`; cốt diềm vắng khi tầng chưa có cốt. */
export const RoofSpecSchema = z
  .object({
    levelRef: idSchema,
    form: MeasuredSchema,
    pitchDeg: MeasuredSchema,
    quarterTurns: MeasuredSchema,
    eaveElevationMm: MeasuredSchema.optional(),
    overhangMm: MeasuredSchema,
    ridgeElevationMm: MeasuredSchema.optional(),
    parapetMm: MeasuredSchema.optional(),
    material: MeasuredSchema.optional(),
  })
  .strict();
export type RoofSpec = z.infer<typeof RoofSpecSchema>;

/** Hai nguồn của một trường lệch nhau; `chosenSource` vắng = người duyệt chưa chọn. */
export const BuildingConflictSchema = z
  .object({
    key: idSchema,
    field: z.enum(['elevationMm', 'pitchDeg']),
    candidates: z.array(MeasuredSchema).min(2),
    chosenSource: z.enum(BUILDING_SOURCES).optional(),
  })
  .strict();
export type BuildingConflict = z.infer<typeof BuildingConflictSchema>;

export const RuleHitSchema = z
  .object({
    key: z.string().min(1).max(BUILDING_LIMITS.maxKeyLength),
    code: z.string().regex(/^[TM]-\d{2}$/u),
    level: z.enum(BUILDING_RULE_LEVELS),
    floorRefs: z.array(idSchema),
    values: z.array(scalar),
  })
  .strict();
export type RuleHit = z.infer<typeof RuleHitSchema>;

export const LevelSpecSchema = z
  .object({ levelRef: idSchema, elevationMm: MeasuredSchema.optional(), heightMm: MeasuredSchema.optional() })
  .strict();
export type LevelSpec = z.infer<typeof LevelSpecSchema>;

export const BuildingProposalSchema = z
  .object({
    unitSystem: MeasuredSchema,
    floors: z.array(HouseFloorProposalSchema),
    levels: z.array(LevelSpecSchema),
    roofs: z.array(RoofSpecSchema),
    conflicts: z.array(BuildingConflictSchema),
    violations: z.array(RuleHitSchema),
  })
  .strict();
export type BuildingProposal = z.infer<typeof BuildingProposalSchema>;

/* -------------------------------------------------------------------------- */
/* Quyết định của người duyệt: cùng một hình dạng cho phản hồi và cho thân N59. */
/* -------------------------------------------------------------------------- */

export const LevelDecisionSchema = z
  .object({
    levelRef: decisionRef,
    elevationMm: intIn(HOUSE_ELEVATION_RANGE_MM).optional(),
    heightMm: intIn(HOUSE_HEIGHT_RANGE_MM).optional(),
  })
  .strict();
export type LevelDecision = z.infer<typeof LevelDecisionSchema>;

/** `skip` = "không dựng mái, tôi tự vẽ". */
export const RoofDecisionSchema = z
  .object({
    levelRef: decisionRef,
    skip: z.boolean(),
    form: z.enum(BUILDING_ROOF_FORMS).optional(),
    pitchDeg: z.number().min(0).lt(BUILDING_LIMITS.maxPitchDeg).optional(),
    quarterTurns: z.number().int().min(0).max(BUILDING_LIMITS.maxQuarterTurns).optional(),
    eaveElevationMm: intIn(HOUSE_ELEVATION_RANGE_MM).optional(),
    ridgeElevationMm: intIn(HOUSE_ELEVATION_RANGE_MM).optional(),
    overhangMm: roofMm.optional(),
    parapetMm: roofMm.optional(),
    material: z.enum(BUILDING_ROOF_MATERIALS).optional(),
  })
  .strict();
export type RoofDecision = z.infer<typeof RoofDecisionSchema>;

/** Thay CẢ bản đã lưu. `picks`: khoá mâu thuẫn → nguồn đã chọn; `seen`: khoá các cảnh báo đã xem. */
export const BuildingDecisionsSchema = z
  .object({
    levels: z.array(LevelDecisionSchema).max(BUILDING_LIMITS.maxDecisions),
    roofs: z.array(RoofDecisionSchema).max(BUILDING_LIMITS.maxDecisions),
    picks: z
      .record(sentKey(BUILDING_LIMITS.maxPickKeyLength), z.enum(BUILDING_SOURCES))
      .refine((picks) => Object.keys(picks).length <= BUILDING_LIMITS.maxPicks),
    seen: z.array(sentKey(BUILDING_LIMITS.maxKeyLength)).max(BUILDING_LIMITS.maxSeen),
  })
  .strict();
export type BuildingDecisions = z.infer<typeof BuildingDecisionsSchema>;

/** `proposal` vắng khi công tắc tắt hoặc bộ chưa đọc xong; `decisions` vắng khi chưa ai gửi quyết định. */
export const SetBuildingSchema = z
  .object({
    enabled: z.boolean(),
    proposal: BuildingProposalSchema.optional(),
    decisions: BuildingDecisionsSchema.optional(),
  })
  .strict();
export type SetBuilding = z.infer<typeof SetBuildingSchema>;
