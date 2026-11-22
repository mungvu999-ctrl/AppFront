/**
 * Bảy story, một cho mỗi trạng thái của A11 (R-63).
 *
 * Story dựng THẲNG {@link PipelineFailure} — không container, không hook, không
 * provider, không cổng dữ liệu, không một lời gọi mạng nào. Đó là thứ mục D mua
 * được: xem đủ bảy trạng thái mà không phải dựng nổi một máy chủ. Cùng khuôn
 * `ProcessingScreen.stories.tsx`.
 *
 * ## Vì sao dữ liệu viết tay
 *
 * Hook (`usePipelineFailure.ts`) và cổng dữ liệu là việc của worker khác và chưa
 * có ở lượt này. Story điền tay đúng hình dạng hợp đồng sẽ trả về, và mọi câu
 * tiếng Việt ở đây lấy nguyên văn khối `pipelineFailure` của `src/i18n/vi.json`
 * — không dịch lại, không viết tắt.
 *
 * ## `excludeStories`
 *
 * CSF coi MỌI export của file này là một story. {@link SEVEN_SCENARIOS} và
 * {@link scenarioFor} là dữ liệu để test dùng lại (R-70), không phải story, nên
 * chúng phải được khai trong `meta.excludeStories` — thiếu dòng đó thì Storybook
 * hỏng cả file chứ không chỉ hỏng một story.
 */

import type { Meta, StoryObj } from '@storybook/react';

import { SEVEN_STATES, type SevenState } from '@/lib/testing/sevenStateScenarios';

import { describePipelineError } from '../pipelineErrorText';

import { PipelineFailure } from './PipelineFailure';
import type {
  PipelineFailureBand,
  PipelineFailureCopyAction,
  PipelineFailureFloorStatus,
  PipelineFailureFloorViewModel,
  PipelineFailureKeptWork,
  PipelineFailureNextStep,
  PipelineFailureNextSteps,
  PipelineFailureProps,
  PipelineFailureReasonViewModel,
  PipelineFailureRetryAction,
  PipelineFailureTechnicalDetails,
} from './types';

/** Story không nối dây; mọi hành động là một hàm không làm gì. */
const NO_OP = (): void => undefined;

/** Mã bước đã hỏng — chạy lại ĐÚNG bước này, không phải cả lượt xử lý. */
const FAILED_STEP_ID = 'wallSegmentation';

/* -------------------------------------------------------------------------- */
/* Nút sao chép — nhãn đã ở đúng trạng thái đang hiện, view không đếm giờ.      */
/* -------------------------------------------------------------------------- */

function copyAction(ariaLabel: string): PipelineFailureCopyAction {
  return { label: 'Sao chép', ariaLabel, isCopied: false, onCopy: NO_OP };
}

/* -------------------------------------------------------------------------- */
/* Khối lỗi và ba hướng đi tiếp.                                               */
/* -------------------------------------------------------------------------- */

const REASON_FLOOR_03: PipelineFailureReasonViewModel = {
  summarySentence: 'Không nhận diện được lớp tường ở Tầng 03.',
  causeSentence:
    'Bản vẽ có nét quá mảnh và nhiều vết nhiễu, mô hình không tách được tường khỏi nội thất.',
  codeLabel: 'SEG-2041 · yêu cầu 8f2a-41',
  copyCode: copyAction('Sao chép mã lỗi'),
};

const REASON_ALL_FLOORS: PipelineFailureReasonViewModel = {
  summarySentence: 'Không tiền xử lý được ảnh ở cả bốn tầng.',
  causeSentence: 'Ảnh gốc hỏng một phần hoặc sai định dạng, bước tiền xử lý không đọc được.',
  codeLabel: 'PRE-0512 · yêu cầu 8f2a-41',
  copyCode: copyAction('Sao chép mã lỗi'),
};

/** Ca chính: chạy lại với ngưỡng thấp hơn là hướng được nhấn mạnh. */
const NEXT_STEPS: PipelineFailureNextSteps = [
  {
    id: 'retry-lower-threshold',
    label: 'Thử lại với ngưỡng thấp hơn',
    warningSentence: null,
    isPrimary: true,
    onSelect: NO_OP,
  },
  {
    id: 'upload-clearer',
    label: 'Tải lên bản vẽ rõ hơn',
    warningSentence: null,
    isPrimary: false,
    onSelect: NO_OP,
  },
  {
    id: 'skip-floor',
    label: 'Bỏ qua tầng đó',
    warningSentence: 'Bỏ qua tầng đó sẽ thiếu một tầng trong mô hình.',
    isPrimary: false,
    onSelect: NO_OP,
  },
];

