// @vitest-environment node -- như `roofs.test.ts`: không render React, chỉ dùng kho `useScene` của Pascal.
/**
 * Mái do máy chủ dựng (NHA-02). `roof_golden.json` là bản chép NGUYÊN VĂN từ
 * AppBack (`packages/vision/roofs/tests/data/roof_golden.json`): node `roof` + `roof-segment`
 * mà BE phát ra. Nạp vào Pascal bằng `setScene` thật rồi đọc ngược phải y nguyên — lệch một khoá
 * là mái AI bị đánh dấu "đã sửa" ngay lần mở đầu. BE đổi cách phát thì chép lại tệp này.
 */

import { getActiveRoofHeight, getRoofPlanBounds, useScene } from '@pascal-app/core';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { SpatialGraphDocumentSchema } from '@/api/schemas/spatialGraph';
import { normalizeSpatial } from '@/domain/spatial/normalize';
import {
  createSampleBuilding,
  sampleLevelId,
  sampleWallId,
} from '@/domain/spatial/__fixtures__/sampleBuilding';
import type { Roof, SpatialGraph } from '@/domain/spatial/types';
import { fixtureF1 } from '@/lib/pascal/__fixtures__';
import { floorDisplayTransformsOf } from '@/lib/pascal/floorAlignment';
import { createPascalEditCommand } from '@/lib/pascal/fromPascal';
import { toPascalScene } from '@/lib/pascal/toPascal';
import { toSpatialGraph } from '@/lib/pascal/toSpatial';
import type { PascalScene } from '@/lib/pascal/types';
import { setDetailsEnabled } from '@/pascal-page/realism/details';

import golden from './roof_golden.json';

type Blob = Record<string, unknown>;
type Vec3 = [number, number, number];
interface Segment extends Blob {
  position: Vec3;
  rotation: number;
  width: number;
  depth: number;
}

const ACTOR = 'U-1';
const doc = fixtureF1({ ext: true }).doc;
const levelId = SpatialGraphDocumentSchema.parse(doc).graph.levels[0]?.id ?? 'L-MISSING';

/** Mái trên dây như tác vụ ráp nhà của BE sẽ ghi: nguồn AI, chưa duyệt. */
const wireRoof = (nodes: readonly Blob[], level: string): Blob => ({
  id: String(nodes[0]?.id).replace(/^roof_/u, ''),
  levelId: level,
  nodes,
  confidence: 0.6,
  source: 'ai',
  reviewed: false,
});

/** F1-ext + đúng một mái của fixture vàng, qua schema dây. */
const graphWith = (nodes: readonly Blob[]): SpatialGraph =>
  SpatialGraphDocumentSchema.parse({
    ...doc,
    graph: { ...doc.graph, roofs: [wireRoof(nodes, levelId)] },
  }).graph;

/** Nạp cảnh vào kho Pascal thật (chạy `migrateNodes`) rồi trả cảnh đang sống. */
const loaded = (graph: SpatialGraph): PascalScene => {
  vi.stubGlobal('requestAnimationFrame', () => 0);
  vi.stubGlobal('cancelAnimationFrame', () => undefined);
  const built = toPascalScene(graph).scene;

  useScene.getState().setScene(built.nodes as never, built.rootNodeIds as never);

  return { ...built, nodes: useScene.getState().nodes } as unknown as PascalScene;
};

afterEach(() => {
  setDetailsEnabled(true);
  vi.unstubAllGlobals();
});

