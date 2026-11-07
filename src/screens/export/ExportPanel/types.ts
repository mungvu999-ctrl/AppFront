/**
 * Hợp đồng của màn Xuất (S-ExportPanel), route `ROUTES.project.export`.
 *
 * Bốn định dạng, đúng bốn. Không IFC, không OBJ: tầng logic không có bộ xuất
 * cho hai định dạng đó, nên chúng không tồn tại ở đây kể cả dưới dạng nhãn.
 *
 * File này là hợp đồng đông cứng: view, hook, container và test đều viết theo
 * nó. Bốn lượt khảo sát tầng logic đứng sau từng dòng — chỗ nào tầng logic
 * không có, {@link ExportCapabilities} nói thẳng ra thay vì bịa.
 */

import type { SevenState } from '@/lib/testing/sevenStateScenarios';

import type { ServerGlbExportView } from './useServerGlbExport';

/* -------------------------------------------------------------------------- */
/* Bốn định dạng                                                              */
/* -------------------------------------------------------------------------- */

export const EXPORT_FORMAT_IDS = ['glb', 'pdf', 'image', 'spatial-json'] as const;

export type ExportFormatId = (typeof EXPORT_FORMAT_IDS)[number];

/* -------------------------------------------------------------------------- */
/* Công năng — cái gì tầng logic THỰC SỰ làm được                             */
/* -------------------------------------------------------------------------- */

/**
 * Tám điều đặc tả yêu cầu mà tầng logic không cung cấp.
 *
 * Công năng nào `false` thì phần giao diện tương ứng **rời khỏi DOM** — không
 * vẽ thanh giả, không để một nút không bao giờ bấm được. Đây là tiền lệ đã
 * chạy ở màn RuleReport: thiếu logic thì gỡ khả năng đó đi, không giả vờ có.
 *
 * Năm cờ đầu đã có từ lượt đông cứng hợp đồng. Ba cờ cuối
 * (`canRenderPdfBytes`, `canCaptureImage`, `canIncludeAxisGrid`) do lượt khảo
 * sát tầng xuất tìm ra muộn hơn và được dời vào đây ở lớp gộp: chúng cùng một
 * loại với năm cờ kia — một mảnh giao diện không có đích đến ở tầng logic — nên
 * chúng thuộc về đúng chỗ này, chứ không phải một kiểu mở rộng mà view và bài
 * kiểm không nhìn thấy.
 */
export interface ExportCapabilities {
  /**
   * Ước tính dung lượng **trước** khi xuất.
   *
   * `false` — `src/lib/export` không có hàm ước tính nào. `byteLength` chỉ nằm
   * trong `ExportGlbResult`, tức là *sau* khi xuất xong; `estimateCaptureMemoryMb`
   * đo bộ nhớ đồ hoạ lúc chụp, không phải dung lượng tệp. Đặc tả tự cấm đoán
   * ("không đoán"), nên dòng ước tính không được vẽ ra.
   */
  readonly canEstimateSize: boolean;
  /**
   * Giữ lịch sử tệp đã xuất qua lần tải lại trang.
   *
   * `false` — không có khoá `queryKeys.export`, không có tầng lưu trữ bền.
   * Danh sách tệp chỉ sống trong phiên làm việc hiện tại.
   */
  readonly canPersistHistory: boolean;
  /**
   * Chọn đơn vị khi xuất `.glb`.
   *
   * `false` — `GlbProjectMetadata.unit` cố định `'metre'`, `ExportGlbOptions`
   * không có trường đơn vị. Một Select đơn vị sẽ là điều khiển chết.
   */
  readonly canChooseUnit: boolean;
  /**
   * Đặt tên bước tiến trình theo từng tầng ("Đang gộp lưới tầng 2").
   *
   * `false` — `ExportProgress.phase` chỉ có hai pha, và `completed`/`total`
   * đếm **phòng**, không đếm tầng. Bước hiện tại vẫn có tên thật, nhưng là tên
   * của pha kèm số đếm thật.
   */
  readonly canNameFloorStep: boolean;
  /**
   * Đính nút tải vào toast báo xong.
   *
   * `false` — `Toast` chỉ có nút "Hoàn tác" cố định, không nhận hành động tuỳ
   * ý. Nút tải sống ở hàng tương ứng trong danh sách tệp đã xuất.
   */
  readonly canPutDownloadInToast: boolean;
  /**
   * Dựng hồ sơ PDF thành bytes của một tệp `.pdf`.
   *
   * `false` — `src/lib/export/exportPdf.ts` chỉ dựng **mô hình nội dung trang**
   * (`PdfDocument`); docstring của nó nói thẳng là không chạm vào thư viện PDF
   * nào, và `package.json` cũng không có thư viện PDF nào. **Số trang là thật**
   * và vẫn hiện trên thẻ; chỉ khả năng tải tệp về là chưa có, nên khả năng đó
   * rời khỏi DOM thay vì thành một nút xám.
   */
  readonly canRenderPdfBytes: boolean;
  /**
   * Chụp ảnh khung nhìn ba chiều.
   *
   * `false` — `createFloorCapture` đòi một `renderer`/`scene`/`camera` đang
   * sống. Route của màn này không gắn khung nhìn nào và lượt này không được
   * dựng thêm thành phần mới, nên chưa có gì để chụp.
   */
  readonly canCaptureImage: boolean;
  /**
   * Đưa lưới trục vào tệp `.glb`.
   *
   * `false` — `ExportGlbOptions` không có trường lưới trục nào, nên một công
   * tắc "kèm lưới trục" không đổi được tệp xuất ra. Công tắc đó vì thế rời khỏi
   * DOM.
   */
  readonly canIncludeAxisGrid: boolean;
}

