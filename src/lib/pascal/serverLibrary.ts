import type { ApiError, LibraryItem } from '@/api/client';
import {
  LIBRARY_REVISION_UNSTABLE,
  LIBRARY_TOO_MANY_PAGES,
  readAllLibraryPages,
  type LibraryListApi,
  type LibraryListing,
} from '@/api/libraryPages';
import { readWireError } from '@/lib/errors/wireError';

import { registerServerLibrary, type ServerLibraryModel } from './furnitureCatalog';

/** Nguồn danh mục của lượt dựng: `server` hoặc `fallback:<lý do>` (danh mục đóng gói giữ nguyên). */
export type LibrarySource = 'server' | `fallback:${string}`;

export interface LibraryLoad {
  readonly count: number;
  readonly source: LibrarySource;
  /** Phiên bản thư viện: băm ổn định (id + kích thước + đường dẫn mẫu, bỏ chữ ký URL); `bundled` khi dự phòng. */
  readonly version: string;
}

/** Phiên bản của danh mục đóng gói (cố định theo bản dựng). */
export const BUNDLED_LIBRARY_VERSION = 'bundled';

/** FNV-1a 32 bit trên danh sách mẫu đã sắp: cùng thư viện → cùng chuỗi, ở mọi viewer, mọi lượt ký URL. */
export const libraryVersionOf = (items: readonly ServerLibraryModel[]): string => {
  const text = items
    .map((i) => `${i.id}:${i.widthMm}x${i.heightMm}x${i.depthMm}:${i.modelUrl.split('?')[0] ?? ''}`)
    .sort()
    .join('|');
  let hash = 0x811c9dc5;
  for (let k = 0; k < text.length; k += 1) hash = Math.imul(hash ^ text.charCodeAt(k), 0x01000193) >>> 0;
  return `lib-${items.length}-${hash.toString(16).padStart(8, '0')}`;
};

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

/** Lượt đọc mất hiệu lực trước khi ghi (đổi người/bị lượt khác thay): không ghi danh mục, không phải lỗi tải. */
export const STALE_SOURCE = 'fallback:stale' as const;

/** Nguồn dự phòng không cần báo: thư viện trống, chưa có phiên, không được phép, không có, lượt đọc mất hiệu lực. */
const QUIET_FALLBACKS: ReadonlySet<string> = new Set([
  'fallback:empty',
  'fallback:no-session',
  'fallback:forbidden',
  'fallback:notFound',
  STALE_SOURCE,
]);

/** Dự phòng vì lượt đọc hỏng (người dùng cần biết). */
export const libraryReadFailed = (source: LibrarySource): boolean => source !== 'server' && !QUIET_FALLBACKS.has(source);

/**
 * Nạp thư viện nội thất máy chủ (`GET /api/library`) vào danh mục Pascal trước khi dựng cảnh.
 * Chờ ĐÚNG kết quả lượt đọc, không đua giờ riêng: nội dung cảnh không được phụ thuộc tốc độ máy/mạng.
 * Giới hạn thời gian là của client HTTP chung (`REQUEST_TIMEOUT_MS.default`, `src/lib/http/timeout.ts`);
 * hết giờ thì API trả `ok:false` kind `timeout` → dự phòng có lý do. Không bao giờ ném.
 */
export async function loadServerLibrary(
  api: LibraryListApi,
  /**
   * Ghi vào danh mục SAU khi ĐỦ mọi trang về — nơi gọi kiểm lượt đọc còn hiệu lực trước khi ghi (`sceneLibrary.ts`);
   * `null` = lượt đọc mất hiệu lực, không ghi → nguồn `fallback:stale` (không giả `server` với danh mục rỗng).
   */
  register: (items: readonly LibraryItem[], listing: LibraryListing) => number | null = registerServerLibrary,
): Promise<LibraryLoad> {
  try {
    const result = await readServerLibrary(api);
    if (!result.ok) return { count: 0, source: `fallback:${result.reason}`, version: BUNDLED_LIBRARY_VERSION };
    const count = register(result.data.items, result.data);
    if (count === null) return { count: 0, source: STALE_SOURCE, version: BUNDLED_LIBRARY_VERSION };
    return count > 0
      ? { count, source: 'server', version: libraryVersionOf(result.data.items) }
      : { count, source: 'fallback:empty', version: BUNDLED_LIBRARY_VERSION };
  } catch {
    return { count: 0, source: 'fallback:threw', version: BUNDLED_LIBRARY_VERSION };
  }
}

/* -------------------------------------------------------------------------- */
/* Đọc theo trang: vòng đọc ở `@/api/libraryPages` (dùng chung với bảng thư viện) */
/* -------------------------------------------------------------------------- */

export {
  LIBRARY_MAX_PAGES,
  LIBRARY_PAGE_LIMIT,
  LIBRARY_READ_ATTEMPTS,
  type LibraryListApi,
  type LibraryListing,
} from '@/api/libraryPages';

/** `reason` = `forbidden`/`notFound` (máy chủ trả lời rõ), kind lỗi của client, `revision` hoặc `pages`. */
export type LibraryRead = { readonly ok: true; readonly data: LibraryListing } | { readonly ok: false; readonly reason: string };

const reasonOf = (error: ApiError): string => {
  const code = 'code' in error ? error.code : undefined;
  if (code === LIBRARY_REVISION_UNSTABLE) return 'revision';
  if (code === LIBRARY_TOO_MANY_PAGES) return 'pages';
  return absenceOf(error) ?? error.kind;
};

/** Đọc HẾT thư viện (`readAllLibraryPages`), lỗi quy về `reason` của nguồn dự phòng. Có thể ném (nơi gọi bắt). */
export async function readServerLibrary(api: LibraryListApi): Promise<LibraryRead> {
  const result = await readAllLibraryPages(api);
  return result.ok ? result : { ok: false, reason: reasonOf(result.error) };
}
