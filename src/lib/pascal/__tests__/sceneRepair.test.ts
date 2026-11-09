/** Sửa cảnh cho đồ AI chưa xác nhận (`sceneRepair.ts`): từng luật, không đụng món người dùng, tính idempotent. */

import { describe, expect, it } from 'vitest';

import type { Furniture, Point, Room, RoomUsage, SpatialGraph, Wall } from '@/domain/spatial/types';

import { rectInsidePolygon, rectOfFurniture, rectsOverlap, scenePlacementIssues, wallRects } from '../placement';
import { sanitaryPlacementIssues } from '../sanitaryRules';
import { freezeRepairs, reapplyRepairs, repairScene } from '../sceneRepair';

const HUMAN = { source: 'human', reviewed: true, confidence: 1 } as const;
const AI = { source: 'ai', reviewed: false, confidence: 0.8 } as const;

const box = (x0: number, y0: number, x1: number, y1: number): Point[] => [
  { x: x0, y: y0 },
  { x: x1, y: y0 },
  { x: x1, y: y1 },
  { x: x0, y: y1 },
];
const room = (id: string, usage: RoomUsage, outline: Point[], name = ''): Room =>
  ({ ...HUMAN, id, levelId: 'L-1', name, usage, outline, areaM2: 12, wallIds: [] }) as Room;
const wallsOf = (r: Room): Wall[] =>
  r.outline.map(
    (start, i) =>
      ({
        ...HUMAN,
        id: `W-${r.id}-${i}`,
        levelId: 'L-1',
        centreline: { start, end: r.outline[(i + 1) % r.outline.length] as Point },
        thicknessMm: 200,
        heightMm: 2700,
        kind: 'partition',
        openingIds: [],
      }) as Wall,
  );
const graphOf = (rooms: Room[], furniture: Furniture[]): SpatialGraph =>
  ({
    building: { ...HUMAN, name: 'b', datumElevationMm: 0 },
    levels: [{ ...HUMAN, id: 'L-1', name: 'T1', order: 0, elevationMm: 0, heightMm: 3000 }],
    walls: rooms.flatMap(wallsOf),
    openings: [],
    furniture,
    rooms,
    axes: [],
    dimensions: [],
    notes: [],
  }) as SpatialGraph;

const item = (
  id: string,
  kind: Furniture['kind'],
  [w, d]: [number, number],
  x: number,
  y: number,
  extra: Partial<Furniture> = {},
): Furniture =>
  ({
    ...AI,
    id,
    levelId: 'L-1',
    kind,
    centre: { x, y },
    boundingBox: { min: { x: x - w / 2, y: y - d / 2 }, max: { x: x + w / 2, y: y + d / 2 } },
    rotationDeg: 0,
    ...extra,
  }) as Furniture;
const wc = (id: string, x: number, y: number, extra: Partial<Furniture> = {}) =>
  item(id, 'sanitaryFixture', [400, 700], x, y, { variant: 'wc', rotationDeg: 0.01, ...extra } as Partial<Furniture>);
const basin = (id: string, x: number, y: number, extra: Partial<Furniture> = {}) =>
  item(id, 'sanitaryFixture', [600, 450], x, y, { variant: 'basin', ...extra } as Partial<Furniture>);

const BED_ROOM = room('R-BED', 'bedroom', box(0, 0, 4000, 3500), 'Phòng ngủ');
const BATH = room('R-WC', 'bathroom', box(4000, 0, 6000, 2000), 'WC');
const byId = (g: SpatialGraph, id: string) => g.furniture.find((f) => f.id === id);
const validIn = (g: SpatialGraph, f: Furniture, r: Room): boolean =>
  rectInsidePolygon(rectOfFurniture(f), r.outline, 100) && !wallRects(g, 'L-1').some((w) => rectsOverlap(rectOfFurniture(f), w));

