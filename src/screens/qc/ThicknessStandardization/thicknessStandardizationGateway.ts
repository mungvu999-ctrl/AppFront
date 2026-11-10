/**
 * Cổng dữ liệu và tầng lệnh của màn S-18 "Chuẩn hoá độ dày tường" — mọi lời
 * gọi ra khỏi màn đi qua đây.
 *
 * Cùng khuôn `wallLayerReviewGateway.ts` và `roomLabelReviewGateway.ts`: một
 * danh sách khả năng, một bản kê nợ endpoint, một `interface` cho hình dạng,
 * một factory dựng cổng thật và một factory dựng cổng có dữ liệu cho bài kiểm
 * và story (R-73). Khuôn được CHÉP LẠI chứ không nhập chéo từ thư mục màn
 * khác (R-68).
 *
 * ## M-05 là nguồn thật duy nhất của việc gán nhóm
 *
 * `standardizeThickness` (`src/lib/geometry/standardize.ts`) quyết định một số
 * đo mm rơi vào nhóm nào. File này KHÔNG khai lại bảng ngưỡng và KHÔNG tự làm
 * tròn: {@link groupOfMeasurement} gọi thẳng M-05 khi ba ngưỡng còn nguyên giá
 * trị mặc định, và khi người dùng đã kéo một ngưỡng thì nó vẫn đọc CHÍNH M-05
 * để biết một số đo nằm ĐÚNG trên ngưỡng thuộc về nhóm nào
 * ({@link THRESHOLD_TAKES_UPPER_GROUP}) thay vì gõ tay lại luật so sánh.
 *
 * ## Đường ghi — `runTransaction` chạy qua `commit`
 *
 * N tường đổi độ dày = N lệnh `wall.changeThickness` đưa vào MỘT lời gọi
 * `runTransaction` = ĐÚNG MỘT bước hoàn tác (`docs/notes/thickness/commands.md`
 * mục 2, đã xác minh trên `runCommandPipeline`). `SpatialPort.applyPatches`
 * cài bằng `commit(patches, label)` nên không dòng nào gọi `set()` (A10).
 * {@link runStandardizeBatch} là chỗ DUY NHẤT của màn gọi `runTransaction`;
 * {@link buildStandardizeThicknessCommands} thuần, không chạy gì cả — đúng
 * CẤM TUYỆT ĐỐI "không áp thay đổi nào trước khi người dùng bấm".
 *
 * ## M-04 không có đường ghi ngược
 *
 * `resolveWallShapes` là hàm THUẦN của `src/domain/walls/joints.ts`; không một
 * `Command` hay `SpatialPatch` nào lưu `Joint` hay `WallShape` vào đồ thị
 * (`commands.md` mục 4). {@link toThicknessWallShapes} vì thế được gọi LẠI mỗi
 * lần cần vẽ, và sau mỗi lượt áp nó chạy lại trên đồ thị mới — đó là cách phần
 * xem trước dựng lại mối nối.
 *
 * ## Đọc và lưu
 *
 * Kho rỗng thì cổng đọc N16 (`readFloorLayerGraph`, B-V6-01), kho có thì giữ.
 * Lưu lớp của tầng qua #35 nằm ở `useFloorLayerAutosave` (một bộ lưu mỗi
 * người–dự án, F-04x-1) — chỉ tầng bẩn được gửi; cổng chỉ lộ `apiClient`. Cờ
 * `supports.persistThicknessStandardization` giữ nghĩa "cổng này có đường lưu".
 */

import type { ApiClient } from '@/api/client';
import type { FloorLayerDocument } from '@/api/schemas/spatialLayer';
import { createAppApiClient } from '@/api/appClient';
import { readFloorLayerRead, type FloorLayerGraphRead } from '@/api/floorLayerGraph';
import { normalizeSpatial, type NormalizedSpatial } from '@/domain/spatial/normalize';
import type { DataSource, Level, LevelId, Point, Wall, WallId } from '@/domain/spatial/types';
import { resolveDrawableWallShapes } from '@/domain/walls/joints';
import { thicknessGroupToken } from './thicknessGroupColor';
import {
  createChangeWallThicknessCommand,
  WALL_COMMAND_TYPES,
} from '@/lib/commands/business/wallCommands';
import {
  entitiesOfKind,
  formatCount,
  toPoint,
  toSolidWall,
  type CommandContext,
} from '@/lib/commands/business/shared';
import {
  createIncrementalRuleRunner,
  type DispatchDeps,
  type DispatchResult,
  type SpatialPort,
} from '@/lib/commands/dispatch';
import {
  createHistoryStack,
  NO_SELECTION,
  type HistoryStack,
  type SelectionSnapshot,
} from '@/lib/commands/history';
import { runTransaction } from '@/lib/commands/transaction';
import type { Command } from '@/lib/commands/types';
import { standardizeThickness } from '@/lib/geometry/standardize';
import { formatLength } from '@/lib/format/measure';
import { describeConfidence } from '@/lib/format/semantic';
import { createUndoTicket, UNDO_WINDOW_MS, type UndoTicket } from '@/lib/mutations/undoTicket';
import type { ViewStatusCode } from '@/lib/viewmodel/types';
import { applyRollbackPatches, commit } from '@/store/commit';
import { useStore } from '@/store';

import { mockFloorLayerDocument } from '../shared/mockFloorLayerDocument';

import {
  THICKNESS_FIXTURE_BUILDING,
  THICKNESS_FIXTURE_LEVELS,
  THICKNESS_FIXTURE_WALLS,
} from './thicknessFixture';
import {
  DEFAULT_THICKNESS_THRESHOLDS,
  HISTOGRAM_BIN_MM,
  THICKNESS_GROUP_DISPLAY_ORDER,
  thicknessGroupLabel,
  type ApplyPreview,
  type HistogramBin,
  type ThicknessGroup,
  type ThicknessGroupRow,
  type ThicknessLegendEntry,
  type ThicknessManualReason,
  type ThicknessSegmentRow,
  type ThicknessSummary,
  type ThicknessThresholds,
  type ThicknessWallShapeViewModel,
} from './thicknessTypes';

