import { describe, expect, it } from 'vitest';

import type {
  Furniture,
  FurnitureKind,
  FurnitureVariant,
  Opening,
  Room,
  RoomUsage,
  SpatialGraph,
  Wall,
} from '@/domain/spatial/types';

import { setRealismModels } from '../furnitureCatalog';
import { doorSwingRects, rectInsidePolygon, rectOfFurniture, rectsOverlap } from '../placement';
import { drapeReport, setDrapeFlags } from '../sceneDressingDrape';
import { dressingOf as allDressingOf } from '../sceneDressingRules';
import { UPHOLSTERY_PALETTE } from '../scenePalette';
import { sceneStyleOf, type SceneStyle } from '../sceneStyles';

/** Đồ trang trí AppFront (D): các ca J10 cũ chỉ xét 4 quy tắc đầu. */
const DECOR = /^DRESS-(pillow|throw|vase|frame|curtain)-/;
const dressingOf = (graph: SpatialGraph, style: SceneStyle): Furniture[] =>
  allDressingOf(graph, style).filter((i) => !DECOR.test(i.id));
const decorOf = (graph: SpatialGraph): Furniture[] => allDressingOf(graph, STYLE).filter((i) => DECOR.test(i.id));

const META = { confidence: 1, source: 'human', reviewed: true } as const;
const LEVEL = 'L-1' as const;
const STYLE = sceneStyleOf(undefined);

const roomOf = (id: string, usage: RoomUsage, w: number, d: number, x0 = 0): Room => ({
  ...META,
  id: `R-${id}`,
  levelId: LEVEL,
  name: id,
  usage,
  outline: [
    { x: x0, y: 0 },
    { x: x0 + w, y: 0 },
    { x: x0 + w, y: d },
    { x: x0, y: d },
  ],
  areaM2: (w * d) / 1e6,
  wallIds: [],
});

const piece = (
  id: string,
  kind: FurnitureKind,
  roomId: string | undefined,
  [cx, cy]: readonly [number, number],
  [w, d]: readonly [number, number],
  extra: { variant?: FurnitureVariant; heightMm?: number; rotationDeg?: number } = {},
): Furniture => ({
  ...META,
  id: `F-${id}`,
  levelId: LEVEL,
  ...(roomId === undefined ? {} : { roomId: `R-${roomId}` as const }),
  kind,
  centre: { x: cx, y: cy },
  boundingBox: { min: { x: cx - w / 2, y: cy - d / 2 }, max: { x: cx + w / 2, y: cy + d / 2 } },
  rotationDeg: extra.rotationDeg ?? 0,
  ...(extra.variant === undefined ? {} : { variant: extra.variant }),
  ...(extra.heightMm === undefined ? {} : { heightMm: extra.heightMm }),
});

const graphOf = (rooms: Room[], furniture: Furniture[], walls: Wall[] = [], openings: Opening[] = []): SpatialGraph => ({
  building: { ...META, name: 'b', datumElevationMm: 0 },
  levels: [{ ...META, id: LEVEL, name: 'T1', order: 0, elevationMm: 0, heightMm: 3000 }],
  walls,
  openings,
  furniture,
  rooms,
  axes: [],
  dimensions: [],
  notes: [],
});

/** Mọi món sinh ra: trong phòng (lùi 100), ngoài vùng mở cửa, id DRESS-, nguồn ai chưa duyệt. */
const expectValid = (graph: SpatialGraph, items: readonly Furniture[]): void => {
  const swings = doorSwingRects(graph, LEVEL);
  for (const item of items) {
    const room = graph.rooms.find((r) => r.id === item.roomId);
    const rect = rectOfFurniture(item);
    expect(item.id).toMatch(/^DRESS-/);
    expect(item).toMatchObject({ source: 'ai', reviewed: false, confidence: 1, levelId: LEVEL, kind: 'other' });
    expect(room && rectInsidePolygon(rect, room.outline, 100), item.id).toBe(true);
    expect(swings.some((s) => rectsOverlap(rect, s)), item.id).toBe(false);
  }
};

