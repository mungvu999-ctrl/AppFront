/**
 * Cổng dữ liệu của màn S-11 "Một bước AI hỏng" — mọi lời gọi ra khỏi màn đi qua
 * đây.
 *
 * Cùng khuôn bốn cổng anh em trong `src/screens/pipeline/**`
 * (`processingGateway.ts` là bản canh bản, rồi `scaleCalibrationGateway.ts`,
 * `pipelineGraphGateway.ts`, `cadBranchConfirmGateway.ts`): một danh sách khả
 * năng, một bản kê nợ endpoint, một `interface` cho hình dạng, một factory dựng
 * cổng thật và một factory dựng cổng có dữ liệu cho test và story (R-73).
 *
 * ## Vì sao file này tồn tại, và vì sao nó KHÔNG phải mã giả
 *
 * Khảo sát lớp L1 (`.orca/notes/pf/logic-contract.md`, mục A và mục C) đã xác
 * nhận hai chuyện bằng `rg` chứ không bằng phỏng đoán:
 *
 * - **T-08 — chạy lại đúng MỘT bước: NOT FOUND.** Không hàm nào trong repo gửi
 *   yêu cầu "chạy lại bước này, giữ nguyên các bước đã xong". Ba ứng viên gần
 *   nhất đều làm việc khác: `ProcessingScreen.onRetry` đọc LẠI tiến độ mọi tầng,
 *   `PipelineStepData.onRetry` là một prop callback không có logic đứng sau, và
 *   `retry` của react-query là cơ chế tự động cấp HTTP.
 * - **T-10 — nhật ký kỹ thuật: NOT FOUND.** Nhật ký hiện có là bản dịch tiến độ
 *   ("tách lớp tường — 45%") tích luỹ trong bộ nhớ đệm của PHIÊN, không có mã
 *   lỗi, không có vết lỗi, không có endpoint đọc lại.
 *
 * Điều phối viên đã phê duyệt trước đường đi: khai đúng những khả năng ấy, trả
 * nhánh `supported: false` CÓ KIỂU kèm tên endpoint còn thiếu, và để hook có một
 * nhánh giao diện THẬT cho trường hợp đó (xem `PIPELINE_FAILURE_TEXT.
 * supportRetryUnsupported` và `detailUnsupportedCause`). R-69 cấm bịa dữ liệu và
 * cấm ghi chú hoãn-lại im lặng; ở đây không có giá trị bịa, không có `0` giả vờ là số đo,
 * không có mảng rỗng giả vờ là dữ liệu, và sự thật "chưa có" được truyền lên tận
 * câu tiếng Việt người dùng đọc.
 *
 * ## Vì sao cổng này KHÔNG nhận `ApiClient`
 *
 * Bốn cổng anh em nhận một `ApiClient` vì mỗi cổng có ít nhất một lượt đọc thật
 * để ánh xạ, và test cắm `createMockApiClient()` vào đúng phép ánh xạ đó (R-70).
 * Màn này chưa có lượt đọc nào như vậy: cả bốn khả năng cần mạng đều nằm trong
 * {@link PIPELINE_FAILURE_MISSING_CAPABILITIES}. Nhận một client rồi không gọi nó
 * là dựng sẵn một cái ghế trống và bắt mọi nơi gọi phải mang ghế theo. Ngày
 * `stepFailureDetail` có endpoint, factory này nhận client như bốn cổng kia — đó
 * là một tham số thêm vào, không phải một cuộc viết lại.
 *
 * ## Hai việc cổng này LÀM ĐƯỢC hôm nay
 *
 * - `copyLog` — ghi khay nhớ tạm, đúng bản `processingGateway.copyText` (một
 *   khay nhớ tạm bị trình duyệt từ chối trả `false`, không phải một màn lỗi).
 * - `reportFailure` — O-01: đẩy lỗi qua `reportError` của `src/lib/errors` và
 *   bắn `screen.error` qua `toScreenErrorEvent`, đúng schema zod của
 *   `src/lib/telemetry/events.ts`. Không trường nào tự bịa: bốn trường của
 *   `ScreenErrorEvent` do chính `toScreenErrorEvent` chép ra từ `AppError`.
 */

import { createUuid } from '@/lib/http/ids';
import { createAppApiClient } from '@/api/appClient';
import type { ApiClient } from '@/api/client';
import { ENDPOINTS } from '@/api/endpoints';
import { describeError, reportError, toAppError } from '@/lib/errors';
import type { AppError, ErrorTelemetryDetail } from '@/lib/errors';
import type { PipelineStageId } from '@/lib/realtime/pipeline';
import { toScreenErrorEvent } from '@/lib/telemetry/events';
import { createBeaconTransport, createTelemetrySender } from '@/lib/telemetry/sender';
import type { TelemetrySender } from '@/lib/telemetry/sender';

