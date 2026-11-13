/**
 * Phép tính hiển thị thuần cho khối "Kiểm tra con số" của màn Đặt tỷ lệ (S-11).
 *
 * Chỉ dùng số app đã có: mm/px đang dùng, cạnh ngắn ảnh (px), khổ giấy A3 mà cả hệ
 * ngưỡng chất lượng neo vào (`A3_SHORT_EDGE_MM`), và một chuỗi kích thước OCR nếu có.
 * Không đoán DPI từ metadata (BE chưa trả) — DPI ở đây là DPI SUY RA từ khổ A3.
 *
 * Một nguồn trạng thái: chip, câu trạng thái và dòng kiểm chéo đều sinh từ
 * {@link buildScaleCheck}, nên panel trái và panel phải không nói hai kiểu.
 */

import { A3_SHORT_EDGE_MM, formatDrawingScaleRatio } from '@/lib/format/measure';
import { formatNumber } from '@/lib/format/number';
import { millimetres, millimetresToMetres } from '@/domain/units/types';
import { SCALE_STATE_VIEWS } from '@/lib/viewmodel/provisionalScale';

const MM_PER_INCH = 25.4;
/** Hai tỷ lệ in thường gặp và hai DPI quét thường gặp của bảng đối chiếu. */
const REFERENCE_RATIOS = [50, 100] as const;
const REFERENCE_DPIS = [300, 150] as const;
/**
 * Dung sai kiểm chéo: 2 px của ảnh, theo demo đã duyệt.
 * ponytail: ngưỡng cố định ở FE; khi BE/M-02 trả dung sai theo độ phân giải thì đọc số đó.
 */
const TOLERANCE_PX = 2;

/** `missing` = tầng máy không đo được tỷ lệ (N16 `project_default`), số đang dùng là mặc định dự án. */
export type ScaleSource = 'proposed' | 'stored' | 'provisional' | 'missing';
export type ScaleCheckTone = 'verified' | 'attention' | 'violation' | 'neutral';

export interface KnownDimension {
  readonly realLength: number;
  readonly pixelLength: number;
}

/** Cỡ căn (hộp bao tường) theo tỷ lệ đang xét, bằng mm. */
export interface PlanSizeMm {
  readonly widthMm: number;
  readonly heightMm: number;
}

export interface ScaleCheckInput {
  readonly mmPerPx: number | null;
  readonly source: ScaleSource | null;
  readonly shortEdgePx: number | null;
  readonly knownDimension: KnownDimension | null;
  /** K17: có thì số to là cỡ căn thật để soi bằng mắt; mm/px và 1:N lùi xuống dòng chi tiết. */
  readonly planSizeMm?: PlanSizeMm | null;
  /** D1: số kích thước máy đọc được trên tầng; `0` + `isGuess` thì câu trạng thái nói thẳng là đoán. */
  readonly dimensionCount?: number;
  /** D1: tỷ lệ đang hiện chỉ là máy đoán (chưa ai xác nhận, chưa ai gõ/đo). */
  readonly isGuess?: boolean;
  /** Tỷ lệ tầng do máy đọc từ nhiều số đo đồng thuận (N16 `scaleBasis: 'chain'`), chưa ai đặt: không bắt xác nhận. */
  readonly isReadFromDrawing?: boolean;
}

