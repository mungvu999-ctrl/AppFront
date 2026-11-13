/**
 * Nửa "suy nghĩ" của màn Hiệu chỉnh tỷ lệ, kiểm không cần DOM của màn.
 *
 * Hook được lái qua `renderHook`, và tầng dữ liệu là `createMockApiClient()` của
 * `src/api/__mocks__/client.ts` — cùng phép ánh xạ bản sản phẩm dùng, nên test
 * không dựng một ý niệm thứ hai về hình dạng câu trả lời (R-70). Đồ thị trong
 * store là bộ mẫu chuẩn của A14 (`createCleanBuildingScenario`), và các chuỗi
 * kích thước được dựng từ chính 34 `Dimension` của bộ mẫu đó — không có bảng dữ
 * liệu thứ hai bịa tại chỗ.
 *
 * Ba con số duy nhất viết ra ở đây — `400 px`, `4.800 mm`, `250 mm/px` — là
 * chính ví dụ đặc tả nêu, và cũng là ví dụ `domain/units/__tests__/scale.test.ts`
 * đang kiểm. Chúng đi vào `createScale`; không phép chia nào xảy ra trong file
 * này, kể cả để dựng dữ liệu: tỉ lệ `0..1` của một đoạn 400 px trên khung ảnh do
 * chính một `Scale` của M-02 tính ra.
 */

import { createElement, type ReactNode } from 'react';
import { QueryClientProvider } from '@tanstack/react-query';
import { act, cleanup, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi, type MockInstance } from 'vitest';

import { __resetMockLayerState, createMockApiClient, simulateProvisionalScale } from '@/api/__mocks__/client';
import type { ApiClient, SpatialApi } from '@/api/client';
import { createSampleBuilding, sampleLevelId } from '@/domain/spatial/__fixtures__/sampleBuilding';
import { normalizeSpatial } from '@/domain/spatial/normalize';
import type { LevelId } from '@/domain/spatial/types';
import { __resetFloorLayerSavers, flushAutosaves } from '@/hooks/useAutosave';
import { spatialLayerOf } from '@/lib/autosave/spatialLayerSave';
import type { HttpError } from '@/lib/http/types';
import { readWireError } from '@/lib/errors/wireError';
import { PROJECT_NOT_FOUND_TITLE } from '@/components/feedback/ProjectSpatialGate';
import {
  createScale,
  millimetresPerPixel,
  pixels,
  SCALE_THRESHOLDS,
  type MillimetresPerPixel,
  type Pixels,
  type Scale,
} from '@/domain/units/scale';
import { millimetres } from '@/domain/units/types';
import { RETRY_SCHEDULE_MS } from '@/lib/autosave/retrySchedule';
// Nạp tĩnh các module còn lại mà ống lưu theo tầng `import()` lười (`useAutosave.ts`; `spatialLayerSave`
// đã nhập ở trên), để `settleAsync` chỉ cần chờ chúng một lần.
import '@/lib/query/invalidation';
import { queryKeys } from '@/lib/query/queryKeys';
import '@/api/appClient';
import { formatLength } from '@/lib/format/measure';
import { formatNumber } from '@/lib/format/number';
import { MISSING_SCALE_MESSAGE } from '@/lib/viewmodel/provisionalScale';
import { createCleanBuildingScenario } from '@/lib/testing/fixtures';
import { createTestQueryClient } from '@/lib/testing/render';
import { installFakeClock, type FakeClock } from '@/lib/testing/fakeClock';
import { expectSentenceCaseStrings } from '@/lib/testing/expectSentenceCase';
import { SEVEN_STATES } from '@/lib/testing/sevenStateScenarios';
import { appNotificationBus } from '@/hooks/useNotifications';
import type { Notification } from '@/lib/mutations/notificationBus';
import { appShortcutRegistry, registerGlobalShortcuts } from '@/lib/input/shortcutRegistry';
import { useStore } from '@/store';
import { commit } from '@/store/commit';
import type { ProjectRole } from '@/types/project';

import {
  createScaleCalibrationGateway,
  withScaleCapabilities,
  type ScaleCalibrationGateway,
  type ScaleDrawingSnapshot,
  type ScaleRawDimensionString,
  type ScaleRawSnapTarget,
} from './scaleCalibrationGateway';
import { __resetScaleRatioMarks, useScaleCalibration, writeSavedSegment } from './useScaleCalibration';

/* K34: thiết lập "căn hộ riêng" của dự án; mặc định tắt như dự án chưa lưu lần nào. */
const separateUnitsFlag = vi.hoisted(() => ({ value: false }));
vi.mock('@/hooks/useSeparateUnitsFlag', () => ({
  useSeparateUnitsFlag: () => separateUnitsFlag.value,
}));
import type {
  ImageRatioPoint,
  ScaleCalibrationState,
  UseScaleCalibrationResult,
} from './types';

/* -------------------------------------------------------------------------- */
/* Ví dụ đã có sẵn trong đặc tả và trong test của domain.                       */
/* -------------------------------------------------------------------------- */

const PROJECT_ID = 'project-1';

/** Số nhịp đồng hồ giả một lượt đọc của bộ mẫu cần để về. */
const SETTLE_TURNS = 20;

/** Tầng của bộ mẫu chuẩn. Mã tầng có tiền tố `L-`, tức một `LevelId` thật. */
const FLOOR_ID = sampleLevelId(0);

/** `4.800 mm ÷ 400 px = 12 mm/px` — ví dụ của chính đặc tả. */
const REFERENCE_PIXEL_LENGTH: Pixels = pixels(400);
const REFERENCE_REAL_LENGTH = millimetres(4800);
const REFERENCE_SCALE: Scale = createScale({
  pixelLength: REFERENCE_PIXEL_LENGTH,
  realLength: REFERENCE_REAL_LENGTH,
});

/** Tỷ lệ vô lý đặc tả nêu đích danh: 250 mm/px trên nét tường 12 px là tường 3 m. */
const IMPLAUSIBLE_RATIO: MillimetresPerPixel = millimetresPerPixel(250);
const REFERENCE_WALL_WIDTH: Pixels = pixels(12);

/** Tỷ lệ tạm của pipeline cho tầng `unresolved`: đoạn 400 px dài 4.000 mm. */
const PROVISIONAL_REAL_LENGTH = millimetres(4000);
const PROVISIONAL_RATIO: MillimetresPerPixel = createScale({
  pixelLength: REFERENCE_PIXEL_LENGTH,
  realLength: PROVISIONAL_REAL_LENGTH,
}).millimetresPerPixel;

const FORBIDDEN: HttpError = {
  code: 'FORBIDDEN',
  kind: 'http',
  raw: { code: 'FORBIDDEN' },
  requestId: 'r',
  retryable: false,
  status: 403,
};

/** Ảnh mẫu để đo trên: tầng của bộ mẫu mock đã đo xong và tìm được khung bản vẽ. */
const MEASURED_MOCK_FLOOR_ID = 'L2';
/** Tầng mock mà máy KHÔNG tìm được khung bản vẽ — nguồn của trạng thái `error`. */
const WARPED_MOCK_FLOOR_ID = 'L1';

/* -------------------------------------------------------------------------- */
/* Môi trường.                                                                 */
/* -------------------------------------------------------------------------- */

let clock: FakeClock;

/* jsdom không có `matchMedia`; `matches: false` là cách xếp rộng, không giảm chuyển động. */
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

  clock = installFakeClock();
  __resetFloorLayerSavers();
  __resetMockLayerState();
  __resetScaleRatioMarks();
  seedStore();
});

afterEach(() => {
  separateUnitsFlag.value = false;
  cleanup();
  __resetFloorLayerSavers();
  clock.restore();
  vi.restoreAllMocks();
});

/** Đồ thị của bộ mẫu chuẩn A14 trong store, và một ngăn xếp hoàn tác sạch. */
function seedStore(): void {
  const scenario = createCleanBuildingScenario();
  const graph = normalizeSpatial(scenario.graph);

  // Cùng dự án với màn: `useFloorLayer` thấy kho đã có tầng, không nạp đè.
  useStore.getState().setSpatial(graph, 'version-1', {
    floorRevisions: Object.fromEntries(graph.byKind.level.map((id) => [id, 0])),
    projectId: PROJECT_ID,
  });
  useStore.temporal.getState().clear();
}

/** Tỷ lệ đang lưu trên tầng đang mở, đọc thẳng từ store. */
function storedRatio(): number | undefined {
  const entity = useStore.getState().spatial?.byId[FLOOR_ID];

  return entity !== undefined && 'scaleMillimetresPerPixel' in entity
    ? entity.scaleMillimetresPerPixel
    : undefined;
}

/**
 * Một con số viết ra như người dùng gõ nó.
 *
 * Dấu thập phân tiếng Việt là dấu PHẨY, nên `String(15.6)` là `"15.6"` và
 * `parseLength` đọc dấu chấm đó thành dấu phân nhóm hàng nghìn. `formatNumber`
 * là chiều thuận của chính `parseLength`, nên nó là cách đúng để gõ một số vào
 * ô nhập — kể cả trong test.
 */
function typedNumber(value: number): string {
  return formatNumber(value, { grouping: false });
}

/* -------------------------------------------------------------------------- */
/* Bộ dựng cổng.                                                               */
/* -------------------------------------------------------------------------- */

/**
 * Ảnh nền của một tầng, đọc từ chính bộ mẫu của `createMockApiClient()`.
 *
 * Mã tầng bị đổi sang mã của bộ mẫu chuẩn A14 vì store giữ đồ thị của bộ mẫu
 * đó: hai bộ dữ liệu đã có, và test nối chúng lại chứ không dựng bộ thứ ba.
 */
async function readMockDrawing(
  client: ApiClient,
  sourceFloorId: string,
): Promise<ScaleDrawingSnapshot> {
  const result = await client.quality.assess({ floorId: sourceFloorId, projectId: PROJECT_ID });

  if (!result.ok) {
    throw new Error('Không đọc được lượt đo chất lượng của bộ mẫu.');
  }

  const floor = result.data.floors.find((entry) => entry.floorId === sourceFloorId);

  if (floor === undefined || floor.measurement === undefined) {
    throw new Error(`Bộ mẫu không có tầng đã đo nào mang mã ${sourceFloorId}.`);
  }

  return {
    floorId: FLOOR_ID,
    floorName: floor.floorName,
    imageUrl: floor.sourceUrl,
    widthPx: pixels(floor.measurement.widthPx),
    heightPx: pixels(floor.measurement.heightPx),
    isWarped: floor.frame !== undefined && !floor.frame.isFound,
  };
}

/**
 * 34 chuỗi kích thước, dựng từ 34 `Dimension` của bộ mẫu chuẩn.
 *
 * Chiều dài pixel của mỗi hàng do `REFERENCE_SCALE` quy đổi từ chính giá trị
 * mi-li-mét của bộ mẫu — nên mọi hàng cùng nói một tỷ lệ 12 mm/px, và
 * `inferScale` phải suy ra đúng con số đó. Không phép chia nào ở đây: `Scale`
 * làm việc đó.
 */
function sampleDimensionRows(lowConfidenceCount = 0): readonly ScaleRawDimensionString[] {
  const graph = createSampleBuilding();

  return graph.dimensions.map((dimension, index) => {
    const realLength = millimetres(dimension.valueMm);

    return {
    id: dimension.id,
    realLength,
    pixelLength: REFERENCE_SCALE.millimetresToPixels(realLength),
    confidence:
      index < lowConfidenceCount ? SCALE_THRESHOLDS.minimumConfidence : dimension.confidence,
    boundingBox: {
      min: { x: 0.1, y: index * 0.02 },
      max: { x: 0.3, y: index * 0.02 + 0.01 },
    },
    };
  });
}

interface HarnessOptions {
  readonly sourceFloorId?: string;
  readonly rows?: readonly ScaleRawDimensionString[];
  readonly referenceWallWidthPx?: Pixels;
  readonly typicalDoorWidthPx?: Pixels;
  readonly snapTargets?: readonly ScaleRawSnapTarget[];
  /** Thay khổ ảnh của bộ mẫu — ảnh không vuông có dải trống trong khung vuông. */
  readonly drawingSize?: { readonly widthPx: Pixels; readonly heightPx: Pixels };
}

