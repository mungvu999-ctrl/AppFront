import { describe, expect, it, vi } from 'vitest';

import { createHttpClient, REQUEST_TIMEOUT_MS, type HttpClient, type HttpError, type Result } from '@/lib/http';

import { createApiClient, type LibraryItem } from '../client';
import { ENDPOINTS } from '../endpoints';
import {
  FURNITURE_KIND_BY_LIBRARY_GROUP,
  LIBRARY_FILTER_IDS,
  LIBRARY_GROUPS,
  LIBRARY_SOURCES,
  LibraryItemSchema,
  matchesLibraryFilter,
  type LibraryGroup,
  type LibraryItemWire,
} from '../schemas/library';
import { createMockApiClient } from '../__mocks__/client';

const ok = <T>(data: T): Result<T, HttpError> => ({ ok: true, data });

const httpError: HttpError = {
  kind: 'http',
  raw: undefined,
  requestId: 'req-library-1',
  retryable: false,
  status: 500,
};

const createHttpMock = (responses: Record<string, unknown> = {}): HttpClient => {
  const get = vi.fn((path: string) => ok(responses[`GET ${path}`] as never)) as unknown as HttpClient['get'];
  const post = vi.fn((path: string) => ok(responses[`POST ${path}`] as never)) as unknown as HttpClient['post'];
  const patch = vi.fn((path: string) => ok(responses[`PATCH ${path}`] as never)) as unknown as HttpClient['patch'];
  const del = vi.fn((path: string) => ok(responses[`DELETE ${path}`] as never)) as unknown as HttpClient['delete'];
  const put = vi.fn((path: string) => ok(responses[`PUT ${path}`] as never)) as unknown as HttpClient['put'];

  return {
    delete: del,
    events: { emit: () => undefined, on: () => () => undefined },
    get,
    getRecentRequests: () => [],
    patch,
    post,
    put,
  };
};

const sampleWireItem: LibraryItemWire = {
  depthMm: 600,
  fileSizeBytes: 268_000,
  group: 'table',
  heightMm: 750,
  id: 'library-table-2',
  modelUrl: 'https://example.com/library/library-table-2.glb',
  name: 'bàn làm việc chữ l',
  previewUrl: 'https://example.com/library/library-table-2.png',
  source: 'mine',
  triangleCount: 6_100,
  widthMm: 1_400,
};

const itemOf = (overrides: Partial<Pick<LibraryItem, 'group' | 'source'>>): Pick<LibraryItem, 'group' | 'source'> => ({
  group: 'chair',
  source: 'catalogue',
  ...overrides,
});

/* -------------------------------------------------------------------------- */
/* Nhóm, nguồn và loại nội thất.                                               */
/* -------------------------------------------------------------------------- */

describe('LIBRARY_GROUPS', () => {
  it('khai đúng chín nhóm loại đồ, theo thứ tự chip trên màn', () => {
    expect([...LIBRARY_GROUPS]).toEqual([
      'table',
      'chair',
      'bed',
      'sofa',
      'storage',
      'sanitary',
      'kitchen',
      'technical',
      'decor',
    ]);
  });

  it('không nhận "mine" làm một nhóm — quyền sở hữu là trục riêng', () => {
    expect([...LIBRARY_GROUPS]).not.toContain('mine');
    expect([...LIBRARY_SOURCES]).toEqual(['catalogue', 'mine']);
  });

  it('cho mỗi nhóm đúng một FurnitureKind, và sofa đặt xuống thành ghế', () => {
    for (const group of LIBRARY_GROUPS) {
      expect(FURNITURE_KIND_BY_LIBRARY_GROUP[group]).toBeTypeOf('string');
    }

    expect(FURNITURE_KIND_BY_LIBRARY_GROUP.sofa).toBe('chair');
    expect(FURNITURE_KIND_BY_LIBRARY_GROUP.technical).toBe('other');
    expect(FURNITURE_KIND_BY_LIBRARY_GROUP.storage).toBe('wardrobe');
    expect(FURNITURE_KIND_BY_LIBRARY_GROUP.sanitary).toBe('sanitaryFixture');
    expect(FURNITURE_KIND_BY_LIBRARY_GROUP.kitchen).toBe('kitchenCabinet');
  });
});

/* -------------------------------------------------------------------------- */
/* Schema.                                                                     */
/* -------------------------------------------------------------------------- */

