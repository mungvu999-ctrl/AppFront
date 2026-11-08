/**
 * Sentences and labels, built on the measurement formatters.
 *
 * A history row, a version diff and a QC badge all describe the same model, and
 * a reader moving between them should not have to re-learn how a number is
 * written. So nothing here formats a quantity itself: every millimetre, area and
 * angle goes through `./measure`, and the sentence is only the words around it.
 *
 * Two rules the callers depend on:
 *
 * - **No colours.** {@link describeConfidence} returns a level code and never a
 *   token name, class or hex value. Which token a level maps to is a decision
 *   for the view, which is the only layer allowed to know about colour — and the
 *   only layer that can honour the rule that the verified green marks human
 *   approval, never an AI score. That is why no level here is called
 *   `'verified'`.
 * - **Both sides of a change share a unit.** `"rộng 980 mm → 1,02 m"` is
 *   technically correct and unreadable; the unit is chosen once from the larger
 *   of the two values, so the pair reads `"rộng 0,98 m → 1,02 m"`.
 */

import { MILLIMETRES_PER_METRE } from '@/domain/units/types';

import { formatAngle, formatArea, formatLength, METRE_THRESHOLD_MM, type LengthDisplayUnit } from './measure';
import { formatNumber, isFormattable, MISSING_VALUE, type MaybeNumber } from './number';

/* -------------------------------------------------------------------------- */
/* Confidence.                                                                 */
/* -------------------------------------------------------------------------- */

/**
 * How much weight a reader should give an AI result.
 *
 * A code, not a colour and not a sentence: the view maps it to a token, and a
 * changed threshold or a changed wording never touches the view.
 */
export type ConfidenceLevel = 'certain' | 'suggested' | 'needsReview' | 'unknown';

/** Where one level ends and the next begins, on the 0–1 scale scores arrive on. */
export const CONFIDENCE_CERTAIN_THRESHOLD = 0.9;
export const CONFIDENCE_SUGGESTED_THRESHOLD = 0.7;

export interface ConfidenceDescription {
  /** For the view to pick a token from. Never a colour. */
  readonly level: ConfidenceLevel;
  /** The words shown beside the score. */
  readonly label: string;
}

const CONFIDENCE_LABELS: Readonly<Record<ConfidenceLevel, string>> = {
  certain: 'AI chắc chắn',
  suggested: 'AI đề xuất',
  needsReview: 'Cần kiểm tra',
  unknown: MISSING_VALUE,
};

/**
 * Turn a confidence score into a level and the words that go with it.
 *
 * A score that never arrived is `'unknown'` rather than `'needsReview'`: "the
 * pipeline produced no score" and "the pipeline is unsure" are different facts,
 * and flattening them would send a reviewer to check something nothing was
 * claimed about.
 *
 * @param value Confidence on the 0–1 scale the pipeline reports.
 *
 * @example
 * describeConfidence(0.95)  // { level: 'certain',     label: 'AI chắc chắn' }
 * describeConfidence(0.72)  // { level: 'suggested',   label: 'AI đề xuất' }
 * describeConfidence(0.4)   // { level: 'needsReview', label: 'Cần kiểm tra' }
 * describeConfidence(null)  // { level: 'unknown',     label: '—' }
 */
export function describeConfidence(value: MaybeNumber): ConfidenceDescription {
  const level = confidenceLevel(value);
  return { level, label: CONFIDENCE_LABELS[level] };
}

/** The level alone, for a caller that only needs to pick a token. */
export function confidenceLevel(value: MaybeNumber): ConfidenceLevel {
  if (!isFormattable(value)) {
    return 'unknown';
  }
  if (value >= CONFIDENCE_CERTAIN_THRESHOLD) {
    return 'certain';
  }
  if (value >= CONFIDENCE_SUGGESTED_THRESHOLD) {
    return 'suggested';
  }
  return 'needsReview';
}

/* -------------------------------------------------------------------------- */
/* Changes.                                                                    */
/* -------------------------------------------------------------------------- */

/** The kinds of entity a change can be about. */
export type ChangeEntityKind =
  | 'vertex'
  | 'wall'
  | 'door'
  | 'window'
  | 'furniture'
  | 'room'
  | 'dimension'
  | 'roof'
  | 'suggestion';

/** What happened to the entity. */
export type ChangeKind = 'added' | 'changed' | 'removed';

