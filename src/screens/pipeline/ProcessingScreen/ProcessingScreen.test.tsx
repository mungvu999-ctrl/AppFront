/**
 * Lượt kiểm của màn Xử lý.
 *
 * Bốn bộ khẳng định dùng chung (`expectSevenStates`, `expectAccessible`,
 * `expectVietnamese`, `expectNoRawColor`) cộng sáu phép đo của bản nghiệm thu:
 *
 * | mã | đo cái gì | ngưỡng |
 * |---|---|---|
 * | `[NGHIEM-1]` | bảy trạng thái của A11 | 7/7 |
 * | `[NGHIEM-3]` | sáu tên bước nguyên văn khoá `pipeline` của `vi.json` | 6/6, đủ dấu |
 * | `[NGHIEM-4]` | dãy trọng số và hằng nhịp KHÔNG bị chép vào thư mục màn | 0 lần |
 * | `[NGHIEM-C]` | huỷ xác nhận TẠI CHỖ, không một `role="dialog"` nào | 0 hộp thoại |
 * | `[NGHIEM-D]` | `canCancel` sai thì nút huỷ không tồn tại trong cây | ẩn hẳn |
 * | `[NGHIEM-E]` | `prefersReducedMotion` bật thì không lớp `animate-pipeline-sweep` | 0 phần tử |
 * | `[NGHIEM-F]` | nút "Để chạy nền và thông báo cho tôi" đẩy ra một thông báo THẤY ĐƯỢC | 1 thông báo |
 *
 * Hai lớp render, cố ý — cùng khuôn `InputQualityGate.test.tsx`:
 *
 * - **Chỉ props** cho bảy trạng thái và ba bộ soát. {@link ProcessingScreen} là
 *   một hàm của props (mục D), nên bảy trạng thái vẽ được mà không cần mạng.
 *   Dữ liệu đến từ `ProcessingScreen.stories.tsx`, một bộ duy nhất cho cả story
 *   lẫn test: hai bộ song song là hai bộ sẽ lệch nhau (R-70).
 * - **Qua container + cổng dữ liệu giả** cho lối huỷ. Nút huỷ chỉ tồn tại khi
 *   `gateway.supports.cancelProcessing` bật, mà bản cài đặt thật để `false` —
 *   repo chưa có `ENDPOINTS.drawings.cancel`. Cổng giả bật đúng khả năng đó lên
 *   để nhánh "có hỗ trợ" vẫn được kiểm; đó là điều `ProcessingGateway.supports`
 *   được dựng ra để cho phép, không phải một đường vòng.
 *
 * - **Qua hook thật + `NotificationHost` thật** cho `[NGHIEM-F]`. Nút chạy nền
 *   không có gì để nhìn nếu chỉ có view: nó đẩy một thông báo, và thông báo được
 *   vẽ ở một cây khác. Lượt render đó dựng cả hai mảnh, và tiêm bus riêng.
 *
 * Nửa "suy nghĩ" — SSE chết giữa chừng, tab ẩn, một tầng lỗi không dừng tầng
 * khác, rời màn rồi quay lại, và lượt chạy nền xong SAU khi màn đã tháo — nằm ở
 * `useProcessingScreen.test.ts` và không lặp lại ở đây.
 */

