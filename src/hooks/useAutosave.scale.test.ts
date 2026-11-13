import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { __resetMockLayerState, createMockApiClient } from '@/api/__mocks__/client';
import type { SpatialApi } from '@/api/client';
import { createSampleBuilding } from '@/domain/spatial/__fixtures__/sampleBuilding';
import { normalizeSpatial } from '@/domain/spatial/normalize';
import type { Level, LevelId, Wall, WallId } from '@/domain/spatial/types';
import { millimetresPerPixel } from '@/domain/units/scale';
import { RETRY_SCHEDULE_MS } from '@/lib/autosave/retrySchedule';
import { spatialLayerOf } from '@/lib/autosave/spatialLayerSave';
import { setAuthenticatedSession } from '@/lib/auth/state';
import type { HttpError } from '@/lib/http/types';
import { queryClient } from '@/lib/query/queryClient';
import { queryKeys } from '@/lib/query/queryKeys';
import { useStore } from '@/store';
import { commit } from '@/store/commit';

import { __resetFloorLayerSavers, flushAutosaves, useFloorLayerAutosave } from './useAutosave';

const PROJECT = 'project-1';
const SAMPLE = normalizeSpatial(createSampleBuilding());
const FLOOR = SAMPLE.byKind.level[0] as string;
const LAYER = spatialLayerOf(SAMPLE, FLOOR as LevelId);

type WriteResult = Awaited<ReturnType<SpatialApi['writeLayer']>>;

const saved = (revision: number): WriteResult => ({ data: { layer: LAYER, revision }, ok: true });

const tick = async (ms = 0): Promise<void> => {
  await act(async () => {
    await vi.dynamicImportSettled();
    await vi.advanceTimersByTimeAsync(ms);
  });
};

const editFloor = (): void => {
  const spatial = useStore.getState().spatial;
  const wall = Object.values(spatial?.byId ?? {}).find(
    (entity): entity is Wall =>
      spatial?.byKind.wall.includes(entity.id as WallId) === true && 'levelId' in entity && entity.levelId === FLOOR,
  ) as Wall;

  act(() => {
    commit({ changes: { thicknessMm: wall.thicknessMm + 10 }, id: wall.id, kind: 'wall', op: 'update' }, 'Đổi độ dày');
  });
};

const mount = () => {
  const client = createMockApiClient();
  const writeLayer = vi.spyOn(client.spatial, 'writeLayer').mockResolvedValue(saved(5));
  const readLayer = vi.spyOn(client.spatial, 'readLayer');
  const hook = renderHook(() => useFloorLayerAutosave({ apiClient: client, floorId: FLOOR, projectId: PROJECT }));

  return { hook, readLayer, writeLayer };
};

