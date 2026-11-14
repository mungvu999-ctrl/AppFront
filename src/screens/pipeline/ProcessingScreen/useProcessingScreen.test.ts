/**
 * Nửa "suy nghĩ" của màn Xử lý, kiểm không cần DOM của màn.
 *
 * Hook được lái qua `renderHook`, và tầng dữ liệu là `createMockApiClient()` của
 * `src/api/__mocks__/client.ts` — cùng phép ánh xạ bản sản phẩm dùng, nên test
 * không dựng một ý niệm thứ hai về hình dạng câu trả lời (R-70). Danh sách tầng
 * và mã bản vẽ đọc từ chính `client.projects.read`, không gõ tay.
 *
 * Chỗ DUY NHẤT được thay là `drawings.progress`: nó bị đổi bằng một hàng đợi có
 * kịch bản, để test bấm được từng nhịp tiến độ thay vì chờ mạng — cùng cách
 * `useFloorUploadScreen.test.ts` thay `createUpload`. Giá trị `step` của mỗi nhịp
 * lấy từ `getPipelineStages()`, tức từ chính bảng bước thật, không phải một danh
 * sách tên bịa ra ở đây.
 */

import { createElement, type ReactNode } from 'react';
import { onlineManager, QueryClientProvider } from '@tanstack/react-query';
import { act, cleanup, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi, type MockInstance } from 'vitest';

import { createMockApiClient } from '@/api/__mocks__/client';
import type { ApiClient, ApiResult, LatestFloorUpload } from '@/api/client';
import { ProgressSchema, type Progress } from '@/api/schemas';
import { totalArea } from '@/domain/rooms/area';
import { SAMPLE_BUILDING, sampleLevelId } from '@/domain/spatial/__fixtures__/sampleBuilding';
import { toPointMm } from '@/lib/commands/business/shared';
import { millimetresPerPixel } from '@/domain/units/scale';
import { formatArea } from '@/lib/format/measure';
import * as auth from '@/lib/auth';
import type { HttpError } from '@/lib/http';
import { createNotificationBus, type NotificationBus } from '@/lib/mutations/notificationBus';
import {
  createBackgroundWatchRegistry,
  type BackgroundWatchRegistry,
} from '@/lib/realtime/backgroundWatch';
import { POLL_INTERVAL_MS } from '@/lib/realtime/pollingChannel';
import { SSE_FAILURE_LIMIT, SSE_RETRY_INTERVAL_MS } from '@/lib/realtime/progressStream';
import { getPipelineStages } from '@/lib/realtime/pipeline';
import { queryKeys } from '@/lib/query/queryKeys';
import { createTestQueryClient } from '@/lib/testing/render';
import { installFakeClock, type FakeClock } from '@/lib/testing/fakeClock';

import {
  createProcessingGateway,
  OTHER_FLOOR_POLL_INTERVAL_MS,
  PENDING_POLL_INTERVAL_MS,
  SSE_SILENCE_PROBE_MS,
} from './processingGateway';
import type { ProcessingExtractionSummary } from './processingGateway';
import {
  summaryScaleStateOf,
  useProcessingScreen,
  type ProcessingFloorUpload,
  type ProcessingScreenHookResult,
  type SummaryScaleFloor,
} from './useProcessingScreen';
import type { ProcessingScreenProps } from './types';

const PROJECT_ID = 'project-1';

/** Tầng đầu của bộ mẫu A14: có tường, ô mở, phòng, kích thước thật để đếm (lớp mock của `L1` rỗng). */
const SAMPLE_LEVEL_ID = sampleLevelId(0);
const onSampleLevel = <T extends { readonly levelId: string }>(items: readonly T[]): T[] =>
  items.filter((item) => item.levelId === SAMPLE_LEVEL_ID);
const SAMPLE_WALLS = onSampleLevel(SAMPLE_BUILDING.walls);
const SAMPLE_LAYER_DOCUMENT = {
  dimensions: onSampleLevel(SAMPLE_BUILDING.dimensions),
  layer: {
    furniture: onSampleLevel(SAMPLE_BUILDING.furniture),
    openings: SAMPLE_BUILDING.openings.filter((opening) => SAMPLE_WALLS.some((wall) => wall.id === opening.wallId)),
    rooms: onSampleLevel(SAMPLE_BUILDING.rooms),
    walls: SAMPLE_WALLS,
  },
};
const STAGES = getPipelineStages();
/** Nhịp hỏi lại N7 khi chưa có ảnh xem trước. */
const SCAN_POLL_MS = 1500;

/* -------------------------------------------------------------------------- */
/* Bộ giả của môi trường: EventSource, tab ẩn/hiện, matchMedia.                 */
/* -------------------------------------------------------------------------- */

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

  triggerError(): void {
    this.onerror?.(new Event('error'));
  }

  triggerMessage(data: Progress): void {
    this.onmessage?.(new MessageEvent('message', { data: JSON.stringify(data) }));
  }
}

class MockVisibilityTarget {
  hidden: boolean;

  private readonly listeners = new Set<() => void>();

  constructor(hidden = false) {
    this.hidden = hidden;
  }

  addEventListener(type: 'visibilitychange', listener: () => void): void {
    if (type === 'visibilitychange') {
      this.listeners.add(listener);
    }
  }

  removeEventListener(type: 'visibilitychange', listener: () => void): void {
    if (type === 'visibilitychange') {
      this.listeners.delete(listener);
    }
  }

  setHidden(hidden: boolean): void {
    this.hidden = hidden;
    this.listeners.forEach((listener) => {
      listener();
    });
  }
}

