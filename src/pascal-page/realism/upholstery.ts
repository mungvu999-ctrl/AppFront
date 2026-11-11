/**
 * Render look B (S3 vải): đồ nội thất đọc thành một bộ theo phong cách thay vì giữ màu từng tệp mẫu.
 * Như Blender `apt3.py` main_skin: mỗi món chỉ nhuộm vật liệu vải có diện tích lớn nhất (nệm/bọc)
 * về màu vải của phong cách, giữ chân/khung. Màu × ảnh: chia cho màu trung bình của ảnh để trung bình
 * ra đúng màu đích mà vẫn giữ chi tiết sáng tối của ảnh.
 * Gọi từ vendor `nodes/src/item/renderer.tsx` (luật scripts/realism/r10-fabric.mjs) sau vòng gán vật liệu.
 */
import { Color, SRGBColorSpace, Triangle } from 'three';
import type { BufferGeometry, Material, Mesh, Object3D, Texture } from 'three';
import { UPHOLSTERY_PALETTE } from '@/lib/pascal/scenePalette';
import { sceneRegistry } from '@pascal-app/core';
import { CURTAIN_FOLDER, DRAPE_WOVEN, drapeOn, isGeneratedCurtainId } from '@/lib/pascal/sceneDressingDrape';
import { DEFAULT_SCENE_STYLE, readSceneStyle, SCENE_STYLE_IDS, SCENE_STYLES, type SceneStyleId } from '@/lib/pascal/sceneStyles';
import { applyFabricMaterials, exposeFabricProbe, type FabricItem } from './fabricMat';
import type { MaterialKind } from './itemLook';
import { useRealism } from './store';

/** Loại được coi là vải bọc (phong cách gỗ ấm/sang trọng bọc da). */
const UPHOLSTERY_KINDS: ReadonlySet<MaterialKind> = new Set<MaterialKind>(['fabric', 'bedding', 'leather']);
/** Thảm có họ màu `rug` riêng của phong cách → không nhuộm màu vải bọc. */
const RUG_FOLDER = /carpet|rug/;
/** Ref mặc định của mẫu (thân sofa `library:preset-taupe`), không phải người dùng chọn. */
const CURATED_DEFAULT = /^library:preset-/;
/** Ảnh quá tối thì chia trung bình ra hệ số lớn → kẹp để không cháy sáng. */
export const MAX_GAIN = 4;
/** Chặn chia cho 0 khi ảnh đen tuyền. */
const MIN_MEAN = 1e-4;
/** Cỡ ảnh thu nhỏ để lấy màu trung bình (đủ cho trung bình, rẻ). */
const MEAN_SAMPLE_PX = 16;
/** Ảnh chưa nạp: thử lại 40 × 250 ms ≈ 10 s (như itemMaterials). */
const RETRY_EVERY_MS = 250;
const RETRY_MAX = 40;

export const STYLE_UPHOLSTERY: Readonly<Record<SceneStyleId, { upholstery: string; bedding: string }>> = {
  'am-ap': { upholstery: UPHOLSTERY_PALETTE.amAp, bedding: UPHOLSTERY_PALETTE.amApBedding },
  'hien-dai-sang': { upholstery: UPHOLSTERY_PALETTE.hienDai, bedding: UPHOLSTERY_PALETTE.hienDaiBedding },
  'go-am': { upholstery: UPHOLSTERY_PALETTE.goAm, bedding: UPHOLSTERY_PALETTE.goAmBedding },
  'toi-gian': { upholstery: UPHOLSTERY_PALETTE.toiGian, bedding: UPHOLSTERY_PALETTE.toiGianBedding },
  'sang-trong-toi': { upholstery: UPHOLSTERY_PALETTE.sangTrong, bedding: UPHOLSTERY_PALETTE.sangTrongBedding },
};

export interface UpholsteryTag {
  kind: MaterialKind;
  /** false = ref thư viện người dùng chọn (không phải vải của phong cách) hoặc thảm → giữ màu. */
  recolour: boolean;
  /** `?drape=light`: vật liệu của mẫu rèm; chỉ món rèm FE tự sinh mới nhuộm màu chăn ga (`applyUpholstery`). */
  drape?: true;
}

export interface AreaEntry {
  area: number;
  tag: UpholsteryTag | null;
}

/** Khoá có diện tích lớn nhất trong các vật liệu vải được nhuộm; không có → null. */
export function pickUpholstery<K>(areas: ReadonlyMap<K, AreaEntry>): K | null {
  let best: K | null = null;
  let bestArea = 0;
  for (const [key, { area, tag }] of areas) {
    if (!tag?.recolour || !UPHOLSTERY_KINDS.has(tag.kind) || area <= bestArea) continue;
    best = key;
    bestArea = area;
  }
  return best;
}

