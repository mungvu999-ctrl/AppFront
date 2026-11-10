/**
 * Ngang hàng THƯ VIỆN giữa ba viewer: editor (kiểu bridge, `standardSceneOf` sau `sessionRepairs`), lịch sử phiên bản
 * (`convertScene`) và viewer di động (`mountMobileViewerPascal`) dựng trên CÙNG thư viện máy chủ (`ensureSceneLibrary`).
 * Viewer di động cũ dựng ngay khi gói Pascal nạp xong, trước khi thư viện chốt → ra mẫu đóng gói, khác editor (đỏ).
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';

import { SpatialGraphDocumentSchema } from '@/api/schemas/spatialGraph';
import { normalizeSpatial } from '@/domain/spatial/normalize';
import type { SpatialGraph } from '@/domain/spatial/types';

import { fixtureF1 } from '../__fixtures__';
import LIBRARY from '../libraryRoles.json' with { type: 'json' };
import { ensureSceneLibrary, resetSceneLibraryForTests } from '../sceneLibrary';
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
vi.mock('@/routes/sessionSetup', () => ({ startAppSession: async () => true }));
vi.mock('@/api/appClient', () => ({
  createAppApiClient: () => ({ library: { list: () => new Promise((resolve) => (release = resolve)) } }),
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

const mountMobile = async () => {
  const { mountMobileViewerPascal } = await import('@/screens/system/MobileViewer/mobileViewerPascal');
  const noop = () => undefined;
  return mountMobileViewerPascal({} as HTMLElement, { graph, measure: false, onPick: noop, onMeasure: noop, onReady: noop, onFailure: noop } as never);
};

beforeEach(() => {
  mounted.length = 0;
  resetSceneLibraryForTests();
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
});
