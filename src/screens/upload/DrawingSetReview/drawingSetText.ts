/**
 * Chữ của màn "Tải cả bộ hồ sơ" — câu cho lỗi, giới hạn và tệp bị từ chối. Thuần (không React).
 *
 * Lỗi đến dưới dạng lỗi dây (`HttpError`); mã dây là thứ màn rẽ nhánh theo (`readWireError`), câu chung của
 * `describeError` chỉ là lưới đỡ cho mã không có câu riêng. Không câu nào hứa điều chưa có (K-10, R-69).
 */

import { DRAWING_SET_ERROR_CODES, DRAWING_SET_LIMITS } from '@/api/schemas/drawingSet';
import { describeError, toAppError } from '@/lib/errors';
import { readWireError } from '@/lib/errors/wireError';
import { formatFileSize } from '@/lib/format/bytes';
import { formatNumber } from '@/lib/format/number';
import type { DrawingSetBatchIssue } from '@/lib/upload/drawingSetUpload';
import type { UploadRejection } from '@/lib/upload/validate';

const count = (value: number): string => formatNumber(value, { fractionDigits: 0 });

/** Điều người duyệt cần làm tiếp sau một lỗi: `disabled` = ẩn mọi thao tác; `stale` = đã tải lại bản mới. */
export type DrawingSetFailureKind = 'disabled' | 'stale' | 'floorIdTaken' | 'other';

export interface DrawingSetFailure {
  readonly kind: DrawingSetFailureKind;
  readonly sentence: string;
}

export const DISABLED_SENTENCE = 'Tính năng tải cả bộ hồ sơ đang tắt cho dự án này.';
export const NO_PLAN_SENTENCE = 'Chọn tầng cho ít nhất một hình mặt bằng rồi mới xác nhận được.';
const CAD_SENTENCE = 'Bản vẽ CAD (.dwg) chưa được hỗ trợ; hãy xuất sang PDF rồi tải lại.';

/** Câu theo mã lỗi tệp của máy chủ (cùng bộ mã với màn tải một tệp, U29). */
export const FILE_CODE_SENTENCES: ReadonlyMap<string, string> = new Map([
  ['CAD_NOT_SUPPORTED', CAD_SENTENCE],
  ['PDF_ENCRYPTED', 'PDF có mật khẩu nên không mở được. Hãy bỏ mật khẩu rồi tải lại.'],
  ['FILE_TYPE_MISMATCH', 'Nội dung tệp không khớp đuôi tệp: đây không phải ảnh hay PDF thật.'],
  ['PDF_UNREADABLE', 'Không đọc được tệp PDF này. Hãy xuất lại PDF.'],
  ['FILE_CORRUPT', 'Tệp bị hỏng, không đọc được.'],
  ['IMAGE_TOO_LARGE', 'Ảnh quá lớn để xử lý. Hãy giảm độ phân giải ảnh rồi tải lại.'],
  ['PDF_EMPTY', 'PDF không có trang nào.'],
]);

const FILE_FALLBACK = 'Máy không nhận tệp này.';

/** N60 từ chối vì khối ngôi nhà chưa yên (NHA-06): `field` của 422 `VALIDATION` → việc người duyệt phải làm. */
const BUILDING_BLOCK_SENTENCES: ReadonlyMap<string, string> = new Map([
  ['building.decisions', 'Có giá trị đã nhập cho tầng hoặc mái của một hình không còn trong bản duyệt. Hãy bỏ giá trị đó rồi xác nhận lại.'],
  ['building.conflicts', 'Còn mâu thuẫn giữa các nguồn chưa được chọn. Hãy chọn nguồn đúng rồi xác nhận lại.'],
  ['building.violations', 'Thông số tầng hoặc mái còn lỗi. Hãy sửa rồi xác nhận lại.'],
  ['building.warnings', 'Còn cảnh báo chưa xem. Hãy xem hết các cảnh báo rồi xác nhận lại.'],
]);

/** "ten-tep.pdf: Tệp bị hỏng, không đọc được." — báo đúng tên tệp. */
export const rejectedFileSentence = (fileName: string, code: string | undefined): string =>
  `${fileName}: ${(code === undefined ? undefined : FILE_CODE_SENTENCES.get(code)) ?? FILE_FALLBACK}`;

