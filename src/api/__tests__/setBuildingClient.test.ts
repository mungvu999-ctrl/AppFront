import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { HttpClient, HttpError, Result } from '@/lib/http';

import { createDrawingSetClient } from '../drawingSetClient';
import { ENDPOINTS } from '../endpoints';
import { __resetMockDrawingSets, createMockDrawingSetClient } from '../__mocks__/drawingSetClient';
import type { ViewEdit } from '../schemas/drawingSet';
import { SetBuildingSchema, type BuildingDecisions } from '../schemas/setBuilding';

const EMPTY: BuildingDecisions = { levels: [], roofs: [], picks: {}, seen: [] };
const SET = { id: 'dws_1', status: 'review', revision: 1, progressPercent: 100, createdAt: '2026-11-23T01:02:03.456Z', files: [], views: [] };

function fakeHttp(result: Result<unknown, HttpError>) {
  const calls = { get: vi.fn(async () => result), post: vi.fn(async () => result), put: vi.fn(async () => result), delete: vi.fn(async () => result) };

  return { calls, client: createDrawingSetClient(calls as unknown as HttpClient) };
}

describe('drawingSetClient — đề xuất ngôi nhà', () => {
  it('GET …/drawing-sets/{setId}/building, giải bằng schema chặt', async () => {
    const { calls, client } = fakeHttp({ ok: true, data: { enabled: false } });

    expect(await client.readBuilding({ projectId: 'p1', setId: 's1' })).toEqual({ ok: true, data: { enabled: false } });
    expect(calls.get).toHaveBeenCalledWith(ENDPOINTS.drawingSets.building('p1', 's1'), {});
    expect(ENDPOINTS.drawingSets.building('p1', 's1')).toMatch(/\/projects\/p1\/drawing-sets\/s1\/building$/);
  });

  it('phản hồi sai hình là lỗi giải mã; lỗi dây đi nguyên', async () => {
    const malformed = await fakeHttp({ ok: true, data: { enabled: true, proposal: {} } }).client.readBuilding({ projectId: 'p1', setId: 's1' });
    const error: HttpError = { code: 'NOT_FOUND', kind: 'http', raw: { code: 'NOT_FOUND' }, requestId: 'r', retryable: false, status: 404 };
    const missing = await fakeHttp({ ok: false, error }).client.readBuilding({ projectId: 'p1', setId: 's1' });

    expect(malformed.ok).toBe(false);
    expect(missing).toEqual({ ok: false, error });
  });

  it('N59 chỉ gửi `building` khi người gọi đưa vào', async () => {
    const { calls, client } = fakeHttp({ ok: true, data: SET });

    await client.replaceViews({ projectId: 'p1', setId: 's1', baseVersion: 1, views: [] });
    expect(calls.put).toHaveBeenLastCalledWith(ENDPOINTS.drawingSets.views('p1', 's1'), { body: { baseVersion: 1, body: { views: [] } } });
    await client.replaceViews({ projectId: 'p1', setId: 's1', baseVersion: 1, views: [], building: EMPTY });
    expect(calls.put).toHaveBeenLastCalledWith(ENDPOINTS.drawingSets.views('p1', 's1'), {
      body: { baseVersion: 1, body: { views: [], building: EMPTY } },
    });
  });
});

