/**
 * Số đo của một tầng có tỷ lệ tạm (`scaleStatus: 'unresolved'`, N16) — A15: chữ hiện
 * lên màn quyết định ở đây, không ở view. Tỷ lệ tạm là máy chủ đoán; số đo theo nó
 * chưa tin được, nên màn thay chuỗi đo bằng câu cố định và hiện dải nhắc hiệu chỉnh.
 */

export type ScaleStatus = 'unresolved' | undefined;

/**
 * Nguồn của tỷ lệ tạm (N16 `scaleSource`, chỉ đi cùng `scaleStatus`): `pipeline` = máy đo được,
 * cần người kiểm (vàng); `project_default` = máy không đo được, đang dùng mặc định dự án
 * (thường 1 mm/px) nên mọi kích thước và mô hình 3D sai hẳn (đỏ, UX-R1 K12).
 */
export type ScaleSource = 'pipeline' | 'project_default';

/** Tầng chưa có tỷ lệ thật: chặn mọi thao tác dựa vào số đo cho tới khi đặt tỷ lệ. */
export function isScaleMissing(source: ScaleSource | undefined): boolean {
  return source === 'project_default';
}

/** N16 `scaleBasis` mà máy chỉ ước lượng (cửa, độ dày tường, mặc định) — không đọc từ số trên bản vẽ. */
const ESTIMATED_SCALE_BASES: ReadonlySet<string> = new Set(['door', 'wallThickness', 'default']);

export function isScaleEstimated(basis: string | undefined): boolean {
  return basis !== undefined && ESTIMATED_SCALE_BASES.has(basis);
}

/** Một nhãn cho tỷ lệ máy đề xuất mà người chưa xác nhận — thay cho "Suy từ chuỗi kích thước" ở các màn. */
export const SCALE_PROPOSED_LABEL = 'Tỷ lệ đề xuất, chưa xác nhận';

/** Nhãn tỷ lệ ước lượng (N16 `scaleBasis`), dùng chung mọi màn. */
export const SCALE_ESTIMATED_NOTE = 'Tỷ lệ ước lượng — nên hiệu chỉnh';

/**
 * N16 `scaleState` (R9, tuỳ chọn): máy chủ chốt tỷ lệ của tầng thuộc loại nào — `determined` đọc từ số
 * trên bản vẽ không nghi vấn; `estimated` chỉ ước (cửa 745 mm, độ dày tường, ghi chú 1:N); `unresolved`
 * không đủ căn cứ hoặc nguồn mâu thuẫn; `userCalibrated` người dùng đã hiệu chỉnh. Vắng = máy chủ cũ.
 */
export type WireScaleState = 'determined' | 'estimated' | 'unresolved' | 'userCalibrated';

/** Phần R9 của khoá tỷ lệ N16 một tầng. */
export interface FloorScaleDetail {
  readonly scaleState?: WireScaleState | undefined;
  readonly scaleReasons?: readonly string[] | undefined;
}

/**
 * Trạng thái tỷ lệ của một tầng (UX-R2 K50/K20/K46) — MỘT nguồn chữ và màu cho thanh bước, cổng, dải,
 * chip Các tầng, Xử lý, Quy chuẩn và 3D: `missing` đỏ (máy không đo được, đang dùng mặc định dự án —
 * khoá các bước sau); `check` vàng (máy chủ cũ, không có `scaleState`: máy đo được, cần người kiểm);
 * `undetermined` vàng (R9: chưa xác định — thiếu căn cứ hoặc nguồn mâu thuẫn); `estimated` vàng (R9:
 * chỉ ước lượng); `measured` trung tính (R9: đọc từ bản vẽ, số hiện bình thường); `confirmed` xanh
 * (người đã đặt/xác nhận; A5: xanh chỉ cho việc người duyệt). Không trạng thái R9 nào thành `missing`
 * trừ khi nguồn là mặc định dự án — `missing` bỏ tầng khỏi cảnh 3D.
 */
export type ScaleState = 'missing' | 'check' | 'undetermined' | 'estimated' | 'measured' | 'confirmed';

