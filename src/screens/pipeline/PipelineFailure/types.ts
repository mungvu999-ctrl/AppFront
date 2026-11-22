/**
 * Hợp đồng props của màn S-11 "Một bước AI hỏng" (`PipelineFailure`).
 *
 * Màn này **không có route riêng**. Nó dựng NGAY TRONG khung của màn S-10
 * `ProcessingScreen`: một dải nội dung thay chỗ dải cảnh báo, không đổi trang,
 * không chiếm toàn màn, không hộp thoại. Vì vậy hợp đồng dưới đây phải đủ để một
 * màn cha mở nó bằng một dòng mà không viết thêm một mẩu logic nào (R-73) — xem
 * {@link PipelineFailureContainerProps} ở cuối file.
 *
 * Đây là NỀN MÓNG (lớp L1): file này là API công khai DUY NHẤT giữa người viết
 * hook (`usePipelineFailure.ts`), người viết view (`PipelineFailure.tsx`) và người
 * viết cổng dữ liệu (`pipelineFailureGateway.ts`). Ba worker lớp sau viết DỰA VÀO
 * đúng những gì khai ở đây. Không ai được tự thêm, bớt hay đổi hình dạng một
 * trường — xem mục "KHOÁ SAU KHI XONG" ở cuối file.
 *
 * File này CHỈ kiểu: không logic, không hằng số, không JSX, không import React,
 * không import `src/api`, `src/store`, `src/domain` hay `src/lib/http` (mục 0.4,
 * R-60).
 *
 * ## A15 — mọi con số đã định dạng xong ở hook
 *
 * Mọi chuỗi người đọc dưới đây là tiếng Việt CÓ DẤU và **đã ghép câu xong**: "21
 * đối tượng", "Lần thử 2", "SEG-2041 · yêu cầu 8f2a-41". View không `toFixed`,
 * không `toLocaleString`, không tự đếm, không tự ghép số vào câu. Không một
 * trường số thô nào tồn tại trong hợp đồng này — kể cả bộ đếm lần thử, vốn đi ra
 * dưới dạng {@link PipelineFailureRetryNotice} đã chọn sẵn chế độ.
 *
 * ## A6 — nhãn viết thường kiểu câu
 *
 * Ngoại lệ chữ hoa duy nhất ở màn này là mã lỗi và mã yêu cầu
 * ({@link PipelineFailureReasonViewModel.codeLabel}), thứ phải giữ nguyên dạng máy
 * đọc để người dùng chép sang phiếu hỗ trợ.
 *
 * ## Bảy trạng thái (A11)
 *
 * {@link PipelineFailureState} là một UNION PHẲNG bảy chuỗi, tên lấy NGUYÊN VĂN từ
 * `SEVEN_STATES` (`src/lib/testing/sevenStateScenarios.ts`) — kể cả `'success'`,
 * không đổi thành một từ khác. Không nhánh thứ tám.
 *
 * Theo khuôn `CadBranchConfirm/types.ts`: `null` là cách một trường nói "không áp
 * dụng ở trạng thái này", KHÔNG phải trường biến mất khỏi kiểu. Hai trường duy
 * nhất được `null` là {@link PipelineFailureProps.technicalDetails} và
 * {@link PipelineFailureAlertBand.nextSteps}, và chỉ ở `forbidden`.
 *
 * ## Vì sao có {@link PipelineFailureBand} thay vì bốn cờ boolean
 *
 * Đặc tả nói: khi người dùng bấm thử lại, dải cảnh báo **được thay TẠI CHỖ** bằng
 * `PipelineStepper`; khi thử lại thành công, dải đó **hoà tan** thành một toast đã
 * duyệt rồi màn cha chuyển tiếp. Ba hình dạng ấy loại trừ nhau: cùng một ô trên
 * màn, ba nội dung khác nhau. Một union có thẻ phân biệt nói đúng điều đó, và
 * khiến view KHÔNG thể vẽ nhầm hai thứ chồng nhau — điều mà ba cờ boolean rời rạc
 * cho phép xảy ra. Hình dạng thứ tư (`'idle'`) tồn tại cho trạng thái `empty`.
 *
 * ## Vì sao dải tầng và khối "Kết quả đã có" nằm NGOÀI band
 *
 * Chúng mô tả LƯỢT XỬ LÝ, không mô tả cái ô đang báo lỗi. Người dùng bấm thử lại
 * thì dải cảnh báo đổi thành stepper, nhưng bốn tầng và những kết quả đã giữ vẫn
 * đứng nguyên tại chỗ — đúng lời hứa "không xoá tiến độ đã có". Cho chúng vào
 * band nghĩa là view phải nhắc lại chúng ở cả bốn nhánh, và một nhánh quên là
 * người dùng thấy tiến độ biến mất.
 *
 * ## A5 — chấm xanh "đã xác minh" KHÔNG được dùng ở khối "Kết quả đã có"
 *
 * Đặc tả gốc gọi mỗi dòng kết quả là "một chấm đã duyệt". Ở nhà này, xanh "đã xác
 * minh" **chỉ** đánh dấu việc người duyệt; đầu ra của AI không bao giờ được đặt nó
 * (A5, `lib/viewmodel/types.ts:18`). "Tiền xử lý ảnh — xong" và "Nhận diện cửa và
 * nội thất — 21 đối tượng" là đầu ra AI chưa ai duyệt. Nên
 * {@link PipelineFailureKeptItem} cố ý KHÔNG mang trường trạng thái/màu nào: nó chỉ
 * là một dòng đã xong, view vẽ chấm trung tính. Đây là chỗ luật nhà thắng chữ
 * trong đặc tả, cùng loại phán quyết với 240ms → 260ms.
 *
 * ## Thời lượng chuyển động — trỏ token, không viết số
 *
 * Đặc tả gốc ghi 240ms; mục B chỉ cho 120/180/260/340/700ms. Điều phối viên chốt
 * **260ms**, tức slot `'standard'` của `MOTION_DURATIONS_MS`. Hợp đồng khai nó
 * bằng {@link MotionDurationName} ({@link PipelineFailureProps.motionDurationName}),
 * không bằng con số — nên R-71 không có gì để bắt và view lấy mili-giây qua
 * `durationMs(name, { reducedMotion })` chứ không tự viết `240`.
 *
 * ## R-65 — hợp đồng không mang đường dẫn
 *
 * Nút "Tải lại bản vẽ" đi ra dưới dạng {@link PipelineFailureUploadLink}
 * với một hàm `onOpen`, không phải một chuỗi `href`. Chuỗi đường dẫn là việc của
 * bảng đường dẫn trong hook; không chuỗi nào trong file này bắt đầu bằng `/` hay
 * `http`.
 *
 * ## Hai kiểu mượn từ nơi khác, cố ý không dựng lại
 *
 * - {@link PipelineStepData} (`@/components/feedback/PipelineStepper`) là đúng hình
 *   dạng `PipelineStepper` nhận. Dựng một kiểu bước thứ hai ở đây nghĩa là view
 *   phải ánh xạ qua lại mỗi lần vẽ, và hai kiểu sẽ trôi khỏi nhau.
 * - {@link ProcessingStageStatus} (`ProcessingScreen/types.ts`, đã KHOÁ) là bốn
 *   trạng thái một tầng có thể ở. Màn này dựng TRONG khung S-10 và tô dải tầng
 *   bằng cùng bảng màu, nên nó phải đọc cùng một enum — không phải bản sao thứ hai
 *   có nguy cơ lệch.
 */

