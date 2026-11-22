/**
 * Hợp đồng của S-ShareDialog — hộp thoại chia sẻ.
 *
 * Điều phối viên sở hữu file này. **Không worker nào được sửa nó.** Hook, view và bộ test
 * đều tiêu thụ file này và không tiêu thụ mã của nhau; đó là lý do ba worker chạy song song
 * được thay vì nối tiếp.
 *
 * ── Đặc tả đòi gì mà repo không có, và đã xử lý ra sao ────────────────────────────────────
 *
 * Bốn khoản dưới đây bị GỠ khỏi màn, không phải vì quên mà vì tầng logic không có chỗ nối.
 * R-69 cấm tự chế / stub / TODO; R-68 cấm thêm vào `src/lib`. Tiền lệ đang chạy trong repo
 * là `ProjectSettings/MembersTab.tsx:1-10` — nó gặp đúng ranh giới này và tự ghi lại thay vì
 * dựng một nút gọi vào chỗ trống ("dựng một nút 'mời' gọi vào chỗ trống là hứa suông").
 *
 *  1. **Mời người + trạng thái "đang chờ chấp nhận".** Không có endpoint mời ở
 *     `src/api/endpoints.ts` (nhóm `projects` chỉ đọc/ghi chính dự án). Mã prompt dữ liệu
 *     còn thiếu: **T-01**.
 *     ĐỌC thì có: `ProjectSchema.members` là `z.array(UserSchema)`
 *     (`src/api/schemas/index.ts:220`) cho đủ id · name · email · role · avatarUrl?. Nên mục 1
 *     tồn tại dưới dạng **danh sách thành viên chỉ để xem** — không Combobox mời, không
 *     Select vai, không nút gỡ.
 *  2. **Phạm vi liên kết** (Chỉ người được mời · Bất kỳ ai có liên kết · Công khai).
 *     `shareLink.ts` chỉ biết `SharePermission` là `'view' | 'comment'`; không có trường
 *     scope/visibility/audience ở bất kỳ đâu. Bộ chọn ba mức và câu cảnh báo hậu quả đi theo nó.
 *  3. **Toggle "cho xem 3D · cho đo · cho tải .glb"** — `ShareLinkCreateBody.embed` chỉ có
 *     `level`/`color`/`toolbar`; `EmbedParams` bốn trường, không trường quyền năng nào.
 *  4. **Toggle "danh sách tầng · bảng thuộc tính"** — `EMBED_PARAM_KEYS` có đúng bốn khoá:
 *     `level` · `color` · `toolbar` · `v`. Chỉ *thanh công cụ* là có thật.
 *
 * Telemetry chia sẻ (O-01) cũng NOT FOUND: `TELEMETRY_EVENT_NAMES` (`events.ts:420-432`) có
 * 11 tên, không tên nào bắt đầu bằng `share.`, và `events.ts` nằm trong `src/lib` nên màn
 * không được thêm. Màn **không ghi telemetry**; mượn `export.file` sẽ là bóp méo dữ liệu.
 *
 * ── Ba con số đặc tả nêu mà repo không cho phép ───────────────────────────────────────────
 *
 *  - Hộp thoại **640**: `ModalRootProps.width` là `480 | 560 | 720` (`Modal.tsx:35`). Dùng **720**.
 *  - Dấu tích sao chép **1,2 giây**: thang chuyển động chỉ có 120/180/260/340/700 (luật B).
 *    Dùng **700 ms**, đúng tiền lệ `COPY_FLASH_MS = 700` (`useShareLinks.ts:251`).
 *  - Khung xem trước cập nhật **240 ms**: không có trong thang. Dùng `standard`, tức **260 ms**.
 *
 * ── Ba cái bẫy đã đo được, worker phải né ─────────────────────────────────────────────────
 *
 *  - `Modal.Root` TỰ bẫy tiêu điểm và TỰ xử Esc (`Modal.tsx:59-72,77-80`). Màn **không được**
 *    gọi `createFocusTrap` lần nữa — sẽ bẫy hai lớp chồng nhau. I-02 coi như đã nối.
 *  - `Modal.Root` tự vẽ lớp phủ bằng class `bg-bg-overlay`; token `--bg-overlay` ở chủ đề sáng
 *    đúng bằng rgba(43,42,40,0.28). Màn **không được** tự viết mã màu đó (A1 / no-raw-color).
 *  - `Select` bắt buộc truyền `label` (trigger tự đặt `role="combobox"` nên mất tên đọc được).
 */