describe('dressingOf — phòng ngủ', () => {
  const bedroom = roomOf('bed', 'bedroom', 4000, 5000);
  const bed = piece('bed', 'bed', 'bed', [2000, 1100], [1600, 2000], { variant: 'bed' });
  const left = piece('ns1', 'table', 'bed', [925, 320], [450, 400], { variant: 'nightstand' });
  const right = piece('ns2', 'table', 'bed', [3075, 320], [450, 400], { variant: 'nightstand', heightMm: 550 });

  it('một đèn mỗi tủ đầu giường (cao bằng tủ) + một thảm dưới 2/3 phía chân giường', () => {
    const graph = graphOf([bedroom], [bed, left, right]);
    const items = dressingOf(graph, STYLE);

    expect(items.map((i) => i.id)).toEqual(['DRESS-tableLamp-F-ns1', 'DRESS-tableLamp-F-ns2', 'DRESS-rug-F-bed']);
    expect(items[0]).toMatchObject({ variant: 'tableLamp', centre: left.centre, liftMm: 480 });
    expect(items[1]).toMatchObject({ variant: 'tableLamp', centre: right.centre, liftMm: 550 });
    const rug = rectOfFurniture(items[2]!);
    expect(items[2]?.variant).toBe('rug');
    expect(rug).toEqual({ cx: 2000, cy: 1467, w: 2200, d: 1400, rotationDeg: 0 });
    expectValid(graph, items);
  });

  it('giường xoay 90°, đầu tựa tường phải: thảm về phía chân (−x), vẫn trong phòng', () => {
    const turned = piece('bed', 'bed', 'bed', [2900, 2500], [1600, 2000], { rotationDeg: 90 });
    const graph = graphOf([bedroom], [turned]);
    const items = dressingOf(graph, STYLE);

    expect(items).toHaveLength(1);
    expect(rectOfFurniture(items[0]!)).toEqual({ cx: 2533, cy: 2500, w: 2200, d: 1400, rotationDeg: 90 });
    expectValid(graph, items);
  });

  it('phòng đã có thảm: không thêm thảm, đèn vẫn có; món ngoài phòng không được trang trí', () => {
    const rug = piece('rug', 'other', 'bed', [2000, 3500], [1000, 600], { heightMm: 20 });
    const orphan = piece('ns3', 'table', undefined, [500, 4500], [450, 400], { variant: 'nightstand' });
    const items = dressingOf(graphOf([bedroom], [bed, left, right, rug, orphan]), STYLE);

    expect(items.map((i) => i.variant)).toEqual(['tableLamp', 'tableLamp']);
  });
});

describe('dressingOf — phòng khách', () => {
  const living = roomOf('liv', 'livingRoom', 5000, 4000);
  const sofa = piece('sofa', 'chair', 'liv', [2500, 550], [2000, 900], { variant: 'sofa' });
  const coffee = piece('coffee', 'table', 'liv', [2500, 1750], [1100, 600], { heightMm: 400 });

  it('một thảm dưới nhóm sofa, cỡ theo nhóm (C2): dài hơn sofa 400, phủ quá mép xa bàn trà 300', () => {
    const graph = graphOf([living], [sofa, coffee]);
    const items = dressingOf(graph, STYLE);

    expect(items.map((i) => i.id)).toEqual(['DRESS-rug-R-liv']);
    // Mép sau luồn 300 dưới sofa (y = 700); bàn trà tới y = 2050 → sâu 2050 − 700 + 300 = 1650.
    expect(rectOfFurniture(items[0]!)).toEqual({ cx: 2500, cy: 1525, w: 2400, d: 1650, rotationDeg: 0 });
    expectValid(graph, items);
  });

  it('vướng tủ sát mép: thảm lùi về 80%; đã có thảm: không thêm', () => {
    const shelf = piece('shelf', 'wardrobe', 'liv', [3760, 1450], [480, 500], { heightMm: 1800 });
    const shrunk = dressingOf(graphOf([living], [sofa, coffee, shelf]), STYLE);
    expect(shrunk.map((i) => rectOfFurniture(i).w)).toEqual([1920]);

    const rug = piece('rug', 'other', 'liv', [1000, 3000], [1200, 800], { variant: 'rug' });
    expect(dressingOf(graphOf([living], [sofa, coffee, rug]), STYLE)).toEqual([]);
  });
});