interface Harness {
  readonly gateway: ScaleCalibrationGateway;
  /** PUT #35 của bộ lưu lớp chung — mặc định nhận, trả lớp hiện tại của kho. */
  readonly writeLayer: MockInstance<SpatialApi['writeLayer']>;
}

type WriteResult = Awaited<ReturnType<SpatialApi['writeLayer']>>;

/** Phản hồi #35 thành công: lớp của tầng như kho đang giữ, `revision` cho sẵn. */
function savedLayer(floorId: string, revision: number): WriteResult {
  const spatial = useStore.getState().spatial;
  const layer =
    spatial === null
      ? { furniture: [], openings: [], rooms: [], walls: [] }
      : spatialLayerOf(spatial, floorId as LevelId);

  return { data: { layer, revision }, ok: true };
}

function deferredWrite(): { promise: Promise<WriteResult>; resolve: (value: WriteResult) => void } {
  let resolve: (value: WriteResult) => void = () => undefined;
  const promise = new Promise<WriteResult>((settleWith) => {
    resolve = settleWith;
  });

  return { promise, resolve };
}

/**
 * Cổng của bộ mẫu với đúng những việc đang kiểm được thay.
 *
 * Cùng lý lẽ `makeScriptedClient` của `useProcessingScreen.test.ts`: chỉ thứ
 * đang kiểm mới bị thay, phần còn lại vẫn là cổng thật chạy trên bộ mẫu.
 */
async function makeHarness(options: HarnessOptions = {}): Promise<Harness> {
  const client = createMockApiClient();
  const base = createScaleCalibrationGateway(client, { now: () => clock.epochMs() });
  const drawing = await readMockDrawing(client, options.sourceFloorId ?? MEASURED_MOCK_FLOOR_ID);
  const writeLayer = vi
    .spyOn(client.spatial, 'writeLayer')
    .mockImplementation(async (input) => savedLayer(input.floorId, input.baseVersion + 1));

  const gateway = withScaleCapabilities(base, {
    supports: {
      dimensionStrings: options.rows !== undefined,
      referenceWallWidth: options.referenceWallWidthPx !== undefined,
    },
    readFloorDrawing: async () => ({ ok: true, data: { ...drawing, ...options.drawingSize } }),
    readDimensionStrings: async () =>
      options.rows === undefined
        ? base.readDimensionStrings({ floorId: FLOOR_ID, projectId: PROJECT_ID })
        : { supported: true, value: options.rows },
    readReferenceWallWidth: async () =>
      options.referenceWallWidthPx === undefined
        ? base.readReferenceWallWidth({ floorId: FLOOR_ID, projectId: PROJECT_ID })
        : { supported: true, value: options.referenceWallWidthPx },
    ...(options.typicalDoorWidthPx === undefined
      ? {}
      : { readTypicalDoorWidth: async () => ({ supported: true as const, value: options.typicalDoorWidthPx ?? pixels(0) }) }),
    ...(options.snapTargets === undefined
      ? {}
      : { readSnapTargets: async () => ({ supported: true as const, value: options.snapTargets ?? [] }) }),
  });

  return { gateway, writeLayer };
}

/* -------------------------------------------------------------------------- */
/* Dựng hook.                                                                  */
/* -------------------------------------------------------------------------- */

interface MountOptions {
  readonly roles?: readonly ProjectRole[];
  readonly forceCollapsed?: boolean;
  readonly queryClient?: ReturnType<typeof createTestQueryClient>;
}

interface Mounted {
  readonly result: { current: UseScaleCalibrationResult };
  readonly unmount: () => void;
}

function mountHook(gateway: ScaleCalibrationGateway, options: MountOptions = {}): Mounted {
  const queryClient = options.queryClient ?? createTestQueryClient();
  const wrapper = ({ children }: { children: ReactNode }): ReactNode =>
    createElement(QueryClientProvider, { client: queryClient }, children);

  const rendered = renderHook(
    () =>
      useScaleCalibration({
        projectId: PROJECT_ID,
        floorId: FLOOR_ID,
        gateway,
        ...(options.roles !== undefined ? { roles: options.roles } : {}),
        ...(options.forceCollapsed !== undefined ? { forceCollapsed: options.forceCollapsed } : {}),
      }),
    { wrapper },
  );

  return { result: rendered.result, unmount: rendered.unmount };
}

/**
 * Chờ lượt đọc đầu tiên về.
 *
 * Đồng hồ ở đây là đồng hồ giả, nên `waitFor` — vốn chờ bằng đồng hồ thật —
 * sẽ đứng im mãi mãi. Cách chờ đúng dưới đồng hồ giả là tự đẩy thời gian.
 */
async function settle(mounted: Mounted): Promise<void> {
  for (let turn = 0; turn < SETTLE_TURNS; turn += 1) {
    if (mounted.result.current.model.state !== 'loading') {
      return;
    }

    await act(async () => {
      await clock.advance(1);
    });
  }

  expect(mounted.result.current.model.state).not.toBe('loading');
}

/** Kéo một đoạn dài đúng `REFERENCE_PIXEL_LENGTH` theo phương ngang. */
async function dragReferenceLine(mounted: Mounted): Promise<void> {
  const drawingWidthPx = pixels(
    (useStore.getState().spatial === null ? 0 : 0) + imageWidthPxOf(mounted),
  );
  const frame = createScale({ pixelLength: drawingWidthPx, realLength: millimetres(1) });
  const start: ImageRatioPoint = { x: 0, y: 0 };
  const end: ImageRatioPoint = {
    x: frame.pixelsToMillimetres(REFERENCE_PIXEL_LENGTH),
    y: 0,
  };

  await act(async () => {
    mounted.result.current.actions.onStartDrag(start);
  });
  await act(async () => {
    mounted.result.current.actions.onMoveDrag(end, { isAxisLocked: false });
  });
  await act(async () => {
    mounted.result.current.actions.onEndDrag(end);
  });
}

/** Kéo đoạn 400 px và gõ chiều dài thật — đủ để có tỉ lệ đề nghị. */
async function typeReference(mounted: Mounted, length = REFERENCE_REAL_LENGTH): Promise<void> {
  await dragReferenceLine(mounted);
  await act(async () => {
    mounted.result.current.actions.onChangeRealLength(typedNumber(length));
  });
}

/**
 * Chờ `import()` lười của bộ lưu MỘT lần, rồi đẩy đồng hồ giả cho tới khi lượt gửi về.
 *
 * `vi.dynamicImportSettled()` đắt — mỗi lần quét cả bộ đệm module và chờ một nhịp hẹn giờ THẬT.
 * Gọi nó trong từng nhịp (20 × mỗi lượt chờ, ~1,4 s mỗi bài lúc máy rảnh) là thứ đẩy các bài P2-4
 * quá 5 000 ms khi máy tải nặng (QA-01c nợ #12). Các module nó chờ đã được nạp tĩnh ở đầu tệp, nên
 * một lần là đủ; phần còn lại chỉ là đồng hồ giả.
 */
async function settleAsync(): Promise<void> {
  await act(async () => {
    await vi.dynamicImportSettled();
  });

  for (let turn = 0; turn < SETTLE_TURNS; turn += 1) {
    await act(async () => {
      await clock.advance(1);
    });
  }
}

async function applyNow(mounted: Mounted): Promise<void> {
  await act(async () => {
    mounted.result.current.actions.onApply();
  });
  await settleAsync();

  // U22/U34: cỡ căn vô lý thì lần Xác nhận đầu chỉ cảnh báo, lần hai mới lưu. Tầng mẫu của bộ giả có tường
  // tính bằng mm nên mọi tỷ lệ thử ở đây đều ra cỡ căn vô lý; test lưu cần xác nhận lần nữa.
  if (mounted.result.current.model.panel.applyBlockedNotice?.startsWith('Cỡ căn trông vô lý') === true) {
    await act(async () => {
      mounted.result.current.actions.onApply();
    });
    await settleAsync();
  }
}

/**
 * Bề rộng ảnh, đọc ngược từ chính hook.
 *
 * Toạ độ `1` trên khung ảnh là mép phải, nên toạ độ con trỏ mà thanh trạng thái
 * báo cho điểm đó chính là bề rộng ảnh tính bằng pixel — không phải một con số
 * test tự giữ, mà là con số hook đang dùng.
 */
function imageWidthPxOf(mounted: Mounted): number {
  act(() => {
    mounted.result.current.actions.onMoveCursor({ x: 1, y: 1 });
  });

  return mounted.result.current.model.statusBar.x;
}

/* -------------------------------------------------------------------------- */
/* Kiểm.                                                                       */
/* -------------------------------------------------------------------------- */

// UX-49: đoạn đo giữ ở localStorage — không để lượt trước rò sang lượt sau.
afterEach(() => {
  window.localStorage.clear();
});

describe('useScaleCalibration — giữ đoạn đo đã xác nhận (UX-49)', () => {
  it('mở lại màn Tỷ lệ: đoạn đo cũ hiện lại, chỉ cần nhập số', async () => {
    writeSavedSegment(FLOOR_ID, { start: { x: 0.2, y: 0.4 }, end: { x: 0.6, y: 0.4 } } as never);
    const harness = await makeHarness();
    const mounted = mountHook(harness.gateway);
    await settle(mounted);
    await settleAsync();

    expect(mounted.result.current.model.panel.method).toBe('referenceLine');
    expect(mounted.result.current.model.panel.reference.draft).not.toBeNull();
  });
});

describe('useScaleCalibration — tỷ lệ do M-02 tính', () => {
  it('G25: ảnh nền của màn QC (hình khác) trong đệm không làm canvas trắng khi vào bằng SPA', async () => {
    const harness = await makeHarness();
    const queryClient = createTestQueryClient();
    queryClient.setQueryData(queryKeys.drawing.byFloor(FLOOR_ID), {
      imageUrl: 'qc-background.png',
      imageAlt: 'Bản vẽ gốc',
      widthMm: 1000,
      heightMm: 1000,
    });
    const mounted = mountHook(harness.gateway, { queryClient });
    await settle(mounted);

    expect(mounted.result.current.model.canvas.imageUrl).not.toBeNull();
    expect(mounted.result.current.model.canvas.imageUrl).not.toBe('qc-background.png');
  });

  it('14-C-019: tỷ lệ rất nhỏ (0,1 mm trên 400 px) không bị làm tròn thành "0 mm/px" hay "1:0"', async () => {
    const harness = await makeHarness();
    const mounted = mountHook(harness.gateway);
    await settle(mounted);
    await dragReferenceLine(mounted);
    await act(async () => {
      mounted.result.current.actions.onChangeRealLength('0,1');
    });

    const { model } = mounted.result.current;

    expect(model.panel.computation.resultLabel).not.toMatch(/^0 mm\/px$/u);
    expect(model.panel.computation.resultLabel).toMatch(/[1-9]/u);
    expect(model.statusBar.scaleDensity).not.toMatch(/^0 mm\/px$/u);
    expect(model.statusBar.scaleRatio).not.toBe('1:0');
  });

  it('kéo đoạn 400 px rồi nhập 4800 mm cho ra 12 mm/px, và hiện đủ phép tính', async () => {
    const harness = await makeHarness();
    const mounted = mountHook(harness.gateway);
    await settle(mounted);
    await dragReferenceLine(mounted);

    await act(async () => {
      mounted.result.current.actions.onChangeRealLength('4800');
    });

    const { computation } = mounted.result.current.model.panel;

    expect(computation.numeratorLabel).toBe('4.800 mm');
    expect(computation.denominatorLabel).toBe('400 px');
    expect(computation.resultLabel).toBe('12 mm/px');
    expect(computation.isComplete).toBe(true);
    expect(mounted.result.current.model.panel.canApply).toBe(true);
  });

  it('chưa nhập chiều dài thì vế thiếu vẫn có chỗ đứng, và phép tính chưa đủ', async () => {
    const harness = await makeHarness();
    const mounted = mountHook(harness.gateway);
    await settle(mounted);
    await dragReferenceLine(mounted);

    const { computation } = mounted.result.current.model.panel;

    expect(computation.denominatorLabel).toBe('400 px');
    expect(computation.numeratorLabel).toBe('—');
    expect(computation.resultLabel).toBe('—');
    expect(computation.isComplete).toBe(false);
  });

  it('chiều dài gõ sai ("abc", "0") hiện lỗi nhập; ô trống hay số hợp lệ thì không (BUG-342)', async () => {
    const harness = await makeHarness();
    const mounted = mountHook(harness.gateway);
    await settle(mounted);
    await dragReferenceLine(mounted);

    const errorOf = (): string | null => mounted.result.current.model.panel.reference.realLengthError;

    expect(errorOf()).toBeNull();

    for (const text of ['abc', '0']) {
      await act(async () => {
        mounted.result.current.actions.onChangeRealLength(text);
      });
      expect(errorOf()).toBe('Chiều dài thật phải là một số lớn hơn 0, ví dụ 4800.');
    }

    await act(async () => {
      mounted.result.current.actions.onChangeRealLength('4800');
    });
    expect(errorOf()).toBeNull();
  });

  it('suy ra tỷ lệ của bộ mẫu từ 34 chuỗi kích thước qua inferScale', async () => {
    const harness = await makeHarness({ rows: sampleDimensionRows() });
    const mounted = mountHook(harness.gateway);
    await settle(mounted);

    const inference = mounted.result.current.aiInference;

    expect(inference).not.toBeNull();
    expect(inference?.suggestedMillimetresPerPixel).toBeCloseTo(
      REFERENCE_SCALE.millimetresPerPixel,
      6,
    );
  });
});

