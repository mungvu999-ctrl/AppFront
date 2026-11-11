/**
 * V4 — sửa MỘT món sinh: riêng món ấy thành đồ thật (id suy từ id sinh + mẫu đang thấy, id sinh vào `dressingOff`),
 * anh em vẫn là lớp dẫn xuất; đồ trang trí đặt trên món đi theo món; `dressingOff` tràn không rơi mục "đã nhận";
 * đổi công năng phòng không chồng đồ sinh lên món đã nhận; mẫu tại chỗ có hoán đổi realism giữ đường hiển thị;
 * hoàn tác/làm lại qua `derivedHistory`; đổi mẫu neo chỉ ghi một món.
 */
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

import { denormalizeSpatial, normalizeSpatial } from '@/domain/spatial/normalize';
import type { Furniture, Point, Room, SpatialGraph, Wall } from '@/domain/spatial/types';
import { createDerivedHistory, recordDerived, restoreDerived } from '@/pascal-page/bridge/derivedHistory';

import { createPascalEditCommand } from '../fromPascal';
import { CATALOG_MODELS, clearServerLibrary, registerServerLibrary, setRealismModels } from '../furnitureCatalog';
import QUALITY from '../libraryQuality.json' with { type: 'json' };
import type { ModelQuality } from '../libraryQuality';
import LIBRARY from '../libraryRoles.json' with { type: 'json' };
import { rectOfFurniture, rectsOverlap } from '../placement';
import { adoptedFurnitureIdOf } from '../sceneDressing';
import { DRESSING_OFF_MAX } from '../sceneLayer';
import { standardSceneOf } from '../sceneStandard';
import { sceneStyleOf } from '../sceneStyles';
import type { LayerStyle } from '../sceneVariety';
import type { PascalItemNode, PascalNode, PascalScene } from '../types';

/** Dữ liệu chất lượng giả (tệp thật đang rỗng) để `roomset` có ứng viên. */
const Q = vi.hoisted(() => new Map<string, unknown>());
vi.mock('../libraryQuality', async (importOriginal) => {
  const real = await importOriginal<{ qualityOf: (id: string) => unknown }>();
  // Q rỗng → dữ liệu chất lượng THẬT (`libraryQuality.json`).
  return { ...real, qualityOf: (id: string) => (Q.size > 0 ? Q.get(id) : real.qualityOf(id)) };
});

const HUMAN = { source: 'human', reviewed: true, confidence: 1 } as const;
const ROOM = 'R-0000000ADOPT';
const LVL = 'L-0000000ADOPT';
const outline: Point[] = [
  { x: 0, y: 0 },
  { x: 5000, y: 0 },
  { x: 5000, y: 4000 },
  { x: 0, y: 4000 },
];
const emptyBedroom = (usage: Room['usage'] = 'bedroom', dressingOff?: string[]): SpatialGraph =>
  ({
    building: { ...HUMAN, name: 'b', datumElevationMm: 0 },
    levels: [{ ...HUMAN, id: LVL, name: 'T1', order: 0, elevationMm: 0, heightMm: 3000 }],
    walls: outline.map(
      (start, i) =>
        ({ ...HUMAN, id: `W-00000ADOPT${i}`, levelId: LVL, centreline: { start, end: outline[(i + 1) % 4] as Point }, thicknessMm: 200, heightMm: 2700, kind: 'envelope', openingIds: [] }) as Wall,
    ),
    openings: [],
    rooms: [{ ...HUMAN, id: ROOM, levelId: LVL, name: 'Phòng', usage, outline, areaM2: 20, wallIds: [], ...(dressingOff === undefined ? {} : { dressingOff }) } as Room],
    furniture: [],
    axes: [],
    dimensions: [],
    notes: [],
  }) as unknown as SpatialGraph;

const base = sceneStyleOf(undefined);
const ON: LayerStyle = { ...base, roomSet: true, layout: new Set() };
const OFF: LayerStyle = { ...base, roomSet: false, layout: new Set() };
const sceneOf = (graph: SpatialGraph, style: LayerStyle = OFF): PascalScene => standardSceneOf(graph, { style }).scene;
const items = (scene: PascalScene): PascalItemNode[] => Object.values(scene.nodes).filter((n): n is PascalItemNode => n.type === 'item');
const generated = (scene: PascalScene): PascalItemNode[] =>
  items(scene).filter((n) => n.id.startsWith('item_DRESS-') && n.metadata?.appfront?.fields?.['roomId'] === ROOM);
