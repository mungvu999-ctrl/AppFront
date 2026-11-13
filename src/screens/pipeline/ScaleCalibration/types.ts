/**
 * Hợp đồng props của màn Hiệu chỉnh tỷ lệ (`ScaleCalibration`) — route
 * `ROUTE_PATTERNS.projectScale` (`/projects/:id/floors/:floorId/scale`).
 *
 * Đây là XƯƠNG SỐNG của màn: file này là API công khai DUY NHẤT giữa người viết
 * hook (`useScaleCalibration.ts`) và ba người viết view
 * (`ScaleCalibration.tsx`, `ScaleCalibrationCanvas.tsx`,
 * `ScaleCalibrationPanel.tsx` + hai phần con theo phương pháp). Không ai trong
 * số họ được sửa file này; thiếu một kiểu thì DỪNG và hỏi điều phối viên
 * (R-69), không tự thêm.
 *
 * Ba luật định hình mọi trường bên dưới:
 *
 * - **A15 — định dạng xảy ra ở hook, không ở view.** Mọi chuỗi người đọc ở đây
 *   đã là tiếng Việt có dấu và đã ghép xong; dấu thập phân là dấu phẩy. View
 *   không còn con số nào phải làm tròn, chia, hay đổi đơn vị.
 * - **R-60 — view thuần.** View chỉ được `import type` từ `src/domain`, không
 *   gọi hàm ở đó. Nên mọi giá trị view *tạo ra* (toạ độ con trỏ, điểm kéo) đi
 *   ra ngoài dưới dạng **tỷ lệ 0..1 của khung ảnh** ({@link ImageRatioPoint}) —
 *   thứ view đọc thẳng từ sự kiện DOM — còn mọi giá trị view *nhận vào* mà là
 *   một phép đo thì mang nhãn đơn vị của `src/domain/units` ({@link Pixels},
 *   {@link Millimetres}, {@link MillimetresPerPixel}). View không bao giờ phải
 *   gắn nhãn cho một con số, vì nó không import được `pixels()`.
 * - **A11 — đúng bảy trạng thái**, tên lấy nguyên văn từ `SEVEN_STATES`
 *   (`src/lib/testing/sevenStateScenarios.ts`), kể cả `'success'`.
 *
 * ## Nguyên tắc riêng của màn này: HIỆN PHÉP TÍNH RA
 *
 * `4.800 mm ÷ 400 px = 12 mm/px` là lý do màn tồn tại. Vì vậy
 * {@link ScaleComputationViewModel} tách phép tính làm **ba phần** thay vì một
 * câu đã ghép: view buộc phải đặt cả tử số, cả mẫu số và cả kết quả xuống, và
 * không có cách nào rút gọn nó thành mỗi kết quả.
 *
 * ## Cảnh báo KHÔNG CHẶN
 *
 * `panel.canApply` **không** phụ thuộc vào {@link ScaleWarningNotice}. Một tỷ lệ
 * vô lý, hay lệch quá 15% so với ước tính của AI, vẫn áp được — người dùng là
 * kỹ sư và họ có thể đúng. Cảnh báo nói ra hậu quả, không khoá nút.
 *
 * ## Vì sao không có `ScaleCalibrationStatusBarProps`
 *
 * Thanh trạng thái 32px là `src/components/shell/StatusBar.tsx` đã có sẵn
 * (`h-8`, ba mục). "Không tạo component mới" nghĩa là màn này TÁI SỬ DỤNG nó,
 * nên chỗ hợp đồng cần không phải một bộ props thứ hai mà là một mảnh viewmodel
 * khớp đúng chữ ký của nó: {@link ScaleStatusBarViewModel}. `ScaleCalibration.tsx`
 * viết `<StatusBar {...model.statusBar} />`, không hơn.
 *
 * ## KHOÁ SAU KHI XONG
 *
 * File này đóng băng. Muốn đổi hình dạng một trường thì `orca orchestration ask`
 * điều phối viên trước.
 */

import type { RefObject } from 'react';

import type { QcFloorNavProps } from '../../qc/shared/QcFloorNav';

import type {
  ManualCalibrationReason,
  MillimetresPerPixel,
  Pixels,
  Scale,
  ScaleInference,
  ScaleMeasurement,
} from '@/domain/units/scale';
import type { SnapTargetKind } from '@/domain/units/snap';
import type { Millimetres } from '@/domain/units/types';
import type { FloorLayerSaveBlock } from '@/hooks/useAutosave';
import type { FloorLayerReadFailure } from '../../qc/shared/floorLayerReadFailure';
import type { ViewportState } from '@/hooks/useCanvasViewport';
import type { ViewStatusCode } from '@/lib/viewmodel/types';
import type { ProjectRole } from '@/types/project';
import type { ScaleCheckViewModel } from './scaleCheck';

/* -------------------------------------------------------------------------- */
/* Bảy trạng thái (A11).                                                       */
/* -------------------------------------------------------------------------- */

/**
 * Đúng bảy trạng thái của A11, tên lấy nguyên từ `SEVEN_STATES`.
 *
 * Ý nghĩa của từng nhánh trên màn này:
 *
 * | Trạng thái  | Nghĩa ở màn Hiệu chỉnh tỷ lệ                                     |
 * |-------------|------------------------------------------------------------------|
 * | `empty`     | OCR không đọc được chuỗi kích thước nào                           |
 * | `loading`   | đang tải ảnh bản vẽ đã nắn                                        |
 * | `partial`   | đã kéo đoạn nhưng chưa nhập chiều dài, HOẶC có chuỗi tin cậy thấp  |
 * | `error`     | nắn ảnh thất bại, bản vẽ có thể méo                               |
 * | `success`   | tỷ lệ đã áp, badge chuyển sang đã duyệt                           |
 * | `forbidden` | không có quyền, canvas không kéo được                             |
 * | `collapsed` | panel phải thu gọn                                                |
 */
export type ScaleCalibrationState =
  | 'empty'
  | 'loading'
  | 'partial'
  | 'error'
  | 'success'
  | 'forbidden'
  | 'collapsed';

/* -------------------------------------------------------------------------- */
/* Hai cách xác định tỷ lệ.                                                    */
/* -------------------------------------------------------------------------- */

/** Hai mục của SegmentedControl "Cách xác định". */
export type ScaleCalibrationMethod = 'dimensionString' | 'referenceLine';

/** Một mục của SegmentedControl, đã có nhãn tiếng Việt. */
export interface ScaleMethodOption {
  readonly value: ScaleCalibrationMethod;
  readonly label: string;
  /**
   * `true` cho `'dimensionString'` khi OCR không đọc được chuỗi nào (trạng thái
   * `empty`). Mục vẫn hiện — người dùng phải thấy phương pháp kia tồn tại —
   * nhưng không chọn được, và {@link ScalePanelViewModel.methodNotice} nói vì sao.
   */
  readonly isDisabled: boolean;
}

