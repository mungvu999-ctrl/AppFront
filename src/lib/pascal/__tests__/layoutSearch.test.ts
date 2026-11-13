/** Lõi bố trí lại (vòng 18, L1): tư thế, vùng sử dụng, cụm, tiếp cận BFS, data vs rule, giới hạn số thử. Đơn vị m. */

import { describe, expect, it } from 'vitest';

import { createSampleBuilding } from '@/domain/spatial/__fixtures__/sampleBuilding';
import type { Opening, Point, SpatialGraph, Wall } from '@/domain/spatial/types';

import {
  K_MODELS,
  K_POSES,
  MAX_BFS,
  accessGrid,
  canReach,
  checkPose,
  diffIssues,
  footprintOf,
  layoutIssuesOf,
  layoutRoomOf,
  posesOf,
  searchPlacement,
  zoneRect,
  type Block,
  type Candidate,
  type LayoutRoom,
  type Piece,
} from '../layoutSearch';
import { rectsOverlap as rectOverlap, type Rect } from '../placement';

const HALF = 0.1;
const rect = (cx: number, cy: number, w: number, d: number, rotationDeg = 0): Rect => ({ cx, cy, w, d, rotationDeg });
const block = (r: Rect, origin: Block['origin'], id?: string): Block => ({ ...r, origin, ...(id === undefined ? {} : { id }) });

/** Phòng tổng hợp: outline ngược chiều kim đồng hồ, tường dày 0,2 m tâm trên mọi cạnh, cửa đi mở vào trong. */
const roomOf = (outline: Point[], doors: { edge: number; from: number; to: number }[] = []): LayoutRoom => {
  const edges = outline.map((a, i) => {
    const b = outline[(i + 1) % outline.length] as Point;
    const lengthM = Math.hypot(b.x - a.x, b.y - a.y);
    const e = { x: (b.x - a.x) / lengthM, y: (b.y - a.y) / lengthM };
    const openings = doors.filter((d) => d.edge === i).map((d) => ({ from: d.from, to: d.to }));
    return { a, b, lengthM, e, inward: { x: -e.y, y: e.x }, wallHalfM: HALF, walled: [{ from: 0, to: lengthM }], openings };
  });
  const angle = (e: Point): number => (Math.atan2(e.y, e.x) * 180) / Math.PI;
  const walls = edges.map((g) =>
    block(rect((g.a.x + g.b.x) / 2, (g.a.y + g.b.y) / 2, g.lengthM + 2 * HALF, 2 * HALF, angle(g.e)), 'wall'),
  );
  const doorList = doors.map((d) => {
    const g = edges[d.edge]!;
    const t = (d.from + d.to) / 2;
    return { at: { x: g.a.x + g.e.x * t, y: g.a.y + g.e.y * t }, inward: g.inward, widthM: d.to - d.from, wallHalfM: HALF, g };
  });
  const swings = doorList.map(({ at, inward, widthM, g }) =>
    block(rect(at.x + inward.x * (HALF + widthM / 2), at.y + inward.y * (HALF + widthM / 2), widthM, widthM, angle(g.e)), 'swing'),
  );
  return {
    id: 'R',
    outline,
    edges: edges.map(({ a, b, lengthM, inward, wallHalfM, walled, openings }) => ({ a, b, lengthM, inward, wallHalfM, walled, openings })),
    doors: doorList.map(({ at, inward, widthM, wallHalfM }) => ({ at, inward, widthM, wallHalfM })),
    blocks: [...walls, ...swings],
  };
};
const boxRoom = (w: number, h: number, doors: { edge: number; from: number; to: number }[] = []): LayoutRoom =>
  roomOf(
    [
      { x: 0, y: 0 },
      { x: w, y: 0 },
      { x: w, y: h },
      { x: 0, y: h },
    ],
    doors,
  );
const pieceOf = (id: string, role: string, box: Rect, over: Partial<Piece> = {}): Piece => ({
  id,
  role,
  dims: [box.w, 0.5, box.d],
  box,
  wallBack: true,
  movable: true,
  ...over,
});