import { readdirSync, readFileSync } from 'node:fs';
import { act, cleanup, fireEvent, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { NotificationHost } from '@/components/feedback/NotificationHost';
import { createMockApiClient, MOCK_MISSING_PROJECT_ID } from '@/api/__mocks__/client';
import type { Progress } from '@/api/schemas';
import viMessages from '@/i18n/vi.json';
import { toAppError } from '@/lib/errors';
import { createNotificationBus, type NotificationBus } from '@/lib/mutations/notificationBus';
import {
  createBackgroundWatchRegistry,
  type BackgroundWatchRegistry,
} from '@/lib/realtime/backgroundWatch';
import { PIPELINE_STAGES } from '@/lib/realtime/pipeline';
import { expectAccessible } from '@/lib/testing/expectAccessible';
import { expectNoRawColor } from '@/lib/testing/expectNoRawColor';
import { expectSevenStates } from '@/lib/testing/expectSevenStates';
import { expectVietnamese } from '@/lib/testing/expectVietnamese';
import { renderWithProviders } from '@/lib/testing/render';
import {
  SEVEN_STATES,
  SEVEN_STATE_LABELS,
  type SevenStateScenario,
} from '@/lib/testing/sevenStateScenarios';

import { ProcessingScreen } from './ProcessingScreen';
import { ProcessingScreenContainer } from './ProcessingScreen.container';
import {
  cancelConfirmingScenario,
  PIPELINE_STEP_NAMES,
  reducedMotionScenario,
  RUNNING_FLOORS,
  SAMPLE_SUMMARY,
  scenarioFor,
} from './ProcessingScreen.stories';
import { createProcessingGateway, type ProcessingGateway } from './processingGateway';
import { useProcessingScreen } from './useProcessingScreen';

const SCREEN_DIRECTORY = 'src/screens/pipeline/ProcessingScreen';
const PROJECT_ID = 'project-1';

/** Nhãn của hàng hành động — hằng chuỗi thật của `ProcessingScreen.tsx`. */
const CANCEL_LABEL = 'Huỷ xử lý';
const RUN_IN_BACKGROUND_LABEL = 'Chạy nền, báo tôi khi xong';
const CANCEL_CONFIRM_LABEL = 'Xác nhận huỷ';
const CANCEL_DISMISS_LABEL = 'Giữ nguyên';

/** Lớp vạch quét. `[NGHIEM-E]` đếm số phần tử mang nó, nên nó phải viết đúng. */
const SWEEP_CLASS_SELECTOR = '.animate-pipeline-sweep';

/**
 * `Panel` là từ mượn, đã có mặt trong `vi.json` khoá `processingScreen` — nó là
 * chữ đầu câu `"Panel sẽ hiện bản vẽ ngay khi có tầng bắt đầu xử lý."` mà V6
 * viết cho trạng thái chưa có tầng nào. Ghi tên ở đây để nó là một quyết định
 * đọc được, không phải một chữ tiếng Anh lọt lưới.
 */
const ALLOWED_WORDS = ['panel'];

/**
 * Mã lỗi máy đọc — A6 cho phép chữ hoa ở đúng chỗ này, và chỉ ở đây.
 *
 * `PIPELINE_STAGE_FAILED` (mã của một bước hỏng) và `NETWORK` (mã kỹ thuật của
 * `describeError`) là chuỗi cho máy, không phải câu cho người: cả hai lần đều
 * đứng CẠNH một câu tiếng Việt nói rõ hậu quả, không bao giờ đứng một mình.
 * Bỏ qua theo hình dạng — CHỮ_HOA_CÓ_GẠCH_DƯỚI trọn chuỗi — chứ không liệt kê
 * từng từ, để `pipeline`/`failed`/`network` không lọt vào từ vựng được duyệt và
 * mở đường cho tiếng Anh thật ở chỗ khác.
 */
const MACHINE_ERROR_CODE = /^[A-Z][A-Z0-9]*(?:_[A-Z0-9]+)*$/;

/**
 * Một lượt xử lý đang chạy, để `onConfirmCancel` có cái để huỷ.
 *
 * Hook huỷ theo TỪNG lượt (`uploads.forEach`), nên danh sách rỗng nghĩa là
 * không lời gọi nào — đúng và trung thực, nhưng không kiểm được gì.
 */
const ONE_UPLOAD = [{ floorId: 'L1', floorName: 'Tầng 1', uploadId: 'upload-1' }] as const;

/* -------------------------------------------------------------------------- */
/* Bộ dựng.                                                                    */
/* -------------------------------------------------------------------------- */

/** jsdom không có `EventSource`; cổng nhận bản tiêm, nên test không phải vá `globalThis`. */
class MockEventSource {
  static opened = 0;
  onerror: ((event: Event) => void) | null = null;
  onmessage: ((event: MessageEvent) => void) | null = null;
  onopen: ((event: Event) => void) | null = null;

  constructor() {
    MockEventSource.opened += 1;
  }

  close(): void {
    /* Không có gì để đóng: test này không đẩy nhịp tiến độ nào qua kênh. */
  }
}

/** Mảng thứ hai của `expectSevenStates` chỉ để thoả kiểu; props thật đến từ `scenarioFor`. */
function scenarioIndex(): readonly SevenStateScenario[] {
  return SEVEN_STATES.map((state) => ({
    state,
    label: SEVEN_STATE_LABELS[state],
    rows: [],
    totalCount: RUNNING_FLOORS.length,
    isLoading: state === 'loading',
    isCollapsed: state === 'collapsed',
    canView: state !== 'forbidden',
    error: null,
  }));
}

/**
 * Cổng giả: bản THẬT dựng trên `createMockApiClient()`, chỉ bật thêm khả năng
 * huỷ.
 *
 * Không viết một cổng thứ hai từ đầu — làm vậy là dựng ý niệm thứ hai về hình
 * dạng câu trả lời, đúng thứ R-70 cấm. Chỉ đúng hai chỗ đổi: `supports.cancelProcessing`
 * và `requestCancel`, tức đúng cái endpoint repo còn thiếu.
 */
function gatewayWithCancel(onCancel: () => void): ProcessingGateway {
  const real = createProcessingGateway(createMockApiClient(), {
    EventSourceImpl: MockEventSource as unknown as typeof EventSource,
  });

  return {
    ...real,
    supports: { ...real.supports, cancelProcessing: true },
    requestCancel: async () => {
      onCancel();
      return { supported: true, value: undefined };
    },
  };
}

/**
 * Cổng giả: bản THẬT dựng trên `createMockApiClient()`, chỉ đổi `readProgressOnce`
 * để lượt đọc ĐẦU TIÊN báo luôn một bước hỏng — cùng khuôn `gatewayWithCancel`.
 *
 * `status: 'failed'` cộng `step` tra được (`toStageBreakdown`, `processingGateway.ts:499`)
 * là đúng và duy nhất cách một `PipelineStageState` thành `'failed'` — khác hẳn
 * `record.failure` (lỗi ĐỌC, vẫn đi ra qua `errorAlert` như cũ). Đây chính là "một
 * bước AI hỏng" mà S-11 `PipelineFailure` được dựng ra để nói.
 */
function gatewayWithFailedStep(stepId: string, error?: string): ProcessingGateway {
  const real = createProcessingGateway(createMockApiClient(), {
    EventSourceImpl: MockEventSource as unknown as typeof EventSource,
  });

  return {
    ...real,
    readProgressOnce: () =>
      Promise.resolve({
        ok: true,
        data: {
          id: 'progress-1',
          progressPercent: 40,
          status: 'failed',
          step: stepId,
          ...(error !== undefined ? { error } : {}),
        },
      }),
  };
}

/** jsdom không có `matchMedia`; `matches: false` là khung rộng, không giảm chuyển động. */
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
/* [NGHIEM-1] Bảy trạng thái (A11, R-63).                                      */
/* -------------------------------------------------------------------------- */

describe('ProcessingScreen — bảy trạng thái (A11, R-63)', () => {
  it('vẽ đủ bảy trạng thái, không lần nào ném lỗi và không lần nào ra màn trắng', () => {
    let rendered = 0;

    expectSevenStates((scenario) => {
      const { container, unmount } = renderWithProviders(
        <ProcessingScreen {...scenarioFor(scenario.state)} />,
      );
      rendered += 1;
      return { container, unmount };
    }, scenarioIndex());

    expect(rendered).toBe(SEVEN_STATES.length);
    expect(rendered).toBe(7);
  });

  it('trạng thái một phần nói rõ xử lý VẪN tiếp tục, và dãy chip mang tầng lỗi', () => {
    const partial = scenarioFor('partial');

    renderWithProviders(<ProcessingScreen {...partial} />);

    expect(partial.floors.filter((floor) => floor.status === 'failed')).toHaveLength(1);
    expect(partial.floors.filter((floor) => floor.status === 'running').length).toBeGreaterThan(0);
    expect(
      screen.getByText('Tầng 2 gặp lỗi. Các tầng còn lại vẫn đang được xử lý.'),
    ).toBeInTheDocument();
  });
});

describe('ProcessingScreen — tab "Xem trước"/"Nhật ký" cao 44 khi chạm', () => {
  it('hai tab theo khuôn nút chạm của Button: 44 khi chạm (máy tính bảng), 36 khi dùng chuột', () => {
    renderWithProviders(<ProcessingScreen {...scenarioFor('success')} />);

    for (const name of ['Bản vẽ', 'Nhật ký']) {
      expect(screen.getByRole('tab', { name })).toHaveClass('h-11', 'fine:h-9');
    }
  });
});

/* -------------------------------------------------------------------------- */
/* Khả năng tiếp cận, tiếng Việt, màu (R-72).                                   */
/* -------------------------------------------------------------------------- */

describe('ProcessingScreen — khả năng tiếp cận, tiếng Việt, màu (R-72)', () => {
  it('đi qua expectAccessible ở trạng thái đầy đủ nhất', () => {
    const { container } = renderWithProviders(<ProcessingScreen {...scenarioFor('success')} />);

    expectAccessible(container);
  });

  it('đi qua expectAccessible ở trạng thái một phần, nơi có cả lỗi lẫn tiến độ', () => {
    const { container } = renderWithProviders(<ProcessingScreen {...scenarioFor('partial')} />);

    expectAccessible(container);
  });

  it('mọi chuỗi hiển thị là tiếng Việt có dấu', () => {
    const { container } = renderWithProviders(<ProcessingScreen {...scenarioFor('success')} />);

    expectVietnamese(container, { allowWords: ALLOWED_WORDS, ignore: [MACHINE_ERROR_CODE] });
  });

  it('mọi chuỗi hiển thị của trạng thái lỗi cũng là tiếng Việt có dấu', () => {
    const { container } = renderWithProviders(<ProcessingScreen {...scenarioFor('error')} />);

    expectVietnamese(container, { allowWords: ALLOWED_WORDS, ignore: [MACHINE_ERROR_CODE] });
  });

  it('không mã màu thô trong bất kỳ file nào của thư mục màn (A1)', () => {
    for (const file of readdirSync(SCREEN_DIRECTORY)) {
      expectNoRawColor(`${SCREEN_DIRECTORY}/${file}`);
    }
  });
});

/* -------------------------------------------------------------------------- */
/* [NGHIEM-3] Sáu tên bước, nguyên văn.                                        */
/* -------------------------------------------------------------------------- */

describe('ProcessingScreen — sáu tên bước [NGHIEM-3]', () => {
  it('hiện đúng sáu chuỗi của khoá `pipeline` trong vi.json, không viết tắt', () => {
    const expected = Object.values(viMessages.pipeline);

    expect(expected).toHaveLength(6);
    expect(PIPELINE_STEP_NAMES).toEqual(expected);

    renderWithProviders(<ProcessingScreen {...scenarioFor('success')} />);

    for (const name of expected) {
      expect(screen.getByText(name)).toBeInTheDocument();
    }
  });
});

/* -------------------------------------------------------------------------- */
/* [NGHIEM-4] Hằng của tầng lib không được chép sang thư mục màn.               */
/* -------------------------------------------------------------------------- */

describe('ProcessingScreen — không chép hằng của tầng lib [NGHIEM-4]', () => {
  it('không file nào trong thư mục màn chép lại dãy trọng số hay hằng nhịp giả', () => {
    // Hai mẫu dựng TỪ DỮ LIỆU, không gõ tay: gõ tay thì chính file test này
    // thành file vi phạm đầu tiên, và phép kiểm tự bắn vào chân mình.
    const weightSequence = new RegExp(
      PIPELINE_STAGES.map((stage) => String(stage.weight)).join('\\s*,\\s*'),
    );
    const fakeTickMs = new RegExp(`\\b${String(25 * 100)}\\b`);
    const offenders: string[] = [];

    for (const file of readdirSync(SCREEN_DIRECTORY)) {
      const source = readFileSync(`${SCREEN_DIRECTORY}/${file}`, 'utf8');

      if (weightSequence.test(source) || fakeTickMs.test(source)) {
        offenders.push(file);
      }
    }

    expect(offenders).toEqual([]);
  });
});

/* -------------------------------------------------------------------------- */
/* [NGHIEM-C] Huỷ xác nhận tại chỗ — không hộp thoại chặn.                      */
/* -------------------------------------------------------------------------- */

describe('ProcessingScreen — huỷ xử lý [NGHIEM-C]', () => {
  it('không trạng thái nào dựng ra phần tử role="dialog" hay aria-modal', () => {
    for (const state of SEVEN_STATES) {
      const { container, unmount } = renderWithProviders(
        <ProcessingScreen {...scenarioFor(state)} />,
      );

      expect(container.querySelectorAll('[role="dialog"]')).toHaveLength(0);
      expect(container.querySelectorAll('[role="alertdialog"]')).toHaveLength(0);
      expect(container.querySelectorAll('[aria-modal]')).toHaveLength(0);
      unmount();
    }
  });

  it('lớp xác nhận đang mở vẫn không phải hộp thoại, và có cả lối rút lui', () => {
    const { container } = renderWithProviders(
      <ProcessingScreen {...cancelConfirmingScenario()} />,
    );

    expect(screen.getByRole('button', { name: CANCEL_CONFIRM_LABEL })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: CANCEL_DISMISS_LABEL })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: CANCEL_LABEL })).not.toBeInTheDocument();
    expect(container.querySelectorAll('[role="dialog"], [aria-modal]')).toHaveLength(0);
  });

  it('bấm huỷ qua container thật ra xác nhận TẠI CHỖ, không mở hộp thoại nào', () => {
    let cancelled = 0;
    const gateway = gatewayWithCancel(() => {
      cancelled += 1;
    });

    const { container } = renderWithProviders(
      <ProcessingScreenContainer
        floorUploads={ONE_UPLOAD}
        gateway={gateway}
        projectId={PROJECT_ID}
        roles={['engineer']}
      />,
    );

    fireEvent.click(screen.getByRole('button', { name: CANCEL_LABEL }));

    expect(screen.getByRole('button', { name: CANCEL_CONFIRM_LABEL })).toBeInTheDocument();
    expect(container.querySelectorAll('[role="dialog"], [aria-modal]')).toHaveLength(0);

    fireEvent.click(screen.getByRole('button', { name: CANCEL_CONFIRM_LABEL }));

    expect(cancelled).toBe(1);
  });
});

