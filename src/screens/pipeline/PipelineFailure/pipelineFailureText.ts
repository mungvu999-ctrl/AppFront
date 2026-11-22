/**
 * Mọi câu tiếng Việt của màn S-11 "Một bước AI hỏng", gom về một chỗ.
 *
 * Không phải bảng dịch lúc chạy — `src/i18n/vi.json` cũng không phải (CLAUDE.md,
 * mục "Trạng thái hiện tại"). Đây là chỗ `usePipelineFailure.ts` lấy chuỗi để ghép
 * vào `PipelineFailureProps`, đúng khuôn `cadBranchConfirmText.ts`.
 *
 * ## A15 — con số được định dạng Ở ĐÂY, không ở view
 *
 * Mọi câu mang số đi ra khỏi file này đã ghép xong: "Lần thử 2", "nhận diện cửa và
 * đồ đạc — 21 đối tượng". Số đi qua `formatNumber` của `src/lib/format/number` nên
 * dấu thập phân là **dấu phẩy**, và không có `toFixed`/`toLocaleString` nào ở tầng
 * giao diện (R-61, `local/no-raw-number`).
 *
 * ## A6 — viết thường, kiểu câu
 *
 * Ngoại lệ chữ hoa: mã lỗi và mã yêu cầu ({@link codeLabel}), giữ nguyên dạng máy
 * đọc để người dùng chép sang phiếu hỗ trợ. Tên tầng ("Tầng 03") là tên riêng do
 * tầng dữ liệu đặt; file này không viết hoa thêm gì.
 *
 * ## Không câu nào có chủ ngữ là người dùng
 *
 * Đây là điều kiện nghiệm thu cứng của màn, không phải lời khuyên. Chủ ngữ của ba
 * câu lỗi là **bước xử lý**, **bản vẽ**, **mô hình**, **hệ thống** — không bao giờ
 * là người đưa bản vẽ lên. Đọc to trước khi sửa bất cứ câu nào dưới đây.
 *
 * ## Tên bước lấy từ `PIPELINE_STAGES`, không gõ lại
 *
 * Nhãn sáu bước nằm ở `src/i18n/vi.json` khoá `pipeline` và ra ngoài qua
 * `getPipelineStages()` (R-61). File này chỉ NHẬN nhãn đã tra được rồi ghép câu.
 */

import { formatNumber } from '@/lib/format/number';

import type { PipelineFailureFloorStatus } from './types';

/* -------------------------------------------------------------------------- */
/* Câu tĩnh.                                                                   */
/* -------------------------------------------------------------------------- */

