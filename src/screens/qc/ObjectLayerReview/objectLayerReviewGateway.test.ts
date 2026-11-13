import { describe, expect, it } from 'vitest';

import { createSampleBuilding, sampleFurnitureId, sampleLevelId } from '@/domain/spatial/__fixtures__/sampleBuilding';
import { normalizeSpatial } from '@/domain/spatial/normalize';

import {
  approvableObjectsOf,
  approveConfidentLabelOf,
  approveUnsureLabelOf,
  buildChangeFurnitureKindCommand,
  buildChangeObjectSwingCommand,
  confidentObjectsOf,
  confirmUnsureLabelOf,
  doorSizeWarningOf,
  inwardSwingIdsOf,
  drawnFurnitureInputOf,
  formatObjectSize,
  levelOfGraph,
  objectPlacementsOf,
  objectsOf,
  reviewBreakdownLabelOf,
  scaleOfLevel,
  solidWallsOf,
  toObjectInspector,
  toObjectRow,
  toPaintSubject,
  unsureObjectsOf,
} from './objectLayerReviewGateway';
import { OBJECT_LAYER_FIXTURE_OBJECTS } from './objectLayerFixture';
import { clientToViewBoxPoint } from './objectLayerSymbols';
import type { ReviewObject } from './objectLayerTypes';

describe('objectLayerReviewGateway: free furniture rotation (K1)', () => {
  it('draws a 2000x600 free item at 90 deg with its own rotation and unrotated bounds', () => {
    const building = createSampleBuilding();
    const levelId = sampleLevelId(0);
    const id = sampleFurnitureId(0);
    building.furniture = building.furniture.map((item) =>
      item.id === id
        ? {
            ...item,
            levelId,
            centre: { x: 5000, y: 4000 },
            boundingBox: { min: { x: 4000, y: 3700 }, max: { x: 6000, y: 4300 } },
            rotationDeg: 90,
          }
        : item,
    );
    const graph = normalizeSpatial(building);
    const level = levelOfGraph(graph, levelId);

    const objects = objectsOf(graph, level, []);
    const index = objects.findIndex((object) => object.entityId === id);
    const placement = objectPlacementsOf(objects, solidWallsOf(graph, level!), level)[index]!;
    const scale = scaleOfLevel(level);

    expect(placement.angleDeg).toBe(90);
    expect(placement.boundsPx.width).toBeCloseTo(scale.millimetresToPixels(2000 as never));
    expect(placement.boundsPx.height).toBeCloseTo(scale.millimetresToPixels(600 as never));
  });
});

describe('objectLayerReviewGateway: source of an unreviewed entity (FIX-P0-14)', () => {
  const paintSourceOf = (source: 'ai' | 'human', reviewed: boolean) => {
    const building = createSampleBuilding();
    const levelId = sampleLevelId(0);
    const id = sampleFurnitureId(0);

    building.furniture = building.furniture.map((item) =>
      item.id === id ? { ...item, levelId, source, reviewed } : item,
    );

    const graph = normalizeSpatial(building);
    const object = objectsOf(graph, levelOfGraph(graph, levelId), []).find(
      (candidate) => candidate.entityId === id,
    )!;

    return toPaintSubject(object, levelId).review.source;
  };

  it('keeps human on a hand-drawn entity that is not reviewed (review then un-review)', () => {
    expect(paintSourceOf('human', false)).toBe('human');
  });

  it('keeps ai on an unreviewed AI entity', () => {
    expect(paintSourceOf('ai', false)).toBe('ai');
  });

  it('reports human on a reviewed entity', () => {
    expect(paintSourceOf('human', true)).toBe('human');
  });
});

