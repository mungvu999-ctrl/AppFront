/**
 * Nửa "suy nghĩ" của màn S-13 "Lớp đối tượng" — mọi thứ ba view của màn cần, đã
 * xong. `objectLayerTypes.ts` là hợp đồng props duy nhất; hook này trả về đúng
 * {@link ObjectLayerReviewModel}.
 *
 * ## Đường ghi (A10)
 *
 * Không một dòng nào gọi `set()` hay `_applyPatches()`. Mọi thay đổi đi: lệnh
 * S-07 (hoặc một trong ba lệnh QĐ-3 dựng bằng nguyên thuỷ công khai) →
 * `dispatch`/`runTransaction` → `SpatialPort.applyPatches` = `commit(patches,
 * label)` → store. Xem `objectLayerReviewGateway.ts` để có lý do và trích dẫn.
 *
 * ## Trạng thái máy chủ (R-64)
 *
 * Không `useState` nào giữ cờ đang-tải hay cờ hỏng. BA lượt đọc, ba khoá của
 * `src/lib/query`: ảnh nền (`drawing.byFloor`), lớp đối tượng
 * (N16, `layer.byFloor` qua `useFloorLayer`), và nhánh nội thất (`progress.byFloor`). Mọi lượt ghi gọi
 * `applyInvalidation(queryClient, …)` với đúng thao tác đã khai trong
 * `invalidationMap`, không gọi `invalidateQueries` trần. `useState` ở đây chỉ
 * giữ trạng thái của riêng giao diện: ba cờ lớp, tập chip lọc, ba nhóm gấp, cờ
 * thu gọn, cờ "chỉ hiện mục dưới ngưỡng", đối tượng đang rê chuột và nhóm loại
 * đang chọn.
 *
 * ## Không công thức tự chế (R-61)
 *
 * - Gắn, kiểm chồng lấn, chiếu vị trí, đo đoạn tường: `attachToWall`,
 *   `placeOnWall`, `openingCentre`, `validateOpening`, `openingSpan`,
 *   `findOrphans` của M-08, gọi qua tầng cổng.
 * - Trôi lỗ mở khi tường đổi: `reflowOpenings` của M-09.
 * - Quy đổi fraction ↔ `offsetMm`: `offsetOnWall`/`relativePositionOf` của
 *   `src/lib/commands/business/shared.ts`.
 * - Ngưỡng độ tin cậy: `confidenceLevel` của `@/lib/format/semantic`.
 * - Số: `formatLength`/`formatNumber` qua các hàm định dạng của tầng cổng.
 * - Màu: `src/lib/coloring`.
 * Hook này không có một phép nhân, chia hay làm tròn nào.
 *
 * ## D-06 — hai mươi lượt kéo, một bước lịch sử
 *
 * Lượt kéo Slider phát MỘT lệnh `opening.move` (hoặc `furniture.move`) mỗi lần
 * giá trị đổi, và `createHistoryStack` gộp chúng khi hai lệnh liên tiếp cùng
 * loại, cùng người, cùng thực thể và cách nhau dưới `MERGE_WINDOW_MS`
 * (= `COALESCE_WINDOW_MS` = 400 ms). Không con số 400 nào viết ở màn (R-71).
 *
 * ## Bàn phím (A12, R-54)
 *
 * Không một `addEventListener('keydown')` nào. `D`/`W`/`F` đặt nhóm loại,
 * `1`/`2`/`3` đổi loại trong nhóm, `Mod+Z` hoàn tác, và `Escape` đóng lớp trên
 * cùng — lớp trên cùng của màn này là thanh tra bên phải, nên `Escape` bỏ vùng
 * chọn. Nó chỉ được đăng ký KHI có đối tượng đang chọn; lúc không có gì để
 * đóng, phím rơi xuống tầng `global` của `shortcutRegistry` như lời hứa A12
 * yêu cầu.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';

import { displayCodesOf, keepDisplayCodes, sortByDisplayCode } from '@/domain/spatial/ids';
import { denormalizeSpatial } from '@/domain/spatial/normalize';
import type { EntityId, FurnitureKind, FurnitureVariant, Level, SwingDirection, WallId } from '@/domain/spatial/types';
import type { RelativePosition } from '@/domain/openings/types';
import { millimetres } from '@/domain/units/types';
import type { Wall as SolidWall } from '@/domain/walls/types';
import { useFloorLayerAutosave } from '@/hooks/useAutosave';
import { isFloorNotFound, useFloorLayer } from '@/hooks/useFloorLayer';
import { useCanvasViewport } from '@/hooks/useCanvasViewport';
import { appNotificationBus } from '@/hooks/useNotifications';
import { useProjectConfidenceThreshold } from '@/hooks/useProjectConfidenceThreshold';
import { useSaveIndicator } from '@/hooks/useSaveIndicator';
import { useShortcut } from '@/hooks/useShortcut';
import { can } from '@/lib/auth/permissions';
import { newestEntryId } from '@/lib/commands/history';
import type { Command } from '@/lib/commands/types';
import type { CommandContext } from '@/lib/commands/business/shared';
import type { ShortcutRegistry } from '@/lib/input/shortcutRegistry';
import type { NotificationBus } from '@/lib/mutations/notificationBus';
import { applyInvalidation } from '@/lib/query/invalidation';
import { queryKeys } from '@/lib/query/queryKeys';
import { planReveals, revealAnchor, describeSelection } from '@/lib/selection/revealPolicy';
import {
  combineSelection,
  selectSingle,
  toggleSelection,
  type SelectionContext,
} from '@/lib/selection/selectionOps';
import { createSelectionChannel } from '@/lib/selection/syncChannel';
import type { ColorTokenName } from '@/lib/coloring/scales';
import { scaleStateOf } from '@/lib/viewmodel/provisionalScale';
import { ROUTES } from '@/routes/paths';
import { useStore } from '@/store';
import { currentSelection } from '@/store/commit';
import type { ProjectRole } from '@/types/project';

import {
  attachOrphanToNearestWall,
  buildAddFurnitureCommand,
  buildAddOpeningCommand,
  manualDoorProposalsOf,
  buildApproveObjectCommand,
  buildChangeFurnitureKindCommand,
  buildChangeObjectKindCommand,
  buildChangeObjectSwingCommand,
  buildDeleteFurnitureCommand,
  buildDeleteOpeningCommand,
  buildMoveFurnitureCommand,
  buildMoveOpeningCommand,
  buildResizeFurnitureCommand,
  buildRotateFurnitureCommand,
  commandContextOf,
  confidenceLegendOf,
  confidenceModeOf,
  countsOf,
  createObjectLayerDispatchDeps,
  createObjectLayerReviewGateway,
  createObjectUndoTicket,
  dataLayerTokens,
  QUARTER_TURN_DEG,
  pendingSuggestionsLabel,
  approvableObjectsOf,
  approveConfidentLabelOf,
  approveUnsureLabelOf,
  confirmUnsureLabelOf,
  reviewBreakdownLabelOf,
  unsureObjectsOf,
  confidentObjectsOf,
  rejectedSuggestionsToast,
  drawnFurnitureInputOf,
  drawnOpeningProposalOf,
  evenMillimetres,
  graphWallsOf,
  isLowConfidenceObject,
  OBJECT_LAYER_CONFIDENCE_THRESHOLD,
  layerTreeTotalLabel,
  levelOfGraph,
  filteredCountLabel,
  lowConfidenceNotice,
  lowConfidenceObjectsOf,
  inwardSwingIdsOf,
  millimetresPerPixelOf,
  objectPlacementsOf,
  objectsOf,
  OBJECT_LAYER_TEXT,
  offsetForPosition,
  positionOnWall,
  reviewCounterOf,
  reviewProgressLabel,
  siblingOpeningsOf,
  solidWallsOf,
  toDragMeasurement,
  toObjectInspector,
  toObjectRow,
  toPaintSubject,
  runObjectCommand,
  runObjectTransaction,
  wallBoundsPx,
  wallOutlinesOf,
  boundsOfPoints,
  drawingSizeOf,
  scaleOfLevel,
  toDrawingPoint,
  toPixelPoint,
  type ObjectLayerBackground,
  type ObjectLayerDispatchDeps,
  type ObjectLayerGraphPort,
  type ObjectLayerReviewGateway,
} from './objectLayerReviewGateway';
import {
  OBJECT_SUBTYPES,
  OBJECT_SUBTYPE_LAYER,
  isOrphanObject,
  isUnattachedOpening,
  type ObjectLayerId,
  type ObjectLayerReviewModel,
  type ObjectLayerScreenState,
  type ObjectLayerVisibility,
  type ObjectReviewCounter,
  type HostWallOutlineViewModel,
  type ObjectSubtype,
  type PixelPoint,
  type ReviewObject,
} from './objectLayerTypes';
import {
  fitCanvasView,
  rotatedBounds,
  toFramePoint,
  toFrameRect,
  visibleDrawingRect,
  type CanvasFitRect,
  type CanvasFitSize,
  type CanvasFitView,
} from '../shared/canvasFit';
import { SAVE_BLOCKED_LABEL, useFloorLayerReadFailure } from '../shared/floorLayerReadFailure';
import { isQcCompare, setQcCompare, useQcCompare } from '../shared/qcCompare';
import { SCALE_LOCK_REASON } from '../shared/floorReviewGateModel';
import { useProvisionalScaleNotice } from '../shared/provisionalScaleNotice';
import { useScaleLock } from '../shared/useScaleLock';
import { arrowStepHandler } from '../WallLayerReview/listArrowKeys';

import { layerGateOf } from './layerGate';
import { focusBoundsOf, useQcViewMode } from '../shared/qcViewMode';
import { useLayerRuleIssues } from '../shared/useLayerRuleIssues';
import { objectReasonRank } from './objectReviewReasons';

/** Hàng đợi duyệt (Z/S-16): chưa duyệt trước, trong đó tin cậy thấp lên đầu. */
const byReviewQueue = (
  a: { readonly reviewed: boolean; readonly confidence: number },
  b: { readonly reviewed: boolean; readonly confidence: number },
): number => Number(a.reviewed) - Number(b.reviewed) || a.confidence - b.confidence;

/* -------------------------------------------------------------------------- */
/* Hợp đồng vào.                                                               */
/* -------------------------------------------------------------------------- */

export interface UseObjectLayerReviewOptions {
  readonly projectId: string;
  readonly floorId: string;
  readonly roles?: readonly ProjectRole[];
  /** Cổng dữ liệu tiêm được. Vắng mặt thì hook dựng cổng thật, đúng một lần. */
  readonly gateway?: ObjectLayerReviewGateway;
  /** Sổ phím tiêm được — bài kiểm dựng sổ riêng để không đụng sổ dùng chung. */
  readonly registry?: ShortcutRegistry;
  /** Ép thu gọn hai panel — cho story và bài kiểm muốn một câu trả lời cố định. */
  readonly forceCollapsed?: boolean;
  /** N3-08: ma doi tuong (ma hien thi hoac ma may) can chon va phong toi mot lan khi du lieu ve. */
  readonly focusId?: string | null;
  /** Bus thông báo — chỗ toast hoàn tác của A8 đi ra. */
  readonly notifications?: NotificationBus;
  /** Lối ra của dải tỉ lệ tạm (F-04x-2) — container truyền `onNavigate` của nó. */
  readonly onNavigate?: (path: string) => void;
}

/* -------------------------------------------------------------------------- */
/* Hằng của riêng hook.                                                        */
/* -------------------------------------------------------------------------- */

/** Loại thông báo của một lượt xoá — viết đúng một chỗ (R-71). */
const DELETE_NOTIFICATION_TYPE = 'objectLayerReview.deleteObject';
/** Toast "Hoàn tác" bị từ chối vì đã có bước mới hơn (BUG-579). */
const UNDO_REFUSED_NOTIFICATION_TYPE = 'objectLayerReview.undoRefused';
const UNDO_REFUSED_TEXT =
  'Chưa hoàn tác: một thay đổi sau đó đã sửa cùng đối tượng. Dùng Ctrl+Z để hoàn tác lần lượt.';