/** Cả bốn tầng hỏng: hướng được nhấn mạnh đổi sang tải lại ảnh. */
const ERROR_NEXT_STEPS: PipelineFailureNextSteps = [
  {
    id: 'upload-clearer',
    label: 'Tải lên bản vẽ rõ hơn',
    warningSentence: null,
    isPrimary: true,
    onSelect: NO_OP,
  },
  {
    id: 'retry-lower-threshold',
    label: 'Thử lại với ngưỡng thấp hơn',
    warningSentence: 'Ngưỡng thấp hơn có thể nhận nhầm nét trang trí thành tường.',
    isPrimary: false,
    onSelect: NO_OP,
  },
];

const RETRY_ACTION: PipelineFailureRetryAction = {
  label: 'Thử lại bước này',
  stepId: FAILED_STEP_ID,
  stepName: 'nhận diện lớp tường',
  isRunning: false,
  onRetry: NO_OP,
};

/* -------------------------------------------------------------------------- */
/* Bốn tầng — dải LUÔN đủ bốn, kể cả khi chỉ một tầng hỏng.                     */
/* -------------------------------------------------------------------------- */

const FLOOR_STATUS_LABELS: Readonly<Record<PipelineFailureFloorStatus, string>> = {
  queued: 'đang chờ',
  running: 'đang chạy',
  done: 'đã xong',
  failed: 'hỏng',
};

function floorsWith(
  statuses: readonly PipelineFailureFloorStatus[],
): readonly PipelineFailureFloorViewModel[] {
  return statuses.map((status, index) => ({
    id: `floor-0${index + 1}`,
    label: `Tầng 0${index + 1}`,
    status,
    statusLabel: FLOOR_STATUS_LABELS[status],
    isFailedFloor: status === 'failed',
  }));
}

/** Ca chính: tầng 1, 2 và 4 vẫn ổn — đó là điều dải tầng tồn tại để nói. */
const PARTIAL_FLOORS = floorsWith(['done', 'done', 'failed', 'running']);
const ALL_FAILED_FLOORS = floorsWith(['failed', 'failed', 'failed', 'failed']);
const RESOLVED_FLOORS = floorsWith(['done', 'done', 'done', 'done']);
const RETRYING_FLOORS = floorsWith(['done', 'done', 'running', 'running']);

/* -------------------------------------------------------------------------- */
/* Kết quả đã có — đầu ra AI chưa ai duyệt, nên chấm trung tính (A5).           */
/* -------------------------------------------------------------------------- */

const KEPT_WORK_LIST: PipelineFailureKeptWork = {
  kind: 'list',
  items: [
    { id: 'preprocess', label: 'Tiền xử lý ảnh — xong' },
    { id: 'detection', label: 'Nhận diện cửa và nội thất — 21 đối tượng' },
    { id: 'dimensions', label: 'Đọc kích thước — 34 chuỗi' },
  ],
  captionSentence: 'Những kết quả này đã được giữ lại. Chạy lại sẽ không xoá chúng.',
};

/** Cả bốn tầng hỏng: khối kết quả co lại còn một dòng, vẫn nói rõ cái gì được giữ. */
const KEPT_WORK_LINE: PipelineFailureKeptWork = {
  kind: 'line',
  line: 'Bản vẽ gốc và các thiết lập của bạn vẫn được giữ.',
};

/* -------------------------------------------------------------------------- */
/* Nhật ký kỹ thuật — đóng mặc định, mở là một lượt chuyển chiều cao.           */
/* -------------------------------------------------------------------------- */

function technicalDetails(isOpen: boolean): PipelineFailureTechnicalDetails {
  return {
    toggleLabel: 'Chi tiết kỹ thuật',
    isOpen,
    onToggle: NO_OP,
    logLines: [
      { id: 'log-1', timeLabel: '14:32:05', text: 'segmentation.start floor=03 model=wall-v7' },
      { id: 'log-2', timeLabel: '14:32:06', text: 'segmentation.contour_ratio=0.12 threshold=0.35' },
      { id: 'log-3', timeLabel: '14:32:07', text: 'segmentation.fail code=SEG-2041 request=8f2a-41' },
    ],
    copyLog: copyAction('Sao chép chi tiết kỹ thuật'),
  };
}