describe('objectLayerReviewGateway: list row names and attention (K07)', () => {
  const objectOf = (patch: { kind?: 'wardrobe' | 'kitchenCabinet' | 'washingMachine' | 'shower' | 'other'; confidence?: number; reviewed?: boolean }) => {
    const building = createSampleBuilding();
    const levelId = sampleLevelId(0);
    const id = sampleFurnitureId(0);

    building.furniture = building.furniture.map((item) =>
      item.id === id ? ({ ...item, levelId, ...patch } as typeof item) : item,
    );

    const graph = normalizeSpatial(building);
    const object = objectsOf(graph, levelOfGraph(graph, levelId), []).find(
      (candidate) => candidate.entityId === id,
    )!;

    return object;
  };
  const rowOf = (patch: Parameters<typeof objectOf>[0]) => toObjectRow(objectOf(patch));

  it('names free furniture by its graph kind, not "Nội thất khác"', () => {
    expect(rowOf({ kind: 'wardrobe' }).typeLabel).toBe('Tủ áo');
    expect(rowOf({ kind: 'other' }).typeLabel).toBe('Nội thất khác');
    expect(rowOf({ kind: 'washingMachine' }).typeLabel).toBe('Máy giặt');
    expect(rowOf({ kind: 'shower' }).typeLabel).toBe('Buồng tắm đứng');
  });

  it('marks attention only below the confidence threshold, same rule as the header count', () => {
    expect(rowOf({ confidence: 0.8, reviewed: false }).statusCode).toBe('neutral');
    expect(rowOf({ confidence: 0.3, reviewed: false }).statusCode).toBe('attention');
    expect(rowOf({ confidence: 0.3, reviewed: true }).statusCode).toBe('verified');
  });

  it('K10: the inspector uses the list name, Rộng × Sâu and confidence in words', () => {
    const object = objectOf({ kind: 'kitchenCabinet', confidence: 0.26 });
    const inspector = toObjectInspector(object, null);

    expect(inspector.typeLabel).toBe(toObjectRow(object).typeLabel);
    expect(inspector.typeLabel).toBe('Tủ bếp');
    expect(inspector.furnitureKind).toBe('kitchenCabinet');
    expect(inspector.sizeLabel).toBe(toObjectRow(object).sizeLabel);
    expect(inspector.confidenceLabel).toBe('Máy chưa chắc');
    expect(toObjectInspector(objectOf({ confidence: 0.95 }), null).confidenceLabel).toBe('Máy khá chắc');
  });
});

describe('objectLayerReviewGateway: furniture kind change and drawing (K10, K07)', () => {
  it('changes only the graph kind, and refuses the same kind', () => {
    const id = sampleFurnitureId(0);
    const before = normalizeSpatial(createSampleBuilding()).byId[id];

    if (before === undefined || !('boundingBox' in before)) {
      throw new Error('sample furniture missing');
    }

    expect(buildChangeFurnitureKindCommand({ ...before, kind: 'other' }, 'wardrobe', 'u-1', 'F-001').ok).toBe(true);
    expect(buildChangeFurnitureKindCommand({ ...before, kind: 'wardrobe' }, 'wardrobe', 'u-1', 'F-001').ok).toBe(false);
  });

  it('draws a 600 x 600 furniture box centred on the clicked point', () => {
    const graph = normalizeSpatial(createSampleBuilding());
    const input = drawnFurnitureInputOf(levelOfGraph(graph, sampleLevelId(0))!, { x: 1000, y: 2000 });

    expect(input.centre).toEqual({ x: 1000, y: 2000 });
    expect(input.boundingBox).toEqual({ min: { x: 700, y: 1700 }, max: { x: 1300, y: 2300 } });
  });

  it('maps a screen click onto the svg viewBox (xMidYMid meet)', () => {
    const rect = { left: 100, top: 50, width: 400, height: 200 };
    const viewBox = { x: 10, y: 20, width: 200, height: 200 };

    /* factor = min(2, 1) = 1; 100 px of letterbox on each side. */
    expect(clientToViewBoxPoint(rect, viewBox, 200, 50)).toEqual({ x: 10, y: 20 });
    expect(clientToViewBoxPoint(rect, viewBox, 300, 150)).toEqual({ x: 110, y: 120 });
    expect(clientToViewBoxPoint({ ...rect, width: 0 }, viewBox, 0, 0)).toBeNull();
  });
});

