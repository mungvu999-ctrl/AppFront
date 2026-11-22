import { describe, expect, it } from 'vitest';

import { LightingBakeAvailabilitySchema, LightingBakeSchema } from '../../schemas/lightingBake';

const ID = 'bak_01JABCDEFGHJKMNPQRSTVWXYZ0';
const T = '2026-11-02T08:00:00.000Z';

describe('LightingBakeAvailabilitySchema', () => {
  it('chỉ nhận enabled là boolean', () => {
    expect(LightingBakeAvailabilitySchema.safeParse({ enabled: true }).success).toBe(true);
    expect(LightingBakeAvailabilitySchema.safeParse({}).success).toBe(false);
  });
});

describe('LightingBakeSchema', () => {
  it('nhận đủ bốn trạng thái với mốc thời gian khớp', () => {
    expect(LightingBakeSchema.safeParse({ id: ID, status: 'queued', createdAt: T }).success).toBe(true);
    expect(LightingBakeSchema.safeParse({ id: ID, status: 'running', createdAt: T, startedAt: T }).success).toBe(true);
    expect(LightingBakeSchema.safeParse({ id: ID, status: 'done', createdAt: T, startedAt: T, endedAt: T }).success).toBe(
      true,
    );
    expect(
      LightingBakeSchema.safeParse({
        id: ID,
        status: 'failed',
        createdAt: T,
        startedAt: T,
        endedAt: T,
        failureCode: 'LIGHTING_BAKE_TIMEOUT',
      }).success,
    ).toBe(true);
  });

  it('từ chối mốc thời gian hay mã lỗi lệch trạng thái', () => {
    expect(LightingBakeSchema.safeParse({ id: ID, status: 'queued', createdAt: T, startedAt: T }).success).toBe(false);
    expect(LightingBakeSchema.safeParse({ id: ID, status: 'running', createdAt: T }).success).toBe(false);
    expect(LightingBakeSchema.safeParse({ id: ID, status: 'done', createdAt: T, startedAt: T }).success).toBe(false);
    expect(
      LightingBakeSchema.safeParse({ id: ID, status: 'failed', createdAt: T, startedAt: T, endedAt: T }).success,
    ).toBe(false);
    expect(
      LightingBakeSchema.safeParse({
        id: ID,
        status: 'done',
        createdAt: T,
        startedAt: T,
        endedAt: T,
        failureCode: 'X',
      }).success,
    ).toBe(false);
  });

  it('từ chối id sai tiền tố và trạng thái lạ', () => {
    expect(LightingBakeSchema.safeParse({ id: 'ver_01JABCDEFGHJKMNPQRSTVWXYZ0', status: 'queued', createdAt: T }).success).toBe(
      false,
    );
    expect(LightingBakeSchema.safeParse({ id: ID, status: 'paused', createdAt: T }).success).toBe(false);
  });
});
