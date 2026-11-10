/**
 * Bảng người dùng: sáu cột — ảnh đại diện + họ tên + email · vai · số dự án · lần hoạt động
 * cuối · trạng thái · hành động; panel chi tiết mở thì còn ba (BUG-071: bảng phải vừa
 * khung, không cuộn ngang). `isCollapsed === true` đổi bảng thành thẻ xếp chồng, không
 * phải bảng thu nhỏ (Đ-7 trạng thái 7).
 *
 * `Table.Row`/`Table.Cell` hard-code `h-10` (40px); 48px của đặc tả đạt được bằng cách
 * truyền `className="h-12"` cho CẢ HAI — `twMerge` bên trong hai component đó ghi đè `h-10`.
 *
 * `row.justChanged` nháy nền 340 ms — `duration-340` là tên hạng mục Tailwind ứng với
 * `MOTION_DURATIONS_MS.slow` (`src/lib/motion/tokens.ts`), không phải một số viết tay; đặc
 * tả gốc ghi 400 ms nhưng 400 không có trên thang năm giá trị (Đ-9). Tiền lệ nguyên văn:
 * `screens/qc/WallLayerReview/WallLayerList.tsx`.
 *
 * Vai và trạng thái không bao giờ đứng một mình bằng màu (đặc tả cấm tuyệt đối): `Badge`
 * dùng `variant="neutral"` cho cả hai, chữ đọc được luôn đi kèm dấu chấm màu.
 */
import { SearchX } from 'lucide-react';
import { useEffect, useRef } from 'react';

import { EmptyState } from '@/components/feedback/EmptyState';
import { Avatar } from '@/components/ui/Avatar';
import { Badge } from '@/components/ui/Badge';
import { Table } from '@/components/ui/Table';
import { Tooltip } from '@/components/ui/Tooltip';
import { initialsOf } from '@/lib/format/initials';
import { cn } from '@/lib/utils';

import { RoleCell } from './RoleCell';
import type { RoleOption, UserManagementActions, UserManagementTableProps, UserRowModel } from './types';

const HEADER_USER = 'Người dùng';
const HEADER_ROLE = 'Vai';
const HEADER_PROJECTS = 'Số dự án';
const HEADER_LAST_ACTIVE = 'Lần hoạt động cuối';
const HEADER_STATUS = 'Trạng thái';
const HEADER_ACTIONS = 'Hành động';
const SELF_LABEL = 'Bạn';
const SELF_TOOLTIP = 'Không tự đổi vai hoặc xoá tài khoản của chính mình';
const NO_MATCH_TITLE = 'Không tìm thấy người dùng';
const NO_MATCH_DESCRIPTION = 'Không ai khớp với từ khoá hoặc bộ lọc đang chọn.';
// Nút đặt lại cả ô tìm lẫn hai bộ lọc (`onClearSearch`), nên nhãn nói đủ cả hai.
const CLEAR_SEARCH_LABEL = 'Xoá tìm kiếm và bộ lọc';
const INVITE_EXPIRED_LABEL = 'Lời mời đã hết hạn';
const RESEND_INVITE_LABEL = 'Gửi lại';
const NEW_INVITE_LABEL = 'Vừa mời';
/** UX-47: hàng vừa mời giữ nền chọn (không chỉ nháy) để mắt tìm thấy sau khi bảng cuộn tới. */
const NEW_INVITE_CLASS = 'bg-bg-selected';
const DISABLE_LABEL = 'Vô hiệu hoá';
const ENABLE_LABEL = 'Bật lại';
const REMOVE_LABEL = 'Xoá';
const REMOVE_CLASS = 'text-state-violation-text hover:text-state-violation-text';
const ROW_HEIGHT = 'h-12';
/**
 * `Table.Cell` cấm xuống dòng (`whitespace-nowrap`); ở bảng này thì ngược lại: câu lý do
 * dài ("Bạn không thể tự…") và email dài phải xuống dòng để bảng vừa khung (BUG-071).
 */
const WRAP_CELL = cn(ROW_HEIGHT, 'whitespace-normal');
// Trần 160 px chỉ cho cột hành động của bảng (≥ 1024); trong thẻ hẹp câu lý do dùng hết bề ngang (review-1).
const BLOCKED_REASON_CLASS = 'whitespace-normal text-[13px] text-text-secondary lg:max-w-40';
const FOCUS_RING =
  'outline-hidden focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:ring-offset-bg-surface';

