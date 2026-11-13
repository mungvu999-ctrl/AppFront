/**
 * Vòng 18 (L3) — dựng cảnh món bộ chọn DỜI CHỖ (`roomSetMoveOf`) và món "chưa bố trí được" (`roomSetUnplaced`):
 * mở không ghi, idempotent, người dùng kéo → lưu đúng chỗ đang thấy (kể cả áp lưng cỡ thật), đồ xác nhận không dời,
 * trang trí đi theo, khung hộp gốc + mục sổ cho món unplaced. Sổ bộ chọn (L2) giả bằng vi.mock.
 */
import { describe, expect, it, vi } from 'vitest';

import { normalizeSpatial } from '@/domain/spatial/normalize';
import type { Furniture, Point, Room, SpatialGraph, Wall } from '@/domain/spatial/types';

import { createPascalEditCommand } from '../fromPascal';
import { standardSceneOf } from '../sceneStandard';
import { sceneStyleOf } from '../sceneStyles';
import type { LayerStyle } from '../sceneVariety';
import { UNPLACED_OUTLINE_PREFIX } from '../toPascal';
import type { PascalItemNode, PascalScene } from '../types';

interface Pose { cx: number; cy: number; rot: number; shiftM: number; turnDeg: number }
const BED = 'F-0000000BED18';
const SOFA = 'F-00000SOFA18';
const HUMAN_BED = 'F-00000HBED18';
const LOST = 'F-00000LOST18';
const S = vi.hoisted(() => ({ moves: new Map<string, { to: Pose; modelId: string }>(), unplaced: [] as { id: string; reason: string }[], realSofa: false }));
const SOFA_ID = 'F-00000SOFA18';

vi.mock('../sceneVariety', async (importOriginal) => {
  const real = await importOriginal<Record<string, unknown> & { roomSetUniformOf: (id: string, folder: string) => boolean | 'real' }>();
  return {
    ...real,
    roomSetMoveOf: (id: string) => {
      const m = S.moves.get(id);
      return m === undefined
        ? undefined
        : { id, modelId: m.modelId, from: { cx: 0, cy: 0, w: 1, d: 1, rotationDeg: 0 }, to: m.to, members: [], cluster: [id], broken: [], why: 'Dời 0,50 m để mẫu cỡ thật không cắt tường', tried: { models: 1, poses: 1, bfs: 0 } };
    },
    roomSetUnplaced: () => S.unplaced.map((u) => ({ ...u, roomId: ROOM, role: 'closet', box: { cx: 0, cy: 0, w: 1, d: 1, rotationDeg: 0 }, tried: { models: 1, poses: 1, bfs: 0 } })),
    roomSetUniformOf: (id: string, folder: string) => (S.realSofa && id === SOFA_ID ? 'real' : real.roomSetUniformOf(id, folder)),
  };
});

const HUMAN = { source: 'human', reviewed: true, confidence: 1 } as const;
const AI = { source: 'ai', reviewed: false, confidence: 0.8 } as const;
const ROOM = 'R-000000LAY18';
const LVL = 'L-000000LAY18';
const outline: Point[] = [
  { x: 0, y: 0 },
  { x: 5000, y: 0 },
  { x: 5000, y: 4000 },
  { x: 0, y: 4000 },
];
const item = (id: string, kind: string, cx: number, cy: number, w: number, d: number, extra: Partial<Furniture> = {}): Furniture =>
  ({ ...AI, id, levelId: LVL, roomId: ROOM, kind, centre: { x: cx, y: cy }, boundingBox: { min: { x: cx - w / 2, y: cy - d / 2 }, max: { x: cx + w / 2, y: cy + d / 2 } }, rotationDeg: 0, ...extra }) as unknown as Furniture;
const bedroom = (furniture: Furniture[]): SpatialGraph =>
  ({
    building: { ...HUMAN, name: 'b', datumElevationMm: 0 },
    levels: [{ ...HUMAN, id: LVL, name: 'T1', order: 0, elevationMm: 0, heightMm: 3000 }],
    walls: outline.map(
      (start, i) =>
        ({ ...HUMAN, id: `W-0000LAY18${i}`, levelId: LVL, centreline: { start, end: outline[(i + 1) % 4] as Point }, thicknessMm: 200, heightMm: 2700, kind: 'envelope', openingIds: [] }) as Wall,
    ),
    openings: [],
    rooms: [{ ...HUMAN, id: ROOM, levelId: LVL, name: 'Phòng', usage: 'bedroom', outline, areaM2: 20, wallIds: [] } as Room],
    furniture,
    axes: [],
    dimensions: [],
    notes: [],
  }) as unknown as SpatialGraph;

