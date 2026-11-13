/**
 * LD (vòng 18) — vùng cửa của cửa rộng. Trước: vùng trước cửa = (rộng cửa + 0,2) × 0,9 m cho MỌI cửa, kể cả cửa lùa
 * ra lô gia rộng 2,04–2,48 m (cn17/cn18/cn20), cộng vùng "mở" 0,6 m toàn bề rộng cửa lùa, và cửa đi đôi bị tính cánh
 * quét sâu bằng CẢ bề rộng (2,04 × 2,04 m) — sofa/tủ phòng khách ẩn vì chạm một góc dải đó
 * (F:/runs/m18/LD/THAY-DOI.txt §1). Sau: cửa rộng hơn DOOR_PASS_M chỉ cần MỘT dải lối 1,2 × 0,9 m (đầu trái, giữa
 * hoặc đầu phải) còn trống; cửa đôi quét sâu nửa bề rộng (mỗi cánh); cửa lùa không có vùng quét trong phòng (dải lối lo).
 * Vùng sử dụng/lối đi là TIÊU CHÍ BỐ TRÍ, không phải quy chuẩn xây dựng.
 */
import { describe, expect, it } from 'vitest';

import { createSampleBuilding } from '@/domain/spatial/__fixtures__/sampleBuilding';
import type { Opening, Point, Room, SpatialGraph, Wall } from '@/domain/spatial/types';

import { layoutIssuesOf, layoutRoomOf, searchPlacement, type Block, type LayoutRoom, type Piece } from '../layoutSearch';
import { doorSwingRects, type Rect } from '../placement';

const HALF = 0.1;
const rect = (cx: number, cy: number, w: number, d: number, rotationDeg = 0): Rect => ({ cx, cy, w, d, rotationDeg });
/** Phòng 5 × 4 m, tường 0,2 m mọi cạnh, một cửa trên tường dưới (y = 0) từ `from` tới `to`; không vùng quét (như cửa lùa). */
const room = (from: number, to: number): LayoutRoom => {
  const W = 5;
  const H = 4;
  const outline: Point[] = [{ x: 0, y: 0 }, { x: W, y: 0 }, { x: W, y: H }, { x: 0, y: H }];
  const edges = outline.map((a, i) => {
    const b = outline[(i + 1) % 4] as Point;
    const lengthM = Math.hypot(b.x - a.x, b.y - a.y);
    const e = { x: (b.x - a.x) / lengthM, y: (b.y - a.y) / lengthM };
    return { a, b, lengthM, e, inward: { x: -e.y, y: e.x }, wallHalfM: HALF, walled: [{ from: 0, to: lengthM }], openings: i === 0 ? [{ from, to }] : [] };
  });
  const walls: Block[] = edges.map((g) => ({
    ...rect((g.a.x + g.b.x) / 2, (g.a.y + g.b.y) / 2, g.lengthM + 2 * HALF, 2 * HALF, (Math.atan2(g.e.y, g.e.x) * 180) / Math.PI),
    origin: 'wall',
  }));
  return {
    id: 'R',
    outline,
    edges: edges.map(({ a, b, lengthM, inward, wallHalfM, walled, openings }) => ({ a, b, lengthM, inward, wallHalfM, walled, openings })),
    doors: [{ at: { x: (from + to) / 2, y: 0 }, inward: { x: 0, y: 1 }, widthM: to - from, wallHalfM: HALF }],
    blocks: walls,
  };
};
/** Sofa đứng yên tại hộp (movable: false → chỉ thử đúng hộp), lưng áp tường dưới, rộng `w`, từ x = 0,11. */
const sofaAt = (w: number): Piece => ({ id: 'S', role: 'sofa', dims: [w, 0.8, 0.9], box: rect(0.11 + w / 2, 0.56, w, 0.9), wallBack: true, movable: false });
const place = (lay: LayoutRoom, p: Piece) => searchPlacement(lay, p, [{ modelId: 'sofa-a', dims: p.dims }], []);

