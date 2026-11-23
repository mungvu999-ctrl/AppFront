import { describe, expect, it, vi } from 'vitest';

import type { HttpClient, HttpError, Result } from '@/lib/http';

import { createApiClient } from '../client';
import { ENDPOINTS } from '../endpoints';
import { createMockApiClient } from '../__mocks__/client';

const PROJECT = 'project-1';
const UPLOAD = 'upl_01J8Z3K4Q5R6S7T8V9W0XYZAB1';
const PATH = `/projects/${PROJECT}/drawings/uploads/${UPLOAD}/rerun`;

const PENDING = { id: UPLOAD, progressPercent: 0, status: 'pending', step: 'Rerun' };

const failure = (status: number, code: string): Result<never, HttpError> => ({
  ok: false,
  error: { code, kind: 'http', raw: { code }, requestId: 'req-1', retryable: status === 429, status },
});

const httpPosting = (result: Result<unknown, HttpError>): HttpClient =>
  ({ post: vi.fn(() => Promise.resolve(result)) }) as unknown as HttpClient;

describe('drawings.rerun (N51)', () => {
  it('đường dẫn đúng và nằm cạnh complete', () => {
    expect(ENDPOINTS.drawings.rerun(PROJECT, UPLOAD)).toBe(PATH);
  });

  it('POST không thân, kèm idempotencyKey và failFastOnRateLimit, giải mã Progress pending', async () => {
    const http = httpPosting({ ok: true, data: PENDING });

    const result = await createApiClient(http).drawings.rerun({
      idempotencyKey: 'key-rerun',
      projectId: PROJECT,
      uploadId: UPLOAD,
    });

    expect(result).toEqual({ ok: true, data: PENDING });
    expect(http.post).toHaveBeenCalledWith(
      PATH,
      expect.objectContaining({ failFastOnRateLimit: true, idempotencyKey: 'key-rerun' }),
    );
    expect(vi.mocked(http.post).mock.calls[0]?.[1]).not.toHaveProperty('body');
  });

  it('thân trả về sai hình thì không lọt qua: ok:false', async () => {
    const result = await createApiClient(httpPosting({ ok: true, data: { nonsense: true } })).drawings.rerun({
      projectId: PROJECT,
      uploadId: UPLOAD,
    });

    expect(result.ok).toBe(false);
  });

  it.each([
    [409, 'PIPELINE_RUNNING'],
    [409, 'UPLOAD_SUPERSEDED'],
    [410, 'GONE'],
    [429, 'RATE_LIMITED'],
  ])('lỗi %s %s đi ra nguyên mã và status', async (status, code) => {
    const result = await createApiClient(httpPosting(failure(status, code))).drawings.rerun({
      projectId: PROJECT,
      uploadId: UPLOAD,
    });

    expect(result).toMatchObject({ ok: false, error: { code, status } });
  });

  it('mock trả Progress pending của đúng lượt tải', async () => {
    const result = await createMockApiClient().drawings.rerun({ projectId: PROJECT, uploadId: UPLOAD });

    expect(result).toMatchObject({ ok: true, data: { id: UPLOAD, status: 'pending' } });
  });
});
