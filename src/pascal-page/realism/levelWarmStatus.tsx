/**
 * Nhãn "Đang chuẩn bị tầng…" dưới bộ chọn tầng (vendor `floating-level-selector.tsx`, luật
 * `scripts/realism/w4-level-status.mjs`): tầng vừa chọn chưa sẵn sàng (chưa làm ấm xong, còn vật chờ shader/pipeline
 * hoặc đồ GLB chưa nạp) thì hiện, tới khi `levelReadiness()` của chính tầng ấy báo `ready` thì tắt. Hỏi lại sau mỗi
 * khung sống (`onLevelWarmFrame`) — không hẹn giờ. Không đổi lần bấm: tầng vẫn đổi ngay, nhãn chỉ báo.
 * `?disable=levelstatus` tắt nhãn.
 */
import { useLevelPreparing } from './levelWarmReady';

const STYLE = {
  marginTop: 6,
  padding: '4px 10px',
  borderRadius: 9999,
  fontSize: 12,
  lineHeight: '16px',
  color: 'var(--foreground)',
  background: 'var(--background)',
  border: '1px solid var(--border)',
  width: 'fit-content',
} as const;

/** Vùng `role="status"` luôn có mặt (để trình đọc màn hình bắt thay đổi); rỗng khi tầng đã sẵn sàng. */
export function LevelWarmStatus({ levelId }: { levelId: string | null | undefined }) {
  const preparing = useLevelPreparing(levelId);
  return (
    <div aria-live="polite" data-testid="level-warm-status" role="status" style={preparing ? STYLE : undefined}>
      {preparing ? 'Đang chuẩn bị tầng…' : ''}
    </div>
  );
}
