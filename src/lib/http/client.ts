/// <reference types="vite/client" />

import { createIdempotencyKey, createRequestId } from './ids';
import {
  computeRetryDelayMs,
  isRetryableMethod,
  isTransientStatus,
  parseRetryAfterMs,
  shouldRetryRequest,
  waitForRetry,
} from './retry';
import { createSingleFlight } from './singleFlight';
import { createManagedAbortSignal, resolveTimeoutMs } from './timeout';
import { err, ok } from './types';
import type {
  CreateHttpClientOptions,
  HttpClient,
  HttpDoneEvent,
  HttpError,
  HttpEventEmitter,
  HttpMethod,
  HttpRequestOptions,
  HttpResponseType,
  QueryParamValue,
  RequestLogEntry,
  Result,
} from './types';

const REQUEST_ID_HEADER = 'X-Request-Id';
const CLIENT_VERSION_HEADER = 'X-Client-Version';
const IDEMPOTENCY_KEY_HEADER = 'Idempotency-Key';
const AUTHORIZATION_HEADER = 'Authorization';
const MAX_REQUEST_LOG_SIZE = 50;
const MAX_TEXT_RESPONSE_BYTES = 30 * 1024 * 1024;
const SENSITIVE_QUERY_PARAM_RE = /(token|secret|jwt|api[_-]?key)/i;

interface RequestLogBuffer {
  push: (entry: RequestLogEntry) => void;
  snapshot: () => RequestLogEntry[];
}

const resolveClientVersion = (): string =>
  import.meta.env.VITE_APP_VERSION ??
  import.meta.env.VITE_CLIENT_VERSION ??
  import.meta.env.MODE ??
  'unknown';

const isBinaryBody = (body: unknown): body is Blob | ArrayBuffer | ArrayBufferView =>
  body instanceof Blob || body instanceof ArrayBuffer || ArrayBuffer.isView(body);

const isRequestBodyInit = (body: unknown): body is BodyInit =>
  typeof body === 'string' ||
  body instanceof FormData ||
  body instanceof URLSearchParams ||
  body instanceof ReadableStream ||
  isBinaryBody(body);

const isJsonContentType = (contentType: string | null): boolean =>
  Boolean(contentType && /(^|\/|\+)json($|;)/i.test(contentType));

const hasScheme = (path: string): boolean => /^[a-z][a-z0-9+.-]*:\/\//i.test(path);

const resolveRequestUrl = (baseUrl: URL, path: string): URL => {
  if (hasScheme(path)) {
    return new URL(path);
  }

  const basePath = baseUrl.pathname.replace(/\/+$/, '');

  if (basePath && (path === basePath || path.startsWith(`${basePath}/`))) {
    return new URL(path, baseUrl);
  }

  const joinedPath = `${basePath}/${path.replace(/^\/+/, '')}`;

  return new URL(joinedPath, baseUrl);
};

const buildUrl = (
  baseUrl: URL,
  path: string,
  query?: Record<string, QueryParamValue>,
): URL => {
  const url = resolveRequestUrl(baseUrl, path);

  if (!query) {
    return url;
  }

  Object.entries(query).forEach(([key, value]) => {
    if (value === undefined || value === null) {
      return;
    }

    const values = Array.isArray(value) ? value : [value];
    values.forEach((item) => {
      if (item === undefined || item === null) {
        return;
      }

      url.searchParams.append(key, String(item));
    });
  });

  return url;
};

const sanitizeLoggedUrl = (url: URL): string => {
  const sanitizedUrl = new URL(url.toString());
  const sanitizedParams = new URLSearchParams();

  for (const [key, value] of url.searchParams.entries()) {
    sanitizedParams.append(key, SENSITIVE_QUERY_PARAM_RE.test(key) ? '*****' : value);
  }

  sanitizedUrl.search = sanitizedParams.toString();

  return sanitizedUrl.toString();
};