describe('LibraryItemSchema', () => {
  it('suy ra furnitureKind từ group thay vì đọc nó trên dây', () => {
    const parsed = LibraryItemSchema.parse(sampleWireItem);

    expect(parsed.furnitureKind).toBe('table');
    expect(parsed.group).toBe('table');
    expect(parsed.source).toBe('mine');
  });

  it('giữ kích thước, dung lượng và số tam giác ở dạng số thô', () => {
    const parsed = LibraryItemSchema.parse(sampleWireItem);

    expect(parsed.widthMm).toBe(1_400);
    expect(parsed.depthMm).toBe(600);
    expect(parsed.heightMm).toBe(750);
    expect(parsed.fileSizeBytes).toBe(268_000);
    expect(parsed.triangleCount).toBe(6_100);
  });

  it('bỏ hẳn previewUrl khi mục chưa có ảnh xem trước, không thay bằng chuỗi rỗng', () => {
    const withoutPreview: LibraryItemWire = { ...sampleWireItem };
    delete withoutPreview.previewUrl;

    const parsed = LibraryItemSchema.parse(withoutPreview);

    expect('previewUrl' in parsed).toBe(false);
  });

  it('từ chối một furnitureKind gửi thẳng trên dây — hợp đồng strict', () => {
    const result = LibraryItemSchema.safeParse({ ...sampleWireItem, furnitureKind: 'bed' });

    expect(result.success).toBe(false);
  });

  it('từ chối nhóm ngoài hợp đồng, kích thước không dương và modelUrl không phải URL', () => {
    expect(LibraryItemSchema.safeParse({ ...sampleWireItem, group: 'mine' }).success).toBe(false);
    expect(LibraryItemSchema.safeParse({ ...sampleWireItem, widthMm: 0 }).success).toBe(false);
    expect(LibraryItemSchema.safeParse({ ...sampleWireItem, triangleCount: 1.5 }).success).toBe(false);
    expect(LibraryItemSchema.safeParse({ ...sampleWireItem, modelUrl: 'library-table-2.glb' }).success).toBe(false);
  });
});

/* -------------------------------------------------------------------------- */
/* Mười chip lọc.                                                              */
/* -------------------------------------------------------------------------- */

describe('LIBRARY_FILTER_IDS', () => {
  it('có đúng mười một chip: "all", chín nhóm, rồi "mine"', () => {
    expect(LIBRARY_FILTER_IDS).toHaveLength(11);
    expect(LIBRARY_FILTER_IDS[0]).toBe('all');
    expect(LIBRARY_FILTER_IDS[LIBRARY_FILTER_IDS.length - 1]).toBe('mine');
    expect([...LIBRARY_FILTER_IDS].slice(1, -1)).toEqual([...LIBRARY_GROUPS]);
  });
});

describe('matchesLibraryFilter', () => {
  it('"all" khớp mọi mục, kể cả mục của tôi', () => {
    expect(matchesLibraryFilter(itemOf({}), 'all')).toBe(true);
    expect(matchesLibraryFilter(itemOf({ source: 'mine' }), 'all')).toBe(true);
    expect(matchesLibraryFilter(itemOf({ group: 'technical', source: 'mine' }), 'all')).toBe(true);
  });

  it('"mine" khớp theo nguồn, bất kể nhóm', () => {
    for (const group of LIBRARY_GROUPS) {
      expect(matchesLibraryFilter(itemOf({ group, source: 'mine' }), 'mine')).toBe(true);
      expect(matchesLibraryFilter(itemOf({ group, source: 'catalogue' }), 'mine')).toBe(false);
    }
  });

  it('chip nhóm khớp theo nhóm, bất kể nguồn — ghế của tôi vẫn là ghế', () => {
    expect(matchesLibraryFilter(itemOf({ group: 'chair', source: 'mine' }), 'chair')).toBe(true);
    expect(matchesLibraryFilter(itemOf({ group: 'chair', source: 'catalogue' }), 'chair')).toBe(true);
    expect(matchesLibraryFilter(itemOf({ group: 'table', source: 'mine' }), 'chair')).toBe(false);
  });

  it('mỗi mục khớp đúng ba chip: "all", chip nhóm của nó, và "mine" nếu là của nó', () => {
    const mine = itemOf({ group: 'sofa', source: 'mine' });
    const catalogue = itemOf({ group: 'sofa', source: 'catalogue' });

    expect(LIBRARY_FILTER_IDS.filter((id) => matchesLibraryFilter(mine, id))).toEqual(['all', 'sofa', 'mine']);
    expect(LIBRARY_FILTER_IDS.filter((id) => matchesLibraryFilter(catalogue, id))).toEqual(['all', 'sofa']);
  });
});

/* -------------------------------------------------------------------------- */
/* Đường dẫn và client thật.                                                   */
/* -------------------------------------------------------------------------- */

describe('ENDPOINTS.library', () => {
  it('là đường toàn cục, không lồng dưới dự án', () => {
    expect(ENDPOINTS.library.list).toBe('/library');
    expect(ENDPOINTS.library.detail('library-chair-1')).toBe('/library/library-chair-1');
  });
});

