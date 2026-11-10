/**
 * Phân trang phía client cho các bảng admin (A-12): 50 hàng một trang, không đổi bộ lọc của bảng.
 * `Pager` là thanh Trước/Sau, ẩn khi chỉ có một trang.
 */
import { Button } from '@/components/ui/Button';

import { PAGE_SIZE } from './usePaged';

interface PagerProps {
  readonly page: number;
  readonly pageCount: number;
  readonly total: number;
  readonly onPageChange: (page: number) => void;
  readonly pageSize?: number;
}

export function Pager({ onPageChange, page, pageCount, pageSize = PAGE_SIZE, total }: PagerProps) {
  if (pageCount <= 1) return null;
  const from = page * pageSize + 1;
  const to = Math.min(total, (page + 1) * pageSize);
  return (
    <nav aria-label="Phân trang" className="flex items-center justify-between gap-3 px-5 py-3 text-[13px] text-text-secondary">
      <span className="tabular-nums">
        {from}–{to} / {total}
      </span>
      <div className="flex items-center gap-2">
        <Button disabled={page === 0} onClick={() => onPageChange(page - 1)} size="sm" variant="secondary">
          Trang trước
        </Button>
        <Button disabled={page >= pageCount - 1} onClick={() => onPageChange(page + 1)} size="sm" variant="secondary">
          Trang sau
        </Button>
      </div>
    </nav>
  );
}
