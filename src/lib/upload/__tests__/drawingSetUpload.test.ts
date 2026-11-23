import { describe, expect, it, vi } from 'vitest';

import type { DrawingSetClient } from '@/api/drawingSetClient';
import type { DrawingSet } from '@/api/schemas/drawingSet';
import type { HttpError } from '@/lib/http';

import {
  checkDrawingSetBatch,
  measureDrawingSetFile,
  uploadDrawingSet,
  type DrawingSetUploadProgress,
} from '../drawingSetUpload';

const png = (name: string, size = 10): File => new File([new Uint8Array(size)], name, { type: 'image/png' });
const pdf = (name: string, pages: number): File =>
  new File([`%PDF-1.4\n${'<< /Type /Page >>\n'.repeat(pages)}`], name, { type: 'application/pdf' });

describe('checkDrawingSetBatch — giới hạn cả bộ (K-32a §3)', () => {
  it('bộ vừa giới hạn: không vấn đề; PDF 20 trang + PDF 20 trang = 40 trang vẫn qua', async () => {
    const measured = await Promise.all([measureDrawingSetFile(pdf('a.pdf', 20)), measureDrawingSetFile(pdf('b.pdf', 20))]);
    const check = checkDrawingSetBatch(measured);

    expect(check.totalPages).toBe(40);
    expect(check.issues).toEqual([]);
  });

  it('41 trang → tooManyPages; 21 tệp → tooManyFiles; vượt 200 MiB → tooManyBytes', async () => {
    const pages = checkDrawingSetBatch(await Promise.all([measureDrawingSetFile(pdf('a.pdf', 20)), measureDrawingSetFile(pdf('b.pdf', 20)), measureDrawingSetFile(png('c.png'))]));

    expect(pages.issues).toEqual([{ kind: 'tooManyPages', pages: 41, max: 40 }]);
    const many = checkDrawingSetBatch(await Promise.all(Array.from({ length: 21 }, (_, index) => measureDrawingSetFile(png(`${String(index)}.png`)))));

    expect(many.issues.map((issue) => issue.kind)).toContain('tooManyFiles');
    // Dung lượng: tệp giả báo size lớn, không cần cấp phát thật.
    const big = { name: 'big.png', type: 'image/png', size: 90 * 1024 * 1024, slice: () => new Blob() };
    const heavy = checkDrawingSetBatch(await Promise.all([measureDrawingSetFile(big), measureDrawingSetFile(big), measureDrawingSetFile(big)]));

    expect(heavy.issues.map((issue) => issue.kind)).toEqual(['tooManyBytes']);
  });

  it('tệp bị từ chối riêng (.dwg, PDF 21 trang) không tính vào tổng và mang lý do', async () => {
    const dwg = await measureDrawingSetFile({ name: 'a.dwg', type: '', size: 5, slice: () => new Blob() });
    const long = await measureDrawingSetFile(pdf('long.pdf', 21));
    const ok = await measureDrawingSetFile(png('ok.png'));

    expect(!dwg.ok && dwg.reason.kind).toBe('unsupportedFormat');
    expect(!long.ok && long.reason.kind).toBe('tooManyPages');
    expect(checkDrawingSetBatch([dwg, long, ok])).toMatchObject({ totalFiles: 1, totalPages: 1, issues: [] });
  });
});

const wire = (status: number, code: string): HttpError => ({ code, kind: 'http', raw: {}, requestId: 'r', retryable: status >= 500, status });
const SET: DrawingSet = {
  id: 'dws_1',
  status: 'receiving',
  revision: 0,
  progressPercent: 0,
  createdAt: '2026-11-23T00:00:00.000Z',
  files: [
    { id: 'dwf_a', fileName: 'a.png', sizeBytes: 10, chunkCount: 1, status: 'receiving' },
    { id: 'dwf_b', fileName: 'b.pdf', sizeBytes: 20, chunkCount: 1, status: 'receiving' },
  ],
  views: [],
};

