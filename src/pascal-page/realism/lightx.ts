/**
 * Làn 3a vòng 4 (M5): thử nghiệm ánh sáng / chiều sâu / phản xạ, bật bằng `?lightx=<tên>[,<tên>…]`.
 * Không có tham số → mọi hàm trả đúng giá trị vào (hành vi hôm nay). Vendor gọi qua luật `scripts/realism/m5-light.mjs`.
 *
 * - `env`  : môi trường IBL lấy HDRI phòng trong nhà (Poly Haven `lebombo`, CC0) — phản xạ sàn/kính/kim loại có hình
 *            (cửa sổ sáng, tường, trần) thay vì dải trời phẳng. Phông trời qua kính giữ HDRI ngoài trời như cũ.
 * - `sun`  : nắng thấp hơn (39° → 24°) để vệt nắng vào sâu qua cửa sổ + nền (ambient/hemi) thấp hơn → tương phản sáng/tối.
 * - `ao`   : AO của SSGI đậm thêm (ao^1,6 sau mũ TRAA 1,6 → tổng ~2,6) ở chân tường/khe đồ; chỗ nắng trực tiếp vẫn
 *            được `aoIndirect` bỏ AO như cũ.
 * - `tone` : tone map Khronos PBR Neutral thay AgX (màu vật liệu giữ đúng, ít xám) + phơi sáng −10 %.
 */
import { NeutralToneMapping, type Scene, type Texture, EquirectangularReflectionMapping, FileLoader, FloatType } from 'three';
import { HDRLoader } from 'three/addons/loaders/HDRLoader.js';
import { float } from 'three/tsl';
import type { Node } from 'three/webgpu';

import { hdriAutoScale } from './lighting';

export type LightxVariant = 'env' | 'sun' | 'ao' | 'tone';
const VARIANTS = new Set<LightxVariant>(['env', 'sun', 'ao', 'tone']);

/** `?lightx=env,ao` → tập biến thể hợp lệ (khoá lạ bị bỏ). */
export function parseLightx(search: string): Set<LightxVariant> {
  const raw = new URLSearchParams(search).get('lightx') ?? '';
  return new Set(raw.split(',').map((s) => s.trim()).filter((s): s is LightxVariant => VARIANTS.has(s as LightxVariant)));
}

let memo: Set<LightxVariant> | undefined;
export function lightxOn(v: LightxVariant): boolean {
  memo ??= parseLightx(typeof location === 'undefined' ? '' : location.search);
  return memo.has(v);
}

// ---------- sun ----------
/** Nắng ban ngày: cao độ ~24° (gốc [14,14,10] ≈ 39°), cùng phương vị. */
export const LIGHTX_SUN_POSITION: [number, number, number] = [14, 7.6, 10];
export const LIGHTX_SUN_INTENSITY = 3.6;
export const LIGHTX_AMBIENT = 0.06;
export const LIGHTX_HEMI = 0.15;

interface ThemeLike {
  appearance?: string;
  ambient?: { intensity: number };
  hemi?: { intensity: number };
  lights: Array<{ position: [number, number, number]; intensity: number; castShadow?: boolean }>;
}
const tuned = new WeakSet<object>();

/**
 * Đèn chính có bóng của chủ đề đang dùng (mặc định là dáng ấm đè `night`, appearance 'dark'); đè tại chỗ một lần cho
 * mỗi mảng `lights` (applyDayLook/applyRenderLook thay mảng mới).
 */
export function lightxTheme<T extends ThemeLike>(theme: T, on = lightxOn('sun')): T {
  if (!on || tuned.has(theme.lights)) return theme;
  const key = theme.lights[0];
  if (!key?.castShadow) return theme;
  tuned.add(theme.lights);
  key.position = [...LIGHTX_SUN_POSITION];
  key.intensity = LIGHTX_SUN_INTENSITY;
  if (theme.ambient) theme.ambient = { ...theme.ambient, intensity: LIGHTX_AMBIENT };
  if (theme.hemi) theme.hemi = { ...theme.hemi, intensity: LIGHTX_HEMI };
  return theme;
}

// ---------- ao ----------
export const LIGHTX_AO_POW = 1.6;
/** Nút AO (đã qua mũ TRAA) → đậm thêm khi bật `ao`. */
export function lightxAo<N extends Node<'float'>>(ao: N, on = lightxOn('ao')): N {
  return (on ? ao.pow(float(LIGHTX_AO_POW)) : ao) as N;
}

// ---------- tone ----------
export const LIGHTX_EXPOSURE_SCALE = 0.9;
export function lightxToneMapping(current: number, on = lightxOn('tone')): number {
  return on ? NeutralToneMapping : current;
}
export function lightxExposure(exposure: number, on = lightxOn('tone')): number {
  return on ? exposure * LIGHTX_EXPOSURE_SCALE : exposure;
}

// ---------- env ----------
/** `assets/hdri/lebombo_1k.hdr` chép tay sang đây (tích hợp: thêm dòng vào `scripts/copy-pascal-assets.mjs`). */
export const LIGHTX_ENV_URL = '/pascal/hdri/lebombo-v1-1k.hdr';
const ENV_WAIT_MS = 15_000;

/**
 * Đợi HDRI ngoài trời của `installHdri` gắn vào nút môi trường (nút.value ≠ trời gradient), rồi thay giá trị nút bằng
 * HDRI trong nhà (cùng nút → không dựng lại vật liệu). Tự chuẩn hoá về độ sáng trung bình trời gradient như HDRI cũ.
 */
export function installLightxEnv(scene: Scene, appearance: string, on = lightxOn('env')): () => void {
  if (!on) return () => {};
  // Chủ đề tối (mặc định) dùng RoomEnvironment, không có HDRI ngoài trời → thay ngay khi có nút môi trường.
  const dark = appearance === 'dark';
  let done = false;
  let tex: Texture | null = null;
  const t0 = Date.now();
  const swap = () => {
    if (done || !tex) return;
    const node = scene.environmentNode as unknown as { value?: Texture } | null;
    if (node && node.value && (dark || node.value !== scene.environment)) {
      node.value = tex;
      return;
    }
    // eslint-disable-next-line local/no-raw-duration -- chu kỳ dò HDRI ngoài trời đã gắn, không phải chuyển động
    if (Date.now() - t0 < ENV_WAIT_MS) setTimeout(swap, 200);
  };
  new FileLoader()
    .setResponseType('arraybuffer')
    .loadAsync(LIGHTX_ENV_URL)
    .then((buf) => {
      if (done) return;
      const url = URL.createObjectURL(new Blob([buf as ArrayBuffer]));
      new HDRLoader().setDataType(FloatType).load(url, (texture) => {
        URL.revokeObjectURL(url);
        if (done) return texture.dispose();
        const { data, width, height } = texture.image as { data: Float32Array; width: number; height: number };
        const k = hdriAutoScale(data, width, height);
        for (let i = 0; i < data.length; i += 4) {
          data[i]! *= k;
          data[i + 1]! *= k;
          data[i + 2]! *= k;
        }
        texture.mapping = EquirectangularReflectionMapping;
        texture.needsUpdate = true;
        tex = texture;
        swap();
      });
    })
    .catch((e) => console.warn('[lightx] HDRI trong nhà không tải được', e));
  return () => {
    done = true;
    tex?.dispose();
  };
}
