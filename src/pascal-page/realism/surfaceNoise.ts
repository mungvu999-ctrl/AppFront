/**
 * Bề mặt sơn/sàn có độ nhám và màu không đổi trông như nhựa. Lớp này thêm biến thiên tần số thấp
 * theo toạ độ thế giới (2 quãng nhiễu Perlin, chu kỳ ~0,7 m): độ nhám ± 0,2, màu ± 8 % độ sáng
 * (đo 09/11 trên 5 ca, dải 0,05→0,3: dưới 0,2 mắt không thấy ở 1920×1080; 0,3 bắt đầu loang — F:/runs/m3/web/r2-fast)
 * (nhân cùng hệ số cho cả 3 kênh → giữ sắc độ). Dùng chung cho mọi công trình, không số liệu riêng.
 * Gọi từ `tuneWallPaint` (bản sao đã cache) và `tuneFloorFinish`. `?disable=surfnoise` → tắt.
 */
import type { Material } from 'three';
import { clamp, materialColor, materialRoughness, mx_noise_float, positionWorld, uniform, vec4 } from 'three/tsl';
import type { Node } from 'three/webgpu';
import { urlNumbers } from './lookOverride';

/** Biên độ độ nhám quanh giá trị gốc. */
export const ROUGHNESS_AMP = 0.2;
/** Biên độ độ sáng màu (tỉ lệ). */
export const ALBEDO_AMP = 0.08;
/** Chu kỳ quãng nhiễu thô (m). */
export const NOISE_SCALE_M = 0.7;
/** Quãng mịn: tần số × 2,7, trọng số 1/3 (quãng thô 2/3) → tổng vẫn trong ~[-1, 1]. */
const FINE_FREQ = 2.7;
const FINE_OFFSET = 17.3;
const COARSE_WEIGHT = 2 / 3;
const FINE_WEIGHT = 1 / 3;

export const APPLIED_KEY = '__realismSurfNoise';

export const surfaceNoiseDisabled = (search: string): boolean =>
  (new URLSearchParams(search).get('disable') ?? '').split(',').includes('surfnoise');

const disabled = typeof location !== 'undefined' && surfaceNoiseDisabled(location.search);
/** Bản thử đo: `?surf=rough:0.12,albedo:0.06,scale:1` (đọc một lần). */
const TRY = urlNumbers('surf', new Set(['rough', 'albedo', 'scale'] as const));
const AMP = { rough: TRY.rough ?? ROUGHNESS_AMP, albedo: TRY.albedo ?? ALBEDO_AMP, scale: TRY.scale && TRY.scale > 0 ? TRY.scale : NOISE_SCALE_M }; // scale 0 → chia 0 trong shader
/** Uniform → đổi lúc chạy (đo biến thể không cần nạp lại trang): `setSurfaceNoise`. */
const U = { rough: uniform(AMP.rough), albedo: uniform(AMP.albedo), scale: uniform(AMP.scale) };
export function setSurfaceNoise(v: { rough?: number; albedo?: number; scale?: number }): void {
  if (v.rough !== undefined) U.rough.value = v.rough;
  if (v.albedo !== undefined) U.albedo.value = v.albedo;
  if (v.scale !== undefined && v.scale > 0) U.scale.value = v.scale;
}

/** Nhiễu ~[-1, 1] theo vị trí thế giới; 2 quãng, đủ rẻ cho mảng tường lớn. */
export function surfaceNoiseNode(scaleM?: number): Node<'float'> {
  const p = positionWorld.div(scaleM ?? U.scale);
  const coarse = mx_noise_float(p).mul(COARSE_WEIGHT);
  const fine = mx_noise_float(p.mul(FINE_FREQ).add(FINE_OFFSET)).mul(FINE_WEIGHT);
  return coarse.add(fine) as unknown as Node<'float'>;
}

export interface SurfaceNoiseOptions {
  /** Thêm biến thiên độ sáng màu (sàn đã có vân ảnh → tắt). */
  readonly albedo?: boolean;
  readonly scaleM?: number;
}

type NodeLike = Material & {
  isNodeMaterial?: boolean;
  roughness?: number;
  roughnessNode?: unknown;
  colorNode?: unknown;
};

/**
 * Gắn roughnessNode (+ colorNode nếu `albedo`) lên chính `mat` — người gọi tự clone nếu cần.
 * Chỉ vật liệu node PBR đục; gọi lần hai không đổi gì (cờ userData).
 */
export function applySurfaceNoise<T extends Material>(mat: T, opts: SurfaceNoiseOptions = {}): T {
  const m = mat as NodeLike;
  if (disabled || !m.isNodeMaterial || typeof m.roughness !== 'number' || m.transparent || m.userData[APPLIED_KEY]) return mat;
  const n = surfaceNoiseNode(opts.scaleM);
  const rough = (m.roughnessNode ?? materialRoughness) as Node<'float'>;
  m.roughnessNode = clamp(rough.add(n.mul(U.rough)), 0, 1);
  if (opts.albedo) {
    // Kiểu TSL khai materialColor là MaterialNode chung; thực tế là vec4 (màu × ảnh).
    const base = (m.colorNode ?? materialColor) as unknown as Node<'vec4'>;
    m.colorNode = vec4(base.rgb.mul(n.mul(U.albedo).add(1)), base.a);
  }
  m.userData[APPLIED_KEY] = true;
  m.needsUpdate = true;
  return mat;
}