/** Ba bước của phương pháp "vẽ đường tham chiếu". */
export type ScaleReferenceStep = 'draw' | 'enterLength' | 'result';

/* -------------------------------------------------------------------------- */
/* Hình học trên khung ảnh — TỈ LỆ, không phải pixel.                          */
/* -------------------------------------------------------------------------- */

/**
 * Một điểm trên khung ảnh, theo tỷ lệ `0..1` của khung.
 *
 * Cùng lý lẽ `InputQualityRegion`: view chỉ nhân với kích thước đã render, nên
 * nó không cần biết ảnh gốc là 3000×3000 px và không phải quy đổi gì. Chiều đi
 * ngược lại cũng vậy — view báo vị trí con trỏ dưới dạng tỷ lệ, hook mới gắn
 * nhãn {@link Pixels}, vì view không import được `pixels()` (R-60).
 */
export interface ImageRatioPoint {
  readonly x: number;
  readonly y: number;
}

/** Hộp bao trên khung ảnh, theo tỷ lệ `0..1`. Dùng để bay khung nhìn tới. */
export interface ImageRatioBox {
  readonly min: ImageRatioPoint;
  readonly max: ImageRatioPoint;
}

/** Cờ phím bổ trợ đang giữ lúc kéo. `Shift` khoá đoạn theo trục. */
export interface ScalePointerModifiers {
  readonly isAxisLocked: boolean;
  /** Giữ `Alt`: tắt bắt dính (D1). */
  readonly isSnapDisabled?: boolean;
}

/** Hướng nhích một đầu đoạn bằng phím mũi tên. */
export type NudgeDirection = 'up' | 'down' | 'left' | 'right';

/**
 * Bước nhích: `'fine'` là một pixel (mũi tên), `'coarse'` là mười
 * (Shift + mũi tên).
 *
 * Tên chứ không phải số, vì view không được viết hằng số (R-71) — con số thật
 * nằm ở hook, một chỗ duy nhất.
 */
export type NudgeStep = 'fine' | 'coarse';

/* -------------------------------------------------------------------------- */
/* Phương pháp 1 — chuỗi kích thước OCR đọc được.                              */
/* -------------------------------------------------------------------------- */

/**
 * Một chuỗi kích thước OCR đọc được, sẵn sàng để vẽ và để chọn.
 *
 * Mở rộng {@link ScaleMeasurement} của `src/domain/units/scale` chứ không khai
 * lại `id`/`pixelLength`/`realLength`: cùng một hàng này là thứ hook nạp thẳng
 * vào `inferScale()`, nên hai hình dạng phải là một.
 */
export interface DimensionStringRow extends ScaleMeasurement {
  /** Độ tin cậy của lần đọc, `0..1`. Cấp thẳng cho `ConfidenceMeter`. */
  readonly confidence: number;
  /**
   * `true` khi độ tin cậy dưới ngưỡng của dự án (N5; mặc định 0,70). View gạch
   * chéo hàng và tô mức cần chú ý — đây là nửa thứ hai của trạng thái `partial`.
   */
  readonly isLowConfidence: boolean;
  /** Hộp bao trên khung ảnh, để tô sáng và để bay khung nhìn tới (340 ms). */
  readonly boundingBox: ImageRatioBox;
  /** Giá trị chữ đều đã định dạng — ví dụ `"4.800"`. Không kèm đơn vị. */
  readonly valueLabel: string;
  /** Chiều dài pixel đo được, đã định dạng — ví dụ `"400 px"`. */
  readonly pixelLengthLabel: string;
  /**
   * Mức màu của hàng. `'attention'` khi {@link DimensionStringRow.isLowConfidence},
   * `'neutral'` còn lại. **Không bao giờ `'verified'`** — đây là đầu ra của AI,
   * và A5 dành xanh đã xác minh cho việc người duyệt làm.
   */
  readonly statusCode: ViewStatusCode;
}

/** Mọi thứ khối "từ chuỗi kích thước" cần. */
export interface ScaleDimensionMethodViewModel {
  readonly rows: readonly DimensionStringRow[];
  readonly selectedRowId: string | null;
  /** Câu giải thích khi không đọc được chuỗi nào. `null` khi có ít nhất một hàng. */
  readonly emptyNotice: string | null;
  /** Câu báo có bao nhiêu chuỗi tin cậy thấp. `null` khi không có hàng nào thấp. */
  readonly lowConfidenceNotice: string | null;
  /**
   * Vì sao `inferScale()` chưa cho phép áp tự động, khi nó chưa cho phép.
   * `null` khi suy ra được tỷ lệ. Lấy nguyên từ `ScaleInference`, không đặt lại tên.
   */
  readonly manualCalibrationReason: ManualCalibrationReason | null;
}

/* -------------------------------------------------------------------------- */
/* Phương pháp 2 — đường tham chiếu vẽ tay.                                    */
/* -------------------------------------------------------------------------- */

/** Đầu nào của đoạn đang được nói tới. */
export type ReferenceLineEndpoint = 'start' | 'end';

/**
 * Đoạn tham chiếu đang được vẽ hoặc đã vẽ xong.
 *
 * `null` ở {@link ScaleReferenceMethodViewModel.draft} nghĩa là chưa kéo lần nào.
 */
export interface ReferenceLineDraft {
  readonly start: ImageRatioPoint;
  readonly end: ImageRatioPoint;
  /** Chiều dài đoạn trên ảnh gốc. Gắn nhãn, nên không trộn được với mm. */
  readonly pixelLength: Pixels;
  /**
   * Loại điểm mà đầu đang kéo bắt được, theo bảng ưu tiên của
   * `src/domain/units/snap` (M-03). `null` khi không bắt vào đâu cả.
   */
  readonly snappedKind: SnapTargetKind | null;
  /** Đầu vừa bắt điểm. `null` khi {@link ReferenceLineDraft.snappedKind} là `null`. */
  readonly snappedEndpoint: ReferenceLineEndpoint | null;
  /** Đang giữ chuột kéo. Lúc này số pixel chạy theo thời gian thực (120 ms). */
  readonly isDragging: boolean;
  /** Đang giữ Shift, đoạn bị khoá theo trục ngang hoặc dọc. */
  readonly isAxisLocked: boolean;
}

