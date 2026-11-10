/**
 * Ngang hàng các đường dựng cảnh 3D: cùng một đồ thị đi qua mọi điểm vào (`standardSceneOf`, kiểu bridge có `repairs`
 * truyền sẵn, lịch sử phiên bản, trình xem di động) phải cho cùng đồ nội thất và cùng danh sách sửa cảnh.
 * Đường nào gọi thẳng `toPascalScene` (bỏ `orient/fit/door/tone`) sẽ làm test này đỏ.
 */

import { describe, expect, it, vi } from 'vitest';

import { SpatialGraphDocumentSchema } from '@/api/schemas/spatialGraph';
import type { SpatialGraph } from '@/domain/spatial/types';
import { normalizeSpatial } from '@/domain/spatial/normalize';

import { fixtureF1, fixtureF4 } from '../__fixtures__';
import { createRepairSession, sessionRepairs } from '../sceneRepair';
import { standardSceneOf } from '../sceneStandard';
import { toPascalScene } from '../toPascal';
import type { PascalScene } from '../types';

let mobileScene: PascalScene | null = null;
vi.mock('@/screens/viewer/PascalViewer/usePascalViewer', () => ({
  defaultLoadMount: () =>
    Promise.resolve({
      mount: (_el: unknown, o: { scene: PascalScene }) => {
        mobileScene = o.scene;
        return { dispose: () => undefined };
      },
    }),
}));

const graphOf = (doc: unknown): SpatialGraph => SpatialGraphDocumentSchema.parse(doc).graph as unknown as SpatialGraph;

/** Mọi node đồ (`item`) theo id: vị trí, xoay, kích thước, vật liệu/tông — thứ luật lớp cảnh đổi. */
const itemsOf = (scene: PascalScene): string =>
  JSON.stringify(
    Object.values(scene.nodes)
      .filter((n) => (n as { type: string }).type === 'item')
      .sort((a, b) => (a.id < b.id ? -1 : 1)),
  );

const mobileOf = async (graph: SpatialGraph): Promise<PascalScene> => {
  mobileScene = null;
  const { mountMobileViewerPascal } = await import('@/screens/system/MobileViewer/mobileViewerPascal');
  const noop = () => undefined;
  mountMobileViewerPascal({} as HTMLElement, {
    graph,
    measure: false,
    onPick: noop,
    onMeasure: noop,
    onReady: noop,
    onFailure: noop,
  } as never);
  await vi.waitFor(() => expect(mobileScene).not.toBeNull());

  return mobileScene as unknown as PascalScene;
};

describe.each([
  ['F4 (đồ AI lộn xộn)', () => graphOf(fixtureF4().doc), true],
  ['F1 (căn hộ, đồ người dùng + đồ sinh)', () => graphOf(fixtureF1({ ext: false }).doc), false],
])('đường dựng cảnh ngang hàng — %s', (_name, make, rulesBite) => {
  const graph = make();
  const standard = standardSceneOf(graph);

  it.runIf(rulesBite)('luật có tác dụng: cảnh chuẩn khác cảnh thô (toPascalScene) và khác `raw`', () => {
    const raw = standardSceneOf(graph, { raw: true });
    expect(raw.repairs).toEqual([]);
    expect(itemsOf(standard.scene)).not.toBe(itemsOf(raw.scene));
    expect(itemsOf(standard.scene)).not.toBe(itemsOf(toPascalScene(graph, { furnish: 'on' }).scene));
  });

  it('kiểu bridge (repairs truyền sẵn từ sessionRepairs) = cảnh chuẩn', () => {
    const { graph: repaired, repairs } = sessionRepairs(createRepairSession(), graph);
    const viaBridge = standardSceneOf(repaired, { raw: false, repairs: new Map(repairs.map((r) => [r.furnitureId, r])) });
    expect(itemsOf(viaBridge.scene)).toBe(itemsOf(standard.scene));
    expect(viaBridge.repairs).toEqual(standard.repairs);
  });

  it('lịch sử phiên bản (convertScene) = cảnh chuẩn', async () => {
    const { convertScene } = await import('@/screens/export/VersionHistory/versionHistoryScene');
    const { scene } = convertScene(normalizeSpatial(graph));
    expect(scene).not.toBeNull();
    expect(itemsOf(scene as PascalScene)).toBe(itemsOf(standard.scene));
  });

  it('trình xem di động = cảnh chuẩn', async () => {
    expect(itemsOf(await mobileOf(graph))).toBe(itemsOf(standard.scene));
  });
});

describe('raw: true tắt cả bốn luật', () => {
  it('raw = toPascalScene với `rulesOff` đủ bốn, không sửa cảnh', () => {
    const graph = graphOf(fixtureF4().doc);
    const raw = standardSceneOf(graph, { raw: true });
    expect(raw.repairs).toEqual([]);
    expect(raw.layer.repairs).toBe(0);
  });
});
