/**
 * Dữ liệu mẫu dùng chung cho `ShareDialog.test.tsx` và `ShareDialog.stories.tsx`.
 *
 * Khuôn theo `exportPanelFixtures.ts`: số liệu KHÔNG viết tay tại chỗ khi repo đã có
 * nguồn (R-70). Cụ thể, mọi chuỗi người đọc dưới đây đi ra từ chính các hàm mà
 * `useShareDialog` (do worker khác viết) sẽ gọi:
 *
 *  - địa chỉ liên kết  ← `shareLinkUrl(link)`                (`lib/export/shareLink.ts:853`)
 *  - câu hạn dùng      ← `describeShareLinkExpiry(link, now)` (`shareLink.ts:798`)
 *  - nhãn quyền/trạng thái ← `SHARE_PERMISSION_LABELS` · `SHARE_LINK_STATUS_LABELS`
 *  - nhãn hạn dùng     ← `SHARE_EXPIRY_LABELS`               (`hooks/useShareLinks.ts:85`)
 *  - "Đã lưu lúc 14:32" ← `formatClockTime(FAKE_CLOCK_START)` (A7, A15)
 *
 * ## Hai chỗ buộc phải viết tay, và vì sao
 *
 *  1. **`ShareLink.url`** — một `ShareLink` là bản ghi CỦA MÁY CHỦ; địa chỉ của nó do
 *     máy chủ cấp và repo không có nguồn nào sinh ra nó (không có mock share-link trong
 *     `src/api/__mocks__/client.ts`). Đây đúng là việc một fixture tồn tại để làm: đóng
 *     vai câu trả lời của máy chủ. Host `example.com` theo đúng lệ sẵn có của mock
 *     client (`client.ts:34,137,386`). Bài kiểm chống-ghép-chuỗi trong
 *     `ShareDialog.test.tsx` vì thế BỎ QUA file này và soát các file CHẠY ĐƯỢC của màn —
 *     nơi lệnh cấm thật sự áp dụng: view và hook không được tự ghép URL hay thẻ `<iframe`.
 *  2. **Tên và địa chỉ thư của thành viên** — `src/api/__mocks__/client.ts:106-112` có ba
 *     thành viên thật nhưng cả tên (`Admin`/`Engineer`/`Viewer`) lẫn địa chỉ thư
 *     (`admin@example.com`…) là chữ tiếng Anh HIỆN TRÊN MÀN, nên `expectVietnamese` đỏ.
 *     Tiền lệ đang chạy trong repo là `ProjectSettings.stories.tsx:26-28` cho tên, và
 *     `AccountSettings` (`an@congty.vn`) cho địa chỉ thư. Nhãn vai thì KHÔNG viết tay
 *     nữa: nó đi ra từ `toMemberRows` của `shareDialogGateway.ts`, đúng hàm mà container
 *     gọi trên câu trả lời của máy chủ.
 *
 */

import type { User } from '@/api/client';
import { SHARE_EXPIRY_CHOICES, SHARE_EXPIRY_LABELS } from '@/hooks/useShareLinks';
import {
  describeShareLinkExpiry,
  SHARE_LINK_STATUS_LABELS,
  SHARE_PERMISSION_LABELS,
  shareLinkUrl,
} from '@/lib/export/shareLink';
import type { ShareLink } from '@/lib/export/shareLink';
import { formatClockTime } from '@/lib/format/datetime';
import { FAKE_CLOCK_START } from '@/lib/testing/fakeClock';
import type { SevenState } from '@/lib/testing/sevenStateScenarios';

import {
  MEMBERS_READ_ONLY_REASON as SHARE_MEMBERS_READ_ONLY_REASON,
  SHARE_FORBIDDEN_REASON,
  toMemberRows,
} from './shareDialogGateway';
import type {
  MemberRowModel,
  ShareDialogActions,
  ShareDialogModel,
  ShareDialogOption,
  ShareDialogProps,
  ShareLinkFormModel,
  ShareLinkRowModel,
} from './types';

/* ==========================================================================
 * 0. Hằng số chung.
 * ========================================================================== */

/** Mã dự án mẫu — cùng một mã cho cả bảy trạng thái, khớp `client.ts:105`. */
export const SAMPLE_PROJECT_ID = 'project-1';

/** `id` của tiêu đề hộp thoại — view gắn `aria-labelledby` vào đây. */
export const SAMPLE_TITLE_ID = 'share-dialog-title';

