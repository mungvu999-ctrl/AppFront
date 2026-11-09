/**
 * Lớp cảnh dẫn xuất v1 (`sceneLayer.ts`): provenance, id ổn định, không nhân đôi sau khi nhận, `dressingOff` tự dọn.
 */

import { describe, expect, it } from 'vitest';

import { RoomSchema } from '@/api/schemas/spatial';
import { SpatialGraphDocumentSchema } from '@/api/schemas/spatialGraph';
import { normalizeSpatial } from '@/domain/spatial/normalize';
import type { Furniture, Room, SpatialGraph } from '@/domain/spatial/types';

import { fixtureF2 } from '../__fixtures__';
import { createPascalEditCommand } from '../fromPascal';
import { bodyOfPascalId, toPascalId } from '../ids';
import { dressNodeIdOf, lightOffIdOf } from '../sceneDressing';
import { DRESSING_OFF_MAX, PROV_FIELD, REPAIR_FIELD, SCENE_LAYER_VERSION, type SceneProvenance, type SceneRepair } from '../sceneLayer';
import { standardSceneOf, toPascalScene } from '../toPascal';
import { adoptableRoomOf, toSpatialGraph } from '../toSpatial';
import type { PascalItemNode, PascalNode, PascalScene } from '../types';

const graph: SpatialGraph = SpatialGraphDocumentSchema.parse(fixtureF2().doc).graph;
const scene = toPascalScene(graph, { furnish: 'on' }).scene;
const items = (of: PascalScene): PascalItemNode[] =>
  Object.values(of.nodes).filter((node): node is PascalItemNode => node.type === 'item');
const generatedIds = (of: PascalScene): string[] =>
  items(of)
    .map((node) => bodyOfPascalId(node.id))
    .filter((id) => id.startsWith('DRESS-') || id.startsWith('LIGHT-'))
    .sort();
const inRoom = (of: PascalScene, roomId: string): PascalItemNode[] =>
  items(of).filter((node) => node.metadata?.appfront?.fields?.['roomId'] === roomId);

/* Phòng ngủ có giường + tủ đầu giường tự bày, đèn bàn sinh trên tủ đầu giường sinh (host là một id `DRESS-`). */
const lamp = items(scene).find((node) => /^item_DRESS-tableLamp-DRESS-nightstand-/.test(node.id));
if (lamp === undefined) throw new Error('F2 phải có đèn bàn trên tủ đầu giường tự bày');
const bedroomId = adoptableRoomOf(lamp) as string;

/** Người dùng dời một món tự bày của phòng ngủ → cả phòng thành đồ thật (V4); trả về đồ thị sau khi lưu. */
const adoptBedroom = (): SpatialGraph => {
  const target = items(scene).find((node) => adoptableRoomOf(node) === bedroomId && node.id.includes('-bed-')) as PascalItemNode;
  const moved: PascalNode = { ...target, position: [target.position[0] + 0.1, target.position[1], target.position[2]] };
  const result = createPascalEditCommand({
    graph: normalizeSpatial(graph),
    scene: { ...scene, nodes: { ...scene.nodes, [moved.id]: moved } },
    commit: { origin: 'local', changedNodeIds: [moved.id] },
    actorId: 'U-1',
  });
  if (!result.ok) throw new Error(result.error.reasons.join(' '));
  const after = result.data.changes.map((change) => change.after);
  const rooms = new Map(after.filter((e): e is Room => e !== null && 'outline' in e).map((r) => [r.id, r]));
  return {
    ...graph,
    rooms: graph.rooms.map((room) => rooms.get(room.id) ?? room),
    furniture: [...graph.furniture, ...after.filter((e): e is Furniture => e !== null && 'boundingBox' in e)],
  };
};

describe('lớp cảnh v1 — không nhân đôi sau khi nhận cả phòng', () => {
  it('nạp lại sau khi nhận phòng ngủ: không còn món sinh nào trong phòng, số món giữ nguyên', () => {
    const saved = adoptBedroom();
    const reloaded = toPascalScene(saved, { furnish: 'on' }).scene;
    const dressedIn = (of: PascalScene) => inRoom(of, bedroomId).filter((node) => bodyOfPascalId(node.id).startsWith('DRESS-'));

    expect(dressedIn(reloaded).map((node) => node.id)).toEqual([]);
    expect(inRoom(reloaded, bedroomId)).toHaveLength(inRoom(scene, bedroomId).length);
  });

  it('tải lại hai lần: cùng tập id sinh', () => {
    expect(generatedIds(toPascalScene(graph, { furnish: 'on' }).scene)).toEqual(generatedIds(scene));
    const saved = adoptBedroom();
    const once = generatedIds(toPascalScene(saved, { furnish: 'on' }).scene);
    expect(generatedIds(toPascalScene(saved, { furnish: 'on' }).scene)).toEqual(once);
  });
});

const provOf = (node: PascalNode | undefined): SceneProvenance | undefined =>
  node?.metadata?.appfront?.fields?.[PROV_FIELD] as SceneProvenance | undefined;

