import { describe, expect, it } from 'vitest';

import {
  ConfirmDrawingSetSchema,
  CreateDrawingSetSchema,
  DRAWING_SET_LIMITS,
  DrawingSetSchema,
  DrawingSetSummaryPageSchema,
  ReplaceViewsSchema,
  ViewEditSchema,
  ViewTargetSchema,
} from '../drawingSet';

const VIEW = {
  id: 'dwv_1',
  fileId: 'dwf_1',
  pageIndex: 0,
  crop: { xRatio: 0, yRatio: 0, widthRatio: 1, heightRatio: 1 },
  source: 'ai',
  excluded: false,
  kind: 'plan',
  kindConfidence: 0.9,
  questions: [{ code: 'STOREY_UNSURE' }],
};
const SET = {
  id: 'dws_1',
  status: 'review',
  revision: 2,
  progressPercent: 100,
  createdAt: '2026-11-23T01:02:03.456Z',
  files: [{ id: 'dwf_1', fileName: 'a.pdf', sizeBytes: 10, chunkCount: 1, status: 'complete', pageCount: 3 }],
  views: [VIEW],
};

describe('DrawingSet (N54–N61) — schema strict', () => {
  it('nhận thân đủ trường, giữ tuỳ chọn vắng', () => {
    const parsed = DrawingSetSchema.parse(SET);

    expect('name' in parsed).toBe(false);
    expect(parsed.views[0]?.kind).toBe('plan');
  });

  it('chặn trường lạ, null ở trường tuỳ chọn (W2), loại lạ, trạng thái lạ, độ chắc ngoài 0–1', () => {
    expect(DrawingSetSchema.safeParse({ ...SET, extra: 1 }).success).toBe(false);
    expect(DrawingSetSchema.safeParse({ ...SET, name: null }).success).toBe(false);
    expect(DrawingSetSchema.safeParse({ ...SET, status: 'done' }).success).toBe(false);
    expect(DrawingSetSchema.safeParse({ ...SET, views: [{ ...VIEW, kind: 'garden' }] }).success).toBe(false);
    expect(DrawingSetSchema.safeParse({ ...SET, views: [{ ...VIEW, kindConfidence: 1.2 }] }).success).toBe(false);
    expect(DrawingSetSchema.safeParse({ ...SET, views: [{ ...VIEW, extra: true }] }).success).toBe(false);
  });

  it('K-65: sheetNo và titleBlock tuỳ chọn, vắng khoá khi không có; null/rỗng/khoá lạ bị chặn', () => {
    const ok = DrawingSetSchema.parse({
      ...SET,
      titleBlock: { project: 'Nhà phố A', date: '2026-11-01' },
      views: [{ ...VIEW, sheetNo: 'KT-01' }],
    });

    expect(ok.views[0]?.sheetNo).toBe('KT-01');
    expect(ok.titleBlock).toEqual({ project: 'Nhà phố A', date: '2026-11-01' });
    expect(DrawingSetSchema.safeParse({ ...SET, titleBlock: {} }).success).toBe(true);
    expect(DrawingSetSchema.safeParse({ ...SET, titleBlock: null }).success).toBe(false);
    expect(DrawingSetSchema.safeParse({ ...SET, titleBlock: { owner: null } }).success).toBe(false);
    expect(DrawingSetSchema.safeParse({ ...SET, titleBlock: { owner: '' } }).success).toBe(false);
    expect(DrawingSetSchema.safeParse({ ...SET, titleBlock: { sheet: 'x' } }).success).toBe(false);
    expect(DrawingSetSchema.safeParse({ ...SET, views: [{ ...VIEW, sheetNo: null }] }).success).toBe(false);
  });

  it('K-65: thân N59 nhận name tuỳ chọn đã trim, 1–120 ký tự', () => {
    const body = { views: [] };

    expect(ReplaceViewsSchema.parse({ baseVersion: 1, body: { ...body, name: '  Nhà phố An ' } }).body.name).toBe('Nhà phố An');
    expect('name' in ReplaceViewsSchema.parse({ baseVersion: 1, body }).body).toBe(false);
    expect(ReplaceViewsSchema.safeParse({ baseVersion: 1, body: { ...body, name: '   ' } }).success).toBe(false);
    expect(ReplaceViewsSchema.safeParse({ baseVersion: 1, body: { ...body, name: 'x'.repeat(121) } }).success).toBe(false);
    expect(ReplaceViewsSchema.safeParse({ baseVersion: 1, body: { ...body, name: null } }).success).toBe(false);
  });

  it('thời điểm là UTC Z đúng ba chữ số mili giây (W3)', () => {
    expect(DrawingSetSchema.safeParse({ ...SET, createdAt: '2026-11-23T01:02:03+07:00' }).success).toBe(false);
    expect(DrawingSetSchema.safeParse({ ...SET, createdAt: '2026-11-23T01:02:03Z' }).success).toBe(false);
  });

  it('ViewTarget: ba dạng, trường lạ bị chặn, replace chỉ là true', () => {
    expect(ViewTargetSchema.safeParse({ mode: 'floor', floorId: 'L-1', replace: true }).success).toBe(true);
    expect(ViewTargetSchema.safeParse({ mode: 'floor', floorId: 'L-1', replace: false }).success).toBe(false);
    expect(ViewTargetSchema.safeParse({ mode: 'newFloor', floorId: 'L-2', name: 'Tầng 2' }).success).toBe(true);
    expect(ViewTargetSchema.safeParse({ mode: 'newFloor', floorId: 'L-2' }).success).toBe(false);
    expect(ViewTargetSchema.safeParse({ mode: 'section', name: 'Mặt cắt' }).success).toBe(true);
    expect(ViewTargetSchema.safeParse({ mode: 'section', name: 'Mặt cắt', floorId: 'L-1' }).success).toBe(false);
  });

  it('trang danh sách: mục strict, nextCursor tuỳ chọn', () => {
    const item = { id: 'dws_1', status: 'review', createdAt: SET.createdAt, fileCount: 1, viewCount: 3 };

    expect(DrawingSetSummaryPageSchema.safeParse({ items: [item], nextCursor: 'c' }).success).toBe(true);
    expect(DrawingSetSummaryPageSchema.safeParse({ items: [{ ...item, x: 1 }] }).success).toBe(false);
  });
});

