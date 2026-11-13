/**
 * Hợp đồng props của màn Xử lý (`ProcessingScreen`) — route
 * `ROUTE_PATTERNS.projectPipeline` (`/projects/:id/pipeline`).
 *
 * Đây là NỀN MÓNG (S4): file này là API công khai DUY NHẤT giữa người viết hook
 * (`useProcessingScreen.ts`, nhiệm vụ V7) và người viết view (`ProcessingScreen.tsx`
 * cộng năm phần con, nhiệm vụ V5/V6). Ba worker lớp sau viết DỰA VÀO đúng những gì
 * khai ở đây — không ai được tự thêm hay đổi hình dạng một trường mà không sửa file
 * này trước (và không ai được sửa file này mà không hỏi điều phối viên, xem cuối
 * file). View không được nhập `src/api`, `src/store`, `src/domain` hay `src/lib/http`
 * (mục D, R-60), nên mọi thứ ở đây phải **đã được quyết xong và viết xong**:
 *
 * - Mọi chuỗi người đọc là tiếng Việt có dấu và **đã định dạng sẵn** (A15). Không
 *   con số thô nào còn phải làm tròn hay ghép câu trong view. Ngoại lệ DUY NHẤT là
 *   {@link ProcessingStepViewModel.percent}: đây là số phần trăm 0..100 mà thanh
 *   tiến độ và vòng quét dùng trực tiếp cho chu kỳ vẽ (`width`, `stroke-dashoffset`…)
 *   của chính nó, không phải một con số hiển thị cho người đọc — nó không đi qua
 *   `toFixed`/`toLocaleString` nên không phạm `local/no-raw-number`.
 * - {@link ProcessingScreenState} có đúng **bảy** giá trị của A11, lấy TÊN CHÍNH XÁC
 *   (kể cả `'success'`, không đổi thành một từ khác) từ
 *   `src/lib/testing/sevenStateScenarios.ts`. Không nhánh thứ tám, không `null`
 *   thay cho một nhánh.
 *
 * ## Vì sao chưa có `onSelectFloor`
 *
 * {@link ProcessingFloorChipViewModel} có `isActive`, nhưng `ProcessingScreenProps`
 * không có hành động đổi tầng đang xem. Khác với `InputQualityGate` (người dùng tự
 * chọn tầng để soát), ở màn Xử lý dãy chip tầng chỉ ĐỌC tiến độ — tầng nào đang chạy
 * là do hệ thống quyết, không phải người dùng bấm chọn. `activeFloorId` của
 * {@link ProcessingPreviewViewModel} đi theo đúng tầng hệ thống đang xử lý.
 *
 * ## Giả định cần xác nhận — `ProcessingPanelTab`
 *
 * Đặc tả gốc chỉ nói "`activeTab`, `onTabChange`" mà không nói tab của cái gì. Suy
 * luận từ các trường còn lại (`previewPanel` + `logLines` là hai khối nội dung không
 * vừa cạnh nhau ở khung hẹp, cùng lý lẽ cột phải → tấm trượt đáy của
 * `InputQualityGate`), khung này giả định `activeTab` chọn giữa panel xem trước và
 * panel nhật ký. Nếu điều phối viên chốt khác, sửa {@link ProcessingPanelTab} ở đây
 * — mọi nơi dùng nó (`ProcessingScreen.tsx`) đọc lại theo type, không hard-code.
 *
 * ## KHOÁ SAU KHI XONG
 *
 * File này ĐÓNG BĂNG sau khi S4 xong. Worker lớp sau (view trái/phải, hook) muốn đổi
 * hình dạng một trường phải `ask` điều phối viên trước, không tự sửa.
 */

/* -------------------------------------------------------------------------- */
/* Bảy trạng thái (A11).                                                       */
/* -------------------------------------------------------------------------- */

/**
 * Đúng bảy trạng thái của A11, tên lấy nguyên từ `SEVEN_STATES`
 * (`src/lib/testing/sevenStateScenarios.ts`) — kể cả `'success'`, không đổi tên
 * như `InputQualityGateStatus` từng đổi thành `'ready'`.
 */
