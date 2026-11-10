/**
 * Hợp đồng của S-33 — lịch sử phiên bản (`/projects/:id/versions`).
 *
 * Đặc tả gọi route này là `/du-an/:projectId/phien-ban`. Đường dẫn thật đi theo quy ước
 * đang chạy của repo — `PROJECTS_ROOT = '/projects'` và lỗ `:id` (`routes/paths.ts:30`) —
 * vì chính `paths.ts` ghi rõ `account: '/tai-khoan'` là ngoại lệ tiếng Việt DUY NHẤT.
 * Luật thắng prompt, và chỗ lệch được ghi lại thay vì im lặng chọn bên.
 *
 * Điều phối viên sở hữu file này. **Không worker nào được sửa nó.** Hook, hai nửa view và bộ
 * test đều tiêu thụ file này và không tiêu thụ mã của nhau; đó là lý do bốn worker chạy song
 * song được thay vì nối tiếp.
 *
 * ── Đặc tả đòi gì mà tầng logic không có, và đã xử lý ra sao ──────────────────────────────
 *
 *  1. **"Hai mô hình chồng lên nhau, đối tượng đã đổi có viền" — KHÔNG DỰNG ĐƯỢC.**
 *     `VersionSnapshot` (`versioning/diff.ts:11`) là `Record<EntityKind, Record<string,
 *     EntityRecord>>` với `EntityRecord = {[field: string]: unknown}`, và **không nơi nào
 *     trong repo tiêu thụ nó** ngoài `diffVersions` và `restoreVersion`. Đường ra hình học là
 *     `toBuildFloorInput(spatial: NormalizedSpatial, levelId)`
 *     (`domain/spatial/toBuildFloorInput.ts:244`) — nó đòi `NormalizedSpatial`, **không phải**
 *     snapshot, và không có bộ đổi giữa hai thứ đó. Viết bộ đổi ấy là thêm logic miền, mà
 *     R-68 cấm chạm `src/domain` và R-69 cấm tự chế. Thêm nữa, **không có đường nào dựng hai
 *     mô hình 3D chồng nhau**: `OverlayComparison` chồng ẢNH/lớp 2D, không chồng hai `Scene`.
 *     → **Quyết định đã duyệt:** tab "Trực quan" dựng mô hình **HIỆN TẠI** qua
 *     khung xem Pascal (F-15 W2-E), tô sáng các id đã đổi bằng `externalSelectedIds` của
 *     viewer, và trỏ vào hàng diff thì thêm id ấy vào nhóm tô sáng. Kèm **một câu caption nói thẳng** rằng đang hiện bản hiện
 *     tại chứ không phải bản cũ. Store Pascal là một singleton cho cả gói nhúng nên cũng không dựng được hai cảnh
 *     cạnh nhau.
 *
 *  2. **P-03 "gộp theo ngày và theo người" — NOT FOUND.** Không có `groupBy`/`groupByDay`
 *     trong `src/lib` hay `src/domain`. Gộp theo **ngày** vẫn làm được vì nó chỉ gọi
 *     `isSameCalendarDay` + `formatCalendarDate` có thật (`lib/format/datetime.ts:129,153`).
 *     Gộp theo **người** không có cơ sở nào → `canGroupByAuthor` là `false` và affordance đó
 *     **rời khỏi DOM**, không disable, không TODO (R-69).
 *
 *  3. **409 không mang tên người.** `ConflictResponseBody` không có trường tên; gần nhất là
 *     `RemoteFieldChange.changedBy` (`mergeStrategies.ts:12`, kiểu `string`) — có thể là id.
 *     Màn nêu `changedBy`, tra sang tên hiển thị qua danh sách thành viên khi có, và lùi về
 *     chuỗi thô khi không. Không có nhánh "ghi đè" ở bất kỳ đâu trong hợp đồng này — cố ý.
 *
 *  4. **Không có endpoint LIỆT KÊ phiên bản** (`endpoints.ts` chỉ có bản chi tiết), và không
 *     có mock versioning trong `src/lib/testing`. Vì vậy dữ liệu vào màn đi qua
 *     {@link VersionHistoryGateway} — bơm được, đúng khuôn `shareDialogGateway.ts`.
 *
 * ── Ba cái bẫy đã ĐO ĐƯỢC, worker phải né ────────────────────────────────────────────────
 *
 *  - **`bg-state-verified/8` KHÔNG SINH RA GÌ CẢ.** Đã biên dịch Tailwind 3.4.6 trên chính
 *    `tailwind.config.ts` của repo: mọi màu là `var(--x)` trần không có `<alpha-value>`, nên
 *    lớp có hậu tố alpha bị bỏ IM LẶNG — không lỗi, không cảnh báo, chỉ là class chết.
 *    (lớp bg-opacity 10 cũng chết: nó chỉ đặt `--tw-bg-opacity` mà `.bg-state-verified` không
 *    hề tiêu thụ.) Nền 8% **bắt buộc** đi qua {@link DIFF_TINT_OPACITY} +
 *    {@link DIFF_TONE_TOKENS} trên một lớp `aria-hidden` riêng — xem khuôn ở
 *    `ThicknessHistogram.tsx:294-303`. Đo lại được bằng `getComputedStyle(el).opacity`.
 *    *(Phát hiện phụ, KHÔNG sửa vì R-68: `InlineAlert.tsx:71-73` đang dùng ba class chết đó.)*
 *  - **`Tabs.Panel` UNMOUNT nội dung tab ẩn** (`Tabs.tsx:174-204`, `AnimatePresence` +
 *    `activeId === id &&`), nên vị trí cuộn MẤT — trái đúng thứ đặc tả đòi giữ. `Tabs` nằm
 *    trong `src/components` nên R-68 cấm sửa. → Màn dùng `Tabs.Root`/`Tabs.Tab` cho **dải
 *    tab**, còn **ba panel do màn tự dựng**, cả ba nằm trong DOM cùng lúc, panel không hoạt
 *    động đặt thuộc tính `hidden`. Mỗi panel tự giữ `scrollTop` của nó.
 *  - **`Select` bắt buộc truyền `label`** (trigger tự đặt `role="combobox"` nên mất tên đọc
 *    được). Hai `Select` phiên bản ở đầu vùng so sánh đều phải có.
 */

