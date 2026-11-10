import { ChevronDown, Layers } from 'lucide-react';
import { useEffect, useId, useRef, useState, type KeyboardEvent, type ReactNode } from 'react';

import { Popover } from '@/components/overlay/Popover';
import { Checkbox } from '@/components/ui/Checkbox';
import { cn } from '@/lib/utils';

/**
 * Nút "Hiển thị ▾" ở góc trên phải bản vẽ (bố cục L23, đợt 1): gom mọi công tắc lớp của bước
 * vào MỘT popover, thay cho các ô "Hiện lớp …" rải ở cột trái hay dãy nút đáy bản vẽ.
 * Màn truyền nhóm và công tắc đã có sẵn; popover không tự giữ trạng thái lớp.
 */
export interface QcDisplayToggle {
  readonly key: string;
  readonly label: string;
  readonly checked: boolean;
  readonly onToggle: () => void;
}

export interface QcDisplayGroup {
  readonly title: string;
  readonly items: readonly QcDisplayToggle[];
}

export interface QcDisplayPopoverProps {
  readonly groups: readonly QcDisplayGroup[];
  /** Chữ nút; vắng = "Hiển thị". Cột việc dùng "Lọc" cho bộ lọc danh sách. */
  readonly label?: string | undefined;
  /** Tên hộp thoại; vắng = "Hiển thị trên bản vẽ". */
  readonly popoverLabel?: string | undefined;
  /** Biểu tượng nút; vắng = lớp chồng. */
  readonly icon?: ReactNode;
  /** `float` = nút nổi trên bản vẽ (mặc định); `flat` = nút phẳng trong thanh công cụ của cột. */
  readonly variant?: 'float' | 'flat';
  /** Đếm số công tắc đang bật cạnh chữ nút (bộ lọc đang áp). */
  readonly showActiveCount?: boolean;
}

const BUTTON_LABEL = 'Hiển thị';
const POPOVER_LABEL = 'Hiển thị trên bản vẽ';

export function QcDisplayPopover({ groups, label = BUTTON_LABEL, popoverLabel = POPOVER_LABEL, icon, variant = 'float', showActiveCount = false }: QcDisplayPopoverProps) {
  const [isOpen, setIsOpen] = useState(false);
  const anchorRef = useRef<HTMLButtonElement>(null);
  const bodyId = useId();
  const bodyRef = useRef<HTMLDivElement>(null);
  /* `Popover` không nhận `id`: đặt id lên chính phần tử `role=dialog` của nó để `aria-controls` trỏ đúng vùng có vai trò và nhãn. */
  useEffect(() => {
    const dialog = isOpen ? bodyRef.current?.closest('[role="dialog"]') : null;
    if (dialog == null) return undefined;
    dialog.id = bodyId;
    return () => dialog.removeAttribute('id');
  }, [isOpen, bodyId]);
  /* #11: lớp nằm cuối `body` (portal), nên Tab từ nút phải dẫn thẳng vào trong thay vì đi hết trang. */
  const enterOnTab = (event: KeyboardEvent<HTMLButtonElement>) => {
    if (!isOpen || event.key !== 'Tab' || event.shiftKey) return;
    const first = document.getElementById(bodyId)?.querySelector<HTMLElement>('input:not([disabled]), button:not([disabled])');
    if (first === undefined || first === null) return;
    event.preventDefault();
    first.focus();
  };
  const visible = groups.filter((group) => group.items.length > 0);
  if (visible.length === 0) return null;
  const activeCount = showActiveCount ? visible.reduce((sum, group) => sum + group.items.filter((item) => item.checked).length, 0) : 0;

  return (
    <>
      <button
        ref={anchorRef}
        aria-controls={isOpen ? bodyId : undefined}
        aria-expanded={isOpen}
        aria-haspopup="dialog"
        onKeyDown={enterOnTab}
        className={cn(
          'flex items-center gap-2 rounded-lg text-body-sm font-medium text-text-primary transition-colors duration-120',
          /* Phẳng: đứng cạnh nút chế độ nhìn ở thanh đầu panel 260–320 px — không xuống dòng; dưới 1280 chỉ còn biểu tượng. */
          variant === 'float' ? 'h-9 bg-bg-surface px-3 shadow-float' : 'h-8 shrink-0 gap-1 whitespace-nowrap px-1.5',
          activeCount > 0 && variant === 'flat' && 'bg-accent-wash text-accent',
          'hover:bg-bg-hover focus-visible:outline-solid focus-visible:outline-2 focus-visible:outline-accent',
        )}
        onClick={() => setIsOpen((open) => !open)}
        type="button"
      >
        {icon ?? <Layers aria-hidden="true" className="h-4 w-4" />}
        {variant === 'flat' ? <span className="max-xl:sr-only">{label}</span> : label}
        {activeCount > 0 ? (
          <>
            <span aria-hidden="true" className="rounded-full bg-accent px-1.5 text-caption tabular-nums text-white">{activeCount}</span>
            <span className="sr-only">{`: ${activeCount} đang bật`}</span>
          </>
        ) : null}
        <ChevronDown aria-hidden="true" className="h-3.5 w-3.5 text-text-muted" />
      </button>
      <Popover anchorRef={anchorRef} aria-label={popoverLabel} isOpen={isOpen} onClose={() => setIsOpen(false)} width={280}>
        <div className="flex flex-col gap-3 p-4" ref={bodyRef}>
          {visible.map((group) => (
            <fieldset key={group.title} className="flex flex-col gap-1.5">
              <legend className="mb-1 text-caption font-medium uppercase tracking-[0.06em] text-text-muted">{group.title}</legend>
              {group.items.map((item) => (
                <Checkbox
                  key={item.key}
                  aria-label={item.label}
                  checked={item.checked}
                  label={item.label}
                  onChange={item.onToggle}
                  size="sm"
                />
              ))}
            </fieldset>
          ))}
        </div>
      </Popover>
    </>
  );
}
