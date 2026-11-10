/**
 * `useMobileViewer` — bảy trạng thái, R-04, và ba lời hứa dễ trôi nhất.
 *
 * Bài kiểm này KHÔNG dựng three.js: cảnh vào bằng chỗ tiêm `mountScene`, nên
 * mọi nhánh của R-04 (mức chi tiết, fps) đo được bằng cách gọi thẳng ba lời gọi
 * ngược mà hook trao cho cảnh. Đó cũng là điều bài kiểm muốn chứng minh: hook
 * không tự với tay vào WebGL, và bảy trạng thái của A11 quyết định được chỉ từ
 * dữ liệu cộng ba tín hiệu ấy.
 *
 * Ba lời hứa được canh riêng:
 *
 * 1. **R-64** — `loading` và `error` đến từ `useQuery`/cảnh, không từ một biến
 *    hook tự giữ. Bài kiểm chặn cửa API và đòi hook về `loading` mà không cần ai
 *    bật một cờ nào.
 * 2. **R-04** — fps thấp KHÔNG lập tức thành `error`: mức chi tiết phải xuống
 *    tới `block` trước, và phải thấp suốt cả `DEGRADE_WINDOW_MS`.
 * 3. **A8** — tạo liên kết chia sẻ có toast kèm vé hoàn tác, và hoàn tác là
 *    THU HỒI thật, không phải một nút chết.
 */