import type { PipelineStepData } from '@/components/feedback/PipelineStepper';
import type { MotionDurationName } from '@/lib/motion';
import type { ProcessingStageStatus } from '@/screens/pipeline/ProcessingScreen/types';

/* -------------------------------------------------------------------------- */
/* Bảy trạng thái (A11).                                                       */
/* -------------------------------------------------------------------------- */

/**
 * Đúng bảy trạng thái của A11, tên lấy nguyên từ `SEVEN_STATES`.
 *
 * Ý nghĩa của từng nhánh trên màn này:
 *
 * | Trạng thái  | Nghĩa ở màn Một bước AI hỏng                                              |
 * |-------------|---------------------------------------------------------------------------|
 * | `empty`     | không xảy ra ngoài đời — chưa bước nào hỏng thì màn này không được gắn.    |
 * |             | Chỉ tồn tại để story và `expectSevenStates` có một nhánh để dựng; band là  |
 * |             | {@link PipelineFailureIdleBand}                                            |
 * | `loading`   | đang thử lại NGAY TẠI CHỖ; band là {@link PipelineFailureRetryingBand}     |
 * | `partial`   | **TRẠNG THÁI CHÍNH** — một tầng lỗi, ba tầng xong; khối "Kết quả đã có" là |
 * |             | {@link PipelineFailureKeptWorkList}                                        |
 * | `error`     | cả bốn tầng lỗi; khối kết quả rút thành {@link PipelineFailureKeptWorkLine}|
 * |             | và hành động chính đổi sang tải lại ảnh                                     |
 * | `success`   | thử lại xong; band là {@link PipelineFailureResolvedBand} rồi màn cha nhận |
 * |             | `onResolved`                                                              |
 * | `forbidden` | ẩn ba hướng đi tiếp (`nextSteps` là `null`) và ẩn hẳn nhật ký kỹ thuật     |
 * |             | (`technicalDetails` là `null`)                                            |
 * | `collapsed` | thu gọn — chỉ còn câu tóm tắt và nút mở lại                                |
 */
