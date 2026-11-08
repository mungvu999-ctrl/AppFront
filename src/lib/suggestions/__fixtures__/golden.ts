/**
 * Ca vàng của AppBack (`packages/domain/suggestions/tests/data/*.json`, chép nguyên): lớp `ch-04`/`ch-06` từ bench r5
 * và bản nháp R1/R4/C2/F1/L1 máy chủ sinh. Chỉ dùng trong test (không vào bản dựng).
 */
import { SpatialLayerSchema } from '@/api/schemas/spatial';
import { SuggestionSchema, type Suggestion } from '@/api/schemas/suggestions';
import type { SpatialLayer } from '@/api/client';
import type { LevelId, SpatialGraph } from '@/domain/spatial/types';
import { millimetres } from '@/domain/units/types';

import ch04Golden from './ch-04.golden.json';
import ch04Layer from './ch-04.layer.json';
import ch06Golden from './ch-06.golden.json';
import ch06Layer from './ch-06.layer.json';

export interface GoldenCase {
  readonly name: string;
  readonly rulesetSha: string;
  readonly rules: readonly string[];
  /** Bản nháp như máy chủ ghi trong tệp vàng: `id, rule, ruleVersion, kind, hostRef, params`. */
  readonly drafts: readonly Record<string, unknown>[];
  readonly layer: SpatialLayer;
}

export const GOLDEN_CASES: readonly GoldenCase[] = [
  { name: 'ch-04', golden: ch04Golden, layer: ch04Layer },
  { name: 'ch-06', golden: ch06Golden, layer: ch06Layer },
].map(({ name, golden, layer }) => ({
  name,
  rulesetSha: golden.rulesetSha,
  rules: golden.rules,
  drafts: golden.suggestions as readonly Record<string, unknown>[],
  layer: SpatialLayerSchema.parse(layer) as SpatialLayer,
}));

/** Bản ghi đã lưu của một ca vàng (`active`, `createdRevision` 1), như N16 sẽ trả. */
export const storedSuggestionsOf = (golden: GoldenCase): Suggestion[] =>
  golden.drafts.map((draft) => SuggestionSchema.parse({ ...draft, state: 'active', createdRevision: 1 }));

export const CH04 = GOLDEN_CASES[0]!;

/** Đồ thị một tầng của ca vàng (tầng cao 3,3 m như bench), để dựng cảnh Pascal. */
export const goldenGraphOf = (golden: GoldenCase): SpatialGraph => {
  const levelId = (golden.layer.walls[0]?.levelId ?? 'L-1') as LevelId;
  return {
    axes: [],
    building: { confidence: 1, datumElevationMm: millimetres(0), name: golden.name, reviewed: true, source: 'human' },
    dimensions: [],
    furniture: [...golden.layer.furniture],
    levels: [
      { id: levelId, name: 'Tầng 1', order: 0, elevationMm: millimetres(0), heightMm: millimetres(3300), confidence: 1, reviewed: true, source: 'human' },
    ],
    notes: [],
    openings: [...golden.layer.openings],
    rooms: [...golden.layer.rooms],
    walls: [...golden.layer.walls],
  };
};
