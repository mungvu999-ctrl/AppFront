/**
 * Cổng dữ liệu và tầng lệnh của màn S-12 "Duyệt lớp tường" — mọi lời gọi ra
 * khỏi màn đi qua đây.
 *
 * Cùng khuôn `pipelineFailureGateway.ts`: một danh sách
 * khả năng, một bản kê nợ endpoint, một `interface` cho hình dạng, một factory
 * dựng cổng thật và một factory dựng cổng có dữ liệu cho test và story (R-73).
 *
 * ## Đường ghi — `dispatch` chạy qua `commit`
 *
 * Quyết định đã chốt của điều phối viên (Q1): lệnh nghiệp vụ S-07 đi qua
 * `dispatch` (S-05, năm bước `validate → apply → history → rules → sync`), và
 * `SpatialPort.applyPatches` của `dispatch` được cài bằng `commit(patches,
 * label)` của `src/store/commit.ts`. Nhờ vậy màn có đủ:
 *
 * - rule chạy lại sau mỗi lệnh (`createIncrementalRuleRunner`),
 * - ngăn xếp hoàn tác 100 bước của S-06 (`createHistoryStack`,
 *   `MAX_HISTORY_STEPS`), chứ không phải ngăn xếp zundo,
 * - đồng bộ S-11 (`SyncPort.enqueue` đánh dấu bản vẽ bẩn cho tự lưu),
 * - và **không phạm A10**: không dòng nào gọi `set()` hay `_applyPatches()`.
 *
 * ## Lệnh duyệt `wall.approve` — dựng bằng nguyên thuỷ công khai
 *
 * `WALL_COMMAND_TYPES` (`wallCommands.ts:98-106`) chỉ có bảy lệnh và **không có
 * lệnh duyệt**. Điều phối viên đã duyệt cách dựng bằng `createCommand` +
 * `changeForUpdate` (hợp đồng lô-gic mục C.2), hợp lệ vì `CommandType` là
 * `string` mở và `validateCommands` chỉ kiểm `command.type` khác rỗng, không so
 * với một bảng cho phép (mục C.3). Lệnh tự hoàn tác được vì `changeForUpdate`
 * mang ĐỦ ảnh chụp `before`/`after`, và `invertCommand` chỉ hoán đổi hai ảnh đó
 * (mục C.5) — không cần thêm một dòng nào cho `Ctrl+Z`.
 *
 * **A5 ép ngay ở kiểu dựng lệnh:** {@link buildApproveWallCommand} là đường DUY
 * NHẤT đặt `reviewed: true`, và nó luôn đặt kèm `source: 'human'`. Không có
 * tham số nào cho phép người gọi truyền `source`, nên không tồn tại đường để
 * đầu ra AI bật cờ xanh "đã xác minh".
 *
 * ## Đọc và lưu
 *
 * - Lưu lớp của tầng qua #35 không nằm ở cổng: hook gọi `useFloorLayerAutosave`
 *   (một bộ lưu mỗi người–dự án, F-04x-1) với `apiClient` cổng lộ ra; cờ
 *   `supports.persistWallLayer` giữ nghĩa "cổng này có đường lưu".
 * - `readWallGraph` — đồ thị tường sống trong `src/store` (nơi `commit` ghi
 *   vào), không có endpoint nào trả về nó. Cổng đọc nó qua một cửa tiêm được,
 *   mặc định là chính store; ảnh nền thì đọc thật qua `spatial.readFloor`.
 */