/* -------------------------------------------------------------------------- */
/* Bốn band.                                                                   */
/* -------------------------------------------------------------------------- */

const IDLE_BAND: PipelineFailureBand = {
  kind: 'idle',
  messageSentence: 'Chưa có bước nào hỏng ở lượt xử lý này.',
};

const RETRYING_BAND: PipelineFailureBand = {
  kind: 'retrying',
  steps: [
    { id: 'preprocess', name: 'Tiền xử lý ảnh', status: 'done', progress: 100 },
    { id: FAILED_STEP_ID, name: 'Nhận diện lớp tường', status: 'running', progress: 42 },
    { id: 'dimensionReading', name: 'Đọc kích thước', status: 'queued', progress: 0 },
  ],
  stepperAriaLabel: 'Tiến độ lượt thử lại',
  liveMessage: 'Đang chạy lại bước nhận diện lớp tường ở Tầng 03.',
};

const RESOLVED_BAND: PipelineFailureBand = {
  kind: 'resolved',
  toastMessage: 'Đã nhận diện xong lớp tường ở Tầng 03.',
  continueLabel: 'Xem kết quả',
  onContinue: NO_OP,
};

interface AlertBandOptions {
  readonly reason: PipelineFailureReasonViewModel;
  readonly nextSteps: PipelineFailureNextSteps | null;
  readonly isSupportMode: boolean;
}

function alertBand(options: AlertBandOptions): PipelineFailureBand {
  return {
    kind: 'alert',
    reason: options.reason,
    retryAction: RETRY_ACTION,
    nextSteps: options.nextSteps,
    retryNotice: options.isSupportMode
      ? {
          kind: 'support',
          attemptLabel: 'Lần thử 3',
          suggestionSentence:
            'Đã thử ba lần chưa thành công. Hãy tải lại bản vẽ để chạy lượt mới.',
          copyAllLogs: copyAction('Sao chép toàn bộ nhật ký'),
          uploadLink: {
            label: 'Tải lại bản vẽ',
            onOpen: NO_OP,
          },
        }
      : { kind: 'attempt', attemptLabel: 'Lần thử 2' },
  };
}

/* -------------------------------------------------------------------------- */
/* Bảy kịch bản.                                                               */
/* -------------------------------------------------------------------------- */

/** Phần chung của mọi kịch bản: 260ms lấy từ token, không phải con số. */
const BASE: Pick<
  PipelineFailureProps,
  'motionDurationName' | 'onToggleCollapse' | 'prefersReducedMotion'
> = {
  motionDurationName: 'standard',
  prefersReducedMotion: false,
  onToggleCollapse: NO_OP,
};

const COLLAPSED_SUMMARY = 'Tầng 03 hỏng ở bước nhận diện lớp tường · SEG-2041';

/** Một kịch bản đầy đủ cho mỗi trạng thái. Test dùng lại chính hàm này (R-70). */
export function scenarioFor(state: SevenState): PipelineFailureProps {
  const shared = {
    ...BASE,
    state,
    collapsedSummaryLine: COLLAPSED_SUMMARY,
    collapseToggleLabel: state === 'collapsed' ? 'Mở lại' : 'Thu gọn',
  };

  switch (state) {
    case 'empty':
      return {
        ...shared,
        band: IDLE_BAND,
        floors: RESOLVED_FLOORS,
        keptWork: KEPT_WORK_LIST,
        technicalDetails: technicalDetails(false),
      };

    case 'loading':
      return {
        ...shared,
        band: RETRYING_BAND,
        floors: RETRYING_FLOORS,
        keptWork: KEPT_WORK_LIST,
        technicalDetails: technicalDetails(false),
      };

    case 'partial':
      return {
        ...shared,
        band: alertBand({ reason: REASON_FLOOR_03, nextSteps: NEXT_STEPS, isSupportMode: false }),
        floors: PARTIAL_FLOORS,
        keptWork: KEPT_WORK_LIST,
        technicalDetails: technicalDetails(true),
      };

    case 'error':
      return {
        ...shared,
        band: alertBand({
          reason: REASON_ALL_FLOORS,
          nextSteps: ERROR_NEXT_STEPS,
          isSupportMode: true,
        }),
        floors: ALL_FAILED_FLOORS,
        keptWork: KEPT_WORK_LINE,
        technicalDetails: technicalDetails(true),
      };

    case 'success':
      return {
        ...shared,
        band: RESOLVED_BAND,
        floors: RESOLVED_FLOORS,
        keptWork: KEPT_WORK_LIST,
        technicalDetails: technicalDetails(false),
      };

    case 'forbidden':
      return {
        ...shared,
        band: alertBand({ reason: REASON_FLOOR_03, nextSteps: null, isSupportMode: false }),
        floors: PARTIAL_FLOORS,
        keptWork: KEPT_WORK_LIST,
        technicalDetails: null,
      };

    case 'collapsed':
      return {
        ...shared,
        band: alertBand({ reason: REASON_FLOOR_03, nextSteps: NEXT_STEPS, isSupportMode: false }),
        floors: PARTIAL_FLOORS,
        keptWork: KEPT_WORK_LIST,
        technicalDetails: technicalDetails(false),
      };

    default: {
      const exhaustive: never = state;
      throw new Error(`Trạng thái ngoài bảy trạng thái của A11: ${String(exhaustive)}`);
    }
  }
}

