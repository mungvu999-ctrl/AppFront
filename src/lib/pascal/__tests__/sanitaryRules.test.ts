/** Luật thiết bị vệ sinh: sai phòng, trùng bồn cầu/bồn tắm, bồn cầu đối diện lavabo; và bày phòng tắm trống không vi phạm. */

import { describe, expect, it } from 'vitest';

import type { Furniture, Opening, Point, Room, RoomUsage, SpatialGraph, Wall } from '@/domain/spatial/types';

import { sanitaryPlacementIssues } from '../sanitaryRules';
import { furnishEmptyRooms } from '../sceneFurnish';
import { sceneStyleOf } from '../sceneStyles';

const META = { source: 'human', reviewed: true, confidence: 1 } as const;

const rect = (x0: number, y0: number, x1: number, y1: number): Point[] => [
  { x: x0, y: y0 },
  { x: x1, y: y0 },
  { x: x1, y: y1 },
  { x: x0, y: y1 },
];
const room = (id: string, usage: RoomUsage, outline: Point[], name = ''): Room =>
  ({ ...META, id, levelId: 'L-1', name, usage, outline, areaM2: 6, wallIds: [] }) as Room;
const wallsOf = (r: Room): Wall[] =>
  r.outline.map(
    (start, i) =>
      ({
        ...META,
        id: `W-${r.id}-${i}`,
        levelId: 'L-1',
        centreline: { start, end: r.outline[(i + 1) % r.outline.length] as Point },
        thicknessMm: 200,
        heightMm: 2700,
        kind: 'partition',
        openingIds: [],
      }) as Wall,
  );
const graphOf = (rooms: Room[], furniture: Furniture[], openings: Opening[] = []): SpatialGraph =>
  ({
    building: { ...META, name: 'b', datumElevationMm: 0 },
    levels: [{ ...META, id: 'L-1', name: 'T1', order: 0, elevationMm: 0, heightMm: 3000 }],
    walls: rooms.flatMap(wallsOf),
    openings,
    furniture,
    rooms,
    axes: [],
    dimensions: [],
    notes: [],
  }) as SpatialGraph;

/** `variant` wc/basin/bathtub (bồn tắm: không variant, dài 1,7 m); hướng do người đặt (≠ 0 để orientDetected bỏ qua). */
const fixture = (id: string, kind: 'wc' | 'basin' | 'bathtub' | 'sink', x: number, y: number, rotationDeg = 0.01, extra: Partial<Furniture> = {}): Furniture => {
  const [w, d] = kind === 'bathtub' ? [1700, 750] : kind === 'wc' ? [400, 700] : [600, 450];
  return {
    ...META,
    id,
    levelId: 'L-1',
    kind: 'sanitaryFixture',
    ...(kind === 'bathtub' ? {} : { variant: kind }),
    centre: { x, y },
    boundingBox: { min: { x: x - w / 2, y: y - d / 2 }, max: { x: x + w / 2, y: y + d / 2 } },
    rotationDeg,
    ...extra,
  } as Furniture;
};

const kinds = (g: SpatialGraph): string[] => sanitaryPlacementIssues(g).map((i) => `${i.kind}:${i.message}`);

