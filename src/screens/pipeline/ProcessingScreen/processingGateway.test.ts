/**
 * Cổng màn Xử lý: N7 đọc lại khi `CURSOR_INVALID`, luồng SSE đóng ở nhịp cuối,
 * hẹn im lặng 120 s hỏi #8, và kênh hỏi #8 cho tầng không đang xem. Đồng hồ giả.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { createApiClient } from '@/api/client';
import type { ApiClient, ApiResult } from '@/api/client';
import { ENDPOINTS } from '@/api/endpoints';
import { createMockApiClient } from '@/api/__mocks__/client';
import type { Progress } from '@/api/schemas';
import type { HttpClient, HttpError, Result } from '@/lib/http';
import { getPipelineStages } from '@/lib/realtime/pipeline';
import { installFakeClock, type FakeClock } from '@/lib/testing/fakeClock';

import {
  createAppProcessingGateway,
  createProcessingGateway,
  OTHER_FLOOR_POLL_INTERVAL_MS,
  PENDING_POLL_INTERVAL_MS,
  SSE_SILENCE_PROBE_MS,
  toStageBreakdown,
  type ProcessingFailure,
  type ProcessingProgressSnapshot,
} from './processingGateway';

const PROJECT_ID = 'project-1';
const UPLOAD_ID = 'upl_01J8Z3K4Q5R6S7T8V9W0XYZAB1';
const INPUT = { projectId: PROJECT_ID, uploadId: UPLOAD_ID, floorId: 'L1' } as const;

class MockEventSource {
  static instances: MockEventSource[] = [];
  readonly url: string;
  onerror: ((event: Event) => void) | null = null;
  onmessage: ((event: MessageEvent) => void) | null = null;
  onopen: ((event: Event) => void) | null = null;
  closed = false;

  constructor(url: string) {
    this.url = url;
    MockEventSource.instances.push(this);
  }

  close(): void {
    this.closed = true;
  }

  triggerOpen(): void {
    this.onopen?.(new Event('open'));
  }

  triggerMessage(data: Progress): void {
    this.onmessage?.(new MessageEvent('message', { data: JSON.stringify(data) }));
  }
}

const progress = (overrides: Partial<Progress> = {}): Progress => ({
  id: UPLOAD_ID,
  progressPercent: 10,
  startedAt: '2026-08-17T07:32:00.000Z',
  status: 'running',
  step: 'preprocess',
  ...overrides,
});

const wireError = (status: number, code: string): { ok: false; error: HttpError } => ({
  ok: false,
  error: { code, kind: 'http', raw: { code }, requestId: 'test', retryable: false, status },
});

/** `drawings.progress` đọc từ hàng kịch bản; cạn thì giữ câu trả lời cuối. */
function scriptedClient(initial: ApiResult<Progress> = { ok: true, data: progress() }) {
  const base = createMockApiClient();
  const queue: ApiResult<Progress>[] = [];
  let last = initial;
  let calls = 0;
  const client: ApiClient = {
    ...base,
    drawings: {
      ...base.drawings,
      progress: async () => {
        calls += 1;
        last = queue.shift() ?? last;
        return last;
      },
    },
  };

  return { client, calls: () => calls, queue: (result: ApiResult<Progress>) => queue.push(result) };
}

function recorder() {
  const snapshots: ProcessingProgressSnapshot[] = [];
  const failures: ProcessingFailure[] = [];
  return {
    snapshots,
    failures,
    handlers: {
      onSnapshot: (snapshot: ProcessingProgressSnapshot) => snapshots.push(snapshot),
      onFailure: (failure: ProcessingFailure) => failures.push(failure),
    },
  };
}

const gatewayFor = (client: ApiClient) =>
  createProcessingGateway(client, {
    EventSourceImpl: MockEventSource as unknown as typeof EventSource,
  });

const latestSource = (): MockEventSource => {
  const source = MockEventSource.instances.at(-1);
  if (source === undefined) throw new Error('no EventSource');
  return source;
};

