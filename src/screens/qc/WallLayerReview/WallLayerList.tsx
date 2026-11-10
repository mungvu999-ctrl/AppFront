/**
 * Hàng đợi tường của panel trái — ảo hoá (`@tanstack/react-virtual`), chia nhóm theo đúng thứ tự
 * hook đã xếp (demo Z/S-15): Không chuẩn (nút "Đưa N tường về chuẩn" ngay trên đầu nhóm, mở màn Độ dày) → Đúng chuẩn →
 * Đã duyệt (thu gọn, tự mở khi đang chọn một hàng trong đó hoặc không còn hàng nào khác). Tiêu đề nhóm
 * đang ở đỉnh dính lại khi cuộn. Nút "Duyệt N đoạn máy chắc chắn" ở đáy cột (`WallLayerApproveConfident`).
 *
 * View THUẦN (R-60). `rows` đã xếp theo hàng đợi ở hook, nên danh sách, J/K, "Duyệt tiếp" và tự
 * chuyển sau "Duyệt" đi cùng một thứ tự. Hàng dùng `role="option"` + `focus-visible:` dạng class
 * (cảnh báo H1 của `docs/contracts/ui.md`).
 */

import { defaultRangeExtractor, useVirtualizer, type Range } from '@tanstack/react-virtual';
import { ChevronDown, Inbox } from 'lucide-react';
import { useCallback, useEffect, useRef, useState } from 'react';

import { EmptyState } from '@/components/feedback/EmptyState';
import { Skeleton } from '@/components/feedback/Skeleton';
import { Button } from '@/components/ui/Button';
import { cn } from '@/lib/utils';

import type { WallLayerViewProps, WallRowViewModel } from './types';
import { LIST_ROW_HEIGHT_PX, WallLayerListRow } from './WallLayerListRow';
import { WALL_REASON_ORDER, WALL_REASON_TITLE, type WallQueueGroup, type WallReviewQueue, type WallReviewReason } from './wallReviewQueue';

export interface WallLayerListProps {
  readonly panel: WallLayerViewProps;
  /** Hàng vừa đổi — nháy nền một nhịp `duration-340` rồi tắt (TT-02). */
  readonly flashingWallId: WallRowViewModel['id'] | null;
  /** Ctrl/Cmd-bấm một hàng: thêm/bớt khỏi vùng chọn (NL-07). */
  readonly onToggleSelect: (wallId: WallRowViewModel['id']) => void;
  readonly queue?: WallReviewQueue | undefined;
  /** Mở màn Độ dày tường; vắng = không có nút (người xem, hoặc không đoạn nào đổi được). */
  readonly onOpenBulk?: (() => void) | undefined;
  /** L23: số hàng đợi của tường còn chờ (`queueNumbersOf`); vắng = bố cục cũ. */
  readonly queueNumbers?: ReadonlyMap<WallRowViewModel['id'], number> | undefined;
}

type ListItem =
  | { readonly kind: 'header'; readonly group: WallDisplayGroup; readonly count: number }
  | { readonly kind: 'bulk' }
  | { readonly kind: 'row'; readonly row: WallRowViewModel };

const HEADER_HEIGHT_PX = 28;
const BULK_HEIGHT_PX = 44;
const LOADING_SKELETON_ROWS = 12;
const LIST_ARIA_LABEL = 'Danh sách đoạn tường';
const EMPTY_LIST_TITLE = 'Chưa có đoạn tường nào';
const NO_MATCH_MESSAGE =
  'Không có đoạn tường nào khớp bộ lọc đang bật. Bỏ bớt một bộ lọc để thấy lại danh sách.';
const GROUP_TITLE: Readonly<Record<WallQueueGroup, string>> = {
  nonStandard: 'Độ dày không chuẩn',
  standard: 'Độ dày đúng chuẩn',
  reviewed: 'Đã duyệt',
};
/** Nhóm hiển thị: ba nhóm hàng đợi, cộng nhóm lý do máy nghi khi hàng đợi chia theo lý do (L23). */
type WallDisplayGroup = WallQueueGroup | WallReviewReason;
const DISPLAY_ORDER: readonly WallDisplayGroup[] = [...WALL_REASON_ORDER, 'nonStandard', 'standard', 'reviewed'];
/* L23: đoạn chưa duyệt mà máy không nghi gì. */
const CLEAR_TITLE = 'Không thấy điểm nghi';

