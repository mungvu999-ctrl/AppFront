/**
 * Khối "Ngôi nhà" của màn duyệt bộ hồ sơ (NHA-08a): đề xuất của máy (`GET …/building`) → chữ để hiện.
 *
 * Thuần, không React. Mọi số định dạng ở đây (A15). Mỗi giá trị kèm một chip nói NGUỒN bằng chữ và độ tin;
 * chỉ số do người duyệt nhập mới mang màu "đã xác minh" (A5), đầu ra của máy không bao giờ.
 */

import type {
  BuildingConflict,
  BuildingDecisions,
  BuildingProposal,
  BuildingSource,
  Measured,
  RoofDecision,
  RoofSpec,
  RuleHit,
} from '@/api/schemas/setBuilding';
import { formatNumber, formatPercent } from '@/lib/format/number';

import { ROOF_MATERIALS, ruleSentence } from './buildingRules';
import { suggestedFloorName, type ReviewFloor, type ViewDraft } from './drawingSetReview';
import { statusOfConfidence } from './houseProposal';
import { elevationWithUnit, heightWithUnit, sourceOf } from './houseProposalParts';
import {
  EMPTY_DECISIONS,
  levelValueProblem,
  ROOF_FIELDS,
  type LevelField,
  type RoofField,
} from './setBuildingDecisions';
import { ROOF_FIELD_LABELS, roofTypedText } from './setBuildingRoofs';
import type { ViewStatusCode } from './types';

const UNKNOWN_LEVEL = 'Tầng chưa rõ';

export interface HouseCell {
  readonly text: string;
  /** Nguồn bằng chữ, kèm độ tin khi là đầu ra của máy. */
  readonly chip: string;
  readonly status: ViewStatusCode;
}

/** Phần sửa được của một ô tầng (NHA-08b). */
export interface HouseLevelEdit {
  /** Số người duyệt đã nhập trong bản nháp; hiện ngay, không chờ đọc lại. */
  readonly typedMm: number | undefined;
  /** Số của máy mà nút "Nhận" sẽ ghi; vắng khi máy chưa có số, số đã là của người duyệt, hoặc số ngoài dải gửi được. */
  readonly acceptMm: number | undefined;
}

export interface HouseLevelRow {
  readonly key: string;
  readonly name: string;
  /** `null` = máy chưa có giá trị cho ô này. */
  readonly elevation: HouseCell | null;
  readonly height: HouseCell | null;
  readonly elevationEdit: HouseLevelEdit;
  readonly heightEdit: HouseLevelEdit;
}

export interface HouseOption {
  readonly value: string;
  readonly label: string;
}

/** Cách sửa một dòng của thẻ mái (NHA-08c): ô số, ô chọn một, hoặc nút xoay 90°. */
export type HouseRoofEdit =
  /** `typedText`: chữ đặt sẵn vào ô sửa; rỗng khi người duyệt chưa nhập. */
  | { readonly kind: 'number'; readonly typedText: string }
  /** `value`: mã đang hiệu lực (đã nhập, không thì của máy); rỗng khi chưa có gì. */
  | { readonly kind: 'choice'; readonly value: string; readonly options: readonly HouseOption[] }
  /** `next`: số lần xoay sau một lần bấm, tính từ hướng đang hiệu lực. */
  | { readonly kind: 'turn'; readonly next: number };

export interface HouseRoofRow {
  readonly field: RoofField;
  readonly label: string;
  /** Nhãn viết thường, để đặt giữa câu của nhãn nút. */
  readonly lower: string;
  /** `null` = máy chưa có giá trị và người duyệt chưa nhập. */
  readonly cell: HouseCell | null;
  /** Giá trị đang hiện là của người duyệt (trong bản nháp), không phải của máy. */
  readonly isTyped: boolean;
  readonly edit: HouseRoofEdit;
}

