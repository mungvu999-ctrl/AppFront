import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { SpatialGraphDocumentSchema } from '@/api/schemas/spatialGraph';
import { normalizeSpatial } from '@/domain/spatial/normalize';
import type { Furniture, SpatialGraph } from '@/domain/spatial/types';

import { fixtureF2 } from '../__fixtures__';
import { createPascalEditCommand } from '../fromPascal';
import { isEditedGenerated } from '../toSpatial';

import { CATALOG_MODELS, clearServerLibrary, isServerModel, modelSrcOf, registerServerLibrary, serverAttributionOf, serverKindOf, thumbnailOf } from '../furnitureCatalog';
import LIBRARY_QC from '../libraryQc.json';
import POOLS from '../libraryRoles2.json';
import { LIBROLES2_DEFAULT, LIBROLES2_MODEL_PREFIX, LIBROLES2_POOLS, libRoles2BaseIdOf, libRoles2Apply, libRoles2FlagOf, libRoles2LampOf, libRoles2PickOf, libRoles2Report, withLibRoles2 } from '../libraryRoles2';
import { lampInteractiveOf } from '../sceneDressing';
import { sceneStyleOf } from '../sceneStyles';
import { toPascalScene } from '../toPascal';
import type { PascalItemNode, PascalScene } from '../types';

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
    expect(LIBROLES2_DEFAULT).toBe(true);
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

describe('vòng tròn lưu (review Codex B1 #1)', () => {
  const graph: SpatialGraph = SpatialGraphDocumentSchema.parse(fixtureF2().doc).graph;
  const itemsOf = (scene: PascalScene): PascalItemNode[] => Object.values(scene.nodes).filter((n): n is PascalItemNode => n.type === 'item');
  const edit = (scene: PascalScene, changed: readonly string[]) =>
    createPascalEditCommand({ graph: normalizeSpatial(graph), scene, commit: { origin: 'local', changedNodeIds: [...changed] }, actorId: 'U-1', idBook: new Map() });

  it('đèn sinh dùng mẫu máy chủ chuẩn (không id riêng), còn nguồn sáng', () => {
    const lamp = itemsOf(toPascalScene(graph, { furnish: 'on' }).scene).find((n) => /^item_DRESS-tableLamp-/.test(n.id));
    expect(lamp).toBeDefined();
    const base = libRoles2BaseIdOf(lamp?.asset.id ?? '');
    expect(lamp?.asset.id).toBe(`${LIBROLES2_MODEL_PREFIX}${base}`);
    expect(LIBROLES2_POOLS.tableLamp).toContain(base);
    expect(lamp?.asset.src).toBe(`https://lib/${base}.glb?sig=1`);
    expect(((lamp?.asset as { interactive?: { effects: { kind: string }[] } }).interactive?.effects ?? []).some((e) => e.kind === 'light')).toBe(true);
  });

  it('nhận đèn → lưu đúng mẫu + đường cố định; nạp lại giữ đúng mẫu và nguồn sáng; món chưa nhận không ghi gì', () => {
    const scene = toPascalScene(graph, { furnish: 'on' }).scene;
    const lamp = itemsOf(scene).find((n) => /^item_DRESS-tableLamp-/.test(n.id)) as PascalItemNode;
    const pick = libRoles2BaseIdOf(lamp.asset.id) as string;
    const untouched = edit(scene, []);
    // Không sửa gì: lệnh báo "không có gì để ghi" (hoặc rỗng) — đèn sinh đã đổi mẫu không lọt vào bản lưu.
    expect(untouched.ok ? untouched.data.changes : []).toEqual([]);

    const moved: PascalItemNode = { ...lamp, position: [lamp.position[0] + 0.05, lamp.position[1], lamp.position[2]] };
    const result = edit({ ...scene, nodes: { ...scene.nodes, [moved.id]: moved } }, [moved.id]);
    if (!result.ok) throw new Error(result.error.reasons.join(' '));
    const saved = result.data.changes.map((c) => c.after as Furniture);
    const savedLamp = saved.find((f) => f.variant === 'tableLamp');
    // Lưu: đường cố định của id chuẩn, `model.id` giữ tiền tố (provenance để đèn đã nhận còn sáng sau tải lại).
    expect(savedLamp?.model).toEqual({ id: `${LIBROLES2_MODEL_PREFIX}${pick}`, src: `/items/${pick}/model.glb` });
    expect(savedLamp?.id.startsWith('DRESS-')).toBe(false);
    // Không món đã lưu nào mang URL ký.
    expect(saved.every((f) => f.model === undefined || /^\/items\/[a-z0-9_-]+\/model\.glb$/.test(f.model.src))).toBe(true);

    const reloaded = itemsOf(toPascalScene({ ...graph, furniture: [...graph.furniture, ...saved] }, { furnish: 'on' }).scene).find(
      (n) => n.id === `item_${savedLamp?.id}`,
    );
    expect(reloaded?.asset.id).toBe(`${LIBROLES2_MODEL_PREFIX}${pick}`);
    expect(reloaded?.asset.src).toBe(`https://lib/${pick}.glb?sig=1`);
    expect(((reloaded?.asset as { interactive?: { effects: { kind: string }[] } }).interactive?.effects ?? []).some((e) => e.kind === 'light')).toBe(true);
  });
});