describe.each(golden)('mái BE dựng: $name', ({ nodes, outlineMm, ridgeHeightMm }) => {
  const [roofNode, ...segments] = nodes as unknown as [
    Blob & { position: Vec3; rotation: number },
    ...Segment[],
  ];

  it.each([true, false])(
    'nạp bằng setScene rồi đọc ngược: y nguyên, 0 lệnh (cờ details = %s)',
    (details) => {
      setDetailsEnabled(details);

      const graph = graphWith(nodes);
      const scene = loaded(graph);
      const result = createPascalEditCommand({
        graph: normalizeSpatial(graph),
        scene,
        commit: { origin: 'load', changedNodeIds: Object.keys(scene.nodes) },
        actorId: ACTOR,
      });

      expect(toSpatialGraph(scene).graph.roofs).toEqual(graph.roofs);
      expect(
        result.ok ? result.data.changes.filter((change) => change.kind === 'roof') : [],
      ).toEqual([]);
    },
  );

  it('chiều cao đỉnh BE tính khớp getActiveRoofHeight của Pascal', () => {
    expect(segments.map((segment) => getActiveRoofHeight(segment as never) * 1000)).toEqual(
      ridgeHeightMm.map((mm) => expect.closeTo(mm, 2)),
    );
  });

  it('khung bao mái trên mặt bằng khớp khung bao đường bao: (x, y) mm ↔ (x, z) m', () => {
    const bounds = getRoofPlanBounds({
      position: roofNode.position,
      rotation: roofNode.rotation,
      segments,
    });
    const xs = outlineMm.map(([x]) => x ?? 0);
    const ys = outlineMm.map(([, y]) => y ?? 0);

    expect(bounds).not.toBeNull();
    expect(
      [bounds?.minX, bounds?.minZ, bounds?.maxX, bounds?.maxZ].map((m) => (m ?? 0) * 1000),
    ).toEqual(
      [Math.min(...xs), Math.min(...ys), Math.max(...xs), Math.max(...ys)].map((mm) =>
        expect.closeTo(mm, 1),
      ),
    );
  });
});

interface P {
  x: number;
  y: number;
}
const XS = [0, 4000, 9000];
const YS = [0, 3000, 7000];
const wallOf = (level: string, start: P, end: P): Blob => ({
  levelId: level,
  centreline: { start, end },
  thicknessMm: 200,
  heightMm: 3000,
  kind: 'loadBearing',
  openingIds: [],
  reviewed: false,
});
/** Lưới tường như `floorAlignment.test.ts`; `place` đưa điểm lưới gốc về toạ độ đã lưu. */
const gridWalls = (level: string, place: (p: P) => P): Blob[] => {
  const lines: [P, P][] = [];

  for (const x of XS)
    for (let i = 0; i < YS.length - 1; i += 1)
      lines.push([
        { x, y: YS[i] ?? 0 },
        { x, y: YS[i + 1] ?? 0 },
      ]);
  for (const y of YS)
    for (let i = 0; i < XS.length - 1; i += 1)
      lines.push([
        { x: XS[i] ?? 0, y },
        { x: XS[i + 1] ?? 0, y },
      ]);

  return lines.map(([start, end]) => wallOf(level, place(start), place(end)));
};
/** Bốn tường quanh một hộp: không thành trục, tầng được dời theo tâm khung bao. */
const boxWalls = (level: string, x0: number, y0: number, x1: number, y1: number): Blob[] => {
  const corners: P[] = [
    { x: x0, y: y0 },
    { x: x1, y: y0 },
    { x: x1, y: y1 },
    { x: x0, y: y1 },
  ];

  return corners.map((start, i) => wallOf(level, start, corners[(i + 1) % 4] ?? start));
};
/** Mọi số tròn tới 1e-9 (nanomet, nano-radian) để so hai mái bỏ qua nhiễu số thực. */
const settled = (value: unknown): unknown =>
  JSON.parse(
    JSON.stringify(value, (_key, item: unknown) =>
      typeof item === 'number' ? Number(item.toFixed(9)) : item,
    ),
  );

const [lower, upper] = [sampleLevelId(0), sampleLevelId(1)];

