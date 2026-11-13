/**
 * Cổng dữ liệu của màn Xử lý (`ProcessingScreen`) — mọi lời gọi ra khỏi màn đi
 * qua đây.
 *
 * Cùng khuôn `floorUploadGateway.ts` / `inputQualityGateway.ts`: một `interface`
 * cho hình dạng, một factory nhận `ApiClient` để test cắm `createMockApiClient()`
 * vào đúng phép ánh xạ bản sản phẩm dùng (R-70), và một factory thứ hai dựng
 * client thật cho container.
 *
 * ## Phần NỐI ĐƯỢC THẬT
 *
 * Đúng một việc có endpoint hôm nay: đọc tiến độ của MỘT lượt xử lý
 * (`ENDPOINTS.drawings.progress(projectId, uploadId)`), và theo dõi nó bằng
 * `createProgressStream` của `src/lib/realtime`. Dòng sự kiện đó tự chuyển SSE →
 * quay vòng sau `SSE_FAILURE_LIMIT` lần mất kết nối liên tiếp, tự thử lại SSE
 * định kỳ, và tự ngừng nghe khi tab ẩn qua `visibilityTarget`. File này CHỈ GỌI
 * nó: không có giãn cách thử lại, không có `EventSource`, không có vòng lặp quay
 * vòng nào viết tay ở đây.
 *
 * ## Phần chạy nền — nối được mà KHÔNG cần endpoint mới
 *
 * `runInBackground` từng nằm trong danh sách "chưa có" và nút gọi nó là một nút
 * chết. Nó ra khỏi danh sách đó, và không phải vì có endpoint mới: việc "xử lý
 * vẫn chạy sau khi rời màn" làm được trọn vẹn bằng thứ đã có trong tay — dòng sự
 * kiện của chính `subscribeProgress`. Cái thiếu chỉ là một chỗ GIỮ hàm huỷ đăng
 * ký để màn tháo không đóng dòng đó, và chỗ ấy nay là
 * `src/lib/realtime/backgroundWatch.ts`.
 *
 * Ranh giới đi kèm phải nói ra, vì nó là thật: không có kênh đẩy từ máy chủ thì
 * ĐÓNG THẺ TRÌNH DUYỆT LÀ HẾT. "Chạy nền" ở đây nghĩa là rời màn này trong cùng
 * một phiên, không phải tắt trình duyệt. `completionNotice` — kênh đẩy thật, thứ
 * một cái chuông thông báo cần — vẫn là `supported: false`, và nó ở lại danh
 * sách dưới đây cho tới khi có endpoint.
 *
 * ## Phần KHÔNG CÓ — và vì sao vẫn khai
 *
 * Bảy việc màn cần mà tầng dữ liệu chưa có. Mỗi việc vẫn nằm trong
 * {@link ProcessingGateway} (giao diện là thứ nơi gọi lập trình theo, xoá đi thì
 * lần sau phải dựng lại; test và story cắm bản giả "có dữ liệu" vào đúng chỗ đó
 * để phần giao diện tương ứng vẫn kiểm được — R-73), nhưng **bản cài đặt thật
 * trả về nhánh `supported: false` có kiểu rõ ràng** ({@link ProcessingUnsupported}),
 * kèm tên endpoint / trường dữ liệu còn thiếu. Không giá trị bịa, không `0`,
 * không mảng rỗng giả vờ là dữ liệu thật. Hook đọc nhánh đó và phản ánh trung
 * thực ra props: không huỷ được thì `canCancel` bằng `false`, không có vị trí
 * hàng đợi thì `queueLine` bằng `undefined`.
 *
 * Đây KHÔNG phải stub bị R-69 cấm: R-69 cấm bịa dữ liệu và cấm TODO im lặng.
 * Ở đây một khả năng chưa tồn tại được khai báo rõ ràng và sự thật đó được
 * truyền lên giao diện.
 *
 * ## GIẢ ĐỊNH — đọc trước khi tin `toStageBreakdown`
 *
 * `Progress` mang đúng MỘT luồng: `progressPercent` tổng, `step` là chuỗi tự do,
 * `status` bốn giá trị. Nó KHÔNG mang trạng thái của từng bước trong sáu bước
 * của `PIPELINE_STAGES`. Không có hàm nào trong repo chuyển `Progress` sang
 * `PipelineProgressState` (đã soát `src/lib/realtime` toàn bộ).
 *
 * {@link toStageBreakdown} lấp khoảng đó bằng **tra cứu**, không bằng công thức:
 * `Progress.step` đối chiếu với `getPipelineStages()` theo cả `id` lẫn nhãn
 * tiếng Việt. Nhưng nó phải thêm MỘT GIẢ ĐỊNH, và giả định đó viết ra đây để
 * người đọc sau không tưởng là sự thật quan sát được:
 *
 * > **Giả định C3:** mọi bước đứng TRƯỚC bước đang chạy trong `PIPELINE_STAGES`
 * > đều đã xong.
 *
 * Đó là thứ duy nhất một `Progress` một luồng có thể mang. Nó **sai** khi máy
 * chủ chạy các bước không theo thứ tự khai báo, khi một bước bị bỏ qua mà vẫn
 * còn dở, hoặc khi máy chủ quay lại một bước cũ để chạy lại. Khi lượt đọc báo
 * hỏng thì giả định này KHÔNG được áp: không bước nào được nâng lên "xong" từ
 * một lần đọc báo hỏng.
 */

import { createAppApiClient, resolveApiBaseUrl, resolveUseMockApi } from '@/api/appClient';
import type { ApiClient, ApiResult, Floor, LatestFloorUpload, PipelineRunList, Project } from '@/api/client';
import { ENDPOINTS, toApiUrl } from '@/api/endpoints';
import type { Progress } from '@/api/schemas';
import type { FloorLayerDocument, FloorReadiness } from '@/api/schemas/spatialLayer';
import type { PointMm } from '@/domain/units/compare';
import { toPointMm } from '@/lib/commands/business/shared';
import { refreshSingleFlight } from '@/lib/auth';
import { describeError, toAppError } from '@/lib/errors';
import type { AppError } from '@/lib/errors';
import { readWireError } from '@/lib/errors/wireError';
import { createUuid } from '@/lib/http/ids';
import type { ChannelClock, ChannelEvent } from '@/lib/realtime/eventChannel';
import type { ProgressPatchEvent } from '@/lib/realtime/mergeEvents';
import { getPipelineStages } from '@/lib/realtime/pipeline';
import type { PipelineStageId, PipelineStageState } from '@/lib/realtime/pipeline';
import {
  backgroundWatchRegistry,
  type BackgroundWatchEntry,
  type BackgroundWatchRegistry,
} from '@/lib/realtime/backgroundWatch';
import { createPollingChannel, getDefaultVisibilityTarget } from '@/lib/realtime/pollingChannel';
import type { PollingChannelHandle, PollingVisibilityTarget } from '@/lib/realtime/pollingChannel';
import { createProgressStream } from '@/lib/realtime/progressStream';
import type { ProgressStreamSource, ProgressStreamState } from '@/lib/realtime/progressStream';
import { createBeaconTransport, createTelemetrySender } from '@/lib/telemetry/sender';
import type { TelemetrySender } from '@/lib/telemetry/sender';
import {
  isScaleEstimated,
  isScaleMissing,
  SCALE_STATE_VIEWS,
  scaleReasonsSentenceOf,
  scaleStateMessageOf,
  scaleStateOf,
} from '@/lib/viewmodel/provisionalScale';
import { noteRatioOf } from '@/screens/pipeline/ScaleCalibration/scaleCheck';

