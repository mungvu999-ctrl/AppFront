/**
 * Dáng render ấm cho trang 3D: đè chủ đề `night` của Pascal tại chỗ (Pascal không cho thêm
 * chủ đề mới — `SCENE_THEME_BY_ID` riêng tư, id lạ rơi về `studio`) và chỉnh SSGI. `main.tsx`
 * gọi một lần trước khi vẽ, truyền đúng hai đối tượng thật của Pascal; tệp này không nhập
 * `@pascal-app/*` để vitest chạy được. Giữ `appearance: 'dark'` (đèn trong nhà chỉ bật ở chủ
 * đề tối). Màu ở `RENDER_LOOK_PALETTE`, số ở đây.
 *
 * Hai bậc chất lượng (FE3D-FIX-004 thẻ R): có WebGPU thì Pascal dựng chuỗi hậu kỳ (SSGI có
 * GI dội + AO, bloom, vignette — `scripts/pascal-render.mjs`), nên ánh sáng nền hạ thấp cho góc
 * tối và vũng đèn ấm, phần dội để GI lo. Không có WebGPU (WebGL2) thì không có hậu kỳ: không
 * GI/AO bù, nên giữ ánh sáng nền cao hơn để nhà không tối om.
 */
import { RENDER_LOOK_PALETTE as C } from '@/lib/pascal/scenePalette';

import { lookOverride, withLookOverride } from './realism/lookOverride';
import { useRealism } from './realism/store';
import { tierConfig } from './realism/tiers';

/** Chủ đề Pascal của hai chế độ ánh sáng (thẻ "Ánh sáng", `./LightingCard`). */
export const NIGHT_THEME_ID = 'night';
/**
 * Ban ngày đè `studio`: phông trắng trung tính (#fbfbfa, đất #e9e7e2) sẵn đúng ý, có đủ đèn
 * chính + đèn phụ, `appearance: 'light'` nên Pascal tắt đèn trong nhà. `overcast` chỉ một đèn
 * yếu, phông xám xanh — trời âm u, trái với nắng.
 */
export const DAY_THEME_ID = 'studio';
/** "Nắng chiều" = chủ đề `sunset` sẵn có của Pascal, mặt trời hạ ~15° + ấm hơn (`scripts/realism/r4-lighting.mjs`). */
export const SUNSET_THEME_ID = 'sunset';

/** Phần của `SceneTheme` (viewer/src/lib/scene-themes.ts) mà dáng này đè. */
export interface RenderLookTheme {
  background: string;
  backgroundSky?: string;
  ground: string;
  ambient: { color: string; intensity: number };
  hemi?: { sky: string; ground: string; intensity: number };
  lights: Array<{ position: [number, number, number]; color: string; intensity: number; castShadow?: boolean }>;
  toneMappingExposure: number;
  clayTints?: Partial<Record<'wall' | 'floor' | 'ceiling' | 'roof' | 'glazing', string>>;
}

/** Phần của `SSGI_PARAMS` (viewer post-processing.tsx) mà dáng này đè. */
export interface RenderLookSsgi {
  sliceCount: number;
  stepCount: number;
  radius: number;
  giIntensity: number;
}

// Đèn chính cao, chếch như nắng chiều (đổ bóng); đèn phụ ấm, yếu, phía đối diện.
const KEY_POSITION: [number, number, number] = [12, 30, 16];
const FILL_POSITION: [number, number, number] = [-12, 12, -10];

/** Số của từng bậc; `high` = có WebGPU (hậu kỳ chạy), `low` = WebGL2 (không hậu kỳ). */
export const RENDER_LOOK_TIERS = {
  high: { ambient: 0.12, hemi: 0.15, key: 1.7, fill: 0.2, exposure: 0.8 },
  low: { ambient: 0.3, hemi: 0.3, key: 1.8, fill: 0.25, exposure: 0.85 },
} as const;

// SSGI: 2 lát × 8 bước, bán kính 2 m; GI 0.6 cho ánh dội từ sàn gỗ. GI của Pascal không qua
// khử nhiễu (chỉ AO qua), nên giữ GI vừa phải thay vì tăng lát. Chỉ chạy khi có WebGPU.
export const RENDER_LOOK_SSGI = { sliceCount: 2, stepCount: 8, radius: 2, giIntensity: 0.6 } as const;

/**
 * Backend thật là WebGPU không (store realism, ghi sau khi renderer init). Chưa biết → phép thử cũ
 * `'gpu' in navigator` (có `navigator.gpu` vẫn có thể rơi về WebGL2).
 */
