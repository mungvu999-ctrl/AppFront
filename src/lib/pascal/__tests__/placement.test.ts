/** Hình học đặt đồ sinh ra (J10): SAT, nằm trong phòng chữ L, vùng mở cửa, cạnh phòng. */

import { describe, expect, it } from 'vitest';

import { createSampleBuilding } from '@/domain/spatial/__fixtures__/sampleBuilding';
import type { Furniture, Opening, Point, Room, SpatialGraph, Wall } from '@/domain/spatial/types';

import {
  doorSwingRects,
  furnitureFacingDeg,
  outsideAllRooms,
  rectCorners,
  rectInsidePolygon,
  rectOfFurniture,
  rectsOverlap,
  roomEdges,
  scenePlacementIssues,
  wallRects,
  type Rect,
} from '../placement';

const LEVEL = 'L-LEVEL00' as const;
const rect = (cx: number, cy: number, w: number, d: number, rotationDeg = 0): Rect => ({ cx, cy, w, d, rotationDeg });
const meta = { source: 'ai', reviewed: false, confidence: 1 } as const;

const wallOf = (id: string, start: Point, end: Point, openingIds: string[] = []): Wall =>
  ({ ...meta, id, levelId: LEVEL, centreline: { start, end }, thicknessMm: 200, heightMm: 2700, kind: 'partition', openingIds }) as Wall;
const doorOf = (id: string, wallId: string, offsetMm: number, swing: Opening['swing'] = 'left', kind: Opening['kind'] = 'door'): Opening =>
  ({ ...meta, id, wallId, kind, offsetMm, widthMm: 900, heightMm: 2100, sillHeightMm: 0, swing }) as Opening;
const graphOf = (walls: Wall[], openings: Opening[]): SpatialGraph => ({ ...createSampleBuilding(), walls, openings, furniture: [], rooms: [] });

describe('rectsOverlap — SAT', () => {
  it('thanh xoay 45° không chạm ô vuông nằm trong hộp bao trục của nó', () => {
    const bar = rect(0, 0, 2000, 200, 45);
    expect(rectsOverlap(bar, rect(600, -600, 200, 200))).toBe(false);
    expect(rectsOverlap(bar, rect(600, 600, 200, 200))).toBe(true);
  });

  it('chạm mép không tính là chồng; khe tối thiểu thì có', () => {
    expect(rectsOverlap(rect(0, 0, 1000, 1000), rect(1000, 0, 1000, 1000))).toBe(false);
    expect(rectsOverlap(rect(0, 0, 1000, 1000), rect(1030, 0, 1000, 1000))).toBe(false);
    expect(rectsOverlap(rect(0, 0, 1000, 1000), rect(1030, 0, 1000, 1000), 50)).toBe(true);
  });
});

describe('rectInsidePolygon — phòng chữ L', () => {
  const L: Point[] = [
    { x: 0, y: 0 },
    { x: 4000, y: 0 },
    { x: 4000, y: 2000 },
    { x: 2000, y: 2000 },
    { x: 2000, y: 4000 },
    { x: 0, y: 4000 },
  ];

  it('trong từng nhánh: được; đè lên góc lõm: không', () => {
    expect(rectInsidePolygon(rect(1000, 3000, 1000, 1000), L, 100)).toBe(true);
    expect(rectInsidePolygon(rect(2000, 1000, 3000, 600), L, 100)).toBe(true);
    expect(rectInsidePolygon(rect(2000, 2000, 1000, 1000), L, 100)).toBe(false);
    // Thanh xoay 135° vắt qua góc lõm: cả 4 góc nằm trong hai nhánh, nhưng đỉnh lõm lọt vào giữa.
    expect(rectInsidePolygon(rect(2000, 2000, 1500, 300, 135), L, 100)).toBe(false);
    expect(rectInsidePolygon(rect(1000, 1000, 1500, 300, 135), L, 100)).toBe(true);
  });

  it('lùi mép: đúng bằng inset thì được, thiếu thì không', () => {
    expect(rectInsidePolygon(rect(300, 300, 400, 400), L, 100)).toBe(true);
    expect(rectInsidePolygon(rect(300, 300, 400, 400), L, 150)).toBe(false);
    expect(rectInsidePolygon(rect(Number.NaN, 300, 400, 400), L, 100)).toBe(false);
    expect(roomEdges({ levelId: LEVEL, outline: [...L, { x: Number.NaN, y: 0 }] }, graphOf([], []))).toEqual([]);
  });
});

