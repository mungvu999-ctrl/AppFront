/**
 * M18 LA — đường chỉnh sửa thật qua thẻ "Đổi mẫu": đổi mẫu (thư viện hiện hành) → co giãn → lưu → dựng lại → lưu lần 2.
 * Cỡ/tâm nhìn thấy giữ ≤ 1 mm, mẫu giữ, anh em không đổi mẫu; bản lưu cũ (có `model`, không hậu tố cỡ-đã-thấy) dựng như
 * trước; hoàn tác (asset cũ) → bản lưu không còn `model`; món sinh đổi mẫu rồi hoàn tác → đồ thật bị xoá, `dressingOff` trả lại.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { denormalizeSpatial, normalizeSpatial } from '@/domain/spatial/normalize';
import type { Furniture, Point, Room, SpatialGraph, Wall } from '@/domain/spatial/types';
import { createDerivedHistory, recordDerived, restoreDerived } from '@/pascal-page/bridge/derivedHistory';
import { isCurrentModel, swapCandidates, swapUpdateOf } from '@/pascal-page/SwapModelCard';

import { createPascalEditCommand } from '../fromPascal';
import { CATALOG_MODELS, clearServerLibrary, modelSrcOf, registerServerLibrary } from '../furnitureCatalog';
import { itemFitOf, USER_SEEN_SUFFIX } from '../itemFit';
import QUALITY from '../libraryQuality.json' with { type: 'json' };
import { adoptedFurnitureIdOf } from '../sceneDressing';
import { standardSceneOf } from '../sceneStandard';
import { sceneStyleOf } from '../sceneStyles';
import type { LayerStyle } from '../sceneVariety';
import { USER_SEEN_FIELD } from '../toSpatial';
import type { PascalItemNode, PascalNode, PascalScene } from '../types';

const HUMAN = { source: 'human', reviewed: true, confidence: 1 } as const;
const ROOM = 'R-0000000SWP18';
const LVL = 'L-0000000SWP18';
const SOFA = 'F-0000000SWP18';
const outline: Point[] = [
  { x: 0, y: 0 },
  { x: 5000, y: 0 },
  { x: 5000, y: 4000 },
  { x: 0, y: 4000 },
];
const roomGraph = (usage: Room['usage'], furniture: Furniture[] = []): SpatialGraph =>
  ({
    building: { ...HUMAN, name: 'b', datumElevationMm: 0 },
    levels: [{ ...HUMAN, id: LVL, name: 'T1', order: 0, elevationMm: 0, heightMm: 3000 }],
    walls: outline.map(
      (start, i) =>
        ({ ...HUMAN, id: `W-00000SWP18${i}`, levelId: LVL, centreline: { start, end: outline[(i + 1) % 4] as Point }, thicknessMm: 200, heightMm: 2700, kind: 'envelope', openingIds: [] }) as Wall,
    ),
    openings: [],
    rooms: [{ ...HUMAN, id: ROOM, levelId: LVL, name: 'Phòng', usage, outline, areaM2: 20, wallIds: [] } as Room],
    furniture,
    axes: [],
    dimensions: [],
    notes: [],
  }) as unknown as SpatialGraph;
/** Sofa AI chưa xác nhận, hộp 2,2 × 0,95 m sát tường dưới. */
const aiSofa = (extra: Partial<Furniture> = {}): Furniture =>
  ({
    source: 'ai',
    reviewed: false,
    confidence: 0.8,
    id: SOFA,
    levelId: LVL,
    roomId: ROOM,
    kind: 'other',
    variant: 'sofa',
    centre: { x: 2500, y: 3400 },
    boundingBox: { min: { x: 1400, y: 2925 }, max: { x: 3600, y: 3875 } },
    rotationDeg: 0,
    ...extra,
  }) as unknown as Furniture;