describe('objectLayerReviewGateway: duyệt hàng loạt (U04)', () => {
  const base = OBJECT_LAYER_FIXTURE_OBJECTS.find((object) => object.layer !== 'furniture' && object.hostWallId !== null);

  if (base === undefined) {
    throw new Error('Bộ mẫu thiếu lỗ mở đã gắn tường.');
  }

  const variant = (id: string, patch: Partial<ReviewObject>): ReviewObject =>
    ({ ...base, id, reviewed: false, suggested: false, confidence: 0.95, ...patch }) as ReviewObject;
  const objects = [
    variant('sure', {}),
    variant('unsure', { confidence: 0.3 }),
    variant('done', { reviewed: true }),
    variant('suggested', { suggested: true }),
    variant('orphan', { hostWallId: null } as Partial<ReviewObject>),
  ];

  it('còn lại = chưa duyệt, trừ gợi ý chưa nhận và lỗ mở chưa gắn tường', () => {
    expect(approvableObjectsOf(objects).map((object) => object.id)).toEqual(['sure', 'unsure']);
  });

  it('máy chắc = còn lại và không dưới ngưỡng', () => {
    expect(confidentObjectsOf(objects, 0.75).map((object) => object.id)).toEqual(['sure']);
    expect(approveConfidentLabelOf(1)).toBe('Duyệt 1 mục máy chắc chắn');
  });

  it('UX-06: chưa chắc = còn lại dưới ngưỡng; các nhóm cộng đúng bằng số cần xem', () => {
    expect(unsureObjectsOf(objects, 0.75).map((object) => object.id)).toEqual(['unsure']);
    expect(approveUnsureLabelOf(22)).toBe('Duyệt 22 mục máy chưa chắc');
    expect(confirmUnsureLabelOf(22)).toContain('22 mục máy chưa chắc?');
    expect(reviewBreakdownLabelOf(objects, 0.75)).toBe(
      '4 cần xem = 1 máy chắc chắn + 1 máy chưa chắc + 1 gợi ý + 1 chưa gắn tường',
    );
    expect(reviewBreakdownLabelOf([variant('done', { reviewed: true })], 0.75)).toBeNull();
  });
});

describe('objectLayerReviewGateway: narrow door hint (UX-48)', () => {
  it('warns only on doors narrower than 600 mm', () => {
    expect(doorSizeWarningOf({ layer: 'door', widthMm: 392 })).toBe('Cửa hẹp bất thường (392 mm), kiểm lại');
    expect(doorSizeWarningOf({ layer: 'door', widthMm: 600 })).toBeNull();
    expect(doorSizeWarningOf({ layer: 'door', widthMm: 900 })).toBeNull();
    expect(doorSizeWarningOf({ layer: 'window', widthMm: 392 })).toBeNull();
    expect(doorSizeWarningOf({ layer: 'furniture', widthMm: 392 })).toBeNull();
  });
});

describe('objectLayerReviewGateway: doorStyle chỉ đi cùng cửa đi lùa (review EDITOR3D-DOT2 #1)', () => {
  it('đổi cửa lùa âm tường sang mở trái thì bỏ doorStyle, để AppBack không trả 422 cả tầng', () => {
    const door = Object.values(normalizeSpatial(createSampleBuilding()).byId).find(
      (entity) => entity !== undefined && 'swing' in entity && entity.kind === 'door',
    );
    if (door === undefined || !('swing' in door)) throw new Error('sample door missing');

    const result = buildChangeObjectSwingCommand({
      before: { ...door, swing: 'sliding', doorStyle: 'pocket' },
      displayId: 'D-001',
      swing: 'left',
      actorId: 'u-1',
    });

    if (!result.ok) throw new Error(result.error.reasons.join(' '));
    const after = result.data.changes[0]?.after;
    expect(after).toMatchObject({ swing: 'left' });
    expect(after).not.toHaveProperty('doorStyle');
  });
});