/* -------------------------------------------------------------------------- */
/* Thẻ định dạng — cột trái                                                   */
/* -------------------------------------------------------------------------- */

/** Dung lượng chỉ biết được sau khi xuất; trước đó không có gì để nói. */
export type SizeState = 'unavailable' | 'known';

export interface ExportFormatCard {
  readonly id: ExportFormatId;
  /** Ví dụ ".glb" — hiện bằng chữ đều. */
  readonly extensionLabel: string;
  /** Một câu nói định dạng này dành cho ai, bằng tiếng thường. */
  readonly audienceSentence: string;
  /**
   * Dung lượng **thật**, đã định dạng sẵn qua `formatFileSize` (A15: định dạng
   * ở viewmodel, không ở view). `null` khi `sizeState` là `unavailable`, và khi
   * đó view **không vẽ dòng này**.
   */
  readonly sizeLabel: string | null;
  readonly sizeState: SizeState;
  /**
   * Số trang, **chỉ PDF**. Đếm thật từ `buildPdfDocument`, đã định dạng sẵn.
   * `null` với ba định dạng còn lại.
   */
  readonly pageCountLabel: string | null;
  readonly isSelected: boolean;
}

/* -------------------------------------------------------------------------- */
/* Phạm vi — chọn nhiều tầng                                                  */
/* -------------------------------------------------------------------------- */

/** Chỗ của tầng trên đường duyệt — xem `floorStateOf` ở cổng. */
export type ExportFloorState = 'approved' | 'empty' | 'scaleOnly' | 'stepOnly' | 'pending';

export interface ExportFloorChoice {
  readonly id: string;
  readonly name: string;
  readonly order: number;
  readonly isSelected: boolean;
  /** Tầng chưa duyệt **vẫn chọn được**, nhưng mang caption cần chú ý. */
  readonly isApproved: boolean;
  /** Vắng thì suy từ `isApproved`. `empty` = chưa có bản vẽ: không tích được (U36). */
  readonly state?: ExportFloorState;
}

/* -------------------------------------------------------------------------- */
/* Tuỳ chọn theo từng định dạng                                               */
/* -------------------------------------------------------------------------- */

/** Ba mức của `ExportDetail`. Đặc tả nói "cao hoặc gọn"; tầng logic có ba. */
export type ExportDetailChoice = 'high' | 'medium' | 'low';

export interface GlbOptionsView {
  readonly detail: ExportDetailChoice;
  readonly includeFurniture: boolean;
  readonly includeAxisGrid: boolean;
}

/** Bốn mục của PDF, mỗi mục bật tắt được; số trang tính lại theo lựa chọn. */
export interface PdfOptionsView {
  readonly includeFloorPlans: boolean;
  readonly includeRoomTable: boolean;
  readonly includeViolations: boolean;
  readonly includeRender3d: boolean;
}

export interface ImageOptionsView {
  readonly viewId: string;
  readonly widthLabel: string;
}

export interface SpatialJsonOptionsView {
  /** Độ tin cậy nằm ở cấp từng đối tượng (`ReviewMetadata`), không ở cấp đồ thị. */
  readonly includeConfidence: boolean;
}

export interface ExportOptionsView {
  readonly glb: GlbOptionsView;
  readonly pdf: PdfOptionsView;
  readonly image: ImageOptionsView;
  readonly spatialJson: SpatialJsonOptionsView;
  /** Mục "Tuỳ chọn" gấp lại mặc định. */
  readonly isExpanded: boolean;
}

/* -------------------------------------------------------------------------- */
/* Khối "Kiểm tra trước khi xuất" — CHỈ THÔNG TIN, KHÔNG BAO GIỜ CHẶN         */
/* -------------------------------------------------------------------------- */

export type PreflightTone = 'ok' | 'attention';

export interface PreflightRow {
  readonly id: 'approval' | 'violations' | 'unreviewed' | 'readiness';
  /** Câu tiếng thường, ví dụ "Còn 3 phát hiện ở 2 luật chưa xử lý." */
  readonly label: string;
  readonly tone: PreflightTone;
  /** Liên kết đi sửa, lấy từ `ROUTES`. `null` khi không có nơi để đi. */
  readonly fixHref: string | null;
}

/* -------------------------------------------------------------------------- */
/* Tiến trình THẬT — không bao giờ là thanh giả                               */
/* -------------------------------------------------------------------------- */

