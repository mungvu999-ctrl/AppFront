import { z } from 'zod';

import { materialRefSchema } from './spatial';

/**
 * M2 — lớp đề xuất của một tầng (`suggestions` + `suggestionsMeta` trong tài liệu tầng), mirror của
 * AppBack `packages/domain/suggestions/model.py`. Hợp đồng: `docs/mo-hinh-dep-chuyen-nghiep/M2/
 * HOP-DONG-DU-LIEU-LOP-DE-XUAT.md` §2 (ngoài repo, `F:/App/docs/…`).
 *
 * Mọi đối tượng `.strict()`, camelCase, khoá tuỳ chọn vắng (không `null`) như lớp không gian.
 * Người dùng chỉ sở hữu `state` + `override`; phần còn lại máy chủ sinh.
 */

export const SUGGESTION_ID_PATTERN = /^DRESS-[A-Za-z0-9_.:-]{1,160}$/;
/** Trần khoá `override` của một bản ghi (AppBack `OVERRIDE_MAX`). */
const OVERRIDE_MAX = 16;

const suggestionIdSchema = z.string().regex(SUGGESTION_ID_PATTERN);
const entityIdSchema = z.string().min(1);
const mm = z.number().finite();
const positiveMm = z.number().positive().finite();
const nonNegativeMm = z.number().nonnegative().finite();
const spanSchema = z.tuple([nonNegativeMm, nonNegativeMm]);
const pointSchema = z.object({ x: mm, y: mm }).strict();
const textSchema = z.string().min(1);
const rotationSchema = z.number().nonnegative().lt(360);

export const SuggestionStateSchema = z.enum(['active', 'disabled', 'overridden', 'adopted']);
export type SuggestionState = z.infer<typeof SuggestionStateSchema>;

const side = z.enum(['left', 'right']);

export const SkirtingParamsSchema = z
  .object({ side, spansMm: z.array(spanSchema), heightMm: positiveMm, thicknessMm: positiveMm, material: materialRefSchema })
  .strict();
export const WallTileParamsSchema = z
  .object({
    side,
    spansMm: z.array(spanSchema),
    /** `(from, to, topMm)`: dưới cửa sổ, ốp từ sàn tới bậu. */
    sillSpansMm: z.array(z.tuple([nonNegativeMm, nonNegativeMm, positiveMm])).optional(),
    heightMm: positiveMm,
    thicknessMm: positiveMm,
    tileMm: positiveMm,
    material: materialRefSchema,
  })
  .strict();
export const CorniceParamsSchema = z
  .object({ heightMm: positiveMm, depthMm: positiveMm, material: materialRefSchema.optional() })
  .strict();
export const CasingParamsSchema = z
  .object({ widthMm: positiveMm, thicknessMm: positiveMm, material: materialRefSchema })
  .strict();
export const SashParamsSchema = z.object({ frameWidthMm: positiveMm, frameDepthMm: positiveMm }).strict();
export const RailingParamsSchema = z
  .object({
    edgeIndex: z.number().int().nonnegative(),
    start: pointSchema,
    end: pointSchema,
    spansMm: z.array(spanSchema),
    heightMm: positiveMm,
    handrailMm: positiveMm,
    glassMm: positiveMm,
    postSpacingMaxMm: positiveMm,
    metalMaterial: materialRefSchema,
    glassMaterial: materialRefSchema,
  })
  .strict();
export const CabinetRunParamsSchema = z
  .object({
    slot: z.enum(['base', 'upper']),
    /** Đường lưng (sát tường) `start → end`; dãy nằm phía pháp tuyến trái (−dy, dx), sâu `depthMm`. */
    start: pointSchema,
    end: pointSchema,
    lengthMm: positiveMm,
    depthMm: positiveMm,
    bottomMm: nonNegativeMm,
    topMm: positiveMm,
    moduleMm: positiveMm,
    material: materialRefSchema.optional(),
    countertopMaterial: materialRefSchema.optional(),
    /** Hộp trùng gộp vào dãy này: mẫu của chúng cũng không dựng. */
    mergedIds: z.array(entityIdSchema).optional(),
    degradedVi: textSchema.optional(),
  })
  .strict();
export const CurtainParamsSchema = z
  .object({
    side: z.enum(['L', 'R']),
    widthMm: positiveMm,
    extMm: nonNegativeMm,
    topMm: positiveMm,
    offsetMm: nonNegativeMm,
    pleatMm: positiveMm,
    material: materialRefSchema,
    degradedVi: textSchema.optional(),
  })
  .strict();
export const RugParamsSchema = z
  .object({
    centre: pointSchema,
    sizeMm: z.tuple([positiveMm, positiveMm]),
    rotationDeg: rotationSchema,
    thicknessMm: positiveMm,
    material: materialRefSchema.optional(),
  })
  .strict();
export const CeilingLightParamsSchema = z
  .object({
    centre: pointSchema,
    fixture: z.enum(['pendant', 'panel']),
    modelId: textSchema.optional(),
    sizeMm: z.tuple([positiveMm, positiveMm, positiveMm]).optional(),
  })
  .strict();
export const ItemParamsSchema = z
  .object({
    furnitureKind: textSchema,
    variant: textSchema.optional(),
    modelId: textSchema,
    centre: pointSchema,
    sizeMm: z.tuple([positiveMm, positiveMm, positiveMm]),
    rotationDeg: rotationSchema,
    liftMm: mm.optional(),
  })
  .strict();
export const ModelPickParamsSchema = z
  .object({
    modelId: textSchema,
    scale: z.number().gt(0).lte(1),
    reasonVi: textSchema,
    kindAs: textSchema.optional(),
    variantAs: textSchema.optional(),
  })
  .strict();

