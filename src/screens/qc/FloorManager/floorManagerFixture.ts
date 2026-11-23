/**
 * Bộ dữ liệu mẫu của `FloorManager` — bốn tầng, cộng bảy kịch bản dẫn xuất từ nó.
 *
 * KHÔNG gọi mạng, KHÔNG `Math.*`/số ngẫu nhiên (R-61: dữ liệu mẫu phải tất định).
 * Giá trị lấy nguyên từ `notes/floor-manager/blueprint.md` mục D — cao độ
 * -3,0 / 0,0 / 3,9 / 7,5 m, chiều cao 3,0 / 3,9 / 3,6 / 3,6 m, tổng 14,1 m,
 * diện tích mỗi tầng có bản vẽ = 248,60 m² (bộ riêng của màn).
 *
 * `floorManagerScenarioFor(state)` và `FLOOR_MANAGER_SCENARIOS` là bộ MỘT
 * dùng chung cho cả `FloorManager.stories.tsx` (T6) và `FloorManager.test.tsx`
 * (T7) — không hai bảng dữ liệu lệch nhau (R-70). Không có file
 * `floorManagerScenarios.ts` riêng theo đúng bảng phân việc F của bản thiết kế.
 */

import { millimetres, squareMetres, type Millimetres, type SquareMetres } from '@/domain/units/types';
import { describeError, toAppError } from '@/lib/errors';
import { formatArea, formatLength } from '@/lib/format/measure';
import { formatNumber, formatPercent, MISSING_VALUE } from '@/lib/format/number';
import { SEVEN_STATES, type SevenState } from '@/lib/testing/sevenStateScenarios';

import {
  FLOOR_MANAGER_MISSING_CAPABILITIES,
  FLOOR_MANAGER_UNSUPPORTED_NOTICES,
} from './floorManagerGateway';
import type {
  ElevationTickVm,
  FloorManagerScreenState,
  FloorManagerViewProps,
  FloorRowVm,
  FloorTableFooterVm,
  SectionBandVm,
} from './floorManagerTypes';
import { QC_NOT_GRADED } from './floorManagerTypes';

/**
 * Mọi thứ view thuần nhận TRỪ mười lăm hàm xử lý.
 *
 * Cùng khuôn `AxisGridViewModel` của `axisGridManagerScenarios.ts`: dữ liệu
 * sống ở đây, mười lăm hàm `on...` sống ở `IDLE_HANDLERS` trong
 * `FloorManager.stories.tsx` (nơi duy nhất cần một hàm không làm gì).
 */
export type FloorManagerScenarioVm = Omit<
  FloorManagerViewProps,
  | 'onSelectFloor'
  | 'onHoverFloor'
  | 'onFloorFieldChange'
  | 'onFloorFieldCommit'
  | 'onFloorFieldCancel'
  | 'onReorderFloors'
  | 'onAddFloor'
  | 'onDuplicateFloor'
  | 'onToggleHiddenIn3d'
  | 'onRemoveFloor'
  | 'onToggleAutoElevation'
  | 'onUploadDrawing'
  | 'onToggleCollapsed'
  | 'onRetry'
  | 'onUndo'
>;

/* -------------------------------------------------------------------------- */
/* Bốn tầng của bộ mẫu — nguyên vẹn, đúng mục D của bản thiết kế.              */
/* -------------------------------------------------------------------------- */

const STANDARD_SAMPLE_AREA_M2: SquareMetres = squareMetres(248.6);

interface FloorSeed {
  readonly id: string;
  readonly name: string;
  readonly elevationMm: Millimetres;
  readonly heightMm: Millimetres;
  readonly drawingCount: number;
  readonly wallCount: number | null;
  readonly roomCount: number | null;
  readonly areaM2: SquareMetres | null;
  readonly qcProgressRatio: number;
}

const BASEMENT_SEED: FloorSeed = {
  id: 'floor-basement',
  name: 'Tầng hầm',
  elevationMm: millimetres(-3000),
  heightMm: millimetres(3000),
  drawingCount: 2,
  wallCount: 58,
  roomCount: 34,
  areaM2: STANDARD_SAMPLE_AREA_M2,
  qcProgressRatio: 1,
};

const GROUND_SEED: FloorSeed = {
  id: 'floor-ground',
  name: 'Tầng trệt',
  elevationMm: millimetres(0),
  heightMm: millimetres(3900),
  drawingCount: 2,
  wallCount: 72,
  roomCount: 34,
  areaM2: STANDARD_SAMPLE_AREA_M2,
  qcProgressRatio: 1,
};

