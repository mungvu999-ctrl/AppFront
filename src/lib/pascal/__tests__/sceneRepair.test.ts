/** Sửa cảnh cho đồ AI chưa xác nhận (`sceneRepair.ts`): từng luật, không đụng món người dùng, tính idempotent. */

import { describe, expect, it } from 'vitest';

import type { Furniture, Point, Room, RoomUsage, SpatialGraph, Wall } from '@/domain/spatial/types';

import { rectInsidePolygon, rectOfFurniture, rectsOverlap, scenePlacementIssues, wallRects } from '../placement';
import { sanitaryPlacementIssues } from '../sanitaryRules';
import { createRepairSession, repairScene, sessionRepairs } from '../sceneRepair';

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

  it('outsideRoom: giường lòi tường không có chỗ hợp lệ → giữ nguyên, không ẩn (lỗi còn trên chip)', () => {
    const tiny = room('R-T', 'bedroom', box(0, 0, 1500, 1500));
    const g = graphOf([tiny], [item('F-bed', 'bed', [1600, 2000], 750, 750)]);
    const { graph, repairs } = repairScene(g);
    expect(repairs).toEqual([]);
    expect(graph).toBe(g);
    expect(scenePlacementIssues(graph).some((i) => i.furnitureIds.includes('F-bed'))).toBe(true);
  });

  it('overlap: món nhỏ chồng lên đồ chính, không còn chỗ → ẩn; đồ chính chồng nhau không còn chỗ → giữ cả hai', () => {
    const snug = room('R-N', 'bedroom', box(0, 0, 2000, 2400));
    const small = repairScene(graphOf([snug], [item('F-bed', 'bed', [1600, 2000], 1000, 1200), item('F-x', 'other', [500, 400], 1000, 1200)]));
    expect(small.repairs.map((r) => [r.furnitureId, r.action, r.rule])).toEqual([['F-x', 'hidden', 'overlap']]);
    const g = graphOf([snug], [item('F-bed', 'bed', [1600, 2000], 1000, 1200), item('F-wr', 'wardrobe', [1600, 600], 1000, 1200, { rotationDeg: 0.01 })]);
    const big = repairScene(g);
    expect(big.repairs.filter((r) => r.action === 'hidden')).toEqual([]);
    expect(big.graph.furniture.map((f) => f.id).sort()).toEqual(['F-bed', 'F-wr']);
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

  it('sessionRepairs: cùng đầu vào → đúng kết quả cũ (không tính lại); dời tường làm món hợp lệ → hết sửa, không tải lại', () => {
    const g = graphOf([BED_ROOM, BATH], [wc('F-wc', 1000, 1000), item('F-bed', 'bed', [1600, 2000], 300, 1500)]);
    const session = createRepairSession();
    const first = sessionRepairs(session, g);
    expect(first).toEqual(repairScene(g));
    expect(first.repairs.map((r) => r.furnitureId).sort()).toEqual(['F-bed', 'F-wc']);
    // Đồ thị mới cùng nội dung (kho dựng lại mảng) → không tính lại (cùng danh sách sửa).
    expect(sessionRepairs(session, { ...g, furniture: [...g.furniture] }).repairs).toBe(first.repairs);

    // Nới phòng ngủ sang trái 1 m (dời tường): giường không còn lòi → luật không dời nó nữa; bồn cầu vẫn sửa như cũ.
    const wider = room('R-BED', 'bedroom', box(-1000, 0, 4000, 3500), 'Phòng ngủ');
    const moved = graphOf([wider, BATH], [...g.furniture]);
    const again = sessionRepairs(session, moved);
    expect(again.repairs.map((r) => r.furnitureId)).toEqual(['F-wc']);
    expect(byId(again.graph, 'F-bed')).toBe(byId(moved, 'F-bed'));
    expect(byId(again.graph, 'F-wc')).toEqual(byId(first.graph, 'F-wc'));
  });

  it('sessionRepairs: món người dùng đã đụng trong phiên không bị sửa lại (kể cả khi kéo về chỗ cũ); món AI chưa đụng sửa theo dữ liệu mới', () => {
    const g = graphOf([BED_ROOM, BATH], [wc('F-wc', 1000, 1000), item('F-bed', 'bed', [1600, 2000], 300, 1500)]);
    const session = createRepairSession();
    sessionRepairs(session, g);
    // Người dùng kéo giường tới chỗ vẫn lòi tường (lượt PUT chưa về nên chưa có `edited`): luật không kéo nó đi.
    const dragged = { ...g, furniture: g.furniture.map((f) => (f.id === 'F-bed' ? { ...f, centre: { x: 200, y: 1600 }, boundingBox: { min: { x: -600, y: 600 }, max: { x: 1000, y: 2600 } } } : f)) };
    const after = sessionRepairs(session, dragged);
    expect(after.repairs.map((r) => r.furnitureId)).toEqual(['F-wc']);
    expect(byId(after.graph, 'F-bed')).toBe(byId(dragged, 'F-bed'));
    expect(byId(after.graph, 'F-bed')?.edited).toBeUndefined();
    // Hoàn tác về đúng dữ liệu gốc: vẫn là món đã đụng trong phiên (như cờ `edited` máy chủ đặt).
    expect(sessionRepairs(session, g).repairs.map((r) => r.furnitureId)).toEqual(['F-wc']);
    expect(session.firstSeen.get('F-bed' as never)).toBe(byId(g, 'F-bed'));
    // Chỉ đổi `roomId` (tách phòng) không phải "đụng".
    const relabelled = { ...g, furniture: g.furniture.map((f) => (f.id === 'F-wc' ? { ...f, roomId: 'R-BED' } as Furniture : f)) };
    expect(sessionRepairs(session, relabelled).repairs.map((r) => r.furnitureId)).toEqual(['F-wc']);
  });

  it('sessionRepairs: chỉ đổi tầng/mái/trục (chữ ký sửa cảnh không đổi) → đồ thị trả về theo dữ liệu mới, không phải lượt trước', () => {
    const session = createRepairSession();
    // Một lượt có sửa (bồn cầu trong phòng ngủ), một lượt không sửa gì (bàn giữa phòng).
    for (const [furniture, repaired] of [
      [[wc('F-wc', 1000, 1000)], 1],
      [[item('F-table', 'table', [1200, 600], 2000, 1750)], 0],
    ] as const) {
      const g = graphOf([BED_ROOM, BATH], [...furniture]);
      sessionRepairs(session, g);
      const roof = { ...HUMAN, id: 'RF-1', levelId: 'L-1', outline: box(0, 0, 6000, 3500) };
      const next = { ...g, levels: [{ ...g.levels[0]!, heightMm: 3300 }], roofs: [roof] } as unknown as SpatialGraph;
      const result = sessionRepairs(session, next);
      expect(result.repairs).toHaveLength(repaired);
      expect(result.graph.levels[0]?.heightMm).toBe(3300);
      expect((result.graph as unknown as { roofs?: unknown[] }).roofs).toEqual([roof]);
    }
  });

  it('outside: món AI ngoài nhà cách phòng hợp lệ ≤ 3 m dời vào phòng; xa hơn thì ẩn kèm lý do; món người dùng giữ nguyên', () => {
    const g = graphOf(
      [BED_ROOM, BATH],
      [
        item('F-near', 'table', [800, 500], 2000, 4500),
        item('F-far', 'table', [800, 500], 2000, 12000),
        item('F-mine', 'table', [800, 500], 2000, 13000, HUMAN),
        item('F-sug', 'bed', [1600, 2000], 20000, 1500, { suggested: true }),
      ],
    );
    const { graph, repairs } = repairScene(g);
    const near = byId(graph, 'F-near');
    expect(near).toBeDefined();
    expect(validIn(graph, near as Furniture, BED_ROOM)).toBe(true);
    expect(near?.roomId).toBe('R-BED');
    const rep = (id: string) => repairs.find((r) => r.furnitureId === id);
    expect(rep('F-near')).toMatchObject({ action: 'moved', rule: 'outside' });
    expect(rep('F-near')?.reasonVi).toContain('nằm ngoài nhà: dời vào “Phòng ngủ”');
    expect(rep('F-far')).toMatchObject({ action: 'hidden', rule: 'outside', reasonVi: 'Món AI nằm ngoài nhà, không có chỗ hợp lệ' });
    expect(rep('F-sug')).toMatchObject({ action: 'hidden', rule: 'outside' });
    expect(byId(graph, 'F-far')).toBeUndefined();
    expect(byId(graph, 'F-mine')).toBe(byId(g, 'F-mine'));
    expect(rep('F-mine')).toBeUndefined();
    // Món người dùng vẫn là lỗi trên chip; đồ AI đã xử lý hết.
    expect(scenePlacementIssues(graph).filter((i) => i.kind === 'outside').map((i) => i.furnitureIds[0])).toEqual(['F-mine']);
    // Tất định + idempotent.
    expect(repairScene(g)).toEqual({ graph, repairs });
    expect(repairScene(graph).repairs).toEqual([]);
  });

  it('outside: chỉ phòng sai vai trong tầm (bồn cầu cạnh phòng ngủ, không WC gần) → ẩn; tầng không có phòng → không sửa', () => {
    const g = graphOf([BED_ROOM], [wc('F-wc', 2000, 4500)]);
    expect(repairScene(g).repairs).toMatchObject([{ furnitureId: 'F-wc', action: 'hidden', rule: 'outside' }]);
    const bare = graphOf([], [item('F-t', 'table', [800, 500], 2000, 12000)]);
    expect(repairScene(bare).repairs).toEqual([]);
  });

  describe('đồ bám tường chồng nhau: trượt dọc tường, không đẩy ra giữa phòng', () => {
    // Tủ bếp sâu 600, lưng sát mặt trong tường dưới (y = 100), mặt quay vào phòng (góc 360 = 0, `orientDetected` không quay lại).
    const cab = (id: string, x: number, w: number) => item(id, 'kitchenCabinet', [w, 600], x, 405, { rotationDeg: 360 } as Partial<Furniture>);
    /** Bất biến: lưng món (đẩy lùi 150 mm) còn chạm thân tường. */
    const onWall = (g: SpatialGraph, f: Furniture): boolean => {
      const r = rectOfFurniture(f);
      const t = (r.rotationDeg * Math.PI) / 180;
      const back = { ...r, cx: r.cx + Math.sin(t) * 150, cy: r.cy - Math.cos(t) * 150 };
      return wallRects(g, 'L-1').some((w) => rectsOverlap(back, w));
    };

    it('dãy 3 tủ chờm nhau 100 mm: là dãy tủ, không sửa, không lỗi chồng', () => {
      const g = graphOf([BED_ROOM], [cab('F-a', 600, 300), cab('F-b', 800, 300), cab('F-c', 1000, 300)]);
      expect(repairScene(g).repairs).toEqual([]);
      expect(scenePlacementIssues(g).filter((i) => i.kind === 'overlap')).toEqual([]);
    });

    it('2 tủ chồng 600 mm, tường còn trống: món nhường trượt dọc tường, giữ khoảng cách tường', () => {
      const g = graphOf([BED_ROOM], [cab('F-a', 1000, 1200), cab('F-b', 1600, 1200)]);
      const { graph, repairs } = repairScene(g);
      expect(repairs).toMatchObject([{ furnitureId: 'F-b', action: 'moved', rule: 'overlap' }]);
      expect(repairs[0]?.reasonVi).toContain('trượt dọc tường');
      const b = byId(graph, 'F-b') as Furniture;
      expect(b.centre.y).toBe(405);
      expect(b.centre.x).toBeGreaterThan(1600);
      expect(onWall(graph, b)).toBe(true);
      expect(scenePlacementIssues(graph).filter((i) => i.kind === 'overlap')).toEqual([]);
    });

    it('không có chỗ dọc tường: giữ nguyên, lỗi chồng còn trên chip (không đẩy ra giữa phòng)', () => {
      const KITCHEN = room('R-K', 'kitchen', box(0, 0, 2300, 3000), 'Bếp');
      const g = graphOf([KITCHEN], [cab('F-a', 700, 1200), cab('F-b', 1300, 1200)]);
      const { graph, repairs } = repairScene(g);
      expect(repairs).toEqual([]);
      expect(byId(graph, 'F-b')).toBe(byId(g, 'F-b'));
      expect(scenePlacementIssues(graph).some((i) => i.kind === 'overlap' && i.furnitureIds.includes('F-b'))).toBe(true);
    });
  });

  describe('fit (vòng 6, luật A): xoay đúng trục + kẹp cỡ về hồ sơ vai', () => {
    const chair = (id: string, w: number, d: number, x: number, y: number, extra: Partial<Furniture> = {}) =>
      item(id, 'chair', [w, d], x, y, { roomId: 'R-BED', rotationDeg: 0.01, ...extra } as Partial<Furniture>);
    const sides = (f: Furniture) => [f.boundingBox.max.x - f.boundingBox.min.x, f.boundingBox.max.y - f.boundingBox.min.y];

    it('bàn làm việc AI dài theo chiều sâu: xoay 90°, đổi hai cạnh, dấu chân và tâm giữ nguyên', () => {
      const desk = item('F-desk', 'table', [600, 1200], 2000, 1750, { roomId: 'R-BED', rotationDeg: 0.01 } as Partial<Furniture>);
      const { graph, repairs } = repairScene(graphOf([BED_ROOM], [desk]));
      expect(repairs).toMatchObject([{ furnitureId: 'F-desk', action: 'rotated', rule: 'fit' }]);
      const after = byId(graph, 'F-desk') as Furniture;
      expect(sides(after)).toEqual([1200, 600]);
      expect(after.centre).toEqual(desk.centre);
      expect(Math.round(after.rotationDeg)).toBe(90);
      expect(repairs[0]?.after?.boundingBox).toEqual(after.boundingBox);
    });

    it('ghế ăn AI sâu 0,30 m: kẹp sâu về dải vai (0,38 m), lý do hiện trên chip; ghế người dùng không đụng', () => {
      const g = graphOf([BED_ROOM], [chair('F-ai', 480, 300, 1000, 1750), chair('F-me', 480, 300, 3000, 1750, HUMAN)]);
      const { graph, repairs } = repairScene(g);
      expect(repairs.map((r) => [r.furnitureId, r.action, r.rule])).toEqual([['F-ai', 'rescaled', 'fit']]);
      expect(repairs[0]?.reasonVi).toContain('kẹp về 0,48 × 0,38 m');
      expect(sides(byId(graph, 'F-ai') as Furniture)).toEqual([480, 378]);
      expect(byId(graph, 'F-me')).toBe(byId(g, 'F-me'));
      // Idempotent, và tắt riêng bằng ?disable=fit.
      expect(repairScene(graph).repairs).toEqual([]);
      expect(repairScene(g, new Set(['fit'])).repairs).toEqual([]);
    });

    it('món đã sửa (edited) hoặc sai nặng (< ½ p10): để nguyên, không ẩn', () => {
      const g = graphOf([BED_ROOM], [chair('F-edit', 480, 300, 1000, 1750, { edited: true }), chair('F-tiny', 200, 50, 3000, 1750)]);
      const { graph, repairs } = repairScene(g);
      expect(repairs).toEqual([]);
      expect(byId(graph, 'F-tiny')).toBe(byId(g, 'F-tiny'));
      expect(byId(graph, 'F-edit')).toBe(byId(g, 'F-edit'));
    });

    it('kẹp làm món mới lấn tường (> 50 mm) thì giữ nguyên món — không tăng lỗi đặt đồ', () => {
      // Lưng ghế cách mặt trong tường 30 mm lấn (chưa lỗi); sâu 0,30 → 0,38 m thì lấn 69 mm.
      const g = graphOf([BED_ROOM], [chair('F-wall', 480, 300, 1000, 220)]);
      expect(scenePlacementIssues(g)).toEqual([]);
      const { graph, repairs } = repairScene(g);
      expect(repairs).toEqual([]);
      expect(scenePlacementIssues(graph)).toEqual([]);
    });

    it('tủ áo bám tường sâu 0,30 m: kẹp sâu, lưng vẫn áp tường (tâm dịch theo mặt trước)', () => {
      const closet = item('F-closet', 'wardrobe', [1000, 300], 2000, 251, { roomId: 'R-BED', rotationDeg: 0.01 } as Partial<Furniture>);
      const { graph, repairs } = repairScene(graphOf([BED_ROOM], [closet]));
      expect(repairs).toMatchObject([{ furnitureId: 'F-closet', action: 'rescaled', rule: 'fit' }]);
      const after = byId(graph, 'F-closet') as Furniture;
      expect(sides(after)).toEqual([1000, 381]);
      expect(Math.abs(after.centre.y - 381 / 2 - (251 - 150))).toBeLessThanOrEqual(1);
    });
  });

  describe('doorSwing (vòng 6, luật E): đồ AI chắn lối mở cửa', () => {
    const doorOn = (r: Room, offsetMm: number) =>
      ({ ...HUMAN, id: 'D-1', levelId: 'L-1', wallId: `W-${r.id}-0`, kind: 'door', offsetMm, widthMm: 900, heightMm: 2100, sillHeightMm: 0, swing: 'left' }) as unknown as SpatialGraph['openings'][number];
    const withDoor = (r: Room, furniture: Furniture[], offsetMm = 1500): SpatialGraph => ({ ...graphOf([r], furniture), openings: [doorOn(r, offsetMm)] });
    const chair = (id: string, x: number, y: number, extra: Partial<Furniture> = {}) =>
      item(id, 'chair', [480, 480], x, y, { roomId: r0.id, rotationDeg: 0.01, ...extra } as Partial<Furniture>);
    const r0 = BED_ROOM;
    const blocks = (g: SpatialGraph, id: string) => scenePlacementIssues(g).some((i) => i.kind === 'doorSwing' && i.furnitureIds.includes(id));

    it('ghế AI trong vùng mở cửa: dời ra chỗ hợp lệ gần nhất, lý do trên chip; ghế người dùng giữ nguyên', () => {
      const g = withDoor(r0, [chair('F-ai', 1950, 500)]);
      expect(blocks(g, 'F-ai')).toBe(true);
      const { graph, repairs } = repairScene(g);
      expect(repairs).toMatchObject([{ furnitureId: 'F-ai', action: 'moved', rule: 'doorSwing' }]);
      expect(repairs[0]?.reasonVi).toContain('chắn lối mở cửa');
      expect(blocks(graph, 'F-ai')).toBe(false);
      expect(repairScene(graph).repairs).toEqual([]);

      const mine = withDoor(r0, [chair('F-me', 1950, 500, HUMAN)]);
      expect(repairScene(mine).repairs).toEqual([]);
      expect(repairScene(g, new Set(['door'])).repairs).toEqual([]);
    });

    it('không có chỗ hợp lệ (phòng nhỏ hơn vùng mở cửa): giữ nguyên, không ẩn, lỗi còn trên chip', () => {
      const tiny = room('R-T', 'other', box(0, 0, 1000, 1100), 'Kho');
      const g = withDoor(tiny, [item('F-ai', 'chair', [480, 480], 500, 500, { roomId: 'R-T', rotationDeg: 0.01 } as Partial<Furniture>)], 50);
      const { graph, repairs } = repairScene(g);
      expect(repairs).toEqual([]);
      expect(byId(graph, 'F-ai')).toBe(byId(g, 'F-ai'));
      expect(blocks(graph, 'F-ai')).toBe(true);
    });
  });
});