export type ProcessingScreenState =
  | 'empty'
  | 'loading'
  | 'partial'
  | 'error'
  | 'success'
  | 'forbidden'
  | 'collapsed';

/* -------------------------------------------------------------------------- */
/* Trạng thái một tầng / một bước — dùng chung cho chip tầng và hàng bước.     */
/* -------------------------------------------------------------------------- */

/**
 * Bốn trạng thái một đơn vị xử lý (một tầng, hoặc một bước) có thể ở.
 *
 * Đặc tả chỉ nêu bốn giá trị này cho {@link ProcessingFloorChipViewModel}; khung này
 * dùng chung một type cho `ProcessingStepViewModel.status` thay vì bịa một enum thứ
 * hai — bốn trạng thái mô tả đúng vòng đời của cả tầng lẫn bước (chờ → đang chạy →
 * xong / lỗi), và dùng chung nghĩa là `ProcessingFloorChips` và `ProcessingStepList`
 * tô cùng một bảng màu cho cùng một khái niệm.
 */
export type ProcessingStageStatus = 'queued' | 'running' | 'done' | 'failed';

/* -------------------------------------------------------------------------- */
/* Dãy chip tầng.                                                              */
/* -------------------------------------------------------------------------- */

export interface ProcessingFloorChipViewModel {
  readonly id: string;
  /** Tên tầng, tiếng Việt — ví dụ `"Tầng 1"`. */
  readonly label: string;
  readonly status: ProcessingStageStatus;
  /** Đã định dạng sẵn — ví dụ `"đang xử lý"`, `"đã xong"` (A6: viết thường, kiểu câu). */
  readonly statusLabel: string;
  /** Tầng hệ thống đang xử lý ngay bây giờ — không phải tầng người dùng chọn xem. */
  readonly isActive: boolean;
  /** Đã định dạng sẵn — ví dụ `"48 đối tượng"`. `undefined` khi chưa có gì để đếm. */
  readonly objectCountLabel?: string;
  /** `"Cần xem lại"` khi N16 `readiness.state` là `needsReview` (FIX-P0-15); vắng khi không. */
  readonly reviewLabel?: string;
  /** Máy không đo được tỷ lệ tầng: `reviewLabel` là "Chưa có tỷ lệ" (`SCALE_STATE_VIEWS.missing`), vẽ màu lỗi. */
  readonly isScaleMissing?: boolean;
}

/* -------------------------------------------------------------------------- */
/* Danh sách bước xử lý — cây tối đa hai tầng (bước cha, bước con thụt vào).    */
/* -------------------------------------------------------------------------- */

export interface ProcessingStepViewModel {
  readonly id: string;
  /**
   * Tên bước NGUYÊN VĂN từ `src/i18n/vi.json` khoá `pipeline` — ví dụ
   * `"tách lớp tường"`. Không viết tắt, không dịch lại (mục [CẤM TUYỆT ĐỐI]).
   */
  readonly name: string;
  readonly status: ProcessingStageStatus;
  /**
   * 0..100. Ngoại lệ của A15 nêu ở đầu file — số này cấp cho chu kỳ vẽ của chính
   * thanh tiến độ / vòng quét, không phải một con số người dùng đọc trực tiếp.
   * Không tự tăng khi không có dữ liệu (mục [CẤM TUYỆT ĐỐI] — "không thành tiến độ
   * giả").
   */
  readonly percent: number;
  /** Đã định dạng sẵn — ví dụ `"còn khoảng 2 phút"`. `undefined` khi chưa ước lượng được. */
  readonly remainingLabel?: string;
  /** Bước đang chạy thì có vạch quét — không glow, không gradient (mục [CẤM TUYỆT ĐỐI]). */
  readonly isScanning: boolean;
  /** Câu chi tiết đã ghép sẵn — ví dụ `["Đã tìm thấy 48 đoạn tường"]`. */
  readonly detailLabels: readonly string[];
  readonly isDetailOpen: boolean;
  readonly onToggleDetail: () => void;
  /** Mã lỗi giữ nguyên dạng máy đọc (A6 cho phép chữ hoa ở mã lỗi). `undefined` khi không lỗi. */
  readonly errorCode?: string;
  /** Câu tiếng Việt nói rõ hậu quả — không đứng một mình cạnh `errorCode` không giải thích. */
  readonly errorMessage?: string;
  /** Ba hàng con thụt vào dưới hàng cha — cùng hình dạng, đệ quy một cấp trong thực tế. */
  readonly children?: readonly ProcessingStepViewModel[];
}