/**
 * One entry of a diff, as the versioning module produces it.
 *
 * Declared structurally rather than imported so `format` stays a leaf module
 * that nothing else in `lib` has to be loaded to use. A `DiffEntry` from
 * `@/lib/versioning/diff` satisfies it without a cast, and the test pins that.
 */
export interface ChangeEntry {
  readonly entityId: string;
  readonly entityType: ChangeEntityKind;
  readonly kind: ChangeKind;
  readonly field?: string;
  readonly oldValue?: unknown;
  readonly newValue?: unknown;
}

/** Shown where a change has no value on one side. */
export const EMPTY_VALUE_LABEL = '(trống)';

const CHANGE_ARROW = '→';

const ENTITY_LABELS: Readonly<Record<ChangeEntityKind, string>> = {
  dimension: 'kích thước',
  door: 'cửa đi',
  furniture: 'nội thất',
  room: 'phòng',
  roof: 'mái',
  vertex: 'điểm',
  wall: 'tường',
  window: 'cửa sổ',
  suggestion: 'đề xuất',
};

/** How a field's value is measured, which decides the formatter it goes through. */
type FieldQuantity = 'lengthMm' | 'elevationM' | 'areaM2' | 'angleDeg';

interface FieldDescriptor {
  /** The verb or noun that joins the entity to its value: "dày", "rộng". */
  readonly phrase: string;
  readonly quantity: FieldQuantity;
}

/**
 * The fields worth a sentence of their own. A field missing from this table is
 * still described, but generically — inventing a unit for an unknown field is
 * how a unitless number ends up reading as millimetres.
 */
const FIELD_DESCRIPTORS: Readonly<Record<string, FieldDescriptor>> = {
  area_m2: { phrase: 'diện tích', quantity: 'areaM2' },
  curve_offset_mm: { phrase: 'độ cong', quantity: 'lengthMm' },
  elevation_m: { phrase: 'cao độ', quantity: 'elevationM' },
  height_mm: { phrase: 'cao', quantity: 'lengthMm' },
  lift_mm: { phrase: 'nâng khỏi sàn', quantity: 'lengthMm' },
  offset_mm: { phrase: 'vị trí trên tường', quantity: 'lengthMm' },
  override_value_mm: { phrase: 'số đo nhập tay', quantity: 'lengthMm' },
  rotation_deg: { phrase: 'xoay', quantity: 'angleDeg' },
  sill_height_mm: { phrase: 'cao bệ cửa', quantity: 'lengthMm' },
  thickness_mm: { phrase: 'dày', quantity: 'lengthMm' },
  value_mm: { phrase: 'kích thước', quantity: 'lengthMm' },
  width_mm: { phrase: 'rộng', quantity: 'lengthMm' },
  x: { phrase: 'toạ độ X', quantity: 'lengthMm' },
  y: { phrase: 'toạ độ Y', quantity: 'lengthMm' },
};

/**
 * Fields with no unit, named in Vietnamese. `showValues` only where the value is
 * the user's own text: enum codes (`sliding`) and ids would leak English, and a
 * shape (`outline`, `centre`) has no one-line value.
 */
const NAMED_FIELDS: Readonly<Record<string, { readonly name: string; readonly showValues: boolean }>> = {
  centre: { name: 'vị trí', showValues: false },
  finish: { name: 'kiểu mặt sàn', showValues: false },
  floor_material: { name: 'vật liệu sàn', showValues: false },
  kind: { name: 'loại', showValues: false },
  model: { name: 'mẫu 3D', showValues: false },
  name: { name: 'tên', showValues: true },
  outline: { name: 'đường bao', showValues: false },
  paint: { name: 'màu sơn', showValues: false },
  reference_ids: { name: 'đối tượng tham chiếu', showValues: false },
  room_id: { name: 'phòng chứa', showValues: false },
  slots: { name: 'vật liệu từng phần', showValues: false },
  swing: { name: 'kiểu mở', showValues: false },
  usage: { name: 'công năng', showValues: false },
  variant: { name: 'kiểu dáng', showValues: false },
  wall_id: { name: 'tường chứa', showValues: false },
};

/** A field no table knows: said in general, never by its technical name. */
const UNKNOWN_FIELD_PHRASE = 'đổi một thuộc tính khác';

function capitalise(label: string): string {
  const first = label[0];
  return first === undefined ? label : `${first.toUpperCase()}${label.slice(1)}`;
}

