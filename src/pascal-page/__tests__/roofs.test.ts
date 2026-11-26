// @vitest-environment node -- như `src/lib/pascal/**` nơi test này ở trước (fixture đọc tệp qua `import.meta.url`).
/** Mái lưu về bản vẽ và dựng lại (roof-contract.md). */

import { useScene } from '@pascal-app/core';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { SpatialGraphDocumentSchema } from '@/api/schemas/spatialGraph';
import { normalizeSpatial } from '@/domain/spatial/normalize';
import type { Roof, SpatialGraph } from '@/domain/spatial/types';
import { fixtureF1 } from '@/lib/pascal/__fixtures__';
import { createPascalEditCommand } from '@/lib/pascal/fromPascal';
import { approvedRoofMetadata } from '@/lib/pascal/roofReview';
import { roofVerdictOf } from '@/lib/pascal/roofs';
import { toPascalScene } from '@/lib/pascal/toPascal';
import { toSpatialGraph } from '@/lib/pascal/toSpatial';
import type { PascalNode, PascalScene } from '@/lib/pascal/types';
import { setDetailsEnabled } from '@/pascal-page/realism/details';

const ACTOR = 'U-1';
const extGraph: SpatialGraph = SpatialGraphDocumentSchema.parse(fixtureF1({ ext: true }).doc).graph;
const levelId = extGraph.levels[0]?.id ?? 'L-MISSING';
const levelNodeId = `level_${levelId}`;

/** Mái hai mặt như công cụ vẽ của Pascal sinh ra: id nanoid, chưa có id AppFront. */
const drawnRoof = (): readonly Record<string, unknown>[] => [
  {
    object: 'node',
    id: 'roof_k3n9q2w8e7r6',
    type: 'roof',
    parentId: levelNodeId,
    children: ['rseg_a1b2c3d4e5f6', 'rseg_f6e5d4c3b2a1'],
    name: 'Mái',
    visible: true,
    metadata: {},
    position: [2.5, 0, 3.1],
    rotation: 0.25,
    support: { kind: 'level' },
  },
  {
    object: 'node',
    id: 'rseg_a1b2c3d4e5f6',
    type: 'roof-segment',
    parentId: 'roof_k3n9q2w8e7r6',
    children: [],
    visible: true,
    metadata: {},
    roofType: 'gable',
    position: [0, 0, 0],
    rotation: 0,
    width: 8.2,
    depth: 6.4,
    wallHeight: 0,
    roofHeight: 2.1,
    overhang: 0.45,
  },
  {
    object: 'node',
    id: 'rseg_f6e5d4c3b2a1',
    type: 'roof-segment',
    parentId: 'roof_k3n9q2w8e7r6',
    children: ['gutter_zz11yy22xx33'],
    visible: true,
    metadata: { autoGutter: false },
    fascia: false,
    roofType: 'shed',
    position: [4.1, 0, 0],
    rotation: 1.5707963,
    width: 3,
    depth: 2,
    wallHeight: 0,
    roofHeight: 0.8,
    overhang: 0.3,
  },
  {
    object: 'node',
    id: 'gutter_zz11yy22xx33',
    type: 'gutter',
    parentId: 'rseg_f6e5d4c3b2a1',
    metadata: { generatedBy: 'default-gutter', autoGutterSide: '+X' },
  },
];

const sceneWith = (base: PascalScene, extra: readonly Record<string, unknown>[]): PascalScene => {
  const nodes: Record<string, PascalNode> = { ...base.nodes };

  for (const node of extra) nodes[node.id as string] = node as unknown as PascalNode;

  const level = nodes[levelNodeId];

  if (level?.type !== 'level') throw new Error('F1-ext phải có tầng');

  const roofIds = extra.filter((node) => node.type === 'roof').map((node) => node.id as string);
  nodes[levelNodeId] = { ...level, children: [...level.children.filter((id) => !roofIds.includes(id)), ...roofIds] };

  return { ...base, nodes };
};

/** F1-ext + một mái đã lưu, qua đúng schema dây. */
const savedRoofGraph = (): SpatialGraph => {
  const { graph } = toSpatialGraph(sceneWith(toPascalScene(extGraph).scene, drawnRoof()));
  const doc = fixtureF1({ ext: true }).doc;

  return SpatialGraphDocumentSchema.parse({ ...doc, graph: { ...doc.graph, roofs: graph.roofs } }).graph;
};

