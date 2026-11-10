/**
 * Cờ `?light=<tên>[,<tên>…]` (độc lập `?tone=`/`?mat=`/`?lightx=`). Không cờ → `DEFAULT_LIGHT_FLAGS`; `?light=none` → tắt hết.
 * - `lamp-cal`  : đèn phòng buổi tối giữ tổng quang thông nhưng chia thành nhiều đèn để đỉnh rọi sàn
 *                 ≤ `LAMP_CAL_PEAK_E` (`roomLights.ts` `calibrateRoomLights`).
 * - `cut-shadow`: tường/trần bị cắt (chế độ Cắt) vẫn đổ bóng — `clipShadows = false` (`cutSync.ts`).
 * - `room-clip` : (vòng 6) đèn điểm/spot trong nhà chỉ chiếu trong hộp phòng chứa nó (`lightingRoomClip.ts`).
 * - `lamp-ceil` : (vòng 6) đèn phòng dời từ 2,3 m lên sát trần (cùng chỗ đèn âm trần), giữ cường độ (`roomLights.ts`).
 * - `window-spot`: (vòng 6) đèn cửa sổ Ban ngày là spot sát kính hướng vào phòng thay đèn điểm lùi 0,7 m (`windowLight.ts`).
 */
export type LightFlag = 'lamp-cal' | 'cut-shadow' | 'room-clip' | 'window-spot' | 'lamp-ceil';
const FLAGS = new Set<string>(['lamp-cal', 'cut-shadow', 'room-clip', 'window-spot', 'lamp-ceil']);

/** Mặc định từ vòng 6 (chấm mù 39 cặp so master: tổng thể 15/7/17, đốm sáng 10/0/29): đèn phòng sát trần + đèn chỉ chiếu trong phòng. */
export const DEFAULT_LIGHT_FLAGS: readonly LightFlag[] = ['lamp-ceil', 'room-clip'];

/** Không có `?light=` → mặc định; `?light=none` → tắt hết (rollback về trước vòng 6); có danh sách → đúng danh sách đó. */
export function parseLightFlags(search: string): Set<LightFlag> {
  const raw = new URLSearchParams(search).get('light');
  if (raw === null) return new Set(DEFAULT_LIGHT_FLAGS);
  return new Set(raw.split(',').map((s) => s.trim()).filter((s): s is LightFlag => FLAGS.has(s)));
}

let memo: Set<LightFlag> | undefined;
/** Đọc URL một lần lúc nạp: cờ cố định cả phiên (đổi `clipShadows` giữa chừng làm dựng lại mọi shader). */
export function lightFlagOn(flag: LightFlag): boolean {
  memo ??= parseLightFlags(typeof location === 'undefined' ? '' : location.search);
  return memo.has(flag);
}
