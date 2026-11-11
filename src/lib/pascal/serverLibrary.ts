import type { ApiError, LibraryApi } from '@/api/client';
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
  api: Pick<LibraryApi, 'list'>,
  /**
   * Ghi vào danh mục SAU khi phản hồi về — nơi gọi kiểm lượt đọc còn hiệu lực trước khi ghi (`sceneLibrary.ts`);
   * `null` = lượt đọc mất hiệu lực, không ghi → nguồn `fallback:stale` (không giả `server` với danh mục rỗng).
   */
  register: (items: Parameters<typeof registerServerLibrary>[0]) => number | null = registerServerLibrary,
): Promise<LibraryLoad> {
  try {
    const result = await api.list();
    if (!result.ok) return { count: 0, source: `fallback:${absenceOf(result.error) ?? result.error.kind}`, version: BUNDLED_LIBRARY_VERSION };
    const count = register(result.data);
    if (count === null) return { count: 0, source: STALE_SOURCE, version: BUNDLED_LIBRARY_VERSION };
    return count > 0
      ? { count, source: 'server', version: libraryVersionOf(result.data) }
      : { count, source: 'fallback:empty', version: BUNDLED_LIBRARY_VERSION };
  } catch {
    return { count: 0, source: 'fallback:threw', version: BUNDLED_LIBRARY_VERSION };
  }
}
