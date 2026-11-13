/**
 * Nửa "suy nghĩ" của màn S-12 "Duyệt lớp tường", kiểm không cần DOM của màn.
 *
 * Hook được lái qua `renderHook`, tầng dữ liệu là
 * `createMockWallLayerReviewGateway()` của `wallLayerReviewGateway.ts` — cùng
 * cổng story sẽ dùng — và mọi con số khẳng định đọc ra từ
 * `wallLayerReviewFixture.ts` / `wallLayerReviewScenarios.ts`, không có bảng dữ
 * liệu thứ hai bịa tại chỗ (R-70).
 *
 * ## Phép kiểm quan trọng nhất của cả file
 *
 * `duyệt 5 tường bằng bàn phím` — bộ đếm phải đi 12 → 17, rồi `Ctrl+Z` năm lần
 * phải đưa nó về đúng 12. Bài kiểm **in ra số đếm sau mỗi bước** chứ không chỉ
 * khẳng định hai đầu, nên một bước nhảy sai ở giữa cũng lộ.
 *
 * Điều hướng (`J`) và hoàn tác (`Ctrl+Z`) đi qua SỔ PHÍM THẬT
 * (`registry.handleKeyDown`), không phải qua một lời gọi tắt. Lượt duyệt thì
 * gọi hành động mặc định của hàng đang có tiêu điểm — đúng những gì phím `Enter`
 * làm trên một phần tử focus được, và là lý do `Enter` không bị đăng ký làm
 * phím tắt toàn cục (nó nằm trong `RESERVED_KEYS`).
 */

