/**
 * W3b — đồ đạc giữ màu (khe), mẫu, độ cao và độ nâng sửa trong Pascal; đọc lại ra đúng
 * cảnh ấy, và cảnh không ai đụng thì không có lệnh nào.
 */

import { describe, expect, it } from 'vitest';

import { FurnitureSchema } from '@/api/schemas/spatial';
import { SpatialGraphDocumentSchema } from '@/api/schemas/spatialGraph';
import { normalizeSpatial } from '@/domain/spatial/normalize';
import type { Furniture, SpatialGraph } from '@/domain/spatial/types';

import { fixtureF2 } from '../__fixtures__';
import { createPascalEditCommand } from '../fromPascal';
import { registerServerLibrary } from '../furnitureCatalog';
import { toPascalScene } from '../toPascal';
import { adoptableRoomOf, toSpatialGraph } from '../toSpatial';
import type { PascalItemNode, PascalNode, PascalScene } from '../types';

/* F1-ext gốc không còn đồ tự bày (FE3D-FIX-004 C2: bàn ăn phòng khách chặn bộ bàn ăn trong bếp, đúng
   như nhà thật). F2 vẫn có giường + tủ đầu giường tự bày trong một phòng và đồ thật — đủ cho ca "nhận nuôi". */
const graph: SpatialGraph = SpatialGraphDocumentSchema.parse(fixtureF2().doc).graph;
const sceneOf = (of: SpatialGraph): PascalScene => toPascalScene(of, { furnish: 'on' }).scene;
const items = (of: PascalScene): PascalItemNode[] =>
  Object.values(of.nodes).filter((node): node is PascalItemNode => node.type === 'item');

// Món đồ thật có mô hình catalog (có khe phong cách để sơn đè).
const item = graph.furniture.find(
  (candidate) => Object.keys((sceneOf(graph).nodes[`item_${candidate.id}`] as PascalItemNode | undefined)?.slots ?? {}).length > 0,
) as Furniture;
const nodeId = `item_${item.id}`;
const GLASS = 'library:preset-glass';

const edit = (of: PascalScene, id: string, patch: (node: PascalItemNode) => Partial<PascalItemNode>): PascalScene => {
  const node = of.nodes[id] as PascalItemNode;

  return { ...of, nodes: { ...of.nodes, [id]: { ...node, ...patch(node) } as PascalNode } };
};

const commit = (of: SpatialGraph, scene: PascalScene, ...ids: string[]) =>
  createPascalEditCommand({
    graph: normalizeSpatial(of),
    scene,
    commit: { origin: 'local', changedNodeIds: ids },
    actorId: 'U-1',
  });

const afterOf = (result: ReturnType<typeof commit>): Furniture => {
  if (!result.ok) throw new Error(result.error.reasons.join(' '));
  expect(result.data.changes).toHaveLength(1);

  return result.data.changes[0]?.after as Furniture;
};

const withItem = (next: Furniture): SpatialGraph => ({
  ...graph,
  furniture: graph.furniture.map((candidate) => (candidate.id === next.id ? next : candidate)),
});

/** Lưu xong nạp lại: cảnh mới đọc ngược ra không có lệnh. */
const expectStable = (saved: Furniture): PascalScene => {
  const reloaded = sceneOf(withItem(saved));
  const again = commit(withItem(saved), reloaded, nodeId);

  expect(again.ok ? 'ok' : again.error.code).toBe('PASCAL_NO_CHANGE');

  return reloaded;
};

