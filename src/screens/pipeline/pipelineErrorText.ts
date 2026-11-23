/**
 * `Progress.error` (mã máy chủ, BE-cho-FE §3.1) → một câu tiếng Việt và một
 * hành động. Thuần: không React, không `src/api`, không `vi.json`.
 *
 * Chủ ngữ của mọi câu là bước, bản vẽ, mô hình hay hệ thống — không bao giờ là
 * người dùng (cùng luật `PipelineFailure/pipelineFailureText.ts`). Câu không chứa
 * mã: mã đi riêng, để sao chép.
 */

import { APP_ERROR_KIND_CONFIG } from '@/lib/errors/kinds';

/** Việc nên làm tiếp với một lượt hỏng. */
export type PipelineErrorAction = 'reupload' | 'retry' | 'contactAdmin' | 'reload';

/** 28 mã của bảng BE-cho-FE §3.1 cộng `NOT_A_FLOOR_PLAN` (bước tách tường), theo thứ tự bốn nhóm hành động. */
export const PIPELINE_ERROR_CODES = [
  'PIPELINE_SUPERSEDED',
  'FLOOR_DELETED',
  'PIPELINE_STALLED',
  'PIPELINE_STEP_TIMEOUT',
  'PIPELINE_ARTIFACT_MISSING',
  'GPU_LOCK_LOST',
  'RETRY_EXHAUSTED',
  'TASK_TIMEOUT',
  'WORKER_LOST',
  'FILE_CORRUPT',
  'IMAGE_TOO_LARGE',
  'PDF_UNREADABLE',
  'FILE_TYPE_MISMATCH',
  'VALIDATION',
  'CAD_NOT_SUPPORTED',
  'PIPELINE_ARTIFACT_INVALID',
  'PIPELINE_BUILD_INVALID',
  'NOT_A_FLOOR_PLAN',
  'MODEL_PIN_MISMATCH',
  'PIPELINE_RESULT_INVALID',
  'LAYER_INTEGRITY_BROKEN',
  'LAYER_LEVEL_MISMATCH',
  'REVIEW_BY_AI_FORBIDDEN',
  'MODEL_CHECKSUM_MISMATCH',
  'MODEL_FORMAT_UNSUPPORTED',
  'MODEL_NOT_FOUND',
  'MODEL_VERSION_FAMILY_MISMATCH',
  'ML_DEVICE_UNAVAILABLE',
  'INTERNAL',
] as const;

type PipelineErrorCode = (typeof PIPELINE_ERROR_CODES)[number];

