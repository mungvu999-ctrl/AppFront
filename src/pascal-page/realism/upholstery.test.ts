import { describe, expect, it } from 'vitest';
import { Color, CompressedTexture, DataTexture, Group, Mesh, MeshPhysicalMaterial, MeshStandardMaterial, PlaneGeometry, Texture } from 'three';
import { UPHOLSTERY_PALETTE } from '@/lib/pascal/scenePalette';
import { clearItemMaterialCache, tuneItemMaterial } from './itemMaterials';
import { useRealism } from './store';
import {
  applyUpholstery,
  compensate,
  geometryArea,
  isGeneratedCurtainItem,
  MAX_GAIN,
  meanLinear,
  pickUpholstery,
  styleOfFabricRef,
  tagUpholstery,
  textureMean,
} from './upholstery';

const enableMaterials = () => useRealism.setState({ flags: { ...useRealism.getState().flags, materials: true } });

describe('upholstery thuần', () => {
  it('chọn vải lớn nhất được nhuộm, bỏ khung/chân và vải người chọn', () => {
    const areas = new Map([
      ['frame', { area: 9, tag: null }],
      ['seat', { area: 4, tag: { kind: 'fabric' as const, recolour: true } }],
      ['cushion', { area: 2, tag: { kind: 'fabric' as const, recolour: true } }],
      ['userPick', { area: 7, tag: { kind: 'fabric' as const, recolour: false } }],
      ['legs', { area: 5, tag: { kind: 'metal' as const, recolour: true } }],
    ]);
    expect(pickUpholstery(areas)).toBe('seat');
    expect(pickUpholstery(new Map([['frame', { area: 1, tag: null }]]))).toBeNull();
  });
  it('ref vải của phong cách → phong cách', () => {
    expect(styleOfFabricRef('library:fabric-linen')).toBe('am-ap');
    expect(styleOfFabricRef('library:leather-calf')).toBe('go-am');
    expect(styleOfFabricRef('library:fabric-silk')).toBeNull();
    expect(styleOfFabricRef(undefined)).toBeNull();
  });
  it('bù trung bình ảnh: màu × trung bình = đích, kẹp hệ số', () => {
    const k = compensate([0.4, 0.2, 0.1], [0.5, 0.5, 0.5]);
    expect(k[0] * 0.5).toBeCloseTo(0.4);
    expect(k[2] * 0.5).toBeCloseTo(0.1);
    expect(compensate([1, 1, 1], [0, 0.01, 1])[0]).toBe(MAX_GAIN);
  });
  it('trung bình tuyến tính của byte sRGB', () => {
    expect(meanLinear([255, 255, 255, 255, 0, 0, 0, 255])).toEqual([0.5, 0.5, 0.5]);
  });
  it('diện tích tam giác', () => {
    expect(geometryArea(new PlaneGeometry(2, 3))).toBeCloseTo(6);
  });
});

describe('textureMean', () => {
  it('vân nén KTX2 (ảnh không vẽ được) → [1,1,1], không ném lỗi drawImage', () => {
    const tex = new CompressedTexture([], 64, 64);
    expect(() => textureMean(tex)).not.toThrow();
    expect(textureMean(tex)).toEqual([1, 1, 1]);
  });
  it('DataTexture RGBA 8 bit đọc thẳng từ data', () => {
    const tex = new DataTexture(new Uint8Array([255, 255, 255, 255, 0, 0, 0, 255]), 2, 1);
    expect(textureMean(tex)).toEqual([0.5, 0.5, 0.5]);
  });
  it('ảnh chưa nạp → null (thử lại sau)', () => {
    const img = document.createElement('img');
    Object.defineProperty(img, 'complete', { value: false });
    img.width = 8;
    expect(textureMean(new Texture(img))).toBeNull();
  });
});