describe('repairScene', () => {
  it('roomMismatch: bồn cầu AI trong phòng ngủ dời sang WC cùng tầng, áp tường', () => {
    const g = graphOf([BED_ROOM, BATH], [wc('F-wc', 1000, 1000, { roomId: 'R-BED' } as Partial<Furniture>)]);
    const { graph, repairs } = repairScene(g);
    expect(repairs).toHaveLength(1);
    expect(repairs[0]).toMatchObject({ furnitureId: 'F-wc', action: 'moved', rule: 'roomMismatch' });
    expect(repairs[0]?.reasonVi).toContain('“WC”');
    const moved = byId(graph, 'F-wc') as Furniture;
    expect(moved.roomId).toBe('R-WC');
    expect(validIn(graph, moved, BATH)).toBe(true);
    expect(sanitaryPlacementIssues(graph).filter((i) => i.kind === 'roomMismatch')).toEqual([]);
    // Dữ liệu vào không đổi.
    expect(byId(g, 'F-wc')?.centre).toEqual({ x: 1000, y: 1000 });
  });

  it('roomMismatch: không có WC còn chỗ → ẩn có lý do; WC đã có bồn cầu cũng không nhận thêm', () => {
    const g = graphOf([BED_ROOM, BATH], [wc('F-wc', 1000, 1000), wc('F-own', 5000, 600, HUMAN)]);
    const { graph, repairs } = repairScene(g);
    expect(repairs.map((r) => [r.furnitureId, r.action, r.rule])).toEqual([['F-wc', 'hidden', 'roomMismatch']]);
    expect(repairs[0]?.after).toBeUndefined();
    expect(byId(graph, 'F-wc')).toBeUndefined();
    expect(byId(graph, 'F-own')).toBe(byId(g, 'F-own'));
  });

  it('không đụng món người dùng đã xác nhận (human / reviewed / edited) và món gợi ý', () => {
    const g = graphOf(
      [BED_ROOM, BATH],
      [
        wc('F-h', 1000, 1000, HUMAN),
        wc('F-e', 2500, 1000, { edited: true }),
        item('F-bed', 'bed', [1600, 2000], 300, 1500, { reviewed: true }),
        item('F-s', 'bed', [1600, 2000], 300, 1500, { suggested: true } as Partial<Furniture>),
      ],
    );
    const { graph, repairs } = repairScene(g);
    expect(repairs).toEqual([]);
    expect(graph).toBe(g);
  });

  it('outsideRoom: giường AI lòi ra ngoài nhà dịch vào trong (≤ 1,5 m), sát tường', () => {
    const g = graphOf([BED_ROOM], [item('F-bed', 'bed', [1600, 2000], 300, 1500)]);
    const { graph, repairs } = repairScene(g);
    expect(repairs[0]).toMatchObject({ furnitureId: 'F-bed', action: 'moved', rule: 'outsideRoom' });
    const bed = byId(graph, 'F-bed') as Furniture;
    expect(validIn(graph, bed, BED_ROOM)).toBe(true);
    expect(bed.centre).toEqual({ x: 900, y: 1500 });
  });

  it('outsideRoom: không có chỗ hợp lệ → ẩn', () => {
    const tiny = room('R-T', 'bedroom', box(0, 0, 1500, 1500));
    const { graph, repairs } = repairScene(graphOf([tiny], [item('F-bed', 'bed', [1600, 2000], 750, 750)]));
    expect(repairs[0]).toMatchObject({ action: 'hidden', rule: 'outsideRoom' });
    expect(repairs[0]?.reasonVi).toContain('1,5 m');
    expect(graph.furniture).toEqual([]);
  });

  it('outsideRoom: tâm rơi vào dải phòng hẹp → dịch sang phòng chứa phần lớn thân món', () => {
    const strip = room('R-S', 'other', box(0, 0, 4000, 600), 'Hành lang hẹp');
    const bed = room('R-B', 'bedroom', box(0, 600, 4000, 4000), 'Phòng ngủ');
    const { graph, repairs } = repairScene(graphOf([strip, bed], [item('F-bed', 'bed', [1600, 2000], 2000, 500, { roomId: 'R-S' } as Partial<Furniture>)]));
    expect(repairs[0]).toMatchObject({ action: 'moved', rule: 'outsideRoom' });
    expect(repairs[0]?.reasonVi).toContain('dịch sang “Phòng ngủ”');
    expect(byId(graph, 'F-bed')?.roomId).toBe('R-B');
  });

  it('outsideRoom: phòng vừa khít giường → nới tới ngưỡng bộ báo lỗi (lấn ≤ 50 mm) thay vì ẩn', () => {
    const snug = room('R-N', 'bedroom', box(0, 0, 1750, 2200), 'Phòng ngủ nhỏ');
    const { graph, repairs } = repairScene(graphOf([snug], [item('F-bed', 'bed', [1600, 2000], 500, 1100)]));
    expect(repairs[0]).toMatchObject({ action: 'moved', rule: 'outsideRoom' });
    expect(scenePlacementIssues(graph)).toEqual([]);
    expect(repairScene(graph).repairs).toEqual([]);
  });

  it('wallOverlap: giường lấn thân tường > 50 mm (vẫn trong outline) dịch ra', () => {
    const { graph, repairs } = repairScene(graphOf([BED_ROOM], [item('F-bed', 'bed', [1600, 2000], 840, 1500)]));
    expect(repairs[0]).toMatchObject({ action: 'moved', rule: 'wallOverlap' });
    expect(scenePlacementIssues(graph)).toEqual([]);
  });

  it('notAgainstWall: tủ áo AI đứng giữa phòng áp lưng vào tường gần nhất', () => {
    const { graph, repairs } = repairScene(graphOf([BED_ROOM], [item('F-wr', 'wardrobe', [1800, 600], 2000, 1750)]));
    expect(repairs[0]).toMatchObject({ furnitureId: 'F-wr', action: 'moved', rule: 'notAgainstWall' });
    const wr = byId(graph, 'F-wr') as Furniture;
    expect(wr.centre).toEqual({ x: 2000, y: 401 });
    // Mặt trước (+y riêng) quay vào phòng: góc 0 (ghi 360 để orientDetected không quay lại).
    expect(wr.rotationDeg % 360).toBe(0);
  });

  it('overlap: đồ nhỏ AI chồng lên giường thì nhường; món người dùng luôn được giữ', () => {
    const g = graphOf(
      [BED_ROOM],
      [
        item('F-bed', 'bed', [1600, 2000], 2000, 1500),
        item('F-ns', 'table', [450, 400], 2000, 2400),
        item('F-tb', 'table', [1200, 800], 1000, 3000, HUMAN),
        item('F-ch', 'washingMachine', [600, 600], 1000, 3000, { rotationDeg: 0.01 }),
      ],
    );
    const { graph, repairs } = repairScene(g);
    expect(repairs.map((r) => [r.furnitureId, r.rule]).sort()).toEqual([
      ['F-ch', 'overlap'],
      ['F-ns', 'overlap'],
    ]);
    expect(byId(graph, 'F-bed')).toBe(byId(g, 'F-bed'));
    expect(byId(graph, 'F-tb')).toBe(byId(g, 'F-tb'));
    expect(scenePlacementIssues(graph).filter((i) => i.kind === 'overlap')).toEqual([]);
  });

  it('ghế kê dưới bàn không phải lỗi chồng; bàn dời thì ghế đi theo', () => {
    const g = graphOf(
      [BED_ROOM],
      [
        item('F-tb', 'table', [1400, 800], 900, 1750),
        item('F-c1', 'chair', [450, 450], 900, 1300, { rotationDeg: 0.01 }),
        item('F-c2', 'chair', [450, 450], 900, 2200, { rotationDeg: 180 }),
      ],
    );
    // Bàn lấn thân tường trái 100 mm (mép trái x = 0, mặt tường x = 100).
    const shifted = { ...g, furniture: g.furniture.map((f) => (f.id === 'F-tb' ? item('F-tb', 'table', [1400, 800], 700, 1750) : f)) };
    const { graph, repairs } = repairScene(shifted);
    expect(repairs.map((r) => [r.furnitureId, r.rule])).toEqual([
      ['F-tb', 'wallOverlap'],
      ['F-c1', 'overlap'],
      ['F-c2', 'overlap'],
    ]);
    const dx = (byId(graph, 'F-tb')?.centre.x ?? 0) - 700;
    expect(byId(graph, 'F-c1')?.centre.x).toBe(900 + dx);
    expect(repairScene(g).repairs).toEqual([]);
    expect(scenePlacementIssues(g)).toEqual([]);
  });

  it('duplicateFixture: hai bồn cầu một phòng → ẩn món AI thừa, giữ món người dùng', () => {
    const bath = room('R-B', 'bathroom', box(0, 0, 3000, 2400), 'Phòng tắm');
    const ai = repairScene(graphOf([bath], [wc('F-a', 600, 700), wc('F-b', 2000, 700)]));
    expect(ai.repairs.map((r) => [r.furnitureId, r.action, r.rule])).toEqual([['F-b', 'hidden', 'duplicateFixture']]);
    const mixed = repairScene(graphOf([bath], [wc('F-a', 600, 700), wc('F-b', 2000, 700, HUMAN)]));
    expect(mixed.repairs.map((r) => [r.furnitureId, r.action])).toEqual([['F-a', 'hidden']]);
  });

  it('facing: bồn cầu AI đối diện lavabo xoay 90°', () => {
    const bath = room('R-B', 'bathroom', box(0, 0, 2400, 2400), 'Phòng tắm');
    const g = graphOf([bath], [wc('F-wc', 600, 500), basin('F-bs', 600, 1600, { rotationDeg: 180, ...HUMAN })]);
    const { graph, repairs } = repairScene(g);
    expect(repairs[0]).toMatchObject({ furnitureId: 'F-wc', action: 'rotated', rule: 'facing' });
    expect(sanitaryPlacementIssues(graph)).toEqual([]);
  });

  it('idempotent: sửa lần hai không đổi gì', () => {
    const g = graphOf(
      [BED_ROOM, BATH],
      [
        wc('F-wc', 1000, 2800),
        item('F-bed', 'bed', [1600, 2000], 300, 1500),
        item('F-ns', 'table', [450, 400], 300, 400),
        item('F-wr', 'wardrobe', [1800, 600], 2600, 1750),
        item('F-ch', 'chair', [450, 450], 900, 1500),
      ],
    );
    const first = repairScene(g);
    expect(first.repairs.length).toBeGreaterThan(2);
    const second = repairScene(first.graph);
    expect(second.repairs).toEqual([]);
    expect(second.graph.furniture).toEqual(first.graph.furniture);
    expect(repairScene(g)).toEqual(first);
  });

  it('reapplyRepairs: áp lại đúng lần sửa đã chốt; món người dùng vừa sửa/duyệt theo dữ liệu thật', () => {
    const g = graphOf([BED_ROOM, BATH], [wc('F-wc', 1000, 1000), item('F-bed', 'bed', [1600, 2000], 300, 1500)]);
    const first = repairScene(g);
    const frozen = freezeRepairs(g, first);
    expect(reapplyRepairs(g, frozen)).toEqual(first);
    // Người dùng dời giường (thành món đã sửa): lần sửa của giường không áp nữa, bồn cầu vẫn như lúc nạp.
    const edited = { ...g, furniture: g.furniture.map((f) => (f.id === 'F-bed' ? { ...f, centre: { x: 2000, y: 1500 }, edited: true } : f)) };
    const again = reapplyRepairs(edited, frozen);
    expect(again.repairs.map((r) => r.furnitureId)).toEqual(['F-wc']);
    expect(byId(again.graph, 'F-bed')?.centre).toEqual({ x: 2000, y: 1500 });
    expect(byId(again.graph, 'F-wc')).toEqual(byId(first.graph, 'F-wc'));
  });
});
