/**
 * Ngang hàng THƯ VIỆN giữa ba viewer: editor (kiểu bridge, `standardSceneOf` sau `sessionRepairs`), lịch sử phiên bản
 * (`convertScene`) và viewer di động (`mountMobileViewerPascal`) dựng trên CÙNG thư viện máy chủ (`ensureSceneLibrary`).
 * Viewer di động cũ dựng ngay khi gói Pascal nạp xong, trước khi thư viện chốt → ra mẫu đóng gói, khác editor (đỏ).
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { DesignResult } from '@/api/schemas/designConcept';
import { SpatialGraphDocumentSchema } from '@/api/schemas/spatialGraph';
import { normalizeSpatial } from '@/domain/spatial/normalize';
import type { SpatialGraph } from '@/domain/spatial/types';

import { fixtureF1 } from '../__fixtures__';
import LIBRARY from '../libraryRoles.json' with { type: 'json' };
import { designAdditionsOf } from '../designStyles';
import { CONCEPT_FALLBACK_NOTICE, conceptSceneOptions, loadSceneConcept, sceneConceptOf } from '../sceneConcept';
import { ensureSceneLibrary, resetSceneLibraryForTests, unresolvedModelIds } from '../sceneLibrary';
import { createRepairSession, sessionRepairs } from '../sceneRepair';
import { standardSceneOf } from '../sceneStandard';
import type { PascalScene } from '../types';

const mounted: PascalScene[] = [];
vi.mock('@/screens/viewer/PascalViewer/usePascalViewer', () => ({
  defaultLoadMount: () =>
    Promise.resolve({
      mount: (_el: unknown, o: { scene: PascalScene }) => {
        mounted.push(o.scene);
        return { dispose: () => undefined };
      },
    }),
}));

let release: (value: unknown) => void = () => undefined;
/** Câu trả N47 của lượt đọc kế tiếp (mặc định: 404 = không có concept). */
let conceptReply: () => Promise<unknown> = async () => ({ ok: false, error: { kind: 'notFound' } });
vi.mock('@/routes/sessionSetup', () => ({ startAppSession: async () => true }));
vi.mock('@/api/appClient', () => ({
  createAppApiClient: () => ({
    library: { list: () => new Promise((resolve) => (release = resolve)) },
    designConcept: { read: () => conceptReply() },
  }),
}));

const graph = SpatialGraphDocumentSchema.parse(fixtureF1({ ext: false }).doc).graph as unknown as SpatialGraph;

/** Mỗi món: id, mẫu đã resolve (asset src), vị trí, xoay, kích thước, vật liệu — thứ phải giống ở mọi viewer. */
const itemsOf = (scene: PascalScene): string =>
  JSON.stringify(
    Object.values(scene.nodes)
      .filter((n) => (n as { type: string }).type === 'item')
      .sort((a, b) => (a.id < b.id ? -1 : 1)),
  );

/** Thư viện giả: mẫu đầu của mọi vai trò (đủ để thay mẫu low-poly cùng loại). */
const fakeLibrary = [...new Set(Object.values(LIBRARY.roles).map((ids) => ids[0]).filter((id): id is string => !!id))].map(
  (id) => ({ id, widthMm: 1600, heightMm: 800, depthMm: 800, modelUrl: `https://minio.test/library/${id}.glb?sig=1` }),
);

const mountMobile = async (extra: object = {}) => {
  const { mountMobileViewerPascal } = await import('@/screens/system/MobileViewer/mobileViewerPascal');
  const noop = () => undefined;
  return mountMobileViewerPascal({} as HTMLElement, { graph, measure: false, onPick: noop, onMeasure: noop, onReady: noop, onFailure: noop, ...extra } as never);
};