describe('mock — quyết định của người duyệt', () => {
  beforeEach(() => {
    __resetMockDrawingSets();
  });

  /** Bộ sáu trang đã tới `review`, ba mặt bằng đã gán ba tầng mới (bản duyệt `revision` 1). */
  async function reviewed(api = createMockDrawingSetClient()) {
    const created = await api.createSet({ projectId: 'p1', body: { files: [{ fileName: 'bo-6-trang.pdf', mimeType: 'application/pdf', sizeBytes: 100 }] } });

    if (!created.ok) throw new Error('mock không tạo được bộ');
    const setId = created.data.id;

    await api.sendChunk({ projectId: 'p1', setId, fileId: created.data.files[0]?.id ?? '', chunk: 'QQ==', chunkIndex: 0 });
    await api.complete({ projectId: 'p1', setId });
    const analyzing = await api.readBuilding({ projectId: 'p1', setId });

    await api.read({ projectId: 'p1', setId });
    const review = await api.read({ projectId: 'p1', setId });

    if (!review.ok) throw new Error('mock không tới được review');
    const plans = review.data.views.filter((view) => view.kind === 'plan');
    const edits: ViewEdit[] = plans.map((view, index) => ({
      id: view.id,
      fileId: view.fileId,
      pageIndex: view.pageIndex,
      crop: view.crop,
      excluded: false,
      kind: 'plan',
      target: { mode: 'newFloor', floorId: `L-${String(index)}`, name: `Tầng ${String(index + 1)}` },
    }));

    return { api, setId, edits, plans, analyzing };
  }

  it('bộ chưa đọc xong chưa có đề xuất; tới review thì có tầng, một mái trên tầng cao nhất, hai cảnh báo', async () => {
    const { api, setId, plans, analyzing } = await reviewed();
    const building = await api.readBuilding({ projectId: 'p1', setId });

    expect(analyzing).toEqual({ ok: true, data: { enabled: true } });
    expect(building.ok).toBe(true);
    if (!building.ok) return;
    expect(SetBuildingSchema.safeParse(building.data).success).toBe(true);
    expect(building.data.decisions).toBeUndefined();
    expect(building.data.proposal?.levels.map((level) => level.levelRef)).toEqual(plans.map((view) => view.id));
    expect(building.data.proposal?.roofs.map((roof) => roof.levelRef)).toEqual([plans.at(-1)?.id]);
    expect(building.data.proposal?.violations.filter((hit) => hit.level === 'warning').map((hit) => hit.code)).toEqual(['T-07', 'T-07']);
  });

  it('lưu quyết định → đọc lại đúng và áp vào đề xuất; số đã nhập thì hết cảnh báo của trường đó', async () => {
    const { api, setId, edits, plans } = await reviewed();
    const top = plans.at(-1)?.id ?? '';
    const building: BuildingDecisions = { ...EMPTY, levels: [{ levelRef: top, heightMm: 3000 }], roofs: [{ levelRef: top, skip: false, form: 'hip' }] };
    const saved = await api.replaceViews({ projectId: 'p1', setId, baseVersion: 0, views: edits, building });
    const read = await api.readBuilding({ projectId: 'p1', setId });

    expect(saved.ok && saved.data.revision).toBe(1);
    expect(read.ok && read.data.decisions).toEqual(building);
    if (!read.ok) return;
    expect(read.data.proposal?.levels.at(-1)?.heightMm).toEqual({ value: 3000, confidence: 1, source: 'reviewer', viewIds: [top] });
    expect(read.data.proposal?.roofs[0]?.form.source).toBe('reviewer');
    expect(read.data.proposal?.violations.filter((hit) => hit.level === 'warning')).toEqual([]);
  });

  it('có quyết định mà còn cảnh báo chưa xem → N60 trả 422 `building.warnings`; xem hết thì xác nhận được', async () => {
    const { api, setId, edits } = await reviewed();

    await api.replaceViews({ projectId: 'p1', setId, baseVersion: 0, views: edits, building: EMPTY });
    const blocked = await api.confirm({ projectId: 'p1', setId, revision: 1 });

    expect(blocked.ok).toBe(false);
    expect(!blocked.ok && (blocked.error as HttpError).raw).toEqual({ code: 'VALIDATION', field: 'building.warnings' });
    const building = await api.readBuilding({ projectId: 'p1', setId });
    const seen = building.ok ? (building.data.proposal?.violations ?? []).filter((hit) => hit.level === 'warning').map((hit) => hit.key) : [];

    await api.replaceViews({ projectId: 'p1', setId, baseVersion: 1, views: edits, building: { ...EMPTY, seen } });
    const confirmed = await api.confirm({ projectId: 'p1', setId, revision: 2 });

    expect(confirmed.ok && confirmed.data.status).toBe('confirmed');
    const after = await api.readBuilding({ projectId: 'p1', setId });

    expect(after.ok && after.data.decisions?.seen).toEqual(seen);
    expect(after.ok && after.data.proposal?.levels.length).toBe(3);
    await api.remove({ projectId: 'p1', setId });
    const removed = await api.readBuilding({ projectId: 'p1', setId });

    expect(!removed.ok && (removed.error as HttpError).status).toBe(404);
  });

  it('bộ chưa từng gửi quyết định xác nhận như cũ; thân không có `building` giữ quyết định đã lưu', async () => {
    const legacy = await reviewed();

    await legacy.api.replaceViews({ projectId: 'p1', setId: legacy.setId, baseVersion: 0, views: legacy.edits });
    expect((await legacy.api.confirm({ projectId: 'p1', setId: legacy.setId, revision: 1 })).ok).toBe(true);

    const kept = await reviewed();

    await kept.api.replaceViews({ projectId: 'p1', setId: kept.setId, baseVersion: 0, views: kept.edits, building: { ...EMPTY, seen: ['x'] } });
    await kept.api.replaceViews({ projectId: 'p1', setId: kept.setId, baseVersion: 1, views: kept.edits });
    const read = await kept.api.readBuilding({ projectId: 'p1', setId: kept.setId });

    expect(read.ok && read.data.decisions?.seen).toEqual(['x']);
    await kept.api.replaceViews({ projectId: 'p1', setId: kept.setId, baseVersion: 2, views: kept.edits, building: EMPTY });
    const cleared = await kept.api.readBuilding({ projectId: 'p1', setId: kept.setId });

    expect(cleared.ok && cleared.data.decisions).toEqual(EMPTY);
  });

  it('công tắc tắt → `enabled: false`; bộ không có → 404', async () => {
    const { setId } = await reviewed();
    const off = await createMockDrawingSetClient({ enabled: false }).readBuilding({ projectId: 'p1', setId });
    const missing = await createMockDrawingSetClient().readBuilding({ projectId: 'p1', setId: 'khong-co' });

    expect(off).toEqual({ ok: true, data: { enabled: false } });
    expect(!missing.ok && (missing.error as HttpError).status).toBe(404);
  });
});