function toFiniteNumber(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

/**
 * The unit both sides of a length change are written in.
 *
 * Chosen from the larger of the two so a change that crosses one metre does not
 * switch units mid-sentence.
 */
function sharedLengthUnit(first: number | null, second: number | null): LengthDisplayUnit {
  const largest = Math.max(Math.abs(first ?? 0), Math.abs(second ?? 0));
  return largest < METRE_THRESHOLD_MM ? 'mm' : 'm';
}

/** Write both sides of a measured change, in one unit. */
function formatQuantityPair(
  quantity: FieldQuantity,
  oldValue: unknown,
  newValue: unknown,
  forceMm: boolean,
): readonly [string, string] {
  const before = toFiniteNumber(oldValue);
  const after = toFiniteNumber(newValue);

  switch (quantity) {
    case 'lengthMm': {
      const unit = forceMm ? 'mm' : sharedLengthUnit(before, after);
      return [formatLength(before, { unit }), formatLength(after, { unit })];
    }
    case 'elevationM': {
      // Elevations are stored in metres; `formatLength` reads millimetres.
      const toMm = (value: number | null): number | null =>
        value === null ? null : value * MILLIMETRES_PER_METRE;
      return [
        formatLength(toMm(before), { unit: 'm' }),
        formatLength(toMm(after), { unit: 'm' }),
      ];
    }
    case 'areaM2':
      return [formatArea(before), formatArea(after)];
    case 'angleDeg':
      return [formatAngle(before), formatAngle(after)];
  }
}

/** A value with no unit of its own, written so it is at least readable. */
function describeGenericValue(value: unknown): string {
  if (value === undefined || value === null) {
    return EMPTY_VALUE_LABEL;
  }
  if (Array.isArray(value)) {
    return value.length === 0
      ? EMPTY_VALUE_LABEL
      : value.map((item: unknown) => describeGenericValue(item)).join(', ');
  }
  if (typeof value === 'number') {
    return formatNumber(value, Number.isInteger(value) ? { fractionDigits: 0 } : { maxFractionDigits: 2 });
  }
  if (typeof value === 'boolean') {
    return value ? 'có' : 'không';
  }
  if (typeof value === 'object') {
    return EMPTY_VALUE_LABEL;
  }
  return String(value);
}

/** `lengthsInMm`: write every millimetre length in mm (a list that must read in one unit). */
export interface ChangeFormatOptions {
  readonly lengthsInMm?: boolean;
}

/**
 * Write one diff entry as a Vietnamese sentence.
 *
 * A field this module knows the unit of reads as a measurement — `"Tường W-014
 * dày 200 mm → 220 mm"`. A field without a unit is named in Vietnamese
 * (`NAMED_FIELDS`); one no table knows gets a general sentence, never its
 * technical name (`offset_mm`).
 *
 * @example
 * formatChange({ entityId: 'W-014', entityType: 'wall', kind: 'changed',
 *                field: 'thickness_mm', oldValue: 200, newValue: 220 })
 * // "Tường W-014 dày 200 mm → 220 mm"
 */
export function formatChange(entry: ChangeEntry, options: ChangeFormatOptions = {}): string {
  const label = ENTITY_LABELS[entry.entityType];

  if (entry.kind === 'added') {
    return `Thêm ${label} ${entry.entityId}`;
  }
  if (entry.kind === 'removed') {
    return `Xoá ${label} ${entry.entityId}`;
  }

  const field = entry.field ?? '';
  const descriptor = FIELD_DESCRIPTORS[field];
  const subject = `${capitalise(label)} ${entry.entityId}`;

  if (descriptor !== undefined) {
    const [before, after] = formatQuantityPair(
      descriptor.quantity,
      entry.oldValue,
      entry.newValue,
      options.lengthsInMm === true,
    );
    return `${subject} ${descriptor.phrase} ${before} ${CHANGE_ARROW} ${after}`;
  }

  const named = NAMED_FIELDS[field];

  if (named === undefined) {
    return `${subject} ${UNKNOWN_FIELD_PHRASE}`;
  }
  if (!named.showValues) {
    return `${subject} đổi ${named.name}`;
  }

  const before = describeGenericValue(entry.oldValue);
  const after = describeGenericValue(entry.newValue);
  return `${subject} đổi ${named.name}: ${before} ${CHANGE_ARROW} ${after}`;
}

/** Write every entry of a diff, in the order it was given. */
export function formatChanges(entries: readonly ChangeEntry[]): string[] {
  return entries.map((entry) => formatChange(entry));
}
