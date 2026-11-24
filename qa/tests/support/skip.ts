import { test } from '@playwright/test';

/**
 * Bỏ qua bài ĐANG CHẠY vô điều kiện, kèm lý do trong báo cáo (K-59).
 *
 * Thay cho `test.skip(true, lý do)`: mẫu đó bị cấm (xem `scripts/__tests__/no-unconditional-skip.test.mjs`)
 * vì ở mức đầu tệp hay trong `describe` nó giết cả nhóm mà không ai để ý. Ở đây chỉ dùng được khi đã ở
 * trong thân một bài và chỉ vì điều kiện dữ liệu/môi trường chỉ biết lúc chạy; lý do đi vào `annotations`.
 */
export function skipWithReason(reason: string): void {
  test.info().annotations.push({ type: 'skip', description: reason });
  test.skip();
}