describe('processingGateway', () => {
  let clock: FakeClock;

  beforeEach(() => {
    clock = installFakeClock();
    MockEventSource.instances = [];
  });

  afterEach(() => {
    clock.restore();
  });

  describe('requestCancel (N53, K-24)', () => {
    it('is supported and POSTs …/uploads/{id}/cancel, decoding the cancelled Progress', async () => {
      const calls: string[] = [];
      const cancelled = { id: 'upload-1', status: 'failed', step: 'wallSegmentation', progressPercent: 20, error: 'PIPELINE_CANCELLED' };
      const http = {
        post: async (path: string) => {
          calls.push(path);
          return { ok: true, data: cancelled };
        },
      } as unknown as HttpClient;
      const gateway = createProcessingGateway(createApiClient(http));

      const result = await gateway.requestCancel({ projectId: PROJECT_ID, uploadId: 'upload-1' });

      expect(gateway.supports.cancelProcessing).toBe(true);
      expect(calls).toEqual([ENDPOINTS.drawings.cancel(PROJECT_ID, 'upload-1')]);
      expect(ENDPOINTS.drawings.cancel(PROJECT_ID, 'upload-1')).toMatch(/\/drawings\/uploads\/upload-1\/cancel$/);
      expect(result).toEqual({ ok: true, data: cancelled });
    });
  });

  describe('readLatestUploads (N7)', () => {
    const first = 'upl_01J8Z3K4Q5R6S7T8V9W0XYZAB1';
    const second = 'upl_01J8Z3K4Q5R6S7T8V9W0XYZAB2';
    const pageOne = { items: [{ floorId: 'L1', floorName: 'Tầng 1', uploadId: first }], nextCursor: 'c2' };
    const pageTwo = { items: [{ floorId: 'L2', floorName: 'Tầng 2', uploadId: second }] };

    /** HTTP giả trả lần lượt các câu trả lời đã xếp cho từng đường. */
    function pagedHttp(script: Record<string, Result<unknown, HttpError>[]>) {
      const paths: string[] = [];
      const http = {
        get: async (path: string) => {
          paths.push(path);
          const answers = script[path] ?? [];
          return answers.length > 1 ? answers.shift() : answers[0];
        },
      } as unknown as HttpClient;
      return { http, paths };
    }

    const pathOne = ENDPOINTS.drawings.latestUploads(PROJECT_ID);
    const pathTwo = ENDPOINTS.drawings.latestUploads(PROJECT_ID, 'c2');

    it('merges two pages in order', async () => {
      const { http } = pagedHttp({
        [pathOne]: [{ ok: true, data: pageOne }],
        [pathTwo]: [{ ok: true, data: pageTwo }],
      });
      const result = await createProcessingGateway(createApiClient(http)).readLatestUploads({ projectId: PROJECT_ID });

      expect(result.ok && result.data.map((upload) => upload.uploadId)).toEqual([first, second]);
    });

    it('rereads from the first page exactly once on CURSOR_INVALID', async () => {
      const { http, paths } = pagedHttp({
        [pathOne]: [{ ok: true, data: pageOne }],
        [pathTwo]: [wireError(422, 'CURSOR_INVALID'), { ok: true, data: pageTwo }],
      });
      const result = await createProcessingGateway(createApiClient(http)).readLatestUploads({ projectId: PROJECT_ID });

      expect(result.ok && result.data).toHaveLength(2);
      expect(paths).toEqual([pathOne, pathTwo, pathOne, pathTwo]);
    });

    it('reports the error when the reread fails too', async () => {
      const { http, paths } = pagedHttp({
        [pathOne]: [{ ok: true, data: pageOne }],
        [pathTwo]: [wireError(422, 'CURSOR_INVALID')],
      });
      const result = await createProcessingGateway(createApiClient(http)).readLatestUploads({ projectId: PROJECT_ID });

      expect(result.ok).toBe(false);
      expect(paths).toHaveLength(4);
    });
  });

  describe('subscribeProgress (S1)', () => {
    it.each(['completed', 'failed'] as const)('closes the stream on a %s event', async (status) => {
      const { client } = scriptedClient();
      const log = recorder();
      gatewayFor(client).subscribeProgress(INPUT, log.handlers);

      latestSource().triggerOpen();
      latestSource().triggerMessage(
        progress(status === 'completed' ? { status, progressPercent: 100, endedAt: '2026-08-17T07:40:00.000Z' } : { status, error: 'FILE_CORRUPT' }),
      );

      expect(log.snapshots.at(-1)?.progress.status).toBe(status);
      expect(latestSource().closed).toBe(true);
    });

    /** Mở luồng, nhận một nhịp `running`, rồi im. */
    function openRunning() {
      const scripted = scriptedClient();
      const log = recorder();
      const stop = gatewayFor(scripted.client).subscribeProgress(INPUT, log.handlers);
      latestSource().triggerOpen();
      latestSource().triggerMessage(progress());
      return { ...scripted, log, stop };
    }

    it('probes #8 once per 120 s of silence while running', async () => {
      const { calls } = openRunning();

      await clock.advance(SSE_SILENCE_PROBE_MS - 1_000);
      expect(calls()).toBe(0);
      await clock.advance(1_000);
      expect(calls()).toBe(1);
      await clock.advance(SSE_SILENCE_PROBE_MS * 2);
      expect(calls()).toBe(3);
    });

    it('resets the silence timer on every SSE event', async () => {
      const { calls } = openRunning();

      await clock.advance(SSE_SILENCE_PROBE_MS);
      expect(calls()).toBe(1);
      await clock.advance(SSE_SILENCE_PROBE_MS / 2);
      latestSource().triggerMessage(progress({ progressPercent: 30 }));
      await clock.advance(SSE_SILENCE_PROBE_MS / 2);
      expect(calls()).toBe(1);
      await clock.advance(SSE_SILENCE_PROBE_MS / 2);
      expect(calls()).toBe(2);
    });

    it('emits a changed probe result, and a completed probe closes the stream for good', async () => {
      const { calls, queue, log } = openRunning();
      queue({ ok: true, data: progress() });
      queue({ ok: true, data: progress({ status: 'completed', progressPercent: 100, endedAt: '2026-08-17T07:40:00.000Z' }) });

      await clock.advance(SSE_SILENCE_PROBE_MS * 2);
      expect(calls()).toBe(2);
      expect(log.snapshots.at(-1)?.progress.status).toBe('completed');
      expect(latestSource().closed).toBe(true);

      await clock.advance(SSE_SILENCE_PROBE_MS * 3);
      expect(calls()).toBe(2);
    });

    it('drops a late pending probe answer once SSE has shown the run running (P3-8)', async () => {
      const base = createMockApiClient();
      let answerProbe: (result: ApiResult<Progress>) => void = () => undefined;
      const client: ApiClient = {
        ...base,
        drawings: {
          ...base.drawings,
          progress: () =>
            new Promise<ApiResult<Progress>>((resolve) => {
              answerProbe = resolve;
            }),
        },
      };
      const log = recorder();
      gatewayFor(client).subscribeProgress(INPUT, log.handlers);
      latestSource().triggerOpen();
      latestSource().triggerMessage(progress({ step: 'preprocess', progressPercent: 10 }));

      // The probe leaves during the silence; SSE moves on while it is in flight.
      await clock.advance(SSE_SILENCE_PROBE_MS);
      latestSource().triggerMessage(progress({ step: 'wallSegmentation', progressPercent: 40 }));
      answerProbe({ ok: true, data: progress({ status: 'pending', step: 'preprocess', progressPercent: 0 }) });
      await clock.flushMicrotasks();

      expect(log.snapshots.map((snapshot) => snapshot.progress.status)).toEqual(['running', 'running']);
    });

    it('still takes a pending probe answer when nothing newer was seen meanwhile (new run, NO-364)', async () => {
      const { queue, log } = openRunning();
      queue({ ok: true, data: progress({ status: 'pending', step: 'preprocess', progressPercent: 0 }) });

      await clock.advance(SSE_SILENCE_PROBE_MS);

      expect(log.snapshots.at(-1)?.progress.status).toBe('pending');
    });

    it('does not arm the silence timer for a pending event', async () => {
      const { client, calls } = scriptedClient();
      gatewayFor(client).subscribeProgress(INPUT, recorder().handlers);
      latestSource().triggerOpen();
      latestSource().triggerMessage(progress({ status: 'pending' }));

      await clock.advance(SSE_SILENCE_PROBE_MS * 3);
      expect(calls()).toBe(0);
    });

    it('does not probe while the stream is polling', async () => {
      const { client, calls } = scriptedClient();
      // Tab ẩn SAU khi luồng mở (không bắn sự kiện, nên SSE vẫn mở): kênh quay vòng không hỏi,
      // nên mọi lượt #8 đếm được là lượt dò — và lượt dò cũng không bắn khi tab ẩn (BUG-552).
      const hidden = { hidden: false, addEventListener: () => undefined, removeEventListener: () => undefined };
      createProcessingGateway(client, {
        EventSourceImpl: MockEventSource as unknown as typeof EventSource,
        visibilityTarget: hidden,
      }).subscribeProgress(INPUT, recorder().handlers);
      latestSource().triggerOpen();
      latestSource().triggerMessage(progress());
      hidden.hidden = true;
      // Ba lần mất kết nối → quay vòng; mỗi lần hỏng, kênh mở `EventSource` mới.
      for (let failure = 0; failure < 3; failure += 1) {
        latestSource().onerror?.(new Event('error'));
        await clock.advance(5_000);
      }

      // Hẹn cũ (từ nhịp SSE cuối) rơi vào quãng quay vòng: phải đã bị huỷ.
      await clock.advance(SSE_SILENCE_PROBE_MS - 1_000);
      expect(calls()).toBe(0);
    });

    it('stop() cancels the silence timer', async () => {
      const { calls, stop } = openRunning();
      stop();
      await clock.advance(600_000);
      expect(calls()).toBe(0);
      expect(latestSource().closed).toBe(true);
    });

    it('drops a probe that lands after stop()', async () => {
      const { calls, stop, log } = openRunning();
      const before = log.snapshots.length;
      await clock.advance(SSE_SILENCE_PROBE_MS - 1);
      stop();
      await clock.advance(1);
      expect(calls()).toBe(0);
      expect(log.snapshots).toHaveLength(before);
    });

    it('probes again 120 s after a network failure', async () => {
      const { calls, queue, log } = openRunning();
      queue({ ok: false, error: { kind: 'network', requestId: 'r', retryable: true, raw: null } });

      await clock.advance(SSE_SILENCE_PROBE_MS);
      expect(calls()).toBe(1);
      expect(log.failures).toHaveLength(1);
      await clock.advance(SSE_SILENCE_PROBE_MS);
      expect(calls()).toBe(2);
    });

    it('arms the silence timer on open when the seeded #8 status is running', async () => {
      const { client, calls } = scriptedClient();
      gatewayFor(client).subscribeProgress({ ...INPUT, status: 'running' }, recorder().handlers);
      latestSource().triggerOpen();

      await clock.advance(SSE_SILENCE_PROBE_MS - 1_000);
      expect(calls()).toBe(0);
      await clock.advance(1_000);
      expect(calls()).toBe(1);
    });

    it('closes the stream when the probe answers 404', async () => {
      const { calls, queue, log } = openRunning();
      queue(wireError(404, 'NOT_FOUND'));

      await clock.advance(SSE_SILENCE_PROBE_MS);
      expect(log.failures[0]?.isTerminal).toBe(true);
      expect(latestSource().closed).toBe(true);
      await clock.advance(SSE_SILENCE_PROBE_MS * 2);
      expect(calls()).toBe(1);
    });
  });

  describe('pollProgress (#8)', () => {
    it('reads #8 at once, then every 5 s, and stops at a final status', async () => {
      const { client, calls, queue } = scriptedClient();
      const log = recorder();
      queue({ ok: true, data: progress() });
      queue({ ok: true, data: progress({ progressPercent: 40 }) });
      queue({ ok: true, data: progress({ status: 'completed', progressPercent: 100, endedAt: '2026-08-17T07:40:00.000Z' }) });
      gatewayFor(client).pollProgress(INPUT, log.handlers);

      await clock.flushMicrotasks();
      expect(calls()).toBe(1);
      await clock.advance(OTHER_FLOOR_POLL_INTERVAL_MS);
      expect(calls()).toBe(2);
      await clock.advance(OTHER_FLOOR_POLL_INTERVAL_MS);
      expect(calls()).toBe(3);
      expect(log.snapshots.at(-1)?.progress.status).toBe('completed');
      expect(log.snapshots.every((snapshot) => snapshot.source === 'polling')).toBe(true);

      await clock.advance(OTHER_FLOOR_POLL_INTERVAL_MS * 4);
      expect(calls()).toBe(3);
      expect(MockEventSource.instances).toHaveLength(0);
    });

    it('stops asking after a 404', async () => {
      const { client, calls } = scriptedClient(wireError(404, 'NOT_FOUND'));
      const log = recorder();
      gatewayFor(client).pollProgress(INPUT, log.handlers);

      await clock.advance(60_000);
      expect(calls()).toBe(1);
      expect(log.failures[0]?.isTerminal).toBe(true);
    });

    it('asks a pending floor every 30 s and a running one every 5 s', async () => {
      const { client, calls, queue } = scriptedClient({ ok: true, data: progress({ status: 'pending' }) });
      gatewayFor(client).pollProgress({ ...INPUT, status: 'pending' }, recorder().handlers);

      await clock.flushMicrotasks();
      expect(calls()).toBe(1);
      await clock.advance(OTHER_FLOOR_POLL_INTERVAL_MS);
      expect(calls()).toBe(1);
      queue({ ok: true, data: progress() });
      await clock.advance(PENDING_POLL_INTERVAL_MS - OTHER_FLOOR_POLL_INTERVAL_MS);
      // Lượt 30 s thấy `running`: kênh mới mở và hỏi ngay một lần.
      expect(calls()).toBe(3);
      await clock.advance(OTHER_FLOOR_POLL_INTERVAL_MS);
      expect(calls()).toBe(4);
    });

    it('emits an unchanged read after a failed one, so the transient failure clears', async () => {
      const { client, queue } = scriptedClient();
      const log = recorder();
      queue({ ok: true, data: progress() });
      queue({ ok: false, error: { kind: 'network', requestId: 'r', retryable: true, raw: null } });
      queue({ ok: true, data: progress() });
      gatewayFor(client).pollProgress(INPUT, log.handlers);

      await clock.flushMicrotasks();
      await clock.advance(OTHER_FLOOR_POLL_INTERVAL_MS * 2);
      expect(log.failures).toHaveLength(1);
      expect(log.snapshots).toHaveLength(2);
    });

    it('a read cancelled by stop() is not a failure (BUG-574)', async () => {
      const base = createMockApiClient();
      const client: ApiClient = {
        ...base,
        drawings: {
          ...base.drawings,
          // Như `lib/http`: lượt bị huỷ trả `kind: 'aborted'`, không ném.
          progress: ({ signal }) =>
            new Promise((resolve) => {
              signal?.addEventListener('abort', () =>
                resolve({ ok: false, error: { kind: 'aborted', requestId: 'r', retryable: false, raw: null } }),
              );
            }),
        },
      };
      const log = recorder();
      const stop = gatewayFor(client).pollProgress(INPUT, log.handlers);
      await clock.flushMicrotasks();
      stop();
      await clock.flushMicrotasks();
      expect(log.failures).toEqual([]);
    });

    it('stop() ends polling', async () => {
      const { client, calls } = scriptedClient();
      const stop = gatewayFor(client).pollProgress(INPUT, recorder().handlers);
      await clock.flushMicrotasks();
      stop();
      await clock.advance(60_000);
      expect(calls()).toBe(1);
    });
  });
});

