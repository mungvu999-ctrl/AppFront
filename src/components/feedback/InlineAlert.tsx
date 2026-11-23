import React from 'react';
import { cn } from '../../lib/utils';
import type { ButtonProps } from '../ui/Button';
import { Button } from '../ui/Button';
import { CheckCircle2, AlertTriangle, AlertCircle, X } from 'lucide-react';

export type InlineAlertLevel = 'verified' | 'attention' | 'violation';

export interface InlineAlertProps extends React.HTMLAttributes<HTMLDivElement> {
  level: InlineAlertLevel;
  title?: string;
  /** Phần tử của tiêu đề; mặc định `p` để không nhảy cấp heading dưới h1. */
  titleAs?: 'p' | 'h2' | 'h3' | 'h4';
  message: string;
  action?: {
    label: string;
    onClick: () => void;
    variant?: ButtonProps['variant'];
    /** Nút bận (đang gọi máy chủ): không bấm lần hai. */
    loading?: boolean;
  };
  /** Có thì hiện nút "Ẩn thông báo" (biểu tượng X) ở cuối dải. */
  onDismiss?: () => void;
}

export function InlineAlert({
  level,
  title,
  titleAs: TitleTag = 'p',
  message,
  action,
  onDismiss,
  className,
  ...props
}: InlineAlertProps) {
  const isVerified = level === 'verified';
  const isAttention = level === 'attention';
  const isViolation = level === 'violation';

  const bgClass = isVerified ? 'bg-state-verified-tint' : isAttention ? 'bg-state-attention-tint' : 'bg-state-violation-tint';
  const borderClass = isVerified ? 'border-state-verified' : isAttention ? 'border-state-attention' : 'border-state-violation';
  const textClass = isVerified ? 'text-state-verified-text' : isAttention ? 'text-state-attention-text' : 'text-state-violation-text';
  const iconColorClass = isVerified ? 'text-state-verified' : isAttention ? 'text-state-attention' : 'text-state-violation';

  const Icon = isVerified ? CheckCircle2 : isAttention ? AlertTriangle : AlertCircle;

  return (
    // Hàng ngoài được xuống dòng: khi khung hẹp hơn chỗ chữ tối thiểu (`basis-60`, 240 px) cộng nút,
    // nút rơi xuống hàng dưới (sát phải) thay vì ép chữ thành cột ~100–160 px (như BUG-003).
    // Icon và chữ nằm chung một khối không xuống dòng nên không bao giờ tách nhau.
    <div
      role="alert"
      className={cn(
        'flex flex-wrap items-start gap-x-5 gap-y-2 p-3 rounded-lg border',
        bgClass,
        borderClass,
        className
      )}
      {...props}
    >
      <div className="flex flex-1 basis-60 items-start gap-3 min-w-0">
        <Icon className={cn('shrink-0 mt-0.5', iconColorClass)} size={18} strokeWidth={2} aria-hidden="true" />

        <div className="flex-1 flex flex-col gap-1 min-w-0">
          {title && (
            <TitleTag className={cn('text-[14px] font-semibold leading-tight', textClass)}>
              {title}
            </TitleTag>
          )}
          {/* `text-pretty`: không để một từ ("nhập.") đứng riêng ở dòng cuối khi khung hẹp (BUG-087). Chỉ đổi chỗ ngắt dòng. */}
          <p className={cn('text-pretty text-[14px] leading-relaxed', textClass, !title && 'mt-px')}>
            {message}
          </p>
        </div>
      </div>

      {action && (
        <div className="shrink-0 ml-auto">
          {/* `type="button"`: dải hay nằm trong `<form>`, nút mặc định ở đó là nút gửi (NO-373). */}
          <Button
            type="button"
            size="sm"
            variant={action.variant || 'secondary'}
            onClick={action.onClick}
            loading={action.loading === true}
            className={cn(
              'text-[13px]',
              isVerified && 'border-state-verified text-state-verified-text hover:bg-state-verified-10',
              isAttention && 'border-state-attention text-state-attention-text hover:bg-state-attention-10',
              isViolation && 'border-state-violation text-state-violation-text hover:bg-state-violation-10'
            )}
          >
            {action.label}
          </Button>
        </div>
      )}

      {onDismiss && (
        <button
          type="button"
          aria-label="Ẩn thông báo"
          title="Ẩn thông báo"
          onClick={onDismiss}
          className={cn('shrink-0 rounded-sm p-1 hover:bg-bg-sunken focus-visible:outline-solid focus-visible:outline-2', iconColorClass, !action && 'ml-auto')}
        >
          <X size={16} strokeWidth={2} aria-hidden="true" />
        </button>
      )}
    </div>
  );
}