export function describeDrawingSetFailure(error: unknown): DrawingSetFailure {
  const wire = readWireError(error);
  const sentence = (text: string, kind: DrawingSetFailureKind = 'other'): DrawingSetFailure => ({ kind, sentence: text });

  switch (wire?.code) {
    case DRAWING_SET_ERROR_CODES.disabled:
      return sentence(DISABLED_SENTENCE, 'disabled');
    case DRAWING_SET_ERROR_CODES.notReceiving:
      return sentence('Bộ hồ sơ này không còn nhận thêm tệp.');
    case DRAWING_SET_ERROR_CODES.notReady:
      return sentence('Máy chưa đọc xong bộ hồ sơ này.');
    case DRAWING_SET_ERROR_CODES.confirmed:
      return sentence('Bộ hồ sơ này đã được xác nhận, không sửa được nữa.');
    case DRAWING_SET_ERROR_CODES.revisionStale:
    case 'VERSION_CONFLICT':
      return sentence('Bộ hồ sơ vừa đổi ở nơi khác. Màn đã tải lại bản mới nhất, hãy xem lại rồi tiếp tục.', 'stale');
    case DRAWING_SET_ERROR_CODES.floorHasDrawing:
      return sentence('Một tầng đã có bản vẽ. Chọn “Thay bản vẽ cũ” hoặc chọn tầng khác.');
    case DRAWING_SET_ERROR_CODES.floorIdTaken:
      return sentence('Mã của một tầng mới bị trùng. Bấm xác nhận lại để máy cấp mã khác.', 'floorIdTaken');
    case DRAWING_SET_ERROR_CODES.noPlan:
      return sentence(NO_PLAN_SENTENCE);
    case DRAWING_SET_ERROR_CODES.tooManyPages:
      return sentence(`Bộ hồ sơ vượt ${count(DRAWING_SET_LIMITS.maxPages)} trang. Hãy bớt tệp hoặc trang rồi tải lại.`);
    case 'CAD_NOT_SUPPORTED':
      return sentence(CAD_SENTENCE);
    default:
  }
  const blocked = wire?.code === 'VALIDATION' && wire.field !== undefined ? BUILDING_BLOCK_SENTENCES.get(wire.field) : undefined;

  if (blocked !== undefined) return sentence(blocked);
  if (wire?.status === 429) {
    return sentence('Bạn tải quá nhiều bộ hồ sơ trong thời gian ngắn. Đợi vài phút rồi thử lại.');
  }

  return sentence(describeError(toAppError(error)).description);
}

/** Một tệp không nhận được ngay trên máy (trước khi gửi). */
export function rejectionSentence(fileName: string, reason: UploadRejection): string {
  switch (reason.kind) {
    case 'tooLarge':
      return `${fileName}: lớn hơn ${formatFileSize(reason.maxSizeBytes)}, quá mức cho một tệp.`;
    case 'unsupportedFormat':
      return reason.extension === '.dwg'
        ? `${fileName}: ${CAD_SENTENCE}`
        : `${fileName}: chỉ nhận PDF, PNG hoặc JPEG.`;
    case 'tooManyPages':
      return `${fileName}: ${count(reason.pageCount)} trang, mỗi PDF tối đa ${count(reason.maxPageCount)} trang.`;
    case 'unreadable':
      return `${fileName}: không đọc được tệp này.`;
  }
}

/** Điều làm cả bộ vượt giới hạn, nói kèm con số đang có và cách gỡ. */
export function batchIssueSentence(issue: DrawingSetBatchIssue): string {
  switch (issue.kind) {
    case 'tooManyFiles':
      return `Bộ có ${count(issue.count)} tệp, tối đa ${count(issue.max)} tệp. Hãy bỏ bớt tệp.`;
    case 'tooManyBytes':
      return `Cả bộ nặng ${formatFileSize(issue.bytes)}, tối đa ${formatFileSize(issue.max)}. Hãy bỏ bớt tệp.`;
    case 'tooManyPages':
      return `Cả bộ có ${count(issue.pages)} trang, tối đa ${count(issue.max)} trang. Hãy bỏ bớt tệp hoặc trang.`;
  }
}

export const LIMITS_LINE = `PDF, PNG hoặc JPEG. Tối đa ${count(DRAWING_SET_LIMITS.maxFiles)} tệp, mỗi PDF ${count(
  DRAWING_SET_LIMITS.maxPagesPerPdf,
)} trang, cả bộ ${count(DRAWING_SET_LIMITS.maxPages)} trang và ${formatFileSize(DRAWING_SET_LIMITS.maxBytes)}.`;
