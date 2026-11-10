/**
 * Trung tâm thông báo — tấm trượt 400px neo vào chuông (W2, nửa vẽ của mục D).
 *
 * VIEW THUẦN (R-60): mọi thứ tới qua {@link NotificationCenterProps}, không
 * `@/api`/`@/store`/`@/domain`/`@/lib/http`. `useState` ở đây chỉ phục vụ một
 * hiệu ứng trình bày (tấm mờ dần trước khi đóng) — bảy trạng thái A11 đọc
 * thẳng từ `screenState`, không tự viết `isLoading`/`error` (R-64).
 *
 * Bốn điểm dễ đoán sai: Drawer đã lo phần dưới 1024px cùng Esc/bẫy tiêu điểm
 * nên không có `keydown` hay media query thứ hai ở đây. Hậu tố alpha Tailwind
 * biên dịch ra rỗng — nháy `bg-selected` dùng một lớp `aria-hidden` riêng, mờ
 * bằng `opacity` của framer-motion, không `bg-selected/20`. Chưa đọc luôn là
 * một chấm (`UNREAD_DOT_SIZE_PX`), ẩn hiện bằng `opacity` chứ không unmount,
 * không bao giờ là nền hàng. So le dùng chỉ số vị trí PHẲNG chứ không phải
 * "còn chưa đọc": đánh dấu tất cả đã đọc bật mọi `isRead` cùng lúc nên lọc
 * theo chưa đọc lúc đó sẽ mất hết độ trễ so le.
 *
 * Chuông (R-73) xuất từ chính file này vì `AppShell.tsx` bị R-68 khoá, không
 * nhận component mới. Nghiêng một lần mỗi khi `bellNudgeToken` đổi, theo dõi
 * bằng so sánh với giá trị trước — không `animation: infinite`.
 */

import { useEffect, useRef, useState } from 'react';
import { Bell, Settings } from 'lucide-react';

import { motion, useAnimation } from '@/components/motion';
import { Drawer } from '@/components/overlay/Drawer';
import { Badge } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { IconButton } from '@/components/ui/IconButton';
import { SegmentedControl } from '@/components/ui/SegmentedControl';
import { EmptyState } from '@/components/feedback/EmptyState';
import { PageHead } from '@/components/shell/PageHead';
import { Section } from '@/components/shell/Section';
import { InlineAlert } from '@/components/feedback/InlineAlert';
import { Skeleton } from '@/components/feedback/Skeleton';
import { durationMs, durationSeconds } from '@/lib/motion';
import { cn } from '@/lib/utils';

import {
  BELL_NUDGE_DEGREES,
  NOTIFICATION_FILTERS,
  NOTIFICATION_FILTER_LABELS,
  type NotificationDayGroup,
  type NotificationFilter,
  type NotificationItemVm,
} from './notificationModel';
import { NotificationRow } from './NotificationRow';
import type { NotificationCenterProps } from './useNotificationCenter';

/* -------------------------------------------------------------------------- */
/* Chữ tĩnh của màn — không tới từ props vì đây là bản dịch cố định của UI.    */
/* -------------------------------------------------------------------------- */

const TITLE_LABEL = 'Thông báo';
const MARK_ALL_READ_LABEL = 'Đánh dấu đã đọc hết';
const PAGE_EYEBROW = 'Tài khoản · Thông báo';
const PAGE_TITLE = 'Xem việc mới từ thông báo';
const UNREAD_SUFFIX = 'chưa đọc';
const ALL_READ_LABEL = 'Đã đọc hết';
const SETTINGS_LABEL = 'Mở cài đặt thông báo';
const FILTER_ARIA_LABEL = 'Lọc thông báo';
const VIEW_ALL_LABEL = 'Xem tất cả';
const LOAD_OLDER_LABEL = 'Xem cũ hơn';
const RETRY_LABEL = 'Thử lại';
const BELL_ARIA_LABEL = 'Thông báo';

/** Trạng thái rỗng theo bộ lọc (BUG-126): mỗi tab nói đúng điều nó đang lọc. */
const EMPTY_COPY: Readonly<Record<NotificationFilter, { title: string; description: string }>> = {
  all: {
    title: 'Không có thông báo mới',
    description: 'Chúng tôi sẽ báo khi AI xử lý xong hoặc có người nhắc đến bạn.',
  },
  unread: {
    title: 'Không có thông báo chưa đọc',
    description: 'Bạn đã đọc hết thông báo.',
  },
  mentions: {
    title: 'Chưa có ai nhắc đến bạn',
    description: 'Khi có người nhắc đến bạn trong bình luận, thông báo sẽ hiện ở đây.',
  },
};
const SHOW_EVERYTHING_LABEL = 'Hiện mọi thông báo';
const PARTIAL_NOTICE = 'Có thể chưa cập nhật';
const FORBIDDEN_NOTICE = 'Bạn chỉ thấy thông báo của những dự án được chia sẻ với bạn.';
const ERROR_TITLE = 'Không tải được thông báo';
const ERROR_FALLBACK_MESSAGE = 'Kiểm tra kết nối rồi thử lại.';

