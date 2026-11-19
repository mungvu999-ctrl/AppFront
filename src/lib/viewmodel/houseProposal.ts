/**
 * Lớp trình bày của bảng "Đề xuất của máy cho cả nhà" (Mức 3, lát cắt 1, việc F2).
 *
 * Hàm thuần: nhận `HouseProposal` của máy và các tầng của dự án, trả dòng bảng đã viết sẵn chữ.
 * View chỉ đặt chữ vào thẻ (A15) và ánh xạ `statusCode` sang token (A1).
 *
 * Luật A5: đầu ra của máy không bao giờ mang mã `verified` (xanh dành cho người duyệt).
 * Độ chắc >= 0,9 là `neutral`, 0,7–0,9 là `attention`, dưới 0,7 là `violation`.
 *
 * Thứ tự dòng là thứ tự tầng của dự án (cùng thứ tự bảng tầng bên dưới); dòng cần xem giữ dấu
 * `attention`/`violation`, không đổi chỗ. "Nhận một cú bấm" tính theo TỪNG Ô: độ chắc ô >= 0,7, khác
 * hiện tại, nằm trong khoảng, và dòng không còn câu hỏi (chỉ có mặt bằng thì không ô nào đạt 0,9).
 *
 * Số hiển thị theo đúng cách màn Quản lý tầng đang viết (`FloorManager/floorFormat.ts`): cao độ là
 * mét có dấu (`+3.600`, `±0.000`), chiều cao là mm tách nghìn (`3.600`). Hai hàm đó nằm trong
 * `src/screens` mà `src/lib` không được nhập, nên bản dưới đây chép cùng công thức.
 */

import type { HouseFloorProposal, HouseLevelSource, HouseProposal, HouseQuestionCode } from '@/api/schemas/houseProposal';
import { formatNumber, MISSING_VALUE } from '@/lib/format/number';

import type { ViewStatusCode } from './types';

/* -------------------------------------------------------------------------- */
/* Hằng số.                                                                    */
/* -------------------------------------------------------------------------- */

/** Từ mức này trở lên: máy khá chắc, dòng không cần chú ý. */
export const HOUSE_CONFIDENCE_HIGH = 0.9;
/** Dưới mức này: dòng là `violation` và đếm vào "cần xem". */
export const HOUSE_CONFIDENCE_LOW = 0.7;

/** Khoảng của `FloorRow` phía BE (cùng số với `HouseFloorProposalSchema`). */
export const HOUSE_ELEVATION_RANGE_MM = { min: -30000, max: 300000 } as const;
export const HOUSE_HEIGHT_RANGE_MM = { min: 2000, max: 10000 } as const;

const NO_PROPOSAL_TEXT = 'Máy chưa có đề xuất cho tầng này';
const UNKNOWN_STOREY_TEXT = 'Chưa rõ tầng';
const MINUS_SIGN = '−';

const STOREY_TEXTS = {
  ground: 'Tầng trệt',
  basement: 'Tầng hầm',
  mezzanine: 'Tầng lửng',
  attic: 'Tầng áp mái',
  roof_terrace: 'Sân thượng',
} as const;

const SOURCE_TEXTS: Readonly<Record<HouseLevelSource, string>> = {
  plan: 'mặt bằng',
  'plan+section': 'mặt bằng và mặt cắt',
  section: 'mặt cắt',
  dims: 'kích thước ghi trên bản vẽ',
  convention: 'quy ước',
  default: 'giả định',
};

/** Câu hỏi cho người dùng: nói máy thấy gì và cần kiểm tra gì. Mã là của máy, câu là của giao diện. */
export const HOUSE_QUESTION_TEXTS: Readonly<Record<HouseQuestionCode, string>> = {
  STOREY_UNSURE: 'Máy chưa chắc đây là tầng nào. Kiểm tra tên tầng ghi trên bản vẽ.',
  STOREY_CONFLICT: 'Chữ trên bản vẽ chỉ về hai tầng khác nhau. Mở bản vẽ và chọn tầng đúng.',
  ORDER_DIFFERS: 'Thứ tự tầng máy đọc khác thứ tự trong dự án. Kiểm tra lại thứ tự các tầng.',
  LEVEL_MISSING: 'Bản vẽ không ghi cao độ. Nhập cao độ của tầng này.',
  HEIGHT_ASSUMED: 'Bản vẽ không ghi chiều cao tầng, máy lấy giá trị thường gặp. Kiểm tra lại chiều cao.',
  NOT_A_PLAN: 'Bản vẽ này có vẻ không phải mặt bằng. Kiểm tra đã tải đúng bản vẽ chưa.',
  NO_TEXT: 'Máy không đọc được chữ trên bản vẽ. Thử tải bản rõ hơn.',
};