const HOURS_PER_DAY = 24;
const MINUTES_PER_HOUR = 60;
const SECONDS_PER_MINUTE = 60;
const MS_PER_SECOND = 1000;
const MS_PER_DAY = HOURS_PER_DAY * MINUTES_PER_HOUR * SECONDS_PER_MINUTE * MS_PER_SECOND;

const SEVEN_DAYS = 7;

/** Bảy ngày — đúng một lựa chọn CÓ THẬT của `SHARE_EXPIRY_CHOICES`, không tự nghĩ ra. */
const SEVEN_DAY_CHOICE = SHARE_EXPIRY_CHOICES[1];

const sevenDaysAfterStart = new Date(FAKE_CLOCK_START.getTime() + SEVEN_DAYS * MS_PER_DAY);
const oneDayBeforeStart = new Date(FAKE_CLOCK_START.getTime() - MS_PER_DAY);

/* ==========================================================================
 * 1. Bản ghi máy chủ: ba `ShareLink`.
 * ========================================================================== */

/**
 * Địa chỉ máy chủ cấp cho liên kết mẫu. Xem ghi chú (1) ở đầu file: repo không có
 * nguồn nào sinh ra chuỗi này, và đó chính là chỗ một fixture tồn tại để lấp.
 */
const SAMPLE_SHARE_HREF = 'https://example.com/s/8f2c7a10ab';
const SAMPLE_EXPIRED_HREF = 'https://example.com/s/4d19be0077';

function buildShareLink(overrides: Partial<ShareLink> = {}): ShareLink {
  return {
    id: 'share-1',
    projectId: SAMPLE_PROJECT_ID,
    url: SAMPLE_SHARE_HREF,
    permission: 'view',
    status: 'active',
    createdAt: FAKE_CLOCK_START.toISOString(),
    expiresAt: sevenDaysAfterStart.toISOString(),
    revokedAt: null,
    passwordProtected: false,
    viewpointCode: null,
    label: null,
    ...overrides,
  };
}

/** Liên kết còn dùng được — nền của trạng thái "thành công". */
export const SAMPLE_ACTIVE_LINK: ShareLink = buildShareLink();

/** Liên kết đã hết hạn — nền của trạng thái "một phần". */
export const SAMPLE_EXPIRED_LINK: ShareLink = buildShareLink({
  id: 'share-2',
  url: SAMPLE_EXPIRED_HREF,
  status: 'expired',
  expiresAt: oneDayBeforeStart.toISOString(),
  permission: 'comment',
});

/** Liên kết cũ còn dùng được, mang quyền "góp ý" (không còn tạo mới được). */
export const SAMPLE_COMMENT_LINK: ShareLink = buildShareLink({ id: 'share-3', permission: 'comment' });

/* ==========================================================================
 * 2. Hàng liên kết — mọi chuỗi do `lib/export/shareLink` sinh.
 * ========================================================================== */

/**
 * Đúng ba màu trạng thái (A4). `verified` KHÔNG dùng ở đây: xanh "đã xác minh" chỉ
 * đánh dấu việc người duyệt (A5), còn một liên kết đang sống thì không phải một lượt
 * duyệt. Nên còn hai màu: `attention` cho liên kết hết hiệu lực, `neutral` cho phần
 * còn lại.
 */
function toneOf(link: ShareLink): ShareLinkRowModel['tone'] {
  return link.status === 'active' ? 'neutral' : 'attention';
}

/** Một hàng liên kết, dựng từ bản ghi máy chủ và mốc đồng hồ giả. */
export function buildShareLinkRow(
  link: ShareLink,
  now: Date = FAKE_CLOCK_START,
): ShareLinkRowModel {
  return {
    id: link.id,
    url: shareLinkUrl(link),
    permissionLabel: SHARE_PERMISSION_LABELS[link.permission],
    statusLabel: SHARE_LINK_STATUS_LABELS[link.status],
    tone: toneOf(link),
    expiryText: describeShareLinkExpiry(link, now).text,
    canRevoke: link.status === 'active',
  };
}

/* ==========================================================================
 * 4. Thành viên — CHỈ ĐỌC trong bản này.
 * ========================================================================== */

/**
 * Ba vai của bộ mẫu (`client.ts:106-112`), tên tiếng Việt và nhãn vai đúng ba chữ
 * `ProjectSettings` đang dùng (`useProjectSettings.ts:397-401`). Xem ghi chú (2).
 */
