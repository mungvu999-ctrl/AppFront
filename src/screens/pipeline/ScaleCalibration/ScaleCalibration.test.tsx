/**
 * Lượt kiểm của màn Hiệu chỉnh tỷ lệ.
 *
 * Bốn bộ khẳng định dùng chung (`expectSevenStates`, `expectAccessible`,
 * `expectVietnamese`, `expectNoRawColor`) cộng bốn phép đo của bản nghiệm thu:
 *
 * | mã | đo cái gì | ngưỡng |
 * |---|---|---|
 * | `[NGHIEM-1]` | bảy trạng thái của A11 | 7/7 |
 * | `[NGHIEM-2]` | kịch bản bốn bước: kéo 400 px → nhập 4800 → 12 mm/px → tự lưu → hoàn tác | cả bốn bước |
 * | `[NGHIEM-3]` | 250 mm/px hiện câu "tường dày 3 m" TRƯỚC khi áp, và KHÔNG chặn | cảnh báo có, nút vẫn bấm được |
 * | `[NGHIEM-4]` | phép tính không bị giấu — cả ba vế đứng trên màn | 3/3 |
 *
 * Hai lớp render, cố ý — cùng khuôn `ProcessingScreen.test.tsx`:
 *
 * - **Chỉ props** cho bảy trạng thái và ba bộ soát. {@link ScaleCalibration} là
 *   một hàm của props (mục D), nên bảy trạng thái vẽ được mà không cần mạng.
 *   Dữ liệu đến từ `ScaleCalibration.stories.tsx`, một bộ duy nhất cho cả story
 *   lẫn test: hai bộ song song là hai bộ sẽ lệch nhau (R-70).
 * - **Qua hook thật + view thật + cổng của bộ mẫu** cho hai kịch bản nghiệm thu.
 *   Đó là phần việc riêng của lượt ghép: `useScaleCalibration.test.ts` đã kiểm
 *   nửa "suy nghĩ" mà không cần DOM, còn ở đây điều đang được kiểm là con số ấy
 *   THẬT SỰ đi ra tới màn — `"12 mm/px"` phải đọc được trên DOM, không chỉ đúng
 *   trong một mô hình.
 *
 * ## Vì sao đoạn tham chiếu được kéo qua `actions` chứ không qua chuột
 *
 * `ImageRatioPoint` là tỉ lệ `0..1` của khung ảnh, và view tính nó từ
 * `getBoundingClientRect()`. jsdom trả về một hình chữ nhật rỗng cho mọi phần
 * tử, nên một `pointermove` giả lập ở đây đo được đúng con số không — nó sẽ kiểm
 * jsdom chứ không kiểm màn. Chiều còn lại của cùng kịch bản — gõ chiều dài thật,
 * bấm "Xác nhận tỷ lệ" — đi qua DOM THẬT, vì hai thao tác đó không phụ thuộc vào
 * hình học nào.
 */

import { readdirSync } from 'node:fs';
import { QueryClientProvider } from '@tanstack/react-query';
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { useEffect, type ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi, type MockInstance } from 'vitest';

import { __resetMockLayerState, createMockApiClient } from '@/api/__mocks__/client';
import type { ApiClient, SpatialApi } from '@/api/client';
import { createSampleBuilding, sampleLevelId } from '@/domain/spatial/__fixtures__/sampleBuilding';
import { normalizeSpatial } from '@/domain/spatial/normalize';
import type { LevelId } from '@/domain/spatial/types';
import { __resetFloorLayerSavers } from '@/hooks/useAutosave';
import { spatialLayerOf } from '@/lib/autosave/spatialLayerSave';
import {
  createScale,
  millimetresPerPixel,
  pixels,
  type MillimetresPerPixel,
  type Pixels,
  type Scale,
} from '@/domain/units/scale';
import { millimetres } from '@/domain/units/types';
import { RETRY_SCHEDULE_MS } from '@/lib/autosave/retrySchedule';
import { REDUCED_MOTION_QUERY } from '@/lib/motion';
import { formatLength } from '@/lib/format/measure';
import { formatNumber } from '@/lib/format/number';
import { expectAccessible } from '@/lib/testing/expectAccessible';
import { expectNoRawColor } from '@/lib/testing/expectNoRawColor';
import { expectSevenStates } from '@/lib/testing/expectSevenStates';
import { expectVietnamese } from '@/lib/testing/expectVietnamese';
import { createCleanBuildingScenario } from '@/lib/testing/fixtures';
import { installFakeClock, type FakeClock } from '@/lib/testing/fakeClock';
import { createTestQueryClient, renderWithProviders } from '@/lib/testing/render';
import {
  SEVEN_STATES,
  SEVEN_STATE_LABELS,
  type SevenStateScenario,
} from '@/lib/testing/sevenStateScenarios';
import { useStore } from '@/store';

import { ACCEPT_MACHINE_CONFIRM } from './machineScaleGate';
import { ScaleCalibration } from './ScaleCalibration';
import {
  compactScenario,
  confirmAllFloorsScenario,
  provisionalScaleScenario,
  scenarioFor,
} from './ScaleCalibration.stories';
import { ScaleCalibrationMethodDimension } from './ScaleCalibrationMethodDimension';
import {
  createScaleCalibrationGateway,
  withScaleCapabilities,
  type ScaleCalibrationGateway,
  type ScaleDrawingSnapshot,
  type ScaleRawDimensionString,
} from './scaleCalibrationGateway';
import { buildScaleCheck } from './scaleCheck';
import { useScaleCalibration } from './useScaleCalibration';
import type { ImageRatioPoint, ScaleCalibrationActions, UseScaleCalibrationResult } from './types';

const SCREEN_DIRECTORY = 'src/screens/pipeline/ScaleCalibration';
const PROJECT_ID = 'project-1';

/** Tầng của bộ mẫu chuẩn A14 — mã có tiền tố `L-`, tức một `LevelId` thật. */
const FLOOR_ID = sampleLevelId(0);

/** Tầng mock đã đo xong, dùng làm ảnh nền của lượt kiểm. */
const MEASURED_MOCK_FLOOR_ID = 'L2';

/** Số nhịp đồng hồ giả một lượt đọc của bộ mẫu cần để về. */
const SETTLE_TURNS = 20;

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

/** Nhãn thật của các ô bấm — hằng chuỗi của `ScaleCalibrationPanel.tsx`. */
const REAL_LENGTH_LABEL = 'Chiều dài thật';
const APPLY_LABEL = 'Xác nhận tỷ lệ';

const NOTICE_REGION_LABEL = 'Trạng thái của màn hiệu chỉnh tỷ lệ';
/** Nhãn thật của khung canvas — hằng chuỗi của `ScaleCalibrationCanvas.tsx`. */
const CANVAS_ARIA_LABEL = 'Bản vẽ đã nắn, kéo để vẽ đường tham chiếu';

/**
 * Cạnh của khung canvas trong lượt kiểm khung nhìn, tính bằng pixel CSS.
 *
 * Một con số bất kỳ nhưng KHÁC KHÔNG: `flyToBounds` bỏ qua lượt bay khi canvas
 * đo được `0 × 0`, nên chính con số không mới là thứ làm phép kiểm mất ý nghĩa.
 * Khung vuông vì `ScaleCalibrationCanvas` dựng nó bằng `aspect-square`.
 */
const CANVAS_FRAME_PX = 800;

