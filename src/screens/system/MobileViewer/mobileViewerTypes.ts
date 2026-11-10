/**
 * Hợp đồng kiểu của màn `/m/du-an/:projectId` — xem 3D **chỉ đọc** trên điện thoại.
 *
 * File `.ts` thuần, **không nhập React**, cùng lý do `viewer3dTypes.ts` của màn
 * Viewer3D là `.ts`: module cảnh phải test được không cần dựng cây React, và một
 * kiểu mà cả hai phía đọc thì không được kéo theo tầng nào của phía kia.
 *
 * ## File này là hợp đồng của bốn người viết song song
 *
 * Bốn worker dựng bốn mảnh của màn cùng lúc và **không đọc mã của nhau**:
 *
 * | Mảnh | Chủ | Đọc gì ở đây |
 * |---|---|---|
 * | `mobileViewerPascal.ts` | S15 | mục 4 |
 * | `useMobileViewer.ts` + `mobileViewerGateway.ts`    | T6 | mục 3, 5 |
 * | `MobileViewer.tsx` + thanh dưới + tấm thông tin    | T7 | mục 2, 6 |
 * | test + story + `mobileViewerScenarios.ts`          | T8 | mục 2, 6 |
 *
 * Đổi hình dạng ở đây là bắt ba người kia sửa lại việc đã xong. Cần đổi thì
 * **hỏi điều phối viên**, đừng tự sửa rồi đi tiếp.
 *
 * > **Khi ghi chú khảo sát và file này nói khác nhau, GHI CHÚ KHẢO SÁT THẮNG.**
 * > File này viết trước lúc ghi chú về; nó chốt *ranh giới giữa bốn mảnh*, không
 * > chốt chữ ký của tầng logic. Thấy lệch thì báo, đừng lặng lẽ chiều theo file này.
 *
 * ## Vì sao màn này chỉ đọc
 *
 * Chủ đầu tư và kỹ sư mở nó ở công trường, một tay cầm máy. Không cho sửa dữ
 * liệu là **hạn chế có ý thức**, không phải phần còn thiếu: mọi ô nhập vắng mặt
 * là cố ý, và bài kiểm của T8 khẳng định đúng điều đó.
 */

import type { SpatialGraph } from '@/domain/spatial/types';
import type { SceneConcept } from '@/lib/pascal/sceneConcept';

/* -------------------------------------------------------------------------- */
/* 1. Kích thước bố cục — đặc tả S-45.                                         */
/* -------------------------------------------------------------------------- */

/**
 * Con số bố cục sống ở đây, không rải trong JSX.
 *
 * Cùng khuôn `viewerShellTypes.ts` mục "Kích thước bố cục". R-71 cấm hằng số
 * viết tay trong màn vì repo đã có nguồn cho từng loại (thời lượng, đơn vị,
 * ngưỡng); các số dưới đây **không** có nguồn nào như thế — chúng là kích thước
 * do đặc tả S-45 đặt ra — nên chỗ đúng của chúng là một hằng có tên, đúng một chỗ.
 */

/** Chiều cao thanh trên, px. Tên dự án và nút chia sẻ. */
export const MOBILE_VIEWER_TOP_BAR_PX = 48;

/** Chiều cao thanh dưới, px. */
export const MOBILE_VIEWER_BOTTOM_BAR_PX = 56;

/**
 * Vùng bấm nhỏ nhất, px — sàn tuyệt đối của đặc tả.
 *
 * Không phải gợi ý. Bộ đo nghiệm thu liệt kê từng vùng bấm và một cái dưới số
 * này là hỏng cả lượt.
 *
 * **Cạm bẫy đã đo, đọc trước khi đặt một `IconButton` nào:** kích thước thật của
 * `IconButton` là `sm` 36px · `md` 40px · **`lg` 44px**, và **`md` là mặc định**.
 * Nghĩa là một `<IconButton>` viết không có `size` thì **trượt đặc tả 4px** và
 * không có bài kiểm nào trong `pnpm test` bắt được — `jsdom` trả về 0×0 cho mọi
 * phép đo pixel, nên chỉ bộ đo Playwright của T4 mới thấy. Mọi nút của màn này
 * phải là `size="lg"`, hoặc bọc trong một hộp tối thiểu 44×44 px.
 */