import {
  PIPELINE_FAILURE_RERUN_ERROR_TEXT,
  type PipelineFailureCauseCode,
  type PipelineFailureCountUnit,
} from './pipelineFailureText';
import type { PipelineFailureFloorStatus } from './types';

/* -------------------------------------------------------------------------- */
/* Khả năng — sáu câu hỏi màn đặt cho cổng.                                    */
/* -------------------------------------------------------------------------- */

/**
 * Tên máy đọc của từng việc màn cần từ thế giới bên ngoài. Mỗi tên chưa làm được
 * có đúng một dòng trong {@link PIPELINE_FAILURE_MISSING_ENDPOINTS}.
 */
export const PIPELINE_FAILURE_CAPABILITIES = [
  'retryStep',
  'rerunUpload',
  'stepFailureDetail',
  'technicalLog',
  'skipFloor',
  'copyLog',
  'reportFailure',
] as const;

export type PipelineFailureCapability = (typeof PIPELINE_FAILURE_CAPABILITIES)[number];

/**
 * Những việc trong danh sách trên mà bản cài đặt THẬT chưa làm được. Đây là bản
 * kê nợ của màn này, và nó chỉ được ngắn đi.
 *
 * Tách khỏi danh sách trên vì hai danh sách trả lời hai câu khác nhau: trên là
 * "màn hỏi cổng những gì", dưới là "câu nào hôm nay chưa trả lời được".
 */
export const PIPELINE_FAILURE_MISSING_CAPABILITIES = [
  'retryStep',
  'stepFailureDetail',
  'technicalLog',
  'skipFloor',
] as const;

export type PipelineFailureMissingCapability =
  (typeof PIPELINE_FAILURE_MISSING_CAPABILITIES)[number];

/**
 * Endpoint / trường dữ liệu còn thiếu của từng khả năng, viết nguyên văn để người
 * nối dây sau biết chính xác phải thêm gì vào `src/api` trước khi bản cài đặt
 * thật đổi được sang nhánh `supported: true`.
 */
export const PIPELINE_FAILURE_MISSING_ENDPOINTS: Readonly<
  Record<PipelineFailureMissingCapability, string>
> = {
  retryStep:
    'ENDPOINTS.drawings.retryStep + DrawingsApi.retryStep — chưa có; rg "retryStep|retryStage|retryFrom|resumeFrom" src rỗng (khảo sát T-08)',
  stepFailureDetail:
    'Endpoint chi tiết MỘT bước đã hỏng (mã lỗi của riêng bước, mã nguyên nhân, số đối tượng đã giữ, uploadId của lượt) — chưa có; ProgressSchema (.strict(), 7 trường) chỉ mang error là chuỗi tự do của CẢ lượt',
  technicalLog:
    'Endpoint đọc nhật ký kỹ thuật của một lượt xử lý — chưa có; nhật ký hiện có chỉ là bản dịch tiến độ tích luỹ trong bộ nhớ đệm của phiên (khảo sát T-10)',
  skipFloor:
    'Lệnh bỏ một tầng khỏi lượt xử lý (ENDPOINTS.drawings.skipFloor) — chưa có endpoint nào; invalidationMap cũng chưa có WriteOperation tương ứng',
};

/** Một khả năng chưa tồn tại. `supported: false` là câu trả lời thật, không phải lỗi. */
export interface PipelineFailureUnsupported {
  readonly supported: false;
  readonly capability: PipelineFailureMissingCapability;
  /** Lấy nguyên từ {@link PIPELINE_FAILURE_MISSING_ENDPOINTS}. */
  readonly missing: string;
}

export interface PipelineFailureSupported<TValue> {
  readonly supported: true;
  readonly value: TValue;
}

export type PipelineFailureCapabilityResult<TValue> =
  | PipelineFailureSupported<TValue>
  | PipelineFailureUnsupported;

/** Dựng nhánh "chưa có đường làm việc này" — một chỗ duy nhất ghép tên với endpoint thiếu. */
export function unsupported(
  capability: PipelineFailureMissingCapability,
): PipelineFailureUnsupported {
  return {
    supported: false,
    capability,
    missing: PIPELINE_FAILURE_MISSING_ENDPOINTS[capability],
  };
}

