import { formatChanges } from '@/lib/format/semantic';

import type { EntityKind } from './mergeStrategies';

export type { EntityKind } from './mergeStrategies';

export interface EntityRecord {
  [field: string]: unknown;
}

/** Ảnh chụp phiên bản chỉ có các họ thực thể của đồ thị; lớp đề xuất không nằm trong đó. */
export type SnapshotKind = Exclude<EntityKind, 'suggestion'>;
export type VersionSnapshot = Record<SnapshotKind, Record<string, EntityRecord>>;

export type DiffChangeKind = 'added' | 'changed' | 'removed';

export interface DiffEntry {
  entityId: string;
  entityType: EntityKind;
  kind: DiffChangeKind;
  field?: string;
  newValue?: unknown;
  oldValue?: unknown;
}

export interface VersionDiff {
  added: DiffEntry[];
  changed: DiffEntry[];
  removed: DiffEntry[];
}

const ENTITY_KINDS: readonly SnapshotKind[] = ['vertex', 'wall', 'door', 'window', 'furniture', 'room', 'dimension', 'roof'];

const valuesEqual = (a: unknown, b: unknown): boolean => {
  if (a === b) {
    return true;
  }

  if (Array.isArray(a) && Array.isArray(b)) {
    return a.length === b.length && a.every((item, index) => valuesEqual(item, b[index]));
  }

  if (a !== null && b !== null && typeof a === 'object' && typeof b === 'object') {
    const aRecord = a as Record<string, unknown>;
    const bRecord = b as Record<string, unknown>;
    const aKeys = Object.keys(aRecord).sort();
    const bKeys = Object.keys(bRecord).sort();

    return (
      aKeys.length === bKeys.length &&
      aKeys.every((key, index) => key === bKeys[index] && valuesEqual(aRecord[key], bRecord[key]))
    );
  }

  return false;
};

const diffEntityKind = (
  entityType: EntityKind,
  previousRecords: Record<string, EntityRecord>,
  nextRecords: Record<string, EntityRecord>,
): VersionDiff => {
  const previousIds = Object.keys(previousRecords).sort();
  const nextIds = Object.keys(nextRecords).sort();
  const previousIdSet = new Set(previousIds);
  const nextIdSet = new Set(nextIds);

  const removed: DiffEntry[] = previousIds
    .filter((entityId) => !nextIdSet.has(entityId))
    .map((entityId) => ({ entityId, entityType, kind: 'removed', oldValue: previousRecords[entityId] }));

  const added: DiffEntry[] = nextIds
    .filter((entityId) => !previousIdSet.has(entityId))
    .map((entityId) => ({ entityId, entityType, kind: 'added', newValue: nextRecords[entityId] }));

  const changed: DiffEntry[] = [];

  for (const entityId of nextIds) {
    if (!previousIdSet.has(entityId)) {
      continue;
    }

    const previousEntity = previousRecords[entityId] as EntityRecord;
    const nextEntity = nextRecords[entityId] as EntityRecord;
    const fieldNames = Array.from(new Set([...Object.keys(previousEntity), ...Object.keys(nextEntity)]))
      .filter((field) => field !== 'id')
      .sort();

    for (const field of fieldNames) {
      const oldValue = previousEntity[field];
      const newValue = nextEntity[field];

      if (!valuesEqual(oldValue, newValue)) {
        changed.push({ entityId, entityType, field, kind: 'changed', newValue, oldValue });
      }
    }
  }

  return { added, changed, removed };
};

/**
 * Pure, order-deterministic diff between two version snapshots: identical
 * inputs always yield entries in the same entity-kind → sorted-id →
 * sorted-field order, regardless of the objects' own key insertion order.
 * Values are compared structurally via `valuesEqual`, never JSON.stringify.
 */
export function diffVersions(previous: VersionSnapshot, next: VersionSnapshot): VersionDiff {
  const added: DiffEntry[] = [];
  const changed: DiffEntry[] = [];
  const removed: DiffEntry[] = [];

  for (const entityType of ENTITY_KINDS) {
    // `VersionSnapshot` promises all seven groups at the type level only: the real
    // snapshots come off the wire unvalidated, and a server that leaves out an empty
    // group — `dimension`, usually — would otherwise reach `Object.keys(undefined)` and
    // throw a `TypeError` out of the gateway, blanking the compare screen. A group that
    // is not there holds nothing, which is exactly what an empty record says.
    const group = diffEntityKind(entityType, previous[entityType] ?? {}, next[entityType] ?? {});
    added.push(...group.added);
    changed.push(...group.changed);
    removed.push(...group.removed);
  }

  return { added, changed, removed };
}

/**
 * Renders every entry of a diff, added first, then removed, then changed.
 *
 * The sentences come from `formatChange` in `@/lib/format/semantic`, which is
 * the single place a change is put into words; a {@link DiffEntry} satisfies its
 * `ChangeEntry` shape without a cast. This module used to carry its own copy of
 * that renderer, and the copy had already drifted: it wrote both sides of a
 * length change in whichever unit each side fell into — `"rộng 980 mm → 1,02 m"`
 * — and printed `"NaN"` for a measurement that never arrived. The shared one
 * picks one unit for the pair and writes a missing value as a dash.
 *
 * What belongs here, and the only reason this wrapper still exists, is the order
 * a version diff reads in: what was added, what went, then what moved.
 */
export function describeChanges(diff: VersionDiff): string[] {
  return formatChanges([...diff.added, ...diff.removed, ...diff.changed]);
}