const bedOf = (scene: PascalScene): PascalItemNode =>
  scene.nodes[`item_DRESS-bed-${ROOM}`] as PascalItemNode;
const dressIdOf = (node: PascalNode): string => node.id.slice('item_'.length);
const spot = (n: PascalNode | undefined): string =>
  n?.type === 'item' ? `${n.position[0].toFixed(3)},${n.position[2].toFixed(3)}|${n.asset.src.split('?')[0]}` : 'vắng';
const withNode = (scene: PascalScene, node: PascalNode): PascalScene => ({ ...scene, nodes: { ...scene.nodes, [node.id]: node } });
const shifted = (node: PascalItemNode, dx: number, dz = 0, yaw = 0): PascalItemNode =>
  ({ ...node, position: [node.position[0] + dx, node.position[1], node.position[2] + dz], rotation: [0, node.rotation[1] + yaw, 0] }) as PascalItemNode;

interface Change {
  readonly kind: string;
  readonly before?: unknown;
  readonly after?: unknown;
}
/** Áp lệnh lên đồ thị như máy chủ: thêm/sửa/xoá đồ, thay phòng. */
const apply = (graph: SpatialGraph, changes: readonly Change[]): SpatialGraph =>
  changes.reduce((g, c) => {
    const after = c.after as { id: string } | null;
    const id = (after ?? (c.before as { id: string })).id;
    if (c.kind === 'room') return { ...g, rooms: g.rooms.map((r) => (r.id === id ? (after as Room) : r)) };
    const rest = g.furniture.filter((f) => f.id !== id);
    return { ...g, furniture: after === null ? rest : [...rest, after as Furniture] };
  }, graph);
const commit = (graph: SpatialGraph, scene: PascalScene, changed: readonly string[], idBook = new Map<string, string>()) => {
  const result = createPascalEditCommand({ graph: normalizeSpatial(graph), scene, commit: { origin: 'local', changedNodeIds: [...changed] }, actorId: 'U-1', idBook });
  if (!result.ok) throw new Error(result.error.reasons.join(' '));
  return result.data.changes as readonly Change[];
};
const furnitureOf = (changes: readonly Change[]) => changes.filter((c) => c.kind === 'furniture');
const realBedOf = (scene: PascalScene): PascalItemNode | undefined =>
  scene.nodes[`item_${adoptedFurnitureIdOf(`DRESS-bed-${ROOM}`)}`] as PascalItemNode | undefined;

describe('mẫu tại chỗ có hoán đổi realism (không thư viện máy chủ)', () => {
  it('nhận giường `double-bed` (tệp `bed-sf`): lưu thư mục tên gọi, tải lại cùng đường hiển thị; lưu lại không trôi', () => {
    setRealismModels(true);
    try {
      const graph = emptyBedroom();
      const scene = sceneOf(graph);
      const bed = bedOf(scene);
      expect(bed.asset.src).toBe('/items/bed-sf/model.glb');
      const moved = shifted(bed, 0, 0.1);
      const changes = commit(graph, withNode(scene, moved), [bed.id]);
      expect(furnitureOf(changes)[0]?.after).toMatchObject({ model: { src: '/items/double-bed/model.glb' } });
      const saved = apply(graph, changes);
      const reloaded = sceneOf(saved);
      const real = realBedOf(reloaded) as PascalItemNode;
      expect(spot(real)).toBe(spot(moved));
      // Lượt lưu kế (dời tiếp đồ thật): vẫn thư mục tên gọi, không `bed-sf`.
      const again = commit(saved, withNode(reloaded, shifted(real, 0, 0.05)), [real.id]);
      expect((furnitureOf(again)[0]?.after as Furniture).model?.src).toBe('/items/double-bed/model.glb');
    } finally {
      setRealismModels(false);
    }
  });
});