describe('LD: vùng trước cửa rộng = một dải lối còn trống, không phải cả bề rộng × 0,9 m', () => {
  it('cửa lùa 2,4 m: sofa che 1,2 m đầu trái, dải lối đầu phải còn trống → đặt được', () => {
    const res = place(room(1.0, 3.4), sofaAt(2.0));
    expect('pose' in res, JSON.stringify('unplaced' in res ? res.unplaced : null)).toBe(true);
  });

  it('cửa lùa 2,4 m: sofa 2,6 m che hết mọi dải lối → vẫn loại "chạm vùng trước cửa"', () => {
    const res = place(room(1.0, 3.4), { ...sofaAt(2.6), box: rect(1.7, 0.56, 2.6, 0.9) });
    expect('unplaced' in res).toBe(true);
    if ('unplaced' in res) expect(res.unplaced.reason).toContain('vùng trước cửa');
  });

  it('cửa đơn 0,8 m: chạm mép vùng trước cửa vẫn bị loại như cũ', () => {
    const res = place(room(2.0, 2.8), sofaAt(2.0));
    expect('unplaced' in res).toBe(true);
    if ('unplaced' in res) expect(res.unplaced.reason).toContain('vùng trước cửa');
  });

  it('sổ lỗi: sofa che một phần cửa rộng còn dải lối → không có lỗi "swing"; che hết → có', () => {
    const lay = room(1.0, 3.4);
    expect(layoutIssuesOf(lay, [{ id: 'S', role: 'sofa', rect: sofaAt(2.0).box }]).filter((i) => i.kind === 'swing')).toEqual([]);
    expect(layoutIssuesOf(lay, [{ id: 'S', role: 'sofa', rect: rect(1.7, 0.56, 2.6, 0.9) }]).some((i) => i.kind === 'swing')).toBe(true);
  });
});

describe('LD: vùng quét cửa đôi và cửa lùa', () => {
  const LEVEL = 'L-LEVEL00' as const;
  const meta = { source: 'ai', reviewed: false, confidence: 1 } as const;
  const wall = { ...meta, id: 'W-A', levelId: LEVEL, centreline: { start: { x: 0, y: 0 }, end: { x: 5000, y: 0 } }, thicknessMm: 200, heightMm: 2700, kind: 'partition', openingIds: [] } as unknown as Wall;
  const door = (swing: Opening['swing'], widthMm: number): Opening =>
    ({ ...meta, id: 'O-D', wallId: 'W-A', kind: 'door', offsetMm: 1000, widthMm, heightMm: 2100, sillHeightMm: 0, swing }) as unknown as Opening;
  const liv = { ...meta, id: 'R-LIV', levelId: LEVEL, name: 'k', usage: 'livingRoom', areaM2: 20, wallIds: [], outline: [{ x: 0, y: 0 }, { x: 5000, y: 0 }, { x: 5000, y: 4000 }, { x: 0, y: 4000 }] } as unknown as Room;
  const graph = (o: Opening): SpatialGraph => ({ ...createSampleBuilding(), walls: [wall], openings: [o], furniture: [], rooms: [liv] });

  it('cửa đôi 1,6 m: mỗi cánh 0,8 m → vùng quét sâu 0,8 m (không phải 1,6 m)', () => {
    expect(doorSwingRects(graph(door('double', 1600)), LEVEL).map((r) => [r.w, r.d])).toEqual([[1600, 800]]);
  });

  it('cửa lùa 2,4 m: layoutRoomOf không gắn vùng quét 0,6 m trong phòng (dải lối trước cửa lo)', () => {
    const lay = layoutRoomOf(liv, graph(door('sliding', 2400)));
    expect(lay.doors).toHaveLength(1);
    expect(lay.blocks.filter((b) => b.origin === 'swing')).toEqual([]);
  });
});