/** Phong cách mà ref vải này là họ `fabric` của nó (ref gán tự động theo phong cách). */
export function styleOfFabricRef(ref: string | null | undefined): SceneStyleId | null {
  return SCENE_STYLE_IDS.find((id) => SCENE_STYLES[id].families.fabric === ref) ?? null;
}

// ponytail: phong cách = ref vải phong cách thấy gần nhất (vật liệu không ref không biết phong cách);
// đúng khi cả cảnh một phong cách. Cần chính xác hơn → bridge đẩy phong cách vào store realism.
let lastStyle: SceneStyleId | null = null;

function currentStyle(): SceneStyleId {
  if (lastStyle) return lastStyle;
  try {
    return readSceneStyle(() => localStorage).id;
  } catch {
    return DEFAULT_SCENE_STYLE;
  }
}

/** Gọi từ `tuneItemMaterial` khi tạo bản clone: ghi loại + quyền nhuộm vào userData. */
export function tagUpholstery(mat: Material, kind: MaterialKind | null, ref: string | null | undefined, folder: string | null): void {
  if (!kind || !UPHOLSTERY_KINDS.has(kind)) return;
  // `?drape=light`: vật liệu mẫu rèm mang dấu `drape`; món nào là rèm sinh thì `applyUpholstery` mới nhuộm màu chăn ga.
  // Ref vải dệt rèm sinh dùng (lanh = họ vải của ấm áp) không được coi là "phong cách hiện tại" → khỏi nhuộm nhầm cả cảnh.
  const drape = (folder === CURTAIN_FOLDER || folder === `${CURTAIN_FOLDER}-uv`) && drapeOn('light');
  const style = ref ? styleOfFabricRef(ref) : null;
  if (style && !(drape && DRAPE_WOVEN.has(ref!))) lastStyle = style;
  const auto = !ref || style != null || CURATED_DEFAULT.test(ref);
  const tag: UpholsteryTag = { kind, recolour: !(folder && RUG_FOLDER.test(folder)) && auto, ...(drape ? { drape: true } : {}) };
  mat.userData.upholstery = tag;
}

const BYTE_MAX = 255;

const scratch = new Color();

/** Byte sRGB → tuyến tính (đường cong sRGB của three). */
export function srgbToLinear(byte: number): number {
  const v = byte / BYTE_MAX;
  return scratch.setRGB(v, v, v, SRGBColorSpace).r;
}

/** Màu trung bình tuyến tính của ảnh RGBA (byte sRGB). */
export function meanLinear(rgba: ArrayLike<number>): [number, number, number] {
  let [r, g, b] = [0, 0, 0];
  const n = Math.floor(rgba.length / 4);
  for (let i = 0; i < n; i++) {
    r += srgbToLinear(rgba[i * 4]!);
    g += srgbToLinear(rgba[i * 4 + 1]!);
    b += srgbToLinear(rgba[i * 4 + 2]!);
  }
  return n ? [r / n, g / n, b / n] : [1, 1, 1];
}

/** Hệ số màu vật liệu để màu × ảnh (trung bình `mean`) ra trung bình `target`; giữ tỉ lệ sáng tối của ảnh. */
export function compensate(target: readonly number[], mean: readonly number[]): [number, number, number] {
  const g = (c: number) => Math.min(MAX_GAIN, target[c]! / Math.max(mean[c]!, MIN_MEAN));
  return [g(0), g(1), g(2)];
}

const meanCache = new Map<string, [number, number, number]>();

/** Nguồn `drawImage` vẽ được; ảnh KTX2/nén (`{width,height,mipmaps}`), DataTexture (`{data,…}`) thì không. */
function drawable(img: unknown): img is CanvasImageSource {
  return (
    (typeof HTMLImageElement !== 'undefined' && img instanceof HTMLImageElement) ||
    (typeof HTMLCanvasElement !== 'undefined' && img instanceof HTMLCanvasElement) ||
    (typeof ImageBitmap !== 'undefined' && img instanceof ImageBitmap) ||
    (typeof OffscreenCanvas !== 'undefined' && img instanceof OffscreenCanvas)
  );
}

/**
 * Trung bình tuyến tính của ảnh vân; null = ảnh chưa nạp. Ảnh không vẽ được lên canvas (vân nén KTX2,
 * ảnh hỏng) → [1,1,1] (màu = đích) thay vì để `drawImage` ném TypeError trong lúc dựng đồ vật
 * (ErrorBoundary item-model bỏ cả món). DataTexture RGBA 8 bit đọc thẳng từ `data`.
 */