/* -------------------------------------------------------------------------- */
/* Dữ liệu thô — chưa định dạng, chưa xếp bảy trạng thái.                       */
/* -------------------------------------------------------------------------- */

/** Trạng thái một bước, đúng bốn giá trị của `PipelineStageStatus`. */
export type PipelineFailureRawStepStatus = 'queued' | 'running' | 'done' | 'failed';

/**
 * Trạng thái của một bước trong lượt xử lý.
 *
 * `PipelineStepData` của `PipelineStepper` mang thêm nhãn và phần trăm; hook ghép
 * hai thứ đó từ `getPipelineStages()` chứ không để cổng gửi nhãn tiếng Việt qua
 * dây (R-61 — tên bước có đúng một nguồn).
 */
export interface PipelineFailureRawStep {
  readonly stepId: PipelineStageId;
  readonly status: PipelineFailureRawStepStatus;
}

/** Một kết quả đã có, dạng máy đọc. Câu tiếng Việt ghép ở `pipelineFailureText.ts` (A15). */
export interface PipelineFailureRawKeptResult {
  readonly stepId: PipelineStageId;
  /** Số đối tượng bước đó tìm được. Vắng mặt nghĩa là "xong" mà không có gì để đếm. */
  readonly count?: number;
  readonly unit?: PipelineFailureCountUnit;
}

/** Một tầng của dải tầng. Dải luôn đủ bốn tầng — cổng gửi đủ, hook không lọc. */
export interface PipelineFailureRawFloor {
  readonly floorId: string;
  /** Tên tầng do tầng dữ liệu đặt — ví dụ "Tầng 03". */
  readonly floorName: string;
  readonly status: PipelineFailureFloorStatus;
}

/** Một dòng nhật ký kỹ thuật. Mốc giờ là ISO — hook định dạng bằng `src/lib/format`. */
export interface PipelineFailureRawLogLine {
  readonly id: string;
  readonly atIso: string;
  readonly text: string;
}

/**
 * Chi tiết một bước đã hỏng — thứ `stepFailureDetail` sẽ trả về ngày nó có
 * endpoint.
 *
 * `error` để `unknown` cố ý: mã lỗi và **mã yêu cầu** không được gõ lại ở đây mà
 * đi qua `toAppError` (`AppError.code` + `AppError.requestId`,
 * `toAppError.ts:71-82`), đúng một đường như mọi lỗi khác của ứng dụng (L-03).
 */
export interface PipelineFailureDetail {
  readonly floorId: string;
  readonly floorName: string;
  /** Bước đã hỏng. Cùng tập với `PIPELINE_STAGES`, nên nhãn tra được. */
  readonly stepId: PipelineStageId;
  /** Lỗi thô của máy chủ, chưa phân loại. `toAppError` là nơi phân loại nó. */
  readonly error: unknown;
  readonly cause: PipelineFailureCauseCode;
  /** Lượt xử lý này đã chạy lại bao nhiêu lần TRƯỚC khi màn được mở. */
  readonly attemptCount: number;
  readonly steps: readonly PipelineFailureRawStep[];
  readonly keptResults: readonly PipelineFailureRawKeptResult[];
  readonly floors: readonly PipelineFailureRawFloor[];
}

/**
 * Kết quả một lượt chạy lại đúng một bước.
 *
 * `sequence` là số thứ tự tăng nghiêm ngặt của lượt xử lý, và nó có mặt để
 * `mergeEvents` (`src/lib/realtime/mergeEvents.ts`, T-07 — CÓ THẬT, gọi lại chứ
 * không dựng lại) bỏ được một phản hồi tới hai lần hoặc tới không đúng thứ tự.
 * Không có nó thì một phản hồi cũ về muộn sẽ đè lên trạng thái mới hơn.
 */
export interface PipelineFailureRetryOutcome {
  /** Mã bước vừa chạy lại — chuỗi, đúng như `PipelineFailureIdentity.stepId` gửi vào. */
  readonly stepId: string;
  readonly sequence: number;
  /** `'done'` là lượt chạy lại đã xong; `'failed'` là bước đó lại hỏng. */
  readonly status: 'done' | 'failed';
  /** Trạng thái SAU lượt chạy lại của cả sáu bước — bước đã xong vẫn là đã xong. */
  readonly steps: readonly PipelineFailureRawStep[];
}