describe('phòng hẹp kiểu giường đơn cỡ thật vượt hộp AI', () => {
  // Phòng 2,83 × 3,3 m; cửa ở tường đối diện đầu giường (cạnh 2, từ góc (2,83; 3,3) đi 0,3–1,1 m).
  const room = boxRoom(2.83, 3.3, [{ edge: 2, from: 0.3, to: 1.1 }]);
  // Hộp AI 0,70 × 1,71 sát tường trái, lưng áp tường y = 0.
  const bed = pieceOf('bed', 'singleBed', rect(0.47, 0.965, 0.7, 1.71));
  const real: Candidate[] = [{ modelId: 'single-bed', dims: [0.92, 0.5, 2.0] }];

  it('tâm hộp không chứa được giường 0,92 × 2,0 (cắt tường trái)', () => {
    const atBox = { cx: 0.47, cy: 1.11, rot: 0, shiftM: 0, turnDeg: 0 };
    const check = checkPose({ ...bed, dims: [0.92, 0.5, 2.0] }, atBox, room, []);
    expect(check.ok).toBe(false);
  });

  it('dời ≤ 0,3 m, lưng vẫn áp tường, cạnh dài kia còn lối từ cửa', () => {
    const r = searchPlacement(room, bed, real, []);
    if (!('pose' in r)) throw new Error(r.unplaced.reason);
    expect(r.pose.shiftM).toBeLessThanOrEqual(0.3);
    expect(r.pose).toMatchObject({ cx: 0.56, cy: 1.11, rot: 0, edge: 0 });
    expect(r.move.why).toMatch(/^Dời 0,17 m để giường đơn cỡ thật 0,92 × 2,00 m/);
    const foot = footprintOf([0.92, 0.5, 2.0], r.pose);
    // Cạnh phải 0,6 m trống (cạnh trái áp tường), và với tới được từ vùng trước cửa.
    const right = zoneRect(foot, 'right', 0.6, 0.5);
    const grid = accessGrid(room, [...room.blocks.filter((b) => b.origin === 'wall'), foot]);
    expect(canReach(grid, room.doors.map((d) => rect(d.at.x, d.at.y - 0.55, 1.0, 0.9)), [[right]])).toBe(true);
    expect(layoutIssuesOf(room, [{ id: 'bed', role: 'singleBed', rect: foot }])).toEqual([]);
  });
});

describe('tất định và giới hạn', () => {
  const room = boxRoom(2.83, 3.3, [{ edge: 2, from: 0.3, to: 1.1 }]);
  const bed = pieceOf('bed', 'singleBed', rect(0.47, 0.965, 0.7, 1.71));
  const cands: Candidate[] = [
    { modelId: 'b', dims: [0.92, 0.5, 2.0] },
    { modelId: 'a', dims: [0.9, 0.5, 1.95], cost: 0.3 },
  ];

  it('gọi 2 lần ra y hệt; hoán vị mẫu/khối/cạnh cho cùng tư thế', () => {
    const one = searchPlacement(room, bed, cands, []);
    expect(JSON.stringify(searchPlacement(room, bed, cands, []))).toBe(JSON.stringify(one));
    const shuffled: LayoutRoom = { ...room, blocks: [...room.blocks].reverse(), edges: [...room.edges].reverse() };
    const two = searchPlacement(shuffled, bed, [...cands].reverse(), []);
    if (!('pose' in one) || !('pose' in two)) throw new Error('phải đặt được');
    expect(two.modelId).toBe(one.modelId);
    expect([two.pose.cx, two.pose.cy, two.pose.rot]).toEqual([one.pose.cx, one.pose.cy, one.pose.rot]);
  });

  it('posesOf ≤ K_POSES; số thử ≤ K_MODELS × K_POSES và ≤ MAX_BFS BFS', () => {
    const table = pieceOf('t', 'coffeeTable', rect(1.4, 1.6, 0.6, 0.6), { wallBack: false });
    expect(posesOf(table, room).length).toBe(K_POSES);
    // 22 món giả chặn kín phòng: không chỗ nào, nhưng số thử vẫn bị chặn trên.
    const crowd = Array.from({ length: 22 }, (_, i) =>
      block(rect(0.3 + (i % 4) * 0.6, 0.3 + Math.floor(i / 4) * 0.55, 0.55, 0.5), 'set', `p${i}`),
    );
    const many = Array.from({ length: 9 }, (_, i): Candidate => ({ modelId: `m${i}`, dims: [0.9 + i * 0.01, 0.5, 2.0] }));
    const r = searchPlacement(room, bed, many, crowd);
    expect('unplaced' in r).toBe(true);
    const tried = 'unplaced' in r ? r.unplaced.tried : r.tried;
    expect(tried.models).toBe(K_MODELS);
    expect(tried.poses).toBeLessThanOrEqual(K_MODELS * K_POSES);
    expect(tried.bfs).toBeLessThanOrEqual(MAX_BFS);
  });
});

