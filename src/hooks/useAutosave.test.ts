import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { normalizeSpatial } from '@/domain/spatial/normalize';
import { RETRY_SCHEDULE_MS } from '@/lib/autosave/retrySchedule';
import { CLEAN_BUILDING_SCENARIO } from '@/lib/testing/fixtures';
import type { LevelId, Wall, WallId } from '@/domain/spatial/types';
import { __resetMockLayerState, createMockApiClient, simulateRemoteLayerEdit } from '@/api/__mocks__/client';
import { createSampleBuilding } from '@/domain/spatial/__fixtures__/sampleBuilding';
import { setAuthenticatedSession } from '@/lib/auth/state';
import { LAYER_SAVE_MESSAGES, spatialLayerOf } from '@/lib/autosave/spatialLayerSave';
import { useStore } from '@/store';
import { commit, replaceFloorLayer } from '@/store/commit';

import {
  __resetFloorLayerSavers,
  FLOOR_LAYER_SAVED_CHANNEL,
  flushAutosaves,
  useAutosave,
  useAutosaveFlush,
  useFloorLayerAutosave,
} from './useAutosave';

const setSpatial = (value: ReturnType<typeof normalizeSpatial> | null): void => {
  /* eslint-disable-next-line local/no-direct-set -- dựng cảnh giữa hai lần
     render trong test, không phải một thao tác ghi của người dùng; đúng
     ngoại lệ `SaveIndicator.test.tsx` đã dùng. */
  useStore.setState({ spatial: value });
};

const SAMPLE_SPATIAL = normalizeSpatial(CLEAN_BUILDING_SCENARIO.graph);

describe('useAutosave', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    setSpatial(null);
  });

  afterEach(() => {
    vi.useRealTimers();
    setSpatial(null);
  });

  it('returns null before anything has been saved', () => {
    const onSave = vi.fn().mockResolvedValue(undefined);
    const { result } = renderHook(() => useAutosave(onSave));

    expect(result.current).toBeNull();
    expect(onSave).not.toHaveBeenCalled();
  });

  it('saves 800ms after a store change and formats the label — the one debounce in the repo, not a second one', async () => {
    const onSave = vi.fn().mockResolvedValue(undefined);
    const { result } = renderHook(() => useAutosave(onSave));

    act(() => {
      setSpatial(SAMPLE_SPATIAL);
    });

    await act(async () => {
      await vi.advanceTimersByTimeAsync(799);
    });
    expect(onSave).not.toHaveBeenCalled();

    await act(async () => {
      await vi.advanceTimersByTimeAsync(1);
    });

    expect(onSave).toHaveBeenCalledTimes(1);
    expect(onSave).toHaveBeenCalledWith(SAMPLE_SPATIAL);
    expect(result.current).toMatch(/^Đã lưu lúc \d{2}:\d{2}$/);
  });

  it('retries a failing save on the shared retry schedule before reporting failure, using the exact short string ConnectedSaveIndicator matches', async () => {
    expect(RETRY_SCHEDULE_MS).toEqual([5_000, 15_000, 45_000]);

    const onSave = vi.fn().mockRejectedValue(new Error('network down'));
    const { result } = renderHook(() => useAutosave(onSave));

    act(() => {
      setSpatial(SAMPLE_SPATIAL);
    });

    await act(async () => {
      await vi.advanceTimersByTimeAsync(800);
    });
    expect(onSave).toHaveBeenCalledTimes(1);
    expect(result.current).toBeNull();

    await act(async () => {
      await vi.advanceTimersByTimeAsync(5_000);
    });
    expect(onSave).toHaveBeenCalledTimes(2);

    await act(async () => {
      await vi.advanceTimersByTimeAsync(15_000);
    });
    expect(onSave).toHaveBeenCalledTimes(3);

    await act(async () => {
      await vi.advanceTimersByTimeAsync(45_000);
    });
    expect(onSave).toHaveBeenCalledTimes(4);
    expect(result.current).toBe('Lưu thất bại');
  });

  it('does not fabricate a failure label while offline — stays sticky instead of lying', async () => {
    const originalOnLine = Object.getOwnPropertyDescriptor(window.navigator, 'onLine');
    Object.defineProperty(window.navigator, 'onLine', { configurable: true, value: false });

    try {
      const onSave = vi.fn().mockResolvedValue(undefined);
      const { result } = renderHook(() => useAutosave(onSave));

      act(() => {
        setSpatial(SAMPLE_SPATIAL);
      });

      await act(async () => {
        await vi.advanceTimersByTimeAsync(800);
      });

      expect(onSave).not.toHaveBeenCalled();
      expect(result.current).toBeNull();
    } finally {
      // jsdom defines `onLine` on the `Navigator` prototype, not as the
      // instance's own property, so `originalOnLine` is `undefined` here —
      // restoring would silently no-op and leave `onLine: false` shadowing
      // the prototype for every test that runs afterward. Delete the
      // override we added instead, so the prototype's real value shows
      // through again.
      if (originalOnLine) {
        Object.defineProperty(window.navigator, 'onLine', originalOnLine);
      } else {
        delete (window.navigator as { onLine?: boolean }).onLine;
      }
    }
  });

  it('never calls onSave twice for the same change merely because the component re-rendered', async () => {
    const onSave = vi.fn().mockResolvedValue(undefined);
    const { rerender } = renderHook(() => useAutosave(onSave));

    act(() => {
      setSpatial(SAMPLE_SPATIAL);
    });
    act(() => {
      rerender();
      rerender();
      rerender();
    });

    await act(async () => {
      await vi.advanceTimersByTimeAsync(800);
    });

    expect(onSave).toHaveBeenCalledTimes(1);
  });

  /*
   * B-V12-01 · Q13: cổng nạp kho dự án ghi `spatial` bằng `setSpatial`. Một lượt
   * nạp không phải bản sửa — lưu ngược thứ vừa đọc từ máy chủ là ghi thừa.
   */
  it('does not schedule a save for a load (`setSpatial` empties undo history), but does for a `commit`', async () => {
    const onSave = vi.fn().mockResolvedValue(undefined);
    renderHook(() => useAutosave(onSave));

    act(() => {
      useStore.getState().setSpatial(SAMPLE_SPATIAL, 'v-1');
    });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(800);
    });

    expect(onSave).not.toHaveBeenCalled();

    const wallId = SAMPLE_SPATIAL.byKind.wall[0] as WallId;

    act(() => {
      commit({ changes: { reviewed: true }, id: wallId, kind: 'wall', op: 'update' }, 'Duyệt tường');
    });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(800);
    });

    expect(onSave).toHaveBeenCalledTimes(1);
  });
});