/** Số lượt gần nhất tab "Nhật ký" liệt kê (N5-08). */
const PIPELINE_RUNS_PAGE_SIZE = 20;

/** SSE `running` im lâu thế này thì hỏi #8 một lần (`: ping` không tới `onmessage`). */
export const SSE_SILENCE_PROBE_MS = 120_000;
/** Nhịp hỏi #8 của tầng không đang xem. */
export const OTHER_FLOOR_POLL_INTERVAL_MS = 5_000;
/** Nhịp hỏi #8 của tầng còn `pending` (chưa vào hàng chạy). */
export const PENDING_POLL_INTERVAL_MS = 30_000;

/* -------------------------------------------------------------------------- */
/* Khả năng chưa tồn tại — kết quả CÓ KIỂU, không phải giá trị bịa.             */
/* -------------------------------------------------------------------------- */

/**
 * Tên máy đọc của từng việc màn cần mà tầng dữ liệu chưa có. Danh sách này là
 * bản kê nợ của màn Xử lý; mỗi tên có đúng một dòng trong
 * {@link PROCESSING_MISSING_ENDPOINTS}.
 */
export const PROCESSING_CAPABILITIES = [
  'cancelProcessing',
  'queuePosition',
  'parallelFloorPipeline',
  'runInBackground',
  'completionNotice',
  'extractionSummary',
  'stepDetails',
  'detectedGeometry',
  'stageBreakdown',
] as const;

export type ProcessingCapability = (typeof PROCESSING_CAPABILITIES)[number];

/**
 * Những việc trong {@link PROCESSING_CAPABILITIES} mà bản cài đặt thật CHƯA làm
 * được. Đây là bản kê nợ thật sự, và nó chỉ được ngắn đi.
 *
 * Tách khỏi danh sách trên vì hai danh sách trả lời hai câu khác nhau: trên là
 * "màn hỏi cổng những gì", dưới là "câu nào hôm nay chưa trả lời được".
 * `runInBackground` rời danh sách dưới khi nó chạy thật. `stageBreakdown` thì ở
 * lại: `supports.stageBreakdown` bật, nhưng `toStageBreakdown` vẫn trả nhánh
 * `supported: false` cho một `Progress.step` không tra được — nên nó vẫn cần một
 * dòng nợ viết nguyên văn.
 */
export const PROCESSING_MISSING_CAPABILITIES = [
  'cancelProcessing',
  'queuePosition',
  'parallelFloorPipeline',
  'completionNotice',
  'stepDetails',
  'detectedGeometry',
  'stageBreakdown',
] as const;

export type ProcessingMissingCapability = (typeof PROCESSING_MISSING_CAPABILITIES)[number];

/**
 * Endpoint / trường dữ liệu còn thiếu của từng khả năng, viết nguyên văn để
 * người nối dây sau biết chính xác phải thêm gì vào `src/api` trước khi bản cài
 * đặt thật đổi được sang nhánh `supported: true`.
 */
export const PROCESSING_MISSING_ENDPOINTS: Readonly<
  Record<ProcessingMissingCapability, string>
> = {
  cancelProcessing: 'ENDPOINTS.drawings.cancel + DrawingsApi.cancel — chưa có',
  queuePosition:
    'ENDPOINTS.drawings.queue + trường vị trí hàng đợi trong ProgressSchema (.strict(), 7 trường) — chưa có',
  parallelFloorPipeline:
    'Endpoint trả trạng thái xử lý của MỌI tầng trong một lượt đọc — chưa có; màn tự ghép N lượt đọc drawings.progress độc lập',
  completionNotice:
    'Kênh ĐẨY từ máy chủ khi xử lý xong, sống qua cả lúc đóng thẻ (chuông thông báo) — chưa có',
  stepDetails:
    'Endpoint chi tiết từng bước (số đối tượng tìm được, mã lỗi của riêng bước) — chưa có',
  detectedGeometry: 'Endpoint trả hình học dò được GIỮA CHỪNG lúc đang xử lý — chưa có',
  stageBreakdown:
    'Ánh xạ Progress.step (chuỗi tự do) sang PipelineStageId — chưa có; toStageBreakdown tra cứu theo id/nhãn và chịu giả định C3',
};

/** Một khả năng chưa tồn tại. `supported: false` là câu trả lời thật, không phải lỗi. */
export interface ProcessingUnsupported {
  readonly supported: false;
  readonly capability: ProcessingMissingCapability;
  /** Lấy nguyên từ {@link PROCESSING_MISSING_ENDPOINTS}. */
  readonly missing: string;
}

export interface ProcessingSupported<TValue> {
  readonly supported: true;
  readonly value: TValue;
}

export type ProcessingCapabilityResult<TValue> =
  | ProcessingSupported<TValue>
  | ProcessingUnsupported;

/** Dựng nhánh "không hỗ trợ" — một chỗ duy nhất ghép tên việc với endpoint thiếu. */
export function unsupported(capability: ProcessingMissingCapability): ProcessingUnsupported {
  return { supported: false, capability, missing: PROCESSING_MISSING_ENDPOINTS[capability] };
}

/* -------------------------------------------------------------------------- */
/* Dữ liệu thô — chưa định dạng, chưa xếp bảy trạng thái.                       */
/* -------------------------------------------------------------------------- */

export type ProcessingRawStageStatus = 'queued' | 'running' | 'done' | 'failed';

/** Một tầng trong mô hình nhiều-tầng-song-song. Xem `parallelFloorPipeline`. */
export interface ProcessingRawFloorProgress {
  readonly floorId: string;
  readonly floorName: string;
  readonly status: ProcessingRawStageStatus;
  readonly objectCount?: number;
}

/** Chi tiết một bước. Xem `stepDetails`. */
export interface ProcessingRawStepProgress {
  readonly stepId: PipelineStageId;
  readonly status: ProcessingRawStageStatus;
  /** 0..100, chưa làm tròn. */
  readonly percent: number;
  readonly remainingSeconds?: number;
  readonly detailLines: readonly string[];
  readonly errorCode?: string;
  readonly children?: readonly ProcessingRawStepProgress[];
}

