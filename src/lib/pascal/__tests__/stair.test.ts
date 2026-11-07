/**
 * Đồ đạc `stair` thành thang Pascal thật (U13): một `stair` + một `stair-segment`,
 * thân thang phủ đúng hộp bao, và đi về ra đúng món đồ cũ.
 */

import { describe, expect, it } from 'vitest';

import { SpatialGraphDocumentSchema } from '@/api/schemas/spatialGraph';
import { createSampleBuilding } from '@/domain/spatial/__fixtures__/sampleBuilding';
import { normalizeSpatial } from '@/domain/spatial/normalize';
import type { Furniture, SpatialGraph } from '@/domain/spatial/types';

import { fixtureF2 } from '../__fixtures__';
import { diffScenes } from '../diff';
import { createPascalEditCommand } from '../fromPascal';
import { createChangeGate } from '../guard';
import { toPascalScene } from '../toPascal';
import { toSpatialGraph } from '../toSpatial';
import type { PascalNode, PascalScene } from '../types';

const graphOf = (doc: unknown): SpatialGraph => SpatialGraphDocumentSchema.parse(doc).graph as SpatialGraph;

/** Phần món đồ mà lượt đi mang sang. */
const core = (f: Furniture) => ({
  id: f.id,
  levelId: f.levelId,
  kind: f.kind,
  centre: f.centre,
  boundingBox: f.boundingBox,
  rotationDeg: f.rotationDeg,
  roomId: f.roomId,
});

/** Mẫu chuẩn với món đồ đầu tiên đổi thành thang (hộp bao + góc tuỳ chọn). */
const sampleWithStair = (patch: Partial<Furniture> = {}): { graph: SpatialGraph; stair: Furniture } => {
  const graph = createSampleBuilding();
  const first = graph.furniture[0];
  if (first === undefined) throw new Error('mẫu chuẩn phải có đồ đạc');
  const stair: Furniture = { ...first, kind: 'stair', ...patch };
  graph.furniture = [stair, ...graph.furniture.slice(1)];
  return { graph, stair };
};

/** Bốn góc thân thang (mặt bằng, mm) tính từ node như bộ vẽ Pascal dựng. */
const flightCorners = (scene: PascalScene, id: string): { x: number; y: number }[] => {
  const stair = scene.nodes[`stair_${id}`];
  const segment = scene.nodes[`sseg_${id}`];
  if (stair?.type !== 'stair' || segment?.type !== 'stair-segment') throw new Error('thiếu thang');
  const [px, , pz] = stair.position;
  const r = stair.rotation;
  // Đoạn thang: x ∈ [−w/2, w/2], z ∈ [0, L] cục bộ; xoay quanh y như three.js.
  return [
    [-segment.width / 2, 0],
    [segment.width / 2, 0],
    [segment.width / 2, segment.length],
    [-segment.width / 2, segment.length],
  ].map(([x = 0, z = 0]) => ({
    x: Math.round((px + x * Math.cos(r) + z * Math.sin(r)) * 1000),
    y: Math.round((pz - x * Math.sin(r) + z * Math.cos(r)) * 1000),
  }));
};

/** Bốn góc hộp bao K1 (cục bộ, quay `rotationDeg` quanh tâm — cùng quy ước yaw = −rotationDeg). */
const boxCorners = (f: Furniture): { x: number; y: number }[] => {
  const yaw = -(f.rotationDeg * Math.PI) / 180;
  const hx = (f.boundingBox.max.x - f.boundingBox.min.x) / 2;
  const hy = (f.boundingBox.max.y - f.boundingBox.min.y) / 2;
  return [
    [-hx, -hy],
    [hx, -hy],
    [hx, hy],
    [-hx, hy],
  ].map(([x = 0, y = 0]) => ({
    x: Math.round(f.centre.x + x * Math.cos(yaw) + y * Math.sin(yaw)),
    y: Math.round(f.centre.y - x * Math.sin(yaw) + y * Math.cos(yaw)),
  }));
};