const roofOf = (graph: SpatialGraph): Roof => {
  const [roof, ...others] = graph.roofs ?? [];

  if (roof === undefined || others.length > 0) throw new Error('đồ thị phải có đúng một mái');

  return roof;
};

afterEach(() => {
  setDetailsEnabled(true);
  vi.unstubAllGlobals();
});

describe.each([true, false])('mái, cờ details = %s', (details) => {
  it('F1-ext nạp rồi đọc ngược ra: 0 lệnh, có mái cũng vậy', () => {
    setDetailsEnabled(details);

    for (const graph of [extGraph, savedRoofGraph()]) {
      const scene = toPascalScene(graph).scene;
      const result = createPascalEditCommand({
        graph: normalizeSpatial(graph),
        scene,
        commit: { origin: 'load', changedNodeIds: Object.keys(scene.nodes) },
        actorId: ACTOR,
      });

      expect(result.ok ? result.data.changes : result.error.code).toBe('PASCAL_NO_CHANGE');
      expect(toSpatialGraph(scene).graph.roofs).toEqual(graph.roofs);
    }
  });

  it('toSpatial ra đúng một Roof không mang cây; toPascalScene dựng lại đúng hình học', () => {
    setDetailsEnabled(details);

    const drawn = drawnRoof();
    const { graph, skipped } = toSpatialGraph(sceneWith(toPascalScene(extGraph).scene, drawn));
    const roof = roofOf(graph);

    expect(skipped.filter((entry) => entry.kind === 'mái')).toEqual([]);
    expect(roof).toMatchObject({ levelId, source: 'human', reviewed: false });
    expect(roof.id).toMatch(/^RF-[0-9A-Z]{10,}$/u);
    expect(roof.nodes).toHaveLength(3);
    expect(roof.nodes.every((node) => !('parentId' in node) && !('children' in node))).toBe(true);
    expect(roof.nodes[0]?.id).toBe(`roof_${roof.id}`);

    const rebuilt = toPascalScene(graph).scene.nodes;
    const roofNode = rebuilt[`roof_${roof.id}`];

    expect(roofNode).toMatchObject({ type: 'roof', parentId: levelNodeId, children: ['rseg_a1b2c3d4e5f6', 'rseg_f6e5d4c3b2a1'] });
    expect(rebuilt[levelNodeId]?.type === 'level' ? rebuilt[levelNodeId].children : []).toContain(`roof_${roof.id}`);

    const geometry = ['type', 'name', 'position', 'rotation', 'support', 'roofType', 'width', 'depth', 'wallHeight', 'roofHeight', 'overhang'];

    for (const original of drawn.slice(0, 3)) {
      const id = original.type === 'roof' ? `roof_${roof.id}` : (original.id as string);
      const node = rebuilt[id] as unknown as Record<string, unknown> | undefined;

      for (const key of geometry) expect(node?.[key], `${id}.${key}`).toEqual(original[key]);
      if (original.type === 'roof-segment') expect(node?.parentId).toBe(`roof_${roof.id}`);
    }
  });

  it('sửa một mặt mái → lệnh có đúng một thay đổi roof', () => {
    setDetailsEnabled(details);

    const graph = savedRoofGraph();
    const scene = toPascalScene(graph).scene;
    const segment = scene.nodes.rseg_a1b2c3d4e5f6;

    if (segment === undefined) throw new Error('cảnh phải có mặt mái');

    const edited: PascalScene = { ...scene, nodes: { ...scene.nodes, [segment.id]: { ...segment, roofHeight: 2.6 } as unknown as PascalNode } };
    const result = createPascalEditCommand({
      graph: normalizeSpatial(graph),
      scene: edited,
      commit: { origin: 'local', changedNodeIds: [segment.id, 'gutter_zz11yy22xx33'] },
      actorId: ACTOR,
    });

    if (!result.ok) throw new Error(result.error.reasons.join(' '));

    expect(result.data.changes).toHaveLength(1);
    expect(result.data.changes[0]?.kind).toBe('roof');
    expect(result.data.changes[0]?.after).toMatchObject({ id: roofOf(graph).id });
    expect((result.data.changes[0]?.after as Roof).nodes[1]).toMatchObject({ roofHeight: 2.6 });
  });

  it('xoá một mặt mái → một thay đổi roof còn một mặt', () => {
    setDetailsEnabled(details);

    const graph = savedRoofGraph();
    const scene = toPascalScene(graph).scene;
    const roofNodeId = `roof_${roofOf(graph).id}`;
    const roofNode = scene.nodes[roofNodeId];

    if (roofNode?.type !== 'roof') throw new Error('cảnh phải có mái');

    const rest = { ...scene.nodes };

    delete rest.rseg_f6e5d4c3b2a1;
    const result = createPascalEditCommand({
      graph: normalizeSpatial(graph),
      scene: { ...scene, nodes: { ...rest, [roofNodeId]: { ...roofNode, children: ['rseg_a1b2c3d4e5f6'] } } },
      commit: { origin: 'local', changedNodeIds: ['rseg_f6e5d4c3b2a1', 'gutter_zz11yy22xx33'] },
      actorId: ACTOR,
    });

    if (!result.ok) throw new Error(result.error.reasons.join(' '));

    expect(result.data.changes.map((change) => change.kind)).toEqual(['roof']);
    expect((result.data.changes[0]?.after as Roof).nodes).toHaveLength(2);
  });

  it('vẽ mái mới → lệnh thêm một roof (không còn PASCAL_UNKNOWN_NODE)', () => {
    setDetailsEnabled(details);

    const result = createPascalEditCommand({
      graph: normalizeSpatial(extGraph),
      scene: sceneWith(toPascalScene(extGraph).scene, drawnRoof()),
      commit: { origin: 'local', changedNodeIds: ['roof_k3n9q2w8e7r6', 'rseg_a1b2c3d4e5f6', 'rseg_f6e5d4c3b2a1'] },
      actorId: ACTOR,
    });

    if (!result.ok) throw new Error(result.error.reasons.join(' '));

    expect(result.data.changes).toHaveLength(1);
    expect(result.data.changes[0]).toMatchObject({ kind: 'roof', before: null });
  });
});