export interface ScaleStateView {
  /** Tên trạng thái, dùng y nguyên ở mọi màn. */
  readonly name: string;
  /** Mã màu A4 (view tự map sang token); `neutral` = không cần chú ý. */
  readonly statusCode: 'violation' | 'attention' | 'verified' | 'neutral';
  /** Động từ của nút dẫn tới màn Tỷ lệ; `null` khi không còn việc. */
  readonly action: string | null;
}

export const SCALE_STATE_VIEWS = {
  missing: { name: 'Chưa có tỷ lệ', statusCode: 'violation', action: 'Đặt tỷ lệ' },
  check: { name: 'Tỷ lệ cần kiểm', statusCode: 'attention', action: 'Xác nhận tỷ lệ' },
  undetermined: { name: 'Tỷ lệ chưa xác định', statusCode: 'attention', action: 'Hiệu chỉnh tỷ lệ' },
  estimated: { name: 'Tỷ lệ ước lượng', statusCode: 'attention', action: 'Hiệu chỉnh tỷ lệ' },
  measured: { name: 'Tỷ lệ đọc từ bản vẽ', statusCode: 'neutral', action: null },
  confirmed: { name: 'Tỷ lệ đã xác nhận', statusCode: 'verified', action: null },
} as const satisfies Readonly<Record<ScaleState, ScaleStateView>>;

/**
 * Trạng thái tỷ lệ từ khoá N16 khi không có đồ thị tầng. Có `scaleState` (R9) thì theo nó; vắng (máy chủ
 * cũ) thì luật cũ: không `unresolved` → đã xác nhận; `project_default` → chưa có; còn lại → cần kiểm.
 * Có đồ thị thì `floorScaleStateOf` (qc/shared) xét thêm tỷ lệ vô lý.
 */
export function scaleStateOf(
  scaleStatus: ScaleStatus,
  scaleSource: ScaleSource | undefined,
  scaleState?: WireScaleState,
): ScaleState {
  switch (scaleState) {
    case 'userCalibrated':
      return 'confirmed';
    case 'determined':
      return 'measured';
    case 'estimated':
      return 'estimated';
    case 'unresolved':
      return isScaleMissing(scaleSource) ? 'missing' : 'undetermined';
    case undefined:
      if (scaleStatus !== 'unresolved') return 'confirmed';
      return isScaleMissing(scaleSource) ? 'missing' : 'check';
  }
}

/** Hậu tố số đo theo trạng thái: rỗng khi số tin được (hoặc khi không có số — `missing`). */
export const SCALE_MEASURE_SUFFIX = {
  missing: '',
  check: ' (tạm)',
  undetermined: ' (chưa xác định)',
  estimated: ' (ước lượng)',
  measured: '',
  confirmed: '',
} as const satisfies Readonly<Record<ScaleState, string>>;

/** Câu tiếng Việt cho từng mã N16 `scaleReasons` (mã đầu = nguồn, sau đó = nghi vấn). */
export const SCALE_REASON_TEXT: Readonly<Record<string, string>> = {
  chain: 'Đọc từ chuỗi kích thước trên bản vẽ',
  paired: 'Đọc từ các số đo khớp với tường',
  note: 'Suy từ ghi chú tỷ lệ 1:N, chưa kiểm khổ in',
  door: 'Ước từ bề rộng cửa đi (giả định 745 mm)',
  wallThickness: 'Ước từ bề dày tường (giả định 150 mm)',
  projectDefault: 'Máy không đo được, đang dùng tỷ lệ mặc định của dự án',
  sourceConflict: 'Số đo trên bản vẽ mâu thuẫn với ước từ cửa và tường',
  anisotropic: 'Ảnh giãn không đều theo hai chiều',
  estimateSpread: 'Ước từ cửa và từ tường lệch nhau',
  pageChanged: 'Trang bản vẽ đã đổi sau lần hiệu chỉnh',
  human: 'Do bạn hiệu chỉnh bằng một kích thước đã biết',
};

/** Mã lạ (máy chủ mới hơn) hoặc `basisUnknown`: một câu chung, không vỡ màn. */
export const SCALE_REASON_UNKNOWN = 'Chưa rõ căn cứ của tỷ lệ';