/* Tầng chưa có tỷ lệ: độ dày đo ra vô nghĩa, nên không chia theo độ dày (UX-R2 K23). */
const UNSCALED_TITLE = 'Chưa duyệt';

/** Nhóm của một hàng: theo hàng đợi ở hook; không có hàng đợi (story cũ) thì suy từ cờ của hàng. */
function groupOf(row: WallRowViewModel, queue: WallReviewQueue | undefined, isScaleLocked = false): WallQueueGroup {
  const group =
    queue?.extras.get(row.id)?.group ??
    (row.isReviewed ? 'reviewed' : row.isNonStandardThickness ? 'nonStandard' : 'standard');

  return isScaleLocked && group === 'nonStandard' ? 'standard' : group;
}

/** Đi lên DOM tìm tổ tiên cuộn gần nhất — đúng kỹ thuật `Table.tsx#TableVirtual`. */
function findScrollParent(node: HTMLElement | null): HTMLElement | null {
  let current = node;

  while (current) {
    const overflow = getComputedStyle(current).overflowY;

    if (overflow === 'auto' || overflow === 'scroll') {
      return current;
    }

    current = current.parentElement;
  }

  return (document.scrollingElement as HTMLElement | null) ?? null;
}

/** Nhóm hiển thị của một hàng: chưa duyệt mà có lý do máy nghi (L23) thì vào nhóm lý do. */
function displayGroupOf(row: WallRowViewModel, queue: WallReviewQueue | undefined, isScaleLocked: boolean): WallDisplayGroup {
  const group = groupOf(row, queue, isScaleLocked);
  const reason = queue?.extras.get(row.id)?.reason ?? null;
  return group !== 'reviewed' && reason !== null ? reason : group;
}

function buildItems(
  rows: readonly WallRowViewModel[],
  queue: WallReviewQueue | undefined,
  showReviewedRows: boolean,
  hasBulkNotice: boolean,
  isScaleLocked: boolean,
): readonly ListItem[] {
  const groups = new Map<WallDisplayGroup, WallRowViewModel[]>(DISPLAY_ORDER.map((group) => [group, []]));

  for (const row of rows) {
    groups.get(displayGroupOf(row, queue, isScaleLocked))!.push(row);
  }

  const items: ListItem[] = [];

  for (const group of DISPLAY_ORDER) {
    const members = groups.get(group) ?? [];

    if (members.length === 0) {
      continue;
    }

    items.push({ kind: 'header', group, count: members.length });

    if (group === 'nonStandard' && hasBulkNotice) {
      items.push({ kind: 'bulk' });
    }

    if (group !== 'reviewed' || showReviewedRows) {
      items.push(...members.map((row) => ({ kind: 'row' as const, row })));
    }
  }

  return items;
}

/** Tiêu đề nhóm gần nhất ở trên hàng đầu đang thấy (`-1` = không có). `headerKey` = chỉ số tiêu đề, nối dấu phẩy. */
function activeHeaderOf(headerKey: string, firstVisible: number): number {
  if (headerKey === '') return -1;
  return headerKey.split(',').map(Number).reverse().find((index) => firstVisible >= index) ?? -1;
}

const keyOf = (item: ListItem | undefined): string =>
  item === undefined ? '' : item.kind === 'row' ? item.row.id : item.kind === 'header' ? `h-${item.group}` : item.kind;

const heightOf = (item: ListItem | undefined): number =>
  item?.kind === 'header' ? HEADER_HEIGHT_PX : item?.kind === 'bulk' ? BULK_HEIGHT_PX : LIST_ROW_HEIGHT_PX;

