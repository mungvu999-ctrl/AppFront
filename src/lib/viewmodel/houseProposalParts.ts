/**
 * Phần phụ của `houseProposal.ts`: cách viết số, câu hỏi theo ô, nguồn số đọc, và luật xếp chồng tầng.
 *
 * Số viết như màn Quản lý tầng (`FloorManager/floorFormat.ts`): cao độ mét có dấu (`+3.600`, `±0.000`),
 * chiều cao mm tách nghìn (`3.600`). `src/lib` không được nhập `src/screens`, nên đây là bản chép;
 * `FloorManager/houseProposalFormat.drift.test.ts` giữ hai bản cho cùng chuỗi.
 *
 * Luật xếp chồng chép từ `restack` (`src/lib/commands/business/roomFloorCommands.ts`, không xuất) đúng
 * như cổng màn gọi khi đổi chiều cao (`floorManagerGateway.ts`: tầng "Ghi đè" đọc TRƯỚC khi đổi);
 * `houseProposalParts.test.ts` ghim bản chép vào lệnh thật.
 */

import { compareNearly } from '@/domain/units/compare';
import { formatNumber } from '@/lib/format/number';

const MINUS_SIGN = '−';

/* -------------------------------------------------------------------------- */
/* Số.                                                                         */
/* -------------------------------------------------------------------------- */

/** Cao độ mét có dấu, như cột "Cao độ (m)": 3600 → "+3.600", 0 → "±0.000". */
export function elevationSignedText(valueMm: number): string {
  const rounded = Math.round(valueMm);

  if (rounded === 0) {
    return '±0.000';
  }
  const absolute = Math.abs(rounded);
  // ponytail: dưới 1 m tự đệm "0."; cao độ trên 999 m sẽ sai nhóm (cùng giới hạn với floorFormat.ts).
  const body = absolute < 1000 ? `0.${String(absolute).padStart(3, '0')}` : formatNumber(absolute, { fractionDigits: 0 });

  return `${rounded > 0 ? '+' : MINUS_SIGN}${body}`;
}

/** Chiều cao mm tách nghìn, như cột "Chiều cao (mm)": 3600 → "3.600". */
export const heightMmText = (valueMm: number): string => formatNumber(Math.round(valueMm), { fractionDigits: 0 });

/** Có đơn vị, cho bảng đề xuất: "+6.900 m", "3.300 mm". */
export const elevationWithUnit = (valueMm: number): string => `${elevationSignedText(valueMm)} m`;
export const heightWithUnit = (valueMm: number): string => `${heightMmText(valueMm)} mm`;
/** Chênh lệch có dấu: "+0.600 m", "−300 mm". */
export const elevationDeltaText = (deltaMm: number): string => elevationWithUnit(deltaMm);
export const mmDeltaText = (deltaMm: number): string =>
  `${deltaMm > 0 ? '+' : MINUS_SIGN}${heightMmText(Math.abs(deltaMm))} mm`;

/* -------------------------------------------------------------------------- */
/* Nguồn số đọc.                                                               */
/* -------------------------------------------------------------------------- */

/** `read`: đọc trên bản vẽ; `assumed`: giá trị thường gặp; `unknown`: nguồn lạ hoặc thiếu. */
export type HouseSourceKind = 'read' | 'assumed' | 'unknown';

const SOURCES: ReadonlyMap<string, { kind: HouseSourceKind; text: string }> = new Map([
  ['plan', { kind: 'read', text: 'mặt bằng' }],
  ['plan+section', { kind: 'read', text: 'mặt bằng và mặt cắt' }],
  ['section', { kind: 'read', text: 'mặt cắt' }],
  ['dims', { kind: 'read', text: 'kích thước ghi trên bản vẽ' }],
  ['convention', { kind: 'assumed', text: 'quy ước' }],
  ['default', { kind: 'assumed', text: 'giả định' }],
]);

export function sourceOf(source: string | undefined): { kind: HouseSourceKind; text: string } {
  return (source === undefined ? undefined : SOURCES.get(source)) ?? { kind: 'unknown', text: 'nguồn chưa rõ' };
}

/* -------------------------------------------------------------------------- */
/* Câu hỏi theo ô.                                                             */
/* -------------------------------------------------------------------------- */

export type HouseQuestionScope = 'row' | 'elevation' | 'height';