const STYLE: LayerStyle = { ...sceneStyleOf('am-ap'), roomSet: true, layout: new Set() };
const sceneOf = (graph: SpatialGraph): PascalScene => standardSceneOf(graph, { style: STYLE }).scene;
const withNode = (scene: PascalScene, node: PascalNode): PascalScene => ({ ...scene, nodes: { ...scene.nodes, [node.id]: node } });
interface Change {
  readonly kind: string;
  readonly before?: unknown;
  readonly after?: unknown;
}
const apply = (graph: SpatialGraph, changes: readonly Change[]): SpatialGraph =>
  changes.reduce((g, c) => {
    const after = c.after as { id: string } | null;
    const id = (after ?? (c.before as { id: string })).id;
    if (c.kind === 'room') return { ...g, rooms: g.rooms.map((r) => (r.id === id ? (after as Room) : r)) };
    const rest = g.furniture.filter((f) => f.id !== id);
    return { ...g, furniture: after === null ? rest : [...rest, after as Furniture] };
  }, graph);
const commit = (graph: SpatialGraph, scene: PascalScene, changed: readonly string[]): readonly Change[] => {
  const result = createPascalEditCommand({ graph: normalizeSpatial(graph), scene, commit: { origin: 'local', changedNodeIds: [...changed] }, actorId: 'U-1', idBook: new Map() });
  if (!result.ok) throw new Error(result.error.reasons.join(' '));
  return result.data.changes as readonly Change[];
};
/** Cỡ nhìn thấy (mm, 3 trục): cỡ catalog × `asset.scale` (bỏ scale riêng của catalog) × `node.scale`. */
const seenMm = (n: PascalItemNode, folder: string): number[] => {
  const cat = CATALOG_MODELS[folder]!;
  const k = cat.scale ?? [1, 1, 1];
  return [0, 1, 2].map((i) => (cat.dimensions[i] as number) * ((n.asset.scale?.[i] ?? 1) / (k[i] as number)) * (n.scale[i] as number) * 1000);
};
/** Tâm NHÌN THẤY trên mặt bằng (mm): vị trí node + R_y(yaw)·(`asset.offset` × `node.scale`). */
const seenCentre = (n: PascalItemNode): number[] => {
  const [ox, , oz] = (n.asset.offset ?? [0, 0, 0]).map((v, i) => v * (n.scale[i] as number)) as [number, number, number];
  const yaw = n.rotation[1];
  return [(n.position[0] + ox * Math.cos(yaw) + oz * Math.sin(yaw)) * 1000, (n.position[2] - ox * Math.sin(yaw) + oz * Math.cos(yaw)) * 1000];
};
const near = (a: number[], b: number[], tol = 1): void =>
  a.forEach((v, i) => expect(Math.abs(v - (b[i] as number)), `trục ${i}: ${a.map((x) => x.toFixed(1)).join('×')} ≠ ${b.map((x) => x.toFixed(1)).join('×')}`).toBeLessThanOrEqual(tol));
const model = (n: PascalNode | undefined): string => (n?.type === 'item' ? (n.asset.src.split('?')[0] ?? '') : 'vắng');
const nodeId = `item_${SOFA}`;

beforeAll(() => {
  const models = (QUALITY as unknown as { models: Record<string, { u: [number, number, number] }> }).models;
  registerServerLibrary(
    Object.entries(models).map(([id, m]) => ({ id, widthMm: m.u[0], heightMm: m.u[1], depthMm: m.u[2], modelUrl: `https://x.test/${id}.glb?sig=1` })),
  );
});
afterAll(() => clearServerLibrary());

/** Đổi sofa sang một mẫu khác của thư viện qua đúng hàm thẻ dùng; trả node đã đổi + id mẫu. */
const swapped = (scene: PascalScene): { node: PascalItemNode; pick: string } => {
  const sofa = scene.nodes[nodeId] as PascalItemNode;
  const options = swapCandidates(sofa as never, []);
  // Mẫu lệch hộp nhiều nhất trong danh sách (cuối danh sách xếp theo chi phí cỡ): phép khớp phải kẹp, không lấp đủ hộp AI.
  const pick = options.filter((o) => !isCurrentModel(sofa.asset as never, o)).at(-1);
  expect(pick, 'thẻ có mẫu sofa khác để đổi').toBeDefined();
  const update = swapUpdateOf(sofa as never, pick!, 3000);
  return { node: { ...sofa, ...update } as PascalItemNode, pick: pick!.id };
};

