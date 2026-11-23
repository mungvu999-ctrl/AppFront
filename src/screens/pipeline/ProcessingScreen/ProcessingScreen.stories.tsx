/**
 * Bảy story, một cho mỗi trạng thái của A11 (R-63).
 *
 * Story dựng thẳng {@link ProcessingScreen} — không container, không provider,
 * không cổng dữ liệu, không một lời gọi mạng nào. Đó là thứ mục D mua được: xem
 * được cả bảy trạng thái mà không phải dựng nổi một máy chủ. Cùng khuôn
 * `InputQualityGate.stories.tsx`.
 *
 * ## Vì sao story phải tự diễn đủ dữ liệu
 *
 * Cổng dữ liệu thật (`processingGateway.ts`) trả `supported: false` cho BẢY
 * trong chín khả năng — repo hôm nay không có endpoint huỷ, không có vị trí
 * hàng đợi, không có tổng kết trích xuất, không có hình học dò được giữa chừng.
 * Story lấy dữ liệu từ bản cài đặt thật thì khối tổng kết, dòng hàng đợi và nút
 * huỷ **không bao giờ được vẽ ra**, và ba mảnh giao diện đó không ai kiểm được.
 * Nên story ở đây điền tay đúng hình dạng cổng SẼ trả về khi endpoint có mặt —
 * nó diễn phía "có hỗ trợ" của mỗi nhánh, đúng như `ProcessingGateway.supports`
 * mô tả để test cắm bản giả bật `true`.
 *
 * Hai khả năng KHÔNG nằm trong số đó: `stageBreakdown` (bật, kèm giả định C3) và
 * `runInBackground` (bật, và chạy thật — nó không cần endpoint nào, chỉ cần một
 * chỗ giữ hàm huỷ đăng ký, xem `src/lib/realtime/backgroundWatch.ts`).
 *
 * ## Nút chạy nền ở đây vẫn là `NO_OP`, và đó là đúng
 *
 * Story dựng thẳng view, nên `onRunInBackground` chỉ là một props như mọi props
 * khác — không có hook, không có sổ theo dõi, không có bus thông báo phía sau.
 * Phần thông báo có story riêng của nó: `NotificationHost.stories.tsx`.
 *
 * ## Sáu tên bước không được gõ tay
 *
 * {@link getPipelineStages} đọc thẳng `src/i18n/vi.json` khoá `pipeline`, nên
 * sáu tên bước ở đây là NGUYÊN VĂN sáu chuỗi đã ship — không viết tắt, không
 * dịch lại (mục [CẤM TUYỆT ĐỐI]). Gõ tay là dựng bản thứ hai của một chuỗi đã
 * có chủ, và bản thứ hai sẽ lệch. Trọng số của sáu bước cũng vậy: chúng nằm ở
 * `PIPELINE_STAGES` (`src/lib/realtime/pipeline.ts`) và không được chép sang
 * thư mục màn này.
 */

import type { Meta, StoryObj } from '@storybook/react';

import { getPipelineStages } from '@/lib/realtime/pipeline';
import { SEVEN_STATES, type SevenState } from '@/lib/testing/sevenStateScenarios';

import { describePipelineError } from '../pipelineErrorText';

import { ProcessingScreen } from './ProcessingScreen';
import type {
  ProcessingFloorChipViewModel,
  ProcessingLogLineViewModel,
  ProcessingPreviewViewModel,
  ProcessingScreenProps,
  ProcessingStageStatus,
  ProcessingStepViewModel,
  ProcessingSummaryViewModel,
} from './types';

/** Story không nối dây; mọi hành động là một hàm không làm gì. */
const NO_OP = (): void => undefined;

/* -------------------------------------------------------------------------- */
/* Sáu bước — tên lấy từ vi.json, không gõ tay.                                */
/* -------------------------------------------------------------------------- */