describe('một món sinh với thư viện máy chủ (roomset bật/tắt)', () => {
  const roles = LIBRARY.roles as Record<string, string[]>;
  const SET_LIB_ROLES = ['doubleBed', 'nightstand', 'closet', 'dresser', 'desk', 'diningChair', 'armchair', 'coffeeTable', 'sofa', 'bench', 'bookshelf', 'cabinet', 'diningTable'];
  const mmOf = (role: string): [number, number, number] =>
    role === 'doubleBed' ? [1600, 900, 2000] : role === 'nightstand' ? [450, 550, 400] : role === 'closet' ? [1000, 2000, 600] : [800, 800, 800];
  beforeAll(() => {
    registerServerLibrary(
      SET_LIB_ROLES.flatMap((role) =>
        (roles[role] ?? []).map((id) => {
          const [widthMm, heightMm, depthMm] = mmOf(role);
          return { id, widthMm, heightMm, depthMm, modelUrl: `https://x.test/${id}.glb` };
        }),
      ),
    );
    for (const role of SET_LIB_ROLES)
      for (const [i, id] of (roles[role] ?? []).entries())
        Q.set(id, {
          role,
          useMm: [1000, 1000, 1000],
          front: { axis: '+z', check: 'ok' },
          completeness: { v: 'full', by: 'i' },
          parts: [{ kind: 'frame', share: 0.5, lab: [55 + (i % 5), 8, 22], material: 'wood', kindBy: 'm' }],
          detail: { tris: 1, kb: 1, textures: 0, maxTex: 0, tier: 'light' },
          licence: 'CC0',
          source: 'test',
        } satisfies ModelQuality);
  });
  afterAll(() => {
    clearServerLibrary();
    Q.clear();
  });

  for (const [name, style] of [['bật', ON], ['tắt', OFF]] as const) {
    it(`roomset ${name}: dời giường → 1 món + phòng; tải lại: giường đúng chỗ/mẫu, anh em ngoài giường y nguyên, đồ trên giường đi theo`, () => {
      const graph = emptyBedroom();
      const scene = sceneOf(graph, style);
      const before = generated(scene);
      const bed = bedOf(scene);
      const dx = -0.3;
      const moved = shifted(bed, dx);
      const changes = commit(graph, withNode(scene, moved), [bed.id]);
      expect(furnitureOf(changes)).toHaveLength(1);
      expect(furnitureOf(changes)[0]?.after).toMatchObject({ id: adoptedFurnitureIdOf(dressIdOf(bed)) });
      expect(changes.find((c) => c.kind === 'room')?.after).toMatchObject({ dressingOff: [dressIdOf(bed)] });

      const saved = apply(graph, changes);
      const reloaded = sceneOf(saved, style);
      expect(spot(realBedOf(reloaded))).toBe(spot(moved));
      expect(reloaded.nodes[bed.id]).toBeUndefined();
      const onBed = (n: PascalNode) => n.id.includes(`-${dressIdOf(bed)}`);
      for (const n of before.filter((x) => x.id !== bed.id && !onBed(x))) expect(spot(reloaded.nodes[n.id])).toBe(spot(n));
      // Đồ đặt trên/dưới giường: không còn ở chỗ cũ; thảm đi theo đúng một đoạn dời.
      const hosted = before.filter(onBed);
      expect(hosted.length).toBeGreaterThan(0);
      for (const n of hosted) expect(spot(reloaded.nodes[n.id])).not.toBe(spot(n));
      const rug = before.find((n) => n.id.startsWith(`item_DRESS-rug-${dressIdOf(bed)}`));
      if (rug !== undefined) expect((reloaded.nodes[rug.id] as PascalItemNode | undefined)?.position[0]).toBeCloseTo(rug.position[0] + dx, 3);
      expect(JSON.stringify(sceneOf(saved, style))).toBe(JSON.stringify(reloaded));
    });
  }

  it('xoay giường 90°: đồ trên giường dựng lại theo góc mới, không ở chỗ/góc cũ', () => {
    const graph = emptyBedroom();
    const scene = sceneOf(graph, ON);
    const bed = bedOf(scene);
    const hosted = generated(scene).filter((n) => n.id.includes(`-${dressIdOf(bed)}`));
    const saved = apply(graph, commit(graph, withNode(scene, shifted(bed, 0, 0, Math.PI / 2)), [bed.id]));
    const reloaded = sceneOf(saved, ON);
    for (const n of hosted) {
      const now = reloaded.nodes[n.id] as PascalItemNode | undefined;
      expect(now === undefined || spot(now) !== spot(n) || now.rotation[1] !== n.rotation[1]).toBe(true);
    }
  });

  it('đổi MẪU neo (giường): chỉ giường được ghi, kèm mẫu mới; anh em không vào bản lưu', () => {
    const graph = emptyBedroom();
    const scene = sceneOf(graph, ON);
    const bed = bedOf(scene);
    const other = (roles['doubleBed'] ?? []).find((id) => !bed.asset.src.includes(`/${id}.glb`)) as string;
    const swapped = { ...bed, asset: { ...bed.asset, id: other, src: `https://x.test/${other}.glb` } } as PascalItemNode;
    const changes = commit(graph, withNode(scene, swapped), [bed.id]);
    expect(furnitureOf(changes)).toHaveLength(1);
    expect(furnitureOf(changes)[0]?.after).toMatchObject({ model: { id: other, src: `/items/${other}/model.glb` } });
    const saved = apply(graph, changes);
    expect(saved.furniture).toHaveLength(1);
    const reloaded = sceneOf(saved, ON);
    expect(realBedOf(reloaded)?.asset.src).toBe(`https://x.test/${other}.glb`);
    expect(generated(reloaded).length).toBe(generated(scene).length - 1);
  });

  it('`dressingOff` tràn trần: mục "đã nhận" không rơi, không nhân đôi giường (cả lượt lưu sau)', () => {
    const deleted = Array.from({ length: DRESSING_OFF_MAX }, (_, i) => `DRESS-gone${i}-${ROOM}`);
    const graph = emptyBedroom('bedroom', deleted);
    const scene = sceneOf(graph, ON);
    const bed = bedOf(scene);
    const changes = commit(graph, withNode(scene, shifted(bed, -0.3)), [bed.id]);
    const off = (changes.find((c) => c.kind === 'room')?.after as Room).dressingOff ?? [];
    expect(off).toHaveLength(DRESSING_OFF_MAX);
    expect(off).toContain(dressIdOf(bed));
    expect(off).not.toContain(deleted[0]);
    const saved = apply(graph, changes);
    const reloaded = sceneOf(saved, ON);
    const beds = (s: PascalScene) => items(s).filter((n) => n.metadata?.appfront?.fields?.['kind'] === 'bed');
    expect(beds(reloaded)).toHaveLength(1);
    // Lượt sau xoá thêm một món sinh khác: vẫn giữ mục giường.
    const victim = generated(reloaded).find((n) => n.id.includes('nightstand')) as PascalItemNode;
    const rest = { ...reloaded, nodes: Object.fromEntries(Object.entries(reloaded.nodes).filter(([id]) => id !== victim.id)) };
    const next = apply(saved, commit(saved, rest, [victim.id]));
    expect(next.rooms[0]?.dressingOff).toContain(dressIdOf(bed));
    expect(beds(sceneOf(next, ON))).toHaveLength(1);
  });

  it('đổi công năng phòng sau khi nhận giường: đồ sinh mới không chồng lên giường thật', () => {
    const graph = emptyBedroom();
    const scene = sceneOf(graph, ON);
    const bed = bedOf(scene);
    const saved = apply(graph, commit(graph, withNode(scene, shifted(bed, -0.3)), [bed.id]));
    const living: SpatialGraph = { ...saved, rooms: saved.rooms.map((r) => ({ ...r, usage: 'livingRoom' as const })) };
    const reloaded = sceneOf(living, ON);
    const real = living.furniture[0] as Furniture;
    expect(realBedOf(reloaded)).toBeDefined();
    const fresh = generated(reloaded).filter((n) => n.position[1] < 0.01 && !n.id.includes('-rug'));
    expect(fresh.length).toBeGreaterThan(0);
    for (const n of fresh) {
      const f = n.metadata?.appfront?.fields as { boundingBox: Furniture['boundingBox']; rotationDeg: number };
      const rect = rectOfFurniture({ centre: { x: n.position[0] * 1000, y: n.position[2] * 1000 } as Point, boundingBox: f.boundingBox, rotationDeg: f.rotationDeg as Furniture['rotationDeg'] });
      expect(rectsOverlap(rect, rectOfFurniture(real)), n.id).toBe(false);
    }
  });

  it('đầu-cuối qua derivedHistory: dời giường → Ctrl+Z = như lúc nạp → Ctrl+Y = đúng 1 món', () => {
    let stored = denormalizeSpatial(normalizeSpatial(emptyBedroom()));
    const history = createDerivedHistory();
    const idBook = new Map<string, string>();
    let baseScene = sceneOf(stored, ON);
    recordDerived(history, baseScene, []);
    const save = (raw: PascalScene): void => {
      const { scene } = restoreDerived(history, raw, () => undefined);
      // Như `commitOfScenes`: node khác mốc (kể cả node vắng) là "đã đổi".
      const ids = [...new Set([...Object.keys(scene.nodes), ...Object.keys(baseScene.nodes)])];
      const changed = ids.filter((id) => JSON.stringify(scene.nodes[id]) !== JSON.stringify(baseScene.nodes[id]));
      const result = createPascalEditCommand({ graph: normalizeSpatial(stored), scene, commit: { origin: 'local', changedNodeIds: changed }, actorId: 'U-1', idBook });
      if (!result.ok && result.error.code !== 'PASCAL_NO_CHANGE') throw new Error(result.error.reasons.join(' '));
      stored = apply(stored, result.ok ? (result.data.changes as readonly Change[]) : []);
      baseScene = sceneOf(stored, ON);
      recordDerived(history, baseScene, []);
    };
    const loaded = baseScene;
    const moved = withNode(loaded, shifted(bedOf(loaded), -0.3));
    save(moved);
    expect(stored.furniture).toHaveLength(1);
    save(loaded); // Ctrl+Z: editor trả ảnh chụp lúc nạp.
    expect(stored.furniture).toHaveLength(0);
    expect(stored.rooms[0]?.dressingOff ?? []).toEqual([]);
    // Phòng vừa đi qua một lệnh sửa nên mang `reviewed: false` (siêu dữ liệu duyệt); đồ trong cảnh phải y như lúc nạp.
    expect(JSON.stringify(items(sceneOf(stored, ON)))).toBe(JSON.stringify(items(loaded)));
    save(moved); // Ctrl+Y.
    expect(stored.furniture).toHaveLength(1);
    expect(stored.furniture[0]?.id).toBe(adoptedFurnitureIdOf(`DRESS-bed-${ROOM}`));
    expect(stored.rooms[0]?.dressingOff).toEqual([`DRESS-bed-${ROOM}`]);
  });
});

