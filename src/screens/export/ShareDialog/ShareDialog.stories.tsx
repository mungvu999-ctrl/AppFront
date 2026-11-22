/**
 * Bảy trạng thái của {@link ShareDialog} (A11 / R-63): rỗng, đang tải, một phần, lỗi,
 * thành công, không có quyền, thu gọn.
 *
 * Mọi story dựng view thuần — không hook, không cổng, không mạng — bằng `args` tĩnh, đúng
 * khuôn `ExportPanel.stories.tsx` (tên export ASCII, tiếng Anh — mục B/E.11 của CLAUDE.md;
 * nhãn tiếng Việt của từng trạng thái nằm trong chú thích ngay trên mỗi story).
 *
 * Dữ liệu mẫu đến từ `shareDialogFixtures.ts`:  địa chỉ liên kết do `shareLinkUrl` sinh, câu hạn dùng do `describeShareLinkExpiry` sinh — không viết tay ở đây (R-70). `ShareDialog.test.tsx`
 * dùng đúng bộ dữ liệu này, nên hai file không kể hai câu chuyện khác nhau về cùng một màn.
 *
 * Thêm một story ngoài bảy trạng thái: liên kết chia sẻ tắt (máy chủ v1).
 *
 * **Không export thứ gì khác ngoài `meta` và các story.** Một export không phải story (một
 * hằng số, một hàm phụ) làm Storybook trắng cả file; nếu về sau cần một hằng ở đây thì khai
 * nó qua `meta.excludeStories`.
 */

import type { Meta, StoryObj } from '@storybook/react';

import { ShareDialog } from './ShareDialog';
import { buildLinksUnsupportedModel, buildShareDialogProps } from './shareDialogFixtures';

const meta = {
  title: 'Screens/Export/ShareDialog',
  component: ShareDialog,
  parameters: { layout: 'fullscreen' },
  tags: ['autodocs'],
} satisfies Meta<typeof ShareDialog>;

export default meta;
type Story = StoryObj<typeof meta>;

/* -------------------------------------------------------------------------- */
/* Bảy trạng thái (tên export ASCII — mục B/E.11; nhãn tiếng Việt trong chú     */
/* thích, đúng khuôn ExportPanel.stories.tsx).                                 */
/* -------------------------------------------------------------------------- */

/** 1 · rỗng — chưa có liên kết nào; biểu mẫu sẵn sàng, chưa từng lưu. */
export const Empty: Story = {
  args: buildShareDialogProps('empty'),
};

/** 2 · đang tải — đang tạo liên kết; biểu mẫu khoá lại, chưa có hàng nào. */
export const Loading: Story = {
  args: buildShareDialogProps('loading'),
};

/**
 * 3 · một phần — có liên kết nhưng nó đã hết hạn: câu hạn dùng THẬT từ
 * `describeShareLinkExpiry`, màu `attention`, không còn thu hồi được.
 */
export const Partial: Story = {
  args: buildShareDialogProps('partial'),
};

/** 4 · lỗi — lời báo hỏng của lượt gọi mạng, biểu mẫu khoá lại. */
export const ErrorState: Story = {
  args: buildShareDialogProps('error'),
};

/** 5 · thành công — hai liên kết dùng được, một trong hai là liên kết cũ mang quyền "góp ý". */
export const Success: Story = {
  args: buildShareDialogProps('success'),
};

/** 6 · không có quyền — `canCreateLink: false`, và một câu nói rõ vì sao, ngay tại mục bị khoá. */
export const Forbidden: Story = {
  args: buildShareDialogProps('forbidden'),
};

/** 7 · thu gọn — dưới 1280: không còn gì phải ẩn, giống thành công với một liên kết. */
export const Collapsed: Story = {
  args: buildShareDialogProps('collapsed'),
};

/** Liên kết chia sẻ tắt — máy chủ v1 không phục vụ #47–#49: chỉ còn "người có quyền". */
export const LinksUnsupported: Story = {
  args: buildShareDialogProps('success', buildLinksUnsupportedModel()),
};
