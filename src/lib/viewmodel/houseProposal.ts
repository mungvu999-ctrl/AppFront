/**
 * Lớp trình bày của bảng "Đề xuất của máy cho cả nhà" (Mức 3, lát cắt 1).
 *
 * Hàm thuần: nhận `HouseProposal` của máy và các tầng của dự án, trả dòng bảng đã viết sẵn chữ. Luật
 * "nhận được" của từng ô nằm ở MỘT chỗ là file này; view chỉ đặt chữ (A15) và ánh xạ `statusCode` (A1).
 *
 * Luật A5: đầu ra của máy không bao giờ mang mã `verified`. Không có "nhận tất cả" ở lát cắt này.
 *
 * Nhận được khi:
 * - nguồn là số ĐỌC trên bản vẽ (`plan`, `plan+section`, `section`, `dims`); `convention`/`default` là
 *   giá trị thường gặp, nguồn lạ hay thiếu là chưa rõ: không bao giờ nhận được;
 * - độ chắc của ô có và từ {@link HOUSE_CONFIDENCE_LOW} trở lên; bản vẽ của tầng là mặt bằng (`kind: 'plan'`);
 * - khác hiện tại, trong khoảng, dòng không có câu hỏi cả dòng, ô không có câu hỏi của chính nó;
 * - chiều cao: tầng không phải tầng hầm (đổi chiều cao tầng hầm dời tầng ±0.000 phía trên);
 * - cao độ: chỉ tầng thấp nhất (mốc của chồng) và chỉ khi không chạm tầng trên — lệnh đổi cao độ chỉ
 *   dời đúng tầng đó. Tầng khác: cao độ máy đọc chỉ để đối chiếu với cộng dồn chiều cao (`elevationCheck`).
 */

import type { HouseFloorProposal, HouseProposal } from '@/api/schemas/houseProposal';
import { HOUSE_ELEVATION_RANGE_MM, HOUSE_HEIGHT_RANGE_MM } from '@/api/schemas/houseProposal';
import { formatNumber, MISSING_VALUE } from '@/lib/format/number';

import {
  elevationDeltaText,
  elevationWithUnit,
  heightWithUnit,
  type HouseQuestionsFor,
  type HouseSourceKind,
  mmDeltaText,
  questionsOf,
  restackWithHeights,
  sourceOf,
} from './houseProposalParts';
import type { ViewStatusCode } from './types';

export type { HouseQuestionsFor, HouseSourceKind } from './houseProposalParts';

/** Từ mức này trở lên: máy khá chắc. */
export const HOUSE_CONFIDENCE_HIGH = 0.9;
/** Dưới mức này: dòng cần xem. */
export const HOUSE_CONFIDENCE_LOW = 0.7;
/** Cao độ máy đọc lệch cộng dồn chiều cao quá mức này thì đáng mở bản vẽ. */
export const HOUSE_ELEVATION_AGREE_MM = 50;

export const HOUSE_ASSUMED_HINT = 'Giá trị thường gặp, máy không đọc được trên bản vẽ';
const TYPE_IT_TEXT = 'Nếu biết giá trị đúng, gõ vào bảng tầng.';
const NO_PROPOSAL_TEXT = 'Máy chưa có đề xuất cho tầng này';
const UNKNOWN_STOREY_TEXT = 'Chưa rõ tầng';

const STOREY_TEXTS: ReadonlyMap<string, string> = new Map([
  ['ground', 'Tầng trệt'],
  ['basement', 'Tầng hầm'],
  ['mezzanine', 'Tầng lửng'],
  ['attic', 'Tầng áp mái'],
  ['tum', 'Tầng tum'],
  ['roof_terrace', 'Sân thượng'],
]);

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
  /** Số thô cho lệnh "Nhận"; `null` khi máy không đề xuất. */
  readonly proposedMm: number | null;
  /** Có đơn vị: `"+6.900 m"`, `"3.300 mm"`; `—` khi không có. */
  readonly proposedText: string;
  readonly currentText: string;
  readonly differs: boolean;
  /** Chênh có dấu và đơn vị: `"+0.600 m"`, `"−300 mm"`; `null` khi không khác. */
  readonly deltaText: string | null;
  readonly statusCode: ViewStatusCode;
  readonly confidence: number | null;
  readonly confidenceLabel: string | null;
  readonly sourceKind: HouseSourceKind | null;
  readonly sourceText: string | null;
  /** {@link HOUSE_ASSUMED_HINT} khi nguồn là giá trị thường gặp. */
  readonly hint: string | null;
  readonly acceptable: boolean;
  /** Ô khác hiện tại mà không nhận được: vì sao, và bảo người dùng gõ tay. `null` khi nhận được hoặc không khác. */
  readonly blockedReason: string | null;
  /** Nhận ô này sẽ làm gì thêm (dời tầng trên, để hở dưới tầng trên); `null` khi không có gì thêm. */
  readonly effectText: string | null;
}