/* -------------------------------------------------------------------------- */
/* Khả năng — những gì màn hỏi thế giới bên ngoài.                             */
/* -------------------------------------------------------------------------- */

/** Tên máy đọc của từng việc màn cần. Mỗi việc chưa làm được có một dòng nợ. */
export const THICKNESS_CAPABILITIES = [
  'readThicknessLayer',
  'writeWallThickness',
  'persistThicknessStandardization',
] as const;

export type ThicknessCapability = (typeof THICKNESS_CAPABILITIES)[number];

/** Việc trong danh sách trên mà bản cài đặt THẬT chưa làm được. Chỉ được ngắn đi. */
export const THICKNESS_MISSING_CAPABILITIES = [] as const;

export type ThicknessMissingCapability = (typeof THICKNESS_MISSING_CAPABILITIES)[number];

/** Endpoint còn thiếu của từng khả năng, viết nguyên văn cho người nối dây sau. */
export const THICKNESS_MISSING_ENDPOINTS: Readonly<Record<ThicknessMissingCapability, string>> = {};

/** Một khả năng chưa tồn tại. `supported: false` là câu trả lời thật, không phải lỗi. */
export interface ThicknessUnsupported {
  readonly supported: false;
  readonly capability: ThicknessMissingCapability;
  /** Lấy nguyên từ {@link THICKNESS_MISSING_ENDPOINTS}. */
  readonly missing: string;
}

export interface ThicknessSupported<TValue> {
  readonly supported: true;
  readonly value: TValue;
}

export type ThicknessCapabilityResult<TValue> = ThicknessSupported<TValue> | ThicknessUnsupported;

/** Dựng nhánh "chưa có đường làm việc này" — một chỗ duy nhất ghép tên với nợ. */
export function unsupported(capability: ThicknessMissingCapability): ThicknessUnsupported {
  return {
    supported: false,
    capability,
    missing: THICKNESS_MISSING_ENDPOINTS[capability],
  };
}

/* -------------------------------------------------------------------------- */
/* Cái seam.                                                                   */
/* -------------------------------------------------------------------------- */

/** Cửa đọc đồ thị đang sửa. Mặc định là kho; bài kiểm cắm một đồ thị cố định. */
export interface ThicknessGraphPort {
  readonly read: () => NormalizedSpatial | null;
}

export interface ReadThicknessLayerInput {
  readonly projectId: string;
  readonly floorId: string;
  readonly signal?: AbortSignal;
}

/** Mỗi phương thức là một việc màn cần từ bên ngoài, và không có việc nào khác. */
export interface ThicknessStandardizationGateway {
  /** Khả năng nào cổng này làm được, trả lời ĐỒNG BỘ — màn phải biết trước lượt vẽ đầu. */
  readonly supports: Readonly<Record<ThicknessCapability, boolean>>;
  /** Lớp số đo độ dày của tầng. Lỗi ở đây là trạng thái `error` của A11. */
  readonly readThicknessLayer: (
    input: ReadThicknessLayerInput,
  ) => Promise<FloorLayerGraphRead | null>;
  /** N16 thô của tầng — nguồn của `useFloorLayer` (F-04x-2). Lỗi ở đây là trạng thái `error`. */
  readonly readLayer: (input: ReadThicknessLayerInput) => Promise<FloorLayerDocument>;
  /** Đồ thị đang sửa — nơi `commit` vừa ghi vào. */
  readonly graph: ThicknessGraphPort;
  /** Client của bộ lưu lớp (`useFloorLayerAutosave`). Vắng thì hook dùng client chung. */
  readonly apiClient?: ApiClient;
  /** Ai đang thao tác — đi vào `Command.actorId` và nhật ký hoạt động. */
  readonly actorId: string;
  /** Mốc giờ hiện tại. Tiêm được để bài kiểm không phụ thuộc đồng hồ thật. */
  readonly now: () => number;
}

/**
 * Người thực hiện mặc định khi nơi gọi chưa truyền ai.
 *
 * Một chuỗi ĐẶT TÊN chứ không phải chuỗi rỗng: `validateCommands` từ chối lệnh
 * thiếu `actorId`, nên một mặc định rỗng sẽ làm mọi lệnh hỏng ở bước `validate`
 * thay vì hỏng ở chỗ người nối dây quên truyền.
 */
export const THICKNESS_DEFAULT_ACTOR_ID = 'thickness-standardizer';

export interface CreateThicknessStandardizationGatewayOptions {
  /** Client tiêm được. Vắng mặt thì cổng dùng client chung của repo (`createAppApiClient`). */
  readonly apiClient?: ApiClient;
  /** Cửa đọc đồ thị. Vắng mặt thì cổng đọc thẳng kho. */
  readonly graph?: ThicknessGraphPort;
  readonly actorId?: string;
  readonly now?: () => number;
}

/** Cổng thật — thứ container lớp 3 gọi. */
export function createThicknessStandardizationGateway(
  options: CreateThicknessStandardizationGatewayOptions = {},
): ThicknessStandardizationGateway {
  const apiClient = options.apiClient ?? createAppApiClient();
  const graph: ThicknessGraphPort = options.graph ?? {
    read: () => useStore.getState().spatial,
  };
  return {
    apiClient,
    supports: {
      readThicknessLayer: true,
      writeWallThickness: true,
      persistThicknessStandardization: true,
    },

    readThicknessLayer: async (input) => {
      const stored = graph.read();

      return stored === null ? readFloorLayerRead(apiClient.spatial, input) : { floorRevisions: {}, graph: stored };
    },

    readLayer: async ({ floorId, projectId, signal }) => {
      const result = await apiClient.spatial.readLayer(
        signal === undefined ? { floorId, projectId } : { floorId, projectId, signal },
      );

      if (!result.ok) {
        throw result.error;
      }

      return result.data;
    },

    graph,

    actorId: options.actorId ?? THICKNESS_DEFAULT_ACTOR_ID,
    now: options.now ?? ((): number => Date.now()),
  };
}

