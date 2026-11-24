/**
 * L7-07 B — cổng đối chiếu: luật sửa cảnh chạy tăng dần (dò chỗ trong tầm + nhớ theo chữ ký, `repairSearch.ts`) phải
 * cho kết quả TRÙNG 100 % bản toàn cảnh (`?disable=incrementalRules`) — cùng đồ thị đã sửa, cùng danh sách sửa, cùng
 * thứ tự — sau mọi kiểu sửa: dời tường, thả cửa mới, dời cửa, dời món (người dùng đụng / món AI), Ctrl+Z (về đồ thị cũ
 * khi ô nhớ đang ấm), và sửa chồng lên sửa. Phần 23 căn thật chỉ chạy khi có sổ chụp (`replayGraphs.ts`, máy dev).
 */
import { beforeEach, describe, expect, it } from 'vitest';

import type { Furniture, Opening, Point, SpatialGraph, Wall } from '@/domain/spatial/types';

import { clearRepairSearchMemo, INCREMENTAL_RULES_FLAG, repairSearchStats } from '../repairSearch';
import { classOf } from '../sceneLayer';
import { repairScene } from '../sceneRepair';
import { REPLAY_FLATS, replayAvailable, replayGraph } from './replayGraphs';

const FULL: ReadonlySet<string> = new Set([INCREMENTAL_RULES_FLAG]);
const INC: ReadonlySet<string> = new Set();

type Edit = (g: SpatialGraph) => SpatialGraph | null;

const shift = (p: Point, dx: number, dy: number): Point => ({ x: p.x + dx, y: p.y + dy });
/** Dời tường thứ `k` (trải đều) 300 mm theo pháp tuyến. */
const moveWall =
  (k: number): Edit =>
  (g) => {
    const w = g.walls[Math.floor((k * g.walls.length) / 3)];
    if (w === undefined) return null;
    const { start, end } = w.centreline;
    const len = Math.hypot(end.x - start.x, end.y - start.y) || 1;
    const [nx, ny] = [(-(end.y - start.y) / len) * 300, ((end.x - start.x) / len) * 300];
    const moved = { ...w, centreline: { start: shift(start, nx, ny), end: shift(end, nx, ny) } } as Wall;
    return { ...g, walls: g.walls.map((x) => (x.id === w.id ? moved : x)) };
  };
/** Thả cửa đi 900 mm giữa tường dài nhất chưa có ô mở. */
const addDoor: Edit = (g) => {
  const lengthOf = (w: Wall): number => Math.hypot(w.centreline.end.x - w.centreline.start.x, w.centreline.end.y - w.centreline.start.y);
  const w = [...g.walls].filter((x) => x.openingIds.length === 0 && lengthOf(x) > 1500).sort((a, b) => lengthOf(b) - lengthOf(a))[0];
  if (w === undefined) return null;
  const door = { source: 'human', reviewed: true, confidence: 1, id: 'D-NEW', wallId: w.id, kind: 'door', offsetMm: lengthOf(w) / 2 - 450, widthMm: 900, heightMm: 2100, sillHeightMm: 0, swing: 'left' } as unknown as Opening;
  return { ...g, openings: [...g.openings, door], walls: g.walls.map((x) => (x.id === w.id ? { ...x, openingIds: [...x.openingIds, door.id] } : x)) };
};
/** Dời cửa đi đầu tiên 400 mm dọc tường. */
const moveDoor: Edit = (g) => {
  const d = g.openings.find((o) => o.kind === 'door');
  if (d === undefined) return null;
  return { ...g, openings: g.openings.map((o) => (o.id === d.id ? ({ ...o, offsetMm: o.offsetMm + 400 } as Opening) : o)) };
};
/** Dời món AI thứ `k` (+400, −300) mm; `touched`: như phiên sửa cảnh đánh dấu món người dùng đã đụng (`edited`). */
const moveItem =
  (k: number, touched: boolean): Edit =>
  (g) => {
    const ai = g.furniture.filter((f) => classOf(f) === 'ai');
    const f = ai[Math.floor((k * ai.length) / 3)];
    if (f === undefined) return null;
    const { min, max } = f.boundingBox;
    const moved = {
      ...f,
      centre: shift(f.centre, 400, -300),
      boundingBox: { min: shift(min, 400, -300), max: shift(max, 400, -300) },
      ...(touched ? { edited: true } : {}),
    } as Furniture;
    return { ...g, furniture: g.furniture.map((x) => (x.id === f.id ? moved : x)) };
  };