/** Một tầng phía trên mà việc nhận chiều cao sẽ dời. */
export interface HouseCascadeEntry {
  readonly floorId: string;
  readonly floorName: string;
  readonly shiftMm: number;
  readonly shiftText: string;
}

/** Cao độ máy đọc so với cao độ chồng tầng sẽ cho (sau khi nhận các chiều cao nhận được bên dưới). */
export interface HouseElevationCheck {
  readonly stackedMm: number;
  readonly stackedText: string;
  readonly differenceMm: number;
  readonly agrees: boolean;
  readonly text: string;
}

export interface HouseProposalRowVm {
  readonly floorId: string;
  readonly floorName: string;
  readonly hasProposal: boolean;
  readonly noProposalText: string | null;
  readonly storeyText: string;
  readonly storeyStatusCode: ViewStatusCode;
  readonly storeyConfidenceLabel: string | null;
  readonly elevation: HouseFieldVm;
  readonly height: HouseFieldVm;
  readonly minConfidence: number | null;
  readonly statusCode: ViewStatusCode;
  /** Câu hỏi theo ô: `row` in trên cả dòng, hai ô còn lại in dưới ô của nó. */
  readonly questionsFor: HouseQuestionsFor;
  /** Số mã câu hỏi giao diện chưa biết (bỏ, không in). */
  readonly unknownQuestions: number;
  /** Tầng phía trên sẽ dời khi nhận chiều cao; rỗng khi chiều cao không nhận được. */
  readonly cascade: readonly HouseCascadeEntry[];
  /** Chỉ ở tầng không phải mốc, có cao độ máy đọc; câu "khớp" bị bỏ khi cao độ là giá trị thường gặp hoặc chưa chắc. */
  readonly elevationCheck: HouseElevationCheck | null;
  readonly anyAcceptable: boolean;
  /** Cần xem: có câu hỏi, bản vẽ không phải mặt bằng, độ chắc dưới 0,7, hoặc cao độ lệch cộng dồn. */
  readonly needsLook: boolean;
}

export interface HouseProposalSummary {
  readonly proposedCount: number;
  readonly differingCount: number;
  /** Số TẦNG có ít nhất một ô nhận được. */
  readonly acceptableCount: number;
  /** Số TẦNG cần xem. */
  readonly needsLookCount: number;
  readonly isEmpty: boolean;
  readonly headline: string;
}

/* -------------------------------------------------------------------------- */
/* Độ chắc và chữ.                                                             */
/* -------------------------------------------------------------------------- */

export function statusOfConfidence(confidence: number | null | undefined): ViewStatusCode {
  if (confidence === null || confidence === undefined || confidence >= HOUSE_CONFIDENCE_HIGH) {
    return 'neutral';
  }
  return confidence >= HOUSE_CONFIDENCE_LOW ? 'attention' : 'violation';
}

/**
 * Chữ của chip một ô số: lời lấy từ LOẠI NGUỒN, độ chắc chỉ chọn màu chip (`statusOfConfidence`) và
 * tách "Chưa chắc". "Hai nguồn khớp" chỉ khi máy đọc cả mặt bằng lẫn mặt cắt và khá chắc.
 */