/** Lệnh sửa bị từ chối — câu lý do thay cho im lặng (BUG-590). */
const REFUSED_NOTIFICATION_TYPE = 'objectLayerReview.refused';

/** Loại thông báo của một lượt gắn vào tường gần nhất — viết đúng một chỗ (R-71). */
const ATTACH_NOTIFICATION_TYPE = 'objectLayerReview.attachToNearestWall';

/** Nửa cạnh khung bay tới chỗ lỗi quy chuẩn (P03), mm. */
const ISSUE_FLIGHT_HALF_MM = 2500;
/** Bán kính tối thiểu của dấu lỗi: theo màn hình và theo bản vẽ. */
const ISSUE_MARKER_MIN_SCREEN_PX = 18;
const ISSUE_MARKER_MIN_MM = 300;

/** Loại thông báo của một lượt thêm tay — viết đúng một chỗ (R-71). */
const ADD_NOTIFICATION_TYPE = 'objectLayerReview.addManually';

/** Ba lớp con bật hết lúc mở màn. */
const ALL_LAYERS_VISIBLE: ObjectLayerVisibility = { door: true, window: true, furniture: true };

/** Ba nhóm mở hết lúc mở màn. */
const NO_GROUPS_COLLAPSED: ObjectLayerVisibility = { door: false, window: false, furniture: false };

/** Chưa chip lọc nào bật. */
const NO_SUBTYPE_FILTERS: ReadonlySet<ObjectSubtype> = new Set<ObjectSubtype>();

const NO_OBJECTS: readonly ReviewObject[] = [];
/** Không bảng mã: đối tượng xếp theo chính mã hiển thị của nó (`id`). */
const NO_CODES: ReadonlyMap<string, string> = new Map();
const NO_SELECTION_IDS: readonly EntityId[] = [];

/* -------------------------------------------------------------------------- */
/* Phép ghép thuần — kiểm được mà không cần dựng hook.                          */
/* -------------------------------------------------------------------------- */

/**
 * Bảy trạng thái của A11, DẪN XUẤT từ dữ liệu chứ không phải bảy cờ rời rạc.
 *
 * Thứ tự quyết định là thứ tự trả lời: quyền trước, rồi vỏ màn, rồi lỗi, rồi
 * đang tải, rồi mới tới đếm. Nhánh nội thất lỗi KHÔNG đẩy màn sang `error`: nó
 * chỉ giữ màn ở `partial` để lớp nội thất hiện một hàng cần chú ý, đúng câu
 * "không chặn cả màn" của đặc tả.
 */
export function deriveScreenState(input: {
  readonly isViewerRole: boolean;
  readonly isCollapsed: boolean;
  readonly hasError: boolean;
  readonly isLoading: boolean;
  readonly hasFurnitureAttention: boolean;
  readonly counter: ObjectReviewCounter;
}): ObjectLayerScreenState {
  /* Người xem đang tải vẫn thấy khung chờ, không phải nhóm rỗng giả (17-D-010). */
  if (input.isViewerRole && !input.isLoading) {
    return 'forbidden';
  }

  if (input.isCollapsed) {
    return 'collapsed';
  }

  if (input.hasError) {
    return 'error';
  }

  if (input.isLoading) {
    return 'loading';
  }

  if (input.counter.total === 0) {
    return 'empty';
  }

  if (input.counter.reviewed === input.counter.total) {
    return input.hasFurnitureAttention ? 'partial' : 'success';
  }

  return 'partial';
}

/** Ba cờ lớp, tập chip lọc và cờ "chỉ hiện mục dưới ngưỡng" áp lên danh sách. */
export function applyObjectFilters(
  objects: readonly ReviewObject[],
  filters: {
    readonly layerVisibility: ObjectLayerVisibility;
    readonly subtypes: ReadonlySet<ObjectSubtype>;
    readonly lowConfidenceOnly: boolean;
  },
  threshold: number = OBJECT_LAYER_CONFIDENCE_THRESHOLD,
): readonly ReviewObject[] {
  return objects.filter((object) => {
    if (!filters.layerVisibility[object.layer]) {
      return false;
    }

    if (filters.subtypes.size > 0 && !filters.subtypes.has(object.subtype)) {
      return false;
    }

    /* Lọc bật: ẩn món đã duyệt và món máy chắc chắn (đã gom vào dòng "Duyệt cả N"); gợi ý và
       lỗ mở chưa gắn tường vẫn hiện vì phải xem tay. Đếm "máy chưa chắc" cùng luật {@link unsureObjectsOf}. */
    return !(
      filters.lowConfidenceOnly &&
      (object.reviewed ||
        (object.suggested !== true &&
          !isUnattachedOpening(object) &&
          !isLowConfidenceObject(object.confidence, threshold)))
    );
  });
}

/**
 * Ba ô 1/2/3 của một nhóm loại.
 *
 * Nhóm cửa đi có hai loại con, nhóm cửa sổ có một, nhóm nội thất có sáu — nên ô
 * thứ ba của hai nhóm đầu trống, và ba loại con cuối của nhóm nội thất không
 * có phím tắt. Danh sách cắt từ {@link OBJECT_SUBTYPES}, không gõ tay lần thứ hai.
 */
export const subtypeSlotsOf = (layer: ObjectLayerId): readonly ObjectSubtype[] =>
  OBJECT_SUBTYPES.filter((subtype) => OBJECT_SUBTYPE_LAYER[subtype] === layer);

/* -------------------------------------------------------------------------- */
/* Hook.                                                                       */
/* -------------------------------------------------------------------------- */

/** Khung nhìn chưa đo được khung: pixel bản vẽ đọc thẳng là pixel khung. */
const IDENTITY_VIEW: CanvasFitView = { x: 0, y: 0, zoom: 1 };

/**
 * "Vừa khung" chừa dải đáy cho chú giải nổi (`ObjectLayerCanvasLegend`, đáy-trái, cao ~36 px + lề
 * 16 px): mặt bằng căn giữa phần khung PHÍA TRÊN dải đó, nên chú giải không đè mép dưới bản vẽ.
 */

/** Cổng thật dựng đúng một lần cho suốt đời component. */
function useResolvedGateway(
  injected: ObjectLayerReviewGateway | undefined,
): ObjectLayerReviewGateway {
  const fallbackRef = useRef<ObjectLayerReviewGateway | null>(null);

  if (injected !== undefined) {
    return injected;
  }

  fallbackRef.current ??= createObjectLayerReviewGateway();

  return fallbackRef.current;
}

