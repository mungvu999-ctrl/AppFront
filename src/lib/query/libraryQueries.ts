import type { QueryClient, QueryFunction } from '@tanstack/react-query';

import type { ApiResult, LibraryApi, LibraryItem } from '@/api/client';
import { readAllLibraryPages, type LibraryListApi } from '@/api/libraryPages';

import { prefetchOnHover, type PrefetchOnHoverHandlers } from './prefetch';
import { queryKeys, type QueryKeyOf } from './queryKeys';

/**
 * Hai lượt đọc của thư viện model, gói lại thành thứ react-query nhận trực
 * tiếp — D-01/D-02/D-03.
 *
 * ## Vì sao file này tồn tại
 *
 * `queryKeys.library.list` và `queryKeys.library.detail` đã nằm trong
 * `./queryKeys.ts` từ trước mà KHÔNG AI tiêu thụ, và `./cachePolicy.ts` đã xếp
 * miền `library` vào bậc `'static'` (`TIER_BY_DOMAIN`) cũng từ trước. Hai thứ ấy
 * là một nửa của một đường dẫn dữ liệu chưa nối xong: có khoá, có chính sách,
 * không có hàm nào đi lấy dữ liệu. File này là nửa còn lại, và nó KHÔNG khai lại
 * khoá nào cũng KHÔNG đặt `staleTime` nào.
 *
 * ## Không có `staleTime` ở đây, và đó là chủ ý
 *
 * `createQueryClient` (`./queryClient.ts`) đã gọi `setQueryDefaults(['library'],
 * …)` cho mọi khoá bắt đầu bằng `'library'` — 5 phút, bậc `'static'`, vì danh mục
 * nội thất đổi theo tuần chứ không theo phút. Viết lại con số ấy ở đây là dựng
 * nguồn sự thật thứ hai cho cùng một quyết định, đúng thứ `CACHE_POLICY` được
 * đặt ra để chặn (R-71). Muốn biết một khoá đang nhận chính sách nào thì hỏi
 * `resolveCachePolicy(queryKey)`, không đọc file này.
 *
 * ## Cổng lỗi: `ApiResult` vào, ngoại lệ ra
 *
 * `ApiClient` trả `Result` chứ không ném. react-query thì ngược lại: một
 * `queryFn` trả về bình thường nghĩa là thành công. Nên `unwrap` ném NGUYÊN
 * `result.error` — không bọc lại thành `new Error(...)`, cùng cách
 * `createFloorLayerSaver` (`src/lib/autosave/spatialLayerSave.ts`) ném lỗi gốc cho
 * `createAutosave`. Lý do là cụ thể: `queryClient` đưa mọi lỗi qua
 * `normalizeQueryError` → `toAppError`, và `toAppError` NHẬN RA một `HttpError`
 * nguyên bản (`isHttpError`, `src/lib/errors/toAppError.ts:120`). Bọc nó vào một
 * `Error` với thông điệp tiếng Việt thì `kind`/`requestId`/`retryable` biến mất,
 * và luật thử lại `shouldRetry` — vốn đọc đúng `retryable` — sẽ thử lại một lỗi
 * xác thực hợp đồng, hoặc bỏ qua một lỗi mạng đáng thử lại.
 *
 * ## Cổng vào là một cổng hẹp
 *
 * Mọi hàm ở đây nhận `Pick<LibraryApi, …>` chứ không nhận cả `ApiClient`, cùng
 * khuôn với cổng `writeLayer: SpatialApi['writeLayer']` của `createFloorLayerSaver`:
 * test dựng đúng một hàm giả thay vì cả tám nhóm của client, và `src/lib` không
 * giữ tham chiếu tới thứ nó không gọi.
 */

/** Ném lỗi ra để react-query nhìn thấy thất bại; xem docblock đầu file. */
async function unwrap<T>(result: Promise<ApiResult<T>>): Promise<T> {
  const settled = await result;

  if (!settled.ok) {
    throw settled.error;
  }

  return settled.data;
}