const TABLE = {
  // reload — lượt này đã bị thay; đọc lại N7, không màn lỗi.
  PIPELINE_SUPERSEDED: ['reload', 'Lượt xử lý này đã được thay bằng một lượt mới hơn.'],
  FLOOR_DELETED: ['reload', 'Tầng của lượt xử lý này đã bị xoá.'],
  // retry — lỗi tạm; chạy lại cả lượt từ bản gốc đã lưu (K-06), không được thì tải lại bản vẽ.
  PIPELINE_STALLED: ['retry', 'Bước xử lý dừng lại quá lâu mà không tiến thêm.'],
  PIPELINE_STEP_TIMEOUT: ['retry', 'Bước xử lý chạy quá thời gian cho phép.'],
  PIPELINE_ARTIFACT_MISSING: ['retry', 'Hệ thống không tìm thấy kết quả trung gian của bước trước.'],
  GPU_LOCK_LOST: ['retry', 'Hệ thống mất quyền dùng bộ xử lý đồ hoạ giữa chừng.'],
  RETRY_EXHAUSTED: ['retry', 'Bước xử lý đã thử lại hết số lần cho phép.'],
  TASK_TIMEOUT: ['retry', 'Tác vụ xử lý chạy quá thời gian cho phép.'],
  WORKER_LOST: ['retry', 'Máy xử lý ngừng phản hồi giữa chừng.'],
  // reupload — do tệp hoặc dữ liệu.
  FILE_CORRUPT: ['reupload', 'Tệp bản vẽ bị hỏng nên không mở được.'],
  IMAGE_TOO_LARGE: ['reupload', 'Ảnh bản vẽ lớn hơn kích thước hệ thống nhận.'],
  PDF_UNREADABLE: ['reupload', 'Tệp PDF không đọc được.'],
  FILE_TYPE_MISMATCH: ['reupload', 'Nội dung tệp không khớp với loại tệp đã khai.'],
  VALIDATION: ['reupload', 'Bản vẽ có trang sai hoặc nhiều hơn 20 trang.'],
  CAD_NOT_SUPPORTED: ['reupload', 'Hệ thống chưa nhận tệp CAD ở bước này.'],
  PIPELINE_ARTIFACT_INVALID: ['reupload', 'Kết quả trung gian dựng từ bản vẽ không hợp lệ.'],
  PIPELINE_BUILD_INVALID: ['reupload', 'Mô hình dựng từ bản vẽ không hợp lệ.'],
  NOT_A_FLOOR_PLAN: ['reupload', 'Ảnh tải lên không giống bản vẽ mặt bằng: hệ thống không nhận ra đủ tường. Đây có vẻ là ảnh phối cảnh 3D, không phải mặt bằng nhìn từ trên xuống. Hãy chọn bản vẽ khác.'],
  // contactAdmin — cần sửa hệ thống.
  MODEL_PIN_MISMATCH: ['contactAdmin', 'Phiên bản mô hình đang chạy không khớp với phiên bản đã ghim.'],
  PIPELINE_RESULT_INVALID: ['contactAdmin', 'Kết quả xử lý không qua được bước kiểm tra của hệ thống.'],
  LAYER_INTEGRITY_BROKEN: ['contactAdmin', 'Dữ liệu lớp của tầng không còn toàn vẹn.'],
  LAYER_LEVEL_MISMATCH: ['contactAdmin', 'Dữ liệu lớp không khớp với tầng đang xử lý.'],
  REVIEW_BY_AI_FORBIDDEN: ['contactAdmin', 'Hệ thống không cho mô hình ghi vào phần đã duyệt.'],
  MODEL_CHECKSUM_MISMATCH: ['contactAdmin', 'Tệp mô hình không khớp mã kiểm tra.'],
  MODEL_FORMAT_UNSUPPORTED: ['contactAdmin', 'Định dạng tệp mô hình chưa được hỗ trợ.'],
  MODEL_NOT_FOUND: ['contactAdmin', 'Hệ thống không tìm thấy mô hình cần dùng.'],
  MODEL_VERSION_FAMILY_MISMATCH: ['contactAdmin', 'Phiên bản mô hình không thuộc đúng dòng mô hình.'],
  ML_DEVICE_UNAVAILABLE: ['contactAdmin', 'Hệ thống không có thiết bị xử lý mô hình sẵn sàng.'],
  INTERNAL: ['contactAdmin', 'Hệ thống gặp lỗi nội bộ khi xử lý.'],
} as const satisfies Readonly<Record<PipelineErrorCode, readonly [PipelineErrorAction, string]>>;

const FALLBACK_SENTENCE = 'Bước xử lý gặp lỗi mà hệ thống chưa phân loại được.';

export interface PipelineErrorDescription {
  /** Mã giữ nguyên để sao chép; vắng thì là mã `processing` của bảng lỗi chung. */
  readonly code: string;
  readonly sentence: string;
  readonly action: PipelineErrorAction;
  readonly isKnown: boolean;
}

const isKnownCode = (code: string): code is PipelineErrorCode => Object.prototype.hasOwnProperty.call(TABLE, code);

export function describePipelineError(code: string | undefined): PipelineErrorDescription {
  const resolved = code ?? APP_ERROR_KIND_CONFIG.processing.code;

  if (!isKnownCode(resolved)) {
    return { code: resolved, sentence: FALLBACK_SENTENCE, action: 'contactAdmin', isKnown: false };
  }

  const [action, sentence] = TABLE[resolved];
  return { code: resolved, sentence, action, isKnown: true };
}
