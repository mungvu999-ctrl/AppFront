/** Phân trang phía client (A-12): cắt danh sách đã lọc thành trang 50 hàng. */
import { useState } from 'react';

export const PAGE_SIZE = 50;

export function usePaged<T>(rows: readonly T[], pageSize = PAGE_SIZE) {
  const [requested, setPage] = useState(0);
  const pageCount = Math.max(1, Math.ceil(rows.length / pageSize));
  // Lọc làm danh sách ngắn lại thì kẹp về trang cuối, khỏi rơi vào trang trống.
  const page = Math.min(requested, pageCount - 1);
  return {
    page,
    pageCount,
    pageRows: rows.slice(page * pageSize, (page + 1) * pageSize),
    setPage,
    total: rows.length,
  };
}
