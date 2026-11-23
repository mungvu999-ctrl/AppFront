import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { HttpClient, HttpError, Result } from '@/lib/http';

import { createDrawingSetClient } from '../drawingSetClient';
import { ENDPOINTS } from '../endpoints';
import { __resetMockDrawingSets, createMockDrawingSetClient } from '../__mocks__/drawingSetClient';
import type { DrawingSet } from '../schemas/drawingSet';

const SET: DrawingSet = {
  id: 'dws_1',
  status: 'receiving',
  revision: 0,
  progressPercent: 0,
  createdAt: '2026-11-23T01:02:03.456Z',
  files: [],
  views: [],
};

const wireError = (status: number, code: string): HttpError => ({ code, kind: 'http', raw: { code }, requestId: 'r', retryable: false, status });

function fakeHttp(result: Result<unknown, HttpError>) {
  const calls = {
    get: vi.fn(async () => result),
    post: vi.fn(async () => result),
    put: vi.fn(async () => result),
    delete: vi.fn(async () => result),
  };

  return { calls, client: createDrawingSetClient(calls as unknown as HttpClient) };
}

describe('drawingSetClient — đường dây N54–N61', () => {
  it('N54 POST …/drawing-sets, hạn mức trả ngay, decode DrawingSet', async () => {
    const { calls, client } = fakeHttp({ ok: true, data: SET });
    const body = { files: [{ fileName: 'a.pdf', mimeType: 'application/pdf', sizeBytes: 5 }] };
    const result = await client.createSet({ projectId: 'p1', body });

    expect(result).toEqual({ ok: true, data: SET });
    expect(calls.post).toHaveBeenCalledWith(
      ENDPOINTS.drawingSets.root('p1'),
      expect.objectContaining({ body, failFastOnRateLimit: true, idempotent: true }),
    );
    expect(ENDPOINTS.drawingSets.root('p1')).toMatch(/\/projects\/p1\/drawing-sets$/);
  });

  it('N55 POST …/files/{f}/chunks với {chunk, chunkIndex}, thời hạn tệp', async () => {
    const file = { id: 'dwf_1', fileName: 'a.pdf', sizeBytes: 5, chunkCount: 1, status: 'receiving' };
    const { calls, client } = fakeHttp({ ok: true, data: file });
    const result = await client.sendChunk({ projectId: 'p1', setId: 's1', fileId: 'f1', chunk: 'QQ==', chunkIndex: 0 });

    expect(result).toEqual({ ok: true, data: file });
    expect(calls.post).toHaveBeenCalledWith(
      ENDPOINTS.drawingSets.chunk('p1', 's1', 'f1'),
      expect.objectContaining({ body: { chunk: 'QQ==', chunkIndex: 0 }, timeoutMode: 'file' }),
    );
    expect(ENDPOINTS.drawingSets.chunk('p1', 's1', 'f1')).toMatch(/\/drawing-sets\/s1\/files\/f1\/chunks$/);
  });

  it('N56, N60 POST complete/confirm; N57 GET; N61 DELETE', async () => {
    const { calls, client } = fakeHttp({ ok: true, data: SET });

    await client.complete({ projectId: 'p1', setId: 's1' });
    expect(calls.post).toHaveBeenLastCalledWith(ENDPOINTS.drawingSets.complete('p1', 's1'), expect.objectContaining({ body: { setId: 's1' } }));
    await client.confirm({ projectId: 'p1', setId: 's1', revision: 4 });
    expect(calls.post).toHaveBeenLastCalledWith(
      ENDPOINTS.drawingSets.confirm('p1', 's1'),
      expect.objectContaining({ body: { setId: 's1', revision: 4 } }),
    );
    await client.read({ projectId: 'p1', setId: 's1' });
    expect(calls.get).toHaveBeenLastCalledWith(ENDPOINTS.drawingSets.set('p1', 's1'), {});
    await client.remove({ projectId: 'p1', setId: 's1' });
    expect(calls.delete).toHaveBeenLastCalledWith(ENDPOINTS.drawingSets.set('p1', 's1'), expect.objectContaining({ idempotent: true }));
  });

  it('N58 GET danh sách với cursor/limit; N59 PUT {baseVersion, body: {views}}', async () => {
    const page = fakeHttp({ ok: true, data: { items: [], nextCursor: 'n' } });
    const listed = await page.client.list({ projectId: 'p1', cursor: 'c', limit: 20 });

    expect(listed).toEqual({ ok: true, data: { items: [], nextCursor: 'n' } });
    expect(page.calls.get).toHaveBeenCalledWith(ENDPOINTS.drawingSets.root('p1'), { query: { cursor: 'c', limit: 20 } });
    const put = fakeHttp({ ok: true, data: SET });

    await put.client.replaceViews({ projectId: 'p1', setId: 's1', baseVersion: 2, views: [] });
    expect(put.calls.put).toHaveBeenCalledWith(ENDPOINTS.drawingSets.views('p1', 's1'), { body: { baseVersion: 2, body: { views: [] } } });
  });

  it('lỗi dây đi nguyên (503 DRAWING_SET_DISABLED); thân hỏng → lỗi giải mã, không ném', async () => {
    const disabled = fakeHttp({ ok: false, error: wireError(503, 'DRAWING_SET_DISABLED') });
    const result = await disabled.client.createSet({
      projectId: 'p1',
      body: { files: [{ fileName: 'a.pdf', mimeType: 'application/pdf', sizeBytes: 5 }] },
    });

    expect(!result.ok && 'code' in result.error ? result.error.code : undefined).toBe('DRAWING_SET_DISABLED');
    const broken = fakeHttp({ ok: true, data: { ...SET, status: 'bogus' } });

    expect((await broken.client.read({ projectId: 'p1', setId: 's1' })).ok).toBe(false);
  });
});