import type { ApiClient, SpatialLayer } from '@/api/client';
import type { FloorVersionSummary } from '@/api/schemas/versions';
import type { BreadcrumbItem } from '@/components/shell/Breadcrumb';
import type { Dimension, Level } from '@/domain/spatial/types';
import type { PascalScene } from '@/lib/pascal/types';
import type { VersionSnapshotSource } from './versionSnapshotAdapter';
import type { UndoTicket } from '@/lib/mutations/undoTicket';
import type { SevenState } from '@/lib/testing/sevenStateScenarios';
import type { EntityKind, VersionDiff, VersionSnapshot } from '@/lib/versioning/diff';
import type { VersionEntry, VersionHistoryEntry, VersionMetadata } from '@/lib/versioning/restore';

/* ── Từ vựng dùng chung ──────────────────────────────────────────────────────────────────── */

/** Ba loại thay đổi. Đúng ba, không có loại thứ tư — cùng lý do A4 chỉ cho ba màu trạng thái. */
export type DiffTone = 'added' | 'removed' | 'changed';

/** Ba tab của vùng so sánh. "Thay đổi" đứng trước "JSON" vì tiếng thường đi trước JSON thô. */
export type CompareTabId = 'changes' | 'json' | 'visual';

export interface VersionHistoryOption {
  readonly id: string;
  /** Nhãn tiếng Việt, viết thường kiểu câu (A6) — trừ mã phiên bản "v12". */
  readonly label: string;
}