const style: LayerStyle = { ...sceneStyleOf(undefined), roomSet: false, layout: new Set() };
const built = (graph: SpatialGraph) => standardSceneOf(graph, { style });
const sceneOf = (graph: SpatialGraph): PascalScene => built(graph).scene;
interface Change { readonly kind: string; readonly before?: unknown; readonly after?: unknown }
const commit = (graph: SpatialGraph, scene: PascalScene, changed: readonly string[]): readonly Change[] => {
  const result = createPascalEditCommand({ graph: normalizeSpatial(graph), scene, commit: { origin: 'local', changedNodeIds: [...changed] }, actorId: 'U-1', idBook: new Map() });
  // "Không có gì để ghi" = lượt về không thấy món nào đổi.
  if (!result.ok && result.error.reasons.some((r) => r.includes('không có gì để ghi'))) return [];
  if (!result.ok) throw new Error(result.error.reasons.join(' '));
  return result.data.changes as readonly Change[];
};
const fieldsOf = (n: PascalItemNode) => n.metadata?.appfront?.fields as Record<string, unknown>;
const withMoves = <T>(moves: [string, Pose, string?][], run: () => T, unplaced: { id: string; reason: string }[] = []): T => {
  S.moves = new Map(moves.map(([id, to, modelId]) => [id, { to, modelId: modelId ?? 'none' }]));
  S.unplaced = unplaced;
  try {
    return run();
  } finally {
    S.moves = new Map();
    S.unplaced = [];
    S.realSofa = false;
  }
};
const POSE: Pose = { cx: 1.2, cy: 1.4, rot: 90, shiftM: 1.36, turnDeg: 90 };

describe('L3 vòng 18: món dời chỗ', () => {
  it('áp tư thế vào node + REPAIR `layout` + prov.layout; hộp metadata khớp node → mở không ghi', () => {
    const graph = bedroom([item(BED, 'bed', 2500, 2000, 1600, 2000)]);
    withMoves([[BED, POSE]], () => {
      const { scene, layer } = built(graph);
      const bed = scene.nodes[`item_${BED}`] as PascalItemNode;
      expect(bed.position[0]).toBeCloseTo(1.2, 3);
      expect(bed.position[2]).toBeCloseTo(1.4, 3);
      const f = fieldsOf(bed);
      const box = f['boundingBox'] as { min: Point; max: Point };
      expect((box.min.x + box.max.x) / 2).toBeCloseTo(1200, 0);
      expect((box.min.y + box.max.y) / 2).toBeCloseTo(1400, 0);
      expect(f['rotationDeg']).toBe(90);
      expect(f['repair']).toMatchObject({ furnitureId: BED, action: 'moved', rule: 'layout', reasonVi: expect.stringContaining('Dời'), before: { centre: { x: 2500, y: 2000 } } });
      expect(f['prov']).toMatchObject({ layout: { rule: 'layout' } });
      expect(layer.layout?.map((r) => r.furnitureId)).toEqual([BED]);
      expect(layer.version).toBe(3);
      // Mở dự án: không node nào bị đụng → không có thay đổi nào; node dời không bị coi là "đã sửa" khi lượt về đọc lại.
      expect(commit(graph, scene, [])).toEqual([]);
      // Idempotent: dựng lần hai cùng dữ liệu → cùng node.
      expect(JSON.stringify(sceneOf(graph).nodes[bed.id])).toBe(JSON.stringify(bed));
    });
  });

  it('người dùng kéo món đã dời → lưu đúng chỗ đang thấy', () => {
    const graph = bedroom([item(BED, 'bed', 2500, 2000, 1600, 2000)]);
    withMoves([[BED, POSE]], () => {
      const scene = sceneOf(graph);
      const bed = scene.nodes[`item_${BED}`] as PascalItemNode;
      const dragged = { ...bed, position: [bed.position[0] + 0.3, bed.position[1], bed.position[2]] } as PascalItemNode;
      const changes = commit(graph, { ...scene, nodes: { ...scene.nodes, [bed.id]: dragged } }, [bed.id]);
      const after = changes.find((c) => (c.after as Furniture | null)?.id === BED)?.after as Furniture;
      expect(after.centre.x).toBeCloseTo(1500, 0);
      expect(after.centre.y).toBeCloseTo(1400, 0);
      expect(after.rotationDeg).toBe(90);
    });
  });

  it('món CỠ THẬT áp lưng tường: mẫu đứng đúng tư thế, kéo → lưu tâm đang thấy (REAL_BACK_SHIFT)', () => {
    const sofa = item(SOFA, 'other', 2500, 2000, 1400, 400, { variant: 'sofa' } as Partial<Furniture>);
    const graph = bedroom([sofa]);
    const pose: Pose = { cx: 2.0, cy: 3.4, rot: 180, shiftM: 1.4, turnDeg: 180 };
    S.realSofa = true;
    withMoves([[SOFA, pose, 'sofa']], () => {
      const scene = sceneOf(graph);
      const node = scene.nodes[`item_${SOFA}`] as PascalItemNode;
      const back = fieldsOf(node)['realBackShiftM'] as number;
      expect(Math.abs(back)).toBeGreaterThan(0.005);
      // Tâm mặt bằng cỡ thật (đúng phép lượt về: vị trí + áp lưng theo yaw) nằm đúng tư thế bộ chọn.
      const yaw = node.rotation[1];
      expect(Math.abs(node.position[0] + back * Math.sin(yaw) - 2.0) * 1000).toBeLessThanOrEqual(1);
      expect(Math.abs(node.position[2] + back * Math.cos(yaw) - 3.4) * 1000).toBeLessThanOrEqual(1);
      expect(commit(graph, scene, [])).toEqual([]);
      const dragged = { ...node, position: [node.position[0] - 0.2, node.position[1], node.position[2]] } as PascalItemNode;
      const before: [number, number] = [dragged.position[0] + back * Math.sin(yaw), dragged.position[2] + back * Math.cos(yaw)];
      const changes = commit(graph, { ...scene, nodes: { ...scene.nodes, [node.id]: dragged } }, [node.id]);
      const after = changes.find((c) => (c.after as Furniture | null)?.id === SOFA)?.after as Furniture;
      expect(Math.abs(after.centre.x / 1000 - before[0]) * 1000).toBeLessThanOrEqual(1);
      expect(Math.abs(after.centre.y / 1000 - before[1]) * 1000).toBeLessThanOrEqual(1);
    });
  });

  it('đồ đã xác nhận / ghim mẫu không bao giờ có REPAIR `layout` kể cả khi sổ trả tư thế', () => {
    const human = item(HUMAN_BED, 'bed', 2500, 2000, 1600, 2000, HUMAN);
    const pinned = item(BED, 'bed', 1000, 1000, 900, 2000, { model: { id: 'appfront-bed', src: '/items/bed/model.glb' } } as Partial<Furniture>);
    withMoves([[HUMAN_BED, POSE], [BED, POSE]], () => {
      const { scene, layer } = built(bedroom([human, pinned]));
      for (const id of [HUMAN_BED, BED]) {
        const n = scene.nodes[`item_${id}`] as PascalItemNode;
        expect((fieldsOf(n)['repair'] as { rule?: string } | undefined)?.rule).not.toBe('layout');
      }
      expect(layer.layout).toEqual([]);
    });
  });

  it('trang trí (chăn/gối) đi theo giường đã dời', () => {
    const graph = bedroom([item(BED, 'bed', 2500, 2000, 1600, 2000)]);
    const dressOf = (scene: PascalScene) =>
      Object.values(scene.nodes).filter((n): n is PascalItemNode => n.type === 'item' && n.id.startsWith('item_DRESS-') && n.id.includes(BED));
    const base = dressOf(sceneOf(graph));
    expect(base.length).toBeGreaterThan(0);
    const still: Pose = { cx: 1.5, cy: 1.6, rot: 0, shiftM: 1.08, turnDeg: 0 };
    withMoves([[BED, still]], () => {
      const moved = dressOf(sceneOf(graph));
      const common = moved.filter((n) => base.some((x) => x.id === n.id));
      expect(common.length).toBeGreaterThan(0);
      for (const n of common) {
        const b = base.find((x) => x.id === n.id) as PascalItemNode;
        expect(n.position[0] - b.position[0]).toBeCloseTo(-1.0, 2);
        expect(n.position[2] - b.position[2]).toBeCloseTo(-0.4, 2);
      }
    });
  });
});