/** Sáu bước đã ship, kèm nhãn tiếng Việt nguyên văn của khoá `pipeline`. */
export const PIPELINE_STEP_NAMES: readonly string[] = getPipelineStages().map(
  (stage) => stage.label,
);

/** Câu chi tiết của từng bước, viết sẵn cho story — hook thật ghép từ số đo thật. */
const STEP_DETAILS: Readonly<Record<string, readonly string[]>> = {
  preprocess: ['Đã nắn nghiêng và khử nhiễu bản vẽ.'],
  wallSegmentation: ['Đã tìm thấy 48 đoạn tường.'],
  openingAndFurnitureDetection: ['Đã nhận diện 12 cửa đi và 9 cửa sổ.'],
  dimensionReading: ['Đã đọc 26 chuỗi kích thước.'],
  spatialDataBuild: ['Đã dựng 34 phòng.'],
  qualityCheck: ['Đang đối chiếu ngưỡng tin cậy.'],
};

/**
 * Sáu bước ở một lát cắt thời gian: `runningIndex` bước đầu đã xong, bước thứ
 * `runningIndex` đang chạy, phần còn lại đang chờ.
 *
 * `percent` là ngoại lệ A15 đã ghi ở `types.ts` — nó cấp cho chu kỳ vẽ của chính
 * thanh tiến độ, không phải một con số người đọc.
 */
function stepsAt(
  runningIndex: number,
  options: { readonly runningPercent?: number; readonly failedIndex?: number } = {},
): readonly ProcessingStepViewModel[] {
  const runningPercent = options.runningPercent ?? 0;

  return getPipelineStages().map((stage, index) => {
    const status: ProcessingStageStatus =
      index === options.failedIndex
        ? 'failed'
        : index < runningIndex
          ? 'done'
          : index === runningIndex
            ? 'running'
            : 'queued';

    const base: ProcessingStepViewModel = {
      id: stage.id,
      name: stage.label,
      status,
      percent: status === 'done' ? 100 : status === 'running' ? runningPercent : 0,
      isScanning: status === 'running',
      detailLabels: status === 'queued' ? [] : (STEP_DETAILS[stage.id] ?? []),
      isDetailOpen: index === runningIndex,
      onToggleDetail: NO_OP,
    };

    if (status !== 'running') {
      return base;
    }

    return { ...base, remainingLabel: 'còn khoảng 2 phút' };
  });
}

/** Bước lỗi mang cả mã máy đọc lẫn câu hậu quả — mã không bao giờ đứng một mình. */
/** Mã thật của bảng mã pipeline, câu lấy từ chính bảng đó. */
const STEP_FAILURE = describePipelineError('PIPELINE_STEP_TIMEOUT');

function withStepFailure(
  steps: readonly ProcessingStepViewModel[],
  failedIndex: number,
): readonly ProcessingStepViewModel[] {
  return steps.map((step, index) =>
    index === failedIndex
      ? {
          ...step,
          errorCode: STEP_FAILURE.code,
          errorMessage: STEP_FAILURE.sentence,
        }
      : step,
  );
}

/* -------------------------------------------------------------------------- */
/* Bốn tầng.                                                                   */
/* -------------------------------------------------------------------------- */

/** Nhãn trạng thái đã định dạng sẵn, viết thường kiểu câu (A6). */
const STAGE_STATUS_LABEL: Readonly<Record<ProcessingStageStatus, string>> = {
  queued: 'đang chờ',
  running: 'đang xử lý',
  done: 'đã xong',
  failed: 'lỗi',
};

function floorOf(
  id: string,
  label: string,
  status: ProcessingStageStatus,
  objectCountLabel?: string,
): ProcessingFloorChipViewModel {
  const base: ProcessingFloorChipViewModel = {
    id,
    label,
    status,
    statusLabel: STAGE_STATUS_LABEL[status],
    isActive: status === 'running',
  };

  return objectCountLabel === undefined ? base : { ...base, objectCountLabel };
}

