import { act, renderHook, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { createSampleBuilding, sampleLevelId } from '@/domain/spatial/__fixtures__/sampleBuilding';
import { normalizeSpatial } from '@/domain/spatial/normalize';
import { UpdateProjectSettingsSchema } from '@/api/schemas/projectSettings';
import { SCENE_STYLE_STORAGE_KEY, SCENE_STYLES, sceneStylePreviewKey } from '@/lib/pascal/sceneStyles';
import { createPascalEditCommand } from '@/lib/pascal/fromPascal';
import { standardSceneOf } from '@/lib/pascal/sceneStandard';
import type { PascalScene } from '@/lib/pascal/types';
import type * as SceneStandard from '@/lib/pascal/sceneStandard';
import type * as AuthSession from '@/lib/auth/session';
import { LIBRARY_FALLBACK_NOTICE } from '@/lib/pascal/serverLibrary';
import { sceneTrace } from '@/pascal-page/createProbe';
import { sceneRepairStore } from '@/pascal-page/sceneRepairStore';
import { useStore } from '@/store';
import type { ProjectRole } from '@/types/project';

import {
  BRIDGE_EMPTY_ERROR,
  BRIDGE_LOAD_ERROR,
  BRIDGE_SAVE_BLOCKED,
  BRIDGE_SAVE_FAILED,
  BRIDGE_SESSION_ERROR,
  CONCEPT_FALLBACK_NOTICE,
  currentProjectSceneStyle,
  drawnFloorIds,
  isSeparateUnits,
  loginHrefOf,
  markNotBuilt,
  MASS_DELETE_TITLE,
  RELOAD_CONFIRM_TITLE,
  NOT_BUILT_KEY,
  savePascalNow,
  SESSION_LOST,
  SESSION_LOST_UNSAVED,
  undrawnFloorNames,
  unsavedNoticeOf,
  usePascalProjectBridge,
  withoutFloorContents,
} from '..';

const session = vi.hoisted(() => ({ ok: true }));
/** N16 giả của từng tầng (Codex P1): mã tầng → `scaleSource`; vắng = tỷ lệ đã xác nhận. */
const scaleApi = vi.hoisted(() => ({ sources: {} as Record<string, 'pipeline' | 'project_default'> }));
/** N5/N6 giả (W4a): `read` = kết quả đọc cài đặt, `puts` = các lượt PUT đã gửi. */
const settingsApi = vi.hoisted(() => ({
  read: { ok: true, data: {} } as { ok: boolean; data?: unknown; error?: unknown },
  puts: [] as unknown[],
}));
/** N47 giả (AID-01): kết quả đọc concept; mặc định Design Director tắt = không có concept → tự bày dự phòng.
 *  `delayMs` > 0: lượt đọc về sau chừng ấy ms (S2 vòng 8 — không còn đua 3 s). */
const conceptApi = vi.hoisted(() => ({
  read: { ok: true, data: { enabled: false } } as { ok: boolean; data?: unknown; error?: unknown },
  delayMs: 0,
}));
const detail = vi.hoisted(() => ({ fail: false, levels: 1, walls: 1, role: 'engineer' as ProjectRole }));
/** Kết quả `onSceneCommit` giả: `reason` khác `null` = có lời từ chối qua `onRejected`. */
const commit = vi.hoisted(() => ({
  ok: true,
  reason: null as string | null,
  unsaved: [] as string[],
  notices: [] as string[],
  accepted: false,
  rebased: [] as unknown[],
  /** Khác `null` = cổng chặn lượt này là xoá nhiều (`validateCommit` gọi `onMassDelete`). */
  massDelete: null as string[] | null,
  confirmed: [] as (readonly string[])[],
}));
/** Phiên giả: `anonymous` = phiên đã hết giữa chừng (L3a-01). */
const auth = vi.hoisted(() => ({ anonymous: false }));
/** Bộ tự lưu tầng giả: trạng thái engine, tầng bị khối, câu khối. */
const saver = vi.hoisted(() => ({
  state: 'saved' as string,
  blocked: null as string | null,
  saveNow: { calls: 0 },
  reloaded: [] as string[],
}));

vi.mock('@/hooks/useSession', async () => {
  const { getSession } = await vi.importActual<typeof AuthSession>('@/lib/auth/session');

  return { useSession: () => (auth.anonymous ? { ...getSession(), status: 'anonymous' as const } : getSession()) };
});
vi.mock('@/routes/sessionSetup', () => ({ startAppSession: () => Promise.resolve(session.ok) }));
vi.mock('@/api/appClient', async (importOriginal) => ({
  ...(await importOriginal<object>()),
  createAppApiClient: () => ({
    projects: {},
    spatial: {
      readLayer: ({ floorId }: { floorId: string }) => {
        const scaleSource = scaleApi.sources[floorId];
        return Promise.resolve({
          ok: true,
          data:
            scaleSource === undefined
              ? {}
              : { scaleStatus: 'unresolved', scaleSource, level: { scaleMillimetresPerPixel: 10 } },
        });
      },
    },
    designConcept: {
      read: () =>
        conceptApi.delayMs > 0
          ? new Promise((resolve) => setTimeout(() => resolve(conceptApi.read), conceptApi.delayMs))
          : Promise.resolve(conceptApi.read),
    },
    projectSettings: {
      read: () => Promise.resolve(settingsApi.read),
      replace: (input: unknown) => (settingsApi.puts.push(input), Promise.resolve({ ok: true, data: {} })),
    },
  }),
  resolveUseMockApi: () => false,
}));
vi.mock('@/hooks/useAutosave', () => ({
  useFloorLayerAutosave: () => ({
    autosave: {
      subscribe: () => () => undefined,
      getState: () => saver.state,
      saveNow: () => {
        saver.saveNow.calls += 1;
        return Promise.resolve();
      },
    },
    label: saver.state === 'saved' ? 'Đã lưu lúc 10:00' : null,
    saveBlock: saver.blocked === null ? null : { kind: 'reload', message: saver.blocked, confirm: null },
    isFloorBlocked: (floorId: string) => saver.blocked !== null && floorId === 'L-1',
    reloadFloor: (floorId: string) => {
      saver.reloaded.push(floorId);
      return Promise.resolve();
    },
  }),
}));
vi.mock('@/api/floorLayerGraph', () => ({
  readProjectDetail: () =>
    detail.fail ? Promise.reject(new Error('mạng hỏng')) : Promise.resolve({ id: 'p1', name: 'Nhà mẫu' }),
  readProjectGraph: () =>
    Promise.resolve({
      graph: { levels: Array.from({ length: detail.levels }, () => ({})), walls: Array.from({ length: detail.walls }, () => ({})), rooms: [] },
    }),
  toProjectSpatial: () => ({}),
}));
vi.mock('@/store/projectHydration', () => ({
  loadProjectGraph: () => {
    /* eslint-disable-next-line local/no-direct-set -- giả lập kho vừa nạp, như `loadProjectGraph` thật */
    useStore.setState({
      spatial: normalizeSpatial(createSampleBuilding()),
      spatialLoading: false,
      userRoles: [detail.role],
    });

    return 'hydrated';
  },
}));

// Gián điệp quanh hàm thật: xem cầu trao phong cách nào cho `standardSceneOf` (cảnh chuẩn, gồm sửa cảnh).
vi.mock('@/lib/pascal/sceneStandard', async (importOriginal) => {
  const actual = await importOriginal<typeof SceneStandard>();

  return { ...actual, standardSceneOf: vi.fn(actual.standardSceneOf) };
});

vi.mock('@/screens/viewer/PascalViewer/usePascalEdits', () => ({
  usePascalEdits: ({
    onRejected,
    onMassDelete,
    onUnsaved,
    onNotice,
  }: {
    onRejected: (reason: string) => void;
    onMassDelete: (request: { nodeIds: readonly string[]; reason: string }) => void;
    onUnsaved: (labels: readonly string[]) => void;
    onNotice: (message: string) => void;
  }) => ({
    validateCommit: () => {
      if (commit.massDelete !== null && commit.reason !== null) onMassDelete({ nodeIds: commit.massDelete, reason: commit.reason });
      return { ok: commit.reason === null };
    },
    confirmMassDelete: (nodeIds: readonly string[]) => {
      commit.confirmed.push(nodeIds);
    },
    onSceneCommit: () => {
      if (commit.reason !== null) onRejected(commit.reason);
      // Như hook thật (V9): mọi lượt không bị từ chối đều gọi onUnsaved, kể cả danh sách rỗng.
      else onUnsaved(commit.unsaved);
      commit.notices.forEach(onNotice);

      return Promise.resolve(commit.ok);
    },
    takeSuggestionAccepted: () => {
      const accepted = commit.accepted;

      commit.accepted = false;

      return accepted;
    },
    rebaseOnRebuilt: (scene: unknown) => {
      commit.rebased.push(scene);
    },
  }),
}));

/** Chữ các thông báo nổi đang hiện, theo thứ tự. */
const textsOf = (bridge: { readonly save?: { readonly notices: readonly { readonly text: string }[] } }): string[] =>
  bridge.save?.notices.map((item) => item.text) ?? [];

describe('usePascalProjectBridge', () => {
  beforeEach(() => {
    session.ok = true;
    scaleApi.sources = {};
    settingsApi.read = { ok: true, data: {} };
    settingsApi.puts = [];
    conceptApi.read = { ok: true, data: { enabled: false } };
    conceptApi.delayMs = 0;
    detail.fail = false;
    detail.levels = 1;
    detail.walls = 1;
    detail.role = 'engineer';
    commit.ok = true;
    commit.reason = null;
    commit.unsaved = [];
    commit.notices = [];
    commit.massDelete = null;
    commit.confirmed = [];
    auth.anonymous = false;
    saver.state = 'saved';
    saver.blocked = null;
    saver.saveNow.calls = 0;
    saver.reloaded = [];
    /* eslint-disable-next-line local/no-direct-set -- đưa kho về rỗng giữa các bài */
    useStore.setState({ spatial: null, userRoles: [] });
  });

  it.each([
    ['hien-dai-sang', SCENE_STYLES['hien-dai-sang']],
    ['khong-co', SCENE_STYLES['am-ap']],
  ])('phong cách đã lưu "%s" đi vào standardSceneOf (lạ → mặc định)', async (stored, style) => {
    localStorage.setItem(SCENE_STYLE_STORAGE_KEY, stored);
    const { result } = renderHook(() => usePascalProjectBridge('p1'));
    await waitFor(() => expect(result.current.status).toBe('ready'));
    vi.mocked(standardSceneOf).mockClear();

    await act(() => result.current.onLoad());

    expect(standardSceneOf).toHaveBeenCalledTimes(1);
    expect(standardSceneOf).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ style, furnish: 'on' }));
    localStorage.removeItem(SCENE_STYLE_STORAGE_KEY);
  });

  const wireSettings = {
    buildingType: 'residential',
    confidenceThreshold: 0.8,
    defaultScaleMmPerPx: 10,
    lengthUnit: 'mm',
    snapToleranceMm: 20,
    revision: 4,
  } as const;

  it('W4a — phong cách lưu ở dự án thắng khoá máy; N5 hỏng thì lùi về khoá máy', async () => {
    localStorage.setItem(SCENE_STYLE_STORAGE_KEY, 'go-am');
    settingsApi.read = { ok: true, data: { ...wireSettings, sceneStyle: 'toi-gian' } };
    const first = renderHook(() => usePascalProjectBridge('p1'));
    await waitFor(() => expect(first.result.current.status).toBe('ready'));
    vi.mocked(standardSceneOf).mockClear();
    await act(() => first.result.current.onLoad());
    expect(standardSceneOf).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ style: SCENE_STYLES['toi-gian'], furnish: 'on' }));
    expect(currentProjectSceneStyle()?.id).toBe('toi-gian');

    settingsApi.read = { ok: false, error: new Error('403') };
    const second = renderHook(() => usePascalProjectBridge('p1'));
    await waitFor(() => expect(second.result.current.status).toBe('ready'));
    vi.mocked(standardSceneOf).mockClear();
    await act(() => second.result.current.onLoad());
    expect(standardSceneOf).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ style: SCENE_STYLES['go-am'], furnish: 'on' }));
    expect(currentProjectSceneStyle()?.saveToProject).toBeUndefined();
    localStorage.removeItem(SCENE_STYLE_STORAGE_KEY);
  });

  it('bench-3d — không có concept AI: tự bày dự phòng (furnish on); concept xong: AI quyết (off + đồ AI)', async () => {
    const result = {
      nameVi: 'Japandi',
      summaryVi: 'Gỗ sáng.',
      baseStyle: 'toi-gian',
      wall: {},
      floor: {},
      models: {},
      additions: [
        { levelId: 'L-1', roomId: 'R-1', kind: 'other', variant: 'plant', centre: { x: 100, y: 200 }, widthMm: 300, depthMm: 300, rotationDeg: 90 },
      ],
    };
    const T = '2026-11-02T01:00:00.000Z';
    conceptApi.read = {
      ok: true,
      data: { enabled: true, active: { id: 'dcn_01', suggested: true, status: 'done', createdAt: T, startedAt: T, endedAt: T, result } },
    };
    const withConcept = renderHook(() => usePascalProjectBridge('p1'));
    await waitFor(() => expect(withConcept.result.current.status).toBe('ready'));
    vi.mocked(standardSceneOf).mockClear();
    await act(() => withConcept.result.current.onLoad());
    const [, options] = vi.mocked(standardSceneOf).mock.calls[0] ?? [];
    expect(options?.furnish).toBe('off');
    expect(options?.additions).toHaveLength(1);

    // Concept chưa xong (đang chạy) cũng như không có: tự bày.
    conceptApi.read = { ok: true, data: { enabled: true, active: { id: 'dcn_02', suggested: true, status: 'running', createdAt: T, startedAt: T } } };
    const running = renderHook(() => usePascalProjectBridge('p1'));
    await waitFor(() => expect(running.result.current.status).toBe('ready'));
    vi.mocked(standardSceneOf).mockClear();
    await act(() => running.result.current.onLoad());
    expect(vi.mocked(standardSceneOf).mock.calls[0]?.[1]).toMatchObject({ furnish: 'on' });
    expect(vi.mocked(standardSceneOf).mock.calls[0]?.[1]?.additions).toBeUndefined();
  });

  const doneConcept = () => {
    const T = '2026-11-02T01:00:00.000Z';
    const result = {
      nameVi: 'Japandi',
      summaryVi: 'Gỗ sáng.',
      baseStyle: 'toi-gian',
      wall: {},
      floor: {},
      models: {},
      additions: [
        { levelId: 'L-1', roomId: 'R-1', kind: 'other', variant: 'plant', centre: { x: 100, y: 200 }, widthMm: 300, depthMm: 300, rotationDeg: 90 },
      ],
    };
    return { ok: true, data: { enabled: true, active: { id: 'dcn_01', suggested: true, status: 'done', createdAt: T, startedAt: T, endedAt: T, result } } };
  };

  it('S2 vòng 8 — concept về sau 5 s: cầu vẫn chờ (không đua 3 s), áp phong cách + đồ AI, không báo dự phòng', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    try {
      conceptApi.read = doneConcept();
      conceptApi.delayMs = 5000;
      const { result } = renderHook(() => usePascalProjectBridge('p1'));
      await act(() => vi.advanceTimersByTimeAsync(3500));
      expect(result.current.status).toBe('loading');
      await act(() => vi.advanceTimersByTimeAsync(2000));
      await waitFor(() => expect(result.current.status).toBe('ready'));
      vi.mocked(standardSceneOf).mockClear();
      await act(() => result.current.onLoad());
      const [, options] = vi.mocked(standardSceneOf).mock.calls[0] ?? [];
      expect(options?.furnish).toBe('off');
      expect(options?.additions).toHaveLength(1);
      expect(sceneTrace.state().concept).toBe('done');
      expect(textsOf(result.current)).toEqual([]);
    } finally {
      vi.useRealTimers();
    }
  });

  it('S2 vòng 8 — đọc concept lỗi: dự phòng NGAY, có lý do, người dùng thấy thông báo', async () => {
    conceptApi.read = { ok: false, error: { kind: 'network' } };
    const { result } = renderHook(() => usePascalProjectBridge('p1'));
    await waitFor(() => expect(result.current.status).toBe('ready'));
    expect(sceneTrace.state().concept).toBe('fallback:network');
    expect(textsOf(result.current)).toEqual([CONCEPT_FALLBACK_NOTICE]);
    vi.mocked(standardSceneOf).mockClear();
    await act(() => result.current.onLoad());
    expect(vi.mocked(standardSceneOf).mock.calls[0]?.[1]).toMatchObject({ furnish: 'on' });
  });

  it.each([
    ['403 (vai chỉ đọc)', { kind: 'http', status: 403, requestId: 'r', retryable: false, raw: null }],
    ['404 (không có concept)', { kind: 'notFound', code: 'X', messageKey: 'k', params: {}, requestId: 'r', retryable: false }],
  ])('S2 vòng 8 — concept %s: như không có (none), không báo lỗi tải', async (_label, error) => {
    conceptApi.read = { ok: false, error };
    const { result } = renderHook(() => usePascalProjectBridge('p1'));
    await waitFor(() => expect(result.current.status).toBe('ready'));
    expect(sceneTrace.state().concept).toBe('none');
    expect(textsOf(result.current)).toEqual([]);
  });

  it('S2 vòng 8 — nạp dự án hỏng: nguồn concept vẫn chốt (error) để ready() không kẹt', async () => {
    sceneTrace.source('concept', 'done');
    detail.fail = true;
    const { result } = renderHook(() => usePascalProjectBridge('p1'));
    await waitFor(() => expect(result.current.status).toBe('error'));
    expect(sceneTrace.state().concept).toBe('error');
  });

  it('S2 vòng 8 — thư viện máy chủ đọc lỗi: thông báo dự phòng; thư viện máy chủ / trống: không báo', async () => {
    const timedOut = Promise.resolve('fallback:timeout' as const);
    const failed = renderHook(() => usePascalProjectBridge('p1', undefined, undefined, timedOut));
    await waitFor(() => expect(textsOf(failed.result.current)).toEqual([LIBRARY_FALLBACK_NOTICE]));
    for (const source of ['server', 'fallback:empty'] as const) {
      const loaded = Promise.resolve(source);
      const fine = renderHook(() => usePascalProjectBridge('p1', undefined, undefined, loaded));
      await waitFor(() => expect(fine.result.current.status).toBe('ready'));
      expect(textsOf(fine.result.current)).toEqual([]);
    }
  });

  it('UX-R2: separateUnits của N5 đọc lúc nạp; vắng hay N5 hỏng thì tắt', async () => {
    settingsApi.read = { ok: true, data: { ...wireSettings, separateUnits: true } };
    const first = renderHook(() => usePascalProjectBridge('p1'));
    await waitFor(() => expect(first.result.current.status).toBe('ready'));
    expect(isSeparateUnits()).toBe(true);

    settingsApi.read = { ok: false, error: new Error('403') };
    const second = renderHook(() => usePascalProjectBridge('p1'));
    await waitFor(() => expect(second.result.current.status).toBe('ready'));
    expect(isSeparateUnits()).toBe(false);
  });

  it('W4a — bản xem thử của người xem trên máy này thắng phong cách dự án', async () => {
    localStorage.setItem(sceneStylePreviewKey('p1'), 'hien-dai-sang');
    settingsApi.read = { ok: true, data: { ...wireSettings, sceneStyle: 'toi-gian' } };
    const { result } = renderHook(() => usePascalProjectBridge('p1'));
    await waitFor(() => expect(result.current.status).toBe('ready'));
    expect(currentProjectSceneStyle()?.id).toBe('hien-dai-sang');
    localStorage.removeItem(sceneStylePreviewKey('p1'));
  });

  it('W4a — người xem: không có lối PUT (chỉ máy này)', async () => {
    detail.role = 'viewer';
    settingsApi.read = { ok: true, data: { ...wireSettings } };
    const { result } = renderHook(() => usePascalProjectBridge('p1'));
    await waitFor(() => expect(result.current.status).toBe('ready'));
    expect(currentProjectSceneStyle()).toStrictEqual({ projectId: 'p1', id: 'am-ap' });
  });

  it('W4a — người sửa được cài đặt: PUT đủ thân + sceneStyle, đúng revision, qua schema strict', async () => {
    settingsApi.read = { ok: true, data: { ...wireSettings, notes: 'ghi chú', sceneStyle: 'go-am' } };
    const { result } = renderHook(() => usePascalProjectBridge('p1'));
    await waitFor(() => expect(result.current.status).toBe('ready'));

    await currentProjectSceneStyle()?.saveToProject?.('sang-trong-toi');

    expect(settingsApi.puts).toHaveLength(1);
    const { projectId, ...write } = settingsApi.puts[0] as { projectId: string };
    expect(projectId).toBe('p1');
    expect(UpdateProjectSettingsSchema.parse(write)).toStrictEqual({
      baseVersion: 4,
      body: {
        buildingType: 'residential',
        confidenceThreshold: 0.8,
        defaultScaleMmPerPx: 10,
        lengthUnit: 'mm',
        notes: 'ghi chú',
        sceneStyle: 'sang-trong-toi',
        snapToleranceMm: 20,
      },
    });
  });

  it('savePascalNow: Ctrl+S cho Pascal rồi đợi đúng lượt onSave ấy (ném khi bị từ chối)', async () => {
    const { result } = renderHook(() => usePascalProjectBridge('p1'));
    await waitFor(() => expect(result.current.status).toBe('ready'));
    // Thay `useSaveShortcut` + `saveNow` của editor: bắt Ctrl+S ở pha capture, gọi `onSave` ngay.
    const pascal = (e: KeyboardEvent) => {
      if (e.ctrlKey && e.code === 'KeyS') void result.current.onSave({ nodes: {}, rootNodeIds: [] }).catch(() => undefined);
    };
    window.addEventListener('keydown', pascal, true);

    await expect(savePascalNow()).resolves.toBeUndefined();
    commit.ok = false;
    commit.reason = 'Đồ gắn trần chưa lưu được.';
    await expect(savePascalNow()).rejects.toThrow('Đồ gắn trần chưa lưu được.');
    window.removeEventListener('keydown', pascal, true);
  });

  it('sẵn sàng: tên dự án, đường về, và cảnh từ toPascal', async () => {
    const { result } = renderHook(() => usePascalProjectBridge('p1'));

    await waitFor(() => expect(result.current.status).toBe('ready'));
    expect(result.current.projectName).toBe('Nhà mẫu');
    expect(result.current.backHref).toBe('/projects/p1/floors');
    expect(result.current.readOnly).toBe(false);

    let scene: Awaited<ReturnType<typeof result.current.onLoad>> | undefined;
    await act(async () => {
      scene = await result.current.onLoad();
    });
    expect(scene).toEqual(standardSceneOf(createSampleBuilding()).scene);
  });

  it('vai người xem: chỉ đọc', async () => {
    detail.role = 'viewer';
    const { result } = renderHook(() => usePascalProjectBridge('p1'));

    await waitFor(() => expect(result.current.status).toBe('ready'));
    expect(result.current.readOnly).toBe(true);
  });

  it('nạp hỏng: lỗi tiếng Việt', async () => {
    detail.fail = true;
    const { result } = renderHook(() => usePascalProjectBridge('p1'));

    await waitFor(() => expect(result.current.status).toBe('error'));
    expect(result.current.error).toBe(BRIDGE_LOAD_ERROR);
  });

  it('chưa có tầng nào: trạng thái rỗng (C15)', async () => {
    detail.levels = 0;
    detail.walls = 0;
    const { result } = renderHook(() => usePascalProjectBridge('p1'));

    await waitFor(() => expect(result.current.status).toBe('error'));
    expect(result.current.error).toBe(BRIDGE_EMPTY_ERROR);
  });

  it('có tầng mà chưa có tường: vẫn mở để vẽ trong 3D (C15)', async () => {
    detail.walls = 0;
    const { result } = renderHook(() => usePascalProjectBridge('p1'));

    await waitFor(() => expect(result.current.status).toBe('ready'));
  });

  it('lượt bị từ chối: dựng lại cảnh từ kho (0 lệnh so với đồ thị); lượt hợp lệ không đặt lại', async () => {
    const applied: PascalScene[] = [];
    const { result } = renderHook(() => usePascalProjectBridge('p1', (scene) => applied.push(scene as PascalScene)));

    await waitFor(() => expect(result.current.status).toBe('ready'));
    let loaded: unknown;
    await act(async () => {
      loaded = await result.current.onLoad();
    });

    await expect(result.current.onSave({ nodes: {}, rootNodeIds: [] })).resolves.toBeUndefined();
    commit.ok = false;
    await expect(result.current.onSave({ nodes: {}, rootNodeIds: [] })).resolves.toBeUndefined();
    expect(applied).toHaveLength(0);

    commit.reason = 'Tường phải nằm trong tầng.';
    await expect(result.current.onSave({ nodes: {}, rootNodeIds: [] })).rejects.toThrow('Tường phải nằm trong tầng.');
    expect(applied).toHaveLength(1);

    const graph = useStore.getState().spatial;
    const restored = applied[0];
    if (graph === null || restored === undefined) throw new Error('thiếu kho hoặc cảnh dựng lại');
    // Sửa cảnh chốt lúc nạp: cảnh dựng lại khớp đúng cảnh lúc nạp (không chênh "sửa ma"); ngoài các món đã sửa cảnh,
    // mọi node đọc ngược khớp kho.
    expect(restored).toEqual(loaded);
    const repaired = new Set(sceneRepairStore.get().repairs.map((r) => `item_${r.furnitureId}`));
    const back = createPascalEditCommand({
      graph,
      scene: restored,
      commit: { origin: 'load', changedNodeIds: Object.keys(restored.nodes).filter((id) => !repaired.has(id)) },
      actorId: 'u1',
    });

    expect(back.ok ? null : back.error.code).toBe('PASCAL_NO_CHANGE');
  });

  it('vừa nhận món gợi ý: dựng lại cảnh từ kho ngay để tấm viền thành mẫu thật, một lần; cảnh editor sau đó thành mốc', async () => {
    const applied: PascalScene[] = [];
    const editor = { nodes: {}, rootNodeIds: ['editor'] };
    const { result } = renderHook(() => usePascalProjectBridge('p1', (scene) => applied.push(scene as PascalScene), () => editor as never));

    await waitFor(() => expect(result.current.status).toBe('ready'));

    commit.rebased = [];
    commit.accepted = true;
    await result.current.onSave({ nodes: {}, rootNodeIds: [] });
    expect(applied).toHaveLength(1);
    expect(commit.rebased).toEqual([editor]);
    await result.current.onSave({ nodes: {}, rootNodeIds: [] });
    expect(applied).toHaveLength(1);
    expect(commit.rebased).toHaveLength(1);
  });

  it('máy chủ khối tầng: "Tải lại tầng" nạp lại tầng rồi dựng lại cảnh từ kho, không nạp lại trang', async () => {
    const applied: unknown[] = [];
    saver.blocked = 'Tầng đã đổi trên máy chủ.';
    const { result } = renderHook(() => usePascalProjectBridge('p1', (scene) => applied.push(scene)));

    await waitFor(() => expect(result.current.status).toBe('ready'));
    /* eslint-disable-next-line local/no-direct-set -- tầng L-1 đang chờ lưu và bị khối */
    useStore.setState({ unsavedFloorIds: ['L-1'] });

    // C4/A2-07: tầng còn sửa chưa lưu → hỏi trước, chưa nạp gì.
    act(() => result.current.save?.onReloadFloor());
    expect(result.current.save?.confirm?.title).toBe(RELOAD_CONFIRM_TITLE);
    expect(saver.reloaded).toEqual([]);

    act(() => result.current.save?.confirm?.onCancel());
    expect(result.current.save?.confirm).toBeNull();
    expect(saver.reloaded).toEqual([]);

    act(() => result.current.save?.onReloadFloor());
    act(() => result.current.save?.confirm?.onConfirm());

    await waitFor(() => expect(applied).toHaveLength(1));
    expect(saver.reloaded).toEqual(['L-1']);
    await waitFor(() => expect(result.current.save?.notices.map((item) => item.text)).toEqual(['Tầng đã đổi trên máy chủ.']));
    /* eslint-disable-next-line local/no-direct-set -- dọn lại */
    useStore.setState({ unsavedFloorIds: [] });
  });

  it('lưu: "không có gì để ghi" là thành công, chỉ ném khi có lời từ chối', async () => {
    const { result } = renderHook(() => usePascalProjectBridge('p1'));

    await waitFor(() => expect(result.current.status).toBe('ready'));

    commit.ok = false;
    await expect(result.current.onSave({ nodes: {}, rootNodeIds: [] })).resolves.toBeUndefined();

    commit.reason = 'Đồ gắn trần chưa lưu được.';
    await expect(result.current.onSave({ nodes: {}, rootNodeIds: [] })).rejects.toThrow('Đồ gắn trần chưa lưu được.');
  });

  it('phiên hết hạn: lỗi phiên', async () => {
    session.ok = false;
    const { result } = renderHook(() => usePascalProjectBridge('p1'));

    await waitFor(() => expect(result.current.status).toBe('error'));
    expect(result.current.error).toBe(BRIDGE_SESSION_ERROR);
  });

  it('v3 V3 — lượt vào kho đợi lượt PUT; hỏng/khối thì ném cho editor, thẻ hiện trạng thái thật', async () => {
    const { result } = renderHook(() => usePascalProjectBridge('p1'));
    await waitFor(() => expect(result.current.status).toBe('ready'));

    expect(result.current.save?.state).toBe('saved');
    expect(result.current.save?.label).toBe('Đã lưu lúc 10:00');
    await expect(result.current.onSave({ nodes: {}, rootNodeIds: [] })).resolves.toBeUndefined();
    expect(saver.saveNow.calls).toBe(1);

    saver.state = 'failed';
    await expect(result.current.onSave({ nodes: {}, rootNodeIds: [] })).rejects.toThrow(BRIDGE_SAVE_FAILED);

    saver.state = 'saved';
    saver.blocked = 'Bản vẽ đã đổi ở nơi khác.';
    /* eslint-disable-next-line local/no-direct-set -- tầng L-1 đang chờ lưu */
    useStore.setState({ unsavedFloorIds: ['L-1'] });
    await expect(result.current.onSave({ nodes: {}, rootNodeIds: [] })).rejects.toThrow(BRIDGE_SAVE_BLOCKED);

    const { result: blocked } = renderHook(() => usePascalProjectBridge('p1'));
    await waitFor(() => expect(blocked.current.status).toBe('ready'));
    expect(blocked.current.save?.state).toBe('blocked');
    expect(blocked.current.save?.blockMessage).toBe('Bản vẽ đã đổi ở nơi khác.');
    /* eslint-disable-next-line local/no-direct-set -- dọn */
    useStore.setState({ unsavedFloorIds: [] });
  });

  it('v3 V3 — phần sửa chưa lưu được: một câu, mỗi nhãn một lần mỗi phiên; vai xem không có thẻ lưu', async () => {
    const { result } = renderHook(() => usePascalProjectBridge('p1'));
    await waitFor(() => expect(result.current.status).toBe('ready'));

    commit.ok = false;
    commit.unsaved = ['màu sàn', 'màu tường'];
    await act(async () => {
      await result.current.onSave({ nodes: {}, rootNodeIds: [] });
    });
    expect(textsOf(result.current)).toEqual([unsavedNoticeOf(['màu sàn', 'màu tường'])]);
    expect(textsOf(result.current)).toEqual(['Chưa lưu được: màu sàn, màu tường — sẽ có ở bản sau.']);

    act(() => result.current.save!.dismissNotice(result.current.save!.notices[0]!.id));
    await act(async () => {
      await result.current.onSave({ nodes: {}, rootNodeIds: [] });
    });
    expect(textsOf(result.current)).toEqual([]);

    commit.unsaved = ['màu sàn', 'kiểu cửa'];
    await act(async () => {
      await result.current.onSave({ nodes: {}, rootNodeIds: [] });
    });
    expect(textsOf(result.current)).toEqual(['Chưa lưu được: kiểu cửa — sẽ có ở bản sau.']);

    detail.role = 'viewer';
    const { result: viewer } = renderHook(() => usePascalProjectBridge('p1'));
    await waitFor(() => expect(viewer.current.readOnly).toBe(true));
    expect(viewer.current.save).toBeUndefined();
  });

  it('W3e — lời báo của lượt sửa (vách mới): lên thẻ như câu chưa lưu, mỗi câu một lần mỗi phiên', async () => {
    const split = 'Phòng "Khách" có vách mới — mở màn Phòng để tách.';
    const { result } = renderHook(() => usePascalProjectBridge('p1'));
    await waitFor(() => expect(result.current.status).toBe('ready'));

    commit.notices = [split];
    await act(async () => {
      await result.current.onSave({ nodes: {}, rootNodeIds: [] });
    });
    expect(textsOf(result.current)).toEqual([split]);

    act(() => result.current.save!.dismissNotice(result.current.save!.notices[0]!.id));
    commit.notices = [split, 'Phòng "Ngủ" có vách mới — mở màn Phòng để tách.'];
    await act(async () => {
      await result.current.onSave({ nodes: {}, rootNodeIds: [] });
    });
    expect(textsOf(result.current)).toEqual(['Phòng "Ngủ" có vách mới — mở màn Phòng để tách.']);
  });

  it('C1/F-01 — câu "Chưa lưu được" không bị lượt sau gỡ; nhãn mới là một thông báo riêng', async () => {
    const { result } = renderHook(() => usePascalProjectBridge('p1'));
    await waitFor(() => expect(result.current.status).toBe('ready'));

    commit.unsaved = ['màu sàn'];
    await act(async () => {
      await result.current.onSave({ nodes: {}, rootNodeIds: [] });
    });
    expect(textsOf(result.current)).toEqual([unsavedNoticeOf(['màu sàn'])]);

    commit.unsaved = [];
    await act(async () => {
      await result.current.onSave({ nodes: {}, rootNodeIds: [] });
    });
    expect(textsOf(result.current)).toEqual([unsavedNoticeOf(['màu sàn'])]);

    commit.unsaved = ['kiểu cửa'];
    await act(async () => {
      await result.current.onSave({ nodes: {}, rootNodeIds: [] });
    });
    expect(textsOf(result.current)).toEqual([unsavedNoticeOf(['màu sàn']), unsavedNoticeOf(['kiểu cửa'])]);
  });

  it('C4/A2-02 — xoá nhiều: hộp xác nhận thay toast đỏ, cảnh đã xoá giữ nguyên; xác nhận thì mở cổng và lưu, không đặt lại cảnh', async () => {
    const applied: unknown[] = [];
    const { result } = renderHook(() => usePascalProjectBridge('p1', (scene) => applied.push(scene)));
    await waitFor(() => expect(result.current.status).toBe('ready'));

    const deleted = { nodes: { a: {} }, rootNodeIds: ['a'] };
    commit.ok = false;
    commit.reason = 'Thay đổi này xoá 5 trong 10 đối tượng của một tầng nên phải được xác nhận trước.';
    commit.massDelete = ['n1', 'n2', 'n3', 'n4', 'n5'];
    await act(async () => {
      await expect(result.current.onSave(deleted)).rejects.toThrow(commit.reason ?? '');
    });
    expect(result.current.save?.confirm?.title).toBe(MASS_DELETE_TITLE);
    expect(textsOf(result.current)).toEqual([]);
    // Đang chờ hỏi: không đặt cảnh về kho (cả mô hình từng nháy hai lần — về rồi lại xoá).
    expect(applied).toHaveLength(0);

    commit.ok = true;
    commit.reason = null;
    commit.massDelete = null;
    await act(async () => {
      result.current.save?.confirm?.onConfirm();
      await Promise.resolve();
    });
    expect(commit.confirmed).toEqual([['n1', 'n2', 'n3', 'n4', 'n5']]);
    expect(applied).toHaveLength(0);
    expect(result.current.save?.confirm).toBeNull();
    await waitFor(() => expect(saver.saveNow.calls).toBe(1));
  });

  it('C4/A2-02 — xoá nhiều rồi Huỷ: cảnh đặt về kho', async () => {
    const applied: unknown[] = [];
    const { result } = renderHook(() => usePascalProjectBridge('p1', (scene) => applied.push(scene)));
    await waitFor(() => expect(result.current.status).toBe('ready'));

    commit.ok = false;
    commit.reason = 'Thay đổi này xoá 5 trong 10 đối tượng của một tầng nên phải được xác nhận trước.';
    commit.massDelete = ['n1', 'n2', 'n3', 'n4', 'n5'];
    await act(async () => {
      await expect(result.current.onSave({ nodes: { a: {} }, rootNodeIds: ['a'] })).rejects.toThrow(commit.reason ?? '');
    });
    act(() => result.current.save?.confirm?.onCancel());
    expect(result.current.save?.confirm).toBeNull();
    expect(applied).toHaveLength(1);
  });

  it('K5/A2-06 — mất mạng là trạng thái riêng, không phải "đang lưu"', async () => {
    saver.state = 'offline';
    const { result } = renderHook(() => usePascalProjectBridge('p1'));
    await waitFor(() => expect(result.current.status).toBe('ready'));

    expect(result.current.save?.state).toBe('offline');
  });

  it('L3a-01 — phiên hết giữa chừng: báo ngay, nói rõ chưa lưu, có đường đăng nhập lại về đúng 3D', async () => {
    const { result, rerender } = renderHook(() => usePascalProjectBridge('p1'));
    await waitFor(() => expect(result.current.status).toBe('ready'));

    auth.anonymous = true;
    rerender();
    expect(result.current.save?.state).toBe('session');
    expect(result.current.save?.blockMessage).toBe(SESSION_LOST);
    expect(result.current.save?.loginHref).toBe(loginHrefOf('p1'));
    expect(loginHrefOf('p1')).toBe('/login?next=%2Fprojects%2Fp1%2F3d');

    saver.state = 'failed';
    rerender();
    expect(result.current.save?.blockMessage).toBe(SESSION_LOST_UNSAVED);
  });

  it('N1 — lượt bị từ chối: lý do lên thẻ dạng cảnh báo, không im lặng "đã lưu"', async () => {
    const { result } = renderHook(() => usePascalProjectBridge('p1'));
    await waitFor(() => expect(result.current.status).toBe('ready'));

    commit.ok = false;
    commit.reason = 'Món đồ này đã có trong bản vẽ.';
    await act(async () => {
      await expect(result.current.onSave({ nodes: {}, rootNodeIds: [] })).rejects.toThrow(commit.reason ?? '');
    });
    expect(result.current.save?.notices).toMatchObject([{ text: 'Món đồ này đã có trong bản vẽ.', tone: 'alert' }]);

    // Câu báo thường đến sau là mục riêng, giọng `info` — không bị nhuộm đỏ vì dính câu lỗi.
    commit.reason = null;
    commit.unsaved = ['màu sàn'];
    await act(async () => {
      await result.current.onSave({ nodes: {}, rootNodeIds: [] });
    });
    expect(result.current.save?.notices.map((item) => item.tone)).toEqual(['alert', 'info']);
  });

  it('Codex P1 — tầng chưa có tỷ lệ: không dựng nội dung trong 3D, tầng vẫn còn; tỷ lệ máy đo vẫn dựng', async () => {
    scaleApi.sources = { [sampleLevelId(1)]: 'project_default', [sampleLevelId(2)]: 'pipeline' };
    const { result } = renderHook(() => usePascalProjectBridge('p1'));
    await waitFor(() => expect(result.current.status).toBe('ready'));

    let scene: Awaited<ReturnType<typeof result.current.onLoad>> | undefined;
    await act(async () => {
      scene = await result.current.onLoad();
    });
    const sample = createSampleBuilding();
    const hidden = new Set([sampleLevelId(1)]);
    expect(scene).toEqual(markNotBuilt(standardSceneOf(withoutFloorContents(sample, hidden)).scene, hidden));
    // UX-R2 K36: danh sách tầng của editor đọc dấu này để ghi "Chưa dựng".
    const notBuilt = (levelId: string) =>
      (scene?.nodes[`level_${levelId}`] as { metadata?: Record<string, unknown> } | undefined)?.metadata?.[NOT_BUILT_KEY];
    expect(notBuilt(sampleLevelId(1))).toBe(true);
    expect(notBuilt(sampleLevelId(0))).toBeUndefined();
    expect(scene).not.toEqual(standardSceneOf(sample).scene);
  });

  it('Codex P1 — mọi tầng chưa có tỷ lệ: cảnh trống nhưng vẫn mở (không báo lỗi nạp)', async () => {
    const sample = createSampleBuilding();
    scaleApi.sources = Object.fromEntries(sample.levels.map((level) => [level.id, 'project_default' as const]));
    const { result } = renderHook(() => usePascalProjectBridge('p1'));
    await waitFor(() => expect(result.current.status).toBe('ready'));

    let scene: Awaited<ReturnType<typeof result.current.onLoad>> | undefined;
    await act(async () => {
      scene = await result.current.onLoad();
    });
    const empty = withoutFloorContents(sample, new Set(sample.levels.map((level) => level.id)));
    expect(empty.levels).toHaveLength(sample.levels.length);
    expect([empty.walls, empty.openings, empty.rooms, empty.furniture].every((list) => list.length === 0)).toBe(true);
    expect(scene).toEqual(markNotBuilt(standardSceneOf(empty).scene, new Set(sample.levels.map((level) => level.id))));
  });
});