describe('dressingOf — tường (C2)', () => {
  it('thảm không cắt tường ngăn không nằm trên outline: cỡ đầy đủ lẫn 80% vướng → lùi về 60%', () => {
    const living = roomOf('liv', 'livingRoom', 5000, 4000);
    const sofa = piece('sofa', 'chair', 'liv', [2500, 3300], [2000, 900], { variant: 'sofa', rotationDeg: 180 });
    // Tường ngăn vắt ngang phòng ở y = 2000 (không nằm trên outline).
    const wall: Wall = {
      ...META,
      id: 'W-mid',
      levelId: LEVEL,
      centreline: { start: { x: 0, y: 2000 }, end: { x: 5000, y: 2000 } },
      thicknessMm: 120,
      heightMm: 3000,
      kind: 'partition',
      openingIds: [],
    };
    const graph = graphOf([living], [sofa], [wall]);
    const items = dressingOf(graph, STYLE);
    const wallRect = { cx: 2500, cy: 2000, w: 5000, d: 120, rotationDeg: 0 };
    for (const item of items) expect(rectsOverlap(rectOfFurniture(item), wallRect), item.id).toBe(false);
    // 60% của 2400 × 1400: mép xa y = 2310, còn cách mặt tường (2060).
    expect(items.map((i) => [rectOfFurniture(i).w, rectOfFurniture(i).d])).toEqual([[1440, 840]]);
    expect(rectOfFurniture(dressingOf(graphOf([living], [sofa]), STYLE)[0]!).w).toBe(2400);
  });
});

describe('dressingOf — thảm và vùng mở cửa (S7)', () => {
  it('thảm giường nằm được trong vùng mở cửa (người đi qua thảm); món đứng vẫn tránh', () => {
    const bedroom = roomOf('bed', 'bedroom', 4000, 5000);
    const bed = piece('bed', 'bed', 'bed', [2000, 1100], [1600, 2000], { variant: 'bed' });
    // Cửa trên tường trái, mở vào phòng đúng chỗ thảm cỡ đầy đủ (y ≈ 767..2167, x ≥ 900).
    const wall: Wall = {
      ...META,
      id: 'W-left',
      levelId: LEVEL,
      centreline: { start: { x: 0, y: 0 }, end: { x: 0, y: 5000 } },
      thicknessMm: 100,
      heightMm: 3000,
      kind: 'partition',
      openingIds: ['D-1'],
    };
    const door: Opening = {
      ...META,
      id: 'D-1',
      wallId: 'W-left',
      kind: 'door',
      offsetMm: 1000,
      widthMm: 900,
      heightMm: 2100,
      sillHeightMm: 0,
      swing: 'left',
    };
    const graph = graphOf([bedroom], [bed], [wall], [door]);
    const rug = dressingOf(graph, STYLE).find((i) => String(i.id) === 'DRESS-rug-F-bed');
    expect(rug).toBeDefined();
    expect(rectOfFurniture(rug!)).toEqual({ cx: 2000, cy: 1467, w: 2200, d: 1400, rotationDeg: 0 });
    // Cùng đầu vào: cùng kết quả.
    expect(dressingOf(graphOf([bedroom], [bed], [wall], [door]), STYLE)).toEqual(dressingOf(graph, STYLE));
  });

  it('đèn bàn luôn có trên mỗi tủ đầu giường, kể cả tủ chồng mép giường (bản quét lệch)', () => {
    const bedroom = roomOf('bed', 'bedroom', 4000, 5000);
    const bed = piece('bed', 'bed', 'bed', [2000, 1100], [1600, 2000], { variant: 'bed' });
    const tight = piece('ns1', 'table', 'bed', [1100, 320], [450, 400], { variant: 'nightstand' });
    const items = dressingOf(graphOf([bedroom], [bed, tight]), STYLE);
    expect(items.filter((i) => i.variant === 'tableLamp').map((i) => i.id)).toEqual(['DRESS-tableLamp-F-ns1']);
  });
});

