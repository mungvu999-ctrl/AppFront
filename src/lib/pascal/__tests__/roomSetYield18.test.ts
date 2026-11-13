/**
 * M18 LT5 — nhường chỗ giữa món bộ chưa chốt khi đặt món chính (roomSet.ts yieldsTo). Phòng tổng hợp, không tên căn.
 */
import { describe, expect, it } from 'vitest';

import type { Opening, Point, SpatialGraph, Wall } from '@/domain/spatial/types';

import { layoutRoomOf, type LayoutRoom } from '../layoutSearch';
import type { ModelQuality } from '../libraryQuality';
import { LAYOUT_BUDGET, roomSetOf, type Dims, type SetContext, type SetMember } from '../roomSet';

const HUMAN = { source: 'human', reviewed: true, confidence: 1 } as const;
const LVL = 'L-00000000LVL1';
/** Phòng chữ nhật w × h mm, tường 200 mm tâm trên outline; cửa đi trên cạnh trên (y = h), rộng 800 mm, cách góc phải 200 mm. */
const roomOf = (w: number, h: number): LayoutRoom => {
  const outline: Point[] = [
    { x: 0, y: 0 },
    { x: w, y: 0 },
    { x: w, y: h },
    { x: 0, y: h },
  ];
  const walls = outline.map(
    (start, i) =>
      ({ ...HUMAN, id: `W-0000000WALL${i}`, levelId: LVL, centreline: { start, end: outline[(i + 1) % 4] as Point }, thicknessMm: 200, heightMm: 2700, kind: 'envelope', openingIds: [] }) as Wall,
  );
  const door = { ...HUMAN, id: 'O-0000000DOOR1', wallId: 'W-0000000WALL2', kind: 'door', offsetMm: 200, widthMm: 800, heightMm: 2100, sillHeightMm: 0, swing: 'left' } as unknown as Opening;
  const graph = { walls, openings: [door], rooms: [] } as unknown as SpatialGraph;
  return layoutRoomOf({ id: 'R-1', levelId: LVL, outline } as never, graph);
};

const q = (role: string, complete = true): ModelQuality =>
  ({
    role,
    useMm: [1000, 1000, 1000],
    front: { axis: '+z', check: 'ok' },
    parts: [{ kind: 'frame', share: 0.5, lab: [62, 8, 24], material: 'wood', kindBy: 'm' }],
    detail: { tris: 1, kb: 1, textures: 0, maxTex: 0, tier: 'light' },
    licence: 'CC0',
    source: 'test',
    ...(role.endsWith('Bed') ? { completeness: { v: complete ? 'full' : 'partial', by: 'm' } } : {}),
  }) as ModelQuality;

const DIMS: Record<string, Dims> = {
  'single-bed': [0.92, 0.45, 2.0],
  sb1: [0.95, 0.5, 2.0],
  sb2: [0.97, 0.5, 2.05],
  sb3: [1.0, 0.5, 2.0],
  ns1: [0.4, 0.5, 0.4],
  cab1: [0.85, 0.8, 0.45],
  bn1: [1.2, 0.45, 0.4],
  ac1: [0.8, 0.8, 0.8],
};
const QUAL: Record<string, ModelQuality> = { sb1: q('singleBed', false), sb2: q('singleBed', false), sb3: q('singleBed', false), ns1: q('nightstand'), cab1: q('cabinet'), bn1: q('bench'), ac1: q('armchair') };
const ctx: SetContext = { tierOf: () => 0, tiers: 1, dimsOf: (id) => DIMS[id], palette: {}, qualityOf: (id) => QUAL[id] };