/* -------------------------------------------------------------------------- */
/* Bộ mẫu — chỗ story và bài kiểm cắm vào (R-73).                              */
/* -------------------------------------------------------------------------- */

/** Đồ thị của một cảnh, dựng đúng cách kho dựng nó. */
export function thicknessGraphOf(
  walls: readonly Wall[],
  levels: readonly Level[],
): NormalizedSpatial {
  return normalizeSpatial({
    building: THICKNESS_FIXTURE_BUILDING,
    levels: [...levels],
    walls: [...walls],
    openings: [],
    furniture: [],
    rooms: [],
    axes: [],
    dimensions: [],
    notes: [],
  });
}

/** Bộ mẫu đầy đủ — 48 đoạn, ba tầng (xem `thicknessFixture.ts`). */
export const THICKNESS_FIXTURE_GRAPH: NormalizedSpatial = thicknessGraphOf(
  THICKNESS_FIXTURE_WALLS,
  THICKNESS_FIXTURE_LEVELS,
);

/** Cách bài kiểm ép một cảnh cụ thể, không sửa mã. */
export interface ThicknessGatewaySeed {
  /** Đồ thị cổng trả về. Vắng mặt thì cổng trả bộ mẫu đầy đủ. */
  readonly graph?: NormalizedSpatial | null;
  /** `true` thì `readThicknessLayer` ném — đúng cảnh `error` của bảy kịch bản. */
  readonly failReadThicknessLayer?: boolean;
  /** `'unresolved'` thì N16 giả mang tỉ lệ tạm — story "Tỉ lệ tạm" (F-04x-2). */
  readonly scaleStatus?: 'unresolved';
  /** Cờ `supports.persistThicknessStandardization` của bộ mẫu (mặc định `true`). */
  readonly canPersist?: boolean;
  /** Client cho bộ lưu lớp. Vắng thì hook dùng client chung (mock trong test/story). */
  readonly apiClient?: ApiClient;
  readonly actorId?: string;
  readonly now?: () => number;
}

/** Cổng có dữ liệu — dùng chung giữa bài kiểm và story, không bịa bảng dữ liệu thứ hai (R-70). */
export function createMockThicknessStandardizationGateway(
  seed: ThicknessGatewaySeed = {},
): ThicknessStandardizationGateway {
  const canPersist = seed.canPersist ?? true;
  const graphOfSeed = (): NormalizedSpatial | null =>
    seed.graph === undefined ? THICKNESS_FIXTURE_GRAPH : seed.graph;

  return {
    ...(seed.apiClient === undefined ? {} : { apiClient: seed.apiClient }),
    supports: {
      readThicknessLayer: true,
      writeWallThickness: true,
      persistThicknessStandardization: canPersist,
    },

    readThicknessLayer: () => {
      if (seed.failReadThicknessLayer === true) {
        return Promise.reject(new Error('Không tải được lớp số đo độ dày tường của tầng.'));
      }

      const stored = graphOfSeed();

      return Promise.resolve(stored === null ? null : { floorRevisions: {}, graph: stored });
    },

    readLayer: ({ floorId }) => {
      if (seed.failReadThicknessLayer === true) {
        return Promise.reject(new Error('Không tải được lớp số đo độ dày tường của tầng.'));
      }

      return mockFloorLayerDocument(graphOfSeed(), floorId, seed.scaleStatus);
    },

    graph: { read: graphOfSeed },

    actorId: seed.actorId ?? THICKNESS_DEFAULT_ACTOR_ID,
    now: seed.now ?? ((): number => Date.now()),
  };
}

/* -------------------------------------------------------------------------- */
/* Đọc đồ thị.                                                                 */
/* -------------------------------------------------------------------------- */

const NO_WALLS: readonly Wall[] = [];
const NO_LEVELS: readonly Level[] = [];

/** Mọi tường của đồ thị, theo đúng thứ tự đồ thị giữ chúng. */
export function wallsOfGraph(graph: NormalizedSpatial | null): readonly Wall[] {
  return graph === null ? NO_WALLS : entitiesOfKind(graph, 'wall');
}

/** Mọi tầng của đồ thị — màn chuẩn hoá đọc cả công trình, không riêng một tầng. */
export function levelsOfGraph(graph: NormalizedSpatial | null): readonly Level[] {
  return graph === null ? NO_LEVELS : entitiesOfKind(graph, 'level');
}

/** Tra tầng theo mã, cho cột "tầng" của bảng chi tiết. */
export function levelIndexOf(levels: readonly Level[]): ReadonlyMap<LevelId, Level> {
  return new Map(levels.map((level) => [level.id, level]));
}

/* -------------------------------------------------------------------------- */
/* Gán nhóm — M-05 quyết, kể cả khi ba ngưỡng đã bị kéo.                        */
/* -------------------------------------------------------------------------- */

/**
 * Ba ngưỡng có "ăn" về nhóm TRÊN hay không, đọc THẲNG từ M-05.
 *
 * `standardizeThickness(165).standardized === 220` và `(275) === 330` (số đo
 * nằm đúng trên ngưỡng thuộc nhóm trên), còn `(350) === 330` (nằm đúng trên
 * ngưỡng thứ ba thì vẫn thuộc nhóm dưới). Bảng này KHÔNG gõ tay luật so sánh
 * đó: nó hỏi chính M-05 cho từng giá trị ngưỡng mặc định, nên khi M-05 đổi
 * biên thì bảng đổi theo.
 */
const THRESHOLD_TAKES_UPPER_GROUP: readonly boolean[] = DEFAULT_THICKNESS_THRESHOLDS.map(
  (thresholdMm, index) =>
    standardizeThickness(thresholdMm).standardized === THICKNESS_GROUP_DISPLAY_ORDER[index + 1],
);

/** Ba ngưỡng còn nguyên giá trị mặc định của M-05 hay không. */
export function isDefaultThresholds(thresholds: ThicknessThresholds): boolean {
  return thresholds.every(
    (thresholdMm, index) => thresholdMm === DEFAULT_THICKNESS_THRESHOLDS[index],
  );
}