/* ── Nền diff: một cơ chế duy nhất, dùng chung cho cả hai nửa view ───────────────────────── */

/**
 * Độ mờ của MỌI nền diff. Luôn 8%, không bao giờ đặc — cấm tuyệt đối của đặc tả.
 *
 * Hằng bố cục, không phải hằng nghiệp vụ, nên nó ở đây chứ không ở `src/lib` — đúng tiền lệ
 * `BAND_OPACITY` (`ThicknessHistogram.tsx:58`). Đã đọc `eslint-rules/no-raw-number.js` toàn
 * văn: luật chỉ bắt `toFixed`/`toLocaleString` và phép chia đơn vị, không bắt khai báo hằng.
 *
 * Nó nằm trong hợp đồng thay vì trong file view vì HAI worker cần nó, và một con số 8% chép
 * làm hai bản là một bản sẽ lệch.
 */
export const DIFF_TINT_OPACITY = 0.08;

/**
 * Màu của ba loại thay đổi, dưới dạng tham chiếu token đi thẳng vào `style.backgroundColor`.
 *
 * Đúng khuôn `wallStrokeToken` (`components/canvas/materialMap.ts:21`) trả `var(--wall-N)`:
 * một tham chiếu `var(--x)` hợp lệ đi qua `style` không phải mã màu thô, nên không vi phạm
 * A1 / `local/no-raw-color`.
 *
 * `added` dùng màu nhấn `--accent`, không dùng xanh "đã xác minh": phần thêm trong một bản do
 * máy ghi không phải việc người đã duyệt, và A5 dành xanh cho đúng việc đó (aesthetic 2.6, "+0").
 */
export const DIFF_TONE_TOKENS: Readonly<Record<DiffTone, string>> = {
  added: 'var(--accent)',
  removed: 'var(--state-violation)',
  changed: 'var(--state-attention)',
};

/* ── Ba số đếm ───────────────────────────────────────────────────────────────────────────── */

export interface DiffCountsModel {
  readonly added: number;
  readonly removed: number;
  readonly changed: number;
  /** "+14" · "−3" · "~8" — định dạng đã xảy ra ở viewmodel, không ở view (A15). */
  readonly addedLabel: string;
  readonly removedLabel: string;
  readonly changedLabel: string;
  /** Một câu cho trình đọc màn hình, vì ba chấm màu không đọc được thành lời. */
  readonly ariaLabel: string;
}

/* ── Cột trái: danh sách phiên bản ───────────────────────────────────────────────────────── */

export interface VersionRowModel {
  readonly id: string;
  /** "v12" — chữ đều. Do hook sinh từ `sequence`, view không tự ghép. */
  readonly label: string;
  readonly description: string;
  readonly authorName: string;
  readonly authorInitials: string;
  readonly avatarUrl: string | null;
  /** Thời gian tương đối (P-02). */
  readonly relativeTimeLabel: string;
  /** Mốc đầy đủ, cho `title`/`aria` — tương đối một mình thì không tra lại được. */
  readonly absoluteTimeLabel: string;
  readonly counts: DiffCountsModel;
  /** Ảnh chụp chưa nạp nên chưa biết số thay đổi: view hiện khung xương thay cho "+0 −0 ~0". */
  readonly isCountsLoading?: boolean;
  /** Ảnh chụp không được nạp (ngoài tầm nạp trước, hoặc bản trước hết nội dung): "Chưa so được". */
  readonly countsUnavailableLabel?: string;
  readonly isCurrent: boolean;
  /** Nhãn người dùng gắn, ví dụ "Duyệt với chủ đầu tư". */
  readonly tagLabel: string | null;
  /**
   * Phiên bản đã bị dọn theo chính sách lưu giữ: còn siêu dữ liệu, mất ảnh chụp.
   * Nguồn: `VersionHistoryEntry` kind `metadataOnly` (`restore.ts`). Trạng thái 3.
   */
  readonly isMetadataOnly: boolean;
  /** Nêu rõ thời hạn lưu. `null` khi phiên bản còn đủ nội dung. */
  readonly retentionNotice: string | null;
  /** N18 hỏng tạm thời (không phải "hết nội dung"): câu lỗi, kèm nút thử lại. Vắng khi không lỗi. */
  readonly snapshotError?: string;
  readonly isSelectedForCompare: boolean;
  /** Ô tích tắt khi đã chọn đủ hai bản, hoặc khi bản này không so được. */
  readonly isPickable: boolean;
}