describe.each([
  // Tầng trên lưu lệch: xoay 90° rồi dời (1000, 2000) mới khớp lưới tầng gốc.
  [
    'xoay 90°',
    [
      ...gridWalls(lower, (p) => p),
      ...gridWalls(upper, (q) => ({ x: q.y - 2000, y: -(q.x - 1000) })),
    ],
  ],
  ['chỉ dời', [...boxWalls(lower, 0, 0, 9000, 7000), ...boxWalls(upper, 5000, -3000, 9137, 1291)]],
])('mái BE dựng trên tầng được căn hiển thị: %s', (_label, walls) => {
  const nodes = golden.find((entry) => entry.name === 'rect_gable_turned')?.nodes ?? [];
  const graph = {
    ...createSampleBuilding(),
    levels: createSampleBuilding().levels.slice(0, 2),
    walls: walls.map((wall, i) => ({ ...wall, id: sampleWallId(i) })),
    openings: [],
    furniture: [],
    rooms: [],
    axes: [],
    roofs: [wireRoof(nodes, upper)],
  } as unknown as SpatialGraph;

  it('đọc ngược ra đúng mái đã lưu, sai khác dưới 1e-9', () => {
    expect(floorDisplayTransformsOf(graph).has(upper)).toBe(true);
    expect(settled(toSpatialGraph(loaded(graph)).graph.roofs)).toEqual(settled(graph.roofs));
  });

  // NO-579: `(x + t) - t` và `(r - π/2) + π/2` lệch một ulp; `floorAlignment.ts` cất vị trí + góc đã lưu trên node mái
  // nên mái AI trên tầng được căn không bị coi là đã sửa ngay lần mở đầu.
  it('đọc ngược ra y nguyên từng bit, nạp không sinh thay đổi mái nào', () => {
    const scene = loaded(graph);
    const result = createPascalEditCommand({
      graph: normalizeSpatial(graph),
      scene,
      commit: { origin: 'load', changedNodeIds: Object.keys(scene.nodes) },
      actorId: ACTOR,
    });

    expect(toSpatialGraph(scene).graph.roofs).toEqual(graph.roofs as readonly Roof[]);
    expect(
      result.ok ? result.data.changes.filter((change) => change.kind === 'roof') : [],
    ).toEqual([]);
  });

  it('dời mái trên tầng đã căn → đúng một thay đổi roof, toạ độ mới ở hệ đã lưu', () => {
    const scene = loaded(graph);
    const shown = Object.values(scene.nodes).find((node) => node.type === 'roof') as unknown as
      | (Blob & { id: string; position: Vec3 })
      | undefined;

    if (shown === undefined) throw new Error('cảnh phải có mái');

    const [dx, dz] = [1.25, -0.5];
    const [x, y, z] = shown.position;
    const edited = {
      ...scene,
      nodes: { ...scene.nodes, [shown.id]: { ...shown, position: [x + dx, y, z + dz] } },
    } as unknown as PascalScene;
    const result = createPascalEditCommand({
      graph: normalizeSpatial(graph),
      scene: edited,
      commit: { origin: 'local', changedNodeIds: [shown.id] },
      actorId: ACTOR,
    });

    if (!result.ok) throw new Error(result.error.reasons.join(' '));

    // Độ dời trên màn hình quay ngược góc căn của tầng thì ra độ dời ở hệ đã lưu.
    const rad = ((floorDisplayTransformsOf(graph).get(upper)?.rotationDeg ?? 0) * Math.PI) / 180;
    const [stored, ...segments] = nodes as unknown as [Blob & { position: Vec3; rotation: number }, ...Blob[]];
    const roofChanges = result.data.changes.filter((change) => change.kind === 'roof');
    const [after, ...afterSegments] = (roofChanges[0]?.after as Roof).nodes;

    expect(roofChanges).toHaveLength(1);
    expect(after?.position).toEqual([
      expect.closeTo(stored.position[0] + dx * Math.cos(rad) + dz * Math.sin(rad), 9),
      stored.position[1],
      expect.closeTo(stored.position[2] - dx * Math.sin(rad) + dz * Math.cos(rad), 9),
    ]);
    expect(after?.position).not.toEqual(stored.position);
    // Góc không bị đụng tới thì vẫn y nguyên từng bit, mặt mái cũng vậy.
    expect(after?.rotation).toBe(stored.rotation);
    expect(afterSegments).toEqual(segments);
  });
});
