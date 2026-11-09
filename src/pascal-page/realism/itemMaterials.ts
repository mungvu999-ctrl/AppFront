/**
 * Bước 2 (thẻ M1): chỉnh vật liệu đồ nội thất theo loại, lúc chạy.
 * Gọi từ vendor `nodes/src/item/renderer.tsx` (luật scripts/realism/r7-item-materials.mjs)
 * bọc kết quả `resolveItemMaterial`. Không đổi node/JSON: chỉ clone vật liệu
 * (cache theo uuid gốc + loại), giữ màu, đổi roughness/metalness, thêm map vải/da.
 * Mẫu không có trong bảng (mẫu lạ/người dùng tải lên) vẫn qua luật chung `autoPatch` + anisotropy.
 * Cờ `flags.materials` tắt, textures=false (clay), kính thư viện → trả nguyên vật liệu.
 */
import { Color, LinearSRGBColorSpace, MeshPhysicalMaterial, MeshStandardMaterial, SRGBColorSpace } from 'three';
import type { EventDispatcher, Material, Texture } from 'three';
import { MeshPhysicalNodeMaterial } from 'three/webgpu';
import { AUTO, autoPatch, folderOf, itemKindOf, KIND_LOOK, nameKind, tunedRoughness, type KindLook } from './itemLook';
import { hasPendingTextures, whenTexturesReady } from './texturePreload';
import { useRealism } from './store';
import { tagUpholstery } from './upholstery';

type TunableMaterial = Material & {
  color?: Color;
  roughness?: number;
  metalness?: number;
  normalMap?: Texture | null;
  roughnessMap?: Texture | null;
  specularIntensity?: number;
} & Partial<Record<MapKey, Texture | null>>;

/** Ảnh của vật liệu gốc mà bản clone phải theo (vật liệu thư viện gán map bất đồng bộ). */
const SOURCE_MAPS = ['map', 'normalMap', 'roughnessMap', 'metalnessMap', 'aoMap', 'emissiveMap', 'alphaMap'] as const;
type MapKey = (typeof SOURCE_MAPS)[number];

export interface TuneContext {
  src?: string | null;
  slotId: string | null;
  ref?: string | null;
  textures: boolean;
  /** Phân giải ref thư viện (vendor `resolveMaterialRef`). */
  donor?: (ref: string) => Material | null;
}

const cache = new Map<string, Material>();

/** Màu sheen trắng (Blender 4 Principled: sheen tint mặc định trắng). */
const SHEEN_TINT = 1;

/**
 * Vải/chăn: vật liệu standard → physical có sheen (ánh lông vải ở rìa, hết "nhựa mờ").
 * Vật liệu thư viện là MeshStandardNodeMaterial → MeshPhysicalNodeMaterial; GLB thường → MeshPhysicalMaterial.
 * `MeshStandardMaterial.prototype.copy` chỉ đọc trường standard (màu, map, nhám…) nên chép được từ cả hai lớp.
 */
function withSheen(m: TunableMaterial, look: KindLook): TunableMaterial {
  if (look.sheen == null) return m;
  const src = m as TunableMaterial & { sheen?: number; isNodeMaterial?: boolean };
  let phys: MeshPhysicalMaterial;
  if (typeof src.sheen === 'number') {
    phys = src as unknown as MeshPhysicalMaterial;
  } else {
    phys = src.isNodeMaterial
      ? (new MeshPhysicalNodeMaterial() as unknown as MeshPhysicalMaterial)
      : new MeshPhysicalMaterial();
    MeshStandardMaterial.prototype.copy.call(phys, src as unknown as MeshStandardMaterial);
    // copy() của standard đặt defines = STANDARD → trả lại PHYSICAL cho bộ dựng WebGL.
    phys.defines = { STANDARD: '', PHYSICAL: '' };
  }
  phys.sheen = look.sheen;
  if (look.sheenRoughness != null) phys.sheenRoughness = look.sheenRoughness;
  phys.sheenColor.setScalar(SHEEN_TINT);
  return phys as unknown as TunableMaterial;
}

function copyDonorMaps(target: TunableMaterial, donor: TunableMaterial): void {
  let changed = false;
  if (!target.normalMap && donor.normalMap) {
    target.normalMap = donor.normalMap;
    changed = true;
  }
  if (!target.roughnessMap && donor.roughnessMap) {
    target.roughnessMap = donor.roughnessMap;
    changed = true;
  }
  if (changed) {
    sharpen(target);
    target.needsUpdate = true;
  }
}