describe('useFloorLayerAutosave — saveScale (F-04x-2 bước 5)', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    __resetFloorLayerSavers();
    __resetMockLayerState();
    setAuthenticatedSession({ accessToken: 't', expiresAt: Date.now() + 3_600_000, roles: [], user: { id: 'u' } });
    useStore.getState().setSpatial(SAMPLE, 'v-1', {
      floorRevisions: Object.fromEntries(SAMPLE.byKind.level.map((id) => [id, 0])),
      projectId: PROJECT,
    });
    useStore.getState().updateFloorMeta(FLOOR, { revision: 0, scaleStatus: 'unresolved' });
  });

  afterEach(() => {
    __resetFloorLayerSavers();
    useStore.getState().setSpatial(null, null);
    vi.restoreAllMocks();
    vi.useRealTimers();
  });

  it('tầng sạch: một PUT chỉ tỉ lệ, base = hint; kho gỡ scaleStatus, vô hiệu khoá tỉ lệ', async () => {
    const { hook, writeLayer } = mount();
    const invalidate = vi.spyOn(queryClient, 'invalidateQueries');

    await tick();
    await act(async () => {
      await hook.result.current.saveScale(FLOOR, 12, 'measured', 4);
    });

    expect(writeLayer).toHaveBeenCalledTimes(1);
    expect(writeLayer.mock.calls[0]?.[0]).toMatchObject({ baseVersion: 4, body: { scaleMillimetresPerPixel: 12 } });
    expect(writeLayer.mock.calls[0]?.[0].body.layer).toBeUndefined();
    expect(useStore.getState().floorMeta[FLOOR]).toEqual({ revision: 5 });
    expect(invalidate).toHaveBeenCalledWith(expect.objectContaining({ queryKey: queryKeys.layer.graph(PROJECT) }));
  });

  it('tầng bẩn: MỘT PUT lớp + tỉ lệ, base của lớp (bỏ hint); xả sau không gửi thêm', async () => {
    const { hook, writeLayer } = mount();

    await tick();
    editFloor();
    await act(async () => {
      await hook.result.current.saveScale(FLOOR, 12, 'measured', 9);
    });
    await act(async () => {
      await flushAutosaves();
    });

    expect(writeLayer).toHaveBeenCalledTimes(1);
    expect(writeLayer.mock.calls[0]?.[0]).toMatchObject({ baseVersion: 0, body: { scaleMillimetresPerPixel: 12 } });
    expect(writeLayer.mock.calls[0]?.[0].body.layer).toBeDefined();
  });

  it('lớp + tỉ lệ hỏng tạm → tầng bẩn lại, engine báo dirty và gửi lại một PUT lớp (review-1 P2-3)', async () => {
    const { hook, writeLayer } = mount();
    const down: HttpError = { code: 'UNAVAILABLE', kind: 'http', raw: {}, requestId: 'r', retryable: true, status: 503 };

    let fail: () => void = () => undefined;

    writeLayer.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          fail = () => resolve({ error: down, ok: false });
        }),
    );
    await tick();
    editFloor();
    const scaling = hook.result.current.saveScale(FLOOR, 12, 'measured').catch(() => undefined);

    // Engine xả lượt 800 ms của nó trong lúc PUT lớp + tỉ lệ đang bay: không còn gì để gửi → `saved`.
    await tick(800);
    fail();
    await act(async () => {
      await scaling;
    });

    expect(writeLayer).toHaveBeenCalledTimes(1);
    expect(useStore.getState().unsavedFloorIds).toContain(FLOOR);
    // Engine không còn ở `saved` (nhãn "Đã lưu lúc …" cố định suốt `dirty` là thiết kế chung của `useEngineLabel`).
    expect(hook.result.current.autosave.getState()).toBe('dirty');

    await tick(800);
    await tick(RETRY_SCHEDULE_MS[0]);

    expect(writeLayer).toHaveBeenCalledTimes(2);
    expect(writeLayer.mock.calls[1]?.[0].body.layer).toBeDefined();
    expect(writeLayer.mock.calls[1]?.[0].body.scaleMillimetresPerPixel).toBeUndefined();
  });

  it('tầng bị khối: isFloorBlocked, saveScale ném lỗi đang giữ, không PUT', async () => {
    const { hook, writeLayer } = mount();
    const forbidden: HttpError = { code: 'FORBIDDEN', kind: 'http', raw: { code: 'FORBIDDEN' }, requestId: 'r', retryable: false, status: 403 };

    writeLayer.mockResolvedValueOnce({ error: forbidden, ok: false });
    await tick();
    editFloor();
    await act(async () => {
      await flushAutosaves().catch(() => undefined);
    });

    expect(hook.result.current.isFloorBlocked(FLOOR)).toBe(true);
    await expect(hook.result.current.saveScale(FLOOR, 12, 'measured')).rejects.toBe(forbidden);
    expect(writeLayer).toHaveBeenCalledTimes(1);
  });

  it('lượt lưu lớp có sửa chen (redirtied) giữ scaleStatus của tầng', async () => {
    const { writeLayer } = mount();
    let release: () => void = () => undefined;

    writeLayer.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          release = () => resolve(saved(5));
        }),
    );
    await tick();
    editFloor();
    const flushing = flushAutosaves();

    await tick();
    editFloor();
    release();
    await act(async () => {
      await flushing;
    });

    expect(useStore.getState().floorMeta[FLOOR]).toEqual({ revision: 5, scaleStatus: 'unresolved' });
  });

  it('reloadFloor ghi scaleStatus từ N16', async () => {
    const { hook, readLayer } = mount();
    const document = await createMockApiClient().spatial.readLayer({ floorId: FLOOR, projectId: PROJECT });

    if (!document.ok) {
      throw new Error('mock N16 hỏng');
    }

    readLayer.mockResolvedValueOnce({ data: { ...document.data, revision: 6, scaleStatus: 'unresolved' }, ok: true });
    useStore.getState().updateFloorMeta(FLOOR, { revision: 0 });
    await tick();
    await act(async () => {
      await hook.result.current.reloadFloor(FLOOR);
    });

    expect(useStore.getState().floorMeta[FLOOR]).toEqual({ revision: 6, scaleStatus: 'unresolved' });
  });

  it('reloadFloor revision lớn hơn → Level mới cùng lớp (review-1 P2-2)', async () => {
    const { hook, readLayer } = mount();
    const document = await createMockApiClient().spatial.readLayer({ floorId: FLOOR, projectId: PROJECT });

    if (!document.ok) {
      throw new Error('mock N16 hỏng');
    }

    const level: Level = { ...(SAMPLE.byId[FLOOR] as Level), scaleMillimetresPerPixel: millimetresPerPixel(7) };

    readLayer.mockResolvedValueOnce({ data: { ...document.data, layer: LAYER, level, revision: 6 }, ok: true });
    await tick();
    await act(async () => {
      await hook.result.current.reloadFloor(FLOOR);
    });

    expect(useStore.getState().spatial?.byId[FLOOR]).toEqual(level);
  });

  it('NO-374: reloadFloor thay kích thước của tầng bằng kích thước N16', async () => {
    const { hook, readLayer } = mount();
    const document = await createMockApiClient().spatial.readLayer({ floorId: FLOOR, projectId: PROJECT });

    if (!document.ok) {
      throw new Error('mock N16 hỏng');
    }

    const onFloor = (): string[] => {
      const spatial = useStore.getState().spatial;

      return (spatial?.byLevel[FLOOR] ?? []).filter((id) => spatial?.byKind.dimension.includes(id));
    };

    expect(onFloor().length).toBeGreaterThan(0);
    readLayer.mockResolvedValueOnce({ data: { ...document.data, dimensions: [], revision: 6 }, ok: true });
    await tick();
    await act(async () => {
      await hook.result.current.reloadFloor(FLOOR);
    });

    expect(onFloor()).toEqual([]);
  });

  it('reloadFloor: N16 vắng scaleStatus gỡ tỷ lệ tạm của tầng', async () => {
    const { hook, readLayer } = mount();
    const document = await createMockApiClient().spatial.readLayer({ floorId: FLOOR, projectId: PROJECT });

    if (!document.ok) {
      throw new Error('mock N16 hỏng');
    }

    const { axes, dimensions, layer, level } = document.data;

    readLayer.mockResolvedValueOnce({ data: { axes, dimensions, layer, level, revision: 6 }, ok: true });
    await tick();
    await act(async () => {
      await hook.result.current.reloadFloor(FLOOR);
    });

    expect(useStore.getState().floorMeta[FLOOR]).toEqual({ revision: 6 });
  });
});