/** Mọi thứ khối "vẽ đường tham chiếu" cần. */
export interface ScaleReferenceMethodViewModel {
  readonly draft: ReferenceLineDraft | null;
  /** Bước nào của ba bước đang mở. */
  readonly activeStep: ScaleReferenceStep;
  /**
   * Số pixel chữ đều hiện theo thời gian thực khi kéo — ví dụ `"400 px"`.
   * `null` khi chưa có đoạn nào.
   */
  readonly livePixelLengthLabel: string | null;
  /** Nội dung thô của ô "Chiều dài thật" — ô có kiểm soát, view không giữ state. */
  readonly realLengthText: string;
  /** Gợi ý sẵn trong ô — ví dụ `"4800"`. */
  readonly realLengthPlaceholder: string;
  /**
   * Chú giải lấy từ OCR — ví dụ `"OCR đọc được 4.800 ngay cạnh đoạn này"`.
   * `null` khi OCR không có gì để gợi.
   */
  readonly realLengthHint: string | null;
  /**
   * Lỗi nhập của ô — ví dụ khi gõ `"abc"` hay `"0"`. `null` khi ô trống hoặc giá trị
   * đọc được và lớn hơn 0. Có thì ô hiện lỗi thay cho gợi ý (BUG-342).
   */
  readonly realLengthError: string | null;
  /** Kết quả chữ đều lớn của bước 3 — ví dụ `"12 mm/px"`. `null` khi chưa đủ dữ liệu. */
  readonly resultLabel: string | null;
  /**
   * Gợi ý hiện **ngay khi gõ**, không đợi rời ô. `null` khi giá trị đang gõ hợp lý.
   * Đây là cùng một cảnh báo với {@link ScalePanelViewModel.warnings}, đặt cạnh ô
   * nhập để người dùng thấy hậu quả trước khi rời tay.
   */
  readonly inlineWarning: ScaleWarningNotice | null;
  /** D1: số máy đọc được (`dimension-strings`) làm chip; bấm một chip để đo theo số đó. */
  readonly chips?: readonly { readonly id: string; readonly label: string; readonly isSelected: boolean }[];
  /** D1: câu dưới khối chip — hướng dẫn kéo, hoặc "máy không đọc được số". */
  readonly chipNotice?: string | null;
  /** D1: "Đo được 322 px → 31,9 mm/px" ngay khi kéo. `null` khi chưa đủ hai vế. */
  readonly liveMeasureLine?: string | null;
  /** `false` khi chưa có đoạn nào để đo lại. Phím `R`. */
  readonly canRemeasure: boolean;
  /** UX41 U04: chưa có đoạn và đã có ảnh — nút/phím `N` đặt sẵn một đoạn để chỉnh bằng bàn phím. */
  readonly canPlaceSegment: boolean;
  /** Đoạn dài 0 px: vì sao "Áp dụng" tắt và làm gì tiếp (BUG-607). `null` khi đoạn đo được. */
  readonly tooShortNotice: string | null;
}

/* -------------------------------------------------------------------------- */
/* Cảnh báo — dữ liệu ở đây, câu tiếng Việt ở hook.                            */
/* -------------------------------------------------------------------------- */

/** Hai loại cảnh báo màn này biết dựng. */
export type ScaleWarningKind = 'implausible' | 'deviatesFromEstimate' | 'implausiblePlanSize';

/**
 * Cảnh báo dưới dạng DỮ LIỆU, không phải câu.
 *
 * Không chuỗi tiếng Việt nào nằm trong file này: câu được ghép ở hook (A15) và
 * đi kèm ở {@link ScaleWarningNotice.message}. Union phân biệt được theo `kind`
 * nên view chọn được cách trình bày mà không phải đọc chuỗi.
 */
export type ScaleWarning =
  | {
      readonly kind: 'implausible';
      /** Tỷ lệ đang xét, thứ sinh ra hậu quả vô lý. */
      readonly proposed: MillimetresPerPixel;
      /**
       * Độ dày tường suy ra từ tỷ lệ đó — con số làm câu cảnh báo có sức thuyết
       * phục (`"cho ra bức tường dày 3 mét"`), và cũng là con số dòng kiểm chứng
       * `'wallThickness'` đang hiện.
       */
      readonly impliedWallThickness: Millimetres;
    }
  | {
      readonly kind: 'deviatesFromEstimate';
      readonly proposed: MillimetresPerPixel;
      /** Ước tính của AI, tức `ScaleInference.suggestedMillimetresPerPixel`. */
      readonly estimated: MillimetresPerPixel;
      /** Chênh lệch tương đối so với ước tính, `0..1`. `0,15` là ngưỡng cảnh báo. */
      readonly relativeDifference: number;
    }
  | {
      /** UX41 U34: cỡ căn theo tỷ lệ này vô lý cho một căn hộ (quá to hoặc quá nhỏ). */
      readonly kind: 'implausiblePlanSize';
      readonly proposed: MillimetresPerPixel;
      readonly widthMm: number;
      readonly heightMm: number;
    };

/** Một cảnh báo đã có câu chữ và mức màu, sẵn sàng để vẽ. */
export interface ScaleWarningNotice {
  readonly warning: ScaleWarning;
  /** Câu tiếng Việt đã ghép sẵn ở hook. */
  readonly message: string;
  /**
   * `'attention'` cho cả hai loại. **Không bao giờ `'violation'`** — cảnh báo ở
   * màn này không chặn ai (xem đầu file), và `'verified'` thì A5 cấm.
   */
  readonly statusCode: ViewStatusCode;
}

/* -------------------------------------------------------------------------- */
/* Khối đối chiếu — ba phần, để không giấu được phép tính.                      */
/* -------------------------------------------------------------------------- */

/**
 * `"4.800 mm ÷ 400 px = 12 mm/px"`, tách làm ba mảnh.
 *
 * Ba trường thay vì một câu đã ghép là cố ý: view phải đặt cả ba xuống, nên
 * không có cách nào rút gọn khối này thành mỗi kết quả.
 */
export interface ScaleComputationViewModel {
  /** Tử số đã định dạng, kèm đơn vị — ví dụ `"4.800 mm"`. */
  readonly numeratorLabel: string;
  /** Mẫu số đã định dạng, kèm đơn vị — ví dụ `"400 px"`. */
  readonly denominatorLabel: string;
  /** Kết quả đã định dạng — ví dụ `"12 mm/px"`. */
  readonly resultLabel: string;
  /**
   * `false` khi còn thiếu một vế (đã kéo đoạn nhưng chưa nhập chiều dài — đúng
   * nửa thứ nhất của trạng thái `partial`). Lúc đó vế thiếu vẫn có chỗ đứng:
   * hook đặt vào một chỗ trống đọc được, và view **vẫn vẽ đủ ba phần**.
   */
  readonly isComplete: boolean;
}

/* -------------------------------------------------------------------------- */
/* Ba dòng kiểm chứng.                                                         */
/* -------------------------------------------------------------------------- */

