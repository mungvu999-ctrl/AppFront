import { describe, expect, it } from 'vitest';

import { ModelExportSchema } from '../../schemas/modelExport';

const T = '2026-11-07T05:00:00.000Z';
const BASE = {
  id: 'mex_01JABCDEFGHJKMNPQRSTVWXYZ0',
  status: 'queued',
  stale: false,
  fingerprint: 'fp1',
  currentFingerprint: 'fp1',
  snapshotRevisions: [{ levelId: 'L-1', levelName: 'Tầng 1', revision: 3 }],
  counts: { 'wall:built': 34 },
  issues: [],
  createdAt: T,
};

describe('ModelExportSchema', () => {
  it('nhận job đang chờ, xong có quality, hỏng có failureCode', () => {
    expect(ModelExportSchema.safeParse(BASE).success).toBe(true);
    expect(
      ModelExportSchema.safeParse({
        ...BASE,
        status: 'done',
        quality: 'degraded',
        startedAt: T,
        endedAt: T,
        glbBytes: 1024,
        issues: [{ severity: 'major', reason: 'Cửa thiếu bộ cửa', count: 2 }],
      }).success,
    ).toBe(true);
    expect(ModelExportSchema.safeParse({ ...BASE, status: 'failed', failureCode: 'MODEL_EXPORT_TIMEOUT' }).success).toBe(true);
    expect(ModelExportSchema.safeParse({ ...BASE, status: 'superseded' }).success).toBe(true);
  });

  it('strict: từ chối khoá lạ, kể cả trong issues và snapshotRevisions', () => {
    expect(ModelExportSchema.safeParse({ ...BASE, extra: 1 }).success).toBe(false);
    expect(ModelExportSchema.safeParse({ ...BASE, snapshotRevisions: [{ levelId: 'L-1', levelName: 'Tầng 1', revision: 1, x: 1 }] }).success).toBe(
      false,
    );
    expect(
      ModelExportSchema.safeParse({ ...BASE, issues: [{ severity: 'minor', reason: 'a', count: 1, extra: true }] }).success,
    ).toBe(false);
  });

  it('từ chối quality/failureCode lệch trạng thái, id sai tiền tố, mức lạ', () => {
    expect(ModelExportSchema.safeParse({ ...BASE, quality: 'ready' }).success).toBe(false);
    expect(ModelExportSchema.safeParse({ ...BASE, status: 'done' }).success).toBe(false);
    expect(ModelExportSchema.safeParse({ ...BASE, status: 'failed' }).success).toBe(false);
    expect(ModelExportSchema.safeParse({ ...BASE, id: 'bak_01JABCDEFGHJKMNPQRSTVWXYZ0' }).success).toBe(false);
    expect(ModelExportSchema.safeParse({ ...BASE, issues: [{ severity: 'fatal', reason: 'a', count: 1 }] }).success).toBe(false);
    expect(ModelExportSchema.safeParse({ ...BASE, stale: undefined }).success).toBe(false);
    expect(ModelExportSchema.safeParse({ ...BASE, snapshotRevisions: [{ levelId: 'L-1', revision: 1 }] }).success).toBe(false);
  });
});
