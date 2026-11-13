/**
 * Nửa "suy nghĩ" của màn Xử lý — mọi thứ `ProcessingScreen.tsx` cần, đã xong.
 *
 * `types.ts` là hợp đồng props DUY NHẤT của màn; hook này trả về
 * {@link ProcessingScreenProps} cộng đúng MỘT trường ngoài hợp đồng đó —
 * {@link ProcessingScreenHookResult.failedPipelineStep}, xem ghi chú "Gắn
 * `PipelineFailure`" bên dưới. Mọi chuỗi người đọc được ghép và định dạng ở đây
 * (A15) — view không còn con số thô nào phải làm tròn.
 *
 * ## Gắn `PipelineFailure` (S-11) khi một bước AI hỏng
 *
 * `record.failure` (kiểu {@link ProcessingFailure}) là lỗi ĐỌC — mạng chết, SSE
 * rớt — và vẫn đi ra qua `errorAlert`/`InlineAlert` như cũ, với nút "Thử lại" gọi
 * thẳng `queryClient.invalidateQueries`. Khác hẳn: một `PipelineStageState` mang
 * `status: 'failed'` nghĩa là MÁY CHỦ đã chạy bước đó và bước đó hỏng (ví dụ mô
 * hình tách tường không tách được) — đây mới là "một bước AI hỏng" mà màn S-11
 * (`@/screens/pipeline/PipelineFailure`) được dựng riêng để nói.
 *
 * {@link ProcessingScreenHookResult.failedPipelineStep} tìm bản ghi tầng ĐẦU
 * TIÊN có một bước `'failed'` và trả ba mã định vị của nó (`floorId`, `stepId`)
 * cộng `onResolved` — tái dùng đúng `onRetry` ở dưới, vì "thử lại xong" ở màn
 * S-11 và "làm mới toàn bộ tiến độ" ở nút Thử lại của màn này là cùng một hành
 * động: nạp lại từ máy chủ. `ProcessingScreen.container.tsx` đọc trường này và
 * GẮN THAY `<PipelineFailureContainer>` cho `<ProcessingScreen>` khi nó có mặt —
 * xem docblock ở đó. `undefined` thì màn Xử lý vẽ như bình thường.
 *
 * ## Không có công thức nào tự chế (R-61)
 *
 * - Tổng phần trăm: `calculateTotalProgress` của `src/lib/realtime/pipeline`.
 *   Trọng số sáu bước nằm trong `PIPELINE_STAGES`; thư mục màn này không chứa
 *   một con số trọng số nào.
 * - Thời gian còn lại: `estimateRemainingSeconds` của cùng module.
 * - Tên sáu bước: `getPipelineStages()` (nó đọc `src/i18n/vi.json` khoá
 *   `pipeline`). Không gõ tay, không viết tắt, không dịch lại.
 * - Dòng sự kiện: `createProgressStream`. Nó TỰ chuyển SSE sang quay vòng sau
 *   `SSE_FAILURE_LIMIT` lần mất kết nối liên tiếp, tự thử lại SSE định kỳ, và
 *   tự ngừng nghe khi tab ẩn. Hook chỉ gọi nó qua cổng: không có giãn cách thử
 *   lại, không `EventSource`, không vòng lặp quay vòng nào ở đây.
 *
 * ## Tiến độ không nhảy lùi
 *
 * `calculateTotalProgress` là hàm THUẦN: nó kẹp kết quả bằng
 * `highestProgressReached` nhưng **không tự giữ** con số đó — nơi gọi phải lưu
 * và truyền lại qua mỗi lần gọi. Chỗ lưu ở đây là `FloorProgressRecord.totalPercent`
 * nằm trong bộ nhớ đệm của react-query dưới `queryKeys.progress.byFloor(floorId)`.
 * Nhờ vậy hai điều cùng đúng: SSE chết giữa chừng rồi quay vòng đọc lại một số
 * thấp hơn cũng không kéo thanh tiến độ lùi, và rời màn rồi quay lại thì tiến độ
 * vẫn ở chỗ cũ (tier `aiProgress`, `gcTime` mười phút).
 *
 * ## Một tầng lỗi không dừng các tầng khác
 *
 * Mỗi tầng là MỘT đăng ký độc lập ghi vào MỘT khoá đệm riêng: tầng đang xem
 * nghe SSE (`gateway.subscribeProgress`), tầng khác hỏi #8 (`gateway.pollProgress`)
 * — BE trần 6 luồng/người, nên mỗi màn đúng một `EventSource`. Tầng đã ở trạng
 * thái cuối không đăng ký gì. Một tầng hỏng chỉ làm hỏng bản ghi của chính nó;
 * `state` của cả màn thành `partial`, và S-11 chỉ gắn khi MỌI tầng đã cuối.
 *
 * ## Chạy nền — cái nút "Để chạy nền và thông báo cho tôi" thật sự làm gì
 *
 * Nút đó từng gọi `gateway.runInBackground()`, nhận `supported: false`, và
 * không có gì xảy ra. Nay nó làm đúng hai việc, và không hơn:
 *
 * 1. trao hàm huỷ đăng ký của TỪNG dòng sự kiện đang chạy cho sổ theo dõi nền,
 *    nên lúc màn tháo, `useEffect` dưới đây KHÔNG đóng chúng nữa;
 * 2. đẩy một thông báo qua `notificationBus` (bọc bởi `useNotifications`), và
 *    đẩy thông báo thứ hai khi nhịp cuối của một lượt về — kể cả khi lúc đó màn
 *    đã tháo từ lâu, vì hàm báo là một bao đóng nằm trong sổ, không phải state
 *    của React.
 *
 * Ranh giới nói thẳng trong chính câu tiếng Việt người dùng đọc: repo không có
 * kênh đẩy từ máy chủ, nên **đóng thẻ trình duyệt là hết**. "Chạy nền" ở đây là
 * rời MÀN NÀY trong cùng một phiên.
 *
 * ## Trạng thái máy chủ (R-64)
 *
 * Không `useState` nào giữ `isLoading` hay `error` — `useQueries` giữ. Hai thứ
 * duy nhất `useState` ở đây giữ là trạng thái của riêng giao diện (tab đang mở,
 * bước nào đang bung chi tiết, khoá cuộn nhật ký, hộp xác nhận huỷ).
 * `useShareLinks.ts` tự viết tay hai cờ đó — đó là ngoại lệ đi trước, không phải
 * khuôn mẫu.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useQueries, useQuery, useQueryClient } from '@tanstack/react-query';

import type { Progress } from '@/api/schemas';
import type { PipelineRun } from '@/api/schemas/pipelineRuns';
import {
  PROJECT_NOT_FOUND_DESCRIPTION,
  PROJECT_NOT_FOUND_TITLE,
} from '@/components/feedback/ProjectSpatialGate';
import { totalArea } from '@/domain/rooms/area';
import { useNotifications } from '@/hooks/useNotifications';
import { useProjectFloors } from '@/hooks/useProjectFloors';
import { isProjectNotFound } from '@/hooks/useProjectSpatial';
import { useReducedMotion } from '@/hooks/useReducedMotion';
import { can } from '@/lib/auth/permissions';
import { formatCalendarDate, formatClockTime, formatDuration } from '@/lib/format/datetime';
import { formatArea } from '@/lib/format/measure';
import { SCALE_PROPOSED_LABEL, SCALE_STATE_VIEWS } from '@/lib/viewmodel/provisionalScale';
import { formatNumber, formatPercent } from '@/lib/format/number';
import type { HttpError } from '@/lib/http/types';
import { MILLISECONDS_PER_SECOND } from '@/lib/motion/tokens';
import type { NotificationBus, NotificationInput } from '@/lib/mutations/notificationBus';
import { cachedProjectName } from '@/lib/query/cachedProjectName';
import { queryKeys } from '@/lib/query/queryKeys';
import type {
  BackgroundWatchEntry,
  BackgroundWatchOutcome,
} from '@/lib/realtime/backgroundWatch';
import type { ChannelStatus } from '@/lib/realtime/eventChannel';
import {
  calculateTotalProgress,
  estimateRemainingSeconds,
  getPipelineStages,
} from '@/lib/realtime/pipeline';
import type { PipelineStageState } from '@/lib/realtime/pipeline';
import type { ProgressStreamSource } from '@/lib/realtime/progressStream';
import { ROUTES } from '@/routes/paths';
import type { ProjectRole } from '@/types/project';

import { describePipelineError } from '../pipelineErrorText';
import { estimateSentence, medianRunMinutes, minutesForMegapixels } from '@/lib/viewmodel/processingEstimate';
import { createAppProcessingGateway, toStageBreakdown } from './processingGateway';
import type {
  ProcessingExtractionSummary,
  ProcessingFailure,
  ProcessingGateway,
  ProcessingRawLogLine,
  ProcessingRawStepProgress,
  SubscribeProgressHandlers,
} from './processingGateway';
import type {
  ProcessingErrorAlertViewModel,
  ProcessingFloorChipViewModel,
  ProcessingLogLineViewModel,
  ProcessingPanelTab,
  ProcessingPreviewViewModel,
  ProcessingReviewReason,
  ProcessingRunRowViewModel,
  ProcessingScreenProps,
  ProcessingScreenState,
  ProcessingStageStatus,
  ProcessingStepViewModel,
  ProcessingSummaryViewModel,
} from './types';

/* -------------------------------------------------------------------------- */
/* Chuỗi tiếng Việt của riêng hook. Bản sao khai báo nằm ở h7.i18n.fragment.json.*/
/* -------------------------------------------------------------------------- */

const COPY = {
  statusQueued: 'đang chờ',
  statusRunning: 'Đang xử lý',
  statusDone: 'đã xong',
  statusFailed: 'lỗi',
  previewAltPrefix: 'Bản vẽ đang được xử lý — ',
  previewAltEmpty: 'Chưa có bản vẽ nào để xem trước.',
  noFloorRunning: 'Chưa có tầng nào đang được xử lý.',
  backgroundStartedTitle: 'Sẽ báo cho bạn khi xử lý xong',
  logCopied: 'Đã chép nhật ký',
  logCopyFailed: 'Không chép được nhật ký',
  logCopyFailedDescription: 'Trình duyệt chặn khay nhớ tạm. Chọn các dòng trong nhật ký rồi chép bằng tay.',
  backgroundStartedDescription:
    'Xử lý vẫn chạy khi bạn rời màn này. Đóng thẻ trình duyệt thì không báo được nữa.',
  backgroundDoneDescription: 'Mở lại màn xử lý để xem kết quả.',
  backgroundFailedDescription: 'Mở lại màn xử lý để xem chi tiết lỗi.',
} as const;