export interface ProcessingRawLogLine {
  readonly id: string;
  /** Mốc giờ ISO 8601 — hook định dạng bằng `src/lib/format`, không phải cổng. */
  readonly atIso: string;
  readonly text: string;
}

/** Tổng kết trích xuất. Xem `extractionSummary`. */
export interface ProcessingExtractionSummary {
  readonly wallCount: number;
  readonly openingCount: number;
  /** Đồ đạc trên tầng: cũng là "đối tượng" như ở màn Xuất (R-1). */
  readonly furnitureCount: number;
  readonly dimensionCount: number;
  /** Tầng đã có tỷ lệ do người đặt tay (không còn `scaleStatus: unresolved`). */
  readonly hasScale?: boolean;
  /** Máy không đo được tỷ lệ (N16 `scaleSource: 'project_default'`, `isScaleMissing`) — chip đỏ "Chưa có tỷ lệ". */
  readonly scaleMissing?: boolean;
  /**
   * UX-02: máy đã đặt tỷ lệ tạm của chính nó (`scaleStatus: unresolved`, nguồn khác `project_default`) —
   * có tỷ lệ đề xuất dù không đọc được số kích thước nào. Vắng khi không.
   */
  readonly scaleProposed?: true;
  /** UX-02: tỷ lệ máy đặt khớp đúng ghi chú "TL 1:N" của PDF (`noteRatioOf`): mẫu số N. */
  readonly scaleNoteRatio?: number;
  /**
   * Độ sẵn sàng của tầng (N16 `readiness`, FIX-P0-15). BE cũ chưa trả thì suy `scaleUnresolved` từ
   * `scaleStatus: unresolved` — có kích thước mà tỷ lệ tạm không được báo "Sẵn sàng".
   */
  readonly readiness?: FloorReadiness;
  /** N16 `scaleBasis` là cửa / độ dày tường / mặc định: tỷ lệ máy ước lượng, nên hiệu chỉnh. */
  readonly scaleEstimated?: true;
  /** R9: tên trạng thái tỷ lệ (`SCALE_STATE_VIEWS`) khi N16 có `scaleState`. */
  readonly scaleStateLabel?: string;
  /** R9: câu trạng thái + lý do (`scaleStateMessageOf`); số tin được thì chỉ câu căn cứ. */
  readonly scaleStateNote?: string;
  /** R9: tỷ lệ tầng chỉ ước lượng / chưa xác định — được nói trước ở màn Xử lý. */
  readonly scaleStateNeedsAttention?: true;
  readonly roomCount: number;
  /**
   * Đường bao các phòng của tầng (mm). Hook cộng mọi tầng bằng `totalArea` — cộng mm² rồi
   * làm tròn MỘT lần, như màn Phòng — thay vì cộng `Room.areaM2` đã làm tròn từng phòng
   * (73,91 cạnh 73,90, K5).
   */
  readonly roomOutlinesMm: readonly (readonly PointMm[])[];
  /** Ngưỡng tin cậy của dự án (N5, Cài đặt › Đơn vị đo); `null` khi không đọc được cài đặt. */
  readonly confidenceThreshold: number | null;
  /** Số đối tượng chưa duyệt có độ tin cậy dưới `confidenceThreshold`; 0 khi ngưỡng là `null`. */
  readonly lowConfidenceCount: number;
}

/** Một nhịp của dòng sự kiện: bản ghép mới nhất, kèm nguồn và mốc quan sát. */
export interface ProcessingProgressSnapshot {
  readonly eventId: string;
  readonly floorId: string;
  readonly uploadId: string;
  readonly observedAtMs: number;
  /** `Partial` vì `mergeEvents` ghép từng mảnh vá; trường chưa tới thì chưa có. */
  readonly progress: Partial<Progress>;
  readonly source: ProgressStreamSource;
}

/** Một thất bại, đã thành câu người đọc được (L-03). */
export interface ProcessingFailure {
  /** Tiêu đề tiếng Việt, lấy nguyên từ `describeError` — không viết lại. */
  readonly title: string;
  /** Câu tiếng Việt, lấy nguyên từ `describeError`. */
  readonly sentence: string;
  /** Mã máy đọc của `APP_ERROR_KIND_CONFIG` — ví dụ `NETWORK`. */
  readonly technicalCode: string;
  readonly kind: AppError['kind'];
  readonly isRetryable: boolean;
  /** #8 trả 404/403: đăng ký của tầng đã đóng, không hỏi tiếp. Hook đọc lại N7. */
  readonly isTerminal?: true;
}

/* -------------------------------------------------------------------------- */
/* Tham số vào.                                                                */
/* -------------------------------------------------------------------------- */

export interface ReadProgressInput {
  readonly projectId: string;
  readonly uploadId: string;
  readonly signal?: AbortSignal;
}

export interface SubscribeProgressInput {
  readonly projectId: string;
  readonly uploadId: string;
  readonly floorId: string;
  /**
   * Trạng thái đã biết từ #8 mồi. Hỏi: chọn nhịp đầu (`pending` → 30 s). SSE:
   * `running` thì hẹn im lặng ngay khi luồng mở, không chờ nhịp đầu tiên.
   */
  readonly status?: Progress['status'];
}

export type PollProgressInput = SubscribeProgressInput;

export interface SubscribeProgressHandlers {
  readonly onSnapshot: (snapshot: ProcessingProgressSnapshot) => void;
  readonly onConnectionChange?: (state: ProgressStreamState) => void;
  readonly onFailure?: (failure: ProcessingFailure) => void;
}

export interface RequestCancelInput {
  readonly projectId: string;
  readonly uploadId: string;
}

export interface RunInBackgroundInput {
  readonly projectId: string;
  /**
   * Các lượt cần giữ sống sau khi rời màn, mỗi lượt mang theo hàm huỷ đăng ký
   * của chính dòng sự kiện đang chạy.
   *
   * Cổng KHÔNG tự mở dòng mới ở đây, và cũng không đi tìm dòng nào đang mở: nơi
   * mở là `subscribeProgress`, nơi giữ hàm huỷ là hook, nên hook là nơi duy nhất
   * trao được đúng những hàm đó. Danh sách rỗng là câu trả lời hợp lệ — không có
   * lượt nào đang chạy thì không có gì để theo dõi.
   */
  readonly watches: readonly BackgroundWatchEntry[];
}

export interface ReadQueuePositionInput {
  readonly projectId: string;
  readonly uploadId: string;
}

export interface ReadParallelFloorPipelineInput {
  readonly projectId: string;
}