export type PipelineFailureState =
  | 'empty'
  | 'loading'
  | 'partial'
  | 'error'
  | 'success'
  | 'forbidden'
  | 'collapsed';

/* -------------------------------------------------------------------------- */
/* Nút sao chép — nhãn ĐÃ TÍNH SẴN, view không đếm giờ.                        */
/* -------------------------------------------------------------------------- */

/**
 * Một nút sao chép, dùng ở ba chỗ: mã lỗi, nhật ký kỹ thuật, và "chép toàn bộ
 * nhật ký" khi đã thất bại quá số lần.
 *
 * `label` là nhãn ĐANG hiện — hook đổi nó thành "Đã sao chép" một khoảng ngắn rồi
 * trả về "Sao chép". View KHÔNG đặt `setTimeout`, không giữ state, không tự biết
 * khoảng ngắn đó dài bao nhiêu; nó chỉ vẽ chuỗi nó nhận được. `isCopied` đi kèm để
 * view đổi biểu tượng/ngữ điệu mà không phải so sánh chuỗi nhãn với một hằng số.
 */
export interface PipelineFailureCopyAction {
  /** Nhãn đang hiện — "Sao chép" hoặc "Đã sao chép". Hook quyết, view chỉ vẽ. */
  readonly label: string;
  /** Nhãn cho trình đọc màn hình, nói rõ chép cái gì — ví dụ "Sao chép mã lỗi". */
  readonly ariaLabel: string;
  /** `true` trong đúng khoảng vừa chép xong. Nguồn duy nhất là hook. */
  readonly isCopied: boolean;
  readonly onCopy: () => void;
}

/* -------------------------------------------------------------------------- */
/* Khối lỗi — ba trường riêng biệt, ĐÚNG THỨ TỰ NÀY.                            */
/* -------------------------------------------------------------------------- */

/**
 * Ba dòng của khối lỗi, khai thành ba trường riêng vì chúng nói ba việc khác nhau
 * và có ba mức chữ khác nhau trên màn. Gộp thành một chuỗi thì view không còn cách
 * nào cho mã lỗi nhỏ lại và căn phải.
 *
 * Không câu nào ở đây được trách người dùng (mục CẤM TUYỆT ĐỐI): chủ ngữ là bản vẽ
 * và mô hình, không phải người đưa bản vẽ lên.
 */
export interface PipelineFailureReasonViewModel {
  /**
   * Câu dễ hiểu, đứng đầu, cỡ chữ lớn nhất của khối — ví dụ "Không nhận diện được
   * lớp tường ở Tầng 03.".
   */
  readonly summarySentence: string;
  /**
   * ĐÚNG MỘT dòng nguyên nhân cụ thể — ví dụ "Bản vẽ có nét quá mảnh và nhiều vết
   * nhiễu, mô hình không tách được tường khỏi nội thất.". Vết lỗi kỹ thuật dài
   * KHÔNG đi qua đây; nó nằm trong {@link PipelineFailureTechnicalDetails}, sau một
   * khối gấp.
   */
  readonly causeSentence: string;
  /**
   * Mã lỗi và mã yêu cầu, ĐÃ GHÉP SẴN — ví dụ "SEG-2041 · yêu cầu 8f2a-41". Chữ
   * đều, nhỏ, căn phải dưới. Giữ nguyên dạng máy đọc: đây là ngoại lệ chữ hoa của
   * A6. Luôn có mặt (mục CẤM TUYỆT ĐỐI: "mã lỗi có mặt nhưng phải nhỏ"), không bao
   * giờ rỗng.
   */
  readonly codeLabel: string;
  /** Nút sao chép đứng cạnh {@link PipelineFailureReasonViewModel.codeLabel}. */
  readonly copyCode: PipelineFailureCopyAction;
}

/* -------------------------------------------------------------------------- */
/* Ba hướng đi tiếp.                                                           */
/* -------------------------------------------------------------------------- */