import { createElement, type ReactNode } from 'react';
import { QueryClientProvider } from '@tanstack/react-query';
import { act, cleanup, renderHook, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { __resetMockLayerState, createMockApiClient, simulateRemoteLayerEdit } from '@/api/__mocks__/client';
import { FloorLayerWriteSchema } from '@/api/schemas/spatialLayer';
import { sampleLevelId } from '@/domain/spatial/__fixtures__/sampleBuilding';
import { normalizeSpatial } from '@/domain/spatial/normalize';
import type { Level, Point, Wall, WallId } from '@/domain/spatial/types';
import { WALL_COMMAND_TYPES } from '@/lib/commands/business/wallCommands';
import { __resetFloorLayerSavers, FLOOR_LAYER_RELOAD_DISCARDED, flushAutosaves } from '@/hooks/useAutosave';
import { appNotificationBus } from '@/hooks/useNotifications';
import type * as conflictModule from '@/lib/versioning/conflict';
import { resolveConflict } from '@/lib/versioning/conflict';
import { createShortcutRegistry, type ShortcutRegistry } from '@/lib/input/shortcutRegistry';
import { createNotificationBus, type NotificationBus } from '@/lib/mutations/notificationBus';
import { createTestQueryClient } from '@/lib/testing/render';
import { SEVEN_STATES } from '@/lib/testing/sevenStateScenarios';
import { shortcutForTool } from '@/lib/tools/shortcuts';
import { resetSelectorCaches } from '@/store/selectors';
import { useStore } from '@/store';

import {
  applyWallFilters,
  deriveScreenState,
  nextUnreviewedWallId,
  readWallCodeMemory,
  useWallLayerReview,
  wallsOfLevel,
  writeWallCodeMemory,
  type UseWallLayerReviewOptions,
  type UseWallLayerReviewResult,
} from './useWallLayerReview';
import { isLowConfidence as canvasHatchGate } from '@/components/canvas/materialMap';

import {
  buildApproveWallCommand,
  buildChangeThicknessCommand,
  canMergeWalls,
  commandContextOf,
  createMockWallLayerReviewGateway,
  createWallLayerReviewGateway,
  createWallUndoTicket,
  CURSOR_IDLE_LABEL,
  deleteToastDescription,
  isLowConfidence,
  isStandardThickness,
  scaleOfLevel,
  toPixelPoint,
  toWallInspector,
  wallDisplayCode,
  LONG_UNDO_WINDOW_MS,
  UNDO_WINDOW_MS,
  WALL_APPROVE_COMMAND_TYPE,
  WALL_LAYER_THICKNESS_CHOICES,
} from './wallLayerReviewGateway';
import {
  WALL_LAYER_FIXTURE_BUILDING,
  WALL_LAYER_FIXTURE_LEVEL,
  WALL_LAYER_FIXTURE_REVIEWED,
  WALL_LAYER_FIXTURE_TOTAL,
  WALL_LAYER_FIXTURE_WALLS,
} from './wallLayerReviewFixture';
import { isQcCompare, setQcCompare } from '../shared/qcCompare';

import { WALL_DRAW_MUST_CONNECT_TEXT } from './wallDrawConnect';
import { WALL_LAYER_REVIEW_SCENARIOS } from './wallLayerReviewScenarios';
import type { WallThicknessChoice } from './types';

/** P5: toạ độ con trỏ cập nhật theo `requestAnimationFrame` — chờ một khung rồi mới đọc. */
const nextFrame = () =>
  new Promise<void>((resolve) => {
    if (typeof requestAnimationFrame === 'function') {
      requestAnimationFrame(() => resolve());
    } else {
      resolve();
    }
  });

/* Khoá tỷ lệ của tầng (`useScaleLock`): mặc định mở; bài "khoá tỷ lệ" bật nó. */
const scaleLockState = vi.hoisted(() => ({ locked: false }));

vi.mock('../shared/useScaleLock', () => ({
  useScaleLock: () =>
    scaleLockState.locked
      ? { locked: true, reason: 'Đặt tỷ lệ trước: tầng này chưa có tỷ lệ đúng' }
      : { locked: false, reason: null },
}));

/* `resolveConflict` phải 0 lần (R6): bọc bản thật để đếm, không đổi hành vi. */
vi.mock('@/lib/versioning/conflict', async (importOriginal) => {
  const actual = await importOriginal<typeof conflictModule>();

  return { ...actual, resolveConflict: vi.fn(actual.resolveConflict) };
});

/* -------------------------------------------------------------------------- */
/* Bộ mẫu — đọc ra, không viết tay lại.                                        */
/* -------------------------------------------------------------------------- */

const PROJECT_ID = 'project-1';

/** Số tường bài kiểm bàn phím duyệt — đủ để dãy đếm có năm bước lên và năm bước xuống. */
const APPROVALS = 5;

/* -------------------------------------------------------------------------- */
/* Bộ mẫu, ĐỌC THẲNG — không còn lượt đánh lại mã nào.                         */
/* -------------------------------------------------------------------------- */

/*
 * Bản trước của file này đánh lại mã cho cả 48 tường trước khi dùng, vì bộ mẫu
 * đặt mã kiểu `W-001` mà `isIdOfKind` (`src/domain/spatial/ids.ts:95,108`) từ
 * chối — thân mã phải dài ít nhất 10 ký tự `[0-9A-Z]`. Hệ quả là bài kiểm chạy
 * trên một bộ mẫu KHÁC bộ mẫu màn thật dùng, tức là một lượt xanh không chứng
 * minh được gì về màn.
 *
 * Bộ mẫu đã được sửa tận gốc (xem đầu `wallLayerReviewFixture.ts`): mã sinh
 * đúng khuôn `createId` và vẫn tất định, còn nhãn người đọc "#W-014" do
 * `wallDisplayCode` dẫn xuất nên không dài theo. Nên lượt đánh lại mã ở đây là
 * thừa và đã bị xoá — bài kiểm nay chạy trên ĐÚNG bộ mẫu mà màn dựng.
 */
const FIXTURE_LEVEL: Level = WALL_LAYER_FIXTURE_LEVEL;
const FIXTURE_WALLS: readonly Wall[] = WALL_LAYER_FIXTURE_WALLS;

const FIXTURE_GRAPH = normalizeSpatial({
  building: WALL_LAYER_FIXTURE_BUILDING,
  levels: [FIXTURE_LEVEL],
  walls: FIXTURE_WALLS,
  openings: [],
  furniture: [],
  rooms: [],
  axes: [],
  dimensions: [],
  notes: [],
});

const FLOOR_ID = FIXTURE_LEVEL.id;

/* -------------------------------------------------------------------------- */
/* Môi trường.                                                                 */
/* -------------------------------------------------------------------------- */

beforeEach(() => {
  /* U07: nhãn tường nhớ trong localStorage — bài kiểm này không được mang nhãn sang bài kia. */
  localStorage.clear();
  /* Bộ lưu lớp sống cấp module, revision mock cũng vậy — mỗi bài kiểm bắt đầu sạch. */
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
  readonly result: { current: UseWallLayerReviewResult };
  readonly registry: ShortcutRegistry;
  readonly unmount: () => void;
}

type MountOptions = Partial<Omit<UseWallLayerReviewOptions, 'registry'>>;

function mountHook(options: MountOptions = {}): Mounted {
  const registry = createShortcutRegistry();
  const queryClient = createTestQueryClient();
  const wrapper = ({ children }: { children: ReactNode }): ReactNode =>
    createElement(QueryClientProvider, { client: queryClient }, children);

  const rendered = renderHook(
    () =>
      useWallLayerReview({
        projectId: options.projectId ?? PROJECT_ID,
        floorId: options.floorId ?? FLOOR_ID,
        roles: options.roles ?? ['engineer'],
        gateway:
          options.gateway ??
          createMockWallLayerReviewGateway({ graph: FIXTURE_GRAPH }),
        registry,
        ...(options.notifications === undefined ? {} : { notifications: options.notifications }),
        ...(options.levelId === undefined ? {} : { levelId: options.levelId }),
        ...(options.forceCollapsed === undefined ? {} : { forceCollapsed: options.forceCollapsed }),
        ...(options.onNavigate === undefined ? {} : { onNavigate: options.onNavigate }),
      }),
    { wrapper },
  );

  return { result: rendered.result, registry, unmount: rendered.unmount };
}

/** Một điểm milimét của bản vẽ, đọc ra bằng PIXEL đúng cách canvas đọc nó. */
const asCanvasPoint = (pointMm: Point): { readonly xPx: number; readonly yPx: number } => {
  const pixelPoint = toPixelPoint(pointMm, scaleOfLevel(FIXTURE_LEVEL));

  return { xPx: pixelPoint.x, yPx: pixelPoint.y };
};

/** Số tường đang có trên tầng, đọc thẳng từ kho. */
const wallCount = (): number => useStore.getState().spatial?.byKind.wall.length ?? 0;

/** Chờ lượt đọc ảnh nền xong — trước đó mọi kịch bản đều là `'loading'`. */
async function mountSettled(options: MountOptions = {}): Promise<Mounted> {
  const mounted = mountHook(options);

  await waitFor(() => {
    expect(mounted.result.current.panel.state).not.toBe('loading');
  });

  return mounted;
}

/** Gõ một phím vào SỔ PHÍM THẬT, đúng đường một bàn phím thật đi. */
async function pressKey(
  registry: ShortcutRegistry,
  key: string,
  modifiers: { readonly ctrlKey?: boolean } = {},
): Promise<void> {
  await act(async () => {
    registry.handleKeyDown({ key, ctrlKey: modifiers.ctrlKey ?? false }, null);
    await Promise.resolve();
  });
}

/**
 * Gõ `J` cho tới khi hàng đang chọn là một tường CHƯA DUYỆT.
 *
 * Bộ mẫu xen kẽ tường đã duyệt và chưa duyệt, nên một lượt `J` đơn lẻ có thể
 * rơi đúng vào hàng đã duyệt — người duyệt thật cũng gõ tiếp, và nút "Duyệt
 * đoạn này" của hàng đó vốn đã bị khoá. Vòng lặp có trần bằng số hàng để một
 * lỗi thật không biến thành một bài kiểm treo.
 */
async function pressUntilUnreviewed(mounted: Mounted): Promise<WallId | null> {
  for (let attempt = 0; attempt < WALL_LAYER_FIXTURE_TOTAL; attempt += 1) {
    await pressKey(mounted.registry, 'J');

    const id = mounted.result.current.panel.selectedWallId;
    const row = mounted.result.current.panel.rows.find((item) => item.id === id);

    if (row !== undefined && !row.isReviewed) {
      return row.id;
    }
  }

  return null;
}

/** Mã tường của một bộ mẫu, đọc ra chứ không gõ tay. */
const wallAt = (index: number): Wall => FIXTURE_WALLS[index] as Wall;

/** Số cuối của một dãy đếm. `noUncheckedIndexedAccess` bật, nên phải nói ra ý định. */
const lastOf = (values: readonly number[]): number => values[values.length - 1] as number;

/** Một trong ba băng độ dày, đọc ra từ hằng chứ không gõ số. */
const thicknessChoice = (index: number): WallThicknessChoice =>
  WALL_LAYER_THICKNESS_CHOICES[index] as WallThicknessChoice;

/* -------------------------------------------------------------------------- */
/* Phép ghép thuần.                                                            */
/* -------------------------------------------------------------------------- */

describe('phép ghép thuần của màn Duyệt lớp tường', () => {
  it('đọc đúng 48 tường của tầng mẫu', () => {
    const walls = wallsOfLevel(FIXTURE_GRAPH, FIXTURE_LEVEL.id);

    expect(walls).toHaveLength(WALL_LAYER_FIXTURE_TOTAL);
    expect(walls.filter((wall) => wall.reviewed)).toHaveLength(WALL_LAYER_FIXTURE_REVIEWED);
  });

  it('bảy trạng thái dẫn xuất đúng, đủ và không thừa nhánh nào', () => {
    const derived = WALL_LAYER_REVIEW_SCENARIOS.map((scenario) =>
      deriveScreenState({
        isViewerRole: scenario.isViewerRole,
        isCollapsed: scenario.isCollapsed,
        hasError: scenario.error !== null,
        isLoading: scenario.state === 'loading',
        counter: scenario.reviewCounter,
      }),
    );

    expect(derived).toEqual([...SEVEN_STATES]);
  });

  it('ba cờ lọc lọc đúng cái chúng nói', () => {
    /* Thang sáu bậc (100–400): bộ mẫu 90/175/235 đều trong dung sai, nên thêm một tường 260 mm (lệch 40 khỏi 220/300). */
    const walls: readonly Wall[] = [...FIXTURE_WALLS, { ...FIXTURE_WALLS[0]!, id: 'W-NONSTD-260' as Wall['id'], thicknessMm: 260 as Wall['thicknessMm'], reviewed: true }];

    const unreviewed = applyWallFilters(walls, {
      onlyUnreviewed: true,
      onlyLowConfidence: false,
      onlyNonStandardThickness: false,
    });
    const nonStandard = applyWallFilters(walls, {
      onlyUnreviewed: false,
      onlyLowConfidence: false,
      onlyNonStandardThickness: true,
    });

    expect(unreviewed).toHaveLength(WALL_LAYER_FIXTURE_TOTAL - WALL_LAYER_FIXTURE_REVIEWED);
    expect(unreviewed.every((wall) => !wall.reviewed)).toBe(true);
    expect(nonStandard.every((wall) => !isStandardThickness(wall.thicknessMm))).toBe(true);
    expect(nonStandard.length).toBeGreaterThan(0);
  });

  it('tìm đúng tường CHƯA DUYỆT kế tiếp, và quay vòng khi tới cuối', () => {
    const walls = FIXTURE_WALLS;
    const first = nextUnreviewedWallId(walls, null);
    const afterFirst = nextUnreviewedWallId(walls, first);

    expect(first).toBe(wallAt(0).id);
    /* W-002 đã duyệt, nên bước kế phải nhảy qua nó. */
    expect(afterFirst).toBe(wallAt(2).id);
  });
});

/* -------------------------------------------------------------------------- */
/* A5 — xanh "đã xác minh" chỉ đánh dấu việc người duyệt.                      */
/* -------------------------------------------------------------------------- */

describe('A5', () => {
  it('lệnh duyệt luôn đặt source người, không có đường nào để AI bật cờ xanh', () => {
    const before = wallAt(0);
    const command = buildApproveWallCommand(before, 'nguoi-duyet');
    const change = command.changes[0];
    const after = change?.after as Wall;

    expect(command.type).toBe(WALL_APPROVE_COMMAND_TYPE);
    expect(command.description).not.toHaveLength(0);
    expect(after.reviewed).toBe(true);
    expect(after.source).toBe('human');
    /* Ảnh chụp `before` ĐẦY ĐỦ — đó là thứ làm `Ctrl+Z` chạy được, xem mục C.5. */
    expect(change?.before).toEqual(before);
  });

  it('không tường nào trong bộ mẫu vừa reviewed vừa source ai', () => {
    const offenders = WALL_LAYER_FIXTURE_WALLS.filter(
      (wall) => wall.reviewed && wall.source === 'ai',
    );

    expect(offenders).toHaveLength(0);
  });
});

/* -------------------------------------------------------------------------- */
/* Nghiệm thu bàn phím — phép kiểm quan trọng nhất.                             */
/* -------------------------------------------------------------------------- */

describe('phím C: đổi về chuẩn + duyệt là MỘT bước hoàn tác (Z/S-15)', () => {
  /* Thang sáu bậc: 175 mm cách đều 150 và 200 — hoà về bậc nhỏ (standardizeThickness). */
  it('W-006 175 mm → 150 mm và đã duyệt; một Ctrl+Z trả cả hai', async () => {
    const mounted = await mountSettled();
    const target = wallAt(5);
    const thicknessNow = (): number | undefined => {
      const entity = useStore.getState().spatial?.byId[target.id];

      return entity !== undefined && 'thicknessMm' in entity ? entity.thicknessMm : undefined;
    };
    const reviewedBefore = mounted.result.current.panel.reviewCounter.reviewed;

    expect(target.thicknessMm).toBe(175);

    await act(async () => {
      mounted.result.current.panel.onSelect(target.id);
      await Promise.resolve();
    });
    await pressKey(mounted.registry, 'C');

    await waitFor(() => {
      expect(mounted.result.current.panel.reviewCounter.reviewed).toBe(reviewedBefore + 1);
    });
    expect(thicknessNow()).toBe(150);

    await pressKey(mounted.registry, 'z', { ctrlKey: true });

    await waitFor(() => {
      expect(mounted.result.current.panel.reviewCounter.reviewed).toBe(reviewedBefore);
    });
    expect(thicknessNow()).toBe(175);

    mounted.unmount();
  });
});

describe('nghiệm thu bàn phím', () => {
  it('duyệt 5 tường rồi hoàn tác 5 lần: 12 → 17 → 12', async () => {
    const mounted = await mountSettled();
    const counterNow = (): number => mounted.result.current.panel.reviewCounter.reviewed;

    expect(mounted.result.current.panel.reviewCounter.total).toBe(WALL_LAYER_FIXTURE_TOTAL);

    const climbing: number[] = [counterNow()];

    for (let index = 0; index < APPROVALS; index += 1) {
      /* `J` — xuống cho tới hàng CHƯA DUYỆT kế tiếp, qua sổ phím thật. */
      const target = await pressUntilUnreviewed(mounted);

      expect(target).not.toBeNull();

      /* Hành động mặc định của hàng đang có tiêu điểm — đúng việc `Enter` làm. */
      await act(async () => {
        mounted.result.current.panel.onApprove(target as WallId);
        await Promise.resolve();
      });

      const reached = lastOf(climbing) + 1;

      await waitFor(() => {
        expect(counterNow()).toBe(reached);
      });

      climbing.push(counterNow());
    }

    const falling: number[] = [];

    for (let index = 0; index < APPROVALS; index += 1) {
      const before = counterNow();

      await pressKey(mounted.registry, 'z', { ctrlKey: true });

      await waitFor(() => {
        expect(counterNow()).not.toBe(before);
      });

      falling.push(counterNow());
    }

    /* In ra dãy đếm — một bước nhảy sai ở giữa cũng lộ, không chỉ hai đầu. */
    console.log(`dãy đếm lên:    ${climbing.join(', ')}`);
    console.log(`dãy đếm xuống:  ${falling.join(', ')}`);

    expect(climbing).toEqual([12, 13, 14, 15, 16, 17]);
    expect(falling).toEqual([16, 15, 14, 13, 12]);
    expect(counterNow()).toBe(WALL_LAYER_FIXTURE_REVIEWED);

    mounted.unmount();
  });

  it('duyệt xong một tường thì tự chọn tường CHƯA DUYỆT kế tiếp', async () => {
    const mounted = await mountSettled();

    await act(async () => {
      mounted.result.current.panel.onSelect(wallAt(0).id);
      await Promise.resolve();
    });

    await act(async () => {
      mounted.result.current.panel.onApprove(wallAt(0).id);
      await Promise.resolve();
    });

    /* W-002 đã duyệt sẵn, nên con trỏ phải nhảy qua nó tới W-003. */
    await waitFor(() => {
      expect(mounted.result.current.panel.selectedWallId).toBe(wallAt(2).id);
    });

    mounted.unmount();
  });

  it('J và K đi xuống rồi đi lên đúng một hàng', async () => {
    const mounted = await mountSettled();

    await pressKey(mounted.registry, 'J');
    const first = mounted.result.current.panel.selectedWallId;

    await pressKey(mounted.registry, 'J');
    const second = mounted.result.current.panel.selectedWallId;

    await pressKey(mounted.registry, 'K');

    /* Một hàng đợi (Z/S-15): J đi theo thứ tự danh sách — không chuẩn trước, đã duyệt cuối. */
    const rows = mounted.result.current.panel.rows;

    expect(first).toBe(rows[0]?.id);
    expect(second).toBe(rows[1]?.id);
    expect(mounted.result.current.panel.selectedWallId).toBe(first);

    mounted.unmount();
  });

  it('Escape bỏ chọn tường (B-V6-11 — trước bản sửa Escape không làm gì ở màn này)', async () => {
    const mounted = await mountSettled();

    await pressKey(mounted.registry, 'J');
    expect(mounted.result.current.panel.selectedWallId).toBe(mounted.result.current.panel.rows[0]?.id);

    await pressKey(mounted.registry, 'Escape');

    expect(mounted.result.current.panel.selectedWallId).toBeNull();

    mounted.unmount();
  });

  it('Escape đang "So sánh hai bên": lần đầu bỏ chọn, lần sau mới thoát so sánh', async () => {
    setQcCompare(true);
    const mounted = await mountSettled();

    await pressKey(mounted.registry, 'J');
    await pressKey(mounted.registry, 'Escape');
    expect(mounted.result.current.panel.selectedWallId).toBeNull();
    expect(isQcCompare()).toBe(true);

    await pressKey(mounted.registry, 'Escape');
    expect(isQcCompare()).toBe(false);

    mounted.unmount();
  });

  it('Escape giữa lúc vẽ bỏ nét đang dở, không thêm tường', async () => {
    const mounted = await mountSettled();
    const before = wallCount();

    await pressKey(mounted.registry, shortcutForTool('drawWall'));
    await act(async () => {
      mounted.result.current.canvas.onCanvasPoint(asCanvasPoint({ x: 20000, y: 20000 }));
      await Promise.resolve();
    });
    await pressKey(mounted.registry, 'Escape');
    await act(async () => {
      mounted.result.current.canvas.onCanvasPoint(asCanvasPoint({ x: 22400, y: 20000 }));
      await Promise.resolve();
    });

    /* Điểm thứ hai giờ là điểm ĐẦU của một nét mới, nên chưa có tường nào được chốt. */
    expect(wallCount()).toBe(before);

    mounted.unmount();
  });
});

/* -------------------------------------------------------------------------- */
/* Đổi độ dày — qua lệnh S-07, không đặt state thẳng.                          */
/* -------------------------------------------------------------------------- */

describe('đổi độ dày', () => {
  it('dựng đúng lệnh wall.changeThickness của S-07', () => {
    const wall = wallAt(0);
    const built = buildChangeThicknessCommand(
      { wallId: wall.id, thicknessMm: thicknessChoice(1) },
      commandContextOf(FIXTURE_GRAPH, 'nguoi-duyet'),
    );

    expect(built.ok).toBe(true);
    expect(built.ok && built.data.type).toBe(WALL_COMMAND_TYPES.changeThickness);
  });

  it('đi qua tầng lệnh nên hoàn tác được, và không đụng cờ duyệt', async () => {
    const mounted = await mountSettled();
    const wall = wallAt(0);
    const target = thicknessChoice(0);

    await act(async () => {
      mounted.result.current.panel.onChangeThickness(wall.id, target);
      await Promise.resolve();
    });

    const changed = (): Wall =>
      wallsOfLevel(useStore.getState().spatial, FIXTURE_LEVEL.id).find(
        (item) => item.id === wall.id,
      ) as Wall;

    await waitFor(() => {
      expect(changed().thicknessMm).toBe(target);
    });
    /* Đổi độ dày KHÔNG phải duyệt: cờ review giữ nguyên (A5). */
    expect(changed().reviewed).toBe(wall.reviewed);
    expect(changed().source).toBe(wall.source);

    /* Hoàn tác được nghĩa là lệnh đã đi qua `dispatch` chứ không phải một lượt ghi tắt. */
    await act(async () => {
      mounted.result.current.panel.onUndo();
      await Promise.resolve();
    });

    await waitFor(() => {
      expect(changed().thicknessMm).toBe(wall.thicknessMm);
    });

    mounted.unmount();
  });

  it('P03: đổi chiều dài giữ đầu tường, dời đầu cuối dọc hướng tường, hoàn tác được', async () => {
    const mounted = await mountSettled();
    const wall = wallAt(0);
    const { start, end } = wall.centreline;
    const length = Math.hypot(end.x - start.x, end.y - start.y);
    const next = Math.round(length / 2);
    const current = (): Wall =>
      wallsOfLevel(useStore.getState().spatial, FIXTURE_LEVEL.id).find((item) => item.id === wall.id) as Wall;

    await act(async () => {
      mounted.result.current.panel.onChangeLength?.(wall.id, next);
      await Promise.resolve();
    });

    await waitFor(() => {
      expect(current().centreline.end.x).toBeCloseTo(start.x + ((end.x - start.x) * next) / length, 3);
    });
    expect(current().centreline.start).toEqual(start);
    expect(current().centreline.end.y).toBeCloseTo(start.y + ((end.y - start.y) * next) / length, 3);

    await act(async () => {
      mounted.result.current.panel.onUndo();
      await Promise.resolve();
    });

    await waitFor(() => {
      expect(current().centreline.end).toEqual(end);
    });

    mounted.unmount();
  });

  it('ba lựa chọn độ dày là ba băng của hệ thiết kế, không phải ô nhập tự do', async () => {
    const mounted = await mountSettled();

    expect(mounted.result.current.panel.thicknessChoices).toEqual([...WALL_LAYER_THICKNESS_CHOICES]);
    expect(mounted.result.current.panel.thicknessChoices).toHaveLength(6);

    mounted.unmount();
  });
});

/* -------------------------------------------------------------------------- */
/* Xoá (D-05) — tức thì, vé hoàn tác, KHÔNG hộp thoại.                         */
/* -------------------------------------------------------------------------- */

describe('xoá', () => {
  it('xoá ngay và không mở hộp thoại nào', async () => {
    const mounted = await mountSettled();
    const wall = wallAt(0);

    await act(async () => {
      mounted.result.current.panel.onDelete(wall.id);
      await Promise.resolve();
    });

    await waitFor(() => {
      const remaining = wallsOfLevel(useStore.getState().spatial, FIXTURE_LEVEL.id);

      expect(remaining.some((item) => item.id === wall.id)).toBe(false);
    });

    expect(useStore.getState().openDialog).toBeNull();

    mounted.unmount();
  });

  it('vé hoàn tác xoá tường sống cửa sổ dài 15 s (U35) và gọi lại lượt hoàn tác', () => {
    let undone = 0;
    let clock = 0;
    const ticket = createWallUndoTicket({
      wallId: wallAt(0).id,
      now: () => clock,
      undo: () => {
        undone += 1;
      },
    });

    expect(ticket.expiresAt - 0).toBe(LONG_UNDO_WINDOW_MS);
    expect(ticket.ttlMs).toBe(LONG_UNDO_WINDOW_MS);
    expect(LONG_UNDO_WINDOW_MS).toBeGreaterThan(UNDO_WINDOW_MS);
    clock = UNDO_WINDOW_MS + 1;
    expect(ticket.getStatus()).toBe('active');

    const used = ticket.undo();

    expect(used.ok).toBe(true);
    expect(undone).toBe(1);

    clock = UNDO_WINDOW_MS + 1;
    expect(ticket.getStatus()).toBe('used');
  });
});

/* -------------------------------------------------------------------------- */
/* Vai Người xem — trạng thái 6.                                               */
/* -------------------------------------------------------------------------- */

describe('vai Người xem', () => {
  it('mọi hàm sửa vô hiệu ở tầng hook, không chỉ ẩn ở view', async () => {
    const mounted = await mountSettled({ roles: ['viewer'] });
    const wall = wallAt(0);
    const before = mounted.result.current.panel.reviewCounter.reviewed;

    expect(mounted.result.current.panel.state).toBe('forbidden');
    expect(mounted.result.current.panel.isViewerRole).toBe(true);
    expect(mounted.result.current.panel.viewerRoleNotice).not.toBeNull();
    expect(mounted.result.current.canvas.isInteractive).toBe(false);

    await act(async () => {
      mounted.result.current.panel.onApprove(wall.id);
      mounted.result.current.panel.onChangeThickness(wall.id, thicknessChoice(0));
      mounted.result.current.panel.onDelete(wall.id);
      mounted.result.current.panel.onMerge(wall.id, wallAt(1).id);
      mounted.result.current.panel.onUndo();
      await Promise.resolve();
    });

    const walls = wallsOfLevel(useStore.getState().spatial, FIXTURE_LEVEL.id);

    expect(walls).toHaveLength(WALL_LAYER_FIXTURE_TOTAL);
    expect(walls.filter((item) => item.reviewed)).toHaveLength(WALL_LAYER_FIXTURE_REVIEWED);
    expect(mounted.result.current.panel.reviewCounter.reviewed).toBe(before);

    mounted.unmount();
  });

  it('khoá tỷ lệ: sửa/duyệt bị từ chối ở hook, danh sách vẫn xem được, có lý do và lối sang bước Tỷ lệ', async () => {
    scaleLockState.locked = true;
    const onNavigate = vi.fn();
    const mounted = await mountSettled({ onNavigate });
    const wall = wallsOfLevel(useStore.getState().spatial, FIXTURE_LEVEL.id).find((item) => !item.reviewed);

    if (wall === undefined) {
      throw new Error('bộ mẫu thiếu tường chưa duyệt');
    }

    const before = mounted.result.current.panel.reviewCounter.reviewed;

    try {
      expect(mounted.result.current.panel.rows.length).toBeGreaterThan(0);
      expect(mounted.result.current.panel.scaleLock?.reason).toBe('Đặt tỷ lệ trước: tầng này chưa có tỷ lệ đúng');

      await act(async () => {
        mounted.result.current.panel.onApprove(wall.id);
        mounted.result.current.panel.onChangeThickness(wall.id, thicknessChoice(0));
        mounted.result.current.panel.onMerge(wall.id, wallAt(1).id);
        await Promise.resolve();
      });

      const walls = wallsOfLevel(useStore.getState().spatial, FIXTURE_LEVEL.id);

      expect(walls).toHaveLength(WALL_LAYER_FIXTURE_TOTAL);
      expect(walls.find((item) => item.id === wall.id)).toMatchObject({ reviewed: false, thicknessMm: wall.thicknessMm });
      expect(mounted.result.current.panel.reviewCounter.reviewed).toBe(before);

      mounted.result.current.panel.scaleLock?.onOpenScale();
      expect(onNavigate).toHaveBeenCalledWith(expect.stringContaining('scale'));
    } finally {
      scaleLockState.locked = false;
      mounted.unmount();
    }
  });

  it('G4a-09: phím Delete xoá đoạn đang chọn như Backspace', async () => {
    const mounted = await mountSettled();

    await act(async () => {
      mounted.result.current.panel.onSelect(wallAt(0).id);
      await Promise.resolve();
    });
    await pressKey(mounted.registry, 'Delete');
    await act(async () => {
      await Promise.resolve();
    });

    expect(wallsOfLevel(useStore.getState().spatial, FIXTURE_LEVEL.id)).toHaveLength(
      WALL_LAYER_FIXTURE_TOTAL - 1,
    );

    mounted.unmount();
  });

  it('phím xoá cũng không làm gì ở vai Người xem', async () => {
    const mounted = await mountSettled({ roles: ['viewer'] });

    await act(async () => {
      mounted.result.current.panel.onSelect(wallAt(0).id);
      await Promise.resolve();
    });
    await pressKey(mounted.registry, 'Backspace');

    expect(wallsOfLevel(useStore.getState().spatial, FIXTURE_LEVEL.id)).toHaveLength(
      WALL_LAYER_FIXTURE_TOTAL,
    );

    mounted.unmount();
  });
});

/* -------------------------------------------------------------------------- */
/* Bảy trạng thái qua hook thật.                                               */
/* -------------------------------------------------------------------------- */

describe('Bảy trạng thái', () => {
  /*
   * Bài kiểm này ĐỔI CÁCH ÉP trạng thái lỗi, và đó là điểm của nó.
   *
   * Tiêu đề nó vẫn nói đúng điều đặc tả đòi — "lỗi LỚP TƯỜNG vẫn để ảnh gốc xem
   * được" — nhưng bản trước ép trạng thái bằng `failReadBackground`, tức bằng
   * cách giết chính ẢNH GỐC mà nó đang khẳng định là còn xem được, rồi chỉ đo
   * `canvas.shapes` thay cho ảnh. Nay nó ép bằng `failReadWallLayer` và đo đúng
   * thứ phải đo: `backgroundImageUrl` khác `null`.
   */
  it('lỗi lớp tường vẫn để ảnh gốc xem được', async () => {
    const mounted = await mountSettled({
      gateway: createMockWallLayerReviewGateway({
        graph: FIXTURE_GRAPH,
        failReadWallLayer: true,
      }),
    });

    expect(mounted.result.current.panel.state).toBe('error');
    expect(mounted.result.current.panel.errorMessage).not.toBeNull();
    /* Danh sách trắng nhưng canvas KHÔNG trắng: hình tường vẫn dựng được. */
    expect(mounted.result.current.panel.rows).toHaveLength(0);
    expect(mounted.result.current.canvas.shapes.length).toBeGreaterThan(0);
    /* Điều khoản nặng nhất của BT-06/BT-07: ảnh bản vẽ gốc KHÔNG được mất. */
    expect(mounted.result.current.canvas.backgroundImageUrl).not.toBeNull();
    expect(mounted.result.current.canvas.backgroundImageAlt.length).toBeGreaterThan(0);

    mounted.unmount();
  });

  it('ảnh nền hỏng KHÔNG bị đọc thành lớp tường hỏng', async () => {
    const mounted = await mountSettled({
      gateway: createMockWallLayerReviewGateway({
        graph: FIXTURE_GRAPH,
        failReadBackground: true,
      }),
    });

    /*
     * Hai lượt đọc, hai khoá, hai ý nghĩa: mất ảnh nền là mất một lớp tham
     * chiếu, không phải mất lớp tường. Danh sách vẫn đọc được và bộ đếm vẫn
     * đếm — nếu bài kiểm này đỏ thì hai nguồn lỗi lại vừa bị gộp làm một.
     */
    expect(mounted.result.current.panel.state).not.toBe('error');
    expect(mounted.result.current.panel.errorMessage).toBeNull();
    expect(mounted.result.current.panel.rows.length).toBe(WALL_LAYER_FIXTURE_TOTAL);
    expect(mounted.result.current.canvas.backgroundImageUrl).toBeNull();

    mounted.unmount();
  });

  it('thu gọn là một trạng thái của vỏ màn, không làm mất dữ liệu', async () => {
    const mounted = await mountSettled({ forceCollapsed: true });

    expect(mounted.result.current.panel.state).toBe('collapsed');
    expect(mounted.result.current.panel.isCollapsed).toBe(true);
    expect(mounted.result.current.panel.reviewCounter.total).toBe(WALL_LAYER_FIXTURE_TOTAL);

    mounted.unmount();
  });
});

/* -------------------------------------------------------------------------- */
/* Ray công cụ, thanh trạng thái, thanh tra.                                   */
/* -------------------------------------------------------------------------- */

describe('ray công cụ và thanh trạng thái', () => {
  it('nối đoạn là hành động theo VÙNG CHỌN, chỉ bật khi đúng hai tường được chọn', async () => {
    const mounted = await mountSettled();

    expect(mounted.result.current.toolRail.canMerge).toBe(false);

    await act(async () => {
      useStore.getState().setSelection([wallAt(0).id, wallAt(1).id]);
      await Promise.resolve();
    });

    expect(mounted.result.current.toolRail.canMerge).toBe(true);

    mounted.unmount();
  });

  it('phím công cụ đổi đúng công cụ đang dùng', async () => {
    const mounted = await mountSettled();

    expect(mounted.result.current.toolRail.activeTool).toBe('select');

    await pressKey(mounted.registry, shortcutForTool('measure'));
    expect(mounted.result.current.toolRail.activeTool).toBe('measure');

    await pressKey(mounted.registry, shortcutForTool('select'));
    expect(mounted.result.current.toolRail.activeTool).toBe('select');

    mounted.unmount();
  });

  it('thanh trạng thái cấp đủ BA chuỗi đã định dạng của hợp đồng đã chốt', async () => {
    const mounted = await mountSettled();
    const { statusBar } = mounted.result.current;

    expect(statusBar.scaleLabel).toContain('mm/px');
    expect(statusBar.saveLabel.length).toBeGreaterThan(0);
    /* Chưa rê chuột lần nào: dấu thiếu, KHÔNG phải một toạ độ bịa ra. */
    expect(statusBar.cursorLabel).toBe(CURSOR_IDLE_LABEL);

    mounted.unmount();
  });

  it('bộ đếm duyệt ở panel, đúng một chỗ — thanh trạng thái không giữ bản thứ hai', async () => {
    const mounted = await mountSettled();

    expect(mounted.result.current.panel.reviewProgressLabel).toContain('tường đã duyệt');
    expect(mounted.result.current.panel.reviewProgressLabel).toContain(
      String(WALL_LAYER_FIXTURE_TOTAL),
    );

    mounted.unmount();
  });

  it('toạ độ con trỏ: canvas báo số thô, hook trả về chuỗi milimét đã định dạng', async () => {
    const mounted = await mountSettled();

    await act(async () => {
      mounted.result.current.canvas.onPointerMove({ xPx: 100, yPx: 80 });
      await nextFrame();
    });

    expect(mounted.result.current.statusBar.cursorLabel).not.toBe(CURSOR_IDLE_LABEL);
    expect(mounted.result.current.statusBar.cursorLabel).toContain('mm');

    await act(async () => {
      mounted.result.current.canvas.onPointerMove(null);
      await nextFrame();
    });

    expect(mounted.result.current.statusBar.cursorLabel).toBe(CURSOR_IDLE_LABEL);

    mounted.unmount();
  });

  it('thanh tra định dạng số theo A15 — dấu phẩy thập phân, đơn vị viết một lần', () => {
    const inspector = toWallInspector(wallAt(13), FIXTURE_LEVEL);

    /* Mã máy dài ra để tầng lệnh nhận; nhãn thanh tra vẫn đúng "#W-014" đặc tả đòi. */
    expect(inspector.codeLabel).toBe('#W-014');
    /* W-014 dài 2.500 mm: "2.500 mm" — chấm ngăn nghìn, milimét nguyên, cùng số với cột "Dài, mm" (K16). */
    expect(inspector.lengthLabel).toBe('2.500 mm');
    /*
     * Chiều cao ở CÙNG cột milimét với chiều dài (BC-26).
     *
     * Bản trước khẳng định "3,00 m" — đúng thứ `formatLength` không có đơn vị
     * sẽ trả về, và sai thứ đặc tả đòi: hai dòng cạnh nhau của thanh tra không
     * được đọc bằng hai đơn vị khác nhau. Đây là đổi ĐẶC TẢ HIỂN THỊ, không
     * phải nới một điều kiện — chuỗi mới chặt hơn chuỗi cũ, không lỏng hơn.
     */
    expect(inspector.heightLabel).toBe('3.000 mm');
    expect(inspector.kindLabel).toBe('vách ngăn');
  });
});

/* -------------------------------------------------------------------------- */
/* Hợp đồng canvas MỞ RỘNG — những trường lớp canvas (T7) đòi thêm.            */
/* -------------------------------------------------------------------------- */

describe('hợp đồng canvas mở rộng', () => {
  it('cấp đủ hình tường bằng PIXEL bản vẽ, không phải milimét đồ thị', async () => {
    const mounted = await mountSettled();
    const shape = mounted.result.current.canvas.shapes[0];

    expect(shape).toBeDefined();
    expect(shape?.codeLabel).toBe('#W-001');
    expect(shape?.thicknessMm).toBe(wallAt(0).thicknessMm);
    expect(shape?.outline.length).toBeGreaterThanOrEqual(4);
    expect(shape?.boundsPx.width).toBeGreaterThan(0);
    expect(shape?.boundsPx.height).toBeGreaterThan(0);
    expect(shape?.centrelinePx.start).toBeDefined();

    /*
     * Phép kiểm phân biệt hai đơn vị: bộ mẫu chạy ở 12 mm/px, nên bề ngang tính
     * bằng PIXEL phải NHỎ HƠN hẳn bề ngang tính bằng milimét của cùng lưới đó.
     * Quên một lượt quy đổi là con số này bằng nhau, và bài kiểm đỏ.
     */
    const bounds = mounted.result.current.canvas.contentBoundsPx;
    const gridWidthMm = wallAt(4).centreline.end.x;

    expect(bounds).not.toBeNull();
    expect(bounds?.width).toBeGreaterThan(0);
    expect(bounds?.width).toBeLessThan(gridWidthMm);

    mounted.unmount();
  });

  it('nói ra trạng thái, nhãn khung, chú giải và cờ lớp Tường', async () => {
    const mounted = await mountSettled();
    const { canvas } = mounted.result.current;

    expect(canvas.state).toBe(mounted.result.current.panel.state);
    expect(canvas.canvasLabel).toContain(FIXTURE_LEVEL.name);
    expect(canvas.canvasLabel).toContain(String(WALL_LAYER_FIXTURE_TOTAL));
    expect(canvas.isWallLayerVisible).toBe(true);
    /* Thang sáu bậc: 175/235/90 mm nay nằm trong dung sai (150/220/100), chú giải ba nhóm màu, không có mục "Khác". */
    expect(canvas.legendLevels).toMatchObject({ levels: [110, 220, 330], hasUnbanded: false, activeFilter: null });
    expect(canvas.drawingSizePx).not.toBeNull();
    expect(canvas.measurement).toBeNull();

    mounted.unmount();
  });

  it('[BUG-403] mở tầng là thấy trọn lớp tường giữa khung, 100% = vừa khung', async () => {
    const mounted = await mountSettled();

    act(() => mounted.result.current.canvas.onFrameResize({ width: 300, height: 480 }));

    await waitFor(() => expect(mounted.result.current.canvas.viewport.zoom).toBeLessThan(1));
    const { canvas } = mounted.result.current;
    const bounds = canvas.contentBoundsPx!;
    const box = {
      x: canvas.viewport.x + bounds.x * canvas.viewport.zoom,
      y: canvas.viewport.y + bounds.y * canvas.viewport.zoom,
      width: bounds.width * canvas.viewport.zoom,
      height: bounds.height * canvas.viewport.zoom,
    };

    expect(canvas.zoomPercent).toBe(100);
    /* Gạch chéo/chấm chú ý tính theo px MÀN: một px màn = 1 / hệ số, bằng px bản vẽ (review-1 #3). */
    expect(canvas.unitPx).toBeCloseTo(1 / canvas.viewport.zoom, 9);
    expect(box.x).toBeGreaterThanOrEqual(0);
    expect(box.y).toBeGreaterThanOrEqual(0);
    expect(box.x + box.width).toBeLessThanOrEqual(300 + 0.5);
    expect(box.y + box.height).toBeLessThanOrEqual(480 + 0.5);
    expect(box.x + box.width / 2).toBeCloseTo(150, 0);
    expect(box.y + box.height / 2).toBeCloseTo(240, 0);

    mounted.unmount();
  });

  it('[G4a-19] kéo bản vẽ dời khung nhìn đúng bằng độ kéo, mức phóng giữ nguyên', async () => {
    const mounted = await mountSettled();

    act(() => mounted.result.current.canvas.onFrameResize({ width: 300, height: 480 }));
    await waitFor(() => expect(mounted.result.current.canvas.viewport.zoom).toBeLessThan(1));

    const before = mounted.result.current.canvas.viewport;

    act(() => mounted.result.current.canvas.onPanBy(40, -25));

    await waitFor(() => expect(mounted.result.current.canvas.viewport.x).not.toBe(before.x));
    const after = mounted.result.current.canvas.viewport;

    expect(after.zoom).toBe(before.zoom);
    expect(after.x - before.x).toBeCloseTo(40, 3);
    expect(after.y - before.y).toBeCloseTo(-25, 3);

    mounted.unmount();
  });

  it('[BUG-403] bản đồ nhỏ đi theo thu phóng — vùng nhìn hẹp lại khi phóng to', async () => {
    const mounted = await mountSettled();

    act(() => mounted.result.current.canvas.onFrameResize({ width: 300, height: 480 }));
    await waitFor(() => expect(mounted.result.current.canvas.viewport.zoom).toBeLessThan(1));
    expect(mounted.result.current.canvas.drawingSizePx).not.toBeNull();

    const before = mounted.result.current.canvas.miniMapViewport;

    /* Vừa khung chừa lề 8% (CANVAS_FIT_MARGIN_RATIO 0,92): 6 nấc (250%) chưa đủ để chiều cao
       nhìn thấy hẹp hơn bản vẽ trong khung 300×480, nên phóng 10 nấc (350%). */
    for (let step = 0; step < 10; step += 1) {
      act(() => mounted.result.current.canvas.onZoomIn());
    }

    await waitFor(() => expect(mounted.result.current.canvas.miniMapViewport.width).toBeLessThan(before.width));
    expect(mounted.result.current.canvas.miniMapViewport.height).toBeLessThan(before.height);

    mounted.unmount();
  });

  it('[BUG-403] sửa tường (xoá cột tường biên trái) không tự phóng/dịch mặt bằng — mốc vừa khung chốt theo tầng', async () => {
    const mounted = await mountSettled();

    act(() => mounted.result.current.canvas.onFrameResize({ width: 300, height: 480 }));
    await waitFor(() => expect(mounted.result.current.canvas.viewport.zoom).toBeLessThan(1));

    const before = mounted.result.current.canvas.viewport;
    const bounds = mounted.result.current.canvas.contentBoundsPx!;
    const edges = mounted.result.current.canvas.shapes.filter((shape) => shape.boundsPx.x === bounds.x);

    for (const edge of edges) {
      await act(async () => {
        mounted.result.current.panel.onDelete(edge.id);
        await Promise.resolve();
      });
    }
    await waitFor(() => expect(mounted.result.current.canvas.contentBoundsPx).not.toEqual(bounds));

    expect(mounted.result.current.canvas.viewport).toEqual(before);

    mounted.unmount();
  });

  it('bốn mục menu chuột phải nối vào đúng việc của chúng', async () => {
    const mounted = await mountSettled();
    const wall = wallAt(0);

    await act(async () => {
      mounted.result.current.canvas.onRequestSplit(wall.id);
      await Promise.resolve();
    });

    expect(mounted.result.current.panel.selectedWallId).toBe(wall.id);
    expect(mounted.result.current.toolRail.activeTool).toBe('splitWall');

    await act(async () => {
      mounted.result.current.canvas.onRequestThicknessChange(wall.id);
      await Promise.resolve();
    });

    /* Xin đổi độ dày = đưa tường vào thanh tra, nơi có điều khiển ba lựa chọn. */
    expect(mounted.result.current.panel.inspector?.id).toBe(wall.id);

    await act(async () => {
      mounted.result.current.canvas.onApprove(wall.id);
      await Promise.resolve();
    });

    await waitFor(() => {
      expect(mounted.result.current.panel.reviewCounter.reviewed).toBe(
        WALL_LAYER_FIXTURE_REVIEWED + 1,
      );
    });

    mounted.unmount();
  });
});

/* -------------------------------------------------------------------------- */
/* Ba công cụ vừa được NỐI DÂY — vẽ tường, tách đoạn, đo.                      */
/* -------------------------------------------------------------------------- */

/*
 * Vì sao bốn bài kiểm dưới đây tồn tại.
 *
 * Trước lượt sửa này máy công cụ chỉ nhận `{ type: 'activate' }`: bấm `W` đổi
 * được biểu tượng đang sáng và KHÔNG vẽ được gì, `M` cũng vậy, còn "Tách đoạn"
 * của menu chuột phải chỉ bật công cụ rồi đứng im. Ba nút chết đó đi qua mọi
 * cổng — typecheck, lint, và cả `toolRail.activeTool` của bài kiểm cũ — vì
 * "công cụ đang chọn đã đổi" là một câu đúng về một việc không xảy ra.
 *
 * Nên bốn bài kiểm này đo THỨ KHÁC: số tường trong kho sau một cử chỉ, và nhãn
 * đo mà canvas nhận được. Sửa một nút chết mà không có phép đo như vậy thì lần
 * sau nó chết lại mà không ai biết.
 */

describe('công cụ đã nối dây', () => {
  it('vẽ tường: bấm hai điểm trên canvas thì kho có thêm một tường', async () => {
    const mounted = await mountSettled();
    const before = wallCount();

    await pressKey(mounted.registry, shortcutForTool('drawWall'));
    expect(mounted.result.current.toolRail.activeTool).toBe('drawWall');

    /* Đoạn bộ mẫu cố ý bỏ: x=5.000, y 2.200→4.400 — hai đầu là đỉnh có sẵn, chỉ dùng chung đỉnh. */
    await act(async () => {
      mounted.result.current.canvas.onCanvasPoint(asCanvasPoint({ x: 5000, y: 2200 }));
      await Promise.resolve();
    });
    await act(async () => {
      mounted.result.current.canvas.onCanvasPoint(asCanvasPoint({ x: 5000, y: 4400 }));
      await Promise.resolve();
    });

    await waitFor(() => {
      expect(wallCount()).toBe(before + 1);
    });

    /* Cử chỉ đã chốt xong, máy công cụ về `ready` chứ không kẹt ở `confirming`. */
    expect(mounted.result.current.canvas.measurement).toBeNull();

    mounted.unmount();
  });

  /* [16-A-040] Hai cú bấm (toạ độ mm LẺ, như chuột thật) vẽ một tường dày 110 mm và ĐẨY đúng một PUT hợp lệ (QA p04 rr3). */
  it('[16-A-040] vẽ tường: hai điểm → một PUT chứa tường mới dày 110 mm, công cụ vẽ vẫn bật', async () => {
    const apiClient = createMockApiClient();
    const writeLayer = vi.spyOn(apiClient.spatial, 'writeLayer');
    const gateway = createMockWallLayerReviewGateway({ apiClient, graph: FIXTURE_GRAPH });
    const mounted = await mountSettled({ gateway });
    const before = wallCount();

    await pressKey(mounted.registry, shortcutForTool('drawWall'));
    await act(async () => {
      mounted.result.current.canvas.onCanvasPoint(asCanvasPoint({ x: 5000.4, y: 2200.6 }));
      await Promise.resolve();
    });
    await act(async () => {
      mounted.result.current.canvas.onCanvasPoint(asCanvasPoint({ x: 5000.7, y: 4400.3 }));
      await Promise.resolve();
    });
    await waitFor(() => {
      expect(wallCount()).toBe(before + 1);
    });
    await act(async () => {
      await flushAutosaves();
    });

    expect(writeLayer).toHaveBeenCalledTimes(1);
    const sent = writeLayer.mock.calls[0]?.[0] as unknown as { body: { layer: { walls: { id: string; thicknessMm: number }[] } } };
    const parsed = FloorLayerWriteSchema.safeParse({ baseVersion: (sent as unknown as { baseVersion: number }).baseVersion, body: sent.body });
    expect(parsed.success ? [] : parsed.error.issues, 'PUT body passes the write schema').toEqual([]);
    expect(sent.body.layer.walls).toHaveLength(before + 1);
    expect(sent.body.layer.walls.filter((w) => w.thicknessMm === 110).length).toBeGreaterThanOrEqual(1);
    expect(mounted.result.current.toolRail.activeTool).toBe('drawWall');

    mounted.unmount();
  });

  it('tách đoạn: chọn tường rồi bấm điểm cắt thì một tường thành hai', async () => {
    const mounted = await mountSettled();
    const target = wallAt(0);
    const before = wallCount();

    /* Menu chuột phải "Tách đoạn" — chọn tường, bật công cụ, điền bước đầu. */
    await act(async () => {
      mounted.result.current.canvas.onRequestSplit(target.id);
      await Promise.resolve();
    });

    expect(mounted.result.current.toolRail.activeTool).toBe('splitWall');

    const middle: Point = {
      x: (target.centreline.start.x + target.centreline.end.x) / 2,
      y: (target.centreline.start.y + target.centreline.end.y) / 2,
    };

    await act(async () => {
      mounted.result.current.canvas.onCanvasPoint(asCanvasPoint(middle));
      await Promise.resolve();
    });

    await waitFor(() => {
      expect(wallCount()).toBe(before + 1);
    });

    mounted.unmount();
  });

  it('đo: bấm hai điểm cho ra một nhãn đo THẬT, không phải null cứng', async () => {
    const mounted = await mountSettled();

    await pressKey(mounted.registry, shortcutForTool('measure'));
    expect(mounted.result.current.canvas.measurement).toBeNull();

    await act(async () => {
      mounted.result.current.canvas.onCanvasPoint(asCanvasPoint({ x: 0, y: 0 }));
      await Promise.resolve();
    });
    await act(async () => {
      mounted.result.current.canvas.onCanvasPoint(asCanvasPoint({ x: 2500, y: 0 }));
      await Promise.resolve();
    });

    const measurement = mounted.result.current.canvas.measurement;

    expect(measurement).not.toBeNull();
    expect(measurement?.state).toBe('committed');
    /* Số đo do `measureDistance` của `src/domain/measure` tính, không phải màn. */
    expect(measurement?.distanceLabel).toBe('2.500,00 mm');
    expect(measurement?.startPx).not.toBeNull();
    expect(measurement?.midPx).not.toBeNull();

    /* Đo xong không được đẻ ra lệnh nào: một lượt đo không đổi bản vẽ. */
    expect(wallCount()).toBe(WALL_LAYER_FIXTURE_TOTAL);

    mounted.unmount();
  });

  it('G4a-23: vẽ tường có nét tạm từ điểm đầu tới con trỏ, tách đoạn có dấu cắt, kèm câu chỉ dẫn', async () => {
    const mounted = await mountSettled();

    await pressKey(mounted.registry, shortcutForTool('drawWall'));
    expect(mounted.result.current.statusBar.cursorLabel).toContain('Bấm điểm đầu');

    await act(async () => {
      mounted.result.current.canvas.onCanvasPoint(asCanvasPoint({ x: 0, y: 0 }));
      await Promise.resolve();
    });
    await act(async () => {
      mounted.result.current.canvas.onPointerMove(asCanvasPoint({ x: 1200, y: 0 }));
      await nextFrame();
    });

    expect(mounted.result.current.canvas.draftGuidePx?.fromPx).not.toBeNull();
    expect(mounted.result.current.statusBar.cursorLabel).toContain('Bấm điểm cuối');

    await pressKey(mounted.registry, shortcutForTool('splitWall'));
    await act(async () => {
      mounted.result.current.canvas.onPointerMove(asCanvasPoint({ x: 600, y: 0 }));
      await nextFrame();
    });

    expect(mounted.result.current.canvas.draftGuidePx).not.toBeNull();
    expect(mounted.result.current.canvas.draftGuidePx?.fromPx).toBeNull();

    await pressKey(mounted.registry, shortcutForTool('select'));
    expect(mounted.result.current.canvas.draftGuidePx).toBeNull();

    mounted.unmount();
  });

  it('đo: sau điểm đầu, nhãn đi theo con trỏ', async () => {
    const mounted = await mountSettled();

    await pressKey(mounted.registry, shortcutForTool('measure'));

    await act(async () => {
      mounted.result.current.canvas.onCanvasPoint(asCanvasPoint({ x: 0, y: 0 }));
      await Promise.resolve();
    });
    await act(async () => {
      mounted.result.current.canvas.onPointerMove(asCanvasPoint({ x: 1200, y: 0 }));
      await nextFrame();
    });

    expect(mounted.result.current.canvas.measurement?.state).toBe('measuring');
    expect(mounted.result.current.canvas.measurement?.distanceLabel).toBe('1.200,00 mm');

    /* Đổi công cụ là bỏ cử chỉ đang dở — nhãn đo đi theo nó. */
    await pressKey(mounted.registry, shortcutForTool('select'));
    expect(mounted.result.current.canvas.measurement).toBeNull();

    mounted.unmount();
  });
});

/* -------------------------------------------------------------------------- */
/* Chọn nhiều — điều kiện để "nối đoạn" thôi là một nút chết.                  */
/* -------------------------------------------------------------------------- */

describe('chọn hai tường rồi nối đoạn', () => {
  it('Ctrl-bấm cộng dồn vùng chọn thay vì thay cả vùng', async () => {
    const mounted = await mountSettled();

    await act(async () => {
      mounted.result.current.canvas.onSelect(wallAt(0).id);
      await Promise.resolve();
    });

    expect(mounted.result.current.toolRail.canMerge).toBe(false);

    await act(async () => {
      mounted.result.current.canvas.onToggleSelect(wallAt(1).id);
      await Promise.resolve();
    });

    /* Hai tường cùng lúc — điều `selectSingle` một mình không bao giờ cho được. */
    expect(useStore.getState().selectedIds).toHaveLength(2);
    expect(mounted.result.current.toolRail.canMerge).toBe(true);

    /* Ctrl-bấm lần nữa lên chính nó thì bớt ra, đúng ngữ nghĩa `toggleSelection`. */
    await act(async () => {
      mounted.result.current.canvas.onToggleSelect(wallAt(1).id);
      await Promise.resolve();
    });

    expect(useStore.getState().selectedIds).toHaveLength(1);
    expect(mounted.result.current.toolRail.canMerge).toBe(false);

    mounted.unmount();
  });

  it('nút "nối đoạn" gọi tới lệnh wall.merge thật và bớt đi một tường', async () => {
    const mounted = await mountSettled();
    const before = wallCount();

    await act(async () => {
      mounted.result.current.canvas.onSelect(wallAt(0).id);
      await Promise.resolve();
    });
    await act(async () => {
      mounted.result.current.canvas.onToggleSelect(wallAt(1).id);
      await Promise.resolve();
    });

    expect(mounted.result.current.toolRail.canMerge).toBe(true);

    await act(async () => {
      mounted.result.current.toolRail.onMerge();
      await Promise.resolve();
    });

    await waitFor(() => {
      expect(wallCount()).toBe(before - 1);
    });

    mounted.unmount();
  });
});

/* -------------------------------------------------------------------------- */
/* Bốn điều khiển vừa được dựng ở panel trái và ray công cụ.                    */
/* -------------------------------------------------------------------------- */

describe('điều khiển của panel trái', () => {
  it('điều hướng tầng đọc danh sách tầng của chính đồ thị', async () => {
    const mounted = await mountSettled();
    const { floors } = mounted.result.current.leftPanel;

    expect(floors).toHaveLength(1);
    expect(floors[0]?.id).toBe(FIXTURE_LEVEL.id);
    expect(floors[0]?.label).toBe(FIXTURE_LEVEL.name);
    expect(floors[0]?.isCurrent).toBe(true);

    mounted.unmount();
  });

  it('tim tường bật tắt được, và hành vi cũ chỉ là giá trị khởi tạo', async () => {
    const mounted = await mountSettled();

    /* Công cụ chọn: mặc định không hiện tim tường. */
    expect(mounted.result.current.canvas.showCentrelines).toBe(false);

    await pressKey(mounted.registry, shortcutForTool('drawWall'));
    /* Bật công cụ vẽ thì tim tường hiện sẵn — hành vi cũ, giữ nguyên. */
    expect(mounted.result.current.canvas.showCentrelines).toBe(true);

    await act(async () => {
      mounted.result.current.leftPanel.onToggleCentrelines();
      await Promise.resolve();
    });

    /* Người dùng đè lên được, kể cả khi công cụ vẽ vẫn đang bật. */
    expect(mounted.result.current.canvas.showCentrelines).toBe(false);
    expect(mounted.result.current.leftPanel.showCentrelines).toBe(false);

    mounted.unmount();
  });

  it('lớp Tường bật tắt được từ cây lớp, và chú giải đi theo cờ đó', async () => {
    const mounted = await mountSettled();

    expect(mounted.result.current.canvas.isWallLayerVisible).toBe(true);

    await act(async () => {
      mounted.result.current.leftPanel.onToggleWallLayer();
      await Promise.resolve();
    });

    expect(useStore.getState().hiddenLayers).toContain('wall');
    expect(mounted.result.current.canvas.isWallLayerVisible).toBe(false);

    await act(async () => {
      mounted.result.current.leftPanel.onToggleWallLayer();
      await Promise.resolve();
    });

    expect(mounted.result.current.canvas.isWallLayerVisible).toBe(true);

    mounted.unmount();
  });

  it('đổi độ dày làm hàng nháy nền, và cờ nháy TỰ TẮT', async () => {
    const mounted = await mountSettled();
    const target = wallAt(0);

    await act(async () => {
      mounted.result.current.panel.onChangeThickness(target.id, thicknessChoice(1));
      await Promise.resolve();
    });

    await waitFor(() => {
      expect(mounted.result.current.leftPanel.flashingWallId).toBe(target.id);
    });

    /*
     * Bản trước không có một lượt gọi nào đưa cờ về `null`, nên hàng đó sáng
     * vĩnh viễn. Hẹn giờ chạy ở nấc `'slow'` của thang chuyển động.
     */
    await waitFor(() => {
      expect(mounted.result.current.leftPanel.flashingWallId).toBeNull();
    });

    /* Cờ nháy KHÔNG đi ké `hoveredWallId` nữa — hàng không còn giả vờ đang bị rê chuột. */
    expect(mounted.result.current.panel.hoveredWallId).toBeNull();

    mounted.unmount();
  });

  it('thu gọn hai panel là một hành động của người dùng, không chỉ của story', async () => {
    const mounted = await mountSettled();

    expect(mounted.result.current.toolRail.isCollapsed).toBe(false);

    await act(async () => {
      mounted.result.current.toolRail.onToggleCollapsed();
      await Promise.resolve();
    });

    expect(mounted.result.current.panel.state).toBe('collapsed');
    expect(mounted.result.current.toolRail.isCollapsed).toBe(true);

    mounted.unmount();
  });
});

/* -------------------------------------------------------------------------- */
/* A8 — xoá đi kèm TOAST hoàn tác, không chỉ một vé nằm im.                    */
/* -------------------------------------------------------------------------- */

describe('G4a-12: nối đoạn không được thì báo', () => {
  it('hai đoạn vuông góc: không đổi số tường, đẩy một toast nói lý do', async () => {
    const bus: NotificationBus = createNotificationBus();
    const mounted = await mountSettled({ notifications: bus });
    const before = wallCount();
    const first = wallAt(0);
    const other = FIXTURE_WALLS.find((wall) => wall.id !== first.id && !canMergeWalls(first, wall, FIXTURE_LEVEL));

    expect(other).toBeDefined();

    await act(async () => {
      mounted.result.current.panel.onMerge(first.id, (other as Wall).id);
      await Promise.resolve();
    });

    expect(wallCount()).toBe(before);
    expect(bus.list().map((item) => item.title)).toContain(
      'Chỉ nối được hai đoạn thẳng hàng, cùng độ dày và cùng loại.',
    );

    mounted.unmount();
  });
});

describe('toast hoàn tác sau khi xoá', () => {
  /*
   * Vé hoàn tác của lượt xoá đã dựng đúng từ đầu (`createWallUndoTicket`) và
   * KHÔNG nơi nào hiện nó ra, nên A8 mất vế thứ hai: người dùng xoá nhầm một
   * tường và không có lời mời nào để lấy lại. Bài kiểm này đo đúng chỗ đó — một
   * thông báo trên bus, mang đúng câu của vé và mang chính vé đó, vì
   * `NotificationHost` (`src/main.tsx`) vẽ nút "Hoàn tác" từ `undoTicket`.
   */
  it('đẩy một thông báo mang đúng vé hoàn tác của lượt xoá', async () => {
    const bus: NotificationBus = createNotificationBus();
    const mounted = await mountSettled({ notifications: bus });
    const target = wallAt(0);
    const before = wallCount();

    expect(bus.list()).toHaveLength(0);

    await act(async () => {
      mounted.result.current.panel.onDelete(target.id);
      await Promise.resolve();
    });

    await waitFor(() => {
      expect(wallCount()).toBe(before - 1);
    });

    await waitFor(() => {
      expect(bus.list()).toHaveLength(1);
    });

    const notification = bus.list()[0];

    /* Câu trên toast là câu của chính vé, không phải một bản chép thứ hai. */
    expect(notification?.title).toBe(notification?.undoTicket?.description);
    /* B-V6-02: toast gọi tường bằng nhãn của danh sách, không lộ mã máy. */
    expect(notification?.title).toMatch(/^Đã xoá tường /u);
    expect(notification?.title).toContain(`#${wallDisplayCode(target.id)}`);
    expect(notification?.title).not.toContain(target.id);
    expect(notification?.undoTicket).toBeDefined();

    /* Bấm "Hoàn tác" của `NotificationHost` chính là gọi vé này. */
    await act(async () => {
      notification?.undoTicket?.undo();
      await Promise.resolve();
    });

    await waitFor(() => {
      expect(wallCount()).toBe(before);
    });

    /* Hoàn tác xong thì hàng vừa quay lại nháy nền — TT-02 vế thứ hai. */
    expect(mounted.result.current.leftPanel.flashingWallId).toBe(target.id);

    mounted.unmount();
  });
});

/* -------------------------------------------------------------------------- */
/* Ngưỡng gạch chéo — MỘT nguồn phân loại, cho cả danh sách lẫn canvas.        */
/* -------------------------------------------------------------------------- */

describe('ngưỡng "cần chú ý"', () => {
  /*
   * Ngưỡng cũ của màn là "khác `certain`", tức dưới 0,90 — trong khi canvas gạch
   * chéo theo `materialMap.isLowConfidence`, vốn đã là dưới 0,70. Hai con số
   * khác nhau cho cùng một tường, và không cổng nào bắt được vì cả hai đều chạy
   * đúng như đã viết. Người duyệt chốt 0,70; bài kiểm này là chỗ giữ hai bên
   * không lệch lại lần nữa.
   */
  it('danh sách và canvas gạch chéo cùng một tập tường', () => {
    for (const wall of FIXTURE_WALLS) {
      expect(isLowConfidence(wall)).toBe(canvasHatchGate(wall.confidence));
    }
  });

  it('băng "AI đề xuất" (0,70 ≤ x < 0,90) KHÔNG còn bị tính là độ tin cậy thấp', () => {
    /* W-014 — tường ví dụ của đặc tả — có `confidence` 0,71. */
    const suggested = wallAt(13);

    expect(suggested.confidence).toBe(0.71);
    expect(isLowConfidence(suggested)).toBe(false);

    /* W-004 ở 0,58 thì có, và bộ lọc phải nhìn thấy đúng nhóm đó. */
    const needsReview = wallAt(3);

    expect(needsReview.confidence).toBe(0.58);
    expect(isLowConfidence(needsReview)).toBe(true);
  });

  it('bộ lọc "Chỉ hiện độ tin cậy thấp" lọc theo đúng ngưỡng đó', async () => {
    const mounted = await mountSettled();

    await act(async () => {
      mounted.result.current.panel.onToggleFilter('onlyLowConfidence');
      await Promise.resolve();
    });

    const expected = FIXTURE_WALLS.filter((wall) => isLowConfidence(wall)).length;

    expect(expected).toBeGreaterThan(0);
    expect(expected).toBeLessThan(WALL_LAYER_FIXTURE_TOTAL);
    expect(mounted.result.current.panel.rows).toHaveLength(expected);
    expect(
      mounted.result.current.panel.rows.every((row) => row.isLowConfidence),
    ).toBe(true);

    mounted.unmount();
  });
});

describe('ngưỡng tin cậy của dự án (BUG-354)', () => {
  it('N5 0,75: tường 0,71 là độ tin cậy thấp ở danh sách, bộ lọc và gạch chéo canvas', async () => {
    const suggested = wallAt(13);
    const mounted = await mountSettled({
      gateway: {
        ...createMockWallLayerReviewGateway({ graph: FIXTURE_GRAPH }),
        readConfidenceThreshold: () => Promise.resolve(0.75),
      },
    });

    await act(async () => {
      mounted.result.current.panel.onToggleFilter('onlyLowConfidence');
      await Promise.resolve();
    });

    const expected = FIXTURE_WALLS.filter((wall) => isLowConfidence(wall, 0.75)).length;

    expect(suggested.confidence).toBe(0.71);
    await waitFor(() => {
      expect(mounted.result.current.panel.rows).toHaveLength(expected);
    });
    expect(mounted.result.current.panel.rows.some((row) => row.id === suggested.id)).toBe(true);
    expect(
      mounted.result.current.canvas.shapes.find((shape) => shape.id === suggested.id)?.isLowConfidence,
    ).toBe(true);

    mounted.unmount();
  });
});

describe('tự lưu — bộ lưu lớp chung (F-04x-1)', () => {
  /*
   * Đổi so với bản B-V6-03: cổng không còn `persistWallLayer` để rình, nên bài
   * kiểm rình `writeLayer` của client mà cổng giao cho `useFloorLayerAutosave`.
   */
  it('flushAutosaves lưu NGAY, không đợi cửa sổ 800 ms của A7', async () => {
    const apiClient = createMockApiClient();
    const writeLayer = vi.spyOn(apiClient.spatial, 'writeLayer');
    const gateway = createMockWallLayerReviewGateway({ apiClient, graph: FIXTURE_GRAPH });
    const mounted = await mountSettled({ gateway });
    const wall = wallAt(0);
    const choice = WALL_LAYER_THICKNESS_CHOICES.find((value) => value !== wall.thicknessMm) as WallThicknessChoice;

    await act(async () => {
      mounted.result.current.panel.onChangeThickness(wall.id, choice);
      await Promise.resolve();
    });
    await waitFor(() => {
      expect(
        wallsOfLevel(useStore.getState().spatial, FIXTURE_LEVEL.id).find((item) => item.id === wall.id)
          ?.thicknessMm,
      ).toBe(choice);
    });

    expect(writeLayer).not.toHaveBeenCalled();

    await act(async () => {
      await flushAutosaves();
    });

    expect(writeLayer).toHaveBeenCalledTimes(1);

    mounted.unmount();
  });

  /* [8].6 — cổng thật, client giả: base từ lượt N16 đã nạp, 409 → dải, A9, tải lại. */
  it('sửa → 800 ms → một PUT base N16; 409 → dải; còn bẩn → A9; tải lại → hoàn tác rỗng, lượt sau base mới', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });

    const floorId = sampleLevelId(1);
    const apiClient = createMockApiClient();
    const writeLayer = vi.spyOn(apiClient.spatial, 'writeLayer');
    const readLayer = vi.spyOn(apiClient.spatial, 'readLayer');

    /* Máy chủ đã ở revision 1 trước khi màn mở — base đúng là 1, không phải 0. */
    simulateRemoteLayerEdit(floorId);

    const mounted = await mountSettled({ floorId, gateway: createWallLayerReviewGateway({ apiClient }) });
    const readsAtLoad = readLayer.mock.calls.length;

    expect(readsAtLoad).toBe(1);

    const editFirstWall = async (): Promise<void> => {
      const wall = wallsOfLevel(useStore.getState().spatial, floorId)[0] as Wall;
      const choice = WALL_LAYER_THICKNESS_CHOICES.find((value) => value !== wall.thicknessMm) as WallThicknessChoice;

      await act(async () => {
        mounted.result.current.panel.onChangeThickness(wall.id, choice);
        await Promise.resolve();
      });
      await waitFor(() => {
        expect(wallsOfLevel(useStore.getState().spatial, floorId)[0]?.thicknessMm).toBe(choice);
      });
    };
    const settle800 = async (): Promise<void> => {
      await act(async () => {
        await vi.advanceTimersByTimeAsync(800);
      });
    };

    await editFirstWall();
    await settle800();
    await waitFor(() => {
      expect(writeLayer).toHaveBeenCalledTimes(1);
    });
    expect(writeLayer.mock.calls[0]?.[0]).toMatchObject({ baseVersion: 1, floorId });
    /* Không đọc N16 lần nào để lấy base trước PUT. */
    expect(readLayer).toHaveBeenCalledTimes(readsAtLoad);

    /* Người khác sửa → revision 3; lượt sau của mình gửi base 2 → 409 → dải "Tải lại". */
    simulateRemoteLayerEdit(floorId);
    await editFirstWall();
    await settle800();
    await waitFor(() => {
      expect(mounted.result.current.saveBlock?.kind).toBe('reload');
    });
    expect(writeLayer.mock.calls[1]?.[0]).toMatchObject({ baseVersion: 2 });
    /* P02: dải nói rõ "Tải lại" bỏ sửa chưa lưu; chân màn không hứa "sẽ thử lưu lại". */
    expect(mounted.result.current.saveBlock?.message).toContain('thay đổi chưa lưu sẽ bị bỏ');
    expect(mounted.result.current.statusBar.saveLabel).toBe('Chưa lưu. Xem dải báo phía trên.');

    /* Tầng còn sửa chưa lưu → "Tải lại" mở hộp thoại A9 thay vì bỏ ngay. */
    act(() => {
      mounted.result.current.saveBlock?.onReload?.();
    });
    expect(mounted.result.current.saveBlock?.confirm?.open).toBe(true);

    await act(async () => {
      mounted.result.current.saveBlock?.confirm?.onConfirm();
      await vi.advanceTimersByTimeAsync(0);
    });
    await waitFor(() => {
      expect(mounted.result.current.saveBlock).toBeNull();
    });
    expect(useStore.getState().floorMeta[floorId]?.revision).toBe(3);
    /* [BUG-415] Lỗi lưu của bản đã bỏ hết nghĩa: nhãn không còn "Lưu thất bại", và có câu báo đã bỏ. */
    await waitFor(() => {
      expect(mounted.result.current.statusBar.saveLabel).not.toContain('Lưu thất bại');
    });
    expect(appNotificationBus.list().map(({ title }) => title)).toContain(FLOOR_LAYER_RELOAD_DISCARDED);

    /* Ngăn hoàn tác của màn rỗng: Ctrl+Z không đổi gì trên bản vừa tải. */
    const reloaded = useStore.getState().spatial;

    await pressKey(mounted.registry, 'z', { ctrlKey: true });
    expect(useStore.getState().spatial).toBe(reloaded);

    /* Lượt sau dùng revision mới. */
    await editFirstWall();
    await settle800();
    await waitFor(() => {
      expect(writeLayer).toHaveBeenCalledTimes(3);
    });
    expect(writeLayer.mock.calls[2]?.[0]).toMatchObject({ baseVersion: 3 });
    await waitFor(() => {
      expect(useStore.getState().floorMeta[floorId]?.revision).toBe(4);
    });
    expect(vi.mocked(resolveConflict)).not.toHaveBeenCalled();

    mounted.unmount();
  });
});

