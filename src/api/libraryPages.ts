import type { ApiResult, LibraryApi, LibraryItem } from './client';

/* -------------------------------------------------------------------------- */
/* Đọc HẾT thư viện theo trang (M15, hợp đồng #14 có `limit`/`cursor`)          */
/* Dùng chung: cảnh 3D (`serverLibrary.ts`) và bảng thư viện (`libraryQueries`). */
/* -------------------------------------------------------------------------- */

/** Cỡ trang lớn nhất hợp đồng cho phép. */
export const LIBRARY_PAGE_LIMIT = 500;
/** Số lượt đọc trọn từ trang đầu khi `X-Library-Revision` đổi giữa chừng; hết lượt → lỗi `LIBRARY_REVISION_UNSTABLE`. */
export const LIBRARY_READ_ATTEMPTS = 3;
/** Chặn vòng lặp con trỏ (máy chủ trả mãi một con trỏ): 200 × 500 = 100.000 mục. Vượt → lỗi `LIBRARY_TOO_MANY_PAGES`. */
export const LIBRARY_MAX_PAGES = 200;
export const LIBRARY_REVISION_UNSTABLE = 'LIBRARY_REVISION_UNSTABLE';
export const LIBRARY_TOO_MANY_PAGES = 'LIBRARY_TOO_MANY_PAGES';

/**
 * Client thư viện tối thiểu. Không có `listPage` (bản giả cũ) = một phản hồi là cả danh sách — cùng nghĩa với BE cũ
 * không gửi header.
 */
export type LibraryListApi = Pick<LibraryApi, 'list'> & Partial<Pick<LibraryApi, 'listPage'>>;

/** Kết quả một lượt đọc trọn (mọi trang cùng một `revision`). `ms` = thời gian cả lượt, kể cả lượt đọc lại. */
export interface LibraryListing {
  readonly items: readonly LibraryItem[];
  readonly pages: number;
  readonly revision: string | null;
  readonly restarts: number;
  readonly bytes: number;
  readonly ms: number;
}

/** Lỗi phía client của lượt đọc trang (không có HTTP status): `code` phân biệt. */
const clientError = (code: string): ApiResult<never> => ({
  ok: false,
  error: { kind: 'http', code, requestId: '', retryable: true, raw: null },
});

/**
 * `limit=500`, theo `X-Next-Cursor` tới khi vắng; mọi trang phải cùng `X-Library-Revision`, đổi thì đọc lại từ trang
 * đầu (tối đa `LIBRARY_READ_ATTEMPTS` lượt). Chỉ trả khi đủ trang (không bao giờ có danh sách nửa chừng); một trang hỏng
 * = cả lượt hỏng, trả đúng lỗi của trang ấy. Có thể ném (nơi gọi bắt).
 */
export async function readAllLibraryPages(api: LibraryListApi, signal?: AbortSignal): Promise<ApiResult<LibraryListing>> {
  const started = Date.now();
  const options = signal === undefined ? {} : { signal };
  const { listPage } = api;
  if (listPage === undefined) {
    const result = await api.list(options);
    if (!result.ok) return result;
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
      const page = await listPage({ limit: LIBRARY_PAGE_LIMIT, ...(cursor === undefined ? {} : { cursor }), ...options });
      if (!page.ok) return page;
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
      if (cursor !== undefined && pages >= LIBRARY_MAX_PAGES) return clientError(LIBRARY_TOO_MANY_PAGES);
    } while (cursor !== undefined);
    if (!changed) {
      return {
        ok: true,
        data: { items: [...byId.values()], pages, revision: revision ?? null, restarts: attempt, bytes, ms: Date.now() - started },
      };
    }
  }
  return clientError(LIBRARY_REVISION_UNSTABLE);
}
