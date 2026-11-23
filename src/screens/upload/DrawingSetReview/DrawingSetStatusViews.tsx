/**
 * Các pha không phải chọn tệp hay duyệt của "Tải cả bộ hồ sơ" — VIEW THUẦN, mỗi pha một khối nhỏ.
 *
 * `DrawingSetBlocked` là pha công tắc tắt / không có quyền: chỉ một câu và lối về, KHÔNG nút tải, ô chọn
 * tệp hay lưới nào (affordance rời DOM — R-69).
 */

import { InlineAlert } from '@/components/feedback/InlineAlert';
import { Skeleton } from '@/components/feedback/Skeleton';
import { Button } from '@/components/ui/Button';

const SKELETON_KEYS = ['a', 'b', 'c'] as const;

export function DrawingSetLoading() {
  return (
    <div aria-busy="true" aria-label="Đang đọc bộ hồ sơ" className="flex flex-col gap-2" role="status">
      {SKELETON_KEYS.map((key) => (
        <Skeleton key={key} preset="table-row" />
      ))}
    </div>
  );
}

export interface DrawingSetBlockedProps {
  readonly title: string;
  readonly message: string;
  readonly backLabel: string;
  readonly onBack: () => void;
}

/** Công tắc tắt, hoặc vai không được tải bản vẽ. */
export function DrawingSetBlocked({ backLabel, message, onBack, title }: DrawingSetBlockedProps) {
  return (
    <div className="flex flex-col gap-3">
      <InlineAlert level="attention" message={message} role="status" title={title} />
      <div>
        <Button onClick={onBack} variant="secondary">
          {backLabel}
        </Button>
      </div>
    </div>
  );
}

export interface DrawingSetLoadErrorProps {
  readonly message: string;
  readonly onRetry: () => void;
}

export function DrawingSetLoadError({ message, onRetry }: DrawingSetLoadErrorProps) {
  return <InlineAlert action={{ label: 'Thử lại', onClick: onRetry }} level="violation" message={message} role="alert" title="Chưa mở được bộ hồ sơ" />;
}

export interface DrawingSetProgressProps {
  readonly percent: number;
  readonly onBack: () => void;
}

/** Máy đang đọc bộ (N57 thăm dò 2 giây). */
export function DrawingSetAnalyzing({ onBack, percent }: DrawingSetProgressProps) {
  return (
    <section aria-busy="true" aria-label="Máy đang đọc bộ hồ sơ" className="flex flex-col gap-3">
      <h2 className="text-[16px] font-semibold text-text-primary">Máy đang đọc bộ hồ sơ…</h2>
      <progress aria-label="Tiến độ đọc bộ hồ sơ" className="h-2 w-full" max={100} value={percent} />
      <p aria-live="polite" className="text-[14px] text-text-secondary" role="status">
        {`${String(percent)}%. Bạn có thể rời màn này, bộ hồ sơ vẫn nằm trong danh sách bộ đang dở.`}
      </p>
      <div>
        <Button onClick={onBack} variant="ghost">
          Về danh sách
        </Button>
      </div>
    </section>
  );
}

export interface DrawingSetEndedProps {
  readonly title: string;
  readonly message: string;
  readonly level: 'attention' | 'violation';
  readonly primary: { readonly label: string; readonly onClick: () => void };
  readonly secondary?: { readonly label: string; readonly onClick: () => void };
}

/** Bộ `failed`, bộ còn `receiving` (tải dở). */
export function DrawingSetEnded({ level, message, primary, secondary, title }: DrawingSetEndedProps) {
  return (
    <div className="flex flex-col gap-3">
      <InlineAlert level={level} message={message} role="status" title={title} />
      <div className="flex flex-wrap gap-3">
        <Button onClick={primary.onClick} variant="primary">
          {primary.label}
        </Button>
        {secondary === undefined ? null : (
          <Button onClick={secondary.onClick} variant="secondary">
            {secondary.label}
          </Button>
        )}
      </div>
    </div>
  );
}

export interface DrawingSetConfirmedProps {
  /** Mỗi dòng: tên tầng/dòng và việc đã làm. */
  readonly lines: readonly string[];
  readonly onOpenPipeline: () => void;
  readonly onOpenFloors: () => void;
}

/** Sau N60: các tầng đã tạo; xử lý từng mặt bằng chạy như tải từng tầng. */
export function DrawingSetConfirmed({ lines, onOpenFloors, onOpenPipeline }: DrawingSetConfirmedProps) {
  return (
    <section aria-label="Bộ hồ sơ đã xác nhận" className="flex flex-col gap-3">
      <h2 className="text-[16px] font-semibold text-text-primary">Đã xác nhận bộ hồ sơ</h2>
      <p className="text-[14px] text-text-secondary">Máy đã tạo các tầng bên dưới và bắt đầu xử lý từng mặt bằng. Kết quả vẫn cần bạn duyệt.</p>
      {lines.length === 0 ? null : (
        <ul className="list-disc pl-5 text-[14px] text-text-primary">
          {lines.map((line) => (
            <li key={line}>{line}</li>
          ))}
        </ul>
      )}
      <div className="flex flex-wrap gap-3">
        <Button onClick={onOpenPipeline} variant="primary">
          Xem tiến độ xử lý
        </Button>
        <Button onClick={onOpenFloors} variant="secondary">
          Duyệt tầng
        </Button>
      </div>
    </section>
  );
}
