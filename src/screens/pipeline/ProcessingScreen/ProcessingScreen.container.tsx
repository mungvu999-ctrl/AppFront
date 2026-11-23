/**
 * Route `ROUTE_PATTERNS.projectPipeline`, nối hook với router.
 *
 * Cùng khuôn `InputQualityGate.container.tsx` — hai lớp, cố ý tách:
 *
 * - {@link ProcessingScreenContainer} nhận đủ mọi thứ qua props và **không** gọi
 *   `useNavigate` hay `useParams`, nên bất kỳ màn nào cũng mở được nó bằng một
 *   dòng, kể cả trong test hay story (R-73). Nó cũng là nơi tiêm cổng dữ liệu
 *   thật vào hook.
 * - {@link ProcessingScreenRoute} là nơi duy nhất biết tới router; nó được đăng ký
 *   ở `src/routes/router.tsx` cho `ROUTE_PATTERNS.projectPipeline`.
 *
 * Ranh giới lỗi là bản ở `@/components/feedback` — bản đang được `src/App.tsx`
 * gắn (R-62), **không** phải bản chưa nối ở `src/lib/screen-state`. Phần dự
 * phòng dựng bằng `EmptyState` từ `report.description`, nên màn không bao giờ
 * trắng (A11).
 *
 * ## `floorUploads` đến từ N7, không từ màn trước
 *
 * `ENDPOINTS.drawings.progress` cần `(projectId, uploadId)`, còn route chỉ mang
 * `:id`. Danh sách `uploadId` đọc từ N7 (`ENDPOINTS.drawings.latestUploads`, lượt
 * tải mới nhất của từng tầng), nên mọi lối vào `/pipeline` — tải lên, kiểm tra
 * chất lượng, CAD, bảng điều khiển — thấy cùng một danh sách, kể cả tầng có bản
 * vẽ từ trước. Trước đây route không truyền gì và màn luôn `empty` (B-V4-01).
 * Prop `floorUploads` còn lại cho test và story muốn một danh sách cố định.
 *
 * ## Gắn S-11 `PipelineFailure` khi một bước AI hỏng
 *
 * `useProcessingScreen` trả thêm `failedPipelineStep` ngoài
 * {@link ProcessingScreenProps}, và chỉ khi MỌI tầng đã ở trạng thái cuối — còn
 * tầng chạy thì màn giữ `partial`, bước hỏng hiện câu và mã ở `steps[]`. Có mặt
 * trường đó thì `WiredProcessingScreen` GẮN THAY `<PipelineFailureContainer>` cho
 * `<ProcessingScreen>`: ba mã định vị (`projectId`, `floorId`, `stepId`), mã máy
 * chủ (`failureCode`) và tên tầng N7 (`failureFloorName`), `onNavigate` chuyển
 * tiếp nguyên vẹn, và `onResolved` tái dùng `onRetry` của màn này. S-11 tự vẽ lại
 * đủ đường dẫn, dải tầng và cột trái của khung S-10 (xem đầu `PipelineFailure.tsx`)
 * nên đây là một phép THAY, không phải một mảnh ghép lồng vào cây của
 * `ProcessingScreen.tsx` — `<ProcessingScreen>` không được gắn tiếp bên trong.
 */

import { useMemo } from 'react';
import { useNavigate, useParams } from 'react-router-dom';

import { EmptyState } from '@/components/feedback/EmptyState';
import { InlineAlert } from '@/components/feedback/InlineAlert';
import {
  ScreenErrorBoundary,
  type ScreenErrorFallback,
} from '@/components/feedback/ScreenErrorBoundary';
import { useSession } from '@/hooks/useSession';
import { PipelineFailureContainer, type PipelineFailureGateway } from '@/screens/pipeline/PipelineFailure';
import type { ProjectRole } from '@/types/project';

import { ProcessingScreen } from './ProcessingScreen';
import { createAppProcessingGateway } from './processingGateway';
import type { ProcessingGateway } from './processingGateway';
import { useProcessingScreen } from './useProcessingScreen';
import type { ProcessingFloorUpload } from './useProcessingScreen';

/** Tên màn này với ranh giới lỗi, và với bất cứ ai đọc báo cáo của nó. */
const SCREEN_ID = 'processing-screen';

const MISSING_PROJECT_TITLE = 'Không xác định được dự án';
const MISSING_PROJECT_MESSAGE =
  'Đường dẫn thiếu mã dự án, nên không biết phải mở màn xử lý của dự án nào.';