/** Chép ảnh gốc còn thiếu sang bản clone. */
function copySourceMaps(target: TunableMaterial, source: TunableMaterial): void {
  let changed = false;
  for (const key of SOURCE_MAPS) {
    if (!target[key] && source[key]) {
      target[key] = source[key];
      changed = true;
    }
  }
  if (changed) {
    sharpen(target);
    target.needsUpdate = true;
  }
}

/** Ảnh không anisotropy → mờ ở góc xiên (sàn/mặt bàn nhìn chếch). Texture dùng chung → sửa một lần. */
function sharpen(m: TunableMaterial): void {
  for (const key of SOURCE_MAPS) {
    const t = m[key];
    if (!t || t.anisotropy >= AUTO.anisotropy) continue;
    t.anisotropy = AUTO.anisotropy;
    if (t.version > 0) t.needsUpdate = true;
  }
}

/**
 * Map của vật liệu thư viện gán bất đồng bộ (vendor materials.ts gán một lượt, phát `texturesready`).
 * Gốc còn chờ → bản clone mang `userData.texPending` (warm-up bỏ qua) tới khi chép xong, rồi tự phát
 * `texturesready` như gốc. Gốc đã xong → chép ngay.
 */
function follow(target: TunableMaterial, source: Material, copy: () => void): void {
  if (!hasPendingTextures(source)) {
    copy();
    return;
  }
  const ud = target.userData;
  ud.texPending = ((ud.texPending as number | undefined) ?? 0) + 1;
  void whenTexturesReady(source).then(() => {
    copy();
    const left = (target.userData.texPending as number) - 1;
    if (left > 0) {
      target.userData.texPending = left;
      return;
    }
    delete target.userData.texPending;
    (target as unknown as EventDispatcher<{ texturesready: object }>).dispatchEvent({ type: 'texturesready' });
  });
}

export function tuneItemMaterial(mat: Material, ctx: TuneContext): Material {
  if (!ctx.textures || !useRealism.getState().flags.materials) return mat;
  const m = mat as TunableMaterial;
  if (typeof m.roughness !== 'number') return mat;
  sharpen(m);
  // Bảng ITEM_KIND (ngoại lệ) trước, rồi đoán theo tên vật liệu; còn lại chỉ luật chung `autoPatch`.
  const tableKind = itemKindOf(folderOf(ctx.src), ctx.slotId, ctx.ref);
  const kind = tableKind ?? nameKind(m.name, Boolean(m.map));
  // Kính thư viện vendor giữ nguyên; riêng gương: khe `glass` là kính thư viện trong suốt → nhìn xuyên ra tấm đáy đen.
  if (kind !== 'mirror' && m.name.toLowerCase() === 'glass') return mat;
  // Kính trong suốt: không đổi loại, chỉ kẹp kim loại (kính PBR metal 1 ra gương đen).
  const look = kind && (kind === 'mirror' || !m.transparent) ? KIND_LOOK[kind] : null;
  const patch = autoPatch({
    metalness: m.metalness ?? 0,
    roughness: m.roughness,
    metalnessMap: Boolean(m.metalnessMap),
    roughnessMap: Boolean(m.roughnessMap),
    transparent: m.transparent,
  });
  if (!look && patch.metalness == null && patch.roughness == null) return mat;

  const key = `${mat.uuid}|${look ? kind : 'auto'}`;
  const hit = cache.get(key);
  if (hit) return hit;

  const clone = mat.clone() as TunableMaterial;
  const next = look ? withSheen(clone, look) : clone;
  // clone() chép cả userData (đếm của gốc); `follow` đếm lại cho riêng bản này.
  delete next.userData.texPending;
  // Clone lúc gốc chưa nạp ảnh thì mất ảnh mãi (đồ gỗ ra trắng) → theo gốc tới khi có map.
  follow(next, m, () => copySourceMaps(next, m));
  next.name = `${mat.name}|${look ? kind : 'auto'}`;
  // Loại không tự đặt kim loại/nhám → luật chung.
  if (patch.metalness != null && look?.metalness == null) next.metalness = patch.metalness;
  if (!look) {
    if (patch.roughness != null) next.roughness = patch.roughness;
    next.needsUpdate = true;
    cache.set(key, next);
    return next;
  }
  next.roughness = tunedRoughness(kind!, m.roughness);
  // Vải bọc: `applyUpholstery` (sau vòng gán vật liệu của món) nhuộm theo phong cách.
  tagUpholstery(next, kind, ctx.ref, folderOf(ctx.src));
  if (look.metalness != null) next.metalness = look.metalness;
  if (kind === 'mirror') {
    next.transparent = false;
    next.opacity = 1;
    next.depthWrite = true;
  }
  // clone() đã chép màu sang Color riêng; nhân thẳng (tuyến tính, không qua setRGB/sRGB).
  if (look.tint && next.color) {
    next.color.r *= look.tint[0];
    next.color.g *= look.tint[1];
    next.color.b *= look.tint[2];
  }
  // Color.set nhận hex sRGB, tự đổi sang tuyến tính. Khe có ref thư viện giữ màu người chọn.
  if (look.color && next.color && !ctx.ref) next.color.set(look.color);
  // KHR_materials_specular của mẫu gốc làm trắng bóng: đưa về mặc định.
  if (typeof next.specularIntensity === 'number') next.specularIntensity = Math.min(next.specularIntensity, 0.5);
  // Loại đoán theo tên không lấy normal donor: UV lạ → vải lấm tấm (giường review2).
  if (tableKind && look.donor && ctx.donor && (!next.normalMap || !next.roughnessMap)) {
    const donor = ctx.donor(look.donor) as TunableMaterial | null;
    if (donor) follow(next, donor, () => copyDonorMaps(next, donor));
  }
  next.needsUpdate = true;
  cache.set(key, next);
  return next;
}

