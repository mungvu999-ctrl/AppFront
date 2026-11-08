/**
 * M1-01 — "GLB dựng trên máy chủ" (hợp đồng §9). Toàn bộ logic của khối nằm ở đây (mục D);
 * `ServerGlbExportSection` chỉ vẽ {@link ServerGlbExportView}.
 *
 * Luồng: xả autosave (`ok:false` → dừng, không gọi N49) → N49 → thăm dò N50 mỗi 3 s tới khi
 * `done | failed | superseded` hoặc rời màn (dọn bộ hẹn giờ khi unmount).
 */
import { useCallback, useEffect, useRef, useState } from 'react';

import type { ApiClient, ApiError } from '@/api/client';
import type { ModelExport, ModelExportFileName, ModelExportIssue } from '@/api/schemas/modelExport';
import { createAppApiClient } from '@/api/appClient';
import { flushAutosaves, type FlushResult } from '@/hooks/useAutosave';
import { formatFileSize } from '@/lib/format/bytes';
import { formatClockTime } from '@/lib/format/datetime';
import { formatNumber } from '@/lib/format/number';


export const MODEL_EXPORT_POLL_MS = 3000;

export type GlbEngine = 'quick' | 'server';

export const GLB_ENGINE_LABELS: Readonly<Record<GlbEngine, string>> = {
  quick: 'GLB nhanh (không vật liệu)',
  server: 'GLB dựng trên máy chủ (có vật liệu)',
};

/**
 * Nợ NO-M1-12 (Chặn bật mặc định): editor tự bày đồ bằng mẫu thư viện máy chủ khi thư viện đã nạp
 * (master a2238c11), còn gói xuất chỉ có mẫu vendor/AppFront → GLB máy chủ lệch editor ở phần lớn đồ
 * tự bày, không chỉ đồ người dùng thêm/đổi. Câu này chỉ đủ khi cờ `VITE_EXPORT_ENGINE` còn tắt.
 */
export const SERVER_GLB_DISCLAIMER =
  'Bản dựng trên máy chủ từ dữ liệu đã lưu; chưa có mái, tủ âm, decor; có thể khác editor ở vật liệu mặc định và đồ chưa có trong gói xuất.';
export const SERVER_GLB_STALE_NOTE = 'Dữ liệu đã thay đổi sau lần xuất này — xuất lại để có bản mới.';
export const SERVER_GLB_SCOPE_NOTE = 'Xuất mọi tầng của dự án.';
export const FLUSH_FAILED_MESSAGE = 'Chưa lưu được thay đổi — chưa xuất.';

const QUALITY_LABELS = { ready: 'Sẵn sàng', degraded: 'Có thiếu sót', blocked: 'Không dùng được' } as const;
const QUALITY_TONES = { ready: 'ok', degraded: 'attention', blocked: 'violation' } as const;
const SEVERITY_RANK: Readonly<Record<ModelExportIssue['severity'], number>> = { critical: 0, major: 1, minor: 2 };

const ERROR_MESSAGES: Readonly<Record<string, string>> = {
  MODEL_EXPORT_FAILED: 'Máy chủ không dựng được mô hình. Thử xuất lại sau.',
  MODEL_EXPORT_TIMEOUT: 'Máy chủ dựng quá lâu nên đã dừng. Thử xuất lại sau.',
  MODEL_EXPORT_OUTPUT_INVALID: 'Tệp máy chủ dựng ra không hợp lệ. Thử xuất lại; nếu vẫn lỗi, báo quản trị viên.',
  MODEL_EXPORT_STALLED: 'Lượt dựng bị treo quá lâu nên đã dừng. Thử xuất lại.',
  MODEL_EXPORT_PACK_MISSING: 'Máy chủ chưa có gói vật liệu để dựng. Báo quản trị viên.',
  MODEL_EXPORT_NOT_READY: 'Tệp chưa sẵn sàng để tải.',
};
const NETWORK_MESSAGE = 'Không kết nối được máy chủ. Kiểm tra mạng rồi thử lại.';
const SUPERSEDED_MESSAGE = 'Lần xuất này đã bị thay bằng một lần xuất mới hơn.';