interface Box {
  cx: number;
  cy: number;
  w: number;
  d: number;
  rot?: number;
}
const member = (id: string, role: string, box: Box, over: Partial<SetMember> = {}): SetMember => ({
  id,
  role,
  short: Math.min(box.w, box.d),
  long: Math.max(box.w, box.d),
  current: null,
  pool: [],
  fixed: false,
  sizeFrom: 'ai',
  box: { cx: box.cx, cy: box.cy, w: box.w, d: box.d, rot: box.rot ?? 0 },
  // Khớp trong hộp (như itemFitOf giãn đúng hộp): mẫu cỡ thật lệch hộp bị bóp vào hộp.
  shownOf: (f) => (DIMS[f] === undefined ? undefined : [box.w, (DIMS[f] as Dims)[1], box.d]),
  ...over,
});

/** Hộp giường đơn AI 0,70 × 1,71 sát tường trái + tường dưới (kiểu phòng ngủ hẹp): giường thật 0,92 × 2,0 giữ tâm chạm tường. */
const NARROW_BED: Box = { cx: 0.55, cy: 0.955, w: 0.7, d: 1.71 };
const bed = (over: Partial<SetMember> = {}): SetMember =>
  member('F-bed', 'singleBed', NARROW_BED, { kind: 'bed', current: 'sb1', stock: 'single-bed', pool: ['sb1', 'sb2', 'sb3'], ...over });

const run = (key: string, members: SetMember[]) => roomSetOf(key, members, new Map(), ctx, [], { room: roomOf(2830, 3300), run: { left: LAYOUT_BUDGET, ms: 0 } });
/** Hộp AI 1,6 × 1,6 giữa phòng 2,83 × 3,3: mọi tư thế giường thật 0,92 × 2,0 đều cắt hộp. */
const MID: Box = { cx: 1.41, cy: 1.65, w: 1.6, d: 1.6 };
const ruleOverlaps = (out: ReturnType<typeof run>): string[] =>
  [...out.values()].flatMap((d) => (d.layout ?? []).filter((x) => x.kind === 'overlap' && x.origin === 'rule').map((x) => `${x.id}+${x.with ?? ''}`));

// M18 LT5 — ai nhường ai khi đặt món chính; khoá phòng `usage|…` (roomSetKeysOf) mang công năng.
describe('roomSetOf — nhường chỗ giữa món chưa chốt (LT5)', () => {
  it('ghế dài (nhóm ghế, không tự dời) KHÔNG nhường món chính: không sinh chồng giường + ghế dài', () => {
    const bench = member('F-bn', 'bench', MID, { kind: 'bench', pool: ['bn1'], current: 'bn1' });
    const out = run('bedroom|x|y#0,0', [bed(), bench]);
    expect(ruleOverlaps(out)).toEqual([]);
    expect(out.get('F-bed')?.unplaced?.reason).toContain('chạm đồ đã đặt');
  });

  it('phòng ngủ: ghế bành chưa chốt không chặn giường (giường dẫn); ghế bành quyết định sau, không chồng giường', () => {
    const arm = member('F-ac', 'armchair', MID, { kind: 'armchair', pool: ['ac1'], current: 'ac1' });
    const out = run('bedroom|x|y#0,0', [bed(), arm]);
    expect(out.get('F-bed')?.to).not.toBeNull();
    expect(out.get('F-bed')?.unplaced).toBeUndefined();
    const a = out.get('F-ac');
    expect(a?.to !== null || (a?.unplaced?.reason ?? '') !== '').toBe(true);
    expect(ruleOverlaps(out)).toEqual([]);
  });

  it('phòng khách (giường không dẫn) và ghế bành đã xác nhận: ghế bành vẫn chặn giường như cũ', () => {
    const arm = (over: Partial<SetMember> = {}): SetMember => member('F-ac', 'armchair', MID, { kind: 'armchair', pool: ['ac1'], current: 'ac1', ...over });
    for (const [key, a] of [['livingRoom|x|y#0,0', arm()], ['bedroom|x|y#0,0', arm({ sizeFrom: 'user' })], ['R-raw', arm()]] as const) {
      const b = run(key, [bed(), a]).get('F-bed');
      expect(b?.to, key).toBeNull();
      expect(b?.unplaced?.reason).toContain('chạm đồ đã đặt');
    }
  });
});