describe('dressingOf — phòng tắm', () => {
  const bath = roomOf('wc', 'bathroom', 2000, 2000);
  const shower = piece('shower', 'sanitaryFixture', 'wc', [550, 550], [900, 900], { variant: 'shower' });
  const wall: Wall = {
    ...META,
    id: 'W-left',
    levelId: LEVEL,
    centreline: { start: { x: 0, y: 0 }, end: { x: 0, y: 2000 } },
    thicknessMm: 100,
    heightMm: 3000,
    kind: 'partition',
    openingIds: ['D-1'],
  };
  const door: Opening = {
    ...META,
    id: 'D-1',
    wallId: 'W-left',
    kind: 'door',
    offsetMm: 900,
    widthMm: 800,
    heightMm: 2100,
    sillHeightMm: 0,
    swing: 'left',
  };

  it('thảm chân trước mặt +y của vòi sen; cửa mở vướng thì sang mặt +x', () => {
    const open = graphOf([bath], [shower]);
    const front = dressingOf(open, STYLE);
    expect(front.map((i) => i.id)).toEqual(['DRESS-bathMat-F-shower']);
    expect(rectOfFurniture(front[0]!)).toEqual({ cx: 550, cy: 1225, w: 700, d: 450, rotationDeg: 0 });

    const withDoor = graphOf([bath], [shower], [wall], [door]);
    const side = dressingOf(withDoor, STYLE);
    expect(rectOfFurniture(side[0]!)).toEqual({ cx: 1225, cy: 550, w: 700, d: 450, rotationDeg: 90 });
    expectValid(withDoor, side);
  });

  it('vòi sen không thuộc phòng nào: bỏ', () => {
    const loose = piece('shower', 'sanitaryFixture', undefined, [550, 550], [900, 900], { variant: 'shower' });
    expect(dressingOf(graphOf([bath], [loose]), STYLE)).toEqual([]);
  });
});

describe('dressingOf — tất định', () => {
  it('đảo thứ tự phòng/đồ đạc: cùng kết quả', () => {
    const rooms = [roomOf('bed', 'bedroom', 4000, 5000), roomOf('wc', 'bathroom', 2000, 2000, 6000)];
    const furniture = [
      piece('bed', 'bed', 'bed', [2000, 1100], [1600, 2000], { variant: 'bed' }),
      piece('ns1', 'table', 'bed', [925, 320], [450, 400], { variant: 'nightstand' }),
      piece('ns2', 'table', 'bed', [3075, 320], [450, 400], { variant: 'nightstand' }),
      piece('shower', 'sanitaryFixture', 'wc', [6550, 550], [900, 900], { variant: 'shower' }),
    ];
    const once = dressingOf(graphOf(rooms, furniture), STYLE);

    expect(once).toHaveLength(4);
    expect(dressingOf(graphOf([...rooms].reverse(), [...furniture].reverse()), STYLE)).toEqual(once);
  });
});