describe('lớp cảnh v1 — provenance + tóm tắt', () => {
  it('mọi node sinh mang prov (cls, rule, version); tóm tắt đếm đúng theo rule', () => {
    const { scene: s, layer } = toPascalScene(graph, { furnish: 'on' });
    const generated = items(s).filter((node) => node.metadata?.['generated'] !== undefined);

    expect(generated.length).toBeGreaterThan(10);
    for (const node of generated) expect(provOf(node), node.id).toMatchObject({ cls: 'generated', version: SCENE_LAYER_VERSION });
    expect(provOf(s.nodes[lamp.id])).toMatchObject({ rule: 'dress:tableLamp', hostId: expect.stringMatching(/^DRESS-nightstand-/) as unknown });
    expect(provOf(s.nodes[toPascalId('item', `DRESS-bed-${bedroomId}`)])).toMatchObject({ rule: 'furnish:bed', hostId: bedroomId });
    expect(provOf(s.nodes[dressNodeIdOf(lightOffIdOf(bedroomId))])).toMatchObject({ rule: 'light:ceiling', hostId: bedroomId });
    const total = Object.values(layer.generatedByRule).reduce((sum, n) => sum + n, 0);
    expect(total).toBe(Object.values(s.nodes).filter((node) => provOf(node) !== undefined).length);
    expect(layer).toMatchObject({ version: SCENE_LAYER_VERSION, repairs: 0 });
  });

  it('repairs: chỉ ghi lên node đồ tương ứng, không dời gì', () => {
    const real = graph.furniture.find((f) => f.kind !== 'stair') as Furniture;
    const repair: SceneRepair = { furnitureId: real.id, action: 'hidden', rule: 'outsideRoom', reasonVi: 'Ngoài mọi phòng.', before: real };
    const base = toPascalScene(graph).scene.nodes[toPascalId('item', real.id)] as PascalItemNode;
    const { scene: s, layer } = toPascalScene(graph, { repairs: new Map([[real.id, repair]]) });
    const node = s.nodes[toPascalId('item', real.id)] as PascalItemNode;

    expect(node.metadata?.appfront?.fields?.[REPAIR_FIELD]).toEqual(repair);
    expect(node.position).toEqual(base.position);
    expect(layer.repairs).toBe(1);
  });

  it('standardSceneOf = cùng luật với editor3d khi chưa có concept (tự bày bật)', () => {
    expect(generatedIds(standardSceneOf(graph).scene)).toEqual(generatedIds(scene));
  });
});

describe('lớp cảnh v1 — dressingOff tự dọn', () => {
  const withOff = (dressingOff: string[]): SpatialGraph => ({
    ...graph,
    rooms: graph.rooms.map((room) => (room.id === bedroomId ? { ...room, dressingOff } : room)),
  });
  const zoneOff = (of: PascalScene): unknown => of.nodes[toPascalId('zone', bedroomId)]?.metadata?.appfront?.fields?.['dressingOff'];
  const savedOff = (of: PascalScene): readonly string[] | undefined =>
    toSpatialGraph(of).graph.rooms.find((room) => room.id === bedroomId)?.dressingOff;
  const live = `DRESS-bed-${bedroomId}`;
  const stale = ['DRESS-tableLamp-F-gone', lightOffIdOf('R-gone')];

  it('id không còn sinh (gốc đã mất) bị bỏ khi ghi về; id còn sinh giữ', () => {
    const s = toPascalScene(withOff([...stale, live]), { furnish: 'on' }).scene;

    expect(zoneOff(s)).toEqual([live]);
    expect(savedOff(s)).toEqual([live]);
  });

  it('họ luật không chạy lượt này (tự bày tắt vì có concept) thì giữ; họ luôn chạy (đèn trần) vẫn dọn', () => {
    expect(zoneOff(toPascalScene(withOff([...stale, live])).scene)).toEqual(['DRESS-tableLamp-F-gone', live]);
  });

  it('giữ dưới trần lược đồ: tràn thì bỏ món cũ nhất, lượt lưu vẫn hợp lệ', () => {
    const old = Array.from({ length: DRESSING_OFF_MAX }, (_, n) => `DRESS-old-${n}`);
    const s = toPascalScene(withOff(old)).scene; // tự bày tắt: id lạ được giữ nguyên
    const lightId = dressNodeIdOf(lightOffIdOf(bedroomId));
    const ceiling = s.nodes[toPascalId('ceiling', bedroomId)] as PascalNode & { children: string[] };
    const removed: PascalScene = {
      ...s,
      nodes: {
        ...Object.fromEntries(Object.entries(s.nodes).filter(([id]) => id !== lightId)),
        [ceiling.id]: { ...ceiling, children: ceiling.children.filter((id) => id !== lightId) } as PascalNode,
      },
    };
    const off = savedOff(removed) ?? [];

    expect(off).toHaveLength(DRESSING_OFF_MAX);
    expect(off.at(-1)).toBe(lightOffIdOf(bedroomId));
    expect(off).not.toContain('DRESS-old-0');
    expect(() => RoomSchema.parse({ ...graph.rooms.find((r) => r.id === bedroomId), dressingOff: off })).not.toThrow();
  });
});