const SAMPLE_MEMBER_USERS: readonly User[] = [
  { id: 'user-1', name: 'Phạm An', email: 'pham.an@duan.com', role: 'admin' },
  { id: 'user-2', name: 'Nguyễn Bình', email: 'nguyen.binh@duan.com', role: 'engineer' },
  { id: 'user-3', name: 'Trần Chi', email: 'tran.chi@duan.com', role: 'viewer' },
];

/**
 * Ba hàng thành viên, dựng qua ĐÚNG phép biến đổi của sản phẩm.
 *
 * `toMemberRows` là hàm mà container gọi trên câu trả lời thật của máy chủ, nên `initials`,
 * `roleLabel` và `isOwner` ở đây không còn là ba giá trị viết tay có thể lệch với sản phẩm —
 * chúng do chính hàm đó sinh. Đây là chỗ lớp gộp nối lại; ở lớp W4 hàm này chưa tồn tại.
 *
 * Địa chỉ thư thì viết tay, và viết bằng âm tiết tiếng Việt: `admin@example.com` của
 * `client.ts:106-112` là chữ tiếng Anh HIỆN TRÊN MÀN, nên `expectVietnamese` bắt đúng —
 * cùng lý do tên ba người này đã là tiếng Việt. Tiền lệ đang chạy: `AccountSettings`
 * (`an@congty.vn`, `thu.ha@congty.vn`).
 */
export const SAMPLE_MEMBERS: readonly MemberRowModel[] = toMemberRows(SAMPLE_MEMBER_USERS);

/**
 * Ba địa chỉ thư ở trên, để bài `expectVietnamese` bỏ qua ĐÚNG chúng.
 *
 * Một địa chỉ thư không mang nổi dấu tiếng Việt, nên KHÔNG chuỗi nào thuộc loại này qua
 * được phép soát: hoặc nó rớt vì một từ tiếng Anh, hoặc — nếu mọi từ đều đúng hình dạng
 * tiếng Việt — nó rớt vì "cả chuỗi là tiếng Việt không dấu". Tiền lệ đang chạy trong repo
 * là `ProfileSection.test.tsx:273` và `AccountSettings.test.tsx:517`: cùng một `ignore`,
 * cùng một lý do. Đọc danh sách từ đây thay vì chép tay để hai nơi không lệch nhau.
 */
export const SAMPLE_MEMBER_EMAILS: readonly string[] = SAMPLE_MEMBER_USERS.map(
  (user) => user.email,
);

/**
 * Một câu nói vì sao danh sách này chỉ để xem.
 *
 * Chuỗi THẬT của sản phẩm (`shareDialogGateway.ts`), không phải một câu tương đương viết
 * lại: story và màn thật phải nói cùng một câu.
 */
export const MEMBERS_READ_ONLY_REASON = SHARE_MEMBERS_READ_ONLY_REASON;

/** Một câu nói vì sao không đổi được, hiện ngay tại mục bị khoá — cũng là chuỗi THẬT. */
export const NO_PERMISSION_REASON = SHARE_FORBIDDEN_REASON;

/* ==========================================================================
 * 5. Biểu mẫu — câu lỗi do `validateShareLinkRequest` sinh (L-03).
 * ========================================================================== */

/** Năm lựa chọn hạn dùng, nhãn từ `SHARE_EXPIRY_LABELS` — không viết tay. */
export const SAMPLE_EXPIRY_CHOICES: readonly ShareDialogOption<string>[] = SHARE_EXPIRY_CHOICES.map(
  (choice) => ({ id: choice, label: SHARE_EXPIRY_LABELS[choice] }),
);

export function buildShareLinkForm(overrides: Partial<ShareLinkFormModel> = {}): ShareLinkFormModel {
  const problems = overrides.problems ?? {};

  return {
    expiryChoiceId: SEVEN_DAY_CHOICE,
    expiryChoices: SAMPLE_EXPIRY_CHOICES,
    canSubmit: Object.keys(problems).length === 0,
    ...overrides,
    problems,
  };
}

/** Nhãn tiếng Việt của lựa chọn hạn dùng đang chọn — dùng cho story và cho khẳng định. */
export const SEVEN_DAY_EXPIRY_LABEL = SHARE_EXPIRY_LABELS[SEVEN_DAY_CHOICE];

/* ==========================================================================
 * 6. Mười một hành động — không làm gì; test tự ghi đè bằng `vi.fn()`.
 * ========================================================================== */

