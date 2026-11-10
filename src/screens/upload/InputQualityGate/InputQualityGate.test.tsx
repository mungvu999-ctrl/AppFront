/**
 * Lượt kiểm của màn Cổng chất lượng đầu vào.
 *
 * Bốn bộ khẳng định dùng chung (`expectSevenStates`, `expectAccessible`,
 * `expectVietnamese`, `expectNoRawColor`) cộng bốn phép đo của bản nghiệm thu:
 *
 * | mã | đo cái gì | ngưỡng |
 * |---|---|---|
 * | `[NGHIEM-A]` | bảy trạng thái của A11 | 7/7 |
 * | `[NGHIEM-E]` | cổng xác nhận khi có chỉ số mức Kém | chặn → tích ô → qua |
 * | `[NGHIEM-F]` | liên kết hai chiều thẻ phát hiện ↔ vùng ảnh | đúng 1 vùng sáng |
 * | `[NGHIEM-G]` | ArrowLeft/ArrowRight đổi tầng đang xem | đúng 1 tầng đang xem |
 *
 * Hai lớp render, cố ý:
 *
 * - **Chỉ props** cho bảy trạng thái và ba bộ soát — `InputQualityGateView` là
 *   một hàm của props (mục D), nên bảy trạng thái vẽ được mà không cần mạng.
 *   Dữ liệu đến từ `InputQualityGate.stories.tsx`, một bộ duy nhất cho cả story
 *   lẫn test: hai bộ song song là hai bộ sẽ lệch nhau (R-70).
 * - **Qua container + cổng dữ liệu giả** cho bốn tiêu chí tương tác. Cổng xác
 *   nhận, liên kết hai chiều, phím mũi tên và toast hoàn tác đều là hành vi của
 *   hook; chứng minh chúng bằng cách gọi thẳng hook thì chứng minh chưa xong —
 *   phải bấm được trên giao diện thì mới là thứ người dùng có.
 *
 * `expectNoRawColor` quét **cả thư mục** màn, không một file, vì A1 nói về tầng
 * giao diện chứ không về một file cụ thể.
 */