export const hasWebGpu = (): boolean => {
  const { backend } = useRealism.getState();
  if (backend !== 'unknown') return backend === 'webgpu';
  return typeof navigator !== 'undefined' && 'gpu' in navigator;
};

/**
 * Bậc `high` (nền tối, "SSGI bù") chỉ đúng khi SSGI THẬT chạy: có WebGPU **và** mức chất lượng bật SSGI.
 * Trước đây chỉ xét WebGPU, nên GPU tích hợp (mức `low`, SSGI tắt — `tiers.ts`) nhận nền tối 0,12 mà không
 * có gì bù → nhà tối và phẳng nhất (docs/blender-vs-editor/BAO-CAO.md §1).
 */
export const ssgiRuns = (): boolean => hasWebGpu() && tierConfig(useRealism.getState().tier).ssgiOn;

/** Đè tại chỗ; gọi lại nhiều lần cũng ra cùng giá trị. */
export function applyRenderLook(theme: RenderLookTheme, ssgi: RenderLookSsgi, webgpu = ssgiRuns()): void {
  const t = RENDER_LOOK_TIERS[webgpu ? 'high' : 'low'];
  Object.assign(theme, {
    background: C.background,
    backgroundSky: C.sky,
    ground: C.ground,
    ambient: { color: C.ambient, intensity: t.ambient },
    hemi: { sky: C.hemiSky, ground: C.hemiGround, intensity: t.hemi },
    lights: [
      { position: [...KEY_POSITION], color: C.key, intensity: t.key, castShadow: true },
      { position: [...FILL_POSITION], color: C.fill, intensity: t.fill },
    ],
    toneMappingExposure: withLookOverride({ exposure: t.exposure }).exposure,
    clayTints: {
      wall: C.clayWall,
      floor: C.clayFloor,
      ceiling: C.clayCeiling,
      roof: C.clayRoof,
      glazing: C.clayGlazing,
    },
  } satisfies RenderLookTheme);
  Object.assign(ssgi, RENDER_LOOK_SSGI);
}

// Nắng Ban ngày cao ~39° (atan(14 / √(14² + 10²))): lọt qua cửa sổ thành vệt trên sàn. Trần chặn
// nắng khi camera trong nhà (gói 2B, `realism/daylight.ts`), nên chỉ còn vệt qua cửa sổ.
const SUN_POSITION: [number, number, number] = [14, 14, 10];
const SKY_FILL_POSITION: [number, number, number] = [-12, 14, -10];

/**
 * Số của "Ban ngày". Nắng mạnh mà phơi sáng < 1 + môi trường 0.8 (`scripts/pascal-render.mjs`)
 * nên tường trắng không cháy. Gói 2B (`high` = WebGPU): nắng 2.6 → 3.2, nền (ambient + hemi + đèn
 * phụ) 0.85 → 0.5 — đèn nền/đèn phụ không có bóng, xuyên trần + tường, nên phải thấp để vệt nắng
 * và bóng đổ trong nhà đọc ra; phần sáng dội trong nhà để IBL HDRI + SSGI lo. `low` (WebGL2) giữ cũ.
 */
export const DAY_LOOK_TIERS = {
  high: { ambient: 0.1, hemi: 0.25, key: 3.2, fill: 0.15, exposure: 0.85 },
  low: { ambient: 0.3, hemi: 0.45, key: 2.6, fill: 0.35, exposure: 0.9 },
} as const;

/** Chủ đề không có bảng tier riêng (Nắng chiều `sunset`): chỉ nhận `?look=exposure:` khi có. */
export function applyLookExposure(theme: RenderLookTheme): void {
  const e = lookOverride().exposure;
  if (e !== undefined) theme.toneMappingExposure = e;
}

/** Đè chủ đề ban ngày (`DAY_THEME_ID`) tại chỗ; giữ phông/đất/màu đất sét của `studio`. */
export function applyDayLook(theme: RenderLookTheme, webgpu = ssgiRuns()): void {
  const t = DAY_LOOK_TIERS[webgpu ? 'high' : 'low'];
  Object.assign(theme, {
    ambient: { color: C.hemiSky, intensity: t.ambient },
    hemi: { sky: C.hemiSky, ground: C.clayFloor, intensity: t.hemi },
    lights: [
      { position: [...SUN_POSITION], color: C.key, intensity: t.key, castShadow: true },
      { position: [...SKY_FILL_POSITION], color: C.hemiSky, intensity: t.fill },
    ],
    toneMappingExposure: withLookOverride({ exposure: t.exposure }).exposure,
  } satisfies Partial<RenderLookTheme>);
}
