import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import type { Furniture } from '@/domain/spatial/types';

import { CATALOG_MODELS, clearServerLibrary, registerServerLibrary } from '../furnitureCatalog';
import LIBRARY_QC from '../libraryQc.json';
import POOLS from '../libraryRoles2.json';
import { LIBROLES2_POOLS, libRoles2Apply, libRoles2FlagOf, libRoles2LampOf, libRoles2PickOf, libRoles2Report, withLibRoles2 } from '../libraryRoles2';
import { lampInteractiveOf } from '../sceneDressing';
import { sceneStyleOf } from '../sceneStyles';

const style = sceneStyleOf('scandinavian');
interface Model {
  s: string[];
  kb: number;
  tris: number;
  mm: [number, number, number];
}
const models = POOLS.models as unknown as Record<string, Model>;

const lamp = (over: Partial<Furniture> & Pick<Furniture, 'id'>, w = 500, d = 500): Furniture =>
  ({
    levelId: 'L1',
    roomId: 'R1',
    kind: 'other',
    variant: 'floorLamp',
    centre: { x: 1000, y: 2000 },
    boundingBox: { min: { x: 1000 - w / 2, y: 2000 - d / 2 }, max: { x: 1000 + w / 2, y: 2000 + d / 2 } },
    rotationDeg: 0,
    confidence: 1,
    source: 'ai',
    reviewed: false,
    ...over,
  }) as Furniture;

beforeEach(() => {
  registerServerLibrary(
    Object.entries(models).map(([id, m]) => ({ id, widthMm: m.mm[0], heightMm: m.mm[1], depthMm: m.mm[2], modelUrl: `https://lib/${id}.glb?sig=1` })),
  );
});
afterEach(() => clearServerLibrary());

describe('pool libroles2 (ngưỡng)', () => {
  it('mọi mẫu trong pool qua ngưỡng chung, không mẫu bị loại QC', () => {
    const t = POOLS.thresholds;
    const excluded = new Set(Object.keys(LIBRARY_QC.excluded));
    for (const [role, list] of Object.entries(LIBROLES2_POOLS)) {
      expect(list.length).toBeGreaterThanOrEqual(5);
      const [lo = 0, hi = 0] = t.heightMm[role as keyof typeof t.heightMm];
      for (const id of list) {
        const m = models[id] as Model;
        const [w, h, d] = m.mm;
        expect(m.tris).toBeLessThanOrEqual(t.maxTris);
        expect(m.kb).toBeLessThanOrEqual(t.maxKb);
        expect(Math.max(w, d) / Math.min(w, d)).toBeLessThanOrEqual(t.maxFootprintAspect);
        expect(h).toBeGreaterThanOrEqual(lo);
        expect(h).toBeLessThanOrEqual(hi);
        expect(excluded.has(id)).toBe(false);
      }
    }
    // Mẫu nặng b0 nêu không lọt.
    expect(Object.values(LIBROLES2_POOLS).flat()).not.toContain('kitchen-counter-white-oak');
    expect(POOLS.flatPascal).toEqual(expect.arrayContaining(['floor-lamp', 'table-lamp', 'curtain', 'kitchen-cabinet-gen']));
  });

  it('cờ: bật mặc định (QA ảnh 6 căn, vòng 11), ?enable bật, ?disable thắng', () => {
    expect(libRoles2FlagOf('')).toBe(true);
    expect(libRoles2FlagOf('?disable=libroles2')).toBe(false);
    expect(libRoles2FlagOf('?enable=x,libroles2')).toBe(true);
    expect(libRoles2FlagOf('?enable=libroles2&disable=libroles2')).toBe(false);
    expect(libRoles2FlagOf('?disable=libroles2', true)).toBe(false);
  });
});

