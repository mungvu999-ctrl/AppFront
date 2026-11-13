/**
 * Nửa "suy nghĩ" của màn S-17 "Duyệt tên phòng", kiểm không cần DOM.
 *
 * Hook được lái qua `renderHook`; tầng dữ liệu là
 * `createMockRoomLabelReviewGateway()` — CÙNG cổng story sẽ dùng (R-73) — và
 * mọi con số khẳng định đọc ra từ `roomLabelFixture.ts` /
 * `roomLabelReviewScenarios.ts`, không có bảng dữ liệu thứ hai bịa tại chỗ
 * (R-70).
 *
 * ## Năm phép kiểm đặc tả gọi tên
 *
 * 1. tổng diện tích ra ĐÚNG `248,60 m²` và phòng `#R-005` ra ĐÚNG `18,40 m²`;
 * 2. "Chuẩn hoá tên" sinh bảng xem trước và KHÔNG đổi một tên nào trước khi
 *    xác nhận;
 * 3. áp chuẩn hoá xong thì có vé hoàn tác, và hoàn tác trả lại đúng tên cũ;
 * 4. nhắc công năng M-14 không chặn thao tác nào;
 * 5. vòng hở được liệt kê KÈM kích thước.
 *
 * Cộng thêm hai phép kiểm của những lời hứa dễ trôi nhất: bảy trạng thái đủ
 * bảy nhánh, và **đổi tên KHÔNG tính lại diện tích** — khẳng định bằng ĐỒNG
 * NHẤT THAM CHIẾU (`toBe`) trên `labelAnchorMm`, thứ chỉ đúng khi `measureRoom`
 * không chạy lại.
 */

