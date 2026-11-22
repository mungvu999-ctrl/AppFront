/**
 * Dải cảnh báo — nội dung chính của màn S-11, chiếm chỗ phần đầu cột trái của
 * khung S-10.
 *
 * ## Hình dạng, và vì sao nó là hình dạng đó
 *
 * Một `InlineAlert` mức `violation` rộng hết cột (`rounded-xl` = bo 12, `p-5` =
 * đệm 20 — lớp có tên, không phải giá trị tuỳ ý), rồi MỘT hàng `flex` các nút
 * ngay bên dưới nó. Đây đúng khuôn `errorAlert` của `ProcessingScreen.tsx:229-244`,
 * và nó là khuôn bắt buộc chứ không phải sở thích: `InlineAlertProps.action` là
 * một đối tượng, không phải một mảng, nên nó nhận ĐÚNG MỘT nút
 * (`InlineAlert.tsx:13-17`). Ba hướng đi tiếp không nhét vừa vào đó, và "không
 * tạo component mới" nghĩa là chỗ duy nhất còn lại cho hai hướng kia là hàng
 * `flex` bên dưới.
 *
 * Hướng mang `isPrimary` đi vào `action` của dải; hai hướng còn lại là
 * `Button variant="secondary" size="sm"`. Ở trạng thái `error`, hook đổi
 * `isPrimary` sang hướng tải lại ảnh — view không có nhánh riêng cho việc đó, và
 * đó là toàn bộ ý nghĩa của "hành động chính đổi thành tải lại ảnh".
 *
 * ## Không nền đỏ
 *
 * `bg-state-violation-tint` là nền nhạt của token vi phạm, do chính `InlineAlert`
 * đặt. File này không viết một lớp nền nào cho khối cảnh báo, nên không có chỗ
 * cho một nền đỏ lọt vào (A1 và mục [CẤM TUYỆT ĐỐI]).
 *
 * ## `forbidden`
 *
 * `nextSteps` là `null` đúng ở trạng thái đó: cả hàng nút biến mất — kể cả nút
 * "Thử lại bước này" — thay vì hiện ra dưới dạng khoá mờ. Không có quyền thì
 * không thấy cái nút, đúng cách `ProcessingScreenProps.canCancel` xử lý nút huỷ.
 *
 * ## Mã lỗi
 *
 * Chữ đều, nhỏ, căn phải dưới, luôn có mặt, kèm nút sao chép — mục
 * [CẤM TUYỆT ĐỐI] cho phép mã lỗi ở lại với điều kiện nó nhỏ. Vết lỗi kỹ thuật
 * dài KHÔNG ở đây; nó nằm sau khối gấp (`PipelineFailureDetails`).
 */

import { InlineAlert } from '@/components/feedback/InlineAlert';
import { Button } from '@/components/ui/Button';

import { PipelineFailureCopyButton } from './PipelineFailureCopyButton';
import type {
  PipelineFailureAlertBand,
  PipelineFailureNextStep,
  PipelineFailureRetryAction,
  PipelineFailureRetryNotice,
} from './types';

/** Bo 12 · đệm 20 · rộng hết cột — ba con số của đặc tả, viết bằng lớp có tên. */
const ALERT_CLASSES = 'w-full rounded-xl p-5';

const NEXT_STEPS_ARIA_LABEL = 'Hướng đi tiếp';

/** Câu cảnh báo của một hướng, nối vào nút bằng `aria-describedby`. */
function warningId(stepId: PipelineFailureNextStep['id']): string {
  return `pipeline-failure-warning-${stepId}`;
}

/** Hàng nút dưới dải: hai hướng còn lại, rồi nút chạy lại đúng bước đã hỏng. */
function PipelineFailureNextStepRow({
  steps,
  retryAction,
}: {
  readonly steps: readonly PipelineFailureNextStep[];
  readonly retryAction: PipelineFailureRetryAction;
}) {
  return (
    <div aria-label={NEXT_STEPS_ARIA_LABEL} className="flex flex-wrap items-center gap-3" role="group">
      {steps.map((step) => (
        <Button
          aria-describedby={step.warningSentence === null ? undefined : warningId(step.id)}
          key={step.id}
          onClick={step.onSelect}
          size="sm"
          variant="secondary"
        >
          {step.label}
        </Button>
      ))}

      {retryAction.isUnsupported === true ? null : (
        <Button
          aria-label={`${retryAction.label} — ${retryAction.stepName}`}
          disabled={retryAction.isRunning}
          loading={retryAction.isRunning}
          onClick={retryAction.onRetry}
          size="sm"
          variant="ghost"
        >
          {retryAction.label}
        </Button>
      )}
    </div>
  );
}

/** Bộ đếm lần thử. Hook chọn chế độ; view chỉ đọc `kind`, không so số (R-71). */
function PipelineFailureRetryNoticeBlock({ notice }: { readonly notice: PipelineFailureRetryNotice }) {
  if (notice.kind === 'none') {
    return null;
  }

  if (notice.kind === 'attempt') {
    return <p className="text-[13px] text-text-secondary">{notice.attemptLabel}</p>;
  }

  return (
    <div className="flex flex-col gap-2">
      <p className="text-[13px] text-text-secondary">{notice.attemptLabel}</p>
      <p className="text-[13px] text-text-primary">{notice.suggestionSentence}</p>
      <div className="flex flex-wrap items-center gap-3">
        <PipelineFailureCopyButton action={notice.copyAllLogs} />
        <Button onClick={notice.uploadLink.onOpen} size="sm" variant="ghost">
          {notice.uploadLink.label}
        </Button>
      </div>
    </div>
  );
}

export interface PipelineFailureAlertProps {
  readonly band: PipelineFailureAlertBand;
}

export function PipelineFailureAlert({ band }: PipelineFailureAlertProps) {
  const { nextSteps, reason, retryAction, retryNotice } = band;

  const primaryStep = nextSteps === null ? null : (nextSteps.find((step) => step.isPrimary) ?? null);
  const otherSteps = nextSteps === null ? [] : nextSteps.filter((step) => step !== primaryStep);
  const warningSteps = nextSteps === null ? [] : nextSteps.filter((step) => step.warningSentence !== null);

  /* `exactOptionalPropertyTypes` bật: `action={undefined}` không gán được, nên
     ở `forbidden` prop đó phải VẮNG MẶT chứ không phải mang giá trị rỗng. */
  const alertAction =
    primaryStep === null ? {} : { action: { label: primaryStep.label, onClick: primaryStep.onSelect } };

  return (
    <div className="flex flex-col gap-3">
      <InlineAlert
        {...alertAction}
        className={ALERT_CLASSES}
        level="violation"
        message={reason.causeSentence}
        title={reason.summarySentence}
      />

      {nextSteps === null ? null : (
        <PipelineFailureNextStepRow retryAction={retryAction} steps={otherSteps} />
      )}

      {warningSteps.map((step) => (
        <p className="text-[12px] text-text-secondary" id={warningId(step.id)} key={step.id}>
          {step.warningSentence}
        </p>
      ))}

      <PipelineFailureRetryNoticeBlock notice={retryNotice} />

      {/* Lỗi của tệp (U48): mã kỹ thuật không giúp người chọn tệp khác. */}
      {retryNotice.kind === 'none' ? null : (
        <div className="flex flex-wrap items-center justify-end gap-2">
          <span className="font-mono text-[12px] font-medium text-text-muted">{reason.codeLabel}</span>
          <PipelineFailureCopyButton action={reason.copyCode} />
        </div>
      )}
    </div>
  );
}