export type LibraryListQueryKey = QueryKeyOf<typeof queryKeys.library.list>;
export type LibraryDetailQueryKey = QueryKeyOf<typeof queryKeys.library.detail>;

/** Hình dạng tối thiểu `useQuery` / `prefetchQuery` cần: một khoá và một hàm lấy. */
export interface LibraryQueryOptions<TData, TKey extends readonly unknown[]> {
  queryFn: QueryFunction<TData, TKey>;
  queryKey: TKey;
}

/**
 * Cả danh mục, một lượt.
 *
 * Không nhận tham số lọc nào — panel tải một lần rồi lọc tại chỗ bằng
 * `matchesLibraryFilter` (`src/api/schemas/library.ts`). Xem docblock của
 * `LibraryApi` (`src/api/client.ts`) cho lý do đầy đủ; tóm tắt: mười chip đổi
 * qua lại là chuyện tức thì, một lượt gọi mạng cho mỗi lần bấm chip thì không.
 *
 * `signal` của react-query đi thẳng xuống `ApiClient`, nên rời màn giữa chừng là
 * huỷ được lượt gọi thay vì để nó chạy hết rồi vứt kết quả.
 */
export function libraryListQueryOptions(
  libraryApi: LibraryListApi,
): LibraryQueryOptions<LibraryItem[], LibraryListQueryKey> {
  return {
    // M15: đọc ĐỦ trang (cùng vòng đọc với cảnh 3D); lỗi của bất kỳ trang nào ném như lượt đọc một phát trước đây.
    queryFn: ({ signal }) =>
      unwrap(readAllLibraryPages(libraryApi, signal).then((r): ApiResult<LibraryItem[]> => (r.ok ? { ok: true, data: [...r.data.items] } : r))),
    queryKey: queryKeys.library.list(),
  };
}

/**
 * Một mục, theo id.
 *
 * Đây là thứ D-03 nạp trước khi con trỏ chạm thẻ. Nó KHÔNG thay thế
 * `libraryListQueryOptions`: lưới thẻ vẽ từ danh sách, còn khoá chi tiết giữ
 * riêng bản đọc của một mục để lượt xem kỹ / kéo thả sau đó không phải chờ.
 */
export function libraryDetailQueryOptions(
  libraryApi: Pick<LibraryApi, 'read'>,
  libraryItemId: string,
): LibraryQueryOptions<LibraryItem, LibraryDetailQueryKey> {
  return {
    queryFn: ({ signal }) => unwrap(libraryApi.read({ libraryItemId, signal })),
    queryKey: queryKeys.library.detail(libraryItemId),
  };
}

/**
 * Hai handler con trỏ để gắn thẳng lên một thẻ model — D-03.
 *
 * Mượn nguyên `prefetchOnHover` (`./prefetch.ts`) chứ không tự hẹn giờ: nó đã
 * giữ đúng hai điều kiện mà một lượt nạp trước tử tế cần — chỉ chạy sau khi con
 * trỏ ở lại đủ lâu (lướt qua thì không tải gì), và chỉ chạy khi khoá còn rỗng
 * (đã có dữ liệu thì không gọi lại). Độ trễ lấy mặc định của hàm ấy; truyền một
 * con số mới ở đây là dựng nguồn thứ hai cho cùng một quyết định.
 *
 * Trả về `{ onPointerEnter, onPointerLeave }` — cặp handler DOM, không phải một
 * hook, nên `src/lib` vẫn không biết gì về React (mục 0.4).
 */
export function prefetchLibraryItemOnHover(
  queryClient: QueryClient,
  libraryApi: Pick<LibraryApi, 'read'>,
  libraryItemId: string,
): PrefetchOnHoverHandlers {
  const { queryFn, queryKey } = libraryDetailQueryOptions(libraryApi, libraryItemId);

  return prefetchOnHover<LibraryItem>(queryClient, queryKey, queryFn as QueryFunction<LibraryItem>);
}
