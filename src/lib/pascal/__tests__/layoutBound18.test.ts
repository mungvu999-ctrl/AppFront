/**
 * LF1 (Codex M18-1 #2) — việc hình học đồng bộ của thang bố trí có trần: lưới lối đi ≤ MAX_GRID_CELLS ô, mẫu tư thế dọc
 * tường chỉ trong ±MAX_SHIFT_M quanh hộp, `layoutIssuesOf` ≤ MAX_ISSUE_PIECES món + một BFS mỗi phòng. Phòng 80 × 80 m với
 * 40 sofa: mọi hàm xong nhanh và tất định. Phòng thường (≤ 60 m²): kết quả Y HỆT bản trước khi sửa (vân tay ghi từ HEAD
 * 7e0a6370).
 */
import { describe, expect, it } from 'vitest';

import type { Point } from '@/domain/spatial/types';

import {
  MAX_GRID_CELLS,
  accessGrid,
  canReach,
  doorApproachRect,
  layoutIssuesOf,
  posesOf,
  searchPlacement,
  type Block,
  type LayoutRoom,
  type Piece,
} from '../layoutSearch';
import type { Rect } from '../placement';
import { fnv1a } from '../roomSet';

const HALF = 0.1;
const rect = (cx: number, cy: number, w: number, d: number, rotationDeg = 0): Rect => ({ cx, cy, w, d, rotationDeg });
/** Phòng tổng hợp (như layoutSearch.test): outline ngược kim đồng hồ, tường 0,2 m mọi cạnh, cửa mở vào trong. */
const roomOf = (outline: Point[], doors: { edge: number; from: number; to: number }[] = []): LayoutRoom => {
  const edges = outline.map((a, i) => {
    const b = outline[(i + 1) % outline.length] as Point;
    const lengthM = Math.hypot(b.x - a.x, b.y - a.y);
    const e = { x: (b.x - a.x) / lengthM, y: (b.y - a.y) / lengthM };
    const openings = doors.filter((d) => d.edge === i).map((d) => ({ from: d.from, to: d.to }));
    return { a, b, lengthM, e, inward: { x: -e.y, y: e.x }, wallHalfM: HALF, walled: [{ from: 0, to: lengthM }], openings };
  });
  const angle = (e: Point): number => (Math.atan2(e.y, e.x) * 180) / Math.PI;
  const walls: Block[] = edges.map((g) => ({ ...rect((g.a.x + g.b.x) / 2, (g.a.y + g.b.y) / 2, g.lengthM + 2 * HALF, 2 * HALF, angle(g.e)), origin: 'wall' }));
  const doorList = doors.map((d) => {
    const g = edges[d.edge] as (typeof edges)[number];
    const t = (d.from + d.to) / 2;
    return { at: { x: g.a.x + g.e.x * t, y: g.a.y + g.e.y * t }, inward: g.inward, widthM: d.to - d.from, wallHalfM: HALF, g };
  });
  const swings: Block[] = doorList.map(({ at, inward, widthM, g }) => ({
    ...rect(at.x + inward.x * (HALF + widthM / 2), at.y + inward.y * (HALF + widthM / 2), widthM, widthM, angle(g.e)),
    origin: 'swing',
  }));
  return {
    id: 'R',
    outline,
    edges: edges.map(({ a, b, lengthM, inward, wallHalfM, walled, openings }) => ({ a, b, lengthM, inward, wallHalfM, walled, openings })),
    doors: doorList.map(({ at, inward, widthM, wallHalfM }) => ({ at, inward, widthM, wallHalfM })),
    blocks: [...walls, ...swings],
  };
};
const boxRoom = (w: number, h: number, doors: { edge: number; from: number; to: number }[] = []): LayoutRoom =>
  roomOf([{ x: 0, y: 0 }, { x: w, y: 0 }, { x: w, y: h }, { x: 0, y: h }], doors);
const sofaAt = (i: number, box: Rect): Piece => ({ id: `s${String(i).padStart(2, '0')}`, role: 'sofa', dims: [2.2, 0.8, 0.95], box, wallBack: true, movable: true });