/** Ba ngưỡng sắp lại tăng dần sau một lượt kéo — thuần, không ghi gì. */
export function sortThresholds(thresholds: readonly number[]): ThicknessThresholds {
  const sorted = [...thresholds].sort((first, second) => first - second);

  return DEFAULT_THICKNESS_THRESHOLDS.map((fallback, index) => sorted[index] ?? fallback);
}

/**
 * Ba ngưỡng với ngưỡng thứ `index` nhận giá trị mới, KẸP giữa hai ngưỡng kề (cách một bậc cột).
 *
 * Kéo qua ngưỡng bên cạnh từng sắp lại cả bộ, nên thanh đang kéo "đẩy" thanh kia đi và đổi nhãn
 * giữa chừng (BUG-606). Kẹp thì thứ tự không bao giờ đảo, và hai đầu ngoài không có giới hạn ở đây
 * — trục của biểu đồ giữ chúng.
 */
export function withThresholdAt(
  thresholds: ThicknessThresholds,
  index: number,
  thresholdMm: number,
): ThicknessThresholds {
  const low = (thresholds[index - 1] ?? Number.NEGATIVE_INFINITY) + HISTOGRAM_BIN_MM;
  const high = (thresholds[index + 1] ?? Number.POSITIVE_INFINITY) - HISTOGRAM_BIN_MM;
  const clamped = Math.min(Math.max(thresholdMm, low), high);

  return sortThresholds(
    thresholds.map((current, position) => (position === index ? clamped : current)),
  );
}

/**
 * Nhóm chuẩn của một số đo, dưới ba ngưỡng đang đặt.
 *
 * Ngưỡng còn mặc định thì đây ĐÚNG là `standardizeThickness` — không một phép
 * làm tròn nào của riêng màn. Ngưỡng đã bị kéo thì luật biên vẫn là luật của
 * M-05 ({@link THRESHOLD_TAKES_UPPER_GROUP}), chỉ ba con số so sánh là của
 * người dùng; danh sách nhóm thì lấy từ `THICKNESS_GROUP_DISPLAY_ORDER` chứ
 * không khai lại (R-61).
 */
export function groupOfMeasurement(
  measuredMm: number,
  thresholds: ThicknessThresholds,
  source: DataSource = 'human',
): ThicknessGroup {
  if (isDefaultThresholds(thresholds)) {
    /* Tường máy đo dư một nét vẽ: luật bù nét của M-05 (U19, 261 → 220 chứ không 300). */
    return standardizeThickness(measuredMm, source).standardized;
  }

  let position = 0;

  thresholds.forEach((thresholdMm, index) => {
    const reached =
      THRESHOLD_TAKES_UPPER_GROUP[index] === true
        ? measuredMm >= thresholdMm
        : measuredMm > thresholdMm;

    if (reached) {
      position = index + 1;
    }
  });

  return THICKNESS_GROUP_DISPLAY_ORDER[position] ?? CONCRETE_COLUMN_FALLBACK;
}

/**
 * Nhóm cuối cùng của bảng hiển thị, dùng khi chỉ số vượt khỏi mảng.
 *
 * Không phải một nhóm thứ năm bịa thêm: nó đọc lại phần tử cuối của
 * `THICKNESS_GROUP_DISPLAY_ORDER`, nên bảng nhóm vẫn là nguồn duy nhất.
 */
const CONCRETE_COLUMN_FALLBACK: ThicknessGroup =
  THICKNESS_GROUP_DISPLAY_ORDER[THICKNESS_GROUP_DISPLAY_ORDER.length - 1] ?? 'CONCRETE_COLUMN';

/**
 * Giá trị mm chuẩn của một nhóm, hoặc `null` với cột bê tông cốt thép.
 *
 * `ThicknessGroup` là bí danh của `WallThickness`, nên ba nhóm số MANG luôn giá
 * trị chuẩn của chúng — không có bảng tra nào phải giữ đồng bộ (X1).
 */
export function standardValueOf(group: ThicknessGroup): number | null {
  return typeof group === 'number' ? group : null;
}

/**
 * Sai lệch giữa số đo và giá trị chuẩn của nhóm, luôn dương.
 *
 * `0` với cột bê tông cốt thép: nhóm đó không có giá trị số để so, nên không có
 * "lệch bao nhiêu" để nói (X2, xem ghi chú đầu `thicknessTypes.ts`).
 */
export function deviationOf(measuredMm: number, group: ThicknessGroup): number {
  const standardMm = standardValueOf(group);

  if (standardMm === null) {
    return 0;
  }

  return measuredMm >= standardMm ? measuredMm - standardMm : standardMm - measuredMm;
}

/* -------------------------------------------------------------------------- */
/* Dòng bảng chi tiết.                                                         */
/* -------------------------------------------------------------------------- */

/**
 * Mã trạng thái của một đoạn, đúng bốn mã `ViewStatusCode` (A4).
 *
 * A5: `'verified'` CHỈ đến từ `wall.reviewed` — việc của người duyệt, không
 * một nhánh nào ở đây đặt nó từ đầu ra của AI.
 */
export function statusOfSegment(
  wall: Wall,
  manualReview: ThicknessManualReason | null,
  willChange: boolean,
): ViewStatusCode {
  if (wall.reviewed) {
    return 'verified';
  }

  /* S-21: đoạn phải xem tay (nhóm cột BTCT, trên ngưỡng cuối) là thứ lô không đổi được. */
  if (manualReview !== null) {
    return 'violation';
  }

  return willChange ? 'attention' : 'neutral';
}

/** Đoạn phải xem tay: rơi vào nhóm cột BTCT (trên ngưỡng cuối của thang sáu bậc). */
export function manualReviewOf(group: ThicknessGroup): ThicknessManualReason | null {
  return standardValueOf(group) === null ? 'column' : null;
}

export interface ToSegmentRowOptions {
  readonly thresholds: ThicknessThresholds;
  readonly toleranceMm: number;
  readonly levels: ReadonlyMap<LevelId, Level>;
  /** Nhãn người đọc của mọi tường (`displayCodesOf`, B-V6-09), không có dấu `#`. */
  readonly codes: ReadonlyMap<string, string>;
}

