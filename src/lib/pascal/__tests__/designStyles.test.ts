/** AID-01 — concept AI → `SceneStyle` và đồ AI bổ sung (sinh ra, không lưu, bỏ món đè). */

import { describe, expect, it } from 'vitest';

import type { DesignAddition, DesignResult } from '@/api/schemas/designConcept';
import { SpatialGraphDocumentSchema } from '@/api/schemas/spatialGraph';
import type { SpatialGraph } from '@/domain/spatial/types';

import { fixtureF2 } from '../__fixtures__';
import { designAdditionsOf, sceneStyleFromConcept } from '../designStyles';
import { bodyOfPascalId, toPascalId } from '../ids';
import { isGeneratedNodeId } from '../sceneDressing';
import { SCENE_STYLES } from '../sceneStyles';
import { toPascalScene } from '../toPascal';
import { toSpatialGraph } from '../toSpatial';
import type { PascalNodeId } from '../types';

const result: DesignResult = {
  nameVi: 'Japandi cho căn này',
  summaryVi: 'Gỗ sáng, vải lanh.',
  baseStyle: 'toi-gian',
  wall: { interior: 'library:paint-cream' },
  floor: { wood: 'library:wood-oak', tile: 'library:tile-grey' },
  models: { sofa: 'sofa', armchair: 'no-such-model' },
  additions: [],
};

describe('sceneStyleFromConcept', () => {
  const base = SCENE_STYLES['toi-gian'];
  const style = sceneStyleFromConcept(result, base);

  it('sàn trộn lên base, sơn trong theo AI, mặt ngoài vắng = của base, nhãn = tên concept', () => {
    expect(style.floor).toEqual({ ...base.floor, wood: 'library:wood-oak', tile: 'library:tile-grey' });
    expect(style.wall).toEqual({ interior: 'library:paint-cream', exterior: base.wall.exterior });
    expect(style.label).toBe('Japandi cho căn này');
    expect(style.id).toBe('toi-gian');
    expect(style.lampColour).toBe(base.lampColour);
  });

  it('mẫu có trong danh mục đứng đầu prefer; mẫu lạ bỏ qua', () => {
    expect(style.prefer.sofa).toEqual(['sofa']);
    expect(style.prefer.armchair).toBe(base.prefer.armchair);
    expect(style.prefer.plant).toEqual(base.prefer.plant);
  });

  it('mặt ngoài AI có thì dùng', () => {
    const outside = sceneStyleFromConcept({ ...result, wall: { interior: 'library:a', exterior: 'library:b' } }, base);
    expect(outside.wall.exterior).toBe('library:b');
  });
});

const graph: SpatialGraph = SpatialGraphDocumentSchema.parse(fixtureF2().doc).graph;
const centreOf = (outline: readonly { x: number; y: number }[]) => ({
  x: outline.reduce((sum, p) => sum + p.x, 0) / outline.length,
  y: outline.reduce((sum, p) => sum + p.y, 0) / outline.length,
});