/* ---- REVIEW-2: catalog thật (thư viện + dữ liệu chất lượng thật), phong cách am-ap ---- */
describe('catalog thật: nhận một tab đầu giường không đổi mẫu anh em (REVIEW-2 #1)', () => {
  const AM_AP = sceneStyleOf('am-ap');
  const REAL_ON: LayerStyle = { ...AM_AP, roomSet: true, layout: new Set() };
  const REAL_OFF: LayerStyle = { ...AM_AP, roomSet: false, layout: new Set() };
  beforeAll(() => {
    Q.clear();
    const models = (QUALITY as unknown as { models: Record<string, { u: [number, number, number] }> }).models;
    registerServerLibrary(
      Object.entries(models).map(([id, m]) => ({ id, widthMm: m.u[0], heightMm: m.u[1], depthMm: m.u[2], modelUrl: `https://x.test/${id}.glb` })),
    );
  });
  afterAll(() => clearServerLibrary());

  for (const [name, style] of [['bật', REAL_ON], ['tắt', REAL_OFF]] as const) {
    it(`roomset ${name}: dời tab 50 mm → 1 món; tải lại: giường, tab kia, ghế… cùng mẫu`, () => {
      const graph = emptyBedroom();
      const scene = sceneOf(graph, style);
      const tab = scene.nodes[`item_DRESS-nightstand-${ROOM}-1`] as PascalItemNode;
      expect(tab).toBeDefined();
      const changes = commit(graph, withNode(scene, shifted(tab, 0.05)), [tab.id]);
      expect(furnitureOf(changes)).toHaveLength(1);
      const reloaded = sceneOf(apply(graph, changes), style);
      const model = (n: PascalNode | undefined): string => (n?.type === 'item' ? n.asset.src.split('?')[0] ?? '' : 'vắng');
      const others = generated(scene).filter((n) => n.id !== tab.id && !n.id.includes(`-${dressIdOf(tab)}`));
      expect(others.map((n) => n.id)).toEqual(expect.arrayContaining([`item_DRESS-bed-${ROOM}`, `item_DRESS-nightstand-${ROOM}-2`]));
      expect(others.map((n) => `${n.id}=${model(reloaded.nodes[n.id])}`)).toEqual(others.map((n) => `${n.id}=${model(n)}`));
      expect(model(reloaded.nodes[`item_${adoptedFurnitureIdOf(dressIdOf(tab))}`])).toBe(model(tab));
    });
  }

  /** Cỡ nhìn thấy của node, mm: cỡ catalog × `asset.scale` (bỏ scale riêng của catalog) × `node.scale`. */
  const seenMm = (n: PascalItemNode): number[] => {
    const folder = (n.metadata?.appfront?.fields?.['modelFolder'] as string | undefined) ?? n.asset.id;
    const catalog = CATALOG_MODELS[folder];
    if (catalog === undefined) throw new Error(`không có mẫu ${folder}`);
    const k = catalog.scale ?? [1, 1, 1];
    return [0, 1, 2].map((i) => Math.round((catalog.dimensions[i] as number) * ((n.asset.scale?.[i] ?? 1) / (k[i] as number)) * (n.scale[i] as number) * 1000));
  };
  const near = (a: number[], b: number[]): void => a.forEach((v, i) => expect(Math.abs(v - (b[i] as number)), `trục ${i}: ${a.join('×')} ≠ ${b.join('×')}`).toBeLessThanOrEqual(1));

  for (const [name, style] of [['bật', REAL_ON], ['tắt', REAL_OFF]] as const) {
    for (const [what, scale, yaw, swap] of [
      ['kéo rộng ×2', [2, 1, 1], 0, false],
      ['kéo cao ×1,3', [1, 1.3, 1], 0, false],
      ['xoay 90° + kéo rộng ×1,5', [1.5, 1, 1], Math.PI / 2, false],
      ['đổi mẫu + kéo sâu ×1,4', [1, 1, 1.4], 0, true],
    ] as const) {
      it(`REVIEW-4 #2 — roomset ${name}, tủ áo sinh ${what}: cỡ nhìn thấy sau tải lại = lúc lưu (±1 mm)`, () => {
        const graph = emptyBedroom();
        const scene = sceneOf(graph, style);
        const wardrobe = scene.nodes[`item_DRESS-wardrobe-${ROOM}`] as PascalItemNode;
        expect(wardrobe).toBeDefined();
        const current = (wardrobe.metadata?.appfront?.fields?.['modelFolder'] as string) ?? '';
        const other = swap ? (LIBRARY.roles as Record<string, string[]>)['closet']?.find((id) => id !== current && CATALOG_MODELS[id] !== undefined) : undefined;
        const tile = other === undefined ? wardrobe.asset : { ...wardrobe.asset, id: other, src: `https://x.test/${other}.glb`, dimensions: [...(CATALOG_MODELS[other]?.dimensions ?? [1, 1, 1])] as [number, number, number], scale: [1, 1, 1] as [number, number, number], offset: [0, 0, 0] as [number, number, number], rotation: [0, 0, 0] as [number, number, number] };
        const edited = { ...shifted(wardrobe, 0, 0, yaw), asset: tile, scale: [...scale] } as PascalItemNode;
        const before = seenMm(other === undefined ? edited : { ...edited, metadata: { ...edited.metadata, appfront: { ...edited.metadata?.appfront, fields: {} } } } as PascalItemNode);
        const changes = commit(graph, withNode(scene, edited), [wardrobe.id]);
        expect(furnitureOf(changes)).toHaveLength(1);
        const reloaded = sceneOf(apply(graph, changes), style);
        const real = reloaded.nodes[`item_${adoptedFurnitureIdOf(dressIdOf(wardrobe))}`] as PascalItemNode;
        near(seenMm(real), before);
        expect(real.rotation[1]).toBeCloseTo(edited.rotation[1], 6);
        // Lưu lại đồ thật vừa tải (dời nhẹ): cỡ không trôi.
        const again = apply(apply(graph, changes), commit(apply(graph, changes), withNode(reloaded, shifted(real, 0.01)), [real.id]));
        near(seenMm(sceneOf(again, style).nodes[real.id] as PascalItemNode), before);
      });
    }
  }

  it('REVIEW-3 #1 — cờ tắt, không cặp nhận: sofa tối đã lưu `appfront-sofa` vẫn tính vào tông căn (như mẫu id catalog)', () => {
    const sofa = (modelId: string): Furniture =>
      ({
        ...HUMAN,
        id: 'F-0000000SOFA01' as Furniture['id'],
        levelId: LVL,
        roomId: ROOM,
        kind: 'sofa',
        centre: { x: 4300, y: 2000 },
        boundingBox: { min: { x: 3850, y: 1000 }, max: { x: 4750, y: 3000 } },
        rotationDeg: 90,
        model: { id: modelId, src: '/items/sofa-brown-leather-3s-b/model.glb' },
      }) as unknown as Furniture;
    const srcs = (modelId: string): string[] =>
      items(sceneOf({ ...emptyBedroom(), furniture: [sofa(modelId)] }, REAL_OFF))
        .filter((n) => n.id.startsWith('item_DRESS-'))
        .map((n) => `${n.id}=${n.asset.src.split('?')[0] ?? ''}|${n.asset.dimensions.join(',')}`);
    expect(srcs('appfront-sofa').length).toBeGreaterThan(3);
    expect(srcs('appfront-sofa')).toEqual(srcs('sofa-brown-leather-3s-b'));
  });
});