describe('tiếp cận: phòng chữ L, tủ chắn cổ chai', () => {
  // Nhánh dưới 5 × 2 (cửa ở cạnh dưới x 4,0–4,8), nhánh trái 2,4 × 5,5; giường ở đầu nhánh trái, lưng áp tường trên.
  const L: Point[] = [
    { x: 0, y: 0 },
    { x: 5, y: 0 },
    { x: 5, y: 2 },
    { x: 2.4, y: 2 },
    { x: 2.4, y: 5.5 },
    { x: 0, y: 5.5 },
  ];
  const room = roomOf(L, [{ edge: 0, from: 4.0, to: 4.8 }]);
  const bed = pieceOf('bed', 'singleBed', rect(0.56, 4.39, 0.92, 2.0, 180));
  /** Tủ chắn ngang nhánh trái từ tường trái, chừa khe `gap` tới mặt tường trong (x = 2,3). */
  const closet = (gap: number): Block => {
    const right = 2.3 - gap;
    return block(rect((0.1 + right) / 2, 2.7, right - 0.1, 0.6), 'set', 'closet');
  };

  it('khe 0,5 m: giường không với tới → không đặt được, lý do nêu lối', () => {
    const r = searchPlacement(room, bed, [{ modelId: 'single-bed', dims: [0.92, 0.5, 2.0] }], [closet(0.5)]);
    if (!('unplaced' in r)) throw new Error('khe 0,5 m phải chặn lối');
    expect(r.unplaced.reason).toContain('không có lối từ cửa');
    // F8: MAX_BFS tư thế rẻ nhất + đại diện mỗi nhóm (mẫu, cạnh, góc) chưa kiểm — trần 2 × MAX_BFS.
    expect(r.unplaced.tried.bfs).toBeGreaterThan(MAX_BFS);
    expect(r.unplaced.tried.bfs).toBeLessThanOrEqual(2 * MAX_BFS);
  });

  it('khe 0,7 m: đạt, giữ chỗ cũ', () => {
    const r = searchPlacement(room, bed, [{ modelId: 'single-bed', dims: [0.92, 0.5, 2.0] }], [closet(0.7)]);
    if (!('pose' in r)) throw new Error(r.unplaced.reason);
    expect(r.pose.shiftM).toBe(0);
    expect(r.tried.bfs).toBe(1);
  });

  it('layoutIssuesOf báo access cho giường sau khe 0,5 m', () => {
    const pieces = [{ id: 'bed', role: 'singleBed', rect: bed.box }];
    const blocked = { ...room, blocks: [...room.blocks, closet(0.5)] };
    expect(layoutIssuesOf(blocked, pieces)).toContainEqual({ kind: 'access', id: 'bed', origin: 'data' });
    const open = { ...room, blocks: [...room.blocks, closet(0.7)] };
    expect(layoutIssuesOf(open, pieces)).toEqual([]);
  });
});