describe('useAutosaveFlush', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    setSpatial(null);
  });

  afterEach(() => {
    vi.useRealTimers();
    setSpatial(null);
  });

  it('is safe to call with nothing pending: resolves without calling onSave', async () => {
    const onSave = vi.fn().mockResolvedValue(undefined);
    const { result } = renderHook(() => useAutosaveFlush(onSave));

    await act(async () => {
      await result.current.flush();
    });

    expect(onSave).not.toHaveBeenCalled();
  });

  it('saves immediately, skipping the rest of the 800ms debounce window', async () => {
    const onSave = vi.fn().mockResolvedValue(undefined);
    const { result } = renderHook(() => useAutosaveFlush(onSave));

    act(() => {
      setSpatial(SAMPLE_SPATIAL);
    });

    await act(async () => {
      await vi.advanceTimersByTimeAsync(10);
    });
    expect(onSave).not.toHaveBeenCalled();

    await act(async () => {
      await result.current.flush();
    });

    expect(onSave).toHaveBeenCalledTimes(1);
    expect(result.current.label).toMatch(/^Đã lưu lúc \d{2}:\d{2}$/);
  });
});

/* -------------------------------------------------------------------------- */
/* useFloorLayerAutosave — sổ saver lớp tầng (F-04x-1 [8].4).                 */
/* -------------------------------------------------------------------------- */

const PROJECT = 'project-1';
const SAMPLE = normalizeSpatial(createSampleBuilding());
const [FLOOR_A, FLOOR_B] = SAMPLE.byKind.level as [string, string];
const REVISIONS = Object.fromEntries(SAMPLE.byKind.level.map((id) => [id, 0]));

const loadSample = (projectId = PROJECT): void => {
  useStore.getState().setSpatial(SAMPLE, 'v-1', { floorRevisions: REVISIONS, projectId });
};

