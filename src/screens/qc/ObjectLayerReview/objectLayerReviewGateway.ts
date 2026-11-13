/**
 * Cổng dữ liệu và tầng lệnh của màn S-13 "Lớp đối tượng" — mọi lời gọi ra khỏi
 * màn đi qua đây.
 *
 * Cùng khuôn `wallLayerReviewGateway.ts` của màn QC anh em: một danh sách khả
 * năng, một bản kê nợ endpoint, một `interface` cho hình dạng cổng, một factory
 * dựng cổng thật và một factory dựng cổng có dữ liệu cho test và story (R-73).
 *
 * ## Đường ghi — `dispatch` chạy qua `commit`
 *
 * Lệnh nghiệp vụ S-07 đi qua `dispatch` (S-05, năm bước
 * `validate → apply → history → rules → sync`), và `SpatialPort.applyPatches`
 * được cài bằng `commit(patches, label)` của `src/store/commit.ts`. Nhờ vậy màn
 * có rule chạy lại sau mỗi lệnh, ngăn xếp hoàn tác 100 bước của S-06, đồng bộ
 * S-11, và **không phạm A10**: không dòng nào gọi `set()` hay `_applyPatches()`.
 *
 * ## Ba lệnh còn thiếu — dựng bằng nguyên thuỷ công khai
 *
 * `OPENING_COMMAND_TYPES` (`openingCommands.ts:83-92`) chỉ có tám lệnh và
 * **không có** lệnh đổi loại, đổi chiều mở hay duyệt. Điều phối viên đã duyệt
 * (QĐ-3) cách dựng bằng `createCommand` + `changeForUpdate`, hợp lệ vì
 * `CommandType` là `string` mở và `validateCommands` chỉ kiểm `command.type`
 * khác rỗng, không so với một bảng cho phép. Lệnh tự hoàn tác được vì
 * `changeForUpdate` mang ĐỦ ảnh chụp `before`/`after`, và `invertCommand` chỉ
 * hoán đổi hai ảnh đó — không cần thêm một dòng nào cho `Ctrl+Z`.
 *
 * **A5 ép ngay ở kiểu dựng lệnh:** {@link buildApproveObjectCommand} là đường
 * DUY NHẤT đặt `reviewed: true`, và nó luôn đặt kèm `source: 'human'`. Không có
 * tham số nào cho phép người gọi truyền `source`, nên đầu ra AI không có đường
 * nào bật được cờ xanh "đã xác minh".
 *
 * ## Hình học: GỌI LẠI M-08 / M-09, không tự tính
 *
 * Không một phép gắn, kiểm chồng lấn hay chiếu vị trí nào viết mới ở đây.
 * `attachToWall`, `placeOnWall`, `openingCentre`, `validateOpening`,
 * `validateOpenings`, `openingSpan`, `findOrphans` của `src/domain/openings`
 * là nguồn duy nhất (M-08); `reflowOpenings` là nguồn duy nhất khi tường đổi
 * (M-09). Quy đổi giữa fraction của domain và `offsetMm` của đồ thị dùng
 * `relativePositionOf` / `offsetOnWall` / `toAttachedOpening` của
 * `src/lib/commands/business/shared.ts` — ba hàm đã có, không chép lại công
 * thức (R-61).
 *
 * ## Đọc và lưu
 *
 * - Lưu lớp của tầng qua #35 nằm ở `useFloorLayerAutosave` (một bộ lưu mỗi
 *   người–dự án, F-04x-1); cổng chỉ lộ `apiClient`. Cờ
 *   `supports.persistObjectLayer` giữ nghĩa "cổng này có đường lưu".
 * - `readObjectGraph` — đồ thị sống trong `src/store`, không có endpoint nào
 *   trả nó. Cổng đọc qua một cửa tiêm được, mặc định là chính store.
 */

import { readFloorLayerRead, type FloorLayerGraphRead } from '@/api/floorLayerGraph';

import type { ApiClient } from '@/api/client';
import type { FloorLayerDocument } from '@/api/schemas/spatialLayer';
import { createAppApiClient } from '@/api/appClient';
import { counterLabelOf, createId, displayCodesOf } from '@/domain/spatial/ids';
import { normalizeSpatial, type NormalizedSpatial } from '@/domain/spatial/normalize';
import type {
  Building,
  Furniture,
  FurnitureId,
  FurnitureKind,
  FurnitureVariant,
  Level,
  Opening as GraphOpening,
  OpeningId,
  LevelId,
  Point,
  ReviewMetadata,
  SpatialGraph,
  SwingDirection,
  Wall as GraphWall,
  WallId,
} from '@/domain/spatial/types';
import { isFurnitureVariant } from '@/domain/spatial/types';
import { millimetresPerPixel, pixels, scaleFromRatio, type Scale } from '@/domain/units/scale';
import { millimetres, type MillimetresPerPixel } from '@/domain/units/types';
import {
  attachToWall,
  DEFAULT_ATTACH_RADIUS_MM,
  openingCentre,
  placeOnWall,
  type OpeningAttachment,
} from '@/domain/openings/attach';
import {
  findOrphans,
  openingSpan,
  OPENING_RULES,
  validateOpening,
  validateOpenings,
  type OpeningSpan,
  type OpeningViolation,
  type OrphanReport,
} from '@/domain/openings/validate';
import { reflowOpenings, type ReflowResult } from '@/domain/openings/reflow';
import type {
  AttachedOpening,
  Opening as DomainOpening,
  OpeningKind as DomainOpeningKind,
  OrphanOpening,
  RelativePosition,
  TracedOpening,
} from '@/domain/openings/types';
import { AT_WALL_END, AT_WALL_START, clampRelativePosition } from '@/domain/openings/types';
import { resolveDrawableWallShapes } from '@/domain/walls/joints';
import { centrelineLength, type Wall as SolidWall } from '@/domain/walls/types';
import {
  createAddFurnitureCommand,
  createAddOpeningCommand,
  createDeleteFurnitureCommand,
  createDeleteOpeningCommand,
  createMoveFurnitureCommand,
  createMoveOpeningCommand,
  createResizeOpeningCommand,
  createRotateFurnitureCommand,
  type AddFurnitureInput,
  type AddOpeningInput,
  type DeleteFurnitureInput,
  type DeleteOpeningInput,
  type MoveFurnitureInput,
  type MoveOpeningInput,
  type ResizeOpeningInput,
  type RotateFurnitureInput,
} from '@/lib/commands/business/openingCommands';
import { createResizeFurnitureCommand, type ResizeFurnitureInput } from '@/lib/commands/business/furnitureResize';
import {
  accept,
  entitiesOfKind,
  FURNITURE_KIND_LABELS,
  offsetOnWall,
  openingsOfWall,
  refuse,
  relativePositionOf,
  toAttachedOpening,
  toPoint,
  toPointMm,
  toSolidWall,
  type CommandContext,
  type CommandResult,
} from '@/lib/commands/business/shared';
import { changeForUpdate, createCommand } from '@/lib/commands/createCommand';
import type { Command } from '@/lib/commands/types';
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
import { mergeCommandRun, MERGE_WINDOW_MS } from '@/lib/commands/mergeCommands';
import { runTransaction } from '@/lib/commands/transaction';
import {
  coalesce,
  COALESCE_WINDOW_MS,
  type CoalescedCommand,
  type Command as SyncCommand,
} from '@/lib/mutations/coalesce';
import { createUndoTicket, UNDO_WINDOW_MS, type UndoTicket } from '@/lib/mutations/undoTicket';
import { generateLegend, type Legend } from '@/lib/coloring/legend';
import { createColoringMode, type ColoringMode, type PaintSubject } from '@/lib/coloring/modes';
import { createLookupScale, type ColorTokenName } from '@/lib/coloring/scales';
import { wallBearing } from '@/domain/walls/edit';
import { swingDirectionOf } from '@/lib/pascal/swingDirection';
import type { MeasurementState } from '@/hooks/useMeasurementLabel';
import { readProjectConfidenceThreshold, type ReadConfidenceThreshold } from '@/hooks/useProjectConfidenceThreshold';
import { boxAround } from '@/lib/input/dragDrop';
import { formatLength } from '@/lib/format/measure';
import { formatNumber } from '@/lib/format/number';
import { confidenceLevel } from '@/lib/format/semantic';
import { measureTextOfState, type ScaleState } from '@/lib/viewmodel/provisionalScale';
import type { ViewStatusCode } from '@/lib/viewmodel/types';
import { applyRollbackPatches, commit } from '@/store/commit';
import { useStore } from '@/store';

import { mockFloorLayerDocument } from '../shared/mockFloorLayerDocument';

import {
  countObjectsByLayer,
  entityIdOf,
  isOrphanObject,
  isUnattachedOpening,
  OBJECT_LAYER_IDS,
  OBJECT_SUBTYPE_LABELS,
  OBJECT_SUBTYPE_LAYER,
  type AttachedReviewObject,
  type HostWallOutlineViewModel,
  type ObjectInspectorViewModel,
  type ObjectLayerCounts,
  type ObjectLayerId,
  type ObjectLayerVisibility,
  type ObjectDragMeasurement,
  type ObjectListRowViewModel,
  type ObjectPlacementViewModel,
  type PixelPoint,
  type PixelRect,
  type ObjectReviewCounter,
  type ObjectSubtype,
  type OrphanReviewObject,
  type ReviewObject,
  FURNITURE_VARIANT_OPTIONS,
} from './objectLayerTypes';
import { OBJECT_LAYER_FIXTURE_OBJECTS } from './objectLayerFixture';
import {
  WALL_LAYER_FIXTURE_BUILDING,
  WALL_LAYER_FIXTURE_LEVEL,
  WALL_LAYER_FIXTURE_WALLS,
} from '../WallLayerReview/wallLayerReviewFixture';

/* -------------------------------------------------------------------------- */
/* Khả năng — những gì màn hỏi thế giới bên ngoài.                             */
/* -------------------------------------------------------------------------- */

/** Tên máy đọc của từng việc màn cần. Mỗi việc chưa làm được có một dòng nợ. */
export const OBJECT_LAYER_CAPABILITIES = [
  'readBackground',
  'readObjectGraph',
  'writeObjectGraph',
  'persistObjectLayer',
] as const;

export type ObjectLayerCapability = (typeof OBJECT_LAYER_CAPABILITIES)[number];

/** Việc trong danh sách trên mà bản cài đặt THẬT chưa làm được. Chỉ được ngắn đi. */
export const OBJECT_LAYER_MISSING_CAPABILITIES = [] as const;

export type ObjectLayerMissingCapability = (typeof OBJECT_LAYER_MISSING_CAPABILITIES)[number];

/** Endpoint còn thiếu của từng khả năng, viết nguyên văn cho người nối dây sau. */
export const OBJECT_LAYER_MISSING_ENDPOINTS: Readonly<
  Record<ObjectLayerMissingCapability, string>
> = {};

/** Một khả năng chưa tồn tại. `supported: false` là câu trả lời thật, không phải lỗi. */
export interface ObjectLayerUnsupported {
  readonly supported: false;
  readonly capability: ObjectLayerMissingCapability;
  /** Lấy nguyên từ {@link OBJECT_LAYER_MISSING_ENDPOINTS}. */
  readonly missing: string;
}

export interface ObjectLayerSupported<TValue> {
  readonly supported: true;
  readonly value: TValue;
}

export type ObjectLayerCapabilityResult<TValue> =
  | ObjectLayerSupported<TValue>
  | ObjectLayerUnsupported;

/** Dựng nhánh "chưa có đường làm việc này" — một chỗ duy nhất ghép tên với nợ. */
export function unsupported(capability: ObjectLayerMissingCapability): ObjectLayerUnsupported {
  return {
    supported: false,
    capability,
    missing: OBJECT_LAYER_MISSING_ENDPOINTS[capability],
  };
}

/* -------------------------------------------------------------------------- */
/* Hằng của bộ mẫu — mã hiển thị, mã máy, và ba con số của đặc tả.             */
/* -------------------------------------------------------------------------- */

/**
 * Cao độ bệ cửa của một cửa sổ mới đổi loại — đặc tả gốc: "cửa sổ 900".
 *
 * `OPENING_RULES` chỉ có DẢI hợp lệ (`windowSillMinMm` 400 … `windowSillMaxMm`
 * 1500) chứ không có giá trị mặc định, nên con số này phải được đặt tên ở đây —
 * đúng một chỗ (R-71) — và nó nằm trong dải đó. Cửa đi thì lấy thẳng
 * `OPENING_RULES.doorSillHeightMm` (0), không viết lại.
 */
const WINDOW_SILL_HEIGHT_MM = 900;

/** Chiều mở mặc định của một lỗ mở vừa đổi thành cửa đi một cánh. */
const DEFAULT_DOOR_SWING: SwingDirection = 'left';

/** Chiều mở của một cửa đi hai cánh. */
const DOUBLE_DOOR_SWING: SwingDirection = 'double';

/** Cửa sổ không có cánh mở quay — nó cố định trên tường. */
const DEFAULT_WINDOW_SWING: SwingDirection = 'fixed';

/** Góc xoay của một món nội thất áp tường trong bộ mẫu. */
const FURNITURE_ROTATION_DEG = 0;

/** Nội thất không có cánh mở — `ReviewObjectCore.swing` của nó luôn là `'fixed'`. */
const FURNITURE_SWING: SwingDirection = 'fixed';

/**
 * Ngưỡng "cần chú ý" của màn — 0,75.
 *
 * Con số này là YÊU CẦU SẢN PHẨM, không phải một băng của hệ thiết kế: đặc tả
 * gốc và bản nghiệm thu đều đếm "5 mục dưới ngưỡng 0,75", và bộ mẫu
 * (`objectLayerFixture.ts`) dựng đúng năm mục đó. Hai băng có sẵn của
 * `confidenceLevel` (`@/lib/format/semantic`) cắt ở 0,90 và 0,70 nên không băng
 * nào cho ra năm — dùng chúng làm bộ lọc sẽ cho 10 hoặc 3, tức là một con số
 * KHÁC con số đặc tả đòi in ra.
 *
 * Nên ngưỡng được đặt tên ở đây, ĐÚNG MỘT CHỖ (R-71), và chỉ dùng cho câu hỏi
 * "mục nào cần người duyệt xem lại". Câu hỏi khác — MÀU của một đối tượng —
 * vẫn đi qua `confidenceLevel` (xem {@link objectStatusCode}), vì màu là việc
 * của hệ thiết kế còn bộ lọc là việc của quy trình duyệt.
 */
export const OBJECT_LAYER_CONFIDENCE_THRESHOLD = 0.75;

/**
 * Đối tượng này có dưới ngưỡng "cần chú ý" không? Ngưỡng là của DỰ ÁN (N5) khi đọc được —
 * 0,75 ở trên là mặc định khi chưa có (G32 17-C-009, như BUG-354 ở các màn khác).
 */
export const isLowConfidenceObject = (
  confidence: number,
  threshold: number = OBJECT_LAYER_CONFIDENCE_THRESHOLD,
): boolean => confidence < threshold;

/**
 * Nhãn người đọc của một mã tường: `W-000014WALL` → `W-014`.
 *
 * Thuần cắt chuỗi, cùng khuôn `wallDisplayCode` của màn tường: mã máy phải dài
 * (thân ≥ 10 ký tự) để tầng lệnh nhận, còn nhãn thanh tra thì đặc tả đòi đúng
 * "#W-014".
 */
export function hostWallDisplayCode(id: string): string {
  return counterLabelOf(id);
}

/** Mã máy suy từ mã hiển thị — khai ở hợp đồng kiểu, xuất lại cho nơi gọi cũ. */
export { entityIdOf };

/* -------------------------------------------------------------------------- */
/* Bộ mẫu — 21 đối tượng của `objectLayerFixture.ts` thành một đồ thị thật.     */
/* -------------------------------------------------------------------------- */

