/**
 * Texel chết ở mặt hướng lên (mẫu Amazon ABO: ảnh albedo đen ở vùng UV của mặt nóc vì ảnh chụp không thấy nóc →
 * nóc tủ đen tuyền dù mô hình có mặt nóc). Luật chung cho mọi vật liệu item có `map`, không lọc theo tên/id mẫu:
 * - Phân tích MỘT lần mỗi texture ở CPU (canvas ≤ 64×64, cache theo texture): tỉ lệ texel gần đen + màu thân trung bình
 *   (trung bình tuyến tính các texel KHÔNG gần đen).
 * - Chỉ vá khi có đủ texel chết (≥ 5 %) VÀ thân đủ sáng (trung bình ≥ 0,08, thân chiếm ≥ 20 % ảnh): đồ thật sự đen
 *   (tivi, bếp từ, đá đen) có thân tối → không đạt → không vá.
 * - Shader (`deadTexelNode`): ở mảnh có pháp tuyến thế giới hướng lên (ny 0,6 → 0,9 mềm) và albedo tuyến tính < 0,02 (mềm tới
 *   0,04) thay bằng màu thân × màu vật liệu; pha mềm theo cả hai mặt nạ nên không có viền. Không đổi metalness.
 * Tắt: `?disable=deadtexel`. Giới hạn: mặt bàn đen THẬT trên thân sáng (đồ hai màu đen–trắng) bị coi là chết.
 */
import type { Texture } from 'three';
import { float, materialColor, mix, normalWorld, smoothstep, uniform, vec3, vec4 } from 'three/tsl';
import type { Node } from 'three/webgpu';

export const DEAD_LUM = 0.02;
export const DEAD_LUM_SOFT = 0.04;
export const MIN_DEAD_FRAC = 0.05;
export const MIN_BODY_LUM = 0.08;
export const MIN_BODY_FRAC = 0.2;
export const SAMPLE_SIZE = 64;

export interface DeadPlan {
  /** Màu thân trung bình, tuyến tính. */
  rgb: [number, number, number];
  deadFrac: number;
}

const toLinear = (c: number): number => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
const lumOf = (r: number, g: number, b: number): number => 0.2126 * r + 0.7152 * g + 0.0722 * b;

/** Thuần: RGBA 8 bit → kế hoạch vá hoặc null. `srgb` = ảnh mã hoá sRGB (map màu). */
export function planDeadTexel(rgba: ArrayLike<number>, srgb = true): DeadPlan | null {
  const n = Math.floor(rgba.length / 4);
  let seen = 0;
  let dead = 0;
  let bodyN = 0;
  const sum = [0, 0, 0];
  for (let i = 0; i < n; i++) {
    if (rgba[i * 4 + 3]! < 128) continue;
    seen++;
    const c = [0, 1, 2].map((k) => (srgb ? toLinear(rgba[i * 4 + k]! / 255) : rgba[i * 4 + k]! / 255));
    if (lumOf(c[0]!, c[1]!, c[2]!) < DEAD_LUM) {
      dead++;
      continue;
    }
    bodyN++;
    for (let k = 0; k < 3; k++) sum[k]! += c[k]!;
  }
  if (!seen || dead / seen < MIN_DEAD_FRAC || bodyN / seen < MIN_BODY_FRAC) return null;
  const rgb: [number, number, number] = [sum[0]! / bodyN, sum[1]! / bodyN, sum[2]! / bodyN];
  return lumOf(...rgb) >= MIN_BODY_LUM ? { rgb, deadFrac: dead / seen } : null;
}

export const deadTexelOn = (search: string): boolean => !(new URLSearchParams(search).get('disable') ?? '').split(',').includes('deadtexel');
const ON = deadTexelOn(typeof location === 'undefined' ? '' : location.search);

const plans = new WeakMap<Texture, DeadPlan | null>();

/** Đọc ảnh texture vào canvas nhỏ; chưa nạp/không đọc được → undefined (chưa quyết, không cache). */
function readPixels(tex: Texture): Uint8ClampedArray | undefined {
  const img = tex.image as (CanvasImageSource & { width?: number; height?: number; complete?: boolean }) | null | undefined;
  if (!img || !img.width || !img.height || img.complete === false || typeof document === 'undefined') return undefined;
  try {
    const c = document.createElement('canvas');
    c.width = c.height = SAMPLE_SIZE;
    const ctx = c.getContext('2d', { willReadFrequently: true });
    if (!ctx) return undefined;
    ctx.drawImage(img, 0, 0, SAMPLE_SIZE, SAMPLE_SIZE);
    return ctx.getImageData(0, 0, SAMPLE_SIZE, SAMPLE_SIZE).data;
  } catch {
    return undefined;
  }
}

/** Kế hoạch vá của texture (cache). Cờ tắt / ảnh chưa đọc được → null. */
export function deadTexelPlan(tex: Texture | null | undefined, enabled = ON): DeadPlan | null {
  if (!enabled || !tex) return null;
  if (plans.has(tex)) return plans.get(tex)!;
  const px = readPixels(tex);
  if (!px) return null;
  const plan = planDeadTexel(px, tex.colorSpace === 'srgb');
  plans.set(tex, plan);
  return plan;
}

/** Nút albedo đã vá: `base` = nút màu hiện có (đã gồm map); `tint` = màu vật liệu (Color dùng chung). */
export function deadTexelNode(base: Node<'vec4'>, plan: DeadPlan, tint: { r: number; g: number; b: number }): Node<'vec4'> {
  const body = vec3(plan.rgb[0], plan.rgb[1], plan.rgb[2]).mul(uniform(tint as never) as unknown as Node<'vec3'>);
  const lum = base.rgb.dot(vec3(0.2126, 0.7152, 0.0722));
  const w = smoothstep(0.6, 0.9, normalWorld.y).mul(float(1).sub(smoothstep(DEAD_LUM, DEAD_LUM_SOFT, lum)));
  return vec4(mix(base.rgb, body, w), base.a);
}

interface Patchable {
  map?: Texture | null;
  color?: { r: number; g: number; b: number };
  colorNode?: unknown;
  needsUpdate: boolean;
  userData: Record<string, unknown>;
}

/** Gắn vá lên vật liệu (một lần). Trả true nếu vừa gắn. Vật liệu đã có colorNode khác → ghép trên nút đó. */
export function applyDeadTexel(m: Patchable): boolean {
  if (m.userData.deadTexel) return false;
  const plan = deadTexelPlan(m.map);
  if (!plan || !m.color) return false;
  m.userData.deadTexel = true;
  m.colorNode = deadTexelNode(vec4((m.colorNode ?? materialColor) as Node<'vec4'>), plan, m.color);
  m.needsUpdate = true;
  return true;
}
