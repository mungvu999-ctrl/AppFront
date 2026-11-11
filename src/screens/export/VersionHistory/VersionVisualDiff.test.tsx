import { cleanup, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import type { PascalScene } from '@/lib/pascal/types';

import type { VisualDiffModel } from './types';
import { VersionVisualDiff } from './VersionVisualDiff';

const loadMount = vi.hoisted(() => vi.fn());

vi.mock('@/screens/viewer/PascalViewer/usePascalViewer', () => ({ defaultLoadMount: loadMount }));

const SCENE = {
  nodes: { wall_wall1: { id: 'wall_wall1' }, wall_wall2: { id: 'wall_wall2' } },
  rootNodeIds: ['wall_wall1'],
} as unknown as PascalScene;

const visual = (patch: Partial<VisualDiffModel> = {}): VisualDiffModel => ({
  isAvailable: true,
  unavailableReason: null,
  isBuilding: false,
  caption: 'Đây là mô hình hiện tại',
  scene: SCENE,
  changedEntityIds: ['wall1'],
  hoveredEntityId: null,
  ...patch,
});

afterEach(() => {
  cleanup();
  loadMount.mockReset();
});

describe('VersionVisualDiff trên Pascal', () => {
  it('dựng khung xem chỉ-xem và tô sáng đúng node đã đổi khi cảnh sẵn sàng', async () => {
    const setHighlight = vi.fn();
    const mount = vi.fn(() => ({ dispose: vi.fn(), setHighlight }));
    loadMount.mockResolvedValue({ mount });

    render(<VersionVisualDiff visual={visual({ hoveredEntityId: 'wall2' })} />);

    await waitFor(() => expect(mount).toHaveBeenCalledTimes(1));
    const options = (mount.mock.calls[0] as unknown as [HTMLElement, Record<string, unknown>])[1];
    expect(options).toMatchObject({ scene: SCENE, mode: 'view', readOnly: true, fit: 'scene', cameraControls: true });

    (options.onReadyChange as (ready: boolean) => void)(true);
    expect(setHighlight).toHaveBeenLastCalledWith(['wall_wall1', 'wall_wall2']);
    expect(screen.getByText('Đây là mô hình hiện tại')).toBeTruthy();
  });

  it('nói ra một câu bình thường khi máy không dựng được 3D', async () => {
    loadMount.mockRejectedValue(new Error('PASCAL-01'));

    render(<VersionVisualDiff visual={visual()} />);

    expect(await screen.findByText('Máy này không dựng được 3D')).toBeTruthy();
  });

  it('dựng lại khi cặp phiên bản đổi cảnh, và dispose cảnh cũ', async () => {
    const dispose = vi.fn();
    const mount = vi.fn(() => ({ dispose, setHighlight: vi.fn() }));
    loadMount.mockResolvedValue({ mount });
    const other = { nodes: {}, rootNodeIds: ['x'] } as unknown as PascalScene;

    const { rerender } = render(<VersionVisualDiff visual={visual()} />);
    await waitFor(() => expect(mount).toHaveBeenCalledTimes(1));

    rerender(<VersionVisualDiff visual={visual({ scene: other })} />);

    await waitFor(() => expect(mount).toHaveBeenCalledTimes(2));
    expect(dispose).toHaveBeenCalledTimes(1);
    expect((mount.mock.calls[1] as unknown as [HTMLElement, Record<string, unknown>])[1]).toMatchObject({ scene: other });
  });
});

describe('câu hướng dẫn của khối 3D', () => {
  it('nói thật: chỉ tô được đối tượng có trong bản đang dựng, phần còn lại xem ở mặt bằng 2D', async () => {
    loadMount.mockResolvedValue({ mount: vi.fn(() => ({ dispose: vi.fn() })) });

    render(<VersionVisualDiff visual={visual()} />);

    expect(await screen.findByText(/Khối 3D dựng một bản \(nêu ở câu trên\), nên chỉ tô được đối tượng có trong bản ấy/)).toBeTruthy();
    expect(screen.getByText(/Phần còn lại xem ở mặt bằng 2D/)).toBeTruthy();
    expect(screen.queryByText(/phần đã thêm, xoá hoặc sửa được tô sáng/)).toBeNull();
  });
});

describe('câu báo dự phòng thư viện', () => {
  it('hiện câu báo khi cảnh dựng bằng mẫu dự phòng', () => {
    loadMount.mockReturnValue(new Promise(() => undefined));
    render(<VersionVisualDiff visual={visual({ libraryNotice: 'Chưa tải được thư viện nội thất' })} />);
    expect(screen.getByText('Chưa tải được thư viện nội thất')).toBeTruthy();
  });
});

describe('tô sáng khi MỌI tường đều đổi (vòng 11, làn a3: viền chọn xuyên tường ngoài)', () => {
  const WALLS = {
    nodes: {
      wall_wall1: { id: 'wall_wall1', type: 'wall' },
      wall_wall2: { id: 'wall_wall2', type: 'wall' },
      door_door1: { id: 'door_door1', type: 'door' },
    },
    rootNodeIds: ['wall_wall1'],
  } as unknown as PascalScene;

  const highlightOf = async (patch: Partial<VisualDiffModel>): Promise<unknown> => {
    const setHighlight = vi.fn();
    const mount = vi.fn(() => ({ dispose: vi.fn(), setHighlight }));
    loadMount.mockResolvedValue({ mount });
    render(<VersionVisualDiff visual={visual({ scene: WALLS, ...patch })} />);
    await waitFor(() => expect(mount).toHaveBeenCalledTimes(1));
    ((mount.mock.calls[0] as unknown as [HTMLElement, { onReadyChange: (r: boolean) => void }])[1]).onReadyChange(true);
    return setHighlight.mock.lastCall?.[0];
  };

  it('mọi tường trong tập đổi → không tô cả tập', async () => {
    expect(await highlightOf({ changedEntityIds: ['wall1', 'wall2', 'door1'] })).toEqual([]);
  });

  it('mọi tường đổi + đang trỏ một hàng → chỉ tô hàng ấy', async () => {
    expect(await highlightOf({ changedEntityIds: ['wall1', 'wall2'], hoveredEntityId: 'wall2' })).toEqual(['wall_wall2']);
  });

  it('chỉ một phần tường đổi → tô như cũ', async () => {
    expect(await highlightOf({ changedEntityIds: ['wall1', 'door1'] })).toEqual(['wall_wall1', 'door_door1']);
  });
});