/** Một thất bại đã thành câu người đọc được (L-03), lấy nguyên từ `describeError`. */
export interface PipelineFailureApiFailure {
  /** Tiêu đề tiếng Việt, lấy nguyên từ `describeError` — không viết lại. */
  readonly title: string;
  /** Câu tiếng Việt, lấy nguyên từ `describeError`. */
  readonly sentence: string;
  /** Mã máy đọc — `AppError.code`, ví dụ `SEG-2041` hoặc `PROCESSING`. */
  readonly code: string;
  /** Mã yêu cầu — `AppError.requestId`. Chuỗi rỗng khi lỗi không mang mã nào. */
  readonly requestId: string;
  readonly kind: AppError['kind'];
  readonly isRetryable: boolean;
}

/* -------------------------------------------------------------------------- */
/* Tham số vào.                                                                */
/* -------------------------------------------------------------------------- */

/** Ba mã định vị đúng bước đã hỏng, đúng `PipelineFailureIdentity` của hợp đồng. */
export interface ReadStepFailureInput {
  readonly projectId: string;
  readonly floorId: string;
  readonly stepId: string;
}

export interface ReadTechnicalLogInput extends ReadStepFailureInput {
  readonly signal?: AbortSignal;
}

export interface RetryStepInput extends ReadStepFailureInput {
  /** `true` khi người dùng chọn hướng "Thử lại với ngưỡng thấp hơn". */
  readonly lowerThreshold?: boolean;
}

/** K-06 — chạy lại CẢ lượt từ tệp gốc đã lưu; trang và vùng cắt đã nằm ở máy chủ. */
export interface RerunUploadInput {
  readonly projectId: string;
  readonly uploadId: string;
}

/**
 * Kết quả chạy lại cả lượt. Không ném: lỗi nghiệp vụ (409/404/403/429) đi ra thành một câu
 * tiếng Việt cụ thể, để màn hiện đúng câu đó và vẫn giữ nút "Tải lại bản vẽ".
 */
export type PipelineFailureRerunResult =
  | { readonly ok: true }
  | {
      readonly ok: false;
      /** Mã máy đọc: mã 409 của máy chủ, hoặc `AppError.code` của lỗi chung. */
      readonly code: string;
      readonly sentence: string;
      /** `PIPELINE_RUNNING`: lượt mới đã chạy (bấm đôi) — màn cha nên đọc lại tiến độ. */
      readonly isAlreadyRunning: boolean;
    };

/** Một lỗi của N51 → câu tiếng Việt cụ thể. Thuần; `status` 410 (nếu có) đọc như tệp gốc đã mất. */
export function describeRerunFailure(error: unknown): Extract<PipelineFailureRerunResult, { ok: false }> {
  const appError = toAppError(error);
  const table = PIPELINE_FAILURE_RERUN_ERROR_TEXT;
  const status =
    typeof error === 'object' && error !== null && 'status' in error && typeof error.status === 'number'
      ? error.status
      : undefined;
  const code = appError.code;
  const fail = (sentence: string, isAlreadyRunning = false) => ({
    ok: false as const,
    code,
    sentence,
    isAlreadyRunning,
  });

  if (code === 'UPLOAD_NOT_COMPLETE') return fail(table.UPLOAD_NOT_COMPLETE);
  if (code === 'UPLOAD_SOURCE_GONE' || status === 410) return fail(table.UPLOAD_SOURCE_GONE);
  if (code === 'UPLOAD_SUPERSEDED') return fail(table.UPLOAD_SUPERSEDED);
  if (code === 'PIPELINE_RUNNING') return fail(table.PIPELINE_RUNNING, true);
  if (code === 'PIPELINE_NOT_FAILED') return fail(table.PIPELINE_NOT_FAILED);

  switch (appError.kind) {
    case 'notFound':
      return fail(table.notFound);
    case 'forbidden':
      return fail(table.forbidden);
    case 'rateLimited':
      return fail(table.rateLimited);
    case 'network':
    case 'timeout':
      return fail(table.network);
    default:
      return fail(table.fallback);
  }
}

export interface SkipFloorInput {
  readonly projectId: string;
  readonly floorId: string;
}

/** O-01 — một lỗi bước xử lý được ghi lại. Không trường nào ở đây là PII. */
export interface ReportStepFailureInput {
  readonly error: unknown;
  readonly floorId: string;
  readonly stepId: string;
}

/* -------------------------------------------------------------------------- */
/* Cái seam.                                                                   */
/* -------------------------------------------------------------------------- */

/**
 * Mỗi phương thức là một việc màn cần từ thế giới bên ngoài, và không có việc nào
 * khác. Hook không nhập `src/api` trực tiếp.
 */