describe('cửa đi', () => {
  const room = boxRoom(3, 3, [{ edge: 0, from: 1.0, to: 1.8 }]);
  it('lấn vùng đứng trước cửa (sâu 0,9 m, ngoài vùng mở 0,8 m) → trượt', () => {
    const cab = pieceOf('c', 'nightstand', rect(1.4, 1.2, 0.4, 0.4), { wallBack: false });
    const pose = (cy: number) => ({ cx: 1.4, cy, rot: 0, shiftM: 0, turnDeg: 0 });
    expect(checkPose(cab, pose(1.15), room, [])).toEqual({ ok: false, reason: 'chạm vùng trước cửa' });
    expect(checkPose(cab, pose(1.21), room, []).ok).toBe(true);
  });
});

describe('cụm và món đã xác nhận', () => {
  // Giường đôi 1,6 × 2,0 + 2 tủ đầu giường; tủ ngăn kéo đã đặt lấn chỗ tủ đầu giường phải.
  const room = boxRoom(3.6, 3.6);
  const bed = pieceOf('bed', 'doubleBed', rect(1.6, 1.11, 1.6, 2.0));
  const nsL = pieceOf('nsL', 'nightstand', rect(0.55, 0.31, 0.5, 0.4));
  const nsR = pieceOf('nsR', 'nightstand', rect(2.65, 0.31, 0.5, 0.4));
  const dresser = block(rect(3.15, 0.35, 0.7, 0.5), 'set', 'dresser');
  const cand: Candidate[] = [{ modelId: 'double', dims: [1.6, 0.5, 2.0] }];

  it('giường dời Δ → cả hai tủ đầu giường dời cùng Δ', () => {
    const r = searchPlacement(room, bed, cand, [dresser], { members: [nsL, nsR] });
    if (!('pose' in r)) throw new Error(r.unplaced.reason);
    const dx = r.pose.cx - bed.box.cx;
    expect(dx).toBeCloseTo(-0.1, 6);
    expect(r.move.broken).toEqual([]);
    for (const m of r.move.members) {
      const box = (m.id === 'nsL' ? nsL : nsR).box;
      expect(m.pose.cx - box.cx).toBeCloseTo(dx, 6);
      expect(m.pose.cy).toBeCloseTo(box.cy, 6);
    }
    expect(r.move.why).toContain('cụm: 2 món');
  });

  it('thành viên movable=false đứng yên, giường không bị đẩy qua nó', () => {
    const fixedR = { ...nsR, movable: false };
    const r = searchPlacement(room, bed, cand, [dresser], { members: [nsL, fixedR] });
    if (!('pose' in r)) throw new Error(r.unplaced.reason);
    expect(r.move.members.find((m) => m.id === 'nsR')?.pose).toMatchObject({ cx: 2.65, cy: 0.31, shiftM: 0 });
    expect(r.pose.shiftM).toBe(0);
  });

  it('neo movable=false không bao giờ dời: chỗ cũ hỏng → unplaced có lý do', () => {
    const pinned = { ...bed, movable: false, box: rect(0.88, 1.11, 1.6, 2.0) };
    expect(posesOf(pinned, room)).toHaveLength(1);
    const r = searchPlacement(room, pinned, cand, []);
    if (!('unplaced' in r)) throw new Error('món đã xác nhận cắt tường không được dời');
    expect(r.unplaced.reason).toMatch(/^Món đã xác nhận, không tự dời: chạm tường/);
  });
});

