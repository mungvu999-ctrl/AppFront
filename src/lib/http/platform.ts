/**
 * Nơi duy nhất trong ứng dụng chạm vào transport của trình duyệt.
 *
 * `client.ts` là thứ hầu hết mã nên gọi: nó có timeout, retry, single-flight và
 * hình dạng lỗi chuẩn. Nhưng có vài chỗ thật sự cần transport trần, và cần vì lý
 * do đúng đắn:
 *
 * - tầng auth dựng client của chính nó, nên không thể mượn một client đã cấu hình
 *   sẵn mà không quay vòng;
 * - ping kiểm tra online phải KHÔNG retry — retry đúng là thứ làm hỏng phép đo;
 * - telemetry lúc đóng tab cần `sendBeacon`, thứ duy nhất trình duyệt hứa gửi nốt.
 *
 * Trước đây mỗi chỗ tự với tay lên `globalThis.fetch` hay `navigator.sendBeacon`.
 * Ba bản sao của cùng một quyết định, nằm ở ba tầng khác nhau, không chỗ nào biết
 * chỗ nào — và không có gì ngăn cái thứ tư mọc lên. Giờ chúng nhận từ đây, nên
 * `local/no-fetch-outside-http` có thể cấm phần còn lại của repo mà không cần
 * miễn trừ cho file nào.
 *
 * Đây là chỗ *tra cứu* transport, không phải chỗ *đi qua* transport. Cần timeout
 * và retry thì dùng `createHttpClient`, đừng dùng file này.
 */

/** `navigator.sendBeacon`, thu hẹp còn đúng thứ nơi gọi cần. */
export type PlatformBeacon = (url: string, body: BodyInit) => boolean;

/**
 * `fetch` của trình duyệt, đã bind, hoặc `null` khi môi trường không có.
 *
 * Bind là bắt buộc: `fetch` là method của global object và ném `TypeError` nếu
 * bị gọi rời khỏi chủ của nó.
 */
export function getPlatformFetch(): typeof fetch | null {
  if (typeof globalThis.fetch !== 'function') {
    return null;
  }

  return globalThis.fetch.bind(globalThis);
}

/**
 * Như trên, nhưng không có thì hỏng ngay tại chỗ cấu hình.
 *
 * Dành cho nơi mà thiếu transport là lỗi cấu hình chứ không phải một trạng thái
 * chạy được: hỏng lúc dựng, kèm câu nói rõ ai cần gì, vẫn hơn hỏng lúc gửi
 * request đầu tiên với một `undefined is not a function`.
 */
export function requirePlatformFetch(message: string): typeof fetch {
  const platformFetch = getPlatformFetch();

  if (platformFetch === null) {
    throw new Error(message);
  }

  return platformFetch;
}

/** Khoá trên global object: mỗi tài liệu một lớp chặn, kể cả khi hai gói dựng (SPA + Pascal) cùng nạp file này. */
const INTERCEPTOR_KEY = Symbol.for('appfront.platformFetchInterceptor');

/** Lớp chặn `fetch` toàn cục: nhận request gốc và `next` (fetch gốc đã bind), trả phản hồi thay thế. */
export type FetchInterceptor = (input: RequestInfo | URL, init: RequestInit | undefined, next: typeof fetch) => Promise<Response>;

/**
 * Đặt MỘT lớp chặn lên `globalThis.fetch` của tài liệu — điểm chung của mọi mã gọi `fetch` tự do, kể cả các bản three
 * nằm trong các gói dựng khác nhau (FileLoader gọi `fetch(req)` mỗi lần tải). Trả hàm gỡ; `null` khi không có fetch
 * hoặc tài liệu đã có lớp chặn (gói khác đặt trước — lớp ấy thắng).
 */
export function interceptPlatformFetch(interceptor: FetchInterceptor): (() => void) | null {
  const root = globalThis as unknown as Record<symbol, unknown> & { fetch?: typeof fetch };
  const original = root.fetch;
  if (typeof original !== 'function' || root[INTERCEPTOR_KEY] !== undefined) return null;
  const next = original.bind(globalThis);
  const wrapped: typeof fetch = (input, init) => interceptor(input, init, next);
  root.fetch = wrapped;
  root[INTERCEPTOR_KEY] = wrapped;
  return () => {
    if (root.fetch === wrapped) root.fetch = original;
    if (root[INTERCEPTOR_KEY] === wrapped) delete root[INTERCEPTOR_KEY];
  };
}

/**
 * `navigator.sendBeacon`, đã bind, hoặc `null` khi trình duyệt không có.
 *
 * `null` là câu trả lời bình thường, không phải lỗi: nơi gọi được kỳ vọng lùi về
 * đường gửi thường.
 */
export function getPlatformBeacon(): PlatformBeacon | null {
  if (typeof navigator === 'undefined' || typeof navigator.sendBeacon !== 'function') {
    return null;
  }

  return navigator.sendBeacon.bind(navigator);
}