/** Ví dụ `"Tầng 1 đã xử lý xong"`. */
const backgroundDoneTitle = (floor: string): string => `${floor} đã xử lý xong`;

/** Ví dụ `"Tầng 1 gặp lỗi khi xử lý"`. */
const backgroundFailedTitle = (floor: string): string => `${floor} gặp lỗi khi xử lý`;

const UNIT = {
  floor: 'tầng',
  wall: 'tường',
  /* Chip tầng: tổng tường + cửa + nội thất + phòng — gọi đúng là "mục nhận diện", không "đối tượng" (K52). */
  object: 'mục nhận diện',
  opening: 'cửa',
  furniture: 'nội thất',
  dimensionChain: 'chuỗi kích thước',
  room: 'phòng',
} as const;

/** Ví dụ `"còn khoảng 2 phút"`. */
const remainingSentence = (duration: string): string => `Còn khoảng ${duration}`;

/** Ví dụ `"Đã xử lý xong 2/4 tầng"` — đếm trên các tầng đã có bản vẽ (aesthetic 2.5 #4: bỏ "đã" thứ hai). */
const doneFloorsSentence = (done: string, total: string): string =>
  `Đã xử lý xong ${done}/${total} ${UNIT.floor}`;

/** Ví dụ `"Còn lại khoảng 4 phút 20 giây"` — ngoài vùng `role=status`: đổi mỗi giây (R1-03). */
const overallRemainingSentence = (duration: string): string => `Còn lại khoảng ${duration}`;

/**
 * Tổng mục nhận diện của chip tầng, cùng định nghĩa với `countElements` của màn Xuất: tường + ô mở +
 * đồ đạc + phòng (R-1). Tổng kết không dùng nó: ghi cửa, nội thất riêng (K52).
 */
const objectTotalOf = (
  counts: Pick<ProcessingExtractionSummary, 'furnitureCount' | 'openingCount' | 'roomCount' | 'wallCount'>,
): number => counts.wallCount + counts.openingCount + counts.furnitureCount + counts.roomCount;

/** Không lượt nào: "Đã xong 0/0 tầng" cạnh một thẻ ghi 4 tầng là câu sai (BUG-165). */
const NO_RUN_SENTENCE = 'Chưa có lượt xử lý nào đang chạy.';
/** S2-7: lúc N7 còn đang tải thì chưa biết có lượt nào — không được nói "chưa có". */
const LOADING_RUNS_SENTENCE = 'Đang tải các lượt xử lý…';

/**
 * Ví dụ `"Đang xếp hàng: còn 2 lượt phía trước. Thường mất khoảng 2 phút."`. Chưa ước lượng được
 * (dự án chưa có lượt xong, chưa biết cỡ ảnh) thì giữ câu chung về ảnh lớn (U09).
 */
const queueSentence = (ahead: string, waited: string | null, estimate: string | undefined): string =>
  `Đang xếp hàng: còn ${ahead} lượt phía trước. ${estimate ?? 'Ảnh lớn có thể mất vài phút.'}` +
  (waited === null ? '' : ` Đã chờ ${waited}.`);

/** Câu bắt buộc nói rõ xử lý VẪN TIẾP TỤC khi một tầng lỗi — chỉ khi còn tầng chưa cuối (BUG-553). */
const partialSentence = (failedNames: string, othersRunning: boolean): string =>
  othersRunning ? `${failedNames} gặp lỗi. Các tầng còn lại vẫn đang được xử lý.` : `${failedNames} gặp lỗi.`;

/** Ví dụ `"Có 9 đối tượng có độ tin cậy dưới 0,75 cần bạn xem lại."` — ngưỡng của dự án (BUG-354). */
const NO_DIMENSION_SENTENCE =
  'Không đọc được số kích thước nào, nên hệ thống chưa tự suy ra tỷ lệ: bạn cần đặt tỷ lệ.';

/**
 * UX-02: không đọc được số kích thước nhưng mọi tầng đã có tỷ lệ (đặt tay hoặc máy đề xuất, ít nhất một
 * tầng máy đề xuất) — nói tỷ lệ đến từ đâu thay vì "không đọc được số". `null` khi còn tầng chưa có tỷ lệ.
 */
export function proposedScaleNoteOf(
  parts: readonly Pick<ProcessingExtractionSummary, 'hasScale' | 'scaleProposed' | 'scaleNoteRatio'>[],
): string | null {
  const proposed = parts.filter((part) => part.scaleProposed === true);
  if (proposed.length === 0 || !parts.every((part) => part.hasScale === true || part.scaleProposed === true)) {
    return null;
  }
  const ratios = new Set(proposed.map((part) => part.scaleNoteRatio));
  const [ratio] = ratios;

  return ratios.size === 1 && ratio !== undefined
    ? `Tỷ lệ lấy từ ghi chú TL 1:${formatNumber(ratio)} trên bản vẽ`
    : 'Máy ước lượng tỷ lệ, cần kiểm ở bước Tỷ lệ';
}

const lowConfidenceSentence = (count: string): string =>
  `${count} chỗ máy chưa chắc, nên xem lại.`;

const noLowConfidenceSentence = (threshold: string): string =>
  `Không có chỗ nào máy chưa chắc (ngưỡng ${threshold}).`;

/* -------------------------------------------------------------------------- */
/* Hằng lấy từ thư viện, không viết tay (R-71).                                 */
/* -------------------------------------------------------------------------- */

/** Nhãn tiếng Việt của sáu bước, đọc một lần từ `src/i18n/vi.json` khoá `pipeline`. */
const STAGE_LABEL_BY_ID = new Map(getPipelineStages().map((stage) => [stage.id, stage.label]));

/** `< 1024px` — cùng mốc `InputQualityGate`, `FloorUploadScreen` và `ProjectSettings`. */
const NARROW_VIEWPORT_QUERY = '(width < 1024px)';

const DEFAULT_ROLES: readonly ProjectRole[] = ['engineer'];

/** Nhịp cập nhật câu ước lượng U09: mốc tính bằng phút, không cần mỗi giây. */
const ESTIMATE_TICK_MS = 10 * MILLISECONDS_PER_SECOND;
const MILLISECONDS_PER_MINUTE = 60 * MILLISECONDS_PER_SECOND;
/** UX-29: chưa có lượt nào xong thì chỉ nói mốc ngắn này, khi cỡ ảnh cũng đoán vậy. */
const SHORT_GUESS_MINUTES = 2;
const SHORT_GUESS_SENTENCE = 'Thường dưới 2 phút.';

/** Danh tính một lượt trong sổ theo dõi nền — một dự án có thể có nhiều lượt. */
const watchIdOf = (projectId: string, uploadId: string): string => `${projectId}:${uploadId}`;

/**
 * Loại của thông báo — và vì sao loại "xong" mang theo mã lượt.
 *
 * `notificationBus` GỘP các thông báo cùng `type` rơi vào cùng một cửa sổ thời
 * gian, và nhãn nó dán lên bản gộp là `common.undo_group` — "Hoàn tác N thay
 * đổi". Câu đó đúng cho một chuỗi sửa hoàn tác được, và sai hoàn toàn cho hai
 * tầng xử lý xong cách nhau ba giây. Nên mỗi lượt có `type` riêng: hai lượt
 * không bao giờ gộp, và không câu nào bị viết lại thành câu của chuyện khác.
 */
const BACKGROUND_STARTED_TYPE = 'processing-background-started';
/** Phản hồi của nút "Sao chép nhật ký" (SCR-12): một loại riêng, lượt chép sau thay lượt trước. */
const LOG_COPY_TYPE = 'processing-log-copy';
const backgroundSettledType = (watchId: string): string => `processing-background-done:${watchId}`;

/** Nhịp cuối theo cách máy chủ báo — chỉ hai giá trị này kết thúc một lượt. */
function outcomeOf(status: Progress['status'] | undefined): BackgroundWatchOutcome | undefined {
  if (status === 'completed') {
    return 'done';
  }

  if (status === 'failed') {
    return 'failed';
  }

  return undefined;
}

const isFinalStatus = (status: Progress['status'] | undefined): boolean =>
  status === 'completed' || status === 'failed';

/** Lượt bị thay (`PIPELINE_SUPERSEDED`, `FLOOR_DELETED`): đọc lại N7, không tính là hỏng. */
const isReloadProgress = (progress: Partial<Progress> | undefined): boolean =>
  progress?.status === 'failed' && describePipelineError(progress.error).action === 'reload';

/** Chạy `run` đúng một lần cho mỗi khoá. */
const once = (seen: Set<string>, key: string, run: () => void): void => {
  if (seen.has(key)) return;
  seen.add(key);
  run();
};

type SubscriptionMode = 'sse' | 'poll' | 'none';

/** Câu báo một lượt chạy nền đã kết thúc. Mức độ nằm trong CÂU, không trong màu (A5). */
function settledNotice(watchId: string, label: string, outcome: BackgroundWatchOutcome): NotificationInput {
  return {
    type: backgroundSettledType(watchId),
    title: outcome === 'done' ? backgroundDoneTitle(label) : backgroundFailedTitle(label),
    description:
      outcome === 'done' ? COPY.backgroundDoneDescription : COPY.backgroundFailedDescription,
  };
}

/** Ổn định qua các lượt render, để `useQueries` không dựng lại danh sách rỗng mỗi lần. */
const EMPTY_UPLOADS: readonly ProcessingFloorUpload[] = [];
const EMPTY_GEOMETRY: readonly string[] = [];

/* -------------------------------------------------------------------------- */
/* Tham số vào.                                                                */
/* -------------------------------------------------------------------------- */

/**
 * Một lượt xử lý đang chạy: một bản vẽ của một tầng.
 *
 * Nguồn mặc định là N7 (`client.drawings.latestUploads`, lượt tải mới nhất của
 * từng tầng). Nơi gọi vẫn truyền thẳng được qua `floorUploads` — test và story
 * làm thế (R-73).
 */
export interface ProcessingFloorUpload {
  readonly floorId: string;
  /** Tên tầng, tiếng Việt — ví dụ `"Tầng 1"`. */
  readonly floorName: string;
  readonly uploadId: string;
  /** `Drawing.url` của bản vẽ đang xử lý, để panel xem trước có ảnh nền. */
  readonly sourceImageUrl?: string;
}