/**
 * Tầng và tường của bộ mẫu.
 *
 * KHÔNG dựng một lưới tường thứ hai: bộ mẫu 48 tường của màn QC anh em đã là
 * một mặt bằng hợp lệ (mọi nút giao khép 0 mm, `resolveWallShapes` giải được),
 * và `objectLayerFixture.ts` đã đặt `hostWallId` theo đúng mã hiển thị của lưới
 * đó — xem ghi chú "Mã tường chủ chỉ là mã HIỂN THỊ" ở đầu bộ mẫu. Dựng lại
 * lưới lần thứ hai chỉ tạo ra một chỗ để hai bộ số lệch nhau.
 */
export const OBJECT_LAYER_SAMPLE_LEVEL: Level = WALL_LAYER_FIXTURE_LEVEL;

/** Toà nhà của bộ mẫu — dùng lại, cùng lý do như tầng. */
const OBJECT_LAYER_SAMPLE_BUILDING: Building = WALL_LAYER_FIXTURE_BUILDING;

/** Tra tường thật theo mã hiển thị: `"W-014"` → tường `W-000014WALL`. */
const WALL_BY_DISPLAY_CODE: ReadonlyMap<string, GraphWall> = new Map(
  WALL_LAYER_FIXTURE_WALLS.map((wall) => [hostWallDisplayCode(wall.id), wall] as const),
);

/**
 * Loại đồ đạc của đồ thị cho từng loại con của màn.
 *
 * Ánh xạ KHÔNG một-một: `FurnitureKind` chỉ có mười giá trị và cả bồn cầu lẫn
 * chậu rửa đều là `sanitaryFixture`. Vì vậy `subtype` của một món nội thất
 * sống trong {@link OBJECT_LAYER_SEED} chứ không đọc ngược từ đồ thị — nó là
 * kết quả phân loại của AI, và màn này không có lệnh nào sửa nó (ba lệnh QĐ-3
 * đều là lệnh của LỖ MỞ).
 */
const FURNITURE_KIND_BY_SUBTYPE: Readonly<Record<ObjectSubtype, FurnitureKind>> = {
  singleDoor: 'other',
  doubleDoor: 'other',
  window: 'other',
  bed: 'bed',
  sofa: 'chair',
  diningTable: 'table',
  toilet: 'sanitaryFixture',
  basin: 'sanitaryFixture',
  otherFurniture: 'other',
};

/**
 * Loại con của một món nội thất KHÔNG có dòng mẫu, đọc từ `FurnitureKind` của đồ thị
 * (B-V6-13).
 *
 * Chỉ `bed` trùng nghĩa tuyệt đối với một loại con; mọi kind khác thành "nội thất
 * khác" chứ không bị ẩn. `table` → `diningTable` bị bác vì "bàn ăn" thêm một thông
 * tin miền không có (cùng lý do `chair` không thành `sofa`) — đổi lại chỉ là một dòng.
 * `Record` đủ khoá: thêm một `FurnitureKind` mà quên dòng ở đây là lỗi biên dịch.
 */
const SUBTYPE_BY_FURNITURE_KIND: Readonly<Record<FurnitureKind, ObjectSubtype>> = {
  bed: 'bed',
  table: 'otherFurniture',
  chair: 'otherFurniture',
  sanitaryFixture: 'otherFurniture',
  washingMachine: 'otherFurniture',
  shower: 'otherFurniture',
  wardrobe: 'otherFurniture',
  kitchenCabinet: 'otherFurniture',
  stair: 'otherFurniture',
  other: 'otherFurniture',
};

/**
 * Một dòng bộ mẫu đã nối được mã hiển thị với mã máy.
 *
 * Đây là NGUYÊN LIỆU, không phải viewmodel: `reviewed`, `confidence`, vị trí và
 * kích thước sau lượt sửa đầu tiên đọc từ ĐỒ THỊ chứ không từ đây. Cái duy nhất
 * chỉ có ở đây là `subtype` của nội thất (xem {@link FURNITURE_KIND_BY_SUBTYPE})
 * và toạ độ dò được của đối tượng chưa gắn tường.
 */
export interface ObjectSeedEntry {
  readonly displayId: string;
  readonly entityId: string;
  readonly layer: ObjectLayerId;
  readonly subtype: ObjectSubtype;
  readonly widthMm: number;
  readonly heightMm: number;
  readonly sillHeightMm: number | null;
  readonly swing: SwingDirection;
  readonly confidence: number;
  readonly reviewed: boolean;
  /** Nguồn của thực thể; vắng thì suy từ `reviewed` (bộ mẫu cũ). */
  readonly source?: ReviewMetadata['source'];
  /** Tường chủ lúc dò ra (mã máy). `null` ở đối tượng chưa gắn được vào tường nào. */
  readonly hostWallId: WallId | null;
  readonly relativePosition: RelativePosition | null;
  /** Toạ độ tuyệt đối lúc dò. `null` ở đối tượng đã gắn. */
  readonly tracedCentre: Point | null;
}

/** Tường chủ của một dòng bộ mẫu, hoặc `null` khi mã hiển thị không tra được. */
const hostWallOf = (object: ReviewObject): GraphWall | null =>
  object.hostWallId === null ? null : (WALL_BY_DISPLAY_CODE.get(object.hostWallId) ?? null);

/** Một dòng bộ mẫu, đã nối mã. */
function toSeedEntry(object: ReviewObject): ObjectSeedEntry {
  const host = hostWallOf(object);

  return {
    displayId: object.id,
    entityId: object.entityId,
    layer: object.layer,
    subtype: object.subtype,
    widthMm: object.widthMm,
    heightMm: object.heightMm,
    sillHeightMm: object.sillHeightMm,
    swing: object.swing,
    confidence: object.confidence,
    reviewed: object.reviewed,
    hostWallId: host?.id ?? null,
    relativePosition: isOrphanObject(object) ? null : object.relativePosition,
    tracedCentre: isOrphanObject(object) ? object.tracedCentre : null,
  };
}

/** 21 dòng bộ mẫu — 9 cửa đi, 7 cửa sổ, 5 nội thất. Thứ tự giữ nguyên của bộ mẫu. */
export const OBJECT_LAYER_SEED: readonly ObjectSeedEntry[] =
  OBJECT_LAYER_FIXTURE_OBJECTS.map(toSeedEntry);

/** Tường của bộ mẫu, dạng hình học của `src/domain/walls`. */
export const solidWallOf = (wall: GraphWall, level: Level): SolidWall => toSolidWall(wall, level);

/**
 * Ảnh chụp lỗ mở đúng như domain M-08 muốn, dựng từ một dòng bộ mẫu.
 *
 * `offsetMm` của đồ thị (khoảng cách từ đầu tim tường tới MÉP TRÁI) suy ra từ
 * fraction bằng `offsetOnWall` của `shared.ts` — hàm đã có, không viết lại phép
 * quy đổi (R-61, và cảnh báo số 6 của hợp đồng T1).
 */
function attachedOpeningOf(entry: ObjectSeedEntry, wall: SolidWall): AttachedOpening {
  return {
    id: entry.entityId as OpeningId,
    kind: entry.layer === 'window' ? 'window' : 'door',
    widthMm: millimetres(entry.widthMm),
    heightMm: millimetres(entry.heightMm),
    sillHeightMm: millimetres(entry.sillHeightMm ?? OPENING_RULES.doorSillHeightMm),
    swing: entry.swing,
    wallId: wall.id,
    relativePosition: entry.relativePosition ?? clampRelativePosition(0),
  };
}

/**
 * Nguồn dữ liệu của một thực thể: giữ `source` của thực thể gốc (FIX-P0-14); chỉ khi không có
 * (bộ mẫu cũ) mới suy từ `reviewed`. Đồ người vẽ chưa duyệt không được hạ về `'ai'`.
 */
const sourceOf = (entry: {
  readonly reviewed: boolean;
  readonly source?: ReviewMetadata['source'];
}): ReviewMetadata['source'] => entry.source ?? (entry.reviewed ? 'human' : 'ai');

/** Siêu dữ liệu duyệt của một thực thể (A5). */
const reviewMetadataOf = (entry: ObjectSeedEntry): ReviewMetadata => ({
  confidence: entry.confidence,
  source: sourceOf(entry),
  reviewed: entry.reviewed,
});

/**
 * Đồ thị bộ mẫu: 48 tường, 15 lỗ mở đã gắn, 5 món nội thất.
 *
 * Đối tượng CHƯA GẮN (`D-009`) cố ý KHÔNG có mặt trong đồ thị: `Opening` của đồ
 * thị bắt buộc có `wallId`, nên "chưa gắn vào tường nào" không có chỗ đứng ở đó
 * — đúng lý do `src/domain/openings` mới là nơi mô hình hoá orphan. Nó sống
 * trong {@link OBJECT_LAYER_SEED} với `tracedCentre`, và `findOrphans` là hàm
 * báo cáo nó (M-08). Khi người duyệt bấm "Gắn vào tường gần nhất" thì lệnh
 * `opening.add` của S-07 tạo nó trong đồ thị VỚI ĐÚNG mã máy đã dành sẵn, nên
 * `Ctrl+Z` đưa nó về lại trạng thái chưa gắn mà không cần một bảng ánh xạ nào
 * phải giữ đồng bộ.
 */
export function buildObjectLayerGraph(
  seed: readonly ObjectSeedEntry[] = OBJECT_LAYER_SEED,
): NormalizedSpatial {
  const level = OBJECT_LAYER_SAMPLE_LEVEL;
  const openings: GraphOpening[] = [];
  const furniture: Furniture[] = [];
  const openingIdsByWall = new Map<WallId, OpeningId[]>();

  for (const entry of seed) {
    if (entry.hostWallId === null || entry.relativePosition === null) {
      continue;
    }

    const wall = WALL_LAYER_FIXTURE_WALLS.find((candidate) => candidate.id === entry.hostWallId);

    if (wall === undefined) {
      continue;
    }

    const solid = solidWallOf(wall, level);

    if (entry.layer === 'furniture') {
      const centre = toPoint(placeOnWall(solid, entry.relativePosition));

      furniture.push({
        id: entry.entityId as FurnitureId,
        levelId: level.id,
        kind: FURNITURE_KIND_BY_SUBTYPE[entry.subtype],
        centre,
        boundingBox: boxAround(centre, entry.widthMm, entry.heightMm),
        rotationDeg: FURNITURE_ROTATION_DEG,
        ...reviewMetadataOf(entry),
      });

      continue;
    }

    const openingId = entry.entityId as OpeningId;
    const bucket = openingIdsByWall.get(wall.id) ?? [];

    bucket.push(openingId);
    openingIdsByWall.set(wall.id, bucket);

    openings.push({
      id: openingId,
      wallId: wall.id,
      kind: entry.layer === 'window' ? 'window' : 'door',
      offsetMm: offsetOnWall(attachedOpeningOf(entry, solid), solid),
      widthMm: entry.widthMm,
      heightMm: entry.heightMm,
      sillHeightMm: entry.sillHeightMm ?? OPENING_RULES.doorSillHeightMm,
      swing: entry.swing,
      ...reviewMetadataOf(entry),
    });
  }

  const walls: GraphWall[] = WALL_LAYER_FIXTURE_WALLS.map((wall) => ({
    ...wall,
    openingIds: openingIdsByWall.get(wall.id) ?? [],
  }));

  return normalizeSpatial({
    building: OBJECT_LAYER_SAMPLE_BUILDING,
    levels: [level],
    walls,
    openings,
    furniture,
    rooms: [],
    axes: [],
    dimensions: [],
    notes: [],
  });
}

/** Đồ thị bộ mẫu dựng sẵn — story, test và cổng giả cùng đọc một bản. */
export const OBJECT_LAYER_SAMPLE_GRAPH: NormalizedSpatial = buildObjectLayerGraph();

/* -------------------------------------------------------------------------- */
/* Đọc đồ thị — tường, lỗ mở, đồ đạc của tầng đang duyệt.                      */
/* -------------------------------------------------------------------------- */

const NO_SOLID_WALLS: readonly SolidWall[] = [];
const NO_OBJECTS: readonly ReviewObject[] = [];

/**
 * Tầng đang duyệt: tầng `levelId` của URL; chỉ khi URL KHÔNG mang `levelId` mới
 * lấy tầng đầu của đồ thị.
 *
 * Kho có thể mang đồ thị CẢ dự án (cổng nạp kho, B-V12-01): rơi về tầng đầu khi
 * URL chỉ tầng khác là hiện, và cho sửa, đồ vật của tầng 1 dưới URL của tầng 2
 * (B-V6-40). Nên thiếu tầng của URL thì `null` → màn vào `empty`.
 * Còn mở, chưa sửa: B-V6-71 — kho chỉ giữ một đồ thị, màn QC ở tầng chưa nạp
 * báo rỗng giả.
 */
export function levelOfGraph(graph: NormalizedSpatial | null, levelId?: string): Level | null {
  if (graph === null) {
    return null;
  }

  const isLevel = (id: string | undefined): Level | null => {
    const entity = id === undefined ? undefined : graph.byId[id];

    return entity !== undefined && 'elevationMm' in entity ? entity : null;
  };

  return isLevel(levelId ?? graph.byKind.level[0]);
}

/** Tường của tầng, dạng đồ thị. */
export const graphWallsOf = (graph: NormalizedSpatial | null, level: Level | null): readonly GraphWall[] =>
  graph === null || level === null
    ? []
    : entitiesOfKind(graph, 'wall').filter((wall) => wall.levelId === level.id);

/** Tường của tầng, dạng hình học mà M-08/M-09 nhận. */
export function solidWallsOf(
  graph: NormalizedSpatial | null,
  level: Level | null,
): readonly SolidWall[] {
  if (level === null) {
    return NO_SOLID_WALLS;
  }

  return graphWallsOf(graph, level).map((wall) => solidWallOf(wall, level));
}

/** Lỗ mở của tầng, dạng đồ thị. */
export const graphOpeningsOf = (graph: NormalizedSpatial | null): readonly GraphOpening[] =>
  graph === null ? [] : entitiesOfKind(graph, 'opening');

/** Đồ đạc của tầng, dạng đồ thị. */
export const graphFurnitureOf = (graph: NormalizedSpatial | null): readonly Furniture[] =>
  graph === null ? [] : entitiesOfKind(graph, 'furniture');

/* -------------------------------------------------------------------------- */
/* M-08 — gắn, kiểm, đo. GỌI LẠI, không tự tính (CẤM TUYỆT ĐỐI).               */
/* -------------------------------------------------------------------------- */

/** Bán kính gắn mặc định, xuất lại để hook và bài kiểm đọc đúng một nguồn. */
export { DEFAULT_ATTACH_RADIUS_MM, OPENING_RULES };

/** Gắn một đối tượng vừa dò vào tường gần nhất — M-08, màn không tự tìm tường. */
export const attachObjectToWall = (
  traced: TracedOpening,
  walls: readonly SolidWall[],
  radiusMm: number = DEFAULT_ATTACH_RADIUS_MM,
): OpeningAttachment => attachToWall(traced, walls, millimetres(radiusMm));

/** Fraction dọc tim tường thành toạ độ tuyệt đối — M-08. */
export const positionOnWall = (wall: SolidWall, position: RelativePosition): Point =>
  toPoint(placeOnWall(wall, position));

/** Toạ độ hiện tại của một đối tượng ĐÃ gắn, trên đúng tường chủ — M-08. */
export const centreOfObject = (wall: SolidWall, opening: AttachedOpening): Point =>
  toPoint(openingCentre(wall, opening));

/** Đoạn tường mà một đối tượng chiếm — M-08, nguồn duy nhất của số đo hai đầu. */
export const spanOfObject = (wall: SolidWall, opening: AttachedOpening): OpeningSpan =>
  openingSpan(wall, opening);

/** Kiểm MỘT đối tượng trên tường chủ — M-08. */
export const violationsOfObject = (
  opening: AttachedOpening,
  wall: SolidWall,
  siblings: readonly DomainOpening[],
): readonly OpeningViolation[] => validateOpening(opening, wall, siblings);