describe('chọn mẫu', () => {
  it('chỉ món sinh chưa có mẫu, khi cờ bật', () => {
    expect(libRoles2PickOf(lamp({ id: 'DRESS-floorLamp-R1' as Furniture['id'] }), style, false)).toBeNull();
    expect(libRoles2PickOf(lamp({ id: 'F-12' as Furniture['id'] }), style, true)).toBeNull();
    expect(libRoles2PickOf(lamp({ id: 'DRESS-floorLamp-R1' as Furniture['id'], model: { id: 'x', src: '/items/x/model.glb' } }), style, true)).toBeNull();
    const curtain: Partial<Furniture> = lamp({ id: 'DRESS-curtain-W1-L' as Furniture['id'] });
    delete curtain.variant;
    expect(libRoles2PickOf(curtain as Furniture, style, true)).toBeNull();
  });

  it('tất định, lọt hộp, và chọn lại trên hộp đã co ra đúng mẫu cũ', () => {
    for (const roomId of ['R1', 'R2', 'R3', 'R4', 'R5']) {
      const f = lamp({ id: `DRESS-floorLamp-${roomId}` as Furniture['id'], roomId: roomId as NonNullable<Furniture['roomId']> });
      const pick = libRoles2PickOf(f, style, true);
      expect(pick).not.toBeNull();
      expect(libRoles2PickOf(f, style, true)).toBe(pick);
      expect(LIBROLES2_POOLS.floorLamp).toContain(pick);
      const [mw, mh, md] = CATALOG_MODELS[pick as string]?.dimensions ?? [9, 9, 9];
      expect(mw).toBeLessThanOrEqual(0.5);
      expect(md).toBeLessThanOrEqual(0.5);
      const swapped = withLibRoles2(f, style, true);
      expect(swapped.boundingBox.max.x - swapped.boundingBox.min.x).toBeCloseTo(mw * 1000);
      expect(swapped.boundingBox.max.y - swapped.boundingBox.min.y).toBeCloseTo(md * 1000);
      expect(swapped.heightMm).toBe(Math.round(mh * 1000));
      expect(swapped.centre).toEqual(f.centre);
      expect(swapped.model?.src).toBe(`/items/${pick}/model.glb`);
      const unmodelled: Partial<Furniture> = { ...swapped };
      delete unmodelled.model;
      expect(libRoles2PickOf(unmodelled as Furniture, style, true)).toBe(pick);
    }
  });

  it('hai đèn bàn cùng phòng cùng mẫu; hộp quá nhỏ thì giữ mẫu Pascal', () => {
    const a = lamp({ id: 'DRESS-tableLamp-N1' as Furniture['id'], variant: 'tableLamp' }, 290, 400);
    const b = lamp({ id: 'DRESS-tableLamp-N2' as Furniture['id'], variant: 'tableLamp' }, 290, 400);
    expect(libRoles2PickOf(a, style, true)).toBe(libRoles2PickOf(b, style, true));
    expect(libRoles2PickOf(lamp({ id: 'DRESS-tableLamp-N3' as Furniture['id'], variant: 'tableLamp' }, 100, 100), style, true)).toBeNull();
  });

  it('thư viện chưa nạp → không đổi', () => {
    clearServerLibrary();
    expect(libRoles2PickOf(lamp({ id: 'DRESS-floorLamp-R1' as Furniture['id'] }), style, true)).toBeNull();
  });
});

describe('nguồn sáng + đầu dò', () => {
  it('đèn đổi mẫu giữ nguồn sáng Pascal, độ cao theo tỉ lệ chiều cao', () => {
    const f = withLibRoles2(lamp({ id: 'DRESS-floorLamp-R1' as Furniture['id'] }), style, true);
    const got = libRoles2LampOf(f, style) as { effects: { kind: string; offset: number[]; intensityRange: number[] }[] };
    const base = lampInteractiveOf('floor-lamp', style) as typeof got;
    const k = (f.heightMm as number) / 1000 / (CATALOG_MODELS['floor-lamp']?.dimensions[1] as number);
    expect(got.effects[0]?.intensityRange).toEqual(base.effects[0]?.intensityRange);
    expect(got.effects[0]?.offset[1]).toBeCloseTo((base.effects[0]?.offset[1] as number) * k);
    expect(libRoles2LampOf(lamp({ id: 'DRESS-floorLamp-R1' as Furniture['id'] }), style)).toBeUndefined();
  });

  it('đếm món phẳng theo vai trước/sau', () => {
    const items = [lamp({ id: 'DRESS-floorLamp-R1' as Furniture['id'] }), lamp({ id: 'DRESS-tableLamp-N9' as Furniture['id'], variant: 'tableLamp' }, 100, 100)];
    const out = libRoles2Apply(items, style, true);
    const nodes = [
      { id: 'item_DRESS-floorLamp-R1', type: 'item', asset: { src: 'https://lib/x.glb?sig=1' }, metadata: { generated: 'dressing' } },
      { id: 'item_DRESS-tableLamp-N9', type: 'item', asset: { src: '/items/table-lamp/model.glb' }, metadata: { generated: 'dressing' } },
      { id: 'item_DRESS-curtain-W1-L', type: 'item', asset: { src: '/items/curtain-uv/model.glb' }, metadata: { generated: 'dressing' } },
      { id: 'item_F-1', type: 'item', asset: { src: '/items/floor-lamp/model.glb' } },
    ];
    const report = libRoles2Report(nodes);
    expect(out[0]?.model).toBeDefined();
    expect(Object.keys(report.swaps)).toEqual(['DRESS-floorLamp-R1']);
    expect(report.flat.after).toEqual({ tableLamp: 1, curtain: 1 });
    expect(report.flat.before).toEqual({ tableLamp: 1, curtain: 1, floorLamp: 1 });
  });
});
