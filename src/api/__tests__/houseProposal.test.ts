import { describe, expect, it, vi } from 'vitest';

import { createHttpClient, type HttpClient, type HttpError, type Result } from '@/lib/http';

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

  it('enabled: false → ok với null (tính năng tắt, không phải lỗi)', async () => {
    const { api } = clientWith({ ok: true, data: { enabled: false, floors: [], runIds: [] } });
    expect(await api.houseProposal.read({ projectId: 'proj-1' })).toEqual({ ok: true, data: null });
  });

  it('5xx vẫn là lỗi (không có ánh xạ 503 riêng)', async () => {
    for (const error of [wireError(503, 'DRAWING_SET_DISABLED'), wireError(500, 'INTERNAL')]) {
      const { api } = clientWith({ ok: false, error });
      expect((await api.houseProposal.read({ projectId: 'proj-1' })).ok).toBe(false);
    }
  });

  it('HttpClient thật: 404 (máy chủ chưa có đường) → null sau đúng một lần gọi; 500 → lỗi', async () => {
    const realClient = (status: number) => {
      const fetchImpl = vi.fn(
        async () =>
          new Response(JSON.stringify({ code: status === 404 ? 'NOT_FOUND' : 'INTERNAL' }), {
            status,
            headers: { 'Content-Type': 'application/json' },
          }),
      );
      return { api: createApiClient(createHttpClient({ baseUrl: 'https://api.example.com', fetchImpl })), fetchImpl };
    };

    const missing = realClient(404);
    expect(await missing.api.houseProposal.read({ projectId: 'proj-1' })).toEqual({ ok: true, data: null });
    expect(missing.fetchImpl).toHaveBeenCalledTimes(1);

    expect((await realClient(500).api.houseProposal.read({ projectId: 'proj-1' })).ok).toBe(false);
  });

  it('trường lạ, mã lạ, số ngoài khoảng không làm hỏng câu trả lời', async () => {
    const floor = {
      ...MOCK_HOUSE_PROPOSAL.floors[1],
      kind: 'isometric',
      storeyLabel: 'loft',
      elevationSource: 'laser',
      heightMm: 99999,
      elevationConfidence: 7,
      questions: [{ code: 'NEW_CODE', detail: 'x' }],
      futureField: 1,
    };
    const { api } = clientWith({ ok: true, data: { enabled: true, floors: [floor], runIds: ['r'], extra: true } });
    const result = await api.houseProposal.read({ projectId: 'proj-1' });

    expect(result.ok).toBe(true);
    const decoded = result.ok ? result.data?.floors[0] : undefined;
    expect(decoded).toMatchObject({ kind: 'isometric', storeyLabel: 'loft', elevationSource: 'laser', questions: [{ code: 'NEW_CODE' }] });
    expect(decoded?.heightMm).toBeUndefined();
    expect(decoded?.elevationConfidence).toBeUndefined();
    expect(decoded?.elevationMm).toBe(MOCK_HOUSE_PROPOSAL.floors[1]!.elevationMm);
  });

  it('thân sai hợp đồng → lỗi giải mã, không phải dữ liệu', async () => {
    const { api } = clientWith({ ok: true, data: { enabled: true, floors: [{ floorId: 'x' }], runIds: [] } });
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

  it('read trả ví dụ; dự án "tắt" (enabled: false) trả null', async () => {
    const mock = createMockApiClient();
    expect(await mock.houseProposal.read({ projectId: 'p' })).toEqual({ ok: true, data: MOCK_HOUSE_PROPOSAL });
    expect(await mock.houseProposal.read({ projectId: MOCK_HOUSE_PROPOSAL_DISABLED_PROJECT_ID })).toEqual({
      ok: true,
      data: null,
    });
  });
});