/** Một chữ số thập phân, dấu phẩy — A15, định dạng ở đây chứ không ở view. */
const LENGTH_LABEL_FRACTION_DIGITS = 1;

const lengthLabel = (valueMm: number): string =>
  formatLength(valueMm, { unit: 'mm', fractionDigits: LENGTH_LABEL_FRACTION_DIGITS });

/** Một đoạn tường thành một dòng bảng, không còn phép tính nào cho view. */
export function toSegmentRow(wall: Wall, options: ToSegmentRowOptions): ThicknessSegmentRow {
  const group = groupOfMeasurement(wall.thicknessMm, options.thresholds, wall.source);
  const deviationMm = deviationOf(wall.thicknessMm, group);
  const standardMm = standardValueOf(group);
  const exceedsTolerance = deviationMm > options.toleranceMm;
  const manualReview = manualReviewOf(group);
  /* S-21: trong dung sai là đúng chuẩn, không đổi; ngoài dung sai và không phải xem tay thì đổi. */
  const willChange = standardMm !== null && exceedsTolerance && manualReview === null;

  return {
    wallId: wall.id,
    code: `#${options.codes.get(wall.id) ?? wall.id}`,
    measuredMm: wall.thicknessMm,
    measuredLabel: lengthLabel(wall.thicknessMm),
    normalizedGroup: group,
    deviationMm,
    deviationLabel: lengthLabel(deviationMm),
    exceedsTolerance,
    manualReview,
    confidence: wall.confidence,
    confidenceLabel: describeConfidence(wall.confidence).label,
    floorName: options.levels.get(wall.levelId)?.name ?? '',
    status: statusOfSegment(wall, manualReview, willChange),
    reviewed: wall.reviewed,
  };
}

/** Mọi đoạn của đồ thị thành bảng chi tiết. */
export function toSegmentRows(
  walls: readonly Wall[],
  options: ToSegmentRowOptions,
): readonly ThicknessSegmentRow[] {
  return walls.map((wall) => toSegmentRow(wall, options));
}

/**
 * Dòng nào ÁP ĐƯỢC (luật S-21, chủ dự án duyệt): nhóm có giá trị số, đoạn KHÔNG chuẩn
 * (lệch quá dung sai — trong dung sai đã coi là chuẩn), và không phải đoạn xem tay
 * (nhóm cột BTCT).
 *
 * Đây là định nghĩa dùng chung của bốn con số tóm tắt, bảng xem trước và bước
 * dựng lệnh — một chỗ duy nhất, nên ba nơi không thể lệch nhau.
 */
export function isApplicable(row: ThicknessSegmentRow): boolean {
  const standardMm = standardValueOf(row.normalizedGroup);

  return standardMm !== null && row.exceedsTolerance && row.manualReview == null;
}

/* -------------------------------------------------------------------------- */
/* Bảng nhóm bên trái — một dòng cho mỗi số đo khác nhau.                       */
/* -------------------------------------------------------------------------- */

/**
 * Gom các đoạn theo SỐ ĐO, giữ thứ tự tăng dần.
 *
 * Phép ghép dữ liệu thường (gom danh sách theo khoá), không phải công thức hình
 * học — `docs/notes/thickness/data.md` mục 4 đã ghi NOT FOUND cho một hàm nhóm
 * sẵn trong `src/lib`, và cho phép hook tự gom bằng `Map`.
 *
 * `accepted` đọc từ `acceptedMeasurements`; tập đó khởi tạo RỖNG ở hook, nên
 * không hàng nào tích sẵn (CẤM TUYỆT ĐỐI).
 */
export function toGroupRows(
  rows: readonly ThicknessSegmentRow[],
  acceptedMeasurements: ReadonlySet<number>,
): readonly ThicknessGroupRow[] {
  const byMeasurement = new Map<number, { group: ThicknessGroup; wallIds: WallId[] }>();

  for (const row of rows) {
    const bucket = byMeasurement.get(row.measuredMm);

    if (bucket === undefined) {
      byMeasurement.set(row.measuredMm, {
        group: row.normalizedGroup,
        wallIds: [row.wallId],
      });
      continue;
    }

    bucket.wallIds.push(row.wallId);
  }

  return [...byMeasurement.entries()]
    /* Số đo ĐÃ bằng nhóm chuẩn (220 → 220) không phải một đề xuất: tích vào cũng không đổi gì (BUG-421). */
    .filter(([measuredMm, bucket]) => standardValueOf(bucket.group) !== measuredMm)
    .sort(([first], [second]) => first - second)
    .map(([measuredMm, bucket]) => ({
      measuredMm,
      wallCount: bucket.wallIds.length,
      suggestedGroup: bucket.group,
      accepted: acceptedMeasurements.has(measuredMm),
      wallIds: bucket.wallIds,
    }));
}

/* -------------------------------------------------------------------------- */
/* Biểu đồ — cột TRUNG TÍNH, dải màu là việc của view.                         */
/* -------------------------------------------------------------------------- */

/** Đầu dải chứa một số đo: `HISTOGRAM_BIN_MM` mm một cột, không phép chia nào. */
const binStartOf = (measuredMm: number): number => measuredMm - (measuredMm % HISTOGRAM_BIN_MM);

/**
 * Các cột của biểu đồ, liền mạch từ số đo nhỏ nhất tới số đo lớn nhất.
 *
 * Cột rỗng vẫn có mặt: một biểu đồ tần suất thủng lỗ đọc sai hình dạng phân bố.
 */
export function toHistogramBins(rows: readonly ThicknessSegmentRow[]): readonly HistogramBin[] {
  if (rows.length === 0) {
    return [];
  }

  const wallIdsByStart = new Map<number, WallId[]>();
  let lowest = binStartOf(rows[0]?.measuredMm ?? 0);
  let highest = lowest;

  for (const row of rows) {
    const start = binStartOf(row.measuredMm);
    const bucket = wallIdsByStart.get(start);

    if (bucket === undefined) {
      wallIdsByStart.set(start, [row.wallId]);
    } else {
      bucket.push(row.wallId);
    }

    lowest = start < lowest ? start : lowest;
    highest = start > highest ? start : highest;
  }

  const bins: HistogramBin[] = [];

  for (let start = lowest; start <= highest; start += HISTOGRAM_BIN_MM) {
    const wallIds = wallIdsByStart.get(start) ?? [];

    bins.push({
      startMm: start,
      endMm: start + HISTOGRAM_BIN_MM,
      count: wallIds.length,
      wallIds,
    });
  }

  return bins;
}

