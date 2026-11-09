/**
 * Làn B vòng 5: cờ `?light=<tên>[,<tên>…]` (độc lập `?tone=`/`?mat=`/`?lightx=`). Không cờ → y hệt hôm nay.
 * - `lamp-cal`  : đèn phòng buổi tối giữ tổng quang thông nhưng chia thành nhiều đèn để đỉnh rọi sàn
 *                 ≤ `LAMP_CAL_PEAK_E` (`roomLights.ts` `calibrateRoomLights`).
 * - `cut-shadow`: tường/trần bị cắt (chế độ Cắt) vẫn đổ bóng — `clipShadows = false` (`cutSync.ts`).
 */
export type LightFlag = 'lamp-cal' | 'cut-shadow';
const FLAGS = new Set<string>(['lamp-cal', 'cut-shadow']);

export function parseLightFlags(search: string): Set<LightFlag> {
  const raw = new URLSearchParams(search).get('light') ?? '';
  return new Set(raw.split(',').map((s) => s.trim()).filter((s): s is LightFlag => FLAGS.has(s)));
}

let memo: Set<LightFlag> | undefined;
/** Đọc URL một lần lúc nạp: cờ cố định cả phiên (đổi `clipShadows` giữa chừng làm dựng lại mọi shader). */
export function lightFlagOn(flag: LightFlag): boolean {
  memo ??= parseLightFlags(typeof location === 'undefined' ? '' : location.search);
  return memo.has(flag);
}
