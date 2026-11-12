export type MaybePromise<T> = T | Promise<T>;

export type Result<T, E> =
  | {
      ok: true;
      data: T;
    }
  | {
      ok: false;
      error: E;
    };

export type HttpMethod = 'GET' | 'POST' | 'PATCH' | 'PUT' | 'DELETE';

export type HttpErrorKind = 'network' | 'timeout' | 'aborted' | 'auth' | 'http' | 'parse';

export interface HttpError {
  kind: HttpErrorKind;
  status?: number;
  code?: string;
  requestId: string;
  retryable: boolean;
  raw: unknown;
  /**
   * Số giây của header `Retry-After`, làm tròn lên, chỉ có khi lỗi `kind: 'http'`
   * mang header đọc được. Không có header thì khoá **vắng** hẳn, không phải
   * `undefined`: `exactOptionalPropertyTypes` bật và nơi gọi so `toStrictEqual`.
   *
   * **Bị chặn trên ở 120 s.** Giá trị đi qua `parseRetryAfterMs`, và hàm đó kẹp
   * kết quả vào `MAX_RETRY_AFTER_DELAY_MS` (`./retry.ts:7,40`), nên một header
   * `Retry-After: 300` đọc ra **120**, không phải 300. Trần này không cắn ở
   * đường thật: BE-00 W9 giới hạn `Retry-After` ở 10 s trở xuống — nó là lưới
   * chặn cho một server nói quá, không phải một phép quy đổi.
   *
   * Màn từ W08 rẽ theo `code` rồi đọc số này để nói còn phải chờ bao lâu (BE-00
   * W7, W17; HOP-DONG-MOI §1.1). Luật thử lại vẫn ở `./retry.ts`, không ở đây.
   */
  retryAfterSeconds?: number;
}

export type HttpFetch = (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;

export type QueryParamValue =
  | string
  | number
  | boolean
  | null
  | undefined
  | readonly (string | number | boolean | null | undefined)[];

export type HttpTimeoutMode = 'default' | 'file' | 'stream';

export type HttpResponseType = 'auto' | 'json' | 'text' | 'blob' | 'arrayBuffer' | 'response' | 'textWithHeaders';

/**
 * `responseType: 'textWithHeaders'`: thân đọc TRONG vòng đời request (timeout/huỷ vẫn cắt được lúc thân đang về) và
 * single-flight chia sẻ dữ liệu đã đọc — không chia sẻ một `Response` mà chỉ người đầu đọc được thân (danh sách có
 * con trỏ trong header: thông báo, thư viện).
 */
export interface TextWithHeaders {
  readonly headers: Headers;
  readonly text: string;
}

export interface HttpRequestOptions<TBody = undefined> {
  body?: TBody;
  headers?: HeadersInit;
  idempotencyKey?: string;
  idempotent?: boolean;
  /**
   * A 429 comes back at once, with `retryAfterSeconds`, instead of riding the retry ladder.
   * For a write a person just clicked: the screen states the limit and locks the button now,
   * not after the ladder's waits (BUG-510). Off by default — writes the app sends by itself
   * (offline replay, background jobs) keep waiting the limit out.
   */
  failFastOnRateLimit?: boolean;
  disableSingleFlight?: boolean;
  query?: Record<string, QueryParamValue>;
  responseType?: HttpResponseType;
  signal?: AbortSignal;
  singleFlightKey?: string;
  timeoutMode?: HttpTimeoutMode;
  timeoutMs?: number;
}

export interface HttpDoneEvent {
  durationMs: number;
  endedAt: number;
  errorKind?: HttpErrorKind;
  method: HttpMethod;
  ok: boolean;
  requestId: string;
  retryCount: number;
  startedAt: number;
  status?: number;
  url: string;
}

export interface HttpEventMap {
  'http:done': HttpDoneEvent;
}

export interface HttpEventEmitter {
  emit<K extends keyof HttpEventMap>(eventName: K, payload: HttpEventMap[K]): void;
  on<K extends keyof HttpEventMap>(
    eventName: K,
    listener: (payload: HttpEventMap[K]) => void,
  ): () => void;
}

export interface RequestLogEntry {
  requestId: string;
  url: string;
}

export interface HttpClient {
  delete<TRes, TBody = undefined>(
    path: string,
    options?: HttpRequestOptions<TBody>,
  ): Promise<Result<TRes, HttpError>>;
  events: HttpEventEmitter;
  get<TRes>(path: string, options?: Omit<HttpRequestOptions, 'body'>): Promise<Result<TRes, HttpError>>;
  getRecentRequests(): readonly RequestLogEntry[];
  patch<TRes, TBody = undefined>(
    path: string,
    options?: HttpRequestOptions<TBody>,
  ): Promise<Result<TRes, HttpError>>;
  post<TRes, TBody = undefined>(
    path: string,
    options?: HttpRequestOptions<TBody>,
  ): Promise<Result<TRes, HttpError>>;
  put<TRes, TBody = undefined>(
    path: string,
    options?: HttpRequestOptions<TBody>,
  ): Promise<Result<TRes, HttpError>>;
}

export interface CreateHttpClientOptions {
  baseUrl: string;
  fetchImpl?: HttpFetch;
  getToken?: () => MaybePromise<string | null | undefined>;
  onAuthError?: (error: HttpError) => MaybePromise<void>;
  onRefreshToken?: () => MaybePromise<boolean>;
}

export const ok = <T>(data: T): Result<T, never> => ({ ok: true, data });

export const err = <E>(error: E): Result<never, E> => ({ ok: false, error });