export const MOBILE_VIEWER_MIN_HIT_TARGET_PX = 44;

/** Bề ngang mà dưới nó thanh dưới rút còn ba biểu tượng, px. */
export const MOBILE_VIEWER_COMPACT_WIDTH_PX = 360;

/**
 * Ba nấc của tấm thông tin — CL-07.
 *
 * **Vì sao màn này tự dựng tấm trượt thay vì dùng `components/overlay/Drawer`.**
 * Khảo sát đã đo `Drawer`: ba nấc của nó là 88px / **40%** / **90%**, và
 * `snapLevel` là `useState` *bên trong* `DrawerRoot` — không có prop nào đặt nấc
 * mở đầu, nên mở ra là 90% màn hình. Đặc tả S-45 đòi tấm cao **45%** và mở ra ở
 * đúng nấc đó: che 90% khung nhìn thì người ở công trường không còn thấy mô hình,
 * đúng thứ màn này tồn tại để cho họ xem. Sửa `Drawer` là phạm R-68.
 *
 * Nên tấm này dựng trong thư mục màn (`MobileViewerInfoSheet.tsx`). Đó **không**
 * phải "tạo component mới" theo nghĩa lệnh cấm: lệnh cấm chặn việc thêm vào
 * `src/components/**`, và R-68 vốn đã cấm chạm vào đó. Cùng lối đi mà repo đã
 * dùng khi một component chung không vừa việc.
 *
 * Logic kéo thì CHÉP từ `Drawer.tsx` (ngưỡng 100px hoặc vận tốc 600) — đã chạy
 * thật, đừng nghĩ lại từ đầu.
 */
export const MOBILE_VIEWER_SHEET_PEEK_PX = 88;

/** Nấc giữa — mở ra là ở đây. 45% chiều cao khung nhìn, đúng đặc tả. */
export const MOBILE_VIEWER_SHEET_MID_RATIO = 0.45;

/** Nấc cao nhất. */
export const MOBILE_VIEWER_SHEET_FULL_RATIO = 0.9;

/* -------------------------------------------------------------------------- */
/* 2. Bảy trạng thái, và công cụ ở thanh dưới.                                 */
/* -------------------------------------------------------------------------- */

/**
 * Bảy trạng thái của A11 — cùng bộ chữ `SEVEN_STATES` của
 * `lib/testing/sevenStateScenarios`, khai lại ở đây vì mã sản phẩm không nhập
 * từ thư mục testing. `ViewerScreenState` của vỏ Viewer làm y hệt.
 *
 * Ý nghĩa riêng của màn này, theo đặc tả:
 * - `loading`  — đang tải, **hiện mức gọn trước** rồi mới nâng dần.
 * - `partial`  — mô hình mới có một phần; lý do ở `partialReason`.
 * - `error`    — máy yếu: mời xem bản 2D thay vì cố dựng.
 * - `collapsed`— màn rất nhỏ (320): thanh dưới còn ba biểu tượng.
 */
export type MobileViewerState =
  | 'empty'
  | 'loading'
  | 'partial'
  | 'error'
  | 'success'
  | 'forbidden'
  | 'collapsed';

/**
 * Vì sao `partial` (B-V1-11): một số tầng chưa có phòng nào được dựng từ bản
 * vẽ, hay mạng đang yếu. Hai lý do khác nhau thì hai câu khác nhau.
 */
export type MobilePartialReason = 'missing-rooms' | 'weak-network';

/** Bốn biểu tượng của thanh dưới: tầng · chế độ xem · đo · thông tin. */
export type MobileViewerToolId = 'floors' | 'view' | 'measure' | 'info';

/** Thứ tự ở 390 — đủ bốn. */
export const MOBILE_VIEWER_TOOLS: readonly MobileViewerToolId[] = Object.freeze([
  'floors',
  'view',
  'measure',
  'info',
]);