describe('GĐ6 — diềm + máng mặc định cho mái đã lưu', () => {
  it('cờ details bật, mặt mái thiếu fascia/autoGutter → dựng ra có cả hai; mặt đã tắt giữ tắt', () => {
    setDetailsEnabled(true);

    const graph = savedRoofGraph();
    const stored = roofOf(graph).nodes[1];

    expect(stored).not.toHaveProperty('fascia');
    expect(stored?.metadata).not.toHaveProperty('autoGutter');

    const nodes = toPascalScene(graph).scene.nodes as unknown as Record<string, Record<string, unknown>>;

    expect(nodes.rseg_a1b2c3d4e5f6).toMatchObject({ fascia: true, metadata: { autoGutter: true } });
    expect(nodes.rseg_f6e5d4c3b2a1).toMatchObject({ fascia: false, metadata: { autoGutter: false } });
  });

  it('cờ details tắt → không thêm gì', () => {
    setDetailsEnabled(false);

    const nodes = toPascalScene(savedRoofGraph()).scene.nodes as unknown as Record<string, Record<string, unknown>>;

    expect(nodes.rseg_a1b2c3d4e5f6).not.toHaveProperty('fascia');
    expect(nodes.rseg_a1b2c3d4e5f6?.metadata).not.toHaveProperty('autoGutter');
  });
});

describe('dây', () => {
  it('`roofs: []` hay vắng đều đọc thành không có khoá; mái có id RF- đi qua schema', () => {
    const doc = fixtureF1({ ext: true }).doc;

    expect(SpatialGraphDocumentSchema.parse({ ...doc, graph: { ...doc.graph, roofs: [] } }).graph).not.toHaveProperty('roofs');
    expect(roofOf(savedRoofGraph()).id).toMatch(/^RF-/u);
    expect(() =>
      SpatialGraphDocumentSchema.parse({ ...doc, graph: { ...doc.graph, roofs: [{ ...roofOf(savedRoofGraph()), nodes: [] }] } }),
    ).toThrow();
  });
});

