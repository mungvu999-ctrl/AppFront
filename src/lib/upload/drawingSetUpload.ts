/**
 * Tải cả bộ hồ sơ (K-32b, N54–N56): kiểm giới hạn trước khi gửi byte nào, rồi
 * `createSet` → từng khúc của từng tệp → `complete`.
 *
 * Hai nửa, cùng một nơi vì cùng một bộ số:
 *
 * - {@link checkDrawingSetBatch} — phép kiểm THUẦN trên danh sách tệp đã đo
 *   (`validateUploadFile` cho từng tệp, rồi cộng cả bộ). Trả dữ liệu có thẻ, không câu chữ:
 *   câu tiếng Việt do màn viết (cùng luật với phần còn lại của `src/lib/upload`).
 * - {@link uploadDrawingSet} — chạy lượt tải. Khác `createUploadTask` ở chỗ một lượt có NHIỀU tệp và
 *   không cần tầng: tệp tải tuần tự (một khúc một lượt, như #6), khúc hỏng thử lại tối đa
 *   {@link MAX_CHUNK_ATTEMPTS} lần trừ lỗi dứt điểm (`isTerminalUploadError`).
 *
 * Giới hạn lấy từ `DRAWING_SET_LIMITS` (hợp đồng K-32a), không viết lại con số ở đây.
 */

import type { DrawingSetClient } from '@/api/drawingSetClient';
import { DRAWING_SET_LIMITS, type DrawingSet } from '@/api/schemas/drawingSet';
import { RETRY_DELAYS_MS } from '@/lib/http';

import { encodeChunkBase64, sliceIntoChunks } from './chunk';
import { isTerminalUploadError, MAX_CHUNK_ATTEMPTS } from './uploadTask';
import { validateUploadFile, type UploadCandidate, type UploadRejection } from './validate';

/** Tệp người dùng đưa vào: đủ để đo và để cắt khúc. `File` thoả. */
export interface DrawingSetCandidate extends UploadCandidate {
  readonly type: string;
}

/** Kết quả đo một tệp. `pageCount` của ảnh là 1; của PDF đọc không ra là 1 (`pagesKnown: false`). */
export type MeasuredDrawingSetFile<T extends DrawingSetCandidate = DrawingSetCandidate> =
  | { readonly ok: true; readonly file: T; readonly pageCount: number; readonly pagesKnown: boolean }
  | { readonly ok: false; readonly file: T; readonly reason: UploadRejection };

/** Đo từng tệp bằng luật tải một tệp (dung lượng, định dạng, `.dwg`, trần 20 trang mỗi PDF). */
export async function measureDrawingSetFile<T extends DrawingSetCandidate>(file: T): Promise<MeasuredDrawingSetFile<T>> {
  const verdict = await validateUploadFile(file);

  if (!verdict.ok) {
    return { ok: false, file, reason: verdict.reason };
  }
  const pagesKnown = verdict.branch !== 'pdf' || verdict.pageCount !== undefined;

  return { ok: true, file, pageCount: verdict.pageCount ?? 1, pagesKnown };
}

/** Điều làm cả bộ vượt giới hạn — người dùng bớt tệp thì hết. */
export type DrawingSetBatchIssue =
  | { readonly kind: 'tooManyFiles'; readonly count: number; readonly max: number }
  | { readonly kind: 'tooManyBytes'; readonly bytes: number; readonly max: number }
  | { readonly kind: 'tooManyPages'; readonly pages: number; readonly max: number };

export interface DrawingSetBatchCheck {
  /** Chỉ tính tệp đã nhận (`ok`); tệp bị từ chối riêng không làm cả bộ vượt trần. */
  readonly totalFiles: number;
  readonly totalBytes: number;
  readonly totalPages: number;
  readonly issues: readonly DrawingSetBatchIssue[];
}

export function checkDrawingSetBatch(measured: readonly MeasuredDrawingSetFile[]): DrawingSetBatchCheck {
  const accepted = measured.flatMap((entry) => (entry.ok ? [entry] : []));
  const totalFiles = accepted.length;
  const totalBytes = accepted.reduce((sum, entry) => sum + entry.file.size, 0);
  const totalPages = accepted.reduce((sum, entry) => sum + entry.pageCount, 0);
  const issues: DrawingSetBatchIssue[] = [];

  if (totalFiles > DRAWING_SET_LIMITS.maxFiles) {
    issues.push({ kind: 'tooManyFiles', count: totalFiles, max: DRAWING_SET_LIMITS.maxFiles });
  }
  if (totalBytes > DRAWING_SET_LIMITS.maxBytes) {
    issues.push({ kind: 'tooManyBytes', bytes: totalBytes, max: DRAWING_SET_LIMITS.maxBytes });
  }
  if (totalPages > DRAWING_SET_LIMITS.maxPages) {
    issues.push({ kind: 'tooManyPages', pages: totalPages, max: DRAWING_SET_LIMITS.maxPages });
  }

  return { totalFiles, totalBytes, totalPages, issues };
}

/* -------------------------------------------------------------------------- */
/* Chạy lượt tải.                                                              */
/* -------------------------------------------------------------------------- */

export type DrawingSetUploadStage = 'create' | 'chunk' | 'complete';