export function useObjectLayerReview(
  options: UseObjectLayerReviewOptions,
): ObjectLayerReviewModel {
  const { floorId, projectId } = options;
  const gateway = useResolvedGateway(options.gateway);
  const queryClient = useQueryClient();

  /* ---------------------------------------------------------------------- */
  /* Vai trò — trạng thái 6 vô hiệu MỌI hàm sửa, ở tầng hook.                */
  /* ---------------------------------------------------------------------- */

  const roles = options.roles ?? [];
  const canEditRole = can('edit', 'layer', { roles });
  const isViewerRole = !canEditRole;

  /* ---------------------------------------------------------------------- */
  /* Trạng thái của riêng giao diện.                                         */
  /* ---------------------------------------------------------------------- */

  const [layerVisibility, setLayerVisibility] = useState<ObjectLayerVisibility>(ALL_LAYERS_VISIBLE);
  const [subtypeFilters, setSubtypeFilters] = useState<ReadonlySet<ObjectSubtype>>(NO_SUBTYPE_FILTERS);
  /* Chip đếm lọc DANH SÁCH (K07, Codex P2): tách khỏi `layerVisibility` của bản vẽ. */
  const [listLayerFilter, setListLayerFilter] = useState<ObjectLayerId | null>(null);
  const [collapsedGroups, setCollapsedGroups] = useState<ObjectLayerVisibility>(NO_GROUPS_COLLAPSED);
  const [ownCollapsed, setOwnCollapsed] = useState(false);
  const [hoveredObjectId, setHoveredObjectId] = useState<string | null>(null);
  const [activeLayerOverride, setActiveLayerOverride] = useState<{ layer: ObjectLayerId; forId: string | null } | null>(null);
  /**
   * Đối tượng đang được kéo dọc tường.
   *
   * `MeasurementLabel` phân biệt "đang đo" với "đã chốt" bằng chính cờ này, và
   * `MeasurementState` của `useMeasurementLabel` là bộ ba giá trị duy nhất
   * trong repo cho việc đó — không đặt tên trạng thái thứ hai ở màn (R-71).
   */
  const [draggingObjectId, setDraggingObjectId] = useState<string | null>(null);
  /**
   * Đối tượng CHƯA GẮN đang được chọn.
   *
   * Vùng chọn của S-10 chạy trên `EntityId` của đồ thị, và một đối tượng chưa
   * gắn KHÔNG có mặt trong đồ thị (xem `buildObjectLayerGraph`) — `selectSingle`
   * vì thế từ chối nó và trả về vùng chọn rỗng, đúng như nó phải làm. Nên lượt
   * chọn một đối tượng chưa gắn được giữ ở đây, cạnh vùng chọn thật chứ không
   * lẫn vào nó, và hai đường không bao giờ cùng bật.
   */
  const [orphanSelection, setOrphanSelection] = useState<string | null>(null);
  /**
   * Cờ "chỉ hiện mục dưới ngưỡng tin cậy".
   *
   * `null` nghĩa là người dùng chưa đụng tới, và lúc đó câu trả lời là chính
   * đặc tả: trạng thái một phần mở màn với năm mục dưới ngưỡng ĐÃ LỌC SẴN. Một
   * `useState(false)` đơn giản sẽ không làm được điều đó vì lúc dựng hook chưa
   * có dữ liệu để biết có mục nào dưới ngưỡng hay không.
   */
  const [lowConfidenceChoice, setLowConfidenceChoice] = useState<boolean | null>(null);

  const isCollapsed = options.forceCollapsed ?? ownCollapsed;

  const onToggleCollapsed = useCallback(() => {
    setOwnCollapsed((previous) => !previous);
  }, []);

  /* ---------------------------------------------------------------------- */
  /* Ba lượt đọc máy chủ, TÁCH BẠCH (R-64).                                   */
  /* ---------------------------------------------------------------------- */

  const backgroundQuery = useQuery({
    queryKey: queryKeys.drawing.byFloor(floorId),
    queryFn: ({ signal }) => gateway.readBackground({ floorId, projectId, signal }),
  });

  /* N16 của tầng — `useFloorLayer` quyết định nó vào kho thế nào (F-04x-2). */
  const floorLayer = useFloorLayer({ floorId, projectId, read: gateway.readLayer });
  /*
   * Tầng thiếu tỷ lệ: bản vẽ và danh sách vẫn xem được, nhưng mọi hàm sửa và phím sửa tắt (UX-R1 r3).
   * Gọi SAU `useFloorLayer`: không vậy lượt đọc N16 mặc định đè cổng tiêm vào (xem `useFloorReview`).
   */
  const scaleLock = useScaleLock(projectId, floorId);
  const isScaleLocked = canEditRole && scaleLock.locked;
  const canEdit = canEditRole && !isScaleLocked;
  /* R10 làn S: mọi mm của ô mở suy từ tỷ lệ, nên dòng và thanh tra phải mang trạng thái tỷ lệ của tầng. */
  const objectScaleState = scaleStateOf(floorLayer.scaleStatus, floorLayer.scaleSource, floorLayer.scaleState);
  const provisionalScaleNotice = useProvisionalScaleNotice(
    floorLayer.scaleStatus,
    projectId,
    floorId,
    options.onNavigate,
    canEditRole,
  );
  const readFailure = useFloorLayerReadFailure(floorLayer, projectId, options.onNavigate);

  /*
   * Nhánh nội thất, khoá RIÊNG.
   *
   * `progress.byFloor` là khoá "tiến độ nhận diện của tầng" và nó KHÔNG nằm
   * trong `invalidationMap.editWall`, nên một lượt duyệt cửa không xoá mất câu
   * "nhận diện nội thất lỗi, cửa vẫn xong". Gộp nhánh này vào `readObjectLayer`
   * sẽ để một lỗi nhận diện ghế sofa xoá sạch chín cửa đã duyệt khỏi màn hình —
   * đúng thứ đặc tả cấm.
   */
  const furnitureQuery = useQuery({
    queryKey: queryKeys.progress.byFloor(floorId),
    queryFn: ({ signal }) => gateway.readFurnitureBranch({ floorId, projectId, signal }),
  });

  /* Lần đọc ảnh nền THÀNH CÔNG gần nhất, giữ lại qua mọi lượt hỏng sau đó. */
  const lastBackgroundRef = useRef<ObjectLayerBackground | null>(null);

  if (backgroundQuery.data !== undefined) {
    lastBackgroundRef.current = backgroundQuery.data;
  }

  const background = backgroundQuery.data ?? lastBackgroundRef.current;

  /* ---------------------------------------------------------------------- */
  /* Đồ thị đang sửa — nơi `commit` ghi vào.                                  */
  /* ---------------------------------------------------------------------- */

  const graph = useStore((state) => state.spatial);
  const setSpatial = useStore((state) => state.setSpatial);
  const selectedIds = useStore((state) => state.selectedIds);
  const setSelection = useStore((state) => state.setSelection);

  /*
   * Cổng giả (story, test) cắm đồ thị bộ mẫu vào kho còn trống, revision 0 khớp
   * N16 giả. Cổng thật đọc kho nên `graph.read()` là `null` ở đây; kho khi ấy do
   * `useFloorLayer` nạp từ N16.
   */
  useEffect(() => {
    if (graph !== null) {
      return;
    }

    const seed = gateway.graph.read();

    if (seed !== null) {
      setSpatial(seed, null, { floorRevisions: { [floorId]: 0 }, projectId });
    }
  }, [floorId, gateway, graph, projectId, setSpatial]);

  const level = useMemo<Level | null>(() => levelOfGraph(graph, floorId), [floorId, graph]);
  const hasError = floorLayer.error !== null;
  const isLoading = floorLayer.isPending || graph === null;

  /*
   * Mã hiển thị GIỮ NGUYÊN trong phiên (BUG-592): mã đánh theo thứ tự làm mọi mã sau một đối
   * tượng vừa xoá lùi một. Danh sách đi theo mã, không theo thứ tự đồ thị.
   */
  const shownCodesRef = useRef<{ readonly levelId: string | null; codes: ReadonlyMap<string, string> }>({
    levelId: null,
    codes: new Map(),
  });
  const objects = useMemo<readonly ReviewObject[]>(() => {
    if (hasError) {
      return NO_OBJECTS;
    }

    const found = objectsOf(graph, level, gateway.seed);
    const levelId = level?.id ?? null;
    const shown = shownCodesRef.current;
    const codes = keepDisplayCodes(
      shown.levelId === levelId ? shown.codes : new Map<string, string>(),
      new Map(found.map((object) => [object.entityId, object.id] as const)),
    );

    shownCodesRef.current = { levelId, codes };

    const kept = found.map((object) => {
      const code = codes.get(object.entityId) ?? object.id;

      return code === object.id ? object : { ...object, id: code };
    });

    return sortByDisplayCode(kept, NO_CODES);
  }, [gateway, graph, hasError, level]);

  const counts = useMemo(() => countsOf(objects), [objects]);
  const availableSubtypes = useMemo(() => new Set(objects.map((object) => object.subtype)), [objects]);
  const reviewCounter = useMemo(() => reviewCounterOf(objects), [objects]);
  /* Ngưỡng của dự án, 0,75 của đặc tả khi chưa đọc được (G32 17-C-009). */
  const confidenceThreshold = useProjectConfidenceThreshold(
    projectId,
    gateway.readConfidenceThreshold,
    OBJECT_LAYER_CONFIDENCE_THRESHOLD,
  );
  const lowConfidenceObjects = useMemo(
    () => lowConfidenceObjectsOf(objects, confidenceThreshold),
    [confidenceThreshold, objects],
  );
  /*
   * Mở màn với lọc BẬT khi còn chỗ phải xem tay (giảm tải duyệt, GIAI-PHAP 3.12): món máy chắc chắn
   * gom vào một dòng "Duyệt cả N". Không còn chỗ nào thì lọc tắt — bật lên chỉ ra danh sách rỗng.
   */
  const hasManualReview = useMemo(
    () =>
      objects.some(
        (object) =>
          !object.reviewed &&
          (object.suggested === true ||
            isUnattachedOpening(object) ||
            isLowConfidenceObject(object.confidence, confidenceThreshold)),
      ),
    [confidenceThreshold, objects],
  );
  const lowConfidenceOnly = lowConfidenceChoice ?? hasManualReview;

  const solidWalls = useMemo(() => solidWallsOf(graph, level), [graph, level]);
  const graphWalls = useMemo(() => graphWallsOf(graph, level), [graph, level]);
  const wallOutlines = useMemo(
    () => (level === null ? [] : wallOutlinesOf(graphWalls, level)),
    [graphWalls, level],
  );

  /* ---------------------------------------------------------------------- */
  /* Cổng ghi — `dispatch` chạy qua `commit`, hoàn tác 100 bước của S-06.     */
  /* ---------------------------------------------------------------------- */

  const storePort = useMemo<ObjectLayerGraphPort>(
    () => ({ read: () => useStore.getState().spatial }),
    [],
  );


  /* Tự lưu (A7) — bộ lưu lớp chung mỗi người–dự án (F-04x-1); 409 → dải "Tải lại". */
  const { autosave, saveBlock } = useFloorLayerAutosave({
    projectId,
    floorId,
    ...(gateway.apiClient === undefined ? {} : { apiClient: gateway.apiClient }),
  });

  // Khối lưu đang chặn thì lời đọc cho trình đọc màn hình cũng nói "Chưa lưu…", không hứa tự lưu lại (U14).
  const saveIndicator = useSaveIndicator(autosave, { failedLabel: saveBlock !== null ? SAVE_BLOCKED_LABEL : null });
  /* Chưa lưu lượt nào thì không bịa "Đã lưu" (cùng luật màn Phòng). */
  const saveLabel =
    !canEdit
      ? null
      : saveBlock !== null
        ? SAVE_BLOCKED_LABEL
        : saveIndicator.state === 'saved' && autosave.getLastSavedAt() === undefined
          ? null
          : saveIndicator.label;

  const dispatchBundle = useMemo<ObjectLayerDispatchDeps>(
    () =>
      createObjectLayerDispatchDeps({
        graph: storePort,
        selectionBefore: currentSelection,
        selectionAfter: currentSelection,
        onSynced: () => {
          autosave.notifyChange();
        },
      }),
    [autosave, storePort],
  );

  /* Máy chủ vừa thay tầng (tải lại sau xung đột) — các bước hoàn tác cũ không còn khớp (R14). */
  const serverReplaceSeq = useStore((state) => state.serverReplaceSeq);

  useEffect(() => {
    dispatchBundle.history.clear();
  }, [dispatchBundle, serverReplaceSeq]);

  /* ---------------------------------------------------------------------- */
  /* Vùng chọn (S-10) và đồng bộ hai chiều (S-11).                            */
  /* ---------------------------------------------------------------------- */

  const channel = useMemo(() => createSelectionChannel(), []);

  useEffect(() => () => channel.dispose(), [channel]);

  const selectionContext = useMemo<SelectionContext | null>(
    () =>
      graph === null || level === null
        ? null
        : { spatial: graph, activeLevelId: level.id, layers: {} },
    [graph, level],
  );

  const objectById = useCallback(
    (objectId: string): ReviewObject | null =>
      objects.find((object) => object.id === objectId) ?? null,
    [objects],
  );

  const entityIdOfObject = useCallback(
    (objectId: string): EntityId | null => {
      const object = objectById(objectId);

      return object === null ? null : (object.entityId as EntityId);
    },
    [objectById],
  );

  const selectedObjectId = useMemo<string | null>(() => {
    if (orphanSelection !== null) {
      return objects.some((object) => object.id === orphanSelection) ? orphanSelection : null;
    }

    const anchor = revealAnchor(selectedIds);

    if (anchor === null) {
      return null;
    }

    return objects.find((object) => object.entityId === anchor)?.id ?? null;
  }, [objects, orphanSelection, selectedIds]);

  const pushSelection = useCallback(
    (next: readonly EntityId[]) => {
      setSelection([...next]);
      /* S-11: một lượt đẩy cho cả canvas và danh sách, gộp trong một khung hình. */
      channel.push([...next]);
    },
    [channel, setSelection],
  );

  const onSelect = useCallback(
    (objectId: string | null) => {
      if (selectionContext === null) {
        return;
      }

      setDraggingObjectId(null);
      setOrphanSelection(null);

      if (objectId === null) {
        pushSelection(NO_SELECTION_IDS);

        return;
      }

      const object = objectById(objectId);

      if (object === null) {
        return;
      }

      /*
       * Lỗ mở chưa gắn không nằm trong đồ thị, nên nó đi đường riêng. Nội thất đứng tự
       * do thì có trên đồ thị, nên nó đi vùng chọn thật như mọi thực thể khác.
       */
      if (isUnattachedOpening(object)) {
        pushSelection(NO_SELECTION_IDS);
        setOrphanSelection(objectId);

        return;
      }

      const entityId = entityIdOfObject(objectId);

      if (entityId === null) {
        return;
      }

      pushSelection(selectSingle(selectedIds, entityId, selectionContext));
    },
    [entityIdOfObject, objectById, pushSelection, selectedIds, selectionContext],
  );

  const onToggleSelect = useCallback(
    (objectId: string) => {
      const entityId = entityIdOfObject(objectId);

      if (entityId === null || selectionContext === null) {
        return;
      }

      pushSelection(toggleSelection(selectedIds, entityId, selectionContext));
    },
    [entityIdOfObject, pushSelection, selectedIds, selectionContext],
  );

  const onSelectLayerObjects = useCallback(
    (layer: ObjectLayerId) => {
      if (selectionContext === null) {
        return;
      }

      const ids = objects
        .filter((object) => object.layer === layer)
        .map((object) => object.entityId as EntityId);

      pushSelection(combineSelection(selectedIds, ids, 'replace', selectionContext));
    },
    [objects, pushSelection, selectedIds, selectionContext],
  );

  const onHover = useCallback((objectId: string | null) => {
    setHoveredObjectId(objectId);
  }, []);

  /* S-11: nói cho kênh biết danh sách đang thấy gì, rồi hỏi nó phải lộ ra cái nào. */
  useEffect(() => {
    channel.reportVisible('list', selectedIds);
    planReveals(selectedIds, describeSelection(selectedIds), { list: selectedIds });
  }, [channel, selectedIds]);

  /* ---------------------------------------------------------------------- */
  /* Khung nhìn — R-07 bay tới tường chủ.                                     */
  /* ---------------------------------------------------------------------- */

  const { viewport, flyToBounds } = useCanvasViewport();

  /* ---------------------------------------------------------------------- */
  /* Lệnh — mọi hàm sửa đi qua đây, và tắt hẳn ở vai Người xem.               */
  /* ---------------------------------------------------------------------- */

  const invalidate = useCallback(
    (layer: ObjectLayerId) => {
      applyInvalidation(queryClient, layer === 'furniture' ? 'moveFurniture' : 'editWall', {
        floorId,
        projectId,
      });
    },
    [floorId, projectId, queryClient],
  );

  const notifications = options.notifications ?? appNotificationBus;

  /** Lệnh bị từ chối thì nói ra, không im lặng (BUG-590). */
  const refuse = useCallback(
    (title: string) => {
      notifications.publish({ type: REFUSED_NOTIFICATION_TYPE, title, description: '' });
    },
    [notifications],
  );

  /** Một lệnh đơn, gộp được theo D-06 khi hai lượt liền nhau dưới 400 ms. */
  const runSingle = useCallback(
    async (
      objectId: string,
      layer: ObjectLayerId,
      build: (context: CommandContext) => Command | null,
    ) => {
      const current = useStore.getState().spatial;

      if (!canEdit || current === null) {
        return false;
      }

      const command = build(commandContextOf(current, gateway.actorId));

      if (command === null) {
        return false;
      }

      const result = await runObjectCommand(command, dispatchBundle);

      if (result.ok) {
        invalidate(layer);
      }

      return result.ok;
    },
    [canEdit, dispatchBundle, gateway, invalidate],
  );

  /** Một khối lệnh đi cùng nhau — sinh ĐÚNG MỘT bước hoàn tác, không gộp với lượt kéo. */
  const runBlock = useCallback(
    async (
      objectId: string,
      layer: ObjectLayerId,
      build: (context: CommandContext) => Command | null,
    ) => {
      const current = useStore.getState().spatial;

      if (!canEdit || current === null) {
        return;
      }

      const command = build(commandContextOf(current, gateway.actorId));

      if (command === null) {
        return;
      }

      const result = await runObjectTransaction([command], dispatchBundle, command.description);

      if (result.ok) {
        invalidate(layer);
      }
    },
    [canEdit, dispatchBundle, gateway, invalidate],
  );

  const wallOfObject = useCallback(
    (hostWallId: WallId): SolidWall | null =>
      solidWalls.find((wall) => wall.id === hostWallId) ?? null,
    [solidWalls],
  );

  const onChangeSubtype = useCallback(
    (objectId: string, subtype: ObjectSubtype) => {
      const object = objectById(objectId);

      if (object === null) {
        return;
      }

      if (object.subtype === subtype) {
        refuse(OBJECT_LAYER_TEXT.subtypeSame);
        return;
      }

      /* Đồ đạc và lỗ mở là hai loại thực thể; không lệnh nào đổi qua lại (BUG-590). */
      if (OBJECT_SUBTYPE_LAYER[object.subtype] === 'furniture' || OBJECT_SUBTYPE_LAYER[subtype] === 'furniture') {
        refuse(OBJECT_LAYER_TEXT.subtypeRefused);
        return;
      }

      if (isOrphanObject(object)) {
        refuse(OBJECT_LAYER_TEXT.subtypeNeedsWall);
        return;
      }

      void runBlock(object.id, object.layer, (context) => {
        const before = context.graph.byId[object.entityId];
        const wall = wallOfObject(object.hostWallId);

        if (before === undefined || wall === null || !('wallId' in before)) {
          return null;
        }

        const built = buildChangeObjectKindCommand({
          before,
          displayId: object.id,
          wall,
          siblings: siblingOpeningsOf(context.graph, wall),
          subtype,
          actorId: context.actorId,
        });

        /* Luật M-08 mức critical chặn lệnh thì nói lý do, không im lặng (BUG-590, 17-C-021). */
        if (!built.ok) {
          refuse(built.error.reasons.join(' '));
        }

        return built.ok ? built.data : null;
      });
    },
    [objectById, refuse, runBlock, wallOfObject],
  );

  /* Nội thất đổi loại bằng `furniture.changeKind` (K10): trước đó chỉ có giữ tên sai hoặc xoá hẳn. */
  const onChangeFurnitureKind = useCallback(
    (objectId: string, kind: FurnitureKind, variant?: FurnitureVariant | null) => {
      const object = objectById(objectId);

      if (object === null || object.layer !== 'furniture') {
        return;
      }

      void runBlock(object.id, object.layer, (context) => {
        const before = context.graph.byId[object.entityId];

        if (before === undefined || !('boundingBox' in before)) {
          return null;
        }

        const built = buildChangeFurnitureKindCommand(before, kind, context.actorId, object.id, variant);

        if (!built.ok) {
          refuse(built.error.reasons.join(' '));
        }

        return built.ok ? built.data : null;
      });
    },
    [objectById, refuse, runBlock],
  );

  const onChangeSwing = useCallback(
    (objectId: string, swing: SwingDirection) => {
      const object = objectById(objectId);

      if (object === null) {
        return;
      }

      void runBlock(object.id, object.layer, (context) => {
        const before = context.graph.byId[object.entityId];

        if (before === undefined || !('wallId' in before)) {
          return null;
        }

        const built = buildChangeObjectSwingCommand({
          before,
          displayId: object.id,
          swing,
          actorId: context.actorId,
        });

        return built.ok ? built.data : null;
      });
    },
    [objectById, runBlock],
  );

  const onApprove = useCallback(
    (objectId: string) => {
      const object = objectById(objectId);

      if (object === null || object.reviewed) {
        return;
      }

      void runBlock(object.id, object.layer, (context) => {
        const before = context.graph.byId[object.entityId];

        if (before === undefined || (!('wallId' in before) && !('boundingBox' in before))) {
          return null;
        }

        return buildApproveObjectCommand(before, context.actorId, object.id);
      });
    },
    [objectById, runBlock],
  );

  const onDragPosition = useCallback(
    (objectId: string, relativePosition: RelativePosition) => {
      const object = objectById(objectId);

      if (object === null || isOrphanObject(object)) {
        return;
      }

      const wall = wallOfObject(object.hostWallId);

      if (wall === null) {
        return;
      }

      setDraggingObjectId(object.id);

      void runSingle(object.id, object.layer, (context) => {
        const { entityId } = object;

        if (object.layer === 'furniture') {
          const built = buildMoveFurnitureCommand(
            { furnitureId: entityId as never, to: positionOnWall(wall, relativePosition) },
            context,
          );

          return built.ok ? built.data : null;
        }

        const built = buildMoveOpeningCommand(
          { openingId: entityId as never, offsetMm: offsetForPosition(object, wall, relativePosition) },
          context,
        );

        return built.ok ? built.data : null;
      });
    },
    [objectById, runSingle, wallOfObject],
  );

  /* ---------------------------------------------------------------------- */
  /* Hoàn tác — ngăn xếp 100 bước của S-06, KHÔNG phải zundo.                 */
  /* ---------------------------------------------------------------------- */

  const applyUndo = useCallback(() => {
    if (!canEdit) {
      return;
    }

    const transition = dispatchBundle.history.undo();

    if (transition === null) {
      return;
    }

    dispatchBundle.deps.spatial.applyPatches(transition.patches);
    setSelection([...transition.selection.selectedIds]);
    autosave.notifyChange();
    invalidate('door');
  }, [autosave, canEdit, dispatchBundle, invalidate, setSelection]);

  const onUndo = useCallback(() => {
    applyUndo();
  }, [applyUndo]);

  /* ---------------------------------------------------------------------- */
  /* Xoá (A8) — tức thì, không hộp thoại, kèm vé hoàn tác 8000 ms.            */
  /* ---------------------------------------------------------------------- */

  const onDelete = useCallback(
    (objectId: string) => {
      const object = objectById(objectId);

      if (object === null) {
        return;
      }

      void runSingle(object.id, object.layer, (context) => {
        const { entityId } = object;
        const built =
          object.layer === 'furniture'
            ? buildDeleteFurnitureCommand({ furnitureId: entityId as never }, context)
            : buildDeleteOpeningCommand({ openingId: entityId as never }, context);

        return built.ok ? built.data : null;
      }).then((deleted) => {
        if (!deleted) {
          return;
        }

        /* BUG-579: vé giữ đúng bước của lượt xoá này, không "bước trên cùng" lúc bấm. */
        const entryId = newestEntryId(dispatchBundle.history);
        const ticket = createObjectUndoTicket({
          displayId: object.id,
          now: gateway.now,
          undo: () => {
            /* Own-step undo: lấy lại ĐÚNG bước xoá của vé, dù có bước mới hơn phía trên. */
            const transition = entryId === null ? null : dispatchBundle.history.undoEntry(entryId);

            if (transition === null) {
              notifications.publish({ type: UNDO_REFUSED_NOTIFICATION_TYPE, title: UNDO_REFUSED_TEXT, description: '' });

              return;
            }

            dispatchBundle.deps.spatial.applyPatches(transition.patches);
            autosave.notifyChange();
            invalidate(object.layer);
          },
        });

        /*
         * A8: mọi thay đổi hoàn tác được, KÈM TOAST hoàn tác. Cửa sổ tám giây do
         * chính vé mang (`UNDO_WINDOW_MS`), nên không thời lượng nào phải truyền.
         */
        notifications.publish({
          type: DELETE_NOTIFICATION_TYPE,
          title: ticket.description,
          description: '',
          undoTicket: ticket,
        });
      });
    },
    [autosave, dispatchBundle, gateway, invalidate, notifications, objectById, runSingle],
  );

  /* ---------------------------------------------------------------------- */
  /* Đối tượng chưa gắn tường — hành động gọi M-08, màn không tự tìm.         */
  /* ---------------------------------------------------------------------- */

  /*
   * Lượt gắn có thể bị TỪ CHỐI, và lời từ chối phải tới được người duyệt.
   *
   * `findOrphans` nêu tường đáng gợi ý, nhưng `validateAddOpening` của S-07
   * vẫn chạy `validateOpening` của M-08 trên đó — và tường gần nhất có thể đã
   * có một lỗ mở đúng chỗ ấy. Màn KHÔNG được tự đi tìm tường thứ hai (CẤM
   * TUYỆT ĐỐI); nó nói ra câu tiếng Việt mà domain trả về, để người duyệt
   * quyết định.
   */
  const onAttachToNearestWall = useCallback(
    (objectId: string) => {
      const entry = gateway.seed.find((candidate) => candidate.displayId === objectId) ?? null;
      const current = useStore.getState().spatial;

      if (entry === null || level === null || current === null || !canEdit) {
        return;
      }

      const input = attachOrphanToNearestWall(entry, current, level, gateway.seed);

      if (input === null) {
        notifications.publish({
          type: ATTACH_NOTIFICATION_TYPE,
          title: OBJECT_LAYER_TEXT.attachNoWall,
          description: '',
        });

        return;
      }

      const built = buildAddOpeningCommand(input, commandContextOf(current, gateway.actorId));

      if (!built.ok) {
        notifications.publish({
          type: ATTACH_NOTIFICATION_TYPE,
          title: OBJECT_LAYER_TEXT.attachRefused,
          description: built.error.reasons.join(' '),
        });

        return;
      }

      void runSingle(entry.displayId, entry.layer, () => built.data);
    },
    [canEdit, gateway, level, notifications, runSingle],
  );

  /* Tường ưu tiên cho lượt thêm tay (tường đang được tô); ghi ở dưới, sau khi `flownWallId` có. */
  const preferredWallRef = useRef<WallId | null>(null);

  /*
   * "thêm thủ công" của trạng thái rỗng — một lệnh `opening.add` thật.
   *
   * Màn đề nghị ĐÚNG MỘT chỗ (`manualDoorProposalOf`, giữa tim đoạn tường đầu
   * tiên, toạ độ do `placeOnWall` của M-08 trả) rồi để `validateOpening` phán
   * quyết. Bị từ chối thì người duyệt đọc được câu từ chối của domain; màn
   * không đi tìm một tường thứ hai (CẤM TUYỆT ĐỐI).
   *
   * Tầng của URL không có trong đồ thị (`level === null`) thì báo `addNoWall`,
   * không im lặng (A11). Ở ca tầng chưa nạp, câu này có thể sai: xem B-V6-71.
   */
  const onAddManually = useCallback((kind: 'door' | 'window' = 'door') => {
    const current = useStore.getState().spatial;

    if (!canEdit || current === null) {
      return;
    }

    /* Thử lần lượt các chỗ trên tim tường; chỗ đầu tiên domain nhận là chỗ đặt (cửa thứ hai trở đi). */
    const proposals =
      level === null
        ? []
        : manualDoorProposalsOf(current, level, undefined, preferredWallRef.current, kind);

    if (proposals.length === 0) {
      notifications.publish({
        type: ADD_NOTIFICATION_TYPE,
        title: OBJECT_LAYER_TEXT.addNoWall,
        description: '',
      });

      return;
    }

    const context = commandContextOf(current, gateway.actorId);
    let firstRefusal: readonly string[] | null = null;

    for (const proposal of proposals) {
      const built = buildAddOpeningCommand(proposal, context);

      if (built.ok) {
        void runSingle(proposal.id, kind, () => built.data);

        return;
      }

      firstRefusal ??= built.error.reasons;
    }

    notifications.publish({
      type: ADD_NOTIFICATION_TYPE,
      title: OBJECT_LAYER_TEXT.addRefused,
      description: (firstRefusal ?? []).join(' '),
    });
  }, [canEdit, gateway, level, notifications, runSingle]);

  /* ---------------------------------------------------------------------- */
  /* Chế độ vẽ (K07): rail "Vẽ …" bật, một cú bấm lên bản vẽ đặt một món.     */
  /* ---------------------------------------------------------------------- */

  const [drawLayer, setDrawLayer] = useState<ObjectLayerId | null>(null);

  const onStartDraw = useCallback((layer: ObjectLayerId) => {
    setDrawLayer((previous) => (previous === layer ? null : layer));
  }, []);

  /* Món vừa vẽ (B3): chọn nó và đưa focus vào ô loại khi nó đã hiện trong danh sách. */
  const [drawnEntityId, setDrawnEntityId] = useState<string | null>(null);
  const [focusKindToken, setFocusKindToken] = useState(0);
  /* Ô chọn loại cạnh hộp vừa vẽ (wall-review-ux): mã hiển thị của món, `null` = đóng. */
  const [kindPickerId, setKindPickerId] = useState<string | null>(null);
  const onCloseKindPicker = useCallback(() => setKindPickerId(null), []);
  const kindPicker = useMemo(
    () =>
      kindPickerId === null || !canEdit
        ? null
        : {
            onPick: (kind: FurnitureKind, variant: FurnitureVariant | null) => {
              setKindPickerId(null);
              onChangeFurnitureKind(kindPickerId, kind, variant);
            },
            onMore: () => {
              setKindPickerId(null);
              setFocusKindToken((token) => token + 1);
            },
            onClose: onCloseKindPicker,
          },
    [canEdit, kindPickerId, onChangeFurnitureKind, onCloseKindPicker],
  );

  const onPlaceAt = useCallback(
    (point: PixelPoint, corner?: PixelPoint) => {
      const current = useStore.getState().spatial;
      const layer = drawLayer;

      if (!canEdit || current === null || level === null || layer === null) {
        return;
      }

      const scale = scaleOfLevel(level);
      const at = toDrawingPoint(point, scale);
      const context = commandContextOf(current, gateway.actorId);

      if (layer === 'furniture') {
        const input = drawnFurnitureInputOf(level, at, corner === undefined ? undefined : toDrawingPoint(corner, scale));
        const built = buildAddFurnitureCommand(input, context);

        if (!built.ok) {
          refuse(built.error.reasons.join(' '));
          return;
        }

        setDrawLayer(null);
        void runSingle(input.id, layer, () => built.data).then((added) => {
          if (added) {
            setDrawnEntityId(input.id);
          }
        });

        return;
      }

      const proposal = drawnOpeningProposalOf(current, level, at, layer);

      if (proposal === null) {
        refuse(OBJECT_LAYER_TEXT.drawNoWall);
        return;
      }

      const built = buildAddOpeningCommand(proposal, context);

      if (!built.ok) {
        refuse(built.error.reasons.join(' '));
        return;
      }

      setDrawLayer(null);
      void runSingle(proposal.id, layer, () => built.data);
    },
    [canEdit, drawLayer, gateway, level, refuse, runSingle],
  );

  useEffect(() => {
    const drawn = drawnEntityId === null ? undefined : objects.find((object) => object.entityId === drawnEntityId);

    if (drawn === undefined) {
      return;
    }

    setDrawnEntityId(null);
    onSelect(drawn.id);
    setFocusKindToken((token) => token + 1);
    setKindPickerId(drawn.id);
  }, [drawnEntityId, objects, onSelect]);

  /* Đổi cỡ / xoay nội thất (B3) — `furniture.resize` / `furniture.rotate`, mỗi lượt một bước hoàn tác. */
  const onResize = useCallback(
    (objectId: string, size: { readonly widthMm: number; readonly depthMm: number }) => {
      const object = objectById(objectId);

      if (object === null || object.layer !== 'furniture') {
        return;
      }

      void runBlock(object.id, object.layer, (context) => {
        const built = buildResizeFurnitureCommand(
          { furnitureId: object.entityId as never, widthMm: evenMillimetres(size.widthMm), depthMm: evenMillimetres(size.depthMm) },
          context,
        );

        if (!built.ok) {
          refuse(built.error.reasons.join(' '));
        }

        return built.ok ? built.data : null;
      });
    },
    [objectById, refuse, runBlock],
  );

  const onRotate = useCallback(
    (objectId: string) => {
      const object = objectById(objectId);

      if (object === null || object.layer !== 'furniture') {
        return;
      }

      void runBlock(object.id, object.layer, (context) => {
        const before = context.graph.byId[object.entityId];

        if (before === undefined || !('boundingBox' in before)) {
          return null;
        }

        const built = buildRotateFurnitureCommand(
          { furnitureId: before.id, rotationDeg: before.rotationDeg + QUARTER_TURN_DEG },
          context,
        );

        return built.ok ? built.data : null;
      });
    },
    [objectById, runBlock],
  );

  /* Gợi ý của máy (B3): nhận = duyệt (bỏ cờ gợi ý), bỏ = xoá; cả loạt là MỘT bước hoàn tác. */
  const suggestions = useMemo(() => objects.filter((object) => object.suggested === true), [objects]);

  const onAcceptAllSuggestions = useCallback(() => {
    const current = useStore.getState().spatial;

    if (!canEdit || current === null || suggestions.length === 0) {
      return;
    }

    const context = commandContextOf(current, gateway.actorId);
    const commands = suggestions.flatMap((object) => {
      const before = context.graph.byId[object.entityId];

      return before !== undefined && 'boundingBox' in before
        ? [buildApproveObjectCommand(before, context.actorId, object.id)]
        : [];
    });

    void runObjectTransaction(commands, dispatchBundle, OBJECT_LAYER_TEXT.acceptAllSuggestionsDone).then((result) => {
      if (result.ok) {
        invalidate('furniture');
      }
    });
  }, [canEdit, dispatchBundle, gateway, invalidate, suggestions]);

  const onRejectAllSuggestions = useCallback(() => {
    const current = useStore.getState().spatial;

    if (!canEdit || current === null || suggestions.length === 0) {
      return;
    }

    const context = commandContextOf(current, gateway.actorId);
    const commands = suggestions.flatMap((object) => {
      const built = buildDeleteFurnitureCommand({ furnitureId: object.entityId as never }, context);

      return built.ok ? [built.data] : [];
    });
    const description = rejectedSuggestionsToast(commands.length);

    void runObjectTransaction(commands, dispatchBundle, description).then((result) => {
      if (!result.ok) {
        return;
      }

      invalidate('furniture');

      const entryId = newestEntryId(dispatchBundle.history);
      const ticket = createObjectUndoTicket({
        displayId: '',
        description,
        now: gateway.now,
        undo: () => {
          const transition = entryId === null ? null : dispatchBundle.history.undoEntry(entryId);

          if (transition === null) {
            notifications.publish({ type: UNDO_REFUSED_NOTIFICATION_TYPE, title: UNDO_REFUSED_TEXT, description: '' });

            return;
          }

          dispatchBundle.deps.spatial.applyPatches(transition.patches);
          autosave.notifyChange();
          invalidate('furniture');
        },
      });

      notifications.publish({ type: DELETE_NOTIFICATION_TYPE, title: description, description: '', undoTicket: ticket });
    });
  }, [autosave, canEdit, dispatchBundle, gateway, invalidate, notifications, suggestions]);

  /*
   * U04: duyệt hàng loạt như bước Tường — cả tầng, MỘT bước hoàn tác (Ctrl+Z trả cả lượt).
   * Không cần bấm A từng mục (28-51 lần trên căn thật).
   */
  const remainingObjects = useMemo(() => approvableObjectsOf(objects), [objects]);
  const confidentObjects = useMemo(
    () => confidentObjectsOf(remainingObjects, confidenceThreshold),
    [confidenceThreshold, remainingObjects],
  );

  const approveMany = useCallback(
    (targets: readonly ReviewObject[], label: string) => {
      const current = useStore.getState().spatial;

      if (!canEdit || current === null || targets.length === 0) {
        return;
      }

      const context = commandContextOf(current, gateway.actorId);
      const commands = targets.flatMap((object) => {
        const before = context.graph.byId[object.entityId];

        return before !== undefined && ('wallId' in before || 'boundingBox' in before)
          ? [buildApproveObjectCommand(before, context.actorId, object.id)]
          : [];
      });

      if (commands.length === 0) {
        return;
      }

      void runObjectTransaction(commands, dispatchBundle, label).then((result) => {
        if (result.ok) {
          invalidate('furniture');
          invalidate('door');
        }
      });
    },
    [canEdit, dispatchBundle, gateway, invalidate],
  );

  const onApproveConfident = useCallback(
    () => approveMany(confidentObjects, approveConfidentLabelOf(confidentObjects.length)),
    [approveMany, confidentObjects],
  );
  /* UX-06: nút thứ hai chỉ duyệt món máy chưa chắc (đã hỏi lại ở thanh), số khớp với dòng tách "cần xem". */
  const unsureObjects = useMemo(
    () => unsureObjectsOf(remainingObjects, confidenceThreshold),
    [confidenceThreshold, remainingObjects],
  );
  const onApproveRemaining = useCallback(
    () => approveMany(unsureObjects, approveUnsureLabelOf(unsureObjects.length)),
    [approveMany, unsureObjects],
  );
  const canApproveConfident = canEdit && confidentObjects.length > 0;
  const canApproveRemaining = canEdit && unsureObjects.length > 0;
  const reviewBreakdownLabel = useMemo(
    () => reviewBreakdownLabelOf(objects, confidenceThreshold),
    [confidenceThreshold, objects],
  );

  /* Lớp chỉ đọc (người xem, khoá tỷ lệ) thì không còn chế độ vẽ nào treo lại. */
  useEffect(() => {
    if (!canEdit) {
      setDrawLayer(null);
    }
  }, [canEdit]);

  /* ---------------------------------------------------------------------- */
  /* Bấm liên kết tường chủ — chọn tường đó và bay khung nhìn tới (R-07).     */
  /* ---------------------------------------------------------------------- */

  /*
   * Khung canvas (BUG-403): canvas đo khung rồi báo lên, hook đặt mặt bằng vừa khung. Khung nhìn
   * của `useCanvasViewport` là phần NGƯỜI DÙNG lái (bay tới tường chủ), đọc trên lớp "vừa khung".
   */
  const [frameSizePx, setFrameSizePx] = useState<CanvasFitSize | null>(null);
  const [flownWallId, setFlownWallId] = useState<WallId | null>(null);
  const flownWallIdRef = useRef(flownWallId);
  flownWallIdRef.current = flownWallId;
  const isComparing = useQcCompare();
  preferredWallRef.current = flownWallId;
  const onFrameResize = useCallback((size: CanvasFitSize) => {
    setFrameSizePx((previous) =>
      previous !== null && previous.width === size.width && previous.height === size.height
        ? previous
        : size,
    );
  }, []);

  const wallOutlinesPx = useMemo<readonly HostWallOutlineViewModel[]>(() => {
    const scale = scaleOfLevel(level);

    return wallOutlines.map((wall) => ({
      id: wall.id,
      outline: wall.outline.map((point) => toPixelPoint(point, scale)),
    }));
  }, [level, wallOutlines]);

  const surfacePx = useMemo<CanvasFitRect | null>(() => {
    const drawing = drawingSizeOf(background ?? undefined, level);

    if (drawing !== null) {
      return { x: 0, y: 0, ...drawing };
    }

    const box = boundsOfPoints(wallOutlinesPx.flatMap((wall) => wall.outline));

    return box === null
      ? null
      : { x: box.minX, y: box.minY, width: box.maxX - box.minX, height: box.maxY - box.minY };
  }, [background, level, wallOutlinesPx]);

  /* Mở tầng là thấy MẶT BẰNG: vừa theo khung tường, không theo cả tờ giấy (tờ còn phối cảnh, ghi chú, sơ đồ vị trí). */
  const fitBoundsPx = useMemo<CanvasFitRect | null>(() => {
    const box = boundsOfPoints(wallOutlinesPx.flatMap((wall) => wall.outline));

    return box === null ? surfacePx : { x: box.minX, y: box.minY, width: box.maxX - box.minX, height: box.maxY - box.minY };
  }, [surfacePx, wallOutlinesPx]);

  const fitView = fitCanvasView(frameSizePx, fitBoundsPx) ?? IDENTITY_VIEW;

  const onSelectHostWall = useCallback(
    (wallId: WallId) => {
      /*
       * BUG-591: GIỮ đối tượng đang chọn trong thanh tra và tô tường chủ — bản cũ chọn tường,
       * thanh tra về "Chọn một đối tượng…" và màn này không vẽ tường đang chọn nên không thấy gì.
       */
      setFlownWallId(wallId);

      const outline = wallOutlines.find((shape) => shape.id === wallId);
      const bounds = outline === undefined ? null : wallBoundsPx(outline.outline, level);

      if (bounds !== null && frameSizePx !== null) {
        /* `flyToBounds` làm việc trên lớp "vừa khung": đưa hộp tường về pixel khung của lớp ấy. */
        const min = toFramePoint(fitView, { x: bounds.minX, y: bounds.minY });
        const max = toFramePoint(fitView, { x: bounds.maxX, y: bounds.maxY });

        flyToBounds(
          { minX: min.x, minY: min.y, maxX: max.x, maxY: max.y },
          frameSizePx.width,
          frameSizePx.height,
        );
      }
    },
    [fitView, flyToBounds, frameSizePx, level, wallOutlines],
  );

  /*
   * Màn không có nút vừa khung: bỏ chọn tường vừa bay tới (chọn thứ khác, Esc) thì trả khung nhìn
   * về vừa khung — không thì kẹt ở mức phóng ấy tới khi đổi tầng (review-1 #2, A12).
   */
  const flownFromObjectRef = useRef<string | null>(null);

  /** Bỏ tô tường chủ và trả khung nhìn về vừa khung. */
  const endFlight = useCallback(() => {
    setFlownWallId(null);

    if (frameSizePx !== null) {
      const frame = { minX: 0, minY: 0, maxX: frameSizePx.width, maxY: frameSizePx.height };

      flyToBounds(frame, frameSizePx.width, frameSizePx.height, { padding: 0 });
    }
  }, [flyToBounds, frameSizePx]);

  useEffect(() => {
    if (flownWallId === null) {
      flownFromObjectRef.current = selectedObjectId;
      return;
    }

    if (selectedObjectId === flownFromObjectRef.current) {
      return;
    }

    flownFromObjectRef.current = selectedObjectId;
    endFlight();
  }, [endFlight, flownWallId, selectedObjectId]);

  /* ---------------------------------------------------------------------- */
  /* Lớp con, chip lọc, nhóm gấp.                                            */
  /* ---------------------------------------------------------------------- */

  const onToggleLayer = useCallback((layer: ObjectLayerId) => {
    setLayerVisibility((previous) => ({ ...previous, [layer]: !previous[layer] }));
  }, []);

  /* Chip đếm là bộ lọc (K07): chỉ hiện nhóm ấy; bấm lại nhóm đang lọc thì hiện cả ba. */
  const onFilterLayer = useCallback((layer: ObjectLayerId) => {
    setListLayerFilter((previous) => (previous === layer ? null : layer));
  }, []);

  const onToggleSubtypeFilter = useCallback((subtype: ObjectSubtype) => {
    setSubtypeFilters((previous) => {
      const next = new Set(previous);

      if (next.has(subtype)) {
        next.delete(subtype);
      } else {
        next.add(subtype);
      }

      return next;
    });
  }, []);

  const onToggleGroupCollapsed = useCallback((layer: ObjectLayerId) => {
    setCollapsedGroups((previous) => ({ ...previous, [layer]: !previous[layer] }));
  }, []);

  const onToggleLowConfidenceOnly = useCallback(() => {
    setLowConfidenceChoice((previous) => !(previous ?? hasManualReview));
  }, [hasManualReview]);

  /* ---------------------------------------------------------------------- */
  /* Nhóm loại đang chọn — `C`/`S`/`N` và ba ô 1/2/3.                         */
  /* ---------------------------------------------------------------------- */

  const selectedObject = selectedObjectId === null ? null : objectById(selectedObjectId);
  /* Nhóm chọn tay chỉ có hiệu lực với đối tượng đang chọn lúc bấm; đổi đối tượng là hết, không chờ effect. */
  const activeLayer =
    (activeLayerOverride !== null && activeLayerOverride.forId === selectedObjectId
      ? activeLayerOverride.layer
      : null) ??
    selectedObject?.layer ??
    null;
  const activeSubtype = selectedObject?.subtype ?? null;

  const selectedObjectIdForLayerRef = useRef(selectedObjectId);
  selectedObjectIdForLayerRef.current = selectedObjectId;

  const onSelectLayer = useCallback((layer: ObjectLayerId) => {
    setActiveLayerOverride({ layer, forId: selectedObjectIdForLayerRef.current });
  }, []);

  /* Chọn đối tượng khác thì nhóm loại theo đối tượng đó, không giữ nhóm chọn tay của đối tượng trước. */
  useEffect(() => {
    setActiveLayerOverride(null);
  }, [selectedObjectId]);

  const selectedObjectIdRef = useRef(selectedObjectId);
  selectedObjectIdRef.current = selectedObjectId;
  const activeLayerRef = useRef(activeLayer);
  activeLayerRef.current = activeLayer;
  const changeSubtypeRef = useRef(onChangeSubtype);
  changeSubtypeRef.current = onChangeSubtype;

  const onSelectSubtypeSlot = useCallback((slot: 1 | 2 | 3) => {
    const layer = activeLayerRef.current;
    const objectId = selectedObjectIdRef.current;

    if (layer === null || objectId === null) {
      return;
    }

    const subtype = subtypeSlotsOf(layer)[slot - 1];

    if (subtype !== undefined) {
      changeSubtypeRef.current(objectId, subtype);
    }
  }, []);

  /* ---------------------------------------------------------------------- */
  /* Bàn phím — qua sổ phím, KHÔNG addEventListener (A12, R-54).             */
  /* ---------------------------------------------------------------------- */

  const shortcutOptions = useMemo(
    () => (options.registry === undefined ? {} : { registry: options.registry }),
    [options.registry],
  );

  useShortcut(
    {
      id: 'objectLayerReview.layer.door',
      combo: 'C',
      scope: 'canvas',
      description: OBJECT_LAYER_TEXT.shortcutLayer,
      onTrigger: () => onSelectLayer('door'),
    },
    { ...shortcutOptions, enabled: canEdit },
  );
  useShortcut(
    {
      id: 'objectLayerReview.layer.window',
      combo: 'S',
      scope: 'canvas',
      description: OBJECT_LAYER_TEXT.shortcutLayer,
      onTrigger: () => onSelectLayer('window'),
    },
    { ...shortcutOptions, enabled: canEdit },
  );
  useShortcut(
    {
      id: 'objectLayerReview.layer.furniture',
      combo: 'N',
      scope: 'canvas',
      description: OBJECT_LAYER_TEXT.shortcutLayer,
      onTrigger: () => onSelectLayer('furniture'),
    },
    { ...shortcutOptions, enabled: canEdit },
  );
  useShortcut(
    {
      id: 'objectLayerReview.subtype.1',
      combo: '1',
      scope: 'canvas',
      description: OBJECT_LAYER_TEXT.shortcutSubtype,
      onTrigger: () => onSelectSubtypeSlot(1),
    },
    { ...shortcutOptions, enabled: canEdit },
  );
  useShortcut(
    {
      id: 'objectLayerReview.subtype.2',
      combo: '2',
      scope: 'canvas',
      description: OBJECT_LAYER_TEXT.shortcutSubtype,
      onTrigger: () => onSelectSubtypeSlot(2),
    },
    { ...shortcutOptions, enabled: canEdit },
  );
  useShortcut(
    {
      id: 'objectLayerReview.subtype.3',
      combo: '3',
      scope: 'canvas',
      description: OBJECT_LAYER_TEXT.shortcutSubtype,
      onTrigger: () => onSelectSubtypeSlot(3),
    },
    { ...shortcutOptions, enabled: canEdit },
  );
  useShortcut(
    {
      id: 'objectLayerReview.undo',
      combo: 'Mod+Z',
      scope: 'canvas',
      description: OBJECT_LAYER_TEXT.shortcutUndo,
      onTrigger: () => {
        /* Danh sách loại đang mở thì phím thuộc về nó, không hoàn tác ngầm bên dưới (17-E-017). */
        const focused = document.activeElement;

        /* Nhóm danh sách đối tượng (`object-layer-group-*`) cũng là listbox nhưng không phải danh sách loại: ở đó Mod+Z vẫn hoàn tác. */
        const typeListboxOpen =
          focused?.closest('[role="listbox"]:not([id^="object-layer-group-"])') != null ||
          (focused?.getAttribute('aria-haspopup') != null && focused.getAttribute('aria-expanded') === 'true');

        if (typeListboxOpen) {
          return;
        }

        onUndo();
      },
    },
    { ...shortcutOptions, enabled: canEdit },
  );
  /*
   * A12 — Esc đóng lớp trên cùng.
   *
   * Lớp trên cùng của màn này là thanh tra bên phải, và nó mở đúng khi có đối
   * tượng được chọn. `enabled` tắt đăng ký khi không có gì để đóng, nên lúc đó
   * phím rơi xuống handler `global` của `shortcutRegistry` — lời hứa A12 không
   * bị màn này lấy mất trong bất kỳ trạng thái nào.
   */
  useShortcut(
    {
      id: 'objectLayerReview.closeTopLayer',
      combo: 'Escape',
      scope: 'canvas',
      description: 'Đóng thanh tra đối tượng',
      onTrigger: () => {
        /* Không còn gì để đóng mà đang "So sánh hai bên": Esc thoát so sánh. */
        if (selectedObjectIdRef.current === null && flownWallIdRef.current === null && isQcCompare()) {
          setQcCompare(false);

          return;
        }

        onSelect(null);

        /* Bay tới tường chủ mà chưa chọn đối tượng nào: bỏ chọn không đổi gì, nên tự kết thúc lượt bay. */
        if (flownWallId !== null) {
          endFlight();
        }
      },
    },
    { ...shortcutOptions, enabled: selectedObjectId !== null || flownWallId !== null || isComparing },
  );
  /*
   * BUG-589: xoá bằng phím như màn tường (Backspace), cộng Delete — không chỉ chuột phải.
   * Z/S-16: hoàn tác thay hộp hỏi — phím xoá ngay như nút "Không phải cửa, xoá", toast hoàn tác (A8).
   */
  const deleteSelected = (): void => {
    const objectId = selectedObjectIdRef.current;

    if (objectId !== null) {
      onDelete(objectId);
    }
  };
  useShortcut(
    {
      id: 'objectLayerReview.delete',
      combo: 'Delete',
      scope: 'canvas',
      description: OBJECT_LAYER_TEXT.shortcutDelete,
      onTrigger: deleteSelected,
    },
    { ...shortcutOptions, enabled: canEdit && selectedObjectId !== null },
  );
  useShortcut(
    {
      id: 'objectLayerReview.deleteBackspace',
      combo: 'Backspace',
      scope: 'canvas',
      description: OBJECT_LAYER_TEXT.shortcutDelete,
      onTrigger: deleteSelected,
    },
    { ...shortcutOptions, enabled: canEdit && selectedObjectId !== null },
  );

  /* ---------------------------------------------------------------------- */
  /* Ghép kết quả — mọi con số đã thành chuỗi trước khi rời khỏi đây (A15).   */
  /* ---------------------------------------------------------------------- */

  const visibleObjects = useMemo(
    () =>
      applyObjectFilters(objects, {
        layerVisibility:
          listLayerFilter === null
            ? ALL_LAYERS_VISIBLE
            : { door: false, window: false, furniture: false, [listLayerFilter]: true },
        subtypes: subtypeFilters,
        lowConfidenceOnly,
      }, confidenceThreshold),
    [confidenceThreshold, listLayerFilter, lowConfidenceOnly, objects, subtypeFilters],
  );

  /* Nhãn tường chủ tính trên mã tường của cả tầng, cùng nguồn với màn tường. */
  const wallCodes = useMemo(
    () => displayCodesOf(solidWalls.map((wall) => wall.id)),
    [solidWalls],
  );

  const rows = useMemo(
    () =>
      visibleObjects
        .map((object) => toObjectRow(object, wallCodes, confidenceThreshold, objectScaleState))
        .sort(
          (a, b) =>
            /* Hàng đợi xếp theo lý do máy nghi (chưa chắc loại → chưa gắn tường → còn lại). */
            objectReasonRank(a) - objectReasonRank(b) ||
            byReviewQueue({ reviewed: a.isReviewed, confidence: a.confidence }, { reviewed: b.isReviewed, confidence: b.confidence }),
        ),
    [confidenceThreshold, objectScaleState, visibleObjects, wallCodes],
  );

  /* Nút "Duyệt tiếp" của cổng: đọc MỌI đối tượng, không chỉ dòng đang lọc — bộ lọc không làm nút chết. */
  const nextPending = useMemo(() => {
    const rankOf = (object: (typeof objects)[number]) => objectReasonRank(toObjectRow(object, wallCodes, confidenceThreshold));
    const queue = objects.filter((object) => !object.reviewed).sort((a, b) => rankOf(a) - rankOf(b) || byReviewQueue(a, b));
    const next = queue.find((object) => object.id !== selectedObjectId) ?? queue[0];

    return next === undefined ? null : { id: next.id, codeLabel: toObjectRow(next, wallCodes, confidenceThreshold).codeLabel };
  }, [confidenceThreshold, objects, selectedObjectId, wallCodes]);
  const layerGate = useMemo(() => layerGateOf(graph, level?.id ?? null), [graph, level]);
  /* Phím J = "đối tượng chưa duyệt kế" như màn tường (Tab bị cấm, A12): cùng việc nút "Duyệt tiếp" của cổng. */
  const nextPendingId = nextPending?.id ?? null;
  useShortcut(
    {
      id: 'objectLayerReview.nextPending',
      combo: 'J',
      scope: 'canvas',
      description: 'Sang đối tượng chưa duyệt kế tiếp',
      onTrigger: () => {
        if (nextPendingId !== null) {
          onSelect(nextPendingId);
        }
      },
    },
    { ...shortcutOptions, enabled: nextPendingId !== null },
  );

  const inspector = useMemo(() => {
    if (selectedObject === null) {
      return null;
    }

    const wall = isOrphanObject(selectedObject) ? null : wallOfObject(selectedObject.hostWallId);

    return toObjectInspector(selectedObject, wall, wallCodes, confidenceThreshold, objectScaleState);
  }, [confidenceThreshold, objectScaleState, selectedObject, wallCodes, wallOfObject]);

  /*
   * Impeccable A3: thứ tự dòng như danh sách đang vẽ — hàng đợi duyệt (chưa duyệt, tin cậy thấp trước).
   * ponytail: bỏ qua ô tìm mã và nhóm gấp của danh sách (state cục bộ của view); cần thì đưa lên hook.
   */
  const listOrderRef = useRef<readonly string[]>([]);
  listOrderRef.current = rows.map((row) => row.id);
  const stepObject = useCallback(
    (direction: 1 | -1) => {
      const order = listOrderRef.current;
      const current = selectedObjectIdRef.current;
      const index = current === null ? -1 : order.indexOf(current);
      const target = index === -1 ? order[direction === 1 ? 0 : order.length - 1] : order[index + direction];

      if (target !== undefined) {
        onSelect(target);
      }
    },
    [onSelect],
  );

  /* "Duyệt và sang mục kế": tìm đối tượng chưa duyệt kế tiếp TRƯỚC khi cờ đổi, như màn tường. */
  const reviewedRef = useRef<ReadonlyMap<string, boolean>>(new Map());
  reviewedRef.current = new Map(objects.map((object) => [object.id, object.reviewed]));
  const onApproveAndNext = useCallback(
    (objectId: string) => {
      const order = listOrderRef.current;
      const start = order.indexOf(objectId);
      const nextId =
        [...order.slice(start + 1), ...order.slice(0, Math.max(start, 0))].find(
          (id) => id !== objectId && reviewedRef.current.get(id) === false,
        ) ?? null;

      onApprove(objectId);

      if (nextId !== null) {
        onSelect(nextId);
      }
    },
    [onApprove, onSelect],
  );

  useShortcut(
    {
      id: 'objectLayerReview.arrowNext',
      combo: 'ArrowDown',
      scope: 'canvas',
      description: OBJECT_LAYER_TEXT.shortcutArrowNext,
      allowRepeat: true,
      preventDefault: false,
      onTrigger: arrowStepHandler(() => stepObject(1)),
    },
    shortcutOptions,
  );
  useShortcut(
    {
      id: 'objectLayerReview.arrowPrevious',
      combo: 'ArrowUp',
      scope: 'canvas',
      description: OBJECT_LAYER_TEXT.shortcutArrowPrevious,
      allowRepeat: true,
      preventDefault: false,
      onTrigger: arrowStepHandler(() => stepObject(-1)),
    },
    shortcutOptions,
  );
  useShortcut(
    {
      id: 'objectLayerReview.approveNext',
      combo: 'A',
      scope: 'canvas',
      description: OBJECT_LAYER_TEXT.shortcutApproveNext,
      onTrigger: () => {
        if (selectedObjectIdRef.current !== null) {
          onApproveAndNext(selectedObjectIdRef.current);
        }
      },
    },
    { ...shortcutOptions, enabled: canEdit && selectedObjectId !== null },
  );

  /* Enter nhận gợi ý đang chọn (B3); món thường vẫn duyệt bằng A. */
  useShortcut(
    {
      id: 'objectLayerReview.acceptSuggestion',
      combo: 'Enter',
      scope: 'canvas',
      description: OBJECT_LAYER_TEXT.shortcutAcceptSuggestion,
      onTrigger: () => {
        if (selectedObjectIdRef.current !== null) {
          onApproveAndNext(selectedObjectIdRef.current);
        }
      },
    },
    {
      ...shortcutOptions,
      enabled: canEdit && selectedObjectId !== null && objectById(selectedObjectId)?.suggested === true,
    },
  );

  const paintSubjects = useMemo(
    () => (level === null ? [] : objects.map((object) => toPaintSubject(object, level.id))),
    [level, objects],
  );

  const confidenceMode = useMemo(() => confidenceModeOf(paintSubjects), [paintSubjects]);

  /* Chú giải dựng cùng bảng màu — đếm theo chính màu mode tô ra, không đếm lại. */
  const confidenceLegend = useMemo(
    () => confidenceLegendOf(confidenceMode, paintSubjects),
    [confidenceMode, paintSubjects],
  );

  const confidenceTokenOf = useCallback(
    (objectId: string): ColorTokenName => {
      const subject = paintSubjects.find((candidate) => candidate.id === objectId);

      return subject === undefined
        ? confidenceLegend.unpaintedToken
        : confidenceMode.paint(subject);
    },
    [confidenceLegend, confidenceMode, paintSubjects],
  );

  /* Cung cửa 2D mở cùng phía với cảnh 3D (`swingDirectionOf` + "Đổi hướng mở"). */
  const inwardSwingIds = useMemo(() => inwardSwingIdsOf(graph === null ? null : denormalizeSpatial(graph)), [graph]);
  /* Bản vẽ vẽ mọi đối tượng; ẩn/hiện lớp do `layerVisibility` của canvas, bộ lọc danh sách không chạm tới (Codex P2). */
  const placements = useMemo(
    () => objectPlacementsOf(objects, solidWalls, level, inwardSwingIds),
    [inwardSwingIds, level, objects, solidWalls],
  );

  /* N3-08: `?select=<mã>` từ Quy chuẩn — chọn đối tượng đó và phóng tới nó, đúng một lần. */
  const pendingFocusRef = useRef(options.focusId ?? null);
  const pendingFlyRef = useRef<string | null>(null);

  /* Chọn ngay khi danh sách đã có; khung chưa đo xong thì phóng sau (effect kế). */
  useEffect(() => {
    const wanted = pendingFocusRef.current;

    if (wanted === null || isLoading || objects.length === 0) {
      return;
    }

    pendingFocusRef.current = null;
    const object = objects.find((item) => item.id === wanted || item.entityId === wanted);

    if (object !== undefined) {
      onSelect(object.id);
      pendingFlyRef.current = object.id;
    }
  }, [isLoading, objects, onSelect]);

  useEffect(() => {
    const id = pendingFlyRef.current;
    const placement = id === null ? undefined : placements.find((item) => item.id === id);

    if (placement === undefined || frameSizePx === null) {
      return;
    }

    pendingFlyRef.current = null;
    const box = rotatedBounds(placement.boundsPx, placement.angleDeg);
    const min = toFramePoint(fitView, { x: box.x, y: box.y });
    const max = toFramePoint(fitView, { x: box.x + box.width, y: box.y + box.height });

    flyToBounds(
      { minX: min.x, minY: min.y, maxX: max.x, maxY: max.y },
      frameSizePx.width,
      frameSizePx.height,
    );
  }, [fitView, flyToBounds, frameSizePx, placements, objects]);

  /*
   * Tổng thể trả vừa khung; Từng việc giữ nguyên mức phóng khi chọn (mục dưới panel thì canvas chỉ dịch).
   * "So sánh hai bên": chọn là cả hai nửa phóng tới (nới ≥ 40 % tầng), kể cả đang Tổng thể; thoát thì trả vừa khung.
   * Chỉ chạy khi đổi khoá — kéo đối tượng không làm khung nhìn nhảy.
   */
  const chosenViewMode = useQcViewMode();
  const viewFlightRef = useRef<string | null>(null);
  /* Mục vừa bay tới lúc so sánh: nó biến mất (hoàn tác "Thêm đồ vật", xoá) thì trả về vừa khung, không kẹt ở chỗ trống. */
  const viewFlownObjectRef = useRef<string | null>(null);

  useEffect(() => {
    if (frameSizePx === null) {
      return;
    }

    /* Khổ khung nằm trong khoá: khung đổi cỡ (cột việc dựng xong, 1024) thì lớp vừa khung đổi, bay lại. */
    const key = `${isComparing ? `compare:${selectedObjectId ?? ''}` : chosenViewMode}@${frameSizePx.width}x${frameSizePx.height}`;

    if (key === viewFlightRef.current) {
      return;
    }

    const leftCompare = viewFlightRef.current?.startsWith('compare:') === true && !isComparing;

    if (leftCompare || (!isComparing && chosenViewMode === 'overview')) {
      viewFlightRef.current = key;
      viewFlownObjectRef.current = null;
      endFlight();
      return;
    }

    const placement = placements.find((item) => item.id === selectedObjectId);

    if (!isComparing || selectedObjectId === null) {
      viewFlightRef.current = key;
      const flown = viewFlownObjectRef.current;
      viewFlownObjectRef.current = null;

      if (flown !== null && !objects.some((object) => object.id === flown)) {
        endFlight();
      }
      return;
    }

    /* Chưa có hình của mục (đang đọc): chưa ghi khoá, lần vẽ sau bay. */
    if (placement === undefined || surfacePx === null) {
      return;
    }

    viewFlightRef.current = key;
    viewFlownObjectRef.current = selectedObjectId;
    const box = focusBoundsOf(rotatedBounds(placement.boundsPx, placement.angleDeg), surfacePx);
    const min = toFramePoint(fitView, { x: box.x, y: box.y });
    const max = toFramePoint(fitView, { x: box.x + box.width, y: box.y + box.height });

    flyToBounds({ minX: min.x, minY: min.y, maxX: max.x, maxY: max.y }, frameSizePx.width, frameSizePx.height);
  }, [chosenViewMode, endFlight, fitView, flyToBounds, frameSizePx, isComparing, objects, placements, selectedObjectId, surfacePx]);

  /*
   * Lỗi quy chuẩn của lớp (P03). Mở từ nút "Sửa" hay bấm một dòng: bay tới chỗ lỗi (khung
   * ±2,5 m — đủ thấy cả phòng thiếu cửa), chọn đối tượng nếu lỗi là của một món trong lớp.
   * Khoá có khổ khung: cột việc dựng xong đổi khổ thì "vừa khung" của chế độ nhìn đè lên, bay lại.
   */
  const ruleIssues = useLayerRuleIssues({ projectId, levelId: level?.id ?? null, layer: 'objects' });
  const focusedIssue = ruleIssues.focused;
  const issueFlightRef = useRef<string | null>(null);

  useEffect(() => {
    if (focusedIssue === null || frameSizePx === null || isLoading) {
      return;
    }

    const key = `${focusedIssue.key}@${frameSizePx.width}x${frameSizePx.height}`;

    if (key === issueFlightRef.current) {
      return;
    }

    issueFlightRef.current = key;
    const object = objects.find((item) => item.id === focusedIssue.entityId || item.entityId === focusedIssue.entityId);

    if (object !== undefined && object.id !== selectedObjectId) {
      onSelect(object.id);
    }

    if (focusedIssue.at === null) {
      return;
    }

    const scale = scaleOfLevel(level);
    const centre = toPixelPoint(focusedIssue.at, scale);
    const half = scale.millimetresToPixels(millimetres(ISSUE_FLIGHT_HALF_MM));
    const min = toFramePoint(fitView, { x: centre.x - half, y: centre.y - half });
    const max = toFramePoint(fitView, { x: centre.x + half, y: centre.y + half });

    flyToBounds({ minX: min.x, minY: min.y, maxX: max.x, maxY: max.y }, frameSizePx.width, frameSizePx.height);
  }, [fitView, flyToBounds, focusedIssue, frameSizePx, isLoading, level, objects, onSelect, selectedObjectId]);

  /* `?tool=door|window` của nút "Sửa": bật sẵn "Vẽ cửa đi/cửa sổ" một lần khi lớp đã đọc xong. */
  const initialToolRef = useRef(ruleIssues.initialTool);

  useEffect(() => {
    const tool = initialToolRef.current;

    if (isLoading || (tool !== 'door' && tool !== 'window')) {
      return;
    }

    initialToolRef.current = null;

    if (canEdit) {
      setDrawLayer(tool);
    }
  }, [canEdit, isLoading]);

  /*
   * Số đo hai đầu tường của đối tượng đang chọn.
   *
   * Trạng thái là `'measuring'` trong lúc kéo và `'idle'` khi chỉ đang chọn —
   * đúng ba giá trị `MeasurementState` mà `MeasurementLabel` đọc. `null` khi
   * chưa chọn gì hoặc đối tượng chưa gắn được vào tường nào: một đối tượng
   * không có tường chủ thì không có hai đầu tường để mà đo.
   */
  const dragMeasurement = useMemo(() => {
    if (selectedObject === null || isOrphanObject(selectedObject)) {
      return null;
    }

    const wall = wallOfObject(selectedObject.hostWallId);

    if (wall === null) {
      return null;
    }

    return toDragMeasurement(
      selectedObject,
      wall,
      level,
      draggingObjectId === selectedObject.id ? 'measuring' : 'idle',
    );
  }, [draggingObjectId, level, selectedObject, wallOfObject]);

  const tokens = useMemo(() => dataLayerTokens(layerVisibility), [layerVisibility]);
  /* Tầng đã đọc xong mà không có đoạn tường nào: không có chỗ đặt cửa (BUG-422). */
  const hasNoWall = !isLoading && !hasError && graphWalls.length === 0;
  /* Tầng chưa có bản vẽ: đừng bảo "duyệt tường trước" — tường cũng trống (N2-07). */
  const hasNoDrawing = hasNoWall && backgroundQuery.data !== undefined && backgroundQuery.data.imageUrl === null;
  const { onNavigate } = options;

  /*
   * Lớp vẽ theo pixel KHUNG (BUG-403): `<svg>` phủ kín khung với `viewBox` là vùng bản vẽ đang
   * thấy; ảnh nền, vòng chọn và số đo là HTML ở toạ độ khung, không lớp `scale()` nào.
   */
  const view: CanvasFitView = {
    x: viewport.x + viewport.zoom * fitView.x,
    y: viewport.y + viewport.zoom * fitView.y,
    zoom: viewport.zoom * fitView.zoom,
  };
  const hasFrame = frameSizePx !== null && frameSizePx.width > 0 && frameSizePx.height > 0;
  const activePlacement =
    placements.find((placement) => placement.id === (selectedObjectId ?? hoveredObjectId)) ?? null;
  const onFrame = (point: PixelPoint): PixelPoint => toFramePoint(view, point);
  const issueScale = scaleOfLevel(level);
  const issueAtPx = focusedIssue?.at == null ? null : toPixelPoint(focusedIssue.at, issueScale);

  const hasFurnitureAttention = furnitureQuery.isError;

  const state = deriveScreenState({
    isViewerRole,
    isCollapsed,
    hasError,
    isLoading,
    hasFurnitureAttention,
    counter: reviewCounter,
  });

  return {
    state,
    objects,
    counts,
    reviewCounter,
    reviewProgressLabel: reviewProgressLabel(reviewCounter.reviewed, reviewCounter.total),
    selectedObjectId,
    hoveredObjectId,
    layerVisibility,
    listLayerFilter,
    subtypeFilters,
    collapsedGroups,
    isCompact: isCollapsed,
    isCollapsed,
    isViewerRole,
    filteredLabel:
      visibleObjects.length < objects.length ? filteredCountLabel(visibleObjects.length, objects.length) : null,
    viewerRoleNotice: isViewerRole ? OBJECT_LAYER_TEXT.forbidden : null,
    emptyNotice:
      reviewCounter.total === 0 && !isLoading && !hasError
        ? hasNoWall
          ? hasNoDrawing
            ? OBJECT_LAYER_TEXT.emptyNoDrawing
            : OBJECT_LAYER_TEXT.emptyNoWall
          : OBJECT_LAYER_TEXT.emptyExplanation
        : null,
    errorMessage: hasError
      ? isFloorNotFound(floorLayer.error)
        ? floorLayer.errorMessage
        : OBJECT_LAYER_TEXT.errorMessage
      : null,
    furnitureAttentionNotice: hasFurnitureAttention ? OBJECT_LAYER_TEXT.furnitureAttention : null,

    onChangeSubtype,
    onChangeSwing,
    onChangeFurnitureKind,
    onDragPosition,
    onDelete,
    onApprove: onApproveAndNext,
    onAttachToNearestWall,
    onSelectHostWall,

    onSelect,
    onHover,

    onToggleLayer,
    onFilterLayer,
    onToggleSubtypeFilter,
    onToggleGroupCollapsed,
    onUndo,
    onToggleCollapsed,

    placements,
    dragMeasurement:
      dragMeasurement === null
        ? null
        : {
            ...dragMeasurement,
            wallStartPx: onFrame(dragMeasurement.wallStartPx),
            wallEndPx: onFrame(dragMeasurement.wallEndPx),
            objectPx: onFrame(dragMeasurement.objectPx),
            midToStartPx: onFrame(dragMeasurement.midToStartPx),
            midToEndPx: onFrame(dragMeasurement.midToEndPx),
          },
    rows,
    inspector,
    wallOutlines: wallOutlinesPx,
    viewBoxPx: surfacePx === null || !hasFrame ? surfacePx : visibleDrawingRect(view, frameSizePx),
    flightZoom: viewport.zoom,
    onResetFlight: endFlight,
    unitPx: 1 / view.zoom,
    surfaceRectPx: surfacePx === null ? null : toFrameRect(view, surfacePx),
    haloRectPx:
      activePlacement === null
        ? null
        : toFrameRect(view, rotatedBounds(activePlacement.boundsPx, activePlacement.angleDeg)),
    /* Số ghim = thứ tự trong hàng đợi (như dòng danh sách), kể cả khi một mục chưa có hình để vẽ ghim. */
    viewPins: rows.filter((row) => !row.isReviewed).flatMap((row, index) => {
      const placement = placements.find((item) => item.id === row.id);

      return placement === undefined ? [] : [{ id: row.id, n: index + 1, ...onFrame(placement.centrePx) }];
    }),
    onFrameResize,
    backgroundImageUrl: background?.imageUrl ?? null,
    backgroundImageAlt: background?.imageAlt ?? '',
    millimetresPerPixel: millimetresPerPixelOf(level),
    layerTotalLabel: layerTreeTotalLabel(counts.total),
    partialNotice: lowConfidenceObjects.length === 0 ? null : lowConfidenceNotice(lowConfidenceObjects.length),
    dataLayerTokens: tokens,
    confidenceTokenOf,
    undoStepCount: dispatchBundle.history.undoSteps().length,
    viewport: view,
    activeLayer,
    activeSubtype,
    isLowConfidenceOnly: lowConfidenceOnly,
    availableSubtypes,
    highlightedWallId: flownWallId,
    onSelectLayer,
    onSelectSubtypeSlot,
    drawLayer: canEdit ? drawLayer : null,
    onStartDraw,
    ruleIssues: {
      issues: ruleIssues.issues,
      focused: ruleIssues.focused,
      focusResolved: ruleIssues.focusResolved,
      onFocus: ruleIssues.onFocus,
      onClearFocus: ruleIssues.onClearFocus,
    },
    /* Bán kính ≥ 18 px màn hình hoặc 300 mm, lấy cái lớn hơn: thấy được ở mọi mức phóng. */
    ruleIssueMarker:
      issueAtPx === null
        ? null
        : {
            ...issueAtPx,
            radius: Math.max(ISSUE_MARKER_MIN_SCREEN_PX / view.zoom, issueScale.millimetresToPixels(millimetres(ISSUE_MARKER_MIN_MM))),
          },
    onPlaceAt,
    onResize,
    onRotate,
    focusKindToken,
    kindPicker,
    suggestionCount: canEdit ? suggestions.length : 0,
    suggestionLabel: pendingSuggestionsLabel(suggestions.length),
    onAcceptAllSuggestions,
    onRejectAllSuggestions,
    approveConfidentLabel: canApproveConfident ? approveConfidentLabelOf(confidentObjects.length) : null,
    ...(canApproveConfident ? { onApproveConfident } : {}),
    approveRemainingLabel: canApproveRemaining ? approveUnsureLabelOf(unsureObjects.length) : null,
    approveRemainingConfirm: canApproveRemaining ? confirmUnsureLabelOf(unsureObjects.length) : null,
    ...(canApproveRemaining ? { onApproveRemaining } : {}),
    reviewBreakdownLabel: canEdit ? reviewBreakdownLabel : null,
    onToggleSelect,
    onSelectLayerObjects,
    onToggleLowConfidenceOnly,
    onAddManually,
    onOpenWallLayer:
      hasNoWall && onNavigate !== undefined
        ? hasNoDrawing
          ? () => onNavigate(ROUTES.project.floors(projectId))
          : () => onNavigate(ROUTES.project.walls(projectId, floorId))
        : null,
    layerGate,
    nextPending,
    saveLabel,
    onOpenLayer:
      onNavigate === undefined
        ? null
        : (layer: 'walls' | 'rooms') => onNavigate(ROUTES.project[layer](projectId, floorId)),
    saveBlock,
    provisionalScaleNotice,
    readFailure,
    scaleLock: isScaleLocked
      ? {
          reason: scaleLock.reason ?? SCALE_LOCK_REASON,
          onOpenScale: onNavigate === undefined ? null : () => onNavigate(ROUTES.project.scale(projectId, floorId)),
        }
      : null,
  };
}
