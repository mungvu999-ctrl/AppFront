/**
 * Cột trái — bốn thẻ định dạng, xếp dọc.
 *
 * Thẻ trắng có biểu tượng nét 20, không phải ô màu lớn (đặc tả bố cục). Bốn
 * thẻ hoạt động như một `radiogroup`: chỉ một định dạng được chọn tại một thời
 * điểm, và `onSelectFormat` là hành động duy nhất mỗi thẻ phát ra.
 *
 * `FOCUS_RING` và `SkeletonText` xuất từ đây vì đây là file anh em đầu tiên
 * của thư mục — các file khác trong `ExportPanel/` import lại thay vì định
 * nghĩa riêng, giống cách `RuleSettingsRow.tsx` giữ `FOCUS_RING` cho cả thư
 * mục `RuleSettings/`. `FORMAT_ICONS` không export: nó là một object, và
 * `react-refresh/only-export-components` chỉ tha hằng nguyên thuỷ
 * (`allowConstantExport`) cạnh một component — đúng lý do `RuleSettingsRow.tsx`
 * cũng không export `SEVERITY_LABELS`.
 */

import { Box, FileJson, FileText, Image as ImageIcon } from 'lucide-react';
import type { LucideIcon } from 'lucide-react';

import { cn } from '@/lib/utils';

import type { ExportCapabilities, ExportFormatCard, ExportFormatId } from './types';

export const FOCUS_RING =
  'focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:ring-offset-bg-app';

/**
 * Vì sao thẻ PDF chưa tải về được, dù số trang trên nó là số thật.
 *
 * Xuất từ đây (một chuỗi, nên `allowConstantExport` của
 * `react-refresh/only-export-components` tha) để `ExportPanel.tsx` nói cùng một
 * câu ở chân trang mà không ai phải chép lại nó.
 */
export const PDF_BLOCKED_CAPTION =
  'Chưa xuất được PDF ở bản này, mới đếm được số trang. Hãy chọn mô hình 3D hoặc dữ liệu dự án.';

/** Vì sao thẻ ảnh chưa tải về được. */
export const IMAGE_BLOCKED_CAPTION =
  'Chưa xuất được ảnh từ màn này. Mở mô hình 3D để chụp ảnh, hoặc chọn mô hình 3D hoặc dữ liệu dự án.';

/**
 * Câu giải thích của một định dạng chưa sinh được tệp, hoặc `null` khi nó sinh
 * được.
 *
 * `.glb` và Spatial JSON có bộ xuất thật nên không bao giờ mang câu này.
 */
function blockedCaptionOf(id: ExportFormatId, capabilities: ExportCapabilities): string | null {
  if (id === 'pdf' && !capabilities.canRenderPdfBytes) {
    return PDF_BLOCKED_CAPTION;
  }

  if (id === 'image' && !capabilities.canCaptureImage) {
    return IMAGE_BLOCKED_CAPTION;
  }

  return null;
}

const FORMAT_ICONS: Readonly<Record<ExportFormatId, LucideIcon>> = {
  glb: Box,
  pdf: FileText,
  image: ImageIcon,
  'spatial-json': FileJson,
};

/** Chỗ một con số đáng lẽ hiện ra, thay bằng khung xương lúc `status === 'loading'`. */
export function SkeletonText({ className }: { readonly className: string }) {
  return (
    <span
      aria-hidden="true"
      className={cn('inline-block animate-pulse rounded-sm bg-border-default motion-reduce:animate-none', className)}
    />
  );
}

interface FormatCardProps {
  readonly format: ExportFormatCard;
  readonly isLoading: boolean;
  /** Thẻ duy nhất nằm trong thứ tự Tab (roving tabindex). */
  readonly isTabStop: boolean;
  readonly onSelect: (id: ExportFormatId) => void;
}

