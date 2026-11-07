import { z } from 'zod';

import { isoInstantSchema } from './common';

/**
 * N49–N51 — một lần xuất GLB dựng phía máy chủ (M1-01, hợp đồng §5–§6).
 *
 * `status` là job đã chạy xong chưa; `quality` là kết quả dùng được tới đâu và chỉ có khi
 * `done`. Schema `strict`: khoá lạ từ máy chủ là lỗi hợp đồng, không phải dữ liệu để bỏ qua.
 */
export const MODEL_EXPORT_STATUSES = ['queued', 'running', 'done', 'failed', 'superseded'] as const;
export const MODEL_EXPORT_QUALITIES = ['ready', 'degraded', 'blocked'] as const;
export const MODEL_EXPORT_SEVERITIES = ['minor', 'major', 'critical'] as const;

/** Id lần xuất: `mex_` + ULID. */
const modelExportIdSchema = z.string().regex(/^mex_[0-9A-HJKMNP-TV-Z]{26}$/);

const SnapshotRevisionSchema = z.object({ levelId: z.string().min(1), levelName: z.string(), revision: z.number().int().nonnegative() }).strict();

const ModelExportIssueSchema = z
  .object({
    severity: z.enum(MODEL_EXPORT_SEVERITIES),
    reason: z.string().min(1),
    count: z.number().int().positive(),
  })
  .strict();

export const ModelExportSchema = z
  .object({
    id: modelExportIdSchema,
    status: z.enum(MODEL_EXPORT_STATUSES),
    quality: z.enum(MODEL_EXPORT_QUALITIES).optional(),
    stale: z.boolean(),
    fingerprint: z.string().min(1),
    currentFingerprint: z.string().min(1),
    snapshotRevisions: z.array(SnapshotRevisionSchema),
    counts: z.record(z.string(), z.number().int().nonnegative()),
    issues: z.array(ModelExportIssueSchema),
    createdAt: isoInstantSchema,
    startedAt: isoInstantSchema.optional(),
    endedAt: isoInstantSchema.optional(),
    failureCode: z.string().min(1).optional(),
    glbBytes: z.number().int().nonnegative().optional(),
  })
  .strict()
  .refine((row) => (row.quality !== undefined) === (row.status === 'done'), {
    message: 'quality chỉ có khi lần xuất đã xong',
    path: ['quality'],
  })
  .refine((row) => (row.failureCode !== undefined) === (row.status === 'failed'), {
    message: 'failureCode chỉ có khi lần xuất hỏng',
    path: ['failureCode'],
  });

export type ModelExport = z.infer<typeof ModelExportSchema>;
export type ModelExportStatus = (typeof MODEL_EXPORT_STATUSES)[number];
export type ModelExportQuality = (typeof MODEL_EXPORT_QUALITIES)[number];
export type ModelExportIssue = z.infer<typeof ModelExportIssueSchema>;

/** Ba tệp N51 phục vụ. */
export const MODEL_EXPORT_FILES = ['model.glb', 'report.json', 'CREDITS.txt'] as const;
export type ModelExportFileName = (typeof MODEL_EXPORT_FILES)[number];