export interface ScaleCheckViewModel {
  readonly status: {
    readonly tone: ScaleCheckTone;
    readonly label: string;
    readonly sentence: string;
    /** Nguồn có cấu trúc — view rẽ nhánh theo trường này, không đoán từ chữ của `label`. */
    readonly source: ScaleSource | null;
  };
  readonly title: string;
  /** "24,878" — đơn vị "mm/px" do view đặt cạnh, số to. `null` khi chưa có tỷ lệ. */
  readonly densityValue: string | null;
  /** "≈ 1:70 ở 72 DPI". */
  readonly ratioLine: string | null;
  /** Số to của khối tỷ lệ: cỡ căn "≈ 9,1 × 7,4 m" khi biết, không thì `ratioLine`. */
  readonly headline: string | null;
  /** Dòng chi tiết dưới số to khi số to là cỡ căn: "13,915 mm/px · ≈ 1:36 nếu ảnh là khổ A3". */
  readonly detailLine: string | null;
  /** "Cạnh ngắn ảnh 837 px trên khổ A3 (297 mm) ≈ 72 DPI." */
  readonly dpiNote: string | null;
  readonly knownCheck: { readonly tone: 'verified' | 'attention'; readonly title: string; readonly detail: string } | null;
  readonly knownCheckMissing: string | null;
  readonly table: {
    readonly headers: readonly string[];
    readonly rows: readonly { readonly ratio: string; readonly cells: readonly string[] }[];
  } | null;
}

const mm = (value: number): string => formatNumber(Math.round(value), { fractionDigits: 0 });
const density = (value: number): string =>
  formatNumber(value, { maxFractionDigits: value > 0 && value < 1 ? 6 : 3 });

/** DPI suy ra khi coi cạnh ngắn ảnh là cạnh ngắn khổ A3. */
export function inferredDpi(shortEdgePx: number): number {
  return (shortEdgePx * MM_PER_INCH) / A3_SHORT_EDGE_MM;
}

/** mm thật trên 1 px khi bản vẽ tỷ lệ 1:N được quét ở `dpi`. */
export function mmPerPxAt(ratio: number, dpi: number): number {
  return (ratio * MM_PER_INCH) / dpi;
}

/** Tỷ lệ in thường gặp trên khung tên bản vẽ. */
const NOTE_RATIOS = [10, 20, 25, 30, 40, 50, 60, 75, 100, 125, 150, 200, 250, 300, 500] as const;
/** Sai lệch tương đối cho phép: máy chủ lưu `N / px_mỗi_mm_giấy` tới 6 chữ số lẻ. */
const NOTE_TOLERANCE = 1e-4;

/**
 * UX-02: mẫu số N khi tỷ lệ máy đặt khớp đúng `1:N` ở DPI của PDF (ghi chú "TL 1:N", U01), hay `null`.
 * ponytail: N16 không nói tỷ lệ máy đến từ ghi chú hay độ dày tường; khớp ±0,01 % một tỷ lệ in
 * thường gặp thì coi là ghi chú. Thay bằng trường nguồn khi máy chủ gửi.
 */
export function noteRatioOf(mmPerPx: number | null | undefined, dpi: number | null | undefined): number | null {
  if (mmPerPx == null || dpi == null || !(mmPerPx > 0) || !(dpi > 0)) {
    return null;
  }

  return NOTE_RATIOS.find((ratio) => Math.abs(mmPerPxAt(ratio, dpi) / mmPerPx - 1) <= NOTE_TOLERANCE) ?? null;
}

const TITLES: Readonly<Record<ScaleSource, string>> = {
  proposed: 'Tỷ lệ vừa đo',
  stored: 'Tỷ lệ đã đặt',
  provisional: 'Tỷ lệ máy đo',
  missing: 'Tỷ lệ mặc định',
};

/** UX-R2 K27: cỡ căn theo tỷ lệ mặc định là số sai, nói thẳng ra. */
const MISSING_SIZE_SUFFIX = ' (chắc chắn sai)';

const { check: CHECK, missing: MISSING } = SCALE_STATE_VIEWS;

const MISSING_KNOWN = 'Chưa có kích thước thứ hai để kiểm chéo tỷ lệ.';

const metres = (valueMm: number): string => formatNumber(millimetresToMetres(millimetres(valueMm)), { fractionDigits: 1 });
export const planSizeText = (size: PlanSizeMm): string => `≈ ${metres(size.widthMm)} × ${metres(size.heightMm)} m`;