/**
 * Ba đại lượng dẫn xuất từ tỷ lệ, đủ để một kỹ sư liếc qua là biết đúng hay sai.
 *
 * `'wallThickness'` là dòng nối thẳng với cảnh báo `'implausible'`: nếu tỷ lệ
 * cho ra bức tường dày ba mét thì chính dòng này hiện con số đó.
 */
export type ScaleCrossCheckId = 'wallThickness' | 'doorWidth' | 'largestRoomArea';

/** Một dòng kiểm chứng. Mọi con số đã thành chuỗi ở hook (A15). */
export interface ScaleCrossCheckRow {
  readonly id: ScaleCrossCheckId;
  /** Nhãn tiếng Việt kiểu câu, viết hoa chữ đầu (A6) — ví dụ `"Độ dày tường điển hình"`. */
  readonly label: string;
  /** Giá trị đã định dạng, kèm đơn vị — ví dụ `"220 mm"`, `"24,80 m²"`. */
  readonly valueLabel: string;
  /** Khoảng hợp lý đã định dạng — ví dụ `"khoảng hợp lý 80 – 400 mm"`. */
  readonly expectedRangeLabel: string;
  /**
   * `'attention'` khi giá trị nằm ngoài khoảng hợp lý, `'neutral'` khi trong.
   * **Không bao giờ `'verified'`** — đây là phép đo máy tính ra, không ai duyệt (A5).
   */
  readonly statusCode: ViewStatusCode;
  /** Câu cảnh báo khi giá trị bất thường (D1: cửa đi ngoài 700–1 000 mm). */
  readonly warning?: string;
}

/* -------------------------------------------------------------------------- */
/* Phạm vi áp tỷ lệ.                                                           */
/* -------------------------------------------------------------------------- */

/** Áp cho mọi tầng, hay riêng tầng đang mở. */
export type ScaleApplyScope = 'allFloors' | 'thisFloor';

/** Một lựa chọn phạm vi, đã có nhãn tiếng Việt. */
export interface ScaleApplyScopeOption {
  readonly value: ScaleApplyScope;
  readonly label: string;
}

/* -------------------------------------------------------------------------- */
/* Phím tắt.                                                                   */
/* -------------------------------------------------------------------------- */

/**
 * Một dòng nhắc phím tắt.
 *
 * Phím tắt thật đăng ký qua `src/lib/input/shortcutRegistry` ở hook (R-54);
 * đây chỉ là chữ để đọc.
 */
export interface ScaleShortcutHint {
  readonly id: string;
  /**
   * Tổ hợp đã định dạng bởi `formatCombo` — ví dụ `"Shift + ←"`. Chữ hoa ở tên
   * phím là ngoại lệ được A6 cho phép.
   */
  readonly comboLabel: string;
  /** Việc phím đó làm, kiểu câu viết hoa chữ đầu (A6) — ví dụ `"Huỷ đoạn đang kéo"`. */
  readonly description: string;
}

/* -------------------------------------------------------------------------- */
/* Canvas giữa.                                                                */
/* -------------------------------------------------------------------------- */

/**
 * Mọi thứ canvas vẽ.
 *
 * `viewport` là `ViewportState` của `hooks/useCanvasViewport` chứ không phải một
 * hình dạng thứ hai: hook lái thu phóng bằng đúng hook đó (R-61), và view chỉ
 * đặt nó vào `transform`. Khung nhìn bay tới một chuỗi kích thước là một lần
 * `viewport` đổi giá trị — canvas chuyển tiếp nó trong 340 ms
 * (`cssDurationMs('slow')`, không viết số).
 */
export interface ScaleCanvasViewModel {
  /** Ảnh bản vẽ đã nắn. `null` khi đang tải hoặc khi nắn thất bại. */
  readonly imageUrl: string | null;
  readonly altText: string;
  readonly viewport: ViewportState;
  /** Chuỗi kích thước OCR để tô `--data-dimension` lên ảnh. */
  readonly dimensionRows: readonly DimensionStringRow[];
  /** Hàng đang được rê chuột qua, ở panel hoặc trên chính canvas. */
  readonly highlightedRowId: string | null;
  readonly selectedRowId: string | null;
  /** Hộp vừa được bay tới. `null` khi chưa chọn hàng nào. */
  readonly focusBox: ImageRatioBox | null;
  readonly referenceLine: ReferenceLineDraft | null;
  /** Số pixel chữ đều vẽ cạnh đoạn khi đang kéo. `null` khi không kéo. */
  readonly liveLengthLabel: string | null;
  /** `false` khi vai không sửa được (mọi trạng thái, không riêng `forbidden`): xem được, kéo thì không. */
  readonly isInteractive: boolean;
  readonly isImageLoading: boolean;
  /** Mức thu phóng theo phần trăm cho `ZoomCluster` — số nguyên, hook làm tròn. */
  readonly zoomPercent: number;
  /** Vùng đang thấy trên bản đồ nhỏ, phần trăm khung ảnh (BUG-596). */
  readonly miniMapViewport: { readonly x: number; readonly y: number; readonly width: number; readonly height: number };
}

/* -------------------------------------------------------------------------- */
/* Panel phải.                                                                 */
/* -------------------------------------------------------------------------- */