/**
 * `exactOptionalPropertyTypes` phân biệt "không truyền prop" với "truyền `undefined`".
 * `row.avatarUrl` là `string | undefined`; spread có điều kiện thay vì truyền thẳng để
 * tránh lỗi TS2375 trên `AvatarProps.src?: string`.
 */
function avatarSrcProp(avatarUrl: string | undefined): { src: string } | Record<string, never> {
  return avatarUrl === undefined ? {} : { src: avatarUrl };
}

interface StatusCellProps {
  readonly row: UserRowModel;
}

function StatusCell({ row }: StatusCellProps) {
  // Một chip: lời mời hết hạn thay chữ trạng thái, không thêm dòng phụ.
  const status = (
    <Badge className="whitespace-nowrap" variant="neutral">
      {row.inviteExpired ? INVITE_EXPIRED_LABEL : row.statusLabel}
    </Badge>
  );
  if (row.isNewInvite !== true) return status;
  return (
    <span className="inline-flex flex-wrap items-center gap-1">
      {status}
      <Badge className="whitespace-nowrap" variant="attention">
        {NEW_INVITE_LABEL}
      </Badge>
    </span>
  );
}

/**
 * UX-47: sau lượt mời, cuộn tới hàng mời đầu tiên — một lần mỗi lượt mời (khoá = danh sách id),
 * không giật lại mỗi lần bảng vẽ lại.
 */
function useScrollToNewInvite<TElement extends HTMLElement>(rows: readonly UserRowModel[]) {
  const targetRef = useRef<TElement>(null);
  const newIds = rows.filter((row) => row.isNewInvite === true).map((row) => row.id);
  const key = newIds.join(',');
  useEffect(() => {
    if (key === '') return;
    targetRef.current?.scrollIntoView?.({ block: 'center' });
  }, [key]);
  return { firstNewId: newIds[0] ?? null, targetRef };
}

interface RowActionsProps {
  readonly actions: UserManagementActions;
  readonly row: UserRowModel;
}

const MENU_ITEM_CLASS = cn(
  'block w-full rounded-sm px-3 py-1.5 coarse:min-h-11 text-left text-[13px] hover:bg-bg-hover disabled:text-text-secondary',
  FOCUS_RING,
);

function RowActions({ actions, row }: RowActionsProps) {
  if (row.isSelf && (row.removeBlockedReason !== null || row.disableBlockedReason !== null)) {
    return (
      <div className="flex justify-end">
        <Tooltip label={SELF_TOOLTIP}>
          <span className={cn('text-[13px] font-medium text-text-secondary', FOCUS_RING)} tabIndex={0}>
            {SELF_LABEL}
          </span>
        </Tooltip>
      </div>
    );
  }

  // Menu "⋯" gốc (<details>): bấm mục nào thì đóng menu rồi chạy hành động.
  const run = (fn: () => void) => (event: React.MouseEvent<HTMLButtonElement>) => {
    event.currentTarget.closest('details')?.removeAttribute('open');
    fn();
  };

  return (
    <div className="flex justify-end">
      <details
        className="relative"
        // Esc đóng menu và giữ tiêu điểm ở nút ⋯; chặn nổi bọt để không đóng luôn tấm chi tiết (A-01).
        onKeyDown={(event) => {
          if (event.key !== 'Escape' || !event.currentTarget.open) return;
          event.stopPropagation();
          event.currentTarget.open = false;
          event.currentTarget.querySelector('summary')?.focus();
        }}
      >
        <summary
          aria-label={`Thao tác với ${row.name}`}
          className={cn(
            'flex h-8 w-8 coarse:h-11 coarse:w-11 cursor-pointer list-none items-center justify-center rounded-md text-text-secondary hover:bg-bg-hover [&::-webkit-details-marker]:hidden',
            FOCUS_RING,
          )}
        >
          <span aria-hidden="true">⋯</span>
        </summary>
        <div className="absolute right-0 z-20 mt-1 flex min-w-40 flex-col rounded-md border border-border-default bg-bg-surface p-1 shadow-lg">
          {row.canResendInvite && (
            <button
              aria-label={`${RESEND_INVITE_LABEL} lời mời cho ${row.email}`}
              className={MENU_ITEM_CLASS}
              onClick={run(() => actions.onResendInvite(row.id))}
              type="button"
            >
              {RESEND_INVITE_LABEL}
            </button>
          )}
          {row.status === 'disabled' ? (
            <button
              aria-label={`${ENABLE_LABEL} ${row.name}`}
              className={MENU_ITEM_CLASS}
              onClick={run(() => actions.onEnableUser(row.id))}
              type="button"
            >
              {ENABLE_LABEL}
            </button>
          ) : row.disableBlockedReason !== null ? (
            <span className={cn(BLOCKED_REASON_CLASS, 'px-3 py-1.5')}>{row.disableBlockedReason}</span>
          ) : (
            <button
              aria-label={`${DISABLE_LABEL} ${row.name}`}
              className={MENU_ITEM_CLASS}
              onClick={run(() => actions.onDisableUser(row.id))}
              type="button"
            >
              {DISABLE_LABEL}
            </button>
          )}
          {row.removeBlockedReason !== null ? (
            <span className={cn(BLOCKED_REASON_CLASS, 'px-3 py-1.5 coarse:mt-2')}>{row.removeBlockedReason}</span>
          ) : (
            <button
              aria-label={`${REMOVE_LABEL} ${row.name}`}
              className={cn(MENU_ITEM_CLASS, REMOVE_CLASS, 'coarse:mt-2')}
              onClick={run(() => actions.onOpenRemove(row.id))}
              type="button"
            >
              {REMOVE_LABEL}
            </button>
          )}
        </div>
      </details>
    </div>
  );
}