const EDITS: readonly (readonly [string, Edit])[] = [
  ['dời tường 1', moveWall(0)],
  ['dời tường 2', moveWall(1)],
  ['dời tường 3', moveWall(2)],
  ['thả cửa', addDoor],
  ['dời cửa', moveDoor],
  ['dời món (người dùng)', moveItem(0, true)],
  ['dời món AI', moveItem(1, false)],
  ['dời món AI 2', moveItem(2, false)],
];

/** Chạy chuỗi sửa trên `base`: mỗi sửa rồi Ctrl+Z, thêm một sửa chồng (tường rồi món) — đối chiếu ở MỌI trạng thái. */
const checkSequence = (name: string, base: SpatialGraph): { states: number; kinds: Set<string> } => {
  clearRepairSearchMemo();
  const kinds = new Set<string>();
  let states = 0;
  const same = (label: string, g: SpatialGraph): void => {
    const inc = repairScene(g, INC);
    const full = repairScene(g, FULL);
    expect(inc, `${name}: ${label}`).toEqual(full);
    states += 1;
  };
  same('nạp', base);
  for (const [label, edit] of EDITS) {
    const g = edit(base);
    if (g === null) continue;
    same(label, g);
    kinds.add(label.replace(/ \d$/, ''));
    same(`Ctrl+Z sau ${label}`, base);
    kinds.add('Ctrl+Z');
  }
  const wall = moveWall(0)(base);
  const both = wall === null ? null : moveItem(1, false)(wall);
  if (wall !== null && both !== null) {
    same('tường rồi món', both);
    same('Ctrl+Z về sau tường', wall);
    same('Ctrl+Z về gốc', base);
    kinds.add('sửa chồng');
  }
  return { states, kinds };
};

const box = (x0: number, y0: number, x1: number, y1: number): Point[] => [
  { x: x0, y: y0 },
  { x: x1, y: y0 },
  { x: x1, y: y1 },
  { x: x0, y: y1 },
];
const HUMAN = { source: 'human', reviewed: true, confidence: 1 };
const AI = { source: 'ai', reviewed: false, confidence: 0.8 };
const item = (id: string, kind: Furniture['kind'], w: number, d: number, x: number, y: number, extra: object = {}): Furniture =>
  ({ ...AI, id, levelId: 'L-1', kind, centre: { x, y }, boundingBox: { min: { x: x - w / 2, y: y - d / 2 }, max: { x: x + w / 2, y: y + d / 2 } }, rotationDeg: 0, ...extra }) as Furniture;