/* -------------------------------------------------------------------------- */
/* Nhật ký.                                                                    */
/* -------------------------------------------------------------------------- */

export interface ProcessingLogLineViewModel {
  readonly id: string;
  /** Giờ đã định dạng sẵn — ví dụ `"14:32:07"`. */
  readonly timeLabel: string;
  readonly text: string;
}

/* -------------------------------------------------------------------------- */
/* Báo cáo tổng kết.                                                           */
/* -------------------------------------------------------------------------- */

/**
 * Lý do "cần xem lại" của tầng — chép đúng `ReadinessReason` (N16, `src/api/schemas/spatialLayer.ts`)
 * vì view không được nhập `src/api` (R-60).
 */
export type ProcessingReviewReason =
  | 'scaleUnresolved'
  | 'criticalIssues'
  | 'geometrySuspect'
  | 'fallbackWallModel'
  | 'fallbackObjectModel'
  | 'fallbackTextModel';

export interface ProcessingSummaryViewModel {
  /**
   * Tường, đối tượng, kích thước, phòng, diện tích — đã định dạng sẵn (A15), ví dụ `"48 tường"`,
   * `"248,60 m²"`. Rỗng khi chưa đọc được số liệu: khối vẫn hiện để giữ hai lối đi tiếp.
   */
  readonly metricLabels: readonly string[];
  /** Cả câu, đã ghép số — ví dụ `"Có 9 đối tượng có độ tin cậy dưới 0,75 cần bạn xem lại."`. */
  readonly lowConfidenceSentence?: string;
  /** Không đọc được chuỗi kích thước nào: câu hệ quả (phải tự đặt tỷ lệ). Vắng khi có ít nhất một chuỗi. */
  readonly noDimensionSentence?: string;
  /**
   * UX-02: không đọc được số kích thước nhưng máy đã đề xuất tỷ lệ — câu nói nguồn, ví dụ
   * `"Tỷ lệ lấy từ ghi chú TL 1:50 trên bản vẽ"`. Có câu này thì không có `noDimensionSentence`.
   */
  readonly scaleSourceNote?: string;
  /** Mọi tầng xong đều đã có tỷ lệ (đặt tay): không đòi "Đặt tỷ lệ" dù không đọc được kích thước. */
  readonly scaleKnown?: boolean;
  /** Lý do "cần xem lại" gộp từ mọi tầng xong (N16 `readiness`, FIX-P0-15); rỗng/vắng khi không có. */
  readonly reviewReasons?: readonly ProcessingReviewReason[];
  /** Mã kiểm hình học critical (N16 `readiness.checks`) gộp từ mọi tầng xong, không lặp; vắng khi không có. */
  readonly reviewChecks?: readonly string[];
  /** Tỷ lệ máy ước lượng (cửa, độ dày tường, mặc định — N16 `scaleBasis`), không đọc từ số trên bản vẽ. */
  readonly scaleEstimated?: true;
  /** R9: tên trạng thái tỷ lệ của tầng xong đầu tiên đáng chú ý (N16 `scaleState`). */
  readonly scaleStateLabel?: string;
  /** R9: câu trạng thái + lý do tỷ lệ đi cùng `scaleStateLabel`. */
  readonly scaleStateNote?: string;
  readonly onReviewWalls: () => void;
  readonly onCalibrateScale: () => void;
  /** UX-30: người chỉ muốn ngắm thì đi thẳng tới 3D, cạnh lối đi tiếp chính. */
  readonly onOpenViewer3d?: () => void;
}

/* -------------------------------------------------------------------------- */
/* Panel xem trước.                                                            */
/* -------------------------------------------------------------------------- */