const FLOOR_2_SEED: FloorSeed = {
  id: 'floor-2',
  name: 'Tầng 2',
  elevationMm: millimetres(3900),
  heightMm: millimetres(3600),
  drawingCount: 1,
  wallCount: 72,
  roomCount: 34,
  areaM2: STANDARD_SAMPLE_AREA_M2,
  qcProgressRatio: 0.45,
};

/** Tầng mái ở trạng thái Một phần — chưa có bản vẽ (chỗ trạng thái đó sống). */
const ROOF_SEED_PARTIAL: FloorSeed = {
  id: 'floor-roof',
  name: 'Tầng mái',
  elevationMm: millimetres(7500),
  heightMm: millimetres(3600),
  drawingCount: 0,
  wallCount: null,
  roomCount: null,
  areaM2: null,
  qcProgressRatio: 0,
};

/**
 * Tầng mái ở trạng thái Xong — bản vẽ đã có, dùng đúng bộ riêng của màn như ba
 * tầng kia (T6 dựng cho story `success`; không tự bịa endpoint, chỉ tái dùng
 * đúng con số 248,60 m² / 72 tường / 34 phòng đã ghi trong bảng D).
 */
const ROOF_SEED_SUCCESS: FloorSeed = {
  ...ROOF_SEED_PARTIAL,
  drawingCount: 1,
  wallCount: 72,
  roomCount: 34,
  areaM2: STANDARD_SAMPLE_AREA_M2,
  qcProgressRatio: 1,
};

const FLOOR_SEEDS_PARTIAL: readonly FloorSeed[] = [BASEMENT_SEED, GROUND_SEED, FLOOR_2_SEED, ROOF_SEED_PARTIAL];
const FLOOR_SEEDS_SUCCESS: readonly FloorSeed[] = [BASEMENT_SEED, GROUND_SEED, FLOOR_2_SEED, ROOF_SEED_SUCCESS];

/** Tổng chiều cao ngăn xếp — 3000 + 3900 + 3600 + 3600 = 14100 mm = 14,1 m. */
const TOTAL_STACK_HEIGHT_MM: Millimetres = millimetres(14100);
const BOTTOM_ELEVATION_MM: Millimetres = millimetres(-3000);

function buildRow(seed: FloorSeed): FloorRowVm {
  const hasDrawing = seed.drawingCount > 0;
  const elevationText = formatLength(seed.elevationMm, { unit: 'm', fractionDigits: 1 });
  const heightText = formatLength(seed.heightMm, { unit: 'm', fractionDigits: 1 });

  return {
    id: seed.id,
    name: seed.name,
    elevationText,
    elevationMm: seed.elevationMm,
    isElevationOverridden: false,
    heightText,
    heightMm: seed.heightMm,
    drawingCountText: hasDrawing ? `${seed.drawingCount} bản vẽ` : 'Chưa có bản vẽ',
    drawingCount: seed.drawingCount,
    hasDrawing,
    wallCountText: seed.wallCount === null ? MISSING_VALUE : formatNumber(seed.wallCount),
    roomCountText: seed.roomCount === null ? MISSING_VALUE : formatNumber(seed.roomCount),
    areaText: formatArea(seed.areaM2),
    areaM2: seed.areaM2,
    qcProgressText: !hasDrawing ? MISSING_VALUE : seed.qcProgressRatio === 0 ? QC_NOT_GRADED : formatPercent(seed.qcProgressRatio, { fractionDigits: 0 }),
    qcProgressRatio: seed.qcProgressRatio,
    isSelected: false,
    isHovered: false,
    needsDrawing: !hasDrawing,
    isScaleMissing: false,
    scaleState: 'confirmed',
    isHiddenIn3d: false,
    isSection: false,
    isElevationRefused: false,
    draft: {
      name: seed.name,
      elevation: elevationText.replace(' m', ''),
      height: heightText.replace(' m', ''),
    },
    editingField: null,
  };
}

function buildBands(rows: readonly FloorRowVm[]): readonly SectionBandVm[] {
  return rows.map((row) => ({
    levelId: row.id,
    label: `${row.name} · ${row.heightText}`,
    bandHeightRatio: row.heightMm / TOTAL_STACK_HEIGHT_MM,
    gapBelowRatio: 0,
    isSelected: row.isSelected,
    isHovered: row.isHovered,
    isHiddenIn3d: row.isHiddenIn3d,
    needsDrawing: row.needsDrawing,
  }));
}

