/**
 * FA (vòng 18) — vùng sử dụng là ràng buộc MỀM, không phải lý do ẩn món. Ca thật: f07 phòng ngủ R-…QZ78W8, giường đôi
 * F-…A97HEB ra `to: null` với lý do "thiếu khoảng sử dụng 0,45 m phía trái" (F:/runs/m18/shots/f07/d6cda5a7-VB/f07.json)
 * trong khi bản master cùng phòng đó vẫn hiện giường → phòng ngủ không có giường.
 * Sau: món chỉ trượt vì vùng sử dụng được DỰNG ở tư thế vi phạm mềm ít nhất, sổ quyết định ghi lý do và `layoutIssuesOf`
 * sinh lỗi 'use' cho giao diện. Ràng buộc CỨNG (ra ngoài outline, tường, cánh cửa, dải lối cửa, đồ cố định/đã đặt,
 * lối từ cửa) vẫn ẩn món như cũ. Vùng sử dụng/lối đi là TIÊU CHÍ BỐ TRÍ, không tuyên bố đạt quy chuẩn xây dựng.
 */
import { describe, expect, it } from 'vitest';

import type { Opening, Point, SpatialGraph, Wall } from '@/domain/spatial/types';

import { layoutIssuesOf, layoutRoomOf, searchPlacement, type LayoutRoom, type Piece } from '../layoutSearch';
import type { ModelQuality } from '../libraryQuality';
import type { Rect } from '../placement';
import { LAYOUT_BUDGET, roomSetOf, type Dims, type SetContext, type SetLayout, type SetMember } from '../roomSet';

const HUMAN = { source: 'human', reviewed: true, confidence: 1 } as const;
const LVL = 'L-00000000LVL1';
/** Phòng chữ nhật w × h mm (tường 200 mm tâm trên outline); một cửa đi 800 mm trên cạnh `edge`, cách đầu cạnh `offMm`. */
const roomOf = (w: number, h: number, edge = 2, offMm = 200): LayoutRoom => {
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
  const door = { ...HUMAN, id: 'O-0000000DOOR1', wallId: `W-0000000WALL${edge}`, kind: 'door', offsetMm: offMm, widthMm: 800, heightMm: 2100, sillHeightMm: 0, swing: 'left' } as unknown as Opening;
  const graph = { walls, openings: [door], rooms: [] } as unknown as SpatialGraph;
  return layoutRoomOf({ id: 'R-1', levelId: LVL, outline } as never, graph);
};

const q = (role: string): ModelQuality =>
  ({
    role,
    useMm: [1000, 1000, 1000],
    front: { axis: '+z', check: 'ok' },
    parts: [{ kind: 'frame', share: 0.5, lab: [62, 8, 24], material: 'wood', kindBy: 'm' }],
    detail: { tris: 1, kb: 1, textures: 0, maxTex: 0, tier: 'light' },
    licence: 'CC0',
    source: 'test',
    ...(role.endsWith('Bed') ? { completeness: { v: 'full', by: 'm' } } : {}),
  }) as ModelQuality;

const DIMS: Record<string, Dims> = { db1: [1.6, 0.5, 2.0], db2: [1.7, 0.5, 2.05] };
const QUAL: Record<string, ModelQuality> = { db1: q('doubleBed'), db2: q('doubleBed') };
const ctx: SetContext = { tierOf: () => 0, tiers: 1, dimsOf: (id) => DIMS[id], palette: {}, qualityOf: (id) => QUAL[id] };

/** Hộp AI quá nhỏ cho vai (như f07): mọi mẫu cỡ thật vượt hộp > 0,4 m → T0 trượt, thang dời chạy. */
const BED_BOX = { cx: 1.0, cy: 1.15, w: 1.0, d: 1.6, rot: 0 };
const bed = (over: Partial<SetMember> = {}): SetMember => ({
  id: 'F-bed',
  role: 'doubleBed',
  kind: 'bed',
  short: 1.0,
  long: 1.6,
  current: 'db1',
  pool: ['db1', 'db2'],
  fixed: false,
  sizeFrom: 'ai',
  box: BED_BOX,
  // Khớp trong hộp (như itemFitOf): mẫu cỡ thật bị bóp vào hộp 1,0 × 1,6 → dưới cỡ công năng → T0 trượt, thang dời chạy.
  shownOf: (f) => (DIMS[f] === undefined ? undefined : [BED_BOX.w, (DIMS[f] as Dims)[1], BED_BOX.d]),
  ...over,
});
const run = (members: SetMember[], room: LayoutRoom) => {
  const lay: SetLayout = { room, run: { left: LAYOUT_BUDGET, ms: 0 } };
  return roomSetOf('room', members, new Map(), ctx, [], lay);
};