/** Mọi thứ panel phải 344px vẽ, từ trên xuống đúng thứ tự đặc tả. */
export interface ScalePanelViewModel {
  /** Số chữ đều mono-lg của khối 1 — ví dụ `"12 mm/px"`. */
  readonly currentScaleLabel: string;
  /** Dòng dẫn xuất — ví dụ `"1 pixel = 12 mm · bản vẽ ở tỷ lệ khoảng 1:100"`. */
  readonly derivedLine: string;
  readonly method: ScaleCalibrationMethod;
  readonly methodOptions: readonly ScaleMethodOption[];
  /**
   * Câu giải thích vì sao một phương pháp bị khoá, hoặc vì sao phương pháp vẽ
   * tay được chọn sẵn. `null` khi cả hai phương pháp đều dùng được.
   */
  readonly methodNotice: string | null;
  readonly dimension: ScaleDimensionMethodViewModel;
  readonly reference: ScaleReferenceMethodViewModel;
  readonly computation: ScaleComputationViewModel;
  /** Đúng ba dòng, luôn đủ ba — thứ tự là thứ tự của {@link ScaleCrossCheckId}. */
  readonly crossChecks: readonly ScaleCrossCheckRow[];
  /** Rỗng khi không có gì đáng nói. Không bao giờ hạ {@link ScalePanelViewModel.canApply}. */
  readonly warnings: readonly ScaleWarningNotice[];
  readonly applyScope: ScaleApplyScope;
  readonly applyScopeOptions: readonly ScaleApplyScopeOption[];
  /**
   * `false` chỉ khi CHƯA CÓ TỶ LỆ để áp (chưa chọn hàng, chưa vẽ xong đoạn).
   * Cảnh báo không bao giờ hạ cờ này xuống.
   */
  readonly canApply: boolean;
  /** UX-02: nhãn nút khi đang đề xuất tỷ lệ máy đọc/đặt sẵn ("Xác nhận tỷ lệ máy đề xuất"); vắng thì nhãn thường. */
  readonly applyLabel?: string;
  /**
   * R9: số máy đề xuất chỉ ước lượng / chưa xác định — nút chính là "Đo một đoạn đã biết" (`onPlaceSegment`),
   * nút áp khoá (`canApply` false). `acceptLabel` = nút phụ nhận số máy qua hộp xác nhận; vắng khi nguồn mâu thuẫn.
   */
  readonly measureFirst?: { readonly label: string; readonly acceptLabel?: string };
  /**
   * Lượt áp hay hoàn tác gần nhất cần nói gì: không áp được và vì sao (B-V5-01), PUT
   * hỏng, báo cáo "áp mọi tầng", hay tỷ lệ cũ được đặt lại. Vắng khi không có gì để nói.
   */
  readonly applyBlockedNotice?: string;
  /** Lượt áp gần nhất đã lưu xong: vẽ nút "Xem mô hình 3D →" cạnh câu báo. */
  readonly canOpenViewer3d: boolean;
  readonly isApplying: boolean;
  /**
   * `true` khi vai không sửa được, ở MỌI trạng thái (BUG-601 — tầng lỗi/chưa bản vẽ trước đây vẫn
   * mời người xem bấm rồi nhận 403): nút "áp dụng tỷ lệ" và ô chọn phạm vi biến mất hẳn, không
   * phải mờ đi — cùng lý lẽ `InputQualityFooterModel.areActionsHidden`.
   */
  readonly areActionsHidden: boolean;
  /** Caption cảnh báo đổi tỷ lệ sẽ tính lại mọi kích thước dẫn xuất. */
  readonly recalculationCaption: string;
  /**
   * Badge của panel. `'verified'` **chỉ** ở trạng thái `'success'`, vì lúc đó
   * chính người dùng vừa bấm áp — đúng thứ A5 dành xanh đã xác minh cho.
   */
  readonly statusCode: ViewStatusCode;
  readonly shortcutHints: readonly ScaleShortcutHint[];
  /**
   * Tầng chưa có bản vẽ: khối phương pháp hiện nhưng mờ và không bấm được, như ở `forbidden` —
   * ô "Chiều dài thật" và "Đo lại" không còn mời một quy trình không chạy được (BUG-411).
   */
  readonly isMethodLocked: boolean;
  /** `false` khi chưa có tỷ lệ: nhãn "Chưa có" là chữ, không phải số — không dùng phông mono. */
  readonly isCurrentScaleKnown: boolean;
  /** Khối "Kiểm tra con số" + chip trạng thái (S-11) — một nguồn, sinh từ `buildScaleCheck`. */
  readonly scaleCheck?: ScaleCheckViewModel;
  /** UX-R2: tỷ lệ máy ước từ độ dày tường (N16 `suggestedScaleMmPerPx`). Vắng khi máy không ước hoặc tầng đã xác nhận. */
  readonly suggestion?: ScaleSuggestionViewModel;
  /** UX41 U01: ô nhập thẳng tỷ lệ "1:100". Chỉ có khi N16 mang `sourceDpi` và người dùng sửa được. */
  readonly ratioEntry?: ScaleRatioEntryViewModel;
  /** UX-R4 U11: ô "Theo diện tích căn (m²)". Có khi tầng đã có phòng hoặc tường để đo diện tích. */
  readonly areaEntry?: ScaleRatioEntryViewModel;
  /** D1: ô "Căn rộng × dài (mm)". Có khi tầng đã có tường để đo hộp bao. */
  readonly sizeEntry?: ScaleSizeEntryViewModel;
  /** D1: nút xác nhận xám — một dòng nói còn thiếu gì. */
  readonly applyMissingHint?: string;
  /** UX-R4 U06: ảnh chụp/JPG (không có DPI) — một câu nói vì sao ghi chú "TL 1/N" không dùng được. */
  readonly ratioPhotoNotice?: string;
}

/** Ô "Hoặc nhập tỷ lệ ghi trên bản vẽ: [1:100]". */
export interface ScaleRatioEntryViewModel {
  readonly label: string;
  readonly text: string;
  readonly placeholder: string;
  /** Câu lỗi khi chữ gõ không đọc được thành 1:N; `null` khi đúng hoặc trống. */
  readonly error: string | null;
  /** Dòng phụ dưới ô, ví dụ cỡ căn suy ra "Căn rộng ≈ 8,7 × 8,2 m, 1 px ≈ 12 mm." */
  readonly hint?: string;
}

/** D1: chữ người dùng gõ ở ô rộng × dài + hai lựa chọn. */
export interface FlatSizeEntryState {
  readonly widthText: string;
  readonly lengthText: string;
  /** "Đổi chiều": rộng ứng bề cao ảnh. */
  readonly isSwapped: boolean;
  /** `true` = tính từ mép ngoài tường (mặc định), `false` = theo tim tường. */
  readonly isOuter: boolean;
}

export interface ScaleSizeEntryViewModel extends FlatSizeEntryState {
  /** Câu lệch hai cạnh > 3 %; `null` khi ổn hoặc chưa đủ số. */
  readonly error: string | null;
}

/** Lời đề nghị "Máy ước lượng từ độ dày tường: 1 px ≈ X mm. [Dùng tỷ lệ này]". */
export interface ScaleSuggestionViewModel {
  readonly text: string;
  readonly actionLabel: string;
  /** Đã bấm "Dùng tỷ lệ này": tỷ lệ ấy đang là đề nghị chờ xác nhận. */
  readonly isActive: boolean;
}

/* -------------------------------------------------------------------------- */
/* Thanh trạng thái 32px — khớp đúng `StatusBarProps` của components/shell.     */
/* -------------------------------------------------------------------------- */

/**
 * Ba mục của `src/components/shell/StatusBar.tsx`, đã dựng sẵn.
 *
 * Tên trường khớp từng chữ với `StatusBarProps` để `ScaleCalibration.tsx` viết
 * được `<StatusBar {...model.statusBar} />` — không ánh xạ lại, không đặt tên
 * lần thứ hai cho cùng một thứ.
 */
