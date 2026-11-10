/** Hook của nhãn "Đang chuẩn bị tầng…" (`levelWarmStatus.tsx`); tách tệp để tệp component chỉ xuất component. */
import { useEffect, useState } from 'react';

import { levelReadiness, levelWarmActive, noteLevelReady, noteLevelSelected, onLevelWarmFrame } from './levelWarm';

const STATUS_OFF =
  typeof location !== 'undefined' && (new URLSearchParams(location.search).get('disable') ?? '').split(',').includes('levelstatus');

/**
 * Tầng chưa có trong sổ (vừa thêm, chưa vẽ) coi như sẵn sàng: không có gì để chờ. `stalled` (số chờ không giảm qua
 * `STALL_FRAMES` khung) = thôi chờ: tắt nhãn nhưng KHÔNG ghi là sẵn sàng (`noteLevelReady`).
 */
const stateOf = (levelId: string): 'ready' | 'stalled' | 'pending' => {
  const l = levelReadiness().find((r) => r.levelId === levelId);
  return !l || l.ready ? 'ready' : l.stalled ? 'stalled' : 'pending';
};

/** `true` khi tầng `levelId` đang được chọn nhưng chưa sẵn sàng. Đổi tầng → theo tầng mới; unmount → huỷ đăng ký. */
export function useLevelPreparing(levelId: string | null | undefined, off = STATUS_OFF): boolean {
  const [pendingId, setPendingId] = useState<string | null>(null);
  useEffect(() => {
    if (!levelId || off || !levelWarmActive()) return setPendingId(null);
    noteLevelSelected(levelId);
    const settled = (): boolean => {
      const s = stateOf(levelId);
      if (s === 'ready') noteLevelReady(levelId);
      return s !== 'pending';
    };
    if (settled()) return setPendingId(null);
    setPendingId(levelId);
    const stop = onLevelWarmFrame(() => {
      if (!settled()) return;
      stop();
      setPendingId(null);
    });
    return stop;
  }, [levelId, off]);
  return pendingId !== null && pendingId === levelId;
}