export function scaleReasonTextOf(code: string): string {
  return Object.prototype.hasOwnProperty.call(SCALE_REASON_TEXT, code)
    ? (SCALE_REASON_TEXT[code] ?? SCALE_REASON_UNKNOWN)
    : SCALE_REASON_UNKNOWN;
}

/** Các lý do thành một câu ("A; B."), bỏ câu trùng; `null` khi không có mã nào. */
export function scaleReasonsSentenceOf(reasons: readonly string[] | undefined): string | null {
  const texts = [...new Set((reasons ?? []).map(scaleReasonTextOf))];

  return texts.length === 0 ? null : `${texts.join('; ')}.`;
}

/** Lời mời hiệu chỉnh: một kích thước đã biết là đủ. */
export const CALIBRATE_BY_ONE_LENGTH = 'Hiệu chỉnh bằng một kích thước đã biết để số đo hết dấu ≈.';

/**
 * Câu trạng thái + lý do cho dải ở màn Tỷ lệ, Xử lý và trình sửa 3D (R9). `null` khi số đo tin được
 * (`measured`, `confirmed`) hoặc máy chủ cũ (`check` — các màn giữ câu cũ của mình).
 */
export function scaleStateMessageOf(state: ScaleState, reasons: readonly string[] | undefined): string | null {
  if (state !== 'undetermined' && state !== 'estimated' && state !== 'missing') return null;
  const why = scaleReasonsSentenceOf(reasons);
  const head = `${SCALE_STATE_VIEWS[state].name}${why === null ? '.' : `: ${why}`}`;

  return state === 'missing' ? head : `${head} ${CALIBRATE_BY_ONE_LENGTH}`;
}

export interface ProvisionalScaleNoticeView {
  /** `violation` (đỏ) khi tầng không đo được tỷ lệ; `attention` khi tỷ lệ máy đo cần kiểm. */
  readonly level: 'attention' | 'violation';
  readonly message: string;
}

export const PROVISIONAL_MEASURE_TEXT = 'Chưa có — tỷ lệ tạm';

const PROVISIONAL_SCALE_MESSAGE = 'Tỷ lệ tạm — số đo chưa tin được, hãy hiệu chỉnh tỷ lệ.';

export const MISSING_SCALE_MESSAGE =
  'Chưa có tỷ lệ: máy không đo được tỷ lệ tầng này nên kích thước và mô hình 3D đang sai. Đặt tỷ lệ trước khi duyệt tiếp.';

/** Trung vị độ dày tường dưới mức này thì gần như chắc tỷ lệ sai (tường thật mỏng nhất ~100 mm). */
export const IMPLAUSIBLE_MEDIAN_THICKNESS_MM = 50;

/** Khung bản vẽ (cạnh dài của khối tường) dưới mức này thì gần như chắc tỷ lệ sai: căn hộ không gọn hơn 3 m. */
export const TINY_FOOTPRINT_MM = 3000;

/**
 * Tỷ lệ máy đo mà hình ra vô lý (Codex P1): trung vị độ dày tường < 50 mm, hoặc khung bản vẽ
 * < 3 m. Coi như chưa có tỷ lệ. Không có tường / không biết khung thì không đoán.
 */
export function isMeasuredScaleImplausible(thicknessesMm: readonly number[], frameMm: number | undefined): boolean {
  const sorted = [...thicknessesMm].sort((first, second) => first - second);
  const median = sorted[Math.floor(sorted.length / 2)];
  const thin = median !== undefined && median < IMPLAUSIBLE_MEDIAN_THICKNESS_MM;
  return thin || (frameMm !== undefined && frameMm < TINY_FOOTPRINT_MM);
}

/**
 * Câu thay nút đổi độ dày hàng loạt khi tầng chưa có tỷ lệ thật (UX-R1 K09): máy không đo được
 * tỷ lệ, hoặc trung vị độ dày dưới 50 mm. Ép tường về 100 mm lúc đó chỉ che lỗi, và tường đã ép
 * vẫn sai sau khi đặt tỷ lệ. `null` = không khoá.
 */