/** UX-R4 U11: "68,94", "68.94 m2", "68,94 m²" → 68.94; chữ khác hoặc ≤ 0 → `null`. */
export function parseFlatAreaM2(text: string): number | null {
  const match = /^\s*(\d+(?:[.,]\d+)?)\s*(?:m2|m²)?\s*$/i.exec(text);
  const value = match?.[1] === undefined ? Number.NaN : Number(match[1].replace(',', '.'));
  return Number.isFinite(value) && value > 0 ? value : null;
}

/** Diện tích (m²) của các đường bao phòng tính bằng mm (công thức shoelace, cộng trị tuyệt đối từng phòng). */
export function outlinesAreaM2(outlines: readonly (readonly { readonly x: number; readonly y: number }[])[]): number {
  let total = 0;
  for (const outline of outlines) {
    let twice = 0;
    outline.forEach((point, index) => {
      const next = outline[(index + 1) % outline.length] ?? point;
      twice += point.x * next.y - next.x * point.y;
    });
    total += Math.abs(twice) / 2;
  }
  return total / 1_000_000;
}

/**
 * UX-R4 U11: tỷ lệ suy từ diện tích căn in trên brochure. Diện tích tỷ lệ với bình phương mm/px, nên
 * `mm/px mới = mm/px đã dựng × √(diện tích nhập / diện tích đo ở tỷ lệ đã dựng)`. Thiếu số → `null`.
 */
export function mmPerPxFromFlatArea(targetM2: number, builtMmPerPx: number, builtAreaM2: number): number | null {
  return targetM2 > 0 && builtMmPerPx > 0 && builtAreaM2 > 0 ? builtMmPerPx * Math.sqrt(targetM2 / builtAreaM2) : null;
}

/**
 * UX41 U34: cỡ căn vô lý cho một căn hộ — cạnh dài hơn `maxMm` (thường do thừa một số 0) hoặc
 * ngắn hơn `minMm`. Hai ngưỡng truyền vào để nơi gọi giữ một nguồn hằng số.
 */
/** UX-09: căn hộ một tầng thật nằm trong 15..400 m²; ngoài khoảng này gần như chắc tỷ lệ sai. */
const FLAT_AREA_MIN_M2 = 15;
const FLAT_AREA_MAX_M2 = 400;

export function isFlatAreaImplausible(areaM2: number | null): boolean {
  return areaM2 !== null && (areaM2 < FLAT_AREA_MIN_M2 || areaM2 > FLAT_AREA_MAX_M2);
}

export function isPlanSizeImplausible(size: PlanSizeMm, minMm: number, maxMm: number): boolean {
  const longest = Math.max(size.widthMm, size.heightMm);
  return longest > maxMm || longest < minMm;
}

type ScaleStatus = Omit<ScaleCheckViewModel['status'], 'source'>;

/** D1: câu khi máy chỉ đoán — nói thẳng biên sai để người dùng biết phải nhập số. */
function guessSentence(input: ScaleCheckInput, sizeText: string | null): string | null {
  if (input.isGuess !== true || (input.source !== 'proposed' && input.source !== 'provisional')) {
    return null;
  }
  const count = input.dimensionCount ?? 0;
  if (count > 0) {
    return `Máy đọc từ ${formatNumber(count)} số kích thước trên bản vẽ${sizeText === null ? '' : `, cỡ căn ${sizeText}`}.`;
  }
  return `Máy đang ĐOÁN tỷ lệ (không đọc được số kích thước). Sai có thể tới ±40 %.${sizeText === null ? '' : ` Cỡ căn theo đoán: ${sizeText}.`}`;
}

