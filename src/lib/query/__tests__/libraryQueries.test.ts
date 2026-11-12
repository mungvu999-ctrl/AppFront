import { describe, expect, it, vi } from 'vitest';

import type { ApiResult, LibraryApi, LibraryItem } from '@/api/client';
import type { HttpError } from '@/lib/http';

import { resolveCachePolicy } from '../cachePolicy';
import {
  libraryDetailQueryOptions,
  libraryListQueryOptions,
  prefetchLibraryItemOnHover,
} from '../libraryQueries';
import { createQueryClient } from '../queryClient';
import { queryKeys } from '../queryKeys';

const sampleItem: LibraryItem = {
  depthMm: 520,
  fileSizeBytes: 184_000,
  furnitureKind: 'chair',
  group: 'chair',
  heightMm: 880,
  id: 'library-chair-1',
  modelUrl: 'https://example.com/library/library-chair-1.glb',
  name: 'ghế tựa gỗ sồi',
  previewUrl: 'https://example.com/library/library-chair-1.png',
  source: 'catalogue',
  triangleCount: 12_600,
  widthMm: 460,
};

const httpError: HttpError = {
  kind: 'network',
  raw: undefined,
  requestId: 'req-library-2',
  retryable: true,
  status: 0,
};

const createLibraryApi = (
  overrides: Partial<LibraryApi> = {},
): LibraryApi & { list: ReturnType<typeof vi.fn>; read: ReturnType<typeof vi.fn> } => {
  const list = vi.fn(async (): Promise<ApiResult<LibraryItem[]>> => ({ ok: true, data: [sampleItem] }));
  const read = vi.fn(async (): Promise<ApiResult<LibraryItem>> => ({ ok: true, data: sampleItem }));

  return { list, read, ...overrides } as LibraryApi & {
    list: ReturnType<typeof vi.fn>;
    read: ReturnType<typeof vi.fn>;
  };
};

/** `queryFn` cần một ngữ cảnh; chỉ `signal` được đọc, phần còn lại không dùng tới. */
const callQueryFn = async <TData>(
  options: { queryFn: (context: never) => TData | Promise<TData>; queryKey: readonly unknown[] },
  signal: AbortSignal = new AbortController().signal,
): Promise<TData> =>
  options.queryFn({
    client: undefined,
    meta: undefined,
    queryKey: options.queryKey,
    signal,
  } as never);

describe('libraryListQueryOptions', () => {
  it('dùng lại khoá library.list đã có, không dựng khoá mới', () => {
    expect(libraryListQueryOptions(createLibraryApi()).queryKey).toEqual(queryKeys.library.list());
  });

  it('nhận chính sách cache "static" từ cachePolicy, không tự khai staleTime', () => {
    const options = libraryListQueryOptions(createLibraryApi());
    const policy = resolveCachePolicy(options.queryKey);

    expect(policy.tier).toBe('static');
    expect(Object.keys(options).sort()).toEqual(['queryFn', 'queryKey']);
  });

  it('trả thẳng danh sách khi lượt đọc thành công', async () => {
    const api = createLibraryApi();

    await expect(callQueryFn(libraryListQueryOptions(api))).resolves.toEqual([sampleItem]);
  });

  it('chuyển tiếp signal xuống ApiClient để huỷ được lượt gọi', async () => {
    const api = createLibraryApi();
    const { signal } = new AbortController();

    await callQueryFn(libraryListQueryOptions(api), signal);

    expect(api.list).toHaveBeenCalledWith({ signal });
  });

  it('ném NGUYÊN lỗi của ApiClient, giữ lại kind và retryable', async () => {
    const api = createLibraryApi({ list: async () => ({ ok: false, error: httpError }) });

    await expect(callQueryFn(libraryListQueryOptions(api))).rejects.toBe(httpError);
  });

  it('M15: đọc ĐỦ trang (1200 mục, limit 500) — bảng thấy mục ở trang 3; lỗi một trang ném nguyên lỗi', async () => {
    const all = Array.from({ length: 1200 }, (_, k) => ({ ...sampleItem, id: `library-${k}` }));
    const listPage = vi.fn(async ({ cursor, limit = 500 }: { cursor?: string; limit?: number } = {}) => {
      const start = cursor === undefined ? 0 : Number(cursor);
      const next = start + limit < all.length ? String(start + limit) : undefined;
      return { ok: true as const, data: { items: all.slice(start, start + limit), ...(next === undefined ? {} : { nextCursor: next }), revision: 'r1', bytes: 0 } };
    });
    const api = createLibraryApi({ listPage } as Partial<LibraryApi>);
    const { signal } = new AbortController();

    const items = await callQueryFn(libraryListQueryOptions(api), signal);
    expect(items).toHaveLength(1200);
    expect(items.some((item) => item.id === 'library-1100')).toBe(true);
    expect(listPage).toHaveBeenCalledTimes(3);
    expect(listPage).toHaveBeenLastCalledWith({ limit: 500, cursor: '1000', signal });
    expect(api.list).not.toHaveBeenCalled();

    listPage.mockImplementationOnce(async () => ({ ok: true as const, data: { items: all.slice(0, 500), nextCursor: '500', revision: 'r1', bytes: 0 } }));
    listPage.mockImplementationOnce(async () => ({ ok: false, error: httpError }) as never);
    await expect(callQueryFn(libraryListQueryOptions(api))).rejects.toBe(httpError);
  });
});