export interface UseProcessingScreenOptions {
  readonly projectId: string;
  /** Truyền thì dùng nguyên (rỗng ⇒ `empty`); bỏ trống thì màn tự đọc N7. */
  readonly floorUploads?: readonly ProcessingFloorUpload[];
  readonly roles?: readonly ProjectRole[];
  /** Cổng dữ liệu. Có mặc định thật bên trong; test và story cắm bản giả vào. */
  readonly gateway?: ProcessingGateway;
  readonly onNavigate?: (path: string) => void;
  /**
   * Nơi nút "liên hệ hỗ trợ" dẫn tới.
   *
   * Không có mặc định lấy từ `ROUTE_PATTERNS` được: repo KHÔNG có route hỗ trợ
   * nào (đã soát toàn bộ `src/routes/paths.ts`). Không truyền thì nút dẫn về
   * màn tài khoản — nơi duy nhất có thông tin liên hệ — chứ không im lặng.
   */
  readonly onGoToSupport?: () => void;
  /** Ép cách xếp thu gọn — cho story hoặc test muốn một câu trả lời cố định. */
  readonly forceCollapsed?: boolean;
  /**
   * Bus thông báo. Bỏ trống là bus của cả phiên (`appNotificationBus`) — thứ
   * `NotificationHost` ở `main.tsx` đang vẽ. Test và story tiêm bus riêng để hai
   * lượt kiểm không thấy thông báo của nhau.
   */
  readonly notifications?: NotificationBus;
}

/* -------------------------------------------------------------------------- */
/* Bản ghi một tầng — thứ nằm trong bộ nhớ đệm của react-query.                 */
/* -------------------------------------------------------------------------- */

interface FloorProgressRecord {
  readonly floorId: string;
  readonly uploadId: string;
  readonly stages: readonly PipelineStageState[];
  /**
   * Vừa là phần trăm đang hiển thị, vừa là `highestProgressReached` của lần gọi
   * `calculateTotalProgress` kế tiếp — hàm đó trả về `max` của hai thứ, nên giữ
   * đúng một con số là đủ để tiến độ không bao giờ nhảy lùi.
   */
  readonly totalPercent: number;
  readonly remainingSeconds: number | null;
  readonly progress?: Partial<Progress>;
  readonly logLines: readonly ProcessingRawLogLine[];
  readonly source: ProgressStreamSource;
  readonly connectionStatus: ChannelStatus;
  /** Lỗi đọc của RIÊNG tầng này. Nhịp đọc được kế tiếp xoá nó, trừ 404/403 (`isTerminal`). */
  readonly failure?: ProcessingFailure;
  readonly queuePosition?: number;
  readonly stepDetails?: readonly ProcessingRawStepProgress[];
  readonly detectedGeometryPaths?: readonly string[];
}

function emptyRecord(upload: ProcessingFloorUpload): FloorProgressRecord {
  return {
    floorId: upload.floorId,
    uploadId: upload.uploadId,
    stages: getPipelineStages().map((stage) => ({ id: stage.id, status: 'queued' })),
    totalPercent: 0,
    remainingSeconds: null,
    logLines: [],
    source: 'sse',
    connectionStatus: 'dang-noi',
  };
}

/** Câu một dòng nhật ký: tên bước tiếng Việt, kèm phần trăm máy chủ tự báo. */
function logTextOf(progress: Partial<Progress>): string {
  const label = progress.step === undefined ? undefined : stageLabelOfStep(progress.step);
  const name = label ?? progress.step;

  if (name === undefined) {
    return COPY.noFloorRunning;
  }

  if (progress.progressPercent === undefined) {
    return name;
  }

  return `${name} — ${formatPercent(progress.progressPercent, { source: 'percent', fractionDigits: 0 })}`;
}

/** Nhãn tiếng Việt của bước mà một `Progress.step` nói tới, hoặc `undefined`. */
function stageLabelOfStep(step: string): string | undefined {
  const wanted = step.trim().toLowerCase();

  for (const stage of getPipelineStages()) {
    if (stage.id.toLowerCase() === wanted || stage.label.toLowerCase() === wanted) {
      return stage.label;
    }
  }

  return undefined;
}

/**
 * Gộp một nhịp mới vào bản ghi của một tầng.
 *
 * Đây là chỗ duy nhất `totalPercent` được cập nhật, và nó luôn đi qua
 * `calculateTotalProgress` với `highestProgressReached` là con số trước đó — nên
 * một nhịp báo số thấp hơn (quay vòng đọc lại sau khi SSE chết) không kéo được
 * thanh tiến độ lùi.
 */
function applySnapshot(
  record: FloorProgressRecord,
  progress: Partial<Progress>,
  observedAtMs: number,
  source: ProgressStreamSource,
  eventId: string,
): FloorProgressRecord {
  const breakdown = toStageBreakdown(progress, record.stages, observedAtMs);
  const stages = breakdown.supported ? breakdown.value : record.stages;
  const totalPercent = calculateTotalProgress({
    stages,
    highestProgressReached: record.totalPercent,
  });

  const logLine: ProcessingRawLogLine = {
    id: eventId,
    atIso: new Date(observedAtMs).toISOString(),
    text: logTextOf(progress),
  };

  // Một nhịp đọc được xoá lỗi đọc tạm (503, mất mạng); chỉ 404/403 là vĩnh viễn.
  const { failure, ...rest } = record;
  // Không còn gì để chờ thì không có "thời gian còn lại": 0 giây thành "Còn lại khoảng 0 giây" (BUG-352).
  const remainingSeconds = estimateRemainingSeconds({ stages, highestProgressReached: totalPercent });

  return {
    ...rest,
    ...(failure?.isTerminal === true ? { failure } : {}),
    stages,
    totalPercent,
    remainingSeconds: remainingSeconds === 0 ? null : remainingSeconds,
    progress,
    source,
    // Lượt đọc mồi và nhịp SSE đầu cùng báo một mốc: mỗi mốc một dòng (BUG-360).
    logLines:
      record.logLines.at(-1)?.text === logLine.text ? record.logLines : [...record.logLines, logLine],
  };
}

/** Trạng thái của lượt theo máy chủ — sáu bước, KHÔNG xét lỗi đọc (có thể chỉ tạm). */
function runStatusOf(record: FloorProgressRecord): ProcessingStageStatus {
  if (isReloadProgress(record.progress)) {
    return 'queued';
  }

  if (record.stages.some((stage) => stage.status === 'failed')) {
    return 'failed';
  }

  if (record.stages.every((stage) => stage.status === 'done')) {
    return 'done';
  }

  if (record.stages.some((stage) => stage.status === 'running')) {
    return 'running';
  }

  return 'queued';
}

/** Trạng thái chip: lượt theo máy chủ, cộng lỗi đọc đang còn của riêng tầng này. */
const floorStatusOf = (record: FloorProgressRecord): ProcessingStageStatus =>
  record.failure !== undefined && !isReloadProgress(record.progress) ? 'failed' : runStatusOf(record);

/** Lỗi đọc TẠM (503, mất mạng) còn treo trên tầng — 404/403 là upload đã mất, không phải đọc hỏng. */
const isPendingReadFailure = (record: FloorProgressRecord | undefined): boolean =>
  record?.failure !== undefined && record.failure.isTerminal !== true;

/** Lượt đọc bị TanStack tạm dừng vì mất mạng: đi qua bảng lỗi chung như một lỗi mạng thật. */
const OFFLINE_READ_ERROR: HttpError = { kind: 'network', raw: 'offline', requestId: '', retryable: true };

/**
 * Lượt đã cuối theo `progress.status` và sáu bước — cổng S-11 và chọn tầng đang
 * xem. Upload đã mất (#8 trả 404/403) cũng là cuối: không còn gì để chờ.
 */
function isRunFinal(record: FloorProgressRecord): boolean {
  const status = runStatusOf(record);
  return (
    record.failure?.isTerminal === true ||
    status === 'done' ||
    status === 'failed' ||
    (!isReloadProgress(record.progress) && isFinalStatus(record.progress?.status))
  );
}

const STATUS_LABELS: Readonly<Record<ProcessingStageStatus, string>> = {
  queued: COPY.statusQueued,
  running: COPY.statusRunning,
  done: COPY.statusDone,
  failed: COPY.statusFailed,
};

/** Nhãn chip tầng khi N16 `readiness.state` là `needsReview` (FIX-P0-15). */
const NEEDS_REVIEW_LABEL = 'Cần xem lại';
/** Nhãn đỏ khi máy không đo được tỷ lệ tầng (N16 `scaleSource: 'project_default'`): tên chung của mọi màn. */
const SCALE_MISSING_LABEL = SCALE_STATE_VIEWS.missing.name;

/** Phần trăm của MỘT bước. Không tự tăng: chưa biết thì `0`, xong thì `100`. */
function stepPercentOf(stage: PipelineStageState): number {
  if (stage.status === 'done') {
    return 100;
  }

  return stage.internalPercent ?? 0;
}

const countLabel = (value: number, unit: string): string =>
  `${formatNumber(value, { fractionDigits: 0 })} ${unit}`;

/** Giây → câu tiếng Việt, qua `formatDuration` (nó nhận mili giây). */
const durationLabelOf = (seconds: number | null): string | null =>
  seconds === null ? null : formatDuration(seconds * MILLISECONDS_PER_SECOND);

/* -------------------------------------------------------------------------- */
/* Cách xếp thu gọn — cùng khuôn `useProjectSettings.ts`.                       */
/* -------------------------------------------------------------------------- */

function useNarrowViewport(): boolean {
  const [isNarrow, setIsNarrow] = useState(() =>
    typeof window !== 'undefined' ? window.matchMedia(NARROW_VIEWPORT_QUERY).matches : false,
  );

  useEffect(() => {
    const media = window.matchMedia(NARROW_VIEWPORT_QUERY);
    setIsNarrow(media.matches);
    const listener = (event: MediaQueryListEvent): void => setIsNarrow(event.matches);
    media.addEventListener('change', listener);
    return () => media.removeEventListener('change', listener);
  }, []);

  return isNarrow;
}

/** Megapixel của ảnh bản vẽ (đọc kích thước ảnh trong trình duyệt), `null` khi chưa biết — U09. */
function useImageMegapixels(url: string | undefined): number | null {
  const [megapixels, setMegapixels] = useState<number | null>(null);

  useEffect(() => {
    if (url === undefined || typeof Image === 'undefined') return undefined;
    const image = new Image();
    image.onload = () => setMegapixels((image.naturalWidth * image.naturalHeight) / 1_000_000);
    image.src = url;
    return () => {
      image.onload = null;
    };
  }, [url]);

  return megapixels;
}