/** Căn tổng hợp: phòng ngủ + khách + WC, món lòi tường / chồng nhau / sai phòng / ngoài nhà — mọi nhóm luật có việc. */
const synthetic = (): SpatialGraph => {
  const rooms = [
    { id: 'R-BED', usage: 'bedroom', name: 'Phòng ngủ', outline: box(0, 0, 4000, 3500) },
    { id: 'R-LIV', usage: 'livingRoom', name: 'Phòng khách', outline: box(4000, 0, 9000, 3500) },
    { id: 'R-WC', usage: 'bathroom', name: 'WC', outline: box(9000, 0, 11000, 2000) },
  ].map((r) => ({ ...HUMAN, ...r, levelId: 'L-1', areaM2: 12, wallIds: [] }));
  const walls = rooms.flatMap((r) =>
    r.outline.map((start, i) => ({ ...HUMAN, id: `W-${r.id}-${i}`, levelId: 'L-1', centreline: { start, end: r.outline[(i + 1) % 4] }, thicknessMm: 200, heightMm: 2700, kind: 'partition', openingIds: [] })),
  );
  const furniture = [
    item('F-BED', 'bed', 1600, 2000, 900, 1200),
    item('F-WARD', 'wardrobe', 1200, 600, 2600, 1800),
    item('F-STOOL', 'other', 400, 400, 1000, 1300),
    item('F-WC1', 'sanitaryFixture', 400, 700, 3000, 3000, { variant: 'wc' }),
    item('F-SOFA', 'chair', 2000, 900, 6000, 3400, { variant: 'sofa' }),
    item('F-TABLE', 'table', 1400, 800, 6200, 1500),
    item('F-CHAIR', 'chair', 450, 450, 6200, 2000),
    item('F-OUT', 'table', 800, 800, 12000, 1000),
    item('F-WC2', 'sanitaryFixture', 400, 700, 10000, 1000, { variant: 'wc' }),
    item('F-WC3', 'sanitaryFixture', 400, 700, 10200, 1100, { variant: 'wc' }),
  ];
  return {
    building: { ...HUMAN, name: 'b', datumElevationMm: 0 },
    levels: [{ ...HUMAN, id: 'L-1', name: 'T1', order: 0, elevationMm: 0, heightMm: 3000 }],
    walls,
    openings: [],
    furniture,
    rooms,
    axes: [],
    dimensions: [],
    notes: [],
  } as unknown as SpatialGraph;
};

describe('L7-07 B: sửa cảnh tăng dần trùng toàn cảnh', () => {
  beforeEach(() => clearRepairSearchMemo());

  it('căn tổng hợp: mọi kiểu sửa + Ctrl+Z cho đúng kết quả toàn cảnh', () => {
    const base = synthetic();
    expect(repairScene(base, FULL).repairs.length).toBeGreaterThan(3);
    const { states, kinds } = checkSequence('tổng hợp', base);
    expect(states).toBeGreaterThanOrEqual(15);
    expect([...kinds].sort()).toEqual(['Ctrl+Z', 'dời món (người dùng)', 'dời món AI', 'dời tường', 'sửa chồng', 'thả cửa'].sort());
  });

  it('lượt sau không dò lại món ở xa phần vừa sửa; Ctrl+Z về đồ thị đã thấy không dò lại gì', () => {
    const base = synthetic();
    repairScene(base, INC);
    const cold = repairSearchStats.misses;
    expect(cold).toBeGreaterThan(0);
    // Dời ghế trong phòng khách: các lần dò ở phòng ngủ/WC (xa > tầm) giữ kết quả cũ.
    const moved = { ...base, furniture: base.furniture.map((f) => (f.id === 'F-CHAIR' ? item('F-CHAIR', 'chair', 450, 450, 6300, 2100) : f)) };
    repairScene(moved, INC);
    expect(repairSearchStats.hits).toBeGreaterThan(0);
    const before = repairSearchStats.misses;
    repairScene(base, INC);
    expect(repairSearchStats.misses).toBe(before);
  });

  it.skipIf(!replayAvailable())(
    `23 căn thật (bộ chấm sceneFurnish #73) × ${EDITS.length} sửa + Ctrl+Z + sửa chồng: trùng 100 %`,
    () => {
      const lines: string[] = [];
      let total = 0;
      const allKinds = new Set<string>();
      for (const flat of REPLAY_FLATS) {
        const { states, kinds } = checkSequence(flat, replayGraph(flat));
        total += states;
        for (const k of kinds) allKinds.add(k);
        lines.push(`${flat}:${states}`);
      }
      console.log(`L7-07 B đối chiếu: ${REPLAY_FLATS.length} căn, ${total} trạng thái, kiểu sửa: ${[...allKinds].join(', ')} — ${lines.join(' ')}`);
      expect(allKinds.size).toBe(7);
    },
    900_000,
  );
});