describe('review Codex B2', () => {
  const graph: SpatialGraph = SpatialGraphDocumentSchema.parse(fixtureF2().doc).graph;
  const itemsOf = (scene: PascalScene): PascalItemNode[] => Object.values(scene.nodes).filter((n): n is PascalItemNode => n.type === 'item');
  const hasLight = (n: PascalItemNode | undefined): boolean =>
    ((n?.asset as { interactive?: { effects: { kind: string }[] } } | undefined)?.interactive?.effects ?? []).some((e) => e.kind === 'light');

  it('N2: thư viện đường cố định, đèn sinh KHÔNG đổi trong changedNodeIds → không nhận phòng, 0 thay đổi', () => {
    clearServerLibrary();
    registerServerLibrary(
      Object.entries(models).map(([id, m]) => ({ id, widthMm: m.mm[0], heightMm: m.mm[1], depthMm: m.mm[2], modelUrl: `/items/${id}/model.glb` })),
    );
    const scene = toPascalScene(graph, { furnish: 'on' }).scene;
    const lamp = itemsOf(scene).find((n) => /^item_DRESS-tableLamp-/.test(n.id)) as PascalItemNode;
    expect(lamp.asset.src).toMatch(/^\/items\/[a-z0-9_-]+\/model\.glb$/);
    expect(isEditedGenerated(lamp)).toBe(false);
    const result = createPascalEditCommand({
      graph: normalizeSpatial(graph),
      scene,
      commit: { origin: 'local', changedNodeIds: [lamp.id] },
      actorId: 'U-1',
      idBook: new Map(),
    });
    expect(result.ok ? result.data.changes : []).toEqual([]);
    if (!result.ok) expect(result.error.code).toBe('PASCAL_NO_CHANGE');
    // Người dùng "Đổi mẫu" (id catalog chuẩn) thì vẫn là đã sửa.
    expect(isEditedGenerated({ ...lamp, asset: { ...lamp.asset, id: 'lamp-table-glass-column', src: '/items/lamp-table-glass-column/model.glb' } })).toBe(true);
  });

  it('N3: món người dùng vai đèn bàn mang mẫu pool (không dấu libroles2) không tự có nguồn sáng', () => {
    const host = graph.furniture[0] as Furniture;
    const user: Furniture = {
      ...host,
      id: 'F-userlamp' as Furniture['id'],
      kind: 'other',
      variant: 'tableLamp',
      model: { id: 'lamp-blue-ceramic-base-b', src: '/items/lamp-blue-ceramic-base-b/model.glb' },
    };
    expect(libRoles2LampOf(user, style)).toBeUndefined();
    const node = itemsOf(toPascalScene({ ...graph, furniture: [...graph.furniture, user] }, { furnish: 'on' }).scene).find((n) => n.id === 'item_F-userlamp');
    expect(node).toBeDefined();
    expect(hasLight(node)).toBe(false);
  });
});