/** Tường đầu tiên trên `floorId` trong kho hiện tại. */
const wallOn = (floorId: string): Wall => {
  const spatial = useStore.getState().spatial;
  const wall = Object.values(spatial?.byId ?? {}).find(
    (entity): entity is Wall => spatial?.byKind.wall.includes(entity.id as WallId) === true && 'levelId' in entity && entity.levelId === floorId,
  );

  if (!wall) {
    throw new Error(`no wall on ${floorId}`);
  }

  return wall;
};

/** Dày thêm 10 mm cho tường đầu tiên trên `floorId` — một bản sửa thật qua `commit`. */
const editFloor = (floorId: string): void => {
  const wall = wallOn(floorId);

  commit({ changes: { thicknessMm: wall.thicknessMm + 10 }, id: wall.id, kind: 'wall', op: 'update' }, 'Đổi độ dày');
};

const signIn = (id: string): void => {
  setAuthenticatedSession({ accessToken: `t-${id}`, expiresAt: Date.now() + 3_600_000, roles: [], user: { id } });
};

const tick = async (ms = 0): Promise<void> => {
  await act(async () => {
    await vi.dynamicImportSettled();
    await vi.advanceTimersByTimeAsync(ms);
  });
};

const spyClient = () => {
  const client = createMockApiClient();
  const writeLayer = vi.spyOn(client.spatial, 'writeLayer');
  const readLayer = vi.spyOn(client.spatial, 'readLayer');

  return { client, readLayer, writeLayer };
};

