/**
 * Màn S-11 "Một bước AI hỏng" đã NỐI DÂY — hook cộng view, bọc trong ranh giới lỗi.
 *
 * Đây là thứ một màn khác gắn vào khung của nó bằng ĐÚNG MỘT THẺ (R-73):
 *
 * ```tsx
 * <PipelineFailureContainer
 *   floorId={floorId}
 *   onNavigate={(path) => navigate(path)}
 *   onResolved={() => goToNextStep()}
 *   projectId={projectId}
 *   stepId={stepId}
 * />
 * ```
 *
 * ## Không route, và đó là một quyết định đã chốt
 *
 * Khác `ProcessingScreen.container.tsx` và `CadBranchConfirm.container.tsx` —
 * hai màn có route thật — file này KHÔNG có `PipelineFailureRoute` và không nhập
 * `react-router-dom`. Màn S-11 không phải một trang: nó là một dải dựng NGAY
 * TRONG khung của màn S-10, thay chỗ dải cảnh báo. Vì thế nó không đọc
 * `useParams`, không gọi `useNavigate`, và nhận cả ba mã định vị qua props. Điều
 * hướng đi ra ngoài qua `onNavigate`, đúng khuôn
 * `CadBranchConfirmContainerProps.onNavigate`: hook dựng đường dẫn từ
 * `ROUTES`, container không viết một đường dẫn nào (R-65).
 *
 * ## Ranh giới lỗi: bản ở `@/components/feedback`
 *
 * Đúng bản mà `src/App.tsx:95-105` đang gắn (R-62), **không** phải bản chưa nối
 * ở `src/lib/screen-state`. Phần dự phòng dựng bằng `EmptyState` từ
 * `report.description`, y hệt `ScreenCrashFallback` của `App.tsx:29-42`, nên màn
 * không bao giờ trắng (A11) và ranh giới này không giữ một chữ nào của riêng nó.
 *
 * `key` trên ranh giới lặp lại đúng ý `key={activeScreen}` của `App.tsx:96`:
 * đổi sang một bước hỏng khác thì ranh giới gắn LẠI, nên một lần sập ở Tầng 03
 * không để phần dự phòng nằm lại trên màn khi màn cha chuyển sang Tầng 04.
 *
 * ## Cổng dữ liệu: container KHÔNG tự dựng bản thật
 *
 * `usePipelineFailure` đã có `useResolvedGateway` — nó dựng bản thật một cách
 * LƯỜI, đúng một lần, và chỉ khi không ai tiêm gì vào
 * (`usePipelineFailure.ts:306-320`). Nên ở đây `gateway` chỉ được chuyển tiếp
 * khi nó có mặt. Dựng thêm một `createAppPipelineFailureGateway()` trong
 * `useMemo` ở container — như `ProcessingScreen.container.tsx` làm — sẽ mở một
 * bộ gửi đo đạc cho MỌI lượt gắn, kể cả lượt đã có cổng giả của test.
 *
 * `types.ts` đã đóng băng và cố ý không khai prop cổng dữ liệu. Cách mở rộng hợp
 * lệ duy nhất là `extends` trong file của chính lớp này — xem
 * {@link PipelineFailureScreenContainerProps}.
 */

import { QueryClientContext } from '@tanstack/react-query';
import { useContext } from 'react';

import { EmptyState } from '@/components/feedback/EmptyState';
import {
  ScreenErrorBoundary,
  type ScreenErrorFallback,
} from '@/components/feedback/ScreenErrorBoundary';
import { cachedProjectName } from '@/lib/query/cachedProjectName';

import { PipelineFailure } from './PipelineFailure';
import {
  PIPELINE_FAILURE_SCREEN_CODE,
  type PipelineFailureGateway,
  type PipelineFailureRawFloor,
} from './pipelineFailureGateway';
import type { PipelineFailureContainerProps } from './types';
import { usePipelineFailure } from './usePipelineFailure';

