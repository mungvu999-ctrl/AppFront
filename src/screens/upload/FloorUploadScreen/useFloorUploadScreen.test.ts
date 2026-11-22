/**
 * Nửa "suy nghĩ" của màn tải bản vẽ, kiểm không cần DOM của màn.
 *
 * Hook được lái qua `renderHook`, và tầng dữ liệu là `createMockApiClient()` của
 * `src/api/__mocks__/client.ts` — cùng phép ánh xạ bản sản phẩm dùng, nên test
 * không dựng một ý niệm thứ hai về hình dạng câu trả lời (R-70). Chỗ duy nhất
 * được thay là lượt tải thật: `createUpload` bị đổi bằng một task giả để test
 * bấm được từng nhịp tiến độ, thay vì chờ mạng.
 *
 * Bốn tệp mẫu bám vào bốn tầng thật của `MOCK_SPATIAL_PROJECT`: `Tầng hầm`
 * (`L-1`), `Tầng 1` (`L1`), `Tầng 2` (`L2`), `Tầng 3` (`L3`).
 */

import { createElement, type ReactNode } from 'react';
import { QueryClientProvider } from '@tanstack/react-query';
import { act, cleanup, renderHook, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { createMockApiClient } from '@/api/__mocks__/client';
import type { ApiResult, Progress } from '@/api/client';
import { ApiErrorBodySchema } from '@/api/schemas/errors';
import { PROJECT_NOT_FOUND_DESCRIPTION } from '@/components/feedback/ProjectSpatialGate';
import { ProgressSchema } from '@/api/schemas';
import type {
  NetworkMonitor,
  NetworkMonitorStatus,
  NetworkStatusListener,
} from '@/lib/offline/networkMonitor';
import { staggerDelayMs } from '@/lib/motion/stagger';
import { durationMs } from '@/lib/motion/tokens';
import { addPendingCommand, deletePendingCommand, listPendingCommands } from '@/lib/offline/queueStore';
import { getAppAnnouncer } from '@/lib/input/announcer';
import { createTestQueryClient } from '@/lib/testing/render';
import type { HttpError } from '@/lib/http';
import {
  hashBlobSha256Hex,
  MAX_UPLOAD_FILE_SIZE_BYTES,
  type UploadFailure,
  type UploadTask,
  type UploadTaskState,
} from '@/lib/upload';
import { formatFileSize } from '@/lib/format/bytes';
import { createUploadTask } from '@/lib/upload/uploadTask';
import type { UploadCandidate } from '@/lib/upload/validate';
import { ROUTES } from '@/routes/paths';

import {
  createFloorUploadGateway,
  type CreateFloorUploadGatewayOptions,
  type FloorUploadGateway,
} from './floorUploadGateway';
import { firstPageNote, SPLIT_COPY } from './useApartmentSplit';
import {
  useFloorUploadScreen,
  type FloorUploadToast,
  type UseFloorUploadScreenOptions,
} from './useFloorUploadScreen';

const PROJECT_ID = 'project-1';

/* -------------------------------------------------------------------------- */
/* jsdom không có `matchMedia`; `matches: false` là cách xếp rộng. Đặt lại      */
/* trước MỖI test vì `vi.restoreAllMocks()` ở dưới gỡ cả bản cài này.           */
/* -------------------------------------------------------------------------- */

beforeEach(() => {
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

/** Bộ theo dõi mạng giả: không ping thật, và test bật/tắt được từng nhịp. */
function createFakeNetworkMonitor(online = true): {
  readonly monitor: NetworkMonitor;
  readonly setOnline: (next: boolean) => void;
} {
  let isOnline = online;
  const listeners = new Set<NetworkStatusListener>();
  const statusOf = (): NetworkMonitorStatus => ({
    browserOnline: isOnline,
    checkedAt: 0,
    online: isOnline,
    pingOnline: isOnline,
  });

  return {
    monitor: {
      checkNow: async () => statusOf(),
      getStatus: statusOf,
      start: () => undefined,
      stop: () => undefined,
      subscribe: (listener) => {
        listeners.add(listener);
        return () => {
          listeners.delete(listener);
        };
      },
    },
    setOnline: (next: boolean) => {
      isOnline = next;
      for (const listener of listeners) {
        listener(statusOf());
      }
    },
  };
}

/** Một lượt tải giả: test giữ `emit` và bấm từng nhịp tiến độ bằng tay. */
interface FakeUpload {
  readonly task: UploadTask;
  readonly emit: (state: Partial<UploadTaskState>) => void;
  readonly finish: (state: Partial<UploadTaskState>) => void;
  readonly cancelled: () => boolean;
}

function createFakeUploads() {
  const uploads = new Map<string, FakeUpload>();

  const createUpload: FloorUploadGateway['createUpload'] = ({ file, id, onProgress }) => {
    const uploadId = id ?? file.name;
    let resolveStart: ((state: UploadTaskState) => void) | null = null;
    let isCancelled = false;

    const baseState = (patch: Partial<UploadTaskState>): UploadTaskState => ({
      id: uploadId,
      fileName: file.name,
      sizeBytes: file.size,
      status: 'uploading',
      percent: 0,
      chunkCount: 1,
      chunksSent: 0,
      uploadId: 'upload-1',
      progress: null,
      failure: null,
      ...patch,
    });

    const task: UploadTask = {
      id: uploadId,
      getState: () => baseState({}),
      start: () =>
        new Promise<UploadTaskState>((resolve) => {
          resolveStart = resolve;
        }),
      cancel: () => {
        isCancelled = true;
      },
    };

    uploads.set(uploadId, {
      task,
      emit: (patch) => onProgress(baseState(patch)),
      finish: (patch) => {
        const state = baseState(patch);
        onProgress(state);
        resolveStart?.(state);
      },
      cancelled: () => isCancelled,
    });

    return task;
  };

  return { uploads, createUpload };
}

interface Harness {
  readonly gateway: FloorUploadGateway;
  readonly uploads: Map<string, FakeUpload>;
  readonly toasts: FloorUploadToast[];
  readonly navigations: string[];
  readonly setOnline: (next: boolean) => void;
}

function createHarness(
  overrides: Partial<FloorUploadGateway> = {},
  online = true,
  gatewayOptions: Omit<CreateFloorUploadGatewayOptions, 'networkMonitor'> = {},
): Harness & { readonly options: UseFloorUploadScreenOptions } {
  const network = createFakeNetworkMonitor(online);
  const { createUpload, uploads } = createFakeUploads();
  const real = createFloorUploadGateway(createMockApiClient(), {
    ...gatewayOptions,
    networkMonitor: network.monitor,
  });
  const gateway: FloorUploadGateway = { ...real, createUpload, ...overrides };
  const toasts: FloorUploadToast[] = [];
  const navigations: string[] = [];

  return {
    gateway,
    uploads,
    toasts,
    navigations,
    setOnline: network.setOnline,
    options: {
      gateway,
      projectId: PROJECT_ID,
      onToast: (toast) => toasts.push(toast),
      onNavigate: (path) => navigations.push(path),
    },
  };
}

/** Bộ mẫu bỏ hết bản vẽ máy chủ: chưa tầng nào có bản vẽ, nên tầng trống vẫn chặn (U03). */
function withoutServerDrawings(): Partial<FloorUploadGateway> {
  const real = createFloorUploadGateway(createMockApiClient());

  return {
    readFloors: async (input) => {
      const read = await real.readFloors(input);
      return read.ok ? { ok: true, data: read.data.map((floor) => ({ ...floor, drawings: [] })) } : read;
    },
  };
}

interface QueuedUpload {
  readonly kind?: string;
  readonly label?: string;
  readonly fileName?: string;
  readonly floorId?: string;
  readonly pageIndex?: number;
}

/** Lệnh của dự án trong hàng đợi ngoại tuyến — đúng nguồn ConnectionStates đếm "chờ đồng bộ". */
async function queuedCommands(projectId = PROJECT_ID): Promise<QueuedUpload[]> {
  const listed = await listPendingCommands(projectId);

  return listed.ok ? listed.data.map((pending) => pending.command as QueuedUpload) : [];
}

/**
 * Chờ hàng đợi IndexedDB tới trạng thái mong đợi. Vẫn là chờ ĐIỀU KIỆN (về ngay khi đúng), nhưng
 * IndexedDB giả chạy trên hẹn giờ THẬT nên đồng hồ giả không đẩy được nó; trần 1 s mặc định của
 * `waitFor` hụt khi máy tải nặng (verify QA-01c, NO-392 (b)) — nới trần, dưới 5 000 ms của bài.
 */
const QUEUE_WAIT = { timeout: 4000 };
// Một bài có thể chờ hàng đợi 2 lần + một waitFor mặc định (≤ 9 s) — trần bài phải trên tổng đó.
vi.setConfig({ testTimeout: 15_000 });
const waitForQueue = (check: () => Promise<void>): Promise<void> => waitFor(check, QUEUE_WAIT);

/** Chỉ lệnh `uploadDrawing` của dự án. */
async function queuedUploads(projectId = PROJECT_ID): Promise<QueuedUpload[]> {
  return (await queuedCommands(projectId)).filter((command) => command.kind === 'uploadDrawing');
}

/** Chờ hàng đợi có đúng những tệp này (theo tên), thứ tự không quan trọng. */
async function expectQueuedFiles(names: readonly string[]): Promise<void> {
  await waitForQueue(async () => {
    expect((await queuedUploads()).map((command) => command.fileName).sort()).toEqual([...names].sort());
  });
}

function renderScreen(options: UseFloorUploadScreenOptions) {
  const client = createTestQueryClient();

  // Câu hỏi K19 tắt mặc định: các bài dưới đây kiểm đường gán tầng; bài K19 tự bật lại.
  return renderHook(() => useFloorUploadScreen({ askHowToSplit: false, ...options }), {
    wrapper: ({ children }: { children: ReactNode }) =>
      createElement(QueryClientProvider, { client }, children),
  });
}

function makeFile(name: string, sizeBytes = 16, type = 'image/png'): File {
  return new File(['x'.repeat(sizeBytes)], name, { type });
}

/* -------------------------------------------------------------------------- */
/* Đọc danh sách tầng.                                                         */
/* -------------------------------------------------------------------------- */

describe('useFloorUploadScreen — danh sách tầng', () => {
  it('đi từ "đang tải" sang danh sách bốn tầng, không tự viết cờ đang tải (R-64)', async () => {
    const harness = createHarness();
    const { result } = renderScreen(harness.options);

    expect(result.current.state).toBe('loading');

    await waitFor(() => {
      expect(result.current.floors).toHaveLength(4);
    });

    expect(result.current.floors.map((row) => row.name)).toEqual([
      'Tầng hầm',
      'Tầng 1',
      'Tầng 2',
      'Tầng 3',
    ]);
    expect(result.current.footer.totalCount).toBe(4);
  });

  it('định dạng cao độ và chiều cao bằng dấu phẩy, và lấy trần qua ceilingElevationMm (M-11)', async () => {
    const harness = createHarness();
    const { result } = renderScreen(harness.options);

    await waitFor(() => {
      expect(result.current.floors).toHaveLength(4);
    });

    const ground = result.current.floors[1];
    const second = result.current.floors[2];

    // Tầng 1: cao độ 0 mm, chiều cao 3 900 mm ⇒ trần 3,90 m — chính là cao độ
    // sàn của Tầng 2. Đây là phép kiểm rằng trần đến từ `ceilingElevationMm`
    // chứ không từ một phép cộng viết trong màn.
    expect(ground?.elevationLabel).toBe('0,00 m');
    expect(ground?.storeyHeightLabel).toBe('3,90 m');
    expect(ground?.ceilingElevationLabel).toBe('3,90 m');
    expect(second?.elevationLabel).toBe('3,90 m');
  });

  it('lỗi đọc danh sách tầng thành trạng thái "lỗi" của cả màn, có câu tiếng Việt', async () => {
    const harness = createHarness({
      readFloors: async () => ({
        ok: false,
        error: { kind: 'network', requestId: 'r-1', retryable: true, raw: null },
      }),
    });
    const { result } = renderScreen(harness.options);

    await waitFor(() => {
      expect(result.current.state).toBe('error');
    });

    expect(result.current.errorMessage).not.toBeNull();
    expect(result.current.errorMessage).toContain('máy chủ');
  });

  // BUG-263: thẻ của tầng không tệp, không bản vẽ máy chủ nói đúng như hộp chặn và Quản lý tầng.
  it('tầng chưa có bản vẽ ghi "Chưa có bản vẽ", không phải "Chờ xử lý" (BUG-263)', async () => {
    const harness = createHarness();
    const { result } = renderScreen(harness.options);

    await waitFor(() => {
      expect(result.current.floors).toHaveLength(4);
    });

    const bare = result.current.floors.filter((row) => row.file === null);

    expect(bare.length).toBeGreaterThan(0);
    for (const row of bare) {
      expect(row.status).toBe('waiting');
      expect(row.statusLabel).toBe('Chưa có bản vẽ');
      expect(row.statusLabelKey).toBe('floorUpload.status.noDrawing');
    }
  });

  it('mở thẳng đường dẫn, bộ đệm chưa có tên: đọc #24 một lần để breadcrumb nêu tên dự án (BUG-165)', async () => {
    const harness = createHarness();
    const readProject = vi.fn(harness.gateway.readProject);
    const { result } = renderScreen({ ...harness.options, gateway: { ...harness.gateway, readProject } });

    await waitFor(() => {
      expect(result.current.projectName).toEqual(expect.any(String));
    });

    expect(readProject).toHaveBeenCalledTimes(1);
  });

  it('khổ hẹp: lỗi đọc danh sách tầng vẫn thắng thu gọn (BUG-072)', async () => {
    const harness = createHarness({
      readFloors: async () => ({
        ok: false,
        error: { kind: 'http', status: 404, code: 'PROJECT_NOT_FOUND', requestId: 'r-404', retryable: false, raw: {} },
      }),
    });
    const { result } = renderScreen({ ...harness.options, forceCollapsed: true });

    await waitFor(() => {
      expect(result.current.state).toBe('error');
    });

    expect(result.current.errorMessage).not.toBeNull();
    expect(result.current.isCollapsed).toBe(true);
  });

  it('dự án không tồn tại: "không tìm thấy dự án", không thả tệp, không "Thử lại" vô ích (BUG-311)', async () => {
    const harness = createHarness({
      readFloors: async () => ({
        ok: false,
        error: { kind: 'http', status: 404, code: 'NOT_FOUND', requestId: 'r-404', retryable: false, raw: {} },
      }),
    });
    const { result } = renderScreen(harness.options);

    await waitFor(() => {
      expect(result.current.state).toBe('error');
    });

    expect(result.current.isProjectMissing).toBe(true);
    expect(result.current.errorMessage).toBe(PROJECT_NOT_FOUND_DESCRIPTION);
    expect(result.current.canRetryLoad).toBe(false);
    expect(result.current.dropZone.isEnabled).toBe(false);

    act(() => {
      result.current.onBackToProjects?.();
    });

    expect(harness.navigations).toEqual([ROUTES.dashboard]);
  });

  it('lỗi mạng khi đọc tầng: "Thử lại" đọc lại danh sách (BUG-311)', async () => {
    let calls = 0;
    const harness = createHarness();
    const readFloors: FloorUploadGateway['readFloors'] = async (input) => {
      calls += 1;
      return calls === 1
        ? { ok: false, error: { kind: 'network', requestId: 'r-1', retryable: true, raw: null } }
        : harness.gateway.readFloors(input);
    };
    const { result } = renderScreen({ ...harness.options, gateway: { ...harness.gateway, readFloors } });

    await waitFor(() => {
      expect(result.current.state).toBe('error');
    });

    expect(result.current.isProjectMissing).toBe(false);
    expect(result.current.canRetryLoad).toBe(true);

    act(() => {
      result.current.onRetryLoad();
    });

    await waitFor(() => {
      expect(result.current.floors).toHaveLength(4);
    });
  });
});

/* -------------------------------------------------------------------------- */
/* Nhận tệp và ghép tầng.                                                      */
/* -------------------------------------------------------------------------- */

describe('useFloorUploadScreen — nhận tệp', () => {
  it('tệp hơn trần một byte: "vượt trần" nêu hai số khác nhau (BUG-302)', async () => {
    const harness = createHarness({
      validateFile: async () => ({
        ok: false,
        reason: { kind: 'tooLarge', sizeBytes: MAX_UPLOAD_FILE_SIZE_BYTES + 1, maxSizeBytes: MAX_UPLOAD_FILE_SIZE_BYTES },
      }),
    });
    const { result } = renderScreen(harness.options);

    await waitFor(() => {
      expect(result.current.floors).toHaveLength(4);
    });

    act(() => {
      result.current.onFilesDropped([makeFile('qua-nang.png')]);
    });

    await waitFor(() => {
      expect(result.current.tray.items[0]?.error?.kind).toBe('tooLarge');
    });

    const sentence = result.current.tray.items[0]?.error?.sentence ?? '';
    const [, size, cap] = /^Tệp nặng (.+), vượt trần (.+) của một tệp\./u.exec(sentence) ?? [];

    expect(cap).toBe(formatFileSize(MAX_UPLOAD_FILE_SIZE_BYTES));
    expect(size).toBeDefined();
    expect(size).not.toBe(cap);
  });

  it('tệp hơn trần một byte: dòng tệp trong khay ghi cùng số với câu lỗi (BUG-302)', async () => {
    const harness = createHarness({
      validateFile: async () => ({
        ok: false,
        reason: { kind: 'tooLarge', sizeBytes: MAX_UPLOAD_FILE_SIZE_BYTES + 1, maxSizeBytes: MAX_UPLOAD_FILE_SIZE_BYTES },
      }),
    });
    const { result } = renderScreen(harness.options);
    const file = makeFile('qua-nang.png');

    Object.defineProperty(file, 'size', { value: MAX_UPLOAD_FILE_SIZE_BYTES + 1 });

    await waitFor(() => {
      expect(result.current.floors).toHaveLength(4);
    });

    act(() => {
      result.current.onFilesDropped([file]);
    });

    await waitFor(() => {
      expect(result.current.tray.items[0]?.error?.kind).toBe('tooLarge');
    });

    const item = result.current.tray.items[0];
    const [, size] = /^Tệp nặng (.+), vượt trần/u.exec(item?.error?.sentence ?? '') ?? [];

    expect(item?.sizeLabel).toBe(size);
    expect(item?.summaryLine).toBe(`qua-nang.png · ${size ?? ''}`);
  });

  it('ghép tệp vào đúng tầng theo tên tệp và đánh dấu là ghép tự động', async () => {
    const harness = createHarness();
    const { result } = renderScreen(harness.options);

    await waitFor(() => {
      expect(result.current.floors).toHaveLength(4);
    });

    act(() => {
      result.current.onFilesDropped([makeFile('mat-bang-tang-2.png')]);
    });

    await waitFor(() => {
      expect(result.current.floors[2]?.file).not.toBeNull();
    });

    const row = result.current.floors[2];

    expect(row?.name).toBe('Tầng 2');
    expect(row?.isAutoMatched).toBe(true);
    expect(row?.autoMatchHint).toContain('kiểm tra lại');
    expect(row?.status).toBe('uploading');
    expect(result.current.tray.items).toHaveLength(0);
  });

  it('nhiều tệp không đoán được tầng rơi vào khay chưa gán, không phải một lỗi', async () => {
    const harness = createHarness();
    const { result } = renderScreen(harness.options);

    await waitFor(() => {
      expect(result.current.floors).toHaveLength(4);
    });

    act(() => {
      result.current.onFilesDropped([makeFile('A-101-trang-3.png'), makeFile('A-102.png')]);
    });

    // Ô gán tầng chỉ mở sau lượt kiểm tệp — tệp chưa kiểm (hay bị từ chối) không gán được (BUG-523).
    await waitFor(() => {
      expect(result.current.tray.items[0]?.assignOptions).toHaveLength(4);
    });

    expect(result.current.tray.items).toHaveLength(2);
    expect(result.current.tray.items[0]?.error).toBeNull();
    expect(result.current.state).not.toBe('error');
  });

  it('tệp bị từ chối giữ lỗi trong đúng thẻ của nó, không chặn cả trang', async () => {
    const harness = createHarness();
    const { result } = renderScreen(harness.options);

    await waitFor(() => {
      expect(result.current.floors).toHaveLength(4);
    });

    act(() => {
      result.current.onFilesDropped([
        makeFile('mat-bang-tang-2.png'),
        makeFile('ban-ve.xyz', 16, 'application/octet-stream'),
      ]);
    });

    await waitFor(() => {
      expect(result.current.tray.items).toHaveLength(1);
    });

    const rejected = result.current.tray.items[0];

    expect(rejected?.error?.kind).toBe('unsupportedFormat');
    expect(rejected?.error?.isRetryable).toBe(false);
    expect(rejected?.error?.sentence).toContain('Định dạng');
    // Lỗi của một tệp không leo lên trạng thái màn, và không chạm hàng khác.
    expect(result.current.state).not.toBe('error');
    expect(result.current.errorMessage).toBeNull();
    expect(result.current.floors[2]?.error).toBeNull();
  });

  it('đóng lỗi của một tệp không chạm tệp khác', async () => {
    const harness = createHarness();
    const { result } = renderScreen(harness.options);

    await waitFor(() => {
      expect(result.current.floors).toHaveLength(4);
    });

    act(() => {
      result.current.onFilesDropped([makeFile('a.xyz'), makeFile('b.xyz')]);
    });

    await waitFor(() => {
      expect(result.current.tray.items).toHaveLength(2);
    });

    const firstId = result.current.tray.items[0]?.id ?? '';

    act(() => {
      result.current.onDismissError(firstId);
    });

    // Tệp bị từ chối lúc kiểm không bao giờ gán được: đóng lỗi là bỏ tệp khỏi khay (U55).
    expect(result.current.tray.items).toHaveLength(1);
    expect(result.current.tray.items[0]?.id).not.toBe(firstId);
    expect(result.current.tray.items[0]?.error).not.toBeNull();
  });
});

/* -------------------------------------------------------------------------- */
/* Tiến độ, huỷ, thử lại.                                                      */
/* -------------------------------------------------------------------------- */

describe('useFloorUploadScreen — một lượt tải', () => {
  it('truyền thẳng phần trăm của uploadTask, không bóp tần suất lần thứ hai', async () => {
    const harness = createHarness();
    const { result } = renderScreen(harness.options);

    await waitFor(() => {
      expect(result.current.floors).toHaveLength(4);
    });

    act(() => {
      result.current.onFilesDropped([makeFile('mat-bang-tang-3.png')]);
    });

    await waitFor(() => {
      expect(harness.uploads.size).toBe(1);
    });

    const upload = [...harness.uploads.values()][0];

    act(() => {
      upload?.emit({ percent: 45, status: 'uploading' });
    });

    expect(result.current.floors[3]?.percent).toBe(45);
    expect(result.current.floors[3]?.percentLabel).toBe('45%');

    act(() => {
      upload?.finish({ percent: 100, status: 'done' });
    });

    await waitFor(() => {
      expect(result.current.floors[3]?.status).toBe('attached');
    });

    expect(result.current.floors[3]?.percent).toBe(100);
  });

  it('lượt tải hỏng cho câu tiếng Việt trong thẻ và mở nút thử lại', async () => {
    const harness = createHarness();
    const { result } = renderScreen(harness.options);

    await waitFor(() => {
      expect(result.current.floors).toHaveLength(4);
    });

    act(() => {
      result.current.onFilesDropped([makeFile('mat-bang-tang-3.png')]);
    });

    await waitFor(() => {
      expect(harness.uploads.size).toBe(1);
    });

    const upload = [...harness.uploads.values()][0];

    act(() => {
      upload?.finish({
        percent: 30,
        status: 'failed',
        failure: {
          stage: 'chunk',
          chunkIndex: 1,
          attempts: 3,
          terminal: false,
          error: {
            kind: 'upload',
            code: 'UPLOAD',
            messageKey: 'errors.upload.description',
            params: {},
            requestId: 'r-1',
            retryable: true,
            severity: 'lỗi',
            recovery: 'thử lại',
          },
        },
      });
    });

    await waitFor(() => {
      expect(result.current.floors[3]?.status).toBe('error');
    });

    const row = result.current.floors[3];

    expect(row?.error?.kind).toBe('transfer');
    expect(row?.error?.sentence).toContain('Tệp tải lên chưa xong');
    expect(row?.canRetryUpload).toBe(true);
    // Vẫn không phải trạng thái lỗi của cả màn.
    expect(result.current.state).not.toBe('error');
  });

  it('tệp .dwg bị từ chối: thẻ lỗi không còn chip CAD độ chính xác cao (BUG-304)', async () => {
    const harness = createHarness({
      validateFile: async () => ({ ok: true, branch: 'cad', extension: '.dwg', sizeBytes: 16 }),
    });
    const { result } = renderScreen(harness.options);

    await waitFor(() => {
      expect(result.current.floors).toHaveLength(4);
    });

    act(() => {
      result.current.onFilesDropped([makeFile('mat-bang-tang-3.dwg')]);
    });

    await waitFor(() => {
      expect(result.current.floors[3]?.file?.isCadBranch).toBe(true);
    });

    act(() => {
      [...harness.uploads.values()][0]?.finish({
        percent: 0,
        status: 'failed',
        failure: {
          stage: 'init',
          chunkIndex: null,
          attempts: 1,
          terminal: true,
          error: {
            kind: 'validation',
            code: 'CAD_NOT_SUPPORTED',
            messageKey: 'errors.validation.description',
            params: {},
            requestId: 'r-422',
            retryable: false,
            severity: 'lỗi',
            recovery: 'không',
          },
        },
      });
    });

    await waitFor(() => {
      expect(result.current.floors[3]?.status).toBe('error');
    });

    expect(result.current.floors[3]?.file?.isCadBranch).toBe(false);
  });

  it('huỷ gọi đúng task của tệp đó', async () => {
    const harness = createHarness();
    const { result } = renderScreen(harness.options);

    await waitFor(() => {
      expect(result.current.floors).toHaveLength(4);
    });

    act(() => {
      result.current.onFilesDropped([makeFile('mat-bang-tang-3.png')]);
    });

    await waitFor(() => {
      expect(harness.uploads.size).toBe(1);
    });

    const fileId = result.current.floors[3]?.file?.id ?? '';

    act(() => {
      result.current.onCancelUpload(fileId);
    });

    expect([...harness.uploads.values()][0]?.cancelled()).toBe(true);
  });

  it('mất mạng thì không gọi mạng; tệp chờ mạng có đúng một lệnh trong hàng đợi (NO-392)', async () => {
    const harness = createHarness({}, false);
    const { result } = renderScreen(harness.options);

    await waitFor(() => {
      expect(result.current.floors).toHaveLength(4);
    });

    expect(result.current.isOffline).toBe(true);
    expect(result.current.offlineNotice).toContain('ngoại tuyến');

    act(() => {
      result.current.onFilesDropped([makeFile('mat-bang-tang-3.png')]);
    });

    await waitFor(() => {
      expect(result.current.floors[3]?.status).toBe('waiting');
    });

    expect(harness.uploads.size).toBe(0);
    await expectQueuedFiles(['mat-bang-tang-3.png']);
    // Dòng "chờ đồng bộ" của ConnectionStates đọc `label` của lệnh.
    expect((await queuedUploads())[0]).toMatchObject({ label: 'Tải bản vẽ mat-bang-tang-3.png khi có mạng' });
  });

  it('tệp chọn lúc ngoại tuyến tự tải khi mạng về, trong phiên đang mở (NO-389)', async () => {
    const harness = createHarness({}, false);
    const { result } = renderScreen(harness.options);

    await waitFor(() => {
      expect(result.current.floors).toHaveLength(4);
    });

    act(() => {
      result.current.onFilesDropped([makeFile('mat-bang-tang-3.png')]);
    });

    await waitFor(() => {
      expect(result.current.floors[3]?.status).toBe('waiting');
    });
    expect(harness.uploads.size).toBe(0);
    await waitFor(() => {
      expect(result.current.offlineNotice).toContain('tự tải lên khi có mạng trở lại');
    });
    expect(result.current.offlineNotice).toContain('cần chọn lại tệp');

    act(() => {
      harness.setOnline(true);
    });

    await waitFor(() => {
      expect(harness.uploads.size).toBe(1);
    });

    act(() => {
      [...harness.uploads.values()][0]?.finish({ percent: 100, status: 'done' });
    });

    await waitFor(() => {
      expect(result.current.floors[3]?.status).toBe('attached');
    });
  });

  it('"Thử lại" lúc ngoại tuyến không bỏ rơi tệp: mạng về thì tự tải lại (NO-389)', async () => {
    const created = vi.fn();
    const fake = createHarness();
    const harness = createHarness({
      createUpload: (input) => {
        created(input.file.name);
        return fake.gateway.createUpload(input);
      },
    });
    const { result } = renderScreen(harness.options);

    await waitFor(() => {
      expect(result.current.floors).toHaveLength(4);
    });

    act(() => {
      result.current.onFilesDropped([makeFile('mat-bang-tang-3.png')]);
    });

    await waitFor(() => {
      expect(fake.uploads.size).toBe(1);
    });

    act(() => {
      [...fake.uploads.values()][0]?.finish({
        status: 'failed',
        failure: {
          stage: 'chunk',
          chunkIndex: 0,
          attempts: 3,
          terminal: false,
          error: {
            kind: 'network',
            code: 'NETWORK',
            messageKey: 'errors.network.description',
            params: {},
            requestId: 'r-1',
            retryable: true,
            severity: 'lỗi',
            recovery: 'thử lại',
          },
        },
      });
    });

    await waitFor(() => {
      expect(result.current.floors[3]?.canRetryUpload).toBe(true);
    });

    act(() => {
      harness.setOnline(false);
    });

    const fileId = result.current.floors[3]?.file?.id ?? '';

    act(() => {
      result.current.onRetryUpload(fileId);
    });

    await waitFor(() => {
      expect(result.current.floors[3]?.status).toBe('waiting');
    });
    expect(created).toHaveBeenCalledTimes(1);

    act(() => {
      harness.setOnline(true);
    });

    await waitFor(() => {
      expect(created).toHaveBeenCalledTimes(2);
    });
    expect(result.current.floors[3]?.status).toBe('uploading');
  });
});

describe('useFloorUploadScreen — lệnh "chờ đồng bộ" của tệp chờ mạng: một lệnh mỗi tệp, gỡ ở mọi lối ra (NO-392)', () => {
  // Hàng đợi là IndexedDB dùng chung cả tệp test: mỗi bài bắt đầu từ hàng đợi rỗng.
  beforeEach(async () => {
    for (const projectId of [PROJECT_ID, 'project-khac']) {
      const listed = await listPendingCommands(projectId);

      for (const pending of listed.ok ? listed.data : []) {
        await deletePendingCommand(pending.id);
      }
    }
  });

  const terminalFailure = {
    status: 'failed' as const,
    failure: {
      stage: 'chunk' as const,
      chunkIndex: 0,
      attempts: 3,
      terminal: true,
      error: {
        kind: 'upload' as const,
        code: 'UPLOAD',
        messageKey: 'errors.upload.description',
        params: {},
        requestId: 'r-459',
        retryable: false,
        severity: 'lỗi' as const,
        recovery: 'thử lại' as const,
      },
    },
  };

  async function offlineWithFiles(names: readonly string[]) {
    const harness = createHarness({}, false);
    const view = renderScreen(harness.options);

    await waitFor(() => {
      expect(view.result.current.floors).toHaveLength(4);
    });

    act(() => {
      view.result.current.onFilesDropped(names.map((name) => makeFile(name)));
    });

    await expectQueuedFiles(names);
    // Hàng đợi (IndexedDB) và lượt vẽ của hook là hai đường riêng: hàng đợi đủ chưa có nghĩa lượt
    // vẽ gắn tệp vào tầng đã tới. Máy tải nặng, `fileIdOn` đọc phải lượt vẽ cũ, ra '' và các thao
    // tác sau thành không làm gì (verify QA-01c, NO-392 (b)) — chờ cả điều kiện này.
    await waitFor(() => {
      const shown = view.result.current.floors.flatMap((floor) => (floor.file === null ? [] : [floor.file.name]));

      expect(shown).toEqual(expect.arrayContaining([...names]));
    });

    return { harness, ...view };
  }

  const fileIdOn = (
    result: { readonly current: { readonly floors: readonly { readonly file: { readonly id: string } | null }[] } },
    index: number,
  ): string => result.current.floors[index]?.file?.id ?? '';

  it('(a) mỗi tệp chờ mạng đúng một lệnh; "Thử lại" lúc ngoại tuyến không ghi thêm', async () => {
    const { harness, result } = await offlineWithFiles(['mat-bang-tang-3.png', 'mat-bang-tang-2.png']);

    act(() => {
      result.current.onRetryUpload(fileIdOn(result, 3));
    });
    act(() => {
      result.current.onRetryUpload(fileIdOn(result, 3));
    });

    await expectQueuedFiles(['mat-bang-tang-3.png', 'mat-bang-tang-2.png']);
    expect(harness.uploads.size).toBe(0);

    // Mạng về: cả hai tệp rời hàng chờ, nên hàng đợi về rỗng — và không còn lượt
    // ghi nào đang bay sang bài sau.
    act(() => {
      harness.setOnline(true);
    });
    await expectQueuedFiles([]);
  });

  it('(b) mạng về, tự tải xong → lệnh gỡ', async () => {
    const { harness } = await offlineWithFiles(['mat-bang-tang-3.png']);

    act(() => {
      harness.setOnline(true);
    });
    await waitFor(() => {
      expect(harness.uploads.size).toBe(1);
    });
    act(() => {
      [...harness.uploads.values()][0]?.finish({ percent: 100, status: 'done' });
    });

    await expectQueuedFiles([]);
  });

  it('(b) mạng về, tự tải hỏng không còn thử lại → lệnh gỡ', async () => {
    const { harness, result } = await offlineWithFiles(['mat-bang-tang-3.png']);

    act(() => {
      harness.setOnline(true);
    });
    await waitFor(() => {
      expect(harness.uploads.size).toBe(1);
    });
    act(() => {
      [...harness.uploads.values()][0]?.finish(terminalFailure);
    });

    await waitFor(() => {
      expect(result.current.floors[3]?.status).toBe('error');
    });
    await expectQueuedFiles([]);
  });

  it('(b) xoá tệp → lệnh gỡ; hoàn tác → lệnh trở lại đúng một', async () => {
    const { harness, result } = await offlineWithFiles(['mat-bang-tang-3.png']);

    act(() => {
      result.current.onRemoveFile(fileIdOn(result, 3));
    });
    await expectQueuedFiles([]);

    act(() => {
      harness.toasts[0]?.onUndo?.();
    });
    await expectQueuedFiles(['mat-bang-tang-3.png']);
  });

  it('RV5#20: gỡ tệp ảnh thì thu hồi ngay blob xem trước, không đợi rời màn', async () => {
    const created: string[] = [];
    const revoke = vi.fn();
    const original = { createObjectURL: URL.createObjectURL, revokeObjectURL: URL.revokeObjectURL };
    Object.assign(URL, {
      createObjectURL: () => {
        created.push(`blob:preview-${String(created.length)}`);
        return created[created.length - 1];
      },
      revokeObjectURL: revoke,
    });
    try {
      const { result } = await offlineWithFiles(['mat-bang-tang-3.png']);
      await waitFor(() => {
        expect(created.length).toBeGreaterThan(0);
      });

      act(() => {
        result.current.onRemoveFile(fileIdOn(result, 3));
      });

      await waitFor(() => {
        expect(revoke).toHaveBeenCalledWith(created[0]);
      });
    } finally {
      Object.assign(URL, original);
    }
  });

  it('(b) gán lại về khay → lệnh gỡ; gán sang tầng khác → một lệnh, đúng tầng mới', async () => {
    const { result } = await offlineWithFiles(['mat-bang-tang-3.png']);
    const fileId = fileIdOn(result, 3);

    act(() => {
      result.current.onReassign(fileId, null);
    });
    await expectQueuedFiles([]);

    act(() => {
      result.current.onReassign(fileId, 'L2');
    });
    await waitForQueue(async () => {
      expect((await queuedUploads()).map((command) => command.floorId)).toEqual(['L2']);
    });
  });

  it('(b) tệp bị đẩy về khay (một tầng một tệp) → lệnh của nó gỡ, chỉ còn lệnh của tệp mới', async () => {
    const { result } = await offlineWithFiles(['mat-bang-tang-3.png', 'mat-bang-tang-2.png']);

    act(() => {
      result.current.onReassign(fileIdOn(result, 2), 'L3');
    });

    await waitForQueue(async () => {
      expect(await queuedUploads()).toEqual([
        expect.objectContaining({ fileName: 'mat-bang-tang-2.png', floorId: 'L3' }),
      ]);
    });
  });

  it('(b) hoàn tác vào tầng đã có tệp khác → tệp về khay, không thêm lệnh', async () => {
    const { harness, result } = await offlineWithFiles(['mat-bang-tang-3.png', 'mat-bang-tang-2.png']);

    act(() => {
      result.current.onRemoveFile(fileIdOn(result, 3));
    });
    act(() => {
      result.current.onReassign(fileIdOn(result, 2), 'L3');
    });
    await waitForQueue(async () => {
      expect(await queuedUploads()).toEqual([
        expect.objectContaining({ fileName: 'mat-bang-tang-2.png', floorId: 'L3' }),
      ]);
    });

    act(() => {
      harness.toasts[0]?.onUndo?.();
    });

    await waitFor(() => {
      expect(result.current.tray.items.map((item) => item.name)).toEqual(['mat-bang-tang-3.png']);
    });
    await expectQueuedFiles(['mat-bang-tang-2.png']);
  });

  it('(b) rời màn khi tệp đang chờ mạng → lệnh gỡ (tệp mất theo màn)', async () => {
    const { unmount } = await offlineWithFiles(['mat-bang-tang-3.png']);

    unmount();

    await expectQueuedFiles([]);
  });

  it('(c) mở màn gỡ lệnh tải bản vẽ mồ côi của dự án; lệnh loại khác và dự án khác còn nguyên', async () => {
    await addPendingCommand({
      projectId: PROJECT_ID,
      command: { kind: 'uploadDrawing', fileName: 'phien-truoc.png', floorId: 'L2', projectId: PROJECT_ID, sizeBytes: 4 },
    });
    await addPendingCommand({ projectId: PROJECT_ID, command: { kind: 'renameRoom', roomId: 'R-1' } });
    await addPendingCommand({
      projectId: 'project-khac',
      command: { kind: 'uploadDrawing', fileName: 'du-an-khac.png', floorId: 'L2', projectId: 'project-khac', sizeBytes: 4 },
    });

    await expectQueuedFiles(['phien-truoc.png']);

    const harness = createHarness();
    const { result } = renderScreen(harness.options);

    await waitFor(() => {
      expect(result.current.floors).toHaveLength(4);
    });

    await expectQueuedFiles([]);
    expect((await queuedCommands()).map((command) => command.kind)).toContain('renameRoom');
    expect((await queuedUploads('project-khac')).map((command) => command.fileName)).toEqual(['du-an-khac.png']);
  });
});

/**
 * Web Locks giả, dùng chung giữa các "tab" như `navigator.locks` thật dùng chung
 * cả origin: giữ khoá là ghi tên vào `held`, khoá không bao giờ nhả.
 */
function createFakeLocks() {
  const held = new Set<string>();

  return {
    request: async (name: string, _options: unknown, callback: () => Promise<unknown>) => {
      held.add(name);
      return callback();
    },
    query: async () => ({ held: [...held].map((name) => ({ name })) }),
  };
}

describe('useFloorUploadScreen — hai tab cùng dự án: mở màn chỉ gỡ lệnh của phiên đã chết (NO-400)', () => {
  // Lệnh của "tab khác" sống qua lượt mở màn của bài sau (đúng điều nhóm này
  // kiểm), nên dọn cả trước lẫn sau mỗi bài.
  async function clearQueue(): Promise<void> {
    cleanup();

    const listed = await listPendingCommands(PROJECT_ID);

    for (const pending of listed.ok ? listed.data : []) {
      await deletePendingCommand(pending.id);
    }
  }

  beforeEach(clearQueue);
  afterEach(clearQueue);

  /**
   * Tab B mở màn, rồi thả một tệp lúc mất mạng. Lệnh của tab B chỉ được ghi sau
   * lượt dọn mồ côi lúc mở màn (`orphansClearedRef`), nên khi nó có mặt trong
   * hàng đợi thì lượt dọn đã xong — không cần đoán giờ.
   */
  async function openSecondTab(gatewayOptions: Omit<CreateFloorUploadGatewayOptions, 'networkMonitor'>) {
    const tab = renderScreen(createHarness({}, false, gatewayOptions).options);

    await waitFor(() => {
      expect(tab.result.current.floors).toHaveLength(4);
    });
    await act(async () => {
      tab.result.current.onFilesDropped([makeFile('mat-bang-tang-2.png')]);
    });

    return tab;
  }

  it('tab mở sau không gỡ lệnh của tab đang sống chờ mạng', async () => {
    const locks = createFakeLocks();
    const first = renderScreen(createHarness({}, false, { locks, sessionId: 'tab-a' }).options);

    await waitFor(() => {
      expect(first.result.current.floors).toHaveLength(4);
    });
    act(() => {
      first.result.current.onFilesDropped([makeFile('mat-bang-tang-3.png')]);
    });
    await expectQueuedFiles(['mat-bang-tang-3.png']);

    await openSecondTab({ locks, sessionId: 'tab-b' });

    await expectQueuedFiles(['mat-bang-tang-3.png', 'mat-bang-tang-2.png']);
  });

  it('lệnh của phiên đã đóng (không còn giữ khoá) là mồ côi và bị gỡ', async () => {
    await addPendingCommand({
      projectId: PROJECT_ID,
      command: { kind: 'uploadDrawing', fileName: 'tab-da-dong.png', floorId: 'L3', projectId: PROJECT_ID, sizeBytes: 4, sessionId: 'tab-da-dong' },
    });

    await openSecondTab({ locks: createFakeLocks(), sessionId: 'tab-b' });

    await expectQueuedFiles(['mat-bang-tang-2.png']);
  });

  it('trình duyệt không có Web Locks: không gỡ lệnh của phiên khác (có thể còn sống)', async () => {
    await addPendingCommand({
      projectId: PROJECT_ID,
      command: { kind: 'uploadDrawing', fileName: 'tab-khac.png', floorId: 'L3', projectId: PROJECT_ID, sizeBytes: 4, sessionId: 'tab-a' },
    });

    await openSecondTab({ locks: null, sessionId: 'tab-b' });

    await expectQueuedFiles(['tab-khac.png', 'mat-bang-tang-2.png']);
  });

  /*
   * Hai bất biến thứ tự của NO-400, ghim ở cổng (review DEBT-04 #2). Khoá giả
   * ở hai bài trên cấp ngay lúc xin, nên chúng không phân biệt được thứ tự.
   */
  const uploadInput = { projectId: PROJECT_ID, floorId: 'L3', fileName: 'tab-a.png', sizeBytes: 4 };

  it('ghi lệnh chỉ sau khi khoá phiên đã được cấp', async () => {
    let grant: () => void = () => undefined;
    const locks = {
      request: (_name: string, _options: unknown, callback: () => Promise<unknown>) =>
        new Promise<unknown>((resolve) => {
          grant = () => resolve(callback());
        }),
      query: async () => ({ held: [] }),
    };
    const gateway = createFloorUploadGateway(createMockApiClient(), { locks, sessionId: 'tab-cho-khoa' });

    const enqueued = gateway.enqueueOffline(uploadInput);

    // Khoá chưa cấp: chưa lệnh nào được hiện ra cho tab khác thấy.
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(await queuedUploads()).toEqual([]);

    grant();
    expect(await enqueued).not.toBeNull();
    expect((await queuedUploads()).map((command) => command.fileName)).toEqual(['tab-a.png']);
  });

  it('đọc khoá SAU khi đọc lệnh: lệnh ghi xen giữa hai lượt đọc không bị coi là mồ côi', async () => {
    const held = new Set<string>();
    const locks = {
      request: async (name: string, _options: unknown, callback: () => Promise<unknown>) => {
        held.add(name);
        return callback();
      },
      query: async () => {
        const snapshot = { held: [...held].map((name) => ({ name })) };

        // Tab A xin khoá rồi ghi lệnh ngay sau lúc chụp danh sách khoá.
        await tabA.enqueueOffline(uploadInput);

        return snapshot;
      },
    };
    const tabA = createFloorUploadGateway(createMockApiClient(), { locks, sessionId: 'tab-a' });
    const tabB = createFloorUploadGateway(createMockApiClient(), { locks, sessionId: 'tab-b' });

    await tabB.clearOrphanUploads(PROJECT_ID);

    expect((await queuedUploads()).map((command) => command.fileName)).toEqual(['tab-a.png']);
  });
});

describe('useFloorUploadScreen — hàng đợi ngoại tuyến và hàng chờ mạng (NO-392, NO-393)', () => {
  it('hoàn tác xoá không đưa tệp về tầng đã nhận tệp khác: tệp về khay và chỉ tệp đang ở tầng được tải (NO-393)', async () => {
    const harness = createHarness({}, false);
    const { result } = renderScreen(harness.options);

    await waitFor(() => {
      expect(result.current.floors).toHaveLength(4);
    });

    act(() => {
      result.current.onFilesDropped([makeFile('mat-bang-tang-3.png'), makeFile('ban-ve-khac.png')]);
    });

    await waitFor(() => {
      expect(result.current.tray.items).toHaveLength(1);
    });
    await waitFor(() => {
      expect(result.current.floors[3]?.file?.name).toBe('mat-bang-tang-3.png');
    });

    const first = result.current.floors[3]?.file?.id ?? '';
    const other = result.current.tray.items[0]?.id ?? '';

    act(() => {
      result.current.onRemoveFile(first);
    });
    act(() => {
      result.current.onReassign(other, 'L3');
    });
    await waitFor(() => {
      expect(result.current.floors[3]?.file?.name).toBe('ban-ve-khac.png');
    });

    const announce = vi.spyOn(getAppAnnouncer(), 'announce');

    act(() => {
      harness.toasts[0]?.onUndo?.();
    });

    await waitFor(() => {
      expect(result.current.tray.items.map((item) => item.name)).toEqual(['mat-bang-tang-3.png']);
    });
    expect(result.current.floors[3]?.file?.name).toBe('ban-ve-khac.png');
    expect(announce).toHaveBeenCalledWith(expect.stringContaining('mat-bang-tang-3.png đã về khay'));

    act(() => {
      harness.setOnline(true);
    });

    await waitFor(() => {
      expect(harness.uploads.size).toBe(1);
    });
    expect([...harness.uploads.values()][0]?.task.id).toBe(other);
  });

  it('tệp bị thay ở một tầng về khay có câu báo cho trình đọc màn hình (NO-393)', async () => {
    const harness = createHarness();
    const { result } = renderScreen(harness.options);

    await waitFor(() => {
      expect(result.current.floors).toHaveLength(4);
    });

    act(() => {
      result.current.onFilesDropped([makeFile('mat-bang-tang-3.png'), makeFile('mat-bang-tang-2.png')]);
    });

    await waitFor(() => {
      expect(result.current.floors[2]?.file?.name).toBe('mat-bang-tang-2.png');
    });

    const announce = vi.spyOn(getAppAnnouncer(), 'announce');

    act(() => {
      result.current.onReassign(result.current.floors[2]?.file?.id ?? '', 'L3');
    });

    await waitFor(() => {
      expect(result.current.tray.items.map((item) => item.name)).toEqual(['mat-bang-tang-3.png']);
    });
    expect(announce).toHaveBeenCalledWith(
      'mat-bang-tang-3.png đã về khay tệp chưa gán tầng vì tầng ấy đã có tệp khác',
    );
  });

  it('câu "chờ mạng" đọc một lần cho cả lượt mất mạng, không một lần mỗi tệp', async () => {
    const harness = createHarness({}, false);
    const announce = vi.spyOn(getAppAnnouncer(), 'announce');
    const { result } = renderScreen(harness.options);

    await waitFor(() => {
      expect(result.current.floors).toHaveLength(4);
    });

    act(() => {
      result.current.onFilesDropped([
        makeFile('mat-bang-tang-3.png'),
        makeFile('mat-bang-tang-2.png'),
        makeFile('mat-bang-tang-ham.png'),
      ]);
    });

    await waitFor(() => {
      expect(result.current.floors.filter((row) => row.file?.name.startsWith('mat-bang') ?? false)).toHaveLength(3);
    });

    const awaitCalls = (): number =>
      announce.mock.calls.filter(([sentence]) => String(sentence).includes('khi có mạng trở lại')).length;

    expect(awaitCalls()).toBe(1);
  });

  it('gán tệp thứ hai vào tầng đang có tệp chờ mạng: tệp cũ về khay, chỉ tệp mới được tải (NO-393)', async () => {
    const harness = createHarness({}, false);
    const { result } = renderScreen(harness.options);

    await waitFor(() => {
      expect(result.current.floors).toHaveLength(4);
    });

    act(() => {
      result.current.onFilesDropped([makeFile('mat-bang-tang-3.png'), makeFile('mat-bang-tang-2.png')]);
    });

    await waitFor(() => {
      expect(result.current.floors[2]?.file?.name).toBe('mat-bang-tang-2.png');
    });

    const secondId = result.current.floors[2]?.file?.id ?? '';

    act(() => {
      result.current.onReassign(secondId, 'L3');
    });

    await waitFor(() => {
      expect(result.current.floors[3]?.file?.name).toBe('mat-bang-tang-2.png');
    });
    expect(result.current.tray.items.map((item) => item.name)).toEqual(['mat-bang-tang-3.png']);

    act(() => {
      harness.setOnline(true);
    });

    await waitFor(() => {
      expect(harness.uploads.size).toBe(1);
    });
    expect([...harness.uploads.values()][0]?.task.id).toBe(secondId);
  });
});

/* -------------------------------------------------------------------------- */
/* Gán lại và xoá.                                                             */
/* -------------------------------------------------------------------------- */

describe('useFloorUploadScreen — gán lại và xoá', () => {
  it('gán lại tầng xoá dấu "ghép tự động" và mở lượt tải mới', async () => {
    const harness = createHarness();
    const { result } = renderScreen(harness.options);

    await waitFor(() => {
      expect(result.current.floors).toHaveLength(4);
    });

    act(() => {
      result.current.onFilesDropped([makeFile('mat-bang-tang-2.png')]);
    });

    await waitFor(() => {
      expect(result.current.floors[2]?.file).not.toBeNull();
    });

    const fileId = result.current.floors[2]?.file?.id ?? '';

    act(() => {
      result.current.onReassign(fileId, 'L3');
    });

    await waitFor(() => {
      expect(result.current.floors[3]?.file).not.toBeNull();
    });

    expect(result.current.floors[2]?.file).toBeNull();
    expect(result.current.floors[3]?.isAutoMatched).toBe(false);
  });

  it('xoá xảy ra ngay, không hộp thoại, và hoàn tác được bằng vé (A8, D-05)', async () => {
    const harness = createHarness();
    const { result } = renderScreen(harness.options);

    await waitFor(() => {
      expect(result.current.floors).toHaveLength(4);
    });

    act(() => {
      result.current.onFilesDropped([makeFile('mat-bang-tang-2.png')]);
    });

    await waitFor(() => {
      expect(result.current.floors[2]?.file).not.toBeNull();
    });

    act(() => {
      for (const upload of harness.uploads.values()) {
        upload.finish({ percent: 100, status: 'done' });
      }
    });

    await waitFor(() => {
      expect(result.current.floors[2]?.status).toBe('attached');
    });

    const fileId = result.current.floors[2]?.file?.id ?? '';

    act(() => {
      result.current.onRemoveFile(fileId);
    });

    expect(result.current.floors[2]?.file).toBeNull();
    expect(harness.toasts).toHaveLength(1);
    expect(harness.toasts[0]?.message).toContain('Đã xoá bản vẽ');

    act(() => {
      harness.toasts[0]?.onUndo?.();
    });

    await waitFor(() => {
      expect(result.current.floors[2]?.file).not.toBeNull();
    });
    // B-V4-03: trả về ĐÚNG trạng thái lúc xoá — "chờ xử lý" thì treo mãi.
    expect(result.current.floors[2]?.status).toBe('attached');
  });
});

/* -------------------------------------------------------------------------- */
/* Nút chính.                                                                  */
/* -------------------------------------------------------------------------- */

describe('useFloorUploadScreen — nút chính', () => {
  it('nút chặn nêu tên tầng thiếu và mang mã tầng để view cuộn tới', async () => {
    const harness = createHarness(withoutServerDrawings());
    const { result } = renderScreen(harness.options);

    await waitFor(() => {
      expect(result.current.floors).toHaveLength(4);
    });

    expect(result.current.footer.canSubmit).toBe(false);
    expect(result.current.blockNotice).toBeNull();

    act(() => {
      result.current.onSubmit();
    });

    const notice = result.current.blockNotice;

    expect(notice).not.toBeNull();
    expect(notice?.reasons.length).toBeGreaterThan(0);
    // Nhãn tầng xuất hiện ĐÚNG MỘT LẦN: `floor.name` của API đã là `Tầng hầm`,
    // nên câu không được ghép thêm chữ `Tầng` ở đầu. Khẳng định nguyên câu chứ
    // không `toContain`, vì `toContain('Tầng hầm')` xanh cả với `Tầng Tầng hầm`.
    expect(notice?.reasons[0]?.sentence).toBe('Tầng hầm chưa có bản vẽ.');
    expect(notice?.scrollTo.floorId).toBe('L-1');
    expect(harness.navigations).toHaveLength(0);
  });

  it('mỗi lượt bấm bị chặn cho một requestId mới, nên view cuộn lại được', async () => {
    const harness = createHarness(withoutServerDrawings());
    const { result } = renderScreen(harness.options);

    await waitFor(() => {
      expect(result.current.floors).toHaveLength(4);
    });

    act(() => {
      result.current.onSubmit();
    });

    const first = result.current.blockNotice?.scrollTo.requestId ?? 0;

    act(() => {
      result.current.onSubmit();
    });

    expect(result.current.blockNotice?.scrollTo.requestId).toBe(first + 1);
  });

  it('tầng đang tải cũng là một lý do chặn', async () => {
    const harness = createHarness();
    const { result } = renderScreen(harness.options);

    await waitFor(() => {
      expect(result.current.floors).toHaveLength(4);
    });

    act(() => {
      result.current.onFilesDropped([makeFile('mat-bang-tang-2.png')]);
    });

    await waitFor(() => {
      expect(result.current.floors[2]?.status).toBe('uploading');
    });

    expect(
      result.current.footer.blockReasons.some(
        (reason) => reason.kind === 'uploading' && reason.floorId === 'L2',
      ),
    ).toBe(true);
  });

  it('đủ bốn tầng thì điều hướng qua hằng ROUTES, không chuỗi viết thẳng (R-65)', async () => {
    const harness = createHarness();
    const { result } = renderScreen(harness.options);

    await waitFor(() => {
      expect(result.current.floors).toHaveLength(4);
    });

    // `Tầng 1` đã có sẵn một bản vẽ trên máy chủ trong bộ mẫu, nên chỉ ba tầng
    // còn lại cần tệp mới — và ba lượt tải, không phải bốn.
    act(() => {
      result.current.onFilesDropped([
        makeFile('tang-ham.png'),
        makeFile('tang-2.png'),
        makeFile('tang-3.png'),
      ]);
    });

    await waitFor(() => {
      expect(harness.uploads.size).toBe(3);
    });

    act(() => {
      for (const upload of harness.uploads.values()) {
        upload.finish({ percent: 100, status: 'done' });
      }
    });

    await waitFor(() => {
      expect(result.current.footer.canSubmit).toBe(true);
    });

    expect(result.current.footer.counterLabel).toBe('4 / 4 tầng đã có bản vẽ');
    expect(result.current.state).toBe('success');

    act(() => {
      result.current.onSubmit();
    });

    expect(harness.navigations).toEqual([ROUTES.project.pipeline(PROJECT_ID)]);
    expect(result.current.blockNotice).toBeNull();
  });

  it('dự án chưa có tầng: bấm nút chính nói lý do, vùng thả tắt, có lối tới Quản lý tầng (BUG-298)', async () => {
    const harness = createHarness({ readFloors: async () => ({ ok: true, data: [] }) });
    const { result } = renderScreen(harness.options);

    await waitFor(() => {
      expect(result.current.state).toBe('empty');
    });

    expect(result.current.dropZone.isEnabled).toBe(false);

    act(() => {
      result.current.onSubmit();
    });

    expect(result.current.blockNotice?.title).toBe('Không thể bắt đầu xử lý');
    expect(result.current.blockNotice?.reasons.map((reason) => reason.kind)).toEqual(['noFloors']);
    expect(harness.navigations).toHaveLength(0);

    act(() => {
      result.current.onFilesDropped([makeFile('tang-2.png')]);
    });

    expect(result.current.tray.items).toHaveLength(0);

    act(() => {
      result.current.onAddFloors?.();
    });

    expect(harness.navigations).toEqual([ROUTES.project.floors(PROJECT_ID)]);
  });
});

/* -------------------------------------------------------------------------- */
/* Quyền và chuyển động.                                                       */
/* -------------------------------------------------------------------------- */

describe('useFloorUploadScreen — quyền và chuyển động', () => {
  it('vai chỉ xem tắt kéo thả và mọi thao tác sửa', async () => {
    const harness = createHarness();
    const { result } = renderScreen({ ...harness.options, roles: ['viewer'] });

    await waitFor(() => {
      expect(result.current.floors).toHaveLength(4);
    });

    expect(result.current.state).toBe('forbidden');
    expect(result.current.isReadOnly).toBe(true);
    expect(result.current.dropZone.isEnabled).toBe(false);
    expect(result.current.readOnlyNotice).not.toBeNull();
    expect(result.current.floors[0]?.reassignOptions).toHaveLength(0);

    act(() => {
      result.current.onFilesDropped([makeFile('mat-bang-tang-2.png')]);
      result.current.onDragEnter();
    });

    expect(result.current.isDragActive).toBe(false);
    expect(result.current.tray.items).toHaveLength(0);
  });

  it('thẻ hiện ra ở 260 ms với nhịp so le 24 ms, cả hai lấy từ src/lib/motion', async () => {
    const harness = createHarness();
    const { result } = renderScreen(harness.options);

    await waitFor(() => {
      expect(result.current.floors).toHaveLength(4);
    });

    expect(result.current.floors[0]?.revealDurationMs).toBe(durationMs('standard'));
    expect(result.current.floors[2]?.revealDelayMs).toBe(staggerDelayMs(2));
    // Đặc tả xin 240 ms; thang chuyển động không có giá trị đó, nên thẻ dùng
    // `standard` = 260 ms. Nhịp so le 24 ms thì hợp lệ nguyên vẹn.
    expect(result.current.floors[0]?.revealDurationMs).toBe(260);
    expect(result.current.floors[2]?.revealDelayMs).toBe(48);
  });

  it('vùng kéo thả nói trần dung lượng bằng hằng của src/lib/upload', async () => {
    const harness = createHarness();
    const { result } = renderScreen(harness.options);

    await waitFor(() => {
      expect(result.current.floors).toHaveLength(4);
    });

    expect(result.current.dropZone.formatsLine).not.toContain('.dwg');
    expect(result.current.dropZone.formatsLine).toContain('MB');
    expect(result.current.dropZone.acceptAttribute).toBe('.png,.jpg,.jpeg,.pdf');
  });
});

/* -------------------------------------------------------------------------- */
/* pageIndex và PDF nhiều trang chờ chọn trang.                                */
/* -------------------------------------------------------------------------- */

const PICK_PAGE_SENTENCE = 'Hãy chọn trang bản vẽ để bắt đầu tải';

const pdfValidation =
  (pageCount: number): FloorUploadGateway['validateFile'] =>
  async (file: UploadCandidate) => ({
    branch: 'pdf',
    extension: '.pdf',
    ok: true,
    pageCount,
    sizeBytes: file.size,
  });

const bodyOf = (call: unknown[] | undefined): { pageIndex?: number } =>
  (call?.[0] ?? {}) as { pageIndex?: number };

const pdfFile = (name: string): File => makeFile(name, 16, 'application/pdf');

describe('useFloorUploadScreen — một tờ nhiều tầng', () => {
  it('PDF một trang: có ảnh để khoanh, xác nhận 2 khung tải cùng tệp 2 lần, mỗi lần một crop', async () => {
    const readPageThumbnails = vi.fn(async () => ['data:image/png;base64,AAAA']);
    const harness = createHarness({ validateFile: pdfValidation(1), readPageThumbnails });
    const createUpload = vi.spyOn(harness.gateway, 'createUpload');
    const { result } = renderScreen(harness.options);

    await waitFor(() => {
      expect(result.current.floors).toHaveLength(4);
    });
    const sheet = pdfFile('mat-bang-tang-2.pdf');

    act(() => {
      result.current.onFilesDropped([sheet]);
    });
    await waitFor(() => {
      expect(result.current.floors[2]?.canSplitSheet).toBe(true);
    });

    const [, lower, , upper] = result.current.floors.map((floor) => floor.floorId);
    const left = { xRatio: 0, yRatio: 0, widthRatio: 0.5, heightRatio: 1 };
    const right = { xRatio: 0.5, yRatio: 0, widthRatio: 0.5, heightRatio: 1 };
    createUpload.mockClear();

    act(() => {
      result.current.onOpenSheetRegions?.(result.current.floors[2]?.file?.id ?? '');
    });
    expect(result.current.sheetRegions?.previewUrl).toBe('data:image/png;base64,AAAA');
    act(() => {
      result.current.onSetSheetRegion?.(lower ?? '', left);
      result.current.onSetSheetRegion?.(upper ?? '', right);
    });
    act(() => {
      result.current.onConfirmSheetRegions?.();
    });

    expect(createUpload).toHaveBeenCalledTimes(2);
    expect(createUpload.mock.calls.map(([input]) => [input.file, input.floorId, input.crop])).toEqual([
      [sheet, lower, left],
      [sheet, upper, right],
    ]);
    await waitFor(() => {
      expect(result.current.floors[1]?.file).not.toBeNull();
    });
    expect(readPageThumbnails).toHaveBeenCalledTimes(1);
    // Vùng đã khoanh tới mô hình hàng: thẻ tầng vẽ ảnh nhỏ của đúng vùng ấy.
    expect(result.current.floors[1]?.file?.crop).toEqual(left);
    expect(result.current.floors[3]?.file?.crop).toEqual(right);
    expect(result.current.floors[2]?.file?.crop).toBeUndefined();
  });
});

describe('useFloorUploadScreen — trang PDF', () => {
  const setup = async (overrides: Partial<FloorUploadGateway> = {}, online = true) => {
    const harness = createHarness(overrides, online);
    const createUpload = vi.spyOn(harness.gateway, 'createUpload');
    const view = renderScreen(harness.options);

    await waitFor(() => {
      expect(view.result.current.floors).toHaveLength(4);
    });

    return { ...harness, createUpload, ...view };
  };

  it('PDF 3 trang ghép tầng nhưng chưa tải, và nhắc chọn trang', async () => {
    const { createUpload, result } = await setup({ validateFile: pdfValidation(3) });

    act(() => {
      result.current.onFilesDropped([pdfFile('mat-bang-tang-2.pdf')]);
    });

    await waitFor(() => {
      expect(result.current.floors[2]?.file).not.toBeNull();
    });

    expect(createUpload).not.toHaveBeenCalled();
    expect(result.current.floors[2]?.status).toBe('waiting');
    // Có tệp mà chưa tải: "Chờ xử lý", khác tầng chưa có bản vẽ (BUG-263).
    expect(result.current.floors[2]?.statusLabel).toBe('Chờ xử lý');
    await waitFor(() => {
      expect(document.body.textContent).toContain(PICK_PAGE_SENTENCE);
    });
    // B-V4-04: tệp chưa tải chưa phải bản vẽ của tầng — nút chính phải chặn, và nói việc cần
    // làm là chọn trang chứ không phải chờ tải (BUG-303).
    expect(result.current.footer.blockReasons).toContainEqual(
      expect.objectContaining({
        floorId: 'L2',
        kind: 'missingFile',
        sentence: 'Tầng 2 chưa chọn trang của bản vẽ.',
      }),
    );
  });

  it('chọn trang 3 thì tải đúng một lần, mang pageIndex 2', async () => {
    const { createUpload, result } = await setup({ validateFile: pdfValidation(3) });

    act(() => {
      result.current.onFilesDropped([pdfFile('mat-bang-tang-2.pdf')]);
    });
    await waitFor(() => {
      expect(result.current.floors[2]?.file).not.toBeNull();
    });

    act(() => {
      result.current.onPickPdfPage(result.current.floors[2]?.file?.id ?? '', '3');
    });

    expect(createUpload).toHaveBeenCalledTimes(1);
    expect(bodyOf(createUpload.mock.calls[0]).pageIndex).toBe(2);
    expect(result.current.floors[2]?.status).toBe('uploading');
  });

  it('đổi trang sau đó thì huỷ lượt cũ rồi tải lại', async () => {
    const { createUpload, result, uploads } = await setup({ validateFile: pdfValidation(3) });

    act(() => {
      result.current.onFilesDropped([pdfFile('mat-bang-tang-2.pdf')]);
    });
    await waitFor(() => {
      expect(result.current.floors[2]?.file).not.toBeNull();
    });

    const fileId = result.current.floors[2]?.file?.id ?? '';

    act(() => {
      result.current.onPickPdfPage(fileId, '3');
    });

    const first = [...uploads.values()][0];

    act(() => {
      result.current.onPickPdfPage(fileId, '1');
    });

    expect(first?.cancelled()).toBe(true);
    expect(createUpload).toHaveBeenCalledTimes(2);
    expect(bodyOf(createUpload.mock.calls[1]).pageIndex).toBe(0);
  });

  it('PDF một trang và ảnh tải ngay, thân vắng pageIndex', async () => {
    const { createUpload, result } = await setup({ validateFile: pdfValidation(1) });

    act(() => {
      result.current.onFilesDropped([pdfFile('mat-bang-tang-2.pdf')]);
    });
    await waitFor(() => {
      expect(createUpload).toHaveBeenCalledTimes(1);
    });
    expect('pageIndex' in bodyOf(createUpload.mock.calls[0])).toBe(false);

    act(() => {
      result.current.onFilesDropped([makeFile('mat-bang-tang-3.png')]);
    });
    await waitFor(() => {
      expect(createUpload).toHaveBeenCalledTimes(2);
    });
    expect('pageIndex' in bodyOf(createUpload.mock.calls[1])).toBe(false);
  });

  it('chọn trang lúc ngoại tuyến: lệnh hàng đợi mang pageIndex, mạng về thì lượt tải mang đúng nó', async () => {
    const { createUpload, result, setOnline } = await setup({ validateFile: pdfValidation(3) }, false);

    act(() => {
      result.current.onFilesDropped([pdfFile('mat-bang-tang-2.pdf')]);
    });
    await waitFor(() => {
      expect(result.current.floors[2]?.file).not.toBeNull();
    });

    act(() => {
      result.current.onPickPdfPage(result.current.floors[2]?.file?.id ?? '', '2');
    });

    // F-03.md:110 — lệnh hàng đợi mang theo trang đã chọn.
    await waitForQueue(async () => {
      expect((await queuedUploads()).map((command) => command.pageIndex)).toEqual([1]);
    });

    act(() => {
      setOnline(true);
    });

    await waitFor(() => {
      expect(createUpload).toHaveBeenCalledTimes(1);
    });
    expect(bodyOf(createUpload.mock.calls[0]).pageIndex).toBe(1);
    await expectQueuedFiles([]);
  });

  it('PDF nhiều trang chưa chọn trang: mạng về cũng chưa tải; chọn trang rồi mới tải (R2-6)', async () => {
    const { createUpload, result, setOnline } = await setup({ validateFile: pdfValidation(3) }, false);

    act(() => {
      result.current.onFilesDropped([pdfFile('mat-bang-tang-2.pdf')]);
    });
    await waitFor(() => {
      expect(result.current.floors[2]?.file).not.toBeNull();
    });

    await act(async () => {
      setOnline(true);
      await Promise.resolve();
    });
    expect(createUpload).not.toHaveBeenCalled();

    act(() => {
      result.current.onPickPdfPage(result.current.floors[2]?.file?.id ?? '', '2');
    });
    await waitFor(() => {
      expect(createUpload).toHaveBeenCalledTimes(1);
    });
    expect(bodyOf(createUpload.mock.calls[0]).pageIndex).toBe(1);
  });

  it('#5 trả 422 CAD_NOT_SUPPORTED thì thẻ nói câu về CAD, không in mã', async () => {
    const body = ApiErrorBodySchema.parse({ code: 'CAD_NOT_SUPPORTED', requestId: 'req-cad' });
    const error: HttpError = {
      code: body.code,
      kind: 'http',
      raw: { code: body.code, requestId: body.requestId },
      requestId: body.requestId,
      retryable: false,
      status: 422,
    };

    expect(() =>
      ProgressSchema.parse({ id: 'upload-1', progressPercent: 0, status: 'running', step: 'x' }),
    ).not.toThrow();

    const fail = async (): Promise<ApiResult<Progress>> => ({ error, ok: false });
    const api = { complete: fail, initUpload: fail, progress: fail, sendChunk: fail };
    const { result } = await setup({
      createUpload: ({ file, floorId, id, onProgress, projectId }) =>
        createUploadTask({
          api,
          file,
          floorId,
          projectId,
          onProgress,
          ...(id !== undefined ? { id } : {}),
        }),
    });

    act(() => {
      result.current.onFilesDropped([makeFile('mat-bang-tang-2.png')]);
    });

    await waitFor(() => {
      expect(result.current.floors[2]?.status).toBe('error');
    });

    const sentence = result.current.floors[2]?.error?.sentence ?? '';

    expect(sentence).toBe('Bản vẽ CAD (.dwg) chưa được hỗ trợ; hãy xuất sang PDF rồi tải lại.');
    expect(sentence).not.toContain('CAD_NOT_SUPPORTED');
    expect(result.current.floors[2]?.canRetryUpload).toBe(false);
  });
});

/* -------------------------------------------------------------------------- */
/* QA-03e — SCR-10 (BUG-523..536, BUG-311).                                    */
/* -------------------------------------------------------------------------- */

describe('useFloorUploadScreen — QA-03e', () => {
  const ready = async (options: UseFloorUploadScreenOptions) => {
    const view = renderScreen(options);

    await waitFor(() => {
      expect(view.result.current.floors).toHaveLength(4);
    });

    return view;
  };

  const transferFailure = (kind: 'upload' | 'notFound', retryable: boolean): UploadFailure => ({
    stage: 'init',
    chunkIndex: null,
    attempts: 1,
    terminal: !retryable,
    error: {
      kind,
      code: kind === 'notFound' ? 'NOT_FOUND' : 'UPLOAD',
      messageKey: `errors.${kind}.description`,
      params: {},
      requestId: 'r-qa03e',
      retryable,
      severity: 'lỗi',
      recovery: 'thử lại',
    },
  });

  // BUG-523: a refused file kept "Gán cho tầng khác" and the init went out (422/413).
  it('tệp bị từ chối không gán được cho tầng và không bao giờ tải lên (BUG-523)', async () => {
    const harness = createHarness();
    const createUpload = vi.spyOn(harness.gateway, 'createUpload');
    const { result } = await ready(harness.options);

    act(() => {
      result.current.onFilesDropped([makeFile('ghi-chu.txt', 16, 'text/plain')]);
    });
    await waitFor(() => {
      expect(result.current.tray.items[0]?.error).not.toBeNull();
    });

    expect(result.current.tray.items[0]?.assignOptions).toHaveLength(0);

    act(() => {
      result.current.onReassign(result.current.tray.items[0]?.id ?? '', 'L2');
    });

    expect(createUpload).not.toHaveBeenCalled();
    expect(result.current.floors[2]?.file).toBeNull();
  });

  // BUG-527: cards kept the 260 ms rise and the 24 ms stagger under prefers-reduced-motion.
  it('reduced motion: thẻ hiện ngay, không so le (BUG-527)', async () => {
    vi.mocked(window.matchMedia).mockImplementation((query: string) => ({
      matches: query.includes('prefers-reduced-motion'),
      media: query,
      onchange: null,
      addListener: vi.fn(),
      removeListener: vi.fn(),
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      dispatchEvent: vi.fn(),
    }));
    const { result } = await ready(createHarness().options);

    expect(result.current.floors.map((row) => row.revealDurationMs)).toEqual([0, 0, 0, 0]);
    expect(result.current.floors.map((row) => row.revealDelayMs)).toEqual([0, 0, 0, 0]);
  });

  // BUG-528: under 1024 px 'collapsed' won over 'empty', and the invitation line vanished.
  it('khổ hẹp, chưa có tệp nào: vẫn là "empty" để câu mời hiện (BUG-528)', async () => {
    const real = createFloorUploadGateway(createMockApiClient());
    const harness = createHarness({
      readFloors: async (input) => {
        const read = await real.readFloors(input);
        return read.ok ? { ok: true, data: read.data.map((floor) => ({ ...floor, drawings: [] })) } : read;
      },
    });
    const { result } = await ready({ ...harness.options, forceCollapsed: true });

    expect(result.current.state).toBe('empty');
    expect(result.current.isCollapsed).toBe(true);
  });

  // BUG-530: a one-page PDF still offered a "Chọn trang" picker with one option.
  it('PDF một trang không có ô chọn trang (BUG-530)', async () => {
    const harness = createHarness({ validateFile: pdfValidation(1) });
    const { result } = await ready(harness.options);

    act(() => {
      result.current.onFilesDropped([pdfFile('mat-bang-tang-2.pdf')]);
    });
    await waitFor(() => {
      expect(result.current.floors[2]?.file).not.toBeNull();
    });

    expect(result.current.floors[2]?.file?.pageOptions).toEqual([]);
  });

  // BUG-531: the server-drawing card offered "Gán cho tầng khác", and picking a floor did nothing.
  it('thẻ chỉ có bản vẽ máy chủ không có ô gán tầng (BUG-531)', async () => {
    const { result } = await ready(createHarness().options);
    const serverCard = result.current.floors[1];

    expect(serverCard?.file).not.toBeNull();
    expect(serverCard?.reassignOptions).toHaveLength(0);
  });

  // BUG-534: after "Huỷ" the only way back was delete-and-pick-again.
  it('huỷ một lượt tải xong thì thẻ có "Thử lại" (BUG-534)', async () => {
    const harness = createHarness();
    const { result } = await ready(harness.options);

    act(() => {
      result.current.onFilesDropped([makeFile('mat-bang-tang-3.png')]);
    });
    await waitFor(() => {
      expect(harness.uploads.size).toBe(1);
    });

    const fileId = result.current.floors[3]?.file?.id ?? '';

    act(() => {
      result.current.onCancelUpload(fileId);
      [...harness.uploads.values()][0]?.finish({ status: 'cancelled' });
    });
    await waitFor(() => {
      expect(result.current.floors[3]?.status).toBe('waiting');
    });

    expect(result.current.floors[3]?.canRetryUpload).toBe(true);

    act(() => {
      result.current.onRetryUpload(fileId);
    });

    expect(result.current.floors[3]?.status).toBe('uploading');
    expect(result.current.floors[3]?.canRetryUpload).toBe(false);
  });

  // BUG-535: closing the failure alert also cleared the problem, so "Thử lại" went with it.
  it('"Đóng" thông báo lỗi tải chỉ ẩn câu, vẫn còn "Thử lại" (BUG-535)', async () => {
    const harness = createHarness();
    const { result } = await ready(harness.options);

    act(() => {
      result.current.onFilesDropped([makeFile('mat-bang-tang-3.png')]);
    });
    await waitFor(() => {
      expect(harness.uploads.size).toBe(1);
    });
    act(() => {
      [...harness.uploads.values()][0]?.finish({ status: 'failed', failure: transferFailure('upload', true) });
    });
    await waitFor(() => {
      expect(result.current.floors[3]?.error).not.toBeNull();
    });

    act(() => {
      result.current.onDismissError(result.current.floors[3]?.file?.id ?? '');
    });

    expect(result.current.floors[3]?.error).toBeNull();
    expect(result.current.floors[3]?.canRetryUpload).toBe(true);
  });

  // BUG-536: the viewer could press "Bắt đầu xử lý" and nothing happened.
  it('người xem không có nút "Bắt đầu xử lý" (BUG-536)', async () => {
    const { result } = await ready({ ...createHarness().options, roles: ['viewer'] });

    expect(result.current.footer.isSubmitHidden).toBe(true);
  });

  // BUG-311 (reopened): the project deleted in another tab; the init 404 stayed on the card.
  it('lượt tải trả 404 thì đọc lại dự án; dự án mất thì màn về "không tìm thấy dự án" (BUG-311)', async () => {
    let reads = 0;
    const harness = createHarness();
    const readFloors: FloorUploadGateway['readFloors'] = async (input) => {
      reads += 1;
      return reads === 1
        ? harness.gateway.readFloors(input)
        : {
            ok: false,
            error: { kind: 'http', status: 404, code: 'NOT_FOUND', requestId: 'r-404', retryable: false, raw: {} },
          };
    };
    const { result } = await ready({ ...harness.options, gateway: { ...harness.gateway, readFloors } });

    act(() => {
      result.current.onFilesDropped([makeFile('mat-bang-tang-3.png')]);
    });
    await waitFor(() => {
      expect(harness.uploads.size).toBe(1);
    });
    act(() => {
      [...harness.uploads.values()][0]?.finish({ status: 'failed', failure: transferFailure('notFound', false) });
    });

    await waitFor(() => {
      expect(result.current.state).toBe('error');
    });
    expect(result.current.isProjectMissing).toBe(true);
  });

  // BUG-572: the FLOOR deleted elsewhere (project still there) — the 404 re-read dropped the card,
  // and the file vanished with it, silently.
  it('tầng bị xoá ở nơi khác: tệp về khay kèm câu báo, gán lại được (BUG-572)', async () => {
    let reads = 0;
    let goneId = '';
    let goneName = '';
    const harness = createHarness();
    const readFloors: FloorUploadGateway['readFloors'] = async (input) => {
      reads += 1;
      const read = await harness.gateway.readFloors(input);

      if (reads === 1 || !read.ok) {
        return read;
      }

      goneName = read.data.find((floor) => floor.id === goneId)?.name ?? '';

      return { ok: true, data: read.data.filter((floor) => floor.id !== goneId) };
    };
    const { result } = await ready({ ...harness.options, gateway: { ...harness.gateway, readFloors } });
    const spoken = vi.spyOn(getAppAnnouncer(), 'announce');

    goneId = result.current.floors[3]?.floorId ?? '';
    const otherId = result.current.floors[0]?.floorId ?? '';

    act(() => {
      result.current.onFilesDropped([makeFile('mat-bang-tang-3.png')]);
    });
    await waitFor(() => {
      expect(harness.uploads.size).toBe(1);
    });
    act(() => {
      [...harness.uploads.values()][0]?.finish({ status: 'failed', failure: transferFailure('notFound', false) });
    });

    await waitFor(() => {
      expect(result.current.floors.some((row) => row.floorId === goneId)).toBe(false);
    });
    expect(result.current.state).not.toBe('error');
    // Tầng biến mất trước, câu báo của tệp vào khay ở nhịp sau: đợi nó, đừng đọc ngay (chập chờn 1/4).
    await waitFor(() => {
      expect(result.current.tray.items.find((entry) => entry.name === 'mat-bang-tang-3.png')?.error).toBeDefined();
    });

    const item = result.current.tray.items.find((entry) => entry.name === 'mat-bang-tang-3.png');

    expect(goneName).not.toBe('');
    expect(item?.error?.sentence).toBe(
      `${goneName} đã bị xoá ở nơi khác; mat-bang-tang-3.png đã về khay tệp chưa gán tầng, hãy gán cho tầng khác.`,
    );
    expect(item?.error?.isRetryable).toBe(false);
    expect(item?.assignOptions.length).toBeGreaterThan(0);
    expect(spoken.mock.calls.flat()).toContain(item?.error?.sentence);

    act(() => {
      result.current.onReassign(item?.id ?? '', otherId);
    });

    expect(result.current.tray.items.some((entry) => entry.name === 'mat-bang-tang-3.png')).toBe(false);
    expect(result.current.floors[0]?.file?.name).toBe('mat-bang-tang-3.png');
    expect(result.current.floors[0]?.status).toBe('uploading');
  });
});

describe('K19 — tầng của một nhà hay căn hộ riêng', () => {
  function splitHarness() {
    const harness = createHarness();
    const created: string[] = [];
    const uploadedTo: { readonly fileName: string; readonly projectId: string; readonly floorId: string }[] = [];
    const gateway: FloorUploadGateway = {
      ...harness.gateway,
      createApartmentProject: async ({ name }) => {
        created.push(name);
        return { ok: true, data: { projectId: `p-${name}`, floorId: `f-${name}` } };
      },
      createUpload: (input) => {
        uploadedTo.push({ fileName: input.file.name, projectId: input.projectId, floorId: input.floorId });
        return harness.gateway.createUpload(input);
      },
    };

    return { harness, created, uploadedTo, options: { ...harness.options, gateway, askHowToSplit: true } };
  }

  async function ready(options: UseFloorUploadScreenOptions) {
    const view = renderScreen(options);

    await waitFor(() => {
      expect(view.result.current.floors).toHaveLength(4);
    });

    return view;
  }

  it('hai tệp không đọc ra tầng: hỏi trước, chưa gán gì', async () => {
    const { options } = splitHarness();
    const { result } = await ready(options);

    act(() => {
      result.current.onFilesDropped([makeFile('can-ho-a.png'), makeFile('can-ho-b.png')]);
    });

    expect(result.current.splitPrompt?.question).toBe(
      'Các bản vẽ này là các tầng của cùng một nhà, hay là các căn hộ riêng?',
    );
    expect(result.current.splitPrompt?.detail).toContain('2 bản vẽ');
    expect(result.current.tray.items).toHaveLength(0);
  });

  it('"Các tầng của một nhà" giữ đường cũ: tệp vào khay của dự án này', async () => {
    const { created, options } = splitHarness();
    const { result } = await ready(options);

    act(() => {
      result.current.onFilesChosen([makeFile('can-ho-a.png'), makeFile('can-ho-b.png')]);
    });
    act(() => {
      result.current.onSplitAsFloors?.();
    });

    expect(result.current.splitPrompt).toBeNull();
    await waitFor(() => {
      expect(result.current.tray.items).toHaveLength(2);
    });
    expect(created).toEqual([]);
  });

  it('một tệp: không hỏi', async () => {
    const { options } = splitHarness();
    const { result } = await ready(options);

    act(() => {
      result.current.onFilesDropped([makeFile('can-ho-a.png')]);
    });
    expect(result.current.splitPrompt).toBeNull();
  });

  it('tên tệp đều là tầng: vẫn hỏi, câu chi tiết nói tên chỉ gợi ý; chưa gán gì', async () => {
    const { options } = splitHarness();
    const { result } = await ready(options);

    act(() => {
      result.current.onFilesDropped([makeFile('mat-bang-tang-2.png'), makeFile('mat-bang-tang-3.png')]);
    });

    expect(result.current.splitPrompt?.detail).toContain(SPLIT_COPY.namesLookLikeFloors);
    expect(result.current.tray.items).toHaveLength(0);
  });

  it('PDF nhiều trang, căn hộ riêng: báo trước ở câu hỏi, tải trang 1, hàng nói rõ', async () => {
    const { harness, options, uploadedTo } = splitHarness();
    const pageIndexes: (number | undefined)[] = [];
    const gateway: FloorUploadGateway = {
      ...options.gateway,
      validateFile: pdfValidation(3),
      createUpload: (input) => {
        pageIndexes.push(input.pageIndex);
        return options.gateway.createUpload(input);
      },
    };
    const { result } = await ready({ ...options, gateway });

    act(() => {
      result.current.onFilesDropped([makeFile('can-ho-a.pdf'), makeFile('can-ho-b.pdf')]);
    });
    expect(result.current.splitPrompt?.detail).toContain(SPLIT_COPY.pdfFirstPage);

    act(() => {
      result.current.onSplitAsApartments?.();
    });

    await waitFor(() => {
      expect(uploadedTo).toHaveLength(2);
    });
    expect(pageIndexes).toEqual([0, 0]);
    expect(result.current.apartments?.rows.map((row) => row.note)).toEqual([firstPageNote(3), firstPageNote(3)]);
    expect(harness.navigations).toEqual([]);
  });

  it('"Các căn hộ riêng": mỗi tệp một dự án, tải vào đúng dự án đó, rồi mở được', async () => {
    const { created, harness, options, uploadedTo } = splitHarness();
    const { result } = await ready(options);

    act(() => {
      result.current.onFilesDropped([makeFile('can-ho-a.png'), makeFile('can-ho-b.png')]);
    });
    act(() => {
      result.current.onSplitAsApartments?.();
    });

    expect(result.current.splitPrompt).toBeNull();
    await waitFor(() => {
      expect(uploadedTo).toHaveLength(2);
    });
    expect([...created].sort()).toEqual(['can-ho-a', 'can-ho-b']);
    expect([...uploadedTo].sort((first, second) => first.fileName.localeCompare(second.fileName))).toEqual([
      { fileName: 'can-ho-a.png', projectId: 'p-can-ho-a', floorId: 'f-can-ho-a' },
      { fileName: 'can-ho-b.png', projectId: 'p-can-ho-b', floorId: 'f-can-ho-b' },
    ]);
    // Không tệp nào rơi vào tầng hay khay của dự án đang mở.
    expect(result.current.tray.items).toHaveLength(0);

    act(() => {
      harness.uploads.get('can-ho-a.png')?.finish({ status: 'done', percent: 100 });
    });

    const rowOf = (name: string) => result.current.apartments?.rows.find((row) => row.fileName === name);

    await waitFor(() => {
      expect(rowOf('can-ho-a.png')?.statusLabel).toBe('Đã tải bản vẽ');
    });
    expect(rowOf('can-ho-a.png')?.canOpen).toBe(true);
    expect(rowOf('can-ho-b.png')?.canOpen).toBe(false);
    expect(result.current.apartments?.summary).toContain('1 / 2');

    act(() => {
      result.current.onOpenApartment?.(rowOf('can-ho-a.png')?.id ?? '');
    });
    expect(harness.navigations).toEqual([ROUTES.project.pipeline('p-can-ho-a')]);
  });

  it('tạo dự án hỏng: hàng nêu lỗi, không tải tệp', async () => {
    const { options, uploadedTo } = splitHarness();
    const failing: FloorUploadGateway = {
      ...options.gateway,
      createApartmentProject: async () => ({
        ok: false,
        error: { kind: 'http', raw: {}, requestId: 'req-k19', retryable: true, status: 500 } satisfies HttpError,
      }),
    };
    const { result } = await ready({ ...options, gateway: failing });

    act(() => {
      result.current.onFilesDropped([makeFile('can-ho-a.png'), makeFile('can-ho-b.png')]);
    });
    act(() => {
      result.current.onSplitAsApartments?.();
    });

    await waitFor(() => {
      expect(result.current.apartments?.rows.every((row) => row.statusVariant === 'violation')).toBe(true);
    });
    expect(result.current.apartments?.rows[0]?.problem).not.toBeNull();
    expect(uploadedTo).toEqual([]);
  });
});

/* BUG-532: four inits flew at once; the gateway now runs uploads through the MAX_PARALLEL_UPLOADS pool. */
describe('floorUploadGateway — trần ba lượt tải song song (BUG-532)', () => {
  it('bốn tệp: chỉ ba lượt init bay cùng lúc', async () => {
    const base = createMockApiClient();
    const initUpload = vi.fn(() => new Promise<never>(() => undefined));
    const gateway = createFloorUploadGateway({ ...base, drawings: { ...base.drawings, initUpload } });

    for (const name of ['a.png', 'b.png', 'c.png', 'd.png']) {
      void gateway
        .createUpload({ file: makeFile(name), floorId: 'L1', projectId: PROJECT_ID, onProgress: () => undefined })
        .start();
    }

    await waitFor(() => {
      expect(initUpload).toHaveBeenCalledTimes(3);
    });
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(initUpload).toHaveBeenCalledTimes(3);
  });
});

/* -------------------------------------------------------------------------- */
/* UX41 — kịch bản người dùng 30/10 (U03, U28, U29, U30, U53, U55, P01).        */
/* -------------------------------------------------------------------------- */

describe('useFloorUploadScreen — UX41 tải bản vẽ', () => {
  const ready = async (options: UseFloorUploadScreenOptions) => {
    const view = renderScreen(options);

    await waitFor(() => {
      expect(view.result.current.floors.length).toBeGreaterThan(0);
    });

    return view;
  };

  const fileError = (code: string) => ({
    kind: 'validation' as const,
    code,
    messageKey: 'errors.validation.description',
    params: {},
    requestId: 'r-422',
    retryable: false,
    severity: 'lỗi' as const,
    recovery: 'không' as const,
  });

  it('UX-51: thay bản vẽ của tầng đã có kết quả thì hỏi lại một lần, bấm lần hai mới xử lý', async () => {
    // Bộ mẫu: `Tầng 1` (L1) đã có bản vẽ trên máy chủ.
    const harness = createHarness();
    const { result } = await ready(harness.options);

    act(() => {
      result.current.onFilesForFloor?.('L1', [makeFile('ch-05.png')]);
    });
    await waitFor(() => {
      expect(harness.uploads.size).toBe(1);
    });
    act(() => {
      for (const upload of harness.uploads.values()) upload.finish({ percent: 100, status: 'done' });
    });
    await waitFor(() => {
      expect(result.current.footer.canSubmit).toBe(true);
    });

    act(() => {
      result.current.onSubmit();
    });
    expect(harness.navigations).toHaveLength(0);
    expect(result.current.blockNotice?.reasons.map((reason) => reason.kind)).toEqual(['replacesDrawing']);
    expect(result.current.blockNotice?.reasons[0]?.sentence).toContain('vẫn được giữ');

    act(() => {
      result.current.onSubmit();
    });
    expect(harness.navigations).toEqual([ROUTES.project.pipeline(PROJECT_ID)]);
  });

  it('U03: tầng trống không chặn khi tầng khác đã có bản vẽ; khung điều kiện nêu tên tầng bỏ qua', async () => {
    // Bộ mẫu: chỉ `Tầng 1` có bản vẽ trên máy chủ.
    const harness = createHarness();
    const { result } = await ready(harness.options);

    expect(result.current.footer.blockReasons.filter((reason) => reason.kind === 'missingFile')).toEqual([]);
    expect(result.current.footer.skippedFloorNames).toEqual(['Tầng hầm', 'Tầng 2', 'Tầng 3']);
    expect(result.current.footer.canSubmit).toBe(true);

    // Tầng 1 đã có bản vẽ: lần bấm đầu chỉ hỏi lại (xử lý lại mất việc đã duyệt), lần hai mới đi.
    act(() => {
      result.current.onSubmit();
    });
    expect(harness.navigations).toHaveLength(0);

    act(() => {
      result.current.onSubmit();
    });

    expect(harness.navigations).toHaveLength(1);
  });

  it('U28: chọn đúng một tệp không đoán được tầng thì tệp vào tầng trống đầu tiên, kèm lời nhắc', async () => {
    const harness = createHarness();
    const { result } = await ready(harness.options);

    act(() => {
      result.current.onFilesChosen([makeFile('ch-04.jpg', 16, 'image/jpeg')]);
    });

    await waitFor(() => {
      expect(result.current.floors[0]?.file?.name).toBe('ch-04.jpg');
    });

    expect(result.current.floors[0]?.isAutoMatched).toBe(true);
    expect(result.current.tray.items).toHaveLength(0);
  });

  it('U53: dự án một tầng không bắt xác nhận ghép tầng', async () => {
    const real = createFloorUploadGateway(createMockApiClient());
    const harness = createHarness({
      readFloors: async (input) => {
        const read = await real.readFloors(input);
        return read.ok
          ? { ok: true, data: read.data.slice(0, 1).map((floor) => ({ ...floor, drawings: [] })) }
          : read;
      },
    });
    const { result } = await ready(harness.options);

    act(() => {
      result.current.onFilesChosen([makeFile('ch-05.jpg', 16, 'image/jpeg')]);
    });

    await waitFor(() => {
      expect(result.current.floors[0]?.file?.name).toBe('ch-05.jpg');
    });

    expect(result.current.floors[0]?.isAutoMatched).toBe(false);
    expect(result.current.floors[0]?.autoMatchHint).toBeNull();
  });

  it('U29: mã lỗi tệp của máy chủ thành câu riêng, không phải câu chung "các trường được đánh dấu"', () => {
    const gateway = createFloorUploadGateway(createMockApiClient());
    const describe422 = (code: string) =>
      gateway.describeUploadFailure({
        stage: 'complete',
        chunkIndex: null,
        attempts: 1,
        terminal: true,
        error: fileError(code),
      });

    expect(describe422('PDF_ENCRYPTED').sentence).toContain('mật khẩu');
    expect(describe422('FILE_TYPE_MISMATCH').sentence).toContain('không khớp đuôi tệp');
    expect(describe422('PDF_ENCRYPTED').isRetryable).toBe(false);
    expect(describe422('PDF_ENCRYPTED').sentence).not.toContain('trường được đánh dấu');
  });

  it('U30: tệp mới hỏng hẳn trên tầng đã có bản vẽ thì tầng giữ bản cũ, lỗi theo tệp về khay', async () => {
    const harness = createHarness();
    const { result } = await ready(harness.options);

    act(() => {
      result.current.onFilesForFloor?.('L1', [makeFile('bang-tinh-doi-duoi.png')]);
    });

    await waitFor(() => {
      expect(harness.uploads.size).toBe(1);
    });

    act(() => {
      [...harness.uploads.values()][0]?.finish({
        percent: 0,
        status: 'failed',
        failure: { stage: 'complete', chunkIndex: null, attempts: 1, terminal: true, error: fileError('FILE_TYPE_MISMATCH') },
      });
    });

    await waitFor(() => {
      expect(result.current.tray.items).toHaveLength(1);
    });

    const ground = result.current.floors.find((row) => row.floorId === 'L1');

    expect(ground?.status).toBe('attached');
    expect(ground?.error).toBeNull();
    expect(result.current.tray.items[0]?.name).toBe('bang-tinh-doi-duoi.png');
    expect(result.current.tray.items[0]?.error?.sentence).toContain('không khớp đuôi tệp');
  });

  it('U21/U29: tệp hỏng trên tầng trống nói "bị lỗi"; chọn tệp khác cho tầng thì tệp mới thay tệp hỏng', async () => {
    const harness = createHarness(withoutServerDrawings());
    const { result } = await ready(harness.options);

    act(() => {
      result.current.onFilesDropped([makeFile('mat-bang-tang-3.png')]);
    });

    await waitFor(() => {
      expect(harness.uploads.size).toBe(1);
    });

    act(() => {
      [...harness.uploads.values()][0]?.finish({
        percent: 0,
        status: 'failed',
        failure: { stage: 'complete', chunkIndex: null, attempts: 1, terminal: true, error: fileError('FILE_TYPE_MISMATCH') },
      });
    });

    await waitFor(() => {
      expect(result.current.floors[3]?.status).toBe('error');
    });

    const floorId = result.current.floors[3]?.floorId ?? '';

    expect(result.current.footer.blockReasons.some((reason) => reason.sentence.includes('bị lỗi. Hãy chọn tệp khác.'))).toBe(true);

    act(() => {
      result.current.onFilesForFloor?.(floorId, [makeFile('ch-05.jpg')]);
    });

    await waitFor(() => {
      expect(result.current.floors[3]?.file?.name).toBe('ch-05.jpg');
    });

    expect(result.current.floors[3]?.status).not.toBe('error');
  });

  it('U55: tệp quá dung lượng nói cách làm nhỏ', async () => {
    const harness = createHarness({
      validateFile: async () => ({
        ok: false,
        reason: { kind: 'tooLarge', sizeBytes: 105 * 1024 * 1024, maxSizeBytes: MAX_UPLOAD_FILE_SIZE_BYTES },
      }),
    });
    const { result } = await ready(harness.options);

    act(() => {
      result.current.onFilesDropped([makeFile('qua-nang.png')]);
    });

    await waitFor(() => {
      expect(result.current.tray.items[0]?.error?.sentence).toContain('giảm độ phân giải');
    });
  });

  it('P01: thả lại đúng tệp đã có thì không thêm bản thứ hai và báo trùng', async () => {
    const harness = createHarness();
    const { result } = await ready(harness.options);

    act(() => {
      result.current.onFilesDropped([makeFile('mat-bang-tang-2.png')]);
    });
    await waitFor(() => {
      expect(result.current.floors[2]?.file?.name).toBe('mat-bang-tang-2.png');
    });

    act(() => {
      result.current.onFilesDropped([makeFile('mat-bang-tang-2.png')]);
    });

    expect(harness.toasts.map((toast) => toast.message)).toContain(
      'mat-bang-tang-2.png đã có trong danh sách; bỏ qua bản trùng.',
    );
    expect(result.current.tray.items).toHaveLength(0);
    expect(harness.uploads.size).toBe(1);
  });

  it('P01: chọn tầng trong khay báo trước tầng nào sẽ bị thay bản vẽ', async () => {
    const harness = createHarness();
    const { result } = await ready(harness.options);

    act(() => {
      result.current.onFilesDropped([makeFile('A-101.png'), makeFile('A-102.png')]);
    });

    await waitFor(() => {
      expect(result.current.tray.items[0]?.assignOptions).toHaveLength(4);
    });

    const labels = result.current.tray.items[0]?.assignOptions.map((option) => option.label);

    expect(labels).toContain('Tầng 1 (thay bản vẽ đang có)');
    expect(labels).toContain('Tầng 2');
  });

  it('P01: tệp giống hệt bản vẽ đang dùng (SHA-256) thì báo và không tự thay tầng đó', async () => {
    const file = makeFile('mat-bang-tang-1.png');
    const sha256 = await hashBlobSha256Hex(file);
    const real = createFloorUploadGateway(createMockApiClient());
    const harness = createHarness({
      readFloors: async (input) => {
        const read = await real.readFloors(input);
        return read.ok
          ? {
              ok: true,
              data: read.data.map((floor) => ({
                ...floor,
                drawings: floor.drawings.map((drawing) => ({ ...drawing, contentSha256: sha256 })),
              })),
            }
          : read;
      },
    });
    const { result } = await ready(harness.options);

    act(() => {
      result.current.onFilesDropped([file]);
    });

    await waitFor(() => {
      expect(
        harness.toasts.some((toast) => toast.message.startsWith('Tệp này giống hệt bản vẽ đang dùng của Tầng')),
      ).toBe(true);
    });
    expect(harness.uploads.size).toBe(0);
  });
});
