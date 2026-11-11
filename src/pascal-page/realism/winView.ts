/**
 * Vòng 10 thí nghiệm E-WINVIEW: `?winview=sunset|courtyard|sky[:gain]` — HDRI có cảnh CHỈ làm phông nhìn qua kính/ô cửa
 * (`hdriBackdrop`). Không đổi ánh sáng, `scene.environment`, probe phản chiếu hay tone (để cô lập tác động).
 * - `&winscope=inside` (MẶC ĐỊNH) chỉ áp khi camera trong nhà (`reflectStats.inside`, cập nhật lúc probe chụp);
 *   `&winscope=all` áp cả góc toàn cảnh.
 * - Gain mặc định theo chủ đề (`WIN_GAIN`), nhân sau chuẩn hoá `hdriAutoScale`; `:gain` đè.
 * - Dưới chân trời: HDRI kéo xuống tới `WIN_FLOOR` (dir.y) thay vì cắt ở 0 → thấy mặt đất/chân nhà của ảnh.
 * Không cờ / `off` / giá trị lạ → null, hành vi như cũ. Phần nạp ở `lighting-hdri.ts` (`installWinView`).
 */
import { DAY_HDRI_URL, HDRI_URL } from './lighting';
import { GLASS_ENV_URL } from './matGlass';

export type WinMode = 'sunset' | 'courtyard' | 'sky';
export type WinScope = 'inside' | 'all';

/** Ảnh có sẵn trong repo (không thêm tệp): Venice hoàng hôn (nhà + nước), sân đô thị (nhà + cây), trời trưa thuần. */
export const WIN_URL: Record<WinMode, string> = { sunset: HDRI_URL, courtyard: GLASS_ENV_URL, sky: DAY_HDRI_URL };

/**
 * Gain mặc định theo chủ đề. "Buổi tối" (dark): phông gradient hiện ~#aaaeb1–#d8dadb; 0,6 cho phông tối hơn chút để đèn
 * phòng trội, hợp giờ chiều tối. Ban ngày / Nắng chiều (light): 1 = cùng mức sáng trung bình với trời của chủ đề.
 */
export const WIN_GAIN = { dark: 0.6, light: 1 } as const;
/** Mép dưới (dir.y) nơi HDRI tan vào gradient; 0 = như cũ (cắt ở chân trời). −0,2 ≈ −11,5°. */
export const WIN_FLOOR = -0.2;

export interface WinView {
  mode: WinMode;
  gain: number;
  scope: WinScope;
}

/** Phân tích `?winview=` + `&winscope=`; gain ngoài (0, 4] hoặc không phải số → gain theo chủ đề. */
export function parseWinView(search: string, appearance: string): WinView | null {
  const params = new URLSearchParams(search);
  const [mode, rawGain] = (params.get('winview') ?? '').split(':');
  if (!mode || !(mode in WIN_URL)) return null;
  const asked = rawGain === undefined || rawGain === '' ? Number.NaN : Number(rawGain);
  const gain = asked > 0 && asked <= 4 ? asked : appearance === 'dark' ? WIN_GAIN.dark : WIN_GAIN.light;
  const scope: WinScope = params.get('winscope') === 'all' ? 'all' : 'inside';
  return { mode: mode as WinMode, gain, scope };
}

/** Phông cửa sổ có áp ở khung này không (camera trong nhà hoặc scope `all`). */
export const winApplies = (scope: WinScope, inside: boolean): boolean => scope === 'all' || inside;

/** Trạng thái cho `__pascalProbe.winView()`; `lighting-hdri.ts` + `reflect.ts` ghi. */
export const winViewState = { mode: 'off' as WinMode | 'off', gain: 0, scope: 'inside' as WinScope, loaded: false, active: false };

export const winViewReport = () => ({ ...winViewState });