describe('L3 vòng 18: món chưa bố trí được', () => {
  it('khung hộp gốc ẩn sẵn + mục sổ cho chip; không lưu gì', () => {
    const graph = bedroom([item(LOST, 'wardrobe', 2500, 3600, 1200, 600)]);
    withMoves([], () => {
      const { scene, layer } = built(graph);
      const outlineId = `item_${UNPLACED_OUTLINE_PREFIX}${LOST}`;
      const box = scene.nodes[outlineId] as PascalItemNode;
      expect(box).toBeDefined();
      expect(box.visible).toBe(false);
      expect(box.position[0]).toBeCloseTo(2.5, 3);
      expect(layer.unplaced).toEqual([{ furnitureId: LOST, label: expect.any(String), reason: 'Không tìm được chỗ: chạm tường (thử 3 mẫu, 40 tư thế)', outlineId }]);
      expect(commit(graph, scene, [])).toEqual([]);
      // Bật khung (chip "Xem hộp gốc") rồi lưu: khung là node dẫn xuất, không thành đồ thật.
      const shown = { ...scene, nodes: { ...scene.nodes, [outlineId]: { ...box, visible: true } } };
      expect(commit(graph, shown, [outlineId]).filter((c) => c.kind === 'furniture')).toEqual([]);
    }, [{ id: LOST, reason: 'Không tìm được chỗ: chạm tường (thử 3 mẫu, 40 tư thế)' }]);
  });
});