/**
 * Phòng ngủ 2,4 × 3,3 m lọt lòng, cửa 0,8 m ở góc trái cạnh dưới. Giường 1,6 × 2,0 vào vừa và có lối từ cửa, nhưng bề
 * ngang 2,4 m < 1,6 + 2 × 0,45 → tư thế nào cũng thiếu khoảng sử dụng một bên (xoay 90° cũng thế: 3,3 − 0,9 vùng cửa).
 */
const TIGHT = roomOf(2600, 3500, 0, 200);

describe('FA — vùng sử dụng là ràng buộc MỀM (f07: phòng ngủ mất giường)', () => {
  it('giường chỉ thiếu khoảng một bên → HIỆN ở cỡ thật, không ẩn', () => {
    const d = run([bed()], TIGHT).get('F-bed');
    expect(d?.to, JSON.stringify(d?.why)).not.toBeNull();
    expect(d?.uniform).toBe('real');
    expect(d?.unplaced).toBeUndefined();
    expect(d?.at).toBeDefined();
    // Không co dưới kích thước sử dụng (FUNC_RANGE doubleBed w ≥ 1,35) và vẫn là giường.
    expect(d?.role ?? 'doubleBed').toBe('doubleBed');
    expect((DIMS[d?.to as string] as Dims)[0]).toBeGreaterThanOrEqual(1.35);
  });

  it('sổ quyết định ghi lý do vi phạm mềm, danh sách lỗi bố trí có lỗi "use"', () => {
    const d = run([bed()], TIGHT).get('F-bed');
    expect(d?.why).toContain('lượt mềm');
    expect(d?.why).toContain('thiếu khoảng sử dụng');
    expect(d?.layout?.some((i) => i.kind === 'use')).toBe(true);
  });

  it('món người dùng đã xác nhận cỡ: không dời, không đổi tư thế', () => {
    const d = run([bed({ sizeFrom: 'user' })], TIGHT).get('F-bed');
    expect(d?.at).toBeUndefined();
    expect(d?.move).toBeUndefined();
    expect(d?.moved).toBeUndefined();
  });

});

const rect = (cx: number, cy: number, w: number, d: number, rotationDeg = 0): Rect => ({ cx, cy, w, d, rotationDeg });
const PIECE: Piece = { id: 'F-bed', role: 'doubleBed', dims: [1.6, 0.5, 2.0], box: rect(1.2, 1.2, 1.6, 2.0), wallBack: true, movable: true };
const CANDS = [{ modelId: 'db1', dims: PIECE.dims }];

describe('FA — searchPlacement: lượt thường không đổi, lượt mềm nhận vi phạm ít nhất', () => {
  it('không `relax` → vẫn chưa bố trí được (hành vi cũ)', () => {
    const res = searchPlacement(TIGHT, PIECE, CANDS, []);
    expect('unplaced' in res).toBe(true);
  });

  it('`relax` → đặt được, lý do ghi vùng thiếu, và chỉ thiếu ĐÚNG một bên (không chọn tư thế giữa phòng)', () => {
    const res = searchPlacement(TIGHT, PIECE, CANDS, [], { relax: true });
    expect('pose' in res, JSON.stringify('unplaced' in res ? res.unplaced : null)).toBe(true);
    if (!('pose' in res)) return;
    expect(res.move.why).toContain('thiếu khoảng sử dụng');
    const sides = (res.move.why.match(/thiếu khoảng sử dụng/g) ?? []).length;
    expect(sides).toBe(1);
    const issues = layoutIssuesOf(TIGHT, [{ id: 'F-bed', role: 'doubleBed', rect: { ...res.pose, w: 1.6, d: 2.0, rotationDeg: res.pose.rot } }]);
    expect(issues.filter((i) => i.kind === 'use')).toHaveLength(1);
  });

  it('ràng buộc CỨNG vẫn ẩn: phòng 1,4 × 1,4 m lọt lòng, giường không vào outline dù có `relax`', () => {
    const res = searchPlacement(roomOf(1600, 1600, 0, 200), PIECE, CANDS, [], { relax: true });
    expect('unplaced' in res).toBe(true);
    if ('unplaced' in res) expect(res.unplaced.reason).toContain('ra ngoài phòng');
  });
});
