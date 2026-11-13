/**
 * Nửa "suy nghĩ" của màn S-16 "Quản lý tầng", kiểm không cần DOM thật của sản
 * phẩm: hook được lái qua `renderHook`, tầng dữ liệu là
 * `createMockFloorManagerGateway()` của `floorManagerGateway.ts` — cùng cổng
 * story sẽ dùng — và mọi con số khẳng định đọc ra từ
 * `FLOOR_MANAGER_SAMPLE_LEVELS`, không có bảng dữ liệu thứ hai bịa tại chỗ
 * (R-70).
 *
 * ## Năm phép kiểm nghiệm thu
 *
 * 1. Đổi chiều cao Tầng trệt 3,9 → 4,2 m thì cao độ Tầng 2 dịch 3,9 → 4,2 m —
 *    và cả lượt đó là ĐÚNG MỘT bước lịch sử (QĐ-2).
 * 2. Chặn trùng cao độ, câu chặn nêu TÊN CẢ HAI TẦNG.
 * 3. Xoá tầng rồi hoàn tác thì thứ tự và cao độ trở về nguyên trạng.
 * 4. Nhân bản có / không kèm nội thất.
 * 5. Tỷ lệ chiều cao bốn dải khớp 3,0 / 3,9 / 3,6 / 3,6 m.
 */

import { createElement, type ReactNode } from 'react';
import { QueryClientProvider, type QueryClient } from '@tanstack/react-query';
import { act, cleanup, renderHook, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi, type Mock } from 'vitest';

import { normalizeSpatial, type NormalizedSpatial } from '@/domain/spatial/normalize';
import { totalArea } from '@/domain/rooms/area';
import type { Level, LevelId } from '@/domain/spatial/types';
import { metres, metresToMillimetres, millimetres } from '@/domain/units/types';
import { millimetresPerPixel } from '@/domain/units/scale';
import { createApiClient, type ApiResult } from '@/api/client';
import { FloorSchema, type Floor } from '@/api/contracts';
import { ApiErrorBodySchema } from '@/api/schemas/errors';
import { createHttpClient, type HttpError } from '@/lib/http';
import { formatLength } from '@/lib/format/measure';
import type { Announcer } from '@/lib/input/announcer';
import { createShortcutRegistry, type ShortcutRegistry } from '@/lib/input/shortcutRegistry';
import { createNotificationBus, type NotificationBus } from '@/lib/mutations/notificationBus';
import { queryKeys } from '@/lib/query/queryKeys';
import { createTestQueryClient } from '@/lib/testing/render';
import { resetSelectorCaches } from '@/store/selectors';
import { useStore } from '@/store';

import {
  createFloorManagerGateway,
  createFloorManagerSampleFloors,
  createFloorManagerSampleGraph,
  createMockFloorManagerGateway,
  failedFloorCapability,
  FLOOR_MANAGER_SAVE_FAILED_NOTICES,
  floorWriteBodyOf,
  type FloorManagerGatewaySeed,
  entitiesOnLevel,
  findElevationConflict,
  FLOOR_MANAGER_SAMPLE_GROUND_ID,
  FLOOR_MANAGER_SAMPLE_LEVELS,
  FLOOR_MANAGER_SAMPLE_ROOF_ID,
  FLOOR_MANAGER_SAMPLE_SECOND_ID,
  FLOOR_MANAGER_UNSUPPORTED_NOTICES,
  levelsOf,
  roomsOfLevel,
  type FloorManagerGateway,
} from './floorManagerGateway';
import type { UseFloorManagerResult } from './floorManagerTypes';
import {
  draftToMillimetres,
  FLOOR_MANAGER_TEXT,
  FLOOR_RESTORE_WINDOW_MS,
  metreDraftText,
  misplacedFloorNameWarning,
  floorRowScaleStateOf,
  nextNewFloorName,
  useFloorManager,
  type UseFloorManagerOptions,
} from './useFloorManager';
import { heightMmText } from './floorFormat';

/* -------------------------------------------------------------------------- */
/* Bộ mẫu — đọc ra, không viết tay lại.                                        */
/* -------------------------------------------------------------------------- */

const PROJECT_ID = 'project-floor-manager';

/** Bốn chiều cao của bộ mẫu: 3,0 / 3,9 / 3,6 / 3,6 m. */
const SAMPLE_HEIGHTS_MM = FLOOR_MANAGER_SAMPLE_LEVELS.map((entry) => entry.heightMm);

/** Tổng chiều cao ngăn xếp — CỘNG RA từ bộ mẫu, không phải một chuỗi viết tay. */
const TOTAL_STACK_HEIGHT_MM = SAMPLE_HEIGHTS_MM.reduce((total, value) => total + value, 0);

/** Chiều cao mới của Tầng trệt trong bài nghiệm thu: 4,2 m. */
const NEW_GROUND_HEIGHT_M = 4.2;

/* -------------------------------------------------------------------------- */
/* Môi trường.                                                                 */
/* -------------------------------------------------------------------------- */

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
  readonly result: { current: UseFloorManagerResult };
  readonly registry: ShortcutRegistry;
  readonly notifications: NotificationBus;
  readonly spoken: readonly string[];
  readonly unmount: () => void;
  readonly queryClient: QueryClient;
}

type MountOptions = Partial<Omit<UseFloorManagerOptions, 'registry'>> & {
  /** Dùng chung bộ đệm giữa hai lần gắn — đúng cảnh rời màn rồi quay lại trong SPA. */
  readonly queryClient?: QueryClient;
};

function mountHook(options: MountOptions = {}): Mounted {
  const registry = createShortcutRegistry();
  const notifications = options.notifications ?? createNotificationBus();
  const spoken: string[] = [];
  const announcer: Announcer = {
    announce: (message) => {
      spoken.push(message);
    },
    destroy: () => undefined,
  };
  const queryClient = options.queryClient ?? createTestQueryClient();
  const wrapper = ({ children }: { children: ReactNode }): ReactNode =>
    createElement(QueryClientProvider, { client: queryClient }, children);

  const rendered = renderHook(
    () =>
      useFloorManager({
        projectId: options.projectId ?? PROJECT_ID,
        roles: options.roles ?? ['engineer'],
        gateway: options.gateway ?? createMockFloorManagerGateway(),
        registry,
        notifications,
        announcer,
        ...(options.forceCollapsed === undefined
          ? {}
          : { forceCollapsed: options.forceCollapsed }),
      }),
    { wrapper },
  );

  return { result: rendered.result, registry, notifications, spoken, unmount: rendered.unmount, queryClient };
}

