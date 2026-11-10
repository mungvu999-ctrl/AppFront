import { describe, expect, it, vi } from 'vitest';
import { MeshStandardMaterial, Texture, type EventDispatcher } from 'three';
import { SCENE_PALETTE } from '@/lib/pascal/scenePalette';
import { hasPendingTextures, libraryRefsIn, preloadSceneTextures } from './texturePreload';
import { autoPatch, dielectricName, flagOff, folderOf, itemKindOf, nameKind, tunedRoughness } from './itemLook';
import { clearItemMaterialCache, specGlossPlugin, tuneItemMaterial } from './itemMaterials';
import { useRealism } from './store';

describe('itemLook', () => {
  it('đọc thư mục mẫu', () => {
    expect(folderOf('/items/sofa/model.glb')).toBe('sofa');
    expect(folderOf('https://x/pascal/appfront-items/ottoman/model.glb')).toBe('ottoman');
    expect(folderOf(undefined)).toBeNull();
  });
  it('phân loại theo thư mục/khe/ref', () => {
    expect(itemKindOf('sofa', 'slot_body', 'library:preset-taupe')).toBe('fabric');
    expect(itemKindOf('double-bed', null, undefined)).toBe('bedding');
    expect(itemKindOf('fridge', null, undefined)).toBe('steel');
    expect(itemKindOf('closet', 'slot_body', 'library:wood-finewood27')).toBe('wood');
    expect(itemKindOf('kitchen-cabinet', 'slot_h', 'library:metal-brass')).toBe('metal');
    expect(itemKindOf('kitchen-cabinet', 'slot_c', 'scene:am_ap_cabinet')).toBeNull();
    expect(itemKindOf('table-lamp', null, undefined)).toBeNull();
  });
  it('gói 4A: gương, màn hình, sứ, kim loại nhỏ', () => {
    expect(itemKindOf('round-mirror', 'glass', undefined)).toBe('mirror');
    expect(itemKindOf('round-mirror', 'frame', undefined)).toBeNull();
    expect(itemKindOf('television', 'screen', undefined)).toBe('screen');
    expect(itemKindOf('television', 'frame', undefined)).toBe('matte');
    expect(itemKindOf('computer', 'screen', undefined)).toBe('screen');
    expect(itemKindOf('toilet', 'toilet', undefined)).toBe('porcelain');
    expect(itemKindOf('toilet', 'buttons', undefined)).toBe('porcelain');
    expect(itemKindOf('bathroom-sink', null, undefined)).toBe('porcelain');
    expect(itemKindOf('bathtub', 'tub', undefined)).toBe('porcelain');
    expect(itemKindOf('bathtub', 'fixtures', undefined)).toBe('metal');
    expect(itemKindOf('shower-square', 'fixtures', undefined)).toBe('metal');
    expect(itemKindOf('shower-square', 'glass', undefined)).toBeNull();
    expect(itemKindOf('toilet-paper', 'holder', undefined)).toBe('metal');
    for (const f of ['kitchen-cabinet', 'kitchen-shelf', 'dresser', 'office-table', 'microwave', 'bedside-table'])
      expect(itemKindOf(f, 'handle', undefined)).toBe('metal');
    for (const f of ['dining-chair', 'dining-table', 'coffee-table', 'lounge-chair', 'floor-lamp', 'bedside-table', 'stove', 'ironing-board'])
      expect(itemKindOf(f, 'legs', undefined)).toBe('metal');
    // Chân gán ref gỗ → gỗ, không ép kim loại.
    expect(itemKindOf('dining-table', 'legs', 'library:wood-oak')).toBe('wood');
    expect(itemKindOf('frying-pan', 'handle', undefined)).toBeNull();
  });
  it('roughness gỗ ×1.6 kẹp ≥ 0.45', () => {
    expect(tunedRoughness('wood', 0.2)).toBe(0.45);
    expect(tunedRoughness('wood', 0.5)).toBeCloseTo(0.8);
    expect(tunedRoughness('fabric', 0.9)).toBe(0.95);
  });
});