describe('useScaleCalibration — áp dụng: PUT trước, commit sau (F-04x-2 bước 5)', () => {
  it('áp → PUT chỉ tỉ lệ trước; kho đổi tỉ lệ CHỈ sau khi máy chủ nhận; success màu verified', async () => {
    const harness = await makeHarness();
    const pending = deferredWrite();

    harness.writeLayer.mockReturnValueOnce(pending.promise);
    const mounted = mountHook(harness.gateway);
    await settle(mounted);
    await typeReference(mounted);

    await act(async () => {
      mounted.result.current.actions.onApply();
    });
    await settleAsync();

    expect(harness.writeLayer).toHaveBeenCalledTimes(1);
    expect(harness.writeLayer.mock.calls[0]?.[0].body).toEqual({
      scaleMillimetresPerPixel: REFERENCE_SCALE.millimetresPerPixel,
    });
    expect(storedRatio()).toBeUndefined();
    expect(mounted.result.current.model.panel.isApplying).toBe(true);
    expect(mounted.result.current.model.state).not.toBe('success');

    pending.resolve(savedLayer(FLOOR_ID, 1));
    await settleAsync();

    expect(storedRatio()).toBeCloseTo(REFERENCE_SCALE.millimetresPerPixel, 6);
    expect(mounted.result.current.model.state).toBe('success');
    expect(mounted.result.current.model.panel.statusCode).toBe('verified');
    expect(mounted.result.current.model.panel.isApplying).toBe(false);
    expect(mounted.result.current.appliedScale?.pixelsToMillimetres(REFERENCE_PIXEL_LENGTH)).toBeCloseTo(
      REFERENCE_REAL_LENGTH,
      6,
    );
  });

  it('bản vẽ không tìm thấy khung (isWarped): áp xong vẫn ra success, không kẹt ở error (BUG-567)', async () => {
    const harness = await makeHarness({ sourceFloorId: WARPED_MOCK_FLOOR_ID });
    const mounted = mountHook(harness.gateway);
    await settle(mounted);
    expect(mounted.result.current.model.state).toBe('error');
    await typeReference(mounted);

    await act(async () => {
      mounted.result.current.actions.onApply();
    });
    await settleAsync();

    expect(harness.writeLayer).toHaveBeenCalledTimes(1);
    expect(mounted.result.current.model.state).toBe('success');
    expect(mounted.result.current.model.successNotice).not.toBeNull();
    expect(mounted.result.current.model.errorMessage).toBeNull();
  });

  it('vẽ đường mới sau khi áp xong thì success nhường chỗ cho lời nhắc chưa đủ dữ liệu (G58, 14-09)', async () => {
    const harness = await makeHarness();
    const mounted = mountHook(harness.gateway);
    await settle(mounted);
    await typeReference(mounted);

    await act(async () => {
      mounted.result.current.actions.onApply();
    });
    await settleAsync();
    expect(mounted.result.current.model.state).toBe('success');

    await act(async () => {
      mounted.result.current.actions.onStartDrag({ x: 0.3, y: 0.3 });
    });

    expect(mounted.result.current.model.state).toBe('partial');
    expect(mounted.result.current.model.successNotice).toBeNull();
    expect(mounted.result.current.model.partialNotice).not.toBeNull();
  });

  it('PUT 422 → kho giữ tỷ lệ cũ, không success, nói lý do', async () => {
    const harness = await makeHarness();

    harness.writeLayer.mockResolvedValueOnce({
      error: { code: 'VALIDATION', kind: 'http', raw: { code: 'VALIDATION' }, requestId: 'r', retryable: false, status: 422 },
      ok: false,
    });
    const mounted = mountHook(harness.gateway);
    await settle(mounted);
    await typeReference(mounted);
    await applyNow(mounted);

    expect(harness.writeLayer).toHaveBeenCalledTimes(1);
    expect(storedRatio()).toBeUndefined();
    expect(mounted.result.current.model.state).toBe('partial');
    expect(mounted.result.current.model.panel.statusCode).not.toBe('verified');
    expect(mounted.result.current.model.panel.applyBlockedNotice).toContain('Chưa lưu được tỷ lệ lên máy chủ');
  });

  it('sửa đồ thị khác sau khi áp không sinh PUT tỉ lệ', async () => {
    const harness = await makeHarness();
    const mounted = mountHook(harness.gateway);
    await settle(mounted);
    await typeReference(mounted);
    await applyNow(mounted);

    const wall = Object.values(useStore.getState().spatial?.byId ?? {}).find(
      (entity) => 'thicknessMm' in entity && 'levelId' in entity && entity.levelId === FLOOR_ID,
    );

    await act(async () => {
      if (wall !== undefined && 'thicknessMm' in wall) {
        commit({ op: 'update', kind: 'wall', id: wall.id, changes: { thicknessMm: wall.thicknessMm + 10 } }, 'Đổi độ dày');
      }
    });
    await act(async () => {
      await clock.advance(RETRY_SCHEDULE_MS[0]);
    });
    await settleAsync();

    const scaleCalls = harness.writeLayer.mock.calls.filter(([input]) => input.body.scaleMillimetresPerPixel !== undefined);

    expect(scaleCalls).toHaveLength(1);
  });

  it('kho rỗng thì nạp tầng qua N16, và áp vào đúng mã Level N16 trả, không phải mã route (B-V5-01)', async () => {
    useStore.getState().setSpatial(null, null);
    const harness = await makeHarness();
    const otherLevel = sampleLevelId(1);
    // Route mang `FLOOR_ID`; N16 trả một tầng có mã `Level` khác — như BE thật.
    const gateway = withScaleCapabilities(harness.gateway, {
      readLayer: () => harness.gateway.readLayer({ floorId: otherLevel, projectId: PROJECT_ID }),
    });
    const mounted = mountHook(gateway);
    await settle(mounted);
    await settleAsync();
    await typeReference(mounted);
    await applyNow(mounted);

    expect(mounted.result.current.model.panel.applyBlockedNotice).toBeUndefined();
    expect(harness.writeLayer.mock.calls[0]?.[0].floorId).toBe(otherLevel);
    const level = useStore.getState().spatial?.byId[otherLevel];
    expect(level !== undefined && 'scaleMillimetresPerPixel' in level).toBe(true);
    expect(mounted.result.current.appliedScale).not.toBeNull();
  });

  it('[K18] cổng chưa đọc chuỗi kích thước: kích thước N16 thành mốc tỷ lệ, không báo "không đọc được số"', async () => {
    useStore.getState().setSpatial(null, null);
    const harness = await makeHarness();
    const real = await harness.gateway.readLayer({ floorId: FLOOR_ID, projectId: PROJECT_ID });
    const builtRatio = 10;
    // Đường 1.300 mm trên đồ thị dựng ở 10 mm/px = 130 px ảnh; số ghi 1.300 mm.
    const dimension = {
      id: 'M-001',
      levelId: real.level.id,
      kind: 'linear',
      referenceIds: [],
      line: { start: { x: 1000, y: 500 }, end: { x: 2300, y: 500 } },
      valueMm: 1300,
      confidence: 0.98,
      source: 'ai',
      reviewed: false,
    } as unknown as (typeof real.dimensions)[number];
    const gateway = withScaleCapabilities(harness.gateway, {
      readLayer: async () => ({
        ...real,
        level: { ...real.level, scaleMillimetresPerPixel: builtRatio },
        dimensions: [dimension],
      }) as typeof real,
    });
    const mounted = mountHook(gateway);
    await settle(mounted);
    await settleAsync();

    const model = mounted.result.current.model;
    expect(model.state).not.toBe('empty');
    expect(model.emptyNotice).toBeNull();
    expect(model.panel.dimension.emptyNotice).toBeNull();
    expect(model.panel.dimension.rows).toHaveLength(1);
    expect(model.panel.dimension.rows[0]?.realLength).toBe(1300);
    expect(model.panel.dimension.rows[0]?.pixelLength).toBeCloseTo(130, 6);
  });

  it('tỷ lệ máy đọc từ số đo (N16 chain, vắng scaleStatus): không dải nhắc, không ghi "Đã xác nhận"', async () => {
    useStore.getState().setSpatial(null, null);
    const harness = await makeHarness();
    const real = await harness.gateway.readLayer({ floorId: FLOOR_ID, projectId: PROJECT_ID });
    const dimension = {
      id: 'M-001',
      levelId: real.level.id,
      kind: 'linear',
      referenceIds: [],
      line: { start: { x: 1000, y: 500 }, end: { x: 2300, y: 500 } },
      valueMm: 1300,
      confidence: 0.98,
      source: 'ai',
      reviewed: false,
    } as unknown as (typeof real.dimensions)[number];
    const gateway = withScaleCapabilities(harness.gateway, {
      readLayer: async () => ({
        ...real,
        scaleBasis: 'chain',
        level: { ...real.level, scaleMillimetresPerPixel: 10 },
        dimensions: [dimension],
      }) as typeof real,
    });
    const mounted = mountHook(gateway);
    await settle(mounted);
    await settleAsync();

    const model = mounted.result.current.model;
    expect(model.state).toBe('partial');
    expect(model.partialNotice).toBeNull();
    expect(model.panel.scaleCheck?.status).toMatchObject({ label: 'Đọc từ bản vẽ', source: 'stored' });
  });

  it('kho rỗng và N16 hỏng thì bấm áp nói lý do tại chỗ, không im lặng, không PUT (B-V5-01)', async () => {
    useStore.getState().setSpatial(null, null);
    const harness = await makeHarness();
    const gateway = withScaleCapabilities(harness.gateway, {
      readLayer: () => Promise.reject(new Error('N16 hỏng')),
    });
    const mounted = mountHook(gateway);
    await settle(mounted);
    await typeReference(mounted);

    expect(mounted.result.current.model.panel.applyBlockedNotice).toBeUndefined();

    await applyNow(mounted);

    expect(harness.writeLayer).not.toHaveBeenCalled();
    expect(mounted.result.current.model.state).not.toBe('success');
    expect(mounted.result.current.model.panel.applyBlockedNotice).toBe(
      'Chưa nạp dữ liệu không gian của tầng này, nên chưa áp được tỷ lệ.',
    );
  });
});

