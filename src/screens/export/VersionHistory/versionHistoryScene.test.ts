import { describe, expect, it } from 'vitest';

import { createSampleBuilding } from '@/domain/spatial/__fixtures__/sampleBuilding';
import { normalizeSpatial } from '@/domain/spatial/normalize';
import type { VersionDiff } from '@/lib/versioning/diff';

import { buildVisualModel, convertScene, graphOfVersion, isEmptySource, OLD_VERSION_FURNISH_NOTE, versionSceneOptions } from './versionHistoryScene';

const current = normalizeSpatial(createSampleBuilding());
const wall = current.byKind.wall[0] as string;
const walls = [current.byId[wall]] as never;
const source = { dimensions: [], layer: { furniture: [], openings: [], rooms: [], walls } } as never;

describe('cảnh của phiên bản cũ', () => {
  it('dựng đồ thị từ lớp của bản cũ, không phải mô hình hiện tại', () => {
    const old = graphOfVersion(current, source);

    expect(old?.byKind.wall).toEqual([wall]);
    expect(old?.byKind.room).toHaveLength(0);
    expect(graphOfVersion(null, source)).toBeNull();
  });

  it('caption nêu đích danh phiên bản cũ khi cảnh là của nó', () => {
    const graph = graphOfVersion(current, source);
    const model = buildVisualModel({
      capabilities: { canShowCurrentModel3d: true, canHighlightEntity: true } as never,
      graph,
      scene: convertScene(graph),
      diff: null,
      leftVersionLabel: 'v3',
      hoveredEntityId: null,
      isFetchingDiff: false,
      isOldVersion: true,
    });

    expect(model.caption).toBe('Đây là phiên bản v3; 0 đối tượng đã đổi đang được tô sáng');
  });
});

describe('V1a: bản gốc trống', () => {
  it('nhận ra bản không có đối tượng nào, và caption nói cảnh là bản đối chiếu', () => {
    const empty = { dimensions: [], layer: { furniture: [], openings: [], rooms: [], walls: [] } } as never;

    expect(isEmptySource(empty)).toBe(true);
    expect(isEmptySource(source)).toBe(false);

    const graph = graphOfVersion(current, source);
    const model = buildVisualModel({
      capabilities: { canShowCurrentModel3d: true, canHighlightEntity: true } as never,
      graph,
      scene: convertScene(graph),
      diff: null,
      leftVersionLabel: 'v2',
      hoveredEntityId: null,
      isFetchingDiff: false,
      isOldVersion: true,
      isTargetVersion: true,
    });

    expect(model.caption).toBe(
      'Đây là phiên bản v2 (bản đối chiếu, vì bản gốc chưa có đối tượng nào); 0 đối tượng đã đổi đang được tô sáng',
    );
  });
});

describe('tô sáng trên cảnh bản gốc', () => {
  const graph = graphOfVersion(current, source);
  const modelOf = (diff: VersionDiff, hoveredEntityId: string | null = null) =>
    buildVisualModel({
      capabilities: { canShowCurrentModel3d: true, canHighlightEntity: true } as never,
      graph,
      scene: convertScene(graph),
      diff,
      leftVersionLabel: 'v2',
      hoveredEntityId,
      isFetchingDiff: false,
      isOldVersion: true,
    });

  it('tường chỉ bị dời đầu được tô bằng mã tường, không phải mã đầu tường', () => {
    const moved = { entityId: `V-${wall}-start`, entityType: 'vertex', kind: 'changed', field: 'x' } as const;
    const model = modelOf({ added: [], changed: [moved, { ...moved, field: 'y' }], removed: [] }, `V-${wall}-end`);

    expect(model.changedEntityIds).toEqual([wall]);
    expect(model.hoveredEntityId).toBe(wall);
    expect(model.caption).toBe('Đây là phiên bản v2; 1 đối tượng đã đổi đang được tô sáng');
  });

  it('phần thêm không có trong cảnh bản gốc: không tô, nhưng caption đếm và chỉ sang 2D', () => {
    const added = { entityId: 'W-NEW', entityType: 'wall', kind: 'added' } as const;
    const changed = { entityId: wall, entityType: 'wall', kind: 'changed', field: 'thickness_mm' } as const;
    const model = modelOf({ added: [added], changed: [changed], removed: [] });

    expect(model.changedEntityIds).toEqual([wall]);
    expect(model.caption).toBe(
      'Đây là phiên bản v2; 1 đối tượng đã đổi đang được tô sáng; 1 đối tượng không có trong bản này nên không tô được, xem ở mặt bằng 2D',
    );
  });
});