describe('doorSwingRects', () => {
  const wall = wallOf('W-A', { x: 0, y: 0 }, { x: 4000, y: 0 });

  it('cửa bản lề: rộng × rộng ở CẢ HAI bên tường; cửa sổ thì không', () => {
    const rects = doorSwingRects(graphOf([wall], [doorOf('O-D', 'W-A', 1000), doorOf('O-W', 'W-A', 2500, 'fixed', 'window')]), LEVEL);
    expect(rects).toHaveLength(2);
    expect(rects.map((r) => [r.cx, Math.round(r.cy), r.w, r.d])).toEqual([
      [1450, 550, 900, 900],
      [1450, -550, 900, 900],
    ]);
  });

  it('cửa trượt: rộng × 600; tường tầng khác: bỏ', () => {
    const rects = doorSwingRects(graphOf([wall], [doorOf('O-D', 'W-A', 1000, 'sliding')]), LEVEL);
    expect(rects.map((r) => [Math.round(r.cy), r.d])).toEqual([
      [400, 600],
      [-400, 600],
    ]);
    expect(doorSwingRects(graphOf([{ ...wall, levelId: 'L-OTHER' } as Wall], [doorOf('O-D', 'W-A', 1000)]), LEVEL)).toEqual([]);
  });
});

describe('doorSwingRects — chỉ phía cánh mở (vòng 18)', () => {
  // Tường y = 0: phía +y (pháp tuyến trái) là phòng ngủ 3×3 m, phía −y là phòng khách 4×4 m lớn hơn.
  const wall = wallOf('W-A', { x: 0, y: 0 }, { x: 4000, y: 0 });
  const roomOf = (id: string, usage: Room['usage'], y0: number, y1: number, x1: number): Room =>
    ({ ...meta, id, levelId: LEVEL, name: id, usage, areaM2: (x1 * Math.abs(y1 - y0)) / 1e6, wallIds: [], outline: [{ x: 0, y: y0 }, { x: x1, y: y0 }, { x: x1, y: y1 }, { x: 0, y: y1 }] }) as Room;
  const bed = roomOf('R-BED', 'bedroom', 0, 3000, 3000);
  const living = roomOf('R-LIV', 'livingRoom', -4000, 0, 4000);
  const withRooms = (rooms: Room[], openings: Opening[]): SpatialGraph => ({ ...graphOf([wall], openings), rooms });

  it('cửa giữa hai phòng: một vùng, ở phòng nhỏ hơn (phía cánh mở); phòng kia không bị chặn', () => {
    const rects = doorSwingRects(withRooms([bed, living], [doorOf('O-D', 'W-A', 1000)]), LEVEL);
    expect(rects.map((r) => [r.cx, Math.round(r.cy), r.w, r.d])).toEqual([[1450, 550, 900, 900]]);
  });

  it('"Đổi hướng mở" (reversed) đưa vùng sang phía kia', () => {
    const rects = doorSwingRects(withRooms([bed, living], [{ ...doorOf('O-D', 'W-A', 1000), reversed: true }]), LEVEL);
    expect(rects.map((r) => Math.round(r.cy))).toEqual([-550]);
  });

  it('cửa tường bao (một bên ngoài nhà): vùng ở phía phòng; cửa trượt vẫn hai bên', () => {
    expect(doorSwingRects(withRooms([living], [doorOf('O-D', 'W-A', 1000)]), LEVEL).map((r) => Math.round(r.cy))).toEqual([-550]);
    expect(doorSwingRects(withRooms([bed, living], [doorOf('O-D', 'W-A', 1000, 'sliding')]), LEVEL).map((r) => Math.round(r.cy))).toEqual([400, -400]);
  });
});