/** Concept AI đã xong: phong cách + mẫu AI chọn (một mẫu lạ) + một món bổ sung ở tâm phòng đầu tiên còn chỗ trống. */
const candidates = graph.rooms.flatMap((room) => {
  const xs = room.outline.map((p) => p.x);
  const ys = room.outline.map((p) => p.y);
  const out = [];
  for (let x = Math.min(...xs) + 400; x < Math.max(...xs) - 400; x += 300)
    for (let y = Math.min(...ys) + 400; y < Math.max(...ys) - 400; y += 300)
      out.push({ levelId: room.levelId, roomId: room.id, kind: 'chair' as const, centre: { x, y }, widthMm: 450, depthMm: 450, rotationDeg: 90, modelId: 'khong-co-mau' });
  return out;
});
const addition = candidates.find((a) => designAdditionsOf([a], graph.furniture).length === 1);
const concept: DesignResult = {
  nameVi: 'Japandi cho căn này',
  summaryVi: 'Gỗ sáng.',
  baseStyle: 'toi-gian',
  wall: { interior: 'library:paint-cream' },
  floor: { wood: 'library:wood-oak' },
  models: { sofa: 'sofa', armchair: 'no-such-model' },
  additions: addition === undefined ? [] : [addition],
};
const conceptState = {
  enabled: true,
  active: { id: 'dcn_1', suggested: true, status: 'done', createdAt: '2026-11-10T00:00:00Z', endedAt: '2026-11-10T00:01:00Z', result: concept },
};

beforeEach(() => {
  mounted.length = 0;
  resetSceneLibraryForTests();
  conceptReply = async () => ({ ok: false, error: { kind: 'notFound' } });
});