/** Nhãn chữ của ba ngưỡng, cùng thứ tự với `ThicknessThresholds` (A15). */
export function thresholdLabelsOf(thresholds: ThicknessThresholds): readonly string[] {
  return thresholds.map((thresholdMm) => formatLength(thresholdMm, { unit: 'mm' }));
}

/* -------------------------------------------------------------------------- */
/* Bốn con số tóm tắt.                                                         */
/* -------------------------------------------------------------------------- */

/** Bốn con số mono-lg đầu màn, đếm từ chính bảng chi tiết. */
export function summaryOf(rows: readonly ThicknessSegmentRow[]): ThicknessSummary {
  let normalizedCount = 0;
  let exceedingToleranceCount = 0;
  let concreteColumnCount = 0;

  for (const row of rows) {
    const standardMm = standardValueOf(row.normalizedGroup);

    if (standardMm === null) {
      concreteColumnCount += 1;
    } else if (!row.exceedsTolerance) {
      /* R-3: "trong dung sai" khớp với ô "Lệch quá dung sai" — trước so `===` nên tường 116 mm (chuẩn 110) không vào ô nào. */
      normalizedCount += 1;
    }

    if (row.exceedsTolerance) {
      exceedingToleranceCount += 1;
    }
  }

  return {
    segmentCount: rows.length,
    normalizedCount,
    exceedingToleranceCount,
    concreteColumnCount,
  };
}

/* -------------------------------------------------------------------------- */
/* Chú giải độ dày — token màu ghép sẵn, view chỉ gán vào style (A1).           */
/* -------------------------------------------------------------------------- */

/** Các nhóm CÓ MẶT trong dữ liệu, với nhãn tiếng Việt và token của `wallStrokeToken`. */
export function thicknessLegend(
  rows: readonly ThicknessSegmentRow[],
): readonly ThicknessLegendEntry[] {
  const present = new Set(rows.map((row) => row.normalizedGroup));

  return THICKNESS_GROUP_DISPLAY_ORDER.filter((group) => present.has(group)).map((group) => ({
    group,
    label: thicknessGroupLabel(group),
    colorToken: thicknessGroupToken(group),
  }));
}

/* -------------------------------------------------------------------------- */
/* Hình tường cho canvas xem trước — GỌI LẠI M-04, không tự tính (R-60).        */
/* -------------------------------------------------------------------------- */

/**
 * Đa giác của mọi tường, qua `resolveWallShapes` — nguồn DUY NHẤT của hình
 * tường để vẽ.
 *
 * Gọi theo TỪNG TẦNG vì góc nối phụ thuộc tường lân cận CÙNG tầng
 * (`commands.md` mục 4), và `toSolidWall` cần cao độ của chính tầng đó.
 * `resolveWallShapes` ném khi một tường không dùng được hoặc hai tường trùng
 * mã; một bản vẽ hỏng không được làm trắng màn (A11), nên lỗi đó thành "tầng
 * này không có hình nào để vẽ" và hai bảng vẫn đọc được.
 */
export function toThicknessWallShapes(
  walls: readonly Wall[],
  levels: readonly Level[],
  groupOf: (wall: Wall) => ThicknessGroup,
): readonly ThicknessWallShapeViewModel[] {
  const shapes: ThicknessWallShapeViewModel[] = [];

  for (const level of levels) {
    const onLevel = walls.filter((wall) => wall.levelId === level.id);

    if (onLevel.length === 0) {
      continue;
    }

    let outlineById: ReadonlyMap<WallId, readonly Point[]>;

    try {
      const resolved = resolveDrawableWallShapes(onLevel.map((wall) => toSolidWall(wall, level)));

      outlineById = new Map(
        resolved.shapes.map((shape) => [shape.wallId, shape.outline.map(toPoint)]),
      );
    } catch {
      continue;
    }

    for (const wall of onLevel) {
      const outline = outlineById.get(wall.id);

      if (outline !== undefined) {
        shapes.push({ wallId: wall.id, outline, group: groupOf(wall) });
      }
    }
  }

  return shapes;
}

/* -------------------------------------------------------------------------- */
/* Bảng xem trước — luôn hiện TRƯỚC khi áp (CẤM TUYỆT ĐỐI).                     */
/* -------------------------------------------------------------------------- */

/**
 * Câu tóm tắt, GHÉP từ số đếm và dung sai đang đặt — cấm chuỗi cứng (X3).
 *
 * Vế thứ hai chỉ có mặt khi thật sự có đoạn bị dung sai chặn lại: nói "0 tường
 * lệch quá 30 mm sẽ không đổi" là một câu đúng nhưng thừa, và câu thừa làm
 * người đọc mất niềm tin vào những câu còn lại.
 */
export function applyPreviewSentence(input: {
  readonly totalWalls: number;
  readonly groupCount: number;
  readonly unchangedCount: number;
  readonly toleranceMm: number;
}): string {
  const head = `${formatCount(input.totalWalls)} tường → ${formatCount(input.groupCount)} nhóm chuẩn.`;

  if (input.unchangedCount === 0) {
    return head;
  }

  return `${head} ${formatCount(input.unchangedCount)} tường cần xem tay sẽ không đổi.`;
}

/**
 * Bảng xem trước của lượt áp sắp tới — THUẦN, không một lượt ghi nào.
 *
 * `rows` là những dòng thuộc các nhóm người dùng đã đồng ý; `unchangedWalls` là
 * những dòng trong số đó bị dung sai chặn lại, kê ĐẦY ĐỦ hàng chứ không phải
 * một con số, vì đặc tả đòi liệt kê rõ tường nào không đổi.
 */