/**
 * Định danh ba hướng đi tiếp. Có định danh thay vì chỉ có nhãn để test và telemetry
 * bám vào một chuỗi ổn định thay vì bám vào câu tiếng Việt — câu tiếng Việt được
 * phép sửa lại cho hay hơn mà không làm hỏng gì.
 */
export type PipelineFailureNextStepId = 'retry-lower-threshold' | 'upload-clearer' | 'skip-floor' | 'back-to-projects';

/** Một hướng đi tiếp — đúng một câu, một hàm xử lý, và có thể một câu cảnh báo. */
export interface PipelineFailureNextStep {
  readonly id: PipelineFailureNextStepId;
  /** Đúng một câu, viết thường kiểu câu — ví dụ "Thử lại với ngưỡng thấp hơn". */
  readonly label: string;
  /**
   * Câu cảnh báo đi kèm hướng này — ví dụ hướng "Bỏ qua tầng đó" nói rõ mô hình sẽ
   * thiếu một tầng. `null` khi hướng này không đánh đổi gì.
   */
  readonly warningSentence: string | null;
  /**
   * Hướng được nhấn mạnh. ĐÚNG MỘT phần tử của danh sách mang `true`. Ở `error`,
   * `true` chuyển sang hướng tải lại ảnh — đó là toàn bộ cách "hành động chính đổi
   * thành tải lại ảnh" được diễn đạt, không cần một trường thứ hai.
   */
  readonly isPrimary: boolean;
  readonly onSelect: () => void;
}

/**
 * Danh sách hướng đi tiếp, **luôn ít nhất hai phần tử** — đây là mục CẤM TUYỆT ĐỐI
 * "luôn có ít nhất hai đường đi tiếp", ép bằng chính kiểu chứ không bằng một câu
 * bình luận mà người vội có thể đọc lướt qua. Một mảng một phần tử không gán được
 * vào kiểu này, nên hook không thể vô tình dựng nó và test không cần kiểm.
 */
export type PipelineFailureNextSteps = readonly [
  PipelineFailureNextStep,
  PipelineFailureNextStep,
  ...PipelineFailureNextStep[],
];

/* -------------------------------------------------------------------------- */
/* Khối "Kết quả đã có" — hai hình dạng.                                       */
/* -------------------------------------------------------------------------- */

/**
 * Một dòng kết quả đã giữ lại — ví dụ "Tiền xử lý ảnh — xong", "Nhận diện cửa và
 * nội thất — 21 đối tượng", "Đọc kích thước — 34 chuỗi".
 *
 * Không có trường trạng thái, không có trường màu: xem ghi chú A5 ở đầu file. Cả
 * câu đã ghép sẵn, kể cả con số (A15) — view không nhận `21` rồi tự viết "đối
 * tượng".
 */
export interface PipelineFailureKeptItem {
  readonly id: string;
  /** Cả dòng, đã ghép sẵn — ví dụ "Nhận diện cửa và nội thất — 21 đối tượng". */
  readonly label: string;
}

/**
 * Hình dạng đầy đủ: nhiều dòng cộng một câu chốt. Dùng ở mọi trạng thái trừ
 * `error`.
 */
export interface PipelineFailureKeptWorkList {
  readonly kind: 'list';
  readonly items: readonly PipelineFailureKeptItem[];
  /**
   * Câu chốt in đậm ý — ví dụ "Những kết quả này đã được giữ lại. Chạy lại sẽ
   * không xoá chúng.". Luôn có mặt: đây là lời hứa "không xoá tiến độ đã có" nói
   * thành lời, không phải một trường trang trí.
   */
  readonly captionSentence: string;
}

/**
 * Hình dạng rút gọn cho trạng thái `error` (cả bốn tầng hỏng): khối kết quả co lại
 * còn ĐÚNG MỘT dòng. Vẫn phải nói rõ cái gì được giữ — kể cả khi cái được giữ chỉ
 * là bản gốc đã tải lên.
 */
export interface PipelineFailureKeptWorkLine {
  readonly kind: 'line';
  /** Cả dòng, đã ghép sẵn — ví dụ "Bản vẽ gốc và các thiết lập của bạn vẫn được giữ.". */
  readonly line: string;
}

/**
 * Khối "Kết quả đã có", một trong hai hình dạng. Union có thẻ phân biệt thay vì một
 * mảng có thể rỗng: mảng rỗng khiến view phải TỰ NGHĨ ra câu thay thế ở `error`, mà
 * nghĩ câu là việc của hook.
 */
