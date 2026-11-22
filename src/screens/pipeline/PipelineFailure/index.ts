/**
 * Đường nhập ổn định của màn S-11 "Một bước AI hỏng" (`PipelineFailure`).
 *
 * Màn cha viết `@/screens/pipeline/PipelineFailure` và không phải biết màn này gồm
 * mấy file.
 *
 * Bốn thứ đi ra khỏi đây, và không có thứ năm:
 *
 * - `PipelineFailureContainer` — màn đã nối dây, gắn được bằng một thẻ (R-73).
 * - `PipelineFailure` — view thuần, thứ story và test bảy trạng thái dựng thẳng.
 * - `usePipelineFailure` — nửa "suy nghĩ", cho màn cha muốn tự dựng view.
 * - Cổng dữ liệu: kiểu `PipelineFailureGateway`, ba hàm dựng, và bộ mẫu. Test và
 *   story phải cắm được bản giả vào (R-73), và cắm CÙNG một bộ mẫu thay vì bịa
 *   bảng dữ liệu thứ hai (R-70).
 *
 * Không tái xuất phần con nào của view (`PipelineFailureAlert`,
 * `PipelineFailureBand`, `PipelineFailureDetails`, `PipelineFailureProgress`,
 * `PipelineFailureReveal`, `PipelineFailureCopyButton`): chúng là mảnh của một
 * view, không phải API của màn — cùng lý lẽ `ProcessingScreen/index.ts`.
 *
 * KHÔNG có `PipelineFailureRoute`: màn này không có route riêng, nó dựng trong
 * khung của màn S-10. Xem đầu `PipelineFailure.container.tsx`.
 */

export { PipelineFailure } from './PipelineFailure';
export {
  PipelineFailureContainer,
  type PipelineFailureScreenContainerProps,
} from './PipelineFailure.container';
export {
  createAppPipelineFailureGateway,
  createMockPipelineFailureGateway,
  createPipelineFailureGateway,
  PIPELINE_FAILURE_CAPABILITIES,
  PIPELINE_FAILURE_MISSING_CAPABILITIES,
  PIPELINE_FAILURE_MISSING_ENDPOINTS,
  PIPELINE_FAILURE_SAMPLE_DETAIL,
  PIPELINE_FAILURE_SAMPLE_FLOOR_ID,
  PIPELINE_FAILURE_SAMPLE_LOG,
  PIPELINE_FAILURE_SAMPLE_STEP_ID,
  PIPELINE_FAILURE_SCREEN_CODE,
  type CreateMockPipelineFailureGatewayOptions,
  type CreatePipelineFailureGatewayOptions,
  type MockPipelineFailureGateway,
  type PipelineFailureApiFailure,
  type PipelineFailureCapability,
  type PipelineFailureDetail,
  type PipelineFailureGateway,
  type PipelineFailureRawStep,
  type PipelineFailureRetryOutcome,
} from './pipelineFailureGateway';
export { usePipelineFailure, type UsePipelineFailureOptions } from './usePipelineFailure';

export type {
  PipelineFailureAlertBand,
  PipelineFailureBand,
  PipelineFailureContainerProps,
  PipelineFailureCopyAction,
  PipelineFailureFloorStatus,
  PipelineFailureFloorViewModel,
  PipelineFailureIdentity,
  PipelineFailureIdleBand,
  PipelineFailureKeptItem,
  PipelineFailureKeptWork,
  PipelineFailureKeptWorkLine,
  PipelineFailureKeptWorkList,
  PipelineFailureLogLine,
  PipelineFailureNextStep,
  PipelineFailureNextStepId,
  PipelineFailureNextSteps,
  PipelineFailureProps,
  PipelineFailureReasonViewModel,
  PipelineFailureResolvedBand,
  PipelineFailureRetryAction,
  PipelineFailureRetryAttemptNotice,
  PipelineFailureRetryingBand,
  PipelineFailureRetryNotice,
  PipelineFailureRetrySupportNotice,
  PipelineFailureState,
  PipelineFailureUploadLink,
  PipelineFailureTechnicalDetails,
} from './types';