export function buildApplyPreview(
  rows: readonly ThicknessSegmentRow[],
  toleranceMm: number,
): ApplyPreview {
  const unchangedWalls = rows.filter((row) => row.manualReview != null);
  const groupCount = new Set(rows.filter(isApplicable).map((row) => row.normalizedGroup)).size;

  return {
    totalWalls: rows.length,
    groupCount,
    unchangedWalls,
    sentence: applyPreviewSentence({
      totalWalls: rows.length,
      groupCount,
      unchangedCount: unchangedWalls.length,
      toleranceMm,
    }),
  };
}

/* -------------------------------------------------------------------------- */
/* Tầng lệnh — N lệnh đã có, MỘT transaction.                                  */
/* -------------------------------------------------------------------------- */

/** Ngữ cảnh mà hàm dựng lệnh của S-07 đọc. */
export const commandContextOf = (graph: NormalizedSpatial, actorId: string): CommandContext => ({
  graph,
  actorId,
});

/** Câu mô tả của lượt chuẩn hoá — cũng là câu trên toast hoàn tác. */
export const standardizeDescription = (wallCount: number): string =>
  `Chuẩn hoá độ dày ${formatCount(wallCount)} tường.`;

/**
 * Loại thông báo của lượt chuẩn hoá.
 *
 * Đọc từ `WALL_COMMAND_TYPES` chứ không gõ tay một chuỗi thứ hai (R-71): mọi
 * lệnh của lượt này đều là `wall.changeThickness`, và KHÔNG có `CommandType`
 * mới nào được dựng cho lô (`commands.md` mục 7).
 */
export const THICKNESS_NOTIFICATION_TYPE: string = WALL_COMMAND_TYPES.changeThickness;

export interface BuildStandardizeCommandsContext {
  readonly graph: NormalizedSpatial;
  readonly actorId: string;
  /** Số đo của những nhóm người dùng đã đồng ý. Rỗng = không có gì để áp. */
  readonly acceptedMeasurements: ReadonlySet<number>;
  /** Mã tường bị loại khỏi lượt áp — đường "loại tường đã duyệt ra" của cảnh báo. */
  readonly excludedWallIds?: ReadonlySet<WallId>;
}

/**
 * Dựng N lệnh đổi độ dày cho một lượt áp — HÀM THUẦN, không chạy gì cả.
 *
 * Bốn cửa lọc, theo đúng thứ tự: nhóm người dùng chưa đồng ý thì bỏ; tường bị
 * loại ra thì bỏ; dòng không áp được ({@link isApplicable} — cột bê tông cốt
 * thép, đã đúng chuẩn, hoặc lệch quá dung sai) thì bỏ; trùng `wallId` thì chỉ
 * giữ dòng đầu (`commands.md` mục 2 cảnh báo lệnh sau sẽ đè lệnh trước và làm
 * bẩn bước hoàn tác).
 *
 * Lệnh nào `createChangeWallThicknessCommand` từ chối (ngoài khoảng 60–600 mm,
 * hoặc không tìm thấy tường) thì rơi ra ngoài — bốn cửa lọc trên đã loại hết ca
 * "độ dày mới bằng hệt độ dày cũ", nên phần còn lại là những lệnh thật sự đổi.
 */
export function buildStandardizeThicknessCommands(
  rows: readonly ThicknessSegmentRow[],
  context: BuildStandardizeCommandsContext,
): readonly Command[] {
  return toChangeThicknessCommands(
    rows
      .filter(
        (row) =>
          context.acceptedMeasurements.has(row.measuredMm) &&
          context.excludedWallIds?.has(row.wallId) !== true &&
          isApplicable(row),
      )
      .map((row) => ({ wallId: row.wallId, thicknessMm: standardValueOf(row.normalizedGroup) })),
    commandContextOf(context.graph, context.actorId),
  );
}

/**
 * Dựng lệnh gán MỘT nhóm cho các đoạn đang chọn — cũng HÀM THUẦN.
 *
 * Đây là đường thứ hai tới cùng một lô lệnh: người duyệt chọn vài hàng trong
 * bảng chi tiết rồi gán thẳng một nhóm, thay vì đồng ý cả một nhóm số đo. Cột
 * bê tông cốt thép không có giá trị mm nên trả mảng RỖNG — X2 nói rõ nhóm đó
 * đếm được, hiển thị được, nhưng KHÔNG có lệnh áp.
 *
 * Dung sai KHÔNG chặn đường này: dung sai là bộ lọc của lượt chuẩn hoá hàng
 * loạt, còn ở đây người duyệt đã nhìn từng hàng và tự chọn. Đoạn đã đúng độ dày
 * đó thì `createChangeWallThicknessCommand` từ chối (no-op) và rơi ra ngoài.
 */
export function buildAssignGroupCommands(
  rows: readonly ThicknessSegmentRow[],
  group: ThicknessGroup,
  context: Pick<BuildStandardizeCommandsContext, 'graph' | 'actorId'>,
): readonly Command[] {
  const thicknessMm = standardValueOf(group);

  return toChangeThicknessCommands(
    rows.map((row) => ({ wallId: row.wallId, thicknessMm })),
    commandContextOf(context.graph, context.actorId),
  );
}

/** Một tường và độ dày nó sẽ nhận; `null` nghĩa là nhóm không có giá trị số để gán. */
interface ThicknessTarget {
  readonly wallId: WallId;
  readonly thicknessMm: number | null;
}

/**
 * Lõi dùng chung của hai đường dựng lệnh ở trên.
 *
 * Trùng `wallId` thì chỉ giữ mục đầu: `commands.md` mục 2 cảnh báo hai lệnh
 * cùng nhắm một tường đều dựng từ CÙNG một ảnh đồ thị gốc, nên lệnh sau đè lệnh
 * trước và để lại một thay đổi vô nghĩa trong bước hoàn tác.
 */
