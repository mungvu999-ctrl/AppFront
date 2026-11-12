/**
 * Trạng thái duyệt đi sang Pascal chỉ trong `metadata.appfront` (Pascal gốc không
 * có trường `review` hạng nhất); cộng bề rộng bao nội thất khi người dùng kéo
 * `scale` trong Pascal (#21) — tay cầm kéo ghi vào `scale`, lượt về phải đọc nó.
 */

import { describe, expect, it } from 'vitest';

import { createSampleBuilding } from '@/domain/spatial/__fixtures__/sampleBuilding';
import type { Furniture } from '@/domain/spatial/types';

import { isGeneratedLightId } from '../sceneDressing';
import { toPascalScene } from '../toPascal';
import { toSpatialGraph } from '../toSpatial';
import type { PascalItemNode, PascalNode, PascalScene } from '../types';

const sceneOf = (): PascalScene => toPascalScene(createSampleBuilding()).scene;

const firstOfType = <T extends PascalNode['type']>(
  scene: PascalScene,
  type: T,
): Extract<PascalNode, { type: T }> => {
  const found = Object.values(scene.nodes).find((node) => node.type === type && !isGeneratedLightId(node.id));

  if (found === undefined) throw new Error(`Cảnh mẫu không có node loại "${type}".`);

  return found as Extract<PascalNode, { type: T }>;
};

/** Thay một node trong cảnh, giữ nguyên phần còn lại. */
const withNode = (scene: PascalScene, node: PascalNode): PascalScene => ({
  ...scene,
  nodes: { ...scene.nodes, [node.id]: node },
});

/**
 * Thêm một node **mới** vào cảnh, có nối vào `children` của cha.
 *
 * Lượt về đi theo `children`, không quét bảng `nodes`, nên một node chỉ gắn
 * vào bảng mà không gắn vào cha thì không bao giờ được ghé qua.
 */
const withAddedNode = (scene: PascalScene, node: PascalNode): PascalScene => {
  const parentId = node.parentId;

  if (parentId === null) throw new Error('Node thêm vào phải có cha.');

  const parent = scene.nodes[parentId];

  if (parent === undefined || !('children' in parent)) {
    throw new Error(`Cha "${parentId}" không nhận con.`);
  }

  return {
    ...scene,
    nodes: {
      ...scene.nodes,
      [node.id]: node,
      [parentId]: { ...parent, children: [...parent.children, node.id] },
    },
  };
};

describe('trạng thái duyệt chỉ đi qua `metadata.appfront`', () => {
  it('không node nào mang trường `review` lạ — Pascal gốc bỏ khoá không khai', () => {
    for (const node of Object.values(sceneOf().nodes)) {
      expect('review' in node, node.id).toBe(false);
    }
  });

  it('`metadata.appfront` mang đủ ba trường duyệt', () => {
    const owned = Object.values(sceneOf().nodes).filter((node) => node.metadata?.appfront !== undefined);

    expect(owned.length).toBeGreaterThan(0);
    for (const node of owned) {
      const origin = node.metadata?.appfront;
      expect(typeof origin?.reviewed, node.id).toBe('boolean');
      expect(typeof origin?.confidence, node.id).toBe('number');
      expect(origin?.source === 'ai' || origin?.source === 'human', node.id).toBe(true);
    }
  });

  it('lượt về đọc `reviewed` từ `metadata.appfront`', () => {
    const scene = sceneOf();
    const zone = firstOfType(scene, 'zone');
    const origin = zone.metadata?.appfront;

    if (origin === undefined) throw new Error('Vùng mẫu thiếu `metadata.appfront`.');

    const roomOf = (reviewed: boolean) =>
      toSpatialGraph(withNode(scene, { ...zone, metadata: { appfront: { ...origin, reviewed } } })).graph.rooms.find(
        (room) => room.id === zone.id.slice(5),
      );

    expect(roomOf(false)?.reviewed).toBe(false);
    expect(roomOf(true)?.reviewed).toBe(true);
  });

  it('node Pascal tự đẻ (id nanoid) không mang được dấu duyệt về', () => {
    const scene = sceneOf();
    const zone = firstOfType(scene, 'zone');
    const origin = zone.metadata?.appfront;

    if (origin === undefined) throw new Error('Vùng mẫu thiếu `metadata.appfront`.');

    const foreign = withAddedNode(scene, {
      ...zone,
      id: 'zone_x7h2k9qp',
      name: 'Phòng Pascal vừa vẽ',
      metadata: { appfront: { ...origin, reviewed: true, source: 'human' } },
    });

    const minted = toSpatialGraph(foreign).graph.rooms.find((room) => room.name === 'Phòng Pascal vừa vẽ');

    expect(minted).toBeDefined();
    expect(minted?.reviewed).toBe(false);
  });
});