export interface HouseRoofCard {
  readonly key: string;
  readonly title: string;
  /** Rỗng khi mái đã bị bỏ ("không dựng mái") và máy không còn đề xuất nó. */
  readonly rows: readonly HouseRoofRow[];
  readonly isSkipped: boolean;
}

export interface HouseConflict {
  readonly key: string;
  readonly title: string;
  readonly candidates: readonly {
    readonly text: string;
    /** Nguồn bằng chữ kèm độ tin. */
    readonly chip: string;
    /** Mã nguồn gửi lại khi người duyệt chọn. */
    readonly source: BuildingSource;
    readonly isChosen: boolean;
  }[];
}

export interface HouseViolationGroup {
  readonly level: RuleHit['level'];
  readonly title: string;
  readonly status: ViewStatusCode;
  /** `isSeen` chỉ có nghĩa với cảnh báo: người duyệt đã bấm "Đã xem". */
  readonly items: readonly { readonly key: string; readonly text: string; readonly isSeen: boolean }[];
}

export interface HouseBlockVm {
  readonly unitSystem: HouseCell;
  readonly levels: readonly HouseLevelRow[];
  readonly roofs: readonly HouseRoofCard[];
  readonly conflicts: readonly HouseConflict[];
  readonly violations: readonly HouseViolationGroup[];
}

/* -------------------------------------------------------------------------- */
/* Tên tầng.                                                                   */
/* -------------------------------------------------------------------------- */

/**
 * Mã hình → tên tầng để gọi trong khối: tên tầng mới người duyệt gõ, tên tầng có sẵn họ chọn, rồi mới tới
 * tầng máy đọc. Hình chưa có gì trong ba thứ đó không có mặt trong bảng.
 */
export function houseLevelNames(
  drafts: readonly ViewDraft[],
  floors: readonly ReviewFloor[],
): ReadonlyMap<string, string> {
  const floorNames = new Map(floors.map((floor) => [floor.id, floor.name]));
  const names = new Map<string, string>();

  for (const draft of drafts) {
    const chosen =
      draft.target.mode === 'newFloor'
        ? draft.target.name.trim()
        : draft.target.mode === 'floor'
          ? (floorNames.get(draft.target.floorId) ?? '')
          : '';
    const name = chosen.length > 0 ? chosen : suggestedFloorName(draft);

    if (name.length > 0) names.set(draft.id, name);
  }

  return names;
}

/* -------------------------------------------------------------------------- */
/* Giá trị và chip nguồn.                                                      */
/* -------------------------------------------------------------------------- */

const capital = (text: string): string => text.charAt(0).toUpperCase() + text.slice(1);

/** Số theo cách viết của trường; giá trị không phải số (BE đổi kiểu) hiện nguyên văn thay vì "NaN". */
const numeric =
  (write: (value: number) => string) =>
  (value: number | string): string =>
    typeof value === 'number' && Number.isFinite(value) ? write(value) : String(value);

const elevationText = numeric(elevationWithUnit);
const lengthText = numeric(heightWithUnit);
const pitchText = numeric((value) => `${formatNumber(value, { maxFractionDigits: 1 })}°`);
const turnsText = numeric((value) =>
  value === 0 ? 'Không xoay' : `Xoay ${formatNumber(value * 90, { fractionDigits: 0 })}°`,
);

const ROOF_FORMS: ReadonlyMap<string, string> = new Map([
  ['flat', 'Mái bằng'],
  ['shed', 'Mái một dốc'],
  ['gable', 'Mái hai dốc'],
  ['hip', 'Mái bốn dốc'],
]);
const UNIT_SYSTEMS: ReadonlyMap<string, string> = new Map([
  ['metric', 'Hệ mét'],
  ['imperial', 'Feet-inch'],
]);

const lookup =
  (table: ReadonlyMap<string, string>) =>
  (value: number | string): string =>
    table.get(String(value)) ?? String(value);
const materialText = (value: number | string): string => capital(lookup(ROOF_MATERIALS)(value));