describe('ba viewer dùng cùng thư viện', () => {
  it('đổi dự án khi thư viện còn chạy: viewer đã tháo không dựng cảnh cũ', async () => {
    const mount = await mountMobile();
    await new Promise((r) => setTimeout(r, 20));
    mount.ok && mount.handle.dispose();
    release({ ok: true, data: [] });
    await ensureSceneLibrary();
    await new Promise((r) => setTimeout(r, 20));
    expect(mounted).toEqual([]);
  });

  it('viewer di động chờ thư viện chốt rồi mới dựng; ba đường cho cùng tập món/mẫu/kích thước/hướng/vật liệu', async () => {
    const bundled = itemsOf(standardSceneOf(graph).scene);
    await mountMobile();
    await new Promise((r) => setTimeout(r, 20));
    expect(mounted).toHaveLength(0); // mã cũ: đã dựng bằng danh mục đóng gói ở đây
    release({ ok: true, data: fakeLibrary });
    const library = await ensureSceneLibrary();
    expect(library).toMatchObject({ source: 'server', notice: null });
    expect(library.version).toMatch(/^lib-\d+-[0-9a-f]{8}$/);
    await vi.waitFor(() => expect(mounted).toHaveLength(1));

    const editor = (() => {
      const { graph: repaired, repairs } = sessionRepairs(createRepairSession(), graph);
      return itemsOf(standardSceneOf(repaired, { raw: false, repairs: new Map(repairs.map((r) => [r.furnitureId, r])) }).scene);
    })();
    const { convertScene } = await import('@/screens/export/VersionHistory/versionHistoryScene');
    const history = itemsOf(convertScene(normalizeSpatial(graph)).scene as PascalScene);
    const mobile = itemsOf(mounted[0] as PascalScene);

    expect(editor).not.toBe(bundled); // thư viện giả có tác dụng: không thì test này không chứng minh gì
    expect(history).toBe(editor);
    expect(mobile).toBe(editor);
  });

  it('cùng dữ liệu + cùng thư viện + cùng concept: ba đường ra cùng món/mẫu/kích thước/hướng/vật liệu, cùng mẫu thiếu', async () => {
    conceptReply = async () => ({ ok: true, data: conceptState });
    const notices: (string | null)[] = [];
    await mountMobile({ projectId: 'p1', onLibraryNotice: (n: string | null) => notices.push(n) });
    await new Promise((r) => setTimeout(r, 20));
    release({ ok: true, data: fakeLibrary });
    await ensureSceneLibrary();
    await vi.waitFor(() => expect(mounted).toHaveLength(1));
    expect(notices).toEqual([null]);

    // Editor: đúng đường bridge — `sceneConceptOf(readConcept)` → `sceneOptions` → `standardSceneOf` sau `sessionRepairs`.
    const loaded = sceneConceptOf({ state: conceptState as never });
    expect(loaded.source).toBe('done');
    const editorOptions = { ...(loaded.style ? { style: loaded.style } : {}), furnish: loaded.furnish, additions: loaded.additions };
    const { graph: repaired, repairs } = sessionRepairs(createRepairSession(), graph);
    const editorScene = standardSceneOf(repaired, { ...editorOptions, raw: false, repairs: new Map(repairs.map((r) => [r.furnitureId, r])) }).scene;
    // Lịch sử phiên bản: đúng hàm hook dùng (`loadSceneConcept` → `conceptSceneOptions` → `convertScene`).
    const { convertScene } = await import('@/screens/export/VersionHistory/versionHistoryScene');
    const historyScene = convertScene(normalizeSpatial(graph), conceptSceneOptions(await loadSceneConcept('p1'))).scene as PascalScene;
    const mobileScene = mounted[0] as PascalScene;

    const editor = itemsOf(editorScene);
    expect(addition).toBeDefined();
    expect(editor).toContain('DRESS-ai-'); // món AI bổ sung có mặt: concept thật sự được áp
    expect(editor).not.toBe(itemsOf(standardSceneOf(graph).scene));
    expect(itemsOf(historyScene)).toBe(editor);
    expect(itemsOf(mobileScene)).toBe(editor);

    const missing = unresolvedModelIds(editorScene, concept);
    expect(missing.map((m) => [m.modelId, m.where, m.substitute])).toEqual([
      ['khong-co-mau', 'addition:0', 'role'],
      ['no-such-model', 'concept:armchair', 'role'],
    ]);
    expect(unresolvedModelIds(historyScene, concept)).toEqual(missing);
    expect(unresolvedModelIds(mobileScene, concept)).toEqual(missing);
  });

  it('mẫu lưu không có trong thư viện: liệt kê, không ném, không đổi dữ liệu lưu', () => {
    const furniture = graph.furniture[0] as SpatialGraph['furniture'][number];
    const saved = { ...graph, furniture: [{ ...furniture, model: { id: 'mat-mau', src: '/items/mat-mau/model.glb' } }, ...graph.furniture.slice(1)] };
    const before = JSON.stringify(saved);
    const scene = standardSceneOf(saved as SpatialGraph).scene;
    expect(unresolvedModelIds(scene)).toEqual([{ modelId: 'mat-mau', where: expect.stringContaining('item'), substitute: 'saved-src' }]);
    expect(JSON.stringify(saved)).toBe(before);
  });

  it('concept 403/404 im lặng, lỗi đọc = dự phòng có câu báo trên di động; tháo trước khi concept về thì không dựng', async () => {
    const lib = ensureSceneLibrary();
    await new Promise((r) => setTimeout(r, 10));
    release({ ok: true, data: [] });
    await lib;
    expect((await loadSceneConcept('p1')).notice).toBeNull();
    conceptReply = async () => ({ ok: false, error: { kind: 'forbidden' } });
    expect(await loadSceneConcept('p1')).toMatchObject({ source: 'none', notice: null, furnish: 'on' });

    conceptReply = async () => ({ ok: false, error: { kind: 'server' } });
    const notices: (string | null)[] = [];
    await mountMobile({ projectId: 'p1', onLibraryNotice: (n: string | null) => notices.push(n) });
    await vi.waitFor(() => expect(mounted).toHaveLength(1));
    expect(notices).toEqual([CONCEPT_FALLBACK_NOTICE]);

    let answer: (v: unknown) => void = () => undefined;
    conceptReply = () => new Promise((r) => (answer = r));
    const late = await mountMobile({ projectId: 'p2' });
    await new Promise((r) => setTimeout(r, 20));
    late.ok && late.handle.dispose();
    answer({ ok: true, data: conceptState });
    await new Promise((r) => setTimeout(r, 20));
    expect(mounted).toHaveLength(1);
  });
});
