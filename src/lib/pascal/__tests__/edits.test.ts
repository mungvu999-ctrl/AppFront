/**
 * Lượt sửa trong Pascal thành lệnh, và phần chênh đẩy ngược sang Pascal.
 *
 * Bài đầu tiên là bài quan trọng nhất của cả Bước 8: **nạp một bản vẽ vào
 * Pascal rồi đọc ngược ra phải cho 0 lệnh.** Hỏng bài đó thì đồng hồ tự lưu
 * 800 ms của A7 sẽ ghi đè dữ liệu máy chủ bằng chính dữ liệu vừa nạp, mỗi lần
 * mở màn hình một lần — và không có nút lưu nào để người dùng dừng tay.
 */

import { describe, expect, it } from 'vitest';

import { SpatialGraphDocumentSchema } from '@/api/schemas/spatialGraph';
import {
  createSampleBuilding,
  sampleLevelId,
  sampleWallId,
} from '@/domain/spatial/__fixtures__/sampleBuilding';
import { normalizeSpatial, type NormalizedSpatial } from '@/domain/spatial/normalize';
import { setDetailsEnabled } from '@/pascal-page/realism/details';
import type { SpatialGraph } from '@/domain/spatial/types';

import type { FloorTransform } from '@/domain/axes/alignFloors';
import { millimetres } from '@/domain/units/types';

import { fixtureF1 } from '../__fixtures__';
import { applyFloorTransforms } from '../floorAlignment';
import { diffScenes, isEmptyDiff } from '../diff';
import { createPascalEditCommand, PASCAL_COMMAND_TYPE, reviewLostNotices } from '../fromPascal';
import { appFrontIdOf, BUILDING_NODE_ID, toPascalId } from '../ids';
import { isGeneratedLightId, isGeneratedNodeId } from '../sceneDressing';
import { toPascalScene } from '../toPascal';
import { CEILING_FIXTURE_REASON, type PascalIdBook, toSpatialGraph } from '../toSpatial';
import type { PascalNode, PascalScene, PascalZoneNode } from '../types';

const ACTOR = 'U-1';
const graph = normalizeSpatial(createSampleBuilding());
const baseScene = toPascalScene(createSampleBuilding()).scene;
const everyNodeId = Object.keys(baseScene.nodes);

const firstWallId = Object.values(baseScene.nodes).find((node) => node.type === 'wall')?.id ?? '';

/** Cảnh nền với một node bị thay hoặc bị bỏ (`undefined`). */
const sceneWith = (nodeId: string, node: PascalNode | undefined): PascalScene => {
  const nodes: Record<string, PascalNode> = { ...baseScene.nodes };

  if (node === undefined) {
    delete nodes[nodeId];
  } else {
    nodes[nodeId] = node;
  }

  return { nodes, rootNodeIds: baseScene.rootNodeIds };
};

/** Tường đầu tiên của cảnh, đã dày thêm 110 mm. */
const thickerWall = (): PascalNode => {
  const wall = baseScene.nodes[firstWallId];

  if (wall === undefined || wall.type !== 'wall') {
    throw new Error('cảnh nền phải có ít nhất một tường');
  }

  return { ...wall, thickness: 0.33 };
};