/* -------------------------------------------------------------------------- */
/* Kiểu.                                                                       */
/* -------------------------------------------------------------------------- */

/** Phần của tầng dự án mà bảng cần. `Level` của domain khớp cấu trúc. */
export interface HouseProjectFloor {
  readonly id: string;
  readonly name: string;
  readonly order: number;
  readonly elevationMm: number;
  readonly heightMm: number;
}

/** Một ô số (cao độ hoặc chiều cao) của một dòng. */
export interface HouseFieldVm {
  readonly hasProposal: boolean;
  /** Số thô để so sánh và để lệnh "Nhận" ghi; `null` khi máy không đề xuất. */
  readonly proposedMm: number | null;
  /** Chữ đề xuất, không kèm đơn vị (đơn vị nằm ở tiêu đề cột); `—` khi không có. */
  readonly proposedText: string;
  readonly currentText: string;
  /** Có đề xuất và khác giá trị hiện tại. */
  readonly differs: boolean;
  /** Ví dụ `"+0.600 m"`, `"−300 mm"`; `null` khi không khác. */
  readonly deltaText: string | null;
  readonly statusCode: ViewStatusCode;
  readonly confidence: number | null;
  readonly confidenceLabel: string | null;
  readonly sourceText: string | null;
  /** Có đề xuất, khác hiện tại, và nằm trong khoảng cho phép. */
  readonly acceptable: boolean;
  /** Nhận một cú bấm: `acceptable`, độ chắc >= 0,7 và dòng không có câu hỏi. */
  readonly oneClick: boolean;
}

export interface HouseProposalRowVm {
  readonly floorId: string;
  readonly floorName: string;
  /** `false` ⟺ tầng có trong dự án nhưng máy không đề xuất gì. */
  readonly hasProposal: boolean;
  /** Câu "Máy chưa có đề xuất…" khi `hasProposal` sai, `null` ở dòng thường. */
  readonly noProposalText: string | null;
  readonly storeyText: string;
  readonly storeyStatusCode: ViewStatusCode;
  readonly storeyConfidenceLabel: string | null;
  readonly elevation: HouseFieldVm;
  readonly height: HouseFieldVm;
  /** Thấp nhất trong các độ chắc của tầng/cao độ/chiều cao; `null` khi không có đề xuất. */
  readonly minConfidence: number | null;
  readonly statusCode: ViewStatusCode;
  readonly questions: readonly string[];
  /** Có ít nhất một ô nhận được bằng một cú bấm. */
  readonly oneClick: boolean;
  /** Cần xem: có độ chắc dưới 0,7. */
  readonly needsLook: boolean;
  /** Có ô nhận được: nút "Nhận" của dòng bật hay tắt. */
  readonly anyAcceptable: boolean;
}

export interface HouseProposalSummary {
  /** Số dòng máy có đề xuất. */
  readonly proposedCount: number;
  /** Số dòng có ít nhất một giá trị khác hiện tại. */
  readonly differingCount: number;
  /** Số dòng có độ chắc dưới 0,7. */
  readonly needsLookCount: number;
  /** Số Ô (cao độ hoặc chiều cao) nhận được bằng một cú bấm. */
  readonly oneClickCount: number;
  /** Không ô nào khác giá trị hiện tại và không dòng nào còn câu hỏi: không có gì để hiện. */
  readonly isEmpty: boolean;
  /** Câu cho thanh đầu bảng. */
  readonly headline: string;
}

/* -------------------------------------------------------------------------- */
/* Độ chắc.                                                                    */
/* -------------------------------------------------------------------------- */

/** Mã trạng thái theo độ chắc. Không bao giờ trả `verified` (A5). */
export function statusOfConfidence(confidence: number | null | undefined): ViewStatusCode {
  if (confidence === null || confidence === undefined) {
    return 'neutral';
  }
  if (confidence >= HOUSE_CONFIDENCE_HIGH) {
    return 'neutral';
  }
  return confidence >= HOUSE_CONFIDENCE_LOW ? 'attention' : 'violation';
}

/** Độ chắc bằng lời. */
export function confidenceLabelOf(confidence: number): string {
  if (confidence >= HOUSE_CONFIDENCE_HIGH) {
    return 'Hai nguồn khớp';
  }
  return confidence >= HOUSE_CONFIDENCE_LOW ? 'Một nguồn' : 'Chưa chắc';
}