describe('tuneItemMaterial', () => {
  const ctx = { src: '/items/sofa/model.glb', slotId: 's', ref: 'library:preset-taupe', textures: true };
  it('clone có cache, giữ màu, không sửa bản gốc', () => {
    clearItemMaterialCache();
    useRealism.setState({ flags: { ...useRealism.getState().flags, materials: true } });
    const base = new MeshStandardMaterial({ color: 0x8f7a64, roughness: 0.9 });
    const a = tuneItemMaterial(base, ctx) as MeshStandardMaterial;
    expect(a).not.toBe(base);
    expect(a.roughness).toBe(0.95);
    expect(a.color.getHexString()).toBe('8f7a64');
    expect(base.roughness).toBe(0.9);
    expect(tuneItemMaterial(base, ctx)).toBe(a);
  });
  it('gốc nạp ảnh sau khi clone → clone theo kịp (đồ gỗ không ra trắng), không thăm dò', async () => {
    clearItemMaterialCache();
    const base = new MeshStandardMaterial({ roughness: 0.5 });
    base.userData.texPending = 2; // vendor queueTextureAssignment: 2 ảnh đang nạp
    const a = tuneItemMaterial(base, { ...ctx, src: '/items/dining-table/model.glb', ref: 'library:wood-finewood27' }) as MeshStandardMaterial;
    expect(a).not.toBe(base);
    expect(a.map).toBeNull();
    expect(hasPendingTextures(a)).toBe(true);
    const ready = vi.fn();
    (a as unknown as EventDispatcher<{ texturesready: object }>).addEventListener('texturesready', ready);
    const tex = new Texture();
    base.map = tex;
    base.normalMap = tex;
    delete base.userData.texPending;
    (base as unknown as EventDispatcher<{ texturesready: object }>).dispatchEvent({ type: 'texturesready' });
    await Promise.resolve();
    await Promise.resolve();
    expect(a.map).toBe(tex);
    expect(a.normalMap).toBe(tex);
    expect(hasPendingTextures(a)).toBe(false);
    expect(ready).toHaveBeenCalledOnce();
  });
  it('preload: gom ref thư viện trong cảnh, đợi vật liệu nạp xong', async () => {
    const scene = { nodes: { w: { material: 'library:oak', slots: ['library:oak', 'library:metal-steel', SCENE_PALETTE.plaster] } } };
    expect([...libraryRefsIn(scene)]).toEqual(['library:oak', 'library:metal-steel']);
    const mats = new Map<string, MeshStandardMaterial>();
    const create = (ref: string) => {
      const m = new MeshStandardMaterial();
      if (ref === 'library:oak') m.userData.texPending = 1;
      mats.set(ref, m);
      return ref === 'library:gone' ? null : m;
    };
    let done = false;
    const p = preloadSceneTextures(scene, create, ['library:gone']).then(() => (done = true));
    await Promise.resolve();
    expect(done).toBe(false);
    const oak = mats.get('library:oak')!;
    delete oak.userData.texPending;
    (oak as unknown as EventDispatcher<{ texturesready: object }>).dispatchEvent({ type: 'texturesready' });
    await p;
    expect(done).toBe(true);
  });
  it('gỗ nhân tint, gốc giữ màu', () => {
    clearItemMaterialCache();
    const base = new MeshStandardMaterial({ roughness: 0.5 });
    const a = tuneItemMaterial(base, { ...ctx, src: '/items/dining-table/model.glb', ref: 'library:wood-oak' }) as MeshStandardMaterial;
    expect(a.color.r).toBeCloseTo(0.8);
    expect(a.color.b).toBeCloseTo(0.95);
    expect(base.color.r).toBe(1);
  });
  it('gương: kim loại bóng, đè màu trắng; khe có ref giữ màu', () => {
    clearItemMaterialCache();
    const base = new MeshStandardMaterial({ color: 0xe3e3e3, roughness: 0.5 });
    const a = tuneItemMaterial(base, { src: '/items/round-mirror/model.glb', slotId: 'glass', textures: true }) as MeshStandardMaterial;
    expect(a.metalness).toBe(0.5);
    expect(a.roughness).toBeLessThan(0.1);
    expect(a.color.getHexString()).toBe('dfe4e6');
    expect(base.metalness).toBe(0);
    const tv = tuneItemMaterial(base, { src: '/items/television/model.glb', slotId: 'screen', textures: true }) as MeshStandardMaterial;
    expect(tv.color.getHexString()).toBe('0b0c0e');
    const picked = tuneItemMaterial(base, { src: '/items/toilet/model.glb', slotId: 'toilet', ref: 'library:preset-white', textures: true }) as MeshStandardMaterial;
    expect(picked.roughness).toBe(0.12);
    expect(picked.color.getHexString()).toBe('e3e3e3');
  });
  it('cờ tắt / textures=false / kính → y cũ', () => {
    const base = new MeshStandardMaterial({ roughness: 0.9 });
    expect(tuneItemMaterial(base, { ...ctx, textures: false })).toBe(base);
    const glass = new MeshStandardMaterial({ transparent: true, opacity: 0.25 });
    expect(tuneItemMaterial(glass, ctx)).toBe(glass);
    useRealism.setState({ flags: { ...useRealism.getState().flags, materials: false } });
    expect(tuneItemMaterial(base, ctx)).toBe(base);
    useRealism.setState({ flags: { ...useRealism.getState().flags, materials: true } });
  });
  it('gói 4B: tay nắm của mẫu tủ sinh bằng code là kim loại', () => {
    for (const f of ['closet-gen', 'kitchen-counter-gen', 'kitchen-cabinet-gen', 'kitchen-shelf-gen', 'tv-stand-gen'])
      expect(itemKindOf(f, 'handle', undefined), f).toBe('metal');
  });
  it('gương: kính thư viện trong suốt vẫn thành mặt gương đục (không nhìn xuyên ra đáy đen)', () => {
    clearItemMaterialCache();
    const glass = new MeshStandardMaterial({ transparent: true, opacity: 0.15, roughness: 0.05 });
    const a = tuneItemMaterial(glass, { ...ctx, src: '/items/round-mirror/model.glb', slotId: 'glass', ref: 'library:preset-glass' }) as MeshStandardMaterial;
    expect(a).not.toBe(glass);
    expect(a.transparent).toBe(false);
    expect(a.opacity).toBe(1);
    const shower = new MeshStandardMaterial({ transparent: true, opacity: 0.15, roughness: 0.05 });
    expect(tuneItemMaterial(shower, { ...ctx, src: '/items/shower-square/model.glb', slotId: 'glass', ref: 'library:preset-glass' })).toBe(shower);
  });
  it('gương: ref kim loại của phong cách không đè loại gương', () => {
    expect(itemKindOf('round-mirror', 'glass', 'library:metal-brushed')).toBe('mirror');
    expect(itemKindOf('dining-table', 'legs', 'library:wood-finewood27')).toBe('wood');
  });
});