/** Chuỗi không phụ thuộc dữ liệu. Câu có tham số nằm ở phần hàm bên dưới. */
export const PIPELINE_FAILURE_TEXT = {
  /* -- Nút và nhãn -------------------------------------------------------- */
  retryLabel: 'Thử lại bước này',
  copyLabel: 'Sao chép',
  copiedLabel: 'Đã sao chép',
  copyCodeAriaLabel: 'Sao chép mã lỗi',
  copyLogAriaLabel: 'Sao chép nhật ký kỹ thuật',
  copyAllLogsAriaLabel: 'Sao chép toàn bộ nhật ký',
  technicalToggleLabel: 'Chi tiết kỹ thuật',
  collapseLabel: 'Thu gọn',
  expandLabel: 'Mở lại',
  uploadAgainLabel: 'Tải lại bản vẽ',
  continueLabel: 'Xem kết quả',
  stepperAriaLabel: 'Tiến độ lượt thử lại',

  /* -- Ba hướng đi tiếp ---------------------------------------------------- */
  retryLowerThresholdLabel: 'Thử lại với ngưỡng thấp hơn',
  // UX-39: tệp có thể là ảnh JPG/PNG (không có trang) — nói "tệp", không nói "trang".
  uploadClearerLabel: 'Chọn tệp khác hoặc tải bản vẽ rõ hơn',
  skipFloorLabel: 'Bỏ qua tầng đó',
  backToProjectsLabel: 'Về danh sách dự án',

  /**
   * Ngưỡng thấp hơn được gì và mất gì. Không phải cảnh báo mất mát của A9 — nó chỉ
   * nói ra cái đánh đổi, và hướng này hoàn tác được bằng một lượt thử lại nữa.
   */
  retryLowerThresholdWarning:
    'Ngưỡng thấp hơn nhận ra nhiều tường hơn, nhưng cũng nhận nhầm nhiều hơn.',
  /**
   * A8/A9 — "Bỏ qua tầng đó" là hành động mất mát: mô hình xuất ra sẽ thiếu hẳn
   * một tầng. Câu này là chỗ điều đó được nói ra TRƯỚC khi người dùng bấm.
   */
  skipFloorWarning: 'Mô hình sẽ thiếu tầng này. Các tầng còn lại vẫn dựng đủ.',
  /** Nối thêm vào câu trên khi `skipFloor` chưa có endpoint — nói thật, không khoá mờ. */
  skipFloorUnsupportedWarning:
    'Hệ thống chưa bỏ qua được một tầng, nên hướng này chưa dùng được.',

  /* -- Khối "Kết quả đã có" ------------------------------------------------ */
  keptWorkCaption: 'Những kết quả này đã được giữ lại. Chạy lại sẽ không xoá chúng.',
  keptWorkLine: 'Bản vẽ gốc và các thiết lập của bạn vẫn được giữ.',
  keptStepDone: 'Xong',

  /* -- Trạng thái rỗng ----------------------------------------------------- */
  idleMessage: 'Chưa có bước nào hỏng ở lượt xử lý này.',

  /* -- Câu lỗi khi chính lượt đọc hỏng ------------------------------------- */
  readFailureSummary: 'Không đọc được tiến độ của lượt xử lý này.',

  /* -- Câu lỗi khi tầng dữ liệu chưa có phần chi tiết một bước -------------- */
  detailUnsupportedCause:
    'Máy chủ chưa có phần trả chi tiết của riêng một bước, nên phần dưới chỉ hiện được những gì lượt xử lý đã ghi lại.',
  logUnsupportedLine: 'Máy chủ chưa có phần trả nhật ký kỹ thuật của một bước.',

  /* -- Bộ đếm lần thử ------------------------------------------------------ */
  /**
   * Chế độ hỗ trợ vì đã thử quá số lần. Chủ ngữ là **bước xử lý** và **bộ phận hỗ
   * trợ** — không phải người dùng.
   */
  supportAfterAttempts:
    'Bước này vẫn hỏng sau nhiều lần chạy lại. Hãy tải lại bản vẽ để chạy lượt mới; mã lỗi và nhật ký bên dưới có thể sao chép để lưu lại.',
  /**
   * Chế độ hỗ trợ vì hệ thống chưa chạy lại được riêng một bước. Đây là nhánh giao
   * diện THẬT cho khả năng `retryStep` chưa có endpoint — màn nói ra điều đó, thay
   * vì im lặng để một nút chết nằm trên màn.
   */
  supportRetryUnsupported:
    'Hệ thống chưa chạy lại được riêng một bước. Hãy tải lại bản vẽ để chạy lượt mới.',
} as const;

/* -------------------------------------------------------------------------- */
/* Trạng thái một tầng, thành lời (A6: viết thường, kiểu câu).                  */
/* -------------------------------------------------------------------------- */

export const PIPELINE_FAILURE_FLOOR_STATUS_LABELS: Readonly<
  Record<PipelineFailureFloorStatus, string>
> = {
  queued: 'đang chờ',
  running: 'Đang xử lý',
  done: 'đã xong',
  failed: 'hỏng',
};

/* -------------------------------------------------------------------------- */
/* Đơn vị đếm của khối "Kết quả đã có".                                        */
/* -------------------------------------------------------------------------- */

/**
 * Đơn vị của một con số đã giữ lại được, dạng máy đọc.
 *
 * Cổng dữ liệu trả mã đơn vị chứ không trả câu: một chuỗi "21 đối tượng" đi qua
 * tầng dữ liệu là thêm một chỗ nữa có thể sai chính tả, và nó khoá luôn khả năng
 * đổi cách xưng hô sau này.
 */
export type PipelineFailureCountUnit = 'object' | 'dimension' | 'room' | 'wall';

const COUNT_UNIT_WORDS: Readonly<Record<PipelineFailureCountUnit, string>> = {
  object: 'đối tượng',
  dimension: 'chuỗi',
  room: 'phòng',
  wall: 'tường',
};

/* -------------------------------------------------------------------------- */
/* Nguyên nhân, dạng máy đọc → đúng MỘT câu.                                   */
/* -------------------------------------------------------------------------- */

/**
 * Nguyên nhân bước hỏng, dạng máy đọc.
 *
 * Cùng lý lẽ với {@link PipelineFailureCountUnit}: tầng dữ liệu nói mã, file này
 * nói câu. Một mã lạ rơi vào `'unknown'` — không có nhánh nào lọt xuống chuỗi rỗng.
 */
export type PipelineFailureCauseCode =
  | 'thinStrokes'
  | 'noisyScan'
  | 'unreadableLayer'
  | 'lowContrast'
  | 'unknown';

