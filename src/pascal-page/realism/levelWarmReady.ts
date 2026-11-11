/** Hook của nhãn "Đang chuẩn bị tầng…" (`levelWarmStatus.tsx`); tách tệp để tệp component chỉ xuất component. */
import { useEffect, useState } from 'react';

import { type LevelReadiness, levelReadiness, levelWorkActive, noteLevelReady, noteLevelSelected, onLevelWarmFrame } from './levelWarm';

const DISABLED = typeof location !== 'undefined' ? (new URLSearchParams(location.search).get('disable') ?? '').split(',') : [];
const STATUS_OFF = DISABLED.includes('levelstatus');
/** `?disable=levelstall`: kẹt thì tắt nhãn im lặng như vòng 9 (chỉ để đo A/B). */
const STALL_UI_OFF = DISABLED.includes('levelstall');

export type LevelWarmUiState = 'pending' | 'stalled' | null;

/** Thuần: trạng thái hiển thị từ đúng một dòng `levelReadiness()` (trường `status`). Chưa có dòng = chưa biết gì → rỗng. */
export const uiStateOf = (row: Pick<LevelReadiness, 'status'> | undefined, stallUiOff = false): LevelWarmUiState =>
  !row || row.status === 'ready' ? null : row.status === 'stalled' ? (stallUiOff ? null : 'stalled') : 'pending';

/**
 * Trạng thái hiển thị của tầng `levelId` đang chọn = `status` của dòng tầng ấy trong `levelReadiness()` (cùng nguồn với
 * đầu dò), đọc lại SAU MỖI khung sống suốt lúc tầng còn được chọn — kể cả sau khi đã sẵn sàng. Vòng 10 thôi nghe ở lần
 * `ready` đầu (thường là số cũ của tầng đã ấm, trước khi tầng hiện) và không nghe nếu chưa có khung nào lúc gắn; báo kẹt
 * tự tắt sau 10 s → `ready:false` mà UI im lặng. Lấy mẫu (ép vẽ) chỉ khi còn chờ/kẹt, tầng hiện mà chưa có mẫu mới, hoặc
 * W2/W1 đang dựng (đổi chủ đề, vật mới); sẵn sàng và W2 rảnh thì chỉ đọc nên vòng vẽ được nghỉ. Thử lại khi kẹt do `levelWarm.ts` tự làm.
 */
export function useLevelWarmState(levelId: string | null | undefined, off = STATUS_OFF, stallUiOff = STALL_UI_OFF): LevelWarmUiState {
  // Chuỗi `id|trạng thái`: setState cùng chuỗi thì React bỏ qua (nghe mỗi khung không gây vẽ lại).
  const [ui, setUi] = useState('');
  useEffect(() => {
    if (!levelId || off) return setUi('');
    noteLevelSelected(levelId);
    let sample = true; // lần đầu sau khi chọn: không tin số cũ có từ trước khi tầng hiện
    const step = () => {
      const row = levelReadiness(sample).find((r) => r.levelId === levelId);
      if (row?.status === 'ready') noteLevelReady(levelId);
      sample = !!row && (row.status !== 'ready' || (row.shown && !row.fresh) || levelWorkActive());
      setUi(`${levelId}|${uiStateOf(row, stallUiOff) ?? ''}`);
    };
    step();
    return onLevelWarmFrame(step);
  }, [levelId, off, stallUiOff]);
  const [id, s] = ui.split('|');
  return id === levelId && s ? (s as Exclude<LevelWarmUiState, null>) : null;
}

/** `true` khi tầng `levelId` đang được chọn nhưng chưa sẵn sàng (giữ API cũ). */
export function useLevelPreparing(levelId: string | null | undefined, off = STATUS_OFF): boolean {
  return useLevelWarmState(levelId, off) === 'pending';
}
