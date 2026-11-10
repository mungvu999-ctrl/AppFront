import React from 'react';

import { Check } from 'lucide-react';
import { Link, useParams } from 'react-router-dom';
import { ROUTES } from '../../routes/paths';
import { cn } from '../../lib/utils';
import { useBreadcrumb } from '../../hooks/useBreadcrumb';
import type { BreadcrumbItem, BreadcrumbOption } from '../../hooks/useBreadcrumb';

// Re-export types for consumers
export type { BreadcrumbItem, BreadcrumbOption };


// ─── Props ────────────────────────────────────────────────────────────────────

interface BreadcrumbProps {
  items: readonly BreadcrumbItem[];
  /** Tên của `<nav>`. Vắng thì là tên chung; màn nào đã có tên riêng được neo (Xử lý) thì giữ. */
  ariaLabel?: string;
}

/** Một tên cho mọi breadcrumb, cùng chữ với các màn quản trị. */
const NAV_LABEL = 'Đường dẫn trang';

/** Một kiểu chữ cho mọi cấp bấm được (nút hay link). */
const CRUMB_LINK_CLASS = cn(
  // Dưới 640 px vùng chạm 44×44 px như mọi nút — cả bề ngang: "Dự án" chỉ rộng 39 px
  // (BUG-108, run-20); từ 640 px giữ dòng chữ 24 px.
  'inline-flex min-h-11 min-w-11 items-center fine:min-h-6 fine:min-w-0 text-[13px] font-medium text-text-secondary leading-none',
  'hover:text-text-primary transition-colors duration-120',
  'rounded-sm px-0.5 -mx-0.5',
  'outline-hidden focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2'
);

// ─── Breadcrumb ───────────────────────────────────────────────────────────────

export function Breadcrumb({ ariaLabel = NAV_LABEL, items }: BreadcrumbProps) {
  // Ngoài router (story, test lẻ) `useParams` trả `{}`: tên dự án khi đó là chữ thường.
  const projectId = useParams().projectId;
  const { openDropdownId, openDropdown, closeDropdown, dropdownZIndex } = useBreadcrumb();

  return (
    <nav className="flex items-center" aria-label={ariaLabel}>
      <ol className="flex items-center gap-0">
        {items.map((item, index) => {
          const isLast = index === items.length - 1;
          // Cấp đầu cũng mở được danh sách khi có lựa chọn (breadcrumb tầng của QC bắt đầu bằng "Tầng ▾").
          const hasDropdown = !isLast && Array.isArray(item.options) && item.options.length > 0;
          const isDropdownOpen = openDropdownId === item.id;

          return (
            <li key={item.id} className="flex items-center">
              {/* Separator › */}
              {index > 0 && (
                <span
                  className="mx-1.5 text-[13px] text-text-muted select-none"
                  aria-hidden="true"
                >
                  ›
                </span>
              )}

              {isLast ? (
                /* Phần cuối — chữ primary, không click */
                <span
                  className="text-[13px] font-semibold text-text-primary leading-none"
                  aria-current="page"
                >
                  {item.label}
                </span>
              ) : hasDropdown ? (
                /* Cấp giữa có dropdown */
                <div className="relative">
                  <button
                    type="button"
                    onClick={() => isDropdownOpen ? closeDropdown() : openDropdown(item.id)}
                    className={cn(
                      'inline-flex min-h-11 min-w-11 items-center fine:min-h-6 fine:min-w-0 text-[13px] font-medium text-text-secondary leading-none',
                      'hover:text-text-primary transition-colors duration-120',
                      'rounded-sm px-0.5 -mx-0.5',
                      'outline-hidden focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2',
                      isDropdownOpen && 'text-text-primary'
                    )}
                    aria-haspopup="listbox"
                    aria-expanded={isDropdownOpen}
                    aria-label={`Chọn nhanh — đang ở ${item.label}`}
                  >
                    {item.label}
                  </button>

                  {/* Dropdown */}
                  {isDropdownOpen && (
                    <>
                      {/* Overlay đóng khi click ngoài */}
                      <div
                        className="fixed inset-0"
                        style={{ zIndex: dropdownZIndex - 1 }}
                        onClick={closeDropdown}
                        aria-hidden="true"
                      />
                      <ul
                        role="listbox"
                        aria-label="Chọn tầng"
                        className={cn(
                          'absolute top-full left-0 mt-1.5',
                          'min-w-[180px]',
                          'bg-bg-surface rounded-[10px] shadow-float',
                          'border border-border-default',
                          'py-1 overflow-hidden',
                          'animate-dropdown-open'
                        )}
                        style={{ zIndex: dropdownZIndex }}
                        onKeyDown={(e) => {
                          if (e.key === 'Escape') closeDropdown();
                        }}
                      >
                        {item.options!.map((opt) => (
                          <li key={opt.id} role="option" aria-selected={opt.id === item.id}>
                            <button
                              type="button"
                              onClick={() => { opt.onClick(); closeDropdown(); }}
                              className={cn(
                                'w-full text-left px-3 py-2',
                                'text-[13px] text-text-primary',
                                'hover:bg-bg-hover transition-colors duration-120',
                                'flex items-center justify-between gap-2',
                                'outline-hidden focus-visible:bg-bg-selected'
                              )}
                            >
                              <span>{opt.label}</span>
                              {opt.id === item.id && (
                                <Check className="w-3.5 h-3.5 text-accent shrink-0" aria-hidden="true" />
                              )}
                            </button>
                          </li>
                        ))}
                      </ul>
                    </>
                  )}
                </div>
              ) : item.onClick === undefined && item.id === 'project' && projectId !== undefined ? (
                /* Tên dự án luôn bấm được, về màn tầng của dự án (N5-09). */
                <Link to={ROUTES.project.floors(projectId)} className={cn(CRUMB_LINK_CLASS, 'inline-block max-w-[140px] truncate leading-6 sm:max-w-xs')} title={item.label}>
                  {item.label}
                </Link>
              ) : item.onClick === undefined ? (
                /* Cấp trước không có đích — chữ thường, không giả làm nút (BUG-079) */
                /* Một tên dự án dài cắt "…" (title giữ đủ) để đường dẫn vẫn một dòng ở 375 px (BUG-165);
                   dòng 18 px, không `leading-none`: `truncate` cắt cả dấu chồng của chữ hoa ("Ộ"). */
                <span
                  className="inline-block max-w-[140px] truncate text-[13px] font-medium text-text-secondary leading-[18px] sm:max-w-xs"
                  title={item.label}
                >
                  {item.label}
                </span>
              ) : item.id === 'projects' ? (
                /* Mục "Dự án" là liên kết thật (mở tab mới được, đọc là link), không phải nút.
                   `<a>` + onClick của mục thay vì `<Link>`: thanh này cũng được dựng ngoài Router. */
                <a
                  href={ROUTES.dashboard}
                  onClick={(event) => {
                    if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
                    event.preventDefault();
                    item.onClick?.();
                  }}
                  className={CRUMB_LINK_CLASS}
                >
                  {item.label}
                </a>
              ) : (
                /* Cấp đầu — click được, không có dropdown */
                <button
                  type="button"
                  onClick={item.onClick}
                  className={CRUMB_LINK_CLASS}
                >
                  {item.label}
                </button>
              )}
            </li>
          );
        })}
      </ol>
    </nav>
  );
}
