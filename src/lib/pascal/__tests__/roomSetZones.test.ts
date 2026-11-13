/**
 * Vùng chặn của bộ (`roomSetOf` tham số `zones`, f61f35c1): `toPascal` truyền `doorSwingRects` + `wallRects` của tầng
 * (đổi mm → m bằng `planRectOf`) để va chạm toàn phòng tính cả vùng mở cửa và thân tường.
 * Đồ thị nhỏ có cửa đi → vùng chặn dựng bằng đúng hai hàm đó; mẫu rộng chồng vùng mở cửa bị loại 'va chạm', mẫu hẹp được chọn;
 * đối chứng không cửa; mẫu sâu xuyên tường bị loại.
 */
import { describe, expect, it } from 'vitest';

import type { Opening, Point, SpatialGraph, Wall } from '@/domain/spatial/types';

import { doorSwingRects, wallRects } from '../placement';
import type { ModelQuality } from '../libraryQuality';
import { planRectOf, roomSetOf, type Dims, type SetContext, type SetMember, type SetZone } from '../roomSet';

const HUMAN = { source: 'human', reviewed: true, confidence: 1 } as const;
const LVL = 'L-00000000LVL1';
const outline: Point[] = [
  { x: 0, y: 0 },
  { x: 5000, y: 0 },
  { x: 5000, y: 4000 },
  { x: 0, y: 4000 },
];
/** Phòng 5 × 4 m, tường dày 200 mm; cạnh dưới (y = 0) có cửa đi rộng 900 mm từ x = 3500 (mở vào phòng: y 100..1000). */
const graphOf = (withDoor: boolean): SpatialGraph => {
  const walls = outline.map(
    (start, i) =>
      ({ ...HUMAN, id: `W-0000000WALL${i}`, levelId: LVL, centreline: { start, end: outline[(i + 1) % 4] as Point }, thicknessMm: 200, heightMm: 2700, kind: 'envelope', openingIds: [] }) as Wall,
  );
  const door = { ...HUMAN, id: 'O-0000000DOOR1', wallId: 'W-0000000WALL0', kind: 'door', offsetMm: 3500, widthMm: 900, heightMm: 2100, sillHeightMm: 0, swing: 'left' } as unknown as Opening;
  return { walls, openings: withDoor ? [door] : [] } as unknown as SpatialGraph;
};
/** Đúng phép đổi của `toPascal.zonesOf`. */
const zonesOf = (g: SpatialGraph): SetZone[] =>
  [...doorSwingRects(g, LVL as never), ...wallRects(g, LVL as never)].map((r) => planRectOf(r.cx / 1000, r.cy / 1000, r.w / 1000, r.d / 1000, r.rotationDeg));

const q = (role: string, frame: readonly [number, number, number]): ModelQuality =>
  ({
    role,
    useMm: [1000, 1000, 1000],
    front: { axis: '+z', check: 'ok' },
    parts: [{ kind: 'frame', share: 0.5, lab: frame, material: 'wood', kindBy: 'm' }],
    detail: { tris: 1, kb: 1, textures: 0, maxTex: 0, tier: 'light' },
    licence: 'CC0',
    source: 'test',
  }) as ModelQuality;

/** Hai tủ cùng vai: `wide` (1,6 × 0,5) hợp tông hơn, `narrow` (0,8 × 0,5) lệch tông. */
const DIMS: Record<string, Dims> = { wide: [1.6, 1.8, 0.5], narrow: [0.8, 1.8, 0.5], deep: [0.8, 1.8, 0.7], slim: [0.8, 1.8, 0.5] };
const TABLE: Record<string, ModelQuality> = {
  wide: q('closet', [62, 8, 24]),
  narrow: q('closet', [45, 25, 10]),
  deep: q('closet', [62, 8, 24]),
  slim: q('closet', [45, 25, 10]),
};
const ctx: SetContext = { tierOf: () => 0, tiers: 1, dimsOf: (id) => DIMS[id], palette: {}, qualityOf: (id) => TABLE[id] };
/** Tủ AI đặt: hộp w × d tại (cx, cy) m; hiển thị = cỡ catalog (tỉ lệ 1), canh giữa hộp. */
const closet = (box: { cx: number; cy: number; w: number; d: number }, pool: string[]): SetMember => ({
  id: 'F-closet',
  role: 'closet',
  kind: 'wardrobe',
  short: Math.min(box.w, box.d),
  long: Math.max(box.w, box.d),
  current: pool[0] ?? null,
  pool,
  fixed: false,
  sizeFrom: 'ai',
  box: { ...box, rot: 0 },
  shownOf: (f) => DIMS[f],
});
const run = (m: SetMember, zones: SetZone[]) => roomSetOf('room', [m], new Map(), ctx, zones).get(m.id);

// Hộp 1,6 × 0,5 m tâm (3,0; 0,6) → x 2,2..3,8, y 0,35..0,85; vùng mở cửa x 3,5..4,4 × y 0,1..1,0.
const NEAR_DOOR = { cx: 3.0, cy: 0.6, w: 1.6, d: 0.5 };

describe('roomSetOf — vùng mở cửa và tường từ đồ thị thật', () => {
  it('vùng chặn dựng từ đồ thị: có cửa thì có thêm vùng mở cửa trong phòng, không cửa chỉ còn bốn thân tường', () => {
    expect(zonesOf(graphOf(false))).toHaveLength(4);
    expect(zonesOf(graphOf(true))).toHaveLength(4 + 2);
  });

  it('có cửa: mẫu rộng chồng vùng mở cửa bị loại "va chạm", chọn mẫu hẹp', () => {
    const d = run(closet(NEAR_DOOR, ['wide', 'narrow']), zonesOf(graphOf(true)));
    expect(d?.to).toBe('narrow');
    expect(d?.cause).toBe('selector');
    expect(d?.rejects).toEqual({ 'va chạm': 1 });
    expect(d?.top?.map(([f]) => f)).toEqual(['narrow']);
  });

  it('đối chứng, không cửa: cùng cảnh, mẫu rộng được chọn (chi phí tốt hơn) và không có loại va chạm', () => {
    const d = run(closet(NEAR_DOOR, ['wide', 'narrow']), zonesOf(graphOf(false)));
    expect(d?.to).toBe('wide');
    expect(d?.rejects).toBeUndefined();
    expect(d?.top?.map(([f]) => f)).toEqual(['wide', 'narrow']);
  });

  it('tường: mẫu sâu 0,7 m xuyên thân tường (y -0,1..0,1) bị loại "va chạm", mẫu mỏng được chọn; không tường thì mẫu sâu thắng', () => {
    // Vòng 17: tủ áo sâu 1,0 m nay trượt "ngoài công năng" (FUNC_RANGE closet sâu ≤ 0,7) → dùng tủ sâu 0,7 m, hộp y 0,01..0,71.
    const box = { cx: 1.0, cy: 0.36, w: 0.8, d: 0.7 };
    const d = run(closet(box, ['deep', 'slim']), zonesOf(graphOf(false)));
    expect(d?.to).toBe('slim');
    expect(d?.rejects).toEqual({ 'va chạm': 1 });
    expect(run(closet(box, ['deep', 'slim']), [])?.to).toBe('deep');
  });
});