/**
 * Theo TỪNG TẦNG, không theo dự án: số tường / ô mở / phòng là của một mặt bằng,
 * và `Floor.areaM2` — mảnh duy nhất của tổng kết này đã tồn tại — cũng vậy. Màn
 * cộng lại thành báo cáo của cả dự án.
 */
export interface ReadExtractionSummaryInput {
  readonly projectId: string;
  readonly floorId: string;
}

export interface ReadStepDetailsInput {
  readonly projectId: string;
  readonly uploadId: string;
}

export interface ReadDetectedGeometryInput {
  readonly projectId: string;
  readonly floorId: string;
}

export interface SubscribeCompletionNoticeInput {
  readonly projectId: string;
}

/** Đúng hai số biết được TRƯỚC khi trích xuất chạy (O-01, `ai.started`). */
export interface TrackAiStartedInput {
  readonly levelCount: number;
  readonly pageCount: number;
}

/* -------------------------------------------------------------------------- */
/* Cái seam.                                                                   */
/* -------------------------------------------------------------------------- */

/**
 * Mỗi phương thức là một việc màn cần từ thế giới bên ngoài, và không có việc
 * nào khác. Hook không nhập `src/api` trực tiếp.
 */
export interface ProcessingGateway {
  /**
   * Khả năng nào cổng này làm được, trả lời ĐỒNG BỘ.
   *
   * Cần đồng bộ vì có câu hỏi màn phải trả lời trước khi vẽ khung: `canCancel`
   * quyết định nút huỷ có tồn tại hay không (ẩn hẳn, không khoá mờ — cùng lý lẽ
   * A9), và một lời hứa chưa xong thì không trả lời được câu đó. Bản cài đặt
   * thật đặt `false` cho mọi việc chưa có endpoint; test và story cắm bản giả
   * bật `true` để nhánh "có hỗ trợ" vẫn được kiểm.
   */
  readonly supports: Readonly<Record<ProcessingCapability, boolean>>;
  /**
   * N7 — lượt tải mới nhất của từng tầng: danh sách màn theo dõi khi nơi mở màn
   * không truyền `floorUploads`. Nhờ nó mọi lối vào `/pipeline` (tải lên, kiểm
   * tra chất lượng, CAD, bảng điều khiển) thấy cùng một danh sách (B-V4-01).
   */
  readonly readLatestUploads: (input: {
    readonly projectId: string;
    readonly signal?: AbortSignal;
  }) => Promise<ApiResult<LatestFloorUpload[]>>;
  /**
   * Mọi tầng của dự án — để liệt kê tầng CHƯA có bản vẽ (N2-02). Tuỳ chọn: cổng
   * giả cũ không có thì màn không liệt kê.
   */
  readonly readFloorList?: (input: { readonly projectId: string }) => Promise<ApiResult<Floor[]>>;
  /**
   * N7b — trang đầu nhật ký lượt xử lý (mới nhất trước), cho tab "Nhật ký" (N5-08).
   * Tuỳ chọn: cổng giả cũ không có thì màn chỉ không vẽ danh sách lượt.
   */
  readonly readPipelineRuns?: (input: {
    readonly projectId: string;
    readonly signal?: AbortSignal;
  }) => Promise<ApiResult<PipelineRunList>>;
  /**
   * #24 — dự án thô, dưới khoá `project.detail` như mọi nơi khác. Chỉ đọc khi bộ
   * đệm chưa có tên dự án (mở thẳng đường dẫn), để breadcrumb vẫn nêu tên (BUG-165).
   */
  readonly readProject: (input: {
    readonly projectId: string;
    readonly signal?: AbortSignal;
  }) => Promise<ApiResult<Project>>;
  /** Lượt đọc mồi cho `useQuery` — một lần, không phải dòng sự kiện. */
  readonly readProgressOnce: (input: ReadProgressInput) => Promise<ApiResult<Progress>>;
  /**
   * Theo dõi tiến độ của MỘT lượt xử lý. Trả hàm huỷ đăng ký.
   *
   * Một lượt = một `uploadId` = một tầng. Nơi gọi mở N đăng ký độc lập cho N
   * tầng; đó chính là cơ chế bảo đảm một tầng lỗi không dừng các tầng khác.
   */
  readonly subscribeProgress: (
    input: SubscribeProgressInput,
    handlers: SubscribeProgressHandlers,
  ) => () => void;
  /**
   * Hỏi #8 định kỳ cho tầng không đang xem — không mở `EventSource` (trần 6
   * luồng/người). Tự đóng ở trạng thái cuối. Trả hàm huỷ.
   */
  readonly pollProgress: (input: PollProgressInput, handlers: SubscribeProgressHandlers) => () => void;

  /** NOT FOUND — `cancelProcessing`. */
  readonly requestCancel: (input: RequestCancelInput) => Promise<ProcessingCapabilityResult<void>>;
  /**
   * Ghi các lượt đang chạy vào sổ theo dõi nền, để màn tháo KHÔNG đóng dòng sự
   * kiện của chúng. Luôn `supported: true` — việc này không cần endpoint nào.
   *
   * Ranh giới: nó giữ được qua một lần rời màn, KHÔNG giữ được qua một lần đóng
   * thẻ trình duyệt. Xem `src/lib/realtime/backgroundWatch.ts`.
   */
  readonly runInBackground: (
    input: RunInBackgroundInput,
  ) => Promise<ProcessingCapabilityResult<void>>;
  /**
   * Sổ theo dõi nền mà cổng này ghi vào — hook đọc nó để biết một lượt có đang
   * chạy nền không (thì đừng đóng dòng sự kiện lúc tháo) và để kết thúc một lượt
   * khi nhịp cuối về.
   */
  readonly backgroundWatches: BackgroundWatchRegistry;
  /** NOT FOUND — `queuePosition`. */
  readonly readQueuePosition: (
    input: ReadQueuePositionInput,
  ) => Promise<ProcessingCapabilityResult<number>>;
  /** NOT FOUND — `parallelFloorPipeline`. */
  readonly readParallelFloorPipeline: (
    input: ReadParallelFloorPipelineInput,
  ) => Promise<ProcessingCapabilityResult<readonly ProcessingRawFloorProgress[]>>;
  /**
   * Tổng kết trích xuất của một tầng, đếm từ N16 (`spatial.readLayer`): pipeline ghi lớp AI vào
   * tài liệu tầng (`pipeline.persist`), nên số tường / ô mở / phòng / kích thước đọc được ở đó
   * (BUG-285). Lỗi đọc thì NÉM — hook vẫn đưa lối đi tiếp, chỉ thiếu con số.
   */
  readonly readExtractionSummary: (
    input: ReadExtractionSummaryInput,
  ) => Promise<ProcessingCapabilityResult<ProcessingExtractionSummary>>;
  /** NOT FOUND — `stepDetails`. */
  readonly readStepDetails: (
    input: ReadStepDetailsInput,
  ) => Promise<ProcessingCapabilityResult<readonly ProcessingRawStepProgress[]>>;
  /** NOT FOUND — `detectedGeometry`. */
  readonly readDetectedGeometry: (
    input: ReadDetectedGeometryInput,
  ) => Promise<ProcessingCapabilityResult<readonly string[]>>;
  /** NOT FOUND — `completionNotice`. Trả hàm huỷ đăng ký khi nào có kênh thật. */
  readonly subscribeCompletionNotice: (
    input: SubscribeCompletionNoticeInput,
    onNotice: () => void,
  ) => ProcessingCapabilityResult<() => void>;