export function confidenceLabelOf(confidence: number, source: string | undefined): string {
  const { kind } = sourceOf(source);

  if (kind === 'assumed') {
    return 'Giá trị thường gặp';
  }
  if (kind === 'unknown') {
    return 'Nguồn chưa rõ';
  }
  if (confidence < HOUSE_CONFIDENCE_LOW) {
    return 'Chưa chắc';
  }
  if (source === 'plan+section') {
    return confidence >= HOUSE_CONFIDENCE_HIGH ? 'Hai nguồn khớp' : 'Đọc trên hai nguồn';
  }
  return 'Một nguồn';
}

/** Chữ của chip ô tầng. Dây chỉ có `storeyConfidence` (không có nguồn), nên không bao giờ nói "hai nguồn". */
export function storeyConfidenceLabelOf(confidence: number, storeyText: string): string {
  return storeyText !== UNKNOWN_STOREY_TEXT && confidence >= HOUSE_CONFIDENCE_HIGH ? 'Máy khá chắc' : 'Chưa chắc';
}

export function storeyTextOf(label: string | undefined, storeyNo: number | undefined): string {
  if (label === 'floor') {
    return storeyNo === undefined || storeyNo < 1
      ? UNKNOWN_STOREY_TEXT
      : `Tầng ${formatNumber(storeyNo, { fractionDigits: 0, grouping: false })}`;
  }
  return (label === undefined ? undefined : STOREY_TEXTS.get(label)) ?? UNKNOWN_STOREY_TEXT;
}

const count = (n: number): string => formatNumber(n, { fractionDigits: 0 });
const inRange = (value: number, range: { readonly min: number; readonly max: number }): boolean =>
  value >= range.min && value <= range.max;

/* -------------------------------------------------------------------------- */
/* Ô số.                                                                       */
/* -------------------------------------------------------------------------- */

interface FieldInput {
  readonly proposedMm: number | undefined;
  readonly confidence: number | undefined;
  readonly source: string | undefined;
  readonly currentMm: number;
  readonly withUnit: (valueMm: number) => string;
  readonly deltaOf: (deltaMm: number) => string;
  readonly range: { readonly min: number; readonly max: number };
  /** Lý do riêng của ô khiến nó không nhận được dù số đọc tốt; `null` khi không có. */
  readonly blockedBy: string | null;
  readonly effectText: string | null;
}

function buildField(input: FieldInput): HouseFieldVm {
  const { proposedMm, currentMm } = input;
  const currentText = input.withUnit(currentMm);

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
      sourceKind: null,
      sourceText: null,
      hint: null,
      acceptable: false,
      blockedReason: null,
      effectText: null,
    };
  }
  const confidence = input.confidence ?? 0;
  const source = sourceOf(input.source);
  const differs = proposedMm !== currentMm;
  const blockedBy =
    source.kind === 'assumed'
      ? `${HOUSE_ASSUMED_HINT}. ${TYPE_IT_TEXT}`
      : source.kind === 'unknown'
        ? `Không rõ máy lấy số này từ đâu. ${TYPE_IT_TEXT}`
        : input.confidence === undefined || input.confidence < HOUSE_CONFIDENCE_LOW
          ? `Máy chưa chắc số này. ${TYPE_IT_TEXT}`
          : !inRange(proposedMm, input.range)
            ? `Số nằm ngoài khoảng cho phép. ${TYPE_IT_TEXT}`
            : input.blockedBy;
  const acceptable = differs && blockedBy === null;

  return {
    hasProposal: true,
    proposedMm,
    proposedText: input.withUnit(proposedMm),
    currentText,
    differs,
    deltaText: differs ? input.deltaOf(proposedMm - currentMm) : null,
    statusCode: statusOfConfidence(confidence),
    confidence,
    confidenceLabel: confidenceLabelOf(confidence, input.source),
    sourceKind: source.kind,
    sourceText: source.text,
    hint: source.kind === 'assumed' ? HOUSE_ASSUMED_HINT : null,
    acceptable,
    blockedReason: differs && !acceptable ? blockedBy : null,
    effectText: acceptable ? input.effectText : null,
  };
}

/* -------------------------------------------------------------------------- */
/* Dòng.                                                                       */
/* -------------------------------------------------------------------------- */