/* -------------------------------------------------------------------------- */
/* Tỷ lệ tạm (F-04x-2 [8].7).                                                  */
/* -------------------------------------------------------------------------- */

describe('tỷ lệ tạm (F-04x-2)', () => {
  it('tầng unresolved: không dải vàng (UX-R2 K22), chiều dài thanh tra là "… mm (tạm)", cùng số với danh sách (K16)', async () => {
    const mounted = await mountSettled({
      gateway: createMockWallLayerReviewGateway({ graph: FIXTURE_GRAPH, scaleStatus: 'unresolved' }),
    });

    expect(mounted.result.current.provisionalScaleNotice).toBeNull();

    act(() => {
      mounted.result.current.panel.onSelect(wallAt(0).id);
    });

    expect(mounted.result.current.panel.inspector?.lengthLabel).toMatch(/^[\d.]+ mm \(tạm\)$/);
    mounted.unmount();
  });

  it('tầng không đo được tỷ lệ (project_default): chiều dài nói rõ cần đặt tỷ lệ, không hiện số', () => {
    const inspector = toWallInspector(wallAt(0), FIXTURE_LEVEL, undefined, 'unresolved', 'mm', 'project_default');

    expect(inspector.lengthLabel).toBe('Chưa có — cần đặt tỷ lệ');
  });

  it('R9: chiều dài thanh tra theo scaleState — đọc từ bản vẽ số trơn, ước lượng / chưa xác định có hậu tố', () => {
    const labelOf = (scaleState: 'determined' | 'estimated' | 'unresolved') =>
      toWallInspector(wallAt(0), FIXTURE_LEVEL, undefined, 'unresolved', 'mm', 'pipeline', undefined, undefined, scaleState).lengthLabel;

    expect(labelOf('determined')).toMatch(/^[\d.]+ mm$/u);
    expect(labelOf('estimated')).toMatch(/^[\d.]+ mm \(ước lượng\)$/u);
    expect(labelOf('unresolved')).toMatch(/^[\d.]+ mm \(chưa xác định\)$/u);
    expect(
      toWallInspector(wallAt(0), FIXTURE_LEVEL, undefined, 'unresolved', 'm', 'pipeline', undefined, undefined, 'estimated').lengthLabel,
    ).toMatch(/^≈.+ \(ước lượng\)$/u);
  });

  it('U07: nhãn tường nhớ qua lần tải lại, theo dự án và tầng', () => {
    writeWallCodeMemory('p1', 'L1', new Map([['W-a', 'W-004'], ['W-b', 'W-009']]));

    expect([...readWallCodeMemory('p1', 'L1')]).toEqual([['W-a', 'W-004'], ['W-b', 'W-009']]);
    expect(readWallCodeMemory('p1', 'L2').size).toBe(0);
    expect(readWallCodeMemory('p1', null).size).toBe(0);
    localStorage.setItem('wall-codes:p1:L3', '{hỏng');
    expect(readWallCodeMemory('p1', 'L3').size).toBe(0);
  });

  it('U48: người đã sửa độ dày thì thanh tra giữ số máy đo', () => {
    const edited = { ...wallAt(0), thicknessMm: 200, detectedThicknessMm: 221, source: 'human' } as Wall;

    expect(toWallInspector(edited, FIXTURE_LEVEL).detectedNote).toBe('(đã sửa, máy đo 221)');
    /* U30, UX-16: máy tự đổi thì không nói "đã sửa", cũng không nói "làm tròn". */
    expect(toWallInspector({ ...edited, source: 'ai' } as Wall, FIXTURE_LEVEL).detectedNote).toBe('(máy đo 221)');
    expect(toWallInspector({ ...edited, thicknessMm: 221 } as Wall, FIXTURE_LEVEL).detectedNote).toBeNull();
    expect(toWallInspector(wallAt(0), FIXTURE_LEVEL).detectedNote).toBeNull();
  });

  it('tầng có tỉ lệ thật: không dải, chiều dài là số đo', async () => {
    const mounted = await mountSettled();

    act(() => {
      mounted.result.current.panel.onSelect(wallAt(0).id);
    });

    expect(mounted.result.current.provisionalScaleNotice).toBeNull();
    expect(mounted.result.current.panel.inspector?.lengthLabel).not.toContain('tạm');
    expect(mounted.result.current.panel.inspector?.lengthLabel).toMatch(/mm$/u);
    mounted.unmount();
  });
});