describe('applyUpholstery', () => {
  it('nhuộm vải lớn nhất theo phong cách, giữ khung', () => {
    enableMaterials();
    const seat = new MeshStandardMaterial({ color: 0x884422 });
    const frame = new MeshStandardMaterial({ color: 0x332211 });
    tagUpholstery(seat, 'fabric', 'library:fabric-cotton', 'sofa');
    const meshes = [new Mesh(new PlaneGeometry(2, 1), seat), new Mesh(new PlaneGeometry(3, 3), frame)];
    applyUpholstery(meshes, true);
    expect(seat.color.getHexString()).toBe(new Color(UPHOLSTERY_PALETTE.hienDai).getHexString());
    expect(frame.color.getHexString()).toBe('332211');
  });
  it('thảm không nhuộm; textures=false bỏ qua', () => {
    enableMaterials();
    const rug = new MeshStandardMaterial({ color: 0x884422 });
    tagUpholstery(rug, 'fabric', undefined, 'rectangular-carpet');
    applyUpholstery([new Mesh(new PlaneGeometry(2, 2), rug)], true);
    expect(rug.color.getHexString()).toBe('884422');
    const bed = new MeshStandardMaterial({ color: 0x884422 });
    tagUpholstery(bed, 'bedding', undefined, 'double-bed');
    applyUpholstery([new Mesh(new PlaneGeometry(2, 2), bed)], false);
    expect(bed.color.getHexString()).toBe('884422');
  });
});

describe('sheen vải', () => {
  it('vải → physical có sheen, giữ màu; gỗ giữ standard', () => {
    clearItemMaterialCache();
    enableMaterials();
    const ctx = { src: '/items/sofa/model.glb', slotId: 's', ref: 'library:preset-taupe', textures: true };
    const fabric = tuneItemMaterial(new MeshStandardMaterial({ color: 0x8f7a64, roughness: 0.9 }), ctx);
    expect(fabric).toBeInstanceOf(MeshPhysicalMaterial);
    expect((fabric as MeshPhysicalMaterial).sheen).toBe(0.5);
    expect((fabric as MeshPhysicalMaterial).color.getHexString()).toBe('8f7a64');
    expect(fabric.userData.upholstery).toEqual({ kind: 'fabric', recolour: true });
    const wood = tuneItemMaterial(new MeshStandardMaterial({ roughness: 0.5 }), { ...ctx, src: '/items/dining-table/model.glb', ref: 'library:wood-oak' });
    expect(wood).not.toBeInstanceOf(MeshPhysicalMaterial);
  });
});

describe('upholstery — ?drape=light (vòng 10)', () => {
  it('mẫu rèm: dấu drape khi bật cờ; chỉ món đăng ký id DRESS-curtain-* là rèm sinh', async () => {
    const { setDrapeFlags } = await import('@/lib/pascal/sceneDressingDrape');
    const mat = new MeshStandardMaterial();
    tagUpholstery(mat, 'fabric', 'library:fabric-linen', 'curtain');
    expect(mat.userData.upholstery).toEqual({ kind: 'fabric', recolour: true });
    setDrapeFlags(['light']);
    try {
      const m2 = new MeshStandardMaterial();
      tagUpholstery(m2, 'fabric', 'library:fabric-linen', 'curtain');
      expect(m2.userData.upholstery).toEqual({ kind: 'fabric', recolour: true, drape: true });
      // Rèm người dùng chọn vải riêng: không nhuộm (recolour false), như không cờ.
      const m3 = new MeshStandardMaterial();
      tagUpholstery(m3, 'fabric', 'library:fabric-velvet', 'curtain');
      expect(m3.userData.upholstery).toMatchObject({ recolour: false });
      const gen = new Group();
      const user = new Group();
      const genMesh = new Mesh(new PlaneGeometry());
      const userMesh = new Mesh(new PlaneGeometry());
      gen.add(genMesh);
      user.add(userMesh);
      const nodes = new Map<string, Group>([
        ['item_DRESS-curtain-O-w-L', gen],
        ['item_F-curtain-1', user],
      ]);
      expect(isGeneratedCurtainItem(genMesh, nodes)).toBe(true);
      expect(isGeneratedCurtainItem(userMesh, nodes)).toBe(false);
    } finally {
      setDrapeFlags([]);
    }
  });
});
