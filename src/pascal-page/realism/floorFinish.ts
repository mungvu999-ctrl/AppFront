/**
 * Sàn đúng cỡ thật (S2, theo `F:/runs/login-tour/pbr.py` `pbr_mat`). Thư viện Pascal lặp mọi ảnh
 * 1 lần / mét (UV sàn = mét), dù ảnh phủ bao nhiêu mét thật; màu là trắng × ảnh.
 * Luật `scripts/realism/r10-floors.mjs` cho `createMaterialFromPresetRef` đi qua đây:
 * - `floorFinishPreset`: repeat = 1 / sizeM, normalScale theo bảng (bản sao preset, cache vendor theo JSON).
 * - `tuneFloorFinish`: colorNode TSL = màu đích × (1 + (lum / lumTB − 1) · contrast) — giữ vân ảnh,
 *   đổi tông về bảng màu; đá/gạch có `groutM` thêm ron mảnh tính bằng fract(UV) + fwidth (sắc ở mọi tầm).
 * - Độ nhám biến thiên tần số thấp (`surfaceNoise`, `?disable=surfnoise` tắt); màu giữ nguyên vân ảnh.
 * Cờ `materials` tắt → y cũ.
 */
import type { Material } from 'three';
import { clamp, color, float, fract, fwidth, luminance, materialColor, materialRoughness, max, min, mix, smoothstep, uv, vec3, vec4 } from 'three/tsl';
import type { Node } from 'three/webgpu';

import { SCENE_PALETTE } from '@/lib/pascal/scenePalette';

import { FLOOR_GLOSS, FLOOR_ROUGH_MIN, type FloorKind, matOn, matxOn } from './matx';
import { useRealism } from './store';
import { applySurfaceNoise, surfaceNoiseNode } from './surfaceNoise';

export interface FloorFinish {
  /** Cạnh thật mà một ảnh phủ (m). */
  readonly sizeM: number;
  /** Màu đích (sRGB) — `null` giữ màu ảnh, chỉ chỉnh độ tương phản vân. */
  readonly target: string | null;
  /** Độ đậm vân: 0 = phẳng màu đích, 1 = vân như ảnh. */
  readonly contrast: number;
  readonly normalScale: number;
  /** Độ sáng trung bình của ảnh (sRGB 0..1, đo trên ảnh xem trước thư viện). */
  readonly scanLum: number;
  /** Cạnh viên gạch/đá cho ron vẽ bằng shader (m); thiếu = không vẽ ron. */
  readonly groutM?: number;
  /** Họ vật liệu (M5-L3b `?matx=floor` chọn độ bóng theo họ). */
  readonly kind?: FloorKind;
}

const WOOD = { contrast: 0.9, normalScale: 0.6, kind: 'wood' } as const;
const TILE = { contrast: 0.6, normalScale: 0.3, kind: 'tile' } as const;
const MARBLE = { contrast: 0.12, normalScale: 0.15, kind: 'stone' } as const;
const CONCRETE = { contrast: 0.5, normalScale: 0.25, kind: 'concrete' } as const;

/** Ron 2,5 mm như cảnh Blender; ron sẫm hơn mặt đá một bậc. */
export const GROUT_WIDTH_M = 0.0025;
export const GROUT_SHADE = 0.82;
/** Cạnh viên đá lát (0,6–0,8 m ở `pbr.py`). */
const MARBLE_TILE_M = 0.8;
/** sRGB → tuyến tính xấp xỉ, đủ cho độ sáng trung bình. */
const SRGB_GAMMA = 2.2;
/** Chặn hệ số vân để điểm sáng/tối gắt của ảnh không cháy hay đen kịt. */
const DETAIL_MIN = 0;
const DETAIL_MAX = 3;
/** Tránh chia 0 khi điểm ảnh đen tuyệt đối. */
const LUM_EPSILON = 1e-4;