export type PipelineFailureKeptWork = PipelineFailureKeptWorkList | PipelineFailureKeptWorkLine;

/* -------------------------------------------------------------------------- */
/* Dải tầng.                                                                   */
/* -------------------------------------------------------------------------- */

/**
 * Bốn trạng thái một tầng có thể ở, mượn nguyên từ `ProcessingScreen/types.ts` (đã
 * KHOÁ). Xem ghi chú "Hai kiểu mượn từ nơi khác" ở đầu file.
 */
export type PipelineFailureFloorStatus = ProcessingStageStatus;

/**
 * Một ô của dải tầng. Dải LUÔN đủ bốn tầng, kể cả khi chỉ một tầng hỏng — mục đích
 * của nó là cho thấy tầng 1, 2 và 4 vẫn ổn, nên lọc bớt tầng là bỏ mất chính điều
 * dải này tồn tại để nói.
 */
export interface PipelineFailureFloorViewModel {
  readonly id: string;
  /** Tên tầng tiếng Việt — ví dụ "Tầng 03". */
  readonly label: string;
  readonly status: PipelineFailureFloorStatus;
  /** Trạng thái thành lời, viết thường kiểu câu (A6) — ví dụ "đã xong", "hỏng". */
  readonly statusLabel: string;
  /** `true` ở đúng tầng đang được màn này báo lỗi — ví dụ Tầng 03. */
  readonly isFailedFloor: boolean;
}

/* -------------------------------------------------------------------------- */
/* Khối gấp "Chi tiết kỹ thuật".                                               */
/* -------------------------------------------------------------------------- */

/** Một dòng nhật ký kỹ thuật, chữ đều, hiện trên nền `--bg-sunken`. */
export interface PipelineFailureLogLine {
  readonly id: string;
  /** Giờ đã định dạng sẵn — ví dụ "14:32:07". */
  readonly timeLabel: string;
  readonly text: string;
}

/**
 * Khối gấp "Chi tiết kỹ thuật". Đóng mặc định — vết lỗi kỹ thuật dài KHÔNG được
 * hiện ra ngoài khối này (mục CẤM TUYỆT ĐỐI).
 *
 * Toàn bộ khối là `null` ở trạng thái `forbidden`: người không có quyền không thấy
 * nhật ký, và cách đúng để nói điều đó là khối biến mất chứ không phải một nút khoá
 * mờ (cùng lý lẽ `ProcessingScreenProps.canCancel`).
 *
 * Mở/đóng là một chuyển chiều cao, chạy ở
 * {@link PipelineFailureProps.motionDurationName}.
 */
export interface PipelineFailureTechnicalDetails {
  /** Nhãn của chính nút gấp — ví dụ "Chi tiết kỹ thuật". */
  readonly toggleLabel: string;
  readonly isOpen: boolean;
  readonly onToggle: () => void;
  readonly logLines: readonly PipelineFailureLogLine[];
  /** Sao chép phần nhật ký đang hiện. */
  readonly copyLog: PipelineFailureCopyAction;
}

/* -------------------------------------------------------------------------- */
/* Bộ đếm lần thử — hai chế độ, hook chọn sẵn.                                  */
/* -------------------------------------------------------------------------- */

/**
 * Nút đường về trang tải bản vẽ để chạy lượt mới. Không có `href` ở đây: R-65 cấm
 * chuỗi đường dẫn trong mã chạy được; view chỉ gọi `onOpen`.
 */
export interface PipelineFailureUploadLink {
  /** Ví dụ "Tải lại bản vẽ". */
  readonly label: string;
  readonly onOpen: () => void;
}

/**
 * Chế độ thường: mới thất bại vài lần, chỉ cần đếm cho người dùng biết.
 */
export interface PipelineFailureRetryAttemptNotice {
  readonly kind: 'attempt';
  /** ĐÃ ghép sẵn — ví dụ "Lần thử 2". View không nhận số `2` rồi tự viết "Lần thử". */
  readonly attemptLabel: string;
}

/**
 * Chế độ đã thất bại quá nhiều: câu đổi sang gợi ý tải lại bản vẽ, kèm nút chép
 * TOÀN BỘ nhật ký và nút tải lại bản vẽ.
 *
 * Ngưỡng ("sau 3 lần thất bại") sống trong hook, KHÔNG trong hợp đồng và không
 * trong view: hai chế độ là hai nhánh của union này, nên view chỉ đọc `kind` chứ
 * không bao giờ so sánh một con số với một hằng số viết tay (R-71).
 */