function buildElevationTicks(rows: readonly FloorRowVm[]): readonly ElevationTickVm[] {
  const topElevationMm = millimetres(BOTTOM_ELEVATION_MM + TOTAL_STACK_HEIGHT_MM);
  const elevations = [...rows.map((row) => row.elevationMm), topElevationMm];

  return elevations.map((elevationMm) => {
    const offsetRatio = (elevationMm - BOTTOM_ELEVATION_MM) / TOTAL_STACK_HEIGHT_MM;

    return {
      id: `tick-${elevationMm}`,
      labelText: formatLength(elevationMm, { unit: 'm', fractionDigits: 1 }),
      offsetRatio,
      offsetCssPercent: `${offsetRatio * 100}%`,
    };
  });
}

function buildFooter(rows: readonly FloorRowVm[]): FloorTableFooterVm {
  const countedAreas = rows.map((row) => row.areaM2).filter((area): area is SquareMetres => area !== null);
  const countedWalls = rows.map((row) => row.wallCountText).filter((text) => text !== MISSING_VALUE);
  const countedRooms = rows.map((row) => row.roomCountText).filter((text) => text !== MISSING_VALUE);

  const totalAreaM2: SquareMetres = squareMetres(countedAreas.reduce((sum, area) => sum + area, 0));
  const totalWalls = rows.reduce((sum, row) => sum + (row.wallCountText === MISSING_VALUE ? 0 : Number(row.wallCountText)), 0);
  const totalRooms = rows.reduce((sum, row) => sum + (row.roomCountText === MISSING_VALUE ? 0 : Number(row.roomCountText)), 0);

  return {
    floorCountText: `${rows.length} tầng`,
    totalHeightText: formatLength(TOTAL_STACK_HEIGHT_MM, { unit: 'm', fractionDigits: 1 }),
    totalAreaText: countedAreas.length === 0 ? MISSING_VALUE : formatArea(totalAreaM2),
    totalWallCountText: countedWalls.length === 0 ? MISSING_VALUE : formatNumber(totalWalls),
    totalRoomCountText: countedRooms.length === 0 ? MISSING_VALUE : formatNumber(totalRooms),
  };
}

/** Bốn dòng của bộ mẫu, ở trạng thái Một phần (tầng mái chưa có bản vẽ). */
export const FLOOR_MANAGER_FIXTURE_ROWS: readonly FloorRowVm[] = FLOOR_SEEDS_PARTIAL.map(buildRow);
export const FLOOR_MANAGER_FIXTURE_BANDS: readonly SectionBandVm[] = buildBands(FLOOR_MANAGER_FIXTURE_ROWS);
export const FLOOR_MANAGER_FIXTURE_ELEVATION_TICKS: readonly ElevationTickVm[] =
  buildElevationTicks(FLOOR_MANAGER_FIXTURE_ROWS);
export const FLOOR_MANAGER_FIXTURE_FOOTER: FloorTableFooterVm = buildFooter(FLOOR_MANAGER_FIXTURE_ROWS);
export const FLOOR_MANAGER_FIXTURE_TOTAL_HEIGHT_TEXT = formatLength(TOTAL_STACK_HEIGHT_MM, {
  unit: 'm',
  fractionDigits: 1,
});

/* -------------------------------------------------------------------------- */
/* Chuỗi tĩnh — nguyên văn mục C của bản thiết kế, không gõ câu mới (A6).      */
/* -------------------------------------------------------------------------- */

const EMPTY_NOTICE = 'Thêm tầng đầu tiên, hoặc nhập số tầng từ màn hình tạo dự án.';
const FORBIDDEN_NOTICE = 'Vai của bạn chỉ xem được ngăn xếp tầng; mọi thao tác sửa đã được ẩn.';

const ERROR_MESSAGE = describeError(toAppError(new Error('network: không tải được danh sách tầng'))).description;

const EMPTY_ELEVATION_TICKS: readonly ElevationTickVm[] = [
  { id: 'tick-empty', labelText: '0,0 m', offsetRatio: 0, offsetCssPercent: '0%' },
];

const EMPTY_FOOTER: FloorTableFooterVm = {
  floorCountText: '0 tầng',
  totalHeightText: '0,0 m',
  totalAreaText: MISSING_VALUE,
  totalWallCountText: MISSING_VALUE,
  totalRoomCountText: MISSING_VALUE,
};

/* -------------------------------------------------------------------------- */
/* Bảy kịch bản — cùng một bộ cho story và bài kiểm (R-70).                    */
/* -------------------------------------------------------------------------- */