import type {
  ShareLink,
  ShareLinkGateway,
  ShareLinkRequestField,
  SharePermission,
} from '@/lib/export/shareLink';
import type { SevenState } from '@/lib/testing/sevenStateScenarios';
import type { ProjectRole } from '@/types/project';

/* ── Danh mục lựa chọn ───────────────────────────────────────────────────────────────────── */

/**
 * Một lựa chọn của `Select` hoặc `SegmentedControl`, đã sẵn sàng để vẽ.
 *
 * Vì sao danh mục nằm trong model chứ không nằm trong view: nhãn là chuỗi người đọc, mà A15 nói
 * định dạng xảy ra ở viewmodel. Quan trọng hơn, `id` phải khớp giữa view và hook — nếu view tự
 * khai danh mục của nó thì hai bên sẽ lệch id vào lúc không ai để ý, đúng loại lỗi chỉ lộ ra
 * lúc chạy.
 */
export interface ShareDialogOption<TValue extends string> {
  readonly id: TValue;
  /** Nhãn tiếng Việt, viết thường kiểu câu (A6). */
  readonly label: string;
}

/* ── Mục 1: thành viên (CHỈ ĐỌC) ─────────────────────────────────────────────────────────── */

/**
 * Một hàng trong danh sách người có quyền. Mọi trường đã là chuỗi hiển thị được —
 * định dạng xảy ra ở viewmodel, không ở view (A15).
 */
export interface MemberRowModel {
  readonly id: string;
  readonly name: string;
  readonly email: string;
  /** Chữ cái đầu cho `Avatar` khi không có ảnh. Do hook tính, không do view. */
  readonly initials: string;
  readonly avatarUrl: string | null;
  /** Nhãn vai tiếng Việt, viết thường kiểu câu (A6). */
  readonly roleLabel: string;
  /** Hàng chủ sở hữu: không sửa được, và màn phải nói rõ vì sao. */
  readonly isOwner: boolean;
}

/* ── Mục 2: liên kết ─────────────────────────────────────────────────────────────────────── */

export interface ShareLinkRowModel {
  readonly id: string;
  /** Do `shareLinkUrl(link)` sinh. Màn KHÔNG BAO GIỜ tự ghép chuỗi này. */
  readonly url: string;
  readonly permissionLabel: string;
  readonly statusLabel: string;
  /** Đúng ba màu trạng thái (A4). */
  readonly tone: 'verified' | 'attention' | 'neutral';
  /** Do `describeShareLinkExpiry(link, now)` sinh (P-02). */
  readonly expiryText: string;
  readonly canRevoke: boolean;
}

export interface ShareLinkFormModel {
  readonly expiryChoiceId: string;
  /**
   * Danh mục hạn dùng. Nguồn duy nhất là `SHARE_EXPIRY_CHOICES` + `SHARE_EXPIRY_LABELS`
   * (`src/hooks/useShareLinks.ts:79,85`) — hook đọc chúng và chuyển thành danh mục này, để
   * view không phải nhập từ một hook khác và để id không lệch giữa hai bên.
   */
  readonly expiryChoices: readonly ShareDialogOption<string>[];
  /** Do `validateShareLinkRequest` sinh; màn không tự nghĩ ra câu lỗi (L-03). */
  readonly problems: Partial<Record<ShareLinkRequestField, string>>;
  readonly canSubmit: boolean;
}

/* ── Toàn hộp thoại ──────────────────────────────────────────────────────────────────────── */