/** Kiểm TOÀN BỘ lớp đối tượng — M-08. */
export const violationsOfLayer = (
  openings: readonly DomainOpening[],
  walls: readonly SolidWall[],
): readonly OpeningViolation[] => validateOpenings(openings, walls);

/** Đối tượng chưa gắn được vào tường nào, kèm tường đáng gợi ý — M-08. */
export const orphanReportsOf = (
  openings: readonly DomainOpening[],
  walls: readonly SolidWall[],
): readonly OrphanReport[] => findOrphans(openings, walls);

/**
 * Trôi lỗ mở khi tường đổi — M-09.
 *
 * Màn duyệt không tự kéo tường, nhưng lớp tường ở màn anh em thì có, và một
 * lượt hoàn tác trên tường cũng đổi hình tường dưới chân lỗ mở. Đây là đường
 * DUY NHẤT màn tính lại vị trí sau khi tường đổi — fraction giữ nguyên, lỗ mở
 * lồi ra ngoài bị kéo vào trong, lỗ mở rộng hơn cả tường rơi vào `needsDecision`.
 */
export const reflowObjectsOnWall = (
  previousWall: SolidWall,
  nextWall: SolidWall,
  openings: readonly DomainOpening[],
): ReflowResult => reflowOpenings(previousWall, nextWall, openings);

/**
 * Lỗ mở của đồ thị, đọc bằng vựng của domain M-08.
 *
 * Đối tượng CHƯA GẮN không có mặt trong đồ thị (xem {@link buildObjectLayerGraph}),
 * nên chúng được ghép thêm từ bộ mẫu dưới dạng `OrphanOpening` — đúng kiểu mà
 * `findOrphans` đọc.
 */
export function domainOpeningsOf(
  graph: NormalizedSpatial | null,
  level: Level | null,
  seed: readonly ObjectSeedEntry[] = OBJECT_LAYER_SEED,
): readonly DomainOpening[] {
  if (graph === null || level === null) {
    return [];
  }

  const solidById = new Map(solidWallsOf(graph, level).map((wall) => [wall.id, wall] as const));
  const openings: DomainOpening[] = [];

  for (const opening of graphOpeningsOf(graph)) {
    const solid = solidById.get(opening.wallId);

    if (solid !== undefined) {
      openings.push(toAttachedOpening(opening, solid));
    }
  }

  for (const entry of seed) {
    if (entry.tracedCentre === null || graph.byId[entry.entityId] !== undefined) {
      continue;
    }

    openings.push(orphanOpeningOf(entry));
  }

  return openings;
}

/** Lý do một đối tượng của bộ mẫu chưa gắn được: không có tường nào trong bán kính. */
const SEED_ORPHAN_REASON = 'noWallInRange';

/** Một dòng bộ mẫu chưa gắn, đọc bằng vựng của domain M-08. */
export function orphanOpeningOf(entry: ObjectSeedEntry): OrphanOpening {
  return {
    id: entry.entityId as OpeningId,
    kind: (entry.layer === 'window' ? 'window' : 'door') as DomainOpeningKind,
    widthMm: millimetres(entry.widthMm),
    heightMm: millimetres(entry.heightMm),
    sillHeightMm: millimetres(entry.sillHeightMm ?? OPENING_RULES.doorSillHeightMm),
    swing: entry.swing,
    wallId: null,
    centre: toPointMm(entry.tracedCentre ?? { x: 0, y: 0 }),
    orphanReason: SEED_ORPHAN_REASON,
  };
}

/** Một dòng bộ mẫu chưa gắn, đọc bằng vựng "vừa dò ra" mà `attachToWall` nhận. */
export function tracedOpeningOf(entry: ObjectSeedEntry): TracedOpening {
  const orphan = orphanOpeningOf(entry);

  return {
    id: orphan.id,
    kind: orphan.kind,
    widthMm: orphan.widthMm,
    heightMm: orphan.heightMm,
    sillHeightMm: orphan.sillHeightMm,
    swing: orphan.swing,
    centre: orphan.centre,
  };
}

/* -------------------------------------------------------------------------- */
/* Tầng lệnh — bảy lệnh S-07 gọi lại.                                          */
/* -------------------------------------------------------------------------- */

/** Ngữ cảnh mà các hàm dựng lệnh của S-07 đọc. */
export const commandContextOf = (
  graph: NormalizedSpatial,
  actorId: string,
): CommandContext => ({ graph, actorId });

/** 1. Thêm lỗ mở — gọi lại S-07. Chính nó gọi `attachToWall`, màn không tự gắn. */
export const buildAddOpeningCommand = (
  input: AddOpeningInput,
  context: CommandContext,
): CommandResult => createAddOpeningCommand(input, context);

/** 2. Di chuyển lỗ mở dọc tường chủ — gọi lại S-07. Đây là lệnh của lượt kéo Slider. */
export const buildMoveOpeningCommand = (
  input: MoveOpeningInput,
  context: CommandContext,
): CommandResult => createMoveOpeningCommand(input, context);

/** 3. Đổi kích thước lỗ mở — gọi lại S-07. Tâm giữ nguyên, mép trái tự bù. */
export const buildResizeOpeningCommand = (
  input: ResizeOpeningInput,
  context: CommandContext,
): CommandResult => createResizeOpeningCommand(input, context);

/** 4. Xoá lỗ mở — gọi lại S-07. Gỡ khỏi `wall.openingIds` trong CÙNG một lệnh. */
export const buildDeleteOpeningCommand = (
  input: DeleteOpeningInput,
  context: CommandContext,
): CommandResult => createDeleteOpeningCommand(input, context);

/** Thêm đồ đạc — gọi lại S-07; nút rail "Vẽ nội thất" (K07). */
export const buildAddFurnitureCommand = (
  input: AddFurnitureInput,
  context: CommandContext,
): CommandResult => createAddFurnitureCommand(input, context);

/** 5. Di chuyển đồ đạc — gọi lại S-07. */
export const buildMoveFurnitureCommand = (
  input: MoveFurnitureInput,
  context: CommandContext,
): CommandResult => createMoveFurnitureCommand(input, context);

/** 6. Xoay đồ đạc — gọi lại S-07. */
export const buildRotateFurnitureCommand = (
  input: RotateFurnitureInput,
  context: CommandContext,
): CommandResult => createRotateFurnitureCommand(input, context);

/** Đổi rộng × sâu đồ đạc — gọi lại S-07; tâm giữ nguyên (B3). */
export const buildResizeFurnitureCommand = (
  input: ResizeFurnitureInput,
  context: CommandContext,
): CommandResult => createResizeFurnitureCommand(input, context);

/** 7. Xoá đồ đạc — gọi lại S-07. */
export const buildDeleteFurnitureCommand = (
  input: DeleteFurnitureInput,
  context: CommandContext,
): CommandResult => createDeleteFurnitureCommand(input, context);

/* -------------------------------------------------------------------------- */
/* Ba lệnh còn thiếu — dựng bằng nguyên thuỷ công khai (QĐ-3).                 */
/* -------------------------------------------------------------------------- */

/*
 * Vì sao được phép dựng ở đây, chép nguyên khuôn của màn QC anh em
 * (`wallLayerReviewGateway.ts:22-35`):
 *
 * > `WALL_COMMAND_TYPES` (`wallCommands.ts:98-106`) chỉ có bảy lệnh và **không
 * > có lệnh duyệt**. Điều phối viên đã duyệt cách dựng bằng `createCommand` +
 * > `changeForUpdate` (hợp đồng lô-gic mục C.2), hợp lệ vì `CommandType` là
 * > `string` mở và `validateCommands` chỉ kiểm `command.type` khác rỗng, không
 * > so với một bảng cho phép (mục C.3). Lệnh tự hoàn tác được vì
 * > `changeForUpdate` mang ĐỦ ảnh chụp `before`/`after`, và `invertCommand` chỉ
 * > hoán đổi hai ảnh đó (mục C.5) — không cần thêm một dòng nào cho `Ctrl+Z`.
 *
 * Ở màn này con số là TÁM: `OPENING_COMMAND_TYPES` có tám lệnh và không lệnh
 * nào đổi loại, đổi chiều mở hay duyệt (hợp đồng T1, mục "KHÔNG TÌM THẤY").
 * Mọi lý lẽ còn lại giữ nguyên từng chữ.
 */

/**
 * Loại của lệnh đổi loại lỗ mở.
 *
 * Không nằm trong `OPENING_COMMAND_TYPES` vì lệnh này không tồn tại ở S-07;
 * hằng đặt tên ở đây là chỗ DUY NHẤT chuỗi đó được viết, nên nhật ký hoạt động,
 * đo đạc và bài kiểm cùng đọc một nguồn (R-71).
 */
export const OBJECT_CHANGE_KIND_COMMAND_TYPE = 'opening.changeKind';

/** Loại của lệnh đổi chiều mở. Cùng lý do đặt tên như trên. */
export const OBJECT_CHANGE_SWING_COMMAND_TYPE = 'opening.changeSwing';

/** Loại của lệnh duyệt một đối tượng. Cùng lý do đặt tên như trên. */
export const OBJECT_APPROVE_COMMAND_TYPE = 'opening.approve';

/** Nhãn tiếng Việt của một chiều mở — cho câu mô tả lệnh. */
export const SWING_LABELS: Readonly<Record<SwingDirection, string>> = {
  left: 'mở trái',
  right: 'mở phải',
  double: 'hai cánh',
  sliding: 'cửa lùa',
  fixed: 'cố định',
};

/** Nhãn tiếng Việt của một loại con — dùng lại bảng đã khai ở hợp đồng kiểu. */
const subtypeLabelOf = (subtype: ObjectSubtype): string => OBJECT_SUBTYPE_LABELS[subtype];

/** Câu mô tả trên nút hoàn tác — `validateCommands` đòi nó khác rỗng. */
export const changeKindDescription = (id: string, subtype: ObjectSubtype): string =>
  `Đổi loại ${id} thành ${subtypeLabelOf(subtype)}.`;

/** Câu mô tả của lượt đổi chiều mở. */
export const changeSwingDescription = (id: string, swing: SwingDirection): string =>
  `Đổi chiều mở ${id} thành ${SWING_LABELS[swing]}.`;

/** Câu mô tả của lượt duyệt. */
export const approveDescription = (id: string): string => `Duyệt đối tượng ${id}.`;

/** Hình dạng một lỗ mở sẽ có sau khi đổi sang một loại con. */
export interface OpeningShapeForSubtype {
  readonly kind: 'door' | 'window';
  readonly sillHeightMm: number;
  readonly swing: SwingDirection;
}

/**
 * Loại con đích quy ra ba trường của đồ thị.
 *
 * Đổi loại KÉO THEO cao độ bệ và chiều mở — đặc tả gốc nói thẳng ("cửa đi 0,
 * cửa sổ 900" và "đổi swing hợp lệ"), nên ba trường đi cùng nhau trong MỘT lệnh
 * chứ không phải ba lượt ghi rời để `Ctrl+Z` phải bấm ba lần.
 */
export function openingShapeForSubtype(
  subtype: ObjectSubtype,
  currentSwing: SwingDirection,
): OpeningShapeForSubtype | null {
  if (subtype === 'window') {
    return {
      kind: 'window',
      sillHeightMm: WINDOW_SILL_HEIGHT_MM,
      swing: currentSwing === 'sliding' ? 'sliding' : DEFAULT_WINDOW_SWING,
    };
  }

  if (subtype === 'doubleDoor') {
    return { kind: 'door', sillHeightMm: OPENING_RULES.doorSillHeightMm, swing: DOUBLE_DOOR_SWING };
  }

  if (subtype === 'singleDoor') {
    return {
      kind: 'door',
      sillHeightMm: OPENING_RULES.doorSillHeightMm,
      swing: currentSwing === 'left' || currentSwing === 'right' ? currentSwing : DEFAULT_DOOR_SWING,
    };
  }

  /* Năm loại con còn lại thuộc lớp nội thất — không phải lỗ mở, xem chú thích dưới. */
  return null;
}

/** Câu từ chối khi loại đích không phải một loại lỗ mở. */
export const NOT_AN_OPENING_SUBTYPE_REASON =
  'Chỉ lỗ mở mới đổi được loại: đồ đạc và lỗ mở là hai loại thực thể khác nhau của bản vẽ, và không lệnh nào của S-07 chuyển đổi giữa chúng.';

/** Câu từ chối khi loại đích trùng loại đang có. */
export const SAME_SUBTYPE_REASON = 'Đối tượng đã ở đúng loại đó nên không có gì thay đổi.';

/** Loại của lệnh đổi loại một món nội thất (K10) — `OPENING_COMMAND_TYPES` không có lệnh này. */
export const OBJECT_CHANGE_FURNITURE_KIND_COMMAND_TYPE = 'furniture.changeKind';

/** Loại của lệnh đổi kiểu (`variant`) một món nội thất cùng loại (D3): ghế ăn → sofa… */
export const OBJECT_CHANGE_FURNITURE_VARIANT_COMMAND_TYPE = 'furniture.changeVariant';

/** Câu từ chối khi kiểu đích trùng kiểu đang có. */
export const SAME_VARIANT_REASON = 'Đồ đạc đã ở đúng kiểu đó nên không có gì thay đổi.';

const variantLabelOf = (kind: FurnitureKind, variant: Furniture['variant']): string =>
  variant === undefined
    ? 'theo cỡ'
    : (FURNITURE_VARIANT_OPTIONS[kind]?.find((option) => option.value === variant)?.label ?? variant);

/**
 * Đổi loại đồ đạc của đồ thị (tủ bếp → thiết bị vệ sinh…) và/hoặc kiểu của nó — MỘT lệnh, một lần
 * `Ctrl+Z` (sofa = `chair` + `sofa`). `variant` vắng: cùng loại thì giữ kiểu, khác loại thì bỏ kiểu
 * cũ (kiểu của ghế vô nghĩa ở tủ bếp); `null` = bỏ kiểu, máy suy lại theo cỡ. Hình giữ nguyên.
 */
export function buildChangeFurnitureKindCommand(
  before: Furniture,
  kind: FurnitureKind,
  actorId: string,
  displayId: string,
  variant?: FurnitureVariant | null,
): CommandResult {
  const sameKind = before.kind === kind;
  const nextVariant = variant === undefined ? (sameKind ? before.variant : undefined) : (variant ?? undefined);
  const type = sameKind ? OBJECT_CHANGE_FURNITURE_VARIANT_COMMAND_TYPE : OBJECT_CHANGE_FURNITURE_KIND_COMMAND_TYPE;

  if (sameKind && before.variant === nextVariant) {
    return refuse(type, [variant === undefined ? SAME_SUBTYPE_REASON : SAME_VARIANT_REASON]);
  }

  const after: Furniture = { ...before, kind };
  if (nextVariant === undefined) delete after.variant;
  else after.variant = nextVariant;

  return accept(
    createCommand({
      type,
      actorId,
      description: sameKind
        ? `Đổi kiểu ${displayId} thành ${variantLabelOf(kind, nextVariant)}.`
        : `Đổi loại ${displayId} thành ${nextVariant === 'sofa' ? 'Sofa' : FURNITURE_KIND_LABELS[kind]}.`,
      changes: [changeForUpdate('furniture', before, after)],
    }),
  );
}

/** Câu từ chối khi chiều mở đích trùng chiều mở đang có. */
export const SAME_SWING_REASON = 'Đối tượng đã mở đúng chiều đó nên không có gì thay đổi.';

export interface ChangeObjectKindInput {
  readonly before: GraphOpening;
  /** Mã hiển thị của đối tượng — câu mô tả lệnh in mã này, không in mã máy. */
  readonly displayId: string;
  readonly wall: SolidWall;
  /** Lỗ mở khác trên CÙNG tường — `validateOpening` cần chúng để kiểm chồng lấn. */
  readonly siblings: readonly DomainOpening[];
  readonly subtype: ObjectSubtype;
  readonly actorId: string;
}