/** Tìm không thấy ai: cùng một khối ở mọi khổ, có lối thoát (BUG-082). */
function NoMatchState({ onClearSearch }: { readonly onClearSearch: () => void }) {
  return (
    <EmptyState
      action={{ label: CLEAR_SEARCH_LABEL, onClick: onClearSearch, variant: 'secondary' }}
      description={NO_MATCH_DESCRIPTION}
      icon={<SearchX aria-hidden="true" />}
      title={NO_MATCH_TITLE}
    />
  );
}

interface UserListProps {
  readonly actions: UserManagementActions;
  readonly roleOptions: readonly RoleOption[];
  readonly rows: readonly UserRowModel[];
}

/** Dưới 1024: bảng thành một cột thẻ xếp chồng. */
function UserManagementCardList({ actions, roleOptions, rows }: UserListProps) {
  const { firstNewId, targetRef } = useScrollToNewInvite<HTMLLIElement>(rows);
  return (
    <ul className="flex flex-col gap-2">
      {rows.map((row) => (
        <li
          className={cn(
            'flex flex-col gap-3 rounded-lg border border-border-default p-3',
            row.isNewInvite === true && NEW_INVITE_CLASS,
            row.justChanged && 'bg-bg-flash duration-340',
          )}
          data-new-invite={row.isNewInvite === true ? 'true' : undefined}
          key={row.id}
          ref={row.id === firstNewId ? targetRef : undefined}
        >
          <div className="flex items-center gap-3">
            <Avatar alt={row.name} initials={initialsOf(row.name, row.email)} size="default" {...avatarSrcProp(row.avatarUrl)} />
            <button
              className={cn('min-w-0 flex-1 text-left', FOCUS_RING)}
              onClick={() => actions.onSelectUser(row.id)}
              type="button"
            >
              <p className="font-medium text-text-primary wrap-anywhere">{row.name}</p>
              <p className="text-[13px] text-text-secondary wrap-anywhere">{row.email}</p>
            </button>
          </div>
          {/* Dưới dòng tên, không cạnh nó: cạnh nhau thì email chỉ còn ~110 px và bị cắt (BUG-075). */}
          <StatusCell row={row} />
          <dl className="grid grid-cols-2 gap-x-4 gap-y-2 text-[13px]">
            <div className="flex flex-col gap-1">
              <dt className="text-text-secondary">{HEADER_ROLE}</dt>
              <dd>
                <RoleCell actions={actions} roleOptions={roleOptions} row={row} />
              </dd>
            </div>
            <div className="flex justify-between gap-2">
              <dt className="text-text-secondary">{HEADER_PROJECTS}</dt>
              <dd className="tabular-nums">{row.projectCountLabel}</dd>
            </div>
            <div className="col-span-2 flex justify-between gap-2">
              <dt className="text-text-secondary">{HEADER_LAST_ACTIVE}</dt>
              <dd>
                <Tooltip label={row.lastActiveExactLabel}>
                  <span className={cn(FOCUS_RING, 'xl:whitespace-nowrap')} tabIndex={0}>{row.lastActiveLabel}</span>
                </Tooltip>
              </dd>
            </div>
          </dl>
          <RowActions actions={actions} row={row} />
        </li>
      ))}
    </ul>
  );
}

/**
 * Cột của bảng rộng. Panel chi tiết mở thì bảng chỉ còn 560–616 px, nên hai cột phụ (số dự
 * án, lần hoạt động cuối) nhường chỗ — người đang mở panel đã có chi tiết bên cạnh — và
 * trạng thái gộp vào ô người dùng, dưới email (BUG-071).
 */
