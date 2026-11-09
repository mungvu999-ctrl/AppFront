/**
 * Sửa cảnh trong phiên, đầu cuối trên hàm thật (sessionRepairs → standardSceneOf → so cảnh → createPascalEditCommand),
 * như cầu nối làm: kéo món AI đã sửa thì lưu đúng chỗ thả và hết lý do sửa; Ctrl+Z sau lượt dựng lại không ghi vị trí
 * sửa tự động, không xoá món bị ẩn, không nhận nuôi đồ sinh; tải lại ra đúng cảnh lượt đầu.
 */

import { describe, expect, it } from 'vitest';

import { denormalizeSpatial, normalizeSpatial } from '@/domain/spatial/normalize';
import type { Furniture, Point, Room, SpatialGraph, Wall } from '@/domain/spatial/types';
import { createPascalEditCommand } from '@/lib/pascal/fromPascal';
import { REPAIR_FIELD, type SceneRepair } from '@/lib/pascal/sceneLayer';
import { createRepairSession, sessionRepairs, type RepairSession } from '@/lib/pascal/sceneRepair';
import { standardSceneOf } from '@/lib/pascal/sceneStandard';
import type { PascalItemNode, PascalNode, PascalScene } from '@/lib/pascal/types';
import { commitOfScenes, editedLooseNodeIds, suggestionEditOf } from '@/screens/viewer/PascalViewer/usePascalEdits';

import { createDerivedHistory, recordDerived, restoreDerived, touchedTargetFor, type DerivedHistory } from '../derivedHistory';