describe('useScaleCalibration — tầng tỷ lệ tạm (scaleStatus unresolved)', () => {
  /** N16 của tầng mang tỷ lệ tạm; kho rỗng nên `useFloorLayer` nạp đúng tài liệu ấy. */
  async function mountProvisional(
    source: 'pipeline' | 'project_default' = 'pipeline',
  ): Promise<{ harness: Harness; mounted: Mounted }> {
    useStore.getState().setSpatial(null, null);
    simulateProvisionalScale(FLOOR_ID, PROVISIONAL_RATIO, source);
    const harness = await makeHarness();
    const mounted = mountHook(harness.gateway);

    await settle(mounted);
    await settleAsync();

    return { harness, mounted };
  }

  it('[K12] máy không đo được tỷ lệ (project_default): dải đỏ nói mô hình đang sai; tỷ lệ máy đo thì không', async () => {
    const missing = await mountProvisional('project_default');

    expect(missing.mounted.result.current.model.missingScaleNotice).toBe(MISSING_SCALE_MESSAGE);
    missing.mounted.unmount();

    const measured = await mountProvisional();

    expect(measured.mounted.result.current.model.missingScaleNotice).toBeUndefined();
  });

  it('[UX-R2 K05] tầng tỷ lệ máy đo có mốc: chọn sẵn mốc tốt nhất, một cú bấm Xác nhận là lưu', async () => {
    useStore.getState().setSpatial(null, null);
    simulateProvisionalScale(FLOOR_ID, PROVISIONAL_RATIO);
    const harness = await makeHarness({ rows: sampleDimensionRows() });
    const mounted = mountHook(harness.gateway);
    await settle(mounted);
    await settleAsync();

    const { model } = mounted.result.current;
    expect(model.panel.dimension.selectedRowId).not.toBeNull();
    expect(model.panel.dimension.manualCalibrationReason).toBeNull();
    expect(model.panel.canApply).toBe(true);
    // UX-02: nói số đọc được và tỷ lệ đề xuất, nút ghi rõ là tỷ lệ máy đề xuất.
    expect(model.partialNotice).toMatch(/^Máy đọc được \d+ số kích thước, tỷ lệ đề xuất 1 px = .+ mm/u);
    expect(model.panel.applyLabel).toBe('Xác nhận tỷ lệ máy đề xuất');

    await applyNow(mounted);

    expect(harness.writeLayer).toHaveBeenCalledTimes(1);
    expect(harness.writeLayer.mock.calls[0]?.[0].body.scaleMillimetresPerPixel).toBeCloseTo(
      REFERENCE_SCALE.millimetresPerPixel,
      6,
    );
  });

  it('[UX-R2] tầng chưa có tỷ lệ, N16 có tỷ lệ ước từ độ dày tường: "Dùng tỷ lệ này" đặt đề nghị, Xác nhận mới lưu', async () => {
    useStore.getState().setSpatial(null, null);
    simulateProvisionalScale(FLOOR_ID, PROVISIONAL_RATIO, 'project_default');
    const harness = await makeHarness();
    const gateway = withScaleCapabilities(harness.gateway, {
      readLayer: async (input) => ({ ...(await harness.gateway.readLayer(input)), suggestedScaleMmPerPx: 13.9 }),
    });
    const mounted = mountHook(gateway);
    await settle(mounted);
    await settleAsync();

    expect(mounted.result.current.model.missingScaleNotice).toBe(MISSING_SCALE_MESSAGE);
    expect(mounted.result.current.model.panel.suggestion).toEqual({
      text: 'Máy ước lượng từ độ dày tường: 1 px ≈ 13,9 mm.',
      actionLabel: 'Dùng tỷ lệ này',
      isActive: false,
    });

    await act(async () => {
      mounted.result.current.actions.onUseSuggestedScale();
    });

    expect(harness.writeLayer).not.toHaveBeenCalled();
    expect(mounted.result.current.model.panel.suggestion?.isActive).toBe(true);
    expect(mounted.result.current.model.panel.canApply).toBe(true);

    await applyNow(mounted);

    expect(harness.writeLayer).toHaveBeenCalledTimes(1);
    expect(harness.writeLayer.mock.calls[0]?.[0].body.scaleMillimetresPerPixel).toBeCloseTo(13.9, 6);
  });

  it('[UX41 U01] tỷ lệ tạm của pipeline, không số kích thước: chọn sẵn, một nút Xác nhận; có sourceDpi thì nhập thẳng 1:100', async () => {
    useStore.getState().setSpatial(null, null);
    simulateProvisionalScale(FLOOR_ID, PROVISIONAL_RATIO, 'pipeline');
    const harness = await makeHarness();
    const gateway = withScaleCapabilities(harness.gateway, {
      readLayer: async (input) => ({ ...(await harness.gateway.readLayer(input)), dimensions: [], sourceDpi: 150 }),
    });
    const mounted = mountHook(gateway);
    await settle(mounted);
    await settleAsync();

    expect(mounted.result.current.model.emptyNotice).toBeNull();
    expect(mounted.result.current.model.panel.canApply).toBe(true);
    expect(mounted.result.current.model.partialNotice).toMatch(
      /^Máy ước lượng sẵn 1 px ≈ .+ mm.*\. Đây chỉ là ước lượng/u,
    );
    expect(mounted.result.current.model.panel.applyLabel).toBe('Xác nhận tỷ lệ máy đề xuất');
    expect(mounted.result.current.model.panel.ratioEntry?.placeholder).toBe('1:100');

    await act(async () => {
      mounted.result.current.actions.onChangeDrawingRatio?.('1:100');
    });

    expect(mounted.result.current.model.partialNotice).toMatch(/^Tỷ lệ 1:100 ứng với 1 px ≈ /u);

    await applyNow(mounted);

    expect(harness.writeLayer).toHaveBeenCalledTimes(1);
    /* 1:100 ở 150 DPI: 100 × 25,4 / 150 mm/px. */
    expect(harness.writeLayer.mock.calls[0]?.[0].body.scaleMillimetresPerPixel).toBeCloseTo((100 * 25.4) / 150, 6);
  });

  it('[UX-02] tỷ lệ máy khớp ghi chú TL 1:50 của PDF: nói nguồn là ghi chú, một nút xác nhận', async () => {
    useStore.getState().setSpatial(null, null);
    simulateProvisionalScale(FLOOR_ID, PROVISIONAL_RATIO, 'pipeline');
    const harness = await makeHarness();
    /* DPI để PROVISIONAL_RATIO đúng bằng 1:50: 50 × 25,4 / DPI. */
    const sourceDpi = (50 * 25.4) / PROVISIONAL_RATIO;
    const gateway = withScaleCapabilities(harness.gateway, {
      readLayer: async (input) => ({ ...(await harness.gateway.readLayer(input)), dimensions: [], sourceDpi }),
    });
    const mounted = mountHook(gateway);
    await settle(mounted);
    await settleAsync();

    expect(mounted.result.current.model.partialNotice).toMatch(/^Tỷ lệ lấy từ ghi chú TL 1:50 trên bản vẽ/u);
    expect(mounted.result.current.model.panel.canApply).toBe(true);
    expect(mounted.result.current.model.panel.applyLabel).toBe('Xác nhận tỷ lệ máy đề xuất');
  });

  it('[UX-R4 U11] brochure không ghi số: gõ diện tích căn → tỷ lệ suy từ diện tích phòng, lưu qua cùng PUT', async () => {
    useStore.getState().setSpatial(null, null);
    simulateProvisionalScale(FLOOR_ID, PROVISIONAL_RATIO, 'pipeline');
    const harness = await makeHarness();
    /* Một phòng 10 × 10 m ở tỷ lệ đã dựng = 100 m²; căn thật 25 m² → mm/px còn một nửa. */
    const square = [
      { x: 0, y: 0 },
      { x: 10_000, y: 0 },
      { x: 10_000, y: 10_000 },
      { x: 0, y: 10_000 },
    ];
    let built = 0;
    const gateway = withScaleCapabilities(harness.gateway, {
      readLayer: async (input) => {
        const document = await harness.gateway.readLayer(input);
        built = document.level.scaleMillimetresPerPixel ?? 0;
        return { ...document, dimensions: [], layer: { ...document.layer, rooms: [{ outline: square }] as never } };
      },
    });
    const mounted = mountHook(gateway);
    await settle(mounted);
    await settleAsync();

    // UX-21: ô trống, chữ gợi ý không phải một con số.
    expect(mounted.result.current.model.panel.areaEntry?.text).toBe('');
    expect(mounted.result.current.model.panel.areaEntry?.placeholder).not.toMatch(/\d/u);

    await act(async () => {
      mounted.result.current.actions.onChangeFlatArea?.('25');
    });

    expect(mounted.result.current.model.panel.areaEntry?.error).toBeNull();
    expect(built).toBeGreaterThan(0);

    await applyNow(mounted);

    expect(harness.writeLayer).toHaveBeenCalledTimes(1);
    expect(harness.writeLayer.mock.calls[0]?.[0].body.scaleMillimetresPerPixel).toBeCloseTo(built / 2, 6);
  });

  it('[D1] rộng × dài căn theo tim tường: tỷ lệ suy từ hộp bao tường → đi đường xác nhận như cũ', async () => {
    useStore.getState().setSpatial(null, null);
    simulateProvisionalScale(FLOOR_ID, PROVISIONAL_RATIO, 'pipeline');
    const harness = await makeHarness();
    /* Hộp tim tường 10 × 20 m ở tỷ lệ đã dựng; căn thật 5 × 10 m → mm/px còn một nửa. */
    const wall = (x1: number, y1: number, x2: number, y2: number) => ({
      centreline: { start: { x: x1, y: y1 }, end: { x: x2, y: y2 } },
      thicknessMm: 200,
    });
    let built = 0;
    const gateway = withScaleCapabilities(harness.gateway, {
      readLayer: async (input) => {
        const document = await harness.gateway.readLayer(input);
        built = document.level.scaleMillimetresPerPixel ?? 0;
        const walls = [wall(0, 0, 10_000, 0), wall(10_000, 0, 10_000, 20_000)];
        return { ...document, dimensions: [], layer: { ...document.layer, walls: walls as never } };
      },
    });
    const mounted = mountHook(gateway);
    await settle(mounted);
    await settleAsync();

    expect(mounted.result.current.model.panel.sizeEntry?.isOuter).toBe(true);

    await act(async () => {
      mounted.result.current.actions.onChangeFlatSize?.({ widthText: '5000', lengthText: '11000', isOuter: false });
    });
    expect(mounted.result.current.model.panel.sizeEntry?.error).toMatch(/lệch/u);

    await act(async () => {
      mounted.result.current.actions.onChangeFlatSize?.({ lengthText: '10000' });
    });
    expect(mounted.result.current.model.panel.sizeEntry?.error).toBeNull();
    expect(mounted.result.current.model.panel.applyMissingHint).toBeUndefined();

    await applyNow(mounted);

    expect(harness.writeLayer).toHaveBeenCalledTimes(1);
    expect(harness.writeLayer.mock.calls[0]?.[0].body.scaleMillimetresPerPixel).toBeCloseTo(built / 2, 6);
  });

  it('storedRatio null: nhãn "Chưa có", dải tỷ lệ tạm; áp đúng tỷ lệ tạm → một PUT, dải mất', async () => {
    const { harness, mounted } = await mountProvisional();

    expect(useStore.getState().floorMeta[FLOOR_ID]?.scaleStatus).toBe('unresolved');
    expect(mounted.result.current.model.panel.currentScaleLabel).toBe('Chưa có'); // A6
    // G3-31: màn tường đang dùng tỷ lệ tạm — dòng dưới nói ra số đó thay vì "chưa đủ dữ liệu".
    expect(mounted.result.current.model.panel.derivedLine).toMatch(/^đang dùng tạm .+ mm\/px do máy ước, chưa được duyệt$/u);
    expect(mounted.result.current.model.provisionalScaleNotice).toBe(
      'Tỷ lệ tạm — số đo chưa tin được, hãy hiệu chỉnh tỷ lệ.',
    );

    await typeReference(mounted, PROVISIONAL_REAL_LENGTH);
    await applyNow(mounted);

    expect(harness.writeLayer).toHaveBeenCalledTimes(1);
    expect(harness.writeLayer.mock.calls[0]?.[0].body.scaleMillimetresPerPixel).toBeCloseTo(PROVISIONAL_RATIO, 6);
    expect(useStore.getState().floorMeta[FLOOR_ID]?.scaleStatus).toBeUndefined();
    expect(mounted.result.current.model.provisionalScaleNotice).toBeUndefined();
    expect(mounted.result.current.model.state).toBe('success');
  });

  it('hoàn tác trên tầng từng tỷ lệ tạm → một PUT tỷ lệ cũ, kèm câu của bước 5', async () => {
    const { harness, mounted } = await mountProvisional();

    await typeReference(mounted);
    await applyNow(mounted);
    expect(harness.writeLayer).toHaveBeenCalledTimes(1);

    await act(async () => {
      useStore.temporal.getState().undo();
    });
    await act(async () => {
      await clock.advance(RETRY_SCHEDULE_MS[0]);
    });
    await settleAsync();

    expect(harness.writeLayer).toHaveBeenCalledTimes(2);
    expect(harness.writeLayer.mock.calls[1]?.[0].body).toEqual({ scaleMillimetresPerPixel: PROVISIONAL_RATIO });
    expect(mounted.result.current.model.panel.applyBlockedNotice).toBe(
      'Đã đặt lại tỷ lệ cũ; tỷ lệ này nay được coi là tỷ lệ bạn chọn.',
    );
  });
});