export interface ScaleStatusBarViewModel {
  /** Toạ độ con trỏ trên ảnh gốc. Điểm cuối cùng biết được khi con trỏ rời canvas. */
  readonly x: Pixels;
  readonly y: Pixels;
  /** Tỷ lệ nguyên đồ — ví dụ `"1:100"`. */
  readonly scaleRatio: string;
  /** Mật độ — ví dụ `"12 mm/px"`. */
  readonly scaleDensity: string;
  /** Trạng thái tự lưu, A7 — ví dụ `"đã lưu lúc 14:32"`. */
  readonly saveText: string;
}

/* -------------------------------------------------------------------------- */
/* Toàn màn.                                                                   */
/* -------------------------------------------------------------------------- */

/**
 * Mọi thứ view vẽ.
 *
 * Bất biến đi kèm, cùng khuôn `InputQualityGateModel`:
 *
 * 1. `errorMessage !== null` ⟺ `state === 'error'`; `errorCode` chỉ có khi lỗi mang mã máy thật.
 * 2. `state === 'loading'` ⟺ `canvas.isImageLoading`.
 * 3. `state === 'empty'` ⟺ `panel.dimension.rows` rỗng; lúc đó
 *    `panel.method === 'referenceLine'` và mục `'dimensionString'` bị khoá.
 * 4. `state === 'partial'` ⟺ (`panel.computation.isComplete === false` khi đã có
 *    `panel.reference.draft`) HOẶC có ít nhất một hàng `isLowConfidence`.
 * 5. `state === 'forbidden'` ⟹ `canvas.isInteractive === false` ⟺
 *    `panel.areActionsHidden === true` (một chiều: vai không sửa được tắt chúng cả khi `error`
 *    đứng trước — BUG-601).
 * 6. `state === 'collapsed'` ⟹ `isPanelCollapsed === true` (một chiều: panel thu gọn được cả
 *    khi `error`/`forbidden` đứng trước — BUG-322).
 * 7. `state === 'success'` ⟺ `panel.statusCode === 'verified'`.
 */
export interface ScaleCalibrationViewModel {
  readonly state: ScaleCalibrationState;
  readonly canvas: ScaleCanvasViewModel;
  readonly panel: ScalePanelViewModel;
  readonly statusBar: ScaleStatusBarViewModel;
  /** Khung nhìn dưới 1024px — cùng mốc các màn đã dựng. Panel tự xếp bằng CSS `lg:`. */
  readonly isCompact: boolean;
  readonly isPanelCollapsed: boolean;
  /** Có thì bỏ chạy số và bỏ bay khung nhìn, đổi giá trị tức thì (mục B). */
  readonly prefersReducedMotion: boolean;
  /** Lỗi nắn ảnh. `null` ở mọi trạng thái khác `'error'`. */
  readonly errorMessage: string | null;
  /**
   * Mã máy đọc, giữ nguyên dạng (A6). Không bao giờ đứng một mình. `null` cả khi lỗi
   * không có mã máy thật (tầng chưa có bản vẽ, ảnh méo) — không in "UNKNOWN" (BUG-337).
   */
  readonly errorCode: string | null;
  /**
   * Tiêu đề của `'error'` khi lỗi là lượt ĐỌC hỏng, không phải ảnh méo. Vắng thì
   * view dùng tiêu đề "nắn ảnh thất bại" — chỉ đúng cho ảnh méo (B-V5-04).
   */
  readonly errorTitle?: string;
  /** Tầng chưa có bản vẽ (404 `upload`): lối ra là "Tải bản vẽ lên", không "Tải lại ảnh" (BUG-337). */
  readonly isNoDrawing?: boolean;
  /** Câu của trạng thái `'empty'`. `null` ở trạng thái khác. */
  readonly emptyNotice: string | null;
  /** Câu của trạng thái `'partial'`. `null` ở trạng thái khác. */
  readonly partialNotice: string | null;
  /** Câu của trạng thái `'forbidden'`. `null` ở trạng thái khác. */
  readonly forbiddenNotice: string | null;
  /** Câu của trạng thái `'success'`. `null` ở trạng thái khác. */
  readonly successNotice: string | null;
  /** Dải "tỷ lệ tạm" khi tầng `scaleStatus: 'unresolved'` (F-04x-2). Vắng khi tỷ lệ đã chốt. */
  readonly provisionalScaleNotice?: string;
  /** Dải đỏ khi máy không đo được tỷ lệ tầng (N16 `scaleSource: 'project_default'`, UX-R1 K12). Vắng khi khác. */
  readonly missingScaleNotice?: string;
  /** Hộp thoại A9 trước "Áp cho mọi tầng". Vắng khi không mở. */
  readonly allFloorsConfirm?: ScaleAllFloorsConfirm;
  /** R9: hộp xác nhận "Dùng tạm tỷ lệ máy ước lượng" đang mở (sai có thể tới ±40 %). */
  readonly acceptMachineConfirm?: {
    readonly title: string;
    readonly message: string;
    readonly confirmLabel: string;
    readonly cancelLabel: string;
  };
  /** Dải xung đột/khoá lưu của bộ lưu lớp chung, có "Tải lại" (BUG-598). Vắng khi tầng lưu được. */
  readonly saveBlock?: FloorLayerSaveBlock | null;
  /** Lượt đọc N16 404 (dự án/tầng không mở được) — cả màn thay bằng một lối ra (G45). */
  readonly readFailure?: FloorLayerReadFailure | null;
}

/** Câu của hộp thoại hỏi trước khi áp tỷ lệ cho mọi tầng có bản vẽ (A9). */
export interface ScaleAllFloorsConfirm {
  /** Ví dụ `"Áp tỷ lệ này cho 3 tầng có bản vẽ?"`. */
  readonly title: string;
  readonly message: string;
  readonly confirmLabel: string;
  readonly cancelLabel: string;
  /** UX-R2 K32: mỗi tầng một dòng "ch-01: 1 → 13,9 mm/px", để thấy tầng nào sẽ đổi. */
  readonly changes?: readonly string[];
}

/* -------------------------------------------------------------------------- */
/* Hành động.                                                                  */
/* -------------------------------------------------------------------------- */

/**
 * Mọi hàm view gọi. Không hàm nào trả về gì: view bắn sự kiện, hook quyết định.
 *
 * Mọi toạ độ đi VÀO đây là {@link ImageRatioPoint} (tỷ lệ `0..1` của khung ảnh),
 * không phải pixel — xem ghi chú R-60 ở đầu file.
 */
export interface ScaleCalibrationActions {
  /* -- Cách xác định ------------------------------------------------------- */
  readonly onChangeMethod: (method: ScaleCalibrationMethod) => void;

