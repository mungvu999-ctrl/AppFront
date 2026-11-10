import type { LibraryApi } from '@/api/client';

import { registerServerLibrary } from './furnitureCatalog';

/** Nguồn danh mục của lượt dựng: `server` hoặc `fallback:<lý do>` (danh mục đóng gói giữ nguyên). */
export type LibrarySource = 'server' | `fallback:${string}`;

export interface LibraryLoad {
  readonly count: number;
  readonly source: LibrarySource;
}

/** Câu báo khi đọc thư viện máy chủ HỎNG (không báo khi thư viện trống hay chưa có phiên). */
export const LIBRARY_FALLBACK_NOTICE = 'Chưa tải được thư viện nội thất, đang hiện mẫu dự phòng. Tải lại trang để thử lại.';

/** Dự phòng vì lượt đọc hỏng (người dùng cần biết) — khác dự phòng vì thư viện trống / chưa có phiên. */
export const libraryReadFailed = (source: LibrarySource): boolean =>
  source !== 'server' && source !== 'fallback:empty' && source !== 'fallback:no-session';

/**
 * Nạp thư viện nội thất máy chủ (`GET /api/library`) vào danh mục Pascal trước khi dựng cảnh.
 * Chờ ĐÚNG kết quả lượt đọc, không đua giờ riêng: nội dung cảnh không được phụ thuộc tốc độ máy/mạng.
 * Giới hạn thời gian là của client HTTP chung (`REQUEST_TIMEOUT_MS.default`, `src/lib/http/timeout.ts`);
 * hết giờ thì API trả `ok:false` kind `timeout` → dự phòng có lý do. Không bao giờ ném.
 */
export async function loadServerLibrary(api: Pick<LibraryApi, 'list'>): Promise<LibraryLoad> {
  try {
    const result = await api.list();
    if (!result.ok) return { count: 0, source: `fallback:${result.error.kind}` };
    const count = registerServerLibrary(result.data);
    return { count, source: count > 0 ? 'server' : 'fallback:empty' };
  } catch {
    return { count: 0, source: 'fallback:threw' };
  }
}
