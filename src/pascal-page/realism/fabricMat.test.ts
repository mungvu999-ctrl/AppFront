import { BoxGeometry, BufferGeometry, Float32BufferAttribute, Mesh, MeshStandardMaterial } from 'three';
import { afterEach, describe, expect, it } from 'vitest';
import { applyFabricMaterials, clearFabricMaterials, FABRIC_CACHE_MAX, FABRIC_LEVELS, fabricLevelOf, fabricMatFlag, fabricReport, roleOfKey, setFabricLevel, setFabricMat } from './fabricMat';
import { fabricRoleOf, fabricSurfaceOf, modelKeyOf, type SurfaceFacts } from './fabricRules';

const facts = (f: Partial<SurfaceFacts>): SurfaceFacts => ({ names: [], hasMap: false, hasUv: true, metalness: 0, roughness: 0.9, transparent: false, ...f });

describe('fabricRules', () => {
  it('khoá mẫu từ src (Pascal, AppFront, thư viện ký), bỏ -uv', () => {
    expect(modelKeyOf('/items/curtain-uv/model.glb')).toBe('curtain');
    expect(modelKeyOf('http://h:9000/appback/library/bed-white-oak-headboard/model.glb?X-Sig=1')).toBe('bed-white-oak-headboard');
    expect(modelKeyOf('/appfront-items/pillow/model.glb')).toBe('pillow');
    expect(modelKeyOf(undefined)).toBeNull();
  });

  it('vai: token id món sinh thắng; không có thì vai catalog; ghế/tủ không phải vai vải', () => {
    const none = () => undefined;
    expect(fabricRoleOf('item_DRESS-curtain-D-1-L', '/items/curtain/model.glb', none)).toBe('curtain');
    expect(fabricRoleOf('item_DRESS-throw-F-1', null, none)).toBe('throw');
    expect(fabricRoleOf('item_DRESS-armchair-R-1', null, () => 'sofa')).toBeNull();
    expect(fabricRoleOf('item_F-1', '/library/x/model.glb', () => 'doubleBed')).toBe('bed');
    expect(fabricRoleOf('item_F-1', '/library/x/model.glb', () => 'closet')).toBeNull();
  });

  it('vai catalog thật: giường/sofa thư viện, giường Pascal (cả bản swap), tủ không', () => {
    expect(roleOfKey('bed-white-oak-headboard')).toBe('doubleBed');
    expect(roleOfKey('sofa-grey-linen-slim')).toBe('sofa');
    expect(roleOfKey('double-bed')).toBe('bed');
    expect(roleOfKey('bed-sf')).toBe('bed');
    expect(roleOfKey('storage-wardrobe-greywash')).not.toBe('bed');
  });

  it('bề mặt: ga trơn → vải; chăn trắng nhám 0,6 (Box002__0) → vải; tối nhám 0,6, viền, trong suốt, gỗ có ảnh, kim loại, kính, da → không', () => {
    expect(fabricSurfaceOf(facts({ names: ['Standardmaterial'] }))).toBe('plain');
    expect(fabricSurfaceOf(facts({ names: ['Box002__0'], roughness: 0.6 }))).toBe('plain');
    expect(fabricSurfaceOf(facts({ names: ['Color_M08'], roughness: 0.6, luminance: 0.12 }))).toBeNull();
    expect(fabricSurfaceOf(facts({ names: ['Box002__0'], roughness: 0.4 }))).toBeNull();
    expect(fabricSurfaceOf(facts({ names: ['edge_color948886255'], roughness: 0.6 }))).toBeNull();
    expect(fabricSurfaceOf(facts({ names: ['Standardmaterial_0'], hasMap: true }))).toBeNull();
    expect(fabricSurfaceOf(facts({ names: ['slot_metal', 'metal'], metalness: 1, roughness: 0.3 }))).toBeNull();
    expect(fabricSurfaceOf(facts({ names: ['legs'], roughness: 0.9 }))).toBeNull();
    expect(fabricSurfaceOf(facts({ names: ['curtain_rod'] }))).toBeNull();
    expect(fabricSurfaceOf(facts({ names: ['Glass'], transparent: true }))).toBeNull();
    expect(fabricSurfaceOf(facts({ names: ['seat'], tagKind: 'leather' }))).toBeNull();
  });

  it('bề mặt: tên vải thắng; ảnh trên mesh không UV (rèm Pascal) → vải; ảnh + UV → giữ ảnh tác giả', () => {
    expect(fabricSurfaceOf(facts({ names: ['slot_fabric', 'fabric'], hasMap: true, hasUv: false }))).toBe('named');
    expect(fabricSurfaceOf(facts({ names: ['Elegant_Cushion'], roughness: 0.4 }))).toBe('named');
    expect(fabricSurfaceOf(facts({ names: ['Lenestol_fabric'], hasMap: true, hasUv: true }))).toBeNull();
    expect(fabricSurfaceOf(facts({ names: ['Material'], roughness: 0.5, tagKind: 'bedding' }))).toBe('tagged');
  });

  it('mức cường độ ?fabric=: mặc định 2, kẹp 0..3, nếp tăng dần theo mức', () => {
    expect(fabricLevelOf('')).toBe(2);
    expect(fabricLevelOf('?fabric=2')).toBe(2);
    expect(fabricLevelOf('?fabric=9')).toBe(3);
    expect(fabricLevelOf('?fabric=-1')).toBe(0);
    expect(fabricLevelOf('?fabric=abc')).toBe(2);
    for (let i = 1; i < FABRIC_LEVELS.length; i++) expect(FABRIC_LEVELS[i]!.foldHeightM).toBeGreaterThan(FABRIC_LEVELS[i - 1]!.foldHeightM);
    expect(setFabricLevel(2)).toBe(2);
    expect(fabricReport().level).toBe(2);
    setFabricLevel(2);
  });

  it('cờ: bật mặc định (QA ảnh 6 căn, vòng 11), ?enable=fabricmat bật, ?disable thắng', () => {
    expect(fabricMatFlag('')).toBe(true);
    expect(fabricMatFlag('?disable=fabricmat')).toBe(false);
    expect(fabricMatFlag('?enable=lamprule,fabricmat')).toBe(true);
    expect(fabricMatFlag('?enable=fabricmat&disable=fabricmat')).toBe(false);
    expect(fabricMatFlag('?disable=fabricmat', true)).toBe(false);
  });
});