describe('lỗi có sẵn (data) và lỗi do luật (rule)', () => {
  const room = boxRoom(4, 4);
  const a = { id: 'a', role: 'dresser', rect: rect(1.0, 0.4, 1.0, 0.5) };
  const b = { id: 'b', role: 'cabinet', rect: rect(1.6, 0.4, 0.6, 0.5) };
  const c = { id: 'c', role: 'cabinet', rect: rect(3.0, 0.4, 0.6, 0.5) };

  it('chồng sẵn trong dữ liệu → data; chồng mới sau luật → rule', () => {
    const baseline = layoutIssuesOf(room, [a, b, c]);
    expect(baseline).toEqual([{ kind: 'overlap', id: 'a', with: 'b', m2: 0.1, origin: 'data' }]);
    const after = layoutIssuesOf(room, [a, b, { ...c, rect: rect(2.0, 0.4, 0.6, 0.5) }]);
    expect(diffIssues(baseline, after)).toEqual([
      { kind: 'overlap', id: 'a', with: 'b', m2: 0.1, origin: 'data' },
      { kind: 'overlap', id: 'b', with: 'c', m2: 0.1, origin: 'rule' },
    ]);
  });

  it('kết quả tìm chỗ không chồng đồ đã đặt', () => {
    const placed = [block(a.rect, 'set', 'a'), block(b.rect, 'set', 'b')];
    const piece = pieceOf('x', 'cabinet', rect(1.3, 0.4, 0.6, 0.5));
    const r = searchPlacement(room, piece, [{ modelId: 'cab', dims: [0.6, 0.8, 0.5] }], placed);
    if (!('pose' in r)) throw new Error(r.unplaced.reason);
    const issues = layoutIssuesOf(room, [a, b, { id: 'x', role: 'cabinet', rect: footprintOf([0.6, 0.8, 0.5], r.pose) }]);
    expect(diffIssues(layoutIssuesOf(room, [a, b]), issues).filter((i) => i.origin === 'rule')).toEqual([]);
  });
});

describe('không có lời giải', () => {
  it('giường đôi 1,6 × 2,0 trong phòng 2 × 2 → unplaced có lý do và số thử', () => {
    const room = boxRoom(2, 2);
    const bed = pieceOf('bed', 'doubleBed', rect(1, 1, 1.6, 2.0));
    const r = searchPlacement(room, bed, [{ modelId: 'double', dims: [1.6, 0.5, 2.0] }], []);
    if (!('unplaced' in r)) throw new Error('không thể đặt được');
    expect(r.unplaced.reason).toMatch(/^Không tìm được chỗ: .+ \(thử 1 mẫu, \d+ tư thế\)$/);
  });
});

describe('layoutRoomOf — đổi mm sang m từ đồ thị', () => {
  const LEVEL = 'L-LEVEL00' as const;
  const meta = { source: 'ai', reviewed: false, confidence: 1 } as const;
  const wallOf = (id: string, start: Point, end: Point): Wall =>
    ({ ...meta, id, levelId: LEVEL, centreline: { start, end }, thicknessMm: 200, heightMm: 2700, kind: 'partition', openingIds: [] }) as Wall;
  const door = { ...meta, id: 'D', wallId: 'W0', kind: 'door', offsetMm: 1000, widthMm: 800, heightMm: 2100, sillHeightMm: 0, swing: 'left' } as unknown as Opening;
  const corners: Point[] = [
    { x: 0, y: 0 },
    { x: 3000, y: 0 },
    { x: 3000, y: 3000 },
    { x: 0, y: 3000 },
  ];
  const walls = corners.map((p, i) => wallOf(`W${i}`, p, corners[(i + 1) % 4] as Point));
  const graph: SpatialGraph = { ...createSampleBuilding(), walls, openings: [door], furniture: [], rooms: [] };

  it('outline, cạnh có tường, cửa trên cạnh, khối tường + vùng mở theo m', () => {
    const room = layoutRoomOf({ id: 'R' as never, levelId: LEVEL, outline: corners }, graph);
    expect(room.outline[2]).toEqual({ x: 3, y: 3 });
    expect(room.edges).toHaveLength(4);
    expect(room.edges[0]).toMatchObject({ lengthM: 3, wallHalfM: 0.1, walled: [{ from: 0, to: 3 }], openings: [{ from: 1, to: 1.8 }] });
    expect(room.doors).toEqual([{ at: { x: 1.4, y: 0 }, inward: room.edges[0]?.inward, widthM: 0.8, wallHalfM: 0.1 }]);
    expect(room.blocks.filter((b) => b.origin === 'wall')).toHaveLength(4);
    expect(room.blocks.filter((b) => b.origin === 'swing')).toHaveLength(2);
  });
});