describe('T4: đổi mẫu máy chủ + co giãn → lưu → dựng lại → lưu lần 2', () => {
  it('cỡ/tâm nhìn thấy giữ ≤ 1 mm; bản lưu = cỡ đang thấy + model có hậu tố; lưu lại không trôi; anh em cùng mẫu', () => {
    const graph = roomGraph('livingRoom', [aiSofa()]);
    const scene = sceneOf(graph);
    const { node, pick } = swapped(scene);
    // Kéo rộng ×1,8: trục rộng vượt kẹp [0,8; 1,25]×g của phép khớp thường — đường cũ (hộp AI × co giãn, khớp thường) mất ~430 mm.
    const edited = { ...node, scale: [1.8, 1, 1] } as PascalItemNode;
    const before = { size: seenMm(edited, pick), centre: seenCentre(edited) };

    const saved = apply(graph, commit(graph, withNode(scene, edited), [nodeId]));
    const stored = saved.furniture.find((f) => f.id === SOFA)!;
    expect(stored.model).toEqual({ id: `${pick}${USER_SEEN_SUFFIX}`, src: `/items/${pick}/model.glb` });
    // Hộp + cao đã lưu = cỡ đang thấy (không phải hộp AI × co giãn).
    near([stored.boundingBox.max.x - stored.boundingBox.min.x, stored.heightMm as number, stored.boundingBox.max.y - stored.boundingBox.min.y], before.size);

    const reloaded = sceneOf(saved);
    const again = reloaded.nodes[nodeId] as PascalItemNode;
    expect(again.asset.id).toBe(pick);
    expect(again.asset.src).toBe(modelSrcOf(pick));
    expect(again.metadata?.appfront?.fields?.[USER_SEEN_FIELD]).toBe(true);
    near(seenMm(again, pick), before.size);
    near(seenCentre(again), before.centre);
    // Mở lại rồi lưu không sửa: không thay đổi nào (không trôi).
    expect(() => commit(saved, reloaded, [nodeId])).toThrow(/không có gì để ghi/);
    // Dời 10 mm rồi lưu lần 2: hộp, cao, mẫu giữ nguyên; tâm đi đúng 10 mm.
    const moved = { ...again, position: [again.position[0] + 0.01, again.position[1], again.position[2]] } as PascalItemNode;
    const saved2 = apply(saved, commit(saved, withNode(reloaded, moved), [nodeId]));
    const stored2 = saved2.furniture.find((f) => f.id === SOFA)!;
    expect(stored2.model).toEqual(stored.model);
    expect(stored2.heightMm).toBe(stored.heightMm);
    expect(stored2.boundingBox.max.x - stored2.boundingBox.min.x).toBe(stored.boundingBox.max.x - stored.boundingBox.min.x);
    expect(stored2.boundingBox.max.y - stored2.boundingBox.min.y).toBe(stored.boundingBox.max.y - stored.boundingBox.min.y);
    expect(stored2.centre.x - stored.centre.x).toBe(10);
    near(seenMm(sceneOf(saved2).nodes[nodeId] as PascalItemNode, pick), before.size);

    // Anh em cùng phòng (đồ sinh, đồ khác): cùng mẫu như lần mở đầu.
    const siblings = Object.values(scene.nodes).filter((n): n is PascalItemNode => n.type === 'item' && n.id !== nodeId && n.metadata?.appfront?.fields?.['roomId'] === ROOM);
    expect(siblings.map((n) => `${n.id}=${model(reloaded.nodes[n.id])}`)).toEqual(siblings.map((n) => `${n.id}=${model(n)}`));
  });
});

