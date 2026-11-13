/**
 * LW (vòng 18) — lượt 2 tìm chỗ: khi mọi tư thế trong MAX_SHIFT_M bị đồ/cửa chặn, xét mọi tường của phòng (mỗi đoạn tường
 * tự do ≤ 3 điểm: hai đầu + giữa), chi phí dời tuyến tính, lối từ cửa bắt buộc. Ca thật: cn17 tủ áo NGGT60 — tường edge3
 * 3,0 m và edge1 1,8 m trống nhưng xa hơn 1,5 m (F:/runs/m18/LD/THAY-DOI.txt §6).
 */
import { describe, expect, it } from 'vitest';

import type { Point } from '@/domain/spatial/types';

import { footprintOf, MAX_SHIFT_M, posesOf, searchPlacement, type Block, type LayoutRoom, type Piece } from '../layoutSearch';
import { rectsOverlap, type Rect } from '../placement';

const HALF = 0.1;
const rect = (cx: number, cy: number, w: number, d: number, rotationDeg = 0): Rect => ({ cx, cy, w, d, rotationDeg });
/** Phòng chữ nhật (như layoutAccess18): tường 0,2 m mọi cạnh, một cửa đi trên cạnh `door.edge`. */
const boxRoom = (W: number, H: number, door: { edge: number; from: number; to: number }): LayoutRoom => {
  const outline: Point[] = [{ x: 0, y: 0 }, { x: W, y: 0 }, { x: W, y: H }, { x: 0, y: H }];
  const edges = outline.map((a, i) => {
    const b = outline[(i + 1) % outline.length] as Point;
    const lengthM = Math.hypot(b.x - a.x, b.y - a.y);
    const e = { x: (b.x - a.x) / lengthM, y: (b.y - a.y) / lengthM };
    const openings = door.edge === i ? [{ from: door.from, to: door.to }] : [];
    return { a, b, lengthM, e, inward: { x: -e.y, y: e.x }, wallHalfM: HALF, walled: [{ from: 0, to: lengthM }], openings };
  });
  const angle = (e: Point): number => (Math.atan2(e.y, e.x) * 180) / Math.PI;
  const walls: Block[] = edges.map((g) => ({ ...rect((g.a.x + g.b.x) / 2, (g.a.y + g.b.y) / 2, g.lengthM + 2 * HALF, 2 * HALF, angle(g.e)), origin: 'wall' }));
  const g = edges[door.edge] as (typeof edges)[number];
  const t = (door.from + door.to) / 2;
  const widthM = door.to - door.from;
  const at = { x: g.a.x + g.e.x * t, y: g.a.y + g.e.y * t };
  const swing: Block = { ...rect(at.x + g.inward.x * (HALF + widthM / 2), at.y + g.inward.y * (HALF + widthM / 2), widthM, widthM, angle(g.e)), origin: 'swing' };
  return {
    id: 'R',
    outline,
    edges: edges.map(({ a, b, lengthM, inward, wallHalfM, walled, openings }) => ({ a, b, lengthM, inward, wallHalfM, walled, openings })),
    doors: [{ at, inward: g.inward, widthM, wallHalfM: HALF }],
    blocks: [...walls, swing],
  };
};

describe('LW: lượt 2 — tường xa hơn MAX_SHIFT_M', () => {
  // Phòng 3,6 × 6,0 m, cửa tường dưới (0,8–1,6). Đồ cố định A chiếm góc dưới phải (x 1,8–3,6, y 0–3,2), B dọc tường trái
  // (x 0–0,7, y 1,0–3,2); hành lang 1,1 m giữa A và B nối cửa với nửa trên phòng. Hộp tủ áo AI ở góc dưới phải: mọi tường
  // trong 1,5 m bị A chặn; nửa trên phòng trống.
  const room = boxRoom(3.6, 6.0, { edge: 0, from: 0.8, to: 1.6 });
  const fixed: Block[] = [
    { ...rect(2.7, 1.6, 1.8, 3.2), origin: 'fixed' },
    { ...rect(0.35, 2.1, 0.7, 2.2), origin: 'fixed' },
  ];
  const closet: Piece = { id: 'closet', role: 'closet', dims: [1.2, 2.0, 0.6], box: rect(2.7, 0.41, 1.2, 0.6, 0), wallBack: true, movable: true };
  const cands = [{ modelId: 'closet-a', dims: [1.2, 2.0, 0.6] as const }];

  it('lượt 1 trượt; lượt 2 đặt tủ cỡ thật ở tường xa, không chạm đồ cố định, dời > MAX_SHIFT_M', () => {
    const near = searchPlacement(room, closet, cands, fixed);
    expect('unplaced' in near).toBe(true);
    const far = searchPlacement(room, closet, cands, fixed, { far: true });
    expect('pose' in far, JSON.stringify('unplaced' in far ? far.unplaced : null)).toBe(true);
    if (!('pose' in far)) return;
    expect(far.modelId).toBe('closet-a');
    expect(far.pose.shiftM).toBeGreaterThan(MAX_SHIFT_M);
    expect(far.pose.edge).toBeDefined();
    const foot = footprintOf([1.2, 2.0, 0.6], far.pose);
    for (const b of fixed) expect(rectsOverlap(foot, b, -0.001)).toBe(false);
  });

  it('tư thế lượt 2: ≤ 3 điểm mỗi đoạn tường tự do, sắp theo chi phí dời (gần trước xa)', () => {
    const poses = posesOf(closet, room, 48, true);
    const perEdge = new Map<number, number>();
    for (const p of poses) perEdge.set(p.edge ?? -1, (perEdge.get(p.edge ?? -1) ?? 0) + 1);
    // Cạnh 1–3 một đoạn tự do → ≤ 3; cạnh 0 (có cửa) hai đoạn, đoạn trái quá hẹp cho tủ 1,2 m → ≤ 3.
    for (const n of perEdge.values()) expect(n).toBeLessThanOrEqual(3);
    expect(poses.length).toBeGreaterThan(0);
    const costs = poses.map((p) => p.shiftM + (p.turnDeg > 45 && p.turnDeg < 135 ? 0.4 : 0) + (p.turnDeg >= 135 ? 0.25 : 0));
    expect(costs).toEqual([...costs].sort((a, b) => a - b));
    expect(poses.some((p) => p.shiftM > MAX_SHIFT_M)).toBe(true);
  });

  it('món không tựa tường không có tư thế lượt 2; lượt 2 không lối từ cửa → vẫn không đặt', () => {
    expect(posesOf({ ...closet, role: 'diningTable', wallBack: false }, room, 48, true)).toEqual([]);
    // Bịt hành lang: nửa trên phòng không còn lối từ cửa → lượt 2 không nhận tư thế nào (lối bắt buộc mọi vai).
    const shut: Block[] = [...fixed, { ...rect(1.25, 2.1, 1.1, 0.4), origin: 'fixed' }];
    const r = searchPlacement(room, { ...closet, role: 'armchair' }, cands, shut, { far: true });
    expect('unplaced' in r).toBe(true);
  });
});
