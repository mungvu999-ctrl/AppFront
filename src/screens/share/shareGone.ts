import { readWireError } from '@/lib/errors/wireError';

export const SHARE_LINK_GONE_MESSAGE = 'Liên kết không còn hiệu lực';

export function isNotFound(error: unknown): boolean {
  return typeof error === 'object' && error !== null && 'status' in error && error.status === 404;
}

/**
 * U59: 404 của máy chủ có thể kèm `reason: "revoked" | "expired"` (thân lỗi, `raw`). Có thì nói đúng
 * lý do; vắng (token lạ, hoặc máy chủ cũ) thì giữ câu gộp.
 */
export function shareGoneReason(error: unknown): string {
  const raw = typeof error === 'object' && error !== null && 'raw' in error ? error.raw : null;
  const reason = typeof raw === 'object' && raw !== null && 'reason' in raw ? raw.reason : null;
  if (reason === 'revoked') {
    return 'Người chia sẻ đã thu hồi liên kết này. Hãy xin họ một liên kết mới nếu vẫn cần xem.';
  }
  if (reason === 'expired') {
    return 'Liên kết đã hết hạn. Hãy xin người chia sẻ một liên kết mới.';
  }
  return 'Liên kết đã hết hạn, đã bị thu hồi hoặc không đúng. Hãy xin người chia sẻ một liên kết mới.';
}

/** Loại lỗi mở liên kết chia sẻ, để mỗi loại nói đúng một câu (404 chung một câu từng nuốt cả 429/mạng/5xx). */
export type ShareErrorKind = 'gone' | 'rateLimited' | 'network' | 'server' | 'other';

export function shareErrorKind(error: unknown): ShareErrorKind {
  if (isNotFound(error)) return 'gone';
  const status = readWireError(error)?.status;
  if (status === 429) return 'rateLimited';
  if (status !== undefined && status >= 500) return 'server';
  const kind = typeof error === 'object' && error !== null && 'kind' in error ? error.kind : null;
  if (kind === 'network' || kind === 'timeout') return 'network';
  return 'other';
}

export interface ShareErrorCopy {
  readonly title: string;
  readonly body: string;
  /** Thử lại có thể thành công (mọi loại trừ liên kết đã hỏng/hết hạn). */
  readonly retryable: boolean;
}

export function shareErrorCopy(error: unknown): ShareErrorCopy {
  const kind = shareErrorKind(error);
  switch (kind) {
    case 'gone':
      return { title: SHARE_LINK_GONE_MESSAGE, body: shareGoneReason(error), retryable: false };
    case 'rateLimited': {
      const seconds = readWireError(error)?.retryAfterSeconds;
      return {
        title: 'Có quá nhiều lượt mở liên kết',
        body:
          seconds === undefined
            ? 'Liên kết đang được mở quá nhiều lần. Chờ một lúc rồi bấm Thử lại.'
            : `Liên kết đang được mở quá nhiều lần. Chờ khoảng ${String(seconds)} giây rồi bấm Thử lại.`,
        retryable: true,
      };
    }
    case 'network':
      return { title: 'Mất kết nối', body: 'Không kết nối được tới máy chủ. Kiểm tra mạng rồi bấm Thử lại.', retryable: true };
    case 'server':
      return { title: 'Máy chủ đang bận', body: 'Máy chủ chưa trả lời được lúc này. Chờ một lúc rồi bấm Thử lại.', retryable: true };
    default:
      return { title: 'Không mở được liên kết', body: 'Chưa mở được liên kết này. Bấm Thử lại, hoặc xin người chia sẻ một liên kết mới nếu vẫn lỗi.', retryable: true };
  }
}
