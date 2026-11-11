/** Hook của nhãn "Đang chuẩn bị tầng…" (`levelWarmStatus.tsx`); tách tệp để tệp component chỉ xuất component. */
import { useEffect, useState } from 'react';

import { levelReadiness, levelWarmActive, noteLevelReady, noteLevelSelected, onLevelWarmFrame, retryStalled } from './levelWarm';

const DISABLED = typeof location !== 'undefined' ? (new URLSearchParams(location.search).get('disable') ?? '').split(',') : [];
const STATUS_OFF = DISABLED.includes('levelstatus');
/** `?disable=levelstall`: kẹt thì tắt nhãn im lặng như vòng 9 (không thử lại, không báo). */
const STALL_UI_OFF = DISABLED.includes('levelstall');
/** Thông báo "tầng chuẩn bị lâu" tự tắt sau ngần này (ms) — không để chữ treo mãi; tầng vẫn dùng được suốt. */
export const STALL_NOTICE_MS = 10_000;
/**
 * Sau khi đã sẵn sàng, nhãn vẫn theo dõi (đọc thụ động, không ép vẽ) để khớp đầu dò: tầng lại chưa sẵn sàng liền
 * ngần này khung (khoá mới thật, không phải dao động một khung) thì nhãn hiện lại.
 */
export const REPEND_FRAMES = 20;

/**
 * Tầng chưa có trong sổ (vừa thêm, chưa vẽ) coi như sẵn sàng: không có gì để chờ. `stalled` (số chờ không giảm qua
 * `STALL_FRAMES` khung) = thôi chờ: KHÔNG ghi là sẵn sàng (`noteLevelReady`).
 */
const stateOf = (levelId: string, passive = false): 'ready' | 'stalled' | 'pending' => {
  const l = levelReadiness({ passive }).find((r) => r.levelId === levelId);
  return !l || l.ready ? 'ready' : l.stalled ? 'stalled' : 'pending';
};

export type LevelWarmUiState = 'pending' | 'stalled' | null;

/**
 * Trạng thái hiển thị của tầng `levelId` đang chọn: `pending` (chưa sẵn sàng), `stalled` (kẹt sau khi đã tự thử lại
 * `MAX_STALL_RETRIES` lần — báo người dùng, tự tắt sau `STALL_NOTICE_MS`, tầng vẫn thao tác được; khung sau sẵn sàng thì
 * tắt ngay), `null`. Đổi tầng → theo tầng mới; unmount → huỷ đăng ký + hẹn giờ.
 */
export function useLevelWarmState(levelId: string | null | undefined, off = STATUS_OFF, stallUiOff = STALL_UI_OFF): LevelWarmUiState {
  const [ui, setUi] = useState<{ id: string; s: Exclude<LevelWarmUiState, null> } | null>(null);
  useEffect(() => {
    if (!levelId || off || !levelWarmActive()) return setUi(null);
    noteLevelSelected(levelId);
    let timer: ReturnType<typeof setTimeout> | undefined;
    let noticed = false;
    let wasReady = false;
    let repend = 0;
    /** `true` = thôi nghe khung. */
    const step = (): boolean => {
      const s = stateOf(levelId, wasReady);
      if (s === 'ready') {
        noteLevelReady(levelId);
        setUi(null);
        wasReady = true;
        repend = 0;
        return false; // nghe tiếp (thụ động) để nhãn khớp đầu dò
      }
      if (wasReady && s === 'pending' && ++repend < REPEND_FRAMES) return false;
      if (s === 'pending') {
        if (!noticed) setUi({ id: levelId, s: 'pending' });
        return false;
      }
      // Kẹt: còn lượt thì thử lại (vẫn hiện "đang chuẩn bị"); hết lượt thì báo một lần rồi tự tắt, vẫn nghe khung để
      // tắt ngay nếu tầng xong muộn.
      if (stallUiOff) return void setUi(null), true;
      if (!noticed && retryStalled(levelId)) return false;
      if (!noticed) {
        noticed = true;
        setUi({ id: levelId, s: 'stalled' });
        timer = setTimeout(() => setUi(null), STALL_NOTICE_MS);
      }
      return false;
    };
    if (step()) return;
    const stop = onLevelWarmFrame(() => {
      if (step()) stop();
    });
    return () => {
      stop();
      clearTimeout(timer);
    };
  }, [levelId, off, stallUiOff]);
  return ui !== null && ui.id === levelId ? ui.s : null;
}

/** `true` khi tầng `levelId` đang được chọn nhưng chưa sẵn sàng (giữ API cũ). */
export function useLevelPreparing(levelId: string | null | undefined, off = STATUS_OFF): boolean {
  return useLevelWarmState(levelId, off) === 'pending';
}