import { createElement, type ReactNode } from 'react';
import { QueryClientProvider } from '@tanstack/react-query';
import { act, cleanup, renderHook, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { __resetMockLayerState, createMockApiClient, simulateRemoteLayerEdit } from '@/api/__mocks__/client';
import { normalizeSpatial } from '@/domain/spatial/normalize';
import type { Level, Room, RoomId, Wall, WallId } from '@/domain/spatial/types';
import { millimetresPerPixel, scaleFromRatio } from '@/domain/units/scale';
import { millimetres, squareMetres } from '@/domain/units/types';
import { formatArea, formatLength } from '@/lib/format/measure';
import { __resetFloorLayerSavers, flushAutosaves } from '@/hooks/useAutosave';
import { createShortcutRegistry } from '@/lib/input/shortcutRegistry';
import { createNotificationBus, type NotificationBus } from '@/lib/mutations/notificationBus';
import { createTestQueryClient } from '@/lib/testing/render';
import { SEVEN_STATES } from '@/lib/testing/sevenStateScenarios';
import { ROUTES } from '@/routes/paths';
import { resetSelectorCaches } from '@/store/selectors';
import { useStore } from '@/store';

import {
  ROOM_LABEL_FIXTURE_BUILDING,
  ROOM_LABEL_FIXTURE_LEVEL,
  ROOM_LABEL_FIXTURE_ROOMS,
  ROOM_LABEL_FIXTURE_ROOMS_UNNAMED,
  ROOM_LABEL_FIXTURE_ROOM_R005,
  ROOM_LABEL_FIXTURE_TOTAL,
  ROOM_LABEL_FIXTURE_TOTAL_AREA_M2,
  ROOM_LABEL_FIXTURE_UNNAMED_COUNT,
} from './roomLabelFixture';
import {
  approveConfidentRoomsLabelOf,
  canonicalRoomName,
  confidentRoomsOf,
  scaleSegmentOf,
  createMockRoomLabelReviewGateway,
  hasRoomName,
  measureRoom,
  provisionalMeasureText,
  roomCodeLabel,
  roomsSpillingOutside,
  ROOM_LABEL_TEXT,
  ROOM_NAME_TARGETS,
  ROOM_NORMALIZE_COMMAND_TYPE,
  usageOfRoomName,
} from './roomLabelReviewGateway';
import {
  ROOM_LABEL_REVIEW_SCENARIOS,
  ROOM_LABEL_SCENARIO_COLLAPSED,
  ROOM_LABEL_SCENARIO_EMPTY,
  ROOM_LABEL_SCENARIO_ERROR,
  ROOM_LABEL_SCENARIO_FORBIDDEN,
  ROOM_LABEL_SCENARIO_GAP_MM,
  ROOM_LABEL_SCENARIO_GAP_WALLS,
  ROOM_LABEL_SCENARIO_PARTIAL,
  ROOM_LABEL_SCENARIO_SUCCESS,
  type RoomLabelReviewScenario,
} from './roomLabelReviewScenarios';
import {
  applyUnnamedFilter,
  areaCaptionOf,
  deriveRoomLabelScreenState,
  mergeCandidatesOf,
  outlineKeyOf,
  useRoomLabelReview,
  type UseRoomLabelReviewOptions,
  type UseRoomLabelReviewResult,
} from './useRoomLabelReview';

/* -------------------------------------------------------------------------- */
/* Bộ mẫu — đọc ra, không viết tay lại.                                        */
/* -------------------------------------------------------------------------- */

const PROJECT_ID = 'project-1';
const FIXTURE_LEVEL: Level = ROOM_LABEL_FIXTURE_LEVEL;
const FLOOR_ID = FIXTURE_LEVEL.id;

/** Đồ thị của một kịch bản, dựng đúng cách kho dựng nó. */
const graphOf = (rooms: readonly Room[], walls: readonly Wall[]): ReturnType<typeof normalizeSpatial> =>
  normalizeSpatial({
    building: ROOM_LABEL_FIXTURE_BUILDING,
    levels: [FIXTURE_LEVEL],
    walls: [...walls],
    openings: [],
    furniture: [],
    rooms: [...rooms],
    axes: [],
    dimensions: [],
    notes: [],
  });

const graphOfScenario = (scenario: RoomLabelReviewScenario): ReturnType<typeof normalizeSpatial> =>
  graphOf(scenario.rooms, scenario.walls);

/** Mã phòng `#R-005` — ví dụ nghiệm thu của đặc tả. */
const ROOM_R005: Room = ROOM_LABEL_FIXTURE_ROOM_R005 as Room;

/* -------------------------------------------------------------------------- */
/* Môi trường.                                                                 */
/* -------------------------------------------------------------------------- */

beforeEach(() => {
  /* Bộ lưu lớp và revision mock sống cấp module — mỗi bài kiểm bắt đầu sạch. */
  __resetFloorLayerSavers();
  __resetMockLayerState();
  /* jsdom không có `matchMedia`; `matches: false` là "không giảm chuyển động". */
  Object.defineProperty(window, 'matchMedia', {
    writable: true,
    value: vi.fn().mockImplementation((query: string) => ({
      matches: false,
      media: query,
      onchange: null,
      addListener: vi.fn(),
      removeListener: vi.fn(),
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      dispatchEvent: vi.fn(),
    })),
  });
});

afterEach(() => {
  cleanup();
  /* Kho dùng chung giữa các bài kiểm: trả nó về rỗng qua ĐÚNG hành động công khai. */
  const store = useStore.getState();
  store.setSpatial(null, null);
  store.clearSelection();
  store.setHovered(null);
  resetSelectorCaches();
  vi.useRealTimers();
  vi.restoreAllMocks();
});

/* -------------------------------------------------------------------------- */
/* Dựng hook.                                                                  */
/* -------------------------------------------------------------------------- */

interface Mounted {
  readonly result: { current: UseRoomLabelReviewResult };
  readonly unmount: () => void;
}

type MountOptions = Partial<UseRoomLabelReviewOptions>;

function mountHook(options: MountOptions = {}): Mounted {
  const queryClient = createTestQueryClient();
  const wrapper = ({ children }: { children: ReactNode }): ReactNode =>
    createElement(QueryClientProvider, { client: queryClient }, children);

  const rendered = renderHook(
    () =>
      useRoomLabelReview({
        projectId: options.projectId ?? PROJECT_ID,
        floorId: options.floorId ?? FLOOR_ID,
        roles: options.roles ?? ['engineer'],
        gateway:
          options.gateway ??
          createMockRoomLabelReviewGateway({
            graph: graphOf(ROOM_LABEL_FIXTURE_ROOMS_UNNAMED, []),
          }),
        ...(options.notifications === undefined ? {} : { notifications: options.notifications }),
        ...(options.onNavigate === undefined ? {} : { onNavigate: options.onNavigate }),
        ...(options.levelId === undefined ? {} : { levelId: options.levelId }),
        ...(options.forceCollapsed === undefined ? {} : { forceCollapsed: options.forceCollapsed }),
        ...(options.forceCompact === undefined ? {} : { forceCompact: options.forceCompact }),
        ...(options.shortcutRegistry === undefined ? {} : { shortcutRegistry: options.shortcutRegistry }),
      }),
    { wrapper },
  );

  return { result: rendered.result, unmount: rendered.unmount };
}

/** Chờ lượt đọc lớp phòng xong — trước đó mọi kịch bản đều là `'loading'`. */
async function mountSettled(options: MountOptions = {}): Promise<Mounted> {
  const mounted = mountHook(options);

  await waitFor(() => {
    expect(mounted.result.current.state).not.toBe('loading');
  });

  return mounted;
}

/** Dựng hook trên đúng một kịch bản của bảy. */
async function mountScenario(scenario: RoomLabelReviewScenario): Promise<Mounted> {
  return mountSettled({
    roles: scenario.isViewerRole ? ['viewer'] : ['engineer'],
    forceCollapsed: scenario.isCollapsed,
    gateway: createMockRoomLabelReviewGateway({
      graph: graphOfScenario(scenario),
      failReadRoomLayer: scenario.error !== null,
      ...(scenario.backgroundImageUrl === null ? { withoutImage: true } : {}),
    }),
  });
}

/** Một dòng phòng của kết quả, đọc ra chứ không đoán chỉ số. */
const rowOf = (mounted: Mounted, roomId: RoomId): UseRoomLabelReviewResult['rooms'][number] => {
  const row = mounted.result.current.rooms.find((entry) => entry.id === roomId);

  expect(row).toBeDefined();

  return row as UseRoomLabelReviewResult['rooms'][number];
};

/** Tên hiện tại của một phòng, đọc THẲNG từ kho — không qua viewmodel. */
const nameInStore = (roomId: RoomId): string => {
  const graph = useStore.getState().spatial;
  const room = graph === null ? undefined : (graph.byId[roomId] as Room | undefined);

  return room?.name ?? '';
};

/* -------------------------------------------------------------------------- */
/* Phép ghép thuần — kiểm được mà không cần dựng hook.                          */
/* -------------------------------------------------------------------------- */

describe('phép ghép thuần của màn Duyệt tên phòng', () => {
  it('chữ ký hình học không đổi khi chỉ đổi tên', () => {
    const renamed: Room = { ...ROOM_R005, name: 'phòng ngủ chính' };

    expect(outlineKeyOf(renamed)).toBe(outlineKeyOf(ROOM_R005));
  });

  it('chữ ký hình học ĐỔI khi ranh phòng đổi', () => {
    const first = ROOM_R005.outline[0];
    const moved: Room = {
      ...ROOM_R005,
      outline: [{ x: (first?.x ?? 0) + 1, y: first?.y ?? 0 }, ...ROOM_R005.outline.slice(1)],
    };

    expect(outlineKeyOf(moved)).not.toBe(outlineKeyOf(ROOM_R005));
  });

  it('bảy trạng thái đi đúng thứ tự ưu tiên', () => {
    const base = {
      isViewerRole: false,
      isCollapsed: false,
      hasError: false,
      isLoading: false,
      visibleRooms: [],
      unnamedCount: 0,
    } as const;

    expect(deriveRoomLabelScreenState({ ...base, isViewerRole: true })).toBe('forbidden');
    expect(deriveRoomLabelScreenState({ ...base, isCollapsed: true })).toBe('collapsed');
    expect(deriveRoomLabelScreenState({ ...base, hasError: true })).toBe('error');
    expect(deriveRoomLabelScreenState({ ...base, isLoading: true })).toBe('loading');
    expect(deriveRoomLabelScreenState(base)).toBe('empty');
  });

  it('danh sách gộp bỏ chính phòng đang chọn', () => {
    const candidates = mergeCandidatesOf(ROOM_LABEL_FIXTURE_ROOMS, ROOM_R005.id);

    expect(candidates).toHaveLength(ROOM_LABEL_FIXTURE_TOTAL - 1);
    expect(candidates.some((entry) => entry.id === ROOM_R005.id)).toBe(false);
    expect(candidates[0]?.codeLabel).toBe(roomCodeLabel(candidates[0]?.id as RoomId));
  });

  it('[BUG-408] câu giải thích diện tích bằng lời thường, không lộ công thức dây giày', () => {
    expect(areaCaptionOf(null)).toBe('');
    expect(areaCaptionOf(ROOM_R005)).toBe('Diện tích tính theo tim tường của ranh phòng.');
    // BENCH3D-11: có thông thuỷ thì chú giải nói số nào là số nào.
    expect(areaCaptionOf({ ...ROOM_R005, clearAreaM2: squareMetres(1) })).toMatch(/^Số chính là diện tích thông thuỷ/u);
    expect(areaCaptionOf(ROOM_R005)).not.toMatch(/dây giày|x1 × y2/u);
  });

  it('bộ lọc "Chưa đặt tên" giữ đúng số phòng trống tên', () => {
    const rows = ROOM_LABEL_FIXTURE_ROOMS_UNNAMED.map((room) => ({
      hasName: room.name.trim() !== '',
    })) as unknown as readonly UseRoomLabelReviewResult['rooms'][number][];

    expect(applyUnnamedFilter(rows, true)).toHaveLength(ROOM_LABEL_FIXTURE_UNNAMED_COUNT);
    expect(applyUnnamedFilter(rows, false)).toHaveLength(ROOM_LABEL_FIXTURE_TOTAL);
  });
});

/* -------------------------------------------------------------------------- */
/* 1. Hai con số nghiệm thu của đặc tả.                                        */
/* -------------------------------------------------------------------------- */

describe('diện tích — M-07 tính, màn chỉ đọc', () => {
  it('tổng diện tích ra 248,60 m² và #R-005 ra 18,40 m²', async () => {
    const mounted = await mountSettled();

    const total = mounted.result.current.summary.totalAreaText;
    const r005 = rowOf(mounted, ROOM_R005.id).areaText;

    /* In ra số THẬT: một lượt xanh mà không ai đọc được con số thì chứng minh ít. */
    console.log(`[S-17] tổng diện tích = ${total} · #R-005 = ${r005}`);

    expect(total).toBe(formatArea(ROOM_LABEL_FIXTURE_TOTAL_AREA_M2));
    expect(total).toBe('248,60 m²');
    expect(r005).toBe(formatArea(ROOM_R005.areaM2));
    expect(r005).toBe('18,40 m²');
    expect(mounted.result.current.summary.roomCount).toBe(ROOM_LABEL_FIXTURE_TOTAL);
    expect(mounted.result.current.summary.unnamedCount).toBe(ROOM_LABEL_FIXTURE_UNNAMED_COUNT);
  });

  it('đổi tên KHÔNG tính lại diện tích', async () => {
    const mounted = await mountSettled();

    const before = rowOf(mounted, ROOM_R005.id);
    const anchorBefore = before.labelAnchorMm;
    const areaBefore = before.areaText;

    await act(async () => {
      mounted.result.current.onRename(ROOM_R005.id, 'phòng ngủ chính');
      await Promise.resolve();
    });

    await waitFor(() => {
      expect(nameInStore(ROOM_R005.id)).toBe('phòng ngủ chính');
    });

    const after = rowOf(mounted, ROOM_R005.id);

    /* ĐỒNG NHẤT THAM CHIẾU: chỉ đúng khi `measureRoom` không chạy lại. */
    expect(after.labelAnchorMm).toBe(anchorBefore);
    expect(after.areaText).toBe(areaBefore);
  });
});

describe('đặt tên là nhãn công năng thì công năng đổi theo (U44)', () => {
  it('đặt "Phòng tắm" → công năng "bathroom"; tên tự do không đổi công năng', async () => {
    const mounted = await mountSettled();
    const usageBefore = rowOf(mounted, ROOM_R005.id).usage;

    await act(async () => {
      mounted.result.current.onRename(ROOM_R005.id, 'tên tự do');
      await Promise.resolve();
    });
    await waitFor(() => {
      expect(nameInStore(ROOM_R005.id)).toBe('tên tự do');
    });
    expect(rowOf(mounted, ROOM_R005.id).usage).toBe(usageBefore);

    await act(async () => {
      mounted.result.current.onRename(ROOM_R005.id, 'Phòng tắm');
      await Promise.resolve();
    });
    await waitFor(() => {
      expect(rowOf(mounted, ROOM_R005.id).usage).toBe('bathroom');
    });
    expect(nameInStore(ROOM_R005.id)).toBe('Phòng tắm');
  });

  it('usageOfRoomName khớp nhãn không phân biệt hoa thường, tên tự do → null', () => {
    expect(usageOfRoomName(' phòng tắm ')).toBe('bathroom');
    expect(usageOfRoomName('Bếp')).toBe('kitchen');
    expect(usageOfRoomName('Phòng ngủ chính')).toBeNull();
  });
});

describe('hoàn tác trả lại vùng chọn LÚC LỆNH CHẠY (B-V7-09, A8)', () => {
  it('chọn phòng khác rồi chọn #R-005, đổi tên, hoàn tác bằng vé: #R-005 vẫn đang chọn', async () => {
    const notifications: NotificationBus = createNotificationBus();
    const mounted = await mountSettled({ notifications });
    const other = ROOM_LABEL_FIXTURE_ROOMS.find((room) => room.id !== ROOM_R005.id);

    act(() => {
      mounted.result.current.onSelect(other?.id as RoomId);
    });
    act(() => {
      mounted.result.current.onSelect(ROOM_R005.id);
    });

    await act(async () => {
      mounted.result.current.onRename(ROOM_R005.id, 'phòng ngủ chính');
      await Promise.resolve();
    });

    await waitFor(() => {
      expect(nameInStore(ROOM_R005.id)).toBe('phòng ngủ chính');
    });

    await act(async () => {
      notifications.list()[0]?.undoTicket?.undo();
      await Promise.resolve();
    });

    await waitFor(() => {
      expect(nameInStore(ROOM_R005.id)).toBe(ROOM_R005.name);
    });
    /* Trước bản sửa: vùng chọn trước lần bấm gần nhất — phòng kia, thanh tra #R-005 đóng. */
    expect(useStore.getState().selectedIds).toEqual([ROOM_R005.id]);
  });
});

describe('P04 cụm C — hoàn tác và duyệt (SCR-20)', () => {
  it('[BUG-582] Mod+Z hoàn tác bằng ngăn xếp của chính màn, như nút "Hoàn tác"', async () => {
    const shortcutRegistry = createShortcutRegistry();
    const mounted = await mountSettled({ shortcutRegistry });

    await act(async () => {
      mounted.result.current.onRename(ROOM_R005.id, 'phòng ngủ chính');
      await Promise.resolve();
    });
    await waitFor(() => {
      expect(nameInStore(ROOM_R005.id)).toBe('phòng ngủ chính');
    });

    await act(async () => {
      shortcutRegistry.handleKeyDown({ key: 'z', ctrlKey: true }, null);
      await Promise.resolve();
    });

    expect(nameInStore(ROOM_R005.id)).toBe(ROOM_R005.name);
  });

  it('[BUG-579] "Hoàn tác" trên toast cũ không lùi bước của lệnh sau', async () => {
    const notifications: NotificationBus = createNotificationBus({ groupWindowMs: 0 });
    const mounted = await mountSettled({ notifications });
    const other = ROOM_LABEL_FIXTURE_ROOMS.find((room) => room.id !== ROOM_R005.id && room.name !== '') as Room;

    await act(async () => {
      mounted.result.current.onRename(ROOM_R005.id, 'phòng ngủ chính');
      await Promise.resolve();
    });
    await act(async () => {
      mounted.result.current.onChangeUsage(other.id, 'kitchen');
      await Promise.resolve();
    });
    await waitFor(() => {
      expect(rowOf(mounted, other.id).usage).toBe('kitchen');
    });

    const renameTicket = notifications.list().find((entry) => entry.type !== 'roomLabelReview.undoRefused')?.undoTicket;

    await act(async () => {
      renameTicket?.undo();
      await Promise.resolve();
    });

    expect(rowOf(mounted, other.id).usage).toBe('kitchen');
    expect(nameInStore(ROOM_R005.id)).toBe('phòng ngủ chính');
  });

  it('[BUG-602] duyệt phòng chưa đặt tên không ghi gì', async () => {
    const mounted = await mountSettled();
    const unnamed = mounted.result.current.rooms.find((row) => row.status === 'unnamed');

    expect(unnamed).toBeDefined();

    await act(async () => {
      mounted.result.current.onApprove(unnamed?.id as RoomId);
      await Promise.resolve();
    });

    const graph = useStore.getState().spatial;

    expect((graph?.byId[unnamed?.id as RoomId] as Room | undefined)?.reviewed).toBe(false);
  });
});

describe('lệnh bị từ chối phải nói ra vì sao (B-V7-08)', () => {
  it('gộp khi chưa đọc được tường: toast nói lý do, không phòng nào mất', async () => {
    const notifications: NotificationBus = createNotificationBus();
    const mounted = await mountSettled({ notifications });
    const [target, absorbed] = ROOM_LABEL_FIXTURE_ROOMS;

    await act(async () => {
      mounted.result.current.onMerge(target?.id as RoomId, absorbed?.id as RoomId);
      await Promise.resolve();
    });

    await waitFor(() => {
      expect(notifications.list()).toHaveLength(1);
    });

    const [refusal] = notifications.list();

    /* Bộ mẫu không kèm tường, nên lý do là câu "chưa đọc được đồ thị tường" của cổng. */
    expect(refusal?.title).toBe(ROOM_LABEL_TEXT.wallsNotReadable);
    expect(refusal?.undoTicket).toBeUndefined();
    expect(mounted.result.current.rooms).toHaveLength(ROOM_LABEL_FIXTURE_TOTAL);
  });

  it('[BUG-605] toast bảo "Sang lớp tường" có nút đi tới lớp tường', async () => {
    const notifications: NotificationBus = createNotificationBus();
    const onNavigate = vi.fn();
    const mounted = await mountSettled({ notifications, onNavigate });
    const [target, absorbed] = ROOM_LABEL_FIXTURE_ROOMS;

    await act(async () => {
      mounted.result.current.onMerge(target?.id as RoomId, absorbed?.id as RoomId);
      await Promise.resolve();
    });
    await waitFor(() => {
      expect(notifications.list()).toHaveLength(1);
    });

    const action = notifications.list()[0]?.action;

    expect(action?.label).toBe('Sang lớp tường');
    act(() => {
      action?.onClick();
    });

    expect(onNavigate).toHaveBeenCalledWith(ROUTES.project.walls(PROJECT_ID, FLOOR_ID));
  });
});

/*
 * Đổi vì bộ lưu mới (F-04x-1): cổng không còn `persistRoomLabels`; lượt lưu đi qua
 * `useFloorLayerAutosave` với client cổng lộ ra, nên bài kiểm rình `writeLayer`.
 */
describe('tự lưu — Ctrl+S với tới màn này (B-V7-01, F-04x-1)', () => {
  /* #35 từ chối phòng tên rỗng (`FloorLayerWriteSchema`) — bộ mẫu có phòng chưa tên, nên đặt tên tạm cho chúng. */
  const namedRooms = ROOM_LABEL_FIXTURE_ROOMS.map((room, index) =>
    room.name.trim() === '' ? { ...room, name: `Phòng ${String(index + 1)}` } : room,
  );
  const savingGateway = () => {
    const apiClient = createMockApiClient();
    const gateway = createMockRoomLabelReviewGateway({ apiClient, graph: graphOf(namedRooms, []) });

    return { gateway, writeLayer: vi.spyOn(apiClient.spatial, 'writeLayer') };
  };

  const renameR005 = async (mounted: Awaited<ReturnType<typeof mountSettled>>): Promise<void> => {
    await act(async () => {
      mounted.result.current.onRename(ROOM_R005.id, 'phòng ngủ chính');
      await Promise.resolve();
    });
    await waitFor(() => {
      expect(nameInStore(ROOM_R005.id)).toBe('phòng ngủ chính');
    });
  };

  it('flushAutosaves lưu NGAY, không đợi cửa sổ 800 ms của A7', async () => {
    const { gateway, writeLayer } = savingGateway();
    const mounted = await mountSettled({ gateway });

    await renameR005(mounted);

    /* Còn trong cửa sổ 800 ms: chưa lượt lưu nào. */
    expect(writeLayer).not.toHaveBeenCalled();

    /* Đúng thứ `SAVE_SHORTCUT` của `router.tsx` gọi. */
    await act(async () => {
      await flushAutosaves();
    });

    expect(writeLayer).toHaveBeenCalledTimes(1);
  });

  it('tháo màn khi chưa sửa gì — Ctrl+S ở màn sau không gửi gì', async () => {
    const { gateway, writeLayer } = savingGateway();
    const mounted = await mountSettled({ gateway });

    mounted.unmount();
    await act(async () => {
      await flushAutosaves();
    });

    expect(writeLayer).not.toHaveBeenCalled();
  });

  it('409 → dải "Tải lại" (F-04x-1 [8].6)', async () => {
    const { gateway, writeLayer } = savingGateway();

    /* Máy chủ đã đi trước bản mà màn nạp — lượt lưu đầu nhận 409. */
    simulateRemoteLayerEdit(FLOOR_ID);
    const mounted = await mountSettled({ gateway });

    await renameR005(mounted);
    await act(async () => {
      await flushAutosaves().catch(() => undefined);
    });

    expect(writeLayer).toHaveBeenCalledTimes(1);
    await waitFor(() => {
      expect(mounted.result.current.saveBlock?.kind).toBe('reload');
    });
  });
});

/* -------------------------------------------------------------------------- */
/* 2 + 3. Chuẩn hoá tên: xem trước, rồi áp, rồi hoàn tác.                       */
/* -------------------------------------------------------------------------- */

describe('chuẩn hoá tên — luôn xem trước trước khi áp', () => {
  it('[BUG-409] tên chuẩn viết hoa chữ đầu (A6); tên đã đúng thì không đổi', () => {
    expect(canonicalRoomName('PHONG NGU 2')).toBe('Phòng ngủ 2');
    expect(canonicalRoomName('bếp')).toBe('Bếp');
    expect(canonicalRoomName('Bếp')).toBeNull();
    expect(canonicalRoomName('Phòng ngủ 2')).toBeNull();
    expect(ROOM_NAME_TARGETS.every((target) => target.charAt(0) === target.charAt(0).toLocaleUpperCase('vi'))).toBe(true);
  });

  it('sinh bảng xem trước mà KHÔNG đổi một tên nào', async () => {
    const mounted = await mountSettled();

    const namesBefore = mounted.result.current.rooms.map((row) => row.name);

    act(() => {
      mounted.result.current.onOpenNormalizePreview();
    });

    const preview = mounted.result.current.normalizePreview;

    expect(preview).not.toBeNull();
    expect(preview?.changedCount).toBeGreaterThan(0);
    expect(preview?.rows.length).toBe(preview?.changedCount);
    /* Mọi đích đến nằm trong tám nhãn của tầng luật — màn không bịa nhãn mới. */
    for (const row of preview?.rows ?? []) {
      expect(ROOM_NAME_TARGETS.some((target) => row.to.startsWith(target))).toBe(true);
    }

    /* KHÔNG một tên nào đổi: cả ở viewmodel lẫn trong kho. */
    expect(mounted.result.current.rooms.map((row) => row.name)).toEqual(namesBefore);
    expect(nameInStore(ROOM_R005.id)).toBe(ROOM_R005.name);
  });

  it('huỷ xem trước thì đóng bảng và vẫn không đổi gì', async () => {
    const mounted = await mountSettled();

    act(() => {
      mounted.result.current.onOpenNormalizePreview();
    });
    act(() => {
      mounted.result.current.onCancelNormalize();
    });

    expect(mounted.result.current.normalizePreview).toBeNull();
    expect(nameInStore(ROOM_R005.id)).toBe(ROOM_R005.name);
  });

  it('áp xong thì có vé hoàn tác, và hoàn tác trả lại tên cũ', async () => {
    const notifications: NotificationBus = createNotificationBus();
    const mounted = await mountSettled({ notifications });

    act(() => {
      mounted.result.current.onOpenNormalizePreview();
    });

    const rows = mounted.result.current.normalizePreview?.rows ?? [];

    expect(rows.length).toBeGreaterThan(0);

    await act(async () => {
      mounted.result.current.onApplyNormalize();
      await Promise.resolve();
    });

    /* Bảng đóng lại, và mọi dòng của bảng đã thành tên mới trong kho. */
    await waitFor(() => {
      expect(nameInStore(rows[0]?.roomId as RoomId)).toBe(rows[0]?.to);
    });

    expect(mounted.result.current.normalizePreview).toBeNull();

    for (const row of rows) {
      expect(nameInStore(row.roomId)).toBe(row.to);
    }

    /* A8: một lượt chuẩn hoá = MỘT toast, MỘT vé, MỘT bước hoàn tác. */
    const published = notifications.list();
    const ticket = published[0]?.undoTicket;

    expect(published).toHaveLength(1);
    expect(published[0]?.type).toBe(ROOM_NORMALIZE_COMMAND_TYPE);
    expect(ticket).toBeDefined();
    expect(ticket?.getStatus()).toBe('active');

    await act(async () => {
      ticket?.undo();
      await Promise.resolve();
    });

    await waitFor(() => {
      expect(nameInStore(rows[0]?.roomId as RoomId)).toBe(rows[0]?.from);
    });

    for (const row of rows) {
      expect(nameInStore(row.roomId)).toBe(row.from);
    }
  });
});

/* -------------------------------------------------------------------------- */
/* 4. Nhắc công năng M-14 — NHẮC, không bao giờ CHẶN.                          */
/* -------------------------------------------------------------------------- */

describe('nhắc công năng M-14', () => {
  it('không chặn đổi tên, đổi công năng hay duyệt', async () => {
    const mounted = await mountSettled();
    const noticed = mounted.result.current.rooms.find((row) => row.notices.length > 0);

    expect(noticed).toBeDefined();

    const roomId = noticed?.id as RoomId;

    await act(async () => {
      mounted.result.current.onRename(roomId, 'phòng đã sửa theo nhắc');
      await Promise.resolve();
    });

    await waitFor(() => {
      expect(nameInStore(roomId)).toBe('phòng đã sửa theo nhắc');
    });

    await act(async () => {
      mounted.result.current.onChangeUsage(roomId, 'kitchen');
      await Promise.resolve();
    });

    await waitFor(() => {
      expect(rowOf(mounted, roomId).usage).toBe('kitchen');
    });

    await act(async () => {
      mounted.result.current.onApprove(roomId);
      await Promise.resolve();
    });

    /* A5: cờ xanh "đã xác minh" chỉ bật qua lượt duyệt của người. */
    await waitFor(() => {
      expect(rowOf(mounted, roomId).status).toBe('confirmed');
    });

    /* Và phòng vẫn còn nhắc: nhắc là NHẮC, không phải cổng chặn. */
    expect(rowOf(mounted, roomId).notices.length).toBeGreaterThan(0);
  });
});

/* -------------------------------------------------------------------------- */
/* 5. Vòng hở — kèm kích thước, kèm bước đi tiếp.                              */
/* -------------------------------------------------------------------------- */

describe('vòng tường hở', () => {
  it('liệt kê vòng hở KÈM kích thước', async () => {
    const mounted = await mountScenario(ROOM_LABEL_SCENARIO_PARTIAL);
    const gaps = mounted.result.current.gaps;

    console.log(`[S-17] vòng hở = ${gaps.map((gap) => gap.gapText).join(' · ')}`);

    expect(gaps.length).toBeGreaterThan(0);
    expect(gaps[0]?.gapText).toBe(formatLength(millimetres(ROOM_LABEL_SCENARIO_GAP_MM)));
    expect(gaps[0]?.wallIds.length).toBeGreaterThan(0);
    /* BUG-626: mã hiển thị như SCR-16, không phải id thô. */
    expect(gaps[0]?.wallCodeLabels[0]).toMatch(/^#W-\d{3}$/u);
  });

  it('trạng thái rỗng nói ra hai bước đi tiếp', async () => {
    const mounted = await mountScenario(ROOM_LABEL_SCENARIO_EMPTY);
    const notice = mounted.result.current.emptyNotice ?? '';

    expect(mounted.result.current.state).toBe('empty');
    expect(notice).toContain('lớp tường');
    /* Gọi ĐÚNG tên nút đang có trên màn (`RoomLabelReview.tsx`, B-V7-10). */
    expect(notice).toContain('bấm "Kiểm tra lại vòng hở"');
  });

  it('"sang lớp tường" đi đúng đường dẫn ROUTES ghép ra', async () => {
    const onNavigate = vi.fn();
    const mounted = await mountSettled({ onNavigate });

    act(() => {
      mounted.result.current.onNavigateToWalls();
    });

    expect(onNavigate).toHaveBeenCalledWith(ROUTES.project.walls(PROJECT_ID, FLOOR_ID));
  });
});

/* -------------------------------------------------------------------------- */
/* Bảy trạng thái (A11/R-63).                                                  */
/* -------------------------------------------------------------------------- */

describe('Bảy trạng thái', () => {
  it('bảy kịch bản phủ đúng bảy nhánh của SEVEN_STATES', () => {
    expect(ROOM_LABEL_REVIEW_SCENARIOS.map((scenario) => scenario.state)).toEqual([
      ...SEVEN_STATES,
    ]);
  });

  it.each([
    ['rỗng', ROOM_LABEL_SCENARIO_EMPTY],
    ['một phần', ROOM_LABEL_SCENARIO_PARTIAL],
    ['lỗi', ROOM_LABEL_SCENARIO_ERROR],
    ['xong', ROOM_LABEL_SCENARIO_SUCCESS],
    ['không có quyền', ROOM_LABEL_SCENARIO_FORBIDDEN],
    ['thu gọn', ROOM_LABEL_SCENARIO_COLLAPSED],
  ])('kịch bản %s cho đúng trạng thái của nó', async (_label, scenario) => {
    const mounted = await mountScenario(scenario);

    expect(mounted.result.current.state).toBe(scenario.state);
  });

  it('trạng thái lỗi vẫn giữ ảnh gốc xem được', async () => {
    const mounted = await mountScenario(ROOM_LABEL_SCENARIO_ERROR);

    expect(mounted.result.current.state).toBe('error');
    expect(mounted.result.current.errorMessage).not.toBeNull();
    expect(mounted.result.current.backgroundImageUrl).not.toBeNull();
  });

  it('vai Người xem có câu giải thích và mọi lượt ghi đều tắt', async () => {
    const mounted = await mountScenario(ROOM_LABEL_SCENARIO_FORBIDDEN);

    expect(mounted.result.current.isViewerRole).toBe(true);
    expect(mounted.result.current.viewerRoleNotice).toBe(
      'Bạn đang xem với vai người xem: đổi tên, đổi công năng, gộp, tách và duyệt đều tắt. Nhờ người quản trị dự án đổi vai nếu bạn cần sửa lớp phòng.',
    );

    await act(async () => {
      mounted.result.current.onRename(ROOM_R005.id, 'tên của người xem');
      await Promise.resolve();
    });

    expect(nameInStore(ROOM_R005.id)).toBe(ROOM_R005.name);
  });
});

/* -------------------------------------------------------------------------- */
/* Sáu trường thanh tra — worker panel đang chờ đúng sáu thứ này.               */
/* -------------------------------------------------------------------------- */

describe('sáu trường thanh tra', () => {
  it('cấp đủ sáu trường, và cả sáu đọc từ tầng luật chứ không gõ tay', async () => {
    const mounted = await mountSettled();

    act(() => {
      mounted.result.current.onSelect(ROOM_R005.id);
    });

    await waitFor(() => {
      expect(mounted.result.current.selectedRoomId).toBe(ROOM_R005.id);
    });

    const model = mounted.result.current;

    expect(model.nameSuggestions).toEqual(ROOM_NAME_TARGETS);
    expect(model.nameSuggestions).toHaveLength(ROOM_NAME_TARGETS.length);
    expect(model.usageOptions.map((option) => option.label)).toEqual([...ROOM_NAME_TARGETS]);
    expect(model.areaCaption).not.toBe('');
    expect(model.mergeCandidates).toHaveLength(ROOM_LABEL_FIXTURE_TOTAL - 1);
    /* Bộ mẫu không có tường ngăn nào, nên chưa có điểm cắt — và nó nói ra bằng `null`. */
    expect(model.splitPointMm).toBeNull();
    expect(model.viewerRoleNotice).toBeNull();
  });
});

/* -------------------------------------------------------------------------- */
/* Bộ lọc và vỏ màn.                                                           */
/* -------------------------------------------------------------------------- */

describe('chip lọc "Chưa đặt tên"', () => {
  it('thu hẹp danh sách xuống đúng ba phòng trống tên, tóm tắt vẫn đếm cả tầng', async () => {
    const mounted = await mountSettled();

    act(() => {
      mounted.result.current.onToggleUnnamedFilter();
    });

    expect(mounted.result.current.showOnlyUnnamed).toBe(true);
    expect(mounted.result.current.rooms).toHaveLength(ROOM_LABEL_FIXTURE_UNNAMED_COUNT);
    expect(mounted.result.current.summary.roomCount).toBe(ROOM_LABEL_FIXTURE_TOTAL);

    act(() => {
      mounted.result.current.onToggleUnnamedFilter();
    });

    expect(mounted.result.current.rooms).toHaveLength(ROOM_LABEL_FIXTURE_TOTAL);
  });
});

/* -------------------------------------------------------------------------- */
/* Tỷ lệ tạm (F-04x-2 [8].7).                                                  */
/* -------------------------------------------------------------------------- */

describe('tỷ lệ tạm (F-04x-2)', () => {
  const PROVISIONAL_TEXT = /^≈ [\d.,]+ m²? \(tạm\)$/u;

  it('[K16] một quy tắc: vàng "≈ … (tạm)", đỏ "Chưa có", tỷ lệ thật giữ nguyên số', () => {
    expect(provisionalMeasureText('12,40 m²', 'unresolved', 'pipeline')).toBe('≈ 12,40 m² (tạm)');
    expect(provisionalMeasureText('12,40 m²', 'unresolved')).toBe('≈ 12,40 m² (tạm)');
    expect(provisionalMeasureText('12,40 m²', 'unresolved', 'project_default')).toBe('Chưa có');
    expect(provisionalMeasureText('12,40 m²', undefined)).toBe('12,40 m²');
  });

  it('BENCH3D-11: có clearAreaM2 thì số chính là thông thuỷ, tim tường là số phụ; tầng đỏ không số phụ', () => {
    const room: Room = {
      ...ROOM_R005,
      outline: [
        { x: 0, y: 0 },
        { x: 4000, y: 0 },
        { x: 4000, y: 4000 },
        { x: 0, y: 4000 },
      ] as unknown as Room['outline'],
      clearAreaM2: squareMetres(14.44),
    };
    const scale = scaleFromRatio(millimetresPerPixel(1));

    expect(measureRoom(room, scale)).toMatchObject({ areaText: '14,44 m² thông thuỷ', centerlineAreaText: '16,00 m² tim tường' });
    expect(measureRoom(room, scale, 'unresolved', 'pipeline')).toMatchObject({
      areaText: '≈ 14,44 m² thông thuỷ (tạm)',
      centerlineAreaText: '≈ 16,00 m² tim tường (tạm)',
    });
    expect(measureRoom(room, scale, 'unresolved', 'project_default')).not.toHaveProperty('centerlineAreaText');
    const { clearAreaM2: _omit, ...withoutClear } = room;
    void _omit;
    expect(measureRoom(withoutClear, scale)).toMatchObject({ areaText: '16,00 m²' });
    expect(measureRoom(withoutClear, scale)).not.toHaveProperty('centerlineAreaText');
  });

  it('R9: số đo phòng theo scaleState — ước lượng / chưa xác định có dấu, đọc từ bản vẽ số trơn', () => {
    const room: Room = {
      ...ROOM_R005,
      outline: [
        { x: 0, y: 0 },
        { x: 4000, y: 0 },
        { x: 4000, y: 4000 },
        { x: 0, y: 4000 },
      ] as unknown as Room['outline'],
    };
    const scale = scaleFromRatio(millimetresPerPixel(1));

    expect(measureRoom(room, scale, 'unresolved', 'pipeline', 'estimated').areaText).toBe('≈ 16,00 m² (ước lượng)');
    expect(measureRoom(room, scale, 'unresolved', 'pipeline', 'unresolved').areaText).toBe('≈ 16,00 m² (chưa xác định)');
    expect(measureRoom(room, scale, 'unresolved', 'pipeline', 'determined').areaText).toBe('16,00 m²');
    expect(measureRoom(room, scale, 'unresolved', 'project_default', 'unresolved').areaText).toBe('Chưa có');
  });

  /* UX-R2 K22/K04: tỷ lệ "cần kiểm" (vàng) không còn dải ở màn; số đo vẫn "≈ … (tạm)". */
  it('tầng unresolved do máy đo: không dải vàng; diện tích, chu vi, tổng hiện "≈ … (tạm)" (K16)', async () => {
    const mounted = await mountSettled({
      gateway: createMockRoomLabelReviewGateway({ graph: graphOf(ROOM_LABEL_FIXTURE_ROOMS, []), scaleStatus: 'unresolved' }),
    });

    await waitFor(() => {
      expect(mounted.result.current.summary.totalAreaText).toMatch(PROVISIONAL_TEXT);
    });

    const { rooms, provisionalScaleNotice } = mounted.result.current;
    expect(rooms.length).toBeGreaterThan(0);
    expect(rooms.every((row) => PROVISIONAL_TEXT.test(row.areaText))).toBe(true);
    expect(rooms.every((row) => PROVISIONAL_TEXT.test(row.perimeterText))).toBe(true);
    expect(provisionalScaleNotice).toBeNull();
    mounted.unmount();
  });

  it('tầng có tỉ lệ thật: không dải, số đo là số', async () => {
    const mounted = await mountSettled();
    const { rooms, summary, provisionalScaleNotice } = mounted.result.current;

    expect(provisionalScaleNotice).toBeNull();
    expect(rooms.some((row) => PROVISIONAL_TEXT.test(row.areaText))).toBe(false);
    expect(summary.totalAreaText).not.toMatch(PROVISIONAL_TEXT);
    mounted.unmount();
  });
});

describe('[G4a-39] lối sang lớp tường mang mã tường', () => {
  it('có mã tường thì gắn ?wall= để màn Tường chọn sẵn đoạn đó', async () => {
    const onNavigate = vi.fn();
    const mounted = await mountSettled({ onNavigate });

    act(() => {
      mounted.result.current.onNavigateToWalls('wall-x' as WallId);
    });

    expect(onNavigate).toHaveBeenCalledWith(`${ROUTES.project.walls(PROJECT_ID, FLOOR_ID)}?wall=wall-x`);
  });
});

describe('[K10] tên giả của máy và đường bao tràn ra ngoài', () => {
  it('"phòng 5" máy tự đặt là chưa có tên; người gõ "phòng 5" thì vẫn là tên', () => {
    expect(hasRoomName({ name: 'phòng 5', source: 'ai' })).toBe(false);
    expect(hasRoomName({ name: 'phòng 5', source: 'human' })).toBe(true);
    expect(hasRoomName({ name: 'phòng ngủ 1', source: 'ai' })).toBe(true);
    expect(hasRoomName({ name: '  ', source: 'human' })).toBe(false);
  });

  it('[UX-18] phòng duyệt hàng loạt: chưa duyệt, có tên thật, máy chắc chắn, không bị loại', () => {
    const room = (id: string, patch: Partial<Room>): Room =>
      ({ id, name: 'Bếp', source: 'ai', reviewed: false, confidence: 0.9, ...patch }) as unknown as Room;
    const rooms = [
      room('sure', {}),
      room('unsure', { confidence: 0.4 }),
      room('done', { reviewed: true }),
      room('fake', { name: 'phòng 5' }),
      room('spill', {}),
      /* UX-24: tên người gõ (lệnh đổi tên đặt `source: 'human'`) không còn là "máy chắc chắn". */
      room('typed', { source: 'human' }),
    ];

    expect(confidentRoomsOf(rooms, new Set(['spill'] as unknown as RoomId[])).map((item) => item.id)).toEqual(['sure']);
    expect(approveConfidentRoomsLabelOf(3)).toBe('Duyệt 3 phòng máy chắc chắn');
  });

  it('phòng trong nhà có đỉnh vượt tường bao quá 150 mm thì bị gắn cờ; phòng nằm gọn hoặc nằm hẳn ngoài thì không', () => {
    const wall = (id: string, x1: number, y1: number, x2: number, y2: number) =>
      ({
        id: id as WallId,
        centreline: { start: { x: x1, y: y1 }, end: { x: x2, y: y2 } },
        thicknessMm: millimetres(200),
      }) as unknown as Wall;
    const walls = [wall('w1', 0, 0, 6000, 0), wall('w2', 6000, 0, 6000, 4000), wall('w3', 6000, 4000, 0, 4000), wall('w4', 0, 4000, 0, 0)];
    const room = (id: string, x1: number, y1: number, x2: number, y2: number) =>
      ({ id: id as RoomId, outline: [{ x: x1, y: y1 }, { x: x2, y: y1 }, { x: x2, y: y2 }, { x: x1, y: y2 }] }) as unknown as Room;

    const spilling = roomsSpillingOutside(
      [room('inside', 100, 100, 3000, 3900), room('spill', -500, 100, 3000, 3900), room('away', 9000, 0, 12000, 4000)],
      walls,
    );

    expect([...spilling]).toEqual(['spill']);
    expect(roomsSpillingOutside([room('spill', -500, 100, 3000, 3900)], []).size).toBe(0);
  });
});

describe('[K10] đường bao tràn ra ngoài: chặn duyệt ở hook', () => {
  /* Tường bao 0..5000 × 0..3400 mm; phòng chạy tới 5600 mm — vượt quá 110 mm nửa tường + 150 mm dung sai. */
  const corner = (x: number, y: number): Room['outline'][number] => ({ x: millimetres(x), y: millimetres(y) });
  const spillRoom: Room = {
    ...ROOM_R005,
    outline: [corner(0, 0), corner(5600, 0), corner(5600, 3400), corner(0, 3400)],
  };
  const reviewedInStore = (): boolean | undefined =>
    (useStore.getState().spatial?.byId[spillRoom.id] as Room | undefined)?.reviewed;

  it('onApprove không ghi gì khi đường bao tràn', async () => {
    const mounted = await mountSettled({
      gateway: createMockRoomLabelReviewGateway({ graph: graphOf([spillRoom], ROOM_LABEL_SCENARIO_GAP_WALLS) }),
    });

    expect(rowOf(mounted, spillRoom.id).outlineSpills).toBe(true);

    await act(async () => {
      mounted.result.current.onApprove(spillRoom.id);
      await Promise.resolve();
    });

    expect(reviewedInStore()).toBe(false);
  });

  it('phím A duyệt phòng nằm gọn rồi sang phòng tràn; ở phòng tràn A không duyệt, vùng chọn ở lại', async () => {
    const shortcutRegistry = createShortcutRegistry();
    /* Phòng đối chứng nằm gọn trong tường bao, chưa duyệt: chứng minh phím A thật sự đang sống. */
    const inside: Room = { ...(ROOM_LABEL_FIXTURE_ROOMS[0] as Room), reviewed: false, source: 'human' };
    const mounted = await mountSettled({
      shortcutRegistry,
      gateway: createMockRoomLabelReviewGateway({ graph: graphOf([inside, spillRoom], ROOM_LABEL_SCENARIO_GAP_WALLS) }),
    });

    expect(rowOf(mounted, inside.id).outlineSpills).toBe(false);

    act(() => {
      mounted.result.current.onSelect(inside.id);
    });
    await act(async () => {
      shortcutRegistry.handleKeyDown({ key: 'a' }, null);
      await Promise.resolve();
    });
    await waitFor(() => {
      expect((useStore.getState().spatial?.byId[inside.id] as Room | undefined)?.reviewed).toBe(true);
    });
    expect(useStore.getState().selectedIds).toEqual([spillRoom.id]);

    await act(async () => {
      shortcutRegistry.handleKeyDown({ key: 'a' }, null);
      await Promise.resolve();
    });

    expect(reviewedInStore()).toBe(false);
    expect(useStore.getState().selectedIds).toEqual([spillRoom.id]);
  });

  it('Esc bỏ chọn phòng như × "Bỏ chọn" của panel phải', async () => {
    const shortcutRegistry = createShortcutRegistry();
    const mounted = await mountSettled({ shortcutRegistry });
    const first = mounted.result.current.rooms[0]!;

    act(() => {
      mounted.result.current.onSelect(first.id);
    });
    expect(mounted.result.current.selectedRoomId).toBe(first.id);

    act(() => {
      shortcutRegistry.handleKeyDown({ key: 'Escape' }, null);
    });
    expect(mounted.result.current.selectedRoomId).toBeNull();
  });
});

describe('[UX-08] đoạn đo tỷ lệ vẽ lên bản vẽ Phòng', () => {
  it('đổi tỷ lệ khung vuông sang mm của ảnh nằm giữa, kèm số đo', () => {
    /* Ảnh 20.000 × 10.000 mm: khung vuông cạnh 20.000, dải trống dọc 5.000 mỗi bên. */
    const segment = scaleSegmentOf(
      { start: { x: 0.1, y: 0.5 }, end: { x: 0.502, y: 0.5 } },
      { widthMm: 20000, heightMm: 10000 },
    );

    expect(segment?.startMm.x).toBeCloseTo(2000);
    expect(segment?.startMm.y).toBeCloseTo(5000);
    expect(segment?.endMm.x).toBeCloseTo(10040);
    expect(segment?.caption).toBe('Đoạn đo tỷ lệ: 8.040 mm');
    expect(scaleSegmentOf(null, { widthMm: 1, heightMm: 1 })).toBeNull();
    expect(scaleSegmentOf({ start: { x: 0, y: 0 }, end: { x: 1, y: 1 } }, null)).toBeNull();
  });
});
