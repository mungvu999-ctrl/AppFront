import { z } from 'zod';

import { materialRefSchema } from './spatial';
import { suggestionBaseShape, type SuggestionKind } from './suggestionWire';

/**
 * M2 — lớp đề xuất của một tầng (`suggestions` + `suggestionsMeta` trong tài liệu tầng), mirror của
 * AppBack `packages/domain/suggestions/model.py`. Hợp đồng: `docs/mo-hinh-dep-chuyen-nghiep/M2/
 * HOP-DONG-DU-LIEU-LOP-DE-XUAT.md` §2 (ngoài repo, `F:/App/docs/…`).
 *
 * Mọi đối tượng `.strict()`, camelCase, khoá tuỳ chọn vắng (không `null`) như lớp không gian.
 * Người dùng chỉ sở hữu `state` + `override`; phần còn lại máy chủ sinh.
 */

export {
  floorSuggestionsShape,
  HostRefSchema,
  StaleSchema,
  SUGGESTION_ID_PATTERN,
  SUGGESTION_KINDS,
  SuggestionStateRowSchema,
  SuggestionStateSchema,
  SuggestionsMetaSchema,
  SUGGESTIONS_MAX,
} from './suggestionWire';
export type { SuggestionKind, SuggestionState, SuggestionStateRow, SuggestionsMeta } from './suggestionWire';

const entityIdSchema = z.string().min(1);
const mm = z.number().finite();
const positiveMm = z.number().positive().finite();
const nonNegativeMm = z.number().nonnegative().finite();
const spanSchema = z.tuple([nonNegativeMm, nonNegativeMm]);
const pointSchema = z.object({ x: mm, y: mm }).strict();
const textSchema = z.string().min(1);
const rotationSchema = z.number().nonnegative().lt(360);

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

PARAMS_BY_KIND satisfies Record<SuggestionKind, z.ZodTypeAny>;

const variant = <K extends SuggestionKind>(kind: K) =>
  z.object({ ...suggestionBaseShape, kind: z.literal(kind), params: PARAMS_BY_KIND[kind] }).strict();

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

/**
 * Bản ghi có `params` đúng lược đồ của kind (biên tài liệu tầng chỉ kiểm khung, `./suggestionWire.ts`). Bản sai bị
 * bỏ — editor không vẽ thứ nó không hiểu — thay vì làm hỏng cả cảnh.
 */
export const validSuggestions = (items: readonly Suggestion[]): Suggestion[] =>
  items.filter((item) => SuggestionSchema.safeParse(item).success);

/** Giá trị hiệu lực: `override` > `params` (hợp đồng §3). */
export const effectiveParams = <S extends Suggestion>(suggestion: S): S['params'] =>
  ({ ...suggestion.params, ...(suggestion.override ?? {}) }) as S['params'];

/** Editor/compiler dựng bản này: `active|overridden` và không `stale` (`adopted` đã nằm trong `layer`). */
export const isEffectiveSuggestion = (suggestion: Pick<Suggestion, 'state' | 'stale'>): boolean =>
  (suggestion.state === 'active' || suggestion.state === 'overridden') && suggestion.stale === undefined;
