/**
 * V4 — sửa một món bày biện sinh ra thì RIÊNG món ấy thành đồ thật (id suy từ id sinh, id sinh vào `dressingOff`),
 * anh em vẫn là đồ sinh; đồ dời sang phòng khác thì `roomId` theo sang.
 */

import { describe, expect, it } from 'vitest';

import { SpatialGraphDocumentSchema } from '@/api/schemas/spatialGraph';
import { normalizeSpatial } from '@/domain/spatial/normalize';
import type { Furniture, SpatialGraph } from '@/domain/spatial/types';

import { fixtureF2 } from '../__fixtures__';
import { createPascalEditCommand } from '../fromPascal';
import { adoptedFurnitureIdOf, isGeneratedLightId } from '../sceneDressing';
import { toPascalScene } from '../toPascal';
import { adoptableRoomOf, type PascalIdBook } from '../toSpatial';
import type { PascalItemNode, PascalNode, PascalScene } from '../types';

const ACTOR = 'U-1';
/* F1-ext gốc không còn đồ tự bày (FE3D-FIX-004 C2: bàn ăn phòng khách chặn bộ bàn ăn trong bếp, đúng
   như nhà thật). F2 vẫn có giường + tủ đầu giường tự bày trong một phòng và đồ thật — đủ cho ca "nhận nuôi". */
const graph: SpatialGraph = SpatialGraphDocumentSchema.parse(fixtureF2().doc).graph;
const scene = toPascalScene(graph, { furnish: 'on' }).scene;
const items = (of: PascalScene): PascalItemNode[] =>
  Object.values(of.nodes).filter((node): node is PascalItemNode => node.type === 'item');
const dressOf = (of: PascalScene, roomId: string): PascalItemNode[] =>
  items(of).filter((node) => adoptableRoomOf(node) === roomId);

const roomId = [...new Set(items(scene).map((node) => adoptableRoomOf(node)))].find(
  (id): id is string => id !== null && dressOf(scene, id).length >= 2,
);

if (roomId === undefined)
  throw new Error('F1-ext phải có một phòng với ít nhất hai món bày biện sinh ra');

const target = dressOf(scene, roomId)[0] as PascalItemNode;
const moved: PascalNode = {
  ...target,
  position: [target.position[0] + 0.1, target.position[1], target.position[2]],
};
const editedScene: PascalScene = { ...scene, nodes: { ...scene.nodes, [moved.id]: moved } };

const adopt = (idBook: PascalIdBook = new Map()) =>
  createPascalEditCommand({
    graph: normalizeSpatial(graph),
    scene: editedScene,
    commit: { origin: 'local', changedNodeIds: [moved.id] },
    actorId: ACTOR,
    idBook,
  });

const furnitureOf = (changes: readonly { kind: string; after?: unknown }[]): Furniture[] =>
  changes.filter((change) => change.kind === 'furniture').map((change) => change.after as Furniture);

describe('nhận nuôi đồ bày biện sinh ra', () => {
  it('dời một món: riêng món đó thành đồ thật (id suy từ id sinh, chưa duyệt, mẫu đang thấy); phòng ghi dressingOff', () => {
    const result = adopt();

    if (!result.ok) throw new Error(result.error.reasons.join(' '));

    const added = furnitureOf(result.data.changes);
    const dressId = target.id.slice('item_'.length);

    expect(added).toHaveLength(1);
    expect(result.data.changes.filter((change) => change.kind === 'furniture').every((change) => change.before === null)).toBe(true);
    expect(added[0]).toMatchObject({ id: adoptedFurnitureIdOf(dressId), source: 'human', reviewed: false, confidence: 1, roomId });
    expect(added[0]).not.toHaveProperty('slots');
    expect(added[0]?.model?.src).toMatch(/^\/items\/[a-z0-9_-]+\/model\.glb$/);
    expect(added[0]?.centre.x).toBe(Math.round(moved.position[0] * 1000));
    expect(result.data.changes.find((change) => change.kind === 'room')?.after).toMatchObject({ dressingOff: [dressId] });
  });

  it('F-02: đổi mẫu một món chưa dời: riêng món đó được nhận, mẫu mới được lưu', () => {
    const swapped: PascalNode = { ...target, asset: { ...target.asset, id: 'single-bed', src: '/items/single-bed/model.glb' } };
    const result = createPascalEditCommand({
      graph: normalizeSpatial(graph),
      scene: { ...scene, nodes: { ...scene.nodes, [swapped.id]: swapped } },
      commit: { origin: 'local', changedNodeIds: [swapped.id] },
      actorId: ACTOR,
    });

    if (!result.ok) throw new Error(result.error.reasons.join(' '));
    const added = furnitureOf(result.data.changes);
    expect(added).toHaveLength(1);
    expect(added[0]?.model?.src).toBe('/items/single-bed/model.glb');
  });

  it('đèn trần không bao giờ được nhận nuôi', () => {
    const light = items(scene).find((node) => isGeneratedLightId(node.id));

    expect(adoptableRoomOf(light)).toBeNull();
  });

  it('nạp lại sau khi nhận: cùng vị trí, anh em vẫn là đồ sinh, không mọc bản thứ hai của món đã nhận', () => {
    const result = adopt();

    if (!result.ok) throw new Error('phải nhận được');

    const adopted = furnitureOf(result.data.changes);
    const room = result.data.changes.find((change) => change.kind === 'room')?.after as SpatialGraph['rooms'][number];
    const reloaded = toPascalScene(
      { ...graph, furniture: [...graph.furniture, ...adopted], rooms: graph.rooms.map((r) => (r.id === room.id ? room : r)) },
      { furnish: 'on' },
    ).scene;
    const spots = (of: PascalItemNode[]): string[] =>
      of.map((node) => `${node.position[0].toFixed(3)},${node.position[2].toFixed(3)}`).sort();
    const inRoom = (of: PascalScene): PascalItemNode[] =>
      items(of).filter((node) => node.metadata?.appfront?.fields?.['roomId'] === roomId);

    expect(spots(inRoom(reloaded))).toEqual(spots(inRoom(editedScene)));
    expect(dressOf(reloaded, roomId)).toHaveLength(dressOf(scene, roomId).length - 1);
    expect(reloaded.nodes[target.id]).toBeUndefined();
  });

  it('cùng sổ id: lượt sau nhớ id đã cấp', () => {
    const book: PascalIdBook = new Map();
    const first = adopt(book);
    const second = adopt(book);

    expect(first.ok && second.ok).toBe(true);
    expect(second.ok ? second.data.changes.map((change) => change.after?.id) : []).toEqual(
      first.ok ? first.data.changes.map((change) => change.after?.id) : [],
    );
  });
});