export interface PipelineFailureRetrySupportNotice {
  readonly kind: 'support';
  /** Vẫn đếm — ví dụ "Lần thử 3". */
  readonly attemptLabel: string;
  /**
   * Câu gợi ý liên hệ hỗ trợ, không trách người dùng — ví dụ "Đã thử 3 lần mà bước
   * này vẫn hỏng. Bộ phận hỗ trợ xem giúp nhật ký sẽ nhanh hơn.".
   */
  readonly suggestionSentence: string;
  /** Chép TOÀN BỘ nhật ký, khác với `copyLog` chỉ chép phần đang hiện. */
  readonly copyAllLogs: PipelineFailureCopyAction;
  readonly uploadLink: PipelineFailureUploadLink;
}

/** Bộ đếm lần thử, một trong hai chế độ. Hook chọn, view không đếm. */
/**
 * Lỗi nằm ở chính tệp (máy chủ bảo tải lại tệp khác): chạy lại không giúp gì, nên không đếm
 * lần thử, không mời bộ phận hỗ trợ, không hiện mã kỹ thuật (U48).
 */
export interface PipelineFailureRetryNoneNotice {
  readonly kind: 'none';
}

export type PipelineFailureRetryNotice =
  | PipelineFailureRetryAttemptNotice
  | PipelineFailureRetrySupportNotice
  | PipelineFailureRetryNoneNotice;

/* -------------------------------------------------------------------------- */
/* Hành động thử lại đúng một bước.                                            */
/* -------------------------------------------------------------------------- */

/**
 * Nút "Thử lại bước này".
 *
 * `stepId` có mặt trong hợp đồng để nói ra bằng kiểu điều đặc tả nhấn mạnh: chạy
 * lại ĐÚNG bước đó, không chạy lại toàn bộ lượt xử lý. Nó cũng là thứ story và test
 * bám vào để khẳng định lời gọi đi kèm đúng mã bước.
 */
export interface PipelineFailureRetryAction {
  /** Ví dụ "Thử lại bước này". */
  readonly label: string;
  /** Mã bước sẽ chạy lại — đúng bước đã hỏng, không phải cả lượt. */
  readonly stepId: string;
  /** Tên bước tiếng Việt, cho nhãn trình đọc màn hình — ví dụ "nhận diện lớp tường". */
  readonly stepName: string;
  /** `true` khi lượt thử lại đang chạy: nút khoá, band đã đổi sang stepper. */
  readonly isRunning: boolean;
  /** `true` khi máy chủ chưa chạy lại được riêng một bước: view ẩn nút thay vì để nút nói ngược câu bên dưới. */
  readonly isUnsupported?: boolean;
  readonly onRetry: () => void;
}

/* -------------------------------------------------------------------------- */
/* Band — cái ô đổi nội dung tại chỗ. Xem ghi chú ở đầu file.                   */
/* -------------------------------------------------------------------------- */

/**
 * Trạng thái `empty`: chưa bước nào hỏng nên không có gì để báo. Ngoài đời màn cha
 * không gắn màn này khi ấy; nhánh này tồn tại để story và `expectSevenStates` dựng
 * được đủ bảy, và để màn không bao giờ trắng (A11).
 */
export interface PipelineFailureIdleBand {
  readonly kind: 'idle';
  /** Ví dụ "Chưa có bước nào hỏng ở lượt xử lý này.". */
  readonly messageSentence: string;
}

/**
 * Dải cảnh báo — nội dung chính của màn. Không nền đỏ, không hộp thoại, không trang
 * lỗi toàn màn (mục CẤM TUYỆT ĐỐI): đây là một dải nằm trong khung S-10.
 *
 * `nextSteps` là `null` ĐÚNG ở trạng thái `forbidden` — ba nút hành động biến mất
 * hẳn. Mọi trạng thái khác mang ít nhất hai hướng, ép bằng
 * {@link PipelineFailureNextSteps}.
 */
export interface PipelineFailureAlertBand {
  readonly kind: 'alert';
  readonly reason: PipelineFailureReasonViewModel;
  readonly retryAction: PipelineFailureRetryAction;
  readonly nextSteps: PipelineFailureNextSteps | null;
  readonly retryNotice: PipelineFailureRetryNotice;
}