  /** Một câu cho lỗi đến từ `src/api` (L-03). */
  readonly describeApiFailure: (error: unknown) => ProcessingFailure;
  /**
   * O-01, nửa ĐẦU. `ai.finished` KHÔNG có mặt ở đây: schema của nó bắt buộc
   * `wallCount`, `openingCount`, `dimensionCount`, `roomCount` và
   * `confidencePercent`, mà N16 không mang một độ tin cậy tổng — bắn nó hôm nay
   * chỉ điền được số bịa.
   */
  readonly trackAiStarted: (input: TrackAiStartedInput) => void;
  /** Chép nhật ký. `false` khi trình duyệt từ chối — không phải lỗi màn hình. */
  readonly copyText: (text: string) => Promise<boolean>;
  /** Mốc giờ hiện tại. Tiêm được để test không phụ thuộc đồng hồ thật. */
  readonly now: () => number;
}

/* -------------------------------------------------------------------------- */
/* Ánh xạ Progress → sáu bước. Xem GIẢ ĐỊNH C3 ở đầu file.                      */
/* -------------------------------------------------------------------------- */

/** Trạng thái `Progress.status` nói cả lượt đã kết thúc thành công. */
const COMPLETED_STATUS: Progress['status'] = 'completed';
/** Trạng thái `Progress.status` nói lượt đọc này báo hỏng. */
const FAILED_STATUS: Progress['status'] = 'failed';
/** Trạng thái `Progress.status` nói lượt còn xếp hàng — chưa bước nào chạy. */
const PENDING_STATUS: Progress['status'] = 'pending';

const normalise = (text: string): string => text.trim().toLowerCase();

/** Chỉ số của bước mà `Progress.step` nói tới, hoặc `-1` khi không tra được. */
function matchStageIndex(step: string | undefined): number {
  if (step === undefined) {
    return -1;
  }

  const wanted = normalise(step);

  if (wanted.length === 0) {
    return -1;
  }

  return getPipelineStages().findIndex(
    (stage) => normalise(stage.id) === wanted || normalise(stage.label) === wanted,
  );
}

/**
 * Một bước ĐÃ quan sát thấy xong thì không bị hạ xuống lại, trừ khi lượt đọc
 * mới báo chính nó hỏng; một bước đã thấy CHẠY thì không lùi về "chờ", trừ khi
 * lượt đọc mới báo hỏng.
 *
 * Đây là mặt "từng bước" của chính lời hứa mà `highestProgressReached` giữ cho
 * con số tổng: khi SSE chết và lượt quay vòng đọc lại một nhịp cũ hơn — hay một
 * lượt đọc #8 đi trước khung SSE về sau nó — các bước đã tới không được rơi về
 * rỗng (BUG-548). Lượt MỚI thì đi qua `pending`, nhánh đó dựng sáu bước từ đầu.
 */
function keepObservedDone(
  next: PipelineStageState['status'],
  previous: PipelineStageState | undefined,
  isFailing: boolean,
): PipelineStageState['status'] {
  if (previous?.status === 'done' && next !== 'failed') {
    return 'done';
  }

  if (previous?.status === 'running' && next === 'queued' && !isFailing) {
    return 'running';
  }

  return next;
}

/** Giữ mốc giờ đã quan sát được của một bước; không có thì không bịa. */
function carryTimestamps(
  base: { id: PipelineStageId; status: PipelineStageState['status'] },
  previous: PipelineStageState | undefined,
  observedAtMs: number,
): PipelineStageState {
  const startedAtMs =
    previous?.startedAtMs ??
    (base.status === 'running' || base.status === 'done' ? observedAtMs : undefined);
  const finishedAtMs = base.status === 'done' ? (previous?.finishedAtMs ?? observedAtMs) : undefined;

  return {
    id: base.id,
    status: base.status,
    ...(startedAtMs !== undefined ? { startedAtMs } : {}),
    ...(finishedAtMs !== undefined ? { finishedAtMs } : {}),
  };
}

/**
 * `Progress` → sáu `PipelineStageState`, bằng TRA CỨU cộng giả định C3.
 *
 * Ba chốt chặn:
 *
 * - Lượt đọc báo hỏng (`status === 'failed'`): bước tra được đặt `failed`, các
 *   bước sau giữ `queued`, và **không bước nào được nâng lên `done`** — chỉ giữ
 *   nguyên thứ đã quan sát được từ trước.
 * - Cả lượt đã xong (`status === 'completed'`, hoặc `endedAt` có giá trị): cả
 *   sáu bước thành `done`. Thiếu chốt này thì `calculateTotalProgress` kẹp vĩnh
 *   viễn ở 99 (nó chỉ trả số đầy đủ khi mọi bước xong) và màn không bao giờ đến
 *   `success`.
 * - Lượt còn xếp hàng (`status === 'pending'`): sáu bước `queued` mới, bất kể
 *   `step` (lúc này chỉ là bước SẮP chạy) và bất kể bước đã quan sát — máy chủ
 *   chỉ đưa một upload về `pending` khi mở LƯỢT MỚI (`start_run`), nên giữ bước
 *   `done` của lượt cũ là tiến độ giả.
 * - `step` không tra được: trả `supported: false` — không đoán bước nào đang
 *   chạy, và nơi gọi giữ nguyên mức tiến độ cao nhất đã đạt.
 * - Trong cùng một lượt, bước đã quan sát thấy `done` không bị hạ xuống lại
 *   ({@link keepObservedDone}) — mặt "từng bước" của lời hứa tiến độ không nhảy lùi.
 *
 * `internalPercent` cố ý KHÔNG đặt: `Progress` không mang phần trăm của riêng
 * một bước, và bịa ra một con số là đúng thứ [CẤM TUYỆT ĐỐI] gọi là tiến độ giả.
 * Tổng phần trăm do `calculateTotalProgress` tự tính theo trọng số có sẵn.
 */