function toChangeThicknessCommands(
  targets: readonly ThicknessTarget[],
  commandContext: CommandContext,
): readonly Command[] {
  const seen = new Set<WallId>();
  const commands: Command[] = [];

  for (const target of targets) {
    if (target.thicknessMm === null || seen.has(target.wallId)) {
      continue;
    }

    seen.add(target.wallId);

    const built = createChangeWallThicknessCommand(
      { wallId: target.wallId, thicknessMm: target.thicknessMm },
      commandContext,
    );

    if (built.ok) {
      commands.push(built.data);
    }
  }

  return commands;
}

/* -------------------------------------------------------------------------- */
/* Đường ghi — `runTransaction` chạy qua `commit`.                             */
/* -------------------------------------------------------------------------- */

/**
 * Cổng ghi của `dispatch`, cài bằng `commit`.
 *
 * `commit` nhận `SpatialPatch[]` và một nhãn tiếng Việt, đúng hai thứ
 * `applyPatches` có trong tay. Đây là dòng duy nhất của màn chạm tới kho, và nó
 * KHÔNG gọi `set()` (A10).
 */
export function createCommitSpatialPort(
  graph: ThicknessGraphPort,
  labelOf: () => string,
): SpatialPort {
  return {
    read: () => graph.read(),
    applyPatches: (patches) => {
      commit(patches, labelOf());
    },
    // Rollback KHÔNG được mở một bước hoàn tác mới: `commit` thì mở, còn
    // `applyRollbackPatches` thì không. Thiếu dòng này, một lượt dispatch hỏng ở
    // bước sau để lại HAI past-state zundo, và Ctrl+Z kế tiếp áp LẠI thay đổi vừa bị
    // rollback — vi phạm A8. Xem `SpatialPort.revertPatches` (lib/commands/dispatch.ts:145).
    revertPatches: applyRollbackPatches,
  };
}

/** Bộ phụ thuộc năm bước của `dispatch`, gắn với ngăn xếp hoàn tác 100 bước của S-06. */
export interface ThicknessDispatchDeps {
  readonly deps: DispatchDeps;
  readonly history: HistoryStack;
  /** Nhãn của lượt đang chạy — `SpatialPort` đọc nó để đặt tên cho `commit`. */
  readonly setLabel: (label: string) => void;
}

export interface CreateThicknessDispatchOptions {
  readonly graph: ThicknessGraphPort;
  /** Vùng chọn TRƯỚC lượt ghi; `stack.undo()` khôi phục lại đúng nó. */
  readonly selectionBefore: () => SelectionSnapshot;
  readonly selectionAfter: () => SelectionSnapshot;
  /** Bước `sync` — đánh dấu bản vẽ bẩn cho tự lưu (S-11/A7). */
  readonly onSynced: () => void;
  readonly history?: HistoryStack;
}

/**
 * Dựng `DispatchDeps` đầy đủ năm cổng.
 *
 * `history` là ngăn xếp thật của `src/lib/commands/history.ts` (mặc định
 * `MAX_HISTORY_STEPS` = 100 bước), KHÔNG phải `temporal` của zundo: hoàn tác
 * của màn phải hoàn tác đúng lượt màn đã chạy, kèm cả vùng chọn trước đó.
 */
export function createThicknessDispatchDeps(
  options: CreateThicknessDispatchOptions,
): ThicknessDispatchDeps {
  const history = options.history ?? createHistoryStack();
  let label = '';

  const deps: DispatchDeps = {
    spatial: createCommitSpatialPort(options.graph, () => label),
    history: {
      push: (entry) => {
        history.push({
          entry,
          selectionBefore: options.selectionBefore(),
          selectionAfter: options.selectionAfter(),
        });
      },
      drop: (entryId) => {
        history.drop(entryId);
      },
    },
    rules: createIncrementalRuleRunner(),
    sync: {
      enqueue: () => {
        options.onSynced();
      },
    },
  };

  return {
    deps,
    history,
    setLabel: (next) => {
      label = next;
    },
  };
}

/**
 * Chạy CẢ LÔ như MỘT bước lịch sử — chỗ DUY NHẤT của màn gọi `runTransaction`.
 *
 * Khuôn chép từ `FloorManager#runFloorTransaction` (`commands.md` mục 2, tiền
 * lệ đang chạy trong repo). `runCommandPipeline` gọi `history.push` đúng MỘT
 * lần cho mỗi lượt chạy, bất kể lô có bao nhiêu lệnh, và một transaction nhiều
 * lệnh không bao giờ bị fold vào bước trước nó — nên N lệnh cho ĐÚNG MỘT mục
 * hoàn tác (CẤM TUYỆT ĐỐI "không tách thành nhiều bước hoàn tác").
 */
export async function runStandardizeBatch(
  commands: readonly Command[],
  bundle: ThicknessDispatchDeps,
  label: string,
): Promise<DispatchResult> {
  bundle.setLabel(label);

  return runTransaction(commands, bundle.deps, { label });
}

/** Vùng chọn rỗng, cho lượt ghi không có gì được chọn trước đó. */
export const NO_THICKNESS_SELECTION: SelectionSnapshot = NO_SELECTION;

/* -------------------------------------------------------------------------- */
/* Vé hoàn tác (D-05) — tám giây, con số do chính vé mang.                     */
/* -------------------------------------------------------------------------- */

export interface CreateThicknessUndoTicketOptions {
  readonly description: string;
  readonly undo: () => void;
  readonly now: () => number;
}

/**
 * Vé hoàn tác của một lượt chuẩn hoá.
 *
 * `UNDO_WINDOW_MS` (8000 ms, A8) tới từ `src/lib/mutations/undoTicket.ts` — con
 * số KHÔNG được viết lại ở màn (R-71), và `createUndoTicket` dùng nó làm mặc
 * định nên ở đây thậm chí không có tham số nào mang nó.
 */
export function createThicknessUndoTicket(
  options: CreateThicknessUndoTicketOptions,
): UndoTicket {
  return createUndoTicket({
    description: options.description,
    now: options.now,
    undo: options.undo,
  });
}

/** Cửa sổ hoàn tác, xuất lại để hook và bài kiểm đọc đúng một nguồn. */
export { UNDO_WINDOW_MS };