function statusOf(
  input: ScaleCheckInput,
  densityLabel: string,
  ratio: string | null,
  knownTone: 'verified' | 'attention' | null,
  sizeText: string | null,
): ScaleStatus {
  // K17: người dùng soi được cỡ căn thật, không soi được 1:N suy từ khổ A3.
  const withRatio = sizeText === null ? `tỷ lệ ${ratio ?? `${densityLabel} mm/px`}` : `tỷ lệ cho căn ${sizeText}`;
  const guess = guessSentence(input, sizeText);

  switch (input.source) {
    // UX-R2 K05/K50: câu trạng thái chỉ nói tình hình; lời dẫn duy nhất nằm ở dải trên bản vẽ.
    case 'proposed':
      return { tone: 'neutral', label: 'Chưa xác nhận', sentence: guess ?? `Đo được ${withRatio}.` };
    case 'stored':
      if (input.isReadFromDrawing === true) {
        // A5: xanh chỉ cho việc người duyệt, tỷ lệ máy đọc giữ màu trung tính.
        return knownTone === 'attention'
          ? { tone: 'attention', label: 'Đọc từ bản vẽ, lệch kích thước', sentence: `Đang dùng ${withRatio}. Kiểm lại kích thước đã biết bên phải.` }
          : { tone: 'neutral', label: 'Đọc từ bản vẽ', sentence: `Máy đọc từ các số kích thước trên bản vẽ, ${withRatio}.` };
      }
      return knownTone === 'attention'
        ? { tone: 'attention', label: 'Đã xác nhận, lệch kích thước', sentence: `Đang dùng ${withRatio}. Kiểm lại kích thước đã biết bên phải.` }
        : { tone: 'verified', label: 'Đã xác nhận', sentence: `Đang dùng ${withRatio}.` };
    case 'provisional':
      // Tên + màu trạng thái dùng chung mọi màn (`SCALE_STATE_VIEWS`).
      return { tone: CHECK.statusCode, label: CHECK.name, sentence: guess ?? `Máy ước ${withRatio}, chưa ai xác nhận.` };
    case 'missing':
      return { tone: MISSING.statusCode, label: MISSING.name, sentence: 'Máy không đo được tỷ lệ, cỡ căn hiện tại chắc chắn sai.' };
    default:
      return { tone: MISSING.statusCode, label: MISSING.name, sentence: 'Tầng này chưa có tỷ lệ.' };
  }
}

/** Một bức tường tính bằng pixel ảnh: hai đầu tim tường + bề dày. */
export interface WallPx {
  readonly x1: number;
  readonly y1: number;
  readonly x2: number;
  readonly y2: number;
  readonly thicknessPx: number;
}

/**
 * D1: hộp bao tường (px). `outer` cộng nửa bề dày mỗi phía (tính từ mép ngoài tường), không thì
 * hộp tim tường. Vắng tường thì `null`.
 */
export function wallBoxPx(walls: readonly WallPx[], outer: boolean): { readonly widthPx: number; readonly heightPx: number } | null {
  if (walls.length === 0) {
    return null;
  }
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const wall of walls) {
    const pad = outer ? wall.thicknessPx / 2 : 0;
    minX = Math.min(minX, wall.x1 - pad, wall.x2 - pad);
    maxX = Math.max(maxX, wall.x1 + pad, wall.x2 + pad);
    minY = Math.min(minY, wall.y1 - pad, wall.y2 - pad);
    maxY = Math.max(maxY, wall.y1 + pad, wall.y2 + pad);
  }
  return { widthPx: maxX - minX, heightPx: maxY - minY };
}

/** Lệch quá 3 % giữa tỷ lệ hai cạnh thì nhắc người dùng kiểm lại. */
export const FLAT_SIZE_MISMATCH_PERCENT = 3;

/**
 * D1: tỷ lệ từ "Căn rộng × dài (mm)": trung bình (rộng / bề rộng hộp, dài / bề cao hộp). `swapped`
 * đổi chiều (rộng ứng bề cao). `mismatchPercent` = độ lệch hai tỷ lệ so với trung bình.
 */
export function ratioFromFlatSize(
  widthMm: number,
  lengthMm: number,
  box: { readonly widthPx: number; readonly heightPx: number },
  swapped: boolean,
): { readonly mmPerPx: number; readonly mismatchPercent: number } | null {
  if (!(widthMm > 0) || !(lengthMm > 0) || !(box.widthPx > 0) || !(box.heightPx > 0)) {
    return null;
  }
  const alongX = (swapped ? lengthMm : widthMm) / box.widthPx;
  const alongY = (swapped ? widthMm : lengthMm) / box.heightPx;
  const mmPerPx = (alongX + alongY) / 2;
  return { mmPerPx, mismatchPercent: (Math.abs(alongX - alongY) / mmPerPx) * 100 };
}