/**
 * Mã lỗi máy đọc — A6 cho phép chữ hoa ở đúng chỗ này, và chỉ ở đây.
 *
 * Bỏ qua theo HÌNH DẠNG (CHỮ_HOA_CÓ_GẠCH_DƯỚI trọn chuỗi) chứ không liệt kê
 * từng từ, để `frame`/`not`/`found` không lọt vào từ vựng được duyệt và mở đường
 * cho tiếng Anh thật ở chỗ khác. Cùng khuôn `ProcessingScreen.test.tsx`.
 */
const MACHINE_ERROR_CODE = /^[A-Z][A-Z0-9]*(?:_[A-Z0-9]+)*$/;

/**
 * `Panel` và `pixel` là hai từ mượn đã có mặt trong `vi.json`.
 *
 * `pixel` đứng trong dòng dẫn xuất `"1 pixel = 12 mm · …"` (khoá
 * `scaleCalibration.currentScale.derivedLine`), và `panel` đã được duyệt từ màn
 * Xử lý. Ghi tên ở đây để chúng là quyết định đọc được, không phải hai chữ
 * tiếng Anh lọt lưới.
 *
 * Chữ thứ ba từng là `zoom` của `ZoomCluster` — đã trả (B-V1-48).
 */
const ALLOWED_WORDS = ['panel', 'pixel'];

/* -------------------------------------------------------------------------- */
/* Môi trường.                                                                 */
/* -------------------------------------------------------------------------- */

let clock: FakeClock;

class FakeResizeObserver {
  observe(): void {
    /* kích thước do chính test đặt, không có lượt đổi nào để báo */
  }
  unobserve(): void {
    /* như trên */
  }
  disconnect(): void {
    /* như trên */
  }
}

/**
 * `matchMedia` của jsdom, với đúng một câu trả lời được chọn.
 *
 * `isReducedMotion` chỉ áp cho truy vấn `prefers-reduced-motion`; mọi truy vấn
 * khác vẫn trả `false`, tức khung nhìn rộng — nếu không thì bật giảm chuyển động
 * sẽ vô tình bật luôn cách xếp thu gọn, và phép kiểm sẽ đo hai thứ một lúc.
 */
function setReducedMotion(isReducedMotion: boolean): void {
  Object.defineProperty(window, 'matchMedia', {
    writable: true,
    value: vi.fn().mockImplementation((query: string) => ({
      matches: isReducedMotion && query === REDUCED_MOTION_QUERY,
      media: query,
      onchange: null,
      addListener: vi.fn(),
      removeListener: vi.fn(),
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      dispatchEvent: vi.fn(),
    })),
  });
}

beforeEach(() => {
  // Mặc định: khung rộng, chuyển động đầy đủ.
  setReducedMotion(false);
  // jsdom không khai `ResizeObserver`. Gắn bản giả bằng `Object.defineProperty`
  // và gỡ nó bằng tay ở `afterEach`, để không lượt kiểm nào thừa hưởng bản giả
  // của lượt trước.
  Object.defineProperty(globalThis, 'ResizeObserver', {
    configurable: true,
    writable: true,
    value: FakeResizeObserver,
  });
  clock = installFakeClock();
  __resetFloorLayerSavers();
  __resetMockLayerState();
  seedStore();
});

afterEach(() => {
  cleanup();
  __resetFloorLayerSavers();
  clock.restore();
  Reflect.deleteProperty(globalThis, 'ResizeObserver');
  vi.restoreAllMocks();
});

