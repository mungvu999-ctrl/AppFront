/**
 * Client của bộ hồ sơ nhiều bản vẽ (K-32a, N54–N61) — Mức 3, lát cắt 2.
 *
 * Đứng riêng, **không** vào `ApiClient` (`./client.ts`), cùng khuôn `adminMlClient.ts`: chỉ màn
 * `src/screens/upload/DrawingSetReview` nhập file này, nên nó và schema `drawingSet` nằm trong chunk
 * lười của màn chứ không trong chunk mà mọi người dùng đều tải.
 *
 * Mỗi phương thức trả `ApiResult<…>` đã giải mã bằng schema strict; lỗi dây (`HttpError`) đi nguyên
 * để màn đọc `code` (`DRAWING_SET_DISABLED` 503 = công tắc tắt, mẫu N42). Thân gửi đi cũng qua schema
 * (`CreateDrawingSetSchema`, `ReplaceViewsSchema`…) ở nơi dựng, nên một thân sai hình là lỗi lập trình
 * lộ ngay ở test chứ không phải 422 từ máy chủ.
 */

import { createAppHttpClient, resolveUseMockApi } from '@/api/appClient';
import { ENDPOINTS } from '@/api/endpoints';
import { createMockDrawingSetClient } from '@/api/__mocks__/drawingSetClient';
import { decode } from '@/api/schemas/decode';
import {
  DrawingSetFileSchema,
  DrawingSetSchema,
  DrawingSetSummaryPageSchema,
  type CreateDrawingSet,
  type DrawingSet,
  type DrawingSetFile,
  type DrawingSetSummaryPage,
  type ViewEdit,
} from '@/api/schemas/drawingSet';
import { SetBuildingSchema, type BuildingDecisions, type SetBuilding } from '@/api/schemas/setBuilding';
import type { HttpClient, HttpError, Result } from '@/lib/http';

import type { ApiResult } from './client';

interface Cancellable {
  readonly signal?: AbortSignal | undefined;
}

interface SetRef extends Cancellable {
  readonly projectId: string;
  readonly setId: string;
}

export interface CreateDrawingSetInput extends Cancellable {
  readonly projectId: string;
  readonly body: CreateDrawingSet;
}

export interface SendDrawingSetChunkInput extends SetRef {
  readonly fileId: string;
  readonly chunk: string;
  readonly chunkIndex: number;
}

export interface ListDrawingSetsInput extends Cancellable {
  readonly projectId: string;
  readonly cursor?: string | undefined;
  readonly limit?: number | undefined;
}

export interface ReplaceDrawingSetViewsInput extends SetRef {
  /** `revision` mà người duyệt đã thấy (thiếu → 428, cũ → 409 `VERSION_CONFLICT`). */
  readonly baseVersion: number;
  readonly views: readonly ViewEdit[];
  /** Tên mới của bộ (đã trim, 1–120 ký tự); vắng = giữ tên hiện có. */
  readonly name?: string | undefined;
  /** Quyết định trên đề xuất ngôi nhà; vắng = giữ bản đã lưu, có = thay cả bản. */
  readonly building?: BuildingDecisions | undefined;
}

export interface ConfirmDrawingSetInput extends SetRef {
  readonly revision: number;
}

export interface DrawingSetClient {
  /** N54 — khai 1–20 tệp, 201 `receiving`. Hạn mức 10 bộ/10 phút (429 trả ngay). */
  createSet(input: CreateDrawingSetInput): Promise<ApiResult<DrawingSet>>;
  /** N55 — một khúc của một tệp (ghi đè theo `(tệp, chunkIndex)`). */
  sendChunk(input: SendDrawingSetChunkInput): Promise<ApiResult<DrawingSetFile>>;
  /** N56 — chốt; máy chủ kiểm từng tệp rồi xếp tác vụ đọc bộ (`analyzing`). Idempotent. */
  complete(input: SetRef): Promise<ApiResult<DrawingSet>>;
  /** N57 — màn "Duyệt bộ hồ sơ"; thăm dò 2 giây khi `analyzing`. */
  read(input: SetRef): Promise<ApiResult<DrawingSet>>;
  /** NHA-06 — đề xuất ngôi nhà của bộ (tầng, mái, mâu thuẫn, vi phạm) kèm quyết định đã lưu. */
  readBuilding(input: SetRef): Promise<ApiResult<SetBuilding>>;
  /** N58 — mới trước, trần 20, `cursor` tuỳ chọn. */
  list(input: ListDrawingSetsInput): Promise<ApiResult<DrawingSetSummaryPage>>;
  /** N59 — lưu bản duyệt (thay cả danh sách hình); chỉ khi `review`. */
  replaceViews(input: ReplaceDrawingSetViewsInput): Promise<ApiResult<DrawingSet>>;
  /** N60 — "Xác nhận và dựng": tạo tầng và lần tải, xếp xử lý sau commit. Idempotent. */
  confirm(input: ConfirmDrawingSetInput): Promise<ApiResult<DrawingSet>>;
  /** N61 — "Bỏ bộ này": xoá mềm, tầng đã tạo giữ nguyên. Idempotent. */
  remove(input: SetRef): Promise<ApiResult<DrawingSet>>;
}