export interface PipelineFailureGateway {
  /**
   * Khả năng nào cổng này làm được, trả lời ĐỒNG BỘ.
   *
   * Cần đồng bộ vì màn phải trả lời trước khi vẽ: `supports.retryStep` quyết định
   * bộ đếm lần thử hiện chế độ "đếm" hay chế độ "hỗ trợ", và một lời hứa chưa
   * xong thì không trả lời được câu đó trước lượt vẽ đầu tiên.
   */
  readonly supports: Readonly<Record<PipelineFailureCapability, boolean>>;
  /** NOT FOUND — `stepFailureDetail`. */
  readonly readStepFailure: (
    input: ReadStepFailureInput,
  ) => Promise<PipelineFailureCapabilityResult<PipelineFailureDetail>>;
  /** NOT FOUND — `technicalLog`. */
  readonly readTechnicalLog: (
    input: ReadTechnicalLogInput,
  ) => Promise<PipelineFailureCapabilityResult<readonly PipelineFailureRawLogLine[]>>;
  /** NOT FOUND — `retryStep`. Chạy lại ĐÚNG một bước, không phải cả lượt. */
  readonly retryStep: (
    input: RetryStepInput,
  ) => Promise<PipelineFailureCapabilityResult<PipelineFailureRetryOutcome>>;
  /** K-06 — chạy lại cả lượt từ tệp gốc (`POST …/uploads/{id}/rerun`). Chỉ gọi khi `supports.rerunUpload`. */
  readonly rerunUpload: (input: RerunUploadInput) => Promise<PipelineFailureRerunResult>;
  /**
   * NOT FOUND — `skipFloor`. Hành động mất mát. Câu cảnh báo trên màn KHÔNG thoả A9
   * (A9 đòi hộp thoại thật); khi bật thì thoả A8 bằng cách giữ lệnh — xem B-V4-09.
   */
  readonly skipFloor: (
    input: SkipFloorInput,
  ) => Promise<PipelineFailureCapabilityResult<void>>;
  /** Một câu cho lỗi đến từ `src/api` (L-03). */
  readonly describeApiFailure: (error: unknown) => PipelineFailureApiFailure;
  /** O-01 — ghi sự kiện lỗi. Không ném, không chặn đường của thao tác sản phẩm. */
  readonly reportStepFailure: (input: ReportStepFailureInput) => void;
  /** Chép nhật ký. `false` khi trình duyệt từ chối — không phải lỗi màn hình. */
  readonly copyText: (text: string) => Promise<boolean>;
  /** Mốc giờ hiện tại. Tiêm được để test không phụ thuộc đồng hồ thật. */
  readonly now: () => number;
}

/* -------------------------------------------------------------------------- */
/* Cửa vào.                                                                    */
/* -------------------------------------------------------------------------- */

/**
 * Mã màn dùng cho O-01. Phải khớp `TELEMETRY_CODE_PATTERN`
 * (`/^[a-z0-9][a-z0-9._-]*$/`, tối đa 48 ký tự) — `toScreenErrorEvent` trả `null`
 * chứ không ném nếu sai, nên một mã sai làm MẤT phép đo chứ không làm hỏng màn.
 */
export const PIPELINE_FAILURE_SCREEN_CODE = 'pipeline-failure';

export interface CreatePipelineFailureGatewayOptions {
  /** Bộ gửi đo đạc tiêm được — test cắm bản đếm, không đẩy gì lên mạng. */
  readonly telemetry?: TelemetrySender;
  /** Bộ chép tiêm được — jsdom không có `navigator.clipboard`. */
  readonly writeClipboardText?: (text: string) => Promise<void>;
  /** Đồng hồ tiêm được. */
  readonly now?: () => number;
  /**
   * Máy khách API cho việc "chạy lại từ bản gốc". Vắng thì `supports.rerunUpload` là `false`
   * — không giả vờ có đường gọi.
   */
  readonly client?: ApiClient;
}

function toApiFailure(error: unknown): PipelineFailureApiFailure {
  const appError = toAppError(error);
  const described = describeError(appError);

  return {
    title: described.title,
    sentence: described.description,
    code: appError.code,
    requestId: appError.requestId,
    kind: appError.kind,
    isRetryable: appError.retryable,
  };
}

/**
 * Cổng thật.
 *
 * Bốn việc cần mạng trả nhánh `supported: false` có kiểu; hai việc làm được hôm
 * nay (`copyLog`, `reportFailure`) chạy thật.
 */
