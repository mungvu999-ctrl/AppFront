/**
 * L7-07 — chip lỗi đặt đồ trên kho thật: một lượt thả (lượt sửa vào kho, rồi bản máy chủ trả về chỉ khác `clearAreaM2` và
 * thứ tự khoá) chạy luật sửa cảnh ĐÚNG MỘT lần, và chip luôn hiện số lỗi của dữ liệu hiện tại (không lặp lỗi "chip hiện
 * số trạng thái cũ" 16/11) — sau lượt thả lẫn Ctrl+Z.
 */
import { act, cleanup, render } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { createSampleBuilding } from '@/domain/spatial/__fixtures__/sampleBuilding';
import { normalizeSpatial } from '@/domain/spatial/normalize';
import type { SpatialGraph } from '@/domain/spatial/types';
import { scenePlacementIssues } from '@/lib/pascal/placement';
import { sanitaryPlacementIssues } from '@/lib/pascal/sanitaryRules';
import { createRepairSession, sessionRepairs } from '@/lib/pascal/sceneRepair';
import { useStore } from '@/store';

import { PlacementIssuesChip, PlacementIssuesView } from '../PlacementIssuesChip';
import { sceneRepairStore } from '../sceneRepairStore';

/** Gián điệp quanh mốc `span`: đếm số lần `repairScene` thật sự chạy (`derive:repairScene`). */
const spans = vi.hoisted(() => ({ names: [] as string[] }));
vi.mock('@/lib/perf/span', () => ({
  span: <T,>(name: string, fn: () => T): T => {
    spans.names.push(name);
    return fn();
  },
}));
const repairRuns = (): number => spans.names.filter((name) => name === 'derive:repairScene').length;

const scene = { getState: () => ({ nodes: {}, updateNode: () => undefined }) };

/** Bản máy chủ trả về sau PUT: cùng hình học, `clearAreaM2` tính lại, khoá xếp thứ tự khác (đi qua schema). */
const reversedKeys = <T extends object>(value: T): T => Object.fromEntries(Object.entries(value).reverse()) as T;
const serverEcho = (graph: SpatialGraph, area: number): SpatialGraph => ({
  ...graph,
  walls: graph.walls.map(reversedKeys),
  rooms: graph.rooms.map((room) => reversedKeys({ ...room, clearAreaM2: area as never })),
});

/** Dời một món đồ (thả) — đổi hình học thật. */
const moved = (graph: SpatialGraph, dx: number): SpatialGraph => ({
  ...graph,
  furniture: graph.furniture.map((f, i) =>
    i === 0
      ? {
          ...f,
          centre: { x: f.centre.x + dx, y: f.centre.y },
          boundingBox: { min: { x: f.boundingBox.min.x + dx, y: f.boundingBox.min.y }, max: { x: f.boundingBox.max.x + dx, y: f.boundingBox.max.y } },
        }
      : f,
  ),
});

const setGraph = (graph: SpatialGraph) =>
  act(() => {
    /* eslint-disable-next-line local/no-direct-set -- giả lập lượt ghi kho (lượt sửa / bản máy chủ trả về) */
    useStore.setState({ spatial: normalizeSpatial(graph), spatialLoading: false });
  });

/**
 * Chữ chip mong đợi, tính độc lập bằng phiên sửa cảnh MỚI (ô đệm trống) đã thấy cùng lịch sử (`seen`: món đã đụng thoát
 * luật), trên đúng dữ liệu đang có.
 */
const expectedText = (graph: SpatialGraph, seen: readonly SpatialGraph[] = []): string => {
  const session = createRepairSession();
  for (const earlier of seen) sessionRepairs(session, earlier);
  const fresh = sessionRepairs(session, graph);
  const issues = [...sanitaryPlacementIssues(fresh.graph), ...scenePlacementIssues(fresh.graph)];
  const { container, unmount } = render(
    <PlacementIssuesView issues={issues} onToggleOutline={() => undefined} onToggleRepairs={() => undefined} repairs={fresh.repairs} repairsEnabled unplaced={[]} />,
  );
  const text = container.textContent ?? '';
  unmount();
  return text;
};

describe('PlacementIssuesChip — một lượt thả chạy luật một lần, số lỗi luôn mới (L7-07)', () => {
  beforeEach(() => {
    spans.names = [];
    sceneRepairStore.set({ enabled: true, repairs: [], session: createRepairSession(), layer: null });
  });
  afterEach(() => {
    cleanup();
    /* eslint-disable-next-line local/no-direct-set -- đưa kho về rỗng giữa các bài */
    useStore.setState({ spatial: null });
  });

  it('lượt thả + bản máy chủ trả về: repairScene đúng 1 lần; chip đổi theo dữ liệu mới, cả sau Ctrl+Z', () => {
    const base = createSampleBuilding();
    const far = moved(base, -40_000);
    setGraph(base);
    const { container } = render(<PlacementIssuesChip scene={scene} />);
    const before = container.textContent;
    expect(before).toBe(expectedText(base));

    spans.names = [];
    setGraph(far); // lượt sửa vào kho
    setGraph(serverEcho(far, 7.5)); // bản máy chủ trả về
    expect(repairRuns()).toBe(1);
    expect(container.textContent).toBe(expectedText(far, [base]));
    expect(container.textContent).not.toBe(before);

    spans.names = [];
    setGraph(base); // Ctrl+Z
    setGraph(serverEcho(base, 9.25));
    // Món đã kéo vẫn là "đã đụng" sau Ctrl+Z (như cờ `edited` máy chủ đặt) → số lỗi theo đúng trạng thái ấy.
    expect(repairRuns()).toBe(1);
    expect(container.textContent).toBe(expectedText(base, [base, far]));
  });

  it('hình học đổi thật (dời món) thì vẫn chạy lại luật — ô đệm không nuốt lượt sửa', () => {
    const base = createSampleBuilding();
    setGraph(base);
    render(<PlacementIssuesChip scene={scene} />);
    spans.names = [];
    setGraph(moved(base, 300));
    expect(repairRuns()).toBe(1);
    setGraph(moved(base, 600));
    expect(repairRuns()).toBe(2);
  });
});
