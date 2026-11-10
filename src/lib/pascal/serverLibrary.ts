import type { ApiError, LibraryApi } from '@/api/client';
import { readWireError } from '@/lib/errors/wireError';

import { registerServerLibrary } from './furnitureCatalog';

/** Nguồn danh mục của lượt dựng: `server` hoặc `fallback:<lý do>` (danh mục đóng gói giữ nguyên). */
export type LibrarySource = 'server' | `fallback:${string}`;

export interface LibraryLoad {
  readonly count: number;
  readonly source: LibrarySource;
}

/** Câu báo khi đọc thư viện máy chủ HỎNG (không báo khi thư viện trống hay chưa có phiên). */
export const LIBRARY_FALLBACK_NOTICE = 'Chưa tải được thư viện nội thất, đang hiện mẫu dự phòng. Tải lại trang để thử lại.';

/**
 * 403/404 = máy chủ trả lời rõ "không được phép / không có" (vai chỉ đọc, tính năng tắt), KHÔNG phải lỗi tải:
 * dùng dự phòng nhưng không báo. Chỉ mạng/hết hạn/5xx/giải mã mới là "chưa tải được".
 */
export const absenceOf = (error: ApiError): 'forbidden' | 'notFound' | undefined => {
  const status = readWireError(error)?.status;
  if (error.kind === 'forbidden' || status === 403) return 'forbidden';
  if (error.kind === 'notFound' || status === 404) return 'notFound';
  return undefined;
};

/** Nguồn dự phòng không cần báo: thư viện trống, chưa có phiên, không được phép, không có. */
const QUIET_FALLBACKS: ReadonlySet<string> = new Set(['fallback:empty', 'fallback:no-session', 'fallback:forbidden', 'fallback:notFound']);

/** Dự phòng vì lượt đọc hỏng (người dùng cần biết). */
export const libraryReadFailed = (source: LibrarySource): boolean => source !== 'server' && !QUIET_FALLBACKS.has(source);

/**
 * Nạp thư viện nội thất máy chủ (`GET /api/library`) vào danh mục Pascal trước khi dựng cảnh.
 * Chờ ĐÚNG kết quả lượt đọc, không đua giờ riêng: nội dung cảnh không được phụ thuộc tốc độ máy/mạng.
 * Giới hạn thời gian là của client HTTP chung (`REQUEST_TIMEOUT_MS.default`, `src/lib/http/timeout.ts`);
 * hết giờ thì API trả `ok:false` kind `timeout` → dự phòng có lý do. Không bao giờ ném.
 */
export async function loadServerLibrary(api: Pick<LibraryApi, 'list'>): Promise<LibraryLoad> {
  try {
    const result = await api.list();
    if (!result.ok) return { count: 0, source: `fallback:${absenceOf(result.error) ?? result.error.kind}` };
    const count = registerServerLibrary(result.data);
    return { count, source: count > 0 ? 'server' : 'fallback:empty' };
  } catch {
    return { count: 0, source: 'fallback:threw' };
  }
}