describe('inwardSwingIdsOf (cung cửa 2D cùng phía với 3D)', () => {
  // Tường ngang y = 0 từ (0,0) tới (4000,0); +y cục bộ của ký hiệu = mặt `inward` của Pascal.
  const wall = { id: 'W', levelId: 'L', thicknessMm: 200, centreline: { start: { x: 0, y: 0 }, end: { x: 4000, y: 0 } } };
  const room = (y0: number, y1: number) => ({ id: 'R', levelId: 'L', usage: 'kitchen', areaM2: 16, outline: [{ x: 0, y: y0 }, { x: 4000, y: y0 }, { x: 4000, y: y1 }, { x: 0, y: y1 }] });
  const door = (extra: object = {}) => ({ id: 'D', wallId: 'W', kind: 'door', offsetMm: 1500, widthMm: 900, swing: 'left', ...extra });
  const graphOf = (rooms: object[], openings: object[]) => ({ walls: [wall], rooms, openings }) as unknown as Parameters<typeof inwardSwingIdsOf>[0];

  it('cửa tường bao mở vào phòng: phòng ở +y → lật về +y; phòng ở −y → giữ −y', () => {
    expect([...inwardSwingIdsOf(graphOf([room(0, 4000)], [door()]))]).toEqual(['D']);
    expect([...inwardSwingIdsOf(graphOf([room(-4000, 0)], [door()]))]).toEqual([]);
  });

  it('"Đổi hướng mở" đảo phía; cửa sổ không bao giờ lật', () => {
    expect([...inwardSwingIdsOf(graphOf([room(0, 4000)], [door({ reversed: true })]))]).toEqual([]);
    expect([...inwardSwingIdsOf(graphOf([room(0, 4000)], [door({ kind: 'window' })]))]).toEqual([]);
  });
});

/* -------------------------------------------------------------------------- */
/* R10 làn S: số của ô mở mang trạng thái tỷ lệ của tầng.                      */
/* -------------------------------------------------------------------------- */

describe('R10: kích thước ô mở theo trạng thái tỷ lệ', () => {
  it('tầng đo được tỷ lệ thì kích thước để trần', () => {
    expect(formatObjectSize(900, 2200, 'measured')).toBe('900 × 2.200 mm');
  });

  it('tầng tỷ lệ ước lượng thì kích thước mang dấu ≈ và chữ ước lượng', () => {
    expect(formatObjectSize(900, 2200, 'estimated')).toBe('≈ 900 × 2.200 mm (ước lượng)');
  });

  it('không truyền trạng thái thì giữ nguyên hành vi cũ, không đánh dấu oan', () => {
    expect(formatObjectSize(900, 2200)).toBe('900 × 2.200 mm');
  });
});

describe('R10: cảnh báo cửa hẹp không khẳng định khi tỷ lệ còn là số ước', () => {
  const narrowDoor = { layer: 'door' as const, widthMm: 520 };

  it('tỷ lệ đo được: vẫn nói thẳng là cửa hẹp bất thường', () => {
    expect(doorSizeWarningOf(narrowDoor, 'measured')).toBe('Cửa hẹp bất thường (520 mm), kiểm lại');
  });

  it('tỷ lệ ước lượng: chỉ ra số là số ước và bảo kiểm tỷ lệ trước, vì có thể là báo động giả', () => {
    expect(doorSizeWarningOf(narrowDoor, 'estimated')).toBe(
      'Đo ra 520 mm — hẹp bất thường, nhưng tỷ lệ tầng còn là số ước; kiểm tỷ lệ trước',
    );
  });

  it('cửa đủ rộng và cửa sổ thì không có lời nhắc nào, dù tỷ lệ thế nào', () => {
    expect(doorSizeWarningOf({ layer: 'door', widthMm: 800 }, 'estimated')).toBeNull();
    expect(doorSizeWarningOf({ layer: 'window', widthMm: 400 }, 'estimated')).toBeNull();
  });
});