describe('createPascalEditCommand', () => {
  it('nạp bản vẽ vào Pascal rồi đọc ngược ra: 0 lệnh', () => {
    const result = createPascalEditCommand({
      graph,
      scene: baseScene,
      commit: { origin: 'load', changedNodeIds: everyNodeId },
      actorId: ACTOR,
    });

    expect(result.ok).toBe(false);
    expect(result.ok ? null : result.error.code).toBe('PASCAL_NO_CHANGE');
  });

  describe('trường máy chủ tự đặt (`edited`, `clearAreaM2`, `detectedThicknessMm`)', () => {
    const wallId = graph.byKind.wall[0] ?? '';
    const roomId = graph.byKind.room[0] ?? '';
    const furnitureId = graph.byKind.furniture[0] ?? '';
    const reviewed = (id: string, extra: Record<string, unknown>) => ({ ...graph.byId[id], source: 'human', reviewed: true, ...extra });
    const stamped = {
      ...graph,
      byId: {
        ...graph.byId,
        [wallId]: reviewed(wallId, { detectedThicknessMm: 129, edited: true }),
        [roomId]: reviewed(roomId, { clearAreaM2: 13.73 }),
        [furnitureId]: reviewed(furnitureId, { edited: true }),
      },
    } as NormalizedSpatial;

    it('chỉ các trường này khác: 0 lệnh, nên không bỏ dấu duyệt của ai', () => {
      const result = createPascalEditCommand({
        graph: stamped,
        scene: baseScene,
        commit: { origin: 'local', changedNodeIds: everyNodeId },
        actorId: ACTOR,
      });

      expect(result.ok ? result.data.changes : result.error.code).toBe('PASCAL_NO_CHANGE');
    });

    it('sửa thật: vẫn bỏ dấu duyệt (C2), các trường này giữ nguyên', () => {
      const result = createPascalEditCommand({
        graph: stamped,
        scene: sceneWith(firstWallId, thickerWall()),
        commit: { origin: 'local', changedNodeIds: [firstWallId] },
        actorId: ACTOR,
      });
      const change = result.ok ? result.data.changes.find((candidate) => candidate.id === wallId) : undefined;

      expect(change?.before?.reviewed).toBe(true);
      expect(change?.after).toMatchObject({ reviewed: false, edited: true, detectedThicknessMm: 129 });
    });
  });

  it('tầng bị dời khi hiển thị (căn tầng) vẫn đọc ngược ra 0 lệnh — đồ bày biện không thành đồ người thêm', () => {
    const nodes: Record<string, PascalNode> = { ...baseScene.nodes };
    const moved: FloorTransform = { rotationDeg: 90, translationMm: { x: millimetres(700), y: millimetres(-400) }, scale: 1 };
    applyFloorTransforms(nodes, new Map([[sampleLevelId(1), moved]]), (levelId) => toPascalId('level', levelId));
    const result = createPascalEditCommand({
      graph,
      scene: { ...baseScene, nodes },
      commit: { origin: 'load', changedNodeIds: everyNodeId },
      actorId: ACTOR,
    });

    expect(result.ok ? result.data.changes.slice(0, 2) : result.error.code).toBe('PASCAL_NO_CHANGE');
  });

  it('dự án rỗng: 0 lệnh', () => {
    const empty = normalizeSpatial({
      building: { confidence: 1, source: 'human', reviewed: false, name: 'Rỗng', datumElevationMm: 0 },
      levels: [],
      walls: [],
      openings: [],
      furniture: [],
      rooms: [],
      axes: [],
      dimensions: [],
      notes: [],
    });
    const scene = toPascalScene({
      building: { confidence: 1, source: 'human', reviewed: false, name: 'Rỗng', datumElevationMm: 0 },
      levels: [],
      walls: [],
      openings: [],
      furniture: [],
      rooms: [],
      axes: [],
      dimensions: [],
      notes: [],
    }).scene;

    const result = createPascalEditCommand({
      graph: empty,
      scene,
      commit: { origin: 'local', changedNodeIds: [BUILDING_NODE_ID] },
      actorId: ACTOR,
    });

    expect(result.ok ? null : result.error.code).toBe('PASCAL_NO_CHANGE');
  });

  it('đổi độ dày một tường thành một lệnh có nhãn tiếng Việt và ảnh chụp hai phía', () => {
    const result = createPascalEditCommand({
      graph,
      scene: sceneWith(firstWallId, thickerWall()),
      commit: { origin: 'local', changedNodeIds: [firstWallId] },
      actorId: ACTOR,
      id: 'C-TEST',
      timestamp: '2026-09-27T10:00:00+07:00',
    });

    expect(result.ok).toBe(true);

    const command = result.ok ? result.data : null;

    expect(command?.type).toBe(PASCAL_COMMAND_TYPE);
    expect(command?.actorId).toBe(ACTOR);
    expect(command?.description).toBe('Từ màn 3D: sửa tường 1.');
    expect(command?.changes).toHaveLength(1);
    expect(command?.changes[0]?.before).not.toBeNull();
    expect(command?.changes[0]?.after).not.toBeNull();

    const after = command?.changes[0]?.after;

    expect(after !== null && after !== undefined && 'thicknessMm' in after ? after.thicknessMm : null).toBe(330);
  });

  it('#18 — ghi độ dày vào mô hình rồi nạp lại: Pascal đọc đúng giá trị vừa ghi', () => {
    const result = createPascalEditCommand({
      graph,
      scene: sceneWith(firstWallId, thickerWall()),
      commit: { origin: 'local', changedNodeIds: [firstWallId] },
      actorId: ACTOR,
    });
    const after = result.ok ? result.data.changes[0]?.after : null;

    if (after === null || after === undefined || !('thicknessMm' in after)) {
      throw new Error('lệnh phải mang tường đã sửa');
    }

    const written = { ...createSampleBuilding(), walls: createSampleBuilding().walls.map((wall) => (wall.id === after.id ? after : wall)) };
    const reread = Object.values(toPascalScene(written).scene.nodes).find((node) => node.id === firstWallId);

    expect(reread?.type === 'wall' ? reread.thickness : null).toBeCloseTo(0.33);
  });

  it('#20 — hạ tường thấp hơn đỉnh ô mở trên nó thì bị từ chối kèm câu tiếng Việt', () => {
    const door = Object.values(baseScene.nodes).find((node) => node.type === 'door');
    const wall = door?.parentId === undefined || door.parentId === null ? undefined : baseScene.nodes[door.parentId];

    if (wall === undefined || wall.type !== 'wall') {
      throw new Error('cảnh nền phải có một cửa nằm trên tường');
    }

    const result = createPascalEditCommand({
      graph,
      scene: sceneWith(wall.id, { ...wall, height: 1 }),
      commit: { origin: 'local', changedNodeIds: [wall.id] },
      actorId: ACTOR,
    });

    expect(result.ok).toBe(false);
    expect(result.ok ? null : result.error.code).toBe('PASCAL_WALL_BELOW_OPENING');
    expect(result.ok ? '' : result.error.reasons[0]).toMatch(/^Tường cao 1,00 m, thấp hơn đỉnh ô mở/);
  });

  it('A5 — chỉ đổi `reviewed` trong `metadata.appfront` thì không có lệnh: duyệt ở màn QC', () => {
    const wall = baseScene.nodes[firstWallId];

    if (wall === undefined || wall.type !== 'wall') {
      throw new Error('cảnh nền phải có ít nhất một tường');
    }

    const origin = wall.metadata?.appfront;
    if (origin === undefined) throw new Error('tường nền thiếu `metadata.appfront`');

    const approved = { ...wall, metadata: { appfront: { ...origin, reviewed: true, source: 'human' as const } } };
    const result = createPascalEditCommand({
      graph,
      scene: sceneWith(firstWallId, approved),
      commit: { origin: 'local', changedNodeIds: [firstWallId] },
      actorId: ACTOR,
    });

    expect(result.ok).toBe(false);
    expect(result.ok ? null : result.error.code).toBe('PASCAL_NO_CHANGE');
  });

  it('A5 — Pascal sửa `reviewed` trong siêu dữ liệu thì lệnh KHÔNG mang dấu ấy về', () => {
    const wall = baseScene.nodes[firstWallId];

    if (wall === undefined || wall.type !== 'wall') {
      throw new Error('cảnh nền phải có ít nhất một tường');
    }

    // Bộ mẫu dựng tường bằng `DETECTED`: chưa ai duyệt. Bên kia tường khai
    // ngược lại, và đổi luôn độ dày để lượt này có thật một thay đổi.
    const tampered = {
      ...wall,
      thickness: 0.33,
      metadata: { appfront: { confidence: 1, source: 'human' as const, reviewed: true } },
    };

    const result = createPascalEditCommand({
      graph,
      scene: sceneWith(firstWallId, tampered),
      commit: { origin: 'local', changedNodeIds: [firstWallId] },
      actorId: ACTOR,
    });

    const change = result.ok ? result.data.changes[0] : null;

    expect(change?.before?.reviewed).toBe(false);
    expect(change?.after?.reviewed).toBe(false);
    expect(change?.after?.source).toBe('ai');
    expect(
      change?.after !== null && change?.after !== undefined && 'thicknessMm' in change.after
        ? change.after.thicknessMm
        : null,
    ).toBe(330);
  });

  it('C2 — tường đổi hình học qua Pascal thì MẤT dấu xác minh', () => {
    const wall = baseScene.nodes[firstWallId];

    if (wall === undefined || wall.type !== 'wall') {
      throw new Error('cảnh nền phải có ít nhất một tường');
    }

    /* Tường ĐÃ được người duyệt xác minh — đúng thứ A5 cho phép, vì dấu ấy do
       AppFront viết ra chứ không do Pascal. Rồi Pascal kéo nó đi chỗ khác. */
    const reviewedThenMoved = {
      ...wall,
      end: [wall.end[0] + 1.5, wall.end[1]] as [number, number],
      metadata: { appfront: { confidence: 1, source: 'human' as const, reviewed: true } },
    };
    const reviewedGraph = normalizeSpatial({
      ...createSampleBuilding(),
      walls: createSampleBuilding().walls.map((candidate, index) =>
        index === 0 ? { ...candidate, source: 'human' as const, reviewed: true } : candidate,
      ),
    });

    const result = createPascalEditCommand({
      graph: reviewedGraph,
      scene: sceneWith(firstWallId, reviewedThenMoved),
      commit: { origin: 'local', changedNodeIds: [firstWallId] },
      actorId: ACTOR,
    });

    expect(result.ok).toBe(true);

    const change = result.ok ? result.data.changes[0] : null;

    // Ảnh chụp "trước" giữ nguyên sự thật: tường ấy ĐÃ được duyệt.
    expect(change?.before?.reviewed).toBe(true);
    // Còn bản sau một lượt kéo thì không còn là bức tường người duyệt đã nhìn.
    expect(change?.after?.reviewed).toBe(false);
  });

  it('23R-C-006 — chỉ đổi tên phòng thì GIỮ dấu xác minh (tên không phải hình học)', () => {
    const room = createSampleBuilding().rooms[0];
    const zone = Object.values(baseScene.nodes).find(
      (node) => node.type === 'zone' && appFrontIdOf('room', node.id) === room?.id,
    );

    if (room === undefined || zone === undefined || zone.type !== 'zone') {
      throw new Error('cảnh nền phải có ít nhất một phòng');
    }

    const reviewedGraph = normalizeSpatial({
      ...createSampleBuilding(),
      rooms: createSampleBuilding().rooms.map((candidate, index) =>
        index === 0 ? { ...candidate, source: 'human' as const, reviewed: true } : candidate,
      ),
    });
    const result = createPascalEditCommand({
      graph: reviewedGraph,
      scene: sceneWith(zone.id, { ...zone, name: 'Kho lạnh' }),
      commit: { origin: 'local', changedNodeIds: [zone.id] },
      actorId: ACTOR,
    });

    expect(result.ok).toBe(true);
    const change = result.ok ? result.data.changes[0] : null;
    expect(change?.after).toMatchObject({ name: 'Kho lạnh', reviewed: true });
  });

  it('3A — kéo một đầu tường kéo theo tường nối: CẢ HAI vào cùng một lệnh', () => {
    /* `nodes/src/wall/move-endpoint-tool.tsx:150-200` dời đầu của mọi tường
       chung điểm trong CÙNG một lượt ghi, nên cảnh gửi sang đây mang hai node
       đã đổi. Bài này chứng minh đường lưu không đánh rơi tường thứ hai: một
       lệnh, hai thay đổi, tức một lần Ctrl+Z trả lại cả hai.

       Bộ mẫu A14 không dùng được: 48 tường của nó rải vòng qua 4 tầng
       (`sampleLevelOf` = `index % 4`), nên không hai tường nào CÙNG TẦNG chung
       một điểm — mà cùng tầng là điều kiện của chính công cụ ấy. */
    const corner = { x: 4000, y: 0 };
    const linkedBuilding = {
      building: { confidence: 1, source: 'human' as const, reviewed: false, name: 'Hai tường', datumElevationMm: 0 },
      levels: [
        {
          confidence: 1,
          source: 'human' as const,
          reviewed: false,
          elevationMm: 0,
          heightMm: 3000,
          id: sampleLevelId(0),
          name: 'Tầng 1',
          order: 0,
        },
      ],
      walls: [
        {
          confidence: 1,
          source: 'human' as const,
          reviewed: false,
          centreline: { start: { x: 0, y: 0 }, end: corner },
          heightMm: 3000,
          id: sampleWallId(0),
          kind: 'partition' as const,
          levelId: sampleLevelId(0),
          openingIds: [],
          thicknessMm: 200,
        },
        {
          confidence: 1,
          source: 'human' as const,
          reviewed: false,
          centreline: { start: corner, end: { x: 4000, y: 4000 } },
          heightMm: 3000,
          id: sampleWallId(1),
          kind: 'partition' as const,
          levelId: sampleLevelId(0),
          openingIds: [],
          thicknessMm: 200,
        },
      ],
      openings: [],
      furniture: [],
      rooms: [],
      axes: [],
      dimensions: [],
      notes: [],
    };

    const linkedGraph = normalizeSpatial(linkedBuilding);
    const { scene } = toPascalScene(linkedBuilding);
    const [firstId, secondId] = Object.values(scene.nodes)
      .filter((node) => node.type === 'wall')
      .map((node) => node.id);

    if (firstId === undefined || secondId === undefined) {
      throw new Error('cảnh phải có đúng hai tường');
    }

    const left = scene.nodes[firstId];
    const right = scene.nodes[secondId];

    if (left === undefined || left.type !== 'wall' || right === undefined || right.type !== 'wall') {
      throw new Error('cảnh phải có đúng hai tường');
    }

    // Một lượt kéo góc: điểm chung đi 0,4 m theo cả hai trục.
    const moved: [number, number] = [left.end[0] + 0.4, left.end[1] + 0.4];
    const nodes: Record<string, PascalNode> = {
      ...scene.nodes,
      [firstId]: { ...left, end: moved },
      [secondId]: { ...right, start: moved },
    };

    const result = createPascalEditCommand({
      graph: linkedGraph,
      scene: { nodes, rootNodeIds: scene.rootNodeIds },
      commit: { origin: 'local', changedNodeIds: [firstId, secondId] },
      actorId: ACTOR,
    });

    expect(result.ok).toBe(true);
    expect(result.ok ? result.data.changes : []).toHaveLength(2);
    expect(result.ok ? result.data.description : '').toBe('Từ màn 3D: sửa tường 2.');
  });

  it('xoá một tường thành lệnh xoá mang ảnh chụp cũ, nên hoàn tác được', () => {
    const result = createPascalEditCommand({
      graph,
      scene: sceneWith(firstWallId, undefined),
      commit: { origin: 'local', changedNodeIds: [firstWallId], removedNodeIds: [firstWallId] },
      actorId: ACTOR,
    });

    const change = result.ok ? result.data.changes[0] : null;

    expect(result.ok ? result.data.description : '').toBe('Từ màn 3D: xoá tường 1.');
    expect(change?.after).toBeNull();
    expect(change?.before).not.toBeNull();
  });

  it('phòng người dùng vẽ trong Pascal thành lệnh thêm, id mới và dấu xác minh tắt', () => {
    const levelId = Object.values(baseScene.nodes).find((node) => node.type === 'level')?.id ?? '';
    const level = baseScene.nodes[levelId];
    const drawn: PascalZoneNode = {
      object: 'node',
      id: 'zone_pn44qv12ab34cd56',
      type: 'zone',
      name: 'Phòng mới',
      parentId: levelId,
      polygon: [
        [0, 0],
        [3, 0],
        [3, 3],
        [0, 3],
      ],
      spaceRole: 'room',
      boundaryWallIds: [],
      metadata: { appfront: { confidence: 1, source: 'human', reviewed: true } },
    };
    const scene: PascalScene = {
      rootNodeIds: baseScene.rootNodeIds,
      nodes: {
        ...baseScene.nodes,
        [drawn.id]: drawn,
        ...(level !== undefined && level.type === 'level'
          ? { [levelId]: { ...level, children: [...level.children, drawn.id] } }
          : {}),
      },
    };

    const result = createPascalEditCommand({
      graph,
      scene,
      commit: { origin: 'local', changedNodeIds: [drawn.id] },
      actorId: ACTOR,
    });

    const added = result.ok ? result.data.changes[0]?.after : null;

    expect(result.ok ? result.data.description : '').toBe('Từ màn 3D: thêm phòng 1.');
    expect(result.ok ? result.data.changes[0]?.before : 'x').toBeNull();
    expect(added?.id.startsWith('R-')).toBe(true);
    expect(added?.reviewed).toBe(false);
  });

  it('sổ id giữ nguyên id của đối tượng mới qua hai lượt sửa liền nhau', () => {
    const idBook: PascalIdBook = new Map();
    const levelId = Object.values(baseScene.nodes).find((node) => node.type === 'level')?.id ?? '';
    const drawn: PascalZoneNode = {
      object: 'node',
      id: 'zone_pn55qv12ab34cd56',
      type: 'zone',
      name: 'Phòng mới',
      parentId: levelId,
      polygon: [
        [0, 0],
        [3, 0],
        [3, 3],
      ],
      spaceRole: 'room',
      boundaryWallIds: [],
    };
    const level = baseScene.nodes[levelId];
    const scene: PascalScene = {
      rootNodeIds: baseScene.rootNodeIds,
      nodes: {
        ...baseScene.nodes,
        [drawn.id]: drawn,
        ...(level !== undefined && level.type === 'level'
          ? { [levelId]: { ...level, children: [...level.children, drawn.id] } }
          : {}),
      },
    };

    const first = createPascalEditCommand({
      graph,
      scene,
      commit: { origin: 'local', changedNodeIds: [drawn.id] },
      actorId: ACTOR,
      idBook,
    });
    const second = createPascalEditCommand({
      graph,
      scene,
      commit: { origin: 'local', changedNodeIds: [drawn.id] },
      actorId: ACTOR,
      idBook,
    });

    const firstId = first.ok ? first.data.changes[0]?.id : 'a';
    const secondId = second.ok ? second.data.changes[0]?.id : 'b';

    expect(firstId).toBe(secondId);
    expect(idBook.get(drawn.id)).toBe(firstId);
  });

  it('từ chối kèm mã khi Pascal nhắc tới một node không quy được về loại nào', () => {
    const result = createPascalEditCommand({
      graph,
      scene: baseScene,
      commit: { origin: 'local', changedNodeIds: ['widget_qv12ab34cd56'] },
      actorId: ACTOR,
    });

    expect(result.ok ? null : result.error.code).toBe('PASCAL_UNKNOWN_NODE');
    expect(result.ok ? [] : result.error.reasons).toHaveLength(1);
  });
});