describe('cờ tắt, dự án không có cặp nhận: mẫu đã lưu hiển thị như master (REVIEW-2 #3)', () => {
  it('realism bật: giường người dùng lưu `/items/double-bed/model.glb` vẫn hiện `double-bed`', () => {
    setRealismModels(true);
    try {
      const bed = {
        ...HUMAN,
        id: 'F-00000000SAVED' as Furniture['id'],
        levelId: LVL,
        roomId: ROOM,
        kind: 'bed',
        centre: { x: 2500, y: 2000 },
        boundingBox: { min: { x: 1700, y: 1000 }, max: { x: 3300, y: 3000 } },
        rotationDeg: 0,
        model: { id: 'double-bed', src: '/items/double-bed/model.glb' },
      } as unknown as Furniture;
      const scene = sceneOf({ ...emptyBedroom(), furniture: [bed] });
      expect((scene.nodes[`item_${bed.id}`] as PascalItemNode).asset.src).toBe('/items/double-bed/model.glb');
    } finally {
      setRealismModels(false);
    }
  });
});

describe('`dressingOff` đầy dấu đã nhận (REVIEW-2 #4)', () => {
  it('200 cặp đã nhận: nhận món thứ 201 bị từ chối kèm lời, không dấu nào rơi; sửa đồ khác vẫn giữ đủ 200', () => {
    const marks = Array.from({ length: DRESSING_OFF_MAX }, (_, i) => `DRESS-kept${i}-${ROOM}`);
    const reals = marks.map(
      (mark, i) =>
        ({
          ...HUMAN,
          id: adoptedFurnitureIdOf(mark),
          levelId: LVL,
          roomId: ROOM,
          kind: 'other',
          liftMm: 1500,
          centre: { x: 300 + (i % 20) * 200, y: 300 + Math.floor(i / 20) * 300 },
          boundingBox: { min: { x: 250 + (i % 20) * 200, y: 250 + Math.floor(i / 20) * 300 }, max: { x: 350 + (i % 20) * 200, y: 350 + Math.floor(i / 20) * 300 } },
          rotationDeg: 0,
        }) as unknown as Furniture,
    );
    const graph: SpatialGraph = { ...emptyBedroom('bedroom', marks), furniture: reals };
    const scene = sceneOf(graph);
    const bed = bedOf(scene);
    const result = createPascalEditCommand({
      graph: normalizeSpatial(graph),
      scene: withNode(scene, shifted(bed, -0.3)),
      commit: { origin: 'local', changedNodeIds: [bed.id] },
      actorId: 'U-1',
    });
    expect(result.ok).toBe(false);
    expect(result.ok ? [] : result.error.reasons.join(' ')).toMatch(/chưa nhận thêm được/);
    const real = scene.nodes[`item_${reals[0]?.id}`] as PascalItemNode;
    const next = apply(graph, commit(graph, withNode(scene, shifted(real, 0.05)), [real.id]));
    expect(next.rooms[0]?.dressingOff).toEqual(marks);
  });
});