describe('withoutFloorContents', () => {
  it('bỏ tường, ô mở trên tường ấy, phòng, đồ, trục, kích thước, ghi chú của tầng; giữ tầng và tầng khác', () => {
    const sample = createSampleBuilding();
    const hidden = sampleLevelId(0);
    const graph = withoutFloorContents(sample, new Set([hidden]));
    const hiddenWalls = new Set(sample.walls.filter((wall) => wall.levelId === hidden).map((wall) => wall.id));

    expect(graph.levels).toEqual(sample.levels);
    expect(graph.walls).toEqual(sample.walls.filter((wall) => wall.levelId !== hidden));
    expect(graph.openings).toEqual(sample.openings.filter((opening) => !hiddenWalls.has(opening.wallId)));
    expect(graph.rooms.some((room) => room.levelId === hidden)).toBe(false);
    expect(graph.furniture.some((item) => item.levelId === hidden)).toBe(false);
    expect(graph.dimensions.some((item) => item.levelId === hidden)).toBe(false);
    expect(graph.axes.some((item) => item.levelId === hidden)).toBe(false);
    expect(graph.notes.some((note) => hiddenWalls.has(note.entityId as never))).toBe(false);
    expect(withoutFloorContents(sample, new Set())).toBe(sample);
  });
});

describe('undrawnFloorNames (U52)', () => {
  it('chỉ lấy tầng chưa có trong đồ thị, tầng cao ở trên', () => {
    const floors = [
      { id: 'a', name: 'Tầng 1', order: 0 },
      { id: 'b', name: 'Tầng 2', order: 1 },
      { id: 'c', name: 'Tầng 3', order: 2 },
    ];
    expect(undrawnFloorNames(floors, new Set(['a']))).toEqual(['Tầng 3', 'Tầng 2']);
    expect(undrawnFloorNames(floors, new Set(['a', 'b', 'c']))).toEqual([]);
  });
});

describe('drawnFloorIds (UX-32)', () => {
  it('counts a floor as drawn only when it has a wall or a room', () => {
    const drawn = drawnFloorIds({
      walls: [{ levelId: 'f0' }],
      rooms: [{ levelId: 'f1' }],
    } as unknown as Parameters<typeof drawnFloorIds>[0]);
    expect([...drawn].sort()).toEqual(['f0', 'f1']);
    expect(drawn.has('f2')).toBe(false);
  });
});
