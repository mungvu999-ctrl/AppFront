/**
 * F8 (vòng 18) — món chính: MAX_BFS tư thế rẻ nhất thường là một chùm gần trùng (cùng mẫu, cùng cạnh tường, cùng góc,
 * trượt 0,1 m) nên hỏng lối cùng lúc; tư thế có lối ở nhóm khác (cạnh khác / góc khác) phải vẫn được kiểm trước khi
 * kết luận "không tìm được chỗ". Ca thật: cn13 "phòng ngủ 2" giường đôi — tư thế có lối đầu tiên đứng thứ 50 trong
 * danh sách hợp lệ (F:/runs/m18/F8/THAY-DOI.txt §1).
 */
import { describe, expect, it } from 'vitest';

import type { Point } from '@/domain/spatial/types';

import { MAX_BFS, searchPlacement, type Block, type LayoutRoom, type Piece } from '../layoutSearch';
import type { Rect } from '../placement';

const HALF = 0.1;
const rect = (cx: number, cy: number, w: number, d: number, rotationDeg = 0): Rect => ({ cx, cy, w, d, rotationDeg });
/** Phòng chữ nhật (như layoutBound18): outline ngược kim đồng hồ, tường 0,2 m mọi cạnh, cửa mở vào trong. */
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

describe('F8: món chính — chùm tư thế rẻ nhất hỏng lối không che tư thế có lối ở nhóm khác', () => {
  // Phòng 3,0 × 4,4 m, cửa tường dưới. Hộp AI giường nằm ngang, đầu áp tường trái: giường dài 2,2 m chắn ngang phòng
  // (khe 0,59 m tới tường phải < lối 0,6 m) → cạnh giường phía trên không có lối, với MỌI tư thế dọc tường trái/phải.
  // Đầu áp tường trên (xoay 90°): hai cạnh giường thông xuống cửa.
  const room = boxRoom(3.0, 4.4, { edge: 0, from: 2.0, to: 2.8 });
  const bed: Piece = { id: 'bed', role: 'doubleBed', dims: [1.6, 0.9, 2.2], box: rect(1.21, 2.4, 1.6, 2.2, 90), wallBack: true, movable: true };
  const res = searchPlacement(room, bed, [{ modelId: 'bed-a', dims: [1.6, 0.9, 2.2] }], []);

  it('đặt được giường cỡ thật, đầu áp tường trên, có lối; BFS ≤ 2 × MAX_BFS', () => {
    expect('pose' in res, JSON.stringify('unplaced' in res ? res.unplaced : null)).toBe(true);
    if (!('pose' in res)) return;
    expect(res.modelId).toBe('bed-a');
    expect(res.pose.edge).toBe(2);
    expect(res.tried.bfs).toBeGreaterThan(MAX_BFS);
    expect(res.tried.bfs).toBeLessThanOrEqual(2 * MAX_BFS);
  });

  it('không chỗ nào có lối → lý do là lối đi (không phải lý do loại hình học nhiều nhất)', () => {
    // Cửa trên tường phải, sát góc trên: mọi tư thế hợp lệ đều chặn một cạnh giường.
    const narrow = boxRoom(2.5, 4.4, { edge: 0, from: 0.2, to: 1.0 });
    const r = searchPlacement(narrow, { ...bed, box: rect(1.21, 3.0, 1.6, 2.2, 90) }, [{ modelId: 'bed-a', dims: [1.6, 0.9, 2.2] }], [
      { ...rect(1.25, 1.6, 2.3, 0.2), origin: 'fixed' },
    ]);
    expect('unplaced' in r).toBe(true);
    if ('unplaced' in r) expect(r.unplaced.reason).toContain('không có lối từ cửa');
  });
});