describe('roomEdges', () => {
  const outline: Point[] = [
    { x: 0, y: 0 },
    { x: 4000, y: 0 },
    { x: 4000, y: 3000 },
    { x: 0, y: 3000 },
  ];
  const room = { levelId: LEVEL, outline };

  it('pháp tuyến hướng vào trong, bất kể chiều outline', () => {
    const forward = roomEdges(room, graphOf([], []));
    expect(forward.map((e) => [e.lengthMm, e.inwardNormal.x, e.inwardNormal.y].map((v) => Math.round(v) + 0))).toEqual([
      [4000, 0, 1],
      [3000, -1, 0],
      [4000, 0, -1],
      [3000, 1, 0],
    ]);
    const backward = roomEdges({ levelId: LEVEL, outline: [...outline].reverse() }, graphOf([], []));
    // Cạnh đầu (0,3000)→(4000,3000) của outline đảo: vào trong là −y.
    expect([backward[0]?.inwardNormal.x, backward[0]?.inwardNormal.y].map((v) => Math.round(v ?? NaN) + 0)).toEqual([0, -1]);
  });

  it('một cửa trên tường cạnh phòng → một khoảng dọc cạnh đó, kể cả khi tường đi ngược', () => {
    const wall = wallOf('W-A', { x: 0, y: -100 }, { x: 4000, y: -100 });
    const edges = roomEdges(room, graphOf([wall], [doorOf('O-D', 'W-A', 1000)]));
    expect(edges[0]?.openings).toEqual([{ fromMm: 1000, toMm: 1900 }]);
    expect(edges.slice(1).every((e) => e.openings.length === 0)).toBe(true);

    const reversed = wallOf('W-B', { x: 4000, y: -100 }, { x: 0, y: -100 });
    expect(roomEdges(room, graphOf([reversed], [doorOf('O-D', 'W-B', 1000)]))[0]?.openings).toEqual([
      { fromMm: 2100, toMm: 3000 },
    ]);
  });

  it('tường thẳng hàng nhưng ngoài đoạn cạnh không phủ cạnh; tường phủ một phần → walled đúng đoạn đó', () => {
    // Tường trên đường y = 0 nhưng ở x ∈ [5000, 8000]: cạnh 0 (x ∈ [0, 4000]) không có tường.
    const elsewhere = wallOf('W-A', { x: 5000, y: 0 }, { x: 8000, y: 0 });
    const [edge] = roomEdges(room, graphOf([elsewhere], [doorOf('O-D', 'W-A', 500)]));
    expect(edge?.walled).toEqual([]);
    expect(edge?.wallHalfMm).toBe(0);
    expect(edge?.openings).toEqual([]);

    // Hai đoạn tường x ∈ [0, 1500] và [1600, 2500] (khe 100 mm coi là liền), x ∈ [2500, 4000] hở.
    const parts = [wallOf('W-B', { x: -100, y: 0 }, { x: 1500, y: 0 }), wallOf('W-C', { x: 1600, y: 0 }, { x: 2500, y: 0 })];
    expect(roomEdges(room, graphOf(parts, []))[0]?.walled).toEqual([{ fromMm: 0, toMm: 2500 }]);
  });

  it('tường xa cạnh hơn dày/2 + 50 mm không tính', () => {
    const far = wallOf('W-A', { x: 0, y: -300 }, { x: 4000, y: -300 });
    expect(roomEdges(room, graphOf([far], [doorOf('O-D', 'W-A', 1000)]))[0]?.openings).toEqual([]);
  });
});

describe('wallRects + wallHalfMm (C2)', () => {
  it('thân tường = dài tâm tường × dày, xoay theo tường; chỉ tường cùng tầng', () => {
    const wall = { ...wallOf('W-A', { x: 0, y: 0 }, { x: 0, y: 3000 }), thicknessMm: 300 };
    const other = { ...wallOf('W-B', { x: 0, y: 0 }, { x: 1000, y: 0 }), levelId: 'L-OTHER' } as Wall;
    const [r] = wallRects(graphOf([wall, other], []), LEVEL);
    expect(wallRects(graphOf([wall, other], []), LEVEL)).toHaveLength(1);
    expect(r).toMatchObject({ cx: 0, cy: 1500, w: 3000, d: 300, rotationDeg: 90 });
    // Món lùi 100 mm khỏi tâm tường 300 vẫn cắt thân tường; lùi 151 thì không.
    expect(rectsOverlap(rect(100 + 250, 1500, 500, 500), r as Rect)).toBe(true);
    expect(rectsOverlap(rect(151 + 250, 1500, 500, 500), r as Rect)).toBe(false);
  });

  it('cạnh phòng mang nửa dày lớn nhất của tường nằm trên nó; không tường → 0', () => {
    const outline: Point[] = [
      { x: 0, y: 0 },
      { x: 4000, y: 0 },
      { x: 4000, y: 3000 },
      { x: 0, y: 3000 },
    ];
    const thick = { ...wallOf('W-A', { x: 0, y: 0 }, { x: 4000, y: 0 }), thicknessMm: 300 };
    const edges = roomEdges({ levelId: LEVEL, outline }, graphOf([thick], []));
    expect(edges.map((e) => e.wallHalfMm)).toEqual([150, 0, 0, 0]);
  });
});