const createRequestLogBuffer = (capacity: number): RequestLogBuffer => {
  const entries = new Array<RequestLogEntry | undefined>(capacity);
  let size = 0;
  let start = 0;

  return {
    push: (entry: RequestLogEntry) => {
      if (capacity <= 0) {
        return;
      }

      if (size < capacity) {
        entries[(start + size) % capacity] = entry;
        size += 1;
        return;
      }

      entries[start] = entry;
      start = (start + 1) % capacity;
    },
    snapshot: () => {
      const snapshot: RequestLogEntry[] = [];

      for (let index = 0; index < size; index += 1) {
        const entry = entries[(start + index) % capacity];
        if (entry) {
          snapshot.push(entry);
        }
      }

      return snapshot;
    },
  };
};

const extractErrorCode = (raw: unknown): string | undefined => {
  if (!raw || typeof raw !== 'object') {
    return undefined;
  }

  const code = (raw as Record<string, unknown>).code ?? (raw as Record<string, unknown>).errorCode;

  if (typeof code === 'string') {
    return code;
  }

  if (typeof code === 'number') {
    return String(code);
  }

  return undefined;
};

const normalizeError = (error: unknown): Error => {
  if (error instanceof Error) {
    return error;
  }

  return new Error('Unknown HTTP error');
};

const createHttpError = ({
  code,
  kind,
  raw,
  requestId,
  retryable,
  retryAfterSeconds,
  status,
}: {
  code?: string;
  kind: HttpError['kind'];
  raw: unknown;
  requestId: string;
  retryable: boolean;
  retryAfterSeconds?: number;
  status?: number;
}): HttpError => ({
  kind,
  raw,
  requestId,
  retryable,
  ...(code ? { code } : {}),
  ...(typeof status === 'number' ? { status } : {}),
  ...(typeof retryAfterSeconds === 'number' ? { retryAfterSeconds } : {}),
});

const serializeBody = (body: unknown, headers: Headers): BodyInit | undefined => {
  if (body === undefined) {
    return undefined;
  }

  if (isRequestBodyInit(body)) {
    return body;
  }

  if (!headers.has('Content-Type')) {
    headers.set('Content-Type', 'application/json');
  }

  return JSON.stringify(body);
};

const getDeclaredContentLength = (response: Response): number | null => {
  const contentLength = response.headers.get('Content-Length');

  if (!contentLength) {
    return null;
  }

  const parsedLength = Number(contentLength);

  if (!Number.isFinite(parsedLength) || parsedLength < 0) {
    return null;
  }

  return parsedLength;
};

const shouldBlockTextRead = (responseType: HttpResponseType, response: Response): boolean => {
  if (responseType === 'response' || responseType === 'blob' || responseType === 'arrayBuffer') {
    return false;
  }

  const declaredLength = getDeclaredContentLength(response);

  return declaredLength !== null && declaredLength > MAX_TEXT_RESPONSE_BYTES;
};

const readResponseBody = async <TRes>(
  response: Response,
  responseType: HttpResponseType = 'auto',
): Promise<TRes> => {
  if (responseType === 'response') {
    return response as TRes;
  }

  if (responseType === 'textWithHeaders') {
    if (shouldBlockTextRead(responseType, response)) {
      throw Object.assign(new Error('Response body exceeds text parsing limit'), { name: 'PayloadTooLargeError' });
    }
    return { headers: response.headers, text: await response.text() } as TRes;
  }

  if (response.status === 204 || response.status === 205) {
    return undefined as TRes;
  }

  const contentLength = response.headers.get('Content-Length');

  if (contentLength === '0') {
    return undefined as TRes;
  }

  if (shouldBlockTextRead(responseType, response)) {
    throw Object.assign(new Error('Response body exceeds text parsing limit'), {
      name: 'PayloadTooLargeError',
    });
  }

  if (responseType === 'blob') {
    return (await response.blob()) as TRes;
  }

  if (responseType === 'arrayBuffer') {
    return (await response.arrayBuffer()) as TRes;
  }

  if (responseType === 'text') {
    return (await response.text()) as TRes;
  }

  const rawText = await response.text();

  if (rawText.length === 0) {
    return undefined as TRes;
  }

  if (responseType === 'json') {
    return JSON.parse(rawText) as TRes;
  }

  if (isJsonContentType(response.headers.get('Content-Type'))) {
    return JSON.parse(rawText) as TRes;
  }

  return rawText as TRes;
};

const isAbortError = (error: unknown): boolean => error instanceof Error && error.name === 'AbortError';