describe('useScaleCalibration — áp mọi tầng (A9)', () => {
  const FLOORS = [
    { floorId: sampleLevelId(0), name: 'Tầng 1', hasDrawing: true, revision: 4 },
    { floorId: sampleLevelId(1), name: 'Tầng 2', hasDrawing: true, revision: 5 },
    { floorId: sampleLevelId(2), name: 'Tầng 3', hasDrawing: true, revision: 6 },
    { floorId: sampleLevelId(3), name: 'Mái', hasDrawing: false, revision: 7 },
  ] as const;

  async function mountAllFloors(): Promise<{ harness: Harness; mounted: Mounted }> {
    const harness = await makeHarness();
    const gateway = withScaleCapabilities(harness.gateway, { readAllFloors: async () => FLOORS });
    const mounted = mountHook(gateway);

    await settle(mounted);
    await settleAsync();
    await typeReference(mounted);
    await act(async () => {
      mounted.result.current.actions.onChangeApplyScope('allFloors');
    });
    await applyNow(mounted);

    return { harness, mounted };
  }

  it('dự án căn hộ riêng: không có "Mọi tầng", áp chỉ PUT tầng này, không đọc mọi tầng', async () => {
    separateUnitsFlag.value = true;
    const harness = await makeHarness();
    const readAllFloors = vi.fn(async () => FLOORS);
    const gateway = withScaleCapabilities(harness.gateway, { readAllFloors });
    const mounted = mountHook(gateway);

    await settle(mounted);
    await settleAsync();
    await typeReference(mounted);

    expect(mounted.result.current.model.panel.applyScopeOptions.map((option) => option.value)).toEqual([
      'thisFloor',
    ]);

    await act(async () => {
      mounted.result.current.actions.onChangeApplyScope('allFloors');
    });
    expect(mounted.result.current.model.panel.applyScope).toBe('thisFloor');
    await applyNow(mounted);

    expect(readAllFloors).not.toHaveBeenCalled();
    expect(mounted.result.current.model.allFloorsConfirm).toBeUndefined();
    expect(harness.writeLayer).toHaveBeenCalledTimes(1);
  });

  it('UX-R2 K32: tỷ lệ cũ của từng tầng lấy từ N15 của readAllFloors, không từ kho', async () => {
    const harness = await makeHarness();
    const withScale = [
      FLOORS[0],
      { ...FLOORS[1], currentScale: millimetresPerPixel(8) },
      FLOORS[2],
      FLOORS[3],
    ];
    const gateway = withScaleCapabilities(harness.gateway, { readAllFloors: async () => withScale });
    const mounted = mountHook(gateway);

    await settle(mounted);
    await settleAsync();
    await typeReference(mounted);
    await act(async () => {
      mounted.result.current.actions.onChangeApplyScope('allFloors');
    });
    await applyNow(mounted);

    expect(mounted.result.current.model.allFloorsConfirm?.changes).toEqual([
      'Tầng 1: chưa có → 12 mm/px',
      'Tầng 2: 8 mm/px → 12 mm/px',
      'Tầng 3: chưa có → 12 mm/px',
    ]);
  });

  it('bấm áp mở hộp thoại A9 với số tầng có bản vẽ; huỷ → không PUT, giữ trạng thái trước', async () => {
    const { harness, mounted } = await mountAllFloors();
    const before = mounted.result.current.model.state;

    expect(mounted.result.current.model.allFloorsConfirm).toEqual({
      title: 'Áp tỷ lệ này cho 3 tầng có bản vẽ?',
      message:
        'Tầng chưa có bản vẽ sẽ không được áp. Sau khi áp, bước nắn và cắt bản vẽ của các tầng này sẽ khoá lại; muốn nắn lại thì tải bản vẽ mới.',
      confirmLabel: 'Áp cho mọi tầng',
      cancelLabel: 'Huỷ',
      // UX-R2 K32: mỗi tầng một dòng cũ → mới.
      changes: ['Tầng 1: chưa có → 12 mm/px', 'Tầng 2: chưa có → 12 mm/px', 'Tầng 3: chưa có → 12 mm/px'],
    });

    await act(async () => {
      mounted.result.current.actions.onCancelAllFloors();
    });
    await settleAsync();

    expect(mounted.result.current.model.allFloorsConfirm).toBeUndefined();
    expect(mounted.result.current.model.state).toBe(before);
    expect(harness.writeLayer).not.toHaveBeenCalled();
  });

  it('đồng ý → nối tiếp, hint = revision N15, bỏ tầng không bản vẽ, nêu tầng bị khối và tầng hỏng', async () => {
    const { harness, mounted } = await mountAllFloors();
    const blockedFloor = FLOORS[2].floorId;
    let inFlight = 0;
    let maxInFlight = 0;

    // Tầng 3 bị khối trước: một lượt lưu lớp của nó vừa 403.
    harness.writeLayer.mockImplementation(async (input) => {
      inFlight += 1;
      maxInFlight = Math.max(maxInFlight, inFlight);
      await Promise.resolve();
      inFlight -= 1;

      if (input.floorId === blockedFloor) {
        return { error: FORBIDDEN, ok: false };
      }

      if (input.floorId === FLOORS[1].floorId) {
        return { error: { ...FORBIDDEN, code: 'VALIDATION', status: 422 }, ok: false };
      }

      return savedLayer(input.floorId, input.baseVersion + 1);
    });
    await act(async () => {
      const wall = Object.values(useStore.getState().spatial?.byId ?? {}).find(
        (entity) => 'thicknessMm' in entity && 'levelId' in entity && entity.levelId === blockedFloor,
      );

      if (wall !== undefined && 'thicknessMm' in wall) {
        commit({ op: 'update', kind: 'wall', id: wall.id, changes: { thicknessMm: wall.thicknessMm + 10 } }, 'Đổi độ dày');
      }
    });
    await act(async () => {
      await flushAutosaves().catch(() => undefined);
    });
    await settleAsync();
    harness.writeLayer.mockClear();

    await act(async () => {
      mounted.result.current.actions.onConfirmAllFloors();
    });
    await settleAsync();

    expect(harness.writeLayer.mock.calls.map(([input]) => [input.floorId, input.baseVersion, input.body])).toEqual([
      [FLOORS[0].floorId, 4, { scaleMillimetresPerPixel: REFERENCE_SCALE.millimetresPerPixel }],
      [FLOORS[1].floorId, 5, { scaleMillimetresPerPixel: REFERENCE_SCALE.millimetresPerPixel }],
    ]);
    expect(maxInFlight).toBe(1);

    const notice = mounted.result.current.model.panel.applyBlockedNotice ?? '';

    expect(notice).toContain('Đã áp tỷ lệ cho 1 tầng.');
    expect(notice).toContain('Không lưu được tỷ lệ cho: Tầng 2.');
    expect(notice).toContain('Chưa gửi vì tầng đang bị khoá lưu: Tầng 3.');
    expect(notice).toContain('Bỏ qua vì chưa có bản vẽ: Mái.');
    expect(mounted.result.current.model.state).not.toBe('success');
    expect(storedRatio()).toBeCloseTo(REFERENCE_SCALE.millimetresPerPixel, 6);
    const failedLevel = useStore.getState().spatial?.byId[FLOORS[1].floorId];
    expect(failedLevel !== undefined && 'order' in failedLevel ? failedLevel.scaleMillimetresPerPixel : null).not.toBe(
      REFERENCE_SCALE.millimetresPerPixel,
    );
  });
});

describe('useScaleCalibration — hai cảnh báo, cả hai KHÔNG chặn', () => {
  it('250 mm/px bật cảnh báo tường ba mét ngay khi gõ, nút áp vẫn bấm được', async () => {
    const harness = await makeHarness({ referenceWallWidthPx: REFERENCE_WALL_WIDTH });
    const mounted = mountHook(harness.gateway);
    await settle(mounted);
    await dragReferenceLine(mounted);

    // Một đoạn 400 px dài 100.000 mm cho ra đúng 250 mm/px.
    await act(async () => {
      mounted.result.current.actions.onChangeRealLength(
        typedNumber(IMPLAUSIBLE_RATIO * REFERENCE_PIXEL_LENGTH),
      );
    });

    const { panel } = mounted.result.current.model;
    const warning = panel.warnings.find((notice) => notice.warning.kind === 'implausible');

    expect(warning).toBeDefined();
    expect(warning?.statusCode).toBe('attention');
    // Nét tường 12 px ở 250 mm/px là một bức tường dày ba mét — đúng câu đặc tả nêu.
    const impliedThickness = millimetres(IMPLAUSIBLE_RATIO * REFERENCE_WALL_WIDTH);

    expect(warning?.warning.kind).toBe('implausible');
    expect(warning?.message).toContain(formatLength(impliedThickness));
    // Cảnh báo nói ra hậu quả, không khoá nút.
    expect(panel.canApply).toBe(true);
    expect(panel.areActionsHidden).toBe(false);
    // Cùng cảnh báo đó đứng cạnh ô nhập, hiện ngay khi gõ chứ không đợi rời ô.
    expect(panel.reference.inlineWarning).not.toBeNull();
  });

  it('lệch quá 15% so với ước tính của AI thì cảnh báo, vẫn không chặn', async () => {
    const harness = await makeHarness({ rows: sampleDimensionRows() });
    const mounted = mountHook(harness.gateway);
    await settle(mounted);
    await dragReferenceLine(mounted);

    const aiRatio = mounted.result.current.aiInference?.suggestedMillimetresPerPixel;

    expect(aiRatio).toBeDefined();

    // Một tỷ lệ lệch gấp đôi ngưỡng 15%, dựng bằng chính ngưỡng đó.
    const drifted = millimetresPerPixel(
      (aiRatio ?? 0) * (1 + SCALE_THRESHOLDS.aiDeviationLimit + SCALE_THRESHOLDS.aiDeviationLimit),
    );

    await act(async () => {
      mounted.result.current.actions.onChangeRealLength(
        typedNumber(drifted * REFERENCE_PIXEL_LENGTH),
      );
    });

    const { panel } = mounted.result.current.model;
    const warning = panel.warnings.find(
      (notice) => notice.warning.kind === 'deviatesFromEstimate',
    );

    expect(warning).toBeDefined();
    expect(warning?.statusCode).toBe('attention');
    expect(panel.canApply).toBe(true);
  });

  it('tỷ lệ hợp lý thì không cảnh báo gì', async () => {
    const harness = await makeHarness({ referenceWallWidthPx: REFERENCE_WALL_WIDTH });
    const mounted = mountHook(harness.gateway);
    await settle(mounted);
    await dragReferenceLine(mounted);

    await act(async () => {
      mounted.result.current.actions.onChangeRealLength(typedNumber(REFERENCE_REAL_LENGTH));
    });

    expect(mounted.result.current.model.panel.warnings).toHaveLength(0);
  });
});

describe('useScaleCalibration — ba dòng kiểm chứng luôn đủ ba', () => {
  it('giữ đúng ba dòng, và dòng chưa đo được nói "—" chứ không biến mất', async () => {
    const harness = await makeHarness({ referenceWallWidthPx: REFERENCE_WALL_WIDTH });
    const mounted = mountHook(harness.gateway);
    await settle(mounted);
    await dragReferenceLine(mounted);

    await act(async () => {
      mounted.result.current.actions.onChangeRealLength('4800');
    });

    const rows = mounted.result.current.model.panel.crossChecks;

    expect(rows.map((row) => row.id)).toEqual([
      'wallThickness',
      'doorWidth',
      'largestRoomArea',
    ]);
    expect(rows[0]?.valueLabel).not.toBe('—');
    expect(rows[1]?.valueLabel).toBe('—');
    expect(rows[2]?.valueLabel).toBe('—');
    // A5: không dòng nào mang màu "đã xác minh".
    expect(rows.every((row) => row.statusCode !== 'verified')).toBe(true);
  });
});