/** Lược đồ `params` của từng `kind` (AppBack `PARAMS_BY_KIND`). */
export const PARAMS_BY_KIND = {
  skirting: SkirtingParamsSchema,
  wallTile: WallTileParamsSchema,
  cornice: CorniceParamsSchema,
  casing: CasingParamsSchema,
  sash: SashParamsSchema,
  railing: RailingParamsSchema,
  cabinetRun: CabinetRunParamsSchema,
  curtain: CurtainParamsSchema,
  rug: RugParamsSchema,
  ceilingLight: CeilingLightParamsSchema,
  item: ItemParamsSchema,
  modelPick: ModelPickParamsSchema,
} as const;

export type SuggestionKind = keyof typeof PARAMS_BY_KIND;
export const SUGGESTION_KINDS = Object.keys(PARAMS_BY_KIND) as readonly SuggestionKind[];

export const HostRefSchema = z
  .object({
    wall: entityIdSchema.optional(),
    room: entityIdSchema.optional(),
    opening: entityIdSchema.optional(),
    furniture: entityIdSchema.optional(),
    suggestion: suggestionIdSchema.optional(),
  })
  .strict()
  .refine((ref) => Object.values(ref).some((value) => value !== undefined), { message: 'hostRef rỗng' });

export const StaleSchema = z.object({ since: z.number().int().nonnegative(), reasonVi: textSchema }).strict();

const scalarSchema = z.union([z.string(), z.boolean(), z.number().finite()]);
const overrideSchema = z
  .record(z.string().regex(/^[a-z][A-Za-z0-9]{0,39}$/), scalarSchema)
  .refine((value) => {
    const size = Object.keys(value).length;
    return size >= 1 && size <= OVERRIDE_MAX;
  });

const baseShape = {
  id: suggestionIdSchema,
  rule: z.string().regex(/^[A-Z][A-Z0-9]{0,5}$/),
  ruleVersion: z.number().int().min(1),
  hostRef: HostRefSchema,
  state: SuggestionStateSchema.default('active'),
  override: overrideSchema.optional(),
  createdRevision: z.number().int().nonnegative(),
  stale: StaleSchema.optional(),
  adoptedAs: entityIdSchema.optional(),
} as const;

const variant = <K extends SuggestionKind>(kind: K) =>
  z.object({ ...baseShape, kind: z.literal(kind), params: PARAMS_BY_KIND[kind] }).strict();

/** Một bản ghi đề xuất; `params` kiểm theo `kind`, khoá `override` phải là khoá của `params` cùng kind. */
export const SuggestionSchema = z
  .discriminatedUnion('kind', [
    variant('skirting'),
    variant('wallTile'),
    variant('cornice'),
    variant('casing'),
    variant('sash'),
    variant('railing'),
    variant('cabinetRun'),
    variant('curtain'),
    variant('rug'),
    variant('ceilingLight'),
    variant('item'),
    variant('modelPick'),
  ])
  .refine(
    (s) => s.override === undefined || Object.keys(s.override).every((key) => key in PARAMS_BY_KIND[s.kind].shape),
    { path: ['override'] },
  )
  .refine((s) => s.adoptedAs === undefined || s.state === 'adopted', { path: ['adoptedAs'] });

export type Suggestion = z.infer<typeof SuggestionSchema>;
export type SuggestionOf<K extends SuggestionKind> = Extract<Suggestion, { kind: K }>;

export const SuggestionsMetaSchema = z
  .object({
    ruleset: textSchema,
    rulesetSha: z.string().regex(/^[0-9a-f]{64}$/),
    basisRevision: z.number().int().nonnegative(),
  })
  .strict();

export type SuggestionsMeta = z.infer<typeof SuggestionsMetaSchema>;

/** Một dòng `suggestionState` của thân #35: chỉ bản ghi `state ≠ active` hoặc có `override`. */
export const SuggestionStateRowSchema = z
  .object({ id: suggestionIdSchema, state: SuggestionStateSchema, override: overrideSchema.optional() })
  .strict();

export type SuggestionStateRow = z.infer<typeof SuggestionStateRowSchema>;

/** Trần số bản ghi mỗi tầng (AppBack `SUGGESTIONS_CAP`). */
export const SUGGESTIONS_MAX = 2000;

/**
 * Khoá tuỳ chọn của tài liệu tầng (N16), kết quả #35 và (đề xuất) mỗi tầng trong N15: `suggestions`/`suggestionsMeta`
 * vắng khi rỗng; `suggestionsEnabled` chỉ có giá trị `true` (vắng = lớp tắt), như AppBack `suggestion_fields`.
 */
export const floorSuggestionsShape = {
  suggestions: z.array(SuggestionSchema).max(SUGGESTIONS_MAX).optional(),
  suggestionsMeta: SuggestionsMetaSchema.optional(),
  suggestionsEnabled: z.literal(true).optional(),
} as const;

/** Giá trị hiệu lực: `override` > `params` (hợp đồng §3). */
export const effectiveParams = <S extends Suggestion>(suggestion: S): S['params'] =>
  ({ ...suggestion.params, ...(suggestion.override ?? {}) }) as S['params'];

/** Editor/compiler dựng bản này: `active|overridden` và không `stale` (`adopted` đã nằm trong `layer`). */
export const isEffectiveSuggestion = (suggestion: Pick<Suggestion, 'state' | 'stale'>): boolean =>
  (suggestion.state === 'active' || suggestion.state === 'overridden') && suggestion.stale === undefined;