/* -------------------------------------------------------------------------- */
/* [NGHIEM-D] canCancel sai thì nút huỷ không tồn tại.                          */
/* -------------------------------------------------------------------------- */

describe('ProcessingScreen — quyền huỷ [NGHIEM-D]', () => {
  it('canCancel sai thì nút huỷ KHÔNG có trong cây, không phải khoá mờ', () => {
    const { container } = renderWithProviders(<ProcessingScreen {...scenarioFor('forbidden')} />);

    expect(screen.queryByRole('button', { name: CANCEL_LABEL })).not.toBeInTheDocument();
    expect(container.querySelectorAll('button[disabled]')).toHaveLength(0);
  });

  it('canCancel đúng thì nút huỷ có mặt và bấm được', () => {
    const requested = vi.fn();

    renderWithProviders(
      <ProcessingScreen {...scenarioFor('partial')} onRequestCancel={requested} />,
    );

    fireEvent.click(screen.getByRole('button', { name: CANCEL_LABEL }));

    expect(requested).toHaveBeenCalledTimes(1);
  });
});

/* -------------------------------------------------------------------------- */
/* [NGHIEM-E] Chuyển động rút gọn.                                             */
/* -------------------------------------------------------------------------- */

describe('ProcessingScreen — chuyển động rút gọn [NGHIEM-E]', () => {
  it('prefersReducedMotion bật thì không phần tử nào mang lớp animate-pipeline-sweep', () => {
    const { container } = renderWithProviders(<ProcessingScreen {...reducedMotionScenario()} />);

    expect(container.querySelectorAll(SWEEP_CLASS_SELECTOR)).toHaveLength(0);
  });

  it('prefersReducedMotion tắt thì vạch quét có mặt — phép kiểm trên đo được thứ thật', () => {
    const { container } = renderWithProviders(<ProcessingScreen {...scenarioFor('partial')} />);

    expect(container.querySelectorAll(SWEEP_CLASS_SELECTOR).length).toBeGreaterThan(0);
  });
});