describe('useScaleCalibration — bảy trạng thái', () => {
  it('đạt tới được cả bảy', async () => {
    const reached = new Set<ScaleCalibrationState>();

    // 1. loading — trước khi lượt đọc đầu tiên về.
    const loadingHarness = await makeHarness();
    const loading = mountHook(loadingHarness.gateway);
    reached.add(loading.result.current.model.state);
    await settle(loading);

    // 2. empty — đọc xong, không chuỗi kích thước nào.
    reached.add(loading.result.current.model.state);

    // 3. partial — đã bắt tay vào việc nhưng chưa chốt.
    await dragReferenceLine(loading);
    reached.add(loading.result.current.model.state);

    // 4. success — đã áp.
    await act(async () => {
      loading.result.current.actions.onChangeRealLength('4800');
    });
    await applyNow(loading);
    reached.add(loading.result.current.model.state);
    loading.unmount();

    // 5. error — máy không tìm được khung bản vẽ, bản vẽ có thể méo.
    const warpedHarness = await makeHarness({ sourceFloorId: WARPED_MOCK_FLOOR_ID });
    const warped = mountHook(warpedHarness.gateway);
    await settle(warped);
    reached.add(warped.result.current.model.state);
    expect(warped.result.current.model.errorMessage).not.toBeNull();
    // Ảnh méo không có mã máy thật: không in "Mã lỗi: UNKNOWN" (BUG-341).
    expect(warped.result.current.model.errorCode).toBeNull();
    warped.unmount();

    // 6. forbidden — người xem không có quyền sửa.
    const forbiddenHarness = await makeHarness();
    const forbidden = mountHook(forbiddenHarness.gateway, { roles: ['viewer'] });
    await settle(forbidden);
    reached.add(forbidden.result.current.model.state);
    expect(forbidden.result.current.model.canvas.isInteractive).toBe(false);
    expect(forbidden.result.current.model.panel.areActionsHidden).toBe(true);
    forbidden.unmount();

    // 7. collapsed — panel thu gọn.
    const collapsedHarness = await makeHarness();
    const collapsed = mountHook(collapsedHarness.gateway, { forceCollapsed: true });
    await settle(collapsed);
    reached.add(collapsed.result.current.model.state);
    collapsed.unmount();

    expect([...reached].sort()).toEqual([...SEVEN_STATES].sort());
  });

  it('lượt đọc hỏng có tiêu đề riêng, không mượn tiêu đề "nắn ảnh thất bại" (B-V5-04)', async () => {
    const harness = await makeHarness();
    const failing = mountHook({
      ...harness.gateway,
      readFloorDrawing: () => Promise.reject(new Error('mất kết nối')),
    });
    await settle(failing);

    expect(failing.result.current.model.state).toBe('error');
    expect(failing.result.current.model.errorTitle).toBeDefined();
    failing.unmount();

    const warpedHarness = await makeHarness({ sourceFloorId: WARPED_MOCK_FLOOR_ID });
    const warped = mountHook(warpedHarness.gateway);
    await settle(warped);

    expect(warped.result.current.model.state).toBe('error');
    expect(warped.result.current.model.errorTitle).toBeUndefined();
    // Một câu, không nhắc lại tiêu đề của view (BUG-341). Tiền xử lý không thất bại: màn Xử lý
    // đánh ✓ đúng, nên câu ở đây không được nói "thất bại" (G3-31).
    expect(warped.result.current.model.errorMessage).not.toContain('thất bại');
    expect(warped.result.current.model.errorMessage).toContain('Bước tiền xử lý đã xong');
    warped.unmount();
  });

  it('"Thu gọn bảng" vẫn thu panel khi màn ở trạng thái lỗi (BUG-322)', async () => {
    const warpedHarness = await makeHarness({ sourceFloorId: WARPED_MOCK_FLOOR_ID });
    const warped = mountHook(warpedHarness.gateway);
    await settle(warped);

    expect(warped.result.current.model.state).toBe('error');
    expect(warped.result.current.model.isPanelCollapsed).toBe(false);

    await act(async () => {
      warped.result.current.actions.onToggleCollapsed();
    });

    expect(warped.result.current.model.state).toBe('error');
    expect(warped.result.current.model.isPanelCollapsed).toBe(true);
    warped.unmount();
  });

  it('tầng chưa có bản vẽ (404 `upload`) nói đúng nguyên nhân, không lộ NOT_FOUND (BUG-337)', async () => {
    const harness = await makeHarness();
    const noDrawing: HttpError = {
      code: 'NOT_FOUND',
      kind: 'http',
      raw: { code: 'NOT_FOUND', resource: 'upload' },
      requestId: 'r',
      retryable: false,
      status: 404,
    };
    const mounted = mountHook({
      ...harness.gateway,
      readFloorDrawing: async () => ({ ok: false, error: noDrawing }),
    });
    await settle(mounted);

    const { model } = mounted.result.current;

    expect(model.state).toBe('error');
    expect(model.errorTitle).toBe('Tầng này chưa có bản vẽ');
    // Lối ra là "Tải bản vẽ lên", không phải "Tải lại ảnh" (review-1 #7).
    expect(model.isNoDrawing).toBe(true);
    expect(model.errorMessage).toContain('Tải bản vẽ lên');
    expect(model.errorCode).toBeNull();
    expect(model.panel.crossChecks.map((row) => row.label)).toEqual([
      'Độ dày tường điển hình',
      'Bề rộng cửa đi điển hình',
      'Diện tích phòng lớn nhất',
    ]);
    // BUG-411: quy trình khoá lại, bảng phím ẩn, "Chưa có" là chữ chứ không phải số.
    expect(model.panel.isMethodLocked).toBe(true);
    expect(model.panel.shortcutHints).toEqual([]);
    expect(model.panel.isCurrentScaleKnown).toBe(false);
    mounted.unmount();
  });

  it('trạng thái `partial` cũng đến từ chuỗi kích thước tin cậy thấp', async () => {
    const harness = await makeHarness({ rows: sampleDimensionRows(3) });
    const mounted = mountHook(harness.gateway);
    await settle(mounted);

    const { model } = mounted.result.current;

    expect(model.state).toBe('partial');
    expect(model.panel.dimension.lowConfidenceNotice).not.toBeNull();
    expect(model.panel.dimension.rows.filter((row) => row.isLowConfidence)).toHaveLength(3);
    // A5: hàng do AI đọc không bao giờ mang màu "đã xác minh".
    expect(model.panel.dimension.rows.every((row) => row.statusCode !== 'verified')).toBe(true);
  });
});

describe('useScaleCalibration — ngưỡng tin cậy của dự án (BUG-354)', () => {
  /* Mọi hàng 0,8: trên 0,70 mặc định, dưới 0,85 của dự án. */
  const rowsAt = (confidence: number) => sampleDimensionRows().map((row) => ({ ...row, confidence }));

  it('gạch "độ tin cậy thấp" theo ngưỡng N5 của dự án, không theo hằng 0,70', async () => {
    const harness = await makeHarness({ rows: rowsAt(0.8) });
    const mounted = mountHook({ ...harness.gateway, readConfidenceThreshold: () => Promise.resolve(0.85) });

    await settle(mounted);
    await settleAsync();
    expect(mounted.result.current.model.panel.dimension.rows.every((row) => row.isLowConfidence)).toBe(true);
    mounted.unmount();
  });

  it('không đọc được cài đặt → rơi về ngưỡng mặc định 0,70', async () => {
    const harness = await makeHarness({ rows: rowsAt(0.8) });
    const mounted = mountHook({ ...harness.gateway, readConfidenceThreshold: () => Promise.resolve(null) });

    await settle(mounted);
    await settleAsync();
    expect(mounted.result.current.model.panel.dimension.rows.some((row) => row.isLowConfidence)).toBe(false);
    mounted.unmount();
  });
});

describe('useScaleCalibration — bàn phím và phiên kéo', () => {
  it('Esc huỷ đoạn đang kéo, R đo lại', async () => {
    const harness = await makeHarness();
    const mounted = mountHook(harness.gateway);
    await settle(mounted);

    await act(async () => {
      mounted.result.current.actions.onStartDrag({ x: 0, y: 0 });
    });

    expect(mounted.result.current.model.panel.reference.draft).not.toBeNull();

    await act(async () => {
      mounted.result.current.actions.onCancelDrag();
    });

    expect(mounted.result.current.model.panel.reference.draft).toBeNull();

    await dragReferenceLine(mounted);

    expect(mounted.result.current.model.panel.reference.canRemeasure).toBe(true);

    await act(async () => {
      mounted.result.current.actions.onRemeasure();
    });

    expect(mounted.result.current.model.panel.reference.draft).toBeNull();
  });

  it('UX41 U04: đặt đoạn đo bằng bàn phím, gõ chiều dài là có tỷ lệ đề nghị', async () => {
    const harness = await makeHarness();
    const mounted = mountHook(harness.gateway);
    await settle(mounted);

    expect(mounted.result.current.model.panel.reference.canPlaceSegment).toBe(true);

    await act(async () => {
      mounted.result.current.actions.onPlaceSegment();
      mounted.result.current.actions.onChangeRealLength('4800');
    });

    const reference = mounted.result.current.model.panel.reference;
    expect(reference.draft?.pixelLength ?? 0).toBeGreaterThan(0);
    expect(reference.canPlaceSegment).toBe(false);
    expect(mounted.result.current.model.panel.canApply).toBe(true);
  });

  it('nhích một đầu đoạn: mũi tên đi một pixel, Shift + mũi tên đi mười', async () => {
    const harness = await makeHarness();
    const mounted = mountHook(harness.gateway);
    await settle(mounted);
    await dragReferenceLine(mounted);

    const before = mounted.result.current.model.panel.reference.draft?.pixelLength ?? 0;

    await act(async () => {
      mounted.result.current.actions.onNudgeEndpoint('end', 'right', 'fine');
    });

    const afterFine = mounted.result.current.model.panel.reference.draft?.pixelLength ?? 0;

    await act(async () => {
      mounted.result.current.actions.onNudgeEndpoint('end', 'right', 'coarse');
    });

    const afterCoarse = mounted.result.current.model.panel.reference.draft?.pixelLength ?? 0;

    expect(afterFine - before).toBeCloseTo(1, 6);
    expect(afterCoarse - afterFine).toBeCloseTo(10, 6);
  });

  it('giữ Shift khoá đoạn theo trục', async () => {
    const harness = await makeHarness();
    const mounted = mountHook(harness.gateway);
    await settle(mounted);

    await act(async () => {
      mounted.result.current.actions.onStartDrag({ x: 0.2, y: 0.2 });
    });
    await act(async () => {
      mounted.result.current.actions.onMoveDrag({ x: 0.5, y: 0.22 }, { isAxisLocked: true });
    });

    const draft = mounted.result.current.model.panel.reference.draft;

    expect(draft?.isAxisLocked).toBe(true);
    expect(draft?.end.y).toBeCloseTo(draft?.start.y ?? 0, 6);
  });

  it('nêu đủ bảy dòng nhắc phím tắt, tổ hợp in bằng mặt phím (`keyCapLabels`)', async () => {
    const harness = await makeHarness();
    const mounted = mountHook(harness.gateway);
    await settle(mounted);

    const hints = mounted.result.current.model.panel.shortcutHints;

    // U04/U09: thêm dòng nhắc đặt tỷ lệ bằng bàn phím (sáu dòng cũ + một).
    expect(hints).toHaveLength(7);
    const labels = hints.map((hint) => hint.comboLabel);

    expect(labels).toContain('Shift + ←');
    expect(labels).toContain('Esc');
    expect(labels.join(' ')).not.toMatch(/ESCAPE|ARROW|ENTER/u);
    expect(hints.every((hint) => hint.description.length > 0)).toBe(true);
    // A6: mô tả phím viết hoa chữ đầu, như sổ phím tắt của các màn khác.
    expectSentenceCaseStrings(hints.map((hint) => hint.description));
  });
});