/**
 * Thứ tự ở 320 — gộp còn ba.
 *
 * `view` là cái bị gộp vào, không phải cái bị bỏ: chế độ xem chuyển thành một
 * hàng bên trong tấm "tầng", nên không mất chức năng nào — chỉ mất một biểu
 * tượng. Đây là quyết định của điều phối viên; đặc tả nói "gộp còn ba" mà không
 * nói gộp cái nào.
 */
export const MOBILE_VIEWER_TOOLS_COMPACT: readonly MobileViewerToolId[] = Object.freeze([
  'floors',
  'measure',
  'info',
]);

/* -------------------------------------------------------------------------- */
/* 3. Dữ liệu đã gọn cho di động — hook cấp, view chỉ đọc.                     */
/* -------------------------------------------------------------------------- */

/**
 * Một tầng, rút về đúng thứ dải tầng vẽ.
 */
export interface MobileViewerFloor {
  readonly id: string;
  /** Nhãn tiếng Việt, viết thường kiểu câu (A6) — ví dụ "tầng 2". */
  readonly label: string;
  /** Tầng đã có ít nhất một phòng chưa. `false` thì hàng mang huy hiệu "chưa có phòng". */
  readonly hasRooms: boolean;
}

/**
 * Một dòng của tấm thông tin. **Chỉ đọc** — không có `onChange`, và đó là điểm chính.
 *
 * `value` đã là chuỗi đã định dạng. View không tính, không làm tròn, không đổi
 * đơn vị (A15 + `local/no-raw-number`).
 */
export interface MobileViewerInfoRow {
  readonly id: string;
  readonly label: string;
  readonly value: string;
}

/** Thứ đang chọn, đã rút về đúng thứ tấm thông tin hiện. */
export interface MobileViewerSelection {
  readonly entityId: string;
  /** Tên tiếng Việt của loại đối tượng — "tường", "phòng", "ô mở". */
  readonly kindLabel: string;
  readonly title: string;
  readonly rows: readonly MobileViewerInfoRow[];
  /**
   * Mục này là thứ chỉ sửa được trên máy tính.
   *
   * `true` thì tấm thông tin hiện một câu giải thích kèm nút gửi liên kết —
   * **không phải một nút xám không giải thích**.
   */
  readonly needsDesktopToEdit: boolean;
}

/** Một phép đo đã xong, đã định dạng để hiện. */
export interface MobileViewerMeasurement {
  readonly id: string;
  readonly kindLabel: string;
  /** Kết quả đã định dạng, ví dụ "3,45 m". */
  readonly valueLabel: string;
}

/* -------------------------------------------------------------------------- */
/* 4. Module cảnh — mount Pascal `view` (F-15 S15).                            */
/* -------------------------------------------------------------------------- */

/**
 * Tuỳ chọn lắp cảnh di động. Cử chỉ camera, chọn và đo đều do Pascal lo
 * (`cameraControls`, `onPick`, `measure`); màn chỉ đưa đồ thị vào và nhận kết quả.
 */
export interface MobileViewerSceneOptions {
  /** Đồ thị cần dựng. */
  readonly graph: SpatialGraph;
  /** Công cụ đo đang mở: chạm hai điểm cho một số đo, `onPick` im lặng. */
  readonly measure: boolean;
  /** Chạm trúng một đối tượng (mã node Pascal), hoặc `null` khi chạm khoảng trống. */
  readonly onPick: (nodeId: string | null) => void;
  /** Một phép đo hai điểm xong, khoảng cách tính bằng mét. */
  readonly onMeasure: (distanceM: number) => void;
  /** Cảnh đã dựng xong khung đầu tiên. */
  readonly onReady: () => void;
  /** Máy không dựng được cảnh — hook đổi sang trạng thái `error`. */
  readonly onFailure: (reason: 'webglUnavailable' | 'deviceTooWeak') => void;
  /** Dự án của cảnh: nạp concept AI (N47) như editor. Vắng = không áp concept. */
  readonly projectId?: string;
  /**
   * Concept AI của dự án, nhớ theo `projectId` ở hook: bật/tắt đo dựng lại cảnh nhưng không gọi lại N47. Vắng = cảnh tự
   * đọc (`loadSceneConcept`).
   */
  readonly loadConcept?: () => Promise<SceneConcept>;
  /**
   * Câu báo dự phòng (thư viện mẫu `LIBRARY_FALLBACK_NOTICE`, concept AI `CONCEPT_FALLBACK_NOTICE`), `null` khi không có
   * gì để báo. Gọi một lần, trước khi dựng cảnh.
   */
  readonly onLibraryNotice?: (notice: string | null) => void;
}