describe('L1b — cụm giường xếp lại tủ đầu giường theo cỡ thật', () => {
  // Hộp AI 1,4 × 1,9 lưng áp tường dưới; tủ đầu giường 0,5 × 0,4 kề sát hai cạnh hộp. Mẫu thật 1,6 × 2,0 to hơn hộp.
  const room = boxRoom(4, 4);
  const bed = pieceOf('bed', 'doubleBed', rect(2.0, 1.06, 1.4, 1.9));
  const nsL = pieceOf('nsL', 'nightstand', rect(1.05, 0.31, 0.5, 0.4));
  const nsR = pieceOf('nsR', 'nightstand', rect(2.95, 0.31, 0.5, 0.4));
  const real: Candidate[] = [{ modelId: 'double', dims: [1.6, 0.5, 2.0] }];
  /** Tủ đầu giường kề cạnh dài giường ≤ 0,15 m, lưng thẳng lưng giường, không chồng giường. */
  const besideHead = (bedFoot: Rect, ns: Rect): boolean => {
    const gap = Math.abs(ns.cx - bedFoot.cx) - bedFoot.w / 2 - ns.w / 2;
    const backGap = Math.abs(ns.cy - ns.d / 2 - (bedFoot.cy - bedFoot.d / 2));
    return gap >= -1e-6 && gap <= 0.15 + 1e-6 && backGap <= 1e-6;
  };

  it('giường to hơn hộp: hai tủ đặt lại sát hai cạnh đầu giường, không gãy', () => {
    const r = searchPlacement(room, bed, real, [], { members: [nsL, nsR] });
    if (!('pose' in r)) throw new Error(r.unplaced.reason);
    expect(r.move.broken).toEqual([]);
    const foot = footprintOf(real[0]!.dims, r.pose);
    const feet = r.move.members.map((m) => ({ id: m.id, role: 'nightstand', rect: footprintOf([0.5, 0.5, 0.4], m.pose) }));
    expect(feet).toHaveLength(2);
    for (const f of feet) expect(besideHead(foot, f.rect)).toBe(true);
    expect(feet.map((f) => Math.sign(f.rect.cx - foot.cx))).toEqual([-1, 1]);
    expect(layoutIssuesOf(room, [{ id: 'bed', role: 'doubleBed', rect: foot }, ...feet])).toEqual([]);
  });

  it('tủ movable=false đứng yên; tủ kia xếp lại theo giường đã dời', () => {
    const fixedR = { ...nsR, movable: false };
    const r = searchPlacement(room, bed, real, [], { members: [nsL, fixedR] });
    if (!('pose' in r)) throw new Error(r.unplaced.reason);
    expect(r.move.members.find((m) => m.id === 'nsR')?.pose).toMatchObject({ cx: 2.95, cy: 0.31, shiftM: 0 });
    const foot = footprintOf(real[0]!.dims, r.pose);
    const left = r.move.members.find((m) => m.id === 'nsL');
    expect(left && besideHead(foot, footprintOf([0.5, 0.5, 0.4], left.pose))).toBe(true);
    expect(r.move.broken).toEqual([]);
  });
});

describe('L1b — món phụ: kiểm lối tới bằng BFS, chỉ phạt', () => {
  // Phòng 4 × 3, cửa cạnh dưới x 2,8–3,6. Hốc kín góc trên-trái (x 0,1–1,05, y 2,05–2,9) do hai vách đồ đã đặt.
  const room = boxRoom(4, 3, [{ edge: 0, from: 2.8, to: 3.6 }]);
  const pocket = [block(rect(0.575, 2.0, 1.15, 0.1), 'set', 'A'), block(rect(1.1, 2.475, 0.1, 1.05), 'set', 'B')];
  const shelf = pieceOf('s', 'bookshelf', rect(0.575, 2.74, 0.9, 0.3, 180));
  const cand: Candidate[] = [{ modelId: 'shelf', dims: [0.9, 1.8, 0.3] }];

  it('tư thế gần nhất trong hốc kín bị phạt → chọn tư thế có lối tới', () => {
    const r = searchPlacement(room, shelf, cand, pocket);
    if (!('pose' in r)) throw new Error(r.unplaced.reason);
    expect(r.tried.bfs).toBeGreaterThan(1);
    expect(r.tried.bfs).toBeLessThanOrEqual(MAX_BFS);
    expect(r.pose.cx).toBeGreaterThan(1.5);
    expect(r.move.why).not.toContain('chưa có lối');
  });

  it('không tư thế nào trong ngân sách BFS tới được → vẫn đặt (không loại), lý do nêu lối', () => {
    const r = searchPlacement(room, shelf, cand, pocket, { budget: { bfs: 2 } });
    if (!('pose' in r)) throw new Error(r.unplaced.reason);
    expect(r.tried.bfs).toBe(2);
    expect(r.pose.cx).toBeLessThan(1);
    expect(r.move.why).toContain('chưa có lối từ cửa tới món');
  });
});