export function toStageBreakdown(
  progress: Partial<Progress>,
  previous: readonly PipelineStageState[],
  observedAtMs: number,
): ProcessingCapabilityResult<readonly PipelineStageState[]> {
  const stages = getPipelineStages();
  const previousById = new Map(previous.map((stage) => [stage.id, stage]));
  const isFinished = progress.status === COMPLETED_STATUS || progress.endedAt !== undefined;

  if (isFinished) {
    return {
      supported: true,
      value: stages.map((stage) =>
        carryTimestamps({ id: stage.id, status: 'done' }, previousById.get(stage.id), observedAtMs),
      ),
    };
  }

  // Lượt còn xếp hàng: máy chủ đã ghi sẵn `step` của bước sắp chạy, nhưng chưa
  // bước nào chạy — C3 ở đây sẽ là tiến độ giả và chiếm tầng đang xem.
  if (progress.status === PENDING_STATUS) {
    return {
      supported: true,
      value: stages.map((stage) => ({ id: stage.id, status: 'queued' })),
    };
  }

  const matchedIndex = matchStageIndex(progress.step);

  if (matchedIndex < 0) {
    return unsupported('stageBreakdown');
  }

  const isFailing = progress.status === FAILED_STATUS;

  return {
    supported: true,
    value: stages.map((stage, index) => {
      const before = previousById.get(stage.id);

      if (index < matchedIndex) {
        // Giả định C3 — và chốt C1: một lượt đọc báo hỏng không nâng bước nào
        // lên "xong", nó chỉ giữ nguyên thứ đã quan sát được.
        const status = isFailing ? (before?.status ?? 'queued') : 'done';
        return carryTimestamps({ id: stage.id, status }, before, observedAtMs);
      }

      if (index === matchedIndex) {
        return carryTimestamps(
          {
            id: stage.id,
            status: keepObservedDone(isFailing ? 'failed' : 'running', before, isFailing),
          },
          before,
          observedAtMs,
        );
      }

      return carryTimestamps(
        { id: stage.id, status: keepObservedDone('queued', before, isFailing) },
        before,
        observedAtMs,
      );
    }),
  };
}

/* -------------------------------------------------------------------------- */
/* Cửa vào.                                                                    */
/* -------------------------------------------------------------------------- */

export interface CreateProcessingGatewayOptions {
  /** Bộ gửi đo đạc tiêm được — test cắm bản đếm, không đẩy gì lên mạng. */
  readonly telemetry?: TelemetrySender;
  /** `EventSource` tiêm được — jsdom không có bản thật. */
  readonly EventSourceImpl?: typeof EventSource;
  /** Nguồn "tab đang ẩn hay không" tiêm được; mặc định là `document`. */
  readonly visibilityTarget?: PollingVisibilityTarget;
  /** Bộ chép tiêm được — jsdom không có `navigator.clipboard`. */
  readonly writeClipboardText?: (text: string) => Promise<void>;
  /** Đồng hồ tiêm được. */
  readonly now?: () => number;
  /** Sổ theo dõi nền tiêm được — mặc định là sổ của cả ứng dụng. */
  readonly backgroundWatches?: BackgroundWatchRegistry;
  /** Đồng hồ hẹn giờ của luồng, kênh hỏi và hẹn im lặng. */
  readonly clock?: ChannelClock;
}

const defaultClock: ChannelClock = {
  clearTimeout: (id) => clearTimeout(id),
  now: () => Date.now(),
  setTimeout: (fn, ms) => setTimeout(fn, ms),
};

const isFinalStatus = (status: Progress['status'] | undefined): boolean =>
  status === COMPLETED_STATUS || status === FAILED_STATUS;

/** #8 trả 404 (upload không còn) hoặc 403 (mất quyền): hỏi tiếp vô ích. */
const isGoneError = (error: unknown): boolean => {
  const status = readWireError(error)?.status;
  return status === 404 || status === 403;
};

/** Một chuỗi đại diện cho nội dung một lượt đọc, để bỏ qua lượt không đổi gì. */
function contentKeyOf(progress: Progress): string {
  return [
    progress.id,
    progress.progressPercent,
    progress.status,
    progress.step,
    progress.startedAt ?? '',
    progress.endedAt ?? '',
    progress.error ?? '',
  ].join('|');
}

function toFailure(error: unknown): ProcessingFailure {
  const appError = toAppError(error);
  const described = describeError(appError);

  return {
    title: described.title,
    sentence: described.description,
    technicalCode: appError.code,
    kind: appError.kind,
    isRetryable: appError.retryable,
    ...(isGoneError(error) ? { isTerminal: true as const } : {}),
  };
}

/**
 * Đọc #8 một lần cho một đăng ký: lỗi thì báo `onFailure` (404/403 thì gọi
 * `onGone` để nơi gọi đóng), nội dung trùng lượt trước thì trả `null`.
 */
function createProgressReader(
  client: ApiClient,
  { projectId, uploadId }: SubscribeProgressInput,
  handlers: SubscribeProgressHandlers,
  onGone: () => void,
) {
  let sequence = 0;
  let lastContentKey = '';
  // Mốc quan sát: tăng mỗi khi thấy một nhịp mới (SSE hay lượt đọc). Pending không mang
  // mã lượt chạy (BE `_pending`), nên "cùng lượt" chỉ phân được bằng mốc này (P3-8).
  let observed = 0;
  let lastStatus: Progress['status'] | undefined;

  const toPatchEvent = (progress: Progress): ProgressPatchEvent<Progress> => {
    sequence += 1;
    return { eventId: `${uploadId}:${sequence}`, patch: progress, sequence };
  };

  return {
    toPatchEvent,
    markSeen: (progress: Progress): void => {
      lastContentKey = contentKeyOf(progress);
      observed += 1;
      lastStatus = progress.status;
    },
    read: async (signal?: AbortSignal): Promise<ProgressPatchEvent<Progress> | null> => {
      const observedAtIssue = observed;
      const result = await client.drawings.progress({
        projectId,
        uploadId,
        ...(signal !== undefined ? { signal } : {}),
      });

      if (!result.ok) {
        // Lượt bị huỷ (đăng ký đóng, đổi tầng đang xem) không phải lỗi của tầng — như kênh hỏi
        // (`pollingChannel.ts`), bỏ qua; không thì chip "lỗi" đứng trên tầng chạy tốt (BUG-574).
        if (signal?.aborted === true || result.error.kind === 'aborted') {
          return null;
        }

        // Lượt đọc kế tiếp phải được phát dù trùng nội dung: nó xoá lỗi tạm này.
        lastContentKey = '';
        const failure = toFailure(result.error);
        handlers.onFailure?.(failure);

        if (failure.isTerminal === true) {
          onGone();
        }

        return null;
      }

      // `pending` của một lượt đọc đã đi TRƯỚC nhịp mới nhất là nhịp cũ đến muộn, không
      // phải lượt mới (lượt mới đến qua SSE, hoặc qua lượt đọc đi sau): bỏ, kẻo thanh về 0.
      const isLatePending =
        result.data.status === PENDING_STATUS &&
        observed !== observedAtIssue &&
        lastStatus !== PENDING_STATUS;

      if (isLatePending) {
        return null;
      }

      const contentKey = contentKeyOf(result.data);

      if (contentKey === lastContentKey) {
        return null;
      }

      lastContentKey = contentKey;
      observed += 1;
      lastStatus = result.data.status;
      return toPatchEvent(result.data);
    },
  };
}