describe('thư viện mẫu chung (ensureSceneLibrary)', () => {
  const base = {
    capabilities: { canShowCurrentModel3d: true, canHighlightEntity: true } as never,
    graph: current,
    diff: null,
    leftVersionLabel: null,
    hoveredEntityId: null,
    isFetchingDiff: false,
  };

  it('thư viện chưa chốt: đang dựng, chưa có cảnh, không báo "hỏng" (không dựng trước bằng danh mục đóng gói)', () => {
    const model = buildVisualModel({ ...base, scene: { scene: null, failed: false }, libraryPending: true });
    expect(model).toMatchObject({ isAvailable: true, isBuilding: true, unavailableReason: null, scene: null });
  });

  it('dự phòng vì đọc hỏng: câu báo đi theo mô hình view', () => {
    const model = buildVisualModel({ ...base, scene: convertScene(current), libraryNotice: 'báo' });
    expect(model.libraryNotice).toBe('báo');
    expect(buildVisualModel({ ...base, scene: convertScene(current) }).libraryNotice).toBeNull();
  });
});

describe('bản cũ dựng lại chỉ từ dữ liệu của phiên bản (versionSceneOptions)', () => {
  const addition = { levelId: 'L', roomId: 'R-x', kind: 'chair', centre: { x: 0, y: 0 }, widthMm: 450, depthMm: 450, rotationDeg: 0 } as never;
  const done = { style: { id: 'concept-style' } as never, additions: [addition], furnish: 'off', source: 'done', notice: null } as const;
  const withRooms = (rooms: readonly string[]) => ({ ...current, byKind: { ...current.byKind, room: rooms } }) as typeof current;

  it('bản hiện tại: concept như editor (phong cách + đồ AI, không tự bày), không chú thích', () => {
    expect(versionSceneOptions(done, current, current)).toEqual({
      options: { style: done.style, furnish: 'off', additions: [addition] },
      note: null,
    });
  });

  it('bản hiện tại: concept chưa đọc xong → null (chờ), lỗi đọc concept → câu báo đi theo', () => {
    expect(versionSceneOptions(null, current, current)).toBeNull();
    expect(versionSceneOptions({ ...done, notice: 'báo' }, current, current)?.note).toBe('báo');
  });

  it.each([
    ['cùng phòng', () => withRooms(current.byKind.room.slice(0, 1))],
    ['phòng khác id', () => withRooms([...current.byKind.room, 'R-cu-khac-id'])],
  ])('bản cũ (%s): không phong cách/đồ AI hiện hành, không tự bày, có chú thích — kể cả khi concept chưa về', (_n, old) => {
    for (const concept of [done, null]) {
      expect(versionSceneOptions(concept, old(), current)).toEqual({ options: { furnish: 'off' }, note: OLD_VERSION_FURNISH_NOTE });
    }
  });

  it('bản cũ: đồ đã lưu trong ảnh chụp vẫn dựng, không có đồ tự bày', () => {
    const scene = convertScene(current, versionSceneOptions(done, withRooms(['R-cu']), current)?.options);
    const auto = convertScene(current, { furnish: 'on' });
    const items = (c: typeof scene) => Object.values(c.scene?.nodes ?? {}).filter((n) => (n as { type?: string }).type === 'item').length;
    expect(items(scene)).toBeLessThanOrEqual(items(auto));
  });

  it('không có concept, bản hiện tại: tự bày như editor', () => {
    const none = { ...done, style: undefined, additions: [], furnish: 'on', source: 'none' } as const;
    expect(versionSceneOptions(none, current, current)).toEqual({ options: { furnish: 'on' }, note: null });
  });
});