describe('LF1: phòng 80 × 80 m, 40 sofa — có trần, tất định', () => {
  const room = boxRoom(80, 80, [{ edge: 0, from: 10, to: 12 }]);
  const sofas = Array.from({ length: 40 }, (_, i) => sofaAt(i, rect(4 + (i % 8) * 9, 0.6 + Math.floor(i / 8) * 15, 2, 0.9)));
  const placed = sofas.map((p) => ({ id: p.id, role: p.role, rect: p.box }));
  const blocks: Block[] = sofas.slice(1).map((p) => ({ ...p.box, id: p.id, origin: 'set' }));
  // Ngưỡng 50 ms × 4 cho CI (máy test đo được in ra dưới đây).
  const LIMIT_MS = 200;
  const timed = <T,>(f: () => T): { v: T; ms: number } => {
    const t0 = performance.now();
    const v = f();
    return { v, ms: performance.now() - t0 };
  };

  it('accessGrid ≤ MAX_GRID_CELLS ô; posesOf; layoutIssuesOf; searchPlacement đều < ngưỡng', () => {
    const grid = timed(() => accessGrid(room, [...room.blocks.filter((b) => b.origin === 'wall'), ...placed.map((p) => p.rect)]));
    expect(grid.v.nx * grid.v.ny).toBeLessThanOrEqual(MAX_GRID_CELLS);
    const reach = timed(() => canReach(grid.v, room.doors.map(doorApproachRect), [[rect(40, 40, 1, 1)]]));
    expect(reach.v).toBe(true);
    const poses = timed(() => posesOf(sofas[0] as Piece, room));
    expect(poses.v.length).toBeGreaterThan(0);
    const issues = timed(() => layoutIssuesOf(room, placed));
    const search = timed(() => searchPlacement(room, sofas[0] as Piece, [{ modelId: 'big', dims: [2.4, 0.8, 1] }], blocks));
    const ms = { grid: grid.ms, reach: reach.ms, poses: poses.ms, issues: issues.ms, search: search.ms };
    console.log(`LF1 80×80 m / 40 sofa ms: ${JSON.stringify(Object.fromEntries(Object.entries(ms).map(([k, v]) => [k, +v.toFixed(2)])))}`);
    for (const v of Object.values(ms)) expect(v).toBeLessThan(LIMIT_MS);
    // Tất định: chạy lại cùng kết quả.
    expect(layoutIssuesOf(room, placed)).toEqual(issues.v);
    expect(searchPlacement(room, sofas[0] as Piece, [{ modelId: 'big', dims: [2.4, 0.8, 1] }], blocks)).toEqual(search.v);
    expect(posesOf(sofas[0] as Piece, room)).toEqual(poses.v);
  });
});

/** Phòng thường (≤ 60 m², tất định): tư thế, lưới, lối đi, lỗi bố trí, kết quả tìm chỗ. */
const normalRun = (): unknown[] => {
  const rows: unknown[] = [];
  const rooms: LayoutRoom[] = [
    boxRoom(2.83, 3.3, [{ edge: 2, from: 0.3, to: 1.1 }]),
    boxRoom(4.2, 3.6, [{ edge: 0, from: 0.2, to: 1.0 }]),
    boxRoom(7.5, 8, [{ edge: 3, from: 1, to: 1.9 }]),
    roomOf([{ x: 0, y: 0 }, { x: 6, y: 0 }, { x: 6, y: 3 }, { x: 3, y: 3 }, { x: 3, y: 6 }, { x: 0, y: 6 }], [{ edge: 0, from: 4, to: 4.9 }]),
  ];
  const roles = ['doubleBed', 'sofa', 'closet', 'desk', 'nightstand', 'diningTable', 'coffeeTable'];
  rooms.forEach((room, r) => {
    const xs = room.outline.map((p) => p.x);
    const w = Math.max(...xs) * 0.5;
    const pieces: Piece[] = roles.map((role, i) => ({
      id: `${role}${i}`,
      role,
      dims: [1 + (i % 3) * 0.3, 0.6, 0.6 + (i % 2) * 0.4],
      box: rect(0.6 + ((i * 0.7) % w), 0.6 + ((i * 1.1) % w), 0.9 + (i % 3) * 0.3, 0.5 + (i % 2) * 0.4, (i % 4) * 90),
      wallBack: i % 2 === 0,
      movable: i !== 3,
    }));
    const placed = pieces.map((p) => ({ id: p.id, role: p.role, rect: p.box }));
    const grid = accessGrid(room, [...room.blocks, ...placed.map((p) => p.rect)]);
    rows.push([r, grid.cell, grid.nx, grid.ny, fnv1a(Array.from(grid.free).join(''))]);
    rows.push(layoutIssuesOf(room, placed));
    for (const p of pieces) {
      rows.push(posesOf(p, room));
      const others: Block[] = pieces.filter((q) => q.id !== p.id).map((q) => ({ ...q.box, id: q.id, origin: 'set' }));
      const res = searchPlacement(room, p, [{ modelId: 'a', dims: p.dims }, { modelId: 'b', dims: [p.dims[0] * 1.2, 0.6, p.dims[2] * 1.1] }], others);
      rows.push('pose' in res ? [res.modelId, res.pose, res.move.why, res.tried] : res.unplaced);
    }
  });
  return rows;
};

describe('LF1: phòng thường giữ y hệt bản trước khi sửa', () => {
  it('vân tay tư thế/thứ tự/lưới/lỗi bố trí = HEAD 7e0a6370', () => {
    const run = normalRun();
    console.log(`LF1 vân tay phòng thường: ${fnv1a(JSON.stringify(run))} (${run.length} dòng)`);
    expect(fnv1a(JSON.stringify(run))).toBe(EXPECTED);
  });
});
// F8: 2100185880 → 1409893946 — chỉ 5 dòng 'unplaced' đổi (lý do nêu lối khi có tư thế hợp lệ mà không lối; bfs ≤ 2 × MAX_BFS); không tư thế/mẫu được chọn nào đổi (F:/runs/m18/F8/normal-before.txt ↔ normal-after.txt).
// M19: 1409893946 → 1062697161 — 9/63 dòng đổi, tất cả do bước lưới tư thế của món KHÔNG tựa tường 0,10 → 0,20 m
// (`posesOf`): 8 dòng là chính danh sách tư thế, 1 dòng là món trước đây 'unplaced' (không lối từ cửa) nay đặt được
// ("Dời 0,20 m, xoay 90°"). Không dòng nào của món tựa tường đổi. Bằng chứng: F:/runs/m19/lf1-before.txt ↔ lf1-after.txt.
const EXPECTED = 1062697161;