/** Câu tiếng Việt theo mã lỗi; mã lạ vẫn có câu, kèm mã để báo lỗi. */
export function messageForCode(code: string | undefined): string {
  if (code !== undefined && ERROR_MESSAGES[code] !== undefined) return ERROR_MESSAGES[code];
  return code === undefined ? 'Không xuất được mô hình.' : `Không xuất được mô hình (mã ${code}).`;
}

function messageForHttpError(error: ApiError): string {
  return error.kind === 'network' || error.kind === 'timeout' ? NETWORK_MESSAGE : messageForCode(error.code);
}

/** Trạng thái thô của hook, đầu vào của {@link toServerGlbView}. */
export interface ServerGlbState {
  readonly engine: GlbEngine;
  readonly phase: 'idle' | 'flushing' | 'starting';
  readonly job: ModelExport | null;
  readonly error: string | null;
}

export interface ServerGlbIssueRow {
  readonly key: string;
  readonly severity: ModelExportIssue['severity'];
  readonly reason: string;
  readonly countLabel: string;
}

export interface ServerGlbResultView {
  readonly qualityLabel: string;
  readonly qualityTone: 'ok' | 'attention' | 'violation';
  readonly issues: readonly ServerGlbIssueRow[];
  readonly canDownloadGlb: boolean;
  readonly glbSizeLabel: string | null;
}

/** Props của khối (view thuần). */
export interface ServerGlbExportView {
  readonly engine: GlbEngine;
  readonly isBusy: boolean;
  readonly progressLabel: string | null;
  readonly errorMessage: string | null;
  readonly snapshotLine: string | null;
  readonly staleNote: string | null;
  readonly result: ServerGlbResultView | null;
  readonly onSelectEngine: (engine: GlbEngine) => void;
  readonly onDownload: (fileName: ModelExportFileName) => void;
}

const isPending = (job: ModelExport | null): boolean => job !== null && (job.status === 'queued' || job.status === 'running');

/** Viewmodel thuần: định dạng số/thời gian ở đây, không ở view (A15). */
export function toServerGlbView(
  state: ServerGlbState,
  actions: Pick<ServerGlbExportView, 'onSelectEngine' | 'onDownload'>,
): ServerGlbExportView {
  const { job } = state;
  const progressLabel =
    state.phase === 'flushing'
      ? 'Đang lưu thay đổi…'
      : state.phase === 'starting'
        ? 'Đang gửi yêu cầu xuất…'
        : job?.status === 'queued'
          ? 'Đang chờ máy chủ dựng…'
          : job?.status === 'running'
            ? 'Máy chủ đang dựng mô hình…'
            : null;
  const jobError =
    job?.status === 'failed' ? messageForCode(job.failureCode) : job?.status === 'superseded' ? SUPERSEDED_MESSAGE : null;
  const quality = job?.status === 'done' ? job.quality : undefined;
  const snapshotLine =
    job === null || job.snapshotRevisions.length === 0
      ? null
      : `Dựng từ bản lưu: ${job.snapshotRevisions
          .map((r) => `tầng ${r.levelName} revision ${formatNumber(r.revision, { grouping: false })}`)
          .join(', ')} · lúc ${formatClockTime(new Date(job.createdAt))}`;
  return {
    engine: state.engine,
    isBusy: state.phase !== 'idle' || isPending(job),
    progressLabel,
    errorMessage: state.error ?? jobError,
    snapshotLine,
    staleNote: job?.stale === true ? SERVER_GLB_STALE_NOTE : null,
    result:
      quality === undefined || job === null
        ? null
        : {
            qualityLabel: QUALITY_LABELS[quality],
            qualityTone: QUALITY_TONES[quality],
            issues: [...job.issues]
              .sort((a, b) => SEVERITY_RANK[a.severity] - SEVERITY_RANK[b.severity])
              .map((issue, index) => ({
                key: `${issue.severity}-${String(index)}`,
                severity: issue.severity,
                reason: issue.reason,
                countLabel: `× ${formatNumber(issue.count)}`,
              })),
            canDownloadGlb: quality !== 'blocked',
            glbSizeLabel: job.glbBytes === undefined ? null : formatFileSize(job.glbBytes),
          },
    ...actions,
  };
}

/** Cờ build `VITE_EXPORT_ENGINE`: chỉ `compiler` mới bật đường máy chủ. */
export function isServerGlbEnabled(env: { readonly VITE_EXPORT_ENGINE?: string } = import.meta.env): boolean {
  return env.VITE_EXPORT_ENGINE === 'compiler';
}