/** Bốn tầng lúc chạy trơn: hai xong, một đang chạy, một còn chờ. */
export const RUNNING_FLOORS: readonly ProcessingFloorChipViewModel[] = [
  floorOf('L-1', 'Tầng hầm', 'done', '31 mục nhận diện'),
  floorOf('L1', 'Tầng 1', 'done', '48 mục nhận diện'),
  floorOf('L2', 'Tầng 2', 'running', '22 mục nhận diện'),
  floorOf('L3', 'Tầng 3', 'queued'),
];

/**
 * Bốn tầng khi MỘT tầng lỗi — đúng cảnh của trạng thái `partial`.
 *
 * `Tầng 2` mang chấm vi phạm, `Tầng 3` vẫn `running`: một tầng lỗi không được
 * dừng các tầng khác (mục [CẤM TUYỆT ĐỐI]), và dãy chip phải nói ra điều đó chứ
 * không chỉ dòng chữ dưới chân màn.
 */
export const PARTIAL_FLOORS: readonly ProcessingFloorChipViewModel[] = [
  floorOf('L-1', 'Tầng hầm', 'done', '31 mục nhận diện'),
  floorOf('L1', 'Tầng 1', 'done', '48 mục nhận diện'),
  floorOf('L2', 'Tầng 2', 'failed'),
  floorOf('L3', 'Tầng 3', 'running', '7 mục nhận diện'),
];

/* -------------------------------------------------------------------------- */
/* Nhật ký, xem trước, tổng kết.                                               */
/* -------------------------------------------------------------------------- */

export const SAMPLE_LOG_LINES: readonly ProcessingLogLineViewModel[] = [
  { id: 'log-1', timeLabel: '14:32:07', text: 'Bắt đầu tiền xử lý tầng hầm.' },
  { id: 'log-2', timeLabel: '14:32:41', text: 'Tầng hầm xong, nhận được 31 đối tượng.' },
  { id: 'log-3', timeLabel: '14:33:02', text: 'Bắt đầu tách lớp tường tầng 1.' },
  { id: 'log-4', timeLabel: '14:34:18', text: 'Tầng 1 xong, nhận được 48 đối tượng.' },
  { id: 'log-5', timeLabel: '14:34:29', text: 'Bắt đầu đọc kích thước tầng 2.' },
];

/** Ba đường hình học dò được, dạng path SVG vẽ đè lên ảnh nền. */
const DETECTED_PATHS: readonly string[] = ['M 8 12 L 92 12', 'M 8 12 L 8 88', 'M 92 12 L 92 88'];

function previewOf(
  activeFloorId: string | null,
  options: { readonly isScanning?: boolean; readonly withGeometry?: boolean } = {},
): ProcessingPreviewViewModel {
  return {
    altText:
      activeFloorId === null
        ? 'Chưa có bản vẽ nào để xem trước.'
        : 'Bản vẽ đang được xử lý — Tầng 2',
    isScanning: options.isScanning ?? false,
    detectedGeometryPaths: (options.withGeometry ?? false) ? DETECTED_PATHS : [],
    activeFloorId,
  };
}

/**
 * Báo cáo tổng kết — bộ số riêng của story: **34 phòng và sảnh, 248,60 m²**.
 *
 * Dấu thập phân là dấu phẩy (A15), và mọi con số ở đây đã là chuỗi: view không
 * làm tròn, không ghép câu.
 */
export const SAMPLE_SUMMARY: ProcessingSummaryViewModel = {
  metricLabels: ['48 tường', '30 cửa, 78 nội thất', '26 chuỗi kích thước', '34 phòng', '248,60 m²'],
  lowConfidenceSentence: 'Có 9 đối tượng có độ tin cậy dưới 0,75 cần bạn xem lại.',
  onReviewWalls: NO_OP,
  onCalibrateScale: NO_OP,
};

/* -------------------------------------------------------------------------- */
/* Bảy kịch bản.                                                               */
/* -------------------------------------------------------------------------- */