/* -------------------------------------------------------------------------- */
/* Chữ.                                                                        */
/* -------------------------------------------------------------------------- */

export function storeyTextOf(label: HouseFloorProposal['storeyLabel'], storeyNo: number | undefined): string {
  if (label === undefined) {
    return UNKNOWN_STOREY_TEXT;
  }
  if (label !== 'floor') {
    return STOREY_TEXTS[label];
  }
  return storeyNo === undefined || storeyNo < 1
    ? UNKNOWN_STOREY_TEXT
    : `Tầng ${formatNumber(storeyNo, { fractionDigits: 0, grouping: false })}`;
}

/** Cao độ mét có dấu, như cột "Cao độ (m)" của màn Quản lý tầng: 3600 → "+3.600", 0 → "±0.000". */
function elevationText(valueMm: number): string {
  const rounded = Math.round(valueMm);

  if (rounded === 0) {
    return '±0.000';
  }
  const absolute = Math.abs(rounded);
  // ponytail: dưới 1 m tự đệm "0."; cao độ trên 999 m sẽ sai nhóm (cùng giới hạn với floorFormat.ts).
  const body = absolute < 1000 ? `0.${String(absolute).padStart(3, '0')}` : formatNumber(absolute, { fractionDigits: 0 });

  return `${rounded > 0 ? '+' : MINUS_SIGN}${body}`;
}

/** Chiều cao mm tách nghìn: 3600 → "3.600". */
const heightText = (valueMm: number): string => formatNumber(Math.round(valueMm), { fractionDigits: 0 });

const elevationDeltaText = (deltaMm: number): string => `${elevationText(deltaMm)} m`;
const heightDeltaText = (deltaMm: number): string =>
  `${deltaMm > 0 ? '+' : MINUS_SIGN}${heightText(Math.abs(deltaMm))} mm`;

/* -------------------------------------------------------------------------- */
/* Ô số.                                                                       */
/* -------------------------------------------------------------------------- */

interface FieldSpec {
  readonly proposedMm: number | undefined;
  readonly confidence: number | undefined;
  readonly source: HouseLevelSource | undefined;
  readonly currentMm: number;
  readonly range: { readonly min: number; readonly max: number };
  readonly textOf: (valueMm: number) => string;
  readonly deltaTextOf: (deltaMm: number) => string;
}

function buildField(spec: FieldSpec): HouseFieldVm {
  const { proposedMm, currentMm } = spec;
  const currentText = spec.textOf(currentMm);

  if (proposedMm === undefined) {
    return {
      hasProposal: false,
      proposedMm: null,
      proposedText: MISSING_VALUE,
      currentText,
      differs: false,
      deltaText: null,
      statusCode: 'neutral',
      confidence: null,
      confidenceLabel: null,
      sourceText: null,
      acceptable: false,
      oneClick: false,
    };
  }
  // Có giá trị mà thiếu độ chắc: coi là 0 (không biết thì không tin).
  const confidence = spec.confidence ?? 0;
  const differs = proposedMm !== currentMm;
  const inRange = proposedMm >= spec.range.min && proposedMm <= spec.range.max;

  return {
    hasProposal: true,
    proposedMm,
    proposedText: spec.textOf(proposedMm),
    currentText,
    differs,
    deltaText: differs ? spec.deltaTextOf(proposedMm - currentMm) : null,
    statusCode: statusOfConfidence(confidence),
    confidence,
    confidenceLabel: confidenceLabelOf(confidence),
    sourceText: spec.source === undefined ? null : SOURCE_TEXTS[spec.source],
    acceptable: differs && inRange,
    oneClick: false, // cần biết câu hỏi của dòng: `proposedRow` tính lại
  };
}

/* -------------------------------------------------------------------------- */
/* Dòng.                                                                       */
/* -------------------------------------------------------------------------- */

function noProposalRow(floor: HouseProjectFloor): HouseProposalRowVm {
  const empty = (textOf: (v: number) => string, currentMm: number, range: FieldSpec['range']): HouseFieldVm =>
    buildField({
      proposedMm: undefined,
      confidence: undefined,
      source: undefined,
      currentMm,
      range,
      textOf,
      deltaTextOf: String,
    });

  return {
    floorId: floor.id,
    floorName: floor.name,
    hasProposal: false,
    noProposalText: NO_PROPOSAL_TEXT,
    storeyText: MISSING_VALUE,
    storeyStatusCode: 'neutral',
    storeyConfidenceLabel: null,
    elevation: empty(elevationText, floor.elevationMm, HOUSE_ELEVATION_RANGE_MM),
    height: empty(heightText, floor.heightMm, HOUSE_HEIGHT_RANGE_MM),
    minConfidence: null,
    statusCode: 'neutral',
    questions: [],
    oneClick: false,
    needsLook: false,
    anyAcceptable: false,
  };
}

