/**
 * Núm đo dáng render (phơi sáng, tương phản, bão hoà, môi trường, bloom) — một chỗ cho số mặc định
 * và cho bản thử qua URL để so ảnh cùng góc máy giữa nhiều dự án:
 * `?look=exposure:0.9,contrast:1.1,saturation:1.05,env:0.7,envDark:0.3,bloom:0.15` (tập con bất kỳ;
 * khoá lạ, số hỏng hay âm bị bỏ qua). Không có tham số → đúng `DEFAULT_LOOK`, không đổi gì.
 *
 * Nơi dùng: `renderLook.ts` (phơi sáng), `scripts/realism/r12-look-override.mjs` (chấm màu
 * `GRADE_PARAMS`, bloom đèn ở `post-processing.tsx`; `ENV_INTENSITY`/`ENV_INTENSITY_DARK` ở
 * `scene-environment.tsx`). Đọc URL một lần: đổi `?look=` phải tải lại trang — trừ tương phản/bão hoà/phơi sáng,
 * đổi được lúc chạy qua `__pascalProbe.setLook({ grade, exposure })` (`realism/grade.ts`).
 */
export interface Look {
  /** Phơi sáng tone map; không đặt = số theo bậc trong `renderLook.ts` (`DAY_LOOK_TIERS`/`RENDER_LOOK_TIERS`). */
  exposure?: number;
  /** Tương phản quanh xám 18 % trước AgX. */
  contrast: number;
  saturation: number;
  /** `scene.environmentIntensity` của chủ đề sáng (Ban ngày, Nắng chiều). */
  env: number;
  /** `scene.environmentIntensity` của chủ đề tối (Ban đêm). */
  envDark: number;
  /** Cường độ bloom điểm sáng đèn (0 = tắt). */
  bloom: number;
}

/** Số hiệu lực hôm nay (sau `scripts/pascal-render.mjs`); đổi mặc định ở ĐÂY sau khi đo. */
export const DEFAULT_LOOK: Readonly<Look> = { contrast: 1.2, saturation: 1.05, env: 0.8, envDark: 0.3, bloom: 0.15 };
// 09/11: 1,12/1,08 → 1,20/1,05 theo dải đo F:/runs/m3/web/r2-grade (σ nội thất +5…8 %, sáng trung bình +2…3, không ám cam như 1,25/1,12).

const KEYS = new Set<keyof Look>(['exposure', 'contrast', 'saturation', 'env', 'envDark', 'bloom']);

/** `?<param>=k:v,k:v` → các số hợp lệ (hữu hạn, ≥ 0) trong `keys`; dùng chung cho `look`, `surf`, `glass`. */
export function parseNumParam<K extends string>(search: string, param: string, keys: ReadonlySet<K>): Partial<Record<K, number>> {
  const out: Partial<Record<K, number>> = {};
  for (const pair of (new URLSearchParams(search).get(param) ?? '').split(',')) {
    const [key = '', raw = ''] = pair.split(':').map((s) => s.trim());
    const value = raw === '' ? NaN : Number(raw);
    if (keys.has(key as K) && Number.isFinite(value) && value >= 0) out[key as K] = value;
  }
  return out;
}

/** `?look=` → các số hợp lệ (hữu hạn, ≥ 0). */
export const parseLook = (search: string): Partial<Look> => parseNumParam(search, 'look', KEYS);

/** Bản thử URL cho một tham số, đọc một lần; không có `location` → `{}`. */
export function urlNumbers<K extends string>(param: string, keys: ReadonlySet<K>): Partial<Record<K, number>> {
  return parseNumParam(typeof location === 'undefined' ? '' : location.search, param, keys);
}

let memo: Partial<Look> | undefined;

/** Bản thử từ URL, đọc một lần; không có `location` (SSR, vitest node) → `{}`. */
export function lookOverride(): Partial<Look> {
  memo ??= parseLook(typeof location === 'undefined' ? '' : location.search);
  return memo;
}

/** `values` với bản thử URL đè lên (bản thử thắng). */
export function withLookOverride<T extends Partial<Look>>(values: T): T & Partial<Look> {
  return { ...values, ...lookOverride() };
}