/** Phần chung của mọi kịch bản — bảy trạng thái chỉ khác nhau ở chỗ chúng khác. */
function baseScenario(): ProcessingScreenProps {
  return {
    state: 'loading',
    floors: RUNNING_FLOORS,
    steps: stepsAt(2, { runningPercent: 45 }),
    previewPanel: previewOf('L2', { isScanning: true, withGeometry: true }),
    logLines: SAMPLE_LOG_LINES,
    overallSummaryLine: 'Đã xử lý xong 2/4 tầng',
    remainingLine: 'Còn lại khoảng 4 phút 20 giây',
    activeTab: 'preview',
    onTabChange: NO_OP,
    isLogAutoScrollLocked: false,
    onToggleLogAutoScroll: NO_OP,
    onCopyLog: NO_OP,
    canCancel: true,
    isCancelConfirming: false,
    onRequestCancel: NO_OP,
    onConfirmCancel: NO_OP,
    onDismissCancel: NO_OP,
    onRunInBackground: NO_OP,
    canRunInBackground: true,
    onUploadDrawings: NO_OP,
    isCompact: false,
    prefersReducedMotion: false,
  };
}

/**
 * Bảy kịch bản, tra bằng `switch` cạn kiệt.
 *
 * `default` gán `state` vào một biến `never`: bớt một `case` thì `pnpm typecheck`
 * đỏ **trước khi** test kịp chạy, nên bảy trạng thái được canh bằng hai lớp độc
 * lập — biên dịch ở đây, và `expectSevenStates` lúc chạy.
 *
 * Khác `InputQualityGate`, màn này KHÔNG đổi tên trạng thái nào: `ProcessingScreenState`
 * mang đúng bảy tên của `SEVEN_STATES`, kể cả `'success'`.
 */
export function scenarioFor(state: SevenState): ProcessingScreenProps {
  const base = baseScenario();

  switch (state) {
    case 'empty':
      return {
        ...base,
        state: 'empty',
        floors: [],
        steps: [],
        previewPanel: previewOf(null),
        logLines: [],
        overallSummaryLine: 'Chưa có lượt xử lý nào đang chạy.',
        canCancel: false,
        canRunInBackground: false,
      };

    case 'loading':
      return {
        ...base,
        state: 'loading',
        floors: [],
        steps: [],
        previewPanel: previewOf(null),
        logLines: [],
        overallSummaryLine: 'Đang đọc tiến độ xử lý…',
        queueLine: 'Đang xếp hàng: còn 2 lượt phía trước. Ảnh lớn có thể mất vài phút.',
        canCancel: false,
      };

    case 'partial':
      return {
        ...base,
        state: 'partial',
        floors: PARTIAL_FLOORS,
        steps: withStepFailure(stepsAt(3, { runningPercent: 62, failedIndex: 1 }), 1),
        previewPanel: previewOf('L3', { isScanning: true, withGeometry: true }),
        overallSummaryLine: 'Đã xử lý xong 2/4 tầng',
        remainingLine: 'Còn lại khoảng 3 phút',
        partialNoticeLine: 'Tầng 2 gặp lỗi. Các tầng còn lại vẫn đang được xử lý.',
      };

    case 'error':
      return {
        ...base,
        state: 'error',
        steps: withStepFailure(stepsAt(2, { runningPercent: 0, failedIndex: 2 }), 2),
        previewPanel: previewOf('L2'),
        overallSummaryLine: 'Không đọc được tiến độ của lượt xử lý này.',
        errorAlert: {
          title: 'Mất kết nối tới máy chủ xử lý',
          message: 'Không đọc được tiến độ xử lý. Kiểm tra kết nối rồi thử lại.',
          technicalCode: 'NETWORK',
          onRetry: NO_OP,
          onGoToSupport: NO_OP,
        },
      };

    case 'success':
      return {
        ...base,
        state: 'success',
        floors: RUNNING_FLOORS.map((floor) =>
          floorOf(floor.id, floor.label, 'done', '48 mục nhận diện'),
        ),
        steps: stepsAt(getPipelineStages().length),
        previewPanel: previewOf('L3', { withGeometry: true }),
        summary: SAMPLE_SUMMARY,
        overallSummaryLine: 'Đã xong 4/4 tầng.',
        canCancel: false,
        canRunInBackground: false,
      };

    case 'forbidden':
      return {
        ...base,
        state: 'forbidden',
        overallSummaryLine: 'Đã xử lý xong 2/4 tầng',
        remainingLine: 'Còn lại khoảng 4 phút 20 giây',
        canCancel: false,
      };

    case 'collapsed':
      return { ...base, state: 'collapsed', isCompact: true };

    default: {
      const exhaustive: never = state;
      throw new Error(`Trạng thái ngoài bảy trạng thái của A11: ${String(exhaustive)}`);
    }
  }
}

