import { describe, expect, it, vi } from 'vitest';

import type { HttpClient } from '@/lib/http';

import { createApiClient } from '../../client';
import { createMockApiClient, MOCK_PIPELINE_RUNS } from '../../__mocks__/client';
import { InvitationPreviewRequestSchema, InvitationPreviewSchema } from '../../schemas/auth';
import { PipelineRunSchema } from '../../schemas/pipelineRuns';

/** UIFIX-B2 (N10b xem trước lời mời) + UIFIX-B7 (N7b lượt xử lý, trang thông báo). */

const RUN = {
  createdAt: '2026-10-18T21:05:00Z',
  errorCode: 'BOOM',
  floorId: 'L-0000000002',
  floorName: 'Tầng 2',
  progressPercent: 5,
  runId: 'run_01JB',
  startedAt: '2026-10-18T21:05:03Z',
  status: 'failed',
  step: 'wallSegmentation',
  updatedAt: '2026-10-18T21:06:12Z',
  uploadId: 'upl_01JB',
};

const PREVIEW = {
  email: 'uireview-eng@example.test',
  expiresAt: '2026-10-25T14:03:00.000Z',
  inviterName: 'Quản Trị Viên',
  role: 'engineer',
  status: 'valid',
};

const httpReturning = (data: unknown) => {
  const get = vi.fn(async () => ({ ok: true as const, data }));
  const post = vi.fn(async () => ({ ok: true as const, data }));
  return { get, http: { get, post } as unknown as HttpClient, post };
};

describe('PipelineRunSchema (N7b)', () => {
  it('nhận mục mẫu của B7 và mục vắng khoá tuỳ chọn', () => {
    expect(PipelineRunSchema.safeParse(RUN).success).toBe(true);
    const bare: Record<string, unknown> = { ...RUN, status: 'pending' };
    delete bare.errorCode;
    delete bare.startedAt;
    expect(PipelineRunSchema.safeParse(bare).success).toBe(true);
  });

  it('từ chối trạng thái lạ, phần trăm ngoài 0..100, khoá lạ', () => {
    expect(PipelineRunSchema.safeParse({ ...RUN, status: 'done' }).success).toBe(false);
    expect(PipelineRunSchema.safeParse({ ...RUN, progressPercent: 101 }).success).toBe(false);
    expect(PipelineRunSchema.safeParse({ ...RUN, extra: 1 }).success).toBe(false);
  });

  it('mọi mục mock hợp lệ', () => {
    for (const run of MOCK_PIPELINE_RUNS) expect(PipelineRunSchema.safeParse(run).success).toBe(true);
  });

  it('client gọi đúng đường + query, bỏ mục hỏng và giữ nextCursor', async () => {
    const { get, http } = httpReturning({ items: [RUN, RUN, RUN, RUN, { ...RUN, status: 'x' }], nextCursor: 'c2' });
    const result = await createApiClient(http).drawings.listPipelineRuns({
      cursor: 'c1',
      limit: 20,
      projectId: 'project-1',
    });

    expect(get).toHaveBeenCalledWith('/projects/project-1/pipeline-runs', { query: { cursor: 'c1', limit: 20 } });
    expect(result).toMatchObject({ ok: true, data: { droppedCount: 1, nextCursor: 'c2' } });
  });

  it('mock phân trang theo limit', async () => {
    const api = createMockApiClient();
    const first = await api.drawings.listPipelineRuns({ limit: 2, projectId: 'project-1' });
    expect(first).toMatchObject({ ok: true, data: { nextCursor: '2' } });
    const last = await api.drawings.listPipelineRuns({ cursor: '2', limit: 2, projectId: 'project-1' });
    expect(last.ok && last.data.nextCursor).toBeUndefined();
  });
});

describe('InvitationPreviewSchema (N10b)', () => {
  it('nhận có và không có inviterName', () => {
    expect(InvitationPreviewSchema.safeParse(PREVIEW).success).toBe(true);
    const noInviter: Record<string, unknown> = { ...PREVIEW };
    delete noInviter.inviterName;
    expect(InvitationPreviewSchema.safeParse(noInviter).success).toBe(true);
  });

  it('từ chối vai lạ, status khác valid, khoá lạ; thân gửi đòi token 1..512', () => {
    expect(InvitationPreviewSchema.safeParse({ ...PREVIEW, role: 'owner' }).success).toBe(false);
    expect(InvitationPreviewSchema.safeParse({ ...PREVIEW, status: 'used' }).success).toBe(false);
    expect(InvitationPreviewSchema.safeParse({ ...PREVIEW, userId: 'u1' }).success).toBe(false);
    expect(InvitationPreviewRequestSchema.safeParse({ token: '' }).success).toBe(false);
    expect(InvitationPreviewRequestSchema.safeParse({ token: 'x'.repeat(513) }).success).toBe(false);
  });

  it('client POST token trong thân tới /auth/invitations/preview', async () => {
    const { http, post } = httpReturning(PREVIEW);
    const result = await createApiClient(http).auth.previewInvitation({ body: { token: 'tok' } });

    const [path, init] = (post.mock.calls[0] ?? []) as unknown as [string?, unknown?];
    expect(path).toBe('/auth/invitations/preview');
    expect(init).toMatchObject({ body: { token: 'tok' } });
    expect(result).toMatchObject({ ok: true, data: { role: 'engineer' } });
  });

  it('mock trả 422 đúng mã theo token', async () => {
    const result = await createMockApiClient().auth.previewInvitation({ body: { token: 'abc-expired' } });
    expect(result).toMatchObject({ ok: false, error: { status: 422, code: 'INVITATION_TOKEN_EXPIRED', raw: { code: 'INVITATION_TOKEN_EXPIRED' } } });
  });
});

describe('notifications.listPage (B7)', () => {
  it('gửi limit/cursor, đọc X-Next-Cursor', async () => {
    const response = { headers: new Headers({ 'X-Next-Cursor': 'n2' }), text: '[]' };
    const { get, http } = httpReturning(response);
    const result = await createApiClient(http).notifications.listPage({ cursor: 'n1', limit: 20 });

    expect(get).toHaveBeenCalledWith('/notifications', {
      query: { cursor: 'n1', limit: 20 },
      responseType: 'textWithHeaders',
    });
    expect(result).toStrictEqual({ ok: true, data: { items: [], nextCursor: 'n2' } });
  });

  it('không có header nghĩa là hết', async () => {
    const { http } = httpReturning({ headers: new Headers(), text: '[]' });
    const result = await createApiClient(http).notifications.listPage();
    expect(result).toStrictEqual({ ok: true, data: { items: [] } });
  });

  it('mock phân trang hộp thư', async () => {
    const page = await createMockApiClient().notifications.listPage({ limit: 1 });
    expect(page.ok && page.data.items).toHaveLength(1);
    expect(page.ok && page.data.nextCursor).toBe('1');
  });
});