/** Tay cầm cảnh đã lắp. */
export interface MobileViewerSceneHandle {
  /** Trả lại mọi tài nguyên. Gọi đúng một lần. */
  dispose: () => void;
}

/** Kết quả lắp — không có WebGL là một nhánh hợp lệ, không phải sự cố. */
export type MobileViewerSceneMount =
  | { readonly ok: true; readonly handle: MobileViewerSceneHandle }
  | { readonly ok: false; readonly reason: 'webglUnavailable' | 'deviceTooWeak' };

/* -------------------------------------------------------------------------- */
/* 5. Props của view — T7 dựng, T8 kiểm.                                       */
/* -------------------------------------------------------------------------- */

/**
 * Props của `MobileViewer.tsx`.
 *
 * View thuần: test được **chỉ từ props**, không chạm store, không chạm mạng
 * (R-60). Mọi chuỗi ở đây đã là tiếng Việt đã định dạng.
 */
export interface MobileViewerProps {
  readonly state: MobileViewerState;

  /* Thanh trên. */
  readonly projectName: string;
  /** `null` khi liên kết chia sẻ tắt (v1): nút "Chia sẻ dự án" rời DOM. */
  readonly onShare: (() => void) | null;

  /* Khung 3D. Container cấp, không phải hook — story và test bỏ trống. */
  readonly canvasRef?: ((element: HTMLDivElement | null) => void) | undefined;

  /* Thanh dưới. */
  readonly isCompact: boolean;
  readonly activeTool: MobileViewerToolId | null;
  readonly onSelectTool: (tool: MobileViewerToolId | null) => void;

  /* Tầng. */
  readonly floors: readonly MobileViewerFloor[];
  readonly activeFloorId: string | null;
  readonly onSelectFloor: (floorId: string) => void;

  /* Tấm thông tin — chỉ đọc. */
  readonly selection: MobileViewerSelection | null;
  readonly onDismissSelection: () => void;
  /**
   * Câu mời sửa trên máy tính, kèm nút gửi liên kết. `null` khi liên kết chia sẻ
   * tắt: nút rời DOM, câu mời vẫn còn.
   */
  readonly onSendDesktopLink: (() => void) | null;

  /* Đo. */
  readonly measurements: readonly MobileViewerMeasurement[];

  /**
   * Mức chi tiết đang dựng, đã thành nhãn tiếng Việt — ví dụ "đang tải mức gọn".
   * `null` khi không có gì để nói.
   */
  readonly detailLabel: string | null;

  /** Lý do của `partial`; `null` ở mọi trạng thái khác. */
  readonly partialReason: MobilePartialReason | null;

  /** Liên kết sang bản 2D — lối thoát của trạng thái `error` (máy yếu). */
  readonly fallback2dHref: string;

  /** Câu báo dự phòng thư viện/concept (`role="status"`); vắng hoặc `null` khi không có gì để báo. */
  readonly sceneNotice?: string | null;
}

/* -------------------------------------------------------------------------- */
/* 6. Hook — T6 sở hữu.                                                        */
/* -------------------------------------------------------------------------- */

/** Những gì `useMobileViewer` trả về: đúng props của view, không thừa trường nào. */
export type MobileViewerModel = Omit<MobileViewerProps, 'canvasRef'>;