/* jsdom không có `matchMedia`; `matches: false` là cách xếp rộng, không giảm chuyển động. */
beforeEach(() => {
  MockEventSource.instances = [];
  Object.defineProperty(window, 'matchMedia', {
    writable: true,
    value: vi.fn().mockImplementation((query: string) => ({
      matches: false,
      media: query,
      onchange: null,
      addListener: vi.fn(),
      removeListener: vi.fn(),
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      dispatchEvent: vi.fn(),
    })),
  });
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

/* -------------------------------------------------------------------------- */
/* Bộ dựng.                                                                    */
/* -------------------------------------------------------------------------- */

/**
 * Một nhịp tiến độ, dựng từ bảng bước THẬT.
 *
 * `stageIndex` là chỉ số trong `getPipelineStages()`; `step` lấy đúng `id` của
 * bước đó, nên nếu bảng bước đổi thì test này đổi theo chứ không lệch âm thầm.
 */
function progressAt(
  uploadId: string,
  stageIndex: number,
  overrides: Partial<Progress> = {},
): Progress {
  const stage = STAGES[stageIndex];

  if (stage === undefined) {
    throw new Error(`Không có bước nào ở chỉ số ${stageIndex}.`);
  }

  return {
    id: uploadId,
    progressPercent: 0,
    startedAt: '2026-08-17T07:32:00.000Z',
    status: 'running',
    step: stage.id,
    ...overrides,
  };
}

/** Nhịp cuối: cả lượt đã xong. `step` giữ nguyên bước cuối, `status` mới là thứ quyết định. */
function finishedProgress(uploadId: string): Progress {
  return progressAt(uploadId, STAGES.length - 1, {
    progressPercent: 100,
    status: 'completed',
    endedAt: '2026-08-17T07:40:00.000Z',
  });
}

interface Harness {
  readonly client: ApiClient;
  readonly progressCalls: () => number;
  /** Số lượt #8 của riêng một upload (gồm cả lượt mồi). */
  readonly callsFor: (uploadId: string) => number;
  /** Một `HttpError` trong hàng đợi là đúng một lượt #8 hỏng; lượt sau đọc tiếp hàng đợi. */
  readonly queue: (uploadId: string, progress: Progress | HttpError) => void;
  /** N7: câu trả lời kế tiếp; `pending` thì treo mãi. */
  readonly setLatest: (answer: ApiResult<LatestFloorUpload[]> | 'pending') => void;
  readonly latestCalls: () => number;
}

/**
 * `createMockApiClient()` với đúng một phương thức bị thay: `drawings.progress`
 * đọc từ hàng đợi kịch bản của test, và giữ nhịp cuối khi hàng đợi cạn.
 */
function makeScriptedClient(): Harness {
  const base = createMockApiClient();
  const queues = new Map<string, (Progress | HttpError)[]>();
  const latest = new Map<string, Progress>();
  const callsByUpload = new Map<string, number>();
  let calls = 0;
  let latestAnswer: ApiResult<LatestFloorUpload[]> | 'pending' = { ok: true, data: [] };
  let latestCalls = 0;

  const client: ApiClient = {
    ...base,
    drawings: {
      ...base.drawings,
      latestUploads: () => {
        latestCalls += 1;
        return latestAnswer === 'pending' ? new Promise(() => undefined) : Promise.resolve(latestAnswer);
      },
      progress: async ({ uploadId }) => {
        calls += 1;
        callsByUpload.set(uploadId, (callsByUpload.get(uploadId) ?? 0) + 1);
        const queued = queues.get(uploadId)?.shift();

        if (queued !== undefined && 'kind' in queued) {
          return { ok: false, error: queued };
        }

        if (queued !== undefined) {
          latest.set(uploadId, queued);
        }

        const current = latest.get(uploadId) ?? progressAt(uploadId, 0);
        return { ok: true, data: current };
      },
    },
  };

  return {
    client,
    progressCalls: () => calls,
    callsFor: (uploadId) => callsByUpload.get(uploadId) ?? 0,
    setLatest: (answer) => {
      latestAnswer = answer;
    },
    latestCalls: () => latestCalls,
    queue: (uploadId, progress) => {
      const existing = queues.get(uploadId) ?? [];
      existing.push(progress);
      queues.set(uploadId, existing);
    },
  };
}

/** Danh sách tầng thật của dự án mẫu, kèm mã bản vẽ thật làm `uploadId`. */
async function readFloorUploads(
  client: ApiClient,
  limit: number,
): Promise<readonly ProcessingFloorUpload[]> {
  const result = await client.projects.read({ projectId: PROJECT_ID });

  if (!result.ok) {
    throw new Error('Không đọc được dự án mẫu.');
  }

  // Chỉ `L1` của dự án mẫu có sẵn bản vẽ; các tầng khác chưa tải gì. Mã lượt
  // tải của những tầng đó lấy theo mã tầng — `uploadId` là mã máy chủ sinh ra,
  // không có trong bộ mẫu, và ở test này chính kịch bản dưới đây là "máy chủ".
  return result.data.floors.slice(0, limit).map((floor) => {
    const drawing = floor.drawings[0];

    return {
      floorId: floor.id,
      floorName: floor.name,
      uploadId: drawing?.id ?? floor.id,
      ...(drawing !== undefined ? { sourceImageUrl: drawing.url } : {}),
    };
  });
}

interface Mounted {
  readonly result: { current: ProcessingScreenHookResult };
  readonly unmount: () => void;
  readonly rerender: () => void;
}

/**
 * Hai thứ của phần chạy nền phải tiêm được, vì bản mặc định của cả hai là một
 * đối tượng dùng chung cho cả phiên: sổ theo dõi nền và bus thông báo. Không
 * tiêm thì hai lượt kiểm thấy thông báo của nhau.
 */
interface BackgroundOptions {
  readonly notifications?: NotificationBus;
  readonly backgroundWatches?: BackgroundWatchRegistry;
  readonly onNavigate?: (path: string) => void;
  readonly writeClipboardText?: (text: string) => Promise<void>;
  readonly forceCollapsed?: boolean;
}

function mountHook(
  client: ApiClient,
  uploads: readonly ProcessingFloorUpload[] | undefined,
  queryClient: ReturnType<typeof createTestQueryClient>,
  visibilityTarget: MockVisibilityTarget,
  background: BackgroundOptions = {},
): Mounted {
  const gateway = createProcessingGateway(client, {
    EventSourceImpl: MockEventSource as unknown as typeof EventSource,
    visibilityTarget,
    ...(background.backgroundWatches !== undefined
      ? { backgroundWatches: background.backgroundWatches }
      : {}),
    ...(background.writeClipboardText !== undefined
      ? { writeClipboardText: background.writeClipboardText }
      : {}),
  });

  const wrapper = ({ children }: { children: ReactNode }) =>
    createElement(QueryClientProvider, { client: queryClient }, children);

  const rendered = renderHook(
    () =>
      useProcessingScreen({
        projectId: PROJECT_ID,
        ...(uploads !== undefined ? { floorUploads: uploads } : {}),
        gateway,
        ...(background.notifications !== undefined
          ? { notifications: background.notifications }
          : {}),
        ...(background.onNavigate !== undefined ? { onNavigate: background.onNavigate } : {}),
        ...(background.forceCollapsed !== undefined ? { forceCollapsed: background.forceCollapsed } : {}),
      }),
    { wrapper },
  );

  return {
    result: rendered.result,
    unmount: rendered.unmount,
    rerender: () => rendered.rerender(),
  };
}

const latestSource = (): MockEventSource => {
  const source = MockEventSource.instances.at(-1);

  if (source === undefined) {
    throw new Error('Chưa có kênh SSE nào được mở.');
  }

  return source;
};

/**
 * Để mọi lời hứa đang bay đáp xuống.
 *
 * `waitFor` của testing-library không dùng được ở đây: nó tự đặt hẹn giờ, mà
 * đồng hồ trong bộ test này là đồng hồ giả — nó sẽ chờ mãi. Đẩy hàng đợi vi tác
 * vụ vài vòng là đủ cho `useQueries` và dòng sự kiện.
 */
const settle = async (clock: FakeClock): Promise<void> => {
  await act(async () => {
    await clock.advance(0);
    await clock.flushMicrotasks();
    await clock.advance(0);
    await clock.flushMicrotasks();
  });
};

/** Ảnh chụp phần trăm của sáu bước — thứ người dùng thật sự nhìn thấy. */
const percentSnapshot = (props: ProcessingScreenProps): readonly number[] =>
  props.steps.map((step) => step.percent);

const doneStepCount = (props: ProcessingScreenProps): number =>
  props.steps.filter((step) => step.status === 'done').length;

/* -------------------------------------------------------------------------- */
/* Test.                                                                       */
/* -------------------------------------------------------------------------- */

describe('useProcessingScreen', () => {
  let clock: FakeClock;

  beforeEach(() => {
    clock = installFakeClock();
  });

  afterEach(() => {
    clock.restore();
  });

  it('SSE chết giữa bước 3: chuyển sang quay vòng và tiến độ KHÔNG nhảy lùi', async () => {
    const harness = makeScriptedClient();
    const uploads = await readFloorUploads(harness.client, 1);
    const upload = uploads[0]!;
    const visibility = new MockVisibilityTarget();
    const mounted = mountHook(harness.client, uploads, createTestQueryClient(), visibility);

    await settle(clock);
    expect(mounted.result.current.steps).toHaveLength(STAGES.length);

    const timeline: { readonly label: string; readonly percents: readonly number[] }[] = [];
    const record = (label: string): void => {
      timeline.push({ label, percents: percentSnapshot(mounted.result.current) });
    };

    // Đi tới bước 3 qua SSE, mỗi bước cách nhau thật sự về thời gian.
    await act(async () => {
      latestSource().triggerOpen();
    });

    for (let stageIndex = 0; stageIndex < 3; stageIndex += 1) {
      await act(async () => {
        latestSource().triggerMessage(
          progressAt(upload.uploadId, stageIndex, { progressPercent: stageIndex * 10 }),
        );
        await clock.advance(POLL_INTERVAL_MS);
      });
      record(`SSE — đang ở bước ${stageIndex + 1} (${STAGES[stageIndex]!.label})`);
    }

    const beforeFailure = percentSnapshot(mounted.result.current);
    const doneBeforeFailure = doneStepCount(mounted.result.current);
    expect(doneBeforeFailure).toBe(2);

    // SSE chết đúng giữa bước 3: đủ SSE_FAILURE_LIMIT lần mất kết nối liên tiếp.
    const callsBeforePolling = harness.progressCalls();

    for (let failure = 0; failure < SSE_FAILURE_LIMIT; failure += 1) {
      await act(async () => {
        latestSource().triggerError();
        await clock.advance(POLL_INTERVAL_MS);
      });
    }

    record('SSE chết ba lần liên tiếp → chuyển quay vòng');
    expect(harness.progressCalls()).toBeGreaterThan(callsBeforePolling);

    // Lượt quay vòng đầu tiên đọc lại một nhịp CŨ HƠN (máy chủ trả bước 1).
    // Đây chính là chỗ tiến độ có thể nhảy lùi nếu hook không giữ
    // `highestProgressReached` và không chặn hạ bước đã xong.
    harness.queue(upload.uploadId, progressAt(upload.uploadId, 0, { progressPercent: 0 }));

    await act(async () => {
      await clock.advance(POLL_INTERVAL_MS);
    });

    record('quay vòng — máy chủ trả lại nhịp CŨ (bước 1, 0%)');

    const afterRewind = percentSnapshot(mounted.result.current);

    console.log(
      [
        '',
        '--- tiến độ sáu bước qua từng nhịp (%) ---',
        ...timeline.map(
          (entry) => `${entry.percents.map((percent) => String(percent).padStart(3)).join(' ')}  ${entry.label}`,
        ),
        '-----------------------------------------',
        '',
      ].join('\n'),
    );

    beforeFailure.forEach((percent, index) => {
      expect(afterRewind[index]).toBeGreaterThanOrEqual(percent);
    });
    expect(doneStepCount(mounted.result.current)).toBeGreaterThanOrEqual(doneBeforeFailure);

    mounted.unmount();
  });

  it('tab ẩn thì ngừng nghe, hiện lại thì nghe tiếp', async () => {
    const harness = makeScriptedClient();
    const uploads = await readFloorUploads(harness.client, 1);
    const visibility = new MockVisibilityTarget();
    const mounted = mountHook(harness.client, uploads, createTestQueryClient(), visibility);

    await settle(clock);

    // Chỉ kênh quay vòng mới đọc `visibilityTarget`, nên đẩy dòng sự kiện sang
    // quay vòng trước đã. Sau mỗi lần hỏng, kênh tự hẹn giờ nối lại và mở một
    // `EventSource` MỚI — phải nhích đồng hồ qua nhịp đó thì lần hỏng kế tiếp
    // mới rơi vào kênh đang sống.
    for (let failure = 0; failure < SSE_FAILURE_LIMIT; failure += 1) {
      await act(async () => {
        latestSource().triggerError();
        await clock.advance(POLL_INTERVAL_MS);
      });
    }

    await act(async () => {
      await clock.advance(POLL_INTERVAL_MS);
    });

    const whileVisible = harness.progressCalls();

    await act(async () => {
      visibility.setHidden(true);
      await clock.advance(POLL_INTERVAL_MS * 4);
    });

    expect(harness.progressCalls()).toBe(whileVisible);

    await act(async () => {
      visibility.setHidden(false);
      await clock.flushMicrotasks();
    });

    expect(harness.progressCalls()).toBeGreaterThan(whileVisible);

    mounted.unmount();
  });

  it('một tầng lỗi không dừng các tầng khác', async () => {
    const harness = makeScriptedClient();
    const uploads = await readFloorUploads(harness.client, 3);
    const [failing, healthy] = [uploads[0]!, uploads[1]!];
    const visibility = new MockVisibilityTarget();
    const mounted = mountHook(harness.client, uploads, createTestQueryClient(), visibility);

    await settle(clock);
    expect(mounted.result.current.floors).toHaveLength(uploads.length);

    // Đổi do hợp đồng (trần 6 luồng): chỉ tầng đang xem có `EventSource`;
    // tầng thứ hai nhận nhịp qua #8, hỏi mỗi 5 s.
    expect(MockEventSource.instances).toHaveLength(1);

    for (let stageIndex = 0; stageIndex < 4; stageIndex += 1) {
      harness.queue(healthy.uploadId, progressAt(healthy.uploadId, stageIndex));
      await act(async () => {
        await clock.advance(OTHER_FLOOR_POLL_INTERVAL_MS);
      });
    }

    // Tầng đầu (đang xem) hỏng ở bước 2.
    await act(async () => {
      latestSource().triggerOpen();
      latestSource().triggerMessage(
        progressAt(failing.uploadId, 1, { status: 'failed', error: 'FILE_CORRUPT' }),
      );
      await clock.advance(0);
    });
    await settle(clock);

    const props = mounted.result.current;
    const failedChip = props.floors.find((floor) => floor.id === failing.floorId);
    const healthyChip = props.floors.find((floor) => floor.id === healthy.floorId);

    expect(failedChip?.status).toBe('failed');
    expect(healthyChip?.status).toBe('running');
    expect(props.state).toBe('partial');
    expect(props.partialNoticeLine).toContain('vẫn đang được xử lý');
    expect(props.partialNoticeLine).toContain(failing.floorName);
    // Tầng đang xem đổi sang tầng còn chạy: `EventSource` mới là của tầng đó.
    expect(latestSource().url).toContain(healthy.uploadId);
    expect(MockEventSource.instances.filter((source) => !source.closed)).toHaveLength(1);
    // Còn tầng chạy thì không gắn S-11.
    expect(props.failedPipelineStep).toBeUndefined();

    mounted.unmount();
  });

  it('rời màn giữa chừng rồi quay lại: tiến độ giữ nguyên', async () => {
    const harness = makeScriptedClient();
    const uploads = await readFloorUploads(harness.client, 1);
    const upload = uploads[0]!;
    const queryClient = createTestQueryClient();
    const visibility = new MockVisibilityTarget();
    const first = mountHook(harness.client, uploads, queryClient, visibility);

    await settle(clock);

    await act(async () => {
      latestSource().triggerOpen();
    });

    for (let stageIndex = 0; stageIndex < 4; stageIndex += 1) {
      await act(async () => {
        latestSource().triggerMessage(progressAt(upload.uploadId, stageIndex));
        await clock.advance(POLL_INTERVAL_MS);
      });
    }

    const doneBeforeLeaving = doneStepCount(first.result.current);
    expect(doneBeforeLeaving).toBe(3);

    first.unmount();

    // Máy chủ vẫn trả nhịp cuối cùng nó biết; lượt đọc mồi của lần quay lại
    // không được xoá tiến độ đã tích được trong bộ nhớ đệm.
    const second = mountHook(harness.client, uploads, queryClient, visibility);

    await settle(clock);

    expect(doneStepCount(second.result.current)).toBeGreaterThanOrEqual(doneBeforeLeaving);

    second.unmount();
  });

  it('lượt đọc báo cả lượt đã xong: đủ sáu bước xong và màn tới trạng thái success', async () => {
    const harness = makeScriptedClient();
    const uploads = await readFloorUploads(harness.client, 1);
    const upload = uploads[0]!;
    const visibility = new MockVisibilityTarget();
    const mounted = mountHook(harness.client, uploads, createTestQueryClient(), visibility);

    await settle(clock);

    await act(async () => {
      latestSource().triggerOpen();
      latestSource().triggerMessage(finishedProgress(upload.uploadId));
      await clock.advance(POLL_INTERVAL_MS);
    });

    const props = mounted.result.current;

    expect(doneStepCount(props)).toBe(STAGES.length);
    expect(props.steps.every((step) => step.percent === 100)).toBe(true);
    expect(props.state).toBe('success');
    expect(props.overallSummaryLine).toContain('Đã xử lý xong 1/1 tầng');

    mounted.unmount();
  });

  it('narrow and finished is still success, so the summary stays on top (K5)', async () => {
    const harness = makeScriptedClient();
    const uploads = await readFloorUploads(harness.client, 1);
    const upload = uploads[0]!;
    const mounted = mountHook(harness.client, uploads, createTestQueryClient(), new MockVisibilityTarget(), {
      forceCollapsed: true,
    });

    await settle(clock);
    expect(mounted.result.current.state).toBe('collapsed');

    await act(async () => {
      latestSource().triggerOpen();
      latestSource().triggerMessage(finishedProgress(upload.uploadId));
      await clock.advance(POLL_INTERVAL_MS);
    });

    expect(mounted.result.current.state).toBe('success');
    expect(mounted.result.current.isCompact).toBe(true);

    mounted.unmount();
  });

  // BUG-360: the seed read (#8) and the first SSE event both say "Tiền xử lý — 0%".
  it('the same progress twice in a row writes one log line, not two (BUG-360)', async () => {
    const harness = makeScriptedClient();
    const uploads = await readFloorUploads(harness.client, 1);
    const upload = uploads[0]!;
    const mounted = mountHook(harness.client, uploads, createTestQueryClient(), new MockVisibilityTarget());

    await settle(clock);
    await act(async () => {
      latestSource().triggerOpen();
      latestSource().triggerMessage(progressAt(upload.uploadId, 0));
      latestSource().triggerMessage(progressAt(upload.uploadId, 1));
      await clock.advance(POLL_INTERVAL_MS);
    });

    expect(mounted.result.current.logLines.map((line) => line.text)).toEqual([
      `${upload.floorName}: ${STAGES[0]!.label} — 0%`,
      `${upload.floorName}: ${STAGES[1]!.label} — 0%`,
    ]);

    mounted.unmount();
  });

  // BUG-352: every stage timed, so the estimate exists — and is 0 once all is done.
  it('a run that finished stage by stage says only "Đã xử lý xong 1/1 tầng", no "Còn lại khoảng 0 giây" (BUG-352)', async () => {
    const harness = makeScriptedClient();
    const uploads = await readFloorUploads(harness.client, 1);
    const upload = uploads[0]!;
    const mounted = mountHook(harness.client, uploads, createTestQueryClient(), new MockVisibilityTarget());

    await settle(clock);
    await act(async () => {
      latestSource().triggerOpen();
    });

    const remainingLines: (string | undefined)[] = [];

    for (let stageIndex = 0; stageIndex < STAGES.length; stageIndex += 1) {
      await act(async () => {
        latestSource().triggerMessage(progressAt(upload.uploadId, stageIndex));
        await clock.advance(POLL_INTERVAL_MS);
      });

      // R1-03: the remaining time is its own field, kept out of the status line.
      expect(mounted.result.current.overallSummaryLine).toBe('Đã xử lý xong 0/1 tầng');
      remainingLines.push(mounted.result.current.remainingLine);
    }

    expect(remainingLines.some((line) => line !== undefined && /^Còn lại khoảng \S/u.test(line))).toBe(true);

    await act(async () => {
      latestSource().triggerMessage(finishedProgress(upload.uploadId));
      await clock.advance(POLL_INTERVAL_MS);
    });

    expect(mounted.result.current.state).toBe('success');
    expect(mounted.result.current.overallSummaryLine).toBe('Đã xử lý xong 1/1 tầng');
    expect(mounted.result.current.remainingLine).toBeUndefined();

    mounted.unmount();
  });

  // BUG-285: the real gateway answered `extractionSummary` "unsupported", so a finished run had no
  // "Báo cáo tổng kết" and no way on to "Duyệt lớp tường". The counts come from N16 once the floor is done.
  it('a finished floor shows the summary counted from its layer, and "Duyệt lớp tường" leads to that floor (BUG-285)', async () => {
    const harness = makeScriptedClient();
    const uploads = await readFloorUploads(harness.client, 1);
    const upload = uploads[0]!;
    const layer = await harness.client.spatial.readLayer({ projectId: PROJECT_ID, floorId: upload.floorId });
    if (!layer.ok) throw new Error('Không đọc được lớp tầng mẫu.');
    const readLayer = vi.spyOn(harness.client.spatial, 'readLayer');
    const onNavigate = vi.fn();
    const mounted = mountHook(harness.client, uploads, createTestQueryClient(), new MockVisibilityTarget(), {
      onNavigate,
    });

    await settle(clock);
    // Still running: the layer still holds the previous run, so it is not read yet.
    expect(mounted.result.current.summary).toBeUndefined();
    expect(readLayer).not.toHaveBeenCalled();

    await act(async () => {
      latestSource().triggerOpen();
      latestSource().triggerMessage(finishedProgress(upload.uploadId));
      await clock.advance(POLL_INTERVAL_MS);
    });
    await settle(clock);

    const summary = mounted.result.current.summary;
    expect(summary?.metricLabels[0]).toBe(`${String(layer.data.layer.walls.length)} tường`);
    expect(summary?.metricLabels).toHaveLength(5);
    expect(summary?.lowConfidenceSentence).toBeDefined();

    summary?.onReviewWalls();
    expect(onNavigate).toHaveBeenCalledWith(`/projects/${PROJECT_ID}/floors/${upload.floorId}/layers/walls`);

    mounted.unmount();
  });

  // BUG-353: the floor chip counted walls + openings + rooms, the summary chip walls + openings —
  // two numbers under one word. And "Chuỗi kích thước" was the one capitalised chip (A6).
  it('a finished floor counts "đối tượng" the same in its chip and in the summary (BUG-353)', async () => {
    const harness = makeScriptedClient();
    const uploads = await readFloorUploads(harness.client, 1);
    const upload = uploads[0]!;
    const layer = await harness.client.spatial.readLayer({ projectId: PROJECT_ID, floorId: upload.floorId });
    if (!layer.ok) throw new Error('Không đọc được lớp tầng mẫu.');
    const { dimensions, layer: sample } = SAMPLE_LAYER_DOCUMENT;
    vi.spyOn(harness.client.spatial, 'readLayer').mockResolvedValue({
      ok: true,
      // UX-R2 K46: tầng có tỷ lệ chốt (level.scaleMillimetresPerPixel, không scaleStatus) mới ghi diện tích; thiếu thì "Chưa có tỷ lệ".
      data: {
        ...layer.data,
        level: { ...layer.data.level, scaleMillimetresPerPixel: millimetresPerPixel(10) },
        dimensions,
        layer: sample,
      },
    });
    const mounted = mountHook(harness.client, uploads, createTestQueryClient(), new MockVisibilityTarget());

    await settle(clock);
    await act(async () => {
      latestSource().triggerOpen();
      latestSource().triggerMessage(finishedProgress(upload.uploadId));
      await clock.advance(POLL_INTERVAL_MS);
    });
    await settle(clock);

    // R-1: chip đếm cả đồ đạc, như ở màn Xuất; K52: gọi là "mục nhận diện", tổng kết ghi cửa và nội thất riêng.
    const objectLabel = `${String(sample.walls.length + sample.openings.length + sample.furniture.length + sample.rooms.length)} mục nhận diện`;
    expect(mounted.result.current.floors[0]?.objectCountLabel).toBe(objectLabel);
    expect(mounted.result.current.summary?.metricLabels[1]).toBe(
      `${String(sample.openings.length)} cửa, ${String(sample.furniture.length)} nội thất`,
    );
    expect(mounted.result.current.summary?.metricLabels[2]).toBe(`${String(dimensions.length)} chuỗi kích thước`);
    // K5: total area = outlines added in mm², rounded once (as on the rooms screen), not the
    // sum of each room's already-rounded `areaM2`.
    expect(mounted.result.current.summary?.metricLabels[4]).toBe(
      formatArea(totalArea(sample.rooms.map((room) => room.outline.map(toPointMm)))),
    );

    mounted.unmount();
  });

  // BUG-354: the sentence used the global 0,70 while the project setting said 0,75.
  it.each([
    { threshold: 0.95, label: '0,95' },
    { threshold: 0.5, label: '0,50' },
  ])('the low-confidence sentence counts against the project threshold $label (BUG-354)', async ({ label, threshold }) => {
    const harness = makeScriptedClient();
    const uploads = await readFloorUploads(harness.client, 1);
    const upload = uploads[0]!;
    const layer = await harness.client.spatial.readLayer({ projectId: PROJECT_ID, floorId: upload.floorId });
    const settings = await harness.client.projectSettings.read({ projectId: PROJECT_ID });
    if (!layer.ok || !settings.ok) throw new Error('Không đọc được dữ liệu mẫu.');
    const { dimensions, layer: sample } = SAMPLE_LAYER_DOCUMENT;
    vi.spyOn(harness.client.spatial, 'readLayer').mockResolvedValue({
      ok: true,
      data: { ...layer.data, dimensions, layer: sample },
    });
    vi.spyOn(harness.client.projectSettings, 'read').mockResolvedValue({
      ok: true,
      data: { ...settings.data, confidenceThreshold: threshold },
    });
    const mounted = mountHook(harness.client, uploads, createTestQueryClient(), new MockVisibilityTarget());

    await settle(clock);
    await act(async () => {
      latestSource().triggerOpen();
      latestSource().triggerMessage(finishedProgress(upload.uploadId));
      await clock.advance(POLL_INTERVAL_MS);
    });
    await settle(clock);

    const low = [...sample.walls, ...sample.openings, ...sample.furniture, ...sample.rooms].filter(
      (item) => !item.reviewed && item.confidence < threshold,
    ).length;
    expect(mounted.result.current.summary?.lowConfidenceSentence).toBe(
      low === 0
        ? `Không có chỗ nào máy chưa chắc (ngưỡng ${label}).`
        : `${String(low)} chỗ máy chưa chắc, nên xem lại.`,
    );

    mounted.unmount();
  });

  it('settings that cannot be read drop the low-confidence sentence, not the counts (BUG-354)', async () => {
    const harness = makeScriptedClient();
    const uploads = await readFloorUploads(harness.client, 1);
    const upload = uploads[0]!;
    vi.spyOn(harness.client.projectSettings, 'read').mockResolvedValue({
      ok: false,
      error: new Error('N5 down') as unknown as HttpError,
    });
    const mounted = mountHook(harness.client, uploads, createTestQueryClient(), new MockVisibilityTarget());

    await settle(clock);
    await act(async () => {
      latestSource().triggerOpen();
      latestSource().triggerMessage(finishedProgress(upload.uploadId));
      await clock.advance(POLL_INTERVAL_MS);
    });
    await settle(clock);

    expect(mounted.result.current.summary?.metricLabels).toHaveLength(5);
    expect(mounted.result.current.summary?.lowConfidenceSentence).toBeUndefined();

    mounted.unmount();
  });

  it('a finished floor whose layer cannot be read still offers the way on, without counts (BUG-285)', async () => {
    const harness = makeScriptedClient();
    const uploads = await readFloorUploads(harness.client, 1);
    const upload = uploads[0]!;
    vi.spyOn(harness.client.spatial, 'readLayer').mockResolvedValue({
      ok: false,
      error: new Error('N16 down') as unknown as HttpError,
    });
    const mounted = mountHook(harness.client, uploads, createTestQueryClient(), new MockVisibilityTarget());

    await settle(clock);
    await act(async () => {
      latestSource().triggerOpen();
      latestSource().triggerMessage(finishedProgress(upload.uploadId));
      await clock.advance(POLL_INTERVAL_MS);
    });
    await settle(clock);

    expect(mounted.result.current.summary?.metricLabels).toEqual([]);
    expect(mounted.result.current.summary?.onReviewWalls).toBeTypeOf('function');

    mounted.unmount();
  });

  it.each([
    ['chép được', () => Promise.resolve(), 'Đã chép nhật ký'],
    ['khay nhớ tạm từ chối', () => Promise.reject(new Error('denied')), 'Không chép được nhật ký'],
  ] as const)('"Sao chép nhật ký" có phản hồi — %s', async (_case, write, title) => {
    const harness = makeScriptedClient();
    const uploads = await readFloorUploads(harness.client, 1);
    const notifications = createNotificationBus();
    const writeClipboardText = vi.fn(write);
    const mounted = mountHook(harness.client, uploads, createTestQueryClient(), new MockVisibilityTarget(), {
      notifications,
      writeClipboardText,
    });

    await settle(clock);
    await act(async () => {
      mounted.result.current.onCopyLog();
      await clock.flushMicrotasks();
    });

    expect(writeClipboardText).toHaveBeenCalledOnce();
    expect(notifications.list().map((item) => item.title)).toContain(title);

    mounted.unmount();
  });

  it('bấm chạy nền rồi RỜI MÀN: dòng sự kiện vẫn sống và lượt xong vẫn báo được', async () => {
    const harness = makeScriptedClient();
    const uploads = await readFloorUploads(harness.client, 1);
    const upload = uploads[0]!;
    const visibility = new MockVisibilityTarget();
    const notifications = createNotificationBus();
    const backgroundWatches = createBackgroundWatchRegistry();
    const mounted = mountHook(
      harness.client,
      uploads,
      createTestQueryClient(),
      visibility,
      { backgroundWatches, notifications },
    );

    await settle(clock);

    await act(async () => {
      latestSource().triggerOpen();
      latestSource().triggerMessage(progressAt(upload.uploadId, 0));
      await clock.advance(POLL_INTERVAL_MS);
    });

    // 1. Bấm nút. Lượt vào sổ theo dõi nền, và người dùng được hứa một câu.
    await act(async () => {
      mounted.result.current.onRunInBackground();
      await clock.flushMicrotasks();
    });

    expect(backgroundWatches.has(`${PROJECT_ID}:${upload.uploadId}`)).toBe(true);
    expect(notifications.list().map((item) => item.title)).toContain(
      'Sẽ báo cho bạn khi xử lý xong',
    );

    // 2. Rời màn. Dòng sự kiện KHÔNG bị đóng — đó là toàn bộ lời hứa.
    const source = latestSource();

    mounted.unmount();

    expect(source.closed).toBe(false);
    expect(backgroundWatches.has(`${PROJECT_ID}:${upload.uploadId}`)).toBe(true);

    // 3. Máy chủ báo xong khi màn đã tháo từ lâu.
    await act(async () => {
      source.triggerMessage(finishedProgress(upload.uploadId));
      await clock.advance(POLL_INTERVAL_MS);
    });

    expect(notifications.list().map((item) => item.title)).toContain(
      `${upload.floorName} đã xử lý xong`,
    );
    // Lượt đã kết thúc: sổ nhả nó, và dòng sự kiện được đóng đúng lúc này.
    expect(backgroundWatches.has(`${PROJECT_ID}:${upload.uploadId}`)).toBe(false);
    expect(source.closed).toBe(true);
  });

  it('rời màn mà KHÔNG bấm chạy nền: dòng sự kiện đóng lại như cũ', async () => {
    const harness = makeScriptedClient();
    const uploads = await readFloorUploads(harness.client, 1);
    const visibility = new MockVisibilityTarget();
    const notifications = createNotificationBus();
    const mounted = mountHook(
      harness.client,
      uploads,
      createTestQueryClient(),
      visibility,
      { backgroundWatches: createBackgroundWatchRegistry(), notifications },
    );

    await settle(clock);

    const source = latestSource();

    mounted.unmount();

    expect(source.closed).toBe(true);
    expect(notifications.list()).toEqual([]);
  });

  it('lượt hỏng khi đang chạy nền: câu báo nói lỗi, không nói xong', async () => {
    const harness = makeScriptedClient();
    const uploads = await readFloorUploads(harness.client, 1);
    const upload = uploads[0]!;
    const visibility = new MockVisibilityTarget();
    const notifications = createNotificationBus();
    const backgroundWatches = createBackgroundWatchRegistry();
    const mounted = mountHook(
      harness.client,
      uploads,
      createTestQueryClient(),
      visibility,
      { backgroundWatches, notifications },
    );

    await settle(clock);

    await act(async () => {
      latestSource().triggerOpen();
      mounted.result.current.onRunInBackground();
      await clock.flushMicrotasks();
    });

    const source = latestSource();

    mounted.unmount();

    await act(async () => {
      source.triggerMessage(
        progressAt(upload.uploadId, 1, { status: 'failed', error: 'PDF_UNREADABLE' }),
      );
      await clock.advance(POLL_INTERVAL_MS);
    });

    expect(notifications.list().map((item) => item.title)).toContain(
      `${upload.floorName} gặp lỗi khi xử lý`,
    );
    expect(notifications.list().map((item) => item.title)).not.toContain(
      `${upload.floorName} đã xử lý xong`,
    );
  });

  it('không có lượt xử lý nào thì bấm chạy nền KHÔNG hứa gì', async () => {
    const visibility = new MockVisibilityTarget();
    const notifications = createNotificationBus();
    const harness = makeScriptedClient();
    const mounted = mountHook(harness.client, [], createTestQueryClient(), visibility, {
      backgroundWatches: createBackgroundWatchRegistry(),
      notifications,
    });

    await settle(clock);

    await act(async () => {
      mounted.result.current.onRunInBackground();
      await clock.flushMicrotasks();
    });

    // Hứa "sẽ báo cho bạn khi xử lý xong" lúc không có gì đang chạy là hứa một
    // thông báo không bao giờ tới.
    expect(notifications.list()).toEqual([]);

    mounted.unmount();
  });

  it('khổ hẹp không có lượt nào vẫn là empty, không phải hai cột rỗng', async () => {
    const harness = makeScriptedClient();
    const gateway = createProcessingGateway(harness.client, {
      EventSourceImpl: MockEventSource as unknown as typeof EventSource,
      visibilityTarget: new MockVisibilityTarget(),
    });
    const queryClient = createTestQueryClient();
    const rendered = renderHook(
      () => useProcessingScreen({ projectId: PROJECT_ID, floorUploads: [], gateway, forceCollapsed: true }),
      { wrapper: ({ children }: { children: ReactNode }) => createElement(QueryClientProvider, { client: queryClient }, children) },
    );

    await settle(clock);

    expect(rendered.result.current.state).toBe('empty');
    rendered.unmount();
  });

  it('không có lượt xử lý nào thì màn ở trạng thái empty, không phải tiến độ bịa', async () => {
    const harness = makeScriptedClient();
    const visibility = new MockVisibilityTarget();
    const mounted = mountHook(harness.client, [], createTestQueryClient(), visibility);

    await settle(clock);

    const props = mounted.result.current;

    expect(props.state).toBe('empty');
    // Các việc chưa có endpoint, phản ánh trung thực ra props — không giá trị bịa.
    // `cancelProcessing` bật thì phải có hoãn A8 trước — B-V4-09.
    expect(props.canCancel).toBe(false);
    expect(props.queueLine).toBeUndefined();
    expect(props.summary).toBeUndefined();
    expect(props.previewPanel.detectedGeometryPaths).toHaveLength(0);
    expect(props.steps).toHaveLength(0);
    // BUG-165: nothing runs, so no "Đã xử lý xong 0/0 tầng" and no promise to notify.
    expect(props.overallSummaryLine).toBe('Chưa có lượt xử lý nào đang chạy.');
    expect(props.canRunInBackground).toBe(false);

    mounted.unmount();
  });

  it('a deep link with nothing cached reads #24 once and names the project (BUG-165)', async () => {
    const harness = makeScriptedClient();
    const queryClient = createTestQueryClient();
    const read = vi.spyOn(harness.client.projects, 'read');
    const mounted = mountHook(harness.client, [], queryClient, new MockVisibilityTarget());

    await settle(clock);

    expect(read).toHaveBeenCalledTimes(1);
    expect(mounted.result.current.projectName).toBe('Chung cư Hoàng Anh');
    expect(queryClient.getQueryData(queryKeys.project.detail(PROJECT_ID))).toMatchObject({ name: 'Chung cư Hoàng Anh' });
    mounted.unmount();
  });

  it('names the project from the dashboard cards already cached, without a request (BUG-165)', async () => {
    const harness = makeScriptedClient();
    const queryClient = createTestQueryClient();
    queryClient.setQueryData(queryKeys.project.summaries(), { projects: [{ id: PROJECT_ID, name: 'Nhà phố Quận 3' }], droppedCount: 0 });
    const read = vi.spyOn(harness.client.projects, 'read');
    const mounted = mountHook(harness.client, [], queryClient, new MockVisibilityTarget());

    await settle(clock);

    expect(mounted.result.current.projectName).toBe('Nhà phố Quận 3');
    expect(read).not.toHaveBeenCalled();
    mounted.unmount();
  });

  /* ---------------------------------------------------------------------- */
  /* F-05b — N7, một luồng mỗi màn, bản đệm theo lượt, vô hiệu.               */
  /* ---------------------------------------------------------------------- */

  const U1 = 'upl_01J8Z3K4Q5R6S7T8V9W0XYZAB1';
  const U2 = 'upl_01J8Z3K4Q5R6S7T8V9W0XYZAB2';
  const FLOOR = { floorId: 'L1', floorName: 'Tầng 1' } as const;
  const openSources = (): readonly MockEventSource[] =>
    MockEventSource.instances.filter((source) => !source.closed);

  it('không truyền floorUploads: N7 chờ → loading, lỗi → error, rỗng → empty', async () => {
    const visibility = new MockVisibilityTarget();
    const waiting = makeScriptedClient();
    waiting.setLatest('pending');
    const pending = mountHook(waiting.client, undefined, createTestQueryClient(), visibility);
    await settle(clock);
    expect(pending.result.current.state).toBe('loading');
    pending.unmount();

    const failing = makeScriptedClient();
    failing.setLatest({
      ok: false,
      error: { kind: 'network', requestId: 'r', retryable: true, raw: null },
    });
    const failed = mountHook(failing.client, undefined, createTestQueryClient(), visibility);
    await settle(clock);
    expect(failed.result.current.state).toBe('error');
    expect(failed.result.current.errorAlert).toBeDefined();
    failed.unmount();

    const empty = makeScriptedClient();
    const none = mountHook(empty.client, undefined, createTestQueryClient(), visibility);
    await settle(clock);
    expect(empty.latestCalls()).toBe(1);
    expect(none.result.current.state).toBe('empty');
    none.unmount();
  });

  it('ba tầng chưa xong: đúng 1 EventSource, hai tầng kia hỏi #8', async () => {
    const harness = makeScriptedClient();
    const uploads = await readFloorUploads(harness.client, 3);
    harness.setLatest({ ok: true, data: [...uploads] });
    const mounted = mountHook(harness.client, undefined, createTestQueryClient(), new MockVisibilityTarget());

    await settle(clock);
    await act(async () => {
      await clock.advance(OTHER_FLOOR_POLL_INTERVAL_MS);
    });

    console.log(`F-05b [11].4 — EventSource trong ca ba tầng: ${MockEventSource.instances.length}`);
    expect(MockEventSource.instances).toHaveLength(1);
    expect(latestSource().url).toContain(uploads[0]!.uploadId);
    // Lượt mồi + lượt hỏi ngay + một nhịp 5 s.
    expect(harness.callsFor(uploads[0]!.uploadId)).toBe(1);
    expect(harness.callsFor(uploads[1]!.uploadId)).toBe(3);
    expect(harness.callsFor(uploads[2]!.uploadId)).toBe(3);

    mounted.unmount();
    expect(openSources()).toHaveLength(0);
  });

  it('tầng đã xong theo #8 mồi: không đăng ký gì', async () => {
    const harness = makeScriptedClient();
    harness.queue(U1, finishedProgress(U1));
    const mounted = mountHook(harness.client, [{ ...FLOOR, uploadId: U1 }], createTestQueryClient(), new MockVisibilityTarget());

    await settle(clock);
    await act(async () => {
      await clock.advance(OTHER_FLOOR_POLL_INTERVAL_MS * 6);
    });

    expect(MockEventSource.instances).toHaveLength(0);
    expect(harness.callsFor(U1)).toBe(1);
    expect(mounted.result.current.state).toBe('success');
    mounted.unmount();
  });

  it('PIPELINE_SUPERSEDED: đọc lại N7 đúng một lần, không failedPipelineStep', async () => {
    const harness = makeScriptedClient();
    harness.setLatest({ ok: true, data: [{ ...FLOOR, uploadId: U1 }] });
    harness.queue(U1, progressAt(U1, 2, { status: 'failed', error: 'PIPELINE_SUPERSEDED' }));
    const mounted = mountHook(harness.client, undefined, createTestQueryClient(), new MockVisibilityTarget());

    await settle(clock);
    await settle(clock);

    expect(harness.latestCalls()).toBe(2);
    expect(mounted.result.current.failedPipelineStep).toBeUndefined();
    expect(mounted.result.current.floors[0]?.status).not.toBe('failed');
    mounted.unmount();
  });

  it('bản đệm completed của U1, N7 trả U2 pending: 0 %, không xong, có đăng ký', async () => {
    const harness = makeScriptedClient();
    const queryClient = createTestQueryClient();
    const visibility = new MockVisibilityTarget();
    harness.queue(U1, finishedProgress(U1));
    const first = mountHook(harness.client, [{ ...FLOOR, uploadId: U1 }], queryClient, visibility);
    await settle(clock);
    expect(first.result.current.state).toBe('success');
    first.unmount();

    harness.queue(U2, progressAt(U2, 0, { status: 'pending' }));
    const second = mountHook(harness.client, [{ ...FLOOR, uploadId: U2 }], queryClient, visibility);
    await settle(clock);

    expect(second.result.current.state).not.toBe('success');
    expect(second.result.current.steps.every((step) => step.percent === 0)).toBe(true);
    expect(second.result.current.steps.some((step) => step.status === 'done')).toBe(false);
    expect(openSources()).toHaveLength(1);
    second.unmount();
  });

  it('cùng U1, #8 mồi pending sau bản đệm completed: không xong', async () => {
    const harness = makeScriptedClient();
    const queryClient = createTestQueryClient();
    const visibility = new MockVisibilityTarget();
    const uploads = [{ ...FLOOR, uploadId: U1 }];
    harness.queue(U1, finishedProgress(U1));
    const first = mountHook(harness.client, uploads, queryClient, visibility);
    await settle(clock);
    first.unmount();

    harness.queue(U1, progressAt(U1, 0, { status: 'pending' }));
    const second = mountHook(harness.client, uploads, queryClient, visibility);
    await settle(clock);

    expect(second.result.current.state).not.toBe('success');
    expect(second.result.current.steps.some((step) => step.status === 'done')).toBe(false);
    expect(openSources()).toHaveLength(1);
    second.unmount();
  });

  it('bấm chạy nền hai lần: luồng đang dùng không bị đóng', async () => {
    const harness = makeScriptedClient();
    const backgroundWatches = createBackgroundWatchRegistry();
    const mounted = mountHook(harness.client, [{ ...FLOOR, uploadId: U1 }], createTestQueryClient(), new MockVisibilityTarget(), {
      backgroundWatches,
      notifications: createNotificationBus(),
    });
    await settle(clock);
    const source = latestSource();

    await act(async () => {
      mounted.result.current.onRunInBackground();
      mounted.result.current.onRunInBackground();
      await clock.flushMicrotasks();
    });

    expect(source.closed).toBe(false);
    expect(MockEventSource.instances).toHaveLength(1);
    backgroundWatches.releaseAll();
    mounted.unmount();
  });

  it('tháo rồi gắn lại: đúng 1 EventSource mở', async () => {
    const harness = makeScriptedClient();
    const queryClient = createTestQueryClient();
    const visibility = new MockVisibilityTarget();
    const uploads = [{ ...FLOOR, uploadId: U1 }];
    const first = mountHook(harness.client, uploads, queryClient, visibility);
    await settle(clock);
    first.unmount();
    expect(openSources()).toHaveLength(0);

    const second = mountHook(harness.client, uploads, queryClient, visibility);
    await settle(clock);
    expect(openSources()).toHaveLength(1);
    second.unmount();
  });

  it('PIPELINE_SUPERSEDED trong sổ nền: nhả, không thông báo kết thúc', async () => {
    const harness = makeScriptedClient();
    const backgroundWatches = createBackgroundWatchRegistry();
    const notifications = createNotificationBus();
    const mounted = mountHook(harness.client, [{ ...FLOOR, uploadId: U1 }], createTestQueryClient(), new MockVisibilityTarget(), {
      backgroundWatches,
      notifications,
    });
    await settle(clock);
    await act(async () => {
      latestSource().triggerOpen();
      mounted.result.current.onRunInBackground();
      await clock.flushMicrotasks();
    });
    const before = notifications.list().length;
    const source = latestSource();
    mounted.unmount();

    await act(async () => {
      source.triggerMessage(progressAt(U1, 2, { status: 'failed', error: 'PIPELINE_SUPERSEDED' }));
      await clock.advance(0);
    });

    expect(notifications.list()).toHaveLength(before);
    expect(backgroundWatches.has(`${PROJECT_ID}:${U1}`)).toBe(false);
    expect(source.closed).toBe(true);
  });

  it('chạy nền rồi ở lại: tầng đang xem xong, tầng kế (trong sổ, đang hỏi) vẫn nhận nhịp và settle một lần', async () => {
    const harness = makeScriptedClient();
    const uploads = await readFloorUploads(harness.client, 2);
    const [focus, next] = [uploads[0]!, uploads[1]!];
    const backgroundWatches = createBackgroundWatchRegistry();
    const notifications = createNotificationBus();
    const mounted = mountHook(harness.client, uploads, createTestQueryClient(), new MockVisibilityTarget(), {
      backgroundWatches,
      notifications,
    });
    await settle(clock);
    await act(async () => {
      latestSource().triggerOpen();
      mounted.result.current.onRunInBackground();
      await clock.flushMicrotasks();
    });
    expect(backgroundWatches.list()).toHaveLength(2);

    await act(async () => {
      latestSource().triggerMessage(finishedProgress(focus.uploadId));
      await clock.advance(0);
    });
    await settle(clock);
    // Tầng kế trong sổ: không mở luồng mới cho nó.
    expect(MockEventSource.instances).toHaveLength(1);

    harness.queue(next.uploadId, progressAt(next.uploadId, 3));
    await act(async () => {
      await clock.advance(OTHER_FLOOR_POLL_INTERVAL_MS);
    });
    expect(mounted.result.current.floors[1]?.status).toBe('running');

    harness.queue(next.uploadId, finishedProgress(next.uploadId));
    await act(async () => {
      await clock.advance(OTHER_FLOOR_POLL_INTERVAL_MS * 3);
    });

    const doneTitle = `${next.floorName} đã xử lý xong`;
    expect(notifications.list().filter((item) => item.title === doneTitle)).toHaveLength(1);
    expect(backgroundWatches.list()).toHaveLength(0);
    mounted.unmount();
  });

  it('tầng completed lúc mở màn: vô hiệu layer.byFloor và layer.graph đúng một lần', async () => {
    const harness = makeScriptedClient();
    const queryClient = createTestQueryClient();
    const spy = vi.spyOn(queryClient, 'invalidateQueries');
    harness.queue(U1, finishedProgress(U1));
    const mounted = mountHook(harness.client, [{ ...FLOOR, uploadId: U1 }], queryClient, new MockVisibilityTarget());
    await settle(clock);
    mounted.rerender();
    await settle(clock);

    const keys = spy.mock.calls.map(([filters]) => JSON.stringify(filters?.queryKey));
    expect(keys.filter((key) => key === JSON.stringify(queryKeys.layer.byFloor(PROJECT_ID, 'L1')))).toHaveLength(1);
    expect(keys.filter((key) => key === JSON.stringify(queryKeys.layer.graph(PROJECT_ID)))).toHaveLength(1);
    mounted.unmount();
  });

  it('nhịp completed sau khi tháo (trong sổ): chỉ vô hiệu layer.byFloor', async () => {
    const harness = makeScriptedClient();
    const queryClient = createTestQueryClient();
    const backgroundWatches = createBackgroundWatchRegistry();
    const mounted = mountHook(harness.client, [{ ...FLOOR, uploadId: U1 }], queryClient, new MockVisibilityTarget(), {
      backgroundWatches,
      notifications: createNotificationBus(),
    });
    await settle(clock);
    await act(async () => {
      latestSource().triggerOpen();
      mounted.result.current.onRunInBackground();
      await clock.flushMicrotasks();
    });
    const source = latestSource();
    mounted.unmount();
    const spy = vi.spyOn(queryClient, 'invalidateQueries');

    await act(async () => {
      source.triggerMessage(finishedProgress(U1));
      await clock.advance(0);
    });

    const keys = spy.mock.calls.map(([filters]) => JSON.stringify(filters?.queryKey));
    expect(keys).toEqual([JSON.stringify(queryKeys.layer.byFloor(PROJECT_ID, 'L1'))]);
  });
  /* ---------------------------------------------------------------------- */
  /* Vòng sửa 1 — lỗi #8 tạm không làm tầng hỏng vĩnh viễn; một luồng.         */
  /* ---------------------------------------------------------------------- */

  const UNAVAILABLE: HttpError = {
    code: 'SERVICE_UNAVAILABLE',
    kind: 'http',
    raw: { code: 'SERVICE_UNAVAILABLE' },
    requestId: 'r-503',
    retryable: true,
    status: 503,
  };
  const OFFLINE: HttpError = { kind: 'network', requestId: 'r-net', retryable: true, raw: null };

  it('#8 của tầng hỏi trả 503 một lần rồi running: không S-11, chip không lỗi', async () => {
    const harness = makeScriptedClient();
    const uploads = await readFloorUploads(harness.client, 3);
    const [broken, streamed, polled] = [uploads[0]!, uploads[1]!, uploads[2]!];
    harness.queue(broken.uploadId, progressAt(broken.uploadId, 1, { status: 'failed', error: 'FILE_CORRUPT' }));
    const mounted = mountHook(harness.client, uploads, createTestQueryClient(), new MockVisibilityTarget());
    await settle(clock);
    expect(latestSource().url).toContain(streamed.uploadId);

    harness.queue(polled.uploadId, UNAVAILABLE);
    harness.queue(polled.uploadId, progressAt(polled.uploadId, 2, { progressPercent: 50 }));
    await act(async () => {
      await clock.advance(OTHER_FLOOR_POLL_INTERVAL_MS * 2);
    });
    await act(async () => {
      latestSource().triggerOpen();
      latestSource().triggerMessage(finishedProgress(streamed.uploadId));
      await clock.advance(0);
    });
    await settle(clock);

    const props = mounted.result.current;
    expect(props.floors.map((floor) => floor.status)).toEqual(['failed', 'done', 'running']);
    expect(props.failedPipelineStep).toBeUndefined();
    expect(props.partialNoticeLine).not.toContain(polled.floorName);
    mounted.unmount();
  });

  it('tầng đang xem đã giao sổ nền, lượt dò 120 s lỗi mạng: vẫn đúng 1 EventSource', async () => {
    const harness = makeScriptedClient();
    const uploads = await readFloorUploads(harness.client, 2);
    const [focused, waiting] = [uploads[0]!, uploads[1]!];
    harness.queue(waiting.uploadId, progressAt(waiting.uploadId, 0, { status: 'pending' }));
    const backgroundWatches = createBackgroundWatchRegistry();
    const mounted = mountHook(harness.client, uploads, createTestQueryClient(), new MockVisibilityTarget(), {
      backgroundWatches,
      notifications: createNotificationBus(),
    });
    await settle(clock);
    expect(latestSource().url).toContain(focused.uploadId);

    await act(async () => {
      latestSource().triggerOpen();
      latestSource().triggerMessage(progressAt(focused.uploadId, 1));
      mounted.result.current.onRunInBackground();
      await clock.flushMicrotasks();
    });
    expect(backgroundWatches.has(`${PROJECT_ID}:${focused.uploadId}`)).toBe(true);
    // Tầng còn `pending` cũng được giao cho sổ nền (BUG-542).
    expect(backgroundWatches.has(`${PROJECT_ID}:${waiting.uploadId}`)).toBe(true);

    harness.queue(focused.uploadId, OFFLINE);
    await act(async () => {
      await clock.advance(SSE_SILENCE_PROBE_MS);
    });
    // TanStack báo observer bằng `setTimeout(0)`; hẹn 0 ms đặt giữa lúc đồng hồ
    // giả đang chạy (lượt dò bắn từ hẹn im lặng) bị đẩy thành 1 ms.
    await act(() => clock.advance(1));
    await settle(clock);

    expect(openSources()).toHaveLength(1);
    expect(MockEventSource.instances).toHaveLength(1);
    expect(mounted.result.current.floors[0]?.isActive).toBe(true);
    backgroundWatches.releaseAll();
    mounted.unmount();
  });

  /* ---------------------------------------------------------------------- */
  /* Vòng sửa 2 — chốt một luồng đọc từ sổ nền; upload 404 là cuối.           */
  /* ---------------------------------------------------------------------- */

  const NOT_FOUND: HttpError = {
    code: 'NOT_FOUND',
    kind: 'http',
    raw: { code: 'NOT_FOUND' },
    requestId: 'r-404',
    retryable: false,
    status: 404,
  };

  it('[B pending, A SSE] chạy nền, B chạy, tháo rồi gắn lại: vẫn đúng 1 EventSource', async () => {
    const harness = makeScriptedClient();
    const uploads = await readFloorUploads(harness.client, 2);
    const [waiting, streamed] = [uploads[0]!, uploads[1]!];
    // `pending` chưa vào bước nào, nên B không giữ tầng đang xem.
    harness.queue(waiting.uploadId, progressAt(waiting.uploadId, 0, { status: 'pending', step: 'queued' }));
    const queryClient = createTestQueryClient();
    const visibility = new MockVisibilityTarget();
    const backgroundWatches = createBackgroundWatchRegistry();
    const background = { backgroundWatches, notifications: createNotificationBus() };
    const first = mountHook(harness.client, uploads, queryClient, visibility, background);
    await settle(clock);
    expect(latestSource().url).toContain(streamed.uploadId);

    await act(async () => {
      latestSource().triggerOpen();
      first.result.current.onRunInBackground();
      await clock.flushMicrotasks();
    });
    expect(backgroundWatches.has(`${PROJECT_ID}:${streamed.uploadId}`)).toBe(true);
    // Tầng còn `pending` cũng được giao cho sổ nền (BUG-542).
    expect(backgroundWatches.has(`${PROJECT_ID}:${waiting.uploadId}`)).toBe(true);

    harness.queue(waiting.uploadId, progressAt(waiting.uploadId, 1));
    await act(async () => {
      await clock.advance(PENDING_POLL_INTERVAL_MS);
    });
    await act(() => clock.advance(1));
    await settle(clock);
    expect(first.result.current.floors[0]?.isActive).toBe(true);
    expect(openSources()).toHaveLength(1);

    first.unmount();
    const second = mountHook(harness.client, uploads, queryClient, visibility, background);
    await settle(clock);
    expect(second.result.current.floors[0]?.isActive).toBe(true);
    expect(openSources()).toHaveLength(1);
    backgroundWatches.releaseAll();
    second.unmount();
  });

  it('A và B trong sổ nền, A 404, B failed: S-11 gắn, sổ nhả A', async () => {
    const harness = makeScriptedClient();
    const uploads = await readFloorUploads(harness.client, 2);
    const [gone, polled] = [uploads[0]!, uploads[1]!];
    const backgroundWatches = createBackgroundWatchRegistry();
    const mounted = mountHook(harness.client, uploads, createTestQueryClient(), new MockVisibilityTarget(), {
      backgroundWatches,
      notifications: createNotificationBus(),
    });
    await settle(clock);
    expect(latestSource().url).toContain(gone.uploadId);

    await act(async () => {
      latestSource().triggerOpen();
      latestSource().triggerMessage(progressAt(gone.uploadId, 1));
      mounted.result.current.onRunInBackground();
      await clock.flushMicrotasks();
    });
    expect(backgroundWatches.list()).toHaveLength(2);

    harness.queue(gone.uploadId, NOT_FOUND);
    await act(async () => {
      await clock.advance(SSE_SILENCE_PROBE_MS);
    });
    await act(() => clock.advance(1));
    expect(backgroundWatches.has(`${PROJECT_ID}:${gone.uploadId}`)).toBe(false);

    harness.queue(polled.uploadId, progressAt(polled.uploadId, 1, { status: 'failed', error: 'FILE_CORRUPT' }));
    await act(async () => {
      await clock.advance(OTHER_FLOOR_POLL_INTERVAL_MS);
    });
    await act(() => clock.advance(1));
    await settle(clock);

    expect(mounted.result.current.failedPipelineStep).toMatchObject({
      floorId: polled.floorId,
      failureCode: 'FILE_CORRUPT',
    });
    expect(backgroundWatches.list()).toHaveLength(0);
    expect(openSources()).toHaveLength(0);
    mounted.unmount();
  });

  /* ---------------------------------------------------------------------- */
  /* DEBT-03 — tầng đang xem (NO-363, NO-364).                               */
  /* ---------------------------------------------------------------------- */

  it('NO-363: tầng đang xem bỏ qua tầng có upload đã mất (404), nhường cho tầng còn chạy', async () => {
    const harness = makeScriptedClient();
    const uploads = await readFloorUploads(harness.client, 2);
    const gone = uploads[0]!;
    const mounted = mountHook(harness.client, uploads, createTestQueryClient(), new MockVisibilityTarget());
    await settle(clock);
    expect(mounted.result.current.floors[0]?.isActive).toBe(true);

    await act(async () => {
      latestSource().triggerOpen();
      latestSource().triggerMessage(progressAt(gone.uploadId, 1));
      await clock.flushMicrotasks();
    });

    harness.queue(gone.uploadId, NOT_FOUND);
    await act(async () => {
      await clock.advance(SSE_SILENCE_PROBE_MS);
    });
    await act(() => clock.advance(1));
    await settle(clock);

    expect(mounted.result.current.floors.map((floor) => floor.isActive)).toEqual([false, true]);
    mounted.unmount();
  });

  it('NO-364: tầng pending có step thật không hiện tiến độ giả và không chiếm tầng đang xem', async () => {
    const harness = makeScriptedClient();
    const uploads = await readFloorUploads(harness.client, 2);
    const waiting = uploads[0]!;
    // Máy chủ đã ghi sẵn `step` của một bước thật trong khi lượt còn xếp hàng.
    harness.queue(waiting.uploadId, progressAt(waiting.uploadId, 2, { status: 'pending' }));
    const mounted = mountHook(harness.client, uploads, createTestQueryClient(), new MockVisibilityTarget());
    await settle(clock);

    expect(mounted.result.current.floors.map((floor) => floor.isActive)).toEqual([false, true]);
    expect(mounted.result.current.floors[0]?.status).toBe('queued');
    expect(latestSource().url).toContain(uploads[1]!.uploadId);
    mounted.unmount();
  });

  it('NO-364: một tầng duy nhất đang pending có step thật thì sáu bước vẫn 0%', async () => {
    const harness = makeScriptedClient();
    const uploads = await readFloorUploads(harness.client, 1);
    const waiting = uploads[0]!;
    harness.queue(waiting.uploadId, progressAt(waiting.uploadId, 2, { status: 'pending' }));
    const mounted = mountHook(harness.client, uploads, createTestQueryClient(), new MockVisibilityTarget());
    await settle(clock);

    expect(doneStepCount(mounted.result.current)).toBe(0);
    expect(percentSnapshot(mounted.result.current).every((percent) => percent === 0)).toBe(true);
    expect(mounted.result.current.steps.some((step) => step.status === 'running')).toBe(false);
    mounted.unmount();
  });

  it('NO-364: lượt mới (pending) trên upload đang xem đưa tiến độ về 0, không giữ bước của lượt cũ', async () => {
    const harness = makeScriptedClient();
    const uploads = await readFloorUploads(harness.client, 1);
    const upload = uploads[0]!;
    const mounted = mountHook(harness.client, uploads, createTestQueryClient(), new MockVisibilityTarget());
    await settle(clock);

    await act(async () => {
      latestSource().triggerOpen();
      latestSource().triggerMessage(progressAt(upload.uploadId, 3));
      await clock.advance(POLL_INTERVAL_MS);
    });
    expect(doneStepCount(mounted.result.current)).toBe(3);

    await act(async () => {
      latestSource().triggerMessage(progressAt(upload.uploadId, 0, { status: 'pending' }));
      await clock.advance(POLL_INTERVAL_MS);
    });

    expect(doneStepCount(mounted.result.current)).toBe(0);
    expect(percentSnapshot(mounted.result.current).every((percent) => percent === 0)).toBe(true);
    mounted.unmount();
  });
});

describe('processingGateway — NO-154 qua cổng tiến độ', () => {
  let clock: FakeClock;
  let refreshSingleFlight: MockInstance<typeof auth.refreshSingleFlight>;

  beforeEach(() => {
    clock = installFakeClock();
    MockEventSource.instances = [];
    // Đếm lượt xin refresh mà không gửi lượt refresh thật nào — chỉ trong khối này.
    refreshSingleFlight = vi.spyOn(auth, 'refreshSingleFlight').mockResolvedValue(false);
  });

  afterEach(() => {
    refreshSingleFlight.mockRestore();
    clock.restore();
  });

  it('SSE chết SSE_FAILURE_LIMIT lần: cổng xin refresh phiên đúng MỘT lần cho cả chuỗi chết', async () => {
    const gateway = createProcessingGateway(createMockApiClient(), {
      EventSourceImpl: MockEventSource as unknown as typeof EventSource,
    });
    const stop = gateway.subscribeProgress(
      { projectId: PROJECT_ID, uploadId: 'upl_01J8Z3K4Q5R6S7T8V9W0XYZAB1', floorId: 'L1' },
      { onSnapshot: () => undefined, onFailure: () => undefined },
    );

    for (let failure = 0; failure < SSE_FAILURE_LIMIT; failure += 1) {
      latestSource().triggerError();
      await clock.advance(POLL_INTERVAL_MS);
    }

    expect(refreshSingleFlight).toHaveBeenCalledTimes(1);
    expect(refreshSingleFlight).toHaveBeenCalledWith({ source: 'local' });

    // Kênh thử SSE lại theo hẹn và lại chết: vẫn cùng một chuỗi, không xin thêm.
    for (let retry = 0; retry < 2; retry += 1) {
      await clock.advance(SSE_RETRY_INTERVAL_MS);
      latestSource().triggerError();
    }

    expect(refreshSingleFlight).toHaveBeenCalledTimes(1);
    stop();
  });
});

describe('useProcessingScreen — QA-03e (SCR-12)', () => {
  let clock: FakeClock;

  beforeEach(() => {
    clock = installFakeClock();
  });

  afterEach(() => {
    onlineManager.setOnline(true);
    clock.restore();
  });

  const UNAVAILABLE: HttpError = {
    code: 'SERVICE_UNAVAILABLE',
    kind: 'http',
    raw: { code: 'SERVICE_UNAVAILABLE' },
    requestId: 'r-503',
    retryable: true,
    status: 503,
  };

  it('hỏi lại N7 đến khi có ảnh xem trước, có ảnh thì thôi', async () => {
    const harness = makeScriptedClient();
    const [upload] = await readFloorUploads(harness.client, 1);
    const noImage = { floorId: upload!.floorId, floorName: upload!.floorName, uploadId: upload!.uploadId };
    harness.setLatest({ ok: true, data: [noImage] });
    mountHook(harness.client, undefined, createTestQueryClient(), new MockVisibilityTarget());
    await settle(clock);
    const firstCalls = harness.latestCalls();

    await act(async () => {
      await clock.advance(SCAN_POLL_MS);
    });
    expect(harness.latestCalls()).toBe(firstCalls + 1);

    harness.setLatest({ ok: true, data: [{ ...noImage, sourceImageUrl: '/trang.png' }] });
    await act(async () => {
      await clock.advance(SCAN_POLL_MS);
    });
    const callsWithImage = harness.latestCalls();
    expect(callsWithImage).toBe(firstCalls + 2);

    await act(async () => {
      await clock.advance(SCAN_POLL_MS * 3);
    });
    expect(harness.latestCalls()).toBe(callsWithImage);
  });

  it('BUG-543: lượt đã xong, không tầng nào chạy: chip của tầng đang hiện bước có aria-current', async () => {
    const harness = makeScriptedClient();
    const uploads = await readFloorUploads(harness.client, 2);
    uploads.forEach((upload) => harness.queue(upload.uploadId, finishedProgress(upload.uploadId)));
    const mounted = mountHook(harness.client, uploads, createTestQueryClient(), new MockVisibilityTarget());
    await settle(clock);

    expect(mounted.result.current.floors.map((floor) => floor.isActive)).toEqual([true, false]);
    mounted.unmount();
  });

  it('BUG-550: mọi lượt đọc #8 trả 503: alert lỗi đọc ở lại cả sau lượt hỏi, đọc được thì hết', async () => {
    const harness = makeScriptedClient();
    const uploads = await readFloorUploads(harness.client, 1);
    const upload = uploads[0]!;
    for (let attempt = 0; attempt < 4; attempt += 1) harness.queue(upload.uploadId, UNAVAILABLE);
    const mounted = mountHook(harness.client, uploads, createTestQueryClient(), new MockVisibilityTarget());
    await settle(clock);
    await act(async () => {
      await clock.advance(OTHER_FLOOR_POLL_INTERVAL_MS * 2);
    });
    await settle(clock);

    expect(harness.callsFor(upload.uploadId)).toBeGreaterThan(1);
    expect(mounted.result.current.state).toBe('error');
    expect(mounted.result.current.errorAlert?.technicalCode).toBe('SERVICE_UNAVAILABLE');

    // Chưa đọc được lượt nào thì tầng vẫn hỏi (không sang SSE, QA-03h); hết 503 thì lượt hỏi kế
    // đọc được, xoá lỗi đọc, và tầng đang xem mới sang SSE.
    expect(MockEventSource.instances).toHaveLength(0);
    harness.queue(upload.uploadId, progressAt(upload.uploadId, 1));
    await act(async () => {
      await clock.advance(OTHER_FLOOR_POLL_INTERVAL_MS * 2);
    });
    await settle(clock);
    expect(mounted.result.current.state).not.toBe('error');
    expect(mounted.result.current.errorAlert).toBeUndefined();
    expect(MockEventSource.instances.length).toBeGreaterThan(0);
    mounted.unmount();
  });

  it('BUG-550: #8 trả 503 SAU thang thử lại của lib/http: alert lỗi đọc vẫn hiện (QA-03h)', async () => {
    const harness = makeScriptedClient();
    const uploads = await readFloorUploads(harness.client, 1);
    // Như `lib/http`: 503 chỉ về sau thang 300+900+2700 ms; lượt bị huỷ giữa thang trả `aborted`.
    const client: ApiClient = {
      ...harness.client,
      drawings: {
        ...harness.client.drawings,
        progress: ({ signal }) =>
          new Promise((resolve) => {
            const timer = setTimeout(() => resolve({ ok: false, error: UNAVAILABLE }), 3_900);
            signal?.addEventListener('abort', () => {
              clearTimeout(timer);
              resolve({ ok: false, error: { kind: 'aborted', requestId: 'r', retryable: false, raw: null } });
            });
          }),
      },
    };
    const mounted = mountHook(client, uploads, createTestQueryClient(), new MockVisibilityTarget());
    await settle(clock);
    await act(async () => {
      await clock.advance(3_900 * 3);
    });
    await settle(clock);

    expect(mounted.result.current.state).toBe('error');
    expect(mounted.result.current.errorAlert?.technicalCode).toBe('SERVICE_UNAVAILABLE');
    mounted.unmount();
  });

  it('BUG-551: mở màn khi mất mạng: báo lỗi mạng thay vì khung xương; có mạng lại thì đọc tiếp', async () => {
    const harness = makeScriptedClient();
    const uploads = await readFloorUploads(harness.client, 1);
    onlineManager.setOnline(false);
    const mounted = mountHook(harness.client, uploads, createTestQueryClient(), new MockVisibilityTarget());
    await settle(clock);

    expect(mounted.result.current.state).toBe('error');
    expect(mounted.result.current.errorAlert?.technicalCode).toBe('NETWORK');

    await act(async () => {
      onlineManager.setOnline(true);
    });
    await settle(clock);
    expect(mounted.result.current.state).not.toBe('error');
    mounted.unmount();
  });

  it('BUG-553: tầng 1 xong, tầng 2 chỉ hỏng lượt đọc: không câu "gặp lỗi … vẫn đang được xử lý"', async () => {
    const harness = makeScriptedClient();
    const uploads = await readFloorUploads(harness.client, 2);
    const [done, unread] = [uploads[0]!, uploads[1]!];
    harness.queue(done.uploadId, finishedProgress(done.uploadId));
    harness.queue(unread.uploadId, progressAt(unread.uploadId, 1));
    const mounted = mountHook(harness.client, uploads, createTestQueryClient(), new MockVisibilityTarget());
    await settle(clock);

    await act(async () => {
      latestSource().triggerOpen();
    });
    harness.queue(unread.uploadId, UNAVAILABLE);
    await act(async () => {
      await clock.advance(SSE_SILENCE_PROBE_MS);
    });
    await act(() => clock.advance(1));
    await settle(clock);

    expect(mounted.result.current.floors[1]?.status).toBe('failed');
    expect(mounted.result.current.partialNoticeLine).toBeUndefined();
    mounted.unmount();
  });

  it('BUG-553: tầng hỏng khi các tầng khác đã xong: câu không nói "vẫn đang được xử lý"', async () => {
    const harness = makeScriptedClient();
    const uploads = await readFloorUploads(harness.client, 2);
    const [done, failing] = [uploads[0]!, uploads[1]!];
    harness.queue(done.uploadId, finishedProgress(done.uploadId));
    harness.queue(failing.uploadId, progressAt(failing.uploadId, 1, { status: 'failed', error: 'FILE_CORRUPT' }));
    const mounted = mountHook(harness.client, uploads, createTestQueryClient(), new MockVisibilityTarget());
    await settle(clock);

    expect(mounted.result.current.partialNoticeLine).toBe(`${failing.floorName} gặp lỗi.`);
    mounted.unmount();
  });

  it('BUG-549/545: lượt hỏng không mã: S-11 nhận mã PROCESSING và dải tầng của màn', async () => {
    const harness = makeScriptedClient();
    const uploads = await readFloorUploads(harness.client, 2);
    const [done, failing] = [uploads[0]!, uploads[1]!];
    harness.queue(done.uploadId, finishedProgress(done.uploadId));
    harness.queue(failing.uploadId, progressAt(failing.uploadId, 1, { status: 'failed' }));
    const mounted = mountHook(harness.client, uploads, createTestQueryClient(), new MockVisibilityTarget());
    await settle(clock);

    const failed = mounted.result.current.failedPipelineStep;
    expect(failed?.failureCode).toBe('PROCESSING');
    expect(failed?.failureFloors).toEqual([
      { floorId: done.floorId, floorName: done.floorName, status: 'done' },
      { floorId: failing.floorId, floorName: failing.floorName, status: 'failed' },
    ]);
    mounted.unmount();
  });

  it('BUG-549: ProgressSchema nhận error "" (BE gửi khi error_code rỗng) và bỏ trường đó', () => {
    const parsed = ProgressSchema.safeParse({ error: '', id: 'u-1', progressPercent: 40, status: 'failed', step: 'preprocess' });

    expect(parsed.success).toBe(true);
    expect(parsed.success && 'error' in parsed.data).toBe(false);
  });
});

describe('summaryScaleStateOf — nhãn tỷ lệ cùng tầng với số đếm (L-K3-1)', () => {
  const BASE: ProcessingExtractionSummary = {
    wallCount: 0,
    openingCount: 0,
    furnitureCount: 0,
    dimensionCount: 0,
    roomCount: 0,
    roomOutlinesMm: [],
    confidenceThreshold: null,
    lowConfidenceCount: 0,
  };
  const DETERMINED = {
    ...BASE,
    scaleStateLabel: 'Tỷ lệ đọc từ bản vẽ',
    scaleStateNote: 'Đọc từ chuỗi kích thước trên bản vẽ.',
  };
  const ESTIMATED = {
    ...BASE,
    scaleStateLabel: 'Tỷ lệ ước lượng',
    scaleStateNote:
      'Tỷ lệ ước lượng: Ước từ bề rộng cửa đi (giả định 745 mm). Hiệu chỉnh bằng một kích thước đã biết để số đo hết dấu ≈.',
    scaleStateNeedsAttention: true as const,
  };
  const UNRESOLVED = {
    ...BASE,
    scaleStateLabel: 'Tỷ lệ chưa xác định',
    scaleStateNote: 'Tỷ lệ chưa xác định: Ảnh giãn không đều theo hai chiều.',
    scaleStateNeedsAttention: true as const,
  };
  const floor = (floorName: string, extraction: ProcessingExtractionSummary): SummaryScaleFloor => ({
    floorName,
    extraction,
  });

  it('2 tầng: tầng đang xem đọc từ bản vẽ, tầng kia ước lượng → nhãn của tầng đang xem, dòng riêng mang tên tầng kia', () => {
    const result = summaryScaleStateOf(floor('Tầng 1', DETERMINED), [floor('Tầng 2', ESTIMATED)]);

    expect(result.scaleStateLabel).toBe('Tỷ lệ đọc từ bản vẽ');
    expect(result.scaleStateNote).toBe(
      'Đọc từ chuỗi kích thước trên bản vẽ. Tầng 2: Tỷ lệ ước lượng — Ước từ bề rộng cửa đi (giả định 745 mm). Hiệu chỉnh bằng một kích thước đã biết để số đo hết dấu ≈.',
    );
  });

  it('2 tầng: tầng đang xem ước lượng → nhãn và câu của chính nó, không lặp', () => {
    const result = summaryScaleStateOf(floor('Tầng 1', ESTIMATED), [floor('Tầng 2', DETERMINED)]);

    expect(result).toEqual({ scaleStateLabel: 'Tỷ lệ ước lượng', scaleStateNote: ESTIMATED.scaleStateNote });
  });

  it('1 tầng ước lượng (thẻ hiện tổng) → như cũ', () => {
    expect(summaryScaleStateOf(null, [floor('Tầng 1', ESTIMATED)])).toEqual({
      scaleStateLabel: 'Tỷ lệ ước lượng',
      scaleStateNote: ESTIMATED.scaleStateNote,
    });
  });

  it('3 tầng, 2 tầng khác cần chú ý → cả hai tên tầng', () => {
    const result = summaryScaleStateOf(floor('Tầng 1', DETERMINED), [
      floor('Tầng 2', ESTIMATED),
      floor('Tầng 3', UNRESOLVED),
    ]);

    expect(result.scaleStateLabel).toBe('Tỷ lệ đọc từ bản vẽ');
    expect(result.scaleStateNote).toContain('Tầng 2: Tỷ lệ ước lượng — Ước từ bề rộng cửa đi');
    expect(result.scaleStateNote).toContain('Tầng 3: Tỷ lệ chưa xác định — Ảnh giãn không đều theo hai chiều.');
  });

  it('quá 3 tầng khác cần chú ý → kể 3 tên, còn lại "+N tầng"', () => {
    const others = ['Tầng 2', 'Tầng 3', 'Tầng 4', 'Tầng 5', 'Tầng 6'].map((name) => floor(name, ESTIMATED));
    const note = summaryScaleStateOf(floor('Tầng 1', DETERMINED), others).scaleStateNote ?? '';

    expect(note).toContain('Tầng 4: ');
    expect(note).not.toContain('Tầng 5: ');
    expect(note).toMatch(/\+2 tầng khác cũng cần hiệu chỉnh tỷ lệ\.$/u);
  });
});
