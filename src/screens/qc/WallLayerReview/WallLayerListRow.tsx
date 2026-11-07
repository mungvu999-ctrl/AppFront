/**
 * Một hàng của hàng đợi tường (cao 32): mẫu hình (hoặc dấu "Máy chưa chắc") · mã · dài · dày; hàng đã
 * duyệt có "Bỏ duyệt". Trạng thái cho trình đọc màn hình nằm ở tên truy cập của hàng.
 *
 * Nút "Bỏ duyệt" đứng CẠNH `role="option"` (không lồng điều khiển trong option). Màu trạng thái
 * luôn đi kèm hình (mẫu độ dày / dấu tích), không chỉ một chấm màu (BUG-638, A4).
 */

import { Check, CircleHelp } from 'lucide-react';
import type { CSSProperties } from 'react';

import { cn } from '@/lib/utils';

import { QcQueueNumber } from '../shared/QcQueueNumber';

import type { WallRowViewModel } from './types';
import { WALL_CONFIDENCE_TIER_TEXT, wallConfidenceTierOf, type WallConfidenceTier } from './wallLayerHatch';
import type { WallRowExtra } from './wallReviewQueue';
import { WallThicknessSwatch } from './WallThicknessSwatch';

type WallId = WallRowViewModel['id'];

export const LIST_ROW_HEIGHT_PX = 32;

const REVIEWED_TITLE = 'Đã duyệt';
/** Tên trạng thái trong tên truy cập của hàng — cùng bộ chữ với các màn duyệt lớp khác (qa đọc nó). */
const STATUS_LABEL: Readonly<Record<WallRowViewModel['statusCode'], string>> = {
  verified: 'Đã duyệt',
  attention: 'Cần chú ý',
  violation: 'Vi phạm',
  neutral: 'Bình thường',
};
const UNAPPROVE_LABEL = 'Bỏ duyệt';
const UNCERTAIN_LABEL = 'Máy chưa chắc';

export interface WallLayerListRowProps {
  readonly row: WallRowViewModel;
  readonly extra: WallRowExtra | undefined;
  readonly isSelected: boolean;
  readonly isHovered: boolean;
  readonly isFlashing: boolean;
  /** Dấu "Máy chưa chắc" cho tường dưới ngưỡng tin cậy — chỉ khi độ tin cậy có khác nhau. */
  readonly showConfidence: boolean;
  /** Tầng thiếu tỷ lệ: độ dày đo ra vô nghĩa, không in cột Dày (UX-R2 K23). Mặc định có. */
  readonly showThickness?: boolean | undefined;
  /** L23: số hàng đợi của tường còn chờ (cùng số với ghim trên bản vẽ); vắng = bố cục cũ. */
  readonly queueNumber?: number | undefined;
  /** U37: danh sách là MỘT điểm Tab (roving tabindex) — chỉ hàng này nhận Tab, ↑/↓ đi giữa các hàng. Vắng = mọi hàng nhận Tab như cũ. */
  readonly isTabStop?: boolean | undefined;
  readonly onSelect: (wallId: WallId) => void;
  readonly onToggleSelect: (wallId: WallId) => void;
  readonly onHover: (wallId: WallId | null) => void;
  readonly onOpenMenu?: ((wallId: WallId) => void) | undefined;
  readonly onUnapprove?: ((wallId: WallId) => void) | undefined;
  readonly style: CSSProperties;
}

/** Ô màu đầu hàng = bậc tin cậy, cùng màu với tường trên bản vẽ (WRU-B). */
function swatchOf(row: WallRowViewModel): WallConfidenceTier {
  return wallConfidenceTierOf(row.isReviewed, row.isLowConfidence, row.confidence);
}