const NO_QUESTIONS: HouseQuestionsFor = { row: [], elevation: [], height: [] };

function emptyField(currentMm: number, withUnit: (valueMm: number) => string): HouseFieldVm {
  return buildField({
    proposedMm: undefined,
    confidence: undefined,
    source: undefined,
    currentMm,
    withUnit,
    deltaOf: String,
    range: HOUSE_HEIGHT_RANGE_MM,
    blockedBy: null,
    effectText: null,
  });
}

function noProposalRow(floor: HouseProjectFloor): HouseProposalRowVm {
  return {
    floorId: floor.id,
    floorName: floor.name,
    hasProposal: false,
    noProposalText: NO_PROPOSAL_TEXT,
    storeyText: MISSING_VALUE,
    storeyStatusCode: 'neutral',
    storeyConfidenceLabel: null,
    elevation: emptyField(floor.elevationMm, elevationWithUnit),
    height: emptyField(floor.heightMm, heightWithUnit),
    minConfidence: null,
    statusCode: 'neutral',
    questionsFor: NO_QUESTIONS,
    unknownQuestions: 0,
    cascade: [],
    elevationCheck: null,
    anyAcceptable: false,
    needsLook: false,
  };
}

const isBasement = (floor: HouseProjectFloor, proposal: HouseFloorProposal): boolean =>
  proposal.storeyLabel === 'basement' ||
  (proposal.storeyNo !== undefined && proposal.storeyNo < 1) ||
  floor.elevationMm < 0;

/** Câu dời tầng: "Nhận sẽ dời cao độ Tầng 2, Tầng 3 (−300 mm)." — gộp khi mọi tầng dời cùng một khoảng. */
export function cascadeTextOf(cascade: readonly HouseCascadeEntry[]): string | null {
  const first = cascade[0];

  if (first === undefined) {
    return null;
  }
  const list = cascade.every((entry) => entry.shiftMm === first.shiftMm)
    ? `${cascade.map((entry) => entry.floorName).join(', ')} (${first.shiftText})`
    : cascade.map((entry) => `${entry.floorName} (${entry.shiftText})`).join(', ');

  return `Nhận sẽ dời cao độ ${list}.`;
}

/** Ngữ cảnh chồng tầng của một dòng. */
interface StackPlace {
  readonly floors: readonly HouseProjectFloor[];
  readonly index: number;
  /** Cao độ chồng sẽ cho mỗi tầng sau khi nhận mọi chiều cao nhận được. */
  readonly stackedMm: readonly number[];
  /** Chiều cao đề xuất nhận được đã tính vào `stackedMm`. */
  readonly newHeights: ReadonlyMap<string, number>;
}

function cascadeOf(place: StackPlace, newHeightMm: number): HouseCascadeEntry[] {
  const floor = place.floors[place.index];
  const restacked = restackWithHeights(place.floors, new Map(floor === undefined ? [] : [[floor.id, newHeightMm]]));

  return place.floors.flatMap((above, index) => {
    const shiftMm = (restacked[index] ?? above.elevationMm) - above.elevationMm;
    return index > place.index && shiftMm !== 0
      ? [{ floorId: above.id, floorName: above.name, shiftMm, shiftText: mmDeltaText(shiftMm) }]
      : [];
  });
}

function anchorElevation(place: StackPlace, floor: HouseProjectFloor, proposedMm: number | undefined) {
  const above = place.floors[place.index + 1];

  if (proposedMm === undefined || above === undefined) {
    return { blockedBy: null, effectText: null };
  }
  const gapMm = above.elevationMm - (proposedMm + floor.heightMm);

  if (gapMm < 0) {
    return { blockedBy: `Đặt ở cao độ này thì tầng chạm lên ${above.name}. ${TYPE_IT_TEXT}`, effectText: null };
  }
  return {
    blockedBy: null,
    effectText: gapMm > 0 ? `Nhận sẽ để hở ${heightWithUnit(gapMm)} dưới ${above.name}; tầng đó thành "Ghi đè".` : null,
  };
}

/**
 * Đối chiếu cao độ máy đọc với chồng tầng. Câu "khớp" chỉ ra khi chính cao độ là số đọc đủ chắc —
 * một giá trị thường gặp "khớp" thì không nói lên gì. Câu nói rõ chồng tính bằng chiều cao nào.
 */