/**
 * Đang thử lại: dải cảnh báo được thay TẠI CHỖ bằng `PipelineStepper`, không đổi
 * trang, không mở lớp mới.
 *
 * `steps` mang đúng kiểu `PipelineStepper` nhận, nên view chuyển thẳng sang mà
 * không ánh xạ lại. `PipelineStepperProps.steps` là mảng ghi được (component có
 * trước quy ước `readonly` của nhà), nên nơi gọi trải một bản sao mới — hợp đồng
 * giữ `readonly` vì không ai được ghi vào dữ liệu của hook.
 */
export interface PipelineFailureRetryingBand {
  readonly kind: 'retrying';
  readonly steps: readonly PipelineStepData[];
  /** Nhãn vùng cho trình đọc màn hình — ví dụ "Tiến độ lượt thử lại". */
  readonly stepperAriaLabel: string;
  /**
   * Câu nói ra rằng đang chạy lại, cho trình đọc màn hình biết dải vừa đổi nội dung
   * — ví dụ "Đang chạy lại bước nhận diện lớp tường ở Tầng 03.".
   */
  readonly liveMessage: string;
}

/**
 * Thử lại thành công: dải hoà tan thành một toast đã duyệt, rồi màn cha nhận
 * `onResolved` và chuyển tiếp.
 *
 * Thời lượng hoà tan là {@link PipelineFailureProps.motionDurationName}; khi người
 * dùng xin ít chuyển động thì nó bằng 0 và toast hiện ngay — `durationMs` lo phần
 * đó, view không viết nhánh riêng.
 */
export interface PipelineFailureResolvedBand {
  readonly kind: 'resolved';
  /** Ví dụ "Đã nhận diện xong lớp tường ở Tầng 03.". */
  readonly toastMessage: string;
  /** Nhãn của nút đi tiếp trên toast — ví dụ "Xem kết quả". */
  readonly continueLabel: string;
  readonly onContinue: () => void;
}

/**
 * Bốn nội dung có thể chiếm chỗ của dải cảnh báo. Loại trừ nhau — xem ghi chú "Vì
 * sao có {@link PipelineFailureBand}" ở đầu file.
 */
export type PipelineFailureBand =
  | PipelineFailureIdleBand
  | PipelineFailureAlertBand
  | PipelineFailureRetryingBand
  | PipelineFailureResolvedBand;

/* -------------------------------------------------------------------------- */
/* Toàn màn.                                                                   */
/* -------------------------------------------------------------------------- */

/**
 * Mọi prop `PipelineFailure.tsx` nhận. HỢP ĐỒNG PROPS DUY NHẤT của view.
 *
 * Phẳng, đúng khuôn `ProcessingScreenProps` — màn này sống trong khung của màn đó,
 * nên nó theo cách nhóm props của màn đó chứ không theo `{ model, actions }` của
 * `CadBranchConfirm`.
 *
 * Không nhánh nào của {@link PipelineFailureState} khiến view trả `null`: ở
 * `collapsed` vẫn còn câu tóm tắt và nút mở lại, ở `empty` vẫn còn
 * {@link PipelineFailureIdleBand}. Màn trắng — thất bại duy nhất A11 tồn tại để
 * chặn — không có chỗ xảy ra.
 */
export interface PipelineFailureProps {
  readonly state: PipelineFailureState;
  /** Cái ô đổi nội dung tại chỗ. `kind` của nó đi theo `state` — xem bảng ở đầu file. */
  readonly band: PipelineFailureBand;
  /**
   * Bốn tầng, luôn đủ bốn. Đứng ngoài band vì nó mô tả lượt xử lý, không mô tả cái
   * ô đang báo lỗi.
   */
  readonly floors: readonly PipelineFailureFloorViewModel[];
  /** Khối "Kết quả đã có". Cũng đứng ngoài band, cùng một lý lẽ. */
  readonly keptWork: PipelineFailureKeptWork;
  /** `null` ĐÚNG ở `forbidden`: nhật ký kỹ thuật biến mất hẳn, không khoá mờ. */
  readonly technicalDetails: PipelineFailureTechnicalDetails | null;
  /**
   * Câu tóm tắt một dòng, thứ duy nhất còn lại khi `state` là `collapsed` — ví dụ
   * "Tầng 03 hỏng ở bước nhận diện lớp tường · SEG-2041".
   */
  readonly collapsedSummaryLine: string;
  /** Nhãn nút thu gọn/mở lại, ĐÃ chọn theo `state` — ví dụ "Thu gọn" hoặc "Mở lại". */
  readonly collapseToggleLabel: string;
  readonly onToggleCollapse: () => void;
  /** Cấp "Dự án" của đường dẫn — vắng thì cấp đó là chữ thường. */
  readonly onBackToProjects?: () => void;
  /**
   * Slot thời lượng cho hai chuyển động của màn: mở/đóng khối chi tiết kỹ thuật, và
   * dải hoà tan thành toast. Điều phối viên chốt `'standard'` (260ms) — xem ghi chú
   * "Thời lượng chuyển động" ở đầu file. Trỏ token, không phải con số, nên R-71
   * không có gì để bắt.
   */
  readonly motionDurationName: MotionDurationName;
  /** Có thì cắt thẳng tới đích, không animate (mục B). */
  readonly prefersReducedMotion: boolean;
}