/**
 * Đếm tổng kết một tầng từ tài liệu N16; mục người đã duyệt không tính là "tin cậy thấp". Ngưỡng là
 * của dự án, không phải hằng toàn cục: câu "dưới 0,70" cạnh cài đặt 0,75 là sai (BUG-354).
 */
export function toExtractionSummary(
  document: FloorLayerDocument,
  confidenceThreshold: number | null,
): ProcessingExtractionSummary {
  const { furniture, openings, rooms, walls } = document.layer;
  const lowConfidenceCount =
    confidenceThreshold === null
      ? 0
      : [...walls, ...openings, ...furniture, ...rooms].filter(
          (item) => !item.reviewed && item.confidence < confidenceThreshold,
        ).length;
  // R9: tỷ lệ đọc từ bản vẽ (`determined`) không phải lý do xem lại — cùng luật readiness của máy chủ mới.
  const scaleSettled = document.scaleState === 'determined' || document.scaleState === 'userCalibrated';
  const readiness: FloorReadiness | undefined =
    document.readiness ??
    (document.scaleStatus === 'unresolved' && !scaleSettled ? { state: 'needsReview', reasons: ['scaleUnresolved'] } : undefined);
  const isProposed =
    document.scaleStatus === 'unresolved' &&
    !isScaleMissing(document.scaleSource) &&
    document.level.scaleMillimetresPerPixel !== undefined;
  const noteRatio = isProposed ? noteRatioOf(document.level.scaleMillimetresPerPixel, document.sourceDpi) : null;
  const scaleState =
    document.scaleState === undefined ? undefined : scaleStateOf(document.scaleStatus, document.scaleSource, document.scaleState);
  // Số tin được thì chỉ nói căn cứ, không mời hiệu chỉnh; người dùng đã hiệu chỉnh thì nói đúng nguồn ấy
  // (máy chủ gửi `scaleReasons: []` cho `userCalibrated` — e2e R9 mục 8).
  const attentionNote = scaleState === undefined ? null : scaleStateMessageOf(scaleState, document.scaleReasons);
  const scaleStateNote =
    scaleState === undefined
      ? null
      : (attentionNote ??
        scaleReasonsSentenceOf(scaleState === 'confirmed' ? ['human'] : document.scaleReasons));

  return {
    wallCount: walls.length,
    openingCount: openings.length,
    furnitureCount: furniture.length,
    dimensionCount: document.dimensions.length,
    hasScale:
      document.level.scaleMillimetresPerPixel !== undefined && document.scaleStatus === undefined,
    ...(readiness !== undefined ? { readiness } : {}),
    ...(isScaleEstimated(document.scaleBasis) ? { scaleEstimated: true } : {}),
    ...(scaleState !== undefined ? { scaleStateLabel: SCALE_STATE_VIEWS[scaleState].name } : {}),
    ...(scaleStateNote !== null ? { scaleStateNote } : {}),
    ...(attentionNote !== null ? { scaleStateNeedsAttention: true as const } : {}),
    ...(isScaleMissing(document.scaleSource) ? { scaleMissing: true } : {}),
    ...(isProposed ? { scaleProposed: true } : {}),
    ...(noteRatio !== null ? { scaleNoteRatio: noteRatio } : {}),
    roomCount: rooms.length,
    roomOutlinesMm: rooms.map((room) => room.outline.map(toPointMm)),
    confidenceThreshold,
    lowConfidenceCount,
  };
}