describe('review Codex B3', () => {
  it('giải mã chung: id có tiền tố provenance tra danh mục như id chuẩn (ghi công CC-BY, đường mẫu/ảnh, loại)', () => {
    registerServerLibrary([
      { id: 'lamp-credit-x', widthMm: 240, heightMm: 500, depthMm: 240, modelUrl: 'https://lib/c.glb?sig=1', previewUrl: 'https://lib/c.webp', furnitureKind: 'other', attribution: 'Tác giả A · CC BY 4.0' },
    ]);
    const prefixed = `${LIBROLES2_MODEL_PREFIX}lamp-credit-x`;
    expect(serverAttributionOf(prefixed)).toBe('Tác giả A · CC BY 4.0');
    expect(serverAttributionOf(prefixed)).toBe(serverAttributionOf('lamp-credit-x'));
    expect(modelSrcOf(prefixed)).toBe('https://lib/c.glb?sig=1');
    expect(thumbnailOf(prefixed)).toBe('https://lib/c.webp');
    expect(serverKindOf(prefixed)).toBe('other');
    expect(isServerModel(prefixed)).toBe(true);
    // Mẫu gói sẵn: đường của id chuẩn, không dựng đường có tiền tố.
    expect(modelSrcOf(`${LIBROLES2_MODEL_PREFIX}floor-lamp`)).toBe(modelSrcOf('floor-lamp'));
    expect(serverAttributionOf('appfront-libroles2-Bad/Id')).toBeUndefined();
  });

  it('đèn đã lưu mang dấu luôn sáng: cờ tắt (?disable=libroles2) và mẫu không còn trong pool; món người dùng không dấu vẫn không sáng', async () => {
    vi.stubGlobal('location', { search: '?disable=libroles2', href: 'http://localhost/editor3d.html?disable=libroles2' });
    vi.resetModules();
    try {
      const cat = await import('../furnitureCatalog');
      const lr = await import('../libraryRoles2');
      const tp = await import('../toPascal');
      expect(lr.LIBROLES2_ON).toBe(false);
      const gone = 'lamp-retired-from-pool';
      expect(Object.values(lr.LIBROLES2_POOLS).flat()).not.toContain(gone);
      cat.registerServerLibrary([{ id: gone, widthMm: 240, heightMm: 500, depthMm: 240, modelUrl: `https://lib/${gone}.glb?sig=1` }]);
      const graph: SpatialGraph = SpatialGraphDocumentSchema.parse(fixtureF2().doc).graph;
      const host = graph.furniture[0] as Furniture;
      const saved: Furniture = {
        ...host,
        id: 'F-adoptedlamp' as Furniture['id'],
        kind: 'other',
        variant: 'tableLamp',
        heightMm: 500 as NonNullable<Furniture['heightMm']>,
        model: { id: `${LIBROLES2_MODEL_PREFIX}${gone}`, src: `/items/${gone}/model.glb` },
      };
      const user: Furniture = { ...saved, id: 'F-userlamp2' as Furniture['id'], model: { id: gone, src: `/items/${gone}/model.glb` } };
      const nodes = tp.toPascalScene({ ...graph, furniture: [...graph.furniture, saved, user] }, { furnish: 'on' }).scene.nodes as Record<string, PascalItemNode>;
      const lit = (n: PascalItemNode | undefined): boolean =>
        ((n?.asset as { interactive?: { effects: { kind: string }[] } } | undefined)?.interactive?.effects ?? []).some((e) => e.kind === 'light');
      expect(nodes['item_F-adoptedlamp']?.asset.src).toBe(`https://lib/${gone}.glb?sig=1`);
      expect(lit(nodes['item_F-adoptedlamp'])).toBe(true);
      expect(lit(nodes['item_F-userlamp2'])).toBe(false);
      cat.clearServerLibrary();
    } finally {
      vi.unstubAllGlobals();
      vi.resetModules();
    }
  });
});
