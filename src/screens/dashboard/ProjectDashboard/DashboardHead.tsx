/**
 * Đầu trang Dự án — ba câu của mọi màn (NGUYEN-TAC-BO-CUC §1): làm gì (H1 động từ), đang ở đâu
 * (Badge + một câu có số thật), sang bước sau thế nào (MỘT nút chính "Tạo dự án"). Số dự án chỉ nói ở
 * đây; ô lọc trong khung "Dự án" không lặp lại số (luật "mỗi số một chỗ").
 */

import { Lock, Plus } from 'lucide-react';

import { Skeleton } from '@/components/feedback/Skeleton';
import { PageHead } from '@/components/shell/PageHead';
import { Badge } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import type { SevenState } from '@/lib/testing/sevenStateScenarios';

import { CREATE_PROJECT_SHORTCUT } from './dashboardShortcuts';
import type { ProjectStatusCounts } from './useProjectDashboard';

export const DASHBOARD_EYEBROW = 'Dự án của tôi';
export const DASHBOARD_TITLE = 'Chọn dự án để làm tiếp';
export const CREATE_PROJECT_LABEL = 'Tạo dự án';
const VIEWER_LINE = 'Vai người xem: chỉ có thể mở dự án, không tạo hoặc xoá được.';

export interface DashboardHeadProps {
  readonly state: SevenState;
  readonly statusCounts: ProjectStatusCounts;
  readonly totalProjects: number;
  /** Số dự án đang hiện sau tìm/lọc. */
  readonly visibleCount: number;
  readonly isFiltering: boolean;
  readonly hasUnread: boolean;
  readonly canCreate: boolean;
  readonly onCreate: () => void;
  /** Bấm chip "N dự án cần duyệt" → lọc tab Cần duyệt. */
  readonly onShowQc: () => void;
}

/** Một chip cho cả danh sách: việc cần người làm thắng, rồi tới việc đang chờ AI, rồi tới chỗ còn thiếu bản vẽ. */
function StatusBadge({ counts, canReview, onShowQc }: { readonly counts: ProjectStatusCounts; readonly canReview: boolean; readonly onShowQc: () => void }) {
  // U37: người xem không duyệt được — không nhắc họ việc duyệt, cũng không báo "đã duyệt xong" khi còn dự án chờ.
  if (counts.qc > 0 && !canReview) return null;
  if (counts.qc > 0) {
    return (
      <button type="button" onClick={onShowQc} className="inline-flex min-h-6 items-center rounded-full outline-hidden focus-visible:ring-2 focus-visible:ring-accent">
        <Badge variant="attention">{`${String(counts.qc)} dự án cần duyệt`}</Badge>
      </button>
    );
  }
  if (counts.processing > 0) return <Badge variant="neutral">{`${String(counts.processing)} dự án AI đang xử lý`}</Badge>;
  if (counts.noplan > 0) return <Badge variant="neutral">{`${String(counts.noplan)} dự án chưa có bản vẽ`}</Badge>;
  // A5: `done` chỉ đếm dự án mà người duyệt đã duyệt hết tường (`derivedStatusOf`), nên xanh ở đây là việc người.
  return counts.done > 0 ? <Badge variant="verified">Mọi dự án đã duyệt xong</Badge> : null;
}

function HeadStatus({ state, statusCounts, totalProjects, visibleCount, isFiltering, hasUnread, canCreate, onShowQc }: DashboardHeadProps) {
  if (state === 'loading') {
    // Giữ chỗ dòng trạng thái để khung "Dự án" không nhảy khi danh sách về (BUG-228).
    return <Skeleton aria-hidden="true" preset="block" className="h-[22px] w-56" />;
  }
  if (state === 'error') return <Badge variant="violation">Chưa tải được danh sách</Badge>;
  if (totalProjects === 0 && visibleCount === 0 && !hasUnread) return <Badge variant="neutral">Chưa có dự án</Badge>;

  const sentence = isFiltering
    ? `${String(visibleCount)}/${String(totalProjects)} dự án khớp tìm kiếm và bộ lọc`
    : `${String(totalProjects)} dự án`;
  return (
    <>
      <StatusBadge counts={statusCounts} canReview={canCreate} onShowQc={onShowQc} />
      <span>{sentence}</span>
      {!canCreate && (
        <span className="flex items-center gap-2">
          <Lock size={14} aria-hidden="true" />
          {VIEWER_LINE}
        </span>
      )}
    </>
  );
}

export function DashboardHead(props: DashboardHeadProps) {
  return (
    <PageHead
      eyebrow={DASHBOARD_EYEBROW}
      title={DASHBOARD_TITLE}
      status={<HeadStatus {...props} />}
      next={
        props.canCreate && (
          <Button
            variant="primary"
            iconBefore={<Plus size={16} aria-hidden="true" />}
            onClick={props.onCreate}
            title={`${CREATE_PROJECT_LABEL} (phím ${CREATE_PROJECT_SHORTCUT.combo})`}
          >
            {CREATE_PROJECT_LABEL}
          </Button>
        )
      }
    />
  );
}
