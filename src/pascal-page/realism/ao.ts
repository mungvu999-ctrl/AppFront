/**
 * S5 (render-look B): AO rẻ khi SSGI tắt (mức `low`, iGPU) + trọng số AO "chỉ làm tối ánh sáng gián tiếp".
 * Vendor đọc qua `@pascal-realism/ao` (luật `scripts/realism/r10-ao.mjs`, `post-processing.tsx`).
 *
 * - Ai có AO gì: `aoModeFor` — SSGI bật → AO của SSGI; SSGI tắt mà vẫn có hậu kỳ (WebGPU, `rendered`) →
 *   GTAO nửa độ phân giải, ít mẫu (ngân sách ≤2 ms; SSGI đầy đủ tốn 382 ms p50 trên iGPU). WebGL2 không dựng
 *   chuỗi hậu kỳ (`isWebGpuBackend`) → không AO. `?disable=ao` / `?disable=gtao` tắt GTAO để so A/B.
 * - Trọng số: chỉ có ảnh đã chiếu sáng + albedo (MRT `diffuseColor`), không tách trực tiếp/gián tiếp. Ước độ rọi
 *   E = độ sáng(ảnh) / độ sáng(albedo): chỗ nắng chiếu E cao → AO mờ dần về 1; góc/chân đồ chỉ có ambient → AO đủ.
 */
import { float, luminance, max, mix, smoothstep } from 'three/tsl';
import type { Node } from 'three/webgpu';
import { traaEnabled } from './traa';

export type AoMode = 'ssgi' | 'gtao' | 'none';

/** Nửa độ phân giải: GTAO chỉ cần tần số thấp (góc tường, chân đồ), lấy mẫu song tuyến khi ghép. */
export const GTAO_RESOLUTION_SCALE = 0.5;
/** GTAONode: < 30 mẫu → 3 hướng × ceil(mẫu/3) bước; 6 = 3 × 2, rẻ nhất còn ra bóng góc. */
export const GTAO_SAMPLES = 6;
/** Bán kính (m): đủ ôm góc tường-trần và khe chân sofa/giường, không loang ra giữa sàn. */
export const GTAO_RADIUS_M = 0.5;
/** Độ dày (m) coi là che: nhỏ hơn mặc định 1 để mép bàn mỏng không đổ quầng lên tường phía sau. */
export const GTAO_THICKNESS_M = 0.5;
/** Mũ đậm (ao^k) — cùng vai trò `TRAA_AO_POW` của nhánh SSGI. */
export const GTAO_POW = 1.4;

/** Albedo tối hơn mức này coi như bằng nó (tránh chia cho ~0 ở đồ đen). */
export const AO_ALBEDO_FLOOR = 0.04;
/**
 * Ngưỡng độ rọi E (tuyến tính, trước tone map): dưới `LO` = chỉ ánh sáng nền → AO đủ; trên `HI` = nắng/đèn trực
 * tiếp → không AO. ponytail: ước lượng theo tỉ lệ ảnh/albedo, specular cũng bị tính là "sáng".
 *
 * L3 (m3-web): 0,6/1,2 → 1,0/1,8. Ước E vùng BÓNG của Ban ngày (mặc định): môi trường 0,8 × trời gradient (luma
 * trung bình nửa cầu trên ≈ 0,7) + hemi 0,25 + ambient 0,1 ≈ 0,9 ở sàn, ≈ 0,75 ở tường → ngưỡng cũ làm AO sàn mờ
 * còn ~một nửa đúng ở chân tường/dưới đồ (ảnh `F:/runs/m3/web/l3-1`). Nắng: 3,2 × sin 39° + 0,9 ≈ 2,9 ở sàn;
 * đèn chính chủ đề tối 1,7 × 0,8 + ~0,45 ≈ 1,8 → vẫn trên `HI`, chỗ nắng/đèn trực tiếp không bị AO làm tối.
 */
export const AO_DIRECT_LO = 1.0;
export const AO_DIRECT_HI = 1.8;

export interface AoInput {
  /** `isWebGpuBackend(renderer)` — WebGL2 không có chuỗi hậu kỳ. */
  webGpu: boolean;
  /** `tierConfig(tier).postFx` và không bị host tắt. */
  postFx: boolean;
  shading: string;
  /** SSGI có thực sự dựng trong pipeline này không. */
  ssgiEnabled: boolean;
  /** `location.search` (cờ `?disable=`). */
  search: string;
  /**
   * Cảnh dựng 1 mẫu (TRAA bật, nền không trong suốt). Tắt → `pass()` MSAA → depth là
   * `texture_depth_multisampled_2d`, GTAONode gọi `textureGather` trên nó → pipeline WGSL hỏng, AO rác làm tối cả
   * phần ambient (đồ "biến mất") tới khi tải lại trang. Nên không TRAA thì không GTAO.
   */
  traa: boolean;
}

export function aoModeFor(input: AoInput): AoMode {
  if (!input.webGpu || !input.postFx || input.shading !== 'rendered') return 'none';
  if (input.ssgiEnabled) return 'ssgi';
  if (!input.traa) return 'none';
  const disable = (new URLSearchParams(input.search).get('disable') ?? '').split(',');
  return disable.includes('ao') || disable.includes('gtao') ? 'none' : 'gtao';
}

/**
 * Cờ vendor dùng lúc dựng pipeline (đã qua kiểm WebGPU + postFx ở trên đó). `traa` tính y như `traaOn` của
 * `r3-traa.mjs` (trừ vế `needsNormalMRT` — GTAO bật thì MRT bật) → GTAO bật ⇒ scene pass 1 mẫu.
 */
export function gtaoOn(shading: string, ssgiEnabled: boolean, transparentBackground: boolean): boolean {
  const search = typeof location === 'undefined' ? '' : location.search;
  const traa = !transparentBackground && traaEnabled();
  return aoModeFor({ webGpu: true, postFx: true, shading, ssgiEnabled, search, traa }) === 'gtao';
}

const smooth = (lo: number, hi: number, x: number): number => {
  const t = Math.min(1, Math.max(0, (x - lo) / (hi - lo)));
  return t * t * (3 - 2 * t);
};

/** Bản số thuần của `aoIndirect` (cho test): hệ số nhân màu tại một điểm. */
export function aoFactor(ao: number, litLum: number, albedoLum: number): number {
  const direct = smooth(AO_DIRECT_LO, AO_DIRECT_HI, litLum / Math.max(albedoLum, AO_ALBEDO_FLOOR));
  return ao + (1 - ao) * direct;
}

/** Nút TSL: AO đã giảm ở chỗ nắng/đèn trực tiếp. `lit`, `albedo` là vec3 tuyến tính. */
export function aoIndirect(ao: Node<'float'>, lit: Node<'vec3'>, albedo: Node<'vec3'>) {
  const irradiance = luminance(lit).div(max(luminance(albedo), float(AO_ALBEDO_FLOOR)));
  return mix(ao, float(1), smoothstep(float(AO_DIRECT_LO), float(AO_DIRECT_HI), irradiance));
}