/** Bảy kịch bản dựng sẵn, cùng thứ tự `SEVEN_STATES` — test dùng lại (R-70). */
export const SEVEN_SCENARIOS: readonly PipelineFailureProps[] = SEVEN_STATES.map(scenarioFor);

/* -------------------------------------------------------------------------- */
/* Bảy story.                                                                  */
/* -------------------------------------------------------------------------- */

const meta = {
  title: 'Screens/Pipeline/PipelineFailure',
  component: PipelineFailure,
  parameters: { layout: 'fullscreen' },
  tags: ['autodocs'],
  excludeStories: ['SEVEN_SCENARIOS', 'scenarioFor'],
} satisfies Meta<typeof PipelineFailure>;

export default meta;
type Story = StoryObj<typeof meta>;

/** Rỗng — chưa bước nào hỏng; màn nói ra điều đó thay vì vẽ một cảnh báo bịa. */
export const Rong: Story = { args: scenarioFor('empty') };
/** Đang tải — thử lại NGAY TẠI CHỖ: stepper chiếm chỗ dải cảnh báo, không đổi trang. */
export const DangTai: Story = { args: scenarioFor('loading') };
/** Một phần — ca chính: Tầng 03 hỏng, ba tầng kia vẫn ổn, ba hướng đi tiếp. */
export const MotPhan: Story = { args: scenarioFor('partial') };
/** Lỗi — cả bốn tầng hỏng: kết quả còn một dòng, hướng chính đổi sang tải lại ảnh. */
export const Loi: Story = { args: scenarioFor('error') };
/** Thành công — dải hoà tan thành toast đã duyệt rồi màn cha chuyển tiếp. */
export const ThanhCong: Story = { args: scenarioFor('success') };
/** Không có quyền — ba nút hành động và cả khối nhật ký biến mất, không khoá mờ. */
export const KhongCoQuyen: Story = { args: scenarioFor('forbidden') };
/** Thu gọn — còn đúng câu tóm tắt và nút mở lại. */
export const ThuGon: Story = { args: scenarioFor('collapsed') };

/**
 * Lượt hỏng mang mã máy chủ (`Progress.error`) mà chưa có chi tiết bước: câu theo
 * bảng mã pipeline, mã thật để sao chép; `contactAdmin` và mã lạ không có bước chính.
 */
function withServerCode(code: string): PipelineFailureProps {
  const props = scenarioFor('partial');
  const { action, sentence } = describePipelineError(code);

  if (props.band.kind !== 'alert' || props.band.nextSteps === null) {
    return props;
  }

  const mark = (step: PipelineFailureNextStep): PipelineFailureNextStep => ({
    ...step,
    isPrimary: step.id === 'upload-clearer' && (action === 'reupload' || action === 'retry'),
  });
  const [first, second, ...rest] = props.band.nextSteps;

  return {
    ...props,
    band: {
      ...props.band,
      reason: { ...props.band.reason, causeSentence: sentence, codeLabel: code },
      nextSteps: [mark(first), mark(second), ...rest.map(mark)],
    },
  };
}

/** Mã từ máy chủ — `FILE_CORRUPT`: tải lên là bước chính. */
export const MaTuMayChu: Story = { args: withServerCode('FILE_CORRUPT') };
/** Mã lạ — câu dự phòng, mã giữ nguyên, không bước chính. */
export const MaLa: Story = { args: withServerCode('OCR_FAILED') };