describe('luật chung (mẫu lạ, không có trong ITEM_KIND)', () => {
  const f = { metalness: 0, roughness: 0.5, metalnessMap: false, roughnessMap: false, transparent: false };
  it('autoPatch: kẹp kim loại + nhám tối thiểu', () => {
    expect(autoPatch(f)).toEqual({});
    // Kim loại 100 % bóng gương (vanity-sf Chrome m1 r0) → pha nửa khuếch tán, nhám ≥ 0.25.
    expect(autoPatch({ ...f, metalness: 1, roughness: 0 })).toEqual({ metalness: 0.6, roughness: 0.25 });
    // Có metalnessMap (fridge-sf, PolyHaven): hệ số ≤ 0.5, kênh ảnh lo phần còn lại; có roughnessMap → giữ nhám.
    expect(autoPatch({ ...f, metalness: 1, roughness: 1, metalnessMap: true, roughnessMap: true })).toEqual({ metalness: 0.5 });
    expect(autoPatch({ ...f, metalness: 0.6, roughness: 0.3 })).toEqual({});
    expect(autoPatch({ ...f, roughness: 0.02 })).toEqual({ roughness: 0.12 });
    // Kính trong suốt: chỉ kẹp kim loại, giữ bóng.
    expect(autoPatch({ ...f, metalness: 1, roughness: 0, transparent: true })).toEqual({ metalness: 0.6 });
  });
  it('M7: vật liệu tên phi kim (vải/gỗ) mà GLB đặt kim loại → 0, cả khi có ảnh; tên có từ kim loại giữ luật cũ', () => {
    expect(dielectricName('Lenestol_fabric')).toBe(true);
    expect(dielectricName('Wood_12')).toBe(true);
    expect(dielectricName('M_commode_marble')).toBe(true);
    expect(dielectricName('wood_metal_legs')).toBe(false);
    expect(dielectricName('CabinetA_handles')).toBe(false);
    expect(dielectricName('B07RMJSGS7_TRB_MDL_MR')).toBe(false);
    // Lenestol_fabric: metallicFactor 0,68 không ảnh; Wood_12: hệ số 0,5 + metalnessMap kênh B ≈ 1.
    expect(autoPatch({ ...f, name: 'Lenestol_fabric', metalness: 0.68, roughness: 1 })).toEqual({ metalness: 0 });
    expect(autoPatch({ ...f, name: 'Wood_12', metalness: 0.5, roughness: 1, metalnessMap: true, roughnessMap: true })).toEqual({ metalness: 0 });
    // Tên không rõ / kim loại: giữ trần 0,6 / 0,5 như cũ.
    expect(autoPatch({ ...f, name: 'Material.001', metalness: 1, roughness: 0.5 })).toEqual({ metalness: 0.6 });
    expect(autoPatch({ ...f, name: 'DrawerHandles', metalness: 1, roughness: 0.3 })).toEqual({ metalness: 0.6 });
    // `?disable=dielectric`.
    expect(autoPatch({ ...f, name: 'Lenestol_fabric', metalness: 0.68, roughness: 1 }, false)).toEqual({ metalness: 0.6 });
    expect(flagOff('?disable=idle,dielectric', 'dielectric')).toBe(true);
    expect(flagOff('?disable=idle', 'dielectric')).toBe(false);
  });
  it('M7: tuneItemMaterial — vải tên rõ, kim loại 0,68 → clone kim loại 0, giữ màu/ảnh; gốc không đổi', () => {
    clearItemMaterialCache();
    useRealism.setState({ flags: { ...useRealism.getState().flags, materials: true } });
    const fab = new MeshStandardMaterial({ name: 'Lenestol_fabric', color: 0xffffff, metalness: 0.68, roughness: 1 });
    fab.map = new Texture();
    const a = tuneItemMaterial(fab, { src: '/library/chair-x/model.glb', slotId: 'a', textures: true }) as MeshStandardMaterial;
    expect(a).not.toBe(fab);
    expect([a.metalness, a.map, a.color.getHexString()]).toEqual([0, fab.map, 'ffffff']);
    expect(fab.metalness).toBe(0.68);
  });
  it('nameKind: gương luôn nhận; mẫu có ảnh màu không đoán; kim loại/kính để luật chung', () => {
    expect(nameKind('Bathroom_Mirror', true)).toBe('mirror');
    expect(nameKind('slot_fabric', false)).toBe('fabric');
    expect(nameKind('Oak_Wood', false)).toBe('wood');
    expect(nameKind('wooden_display_shelves_01', true)).toBeNull();
    expect(nameKind('Chrome', false)).toBeNull();
    expect(nameKind('Glass_tile', false)).toBeNull();
    expect(nameKind('Material.008', false)).toBeNull();
    // `tile` trong `textile` không thành gốm.
    expect(nameKind('textile_sofa', false)).toBe('fabric');
  });
  it('tuneItemMaterial: mẫu lạ kim loại 100 % → clone kẹp; vật liệu thường giữ nguyên', () => {
    clearItemMaterialCache();
    useRealism.setState({ flags: { ...useRealism.getState().flags, materials: true } });
    const ctx = { src: '/items/user-upload-123/model.glb', slotId: null, textures: true };
    const chrome = new MeshStandardMaterial({ name: 'Chrome', color: 0x8a8a8a, metalness: 1, roughness: 0 });
    const a = tuneItemMaterial(chrome, ctx) as MeshStandardMaterial;
    expect(a).not.toBe(chrome);
    expect([a.metalness, a.roughness]).toEqual([0.6, 0.25]);
    expect(a.color.getHexString()).toBe('8a8a8a');
    expect(chrome.metalness).toBe(1);
    expect(tuneItemMaterial(chrome, ctx)).toBe(a);
    const plain = new MeshStandardMaterial({ name: 'Material.001', roughness: 0.6 });
    expect(tuneItemMaterial(plain, ctx)).toBe(plain);
    // Gương theo tên dù trong suốt.
    const mirror = new MeshStandardMaterial({ name: 'mirror', transparent: true, opacity: 0.3 });
    const mm = tuneItemMaterial(mirror, ctx) as MeshStandardMaterial;
    expect([mm.transparent, mm.metalness]).toEqual([false, 0.5]);
    // Kính PBR metal 1 có ảnh (picture-ph): chỉ kẹp kim loại, vẫn trong suốt.
    const glass = new MeshStandardMaterial({ name: 'frame_glass', transparent: true, metalness: 1, roughness: 1 });
    glass.metalnessMap = new Texture();
    const g = tuneItemMaterial(glass, ctx) as MeshStandardMaterial;
    expect([g.transparent, g.metalness, g.roughness]).toEqual([true, 0.5, 1]);
  });
  it('tuneItemMaterial: fridge-sf (bỏ khỏi ITEM_KIND) ra như steelMapped cũ', () => {
    clearItemMaterialCache();
    const m = new MeshStandardMaterial({ name: 'Material', metalness: 1, roughness: 1 });
    m.map = new Texture();
    m.metalnessMap = new Texture();
    m.roughnessMap = new Texture();
    const a = tuneItemMaterial(m, { src: '/appfront-items/fridge-sf/model.glb', slotId: null, textures: true }) as MeshStandardMaterial;
    expect([a.metalness, a.roughness]).toEqual([0.5, 1]);
  });
  it('anisotropy cho mọi ảnh, kể cả khi không clone', () => {
    clearItemMaterialCache();
    const m = new MeshStandardMaterial({ roughness: 0.6 });
    m.map = new Texture();
    expect(tuneItemMaterial(m, { src: '/items/x/model.glb', slotId: null, textures: true })).toBe(m);
    expect(m.map.anisotropy).toBe(8);
  });
  it('spec/gloss lúc nạp: khuếch tán → màu, bóng → nhám, kim loại 0', async () => {
    const assigned: string[] = [];
    const parser = {
      json: { materials: [{ extensions: { KHR_materials_pbrSpecularGlossiness: { diffuseFactor: [0.5, 0.4, 0.3, 0.8], glossinessFactor: 0.7, diffuseTexture: { index: 0 } } } }, {}] },
      assignTexture: (_p: Record<string, unknown>, key: string) => (assigned.push(key), Promise.resolve()),
    };
    const plugin = specGlossPlugin(parser);
    const params: Record<string, unknown> = { metalness: 1, roughness: 1 };
    await plugin.extendMaterialParams(0, params);
    expect(params.metalness).toBe(0);
    expect(params.roughness).toBeCloseTo(0.3);
    expect(params.opacity).toBe(0.8);
    expect((params.color as { r: number }).r).toBeCloseTo(0.5);
    expect(assigned).toEqual(['map']);
    const other: Record<string, unknown> = { metalness: 1 };
    await plugin.extendMaterialParams(1, other);
    expect(other.metalness).toBe(1);
  });
});