  /* -- Phương pháp 1: chuỗi kích thước ------------------------------------- */
  /** Chọn một hàng: tính ngay, bay khung nhìn tới hộp bao 340 ms, tô sáng. */
  readonly onSelectDimensionRow: (rowId: string) => void;
  /** Rê chuột qua một hàng ở panel hoặc một chuỗi trên canvas. `null` khi rời. */
  readonly onHoverDimensionRow: (rowId: string | null) => void;

  /* -- Phương pháp 2: đoạn tham chiếu -------------------------------------- */
  /**
   * Nhấn chuột trên canvas: đoạn mới từ `point`. Có `endpoint` (nhấn lên tay cầm) thì kéo ĐÚNG đầu
   * đó, đầu kia đứng yên (BUG-587).
   */
  readonly onStartDrag: (point: ImageRatioPoint, endpoint?: ReferenceLineEndpoint) => void;
  /** Mỗi lần con trỏ dịch khi đang kéo. Số pixel và tỷ lệ chạy số 120 ms. */
  readonly onMoveDrag: (point: ImageRatioPoint, modifiers: ScalePointerModifiers) => void;
  readonly onEndDrag: (point: ImageRatioPoint) => void;
  /** Phím `Esc`, hoặc con trỏ rời canvas giữa chừng. */
  readonly onCancelDrag: () => void;
  /** Phím mũi tên (`'fine'`) và Shift + mũi tên (`'coarse'`). */
  readonly onNudgeEndpoint: (
    endpoint: ReferenceLineEndpoint,
    direction: NudgeDirection,
    step: NudgeStep,
  ) => void;
  /** Mỗi lần gõ vào ô "Chiều dài thật". Gợi ý vô lý hiện NGAY, không đợi rời ô. */
  readonly onChangeRealLength: (text: string) => void;
  /** Phím `Enter` trong ô "Chiều dài thật". */
  readonly onConfirmRealLength: () => void;
  /** D1: bấm chip số — phóng tới số, bật đo, điền sẵn "Chiều dài thật". */
  readonly onPickDimensionChip?: (chipId: string) => void;
  /** Phím `R` — xoá đoạn hiện tại và kéo lại từ đầu. */
  readonly onRemeasure: () => void;
  /** Phím `N` / nút "Đặt đoạn đo giữa bản vẽ": đoạn ngang giữa ảnh để chỉnh bằng bàn phím (UX41 U04). */
  readonly onPlaceSegment: () => void;

  /* -- Canvas -------------------------------------------------------------- */
  /**
   * Kéo nền canvas. `dx`/`dy` là độ dịch của con trỏ trên màn, view đọc thẳng từ
   * sự kiện — hook mới quy nó về hệ ảnh.
   */
  readonly onPan: (dx: number, dy: number) => void;
  /** Lăn chuột hoặc nút thu phóng. `focus` là điểm neo, `null` thì neo vào tâm. */
  readonly onZoom: (nextZoom: number, focus: ImageRatioPoint | null) => void;
  /** Ba nút của `ZoomCluster` và phím `F` (BUG-596). Neo vào tâm khung. */
  readonly onZoomIn: () => void;
  readonly onZoomOut: () => void;
  /** Về toàn cảnh — cả bản vẽ vừa khung. */
  readonly onFitView: () => void;
  /** Bấm/kéo trên bản đồ nhỏ: khung nhìn đi theo vùng đó. */
  readonly onMiniMapViewportChange: (rect: ScaleCanvasViewModel['miniMapViewport']) => void;
  /** Con trỏ dịch trên canvas, để thanh trạng thái đổi toạ độ. `null` khi rời canvas. */
  readonly onMoveCursor: (point: ImageRatioPoint | null) => void;
  /**
   * Kích thước canvas ĐÃ RENDER, tính bằng pixel CSS.
   *
   * Thêm sau khi file đóng băng, bằng một ngoại lệ hẹp điều phối viên cấp
   * thành văn bản, và CHỈ THÊM — không kiểu nào đã có bị đổi.
   *
   * Vì sao phải có: bay khung nhìn (R-07) chạy qua `flyToBounds` của
   * `hooks/useCanvasViewport`, và hàm đó nhận bề rộng/bề cao canvas bằng pixel
   * để tính ra `ViewportState`. `ScaleCalibrationCanvas` đã đo sẵn kích thước
   * đó bằng `ResizeObserver` nhưng giữ riêng cho mình; không có đường này thì
   * hook chỉ đoán được, và một `viewport.x` sai đơn vị dịch khung nhìn chưa tới
   * một pixel — R-07 hỏng âm thầm chứ không kêu.
   *
   * View gọi mỗi lần kích thước đổi, kể cả lần đo đầu tiên.
   */
  readonly onCanvasSizeChange: (widthPx: number, heightPx: number) => void;

  /* -- Chân panel ---------------------------------------------------------- */
  /** Áp tỷ lệ. Sinh toast có Hoàn tác (A8) và cho nhãn kích thước chạy số 260 ms. */
  readonly onApply: () => void;
  readonly onChangeApplyScope: (scope: ScaleApplyScope) => void;
  /** UX-R2: lấy tỷ lệ máy ước từ độ dày tường làm đề nghị (chưa lưu, vẫn phải bấm Xác nhận tỷ lệ). */
  readonly onUseSuggestedScale: () => void;
  /** UX41 U01: gõ tỷ lệ ghi trên bản vẽ ("1:100"); tuỳ chọn để các bộ mẫu cũ khỏi phải khai. */
  readonly onChangeDrawingRatio?: (text: string) => void;
  /** UX-R4 U11: gõ diện tích căn (m²) để suy tỷ lệ; tuỳ chọn như `onChangeDrawingRatio`. */
  readonly onChangeFlatArea?: (text: string) => void;
  /** D1: sửa ô rộng × dài căn. */
  readonly onChangeFlatSize?: (patch: Partial<FlatSizeEntryState>) => void;
  /** UX-R4 U06: phóng khung nhìn tới số kích thước đang chọn (hoặc số đầu). */
  readonly onZoomToNumbers?: () => void;
  /** Đồng ý ở hộp thoại A9: gửi tỷ lệ cho từng tầng có bản vẽ, nối tiếp. */
  readonly onConfirmAllFloors: () => void;
  /** R9: mở / đồng ý / huỷ hộp xác nhận nhận số máy ước lượng; tuỳ chọn để bộ mẫu cũ khỏi khai. */
  readonly onRequestAcceptMachine?: () => void;
  readonly onConfirmAcceptMachine?: () => void;
  readonly onCancelAcceptMachine?: () => void;
  /** Huỷ hộp thoại A9: không gửi gì, màn giữ trạng thái trước. */
  readonly onCancelAllFloors: () => void;