/* -------------------------------------------------------------------------- */
/* R-73 — mở được màn này từ một màn khác bằng một dòng.                        */
/* -------------------------------------------------------------------------- */

describe('ProcessingScreenContainer — R-73', () => {
  it('nhận đủ mọi thứ qua props và dựng ra màn không trắng', () => {
    const { container } = renderWithProviders(
      <ProcessingScreenContainer
        floorUploads={[]}
        gateway={gatewayWithCancel(() => undefined)}
        onGoToSupport={() => undefined}
        onNavigate={() => undefined}
        projectId={PROJECT_ID}
        roles={['engineer']}
      />,
    );

    expect(container.textContent?.trim()).not.toBe('');
    expect(screen.getByRole('heading', { level: 1, name: /Theo dõi AI đọc bản vẽ/u })).toBeInTheDocument();
  });

  it('không ai truyền floorUploads thì màn tự đọc N7 và theo dõi lượt có sẵn (B-V4-01)', async () => {
    renderWithProviders(
      <ProcessingScreenContainer
        gateway={gatewayWithCancel(() => undefined)}
        onNavigate={() => undefined}
        projectId={PROJECT_ID}
        roles={['engineer']}
      />,
    );

    expect(await screen.findByText('Đã xử lý xong 1/1 tầng')).toBeInTheDocument();
    expect(screen.queryByText('Chưa có bước nào để theo dõi')).toBeNull();
  });

  it('N7 hỏng thì màn ở trạng thái lỗi có lối thử lại, không giả vờ rỗng (B-V4-01)', async () => {
    const real = gatewayWithCancel(() => undefined);

    renderWithProviders(
      <ProcessingScreenContainer
        gateway={{
          ...real,
          readLatestUploads: () =>
            Promise.resolve({ ok: false, error: toAppError(new Error('mất kết nối')) }),
        }}
        onNavigate={() => undefined}
        projectId={PROJECT_ID}
        roles={['engineer']}
      />,
    );

    expect(await screen.findByRole('button', { name: /thử lại/iu })).toBeInTheDocument();
    expect(screen.queryByText('Chưa có bước nào để theo dõi')).toBeNull();
  });
});

