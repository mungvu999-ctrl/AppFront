/**
 * LF6 (vòng 18) — đỉnh thẳng hàng của outline (vách khác chạm tường) không được chia đôi chỗ áp lưng của tường.
 * Ca thật nt03t "phòng ngủ 3": tường 2,84 m có đỉnh ở 1,22 m → giường đôi cỡ thật 1,8 m rộng 0 tư thế → ẩn.
 */
import { describe, expect, it } from 'vitest';

import { createSampleBuilding } from '@/domain/spatial/__fixtures__/sampleBuilding';
import type { Point, SpatialGraph, Wall } from '@/domain/spatial/types';

import { footprintOf, layoutRoomOf, posesOf, searchPlacement } from '../layoutSearch';
import { rectsOverlap } from '../placement';

describe('LF6 — cạnh thẳng hàng gộp lại cho đồ áp lưng', () => {
  const LEVEL = 'L-LEVEL00' as const;
  const meta = { source: 'ai', reviewed: false, confidence: 1 } as const;
  const wallOf = (id: string, start: Point, end: Point): Wall =>
    ({ ...meta, id, levelId: LEVEL, centreline: { start, end }, thicknessMm: 200, heightMm: 2700, kind: 'partition', openingIds: [] }) as Wall;
  // Phòng 3,2 × 2,8; tường phải có đỉnh thẳng hàng ở y = 1,2 m (vách phòng bên chạm vào).
  const outline: Point[] = [
    { x: 0, y: 0 },
    { x: 3200, y: 0 },
    { x: 3200, y: 1200 },
    { x: 3200, y: 2800 },
    { x: 0, y: 2800 },
  ];
  const corners = [outline[0], outline[1], outline[3], outline[4]] as Point[];
  const walls = corners.map((p, i) => wallOf(`W${i}`, p, corners[(i + 1) % 4] as Point));
  const graph: SpatialGraph = { ...createSampleBuilding(), walls, openings: [], furniture: [], rooms: [] };

  it('giường 1,8 m áp tường phải dài 2,8 m có tư thế tại chỗ (không bị đỉnh 1,2 m chia đôi)', () => {
    const room = layoutRoomOf({ id: 'R' as never, levelId: LEVEL, outline }, graph);
    expect(room.edges).toHaveLength(4);
    const box = { cx: 2.1, cy: 1.4, w: 1.8, d: 2.0, rotationDeg: 90 };
    const poses = posesOf({ id: 'bed', role: 'doubleBed', dims: [1.8, 0.9, 2.0], box, wallBack: true, movable: true }, room);
    const right = poses.filter((p) => Math.abs(p.cx - (3.2 - 0.1 - 1.0)) < 0.05);
    expect(right.length).toBeGreaterThan(0);
    expect(Math.min(...right.map((p) => p.shiftM))).toBeLessThan(0.05);
  });
});

// LF6 (cn22 ngủ 3): bàn làm việc hộp AI quay mặt vào tường, mẫu thật phải xoay 180°; ghế không đi theo (sau xoay nó sẽ vào
// tường) và đứng yên — không được miễn "kê dưới bàn" để nằm chồng thân bàn mới.
describe('LF6 — thành viên cụm không đi theo phải kiểm chồng với neo', () => {
  const LEVEL = 'L-LEVEL00' as const;
  const meta = { source: 'ai', reviewed: false, confidence: 1 } as const;
  const corners: Point[] = [
    { x: 0, y: 0 },
    { x: 3000, y: 0 },
    { x: 3000, y: 3000 },
    { x: 0, y: 3000 },
  ];
  const walls = corners.map(
    (p, i) =>
      ({ ...meta, id: `W${i}`, levelId: LEVEL, centreline: { start: p, end: corners[(i + 1) % 4] as Point }, thicknessMm: 200, heightMm: 2700, kind: 'partition', openingIds: [] }) as Wall,
  );
  const graph: SpatialGraph = { ...createSampleBuilding(), walls, openings: [], furniture: [], rooms: [] };

  it('bàn xoay 180° sát tường: ghế đứng yên không chồng mặt bằng bàn mới', () => {
    const room = layoutRoomOf({ id: 'R' as never, levelId: LEVEL, outline: corners }, graph);
    const desk = { id: 'desk', role: 'desk', dims: [1.2, 0.75, 0.6] as const, box: { cx: 1.5, cy: 2.7, w: 1.14, d: 0.4, rotationDeg: 0 }, wallBack: true, movable: true };
    const chair = { id: 'chair', role: 'diningChair', dims: [0.46, 0.8, 0.36] as const, box: { cx: 1.5, cy: 2.55, w: 0.46, d: 0.36, rotationDeg: 0 }, wallBack: false, movable: true };
    const res = searchPlacement(room, desk, [{ modelId: 'desk', dims: desk.dims }], [], { members: [chair] });
    if (!('pose' in res)) return;
    const foot = footprintOf(desk.dims, res.pose);
    for (const id of res.move.broken) {
      const mp = res.move.members.find((x) => x.id === id);
      expect(mp).toBeDefined();
      expect(rectsOverlap(footprintOf(chair.dims, mp!.pose), foot), id).toBe(false);
    }
  });
});