describe('reviewLostNotices (K6)', () => {
  it('một câu mỗi loại có mục đã duyệt bị bỏ dấu; thêm mới hay chưa duyệt thì không', () => {
    const command = {
      changes: [
        { kind: 'wall', before: { reviewed: true }, after: { reviewed: false } },
        { kind: 'wall', before: { reviewed: true }, after: { reviewed: false } },
        { kind: 'room', before: { reviewed: false }, after: { reviewed: false } },
        { kind: 'furniture', before: null, after: { reviewed: false } },
      ],
    } as unknown as Parameters<typeof reviewLostNotices>[0];

    expect(reviewLostNotices(command)).toEqual([
      'Bạn vừa sửa tường đã duyệt nên dấu "đã duyệt" được bỏ. Hãy duyệt lại ở bước Duyệt tầng.',
    ]);
  });
});

describe('diffScenes', () => {
  it('hai cảnh y hệt cho phần chênh rỗng', () => {
    const diff = diffScenes(baseScene, toPascalScene(createSampleBuilding()).scene);

    expect(isEmptyDiff(diff)).toBe(true);
  });

  it('đổi một tường chỉ đẩy lại đúng node ấy', () => {
    const diff = diffScenes(baseScene, sceneWith(firstWallId, thickerWall()));

    expect(diff.upsert.map((node) => node.id)).toEqual([firstWallId]);
    expect(diff.remove).toEqual([]);
  });

  it('xoá một node thì node ấy vào danh sách xoá', () => {
    const diff = diffScenes(baseScene, sceneWith(firstWallId, undefined));

    expect(diff.remove).toEqual([firstWallId]);
    expect(diff.upsert).toEqual([]);
  });

  it('xếp cha trước con trong danh sách phải áp', () => {
    const diff = diffScenes({ nodes: {}, rootNodeIds: [] }, baseScene);
    const depths = diff.upsert.map((node) => node.type);

    expect(depths[0]).toBe('site');
    expect(depths[1]).toBe('building');
    expect(depths.indexOf('level')).toBeLessThan(depths.indexOf('wall'));
    expect(depths.indexOf('wall')).toBeLessThan(depths.indexOf('door'));
  });

  it('báo danh sách gốc mới chỉ khi nó thật sự đổi', () => {
    expect(diffScenes(baseScene, baseScene).rootNodeIds).toBeUndefined();
    expect(diffScenes({ nodes: {}, rootNodeIds: [] }, baseScene).rootNodeIds).toEqual(
      baseScene.rootNodeIds,
    );
  });
});