export const NOOP_SHARE_DIALOG_ACTIONS: ShareDialogActions = {
  setExpiryChoice: () => undefined,
  createLink: () => undefined,
  revokeLink: () => undefined,
  confirmRevoke: () => undefined,
  cancelRevoke: () => undefined,
  copyLink: () => undefined,
  dismiss: () => undefined,
};

/* ==========================================================================
 * 7. Bảy trạng thái (A11).
 * ========================================================================== */

/** "Đã lưu lúc 14:32" — mốc tự lưu của sản phẩm, do `formatClockTime` sinh (A7). */
export const SAMPLE_SAVED_AT_LABEL = `Đã lưu lúc ${formatClockTime(FAKE_CLOCK_START)}`;

/** Câu lỗi của trạng thái "lỗi": lượt gọi mạng hỏng, nói ra bằng tiếng Việt. */
export const SAMPLE_ERROR_MESSAGE =
  'Không tạo được liên kết chia sẻ. Kiểm tra kết nối rồi thử lại.';

function modelForState(state: SevenState): ShareDialogModel {
  const base: ShareDialogModel = {
    state,
    savedAtLabel: SAMPLE_SAVED_AT_LABEL,
    canCreateLink: true,
    linksSupported: true,
    noPermissionReason: null,
    members: SAMPLE_MEMBERS,
    membersReadOnlyReason: MEMBERS_READ_ONLY_REASON,
    form: buildShareLinkForm(),
    rows: [],
    copiedTargetId: null,
    errorMessage: null,
    pendingRevokeUrl: null,
  };

  switch (state) {
    case 'empty':
      // Chưa có liên kết nào: biểu mẫu sẵn sàng, danh sách rỗng, chưa từng lưu.
      return { ...base, rows: [], savedAtLabel: null };
    case 'loading':
      // Đang tạo: biểu mẫu khoá lại, chưa có hàng nào để hiện.
      return { ...base, rows: [], form: buildShareLinkForm({ canSubmit: false }) };
    case 'partial':
      // Có liên kết nhưng đã hết hạn — một phần việc đã xong, phần còn lại thì không.
      return { ...base, rows: [buildShareLinkRow(SAMPLE_EXPIRED_LINK)] };
    case 'error':
      // Lời báo hỏng của lượt gọi mạng, biểu mẫu khoá lại.
      return {
        ...base,
        rows: [],
        errorMessage: SAMPLE_ERROR_MESSAGE,
        form: buildShareLinkForm({ canSubmit: false }),
      };
    case 'success':
      // Một liên kết dùng được, cộng một liên kết cũ mang quyền "góp ý" — vẫn phải hiện đúng nhãn.
      return {
        ...base,
        rows: [buildShareLinkRow(SAMPLE_ACTIVE_LINK), buildShareLinkRow(SAMPLE_COMMENT_LINK)],
      };
    case 'forbidden':
      return {
        ...base,
        rows: [],
        canCreateLink: false,
        noPermissionReason: NO_PERMISSION_REASON,
        form: buildShareLinkForm({ canSubmit: false }),
      };
    case 'collapsed':
      // Không còn khung xem trước để ẩn: giống `success` với một liên kết.
      return { ...base, rows: [buildShareLinkRow(SAMPLE_ACTIVE_LINK)] };
    default:
      return base;
  }
}

/**
 * Máy chủ không phục vụ liên kết chia sẻ (v1, BE-BIND #47–#49 là v2): trạng thái
 * `success`, chỉ còn "người có quyền" — phần liên kết rời DOM.
 */
export function buildLinksUnsupportedModel(): ShareDialogModel {
  return {
    ...modelForState('success'),
    linksSupported: false,
    rows: [],
    form: buildShareLinkForm({ canSubmit: false }),
  };
}

/**
 * Một `ShareDialogProps` hợp lệ cho một trong bảy trạng thái.
 *
 * @param state một trong bảy trạng thái của A11.
 * @param overrides vá từng phần vào `model`.
 * @param actionOverrides vá từng phần vào `actions` — nơi `vi.fn()` đi vào.
 */
export function buildShareDialogProps(
  state: SevenState,
  overrides: Partial<ShareDialogModel> = {},
  actionOverrides: Partial<ShareDialogActions> = {},
): ShareDialogProps {
  return {
    isOpen: true,
    titleId: SAMPLE_TITLE_ID,
    model: { ...modelForState(state), ...overrides },
    actions: { ...NOOP_SHARE_DIALOG_ACTIONS, ...actionOverrides },
  };
}