function elevationCheckOf(
  place: StackPlace,
  proposal: Pick<HouseFloorProposal, 'elevationMm' | 'elevationConfidence' | 'elevationSource'>,
): HouseElevationCheck | null {
  const proposedMm = proposal.elevationMm;
  const stackedMm = place.stackedMm[place.index];

  if (place.index === 0 || proposedMm === undefined || stackedMm === undefined) {
    return null;
  }
  const differenceMm = proposedMm - stackedMm;
  const agrees = Math.abs(differenceMm) <= HOUSE_ELEVATION_AGREE_MM;
  const trusted =
    sourceOf(proposal.elevationSource).kind === 'read' && (proposal.elevationConfidence ?? 0) >= HOUSE_CONFIDENCE_LOW;

  if (agrees && !trusted) {
    return null;
  }
  const basis = place.floors.slice(0, place.index).some((below) => place.newHeights.has(below.id))
    ? 'cộng dồn chiều cao nếu nhận chiều cao đề xuất của các tầng dưới'
    : 'cộng dồn chiều cao hiện tại của các tầng dưới';

  return {
    stackedMm,
    stackedText: elevationWithUnit(stackedMm),
    differenceMm,
    agrees,
    text: agrees
      ? `Khớp với ${basis}.`
      : `Lệch ${heightWithUnit(Math.abs(differenceMm))} so với ${basis}. Xem cốt trên bản vẽ.`,
  };
}

function proposedRow(place: StackPlace, proposal: HouseFloorProposal): HouseProposalRowVm {
  const floor = place.floors[place.index] as HouseProjectFloor;
  const { questionsFor, unknownQuestions } = questionsOf(proposal.questions);
  const notAPlan = proposal.kind !== 'plan';
  const rowBlocked =
    questionsFor.row.length > 0
      ? `Dòng còn câu hỏi. ${TYPE_IT_TEXT}`
      : notAPlan
        ? `Bản vẽ của tầng này không phải mặt bằng. ${TYPE_IT_TEXT}`
        : null;
  const askedBlocked = (asked: readonly string[]): string | null =>
    rowBlocked ?? (asked.length > 0 ? `Còn câu hỏi ở ô này. ${TYPE_IT_TEXT}` : null);

  const isAnchor = place.index === 0;
  const anchor = anchorElevation(place, floor, proposal.elevationMm);
  const elevation = buildField({
    proposedMm: proposal.elevationMm,
    confidence: proposal.elevationConfidence,
    source: proposal.elevationSource,
    currentMm: floor.elevationMm,
    withUnit: elevationWithUnit,
    deltaOf: elevationDeltaText,
    range: HOUSE_ELEVATION_RANGE_MM,
    // Tầng không phải mốc: cao độ do chồng tầng quyết định, ô chỉ để đối chiếu (không lý do, không nút).
    blockedBy: isAnchor ? (askedBlocked(questionsFor.elevation) ?? anchor.blockedBy) : '',
    effectText: anchor.effectText,
  });
  const heightBlocked =
    askedBlocked(questionsFor.height) ??
    (isBasement(floor, proposal) ? `Tầng hầm: đổi chiều cao sẽ dời tầng ±0.000 phía trên. ${TYPE_IT_TEXT}` : null);
  const heightCascade =
    proposal.heightMm === undefined || heightBlocked !== null ? [] : cascadeOf(place, proposal.heightMm);
  const height = buildField({
    proposedMm: proposal.heightMm,
    confidence: proposal.heightConfidence,
    source: proposal.heightSource,
    currentMm: floor.heightMm,
    withUnit: heightWithUnit,
    deltaOf: mmDeltaText,
    range: HOUSE_HEIGHT_RANGE_MM,
    blockedBy: heightBlocked,
    effectText: cascadeTextOf(heightCascade),
  });
  const elevationField = isAnchor ? elevation : { ...elevation, blockedReason: null };
  const confidences = [proposal.storeyConfidence, elevation.confidence, height.confidence].filter(
    (value): value is number => value !== null,
  );
  const minConfidence = Math.min(...confidences);
  const elevationCheck = elevationCheckOf(place, proposal);
  const storeyText = storeyTextOf(proposal.storeyLabel, proposal.storeyNo);
  const asked = questionsFor.row.length + questionsFor.elevation.length + questionsFor.height.length > 0;

  return {
    floorId: floor.id,
    floorName: floor.name,
    hasProposal: true,
    noProposalText: null,
    storeyText,
    storeyStatusCode: statusOfConfidence(proposal.storeyConfidence),
    storeyConfidenceLabel: storeyConfidenceLabelOf(proposal.storeyConfidence, storeyText),
    elevation: elevationField,
    height,
    minConfidence,
    statusCode: statusOfConfidence(minConfidence),
    questionsFor,
    unknownQuestions,
    cascade: height.acceptable ? heightCascade : [],
    elevationCheck,
    anyAcceptable: elevationField.acceptable || height.acceptable,
    needsLook: asked || notAPlan || minConfidence < HOUSE_CONFIDENCE_LOW || elevationCheck?.agrees === false,
  };
}