/** Gộp theo ngày (P-03). Đầu nhóm là ngày; trong nhóm vẫn mới nhất trên cùng. */
export interface VersionGroupModel {
  readonly id: string;
  /** "Hôm nay" · "8 tháng 9, 2026" — do `formatCalendarDate` sinh. */
  readonly heading: string;
  readonly rows: readonly VersionRowModel[];
}

/* ── Cột phải: vùng so sánh ──────────────────────────────────────────────────────────────── */

export interface DiffRowModel {
  readonly id: string;
  readonly entityId: string;
  readonly entityType: EntityKind;
  readonly tone: DiffTone;
  /**
   * Câu tiếng thường: "Tường #W-014: độ dày 110 mm → 220 mm".
   * Do `formatChange` (`@/lib/format/semantic`) sinh — màn KHÔNG BAO GIỜ tự ghép câu này,
   * và không tự quy đổi đơn vị (R-61, local/no-raw-number).
   */
  readonly sentence: string;
}

export interface DiffGroupModel {
  readonly entityType: EntityKind;
  /** "tường" · "cửa" · "phòng" · "trục" — viết thường kiểu câu (A6). */
  readonly heading: string;
  readonly count: number;
  readonly countLabel: string;
  readonly rows: readonly DiffRowModel[];
}

export interface JsonDiffLineModel {
  readonly id: string;
  readonly text: string;
  /** `null` là dòng ngữ cảnh: không tô nền. */
  readonly tone: DiffTone | null;
}

export interface VisualDiffModel {
  /** false ⇒ tab nói rõ vì sao trống; không dựng canvas gọi vào chỗ trống (R-69). */
  readonly isAvailable: boolean;
  readonly unavailableReason: string | null;
  /** Trạng thái 3: đang dựng cảnh. */
  readonly isBuilding: boolean;
  /** Câu báo khi cảnh dựng bằng mẫu dự phòng vì đọc thư viện máy chủ hỏng; `null`/thiếu = không báo. */
  readonly libraryNotice?: string | null;
  /**
   * Câu nói thẳng rằng đây là mô hình HIỆN TẠI, không phải bản cũ, và bao nhiêu đối tượng
   * đang được đánh dấu. Bắt buộc hiện — người đọc không được phép tưởng đây là bản cũ.
   */
  readonly caption: string;
  /**
   * Cảnh Pascal để dựng, do hook nấu sẵn.
   *
   * View thuần **không được** tự nấu: `toPascalScene` sống ở `@/lib/pascal` còn đồ thị ở
   * `@/domain`, mà `local/no-data-layer-in-view` chặn import chạy trong `.tsx`. `null` ⇒ chưa
   * có gì để dựng; view hiện `caption`/`unavailableReason` thay vì canvas.
   */
  readonly scene: PascalScene | null;
  /** Mã đối tượng AppFront đã đổi — view đổi thành mã node Pascal rồi tô sáng. */
  readonly changedEntityIds: readonly string[];
  /** Hàng diff đang được trỏ; tô sáng cùng nhóm với `changedEntityIds`. */
  readonly hoveredEntityId: string | null;
}

/* ── Mặt bằng 2D chồng hai bản (G5-21, N3-04) ────────────────────────────────────────────── */

