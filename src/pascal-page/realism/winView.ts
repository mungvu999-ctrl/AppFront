/**
 * Vòng 10 thí nghiệm E-WINVIEW: `?winview=sunset|courtyard|sky[:gain]` — HDRI có cảnh CHỈ làm phông nhìn qua kính/ô cửa
 * (`hdriBackdrop`). Không đổi ánh sáng, `scene.environment`, probe phản chiếu hay tone (để cô lập tác động).
 * - `?winview=auto`: Buổi tối (dark) → sunset gain `WIN_GAIN.dark`; chủ đề sáng → không áp (giữ trời HDRI của chủ đề).
 * - `&winscope=inside` (MẶC ĐỊNH) chỉ áp khi camera trong nhà: trong hộp bao tường của một tầng VÀ dưới trần
 *   (`insideRoomBox`, `reflect.ts` tính mỗi khung, không phụ thuộc probe phản chiếu); `&winscope=all` áp mọi góc.
 * - Gain mặc định theo chủ đề (`WIN_GAIN`), nhân sau chuẩn hoá `hdriAutoScale`; `:gain` đè.
 * - Dưới chân trời: HDRI phủ tới `WIN_FLOOR` (−1 = cả nửa dưới) cho phông VÀ phần tan xa của đĩa đất
 *   (luật `scripts/realism/w6-winview-disc.mjs`) → qua kính liền mạch, không vạch ngang ở chân trời.
 * Không cờ → `WINVIEW_DEFAULT`; `off` / giá trị lạ / `?disable=winview` → null, hành vi như cũ.
 * `courtyard`: ảnh chụp 11/11 ra mảng tối nhoè (cả 0,5 tối lẫn 1 ngày) — giữ cờ, KHÔNG đề xuất.
 * Phần nạp ở `lighting-hdri.ts` (`installWinView`).
 */
import { DAY_HDRI_URL, HDRI_URL } from './lighting';
import { GLASS_ENV_URL } from './matGlass';

export type WinMode = 'sunset' | 'courtyard' | 'sky';

/** Giá trị khi URL không có `?winview`. Đổi thành 'auto' để bật mặc định (một dòng). */
export const WINVIEW_DEFAULT: 'off' | 'auto' = 'auto';
export type WinScope = 'inside' | 'all';

/** Ảnh có sẵn trong repo (không thêm tệp): Venice hoàng hôn (nhà + nước), sân đô thị (nhà + cây), trời trưa thuần. */
export const WIN_URL: Record<WinMode, string> = { sunset: HDRI_URL, courtyard: GLASS_ENV_URL, sky: DAY_HDRI_URL };

/**
 * Gain mặc định theo chủ đề. "Buổi tối" (dark): phông gradient hiện ~#aaaeb1–#d8dadb; 0,6 cho phông tối hơn chút để đèn
 * phòng trội, hợp giờ chiều tối. Ban ngày / Nắng chiều (light): 1 = cùng mức sáng trung bình với trời của chủ đề.
 */
export const WIN_GAIN = { dark: 0.6, light: 1 } as const;
/** Mép dưới (dir.y) nơi HDRI tan vào gradient; 0 = như cũ (cắt ở chân trời), −1 = HDRI phủ cả nửa dưới. */
export const WIN_FLOOR = -1;

export interface WinView {
  mode: WinMode;
  gain: number;
  scope: WinScope;
}

/** Phân tích `?winview=` + `&winscope=`; gain ngoài (0, 4] hoặc không phải số → gain theo chủ đề. */
export function parseWinView(search: string, appearance: string, fallback: string = WINVIEW_DEFAULT): WinView | null {
  const params = new URLSearchParams(search);
  if ((params.get('disable') ?? '').split(',').includes('winview')) return null;
  const [asked0, rawGain] = (params.get('winview') ?? fallback).split(':');
  let mode = asked0;
  if (mode === 'auto') {
    if (appearance !== 'dark') return null;
    mode = 'sunset';
  }
  if (!mode || !(mode in WIN_URL)) return null;
  const asked = rawGain === undefined || rawGain === '' ? Number.NaN : Number(rawGain);
  const gain = asked > 0 && asked <= 4 ? asked : appearance === 'dark' ? WIN_GAIN.dark : WIN_GAIN.light;
  const scope: WinScope = params.get('winscope') === 'all' ? 'all' : 'inside';
  return { mode: mode as WinMode, gain, scope };
}

/** Phông cửa sổ có áp ở khung này không (camera trong nhà hoặc scope `all`). */
export const winApplies = (scope: WinScope, inside: boolean): boolean => scope === 'all' || inside;

export interface RoomBox {
  minX: number;
  minY: number;
  minZ: number;
  maxX: number;
  maxY: number;
  maxZ: number;
}
/** Tầng thấp hơn mức này (tường hạ / chế độ cắt) vẫn tính trần tối thiểu từ chân tường. */
export const MIN_ROOM_HEIGHT_M = 2.4;

/**
 * Hộp "trong nhà" mỗi tầng: XZ = hộp bao các tường của tầng; Y từ chân tường thấp nhất tới max(đỉnh tường, đỉnh trần,
 * chân + `MIN_ROOM_HEIGHT_M`). Tầng không có tường → bỏ (trần lẻ không đủ biết mặt bằng).
 * ponytail: hộp bao, không đa giác — mặt bằng chữ L tính cả khoảng sân trong hộp; đủ cho gate phông.
 */
export function levelBoxes(items: readonly { level: string; kind: 'wall' | 'ceiling'; box: RoomBox }[]): RoomBox[] {
  const walls = new Map<string, RoomBox>();
  for (const { level, kind, box } of items) {
    if (kind !== 'wall') continue;
    const u = walls.get(level);
    walls.set(level, u ? { minX: Math.min(u.minX, box.minX), minY: Math.min(u.minY, box.minY), minZ: Math.min(u.minZ, box.minZ), maxX: Math.max(u.maxX, box.maxX), maxY: Math.max(u.maxY, box.maxY), maxZ: Math.max(u.maxZ, box.maxZ) } : { ...box });
  }
  for (const { level, kind, box } of items) {
    const u = walls.get(level);
    if (kind === 'ceiling' && u) u.maxY = Math.max(u.maxY, box.maxY);
  }
  for (const u of walls.values()) u.maxY = Math.max(u.maxY, u.minY + MIN_ROOM_HEIGHT_M);
  return [...walls.values()];
}

/** Camera trong hộp bao tường của một tầng và dưới trần. */
export const insideRoomBox = (p: { x: number; y: number; z: number }, boxes: readonly RoomBox[]): boolean =>
  boxes.some((b) => p.x >= b.minX && p.x <= b.maxX && p.z >= b.minZ && p.z <= b.maxZ && p.y > b.minY && p.y < b.maxY);

/** Trạng thái cho `__pascalProbe.winView()`; `lighting-hdri.ts` + `reflect.ts` ghi. */
export const winViewState = { mode: 'off' as WinMode | 'off', gain: 0, scope: 'inside' as WinScope, loaded: false, requested: false, active: false, inside: false };

export const winViewReport = () => ({ ...winViewState });
