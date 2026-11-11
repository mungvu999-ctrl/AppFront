/**
 * Nhãn "Đang chuẩn bị tầng…" dưới bộ chọn tầng (vendor `floating-level-selector.tsx`, luật
 * `scripts/realism/w4-level-status.mjs`): tầng vừa chọn chưa sẵn sàng (`levelReadiness().ready` — cùng nghĩa với đầu dò:
 * không còn đồ GLB chờ và mẫu mới nhất không còn vật chờ shader/pipeline) thì hiện, sẵn sàng thì tắt. Hỏi lại sau mỗi
 * khung sống (`onLevelWarmFrame`). Kẹt (sau khi tự thử lại) → thông báo riêng `level-warm-stalled`, tự tắt sau 10 s.
 * Không đổi lần bấm: tầng vẫn đổi ngay, nhãn chỉ báo. `?disable=levelstatus` tắt cả hai; `?disable=levelstall` tắt báo kẹt.
 */
import { useLevelWarmState } from './levelWarmReady';

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
  const s = useLevelWarmState(levelId);
  return (
    <>
      <div aria-live="polite" data-testid="level-warm-status" role="status" style={s === 'pending' ? STYLE : undefined}>
        {s === 'pending' ? 'Đang chuẩn bị tầng…' : ''}
      </div>
      <div aria-live="polite" data-testid="level-warm-stalled" role="status" style={s === 'stalled' ? STYLE : undefined}>
        {s === 'stalled' ? 'Tầng này chuẩn bị lâu hơn bình thường — vẫn xem và thao tác được, phần còn lại sẽ hiện dần.' : ''}
      </div>
    </>
  );
}
