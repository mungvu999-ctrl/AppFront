import { BackSide, BoxGeometry, DoubleSide, FrontSide, Group, type Material, Mesh, MeshStandardMaterial, Texture } from 'three';
import { MeshStandardNodeMaterial } from 'three/webgpu';
import { describe, expect, it } from 'vitest';

import { capItemMeshesForCut, cutCapVariant, cutWholeVariant, FLOOR_REST_M, meshBottomAboveLevel, meshTopAboveLevel, syncLowCut } from './cutSync';

interface WithNodes {
  colorNode?: unknown;
  emissiveNode?: unknown;
}

/** Nhóm tầng như cutSync dựng (ClippingGroup), đặt ở cao độ `y`. */
function level(y = 0): Group {
  const g = new Group() as Group & { isClippingGroup?: boolean };
  g.isClippingGroup = true;
  g.position.y = y;
  return g;
}

/** Một "món đồ": mesh hộp cao `h`, đáy ở `y`, dùng vật liệu `mat`. */
function item(parent: Group, mat: Material, h: number, y = 0): Mesh {
  const mesh = new Mesh(new BoxGeometry(0.6, h, 0.6).translate(0, h / 2, 0), mat);
  mesh.position.y = y;
  parent.add(mesh);
  return mesh;
}

/** Món TREO (đáy cách sàn 0,2 m > FLOOR_REST_M), đỉnh ở `top`: vẫn theo luật cắt + nắp. */
const hung = (parent: Group, mat: Material, top: number): Mesh => item(parent, mat, top - 0.2, 0.2);

