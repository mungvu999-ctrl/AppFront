import {
  findFieldConflicts,
  mergeFields,
  overlappingEntityIds,
  type EntityKind,
  type FieldChange,
  type FieldConflict,
  type MergedField,
  type RemoteFieldChange,
} from './mergeStrategies';

export type { EntityKind, FieldChange, FieldConflict, MergedField, RemoteFieldChange } from './mergeStrategies';

/** Every write carries the version it was based on, so the server can detect a stale write. */
export interface WriteRequestEnvelope<TBody> {
  baseVersion: number;
  body: TBody;
}

/** Shape of the 409 the server returns when `baseVersion` is stale. */
export interface ConflictResponseBody {
  currentVersion: number;
  remoteChanges: RemoteFieldChange[];
}

export type ConflictLevel = 'autoMerged' | 'fieldMerged' | 'requiresUserChoice';

export interface ResolveConflictInput {
  baseVersion: number;
  localChanges: readonly FieldChange[];
  remoteChanges: readonly RemoteFieldChange[];
  serverVersion: number;
}

export interface ConflictResolution {
  conflictingFields: FieldConflict[];
  description: string;
  level: ConflictLevel;
  mergedFields: MergedField[];
  /** Only advances to `serverVersion` once every change has been merged or reviewed; stays at `baseVersion` while a `requiresUserChoice` conflict is unresolved. */
  nextBaseVersion: number;
}

const ENTITY_LABELS: Record<EntityKind, string> = {
  vertex: 'điểm',
  wall: 'bức tường',
  door: 'cửa đi',
  window: 'cửa sổ',
  furniture: 'nội thất',
  room: 'phòng',
  dimension: 'chuỗi kích thước',
  roof: 'mái',
  suggestion: 'đề xuất',
};

const countDistinctEntitiesByType = (changes: readonly RemoteFieldChange[]): Map<EntityKind, number> => {
  const idsByType = new Map<EntityKind, Set<string>>();

  for (const change of changes) {
    const ids = idsByType.get(change.entityType) ?? new Set<string>();
    ids.add(change.entityId);
    idsByType.set(change.entityType, ids);
  }

  const counts = new Map<EntityKind, number>();
  for (const [entityType, ids] of idsByType) {
    counts.set(entityType, ids.size);
  }

  return counts;
};

const describeRemoteChanges = (remoteChanges: readonly RemoteFieldChange[]): string => {
  const counts = countDistinctEntitiesByType(remoteChanges);
  const sentences: string[] = [];

  for (const [entityType, count] of counts) {
    sentences.push(`${count} ${ENTITY_LABELS[entityType]} bị sửa bởi người khác từ lúc bạn mở trang.`);
  }

  return sentences.join(' ');
};

const describeFieldConflicts = (conflicts: readonly FieldConflict[]): string => {
  if (conflicts.length === 0) {
    return '';
  }

  const items = conflicts
    .map((conflict) => `${ENTITY_LABELS[conflict.entityType]} #${conflict.entityId} (thuộc tính "${conflict.field}")`)
    .join(', ');

  return `${conflicts.length} xung đột cần bạn chọn: ${items}.`;
};

/**
 * Classifies a write against what changed on the server since `baseVersion`
 * into three levels: no overlap (`autoMerged`), overlap but different fields
 * (`fieldMerged`), or same entity and field on both sides
 * (`requiresUserChoice` — never auto-resolved).
 */
export function resolveConflict(input: ResolveConflictInput): ConflictResolution {
  const { baseVersion, localChanges, remoteChanges, serverVersion } = input;

  if (remoteChanges.length === 0) {
    return {
      conflictingFields: [],
      description: '',
      level: 'autoMerged',
      mergedFields: localChanges.map((change) => ({ ...change, source: 'local' })),
      nextBaseVersion: serverVersion,
    };
  }

  const conflictingFields = findFieldConflicts(localChanges, remoteChanges);
  const mergedFields = mergeFields(localChanges, remoteChanges);
  const remoteDescription = describeRemoteChanges(remoteChanges);

  if (conflictingFields.length > 0) {
    return {
      conflictingFields,
      description: [remoteDescription, describeFieldConflicts(conflictingFields)].filter(Boolean).join(' '),
      level: 'requiresUserChoice',
      mergedFields,
      nextBaseVersion: baseVersion,
    };
  }

  const level: ConflictLevel = overlappingEntityIds(localChanges, remoteChanges).size > 0 ? 'fieldMerged' : 'autoMerged';

  return {
    conflictingFields: [],
    description: remoteDescription,
    level,
    mergedFields,
    nextBaseVersion: serverVersion,
  };
}