  /* -- Vỏ màn -------------------------------------------------------------- */
  readonly onToggleCollapsed: () => void;
  /** Liên kết quay lại bước tiền xử lý, ở trạng thái `'error'`. */
  readonly onGoToPreprocessing: () => void;
  /** Tải lại ảnh sau khi nắn thất bại. */
  readonly onRetry: () => void;
  /** Tới màn Tải bản vẽ — lối ra của tầng chưa có bản vẽ (BUG-337). */
  readonly onGoToUpload: () => void;
  /** Tới màn 3D toàn màn của dự án — bước kế sau khi áp tỷ lệ xong. */
  readonly onGoToViewer3d: () => void;
}

/* -------------------------------------------------------------------------- */
/* Props của view và ba phần con.                                              */
/* -------------------------------------------------------------------------- */

/** Mọi prop `ScaleCalibration.tsx` nhận — mô hình cộng hành động (mục D). */
export interface ScaleCalibrationProps {
  readonly model: ScaleCalibrationViewModel;
  readonly actions: ScaleCalibrationActions;
  /** Đầu chung Dự án › Tầng › Lớp + thanh lớp (N2-04, G4b-29). Chỉ route thật truyền (cần Router). */
  readonly floorNav?: Omit<QcFloorNavProps, 'layer'> | undefined;
}

/** Props của `ScaleCalibrationCanvas` — canvas giữa, bo 16, thụt 12. */
export interface ScaleCalibrationCanvasProps {
  readonly canvas: ScaleCanvasViewModel;
  readonly prefersReducedMotion: boolean;
  readonly actions: Pick<
    ScaleCalibrationActions,
    | 'onCancelDrag'
    | 'onEndDrag'
    | 'onFitView'
    | 'onHoverDimensionRow'
    | 'onMiniMapViewportChange'
    | 'onMoveCursor'
    | 'onMoveDrag'
    | 'onNudgeEndpoint'
    | 'onPan'
    | 'onSelectDimensionRow'
    | 'onStartDrag'
    | 'onZoom'
    | 'onZoomIn'
    | 'onZoomOut'
  >;
}

/** Props của `ScaleCalibrationPanel` — panel phải 344px, dưới 1024px xếp dưới bản vẽ. */
export interface ScaleCalibrationPanelProps {
  readonly panel: ScalePanelViewModel;
  /** Nút "Áp dụng tỷ lệ" — hộp thoại A9 trả tiêu điểm về đây khi đóng (G57). */
  readonly applyButtonRef?: RefObject<HTMLButtonElement | null>;
  readonly state: ScaleCalibrationState;
  readonly isCollapsed: boolean;
  readonly prefersReducedMotion: boolean;
  readonly actions: Pick<
    ScaleCalibrationActions,
    | 'onApply'
    | 'onChangeApplyScope'
    | 'onChangeMethod'
    | 'onChangeRealLength'
    | 'onConfirmRealLength'
    | 'onGoToViewer3d'
    | 'onHoverDimensionRow'
    | 'onNudgeEndpoint'
    | 'onPickDimensionChip'
    | 'onPlaceSegment'
    | 'onRemeasure'
    | 'onRequestAcceptMachine'
    | 'onSelectDimensionRow'
    | 'onToggleCollapsed'
    | 'onUseSuggestedScale'
    | 'onChangeDrawingRatio'
    | 'onChangeFlatArea'
    | 'onChangeFlatSize'
    | 'onZoomToNumbers'
  >;
}

/** Props của `ScaleCalibrationMethodDimension` — khối "từ chuỗi kích thước". */
export interface ScaleCalibrationMethodDimensionProps {
  readonly dimension: ScaleDimensionMethodViewModel;
  readonly actions: Pick<ScaleCalibrationActions, 'onHoverDimensionRow' | 'onSelectDimensionRow' | 'onZoomToNumbers'>;
}

/** Props của `ScaleCalibrationMethodReference` — khối "vẽ đường tham chiếu", ba bước. */
export interface ScaleCalibrationMethodReferenceProps {
  readonly reference: ScaleReferenceMethodViewModel;
  readonly actions: Pick<
    ScaleCalibrationActions,
    | 'onChangeRealLength'
    | 'onConfirmRealLength'
    | 'onNudgeEndpoint'
    | 'onPickDimensionChip'
    | 'onPlaceSegment'
    | 'onRemeasure'
  >;
}

/* -------------------------------------------------------------------------- */
/* Hook.                                                                       */
/* -------------------------------------------------------------------------- */

/**
 * Tham số của `useScaleCalibration`.
 *
 * Cổng dữ liệu **không** nằm ở đây, vì `scaleCalibrationGateway.ts` chưa tồn tại
 * lúc file này đóng băng và types.ts không được import ngược lên nó. Người viết
 * hook MỞ RỘNG kiểu này trong file của mình thay vì sửa file này:
 *
 * ```ts
 * interface UseScaleCalibrationHookOptions extends UseScaleCalibrationOptions {
 *   readonly gateway?: ScaleCalibrationGateway;
 * }
 * ```
 *
 * Đó là cách hợp lệ duy nhất để thêm tham số, và nó giữ cho container gọi được
 * hook chỉ với `projectId` + `floorId` (R-73).
 */
export interface UseScaleCalibrationOptions {
  readonly projectId: string;
  readonly floorId: string;
  /** Vai trò của người đang xem. Không có quyền sửa thì màn ở `'forbidden'`. */
  readonly roles?: readonly ProjectRole[];
  /** Điều hướng ra khỏi màn — quay lại bước tiền xử lý, sang màn kế. */
  readonly onNavigate?: (path: string) => void;
  /** Ép panel thu gọn — cho story và test muốn một câu trả lời cố định. */
  readonly forceCollapsed?: boolean;
}

/**
 * Kiểu trả về của `useScaleCalibration`.
 *
 * Ngoài đúng bộ props view cần, hook trả thêm hai thứ **container** dùng chứ
 * view không dùng:
 *
 * - `appliedScale` là `Scale` thật của `src/domain/units/scale` — có sẵn hai
 *   phép đổi `pixelsToMillimetres` / `millimetresToPixels`, nên màn sau nhận nó
 *   là dùng được ngay, không phải dựng lại từ một con số (R-73).
 * - `aiInference` là kết quả `inferScale()` thô, tức chuẩn mà cảnh báo lệch 15%
 *   đối chiếu vào. Story và test cắm thẳng vào đây để dựng nhánh cảnh báo.
 */
export interface UseScaleCalibrationResult extends ScaleCalibrationProps {
  /** `null` cho tới khi người dùng bấm áp. */
  readonly appliedScale: Scale | null;
  /** `null` khi OCR không đọc được chuỗi kích thước nào. */
  readonly aiInference: ScaleInference | null;
}
