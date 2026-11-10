/**
 * S-39 — vỏ màn quản lý người dùng (`/admin/users`). View thuần (R-60, mục D): mọi dữ liệu
 * qua `UserManagementProps`, không chạm store/mạng, không tự nuôi `isLoading`/`error`.
 *
 * Ba câu của màn (NGUYEN-TAC-BO-CUC §1, ngoài dự án nên không có FlowGate): `PageHead` nói
 * làm gì (H1 động từ), trạng thái (Badge số lời mời đang chờ + câu có số người dùng và số
 * quản trị — thay dải tóm tắt cũ), và MỘT nút chính "Mời người dùng" ở `next`; không mời
 * được thì lý do đứng tại chỗ nút (đặc tả cấm nút xám không lý do). Danh sách người nằm
 * trong MỘT `Section`: tìm/lọc và khối mời ở đầu khung.
 *
 * Bảy trạng thái A11 rẽ nhánh ở đây. Ở `forbidden` màn hiện CHỈ ma trận quyền — không
 * thanh công cụ, không danh sách người — kèm giải thích và một liên kết quay lại, để nó
 * không phải một trang 403 trơ trọi (Đ-7).
 *
 * ## Ma trận quyền có HAI chỗ mở được
 *
 * Đặc tả bắt ma trận "mở được từ đầu trang, ngoài chỗ của nó ở đáy panel" — panel chi tiết
 * có bản của riêng nó; bản ở đây là một `Modal` độc lập, bật/tắt bằng
 * `model.isPermissionReferenceOpen` + `actions.onOpen/ClosePermissionReference`.
 */
import { ShieldCheck, UserPlus } from 'lucide-react';
import { useEffect, useRef } from 'react';

import { EmptyState } from '@/components/feedback/EmptyState';
import { InlineAlert } from '@/components/feedback/InlineAlert';
import { Modal } from '@/components/overlay/Modal';
import { PageHead } from '@/components/shell/PageHead';
import { Section } from '@/components/shell/Section';
import { Badge } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { useShortcut } from '@/hooks/useShortcut';

import { RemoveConfirmDialog, UserManagementDetail } from './UserManagementDetail';
import { UserManagementPermissionMatrix } from './UserManagementPermissionMatrix';
import { Pager } from '../Pager';
import { usePaged } from '../usePaged';
import { UserManagementTable } from './UserManagementTable';
import { UserManagementToolbar } from './UserManagementToolbar';
import type {
  BreadcrumbItemModel,
  UserManagementActions,
  UserManagementProps,
  UserManagementViewModel,
} from './types';

const SCREEN_CONTAINER_CLASS =
  'mx-auto flex w-full max-w-[1280px] flex-col gap-4 px-8 py-8 min-[120rem]:max-w-[1440px]';
const PAGE_EYEBROW = 'Quản trị';
const PAGE_TITLE = 'Phân vai người dùng';
const BREADCRUMB_NAV_LABEL = 'Đường dẫn trang';
const PERMISSION_REFERENCE_BUTTON_LABEL = 'Xem ma trận quyền';
const PERMISSION_REFERENCE_MODAL_TITLE = 'Ma trận quyền theo vai trò';
const PERMISSION_MATRIX_CAPTION = 'Ma trận quyền theo vai trò';
const EMPTY_TITLE = 'Chưa có người dùng nào khác';
const INVITE_BUTTON_LABEL = 'Mời người dùng';
const ERROR_TITLE = 'Không tải được danh sách người dùng';
const ERROR_BADGE = 'Không tải được';
const GENERIC_ERROR_MESSAGE = 'Đã có lỗi xảy ra.';
const RETRY_BUTTON_LABEL = 'Thử lại';
const PENDING_SUFFIX = 'lời mời đang chờ';
const MODAL_WIDTH = 720;

/** `isCurrent`: chỉ mục cuối của breadcrumb là trang hiện tại, mục tổ tiên không href vẫn là chữ thường (BUG-P08-014). */
function BreadcrumbLink({ item, isCurrent = true }: { readonly item: BreadcrumbItemModel; readonly isCurrent?: boolean }) {
  if (item.href === null) {
    return (
      <span aria-current={isCurrent ? 'page' : undefined} className="text-text-primary">
        {item.label}
      </span>
    );
  }

  return (
    <a className="hover:text-text-primary hover:underline" href={item.href}>
      {item.label}
    </a>
  );
}

function UserManagementBreadcrumb({ items }: { readonly items: readonly BreadcrumbItemModel[] }) {
  // Chỉ giữ khi có cấp sâu hơn tab: "Quản trị › Người dùng" lặp đúng thanh tab ngay trên nó.
  if (items.length <= 2) return null;
  return (
    <nav aria-label={BREADCRUMB_NAV_LABEL} className="text-[13px] text-text-secondary">
      <ol className="flex items-center gap-1.5">
        {items.map((item, index) => (
          <li className="flex items-center gap-1.5" key={item.label}>
            {index > 0 && <span aria-hidden="true">›</span>}
            <BreadcrumbLink isCurrent={index === items.length - 1} item={item} />
          </li>
        ))}
      </ol>
    </nav>
  );
}