export interface ProcessingPreviewViewModel {
  readonly sourceImageUrl?: string;
  readonly altText: string;
  /** Đang xử lý tầng đang xem thì có vạch quét — không glow, không gradient. */
  readonly isScanning: boolean;
  /** Đường hình học đã dò được, dạng path (SVG hoặc tương đương) để vẽ đè lên ảnh. */
  readonly detectedGeometryPaths: readonly string[];
  /** Tầng đang hiện trên panel. `null` khi chưa có tầng nào để xem (rỗng/đang tải). */
  readonly activeFloorId: string | null;
}

/* -------------------------------------------------------------------------- */
/* Cảnh báo lỗi toàn màn.                                                      */
/* -------------------------------------------------------------------------- */

export interface ProcessingErrorAlertViewModel {
  readonly title: string;
  readonly message: string;
  /** Mã máy đọc, giữ nguyên dạng (A6) — không bao giờ đứng một mình, luôn kèm `message`. */
  readonly technicalCode: string;
  readonly onRetry: () => void;
  readonly onGoToSupport: () => void;
  /**
   * Chính dự án trả 404: thử lại không sửa được, mã nội bộ không giúp gì — màn chỉ nói
   * "không tìm thấy dự án" kèm lối về danh sách (BUG-312).
   */
  readonly isProjectMissing?: true;
  readonly onBackToProjects?: () => void;
}

/* -------------------------------------------------------------------------- */
/* Tab của cột phải — xem GHI CHÚ GIẢ ĐỊNH ở đầu file.                          */
/* -------------------------------------------------------------------------- */

export type ProcessingPanelTab = 'preview' | 'log';

/* -------------------------------------------------------------------------- */
/* Toàn màn.                                                                   */
/* -------------------------------------------------------------------------- */

/**
 * Mọi prop `ProcessingScreen.tsx` nhận. HỢP ĐỒNG PROPS DUY NHẤT của màn Xử lý.
 *
 * Không nhóm thành `{ model, actions }` như `InputQualityGateViewProps` — đặc tả
 * gốc liệt kê phẳng, và giữ phẳng ở đây để không lệch khỏi đặc tả mà không có lý do.
 */
export interface ProcessingScreenProps {
  readonly state: ProcessingScreenState;
  readonly floors: readonly ProcessingFloorChipViewModel[];
  readonly steps: readonly ProcessingStepViewModel[];
  readonly previewPanel: ProcessingPreviewViewModel;
  readonly logLines: readonly ProcessingLogLineViewModel[];
  readonly summary?: ProcessingSummaryViewModel;
  /** Ví dụ `"Đã xong 2/4 tầng"` — đọc trong vùng `role=status`. */
  readonly overallSummaryLine: string;
  /**
   * Ví dụ `"Còn lại khoảng 4 phút 20 giây"`; `undefined` khi không còn gì để chờ. Hiện cùng dòng
   * với `overallSummaryLine` nhưng NGOÀI vùng `role=status`: đổi theo giây, đọc lại liên tục (R1-03).
   */
  readonly remainingLine?: string;
  /** Ví dụ `"Đang xếp hàng: còn 2 lượt phía trước…"`. `undefined` khi không xếp hàng. */
  readonly queueLine?: string;
  /** Câu nói rõ xử lý VẪN TIẾP TỤC khi một tầng lỗi (mục [CẤM TUYỆT ĐỐI]). */
  readonly partialNoticeLine?: string;
  readonly errorAlert?: ProcessingErrorAlertViewModel;
  readonly activeTab: ProcessingPanelTab;
  readonly onTabChange: (tab: ProcessingPanelTab) => void;
  readonly isLogAutoScrollLocked: boolean;
  readonly onToggleLogAutoScroll: () => void;
  readonly onCopyLog: () => void;
  /** `false` khi không có quyền — ẩn hẳn nút huỷ, không phải khoá mờ (cùng lý lẽ A9). */
  readonly canCancel: boolean;
  readonly isCancelConfirming: boolean;
  readonly onRequestCancel: () => void;
  readonly onConfirmCancel: () => void;
  readonly onDismissCancel: () => void;
  readonly onRunInBackground: () => void;
  /** Còn lượt chưa xong: không có thì nút chạy nền biến mất — không hứa báo về việc không chạy. */
  readonly canRunInBackground: boolean;
  /** Hành động của màn rỗng: sang trang tải bản vẽ của dự án. */
  readonly onUploadDrawings: () => void;
  /** Dưới 1024px — cùng mốc `InputQualityGate`/`FloorUploadScreen`/`ProjectSettings`. */
  readonly isCompact: boolean;
  /** Có thì thay vạch quét bằng thanh tĩnh — không animate khi bật (mục B). */
  readonly prefersReducedMotion: boolean;
  /** Tên dự án cho breadcrumb, lấy từ bộ đệm (BUG-165). Vắng khi bộ đệm chưa có: breadcrumb bỏ cấp ấy. */
  readonly projectName?: string;
  /** Cấp "Dự án" của đường dẫn về danh sách dự án (BUG-546). Vắng thì cấp đó là chữ thường. */
  readonly onBackToProjects?: () => void;
  /** Lối sang màn kiểm tra chất lượng ảnh đầu vào của dự án (N5-04). Vắng thì không vẽ nút. */
  readonly onOpenQuality?: () => void;
  /** Tầng của dự án chưa có bản vẽ nào (N2-02), theo `order`. Vắng/rỗng thì không vẽ khối. */
  readonly floorsWithoutDrawing?: readonly { readonly id: string; readonly label: string }[];
  /** Các lượt xử lý gần nhất của dự án, mới nhất trước (N5-08). Vắng khi chưa đọc được. */
  readonly runs?: readonly ProcessingRunRowViewModel[];
}

