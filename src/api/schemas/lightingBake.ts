import { z } from 'zod';

import { isoInstantSchema } from './common';

/**
 * N42–N44 — một lượt nướng ánh sáng (Blender Cycles) cho GLB mà trình dựng 3D gửi lên.
 *
 * Ba mốc thời gian đi theo trạng thái, và schema ép điều đó thay vì để màn đoán:
 * `startedAt` có mặt đúng khi lượt đã rời hàng chờ, `endedAt` đúng khi đã kết thúc,
 * `failureCode` đúng khi hỏng. Một bản ghi lệch (ví dụ `done` không có `endedAt`) là
 * lỗi hợp đồng, không phải trạng thái để vẽ.
 */
export const LIGHTING_BAKE_STATUSES = ['queued', 'running', 'done', 'failed'] as const;

/** Id lượt nướng: `bak_` + ULID. */
const lightingBakeIdSchema = z.string().regex(/^bak_[0-9A-HJKMNP-TV-Z]{26}$/);

export const LightingBakeSchema = z
  .object({
    id: lightingBakeIdSchema,
    status: z.enum(LIGHTING_BAKE_STATUSES),
    createdAt: isoInstantSchema,
    startedAt: isoInstantSchema.optional(),
    endedAt: isoInstantSchema.optional(),
    failureCode: z.string().min(1).optional(),
  })
  .refine((bake) => (bake.startedAt !== undefined) === (bake.status !== 'queued'), {
    message: 'startedAt chỉ có khi lượt nướng đã rời hàng chờ',
    path: ['startedAt'],
  })
  .refine((bake) => (bake.endedAt !== undefined) === (bake.status === 'done' || bake.status === 'failed'), {
    message: 'endedAt chỉ có khi lượt nướng đã kết thúc',
    path: ['endedAt'],
  })
  .refine((bake) => (bake.failureCode !== undefined) === (bake.status === 'failed'), {
    message: 'failureCode chỉ có khi lượt nướng hỏng',
    path: ['failureCode'],
  });

export type LightingBake = z.infer<typeof LightingBakeSchema>;
export type LightingBakeStatus = (typeof LIGHTING_BAKE_STATUSES)[number];

/** Ba tệp kết quả N44 phục vụ (khớp `LIGHTING_BAKE_FILES` của AppBack, trừ `input.glb`). */
export const LIGHTING_BAKE_FILES = ['baked.glb', 'lightmap.png', 'manifest.json'] as const;
export type LightingBakeFileName = (typeof LIGHTING_BAKE_FILES)[number];

/** N49 — máy chủ có worker nướng không (`LIGHTING_BAKE_ENABLED`). Thiếu/sai dạng = coi như không có. */
export const LightingBakeAvailabilitySchema = z.object({ enabled: z.boolean() });
export type LightingBakeAvailability = z.infer<typeof LightingBakeAvailabilitySchema>;