/** Dòng trạng thái: lời mời đang chờ ở Badge, số người dùng + số quản trị ở câu — mỗi số một chỗ. */
function UsersStatus({ model }: { readonly model: UserManagementViewModel }) {
  if (model.state === 'loading') return null;
  if (model.state === 'error') return <Badge variant="violation">{ERROR_BADGE}</Badge>;

  const { summary } = model;
  return (
    <>
      <Badge variant="neutral">
        <span className="tabular-nums" data-testid="user-summary-pending">
          {summary.pendingInviteCountLabel}
        </span>{' '}
        {PENDING_SUFFIX}
      </Badge>
      <span>
        <span className="tabular-nums" data-testid="user-summary-users">
          {summary.userCountLabel}
        </span>
        {' người dùng, '}
        <span className="tabular-nums" data-testid="user-summary-admins">
          {summary.adminCountLabel}
        </span>
        {' quản trị.'}
      </span>
    </>
  );
}

function renderContent(model: UserManagementViewModel, actions: UserManagementActions) {
  if (model.state === 'empty') {
    return (
      <div className="p-5">
        <EmptyState
          action={{ label: INVITE_BUTTON_LABEL, onClick: actions.onOpenInvite, variant: 'secondary' }}
          description={model.emptyTeachingLabel}
          icon={<UserPlus aria-hidden="true" />}
          title={EMPTY_TITLE}
        />
      </div>
    );
  }

  if (model.state === 'error') {
    return (
      <div className="p-5">
        <InlineAlert
          action={{ label: RETRY_BUTTON_LABEL, onClick: actions.onRetry }}
          level="violation"
          message={model.errorLabel ?? GENERIC_ERROR_MESSAGE}
          title={ERROR_TITLE}
        />
      </div>
    );
  }

  return <PagedUserList actions={actions} model={model} />;
}

function PagedUserList({ actions, model }: { readonly actions: UserManagementActions; readonly model: UserManagementViewModel }) {
  // Thẻ (khổ hẹp) cao ~270 px: trang ngắn hơn bảng (A-12).
  const paged = usePaged(model.rows, model.isCollapsed ? 20 : undefined);
  return (
    <>
      <div className={model.isCollapsed ? 'p-5' : undefined}>
        <UserManagementTable
          actions={actions}
          isCollapsed={model.isCollapsed}
          roleOptions={model.toolbar.roleOptions}
          rows={paged.pageRows}
          selectedUserId={model.selectedUserId}
          skeletonRowCount={model.skeletonRowCount}
          state={model.state}
        />
      </div>
      <Pager pageSize={model.isCollapsed ? 20 : 50} onPageChange={paged.setPage} page={paged.page} pageCount={paged.pageCount} total={paged.total} />
    </>
  );
}

