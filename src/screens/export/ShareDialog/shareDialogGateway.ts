/**
 * Cổng dữ liệu của hộp thoại chia sẻ: mọi thứ hook cần mà không phải React.
 *
 * Chép khuôn `ExportPanel/exportPanelGateway.ts` — một file thuần, không hook,
 * không JSX — nên nó test được và tính toán được ngoài một cây React. Ba việc:
 *
 *  1. **Dựng `ShareLinkGateway` thật.** `createHttpShareLinkGateway(http)` là
 *     bộ chuyển đổi duy nhất của `src/lib/export/shareLink.ts`; `http` đến từ
 *     `createAppHttpClient` của `src/api/appClient.ts`, thứ đã chốt base URL
 *     **và** phiên đăng nhập cho cả ứng dụng. File này **không** gọi
 *     `fetch` và **không** ghép một đường dẫn nào — `SHARE_LINK_ENDPOINTS` nằm
 *     bên trong bộ chuyển đổi kia, và luật `local/no-fetch-outside-http` canh
 *     phần còn lại.
 *  2. **Đường đọc danh sách thành viên.** `ProjectSchema.members` là
 *     `z.array(UserSchema)`, nên `client.projects.read(projectId)` đã mang đủ
 *     id · name · email · role · avatarUrl?. Không có endpoint mời (mã prompt
 *     dữ liệu còn thiếu: **T-01**), nên danh sách này **chỉ để xem** — xem
 *     {@link MEMBERS_READ_ONLY_REASON}.
 *  3. **Bảng tra và phép chuyển thuần** mà hook nối vào: nhãn vai, chữ cái đầu,
 *     hạn dùng, khoá bộ nhớ đệm.
 *
 * ## Vì sao không dùng `useShareLinkGateway` của `src/hooks`
 *
 * Hook đó dựng cổng trên `AuthHttpClient` và **trả `null`** khi `configureAuth()`
 * chưa chạy. Hợp đồng `UseShareDialogOptions.gateway` là `ShareLinkGateway`
 * không nhận `null`, và một hộp thoại không phải chỗ để quyết định ứng dụng có
 * phiên đăng nhập hay chưa. Ngày vỏ ứng dụng gọi `configureAuth()` ở điểm khởi
 * động, nơi gắn hộp thoại chỉ cần truyền cổng của mình xuống qua
 * `ShareDialogContainerProps.gateway` — đó là lý do prop ấy tồn tại.
 */

import { createAppApiClient, createAppHttpClient } from '@/api/appClient';
import type { ApiClient, User } from '@/api/client';
import { idsOnLevel, type NormalizedSpatial } from '@/domain/spatial/normalize';
import type { Level } from '@/domain/spatial/types';
import {
  SHARE_EXPIRY_CHOICES,
  SHARE_EXPIRY_LABELS,
  type ShareExpiryChoice,
} from '@/hooks/useShareLinks';
import { can } from '@/lib/auth/permissions';
import { createHttpShareLinkGateway, type ShareLinkGateway } from '@/lib/export/shareLink';
import { initialsOf } from '@/lib/format/initials';
import { queryKeys } from '@/lib/query/queryKeys';
import type { ProjectRole } from '@/types/project';

import type { MemberRowModel, ShareDialogOption } from './types';

/* -------------------------------------------------------------------------- */
/* 1 — Cổng mạng                                                              */
/* -------------------------------------------------------------------------- */

/**
 * `ShareLinkGateway` thật, trên `HttpClient` của ứng dụng.
 *
 * Dựng một lần cho mỗi lần gắn hộp thoại (container bọc trong `useMemo`): cổng
 * này không giữ trạng thái, nhưng client bên dưới thì có — hàng đợi
 * single-flight và bộ đếm thử lại của nó chỉ có nghĩa khi cùng một client sống
 * qua nhiều lượt vẽ.
 */
export function createShareDialogGateway(): ShareLinkGateway {
  return createHttpShareLinkGateway(createAppHttpClient());
}

/** `ApiClient` cho lượt đọc thành viên. Cùng một quyết định thật/giả với cả ứng dụng. */
export function createShareDialogApiClient(): ApiClient {
  return createAppApiClient();
}

/* -------------------------------------------------------------------------- */
/* 2 — Khoá bộ nhớ đệm (R-64)                                                 */
/* -------------------------------------------------------------------------- */