describe('useScaleCalibration — review-1 F3 (P2-4, P2-5, Nit-3)', () => {
  /** Tầng đang mở đã có một tỉ lệ trước lượt áp — có cái để hoàn tác về mà gửi. */
  beforeEach(() => {
    const graph = createSampleBuilding();
    const levels = graph.levels.map((level) =>
      level.id === FLOOR_ID ? { ...level, scaleMillimetresPerPixel: PROVISIONAL_RATIO } : level,
    );
    const spatial = normalizeSpatial({ ...graph, levels });

    useStore.getState().setSpatial(spatial, 'version-1', {
      floorRevisions: Object.fromEntries(spatial.byKind.level.map((id) => [id, 0])),
      projectId: PROJECT_ID,
    });
  });

  /** Gõ đoạn tham chiếu rồi áp; trả về hook đã gắn. */
  async function mountAndApply(harness: Harness): Promise<Mounted> {
    const mounted = mountHook(harness.gateway);

    await settle(mounted);
    await settleAsync();
    await typeReference(mounted);
    await applyNow(mounted);

    return mounted;
  }

  async function undoAndSend(): Promise<void> {
    await act(async () => {
      useStore.temporal.getState().undo();
    });
    await act(async () => {
      await clock.advance(RETRY_SCHEDULE_MS[0]);
    });
    await settleAsync();
  }

  it('P2-4: áp, gỡ màn, gắn lại, Ctrl+Z → đúng một PUT tỷ lệ cũ', async () => {
    const before = storedRatio();
    const harness = await makeHarness();
    const first = await mountAndApply(harness);

    // Hẹn lưu 800 ms của lượt gắn đầu chạy xong TRƯỚC khi gỡ — không thì chính hẹn ấy
    // (closure của lượt gắn cũ) gửi cú hoàn tác, và bài này không còn kiểm lượt gắn lại.
    await act(async () => {
      await clock.advance(RETRY_SCHEDULE_MS[0]);
    });
    await settleAsync();
    expect(harness.writeLayer).toHaveBeenCalledTimes(1);
    first.unmount();

    const second = mountHook(harness.gateway);
    await settle(second);
    await settleAsync();
    await undoAndSend();

    expect(storedRatio()).toBe(before);
    expect(harness.writeLayer).toHaveBeenCalledTimes(2);
    expect(harness.writeLayer.mock.calls[1]?.[0].body).toEqual({ scaleMillimetresPerPixel: before });
  });

  it('áp, hoàn tác, áp lại, Ctrl+Z → PUT thứ tư mang tỷ lệ cũ (14-A-028)', async () => {
    const before = storedRatio();
    const harness = await makeHarness();
    const mounted = await mountAndApply(harness);

    await act(async () => {
      await clock.advance(RETRY_SCHEDULE_MS[0]);
    });
    await settleAsync();
    await undoAndSend();
    expect(harness.writeLayer).toHaveBeenCalledTimes(2);

    await applyNow(mounted);
    await act(async () => {
      await clock.advance(RETRY_SCHEDULE_MS[0]);
    });
    await settleAsync();
    expect(harness.writeLayer).toHaveBeenCalledTimes(3);
    await undoAndSend();

    expect(harness.writeLayer).toHaveBeenCalledTimes(4);
    expect(harness.writeLayer.mock.calls[3]?.[0].body).toEqual({ scaleMillimetresPerPixel: before });
  });

  it('như người dùng thật: hoàn tác lần đầu bằng toast, áp lại, Ctrl+Z → vẫn PUT tỷ lệ cũ (14-A-028, BUG-724)', async () => {
    const before = storedRatio();
    const harness = await makeHarness();
    let toast: Notification | undefined;
    const unsubscribe = appNotificationBus.subscribe((all) => {
      // G4b-14: the toast names the applied ratio instead of repeating the button label.
      toast = all.find((n) => n.title.startsWith('Đã áp tỷ lệ ') && n.title.endsWith(' cho tầng này')) ?? toast;
    });
    const mounted = await mountAndApply(harness);

    await act(async () => {
      await clock.advance(RETRY_SCHEDULE_MS[0]);
    });
    await settleAsync();
    await act(async () => {
      toast?.undoTicket?.undo();
    });
    await act(async () => {
      await clock.advance(RETRY_SCHEDULE_MS[0]);
    });
    await settleAsync();
    expect(harness.writeLayer).toHaveBeenCalledTimes(2);

    await applyNow(mounted);
    await act(async () => {
      await clock.advance(RETRY_SCHEDULE_MS[0]);
    });
    await settleAsync();
    unsubscribe();
    expect(harness.writeLayer).toHaveBeenCalledTimes(3);
    await undoAndSend();

    expect(harness.writeLayer).toHaveBeenCalledTimes(4);
    expect(harness.writeLayer.mock.calls[3]?.[0].body).toEqual({ scaleMillimetresPerPixel: before });
  });

  it('ảnh 1600×1200: đầu đoạn bắt lưới 50 mm theo pixel ẢNH — khung vuông, dải trống 200 px trên/dưới (14-C-025, BUG-723)', async () => {
    const harness = await makeHarness({ drawingSize: { widthPx: pixels(1600), heightPx: pixels(1200) } });
    const mounted = mountHook(harness.gateway);
    await settle(mounted);
    await settleAsync();
    const ratio = storedRatio() ?? Number.NaN;
    const end: ImageRatioPoint = { x: 0.7213, y: 0.4347 };

    await act(async () => {
      mounted.result.current.actions.onStartDrag({ x: 0.2, y: 0.5 });
    });
    await act(async () => {
      mounted.result.current.actions.onMoveDrag(end, { isAxisLocked: false });
    });
    await act(async () => {
      mounted.result.current.actions.onEndDrag(end);
    });

    const snapped = mounted.result.current.model.canvas.referenceLine?.end ?? { x: Number.NaN, y: Number.NaN };
    const offGrid = (mm: number): number => Math.abs(mm / 50 - Math.round(mm / 50));
    // Handle ratios are of the SQUARE frame (long side 1600, `imageFrameOf`): image px = ratio · 1600 − inset, and
    // the 1200 px side sits in a 200 px band. `y · h · r` (the old 14-C-025 formula) is off the grid by 0.25 here.
    expect(offGrid(snapped.x * 1600 * ratio)).toBeLessThan(1e-6);
    expect(offGrid((snapped.y * 1600 - 200) * ratio)).toBeLessThan(1e-6);
  });

  it('Ctrl+Z giữa lúc saveScale đang chờ → hoàn tác chính lần áp ấy: màn và máy chủ cùng về tỷ lệ cũ (BUG-725)', async () => {
    const before = storedRatio();
    const harness = await makeHarness();
    const disposeGlobal = registerGlobalShortcuts(appShortcutRegistry, {
      undo: () => {
        useStore.temporal.getState().undo();
      },
      redo: () => undefined,
      save: () => undefined,
      openSearch: () => undefined,
      openShortcutHelp: () => undefined,
      closeTopLayer: () => undefined,
    });
    const mounted = await mountAndApply(harness);

    await act(async () => {
      await clock.advance(RETRY_SCHEDULE_MS[0]);
    });
    await settleAsync();
    await undoAndSend();
    expect(harness.writeLayer).toHaveBeenCalledTimes(2);

    const pending = deferredWrite();
    harness.writeLayer.mockReturnValueOnce(pending.promise);
    await applyNow(mounted);
    expect(harness.writeLayer).toHaveBeenCalledTimes(3);
    expect(mounted.result.current.model.panel.isApplying).toBe(true);

    await act(async () => {
      window.dispatchEvent(new KeyboardEvent('keydown', { key: 'z', ctrlKey: true, bubbles: true }));
    });
    pending.resolve(savedLayer(FLOOR_ID, 3));
    await settleAsync();
    await act(async () => {
      await clock.advance(RETRY_SCHEDULE_MS[0]);
    });
    await settleAsync();
    disposeGlobal();

    const puts = harness.writeLayer.mock.calls.map(([input]) => input.body.scaleMillimetresPerPixel);
    expect(storedRatio()).toBe(before);
    expect(puts.at(-1)).toBe(before);
  });

  it('P2-4: mốc khoá theo dự án — dự án khác thì Ctrl+Z không gửi tỉ lệ', async () => {
    const harness = await makeHarness();
    const first = await mountAndApply(harness);
    await act(async () => {
      await clock.advance(RETRY_SCHEDULE_MS[0]);
    });
    await settleAsync();
    first.unmount();

    const queryClient = createTestQueryClient();
    const other = renderHook(
      () => useScaleCalibration({ projectId: 'project-2', floorId: FLOOR_ID, gateway: harness.gateway }),
      { wrapper: ({ children }: { children: ReactNode }) => createElement(QueryClientProvider, { client: queryClient }, children) },
    );
    await settleAsync();
    await undoAndSend();
    other.unmount();

    expect(harness.writeLayer).toHaveBeenCalledTimes(1);
  });

  it('Nit-3: hoàn tác gửi PUT thì trạng thái không còn "success"', async () => {
    const harness = await makeHarness();
    const mounted = await mountAndApply(harness);

    expect(mounted.result.current.model.state).toBe('success');

    await undoAndSend();

    expect(harness.writeLayer).toHaveBeenCalledTimes(2);
    expect(mounted.result.current.model.state).not.toBe('success');
  });

  it('P2-5: readAllFloors trên bộ mẫu ghép #12 với N15 theo order khi mã lệch — đích mang mã Level và revision', async () => {
    const client = createMockApiClient();
    const floors = await client.floors.list({ projectId: PROJECT_ID });
    const graph = await client.spatial.readGraph({ projectId: PROJECT_ID });

    if (!floors.ok || !graph.ok) {
      throw new Error('Bộ mẫu không đọc được #12 hoặc N15.');
    }

    const levels = graph.data.graph.levels;
    // Tiền đề của ca này: trên bộ mẫu `Floor.id` ≠ `Level.id`.
    expect(floors.data.some((floor) => levels.some((level) => level.id === floor.id))).toBe(false);

    const targets = await createScaleCalibrationGateway(client).readAllFloors({ projectId: PROJECT_ID });

    expect(targets).toHaveLength(floors.data.length);
    targets.forEach((target, index) => {
      const level = levels.find((entry) => entry.id === target.floorId);

      expect(level?.order).toBe(floors.data[index]?.order);
      expect(target.revision).toBe(
        graph.data.floorRevisions.find((entry) => entry.floorId === target.floorId)?.revision,
      );
      expect(target.revision).toBeDefined();
      expect(target.currentScale).toBe(level?.scaleMillimetresPerPixel);
    });
  });
});

describe('useScaleCalibration — QA-04c SCR-14 (BUG-587, 596, 601, 607)', () => {
  it('kéo tay cầm đầu đoạn dời ĐÚNG đầu đó, đầu cuối đứng yên (BUG-587)', async () => {
    const harness = await makeHarness();
    const mounted = mountHook(harness.gateway);
    await settle(mounted);
    await dragReferenceLine(mounted);

    const before = mounted.result.current.model.canvas.referenceLine;
    const moved: ImageRatioPoint = { x: 0.05, y: 0.05 };

    await act(async () => {
      // Nhấn ĐÚNG tâm tay cầm đầu đoạn, rồi kéo tới `moved`.
      mounted.result.current.actions.onStartDrag(before?.start ?? moved, 'start');
    });
    await act(async () => {
      mounted.result.current.actions.onMoveDrag(moved, { isAxisLocked: false });
    });
    await act(async () => {
      mounted.result.current.actions.onEndDrag(moved);
    });

    const after = mounted.result.current.model.canvas.referenceLine;
    expect(after?.end).toEqual(before?.end);
    expect(after?.start.x).toBeCloseTo(moved.x, 6);
    expect(after?.start.y).toBeCloseTo(moved.y, 6);
  });

  it('đoạn dài 0 px nói vì sao chưa áp được (BUG-607)', async () => {
    const harness = await makeHarness();
    const mounted = mountHook(harness.gateway);
    await settle(mounted);

    await act(async () => {
      mounted.result.current.actions.onStartDrag({ x: 0.5, y: 0.5 });
    });
    await act(async () => {
      mounted.result.current.actions.onEndDrag({ x: 0.5, y: 0.5 });
    });

    expect(mounted.result.current.model.panel.canApply).toBe(false);
    expect(mounted.result.current.model.panel.reference.tooShortNotice).toMatch(/^Đoạn quá ngắn/u);
  });

  it('vừa khung đưa khung nhìn về toàn cảnh sau khi phóng (BUG-596)', async () => {
    const harness = await makeHarness();
    const mounted = mountHook(harness.gateway);
    await settle(mounted);

    await act(async () => {
      mounted.result.current.actions.onCanvasSizeChange(800, 800);
    });
    await act(async () => {
      mounted.result.current.actions.onZoomIn();
    });
    expect(mounted.result.current.model.canvas.zoomPercent).toBe(125);
    expect(mounted.result.current.model.canvas.miniMapViewport.width).toBeCloseTo(80, 6);

    await act(async () => {
      mounted.result.current.actions.onFitView();
    });
    expect(mounted.result.current.model.canvas.viewport).toEqual({ x: 0, y: 0, zoom: 1 });
  });

  it('người xem ở tầng lỗi vẫn không có điều khiển sửa (BUG-601)', async () => {
    const harness = await makeHarness({ sourceFloorId: WARPED_MOCK_FLOOR_ID });
    const mounted = mountHook(harness.gateway, { roles: ['viewer'] });
    await settle(mounted);

    // 14-D-008 (G44): vai xem trên tầng méo là `forbidden`, không phải `error` — `error` không được đứng trước `forbidden`.
    expect(mounted.result.current.model.state).toBe('forbidden');
    expect(mounted.result.current.model.canvas.isInteractive).toBe(false);
    expect(mounted.result.current.model.panel.areActionsHidden).toBe(true);
  });
});