describe('tương thích + hoàn tác', () => {
  it('bản lưu cũ: có model, KHÔNG hậu tố cỡ-đã-thấy → dựng khớp thường như trước (không kéo đủ hộp AI), mở không ghi', () => {
    const { pick } = swapped(sceneOf(roomGraph('livingRoom', [aiSofa()])));
    const graph = roomGraph('livingRoom', [aiSofa({ model: { id: pick, src: `/items/${pick}/model.glb` } })]);
    const scene = sceneOf(graph);
    const node = scene.nodes[nodeId] as PascalItemNode;
    const fit = itemFitOf(pick, 2.2, 0.95, undefined, 3000)!;
    expect(node.asset.id).toBe(pick);
    expect(node.asset.scale).toEqual(fit.scale);
    expect(node.metadata?.appfront?.fields?.[USER_SEEN_FIELD]).toBeUndefined();
    expect(() => commit(graph, scene, [nodeId])).toThrow(/không có gì để ghi/);
  });

  it('T6: hoàn tác đổi mẫu (asset cũ appfront-<loại>) sau khi đã lưu → bản lưu không còn model, hộp về hộp AI', () => {
    const graph = roomGraph('livingRoom', [aiSofa()]);
    const scene = sceneOf(graph);
    const original = scene.nodes[nodeId] as PascalItemNode;
    const { node } = swapped(scene);
    const saved = apply(graph, commit(graph, withNode(scene, node), [nodeId]));
    expect(saved.furniture.find((f) => f.id === SOFA)?.model).toBeDefined();
    // Ctrl+Z: kho Pascal trả node về ảnh trước (asset + siêu dữ liệu + vị trí).
    const undone = apply(saved, commit(saved, withNode(scene, original), [nodeId])).furniture.find((f) => f.id === SOFA)!;
    expect(undone.model).toBeUndefined();
    expect(undone.boundingBox).toEqual(aiSofa().boundingBox);
  });

  it('T6: món sinh đổi mẫu → đồ thật + dressingOff; hoàn tác (qua derivedHistory) → đồ thật bị xoá, dressingOff trả lại', () => {
    let stored = denormalizeSpatial(normalizeSpatial(roomGraph('bedroom')));
    const history = createDerivedHistory();
    const idBook = new Map<string, string>();
    let baseScene = sceneOf(stored);
    recordDerived(history, baseScene, []);
    // Như bộ tự lưu (`commitOfScenes`): node khác mốc (kể cả node vắng) là "đã đổi".
    const save = (raw: PascalScene): void => {
      const { scene } = restoreDerived(history, raw, () => undefined);
      const ids = [...new Set([...Object.keys(scene.nodes), ...Object.keys(baseScene.nodes)])];
      const changed = ids.filter((id) => JSON.stringify(scene.nodes[id]) !== JSON.stringify(baseScene.nodes[id]));
      const result = createPascalEditCommand({ graph: normalizeSpatial(stored), scene, commit: { origin: 'local', changedNodeIds: changed }, actorId: 'U-1', idBook });
      if (!result.ok && result.error.code !== 'PASCAL_NO_CHANGE') throw new Error(result.error.reasons.join(' '));
      stored = apply(stored, result.ok ? (result.data.changes as readonly Change[]) : []);
      baseScene = sceneOf(stored);
      recordDerived(history, baseScene, []);
    };
    const loaded = baseScene;
    const bedId = `item_DRESS-bed-${ROOM}`;
    const bed = loaded.nodes[bedId] as PascalItemNode;
    expect(bed).toBeDefined();
    const pick = swapCandidates(bed as never, []).find((o) => !isCurrentModel(bed.asset as never, o));
    expect(pick, 'giường sinh có mẫu khác để đổi').toBeDefined();
    save(withNode(loaded, { ...bed, ...swapUpdateOf(bed as never, pick!, 3000) } as PascalItemNode));
    const realId = adoptedFurnitureIdOf(`DRESS-bed-${ROOM}`);
    expect(stored.furniture.map((f) => `${f.id}=${f.model?.id ?? ''}`)).toEqual([`${realId}=${pick!.id}${USER_SEEN_SUFFIX}`]);
    expect(stored.rooms[0]?.dressingOff).toEqual([`DRESS-bed-${ROOM}`]);
    save(loaded); // Ctrl+Z: editor trả ảnh chụp lúc nạp.
    expect(stored.furniture).toHaveLength(0);
    expect(stored.rooms[0]?.dressingOff ?? []).toEqual([]);
  });
});
