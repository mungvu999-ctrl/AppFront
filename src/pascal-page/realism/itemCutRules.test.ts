import { BoxGeometry, Group, type Material, Mesh, MeshStandardMaterial, type Object3D } from 'three';
import { NodeMaterial } from 'three/webgpu';
import { describe, expect, it } from 'vitest';

import { capItemMeshesForCut, cutCapVariant, cutWholeVariant, type CutItemNode, itemCutReport, markShadowWhole, syncLowCut } from './cutSync';

/** Nhóm tầng như cutSync dựng (ClippingGroup), đặt ở cao độ `y`. */
function level(y = 0, clip = true): Group {
  const g = new Group() as Group & { isClippingGroup?: boolean };
  if (clip) g.isClippingGroup = true;
  g.position.y = y;
  return g;
}

/** Mesh hộp w×h×d, đáy ở `y` (so với cha). */
function box(parent: Object3D, mat: Material, h: number, y = 0, w = 0.6, d = 0.6): Mesh {
  const mesh = new Mesh(new BoxGeometry(w, h, d).translate(0, h / 2, 0), mat);
  mesh.position.y = y;
  parent.add(mesh);
  return mesh;
}

const node = (id: string, dims: [number, number, number], extra: Partial<CutItemNode> = {}): CutItemNode => ({ id, asset: { dimensions: dims }, ...extra });

type Depth = Material & { setupClipping?: () => unknown; setupHardwareClipping?: (b: { hardwareClipping: boolean }) => void };
type ShadowMesh = Mesh & { onBeforeShadow: (...a: unknown[]) => void; onAfterShadow: (...a: unknown[]) => void };