describe('durable gutter — mái nạp lại có máng ngay (luật r9g-load-gutters)', () => {
  type Live = Record<string, { type?: string; parentId?: string | null; children?: string[] | undefined; metadata?: unknown }>;

  const guttersOf = (nodes: Live, segmentId: string): string[] =>
    (nodes[segmentId]?.children ?? []).filter((id) => nodes[id]?.type === 'gutter');

  /** Đúng việc luật vá làm sau `setScene`: gửi lại `metadata` của mặt mái bật autoGutter mà chưa có máng. */
  const refreshLoadedGutters = (): void => {
    const nodes = useScene.getState().nodes as unknown as Live;
    const gutterless = Object.entries(nodes).filter(
      ([id, node]) =>
        node.type === 'roof-segment' &&
        (node.metadata as { autoGutter?: unknown } | undefined)?.autoGutter === true &&
        guttersOf(nodes, id).length === 0,
    );

    const wasReadOnly = useScene.getState().readOnly;

    /* eslint-disable-next-line local/no-direct-set -- kho `useScene` của Pascal (không phải kho AppFront), nên không có commit(patch, label) để đi qua. */
    if (wasReadOnly) useScene.setState({ readOnly: false });
    try {
      useScene
        .getState()
        .updateNodes(gutterless.map(([id, node]) => ({ id: id as never, data: { metadata: node.metadata } as never })));
    } finally {
      // eslint-disable-next-line local/no-direct-set -- như trên
      if (wasReadOnly) useScene.setState({ readOnly: true });
    }

    const refreshed: Live = { ...(useScene.getState().nodes as unknown as Live) };

    for (const [id, node] of gutterless) refreshed[id] = { ...node, children: refreshed[id]?.children ?? node.children };
    // eslint-disable-next-line local/no-direct-set -- như trên
    useScene.setState({ nodes: refreshed as never });
  };

  it('nạp → có máng; đọc ngược 0 lệnh; sửa mặt mái không nhân đôi máng', () => {
    setDetailsEnabled(true);

    const graph = savedRoofGraph();
    vi.stubGlobal('requestAnimationFrame', () => 0);
    vi.stubGlobal('cancelAnimationFrame', () => undefined);
    const built = toPascalScene(graph).scene;

    useScene.getState().setScene(built.nodes as never, built.rootNodeIds as never);
    const loadedRoofs = toSpatialGraph({ ...built, nodes: useScene.getState().nodes } as unknown as PascalScene).graph.roofs;

    expect(loadedRoofs).toHaveLength(1);
    expect(guttersOf(useScene.getState().nodes as unknown as Live, 'rseg_a1b2c3d4e5f6')).toEqual([]);

    refreshLoadedGutters();

    const live = (): Live => useScene.getState().nodes as unknown as Live;
    const gutters = guttersOf(live(), 'rseg_a1b2c3d4e5f6');

    expect(gutters.length).toBeGreaterThan(0);
    expect(guttersOf(live(), 'rseg_f6e5d4c3b2a1')).toEqual([]);

    // setScene tự đổi roofHeight → pitch (migrateNodes, có từ trước luật này); máng không thêm gì vào bản lưu.
    expect(toSpatialGraph({ ...built, nodes: live() } as unknown as PascalScene).graph.roofs).toEqual(loadedRoofs);

    refreshLoadedGutters();
    useScene.getState().updateNodes([{ id: 'rseg_a1b2c3d4e5f6' as never, data: { width: 9 } as never }]);

    const after = guttersOf(live(), 'rseg_a1b2c3d4e5f6');

    expect(after).toHaveLength(gutters.length);
    expect(Object.values(live()).filter((node) => node.type === 'gutter')).toHaveLength(gutters.length);
  });

  it('cảnh chỉ đọc (readOnly) cũng có máng, cờ readOnly giữ nguyên, đọc ngược 0 lệnh', () => {
    setDetailsEnabled(true);
    vi.stubGlobal('requestAnimationFrame', () => 0);
    vi.stubGlobal('cancelAnimationFrame', () => undefined);
    const built = toPascalScene(savedRoofGraph()).scene;

    useScene.getState().setReadOnly(true);
    try {
      useScene.getState().setScene(built.nodes as never, built.rootNodeIds as never);
      const loadedRoofs = toSpatialGraph({ ...built, nodes: useScene.getState().nodes } as unknown as PascalScene).graph.roofs;

      refreshLoadedGutters();
      const live = useScene.getState().nodes as unknown as Live;

      expect(guttersOf(live, 'rseg_a1b2c3d4e5f6').length).toBeGreaterThan(0);
      expect(useScene.getState().readOnly).toBe(true);
      expect(toSpatialGraph({ ...built, nodes: live } as unknown as PascalScene).graph.roofs).toEqual(loadedRoofs);
    } finally {
      useScene.getState().setReadOnly(false);
    }
  });
});