function TableHeaderRow({ withSecondary }: { readonly withSecondary: boolean }) {
  return (
    <Table.Header>
      <Table.Row>
        <Table.Head>{HEADER_USER}</Table.Head>
        <Table.Head>{HEADER_ROLE}</Table.Head>
        {withSecondary && <Table.Head>{HEADER_PROJECTS}</Table.Head>}
        {withSecondary && <Table.Head>{HEADER_LAST_ACTIVE}</Table.Head>}
        {withSecondary && <Table.Head>{HEADER_STATUS}</Table.Head>}
        <Table.Head>
          {/* Canh phải như nút trong ô (K4). `Table.Head` bọc chữ trong một `flex`, nên canh bằng `w-full`. */}
          <span className="w-full text-right">{HEADER_ACTIONS}</span>
        </Table.Head>
      </Table.Row>
    </Table.Header>
  );
}

export function UserManagementTable({
  actions,
  isCollapsed,
  roleOptions,
  rows,
  selectedUserId,
  skeletonRowCount,
  state,
}: UserManagementTableProps) {
  const withSecondary = selectedUserId === null;
  const { firstNewId, targetRef } = useScrollToNewInvite<HTMLTableRowElement>(rows);

  if (state === 'loading') {
    return (
      <Table.Root>
        <TableHeaderRow withSecondary={withSecondary} />
        <Table.Body>
          <Table.Skeleton columns={withSecondary ? 6 : 3} rows={skeletonRowCount} />
        </Table.Body>
      </Table.Root>
    );
  }

  if (rows.length === 0) {
    return <NoMatchState onClearSearch={actions.onClearSearch} />;
  }

  if (isCollapsed) {
    return <UserManagementCardList actions={actions} roleOptions={roleOptions} rows={rows} />;
  }

  return (
    <Table.Root>
      <TableHeaderRow withSecondary={withSecondary} />
      <Table.Body>
        {rows.map((row) => (
          <Table.Row
            className={cn(ROW_HEIGHT, row.isNewInvite === true && NEW_INVITE_CLASS, row.justChanged && 'duration-340')}
            data-new-invite={row.isNewInvite === true ? 'true' : undefined}
            isFlash={row.justChanged}
            key={row.id}
            ref={row.id === firstNewId ? targetRef : undefined}
            selected={row.id === selectedUserId}
          >
            {/* Dưới 1280 bỏ ảnh đại diện (tên + email đủ nhận ra người) để cột "Hành động" không bị cắt ở 1024. */}
            <Table.Cell className={cn(WRAP_CELL, 'min-w-[200px] xl:min-w-[230px]')}>
              <div className="flex items-center gap-3">
                <span className="contents max-xl:hidden">
                  <Avatar alt={row.name} initials={initialsOf(row.name, row.email)} size="default" {...avatarSrcProp(row.avatarUrl)} />
                </span>
                <div className="flex min-w-0 flex-col">
                  <button
                    className={cn('min-h-6 text-left font-medium text-text-primary wrap-anywhere', FOCUS_RING)}
                    onClick={() => actions.onSelectUser(row.id)}
                    type="button"
                  >
                    {row.name}
                  </button>
                  <span className="text-[13px] text-text-secondary wrap-anywhere xl:whitespace-nowrap">{row.email}</span>
                  {!withSecondary && (
                    <div className="pt-1">
                      <StatusCell row={row} />
                    </div>
                  )}
                </div>
              </div>
            </Table.Cell>
            <Table.Cell className={WRAP_CELL}>
              <RoleCell actions={actions} roleOptions={roleOptions} row={row} />
            </Table.Cell>
            {withSecondary && (
              <Table.Cell className={cn(ROW_HEIGHT, 'tabular-nums')}>{row.projectCountLabel}</Table.Cell>
            )}
            {withSecondary && (
              <Table.Cell className={WRAP_CELL}>
                <Tooltip label={row.lastActiveExactLabel}>
                  <span className={cn(FOCUS_RING, 'xl:whitespace-nowrap')} tabIndex={0}>{row.lastActiveLabel}</span>
                </Tooltip>
              </Table.Cell>
            )}
            {withSecondary && (
              <Table.Cell className={WRAP_CELL}>
                <StatusCell row={row} />
              </Table.Cell>
            )}
            <Table.Cell className={WRAP_CELL}>
              <RowActions actions={actions} row={row} />
            </Table.Cell>
          </Table.Row>
        ))}
      </Table.Body>
    </Table.Root>
  );
}