/* -------------------------------------------------------------------------- */
/* Đợt sửa P04 cụm A (SCR-16) — mỗi ca đỏ trước bản sửa.                        */
/* -------------------------------------------------------------------------- */

describe('đợt sửa P04 — SCR-16 (hook)', () => {
  it('[BUG-579] "Hoàn tác" trên toast xoá hoàn tác ĐÚNG bước xoá của nó, giữ nguyên bước mới hơn (duyệt tường khác)', async () => {
    const bus: NotificationBus = createNotificationBus();
    const mounted = await mountSettled({ notifications: bus });
    const deleted = wallAt(0);
    const before = wallCount();
    const approvedBefore = mounted.result.current.panel.reviewCounter.reviewed;

    await act(async () => {
      mounted.result.current.panel.onDelete(deleted.id);
      await Promise.resolve();
    });
    await waitFor(() => {
      expect(bus.list()).toHaveLength(1);
    });

    const ticket = bus.list()[0]?.undoTicket;
    const other = FIXTURE_WALLS.find((wall) => !wall.reviewed && wall.id !== deleted.id) as Wall;

    await act(async () => {
      mounted.result.current.panel.onApprove(other.id);
      await Promise.resolve();
    });
    await waitFor(() => {
      expect(mounted.result.current.panel.reviewCounter.reviewed).toBe(approvedBefore + 1);
    });

    await act(async () => {
      ticket?.undo();
      await Promise.resolve();
    });

    /* Own-step undo: tường A quay lại, lượt duyệt tường khác vẫn còn. */
    await waitFor(() => {
      expect(wallCount()).toBe(before);
    });
    expect(mounted.result.current.panel.reviewCounter.reviewed).toBe(approvedBefore + 1);

    mounted.unmount();
  });

  it('[BUG-581] tự chuyển sau "Duyệt" ở trong bộ lọc đang bật', async () => {
    const mounted = await mountSettled();

    await act(async () => {
      mounted.result.current.panel.onToggleFilter('onlyLowConfidence');
      await Promise.resolve();
    });

    const filtered = mounted.result.current.panel.rows.filter((row) => !row.isReviewed);

    expect(filtered.length).toBeGreaterThan(1);

    const first = filtered[0]?.id as WallId;
    const reviewedBefore = mounted.result.current.panel.reviewCounter.reviewed;

    await act(async () => {
      mounted.result.current.panel.onSelect(first);
      await Promise.resolve();
    });
    await act(async () => {
      mounted.result.current.panel.onApprove(first);
      await Promise.resolve();
    });
    await waitFor(() => {
      expect(mounted.result.current.panel.reviewCounter.reviewed).toBe(reviewedBefore + 1);
    });

    await waitFor(() => {
      expect(mounted.result.current.panel.selectedWallId).toBe(filtered[1]?.id);
    });

    await act(async () => {
      mounted.result.current.panel.onSkip(filtered[1]?.id as WallId);
      await Promise.resolve();
    });

    const rowIds = mounted.result.current.panel.rows.map((row) => row.id);

    expect(rowIds).toContain(mounted.result.current.panel.selectedWallId);

    mounted.unmount();
  });

  it('[BUG-604] phím X bật "Tách đoạn" và điền luôn tường đang chọn', async () => {
    const mounted = await mountSettled();

    await act(async () => {
      mounted.result.current.panel.onSelect(wallAt(0).id);
      await Promise.resolve();
    });
    await pressKey(mounted.registry, shortcutForTool('splitWall'));

    expect(mounted.result.current.toolRail.activeTool).toBe('splitWall');

    mounted.unmount();
  });

  it('[BUG-601] vai Người xem: phím M không bật công cụ đo chết', async () => {
    const mounted = await mountSettled({ roles: ['viewer'] });

    await pressKey(mounted.registry, shortcutForTool('measure'));

    expect(mounted.result.current.toolRail.activeTool).toBe('select');

    mounted.unmount();
  });

  it('[BUG-616] thanh trạng thái báo cờ lưu thất bại riêng, không chỉ chuỗi', async () => {
    const mounted = await mountSettled();

    expect(mounted.result.current.statusBar.saveFailed).toBe(false);

    mounted.unmount();
  });
});