/** Tone của một hình trên mặt bằng: ba loại thay đổi, hoặc `same` (vẽ `--wall-idle`). */
export type PlanTone = DiffTone | 'same';

export interface PlanDiffShape {
  readonly id: string;
  readonly tone: PlanTone;
  readonly label: string;
  /** Đang trỏ hoặc đang ghim — viền `--accent`, phần còn lại mờ. */
  readonly focused: boolean;
}

/** Do `buildPlanDiffModel` (`versionHistoryPlan.ts`) sinh; xoá lấy hình bản trái, thêm/sửa lấy bản phải. */
export interface PlanDiffModel {
  /** "x y w h" theo mm. */
  readonly viewBox: string;
  readonly floorLabel: string;
  readonly walls: readonly (PlanDiffShape & {
    readonly x1: number;
    readonly y1: number;
    readonly x2: number;
    readonly y2: number;
    /** Tường cong: chuỗi `points` của `<polyline>` theo cung (`x1..y2` vẫn là hai đầu); vắng = thẳng. */
    readonly points?: string;
    readonly thickness: number;
  })[];
  readonly rooms: readonly (PlanDiffShape & { readonly points: string })[];
  readonly openings: readonly (PlanDiffShape & {
    readonly x1: number;
    readonly y1: number;
    readonly x2: number;
    readonly y2: number;
    /** Ô mở trên tường cong: các đỉnh trên cung; vắng = đoạn thẳng `x1..y2`. */
    readonly points?: string;
  })[];
  readonly furniture: readonly (PlanDiffShape & { readonly x: number; readonly y: number })[];
  /** Số đếm là số HÌNH theo tone (một tường sửa hai trường vẫn là một). */
  readonly legend: readonly { readonly tone: DiffTone; readonly label: string; readonly count: number }[];
}

export interface CompareModel {
  readonly leftOptions: readonly VersionHistoryOption[];
  readonly rightOptions: readonly VersionHistoryOption[];
  readonly leftVersionId: string | null;
  readonly rightVersionId: string | null;
  readonly activeTab: CompareTabId;
  readonly tabs: readonly VersionHistoryOption[];
  readonly totals: DiffCountsModel;
  /** Số đối tượng (không phải mục diff) thêm/xoá/sửa — cho câu "So với hiện tại" của hộp phục hồi. */
  readonly entityTotals: Readonly<Record<DiffTone, number>>;
  readonly groups: readonly DiffGroupModel[];
  readonly jsonLines: readonly JsonDiffLineModel[];
  readonly visual: VisualDiffModel;
  /** Mặt bằng 2D chồng hai bản; `null` khi một trong hai bản chưa có ảnh chụp N18. */
  readonly plan: PlanDiffModel | null;
  /** Hàng diff đang ghim (bấm/Enter); bấm lại hoặc Esc thì `null`. */
  readonly pinnedEntityId: string | null;
  /** Đang tính lại cặp mới — view hoà tan 180 ms và chạy số. */
  readonly isRecomputing: boolean;
  /** Trạng thái 1: chỉ có một phiên bản. Một câu dạy việc, không phải lỗi. */
  readonly teachingSentence: string | null;
}

/* ── Chân màn: phục hồi ──────────────────────────────────────────────────────────────────── */

export interface RestoreConfirmModel {
  readonly isOpen: boolean;
  readonly title: string;
  /**
   * Câu bắt buộc trước khi bấm: nói rõ trạng thái hiện tại ĐƯỢC GIỮ LẠI thành một phiên bản
   * riêng, và phục hồi không xoá phiên bản nào. A9 + cấm tuyệt đối của đặc tả.
   */
  readonly reassurance: string;
  readonly confirmLabel: string;
  readonly cancelLabel: string;
  readonly targetVersionLabel: string | null;
}