const CAUSE_SENTENCES: Readonly<Record<PipelineFailureCauseCode, string>> = {
  thinStrokes:
    'Bản vẽ có nét quá mảnh và nhiều vết nhiễu, mô hình không tách được tường khỏi nội thất.',
  noisyScan: 'Bản quét có nhiều vết bẩn và bóng giấy, mô hình bắt nhầm chúng thành nét vẽ.',
  unreadableLayer:
    'Lớp tường trong bản vẽ trộn lẫn với lớp ghi chú, mô hình không tách được hai lớp.',
  lowContrast: 'Nét vẽ và nền có độ tương phản quá thấp, mô hình không dò ra được đường tường.',
  unknown: 'Mô hình không đọc được phần này của bản vẽ và chưa nói rõ được vì sao.',
};

/** Đúng một dòng nguyên nhân. Chủ ngữ là bản vẽ hoặc mô hình, không phải người dùng. */
export const causeSentence = (code: PipelineFailureCauseCode): string => CAUSE_SENTENCES[code];

/* -------------------------------------------------------------------------- */
/* Câu có tham số.                                                             */
/* -------------------------------------------------------------------------- */

/**
 * Câu tóm tắt của khối lỗi — ví dụ "Bước tách lớp tường ở Tầng 03 không hoàn tất
 * được.".
 *
 * Chủ ngữ là BƯỚC XỬ LÝ. Không có "bạn", không có "bản vẽ của bạn".
 */
export const summarySentence = (stepLabel: string, floorLabel: string): string =>
  `Bước ${stepLabel} ở ${floorLabel} không hoàn tất được.`;

/**
 * Câu tóm tắt khi chưa đọc được chi tiết của bước — ví dụ "Chưa đọc được chi tiết
 * bước hỏng ở Tầng 03.".
 */
export const detailUnsupportedSummary = (floorLabel: string): string =>
  `Chưa đọc được chi tiết bước hỏng ở ${floorLabel}.`;

/**
 * Mã lỗi và mã yêu cầu, ĐÃ GHÉP — ví dụ "SEG-2041 · yêu cầu 8f2a-41".
 *
 * `requestId` rỗng là chuyện có thật (`AppError.requestId` là chuỗi rỗng khi lỗi
 * không mang mã yêu cầu nào — `toAppError.ts:71-82`), và câu trả lời đúng là bỏ hẳn
 * nửa sau chứ không in "yêu cầu " rồi để trống. Mã lỗi thì luôn có mặt, nên chuỗi
 * này không bao giờ rỗng.
 */
export const codeLabel = (code: string, requestId: string): string =>
  requestId.length > 0 ? `${code} · yêu cầu ${requestId}` : code;

/** Một dòng kết quả đã giữ, đã ghép cả số — ví dụ "đọc kích thước — 34 chuỗi". */
export const keptItemLabel = (
  stepLabel: string,
  count: number | undefined,
  unit: PipelineFailureCountUnit | undefined,
): string => {
  if (count === undefined || unit === undefined) {
    return `${stepLabel} — ${PIPELINE_FAILURE_TEXT.keptStepDone}`;
  }

  return `${stepLabel} — ${formatNumber(count, { fractionDigits: 0 })} ${COUNT_UNIT_WORDS[unit]}`;
};

/** Bộ đếm lần thử — ví dụ "Lần thử 2". View không nhận số rồi tự ghép. */
export const attemptLabel = (attempt: number): string =>
  `Lần thử ${formatNumber(attempt, { fractionDigits: 0 })}`;

/** Câu nói ra rằng dải vừa đổi nội dung — ví dụ "Đang chạy lại bước tách lớp tường ở Tầng 03.". */
export const retryingLiveMessage = (stepLabel: string, floorLabel: string): string =>
  `Đang chạy lại bước ${stepLabel} ở ${floorLabel}.`;

/** Câu cho lượt đọc đầu tiên, khi chưa biết bước nào hỏng. */
export const readingLiveMessage = (floorLabel: string): string =>
  `Đang đọc chi tiết bước hỏng ở ${floorLabel}.`;

/** Toast của dải đã hoà tan — ví dụ "Đã chạy xong bước tách lớp tường ở Tầng 03.". */
export const resolvedToastMessage = (stepLabel: string, floorLabel: string): string =>
  `Đã chạy xong bước ${stepLabel} ở ${floorLabel}.`;

/**
 * Câu tóm tắt một dòng của trạng thái thu gọn — ví dụ "Tầng 03 hỏng ở bước tách lớp
 * tường · SEG-2041".
 *
 * Chỉ mã lỗi, không kèm mã yêu cầu: dòng này phải lọt một dòng trên màn hẹp, và mã
 * yêu cầu vẫn còn nguyên trong khối lỗi khi mở lại.
 */
export const collapsedSummaryLine = (
  floorLabel: string,
  stepLabel: string,
  code: string,
): string => `${floorLabel} hỏng ở bước ${stepLabel} · ${code}`;

/** Nhãn trình đọc màn hình của nút thử lại — ví dụ "Thử lại bước tách lớp tường". */
export const retryStepAriaLabel = (stepLabel: string): string => `Thử lại bước ${stepLabel}`;