describe('luật cắt đồ theo node/hình học (vòng 10)', () => {
  it('đồ đứng sàn cao: nguyên khối + bóng nguyên khối (vật liệu bóng nhận tạm hai hàm bỏ cắt, gỡ sau)', () => {
    const wood = new MeshStandardMaterial();
    const mesh = box(level(), wood, 2.1) as ShadowMesh;
    capItemMeshesForCut([mesh], '/items/a/model.glb', node('item_wardrobe', [1, 2.1, 0.6]));
    expect(mesh.material).toBe(cutWholeVariant(wood));
    expect(itemCutReport()['item_wardrobe']).toMatchObject({ kind: 'whole', reason: 'floor', whole: 1, capped: 0 });
    const depth = new NodeMaterial() as unknown as Depth;
    const before = depth.version;
    mesh.onBeforeShadow(null, mesh, null, null, mesh.geometry, depth, null);
    expect(depth.setupClipping?.()).toBeNull();
    const b = { hardwareClipping: true };
    depth.setupHardwareClipping?.(b);
    expect(b.hardwareClipping).toBe(false);
    // Khoá dựng của three duyệt Object.keys → bản dựng bóng riêng cho mesh nguyên khối.
    expect(Object.keys(depth)).toContain('setupClipping');
    mesh.onAfterShadow(null, mesh, null, null, mesh.geometry, depth, null);
    expect(Object.hasOwn(depth, 'setupClipping')).toBe(false);
    expect(Object.hasOwn(depth, 'setupHardwareClipping')).toBe(false);
    // Lần đầu gặp vật liệu bóng: so lại khoá một lần.
    expect(depth.version).toBeGreaterThan(before);
  });

  it('mesh đổi loại (nhấc lên): thôi bỏ cắt trong lượt bóng, vật liệu bóng được so lại khoá', () => {
    const wood = new MeshStandardMaterial();
    const mesh = box(level(), wood, 2.1) as ShadowMesh;
    capItemMeshesForCut([mesh], null, node('item_lift', [0.6, 2.1, 0.6]));
    const depth = new NodeMaterial() as unknown as Depth;
    mesh.onBeforeShadow(null, mesh, null, null, mesh.geometry, depth, null);
    mesh.onAfterShadow(null, mesh, null, null, mesh.geometry, depth, null);
    const v = depth.version;
    mesh.position.y = 0.4;
    mesh.material = wood;
    capItemMeshesForCut([mesh], null, node('item_lift', [0.6, 2.1, 0.6]));
    expect(mesh.material).toBe(cutCapVariant(wood));
    expect(itemCutReport()['item_lift']).toMatchObject({ kind: 'capped', reason: 'hung' });
    mesh.onBeforeShadow(null, mesh, null, null, mesh.geometry, depth, null);
    expect(Object.hasOwn(depth, 'setupClipping')).toBe(false);
    expect(depth.version).toBeGreaterThan(v);
    // Hạ xuống lại: nguyên khối.
    mesh.position.y = 0;
    mesh.material = wood;
    capItemMeshesForCut([mesh], null, node('item_lift', [0.6, 2.1, 0.6]));
    expect(mesh.material).toBe(cutWholeVariant(wood));
  });

  it('mesh mới phân loại lần đầu không làm vật liệu bóng dựng lại', () => {
    const depth = new NodeMaterial() as unknown as Depth;
    const a = box(level(), new MeshStandardMaterial(), 2) as ShadowMesh;
    markShadowWhole(a, true);
    a.onBeforeShadow(null, a, null, null, a.geometry, depth, null);
    const v = depth.version;
    const b = box(level(), new MeshStandardMaterial(), 2) as ShadowMesh;
    markShadowWhole(b, true);
    b.onBeforeShadow(null, b, null, null, b.geometry, depth, null);
    expect(depth.version).toBe(v);
  });

  it('treo tường theo node (kệ, tủ treo, điều hoà, tranh) và món treo: cắt + nắp, kể cả khi chạm sàn', () => {
    const lv = level();
    const cases: [string, CutItemNode, number, number][] = [
      ['shelf', node('item_shelf', [2.2, 0.9, 0.5], { asset: { attachTo: 'wall-side', dimensions: [2.2, 0.9, 0.5] } }), 0.6, 1.5],
      ['ac', node('item_ac', [0.9, 0.3, 0.2], { asset: { attachTo: 'wall', dimensions: [0.9, 0.3, 0.2] } }), 0.3, 2.2],
      ['mirror', node('item_mirror', [0.5, 1.7, 0.05], { wallId: 'wall_1' }), 1.7, 0],
      ['picture', node('item_pic', [1.4, 0.8, 0.06]), 0.8, 0.8],
    ];
    for (const [, n, h, y] of cases) {
      const mat = new MeshStandardMaterial();
      const mesh = box(lv, mat, h, y);
      capItemMeshesForCut([mesh], null, n);
      expect(mesh.material).toBe(cutCapVariant(mat));
    }
    expect(itemCutReport()['item_shelf']?.reason).toBe('wall-attached');
    expect(itemCutReport()['item_mirror']?.reason).toBe('wall-attached');
    expect(itemCutReport()['item_pic']?.reason).toBe('hung');
  });

  it('tấm mỏng đứng sàn (rèm) cắt cùng tường theo kích thước node, không theo tên; xoay/scale không đều/âm vẫn đúng', () => {
    const cloth = new MeshStandardMaterial();
    const curtain = box(level(), cloth, 2.27, 0, 0.8, 0.1);
    curtain.rotation.y = Math.PI / 4;
    capItemMeshesForCut([curtain], '/items/whatever/model.glb', node('item_c', [0.8, 2.272, 0.102]));
    expect(curtain.material).toBe(cutCapVariant(cloth));
    expect(itemCutReport()['item_c']?.reason).toBe('thin-panel');
    // Cùng mẫu scale z ×4 (dày 0,41 m) → không còn là tấm → nguyên khối; scale âm tính theo trị tuyệt đối.
    curtain.material = cloth;
    capItemMeshesForCut([curtain], null, node('item_c', [0.8, 2.272, 0.102], { scale: [1, 1, -4] }));
    expect(curtain.material).toBe(cutWholeVariant(cloth));
    // Thiếu node: đo từ hộp bao thế giới.
    const panel = box(level(), cloth, 2.0, 0, 1.2, 0.08);
    capItemMeshesForCut([panel]);
    expect(panel.material).toBe(cutCapVariant(cloth));
    const shelf = box(level(), cloth, 2.0, 0, 0.9, 0.35);
    capItemMeshesForCut([shelf]);
    expect(shelf.material).toBe(cutWholeVariant(cloth));
  });

  it('tủ bếp liền một GLB: tủ dưới + nóc nguyên, tủ trên lơ lửng (đáy > 1,0 m, có khe) cắt; không mesh nào bị xẻ nửa trong món nguyên', () => {
    const lv = level();
    const item = new Group();
    lv.add(item);
    const wood = new MeshStandardMaterial();
    const base = box(item, wood, 0.9);
    const tallUnit = box(item, wood, 0.9, 0, 0.6, 0.6); // thấp, chỉ để có nhiều mesh
    const upper = box(item, wood, 0.7, 1.45, 2, 0.35);
    capItemMeshesForCut([base, tallUnit, upper], null, node('item_kit', [2.4, 2.15, 0.6]));
    expect(base.material).toBe(wood);
    expect(upper.material).toBe(cutCapVariant(wood));
    expect(itemCutReport()['item_kit']).toMatchObject({ kind: 'capped', reason: 'floor+lifted:1', capped: 1, whole: 0 });
    // Có tủ đứng cao 2,2 m trong bộ: tủ trên tựa vào chồng ấy → cả bộ nguyên khối.
    const pantry = box(item, wood, 2.2);
    [base, tallUnit, upper, pantry].forEach((m) => (m.material = wood));
    capItemMeshesForCut([base, tallUnit, upper, pantry], null, node('item_kit', [3, 2.2, 0.6]));
    expect(upper.material).toBe(cutWholeVariant(wood));
    expect(pantry.material).toBe(cutWholeVariant(wood));
    // Tủ áo: thân 2,0 m + phào nóc tách mesh sát thân → nguyên; tủ cao + tủ trên tách khe xa → "floor+lifted".
    const body = box(item, wood, 2.0);
    const crown = box(item, wood, 0.1, 2.02);
    const hood = box(item, wood, 0.4, 2.5);
    capItemMeshesForCut([body, crown, hood], null, node('item_ward', [1, 2.9, 0.6]));
    expect(crown.material).toBe(cutWholeVariant(wood));
    expect(hood.material).toBe(cutCapVariant(wood));
    expect(itemCutReport()['item_ward']).toMatchObject({ kind: 'whole', reason: 'floor+lifted:1' });
  });

  it('tủ bếp hai món: tủ dưới đứng sàn giữ gốc (thấp), tủ trên gắn tường cắt cùng tường', () => {
    const lv = level();
    const wood = new MeshStandardMaterial();
    const lower = box(lv, wood, 0.9);
    const upper = box(lv, wood, 0.7, 1.45);
    capItemMeshesForCut([lower], null, node('item_low', [2, 0.9, 0.6]));
    capItemMeshesForCut([upper], null, node('item_up', [2, 0.7, 0.35], { asset: { attachTo: 'wall-side', dimensions: [2, 0.7, 0.35] } }));
    expect(lower.material).toBe(wood);
    expect(itemCutReport()['item_low']).toMatchObject({ kind: 'plain', reason: 'low' });
    expect(upper.material).toBe(cutCapVariant(wood));
  });

  it('tầng 2 (3,2 m) dựng TRƯỚC lần syncLowCut đầu: phân loại lại khi tầng thành nhóm cắt', () => {
    const lv = level(3.2, false);
    const wood = new MeshStandardMaterial();
    const mesh = box(lv, wood, 2.1);
    capItemMeshesForCut([mesh], null, node('item_l2', [1, 2.1, 0.6]));
    // Chưa biết sàn tầng → đáy 3,2 m → tạm coi là treo.
    expect(mesh.material).toBe(cutCapVariant(wood));
    const registry = { nodes: { get: (id: string) => (id === 'level_2' ? lv : undefined) }, byType: { level: new Set(['level_2']) } };
    syncLowCut(registry, 'cutaway');
    expect(mesh.material).toBe(cutWholeVariant(wood));
    expect(itemCutReport()['item_l2']).toMatchObject({ kind: 'whole', reason: 'floor' });
    expect(itemCutReport()['item_l2']?.bottom).toBeCloseTo(0, 6);
    syncLowCut(registry, 'up');
  });

  it('món đã được vendor gán lại vật liệu trước lần sync không bị phân loại lại đè lên', () => {
    const lv = level(3.2, false);
    const wood = new MeshStandardMaterial();
    const mesh = box(lv, wood, 2.1);
    capItemMeshesForCut([mesh], null, node('item_l2b', [1, 2.1, 0.6]));
    const other = new MeshStandardMaterial();
    mesh.material = other;
    syncLowCut({ nodes: { get: () => lv }, byType: { level: new Set(['x']) } }, 'up');
    expect(mesh.material).toBe(other);
  });
});