describe('toStageBreakdown — lượt pending (NO-364)', () => {
  const stages = getPipelineStages();

  it('lượt mới (start_run) trên upload cũ: bỏ bước đã xong của lượt trước, sáu bước về hàng đợi', () => {
    const previous = [
      { id: stages[0]!.id, status: 'done' as const, startedAtMs: 1_000, finishedAtMs: 2_000 },
      { id: stages[1]!.id, status: 'running' as const, startedAtMs: 2_000 },
    ];

    const result = toStageBreakdown({ status: 'pending', step: stages[0]!.id }, previous, 3_000);

    expect(result).toEqual({
      supported: true,
      value: stages.map((stage) => ({ id: stage.id, status: 'queued' })),
    });
  });

  it('step không tra được vẫn là sáu bước chờ, không rơi vào unsupported', () => {
    const result = toStageBreakdown({ status: 'pending', step: 'queued' }, [], 0);

    expect(result.supported && result.value.every((stage) => stage.status === 'queued')).toBe(true);
  });
});

describe('toStageBreakdown — lượt đọc cũ đến sau khung SSE (BUG-548)', () => {
  const stages = getPipelineStages();
  const statuses = (result: ReturnType<typeof toStageBreakdown>): readonly string[] =>
    result.supported ? result.value.map((stage) => stage.status) : [];

  it('SSE báo bước 3 chạy, #8 cũ báo bước 1: bước 3 không lùi về queued', () => {
    const atStepThree = toStageBreakdown({ status: 'running', step: stages[2]!.id }, [], 1_000);
    const previous = atStepThree.supported ? atStepThree.value : [];

    const late = toStageBreakdown({ status: 'running', step: stages[0]!.id }, previous, 2_000);

    expect(statuses(late).slice(0, 4)).toEqual(['done', 'done', 'running', 'queued']);
  });

  it('lượt đọc báo hỏng ở bước 1 không giữ bước 3 đang chạy', () => {
    const atStepThree = toStageBreakdown({ status: 'running', step: stages[2]!.id }, [], 1_000);
    const previous = atStepThree.supported ? atStepThree.value : [];

    const failed = toStageBreakdown({ status: 'failed', step: stages[0]!.id }, previous, 2_000);

    expect(statuses(failed)[2]).toBe('queued');
  });
});

describe('createAppProcessingGateway trên bộ mẫu dev', () => {
  it('VITE_USE_MOCK_API bật thì theo dõi tiến độ bằng hỏi #8, không mở SSE (bộ mẫu không có máy chủ SSE)', () => {
    vi.stubEnv('VITE_USE_MOCK_API', 'true');
    const gateway = createAppProcessingGateway();
    vi.unstubAllEnvs();

    expect(gateway.subscribeProgress).toBe(gateway.pollProgress);
    const real = createAppProcessingGateway();
    expect(real.subscribeProgress).not.toBe(real.pollProgress);
  });
});