export function WallLayerListRow({
  row,
  extra,
  isSelected,
  isHovered,
  isFlashing,
  showConfidence,
  showThickness = true,
  queueNumber,
  isTabStop = true,
  onSelect,
  onToggleSelect,
  onHover,
  onOpenMenu,
  onUnapprove,
  style,
}: WallLayerListRowProps) {
  const pick = (withModifier: boolean) => (withModifier ? onToggleSelect(row.id) : onSelect(row.id));
  const showUnapprove = row.isReviewed && onUnapprove !== undefined;
  const swatch = swatchOf(row);
  const swatchTitle = WALL_CONFIDENCE_TIER_TEXT[swatch];
  const isUncertain = showConfidence && row.isLowConfidence && !row.isReviewed;

  return (
    <div className="absolute inset-x-0 top-0 flex h-8 items-center gap-1" role="presentation" style={style}>
      <div
        aria-label={`${row.codeLabel} — ${STATUS_LABEL[row.statusCode]}`}
        aria-selected={isSelected}
        className={cn(
          'relative flex h-8 min-w-0 flex-1 cursor-pointer items-center gap-2 overflow-hidden rounded-md px-2 text-[13px] outline-hidden',
          'transition-colors duration-120 hover:bg-bg-hover',
          'focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-accent',
          isSelected && 'bg-accent-wash hover:bg-accent-wash',
          isHovered && !isSelected && 'bg-bg-hover',
          isFlashing && 'bg-accent-wash duration-340',
        )}
        data-wall-id={row.id}
        onClick={(event) => pick(event.ctrlKey || event.metaKey || event.shiftKey)}
        onKeyDown={(event) => {
          if (event.key === 'Enter' || event.key === ' ') {
            event.preventDefault();
            pick(event.ctrlKey || event.metaKey);

            return;
          }

          /* Đường bàn phím tới menu chuột phải (G74 16-E-010, A12). */
          if (onOpenMenu !== undefined && (event.key === 'ContextMenu' || (event.shiftKey && event.key === 'F10'))) {
            event.preventDefault();
            onOpenMenu(row.id);
          }
        }}
        onMouseEnter={() => onHover(row.id)}
        onMouseLeave={() => onHover(null)}
        role="option"
        tabIndex={isTabStop ? 0 : -1}
      >
        {row.isReviewed ? (
          <span className="relative flex w-5 shrink-0 items-center justify-center text-state-verified-text" title={REVIEWED_TITLE}>
            <Check aria-hidden="true" className="h-3.5 w-3.5" />
          </span>
        ) : queueNumber !== undefined ? (
          <QcQueueNumber current={isSelected} n={queueNumber} />
        ) : isUncertain ? (
          /* K15/K25: dấu "Máy chưa chắc" đứng ở ô hình đầu hàng (như dấu đã duyệt), không lấy chỗ cột dài. */
          <span className="relative flex w-5 shrink-0 items-center justify-center text-state-attention-text" title={UNCERTAIN_LABEL}>
            <CircleHelp aria-hidden="true" className="h-3.5 w-3.5" />
          </span>
        ) : (
          <span className="relative flex w-5 shrink-0 items-center" title={swatchTitle}>
            <WallThicknessSwatch kind={swatch} />
          </span>
        )}
        {/* K28: mã có bề rộng riêng, không co — không dính vào cột dài ("#W-0015.757"). */}
        <span className="relative w-12 shrink-0 whitespace-nowrap tabular-nums text-text-primary">{row.codeLabel}</span>
        {/* K25: cột dài không cắt chữ ("5.7…" đúng ở dòng chưa chắc là lỗi vòng 2). */}
        <span className="relative flex-1 whitespace-nowrap text-right tabular-nums text-text-secondary">{extra?.lengthText ?? ''}</span>
        {/* BUG-396: cột dày tối thiểu 36 nhưng nở theo "330 ≈300" — bề rộng cứng 36 cắt mất bậc gần nhất. */}
        {showUnapprove || !showThickness ? null : (
          <span className="relative w-[4.5rem] shrink-0 whitespace-nowrap text-right tabular-nums text-text-primary">
            {extra?.thicknessText ?? row.thicknessLabel}
            {extra?.nearText == null ? null : <span className="ml-1 text-caption text-text-secondary">{extra.nearText}</span>}
          </span>
        )}
      </div>
      {showUnapprove ? (
        <button
          className="h-6 shrink-0 rounded-md px-1.5 text-caption text-text-secondary hover:bg-bg-hover hover:text-text-primary focus-visible:outline-solid focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
          onClick={() => onUnapprove?.(row.id)}
          tabIndex={isTabStop ? 0 : -1}
          title={`${UNAPPROVE_LABEL} ${row.codeLabel}`}
          type="button"
        >
          {UNAPPROVE_LABEL}
        </button>
      ) : null}
    </div>
  );
}