describe('đổi mẫu đồ đạc', () => {
  const itemNode = Object.values(baseScene.nodes).find((node) => node.type === 'item' && !isGeneratedNodeId(node.id));

  it('mẫu mới đi qua lệnh, và khứ hồi giữ nguyên mẫu', () => {
    if (itemNode === undefined || itemNode.type !== 'item') throw new Error('cảnh nền phải có đồ đạc');

    // W3b: chỉ mẫu `/items/<thư mục>/model.glb` lưu được lên dây (J-v3).
    const asset = { ...itemNode.asset, id: 'catalog-sofa-2', src: '/items/sofa-2/model.glb' };
    const result = createPascalEditCommand({
      graph,
      scene: sceneWith(itemNode.id, { ...itemNode, asset }),
      commit: { origin: 'local', changedNodeIds: [itemNode.id] },
      actorId: ACTOR,
    });

    expect(result.ok).toBe(true);

    const model = { id: 'catalog-sofa-2', src: '/items/sofa-2/model.glb' };
    const sample = createSampleBuilding();
    const [first, ...rest] = sample.furniture;

    if (first === undefined) throw new Error('bộ mẫu phải có đồ đạc');

    const swapped = { ...sample, furniture: [{ ...first, model }, ...rest] };

    const back = toPascalScene(swapped).scene;
    const node = Object.values(back.nodes).find((n) => n.type === 'item' && !isGeneratedNodeId(n.id));

    expect(node?.type === 'item' ? node.asset.id : null).toBe('catalog-sofa-2');
  });

  it('?drape=uv: đường GLB `-uv` chỉ để hiển thị, lưu ra luôn thư mục gốc (vòng 10)', () => {
    if (itemNode === undefined || itemNode.type !== 'item') throw new Error('cảnh nền phải có đồ đạc');
    const asset = { ...itemNode.asset, id: 'catalog-pillow', src: '/items/pillow-uv/model.glb' };
    const saved = toSpatialGraph(sceneWith(itemNode.id, { ...itemNode, asset }));
    const json = JSON.stringify(saved);
    expect(json).not.toContain('-uv/');
    expect(json).toContain('/items/pillow/model.glb');
  });
});

