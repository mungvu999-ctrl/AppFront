/**
 * Hộp thoại chia sẻ, đã nối vào cổng thật và bộ nhớ đệm.
 *
 * Lớp mỏng nhất có thể trên `ShareDialog`, cùng khuôn
 * `CreateProjectModal.container.tsx`: dựng cổng mà hook được tiêm vào, bọc hộp
 * thoại trong một {@link ScreenErrorBoundary} để một lần sập không kéo cả trang
 * theo (A11), rồi truyền `model`/`actions` xuống view.
 *
 * ## R-73: mở được bằng đúng một thẻ
 *
 * `<ShareDialogContainer isOpen onDismiss projectId />` là đủ. Mọi thứ còn lại
 * — cổng HTTP, danh sách thành viên, quyền, bộ nhớ đệm — file này tự lo, nên nơi
 * gọi không phải viết một dòng logic chia sẻ nào. Ba prop còn lại (`roles`,
 * `gateway`, `onToast`) là đường tiêm cho test, story và cho một vỏ
 * ứng dụng muốn nói ra vai thật hay góc nhìn thật.
 *
 * ## Vì sao `onToast` là prop, không phải `useToast()`
 *
 * Cùng lý do `CreateProjectModal.container.tsx` ghi lại: `Toast.Provider` được
 * gắn ở màn chứa, không ở đây. Gọi `useToast()` từ file này sẽ ném ngay khi hộp
 * thoại được gắn ở một chỗ không có provider nào bên trên.
 *
 * ## Vì sao danh sách thành viên đọc ở đây, không đọc trong hook
 *
 * `UseShareDialogOptions.gateway` là `ShareLinkGateway` — ba lời gọi về liên
 * kết, không có đường nào tới hồ sơ dự án. Nên lượt đọc thành viên là một
 * `useQuery` riêng ở container, và hook nhận `members` đã thành `MemberRowModel[]`.
 * Nhờ vậy hook vẫn test được chỉ với một cổng giả, không cần `ApiClient` giả.
 */

import { useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';

import { EmptyState } from '@/components/feedback/EmptyState';
import {
  ScreenErrorBoundary,
  type ScreenErrorFallback,
} from '@/components/feedback/ScreenErrorBoundary';
import { useStore } from '@/store';
import type { ProjectRole } from '@/types/project';

import { ShareDialog } from './ShareDialog';
import {
  createShareDialogApiClient,
  createShareDialogGateway,
  hasUnconfirmedScale,
  readProjectMembers,
  SHARE_SCALE_NOTICE,
  shareMembersQueryKey,
} from './shareDialogGateway';
import type { MemberRowModel, ShareDialogContainerProps } from './types';
import { useShareDialog } from './useShareDialog';

/** Đặt tên màn cho ranh giới lỗi, và cho bất cứ ai đọc báo cáo của nó. */
const SCREEN_ID = 'share-dialog';

/** Không có vai nào được nói ra thì không có quyền nào được suy ra. */
const NO_ROLES: readonly ProjectRole[] = Object.freeze([]);

const NO_MEMBERS: readonly MemberRowModel[] = Object.freeze([]);

/**
 * Thứ người dùng thấy thay cho hộp thoại đã sập.
 *
 * Chữ lấy thẳng từ `report.description`, nút "thử lại" chỉ hiện khi lỗi thuộc
 * loại đáng thử lại — cùng khuôn `CreateProjectCrashFallback`. Lớp phủ vẽ bằng
 * token `bg-bg-overlay`, không phải một mã màu viết tay (A1).
 */
function ShareDialogCrashFallback({ report, retry }: ScreenErrorFallback) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-bg-overlay">
      <div className="w-[480px] max-w-full rounded-2xl bg-bg-surface p-6 shadow-modal">
        <EmptyState
          icon={<div className="h-8 w-8 rounded-full bg-state-violation-tint" aria-hidden="true" />}
          title={report.description.title}
          description={report.description.description}
          {...(report.retryable
            ? { action: { label: report.description.primaryButtonLabel, onClick: retry } }
            : {})}
        />
      </div>
    </div>
  );
}

/** Hộp thoại thật, bên trong ranh giới lỗi. */
function WiredShareDialog(props: ShareDialogContainerProps) {
  const injectedGateway = props.gateway;
  const gateway = useMemo(() => injectedGateway ?? createShareDialogGateway(), [injectedGateway]);
  const client = useMemo(() => createShareDialogApiClient(), []);

  // Chỉ đọc khi hộp thoại đang mở: một hộp thoại đóng không có lý do gì gọi mạng.
  const membersQuery = useQuery({
    queryKey: shareMembersQueryKey(props.projectId),
    queryFn: async ({ signal }): Promise<readonly MemberRowModel[]> =>
      await readProjectMembers(client, props.projectId, signal),
    enabled: props.isOpen,
  });

  const [model, actions] = useShareDialog({
    gateway,
    projectId: props.projectId,
    roles: props.roles ?? NO_ROLES,
    members: membersQuery.data ?? NO_MEMBERS,
    onDismiss: props.onDismiss,
    isOpen: props.isOpen,
    ...(props.onToast !== undefined ? { onToast: props.onToast } : {}),
  });

  // U03: chỉ biết tỷ lệ khi dự án này đang nạp trong store (mở từ màn Xuất/màn duyệt).
  const scaleUnconfirmed = useStore(
    (state) =>
      state.project?.id === props.projectId && hasUnconfirmedScale(state.floors, state.floorMeta, state.spatial),
  );

  return (
    <ShareDialog
      isOpen={props.isOpen}
      model={model}
      actions={actions}
      scaleNotice={scaleUnconfirmed ? SHARE_SCALE_NOTICE : null}
    />
  );
}

/** `<ShareDialogContainer>` — hộp thoại chia sẻ thật, đã nối. */
export function ShareDialogContainer(props: ShareDialogContainerProps) {
  return (
    <ScreenErrorBoundary
      screenId={SCREEN_ID}
      renderFallback={({ report, retry }) => (
        <ShareDialogCrashFallback report={report} retry={retry} />
      )}
    >
      <WiredShareDialog {...props} />
    </ScreenErrorBoundary>
  );
}