/**
 * 409 (D-09). Màn GIẢI THÍCH AI ĐÃ SỬA và không ghi đè — không có nhánh "cứ ghi đè" ở đây,
 * và đó là chủ ý: kiểu này không có trường nào cho phép nó.
 */
export interface ConflictNoticeModel {
  readonly actorName: string;
  /** Một câu nêu tên người đã sửa. */
  readonly message: string;
  readonly detail: string | null;
  readonly dismissLabel: string;
}

/* ── Toàn màn ────────────────────────────────────────────────────────────────────────────── */

export interface VersionHistoryModel {
  readonly state: SevenState;
  readonly groups: readonly VersionGroupModel[];
  /** Phẳng, theo thứ tự hiện: dùng cho đếm và cho `Select` khi hẹp. */
  readonly rows: readonly VersionRowModel[];
  readonly versionCount: number;
  /** Trạng thái 7 (thu gọn) — dưới 1024: danh sách thành `Select`, so sánh xếp dọc. */
  readonly isNarrow: boolean;
  readonly compare: CompareModel;
  /** Trạng thái 6: so sánh được, ẩn nút phục hồi. */
  readonly canRestore: boolean;
  readonly restoreHiddenReason: string | null;
  /**
   * Gắn nhãn cho một phiên bản có làm được không.
   *
   * `false` ⇒ affordance gắn nhãn **rời khỏi DOM**, không disable (R-69). Bản này là
   * `false`: không có endpoint gắn nhãn ở `src/api/endpoints.ts`.
   *
   * Trường này ở trên model chứ không chỉ trên gateway vì view không nhìn thấy gateway —
   * thiếu nó thì view vẽ một nút gọi vào chỗ trống, đúng thứ R-69 sinh ra để chặn.
   */
  readonly canTagVersion: boolean;
  /**
   * Xuất phiên bản cũ (dẫn sang S-34) có làm được không.
   *
   * Đây là **điều hướng**, không phải thao tác dữ liệu: màn không tự xuất gì, nó gọi
   * `onExportVersion` do nơi gọi cấp xuống (R-73). Nên khả năng này đúng bằng "nơi gọi có
   * cấp callback đó không", chứ không đợi một endpoint xuất-theo-phiên-bản nào cả.
   */
  readonly canExportVersion: boolean;
  /** Câu giải thích phục hồi là không phá huỷ — luôn hiện cạnh nút, trước khi bấm. */
  readonly restoreCaption: string;
  readonly restoreConfirm: RestoreConfirmModel;
  readonly conflict: ConflictNoticeModel | null;
  readonly errorMessage: string | null;
  /** "Đã lưu lúc 14:32" (A7: không có nút lưu). */
  readonly savedAtLabel: string | null;
  /** N17 còn trang sau — nút "Xem thêm phiên bản". */
  readonly canLoadMoreVersions: boolean;
  /** Tầng đã sửa sau bản mới nhất (`unsavedEditsNotice`); vắng khi có bản "Hiện tại". */
  readonly unsavedNotice?: string;
  /** Ô "Tầng" ở đầu màn; `null` khi nơi gọi không cấp danh sách tầng. */
  readonly floorSelect: FloorSelectModel | null;
  /** Trạng thái `empty`: "Tầng {tên} chưa có phiên bản nào". */
  readonly emptyTitle: string;
}

/** Ô chọn tầng: lịch sử phiên bản đi theo từng tầng. */
export interface FloorSelectModel {
  readonly label: string;
  readonly options: readonly VersionHistoryOption[];
  readonly selectedId: string;
}