describe('createApiClient().library', () => {
  it('đọc danh mục qua đúng đường dẫn và giải mã từng mục', async () => {
    const http = createHttpMock({ 'GET /library': [sampleWireItem] });
    const result = await createApiClient(http).library.list();

    expect(http.get).toHaveBeenCalledWith('/library', undefined);
    expect(result.ok).toBe(true);
    expect(result.ok && result.data[0]?.furnitureKind).toBe('table');
  });

  it('bỏ qua một mục hỏng thay vì làm rỗng cả panel', async () => {
    const http = createHttpMock({
      'GET /library': [sampleWireItem, sampleWireItem, sampleWireItem, sampleWireItem, { id: 'broken' }],
    });
    const result = await createApiClient(http).library.list();

    expect(result.ok).toBe(true);
    expect(result.ok && result.data).toHaveLength(4);
  });

  it('đọc một mục qua đường chi tiết', async () => {
    const http = createHttpMock({ 'GET /library/library-table-2': sampleWireItem });
    const result = await createApiClient(http).library.read({ libraryItemId: 'library-table-2' });

    expect(http.get).toHaveBeenCalledWith('/library/library-table-2', undefined);
    expect(result.ok && result.data.id).toBe('library-table-2');
  });

  it('chuyển tiếp signal xuống transport', async () => {
    const controller = new AbortController();
    const http = createHttpMock({ 'GET /library': [] });

    await createApiClient(http).library.list({ signal: controller.signal });

    expect(http.get).toHaveBeenCalledWith('/library', { signal: controller.signal });
  });

  it('trả lỗi vận chuyển nguyên vẹn, không cố giải mã', async () => {
    const get = vi.fn(async () => ({ ok: false as const, error: httpError })) as unknown as HttpClient['get'];
    const http = { ...createHttpMock(), get };

    const list = await createApiClient(http).library.list();
    const read = await createApiClient(http).library.read({ libraryItemId: 'library-table-2' });

    expect(list.ok).toBe(false);
    expect(!list.ok && list.error).toBe(httpError);
    expect(!read.ok && read.error).toBe(httpError);
  });

  it('báo lỗi hợp đồng khi mục chi tiết sai hình dạng', async () => {
    const http = createHttpMock({ 'GET /library/library-table-2': { id: 'library-table-2' } });
    const result = await createApiClient(http).library.read({ libraryItemId: 'library-table-2' });

    expect(result.ok).toBe(false);
    expect(!result.ok && 'code' in result.error && result.error.code).toBe('CONTRACT_VALIDATION');
  });
});

/* -------------------------------------------------------------------------- */
/* Bộ mẫu.                                                                     */
/* -------------------------------------------------------------------------- */

describe('createMockApiClient().library', () => {
  const readItems = async (): Promise<readonly LibraryItem[]> => {
    const result = await createMockApiClient().library.list();

    if (!result.ok) {
      throw new Error('bộ mẫu thư viện phải luôn đọc được');
    }

    return result.data;
  };

  it('dựng đủ mười tám mục cho lưới hai cột', async () => {
    expect(await readItems()).toHaveLength(18);
  });

  it('phủ cả tám nhóm, mỗi nhóm ít nhất hai mục', async () => {
    const items = await readItems();

    for (const group of LIBRARY_GROUPS) {
      expect(items.filter((item) => item.group === group).length).toBeGreaterThanOrEqual(2);
    }
  });

  it('có ba mục "của tôi", nằm ở ba nhóm khác nhau', async () => {
    const mine = (await readItems()).filter((item) => item.source === 'mine');
    const groups = new Set<LibraryGroup>(mine.map((item) => item.group));

    expect(mine).toHaveLength(3);
    expect(groups.size).toBe(3);
  });

  it('có đúng hai mục thiếu ảnh xem trước, cho trạng thái "một phần"', async () => {
    const items = await readItems();

    expect(items.filter((item) => item.previewUrl === undefined)).toHaveLength(2);
  });

  it('có một mục vượt hẳn ngân sách tam giác của cảnh', async () => {
    const heavy = (await readItems()).filter((item) => item.triangleCount > 900_000);

    expect(heavy).toHaveLength(1);
    expect(heavy[0]?.id).toBe('library-technical-2');
  });

  it('suy furnitureKind từ group cho mọi mục, không gõ tay', async () => {
    for (const item of await readItems()) {
      expect(item.furnitureKind).toBe(FURNITURE_KIND_BY_LIBRARY_GROUP[item.group]);
    }
  });

  it('đọc được một mục theo id, và không trượt với id lạ', async () => {
    const client = createMockApiClient();
    const known = await client.library.read({ libraryItemId: 'library-chair-1' });
    const unknown = await client.library.read({ libraryItemId: 'library-khong-co' });

    expect(known.ok && known.data.name).toBe('ghế tựa gỗ sồi');
    expect(unknown.ok && unknown.data.id).toBe('library-khong-co');
  });
});