describe('ProcessingScreenContainer — dự án không tồn tại (BUG-312)', () => {
  it('one "Không tìm thấy dự án này" with the way back; no "Thử lại", no raw code, no empty panels', async () => {
    const onNavigate = vi.fn();
    // The real N7 answers 404 `project` for an unknown project, as #24 does.
    const missing = await createMockApiClient().projects.read({ projectId: MOCK_MISSING_PROJECT_ID });
    if (missing.ok) throw new Error('the mock should not know this project');
    renderWithProviders(
      <ProcessingScreenContainer
        gateway={{
          ...gatewayWithCancel(() => undefined),
          readLatestUploads: () => Promise.resolve({ ok: false, error: missing.error }),
        }}
        onNavigate={onNavigate}
        projectId={MOCK_MISSING_PROJECT_ID}
        roles={['engineer']}
      />,
    );

    fireEvent.click(await screen.findByRole('button', { name: 'Về danh sách dự án' }));
    expect(onNavigate).toHaveBeenCalledWith('/');
    expect(screen.getByText('Không tìm thấy dự án này')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /thử lại/iu })).toBeNull();
    expect(screen.queryByText('NOT_FOUND')).toBeNull();
    expect(screen.queryByRole('tablist')).toBeNull();
  });
});

/* -------------------------------------------------------------------------- */
/* Gắn S-11 `PipelineFailure` khi một bước AI hỏng.                            */
/* -------------------------------------------------------------------------- */