describe('libraryDetailQueryOptions', () => {
  it('dùng lại khoá library.detail đã có', () => {
    expect(libraryDetailQueryOptions(createLibraryApi(), 'library-chair-1').queryKey).toEqual(
      queryKeys.library.detail('library-chair-1'),
    );
  });

  it('cũng nằm ở bậc "static"', () => {
    expect(resolveCachePolicy(queryKeys.library.detail('library-chair-1')).tier).toBe('static');
  });

  it('đọc đúng mục được hỏi, kèm signal', async () => {
    const api = createLibraryApi();
    const { signal } = new AbortController();

    await expect(callQueryFn(libraryDetailQueryOptions(api, 'library-chair-1'), signal)).resolves.toEqual(
      sampleItem,
    );
    expect(api.read).toHaveBeenCalledWith({ libraryItemId: 'library-chair-1', signal });
  });

  it('ném nguyên lỗi của ApiClient', async () => {
    const api = createLibraryApi({ read: async () => ({ ok: false, error: httpError }) });

    await expect(callQueryFn(libraryDetailQueryOptions(api, 'library-chair-1'))).rejects.toBe(httpError);
  });
});

describe('prefetchLibraryItemOnHover', () => {
  it('không gọi gì khi con trỏ rời đi trước khi hết độ trễ', () => {
    vi.useFakeTimers();

    try {
      const api = createLibraryApi();
      const handlers = prefetchLibraryItemOnHover(createQueryClient(), api, 'library-chair-1');

      handlers.onPointerEnter();
      handlers.onPointerLeave();
      vi.advanceTimersByTime(1_000);

      expect(api.read).not.toHaveBeenCalled();
    } finally {
      vi.useRealTimers();
    }
  });

  it('nạp trước vào đúng khoá chi tiết khi con trỏ ở lại đủ lâu', async () => {
    vi.useFakeTimers();
    const queryClient = createQueryClient();
    const api = createLibraryApi();

    try {
      prefetchLibraryItemOnHover(queryClient, api, 'library-chair-1').onPointerEnter();
      await vi.advanceTimersByTimeAsync(1_000);
    } finally {
      vi.useRealTimers();
    }

    expect(api.read).toHaveBeenCalledTimes(1);
    expect(queryClient.getQueryData(queryKeys.library.detail('library-chair-1'))).toEqual(sampleItem);
  });

  it('không gọi lại khi khoá đã có dữ liệu', async () => {
    vi.useFakeTimers();
    const queryClient = createQueryClient();
    const api = createLibraryApi();
    queryClient.setQueryData(queryKeys.library.detail('library-chair-1'), sampleItem);

    try {
      prefetchLibraryItemOnHover(queryClient, api, 'library-chair-1').onPointerEnter();
      await vi.advanceTimersByTimeAsync(1_000);
    } finally {
      vi.useRealTimers();
    }

    expect(api.read).not.toHaveBeenCalled();
  });
});