/**
 * Một dòng cho mỗi tầng của dự án, đúng thứ tự tầng (`order`); tầng máy đề xuất mà dự án không có
 * thì bỏ. Không xếp lại theo độ chắc: hai bảng trên một màn phải cùng thứ tự.
 */
export function toHouseProposalRows(
  proposal: HouseProposal,
  floors: readonly HouseProjectFloor[],
): readonly HouseProposalRowVm[] {
  const byFloorId = new Map(proposal.floors.map((entry) => [entry.floorId, entry]));
  const ordered = [...floors].sort((a, b) => a.order - b.order);
  // Lượt 1: chiều cao nhận được (không cần `stackedMm`) → chồng tầng sau khi nhận hết, cho `elevationCheck`.
  // ponytail: nhận đồng thời với tầng "Ghi đè" đọc từ chồng hiện tại; nhận lần lượt có thể khác khi
  // một tầng Ghi đè bị đẩy lên rồi mất cờ — ca hiếm, số đối chiếu chỉ để tham khảo.
  const draft = ordered.map((floor, index) => {
    const entry = byFloorId.get(floor.id);
    return entry === undefined ? null : proposedRow({ floors: ordered, index, stackedMm: [], newHeights: new Map() }, entry);
  });
  const newHeights = new Map(
    draft.flatMap((row) => (row?.height.acceptable === true && row.height.proposedMm !== null ? [[row.floorId, row.height.proposedMm]] : [])),
  );
  const stackedMm = restackWithHeights(ordered, newHeights);

  return ordered.map((floor, index) => {
    const entry = byFloorId.get(floor.id);
    return entry === undefined ? noProposalRow(floor) : proposedRow({ floors: ordered, index, stackedMm, newHeights }, entry);
  });
}

/* -------------------------------------------------------------------------- */
/* Thanh tóm tắt.                                                              */
/* -------------------------------------------------------------------------- */

export function summarise(rows: readonly HouseProposalRowVm[]): HouseProposalSummary {
  const proposed = rows.filter((row) => row.hasProposal);
  const differingCount = proposed.filter((row) => row.elevation.differs || row.height.differs).length;
  const acceptableCount = proposed.filter((row) => row.anyAcceptable).length;
  const needsLookCount = proposed.filter((row) => row.needsLook).length;
  const isEmpty = differingCount === 0 && needsLookCount === 0;
  const parts = [
    acceptableCount > 0 ? `${count(acceptableCount)} tầng có giá trị nhận được` : null,
    needsLookCount > 0 ? `${count(needsLookCount)} tầng cần xem` : null,
  ].filter((part): part is string => part !== null);
  const headline = isEmpty
    ? 'Máy không đề xuất thay đổi nào.'
    : parts.length === 0
      ? `${count(differingCount)} tầng có đề xuất khác hiện tại, chưa giá trị nào nhận được.`
      : `${parts.join(', ')}.`;

  return { proposedCount: proposed.length, differingCount, acceptableCount, needsLookCount, isEmpty, headline };
}