// M4-L2: tile79 đếm trên ảnh 512 px = 4 × 4 viên → 2,4 m (viên 0,6 m). Gỗ/gạch khác đếm lại cùng cách, khớp sẵn.
// ponytail: sizeM và scanLum ước lượng (ảnh xem trước 128 px, `pbr.py`), chưa đo trên ảnh ktx2 gốc —
// chỉnh mắt trên trình duyệt; gạch có ron sẵn trong ảnh (tile79/20, tiles4, lightceramic24) không
// vẽ ron shader vì chưa biết số viên/ảnh (vẽ lệch = ron đôi).
/** Vật liệu sàn mà `SCENE_STYLES[*].floor` dùng (`src/lib/pascal/sceneStyles.ts`). */
export const FLOOR_FINISHES: Readonly<Record<string, FloorFinish>> = {
  'flooring-woodparquet76': { sizeM: 1.2, target: SCENE_PALETTE.floorOak, scanLum: 0.65, ...WOOD },
  'wood-hungarianparquet10': { sizeM: 1.6, target: SCENE_PALETTE.floorOak, scanLum: 0.514, ...WOOD },
  'wood-hungarianparquet2': { sizeM: 1.6, target: SCENE_PALETTE.walnut, scanLum: 0.229, ...WOOD },
  'wood-woodplank48': { sizeM: 2, target: SCENE_PALETTE.bark, scanLum: 0.42, ...WOOD },
  'wood-woodplank19': { sizeM: 2, target: null, scanLum: 0.49, ...WOOD },
  'wood-woodenparquet11': { sizeM: 2, target: SCENE_PALETTE.walnut, scanLum: 0.244, ...WOOD },
  'flooring-tile79': { sizeM: 2.4, target: SCENE_PALETTE.tile, scanLum: 0.815, ...TILE },
  'flooring-tile20': { sizeM: 1.2, target: SCENE_PALETTE.tile, scanLum: 0.799, ...TILE },
  'flooring-lightceramic24': { sizeM: 1.2, target: SCENE_PALETTE.tile, scanLum: 0.608, ...TILE },
  'flooring-tiles4': { sizeM: 1, target: SCENE_PALETTE.mosaic, scanLum: 0.511, ...TILE },
  'flooring-statuarettowhite': { sizeM: 1.5, target: SCENE_PALETTE.tile, scanLum: 0.743, groutM: MARBLE_TILE_M, ...MARBLE },
  'concrete-polished': { sizeM: 3, target: SCENE_PALETTE.exterior, scanLum: 0.421, ...CONCRETE },
  'concrete-raw': { sizeM: 3, target: null, scanLum: 0.648, ...CONCRETE },
};

const LIBRARY_PREFIX = 'library:';

/** `library:<id>` → mục bảng; ref khác/không có → `null`. */
export function floorFinishOf(ref: string | undefined): FloorFinish | null {
  if (!ref?.startsWith(LIBRARY_PREFIX)) return null;
  return FLOOR_FINISHES[ref.slice(LIBRARY_PREFIX.length)] ?? null;
}

const enabled = (): boolean => useRealism.getState().flags.materials;

/** Lặp ảnh theo cỡ thật (UV mét). */
export const repeatOf = (finish: FloorFinish): number => 1 / finish.sizeM;

/** Độ sáng trung bình tuyến tính của ảnh (shader đọc ảnh đã giải mã sRGB → tuyến tính). */
export const linearMean = (finish: FloorFinish): number => finish.scanLum ** SRGB_GAMMA;

/** Hệ số nhân màu đích tại một điểm có độ sáng `lum` (tuyến tính) — như `pbr_mat`. */
export function detailFactor(lum: number, finish: FloorFinish): number {
  const f = 1 + (lum / linearMean(finish) - 1) * finish.contrast;
  return Math.min(DETAIL_MAX, Math.max(DETAIL_MIN, f));
}

/** Nửa bề rộng ron theo đơn vị viên (fract của UV / groutM). */
export const groutHalfWidth = (groutM: number): number => GROUT_WIDTH_M / 2 / groutM;

/** Ron tại toạ độ mét `(x, y)` (không khử răng cưa): 1 = ron, 0 = mặt viên. Dùng để kiểm phép tính shader. */
export function groutAt(x: number, y: number, groutM: number): number {
  const half = groutHalfWidth(groutM);
  const edge = (v: number): number => {
    const f = v / groutM - Math.floor(v / groutM);
    return Math.min(f, 1 - f) <= half ? 1 : 0;
  };
  return Math.max(edge(x), edge(y));
}

interface PresetLike {
  readonly mapProperties: Readonly<Record<string, unknown>>;
}

/** Bản sao preset với repeat cỡ thật + normal nhẹ; preset ngoài bảng / cờ tắt → nguyên. */
export function floorFinishPreset<T extends PresetLike>(ref: string | undefined, preset: T): T {
  const finish = floorFinishOf(ref);
  if (!finish || !enabled()) return preset;
  const repeat = repeatOf(finish);
  return {
    ...preset,
    mapProperties: {
      ...preset.mapProperties,
      repeatX: repeat,
      repeatY: repeat,
      normalScaleX: finish.normalScale,
      normalScaleY: finish.normalScale,
    },
  } as T;
}