describe('W3b — đồ đạc giữ khe, mẫu, độ cao', () => {
  it('cảnh không đụng tới: không có lệnh', () => {
    const result = commit(graph, sceneOf(graph), ...items(sceneOf(graph)).map((node) => node.id));

    expect(result.ok ? 'ok' : result.error.code).toBe('PASCAL_NO_CHANGE');
  });

  it('sơn một khe: chỉ khe khác phong cách vào `slots`, nạp lại giữ màu', () => {
    const key = Object.keys((sceneOf(graph).nodes[nodeId] as PascalItemNode).slots ?? {})[0] as string;
    const after = afterOf(commit(graph, edit(sceneOf(graph), nodeId, (node) => ({ slots: { ...node.slots, [key]: GLASS } })), nodeId));

    expect(after.slots).toEqual({ [key]: GLASS });
    expect((expectStable(after).nodes[nodeId] as PascalItemNode).slots?.[key]).toBe(GLASS);
  });

  it('màu tự pha (scene.materials) chưa lưu được: không có lệnh', () => {
    const key = Object.keys((sceneOf(graph).nodes[nodeId] as PascalItemNode).slots ?? {})[0] as string;
    const result = commit(
      graph,
      edit(sceneOf(graph), nodeId, (node) => ({ slots: { ...node.slots, [key]: 'scene:mat_user_pink' } })),
      nodeId,
    );

    expect(result.ok ? 'ok' : result.error.code).toBe('PASCAL_NO_CHANGE');
  });

  it('thay mẫu `/items/…`: ghi `model`, nạp lại dùng đúng mẫu ấy; src lạ thì không lưu', () => {
    const model = { id: 'dining-chair', src: '/items/dining-chair/model.glb' };
    const after = afterOf(
      commit(graph, edit(sceneOf(graph), nodeId, (node) => ({ asset: { ...node.asset, ...model } })), nodeId),
    );

    expect(after.model).toEqual(model);
    expect((expectStable(after).nodes[nodeId] as PascalItemNode).asset).toMatchObject(model);

    const odd = commit(
      graph,
      edit(sceneOf(graph), nodeId, (node) => ({ asset: { ...node.asset, id: 'x', src: 'https://evil/x.glb' } })),
      nodeId,
    );

    expect(odd.ok ? 'ok' : odd.error.code).toBe('PASCAL_NO_CHANGE');
  });

  it('mẫu thư viện máy chủ: lưu đường `/items/<id>/…` thay URL ký, nạp lại tra URL ký mới', () => {
    const signed = 'https://minio.test/library/srv-sofa-l/model.glb?X-Sig=1';
    registerServerLibrary([{ id: 'srv-sofa-l', widthMm: 2600, heightMm: 590, depthMm: 2870, modelUrl: signed, attribution: 'a · CC-BY 4.0' }]);
    const after = afterOf(
      commit(graph, edit(sceneOf(graph), nodeId, (node) => ({ asset: { ...node.asset, id: 'srv-sofa-l', src: signed } })), nodeId),
    );

    expect(after.model).toEqual({ id: 'srv-sofa-l', src: '/items/srv-sofa-l/model.glb' });
    expect((expectStable(after).nodes[nodeId] as PascalItemNode).asset).toMatchObject({ id: 'srv-sofa-l', src: signed });
  });

  it('kéo cao (scale y) → `heightMm`, nâng (position y) → `liftMm`; nạp lại ổn định', () => {
    const node = sceneOf(graph).nodes[nodeId] as PascalItemNode;
    const after = afterOf(
      commit(
        graph,
        edit(sceneOf(graph), nodeId, (current) => ({
          scale: [1, 1.5, 1],
          position: [current.position[0], current.position[1] + 0.3, current.position[2]],
        })),
        nodeId,
      ),
    );

    // ±1 mm: chiều cao khớp mẫu (C1 khớp theo trục) và `dimensions` làm tròn ở hai chỗ khác nhau.
    expect(Math.abs((after.heightMm ?? 0) - Math.round(node.asset.dimensions[1] * 1.5 * 1000))).toBeLessThanOrEqual(1);
    expect(after.liftMm).toBe(Math.round((node.position[1] + 0.3) * 1000));
    expectStable(after);
  });

  it('kéo riêng bề rộng: ghi `heightMm` đang thấy, nạp lại giữ đúng chiều cao ấy', () => {
    const node = sceneOf(graph).nodes[nodeId] as PascalItemNode;
    const after = afterOf(
      commit(graph, edit(sceneOf(graph), nodeId, () => ({ scale: [1.6, node.scale[1], node.scale[2]] })), nodeId),
    );

    expect(Math.abs((after.heightMm ?? 0) - Math.round(node.asset.dimensions[1] * node.scale[1] * 1000))).toBeLessThanOrEqual(1);
    // Nạp lại đọc ngược ra không lệnh nào: chiều cao về đúng `heightMm` đã ghi, không đoán từ tỷ lệ rộng.
    expectStable(after);
  });

  it('kéo "Giữ tỉ lệ" (1902 → 2102): hộp bao về số nguyên mm, hợp `FurnitureSchema` (không khối lưu)', () => {
    const k = 2102 / 1902;
    const after = afterOf(
      commit(graph, edit(sceneOf(graph), nodeId, (node) => ({ scale: [node.scale[0] * k, node.scale[1] * k, node.scale[2] * k] })), nodeId),
    );
    const { min, max } = after.boundingBox;

    expect([min.x, min.y, max.x, max.y].every(Number.isInteger)).toBe(true);
    expect(FurnitureSchema.safeParse(after).success).toBe(true);
    expectStable(after);
  });

  it('xoay riêng một món bày biện sinh ra cũng nhận nuôi, mang `variant`/`heightMm` của nó', () => {
    const scene = sceneOf(graph);
    const dress = items(scene).find((node) => adoptableRoomOf(node) !== null) as PascalItemNode;
    const result = commit(
      graph,
      edit(scene, dress.id, (node) => ({ rotation: [0, node.rotation[1] + Math.PI / 2, 0] })),
      dress.id,
    );

    if (!result.ok) throw new Error(result.error.reasons.join(' '));

    const fields = dress.metadata?.appfront?.fields ?? {};
    const adopted = result.data.changes.filter((change) => change.kind === 'furniture').map((change) => change.after as Furniture);
    const same = adopted.find((candidate) => candidate.centre.x === Math.round(dress.position[0] * 1000));

    expect(adopted).toHaveLength(1);
    expect(adopted.every((candidate) => candidate.id.startsWith('F-'))).toBe(true);
    expect(same?.variant).toBe(fields['variant']);
    // Món nhận lưu cỡ NHÌN THẤY cả ba trục (REVIEW-4 #2): cao = cao mẫu đã khớp lúc dựng.
    expect(same?.heightMm).toBe(Math.round((fields['shownSizeM'] as number[])[1] as number * 1000));
  });
});