export function WallLayerList({ panel, flashingWallId, onToggleSelect, queue, onOpenBulk, queueNumbers }: WallLayerListProps) {
  const { rows, selectedWallId, hoveredWallId, onSelect, onHover, onOpenRowMenu, state, emptyNotice } = panel;
  const selectedWallIds = panel.selectedWallIds ?? (selectedWallId === null ? [] : [selectedWallId]);
  const [reviewedOpen, setReviewedOpen] = useState(false);
  const selectedIsReviewed = rows.some((row) => row.id === selectedWallId && row.isReviewed);
  const hasOthers = rows.some((row) => groupOf(row, queue) !== 'reviewed');
  const showReviewedRows = reviewedOpen || selectedIsReviewed || !hasOthers;
  const isScaleLocked = panel.scaleLock != null;
  // Thiếu tỷ lệ (hoặc tường mỏng < 50 mm): ép về chuẩn chỉ che lỗi, nên thay nút bằng câu dẫn đi đặt tỷ lệ (K09).
  const bulkLockText = queue?.lockText ?? null;
  const hasBulk = onOpenBulk !== undefined && queue !== undefined;
  const items = buildItems(rows, queue, showReviewedRows, hasBulk && bulkLockText !== null, isScaleLocked);
  // Vai Người xem luôn ở `forbidden`; "đang tải" của họ đọc từ dữ liệu (bất biến 7), không từ vai (16-D-008).
  const isLoadingList =
    state === 'loading' ||
    (panel.isViewerRole && rows.length === 0 && panel.reviewCounter.total === 0 && emptyNotice === null && panel.errorMessage === null);
  const containerRef = useRef<HTMLDivElement | null>(null);
  const scrollParentRef = useRef<HTMLElement | null>(null);

  useEffect(() => {
    scrollParentRef.current = findScrollParent(containerRef.current);
  }, []);

  /* Tiêu đề nhóm dính đầu vùng cuộn (kiểu Figma): luôn dựng tiêu đề của nhóm đang ở đỉnh, vẽ nó `sticky`. */
  const headerKey = items.flatMap((item, index) => (item.kind === 'header' ? [index] : [])).join(',');
  const rangeExtractor = useCallback(
    (range: Range) => {
      const next = new Set(defaultRangeExtractor(range));
      const active = activeHeaderOf(headerKey, range.startIndex);
      if (active !== -1) next.add(active);
      return [...next].sort((a, b) => a - b);
    },
    [headerKey],
  );

  const rowVirtualizer = useVirtualizer({
    count: items.length,
    rangeExtractor,
    estimateSize: (index) => heightOf(items[index]),
    getItemKey: (index) => keyOf(items[index]),
    getScrollElement: () => scrollParentRef.current,
    overscan: 8,
  });

  const selectedIndex = items.findIndex((item) => item.kind === 'row' && item.row.id === selectedWallId);

  useEffect(() => {
    if (selectedIndex === -1) {
      return;
    }

    rowVirtualizer.scrollToIndex(selectedIndex, { align: 'auto', behavior: 'smooth' });

    /* Focus đang ở một hàng khác (J/K, bấm trên bản vẽ) thì đi theo hàng được chọn (G4a-16). */
    const container = containerRef.current;

    if (container === null || !container.contains(document.activeElement) || selectedWallId === null) {
      return;
    }

    const frame = requestAnimationFrame(() => {
      const target = container.querySelector<HTMLElement>(`[data-wall-id="${selectedWallId}"]`);

      if (target !== null && target !== document.activeElement) {
        target.focus({ preventScroll: true });
      }
    });

    return () => cancelAnimationFrame(frame);
  }, [selectedIndex, selectedWallId, rowVirtualizer]);

  // Ref bọc ngoài LUÔN gắn vào một div ở cùng vị trí cây, nhánh nào cũng vậy (ảo hoá cần nó).
  if (isLoadingList) {
    return (
      <div aria-label={LIST_ARIA_LABEL} className="flex flex-col" ref={containerRef} role="status">
        {Array.from({ length: LOADING_SKELETON_ROWS }, (_, index) => (
          <Skeleton className="h-8" key={index} preset="table-row" />
        ))}
      </div>
    );
  }

  if (rows.length === 0 && emptyNotice !== null) {
    return (
      <div ref={containerRef}>
        <EmptyState description={emptyNotice} icon={<Inbox />} title={EMPTY_LIST_TITLE} />
      </div>
    );
  }

  // `error`: panel cha đã hiện `InlineAlert` — không thêm câu "không khớp bộ lọc" gây hiểu lầm.
  if (rows.length === 0 && state === 'error') {
    return <div ref={containerRef} />;
  }

  if (rows.length === 0) {
    return (
      <div ref={containerRef}>
        <p className="px-2 py-8 text-center text-[13px] text-text-secondary">{NO_MATCH_MESSAGE}</p>
      </div>
    );
  }

  /* Tầng khoá vì thiếu tỷ lệ: dải đỏ và nút góc phải đã dẫn đi đặt tỷ lệ — danh sách không lặp nút thứ ba (K23). */
  const byReason = rows.some((row) => queue?.extras.get(row.id)?.reason !== undefined);
  const groupTitleOf = (group: WallDisplayGroup): string => {
    if (group === 'nonStandard' || group === 'standard' || group === 'reviewed') {
      if (isScaleLocked && group === 'standard') return UNSCALED_TITLE;
      return byReason && group === 'standard' ? CLEAR_TITLE : GROUP_TITLE[group];
    }
    return WALL_REASON_TITLE[group];
  };

  const activeHeader = activeHeaderOf(headerKey, rowVirtualizer.range?.startIndex ?? 0);

  /* U37: một điểm Tab cho cả danh sách — hàng đang chọn nếu đang vẽ, không thì hàng đầu đang vẽ (ảo hoá). */
  const renderedRowIds = rowVirtualizer
    .getVirtualItems()
    .flatMap((virtualItem) => {
      const item = items[virtualItem.index];
      return item?.kind === 'row' ? [item.row.id] : [];
    });
  const tabStopId =
    selectedWallId !== null && renderedRowIds.includes(selectedWallId) ? selectedWallId : (renderedRowIds[0] ?? null);

  return (
    <div aria-label={LIST_ARIA_LABEL} className="relative" ref={containerRef} role="listbox" style={{ height: rowVirtualizer.getTotalSize() }}>
      {rowVirtualizer.getVirtualItems().map((virtualItem) => {
        const item = items[virtualItem.index];
        const style = { transform: `translateY(${virtualItem.start}px)` };

        if (item === undefined) {
          return null;
        }

        if (item.kind === 'header') {
          const isReviewed = item.group === 'reviewed';
          const isOpen = showReviewedRows;
          const isSticky = virtualItem.index === activeHeader;

          return (
            <div
              className={cn('inset-x-0 top-0 z-10 flex h-7 items-center justify-between gap-2 bg-bg-surface px-2', isSticky ? 'sticky' : 'absolute')}
              key={keyOf(item)}
              role="presentation"
              style={isSticky ? undefined : style}
            >
              {isReviewed ? (
                <button
                  aria-expanded={isOpen}
                  className="flex min-h-6 items-center gap-1 rounded-md text-caption font-medium text-text-secondary hover:text-text-primary focus-visible:outline-solid focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
                  onClick={() => setReviewedOpen(!isOpen)}
                  type="button"
                >
                  <ChevronDown aria-hidden="true" className={cn('h-3.5 w-3.5 transition-transform duration-180', !isOpen && '-rotate-90')} />
                  {`${groupTitleOf(item.group)}: ${item.count}`}
                </button>
              ) : (
                <span className="min-w-0 truncate text-caption font-medium text-text-secondary">
                  {`${groupTitleOf(item.group)}: ${item.count}`}
                </span>
              )}
              {item.group === 'nonStandard' && hasBulk && bulkLockText === null ? (
                <Button className="h-6 shrink-0 px-1.5 text-caption" onClick={onOpenBulk} size="sm" variant="ghost">
                  {`Đưa ${queue?.bulk.changeCount ?? 0} tường về chuẩn`}
                </Button>
              ) : null}
            </div>
          );
        }

        if (item.kind === 'bulk') {
          return (
            <div className="absolute inset-x-0 top-0 flex h-11 items-center px-1" key="bulk" role="presentation" style={style}>
              <p className="px-1 text-caption leading-snug text-state-violation">{bulkLockText}</p>
            </div>
          );
        }

        const { row } = item;

        return (
          <WallLayerListRow
            extra={queue?.extras.get(row.id)}
            isFlashing={row.id === flashingWallId}
            isHovered={row.id === hoveredWallId}
            isSelected={selectedWallIds.includes(row.id)}
            isTabStop={row.id === tabStopId}
            key={row.id}
            onHover={onHover}
            onOpenMenu={onOpenRowMenu}
            onSelect={onSelect}
            onToggleSelect={onToggleSelect}
            queueNumber={queueNumbers?.get(row.id)}
            onUnapprove={panel.isViewerRole || isScaleLocked ? undefined : panel.onUnapprove}
            row={row}
            showThickness={!isScaleLocked}
            showConfidence={queue?.showConfidence ?? true}
            style={style}
          />
        );
      })}
    </div>
  );
}