import type { ProjectLengthUnit } from '@/hooks/useProjectUnits';
import { readFloorLayerRead, type FloorLayerGraphRead } from '@/api/floorLayerGraph';
import type { ApiClient } from '@/api/client';
import type { FloorLayerDocument } from '@/api/schemas/spatialLayer';
import { mockFloorLayerDocument } from '../shared/mockFloorLayerDocument';
import { createAppApiClient } from '@/api/appClient';
import { checkDanglingWallEnds, checkWallOverlap } from '@/domain/rules/geometry';
import { entitiesInScope } from '@/domain/rules/registry';
import { counterLabelOf, createId } from '@/domain/spatial/ids';
import type { NormalizedSpatial } from '@/domain/spatial/normalize';
import type { Level, Point, Wall, WallId } from '@/domain/spatial/types';
import { measureDistance, type Measurement } from '@/domain/measure/measure';
import { mergeWalls, splitWall } from '@/domain/walls/edit';
import { isWithinThicknessTolerance } from '@/domain/walls/thicknessTolerance';
import { resolveDrawableWallShapes } from '@/domain/walls/joints';
import { centrelineLength, type Wall as SolidWall } from '@/domain/walls/types';
import { millimetresPerPixel, pixels, scaleFromRatio, type Scale } from '@/domain/units/scale';
import { millimetres } from '@/domain/units/types';
import type { MeasurementState } from '@/hooks/useMeasurementLabel';
import { readProjectConfidenceThreshold, type ReadConfidenceThreshold } from '@/hooks/useProjectConfidenceThreshold';
import { WALL_COMMAND_TYPES } from '@/lib/commands/business/wallCommands';
import {
  createDeleteWallCommand,
  createDragWallEndCommand,
  createDrawWallCommand,
  createChangeWallThicknessCommand,
  createMergeWallsCommand,
  createSplitWallCommand,
  type ChangeWallThicknessInput,
  type DeleteWallInput,
  type DragWallEndInput,
  type DrawWallInput,
  type MergeWallsInput,
  type SplitWallInput,
} from '@/lib/commands/business/wallCommands';
import {
  formatElevationM,
  formatPoint,
  toPointMm,
  toSolidWall,
  WALL_KIND_LABELS,
  type CommandContext,
  type CommandResult,
} from '@/lib/commands/business/shared';
import { GLASS_WALL_PAINT, isGlassWall } from '@/domain/walls/glass';
import { changeForUpdate, createCommand } from '@/lib/commands/createCommand';
import type { Command } from '@/lib/commands/types';
import type { ToolOutcome } from '@/lib/tools/toolMachine';
import {
  isScaleMissing,
  SCALE_MEASURE_SUFFIX,
  scaleStateOf,
  type ScaleSource,
  type ScaleStatus,
  type WireScaleState,
} from '@/lib/viewmodel/provisionalScale';
import {
  createIncrementalRuleRunner,
  dispatch,
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
import { formatLength, formatScaleDensity } from '@/lib/format/measure';
import { formatNumber } from '@/lib/format/number';
import { CONFIDENCE_SUGGESTED_THRESHOLD } from '@/lib/format/semantic';
import { createUndoTicket, LONG_UNDO_WINDOW_MS, UNDO_WINDOW_MS, type UndoTicket } from '@/lib/mutations/undoTicket';
import { toWallViewModel } from '@/lib/viewmodel/toViewModel';
import type { ViewStatusCode } from '@/lib/viewmodel/types';
import { applyRollbackPatches, commit } from '@/store/commit';
import { useStore } from '@/store';

import {
  WALL_THICKNESS_CHOICES,
  type WallInspectorViewModel,
  type WallRowViewModel,
  type WallShapeViewModel,
  type WallThicknessChoice,
} from './types';
import {
  WALL_LAYER_FIXTURE_LEVEL,
  WALL_LAYER_FIXTURE_WALLS,
} from './wallLayerReviewFixture';
import { WALL_CONFIDENCE_TIER_TEXT, WALL_THICKNESS_COLOR_GROUPS, wallConfidenceTierOf, wallThicknessBandOf, wallThicknessColorGroupOf } from './wallLayerHatch';
import type {
  WallLayerCanvasShape,
  WallLayerLegendLevels,
  WallLayerMeasurementPx,
  WallLayerPointerReading,
  WallLayerRectPx,
  WallLayerSizePx,
  WallLayerViewportRectPercent,
} from './wallLayerHatch';

/* -------------------------------------------------------------------------- */
/* Khả năng — những gì màn hỏi thế giới bên ngoài.                             */
/* -------------------------------------------------------------------------- */

/** Tên máy đọc của từng việc màn cần. Mỗi việc chưa làm được có một dòng nợ. */
export const WALL_LAYER_CAPABILITIES = [
  'readBackground',
  'readWallGraph',
  'writeWallGraph',
  'persistWallLayer',
] as const;

export type WallLayerCapability = (typeof WALL_LAYER_CAPABILITIES)[number];

/** Việc trong danh sách trên mà bản cài đặt THẬT chưa làm được. Chỉ được ngắn đi. */
export const WALL_LAYER_MISSING_CAPABILITIES = [] as const;

export type WallLayerMissingCapability = (typeof WALL_LAYER_MISSING_CAPABILITIES)[number];

/** Endpoint còn thiếu của từng khả năng, viết nguyên văn cho người nối dây sau. */
export const WALL_LAYER_MISSING_ENDPOINTS: Readonly<
  Record<WallLayerMissingCapability, string>
> = {};

/** Một khả năng chưa tồn tại. `supported: false` là câu trả lời thật, không phải lỗi. */
export interface WallLayerUnsupported {
  readonly supported: false;
  readonly capability: WallLayerMissingCapability;
  /** Lấy nguyên từ {@link WALL_LAYER_MISSING_ENDPOINTS}. */
  readonly missing: string;
}

export interface WallLayerSupported<TValue> {
  readonly supported: true;
  readonly value: TValue;
}

export type WallLayerCapabilityResult<TValue> =
  | WallLayerSupported<TValue>
  | WallLayerUnsupported;

/** Dựng nhánh "chưa có đường làm việc này" — một chỗ duy nhất ghép tên với nợ. */
export function unsupported(capability: WallLayerMissingCapability): WallLayerUnsupported {
  return {
    supported: false,
    capability,
    missing: WALL_LAYER_MISSING_ENDPOINTS[capability],
  };
}

/* -------------------------------------------------------------------------- */
/* Dữ liệu thô.                                                                */
/* -------------------------------------------------------------------------- */

/**
 * Ảnh nền của lớp tường — bản vẽ gốc đã tải lên, đọc qua `spatial.readFloor`.
 *
 * Đây là dữ liệu MÁY CHỦ duy nhất của màn, nên nó là thứ duy nhất đi qua
 * `useQuery` (R-64). Tường thì sống trong store, xem {@link WallLayerGraphPort}.
 */
export interface WallLayerBackground {
  /** `null` khi tầng chưa có bản vẽ nào — canvas vẽ khung xám chờ, không phải màn trắng. */
  readonly imageUrl: string | null;
  /** Mô tả ảnh cho trình đọc màn hình (R-72). */
  readonly imageAlt: string;
  /** Bề ngang bản vẽ, milimét công trình. `null` khi chưa có bản vẽ nào. */
  readonly widthMm: number | null;
  /** Chiều cao bản vẽ, milimét công trình. `null` khi chưa có bản vẽ nào. */
  readonly heightMm: number | null;
}

/** Cửa đọc đồ thị đang sửa. Mặc định là store; test cắm một đồ thị cố định. */
export interface WallLayerGraphPort {
  readonly read: () => NormalizedSpatial | null;
}

/*
 * Vì sao có `readWallLayer` bên cạnh `graph.read`.
 *
 * `graph.read` là lượt đọc ĐỒNG BỘ của đồ thị đang sửa (kho), và nó không hỏng
 * được: nó trả `null` khi kho còn trống. Trạng thái 4 của A11 nói về một thứ
 * khác hẳn — LỚP TƯỜNG của tầng không tải được — và trước lượt sửa này màn
 * không có đường nào diễn tả điều đó, nên nó mượn tạm cờ hỏng của ẢNH NỀN. Hệ
 * quả đo được: đúng lúc hỏng thì `backgroundImageUrl` thành `null` và kỹ sư mất
 * luôn ảnh gốc để đối chiếu — trái đúng điều `wallLayerReviewScenarios.ts` gọi
 * là bắt buộc ("canvas không được trắng dù danh sách trắng").
 *
 * `readWallLayer` là lượt đọc bất đồng bộ của chính lớp tường (giữ cho bài kiểm
 * `floorLayerGraph.test.ts`; màn nay đọc N16 qua `readLayer` + `useFloorLayer`,
 * dưới `queryKeys.layer.byFloor`). Cổng thật trả lại đúng đồ thị `graph.read()` cho ra (không
 * bịa một endpoint nào, xem `WALL_LAYER_MISSING_ENDPOINTS`); cổng giả có cờ
 * `failReadWallLayer` để bảy kịch bản ép được trạng thái 4 mà KHÔNG phải phá
 * ảnh nền.
 */

export interface ReadBackgroundInput {
  readonly projectId: string;
  readonly floorId: string;
  readonly signal?: AbortSignal;
}

/* -------------------------------------------------------------------------- */
/* Cái seam.                                                                   */
/* -------------------------------------------------------------------------- */

/** Mỗi phương thức là một việc màn cần từ bên ngoài, và không có việc nào khác. */
export interface WallLayerReviewGateway {
  /** Khả năng nào cổng này làm được, trả lời ĐỒNG BỘ — màn phải biết trước lượt vẽ đầu. */
  readonly supports: Readonly<Record<WallLayerCapability, boolean>>;
  /** Ảnh nền của tầng. Lỗi ở ĐÂY chỉ làm mất ảnh nền, không phải hỏng lớp tường. */
  readonly readBackground: (input: ReadBackgroundInput) => Promise<WallLayerBackground>;
  /** Lớp tường của tầng. Lỗi ở đây là trạng thái `error` — ảnh gốc VẪN xem được. */
  readonly readWallLayer: (input: ReadBackgroundInput) => Promise<FloorLayerGraphRead | null>;
  /** N16 thô của tầng — nguồn của `useFloorLayer` (F-04x-2). Lỗi ở đây là trạng thái `error`. */
  readonly readLayer: (input: ReadBackgroundInput) => Promise<FloorLayerDocument>;
  /** Đồ thị đang sửa — nơi `commit` vừa ghi vào. */
  readonly graph: WallLayerGraphPort;
  /** Project floor list (#30) for the floor nav. Absent: the graph's own levels are used. */
  readonly readFloors?: (input: {
    readonly projectId: string;
    readonly signal?: AbortSignal;
  }) => Promise<readonly { readonly id: string; readonly name: string; readonly order: number }[]>;
  /** Client của bộ lưu lớp (`useFloorLayerAutosave`). Vắng thì hook dùng client chung. */
  readonly apiClient?: ApiClient;
  /** Mã tường mới. Cùng cửa với `ToolContext.nextId` của `toolMachine`. */
  readonly nextWallId: () => WallId;
  /** Ai đang thao tác — đi vào `Command.actorId` và nhật ký hoạt động. */
  readonly actorId: string;
  /** Mốc giờ hiện tại. Tiêm được để test không phụ thuộc đồng hồ thật. */
  readonly now: () => number;
  /** Ngưỡng tin cậy của dự án (N5). Vắng → ngưỡng mặc định 0,70 (BUG-354). */
  readonly readConfidenceThreshold?: ReadConfidenceThreshold;
}

/* -------------------------------------------------------------------------- */
/* Cửa vào — cổng thật.                                                        */
/* -------------------------------------------------------------------------- */

/** Mô tả ảnh nền cho trình đọc màn hình, ghép từ tên tầng đã có. */
export const backgroundImageAlt = (floorName: string): string =>
  `Bản vẽ gốc của ${floorName}, dùng làm nền để đối chiếu lớp tường.`;

/* -------------------------------------------------------------------------- */
/* Nhãn mã tường — mã máy dài, nhãn người đọc ngắn.                            */
/* -------------------------------------------------------------------------- */

/** Số chữ số phần đếm trong thân mã — `COUNTER_LENGTH` của `src/domain/spatial/ids.ts:41`. */
const ID_COUNTER_LENGTH = 6;

/**
 * Nhãn người đọc của một mã tường: `W-000014WALL` → `W-014`.
 *
 * Mã máy phải dài (thân ≥ 10 ký tự, xem đầu `wallLayerReviewFixture.ts`) để
 * tầng lệnh nhận; nhãn thanh tra thì đặc tả đòi đúng "#W-014". `types.ts:220`
 * đã tách sẵn `codeLabel` khỏi `id` cho đúng việc này, nên hai thứ đi riêng
 * chứ không phải chọn một.
 *
 * Đọc ngược sáu chữ số đếm mà `createId` sinh ra, nên nó đúng cho cả tường của
 * bộ mẫu lẫn tường người dùng vừa vẽ. Mã không có số đếm đứng đầu (mã BE) trả
 * NGUYÊN VĂN (`counterLabelOf`) — đánh số nó cần cả danh sách anh em, việc của
 * `displayCodesOf` (B-V7-81). Thuần cắt chuỗi.
 */
export function wallDisplayCode(id: string): string {
  return counterLabelOf(id);
}

/**
 * Nhãn `#W-014` của một tường, ưu tiên bảng mã của cả tầng (`displayCodesOf`,
 * mã BE / bộ mẫu A14 không có số đếm đứng đầu), rơi về `wallDisplayCode`.
 */
export const wallLabelOf = (id: string, codes?: ReadonlyMap<string, string>): string =>
  `#${codes?.get(id) ?? wallDisplayCode(id)}`;

export interface CreateWallLayerReviewGatewayOptions {
  /** Client tiêm được. Vắng mặt thì cổng dùng client giả dùng chung của repo. */
  readonly apiClient?: ApiClient;
  /** Cửa đọc đồ thị. Vắng mặt thì cổng đọc thẳng store. */
  readonly graph?: WallLayerGraphPort;
  readonly actorId?: string;
  readonly now?: () => number;
  readonly nextWallId?: () => WallId;
}

/**
 * Người thực hiện mặc định khi nơi gọi chưa truyền ai.
 *
 * Một chuỗi ĐẶT TÊN chứ không phải chuỗi rỗng: `validateCommands` từ chối lệnh
 * thiếu `actorId`, nên một mặc định rỗng sẽ làm mọi lệnh hỏng ở bước `validate`
 * thay vì hỏng ở chỗ người nối dây quên truyền.
 */
export const WALL_LAYER_DEFAULT_ACTOR_ID = 'wall-layer-reviewer';

/** Cổng thật — thứ container lớp 3 gọi. */
export function createWallLayerReviewGateway(
  options: CreateWallLayerReviewGatewayOptions = {},
): WallLayerReviewGateway {
  const apiClient = options.apiClient ?? createAppApiClient();
  const graph: WallLayerGraphPort = options.graph ?? {
    read: () => useStore.getState().spatial,
  };
  return {
    apiClient,
    supports: {
      readBackground: true,
      readWallGraph: true,
      writeWallGraph: true,
      persistWallLayer: true,
    },

    readBackground: async ({ floorId, projectId, signal }) => {
      const result = await apiClient.spatial.readFloor(
        signal === undefined ? { floorId, projectId } : { floorId, projectId, signal },
      );

      if (!result.ok) {
        throw result.error;
      }

      const drawing = result.data.drawings[0];

      return {
        imageUrl: drawing?.url ?? null,
        imageAlt: backgroundImageAlt(result.data.name),
        widthMm: drawing?.widthMm ?? null,
        heightMm: drawing?.heightMm ?? null,
      };
    },

    readWallLayer: async (input) => {
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

    readFloors: async ({ projectId, signal }) => {
      const result = await apiClient.floors.list(
        signal === undefined ? { projectId } : { projectId, signal },
      );

      if (!result.ok) {
        throw result.error;
      }

      return result.data;
    },

    graph,

    nextWallId: options.nextWallId ?? ((): WallId => createId('wall')),
    actorId: options.actorId ?? WALL_LAYER_DEFAULT_ACTOR_ID,
    now: options.now ?? ((): number => Date.now()),
    readConfidenceThreshold: (input) => readProjectConfidenceThreshold(apiClient.projectSettings, input),
  };
}

/* -------------------------------------------------------------------------- */
/* Bộ mẫu — chỗ story và test cắm vào (R-73).                                  */
/* -------------------------------------------------------------------------- */

/** Ảnh nền của bộ mẫu. Không phải đường dẫn thật, nên không phạm R-65. */
export const WALL_LAYER_SAMPLE_IMAGE = 'sample-floor-plan.png';

/**
 * Khổ bản vẽ mẫu — bao trọn lưới 12.500 × 8.800 mm của bộ mẫu, có lề.
 *
 * Hai con số này là DỮ LIỆU của bộ mẫu (khổ tờ bản vẽ), không phải ngưỡng hay
 * thời lượng, nên chúng thuộc về bảng dữ liệu này chứ không phải một hằng rải
 * trong thân hàm.
 */
export const WALL_LAYER_SAMPLE_DRAWING_WIDTH_MM = 13000;
export const WALL_LAYER_SAMPLE_DRAWING_HEIGHT_MM = 9300;

/** Cách bài kiểm ép một cảnh cụ thể, không sửa mã. */
export interface WallLayerGatewaySeed {
  /** Đồ thị cổng trả về. Vắng mặt thì cổng đọc store thật. */
  readonly graph?: NormalizedSpatial | null;
  /** `true` thì `readBackground` ném — ảnh nền mất, lớp tường thì không. */
  readonly failReadBackground?: boolean;
  /** `true` thì `readWallLayer` ném — đúng cảnh `error` của bảy kịch bản. */
  readonly failReadWallLayer?: boolean;
  /** `true` thì ảnh nền chưa có — canvas vẽ khung xám chờ. */
  readonly withoutImage?: boolean;
  /** `'unresolved'` thì N16 giả mang tỉ lệ tạm — story "Tỉ lệ tạm" (F-04x-2). */
  readonly scaleStatus?: 'unresolved';
  /** Cờ `supports.persistWallLayer` của bộ mẫu (mặc định `true`). */
  readonly canPersist?: boolean;
  /** Client cho bộ lưu lớp. Vắng thì hook dùng client chung (mock trong test/story). */
  readonly apiClient?: ApiClient;
  readonly actorId?: string;
  readonly now?: () => number;
  readonly nextWallId?: () => WallId;
}

/** Cổng có dữ liệu — dùng chung giữa test và story, không bịa bảng dữ liệu thứ hai (R-70). */
export function createMockWallLayerReviewGateway(
  seed: WallLayerGatewaySeed = {},
): WallLayerReviewGateway {
  const canPersist = seed.canPersist ?? true;
  let counter = 0;

  return {
    ...(seed.apiClient === undefined ? {} : { apiClient: seed.apiClient }),
    supports: {
      readBackground: true,
      readWallGraph: true,
      writeWallGraph: true,
      persistWallLayer: canPersist,
    },

    readBackground: () => {
      if (seed.failReadBackground === true) {
        return Promise.reject(new Error('Không tải được bản vẽ gốc của tầng.'));
      }

      const hasImage = seed.withoutImage !== true;

      return Promise.resolve({
        imageUrl: hasImage ? WALL_LAYER_SAMPLE_IMAGE : null,
        imageAlt: backgroundImageAlt(WALL_LAYER_FIXTURE_LEVEL.name),
        widthMm: hasImage ? WALL_LAYER_SAMPLE_DRAWING_WIDTH_MM : null,
        heightMm: hasImage ? WALL_LAYER_SAMPLE_DRAWING_HEIGHT_MM : null,
      });
    },

    readWallLayer: () => {
      if (seed.failReadWallLayer === true) {
        return Promise.reject(new Error('Không tải được lớp tường của tầng.'));
      }

      const stored = seed.graph ?? useStore.getState().spatial;

      return Promise.resolve(stored === null ? null : { floorRevisions: {}, graph: stored });
    },

    readLayer: ({ floorId }) => {
      if (seed.failReadWallLayer === true) {
        return Promise.reject(new Error('Không tải được lớp tường của tầng.'));
      }

      return mockFloorLayerDocument(seed.graph ?? useStore.getState().spatial, floorId, seed.scaleStatus);
    },

    graph: { read: () => seed.graph ?? useStore.getState().spatial },

    /*
     * Mã tường mới của bộ mẫu — cùng khuôn `createId`, KHÔNG phải "W-M1".
     *
     * Thân mã phải dài ít nhất 10 ký tự `[0-9A-Z]` hoặc `dispatch.ts:285` từ
     * chối lệnh vẽ tường ngay ở bước kiểm (xem đầu `wallLayerReviewFixture.ts`).
     * Vẫn tất định: số đếm chạy trong phạm vi một cổng giả, đuôi là hằng.
     */
    nextWallId:
      seed.nextWallId ??
      ((): WallId => {
        counter += 1;

        return `W-${formatNumber(counter, { grouping: false, fractionDigits: 0 }).padStart(
          ID_COUNTER_LENGTH,
          '0',
        )}MOCK` as WallId;
      }),
    actorId: seed.actorId ?? WALL_LAYER_DEFAULT_ACTOR_ID,
    now: seed.now ?? ((): number => Date.now()),
  };
}

/** Bộ mẫu đầy đủ, đúng 48 tường / 12 đã duyệt — xem `wallLayerReviewFixture.ts`. */
export const WALL_LAYER_SAMPLE_WALLS = WALL_LAYER_FIXTURE_WALLS;

/* -------------------------------------------------------------------------- */
/* Tầng lệnh — bảy lệnh S-07 gọi lại, một lệnh duyệt dựng bằng nguyên thuỷ.     */
/* -------------------------------------------------------------------------- */

/**
 * Loại của lệnh duyệt.
 *
 * Không nằm trong `WALL_COMMAND_TYPES` vì lệnh này không tồn tại ở S-07; hằng
 * đặt tên ở đây là chỗ DUY NHẤT chuỗi đó được viết, nên nhật ký hoạt động, đo
 * đạc và bài kiểm cùng đọc một nguồn (R-71).
 */
export const WALL_APPROVE_COMMAND_TYPE = 'wall.approve';

/** Câu mô tả trên nút hoàn tác và nhật ký hoạt động — `validateCommands` đòi nó khác rỗng. */
export const approveDescription = (wallId: WallId, codes?: ReadonlyMap<string, string>): string =>
  `Duyệt tường ${wallLabelOf(wallId, codes)}.`;

/**
 * Lệnh duyệt một tường.
 *
 * A5: đây là đường DUY NHẤT đặt `reviewed: true`, và nó luôn đặt kèm
 * `source: 'human'` — không có tham số nào cho phép nơi gọi truyền `source`,
 * nên đầu ra AI không có đường nào bật được cờ xanh "đã xác minh".
 *
 * Ảnh chụp `before`/`after` là ĐẦY ĐỦ (`changeForUpdate` giữ nguyên hai bản
 * ghi, không phải diff từng trường), nên `invertCommand` hoàn tác được lệnh này
 * mà không cần biết nó nghĩa là gì.
 */
export function buildApproveWallCommand(
  before: Wall,
  actorId: string,
  codes?: ReadonlyMap<string, string>,
): Command {
  const after: Wall = { ...before, reviewed: true, source: 'human' };

  return createCommand({
    type: WALL_APPROVE_COMMAND_TYPE,
    actorId,
    description: approveDescription(before.id, codes),
    changes: [changeForUpdate('wall', before, after)],
  });
}

/** Loại của lệnh bỏ duyệt (S2-5) — chỗ duy nhất viết chuỗi này. */
export const WALL_UNAPPROVE_COMMAND_TYPE = 'wall.unapprove';

/** Câu mô tả trên nút hoàn tác và nhật ký hoạt động. */
export const unapproveDescription = (wallId: WallId, codes?: ReadonlyMap<string, string>): string =>
  `Bỏ duyệt tường ${wallLabelOf(wallId, codes)}.`;

/**
 * Lệnh bỏ duyệt một tường (S2-5): lỡ tay duyệt thì sửa lại được, kể cả sau khi tải lại trang.
 * Chỉ hạ `reviewed` về `false`; `source` giữ nguyên vì hình học vẫn là bản người đã sửa.
 */
export function buildUnapproveWallCommand(
  before: Wall,
  actorId: string,
  codes?: ReadonlyMap<string, string>,
): Command {
  const after: Wall = { ...before, reviewed: false };

  return createCommand({
    type: WALL_UNAPPROVE_COMMAND_TYPE,
    actorId,
    description: unapproveDescription(before.id, codes),
    changes: [changeForUpdate('wall', before, after)],
  });
}

/** Loại của lệnh chọn vật liệu tường — chỗ duy nhất viết chuỗi này. */
export const WALL_CHANGE_MATERIAL_COMMAND_TYPE = 'wall.changeMaterial';

/**
 * Lệnh chọn vật liệu: tường kính ghi `Wall.paint` hai mặt kính; tường thường bỏ `paint`, tường về màu
 * phong cách. `null` khi không có gì đổi.
 */
export function buildChangeWallMaterialCommand(
  before: Wall,
  isGlass: boolean,
  actorId: string,
  codes?: ReadonlyMap<string, string>,
): Command | null {
  if (isGlassWall(before) === isGlass) {
    return null;
  }

  const after: Wall = { ...before, paint: GLASS_WALL_PAINT };

  if (!isGlass) {
    delete after.paint;
  }

  return createCommand({
    type: WALL_CHANGE_MATERIAL_COMMAND_TYPE,
    actorId,
    description: `Đổi tường ${wallLabelOf(before.id, codes)} thành ${isGlass ? 'tường kính' : 'tường thường'}.`,
    changes: [changeForUpdate('wall', before, after)],
  });
}

/** Ngữ cảnh mà bảy hàm dựng lệnh của S-07 đọc. */
export const commandContextOf = (
  graph: NormalizedSpatial,
  actorId: string,
): CommandContext => ({ graph, actorId });

/** Đổi độ dày — gọi lại S-07, không dựng lại. */
export const buildChangeThicknessCommand = (
  input: ChangeWallThicknessInput,
  context: CommandContext,
): CommandResult => createChangeWallThicknessCommand(input, context);

/** Dời một đầu tường (ô "Chiều dài" của thanh tra) — gọi lại S-07, cùng lệnh kéo đỉnh. */
export const buildDragWallEndCommand = (
  input: DragWallEndInput,
  context: CommandContext,
): CommandResult => createDragWallEndCommand(input, context);

/** Tách đoạn — gọi lại S-07. Điểm cắt được chính hình học rơi xuống tim tường. */
export const buildSplitWallCommand = (
  input: SplitWallInput,
  context: CommandContext,
): CommandResult => createSplitWallCommand(input, context);

/** Nối đoạn — gọi lại S-07. Hành động theo VÙNG CHỌN, không phải một chế độ công cụ. */
export const buildMergeWallsCommand = (
  input: MergeWallsInput,
  context: CommandContext,
): CommandResult => createMergeWallsCommand(input, context);

/** Xoá — gọi lại S-07. Xoá kéo theo ô mở và tham chiếu, trong CÙNG một lệnh. */
export const buildDeleteWallCommand = (
  input: DeleteWallInput,
  context: CommandContext,
): CommandResult => createDeleteWallCommand(input, context);

/** Vẽ tường — gọi lại S-07, cho lượt kết thúc một cử chỉ của công cụ `drawWall`. */
export const buildDrawWallCommand = (
  input: DrawWallInput,
  context: CommandContext,
): CommandResult => createDrawWallCommand(input, context);

/**
 * Một kết quả của máy công cụ thành một lệnh, hoặc `null` khi nó không phải
 * việc của lớp tường.
 *
 * `ToolCommandRequest` là "con đường duy nhất từ thanh công cụ tới dữ liệu"
 * (`toolMachine.ts:213`): nó chỉ nêu TÊN của hàm dựng lệnh và đầu vào, còn việc
 * gọi hàm nào là của tầng này. Hai loại lớp tường nhận là `wall.draw` (kết thúc
 * một cử chỉ vẽ) và `wall.split` (kết thúc một cử chỉ cắt); ô mở và đồ đạc
 * thuộc lớp khác nên rơi vào `null` chứ không bị dựng nhầm ở đây.
 */
export function toolOutcomeToCommand(
  outcome: ToolOutcome,
  context: CommandContext,
): Command | null {
  if (outcome.kind !== 'command') {
    return null;
  }

  if (outcome.request.type === WALL_COMMAND_TYPES.draw) {
    const built = buildDrawWallCommand(outcome.request.input, context);

    return built.ok ? built.data : null;
  }

  if (outcome.request.type === WALL_COMMAND_TYPES.split) {
    const built = buildSplitWallCommand(outcome.request.input, context);

    return built.ok ? built.data : null;
  }

  return null;
}

/* -------------------------------------------------------------------------- */
/* Đường ghi — `dispatch` chạy qua `commit`.                                   */
/* -------------------------------------------------------------------------- */

/**
 * Cổng ghi của `dispatch`, cài bằng `commit`.
 *
 * `commit` nhận `SpatialPatch[]` và một nhãn tiếng Việt, đúng hai thứ
 * `applyPatches` có trong tay. Nhãn lấy từ chính `label` của lượt dispatch, nên
 * nút hoàn tác và nhật ký hoạt động đọc cùng một câu.
 */
export function createCommitSpatialPort(
  graph: WallLayerGraphPort,
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
export interface WallLayerDispatchDeps {
  readonly deps: DispatchDeps;
  readonly history: HistoryStack;
  /** Nhãn của lượt dispatch đang chạy — `SpatialPort` đọc nó để đặt tên cho `commit`. */
  readonly setLabel: (label: string) => void;
}

export interface CreateWallLayerDispatchOptions {
  readonly graph: WallLayerGraphPort;
  /** Vùng chọn TRƯỚC lượt ghi; `stack.undo()` khôi phục lại đúng nó. */
  readonly selectionBefore: () => SelectionSnapshot;
  readonly selectionAfter: () => SelectionSnapshot;
  /** Bước `sync` — đánh dấu bản vẽ bẩn cho tự lưu (S-11). */
  readonly onSynced: () => void;
  readonly history?: HistoryStack;
}

/**
 * Dựng `DispatchDeps` đầy đủ năm cổng.
 *
 * `history` là ngăn xếp thật của `src/lib/commands/history.ts` (mặc định
 * `MAX_HISTORY_STEPS` = 100 bước), không phải `temporal` của zundo: `Ctrl+Z`
 * của màn này phải hoàn tác đúng những lệnh màn đã chạy, kèm cả vùng chọn
 * trước đó.
 */
export function createWallLayerDispatchDeps(
  options: CreateWallLayerDispatchOptions,
): WallLayerDispatchDeps {
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

/** Chạy một lệnh qua đủ năm bước. Nhãn của lượt là mô tả của chính lệnh. */
export async function runWallCommand(
  command: Command,
  bundle: WallLayerDispatchDeps,
): Promise<DispatchResult> {
  bundle.setLabel(command.description);

  return dispatch(command, bundle.deps);
}

/** Vùng chọn rỗng, cho lượt ghi không có gì được chọn trước đó. */
export const NO_WALL_SELECTION: SelectionSnapshot = NO_SELECTION;

/* -------------------------------------------------------------------------- */
/* Vé hoàn tác (D-05) — xoá là tức thì, không hộp thoại.                       */
/* -------------------------------------------------------------------------- */

/**
 * Câu trên toast hoàn tác sau khi xoá — gọi tường bằng đúng nhãn danh sách gọi nó
 * (`#W-001`), không bằng mã máy `W-000001WALL` (B-V6-02).
 */
export interface DeleteToastExtras {
  /** U36: số cửa đi/cửa sổ gắn trên tường, bị xoá cùng lệnh. */
  readonly openingCount?: number;
  /** U57: số thứ tự trên hình và trong danh sách (`QcQueueNumber`), để toast gọi cùng tên với hình. */
  readonly queueNumber?: number;
}

export const deleteToastDescription = (
  wallId: WallId,
  wallCodes?: ReadonlyMap<string, string>,
  extras: DeleteToastExtras = {},
): string => {
  const { openingCount = 0, queueNumber } = extras;
  const name = queueNumber === undefined ? wallLabelOf(wallId, wallCodes) : `số ${queueNumber} (${wallLabelOf(wallId, wallCodes)})`;
  const openings = openingCount > 0 ? ` và ${openingCount} cửa gắn trên tường` : '';

  return `Đã xoá tường ${name}${openings}.`;
};

export interface CreateWallUndoTicketOptions {
  readonly wallId: WallId;
  /** Bảng mã của tầng TRƯỚC khi xoá, để toast gọi tường đúng nhãn danh sách. */
  readonly wallCodes?: ReadonlyMap<string, string>;
  /** Cửa gắn trên tường và số thứ tự trên hình — chữ của toast (U36, U57). */
  readonly extras?: DeleteToastExtras;
  readonly undo: () => void;
  readonly now: () => number;
}

/**
 * Vé hoàn tác của một lượt xoá.
 *
 * U35: xoá trên bản vẽ dùng cửa sổ dài `LONG_UNDO_WINDOW_MS` (15 s) của `undoTicket.ts` —
 * phải nhìn lại hình mới biết xoá nhầm; toast đọc cửa sổ từ vé. Không viết số ở màn (R-71).
 */
export function createWallUndoTicket(options: CreateWallUndoTicketOptions): UndoTicket {
  return createUndoTicket({
    description: deleteToastDescription(options.wallId, options.wallCodes, options.extras),
    now: options.now,
    ttlMs: LONG_UNDO_WINDOW_MS,
    undo: options.undo,
  });
}

/** Cửa sổ hoàn tác, xuất lại để hook và bài kiểm đọc đúng một nguồn. */
export { LONG_UNDO_WINDOW_MS, UNDO_WINDOW_MS };

/* -------------------------------------------------------------------------- */
/* Hình học — GỌI LẠI, không tự tính.                                          */
/* -------------------------------------------------------------------------- */

/** Đổi một tường đồ thị sang vựng hình học của `src/domain/walls`. */
export const toGeometryWall = (wall: Wall, level: Level): SolidWall =>
  toSolidWall(wall, level);

/**
 * Đa giác của mọi tường trên tầng, qua `resolveDrawableWallShapes` — nguồn DUY NHẤT của
 * hình tường để vẽ.
 *
 * Một tường dày ngoài 60–600 mm (AI đo trên brochure màu ra 56 mm) vẫn vẽ, kẹp ở biên; tường
 * dài 0 bị bỏ. Trước đây MỘT tường như thế làm mất hình cả tầng. Chỉ hai tường trùng mã còn
 * ném: bản vẽ hỏng không được làm trắng màn (A11), nên lỗi đó thành "không có hình nào".
 */
export function toWallShapes(
  walls: readonly Wall[],
  level: Level,
  statusOf: (wall: Wall) => ViewStatusCode,
): readonly WallShapeViewModel[] {
  if (walls.length === 0) {
    return [];
  }

  let outlineById: ReadonlyMap<WallId, readonly Point[]>;

  try {
    const resolved = resolveDrawableWallShapes(walls.map((wall) => toGeometryWall(wall, level)));

    outlineById = new Map(resolved.shapes.map((shape) => [shape.wallId, shape.outline]));
  } catch {
    return [];
  }

  const shapes: WallShapeViewModel[] = [];

  for (const wall of walls) {
    const outline = outlineById.get(wall.id);

    if (outline !== undefined) {
      shapes.push({ id: wall.id, outline, statusCode: statusOf(wall) });
    }
  }

  return shapes;
}

/** Kết quả tách một tường, để hook biết lệnh tách có chạy được không trước khi gọi. */
export const canSplitWallAt = (wall: Wall, level: Level, at: Point, secondId: WallId): boolean =>
  splitWall(toGeometryWall(wall, level), toPointMm(at), secondId).ok;

/** Kết quả nối hai tường, cùng lý do như trên. */
export const canMergeWalls = (first: Wall, second: Wall, level: Level): boolean =>
  mergeWalls(toGeometryWall(first, level), toGeometryWall(second, level)).ok;

/* -------------------------------------------------------------------------- */
/* Quy đổi mm → px cho lớp canvas.                                             */
/* -------------------------------------------------------------------------- */

/*
 * Hợp đồng mở rộng của lớp canvas (`wallLayerHatch.ts#WallLayerCanvasViewProps`,
 * nhánh `mungvu2004/wlr-view-canvas`) nói rõ: MỌI toạ độ nó nhận đã là PIXEL
 * của ảnh bản vẽ, vì `<svg viewBox>` của nó lấy đúng khổ ảnh tính bằng pixel.
 * Quy đổi vì thế thuộc về hook, không thuộc về view (A15/R-60) — và nó không
 * phải một công thức tự chế: `scaleFromRatio(ratio).millimetresToPixels` của
 * `src/domain/units/scale.ts` là hàm duy nhất làm việc đó trong repo (R-61).
 */

/*
 * Bốn kiểu px NAY LẤY TỪ `wallLayerHatch.ts`, không khai lại.
 *
 * Chúng từng được chép thành hai bản vì hai worker viết song song trên hai
 * nhánh chưa gộp: bản này và bản của lớp canvas. Sau lượt gộp, hai bản chỉ còn
 * là hai chỗ để lệch nhau, nên bản gốc thắng — `wallLayerHatch.ts` là nơi hợp
 * đồng canvas được khai, và mọi nơi khác đọc nó.
 */
export type {
  WallLayerCanvasShape,
  WallLayerPointerReading,
  WallLayerRectPx,
  WallLayerSizePx,
  WallLayerViewportPx,
  WallLayerViewportRectPercent,
} from './wallLayerHatch';

/** Bộ quy đổi của một tầng. Tầng chưa hiệu chỉnh thì một pixel là một milimét. */
export const scaleOfLevel = (level: Level | null): Scale =>
  scaleFromRatio(level?.scaleMillimetresPerPixel ?? millimetresPerPixel(1));

/** Một điểm milimét của đồ thị, đọc trên ảnh bản vẽ. */
export const toPixelPoint = (point: Point, scale: Scale): Point => ({
  x: scale.millimetresToPixels(millimetres(point.x)),
  y: scale.millimetresToPixels(millimetres(point.y)),
});

/** Chiều ngược lại: một điểm trên ảnh bản vẽ, đọc ra milimét công trình. */
export const toMillimetrePoint = (point: Point, scale: Scale): Point => ({
  x: scale.pixelsToMillimetres(pixels(point.x)),
  y: scale.pixelsToMillimetres(pixels(point.y)),
});

/* -------------------------------------------------------------------------- */
/* Thanh trạng thái: toạ độ con trỏ.                                           */
/* -------------------------------------------------------------------------- */

/** Chưa có lượt đọc nào — dấu thiếu, KHÔNG phải "0; 0" (một số đo không ai đo). */
export const CURSOR_IDLE_LABEL = 'Chưa rê chuột lên bản vẽ';

/**
 * Một lượt đọc con trỏ → chuỗi toạ độ đã định dạng của thanh trạng thái.
 *
 * Toạ độ vào ĐÃ là pixel bản vẽ (trình duyệt đổi giúp, xem
 * {@link WallLayerPointerReading}), nên ở đây chỉ còn đúng một việc: pixel →
 * milimét bằng hàm của `src/domain/units/scale.ts`, rồi định dạng bằng
 * `formatPoint` — cùng hàm mà thanh tra dùng cho toạ độ đầu/cuối, nên hai chỗ
 * không thể lệch cách viết số (R-61).
 */
export function cursorLabelOf(reading: WallLayerPointerReading | null, scale: Scale): string {
  if (reading === null) {
    return CURSOR_IDLE_LABEL;
  }

  return formatPoint(toMillimetrePoint({ x: reading.xPx, y: reading.yPx }, scale));
}

/* -------------------------------------------------------------------------- */
/* Khung nhìn: mức phóng, "vừa khung", bản đồ nhỏ.                             */
/* -------------------------------------------------------------------------- */

/**
 * Giới hạn mức phóng — cùng hai đầu mà `viewSlice.setZoom` đã kẹp.
 *
 * Đọc lại ở đây để phép "vừa khung" không đề nghị một mức mà kho sẽ lặng lẽ kẹp
 * lại, khiến nhãn phần trăm nói một đằng còn khung nhìn một nẻo.
 */
export const MIN_WALL_LAYER_ZOOM = 0.1;
export const MAX_WALL_LAYER_ZOOM = 10;

/** Mỗi lượt bấm +/− đổi mức phóng một phần tư. */
export const ZOOM_STEP = 0.25;

/** Mức phóng gốc — nút phần trăm bấm được để về đây. */
export const DEFAULT_ZOOM = 1;

/**
 * Kẹp mức phóng vào hai đầu, KHÔNG gọi đối tượng toán học toàn cục.
 *
 * Thư mục màn phải qua được phép soát "không hàm hình học nào trong màn" (bản
 * nghiệm thu mục 7.3), nên hai phép so sánh viết thẳng thay cho hai hàm nhỏ
 * nhất/lớn nhất dựng sẵn. Kết quả giống hệt.
 */
export function clampZoom(zoom: number): number {
  if (zoom < MIN_WALL_LAYER_ZOOM) {
    return MIN_WALL_LAYER_ZOOM;
  }

  return zoom > MAX_WALL_LAYER_ZOOM ? MAX_WALL_LAYER_ZOOM : zoom;
}

/** Mức phóng → phần trăm nguyên cho `ZoomCluster` (A15: view không tự nhân trăm). */
export const zoomPercentOf = (zoom: number): number =>
  Number(formatNumber(zoom * ZOOM_PERCENT_PER_UNIT, { grouping: false, fractionDigits: 0 }));

/** Một lần phóng là một trăm phần trăm. */
const ZOOM_PERCENT_PER_UNIT = 100;

/** Thang vùng nhìn của `useMiniMap`: x/y/rộng/cao đều kẹp trong 0..100. */
const MINIMAP_VIEWPORT_SPAN = 100;

/** Vùng bản vẽ đang thấy (px) → vùng nhìn của bản đồ nhỏ, phần trăm khổ bản vẽ kẹp trong 0..100. */
export function miniMapRectOf(visible: WallLayerRectPx, drawing: WallLayerSizePx): WallLayerViewportRectPercent {
  const percent = (value: number, total: number): number =>
    Math.min(MINIMAP_VIEWPORT_SPAN, Math.max(0, (value / total) * MINIMAP_VIEWPORT_SPAN));
  const width = percent(visible.width, drawing.width);
  const height = percent(visible.height, drawing.height);

  return {
    x: Math.min(percent(visible.x, drawing.width), MINIMAP_VIEWPORT_SPAN - width),
    y: Math.min(percent(visible.y, drawing.height), MINIMAP_VIEWPORT_SPAN - height),
    width,
    height,
  };
}

/** Tâm của một hộp, đơn vị pixel bản vẽ. */
export const centreOfBounds = (bounds: WallLayerRectPx): Point => ({
  x: bounds.x + bounds.width / HALF,
  y: bounds.y + bounds.height / HALF,
});

const HALF = 2;

/**
 * Vùng nhìn của bản đồ nhỏ (phần trăm khổ bản vẽ) → tâm nhìn tính bằng milimét.
 *
 * `useMiniMap` làm việc bằng phần trăm 0..100 trên khổ bản đồ; khổ bản đồ là khổ
 * bản vẽ thu nhỏ, nên cùng một phần trăm đọc thẳng được trên khổ bản vẽ.
 */
export function miniMapCentreMm(
  rect: WallLayerViewportRectPercent,
  drawingSizePx: WallLayerSizePx,
  scale: Scale,
  origin: Point = { x: 0, y: 0 },
): Point {
  /*
   * Phép chia dưới đây KHÔNG phải quy đổi đơn vị đo, nên nó không thuộc về
   * `src/domain` như `local/no-raw-number` vốn đòi: `MINIMAP_VIEWPORT_SPAN` là
   * THANG mà `useMiniMap` tự kẹp vùng nhìn vào (`useMiniMap.ts:49-50` kẹp x/y
   * trong 0..100), nên đây là đọc một PHẦN của thang ấy ra, cùng loại với việc
   * đọc một phần trăm tiến độ. Phép quy đổi đơn vị thật — pixel sang milimét —
   * nằm ở dòng cuối, và nó đi qua `scale.pixelsToMillimetres` của
   * `src/domain/units/scale.ts`, đúng chỗ luật chỉ tới.
   */
  const centrePx: Point = {
    x: origin.x + ((rect.x + rect.width / HALF) / MINIMAP_VIEWPORT_SPAN) * drawingSizePx.width,
    y: origin.y + ((rect.y + rect.height / HALF) / MINIMAP_VIEWPORT_SPAN) * drawingSizePx.height,
  };

  return toMillimetrePoint(centrePx, scale);
}

/**
 * Hộp bao của một chuỗi điểm.
 *
 * Không gọi lại được: `src/domain` có `BoundingBox` và `boxAround`/`marqueeBox`
 * (hai điểm), nhưng KHÔNG có hàm nào gấp một đa giác N đỉnh thành hộp bao —
 * `rg "boundsOf|BoundingBox" src/domain src/lib` chỉ ra hai hàm hai-điểm đó và
 * `boundsOfIds` của lớp ba chiều (`Box3` của three.js). Đây là một phép GẤP
 * bằng so sánh, không phải một công thức hình học có sẵn ở nơi khác, và nó
 * không gọi tới đối tượng toán học toàn cục.
 */
export function boundsOfPoints(points: readonly Point[]): WallLayerRectPx | null {
  const first = points[0];

  if (first === undefined) {
    return null;
  }

  let left = first.x;
  let right = first.x;
  let top = first.y;
  let bottom = first.y;

  for (const point of points) {
    left = point.x < left ? point.x : left;
    right = point.x > right ? point.x : right;
    top = point.y < top ? point.y : top;
    bottom = point.y > bottom ? point.y : bottom;
  }

  return { x: left, y: top, width: right - left, height: bottom - top };
}

/** Hộp bao của nhiều hộp bao — vùng bản đồ nhỏ phải vẽ. */
export function unionOfBounds(
  boxes: readonly WallLayerRectPx[],
): WallLayerRectPx | null {
  const corners: Point[] = [];

  for (const box of boxes) {
    corners.push({ x: box.x, y: box.y });
    corners.push({ x: box.x + box.width, y: box.y + box.height });
  }

  return boundsOfPoints(corners);
}

/**
 * Hình tường cho lớp canvas: đa giác, tim tường và hộp bao, tất cả bằng pixel.
 *
 * Đa giác vẫn tới từ `resolveWallShapes` (nguồn duy nhất), chỉ được đọc lại
 * bằng đơn vị mà `<svg viewBox>` của canvas dùng.
 */
export function toCanvasShapes(
  walls: readonly Wall[],
  level: Level,
  statusOf: (wall: Wall) => ViewStatusCode,
  wallCodes?: ReadonlyMap<string, string>,
  threshold: number = CONFIDENCE_SUGGESTED_THRESHOLD,
  suspectIds?: ReadonlySet<string>,
): readonly WallLayerCanvasShape[] {
  const scale = scaleOfLevel(level);
  const outlines = new Map(toWallShapes(walls, level, statusOf).map((shape) => [shape.id, shape]));
  const shapes: WallLayerCanvasShape[] = [];

  for (const wall of walls) {
    const shape = outlines.get(wall.id);

    if (shape === undefined) {
      continue;
    }

    const outline = shape.outline.map((point) => toPixelPoint(point, scale));
    const bounds = boundsOfPoints(outline);

    if (bounds === null) {
      continue;
    }

    shapes.push({
      id: wall.id,
      outline,
      statusCode: shape.statusCode,
      codeLabel: wallLabelOf(wall.id, wallCodes),
      thicknessMm: wall.thicknessMm,
      centrelinePx: {
        start: toPixelPoint(wall.centreline.start, scale),
        end: toPixelPoint(wall.centreline.end, scale),
      },
      boundsPx: bounds,
      /*
       * Tâm chấm cần chú ý, tính Ở ĐÂY chứ không ở view.
       *
       * `WallLayerShapeFigure.tsx` từng viết `boundsPx.x + boundsPx.width / 2`
       * ngay trong thuộc tính `cx` — một phép hình học trong màn, đúng thứ câu
       * "không một phép hình học nào ở đây" của `WallLayerCanvas.tsx` cấm.
       * `centreOfBounds` đã tồn tại và hook đã dùng nó cho "vừa khung", nên
       * chấm và khung nhìn nay đọc chung một phép.
       */
      attentionDotPx: centreOfBounds(bounds),
      isLowConfidence: isLowConfidence(wall, threshold, suspectIds),
      isReviewed: wall.reviewed,
      confidenceTier: wallConfidenceTierOf(wall.reviewed, isLowConfidence(wall, threshold, suspectIds), wall.confidence),
      isGlass: isGlassWall(wall),
    });
  }

  return shapes;
}

/** Khổ ảnh bản vẽ tính bằng pixel. `null` khi chưa có bản vẽ nào. */
export function drawingSizeOf(
  background: WallLayerBackground | undefined,
  level: Level | null,
): WallLayerSizePx | null {
  if (background === undefined || background.widthMm === null || background.heightMm === null) {
    return null;
  }

  const scale = scaleOfLevel(level);

  return {
    width: scale.millimetresToPixels(millimetres(background.widthMm)),
    height: scale.millimetresToPixels(millimetres(background.heightMm)),
  };
}

/**
 * Ba băng độ dày CÓ THẬT trên tầng.
 *
 * Không dùng `generateLegend` của P-07: `Legend` của nó là bảng đếm theo TOKEN
 * MÀU của một `ColoringMode` (`src/lib/coloring/legend.ts:441`), còn thứ lớp
 * canvas hỏi là ba băng độ dày — hai khái niệm khác nhau, và dựng một
 * `ColoringMode` giả chỉ để lọc ba con số là đi vòng cho xa hơn.
 */
export const legendLevelsOf = (walls: readonly Wall[]): WallLayerLegendLevels => ({
  /* So theo băng (dung sai của `wallThicknessBandOf`), không so khít: 218 mm vẫn thuộc băng 220. */
  levels: WALL_THICKNESS_COLOR_GROUPS.filter((group) => walls.some((wall) => wallThicknessColorGroupOf(wall.thicknessMm) === group)),
  hasUnbanded: walls.some((wall) => wallThicknessBandOf(wall.thicknessMm) === null),
});

/** Nhãn của khung canvas — "Mặt bằng Tầng 1 — 48 tường". */
export const canvasLabelOf = (level: Level | null, total: number): string =>
  `Mặt bằng ${level?.name ?? 'chưa xác định'} — ${formatNumber(total, { fractionDigits: 0 })} tường`;

/* -------------------------------------------------------------------------- */
/* Định dạng — A15, mọi con số thành chuỗi TRƯỚC khi rời khỏi hook.            */
/* -------------------------------------------------------------------------- */

/** Số chữ số thập phân của một chiều dài tim tường — "4.250,00 mm". */
const LENGTH_FRACTION_DIGITS = 2;

/** Độ dày, luôn ở milimét để một cột số thẳng hàng — "220 mm". */
export const formatThickness = (thicknessMm: number): string =>
  formatLength(thicknessMm, { unit: 'mm' });

/** Chiều dài tim tường — "4.250,00 mm", dấu phẩy thập phân (A15). */
export const formatCentrelineLength = (wall: Wall, level: Level, unit: ProjectLengthUnit = 'mm'): string =>
  formatLength(centrelineLength(toGeometryWall(wall, level)), {
    unit,
    fractionDigits: LENGTH_FRACTION_DIGITS,
  });

const NO_SCALE_LENGTH_TEXT = 'Chưa có — cần đặt tỷ lệ';

/**
 * MỘT quy tắc chiều dài cho danh sách và thanh tra (K16): milimét nguyên ("5.757"). Tỷ lệ máy đo
 * chưa xác nhận thì số vẫn hiện để soi (dải "tỷ lệ tạm" và "(tạm)" ở thanh tra đã nói, không lặp "≈" từng hàng);
 * tầng không đo được tỷ lệ (1 mm/px mặc định,
 * `project_default`) thì số vô nghĩa — `null`.
 */
export function wallLengthNumberOf(lengthMm: number, scaleStatus?: ScaleStatus, scaleSource?: ScaleSource): string | null {
  if (scaleStatus === 'unresolved' && isScaleMissing(scaleSource)) {
    return null;
  }

  const text = formatNumber(lengthMm, { fractionDigits: 0 });

  return text;
}

/** Ô "Chiều dài" của thanh tra: cùng số với cột "Dài, mm" của danh sách, thêm đơn vị và "(tạm)". */
export function wallLengthLabelOf(
  wall: Wall,
  level: Level,
  scaleStatus?: ScaleStatus,
  scaleSource?: ScaleSource,
  unit: ProjectLengthUnit = 'mm',
  scaleState?: WireScaleState,
): string {
  const number = wallLengthNumberOf(centrelineLength(toGeometryWall(wall, level)), scaleStatus, scaleSource);

  if (number === null) {
    return NO_SCALE_LENGTH_TEXT;
  }

  // R9: hậu tố theo trạng thái — "(tạm)" máy chủ cũ, "(ước lượng)", "(chưa xác định)"; đọc từ bản vẽ thì không.
  const suffix = SCALE_MEASURE_SUFFIX[scaleStateOf(scaleStatus, scaleSource, scaleState)];
  const isProvisional = suffix !== '';
  const text = unit === 'mm' ? `${number} mm` : `${isProvisional ? '≈' : ''}${formatCentrelineLength(wall, level, unit)}`;

  return `${text}${suffix}`;
}

/** Tỷ lệ của tầng — "12 mm/px". Tầng chưa hiệu chỉnh thì trả dấu thiếu, không phải "undefined". */
export const formatScaleLabel = (level: Level | null): string =>
  formatScaleDensity(level?.scaleMillimetresPerPixel);

/** Bộ đếm duyệt thành câu — "12/48 tường đã duyệt". */
export const reviewProgressLabel = (reviewedText: string, total: number): string =>
  `${reviewedText}/${formatNumber(total, { fractionDigits: 0 })} tường đã duyệt`;

/* -------------------------------------------------------------------------- */
/* Công cụ đo — số đo do `src/domain/measure` tính, màn chỉ đọc lại.           */
/* -------------------------------------------------------------------------- */

/**
 * Hai điểm milimét của bản vẽ → nhãn đo bằng pixel mà `MeasurementLabel` nhận.
 *
 * KHÔNG một phép hình học nào viết mới ở đây:
 * - khoảng cách là `measureDistance` của `src/domain/measure/measure.ts`, đúng
 *   hàm mà `MEASURE_TOOL` (`src/lib/tools/tools.ts`) gọi ở bước `complete`, nên
 *   nhãn trên canvas và số máy công cụ phát ra không thể lệch nhau;
 * - quy đổi mm → px là `scale.millimetresToPixels` qua {@link toPixelPoint};
 * - điểm giữa là {@link centreOfBounds} của hộp bao hai đầu ({@link boundsOfPoints}),
 *   hai hàm đã có sẵn và đã được hook dùng cho "vừa khung".
 */
export function toMeasurementPx(
  startMm: Point,
  endMm: Point,
  scale: Scale,
  state: MeasurementState,
  unit: ProjectLengthUnit = 'mm',
): WallLayerMeasurementPx {
  const startPx = toPixelPoint(startMm, scale);
  const currentPx = toPixelPoint(endMm, scale);
  const bounds = boundsOfPoints([startPx, currentPx]);
  const distance = measureDistance(toPointMm(startMm), toPointMm(endMm));

  return {
    state,
    startPx,
    currentPx,
    midPx: bounds === null ? null : centreOfBounds(bounds),
    distanceLabel: formatLength(distance.lengthMm, {
      unit,
      fractionDigits: LENGTH_FRACTION_DIGITS,
    }),
  };
}

/**
 * Kết quả `kind: 'measurement'` của máy công cụ → nhãn đo đã chốt.
 *
 * Chỉ `distance` có nghĩa ở màn này: `MEASURE_TOOL` là công cụ đo duy nhất màn
 * bật, và bốn loại đo còn lại của `src/domain/measure` (chuỗi, góc, diện tích,
 * cao độ) không có tool nào phát ra chúng ở đây. Loại khác trả `null` chứ không
 * bị vẽ nhầm thành một khoảng cách.
 */
export function measurementOutcomeToPx(
  measurement: Measurement,
  scale: Scale,
  unit: ProjectLengthUnit = 'mm',
): WallLayerMeasurementPx | null {
  if (measurement.kind !== 'distance') {
    return null;
  }

  const [from, to] = measurement.points;

  return toMeasurementPx({ x: from.x, y: from.y }, { x: to.x, y: to.y }, scale, 'committed', unit);
}

/* -------------------------------------------------------------------------- */
/* Viewmodel của một tường.                                                    */
/* -------------------------------------------------------------------------- */

/**
 * Độ dày này có nằm trong ba băng hệ thiết kế sơn được không.
 *
 * Ba băng đến từ {@link WALL_THICKNESS_CHOICES} của `types.ts` — hợp đồng đã
 * đóng băng của màn, không phải một danh sách viết tay ở đây (R-71).
 * `STANDARD_THICKNESSES_MM` của `src/domain/walls/cleanup.ts` là một danh sách
 * KHÁC (độ dày xây được: 100/150/200/220/300/400) và `types.ts` nói rõ bộ lọc
 * của màn này KHÔNG dùng nó — xem chú thích {@link WALL_THICKNESS_CHOICES}.
 */
export const isStandardThickness = (thicknessMm: number): boolean =>
  /* R-7: so trong dung sai chung (30 mm) như màn Chuẩn hoá độ dày, không so `===` — bản cũ báo ⚠ cả 81/81 tường. */
  isWithinThicknessTolerance(thicknessMm, WALL_THICKNESS_CHOICES);

/**
 * Tường này có dưới ngưỡng độ tin cậy của dự án không (N5 `confidenceThreshold`, BUG-354 — cùng nguồn
 * câu đếm của màn Xử lý, FIX-1603). Chưa đọc được cài đặt → `CONFIDENCE_SUGGESTED_THRESHOLD` (0,70).
 *
 * ## Vì sao KHÔNG phải `!== 'certain'`
 *
 * Bản trước hỏi "khác `certain`", tức gom cả băng `suggested` (0,70 ≤ x < 0,90)
 * vào diện gạch chéo. Hệ quả đo được: canvas và danh sách nói hai chuyện khác
 * nhau về cùng một tường — canvas gạch chéo theo `materialMap.isLowConfidence`,
 * vốn đã là `needsReview` (< 0,70), còn danh sách và bộ lọc "Chỉ hiện độ tin cậy
 * thấp" thì gạch theo < 0,90. Một tường 0,80 bị gạch trong danh sách và không
 * gạch trên bản vẽ.
 *
 * Một nguồn phân loại duy nhất: `WallRowViewModel.isLowConfidence`, bộ lọc
 * "Chỉ hiện độ tin cậy thấp" và gạch chéo của canvas đọc chung hàm này với cùng ngưỡng.
 */
export const isLowConfidence = (
  wall: Wall,
  threshold: number = CONFIDENCE_SUGGESTED_THRESHOLD,
  suspectIds?: ReadonlySet<string>,
): boolean => wall.confidence < threshold || suspectIds?.has(wall.id) === true;

const NO_SUSPECTS: ReadonlySet<string> = new Set();

/**
 * Tường máy "chưa chắc" theo hình (UX-R2 K21/K26), cùng luật Hình học màn Quy chuẩn chạy: cắt
 * chéo hoặc chồng lên tường khác (cả hai tường), có đầu không nối vào đâu, hoặc dài hơn 0 mà ngắn
 * hơn bề dày của nó (tường vụn). Tường xiên một mình KHÔNG bị gắn cờ.
 */
export function geometrySuspectIdsOf(graph: NormalizedSpatial | null, levelId: Level['id'] | null): ReadonlySet<string> {
  if (graph === null || levelId === null) {
    return NO_SUSPECTS;
  }

  return new Set(geometryReasonsOf(graph, levelId).keys());
}

/** Lý do máy nghi một đoạn theo hình. Một đoạn mang một lý do, theo thứ tự ưu tiên ngắn → không nối → chồng. */
export type WallGeometryReason = 'short' | 'dangling' | 'overlap';

const NO_REASONS: ReadonlyMap<string, WallGeometryReason> = new Map();

/** Cùng ba kiểm của `geometrySuspectIdsOf`, giữ thêm lý do để hàng đợi L23 chia nhóm theo lý do. */
export function geometryReasonsOf(graph: NormalizedSpatial | null, levelId: Level['id'] | null): ReadonlyMap<string, WallGeometryReason> {
  if (graph === null || levelId === null) {
    return NO_REASONS;
  }

  const context = { graph, levelId };
  const reasons = new Map<string, WallGeometryReason>();
  const add = (id: string, reason: WallGeometryReason) => {
    if (!reasons.has(id)) reasons.set(id, reason);
  };

  for (const wall of entitiesInScope(context, 'wall')) {
    const lengthMm = Math.hypot(wall.centreline.end.x - wall.centreline.start.x, wall.centreline.end.y - wall.centreline.start.y);

    if (lengthMm > 0 && lengthMm < wall.thicknessMm) {
      add(wall.id, 'short');
    }
  }

  for (const finding of checkDanglingWallEnds(context)) {
    add(finding.entityId, 'dangling');
  }

  for (const finding of checkWallOverlap(context)) {
    finding.relatedIds.forEach((id) => add(id, 'overlap'));
  }

  return reasons;
}

/**
 * Trạng thái màu của một tường.
 *
 * Nền là `toWallViewModel(wall).statusCode` (A5: `verified` chỉ tới từ
 * `reviewed`, không bao giờ từ điểm số của AI). Thêm đúng một điều màn này biết
 * mà viewmodel chung không biết: một tường chưa duyệt có độ dày ngoài ba băng
 * cũng là thứ người duyệt đang đi tìm, nên nó lên `attention`.
 */
export function wallStatusCode(wall: Wall): ViewStatusCode {
  const base = toWallViewModel(wall).statusCode;

  if (base === 'neutral' && !wall.reviewed && !isStandardThickness(wall.thicknessMm)) {
    return 'attention';
  }

  return base;
}

/** Một dòng của danh sách 48 tường. */
export function toWallRow(
  wall: Wall,
  wallCodes?: ReadonlyMap<string, string>,
  threshold: number = CONFIDENCE_SUGGESTED_THRESHOLD,
  suspectIds?: ReadonlySet<string>,
): WallRowViewModel {
  return {
    id: wall.id,
    codeLabel: wallLabelOf(wall.id, wallCodes),
    thicknessMm: wall.thicknessMm,
    thicknessLabel: formatThickness(wall.thicknessMm),
    confidence: wall.confidence,
    statusCode: wallStatusCode(wall),
    isReviewed: wall.reviewed,
    isLowConfidence: isLowConfidence(wall, threshold, suspectIds),
    isNonStandardThickness: !isStandardThickness(wall.thicknessMm),
  };
}

/** U48: "(đã sửa, máy đo 221)" khi người đã đổi độ dày khỏi số máy đo. */
export function detectedNoteOf(wall: Wall): string | null {
  const detected = wall.detectedThicknessMm;

  if (detected === undefined || Math.round(detected) === Math.round(wall.thicknessMm)) {
    return null;
  }

  const measured = formatNumber(detected, { fractionDigits: 0 });

  /* UX-16: chỉ nói "đã sửa" khi người đã đụng vào; máy đổi thì chỉ nêu số máy đo (không "làm tròn" — số có thể không ở thang). */
  return wall.source === 'human' ? `(đã sửa, máy đo ${measured})` : `(máy đo ${measured})`;
}

/** UX-35: tường dài hơn 3 m xoá phải hỏi lại. */
const LONG_WALL_MM = 3000;

/** Thanh tra tường đang chọn. Mọi con số đã thành chuỗi ở đây, không ở view (A15). */
export function toWallInspector(
  wall: Wall,
  level: Level,
  wallCodes?: ReadonlyMap<string, string>,
  scaleStatus?: ScaleStatus,
  unit: ProjectLengthUnit = 'mm',
  scaleSource?: ScaleSource,
  threshold: number = CONFIDENCE_SUGGESTED_THRESHOLD,
  suspectIds?: ReadonlySet<string>,
  scaleState?: WireScaleState,
): WallInspectorViewModel {
  return {
    id: wall.id,
    codeLabel: wallLabelOf(wall.id, wallCodes),
    thicknessMm: wall.thicknessMm,
    detectedNote: detectedNoteOf(wall),
    isLongWall: centrelineLength(toGeometryWall(wall, level)) > LONG_WALL_MM,
    /* Cùng quy tắc với cột "Dài, mm" của danh sách: tỷ lệ tạm "≈… (tạm)", thiếu tỷ lệ thì nói rõ (K16). */
    lengthLabel: wallLengthLabelOf(wall, level, scaleStatus, scaleSource, unit, scaleState),
    /*
     * Chiều cao ở CÙNG cột milimét với chiều dài.
     *
     * `formatLength` tự đổi sang mét từ 1 m trở lên (`src/lib/format/measure.ts`),
     * nên `formatLength(3000)` ra "3,00 m" — một đơn vị khác hẳn dòng ngay trên
     * nó. Đặc tả đòi hai dòng đọc được cạnh nhau, nên đơn vị nói thẳng ra, và
     * số chữ số thập phân dùng lại đúng hằng của chiều dài (R-71).
     */
    /* G4a-15: milimét là số nguyên — không "3.600,00 mm". */
    heightLabel: formatLength(wall.heightMm, {
      unit,
      fractionDigits: unit === 'mm' ? 0 : 2,
    }),
    confidence: wall.confidence,
    /* Cùng bậc với thẻ, chú giải và danh sách: "chưa chắc" gồm cả tường sai hình; số "0,50" để ở phần nâng cao (K16). */
    confidenceText: WALL_CONFIDENCE_TIER_TEXT[wallConfidenceTierOf(wall.reviewed, isLowConfidence(wall, threshold, suspectIds), wall.confidence)],
    kindLabel: WALL_KIND_LABELS[wall.kind],
    isGlass: isGlassWall(wall),
    advanced: {
      confidenceLabel: formatNumber(wall.confidence, { fractionDigits: 2 }),
      elevationOffsetLabel: formatElevationM(level.elevationMm),
      startPointLabel: formatPoint(wall.centreline.start),
      endPointLabel: formatPoint(wall.centreline.end),
    },
  };
}

/** Ba lựa chọn độ dày, xuất lại để hook cấp thẳng cho view (R-60). */
export const WALL_LAYER_THICKNESS_CHOICES: readonly WallThicknessChoice[] =
  WALL_THICKNESS_CHOICES;
