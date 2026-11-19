import { describe, expect, it, vi } from 'vitest';

import type { HttpClient, HttpError, Result } from '@/lib/http';

import { createApiClient } from '../client';
import { ENDPOINTS } from '../endpoints';
import {
  createMockApiClient,
  MOCK_HOUSE_PROPOSAL,
  MOCK_HOUSE_PROPOSAL_DISABLED_PROJECT_ID,
} from '../__mocks__/client';
import { HouseProposalSchema } from '../schemas/houseProposal';

const PATH = ENDPOINTS.houseProposal('proj-1');

const wireError = (status: number, code: string): HttpError => ({
  code,
  kind: 'http',
  raw: { code },
  requestId: 'req-hp',
  retryable: false,
  status,
});

const clientWith = (result: Result<unknown, HttpError>) => {
  const get = vi.fn(async () => result) as unknown as HttpClient['get'];
  const http = { get } as unknown as HttpClient;
  return { api: createApiClient(http), get };
};

describe('houseProposal.read', () => {
  it('đi tới /projects/{id}/house-proposal và giải mã thân', async () => {
    const { api, get } = clientWith({ ok: true, data: MOCK_HOUSE_PROPOSAL });
    const result = await api.houseProposal.read({ projectId: 'proj-1' });

    expect(PATH).toMatch(/\/projects\/proj-1\/house-proposal$/);
    expect(get).toHaveBeenCalledWith(PATH, undefined);
    expect(result).toEqual({ ok: true, data: MOCK_HOUSE_PROPOSAL });
  });

  it('503 DRAWING_SET_DISABLED → ok với null (tính năng tắt, không phải lỗi)', async () => {
    const { api } = clientWith({ ok: false, error: wireError(503, 'DRAWING_SET_DISABLED') });
    expect(await api.houseProposal.read({ projectId: 'proj-1' })).toEqual({ ok: true, data: null });
  });

  it('503 mã khác và 404 vẫn là lỗi', async () => {
    for (const error of [wireError(503, 'UNAVAILABLE'), wireError(404, 'NOT_FOUND'), wireError(500, 'DRAWING_SET_DISABLED')]) {
      const { api } = clientWith({ ok: false, error });
      const result = await api.houseProposal.read({ projectId: 'proj-1' });
      expect(result.ok).toBe(false);
    }
  });

  it('thân sai hợp đồng → lỗi giải mã, không phải dữ liệu', async () => {
    const { api } = clientWith({ ok: true, data: { floors: [{ floorId: 'x' }], runIds: [] } });
    expect((await api.houseProposal.read({ projectId: 'proj-1' })).ok).toBe(false);
  });
});

describe('mock houseProposal', () => {
  it('ví dụ 4 tầng hợp lệ theo lược đồ, đủ ba dải độ chắc và ba mã câu hỏi', () => {
    const parsed = HouseProposalSchema.parse(MOCK_HOUSE_PROPOSAL);
    const confidences = parsed.floors.map((f) => f.storeyConfidence);
    expect(parsed.floors).toHaveLength(4);
    expect(confidences.some((c) => c >= 0.9)).toBe(true);
    expect(confidences.some((c) => c >= 0.7 && c < 0.9)).toBe(true);
    expect(confidences.some((c) => c < 0.7)).toBe(true);
    expect(new Set(parsed.floors.flatMap((f) => f.questions.map((q) => q.code))).size).toBeGreaterThanOrEqual(3);
  });

  it('read trả ví dụ; dự án "tắt" trả null', async () => {
    const mock = createMockApiClient();
    expect(await mock.houseProposal.read({ projectId: 'p' })).toEqual({ ok: true, data: MOCK_HOUSE_PROPOSAL });
    expect(await mock.houseProposal.read({ projectId: MOCK_HOUSE_PROPOSAL_DISABLED_PROJECT_ID })).toEqual({
      ok: true,
      data: null,
    });
  });
});
