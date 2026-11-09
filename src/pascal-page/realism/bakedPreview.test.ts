import type * as ThreeModule from 'three';
import { Color, Group, Mesh, MeshStandardMaterial, Object3D, Texture } from 'three';
import { describe, expect, it, vi } from 'vitest';

import { SCENE_PALETTE } from '@/lib/pascal/scenePalette';

import { bakedDirFrom, bakedMaterial, hideBakedPreview, showBakedPreview, syncBakedPreview } from './bakedPreview';

vi.mock('three/examples/jsm/loaders/GLTFLoader.js', () => ({
  GLTFLoader: class {
    async loadAsync() {
      const scene = new Group();
      const wall = new Mesh(undefined, new MeshStandardMaterial());
      wall.userData['lightmap'] = true;
      scene.add(wall);
      return { scene };
    }
  },
}));

vi.mock('three', async (importOriginal) => {
  const actual = await importOriginal<typeof ThreeModule>();
  return { ...actual, TextureLoader: class { async loadAsync() { return new actual.Texture(); } } };
});

describe('xem thử ánh sáng nướng', () => {
  it('chỉ nhận thư mục cùng origin; bỏ gạch chéo cuối', () => {
    expect(bakedDirFrom('?probe=1&baked=/__baked/f1/')).toBe('/__baked/f1');
    // Công cụ dev: thiếu ?probe=1 thì bỏ qua (production không mở cảnh nướng qua URL).
    expect(bakedDirFrom('?baked=/__baked/f1/')).toBeNull();
    expect(bakedDirFrom('?project=P-1')).toBeNull();
    expect(bakedDirFrom('?probe=1&baked=https://x.test/a')).toBeNull();
    expect(bakedDirFrom('?probe=1&baked=//x.test/a')).toBeNull();
    expect(bakedDirFrom('?probe=1&baked=/a/../b')).toBeNull();
  });

  it('vật liệu nướng giữ màu, ảnh, mặt; gắn lightmap với cường độ của manifest', () => {
    const map = new Texture();
    const lightMap = new Texture();
    const source = new MeshStandardMaterial({ color: new Color(SCENE_PALETTE.floorOak), map });
    const out = bakedMaterial(source, lightMap, { lightmap: 'lightmap.png', intensity: 6, channel: 1 });
    expect(out.color.getHexString()).toBe(source.color.getHexString());
    expect(out.map).toBe(map);
    expect(out.lightMap).toBe(lightMap);
    expect(out.lightMapIntensity).toBe(6);
    expect(out.side).toBe(source.side);
  });

  it('nạp từ ba URL blob: gắn cảnh nướng, ẩn tầng sống; tắt thì gỡ và hiện lại', async () => {
    const scene = new Object3D();
    const level = new Object3D();
    const registry = { nodes: { get: (id: string) => (id === 'L1' ? level : undefined) }, byType: { level: new Set(['L1']) } };
    await showBakedPreview({ glbUrl: 'blob:a', lightmapUrl: 'blob:b', manifest: { lightmap: 'lightmap.png', intensity: 2, channel: 1 } });
    syncBakedPreview(scene, registry);
    const baked = scene.getObjectByName('baked-preview');
    expect(baked).toBeDefined();
    expect(level.visible).toBe(false);
    hideBakedPreview();
    expect(scene.getObjectByName('baked-preview')).toBeUndefined();
    expect(level.visible).toBe(true);
  });
});