const sortPts = (pts: { x: number; y: number }[]) =>
  [...pts].sort((a, b) => a.x - b.x || a.y - b.y);

describe('thang Pascal thật', () => {
  it('lan can: hẹp → bên phải, rộng ≥ 1,2 m → hai bên (V5 D12)', () => {
    const railOf = (shortMm: number) => {
      const { graph, stair } = sampleWithStair({
        boundingBox: { min: { x: -shortMm / 2, y: -1500 }, max: { x: shortMm / 2, y: 1500 } } as Furniture['boundingBox'],
      });
      const node = toPascalScene(graph).scene.nodes[`stair_${stair.id}`];
      return node?.type === 'stair' ? node.railingMode : undefined;
    };
    expect(railOf(900)).toBe('right');
    expect(railOf(1200)).toBe('both');
  });

  it('một stair + một stair-segment, đủ trường lược đồ, không còn item giữ chỗ', () => {
    const { graph, stair } = sampleWithStair();
    const { scene } = toPascalScene(graph);
    const node = scene.nodes[`stair_${stair.id}`];
    const segment = scene.nodes[`sseg_${stair.id}`];
    const level = graph.levels.find((l) => l.id === stair.levelId);

    expect(scene.nodes[`item_${stair.id}`]).toBeUndefined();
    expect(node?.type).toBe('stair');
    expect(segment?.type).toBe('stair-segment');
    if (node?.type !== 'stair' || segment?.type !== 'stair-segment' || level === undefined) return;
    const rise = level.heightMm / 1000;
    expect(node.children).toEqual([segment.id]);
    expect(segment.parentId).toBe(node.id);
    expect(node.fromLevelId).toBe(node.parentId);
    expect(node.toLevelId).toBeNull();
    expect(node.totalRise).toBe(rise);
    expect(node.stepCount).toBe(Math.max(3, Math.round(rise / 0.175)));
    expect(node.railingMode).toBe(node.width >= 1.2 ? 'both' : 'right');
    expect(node.fillToFloor).toBe(true);
    expect(node.thickness).toBe(0.25);
    expect(node.treadMaterialPreset.startsWith('library:')).toBe(true);
    // Không bao giờ chìm dưới sàn (V5 D12): gốc thang ở cao độ sàn tầng, đoạn thang ở gốc, thành trát vữa.
    expect(node.position[1]).toBe(0);
    expect(segment.position).toEqual([0, 0, 0]);
    expect(segment.fillToFloor).toBe(true);
    expect(node.sideMaterialPreset).toBe('library:concrete-plaster');
    expect(segment.height).toBe(rise);
    expect(segment.stepCount).toBe(node.stepCount);
    expect(segment.width).toBe(node.width);
    expect(segment.width).toBeLessThanOrEqual(segment.length);
  });

  it.each([
    ['dài theo y, không quay', { x: 1000, y: 3000 }, 0],
    ['dài theo x, không quay', { x: 3000, y: 1000 }, 0],
    ['dài theo x, quay 30°', { x: 2800, y: 900 }, 30],
    ['dài theo y, quay 135°', { x: 1100, y: 3200 }, 135],
  ])('thân thang phủ đúng hộp bao — %s', (_label, size, rotationDeg) => {
    const c = sampleWithStair().stair.centre;
    const { graph: g, stair } = sampleWithStair({
      rotationDeg,
      boundingBox: {
        min: { x: c.x - size.x / 2, y: c.y - size.y / 2 },
        max: { x: c.x + size.x / 2, y: c.y + size.y / 2 },
      },
    });
    const { scene } = toPascalScene(g);
    const flight = sortPts(flightCorners(scene, stair.id));
    const box = sortPts(boxCorners(stair));
    flight.forEach((p, i) => {
      expect(Math.abs(p.x - (box[i]?.x ?? NaN))).toBeLessThanOrEqual(1);
      expect(Math.abs(p.y - (box[i]?.y ?? NaN))).toBeLessThanOrEqual(1);
    });

    const back = toSpatialGraph(scene).graph.furniture.find((f) => f.id === stair.id);
    expect(back && core(back)).toEqual(core(stair));
  });

  it('F2: thang đi về ra đúng món đồ, đoạn thang không thành đối tượng riêng', () => {
    const graph = graphOf(fixtureF2().doc);
    const stairs = graph.furniture.filter((f) => f.kind === 'stair');
    expect(stairs.length).toBeGreaterThan(0);
    const back = toSpatialGraph(toPascalScene(graph).scene);
    expect(back.skipped.filter((s) => s.id.startsWith('sseg_') || s.id.startsWith('stair_'))).toEqual([]);
    expect(back.graph.furniture).toHaveLength(graph.furniture.length);
    for (const stair of stairs) {
      const found = back.graph.furniture.find((f) => f.id === stair.id);
      expect(found && core(found)).toEqual(core(stair));
    }
  });

  it('sửa vị trí thang trong Pascal dời món đồ; xoá thang xoá món đồ', () => {
    const { graph, stair } = sampleWithStair();
    const scene = toPascalScene(graph).scene;
    const id = `stair_${stair.id}`;
    const node = scene.nodes[id];
    if (node?.type !== 'stair') throw new Error('thiếu thang');

    const moved: PascalNode = { ...node, position: [node.position[0] + 1, 0, node.position[2]] };
    const edit = createPascalEditCommand({
      graph: normalizeSpatial(graph),
      scene: { ...scene, nodes: { ...scene.nodes, [id]: moved } },
      commit: { origin: 'local', changedNodeIds: [id] },
      actorId: 'U-1',
    });
    expect(edit.ok).toBe(true);
    const after = edit.ok ? edit.data.changes[0]?.after : null;
    expect(after && 'centre' in after ? after.centre : null).toEqual({ x: stair.centre.x + 1000, y: stair.centre.y });

    const nodes: Record<string, PascalNode> = { ...scene.nodes };
    delete nodes[id];
    delete nodes[`sseg_${stair.id}`];
    const level = nodes[node.parentId ?? ''];
    if (level?.type === 'level') nodes[level.id] = { ...level, children: level.children.filter((c) => c !== id) };
    const removal = createPascalEditCommand({
      graph: normalizeSpatial(graph),
      scene: { ...scene, nodes },
      commit: { origin: 'local', changedNodeIds: [id, `sseg_${stair.id}`] },
      actorId: 'U-1',
    });
    expect(removal.ok).toBe(true);
    expect(removal.ok ? removal.data.changes : []).toHaveLength(1);
    expect(removal.ok ? removal.data.changes[0]?.after : undefined).toBeNull();
  });

  it('chốt chặn xoá hàng loạt đếm thang MỘT lần (đoạn thang không tính)', () => {
    const { graph, stair } = sampleWithStair();
    const full = toPascalScene(graph).scene;
    const id = `stair_${stair.id}`;
    const node = full.nodes[id];
    const level = full.nodes[node?.parentId ?? ''];
    const segment = full.nodes[`sseg_${stair.id}`];
    if (node === undefined || segment === undefined || level?.type !== 'level') throw new Error('thiếu thang');
    // Tầng có thang + 4 món khác: 5 đối tượng. Xoá thang (kéo đoạn thang theo) = 1/5.
    const scene: PascalScene = {
      rootNodeIds: [level.id],
      nodes: {
        [level.id]: { ...level, children: [id, 'item_A', 'item_B', 'item_C', 'item_D'] },
        [id]: node,
        [segment.id]: segment,
      },
    };
    const gate = createChangeGate();
    gate.beginLoad();
    gate.acknowledgeLoad();
    const removed = [id, segment.id];
    const verdict = gate.admit({ origin: 'local', changedNodeIds: removed, removedNodeIds: removed }, scene);
    expect(verdict.admitted ? '' : verdict.reason).toContain('1 trong 5');
  });

  it('diff dựng thang trước đoạn thang; cảnh xác định (hai lượt giống hệt)', () => {
    const { graph } = sampleWithStair();
    const empty: PascalScene = { nodes: {}, rootNodeIds: [] };
    const scene = toPascalScene(graph).scene;
    const order = diffScenes(empty, scene).upsert.map((n) => n.type);
    expect(order.indexOf('stair')).toBeLessThan(order.indexOf('stair-segment'));
    expect(toPascalScene(sampleWithStair().graph).scene).toEqual(scene);
  });

  describe('M1 H3.4 — variant của thang', () => {
    const backOf = (scene: PascalScene, id: string) => toSpatialGraph(scene).graph.furniture.find((f) => f.id === id);
    const withStairType = (scene: PascalScene, id: string, stairType: string): PascalScene => ({
      ...scene,
      nodes: { ...scene.nodes, [`stair_${id}`]: { ...scene.nodes[`stair_${id}`], stairType } as unknown as PascalNode },
    });

    it('thang đã lưu chưa có variant: không tự gán (BE vẫn báo chưa xác định kiểu)', () => {
      const { graph, stair } = sampleWithStair();
      expect(backOf(toPascalScene(graph).scene, stair.id)?.variant).toBeUndefined();
    });

    it('thang vẽ mới trong Pascal (id chưa có ở AppFront): ghi "straight"', () => {
      const { graph, stair } = sampleWithStair();
      const { scene } = toPascalScene(graph);
      const node = scene.nodes[`stair_${stair.id}`] as PascalNode;
      const fresh = 'stair_pascal-new';
      const nodes: Record<string, PascalNode> = { ...scene.nodes, [fresh]: { ...node, id: fresh, metadata: {} } as PascalNode };
      delete nodes[`stair_${stair.id}`];
      const level = nodes[node.parentId ?? ''];
      if (level?.type !== 'level') throw new Error('thiếu tầng');
      nodes[level.id] = { ...level, children: level.children.map((id) => (id === node.id ? fresh : id)) };
      const added = toSpatialGraph({ ...scene, nodes }).graph.furniture.filter((f) => f.kind === 'stair');
      expect(added.map((f) => f.variant)).toEqual(['straight']);
    });

    it('variant đã lưu giữ nguyên qua toPascal → toSpatial (toPascal luôn dựng straight)', () => {
      const { graph, stair } = sampleWithStair({ variant: 'spiral' });
      const { scene } = toPascalScene(graph);
      const node = scene.nodes[`stair_${stair.id}`];
      expect(node?.type === 'stair' && node.stairType).toBe('straight');
      expect(backOf(scene, stair.id)?.variant).toBe('spiral');
    });

    it('người dùng đổi kiểu trong Pascal: ghi tên kiểu mới (curved/spiral)', () => {
      const { graph, stair } = sampleWithStair({ variant: 'straight' });
      const scene = withStairType(toPascalScene(graph).scene, stair.id, 'curved');
      expect(backOf(scene, stair.id)?.variant).toBe('curved');
    });

    it('chiều đi lên: chân thang ở mép âm, đi theo +y cục bộ xoay rotationDeg (θ = 90° → −x)', () => {
      const { graph, stair } = sampleWithStair({
        centre: { x: 5000, y: 5000 },
        boundingBox: { min: { x: 4500, y: 3500 }, max: { x: 5500, y: 6500 } },
        rotationDeg: 90,
      });
      const node = toPascalScene(graph).scene.nodes[`stair_${stair.id}`];
      if (node?.type !== 'stair') throw new Error('thiếu thang');
      // Chân thang (position) = centre − nửa thân theo hướng đi lên (−sin90°, cos90°) = (−1, 0) → x = 5000 + 1500.
      expect(Math.round(node.position[0] * 1000)).toBe(6500);
      expect(Math.round(node.position[2] * 1000)).toBe(5000);
    });
  });
});