/**
 * Cổng đã tiêm, hoặc bản thật dựng ĐÚNG MỘT LẦN và chỉ khi cần.
 *
 * `ProcessingScreen.container.tsx` bình thường tiêm sẵn bản thật; nhánh dự phòng
 * ở đây dành cho story hoặc test dựng thẳng hook. Dựng lười vì
 * `createAppProcessingGateway` mở một bộ gửi đo đạc — không nên tạo ra một bộ
 * nữa cho mỗi lượt gắn hook đã có cổng riêng.
 */
function useResolvedGateway(injected: ProcessingGateway | undefined): ProcessingGateway {
  const fallbackRef = useRef<ProcessingGateway | null>(null);

  if (injected !== undefined) {
    return injected;
  }

  fallbackRef.current ??= createAppProcessingGateway();
  return fallbackRef.current;
}

/* -------------------------------------------------------------------------- */
/* Hook.                                                                       */
/* -------------------------------------------------------------------------- */

/**
 * Ba mã định vị của bước AI đã hỏng, cộng lối ra khi màn S-11 báo thử lại xong.
 * Xem ghi chú "Gắn `PipelineFailure`" ở đầu file.
 */
export interface ProcessingScreenFailedStep {
  readonly floorId: string;
  readonly stepId: string;
  /** `Progress.error` của lượt hỏng — mã máy chủ, S-11 tra câu theo bảng. */
  readonly failureCode?: string;
  /** Tên tầng theo N7. */
  readonly failureFloorName: string;
  /** Mọi tầng của màn và trạng thái chip của chúng — dải "Tiến độ theo tầng" của S-11 (BUG-545). */
  readonly failureFloors: readonly ProcessingFailureFloor[];
  /** "Thử lại xong" ở màn S-11 — nạp lại tiến độ, cùng hành động với nút Thử lại. */
  readonly onResolved: () => void;
}

/** Một tầng trong dải tiến độ của S-11. */
export interface ProcessingFailureFloor {
  readonly floorId: string;
  readonly floorName: string;
  readonly status: ProcessingStageStatus;
}

/**
 * {@link ProcessingScreenProps} cộng đúng một trường ngoài hợp đồng đóng băng
 * của `types.ts` — xem ghi chú "Gắn `PipelineFailure`" ở đầu file.
 */
export interface ProcessingScreenHookResult extends ProcessingScreenProps {
  /** Có mặt khi một tầng có bước `'failed'` VÀ mọi tầng đã cuối; không thì màn giữ `partial`. */
  readonly failedPipelineStep?: ProcessingScreenFailedStep;
}

/** `(options) => ProcessingScreenHookResult` cho `ProcessingScreen.tsx` và container. */
/** Cổng không đọc được danh sách tầng: không liệt kê tầng chưa có bản vẽ. */
const READ_NO_FLOORS = async () => ({ ok: true as const, data: [] });

/** N5-08 — một lượt N7b thành một dòng của danh sách lượt. */
function toRunRow(run: PipelineRun): ProcessingRunRowViewModel {
  const at = Date.parse(run.startedAt ?? run.createdAt);
  const timeLabel = `${formatClockTime(at)} · ${formatCalendarDate(at)}`;
  const base = { id: run.runId, floorName: run.floorName, timeLabel };

  if (run.status === 'completed') return { ...base, statusLabel: 'Hoàn tất', tone: 'done' };
  if (run.status === 'failed') {
    return {
      ...base,
      statusLabel: run.supersededBy !== undefined ? 'Đã thay bằng lượt mới' : 'Lỗi',
      tone: run.supersededBy !== undefined ? 'running' : 'failed',
    };
  }
  if (run.status === 'pending') return { ...base, statusLabel: 'Đang chờ', tone: 'running' };
  return {
    ...base,
    statusLabel: `Đang chạy · ${formatPercent(run.progressPercent, { source: 'percent', fractionDigits: 0 })}`,
    tone: 'running',
  };
}

