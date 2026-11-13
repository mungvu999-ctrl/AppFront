/**
 * M18 LF3 — co giãn chiều cao một món → lưu → Ctrl+Z → lưu: bản lưu phải về cao gốc (trước đây `carriedFrom` mang
 * `heightMm` của lớp đã lưu gần nhất, tải lại thì cao sai). Redo → lưu → cao mới. Món khác, món sinh không đổi.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { normalizeSpatial } from '@/domain/spatial/normalize';
import type { Furniture, Point, Room, SpatialGraph, Wall } from '@/domain/spatial/types';

import { createPascalEditCommand } from '../fromPascal';
import { clearServerLibrary, registerServerLibrary } from '../furnitureCatalog';
import QUALITY from '../libraryQuality.json' with { type: 'json' };
import { standardSceneOf } from '../sceneStandard';
import { sceneStyleOf } from '../sceneStyles';
import type { LayerStyle } from '../sceneVariety';
import type { PascalItemNode, PascalNode, PascalScene } from '../types';

const HUMAN = { source: 'human', reviewed: true, confidence: 1 } as const;
const ROOM = 'R-0000000HGT18';
const LVL = 'L-0000000HGT18';
const SOFA = 'F-0000000HGT18';
const outline: Point[] = [
  { x: 0, y: 0 },
  { x: 5000, y: 0 },
  { x: 5000, y: 4000 },
  { x: 0, y: 4000 },
];
const ai = (id: string, variant: string, cx: number, cy: number, w: number, d: number): Furniture =>
  ({
    source: 'ai',
    reviewed: false,
    confidence: 0.8,
    id,
    levelId: LVL,
    roomId: ROOM,
    kind: 'other',
    variant,
    centre: { x: cx, y: cy },
    boundingBox: { min: { x: cx - w / 2, y: cy - d / 2 }, max: { x: cx + w / 2, y: cy + d / 2 } },
    rotationDeg: 0,
  }) as unknown as Furniture;
const graph0 = (): SpatialGraph =>
  ({
    building: { ...HUMAN, name: 'b', datumElevationMm: 0 },
    levels: [{ ...HUMAN, id: LVL, name: 'T1', order: 0, elevationMm: 0, heightMm: 3000 }],
    walls: outline.map(
      (start, i) =>
        ({ ...HUMAN, id: `W-00000HGT18${i}`, levelId: LVL, centreline: { start, end: outline[(i + 1) % 4] as Point }, thicknessMm: 200, heightMm: 2700, kind: 'envelope', openingIds: [] }) as Wall,
    ),
    openings: [],
    rooms: [{ ...HUMAN, id: ROOM, levelId: LVL, name: 'Phòng', usage: 'livingRoom', outline, areaM2: 20, wallIds: [] } as Room],
    furniture: [
      ai(SOFA, 'sofa', 2500, 3100, 2088, 1050),
      ai('F-0000000CT118', 'coffeeTable', 2287, 1796, 1208, 462),
      // Món đã mang `heightMm` từ trước: undo phải về đúng số này, không về "vắng".
      { ...ai('F-0000000AR118', 'armchair', 771, 2794, 726, 604), heightMm: 820 } as Furniture,
    ],
    axes: [],
    dimensions: [],
    notes: [],
  }) as unknown as SpatialGraph;

const STYLE: LayerStyle = { ...sceneStyleOf('am-ap'), roomSet: true, layout: new Set() };
const sceneOf = (graph: SpatialGraph): PascalScene => standardSceneOf(graph, { style: STYLE }).scene;
const withNode = (scene: PascalScene, node: PascalNode): PascalScene => ({ ...scene, nodes: { ...scene.nodes, [node.id]: node } });
const apply = (graph: SpatialGraph, changes: readonly { after?: unknown; before?: unknown }[]): SpatialGraph =>
  changes.reduce((g, c) => {
    const after = c.after as Furniture | null;
    const id = (after ?? (c.before as Furniture)).id;
    const rest = g.furniture.filter((f) => f.id !== id);
    return { ...g, furniture: after === null ? rest : [...rest, after] };
  }, graph);
/** Lưu một lượt sửa; máy chủ đặt `edited: true` cho món vừa sửa (BE provenance) như sau PUT thật. */
const save = (graph: SpatialGraph, scene: PascalScene, ids: readonly string[]): SpatialGraph => {
  const result = createPascalEditCommand({ graph: normalizeSpatial(graph), scene, commit: { origin: 'local', changedNodeIds: [...ids] }, actorId: 'U-1', idBook: new Map() });
  if (!result.ok) throw new Error(result.error.reasons.join(' '));
  const changed = result.data.changes.map((c) => ((c.after ?? c.before) as Furniture).id);
  const next = apply(graph, result.data.changes);
  return { ...next, furniture: next.furniture.map((f) => (changed.includes(f.id) ? ({ ...f, edited: true } as Furniture) : f)) };
};
const byId = (g: SpatialGraph, id: string): Furniture => g.furniture.find((f) => f.id === id)!;
const seenHeightMm = (scene: PascalScene, id: string): number => {
  const n = scene.nodes[id] as PascalItemNode;
  // Như `toSpatial.itemFieldsOf`: cao đang thấy = `asset.dimensions[1]` × `scale[1]`.
  return Math.round(n.asset.dimensions[1] * n.scale[1] * 1000);
};
const others = (g: SpatialGraph): Furniture[] => g.furniture.filter((f) => f.id !== SOFA).sort((a, b) => a.id.localeCompare(b.id));
const noWrite = (graph: SpatialGraph, ids: readonly string[]): void => {
  const result = createPascalEditCommand({ graph: normalizeSpatial(graph), scene: sceneOf(graph), commit: { origin: 'local', changedNodeIds: [...ids] }, actorId: 'U-1', idBook: new Map() });
  expect(result.ok ? result.data.changes : [], 'mở lại không ghi').toEqual([]);
};