/** R3-F1/F2 — lượt ghi từ Pascal không được làm mất dữ liệu của F1-ext. */
describe('F1-ext: lượt sửa không làm mất dữ liệu', () => {
  const extGraph: SpatialGraph = SpatialGraphDocumentSchema.parse(fixtureF1({ ext: true }).doc).graph;
  const extScene = toPascalScene(extGraph).scene;
  const nodeOf = (type: PascalNode['type'], appFrontId: string): PascalNode => {
    const node = Object.values(extScene.nodes).find((n) => n.type === type && n.id === `${type}_${appFrontId}`);

    if (node === undefined) throw new Error(`cảnh F1-ext thiếu ${type} ${appFrontId}`);

    return node;
  };
  const withNodes = (...nodes: readonly PascalNode[]): PascalScene => ({
    rootNodeIds: extScene.rootNodeIds,
    nodes: { ...extScene.nodes, ...Object.fromEntries(nodes.map((node) => [node.id, node])) },
  });

  it('nạp F1-ext rồi đọc ngược ra: 0 lệnh (variant/heightMm/liftMm/finish không tính là đổi)', () => {
    const result = createPascalEditCommand({
      graph: normalizeSpatial(extGraph),
      scene: extScene,
      commit: { origin: 'load', changedNodeIds: Object.keys(extScene.nodes) },
      actorId: ACTOR,
    });

    expect(result.ok ? null : result.error.code).toBe('PASCAL_NO_CHANGE');
  });

  it('cờ details bật (phào chân ngoài dựng lúc nạp): nạp F1-ext rồi đọc ngược ra vẫn 0 lệnh', () => {
    setDetailsEnabled(true);
    const detailed = toPascalScene(extGraph).scene;
    setDetailsEnabled(false);
    const result = createPascalEditCommand({
      graph: normalizeSpatial(extGraph),
      scene: detailed,
      commit: { origin: 'load', changedNodeIds: Object.keys(detailed.nodes) },
      actorId: ACTOR,
    });

    expect(result.ok ? null : result.error.code).toBe('PASCAL_NO_CHANGE');
  });

  it('dời một món treo: lệnh giữ nguyên variant, heightMm, liftMm', () => {
    const lifted = extGraph.furniture.find((item) => item.liftMm !== undefined && item.variant !== undefined);
    const node = lifted === undefined ? undefined : nodeOf('item', lifted.id);

    if (lifted === undefined || node?.type !== 'item') throw new Error('F1-ext phải có một món treo');

    const result = createPascalEditCommand({
      graph: normalizeSpatial(extGraph),
      scene: withNodes({ ...node, position: [node.position[0] + 0.3, node.position[1], node.position[2]] }),
      commit: { origin: 'local', changedNodeIds: [node.id] },
      actorId: ACTOR,
    });

    expect(result.ok).toBe(true);
    expect(result.ok ? result.data.changes[0]?.after : null).toMatchObject({
      variant: lifted.variant,
      heightMm: lifted.heightMm,
      liftMm: lifted.liftMm,
    });
  });

  it('đổi tên phòng có finish: giữ finish và dấu xác minh', () => {
    const finished = extGraph.rooms.find((room) => room.finish !== undefined);

    if (finished === undefined) throw new Error('F1-ext phải có phòng khai finish');

    const reviewed = normalizeSpatial({
      ...extGraph,
      rooms: extGraph.rooms.map((room) =>
        room.id === finished.id ? { ...room, source: 'human' as const, reviewed: true } : room,
      ),
    });
    const zone = nodeOf('zone', finished.id) as PascalZoneNode;
    const result = createPascalEditCommand({
      graph: reviewed,
      scene: withNodes({ ...zone, name: 'Phòng đổi tên' }),
      commit: { origin: 'local', changedNodeIds: [zone.id] },
      actorId: ACTOR,
    });

    expect(result.ok ? result.data.changes : null).toHaveLength(1);
    expect(result.ok ? result.data.changes[0]?.after : null).toMatchObject({
      name: 'Phòng đổi tên',
      finish: finished.finish,
      reviewed: true,
    });
  });

  it('đặt một đồ gắn trần (con của trần sinh ra): từ chối kèm câu rõ, kể cả khi đi cùng lượt sửa khác', () => {
    const ceiling = Object.values(extScene.nodes).find((node) => node.type === 'ceiling');
    const light = Object.values(extScene.nodes).find((node) => node.type === 'item' && isGeneratedLightId(node.id));

    if (ceiling?.type !== 'ceiling' || light?.type !== 'item') throw new Error('F1-ext phải có trần và đèn');

    // Cùng mô hình đèn nhưng không mang dấu `generated`: món Pascal vừa đặt dưới trần.
    const plain = { ...light, metadata: {} };
    const fan: PascalNode = { ...plain, id: 'item_pn77qv12ab34cd56', position: [0.5, 0, 0.5] };
    const parent: PascalNode = { ...ceiling, children: [...ceiling.children, fan.id] };
    const wall = Object.values(extScene.nodes).find((node) => node.type === 'wall');

    if (wall?.type !== 'wall') throw new Error('F1-ext phải có tường');

    for (const [nodes, changedNodeIds] of [
      [[fan, parent], [fan.id, parent.id]],
      [[fan, parent, { ...wall, thickness: wall.thickness + 0.05 }], [wall.id, fan.id, parent.id]],
    ] as const) {
      const result = createPascalEditCommand({
        graph: normalizeSpatial(extGraph),
        scene: withNodes(...nodes),
        commit: { origin: 'local', changedNodeIds },
        actorId: ACTOR,
      });

      expect(result.ok ? null : result.error.code).toBe('PASCAL_UNKNOWN_NODE');
      expect(result.ok ? [] : result.error.reasons).toEqual([CEILING_FIXTURE_REASON]);
    }
  });
});