/**
 * Hai câu cổng nói ra cho hai khoản nợ đang khai
 * (`persistFloorContents`, `hideFloorFrom3d`).
 *
 * Đọc THẲNG từ bảng của `floorManagerGateway.ts` — cùng nguồn mà
 * `useFloorManager` đọc, nên story và bài kiểm không gõ lại một câu nào (R-70,
 * R-71). Danh sách này chỉ ngắn đi khi cổng làm được thêm một khoản.
 */
export const FLOOR_MANAGER_FIXTURE_UNSUPPORTED_NOTICES: readonly string[] =
  FLOOR_MANAGER_MISSING_CAPABILITIES.map(
    (capability) => FLOOR_MANAGER_UNSUPPORTED_NOTICES[capability],
  );

const BASE_SCENARIO_FIELDS = {
  isCompact: false,
  duplicateElevationMessage: null,
  duplicateElevationViolation: null,
  /*
   * Bảy kịch bản mặc định KHÔNG mang khoản nợ nào: chúng đo bảy trạng thái của
   * A11, và hai chuyện đó độc lập nhau. Story và bài kiểm nào cần thấy câu nợ
   * thì ghi đè bằng {@link FLOOR_MANAGER_FIXTURE_UNSUPPORTED_NOTICES}.
   */
  unsupportedNotices: [],
} as const;

function scenarioFromRows(
  state: FloorManagerScreenState,
  rows: readonly FloorRowVm[],
  overrides: Partial<FloorManagerScenarioVm> = {},
): FloorManagerScenarioVm {
  return {
    ...BASE_SCENARIO_FIELDS,
    state,
    rows,
    bands: buildBands(rows),
    elevationTicks: buildElevationTicks(rows),
    totalHeightText: FLOOR_MANAGER_FIXTURE_TOTAL_HEIGHT_TEXT,
    footer: buildFooter(rows),
    canEdit: true,
    isCollapsed: false,
    isAutoElevation: true,
    emptyNotice: null,
    errorMessage: null,
    forbiddenNotice: null,
    ...overrides,
  };
}

/** Bảy view-model, ĐÚNG THỨ TỰ `SEVEN_STATES`. */
export function floorManagerScenarioFor(state: SevenState): FloorManagerScenarioVm {
  switch (state) {
    case 'empty':
      return {
        ...BASE_SCENARIO_FIELDS,
        state: 'empty',
        rows: [],
        bands: [],
        elevationTicks: EMPTY_ELEVATION_TICKS,
        totalHeightText: '0,0 m',
        footer: EMPTY_FOOTER,
        canEdit: true,
        isCollapsed: false,
        isAutoElevation: true,
        emptyNotice: EMPTY_NOTICE,
        errorMessage: null,
        forbiddenNotice: null,
      };

    case 'loading':
      return {
        ...BASE_SCENARIO_FIELDS,
        state: 'loading',
        rows: [],
        bands: [],
        elevationTicks: [],
        totalHeightText: MISSING_VALUE,
        footer: EMPTY_FOOTER,
        canEdit: true,
        isCollapsed: false,
        isAutoElevation: true,
        emptyNotice: null,
        errorMessage: null,
        forbiddenNotice: null,
      };

    case 'partial':
      return scenarioFromRows('partial', FLOOR_MANAGER_FIXTURE_ROWS);

    case 'error':
      return {
        ...BASE_SCENARIO_FIELDS,
        state: 'error',
        rows: [],
        bands: [],
        elevationTicks: EMPTY_ELEVATION_TICKS,
        totalHeightText: '0,0 m',
        footer: EMPTY_FOOTER,
        canEdit: true,
        isCollapsed: false,
        isAutoElevation: true,
        emptyNotice: null,
        errorMessage: ERROR_MESSAGE,
        forbiddenNotice: null,
      };

    case 'success':
      return scenarioFromRows('success', FLOOR_SEEDS_SUCCESS.map(buildRow));

    case 'forbidden':
      return scenarioFromRows('forbidden', FLOOR_MANAGER_FIXTURE_ROWS, {
        canEdit: false,
        forbiddenNotice: FORBIDDEN_NOTICE,
      });

    case 'collapsed':
      return scenarioFromRows('collapsed', FLOOR_MANAGER_FIXTURE_ROWS, { isCollapsed: true });

    default:
      return scenarioFromRows('partial', FLOOR_MANAGER_FIXTURE_ROWS);
  }
}

/** Bảy kịch bản dựng sẵn, đúng thứ tự `SEVEN_STATES` — dùng chung cho story và bài kiểm. */
export const FLOOR_MANAGER_SCENARIOS: readonly FloorManagerScenarioVm[] =
  SEVEN_STATES.map(floorManagerScenarioFor);