export function useProcessingScreen(options: UseProcessingScreenOptions): ProcessingScreenHookResult {
  const { projectId } = options;
  const roles = options.roles ?? DEFAULT_ROLES;
  const queryClient = useQueryClient();
  const gateway = useResolvedGateway(options.gateway);

  // Mở thẳng đường dẫn: bộ đệm chưa có #24 hay thẻ N1 nào nêu tên, nên đọc #24 một lần
  // dưới chính khoá của nó — breadcrumb nêu tên dự án ở mọi lối vào (BUG-165).
  const projectName = cachedProjectName(queryClient, projectId);
  const projectQuery = useQuery({
    queryKey: queryKeys.project.detail(projectId),
    queryFn: async ({ signal }) => {
      const result = await gateway.readProject({ projectId, signal });
      if (!result.ok) throw result.error;
      return result.data;
    },
    enabled: projectName === null,
  });
  // Đọc `data` ở đây để lượt #24 về vẫn vẽ lại màn: v5 chỉ báo thay đổi của trường đã đọc.
  const knownProjectName = projectName ?? projectQuery.data?.name ?? null;
  const { publish } = useNotifications(options.notifications);

  // Đăng ký đang mở, khoá theo `uploadId`. `onRunInBackground` rút mục ra khỏi
  // đây khi giao cho sổ nền; tháo màn dừng mọi mục còn lại.
  const subscriptionsRef = useRef(new Map<string, { mode: SubscriptionMode; stop: () => void }>());
  const mountedRef = useRef(false);
  const reloadedRef = useRef(new Set<string>());
  const layerInvalidatedRef = useRef(new Set<string>());
  const seenUploadRef = useRef(new Map<string, string>());

  // Nơi mở màn truyền danh sách thì dùng nó (test, story); không truyền — đường
  // của route — thì đọc N7. Trước đây vắng là rỗng, nên màn luôn `empty` dù dự án
  // có bản vẽ đang xử lý (B-V4-01).
  const readsLatestUploads = options.floorUploads === undefined;
  const latestUploadsQuery = useQuery({
    queryKey: queryKeys.progress.latestUploads(projectId),
    queryFn: async ({ signal }): Promise<readonly ProcessingFloorUpload[]> => {
      const result = await gateway.readLatestUploads({ projectId, signal });

      if (!result.ok) {
        throw result.error;
      }

      return result.data;
    },
    enabled: readsLatestUploads,
  });
  const floorUploads = options.floorUploads ?? latestUploadsQuery.data ?? EMPTY_UPLOADS;
  const uploadsPending = readsLatestUploads && latestUploadsQuery.isPending;

  // N2-02 — tầng chưa có bản vẽ: mọi tầng của dự án trừ tầng N7 đã có lượt tải. Chỉ
  // trên đường N7 (danh sách cố định của test/story không phải "cả dự án").
  const projectFloors = useProjectFloors(projectId, gateway.readFloorList ?? READ_NO_FLOORS);
  const floorsWithoutDrawing = useMemo(() => {
    if (!readsLatestUploads || latestUploadsQuery.data === undefined) return undefined;
    const uploaded = new Set(latestUploadsQuery.data.map((upload) => upload.floorId));
    return projectFloors.filter((floor) => !uploaded.has(floor.id));
  }, [latestUploadsQuery.data, projectFloors, readsLatestUploads]);

  // N5-08 — nhật ký lượt xử lý (N7b) cho tab "Nhật ký". Khoá con của N7 để lượt làm
  // mới danh sách tầng cũng làm mới danh sách lượt. Lỗi thì chỉ không vẽ danh sách.
  const readPipelineRuns = gateway.readPipelineRuns;
  const runsQuery = useQuery({
    queryKey: [...queryKeys.progress.latestUploads(projectId), 'runs'] as const,
    queryFn: async ({ signal }) => {
      if (readPipelineRuns === undefined) return [];
      const result = await readPipelineRuns({ projectId, signal });
      if (!result.ok) throw result.error;
      return result.data.items;
    },
    enabled: readPipelineRuns !== undefined,
  });
  const sourceImageMegapixels = useImageMegapixels(
    floorUploads.find((upload) => upload.sourceImageUrl !== undefined)?.sourceImageUrl,
  );
  const runs = useMemo(
    () => (runsQuery.data === undefined ? undefined : runsQuery.data.map(toRunRow)),
    [runsQuery.data],
  );
  // Danh tính của danh sách tầng dưới dạng một chuỗi: nơi gọi truyền một mảng
  // mới mỗi lượt render vẫn không làm các đăng ký bị mở lại.
  const floorsKey = floorUploads.map((upload) => `${upload.floorId}:${upload.uploadId}`).join('|');
  const uploadsRef = useRef(floorUploads);
  uploadsRef.current = floorUploads;

  const prefersReducedMotion = useReducedMotion();
  const detectedNarrow = useNarrowViewport();
  const isCompact = options.forceCollapsed ?? detectedNarrow;

  /* ---------------------------------------------------------------------- */
  /* Trạng thái của riêng giao diện.                                         */
  /* ---------------------------------------------------------------------- */

  const [activeTab, setActiveTab] = useState<ProcessingPanelTab>('preview');
  const [openStepIds, setOpenStepIds] = useState<readonly string[]>([]);
  const [isLogAutoScrollLocked, setIsLogAutoScrollLocked] = useState(false);
  const [isCancelConfirming, setIsCancelConfirming] = useState(false);

  /* ---------------------------------------------------------------------- */
  /* Trạng thái máy chủ — một khoá đệm cho mỗi tầng (R-64).                   */
  /* ---------------------------------------------------------------------- */

  const floorQueries = useQueries({
    queries: floorUploads.map((upload) => ({
      queryKey: queryKeys.progress.byFloor(upload.floorId),
      queryFn: async (): Promise<FloorProgressRecord> => {
        const cached = queryClient.getQueryData<FloorProgressRecord>(
          queryKeys.progress.byFloor(upload.floorId),
        );

        const [progress, queuePosition, stepDetails, geometry] = await Promise.all([
          gateway.readProgressOnce({ projectId, uploadId: upload.uploadId }),
          gateway.readQueuePosition({ projectId, uploadId: upload.uploadId }),
          gateway.readStepDetails({ projectId, uploadId: upload.uploadId }),
          gateway.readDetectedGeometry({ projectId, floorId: upload.floorId }),
        ]);

        if (!progress.ok) {
          throw progress.error;
        }

        // Nền là bản ghi ĐANG có trong đệm — quay lại màn không xoá tiến độ đã
        // tích — trừ khi nó thuộc lượt khác: `uploadId` khác, hoặc bản đệm đã
        // cuối mà #8 báo lượt mới (#31/#32 chạy lại trên cùng upload).
        const isSameRun =
          cached !== undefined &&
          cached.uploadId === upload.uploadId &&
          !(isFinalStatus(cached.progress?.status) && !isFinalStatus(progress.data.status));
        const base = isSameRun ? cached : emptyRecord(upload);

        const withProgress = applySnapshot(
          base,
          progress.data,
          gateway.now(),
          base.source,
          `${upload.uploadId}:seed:${progress.data.progressPercent}`,
        );

        return {
          ...withProgress,
          ...(queuePosition.supported ? { queuePosition: queuePosition.value } : {}),
          ...(stepDetails.supported ? { stepDetails: stepDetails.value } : {}),
          ...(geometry.supported ? { detectedGeometryPaths: geometry.value } : {}),
        };
      },
    })),
  });

  /* ---------------------------------------------------------------------- */
  /* O-01, nửa đầu: ai.started một lần cho mỗi lượt xử lý.                    */
  /* ---------------------------------------------------------------------- */

  const startedKeyRef = useRef<string | null>(null);

  useEffect(() => {
    const uploads = uploadsRef.current;

    if (uploads.length === 0) {
      return;
    }

    const key = `${projectId}|${floorsKey}`;

    if (startedKeyRef.current === key) {
      return;
    }

    startedKeyRef.current = key;
    gateway.trackAiStarted({
      levelCount: new Set(uploads.map((upload) => upload.floorId)).size,
      pageCount: uploads.length,
    });
  }, [floorsKey, gateway, projectId]);

  /* ---------------------------------------------------------------------- */
  /* Từ bản ghi sang viewmodel.                                              */
  /* ---------------------------------------------------------------------- */

  // Không bọc `useMemo`: `floorQueries` là một mảng mới mỗi lượt render nên một
  // bộ nhớ đệm khoá theo nó không bao giờ trúng, và phép `map` này rẻ.
  const records = floorUploads.map((upload, index) => {
    const data = floorQueries[index]?.data;
    return data?.uploadId === upload.uploadId ? data : emptyRecord(upload);
  });
  const recordsRef = useRef(records);
  recordsRef.current = records;

  // `enabled: false` vẫn là `isPending` trong TanStack v5 — chỉ tính khi đang đọc thật.
  const isListLoading = readsLatestUploads && latestUploadsQuery.isPending;
  const hasListFailed = readsLatestUploads && latestUploadsQuery.isError;
  const isLoading = isListLoading || floorQueries.some((query) => query.isPending);
  // Mất mạng lúc mở: TanStack (`networkMode: 'online'`) TẠM DỪNG lượt đọc chứ không báo lỗi,
  // nên màn đứng ở khung xương mãi (BUG-551). Có mạng lại thì lượt đọc tự chạy tiếp.
  const isReadPaused = [...(readsLatestUploads ? [latestUploadsQuery] : []), ...floorQueries].some(
    (query) => query.isPending && query.fetchStatus === 'paused',
  );
  // Lượt mồi hỏng thì tầng chuyển sang hỏi định kỳ, và lượt hỏi ghi bản ghi vào đệm — query thành
  // `success` dù chưa đọc được gì. Lỗi đọc tạm còn treo trên bản ghi vẫn là đọc hỏng, tới khi một
  // lượt đọc được xoá nó (BUG-550).
  const hasEveryReadFailed =
    hasListFailed ||
    (floorQueries.length > 0 &&
      floorQueries.every((query, index) => query.isError || isPendingReadFailure(records[index])));
  const firstReadError = hasListFailed
    ? latestUploadsQuery.error
    : (floorQueries.find((query) => query.isError)?.error ?? (isReadPaused ? OFFLINE_READ_ERROR : undefined));

  const canEdit = can('upload', 'floor', { roles });

  const floorStatuses = records.map((record) => floorStatusOf(record));
  // Tầng mà MÁY CHỦ báo hỏng — lỗi đọc (503 một lượt) không phải "tầng gặp lỗi" (BUG-553).
  const failedIndexes = records
    .map((record, index) => (runStatusOf(record) === 'failed' ? index : -1))
    .filter((index) => index >= 0);
  const doneCount = floorStatuses.filter((status) => status === 'done').length;

  // Nhật ký N7b và trạng thái dự án (#24, dải "Đang xử lý bản vẽ" ở thanh trên) chỉ đọc lại theo
  // nhịp riêng: tầng vừa xong/lỗi thì đọc lại ngay, không còn "Đang chạy · 5%" khi đã xong (U27).
  const settledCount = doneCount + failedIndexes.length;
  const refetchRuns = runsQuery.refetch;
  useEffect(() => {
    if (settledCount === 0) return;
    void refetchRuns();
    void queryClient.invalidateQueries({ queryKey: queryKeys.project.detail(projectId) });
  }, [projectId, queryClient, refetchRuns, settledCount]);

  // Tổng kết đọc SAU khi tầng xong (BUG-285): lớp AI chỉ được ghi vào tài liệu tầng ở bước
  // cuối, nên đọc lúc mồi sẽ đếm lớp cũ — và một lượt xong qua SSE không đọc mồi lại.
  const extractionQueries = useQueries({
    queries: floorUploads.map((upload, index) => ({
      queryKey: [...queryKeys.progress.byFloor(upload.floorId), 'extraction', upload.uploadId] as const,
      queryFn: async (): Promise<ProcessingExtractionSummary | null> => {
        const extraction = await gateway.readExtractionSummary({ projectId, floorId: upload.floorId });
        return extraction.supported ? extraction.value : null;
      },
      enabled: floorStatuses[index] === 'done',
    })),
  });
  const extractions = extractionQueries.map((query) => query.data ?? undefined);
  // Lỗi đọc tạm không đẩy tầng đang xem sang tầng khác (không mở luồng thứ hai);
  // upload đã mất (404/403) thì nhường chỗ.
  const activeIndex = records.findIndex(
    (record) => record.failure?.isTerminal !== true && runStatusOf(record) === 'running',
  );

  // N7 hoặc #24 trả 404 `project`: dự án không có, không phải lỗi đọc tạm (BUG-312).
  const isProjectMissing =
    isProjectNotFound(latestUploadsQuery.error) || isProjectNotFound(projectQuery.error);

  const state = useMemo<ProcessingScreenState>(() => {
    if (isProjectMissing) return 'error';
    if (isReadPaused) return 'error';
    if (isLoading) return 'loading';
    if (hasEveryReadFailed) return 'error';
    if (!canEdit) return 'forbidden';
    // Nothing to lay out narrow: below 1024 px "no run" must still be the empty state with its
    // next step, not two empty columns (the dashboard's BUG-111, here).
    if (records.length === 0) return 'empty';
    if (doneCount >= records.length) return 'success';
    // Narrow but finished stays `success`: the view collapses the steps from `isCompact`
    // anyway, and `collapsed` would push the "Đã xong" summary below the preview (K5).
    if (isCompact) return 'collapsed';
    return 'partial';
  }, [canEdit, doneCount, hasEveryReadFailed, isCompact, isLoading, isProjectMissing, isReadPaused, records.length]);

  /* ---------------------------------------------------------------------- */
  /* Hành động.                                                              */
  /* ---------------------------------------------------------------------- */

  // Khuôn "ref mới nhất": nơi gọi truyền hàm mới mỗi lượt render vẫn không làm
  // các `useCallback` dưới đây đổi danh tính.
  const onNavigateRef = useRef(options.onNavigate);
  onNavigateRef.current = options.onNavigate;
  const onGoToSupportRef = useRef(options.onGoToSupport);
  onGoToSupportRef.current = options.onGoToSupport;

  const navigate = useCallback((path: string) => {
    onNavigateRef.current?.(path);
  }, []);

  const onTabChange = useCallback((tab: ProcessingPanelTab) => {
    setActiveTab(tab);
  }, []);

  const onToggleLogAutoScroll = useCallback(() => {
    setIsLogAutoScrollLocked((locked) => !locked);
  }, []);

  const logLines = useMemo<readonly ProcessingLogLineViewModel[]>(
    () =>
      records
        .flatMap((record, index) =>
          record.logLines.map((line) => ({ line, floorName: floorUploads[index]?.floorName })),
        )
        .map(({ line, floorName }) => ({
          id: line.id,
          timeLabel: formatClockTime(new Date(line.atIso)),
          // Nêu tầng để nhật ký tra được theo tầng (G3-26).
          text: floorName === undefined ? line.text : `${floorName}: ${line.text}`,
        })),
    [records, floorUploads],
  );

  const onCopyLog = useCallback(() => {
    void gateway.copyText(logLines.map((line) => `${line.timeLabel} ${line.text}`).join('\n')).then((copied) => {
      publish(
        copied
          ? { type: LOG_COPY_TYPE, title: COPY.logCopied, description: '' }
          : { type: LOG_COPY_TYPE, title: COPY.logCopyFailed, description: COPY.logCopyFailedDescription },
      );
    });
  }, [gateway, logLines, publish]);

  const onRetry = useCallback(() => {
    void queryClient.invalidateQueries({ queryKey: queryKeys.progress.latestUploads.root() });
    void queryClient.invalidateQueries({ queryKey: queryKeys.progress.byFloor.root() });
    // RV5 #3: header suy ra "xử lý lỗi" từ chi tiết dự án; thử lại thì đọc lại nó.
    void queryClient.invalidateQueries({ queryKey: queryKeys.project.detail(projectId) });
  }, [projectId, queryClient]);

  const onGoToSupport = useCallback(() => {
    const given = onGoToSupportRef.current;

    if (given !== undefined) {
      given();
      return;
    }

    navigate(ROUTES.account);
  }, [navigate]);

  const canCancel = gateway.supports.cancelProcessing && canEdit;
  // "Để chạy nền" hứa một thông báo: chỉ đưa ra khi còn lượt chưa cuối để mà báo (BUG-165).
  const canRunInBackground = records.some((record) => !isRunFinal(record));

  /** Màn rỗng chỉ ra bước kế: chưa có bản vẽ nào trong hàng đợi thì tải bản vẽ (BUG-165). */
  const onUploadDrawings = useCallback(() => {
    navigate(ROUTES.project.upload(projectId));
  }, [navigate, projectId]);

  const onOpenQuality = useCallback(() => {
    navigate(ROUTES.project.quality(projectId));
  }, [navigate, projectId]);

  const onBackToProjects = useCallback(() => {
    navigate(ROUTES.dashboard);
  }, [navigate]);

  const onRequestCancel = useCallback(() => {
    if (!canCancel) {
      return;
    }

    setIsCancelConfirming(true);
  }, [canCancel]);

  const onDismissCancel = useCallback(() => {
    setIsCancelConfirming(false);
  }, []);

  const onConfirmCancel = useCallback(() => {
    const uploads = uploadsRef.current;
    setIsCancelConfirming(false);

    uploads.forEach((upload) => {
      void gateway.requestCancel({ projectId, uploadId: upload.uploadId });
    });
  }, [gateway, projectId]);

  /**
   * "Để chạy nền và thông báo cho tôi".
   *
   * Không có lượt nào đang chạy thì KHÔNG hứa gì: đẩy một câu "sẽ báo cho bạn"
   * lúc màn ở trạng thái `empty` là hứa một thông báo không bao giờ tới.
   */
  const onRunInBackground = useCallback(() => {
    const uploads = uploadsRef.current;

    const watches = uploads.flatMap((upload): readonly BackgroundWatchEntry[] => {
      const id = watchIdOf(projectId, upload.uploadId);
      const subscription = subscriptionsRef.current.get(upload.uploadId);

      // Đã trong sổ (bấm lần hai) hoặc không có đăng ký nào. Tầng còn `pending` (upload đang
      // nhận) vẫn giao: nút chỉ hiện khi còn lượt chưa cuối, nên bỏ nó là bấm mà im (BUG-542).
      if (gateway.backgroundWatches.has(id) || subscription === undefined) {
        return [];
      }

      // Giao hẳn cho sổ: tháo màn không còn dừng nó.
      subscriptionsRef.current.delete(upload.uploadId);
      const release = subscription.stop;

      return [
        {
          id,
          label: upload.floorName,
          release,
          // Bao đóng, không phải state: nó chạy được sau khi màn đã tháo, vì cả
          // sổ lẫn bus đều sống ngoài cây React.
          onSettled: (outcome) => {
            publish(settledNotice(id, upload.floorName, outcome));
          },
        },
      ];
    });

    if (watches.length === 0) {
      return;
    }

    void gateway.runInBackground({ projectId, watches }).then((result) => {
      if (!result.supported) {
        return;
      }

      publish({
        type: BACKGROUND_STARTED_TYPE,
        title: COPY.backgroundStartedTitle,
        description: COPY.backgroundStartedDescription,
      });
    });
  }, [gateway, projectId, publish]);

  const onToggleDetail = useCallback((stepId: string) => {
    setOpenStepIds((open) =>
      open.includes(stepId) ? open.filter((id) => id !== stepId) : [...open, stepId],
    );
  }, []);

  /* ---------------------------------------------------------------------- */
  /* Viewmodel.                                                              */
  /* ---------------------------------------------------------------------- */

  /**
   * Sáu bước của TẦNG ĐANG CHẠY (không có thì tầng 1). Danh sách bước là một cây của một lượt
   * xử lý, và `types.ts` không có chỗ cho sáu bước nhân N tầng — dãy chip tầng ở trên mới là
   * nơi đọc tiến độ theo tầng; chip mang `aria-current` là chip của đúng tầng này (BUG-543).
   */
  const focusIndex = activeIndex >= 0 ? activeIndex : 0;
  const focusRecord = records[focusIndex];

  const floors = useMemo<readonly ProcessingFloorChipViewModel[]>(
    () =>
      floorUploads.map((upload, index) => {
        const status = floorStatuses[index] ?? 'queued';
        const objectCount = extractions[index];

        return {
          id: upload.floorId,
          label: upload.floorName,
          status,
          statusLabel: STATUS_LABELS[status],
          isActive: index === focusIndex,
          ...(objectCount?.scaleMissing === true
            ? { reviewLabel: SCALE_MISSING_LABEL, isScaleMissing: true }
            : objectCount?.readiness?.state === 'needsReview'
              ? { reviewLabel: NEEDS_REVIEW_LABEL }
              : {}),
          ...(objectCount !== undefined
            ? {
                objectCountLabel: countLabel(objectTotalOf(objectCount), UNIT.object),
              }
            : {}),
        };
      }),
    [extractions, floorStatuses, floorUploads, focusIndex],
  );

  /* ---------------------------------------------------------------------- */
  /* Đăng ký — tầng đang xem nghe SSE, tầng khác hỏi #8, tầng cuối thì không. */
  /* ---------------------------------------------------------------------- */

  // Trần một luồng: chừng nào sổ nền (cấp module, sống qua lần gắn lại màn) còn
  // giữ một upload chưa cuối của danh sách này, không tầng nào được SSE — sổ có
  // thể đang giữ chính luồng SSE. ponytail: không phân biệt mục sổ nghe SSE hay
  // hỏi #8, nên đôi khi tầng đang xem tụt xuống hỏi 5 s thay vì SSE.
  const isBackgroundStreamOpen = floorUploads.some((upload, index) => {
    const record = records[index];
    return (
      gateway.backgroundWatches.has(watchIdOf(projectId, upload.uploadId)) &&
      (record === undefined || !isRunFinal(record))
    );
  });

  const desiredModes = floorUploads.map((upload, index): SubscriptionMode => {
    const query = floorQueries[index];
    const record = records[index];

    if (query?.isError === true) return 'poll';
    // Chưa có #8 mồi: chưa biết tầng đã cuối hay chưa.
    if (query?.data === undefined || record === undefined) return 'none';
    if (isFinalStatus(record.progress?.status) || record.failure?.isTerminal === true) return 'none';
    // Mồi hỏng thì `dang-noi` của kênh hỏi ghi bản ghi rỗng vào đệm (query thành `success`): chưa
    // đọc được #8 lượt nào thì vẫn hỏi. Chuyển SSE lúc đó huỷ lượt đọc giữa thang 5xx của lib/http,
    // lượt huỷ không phải lỗi (BUG-574) và SSE không đọc #8 — lỗi đọc mất, alert không hiện (BUG-550).
    if (record.progress === undefined) return 'poll';
    return index === focusIndex && !isBackgroundStreamOpen ? 'sse' : 'poll';
  });
  const modesKey = floorUploads
    .map((upload, index) => `${upload.uploadId}:${desiredModes[index] ?? 'none'}`)
    .join('|');
  const desiredModesRef = useRef(desiredModes);
  desiredModesRef.current = desiredModes;

  const handlersFor = useCallback(
    (upload: ProcessingFloorUpload): SubscribeProgressHandlers => {
      const write = (change: (record: FloorProgressRecord) => FloorProgressRecord): void => {
        queryClient.setQueryData<FloorProgressRecord>(
          queryKeys.progress.byFloor(upload.floorId),
          (existing) =>
            change(existing?.uploadId === upload.uploadId ? existing : emptyRecord(upload)),
        );
      };
      const watchId = watchIdOf(projectId, upload.uploadId);

      return {
        onSnapshot: (snapshot) => {
          write((record) =>
            applySnapshot(record, snapshot.progress, snapshot.observedAtMs, snapshot.source, snapshot.eventId),
          );

          // Lượt bị thay: nhả khỏi sổ nền, không báo "gặp lỗi".
          if (isReloadProgress(snapshot.progress)) {
            gateway.backgroundWatches.release(watchId);
            return;
          }

          // Màn đã tháo (lượt trong sổ nền): chỉ lớp của tầng này cần đọc lại (R14).
          if (snapshot.progress.status === 'completed' && !mountedRef.current) {
            once(layerInvalidatedRef.current, upload.uploadId, () => {
              void queryClient.invalidateQueries({
                queryKey: queryKeys.layer.byFloor(projectId, upload.floorId),
              });
            });
          }

          // `settle` tự trả `false` cho một lượt KHÔNG chạy nền.
          const outcome = outcomeOf(snapshot.progress.status);

          if (outcome !== undefined) {
            gateway.backgroundWatches.settle(watchId, outcome);
          }
        },
        onConnectionChange: (state) => {
          write((record) => ({ ...record, connectionStatus: state.status, source: state.source }));
        },
        onFailure: (failure) => {
          write((record) => ({ ...record, failure }));
          // Upload đã mất: luồng đã đóng, nhả khỏi sổ nền (không báo, như nhóm `reload`).
          if (failure.isTerminal === true) gateway.backgroundWatches.release(watchId);
        },
      };
    },
    [gateway, projectId, queryClient],
  );

  // Tháo màn (hoặc đổi cổng/dự án): dừng mọi đăng ký còn trong `Map`. Mục đã
  // giao sổ nền không còn ở đây — sổ giữ chúng tới `settle`/`release`.
  useEffect(() => {
    const subscriptions = subscriptionsRef.current;
    mountedRef.current = true;

    return () => {
      mountedRef.current = false;
      subscriptions.forEach((subscription) => subscription.stop());
      subscriptions.clear();
    };
  }, [gateway, projectId]);

  // Đối chiếu: chỉ đổi upload có chế độ khác. Upload đang trong sổ nền thì
  // không dừng, không mở, không đổi chế độ.
  useEffect(() => {
    const subscriptions = subscriptionsRef.current;
    const wanted = new Map(
      uploadsRef.current.map((upload, index) => [
        upload.uploadId,
        { upload, mode: desiredModesRef.current[index] ?? 'none', record: recordsRef.current[index] },
      ]),
    );

    subscriptions.forEach((subscription, uploadId) => {
      if (wanted.get(uploadId)?.mode !== subscription.mode) {
        subscription.stop();
        subscriptions.delete(uploadId);
      }
    });

    wanted.forEach(({ upload, mode, record }) => {
      if (
        mode === 'none' ||
        subscriptions.has(upload.uploadId) ||
        gateway.backgroundWatches.has(watchIdOf(projectId, upload.uploadId))
      ) {
        return;
      }

      const status = record?.progress?.status;
      const input = {
        floorId: upload.floorId,
        projectId,
        uploadId: upload.uploadId,
        ...(status !== undefined ? { status } : {}),
      };
      const stop =
        mode === 'sse'
          ? gateway.subscribeProgress(input, handlersFor(upload))
          : gateway.pollProgress(input, handlersFor(upload));

      subscriptions.set(upload.uploadId, { mode, stop });
    });
  }, [gateway, handlersFor, modesKey, projectId]);

  /* ---------------------------------------------------------------------- */
  /* Vô hiệu: N7 khi lượt bị thay / upload mất; lớp khi tầng xong / bản vẽ mới. */
  /* ---------------------------------------------------------------------- */

  const invalidationKey = records
    .map((record) => `${record.uploadId}:${record.progress?.status ?? ''}:${record.progress?.error ?? ''}:${record.failure?.isTerminal === true ? 'gone' : ''}`)
    .join('|');

  useEffect(() => {
    const invalidateLayers = (upload: ProcessingFloorUpload): void => {
      once(layerInvalidatedRef.current, upload.uploadId, () => {
        void queryClient.invalidateQueries({ queryKey: queryKeys.layer.byFloor(projectId, upload.floorId) });
        void queryClient.invalidateQueries({ queryKey: queryKeys.layer.graph(projectId) });
      });
    };

    uploadsRef.current.forEach((upload, index) => {
      const record = recordsRef.current[index];
      const previousUploadId = seenUploadRef.current.get(upload.floorId);
      seenUploadRef.current.set(upload.floorId, upload.uploadId);

      if (previousUploadId !== undefined && previousUploadId !== upload.uploadId) {
        invalidateLayers(upload);
      }

      if (record === undefined || record.uploadId !== upload.uploadId) return;

      if (isReloadProgress(record.progress) || record.failure?.isTerminal === true) {
        once(reloadedRef.current, upload.uploadId, () => {
          void queryClient.invalidateQueries({ queryKey: queryKeys.progress.latestUploads(projectId) });
        });
      }

      if (record.progress?.status === 'completed') {
        invalidateLayers(upload);
      }
    });
  }, [floorsKey, invalidationKey, projectId, queryClient]);

  const steps = useMemo<readonly ProcessingStepViewModel[]>(() => {
    if (focusRecord === undefined) {
      return [];
    }

    const detailById = new Map(
      (focusRecord.stepDetails ?? []).map((detail) => [detail.stepId, detail]),
    );
    const remainingLabel = durationLabelOf(focusRecord.remainingSeconds);
    const stepError = describePipelineError(focusRecord.progress?.error);

    return focusRecord.stages.map((stage) => {
      const detail = detailById.get(stage.id);
      const isRunning = stage.status === 'running';
      const children = detail?.children?.map((child) => ({
        id: `${stage.id}.${child.stepId}`,
        name: STAGE_LABEL_BY_ID.get(child.stepId) ?? child.stepId,
        status: child.status,
        percent: child.percent,
        isScanning: child.status === 'running',
        detailLabels: child.detailLines,
        isDetailOpen: openStepIds.includes(`${stage.id}.${child.stepId}`),
        onToggleDetail: () => onToggleDetail(`${stage.id}.${child.stepId}`),
        ...(child.errorCode !== undefined
          ? {
              errorCode: child.errorCode,
              errorMessage: describePipelineError(child.errorCode).sentence,
            }
          : {}),
      }));

      return {
        id: stage.id,
        name: STAGE_LABEL_BY_ID.get(stage.id) ?? stage.id,
        status: stage.status,
        percent: stepPercentOf(stage),
        isScanning: isRunning,
        detailLabels: detail?.detailLines ?? [],
        isDetailOpen: openStepIds.includes(stage.id),
        onToggleDetail: () => onToggleDetail(stage.id),
        ...(isRunning && remainingLabel !== null
          ? { remainingLabel: remainingSentence(remainingLabel) }
          : {}),
        ...(stage.status === 'failed'
          ? {
              errorCode: detail?.errorCode ?? stepError.code,
              errorMessage: stepError.sentence,
            }
          : {}),
        ...(children !== undefined ? { children } : {}),
      };
    });
  }, [focusRecord, onToggleDetail, openStepIds]);

  const previewPanel = useMemo<ProcessingPreviewViewModel>(() => {
    const upload = floorUploads[focusIndex];

    if (upload === undefined || focusRecord === undefined) {
      return {
        altText: COPY.previewAltEmpty,
        isScanning: false,
        detectedGeometryPaths: EMPTY_GEOMETRY,
        activeFloorId: null,
      };
    }

    return {
      ...(upload.sourceImageUrl !== undefined ? { sourceImageUrl: upload.sourceImageUrl } : {}),
      altText: `${COPY.previewAltPrefix}${upload.floorName}`,
      isScanning: floorStatuses[focusIndex] === 'running',
      detectedGeometryPaths: focusRecord.detectedGeometryPaths ?? EMPTY_GEOMETRY,
      activeFloorId: upload.floorId,
    };
  }, [floorStatuses, floorUploads, focusIndex, focusRecord]);

  /**
   * Khối tổng kết hiện ngay khi một tầng xong — kể cả khi chưa đọc được con số (lỗi N16): hai lối
   * đi tiếp không được phụ thuộc vào số liệu, nếu không màn xong là ngõ cụt (BUG-285).
   */
  const summary = useMemo<ProcessingSummaryViewModel | undefined>(() => {
    const doneIndex = floorStatuses.indexOf('done');

    if (doneIndex < 0) {
      return undefined;
    }

    const parts = extractions.filter(
      (extraction): extraction is ProcessingExtractionSummary => extraction !== undefined,
    );
    // Hiệu chỉnh tỷ lệ dẫn tới đúng tầng thiếu tỷ lệ (0 chuỗi kích thước), không phải tầng xong đầu tiên.
    // Không có tầng thiếu hẳn tỷ lệ thì tới tầng tỷ lệ còn tạm (readiness `scaleUnresolved`, FIX-P0-15).
    const reasonsAt = (index: number): readonly ProcessingReviewReason[] => {
      const readiness = extractions[index]?.readiness;
      return readiness?.state === 'needsReview' ? readiness.reasons : [];
    };
    const firstDone = (match: (index: number) => boolean) =>
      floorStatuses.findIndex((status, index) => status === 'done' && match(index));
    const missingScaleIndex = firstDone(
      (index) => extractions[index]?.dimensionCount === 0 && extractions[index]?.hasScale !== true,
    );
    const noScaleIndex =
      missingScaleIndex >= 0
        ? missingScaleIndex
        : firstDone((index) => reasonsAt(index).includes('scaleUnresolved'));
    const reviewIndex = firstDone((index) =>
      reasonsAt(index).some((reason) => reason !== 'scaleUnresolved'),
    );
    const reviewReasons = [
      ...new Set(floorStatuses.flatMap((status, index) => (status === 'done' ? reasonsAt(index) : []))),
    ];
    const reviewChecks = [
      ...new Set(
        floorStatuses.flatMap((status, index) =>
          status === 'done' && reasonsAt(index).includes('geometrySuspect')
            ? (extractions[index]?.readiness?.checks ?? [])
            : [],
        ),
      ),
    ];
    const scaleEstimated = floorStatuses.some(
      (status, index) => status === 'done' && extractions[index]?.scaleEstimated === true,
    );
    // R9: tầng xong có tỷ lệ cần chú ý (ước lượng / chưa xác định) nói trước; không thì trạng thái của chính
    // tầng đang xem (không mượn nguồn "chuỗi kích thước" của tầng khác — e2e R9 mục 8), rồi tầng xong đầu.
    const doneExtractions = extractions.filter((_, index) => floorStatuses[index] === 'done');
    const focusedDone = floorStatuses[focusIndex] === 'done' ? extractions[focusIndex] : undefined;
    const scaleStateOwner =
      doneExtractions.find((extraction) => extraction?.scaleStateNeedsAttention === true) ??
      (focusedDone?.scaleStateLabel !== undefined ? focusedDone : undefined) ??
      doneExtractions.find((extraction) => extraction?.scaleStateLabel !== undefined);
    const goTo = (route: (projectId: string, floorId: string) => string, index = doneIndex) => () => {
      const upload = uploadsRef.current[index];

      if (upload !== undefined) {
        navigate(route(projectId, upload.floorId));
      }
    };
    const actions = {
      onReviewWalls: goTo(ROUTES.project.walls, reviewIndex < 0 ? doneIndex : reviewIndex),
      onCalibrateScale: goTo(ROUTES.project.scale, noScaleIndex < 0 ? doneIndex : noScaleIndex),
      onOpenViewer3d: () => navigate(ROUTES.project.viewer(projectId)),
      ...(reviewReasons.length > 0 ? { reviewReasons } : {}),
      ...(reviewChecks.length > 0 ? { reviewChecks } : {}),
      ...(scaleEstimated ? { scaleEstimated: true as const } : {}),
      ...(scaleStateOwner?.scaleStateLabel === undefined ? {} : { scaleStateLabel: scaleStateOwner.scaleStateLabel }),
      ...(scaleStateOwner?.scaleStateNote === undefined ? {} : { scaleStateNote: scaleStateOwner.scaleStateNote }),
    };

    if (parts.length === 0) {
      return { metricLabels: [], ...actions };
    }

    const total = parts.reduce(
      (accumulated, part) => ({
        wallCount: accumulated.wallCount + part.wallCount,
        openingCount: accumulated.openingCount + part.openingCount,
        furnitureCount: accumulated.furnitureCount + part.furnitureCount,
        dimensionCount: accumulated.dimensionCount + part.dimensionCount,
        roomCount: accumulated.roomCount + part.roomCount,
        roomOutlinesMm: [...accumulated.roomOutlinesMm, ...part.roomOutlinesMm],
        // Mọi tầng cùng một dự án nên cùng một ngưỡng; một tầng không đọc được cài đặt thì bỏ câu.
        confidenceThreshold:
          accumulated.confidenceThreshold === null ? null : part.confidenceThreshold,
        lowConfidenceCount: accumulated.lowConfidenceCount + part.lowConfidenceCount,
      }),
      {
        wallCount: 0,
        openingCount: 0,
        furnitureCount: 0,
        dimensionCount: 0,
        roomCount: 0,
        roomOutlinesMm: [],
        confidenceThreshold: parts[0]?.confidenceThreshold ?? null,
        lowConfidenceCount: 0,
      },
    );

    // UX-28: số đếm theo tầng đang xem (tiêu đề ghi tên tầng); chưa có số của tầng đó thì tổng mọi tầng.
    const focused = extractions[focusIndex];
    const isFocusedOnly = parts.length > 1 && focused !== undefined;
    const shown = isFocusedOnly ? focused : total;
    const shownParts = isFocusedOnly ? [focused] : parts;
    const proposedScaleNote = proposedScaleNoteOf(parts);

    const threshold =
      total.confidenceThreshold === null
        ? null
        : formatNumber(total.confidenceThreshold, { fractionDigits: 2 });

    return {
      metricLabels: [
        countLabel(shown.wallCount, UNIT.wall),
        // K52: cửa và nội thất ghi riêng — tổng gộp đã có cả tường, phòng nên đọc như nhóm thứ ba là sai.
        `${countLabel(shown.openingCount, UNIT.opening)}, ${countLabel(shown.furnitureCount, UNIT.furniture)}`,
        countLabel(shown.dimensionCount, UNIT.dimensionChain),
        countLabel(shown.roomCount, UNIT.room),
        shownParts.some((part) => part.hasScale === false)
          ? shownParts.some((part) => part.scaleMissing === true)
            ? 'Chưa có tỷ lệ'
            : SCALE_PROPOSED_LABEL
          : formatArea(totalArea(shown.roomOutlinesMm)),
      ],
      ...(total.dimensionCount !== 0
        ? {}
        : proposedScaleNote === null
          ? { noDimensionSentence: NO_DIMENSION_SENTENCE }
          : { scaleSourceNote: proposedScaleNote }),
      ...(parts.every((part) => part.hasScale === true) ? { scaleKnown: true } : {}),
      ...(threshold === null
        ? {}
        : {
            lowConfidenceSentence:
              total.lowConfidenceCount === 0
                ? noLowConfidenceSentence(threshold)
                : lowConfidenceSentence(formatNumber(total.lowConfidenceCount, { fractionDigits: 0 })),
          }),
      ...actions,
    };
  }, [extractions, floorStatuses, focusIndex, navigate, projectId]);

  const overallSummaryLine = useMemo(() => {
    if (records.length === 0) return uploadsPending ? LOADING_RUNS_SENTENCE : NO_RUN_SENTENCE;

    return doneFloorsSentence(
      formatNumber(doneCount, { fractionDigits: 0 }),
      formatNumber(records.length, { fractionDigits: 0 }),
    );
  }, [doneCount, records.length, uploadsPending]);

  const remainingLine = useMemo(() => {
    const slowest = records
      .map((record) => record.remainingSeconds)
      .filter((seconds): seconds is number => seconds !== null);
    const duration = slowest.length === 0 ? null : durationLabelOf(Math.max(...slowest));

    return duration === null ? undefined : overallRemainingSentence(duration);
  }, [records]);

  // `queueAhead` (BE gửi trong tiến độ) là số lượt đứng trước; 0 hoặc vắng thì không xếp hàng.
  const queuePosition =
    records.find((record) => record.queuePosition !== undefined)?.queuePosition ??
    records.map((record) => record.progress?.queueAhead).find((ahead): ahead is number => ahead !== undefined && ahead > 0);

  // U09: lúc xếp hàng đếm thời gian đã chờ mỗi giây, để màn không đứng yên hàng phút như treo.
  const isQueued = queuePosition !== undefined;
  const [queueClock, setQueueClock] = useState<{ readonly since: number; readonly now: number } | null>(null);
  useEffect(() => {
    if (!isQueued) return undefined;
    const since = Date.now();
    const timer = window.setInterval(() => {
      setQueueClock({ since, now: Date.now() });
    }, MILLISECONDS_PER_SECOND);
    return () => {
      window.clearInterval(timer);
      setQueueClock(null);
    };
  }, [isQueued]);
  const queueWaited = queueClock === null ? null : formatDuration(queueClock.now - queueClock.since);

  // U09: "Thường mất khoảng N phút" từ lịch sử lượt của dự án (hoặc cỡ ảnh). Không đếm ngược:
  // đã chạy quá ước lượng thì nói "Lâu hơn thường lệ" — nhịp 10 giây là đủ cho mốc phút.
  const [waitClock, setWaitClock] = useState<{ readonly since: number; readonly now: number } | null>(null);
  useEffect(() => {
    if (!canRunInBackground) return undefined;
    const since = Date.now();
    setWaitClock({ since, now: since });
    const timer = window.setInterval(() => {
      setWaitClock({ since, now: Date.now() });
    }, ESTIMATE_TICK_MS);
    return () => {
      window.clearInterval(timer);
      setWaitClock(null);
    };
  }, [canRunInBackground]);
  const estimateLine = useMemo(() => {
    if (waitClock === null) return undefined;
    // UX-29: chỉ lượt đã xong thật mới cho số phút. Chưa có lượt nào thì đoán cỡ ảnh chỉ được nói
    // "dưới 2 phút"; đoán lâu hơn từng ghi "4 phút" cho lượt xong sau 55 giây — thà không nói.
    const history = medianRunMinutes(runsQuery.data ?? []);
    const guess = sourceImageMegapixels === null ? null : minutesForMegapixels(sourceImageMegapixels);
    const minutes = history ?? (guess !== null && guess <= SHORT_GUESS_MINUTES ? SHORT_GUESS_MINUTES : null);
    if (minutes === null) return undefined;
    // Lượt đang chạy có trong N7b thì tính từ lúc nó được tạo; không thì từ lúc màn bắt đầu chờ.
    const uploadIds = new Set(floorUploads.map((upload) => upload.uploadId));
    const startedAt = (runsQuery.data ?? [])
      .filter(
        (run) =>
          uploadIds.has(run.uploadId) && (run.status === 'pending' || run.status === 'running'),
      )
      .map((run) => Date.parse(run.createdAt))
      .filter(Number.isFinite);
    const since = startedAt.length === 0 ? waitClock.since : Math.min(...startedAt);
    const elapsedMs = Math.max(0, waitClock.now - since);
    return history === null && elapsedMs <= minutes * MILLISECONDS_PER_MINUTE
      ? SHORT_GUESS_SENTENCE
      : estimateSentence(minutes, elapsedMs);
  }, [floorUploads, runsQuery.data, sourceImageMegapixels, waitClock]);

  const partialNoticeLine =
    failedIndexes.length > 0 && failedIndexes.length < records.length
      ? partialSentence(
          failedIndexes
            .map((index) => floorUploads[index]?.floorName ?? '')
            .filter((name) => name.length > 0)
            .join(', '),
          records.some((record, index) => !failedIndexes.includes(index) && !isRunFinal(record)),
        )
      : undefined;

  const errorAlert = useMemo<ProcessingErrorAlertViewModel | undefined>(() => {
    if (state !== 'error') {
      return undefined;
    }

    const failure =
      records.find((record) => record.failure !== undefined)?.failure ??
      gateway.describeApiFailure(firstReadError);

    if (isProjectMissing) {
      return {
        title: PROJECT_NOT_FOUND_TITLE,
        message: PROJECT_NOT_FOUND_DESCRIPTION,
        technicalCode: failure.technicalCode,
        onRetry,
        onGoToSupport,
        isProjectMissing: true,
        onBackToProjects,
      };
    }

    return {
      title: failure.title,
      message: failure.sentence,
      technicalCode: failure.technicalCode,
      onRetry,
      onGoToSupport,
    };
  }, [firstReadError, gateway, isProjectMissing, onBackToProjects, onGoToSupport, onRetry, records, state]);

  // Không bọc `useMemo`: `records` là mảng mới mỗi lượt render (cùng lý lẽ
  // `failedIndexes` ở trên), và một vòng `find` lồng `find` trên tối đa vài chục
  // phần tử là rẻ. Bản ghi ĐẦU TIÊN có một bước `'failed'` — không phải bản ghi
  // có `record.failure` (đó là lỗi đọc, đi ra qua `errorAlert` như cũ).
  // Lượt bị thay (`reload`) không phải bước hỏng. S-11 chỉ gắn khi MỌI tầng đã
  // cuối; còn tầng chạy thì giữ `partial` và bước hỏng hiện ở `steps[]`.
  const isEveryFloorFinal = records.every(isRunFinal);
  const failedIndex = records.findIndex(
    (record) => !isReloadProgress(record.progress) && record.stages.some((s) => s.status === 'failed'),
  );
  const failedRecord = records[failedIndex];
  const failedStage = failedRecord?.stages.find((s) => s.status === 'failed');
  // Lượt hỏng không mang mã (BE gửi `""` khi `error_code` rỗng): mã `PROCESSING` và câu "chưa phân
  // loại" của bảng mã pipeline — cùng mã mà `steps[]` hiện (BUG-549).
  const failureCode = describePipelineError(failedRecord?.progress?.error).code;

  const failedPipelineStep: ProcessingScreenFailedStep | undefined =
    !isEveryFloorFinal || failedRecord === undefined || failedStage === undefined
      ? undefined
      : {
          floorId: failedRecord.floorId,
          stepId: failedStage.id,
          failureCode,
          failureFloorName: floorUploads[failedIndex]?.floorName ?? failedRecord.floorId,
          failureFloors: floorUploads.map((upload, index) => ({
            floorId: upload.floorId,
            floorName: upload.floorName,
            status: floorStatuses[index] ?? 'queued',
          })),
          onResolved: onRetry,
        };

  return {
    state,
    floors,
    steps,
    previewPanel,
    logLines,
    ...(summary !== undefined ? { summary } : {}),
    overallSummaryLine,
    ...(remainingLine !== undefined
      ? { remainingLine }
      : estimateLine !== undefined && queuePosition === undefined
        ? { remainingLine: estimateLine }
        : {}),
    ...(queuePosition !== undefined
      ? {
          queueLine: queueSentence(
            formatNumber(queuePosition, { fractionDigits: 0 }),
            queueWaited,
            estimateLine,
          ),
        }
      : {}),
    ...(partialNoticeLine !== undefined ? { partialNoticeLine } : {}),
    ...(errorAlert !== undefined ? { errorAlert } : {}),
    ...(failedPipelineStep !== undefined ? { failedPipelineStep } : {}),
    activeTab,
    onTabChange,
    isLogAutoScrollLocked,
    onToggleLogAutoScroll,
    onCopyLog,
    canCancel,
    isCancelConfirming,
    onRequestCancel,
    onConfirmCancel,
    onDismissCancel,
    onRunInBackground,
    canRunInBackground,
    onUploadDrawings,
    onBackToProjects,
    onOpenQuality,
    ...(floorsWithoutDrawing !== undefined ? { floorsWithoutDrawing } : {}),
    ...(runs !== undefined ? { runs } : {}),
    isCompact,
    prefersReducedMotion,
    ...(knownProjectName !== null ? { projectName: knownProjectName } : {}),
  };
}