export function textureMean(tex: Texture): [number, number, number] | null {
  const hit = meanCache.get(tex.uuid);
  if (hit) return hit;
  const img = tex.image as { width?: number; complete?: boolean; data?: unknown } | null | undefined;
  if (!img?.width || img.complete === false || typeof document === 'undefined') return null;
  let mean: [number, number, number] = [1, 1, 1];
  const data = img.data;
  if (data instanceof Uint8Array || data instanceof Uint8ClampedArray) {
    mean = meanLinear(data);
  } else if (drawable(img)) {
    const canvas = document.createElement('canvas');
    canvas.width = canvas.height = MEAN_SAMPLE_PX;
    const ctx = canvas.getContext('2d');
    if (!ctx) return null;
    try {
      ctx.drawImage(img, 0, 0, MEAN_SAMPLE_PX, MEAN_SAMPLE_PX);
      mean = meanLinear(ctx.getImageData(0, 0, MEAN_SAMPLE_PX, MEAN_SAMPLE_PX).data);
    } catch {
      // Ảnh hỏng, hoặc khác nguồn không CORS (canvas "bẩn") → coi trung bình = 1 (màu = đích).
    }
  }
  meanCache.set(tex.uuid, mean);
  return mean;
}

const areaCache = new WeakMap<BufferGeometry, Map<string, number>>();

/** Diện tích tam giác của geometry trong khoảng chỉ số [start, start+count). */
export function geometryArea(geo: BufferGeometry, start = 0, count = Infinity): number {
  const key = `${start}|${count}`;
  const byRange = areaCache.get(geo) ?? new Map<string, number>();
  areaCache.set(geo, byRange);
  const hit = byRange.get(key);
  if (hit != null) return hit;
  const pos = geo.getAttribute('position');
  if (!pos) return 0;
  const index = geo.getIndex();
  const total = index ? index.count : pos.count;
  const end = Math.min(total, start + count);
  const at = (i: number) => (index ? index.getX(i) : i);
  const tri = new Triangle();
  let area = 0;
  for (let i = start; i + 2 < end; i += 3) area += tri.setFromAttributeAndIndices(pos, at(i), at(i + 1), at(i + 2)).getArea();
  byRange.set(key, area);
  return area;
}

type Colourable = Material & { color?: Color; map?: Texture | null };

function recolour(mat: Colourable, hex: string, tries = 0): void {
  if (!mat.color || mat.userData.upholsteryHex === hex) return;
  const target = new Color(hex);
  if (!mat.map) {
    mat.color.copy(target);
  } else {
    const mean = textureMean(mat.map);
    if (!mean) {
      if (tries < RETRY_MAX) setTimeout(() => recolour(mat, hex, tries + 1), RETRY_EVERY_MS);
      return;
    }
    mat.color.setRGB(...compensate([target.r, target.g, target.b], mean));
  }
  mat.userData.upholsteryHex = hex;
}

/** Mesh thuộc món rèm FE tự sinh: tổ tiên của nó là object đăng ký dưới id `…DRESS-curtain-…` (sceneRegistry). */
export function isGeneratedCurtainItem(mesh: Object3D | undefined, nodes: ReadonlyMap<string, Object3D> = sceneRegistry.nodes): boolean {
  if (!mesh) return false;
  for (const [id, obj] of nodes) {
    if (!isGeneratedCurtainId(id)) continue;
    for (let o: Object3D | null = mesh; o; o = o.parent) if (o === obj) return true;
  }
  return false;
}

/**
 * Nhuộm vật liệu vải lớn nhất của một món đồ (danh sách mesh của món). `item` (vòng 11 b3, luật r10-fabric truyền node):
 * `?enable=fabricmat` thay bề mặt vải bằng vật liệu vải dùng chung TRƯỚC khi chọn/nhuộm (`fabricMat.ts`).
 */
export function applyUpholstery(meshes: readonly Mesh[], textures: boolean, item?: FabricItem): void {
  if (!textures || !useRealism.getState().flags.materials) return;
  applyFabricMaterials(meshes, item);
  exposeFabricProbe();
  const areas = new Map<Material, AreaEntry>();
  const add = (mat: Material | undefined, area: number) => {
    if (!mat) return;
    const prev = areas.get(mat);
    areas.set(mat, { area: (prev?.area ?? 0) + area, tag: (mat.userData.upholstery as UpholsteryTag | undefined) ?? null });
  };
  for (const mesh of meshes) {
    mesh.updateWorldMatrix(true, false);
    const s = mesh.matrixWorld.getMaxScaleOnAxis();
    const scale = s * s;
    if (Array.isArray(mesh.material)) {
      const mats = mesh.material;
      if (!mesh.geometry.groups.length) add(mats[0], geometryArea(mesh.geometry) * scale);
      for (const g of mesh.geometry.groups) add(mats[g.materialIndex ?? 0], geometryArea(mesh.geometry, g.start, g.count) * scale);
    } else {
      add(mesh.material, geometryArea(mesh.geometry) * scale);
    }
  }
  const pick = pickUpholstery(areas) as Colourable | null;
  if (!pick) return;
  const palette = STYLE_UPHOLSTERY[currentStyle()];
  const tag = pick.userData.upholstery as UpholsteryTag;
  const bedding = tag.kind === 'bedding' || (tag.drape === true && isGeneratedCurtainItem(meshes[0]));
  recolour(pick, bedding ? palette.bedding : palette.upholstery);
}