describe('sanitaryPlacementIssues', () => {
  it('bồn cầu trong phòng ngủ → roomMismatch; trong phòng tắm thì không', () => {
    const bed = room('R-BED', 'bedroom', rect(0, 0, 4000, 3000));
    const bath = room('R-WC', 'bathroom', rect(4000, 0, 6000, 2000));
    expect(kinds(graphOf([bed, bath], [fixture('F1', 'wc', 1000, 1000), fixture('F2', 'wc', 5000, 500)]))).toEqual([
      'roomMismatch:Bồn cầu nằm trong phòng ngủ',
    ]);
  });

  it('phòng `other` tên "Phòng ngủ 2" cũng là phòng ngủ; chậu rửa trong bếp không báo', () => {
    const bed = room('R-1', 'other', rect(0, 0, 4000, 3000), 'Phòng ngủ 2');
    const kitchen = room('R-2', 'kitchen', rect(4000, 0, 7000, 3000));
    const g = graphOf([bed, kitchen], [fixture('F1', 'basin', 1000, 1000), fixture('F2', 'basin', 5000, 1000), fixture('F3', 'sink', 6000, 1000)]);
    expect(kinds(g)).toEqual(['roomMismatch:Lavabo nằm trong phòng ngủ']);
  });

  it('đồ gợi ý chưa nhận và phòng không rõ công năng: không báo', () => {
    const bed = room('R-BED', 'bedroom', rect(0, 0, 4000, 3000));
    const other = room('R-X', 'other', rect(4000, 0, 6000, 2000), 'P.3');
    const g = graphOf([bed, other], [fixture('F1', 'wc', 1000, 1000, 0, { suggested: true }), fixture('F2', 'wc', 5000, 1000)]);
    expect(kinds(g)).toEqual([]);
  });

  it('hai bồn cầu, hai bồn tắm trong một phòng tắm → duplicateFixture cho từng loại', () => {
    const bath = room('R-WC', 'bathroom', rect(0, 0, 4000, 3000), 'WC 1');
    const g = graphOf(
      [bath],
      [fixture('A', 'wc', 500, 500), fixture('B', 'wc', 1500, 500), fixture('C', 'bathtub', 1200, 2500), fixture('D', 'bathtub', 3000, 2500)],
    );
    const dups = sanitaryPlacementIssues(g).filter((i) => i.kind === 'duplicateFixture');
    expect(dups.map((i) => [i.message, i.furnitureIds])).toEqual([
      ['WC 1 có 2 bồn cầu', ['A', 'B']],
      ['WC 1 có 2 bồn tắm', ['C', 'D']],
    ]);
  });

  it('bồn cầu và lavabo quay mặt vào nhau, gần → facing; xa, lệch góc hay cùng hướng thì không', () => {
    const bath = room('R-WC', 'bathroom', rect(0, 0, 2000, 3000));
    // Bồn cầu sát tường y = 0 quay +y (0°); lavabo sát tường đối diện quay −y (180°).
    const near = graphOf([bath], [fixture('T', 'wc', 1000, 450), fixture('B', 'basin', 1000, 1700, 180)]);
    expect(sanitaryPlacementIssues(near)).toEqual([{ kind: 'facing', furnitureIds: ['T', 'B'], message: 'Bồn cầu đối diện lavabo' }]);
    // Cách nhau 2050 mm > 1500.
    expect(kinds(graphOf([bath], [fixture('T', 'wc', 1000, 450), fixture('B', 'basin', 1000, 2500, 180)]))).toEqual([]);
    // Lavabo quay 135°: lệch 45° > 30°.
    expect(kinds(graphOf([bath], [fixture('T', 'wc', 1000, 450), fixture('B', 'basin', 1000, 1700, 135)]))).toEqual([]);
    // Cùng tường, cạnh nhau: không đối diện.
    expect(kinds(graphOf([bath], [fixture('T', 'wc', 500, 450), fixture('B', 'basin', 1400, 300)]))).toEqual([]);
  });
});

describe('bày phòng tắm trống không tự vi phạm luật', () => {
  const style = sceneStyleOf(undefined);
  it('mọi cỡ 1,2–2,6 × 1,6–3 m, cửa ở từng tường: không trùng, không bồn cầu đối diện lavabo', () => {
    for (let w = 1200; w <= 2600; w += 200)
      for (let h = 1600; h <= 3000; h += 200)
        for (const side of [0, 1, 2, 3]) {
          const bath = room('R-B', 'bathroom', rect(0, 0, w, h));
          const door = { ...META, id: 'D-1', wallId: `W-R-B-${side}`, kind: 'door', offsetMm: 200, widthMm: 700, heightMm: 2100, sillHeightMm: 0, swing: 'left' } as Opening;
          const empty = graphOf([bath], [], [door]);
          const items = furnishEmptyRooms(empty, style);
          expect(items.filter((f) => f.variant === 'wc'), `${w}×${h} cửa ${side}`).toHaveLength(1);
          expect(kinds({ ...empty, furniture: [...items] }), `${w}×${h} cửa ${side}`).toEqual([]);
        }
  });
});