describe('đồ AI bổ sung', () => {
  const existing = graph.furniture[0];
  const room = graph.rooms.find((r) => !graph.furniture.some((f) => f.roomId === r.id)) ?? graph.rooms[0];
  if (existing === undefined || room === undefined) throw new Error('F2 phải có đồ và phòng');

  const free: DesignAddition = {
    levelId: room.levelId,
    roomId: room.id,
    kind: 'other',
    variant: 'plant',
    centre: centreOf(room.outline),
    widthMm: 300,
    depthMm: 300,
    rotationDeg: 0,
    modelId: 'indoor-plant',
  };
  const onExisting: DesignAddition = {
    ...free,
    levelId: existing.levelId,
    roomId: existing.roomId ?? room.id,
    centre: existing.centre,
    modelId: 'no-such-model',
  };

  /** Id theo nội dung: phòng + loại + tâm làm tròn 100 mm. */
  const aiIdOf = (a: DesignAddition): string =>
    `DRESS-ai-${a.roomId}-${a.variant ?? a.kind}-${Math.round(a.centre.x / 100)}_${Math.round(a.centre.y / 100)}`;

  it('id DRESS-ai theo nội dung, mẫu trong danh mục; món đè đồ có sẵn hoặc món AI trước bị bỏ', () => {
    const out = designAdditionsOf([free, free, onExisting], graph.furniture);

    expect(out.map((f) => f.id)).toEqual([aiIdOf(free)]);
    expect(out[0]?.model).toEqual({ id: 'indoor-plant', src: '/items/indoor-plant/model.glb' });
    expect(out[0]?.boundingBox.max.x).toBe(free.centre.x + 150);
  });

  it('id không phụ thuộc thứ tự: thêm/đổi chỗ món khác, món cũ giữ id (dressingOff không trỏ nhầm); khớp lược đồ', () => {
    const lamp: DesignAddition = { ...free, variant: 'floorLamp', centre: { x: free.centre.x + 900, y: free.centre.y } };
    const first = designAdditionsOf([free, lamp], []).map((f) => f.id);
    const second = designAdditionsOf([lamp, free], []).map((f) => f.id);

    expect([...second].sort()).toEqual([...first].sort());
    expect(designAdditionsOf([free, free], []).map((f) => f.id)).toEqual([aiIdOf(free)]);
    expect(designAdditionsOf([{ ...free, variant: 'rug' }, { ...free, variant: 'rug' }], []).map((f) => f.id)).toEqual([
      aiIdOf({ ...free, variant: 'rug' }),
      `${aiIdOf({ ...free, variant: 'rug' })}-2`,
    ]);
    for (const id of first) expect(id).toMatch(/^DRESS-[A-Za-z0-9_.:-]{1,160}$/);
  });

  it('thảm không chặn và không bị chặn', () => {
    const rug: DesignAddition = { ...onExisting, variant: 'rug' };
    expect(designAdditionsOf([rug], graph.furniture)).toHaveLength(1);
  });

  it('toPascalScene: món AI là node sinh ra (kể cả furnish off), không vào lượt lưu', () => {
    const scene = toPascalScene(graph, { additions: [free] }).scene;
    const ids = Object.keys(scene.nodes).filter((id) => bodyOfPascalId(id as PascalNodeId).startsWith('DRESS-ai-'));
    const id = toPascalId('item', aiIdOf(free));

    expect(ids).toEqual([id]);
    expect(isGeneratedNodeId(id)).toBe(true);
    expect(toSpatialGraph(scene).graph.furniture.some((f) => f.id.startsWith('DRESS-'))).toBe(false);
    expect(toPascalScene(graph).scene.nodes[id]).toBeUndefined();
  });

  it('thảm lạc ngoài phòng: thảm AI tâm ngoài phòng bị bỏ; thảm thật ngoài mọi phòng giữ node nhưng ẩn', () => {
    const rugIn: DesignAddition = { ...free, variant: 'rug', modelId: 'rectangular-carpet' };
    const rugOut: DesignAddition = { ...rugIn, centre: { x: -50_000, y: -50_000 } };
    const ai = toPascalScene(graph, { additions: [rugIn, rugOut] }).scene.nodes;
    expect(ai[toPascalId('item', aiIdOf(rugIn))]).toBeDefined();
    expect(ai[toPascalId('item', aiIdOf(rugOut))]).toBeUndefined();

    const noRoom: typeof existing = {
      ...existing,
      id: 'fur_stray_rug' as typeof existing.id,
      kind: 'other',
      heightMm: 10 as NonNullable<typeof existing.heightMm>,
      centre: { x: -50_000, y: -50_000 } as typeof existing.centre,
      boundingBox: { min: { x: -51_000, y: -50_700 }, max: { x: -49_000, y: -49_300 } } as typeof existing.boundingBox,
    };
    // Thảm không thuộc phòng nào (phòng khách chưa dò ra): không `roomId`.
    delete (noRoom as { roomId?: unknown }).roomId;
    const nodes = toPascalScene({ ...graph, furniture: [...graph.furniture, noRoom] }).scene.nodes;
    const node = nodes[toPascalId('item', 'fur_stray_rug')] as { visible?: boolean } | undefined;
    expect(node).toBeDefined();
    expect(node?.visible).toBe(false);
  });
});