export interface ExportProgressView {
  readonly formatId: ExportFormatId;
  /** Tên bước hiện tại, dịch từ pha thật: "đang dựng hình" / "đang mã hoá". */
  readonly stepLabel: string;
  /** Đã định dạng sẵn từ số đếm thật, ví dụ "12/40 phòng". */
  readonly countLabel: string;
  /** 0–1, tính từ số đếm thật của worker. Không nội suy, không đoán. */
  readonly ratio: number;
}

/* -------------------------------------------------------------------------- */
/* Tệp đã xuất                                                                */
/* -------------------------------------------------------------------------- */

export interface ExportedFileRow {
  readonly id: string;
  readonly fileName: string;
  /** Dung lượng **thật**, đo được sau khi xuất xong. */
  readonly sizeLabel: string;
  readonly momentLabel: string;
  readonly formatId: ExportFormatId;
  /** U51: hàng khôi phục từ lần mở trước — chỉ còn thông tin, không còn nội dung để tải lại. */
  readonly isRestored?: boolean;
}

/* -------------------------------------------------------------------------- */
/* Lỗi                                                                        */
/* -------------------------------------------------------------------------- */

export interface ExportErrorView {
  /** Giải thích bằng tiếng thường. */
  readonly message: string;
  /** Mã lỗi nhỏ, chữ đều. */
  readonly code: string;
  /** Gợi ý hạ mức chi tiết. */
  readonly hint: string;
}

/* -------------------------------------------------------------------------- */
/* Props của view — view thuần, test được chỉ từ props (R-60, mục D)          */
/* -------------------------------------------------------------------------- */

export interface ExportPanelProps {
  /** Bảy trạng thái của A11, dùng đúng tên trong `SEVEN_STATES`. */
  readonly status: SevenState;
  readonly capabilities: ExportCapabilities;

  readonly formats: readonly ExportFormatCard[];
  readonly floors: readonly ExportFloorChoice[];
  readonly options: ExportOptionsView;
  readonly preflight: readonly PreflightRow[];
  readonly exportedFiles: readonly ExportedFileRow[];

  /** Khác `null` khi đang xuất; footer thay bằng thanh tiến độ tại chỗ. */
  readonly progress: ExportProgressView | null;
  /** Khác `null` chỉ ở trạng thái `error`. */
  readonly error: ExportErrorView | null;

  /** Caption nói tệp sẽ xuất hiện ở đâu. */
  readonly destinationCaption: string;
  /** UX-22: việc còn dở nói ngay trên nút "Xuất" ("Còn 28 mục chưa duyệt."), `null` khi không còn gì. */
  readonly pendingNote?: string | null;
  /** Caption của trạng thái `partial`, `null` khi không cần. */
  readonly noticeCaption: string | null;
  /** Ở `forbidden`: ai được xuất. */
  readonly permissionCaption: string | null;
  /** Ở `collapsed`: bốn thẻ xếp dọc hết chiều rộng. */
  readonly isCollapsed: boolean;

  readonly onSelectFormat: (id: ExportFormatId) => void;
  readonly onToggleFloor: (id: string) => void;
  readonly onChangeOptions: (next: ExportOptionsView) => void;
  readonly onToggleOptionsExpanded: () => void;
  readonly onExport: () => void;
  /** U36: khác `null` khi bấm Xuất mà có tầng chưa duyệt — câu hỏi lại "Vẫn xuất?". */
  readonly unreviewedConfirm?: string | null;
  /** "Vẫn xuất": xuất luôn dù tầng chưa duyệt. */
  readonly onConfirmExport?: () => void;
  /** "Duyệt trước": đóng câu hỏi, về màn duyệt. */
  readonly onReviewFirst?: () => void;
  /** Huỷ giữa chừng, có hiệu lực ngay. */
  readonly onCancel: () => void;
  /** Thử lại **giữ nguyên mọi thiết lập**. */
  readonly onRetry: () => void;
  readonly onDownload: (fileId: string) => void;
  /** UX-05: lối phụ "In" cho hàng PDF — mở hộp thoại in của tệp đã xuất. */
  readonly onPrint?: (fileId: string) => void;
  readonly onFollowFix: (rowId: PreflightRow['id']) => void;
  /**
   * Mở hộp thoại chia sẻ (`ShareDialogContainer`, S-ShareDialog). `null` khi
   * liên kết chia sẻ tắt (v1) hoặc nơi gọi không truyền: nút "chia sẻ" rời DOM.
   */
  readonly onShare: (() => void) | null;
  /** Về màn Quản lý tầng của dự án (nút "Về dự án" ở chân trang). Vắng thì không có nút. */
  readonly onBackToProject?: () => void;
  /** Mở màn "Dữ liệu dự án" (xem trước tệp JSON). Vắng thì không có liên kết. */
  readonly onOpenData?: () => void;
  /** M1-01: khối "GLB dựng trên máy chủ" khi cờ `VITE_EXPORT_ENGINE=compiler`; vắng/`null` = chỉ GLB nhanh. */
  readonly serverGlb?: ServerGlbExportView | null;
}