describe('applyFabricMaterials', () => {
  afterEach(() => {
    setFabricMat(false);
    clearFabricMaterials();
  });

  const noUv = (): BufferGeometry => {
    const g = new BufferGeometry();
    g.setAttribute('position', new Float32BufferAttribute([0, 0, 0, 1, 0, 0, 0, 1, 0], 3));
    return g;
  };
  const bed = () => {
    const sheet = new MeshStandardMaterial({ name: 'Standardmaterial', roughness: 0.9 });
    sheet.color.setRGB(0.96, 0.96, 0.96);
    const frame = new MeshStandardMaterial({ name: 'Standardmaterial_0', roughness: 0.9, map: {} as never });
    return { sheet, frame, mesh: new Mesh(new BoxGeometry(), [sheet, frame]) };
  };
  const BED_SRC = 'http://h/appback/library/bed-white-oak-headboard/model.glb';

  it('cờ tắt: không đổi gì', () => {
    setFabricMat(false);
    const { mesh, sheet } = bed();
    applyFabricMaterials([mesh], { id: 'item_F-1', asset: { src: BED_SRC } });
    expect((mesh.material as MeshStandardMaterial[])[0]).toBe(sheet);
  });

  it('giường (món dò): ga → vật liệu vải dùng chung, kẹp trắng, nhuộm chăn ga; khung giữ', () => {
    setFabricMat(true);
    const { mesh, frame } = bed();
    applyFabricMaterials([mesh], { id: 'item_F-1', asset: { src: BED_SRC } });
    const [s, f] = mesh.material as MeshStandardMaterial[];
    expect(s!.userData.fabricMat).toBe(true);
    expect(s!.color.r).toBeLessThanOrEqual(0.82);
    expect(s!.userData.upholstery).toEqual({ kind: 'bedding', recolour: true });
    expect(f).toBe(frame);
    const r = fabricReport();
    expect(r.surfacesByRole.bed).toBe(1);
    expect(r.shaderKeys).toBe(1);
  });

  it('món không phải vải (tủ, ghế ăn) không bị đụng', () => {
    setFabricMat(true);
    const m = new MeshStandardMaterial({ name: 'Standardmaterial', roughness: 0.9 });
    const mesh = new Mesh(new BoxGeometry(), m);
    applyFabricMaterials([mesh], { id: 'item_F-2', asset: { src: 'http://h/appback/library/storage-wardrobe-greywash/model.glb' } });
    applyFabricMaterials([mesh], { id: 'item_DRESS-chair-R-1', asset: { src: '/items/dining-chair/model.glb' } });
    expect(mesh.material).toBe(m);
    expect(fabricReport().items).toBe(0);
  });

  it('rèm sinh không UV: vải có ảnh → vải dùng chung (bỏ ảnh), thanh kim loại giữ; dùng lại cùng vật liệu', () => {
    setFabricMat(true);
    const cloth = new MeshStandardMaterial({ name: 'fabric-linen|fabric', roughness: 0.95 });
    cloth.map = {} as never;
    cloth.userData.upholstery = { kind: 'fabric', recolour: true };
    const rod = new MeshStandardMaterial({ name: 'slot_metal', metalness: 1, roughness: 0.3 });
    const a = new Mesh(noUv(), [cloth, rod]);
    const b = new Mesh(noUv(), [cloth, rod]);
    applyFabricMaterials([a], { id: 'item_DRESS-curtain-D-1-L', asset: { src: '/items/curtain/model.glb' } });
    applyFabricMaterials([b], { id: 'item_DRESS-curtain-D-1-R', asset: { src: '/items/curtain/model.glb' } });
    const [ca, ra] = a.material as MeshStandardMaterial[];
    expect(ca!.userData.fabricMat).toBe(true);
    expect(ca!.map ?? null).toBeNull();
    expect(ca!.userData.upholstery).toEqual({ kind: 'fabric', recolour: true });
    expect(ra).toBe(rod);
    expect((b.material as MeshStandardMaterial[])[0]).toBe(ca);
    expect(fabricReport().generatedItems).toBe(2);
  });

  it('khe người dùng gán vật liệu trên món không sinh: giữ', () => {
    setFabricMat(true);
    const m = new MeshStandardMaterial({ name: 'slot_fabric', roughness: 0.9 });
    const mesh = new Mesh(new BoxGeometry(), m);
    mesh.userData.pascalItemMaterialCapture = { authoredMaterials: m, slotIds: 'fabric' };
    applyFabricMaterials([mesh], { id: 'item_F-3', asset: { src: '/items/sofa/model.glb' }, slots: { fabric: 'library:leather-calf' } });
    expect(mesh.material).toBe(m);
  });
});