describe('furnitureFacingDeg + rectOfFurniture', () => {
  it('mặt trước (+y riêng) quay theo pháp tuyến', () => {
    expect([{ x: 0, y: 1 }, { x: -1, y: 0 }, { x: 0, y: -1 }, { x: 1, y: 0 }].map(furnitureFacingDeg)).toEqual([0, 90, 180, 270]);
    const n = { x: Math.SQRT1_2, y: Math.SQRT1_2 };
    const r = rect(0, 0, 2, 2, furnitureFacingDeg(n));
    const [, , c2, c3] = rectCorners(r);
    // Mép trước = cạnh góc 3→2 (y riêng = +1): trung điểm của nó nằm theo hướng n.
    expect(((c2?.x ?? 0) + (c3?.x ?? 0)) / 2).toBeCloseTo(n.x);
    expect(((c2?.y ?? 0) + (c3?.y ?? 0)) / 2).toBeCloseTo(n.y);
  });

  it('rectOfFurniture đọc khung riêng chưa xoay', () => {
    expect(
      rectOfFurniture({ centre: { x: 3000, y: 2000 }, boundingBox: { min: { x: 2000, y: 1700 }, max: { x: 4000, y: 2300 } }, rotationDeg: 90 }),
    ).toEqual(rect(3000, 2000, 2000, 600, 90));
  });
});

describe('outsideAllRooms + lỗi `outside` (món ngoài nhà)', () => {
  const sq = (x0: number, y0: number, x1: number, y1: number): Point[] => [
    { x: x0, y: y0 },
    { x: x1, y: y0 },
    { x: x1, y: y1 },
    { x: x0, y: y1 },
  ];
  const roomOf = (id: string, outline: Point[], levelId: string = LEVEL): Room => ({ ...meta, id, levelId, name: id, usage: 'other', outline, areaM2: 12, wallIds: [] }) as unknown as Room;
  const piece = (id: string, x: number, y: number, [w, d]: [number, number] = [1000, 600], extra: Partial<Furniture> = {}): Furniture =>
    ({ ...meta, id, levelId: LEVEL, kind: 'table', centre: { x, y }, boundingBox: { min: { x: x - w / 2, y: y - d / 2 }, max: { x: x + w / 2, y: y + d / 2 } }, rotationDeg: 0, ...extra }) as Furniture;
  const A = roomOf('R-A', sq(0, 0, 4000, 3000));
  const B = roomOf('R-B', sq(4000, 0, 8000, 3000));

  it('tâm ngoài mọi phòng → ngoài nhà; trong phòng → không', () => {
    expect(outsideAllRooms(piece('F-1', 10000, 1500), [A, B])).toBe(true);
    expect(outsideAllRooms(piece('F-2', 2000, 1500), [A, B])).toBe(false);
  });

  it('tâm trong phòng nhưng quá nửa thân ở ngoài → ngoài nhà; lòi ít → không', () => {
    // Bàn 3000 × 600 giữa phòng hẹp 1 m: chỉ 1/5 cột lưới mẫu trong phòng.
    expect(outsideAllRooms(piece('F-3', 500, 1500, [3000, 600]), [roomOf('R-N', sq(0, 0, 1000, 3000))])).toBe(true);
    expect(outsideAllRooms(piece('F-4', 3700, 1500, [1000, 600]), [A])).toBe(false);
  });

  it('món vắt qua hai phòng liền nhau là trong nhà', () => {
    expect(outsideAllRooms(piece('F-5', 4010, 1500, [2000, 600]), [A, B])).toBe(false);
    // Chỉ có một phòng thì cùng món đó quá nửa ở ngoài.
    expect(outsideAllRooms(piece('F-6', 4010, 1500, [2000, 600]), [A])).toBe(true);
  });

  it('tầng không có phòng (phòng chỉ ở tầng khác): bỏ qua', () => {
    expect(outsideAllRooms(piece('F-7', 10000, 1500), [])).toBe(false);
    expect(outsideAllRooms(piece('F-7', 10000, 1500), [roomOf('R-X', sq(0, 0, 4000, 3000), 'L-OTHER')])).toBe(false);
  });

  it('scenePlacementIssues báo "nằm ngoài nhà" cho cả viền gợi ý; thang thì không', () => {
    const graph: SpatialGraph = {
      ...graphOf([], []),
      rooms: [A, B],
      furniture: [piece('F-out', 10000, 1500), piece('F-sug', 12000, 1500, [1000, 600], { suggested: true }), piece('F-in', 2000, 1500), piece('F-st', 14000, 1500, [1000, 600], { kind: 'stair' })],
    };
    const outside = scenePlacementIssues(graph).filter((i) => i.kind === 'outside');
    expect(outside.map((i) => i.furnitureIds[0])).toEqual(['F-out', 'F-sug']);
    expect(outside[0]?.message).toBe('Bàn nằm ngoài nhà');
  });
});