describe('[G02] tầng chưa có bản vẽ trong dự án đã có bản vẽ ở tầng khác', () => {
  it('lượt đánh giá không có tầng này thì đọc ra 404 `upload` — màn "Tầng này chưa có bản vẽ", không UNKNOWN', async () => {
    const client = createMockApiClient();
    const assess = await client.quality.assess({ floorId: FLOOR_ID, projectId: PROJECT_ID });

    if (!assess.ok) {
      throw new Error('bộ mẫu không đánh giá được tầng.');
    }

    vi.spyOn(client.quality, 'assess').mockResolvedValue({
      ok: true,
      data: { ...assess.data, floors: assess.data.floors.filter((floor) => floor.floorId !== 'L-BARE') },
    });

    const read = await createScaleCalibrationGateway(client).readFloorDrawing({ floorId: 'L-BARE', projectId: PROJECT_ID });

    expect(read.ok).toBe(false);
    expect(read.ok ? null : readWireError(read.error)).toEqual(expect.objectContaining({ status: 404, resource: 'upload' }));
  });
});

describe('[G45] người ngoài dự án mở thẳng SCR-14', () => {
  it('404 dự án: màn "Không tìm thấy dự án này" có lối về danh sách, không "Mã lỗi: NOT_FOUND"', async () => {
    const harness = await makeHarness();
    const notFound: HttpError = {
      code: 'NOT_FOUND',
      kind: 'http',
      raw: { code: 'NOT_FOUND', resource: 'project' },
      requestId: 'r',
      retryable: false,
      status: 404,
    };
    const mounted = mountHook({
      ...harness.gateway,
      readFloorDrawing: async () => ({ ok: false, error: notFound }),
      readLayer: () => Promise.reject(notFound),
    });
    await settle(mounted);

    await act(async () => {
      await clock.advance(1);
    });

    expect(mounted.result.current.model.readFailure?.title).toBe(PROJECT_NOT_FOUND_TITLE);
  });
});

describe('[G51b] bấm tay cầm rồi thả tại chỗ không dời đầu đoạn', () => {
  it('nhấn lệch tâm tay cầm 24 px rồi thả, không kéo: đầu đoạn đứng yên', async () => {
    const harness = await makeHarness();
    const mounted = mountHook(harness.gateway);
    await settle(mounted);
    await dragReferenceLine(mounted);

    const before = mounted.result.current.model.canvas.referenceLine;
    const pressed: ImageRatioPoint = { x: (before?.end.x ?? 0) + 0.004, y: (before?.end.y ?? 0) + 0.004 };

    await act(async () => {
      mounted.result.current.actions.onStartDrag(pressed, 'end');
    });
    await act(async () => {
      mounted.result.current.actions.onEndDrag(pressed);
    });

    expect(mounted.result.current.model.canvas.referenceLine?.end).toEqual(before?.end);
    expect(mounted.result.current.model.panel.computation.denominatorLabel).toBe('400 px');
  });
});

describe('[G52 14-C-016] chưa có chuỗi kích thước nào', () => {
  it('gõ chiều dài trước khi kéo đoạn thì vế tử đã là số vừa gõ', async () => {
    const harness = await makeHarness();
    const mounted = mountHook(harness.gateway);
    await settle(mounted);

    await act(async () => {
      mounted.result.current.actions.onChangeRealLength('5000');
    });

    expect(mounted.result.current.model.panel.computation.numeratorLabel).toBe('5.000 mm');
  });
});

describe('[G52 14-C-026] bản vẽ không vuông trong khung vuông', () => {
  it('cùng 0,6 khung theo ngang và theo dọc là cùng một số pixel ảnh (ảnh object-contain)', async () => {
    const harness = await makeHarness();
    const base = harness.gateway;
    const gateway: ScaleCalibrationGateway = {
      ...base,
      readFloorDrawing: async (input) => {
        const read = await base.readFloorDrawing(input);

        return read.ok ? { ok: true, data: { ...read.data, widthPx: pixels(1600), heightPx: pixels(1200) } } : read;
      },
    };
    const mounted = mountHook(gateway);
    await settle(mounted);

    const lengthOf = async (end: ImageRatioPoint): Promise<string> => {
      await act(async () => {
        mounted.result.current.actions.onStartDrag({ x: 0.2, y: 0.2 });
      });
      await act(async () => {
        mounted.result.current.actions.onEndDrag(end);
      });

      return mounted.result.current.model.panel.computation.denominatorLabel;
    };

    const across = await lengthOf({ x: 0.8, y: 0.2 });
    const up = await lengthOf({ x: 0.2, y: 0.8 });

    expect(up).toBe(across);
  });
});

describe('[14-A-026] toast "Hoàn tác" sau khi áp tỉ lệ (A8) đi qua bus thông báo của phiên', () => {
  it('áp xong thì bus có thông báo "Áp dụng tỷ lệ" mang vé hoàn tác; bấm vé thì tỉ lệ cũ quay lại', async () => {
    const harness = await makeHarness();
    const mounted = mountHook(harness.gateway);
    await settle(mounted);
    await typeReference(mounted);
    const before = storedRatio();
    // Capture on publish: the fake clock inside `settleAsync` may run the 8 s window out before we look.
    let toast: Notification | undefined;
    const unsubscribe = appNotificationBus.subscribe((all) => {
      toast = all.find((n) => n.title.startsWith('Đã áp tỷ lệ ')) ?? toast;
    });

    await act(async () => {
      mounted.result.current.actions.onApply();
    });
    await settleAsync();
    unsubscribe();

    expect(toast?.undoTicket).toBeDefined();
    expect(storedRatio()).toBeCloseTo(REFERENCE_SCALE.millimetresPerPixel, 6);

    await act(async () => {
      toast?.undoTicket?.undo();
    });
    expect(storedRatio()).toBe(before);
  });
});

describe('D1 — bắt dính vào điểm máy dò và cảnh báo cửa đi', () => {
  const SIZE = { widthPx: pixels(1600), heightPx: pixels(1200) };
  // Khung vuông cạnh 1600, dải trống 200 px trên/dưới: tỉ lệ = (px + inset) / 1600.
  const TARGET: ScaleRawSnapTarget = { id: 's1', kind: 'wallVertex', xPx: pixels(1000), yPx: pixels(500) };
  const near: ImageRatioPoint = { x: 1004 / 1600, y: (503 + 200) / 1600 };

  async function dragTo(alt: boolean): Promise<ImageRatioPoint | undefined> {
    const harness = await makeHarness({ drawingSize: SIZE, snapTargets: [TARGET] });
    const mounted = mountHook(harness.gateway);
    await settle(mounted);
    await settleAsync();

    await act(async () => {
      mounted.result.current.actions.onStartDrag({ x: 0.2, y: 0.5 });
    });
    await act(async () => {
      mounted.result.current.actions.onMoveDrag(near, { isAxisLocked: false, isSnapDisabled: alt });
    });

    return mounted.result.current.model.canvas.referenceLine?.end;
  }

  it('đầu đoạn trong 8 px bắt vào đầu tường máy dò', async () => {
    const end = await dragTo(false);

    expect(end?.x).toBeCloseTo(1000 / 1600, 6);
    expect(end?.y).toBeCloseTo(700 / 1600, 6);
  });

  it('giữ Alt → không bắt vào điểm máy dò', async () => {
    const end = await dragTo(true);

    expect(Math.abs((end?.x ?? 0) * 1600 - 1000)).toBeGreaterThan(1);
  });

  /** Tầng đang mở có sẵn tỷ lệ — cùng cách dựng kho của khối review-1 F3. */
  beforeEach(() => {
    const graph = createSampleBuilding();
    const levels = graph.levels.map((level) =>
      level.id === FLOOR_ID ? { ...level, scaleMillimetresPerPixel: PROVISIONAL_RATIO } : level,
    );
    const spatial = normalizeSpatial({ ...graph, levels });

    useStore.getState().setSpatial(spatial, 'version-1', {
      floorRevisions: Object.fromEntries(spatial.byKind.level.map((id) => [id, 0])),
      projectId: PROJECT_ID,
    });
  });

  it('cửa đi rộng nhất theo tỷ lệ đang xét ngoài 700–1 000 mm → câu cảnh báo', async () => {
    const ratio: number = PROVISIONAL_RATIO;
    const harness = await makeHarness({ typicalDoorWidthPx: pixels(1410 / ratio) });
    const mounted = mountHook(harness.gateway);
    await settle(mounted);
    await settleAsync();

    const door = mounted.result.current.model.panel.crossChecks.find((row) => row.id === 'doorWidth');

    expect(door?.statusCode).toBe('attention');
    expect(door?.warning).toBe(
      `Cửa đi theo tỷ lệ này rộng ${formatLength(millimetres(1410), { unit: 'mm' })}, bất thường (thường 700–1 000). Kiểm lại số đã nhập.`,
    );
  });

  it('cửa đi 900 mm → không cảnh báo', async () => {
    const ratio: number = PROVISIONAL_RATIO;
    const harness = await makeHarness({ typicalDoorWidthPx: pixels(900 / ratio) });
    const mounted = mountHook(harness.gateway);
    await settle(mounted);
    await settleAsync();

    const door = mounted.result.current.model.panel.crossChecks.find((row) => row.id === 'doorWidth');

    expect(door?.warning).toBeUndefined();
  });
});

describe('D1 — chip số máy đọc được', () => {
  it('bấm chip → bật đo, điền sẵn chiều dài thật, hiện câu hướng dẫn kéo', async () => {
    const base = await makeHarness();
    const gateway = withScaleCapabilities(base.gateway, {
      readDimensionChips: async () => [
        { id: 'n1', text: '10275', valueMm: millimetres(10275), box: { min: { x: 0.1, y: 0.1 }, max: { x: 0.2, y: 0.12 } } },
      ],
    });
    const mounted = mountHook(gateway);
    await settle(mounted);
    await settleAsync();

    expect(mounted.result.current.model.panel.reference.chips?.map((chip) => chip.label)).toEqual(['10275']);

    await act(async () => {
      mounted.result.current.actions.onPickDimensionChip?.('n1');
    });

    const reference = mounted.result.current.model.panel.reference;
    expect(reference.realLengthText).toBe('10275');
    expect(reference.chips?.[0]?.isSelected).toBe(true);
    expect(reference.chipNotice).toBe(
      'Kéo từ đầu đến cuối đường kích thước có số 10275. Đoạn sẽ tự bắt vào đầu tường hoặc giao điểm gần nhất.',
    );
    expect(mounted.result.current.model.canvas.focusBox).toEqual({ min: { x: 0.1, y: 0.1 }, max: { x: 0.2, y: 0.12 } });
  });

  it('không có số → câu "Máy không đọc được số kích thước…"', async () => {
    const mounted = mountHook((await makeHarness()).gateway);
    await settle(mounted);
    await settleAsync();

    expect(mounted.result.current.model.panel.reference.chipNotice).toMatch(/^Máy không đọc được số kích thước trên bản vẽ này\./u);
  });
});