describe('useFloorLayerAutosave', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    __resetFloorLayerSavers();
    __resetMockLayerState();
    signIn('user-a');
    useStore.getState().setSpatial(null, null);
  });

  afterEach(() => {
    __resetFloorLayerSavers();
    useStore.getState().setSpatial(null, null);
    vi.useRealTimers();
  });

  it('two hooks on one project share one saver: one edit → exactly one PUT, base = revision of the read', async () => {
    const { client, writeLayer } = spyClient();

    loadSample();
    renderHook(() => useFloorLayerAutosave({ apiClient: client, floorId: FLOOR_A, projectId: PROJECT }));
    const second = renderHook(() => useFloorLayerAutosave({ apiClient: client, floorId: FLOOR_B, projectId: PROJECT }));

    await tick();
    act(() => editFloor(FLOOR_A));
    await tick(800);

    expect(writeLayer).toHaveBeenCalledTimes(1);
    expect(writeLayer.mock.calls[0]?.[0]).toMatchObject({ baseVersion: 0, floorId: FLOOR_A, projectId: PROJECT });
    expect(useStore.getState().floorMeta[FLOOR_A]).toEqual({ revision: 1 });
    expect(second.result.current.label).toMatch(/^Đã lưu lúc \d{2}:\d{2}$/);
    expect(second.result.current.saveBlock).toBeNull();
  });

  it('unmounting a hook only drops its listener — flushAutosaves still saves the edit', async () => {
    const { client, writeLayer } = spyClient();

    loadSample();
    const hook = renderHook(() => useFloorLayerAutosave({ apiClient: client, floorId: FLOOR_A, projectId: PROJECT }));

    await tick();
    hook.unmount();
    act(() => editFloor(FLOOR_A));
    await act(async () => {
      await flushAutosaves();
    });

    expect(writeLayer).toHaveBeenCalledTimes(1);
    expect(useStore.getState().unsavedFloorIds).toEqual([]);
  });

  it('unmount while the PUT flies, mount another screen, edit → base is the revision that came back, no 409', async () => {
    const client = createMockApiClient();
    const realWrite = client.spatial.writeLayer.bind(client.spatial);
    const writeLayer = vi.spyOn(client.spatial, 'writeLayer');
    let release: () => void = () => undefined;

    writeLayer.mockImplementationOnce(
      (input) =>
        new Promise((resolve) => {
          release = () => resolve(realWrite(input));
        }),
    );
    loadSample();
    const first = renderHook(() => useFloorLayerAutosave({ apiClient: client, floorId: FLOOR_A, projectId: PROJECT }));

    await tick();
    act(() => editFloor(FLOOR_A));
    await tick(800);
    expect(writeLayer).toHaveBeenCalledTimes(1);

    first.unmount();
    const other = renderHook(() => useFloorLayerAutosave({ apiClient: client, projectId: PROJECT }));

    release();
    await tick();
    act(() => editFloor(FLOOR_A));
    await tick(800);

    expect(writeLayer).toHaveBeenCalledTimes(2);
    expect(writeLayer.mock.calls[1]?.[0].baseVersion).toBe(1);
    expect(await writeLayer.mock.results[1]?.value).toMatchObject({ ok: true });
    expect(other.result.current.saveBlock).toBeNull();
  });

  it('with no hook mounted, temporal.undo() still saves — one PUT', async () => {
    const { client, writeLayer } = spyClient();

    loadSample();
    const hook = renderHook(() => useFloorLayerAutosave({ apiClient: client, floorId: FLOOR_A, projectId: PROJECT }));

    await tick();
    act(() => editFloor(FLOOR_A));
    await tick(800);
    hook.unmount();
    writeLayer.mockClear();

    act(() => useStore.temporal.getState().undo());
    await tick(800);

    expect(writeLayer).toHaveBeenCalledTimes(1);
  });

  it('a load (setSpatial) or a server replace (replaceFloorLayer) is not an edit — zero PUTs', async () => {
    const { client, writeLayer } = spyClient();

    renderHook(() => useFloorLayerAutosave({ apiClient: client, floorId: FLOOR_A, projectId: PROJECT }));
    await tick();
    act(() => loadSample());
    act(() => loadSample());
    const layer = spatialLayerOf(SAMPLE, FLOOR_A as LevelId);

    act(() => replaceFloorLayer(FLOOR_A, { layer: { ...layer, walls: layer.walls.slice(1) }, revision: 3 }));
    await tick(800);

    expect(writeLayer).not.toHaveBeenCalled();
  });

  it('same user, other project → flushes the synchronous snapshot, and its onSaved never touches the store', async () => {
    const { client, writeLayer } = spyClient();

    loadSample();
    renderHook(() => useFloorLayerAutosave({ apiClient: client, floorId: FLOOR_A, projectId: PROJECT }));
    await tick();
    act(() => editFloor(FLOOR_A));
    const edited = useStore.getState().spatial;

    renderHook(() => useFloorLayerAutosave({ apiClient: client, projectId: 'project-2' }));
    await tick();

    expect(writeLayer).toHaveBeenCalledTimes(1);
    expect(writeLayer.mock.calls[0]?.[0]).toMatchObject({ floorId: FLOOR_A, projectId: PROJECT });
    expect(await writeLayer.mock.results[0]?.value).toMatchObject({ ok: true });
    expect(useStore.getState().spatial).toBe(edited);
    expect(useStore.getState().floorMeta[FLOOR_A]).toEqual({ revision: 0 });
  });

  it('review P1-1: Ctrl+Z while the PUT flies back to the loaded graph is kept and saved', async () => {
    const client = createMockApiClient();
    const realWrite = client.spatial.writeLayer.bind(client.spatial);
    const writeLayer = vi.spyOn(client.spatial, 'writeLayer');
    let release: () => void = () => undefined;

    writeLayer.mockImplementationOnce(
      (input) =>
        new Promise((resolve) => {
          release = () => resolve(realWrite(input));
        }),
    );
    loadSample();
    renderHook(() => useFloorLayerAutosave({ apiClient: client, floorId: FLOOR_A, projectId: PROJECT }));
    await tick();
    const original = wallOn(FLOOR_A);

    act(() => editFloor(FLOOR_A));
    await tick(800);
    expect(writeLayer).toHaveBeenCalledTimes(1);

    act(() => useStore.temporal.getState().undo());
    expect(useStore.getState().spatial).toBe(SAMPLE);
    release();
    await tick(800);
    await tick(800);

    expect((useStore.getState().spatial?.byId[original.id] as Wall).thicknessMm).toBe(original.thicknessMm);
    expect(writeLayer).toHaveBeenCalledTimes(2);
    expect(writeLayer.mock.calls[1]?.[0]).toMatchObject({ baseVersion: 1, floorId: FLOOR_A });
    expect(writeLayer.mock.calls[1]?.[0].body.layer?.walls.find((wall) => wall.id === original.id)?.thicknessMm).toBe(
      original.thicknessMm,
    );
  });

  it('review P2-1: store switches project FIRST, new-key hook mounts AFTER → the pending edit is still PUT with its base', async () => {
    const { client, writeLayer } = spyClient();

    loadSample();
    renderHook(() => useFloorLayerAutosave({ apiClient: client, floorId: FLOOR_A, projectId: PROJECT }));
    await tick();
    act(() => editFloor(FLOOR_A));
    const edited = useStore.getState().spatial;

    // Cổng nạp của dự án mới ghi kho trước, rồi mới dựng màn con.
    act(() => loadSample('project-2'));
    renderHook(() => useFloorLayerAutosave({ apiClient: client, floorId: FLOOR_A, projectId: 'project-2' }));
    await tick();

    expect(writeLayer).toHaveBeenCalledTimes(1);
    expect(writeLayer.mock.calls[0]?.[0]).toMatchObject({ baseVersion: 0, floorId: FLOOR_A, projectId: PROJECT });
    expect(writeLayer.mock.calls[0]?.[0].body.layer).toEqual(spatialLayerOf(edited as typeof SAMPLE, FLOOR_A as LevelId));
    expect(await writeLayer.mock.results[0]?.value).toMatchObject({ ok: true });
    // Kho đã là dự án khác: lượt lưu của dự án cũ không chạm nó.
    expect(useStore.getState().spatialProjectId).toBe('project-2');
    expect(useStore.getState().floorMeta[FLOOR_A]).toEqual({ revision: 0 });
  });

  it('another user → the old saver is disposed without a PUT', async () => {
    const { client, writeLayer } = spyClient();

    loadSample();
    renderHook(() => useFloorLayerAutosave({ apiClient: client, floorId: FLOOR_A, projectId: PROJECT }));
    await tick();
    act(() => editFloor(FLOOR_A));

    signIn('user-b');
    renderHook(() => useFloorLayerAutosave({ apiClient: client, floorId: FLOOR_A, projectId: PROJECT }));
    await tick(800);
    await act(async () => {
      await flushAutosaves();
    });

    expect(writeLayer).not.toHaveBeenCalled();
  });

  it('409 → reload strip; unsaved edits → A9; confirm → one N16 read, block gone, edits of floor B kept', async () => {
    const { client, readLayer, writeLayer } = spyClient();

    loadSample();
    const { result } = renderHook(() => useFloorLayerAutosave({ apiClient: client, floorId: FLOOR_A, projectId: PROJECT }));

    await tick();
    simulateRemoteLayerEdit(FLOOR_A);
    act(() => editFloor(FLOOR_A));
    await tick(800);

    expect(writeLayer).toHaveBeenCalledTimes(1);
    expect(result.current.saveBlock).toMatchObject({ confirm: { open: false }, kind: 'reload' });
    expect(result.current.label).toBe('Lưu thất bại');

    // Sửa tầng B trong lúc A bị khối: B vẫn lưu, A không gửi lại.
    writeLayer.mockClear();
    act(() => editFloor(FLOOR_B));
    await tick(800);
    expect(writeLayer.mock.calls.map(([input]) => input.floorId)).toEqual([FLOOR_B]);

    act(() => editFloor(FLOOR_B));
    const editedB = useStore.getState().spatial?.byLevel[FLOOR_B];

    act(() => result.current.saveBlock?.onReload?.());
    expect(result.current.saveBlock?.confirm?.open).toBe(true);
    expect(readLayer).not.toHaveBeenCalled();

    act(() => result.current.saveBlock?.confirm?.onCancel());
    expect(result.current.saveBlock?.confirm?.open).toBe(false);

    act(() => result.current.saveBlock?.onReload?.());
    act(() => result.current.saveBlock?.confirm?.onConfirm());
    await tick();

    expect(readLayer).toHaveBeenCalledTimes(1);
    expect(result.current.saveBlock).toBeNull();
    expect(useStore.getState().floorMeta[FLOOR_A]).toEqual({ revision: 1 });
    expect(useStore.getState().spatial?.byLevel[FLOOR_B]).toBe(editedB);
    expect(useStore.getState().serverReplaceSeq).toBeGreaterThan(0);

    // Lượt sau dùng revision mới, không 409.
    writeLayer.mockClear();
    act(() => editFloor(FLOOR_A));
    await tick(800);
    expect(writeLayer.mock.calls.find(([input]) => input.floorId === FLOOR_A)?.[0].baseVersion).toBe(1);
  });

  it('a failed N16 read keeps the block and says so', async () => {
    const { client, readLayer } = spyClient();

    loadSample();
    const { result } = renderHook(() => useFloorLayerAutosave({ apiClient: client, projectId: PROJECT }));

    await tick();
    simulateRemoteLayerEdit(FLOOR_A);
    act(() => editFloor(FLOOR_A));
    await tick(800);

    expect(result.current.saveBlock?.message).toContain(LAYER_SAVE_MESSAGES.reload);
    readLayer.mockResolvedValueOnce({ error: { kind: 'network', message: 'down' }, ok: false } as never);
    await act(async () => {
      await result.current.reloadFloor(FLOOR_A);
    });

    expect(readLayer).toHaveBeenCalledTimes(1);
    expect(result.current.saveBlock).toMatchObject({ kind: 'reload', message: expect.stringContaining('Không tải lại được') });
  });

  it('503 DEPENDENCY_UNAVAILABLE then 200: no block, no failed label, engine back to saved', async () => {
    const { client, writeLayer } = spyClient();

    writeLayer.mockResolvedValueOnce({
      error: {
        code: 'DEPENDENCY_UNAVAILABLE',
        kind: 'http',
        raw: { code: 'DEPENDENCY_UNAVAILABLE' },
        requestId: 'r-1',
        retryable: true,
        status: 503,
      },
      ok: false,
    } as never);
    loadSample();
    const { result } = renderHook(() => useFloorLayerAutosave({ apiClient: client, projectId: PROJECT }));

    await tick();
    act(() => editFloor(FLOOR_A));
    await tick(800);

    expect(writeLayer).toHaveBeenCalledTimes(1);
    expect(result.current.saveBlock).toBeNull();
    expect(result.current.autosave.getState()).toBe('dirty');

    await tick(5_000);

    expect(writeLayer).toHaveBeenCalledTimes(2);
    expect(result.current.saveBlock).toBeNull();
    expect(result.current.isFloorBlocked(FLOOR_A)).toBe(false);
    expect(result.current.autosave.getState()).toBe('saved');
    expect(useStore.getState().unsavedFloorIds).toStrictEqual([]);
  });

  it('a 500 is retried on the engine schedule, not left as a blocked floor', async () => {
    const { client, writeLayer } = spyClient();

    writeLayer.mockResolvedValueOnce({
      error: { code: 'INTERNAL', kind: 'http', raw: { code: 'INTERNAL' }, requestId: 'r-1', retryable: true, status: 500 },
      ok: false,
    } as never);
    loadSample();
    const { result } = renderHook(() => useFloorLayerAutosave({ apiClient: client, projectId: PROJECT }));

    await tick();
    act(() => editFloor(FLOOR_A));
    await tick(800);

    expect(result.current.saveBlock).toBeNull();
    expect(result.current.autosave.getState()).toBe('dirty');

    await tick(5_000);

    expect(writeLayer).toHaveBeenCalledTimes(2);
    expect(result.current.autosave.getState()).toBe('saved');
  });

  it('a blocked floor elsewhere does not turn this screen label into "Lưu thất bại"', async () => {
    const { client, writeLayer } = spyClient();

    writeLayer.mockResolvedValueOnce({
      error: { code: 'FORBIDDEN', kind: 'http', raw: { code: 'FORBIDDEN' }, requestId: 'r-1', retryable: false, status: 403 },
      ok: false,
    } as never);
    loadSample();
    const onA = renderHook(() => useFloorLayerAutosave({ apiClient: client, floorId: FLOOR_A, projectId: PROJECT }));
    const onB = renderHook(() => useFloorLayerAutosave({ apiClient: client, floorId: FLOOR_B, projectId: PROJECT }));

    await tick();
    act(() => editFloor(FLOOR_A));
    await tick(800);

    expect(onA.result.current.saveBlock).toEqual({ confirm: null, kind: 'blocked', message: LAYER_SAVE_MESSAGES.forbidden });
    expect(onA.result.current.label).toBe('Lưu thất bại');
    expect(onB.result.current.saveBlock).toBeNull();
    expect(onB.result.current.label).toBeNull();

    act(() => onA.result.current.discardFloor(FLOOR_A));
    expect(onA.result.current.saveBlock).toBeNull();
  });

  it('A3: saveNow reaches writeLayer on microtasks alone, so the exit flush runs before the page can die', async () => {
    const { client, writeLayer } = spyClient();

    loadSample();
    const { result } = renderHook(() => useFloorLayerAutosave({ apiClient: client, floorId: FLOOR_A, projectId: PROJECT }));

    await tick();
    act(() => editFloor(FLOOR_A));

    await act(async () => {
      void result.current.autosave.saveNow();
      // Không `tick`: một chặng qua timer hay `import()` sẽ không kịp tới đây.
      for (let turn = 0; turn < 50; turn += 1) await Promise.resolve();
      expect(writeLayer).toHaveBeenCalledTimes(1);
    });
    await tick();
  });

  it('guards beforeunload while a floor is unsaved', async () => {
    const { client } = spyClient();

    loadSample();
    renderHook(() => useFloorLayerAutosave({ apiClient: client, floorId: FLOOR_A, projectId: PROJECT }));
    await tick();
    act(() => editFloor(FLOOR_A));

    const event = new Event('beforeunload', { cancelable: true });

    window.dispatchEvent(event);
    expect(event.defaultPrevented).toBe(true);
  });

  it('U14: tab quay lại, tầng sạch mà máy chủ có bản mới → nạp ngay, không đợi 409', async () => {
    const { client, readLayer } = spyClient();

    loadSample();
    renderHook(() => useFloorLayerAutosave({ apiClient: client, floorId: FLOOR_A, projectId: PROJECT }));
    await tick();
    simulateRemoteLayerEdit(FLOOR_A);

    act(() => {
      window.dispatchEvent(new Event('focus'));
    });
    await tick();

    expect(readLayer).toHaveBeenCalledTimes(1);
    expect(useStore.getState().floorMeta[FLOOR_A]?.revision).toBe(1);
  });

  it('UX-43: tab khác vừa lưu tầng này → tab cũ đọc bản mới ngay, không cần focus', async () => {
    class FakeChannel {
      static all: FakeChannel[] = [];
      onmessage: ((event: { data: unknown }) => void) | null = null;
      constructor(readonly name: string) {
        FakeChannel.all.push(this);
      }
      postMessage(data: unknown): void {
        FakeChannel.all.filter((other) => other !== this && other.name === this.name).forEach((other) => other.onmessage?.({ data }));
      }
      close(): void {
        FakeChannel.all = FakeChannel.all.filter((other) => other !== this);
      }
    }
    vi.stubGlobal('BroadcastChannel', FakeChannel);
    __resetFloorLayerSavers();

    try {
      const { client, readLayer } = spyClient();

      loadSample();
      renderHook(() => useFloorLayerAutosave({ apiClient: client, floorId: FLOOR_A, projectId: PROJECT }));
      await tick();
      simulateRemoteLayerEdit(FLOOR_A);

      act(() => {
        new FakeChannel(FLOOR_LAYER_SAVED_CHANNEL).postMessage({ floorId: FLOOR_A, projectId: PROJECT });
      });
      await tick();

      expect(readLayer).toHaveBeenCalledTimes(1);
      expect(useStore.getState().floorMeta[FLOOR_A]?.revision).toBe(1);
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it('U14: tầng có sửa chờ thì quay lại tab không đọc, không nạp đè', async () => {
    const { client, readLayer } = spyClient();

    loadSample();
    renderHook(() => useFloorLayerAutosave({ apiClient: client, floorId: FLOOR_A, projectId: PROJECT }));
    await tick();
    act(() => editFloor(FLOOR_A));

    act(() => {
      window.dispatchEvent(new Event('focus'));
    });
    await tick();

    expect(readLayer).not.toHaveBeenCalled();
  });

  it('U15: chỉ còn tầng bị khối reload → không bật hộp hỏi rời trang', async () => {
    const { client } = spyClient();

    loadSample();
    const { result } = renderHook(() => useFloorLayerAutosave({ apiClient: client, floorId: FLOOR_A, projectId: PROJECT }));

    await tick();
    simulateRemoteLayerEdit(FLOOR_A);
    act(() => editFloor(FLOOR_A));
    await tick(800);
    expect(result.current.saveBlock?.kind).toBe('reload');

    const leave = new Event('beforeunload', { cancelable: true });

    window.dispatchEvent(leave);
    expect(leave.defaultPrevented).toBe(false);

    // Sửa tầng khác chưa lưu thì hộp hỏi vẫn còn.
    act(() => editFloor(FLOOR_B));
    const leaveWithEdit = new Event('beforeunload', { cancelable: true });

    window.dispatchEvent(leaveWithEdit);
    expect(leaveWithEdit.defaultPrevented).toBe(true);
  });
});