describe('lát 3: lựa chọn người dùng + vòng đời vật liệu', () => {
  afterEach(() => {
    setFabricMat(false);
    clearFabricMaterials();
  });
  const SOFA_SRC = '/items/sofa/model.glb';
  const meshWithSlot = (slot: string) => {
    const m = new MeshStandardMaterial({ name: 'Standardmaterial', roughness: 0.9 });
    const mesh = new Mesh(new BoxGeometry(), m);
    mesh.userData.pascalItemMaterialCapture = { authoredMaterials: m, slotIds: slot };
    return { m, mesh };
  };

  it('dự phòng cả món slots.a (mẫu không khe) của người dùng: giữ', () => {
    setFabricMat(true);
    const { m, mesh } = meshWithSlot('a');
    applyFabricMaterials([mesh], { id: 'item_F-9', asset: { src: SOFA_SRC }, slots: { a: 'library:wood-oak' }, metadata: { appfront: { fields: { styleSlots: {} } } } });
    expect(mesh.material).toBe(m);
  });

  it('khe có khe riêng rỗng nhưng slots.a đã sơn: giữ (renderer dùng slots.a)', () => {
    setFabricMat(true);
    const { m, mesh } = meshWithSlot('body');
    applyFabricMaterials([mesh], { id: 'item_F-10', asset: { src: SOFA_SRC }, slots: { a: 'library:leather-calf' } });
    expect(mesh.material).toBe(m);
  });

  it('món sinh (DRESS-) người dùng vừa sơn khác mặc định phong cách: giữ; còn đúng mặc định: được đổi', () => {
    setFabricMat(true);
    const styleSlots = { fabric: 'library:fabric-linen' };
    const painted = meshWithSlot('fabric');
    applyFabricMaterials([painted.mesh], { id: 'item_DRESS-curtain-D-1-L', asset: { src: '/items/curtain/model.glb' }, slots: { fabric: 'library:fabric-velvet' }, metadata: { appfront: { fields: { styleSlots } } } });
    expect(painted.mesh.material).toBe(painted.m);
    const def = meshWithSlot('fabric');
    applyFabricMaterials([def.mesh], { id: 'item_DRESS-curtain-D-1-R', asset: { src: '/items/curtain/model.glb' }, slots: { ...styleSlots }, metadata: { appfront: { fields: { styleSlots } } } });
    expect((def.mesh.material as MeshStandardMaterial).userData.fabricMat).toBe(true);
  });

  it('không đổi node (dữ liệu lưu qua toSpatial đọc node, không đọc vật liệu mesh)', () => {
    setFabricMat(true);
    const { mesh } = bedMesh();
    const item = { id: 'item_F-11', asset: { src: 'http://h/appback/library/bed-white-oak-headboard/model.glb' }, slots: {}, metadata: { appfront: { fields: { styleSlots: {} } } } };
    const before = JSON.stringify(item);
    applyFabricMaterials([mesh], item);
    expect(((mesh.material as MeshStandardMaterial[])[0]!).userData.fabricMat).toBe(true);
    expect(JSON.stringify(item)).toBe(before);
  });

  it('Codex N1: món rời registry rồi áp lại trên cùng mesh — không ném, vật liệu đang dùng không bị dispose', () => {
    setFabricMat(true);
    const src = 'http://h/appback/library/bed-white-oak-headboard/model.glb';
    const sheet = new MeshStandardMaterial({ name: 'Standardmaterial', roughness: 0.9 });
    const a = new Mesh(new BoxGeometry(), sheet);
    applyFabricMaterials([a], { id: 'item_F-A', asset: { src } });
    const fab = a.material as MeshStandardMaterial;
    let disposed = 0;
    fab.addEventListener('dispose', () => (disposed += 1));
    // món khác áp (trước đây: lượt quét registry dispose vật liệu của A)
    applyFabricMaterials([new Mesh(new BoxGeometry(), new MeshStandardMaterial({ roughness: 0.9 }))], { id: 'item_F-B', asset: { src } });
    expect(() => applyFabricMaterials([a], { id: 'item_F-A', asset: { src } })).not.toThrow();
    expect(a.material).toBe(fab);
    expect(disposed).toBe(0);
  });

  it('cache theo nội dung: 200 lần áp với UUID nguồn khác nhau không vượt trần, cùng màu dùng chung một vật liệu', () => {
    setFabricMat(true);
    const src = 'http://h/appback/library/bed-white-oak-headboard/model.glb';
    for (let i = 0; i < 200; i++) {
      const m = new MeshStandardMaterial({ name: 'Standardmaterial', roughness: 0.9 });
      m.color.setRGB(((i * 37) % 100) / 100, ((i * 53) % 100) / 100, ((i * 71) % 100) / 100);
      const mesh = new Mesh(new BoxGeometry(), m);
      applyFabricMaterials([mesh], { id: `item_F-${i}`, asset: { src } });
      expect((mesh.material as MeshStandardMaterial).userData.fabricMat).toBe(true);
    }
    expect(fabricReport().materials).toBeLessThanOrEqual(FABRIC_CACHE_MAX);
    clearFabricMaterials();
    const same = () => {
      const m = new MeshStandardMaterial({ name: 'Standardmaterial', roughness: 0.9 });
      m.color.setRGB(0.3, 0.3, 0.3);
      const mesh = new Mesh(new BoxGeometry(), m);
      applyFabricMaterials([mesh], { id: 'item_F-x', asset: { src } });
      return mesh.material;
    };
    expect(same()).toBe(same());
    expect(fabricReport().materials).toBe(1);
  });

  it('clearFabricMaterials dispose mọi vật liệu còn giữ', () => {
    setFabricMat(true);
    const { mesh } = bedMesh();
    applyFabricMaterials([mesh], { id: 'item_F-13', asset: { src: 'http://h/appback/library/bed-white-oak-headboard/model.glb' } });
    let disposed = 0;
    ((mesh.material as MeshStandardMaterial[])[0]!).addEventListener('dispose', () => (disposed += 1));
    clearFabricMaterials();
    expect(disposed).toBe(1);
  });
});

function bedMesh() {
  const sheet = new MeshStandardMaterial({ name: 'Standardmaterial', roughness: 0.9 });
  const frame = new MeshStandardMaterial({ name: 'Standardmaterial_0', roughness: 0.9, map: {} as never });
  return { mesh: new Mesh(new BoxGeometry(), [sheet, frame]) };
}