/**
 * Mã câu hỏi → ô nó chạm và câu cho người dùng (bắt đầu bằng tên ô, nói xem gì trên bản vẽ).
 * `row`: cả dòng không nhận được. `NO_TEXT` (máy không đọc được chữ) cũng là cả dòng: tầng không có căn cứ.
 */
export const HOUSE_QUESTIONS: ReadonlyMap<string, { scope: HouseQuestionScope; text: string }> = new Map(
  Object.entries({
  STOREY_UNSURE: { scope: 'row', text: 'Tầng: máy chưa chắc đây là tầng nào. Xem tên tầng ghi dưới bản vẽ.' },
  STOREY_CONFLICT: { scope: 'row', text: 'Tầng: chữ trên bản vẽ chỉ về hai tầng khác nhau. Xem tên tầng và chọn tầng đúng.' },
  ORDER_DIFFERS: { scope: 'row', text: 'Thứ tự: máy xếp tầng này khác thứ tự trong dự án. Xem lại thứ tự các tầng.' },
  NOT_A_PLAN: { scope: 'row', text: 'Bản vẽ: có vẻ không phải mặt bằng. Xem đã gắn đúng bản vẽ cho tầng này chưa.' },
  NO_TEXT: { scope: 'row', text: 'Bản vẽ: máy không đọc được chữ. Xem bản vẽ có rõ không, tải bản rõ hơn nếu cần.' },
  LEVEL_MISSING: { scope: 'elevation', text: 'Cao độ: bản vẽ không ghi cốt tầng này. Xem cốt ở mặt cắt hoặc mặt đứng.' },
  HEIGHT_ASSUMED: {
    scope: 'height',
    text: 'Chiều cao: bản vẽ không ghi cốt tầng trên, máy lấy giá trị thường gặp. Xem cốt ở mặt cắt.',
  },
  } satisfies Record<string, { scope: HouseQuestionScope; text: string }>),
);

export interface HouseQuestionsFor {
  readonly row: readonly string[];
  readonly elevation: readonly string[];
  readonly height: readonly string[];
}

/** Câu hỏi chia theo ô; mã lạ bị bỏ và được đếm. Mã lặp chỉ ra một câu. */
export function questionsOf(codes: readonly string[]): { questionsFor: HouseQuestionsFor; unknownQuestions: number } {
  const known = { row: [] as string[], elevation: [] as string[], height: [] as string[] };
  let unknownQuestions = 0;

  for (const code of new Set(codes)) {
    const question = HOUSE_QUESTIONS.get(code);

    if (question === undefined) {
      unknownQuestions += 1;
    } else {
      known[question.scope].push(question.text);
    }
  }
  return { questionsFor: known, unknownQuestions };
}

/* -------------------------------------------------------------------------- */
/* Xếp chồng (bản chép của `restack`).                                         */
/* -------------------------------------------------------------------------- */

export interface StackFloor {
  readonly id: string;
  readonly elevationMm: number;
  readonly heightMm: number;
}

/** Cờ "Ghi đè" của bảng tầng (`isElevationOverridden`): cao độ khác đỉnh tầng dưới. Tầng dưới cùng không bao giờ. */
export const isOverridden = (floor: StackFloor, below: StackFloor | undefined): boolean =>
  below !== undefined && compareNearly(floor.elevationMm, below.elevationMm + below.heightMm) !== 0;

/**
 * Cao độ từng tầng (thứ tự từ dưới lên) sau khi đổi chiều cao theo `newHeights`.
 *
 * Như cổng màn: tầng "Ghi đè" đọc trên chồng TRƯỚC khi đổi và giữ cao độ khi vẫn nằm trên hoặc
 * bằng đỉnh tầng dưới; mọi tầng khác đặt lên tầng dưới; chồng dựng từ cao độ thấp nhất.
 */
export function restackWithHeights(
  floors: readonly StackFloor[],
  newHeights: ReadonlyMap<string, number>,
): number[] {
  const kept = new Set(floors.filter((floor, index) => isOverridden(floor, floors[index - 1])).map((floor) => floor.id));
  let topBelowMm = floors.length === 0 ? 0 : Math.min(...floors.map((floor) => floor.elevationMm));

  return floors.map((floor, index) => {
    const keep = index > 0 && kept.has(floor.id) && compareNearly(floor.elevationMm, topBelowMm) >= 0;
    const elevationMm = keep ? floor.elevationMm : topBelowMm;

    topBelowMm = elevationMm + (newHeights.get(floor.id) ?? floor.heightMm);
    return elevationMm;
  });
}