export interface ShareDialogModel {
  readonly state: SevenState;
  /** "Đã lưu lúc 14:32" — do `formatClockTime` sinh (A7: không có nút lưu). */
  readonly savedAtLabel: string | null;
  /** Kết quả của `can('create', 'share', { roles })`. false dẫn tới trạng thái `forbidden`. */
  readonly canCreateLink: boolean;
  /**
   * `false` khi máy chủ không phục vụ liên kết chia sẻ (v1, `SHARE_LINKS_SUPPORTED`):
   * phần liên kết và mã nhúng rời DOM, chỉ còn "người có quyền". Không phải `forbidden`.
   */
  readonly linksSupported: boolean;
  /** Một câu nói vì sao không đổi được, hiện ngay tại mục bị khoá. */
  readonly noPermissionReason: string | null;
  readonly members: readonly MemberRowModel[];
  /** Một câu nói vì sao danh sách này chỉ để xem trong bản này. */
  readonly membersReadOnlyReason: string;
  readonly form: ShareLinkFormModel;
  readonly rows: readonly ShareLinkRowModel[];
  /** Liên kết vừa được chép — dấu tích giữ 700 ms rồi bỏ. `null` là không có gì đang chép. */
  readonly copiedTargetId: string | null;
  readonly errorMessage: string | null;
  /**
   * Liên kết đang chờ người dùng xác nhận thu hồi; `null` là không hỏi gì. Thu hồi
   * không có đường khôi phục (A8 không hoàn tác được), nên A9 đòi hỏi trước.
   */
  readonly pendingRevokeUrl: string | null;
}

export interface ShareDialogActions {
  readonly setExpiryChoice: (id: string) => void;
  readonly createLink: () => void;
  /** HỎI trước khi thu hồi (A9) — chưa gửi gì. `confirmRevoke` mới gửi. */
  readonly revokeLink: (id: string) => void;
  readonly confirmRevoke: () => void;
  readonly cancelRevoke: () => void;
  readonly copyLink: (id: string) => void;
  readonly dismiss: () => void;
}

/** View thuần: test được CHỈ từ props, không chạm store, không chạm mạng (mục D, R-60). */
export interface ShareDialogProps {
  readonly isOpen: boolean;
  readonly model: ShareDialogModel;
  readonly actions: ShareDialogActions;
  readonly titleId?: string;
  /** U03: khác `null` khi có tầng chưa xác nhận tỷ lệ — diện tích trên trang chia sẻ là số tạm. */
  readonly scaleNotice?: string | null;
}

/** Hoàn tác đi qua đây (A8, D-05). Hành động không hoàn tác được thì phải hỏi trước (A9). */
export interface ShareDialogToast {
  readonly message: string;
  readonly onUndo?: () => void;
}

/**
 * R-73: container luôn tồn tại và nhận đủ props để màn khác mở nó mà không phải viết thêm
 * một dòng logic chia sẻ nào — kể cả khi hiện chưa có nơi gọi thật.
 */
export interface ShareDialogContainerProps {
  readonly isOpen: boolean;
  readonly projectId: string;
  readonly onDismiss: () => void;
  readonly roles?: readonly ProjectRole[];
  /** Bơm vào để test và story không chạm mạng; mặc định là gateway HTTP thật. */
  readonly gateway?: ShareLinkGateway;
  readonly onToast?: (toast: ShareDialogToast) => void;
}

export interface UseShareDialogOptions {
  readonly gateway: ShareLinkGateway;
  readonly projectId: string;
  readonly roles: readonly ProjectRole[];
  readonly members?: readonly MemberRowModel[];
  readonly now?: () => Date;
  readonly copyToClipboard?: (text: string) => Promise<void> | void;
  readonly onToast?: (toast: ShareDialogToast) => void;
  readonly onDismiss?: () => void;
  /**
   * Hộp thoại đang mở hay không — mặc định `true`. Đóng thì lượt đọc danh sách liên
   * kết không chạy, cùng luật lượt đọc thành viên của container (B-V3-09).
   */
  readonly isOpen?: boolean;
}

export type ShareDialogResult = readonly [ShareDialogModel, ShareDialogActions];

export type { ShareLink, SharePermission, SevenState };