export function UserManagement({ model, actions }: UserManagementProps) {
  // "Xoá tìm kiếm và bộ lọc" nằm trong khối không-khớp, khối ấy biến mất ngay khi bấm: đưa tiêu điểm về ô
  // tìm, đừng để nó rơi về `body` (BUG-082, A12).
  const searchRef = useRef<HTMLInputElement>(null);
  // Nút đã mở chi tiết: đóng (Esc/nút X) thì tiêu điểm về đó, không rơi về `body` (BUG-P08-019, 37U-E-006).
  const openerRef = useRef<HTMLElement | null>(null);
  const isDetailOpen = model.detail !== null;
  // Nút đã mở khối mời: đóng khối (Esc/Huỷ/gửi xong) thì tiêu điểm về đó, không rơi về `body` (A-02).
  const inviteOpenerRef = useRef<HTMLElement | null>(null);
  const isInviteOpen = model.invite.isOpen;
  useEffect(() => {
    if (isInviteOpen) return;
    const opener = inviteOpenerRef.current;
    inviteOpenerRef.current = null;
    if (opener?.isConnected === true) opener.focus();
  }, [isInviteOpen]);
  const openInvite = () => {
    if (document.activeElement instanceof HTMLElement && document.activeElement !== document.body) {
      inviteOpenerRef.current = document.activeElement;
    }
    actions.onOpenInvite();
  };
  useEffect(() => {
    if (isDetailOpen) return;
    const opener = openerRef.current;
    openerRef.current = null;
    if (opener?.isConnected === true) opener.focus();
  }, [isDetailOpen]);
  const contentActions: UserManagementActions = {
    ...actions,
    onOpenInvite: openInvite,
    onSelectUser: (userId) => {
      if (userId !== null && document.activeElement instanceof HTMLElement && document.activeElement !== document.body) {
        openerRef.current = document.activeElement;
      }
      actions.onSelectUser(userId);
    },
    onClearSearch: () => {
      actions.onClearSearch();
      searchRef.current?.focus();
    },
  };

  // A12 — Esc đóng lớp trên cùng. Khối mời và tấm chi tiết ở bố cục rộng đều là lớp
  // CẠNH bảng (phạm vi `sidePanel`, như `ModelLibraryDetail.tsx`); hộp thoại xoá hẳn nằm
  // ở phạm vi `dialog` nên vẫn được Esc trước. Một đăng ký cho cả hai lớp: hai đăng ký
  // cùng tổ hợp cùng phạm vi thì sổ phím cảnh báo trùng. Bố cục hẹp không cần — `Drawer`
  // tự đóng bằng Esc.
  const isDetailPanelOpen = model.detail !== null && !model.isCollapsed;
  useShortcut(
    {
      combo: 'Escape',
      description: 'Đóng khối mời hoặc tấm chi tiết người dùng',
      id: 'sidePanel.userManagement.close',
      onTrigger: () => {
        if (model.invite.isOpen) actions.onCloseInvite();
        else actions.onSelectUser(null);
      },
      scope: 'sidePanel',
    },
    { enabled: model.state !== 'forbidden' && (model.invite.isOpen || isDetailPanelOpen) },
  );

  if (model.state === 'forbidden') {
    return (
      <div className={SCREEN_CONTAINER_CLASS}>
        <UserManagementBreadcrumb items={model.breadcrumbItems} />
        <PageHead className="mb-2" eyebrow={PAGE_EYEBROW} title={PAGE_TITLE} />
        <InlineAlert level="attention" message={model.forbiddenLabel} />
        <Section>
          <UserManagementPermissionMatrix captionLabel={PERMISSION_MATRIX_CAPTION} matrix={model.permissionMatrix} />
        </Section>
        <BreadcrumbLink item={model.backLink} />
      </div>
    );
  }

  const { toolbar, invite } = model;
  // MỘT nút chính: khi khối mời đang mở, "Gửi lời mời" trong khối là nút chính, nút đầu trang lùi về phụ.
  const inviteControl = toolbar.canInvite ? (
    <Button
      iconBefore={<UserPlus aria-hidden="true" size={16} />}
      onClick={openInvite}
      variant={invite.isOpen ? 'secondary' : 'primary'}
    >
      {INVITE_BUTTON_LABEL}
    </Button>
  ) : (
    <p className="max-w-[280px] text-right text-[13px] text-text-secondary">{toolbar.inviteBlockedReason}</p>
  );

  return (
    <div className={SCREEN_CONTAINER_CLASS}>
      <UserManagementBreadcrumb items={model.breadcrumbItems} />
      <PageHead
        className="mb-2"
        eyebrow={PAGE_EYEBROW}
        title={PAGE_TITLE}
        status={<UsersStatus model={model} />}
        next={
          <>
            <Button
              iconBefore={<ShieldCheck aria-hidden="true" size={16} />}
              onClick={actions.onOpenPermissionReference}
              variant="ghost"
            >
              {PERMISSION_REFERENCE_BUTTON_LABEL}
            </Button>
            {inviteControl}
          </>
        }
      />

      <div className="flex items-start gap-4">
        <Section className="min-w-0 flex-1" flush>
          <UserManagementToolbar actions={actions} invite={invite} searchRef={searchRef} toolbar={toolbar} />
          {renderContent(model, contentActions)}
        </Section>
        {model.detail !== null && (
          <UserManagementDetail
            actions={actions}
            detail={model.detail}
            isCollapsed={model.isCollapsed}
            permissionMatrix={model.permissionMatrix}
            roleOptions={toolbar.roleOptions}
          />
        )}
      </div>

      {/* Ngoài nhánh `detail !== null`: nút "xoá" trên hàng mở hộp này khi chưa ai được chọn. */}
      <RemoveConfirmDialog actions={actions} removeConfirm={model.removeConfirm} />

      <Modal
        isOpen={model.isPermissionReferenceOpen}
        onClose={actions.onClosePermissionReference}
        title={PERMISSION_REFERENCE_MODAL_TITLE}
        width={MODAL_WIDTH}
      >
        {/* Tiêu đề hộp đã nói đúng câu này — không lặp làm chú thích (BUG-080). */}
        {/* Hộp không có chân nên thân hộp không có đệm dưới: khung `pb-8` khớp lề `px-8` (BUG-431). */}
        <div className="pb-8">
          <UserManagementPermissionMatrix matrix={model.permissionMatrix} />
        </div>
      </Modal>
    </div>
  );
}