const HUMAN = { source: 'human', reviewed: true, confidence: 1 } as const;
const AI = { source: 'ai', reviewed: false, confidence: 0.8 } as const;
const outline: Point[] = [
  { x: 0, y: 0 },
  { x: 5000, y: 0 },
  { x: 5000, y: 4000 },
  { x: 0, y: 4000 },
];
const bedroom = { ...HUMAN, id: 'R-00000000ROOM', levelId: 'L-00000000LVL1', name: 'Phòng ngủ', usage: 'bedroom', outline, areaM2: 20, wallIds: [] } as Room;
const walls = outline.map(
  (start, i) =>
    ({
      ...HUMAN,
      id: `W-0000000WALL${i}`,
      levelId: 'L-00000000LVL1',
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
    levelId: 'L-00000000LVL1',
    roomId: 'R-00000000ROOM',
    kind,
    centre: { x, y },
    boundingBox: { min: { x: x - w / 2, y: y - d / 2 }, max: { x: x + w / 2, y: y + d / 2 } },
    rotationDeg: 0,
    ...extra,
  }) as Furniture;
const BED = 'F-0000000000BED';
const WC = 'F-00000000000WC';
const CHAIR = 'F-00000000CHAIR';
const stored0: SpatialGraph = {
  building: { ...HUMAN, name: 'b', datumElevationMm: 0 },
  levels: [{ ...HUMAN, id: 'L-00000000LVL1', name: 'T1', order: 0, elevationMm: 0, heightMm: 3000 }],
  walls,
  openings: [],
  rooms: [bedroom],
  furniture: [
    // Giường lòi tường trái → dời trong cảnh; bồn cầu trong phòng ngủ, không có WC → ẩn trong cảnh.
    piece(BED, 'bed', 1600, 2000, 300, 2000),
    piece(WC, 'sanitaryFixture', 400, 700, 3000, 3000, { variant: 'wc', rotationDeg: 0.01 } as Partial<Furniture>),
    piece(CHAIR, 'chair', 450, 450, 3500, 1000, { ...HUMAN, rotationDeg: 90 }),
  ],
  axes: [],
  dimensions: [],
  notes: [],
} as unknown as SpatialGraph;

/** Một "trang" thu nhỏ: kho (đồ thị đã lưu), phiên sửa cảnh, lịch sử dẫn xuất, mốc so — đúng các bước của cầu nối. */
class Page {
  stored: SpatialGraph = denormalizeSpatial(normalizeSpatial(stored0));
  session: RepairSession = createRepairSession();
  history: DerivedHistory = createDerivedHistory();
  enabled = true;
  base!: PascalScene;
  loaded!: PascalScene;
  repairs: readonly SceneRepair[] = [];
  snapshots: Parameters<typeof suggestionEditOf>[4] = new Map();

  build(): PascalScene {
    const { graph, repairs } = this.enabled ? sessionRepairs(this.session, this.stored) : { graph: this.stored, repairs: [] };
    this.repairs = repairs;
    return standardSceneOf(graph, { repairs: new Map(repairs.map((r) => [r.furnitureId, r])) }).scene;
  }

  /** onLoad / dựng lại: cảnh mới vào editor, thành mốc và bản dẫn xuất hiện hành. */
  load(): PascalScene {
    const scene = this.build();
    recordDerived(this.history, scene, this.repairs.filter((r) => r.action === 'hidden').map((r) => `item_${r.furnitureId}`));
    this.base = scene;
    this.loaded = scene;
    return scene;
  }

  /** onSave: gỡ node dẫn xuất cũ, dựng lệnh so với mốc, áp vào kho; dựng lại khi cần. Trả các thay đổi. */
  save(raw: PascalScene): { changes: { id: string; after?: Furniture; before?: Furniture }[]; restored: boolean; rebuilt: boolean } {
    const target = touchedTargetFor(this.session, () => this.stored, (g) => standardSceneOf(g, { repairs: new Map() }).scene);
    const { scene, restored } = restoreDerived(this.history, raw, target);
    const commit = commitOfScenes(this.base, scene) ?? { origin: 'local' as const, changedNodeIds: [] };
    const graph = normalizeSpatial(this.stored);
    // Tấm viền gợi ý: như `usePascalEdits` onSave, `suggestionEditOf` lo trước, phần còn lại qua lệnh thường.
    const suggestion = suggestionEditOf(graph, this.base, scene, commit.changedNodeIds, this.snapshots, 'U-1');
    const others = (ids: readonly string[]) => ids.filter((id) => !suggestion.handled.has(id));
    const result = createPascalEditCommand({
      graph,
      scene,
      commit: { ...commit, changedNodeIds: others(commit.changedNodeIds), removedNodeIds: others(commit.removedNodeIds ?? []) },
      adoptNodeIds: editedLooseNodeIds(this.loaded, scene),
      actorId: 'U-1',
    });
    const changes = [...(result.ok ? result.data.changes : []), ...suggestion.changes].map((c) => ({
      id: (c.after ?? c.before)?.id ?? '',
      after: (c.after ?? undefined) as Furniture | undefined,
      before: (c.before ?? undefined) as Furniture | undefined,
    }));
    if (!result.ok && result.error.code !== 'PASCAL_NO_CHANGE') throw new Error(result.error.reasons.join(' '));
    for (const c of changes) {
      if (c.before === undefined) throw new Error(`thêm thực thể (nhân đôi?): ${c.id}`);
      if (c.id.startsWith('R-')) {
        // `dressingOff` chỉ thêm món thật sự vắng khỏi cảnh đang lưu (người dùng xoá), không phải món dẫn xuất của lượt khác.
        const { dressingOff = [], ...rest } = c.after as unknown as Room;
        const { dressingOff: was = [], ...restBefore } = c.before as unknown as Room;
        expect(rest).toMatchObject({ ...restBefore, reviewed: (rest as Room).reviewed });
        for (const id of dressingOff.filter((d) => !was.includes(d))) expect(scene.nodes[`item_${id}`]).toBeUndefined();
        this.stored = { ...this.stored, rooms: this.stored.rooms.map((r) => (r.id === c.id ? (c.after as unknown as Room) : r)) };
        continue;
      }
      if (!c.id.startsWith('F-')) throw new Error(`thay đổi ngoài đồ: ${c.id}`);
      this.stored = {
        ...this.stored,
        furniture: c.after === undefined ? this.stored.furniture.filter((f) => f.id !== c.id) : this.stored.furniture.map((f) => (f.id === c.id ? c.after! : f)),
      };
    }
    this.base = scene;
    const stale = JSON.stringify(this.enabled ? sessionRepairs(this.session, this.stored).repairs : []) !== JSON.stringify(this.repairs);
    const rebuilt = restored || stale || suggestion.accepted;
    if (rebuilt) this.load();
    return { changes: changes.filter((c) => c.id.startsWith('F-')), restored, rebuilt };
  }
}

const moveNode = (scene: PascalScene, id: string, dx: number, dz: number): PascalScene => {
  const node = scene.nodes[id] as PascalItemNode;
  return { ...scene, nodes: { ...scene.nodes, [id]: { ...node, position: [node.position[0] + dx, node.position[1], node.position[2] + dz] } as PascalNode } };
};
const repairOf = (scene: PascalScene, id: string): unknown =>
  (scene.nodes[id]?.metadata as { appfront?: { fields?: Record<string, unknown> } } | undefined)?.appfront?.fields?.[REPAIR_FIELD];
/** Vị trí/góc mọi món đã lưu (dấu duyệt của món người vừa sửa rồi hoàn tác không về lại — đúng luật C2). */
const poses = (g: SpatialGraph) => g.furniture.map((f) => [f.id, f.centre, f.rotationDeg]);
const generatedCount = (scene: PascalScene): number => Object.keys(scene.nodes).filter((id) => id.includes('DRESS-') || id.includes('LIGHT-')).length;
const dropNode = (scene: PascalScene, id: string): PascalScene => {
  const nodes = { ...scene.nodes } as Record<string, PascalNode>;
  const parentId = nodes[id]?.parentId as string;
  const parent = nodes[parentId] as PascalNode & { children: string[] };
  nodes[parentId] = { ...parent, children: parent.children.filter((c) => c !== id) } as PascalNode;
  delete nodes[id];
  return { ...scene, nodes };
};

describe('sửa cảnh trong phiên (cầu nối)', () => {
  it('kéo món AI đã sửa: lưu đúng chỗ thả, chỉ món đó; lý do sửa biến mất; Ctrl+Z về dữ liệu gốc, không về vị trí sửa tự động', () => {
    const page = new Page();
    const loaded = page.load();
    expect(page.repairs.map((r) => [r.furnitureId, r.action])).toEqual([
      [WC, 'hidden'],
      [BED, 'moved'],
    ]);
    const bedLoaded = loaded.nodes[`item_${BED}`] as PascalItemNode;
    expect(repairOf(loaded, `item_${BED}`)).toBeDefined();

    // Kéo giường đã sửa thêm 0,5 m sang phải.
    const dragged = moveNode(loaded, `item_${BED}`, 0.5, 0);
    const drag = page.save(dragged);
    expect(drag.changes.map((c) => c.id)).toEqual([BED]);
    expect(drag.changes[0]?.after?.centre).toEqual({ x: Math.round((bedLoaded.position[0] + 0.5) * 1000), y: Math.round(bedLoaded.position[2] * 1000) });
    // Món đã đụng: hết trong danh sách sửa, node mới không mang lý do; bồn cầu vẫn ẩn, ghế không đổi.
    expect(drag.rebuilt).toBe(true);
    expect(page.repairs.map((r) => r.furnitureId)).toEqual([WC]);
    expect(repairOf(page.base, `item_${BED}`)).toBeUndefined();
    expect(page.stored.furniture.find((f) => f.id === CHAIR)).toEqual(stored0.furniture.find((f) => f.id === CHAIR));

    // Ctrl+Z: editor trả ảnh chụp lúc nạp (giường ở vị trí đã sửa cảnh, mang lý do) → ghi lại dữ liệu GỐC của giường.
    const undo = page.save(loaded);
    expect(undo.restored).toBe(true);
    expect(undo.changes.map((c) => c.id)).toEqual([BED]);
    expect(undo.changes[0]?.after?.centre).toEqual({ x: 300, y: 2000 });
    expect(page.stored.furniture.find((f) => f.id === WC)).toEqual(stored0.furniture.find((f) => f.id === WC));
    // Ctrl+Y: về đúng chỗ người dùng thả.
    const redo = page.save(dragged);
    expect(redo.changes.map((c) => c.id)).toEqual([BED]);
    expect(redo.changes[0]?.after?.centre).toEqual(drag.changes[0]?.after?.centre);
  });

  it('dời món khác (người) chặn món AI: sửa cảnh tính lại không cần tải lại; Ctrl+Z về cảnh cũ không ghi vị trí sửa', () => {
    const page = new Page();
    const loaded = page.load();
    const bedBefore = page.repairs.find((r) => r.furnitureId === BED);
    // Ghế (người) dời vào giữa phòng, sát chỗ giường đã được dời tới → giường phải sửa sang chỗ khác.
    const bed = loaded.nodes[`item_${BED}`] as PascalItemNode;
    const chair = loaded.nodes[`item_${CHAIR}`] as PascalItemNode;
    const moved = moveNode(loaded, `item_${CHAIR}`, bed.position[0] - chair.position[0], bed.position[2] - chair.position[2]);
    const step = page.save(moved);
    expect(step.changes.map((c) => c.id)).toEqual([CHAIR]);
    const bedAfter = page.repairs.find((r) => r.furnitureId === BED);
    expect(bedAfter?.after).not.toEqual(bedBefore?.after);
    expect(step.rebuilt).toBe(true);

    // Ctrl+Z: ảnh chụp lúc nạp (giường ở vị trí sửa CŨ). Chỉ ghế về chỗ cũ; giường (AI, chưa đụng) không bị ghi.
    const undo = page.save(loaded);
    expect(undo.changes.map((c) => c.id)).toEqual([CHAIR]);
    expect(poses(page.stored)).toEqual(poses(stored0));
    expect(page.repairs.find((r) => r.furnitureId === BED)?.after).toEqual(bedBefore?.after);
  });

  it('"Hiện dữ liệu gốc" bật/tắt rồi Ctrl+Z: không xoá món bị ẩn, không ghi gì; tải lại ra đúng cảnh lượt đầu', () => {
    const page = new Page();
    const loaded = page.load();
    const firstCount = generatedCount(loaded);
    // Một lượt sửa thật trước đó để có bước hoàn tác.
    const chairMoved = moveNode(loaded, `item_${CHAIR}`, 0.2, 0);
    page.save(chairMoved);
    // Tắt sửa cảnh: dựng lại (không bước hoàn tác) — bồn cầu hiện, giường về chỗ gốc.
    page.enabled = false;
    const raw = page.load();
    expect(raw.nodes[`item_${WC}`]).toBeDefined();
    // Ctrl+Z (ảnh chụp lúc nạp: không có bồn cầu, giường ở chỗ sửa) → chỉ ghế về; bồn cầu không bị xoá.
    const undo = page.save(loaded);
    expect(undo.restored).toBe(true);
    expect(undo.changes.map((c) => c.id)).toEqual([CHAIR]);
    expect(poses(page.stored)).toEqual(poses(stored0));
    // Bật lại rồi "tải lại trang": phiên mới, kho đọc lại từ máy chủ → cùng sửa cảnh, cùng node như lượt đầu đọc từ máy chủ
    // (không nhân đôi đồ sinh/đồ AI). Mốc so là lượt đầu trên chính kho gốc đi qua cùng đường đọc (chuẩn hoá ↔ phi chuẩn hoá).
    const fresh = (graph: SpatialGraph) => {
      const p = new Page();
      p.stored = denormalizeSpatial(normalizeSpatial(graph));
      return { scene: p.load(), repairs: p.repairs.map((r) => [r.furnitureId, r.action]) };
    };
    const first = fresh(stored0);
    const again = fresh(page.stored);
    expect(again.repairs).toEqual([
      [WC, 'hidden'],
      [BED, 'moved'],
    ]);
    expect(again.repairs).toEqual(first.repairs);
    expect(Object.keys(again.scene.nodes).sort()).toEqual(Object.keys(first.scene.nodes).sort());
    expect(generatedCount(again.scene)).toBe(generatedCount(first.scene));
    expect(firstCount).toBeGreaterThan(0);
  });

  it('nhận gợi ý (kéo tấm viền) → dựng lại → Ctrl+Z: trả bản ghi gợi ý, không xoá món trên máy chủ', () => {
    const SUGG = 'F-000000000SUGG';
    const page = new Page();
    page.stored = denormalizeSpatial(
      normalizeSpatial({ ...stored0, furniture: [...stored0.furniture, piece(SUGG, 'chair', 450, 450, 2500, 1000, { suggested: true })] }),
    );
    const loaded = page.load();
    const outlineId = `item_DRESS-suggested-${SUGG}`;
    expect(loaded.nodes[outlineId]).toBeDefined();
    expect(loaded.nodes[`item_${SUGG}`]).toBeUndefined();

    const accept = page.save(moveNode(loaded, outlineId, 0.3, 0));
    expect(accept.rebuilt).toBe(true);
    expect(page.stored.furniture.find((f) => f.id === SUGG)?.suggested).not.toBe(true);
    expect(page.base.nodes[`item_${SUGG}`]).toBeDefined();
    expect(page.base.nodes[outlineId]).toBeUndefined();

    // Ctrl+Z: ảnh chụp lúc nạp (có tấm viền, không có món thật) → về gợi ý như cũ, không có lệnh xoá.
    const undo = page.save(loaded);
    expect(undo.changes.filter((c) => c.after === undefined)).toEqual([]);
    expect(undo.changes.map((c) => c.id)).toEqual([SUGG]);
    expect(page.stored.furniture.find((f) => f.id === SUGG)).toMatchObject({ suggested: true, centre: { x: 2500, y: 1000 } });
  });

  it('xoá đồ sinh, lượt sửa khác làm dựng lại, Ctrl+Z lượt sau: món đã xoá không hiện lại; Ctrl+Z tiếp: món về', () => {
    const page = new Page();
    const loaded = page.load();
    const dress = 'DRESS-plant-R-00000000ROOM-1';
    expect(loaded.nodes[`item_${dress}`]).toBeDefined();
    const s1 = dropNode(loaded, `item_${dress}`);
    expect(page.save(s1).rebuilt).toBe(false);
    expect(page.stored.rooms[0]?.dressingOff).toEqual([dress]);

    // Ghế (người) dời vào chỗ giường AI đã được dời tới → sửa cảnh đổi → dựng lại.
    const bed = s1.nodes[`item_${BED}`] as PascalItemNode;
    const chair = s1.nodes[`item_${CHAIR}`] as PascalItemNode;
    const s2 = moveNode(s1, `item_${CHAIR}`, bed.position[0] - chair.position[0], bed.position[2] - chair.position[2]);
    expect(page.save(s2).rebuilt).toBe(true);

    // Ctrl+Z chỉ lượt dời ghế: lượt xoá vẫn đứng.
    const undoChair = page.save(s1);
    expect(undoChair.restored).toBe(true);
    expect(page.stored.rooms[0]?.dressingOff).toEqual([dress]);
    expect(page.base.nodes[`item_${dress}`]).toBeUndefined();

    // Ctrl+Z tiếp (ảnh chụp lúc nạp, còn món ấy) = hoàn tác chính lượt xoá: món về.
    page.save(loaded);
    expect(page.stored.rooms[0]?.dressingOff ?? []).toEqual([]);
    expect(page.base.nodes[`item_${dress}`]).toBeDefined();
  });
});