const FILTER_OPTIONS = NOTIFICATION_FILTERS.map((value) => ({
  value,
  label: NOTIFICATION_FILTER_LABELS[value],
}));

const LOADING_ROW_COUNT = 5;

/** Lề ngang của tờ dưới 640 px: 16 px thay cho 32 px của ngăn (BUG-234, BUG-203). */
const SHEET_GUTTER = 'max-sm:px-4';

/** Vị trí phẳng của mỗi mục qua mọi nhóm ngày — nguồn của độ trễ so le. */
function flatIndexOf(groups: readonly NotificationDayGroup[]): ReadonlyMap<string, number> {
  const indices = new Map<string, number>();
  for (const group of groups) {
    for (const item of group.items) {
      indices.set(item.id, indices.size);
    }
  }
  return indices;
}

/* -------------------------------------------------------------------------- */
/* Màn.                                                                        */
/* -------------------------------------------------------------------------- */

/** Hai lối bấm của một dòng: tấm trượt mờ dần rồi đóng, trang `/thong-bao` gọi thẳng. */
export interface NotificationListProps extends NotificationCenterProps {
  readonly onRowAction: (item: NotificationItemVm) => void;
  readonly onRowInlineAction: (item: NotificationItemVm) => void;
  /** Trang đầy đủ: tên dự án xuống dòng thay vì cắt "…" (LOOK-L2). */
  readonly wrapProjectName?: boolean;
  /** Trang đầy đủ (demo S-41): mỗi hàng có một lối đi thẳng tới việc ở mép phải. */
  readonly showNavigateAction?: boolean;
}

/** Thân danh sách theo `screenState` — dùng chung cho tấm trượt và trang `/thong-bao` (G1-15). */
export function NotificationList(props: NotificationListProps) {
  const {
    screenState, filter, onFilterChange, groups, onMarkRead, errorMessage, onRetry, arrivedIds,
    canLoadOlder, isLoadingOlder, onLoadOlder, onRowAction, onRowInlineAction, wrapProjectName = false,
    showNavigateAction = false,
  } = props;

  if (screenState === 'loading') {
    return <>{Array.from({ length: LOADING_ROW_COUNT }, (_u, i) => <Skeleton key={i} preset="table-row" />)}</>;
  }
  if (screenState === 'error') {
    return (
      <InlineAlert
        level="violation"
        title={ERROR_TITLE}
        message={errorMessage ?? ERROR_FALLBACK_MESSAGE}
        action={{ label: RETRY_LABEL, onClick: onRetry, variant: 'secondary' }}
      />
    );
  }
  if (screenState === 'empty') {
    const copy = EMPTY_COPY[filter];

    return (
      <EmptyState
        icon={<Bell />}
        title={copy.title}
        description={copy.description}
        {...(filter === 'all'
          ? {}
          : { action: { label: SHOW_EVERYTHING_LABEL, onClick: () => onFilterChange('all') } })}
      />
    );
  }

  const indices = flatIndexOf(groups);

  return (
    <>
      {screenState === 'partial' && <InlineAlert level="attention" message={PARTIAL_NOTICE} />}
      {screenState === 'forbidden' && (
        <p className="px-1 text-[13px] text-text-secondary">{FORBIDDEN_NOTICE}</p>
      )}
      {groups.map((group) => (
        <section key={group.key} aria-label={group.heading}>
          <h4 className="px-1 pb-1 pt-3 text-[13px] font-medium text-text-muted first:pt-0">
            {group.heading}
          </h4>
          <ul className="flex flex-col">
            {group.items.map((item) => (
              <NotificationRow
                key={item.id}
                item={item}
                flatIndex={indices.get(item.id) ?? 0}
                isArrived={arrivedIds.includes(item.id)}
                onItemAction={onRowAction}
                onMarkRead={onMarkRead}
                onInlineAction={onRowInlineAction}
                wrapProjectName={wrapProjectName}
                showNavigateAction={showNavigateAction}
              />
            ))}
          </ul>
        </section>
      ))}
      {/* G1-15: thông báo cũ hơn trang đầu nạp theo cursor, cuối danh sách. */}
      {canLoadOlder && (
        <Button variant="ghost" size="sm" fullWidth loading={isLoadingOlder} onClick={onLoadOlder}>
          {LOAD_OLDER_LABEL}
        </Button>
      )}
    </>
  );
}