/* -------------------------------------------------------------------------- */
/* R-73 — màn cha mở được màn này mà không viết thêm logic.                     */
/* -------------------------------------------------------------------------- */

/**
 * Ba mã định vị đúng bước đã hỏng. Tách riêng để hook và container cùng nhận một
 * hình dạng thay vì mỗi bên khai lại ba trường.
 */
export interface PipelineFailureIdentity {
  readonly projectId: string;
  readonly floorId: string;
  /** Mã bước đã hỏng — ví dụ bước nhận diện lớp tường của Tầng 03. */
  readonly stepId: string;
}

/**
 * Props màn CHA truyền vào `PipelineFailureContainer`.
 *
 * Đây là toàn bộ thứ một màn khác cần biết để gắn màn này vào khung S-10 của nó
 * (R-73): ba mã định vị, vai trò của phiên đăng nhập, và ba lối ra. Không route
 * mới, không tham số đường dẫn, nên KHÔNG có `PipelineFailureRoute` đi kèm — khác
 * `ProcessingScreen.container.tsx` và `CadBranchConfirm.container.tsx`, vốn có một
 * route thật để nối.
 *
 * Ba lối ra, đều tuỳ chọn vì màn cha có thể chỉ muốn hiện dải mà không nối gì:
 *
 * - `onResolved` — thử lại xong, màn cha chuyển tiếp sang bước sau.
 * - `onDismiss` — người dùng đóng dải; màn cha gỡ nó khỏi khung.
 * - `onNavigate` — hướng "Tải lên bản vẽ rõ hơn" rời màn; hook dựng đường dẫn từ
 *   bảng đường dẫn rồi đẩy chuỗi qua đây, nên container không viết đường dẫn nào
 *   (R-65), đúng khuôn `CadBranchConfirmContainerProps.onNavigate`.
 *
 * ## Chỗ tiêm cổng dữ liệu
 *
 * Prop cổng dữ liệu KHÔNG khai ở đây, vì `pipelineFailureGateway.ts` chưa tồn tại ở
 * lớp này và một `import` trỏ vào file chưa có sẽ làm hỏng `pnpm typecheck`. Worker
 * sở hữu cổng dữ liệu MỞ RỘNG kiểu này trong file của chính họ —
 * `interface ... extends PipelineFailureContainerProps { readonly gateway?: ... }`
 * — đúng khuôn `UseScaleCalibrationHookOptions extends UseScaleCalibrationOptions`
 * của màn `ScaleCalibration`. Sửa file này KHÔNG phải cách hợp lệ.
 */
export interface PipelineFailureContainerProps extends PipelineFailureIdentity {
  /** Vai trò của phiên đăng nhập; thiếu thì hook dùng vai trò mặc định của nó. */
  readonly roles?: readonly string[];
  /** Thử lại thành công — màn cha chuyển tiếp. */
  readonly onResolved?: () => void;
  /** Người dùng đóng dải — màn cha gỡ nó khỏi khung S-10. */
  readonly onDismiss?: () => void;
  /** Điều hướng ra khỏi khung; hook đưa sang chuỗi đã dựng từ bảng đường dẫn. */
  readonly onNavigate?: (path: string) => void;
}

/* -------------------------------------------------------------------------- */
/* KHOÁ SAU KHI XONG                                                           */
/* -------------------------------------------------------------------------- */

/*
 * File này ĐÓNG BĂNG kể từ lúc lớp L1 xong. Worker lớp sau (hook, view, cổng dữ
 * liệu) thấy thiếu một trường, sai một kiểu, hay cần thêm một prop thì phải
 * `orca orchestration ask` hỏi điều phối viên trước — không tự thêm, không tự sửa,
 * kể cả người đã viết file này. Cách hợp lệ duy nhất để mở rộng là MỞ RỘNG kiểu ở
 * file riêng (xem ghi chú "Chỗ tiêm cổng dữ liệu" ngay trên).
 */
