import { BackSide, DoubleSide, FrontSide, MeshStandardMaterial } from 'three';
import { MeshStandardNodeMaterial } from 'three/webgpu';
import { describe, expect, it } from 'vitest';

import { capCutItemMaterial, syncLowCut } from './cutSync';
import { capTallItemMaterial } from './itemMaterials';

interface WithNodes {
  colorNode?: unknown;
  emissiveNode?: unknown;
}

describe('nắp cắt cho đồ cao (U62)', () => {
  it('đồ cao quá 1,0 m: vá một lần, hai mặt cố định; đổi chế độ không needsUpdate', () => {
    const mat = new MeshStandardMaterial();
    expect(capTallItemMaterial(mat, 2.1)).toBe(mat);
    expect(mat.side).toBe(DoubleSide);
    expect(mat.shadowSide).toBe(BackSide);
    const colorNode = (mat as WithNodes).colorNode;
    expect(colorNode).toBeTruthy();
    expect((mat as WithNodes).emissiveNode).toBeTruthy();
    const version = mat.version;
    syncLowCut({ nodes: { get: () => undefined }, byType: {} }, 'cutaway');
    syncLowCut({ nodes: { get: () => undefined }, byType: {} }, 'up');
    capCutItemMaterial(mat);
    expect(mat.version).toBe(version);
    expect((mat as WithNodes).colorNode).toBe(colorNode);
  });

  it('đồ thấp, trong suốt, vốn hai mặt: giữ nguyên', () => {
    const low = new MeshStandardMaterial();
    capTallItemMaterial(low, 0.75);
    expect(low.side).toBe(FrontSide);
    expect((low as WithNodes).colorNode).toBeUndefined();
    const glass = new MeshStandardNodeMaterial({ transparent: true });
    capCutItemMaterial(glass);
    expect(glass.side).toBe(FrontSide);
    const leaf = new MeshStandardMaterial({ side: DoubleSide });
    capCutItemMaterial(leaf);
    expect((leaf as WithNodes).colorNode).toBeUndefined();
  });

  it('bản clone của vật liệu đã vá (không chép colorNode) vẫn được vá', () => {
    const mat = capCutItemMaterial(new MeshStandardMaterial());
    const clone = mat.clone();
    expect((clone as WithNodes).colorNode).toBeUndefined();
    capCutItemMaterial(clone);
    expect((clone as WithNodes).colorNode).toBeTruthy();
    expect(clone.side).toBe(DoubleSide);
  });
});