function fakeApi(overrides: Partial<DrawingSetClient> = {}) {
  const log: string[] = [];
  const api: Pick<DrawingSetClient, 'complete' | 'createSet' | 'sendChunk'> = {
    createSet: vi.fn(async () => {
      log.push('create');

      return { ok: true as const, data: SET };
    }),
    sendChunk: vi.fn(async ({ fileId, chunkIndex }) => {
      log.push(`chunk:${fileId}:${String(chunkIndex)}`);

      return { ok: true as const, data: SET.files[0] ?? ({} as never) };
    }),
    complete: vi.fn(async () => {
      log.push('complete');

      return { ok: true as const, data: { ...SET, status: 'analyzing' as const } };
    }),
    ...overrides,
  };

  return { api, log };
}

describe('uploadDrawingSet — N54 → N55 → N56', () => {
  it('khai tệp, gửi tuần tự từng tệp, chốt; tiến độ lên 100', async () => {
    const { api, log } = fakeApi();
    const progress: DrawingSetUploadProgress[] = [];
    const result = await uploadDrawingSet({ api, projectId: 'p1', files: [png('a.png', 10), pdf('b.pdf', 1)], onProgress: (value) => progress.push(value) });

    expect(result.ok && result.set.status).toBe('analyzing');
    expect(log).toEqual(['create', 'chunk:dwf_a:0', 'chunk:dwf_b:0', 'complete']);
    expect(api.createSet).toHaveBeenCalledWith(expect.objectContaining({ body: { files: [expect.objectContaining({ fileName: 'a.png', mimeType: 'image/png' }), expect.objectContaining({ fileName: 'b.pdf' })] } }));
    expect(progress.at(-1)).toEqual({ stage: 'complete', percent: 100 });
    expect(progress.map((value) => value.percent)).toEqual([...progress.map((value) => value.percent)].sort((a, b) => a - b));
  });

  it('khúc hỏng tạm thời được thử lại; lỗi dứt điểm (422) dừng ngay, nêu setId để màn bỏ bộ', async () => {
    let calls = 0;
    const flaky = fakeApi({
      sendChunk: async () => {
        calls += 1;

        return calls === 1 ? { ok: false as const, error: { kind: 'network', requestId: 'r', retryable: true, raw: null } } : { ok: true as const, data: SET.files[0] ?? ({} as never) };
      },
    });
    const retried = await uploadDrawingSet({ api: flaky.api, projectId: 'p1', files: [png('a.png'), pdf('b.pdf', 1)], sleep: async () => undefined });

    expect(retried.ok).toBe(true);
    expect(calls).toBe(3);

    const terminal = fakeApi({ sendChunk: async () => ({ ok: false as const, error: wire(422, 'FILE_CORRUPT') }) });
    const failed = await uploadDrawingSet({ api: terminal.api, projectId: 'p1', files: [png('a.png'), pdf('b.pdf', 1)], sleep: async () => undefined });

    expect(failed).toMatchObject({ ok: false, stage: 'chunk', setId: 'dws_1' });
    expect(terminal.log).toEqual(['create']);
  });

  it('create hỏng (503 tắt công tắc) → stage create, không có setId; không gọi chunk', async () => {
    const off = fakeApi({ createSet: async () => ({ ok: false as const, error: wire(503, 'DRAWING_SET_DISABLED') }) });
    const result = await uploadDrawingSet({ api: off.api, projectId: 'p1', files: [png('a.png')], sleep: async () => undefined });

    expect(result).toMatchObject({ ok: false, stage: 'create' });
    expect(!result.ok && result.setId).toBeUndefined();
    expect(off.api.sendChunk).not.toHaveBeenCalled();
  });

  it('huỷ giữa chừng → cancelled kèm setId, không gọi complete', async () => {
    const controller = new AbortController();
    const { api } = fakeApi({
      sendChunk: async () => {
        controller.abort();

        return { ok: true as const, data: SET.files[0] ?? ({} as never) };
      },
    });
    const result = await uploadDrawingSet({ api, projectId: 'p1', files: [png('a.png'), pdf('b.pdf', 1)], signal: controller.signal });

    expect(result).toMatchObject({ ok: false, stage: 'cancelled', setId: 'dws_1' });
    expect(api.complete).not.toHaveBeenCalled();
  });
});