describe('ProcessingScreenContainer — gắn S-11 PipelineFailure khi một bước AI hỏng', () => {
  it('một bước hỏng thì PipelineFailureContainer THẾ CHỖ ProcessingScreen thật sự', async () => {
    const FAILED_STEP_ID = 'wallSegmentation';

    const { container } = renderWithProviders(
      <ProcessingScreenContainer
        floorUploads={ONE_UPLOAD}
        gateway={gatewayWithFailedStep(FAILED_STEP_ID)}
        onNavigate={() => undefined}
        projectId={PROJECT_ID}
        roles={['engineer']}
      />,
    );

    // Thân màn S-11 có mặt — `PipelineFailure.tsx` dựng đúng một id này (`BODY_ID`).
    await waitFor(() => {
      expect(container.querySelector('#pipeline-failure-body')).not.toBeNull();
    });

    // Và ProcessingScreen thật sự đã bị THAY: cột phải "Xem trước/Nhật ký" cùng
    // nút huỷ của S-10 không còn trong cây, không phải hai màn chồng lên nhau.
    expect(screen.queryByRole('button', { name: CANCEL_LABEL })).not.toBeInTheDocument();
    expect(screen.queryByRole('tab', { name: 'Bản vẽ' })).not.toBeInTheDocument();

    // Không màn trắng (A11): còn nội dung thật để đọc.
    expect(container.textContent?.trim()).not.toBe('');
  });

  it('bước hỏng PIPELINE_STEP_TIMEOUT: S-11 hiện câu của bảng và mã đó, không UNKNOWN', async () => {
    renderWithProviders(
      <ProcessingScreenContainer
        floorUploads={ONE_UPLOAD}
        gateway={gatewayWithFailedStep('wallSegmentation', 'PIPELINE_STEP_TIMEOUT')}
        onNavigate={() => undefined}
        projectId={PROJECT_ID}
        roles={['engineer']}
      />,
    );

    expect(await screen.findByText('Bước xử lý chạy quá thời gian cho phép.')).toBeInTheDocument();
    expect(screen.getAllByText('PIPELINE_STEP_TIMEOUT').length).toBeGreaterThan(0);
    expect(screen.queryByText(/Máy chủ chưa có phần trả chi tiết/)).toBeNull();
    expect(screen.queryByText(/UNKNOWN/)).toBeNull();
  });

  it('mã lạ: S-11 hiện câu dự phòng kèm mã', async () => {
    renderWithProviders(
      <ProcessingScreenContainer
        floorUploads={ONE_UPLOAD}
        gateway={gatewayWithFailedStep('wallSegmentation', 'FOO_BAR')}
        onNavigate={() => undefined}
        projectId={PROJECT_ID}
        roles={['engineer']}
      />,
    );

    expect(await screen.findByText('Bước xử lý gặp lỗi mà hệ thống chưa phân loại được.')).toBeInTheDocument();
    expect(screen.getAllByText('FOO_BAR').length).toBeGreaterThan(0);
  });

  it('3 tầng, 1 hỏng FILE_CORRUPT, 2 đang chạy: không S-11; hai tầng kia xong thì S-11', async () => {
    class LiveEventSource {
      static last: LiveEventSource | null = null;
      readonly url: string;
      onerror: ((event: Event) => void) | null = null;
      onmessage: ((event: MessageEvent) => void) | null = null;
      onopen: ((event: Event) => void) | null = null;
      constructor(url: string) {
        this.url = url;
        LiveEventSource.last = this;
      }
      close(): void {}
    }

    const uploads = [
      { floorId: 'L1', floorName: 'Tầng 1', uploadId: 'upload-a' },
      { floorId: 'L2', floorName: 'Tầng 2', uploadId: 'upload-b' },
      { floorId: 'L3', floorName: 'Tầng 3', uploadId: 'upload-c' },
    ] as const;
    const running = (id: string) => ({ id, progressPercent: 30, status: 'running' as const, step: PIPELINE_STAGES[1]!.id });
    const completed = (id: string) => ({
      id,
      progressPercent: 100,
      status: 'completed' as const,
      step: PIPELINE_STAGES[PIPELINE_STAGES.length - 1]!.id,
      endedAt: '2026-08-17T07:40:00.000Z',
    });
    const statuses = new Map<string, Progress>([
      ['upload-a', { id: 'upload-a', progressPercent: 20, status: 'failed', step: PIPELINE_STAGES[1]!.id, error: 'FILE_CORRUPT' }],
      ['upload-b', running('upload-b')],
      ['upload-c', running('upload-c')],
    ]);
    const base = createMockApiClient();
    const gateway = createProcessingGateway(
      {
        ...base,
        drawings: {
          ...base.drawings,
          progress: async ({ uploadId }) => ({ ok: true, data: statuses.get(uploadId)! }),
        },
      },
      { EventSourceImpl: LiveEventSource as unknown as typeof EventSource },
    );

    const { container } = renderWithProviders(
      <ProcessingScreenContainer
        floorUploads={uploads}
        gateway={gateway}
        onNavigate={() => undefined}
        projectId={PROJECT_ID}
        roles={['engineer']}
      />,
    );

    expect(await screen.findByText(/Tầng 1 gặp lỗi\. Các tầng còn lại vẫn đang được xử lý\./)).toBeInTheDocument();
    expect(container.querySelector('#pipeline-failure-body')).toBeNull();

    const finish = async (uploadId: string): Promise<void> => {
      statuses.set(uploadId, completed(uploadId));
      await waitFor(() => expect(LiveEventSource.last?.url).toContain(uploadId));
      act(() => {
        LiveEventSource.last?.onmessage?.(
          new MessageEvent('message', { data: JSON.stringify(completed(uploadId)) }),
        );
      });
    };

    await finish('upload-b');
    await finish('upload-c');

    await waitFor(() => {
      expect(container.querySelector('#pipeline-failure-body')).not.toBeNull();
    });
    expect(await screen.findByText('Tệp bản vẽ bị hỏng nên không mở được.')).toBeInTheDocument();
  });

  it('không bước nào hỏng thì ProcessingScreen vẽ như cũ, không có PipelineFailureContainer', () => {
    const { container } = renderWithProviders(
      <ProcessingScreenContainer
        floorUploads={ONE_UPLOAD}
        gateway={gatewayWithCancel(() => undefined)}
        onNavigate={() => undefined}
        projectId={PROJECT_ID}
        roles={['engineer']}
      />,
    );

    expect(container.querySelector('#pipeline-failure-body')).toBeNull();
    expect(screen.getByRole('button', { name: CANCEL_LABEL })).toBeInTheDocument();
  });
});

/* -------------------------------------------------------------------------- */
/* Nút "Để chạy nền và thông báo cho tôi" — nó phải LÀM được một việc.          */
/* -------------------------------------------------------------------------- */

/**
 * Hook + view + chỗ hiện thông báo, dựng ngay tại test.
 *
 * Không dùng `ProcessingScreenContainer` ở đây, vì container không có khe tiêm
 * bus thông báo (và mở một khe như vậy chỉ để test nhìn được là đổi hình dạng
 * sản phẩm cho tiện lợi của test). Cả ba mảnh dưới đây là mảnh THẬT — cùng hook,
 * cùng view, cùng `NotificationHost` mà `src/main.tsx` gắn — chỉ có bus và sổ
 * theo dõi nền là bản cách ly, để lượt kiểm này không thấy thông báo của lượt
 * kiểm khác.
 */