describe('bề rộng bao nội thất theo `scale` (#21)', () => {
  // Vòng 17: món dựng CỠ THẬT (`realFit`) lưu theo cỡ NHÌN THẤY × scale (realFit17.test.ts) — #21 kiểm phép đọc `scale`
  // chung nên lấy món khớp hộp thường.
  const firstItem = (scene: PascalScene): PascalItemNode =>
    (Object.values(scene.nodes).find(
      (n) => n.type === 'item' && !isGeneratedLightId(n.id) && n.metadata?.appfront?.fields?.['realFit'] === undefined,
    ) as PascalItemNode | undefined) ?? firstOfType(scene, 'item');
  const widthOf = (furniture: Furniture): number =>
    furniture.boundingBox.max.x - furniture.boundingBox.min.x;
  const depthOf = (furniture: Furniture): number =>
    furniture.boundingBox.max.y - furniture.boundingBox.min.y;

  const itemBack = (scene: PascalScene, item: PascalItemNode): Furniture => {
    const found = toSpatialGraph(withNode(scene, item)).graph.furniture.find(
      (entry) => entry.id === item.id.slice(5),
    );

    if (found === undefined) throw new Error('Món đồ không về được.');

    return found;
  };

  it('tỉ lệ 1 giữ nguyên đúng số mm đã lưu, không qua mét rồi về', () => {
    const scene = sceneOf();
    const item = firstItem(scene);
    const stored = item.metadata?.appfront?.fields?.['boundingBox'] as Furniture['boundingBox'];

    expect(itemBack(scene, item).boundingBox).toEqual(stored);
  });

  it('kéo rộng gấp đôi thì bề rộng về gấp đôi, chiều sâu không đổi', () => {
    const scene = sceneOf();
    const item = firstItem(scene);
    const before = itemBack(scene, item);

    const wider = itemBack(scene, { ...item, scale: [2, 1, 1] });

    expect(widthOf(wider)).toBeCloseTo(widthOf(before) * 2, 6);
    expect(depthOf(wider)).toBeCloseTo(depthOf(before), 6);
  });

  it('kéo sâu gấp rưỡi thì chiều sâu về gấp rưỡi', () => {
    const scene = sceneOf();
    const item = firstItem(scene);
    const before = itemBack(scene, item);

    const deeper = itemBack(scene, { ...item, scale: [1, 1, 1.5] });

    expect(depthOf(deeper)).toBeCloseTo(depthOf(before) * 1.5, 6);
    expect(widthOf(deeper)).toBeCloseTo(widthOf(before), 6);
  });

  it('kéo vẫn giữ tâm món đồ tại chỗ', () => {
    const scene = sceneOf();
    const item = firstItem(scene);
    const before = itemBack(scene, item);
    const scaled = itemBack(scene, { ...item, scale: [2, 1, 2] });

    const centreOf = (furniture: Furniture) => ({
      x: (furniture.boundingBox.min.x + furniture.boundingBox.max.x) / 2,
      y: (furniture.boundingBox.min.y + furniture.boundingBox.max.y) / 2,
    });

    expect(centreOf(scaled).x).toBeCloseTo(centreOf(before).x, 6);
    expect(centreOf(scaled).y).toBeCloseTo(centreOf(before).y, 6);
  });

  it('món đồ Pascal vừa đặt (chưa có hộp đã lưu) lấy `dimensions × scale`', () => {
    const scene = sceneOf();
    const item = firstItem(scene);
    const fresh: PascalItemNode = {
      ...item,
      id: 'item_m3k8d1pq',
      position: [0, 0, 0],
      scale: [2, 1, 1],
      metadata: {},
    };

    const back = toSpatialGraph(withAddedNode(scene, fresh)).graph.furniture.find(
      (entry) => entry.centre.x === 0 && entry.centre.y === 0,
    );

    expect(back).toBeDefined();
    expect(widthOf(back!)).toBeCloseTo(item.asset.dimensions[0] * 2 * 1000, 6);
    expect(depthOf(back!)).toBeCloseTo(item.asset.dimensions[2] * 1000, 6);
  });
});