export function createPipelineFailureGateway(
  options: CreatePipelineFailureGatewayOptions = {},
): PipelineFailureGateway {
  const now = options.now ?? ((): number => Date.now());

  return {
    supports: {
      retryStep: false,
      rerunUpload: options.client !== undefined,
      stepFailureDetail: false,
      technicalLog: false,
      // Bật cờ này thì phải làm hoãn A8 trước: hẹn `UNDO_WINDOW_MS` kèm toast. Thử lại
      // hay đổi ngưỡng trong lúc chờ thì huỷ vé. Rời màn thì không gửi sớm. Xem B-V4-09.
      skipFloor: false,
      copyLog: true,
      reportFailure: true,
    },

    readStepFailure: () => Promise.resolve(unsupported('stepFailureDetail')),
    readTechnicalLog: () => Promise.resolve(unsupported('technicalLog')),
    retryStep: () => Promise.resolve(unsupported('retryStep')),
    rerunUpload: async ({ projectId, uploadId }) => {
      const client = options.client;

      if (client === undefined) {
        return describeRerunFailure(new Error('drawings.rerun: no api client'));
      }

      // Khoá mới mỗi lần bấm: bấm đôi bị nút bận chặn, và máy chủ còn chặn bằng 409 PIPELINE_RUNNING.
      const result = await client.drawings.rerun({ idempotencyKey: createUuid(), projectId, uploadId });

      return result.ok ? { ok: true } : describeRerunFailure(result.error);
    },
    skipFloor: () => Promise.resolve(unsupported('skipFloor')),

    describeApiFailure: (error) => toApiFailure(error),

    reportStepFailure: ({ error, floorId, stepId }) => {
      // `reportError` tự làm sạch ngữ cảnh (`report.ts:45-60`): khoá nào chạm tới
      // danh tính người dùng bị bỏ trước khi đi. Ba khoá dưới đây là mã định vị
      // của một lượt xử lý, không phải của một con người.
      reportError(error, {
        screenCode: PIPELINE_FAILURE_SCREEN_CODE,
        floorId,
        stepId,
      });

      const detail: ErrorTelemetryDetail = {
        appError: toAppError(error),
        context: {},
        timestamp: new Date(now()).toISOString(),
      };
      const event = toScreenErrorEvent(detail, PIPELINE_FAILURE_SCREEN_CODE);

      if (event !== null) {
        options.telemetry?.track(event);
      }
    },

    copyText: async (text) => {
      const clipboard = globalThis.navigator?.clipboard;
      const write = options.writeClipboardText ?? clipboard?.writeText.bind(clipboard);

      if (typeof write !== 'function') {
        return false;
      }

      try {
        await write(text);
        return true;
      } catch {
        // Một khay nhớ tạm bị trình duyệt từ chối không đáng một màn lỗi.
        return false;
      }
    },

    now,
  };
}

/** Cổng dựng cho ứng dụng thật — thứ container lớp 3 gọi. */
export function createAppPipelineFailureGateway(): PipelineFailureGateway {
  return createPipelineFailureGateway({
    client: createAppApiClient(),
    telemetry: createTelemetrySender({
      transport: createBeaconTransport({ url: ENDPOINTS.telemetry }),
      sessionId: createUuid(),
    }),
  });
}

/* -------------------------------------------------------------------------- */
/* Bộ mẫu — chỗ story và test cắm vào để kiểm nhánh "có hỗ trợ" (R-73).        */
/* -------------------------------------------------------------------------- */

/** Bước hỏng của bộ mẫu: tách lớp tường, đúng bước mã SEG-2041 của đặc tả. */
export const PIPELINE_FAILURE_SAMPLE_STEP_ID: PipelineStageId = 'wallSegmentation';

/** Tầng hỏng của bộ mẫu. */
export const PIPELINE_FAILURE_SAMPLE_FLOOR_ID = 'floor-03';

/**
 * Lỗi thô của bộ mẫu, hình dạng của một `HttpError`.
 *
 * Cố ý mang đúng hình dạng ấy: `toAppError` nhận ra nó qua
 * `isHttpError` (`toAppError.ts:120-125`) và giữ nguyên `code` lẫn `requestId`,
 * nên "SEG-2041 · yêu cầu 8f2a-41" của đặc tả được ĐỌC RA từ lỗi chứ không được
 * gõ thành một chuỗi ở đâu đó trong màn.
 */
export const PIPELINE_FAILURE_SAMPLE_ERROR = {
  kind: 'server',
  status: 500,
  code: 'SEG-2041',
  requestId: '8f2a-41',
  retryable: true,
  raw: {
    message: 'pipeline step failed',
    step: 'Tách lớp tường',
  },
} as const;