export interface DrawingSetUploadProgress {
  readonly stage: DrawingSetUploadStage;
  /** Phần trăm nguyên 0–100, đếm theo byte đã gửi của các tệp. */
  readonly percent: number;
  /** Tệp đang gửi (vắng ở `create` và `complete`). */
  readonly fileName?: string;
}

export type DrawingSetUploadResult =
  | { readonly ok: true; readonly set: DrawingSet }
  | {
      readonly ok: false;
      readonly stage: DrawingSetUploadStage;
      /** Lỗi dây (`HttpError`) nguyên văn, để màn đọc `code`; vắng khi máy chủ trả bộ không khớp tệp đã khai. */
      readonly error?: unknown;
      /** Bộ đã tạo (có từ sau `create`): màn có thể bỏ nó thay vì để mồ côi. */
      readonly setId?: string;
    }
  | { readonly ok: false; readonly stage: 'cancelled'; readonly error?: undefined; readonly setId?: string };

export interface UploadDrawingSetOptions {
  readonly api: Pick<DrawingSetClient, 'complete' | 'createSet' | 'sendChunk'>;
  readonly projectId: string;
  readonly files: readonly DrawingSetCandidate[];
  readonly name?: string;
  readonly signal?: AbortSignal;
  readonly onProgress?: (progress: DrawingSetUploadProgress) => void;
  /** Tiêm được để test không ngủ thật; mặc định `setTimeout`. */
  readonly sleep?: (delayMs: number) => Promise<void>;
}

const FULL_PERCENT = 100;

const defaultSleep = (delayMs: number): Promise<void> =>
  new Promise((resolve) => {
    setTimeout(resolve, delayMs);
  });

type ApiOutcome<T> = { readonly ok: true; readonly data: T } | { readonly ok: false; readonly error: unknown };

export async function uploadDrawingSet(options: UploadDrawingSetOptions): Promise<DrawingSetUploadResult> {
  const { api, files, projectId, signal } = options;
  const sleep = options.sleep ?? defaultSleep;
  const isAborted = (): boolean => signal?.aborted === true;
  const cancelled = (setId?: string): DrawingSetUploadResult => ({
    ok: false,
    stage: 'cancelled',
    ...(setId !== undefined ? { setId } : {}),
  });
  const progress = (value: DrawingSetUploadProgress): void => options.onProgress?.(value);

  /** Một lời gọi, thử lại khi còn có ích; `null` = bị huỷ giữa chừng. */
  const attempt = async <T>(call: () => Promise<ApiOutcome<T>>): Promise<ApiOutcome<T> | null> => {
    for (let tried = 1; ; tried += 1) {
      if (isAborted()) return null;
      const result = await call();

      if (result.ok || isTerminalUploadError(result.error) || tried >= MAX_CHUNK_ATTEMPTS) return result;
      await sleep(RETRY_DELAYS_MS[tried - 1] ?? RETRY_DELAYS_MS[RETRY_DELAYS_MS.length - 1] ?? 0);
    }
  };

  progress({ stage: 'create', percent: 0 });
  const created = await attempt(() =>
    api.createSet({
      projectId,
      body: {
        ...(options.name !== undefined ? { name: options.name } : {}),
        files: files.map((file) => ({ fileName: file.name, mimeType: file.type, sizeBytes: file.size })),
      },
      ...(signal !== undefined ? { signal } : {}),
    }),
  );

  if (created === null) return cancelled();
  if (!created.ok) return { ok: false, stage: 'create', error: created.error };

  const set = created.data;
  const totalBytes = Math.max(1, files.reduce((sum, file) => sum + file.size, 0));
  let sentBytes = 0;

  for (const [index, file] of files.entries()) {
    // Thứ tự `files` của máy chủ là thứ tự đã khai (`ord`); tên là lưới an toàn nếu máy chủ sắp lại.
    const guess = set.files[index];
    const remote = guess?.fileName === file.name ? guess : set.files.find((item) => item.fileName === file.name);

    if (remote === undefined) {
      return { ok: false, stage: 'create', setId: set.id };
    }

    for (const chunk of sliceIntoChunks(file.slice(0, file.size))) {
      if (isAborted()) return cancelled(set.id);
      const encoded = await encodeChunkBase64(chunk.blob);
      const sent = await attempt(() =>
        api.sendChunk({
          projectId,
          setId: set.id,
          fileId: remote.id,
          chunk: encoded,
          chunkIndex: chunk.index,
          ...(signal !== undefined ? { signal } : {}),
        }),
      );

      if (sent === null) return cancelled(set.id);
      if (!sent.ok) return { ok: false, stage: 'chunk', error: sent.error, setId: set.id };
      sentBytes += chunk.byteEnd - chunk.byteStart;
      progress({
        stage: 'chunk',
        percent: Math.min(FULL_PERCENT - 1, Math.floor((sentBytes / totalBytes) * FULL_PERCENT)),
        fileName: file.name,
      });
    }
  }

  progress({ stage: 'complete', percent: FULL_PERCENT - 1 });
  const completed = await attempt(() =>
    api.complete({ projectId, setId: set.id, ...(signal !== undefined ? { signal } : {}) }),
  );

  if (completed === null) return cancelled(set.id);
  if (!completed.ok) return { ok: false, stage: 'complete', error: completed.error, setId: set.id };
  progress({ stage: 'complete', percent: FULL_PERCENT });

  return { ok: true, set: completed.data };
}