describe('[G73b] Ctrl-bấm chọn hai tường', () => {
  it('canvas nhận CẢ hai tường đang chọn để tô viền, không chỉ tường chính', async () => {
    const mounted = await mountSettled();

    await act(async () => {
      mounted.result.current.canvas.onSelect(wallAt(0).id);
      await Promise.resolve();
    });
    await act(async () => {
      mounted.result.current.canvas.onToggleSelect(wallAt(1).id);
      await Promise.resolve();
    });

    expect([...(mounted.result.current.canvas.selectedWallIds ?? [])].sort()).toEqual(
      [wallAt(0).id, wallAt(1).id].sort(),
    );
    mounted.unmount();
  });
});

/* -------------------------------------------------------------------------- */
/* [16-D-008] Người xem trên tầng RỖNG: danh sách đọc rỗng/đang tải từ dữ liệu. */
/* -------------------------------------------------------------------------- */

describe('[16-D-008] vai Người xem trên tầng rỗng', () => {
  const EMPTY_GRAPH = normalizeSpatial({
    building: WALL_LAYER_FIXTURE_BUILDING,
    levels: [FIXTURE_LEVEL],
    walls: [],
    openings: [],
    furniture: [],
    rooms: [],
    axes: [],
    dimensions: [],
    notes: [],
  });

  it('đang tải: chưa có emptyNotice; tải xong: emptyNotice có, state vẫn forbidden', async () => {
    const mounted = mountHook({
      roles: ['viewer'],
      gateway: createMockWallLayerReviewGateway({ graph: EMPTY_GRAPH }),
    });

    expect(mounted.result.current.panel.state).toBe('forbidden');
    expect(mounted.result.current.panel.emptyNotice).toBeNull();

    await waitFor(() => {
      expect(mounted.result.current.panel.emptyNotice).not.toBeNull();
    });

    expect(mounted.result.current.panel.state).toBe('forbidden');
    expect(mounted.result.current.panel.rows).toHaveLength(0);
    mounted.unmount();
  });
});