export interface VersionHistoryActions {
  readonly selectLeftVersion: (versionId: string) => void;
  readonly selectRightVersion: (versionId: string) => void;
  readonly toggleCompareSelection: (versionId: string) => void;
  readonly setTab: (tab: CompareTabId) => void;
  readonly hoverDiffRow: (entityId: string | null) => void;
  /** Ghim một hàng diff lên mặt bằng; cùng mã đang ghim hoặc `null` thì bỏ ghim. */
  readonly pinDiffRow: (entityId: string | null) => void;
  readonly requestRestore: (versionId: string) => void;
  readonly confirmRestore: () => void;
  readonly cancelRestore: () => void;
  readonly exportVersion: (versionId: string) => void;
  readonly tagVersion: (versionId: string, label: string) => void;
  readonly dismissConflict: () => void;
  readonly loadMoreVersions: () => void;
  readonly selectFloor: (floorId: string) => void;
  /** Nạp lại N18 của một bản vừa hỏng tạm thời (NO-368). */
  readonly retrySnapshot?: (versionId: string) => void;
  /** Nạp lại N17 sau khi danh sách phiên bản hỏng (BUG-468). Vắng thì cảnh báo lỗi không có nút. */
  readonly retryVersions?: () => void;
}

/** View thuần: test được CHỈ từ props, không chạm store, không chạm mạng (mục D, R-60). */
export interface VersionHistoryProps {
  readonly model: VersionHistoryModel;
  readonly actions: VersionHistoryActions;
  /** "Dự án › <tên dự án> › Lịch sử phiên bản", như Cài đặt dự án (K5). Vắng thì không vẽ. */
  readonly breadcrumb?: readonly BreadcrumbItem[];
}

/** Hoàn tác đi qua đây (A8, D-05). Cửa sổ là `UNDO_WINDOW_MS` = 8000 ms, không viết lại số. */
export interface VersionHistoryToast {
  readonly message: string;
  readonly onUndo?: () => void;
  /** Lỗi mang `violation` (chấm đỏ); vắng là thông báo thường, chấm trung tính (BUG-207). */
  readonly state?: 'attention' | 'violation';
}

/* ── Cổng dữ liệu ────────────────────────────────────────────────────────────────────────── */

/**
 * Khả năng CÓ THẬT ở tầng logic. Trường nào `false` thì affordance tương ứng RỜI KHỎI DOM —
 * không disable, không TODO, không nút gọi vào chỗ trống (R-69).
 */
export interface VersionHistoryCapabilities {
  /**
   * Dựng được cảnh 3D của mô hình HIỆN TẠI (qua khung xem Pascal). Tên trường nói đúng
   * thứ làm được: **không** có khả năng dựng lại một phiên bản CŨ — xem mục 1 đầu file.
   */
  readonly canShowCurrentModel3d: boolean;
  /** `externalSelectedIds` của viewer Pascal có thật ⇒ tô sáng được. */
  readonly canHighlightEntity: boolean;
  readonly canTagVersion: boolean;
  /** NOT FOUND ở tầng logic ⇒ luôn `false` trong bản này; affordance rời khỏi DOM. */
  readonly canGroupByAuthor: boolean;
  readonly canExportVersion: boolean;
}

export interface RestoreOutcome {
  readonly kind: 'restored' | 'conflict';
  readonly restoredVersion?: VersionEntry;
  readonly history?: readonly VersionHistoryEntry[];
  readonly undoTicket?: UndoTicket;
  readonly conflict?: ConflictNoticeModel;
  /** `revision` của tầng sau N19. */
  readonly floorRevision?: number;
  /** Id bản "sau" mà N19 trả về. */
  readonly restoredVersionId?: string;
  /** N19 trả `floorRevision` bằng `baseVersion` đã gửi: phiên bản trùng hiện trạng, không gì đổi. */
  readonly unchanged?: boolean;
}

/** Một trang N17. */
export interface VersionPage {
  readonly items: readonly FloorVersionSummary[];
  readonly nextCursor?: string;
}

/** N18: nội dung, hoặc "không còn nội dung" (`VERSION_SNAPSHOT_PURGED`/`VERSION_FLOOR_MISMATCH`). */
export type VersionSnapshotRead =
  | {
      readonly kind: 'snapshot';
      readonly snapshot: VersionSnapshot;
      /** Lớp + kích thước thô của bản ấy — tab "Trực quan" dựng cảnh bản CŨ từ đây. */
      readonly source?: VersionSnapshotSource;
    }
  | { readonly kind: 'purged' };