export interface ProcessingScreenContainerProps {
  readonly projectId: string;
  /** Các lượt xử lý cố định. Bỏ trống thì màn tự đọc N7 — xem ghi chú đầu file. */
  readonly floorUploads?: readonly ProcessingFloorUpload[];
  readonly roles?: readonly ProjectRole[];
  /** Điều hướng sau khi bấm các hành động của màn (ví dụ xem lại tường). */
  readonly onNavigate?: (path: string) => void;
  /** Nơi nút "liên hệ hỗ trợ" dẫn tới — repo chưa có route hỗ trợ nào. */
  readonly onGoToSupport?: () => void;
  /**
   * Cổng dữ liệu. Có mặc định thật, dựng ngay tại container; test và story cắm
   * `createProcessingGateway(createMockApiClient())` vào đúng phép ánh xạ mà bản
   * sản phẩm dùng (R-70).
   */
  readonly gateway?: ProcessingGateway;
  /**
   * Cổng dữ liệu của `PipelineFailureContainer`, cho lượt gắn thay khi một bước
   * hỏng — xem ghi chú "Gắn S-11" ở đầu file. Vắng mặt thì `PipelineFailureContainer`
   * tự dựng cổng thật của chính nó (R-73); test và story cắm
   * `createMockPipelineFailureGateway()` vào đây.
   */
  readonly pipelineFailureGateway?: PipelineFailureGateway;
  /** Ép cách xếp thu gọn — cho story hoặc test muốn một câu trả lời cố định. */
  readonly forceCollapsed?: boolean;
}

/** Cùng khuôn với `InputQualityGateCrashFallback` — R-62. */
function ProcessingScreenCrashFallback({ report, retry }: ScreenErrorFallback) {
  return (
    <div className="absolute inset-0 flex items-center justify-center bg-bg-app">
      <EmptyState
        description={report.description.description}
        icon={<div aria-hidden="true" className="h-8 w-8 rounded-full bg-state-violation-tint" />}
        title={report.description.title}
        {...(report.retryable
          ? { action: { label: report.description.primaryButtonLabel, onClick: retry } }
          : {})}
      />
    </div>
  );
}

/** Hook cộng view, không có provider nào ở giữa. */
function WiredProcessingScreen(props: ProcessingScreenContainerProps) {
  const appGateway = useMemo(() => createAppProcessingGateway(), []);

  const { failedPipelineStep, ...screenProps } = useProcessingScreen({
    projectId: props.projectId,
    ...(props.floorUploads !== undefined ? { floorUploads: props.floorUploads } : {}),
    gateway: props.gateway ?? appGateway,
    ...(props.roles !== undefined ? { roles: props.roles } : {}),
    ...(props.onNavigate !== undefined ? { onNavigate: props.onNavigate } : {}),
    ...(props.onGoToSupport !== undefined ? { onGoToSupport: props.onGoToSupport } : {}),
    ...(props.forceCollapsed !== undefined ? { forceCollapsed: props.forceCollapsed } : {}),
  });

  if (failedPipelineStep !== undefined) {
    return (
      <PipelineFailureContainer
        floorId={failedPipelineStep.floorId}
        failureFloorName={failedPipelineStep.failureFloorName}
        failureFloors={failedPipelineStep.failureFloors}
        {...(failedPipelineStep.failureCode !== undefined
          ? { failureCode: failedPipelineStep.failureCode }
          : {})}
        onResolved={failedPipelineStep.onResolved}
        projectId={props.projectId}
        stepId={failedPipelineStep.stepId}
        uploadId={failedPipelineStep.uploadId}
        {...(props.roles !== undefined ? { roles: props.roles } : {})}
        {...(props.onNavigate !== undefined ? { onNavigate: props.onNavigate } : {})}
        {...(props.pipelineFailureGateway !== undefined
          ? { gateway: props.pipelineFailureGateway }
          : {})}
      />
    );
  }

  return <ProcessingScreen {...screenProps} />;
}

/** `<ProcessingScreenContainer projectId={...} />` — màn Xử lý thật, đã nối. */
export function ProcessingScreenContainer(props: ProcessingScreenContainerProps) {
  return (
    <ScreenErrorBoundary
      renderFallback={({ report, retry }) => (
        <ProcessingScreenCrashFallback report={report} retry={retry} />
      )}
      screenId={SCREEN_ID}
    >
      <WiredProcessingScreen {...props} />
    </ScreenErrorBoundary>
  );
}

/** Bên trong router thật, nên `useNavigate` chắc chắn tìm được provider. */
function ProcessingScreenRouteBody({
  projectId,
  roles,
}: {
  projectId: string;
  roles: readonly ProjectRole[];
}) {
  const navigate = useNavigate();

  return (
    <ProcessingScreenContainer
      onNavigate={(path) => navigate(path)}
      projectId={projectId}
      roles={roles}
    />
  );
}

/** Route thật của màn Xử lý — đăng ký tại `src/routes/router.tsx`. */
export function ProcessingScreenRoute() {
  const { projectId: id } = useParams<{ projectId: string }>();
  const session = useSession();

  if (id === undefined || id.length === 0) {
    return (
      <div className="p-6">
        <InlineAlert
          level="violation"
          message={MISSING_PROJECT_MESSAGE}
          title={MISSING_PROJECT_TITLE}
        />
      </div>
    );
  }

  return <ProcessingScreenRouteBody projectId={id} roles={session.roles} />;
}