/** Sáu bước sau khi bước hai hỏng: hai bước đầu xong, bước hai hỏng, phần sau chờ. */
export const PIPELINE_FAILURE_SAMPLE_STEPS: readonly PipelineFailureRawStep[] = [
  { stepId: 'preprocess', status: 'done' },
  { stepId: 'wallSegmentation', status: 'failed' },
  { stepId: 'openingAndFurnitureDetection', status: 'done' },
  { stepId: 'dimensionReading', status: 'done' },
  { stepId: 'spatialDataBuild', status: 'queued' },
  { stepId: 'qualityCheck', status: 'queued' },
];

/** Ba dòng "Kết quả đã có" của đặc tả: xong, 21 đối tượng, 34 chuỗi. */
export const PIPELINE_FAILURE_SAMPLE_KEPT: readonly PipelineFailureRawKeptResult[] = [
  { stepId: 'preprocess' },
  { stepId: 'openingAndFurnitureDetection', count: 21, unit: 'object' },
  { stepId: 'dimensionReading', count: 34, unit: 'dimension' },
];

/** Bốn tầng — dải LUÔN đủ bốn, kể cả khi chỉ một tầng hỏng. */
export const PIPELINE_FAILURE_SAMPLE_FLOORS: readonly PipelineFailureRawFloor[] = [
  { floorId: 'floor-01', floorName: 'Tầng 01', status: 'done' },
  { floorId: 'floor-02', floorName: 'Tầng 02', status: 'done' },
  { floorId: PIPELINE_FAILURE_SAMPLE_FLOOR_ID, floorName: 'Tầng 03', status: 'failed' },
  { floorId: 'floor-04', floorName: 'Tầng 04', status: 'running' },
];

/** Chi tiết bước hỏng của bộ mẫu. */
export const PIPELINE_FAILURE_SAMPLE_DETAIL: PipelineFailureDetail = {
  floorId: PIPELINE_FAILURE_SAMPLE_FLOOR_ID,
  floorName: 'Tầng 03',
  stepId: PIPELINE_FAILURE_SAMPLE_STEP_ID,
  error: PIPELINE_FAILURE_SAMPLE_ERROR,
  cause: 'thinStrokes',
  attemptCount: 1,
  steps: PIPELINE_FAILURE_SAMPLE_STEPS,
  keptResults: PIPELINE_FAILURE_SAMPLE_KEPT,
  floors: PIPELINE_FAILURE_SAMPLE_FLOORS,
};

/** Bốn dòng nhật ký kỹ thuật của bộ mẫu — chữ đều, mốc giờ ISO. */
export const PIPELINE_FAILURE_SAMPLE_LOG: readonly PipelineFailureRawLogLine[] = [
  {
    id: 'log-1',
    atIso: '2026-08-30T14:32:01.000Z',
    text: 'stage=wallSegmentation state=running tiles=48',
  },
  {
    id: 'log-2',
    atIso: '2026-08-30T14:32:04.000Z',
    text: 'stage=wallSegmentation warn=low_stroke_contrast tiles=12',
  },
  {
    id: 'log-3',
    atIso: '2026-08-30T14:32:07.000Z',
    text: 'stage=wallSegmentation error=SEG-2041 request=8f2a-41',
  },
  {
    id: 'log-4',
    atIso: '2026-08-30T14:32:07.000Z',
    text: 'stage=wallSegmentation state=failed retryable=true',
  },
];

/**
 * Cổng giả — thứ story và test cắm vào để nhánh "có dữ liệu" vẫn kiểm được.
 *
 * Nó ĐẾM số lần từng bước được yêu cầu chạy lại ({@link MockPipelineFailureGateway.
 * stepRunCounts}). Đó là bằng chứng máy kiểm được cho lời hứa trung tâm của màn:
 * chạy lại bước hai KHÔNG chạy lại bước một. Một bình luận nói điều đó thì không
 * ai kiểm được; một bộ đếm thì có.
 */
export interface MockPipelineFailureGateway extends PipelineFailureGateway {
  /** Số lần MỖI bước được yêu cầu chạy lại. Bước không xuất hiện = chưa chạy lần nào. */
  readonly stepRunCounts: ReadonlyMap<string, number>;
  /** Văn bản đã chép, theo thứ tự — test đọc để kiểm nút sao chép. */
  readonly copiedTexts: readonly string[];
  /** Số lần `reportStepFailure` được gọi (O-01). */
  readonly reportedFailures: readonly ReportStepFailureInput[];
  /** K-06 — mỗi lần `rerunUpload` được gọi, theo thứ tự. */
  readonly rerunCalls: readonly RerunUploadInput[];
}

