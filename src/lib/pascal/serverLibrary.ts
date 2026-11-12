import type { ApiError, LibraryApi, LibraryItem } from '@/api/client';
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
/* Đọc theo trang (M15, hợp đồng #14 có `limit`/`cursor`)                       */
/* -------------------------------------------------------------------------- */

/** Cỡ trang lớn nhất hợp đồng cho phép. */
export const LIBRARY_PAGE_LIMIT = 500;
/** Số lượt đọc trọn từ trang đầu khi `X-Library-Revision` đổi giữa chừng; hết lượt → lỗi đọc `fallback:revision`. */
export const LIBRARY_READ_ATTEMPTS = 3;
/** Chặn vòng lặp con trỏ (máy chủ trả mãi một con trỏ): 200 × 500 = 100.000 mục. Vượt → lỗi đọc `fallback:pages`. */
export const LIBRARY_MAX_PAGES = 200;

/**
 * Client thư viện cho lượt đọc cảnh. Không có `listPage` (bản giả cũ) = một phản hồi là cả danh sách — cùng nghĩa với
 * BE cũ không gửi header.
 */
export type LibraryListApi = Pick<LibraryApi, 'list'> & Partial<Pick<LibraryApi, 'listPage'>>;

/** Kết quả một lượt đọc trọn (mọi trang cùng một `revision`). `ms` = thời gian của lượt cuối, kể cả lượt đọc lại. */
export interface LibraryListing {
  readonly items: readonly LibraryItem[];
  readonly pages: number;
  readonly revision: string | null;
  readonly restarts: number;
  readonly bytes: number;
  readonly ms: number;
}

/** `reason` = `forbidden`/`notFound` (máy chủ trả lời rõ), kind lỗi của client, `revision` hoặc `pages`. */
export type LibraryRead = { readonly ok: true; readonly data: LibraryListing } | { readonly ok: false; readonly reason: string };

const reasonOf = (error: ApiError): string => absenceOf(error) ?? error.kind;

/**
 * Đọc HẾT thư viện: `limit=500`, theo `X-Next-Cursor` tới khi vắng; mọi trang phải cùng `X-Library-Revision`, đổi thì
 * đọc lại từ trang đầu (tối đa `LIBRARY_READ_ATTEMPTS` lượt). Không ghi gì: nơi gọi chỉ ghi khi nhận đủ (không bao giờ
 * có thư viện nửa chừng). Một trang hỏng = cả lượt hỏng. Có thể ném (nơi gọi bắt).
 */
export async function readServerLibrary(api: LibraryListApi): Promise<LibraryRead> {
  const started = Date.now();
  const { listPage } = api;
  if (listPage === undefined) {
    const result = await api.list();
    if (!result.ok) return { ok: false, reason: reasonOf(result.error) };
    return { ok: true, data: { items: result.data, pages: 1, revision: null, restarts: 0, bytes: 0, ms: Date.now() - started } };
  }
  for (let attempt = 0; attempt < LIBRARY_READ_ATTEMPTS; attempt += 1) {
    const byId = new Map<string, LibraryItem>();
    let revision: string | undefined;
    let cursor: string | undefined;
    let pages = 0;
    let bytes = 0;
    let changed = false;
    do {
      const page = await listPage({ limit: LIBRARY_PAGE_LIMIT, ...(cursor === undefined ? {} : { cursor }) });
      if (!page.ok) return { ok: false, reason: reasonOf(page.error) };
      if (pages > 0 && page.data.revision !== revision) {
        changed = true;
        break;
      }
      revision = page.data.revision;
      pages += 1;
      bytes += page.data.bytes;
      // Trùng id giữa hai trang (không nên có khi cùng revision): giữ bản đầu.
      for (const item of page.data.items) if (!byId.has(item.id)) byId.set(item.id, item);
      cursor = page.data.nextCursor;
      if (cursor !== undefined && pages >= LIBRARY_MAX_PAGES) return { ok: false, reason: 'pages' };
    } while (cursor !== undefined);
    if (!changed) {
      return {
        ok: true,
        data: { items: [...byId.values()], pages, revision: revision ?? null, restarts: attempt, bytes, ms: Date.now() - started },
      };
    }
  }
  return { ok: false, reason: 'revision' };
}