describe('mock — vòng đời hợp đồng', () => {
  beforeEach(() => {
    __resetMockDrawingSets();
  });
  const file = (fileName: string, sizeBytes = 100) => ({ fileName, mimeType: 'application/pdf', sizeBytes });
  const code = (result: { ok: boolean; error?: unknown }): string | undefined => (result.error as HttpError | undefined)?.code;

  it('receiving → complete → analyzing → (đọc 2 lần) review → N59 → N60 confirmed', async () => {
    const api = createMockDrawingSetClient();
    const created = await api.createSet({ projectId: 'p1', body: { files: [file('bo-6-trang.pdf')] } });

    expect(created.ok && created.data.status).toBe('receiving');
    if (!created.ok) return;
    const { id } = created.data;
    const fileId = created.data.files[0]?.id ?? '';

    await api.sendChunk({ projectId: 'p1', setId: id, fileId, chunk: 'QQ==', chunkIndex: 0 });
    const done = await api.complete({ projectId: 'p1', setId: id });

    expect(done.ok && done.data.status).toBe('analyzing');
    expect((await api.read({ projectId: 'p1', setId: id })).ok).toBe(true);
    const review = await api.read({ projectId: 'p1', setId: id });

    expect(review.ok && review.data.status).toBe('review');
    if (!review.ok) return;
    expect(review.data.views.map((view) => view.kind)).toEqual(['plan', 'plan', 'plan', 'section', 'elevation', 'other']);
    // Máy không bao giờ tự chọn đích.
    expect(review.data.views.every((view) => view.target === undefined)).toBe(true);
    const plans = review.data.views.filter((view) => view.kind === 'plan');
    const edits = plans.map((view, index) => ({
      id: view.id,
      fileId: view.fileId,
      pageIndex: view.pageIndex,
      crop: view.crop,
      excluded: false,
      kind: 'plan' as const,
      target: { mode: 'newFloor' as const, floorId: `L-${String(index)}`, name: `Tầng ${String(index + 1)}` },
    }));
    const saved = await api.replaceViews({ projectId: 'p1', setId: id, baseVersion: review.data.revision, views: edits });

    expect(saved.ok && saved.data.revision).toBe(1);
    const confirmed = await api.confirm({ projectId: 'p1', setId: id, revision: 1 });

    expect(confirmed.ok && confirmed.data.status).toBe('confirmed');
    // Lặp lại: 200 hiện tại, không tạo thêm.
    const again = await api.confirm({ projectId: 'p1', setId: id, revision: 1 });

    expect(again.ok && again.data.revision).toBe(confirmed.ok ? confirmed.data.revision : -1);
  });

  it('lỗi nghiệp vụ: 503 khi tắt, .dwg, VERSION_CONFLICT, REVISION_STALE, NO_PLAN, FLOOR_HAS_DRAWING', async () => {
    const off = createMockDrawingSetClient({ enabled: false });

    expect(code(await off.createSet({ projectId: 'p1', body: { files: [file('a.pdf')] } }))).toBe('DRAWING_SET_DISABLED');

    const api = createMockDrawingSetClient({ occupiedFloorIds: ['L-busy'] });

    expect(code(await api.createSet({ projectId: 'p1', body: { files: [file('a.dwg')] } }))).toBe('CAD_NOT_SUPPORTED');
    const created = await api.createSet({ projectId: 'p1', body: { files: [file('x-3-trang.pdf')] } });

    if (!created.ok) throw new Error('create');
    const id = created.data.id;

    expect(code(await api.replaceViews({ projectId: 'p1', setId: id, baseVersion: 0, views: [] }))).toBe('DRAWING_SET_NOT_READY');
    await api.complete({ projectId: 'p1', setId: id });
    await api.read({ projectId: 'p1', setId: id });
    const review = await api.read({ projectId: 'p1', setId: id });

    if (!review.ok) throw new Error('read');
    const first = review.data.views[0];

    if (first === undefined) throw new Error('view');
    const edit = (target?: { mode: 'floor'; floorId: string }) => ({
      id: first.id,
      fileId: first.fileId,
      pageIndex: first.pageIndex,
      crop: first.crop,
      excluded: false,
      kind: 'plan' as const,
      ...(target ? { target } : {}),
    });

    expect(code(await api.replaceViews({ projectId: 'p1', setId: id, baseVersion: 9, views: [] }))).toBe('VERSION_CONFLICT');
    expect(code(await api.confirm({ projectId: 'p1', setId: id, revision: 5 }))).toBe('DRAWING_SET_REVISION_STALE');
    expect(code(await api.confirm({ projectId: 'p1', setId: id, revision: 0 }))).toBe('DRAWING_SET_NO_PLAN');
    await api.replaceViews({ projectId: 'p1', setId: id, baseVersion: 0, views: [edit({ mode: 'floor', floorId: 'L-busy' })] });
    expect(code(await api.confirm({ projectId: 'p1', setId: id, revision: 1 }))).toBe('FLOOR_HAS_DRAWING');
  });

  it('tệp tên "hong" bị từ chối đúng tên; mọi tệp hỏng → failed', async () => {
    const api = createMockDrawingSetClient();
    const created = await api.createSet({ projectId: 'p1', body: { files: [file('hong.pdf')] } });

    if (!created.ok) throw new Error('create');
    const done = await api.complete({ projectId: 'p1', setId: created.data.id });

    expect(done.ok && done.data.status).toBe('failed');
    expect(done.ok && done.data.errorCode).toBe('DRAWING_SET_ALL_FILES_REJECTED');
    expect(done.ok && done.data.files[0]?.rejectedCode).toBe('FILE_CORRUPT');
  });
});