/** Chờ lượt đọc danh sách tầng xong — trước đó mọi kịch bản đều là `'loading'`. */
async function mountSettled(options: MountOptions = {}): Promise<Mounted> {
  const mounted = mountHook(options);

  await waitFor(() => {
    expect(mounted.result.current.state).not.toBe('loading');
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

/** Đồ thị đang nằm trong kho — nơi `commit` vừa ghi vào. */
const storeGraph = (): NormalizedSpatial | null => useStore.getState().spatial;

/** Ảnh chụp thứ tự và cao độ của cả ngăn xếp, để so nguyên trạng trước và sau. */
function stackReadings(graph: NormalizedSpatial | null): readonly string[] {
  return levelsOf(graph).map(
    (level) =>
      `${String(level.id)} #${String(level.order)} @${String(level.elevationMm)} h${String(level.heightMm)}`,
  );
}

/** Sửa một ô rồi CHỐT giá trị — đúng đường `NumericField` báo về khi blur/Enter. */
async function commitField(
  mounted: Mounted,
  floorId: string,
  field: 'name' | 'elevation' | 'height',
  draftValue: string,
): Promise<void> {
  await act(async () => {
    mounted.result.current.onFloorFieldChange(floorId, field, draftValue);
    await Promise.resolve();
  });

  await act(async () => {
    mounted.result.current.onFloorFieldCommit(floorId, field);
    await Promise.resolve();
  });
}

const rowOf = (mounted: Mounted, floorId: string): UseFloorManagerResult['rows'][number] => {
  const row = mounted.result.current.rows.find((candidate) => candidate.id === floorId);

  if (row === undefined) {
    throw new Error(`Không tìm thấy dòng của tầng ${floorId} trong view-model.`);
  }

  return row;
};

const levelIn = (graph: NormalizedSpatial | null, floorId: string): Level => {
  const level = levelsOf(graph).find((candidate) => String(candidate.id) === floorId);

  if (level === undefined) {
    throw new Error(`Không tìm thấy tầng ${floorId} trong đồ thị.`);
  }

  return level;
};

/* -------------------------------------------------------------------------- */
/* 1. Đổi chiều cao Tầng trệt: 3,9 → 4,2 m, Tầng 2 dịch theo.                  */
/* -------------------------------------------------------------------------- */

describe('đổi chiều cao một tầng', () => {
  it('kéo cao độ tầng bên trên theo, và tốn ĐÚNG MỘT bước lịch sử', async () => {
    const mounted = await mountSettled();

    const groundId = String(FLOOR_MANAGER_SAMPLE_GROUND_ID);
    const secondId = String(FLOOR_MANAGER_SAMPLE_SECOND_ID);

    const groundBefore = levelIn(storeGraph(), groundId);
    const secondBefore = levelIn(storeGraph(), secondId);
    const stepsBefore = mounted.result.current.historyStepCount();

    /* Bộ mẫu phải đúng cảnh đặc tả tả: Tầng trệt cao 3,9 m, Tầng 2 ở cao độ 3,9 m. */
    expect(rowOf(mounted, groundId).heightText).toBe('3,9 m');
    expect(rowOf(mounted, secondId).elevationText).toBe('3,9 m');

    await commitField(mounted, groundId, 'height', '4,2');

    await waitFor(() => {
      expect(levelIn(storeGraph(), secondId).elevationMm).not.toBe(secondBefore.elevationMm);
    });

    const expectedHeightMm = metresToMillimetres(metres(NEW_GROUND_HEIGHT_M));

    console.log(
      `Tầng trệt: cao ${String(groundBefore.heightMm)} → ${String(levelIn(storeGraph(), groundId).heightMm)} mm · ` +
        `Tầng 2: cao độ ${String(secondBefore.elevationMm)} → ${String(levelIn(storeGraph(), secondId).elevationMm)} mm`,
    );

    expect(levelIn(storeGraph(), groundId).heightMm).toBe(expectedHeightMm);
    expect(levelIn(storeGraph(), secondId).elevationMm).toBe(expectedHeightMm);

    /* BUG-516: mốc `+0.000` của toà nhà mẫu là 0 như đường đọc thật; tầng hầm vẫn ở -3,0 m. */
    const basement = FLOOR_MANAGER_SAMPLE_LEVELS[0];

    expect(basement !== undefined && levelIn(storeGraph(), String(basement.id)).elevationMm).toBe(-3000);

    /* Và view-model nói cùng một chuyện, bằng chuỗi người đọc. */
    expect(rowOf(mounted, groundId).heightText).toBe('4,2 m');
    expect(rowOf(mounted, secondId).elevationText).toBe('4,2 m');

    /*
     * MỘT bước lịch sử cho cả hai lệnh (đổi chiều cao + xếp chồng lại) — hai
     * bước là đúng thứ QĐ-2 tồn tại để chặn.
     */
    expect(mounted.result.current.historyStepCount()).toBe(stepsBefore + 1);
  });

  it('một lần Ctrl+Z trả cả ngăn xếp về nguyên trạng', async () => {
    const mounted = await mountSettled();

    const groundId = String(FLOOR_MANAGER_SAMPLE_GROUND_ID);
    const readingsBefore = stackReadings(storeGraph());

    await commitField(mounted, groundId, 'height', '4,2');

    await waitFor(() => {
      expect(stackReadings(storeGraph())).not.toEqual(readingsBefore);
    });

    await pressKey(mounted.registry, 'z', { ctrlKey: true });

    expect(stackReadings(storeGraph())).toEqual(readingsBefore);
  });
});

/* -------------------------------------------------------------------------- */
/* 2. Chặn trùng cao độ — câu chặn nêu TÊN CẢ HAI TẦNG.                        */
/* -------------------------------------------------------------------------- */

describe('cao độ ghi đè (BUG-289)', () => {
  it('bộ mẫu liền mạch: không dòng nào ghi đè; đặt tay Tầng mái cao hơn 1 m thì chỉ dòng đó ghi đè', async () => {
    const mounted = await mountSettled();
    const roofId = String(FLOOR_MANAGER_SAMPLE_ROOF_ID);
    const second = levelIn(storeGraph(), String(FLOOR_MANAGER_SAMPLE_SECOND_ID));

    expect(mounted.result.current.rows.every((row) => !row.isElevationOverridden)).toBe(true);

    await commitField(
      mounted,
      roofId,
      'elevation',
      formatLength(second.elevationMm + second.heightMm + 1000, { unit: 'm', fractionDigits: 1 }).replace(' m', ''),
    );

    await waitFor(() => {
      expect(rowOf(mounted, roofId).isElevationOverridden).toBe(true);
    });
    expect(mounted.result.current.rows.filter((row) => row.isElevationOverridden)).toHaveLength(1);
  });
});

describe('đổi chiều cao giữ cao độ ghi đè (BUG-517)', () => {
  it('Tầng mái đặt tay cao hơn 1 m: đổi chiều cao Tầng trệt chỉ dịch Tầng 2, Tầng mái giữ cao độ và nhãn "Ghi đè"', async () => {
    const mounted = await mountSettled();
    const groundId = String(FLOOR_MANAGER_SAMPLE_GROUND_ID);
    const secondId = String(FLOOR_MANAGER_SAMPLE_SECOND_ID);
    const roofId = String(FLOOR_MANAGER_SAMPLE_ROOF_ID);
    const second = levelIn(storeGraph(), secondId);
    const roofMm = second.elevationMm + second.heightMm + 1000;

    await commitField(mounted, roofId, 'elevation', formatLength(roofMm, { unit: 'm', fractionDigits: 1 }).replace(' m', ''));
    await waitFor(() => {
      expect(rowOf(mounted, roofId).isElevationOverridden).toBe(true);
    });

    await commitField(mounted, groundId, 'height', '4,2');
    await waitFor(() => {
      expect(levelIn(storeGraph(), secondId).elevationMm).toBe(metresToMillimetres(metres(NEW_GROUND_HEIGHT_M)));
    });

    expect(levelIn(storeGraph(), roofId).elevationMm).toBe(roofMm);
    expect(rowOf(mounted, roofId).isElevationOverridden).toBe(true);
    expect(rowOf(mounted, secondId).isElevationOverridden).toBe(false);
  });
});

describe('lát cắt theo cao độ ghi đè (BUG-357)', () => {
  it('Tầng mái đặt tay cao hơn 1 m: khoảng hở 1 m nằm dưới dải của nó, dải và khoảng hở cộng lại bằng 1', async () => {
    const mounted = await mountSettled();
    const roofId = String(FLOOR_MANAGER_SAMPLE_ROOF_ID);
    const second = levelIn(storeGraph(), String(FLOOR_MANAGER_SAMPLE_SECOND_ID));

    expect(mounted.result.current.bands.every((band) => band.gapBelowRatio === 0)).toBe(true);

    await commitField(
      mounted,
      roofId,
      'elevation',
      formatLength(second.elevationMm + second.heightMm + 1000, { unit: 'm', fractionDigits: 1 }).replace(' m', ''),
    );
    await waitFor(() => {
      expect(rowOf(mounted, roofId).isElevationOverridden).toBe(true);
    });

    const bands = mounted.result.current.bands;
    const total = TOTAL_STACK_HEIGHT_MM + 1000;
    const roof = bands.find((band) => band.levelId === roofId);

    expect(roof?.gapBelowRatio).toBeCloseTo(1000 / total, 12);
    expect(bands.filter((band) => band.gapBelowRatio > 0)).toHaveLength(1);
    expect(bands.reduce((sum, band) => sum + band.bandHeightRatio + band.gapBelowRatio, 0)).toBeCloseTo(1, 12);
  });
});

describe('chặn trùng cao độ', () => {
  it('từ chối lượt đặt Tầng mái xuống đúng cao độ của Tầng 2, và gọi tên cả hai', async () => {
    const mounted = await mountSettled();

    const roofId = String(FLOOR_MANAGER_SAMPLE_ROOF_ID);
    const second = levelIn(storeGraph(), String(FLOOR_MANAGER_SAMPLE_SECOND_ID));
    const roof = levelIn(storeGraph(), roofId);
    const readingsBefore = stackReadings(storeGraph());
    const stepsBefore = mounted.result.current.historyStepCount();

    /* 3,9 m là ĐÚNG cao độ Tầng 2 đang đứng — đọc ra từ đồ thị, không gõ tay. */
    await commitField(
      mounted,
      roofId,
      'elevation',
      formatLength(second.elevationMm, { unit: 'm', fractionDigits: 1 }).replace(' m', ''),
    );

    const violation = mounted.result.current.duplicateElevationViolation;
    const message = mounted.result.current.duplicateElevationMessage ?? '';

    console.log(`câu chặn: ${message}`);

    expect(violation).not.toBeNull();
    expect(violation?.firstFloorName).toBe(roof.name);
    expect(violation?.secondFloorName).toBe(second.name);

    /* Câu người dùng đọc phải nêu ĐÍCH DANH cả hai tầng. */
    expect(message).toContain(roof.name);
    expect(message).toContain(second.name);

    /* aria-live cũng nghe được đúng câu đó (A12, R-72). */
    expect(mounted.spoken.some((line) => line.includes(second.name))).toBe(true);

    /* Và lượt đặt KHÔNG được ghi: không tầng nào dịch, không bước lịch sử nào thêm. */
    expect(stackReadings(storeGraph())).toEqual(readingsBefore);
    expect(mounted.result.current.historyStepCount()).toBe(stepsBefore);

    /* Câu chặn KHÔNG được lật màn sang trạng thái lỗi — nó là ràng buộc, không phải lỗi đọc. */
    expect(mounted.result.current.errorMessage).toBeNull();
    expect(mounted.result.current.state).not.toBe('error');
  });

  it('BUG-306: cao độ bị chặn giữ nguyên tên và chiều cao trong ô, chỉ ô cao độ của tầng đó mang lỗi', async () => {
    const mounted = await mountSettled();
    const roofId = String(FLOOR_MANAGER_SAMPLE_ROOF_ID);
    const second = levelIn(storeGraph(), String(FLOOR_MANAGER_SAMPLE_SECOND_ID));
    const roof = levelIn(storeGraph(), roofId);
    const typed = formatLength(second.elevationMm, { unit: 'm', fractionDigits: 1 }).replace(' m', '');

    await commitField(mounted, roofId, 'elevation', typed);

    const row = rowOf(mounted, roofId);
    expect(mounted.result.current.duplicateElevationMessage).not.toBeNull();
    expect(row.draft).toEqual({ name: roof.name, elevation: typed, height: metreDraftText(roof.heightMm) });
    expect(row.isElevationRefused).toBe(true);
    expect(mounted.result.current.rows.filter((candidate) => candidate.isElevationRefused)).toHaveLength(1);
  });

  it('bắt cả hai tầng KHÔNG liền kề đứng cùng một cao độ', () => {
    /*
     * `validateChangeLevelElevation` chỉ nhìn hai hàng xóm theo `Level.order`.
     * Ngăn xếp dưới đây có `order` không khớp thứ tự cao độ, nên chỉ phép so
     * bằng bổ sung của QĐ-3 mới bắt được lượt đặt này.
     */
    const graph = normalizeSpatial({
      building: {
        name: 'Ngăn xếp lệch thứ tự',
        datumElevationMm: 0,
        confidence: 1,
        source: 'human',
        reviewed: false,
      },
      levels: [
        {
          id: 'L-OUTOFORDER01' as LevelId,
          name: 'Tầng A',
          order: 0,
          elevationMm: 5000,
          heightMm: 1000,
          confidence: 1,
          source: 'human',
          reviewed: false,
        },
        {
          id: 'L-OUTOFORDER02' as LevelId,
          name: 'Tầng B',
          order: 1,
          elevationMm: 0,
          heightMm: 1000,
          confidence: 1,
          source: 'human',
          reviewed: false,
        },
        {
          id: 'L-OUTOFORDER03' as LevelId,
          name: 'Tầng C',
          order: 2,
          elevationMm: 9000,
          heightMm: 1000,
          confidence: 1,
          source: 'human',
          reviewed: false,
        },
      ],
      walls: [],
      openings: [],
      furniture: [],
      rooms: [],
      axes: [],
      dimensions: [],
      notes: [],
    });

    const conflict = findElevationConflict(
      { levelId: 'L-OUTOFORDER03' as LevelId, elevationMm: 5000 },
      { graph, actorId: 'test' },
    );

    expect(conflict).not.toBeNull();
    expect(conflict?.violation.firstFloorName).toBe('Tầng C');
    expect(conflict?.violation.secondFloorName).toBe('Tầng A');
    expect(conflict?.violation.elevationText).toBe('5,0 m');
    expect(conflict?.reasons.join(' ')).toContain('Tầng A');
    expect(conflict?.reasons.join(' ')).toContain('Tầng C');
  });
});

/* -------------------------------------------------------------------------- */
/* 3. Xoá tầng rồi hoàn tác.                                                   */
/* -------------------------------------------------------------------------- */

describe('Xoá tầng', () => {
  it('xoá ngay, KHÔNG hộp thoại, và phát vé hoàn tác 8 giây (A8)', async () => {
    const notifications = createNotificationBus();
    const mounted = await mountSettled({ notifications });
    const secondId = String(FLOOR_MANAGER_SAMPLE_SECOND_ID);

    await act(async () => {
      mounted.result.current.onRemoveFloor(secondId);
      await Promise.resolve();
    });

    await waitFor(() => {
      expect(notifications.list()).toHaveLength(1);
    });

    const published = notifications.list()[0];

    expect(published?.undoTicket).toBeDefined();
    expect(published?.undoTicket?.getStatus()).toBe('active');
    expect(published?.title).toContain('Tầng 2');
  });

  it('hoàn tác trả thứ tự, cao độ và nội dung của tầng về nguyên trạng', async () => {
    const mounted = await mountSettled();
    const secondId = String(FLOOR_MANAGER_SAMPLE_SECOND_ID);

    const readingsBefore = stackReadings(storeGraph());
    const contentsBefore = entitiesOnLevel(
      storeGraph(),
      FLOOR_MANAGER_SAMPLE_SECOND_ID,
    ).length;
    const stepsBefore = mounted.result.current.historyStepCount();

    expect(contentsBefore).toBeGreaterThan(0);

    await act(async () => {
      mounted.result.current.onRemoveFloor(secondId);
      await Promise.resolve();
    });

    await waitFor(() => {
      expect(mounted.result.current.historyStepCount()).toBe(stepsBefore + 1);
    });

    expect(levelsOf(storeGraph()).some((level) => String(level.id) === secondId)).toBe(false);
    expect(entitiesOnLevel(storeGraph(), FLOOR_MANAGER_SAMPLE_SECOND_ID)).toHaveLength(0);

    /* MỘT lần Ctrl+Z, qua sổ phím thật — không gọi tắt vào hàm hoàn tác. */
    await pressKey(mounted.registry, 'z', { ctrlKey: true });

    expect(stackReadings(storeGraph())).toEqual(readingsBefore);
    expect(entitiesOnLevel(storeGraph(), FLOOR_MANAGER_SAMPLE_SECOND_ID)).toHaveLength(
      contentsBefore,
    );
  });
});

/* -------------------------------------------------------------------------- */
/* 4. Nhân bản có / không kèm nội thất.                                        */
/* -------------------------------------------------------------------------- */

describe('nhân bản tầng', () => {
  const furnitureCountOn = (graph: NormalizedSpatial | null, levelId: LevelId): number =>
    entitiesOnLevel(graph, levelId).filter((entity) => String(entity.id).startsWith('F-')).length;

  const newestLevelId = (graph: NormalizedSpatial | null): LevelId => {
    const stack = levelsOf(graph);
    const top = stack[stack.length - 1];

    if (top === undefined) {
      throw new Error('Đồ thị không còn tầng nào sau lượt nhân bản.');
    }

    return top.id;
  };

  it('kèm nội thất thì tầng mới có đúng bấy nhiêu món', async () => {
    const mounted = await mountSettled();
    const groundId = String(FLOOR_MANAGER_SAMPLE_GROUND_ID);
    const sourceFurniture = furnitureCountOn(storeGraph(), FLOOR_MANAGER_SAMPLE_GROUND_ID);
    const levelsBefore = levelsOf(storeGraph()).length;

    expect(sourceFurniture).toBeGreaterThan(0);

    await act(async () => {
      mounted.result.current.onDuplicateFloor(groundId, { copyFurniture: true });
      await Promise.resolve();
    });

    await waitFor(() => {
      expect(levelsOf(storeGraph())).toHaveLength(levelsBefore + 1);
    });

    const copied = newestLevelId(storeGraph());

    console.log(
      `nhân bản KÈM nội thất: nguồn ${String(sourceFurniture)} món → bản sao ${String(furnitureCountOn(storeGraph(), copied))} món`,
    );

    expect(furnitureCountOn(storeGraph(), copied)).toBe(sourceFurniture);
  });

  it('không kèm nội thất thì tầng mới có tường và phòng nhưng không món nào', async () => {
    const mounted = await mountSettled();
    const groundId = String(FLOOR_MANAGER_SAMPLE_GROUND_ID);
    const levelsBefore = levelsOf(storeGraph()).length;
    const sourceEntities = entitiesOnLevel(storeGraph(), FLOOR_MANAGER_SAMPLE_GROUND_ID).length;
    const sourceFurniture = furnitureCountOn(storeGraph(), FLOOR_MANAGER_SAMPLE_GROUND_ID);

    await act(async () => {
      mounted.result.current.onDuplicateFloor(groundId, { copyFurniture: false });
      await Promise.resolve();
    });

    await waitFor(() => {
      expect(levelsOf(storeGraph())).toHaveLength(levelsBefore + 1);
    });

    const copied = newestLevelId(storeGraph());

    console.log(
      `nhân bản KHÔNG kèm nội thất: bản sao ${String(furnitureCountOn(storeGraph(), copied))} món, ` +
        `${String(entitiesOnLevel(storeGraph(), copied).length)} đối tượng`,
    );

    expect(furnitureCountOn(storeGraph(), copied)).toBe(0);
    expect(entitiesOnLevel(storeGraph(), copied).length).toBe(sourceEntities - sourceFurniture);
  });
});

/* -------------------------------------------------------------------------- */
/* 5. Tỷ lệ chiều cao bốn dải.                                                 */
/* -------------------------------------------------------------------------- */

describe('lát cắt', () => {
  it('bốn dải đúng tỷ lệ 3,0 / 3,9 / 3,6 / 3,6 m, và cộng lại bằng 1', async () => {
    const mounted = await mountSettled();
    const bands = mounted.result.current.bands;

    expect(bands).toHaveLength(FLOOR_MANAGER_SAMPLE_LEVELS.length);

    bands.forEach((band, index) => {
      const heightMm = SAMPLE_HEIGHTS_MM[index] ?? 0;

      expect(band.bandHeightRatio).toBeCloseTo(heightMm / TOTAL_STACK_HEIGHT_MM, 12);
      expect(band.label).toContain(
        `${heightMmText(heightMm)} mm`,
      );
    });

    const sum = bands.reduce((total, band) => total + band.bandHeightRatio, 0);

    console.log(
      `tỷ lệ dải: ${bands.map((band) => band.bandHeightRatio.toString()).join(' · ')} (tổng ${String(sum)})`,
    );

    expect(sum).toBeCloseTo(1, 12);
  });

  it('chân bảng cộng ra tổng chiều cao thật, không phải một chuỗi viết cứng', async () => {
    const mounted = await mountSettled();

    expect(mounted.result.current.footer.totalHeightText).toBe(
      `${heightMmText(TOTAL_STACK_HEIGHT_MM)} mm`,
    );
    expect(mounted.result.current.totalHeightText).toBe(
      mounted.result.current.footer.totalHeightText,
    );
    expect(mounted.result.current.footer.floorCountText).toBe('4 tầng');
  });

  it('vạch thang cao độ chạy từ đáy lên đỉnh, 0 tới 1', async () => {
    const mounted = await mountSettled();
    const ticks = mounted.result.current.elevationTicks;

    expect(ticks).toHaveLength(FLOOR_MANAGER_SAMPLE_LEVELS.length + 1);
    expect(ticks[0]?.offsetRatio).toBe(0);
    expect(ticks[ticks.length - 1]?.offsetRatio).toBe(1);
    expect(ticks[ticks.length - 1]?.offsetCssPercent).toBe('100%');
  });
});

/* -------------------------------------------------------------------------- */
/* Bảng và bản kê nợ.                                                          */
/* -------------------------------------------------------------------------- */

describe('bảng tầng', () => {
  it('tầng chưa có bản vẽ là trạng thái Một phần, và ba ô đếm hiện "—"', async () => {
    const mounted = await mountSettled();
    const roof = rowOf(mounted, String(FLOOR_MANAGER_SAMPLE_ROOF_ID));

    expect(mounted.result.current.state).toBe('partial');
    expect(roof.needsDrawing).toBe(true);
    expect(roof.drawingCountText).toBe('Chưa có bản vẽ');
    expect(roof.wallCountText).toBe('—');
    expect(roof.roomCountText).toBe('—');
    expect(roof.areaText).toBe('—');
    expect(roof.areaM2).toBeNull();
  });

  it('BUG-263: tầng chưa có bản vẽ không có tiến độ QC (không phải 100%)', async () => {
    const mounted = await mountSettled();
    const roof = rowOf(mounted, String(FLOOR_MANAGER_SAMPLE_ROOF_ID));

    expect(roof.qcProgressText).toBe('—');
    expect(roof.qcProgressRatio).toBe(0);
  });

  it('tầng có bản vẽ đếm được tường, phòng và diện tích của chính nó', async () => {
    const mounted = await mountSettled();
    const ground = rowOf(mounted, String(FLOOR_MANAGER_SAMPLE_GROUND_ID));
    const sample = FLOOR_MANAGER_SAMPLE_LEVELS[1];

    console.log(
      `Tầng trệt: ${ground.wallCountText} tường · ${ground.roomCountText} phòng · ${ground.areaText}`,
    );

    expect(ground.wallCountText).toBe(String(sample?.wallCount));
    expect(ground.roomCountText).toBe(String(sample?.roomCount));
    expect(ground.areaText).toBe('248,60 m²');
  });

  it('đường bao thật của mọi tầng có phòng cộng ra đúng 248,6 m² (B-V7-41)', () => {
    // 248.6 viết thẳng: notes/floor-manager/blueprint.md:638-640 (33 × 7,32 + 7,04).
    const graph = createFloorManagerSampleGraph();
    const levelsWithRooms = FLOOR_MANAGER_SAMPLE_LEVELS.filter((level) => level.roomCount > 0);

    expect(levelsWithRooms.length).toBeGreaterThan(0);
    for (const level of levelsWithRooms) {
      const outlines = roomsOfLevel(graph, level.id).map((room) =>
        room.outline.map((corner) => ({ x: millimetres(corner.x), y: millimetres(corner.y) })),
      );
      expect(totalArea(outlines), level.name).toBe(248.6);
    }
  });

  it('vai Người xem ẩn mọi thao tác sửa và nói ra vì sao', async () => {
    const mounted = await mountSettled({ roles: ['viewer'] });

    expect(mounted.result.current.state).toBe('forbidden');
    expect(mounted.result.current.canEdit).toBe(false);
    expect(mounted.result.current.forbiddenNotice).not.toBeNull();
  });

  it('nói ra khoản nợ của cổng thay vì im lặng; câu ẩn 3D chỉ khi đã ẩn một tầng (BUG-287)', async () => {
    const mounted = await mountSettled();

    // G3-16: vừa mở, chưa sửa gì thì không có câu "chưa lưu" nào.
    expect(mounted.result.current.unsupportedNotices).toEqual([]);

    await act(async () => {
      mounted.result.current.onToggleHiddenIn3d(String(FLOOR_MANAGER_SAMPLE_ROOF_ID));
      await Promise.resolve();
    });

    await waitFor(() => {
      expect(mounted.result.current.unsupportedNotices).toEqual([
        FLOOR_MANAGER_UNSUPPORTED_NOTICES.hideFloorFrom3d,
      ]);
    });
  });

  it('ẩn tầng khỏi 3D là khung đọc của màn, và màn nói rằng nó không lưu được', async () => {
    const mounted = await mountSettled();
    const roofId = String(FLOOR_MANAGER_SAMPLE_ROOF_ID);

    await act(async () => {
      mounted.result.current.onToggleHiddenIn3d(roofId);
      await Promise.resolve();
    });

    await waitFor(() => {
      expect(rowOf(mounted, roofId).isHiddenIn3d).toBe(true);
    });

    expect(
      mounted.spoken.some(
        (line) => line === FLOOR_MANAGER_UNSUPPORTED_NOTICES.hideFloorFrom3d,
      ),
    ).toBe(true);

    /* Khung đọc, không phải thay đổi mô hình: không bước lịch sử nào sinh ra. */
    expect(mounted.result.current.historyStepCount()).toBe(0);
  });

  it('trạng thái lỗi mang câu của describeError và giữ nút Thử lại', async () => {
    const gateway: FloorManagerGateway = createMockFloorManagerGateway({
      failReadFloorList: true,
    });
    const mounted = await mountSettled({ gateway });

    expect(mounted.result.current.state).toBe('error');
    expect(mounted.result.current.errorMessage).not.toBeNull();
    expect(mounted.result.current.rows).toHaveLength(0);
  });

  // BUG-032: 404 của danh sách tầng là dự án không tồn tại — tải lại không cứu được.
  it('404 của danh sách tầng nói không tìm thấy dự án, không khuyên tải lại', async () => {
    const notFound: HttpError = { kind: 'http', status: 404, requestId: 'REQ-404', retryable: false, raw: null };
    const gateway: FloorManagerGateway = {
      ...createMockFloorManagerGateway(),
      readFloorList: () => Promise.reject(notFound),
    };
    const mounted = await mountSettled({ gateway });

    expect(mounted.result.current.state).toBe('error');
    expect(mounted.result.current.isProjectMissing).toBe(true);
    expect(mounted.result.current.errorMessage).toBe(
      'Dự án có thể đã bị xoá, đường dẫn chưa đúng, hoặc bạn chưa được thêm vào dự án.',
    );
  });

  it('dự án chưa có tầng nào là trạng thái Rỗng, không phải màn trắng', async () => {
    const gateway = createMockFloorManagerGateway({
      graph: createFloorManagerSampleGraph({ levels: [] }),
      floors: [],
    });
    const mounted = await mountSettled({ gateway });

    expect(mounted.result.current.state).toBe('empty');
    expect(mounted.result.current.emptyNotice).toBe(
      'Thêm tầng đầu tiên, hoặc nhập số tầng từ màn hình tạo dự án.',
    );
    expect(mounted.result.current.bands).toHaveLength(0);
  });

  it('BUG-522: người xem mở dự án rỗng thấy trạng thái Rỗng, không lời mời thêm tầng', async () => {
    const gateway = createMockFloorManagerGateway({
      graph: createFloorManagerSampleGraph({ levels: [] }),
      floors: [],
    });
    const mounted = await mountSettled({ gateway, roles: ['viewer'] });

    await waitFor(() => {
      expect(mounted.result.current.state).toBe('empty');
    });
    expect(mounted.result.current.emptyNotice).toBe(FLOOR_MANAGER_TEXT.viewerEmptyNotice);
    expect(mounted.result.current.forbiddenNotice).not.toBeNull();
  });

  it('BUG-522: người xem mở mã dự án lạ thấy "không tìm thấy dự án", không chỉ dải quyền', async () => {
    const notFound: HttpError = { kind: 'http', status: 404, requestId: 'REQ-404', retryable: false, raw: null };
    const gateway: FloorManagerGateway = {
      ...createMockFloorManagerGateway(),
      readFloorList: () => Promise.reject(notFound),
    };
    const mounted = await mountSettled({ gateway, roles: ['viewer'] });

    await waitFor(() => {
      expect(mounted.result.current.state).toBe('error');
    });
    expect(mounted.result.current.isProjectMissing).toBe(true);
  });

  it('BUG-521: người xem không nghe câu nhân bản/xoá tầng chưa lưu; người sửa vẫn nghe', async () => {
    const viewer = await mountSettled({ roles: ['viewer'] });

    expect(viewer.result.current.unsupportedNotices).not.toContain(
      FLOOR_MANAGER_UNSUPPORTED_NOTICES.persistFloorContents,
    );
    viewer.unmount();

    const editor = await mountSettled();

    // G3-16: người sửa chỉ nghe câu ấy sau khi đã xoá (hay nhân bản) một tầng.
    expect(editor.result.current.unsupportedNotices).not.toContain(
      FLOOR_MANAGER_UNSUPPORTED_NOTICES.persistFloorContents,
    );

    await act(async () => {
      editor.result.current.onRemoveFloor(String(FLOOR_MANAGER_SAMPLE_ROOF_ID));
      await Promise.resolve();
    });

    await waitFor(() => {
      expect(editor.result.current.unsupportedNotices).toContain(
        FLOOR_MANAGER_UNSUPPORTED_NOTICES.persistFloorContents,
      );
    });
  });
});

/* -------------------------------------------------------------------------- */
/* F-03: lồng dự án, hoàn tác gọi máy chủ, lùi khi ghi hỏng.                    */
/* -------------------------------------------------------------------------- */

const NEW_ID = 'L-0000000001' as LevelId;
const BASEMENT_ID = 'L-FLOORBASEMENT';
const GROUND_ID = String(FLOOR_MANAGER_SAMPLE_GROUND_ID);
const SECOND_ID = String(FLOOR_MANAGER_SAMPLE_SECOND_ID);
const ROOF_ID = String(FLOOR_MANAGER_SAMPLE_ROOF_ID);
const SAMPLE_ORDER = [BASEMENT_ID, GROUND_ID, SECOND_ID, ROOF_ID];

/** Thân tầng như máy chủ trả — dữ liệu DÂY; schema chỉ khẳng định nó hợp lệ. */
function wireFloorBody(id: string): Record<string, unknown> {
  return { id, name: 'Tầng', order: 0, elevationMm: 0, heightMm: 3000, drawings: [] };
}

function wireFloor(id: string): Floor {
  return FloorSchema.parse(wireFloorBody(id));
}

/** Lỗi dây: `HttpError` có `status`, `code`, và `raw` khớp `ApiErrorBodySchema`. */
function wireFailure<TValue>(
  status: number,
  code: string,
  resource?: 'floor' | 'project',
): Promise<ApiResult<TValue>> {
  const raw = { code, requestId: 'REQ-F03', ...(resource === undefined ? {} : { resource }) };

  ApiErrorBodySchema.parse(raw);

  const error: HttpError = { kind: 'http', status, code, requestId: 'REQ-F03', retryable: false, raw };

  return Promise.resolve({ ok: false, error });
}

type Persist<TKey extends 'persistAddFloor' | 'persistRemoveFloor' | 'persistReorderFloors' | 'persistFloorFields'> =
  Mock<FloorManagerGateway[TKey]>;

/** Cổng mẫu, nhưng mỗi lượt ghi là một `vi.fn` để đọc lại từng request. */
function spiedGateway(seed: FloorManagerGatewaySeed = {}): {
  readonly gateway: FloorManagerGateway;
  readonly add: Persist<'persistAddFloor'>;
  readonly remove: Persist<'persistRemoveFloor'>;
  readonly reorder: Persist<'persistReorderFloors'>;
  readonly patch: Persist<'persistFloorFields'>;
} {
  const base = createMockFloorManagerGateway(seed);
  const add = vi.fn(base.persistAddFloor);
  const remove = vi.fn(base.persistRemoveFloor);
  const reorder = vi.fn(base.persistReorderFloors);
  const patch = vi.fn(base.persistFloorFields);

  return {
    gateway: {
      ...base,
      persistAddFloor: add,
      persistRemoveFloor: remove,
      persistReorderFloors: reorder,
      persistFloorFields: patch,
    },
    add,
    remove,
    reorder,
    patch,
  };
}

const sleep = (): Promise<void> =>
  act(async () => {
    await new Promise<void>((resolve) => {
      setTimeout(resolve, 0);
    });
  });

const undoWithKey = (mounted: Mounted): Promise<void> =>
  pressKey(mounted.registry, 'z', { ctrlKey: true });

const levelIds = (): readonly string[] => levelsOf(storeGraph()).map((level) => String(level.id));

const descriptionsOf = (notifications: NotificationBus): readonly string[] =>
  notifications.list().map((entry) => entry.description);

const fiftyLevels = Array.from({ length: 50 }, (_, index) => ({
  id: `L-${String(index + 1).padStart(10, '0')}` as LevelId,
  name: `Tầng ${String(index)}`,
  elevationMm: index * 3000,
  heightMm: 3000,
  drawingCount: 0,
  wallCount: 0,
  roomCount: 0,
  furnitureCount: 0,
}));

describe('làm tròn milimét', () => {
  it('gõ 3,95 m ra milimét nguyên, kể cả số lẻ dưới milimét', () => {
    expect(draftToMillimetres('3,95')).toBe(3950);
    expect(draftToMillimetres('3,9549')).toBe(3955);
    expect(Number.isInteger(draftToMillimetres('1,0004'))).toBe(true);
  });

  it('thân ghi tầng làm tròn cao độ và chiều cao', () => {
    const level: Level = {
      ...levelIn(createFloorManagerSampleGraph(), GROUND_ID),
      elevationMm: 1234.6,
      heightMm: 2999.5,
    };
    const body = floorWriteBodyOf(level);

    expect(body.elevationMm).toBe(1235);
    expect(body.heightMm).toBe(3000);
  });
});

describe('cổng thật', () => {
  it('đọc tầng theo dự án, và POST gửi id trong thân chứ không gửi projectId', async () => {
    const fetchImpl = vi.fn<typeof fetch>(() =>
      Promise.resolve(
        new Response(JSON.stringify([]), {
          headers: { 'Content-Type': 'application/json' },
          status: 200,
        }),
      ),
    );
    const gateway = createFloorManagerGateway({
      api: createApiClient(createHttpClient({ baseUrl: 'https://api.example.com', fetchImpl })),
      graph: { read: () => null },
    });

    await gateway.readFloorList({ projectId: 'P-0000000001' });

    expect(String(fetchImpl.mock.calls[0]?.[0])).toContain('/projects/P-0000000001/floors');

    fetchImpl.mockClear();
    fetchImpl.mockImplementation(() =>
      Promise.resolve(
        new Response(JSON.stringify(wireFloorBody(String(NEW_ID))), {
          headers: { 'Content-Type': 'application/json' },
          status: 201,
        }),
      ),
    );

    await gateway.persistAddFloor({
      projectId: 'P-0000000001',
      level: { ...levelIn(createFloorManagerSampleGraph(), GROUND_ID), id: NEW_ID },
    });

    const [url, init] = fetchImpl.mock.calls[0] ?? [];
    const sent = JSON.parse(String(init?.body)) as Record<string, unknown>;

    expect(String(url)).toContain('/projects/P-0000000001/floors');
    expect(sent.id).toBe(NEW_ID);
    expect(sent).not.toHaveProperty('projectId');
  });
});

describe('Thêm tầng', () => {
  it('gửi đúng id của tầng vừa dựng cho dự án này', async () => {
    const { gateway, add } = spiedGateway({ nextLevelId: () => NEW_ID });
    const mounted = await mountSettled({ gateway });

    await act(async () => {
      mounted.result.current.onAddFloor();
      await Promise.resolve();
    });
    await waitFor(() => {
      expect(add).toHaveBeenCalledTimes(1);
    });

    const input = add.mock.calls[0]?.[0];

    expect(input?.projectId).toBe(PROJECT_ID);
    expect(String(input?.level.id)).toBe(String(NEW_ID));
    expect(wireFloor(String(NEW_ID)).id).toBe(String(NEW_ID));
  });

  it('đủ 50 tầng thì KHÔNG POST, không dựng lệnh, và nói ra câu', async () => {
    const { gateway, add } = spiedGateway({
      graph: createFloorManagerSampleGraph({ levels: fiftyLevels, withContents: false }),
      floors: [],
    });
    const mounted = await mountSettled({ gateway });

    await act(async () => {
      mounted.result.current.onAddFloor();
      mounted.result.current.onDuplicateFloor(String(fiftyLevels[0]?.id), { copyFurniture: false });
      await Promise.resolve();
    });
    await sleep();

    expect(add).not.toHaveBeenCalled();
    expect(levelIds()).toHaveLength(50);
    expect(mounted.result.current.historyStepCount()).toBe(0);
    expect(descriptionsOf(mounted.notifications)).toContain(FLOOR_MANAGER_TEXT.limitReached);
    expect(mounted.spoken).toContain(FLOOR_MANAGER_TEXT.limitReached);
  });

  it.each([
    [409, 'FLOOR_ID_TAKEN', FLOOR_MANAGER_TEXT.idTaken],
    [422, 'FLOOR_LIMIT_REACHED', FLOOR_MANAGER_TEXT.limitReached],
  ])(
    'máy chủ từ chối %i %s thì tầng rời khỏi đồ thị, có câu riêng, không dải tải lại',
    async (status, code, sentence) => {
      const { gateway, add } = spiedGateway({ nextLevelId: () => NEW_ID });
      const mounted = await mountSettled({ gateway });

      add.mockImplementation(() => wireFailure(status, code));

      await act(async () => {
        mounted.result.current.onAddFloor();
        await Promise.resolve();
      });
      await waitFor(() => {
        expect(descriptionsOf(mounted.notifications)).toContain(sentence);
      });

      expect(levelIds()).toEqual(SAMPLE_ORDER);
      expect(mounted.result.current.historyStepCount()).toBe(0);
      expect(mounted.result.current.state).not.toBe('error');
      expect(mounted.result.current.errorMessage).toBeNull();
      expect(descriptionsOf(mounted.notifications).join(' ')).not.toContain(code);
    },
  );
});

describe('hoàn tác gọi máy chủ', () => {
  it('hoàn tác "thêm" gửi DELETE đúng tầng đó', async () => {
    const { gateway, remove } = spiedGateway({ nextLevelId: () => NEW_ID });
    const mounted = await mountSettled({ gateway });

    await act(async () => {
      mounted.result.current.onAddFloor();
      await Promise.resolve();
    });
    await waitFor(() => {
      expect(levelIds()).toContain(String(NEW_ID));
    });
    await sleep();
    await undoWithKey(mounted);
    await waitFor(() => {
      expect(remove).toHaveBeenCalledTimes(1);
    });

    expect(remove.mock.calls[0]?.[0]).toEqual({ projectId: PROJECT_ID, floorId: String(NEW_ID) });
    expect(levelIds()).toEqual(SAMPLE_ORDER);
  });

  it.each([
    [569 * 1000, true],
    [571 * 1000, false],
  ])('hoàn tác "Xoá" sau %i ms: gửi POST khôi phục = %s', async (elapsedMs, restores) => {
    let clock = 1_000_000;
    const { gateway, add } = spiedGateway({ now: () => clock });
    const mounted = await mountSettled({ gateway });

    expect(FLOOR_RESTORE_WINDOW_MS).toBe(570 * 1000);

    await act(async () => {
      mounted.result.current.onRemoveFloor(SECOND_ID);
      await Promise.resolve();
    });
    await waitFor(() => {
      expect(levelIds()).not.toContain(SECOND_ID);
    });
    await sleep();

    const afterRemove = stackReadings(storeGraph());

    clock += elapsedMs;
    await undoWithKey(mounted);
    await sleep();

    if (restores) {
      await waitFor(() => {
        expect(add).toHaveBeenCalledTimes(1);
      });

      expect(String(add.mock.calls[0]?.[0].level.id)).toBe(SECOND_ID);
      expect(levelIds()).toContain(SECOND_ID);
    } else {
      expect(add).not.toHaveBeenCalled();
      expect(stackReadings(storeGraph())).toEqual(afterRemove);
      expect(descriptionsOf(mounted.notifications)).toContain(FLOOR_MANAGER_TEXT.undoExpired);
    }
  });

  it('hoàn tác đổi tên và đổi cao độ gửi PATCH mang giá trị cũ', async () => {
    const { gateway, patch } = spiedGateway();
    const mounted = await mountSettled({ gateway });
    const before = levelIn(storeGraph(), ROOF_ID);

    await commitField(mounted, ROOF_ID, 'name', 'Mái mới');
    await waitFor(() => {
      expect(patch).toHaveBeenCalledTimes(1);
    });
    await undoWithKey(mounted);
    await waitFor(() => {
      expect(patch).toHaveBeenCalledTimes(2);
    });

    expect(patch.mock.calls[1]?.[0].floorId).toBe(ROOF_ID);
    expect(patch.mock.calls[1]?.[0].body.name).toBe(before.name);

    patch.mockClear();
    await commitField(mounted, ROOF_ID, 'elevation', '8');
    await waitFor(() => {
      expect(patch).toHaveBeenCalledTimes(1);
    });
    await undoWithKey(mounted);
    await waitFor(() => {
      expect(patch).toHaveBeenCalledTimes(2);
    });

    expect(patch.mock.calls[1]?.[0].body.elevationMm).toBe(before.elevationMm);
  });

  it('hoàn tác sắp xếp gửi #13 thứ tự cũ (đủ 4 tầng) rồi mới #34', async () => {
    const { gateway, reorder, patch } = spiedGateway();
    const mounted = await mountSettled({ gateway });
    const swapped = [BASEMENT_ID, SECOND_ID, GROUND_ID, ROOF_ID];

    await act(async () => {
      mounted.result.current.onReorderFloors(swapped);
      await Promise.resolve();
    });
    await waitFor(() => {
      expect(levelIds()).toEqual(swapped);
    });
    await sleep();

    expect(reorder.mock.calls[0]?.[0].floorIds).toEqual(swapped);

    reorder.mockClear();
    patch.mockClear();
    await undoWithKey(mounted);
    await waitFor(() => {
      expect(reorder).toHaveBeenCalledTimes(1);
      expect(patch.mock.calls.length).toBeGreaterThan(0);
    });

    expect(reorder.mock.calls[0]?.[0]).toEqual({ projectId: PROJECT_ID, floorIds: SAMPLE_ORDER });
    expect(Math.max(...reorder.mock.invocationCallOrder)).toBeLessThan(
      Math.min(...patch.mock.invocationCallOrder),
    );
  });

  it('hoàn tác đổi chiều cao tầng 1 KHÔNG gửi #13, chỉ #34', async () => {
    const { gateway, reorder, patch } = spiedGateway();
    const mounted = await mountSettled({ gateway });

    await commitField(mounted, GROUND_ID, 'height', '4,2');
    await waitFor(() => {
      expect(patch.mock.calls.length).toBeGreaterThan(0);
    });
    await sleep();
    patch.mockClear();
    await undoWithKey(mounted);
    await waitFor(() => {
      expect(patch.mock.calls.length).toBeGreaterThan(0);
    });

    expect(reorder).not.toHaveBeenCalled();
    expect(patch.mock.calls.map((call) => call[0].floorId)).toContain(GROUND_ID);
  });

  it('máy chủ từ chối lúc hoàn tác thì đồ thị trở lại đúng như sau thao tác', async () => {
    const { gateway, patch } = spiedGateway();
    const mounted = await mountSettled({ gateway });

    await commitField(mounted, ROOF_ID, 'name', 'Mái mới');
    await waitFor(() => {
      expect(patch).toHaveBeenCalledTimes(1);
    });
    await sleep();

    const afterEdit = stackReadings(storeGraph());
    const stepsAfterEdit = mounted.result.current.historyStepCount();
    const pastBefore = useStore.temporal.getState().pastStates.length;

    patch.mockImplementation(() => wireFailure(404, 'NOT_FOUND', 'floor'));
    await undoWithKey(mounted);
    await waitFor(() => {
      expect(descriptionsOf(mounted.notifications)).toContain(FLOOR_MANAGER_TEXT.floorGone);
    });

    expect(levelIn(storeGraph(), ROOF_ID).name).toBe('Mái mới');
    expect(stackReadings(storeGraph())).toEqual(afterEdit);
    expect(mounted.result.current.historyStepCount()).toBe(stepsAfterEdit);
    /* Nhiều nhất là bước của chính lượt hoàn tác cục bộ; lượt lùi vì máy chủ từ chối không thêm bước nào. */
    expect(useStore.temporal.getState().pastStates.length).toBeLessThanOrEqual(pastBefore + 1);
    expect(patch).toHaveBeenCalledTimes(2);
  });

  it('[11F-B-202] hoàn tác "Xoá" khi mã tầng đã bị tạo lại: POST 409 → bus giữ câu "Mã tầng đã có"', async () => {
    const { gateway, add } = spiedGateway();
    const mounted = await mountSettled({ gateway });

    await act(async () => {
      mounted.result.current.onRemoveFloor(SECOND_ID);
      await Promise.resolve();
    });
    await waitFor(() => {
      expect(levelIds()).not.toContain(SECOND_ID);
    });
    await sleep();

    add.mockImplementation(() => wireFailure(409, 'FLOOR_ID_TAKEN'));
    await undoWithKey(mounted);
    await waitFor(() => {
      expect(descriptionsOf(mounted.notifications)).toContain(FLOOR_MANAGER_TEXT.idTaken);
    });

    expect(add).toHaveBeenCalledTimes(1);
    expect(levelIds()).not.toContain(SECOND_ID);
    expect(mounted.notifications.list().some((item) => item.title === FLOOR_MANAGER_TEXT.persistFailedTitle)).toBe(true);
  });

  it('[11F-B-202] bấm vé GỘP "Hoàn tác 2 thay đổi": con đầu 409 → câu "Mã tầng đã có" còn lại, không bị câu "không còn là gần nhất" đè', async () => {
    const { gateway, add } = spiedGateway();
    const mounted = await mountSettled({ gateway });

    for (const id of [SECOND_ID, ROOF_ID]) {
      await act(async () => {
        mounted.result.current.onRemoveFloor(id);
        await Promise.resolve();
      });
      await waitFor(() => {
        expect(levelIds()).not.toContain(id);
      });
    }
    await sleep();

    const grouped = mounted.notifications.list().find((item) => item.undoTicket !== undefined);

    add.mockImplementation(() => wireFailure(409, 'FLOOR_ID_TAKEN'));
    await act(async () => {
      grouped?.undoTicket?.undo();
      await Promise.resolve();
    });
    await sleep();

    const failure = mounted.notifications.list().find((item) => item.title === FLOOR_MANAGER_TEXT.persistFailedTitle);

    expect(add).toHaveBeenCalledTimes(1);
    expect(failure?.description).toBe(FLOOR_MANAGER_TEXT.idTaken);
  });

  it('bấm vé khi đã có thao tác mới hơn thì KHÔNG hoàn tác bước khác', async () => {
    const { gateway, add } = spiedGateway();
    const mounted = await mountSettled({ gateway });

    await act(async () => {
      mounted.result.current.onRemoveFloor(SECOND_ID);
      await Promise.resolve();
    });
    await waitFor(() => {
      expect(mounted.notifications.list()).toHaveLength(1);
    });

    const ticket = mounted.notifications.list()[0]?.undoTicket;

    await commitField(mounted, ROOF_ID, 'name', 'Mái mới');
    await sleep();
    add.mockClear();
    ticket?.undo();
    await sleep();

    expect(levelIds()).not.toContain(SECOND_ID);
    expect(levelIn(storeGraph(), ROOF_ID).name).toBe('Mái mới');
    expect(add).not.toHaveBeenCalled();
    expect(descriptionsOf(mounted.notifications)).toContain(FLOOR_MANAGER_TEXT.undoNotLatest);
  });

  it('bấm vé lúc #11 còn bay thì POST khôi phục chạy SAU khi #11 xong', async () => {
    const { gateway, add, remove } = spiedGateway();
    const mounted = await mountSettled({ gateway });
    const settled = wireFloor(SECOND_ID);
    let finishRemove: () => void = () => undefined;

    remove.mockImplementation(
      () =>
        new Promise((resolve) => {
          finishRemove = () => {
            resolve({ ok: true, data: settled });
          };
        }),
    );

    await act(async () => {
      mounted.result.current.onRemoveFloor(SECOND_ID);
      await Promise.resolve();
    });
    await waitFor(() => {
      expect(mounted.notifications.list()).toHaveLength(1);
      expect(remove).toHaveBeenCalledTimes(1);
    });

    mounted.notifications.list()[0]?.undoTicket?.undo();
    await sleep();

    expect(add).not.toHaveBeenCalled();

    await act(async () => {
      finishRemove();
      await Promise.resolve();
    });
    await waitFor(() => {
      expect(add).toHaveBeenCalledTimes(1);
    });

    expect(Math.max(...remove.mock.invocationCallOrder)).toBeLessThan(
      Math.min(...add.mock.invocationCallOrder),
    );
    expect(levelIds()).toContain(SECOND_ID);
  });

  it('#11 hỏng thì lùi cục bộ, tầng trở lại, không mở thêm bước hoàn tác', async () => {
    const { gateway, remove } = spiedGateway();
    const mounted = await mountSettled({ gateway });
    const before = stackReadings(storeGraph());
    const pastBefore = useStore.temporal.getState().pastStates.length;

    remove.mockImplementation(() => wireFailure(409, 'FLOOR_ID_AMBIGUOUS'));

    await act(async () => {
      mounted.result.current.onRemoveFloor(SECOND_ID);
      await Promise.resolve();
    });
    await waitFor(() => {
      expect(descriptionsOf(mounted.notifications)).toContain(FLOOR_MANAGER_TEXT.idAmbiguous);
    });

    expect(stackReadings(storeGraph())).toEqual(before);
    expect(mounted.result.current.historyStepCount()).toBe(0);
    /* Chỉ lượt xoá cục bộ mở một bước zundo; lượt lùi thì không. */
    expect(useStore.temporal.getState().pastStates.length).toBe(pastBefore + 1);
  });

  it('#11 hỏng rồi bấm vé (lịch sử đã rỗng) thì vé nói ra, không im lặng', async () => {
    const { gateway, remove } = spiedGateway();
    const mounted = await mountSettled({ gateway });

    remove.mockImplementation(() => wireFailure(409, 'FLOOR_ID_AMBIGUOUS'));

    await act(async () => {
      mounted.result.current.onRemoveFloor(SECOND_ID);
      await Promise.resolve();
    });
    await waitFor(() => {
      expect(descriptionsOf(mounted.notifications)).toContain(FLOOR_MANAGER_TEXT.idAmbiguous);
    });

    expect(mounted.result.current.historyStepCount()).toBe(0);

    const ticket = mounted.notifications.list().find((entry) => entry.undoTicket !== undefined)
      ?.undoTicket;

    ticket?.undo();
    await sleep();

    expect(descriptionsOf(mounted.notifications)).toContain(FLOOR_MANAGER_TEXT.undoNotLatest);
  });
});

describe('vé hoàn tác của bốn thao tác còn lại (A8)', () => {
  const latestTicket = (mounted: Awaited<ReturnType<typeof mountSettled>>) =>
    mounted.notifications.list().find((entry) => entry.undoTicket !== undefined)?.undoTicket;

  it('thêm tầng có vé, bấm vé gửi DELETE tầng đó', async () => {
    const { gateway, remove } = spiedGateway({ nextLevelId: () => NEW_ID });
    const mounted = await mountSettled({ gateway });

    await act(async () => {
      mounted.result.current.onAddFloor();
      await Promise.resolve();
    });
    await waitFor(() => {
      expect(latestTicket(mounted)).toBeDefined();
    });
    await sleep();
    latestTicket(mounted)?.undo();
    await waitFor(() => {
      expect(remove).toHaveBeenCalledTimes(1);
    });

    expect(remove.mock.calls[0]?.[0]).toEqual({ projectId: PROJECT_ID, floorId: String(NEW_ID) });
  });

  it.each([
    ['name', 'Mái mới', 'name'],
    ['elevation', '8', 'elevationMm'],
    ['height', '4,2', 'heightMm'],
  ] as const)('đổi %s có vé, bấm vé gửi #34 giá trị cũ', async (field, value, key) => {
    const { gateway, patch } = spiedGateway();
    const mounted = await mountSettled({ gateway });
    const before = levelIn(storeGraph(), ROOF_ID);

    await commitField(mounted, ROOF_ID, field, value);
    await waitFor(() => {
      expect(latestTicket(mounted)).toBeDefined();
      expect(patch.mock.calls.length).toBeGreaterThan(0);
    });
    await sleep();
    patch.mockClear();
    latestTicket(mounted)?.undo();
    await waitFor(() => {
      expect(patch.mock.calls.length).toBeGreaterThan(0);
    });

    const body = patch.mock.calls.find((call) => call[0].floorId === ROOF_ID)?.[0].body;

    expect(body?.[key]).toBe(before[key]);
  });

  it('bấm vé đổi tên khi đã có thao tác mới hơn thì không hoàn tác bước khác', async () => {
    const { gateway } = spiedGateway();
    const mounted = await mountSettled({ gateway });

    await commitField(mounted, ROOF_ID, 'name', 'Mái mới');
    await waitFor(() => {
      expect(latestTicket(mounted)).toBeDefined();
    });

    const ticket = latestTicket(mounted);

    await commitField(mounted, GROUND_ID, 'name', 'Trệt mới');
    await sleep();
    ticket?.undo();
    await sleep();

    expect(levelIn(storeGraph(), ROOF_ID).name).toBe('Mái mới');
    expect(levelIn(storeGraph(), GROUND_ID).name).toBe('Trệt mới');
    expect(descriptionsOf(mounted.notifications)).toContain(FLOOR_MANAGER_TEXT.undoNotLatest);
  });
});

describe('tên tầng', () => {
  it('tên chứa U+202E thì KHÔNG PATCH, và nói ra cả toast lẫn aria-live', async () => {
    const { gateway, patch } = spiedGateway();
    const mounted = await mountSettled({ gateway });
    const before = stackReadings(storeGraph());

    await commitField(mounted, ROOF_ID, 'name', 'Mái‮mới');
    await sleep();

    const sentence = 'Tên tầng có ký tự điều khiển hoặc ký tự đảo chiều chữ, hãy xoá chúng đi.';

    expect(patch).not.toHaveBeenCalled();
    expect(stackReadings(storeGraph())).toEqual(before);
    expect(descriptionsOf(mounted.notifications)).toContain(sentence);
    expect(mounted.spoken).toContain(sentence);
  });
});

describe('tên tầng thêm mới (BUG-277)', () => {
  const stack = (...names: readonly string[]) =>
    names.map((name, index) => ({ name, elevationMm: millimetres(index * 3000) }));

  it.each([
    { label: 'trệt, 1, 2, 3 → Tầng 4 (không nhảy sang 5)', levels: stack('Tầng trệt', 'Tầng 1', 'Tầng 2', 'Tầng 3'), expected: 'Tầng 4' },
    { label: 'Tầng 1..3 → Tầng 4 (bỏ qua tên đã có)', levels: stack('Tầng 1', 'Tầng 2', 'Tầng 3'), expected: 'Tầng 4' },
    { label: 'chưa có tầng → Tầng 1', levels: [], expected: 'Tầng 1' },
    {
      label: 'tầng hầm không chiếm số',
      levels: [{ name: 'Tầng hầm', elevationMm: millimetres(-3000) }, ...stack('Tầng trệt')],
      expected: 'Tầng 1',
    },
  ])('$label', ({ levels, expected }) => {
    expect(nextNewFloorName(levels)).toBe(expected);
  });
});

describe('useFloorManager — bộ đệm dùng chung với Tải bản vẽ (BUG-348)', () => {
  it('không ghi ảnh chụp { graph, floors } vào khoá floor.list mà Tải bản vẽ đọc là Floor[]', async () => {
    const { queryClient } = await mountSettled();
    const listKey = queryKeys.floor.list(PROJECT_ID);

    // Màn Tải bản vẽ trải `floor.list` như mảng; một object ở đó là màn "Có trục trặc" sau "Tải lên".
    const shared = queryClient.getQueryData(listKey);
    expect(shared === undefined || Array.isArray(shared)).toBe(true);

    // Làm mất hiệu lực `floor.list` (editFloor, lượt tải xong) vẫn chạm lượt đọc của màn này.
    await act(async () => {
      await queryClient.invalidateQueries({ queryKey: listKey });
    });
    const own = queryClient.getQueryCache().findAll({ queryKey: listKey });
    expect(own.length).toBeGreaterThan(0);
    expect(own.every((query) => query.state.dataUpdateCount >= 2)).toBe(true);
  });
});

describe('BUG-515 — kho dùng chung không che tầng của dự án trên URL', () => {
  const ROOF = FLOOR_MANAGER_SAMPLE_LEVELS[FLOOR_MANAGER_SAMPLE_LEVELS.length - 1];
  const sampleNames = FLOOR_MANAGER_SAMPLE_LEVELS.map((entry) => entry.name).sort();
  const rowNames = (mounted: Mounted): readonly string[] =>
    mounted.result.current.rows.map((row) => row.name).sort();

  it('kho đang giữ dự án KHÁC: màn hiện tầng của dự án này và nạp chúng vào kho', async () => {
    if (ROOF === undefined) {
      throw new Error('Bộ mẫu không có tầng nào.');
    }

    const other = createFloorManagerSampleGraph({
      levels: [{ ...ROOF, id: 'L-OTHERPROJ0000' as LevelId, name: 'A tầng 1' }],
    });
    useStore.getState().setSpatial(other, null, { floorRevisions: {}, projectId: 'P-OTHER' });

    const mounted = await mountSettled();

    await waitFor(() => {
      expect(rowNames(mounted)).toEqual(sampleNames);
    });
    expect(useStore.getState().spatialProjectId).toBe(PROJECT_ID);
  });

  it('lượt đọc đầu của lần gắn là lượt đọc mới; lượt đọc lại sau đó giữ kho', async () => {
    const base = createMockFloorManagerGateway();
    const mountReads: boolean[] = [];
    const gateway: FloorManagerGateway = {
      ...base,
      readFloorList: (input) => {
        mountReads.push(input.isMountRead === true);

        return base.readFloorList(input);
      },
    };
    const mounted = await mountSettled({ gateway });

    await act(async () => {
      await mounted.queryClient.invalidateQueries();
    });

    expect(mountReads).toEqual([true, false]);
  });

  // R1-04: back on the screen, the cached snapshot makes it interactive at once while the mount
  // read is still in flight. An edit made then must survive that read, with its undo history.
  it('sửa trong lúc lượt đọc lúc gắn còn bay: bản đọc về sau không đè sửa, không xoá hoàn tác (R1-04)', async () => {
    const first = FLOOR_MANAGER_SAMPLE_LEVELS[0];

    if (first === undefined) {
      throw new Error('Bộ mẫu không có tầng nào.');
    }

    const warm = await mountSettled();

    warm.unmount();

    const base = createMockFloorManagerGateway();
    const serverGraph = createFloorManagerSampleGraph();
    let releaseRead: (() => void) | null = null;
    const gateway: FloorManagerGateway = {
      ...base,
      readFloorList: async (input) => {
        if (input.isMountRead !== true) {
          return base.readFloorList(input);
        }

        const floors = (await base.readFloorList(input)).floors;

        await new Promise<void>((resolve) => {
          releaseRead = resolve;
        });

        return { floorRevisions: {}, floors, fromStore: false, graph: serverGraph };
      },
    };
    const mounted = await mountSettled({ gateway, queryClient: warm.queryClient });

    await waitFor(() => {
      expect(releaseRead).not.toBeNull();
    });
    // A write's invalidation cancels and re-runs the read; an edit whose invalidation does not
    // reach `floor.manager` (or a failed write) leaves the stale read in flight — that is the case here.
    vi.spyOn(mounted.queryClient, 'invalidateQueries').mockResolvedValue(undefined);
    await commitField(mounted, String(first.id), 'name', 'Tầng sửa giữa lượt đọc');

    const edited = storeGraph();
    const pastAfterEdit = useStore.temporal.getState().pastStates.length;

    expect(pastAfterEdit).toBeGreaterThan(0);

    await act(async () => {
      releaseRead?.();
      await Promise.resolve();
    });
    await waitFor(() => {
      expect(mounted.queryClient.isFetching()).toBe(0);
    });

    expect(storeGraph()).toBe(edited);
    expect(rowOf(mounted, String(first.id)).name).toBe('Tầng sửa giữa lượt đọc');
    expect(useStore.temporal.getState().pastStates.length).toBe(pastAfterEdit);
  });

  it('rời màn rồi quay lại (cùng bộ đệm): đọc lại và hiện tầng thêm ở nơi khác', async () => {
    if (ROOF === undefined) {
      throw new Error('Bộ mẫu không có tầng nào.');
    }

    let serverGraph = createFloorManagerSampleGraph();
    const base = createMockFloorManagerGateway();
    const gateway: FloorManagerGateway = {
      ...base,
      readFloorList: async (input) =>
        input.isMountRead === true
          ? { ...(await base.readFloorList(input)), fromStore: false, graph: serverGraph }
          : base.readFloorList(input),
    };
    const first = await mountSettled({ gateway });

    first.unmount();
    serverGraph = createFloorManagerSampleGraph({
      levels: [
        ...FLOOR_MANAGER_SAMPLE_LEVELS,
        {
          ...ROOF,
          id: 'L-EXTERNAL00000' as LevelId,
          name: 'Tầng thêm ngoài',
          elevationMm: ROOF.elevationMm + ROOF.heightMm,
        },
      ],
    });

    const second = await mountSettled({ gateway, queryClient: first.queryClient });

    await waitFor(() => {
      expect(rowNames(second)).toContain('Tầng thêm ngoài');
    });
  });

  // QA-03f [09-B-034]: a rolled-back reorder leaves the store on a graph deep-equal to an older
  // one; React Query's structural sharing then swapped the mount read's `baseGraph` for that older
  // reference, so the R1-04 guard took the fresh read for an in-flight edit and dropped it.
  it('sắp xếp hỏng rồi lùi, rời màn và quay lại: vẫn hiện tầng thêm ở nơi khác', async () => {
    if (ROOF === undefined) {
      throw new Error('Bộ mẫu không có tầng nào.');
    }

    let serverGraph = createFloorManagerSampleGraph();
    const { gateway: base, reorder } = spiedGateway();

    reorder.mockImplementation(() => wireFailure(422, 'FLOOR_REORDER_MISMATCH'));

    const gateway: FloorManagerGateway = {
      ...base,
      readFloorList: async (input) =>
        input.isMountRead === true
          ? { ...(await base.readFloorList(input)), fromStore: false, graph: serverGraph }
          : base.readFloorList(input),
    };
    const first = await mountSettled({ gateway });

    // An earlier saved edit: its re-read caches a snapshot whose `baseGraph` is the store of then.
    await commitField(first, ROOF_ID, 'name', 'Tầng mái sửa');
    await waitFor(() => {
      expect(first.queryClient.isFetching()).toBe(0);
    });
    await act(async () => {
      first.result.current.onReorderFloors([BASEMENT_ID, SECOND_ID, GROUND_ID, ROOF_ID]);
      await Promise.resolve();
    });
    await waitFor(() => {
      expect(reorder).toHaveBeenCalledTimes(1);
      expect(levelIds()).toEqual(SAMPLE_ORDER);
    });
    await waitFor(() => {
      expect(first.queryClient.isFetching()).toBe(0);
    });

    first.unmount();
    serverGraph = createFloorManagerSampleGraph({
      levels: [
        ...FLOOR_MANAGER_SAMPLE_LEVELS,
        {
          ...ROOF,
          id: 'L-EXTERNAL00000' as LevelId,
          name: 'Tầng thêm ngoài',
          elevationMm: ROOF.elevationMm + ROOF.heightMm,
        },
      ],
    });

    const second = await mountSettled({ gateway, queryClient: first.queryClient });

    await waitFor(() => {
      expect(rowNames(second)).toContain('Tầng thêm ngoài');
    });
  });
});

describe('G3-20: tên tầng nằm sai chỗ sau khi đổi thứ tự', () => {
  it('nói ra khi tầng mái không trên cùng hay tầng trệt nằm trên tầng thường', () => {
    expect(misplacedFloorNameWarning(['Tầng trệt', 'Tầng 1', 'Tầng mái'])).toBeNull();
    expect(misplacedFloorNameWarning(['Tầng hầm', 'Tầng trệt', 'Tầng mái'])).toBeNull();
    expect(misplacedFloorNameWarning(['Tầng mái', 'Tầng trệt'])).toContain('Tầng mái');
    expect(misplacedFloorNameWarning(['Tầng 1', 'Tầng trệt'])).toContain('Tầng trệt');
  });
});

/* -------------------------------------------------------------------------- */
/* FE3D-FIX-003 W4b: cờ ẩn 3D là của máy chủ.                                  */
/* -------------------------------------------------------------------------- */

describe('W4b — ẩn khỏi 3D đọc từ máy chủ, lùi khi lưu hỏng', () => {
  const roofId = String(FLOOR_MANAGER_SAMPLE_ROOF_ID);

  it('lượt đọc danh sách tầng đặt sẵn cờ ẩn (hiddenIn3d) của tầng', async () => {
    const floors = createFloorManagerSampleFloors().map((floor) =>
      floor.id === roofId ? { ...floor, hiddenIn3d: true } : floor,
    );
    const mounted = await mountSettled({ gateway: createMockFloorManagerGateway({ floors }) });

    await waitFor(() => {
      expect(rowOf(mounted, roofId).isHiddenIn3d).toBe(true);
    });
    expect(rowOf(mounted, String(FLOOR_MANAGER_SAMPLE_GROUND_ID)).isHiddenIn3d).toBe(false);
  });

  it('cổng lưu được nhưng PATCH hỏng → trả lại lựa chọn cũ và nói câu lưu hỏng', async () => {
    const mock = createMockFloorManagerGateway();
    const gateway: FloorManagerGateway = {
      ...mock,
      supports: { ...mock.supports, hideFloorFrom3d: true },
      persistHiddenIn3d: () => Promise.resolve(failedFloorCapability('hideFloorFrom3d', 'test')),
    };
    const mounted = await mountSettled({ gateway });

    await act(async () => {
      mounted.result.current.onToggleHiddenIn3d(roofId);
      await Promise.resolve();
    });

    await waitFor(() => {
      expect(mounted.spoken).toContain(FLOOR_MANAGER_SAVE_FAILED_NOTICES.hideFloorFrom3d);
    });
    expect(rowOf(mounted, roofId).isHiddenIn3d).toBe(false);
    expect(mounted.result.current.unsupportedNotices).toEqual([]);
  });
});

/* -------------------------------------------------------------------------- */
/* R10 làn S: nhãn tỷ lệ của dòng tầng.                                        */
/* -------------------------------------------------------------------------- */

describe('floorRowScaleStateOf', () => {
  const graph = createFloorManagerSampleGraph();
  const sampleLevel = levelsOf(graph).find(
    (candidate) => String(candidate.id) === String(FLOOR_MANAGER_SAMPLE_GROUND_ID),
  );
  /* Tầng mẫu chưa có tỷ lệ; gắn một tỷ lệ có thật vào để phép kiểm nói về TRẠNG THÁI, không về "chưa có số". */
  const level =
    sampleLevel === undefined ? undefined : { ...sampleLevel, scaleMillimetresPerPixel: millimetresPerPixel(10) };

  it('kho chưa biết gì về tỷ lệ tầng thì để yên là đã xác nhận', () => {
    expect(sampleLevel).toBeDefined();
    if (level === undefined) return;

    expect(floorRowScaleStateOf(graph, level, undefined)).toBe('confirmed');
    expect(floorRowScaleStateOf(graph, level, { revision: 2 })).toBe('confirmed');
  });

  it('tầng máy chủ nói là ước lượng thì mang nhãn ước lượng', () => {
    if (level === undefined) return;

    expect(floorRowScaleStateOf(graph, level, { revision: 2, scaleStatus: 'unresolved', scaleState: 'estimated' })).toBe(
      'estimated',
    );
  });

  it('R10: tầng đã chấp nhận số máy (hết scaleStatus) KHÔNG được gắn nhãn xanh "đã xác nhận"', () => {
    if (level === undefined) return;

    // Luật cũ `scaleStatus === 'unresolved' ? ... : 'confirmed'` trả 'confirmed' ở đây.
    expect(floorRowScaleStateOf(graph, level, { revision: 2, scaleState: 'estimated', scaleReasons: ['door', 'userAccepted'] })).toBe(
      'estimated',
    );
  });

  it('tầng người dùng tự hiệu chỉnh bằng kích thước thật thì mới là đã xác nhận', () => {
    if (level === undefined) return;

    expect(floorRowScaleStateOf(graph, level, { revision: 2, scaleState: 'userCalibrated', scaleReasons: ['human'] })).toBe(
      'confirmed',
    );
  });
});