describe('N1 — sửa tiếp sau khi đã nhận nuôi (cảnh vẫn giữ node sinh ra)', () => {
  it('sửa tiếp chính món đã nhận: một lần sửa đồ thật ấy, không thêm lại', () => {
    const book: PascalIdBook = new Map();
    const first = adopt(book);

    if (!first.ok) throw new Error(first.error.reasons.join(' '));

    const room = first.data.changes.find((change) => change.kind === 'room')?.after as SpatialGraph['rooms'][number];
    const saved: SpatialGraph = {
      ...graph,
      furniture: [...graph.furniture, ...furnitureOf(first.data.changes)],
      rooms: graph.rooms.map((r) => (r.id === room.id ? room : r)),
    };
    const shifted: PascalNode = { ...target, position: [target.position[0] + 0.1, target.position[1], target.position[2] + 0.2] };
    const second = createPascalEditCommand({
      graph: normalizeSpatial(saved),
      scene: { ...editedScene, nodes: { ...editedScene.nodes, [shifted.id]: shifted } },
      commit: { origin: 'local', changedNodeIds: [shifted.id] },
      actorId: ACTOR,
      idBook: book,
    });

    if (!second.ok) throw new Error(second.error.reasons.join(' '));
    expect(second.data.changes).toHaveLength(1);
    expect(second.data.changes[0]?.before).toMatchObject({ id: book.get(shifted.id) });
    expect((second.data.changes[0]?.after as Furniture).centre.y).toBe(Math.round(shifted.position[2] * 1000));
  });
});

describe('roomId theo món đồ', () => {
  it('dời đồ thật sang phòng khác cùng tầng: roomId đổi theo', () => {
    const real = graph.furniture.find((item) => item.roomId !== undefined && item.kind !== 'stair');
    const other = graph.rooms.find(
      (room) => room.levelId === real?.levelId && room.id !== real?.roomId,
    );

    if (real === undefined || other === undefined)
      throw new Error('F1-ext phải có đồ đạc thật và hai phòng');

    const xs = other.outline.map((point) => point.x);
    const ys = other.outline.map((point) => point.y);
    // Tâm hộp bao của phòng đích; F1 dùng phòng chữ nhật nên tâm nằm trong phòng.
    const centre = {
      x: (Math.min(...xs) + Math.max(...xs)) / 2,
      y: (Math.min(...ys) + Math.max(...ys)) / 2,
    };
    const node = items(scene).find((item) => item.id.endsWith(real.id)) as PascalItemNode;
    const shifted: PascalNode = {
      ...node,
      position: [centre.x / 1000, node.position[1], centre.y / 1000],
    };
    const result = createPascalEditCommand({
      graph: normalizeSpatial(graph),
      scene: { ...scene, nodes: { ...scene.nodes, [shifted.id]: shifted } },
      commit: { origin: 'local', changedNodeIds: [shifted.id] },
      actorId: ACTOR,
    });

    expect(result.ok ? (result.data.changes[0]?.after as Furniture).roomId : null).toBe(other.id);
  });

  it('dời tới đúng đường bao phòng cũ (chung cạnh với phòng khác): giữ roomId', () => {
    const real = graph.furniture.find((item) => item.roomId !== undefined && item.kind !== 'stair');
    const room = graph.rooms.find((item) => item.id === real?.roomId);
    const [a, b] = room?.outline ?? [];

    if (real === undefined || a === undefined || b === undefined) throw new Error('F1-ext phải có đồ đạc trong phòng');

    const node = items(scene).find((item) => item.id.endsWith(real.id)) as PascalItemNode;
    const shifted: PascalNode = {
      ...node,
      position: [(a.x + b.x) / 2000, node.position[1], (a.y + b.y) / 2000],
    };
    const result = createPascalEditCommand({
      graph: normalizeSpatial(graph),
      scene: { ...scene, nodes: { ...scene.nodes, [shifted.id]: shifted } },
      commit: { origin: 'local', changedNodeIds: [shifted.id] },
      actorId: ACTOR,
    });

    expect(result.ok ? (result.data.changes[0]?.after as Furniture).roomId : null).toBe(real.roomId);
  });
});