/** Một dòng trong danh sách lượt xử lý của tab "Nhật ký" (N5-08). */
export interface ProcessingRunRowViewModel {
  readonly id: string;
  readonly floorName: string;
  /** Ví dụ "Hoàn tất", "Lỗi", "Đang chạy · 40%". */
  readonly statusLabel: string;
  readonly tone: 'done' | 'failed' | 'running';
  /** Giờ bắt đầu (hoặc giờ tạo) kèm ngày, ví dụ "14:05 · 18/10/2026". */
  readonly timeLabel: string;
}

/* -------------------------------------------------------------------------- */
/* Props của năm phần con. Mỗi phần chỉ nhận đúng lát cắt nó cần.               */
/* -------------------------------------------------------------------------- */

/** Props của `ProcessingPreviewPanel` — panel xem trước, thay được bởi `ProcessingLogPanel` qua tab. */
export interface ProcessingPreviewPanelProps {
  readonly preview: ProcessingPreviewViewModel;
  readonly prefersReducedMotion: boolean;
}

/** Props của `ProcessingLogPanel` — nhật ký cuộn, khoá cuộn tự động, sao chép. */
export interface ProcessingLogPanelProps {
  readonly logLines: readonly ProcessingLogLineViewModel[];
  readonly runs?: readonly ProcessingRunRowViewModel[];
  readonly isAutoScrollLocked: boolean;
  readonly onToggleAutoScroll: () => void;
  readonly onCopyLog: () => void;
}

/** Props của `ProcessingFloorChips` — dãy chip tầng, chỉ đọc, không có hành động chọn. */
export interface ProcessingFloorChipsProps {
  readonly floors: readonly ProcessingFloorChipViewModel[];
}

/** Props của `ProcessingStepList` — cây bước xử lý, tối đa hai tầng thụt vào. */
export interface ProcessingStepListProps {
  readonly steps: readonly ProcessingStepViewModel[];
  readonly prefersReducedMotion: boolean;
  /** Kết quả đã định dạng hiện cuối hàng bước, theo `step.id` (ví dụ "81 tường"). */
  readonly resultByStepId?: ReadonlyMap<string, string>;
  /** Bước có kết quả đáng chú ý (ví dụ 0 chuỗi kích thước): tam giác cảnh báo cạnh kết quả. */
  readonly warnStepIds?: readonly string[];
}