/** Đồ thị của bộ mẫu chuẩn A14 trong store, và một ngăn xếp hoàn tác sạch. */
function seedStore(): void {
  const scenario = createCleanBuildingScenario();
  const graph = normalizeSpatial(scenario.graph);

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
 * Dấu thập phân tiếng Việt là dấu PHẨY, nên `formatNumber` — chiều thuận của
 * chính `parseLength` — là cách đúng để gõ một số vào ô nhập, kể cả trong test.
 */
function typedNumber(value: number): string {
  return formatNumber(value, { grouping: false });
}

/* -------------------------------------------------------------------------- */
/* Mảng thứ hai của `expectSevenStates`.                                       */
/* -------------------------------------------------------------------------- */

/** Chỉ để thoả kiểu; props thật đến từ `scenarioFor` của story. */
function scenarioIndex(): readonly SevenStateScenario[] {
  return SEVEN_STATES.map((state) => ({
    state,
    label: SEVEN_STATE_LABELS[state],
    rows: [],
    totalCount: scenarioFor(state).model.panel.dimension.rows.length,
    isLoading: state === 'loading',
    isCollapsed: state === 'collapsed',
    canView: state !== 'forbidden',
    error: null,
  }));
}

/* -------------------------------------------------------------------------- */
/* Bộ dựng của hai kịch bản nghiệm thu.                                        */
/* -------------------------------------------------------------------------- */

/**
 * Ảnh nền của một tầng, đọc từ chính bộ mẫu của `createMockApiClient()`.
 *
 * Mã tầng bị đổi sang mã của bộ mẫu chuẩn A14 vì store giữ đồ thị của bộ mẫu
 * đó: hai bộ dữ liệu đã có, và test nối chúng lại chứ không dựng bộ thứ ba.
 */
async function readMockDrawing(client: ApiClient): Promise<ScaleDrawingSnapshot> {
  const result = await client.quality.assess({
    floorId: MEASURED_MOCK_FLOOR_ID,
    projectId: PROJECT_ID,
  });

  if (!result.ok) {
    throw new Error('Không đọc được lượt đo chất lượng của bộ mẫu.');
  }

  const floor = result.data.floors.find((entry) => entry.floorId === MEASURED_MOCK_FLOOR_ID);

  if (floor === undefined || floor.measurement === undefined) {
    throw new Error('Bộ mẫu không có tầng đã đo nào để hiệu chỉnh.');
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

interface Harness {
  readonly gateway: ScaleCalibrationGateway;
  /** PUT #35 của bộ lưu lớp chung — nhận, trả lớp hiện tại của kho. */
  readonly writeLayer: MockInstance<SpatialApi['writeLayer']>;
}

/**
 * Chuỗi kích thước dựng từ 34 `Dimension` thật của bộ mẫu A14.
 *
 * Chiều dài pixel của mỗi hàng do chính {@link REFERENCE_SCALE} quy đổi từ giá
 * trị mi-li-mét của bộ mẫu, nên không phép chia nào xảy ra ở đây và không có
 * bảng dữ liệu thứ hai bịa tại chỗ (R-70). Hộp bao xếp so le xuống dưới để hai
 * hàng khác nhau bay tới hai chỗ khác nhau — đó là thứ phép kiểm khung nhìn cần.
 */
function sampleDimensionRows(): readonly ScaleRawDimensionString[] {
  const graph = createSampleBuilding();

  return graph.dimensions.map((dimension, index) => {
    const realLength = millimetres(dimension.valueMm);
    const top = index * 0.02;

    return {
      id: dimension.id,
      realLength,
      pixelLength: REFERENCE_SCALE.millimetresToPixels(realLength),
      confidence: dimension.confidence,
      boundingBox: { min: { x: 0.1, y: top }, max: { x: 0.3, y: top + 0.01 } },
    };
  });
}

/**
 * Cổng của bộ mẫu với đúng những việc đang kiểm được thay.
 *
 * Cùng lý lẽ `makeHarness` của `useScaleCalibration.test.ts`: chỉ thứ đang kiểm
 * mới bị thay, phần còn lại vẫn là cổng thật chạy trên bộ mẫu (R-70).
 */
interface HarnessOptions {
  readonly referenceWallWidthPx?: Pixels;
  readonly rows?: readonly ScaleRawDimensionString[];
}

async function makeHarness(options: HarnessOptions = {}): Promise<Harness> {
  const { referenceWallWidthPx, rows } = options;
  const client = createMockApiClient();
  const base = createScaleCalibrationGateway(client, { now: () => clock.epochMs() });
  const drawing = await readMockDrawing(client);
  const writeLayer = vi.spyOn(client.spatial, 'writeLayer').mockImplementation(async (input) => {
    const spatial = useStore.getState().spatial;
    const layer =
      spatial === null
        ? { furniture: [], openings: [], rooms: [], walls: [] }
        : spatialLayerOf(spatial, input.floorId as LevelId);

    return { data: { layer, revision: input.baseVersion + 1 }, ok: true };
  });

  const gateway = withScaleCapabilities(base, {
    supports: {
      dimensionStrings: rows !== undefined,
      referenceWallWidth: referenceWallWidthPx !== undefined,
    },
    readFloorDrawing: async () => ({ ok: true, data: drawing }),
    readDimensionStrings: async () =>
      rows === undefined
        ? base.readDimensionStrings({ floorId: FLOOR_ID, projectId: PROJECT_ID })
        : { supported: true, value: rows },
    readReferenceWallWidth: async () =>
      referenceWallWidthPx === undefined
        ? base.readReferenceWallWidth({ floorId: FLOOR_ID, projectId: PROJECT_ID })
        : { supported: true, value: referenceWallWidthPx },
  });

  return { gateway, writeLayer };
}

/**
 * Màn thật: hook thật lái view thật.
 *
 * `actions` được hé ra qua một `useEffect` để kịch bản kéo được đoạn tham chiếu
 * — xem ghi chú "Vì sao đoạn tham chiếu được kéo qua `actions`" ở đầu file. Mọi
 * khẳng định vẫn đọc DOM, không đọc mô hình.
 */
interface MountedScreen {
  readonly actions: () => ScaleCalibrationActions;
  readonly state: () => UseScaleCalibrationResult['model']['state'];
  readonly unmount: () => void;
}

function mountScreen(gateway: ScaleCalibrationGateway): MountedScreen {
  let latest: UseScaleCalibrationResult | null = null;

  function Wired(): ReactNode {
    const screenProps = useScaleCalibration({ projectId: PROJECT_ID, floorId: FLOOR_ID, gateway });

    useEffect(() => {
      latest = screenProps;
    });

    latest = screenProps;

    return <ScaleCalibration actions={screenProps.actions} model={screenProps.model} />;
  }

  const queryClient = createTestQueryClient();
  const rendered = render(
    <QueryClientProvider client={queryClient}>
      <Wired />
    </QueryClientProvider>,
  );

  const current = (): UseScaleCalibrationResult => {
    if (latest === null) {
      throw new Error('Màn chưa render lần nào.');
    }

    return latest;
  };

  return {
    actions: () => current().actions,
    state: () => current().model.state,
    unmount: rendered.unmount,
  };
}

/**
 * Chờ lượt đọc đầu tiên về.
 *
 * Đồng hồ ở đây là đồng hồ giả, nên `waitFor` — vốn chờ bằng đồng hồ thật — sẽ
 * đứng im mãi mãi. Cách chờ đúng dưới đồng hồ giả là tự đẩy thời gian.
 */
async function settle(mounted: MountedScreen): Promise<void> {
  for (let turn = 0; turn < SETTLE_TURNS; turn += 1) {
    if (mounted.state() !== 'loading') {
      return;
    }

    await act(async () => {
      await clock.advance(1);
    });
  }

  expect(mounted.state()).not.toBe('loading');
}

/**
 * Bề rộng ảnh, đọc ngược từ chính màn.
 *
 * Toạ độ `1` trên khung ảnh là mép phải, nên toạ độ con trỏ mà thanh trạng thái
 * báo cho điểm đó chính là bề rộng ảnh tính bằng pixel — không phải một con số
 * test tự giữ, mà là con số hook đang dùng. Không phép chia nào ở đây: đoạn dài
 * đúng 400 px được dựng bằng một `Scale` của M-02.
 */
function imageWidthPxOf(mounted: MountedScreen): Pixels {
  act(() => {
    mounted.actions().onMoveCursor({ x: 1, y: 1 });
  });

  const value = screen.getByLabelText(/^Toạ độ X:/u).textContent ?? '';

  return pixels(Number.parseFloat(value.replace(/[^0-9,]/gu, '').replace(',', '.')));
}

/** Kéo một đoạn dài đúng `REFERENCE_PIXEL_LENGTH` theo phương ngang. */
async function dragReferenceLine(mounted: MountedScreen): Promise<void> {
  const frame = createScale({
    pixelLength: imageWidthPxOf(mounted),
    realLength: millimetres(1),
  });
  const start: ImageRatioPoint = { x: 0, y: 0 };
  const end: ImageRatioPoint = { x: frame.pixelsToMillimetres(REFERENCE_PIXEL_LENGTH), y: 0 };

  await act(async () => {
    mounted.actions().onStartDrag(start);
  });
  await act(async () => {
    mounted.actions().onMoveDrag(end, { isAxisLocked: false });
  });
  await act(async () => {
    mounted.actions().onEndDrag(end);
  });
}

/**
 * `transform` của lớp mang khung nhìn, đọc thẳng từ DOM.
 *
 * Đây là chỗ `ViewportState` thật sự hiện ra: canvas viết
 * `translate(x, y) scale(zoom)` lên lớp `inset-0` nằm trong khung. Đọc nó thay
 * vì đọc mô hình là cách duy nhất chứng minh khung nhìn ĐỔI trên màn chứ không
 * chỉ đổi trong một đối tượng.
 */
function viewportTransform(): string {
  const frame = screen.getByRole('group', { name: CANVAS_ARIA_LABEL });
  const layer = frame.firstElementChild;

  return layer instanceof HTMLElement ? layer.style.transform : '';
}

/** Gõ vào ô "Chiều dài thật" — qua DOM thật, đúng đường người dùng đi. */
function typeRealLength(text: string): void {
  const field = screen.getByLabelText(new RegExp(REAL_LENGTH_LABEL, 'u'));

  act(() => {
    fireEvent.change(field, { target: { value: text } });
  });
}

/* -------------------------------------------------------------------------- */
/* [NGHIEM-1] Bảy trạng thái (A11, R-63).                                      */
/* -------------------------------------------------------------------------- */

// UX-49: đoạn đo đã xác nhận nằm ở localStorage — dọn sau mỗi ca.
afterEach(() => {
  window.localStorage.clear();
});

describe('ScaleCalibration — bảy trạng thái (A11, R-63)', () => {
  it('vẽ đủ bảy trạng thái, không lần nào ném lỗi và không lần nào ra màn trắng', () => {
    let rendered = 0;

    expectSevenStates((scenario) => {
      const { container, unmount } = renderWithProviders(
        <ScaleCalibration {...scenarioFor(scenario.state)} />,
      );
      rendered += 1;
      return { container, unmount };
    }, scenarioIndex());

    expect(rendered).toBe(SEVEN_STATES.length);
    expect(rendered).toBe(7);
  });

  it('trống nhưng tầng ĐÃ có tỷ lệ: không dựng khung vàng "Máy chưa đọc được"; chưa có tỷ lệ thì giữ', () => {
    const empty = scenarioFor('empty');
    const stored = {
      ...empty,
      model: {
        ...empty.model,
        panel: {
          ...empty.model.panel,
          scaleCheck: buildScaleCheck({ mmPerPx: 12, source: 'stored', shortEdgePx: 837, knownDimension: null }),
        },
      },
    };
    const { unmount } = renderWithProviders(<ScaleCalibration {...stored} />);
    expect(screen.queryByRole('region', { name: NOTICE_REGION_LABEL })).not.toBeInTheDocument();
    unmount();

    renderWithProviders(<ScaleCalibration {...empty} />);
    expect(screen.getByRole('region', { name: NOTICE_REGION_LABEL })).toBeInTheDocument();
  });

  it('trạng thái không có quyền: nút áp dụng biến MẤT, không phải mờ đi', () => {
    renderWithProviders(<ScaleCalibration {...scenarioFor('forbidden')} />);

    expect(screen.queryByRole('button', { name: APPLY_LABEL })).not.toBeInTheDocument();
  });

  it('UX41 U46: người xem không thấy ô "Chiều dài thật" hay nút đo nào', () => {
    const base = scenarioFor('forbidden');
    renderWithProviders(
      <ScaleCalibration {...base} model={{ ...base.model, panel: { ...base.model.panel, method: 'referenceLine' } }} />,
    );

    expect(screen.queryByLabelText(REAL_LENGTH_LABEL)).toBeNull();
    expect(screen.queryByRole('button', { name: 'Đặt đoạn đo giữa bản vẽ' })).toBeNull();
  });

  it('UX41 U04: chưa có đoạn thì có nút đặt đoạn đo bằng bàn phím', () => {
    const base = scenarioFor('partial');
    const onPlaceSegment = vi.fn();
    renderWithProviders(
      <ScaleCalibration
        {...base}
        actions={{ ...base.actions, onPlaceSegment }}
        model={{ ...base.model, panel: { ...base.model.panel, method: 'referenceLine' } }}
      />,
    );

    fireEvent.click(screen.getByRole('button', { name: 'Đặt đoạn đo giữa bản vẽ' }));
    expect(onPlaceSegment).toHaveBeenCalledTimes(1);
  });

  it('trạng thái lỗi nói câu hậu quả đúng MỘT lần, không "Mã lỗi" khi không có mã, và mở lối về tiền xử lý', () => {
    const scenario = scenarioFor('error');

    renderWithProviders(<ScaleCalibration {...scenario} />);

    // Tiêu đề khối lỗi một lần, câu hậu quả một lần — canvas không dựng dải thứ ba (BUG-341).
    expect(screen.getAllByText(/Không tìm thấy khung bản vẽ, ảnh có thể chưa thẳng/u)).toHaveLength(1);
    // G3-31: tiền xử lý không thất bại, nên không nói "thất bại".
    expect(screen.queryByText(/thất bại/u)).toBeNull();
    expect(screen.getAllByText(/tỷ lệ đo trên ảnh méo sẽ sai theo/u)).toHaveLength(1);
    expect(screen.queryByText(/Mã lỗi/u)).toBeNull();
    expect(
      screen.getByRole('button', { name: 'Quay lại bước tiền xử lý' }),
    ).toBeInTheDocument();
    // Tải lại không làm máy tìm ra khung: ảnh méo không có nút này (G3-31).
    expect(screen.queryByRole('button', { name: 'Tải lại ảnh' })).toBeNull();
  });

  it('thanh trạng thái 32px là `StatusBar` dùng chung, có mặt ở mọi trạng thái', () => {
    for (const state of SEVEN_STATES) {
      const { unmount } = renderWithProviders(<ScaleCalibration {...scenarioFor(state)} />);

      expect(screen.getByRole('status', { name: 'Thanh trạng thái' })).toBeInTheDocument();
      unmount();
    }
  });

  it('tỷ lệ tạm: không vẽ dải "hãy hiệu chỉnh" ngay trên màn hiệu chỉnh (G4b-11)', () => {
    renderWithProviders(<ScaleCalibration {...provisionalScaleScenario()} />);

    expect(screen.queryByText('Tỷ lệ tạm — số đo chưa tin được, hãy hiệu chỉnh tỷ lệ.')).toBeNull();
  });

  it('hỏi trước khi áp mọi tầng: hộp thoại A9 có câu, nút đồng ý và huỷ gọi đúng hành động', () => {
    const base = confirmAllFloorsScenario();
    const onConfirmAllFloors = vi.fn();
    const onCancelAllFloors = vi.fn();

    renderWithProviders(
      <ScaleCalibration {...base} actions={{ ...base.actions, onCancelAllFloors, onConfirmAllFloors }} />,
    );

    expect(screen.getByRole('dialog', { name: 'Áp tỷ lệ này cho 3 tầng có bản vẽ?' })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Huỷ' }));
    expect(onCancelAllFloors).toHaveBeenCalledTimes(1);
    fireEvent.click(screen.getByRole('button', { name: 'Áp cho mọi tầng' }));
    expect(onConfirmAllFloors).toHaveBeenCalledTimes(1);
  });

  it('khung hẹp vẫn dựng đủ canvas, panel và thanh trạng thái', () => {
    renderWithProviders(<ScaleCalibration {...compactScenario()} />);

    // Dưới 1024px panel xếp dưới bản vẽ, không còn là tấm trượt cố định đè lên nó (BUG-333).
    const panel = screen.getByLabelText('Bảng hiệu chỉnh tỷ lệ');
    expect(panel.className).not.toMatch(/(^|\s)fixed(\s|$)/u);
    expect(screen.getByLabelText('Khung bản vẽ để hiệu chỉnh tỷ lệ')).toBeInTheDocument();
    expect(screen.getByRole('status', { name: 'Thanh trạng thái' })).toBeInTheDocument();
  });
});

/* -------------------------------------------------------------------------- */
/* Khả năng tiếp cận, tiếng Việt, màu (R-72).                                   */
/* -------------------------------------------------------------------------- */

describe('ScaleCalibration — khả năng tiếp cận, tiếng Việt, màu (R-72)', () => {
  it('đi qua expectAccessible ở trạng thái đầy đủ nhất', () => {
    const { container } = renderWithProviders(<ScaleCalibration {...scenarioFor('success')} />);

    expectAccessible(container);
  });

  it('đi qua expectAccessible ở trạng thái một phần, nơi có cả cảnh báo lẫn danh sách', () => {
    const { container } = renderWithProviders(<ScaleCalibration {...scenarioFor('partial')} />);

    expectAccessible(container);
  });

  it('mọi chuỗi hiển thị là tiếng Việt có dấu', () => {
    const { container } = renderWithProviders(<ScaleCalibration {...scenarioFor('success')} />);

    expectVietnamese(container, { allowWords: ALLOWED_WORDS, ignore: [MACHINE_ERROR_CODE] });
  });

  it('lỗi đọc dùng tiêu đề của chính nó thay cho tiêu đề ảnh méo (B-V5-04)', () => {
    const scenario = scenarioFor('error');
    renderWithProviders(
      <ScaleCalibration
        {...scenario}
        model={{ ...scenario.model, errorTitle: 'Không tải được bản vẽ của tầng' }}
      />,
    );

    expect(screen.getByText('Không tải được bản vẽ của tầng')).toBeInTheDocument();
    expect(screen.queryByText('Không tìm thấy khung bản vẽ, ảnh có thể chưa thẳng')).toBeNull();
  });

  it('tầng chưa có bản vẽ: một lối ra "Tải bản vẽ lên", không "Tải lại ảnh" (BUG-337)', () => {
    const scenario = scenarioFor('error');
    const onGoToUpload = vi.fn();
    renderWithProviders(
      <ScaleCalibration
        actions={{ ...scenario.actions, onGoToUpload }}
        model={{ ...scenario.model, errorTitle: 'Tầng này chưa có bản vẽ', isNoDrawing: true }}
      />,
    );

    fireEvent.click(screen.getByRole('button', { name: 'Tải bản vẽ lên' }));
    expect(onGoToUpload).toHaveBeenCalledOnce();
    expect(screen.queryByRole('button', { name: 'Tải lại ảnh' })).toBeNull();
  });

  it('áp tỷ lệ xong: nút "Xem mô hình 3D →" dẫn sang 3D; chưa áp thì không có nút', () => {
    const scenario = scenarioFor('success');
    const onGoToViewer3d = vi.fn();
    const { unmount } = renderWithProviders(
      <ScaleCalibration actions={{ ...scenario.actions, onGoToViewer3d }} model={scenario.model} />,
    );

    fireEvent.click(screen.getByRole('button', { name: 'Xem mô hình 3D →' }));
    expect(onGoToViewer3d).toHaveBeenCalledOnce();
    unmount();
    renderWithProviders(<ScaleCalibration {...scenarioFor('partial')} />);
    expect(screen.queryByRole('button', { name: 'Xem mô hình 3D →' })).toBeNull();
  });

  it('lỗi có mã máy thật thì mã đi sau câu tiếng Việt', () => {
    const scenario = scenarioFor('error');
    renderWithProviders(<ScaleCalibration {...scenario} model={{ ...scenario.model, errorCode: 'NETWORK' }} />);

    expect(screen.getByText(/Mã lỗi: NETWORK/u)).toBeInTheDocument();
  });

  it('mọi chuỗi hiển thị của trạng thái lỗi cũng là tiếng Việt có dấu', () => {
    const { container } = renderWithProviders(<ScaleCalibration {...scenarioFor('error')} />);

    expectVietnamese(container, { allowWords: ALLOWED_WORDS, ignore: [MACHINE_ERROR_CODE] });
  });

  it('không mã màu thô trong bất kỳ file nào của thư mục màn (A1)', () => {
    for (const file of readdirSync(SCREEN_DIRECTORY)) {
      expectNoRawColor(`${SCREEN_DIRECTORY}/${file}`);
    }
  });
});

/* -------------------------------------------------------------------------- */
/* [NGHIEM-4] Phép tính không giấu được.                                       */
/* -------------------------------------------------------------------------- */

describe('ScaleCalibration — phép tính hiện đủ ba vế [NGHIEM-4]', () => {
  it('đặt cả tử số, mẫu số và kết quả xuống màn, không rút gọn thành mỗi kết quả', () => {
    const scenario = scenarioFor('success');
    const { computation } = scenario.model.panel;

    renderWithProviders(<ScaleCalibration {...scenario} />);

    const block = screen.getByLabelText('Phép tính ra tỷ lệ');

    expect(block).toHaveTextContent(computation.numeratorLabel);
    expect(block).toHaveTextContent(computation.denominatorLabel);
    expect(block).toHaveTextContent(computation.resultLabel);
  });

  it('thiếu một vế thì không hiện phép tính rỗng', () => {
    const scenario = scenarioFor('partial');

    renderWithProviders(<ScaleCalibration {...scenario} />);

    // Thiếu vế: không dựng phép tính rỗng "… ÷ — = —"; chỉ hiện khi đủ số.
    expect(scenario.model.panel.computation.isComplete).toBe(false);
    expect(screen.queryByLabelText('Phép tính ra tỷ lệ')).toBeNull();
  });
});

/* -------------------------------------------------------------------------- */
/* [NGHIEM-2] Kịch bản bốn bước, qua hook thật và view thật.                   */
/* -------------------------------------------------------------------------- */

describe('ScaleCalibration — kịch bản bốn bước [NGHIEM-2]', () => {
  it('kéo 400 px → nhập 4800 → màn hiện 12 mm/px → áp (PUT trước, kho sau) → hoàn tác trả về tỷ lệ cũ', async () => {
    const harness = await makeHarness();
    const mounted = mountScreen(harness.gateway);
    await settle(mounted);

    /* Bước 1 — kéo một đoạn dài đúng 400 px. */
    await dragReferenceLine(mounted);

    // Chưa nhập chiều dài thật: chưa có phép tính (chỉ hiện khi đủ số).
    expect(screen.queryByLabelText('Phép tính ra tỷ lệ')).toBeNull();

    /* Bước 2 — nhập 4800 mm, qua DOM thật. */
    typeRealLength(typedNumber(REFERENCE_REAL_LENGTH));

    /* Bước 3 — màn hiện đúng phép tính, cả ba vế. */
    const computationBlock = screen.getByLabelText('Phép tính ra tỷ lệ');

    expect(computationBlock).toHaveTextContent(formatLength(REFERENCE_REAL_LENGTH, { unit: 'mm' }));
    expect(computationBlock).toHaveTextContent(`${formatNumber(REFERENCE_PIXEL_LENGTH)} px`);
    // mm/px chỉ còn trong tooltip của số tỷ lệ lớn (số lớn hiện "≈ 1:N").
    expect(
      screen.getAllByTitle(`${REFERENCE_SCALE.millimetresPerPixel} mm/px`)[0],
    ).toBeInTheDocument();

    /* Bước 4a — áp tỷ lệ qua nút thật: PUT #35 trước, kho đổi khi máy chủ nhận (A7: không có nút lưu). */
    expect(storedRatio()).toBeUndefined();

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: APPLY_LABEL }));
    });

    for (let turn = 0; turn < SETTLE_TURNS; turn += 1) {
      await act(async () => {
        await vi.dynamicImportSettled();
        await clock.advance(1);
      });
    }

    expect(harness.writeLayer).toHaveBeenCalledTimes(1);
    expect(harness.writeLayer.mock.calls[0]?.[0].body.scaleMillimetresPerPixel).toBeCloseTo(
      REFERENCE_SCALE.millimetresPerPixel,
      6,
    );
    expect(storedRatio()).toBeCloseTo(REFERENCE_SCALE.millimetresPerPixel, 6);

    await act(async () => {
      await clock.advance(RETRY_SCHEDULE_MS[0]);
    });

    // Lượt tự lưu sau `commit` không gửi lại tỉ lệ máy chủ vừa nhận.
    expect(harness.writeLayer).toHaveBeenCalledTimes(1);

    /* Bước 4b — hoàn tác trả về tỷ lệ cũ (A8), qua đúng đường zundo. */
    await act(async () => {
      useStore.temporal.getState().undo();
    });

    expect(storedRatio()).toBeUndefined();

    mounted.unmount();
  });
});