describe('thân gửi đi', () => {
  it('N54: 1–20 tệp', () => {
    const file = { fileName: 'a.pdf', mimeType: 'application/pdf', sizeBytes: 5 };

    expect(CreateDrawingSetSchema.safeParse({ files: [] }).success).toBe(false);
    expect(CreateDrawingSetSchema.safeParse({ files: [file] }).success).toBe(true);
    expect(CreateDrawingSetSchema.safeParse({ files: Array.from({ length: DRAWING_SET_LIMITS.maxFiles }, () => file) }).success).toBe(true);
    expect(CreateDrawingSetSchema.safeParse({ files: Array.from({ length: DRAWING_SET_LIMITS.maxFiles + 1 }, () => file) }).success).toBe(false);
  });

  it('N59: bắt buộc baseVersion, tối đa 60 hình, ViewEdit không mang trường của máy', () => {
    const edit = { id: 'dwv_1', fileId: 'dwf_1', pageIndex: 0, crop: VIEW.crop, excluded: false, kind: 'plan' };

    expect(ReplaceViewsSchema.safeParse({ body: { views: [edit] } }).success).toBe(false);
    expect(ReplaceViewsSchema.safeParse({ baseVersion: 2, body: { views: [edit] } }).success).toBe(true);
    expect(ReplaceViewsSchema.safeParse({ baseVersion: 2, body: { views: Array.from({ length: 61 }, () => edit) } }).success).toBe(false);
    expect(ViewEditSchema.safeParse({ ...edit, kindConfidence: 0.5 }).success).toBe(false);
  });

  it('N60: {setId, revision}', () => {
    expect(ConfirmDrawingSetSchema.safeParse({ setId: 'dws_1', revision: 3 }).success).toBe(true);
    expect(ConfirmDrawingSetSchema.safeParse({ setId: 'dws_1' }).success).toBe(false);
  });
});
