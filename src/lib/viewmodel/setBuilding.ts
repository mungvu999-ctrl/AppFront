/**
 * Khối "Ngôi nhà" của màn duyệt bộ hồ sơ (NHA-08a): đề xuất của máy (`GET …/building`) → chữ để hiện.
 *
 * Thuần, không React. Mọi số định dạng ở đây (A15). Mỗi giá trị kèm một chip nói NGUỒN bằng chữ và độ tin;
 * chỉ số do người duyệt nhập mới mang màu "đã xác minh" (A5), đầu ra của máy không bao giờ.
 */

import type {
  BuildingConflict,
  BuildingProposal,
  Measured,
  RoofSpec,
  RuleHit,
} from '@/api/schemas/setBuilding';
import { formatNumber, formatPercent } from '@/lib/format/number';

import { ROOF_MATERIALS, ruleSentence } from './buildingRules';
import { suggestedFloorName, type ReviewFloor, type ViewDraft } from './drawingSetReview';
import { statusOfConfidence } from './houseProposal';
import { elevationWithUnit, heightWithUnit, sourceOf } from './houseProposalParts';
import type { ViewStatusCode } from './types';

const UNKNOWN_LEVEL = 'Tầng chưa rõ';

export interface HouseCell {
  readonly text: string;
  /** Nguồn bằng chữ, kèm độ tin khi là đầu ra của máy. */
  readonly chip: string;
  readonly status: ViewStatusCode;
}

export interface HouseLevelRow {
  readonly key: string;
  readonly name: string;
  /** `null` = máy chưa có giá trị cho ô này. */
  readonly elevation: HouseCell | null;
  readonly height: HouseCell | null;
}

export interface HouseRoofCard {
  readonly key: string;
  readonly title: string;
  readonly rows: readonly { readonly label: string; readonly cell: HouseCell }[];
}

export interface HouseConflict {
  readonly key: string;
  readonly title: string;
  readonly candidates: readonly {
    readonly text: string;
    readonly source: string;
    readonly isChosen: boolean;
  }[];
}

export interface HouseViolationGroup {
  readonly level: RuleHit['level'];
  readonly title: string;
  readonly status: ViewStatusCode;
  readonly items: readonly { readonly key: string; readonly text: string }[];
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

function roofCardOf(roof: RoofSpec, nameOf: (ref: string) => string): HouseRoofCard {
  const rows: (readonly [string, Measured | undefined, (value: number | string) => string])[] = [
    ['Dạng mái', roof.form, lookup(ROOF_FORMS)],
    ['Độ dốc', roof.pitchDeg, pitchText],
    ['Hướng mái', roof.quarterTurns, turnsText],
    ['Cốt diềm', roof.eaveElevationMm, elevationText],
    ['Cốt đỉnh', roof.ridgeElevationMm, elevationText],
    ['Độ đua', roof.overhangMm, lengthText],
    ['Vật liệu', roof.material, materialText],
    ['Chiều cao tường chắn mái', roof.parapetMm, lengthText],
  ];

  return {
    key: roof.levelRef,
    title: `Mái của ${nameOf(roof.levelRef)}`,
    rows: rows.flatMap(([label, measured, write]) =>
      measured === undefined ? [] : [{ label, cell: cellOf(measured, write) }],
    ),
  };
}

const CONFLICT_FIELDS: Readonly<
  Record<BuildingConflict['field'], { label: string; write: (value: number | string) => string }>
> = {
  elevationMm: { label: 'Cốt tầng', write: elevationText },
  pitchDeg: { label: 'Độ dốc mái', write: pitchText },
};

/** Khoá mâu thuẫn BE phát là `<trường>:<mã hình>`. */
function conflictOf(conflict: BuildingConflict, nameOf: (ref: string) => string): HouseConflict {
  const { label, write } = CONFLICT_FIELDS[conflict.field];

  return {
    key: conflict.key,
    title: `${label} — ${nameOf(conflict.key.slice(conflict.field.length + 1))}`,
    candidates: conflict.candidates.map((candidate) => ({
      text: write(candidate.value),
      source: chipOf(candidate).chip,
      isChosen: candidate.source === conflict.chosenSource,
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
): HouseBlockVm {
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
    })),
    roofs: proposal.roofs.map((roof) => roofCardOf(roof, nameOf)),
    conflicts: proposal.conflicts.map((conflict) => conflictOf(conflict, nameOf)),
    violations: VIOLATION_GROUPS.flatMap((group) => {
      const items = proposal.violations
        .filter((hit) => hit.level === group.level)
        .map((hit) => ({ key: hit.key, text: violationText(hit) }));

      return items.length === 0 ? [] : [{ ...group, items }];
    }),
  };
}