function chipOf({ confidence, source }: Measured): Pick<HouseCell, 'chip' | 'status'> {
  if (source === 'reviewer') return { chip: 'Người duyệt nhập', status: 'verified' };
  const { kind, text } = sourceOf(source);
  const label =
    kind === 'read'
      ? `Máy đọc từ ${text}`
      : source === 'convention'
        ? 'Theo quy ước'
        : 'Máy giả định';

  return {
    chip: `${label} · ${formatPercent(confidence, { fractionDigits: 0 })}`,
    status: statusOfConfidence(confidence),
  };
}

const cellOf = (measured: Measured, write: (value: number | string) => string): HouseCell => ({
  text: write(measured.value),
  ...chipOf(measured),
});
const optionalCell = (
  measured: Measured | undefined,
  write: (value: number | string) => string,
): HouseCell | null => (measured === undefined ? null : cellOf(measured, write));

/* -------------------------------------------------------------------------- */
/* Khối.                                                                       */
/* -------------------------------------------------------------------------- */

const ROOF_WRITERS: Readonly<Record<RoofField, (value: number | string) => string>> = {
  form: lookup(ROOF_FORMS),
  pitchDeg: pitchText,
  quarterTurns: turnsText,
  eaveElevationMm: elevationText,
  ridgeElevationMm: elevationText,
  overhangMm: lengthText,
  material: materialText,
  parapetMm: lengthText,
};
const optionsOf = (table: ReadonlyMap<string, string>): readonly HouseOption[] =>
  [...table].map(([value, label]) => ({ value, label: capital(label) }));
const ROOF_CHOICES: Readonly<Partial<Record<RoofField, readonly HouseOption[]>>> = {
  form: optionsOf(ROOF_FORMS),
  material: optionsOf(ROOF_MATERIALS),
};

/** Một dòng của thẻ mái: số người duyệt nhập (nếu có) thay số của máy và mang chip "Người duyệt nhập". */
function roofRowOf(field: RoofField, measured: Measured | undefined, typed: number | string | undefined): HouseRoofRow {
  const shown: Measured | undefined =
    typed === undefined ? measured : { value: typed, confidence: 1, source: 'reviewer', viewIds: [] };
  const options = ROOF_CHOICES[field];
  // Hướng lạ của máy (không nguyên, ngoài 0..3) coi như chưa xoay: lần bấm đầu luôn ra một số dây nhận.
  const turns = typeof shown?.value === 'number' && [0, 1, 2, 3].includes(shown.value) ? shown.value : 0;
  const edit: HouseRoofEdit =
    options !== undefined
      ? { kind: 'choice', value: shown === undefined ? '' : String(shown.value), options }
      : field === 'quarterTurns'
        ? { kind: 'turn', next: (turns + 1) % 4 }
        : { kind: 'number', typedText: typeof typed === 'number' ? roofTypedText(field, typed) : '' };
  const label = ROOF_FIELD_LABELS[field];

  return { field, label, lower: label.toLowerCase(), cell: optionalCell(shown, ROOF_WRITERS[field]), isTyped: typed !== undefined, edit };
}

function roofCardOf(roof: RoofSpec, nameOf: (ref: string) => string, decision: RoofDecision | undefined): HouseRoofCard {
  return {
    key: roof.levelRef,
    title: `Mái của ${nameOf(roof.levelRef)}`,
    rows: ROOF_FIELDS.map((field) => roofRowOf(field, roof[field], decision?.[field])),
    isSkipped: decision?.skip === true,
  };
}

function levelEditOf(field: LevelField, measured: Measured | undefined, typedMm: number | undefined): HouseLevelEdit {
  const machine = measured !== undefined && measured.source !== 'reviewer' && typeof measured.value === 'number' ? Math.round(measured.value) : undefined;

  return { typedMm, acceptMm: typedMm === undefined && machine !== undefined && levelValueProblem(field, machine) === null ? machine : undefined };
}