/** "Đánh dấu tất cả đã đọc" + bánh răng cài đặt — chung cho tấm trượt và trang. */
export function NotificationActions({ unreadBadge, screenState, onMarkAllRead, onOpenSettings }: NotificationCenterProps) {
  const isMarkAllDisabled = unreadBadge === '' || screenState === 'loading' || screenState === 'error';

  return (
    <>
      {/* Chữ thường + khoá nhạt vừa: ghost (chữ phụ) × opacity-40 từng gần như biến mất trên nền tấm trượt (A1, Sam). */}
      <Button variant="ghost" size="sm" className="text-text-primary disabled:opacity-60" onClick={onMarkAllRead} disabled={isMarkAllDisabled}>
        {MARK_ALL_READ_LABEL}
      </Button>
      <IconButton icon={<Settings size={18} />} aria-label={SETTINGS_LABEL} size="sm" onClick={onOpenSettings} />
    </>
  );
}

export function NotificationCenter(props: NotificationCenterProps) {
  const { isOpen, onClose, filter, onFilterChange, unreadBadge, liveMessage, onItemClick, onInlineAction, onViewAll, scrollRef } = props;

  /* Hoà tan 180ms rồi mới `onClose` — trình bày thuần, không phải R-64. */
  const [isClosing, setIsClosing] = useState(false);

  useEffect(() => {
    if (isOpen) setIsClosing(false);
  }, [isOpen]);

  const closeAfterFade = () => {
    setIsClosing(true);
    setTimeout(onClose, durationMs('fast'));
  };

  const handleItemAction = (item: NotificationItemVm) => {
    onItemClick(item);
    closeAfterFade();
  };

  const handleInlineAction = (item: NotificationItemVm) => {
    onInlineAction(item);
    if (item.inlineAction?.kind === 'navigate') {
      closeAfterFade();
    }
  };

  return (
    <Drawer.Root isOpen={isOpen} onClose={onClose} label={TITLE_LABEL}>
      {/* Cột đủ cao của tấm: thân cuộn riêng, chân "Xem tất cả" ghim đáy cả ở tờ dưới 1024px (BUG-161). */}
      <div className="flex h-full min-h-0 flex-1 flex-col">
        {/* lg:pt-10: tooltip of the gear stays above (BUG-205); max-sm:px-4: 16 px gutters on the 375 px sheet (BUG-234, BUG-203). */}
        <Drawer.Header className={cn(SHEET_GUTTER, 'lg:pt-10')}>
          {/* Trạng thái 7: khung hẹp thì nhóm nút rơi xuống hàng dưới (`flex-wrap`), tiêu đề không gãy (BUG-124/125). */}
          <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-2">
            <div className="flex shrink-0 items-center gap-2 whitespace-nowrap">
              <h3 className="text-[15px] font-semibold text-text-primary">{TITLE_LABEL}</h3>
              {unreadBadge !== '' && (
                <span className="font-mono text-[13px] tabular-nums text-text-secondary">
                  {unreadBadge}
                </span>
              )}
            </div>
            {/* ml-auto: if a narrower screen still wraps the group, it stays on the right (BUG-234). */}
            <div className="ml-auto flex shrink-0 items-center gap-1">
              <NotificationActions {...props} />
            </div>
          </div>
          <div className="mt-3">
            {/* Below 640 px a text target is 44 px: the 36 px track left each tab 28 px tall (BUG-236). */}
            <SegmentedControl
              className="max-sm:h-[52px]"
              aria-label={FILTER_ARIA_LABEL}
              options={FILTER_OPTIONS}
              value={filter}
              onChange={onFilterChange}
            />
          </div>
        </Drawer.Header>

        <Drawer.Body ref={scrollRef} className={SHEET_GUTTER}>
          {/* A7/A11: số chưa đọc đổi thì trình đọc màn hình nghe được, không phải đi dò lại. */}
          <p className="sr-only" role="status" aria-live="polite">
            {liveMessage}
          </p>

          <div
            className={cn(
              'flex flex-col gap-1 transition-opacity duration-fast',
              isClosing ? 'opacity-0' : 'opacity-100',
            )}
          >
            <NotificationList {...props} onRowAction={handleItemAction} onRowInlineAction={handleInlineAction} />
          </div>
        </Drawer.Body>

        <div className={cn('shrink-0 border-t border-border-default px-8 py-4', SHEET_GUTTER)}>
          <Button variant="ghost" size="sm" fullWidth onClick={onViewAll}>
            {VIEW_ALL_LABEL}
          </Button>
        </div>
      </div>
    </Drawer.Root>
  );
}