describe('nắp cắt cho đồ cao (U62) — theo từng mesh, trạng thái thật', () => {
  it('hai món dùng chung vật liệu, một cao một thấp: chỉ món cao nhận biến thể; vật liệu gốc không bị vá', () => {
    const shared = new MeshStandardMaterial({ color: 0x886644 });
    const lv = level();
    const tall = hung(lv, shared, 2.1);
    const low = hung(lv, shared, 0.75);
    capItemMeshesForCut([tall, low]);
    expect(low.material).toBe(shared);
    expect(shared.side).toBe(FrontSide);
    expect((shared as WithNodes).colorNode).toBeUndefined();
    const variant = tall.material as MeshStandardMaterial;
    expect(variant).not.toBe(shared);
    expect(variant.side).toBe(DoubleSide);
    expect(variant.shadowSide).toBe(BackSide);
    expect((variant as WithNodes).colorNode).toBeTruthy();
    expect((variant as WithNodes).emissiveNode).toBeTruthy();
    // Cùng gốc → cùng biến thể (cache uuid|capped); màu dùng chung đối tượng (nhuộm vải trễ vẫn theo).
    expect(cutCapVariant(shared)).toBe(variant);
    expect(variant.color).toBe(shared.color);
    // Đổi chế độ cắt chỉ đổi uniform: biến thể không dựng lại.
    const version = variant.version;
    syncLowCut({ nodes: { get: () => undefined }, byType: {} }, 'cutaway');
    syncLowCut({ nodes: { get: () => undefined }, byType: {} }, 'up');
    expect(variant.version).toBe(version);
  });

  it('kéo đồ lên cao / đổi scale / xoay: renderer gán lại gốc rồi gọi lại → nắp theo trạng thái mới', () => {
    const shared = new MeshStandardMaterial();
    const lv = level();
    const mesh = hung(lv, shared, 0.75);
    capItemMeshesForCut([mesh]);
    expect(mesh.material).toBe(shared);
    mesh.position.y = 0.7; // nâng: đỉnh 1,25 m
    mesh.material = shared;
    capItemMeshesForCut([mesh]);
    expect(mesh.material).toBe(cutCapVariant(shared));
    mesh.position.y = 0.2;
    mesh.scale.y = 2; // 0,2 + 1,1 = 1,3 m
    mesh.material = shared;
    capItemMeshesForCut([mesh]);
    expect(mesh.material).toBe(cutCapVariant(shared));
    // Món cao 2,1 m nằm ngang (xoay 90°): hộp bao thế giới chỉ 0,6 m → thôi nắp.
    const lying = item(lv, shared, 2.1);
    lying.rotation.x = Math.PI / 2;
    lying.position.y = 0.3;
    capItemMeshesForCut([lying]);
    expect(lying.material).toBe(shared);
    // Scale âm (lật) vẫn đo đúng đỉnh.
    const flipped = item(lv, shared, 2.1);
    flipped.scale.y = -1;
    flipped.position.y = 2.1;
    expect(meshTopAboveLevel(flipped)).toBeCloseTo(2.1, 6);
  });

  it('đỉnh tính từ sàn tầng chứa món (tầng 2 ở 3,2 m): tủ thấp tầng trên không bị coi là cao', () => {
    const upper = level(3.2);
    const low = item(upper, new MeshStandardMaterial(), 0.8);
    expect(meshTopAboveLevel(low)).toBeCloseTo(0.8, 6);
    capItemMeshesForCut([low]);
    expect((low.material as Material).side).toBe(FrontSide);
  });

  it('mảng vật liệu: từng phần tử có biến thể riêng; trong suốt và vốn hai mặt giữ nguyên', () => {
    const wood = new MeshStandardMaterial();
    const glass = new MeshStandardNodeMaterial({ transparent: true });
    const leaf = new MeshStandardMaterial({ side: DoubleSide });
    const mesh = new Mesh(new BoxGeometry(1, 2, 1).translate(0, 1, 0), [wood, glass, leaf]);
    mesh.position.y = 0.2;
    level().add(mesh);
    capItemMeshesForCut([mesh]);
    const [w, g, l] = mesh.material as Material[];
    expect(w).toBe(cutCapVariant(wood));
    expect(g).toBe(glass);
    expect(l).toBe(leaf);
    expect((leaf as WithNodes).colorNode).toBeUndefined();
  });

  it('gốc còn chờ ảnh (texPending): biến thể chép map khi gốc báo xong, rồi tự báo texturesready', async () => {
    const base = new MeshStandardMaterial();
    base.userData.texPending = 1;
    const variant = cutCapVariant(base) as MeshStandardMaterial;
    expect(variant.userData.texPending).toBe(1);
    let ready = false;
    variant.addEventListener('texturesready' as never, () => (ready = true));
    const map = new Texture();
    base.map = map;
    delete base.userData.texPending;
    base.dispatchEvent({ type: 'texturesready' } as never);
    await Promise.resolve();
    await Promise.resolve();
    expect(variant.map).toBe(map);
    expect(variant.userData.texPending).toBeUndefined();
    expect(ready).toBe(true);
  });

  it('món ĐỨNG SÀN cao quá mặt cắt giữ nguyên khối: biến thể bỏ bước cắt, không nắp, không đổi mặt; món thấp giữ gốc', () => {
    const wood = new MeshStandardMaterial({ color: 0x886644 });
    const glass = new MeshStandardNodeMaterial({ transparent: true });
    const lv = level(3.2);
    const body = item(lv, wood, 2.1);
    const door = item(lv, glass, 1.9, 0.1);
    const foot = item(lv, wood, 0.1);
    expect(meshBottomAboveLevel(body)).toBeCloseTo(0, 6);
    expect(meshBottomAboveLevel(door)).toBeLessThanOrEqual(FLOOR_REST_M);
    capItemMeshesForCut([body, door, foot]);
    const whole = body.material as MeshStandardMaterial & { setupClipping(): unknown; setupHardwareClipping(b: { hardwareClipping: boolean }): void };
    expect(whole).toBe(cutWholeVariant(wood));
    expect(whole).not.toBe(cutCapVariant(wood));
    expect(whole.name.endsWith('|whole')).toBe(true);
    expect(whole.side).toBe(FrontSide);
    expect((whole as WithNodes).colorNode).toBeUndefined();
    expect(whole.color).toBe(wood.color);
    expect(whole.setupClipping()).toBeNull();
    const builder = { hardwareClipping: true };
    whole.setupHardwareClipping(builder);
    expect(builder.hardwareClipping).toBe(false);
    // Kính của cùng món cũng không bị xẻ; chân thấp dùng vật liệu gốc; gốc không bị vá.
    expect(door.material).toBe(cutWholeVariant(glass));
    expect(foot.material).toBe(wood);
    expect(Object.hasOwn(wood, 'setupClipping')).toBe(false);
  });

  it('món cao đứng sàn bị nhấc lên (treo): gọi lại → về luật cắt + nắp', () => {
    const wood = new MeshStandardMaterial();
    const mesh = item(level(), wood, 2.1);
    capItemMeshesForCut([mesh]);
    expect(mesh.material).toBe(cutWholeVariant(wood));
    mesh.position.y = 0.4;
    mesh.material = wood;
    capItemMeshesForCut([mesh]);
    expect(mesh.material).toBe(cutCapVariant(wood));
  });

  it('rèm đứng sàn cao tới trần vẫn cắt cùng tường (tấm mỏng theo kích thước node, không theo tên mẫu)', () => {
    const cloth = new MeshStandardMaterial();
    const mesh = item(level(), cloth, 2.6);
    capItemMeshesForCut([mesh], '/items/curtain/model.glb', { asset: { dimensions: [0.8, 2.272, 0.102] } });
    expect(mesh.material).toBe(cutCapVariant(cloth));
    mesh.material = cloth;
    capItemMeshesForCut([mesh], '/items/curtain/model.glb', { asset: { dimensions: [1, 2.1, 0.6] } });
    expect(mesh.material).toBe(cutWholeVariant(cloth));
  });
});