describe('dressingOf — đồ trang trí AppFront (FE3D-FIX-004 D)', () => {
  const bedroom = roomOf('bed', 'bedroom', 4000, 5000);
  const living = roomOf('liv', 'livingRoom', 5000, 4000);
  const bed = piece('bed', 'bed', 'bed', [2000, 1100], [1600, 2000], { variant: 'bed' });
  /** Tường nằm ngang tim ở `y`, dày 200 (mặt trong của tường y = −100 là y = 0). */
  const wallAt = (id: string, y: number, len: number): Wall =>
    ({
      ...META,
      id: `W-${id}`,
      levelId: LEVEL,
      centreline: { start: { x: 0, y }, end: { x: len, y } },
      thicknessMm: 200,
      heightMm: 3000,
      kind: 'exterior',
      openingIds: [],
    }) as unknown as Wall;
  const opening = (id: string, wallId: string, kind: 'door' | 'window', offsetMm: number, widthMm: number): Opening =>
    ({
      ...META,
      id: `O-${id}`,
      wallId: `W-${wallId}`,
      kind,
      offsetMm,
      widthMm,
      heightMm: kind === 'door' ? 2100 : 1400,
      sillHeightMm: kind === 'door' ? 0 : 900,
      swing: 'left',
    }) as unknown as Opening;

  it('giường: chăn gấp ở chân, trên mặt nệm, mẫu AppFront; không gối dựng (mẫu giường có sẵn gối)', () => {
    const items = decorOf(graphOf([bedroom], [bed]));
    expect(items.map((i) => i.id)).toEqual(['DRESS-throw-F-bed']);
    // Giường 1600 × 2000 = cỡ catalog → cao 710, mặt nệm đo từ GLB 0,568 (surfaceTops.json).
    expect(rectOfFurniture(items[0]!)).toEqual({ cx: 2000, cy: 1700, w: 1200, d: 500, rotationDeg: 0 });
    expect(items[0]?.liftMm).toBe(403);
    expect(items[0]?.variant).toBeUndefined();
    expect(items[0]?.slots?.fabric).toBe(STYLE.families.fabric);
    expect(items[0]?.model?.src).toBe('/items/throw-blanket/model.glb');
  });

  it('mẫu giường thật (realism, có sẵn chăn gối): không đặt chăn gấp', () => {
    setRealismModels(true);
    try {
      expect(decorOf(graphOf([bedroom], [bed]))).toEqual([]);
    } finally {
      setRealismModels(false);
    }
  });

  it('giường xoay 90°, đầu tựa tường phải: chăn ở phía chân', () => {
    const turned = piece('bed', 'bed', 'bed', [2900, 2500], [1600, 2000], { rotationDeg: 90 });
    const [blanket] = decorOf(graphOf([bedroom], [turned])).map(rectOfFurniture);
    expect(blanket).toMatchObject({ cx: 2900 - 1000 + 150 + 250, cy: 2500, rotationDeg: 90 });
  });

  it('sofa dài ≥ 1800: 3 gối tựa lưng; sofa ngắn: 2', () => {
    const sofa = piece('sofa', 'chair', 'liv', [2500, 550], [2000, 900], { variant: 'sofa' });
    const three = decorOf(graphOf([living], [sofa]));
    expect(three.map((i) => i.id)).toEqual(['DRESS-pillow-F-sofa-0', 'DRESS-pillow-F-sofa-1', 'DRESS-pillow-F-sofa-2']);
    // Lưng sofa ở y = 100: tâm gối = 100 + 220 + 75.
    expect(three.map((i) => rectOfFurniture(i).cy)).toEqual([395, 395, 395]);
    expect(three.map((i) => rectOfFurniture(i).cx)).toEqual([1970, 2500, 3030]);
    const short = piece('sofa', 'chair', 'liv', [2500, 550], [1600, 900], { variant: 'sofa' });
    expect(decorOf(graphOf([living], [short]))).toHaveLength(2);
  });

  it('bình gốm giữa bàn ăn và bàn phụ, nâng bằng mặt bàn; tủ đầu giường đã có đèn: không bình', () => {
    const table = piece('dt', 'table', 'liv', [2500, 2000], [1600, 900], { variant: 'table' });
    const side = piece('st', 'table', 'liv', [500, 3000], [450, 400], { variant: 'sideTable', heightMm: 500 });
    const items = decorOf(graphOf([living], [table, side]));
    expect(items.map((i) => i.id)).toEqual(['DRESS-vase-F-dt', 'DRESS-vase-F-st']);
    expect(items[0]).toMatchObject({ variant: 'vase', centre: table.centre, liftMm: 519 });
    expect(rectOfFurniture(items[0]!)).toMatchObject({ w: 204, d: 204 });
    expect(items[1]).toMatchObject({ centre: side.centre, liftMm: 500 });

    const ns = piece('ns1', 'table', 'bed', [925, 320], [450, 400], { variant: 'nightstand' });
    expect(decorOf(graphOf([bedroom], [ns])).filter((i) => i.id.startsWith('DRESS-vase'))).toEqual([]);
  });

  it('khung tranh áp tường sau đầu giường, ≥ 1250 mm; tường có cửa sổ sau giường: không treo', () => {
    const wall = wallAt('s', -100, 4000);
    const frame = decorOf(graphOf([bedroom], [bed], [wall])).find((i) => (i.id as string) === 'DRESS-frame-F-bed');
    expect(frame?.model?.src).toBe('/items/fancy-picture-frame/model.glb');
    expect(rectOfFurniture(frame!)).toEqual({ cx: 2000, cy: 10, w: 604, d: 20, rotationDeg: 0 });
    expect(frame?.liftMm).toBe(1250);
    // Không tường sau lưng: không khung.
    expect(decorOf(graphOf([bedroom], [bed])).some((i) => i.id.startsWith('DRESS-frame'))).toBe(false);
    const win = opening('w', 's', 'window', 1700, 600);
    expect(decorOf(graphOf([bedroom], [bed], [wall], [win])).some((i) => i.id.startsWith('DRESS-frame'))).toBe(false);
  });

  it('rèm hai bên cửa sổ phòng khách, áp mặt tường, quay vào phòng; cửa đi vướng thì phủ sâu hơn', () => {
    const wall = wallAt('n', 4100, 5000);
    const win = opening('w', 'n', 'window', 2000, 1200);
    const items = decorOf(graphOf([living], [], [wall], [win]));
    expect(items.map((i) => i.id)).toEqual(['DRESS-curtain-O-w-L', 'DRESS-curtain-O-w-R']);
    expect(items.map(rectOfFurniture)).toEqual([
      { cx: 1750, cy: 3929, w: 800, d: 102, rotationDeg: 180 },
      { cx: 3450, cy: 3929, w: 800, d: 102, rotationDeg: 180 },
    ]);
    expect(items[0]).toMatchObject({ liftMm: 0, model: { src: '/items/curtain/model.glb' } });
    expect(items[0]?.slots).toMatchObject({ fabric: STYLE.families.fabric, metal: STYLE.families.metal });

    const door = opening('d', 'n', 'door', 600, 900);
    const shifted = decorOf(graphOf([living], [], [wall], [win, door]));
    expect(rectOfFurniture(shifted.find((i) => i.id.endsWith('-L'))!).cx).toBe(1900);
    const swings = doorSwingRects(graphOf([living], [], [wall], [door]), LEVEL);
    for (const item of shifted) expect(swings.some((sw) => rectsOverlap(rectOfFurniture(item), sw))).toBe(false);
  });

  it('?drape=light,tall: rèm lanh màu chăn ga, cao = tầng − 100; không cờ y như cũ (vòng 10)', () => {
    const graph = graphOf([living], [], [wallAt('n', 4100, 5000)], [opening('w', 'n', 'window', 2000, 1200)]);
    const goAm = sceneStyleOf('go-am');
    const curtainsOf = () => allDressingOf(graph, goAm).filter((i) => i.id.startsWith('DRESS-curtain-'));
    expect(curtainsOf()[0]).toMatchObject({ heightMm: 2272, slots: { fabric: goAm.families.fabric } });
    setDrapeFlags(['light', 'tall']);
    try {
      const items = curtainsOf();
      expect(items).toHaveLength(2);
      expect(items[0]).toMatchObject({ heightMm: 2900, slots: { fabric: 'library:fabric-linen', metal: goAm.families.metal } });
      expect(drapeReport().curtains.find((c) => c.id === items[0]?.id)).toMatchObject({
        heightMm: 2900,
        fabric: 'library:fabric-linen',
        color: UPHOLSTERY_PALETTE.goAmBedding,
      });
    } finally {
      setDrapeFlags([]);
    }
  });

  it('phòng tắm có cửa sổ: không rèm; cùng đầu vào đảo thứ tự: cùng kết quả', () => {
    const bath = roomOf('wc', 'bathroom', 2000, 2000);
    const wall = wallAt('n', 2100, 2000);
    expect(decorOf(graphOf([bath], [], [wall], [opening('w', 'n', 'window', 500, 800)]))).toEqual([]);
    const sofa = piece('sofa', 'chair', 'liv', [2500, 550], [2000, 900], { variant: 'sofa' });
    const table = piece('dt', 'table', 'liv', [2500, 2500], [1600, 900], { variant: 'table' });
    const walls = [wallAt('s', -100, 5000), wallAt('n', 4100, 5000)];
    const ops = [opening('w', 'n', 'window', 2000, 1200)];
    const rooms = [living, roomOf('wc2', 'bathroom', 2000, 2000, 6000)];
    const once = allDressingOf(graphOf(rooms, [sofa, table], walls, ops), STYLE);
    expect(once.length).toBeGreaterThan(6);
    expect(
      allDressingOf(graphOf([...rooms].reverse(), [table, sofa], [...walls].reverse(), [...ops].reverse()), STYLE),
    ).toEqual(once);
  });
});