const withSignal = (signal: AbortSignal | undefined): { signal?: AbortSignal } =>
  signal === undefined ? {} : { signal };

/** Lỗi dây đi nguyên; thân thành công qua schema. */
function decodeBody<T>(result: Result<unknown, HttpError>, read: (data: unknown) => ApiResult<T>): ApiResult<T> {
  return result.ok ? read(result.data) : result;
}

export function createDrawingSetClient(http: HttpClient): DrawingSetClient {
  const asSet = (result: Result<unknown, HttpError>, source: string): ApiResult<DrawingSet> =>
    decodeBody(result, (data) => decode(DrawingSetSchema, data, source));

  return {
    createSet: async ({ body, projectId, signal }) =>
      asSet(
        await http.post<unknown, CreateDrawingSet>(ENDPOINTS.drawingSets.root(projectId), {
          body,
          failFastOnRateLimit: true,
          idempotent: true,
          ...withSignal(signal),
        }),
        'drawingSets.createSet',
      ),

    // `idempotent` vắng: ghi đè theo (tệp, chunkIndex) đã an toàn khi gửi lại, nhưng khóa lặp là việc của
    // vòng thử lại ở `lib/upload/drawingSetUpload.ts`, không phải của tầng http.
    sendChunk: async ({ chunk, chunkIndex, fileId, projectId, setId, signal }) =>
      decodeBody(
        await http.post<unknown, { chunk: string; chunkIndex: number }>(
          ENDPOINTS.drawingSets.chunk(projectId, setId, fileId),
          { body: { chunk, chunkIndex }, timeoutMode: 'file', ...withSignal(signal) },
        ),
        (data) => decode(DrawingSetFileSchema, data, 'drawingSets.sendChunk'),
      ),

    complete: async ({ projectId, setId, signal }) =>
      asSet(
        await http.post<unknown, { setId: string }>(ENDPOINTS.drawingSets.complete(projectId, setId), {
          body: { setId },
          idempotent: true,
          ...withSignal(signal),
        }),
        'drawingSets.complete',
      ),

    read: async ({ projectId, setId, signal }) =>
      asSet(await http.get<unknown>(ENDPOINTS.drawingSets.set(projectId, setId), withSignal(signal)), 'drawingSets.read'),

    readBuilding: async ({ projectId, setId, signal }) =>
      decodeBody(await http.get<unknown>(ENDPOINTS.drawingSets.building(projectId, setId), withSignal(signal)), (data) =>
        decode(SetBuildingSchema, data, 'drawingSets.readBuilding'),
      ),

    list: async ({ cursor, limit, projectId, signal }) =>
      decodeBody(
        await http.get<unknown>(ENDPOINTS.drawingSets.root(projectId), {
          query: { ...(cursor !== undefined ? { cursor } : {}), ...(limit !== undefined ? { limit } : {}) },
          ...withSignal(signal),
        }),
        (data) => decode(DrawingSetSummaryPageSchema, data, 'drawingSets.list'),
      ),

    replaceViews: async ({ baseVersion, building, name, projectId, setId, signal, views }) =>
      asSet(
        await http.put<
          unknown,
          { baseVersion: number; body: { views: readonly ViewEdit[]; name?: string; building?: BuildingDecisions } }
        >(ENDPOINTS.drawingSets.views(projectId, setId), {
          body: {
            baseVersion,
            body: { views, ...(name !== undefined ? { name } : {}), ...(building !== undefined ? { building } : {}) },
          },
          ...withSignal(signal),
        }),
        'drawingSets.replaceViews',
      ),

    confirm: async ({ projectId, revision, setId, signal }) =>
      asSet(
        await http.post<unknown, { setId: string; revision: number }>(ENDPOINTS.drawingSets.confirm(projectId, setId), {
          body: { setId, revision },
          idempotent: true,
          ...withSignal(signal),
        }),
        'drawingSets.confirm',
      ),

    remove: async ({ projectId, setId, signal }) =>
      asSet(
        await http.delete<unknown>(ENDPOINTS.drawingSets.set(projectId, setId), {
          idempotent: true,
          ...withSignal(signal),
        }),
        'drawingSets.remove',
      ),
  };
}

/**
 * Client của ứng dụng: bộ mẫu dưới `VITE_USE_MOCK_API`, còn lại client thật trên `createAppHttpClient()`.
 * `import.meta.env.DEV` viết thẳng tại chỗ gọi (cùng lý do `createAppAdminMlClient`): bản dựng bỏ nhánh mock.
 */
export function createAppDrawingSetClient(useMock: boolean = resolveUseMockApi()): DrawingSetClient {
  return import.meta.env.DEV && useMock ? createMockDrawingSetClient() : createDrawingSetClient(createAppHttpClient());
}