const isTimeoutError = (error: unknown): boolean =>
  error instanceof Error && error.name === 'TimeoutError';

const createEmitter = (): HttpEventEmitter => {
  const listeners = new Map<string, Set<(payload: unknown) => void>>();

  return {
    emit: (eventName, payload) => {
      listeners.get(eventName)?.forEach((listener) => listener(payload));
    },
    on: (eventName, listener) => {
      const typedListeners = listeners.get(eventName) ?? new Set<(payload: unknown) => void>();
      typedListeners.add(listener as (payload: unknown) => void);
      listeners.set(eventName, typedListeners);

      return () => {
        typedListeners.delete(listener as (payload: unknown) => void);

        if (typedListeners.size === 0) {
          listeners.delete(eventName);
        }
      };
    },
  };
};

const ensureBodyAllowed = (method: HttpMethod, body: unknown): void => {
  if (method === 'GET' && body !== undefined) {
    throw new Error('GET requests cannot include a body');
  }
};

const readErrorPayload = async (response: Response): Promise<unknown> => {
  try {
    return await readResponseBody<unknown>(response);
  } catch (error) {
    return normalizeError(error);
  }
};

export const createHttpClient = ({
  baseUrl,
  fetchImpl = globalThis.fetch.bind(globalThis),
  getToken,
  onAuthError,
  onRefreshToken,
}: CreateHttpClientOptions): HttpClient => {
  const base = new URL(baseUrl);
  const events = createEmitter();
  const requestLog = createRequestLogBuffer(MAX_REQUEST_LOG_SIZE);
  const runSingleFlight = createSingleFlight();
  const authRefreshFlight = createSingleFlight();
  const clientVersion = resolveClientVersion();

  const attemptRefreshToken = async (): Promise<boolean> => {
    if (!onRefreshToken) {
      return false;
    }

    return authRefreshFlight('auth-refresh', async () => {
      try {
        return Boolean(await onRefreshToken());
      } catch {
        return false;
      }
    });
  };

  const executeRequest = async <TRes, TBody = undefined>(
    method: HttpMethod,
    url: URL,
    options: HttpRequestOptions<TBody>,
  ): Promise<Result<TRes, HttpError>> => {
    const requestId = createRequestId();
    const loggedUrl = sanitizeLoggedUrl(url);
    requestLog.push({ requestId, url: loggedUrl });

    const normalizedTimeoutMs = resolveTimeoutMs(options.timeoutMode, options.timeoutMs);
    const managedAbortSignal = createManagedAbortSignal(
      options.signal
        ? {
            externalSignal: options.signal,
            timeoutMs: normalizedTimeoutMs,
          }
        : {
            timeoutMs: normalizedTimeoutMs,
          },
    );

    const startedAt = Date.now();
    let lastStatus: number | undefined;
    let retryCount = 0;
    let errorKind: HttpError['kind'] | undefined;
    let refreshedOnce = false;
    let attemptIndex = 0;

    const explicitIdempotencyKey =
      typeof options.idempotencyKey === 'string' && options.idempotencyKey.length > 0
        ? options.idempotencyKey
        : undefined;
    const generatedIdempotencyKey = method === 'PUT' || options.idempotent ? createIdempotencyKey() : undefined;
    const idempotencyKey = explicitIdempotencyKey ?? generatedIdempotencyKey;

    const baseHeaders = new Headers(options.headers);
    baseHeaders.set(REQUEST_ID_HEADER, requestId);
    baseHeaders.set(CLIENT_VERSION_HEADER, clientVersion);
    if (idempotencyKey) {
      baseHeaders.set(IDEMPOTENCY_KEY_HEADER, idempotencyKey);
    }
    const requestBody = serializeBody(options.body, baseHeaders);

    /**
     * Waits out the retry backoff without ever rejecting: `waitForRetry` rejects with the
     * abort reason when the signal fires mid-wait, and `executeRequest` promises a `Result`
     * in every case. Returns the matching `HttpError` when the wait was cut short.
     */
    const awaitRetryDelay = async (delayMs: number): Promise<HttpError | undefined> => {
      try {
        await waitForRetry(delayMs, managedAbortSignal.signal);

        return undefined;
      } catch (waitError) {
        const normalizedWaitError = normalizeError(waitError);
        const timedOut = managedAbortSignal.isTimeout() || isTimeoutError(normalizedWaitError);

        return createHttpError({
          kind: timedOut ? 'timeout' : 'aborted',
          raw: normalizedWaitError,
          requestId,
          retryable: false,
        });
      }
    };

    try {
      for (;;) {
        const headers = new Headers(baseHeaders);

        const token = await getToken?.();
        if (token) {
          headers.set(AUTHORIZATION_HEADER, `Bearer ${token}`);
        }

        try {
          const response = await fetchImpl(url, {
            headers,
            method,
            signal: managedAbortSignal.signal,
            ...(requestBody !== undefined ? { body: requestBody } : {}),
          });

          lastStatus = response.status;

          if (!response.ok) {
            if (response.status === 401) {
              const canRefresh = Boolean(onRefreshToken) && !refreshedOnce;
              if (canRefresh) {
                const refreshed = await attemptRefreshToken();
                if (refreshed) {
                  refreshedOnce = true;
                  retryCount += 1;
                  continue;
                }
              }

              const raw = await readErrorPayload(response);
              const errorCode = extractErrorCode(raw);
              const authError = createHttpError({
                kind: 'auth',
                raw,
                requestId: response.headers.get(REQUEST_ID_HEADER) ?? requestId,
                retryable: false,
                status: response.status,
                ...(errorCode ? { code: errorCode } : {}),
              });

              await onAuthError?.(authError);
              errorKind = authError.kind;
              return err(authError);
            }

            const raw = await readErrorPayload(response);
            const errorCode = extractErrorCode(raw);
            // "May the caller ask again?", not "will this client ask again?": the ladder
            // running out made every 5xx read final, and no screen offered "Thử lại" (BUG-509).
            const retryable =
              isRetryableMethod(method, idempotencyKey) && isTransientStatus(response.status);
            const retryAfterMs = parseRetryAfterMs(response.headers.get('Retry-After'));
            const httpError = createHttpError({
              kind: 'http',
              raw,
              requestId: response.headers.get(REQUEST_ID_HEADER) ?? requestId,
              retryable,
              status: response.status,
              ...(errorCode ? { code: errorCode } : {}),
              ...(retryAfterMs !== null ? { retryAfterSeconds: Math.ceil(retryAfterMs / 1000) } : {}),
            });

            const rateLimitIsFinal = options.failFastOnRateLimit === true && response.status === 429;

            if (
              !rateLimitIsFinal &&
              shouldRetryRequest({
                attemptIndex,
                method,
                status: response.status,
                ...(idempotencyKey ? { idempotencyKey } : {}),
              })
            ) {
              const delayMs = computeRetryDelayMs(attemptIndex, response.headers.get('Retry-After'));
              // A wait the deadline would cut short ends in `timeout` and hides the server's
              // real answer — a 429 with Retry-After read "phản hồi quá lâu" (BUG-510).
              const outlivesDeadline =
                normalizedTimeoutMs > 0 && Date.now() - startedAt + delayMs >= normalizedTimeoutMs;

              if (!outlivesDeadline) {
                retryCount += 1;
                attemptIndex += 1;
                const waitFailure = await awaitRetryDelay(delayMs);
                if (waitFailure) {
                  errorKind = waitFailure.kind;
                  return err(waitFailure);
                }
                continue;
              }
            }

            errorKind = httpError.kind;
            return err(httpError);
          }

          try {
            const data = await readResponseBody<TRes>(response, options.responseType);
            errorKind = undefined;
            return ok(data);
          } catch (parseError) {
            // The signal fired while the body was still streaming: an abort (or the deadline),
            // not a malformed answer. Rethrown, the catch below names it so, and a single-flight
            // joiner sees `aborted` and asks again on its own signal instead of keeping a
            // phantom read error (BUG-514).
            if (managedAbortSignal.signal.aborted) {
              throw parseError;
            }

            const responseRequestId = response.headers.get(REQUEST_ID_HEADER) ?? requestId;
            const parseHttpError = createHttpError({
              kind: 'parse',
              raw: normalizeError(parseError),
              requestId: responseRequestId,
              retryable: false,
              status: response.status,
            });

            errorKind = parseHttpError.kind;
            return err(parseHttpError);
          }
        } catch (requestError) {
          const normalizedError = normalizeError(requestError);

          if (managedAbortSignal.isTimeout() || isTimeoutError(normalizedError)) {
            const timeoutError = createHttpError({
              kind: 'timeout',
              raw: normalizedError,
              requestId,
              retryable: false,
            });
            errorKind = timeoutError.kind;
            return err(timeoutError);
          }

          if (managedAbortSignal.signal.aborted || isAbortError(normalizedError)) {
            const abortedError = createHttpError({
              kind: 'aborted',
              raw: normalizedError,
              requestId,
              retryable: false,
            });
            errorKind = abortedError.kind;
            return err(abortedError);
          }

          if (
            shouldRetryRequest({
              attemptIndex,
              error: normalizedError,
              method,
              ...(idempotencyKey ? { idempotencyKey } : {}),
            })
          ) {
            retryCount += 1;
            const delayMs = computeRetryDelayMs(attemptIndex, null);
            attemptIndex += 1;
            const waitFailure = await awaitRetryDelay(delayMs);
            if (waitFailure) {
              errorKind = waitFailure.kind;
              return err(waitFailure);
            }
            continue;
          }

          const networkError = createHttpError({
            kind: 'network',
            raw: normalizedError,
            requestId,
            retryable: isRetryableMethod(method, idempotencyKey),
          });
          errorKind = networkError.kind;
          return err(networkError);
        }
      }
    } finally {
      managedAbortSignal.cleanup();
      const endedAt = Date.now();
      const payload: HttpDoneEvent = {
        durationMs: endedAt - startedAt,
        endedAt,
        method,
        ok: errorKind === undefined,
        requestId,
        retryCount,
        startedAt,
        url: loggedUrl,
        ...(errorKind ? { errorKind } : {}),
        ...(typeof lastStatus === 'number' ? { status: lastStatus } : {}),
      };
      events.emit('http:done', payload);
    }
  };

  const request = async <TRes, TBody = undefined>(
    method: HttpMethod,
    path: string,
    options: HttpRequestOptions<TBody> = {},
  ): Promise<Result<TRes, HttpError>> => {
    ensureBodyAllowed(method, options.body);

    const url = buildUrl(base, path, options.query);
    const shouldUseSingleFlight = method === 'GET' && !options.disableSingleFlight;

    if (shouldUseSingleFlight) {
      const singleFlightKey = options.singleFlightKey && options.singleFlightKey.length > 0
        ? options.singleFlightKey
        : // responseType in the key: `list()` (JSON) and `listPage()` (text + headers) on one URL
          // must not hand each other a result of the other shape.
          `${method}:${options.responseType ?? 'auto'}:${url.toString()}`;

      const shared = await runSingleFlight(singleFlightKey, () =>
        executeRequest<TRes, TBody>(method, url, options),
      );

      // The flight runs on its INITIATOR's signal. When that caller walks away (an
      // unmount, StrictMode's double mount) every caller that joined it inherited the
      // abort — ShareDialog opened on "bị huỷ" with a healthy server (B-V3-04). A
      // caller that did not abort asks again, on its own signal.
      if (!shared.ok && shared.error.kind === 'aborted' && options.signal?.aborted !== true) {
        return executeRequest<TRes, TBody>(method, url, options);
      }

      return shared;
    }

    return executeRequest<TRes, TBody>(method, url, options);
  };

  return {
    delete: <TRes, TBody = undefined>(path: string, options?: HttpRequestOptions<TBody>) =>
      request<TRes, TBody>('DELETE', path, options),
    events,
    get: <TRes>(path: string, options?: Omit<HttpRequestOptions, 'body'>) =>
      request<TRes>('GET', path, options),
    getRecentRequests: () => requestLog.snapshot(),
    patch: <TRes, TBody = undefined>(path: string, options?: HttpRequestOptions<TBody>) =>
      request<TRes, TBody>('PATCH', path, options),
    post: <TRes, TBody = undefined>(path: string, options?: HttpRequestOptions<TBody>) =>
      request<TRes, TBody>('POST', path, options),
    put: <TRes, TBody = undefined>(path: string, options?: HttpRequestOptions<TBody>) =>
      request<TRes, TBody>('PUT', path, options),
  };
};