beforeAll(() => {
  const models = (QUALITY as unknown as { models: Record<string, { u: [number, number, number] }> }).models;
  registerServerLibrary(
    Object.entries(models).map(([id, m]) => ({ id, widthMm: m.u[0], heightMm: m.u[1], depthMm: m.u[2], modelUrl: `https://x.test/${id}.glb?sig=1` })),
  );
});
afterAll(() => clearServerLibrary());

describe('LF3: undo/redo chiều cao sau khi lưu trả dữ liệu lưu về đúng trạng thái', () => {
  it.each([
    ['sofa (gốc không có heightMm)', `item_${SOFA}`, SOFA],
    ['ghế bành (gốc heightMm 820)', 'item_F-0000000AR118', 'F-0000000AR118'],
  ])('%s: co cao → lưu → undo → lưu → tải lại = cao gốc; redo → lưu → tải lại = cao mới', (_label, nodeId, id) => {
    const graph = graph0();
    const scene = sceneOf(graph);
    const original = scene.nodes[nodeId] as PascalItemNode;
    const originalMm = seenHeightMm(scene, nodeId);
    const scaled = { ...original, scale: [1, 1.3, 1] } as PascalItemNode;

    const saved = save(graph, withNode(scene, scaled), [nodeId]);
    const newMm = byId(saved, id).heightMm;
    expect(newMm).toBeDefined();
    expect(Math.abs((newMm as number) - originalMm * 1.3)).toBeLessThanOrEqual(2);
    const newSeenMm = seenHeightMm(sceneOf(saved), nodeId);
    expect(newSeenMm).toBeGreaterThan(originalMm + 50);

    // Ctrl+Z: Pascal trả node lúc nạp (siêu dữ liệu lúc nạp) → lưu.
    const undone = save(saved, withNode(scene, original), [nodeId]);
    expect(byId(undone, id).heightMm).toBe(byId(graph, id).heightMm);
    const reUndo = sceneOf(undone);
    expect(Math.abs(seenHeightMm(reUndo, nodeId) - originalMm)).toBeLessThanOrEqual(1);
    noWrite(undone, [nodeId]);

    // Redo → lưu → tải lại = cao mới.
    const redone = save(undone, withNode(scene, scaled), [nodeId]);
    expect(byId(redone, id).heightMm).toBe(newMm);
    expect(seenHeightMm(sceneOf(redone), nodeId)).toBe(newSeenMm);

    // Món khác không đổi qua cả chuỗi.
    const rest = graph.furniture.filter((f) => f.id !== id).map((f) => f.id);
    for (const g of [saved, undone, redone]) {
      expect(g.furniture.filter((f) => rest.includes(f.id)).sort((a, b) => a.id.localeCompare(b.id))).toEqual(
        graph.furniture.filter((f) => rest.includes(f.id)).sort((a, b) => a.id.localeCompare(b.id)),
      );
    }
  });

  it('nâng món → lưu → undo → lưu: liftMm về gốc (cùng gốc lỗi)', () => {
    const graph = graph0();
    const scene = sceneOf(graph);
    const nodeId = `item_${SOFA}`;
    const original = scene.nodes[nodeId] as PascalItemNode;
    const lifted = { ...original, position: [original.position[0], original.position[1] + 0.3, original.position[2]] } as PascalItemNode;
    const saved = save(graph, withNode(scene, lifted), [nodeId]);
    expect(byId(saved, SOFA).liftMm).toBeDefined();
    const undone = save(saved, withNode(scene, original), [nodeId]);
    expect(byId(undone, SOFA).liftMm).toBe(byId(graph, SOFA).liftMm);
    noWrite(undone, [nodeId]);
  });

  it('mở cảnh, chạm mọi node đồ (AI + sinh) mà không sửa: không ghi gì; món khác giữ nguyên', () => {
    const graph = graph0();
    const scene = sceneOf(graph);
    const items = Object.values(scene.nodes).filter((n) => n.type === 'item').map((n) => n.id);
    expect(items.length).toBeGreaterThan(3);
    noWrite(graph, items);
    expect(others(graph)).toEqual(others(graph0()));
  });
});