export function createProcessingGateway(
  client: ApiClient,
  options: CreateProcessingGatewayOptions = {},
): ProcessingGateway {
  const now = options.now ?? ((): number => Date.now());
  const clock = options.clock ?? defaultClock;
  const backgroundWatches = options.backgroundWatches ?? backgroundWatchRegistry;
  const visibility = options.visibilityTarget ?? getDefaultVisibilityTarget();

  return {
    // Bốn việc làm được hôm nay: theo dõi tiến độ, chạy nền, tổng kết (đếm từ N16)
    // và ánh xạ sáu bước — cái cuối chỉ làm được một nửa, xem giả định C3 ở đầu
    // file. Năm việc còn lại `false` cho tới khi có endpoint thật.
    supports: {
      // Bật cờ này thì giữ lệnh `UNDO_WINDOW_MS` kèm toast hoàn tác (A8). Hết giờ chỉ
      // huỷ những lượt tải lên chụp lúc xác nhận mà vẫn đang chạy. Câu toast phải đúng
      // cả khi lượt chạy xong trước hạn. Xem B-V4-09.
      cancelProcessing: false,
      queuePosition: false,
      parallelFloorPipeline: false,
      runInBackground: true,
      completionNotice: false,
      extractionSummary: true,
      stepDetails: false,
      detectedGeometry: false,
      stageBreakdown: true,
    },

    // Client đã đọc hết `nextCursor` (R7). Danh sách đổi giữa chừng (422
    // `CURSOR_INVALID`) thì đọc lại từ trang đầu đúng một lần rồi mới báo lỗi.
    readLatestUploads: async ({ projectId, signal }) => {
      const read = () =>
        client.drawings.latestUploads({ projectId, ...(signal !== undefined ? { signal } : {}) });
      const first = await read();

      return first.ok || readWireError(first.error)?.code !== 'CURSOR_INVALID' ? first : read();
    },

    readFloorList: ({ projectId }) => client.floors.list({ projectId }),

    readPipelineRuns: ({ projectId, signal }) =>
      client.drawings.listPipelineRuns({
        projectId,
        limit: PIPELINE_RUNS_PAGE_SIZE,
        ...(signal !== undefined ? { signal } : {}),
      }),

    readProject: ({ projectId, signal }) =>
      client.projects.read({ projectId, ...(signal !== undefined ? { signal } : {}) }),

    readProgressOnce: ({ projectId, signal, uploadId }) =>
      client.drawings.progress({
        projectId,
        uploadId,
        ...(signal !== undefined ? { signal } : {}),
      }),

    subscribeProgress: (input, handlers) => {
      const { floorId, uploadId } = input;
      let closed = false;
      let isSse = true;
      let lastStatus = input.status;
      let silenceTimer: ReturnType<ChannelClock['setTimeout']> | null = null;
      let stream: { close(): void } | null = null;

      const clearSilence = (): void => {
        if (silenceTimer !== null) {
          clock.clearTimeout(silenceTimer);
          silenceTimer = null;
        }
      };

      // Huỷ cả hẹn im lặng; lượt #8 đang bay về sau `closed` thì bị bỏ.
      const close = (): void => {
        if (closed) return;
        closed = true;
        clearSilence();
        stream?.close();
      };

      const reader = createProgressReader(client, input, handlers, close);

      // Nhịp cuối: phát rồi đóng — máy chủ không tự đóng luồng khi lượt kết thúc.
      const emit = (progress: Partial<Progress>, eventId: string, source: ProgressStreamSource): void => {
        lastStatus = progress.status ?? lastStatus;
        handlers.onSnapshot({ eventId, floorId, uploadId, observedAtMs: now(), progress, source });

        if (isFinalStatus(progress.status)) {
          close();
        }
      };

      // SSE im khi lượt còn `running`: hỏi #8 tối đa một lần mỗi quãng im.
      const armSilence = (): void => {
        clearSilence();

        if (closed || !isSse || lastStatus !== 'running') return;

        silenceTimer = clock.setTimeout(() => {
          silenceTimer = null;
          // Tab ẩn: luồng đã tự đóng (hiện lại thì mở lại và hẹn lại) — không hỏi #8 trong lúc ẩn.
          if (visibility?.hidden === true) return;
          void reader.read().then((event) => {
            if (closed) return;

            if (event !== null) {
              emit(event.patch, event.eventId, 'sse');
            }

            armSilence();
          });
        }, SSE_SILENCE_PROBE_MS);
      };

      stream = createProgressStream({
        url: toApiUrl(resolveApiBaseUrl(), ENDPOINTS.streams.uploadProgress(input.projectId, uploadId)),
        clock,
        refreshAuth: () => refreshSingleFlight({ source: 'local' }),
        fetchEvents: async ({ signal }) => {
          const event = await reader.read(signal);
          return event === null ? [] : [event];
        },
        onEvent: (event) => {
          if (closed) return;
          emit(event.data, event.eventId, event.source);

          if (event.source === 'sse') {
            armSilence();
          }
        },
        onStateChange: (state) => {
          if (closed) return;
          isSse = state.source === 'sse';
          armSilence();
          handlers.onConnectionChange?.(state);
        },
        toSseEvent: (event: ChannelEvent) => {
          reader.markSeen(event.data);
          return reader.toPatchEvent(event.data);
        },
        ...(options.EventSourceImpl !== undefined
          ? { EventSourceImpl: options.EventSourceImpl }
          : {}),
        ...(options.visibilityTarget !== undefined
          ? { visibilityTarget: options.visibilityTarget }
          : {}),
      });

      return close;
    },

    pollProgress: (input, handlers) => {
      const { floorId, uploadId } = input;
      let closed = false;
      let channel: PollingChannelHandle | null = null;
      let isPending = input.status === 'pending';
      let generation = 0;

      const close = (): void => {
        if (closed) return;
        closed = true;
        channel?.close();
      };

      const reader = createProgressReader(client, input, handlers, close);

      const open = (): void => {
        generation += 1;
        const own = generation;
        channel = createPollingChannel<Progress>({
          clock,
          intervalMs: isPending ? PENDING_POLL_INTERVAL_MS : OTHER_FLOOR_POLL_INTERVAL_MS,
          fetchEvents: async ({ signal }) => {
            const event = await reader.read(signal);
            return event === null || closed ? [] : [event];
          },
          onEvent: (event) => {
            if (closed || own !== generation) return;
            const { status } = event.patch;
            handlers.onSnapshot({
              eventId: event.eventId,
              floorId,
              uploadId,
              observedAtMs: now(),
              progress: event.patch,
              source: 'polling',
            });

            if (isFinalStatus(status)) {
              close();
              return;
            }

            // Nhịp đổi `pending` ↔ khác: đóng kênh cũ, mở kênh mới với nhịp mới.
            if ((status === 'pending') !== isPending) {
              isPending = status === 'pending';
              const previous = channel;
              open();
              previous?.close();
            }
          },
          onStateChange: (state) => {
            if (closed || own !== generation) return;
            handlers.onConnectionChange?.({ ...state, source: 'polling' });
          },
          ...(options.visibilityTarget !== undefined
            ? { visibilityTarget: options.visibilityTarget }
            : {}),
        });
      };

      open();
      return close;
    },

    requestCancel: () => Promise.resolve(unsupported('cancelProcessing')),

    // Không lời gọi mạng nào: "chạy nền" chỉ là việc KHÔNG đóng dòng sự kiện đã
    // mở. Ghi vào sổ là toàn bộ phần việc của cổng.
    runInBackground: ({ watches }) => {
      watches.forEach((entry) => {
        backgroundWatches.watch(entry);
      });

      return Promise.resolve({ supported: true, value: undefined });
    },

    backgroundWatches,

    readQueuePosition: () => Promise.resolve(unsupported('queuePosition')),
    readParallelFloorPipeline: () => Promise.resolve(unsupported('parallelFloorPipeline')),
    readExtractionSummary: async ({ floorId, projectId }) => {
      const [result, settings] = await Promise.all([
        client.spatial.readLayer({ floorId, projectId }),
        client.projectSettings.read({ projectId }),
      ]);

      if (!result.ok) {
        throw result.error;
      }

      // Cài đặt hỏng chỉ mất câu tin cậy, không mất cả khối số liệu.
      const threshold = settings.ok ? settings.data.confidenceThreshold : null;
      return { supported: true, value: toExtractionSummary(result.data, threshold) };
    },
    readStepDetails: () => Promise.resolve(unsupported('stepDetails')),
    readDetectedGeometry: () => Promise.resolve(unsupported('detectedGeometry')),
    subscribeCompletionNotice: () => unsupported('completionNotice'),

    describeApiFailure: (error) => toFailure(error),

    trackAiStarted: ({ levelCount, pageCount }) => {
      options.telemetry?.track({ name: 'ai.started', levelCount, pageCount });
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

/** Cổng dựng trên client thật của ứng dụng — thứ container gọi. */
export function createAppProcessingGateway(): ProcessingGateway {
  const gateway = createProcessingGateway(createAppApiClient(), {
    telemetry: createTelemetrySender({
      transport: createBeaconTransport({ url: ENDPOINTS.telemetry }),
      sessionId: createUuid(),
    }),
  });

  // Bộ mẫu dev không có máy chủ SSE: lượt `running` của nó (N7b, `MOCK_PIPELINE_RUNS`) mở luồng
  // chỉ gặp 500 của proxy Vite (smoke-grid `projectPipelineGraph`). Hỏi #8 định kỳ thay cho SSE.
  return resolveUseMockApi() ? { ...gateway, subscribeProgress: gateway.pollProgress } : gateway;
}