/** N16 rút gọn: lớp, kích thước và `revision` đi cùng nhau. */
export interface FloorLayerRead {
  readonly layer: SpatialLayer;
  /** Kích thước của tầng — nằm ngoài `layer` trên dây, nên phải mang theo riêng (NO-369). */
  readonly dimensions: readonly Dimension[];
  /** `Level` của tầng (tỉ lệ đi cùng lớp đã quy đổi) và cờ tỉ lệ tạm — như `reloadFloor` của autosave. */
  readonly level: Level;
  readonly scaleStatus?: 'unresolved';
  /** Chỉ đi cùng `scaleStatus`: `project_default` = máy không đo được tỷ lệ (UX-R1 K12). */
  readonly scaleSource?: 'pipeline' | 'project_default';
  readonly revision: number;
}

export interface VersionHistoryGateway {
  readonly capabilities: VersionHistoryCapabilities;
  readonly restore: (versionId: string, baseVersion: number) => Promise<RestoreOutcome>;
  readonly tagVersion?: (versionId: string, label: string) => Promise<VersionMetadata>;
  /** N17 một trang (`limit` = `VERSION_PAGE_LIMIT`). */
  readonly listVersionPage: (options: { readonly cursor?: string }) => Promise<VersionPage>;
  /** N18 một bản. */
  readonly readSnapshot: (versionId: string, signal?: AbortSignal) => Promise<VersionSnapshotRead>;
  /** N16 của tầng của cổng. */
  readonly readFloorLayer: () => Promise<FloorLayerRead>;
  /** Hoàn tác một lượt phục hồi bằng N19 ngược; kết quả như `restore` (không phiếu mới). */
  readonly revertRestore: (ticket: UndoTicket) => Promise<RestoreOutcome>;
}

export interface UseVersionHistoryOptions {
  readonly gateway: VersionHistoryGateway;
  readonly projectId: string;
  readonly floorId: string;
  readonly canRestore?: boolean;
  readonly isNarrow?: boolean;
  readonly now?: () => Date;
  readonly onToast?: (toast: VersionHistoryToast) => void;
  readonly onExportVersion?: (versionId: string) => void;
  /** Tầng chọn được ở ô "Tầng"; nhãn là tên tầng. */
  readonly floorOptions?: readonly VersionHistoryOption[];
  readonly onSelectFloor?: (floorId: string) => void;
  /** Client cho bộ tự lưu lớp tầng (F-04x-1); vắng thì bộ lưu tự dựng. */
  readonly apiClient?: Pick<ApiClient, 'spatial'>;
}

export type VersionHistoryResult = readonly [VersionHistoryModel, VersionHistoryActions];

/** R-73: container nhận đủ props để màn khác mở được, kể cả khi chưa có nơi gọi thật. */
export interface VersionHistoryContainerProps {
  readonly projectId: string;
  readonly floorId: string;
  /** Bơm vào để test và story không chạm mạng; mặc định là gateway thật. */
  readonly gateway?: VersionHistoryGateway;
  readonly onToast?: (toast: VersionHistoryToast) => void;
  readonly onExportVersion?: (versionId: string) => void;
  readonly floorOptions?: readonly VersionHistoryOption[];
  readonly onSelectFloor?: (floorId: string) => void;
  readonly breadcrumb?: readonly BreadcrumbItem[];
  /** Thay `createAppApiClient()` — cho cổng và bộ tự lưu. */
  readonly apiClient?: Pick<ApiClient, 'spatial' | 'versions'>;
}

export type { EntityKind, SevenState, UndoTicket, VersionDiff, VersionEntry, VersionHistoryEntry };