const CONFLICT_FIELDS: Readonly<
  Record<BuildingConflict['field'], { label: string; write: (value: number | string) => string }>
> = {
  elevationMm: { label: 'Cốt tầng', write: elevationText },
  pitchDeg: { label: 'Độ dốc mái', write: pitchText },
};

/** Khoá mâu thuẫn BE phát là `<trường>:<mã hình>`. */
function conflictOf(conflict: BuildingConflict, nameOf: (ref: string) => string, picked: BuildingSource | undefined): HouseConflict {
  const { label, write } = CONFLICT_FIELDS[conflict.field];
  const chosen = picked ?? conflict.chosenSource;

  return {
    key: conflict.key,
    title: `${label} — ${nameOf(conflict.key.slice(conflict.field.length + 1))}`,
    candidates: conflict.candidates.map((candidate) => ({
      text: write(candidate.value),
      chip: chipOf(candidate).chip,
      source: candidate.source,
      isChosen: candidate.source === chosen,
    })),
  };
}

const VIOLATION_GROUPS: readonly Omit<HouseViolationGroup, 'items'>[] = [
  { level: 'error', title: 'Lỗi', status: 'violation' },
  { level: 'warning', title: 'Cảnh báo', status: 'attention' },
  { level: 'hint', title: 'Gợi ý', status: 'neutral' },
];

export function houseBlockOf(
  proposal: BuildingProposal,
  names: ReadonlyMap<string, string>,
  decisions: BuildingDecisions = EMPTY_DECISIONS,
): HouseBlockVm {
  const typed = new Map(decisions.levels.map((level) => [level.levelRef, level]));
  const roofDecisions = new Map(decisions.roofs.map((roof) => [roof.levelRef, roof]));
  const skipped = new Set(decisions.roofs.filter((roof) => roof.skip).map((roof) => roof.levelRef));
  const proposed = new Set(proposal.roofs.map((roof) => roof.levelRef));
  const nameOf = (ref: string): string => names.get(ref) ?? UNKNOWN_LEVEL;
  const violationText = (hit: RuleHit): string =>
    hit.floorRefs.length === 0
      ? ruleSentence(hit)
      : `${[...new Set(hit.floorRefs.map(nameOf))].join(', ')}: ${ruleSentence(hit)}`;

  return {
    unitSystem: cellOf(proposal.unitSystem, lookup(UNIT_SYSTEMS)),
    levels: proposal.levels.map((level) => ({
      key: level.levelRef,
      name: nameOf(level.levelRef),
      elevation: optionalCell(level.elevationMm, elevationText),
      height: optionalCell(level.heightMm, lengthText),
      elevationEdit: levelEditOf('elevationMm', level.elevationMm, typed.get(level.levelRef)?.elevationMm),
      heightEdit: levelEditOf('heightMm', level.heightMm, typed.get(level.levelRef)?.heightMm),
    })),
    roofs: [
      ...proposal.roofs.map((roof) => roofCardOf(roof, nameOf, roofDecisions.get(roof.levelRef))),
      // Mái đã bỏ thì máy không đề xuất nữa; vẫn giữ một thẻ để người duyệt bỏ chọn được.
      ...[...skipped]
        .filter((ref) => !proposed.has(ref))
        .map((ref) => ({ key: ref, title: `Mái của ${nameOf(ref)}`, rows: [], isSkipped: true })),
    ],
    conflicts: proposal.conflicts.map((conflict) => conflictOf(conflict, nameOf, decisions.picks[conflict.key])),
    violations: VIOLATION_GROUPS.flatMap((group) => {
      const items = proposal.violations
        .filter((hit) => hit.level === group.level)
        .map((hit) => ({ key: hit.key, text: violationText(hit), isSeen: decisions.seen.includes(hit.key) }));

      return items.length === 0 ? [] : [{ ...group, items }];
    }),
  };
}