/** Bảy kịch bản dựng sẵn, cùng thứ tự `SEVEN_STATES` — test dùng lại (R-70). */
export const SEVEN_SCENARIOS: readonly ProcessingScreenProps[] = SEVEN_STATES.map(scenarioFor);

/** Lớp xác nhận huỷ đã mở — hai nút inline thay chỗ nút huỷ, không hộp thoại. */
export function cancelConfirmingScenario(): ProcessingScreenProps {
  return { ...scenarioFor('partial'), canCancel: true, isCancelConfirming: true };
}

/** Bản chuyển động rút gọn: vạch quét thay bằng thanh tĩnh (mục B). */
export function reducedMotionScenario(): ProcessingScreenProps {
  return { ...scenarioFor('partial'), prefersReducedMotion: true };
}

/* -------------------------------------------------------------------------- */
/* Bảy story.                                                                  */
/* -------------------------------------------------------------------------- */

const meta = {
  title: 'Screens/Pipeline/ProcessingScreen',
  component: ProcessingScreen,
  parameters: { layout: 'fullscreen' },
  tags: ['autodocs'],
} satisfies Meta<typeof ProcessingScreen>;

export default meta;
type Story = StoryObj<typeof meta>;

/** Rỗng — chưa lượt xử lý nào; màn nói ra điều đó thay vì vẽ tiến độ bịa. */
export const Rong: Story = { args: scenarioFor('empty') };
/** Đang tải — bốn khung xương, chưa gọi tới cây bước; kèm dòng hàng đợi. */
export const DangTai: Story = { args: scenarioFor('loading') };
/** Một phần — tầng 2 lỗi, chip mang chấm vi phạm, ba tầng kia vẫn chạy tiếp. */
export const MotPhan: Story = { args: scenarioFor('partial') };
/** Lỗi — cảnh báo kèm mã kỹ thuật; mã không đứng một mình, luôn có câu giải thích. */
export const Loi: Story = { args: scenarioFor('error') };
/** Xong — sáu bước xong và khối tổng kết theo bộ số riêng của story. */
export const Xong: Story = { args: scenarioFor('success') };
/** Xong, còn nhắc nhẹ — chip vẫn "Xong", thêm hai dòng nhắc nhạt kèm liên kết tới đúng cửa/phòng (NO-488). */
export const XongCoNhac: Story = {
  args: {
    ...scenarioFor('success'),
    summary: {
      ...SAMPLE_SUMMARY,
      notices: [
        { code: 'OPENING_SIZE_IMPLAUSIBLE', count: 2, onOpen: NO_OP },
        { code: 'ROOM_AREA_TEXT_MISMATCH', count: 1, onOpen: NO_OP },
      ],
    },
  },
};
/** Không có quyền — hai cột vẫn đọc được, nút huỷ biến mất hẳn (không khoá mờ). */
export const KhongCoQuyen: Story = { args: scenarioFor('forbidden') };
/** Thu gọn — cột phải thành tấm trượt đáy, bất kể bề rộng khung nhìn. */
export const ThuGon: Story = { args: scenarioFor('collapsed') };