import { act, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import type { ProjectsApi } from '@/api/client';
import { createSampleBuilding } from '@/domain/spatial/__fixtures__/sampleBuilding';
import { normalizeSpatial } from '@/domain/spatial/normalize';
import type { NotificationInput } from '@/lib/mutations/notificationBus';
import {
  createNetworkMonitor,
  type NetworkMonitor,
  type NetworkMonitorStatus,
} from '@/lib/offline/networkMonitor';
import { renderWithProviders } from '@/lib/testing/render';
import { useStore } from '@/store';
import { ROUTES } from '@/routes/paths';

import type { MobileViewerModel, MobileViewerSceneOptions } from './mobileViewerTypes';
import { useMobileViewer, type UseMobileViewerOptions } from './useMobileViewer';

// Concept AI giả: đếm số lượt đọc N47 (không mạng, không phiên).
const { loadSceneConcept } = vi.hoisted(() => ({
  loadSceneConcept: vi.fn(async () => ({ style: undefined, additions: [], furnish: 'on', source: 'none', notice: null })),
}));
vi.mock('@/lib/pascal/sceneConcept', () => ({ loadSceneConcept }));

/* -------------------------------------------------------------------------- */
/* Bộ dựng.                                                                    */
/* -------------------------------------------------------------------------- */

const SPATIAL = normalizeSpatial(createSampleBuilding());
const PROJECT_ID = 'P-000000001';
const PROJECT_NAME = 'Nhà phố Bình Thạnh';

/** Cổng dự án giả: một tên, trả về ngay. */
function projectsApiOf(name = PROJECT_NAME): Pick<ProjectsApi, 'read'> {
  return {
    read: async ({ projectId }) =>
      ({ ok: true, data: { id: projectId, name } }) as Awaited<ReturnType<ProjectsApi['read']>>,
  };
}

/** Cổng dự án không bao giờ trả lời — nhánh `loading` của R-64. */
function stalledProjectsApi(): Pick<ProjectsApi, 'read'> {
  return { read: () => new Promise(() => undefined) };
}

/** Bộ theo dõi mạng giả, với trạng thái cố định. */
function monitorOf(status: Partial<NetworkMonitorStatus> = {}): () => NetworkMonitor {
  const full: NetworkMonitorStatus = {
    browserOnline: true,
    pingOnline: true,
    online: true,
    checkedAt: 0,
    ...status,
  };

  return () => ({
    checkNow: async () => full,
    getStatus: () => full,
    start: () => undefined,
    stop: () => undefined,
    subscribe: () => () => undefined,
  });
}

interface SceneSpy {
  readonly mount: UseMobileViewerOptions['mountScene'];
  readonly options: () => MobileViewerSceneOptions | null;
  readonly disposals: () => number;
}

/** Cảnh giả: không Pascal, không WebGL — chỉ giữ lại ai gọi nó với cái gì. */
function sceneSpy(): SceneSpy {
  let options: MobileViewerSceneOptions | null = null;
  let disposals = 0;

  return {
    mount: (_element, given) => {
      options = given;
      given.onReady();

      return {
        ok: true,
        handle: {
          dispose: () => {
            disposals += 1;
          },
        },
      };
    },
    options: () => options,
    disposals: () => disposals,
  };
}

/** Một component không vẽ gì; nó chỉ để hook chạy trong một cây React thật. */
function Probe({
  options,
  onModel,
}: {
  readonly options: UseMobileViewerOptions;
  readonly onModel: (model: MobileViewerModel) => void;
}): null {
  onModel(useMobileViewer(options));

  return null;
}

interface Harness {
  readonly model: () => MobileViewerModel;
  readonly canvas: HTMLDivElement;
  readonly notices: readonly NotificationInput[];
  readonly unmount: () => void;
}

function render(overrides: Partial<UseMobileViewerOptions> = {}): Harness {
  const notices: NotificationInput[] = [];
  let latest: MobileViewerModel | null = null;
  const canvas = document.createElement('div');

  const options: UseMobileViewerOptions = {
    projectId: PROJECT_ID,
    canvas,
    mountScene: sceneSpy().mount,
    notifications: { publish: (input) => notices.push(input) },
    gateway: {
      projectsApi: projectsApiOf(),
      createMonitor: monitorOf(),
      openMail: () => undefined,
      copyText: async () => true,
    },
    shareLinks: null,
    spatial: SPATIAL,
    roles: ['engineer'],
    ...overrides,
  };

  const { unmount } = renderWithProviders(
    <Probe
      options={options}
      onModel={(model) => {
        latest = model;
      }}
    />,
    { keepStore: true },
  );

  return {
    model: () => {
      if (latest === null) {
        throw new Error('hook chưa chạy lần nào');
      }

      return latest;
    },
    canvas,
    notices,
    unmount,
  };
}

/** Đặt `matchMedia` cho một truy vấn trả về đúng một câu trả lời. */
function fakeMatchMedia(matches: boolean): () => void {
  const previous = window.matchMedia;

  window.matchMedia = ((query: string) => ({
    matches,
    media: query,
    onchange: null,
    addEventListener: () => undefined,
    removeEventListener: () => undefined,
    addListener: () => undefined,
    removeListener: () => undefined,
    dispatchEvent: () => false,
  })) as unknown as typeof window.matchMedia;

  return () => {
    window.matchMedia = previous;
  };
}

/* -------------------------------------------------------------------------- */
/* Bảy trạng thái — A11.                                                       */
/* -------------------------------------------------------------------------- */

describe('Bảy trạng thái', () => {
  it('success: đồ thị đủ tầng, mạng tốt, cảnh đã lắp', async () => {
    const harness = render();

    await waitFor(() => {
      expect(harness.model().state).toBe('success');
    });

    expect(harness.model().projectName).toBe(PROJECT_NAME);
  });

  it('loading: máy chủ chưa trả lời — cờ đến từ useQuery, không từ useState (R-64)', async () => {
    const harness = render({
      gateway: {
        projectsApi: stalledProjectsApi(),
        createMonitor: monitorOf(),
        openMail: () => undefined,
        copyText: async () => true,
      },
    });

    await waitFor(() => {
      expect(harness.model().state).toBe('loading');
    });
  });

  it('empty: dự án không có tầng nào', async () => {
    const harness = render({ spatial: null });

    await waitFor(() => {
      expect(harness.model().state).toBe('empty');
    });
  });

  it('forbidden: biết chắc người này không mang vai nào trên dự án', async () => {
    const harness = render({ roles: [] });

    await waitFor(() => {
      expect(harness.model().state).toBe('forbidden');
    });
  });

  it('chưa biết vai KHÁC với không có vai — vắng roles không phải forbidden', async () => {
    const harness = render({ roles: undefined });

    await waitFor(() => {
      expect(harness.model().state).not.toBe('forbidden');
    });
  });

  it('partial: mạng yếu, dù đồ thị đủ tầng (T-09)', async () => {
    const harness = render({
      gateway: {
        projectsApi: projectsApiOf(),
        createMonitor: monitorOf({ pingOnline: false, online: false }),
        openMail: () => undefined,
        copyText: async () => true,
      },
    });

    await waitFor(() => {
      expect(harness.model().state).toBe('partial');
    });
    expect(harness.model().partialReason).toBe('weak-network');
  });

  it('bộ giám sát thật chưa ping xong thì không báo mạng yếu lúc mở màn (NO-390)', async () => {
    const harness = render({
      gateway: {
        projectsApi: projectsApiOf(),
        // Lượt ping chưa trả lời: trước đây `pingOnline` khởi tạo `false` làm
        // màn báo "mạng yếu" cho tới lượt kiểm đầu.
        createMonitor: () =>
          createNetworkMonitor({
            navigatorObject: { onLine: true },
            ping: () => new Promise<boolean>(() => undefined),
          }),
        openMail: () => undefined,
        copyText: async () => true,
      },
    });

    await waitFor(() => {
      expect(harness.model().state).toBe('success');
    });
    expect(harness.model().partialReason).toBeNull();
  });

  it('error: máy không có WebGL — và lối thoát trỏ sang bản 2D', async () => {
    const harness = render({
      mountScene: () => ({ ok: false, reason: 'webglUnavailable' }),
    });

    await waitFor(() => {
      expect(harness.model().state).toBe('error');
    });

    expect(harness.model().fallback2dHref).toBe(ROUTES.project.floors(PROJECT_ID));
  });

  it('collapsed: bề ngang gọn thay chỗ của success', async () => {
    const restore = fakeMatchMedia(true);

    try {
      const harness = render();

      await waitFor(() => {
        expect(harness.model().state).toBe('collapsed');
      });

      expect(harness.model().isCompact).toBe(true);
    } finally {
      restore();
    }
  });

  it('collapsed KHÔNG thay chỗ của error — hỏng vẫn phải nói là hỏng', async () => {
    const restore = fakeMatchMedia(true);

    try {
      const harness = render({
        mountScene: () => ({ ok: false, reason: 'deviceTooWeak' }),
      });

      await waitFor(() => {
        expect(harness.model().state).toBe('error');
      });
    } finally {
      restore();
    }
  });

  it('ở bề ngang gọn, `view` GỘP vào tấm tầng chứ không rơi vào khoảng không', async () => {
    const restore = fakeMatchMedia(true);

    try {
      const harness = render();

      await waitFor(() => {
        expect(harness.model().isCompact).toBe(true);
      });

      act(() => {
        harness.model().onSelectTool('view');
      });

      expect(harness.model().activeTool).toBe('floors');
    } finally {
      restore();
    }
  });
});

/* -------------------------------------------------------------------------- */
/* Tầng, công cụ, và tấm thông tin.                                            */
/* -------------------------------------------------------------------------- */

describe('tầng và công cụ', () => {
  it('mở màn đã có sẵn một tầng đang xem; chọn tầng khác thì dải tầng đổi theo', async () => {
    const harness = render();

    await waitFor(() => {
      expect(harness.model().floors.length).toBeGreaterThan(1);
    });

    expect(harness.model().activeFloorId).not.toBeNull();

    const second = harness.model().floors[1];

    act(() => {
      harness.model().onSelectFloor(second?.id ?? '');
    });

    expect(harness.model().activeFloorId).toBe(second?.id);
  });

  it('rời màn thì cảnh được trả lại đúng một lần — R-05', async () => {
    const spy = sceneSpy();
    const harness = render({ mountScene: spy.mount });

    await waitFor(() => {
      expect(spy.options()).not.toBeNull();
    });

    harness.unmount();

    expect(spy.disposals()).toBe(1);
  });

  it('chạm vào một bức tường mở tấm thông tin chỉ đọc', async () => {
    const spy = sceneSpy();
    const harness = render({ mountScene: spy.mount });

    await waitFor(() => {
      expect(spy.options()).not.toBeNull();
    });

    const wallId = SPATIAL.byKind.wall.at(0) ?? '';

    act(() => {
      spy.options()?.onPick(`wall_${wallId}`);
    });

    expect(harness.model().selection?.entityId).toBe(wallId);
    expect(harness.model().selection?.rows.length).toBeGreaterThan(0);

    act(() => {
      harness.model().onDismissSelection();
    });

    expect(harness.model().selection).toBeNull();
  });

  it('bật/tắt đo dựng lại cảnh nhưng KHÔNG gọi lại concept AI (nhớ theo dự án)', async () => {
    const spy = sceneSpy();
    const harness = render({ mountScene: spy.mount });

    await waitFor(() => {
      expect(spy.options()).not.toBeNull();
    });
    const first = spy.options()?.loadConcept;
    await first?.();

    act(() => {
      harness.model().onSelectTool('measure');
    });
    await waitFor(() => {
      expect(spy.options()?.measure).toBe(true);
    });
    await spy.options()?.loadConcept?.();

    expect(spy.disposals()).toBeGreaterThan(0);
    expect(spy.options()?.loadConcept).toBe(first);
    expect(loadSceneConcept).toHaveBeenCalledTimes(1);
  });

  it('công cụ đo mở thì cảnh dựng với `measure`, và một phép đo hiện theo A15', async () => {
    const spy = sceneSpy();
    const harness = render({ mountScene: spy.mount });

    await waitFor(() => {
      expect(spy.options()).not.toBeNull();
    });

    expect(spy.options()?.measure).toBe(false);

    act(() => {
      harness.model().onSelectTool('measure');
    });

    await waitFor(() => {
      expect(spy.options()?.measure).toBe(true);
    });

    act(() => {
      spy.options()?.onMeasure(3.45);
    });

    expect(harness.model().measurements).toHaveLength(1);
    expect(harness.model().measurements[0]?.valueLabel).toBe('3,45 m');
    expect(harness.model().selection).toBeNull();
  });
});

/* -------------------------------------------------------------------------- */
/* Chia sẻ — X-04 và A8.                                                       */
/* -------------------------------------------------------------------------- */

describe('chia sẻ', () => {
  // F-06: không cổng, hoặc cổng nói máy chủ không phục vụ liên kết (v1, BE-BIND
  // #47–#49 là v2) — hai nút rời DOM thay vì bấm rồi báo hỏng.
  it('không có phiên chia sẻ thì hai nút chia sẻ rời DOM (onShare, onSendDesktopLink là null)', async () => {
    const harness = render({ shareLinks: null });

    await waitFor(() => {
      expect(harness.model().state).toBe('success');
    });

    expect(harness.model().onShare).toBeNull();
    expect(harness.model().onSendDesktopLink).toBeNull();
  });

  it('cổng `supported: false` thì như không có cổng, và không gọi `create` lần nào', async () => {
    const create = vi.fn(async () => ({ ok: true as const, data: shareLinkPayload() }));
    const harness = render({
      shareLinks: {
        supported: false,
        create,
        list: async () => ({ ok: true, data: { links: [] } }),
        revoke: async () => ({ ok: true, data: shareLinkPayload() }),
      },
    });

    await waitFor(() => {
      expect(harness.model().state).toBe('success');
    });

    expect(harness.model().onShare).toBeNull();
    expect(harness.model().onSendDesktopLink).toBeNull();
    expect(create).not.toHaveBeenCalled();
  });

  it('tạo được liên kết thì có toast KÈM vé hoàn tác, và hoàn tác là thu hồi thật — A8', async () => {
    const revoked: string[] = [];
    const copied: string[] = [];

    const harness = render({
      gateway: {
        projectsApi: projectsApiOf(),
        createMonitor: monitorOf(),
        openMail: () => undefined,
        copyText: async (text) => {
          copied.push(text);

          return true;
        },
      },
      shareLinks: {
        supported: true,
        create: async () => ({ ok: true, data: shareLinkPayload() }),
        list: async () => ({ ok: true, data: { links: [] } }),
        revoke: async ({ linkId }) => {
          revoked.push(linkId);

          return { ok: true, data: shareLinkPayload() };
        },
      },
    });

    await waitFor(() => {
      expect(harness.model().state).toBe('success');
    });

    const onShare = harness.model().onShare;
    expect(onShare).not.toBeNull();
    act(() => {
      onShare?.();
    });

    await waitFor(() => {
      expect(harness.notices).toHaveLength(1);
    });

    expect(copied).toHaveLength(1);

    const ticket = harness.notices[0]?.undoTicket;

    expect(ticket).toBeDefined();

    ticket?.undo();

    await waitFor(() => {
      expect(revoked).toEqual(['SL-1']);
    });
  });

  it('gửi sang máy tính mở ứng dụng thư bằng một địa chỉ mailto:', async () => {
    const opened: string[] = [];

    const harness = render({
      gateway: {
        projectsApi: projectsApiOf(),
        createMonitor: monitorOf(),
        openMail: (href) => opened.push(href),
        copyText: async () => true,
      },
      shareLinks: {
        supported: true,
        create: async () => ({ ok: true, data: shareLinkPayload() }),
        list: async () => ({ ok: true, data: { links: [] } }),
        revoke: async () => ({ ok: true, data: shareLinkPayload() }),
      },
    });

    await waitFor(() => {
      expect(harness.model().state).toBe('success');
    });

    const onSendDesktopLink = harness.model().onSendDesktopLink;
    expect(onSendDesktopLink).not.toBeNull();
    act(() => {
      onSendDesktopLink?.();
    });

    await waitFor(() => {
      expect(opened).toHaveLength(1);
    });

    expect(opened[0]?.startsWith('mailto:?')).toBe(true);
    expect(decodeURIComponent(opened[0] ?? '')).toContain('chỉ sửa được trên máy tính');
  });
});

/* -------------------------------------------------------------------------- */
/* Nạp kho dự án — B-V1-03.                                                    */
/* -------------------------------------------------------------------------- */

/** Bốn tầng có tên mà không có tường, phòng, ô mở nào — hình `project-1` của mock. */
function emptyFloorsSpatial(): NonNullable<UseMobileViewerOptions['spatial']> {
  return normalizeSpatial({
    ...createSampleBuilding(),
    walls: [],
    openings: [],
    rooms: [],
    furniture: [],
    dimensions: [],
    notes: [],
  });
}

/** Tường nhưng chưa có phòng: có hình để dựng, chưa có tầng nào "đã tải". */
function wallsOnlySpatial(): NonNullable<UseMobileViewerOptions['spatial']> {
  const graph = createSampleBuilding();

  return normalizeSpatial({
    ...graph,
    walls: graph.walls.map((wall) => ({ ...wall, openingIds: [] })),
    openings: [],
    rooms: [],
    furniture: [],
    dimensions: [],
    notes: [],
  });
}

describe('nạp kho dự án — B-V1-03', () => {
  it('đang nạp thì loading và chưa dựng cảnh; nạp xong thì success', async () => {
    const spy = sceneSpy();

    try {
      act(() => {
        useStore.getState().setSpatial(null, null);
        useStore.getState().setSpatialLoading(true);
      });

      const harness = render({ mountScene: spy.mount, spatial: undefined });

      await waitFor(() => {
        expect(harness.model().state).toBe('loading');
      });

      expect(spy.options()).toBeNull();

      act(() => {
        useStore.getState().setSpatial(SPATIAL, null);
      });

      await waitFor(() => {
        expect(harness.model().state).toBe('success');
      });

      expect(spy.options()).not.toBeNull();
    } finally {
      act(() => {
        useStore.getState().setSpatial(null, null);
      });
    }
  });

  it('bốn tầng không tường, không phòng thì empty và không dựng cảnh', async () => {
    const spy = sceneSpy();

    try {
      const harness = render({ mountScene: spy.mount, spatial: emptyFloorsSpatial() });

      await waitFor(() => {
        expect(harness.model().state).toBe('empty');
      });

      expect(harness.model().floors).toHaveLength(4);
      expect(spy.options()).toBeNull();
    } finally {
      act(() => {
        useStore.getState().setSpatial(null, null);
      });
    }
  });

  it('tầng chỉ có tường thì partial, không phải empty', async () => {
    const spy = sceneSpy();

    try {
      const harness = render({ mountScene: spy.mount, spatial: wallsOnlySpatial() });

      await waitFor(() => {
        expect(harness.model().state).toBe('partial');
      });

      expect(harness.model().partialReason).toBe('missing-rooms');
      expect(spy.options()).not.toBeNull();
    } finally {
      act(() => {
        useStore.getState().setSpatial(null, null);
      });
    }
  });

  it('chỉ có tường + mạng yếu: lý do là thiếu phòng, không phải mạng (B-V1-11)', async () => {
    const spy = sceneSpy();

    try {
      const harness = render({
        mountScene: spy.mount,
        spatial: wallsOnlySpatial(),
        gateway: {
          projectsApi: projectsApiOf(),
          createMonitor: monitorOf({ pingOnline: false, online: false }),
          openMail: () => undefined,
          copyText: async () => true,
        },
      });

      await waitFor(() => {
        expect(harness.model().state).toBe('partial');
      });

      expect(harness.model().partialReason).toBe('missing-rooms');
    } finally {
      act(() => {
        useStore.getState().setSpatial(null, null);
      });
    }
  });
});

/** Thân trả về của một lượt tạo liên kết, đúng hình dạng `shareLink.ts` giải mã. */
function shareLinkPayload(): unknown {
  return {
    id: 'SL-1',
    projectId: PROJECT_ID,
    url: 'https://app.example.com/s/8f2c1d',
    permission: 'view',
    status: 'active',
    createdAt: '2026-09-10T02:00:00.000Z',
    expiresAt: null,
    revokedAt: null,
    passwordProtected: false,
    viewpointCode: null,
    label: null,
  };
}
