/**
 * Khối "Ngôi nhà" của bước duyệt bộ hồ sơ (NHA-08a/08b) — VIEW THUẦN.
 *
 * Hiện đề xuất của máy cho cả bộ và nhận quyết định của người duyệt: bảng tầng (nhận hoặc sửa cốt, chiều cao),
 * thẻ mái (sửa từng thông số, hoặc "không dựng mái"), mâu thuẫn giữa các nguồn (chọn một), và các luật kiểm (cảnh
 * báo có "Đã xem"). Mỗi giá trị đi kèm một chip nói nguồn bằng chữ, không chỉ màu. Quyết định tự lưu cùng bản
 * duyệt (A7).
 */

import { InlineAlert } from '@/components/feedback/InlineAlert';
import { Skeleton } from '@/components/feedback/Skeleton';
import type { HouseBlockVm } from '@/lib/viewmodel/setBuilding';
import type { HouseActions } from '@/lib/viewmodel/setBuildingDecisions';

import { HouseConflictGroup, HouseViolationList } from './HouseIssues';
import { HouseLevelTable } from './HouseLevelTable';
import { HouseValue } from './HouseNumberCell';
import { HouseRoofCard } from './HouseRoofCard';

const TEXT = {
  title: 'Ngôi nhà',
  loading: 'Đang đọc đề xuất ngôi nhà…',
  error: 'Chưa đọc được đề xuất ngôi nhà.',
  retry: 'Thử lại',
  note: 'Máy đề xuất, cần bạn duyệt. Chọn nguồn cho từng mâu thuẫn, sửa các lỗi và xem hết cảnh báo thì mới xác nhận được.',
  unitSystem: 'Hệ đơn vị',
  levels: 'Các tầng',
  noLevels: 'Máy chưa đề xuất tầng nào.',
  roofs: 'Mái',
  noRoofs: 'Máy chưa đề xuất mái nào.',
  conflicts: 'Mâu thuẫn giữa các nguồn',
  rules: 'Luật kiểm',
} as const;

const HEADING = 'text-[14px] font-semibold text-text-primary';
const BODY = 'text-[14px] text-text-secondary';

export interface HouseBlockViewProps {
  readonly status: 'loading' | 'hidden' | 'error' | 'ready';
  /** Có khi `status` là `ready`. */
  readonly vm: HouseBlockVm | null;
  /** Đang đọc lại sau một lần lưu: nội dung cũ vẫn hiện. */
  readonly isRefreshing: boolean;
  readonly onRetry: () => void;
  readonly actions: HouseActions;
}

function Proposal({ actions, vm }: { actions: HouseActions; vm: HouseBlockVm }) {
  return (
    <>
      <p className={BODY}>{TEXT.note}</p>
      <p className="flex flex-wrap items-center gap-2 text-[14px] text-text-secondary">
        {TEXT.unitSystem}: <HouseValue cell={vm.unitSystem} />
      </p>

      <h3 className={HEADING}>{TEXT.levels}</h3>
      {vm.levels.length === 0 ? (
        <p className={BODY}>{TEXT.noLevels}</p>
      ) : (
        <HouseLevelTable actions={actions} levels={vm.levels} />
      )}

      <h3 className={HEADING}>{TEXT.roofs}</h3>
      {vm.roofs.length === 0 ? (
        <p className={BODY}>{TEXT.noRoofs}</p>
      ) : (
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          {vm.roofs.map((card) => (
            <HouseRoofCard actions={actions} card={card} key={card.key} />
          ))}
        </div>
      )}

      {vm.conflicts.length === 0 ? null : (
        <>
          <h3 className={HEADING}>{TEXT.conflicts}</h3>
          {vm.conflicts.map((conflict) => (
            <HouseConflictGroup actions={actions} conflict={conflict} key={conflict.key} />
          ))}
        </>
      )}

      {vm.violations.length === 0 ? null : (
        <>
          <h3 className={HEADING}>{TEXT.rules}</h3>
          {vm.violations.map((group) => (
            <HouseViolationList actions={actions} group={group} key={group.level} />
          ))}
        </>
      )}
    </>
  );
}

export function HouseBlockView({
  actions,
  isRefreshing,
  onRetry,
  status,
  vm,
}: HouseBlockViewProps) {
  if (status === 'hidden') return null;

  return (
    <section
      aria-busy={isRefreshing || status === 'loading'}
      aria-label={TEXT.title}
      className="flex flex-col gap-3 rounded-lg border border-border-default bg-bg-surface p-3"
    >
      <h2 className={HEADING}>{TEXT.title}</h2>
      {status === 'loading' ? (
        <>
          <p className={BODY} role="status">
            {TEXT.loading}
          </p>
          <Skeleton className="h-16 w-full" preset="block" />
        </>
      ) : null}
      {status === 'error' ? (
        <InlineAlert
          action={{ label: TEXT.retry, onClick: onRetry }}
          level="violation"
          message={TEXT.error}
          role="status"
        />
      ) : null}
      {status === 'ready' && vm !== null ? <Proposal actions={actions} vm={vm} /> : null}
    </section>
  );
}