import { readdirSync } from 'node:fs';
import { act, cleanup, fireEvent, screen, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { createMockApiClient } from '@/api/__mocks__/client';
import type { ApiClient } from '@/api/client';
import { expectAccessible } from '@/lib/testing/expectAccessible';
import { expectNoRawColor } from '@/lib/testing/expectNoRawColor';
import { expectSevenStates } from '@/lib/testing/expectSevenStates';
import { expectVietnamese } from '@/lib/testing/expectVietnamese';
import { installFakeClock, type FakeClock } from '@/lib/testing/fakeClock';
import { renderWithProviders } from '@/lib/testing/render';
import {
  SEVEN_STATES,
  SEVEN_STATE_LABELS,
  type SevenStateScenario,
} from '@/lib/testing/sevenStateScenarios';

import { InputQualityGateView } from './InputQualityGate';
import { InputQualityGateContainer } from './InputQualityGate.container';
import {
  acknowledgedScenario,
  confirmScenario,
  highlightedScenario,
  noDrawingScenario,
  regionIdOf,
  SAMPLE_FINDINGS,
  SAMPLE_FLOORS,
  scenarioFor,
  writeErrorScenario,
} from './InputQualityGate.stories';
import { createInputQualityGateway } from './inputQualityGateway';
import type { InputQualityToast } from './useInputQualityGate';

const SCREEN_DIRECTORY = 'src/screens/upload/InputQualityGate';
const PROJECT_ID = 'project-1';

/**
 * Một nhịp nhỏ để react-query đi hết vòng promise của nó.
 *
 * Cùng con số và cùng lý do như `FloorUploadScreen.test.tsx`: lượt đọc danh
 * sách tầng cộng lượt đọc kết quả đo là hai lượt nối tiếp, mỗi lượt vài vòng
 * microtask cộng một nhịp hẹn giờ — vét microtask một lần là chưa đủ.
 */
const SETTLE_STEP_MS = 10;

/** Độ trễ giả của máy chủ khi ghi — dài hơn mọi hoạt ảnh rời đi. */
const SLOW_SERVER_MS = 1000;

/**
 * `px` là đơn vị, không phải chữ tiếng Anh sót lại.
 *
 * Nó có mặt trong câu khuyến nghị độ phân giải và trong câu hậu quả của phát
 * hiện `RESOLUTION_TOO_LOW`, cả hai đều do hook ghép từ số đo thật.
 */
const UNIT_WORDS = ['px'];

/**
 * **Nợ A-6b — nợ CỦA REPO, không phải của màn Cổng chất lượng đầu vào.**
 *
 * `to`: `"Phóng to"` là tiếng Việt đúng, `expectVietnamese` chấm nhầm nó thành
 * từ tiếng Anh còn sót — một dương tính giả, không phải một lỗi. Nợ "zoom" của
 * `ZoomCluster` đã trả (B-V1-48): "Cụm thu phóng", "Mức thu phóng …".
 */
const SHARED_COMPONENT_DEBT_WORDS = ['to'];

/** Mọi từ được cho qua khi soát tiếng Việt — đơn vị thật, cộng nợ đã nêu tên. */
const ALLOWED_WORDS = [...UNIT_WORDS, ...SHARED_COMPONENT_DEBT_WORDS];

/**
 * **Nợ A-12b — nợ CỦA REPO, không phải của màn Cổng chất lượng đầu vào.**
 *
 * `Table.Row` (`src/components/ui/Table.tsx:84`) đặt `outline-hidden` kèm
 * `tabIndex={-1}` và chỉ vẽ viền tiêu điểm khi prop `focused` bật — viền vẽ
 * theo TRẠNG THÁI chứ không theo `:focus-visible`, nên bàn phím không có viền
 * nào. Đó là nợ có sẵn của `Table.Row`, nên bài bỏ qua `'tbody > tr'`.
 *
 * Màn này cần thêm `'thead > tr'`: bảng bốn tầng có hàng tiêu đề, và
 * `Table.Header` cũng dựng bằng `Table.Row` nên hàng ấy dính cùng một
 * `rowClassName`. Nêu đích danh hai chỗ thay vì bỏ qua trơn `'tr'`, để một
 * `<tr>` nào khác mọc lên sau này vẫn bị soát.
 *
 * `ignoreSelector` chỉ loại **chính** phần tử khớp
 * (`expectAccessible.ts:798-806`), nên mọi thứ bên trong hàng — badge mức, ô
 * tên tầng — vẫn được soát đầy đủ.
 *
 * Cách trả nợ: thêm `focus-visible:ring-2 focus-visible:ring-offset-2` vào
 * `rowClassName` của `Table.tsx:84`, rồi xoá đúng hằng này và mọi nơi dùng nó.
 */
const TABLE_ROW_DEBT_SELECTOR = 'tbody > tr, thead > tr';

/** Tên tầng đã đo, mang đúng ba phát hiện — mọi tiêu chí tương tác đứng ở đây. */
const MEASURED_FLOOR_NAME = 'Tầng 1';
/** Tầng mở màn: tầng đầu danh sách dự án, và tầng đó chưa đo. */
const SEED_FLOOR_NAME = 'Tầng hầm';

/* -------------------------------------------------------------------------- */
/* Bộ dựng.                                                                    */
/* -------------------------------------------------------------------------- */

/** Mảng thứ hai của `expectSevenStates` chỉ để thoả kiểu; props thật đến từ `scenarioFor`. */
function scenarioIndex(): readonly SevenStateScenario[] {
  return SEVEN_STATES.map((state) => ({
    state,
    label: SEVEN_STATE_LABELS[state],
    rows: [],
    totalCount: SAMPLE_FLOORS.length,
    isLoading: state === 'loading',
    isCollapsed: state === 'collapsed',
    canView: state !== 'forbidden',
    error: null,
  }));
}

interface MountOptions {
  readonly client?: ApiClient;
  readonly onToast?: (toast: InputQualityToast) => void;
  readonly onNavigate?: (path: string) => void;
}

/**
 * Màn thật, đã nối vào cổng dữ liệu giả, đọc xong lượt đầu.
 *
 * Cổng dựng bằng `createInputQualityGateway(createMockApiClient())` — đúng phép
 * ánh xạ bản sản phẩm dùng, chỉ khác nguồn dữ liệu (R-70). Không có bản giả nào
 * viết riêng cho test, nên một lỗi trong tầng ánh xạ vẫn bị bắt ở đây.
 */
async function mountScreen(clock: FakeClock, options: MountOptions = {}) {
  const gateway = createInputQualityGateway(options.client ?? createMockApiClient());
  const rendered = renderWithProviders(
    <InputQualityGateContainer
      gateway={gateway}
      projectId={PROJECT_ID}
      {...(options.onToast !== undefined ? { onToast: options.onToast } : {})}
      {...(options.onNavigate !== undefined ? { onNavigate: options.onNavigate } : {})}
    />,
  );

  // Ba nhịp, không một: lượt đọc danh sách tầng và lượt đọc kết quả đo là hai
  // lượt NỐI TIẾP — lượt sau chỉ bắt đầu khi lượt trước đã cho ra mã tầng mồi —
  // nên một nhịp mới chỉ đủ cho lượt đầu và bảng tầng vẫn chưa có gì để vẽ.
  await settle(clock);
  await settle(clock);
  await settle(clock);

  return rendered;
}

async function settle(clock: FakeClock): Promise<void> {
  await act(async () => {
    await clock.advance(SETTLE_STEP_MS);
    await clock.flushMicrotasks();
    await clock.advance(SETTLE_STEP_MS);
    await clock.flushMicrotasks();
  });
}

/** Hàng bảng tầng đang được xem — `aria-current` là dấu duy nhất của nó. */
function activeFloorNames(): readonly string[] {
  return screen
    .getAllByRole('row')
    .filter((row) => row.getAttribute('aria-current') === 'true')
    .map((row) => row.textContent ?? '');
}

/** Đổi tầng đang xem sang tầng đã đo, qua đúng lối người dùng bấm. */
async function selectMeasuredFloor(clock: FakeClock): Promise<void> {
  fireEvent.click(screen.getByText(MEASURED_FLOOR_NAME));
  await settle(clock);
}

/** Vùng ảnh đang được tô sáng — panel ảnh vẽ vùng sáng bằng viền dày hơn. */
function highlightedRegionLabels(): readonly string[] {
  return screen
    .getAllByRole('button')
    .filter((button) => button.className.includes('border-2'))
    .map((button) => button.getAttribute('aria-label') ?? '');
}

/**
 * jsdom không cài `matchMedia`, và `useNarrowViewport` gọi nó ngay lúc mount.
 *
 * Cùng bản giả và cùng lý do như `FloorUploadScreen.test.tsx`: trả `matches:
 * false` nghĩa là khung nhìn rộng, nên `isCollapsed` do dữ liệu quyết chứ
 * không do môi trường test quyết.
 */
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
/* (a) Bảy trạng thái.                                                         */
/* -------------------------------------------------------------------------- */

describe('InputQualityGateView — bảy trạng thái (A11, R-63)', () => {
  it('vẽ đủ bảy trạng thái, không lần nào ném lỗi và không lần nào ra màn trắng', () => {
    let rendered = 0;

    expectSevenStates((scenario) => {
      const { container, unmount } = renderWithProviders(
        <InputQualityGateView {...scenarioFor(scenario.state)} />,
      );

      rendered += 1;

      return { container, unmount };
    }, scenarioIndex());

    console.log(`[NGHIEM-A] trang-thai-ve-duoc=${String(rendered)}/${String(SEVEN_STATES.length)}`);
    expect(rendered).toBe(SEVEN_STATES.length);
  });

  it('không mã lỗi nào đứng một mình: mỗi phát hiện có câu giải thích bên cạnh', () => {
    renderWithProviders(<InputQualityGateView {...scenarioFor('success')} />);

    for (const finding of scenarioFor('success').model.findings) {
      expect(screen.getByText(finding.title)).toBeInTheDocument();
      expect(finding.consequence.length).toBeGreaterThan(finding.title.length);
      expect(screen.getByText(finding.consequence)).toBeInTheDocument();
    }
  });

  it('không quyền thì hai nút hành động biến mất hẳn, nhưng báo cáo vẫn đọc được', () => {
    renderWithProviders(<InputQualityGateView {...scenarioFor('forbidden')} />);

    expect(screen.queryByRole('button', { name: /tiếp tục xử lý/iu })).toBeNull();
    expect(screen.queryByRole('button', { name: /tải bản vẽ khác/iu })).toBeNull();
    expect(screen.getAllByText(/độ phân giải/iu).length).toBeGreaterThan(0);
  });

  it('kết quả do máy chấm không bao giờ mang màu "đã xác minh" của người duyệt (A5)', () => {
    const { model } = scenarioFor('success').model.metrics.length > 0
      ? scenarioFor('success')
      : scenarioFor('partial');

    for (const metric of model.metrics) {
      expect(metric.statusCode).not.toBe('verified');
    }

    for (const finding of model.findings) {
      expect(finding.statusCode).not.toBe('verified');
    }
  });
});

/* -------------------------------------------------------------------------- */
/* Dữ liệu kịch bản không được trôi khỏi cổng dữ liệu giả (R-70).              */
/* -------------------------------------------------------------------------- */

describe('InputQualityGate — kịch bản bám vào cổng dữ liệu giả', () => {
  it('bốn tầng và ba phát hiện của story khớp từng số với createMockApiClient()', async () => {
    const client = createMockApiClient();
    const result = await client.quality.assess({ floorId: 'L1', projectId: PROJECT_ID });

    expect(result.ok).toBe(true);

    if (!result.ok) {
      return;
    }

    expect(result.data.floors.map((floor) => floor.floorId)).toEqual(
      SAMPLE_FLOORS.map((floor) => floor.id),
    );

    for (const [index, floor] of result.data.floors.entries()) {
      const sample = SAMPLE_FLOORS[index];

      expect(sample).toBeDefined();
      expect(floor.floorName).toBe(sample?.name);
      expect(floor.isMeasured).toBe(sample?.isMeasured);
      expect(floor.measurement ?? null).toEqual(
        sample?.measurement === null || sample?.measurement === undefined
          ? null
          : {
              contrastScore: sample.measurement.contrastScore,
              heightPx: sample.measurement.heightPx,
              noiseScore: sample.measurement.noiseScore,
              skewDeg: sample.measurement.skewDeg,
              widthPx: sample.measurement.widthPx,
            },
      );
    }

    const measured = result.data.floors.find((floor) => floor.floorId === 'L1');

    expect(measured?.findings.map((finding) => finding.id)).toEqual(
      SAMPLE_FINDINGS.map((finding) => finding.id),
    );
    expect(measured?.findings.map((finding) => finding.code)).toEqual(
      SAMPLE_FINDINGS.map((finding) => finding.code),
    );
    expect(measured?.findings.map((finding) => finding.severity)).toEqual(
      SAMPLE_FINDINGS.map((finding) => finding.severity),
    );
  });
});

/* -------------------------------------------------------------------------- */
/* (b, c, d) Bộ khẳng định dùng chung (R-72).                                  */
/* -------------------------------------------------------------------------- */

describe('InputQualityGateView — khả năng tiếp cận, tiếng Việt, màu (R-72)', () => {
  it('đi qua expectAccessible ở trạng thái đầy đủ nhất', () => {
    const { container } = renderWithProviders(<InputQualityGateView {...scenarioFor('success')} />);

    expectAccessible(container, { ignoreSelector: TABLE_ROW_DEBT_SELECTOR });
  });

  it('đi qua expectAccessible ở trạng thái không có quyền', () => {
    const { container } = renderWithProviders(
      <InputQualityGateView {...scenarioFor('forbidden')} />,
    );

    expectAccessible(container, { ignoreSelector: TABLE_ROW_DEBT_SELECTOR });
  });

  it('đi qua expectAccessible khi một vùng ảnh đang được tô sáng', () => {
    const { container } = renderWithProviders(
      <InputQualityGateView {...highlightedScenario(regionIdOf('finding-skew'))} />,
    );

    expectAccessible(container, { ignoreSelector: TABLE_ROW_DEBT_SELECTOR });
  });

  it('mọi chuỗi hiển thị là tiếng Việt có dấu', () => {
    const { container } = renderWithProviders(<InputQualityGateView {...scenarioFor('success')} />);

    expectVietnamese(container, { allowWords: ALLOWED_WORDS });
  });

  it('mọi chuỗi hiển thị lúc lỗi và lúc một phần cũng là tiếng Việt có dấu', () => {
    const failed = renderWithProviders(<InputQualityGateView {...scenarioFor('error')} />);

    expectVietnamese(failed.container, { allowWords: ALLOWED_WORDS });
    cleanup();

    const partial = renderWithProviders(<InputQualityGateView {...scenarioFor('partial')} />);

    expectVietnamese(partial.container, { allowWords: ALLOWED_WORDS });
  });

  it('không mã màu thô trong bất kỳ file nào của thư mục màn (A1)', () => {
    for (const file of readdirSync(SCREEN_DIRECTORY)) {
      expectNoRawColor(`${SCREEN_DIRECTORY}/${file}`);
    }
  });
});

/* -------------------------------------------------------------------------- */
/* (e) Cổng xác nhận — cảnh báo có ý thức, không chặn cứng.                     */
/* -------------------------------------------------------------------------- */

describe('InputQualityGate — cổng xác nhận khi có chỉ số mức Kém', () => {
  let clock: FakeClock;

  beforeEach(() => {
    clock = installFakeClock();
  });

  afterEach(() => {
    clock.restore();
  });

  it('ảnh kém là cảnh báo không chặn: không ô tích, câu đồng ý dưới nút, bấm là đi — chứng minh qua giao diện', async () => {
    const onNavigate = vi.fn();
    await mountScreen(clock, { onNavigate });
    await selectMeasuredFloor(clock);

    // Tầng 1 có độ phân giải cạnh ngắn 900 px — mức Kém theo `@/domain/quality`:
    // chip cảnh báo, không ô tích (ô chưa tích = nút chết), câu đồng ý nối vào nút.
    expect(screen.queryByRole('checkbox')).toBeNull();
    expect(screen.getByText('Ảnh mờ, vẫn xử lý được')).toBeInTheDocument();

    const primary = screen.getByRole('button', { name: /vẫn xử lý/iu });
    const consent = screen.getByText(/vẫn xử lý: có thể phải vẽ tay tường bị sót/iu);

    expect(primary).toBeEnabled();
    expect(primary).toHaveAttribute('aria-describedby', consent.closest('p')?.id);
    expect(screen.getByRole('button', { name: /tải ảnh nét hơn/iu })).toBeInTheDocument();

    // B-V4-02 (mới): một lần bấm là đồng ý và sang màn xử lý.
    fireEvent.click(primary);
    expect(onNavigate).toHaveBeenCalledWith('/projects/project-1/pipeline');
  });

  it('ảnh quá nhỏ nêu cỡ ảnh thật và ba hướng dẫn; không thấy khung thì gợi ý cắt riêng mặt bằng', async () => {
    await mountScreen(clock);
    await selectMeasuredFloor(clock);

    const panel = screen.getByRole('region', { name: /báo cáo chất lượng/iu });
    const text = panel.textContent ?? '';

    expect(text).toMatch(/Ảnh quá nhỏ \([\d.]+ × [\d.]+ px\): ký hiệu cửa, đồ đạc rất nhỏ, máy sẽ bỏ sót nhiều\./u);
    expect(text).toContain('Tải bản PDF gốc nếu có.');
    expect(text).toContain('Chụp/xuất lại lớn hơn, cạnh ngắn ≥ 2.000 px.');
    expect(text).toContain('Cắt riêng vùng mặt bằng.');
  });

  it('bản vẽ không có chỉ số mức Kém thì không hỏi xác nhận', () => {
    renderWithProviders(<InputQualityGateView {...scenarioFor('empty')} />);

    expect(screen.queryByRole('checkbox')).toBeNull();
    expect(screen.queryByText(/bấm là chấp nhận/iu)).toBeNull();
  });

  it('mô hình có chỉ số Kém vẫn mở đường đi tiếp, không ô tích', () => {
    const acknowledged = acknowledgedScenario();

    expect(acknowledged.model.footer.requiresAcknowledgement).toBe(true);
    expect(acknowledged.model.footer.canContinue).toBe(true);

    renderWithProviders(<InputQualityGateView {...acknowledged} />);

    expect(screen.queryByRole('checkbox')).toBeNull();
    expect(screen.getByRole('button', { name: 'Vẫn xử lý' })).toBeEnabled();
  });
});

/* -------------------------------------------------------------------------- */
/* (f) Liên kết hai chiều thẻ phát hiện ↔ vùng ảnh.                             */
/* -------------------------------------------------------------------------- */

describe('InputQualityGate — liên kết hai chiều báo cáo ↔ ảnh', () => {
  let clock: FakeClock;

  beforeEach(() => {
    clock = installFakeClock();
  });

  afterEach(() => {
    clock.restore();
  });

  it('rê chuột lên thẻ phát hiện thì đúng vùng ảnh của nó được đánh dấu, và ngược lại', async () => {
    await mountScreen(clock);
    await selectMeasuredFloor(clock);

    expect(highlightedRegionLabels()).toHaveLength(0);

    // Chiều thứ nhất — báo cáo sang ảnh.
    const card = screen.getByText('Ảnh bị nghiêng').closest('div[tabindex]');

    expect(card).not.toBeNull();

    fireEvent.mouseEnter(card as HTMLElement);
    await settle(clock);

    const fromCard = highlightedRegionLabels();

    console.log(`[NGHIEM-F] tu-the-phat-hien=${fromCard.join(' | ')}`);
    expect(fromCard).toHaveLength(1);
    expect(fromCard[0]).toMatch(/ảnh bị nghiêng/iu);

    fireEvent.mouseLeave(card as HTMLElement);
    await settle(clock);
    expect(highlightedRegionLabels()).toHaveLength(0);

    // Chiều thứ hai — ảnh sang trạng thái tô sáng, qua bàn phím chứ không chuột,
    // vì A12 nói bàn phím là đường đi hạng nhất chứ không phải phương án dự phòng.
    const region = screen.getByRole('button', { name: /ảnh bị nghiêng/iu });

    fireEvent.focus(region);
    await settle(clock);

    const fromRegion = highlightedRegionLabels();

    console.log(`[NGHIEM-F] tu-vung-anh=${fromRegion.join(' | ')}`);
    expect(fromRegion).toHaveLength(1);
    expect(fromRegion[0]).toBe(fromCard[0]);
  });

  it('rê chuột lên thẻ chỉ số có neo vùng cũng đánh dấu đúng vùng ấy', async () => {
    await mountScreen(clock);
    await selectMeasuredFloor(clock);

    const metricRow = screen.getByText('Độ nghiêng').closest('div[tabindex]');

    expect(metricRow).not.toBeNull();

    fireEvent.mouseEnter(metricRow as HTMLElement);
    await settle(clock);

    const highlighted = highlightedRegionLabels();

    expect(highlighted).toHaveLength(1);
    expect(highlighted[0]).toMatch(/ảnh bị nghiêng/iu);
  });
});

/* -------------------------------------------------------------------------- */
/* (g) Phím mũi tên đổi tầng đang xem.                                         */
/* -------------------------------------------------------------------------- */

describe('InputQualityGate — ArrowLeft/ArrowRight đổi tầng đang xem (A12)', () => {
  let clock: FakeClock;

  beforeEach(() => {
    clock = installFakeClock();
  });

  afterEach(() => {
    clock.restore();
  });

  it('mũi tên phải đi tới tầng sau, mũi tên trái quay lại tầng trước', async () => {
    await mountScreen(clock);

    // Màn mở ở tầng đầu danh sách dự án.
    expect(activeFloorNames()).toHaveLength(1);
    expect(activeFloorNames()[0]).toContain(SEED_FLOOR_NAME);

    fireEvent.keyDown(window, { key: 'ArrowRight' });
    await settle(clock);

    const afterRight = activeFloorNames();

    console.log(`[NGHIEM-G] sau-mui-ten-phai=${afterRight.join(' | ')}`);
    expect(afterRight).toHaveLength(1);
    expect(afterRight[0]).toContain(MEASURED_FLOOR_NAME);

    fireEvent.keyDown(window, { key: 'ArrowLeft' });
    await settle(clock);

    const afterLeft = activeFloorNames();

    console.log(`[NGHIEM-G] sau-mui-ten-trai=${afterLeft.join(' | ')}`);
    expect(afterLeft).toHaveLength(1);
    expect(afterLeft[0]).toContain(SEED_FLOOR_NAME);
  });

  it('mũi tên trái ở tầng đầu không đi đâu cả — không có tầng thứ không', async () => {
    await mountScreen(clock);

    fireEvent.keyDown(window, { key: 'ArrowLeft' });
    await settle(clock);

    expect(activeFloorNames()).toHaveLength(1);
    expect(activeFloorNames()[0]).toContain(SEED_FLOOR_NAME);
  });
});

/* -------------------------------------------------------------------------- */
/* (2.5) Hỏi trước khi nắn thẳng (A9) — máy chủ không đảo được, nên không toast. */
/* -------------------------------------------------------------------------- */

describe('InputQualityGate — hỏi trước khi nắn thẳng, không toast hoàn tác (A9)', () => {
  let clock: FakeClock;

  beforeEach(() => {
    clock = installFakeClock();
  });

  afterEach(() => {
    clock.restore();
  });

  it('bấm nắn thẳng mở hộp thoại có tên, Esc đóng và không gửi gì', async () => {
    const client = createMockApiClient();
    const straighten = vi.spyOn(client.quality, 'straighten');

    await mountScreen(clock, { client });
    await selectMeasuredFloor(clock);

    fireEvent.click(screen.getByRole('button', { name: /tự động nắn/iu }));
    await settle(clock);

    const dialog = screen.getByRole('dialog', { name: /nắn thẳng bản vẽ tầng tầng 1\?/iu });

    expect(within(dialog).getByText(/việc này không hoàn tác được/iu)).toBeInTheDocument();
    // `Modal.tsx` đặt `outline-hidden` lên vỏ `tabIndex={-1}` — nợ dùng chung đã nêu ở ShareDialog.test.tsx.
    expectAccessible(document.body, { ignoreSelector: `${TABLE_ROW_DEBT_SELECTOR}, [role="dialog"]` });

    fireEvent.keyDown(dialog, { key: 'Escape' });
    await settle(clock);

    expect(screen.queryByRole('dialog')).toBeNull();
    expect(straighten).not.toHaveBeenCalled();
  });

  it('xác nhận gửi đúng một lượt và không có toast hoàn tác', async () => {
    const client = createMockApiClient();
    const straighten = vi.spyOn(client.quality, 'straighten');
    const toasts: InputQualityToast[] = [];

    await mountScreen(clock, {
      client,
      onToast: (toast) => {
        toasts.push(toast);
      },
    });
    await selectMeasuredFloor(clock);

    fireEvent.click(screen.getByRole('button', { name: /tự động nắn/iu }));
    await settle(clock);
    fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Nắn thẳng' }));
    await settle(clock);
    await settle(clock);

    expect(straighten).toHaveBeenCalledTimes(1);
    expect(toasts).toHaveLength(0);
    expect(screen.queryByRole('dialog')).toBeNull();

    // Lượt ghi thật sự đổi dữ liệu: máy chủ đo lại, phát hiện nghiêng biến khỏi
    // danh sách, hai phát hiện còn lại ở nguyên đó.
    const panel = screen.getByRole('region', { name: /báo cáo chất lượng/iu });

    expect(within(panel).queryByText('Ảnh bị nghiêng')).toBeNull();
    expect(within(panel).getByText('Độ phân giải thấp')).toBeInTheDocument();
    // Đếm qua vùng `role="status"` (số cuối), không qua chữ hiển thị: bản `aria-hidden`
    // chạy `useCountUp`, tính tiến độ theo `performance.now` THẬT — đồng hồ giả không giữ
    // nó — nên máy rảnh thì chữ còn đang ở 3, máy tải nặng thì đã về 2 và `getByText`
    // thấy hai nút ("Found multiple elements", verify-1 QA-01c).
  });

  /**
   * Lỗi ghi 409 chậm rồi đọc lại chậm — như mạng thật — cho loại ghi `kind`.
   * Trả về nút đã bấm và hàm đẩy đồng hồ qua từng pha, để test chen vào giữa.
   */
  async function mountFailingWrite(kind: 'straighten' | 'corners') {
    const client = createMockApiClient();
    const realAssess = client.quality.assess;
    let isWriteDone = false;
    const assess = vi.spyOn(client.quality, 'assess').mockImplementation(async (input) => {
      if (isWriteDone) {
        await new Promise((resolve) => {
          setTimeout(resolve, SLOW_SERVER_MS);
        });
      }

      return realAssess(input);
    });
    const failed = async () => {
      await new Promise((resolve) => {
        setTimeout(resolve, SLOW_SERVER_MS);
      });
      isWriteDone = true;

      return {
        error: {
          code: 'QUALITY_DRAWING_CHANGED',
          kind: 'http' as const,
          raw: { code: 'QUALITY_DRAWING_CHANGED', requestId: 'req-focus-1' },
          requestId: 'req-focus-1',
          retryable: false,
          status: 409,
        },
        ok: false as const,
      };
    };

    vi.spyOn(client.quality, 'straighten').mockImplementation(failed);
    vi.spyOn(client.quality, 'setCorners').mockImplementation(failed);

    await mountScreen(clock, { client });
    await selectMeasuredFloor(clock);

    const reads = assess.mock.calls.length;
    const name = kind === 'straighten' ? /tự động nắn/iu : /chọn góc thủ công/iu;
    const trigger = screen.getByRole('button', { name });

    trigger.focus();
    fireEvent.click(trigger);
    await settle(clock);

    if (kind === 'corners') {
      fireEvent.click(screen.getByRole('button', { name: /gửi bốn góc đã chọn/iu }));
      await settle(clock);
    }

    fireEvent.click(
      within(screen.getByRole('dialog')).getByRole('button', {
        name: kind === 'straighten' ? 'Nắn thẳng' : 'Cắt và nắn',
      }),
    );

    const advance = () =>
      act(async () => {
        await clock.advance(SLOW_SERVER_MS);
        await clock.flushMicrotasks();
      });

    // Chọn góc xong, cùng nút đổi nhãn thành "Gửi bốn góc đã chọn".
    const finalName = kind === 'straighten' ? name : /gửi bốn góc đã chọn/iu;

    return { advance, assess, finalName, reads, trigger };
  }

  it.each(['straighten', 'corners'] as const)(
    'NO-360: lỗi ghi (%s) có đọc lại thì tiêu điểm về nút vừa bấm, không nhảy lên đầu trang',
    async (kind) => {
      const { advance, assess, finalName, reads, trigger } = await mountFailingWrite(kind);

      await advance();
      await advance();
      await settle(clock);
      await settle(clock);

      expect(screen.getAllByText(/kết quả đo đã được đọc lại/iu).length).toBeGreaterThan(0);
      expect(assess.mock.calls.length).toBeGreaterThan(reads);
      expect(screen.queryByRole('dialog')).toBeNull();
      expect(trigger.isConnected).toBe(false);
      expect(document.activeElement).toBe(screen.getByRole('button', { name: finalName }));
    },
  );

  it('NO-360: người dùng đã tự chuyển tiêu điểm trong lúc đọc lại thì không bị kéo về', async () => {
    const { advance } = await mountFailingWrite('straighten');

    await advance();

    const other = screen.getByRole('button', { name: 'Tải ảnh nét hơn' });

    fireEvent.pointerDown(other);
    other.focus();
    await advance();
    await settle(clock);
    await settle(clock);

    expect(screen.queryByRole('button', { name: /tự động nắn/iu })).not.toBeNull();
    expect(document.activeElement).toBe(other);
  });
});

describe('InputQualityGate — NO-361: chưa có bản vẽ thì không đi tiếp được', () => {
  let clock: FakeClock;

  beforeEach(() => {
    clock = installFakeClock();
  });

  afterEach(() => {
    clock.restore();
  });

  it('nút "Tiếp tục xử lý" vô hiệu kèm lý do đọc được, bấm không điều hướng', async () => {
    const client = createMockApiClient();
    const onNavigate = vi.fn();

    vi.spyOn(client.quality, 'assess').mockResolvedValue({
      error: {
        code: 'NOT_FOUND',
        kind: 'http',
        raw: { code: 'NOT_FOUND', requestId: 'req-nodraw-1', resource: 'upload' },
        requestId: 'req-nodraw-1',
        retryable: false,
        status: 404,
      },
      ok: false,
    });

    await mountScreen(clock, { client, onNavigate });

    const button = screen.getByRole('button', { name: 'Tiếp tục xử lý' });

    expect(button).toHaveAttribute('aria-disabled', 'true');
    // Bị chặn thì phải TRÔNG bị chặn: `Button` tô `aria-disabled` như `disabled` (R2-1).
    expect(button).toHaveClass('aria-disabled:opacity-40', 'aria-disabled:cursor-not-allowed');
    expect(button).toHaveAccessibleDescription(/chưa có bản vẽ nào để xử lý/iu);

    fireEvent.click(button);
    expect(onNavigate).not.toHaveBeenCalled();
  });

  it('đang đọc kết quả: nút vô hiệu kèm lý do', async () => {
    const client = createMockApiClient();

    vi.spyOn(client.quality, 'assess').mockImplementation(() => new Promise(() => undefined));

    await mountScreen(clock, { client });

    const button = screen.getByRole('button', { name: 'Tiếp tục xử lý' });

    expect(button).toHaveAttribute('aria-disabled', 'true');
    expect(button).toHaveAccessibleDescription(/đang đọc kết quả/iu);

    // Bàn phím tới được nút bị chặn, nên trình đọc màn hình đọc được lý do.
    button.focus();
    expect(button).toHaveFocus();
  });

  it('đọc kết quả hỏng: một dải lỗi, một lối ra, chân trang không nhắc lại (BUG-074)', async () => {
    const client = createMockApiClient();
    const onNavigate = vi.fn();

    vi.spyOn(client.quality, 'assess').mockResolvedValue({
      error: {
        code: 'INTERNAL_ERROR',
        kind: 'http',
        raw: { code: 'INTERNAL_ERROR', requestId: 'req-read-1' },
        requestId: 'req-read-1',
        retryable: false,
        status: 500,
      },
      ok: false,
    });

    await mountScreen(clock, { client, onNavigate });

    expect(screen.getByText('Không đọc được kết quả kiểm tra chất lượng')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Tiếp tục xử lý' })).toBeNull();
    expect(screen.queryByText(/chưa đọc được kết quả kiểm tra/iu)).toBeNull();
    // Không thử lại được: lối ra duy nhất là tải bản vẽ khác.
    expect(screen.queryByRole('button', { name: 'Thử lại' })).toBeNull();
    expect(screen.getAllByRole('button', { name: 'Tải bản vẽ khác' })).toHaveLength(1);
    expect(onNavigate).not.toHaveBeenCalled();
  });

  it('đọc kết quả hỏng nhưng thử lại được: "Thử lại" gọi lại API (review-1)', async () => {
    const client = createMockApiClient();
    const assess = vi.spyOn(client.quality, 'assess').mockResolvedValue({
      error: {
        code: 'INTERNAL_ERROR',
        kind: 'http',
        raw: { code: 'INTERNAL_ERROR', requestId: 'req-read-2' },
        requestId: 'req-read-2',
        retryable: true,
        status: 503,
      },
      ok: false,
    });

    await mountScreen(clock, { client });

    const callsBefore = assess.mock.calls.length;

    expect(screen.queryByRole('button', { name: 'Tải bản vẽ khác' })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Thử lại' }));
    await settle(clock);

    expect(assess.mock.calls.length).toBeGreaterThan(callsBefore);
  });

  it('dự án không tồn tại: "Không tìm thấy dự án này" và lối về danh sách dự án (BUG-074)', async () => {
    const client = createMockApiClient();
    const onNavigate = vi.fn();

    vi.spyOn(client.projects, 'read').mockResolvedValue({
      error: {
        code: 'PROJECT_NOT_FOUND',
        kind: 'http',
        raw: { code: 'PROJECT_NOT_FOUND', requestId: 'req-404' },
        requestId: 'req-404',
        retryable: false,
        status: 404,
      },
      ok: false,
    });

    await mountScreen(clock, { client, onNavigate });

    expect(screen.getByText('Không tìm thấy dự án này')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Tải bản vẽ khác' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Tiếp tục xử lý' })).toBeNull();

    fireEvent.click(screen.getByRole('button', { name: 'Về danh sách dự án' }));
    expect(onNavigate).toHaveBeenCalledWith('/');
  });

  it('cấp "Dự án" của breadcrumb về danh sách dự án (review-1)', async () => {
    const onNavigate = vi.fn();

    await mountScreen(clock, { onNavigate });

    const nav = screen.getByRole('navigation', { name: 'Đường dẫn trang' });
    fireEvent.click(within(nav).getByRole('link', { name: 'Dự án' }));

    expect(onNavigate).toHaveBeenCalledWith('/');
  });

  // BUG-362: the no-drawing state read "Dự án › Kiểm tra chất lượng đầu vào", without the project.
  it('chưa có bản vẽ: breadcrumb vẫn nêu tên dự án giữa "Dự án" và tên màn (BUG-362)', async () => {
    const client = createMockApiClient();
    const project = await client.projects.read({ projectId: PROJECT_ID });
    if (!project.ok) throw new Error('Không đọc được dự án mẫu.');

    vi.spyOn(client.quality, 'assess').mockResolvedValue({
      error: {
        code: 'NOT_FOUND',
        kind: 'http',
        raw: { code: 'NOT_FOUND', requestId: 'req-nodraw-2', resource: 'upload' },
        requestId: 'req-nodraw-2',
        retryable: false,
        status: 404,
      },
      ok: false,
    });

    await mountScreen(clock, { client });

    expect(screen.getByText('Chưa có bản vẽ để kiểm tra')).toBeInTheDocument();
    const nav = screen.getByRole('navigation', { name: 'Đường dẫn trang' });
    expect(nav).toHaveTextContent(new RegExp(`Dự án.*${project.data.name}.*Chất lượng ảnh`, 'u'));
  });

  it('có bản vẽ thì nút bấm được', async () => {
    await mountScreen(clock, {});
    await selectMeasuredFloor(clock);

    expect(screen.getByRole('button', { name: 'Vẫn xử lý' })).toBeEnabled();
  });
});

describe('InputQualityGateView — ba trạng thái mới của F-05a', () => {
  it('chưa có bản vẽ: thẻ rỗng có nút tải lên cho người sửa, không nút cho người xem', () => {
    const editor = renderWithProviders(<InputQualityGateView {...noDrawingScenario()} />);

    expect(screen.getByText('Chưa có bản vẽ để kiểm tra')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Tải bản vẽ lên' })).toBeInTheDocument();
    expectVietnamese(editor.container, { allowWords: ALLOWED_WORDS });
    editor.unmount();

    renderWithProviders(<InputQualityGateView {...noDrawingScenario(false)} />);

    expect(screen.getByText('Chưa có bản vẽ để kiểm tra')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Tải bản vẽ lên' })).toBeNull();
  });

  it('hộp thoại hỏi trước hiện tên và hai nút, ở cả hai biến thể', () => {
    for (const kind of ['straighten', 'corners'] as const) {
      const props = confirmScenario(kind);
      const { unmount } = renderWithProviders(<InputQualityGateView {...props} />);
      const dialog = screen.getByRole('dialog');

      expect(dialog).toHaveAccessibleName(props.model.confirm?.title ?? '');
      expect(within(dialog).getByRole('button', { name: 'Huỷ' })).toBeInTheDocument();
      expectVietnamese(dialog, { allowWords: ALLOWED_WORDS });
      unmount();
    }
  });

  // BUG-292: the handles were 10×10 and the bottom-right one sat on the zoom cluster's "Phóng to".
  it('picking corners: each handle offers a ≥ 24 px target and the zoom cluster steps aside (BUG-292)', () => {
    const base = scenarioFor('success');
    const corners = [
      { id: 'tl', xRatio: 0.03, yRatio: 0.03 },
      { id: 'br', xRatio: 0.97, yRatio: 0.97 },
    ];
    renderWithProviders(
      <InputQualityGateView {...base} model={{ ...base.model, image: { ...base.model.image, corners } }} />,
    );

    const handle = screen.getByRole('button', { name: 'Góc dưới bên phải' });
    expect(Number.parseFloat(handle.style.width)).toBeGreaterThanOrEqual(24);
    expect(Number.parseFloat(handle.style.height)).toBeGreaterThanOrEqual(24);
    expect(screen.queryByRole('group', { name: 'Cụm thu phóng' })).toBeNull();
  });

  it('the zoom cluster drives the drawing: "Phóng to" scales the image and its overlays, the label follows', () => {
    renderWithProviders(<InputQualityGateView {...scenarioFor('success')} />);

    const content = screen.getByTestId('quality-image-content');
    expect(content.style.width).toBe('100%');

    fireEvent.click(screen.getByRole('button', { name: 'Phóng to' }));
    expect(content.style.width).toBe('125%');
    expect(screen.getByRole('button', { name: /Mức thu phóng 125%/u })).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Vừa khung nhìn' }));
    expect(content.style.width).toBe('100%');
  });

  it('lỗi ghi hiện thành dải phía trên hai cột, bằng tiếng Việt', () => {
    const { container } = renderWithProviders(<InputQualityGateView {...writeErrorScenario()} />);

    expect(screen.getByText(/vừa đổi, kết quả đo đã được đọc lại/iu)).toBeInTheDocument();
    expectVietnamese(container, { allowWords: ALLOWED_WORDS });
    // Chỗ đỡ tiêu điểm của dải lỗi phải có vòng tiêu điểm nhìn thấy (WCAG 2.4.7).
    expectAccessible(container, { ignoreSelector: TABLE_ROW_DEBT_SELECTOR });
  });
});

/* -------------------------------------------------------------------------- */
/* QA-03e — lớp phủ khung bản vẽ (BUG-537, BUG-539, BUG-540).                  */
/* -------------------------------------------------------------------------- */

describe('InputQualityGate — lớp phủ không che bản vẽ, không tranh phím (QA-03e)', () => {
  const overlayRegions = [
    { id: 'r-resolution', label: 'Vùng độ phân giải', level: 'poor', xRatio: 0, yRatio: 0, widthRatio: 1, heightRatio: 1 },
    { id: 'r-skew', label: 'Vùng ảnh bị nghiêng', level: 'attention', xRatio: 0.08, yRatio: 0.12, widthRatio: 0.84, heightRatio: 0.72 },
    { id: 'r-frame', label: 'Vùng khung', level: 'attention', xRatio: 0.02, yRatio: 0.02, widthRatio: 0.96, heightRatio: 0.96 },
  ] as const;

  function renderOverlay(extra: { corners?: { id: string; xRatio: number; yRatio: number }[] } = {}) {
    const base = scenarioFor('success');

    return renderWithProviders(
      <InputQualityGateView
        {...base}
        model={{
          ...base.model,
          image: { ...base.model.image, regions: overlayRegions, corners: extra.corners ?? null },
        }}
      />,
    );
  }

  function regionButtons(): HTMLElement[] {
    return within(screen.getByRole('group', { name: 'Vùng có vấn đề trên bản vẽ' })).getAllByRole('button');
  }

  // BUG-537: the tint tokens are opaque, so a full-image region hid the drawing.
  it('vùng phát hiện chỉ có viền, không nền đặc che bản vẽ (BUG-537)', () => {
    renderOverlay();

    for (const button of regionButtons()) {
      expect(button.className).not.toMatch(/\bbg-/u);
    }
  });

  // BUG-539: the 96 % frame region sat last in the DOM and swallowed the pointer of every smaller one.
  it('vùng lớn vẽ trước, vùng nhỏ nằm trên cùng để con trỏ trúng vùng nhỏ (BUG-539)', () => {
    renderOverlay();

    expect(regionButtons().map((button) => button.getAttribute('aria-label'))).toEqual([
      'Vùng độ phân giải',
      'Vùng khung',
      'Vùng ảnh bị nghiêng',
    ]);
  });

  // BUG-540: a corner handle nudged AND the canvas shortcut switched floor, losing the corner draft.
  it('mũi tên trên tay nắm góc chỉ nhích tay nắm, không tới phím tắt đổi tầng (BUG-540)', () => {
    const onWindowKey = vi.fn();
    window.addEventListener('keydown', onWindowKey);
    renderOverlay({ corners: [{ id: 'tl', xRatio: 0.1, yRatio: 0.1 }] });

    fireEvent.keyDown(screen.getByRole('button', { name: 'Góc trên bên trái' }), { key: 'ArrowRight' });

    window.removeEventListener('keydown', onWindowKey);
    expect(onWindowKey).not.toHaveBeenCalled();
  });

  it('khung đang phóng: mũi tên cuộn khung, không tới phím tắt đổi tầng (BUG-540)', () => {
    const onWindowKey = vi.fn();
    window.addEventListener('keydown', onWindowKey);
    renderOverlay();
    fireEvent.click(screen.getByRole('button', { name: 'Phóng to' }));

    const frame = screen.getByRole('group', { name: /Bản vẽ đang phóng/u });
    const notCancelled = fireEvent.keyDown(frame, { key: 'ArrowRight' });

    window.removeEventListener('keydown', onWindowKey);
    expect(notCancelled).toBe(true);
    expect(onWindowKey).not.toHaveBeenCalled();
  });
});