/**
 * Trang `/thong-bao` trong khung ứng dụng (G1-15): cùng dữ liệu, bộ lọc và dòng như tấm trượt, nhưng là một
 * trang thường dưới header chung — không lớp phủ, không Esc, không "Xem tất cả" (chính là nó).
 */
export function NotificationCenterPage(props: NotificationCenterProps) {
  const { filter, onFilterChange, unreadBadge, liveMessage, onItemClick, onInlineAction } = props;

  return (
    <div className="mx-auto flex w-full max-w-[1280px] flex-col px-20 py-8 max-xl:px-8 max-lg:p-6">
      <PageHead
        eyebrow={PAGE_EYEBROW}
        title={PAGE_TITLE}
        status={
          <>
            {unreadBadge !== '' ? (
              <Badge variant="neutral" noDot>
                <span aria-hidden="true" className="h-1.5 w-1.5 shrink-0 rounded-full bg-accent" />
                {`${unreadBadge} ${UNREAD_SUFFIX}`}
              </Badge>
            ) : (
              <Badge variant="verified">{ALL_READ_LABEL}</Badge>
            )}
          </>
        }
      />
      <p className="sr-only" role="status" aria-live="polite">
        {liveMessage}
      </p>
      <Section
        flush
        title={TITLE_LABEL}
        actions={
          <>
            <SegmentedControl className="shrink-0 whitespace-nowrap" aria-label={FILTER_ARIA_LABEL}
              options={FILTER_OPTIONS}
              value={filter}
              onChange={onFilterChange}
            />
            <NotificationActions {...props} />
          </>
        }
      >
        <div className="flex flex-col gap-1 px-5 py-4">
          <NotificationList
            {...props}
            onRowAction={onItemClick}
            onRowInlineAction={onInlineAction}
            wrapProjectName
            showNavigateAction
          />
        </div>
      </Section>
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/* Chuông (R-73) — export riêng vì AppShell.tsx bị khoá, không nhận sửa.       */
/* -------------------------------------------------------------------------- */

export interface NotificationBellProps {
  /** Đã cắt ngưỡng sẵn ("9+"); chuỗi RỖNG nghĩa là không có gì chưa đọc. */
  readonly unreadBadge: string;
  readonly isOpen: boolean;
  readonly onToggle: () => void;
  /** Đổi giá trị → nghiêng đúng một lần. Không tự lặp. */
  readonly bellNudgeToken: number;
}

const BELL_ICON_SIZE = 20;

export function NotificationBell({ unreadBadge, isOpen, onToggle, bellNudgeToken }: NotificationBellProps) {
  const controls = useAnimation();
  const previousTokenRef = useRef(bellNudgeToken);

  useEffect(() => {
    if (previousTokenRef.current === bellNudgeToken) {
      return;
    }
    previousTokenRef.current = bellNudgeToken;
    void controls.start({
      rotate: [0, BELL_NUDGE_DEGREES, 0],
      transition: { duration: durationSeconds('slow') },
    });
  }, [bellNudgeToken, controls]);

  return (
    <motion.button
      type="button"
      animate={controls}
      aria-label={BELL_ARIA_LABEL}
      title={BELL_ARIA_LABEL}
      aria-expanded={isOpen}
      onClick={onToggle}
      className={cn(
        // 44 px under `sm` (640 px), the dashboard's other touch targets' size (BUG-156); 36 px from 640 px up with a fine pointer; coarse pointers keep 44 px.
        'relative flex h-11 w-11 sm:h-9 sm:w-9 coarse:h-11 coarse:w-11 items-center justify-center rounded-xl text-text-secondary outline-hidden transition-colors duration-fast',
        'hover:bg-bg-hover hover:text-text-primary',
        'focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:ring-offset-bg-surface',
        isOpen && 'bg-bg-selected text-accent-active',
      )}
    >
      <Bell aria-hidden="true" size={BELL_ICON_SIZE} strokeWidth={1.5} />
      {unreadBadge !== '' && (
        <Badge
          variant="neutral"
          noDot
          className="absolute -right-1 -top-1 h-4 px-1 text-[11px] leading-none"
        >
          {unreadBadge}
        </Badge>
      )}
    </motion.button>
  );
}