/**
 * Khoá của lượt đọc danh sách liên kết.
 *
 * `queryKeys` không có nhánh `shareLinks` và `src/lib/query` nằm ngoài phạm vi
 * sửa của lượt này (R-68), nên khoá nối thêm một nhánh vào khoá chi tiết dự án
 * có sẵn — đúng cách `exportRunQueryKey` (`useExportPanel.ts:119`) đã làm. Nhờ
 * nằm dưới `project.detail(id)`, một lần vô hiệu hoá khoá cha kéo theo cả nó.
 */
export const shareLinksQueryKey = (projectId: string) =>
  [...queryKeys.project.detail(projectId), 'shareLinks'] as const;

/** Khoá của lượt đọc thành viên — nhánh này `queryKeys` đã có sẵn. */
export const shareMembersQueryKey = (projectId: string) => queryKeys.project.members(projectId);

/* -------------------------------------------------------------------------- */
/* 3 — Quyền                                                                  */
/* -------------------------------------------------------------------------- */

/** `can('create', 'share', { roles })` — một khoá gác cả mục liên kết. */
export function readShareLinkPermission(roles: readonly ProjectRole[]): boolean {
  return can('create', 'share', { roles });
}

/**
 * Câu hiện ngay tại mục bị khoá khi {@link readShareLinkPermission} trả `false`.
 *
 * Nói ra ma trận quyền thật (`src/lib/auth/permissions.ts`: `share.create` bật
 * cho `admin` và `engineer`), không nói "bạn không có quyền" rồi để người đọc
 * tự đoán phải hỏi ai.
 */
export const SHARE_FORBIDDEN_REASON =
  'Chỉ quản trị viên và kỹ sư của dự án tạo được liên kết chia sẻ; hãy nhờ một người trong hai vai đó tạo giúp';

/* -------------------------------------------------------------------------- */
/* 4 — Thành viên (CHỈ ĐỌC)                                                   */
/* -------------------------------------------------------------------------- */

/**
 * Vì sao danh sách người có quyền không sửa được ở bản này.
 *
 * Không phải một lời hứa suông: `src/api/endpoints.ts` không có đường mời, gỡ
 * hay đổi vai, nên một nút "mời" ở đây sẽ gọi vào chỗ trống. Tiền lệ là
 * `ProjectSettings/MembersTab.tsx`.
 */
export const MEMBERS_READ_ONLY_REASON =
  'Bản này chỉ hiển thị những người đã có quyền; việc mời thêm và đổi vai làm ở phần cài đặt dự án';

/** Nhãn vai tiếng Việt, viết thường kiểu câu (A6). */
export const SHARE_ROLE_LABELS: Readonly<Record<ProjectRole, string>> = Object.freeze({
  admin: 'Quản trị viên',
  engineer: 'Kỹ sư',
  viewer: 'Người xem',
});

/**
 * `User[]` của máy chủ → `MemberRowModel[]` của màn.
 *
 * `isOwner`: máy chủ gửi `ownerId` (người tạo dự án, UX41 U49) thì so đúng người đó và ghi
 * "Chủ sở hữu"; dữ liệu cũ không có `ownerId` thì vẫn đoán theo vai `admin` như trước.
 */
export function toMemberRows(users: readonly User[], ownerId?: string): readonly MemberRowModel[] {
  return users.map((user) => ({
    id: user.id,
    name: user.name,
    email: user.email,
    initials: initialsOf(user.name, user.email),
    avatarUrl: user.avatarUrl ?? null,
    roleLabel: user.id === ownerId ? 'Chủ sở hữu' : SHARE_ROLE_LABELS[user.role],
    isOwner: ownerId !== undefined ? user.id === ownerId : user.role === 'admin',
  }));
}

/**
 * Danh sách thành viên của một dự án.
 *
 * Trả mảng rỗng khi lượt đọc hỏng thay vì ném: danh sách người có quyền là
 * phần phụ của hộp thoại, và một hồ sơ dự án đọc không được vẫn phải tạo được
 * liên kết. Lỗi của phần liên kết mới là lỗi hộp thoại nói ra.
 */
