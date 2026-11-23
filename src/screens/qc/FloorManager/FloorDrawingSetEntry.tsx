/**
 * Lối vào "Tải cả bộ hồ sơ" — VIEW THUẦN, một thanh gọn dưới bảng đề xuất. Container chỉ dựng nó khi
 * công tắc bật và người dùng sửa được; không có biến thể "tắt" (R-69).
 */

import { Button } from '@/components/ui/Button';

const TITLE = 'Tải cả bộ hồ sơ';
const DESCRIPTION =
  'Chọn nhiều tệp hoặc một PDF nhiều trang một lần, không cần tạo tầng trước. Máy chia thành các hình và gợi ý loại; bạn sửa rồi xác nhận thì mới tạo tầng.';

export interface FloorDrawingSetEntryProps {
  readonly onOpen: () => void;
}

export function FloorDrawingSetEntry({ onOpen }: FloorDrawingSetEntryProps) {
  return (
    <section aria-label={TITLE} className="flex flex-wrap items-center gap-x-3 gap-y-2 rounded-lg border border-border-default px-4 py-2">
      <p className="min-w-0 flex-1 basis-72 text-[14px] text-text-secondary">
        <span className="font-semibold text-text-primary">{TITLE}.</span> {DESCRIPTION}
      </p>
      <Button onClick={onOpen} size="sm" variant="secondary">
        {TITLE}
      </Button>
    </section>
  );
}
