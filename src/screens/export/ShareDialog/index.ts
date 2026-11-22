/**
 * `S-ShareDialog` — hộp thoại chia sẻ. Đường nhập duy nhất của thư mục này.
 *
 * - {@link ShareDialogContainer} là hộp thoại ĐÃ NỐI: một màn khác chỉ cần
 *   `<ShareDialogContainer isOpen onDismiss projectId />` là mở được, không phải
 *   viết thêm một dòng logic chia sẻ nào (R-73).
 * - {@link ShareDialog} là markup thuần, cho story và test (mục D).
 * - {@link useShareDialog} là toàn bộ logic, cho ai muốn dựng một vỏ khác.
 *
 * **Không có route ở đây, và đó là chủ ý.** Đây là một hộp thoại, không phải một
 * màn có địa chỉ — bảng route chuẩn (mục 0.8 của bộ prompt) ghi S-35 là "không
 * route", và `ExportPanel` mở nó bằng `<ShareDialogContainer isOpen … />`.
 *
 * Cho tới 14-09-2026 còn một route `/projects/:projectId/share` trỏ vào
 * `project/ShareScreen` — khuôn hai file cũ, màn duy nhất trong repo không đủ
 * sáu file R-59. Cả route lẫn thư mục ấy đã bị xoá: hai bản chia sẻ trong một
 * repo là một bản quá nhiều, và bản còn lại là bản này.
 *
 * Kiểu công khai có đúng **một** nơi định nghĩa — `./types`, hợp đồng đông cứng của
 * ba worker viết song song — mà container, view và hook cùng nhập; barrel này chỉ
 * tái xuất, không chép lại hình dạng.
 *
 * Chuỗi tiếng Việt viết thẳng vào TS/TSX; `src/i18n/vi.json` là từ điển để
 * `lib/testing/expectVietnamese.ts` soát, không phải bảng dịch lúc chạy.
 */

export { ShareDialog } from './ShareDialog';

export { ShareDialogContainer } from './ShareDialog.container';

export { useShareDialog } from './useShareDialog';

export type {
  MemberRowModel,
  ShareDialogActions,
  ShareDialogContainerProps,
  ShareDialogModel,
  ShareDialogOption,
  ShareDialogProps,
  ShareDialogResult,
  ShareDialogToast,
  ShareLinkFormModel,
  ShareLinkRowModel,
  UseShareDialogOptions,
} from './types';
