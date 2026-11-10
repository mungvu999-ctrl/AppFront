/**
 * Sửa cảnh không rò về dữ liệu đã lưu: cảnh dựng từ đồ thị ĐÃ sửa (như `sceneFromStore`), kho giữ bản gốc; người dùng
 * dời một món khác rồi lưu thì lệnh chỉ có đúng món ấy — món AI đã dời/ẩn trong cảnh không bị ghi vị trí mới hay xoá.
 */

import { describe, expect, it } from 'vitest';

import { normalizeSpatial } from '@/domain/spatial/normalize';
import type { Furniture, Point, Room, SpatialGraph, Wall } from '@/domain/spatial/types';

import { diffScenes } from '../diff';
import { createPascalEditCommand } from '../fromPascal';
import { repairScene } from '../sceneRepair';
import { toPascalScene } from '../toPascal';
import type { PascalItemNode, PascalNode, PascalScene } from '../types';

const HUMAN = { source: 'human', reviewed: true, confidence: 1 } as const;
const AI = { source: 'ai', reviewed: false, confidence: 0.8 } as const;
const outline: Point[] = [
  { x: 0, y: 0 },
  { x: 5000, y: 0 },
  { x: 5000, y: 4000 },
  { x: 0, y: 4000 },
];
const bedroom = { ...HUMAN, id: 'R-1', levelId: 'L-1', name: 'Phòng ngủ', usage: 'bedroom', outline, areaM2: 20, wallIds: [] } as Room;
const walls = outline.map(
  (start, i) =>
    ({
      ...HUMAN,
      id: `W-${i}`,
      levelId: 'L-1',
      centreline: { start, end: outline[(i + 1) % 4] as Point },
      thicknessMm: 200,
      heightMm: 2700,
      kind: 'envelope',
      openingIds: [],
    }) as Wall,
);
const piece = (id: string, kind: Furniture['kind'], w: number, d: number, x: number, y: number, extra: Partial<Furniture> = {}) =>
  ({
    ...AI,
    id,
    levelId: 'L-1',
    roomId: 'R-1',
    kind,
    centre: { x, y },
    boundingBox: { min: { x: x - w / 2, y: y - d / 2 }, max: { x: x + w / 2, y: y + d / 2 } },
    rotationDeg: 0,
    ...extra,
  }) as Furniture;
const stored: SpatialGraph = {
  building: { ...HUMAN, name: 'b', datumElevationMm: 0 },
  levels: [{ ...HUMAN, id: 'L-1', name: 'T1', order: 0, elevationMm: 0, heightMm: 3000 }],
  walls,
  openings: [],
  rooms: [bedroom],
  furniture: [
    // Giường lòi ra ngoài tường trái → dời trong cảnh; bồn cầu trong phòng ngủ, không có WC → ẩn trong cảnh.
    piece('F-0000000000BED', 'bed', 1600, 2000, 300, 2000),
    piece('F-00000000000WC', 'sanitaryFixture', 400, 700, 3000, 3000, { variant: 'wc', rotationDeg: 0.01 } as Partial<Furniture>),
    piece('F-00000000CHAIR', 'chair', 450, 450, 3500, 1000, { ...HUMAN, rotationDeg: 90 }),
  ],
  axes: [],
  dimensions: [],
  notes: [],
} as unknown as SpatialGraph;

describe('sửa cảnh không rò về dữ liệu đã lưu', () => {
  it('dời món khác rồi lưu: lệnh chỉ có món đó', () => {
    const { graph, repairs } = repairScene(stored);
    expect(repairs.map((r) => [r.furnitureId, r.action])).toEqual([
      ['F-00000000000WC', 'hidden'],
      ['F-0000000000BED', 'moved'],
    ]);
    const loaded: PascalScene = toPascalScene(graph).scene;
    expect(loaded.nodes['item_F-00000000000WC']).toBeUndefined();
    const chair = loaded.nodes['item_F-00000000CHAIR'] as PascalItemNode;
    const next: PascalScene = {
      ...loaded,
      nodes: { ...loaded.nodes, 'item_F-00000000CHAIR': { ...chair, position: [chair.position[0] + 0.5, chair.position[1], chair.position[2]] } as PascalNode },
    };
    const changed = diffScenes(loaded, next).upsert.map((n) => n.id);
    expect(changed).toEqual(['item_F-00000000CHAIR']);

    const result = createPascalEditCommand({
      graph: normalizeSpatial(stored),
      scene: next,
      commit: { origin: 'local', changedNodeIds: changed },
      actorId: 'U-1',
    });
    if (!result.ok) throw new Error(result.error.reasons.join(' '));
    expect(result.data.changes.map((c) => c.after?.id ?? c.before?.id)).toEqual(['F-00000000CHAIR']);
    expect((result.data.changes[0]?.after as Furniture).centre).toEqual({ x: 4000, y: 1000 });
  });

  it('luật fit (vòng 6): món AI đã đổi cỡ/trục trong cảnh không bị ghi khi lưu món khác', () => {
    const graph0 = {
      ...stored,
      furniture: [
        piece('F-0000000CHAIR2', 'chair', 480, 300, 2500, 2000, { rotationDeg: 0.01 } as Partial<Furniture>),
        piece('F-00000000CHAIR', 'chair', 450, 450, 3500, 1000, { ...HUMAN, rotationDeg: 90 }),
      ],
    } as SpatialGraph;
    const { graph, repairs } = repairScene(graph0);
    expect(repairs.map((r) => [r.furnitureId, r.action, r.rule])).toEqual([['F-0000000CHAIR2', 'rescaled', 'fit']]);
    const loaded: PascalScene = toPascalScene(graph).scene;
    const chair = loaded.nodes['item_F-00000000CHAIR'] as PascalItemNode;
    const next: PascalScene = {
      ...loaded,
      nodes: { ...loaded.nodes, 'item_F-00000000CHAIR': { ...chair, position: [chair.position[0] + 0.5, chair.position[1], chair.position[2]] } as PascalNode },
    };
    const changed = diffScenes(loaded, next).upsert.map((n) => n.id);
    expect(changed).toEqual(['item_F-00000000CHAIR']);
    const result = createPascalEditCommand({
      graph: normalizeSpatial(graph0),
      scene: next,
      commit: { origin: 'local', changedNodeIds: changed },
      actorId: 'U-1',
    });
    if (!result.ok) throw new Error(result.error.reasons.join(' '));
    expect(result.data.changes.map((c) => c.after?.id ?? c.before?.id)).toEqual(['F-00000000CHAIR']);
  });
});