/**
 * `doorStyle` (lùa âm tường / cửa xếp, đặt ở màn 3D) chỉ hợp lệ trên cửa đi lùa — AppBack trả 422 cho
 * cả lần lưu tầng nếu còn nó sau khi đổi chiều mở hay đổi cửa đi thành cửa sổ (review EDITOR3D-DOT2 #1).
 */
function withSlidingStyleChecked(opening: GraphOpening): GraphOpening {
  if (opening.doorStyle === undefined || (opening.kind === 'door' && opening.swing === 'sliding')) return opening;
  const rest = { ...opening };
  delete rest.doorStyle;
  return rest;
}

/**
 * Lệnh đổi loại một lỗ mở (cửa đi ↔ cửa sổ).
 *
 * Đi qua `validateOpening` của M-08 TRƯỚC khi nhận: màn không tự kiểm chồng
 * lấn, không tự đoán vị trí hợp lệ. Chỉ mức `critical` chặn lệnh — một cảnh báo
 * là bảng tiêu chuẩn đang nói, và người duyệt được phép nhận nó, đúng cách
 * `criticalReasonsFor` của `openingCommands.ts:169-181` xử lý bảy lệnh kia.
 */
export function buildChangeObjectKindCommand(input: ChangeObjectKindInput): CommandResult {
  const shape = openingShapeForSubtype(input.subtype, input.before.swing);

  if (shape === null) {
    return refuse(OBJECT_CHANGE_KIND_COMMAND_TYPE, [NOT_AN_OPENING_SUBTYPE_REASON]);
  }

  const after = withSlidingStyleChecked({
    ...input.before,
    kind: shape.kind,
    sillHeightMm: shape.sillHeightMm,
    swing: shape.swing,
  });

  if (
    after.kind === input.before.kind &&
    after.sillHeightMm === input.before.sillHeightMm &&
    after.swing === input.before.swing
  ) {
    return refuse(OBJECT_CHANGE_KIND_COMMAND_TYPE, [SAME_SUBTYPE_REASON]);
  }

  const reasons = violationsOfObject(
    toAttachedOpening(after, input.wall),
    input.wall,
    input.siblings.filter((sibling) => sibling.id !== after.id),
  )
    .filter((violation) => violation.severity === 'critical')
    .map((violation) => violation.message);

  if (reasons.length > 0) {
    return refuse(OBJECT_CHANGE_KIND_COMMAND_TYPE, reasons);
  }

  return accept(
    createCommand({
      type: OBJECT_CHANGE_KIND_COMMAND_TYPE,
      actorId: input.actorId,
      description: changeKindDescription(input.displayId, input.subtype),
      changes: [changeForUpdate('opening', input.before, after)],
    }),
  );
}

export interface ChangeObjectSwingInput {
  readonly before: GraphOpening;
  /** Mã hiển thị của đối tượng — câu mô tả lệnh in mã này, không in mã máy. */
  readonly displayId: string;
  readonly swing: SwingDirection;
  readonly actorId: string;
}

/**
 * Lệnh đổi chiều mở của một lỗ mở.
 *
 * `ResizeOpeningInput` không có trường `swing` (cảnh báo số 5 của hợp đồng T1),
 * nên không tái dùng được lệnh nào của S-07. Chiều mở không đổi hình học của lỗ
 * mở nên không có luật M-08 nào để vi phạm — lệnh chỉ từ chối một lượt ghi
 * không thay đổi gì.
 */
export function buildChangeObjectSwingCommand(input: ChangeObjectSwingInput): CommandResult {
  if (input.before.swing === input.swing) {
    return refuse(OBJECT_CHANGE_SWING_COMMAND_TYPE, [SAME_SWING_REASON]);
  }

  return accept(
    createCommand({
      type: OBJECT_CHANGE_SWING_COMMAND_TYPE,
      actorId: input.actorId,
      description: changeSwingDescription(input.displayId, input.swing),
      changes: [
        changeForUpdate('opening', input.before, withSlidingStyleChecked({ ...input.before, swing: input.swing })),
      ],
    }),
  );
}

/**
 * Lệnh duyệt một đối tượng — lỗ mở hoặc đồ đạc.
 *
 * A5: đây là đường DUY NHẤT đặt `reviewed: true`, và nó luôn đặt kèm
 * `source: 'human'` — không có tham số nào cho phép nơi gọi truyền `source`,
 * nên đầu ra AI không có đường nào bật được cờ xanh "đã xác minh".
 *
 * Ảnh chụp `before`/`after` là ĐẦY ĐỦ (`changeForUpdate` giữ nguyên hai bản
 * ghi, không phải diff từng trường), nên `invertCommand` hoàn tác được lệnh này
 * mà không cần biết nó nghĩa là gì.
 */
/** Món đồ đã bỏ cờ gợi ý — nhận một gợi ý là duyệt nó (B3). */
const withoutSuggestion = (item: Furniture): Furniture => {
  const rest = { ...item };

  delete rest.suggested;

  return rest;
};

export function buildApproveObjectCommand(
  before: GraphOpening | Furniture,
  actorId: string,
  displayId: string,
): Command {
  const isOpening = 'wallId' in before;
  const changes = isOpening
    ? [changeForUpdate('opening', before, { ...before, reviewed: true, source: 'human' })]
    : [changeForUpdate('furniture', before, { ...withoutSuggestion(before), reviewed: true, source: 'human' })];

  return createCommand({
    type: OBJECT_APPROVE_COMMAND_TYPE,
    actorId,
    description: approveDescription(displayId),
    changes,
  });
}

/* -------------------------------------------------------------------------- */
/* Đường ghi — `dispatch` chạy qua `commit`.                                   */
/* -------------------------------------------------------------------------- */

/** Cửa đọc đồ thị đang sửa. Mặc định là store; test cắm một đồ thị cố định. */
export interface ObjectLayerGraphPort {
  readonly read: () => NormalizedSpatial | null;
}

/**
 * Cổng ghi của `dispatch`, cài bằng `commit`.
 *
 * `commit` nhận `SpatialPatch[]` và một nhãn tiếng Việt, đúng hai thứ
 * `applyPatches` có trong tay. Nhãn lấy từ chính `label` của lượt dispatch, nên
 * nút hoàn tác và nhật ký hoạt động đọc cùng một câu (A10: không `set()`).
 */
