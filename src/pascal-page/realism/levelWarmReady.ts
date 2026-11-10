/** Hook của nhãn "Đang chuẩn bị tầng…" (`levelWarmStatus.tsx`); tách tệp để tệp component chỉ xuất component. */
import { useEffect, useState } from 'react';

import { levelReadiness, levelWarmActive, noteLevelReady, noteLevelSelected, onLevelWarmFrame } from './levelWarm';

const STATUS_OFF =
  typeof location !== 'undefined' && (new URLSearchParams(location.search).get('disable') ?? '').split(',').includes('levelstatus');

/** Tầng chưa có trong sổ (vừa thêm, chưa vẽ) coi như sẵn sàng: không có gì để chờ. */
const isReady = (levelId: string): boolean => levelReadiness().find((l) => l.levelId === levelId)?.ready ?? true;

/** `true` khi tầng `levelId` đang được chọn nhưng chưa sẵn sàng. Đổi tầng → theo tầng mới; unmount → huỷ đăng ký. */
export function useLevelPreparing(levelId: string | null | undefined, off = STATUS_OFF): boolean {
  const [pendingId, setPendingId] = useState<string | null>(null);
  useEffect(() => {
    if (!levelId || off || !levelWarmActive()) return setPendingId(null);
    noteLevelSelected(levelId);
    if (isReady(levelId)) {
      noteLevelReady(levelId);
      return setPendingId(null);
    }
    setPendingId(levelId);
    const stop = onLevelWarmFrame(() => {
      if (!isReady(levelId)) return;
      stop();
      noteLevelReady(levelId);
      setPendingId(null);
    });
    return stop;
  }, [levelId, off]);
  return pendingId !== null && pendingId === levelId;
}
