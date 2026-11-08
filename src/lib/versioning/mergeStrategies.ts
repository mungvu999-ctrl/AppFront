export type EntityKind = 'vertex' | 'wall' | 'door' | 'window' | 'furniture' | 'room' | 'dimension' | 'roof' | 'suggestion';

export interface FieldChange {
  entityId: string;
  entityType: EntityKind;
  field: string;
  value: unknown;
}

export interface RemoteFieldChange extends FieldChange {
  changedAt: string;
  changedBy: string;
  /**
   * Tên người đổi, do máy chủ ghép sẵn; `system:pipeline` thành "hệ thống AI".
   *
   * Bắt buộc, không tuỳ chọn: màn lịch sử phiên bản và panel cộng tác đều in
   * dòng "ai vừa đổi gì", và không màn nào tra được `changedBy` (`usr_` + ULID)
   * ra tên người. Thiếu trường này thì thứ hiện ra là một chuỗi id thô — xem
   * `screens/export/VersionHistory/types.ts:37`, vốn đã ghi lại đúng nỗi lo đó.
   */
  changedByName: string;
}

export interface FieldConflict {
  entityId: string;
  entityType: EntityKind;
  field: string;
  localValue: unknown;
  remoteChange: RemoteFieldChange;
}

export interface MergedField {
  entityId: string;
  entityType: EntityKind;
  field: string;
  source: 'local' | 'remote';
  value: unknown;
}

const toFieldKey = (change: Pick<FieldChange, 'entityId' | 'entityType' | 'field'>): string =>
  `${change.entityType}:${change.entityId}:${change.field}`;

const toEntityKey = (change: Pick<FieldChange, 'entityId' | 'entityType'>): string =>
  `${change.entityType}:${change.entityId}`;

const indexByFieldKey = <T extends FieldChange>(changes: readonly T[]): Map<string, T> => {
  const index = new Map<string, T>();

  for (const change of changes) {
    index.set(toFieldKey(change), change);
  }

  return index;
};

/**
 * Same entity, same field, changed on both sides — the case that must never
 * auto-resolve, so callers can route it to the user instead of overwriting.
 */
export function findFieldConflicts(
  localChanges: readonly FieldChange[],
  remoteChanges: readonly RemoteFieldChange[],
): FieldConflict[] {
  const remoteByKey = indexByFieldKey(remoteChanges);
  const conflicts: FieldConflict[] = [];

  for (const local of localChanges) {
    const remote = remoteByKey.get(toFieldKey(local));

    if (remote) {
      conflicts.push({
        entityId: local.entityId,
        entityType: local.entityType,
        field: local.field,
        localValue: local.value,
        remoteChange: remote,
      });
    }
  }

  return conflicts;
}

/**
 * Combines local and remote field changes, skipping any field that is in
 * conflict (present in both, see `findFieldConflicts`). Local wins ordering
 * on a field only touched locally, remote wins on a field only touched
 * remotely, and fields untouched on either side never appear here.
 */
export function mergeFields(
  localChanges: readonly FieldChange[],
  remoteChanges: readonly RemoteFieldChange[],
): MergedField[] {
  const conflictKeys = new Set(findFieldConflicts(localChanges, remoteChanges).map(toFieldKey));
  const merged = new Map<string, MergedField>();

  for (const remote of remoteChanges) {
    const key = toFieldKey(remote);

    if (conflictKeys.has(key)) {
      continue;
    }

    merged.set(key, {
      entityId: remote.entityId,
      entityType: remote.entityType,
      field: remote.field,
      source: 'remote',
      value: remote.value,
    });
  }

  for (const local of localChanges) {
    const key = toFieldKey(local);

    if (conflictKeys.has(key)) {
      continue;
    }

    merged.set(key, {
      entityId: local.entityId,
      entityType: local.entityType,
      field: local.field,
      source: 'local',
      value: local.value,
    });
  }

  return Array.from(merged.values());
}

/**
 * Entities touched on both sides, regardless of which field changed —
 * distinguishes "different fields, safe to field-merge" from "no overlap at
 * all, nothing to merge".
 */
export function overlappingEntityIds(
  localChanges: readonly FieldChange[],
  remoteChanges: readonly RemoteFieldChange[],
): Set<string> {
  const remoteEntityKeys = new Set(remoteChanges.map(toEntityKey));
  const overlapping = new Set<string>();

  for (const local of localChanges) {
    const key = toEntityKey(local);

    if (remoteEntityKeys.has(key)) {
      overlapping.add(key);
    }
  }

  return overlapping;
}