export function buildScaleCheck(input: ScaleCheckInput): ScaleCheckViewModel {
  const { mmPerPx, shortEdgePx, knownDimension } = input;
  const hasScale = mmPerPx !== null && mmPerPx > 0 && input.source !== null;
  const hasEdge = shortEdgePx !== null && shortEdgePx > 0;
  const dpi = hasEdge ? inferredDpi(shortEdgePx) : null;
  const dpiLabel = dpi === null ? null : `${formatNumber(dpi, { fractionDigits: 0 })} DPI`;

  const densityValue = hasScale ? density(mmPerPx) : null;
  const ratioLine =
    hasScale && hasEdge && dpiLabel !== null
      ? `≈ ${formatDrawingScaleRatio(mmPerPx, shortEdgePx)}`
      : null;

  let knownCheck: ScaleCheckViewModel['knownCheck'] = null;
  if (hasScale && knownDimension !== null && knownDimension.pixelLength > 0) {
    const measured = knownDimension.pixelLength * mmPerPx;
    const delta = measured - knownDimension.realLength;
    const ok = Math.abs(delta) <= TOLERANCE_PX * mmPerPx;
    knownCheck = {
      tone: ok ? 'verified' : 'attention',
      title: `Đo ra ${mm(measured)} mm, bản vẽ ghi ${mm(knownDimension.realLength)}`,
      detail: ok
        ? `Lệch ${mm(Math.abs(delta))} mm, trong sai số ${String(TOLERANCE_PX)} px (${mm(TOLERANCE_PX * mmPerPx)} mm).`
        : `Lệch ${mm(Math.abs(delta))} mm, quá sai số ${String(TOLERANCE_PX)} px. Đo lại hoặc kiểm số đã nhập.`,
    };
  }

  const table =
    dpi === null || dpiLabel === null
      ? null
      : {
          headers: [...REFERENCE_DPIS.map((value) => `${String(value)} DPI`), `${dpiLabel}, ảnh này`],
          rows: REFERENCE_RATIOS.map((ratio) => ({
            ratio: `1:${String(ratio)}`,
            cells: [...REFERENCE_DPIS, dpi].map((value) => formatNumber(mmPerPxAt(ratio, value), { fractionDigits: 1 })),
          })),
        };

  const sizeText = hasScale && input.planSizeMm != null ? planSizeText(input.planSizeMm) : null;
  // UX-R2 K27: bỏ "≈ 1:N nếu ảnh là khổ A3" — con số đoán khổ giấy không giúp người dùng quyết gì.
  const detailLine = sizeText === null || densityValue === null ? null : `${densityValue} mm/px`;
  const headline =
    sizeText !== null && input.source === 'missing' ? `${sizeText}${MISSING_SIZE_SUFFIX}` : (sizeText ?? ratioLine);

  return {
    status: { ...statusOf(input, densityValue ?? '', hasScale ? ratioLine : null, knownCheck?.tone ?? null, sizeText), source: input.source },
    title: input.source === null ? 'Tỷ lệ' : sizeText === null ? TITLES[input.source] : `Cỡ căn theo ${TITLES[input.source].toLowerCase()}`,
    densityValue,
    ratioLine,
    headline,
    detailLine,
    dpiNote:
      hasEdge && dpiLabel !== null
        ? `Cạnh ngắn ảnh ${formatNumber(shortEdgePx, { fractionDigits: 0 })} px trên khổ A3 (${String(A3_SHORT_EDGE_MM)} mm) ≈ ${dpiLabel}.`
        : null,
    knownCheck,
    knownCheckMissing: hasScale && knownCheck === null ? MISSING_KNOWN : null,
    table,
  };
}