/* -------------------------------------------------------------------------- */
/* [NGHIEM-5] Khung nhìn THẬT SỰ bay khi chọn một chuỗi kích thước (R-07).     */
/* -------------------------------------------------------------------------- */

describe('ScaleCalibration — nối kích thước canvas [NGHIEM-5]', () => {
  it('chọn một chuỗi kích thước làm `transform` của lớp khung nhìn ĐỔI GIÁ TRỊ', async () => {
    // Giảm chuyển động BẬT, và đó là điều kiện làm phép kiểm này đo được thứ nó
    // định đo. `flyToBounds` chạy 340 ms qua `requestAnimationFrame`, nên ở nhịp
    // đầu nó đặt lại đúng giá trị xuất phát — đọc `transform` ngay sau lời gọi
    // dưới chuyển động đầy đủ sẽ luôn thấy "chưa đổi", bất kể đường nối kích
    // thước có đúng hay không. Bật giảm chuyển động thì khung nhìn nhảy THẲNG
    // tới đích (mục B), nên giá trị đọc được là ĐÍCH thật mà `flyToBounds` tính
    // ra từ kích thước canvas — đúng con số sẽ sai nếu đường nối bị đứt.
    setReducedMotion(true);

    // `flyToBounds` tính `ViewportState` từ bề rộng và bề cao canvas ĐÃ RENDER.
    // jsdom trả về hình chữ nhật rỗng cho mọi phần tử, nên nếu không đặt kích
    // thước ở đây thì hook coi canvas là `0 × 0` và BỎ QUA lượt bay — phép kiểm
    // sẽ xanh vì sai lý do. Đặt một khung vuông đúng như `aspect-square` dựng ra.
    vi.spyOn(Element.prototype, 'getBoundingClientRect').mockReturnValue({
      bottom: CANVAS_FRAME_PX,
      height: CANVAS_FRAME_PX,
      left: 0,
      right: CANVAS_FRAME_PX,
      toJSON: () => ({}),
      top: 0,
      width: CANVAS_FRAME_PX,
      x: 0,
      y: 0,
    } as DOMRect);

    const rows = sampleDimensionRows();
    const harness = await makeHarness({ rows });
    const mounted = mountScreen(harness.gateway);
    await settle(mounted);

    const before = viewportTransform();

    // Hàng cuối nằm xa hàng đầu nhất trên khung ảnh, nên nếu khung nhìn có bay
    // thì nó bay một quãng thấy được — không phải một sai khác dưới một pixel.
    const target = rows[rows.length - 1];

    expect(target).toBeDefined();

    await act(async () => {
      mounted.actions().onSelectDimensionRow(target?.id ?? '');
    });

    const after = viewportTransform();

    expect(before).not.toBe('');
    expect(after).not.toBe(before);

    mounted.unmount();
  });
});