/** J10 — đồ bày biện sinh ra (`item_DRESS-…`) không bao giờ thành dữ liệu của bản vẽ. */
describe('đồ bày biện sinh ra', () => {
  const extGraph: SpatialGraph = SpatialGraphDocumentSchema.parse(fixtureF1({ ext: true }).doc).graph;
  const extScene = toPascalScene(extGraph).scene;
  const real = Object.values(extScene.nodes).find((node) => node.type === 'item' && !isGeneratedNodeId(node.id));
  const level = real?.parentId === null || real === undefined ? undefined : extScene.nodes[real.parentId];

  if (real?.type !== 'item' || level?.type !== 'level') throw new Error('F1-ext phải có đồ đạc dưới tầng');

  const dress: PascalNode = {
    ...real,
    id: 'item_DRESS-rug-R-ROOM0001',
    position: [real.position[0] + 0.2, real.position[1], real.position[2]],
    metadata: { ...real.metadata, generated: 'dressing' },
  };
  const dressed: PascalScene = {
    rootNodeIds: extScene.rootNodeIds,
    nodes: { ...extScene.nodes, [dress.id]: dress, [level.id]: { ...level, children: [...level.children, dress.id] } },
  };

  it('toSpatial bỏ qua nó: đồ thị và danh sách bỏ qua y như cảnh không có nó', () => {
    expect(toSpatialGraph(dressed)).toEqual(toSpatialGraph(extScene));
  });

  it('xoá nó: không lệnh nào, không lỗi lạ (chưa lưu được — V3 báo)', () => {
    const result = createPascalEditCommand({
      graph: normalizeSpatial(extGraph),
      scene: extScene,
      commit: { origin: 'local', changedNodeIds: [dress.id] },
      actorId: ACTOR,
    });

    expect(result.ok ? null : result.error.code).toBe('PASCAL_NO_CHANGE');
  });

  it('dời nó (V4): được nhận nuôi thành đồ thật id F-, không bao giờ mang id DRESS-', () => {
    const moved: PascalScene = { ...dressed, nodes: { ...dressed.nodes, [dress.id]: { ...dress, position: [0, 0, 0] } } };
    const result = createPascalEditCommand({
      graph: normalizeSpatial(extGraph),
      scene: moved,
      commit: { origin: 'local', changedNodeIds: [dress.id] },
      actorId: ACTOR,
    });
    const ids = result.ok ? result.data.changes.map((change) => change.after?.id ?? '') : [];

    expect(ids.length).toBeGreaterThan(0);
    expect(ids.every((id) => id.startsWith('F-'))).toBe(true);
  });
});