describe('L1b — tủ cửa lùa', () => {
  // Tủ áo sâu 0,6 lưng áp tường dưới; đồ đã đặt cách mặt trước tủ 0,60 m.
  const room = boxRoom(3, 3);
  const closet = pieceOf('k', 'closet', rect(1.5, 0.41, 1.2, 0.6));
  const pose = { cx: 1.5, cy: 0.41, rot: 0, shiftM: 0, turnDeg: 0 };
  const sofa = [block(rect(1.5, 1.71, 1.6, 0.8), 'set', 'sofa')];

  it('cửa mở 0,70 m thiếu chỗ; cờ sliding → 0,55 m đạt', () => {
    expect(checkPose(closet, pose, room, sofa)).toEqual({ ok: false, reason: 'thiếu khoảng sử dụng 0,70 m phía trước' });
    expect(checkPose({ ...closet, sliding: true }, pose, room, sofa).ok).toBe(true);
  });
});

describe('L1b — bàn ăn: vùng 0,60 m theo cạnh có ghế', () => {
  const room = boxRoom(4, 4);
  const table = pieceOf('t', 'diningTable', rect(2.0, 2.0, 1.2, 0.8), { wallBack: false });
  const cand: Candidate[] = [{ modelId: 'table', dims: [1.2, 0.75, 0.8] }];
  const zoneClear = (z: Rect, blocks: readonly Block[]): boolean => !blocks.some((b) => rectOverlap(z, b));

  it('ghế hai đầu bàn: cạnh trái bị vách lấn → bàn dời để cả hai cạnh có ghế đủ 0,60 m', () => {
    const chairs = [
      pieceOf('cL', 'diningChair', rect(1.15, 2.0, 0.45, 0.45, 90), { wallBack: false }),
      pieceOf('cR', 'diningChair', rect(2.85, 2.0, 0.45, 0.45, 270), { wallBack: false }),
    ];
    const screen = [block(rect(0.825, 2.0, 0.15, 1.0), 'set', 'screen')];
    const r = searchPlacement(room, table, cand, screen, { members: chairs });
    if (!('pose' in r)) throw new Error(r.unplaced.reason);
    expect(r.pose.shiftM).toBeGreaterThan(0);
    const foot = footprintOf(cand[0]!.dims, r.pose);
    expect(zoneClear(zoneRect(foot, 'left', 0.6), screen)).toBe(true);
    expect(zoneClear(zoneRect(foot, 'right', 0.6), screen)).toBe(true);
    expect(r.move.broken).toEqual([]);
  });

  it('không ghế: hai cạnh dài bị chặn → xoay để một cạnh dài trống 0,60 m', () => {
    const rails = [block(rect(2.0, 2.7, 0.2, 0.1), 'set', 'f'), block(rect(2.0, 1.3, 0.2, 0.1), 'set', 'b')];
    const r = searchPlacement(room, table, cand, rails);
    if (!('pose' in r)) throw new Error(r.unplaced.reason);
    expect(r.pose.turnDeg).toBe(90);
    const foot = footprintOf(cand[0]!.dims, r.pose);
    const long = ['front', 'back'] as const;
    expect(long.some((s) => zoneClear(zoneRect(foot, s, 0.6), rails))).toBe(true);
  });
});