type NodeLike = Material & { isNodeMaterial?: boolean; roughness?: number; colorNode?: unknown; roughnessNode?: unknown; roughnessMap?: unknown };

const TUNED = '__realismFloor';

function finishColorNode(finish: FloorFinish) {
  // Kiểu TSL khai materialColor là MaterialNode chung; thực tế là vec4 (màu × ảnh).
  const scan = materialColor as unknown as Node<'vec4'>;
  const mean = linearMean(finish);
  const lum = luminance(scan.rgb);
  const detail = clamp(lum.div(mean).sub(1).mul(finish.contrast).add(1), DETAIL_MIN, DETAIL_MAX);
  // Không có màu đích: sắc độ của chính ảnh, đưa về độ sáng trung bình rồi nhân vân.
  const tint = finish.target ? (color(finish.target) as unknown as Node<'vec3'>) : vec3(scan.rgb.div(max(lum, LUM_EPSILON)).mul(mean));
  const base = tint.mul(detail);
  if (!finish.groutM) return vec4(base, scan.a);
  // UV sàn = mét → fract(UV / cạnh viên); fwidth giữ mép ron ~1 px ở mọi khoảng cách.
  const p = uv().div(finish.groutM);
  const f = fract(p);
  const d = min(f, f.oneMinus());
  const w = fwidth(p);
  const half = float(groutHalfWidth(finish.groutM));
  const lineAt = (dist: Node<'float'>, width: Node<'float'>) => smoothstep(half.sub(width), half.add(width), dist).oneMinus();
  const mask = max(lineAt(d.x, w.x), lineAt(d.y, w.y));
  return vec4(mix(base, base.mul(GROUT_SHADE), mask), scan.a);
}

/**
 * M5-L3b `?matx=floor`: gạch/đá men bóng (nhám cố định, bỏ ảnh nhám), gỗ phủ lacquer (nhám ảnh × hệ số).
 * Nhiễu nhám tần số thấp biên độ riêng (nhỏ hơn mức chung — mặt bóng loang rõ hơn). false = họ không đổi.
 */
function glossFloor(m: NodeLike, finish: FloorFinish): boolean {
  const g = finish.kind ? FLOOR_GLOSS[finish.kind] : null;
  if (!g) return false;
  const noise = surfaceNoiseNode().mul(g.noise);
  if (g.roughness != null) {
    m.roughnessMap = null;
    m.roughness = g.roughness;
    m.roughnessNode = clamp(float(g.roughness).add(noise), 0.02, 1);
  } else {
    m.roughnessNode = clamp((materialRoughness as unknown as Node<'float'>).mul(g.scale ?? 1).add(noise), 0.02, 1);
  }
  return true;
}

/**
 * M5-LC `?mat=floor-rough`: sàn trong nhà (gỗ/gạch/đá; bê tông = ngoài nhà, giữ nguyên) nhám ≥ `FLOOR_ROUGH_MIN`
 * sau mọi chỉnh khác (kể cả `?matx=floor`), clearcoat 0 — bớt phản xạ gương cháy trắng gần đèn/cửa.
 */
export function roughFloor(m: NodeLike & { clearcoat?: number }, finish: FloorFinish): boolean {
  if (finish.kind !== 'wood' && finish.kind !== 'tile' && finish.kind !== 'stone') return false;
  m.roughnessNode = max((m.roughnessNode ?? materialRoughness) as Node<'float'>, FLOOR_ROUGH_MIN);
  if (typeof m.clearcoat === 'number') m.clearcoat = 0;
  return true;
}

/** Đổi màu + ron cho vật liệu node PBR của sàn trong bảng; mọi thứ khác trả nguyên. */
export function tuneFloorFinish<T extends Material | null>(ref: string | undefined, mat: T): T {
  const finish = floorFinishOf(ref);
  const m = mat as NodeLike | null;
  if (!m || !finish || !enabled() || !m.isNodeMaterial || typeof m.roughness !== 'number') return mat;
  if (m.userData[TUNED]) return mat;
  m.colorNode = finishColorNode(finish);
  if (!(matxOn('floor') && glossFloor(m, finish))) applySurfaceNoise(m);
  // ponytail: vật liệu cache theo preset, dùng chung cho sàn lẫn mặt bàn/tường sơn cùng mã `library:flooring-*` → nhám áp
  // cả mặt không phải sàn. Tách cần khoá cache riêng + cờ ở ~27 chỗ gọi vendor; làm khi có người sơn đá bóng lên bàn.
  if (matOn('floor-rough')) roughFloor(m, finish);
  m.userData[TUNED] = true;
  m.needsUpdate = true;
  return mat;
}