/**
 * three bỏ `KHR_materials_pbrSpecularGlossiness` (r147): GLTFLoader coi là metal/rough mặc định
 * (metalness 1, roughness 1) → đồ trắng như kim loại. Plugin đổi lúc nạp: khuếch tán → màu/ảnh màu,
 * bóng → nhám = 1 − gloss, kim loại 0. Ảnh specularGlossiness (gloss ở kênh A, ngược nhám) bỏ qua.
 */
const SPEC_GLOSS = 'KHR_materials_pbrSpecularGlossiness';

interface GltfParserLike {
  json: { materials?: { extensions?: Record<string, unknown> }[] };
  assignTexture(params: Record<string, unknown>, key: string, def: unknown, colorSpace?: string): Promise<unknown>;
}

interface SpecGlossDef {
  diffuseFactor?: [number, number, number, number];
  diffuseTexture?: unknown;
  glossinessFactor?: number;
  specularGlossinessTexture?: unknown;
}

export function specGlossPlugin(parser: GltfParserLike) {
  return {
    name: SPEC_GLOSS,
    extendMaterialParams(index: number, params: Record<string, unknown>): Promise<unknown> {
      const ext = parser.json.materials?.[index]?.extensions?.[SPEC_GLOSS] as SpecGlossDef | undefined;
      if (!ext) return Promise.resolve();
      const gloss = ext.glossinessFactor ?? 1;
      params.metalness = 0;
      // Có ảnh gloss: hệ số thường để 1 → nhám 0 bóng gương; lấy giữa.
      params.roughness = ext.specularGlossinessTexture ? Math.max(0.5, 1 - gloss) : 1 - gloss;
      const pending: Promise<unknown>[] = [];
      if (ext.diffuseFactor) {
        const [r, g, b, a] = ext.diffuseFactor;
        params.color = new Color().setRGB(r, g, b, LinearSRGBColorSpace);
        params.opacity = a;
      }
      if (ext.diffuseTexture) pending.push(parser.assignTexture(params, 'map', ext.diffuseTexture, SRGBColorSpace));
      return Promise.all(pending);
    },
  };
}

/** Gọi từ vendor `configureItemModelLoader` (luật r7). Cùng tham chiếu hàm → GLTFLoader.register không đăng ký trùng. */
export function registerItemLoaderPlugins(loader: { register(cb: typeof specGlossPlugin): unknown }): void {
  loader.register(specGlossPlugin);
}

/** Cho test. */
export function clearItemMaterialCache(): void {
  cache.clear();
}
