import { describe, expect, it, vi } from 'vitest';

import type { HttpClient, HttpError, Result } from '@/lib/http';

import { createApiClient } from '../client';

const WIRE = {
  id: 'mex_01JABCDEFGHJKMNPQRSTVWXYZ0',
  status: 'queued',
  stale: false,
  fingerprint: 'fp',
  currentFingerprint: 'fp',
  snapshotRevisions: [],
  counts: {},
  issues: [],
  createdAt: '2026-11-07T05:00:00.000Z',
};

function makeClient(reply: Result<unknown, HttpError>) {
  const call = vi.fn(async () => reply as Result<never, HttpError>);
  const http: HttpClient = {
    delete: call,
    events: { emit: () => undefined, on: () => () => undefined },
    get: call,
    getRecentRequests: () => [],
    patch: call,
    post: call,
    put: call,
  };
  return { call, client: createApiClient(http) };
}

const notFound: HttpError = { kind: 'http', status: 404, code: 'NOT_FOUND', requestId: 'r', retryable: false, raw: null };

describe('modelExports (N49–N51)', () => {
  it('start gửi thân {} tới /model-exports và giải mã schema', async () => {
    const { call, client } = makeClient({ ok: true, data: WIRE });
    const result = await client.modelExports.start('p1');
    expect(result.ok && result.data.id).toBe(WIRE.id);
    expect(call).toHaveBeenCalledWith('/projects/p1/model-exports', expect.objectContaining({ body: {} }));
  });

  it('readLatest: 404 → null; dữ liệu đúng → job', async () => {
    expect(await makeClient({ ok: false, error: notFound }).client.modelExports.readLatest('p1')).toEqual({ ok: true, data: null });
    const latest = await makeClient({ ok: true, data: WIRE }).client.modelExports.readLatest('p1');
    expect(latest.ok && latest.data?.status).toBe('queued');
  });

  it('readFile tải blob theo đường N51', async () => {
    const { call, client } = makeClient({ ok: true, data: new Blob(['x']) });
    const result = await client.modelExports.readFile('p1', WIRE.id, 'report.json');
    expect(result.ok).toBe(true);
    expect(call).toHaveBeenCalledWith(
      `/projects/p1/model-exports/${WIRE.id}/files/report.json`,
      expect.objectContaining({ responseType: 'blob' }),
    );
  });
});