function deliverBlob(blob: Blob, fileName: string): void {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = fileName;
  anchor.rel = 'noopener';
  anchor.click();
  URL.revokeObjectURL(url);
}

export interface UseServerGlbExportOptions {
  readonly projectId: string;
  readonly enabled: boolean;
  /** Cửa tiêm cho test. */
  readonly api?: Pick<ApiClient, 'modelExports'>;
  readonly flush?: () => Promise<FlushResult>;
  readonly deliver?: (blob: Blob, fileName: string) => void;
}

export interface UseServerGlbExport {
  readonly view: ServerGlbExportView;
  /** Nút "Xuất .glb" gọi khi đang chọn đường máy chủ. */
  readonly start: () => void;
}

export function useServerGlbExport(options: UseServerGlbExportOptions): UseServerGlbExport {
  const { projectId, enabled } = options;
  const apiRef = useRef(options.api);
  apiRef.current ??= enabled ? createAppApiClient() : undefined;
  const flush = options.flush ?? flushAutosaves;
  const deliver = options.deliver ?? deliverBlob;

  const [state, setState] = useState<ServerGlbState>({ engine: 'quick', phase: 'idle', job: null, error: null });
  const alive = useRef(true);
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);

  const readLatest = useCallback(async () => {
    const api = apiRef.current;
    if (api === undefined) return;
    const result = await api.modelExports.readLatest(projectId);
    if (!alive.current) return;
    setState((s) =>
      result.ok ? { ...s, job: result.data, error: null } : { ...s, error: messageForHttpError(result.error) },
    );
  }, [projectId]);

  // Lần mở màn: hiện lần xuất gần nhất (kể cả `stale`).
  useEffect(() => {
    if (enabled) void readLatest();
  }, [enabled, readLatest]);

  // Thăm dò khi job còn chạy; dừng ở trạng thái cuối, khi lỗi mạng, hoặc khi rời màn (cleanup).
  const pending = isPending(state.job) && state.error === null;
  useEffect(() => {
    if (!pending) return undefined;
    const timer = setTimeout(() => void readLatest(), MODEL_EXPORT_POLL_MS);
    return () => clearTimeout(timer);
  }, [pending, readLatest, state.job]);

  // Chốt đồng bộ: hai cú bấm liền nhau chạy trước khi `phase` kịp đổi trong state.
  const inFlight = useRef(false);
  const start = useCallback(() => {
    const api = apiRef.current;
    // Đang lưu/gửi/dựng thì bỏ qua: bấm lại không tạo thêm lượt N49 (lượt trước sẽ thành `superseded`).
    if (api === undefined || inFlight.current || pending) return;
    inFlight.current = true;
    void (async () => {
      try {
        setState((s) => ({ ...s, phase: 'flushing', error: null }));
        const flushed = await flush();
        if (!alive.current) return;
        if (!flushed.ok) {
          setState((s) => ({ ...s, phase: 'idle', error: FLUSH_FAILED_MESSAGE }));
          return;
        }
        setState((s) => ({ ...s, phase: 'starting' }));
        const result = await api.modelExports.start(projectId);
        if (!alive.current) return;
        setState((s) =>
          result.ok
            ? { ...s, phase: 'idle', job: result.data, error: null }
            : { ...s, phase: 'idle', error: messageForHttpError(result.error) },
        );
      } finally {
        inFlight.current = false;
      }
    })();
  }, [flush, pending, projectId]);

  const jobId = state.job?.id;
  const onDownload = useCallback<ServerGlbExportView['onDownload']>(
    (fileName) => {
      const api = apiRef.current;
      if (api === undefined || jobId === undefined) return;
      void api.modelExports.readFile(projectId, jobId, fileName).then((result) => {
        if (!alive.current) return;
        if (result.ok) deliver(result.data, fileName);
        else setState((s) => ({ ...s, error: messageForHttpError(result.error) }));
      });
    },
    [deliver, jobId, projectId],
  );

  const onSelectEngine = useCallback((engine: GlbEngine) => setState((s) => ({ ...s, engine })), []);

  return { view: toServerGlbView(state, { onSelectEngine, onDownload }), start };
}