export function createCommitSpatialPort(
  graph: ObjectLayerGraphPort,
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
export interface ObjectLayerDispatchDeps {
  readonly deps: DispatchDeps;
  readonly history: HistoryStack;
  /** Nhãn của lượt dispatch đang chạy — `SpatialPort` đọc nó để đặt tên cho `commit`. */
  readonly setLabel: (label: string) => void;
}

export interface CreateObjectLayerDispatchOptions {
  readonly graph: ObjectLayerGraphPort;
  readonly selectionBefore: () => SelectionSnapshot;
  readonly selectionAfter: () => SelectionSnapshot;
  /** Bước `sync` — đánh dấu bản vẽ bẩn cho tự lưu (S-11). */
  readonly onSynced: () => void;
  readonly history?: HistoryStack;
}

/**
 * Dựng `DispatchDeps` đầy đủ năm cổng.
 *
 * D-06 nằm ngay ở đây: `createHistoryStack` gộp hai lệnh liên tiếp cùng loại,
 * cùng người, cùng tập thực thể khi chúng cách nhau dưới `MERGE_WINDOW_MS`
 * (= `COALESCE_WINDOW_MS` = 400 ms, cùng một hằng gốc). Hai mươi lượt kéo liên
 * tục vì thế thành ĐÚNG MỘT bước lịch sử mà không cần một dòng gộp tay nào.
 */
export function createObjectLayerDispatchDeps(
  options: CreateObjectLayerDispatchOptions,
): ObjectLayerDispatchDeps {
  const history = options.history ?? createHistoryStack({ mergeWindowMs: MERGE_WINDOW_MS });
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

/** Chạy MỘT lệnh qua đủ năm bước. Lệnh đơn là thứ D-06 gộp được. */
export async function runObjectCommand(
  command: Command,
  bundle: ObjectLayerDispatchDeps,
): Promise<DispatchResult> {
  bundle.setLabel(command.description);

  return dispatch(command, bundle.deps);
}

/**
 * Chạy một khối lệnh như MỘT bước lịch sử — `runTransaction` của S-05.
 *
 * Ba lệnh của QĐ-3 đi đường này: đổi loại kéo theo cao độ bệ và chiều mở, và cả
 * khối phải hoàn tác được bằng đúng một lần `Ctrl+Z`. Một giao dịch KHÔNG bao
 * giờ bị D-06 gộp vào lượt kéo kế bên (`history.ts:runInProgress` chỉ gộp bước
 * có đúng một lệnh) — đúng điều cần: người duyệt đã yêu cầu chúng đi cùng nhau.
 */
export async function runObjectTransaction(
  commands: readonly Command[],
  bundle: ObjectLayerDispatchDeps,
  label: string,
): Promise<DispatchResult> {
  bundle.setLabel(label);

  return runTransaction(commands, bundle.deps, { label });
}

/** Vùng chọn rỗng, cho lượt ghi không có gì được chọn trước đó. */
export const NO_OBJECT_SELECTION: SelectionSnapshot = NO_SELECTION;

/* -------------------------------------------------------------------------- */
/* D-06 — gộp lệnh trong cửa sổ 400 ms.                                        */
/* -------------------------------------------------------------------------- */

/** Cửa sổ gộp, xuất lại để hook và bài kiểm đọc đúng một nguồn (R-71). */
export { COALESCE_WINDOW_MS, MERGE_WINDOW_MS };

/** Gộp hàng đợi đồng bộ của một lượt kéo — `coalesce` của D-06, cửa sổ 400 ms. */
export const coalesceObjectDrags = <TValue,>(
  commands: readonly SyncCommand<TValue>[],
  windowMs: number = COALESCE_WINDOW_MS,
): CoalescedCommand<TValue>[] => coalesce(commands, windowMs);

/** Gộp một chuỗi lệnh thành các bước hoàn tác — `mergeCommandRun` của D-06. */
export const mergeObjectCommandRun = (
  commands: readonly Command[],
  windowMs: number = MERGE_WINDOW_MS,
): Command[] => mergeCommandRun(commands, windowMs);

/* -------------------------------------------------------------------------- */
/* D-04 — cập nhật lạc quan và vé hoàn tác.                                    */
/* -------------------------------------------------------------------------- */

/** Câu trên toast hoàn tác sau khi xoá. */
/** Toast của lượt "Bỏ tất cả gợi ý" (B3). */
export const rejectedSuggestionsToast = (count: number): string => `Đã bỏ ${formatObjectCount(count)} gợi ý.`;

/** Đầu dải gợi ý (B3): "3 gợi ý của máy đang chờ". */
export const pendingSuggestionsLabel = (count: number): string => `${formatObjectCount(count)} gợi ý của máy đang chờ`;

/**
 * U04: món duyệt thẳng được trong một lượt — chưa duyệt, không phải gợi ý chưa nhận (đi dải gợi ý),
 * không phải lỗ mở chưa gắn tường (phải gắn trước). Cả tầng, không theo bộ lọc, như bước Tường.
 */
export const approvableObjectsOf = (objects: readonly ReviewObject[]): readonly ReviewObject[] =>
  objects.filter((object) => !object.reviewed && object.suggested !== true && !isUnattachedOpening(object));

/** U04: trong số đó, món máy chắc (không dưới ngưỡng tin cậy của dự án). */
export const confidentObjectsOf = (
  objects: readonly ReviewObject[],
  threshold: number = OBJECT_LAYER_CONFIDENCE_THRESHOLD,
): readonly ReviewObject[] =>
  approvableObjectsOf(objects).filter((object) => !isLowConfidenceObject(object.confidence, threshold));

/** Nhãn nút (và câu nhật ký hoàn tác) của lượt duyệt món máy chắc — như "Duyệt N đoạn máy chắc chắn". */
export const approveConfidentLabelOf = (count: number): string => `Duyệt ${formatObjectCount(count)} mục máy chắc chắn`;

/** "Xem từng gợi ý": dòng gợi ý kế sau dòng đang chọn (vòng lại đầu); `null` khi hết gợi ý. */
export const nextSuggestionIdOf = (
  rows: readonly { readonly id: string; readonly isSuggested?: boolean }[],
  selectedId: string | null,
): string | null => {
  const ids = rows.filter((row) => row.isSuggested === true).map((row) => row.id);
  const at = selectedId === null ? -1 : ids.indexOf(selectedId);

  return ids[(at + 1) % ids.length] ?? null;
};

/** UX-06: món duyệt thẳng được nhưng máy chưa chắc (dưới ngưỡng) — nút riêng, phải hỏi lại. */
export const unsureObjectsOf = (
  objects: readonly ReviewObject[],
  threshold: number = OBJECT_LAYER_CONFIDENCE_THRESHOLD,
): readonly ReviewObject[] =>
  approvableObjectsOf(objects).filter((object) => isLowConfidenceObject(object.confidence, threshold));

/** UX-06: nút duyệt món máy chưa chắc — chỉ đếm món chưa chắc, không gộp món chắc chắn. */
export const approveUnsureLabelOf = (count: number): string => `Duyệt ${formatObjectCount(count)} mục máy chưa chắc`;

/** UX-06: câu hỏi lại trước khi duyệt món máy chưa chắc. */
export const confirmUnsureLabelOf = (count: number): string =>
  `Duyệt luôn ${formatObjectCount(count)} mục máy chưa chắc? Máy có thể nhận sai loại hoặc chỗ đặt, nên xem từng mục thì tốt hơn.`;

/**
 * UX-06: tách số "cần xem" (mọi món chưa duyệt) thành các nhóm cộng lại đúng bằng nó:
 * chắc chắn + chưa chắc + gợi ý (+ lỗ mở chưa gắn tường, phải gắn tay). `null` khi hết món cần xem.
 */
export const reviewBreakdownLabelOf = (
  objects: readonly ReviewObject[],
  threshold: number = OBJECT_LAYER_CONFIDENCE_THRESHOLD,
): string | null => {
  const pending = objects.filter((object) => !object.reviewed);
  const suggested = pending.filter((object) => object.suggested === true).length;
  const unattached = pending.filter((object) => object.suggested !== true && isUnattachedOpening(object)).length;
  const approvable = approvableObjectsOf(objects);
  const confident = approvable.filter((object) => !isLowConfidenceObject(object.confidence, threshold)).length;
  const unsure = approvable.length - confident;

  if (pending.length === 0) {
    return null;
  }

  const parts = [
    `${formatObjectCount(confident)} máy chắc chắn`,
    `${formatObjectCount(unsure)} máy chưa chắc`,
    `${formatObjectCount(suggested)} gợi ý`,
    ...(unattached > 0 ? [`${formatObjectCount(unattached)} chưa gắn tường`] : []),
  ];

  return `${formatObjectCount(pending.length)} cần xem = ${parts.join(' + ')}`;
};

/** Một lần bấm "Xoay 90°" (B3). */
export const QUARTER_TURN_DEG = 90;

export const deleteToastDescription = (displayId: string): string =>
  `Đã xoá đối tượng ${displayId}.`;

export interface CreateObjectUndoTicketOptions {
  readonly displayId: string;
  /** Câu toast thay câu xoá một đối tượng — lượt bỏ nhiều gợi ý một lúc (B3). */
  readonly description?: string;
  readonly undo: () => void;
  readonly now: () => number;
}

/**
 * Vé hoàn tác của một lượt xoá.
 *
 * `UNDO_WINDOW_MS` (8000 ms, A8) tới từ `src/lib/mutations/undoTicket.ts` — con
 * số không được viết lại ở màn (R-71), và `createUndoTicket` dùng nó làm mặc
 * định nên ở đây thậm chí không có tham số nào mang nó.
 */
export function createObjectUndoTicket(options: CreateObjectUndoTicketOptions): UndoTicket {
  return createUndoTicket({
    description: options.description ?? deleteToastDescription(options.displayId),
    now: options.now,
    undo: options.undo,
  });
}

/** Cửa sổ hoàn tác, xuất lại để hook và bài kiểm đọc đúng một nguồn. */
export { UNDO_WINDOW_MS };

/* -------------------------------------------------------------------------- */
/* P-01 — định dạng. Mọi con số thành chuỗi TRƯỚC khi rời khỏi hook (A15).      */
/* -------------------------------------------------------------------------- */

/** Một số đo, luôn ở milimét để một cột số thẳng hàng — "2.200 mm". */
export const formatMillimetres = (valueMm: number): string => formatLength(valueMm, { unit: 'mm' });

/** Một số đếm — "21". Dấu nghìn là dấu chấm, dấu thập phân là dấu phẩy (A15). */
export const formatObjectCount = (value: number): string =>
  formatNumber(value, { fractionDigits: 0 });

/**
 * Kích thước một đối tượng — `"900 × 2.200 mm"` (P-01).
 *
 * Đơn vị viết đúng MỘT lần, ở cuối, đúng như đặc tả gốc in ra; con số thì đi
 * qua `formatLength`/`formatNumber` của `src/lib/format` nên dấu nghìn là dấu
 * chấm và dấu thập phân là dấu phẩy mà không màn nào phải tự nhớ.
 */
/** Cửa đi hẹp hơn mức này thì gần như chắc là máy đọc sai bề rộng (UX-48). */
export const NARROW_DOOR_MIN_WIDTH_MM = 600;

/**
 * Lời nhắc kiểm lại khi cửa đi hẹp bất thường; `null` ở cửa sổ, nội thất và cửa đủ rộng (UX-48).
 *
 * R10 làn S: bề rộng mm suy ra từ tỷ lệ, nên ở tầng tỷ lệ ước lượng lời này có thể là báo động giả —
 * cửa vẫn đúng 800 mm, chỉ tỷ lệ sai. Khi đó nói rõ số là số ước thay vì khẳng định cửa hẹp.
 */
export const doorSizeWarningOf = (
  object: { readonly layer: ReviewObject['layer']; readonly widthMm: number },
  scaleState: ScaleState = 'confirmed',
): string | null => {
  if (object.layer !== 'door' || object.widthMm >= NARROW_DOOR_MIN_WIDTH_MM) return null;
  const width = formatObjectCount(object.widthMm);
  return isTrustedState(scaleState)
    ? `Cửa hẹp bất thường (${width} mm), kiểm lại`
    : `Đo ra ${width} mm — hẹp bất thường, nhưng tỷ lệ tầng còn là số ước; kiểm tỷ lệ trước`;
};

/** Trạng thái tỷ lệ cho phép đọc số đo như số thật. */
const isTrustedState = (state: ScaleState): boolean => state === 'measured' || state === 'confirmed';

export const formatObjectSize = (widthMm: number, heightMm: number, scaleState: ScaleState = 'confirmed'): string =>
  measureTextOfState(`${formatObjectCount(widthMm)} × ${formatMillimetres(heightMm)}`, scaleState);

/** Bộ đếm duyệt thành câu — "9/21 đối tượng đã duyệt". */
export const reviewProgressLabel = (reviewed: number, total: number): string =>
  `${formatObjectCount(reviewed)}/${formatObjectCount(total)} đối tượng đã duyệt`;

/** Tổng của cây lớp — "tổng 21 đối tượng". */
export const layerTreeTotalLabel = (total: number): string =>
  `Tổng ${formatObjectCount(total)} đối tượng`;

/** Chỉ báo đang lọc — "1 / 3 đối tượng" (BUG-402): bộ đếm và tổng vẫn đếm cả tầng. */
export const filteredCountLabel = (shown: number, total: number): string =>
  `${formatObjectCount(shown)} / ${formatObjectCount(total)} đối tượng`;

/** Câu của trạng thái một phần — "5 mục dưới ngưỡng tin cậy". */
export const lowConfidenceNotice = (count: number): string =>
  `${formatObjectCount(count)} mục máy chưa chắc`;

/**
 * Mọi chuỗi cố định người dùng đọc, đúng một chỗ (R-71).
 *
 * Chép nguyên văn, có dấu, từ Phần IV của đặc tả gốc. Chuỗi ghép theo số thì ở
 * bốn hàm ngay trên. Khoá i18n tương ứng nằm ở `.orca-notes/T5-i18n.fragment.md`
 * để T8 đưa vào `src/i18n/vi.json` (R-67).
 */
export const OBJECT_LAYER_TEXT = {
  emptyTitle: 'Chưa nhận ra đối tượng nào',
  emptyExplanation:
    'Nhận diện nội thất phụ thuộc kiểu vẽ của bản gốc, nên bản vẽ ít ký hiệu quy ước có thể không ra kết quả nào.',
  emptyAction: 'Thêm thủ công',
  furnitureAttention: 'Nhận diện nội thất lỗi, cửa vẫn xong',
  /* Người xem VẪN xem được lớp; câu cũ "không có quyền xem" là sai (BUG-601). */
  forbidden: 'Bạn đang xem — không sửa được lớp này.',
  subtypeRefused: 'Chỉ đổi được loại giữa cửa đơn, cửa đôi và cửa sổ.',
  subtypeSame: 'Đối tượng đã ở đúng loại đó nên không có gì thay đổi.',
  subtypeNeedsWall: 'Gắn đối tượng vào tường trước rồi mới đổi loại.',
  lowConfidenceDone: 'Đã duyệt hết chỗ máy chưa chắc.',
  showAll: 'Hiện tất cả',
  deleteAction: 'Xoá đối tượng',
  shortcutDelete: 'Xoá đối tượng đang chọn (hỏi lại trước khi xoá)',
  shortcutArrowNext: 'Chọn dòng kế tiếp trong danh sách',
  shortcutArrowPrevious: 'Chọn dòng phía trên trong danh sách',
  shortcutApproveNext: 'Duyệt đối tượng đang chọn rồi sang đối tượng chưa duyệt kế tiếp',
  shortcutAcceptSuggestion: 'Nhận gợi ý đang chọn rồi sang đối tượng chưa duyệt kế tiếp',
  acceptAllSuggestionsDone: 'Đã nhận tất cả gợi ý.',
  unattachedBadge: 'Chưa gắn vào tường nào',
  attachNearestAction: 'Gắn vào tường gần nhất',
  errorMessage: 'Không tải được lớp đối tượng của tầng.',
  attachNoWall: 'Không có tường nào đủ gần để gắn đối tượng này.',
  attachRefused: 'Không gắn được vào tường gần nhất.',
  addNoWall: 'Tầng này chưa có đoạn tường nào để đặt đối tượng mới lên.',
  drawNoWall: 'Bấm sát một bức tường để đặt cửa lên đó.',
  emptyNoWall:
    'Tầng này chưa có đoạn tường nào, nên chưa có chỗ đặt cửa hay cửa sổ. Duyệt lớp tường trước rồi quay lại đây.',
  emptyNoDrawing:
    'Tầng này chưa có bản vẽ, nên chưa có tường hay cửa nào để duyệt. Tải bản vẽ cho tầng ở Quản lý tầng rồi quay lại đây.',
  openFloorsAction: 'Về quản lý tầng',
  addRefused: 'Không thêm được đối tượng vào tường.',
  shortcutLayer: 'Đặt nhóm loại cho đối tượng đang chọn',
  shortcutSubtype: 'Đổi loại trong nhóm đang chọn',
  shortcutUndo: 'Hoàn tác thay đổi gần nhất',
} as const;

/* -------------------------------------------------------------------------- */
/* P-06 — màu độ tin cậy và màu lớp dữ liệu.                                   */
/* -------------------------------------------------------------------------- */

/**
 * Màu dữ liệu của ba lớp con — ĐÚNG BA, không hơn (CẤM TUYỆT ĐỐI).
 *
 * Cùng bảng với `OBJECT_LAYER_COLOR_TOKENS` của `objectLayerSymbols.ts` (Impeccable
 * A3, 10-2026): ba bậc trung tính đậm/vừa/nhạt `--text-primary`/`--text-secondary`/
 * `--text-muted` — đủ tương phản trên nền bản vẽ (xám ấm cũ quá nhạt), và KHÔNG
 * mượn `--accent` (A2: chỉ cho thứ bấm được) hay màu trạng thái (A4: đúng ba).
 * Bộ đếm và canvas đọc cùng một màu cho mỗi lớp; trạng thái của đối tượng nói
 * bằng viền/độ mờ và chip ở danh sách, không bằng màu lớp.
 *
 * `createLookupScale` đòi bảng đủ mọi khoá của `ObjectLayerId`, nên thêm một
 * lớp con thứ tư sẽ hỏng bản dựng ngay tại đây — đúng chỗ phải hỏng.
 */
export const OBJECT_LAYER_TOKENS: Readonly<Record<ObjectLayerId, ColorTokenName>> = {
  door: '--text-primary',
  window: '--text-secondary',
  furniture: '--text-muted',
};

/** Màu dữ liệu của một lớp con. */
export const objectLayerToken = createLookupScale<ObjectLayerId>(OBJECT_LAYER_TOKENS);

/**
 * Những màu dữ liệu ĐANG hiện, không trùng nhau.
 *
 * Bật cả ba lớp cho ra đúng ba màu; tắt một lớp thì màu của nó biến khỏi danh
 * sách. Đây là con số mà nghiệm thu đếm, nên nó được tính ra chứ không gõ tay.
 */
export function dataLayerTokens(visibility: ObjectLayerVisibility): readonly ColorTokenName[] {
  const tokens = OBJECT_LAYER_IDS.filter((layer) => visibility[layer]).map((layer) =>
    objectLayerToken(layer),
  );

  return [...new Set(tokens)];
}

/** Một đối tượng đọc bằng vựng của tầng tô màu P-06. */
export const toPaintSubject = (object: ReviewObject, levelId: LevelId): PaintSubject => ({
  id: object.id,
  levelId,
  review: { confidence: object.confidence, source: sourceOf(object), reviewed: object.reviewed },
  usage: null,
  areaM2: null,
  worstSeverity: null,
});

/** Bảng màu độ tin cậy, cắt theo đúng những đối tượng đang thấy — P-06. */
export const confidenceModeOf = (subjects: readonly PaintSubject[]): ColoringMode =>
  createColoringMode('aiConfidence', { subjects });

/** Chú giải của bảng màu độ tin cậy — P-06, đếm theo chính màu mode tô ra. */
export const confidenceLegendOf = (
  mode: ColoringMode,
  subjects: readonly PaintSubject[],
): Legend => generateLegend(mode, subjects);

/* -------------------------------------------------------------------------- */
/* Đọc 21 đối tượng ra khỏi đồ thị.                                            */
/* -------------------------------------------------------------------------- */

/**
 * Loại con của một lỗ mở, suy từ đồ thị.
 *
 * Cửa hai cánh nhận ra bằng chính `swing: 'double'` — không có trường thứ hai
 * để hai nơi nói khác nhau. Nội thất KHÔNG đọc bằng hàm này: `FurnitureKind`
 * không một-một với tám loại con (xem {@link FURNITURE_KIND_BY_SUBTYPE}).
 */
export const subtypeOfOpening = (opening: GraphOpening): ObjectSubtype => {
  if (opening.kind === 'window') {
    return 'window';
  }

  return opening.swing === 'double' ? 'doubleDoor' : 'singleDoor';
};

/**
 * Trạng thái màu của một đối tượng.
 *
 * Luật là luật của `toViewModel.ts:215-221`: `verified` tới TỪ `reviewed` và
 * từ không gì khác (A5), mọi thứ dưới mức AI-chắc-chắn là `attention`. Hàm
 * `reviewStatus` ở đó không được xuất và không có bộ dựng viewmodel nào cho đồ
 * đạc, nên luật được viết lại đúng một lần ở đây — và
 * `useObjectLayerReview.test.ts` khẳng định nó KHỚP `toOpeningViewModel` cho
 * từng lỗ mở của bộ mẫu, nên hai bản không trôi khỏi nhau trong im lặng.
 *
 * Thêm đúng một điều màn này biết mà viewmodel chung không biết: một đối tượng
 * chưa gắn được vào tường nào là thứ người duyệt đang đi tìm, nên nó lên
 * `attention` kể cả khi AI rất tự tin.
 */
export function objectStatusCode(review: ReviewMetadata, isOrphan: boolean): ViewStatusCode {
  if (review.reviewed) {
    return 'verified';
  }

  if (isOrphan) {
    return 'attention';
  }

  return confidenceLevel(review.confidence) === 'certain' ? 'neutral' : 'attention';
}

/** Ảnh chụp lỗ mở mà M-08 nhận, dựng từ một đối tượng ĐÃ gắn tường. */
export function attachedOpeningOfObject(
  object: AttachedReviewObject,
  wall: SolidWall,
): AttachedOpening {
  return {
    id: object.entityId as OpeningId,
    kind: object.layer === 'window' ? 'window' : 'door',
    widthMm: millimetres(object.widthMm),
    heightMm: millimetres(object.heightMm),
    sillHeightMm: millimetres(object.sillHeightMm ?? OPENING_RULES.doorSillHeightMm),
    swing: object.swing,
    wallId: wall.id,
    relativePosition: object.relativePosition,
  };
}

/**
 * Vị trí một món đồ đạc dọc tường chủ, đo bằng M-08.
 *
 * Đồ thị lưu tâm món đồ bằng toạ độ tuyệt đối, còn màn hình cần fraction dọc
 * tim tường. Phép chiếu đó là việc của `attachToWall` — màn KHÔNG tự chiếu
 * (CẤM TUYỆT ĐỐI). Bán kính dùng `orphanSuggestionRadiusMm` vì món đồ đứng
 * cạnh tường chứ không nằm trong lòng tường như một lỗ mở.
 */
export function furniturePositionOnWall(
  furniture: Furniture,
  seed: ObjectSeedEntry,
  wall: SolidWall,
): RelativePosition | null {
  const attachment = attachToWall(
    {
      id: seed.entityId as OpeningId,
      kind: 'void',
      widthMm: millimetres(seed.widthMm),
      heightMm: millimetres(seed.heightMm),
      sillHeightMm: millimetres(OPENING_RULES.doorSillHeightMm),
      swing: seed.swing,
      centre: toPointMm(furniture.centre),
    },
    [wall],
    OPENING_RULES.orphanSuggestionRadiusMm,
  );

  return attachment.opening.wallId === null ? null : attachment.opening.relativePosition;
}

/**
 * Mã hiển thị cho những thực thể KHÔNG có dòng mẫu: `displayCodesOf` của domain trên
 * đúng nhóm ấy, rồi đặt tiền tố của lớp con — cửa sổ là `S-` dù mã máy mang `D-`.
 */
const fallbackCodesOf = (ids: readonly string[], prefix: string): ReadonlyMap<string, string> =>
  new Map([...displayCodesOf(ids)].map(([id, code]) => [id, `${prefix}${code.slice(1)}`] as const));

/**
 * Mọi ô mở và nội thất của tầng, dựng từ ĐỒ THỊ (B-V6-13).
 *
 * Bộ mẫu chỉ còn là siêu dữ liệu tuỳ chọn: thực thể có dòng mẫu lấy mã hiển thị (và
 * loại con, nếu là nội thất) từ dòng ấy; không có thì mã đọc bằng `displayCodesOf`
 * và loại con bằng {@link subtypeOfOpening} / {@link SUBTYPE_BY_FURNITURE_KIND}.
 * Không đối tượng thật nào bị bỏ qua: nội thất không áp được vào tường thành một
 * đối tượng đứng tự do ở đúng `centre` của nó, cỡ lấy từ `boundingBox`. Dòng mẫu
 * chưa gắn (`tracedCentre`) chỉ được nối thêm khi thực thể chưa có trên đồ thị.
 */
export function objectsOf(
  graph: NormalizedSpatial | null,
  level: Level | null,
  seed: readonly ObjectSeedEntry[] = OBJECT_LAYER_SEED,
): readonly ReviewObject[] {
  if (graph === null || level === null) {
    return NO_OBJECTS;
  }

  const solidById = new Map(solidWallsOf(graph, level).map((wall) => [wall.id, wall] as const));
  const seedByEntity = new Map(seed.map((entry) => [entry.entityId, entry] as const));
  const openings = graphOpeningsOf(graph).filter((opening) => solidById.has(opening.wallId));
  const furniture = graphFurnitureOf(graph).filter((item) => item.levelId === level.id);
  const unseeded = (ids: readonly string[]): readonly string[] =>
    ids.filter((id) => !seedByEntity.has(id));
  const codes = new Map([
    ...fallbackCodesOf(unseeded(openings.filter((o) => o.kind !== 'window').map((o) => o.id)), 'D'),
    ...fallbackCodesOf(unseeded(openings.filter((o) => o.kind === 'window').map((o) => o.id)), 'S'),
    ...fallbackCodesOf(unseeded(furniture.map((item) => item.id)), 'F'),
  ]);
  const codeOf = (entityId: string): string =>
    seedByEntity.get(entityId)?.displayId ?? codes.get(entityId) ?? entityId;
  const objects: ReviewObject[] = [];

  for (const entity of openings) {
    const solid = solidById.get(entity.wallId);

    if (solid === undefined) {
      continue;
    }

    const subtype = subtypeOfOpening(entity);

    objects.push({
      id: codeOf(entity.id),
      entityId: entity.id,
      layer: OBJECT_SUBTYPE_LAYER[subtype],
      subtype,
      widthMm: millimetres(entity.widthMm),
      heightMm: millimetres(entity.heightMm),
      sillHeightMm: entity.kind === 'window' ? millimetres(entity.sillHeightMm) : null,
      swing: entity.swing,
      confidence: entity.confidence,
      reviewed: entity.reviewed,
      source: entity.source,
      hostWallId: entity.wallId,
      relativePosition: relativePositionOf(entity, solid),
    });
  }

  for (const entity of furniture) {
    const entry = seedByEntity.get(entity.id) ?? null;
    const solid =
      entry === null || entry.hostWallId === null ? undefined : solidById.get(entry.hostWallId);
    const position =
      entry === null || solid === undefined ? null : furniturePositionOnWall(entity, entry, solid);

    if (entry !== null && solid !== undefined && position !== null) {
      objects.push({
        id: entry.displayId,
        entityId: entity.id,
        layer: 'furniture',
        subtype: entry.subtype,
        widthMm: millimetres(entry.widthMm),
        heightMm: millimetres(entry.heightMm),
        sillHeightMm: null,
        swing: entry.swing,
        confidence: entity.confidence,
        reviewed: entity.reviewed,
        source: entity.source,
        ...(entity.suggested === true ? { suggested: true } : {}),
        hostWallId: solid.id,
        relativePosition: position,
      });

      continue;
    }

    const { min, max } = entity.boundingBox;
    // K1: boundingBox is the unrotated local footprint; rotationDeg turns it about centre.
    const free: FreeFurnitureObject = {
      id: codeOf(entity.id),
      entityId: entity.id,
      layer: 'furniture',
      subtype: entry?.subtype ?? SUBTYPE_BY_FURNITURE_KIND[entity.kind],
      widthMm: millimetres(max.x - min.x),
      heightMm: millimetres(max.y - min.y),
      sillHeightMm: null,
      swing: FURNITURE_SWING,
      confidence: entity.confidence,
      reviewed: entity.reviewed,
      source: entity.source,
      ...(entity.suggested === true ? { suggested: true } : {}),
      hostWallId: null,
      tracedCentre: entity.centre,
      rotationDeg: entity.rotationDeg,
      furnitureKind: entity.kind,
      ...(entity.variant === undefined || !isFurnitureVariant(entity.variant) ? {} : { furnitureVariant: entity.variant }),
      ...(entity.variant === 'sofa' ? { isSofa: true } : {}),
    };

    objects.push(free);
  }

  for (const entry of seed) {
    if (entry.tracedCentre !== null && graph.byId[entry.entityId] === undefined) {
      objects.push(orphanObjectOf(entry));
    }
  }

  return objects;
}

/**
 * Nội thất đứng tự do: mang thêm góc xoay của chính nó để canvas vẽ đúng hướng, và
 * `FurnitureKind` của đồ thị để dòng danh sách gọi đúng tên ("Tủ bếp") khi loại con
 * chỉ là "nội thất khác" (K07).
 */
type FreeFurnitureObject = OrphanReviewObject & {
  readonly rotationDeg: number;
  readonly furnitureKind: FurnitureKind;
  /** Kiểu của đồ thị (`Furniture.variant`) — ô "Kiểu" của inspector (D3). */
  readonly furnitureVariant?: FurnitureVariant;
  /** Máy chủ đổi nhãn theo cỡ thật: "ghế" dài hơn 1,4 m là sofa (`variant: 'sofa'`, U34). */
  readonly isSofa?: true;
};

const SOFA_LABEL = 'Sofa';

/** Tên loại người đọc: tên loại con, hoặc tên `FurnitureKind` khi loại con chỉ là "nội thất khác". */
export function objectTypeLabelOf(object: ReviewObject): string {
  const kind = (object as Partial<FreeFurnitureObject>).furnitureKind;

  if ((object as Partial<FreeFurnitureObject>).isSofa === true) {
    return SOFA_LABEL;
  }

  if (object.subtype !== 'otherFurniture' || kind === undefined || kind === 'other') {
    return OBJECT_SUBTYPE_LABELS[object.subtype];
  }

  const label = FURNITURE_KIND_LABELS[kind];

  return label.charAt(0).toUpperCase() + label.slice(1);
}

/**
 * Màu trạng thái của danh sách và canvas: chú ý khi DƯỚI NGƯỠNG tin cậy (cùng luật với
 * câu "N mục máy chưa chắc" đầu panel) hoặc lỗ mở chưa gắn tường. Luật "dưới mức chắc
 * chắn" của {@link objectStatusCode} tô 33/39 dòng nên nhãn chú ý mất giá trị (K07).
 */
const listStatusCodeOf = (
  object: ReviewObject,
  isOrphan: boolean,
  threshold: number = OBJECT_LAYER_CONFIDENCE_THRESHOLD,
): ViewStatusCode => {
  if (object.reviewed) {
    return 'verified';
  }

  return isOrphan || isLowConfidenceObject(object.confidence, threshold) ? 'attention' : 'neutral';
};

/** Góc xoay riêng của nội thất đứng tự do; mọi đối tượng khác là 0. */
const ownRotationDegOf = (object: ReviewObject): number =>
  'rotationDeg' in object && typeof object.rotationDeg === 'number' ? object.rotationDeg : 0;

/** Một dòng bộ mẫu chưa gắn, đọc bằng vựng viewmodel của màn. */
export function orphanObjectOf(entry: ObjectSeedEntry): OrphanReviewObject {
  return {
    id: entry.displayId,
    entityId: entry.entityId,
    layer: entry.layer,
    subtype: entry.subtype,
    widthMm: millimetres(entry.widthMm),
    heightMm: millimetres(entry.heightMm),
    sillHeightMm: entry.sillHeightMm === null ? null : millimetres(entry.sillHeightMm),
    swing: entry.swing,
    confidence: entry.confidence,
    reviewed: entry.reviewed,
    ...(entry.source === undefined ? {} : { source: entry.source }),
    hostWallId: null,
    tracedCentre: entry.tracedCentre ?? { x: 0, y: 0 },
  };
}

/* -------------------------------------------------------------------------- */
/* Bộ đếm — 21 = 9 + 7 + 5, tính từ dữ liệu.                                   */
/* -------------------------------------------------------------------------- */

/** Ba lớp con và tổng, tính từ chính danh sách đối tượng. */
export const countsOf = (objects: readonly ReviewObject[]): ObjectLayerCounts =>
  countObjectsByLayer(objects);

/** Bộ đếm duyệt, tính từ chính danh sách đối tượng — không gõ tay 9 hay 21. */
export const reviewCounterOf = (objects: readonly ReviewObject[]): ObjectReviewCounter => ({
  reviewed: objects.filter((object) => object.reviewed).length,
  total: objects.length,
});

/** Những đối tượng dưới ngưỡng tin cậy và chưa duyệt — nhánh (a) của trạng thái một phần. */
export const lowConfidenceObjectsOf = (
  objects: readonly ReviewObject[],
  threshold: number = OBJECT_LAYER_CONFIDENCE_THRESHOLD,
): readonly ReviewObject[] => unsureObjectsOf(objects, threshold);

/* -------------------------------------------------------------------------- */
/* Viewmodel — một dòng danh sách, một thanh tra, một hình tường nền.           */
/* -------------------------------------------------------------------------- */

/** Một dòng của danh sách gộp theo ba nhóm. */
export function toObjectRow(
  object: ReviewObject,
  wallCodes?: ReadonlyMap<string, string>,
  threshold: number = OBJECT_LAYER_CONFIDENCE_THRESHOLD,
  scaleState: ScaleState = 'confirmed',
): ObjectListRowViewModel {
  const attached = isOrphanObject(object) ? null : object;
  const isOrphan = isUnattachedOpening(object);

  return {
    id: object.id,
    layer: object.layer,
    subtype: object.subtype,
    typeLabel: objectTypeLabelOf(object),
    codeLabel: `#${object.id}`,
    sizeLabel: formatObjectSize(object.widthMm, object.heightMm, scaleState),
    sizeWarning: doorSizeWarningOf(object, scaleState),
    hostWallLabel: attached === null ? null : `#${wallCodes?.get(attached.hostWallId) ?? hostWallDisplayCode(attached.hostWallId)}`,
    confidence: object.confidence,
    statusCode: listStatusCodeOf(object, isOrphan, threshold),
    isReviewed: object.reviewed,
    isLowConfidence: isLowConfidenceObject(object.confidence, threshold),
    isOrphan,
    ...(object.suggested === true ? { isSuggested: true } : {}),
  };
}

/** Độ tin cậy bằng chữ, cùng chữ với nhãn của dòng danh sách (K10). */
const LOW_CONFIDENCE_LABEL = 'Máy chưa chắc';
const CONFIDENT_LABEL = 'Máy khá chắc';

/**
 * Thanh tra đối tượng đang chọn.
 *
 * Khoảng cách tới HAI ĐẦU tường đo bằng `openingSpan` của M-08 và
 * `centrelineLength` của `src/domain/walls` — không một phép hình học nào viết
 * mới ở đây, và số đo trên `MeasurementLabel` vì thế không lệch được khỏi số
 * mà tầng lệnh dùng để kiểm.
 */
export function toObjectInspector(
  object: ReviewObject,
  wall: SolidWall | null,
  wallCodes?: ReadonlyMap<string, string>,
  threshold: number = OBJECT_LAYER_CONFIDENCE_THRESHOLD,
  scaleState: ScaleState = 'confirmed',
): ObjectInspectorViewModel {
  const attached = isOrphanObject(object) ? null : object;
  const isOrphan = isUnattachedOpening(object);
  const span =
    attached === null || wall === null ? null : spanOfObject(wall, attachedOpeningOfObject(attached, wall));

  return {
    id: object.id,
    codeLabel: `#${object.id}`,
    subtype: object.subtype,
    typeLabel: objectTypeLabelOf(object),
    furnitureKind: (object as Partial<FreeFurnitureObject>).furnitureKind ?? null,
    furnitureVariant: (object as Partial<FreeFurnitureObject>).furnitureVariant ?? null,
    sizeLabel: formatObjectSize(object.widthMm, object.heightMm, scaleState),
    sizeWarning: doorSizeWarningOf(object, scaleState),
    confidenceLabel: isLowConfidenceObject(object.confidence, threshold) ? LOW_CONFIDENCE_LABEL : CONFIDENT_LABEL,
    widthLabel: measureTextOfState(formatMillimetres(object.widthMm), scaleState),
    heightLabel: measureTextOfState(formatMillimetres(object.heightMm), scaleState),
    sillHeightLabel:
      object.sillHeightMm === null ? null : measureTextOfState(formatMillimetres(object.sillHeightMm), scaleState),
    hostWallLabel: attached === null ? null : `#${wallCodes?.get(attached.hostWallId) ?? hostWallDisplayCode(attached.hostWallId)}`,
    hostWallId: attached?.hostWallId ?? null,
    relativePosition: attached?.relativePosition ?? null,
    distanceToStartLabel: span === null ? null : measureTextOfState(formatMillimetres(span.lowMm), scaleState),
    distanceToEndLabel:
      span === null || wall === null
        ? null
        : measureTextOfState(formatMillimetres(centrelineLength(wall) - span.highMm), scaleState),
    swing: object.swing,
    confidence: object.confidence,
    isOrphan,
    reviewed: object.reviewed,
    /* Ô số chỉ cho nội thất đứng tự do: hộp của nó là `boundingBox` thật, lệnh resize đổi đúng hộp ấy. */
    ...('furnitureKind' in object
      ? { footprintMm: { widthMm: Math.round(object.widthMm), depthMm: Math.round(object.heightMm) } }
      : {}),
    ...(object.suggested === true ? { isSuggested: true } : {}),
  };
}

/**
 * Đa giác của mọi tường trên tầng, qua `resolveWallShapes` — nguồn DUY NHẤT của
 * hình tường để vẽ.
 *
 * Một bản vẽ hỏng không được làm trắng màn (A11), nên lỗi của hàm hình học
 * thành "không có hình nào để vẽ" chứ không phải một ngoại lệ nổ ra giữa lượt
 * render.
 */
export function wallOutlinesOf(
  walls: readonly GraphWall[],
  level: Level,
): readonly HostWallOutlineViewModel[] {
  if (walls.length === 0) {
    return [];
  }

  try {
    const resolved = resolveDrawableWallShapes(walls.map((wall) => solidWallOf(wall, level)));

    return resolved.shapes.map((shape) => ({ id: shape.wallId, outline: shape.outline }));
  } catch {
    return [];
  }
}

/** Lỗ mở khác trên CÙNG tường — `validateOpening` cần chúng để kiểm chồng lấn. */
export function siblingOpeningsOf(
  graph: NormalizedSpatial,
  wall: SolidWall,
): readonly DomainOpening[] {
  return openingsOfWall(graph, wall.id).map((opening) => toAttachedOpening(opening, wall));
}

/* -------------------------------------------------------------------------- */
/* Cái seam — cổng dữ liệu.                                                    */
/* -------------------------------------------------------------------------- */

/** Ảnh nền của lớp đối tượng — bản vẽ gốc đã tải lên, đọc qua `spatial.readFloor`. */
export interface ObjectLayerBackground {
  readonly imageUrl: string | null;
  readonly imageAlt: string;
  readonly widthMm: number | null;
  readonly heightMm: number | null;
}

/** Mô tả ảnh nền cho trình đọc màn hình (R-72). */
export const backgroundImageAlt = (floorName: string): string =>
  `Bản vẽ gốc của ${floorName}, dùng làm nền để đối chiếu lớp đối tượng.`;

export interface ReadObjectLayerInput {
  readonly projectId: string;
  readonly floorId: string;
  readonly signal?: AbortSignal;
}

/** Mỗi phương thức là một việc màn cần từ bên ngoài, và không có việc nào khác. */
export interface ObjectLayerReviewGateway {
  readonly supports: Readonly<Record<ObjectLayerCapability, boolean>>;
  /** Ảnh nền của tầng. Lỗi ở ĐÂY chỉ làm mất ảnh nền, không phải hỏng lớp đối tượng. */
  readonly readBackground: (input: ReadObjectLayerInput) => Promise<ObjectLayerBackground>;
  /** Lớp đối tượng của tầng. Lỗi ở đây là trạng thái `error` — ảnh gốc VẪN xem được. */
  readonly readObjectLayer: (input: ReadObjectLayerInput) => Promise<FloorLayerGraphRead | null>;
  /** N16 thô của tầng — nguồn của `useFloorLayer` (F-04x-2). Lỗi ở đây là trạng thái `error`. */
  readonly readLayer: (input: ReadObjectLayerInput) => Promise<FloorLayerDocument>;
  /**
   * Nhánh nội thất, đọc riêng.
   *
   * Đặc tả đòi "nhánh nội thất lỗi trong khi cửa vẫn xong" phải hiện MỘT hàng
   * cần chú ý chứ không chặn cả màn, nên nó phải là một lượt đọc RIÊNG: gộp nó
   * vào `readObjectLayer` thì một lỗi nhận diện ghế sofa sẽ xoá sạch chín cửa
   * đã duyệt khỏi màn hình.
   */
  readonly readFurnitureBranch: (input: ReadObjectLayerInput) => Promise<null>;
  /** Đồ thị đang sửa — nơi `commit` vừa ghi vào. */
  readonly graph: ObjectLayerGraphPort;
  /**
   * Dòng bộ mẫu của tầng.
   *
   * Đồ thị không mang được hai thứ: loại con của một món nội thất, và toạ độ dò
   * được của đối tượng CHƯA GẮN (`Opening` của đồ thị bắt buộc có `wallId`).
   * Chúng đi qua cổng cùng đường với đồ thị, nên một tầng không có đối tượng
   * nào thật sự đọc ra con số 0 — chứ không mượn một bảng toàn cục.
   */
  readonly seed: readonly ObjectSeedEntry[];
  /** Client của bộ lưu lớp (`useFloorLayerAutosave`). Vắng thì hook dùng client chung. */
  readonly apiClient?: ApiClient;
  /** Ai đang thao tác — đi vào `Command.actorId` và nhật ký hoạt động. */
  readonly actorId: string;
  /** Mốc giờ hiện tại. Tiêm được để test không phụ thuộc đồng hồ thật. */
  readonly now: () => number;
  /** Ngưỡng tin cậy của dự án (N5). Vắng → 0,75 của đặc tả (G32). */
  readonly readConfidenceThreshold?: ReadConfidenceThreshold;
}

export interface CreateObjectLayerReviewGatewayOptions {
  readonly apiClient?: ApiClient;
  readonly graph?: ObjectLayerGraphPort;
  /**
   * Dòng bộ mẫu. Vắng mặt thì RỖNG: dữ liệu thật đọc từ đồ thị, bảng mẫu 21 đối tượng
   * chỉ thuộc về cổng giả (B-V6-13 — trước đó dòng mồ côi `D-009` hiện trên mọi tầng).
   */
  readonly seed?: readonly ObjectSeedEntry[];
  readonly actorId?: string;
  readonly now?: () => number;
}

/**
 * Người thực hiện mặc định khi nơi gọi chưa truyền ai.
 *
 * Một chuỗi ĐẶT TÊN chứ không phải chuỗi rỗng: `validateCommands` từ chối lệnh
 * thiếu `actorId`, nên một mặc định rỗng sẽ làm mọi lệnh hỏng ở bước `validate`
 * thay vì hỏng ở chỗ người nối dây quên truyền.
 */
export const OBJECT_LAYER_DEFAULT_ACTOR_ID = 'object-layer-reviewer';

/** Cổng thật — thứ container lớp 3 gọi. */
export function createObjectLayerReviewGateway(
  options: CreateObjectLayerReviewGatewayOptions = {},
): ObjectLayerReviewGateway {
  const apiClient = options.apiClient ?? createAppApiClient();
  const graph: ObjectLayerGraphPort = options.graph ?? {
    read: () => useStore.getState().spatial,
  };
  return {
    apiClient,
    supports: {
      readBackground: true,
      readObjectGraph: true,
      writeObjectGraph: true,
      persistObjectLayer: true,
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

    readObjectLayer: async (input) => {
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
    readFurnitureBranch: () => Promise.resolve(null),

    graph,
    seed: options.seed ?? [],

    actorId: options.actorId ?? OBJECT_LAYER_DEFAULT_ACTOR_ID,
    now: options.now ?? ((): number => Date.now()),
    readConfidenceThreshold: (input) => readProjectConfidenceThreshold(apiClient.projectSettings, input),
  };
}

/* -------------------------------------------------------------------------- */
/* Bộ mẫu — chỗ story và test cắm vào (R-73).                                  */
/* -------------------------------------------------------------------------- */

/** Ảnh nền của bộ mẫu. Không phải đường dẫn thật, nên không phạm R-65. */
export const OBJECT_LAYER_SAMPLE_IMAGE = 'sample-floor-plan.png';

/** Khổ bản vẽ mẫu — bao trọn lưới 12.500 × 8.800 mm của bộ mẫu, có lề. */
export const OBJECT_LAYER_SAMPLE_DRAWING_WIDTH_MM = 13000;
export const OBJECT_LAYER_SAMPLE_DRAWING_HEIGHT_MM = 9300;

/** Cách bài kiểm ép một cảnh cụ thể, không sửa mã. */
export interface ObjectLayerGatewaySeed {
  /** Đồ thị cổng trả về. Vắng mặt thì cổng đọc đồ thị bộ mẫu. */
  readonly graph?: NormalizedSpatial | null;
  /** Dòng bộ mẫu đi kèm đồ thị đó. Vắng mặt thì dùng bộ mẫu 21 đối tượng. */
  readonly seed?: readonly ObjectSeedEntry[];
  /** `true` thì `readBackground` ném — ảnh nền mất, lớp đối tượng thì không. */
  readonly failReadBackground?: boolean;
  /** `true` thì `readObjectLayer` ném — đúng cảnh `error` của bảy kịch bản. */
  readonly failReadObjectLayer?: boolean;
  /** `'unresolved'` thì N16 giả mang tỉ lệ tạm — story "Tỉ lệ tạm" (F-04x-2). */
  readonly scaleStatus?: 'unresolved';
  /** `true` thì riêng nhánh nội thất ném — cửa vẫn xong, màn KHÔNG bị chặn. */
  readonly failFurnitureBranch?: boolean;
  /** `true` thì ảnh nền chưa có — canvas vẽ khung xám chờ. */
  readonly withoutImage?: boolean;
  /** Cờ `supports.persistObjectLayer` của bộ mẫu (mặc định `true`). */
  readonly canPersist?: boolean;
  /** Client cho bộ lưu lớp. Vắng thì hook dùng client chung (mock trong test/story). */
  readonly apiClient?: ApiClient;
  readonly actorId?: string;
  readonly now?: () => number;
}

/** Cổng có dữ liệu — dùng chung giữa test và story, không bịa bảng dữ liệu thứ hai (R-70). */
export function createMockObjectLayerReviewGateway(
  seed: ObjectLayerGatewaySeed = {},
): ObjectLayerReviewGateway {
  const canPersist = seed.canPersist ?? true;
  const readGraph = (): NormalizedSpatial | null =>
    seed.graph === undefined ? OBJECT_LAYER_SAMPLE_GRAPH : seed.graph;

  return {
    ...(seed.apiClient === undefined ? {} : { apiClient: seed.apiClient }),
    supports: {
      readBackground: true,
      readObjectGraph: true,
      writeObjectGraph: true,
      persistObjectLayer: canPersist,
    },

    readBackground: () => {
      if (seed.failReadBackground === true) {
        return Promise.reject(new Error('Không tải được bản vẽ gốc của tầng.'));
      }

      const hasImage = seed.withoutImage !== true;

      return Promise.resolve({
        imageUrl: hasImage ? OBJECT_LAYER_SAMPLE_IMAGE : null,
        imageAlt: backgroundImageAlt(OBJECT_LAYER_SAMPLE_LEVEL.name),
        widthMm: hasImage ? OBJECT_LAYER_SAMPLE_DRAWING_WIDTH_MM : null,
        heightMm: hasImage ? OBJECT_LAYER_SAMPLE_DRAWING_HEIGHT_MM : null,
      });
    },

    readObjectLayer: () => {
      if (seed.failReadObjectLayer === true) {
        return Promise.reject(new Error(OBJECT_LAYER_TEXT.errorMessage));
      }

      const stored = readGraph();

      return Promise.resolve(stored === null ? null : { floorRevisions: {}, graph: stored });
    },

    readLayer: ({ floorId }) => {
      if (seed.failReadObjectLayer === true) {
        return Promise.reject(new Error(OBJECT_LAYER_TEXT.errorMessage));
      }

      return mockFloorLayerDocument(readGraph(), floorId, seed.scaleStatus);
    },

    readFurnitureBranch: () => {
      if (seed.failFurnitureBranch === true) {
        return Promise.reject(new Error(OBJECT_LAYER_TEXT.furnitureAttention));
      }

      return Promise.resolve(null);
    },

    graph: { read: readGraph },
    seed: seed.seed ?? OBJECT_LAYER_SEED,

    actorId: seed.actorId ?? OBJECT_LAYER_DEFAULT_ACTOR_ID,
    now: seed.now ?? ((): number => Date.now()),
  };
}

/* -------------------------------------------------------------------------- */
/* Quy đổi mm → px và khung nhìn (R-07).                                       */
/* -------------------------------------------------------------------------- */

/** Tỷ lệ dùng khi tầng CHƯA hiệu chỉnh: một milimét là một điểm ảnh. */
const UNCALIBRATED_SCALE: MillimetresPerPixel = millimetresPerPixel(1);

/** Tỷ lệ của tầng, dạng số mà hợp đồng canvas nhận. */
export const millimetresPerPixelOf = (level: Level | null): MillimetresPerPixel =>
  level?.scaleMillimetresPerPixel ?? UNCALIBRATED_SCALE;

/** Bộ quy đổi của một tầng — `scaleFromRatio` là hàm DUY NHẤT làm việc này (R-61). */
export const scaleOfLevel = (level: Level | null): Scale =>
  scaleFromRatio(millimetresPerPixelOf(level));

/** Khổ bản vẽ tính bằng pixel. `null` khi chưa có bản vẽ nào. */
export interface DrawingSizePx {
  readonly width: number;
  readonly height: number;
}

/** Khổ ảnh bản vẽ tính bằng pixel. `null` khi chưa có bản vẽ nào. */
export function drawingSizeOf(
  background: ObjectLayerBackground | undefined,
  level: Level | null,
): DrawingSizePx | null {
  if (background === undefined || background.widthMm === null || background.heightMm === null) {
    return null;
  }

  const scale = scaleOfLevel(level);

  return {
    width: scale.millimetresToPixels(millimetres(background.widthMm)),
    height: scale.millimetresToPixels(millimetres(background.heightMm)),
  };
}

/** Khung chữ nhật mà `flyToBounds` của R-07 nhận. */
export interface ObjectLayerBounds {
  readonly minX: number;
  readonly minY: number;
  readonly maxX: number;
  readonly maxY: number;
}

/**
 * Hộp bao của một dãy điểm.
 *
 * Repo chưa có hàm nào làm việc này ở `src/domain` hay `src/lib` — màn QC anh em
 * cũng phải tự viết (`wallLayerReviewGateway.ts#boundsOfPoints`). Viết ở tầng
 * cổng chứ không ở view, và là phép hình học DUY NHẤT của file này.
 */
export function boundsOfPoints(points: readonly Point[]): ObjectLayerBounds | null {
  const first = points[0];

  if (first === undefined) {
    return null;
  }

  let minX = first.x;
  let minY = first.y;
  let maxX = first.x;
  let maxY = first.y;

  for (const point of points) {
    minX = Math.min(minX, point.x);
    minY = Math.min(minY, point.y);
    maxX = Math.max(maxX, point.x);
    maxY = Math.max(maxY, point.y);
  }

  return { minX, minY, maxX, maxY };
}

/** Khung nhìn của một tường chủ, tính bằng pixel — đích của lượt bay R-07. */
export function wallBoundsPx(outline: readonly Point[], level: Level | null): ObjectLayerBounds | null {
  const scale = scaleOfLevel(level);

  return boundsOfPoints(
    outline.map((point) => ({
      x: scale.millimetresToPixels(millimetres(point.x)),
      y: scale.millimetresToPixels(millimetres(point.y)),
    })),
  );
}

/* -------------------------------------------------------------------------- */
/* Hai phép quy đổi mà hook cần, và lượt gắn của đối tượng chưa có tường.       */
/* -------------------------------------------------------------------------- */

/**
 * Vị trí mới của Slider thành `offsetMm` mà `opening.move` của S-07 nhận.
 *
 * `offsetOnWall` của `shared.ts` là hàm DUY NHẤT làm phép quy đổi này trong
 * repo — hook không nhân chia gì, nó chỉ đưa fraction vào đây (R-61).
 */
export const offsetForPosition = (
  object: AttachedReviewObject,
  wall: SolidWall,
  position: RelativePosition,
): number =>
  offsetOnWall({ ...attachedOpeningOfObject(object, wall), relativePosition: position }, wall);

/**
 * Đầu vào của lệnh `opening.add` cho một đối tượng CHƯA GẮN, hoặc `null` khi
 * không có tường nào nhận nó.
 *
 * Ba bước, cả ba là M-08, màn không tự tìm tường và không tự tính vị trí gắn:
 *
 * 1. `findOrphans` nêu tường ĐÁNG GỢI Ý và fraction trên tường đó. Bán kính gợi
 *    ý (`OPENING_RULES.orphanSuggestionRadiusMm`, 1500 mm) rộng hơn bán kính
 *    gắn tự động (`DEFAULT_ATTACH_RADIUS_MM`, 150 mm) đúng như domain đã thiết
 *    kế: tự động thì phải chắc chắn, còn gợi ý thì có người xem lại.
 * 2. `placeOnWall` đổi fraction đó thành toạ độ tuyệt đối trên tim tường.
 * 3. `attachToWall` với BÁN KÍNH MẶC ĐỊNH xác nhận điểm ấy thật sự gắn được —
 *    đây là lượt kiểm mà đặc tả đòi ("hành động gọi `attachToWall` với
 *    `DEFAULT_ATTACH_RADIUS_MM`"), và cũng đúng lượt kiểm mà
 *    `createAddOpeningCommand` sẽ chạy lại bên trong nó.
 */
export function attachOrphanToNearestWall(
  entry: ObjectSeedEntry,
  graph: NormalizedSpatial,
  level: Level,
  seed: readonly ObjectSeedEntry[] = OBJECT_LAYER_SEED,
): AddOpeningInput | null {
  if (entry.layer === 'furniture' || entry.tracedCentre === null) {
    return null;
  }

  const walls = solidWallsOf(graph, level);
  const report = orphanReportsOf(domainOpeningsOf(graph, level, seed), walls).find(
    (candidate) => candidate.opening.id === entry.entityId,
  );

  if (report === undefined || report.suggestedWallId === null || report.suggestedPosition === null) {
    return null;
  }

  const wall = walls.find((candidate) => candidate.id === report.suggestedWallId);

  if (wall === undefined) {
    return null;
  }

  const centre = positionOnWall(wall, report.suggestedPosition);
  const traced = tracedOpeningOf(entry);
  const confirmed = attachObjectToWall(
    { ...traced, centre: toPointMm(centre) },
    walls,
    DEFAULT_ATTACH_RADIUS_MM,
  );

  if (confirmed.wallId === null) {
    return null;
  }

  return {
    id: entry.entityId as OpeningId,
    levelId: level.id,
    kind: entry.layer === 'window' ? 'window' : 'door',
    centre,
    widthMm: entry.widthMm,
    heightMm: entry.heightMm,
    sillHeightMm: entry.sillHeightMm ?? OPENING_RULES.doorSillHeightMm,
    swing: entry.swing,
  };
}

/* -------------------------------------------------------------------------- */
/* Thêm tay — hành động của nút "thêm thủ công" ở trạng thái rỗng.              */
/* -------------------------------------------------------------------------- */


/**
 * Khuôn kích thước của một cửa đơn thêm tay — ĐỌC RA từ bộ mẫu, không gõ tay.
 *
 * Bộ mẫu là nơi duy nhất viết "cửa đi 900 × 2.200 mm" (đặc tả gốc); lấy lại từ
 * đó thay vì viết con số thứ hai giữ cho hai chỗ không bao giờ lệch (R-71).
 * `null` khi bộ mẫu không có cửa đơn nào — lúc đó màn không đề nghị gì cả thay
 * vì bịa một kích thước.
 */
const MANUAL_DOOR_TEMPLATE: ReviewObject | null =
  OBJECT_LAYER_FIXTURE_OBJECTS.find((object) => object.subtype === 'singleDoor') ?? null;

/** Mẫu cửa sổ thêm tay — cửa sổ đầu tiên của bộ mẫu (kích thước + cao độ bệ thật). */
const MANUAL_WINDOW_TEMPLATE: ReviewObject | null =
  OBJECT_LAYER_FIXTURE_OBJECTS.find((object) => object.layer === 'window') ?? null;

/**
 * Đề nghị MỘT cửa đơn thêm tay, hoặc `null` khi tầng chưa có tường nào để đặt.
 *
 * Màn KHÔNG tự tính vị trí gắn và KHÔNG tự kiểm chồng lấn (CẤM TUYỆT ĐỐI): nó
 * đề nghị đúng một chỗ — giữa tim đoạn tường đầu tiên của tầng, toạ độ do
 * `placeOnWall` của M-08 trả — rồi để `createAddOpeningCommand` chạy
 * `attachToWall` + `validateOpening` phán quyết. Lời từ chối của M-08 đi thẳng
 * tới người duyệt; màn không đi tìm một tường thứ hai để "chữa" nó.
 *
 * Đối tượng thêm tay KHÔNG mang cờ duyệt: `createAddOpeningCommand` gắn
 * `AUTHORED_BY_HAND` (`reviewed: false`), và A5 giữ nguyên — chỉ lệnh duyệt của
 * người mới đặt `reviewed: true`.
 *
 * Mã máy là mã MỚI của `createId`, không suy từ bảng mẫu: kiểm trùng mã chạy
 * trên cả đồ thị, nên mã `D-000001DOOR` suy từ bảng mẫu bị từ chối ngay ở tầng
 * rỗng thứ hai (B-V6-41). Mã hiển thị do `objectsOf` đặt như mọi đối tượng khác.
 */
export function manualDoorProposalOf(
  graph: NormalizedSpatial,
  level: Level,
  id: OpeningId = createId('opening'),
): AddOpeningInput | null {
  return manualDoorProposalsOf(graph, level, id)[0] ?? null;
}

/*
 * Chỗ thử dọc tim tường cho lượt thêm tay: giữa trước, rồi các phần tư, phần tám. Cửa thứ hai
 * trở đi không được đè cửa đầu (giữa tường), nên màn thử lần lượt các chỗ này; `validateOpening`
 * vẫn là bên phán quyết từng chỗ.
 */
const MANUAL_SLOTS: readonly RelativePosition[] = [0.5, 0.25, 0.75, 0.125, 0.375, 0.625, 0.875].map(
  (fraction) => clampRelativePosition(AT_WALL_START + (AT_WALL_END - AT_WALL_START) * fraction),
);

/**
 * Mọi chỗ đề nghị cho một cửa thêm tay, theo thứ tự ưu tiên: tường `preferredWallId` (tường
 * đang chọn/được tô) trước, rồi các tường còn lại theo thứ tự của tầng; trên mỗi tường thử
 * `MANUAL_SLOTS`. Toạ độ luôn là `placeOnWall` trên tim tường (M-08). Hook lấy chỗ ĐẦU TIÊN mà
 * `buildAddOpeningCommand` nhận — nhờ vậy thêm được cửa thứ hai trở đi trên 2D.
 */
export function manualDoorProposalsOf(
  graph: NormalizedSpatial,
  level: Level,
  id: OpeningId = createId('opening'),
  preferredWallId: WallId | null = null,
  kind: 'door' | 'window' = 'door',
): readonly AddOpeningInput[] {
  const template = kind === 'window' ? MANUAL_WINDOW_TEMPLATE : MANUAL_DOOR_TEMPLATE;

  if (template === null) {
    return [];
  }

  const walls = solidWallsOf(graph, level);
  const ordered = [
    ...walls.filter((wall) => wall.id === preferredWallId),
    ...walls.filter((wall) => wall.id !== preferredWallId),
  ];

  return ordered.flatMap((wall) =>
    MANUAL_SLOTS.map((slot) => ({
      id,
      levelId: level.id,
      kind,
      centre: positionOnWall(wall, slot),
      widthMm: template.widthMm,
      heightMm: template.heightMm,
      sillHeightMm:
        kind === 'window'
          ? (template.sillHeightMm ?? OPENING_RULES.windowSillMinMm)
          : OPENING_RULES.doorSillHeightMm,
      swing: template.swing,
    })),
  );
}

/** Bấm "Vẽ cửa" cách tim tường tới chừng này vẫn bắt vào tường đó: người bấm chuột, không phải máy dò. */
const DRAW_SNAP_RADIUS_MM = 600;

/** Nửa cạnh của món nội thất mới vẽ (600 × 600 mm) — người duyệt đổi loại ngay sau đó. */
const DRAWN_FURNITURE_HALF_MM = 300;

/**
 * Cửa đi/cửa sổ vẽ tại điểm bấm (K07): `attachToWall` của M-08 tìm tường gần nhất và chiếu điểm
 * lên tim tường; `null` khi không tường nào trong {@link DRAW_SNAP_RADIUS_MM}. `validateOpening`
 * vẫn phán quyết trong lệnh thêm.
 */
export function drawnOpeningProposalOf(
  graph: NormalizedSpatial,
  level: Level,
  at: Point,
  kind: 'door' | 'window',
  id: OpeningId = createId('opening'),
): AddOpeningInput | null {
  const template = kind === 'window' ? MANUAL_WINDOW_TEMPLATE : MANUAL_DOOR_TEMPLATE;

  if (template === null) {
    return null;
  }

  const walls = solidWallsOf(graph, level);
  const sillHeightMm =
    kind === 'window' ? (template.sillHeightMm ?? OPENING_RULES.windowSillMinMm) : OPENING_RULES.doorSillHeightMm;
  const attachment = attachObjectToWall(
    {
      id,
      kind,
      widthMm: template.widthMm,
      heightMm: template.heightMm,
      sillHeightMm: millimetres(sillHeightMm),
      swing: template.swing,
      centre: toPointMm(at),
    },
    walls,
    DRAW_SNAP_RADIUS_MM,
  );
  const placed = attachment.opening;
  const wall = walls.find((candidate) => candidate.id === attachment.wallId);

  if (wall === undefined || placed.wallId === null) {
    return null;
  }

  return {
    id,
    levelId: level.id,
    kind,
    centre: positionOnWall(wall, placed.relativePosition),
    widthMm: template.widthMm,
    heightMm: template.heightMm,
    sillHeightMm,
    swing: template.swing,
  };
}

/**
 * Món nội thất vẽ trên bản vẽ (K07), loại "đồ đạc khác": bấm cho khung 600 × 600 mm quanh điểm,
 * kéo (B3) cho đúng hộp từ `at` tới góc đối diện `corner`.
 *
 * Tâm là mm nguyên và hộp đối xứng quanh tâm với nửa cạnh nguyên: máy chủ chỉ nhận mm nguyên
 * (`Mm` = `StrictInt`), còn điểm bấm đổi từ pixel ra mm lẻ.
 */
export function drawnFurnitureInputOf(level: Level, at: Point, corner?: Point): AddFurnitureInput {
  const far = corner ?? at;
  const centre = { x: Math.round((at.x + far.x) / 2), y: Math.round((at.y + far.y) / 2) };
  const halfOf = (span: number): number =>
    corner === undefined ? DRAWN_FURNITURE_HALF_MM : Math.max(1, Math.round(Math.abs(span) / 2));
  const half = { x: halfOf(far.x - at.x), y: halfOf(far.y - at.y) };

  return {
    id: createId('furniture'),
    levelId: level.id,
    kind: 'other',
    centre,
    boundingBox: {
      min: { x: centre.x - half.x, y: centre.y - half.y },
      max: { x: centre.x + half.x, y: centre.y + half.y },
    },
    rotationDeg: 0,
  };
}

/** Cỡ gửi lệnh đổi cỡ: số chẵn mm, để hộp co giãn quanh tâm nguyên vẫn ra mm nguyên (B3). */
export const evenMillimetres = (valueMm: number): number => Math.max(2, Math.round(valueMm / 2) * 2);

/* -------------------------------------------------------------------------- */
/* Toạ độ vẽ — phía sản xuất cho canvas (T6/T7).                               */
/* -------------------------------------------------------------------------- */

/*
 * Vì sao toạ độ vẽ được TÍNH SẴN ở đây.
 *
 * `ObjectLayerCanvas` vẽ bằng ký hiệu kiến trúc, không phải khung bao — và một
 * ký hiệu cần biết tâm, hướng chạy của tường chủ, bề rộng lỗ mở và BỀ DÀY
 * TƯỜNG. Cả bốn là hình học, và A15/R-60 đặt hình học ở viewmodel chứ không ở
 * view. Không một phép nào dưới đây được viết mới: tâm là `placeOnWall` của
 * M-08, hướng là `wallBearing` của `src/domain/walls/edit.ts`, hộp bao là
 * `boxAround` của `src/lib/input/dragDrop.ts`, quy đổi là `scale.millimetresToPixels`.
 */

/** Ngược của {@link toPixelPoint}: điểm bấm (pixel bản vẽ) thành milimét — chế độ vẽ (K07). */
export const toDrawingPoint = (point: PixelPoint, scale: Scale): Point => ({
  x: scale.pixelsToMillimetres(pixels(point.x)),
  y: scale.pixelsToMillimetres(pixels(point.y)),
});

/** Một điểm milimét của bản vẽ, đọc bằng pixel đúng cách `<svg viewBox>` đọc nó. */
export const toPixelPoint = (point: Point, scale: Scale): PixelPoint => ({
  x: scale.millimetresToPixels(millimetres(point.x)),
  y: scale.millimetresToPixels(millimetres(point.y)),
});

/** Điểm giữa hai điểm — chỗ `MeasurementLabel` đặt nhãn số đo. */
export const midpointPx = (from: PixelPoint, to: PixelPoint): PixelPoint => ({
  x: (from.x + to.x) / 2,
  y: (from.y + to.y) / 2,
});

/** Hộp bao chưa xoay của một đối tượng, tính bằng pixel. */
function boundsPxOf(centreMm: Point, widthMm: number, depthMm: number, scale: Scale): PixelRect {
  const box = boxAround(centreMm, widthMm, depthMm);
  const min = toPixelPoint(box.min, scale);
  const max = toPixelPoint(box.max, scale);

  return { x: min.x, y: min.y, width: max.x - min.x, height: max.y - min.y };
}

/**
 * Toạ độ vẽ của MỘT đối tượng.
 *
 * `depthPx` là BỀ DÀY TƯỜNG CHỦ, không phải `heightMm`: một ký hiệu cửa trên
 * mặt bằng cắt ngang hết bề dày tường, còn `heightMm` là chiều cao đứng và
 * không xuất hiện trên mặt bằng. Đối tượng CHƯA GẮN không có tường chủ để đọc
 * bề dày, nên nó rơi về chiều sâu của chính nó — và `isOrphan` nói rõ cho view
 * biết đó là trường hợp nào.
 */
export function toObjectPlacement(
  object: ReviewObject,
  wall: SolidWall | null,
  scale: Scale,
  swingsInward = false,
): ObjectPlacementViewModel {
  const attached = isOrphanObject(object) ? null : object;
  const centreMm =
    attached === null || wall === null
      ? (object as OrphanReviewObject).tracedCentre
      : positionOnWall(wall, attached.relativePosition);
  const depthMm = wall === null ? object.heightMm : wall.thicknessMm;

  return {
    id: object.id,
    layer: object.layer,
    subtype: object.subtype,
    swing: object.swing,
    centrePx: toPixelPoint(centreMm, scale),
    angleDeg: wall === null ? ownRotationDegOf(object) : wallBearing(wall),
    ...(swingsInward && wall !== null ? { swingsInward: true } : {}),
    widthPx: scale.millimetresToPixels(millimetres(object.widthMm)),
    depthPx: scale.millimetresToPixels(millimetres(depthMm)),
    boundsPx: boundsPxOf(centreMm, object.widthMm, depthMm, scale),
    codeLabel: `#${object.id}`,
    isOrphan: isUnattachedOpening(object),
    /* Cùng nguồn với hàng danh sách: canvas viền chú ý / làm mờ đã duyệt thống nhất với panel. */
    statusCode: listStatusCodeOf(object, isUnattachedOpening(object)),
    ...(object.suggested === true ? { isSuggested: true } : {}),
  };
}

/**
 * Mã các cửa bản lề mở về mặt `inward` (+y cục bộ của ký hiệu): cùng luật với cảnh 3D
 * (`swingDirectionOf`) và cờ "Đổi hướng mở", để cung cửa 2D không vẽ ngược mô hình 3D.
 */
export function inwardSwingIdsOf(graph: Pick<SpatialGraph, 'walls' | 'rooms' | 'openings'> | null): ReadonlySet<string> {
  if (graph === null) return new Set();
  const wallById = new Map(graph.walls.map((wall) => [wall.id, wall] as const));
  const ids = new Set<string>();
  for (const opening of graph.openings) {
    if (opening.kind !== 'door') continue;
    const inward = swingDirectionOf(opening, wallById.get(opening.wallId), graph.rooms) === 'inward';
    if (inward !== (opening.reversed === true)) ids.add(opening.id);
  }
  return ids;
}

/** Toạ độ vẽ của mọi đối tượng đang thấy. */
export function objectPlacementsOf(
  objects: readonly ReviewObject[],
  walls: readonly SolidWall[],
  level: Level | null,
  inwardSwingIds: ReadonlySet<string> = new Set(),
): readonly ObjectPlacementViewModel[] {
  const scale = scaleOfLevel(level);
  const wallById = new Map(walls.map((wall) => [wall.id, wall] as const));

  return objects.map((object) =>
    toObjectPlacement(
      object,
      isOrphanObject(object) ? null : (wallById.get(object.hostWallId) ?? null),
      scale,
      inwardSwingIds.has(object.id),
    ),
  );
}

/**
 * Số đo tới HAI ĐẦU tường trong lúc kéo Slider vị trí.
 *
 * Hai con số tới từ `openingSpan` của M-08 và `centrelineLength` của
 * `src/domain/walls` — cùng hai hàm mà tầng lệnh dùng để kiểm, nên nhãn trên
 * canvas không thể lệch khỏi thứ lệnh sẽ chấp nhận.
 */
export function toDragMeasurement(
  object: AttachedReviewObject,
  wall: SolidWall,
  level: Level | null,
  state: MeasurementState,
): ObjectDragMeasurement {
  const scale = scaleOfLevel(level);
  const span = spanOfObject(wall, attachedOpeningOfObject(object, wall));
  const wallStartPx = toPixelPoint(wall.centreline.start, scale);
  const wallEndPx = toPixelPoint(wall.centreline.end, scale);
  const objectPx = toPixelPoint(positionOnWall(wall, object.relativePosition), scale);

  return {
    objectId: object.id,
    state,
    wallStartPx,
    wallEndPx,
    objectPx,
    midToStartPx: midpointPx(wallStartPx, objectPx),
    midToEndPx: midpointPx(objectPx, wallEndPx),
    distanceToStartLabel: formatMillimetres(span.lowMm),
    distanceToEndLabel: formatMillimetres(centrelineLength(wall) - span.highMm),
  };
}