describe('Đổi mẫu — nạp lại vẫn khớp hộp bao theo thư mục của mẫu', () => {
  it('model /items/sofa/…: asset.scale vừa hộp bao, id/src giữ nguyên; lượt về giữ model', () => {
    const model = { id: 'x', src: '/items/sofa/model.glb' };
    const swapped = withItem({ ...item, model });
    const scene = sceneOf(swapped);
    const asset = (scene.nodes[nodeId] as PascalItemNode).asset;
    const widthM = (item.boundingBox.max.x - item.boundingBox.min.x) / 1000;
    const depthM = (item.boundingBox.max.y - item.boundingBox.min.y) / 1000;

    expect(asset).toMatchObject({ id: 'x', src: model.src, thumbnail: '/items/sofa/thumbnail.webp' });
    expect(asset.scale).toBeDefined();
    expect((asset.scale?.[0] ?? Infinity) * 2.06).toBeLessThanOrEqual(widthM + 1e-9);
    expect((asset.scale?.[2] ?? Infinity) * 1.01).toBeLessThanOrEqual(depthM + 1e-9);
    expect(toSpatialGraph(scene).graph.furniture.find((f) => f.id === item.id)?.model).toEqual(model);
    const again = commit(swapped, scene, nodeId);
    expect(again.ok ? 'ok' : again.error.code).toBe('PASCAL_NO_CHANGE');

    // Thư mục không có trong catalog: không khớp (như trước).
    expect((sceneOf(withItem({ ...item, model: { id: 'y', src: '/items/nope/model.glb' } })).nodes[nodeId] as PascalItemNode).asset.scale).toBeUndefined();
  });
});

describe('N1 — đồ thả lên mặt một món khác (Pascal gắn làm con của món ấy)', () => {
  it('giữ tâm thế giới và độ nâng, không ghi lần xoá nào', () => {
    const scene = sceneOf(graph);
    const real = items(scene).filter((node) => node.id.startsWith('item_F-'));
    const host = real[0] as PascalItemNode;
    const guest = real.find((node) => node.parentId === host.parentId && node.id !== host.id) as PascalItemNode;
    const level = scene.nodes[host.parentId ?? ''] as PascalNode & { readonly children: readonly string[] };
    const yaw = host.rotation[1];
    const local = [0.1, 0.75, 0.2] as const;
    const nodes: Record<string, PascalNode> = {
      ...scene.nodes,
      [level.id]: { ...level, children: level.children.filter((id) => id !== guest.id) } as PascalNode,
      [host.id]: { ...host, children: [guest.id] } as PascalNode,
      [guest.id]: { ...guest, parentId: host.id, position: [...local], rotation: [0, 0.3, 0] },
    };
    const result = commit(graph, { ...scene, nodes }, guest.id, host.id, level.id);

    if (!result.ok) throw new Error(result.error.reasons.join(' '));

    expect(result.data.changes.some((change) => change.after === null)).toBe(false);

    const after = result.data.changes.find((change) => change.after?.id === guest.id.slice('item_'.length))?.after as Furniture;

    expect(after.centre.x).toBeCloseTo((host.position[0] + local[0] * Math.cos(yaw) + local[2] * Math.sin(yaw)) * 1000, 0);
    expect(after.centre.y).toBeCloseTo((host.position[2] - local[0] * Math.sin(yaw) + local[2] * Math.cos(yaw)) * 1000, 0);
    expect(after.liftMm).toBe(Math.round((host.position[1] + local[1]) * 1000));
  });
});