export interface CreateMockPipelineFailureGatewayOptions
  extends CreatePipelineFailureGatewayOptions {
  /** Ép chi tiết bước hỏng — story "cả bốn tầng hỏng" đổi trường này. */
  readonly detail?: PipelineFailureDetail;
  /** Ép nhật ký kỹ thuật. */
  readonly log?: readonly PipelineFailureRawLogLine[];
  /** Bật hoặc tắt từng khả năng, để kiểm nhánh "chưa nối được". */
  readonly supports?: Partial<Record<PipelineFailureCapability, boolean>>;
  /** Kết quả của lượt chạy lại. Mặc định là `'done'`. */
  readonly retryStatus?: PipelineFailureRetryOutcome['status'];
  /** K-06 — kết quả của "chạy lại từ bản gốc". Mặc định thành công. */
  readonly rerunResult?: PipelineFailureRerunResult;
}

/**
 * Trạng thái sáu bước SAU khi chạy lại đúng một bước.
 *
 * Bước được chạy lại đổi trạng thái; **mọi bước khác giữ nguyên trạng thái cũ**.
 * Đây là chỗ lời hứa "không xoá tiến độ đã có" được cài đặt, chứ không phải chỗ
 * nó được hứa.
 */
function stepsAfterRetry(
  steps: readonly PipelineFailureRawStep[],
  stepId: string,
  status: PipelineFailureRetryOutcome['status'],
): readonly PipelineFailureRawStep[] {
  return steps.map((step) => (step.stepId === stepId ? { stepId: step.stepId, status } : step));
}

export function createMockPipelineFailureGateway(
  options: CreateMockPipelineFailureGatewayOptions = {},
): MockPipelineFailureGateway {
  const base = createPipelineFailureGateway(options);
  const detail = options.detail ?? PIPELINE_FAILURE_SAMPLE_DETAIL;
  const log = options.log ?? PIPELINE_FAILURE_SAMPLE_LOG;
  const retryStatus = options.retryStatus ?? 'done';

  const supports: Readonly<Record<PipelineFailureCapability, boolean>> = {
    retryStep: true,
    // Mặc định tắt: bộ mẫu cũ mô tả màn trước K-06; test K-06 bật nó rõ ràng.
    rerunUpload: false,
    stepFailureDetail: true,
    technicalLog: true,
    skipFloor: true,
    copyLog: true,
    reportFailure: true,
    ...options.supports,
  };

  const stepRunCounts = new Map<string, number>();
  const copiedTexts: string[] = [];
  const reportedFailures: ReportStepFailureInput[] = [];
  const rerunCalls: RerunUploadInput[] = [];

  // Trạng thái sáu bước SỐNG qua nhiều lượt chạy lại: lượt sau nhìn thấy kết quả
  // của lượt trước, đúng như một máy chủ thật.
  let steps = detail.steps;
  let sequence = 0;

  const guard = <TValue>(
    capability: PipelineFailureMissingCapability,
    value: TValue,
  ): PipelineFailureCapabilityResult<TValue> =>
    supports[capability] ? { supported: true, value } : unsupported(capability);

  return {
    ...base,
    supports,

    readStepFailure: () => Promise.resolve(guard('stepFailureDetail', { ...detail, steps })),
    readTechnicalLog: () => Promise.resolve(guard('technicalLog', log)),

    retryStep: ({ stepId }) => {
      if (!supports.retryStep) {
        return Promise.resolve(unsupported('retryStep'));
      }

      // ĐÚNG một bước được đếm. Nếu màn từng chạy lại cả lượt, con số của bước
      // một trong bộ đếm này sẽ khác 0 và test bắt được ngay.
      stepRunCounts.set(stepId, (stepRunCounts.get(stepId) ?? 0) + 1);
      sequence += 1;
      steps = stepsAfterRetry(steps, stepId, retryStatus);

      return Promise.resolve({
        supported: true,
        value: {
          stepId,
          sequence,
          status: retryStatus,
          steps,
        },
      });
    },

    rerunUpload: (input) => {
      rerunCalls.push(input);
      return Promise.resolve(options.rerunResult ?? { ok: true });
    },

    skipFloor: () => Promise.resolve(guard('skipFloor', undefined)),

    reportStepFailure: (input) => {
      reportedFailures.push(input);
      base.reportStepFailure(input);
    },

    copyText: async (text) => {
      copiedTexts.push(text);
      return true;
    },

    stepRunCounts,
    copiedTexts,
    reportedFailures,
    rerunCalls,
  };
}
