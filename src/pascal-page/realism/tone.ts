/**
 * M6 làn A: chọn tone mapper bằng `?tone=aces|agx|agx-cal|neutral`. Không cờ → không đụng gì (baseline thật = ACES:
 * R3F `configure()` đặt `gl.toneMapping = ACESFilmicToneMapping` khi `gl` là hàm, đè AgX mà `pascal-render` gán lúc tạo
 * renderer). Vendor gọi `applyTone(gl)` sau khi `ToneMappingExposure` đặt phơi sáng theo chủ đề đang chạy (luật
 * `scripts/realism/m6-tone.mjs`), nên áp cho đúng chủ đề hiện hành (mặc định dáng ấm đè `night`).
 *
 * Mức `low` hoặc backend WebGL2 → ACES với phơi sáng/chấm màu gốc (= baseline).
 * `agx-cal` (căn cứ: `F:/runs/m5/lA/calib.mjs`, đường cong tone của three 0.186): phơi sáng ×0,92 để độ sáng hiển thị trung
 * bình của tường/sàn/gạch/vải bằng ACES@0,8; bão hoà 1,05 → 1,10 để độ rực trung bình bằng ACES (AgX vốn nhạt màu).
 */
import { ACESFilmicToneMapping, AgXToneMapping, NeutralToneMapping } from 'three';

import { backendOf } from './backend';
import { setGrade } from './grade';
import { lookOverride } from './lookOverride';
import { sceneTier } from './tiers';

export type ToneVariant = 'aces' | 'agx' | 'agx-cal' | 'neutral';

export interface ToneSpec {
  toneMapping: number;
  exposureScale: number;
  /** Bão hoà tuyệt đối của chấm màu; không có = giữ (`DEFAULT_LOOK` / `?look=`). */
  saturation?: number;
}

export const TONE_VARIANTS: Record<ToneVariant, ToneSpec> = {
  aces: { toneMapping: ACESFilmicToneMapping, exposureScale: 1 },
  agx: { toneMapping: AgXToneMapping, exposureScale: 1 },
  'agx-cal': { toneMapping: AgXToneMapping, exposureScale: 0.92, saturation: 1.1 },
  neutral: { toneMapping: NeutralToneMapping, exposureScale: 1 },
};

export function parseTone(search: string): ToneVariant | null {
  const raw = new URLSearchParams(search).get('tone');
  return raw !== null && Object.hasOwn(TONE_VARIANTS, raw) ? (raw as ToneVariant) : null;
}

let memo: ToneVariant | null | undefined;
export const toneFlag = (): ToneVariant | null => (memo ??= parseTone(typeof location === 'undefined' ? '' : location.search));

/** Biến thể thật sự áp: `null` = không cờ; mức `low`/WebGL2 → `aces`. */
export function activeTone(gl: unknown, flag = toneFlag(), tier = sceneTier()): ToneVariant | null {
  if (!flag) return null;
  return tier === 'low' || backendOf(gl) !== 'webgpu' ? 'aces' : flag;
}

interface ToneTarget {
  toneMapping: number;
  toneMappingExposure: number;
}

/** Gọi NGAY SAU khi vendor đặt phơi sáng theo chủ đề (phơi sáng nhân một lần mỗi lần đặt lại → không cộng dồn). */
export function applyTone(gl: ToneTarget, variant = activeTone(gl)): void {
  if (!variant) return;
  const spec = TONE_VARIANTS[variant];
  gl.toneMapping = spec.toneMapping;
  gl.toneMappingExposure *= spec.exposureScale;
  if (spec.saturation !== undefined && lookOverride().saturation === undefined) setGrade({ saturation: spec.saturation });
}