/* -------------------------------------------------------------------------- */
/* [NGHIEM-3] 250 mm/px cảnh báo, và KHÔNG chặn.                               */
/* -------------------------------------------------------------------------- */

describe('ScaleCalibration — cảnh báo tường ba mét [NGHIEM-3]', () => {
  it('nhập tỷ lệ 250 mm/px thì câu "tường dày 3 m" hiện TRƯỚC khi áp được', async () => {
    const harness = await makeHarness({ referenceWallWidthPx: REFERENCE_WALL_WIDTH });
    const mounted = mountScreen(harness.gateway);
    await settle(mounted);
    await dragReferenceLine(mounted);

    // Một đoạn 400 px dài 100.000 mm cho ra đúng 250 mm/px.
    typeRealLength(typedNumber(IMPLAUSIBLE_RATIO * REFERENCE_PIXEL_LENGTH));

    // Nét tường 12 px ở 250 mm/px là một bức tường dày ba mét — đúng câu đặc tả nêu.
    const impliedThickness = millimetres(IMPLAUSIBLE_RATIO * REFERENCE_WALL_WIDTH);
    const warningRegion = screen.getAllByLabelText('Cảnh báo về tỷ lệ')[0];

    expect(warningRegion).toBeDefined();
    expect(warningRegion).toHaveTextContent(formatLength(impliedThickness));

    // Cảnh báo nói ra hậu quả, không khoá nút: A9 không áp vì thao tác này hoàn
    // tác được, nên không hộp thoại nào được dựng ra và nút vẫn bấm được.
    const applyButton = screen.getByRole('button', { name: APPLY_LABEL });

    expect(applyButton).toBeEnabled();
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();

    mounted.unmount();
  });
});

