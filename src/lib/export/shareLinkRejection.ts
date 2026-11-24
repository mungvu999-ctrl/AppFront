/**
 * Câu báo lỗi 422 khi tạo liên kết chia sẻ (L6-N05): nói đúng điều máy chủ từ chối thay vì một câu chung.
 * Tách khỏi `shareLink.ts` để tệp đó không dài thêm.
 */
import { readWireError } from '@/lib/errors/wireError';
import { formatNumber } from '@/lib/format/number';
import type { HttpError } from '@/lib/http';

/** Mã lỗi 422 của BE khi dự án đã đủ liên kết đang dùng (L6-N05). */
export const SHARE_LINK_LIMIT_CODE = 'SHARE_LINK_LIMIT_REACHED';

/** Trần liên kết đang hiệu lực mỗi dự án — chỉ để đặt câu chữ; máy chủ mới là bên chặn (`MAX_ACTIVE_LINKS`). */
export const MAX_ACTIVE_SHARE_LINKS = 50;

const wholeNumber = (value: number): string => formatNumber(value, { fractionDigits: 0 });

export function unprocessableShareMessage(error: HttpError, maxWindowDays: number): string {
  const wire = readWireError(error);
  if (wire?.code === SHARE_LINK_LIMIT_CODE) {
    return `Dự án đã có ${wholeNumber(MAX_ACTIVE_SHARE_LINKS)} liên kết đang dùng; hãy thu hồi bớt một liên kết rồi tạo lại`;
  }
  if (wire?.field === 'expiresAt') {
    return `Hạn dùng phải sau thời điểm hiện tại và không quá ${wholeNumber(maxWindowDays)} ngày`;
  }
  if (wire?.field === 'permission') {
    return 'Liên kết mới chỉ có quyền xem';
  }

  return 'Máy chủ không chấp nhận hạn dùng hoặc mật khẩu này';
}