export async function readProjectMembers(
  client: ApiClient,
  projectId: string,
  signal?: AbortSignal,
): Promise<readonly MemberRowModel[]> {
  const result = await client.projects.read({
    projectId,
    ...(signal !== undefined ? { signal } : {}),
  });

  return result.ok ? toMemberRows(result.data.members, result.data.ownerId) : [];
}

/* -------------------------------------------------------------------------- */
/* 5 — Hạn dùng                                                               */
/* -------------------------------------------------------------------------- */

const MS_PER_SECOND = 1000;
const SECONDS_PER_MINUTE = 60;
const MINUTES_PER_HOUR = 60;
const HOURS_PER_DAY = 24;
const MS_PER_DAY = HOURS_PER_DAY * MINUTES_PER_HOUR * SECONDS_PER_MINUTE * MS_PER_SECOND;

/**
 * Số ngày của từng mức hạn dùng.
 *
 * `SHARE_EXPIRY_CHOICES` và `SHARE_EXPIRY_LABELS` nhập thẳng từ
 * `src/hooks/useShareLinks.ts:79,85` — năm mức và năm nhãn chỉ có một nguồn.
 * Bảng ngày thì phải dựng lại: `EXPIRY_DAYS` và `expiryDateFor` ở đó là hằng
 * riêng của module ấy, không được xuất. `Record<ShareExpiryChoice, …>` bắt
 * trình biên dịch đòi **đủ** khoá, nên một mức thứ sáu thêm vào bộ chọn kia là
 * hỏng biên dịch ở đây chứ không phải một mức im lặng không có hạn.
 *
 * Mốc trần là `MAX_SHARE_WINDOW_DAYS = 90` của `src/lib/export/shareLink.ts`, và
 * `validateShareLinkRequest` mới là thứ nói ra câu lỗi khi một mức vượt trần.
 */
export const SHARE_EXPIRY_DAYS: Readonly<Record<ShareExpiryChoice, number | null>> = Object.freeze({
  '1d': 1,
  '7d': 7,
  '30d': 30,
  '90d': 90,
  never: null,
});

/** Mức mặc định: bảy ngày — đủ cho một lượt góp ý mà không để liên kết sống mãi. */
export const DEFAULT_SHARE_EXPIRY_CHOICE: ShareExpiryChoice = '7d';

/** Danh mục hạn dùng đã sẵn sàng để vẽ. */
export const SHARE_EXPIRY_OPTIONS: readonly ShareDialogOption<string>[] = Object.freeze(
  SHARE_EXPIRY_CHOICES.map((id) => ({ id, label: SHARE_EXPIRY_LABELS[id] })),
);

/** Mức đã chọn thành một thời điểm, hoặc `null` cho "không đặt hạn". */
export function expiryDateFor(choice: ShareExpiryChoice, now: Date): Date | null {
  const days = SHARE_EXPIRY_DAYS[choice];

  return days === null ? null : new Date(now.getTime() + days * MS_PER_DAY);
}

/** Một id bất kỳ từ view về lại một mức hợp lệ — bộ chọn không nhận giá trị lạ. */
export function toExpiryChoice(id: string): ShareExpiryChoice {
  return (SHARE_EXPIRY_CHOICES as readonly string[]).includes(id)
    ? (id as ShareExpiryChoice)
    : DEFAULT_SHARE_EXPIRY_CHOICE;
}

/** U03: câu nhắc khi có tầng có bản vẽ mà chưa xác nhận tỷ lệ — diện tích trên trang chia sẻ chưa đúng. */
export const SHARE_SCALE_NOTICE = 'Chưa đặt tỷ lệ: diện tích trên trang chia sẻ là số tạm.';

/** Có tầng nào có bản vẽ mà tỷ lệ còn là số đoán (N16) hoặc chưa đặt? Cùng luật với màn Xuất (`reviewReasonsOf`). */
export function hasUnconfirmedScale(
  levels: readonly Level[],
  floorMeta: Readonly<Record<string, { readonly scaleStatus?: 'unresolved' }>>,
  spatial: NormalizedSpatial | null,
): boolean {
  return levels.some((level) => {
    const isEmpty = spatial !== null && idsOnLevel(spatial, level.id).length === 0;
    return !isEmpty && (floorMeta[level.id]?.scaleStatus === 'unresolved' || level.scaleMillimetresPerPixel === undefined);
  });
}