export function thicknessLockTextOf(thicknessesMm: readonly number[], scaleSource?: ScaleSource): string | null {
  const sorted = [...thicknessesMm].sort((first, second) => first - second);

  if (!isScaleMissing(scaleSource) && !isMeasuredScaleImplausible(sorted, undefined)) {
    return null;
  }

  const low = sorted[0];
  const high = sorted[sorted.length - 1];

  if (low === undefined || high === undefined) {
    return 'Độ dày tường đang sai vì chưa có tỷ lệ. Đặt tỷ lệ trước.';
  }

  const [lowMm, highMm] = [Math.round(low), Math.round(high)];
  const range = lowMm === highMm ? `${String(lowMm)} mm` : `${String(lowMm)}–${String(highMm)} mm`;

  return `Tường đo ra ${range} vì chưa có tỷ lệ. Đặt tỷ lệ trước.`;
}

/** Số đo khi tầng chưa có tỷ lệ: không có số nào tin được. */
export const MISSING_MEASURE_TEXT = 'Chưa có';

/**
 * Chữ số đo theo trạng thái tỷ lệ (UX-R2, R9): số tin được → số; chưa có → "Chưa có"; còn lại →
 * "≈ <số> (tạm | ước lượng | chưa xác định)" để người dùng vẫn thấy số máy đo nhưng biết nó chưa chắc.
 */
export function measureTextOf(
  formatted: string,
  scaleStatus: ScaleStatus,
  scaleSource?: ScaleSource,
  scaleState?: WireScaleState,
): string {
  const state = scaleStateOf(scaleStatus, scaleSource, scaleState);
  if (state === 'missing') return MISSING_MEASURE_TEXT;
  const suffix = SCALE_MEASURE_SUFFIX[state];
  return suffix === '' ? formatted : `≈ ${formatted}${suffix}`;
}

export function provisionalScaleNoticeOf(
  scaleStatus: ScaleStatus,
  scaleSource?: ScaleSource,
  scaleState?: WireScaleState,
  scaleReasons?: readonly string[],
): ProvisionalScaleNoticeView | null {
  if (scaleState !== undefined) {
    const state = scaleStateOf(scaleStatus, scaleSource, scaleState);
    if (state === 'missing') return { level: 'violation', message: MISSING_SCALE_MESSAGE };
    const message = scaleStateMessageOf(state, scaleReasons);
    return message === null ? null : { level: 'attention', message };
  }

  if (scaleStatus !== 'unresolved') {
    return null;
  }

  return isScaleMissing(scaleSource)
    ? { level: 'violation', message: MISSING_SCALE_MESSAGE }
    : { level: 'attention', message: PROVISIONAL_SCALE_MESSAGE };
}

/** Chip cảnh báo của màn 3D: một tầng thì gọi tên, nhiều tầng thì đếm; không tầng nào thì `null`. */
export function provisionalFloorsMessageOf(floorNames: readonly string[]): string | null {
  const [first] = floorNames;

  if (first === undefined) return null;

  const subject = floorNames.length === 1 ? first : `${floorNames.length} tầng`;

  return `${subject} chưa hiệu chỉnh tỷ lệ — kích thước 3D có thể sai`;
}

/** Câu nêu tên đủ mọi tầng: `ch-01, ch-02` (≤ 8 tên), dài hơn thì 8 tên đầu và "… và N tầng khác". */
function floorListOf(floorNames: readonly string[]): string {
  const shown = floorNames.slice(0, 8).join(', ');
  const rest = floorNames.length - 8;

  return rest > 0 ? `${shown} và ${rest} tầng khác` : shown;
}

/**
 * Dải cảnh báo 3D (UX-R1 K44): tầng không đo được tỷ lệ nói "sai", tầng máy đo nói "có thể sai";
 * nêu tên từng tầng. `null` khi không tầng nào.
 */
export function scaleFloorsMessageOf(missing: readonly string[], provisional: readonly string[]): string | null {
  const parts = [
    missing.length === 0 ? null : `${missing.length} tầng không đo được tỷ lệ, kích thước 3D sai: ${floorListOf(missing)}`,
    provisional.length === 0
      ? null
      : `${provisional.length} tầng chưa hiệu chỉnh tỷ lệ, kích thước 3D có thể sai: ${floorListOf(provisional)}`,
  ].filter((part): part is string => part !== null);

  return parts.length === 0 ? null : `${parts.join('. ')}.`;
}