function proposedRow(floor: HouseProjectFloor, proposal: HouseFloorProposal): HouseProposalRowVm {
  const elevationBase = buildField({
    proposedMm: proposal.elevationMm,
    confidence: proposal.elevationConfidence,
    source: proposal.elevationSource,
    currentMm: floor.elevationMm,
    range: HOUSE_ELEVATION_RANGE_MM,
    textOf: elevationText,
    deltaTextOf: elevationDeltaText,
  });
  const heightBase = buildField({
    proposedMm: proposal.heightMm,
    confidence: proposal.heightConfidence,
    source: proposal.heightSource,
    currentMm: floor.heightMm,
    range: HOUSE_HEIGHT_RANGE_MM,
    textOf: heightText,
    deltaTextOf: heightDeltaText,
  });
  const questions = [...new Set(proposal.questions.map((question) => question.code))].map(
    (code) => HOUSE_QUESTION_TEXTS[code],
  );
  const withOneClick = (field: HouseFieldVm): HouseFieldVm => ({
    ...field,
    oneClick: field.acceptable && (field.confidence ?? 0) >= HOUSE_CONFIDENCE_LOW && questions.length === 0,
  });
  const elevation = withOneClick(elevationBase);
  const height = withOneClick(heightBase);
  const confidences = [proposal.storeyConfidence];

  for (const field of [elevation, height]) {
    if (field.confidence !== null) {
      confidences.push(field.confidence);
    }
  }
  const minConfidence = Math.min(...confidences);
  const anyAcceptable = elevation.acceptable || height.acceptable;

  return {
    floorId: floor.id,
    floorName: floor.name,
    hasProposal: true,
    noProposalText: null,
    storeyText: storeyTextOf(proposal.storeyLabel, proposal.storeyNo),
    storeyStatusCode: statusOfConfidence(proposal.storeyConfidence),
    storeyConfidenceLabel: confidenceLabelOf(proposal.storeyConfidence),
    elevation,
    height,
    minConfidence,
    statusCode: statusOfConfidence(minConfidence),
    questions,
    oneClick: elevation.oneClick || height.oneClick,
    needsLook: minConfidence < HOUSE_CONFIDENCE_LOW,
    anyAcceptable,
  };
}

/**
 * Một dòng cho mỗi tầng của dự án, đúng thứ tự tầng của dự án (`order`); tầng máy đề xuất mà dự án
 * không có thì bỏ. Không xếp lại theo độ chắc: hai bảng trên một màn phải cùng thứ tự.
 */
export function toHouseProposalRows(
  proposal: HouseProposal,
  floors: readonly HouseProjectFloor[],
): readonly HouseProposalRowVm[] {
  const byFloorId = new Map(proposal.floors.map((entry) => [entry.floorId, entry]));

  return [...floors]
    .sort((a, b) => a.order - b.order)
    .map((floor) => {
      const entry = byFloorId.get(floor.id);
      return entry === undefined ? noProposalRow(floor) : proposedRow(floor, entry);
    });
}

/* -------------------------------------------------------------------------- */
/* Thanh tóm tắt.                                                              */
/* -------------------------------------------------------------------------- */

const count = (n: number): string => formatNumber(n, { fractionDigits: 0 });

export function summarise(rows: readonly HouseProposalRowVm[]): HouseProposalSummary {
  const proposed = rows.filter((row) => row.hasProposal);
  const differingCount = proposed.filter((row) => row.elevation.differs || row.height.differs).length;
  const needsLookCount = proposed.filter((row) => row.needsLook).length;
  const oneClickCount = proposed.reduce((sum, row) => sum + Number(row.elevation.oneClick) + Number(row.height.oneClick), 0);
  const headline =
    differingCount === 0
      ? 'Máy không đề xuất thay đổi nào.'
      : `${count(differingCount)} tầng có đề xuất khác giá trị hiện tại, ${count(needsLookCount)} cần xem.`;
  const isEmpty = differingCount === 0 && proposed.every((row) => row.questions.length === 0);

  return { proposedCount: proposed.length, differingCount, needsLookCount, oneClickCount, isEmpty, headline };
}