/* -------------------------------------------------------------------------- */
/* QA-04c — SCR-14 (BUG-587, 596, 598, 607, 609, 338).                         */
/* -------------------------------------------------------------------------- */

describe('ScaleCalibration — QA-04c SCR-14', () => {
  /** Khung 800 px đo được, và `setPointerCapture` mà jsdom không có. */
  function measureFrame(): void {
    vi.spyOn(Element.prototype, 'getBoundingClientRect').mockReturnValue({
      bottom: CANVAS_FRAME_PX,
      height: CANVAS_FRAME_PX,
      left: 0,
      right: CANVAS_FRAME_PX,
      toJSON: () => ({}),
      top: 0,
      width: CANVAS_FRAME_PX,
      x: 0,
      y: 0,
    } as DOMRect);
    Object.defineProperty(Element.prototype, 'setPointerCapture', { configurable: true, value: vi.fn() });
  }

  const handle = (name: 'Đầu' | 'Cuối'): HTMLElement =>
    screen.getByRole('button', { name: new RegExp(`^${name} đoạn tham chiếu`, 'u') });

  it('nhấn tay cầm kéo đúng đầu đó, mũi tên trên tay cầm nhích đúng đầu đó (BUG-587)', async () => {
    measureFrame();
    const harness = await makeHarness();
    const mounted = mountScreen(harness.gateway);
    await settle(mounted);
    await act(async () => {
      mounted.actions().onStartDrag({ x: 0, y: 0 });
    });
    await act(async () => {
      mounted.actions().onEndDrag({ x: 0.5, y: 0 });
    });

    const frame = screen.getByRole('group', { name: CANVAS_ARIA_LABEL });
    const endLeft = handle('Cuối').style.left;

    fireEvent.pointerDown(handle('Đầu'), { button: 0, clientX: 0, clientY: 0, pointerId: 1 });
    fireEvent.pointerMove(frame, { clientX: 80, clientY: 0, pointerId: 1 });
    fireEvent.pointerUp(frame, { clientX: 80, clientY: 0, pointerId: 1 });

    expect(handle('Cuối').style.left).toBe(endLeft);
    expect(handle('Đầu').style.left).toBe('10%');

    const startLeft = handle('Đầu').style.left;
    fireEvent.keyDown(handle('Đầu'), { key: 'ArrowRight' });
    expect(handle('Đầu').style.left).not.toBe(startLeft);
    expect(handle('Cuối').style.left).toBe(endLeft);

    mounted.unmount();
  });

  it('[14-E-013] con lăn trên khung đăng ký trình nghe wheel không-passive để preventDefault có hiệu lực (SCV:270-277)', async () => {
    measureFrame();
    const harness = await makeHarness();
    const wheelOptions: unknown[] = [];
    const realAdd = HTMLDivElement.prototype.addEventListener;
    const addSpy = vi.spyOn(HTMLDivElement.prototype, 'addEventListener').mockImplementation(function (
      this: EventTarget,
      type: string,
      listener: EventListenerOrEventListenerObject,
      options?: boolean | AddEventListenerOptions,
    ) {
      if (type === 'wheel' && (this as Element).getAttribute?.('aria-label') === CANVAS_ARIA_LABEL) {
        wheelOptions.push(options);
      }
      realAdd.call(this, type, listener, options);
    });
    const mounted = mountScreen(harness.gateway);
    await settle(mounted);
    addSpy.mockRestore();

    expect(wheelOptions).toContainEqual(expect.objectContaining({ passive: false }));

    mounted.unmount();
  });

  it('Enter trên nút không bị phím tắt nuốt, mũi tên trên radio không nhích đầu đoạn (BUG-597)', async () => {
    measureFrame();
    const harness = await makeHarness();
    const mounted = mountScreen(harness.gateway);
    await settle(mounted);
    await act(async () => {
      mounted.actions().onStartDrag({ x: 0.2, y: 0.2 });
    });
    await act(async () => {
      mounted.actions().onEndDrag({ x: 0.6, y: 0.2 });
    });
    const endLeft = handle('Cuối').style.left;
    const group = screen.getByRole('radiogroup', { name: 'Phạm vi áp tỷ lệ' });
    const radio = within(group).getAllByRole('radio')[0] as HTMLElement;

    fireEvent.keyDown(radio, { key: 'ArrowRight' });
    expect(handle('Cuối').style.left).toBe(endLeft);

    const notPrevented = fireEvent.keyDown(screen.getByRole('button', { name: 'Xác nhận tỷ lệ' }), { key: 'Enter' });
    expect(notPrevented).toBe(true);

    mounted.unmount();
  });

  it('cụm thu phóng lái khung nhìn và không vẽ đoạn mới (BUG-596)', async () => {
    measureFrame();
    const harness = await makeHarness();
    const mounted = mountScreen(harness.gateway);
    await settle(mounted);

    /* Một nút "N% ▾" trên bản vẽ; các mục phóng nằm trong danh sách của nó. */
    fireEvent.click(screen.getByRole('button', { name: /^Mức thu phóng / }));
    const zoomIn = screen.getByRole('button', { name: 'Phóng to' });
    fireEvent.pointerDown(zoomIn, { button: 0, clientX: 700, clientY: 700, pointerId: 1 });
    fireEvent.click(zoomIn);

    expect(viewportTransform()).toContain('scale(1.25)');
    expect(screen.queryByRole('button', { name: /^Đầu đoạn tham chiếu/u })).toBeNull();

    fireEvent.click(screen.getByRole('button', { name: 'Vừa khung nhìn' }));
    expect(viewportTransform()).toBe('translate(0px, 0px) scale(1)');

    mounted.unmount();
  });

  it('Enter trên canvas đặt đoạn ở tâm và nói đoạn còn quá ngắn (BUG-607)', async () => {
    const harness = await makeHarness();
    const mounted = mountScreen(harness.gateway);
    await settle(mounted);

    fireEvent.keyDown(screen.getByRole('group', { name: CANVAS_ARIA_LABEL }), { key: 'Enter' });

    expect(handle('Đầu')).toBeInTheDocument();
    expect(screen.getByText(/^Đoạn quá ngắn/u)).toBeInTheDocument();

    mounted.unmount();
  });

  it('con trỏ (đã bị bắt) ra khỏi khung giữa lúc kéo thì đoạn bị huỷ (14-A-014)', async () => {
    measureFrame();
    const harness = await makeHarness();
    const mounted = mountScreen(harness.gateway);
    await settle(mounted);
    const frame = screen.getByRole('group', { name: CANVAS_ARIA_LABEL });

    fireEvent.pointerDown(frame, { button: 0, clientX: 160, clientY: 320, pointerId: 1 });
    fireEvent.pointerMove(frame, { clientX: 400, clientY: 320, pointerId: 1 });
    expect(handle('Cuối')).toBeInTheDocument();
    fireEvent.pointerMove(frame, { clientX: CANVAS_FRAME_PX + 60, clientY: 320, pointerId: 1 });

    expect(screen.queryByRole('button', { name: /^Cuối đoạn tham chiếu/u })).toBeNull();

    mounted.unmount();
  });

  it('đang kéo đoạn, tiêu điểm ở "Chiều dài thật": Esc vẫn huỷ đoạn (14-E-004, QD-004)', async () => {
    measureFrame();
    const harness = await makeHarness();
    const mounted = mountScreen(harness.gateway);
    await settle(mounted);
    const frame = screen.getByRole('group', { name: CANVAS_ARIA_LABEL });

    fireEvent.pointerDown(frame, { button: 0, clientX: 160, clientY: 320, pointerId: 1 });
    fireEvent.pointerMove(frame, { clientX: 400, clientY: 320, pointerId: 1 });
    expect(handle('Cuối')).toBeInTheDocument();
    const field = screen.getByLabelText(new RegExp(REAL_LENGTH_LABEL, 'u'));
    field.focus();
    fireEvent.keyDown(field, { key: 'Escape', code: 'Escape' });

    expect(screen.queryByRole('button', { name: /^Cuối đoạn tham chiếu/u })).toBeNull();

    mounted.unmount();
  });

  it('kéo tới đúng mép ảnh (lệch dưới 1px do làm tròn) thì đoạn không bị huỷ (14-C-023)', async () => {
    measureFrame();
    const harness = await makeHarness();
    const mounted = mountScreen(harness.gateway);
    await settle(mounted);
    const frame = screen.getByRole('group', { name: CANVAS_ARIA_LABEL });

    fireEvent.pointerDown(frame, { button: 0, clientX: 400, clientY: 400, pointerId: 1 });
    fireEvent.pointerMove(frame, { clientX: CANVAS_FRAME_PX + 0.4, clientY: 400, pointerId: 1 });

    expect(handle('Cuối')).toBeInTheDocument();

    mounted.unmount();
  });

  it('nhích mũi tên qua mép ảnh thì đầu đoạn bị chặn trong khung (14-C-023)', async () => {
    measureFrame();
    const harness = await makeHarness();
    const mounted = mountScreen(harness.gateway);
    await settle(mounted);
    await act(async () => {
      mounted.actions().onStartDrag({ x: 0.5, y: 0.5 });
    });
    await act(async () => {
      mounted.actions().onEndDrag({ x: 1, y: 0.5 });
    });
    await act(async () => {
      mounted.actions().onNudgeEndpoint('end', 'right', 'fine');
      mounted.actions().onNudgeEndpoint('end', 'right', 'fine');
    });

    expect(parseFloat(handle('Cuối').style.left)).toBeLessThanOrEqual(100);

    mounted.unmount();
  });

  it('S-11: panel trái nói làm gì + trạng thái, panel phải tự kiểm mm/px, 1:N theo DPI và bảng đối chiếu', () => {
    const scenario = scenarioFor('success');
    renderWithProviders(<ScaleCalibration {...scenario} />);

    expect(screen.getByRole('heading', { name: 'Tỷ lệ bản vẽ' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Kiểm tra con số' })).toBeInTheDocument();
    const check = scenario.model.panel.scaleCheck;
    expect(check).toBeDefined();
    // Một nguồn: chip trái và khối số phải cùng đọc `scaleCheck`.
    expect(screen.getByText(check?.status.label ?? '')).toBeInTheDocument();
    expect(screen.getByText(check?.headline ?? '')).toBeInTheDocument();
    expect(screen.queryByRole('region', { name: 'Đối chiếu nhanh: 1 px bằng bao nhiêu mm' })).toBeNull();
  });

  it('thu gọn bảng thì cột co lại, chỉ còn nút "Bung bảng" (BUG-609)', () => {
    const scenario = scenarioFor('collapsed');
    renderWithProviders(<ScaleCalibration {...scenario} />);

    const panel = screen.getByLabelText('Bảng hiệu chỉnh tỷ lệ');
    expect(panel.className).toContain('md:w-12');
    expect(panel.className).not.toContain('xl:w-[288px]');
    // Dưới 1280 panel chung cột với panel trái: cả cột co về 48 px (S-11).
    expect(panel.parentElement?.className).toContain('md:w-12');
    expect(screen.getByRole('button', { name: 'Bung bảng' })).toBeInTheDocument();
  });

  it('xung đột lưu hiện dải có "Tải lại" (BUG-598)', () => {
    const scenario = scenarioFor('partial');
    const onReload = vi.fn();
    renderWithProviders(
      <ScaleCalibration
        {...scenario}
        model={{
          ...scenario.model,
          saveBlock: { confirm: null, kind: 'reload', message: 'Tầng này vừa được sửa ở nơi khác.', onReload },
        }}
      />,
    );

    fireEvent.click(screen.getByRole('button', { name: 'Tải lại' }));
    expect(onReload).toHaveBeenCalledOnce();
  });
});

describe('ScaleCalibration — màn sập có biểu tượng (BUG-338)', () => {
  it('khung dự phòng vẽ biểu tượng thật, không phải vòng tròn trống', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const { ScaleCalibrationContainer } = await import('./ScaleCalibration.container');
    const broken = new Proxy({} as ScaleCalibrationGateway, {
      get: () => {
        throw new Error('cổng hỏng');
      },
    });

    const { container } = renderWithProviders(
      <ScaleCalibrationContainer floorId={FLOOR_ID} gateway={broken} projectId={PROJECT_ID} />,
    );

    expect(container.querySelector('svg')).not.toBeNull();
    expect(container.querySelector('.rounded-full.bg-state-violation-tint')).toBeNull();
  });
});

describe('[G51a] nhãn đo trực tiếp cần cỡ khung ảnh', () => {
  it('khung ảnh gắn SAU skeleton vẫn được đo — ResizeObserver theo dõi nó', () => {
    const observed: Element[] = [];
    Object.defineProperty(globalThis, 'ResizeObserver', {
      configurable: true,
      writable: true,
      value: class {
        observe(target: Element): void {
          observed.push(target);
        }
        unobserve(): void {
          /* không cần */
        }
        disconnect(): void {
          /* không cần */
        }
      },
    });
    const scenario = scenarioFor('success');
    const loading = { ...scenario.model, canvas: { ...scenario.model.canvas, isImageLoading: true } };
    const { rerender } = renderWithProviders(<ScaleCalibration actions={scenario.actions} model={loading} />);
    const before = observed.length;

    rerender(<ScaleCalibration actions={scenario.actions} model={scenario.model} />);

    expect(observed.length).toBeGreaterThan(before);
    expect(observed.some((target) => target.className.includes('origin-top-left'))).toBe(true);
  });
});

describe('R9 phản biện X F5: số máy ước lượng / chưa xác định — đo trước, áp sau', () => {
  const measureFirstModel = (acceptLabel?: string) => {
    const base = scenarioFor('partial');
    return {
      base,
      model: {
        ...base.model,
        panel: {
          ...base.model.panel,
          canApply: false,
          measureFirst: { label: 'Đo một đoạn đã biết', ...(acceptLabel === undefined ? {} : { acceptLabel }) },
        },
      },
    };
  };

  it('nút chính là "Đo một đoạn đã biết" (đặt đoạn), nút áp khoá; nút phụ mở hộp xác nhận', () => {
    const { base, model } = measureFirstModel('Dùng tạm tỷ lệ máy ước lượng');
    const onPlaceSegment = vi.fn();
    const onRequestAcceptMachine = vi.fn();
    renderWithProviders(<ScaleCalibration actions={{ ...base.actions, onPlaceSegment, onRequestAcceptMachine }} model={model} />);

    fireEvent.click(screen.getByRole('button', { name: 'Đo một đoạn đã biết' }));
    expect(onPlaceSegment).toHaveBeenCalledTimes(1);
    expect(screen.getByRole('button', { name: 'Xác nhận tỷ lệ' })).toBeDisabled();
    fireEvent.click(screen.getByRole('button', { name: 'Dùng tạm tỷ lệ máy ước lượng' }));
    expect(onRequestAcceptMachine).toHaveBeenCalledTimes(1);
  });

  it('nguồn mâu thuẫn (không acceptLabel): không có lối nhận số máy', () => {
    const { base, model } = measureFirstModel();
    renderWithProviders(<ScaleCalibration actions={{ ...base.actions, onRequestAcceptMachine: vi.fn() }} model={model} />);

    expect(screen.queryByRole('button', { name: 'Dùng tạm tỷ lệ máy ước lượng' })).toBeNull();
  });

  it('hộp xác nhận nói rõ sai tới ±40 %; đồng ý mới gọi nhận số máy', () => {
    const { base, model } = measureFirstModel('Dùng tạm tỷ lệ máy ước lượng');
    const onConfirmAcceptMachine = vi.fn();
    const onCancelAcceptMachine = vi.fn();
    renderWithProviders(
      <ScaleCalibration
        actions={{ ...base.actions, onConfirmAcceptMachine, onCancelAcceptMachine }}
        model={{ ...model, acceptMachineConfirm: ACCEPT_MACHINE_CONFIRM }}
      />,
    );

    expect(screen.getByRole('dialog').textContent).toContain('±40 %');
    fireEvent.click(screen.getByRole('button', { name: 'Vẫn dùng số máy' }));
    expect(onConfirmAcceptMachine).toHaveBeenCalledTimes(1);
  });
});

describe('[G57] hộp thoại "áp mọi tầng" đóng thì tiêu điểm về "Xác nhận tỷ lệ"', () => {
  it('nút áp bị khoá lúc đọc mọi tầng (tiêu điểm rơi về body) vẫn được trả tiêu điểm khi Esc', async () => {
    const scenario = scenarioFor('success');
    const confirm = { title: 'Áp tỷ lệ cho 2 tầng?', message: 'Câu hỏi.', confirmLabel: 'Áp dụng', cancelLabel: 'Huỷ' };
    const { rerender } = renderWithProviders(
      <ScaleCalibration actions={scenario.actions} model={{ ...scenario.model, allFloorsConfirm: confirm }} />,
    );
    await act(async () => {
      await clock.advance(20);
    });
    (document.activeElement as HTMLElement | null)?.blur();

    rerender(<ScaleCalibration actions={scenario.actions} model={scenario.model} />);

    expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Xác nhận tỷ lệ' }));
  });
});

describe('ScaleCalibrationMethodDimension — không có số (UX-02)', () => {
  it('vẫn có nút "Phóng to vùng có số"; bấm một lần là gọi đặt đoạn đo gợi ý', () => {
    const onZoomToNumbers = vi.fn();
    render(
      <ScaleCalibrationMethodDimension
        actions={{ onHoverDimensionRow: vi.fn(), onSelectDimensionRow: vi.fn(), onZoomToNumbers }}
        dimension={{ rows: [], selectedRowId: null, emptyNotice: null, lowConfidenceNotice: null, manualCalibrationReason: null }}
      />,
    );
    fireEvent.click(screen.getByRole('button', { name: /Phóng to vùng có số/u }));
    expect(onZoomToNumbers).toHaveBeenCalledTimes(1);
  });
});