/**
 * Props màn cha truyền vào, cộng hai chỗ tiêm của lớp này.
 *
 * Ba lối ra (`onResolved`, `onDismiss`, `onNavigate`) và ba mã định vị đến
 * nguyên vẹn từ {@link PipelineFailureContainerProps}; file này không thêm, không
 * bớt, không đổi hình dạng trường nào của hợp đồng đã đóng băng.
 */
export interface PipelineFailureScreenContainerProps extends PipelineFailureContainerProps {
  /**
   * Cổng dữ liệu tiêm được. Vắng mặt thì hook dựng bản thật — xem ghi chú "Cổng
   * dữ liệu" ở đầu file. Test và story cắm `createMockPipelineFailureGateway()`
   * vào đây, đúng bộ mẫu mà hook test dùng (R-70).
   */
  readonly gateway?: PipelineFailureGateway;
  /** Ép dải thu gọn — cho story hoặc test muốn một câu trả lời cố định. */
  readonly forceCollapsed?: boolean;
  /** Lượt tải của lượt hỏng — có thì S-11 đưa ra "Chạy lại từ bản gốc" (K-06). */
  readonly uploadId?: string;
  /** `Progress.error` của lượt hỏng — S-11 tra câu theo bảng mã pipeline. */
  readonly failureCode?: string;
  /** Tên tầng theo N7. */
  readonly failureFloorName?: string;
  /** Các tầng màn Xử lý đã đọc — dải "Tiến độ theo tầng" khi chưa đọc được chi tiết (BUG-545). */
  readonly failureFloors?: readonly PipelineFailureRawFloor[];
}

/** Cùng khuôn `ScreenCrashFallback` của `App.tsx:29-42` — R-62. */
function PipelineFailureCrashFallback({ report, retry }: ScreenErrorFallback) {
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

/**
 * Hook cộng view, không có provider nào ở giữa.
 *
 * `exactOptionalPropertyTypes` bật, nên một prop tuỳ chọn vắng mặt phải VẮNG
 * MẶT chứ không mang giá trị `undefined` — cùng khuôn trải có điều kiện của
 * `ProcessingScreen.container.tsx:99-106`.
 */
function WiredPipelineFailure(props: PipelineFailureScreenContainerProps) {
  const screenProps = usePipelineFailure({
    floorId: props.floorId,
    projectId: props.projectId,
    stepId: props.stepId,
    ...(props.gateway !== undefined ? { gateway: props.gateway } : {}),
    ...(props.roles !== undefined ? { roles: props.roles } : {}),
    ...(props.onResolved !== undefined ? { onResolved: props.onResolved } : {}),
    ...(props.onDismiss !== undefined ? { onDismiss: props.onDismiss } : {}),
    ...(props.onNavigate !== undefined ? { onNavigate: props.onNavigate } : {}),
    ...(props.forceCollapsed !== undefined ? { forceCollapsed: props.forceCollapsed } : {}),
    ...(props.uploadId !== undefined ? { uploadId: props.uploadId } : {}),
    ...(props.failureCode !== undefined ? { failureCode: props.failureCode } : {}),
    ...(props.failureFloorName !== undefined ? { failureFloorName: props.failureFloorName } : {}),
    ...(props.failureFloors !== undefined ? { failureFloors: props.failureFloors } : {}),
  });

  // Tên dự án lấy từ bộ đệm (khung app đã đọc #24); không có bộ đệm thì đường dẫn bỏ cấp này.
  const queryClient = useContext(QueryClientContext);
  const projectName = queryClient === undefined ? null : cachedProjectName(queryClient, props.projectId);

  return <PipelineFailure {...screenProps} projectName={projectName} />;
}

/** `<PipelineFailureContainer … />` — màn S-11 thật, đã nối, gắn được bằng một thẻ. */
export function PipelineFailureContainer(props: PipelineFailureScreenContainerProps) {
  return (
    <ScreenErrorBoundary
      key={`${props.projectId}:${props.floorId}:${props.stepId}`}
      renderFallback={({ report, retry }) => (
        <PipelineFailureCrashFallback report={report} retry={retry} />
      )}
      screenId={PIPELINE_FAILURE_SCREEN_CODE}
    >
      <WiredPipelineFailure {...props} />
    </ScreenErrorBoundary>
  );
}
