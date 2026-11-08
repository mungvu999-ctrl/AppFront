import { describe, expect, it } from 'vitest';

import { resolveConflict, type FieldChange, type RemoteFieldChange } from '../conflict';

const local = (entityId: string, field: string, value: unknown): FieldChange => ({
  entityId,
  entityType: 'wall',
  field,
  value,
});

const remote = (
  entityId: string,
  field: string,
  value: unknown,
  changedBy = 'user-2',
  changedAt = '2026-08-13T09:00:00.000Z',
  changedByName = 'Nguyễn Thị Hai',
): RemoteFieldChange => ({
  changedAt,
  changedBy,
  changedByName,
  entityId,
  entityType: 'wall',
  field,
  value,
});

describe('resolveConflict', () => {
  it('thay đổi từ xa của đề xuất được gọi là "đề xuất" trong thông báo', () => {
    const result = resolveConflict({
      baseVersion: 10,
      localChanges: [local('#W-005', 'thickness_mm', 220)],
      remoteChanges: [{ ...remote('DRESS-R1-R-1-W-2', 'state', 'disabled'), entityType: 'suggestion' }],
      serverVersion: 11,
    });

    expect(JSON.stringify(result)).toContain('đề xuất');
  });

  it('level 1 — auto-merges when local and remote touch different entities entirely', () => {
    const result = resolveConflict({
      baseVersion: 10,
      localChanges: [local('#W-005', 'thickness_mm', 220)],
      remoteChanges: [
        remote('#W-014', 'thickness_mm', 110),
        remote('#W-021', 'thickness_mm', 330),
        remote('#W-034', 'confidence', 0.82),
      ],
      serverVersion: 13,
    });

    expect(result.level).toBe('autoMerged');
    expect(result.conflictingFields).toHaveLength(0);
    expect(result.mergedFields).toHaveLength(4);
    expect(result.mergedFields).toContainEqual({
      entityId: '#W-005',
      entityType: 'wall',
      field: 'thickness_mm',
      source: 'local',
      value: 220,
    });
    expect(result.description).toBe('3 bức tường bị sửa bởi người khác từ lúc bạn mở trang.');
  });

  it('level 2 — merges by field when local and remote touch the same entity but different attributes', () => {
    const result = resolveConflict({
      baseVersion: 10,
      localChanges: [local('#W-014', 'thickness_mm', 220)],
      remoteChanges: [remote('#W-014', 'confidence', 0.91)],
      serverVersion: 11,
    });

    expect(result.level).toBe('fieldMerged');
    expect(result.conflictingFields).toHaveLength(0);
    expect(result.mergedFields).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ entityId: '#W-014', field: 'thickness_mm', source: 'local', value: 220 }),
        expect.objectContaining({ entityId: '#W-014', field: 'confidence', source: 'remote', value: 0.91 }),
      ]),
    );
  });

  it('level 3 — requires the user to choose when both sides change the same attribute of the same entity', () => {
    const result = resolveConflict({
      baseVersion: 10,
      localChanges: [local('#W-014', 'thickness_mm', 220)],
      remoteChanges: [remote('#W-014', 'thickness_mm', 330, 'user-2')],
      serverVersion: 11,
    });

    expect(result.level).toBe('requiresUserChoice');
    expect(result.conflictingFields).toEqual([
      {
        entityId: '#W-014',
        entityType: 'wall',
        field: 'thickness_mm',
        localValue: 220,
        remoteChange: remote('#W-014', 'thickness_mm', 330, 'user-2'),
      },
    ]);
    // the conflicting field must never be silently resolved into mergedFields
    expect(result.mergedFields).toHaveLength(0);
  });

  it('never silently overwrites a same-attribute conflict even when other fields on the same entity merge cleanly', () => {
    const result = resolveConflict({
      baseVersion: 10,
      localChanges: [
        local('#W-014', 'thickness_mm', 220),
        local('#W-014', 'confidence', 0.5),
      ],
      remoteChanges: [remote('#W-014', 'thickness_mm', 330)],
      serverVersion: 11,
    });

    expect(result.level).toBe('requiresUserChoice');
    expect(result.conflictingFields.map((conflict) => conflict.field)).toEqual(['thickness_mm']);
    expect(result.mergedFields).toContainEqual(
      expect.objectContaining({ field: 'confidence', source: 'local', value: 0.5 }),
    );
    expect(result.mergedFields.some((field) => field.field === 'thickness_mm')).toBe(false);
  });

  it('bumps nextBaseVersion to the server version once auto-merged', () => {
    const result = resolveConflict({
      baseVersion: 10,
      localChanges: [local('#W-005', 'thickness_mm', 220)],
      remoteChanges: [remote('#W-014', 'thickness_mm', 110)],
      serverVersion: 17,
    });

    expect(result.nextBaseVersion).toBe(17);
  });

  it('bumps nextBaseVersion to the server version once field-merged', () => {
    const result = resolveConflict({
      baseVersion: 10,
      localChanges: [local('#W-014', 'thickness_mm', 220)],
      remoteChanges: [remote('#W-014', 'confidence', 0.91)],
      serverVersion: 12,
    });

    expect(result.nextBaseVersion).toBe(12);
  });

  it('keeps nextBaseVersion pinned to baseVersion while a conflict awaits the user', () => {
    const result = resolveConflict({
      baseVersion: 10,
      localChanges: [local('#W-014', 'thickness_mm', 220)],
      remoteChanges: [remote('#W-014', 'thickness_mm', 330)],
      serverVersion: 11,
    });

    expect(result.nextBaseVersion).toBe(10);
  });

  it('auto-merges with no description when nothing changed remotely', () => {
    const result = resolveConflict({
      baseVersion: 10,
      localChanges: [local('#W-005', 'thickness_mm', 220)],
      remoteChanges: [],
      serverVersion: 10,
    });

    expect(result.level).toBe('autoMerged');
    expect(result.description).toBe('');
    expect(result.nextBaseVersion).toBe(10);
  });

  it('describes remote changes across multiple entity kinds with counts', () => {
    const result = resolveConflict({
      baseVersion: 10,
      localChanges: [],
      remoteChanges: [
        { ...remote('#W-014', 'thickness_mm', 220), entityType: 'wall' },
        { ...remote('#W-021', 'thickness_mm', 110), entityType: 'wall' },
        { ...remote('#R-005', 'area_m2', 18.4), entityType: 'room' },
      ],
      serverVersion: 11,
    });

    expect(result.description).toContain('2 bức tường bị sửa bởi người khác từ lúc bạn mở trang.');
    expect(result.description).toContain('1 phòng bị sửa bởi người khác từ lúc bạn mở trang.');
  });

  it('lists the human-readable conflict description with entity and field detail', () => {
    const result = resolveConflict({
      baseVersion: 10,
      localChanges: [local('#W-014', 'thickness_mm', 220)],
      remoteChanges: [remote('#W-014', 'thickness_mm', 330)],
      serverVersion: 11,
    });

    expect(result.description).toContain('1 xung đột cần bạn chọn');
    expect(result.description).toContain('#W-014');
    expect(result.description).toContain('thickness_mm');
  });
});