describe('NHA-09 — mái do máy dựng và "Duyệt mái"', () => {
  /** Mái đã lưu nhưng do máy dựng, chưa ai duyệt (như tác vụ ráp nhà của BE phát). */
  const aiRoofGraph = (): SpatialGraph => {
    const graph = savedRoofGraph();

    return { ...graph, roofs: [{ ...roofOf(graph), source: 'ai', reviewed: false, confidence: 0.6 }] };
  };

  const commandFor = (graph: SpatialGraph, scene: PascalScene, changedNodeIds: string[]) =>
    createPascalEditCommand({ graph: normalizeSpatial(graph), scene, commit: { origin: 'local', changedNodeIds }, actorId: ACTOR });

  it('nạp mái AI: node mái mang nguồn `ai`, chưa duyệt; đọc ngược ra đúng mái đó', () => {
    const graph = aiRoofGraph();
    const scene = toPascalScene(graph).scene;
    const roofNode = Object.values(scene.nodes).find((node) => node.type === 'roof');

    expect(roofNode?.metadata?.appfront).toMatchObject({ source: 'ai', reviewed: false, confidence: 0.6 });
    expect(toSpatialGraph(scene).graph.roofs).toEqual(graph.roofs);
  });

  it('sửa một mặt của mái AI: mái ghi về vẫn là `ai`, chưa duyệt (đã sửa chưa phải là đã duyệt)', () => {
    const graph = aiRoofGraph();
    const scene = toPascalScene(graph).scene;
    const segment = scene.nodes.rseg_a1b2c3d4e5f6;

    if (segment === undefined) throw new Error('cảnh phải có mặt mái');
    const edited: PascalScene = { ...scene, nodes: { ...scene.nodes, [segment.id]: { ...segment, roofHeight: 2.6 } as unknown as PascalNode } };
    const result = commandFor(graph, edited, [segment.id]);

    if (!result.ok) throw new Error(result.error.reasons.join(' '));
    expect(result.data.changes).toHaveLength(1);
    expect(result.data.changes[0]?.after).toMatchObject({ source: 'ai', reviewed: false });
  });

  it('"Duyệt mái": đúng một thay đổi roof, mái ghi về là `human`, đã duyệt, giữ độ tin', () => {
    const graph = aiRoofGraph();
    const scene = toPascalScene(graph).scene;
    const roofNode = Object.values(scene.nodes).find((node) => node.type === 'roof');

    if (roofNode === undefined) throw new Error('cảnh phải có mái');
    const approved: PascalScene = {
      ...scene,
      nodes: { ...scene.nodes, [roofNode.id]: { ...roofNode, metadata: approvedRoofMetadata(roofNode.metadata) } as unknown as PascalNode },
    };
    const result = commandFor(graph, approved, [roofNode.id]);

    if (!result.ok) throw new Error(result.error.reasons.join(' '));
    expect(result.data.changes).toHaveLength(1);
    expect(result.data.changes[0]?.kind).toBe('roof');
    expect(result.data.changes[0]?.after).toMatchObject({ id: roofOf(graph).id, source: 'human', reviewed: true, confidence: 0.6 });
  });

  /** Cảnh của `graph` với túi `appfront` của node mái bị đổi thành `origin`. */
  const withOrigin = (graph: SpatialGraph, origin: { source: string; reviewed: boolean }): { scene: PascalScene; roofNodeId: string } => {
    const scene = toPascalScene(graph).scene;
    const roofNode = Object.values(scene.nodes).find((node) => node.type === 'roof');

    if (roofNode === undefined) throw new Error('cảnh phải có mái');
    const metadata = { ...roofNode.metadata, appfront: { ...roofNode.metadata?.appfront, ...origin } };

    return { scene: { ...scene, nodes: { ...scene.nodes, [roofNode.id]: { ...roofNode, metadata } as unknown as PascalNode } }, roofNodeId: roofNode.id };
  };

  it('hoàn tác cú duyệt: mái đã duyệt quay về `ai`, chưa duyệt', () => {
    const base = aiRoofGraph();
    const graph: SpatialGraph = { ...base, roofs: [{ ...roofOf(base), source: 'human', reviewed: true }] };
    const { roofNodeId, scene } = withOrigin(graph, { source: 'ai', reviewed: false });
    const result = commandFor(graph, scene, [roofNodeId]);

    if (!result.ok) throw new Error(result.error.reasons.join(' '));
    expect(result.data.changes[0]?.after).toMatchObject({ source: 'ai', reviewed: false });
  });

  it('ngoại lệ chỉ có hai bước chuyển đó: mái người vẽ bị sửa túi thành "đã duyệt" thì không có lệnh nào (A5)', () => {
    const graph = savedRoofGraph();
    const { roofNodeId, scene } = withOrigin(graph, { source: 'human', reviewed: true });
    const result = commandFor(graph, scene, [roofNodeId]);

    expect(result.ok ? result.data.changes : result.error.code).toBe('PASCAL_NO_CHANGE');
  });

  it('mái AI bị sửa túi thành `ai` + đã duyệt (cặp dây cấm): không được nhận, không có lệnh', () => {
    const graph = aiRoofGraph();
    const { roofNodeId, scene } = withOrigin(graph, { source: 'ai', reviewed: true });
    const result = commandFor(graph, scene, [roofNodeId]);

    expect(result.ok ? result.data.changes : result.error.code).toBe('PASCAL_NO_CHANGE');
  });

  it.each(['wall', 'room', 'opening', 'furniture'])('ngoại lệ không mở cho loại `%s`: phán quyết vẫn lấy từ "trước" (A5)', (kind) => {
    expect(roofVerdictOf(kind, { source: 'ai', reviewed: false }, { source: 'human', reviewed: true })).toBeNull();
  });

  it('lượt lưu chỉ khai một mặt mái mà mái chủ vừa được duyệt: vẫn ghi lượt duyệt của mái chủ', () => {
    const graph = aiRoofGraph();
    const { scene } = withOrigin(graph, { source: 'human', reviewed: true });
    const result = commandFor(graph, scene, ['rseg_a1b2c3d4e5f6']);

    if (!result.ok) throw new Error(result.error.reasons.join(' '));
    expect(result.data.changes).toHaveLength(1);
    expect(result.data.changes[0]?.after).toMatchObject({ source: 'human', reviewed: true });
  });

  it('sửa hình mái SAU lượt duyệt đã lưu: mất dấu duyệt (C2), và túi cũ của cảnh không duyệt lại được', () => {
    const base = aiRoofGraph();
    const graph: SpatialGraph = { ...base, roofs: [{ ...roofOf(base), source: 'human', reviewed: true }] };
    const scene = toPascalScene(graph).scene;
    const segment = scene.nodes.rseg_a1b2c3d4e5f6;

    if (segment === undefined) throw new Error('cảnh phải có mặt mái');
    const edited: PascalScene = { ...scene, nodes: { ...scene.nodes, [segment.id]: { ...segment, roofHeight: 2.6 } as unknown as PascalNode } };
    const result = commandFor(graph, edited, [segment.id]);

    if (!result.ok) throw new Error(result.error.reasons.join(' '));
    expect(result.data.changes[0]?.after).toMatchObject({ source: 'human', reviewed: false });
    const saved: SpatialGraph = { ...graph, roofs: [result.data.changes[0]?.after as Roof] };
    const again = commandFor(saved, edited, [segment.id]);

    expect(again.ok ? again.data.changes : again.error.code).toBe('PASCAL_NO_CHANGE');
  });

  /* Quyết định có chủ ý (xem `roofVerdictOf`): một lượt lưu không cho biết sửa trước hay duyệt trước. */
  it('sửa một mặt mái và duyệt trong cùng một lượt lưu: mái ghi về mang hình mới và đã duyệt', () => {
    const graph = aiRoofGraph();
    const { roofNodeId, scene } = withOrigin(graph, { source: 'human', reviewed: true });
    const segment = scene.nodes.rseg_a1b2c3d4e5f6;

    if (segment === undefined) throw new Error('cảnh phải có mặt mái');
    const edited: PascalScene = { ...scene, nodes: { ...scene.nodes, [segment.id]: { ...segment, roofHeight: 2.6 } as unknown as PascalNode } };
    const result = commandFor(graph, edited, [segment.id, roofNodeId]);

    if (!result.ok) throw new Error(result.error.reasons.join(' '));
    expect(result.data.changes).toHaveLength(1);
    expect(result.data.changes[0]?.after).toMatchObject({ source: 'human', reviewed: true });
    expect((result.data.changes[0]?.after as Roof).nodes[1]).toMatchObject({ roofHeight: 2.6 });
  });
});