function FormatCard({ format, isLoading, isTabStop, onSelect }: FormatCardProps) {
  const Icon = FORMAT_ICONS[format.id];

  return (
    <button
      type="button"
      role="radio"
      aria-checked={format.isSelected}
      // Roving tabindex: chỉ thẻ đang chọn nằm trong thứ tự Tab, mũi tên đi giữa các thẻ.
      tabIndex={isTabStop ? 0 : -1}
      onClick={() => {
        onSelect(format.id);
      }}
      className={cn(
        'flex items-start gap-3 rounded-lg border p-4 text-left transition-colors duration-standard',
        FOCUS_RING,
        format.isSelected
          ? 'border-accent bg-bg-selected'
          : 'border-border-default bg-bg-surface hover:bg-bg-hover',
      )}
    >
      {/* Dấu radio rõ: vòng tròn rỗng / chấm đặc, không chỉ dựa vào viền màu. */}
      <span
        aria-hidden="true"
        className={cn(
          'mt-0.5 flex h-4 w-4 shrink-0 items-center justify-center rounded-full border-2',
          format.isSelected ? 'border-accent' : 'border-border-control',
        )}
      >
        {format.isSelected && <span className="h-2 w-2 rounded-full bg-accent" />}
      </span>
      <Icon aria-hidden="true" size={20} strokeWidth={1.75} className="mt-0.5 shrink-0 text-text-secondary" />

      <div className="flex min-w-0 flex-col gap-1">
        <div className="flex flex-wrap items-baseline gap-2">
          <span className="text-sm font-medium text-text-primary">{format.extensionLabel}</span>
          {format.pageCountLabel !== null &&
            (isLoading ? (
              <SkeletonText className="h-3 w-14" />
            ) : (
              <span className="text-xs text-text-secondary">{format.pageCountLabel}</span>
            ))}
        </div>

        <p className="text-sm text-text-secondary">{format.audienceSentence}</p>

        {format.sizeState === 'known' &&
          (isLoading ? (
            <SkeletonText className="h-3 w-16" />
          ) : (
            <p className="font-mono text-xs tabular-nums text-text-secondary">{format.sizeLabel}</p>
          ))}
      </div>
    </button>
  );
}

export interface ExportPanelFormatsProps {
  readonly formats: readonly ExportFormatCard[];
  readonly capabilities: ExportCapabilities;
  readonly isLoading: boolean;
  readonly onSelectFormat: (id: ExportFormatId) => void;
  /** Mở màn Dữ liệu (xem trước nội dung .json). */
  readonly onOpenData?: () => void;
}

/**
 * Thẻ chọn cho định dạng xuất được thật; định dạng chưa có bộ xuất (PDF, ảnh hôm nay) KHÔNG
 * thành thẻ chọn bị khoá — nút giả là ngõ cụt. Chúng hiện ở một dòng chữ bên dưới, kèm số
 * trang thật của PDF, để người dùng biết chúng tồn tại và vì sao chưa dùng được.
 */
export function ExportPanelFormats({
  formats,
  capabilities,
  isLoading,
  onSelectFormat,
  onOpenData,
}: ExportPanelFormatsProps) {
  const offered = formats.filter((format) => blockedCaptionOf(format.id, capabilities) === null);
  // Roving tabindex cần đúng một điểm dừng, kể cả khi định dạng đang chọn không nằm trong danh sách.
  const tabStopId = offered.find((format) => format.isSelected)?.id ?? offered[0]?.id;

  return (
    <div className="flex flex-col gap-4">
      <div
        role="radiogroup"
        aria-label="Định dạng xuất"
        className="flex flex-col gap-3"
        onKeyDown={(event) => {
          const step =
            event.key === 'ArrowDown' || event.key === 'ArrowRight' ? 1 : event.key === 'ArrowUp' || event.key === 'ArrowLeft' ? -1 : 0;

          if (step === 0 || offered.length === 0) {
            return;
          }

          event.preventDefault();
          const radios = event.currentTarget.querySelectorAll<HTMLElement>('[role="radio"]');
          const current = Array.from(radios).findIndex((radio) => radio === document.activeElement);
          const next = (Math.max(current, 0) + step + offered.length) % offered.length;
          const target = offered[next];

          if (target !== undefined) {
            onSelectFormat(target.id);
            radios[next]?.focus();
          }
        }}
      >
        {offered.map((format) => (
          <div key={format.id} className="flex flex-col gap-1">
            <FormatCard
              format={format}
              isLoading={isLoading}
              isTabStop={format.id === tabStopId}
              onSelect={onSelectFormat}
            />
            {format.id === 'spatial-json' && onOpenData !== undefined && (
              <button
                type="button"
                onClick={onOpenData}
                className={cn('self-start rounded-sm px-4 min-h-6 coarse:min-h-11 text-[13px] font-medium text-accent hover:underline', FOCUS_RING)}
              >
                Xem trước nội dung
              </button>
            )}
          </div>
        ))}
      </div>

    </div>
  );
}