function WiredWithNotifications({
  backgroundWatches,
  notifications,
}: {
  backgroundWatches: BackgroundWatchRegistry;
  notifications: NotificationBus;
}) {
  const gateway = createProcessingGateway(createMockApiClient(), {
    EventSourceImpl: MockEventSource as unknown as typeof EventSource,
    backgroundWatches,
  });

  const props = useProcessingScreen({
    projectId: PROJECT_ID,
    floorUploads: ONE_UPLOAD,
    gateway,
    notifications,
    roles: ['engineer'],
  });

  return (
    <>
      <ProcessingScreen {...props} />
      <NotificationHost bus={notifications} />
    </>
  );
}

describe('ProcessingScreen — nút chạy nền', () => {
  it('bấm "Để chạy nền và thông báo cho tôi": thông báo HIỆN RA, và lượt vào sổ theo dõi nền', async () => {
    const backgroundWatches = createBackgroundWatchRegistry();
    const notifications = createNotificationBus();

    renderWithProviders(
      <WiredWithNotifications
        backgroundWatches={backgroundWatches}
        notifications={notifications}
      />,
    );

    expect(screen.queryByText(/Sẽ báo cho bạn khi xử lý xong/)).not.toBeInTheDocument();

    // Luồng chỉ mở sau #8 mồi (F-05b: tầng đã cuối thì không đăng ký); chưa có
    // luồng thì chưa có gì để giao cho sổ nền.
    const openedBefore = MockEventSource.opened;
    await waitFor(() => expect(MockEventSource.opened).toBeGreaterThan(openedBefore));

    fireEvent.click(screen.getByRole('button', { name: RUN_IN_BACKGROUND_LABEL }));

    // Câu người dùng đọc, đúng nguyên văn, và nó nói luôn ranh giới thật: đóng
    // thẻ trình duyệt là hết.
    const notice = await screen.findByText(/Sẽ báo cho bạn khi xử lý xong/);

    expect(notice).toBeInTheDocument();
    expect(notice.textContent).toContain('Đóng thẻ trình duyệt thì không báo được nữa.');

    // Và trình đọc màn hình đọc được nó (R-72).
    expect(notice.closest('[role="status"]')).not.toBeNull();
    expect(screen.getByRole('region', { name: 'Thông báo' })).toBeInTheDocument();

    expect(backgroundWatches.has(`${PROJECT_ID}:${ONE_UPLOAD[0].uploadId}`)).toBe(true);

    backgroundWatches.releaseAll();
  });
});

