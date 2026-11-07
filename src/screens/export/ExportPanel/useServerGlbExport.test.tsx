import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { ApiClient } from '@/api/client';
import type { ModelExport } from '@/api/schemas/modelExport';

import {
  FLUSH_FAILED_MESSAGE,
  MODEL_EXPORT_POLL_MS,
  SERVER_GLB_STALE_NOTE,
  isServerGlbEnabled,
  messageForCode,
  useServerGlbExport,
} from './useServerGlbExport';

const T = '2026-11-07T05:00:00.000Z';
const job = (patch: Partial<ModelExport> = {}): ModelExport => ({
  id: 'mex_01JABCDEFGHJKMNPQRSTVWXYZ0',
  status: 'queued',
  stale: false,
  fingerprint: 'fp',
  currentFingerprint: 'fp',
  snapshotRevisions: [{ levelId: 'L-1', levelName: 'Tầng trệt', revision: 3 }],
  counts: {},
  issues: [],
  createdAt: T,
  ...patch,
});
const done = (patch: Partial<ModelExport> = {}): ModelExport =>
  job({ status: 'done', quality: 'ready', startedAt: T, endedAt: T, ...patch });

function fakeApi(latest: (ModelExport | null)[], started: ModelExport = job()) {
  const queue = [...latest];
  const api = {
    modelExports: {
      readLatest: vi.fn(async () => ({ ok: true as const, data: queue.length > 1 ? queue.shift()! : queue[0]! })),
      start: vi.fn(async () => ({ ok: true as const, data: started })),
      readFile: vi.fn(async () => ({ ok: true as const, data: new Blob(['x']) })),
    },
  };
  return api as typeof api & Pick<ApiClient, 'modelExports'>;
}

const flushOk = async () => ({ ok: true as const });

beforeEach(() => {
  vi.useFakeTimers();
});
afterEach(() => {
  vi.useRealTimers();
});

const settle = async () => {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(0);
  });
};

describe('useServerGlbExport', () => {
  it('flush hỏng → báo và KHÔNG gọi N49', async () => {
    const api = fakeApi([null]);
    const flush = vi.fn(async () => ({ ok: false as const, reason: 'conflict' }));
    const { result } = renderHook(() => useServerGlbExport({ api, enabled: true, flush, projectId: 'p' }));
    await settle();
    act(() => result.current.start());
    await settle();
    expect(flush).toHaveBeenCalledOnce();
    expect(api.modelExports.start).not.toHaveBeenCalled();
    expect(result.current.view.errorMessage).toBe(FLUSH_FAILED_MESSAGE);
  });

  it('cache 200 trả job done → hiện kết quả ngay, không thăm dò', async () => {
    const api = fakeApi([null], done());
    const { result } = renderHook(() => useServerGlbExport({ api, enabled: true, flush: flushOk, projectId: 'p' }));
    await settle();
    act(() => result.current.start());
    await settle();
    expect(result.current.view.result?.qualityLabel).toBe('Sẵn sàng');
    const reads = api.modelExports.readLatest.mock.calls.length;
    await act(async () => {
      await vi.advanceTimersByTimeAsync(MODEL_EXPORT_POLL_MS * 3);
    });
    expect(api.modelExports.readLatest.mock.calls.length).toBe(reads);
  });

  it('thăm dò mỗi 3 s và dừng khi done; stale hiện câu §9', async () => {
    const api = fakeApi([null, job(), job({ status: 'running', startedAt: T }), done({ stale: true })]);
    const { result } = renderHook(() => useServerGlbExport({ api, enabled: true, flush: flushOk, projectId: 'p' }));
    await settle();
    act(() => result.current.start());
    await settle();
    expect(result.current.view.progressLabel).toBe('Đang chờ máy chủ dựng…');
    for (let i = 0; i < 3; i += 1) {
      await act(async () => {
        await vi.advanceTimersByTimeAsync(MODEL_EXPORT_POLL_MS);
      });
    }
    expect(result.current.view.result).not.toBeNull();
    expect(result.current.view.staleNote).toBe(SERVER_GLB_STALE_NOTE);
    expect(result.current.view.snapshotLine).toMatch(/^Dựng từ bản lưu: tầng Tầng trệt revision 3 · lúc /);
    const reads = api.modelExports.readLatest.mock.calls.length;
    await act(async () => {
      await vi.advanceTimersByTimeAsync(MODEL_EXPORT_POLL_MS * 3);
    });
    expect(api.modelExports.readLatest.mock.calls.length).toBe(reads);
  });

  it('rời màn → dừng thăm dò', async () => {
    const api = fakeApi([job()]);
    const { unmount } = renderHook(() => useServerGlbExport({ api, enabled: true, flush: flushOk, projectId: 'p' }));
    await settle();
    unmount();
    const reads = api.modelExports.readLatest.mock.calls.length;
    await vi.advanceTimersByTimeAsync(MODEL_EXPORT_POLL_MS * 3);
    expect(api.modelExports.readLatest.mock.calls.length).toBe(reads);
  });

  it('blocked → ẩn tải GLB; issues critical/major trước; tải report qua deliver', async () => {
    const api = fakeApi([
      done({
        quality: 'blocked',
        issues: [
          { severity: 'minor', reason: 'Nhỏ', count: 1 },
          { severity: 'critical', reason: 'Tầng không có tường', count: 1 },
          { severity: 'major', reason: 'Cửa thiếu', count: 2 },
        ],
      }),
    ]);
    const deliver = vi.fn();
    const { result } = renderHook(() => useServerGlbExport({ api, deliver, enabled: true, flush: flushOk, projectId: 'p' }));
    await settle();
    const view = result.current.view;
    expect(view.result?.canDownloadGlb).toBe(false);
    expect(view.result?.qualityLabel).toBe('Không dùng được');
    expect(view.result?.issues.map((i) => i.severity)).toEqual(['critical', 'major', 'minor']);
    act(() => view.onDownload('report.json'));
    await settle();
    expect(api.modelExports.readFile).toHaveBeenCalledWith('p', 'mex_01JABCDEFGHJKMNPQRSTVWXYZ0', 'report.json');
    expect(deliver).toHaveBeenCalledWith(expect.any(Blob), 'report.json');
  });

  it('job failed → câu theo mã; lỗi mạng của N49 → câu mạng', async () => {
    const api = fakeApi([job({ status: 'failed', failureCode: 'MODEL_EXPORT_TIMEOUT' })]);
    api.modelExports.start.mockResolvedValueOnce({
      ok: false,
      error: { kind: 'network', requestId: 'r', retryable: true, raw: null },
    } as never);
    const { result } = renderHook(() => useServerGlbExport({ api, enabled: true, flush: flushOk, projectId: 'p' }));
    await settle();
    expect(result.current.view.errorMessage).toBe(messageForCode('MODEL_EXPORT_TIMEOUT'));
    act(() => result.current.start());
    await settle();
    expect(result.current.view.errorMessage).toMatch(/Không kết nối được máy chủ/);
  });

  it('cờ: chỉ `compiler` bật; mã lạ vẫn có câu', () => {
    expect(isServerGlbEnabled({ VITE_EXPORT_ENGINE: 'compiler' })).toBe(true);
    expect(isServerGlbEnabled({ VITE_EXPORT_ENGINE: 'legacy' })).toBe(false);
    expect(isServerGlbEnabled({})).toBe(false);
    expect(messageForCode('X_Y')).toContain('X_Y');
    expect(messageForCode(undefined)).toBe('Không xuất được mô hình.');
  });
});