describe('createApiClient().library.listPage (M15)', () => {
  const httpWith = (text: string, headers: Record<string, string> = {}) => {
    const get = vi.fn(async () => ({ ok: true as const, data: { headers: new Headers(headers), text } }));
    return { get, http: { get } as unknown as HttpClient };
  };

  it('gửi limit/cursor, đọc X-Next-Cursor + X-Library-Revision + bytes; thân đọc trong vòng đời request', async () => {
    const body = JSON.stringify([sampleWireItem]);
    const { get, http } = httpWith(body, { 'X-Next-Cursor': 'c2', 'X-Library-Revision': 'r7' });
    const result = await createApiClient(http).library.listPage({ cursor: 'c1', limit: 500 });

    expect(get).toHaveBeenCalledWith(ENDPOINTS.library.list, { query: { cursor: 'c1', limit: 500 }, responseType: 'textWithHeaders' });
    expect(result.ok && result.data.items.map((item) => item.id)).toEqual([sampleWireItem.id]);
    expect(result.ok && { nextCursor: result.data.nextCursor, revision: result.data.revision, bytes: result.data.bytes }).toEqual({
      nextCursor: 'c2',
      revision: 'r7',
      bytes: body.length,
    });
  });

  it('BE cũ không header: hết trang, không revision', async () => {
    const { http } = httpWith('[]');
    const result = await createApiClient(http).library.listPage({ limit: 500 });
    expect(result).toStrictEqual({ ok: true, data: { items: [], bytes: 2 } });
  });

  it('thân không phải JSON → lỗi giải mã, không ném', async () => {
    const { http } = httpWith('<html>');
    const result = await createApiClient(http).library.listPage();
    expect(result.ok).toBe(false);
  });

  it('Codex #1: hai lượt cùng lúc trên client HTTP thật (single-flight) đều nhận đủ dữ liệu', async () => {
    const body = JSON.stringify([sampleWireItem]);
    let release: () => void = () => undefined;
    const gate = new Promise<void>((r) => (release = r));
    const fetchImpl = vi.fn(async () => {
      await gate;
      return new Response(body, { headers: { 'Content-Type': 'application/json', 'X-Library-Revision': 'r1' } });
    });
    const api = createApiClient(createHttpClient({ baseUrl: 'https://api.example.com', fetchImpl }));
    const a = api.library.listPage({ limit: 500 });
    const b = api.library.listPage({ limit: 500 });
    release();
    const [ra, rb] = await Promise.all([a, b]);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    expect(ra.ok && ra.data.items).toHaveLength(1);
    expect(rb.ok && rb.data.items).toHaveLength(1);
    expect(rb.ok && rb.data.revision).toBe('r1');
  });

  /** Header về ngay, thân dừng ở `[` cho tới khi signal của fetch bị huỷ. */
  const stallingFetch = () =>
    vi.fn(async (_url: unknown, init?: RequestInit) => {
      const stream = new ReadableStream<Uint8Array>({
        start(controller) {
          controller.enqueue(new TextEncoder().encode('['));
          init?.signal?.addEventListener('abort', () => controller.error(new DOMException('aborted', 'AbortError')));
        },
      });
      return new Response(stream, { headers: { 'Content-Type': 'application/json' } });
    });

  it('Codex #2: header về nhưng thân treo → người gọi huỷ thì lượt đọc dừng với lỗi aborted', async () => {
    const fetchImpl = stallingFetch();
    const api = createApiClient(createHttpClient({ baseUrl: 'https://api.example.com', fetchImpl }));
    const ctl = new AbortController();
    const pending = api.library.listPage({ limit: 500, signal: ctl.signal });
    await vi.waitFor(() => expect(fetchImpl).toHaveBeenCalled());
    ctl.abort();
    const result = await pending;
    expect(!result.ok && result.error.kind).toBe('aborted');
  });

  it('Codex #2: header về nhưng thân treo, không ai huỷ → hết hạn request thì dừng với lỗi timeout', async () => {
    vi.useFakeTimers();
    try {
      const fetchImpl = stallingFetch();
      const api = createApiClient(createHttpClient({ baseUrl: 'https://api.example.com', fetchImpl }));
      const pending = api.library.listPage({ limit: 500 });
      await vi.advanceTimersByTimeAsync(REQUEST_TIMEOUT_MS.default + 1);
      const result = await pending;
      expect(fetchImpl).toHaveBeenCalledTimes(1);
      expect(!result.ok && result.error.kind).toBe('timeout');
    } finally {
      vi.useRealTimers();
    }
  });
});