describe('deleteToastDescription (U36, U57)', () => {
  const wallId = 'W-000021WALL' as WallId;
  const codes = new Map([[wallId, 'W-021']]);

  it('chỉ có tường: câu cũ', () => {
    expect(deleteToastDescription(wallId, codes)).toBe('Đã xoá tường #W-021.');
  });

  it('báo số trên hình và cửa bị xoá kèm', () => {
    expect(deleteToastDescription(wallId, codes, { openingCount: 1, queueNumber: 2 })).toBe(
      'Đã xoá tường số 2 (#W-021) và 1 cửa gắn trên tường.',
    );
  });
});

/* -------------------------------------------------------------------------- */
/* Vẽ tường: Esc rời công cụ, bắt điểm vào tường có sẵn, lấy độ dày của tường đó. */
/* -------------------------------------------------------------------------- */

describe('vẽ tường nối vào tường có sẵn', () => {
  const newWalls = (): Wall[] => {
    const spatial = useStore.getState().spatial;
    const fixtureIds = new Set<string>(FIXTURE_WALLS.map((wall) => wall.id));

    return (spatial?.byKind.wall ?? [])
      .filter((id) => !fixtureIds.has(id))
      .map((id) => spatial?.byId[id] as Wall);
  };

  it('Esc lần đầu bỏ nét dở, Esc lần nữa về công cụ Chọn', async () => {
    const mounted = await mountSettled();

    await pressKey(mounted.registry, shortcutForTool('drawWall'));
    await act(async () => {
      mounted.result.current.canvas.onCanvasPoint(asCanvasPoint({ x: 20000, y: 20000 }));
      await Promise.resolve();
    });
    await pressKey(mounted.registry, 'Escape');
    expect(mounted.result.current.toolRail.activeTool).toBe('drawWall');
    expect(mounted.result.current.statusBar.toolHint).toContain('Bấm điểm đầu');

    await pressKey(mounted.registry, 'Escape');
    expect(mounted.result.current.toolRail.activeTool).toBe('select');
    expect(mounted.result.current.statusBar.toolHint).toBe('');

    mounted.unmount();
  });

  it('hai lần bấm gần thân/đầu tường bắt đúng toạ độ, tường mới lấy dày + loại của tường ở điểm đầu', async () => {
    const bus: NotificationBus = createNotificationBus();
    /* Một cổng giả cố định: bộ đếm mã của cổng dựng lại mỗi lượt vẽ sẽ trùng mã giữa tường vẽ và mảnh cắt. */
    const gateway = createMockWallLayerReviewGateway({ graph: FIXTURE_GRAPH });
    const mounted = await mountSettled({ notifications: bus, gateway });
    /* W-006: (0, 2200) → (2500, 2200), dày 175, vách ngăn. */
    const source = FIXTURE_WALLS.find((wall) => wall.centreline.start.x === 0 && wall.centreline.start.y === 2200 && wall.centreline.end.y === 2200) as Wall;

    await pressKey(mounted.registry, shortcutForTool('drawWall'));
    await act(async () => {
      /* Lệch 2 mm khỏi thân W-006 → chân vuông góc (1250, 2200). */
      mounted.result.current.canvas.onCanvasPoint(asCanvasPoint({ x: 1250, y: 2202 }));
      await Promise.resolve();
    });
    await act(async () => {
      /* Lệch ~2 mm khỏi đầu tường (2500, 4400). */
      mounted.result.current.canvas.onCanvasPoint(asCanvasPoint({ x: 2501.6, y: 4401.3 }));
      await Promise.resolve();
    });
    /* Đầu bắt vào THÂN W-006 → W-006 bị cắt tại (1250, 2200): tường vẽ + mảnh thứ hai. */
    await waitFor(() => {
      expect(newWalls()).toHaveLength(2);
    });

    const drawn = newWalls().find((wall) => wall.centreline.end.y === 4400) as Wall;

    expect(drawn.centreline.start).toEqual({ x: 1250, y: 2200 });
    expect(drawn.centreline.end).toEqual({ x: 2500, y: 4400 });
    expect(drawn.thicknessMm).toBe(source.thicknessMm);
    expect(drawn.kind).toBe(source.kind);
    expect(drawn.heightMm).toBe(source.heightMm);
    /* Nối được thì không có toast từ chối. */
    expect(bus.list().map((item) => item.title)).not.toContain('Chưa vẽ được tường');

    mounted.unmount();
  });

  it.each(['drawWall', 'measure', 'splitWall'] as const)('bấm lên tường khi đang dùng %s không chọn tường (chọn sẽ kéo khung nhìn đi giữa hai lần bấm)', async (tool) => {
    const mounted = await mountSettled();

    await pressKey(mounted.registry, shortcutForTool(tool));
    expect(mounted.result.current.toolRail.activeTool).toBe(tool);
    await act(async () => {
      mounted.result.current.canvas.onSelect(wallAt(5).id);
      await Promise.resolve();
    });

    expect(useStore.getState().selectedIds).toHaveLength(0);

    mounted.unmount();
  });

  it('#9: tường đứng trơ KHÔNG được vẽ — câu lý do ở thanh trạng thái và toast, công cụ vẽ vẫn bật', async () => {
    const bus: NotificationBus = createNotificationBus();
    const mounted = await mountSettled({ notifications: bus });
    const before = wallCount();

    await pressKey(mounted.registry, shortcutForTool('drawWall'));
    await act(async () => {
      mounted.result.current.canvas.onCanvasPoint(asCanvasPoint({ x: 20000, y: 20000 }));
      await Promise.resolve();
    });
    await act(async () => {
      mounted.result.current.canvas.onCanvasPoint(asCanvasPoint({ x: 22400, y: 20000 }));
      await Promise.resolve();
    });
    await waitFor(() => {
      expect(mounted.result.current.statusBar.toolHint).toBe(WALL_DRAW_MUST_CONNECT_TEXT);
    });

    expect(wallCount()).toBe(before);
    expect(bus.list().map((item) => item.title)).toContain('Chưa vẽ được tường');
    expect(mounted.result.current.toolRail.activeTool).toBe('drawWall');

    /* Bấm điểm kế là bắt đầu nét mới — câu lý do nhường chỗ cho chỉ dẫn. */
    await act(async () => {
      mounted.result.current.canvas.onCanvasPoint(asCanvasPoint({ x: 5000, y: 2200 }));
      await Promise.resolve();
    });
    expect(mounted.result.current.statusBar.toolHint).toContain('Bấm điểm cuối');

    mounted.unmount();
  });

  it('nét bị từ chối vẫn giữ điểm đầu; bấm lại điểm cuối lên tường thì vẽ được từ đúng điểm đó', async () => {
    const gateway = createMockWallLayerReviewGateway({ graph: FIXTURE_GRAPH });
    const mounted = await mountSettled({ gateway });

    await pressKey(mounted.registry, shortcutForTool('drawWall'));
    await act(async () => {
      mounted.result.current.canvas.onCanvasPoint(asCanvasPoint({ x: 20000, y: 20000 }));
      await Promise.resolve();
    });
    /* Điểm đầu trơ: gợi ý nói ngay điều kiện, trước khi bị từ chối. */
    expect(mounted.result.current.statusBar.toolHint).toContain('Điểm cuối phải chạm một tường');

    await act(async () => {
      mounted.result.current.canvas.onCanvasPoint(asCanvasPoint({ x: 22400, y: 20700 }));
      await Promise.resolve();
    });
    await waitFor(() => {
      expect(mounted.result.current.statusBar.toolHint).toBe(WALL_DRAW_MUST_CONNECT_TEXT);
    });

    await act(async () => {
      mounted.result.current.canvas.onCanvasPoint(asCanvasPoint({ x: 5000, y: 2200 }));
      await Promise.resolve();
    });
    await waitFor(() => {
      expect(newWalls()).toHaveLength(1);
    });
    expect(newWalls()[0]?.centreline).toEqual({ start: { x: 20000, y: 20000 }, end: { x: 5000, y: 2200 } });

    mounted.unmount();
  });

  it('vẽ nối tiếp: điểm cuối thành điểm đầu nét sau, mỗi nét một bước Ctrl+Z, Esc dừng chuỗi giữ công cụ', async () => {
    const gateway = createMockWallLayerReviewGateway({ graph: FIXTURE_GRAPH });
    const mounted = await mountSettled({ gateway });
    const click = async (x: number, y: number) => {
      await act(async () => {
        mounted.result.current.canvas.onCanvasPoint(asCanvasPoint({ x, y }));
        await Promise.resolve();
      });
    };

    await pressKey(mounted.registry, shortcutForTool('drawWall'));
    await click(5000, 2200);
    await click(5000, -3000);
    await waitFor(() => {
      expect(newWalls()).toHaveLength(1);
    });
    /* Lệch 30 mm trên 2 m: khoá trục đưa về đúng dọc/ngang theo điểm đầu mới. */
    await click(7000, -2970);
    await waitFor(() => {
      expect(newWalls()).toHaveLength(2);
    });
    expect(newWalls()[1]?.centreline).toEqual({ start: { x: 5000, y: -3000 }, end: { x: 7000, y: -3000 } });

    await pressKey(mounted.registry, 'z', { ctrlKey: true });
    await waitFor(() => {
      expect(newWalls()).toHaveLength(1);
    });
    await pressKey(mounted.registry, 'z', { ctrlKey: true });
    await waitFor(() => {
      expect(newWalls()).toHaveLength(0);
    });

    /* Hoàn tác cũng bỏ điểm đầu đang giữ: bấm tiếp là điểm đầu mới. */
    expect(mounted.result.current.statusBar.toolHint).toContain('Bấm điểm đầu');

    await click(5000, 2200);
    await click(5000, -3000);
    await waitFor(() => {
      expect(newWalls()).toHaveLength(1);
    });
    expect(mounted.result.current.statusBar.toolHint).toContain('Bấm điểm cuối');
    await pressKey(mounted.registry, 'Escape');
    expect(mounted.result.current.statusBar.toolHint).toContain('Bấm điểm đầu');
    expect(mounted.result.current.toolRail.activeTool).toBe('drawWall');
    await pressKey(mounted.registry, 'Escape');
    expect(mounted.result.current.toolRail.activeTool).toBe('select');

    mounted.unmount();
  });

  it('phím 1/2/3 khi đang vẽ đặt độ dày nét, thắng kế thừa, không đổi tường đang chọn', async () => {
    const gateway = createMockWallLayerReviewGateway({ graph: FIXTURE_GRAPH });
    const mounted = await mountSettled({ gateway });

    await pressKey(mounted.registry, shortcutForTool('drawWall'));
    await pressKey(mounted.registry, '2');
    expect(mounted.result.current.statusBar.toolHint).toContain(`Dày ${WALL_LAYER_THICKNESS_CHOICES[1]} mm`);

    await act(async () => {
      mounted.result.current.canvas.onCanvasPoint(asCanvasPoint({ x: 5000, y: 2200 }));
      await Promise.resolve();
    });
    await act(async () => {
      mounted.result.current.canvas.onCanvasPoint(asCanvasPoint({ x: 5000, y: 4400 }));
      await Promise.resolve();
    });
    await waitFor(() => {
      expect(newWalls()).toHaveLength(1);
    });
    expect(newWalls()[0]?.thicknessMm).toBe(WALL_LAYER_THICKNESS_CHOICES[1]);

    mounted.unmount();
  });

  it('#5: hai đầu bắt vào THÂN hai tường → cả hai bị cắt (chữ T), PUT hợp lệ, một Ctrl+Z gỡ hết', async () => {
    const apiClient = createMockApiClient();
    const writeLayer = vi.spyOn(apiClient.spatial, 'writeLayer');
    const gateway = createMockWallLayerReviewGateway({ apiClient, graph: FIXTURE_GRAPH });
    const mounted = await mountSettled({ gateway });
    const before = wallCount();

    await pressKey(mounted.registry, shortcutForTool('drawWall'));
    await act(async () => {
      /* Thân W-006 (y=2.200) và thân W-011 (y=4.400), lệch vài mm như chuột thật. */
      mounted.result.current.canvas.onCanvasPoint(asCanvasPoint({ x: 1250.3, y: 2203.1 }));
      await Promise.resolve();
    });
    await act(async () => {
      mounted.result.current.canvas.onCanvasPoint(asCanvasPoint({ x: 1249.6, y: 4398.2 }));
      await Promise.resolve();
    });
    await waitFor(() => {
      expect(wallCount()).toBe(before + 3);
    });

    const spatial = useStore.getState().spatial;
    const walls = (spatial?.byKind.wall ?? []).map((id) => spatial?.byId[id] as Wall);
    const w006 = walls.find((wall) => wall.id === wallAt(5).id) as Wall;
    const w011 = walls.find((wall) => wall.id === wallAt(10).id) as Wall;

    expect(w006.centreline.end).toEqual({ x: 1250, y: 2200 });
    expect(w011.centreline.end).toEqual({ x: 1250, y: 4400 });
    expect(walls.some((wall) => wall.centreline.start.x === 1250 && wall.centreline.start.y === 2200 && wall.centreline.end.y === 4400)).toBe(true);

    await act(async () => {
      await flushAutosaves();
    });
    const sent = writeLayer.mock.calls[writeLayer.mock.calls.length - 1]?.[0] as unknown as { baseVersion: number; body: unknown };
    const parsed = FloorLayerWriteSchema.safeParse({ baseVersion: sent.baseVersion, body: sent.body });
    expect(parsed.success ? [] : parsed.error.issues, 'PUT body passes the write schema').toEqual([]);

    await pressKey(mounted.registry, 'z', { ctrlKey: true });
    await waitFor(() => {
      expect(wallCount()).toBe(before);
    });
    const restored = useStore.getState().spatial?.byId[wallAt(5).id] as Wall;
    expect(restored.centreline.end).toEqual(wallAt(5).centreline.end);

    mounted.unmount();
  });
});