describe('ProcessingScreen — màn rỗng (BUG-165)', () => {
  it('chỉ bước kế "Tải bản vẽ" và không hứa chạy nền khi không có gì chạy', () => {
    const onUploadDrawings = vi.fn();
    renderWithProviders(<ProcessingScreen {...scenarioFor('empty')} onUploadDrawings={onUploadDrawings} />);

    expect(screen.queryByRole('button', { name: RUN_IN_BACKGROUND_LABEL })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Tải bản vẽ' }));
    expect(onUploadDrawings).toHaveBeenCalledTimes(1);
  });

  it('breadcrumb nêu tên dự án khi biết tên', () => {
    renderWithProviders(<ProcessingScreen {...scenarioFor('empty')} projectName="Nhà phố Quận 3" />);

    expect(screen.getByRole('navigation', { name: 'Xử lý' })).toHaveTextContent('Dự án›Nhà phố Quận 3›Xử lý');
  });

  it('BUG-546: cấp "Dự án" của breadcrumb là liên kết về danh sách dự án', () => {
    const onBackToProjects = vi.fn();
    renderWithProviders(<ProcessingScreen {...scenarioFor('partial')} onBackToProjects={onBackToProjects} />);

    fireEvent.click(within(screen.getByRole('navigation', { name: 'Xử lý' })).getByRole('link', { name: 'Dự án' }));
    expect(onBackToProjects).toHaveBeenCalledTimes(1);
  });

  it('BUG-547: panel Xem trước có role region nên tên được đọc', () => {
    renderWithProviders(<ProcessingScreen {...scenarioFor('partial')} />);

    expect(screen.getByRole('region', { name: 'Xem trước bản vẽ đang xử lý' })).toBeInTheDocument();
  });

  it('BUG-554: dòng tóm tắt tiến độ nằm trong vùng role=status, ngoài hai tab', () => {
    const props = scenarioFor('partial');
    renderWithProviders(<ProcessingScreen {...props} />);

    const status = screen.getAllByRole('status').find((node) => node.textContent?.includes(props.overallSummaryLine));
    expect(status).toBeDefined();
    expect(status?.closest('[role="tabpanel"]')).toBeNull();
  });

  // R1-03: "Còn lại khoảng …" changes every second; inside the polite region the reader re-read
  // the whole sentence at every tick.
  it('R1-03: thời gian còn lại hiện cùng dòng nhưng ngoài mọi vùng role=status', () => {
    const props = scenarioFor('partial');
    const view = renderWithProviders(<ProcessingScreen {...props} />);
    const statusText = (): string[] => screen.getAllByRole('status').map((node) => node.textContent ?? '');
    const before = statusText();

    expect(screen.getByText('Đã xử lý xong 2/4 tầng').closest('p')).toHaveTextContent(
      'Đã xử lý xong 2/4 tầng · Còn lại khoảng 3 phút',
    );
    expect(before.some((text) => text.includes('Còn lại khoảng'))).toBe(false);

    view.rerender(<ProcessingScreen {...props} remainingLine="Còn lại khoảng 2 phút 59 giây" />);

    expect(screen.getByText(/Còn lại khoảng 2 phút 59 giây/u)).toBeInTheDocument();
    expect(statusText()).toEqual(before);
  });
});

describe('ProcessingScreen — khổ hẹp (BUG-294)', () => {
  it('a narrow finished run still lists every step behind "Xem tất cả các bước", and the summary is in the page flow', () => {
    const { container } = renderWithProviders(<ProcessingScreen {...scenarioFor('success')} isCompact />);

    fireEvent.click(screen.getByText('Xem tất cả các bước'));
    const steps = screen.getByRole('list', { name: 'Các bước xử lý' });
    for (const name of PIPELINE_STEP_NAMES) {
      expect(within(steps).getByRole('progressbar', { name })).toBeInTheDocument();
    }
    // No fixed overlay left to cover "Duyệt lớp tường" (BUG-285 at 768/375).
    expect(container.querySelector('.fixed')).toBeNull();
    expect(screen.getAllByRole('button', { name: /Đặt tỷ lệ|Sang Duyệt tầng/u }).length).toBeGreaterThan(0);
  });
});

describe('ProcessingScreen — tầng chưa có bản vẽ, lối chất lượng, danh sách lượt (N2-02, N5-04, N5-08)', () => {
  it('liệt kê tầng chưa có bản vẽ, nút chất lượng ảnh và các lượt ở tab Nhật ký', () => {
    const onUploadDrawings = vi.fn();
    const onOpenQuality = vi.fn();

    renderWithProviders(
      <ProcessingScreen
        {...scenarioFor('success')}
        activeTab="log"
        floorsWithoutDrawing={[{ id: 'f-3', label: 'Tầng 3' }]}
        onOpenQuality={onOpenQuality}
        onUploadDrawings={onUploadDrawings}
        runs={[
          { id: 'r1', floorName: 'Tầng 1', statusLabel: 'Hoàn tất', timeLabel: '14:05 · 18/10/2026', tone: 'done' },
        ]}
      />,
    );

    const missing = screen.getByRole('list', { name: 'Tầng chưa có bản vẽ' });
    expect(within(missing).getByText('Tầng 3')).toBeInTheDocument();
    fireEvent.click(within(missing).getByRole('button', { name: 'Tải bản vẽ cho tầng này: Tầng 3' }));
    expect(onUploadDrawings).toHaveBeenCalledTimes(1);

    fireEvent.click(screen.getByRole('button', { name: 'Chất lượng ảnh' }));
    expect(onOpenQuality).toHaveBeenCalledTimes(1);

    const runs = screen.getByRole('region', { name: 'Các lượt xử lý gần đây' });
    expect(within(runs).getByText('Hoàn tất')).toBeInTheDocument();
  });
});

describe('ProcessingScreen — tỷ lệ là điều kiện chặn (quyết định chủ dự án, Z/S-10)', () => {
  it('xong mà 0 số kích thước: nút chính là "Đặt tỷ lệ", "Sang Duyệt tầng" chỉ là nút phụ', () => {
    const onCalibrateScale = vi.fn();
    const onReviewWalls = vi.fn();
    renderWithProviders(
      <ProcessingScreen
        {...scenarioFor('success')}
        summary={{
          ...SAMPLE_SUMMARY,
          metricLabels: ['81 tường', '95 đối tượng', '0 số kích thước', '2 phòng', '73,90 m²'],
          noDimensionSentence: 'Không đọc được chuỗi kích thước nào.',
          onCalibrateScale,
          onReviewWalls,
        }}
      />,
    );

    expect(screen.getByRole('button', { name: /Sang Duyệt tầng/u })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Đặt tỷ lệ' }));
    expect(onCalibrateScale).toHaveBeenCalledTimes(1);
    expect(onReviewWalls).not.toHaveBeenCalled();
  });

  it('xong và có chuỗi kích thước: nút chính là "Sang Duyệt tầng"', () => {
    const onReviewWalls = vi.fn();
    renderWithProviders(<ProcessingScreen {...scenarioFor('success')} summary={{ ...SAMPLE_SUMMARY, onReviewWalls }} />);

    expect(screen.queryByRole('button', { name: 'Đặt tỷ lệ' })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /Sang Duyệt tầng/u }));
    expect(onReviewWalls).toHaveBeenCalledTimes(1);
  });

  it('đang chạy: không có nút chính, chỉ câu chờ', () => {
    renderWithProviders(<ProcessingScreen {...scenarioFor('partial')} />);

    expect(screen.queryByRole('button', { name: /Sang Duyệt tầng|Đặt tỷ lệ/u })).not.toBeInTheDocument();
    expect(screen.getByText('Khi AI xong, nút sang Duyệt tầng hiện ở đây.')).toBeInTheDocument();
  });
});
