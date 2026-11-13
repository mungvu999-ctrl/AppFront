/**
 * Nửa "suy nghĩ" của màn S-12 "Duyệt lớp tường" — mọi thứ hai view của màn cần,
 * đã xong.
 *
 * `types.ts` là hợp đồng props DUY NHẤT của màn và nó ĐÃ ĐÓNG BĂNG; hook này
 * trả về đúng {@link WallLayerReviewProps} (`panel` + `canvas`), cộng đúng hai
 * trường thoả thuận thêm với người viết view — {@link WallLayerToolRailProps} và
 * {@link WallLayerStatusBarProps} — khai và xuất tại file này để T8 đối chiếu hai
 * bên lúc tích hợp.
 *
 * ## Đường ghi (A10)
 *
 * Không một dòng nào gọi `set()` hay `_applyPatches()`. Mọi thay đổi đi:
 * lệnh S-07 (hoặc lệnh duyệt dựng bằng nguyên thuỷ công khai) → `dispatch` →
 * `SpatialPort.applyPatches` = `commit(patches, label)` → store. Xem
 * `wallLayerReviewGateway.ts` để có lý do và trích dẫn.
 *
 * ## Trạng thái máy chủ (R-64)
 *
 * Không `useState` nào giữ cờ đang-tải hay cờ hỏng. Ảnh nền — dữ liệu máy chủ
 * duy nhất của màn — đi qua `useQuery` dưới khoá `queryKeys.drawing.byFloor`;
 * mọi lượt ghi gọi `applyInvalidation(queryClient, 'editWall', …)`, tức đúng ba
 * khoá `invalidationMap.editWall` khai (`space`/`room`/`violation`), không gọi
 * `invalidateQueries` trần. `useState` ở đây chỉ giữ trạng thái của riêng giao
 * diện: ba cờ lọc, cờ thu gọn, tường đang chọn, và trạng thái máy công cụ.
 *
 * ## Không công thức tự chế (R-61)
 *
 * - Đa giác tường: `resolveWallShapes` (`src/domain/walls/joints.ts`).
 * - Chiều dài tim tường: `centrelineLength` (`src/domain/walls/types.ts`).
 * - Tách/nối: `splitWall`/`mergeWalls` (`src/domain/walls/edit.ts`), gọi qua
 *   chính hai hàm dựng lệnh của S-07.
 * - Ngưỡng "độ tin cậy thấp": `confidenceThreshold` của dự án (N5, BUG-354), mặc định 0,70; lọc,
 *   danh sách và gạch chéo canvas cùng đọc `isLowConfidence` với ngưỡng đó.
 * - Số: `formatLength`, `formatNumber`, `formatPoint`, `formatElevationM`,
 *   `formatScaleDensity`. Không một hàm định dạng số dựng sẵn nào của JavaScript
 *   được gọi thẳng trong màn — A15 đặt việc đó ở `src/lib/format`.
 * - **Không một lời gọi nào tới đối tượng toán học toàn cục**, ở đây hay ở bất
 *   cứ file nào trong thư mục màn — nghiệm thu grep rỗng.
 *
 * ## Chuyển động (mục B, R-71)
 *
 * Bộ đếm duyệt chạy 12 → 13 qua `useCountUp`, và `COUNT_UP_DURATION` của
 * `src/lib/motion/useCountUp.ts` là nấc `'standard'` = **260 ms**. Đặc tả viết
 * 240 ms; 240 không có trên thang năm giá trị (120/180/260/340/700) và
 * `local/no-raw-duration` chặn nó ở mức lỗi, nên màn đi theo luật nhà. Cùng lý
 * do, nháy nền hàng vừa hoàn tác dùng nấc `'slow'` = **340 ms** thay cho 400 ms,
 * và hai lượt 180 ms (cuộn hàng vào tầm nhìn, tô sáng chéo canvas ↔ danh sách)
 * là đúng nấc `'fast'` — không con số nào viết tay.
 *
 * ## Tự lưu (D-07 / A7) — bộ lưu lớp chung (F-04x-1)
 *
 * Màn không dựng engine lưu riêng: `useFloorLayerAutosave` giữ MỘT bộ lưu cho
 * mỗi người–dự án (base = revision của lượt N16 đã nạp, 409 → dải "Tải lại").
 * `useSaveIndicator(autosave)` vẫn dựng nhãn "Đã lưu lúc…" và nói ra cho
 * trình đọc màn hình (A7). Lượt tải lại từ máy chủ (`serverReplaceSeq` đổi)
 * xoá ngăn hoàn tác của màn — các bước cũ không còn khớp đồ thị mới.
 *
 * ## Bàn phím (I-01, A12, R-72)
 *
 * Không một `addEventListener('keydown')` nào. Mọi phím đăng ký qua
 * `useShortcut` → `appShortcutRegistry`. Sáu phím `J K Backspace 1 2 3` đã được
 * khảo sát xác nhận chưa ai chiếm. `Enter` KHÔNG được đăng ký làm phím tắt
 * toàn cục (nó nằm trong `RESERVED_KEYS`): hàng danh sách và nút "Duyệt đoạn
 * này" là phần tử focus được, và Enter kích hoạt hành động mặc định của phần tử
 * đang có tiêu điểm — đúng ngữ nghĩa bàn phím chuẩn, đúng cách đi qua
 * `expectAccessible`, và giữ nguyên lời hứa "Esc đóng lớp trên cùng".
 *
 * Ba phím công cụ `V`/`W`/`M` lấy tổ hợp từ `shortcutForTool` chứ không gõ tay,
 * và đăng ký ở tầng `canvas` với mã `wallLayerReview.*`. `Ctrl+Z` cũng đăng ký ở
 * tầng `canvas`: `buildGlobalShortcuts` khai nó ở tầng `global`, mà `canvas`
 * đứng TRÊN `global` trong `SCOPE_PRIORITY`, nên khi màn đang mở thì hoàn tác
 * chạy trên ngăn xếp 100 bước của chính màn, và không có hai đăng ký nào cùng
 * một tầng để `findOverlaps` phải kêu.
 *
 * `Space` (giữ để tạm di chuyển khung nhìn) và `F` (phủ khắp vùng chọn) KHÔNG
 * được đăng ký ở đây: cả hai là việc của khung nhìn canvas, và
 * `WallLayerCanvasProps` đã đóng băng không có hàm xử lý nào cho chúng — thêm
 * một phím không có đường ra là dựng một cái nút không nối vào đâu (R-73).
 */

import { useProjectUnits } from '@/hooks/useProjectUnits';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { WallThickness as SpatialWallThickness } from '@/types/spatial';
import { useQuery, useQueryClient } from '@tanstack/react-query';

import {
  createId,
  displayCodesOf,
  keepDisplayCodes,
  sortByDisplayCode,
  type EntityKind,
  type IdByKind,
} from '@/domain/spatial/ids';
import { normalizeSpatial } from '@/domain/spatial/normalize';
import type { NormalizedSpatial } from '@/domain/spatial/normalize';
import type { EntityId, Level, LevelId, Point, Wall, WallId } from '@/domain/spatial/types';
import { millimetresPerPixel, pixels } from '@/domain/units/scale';
import { millimetres, millimetresToMetres } from '@/domain/units/types';
import { useFloorLayerAutosave, type FloorLayerSaveBlock } from '@/hooks/useAutosave';
import { useFloorLayer } from '@/hooks/useFloorLayer';
import { useProjectConfidenceThreshold } from '@/hooks/useProjectConfidenceThreshold';
import { appNotificationBus } from '@/hooks/useNotifications';
import { useSaveIndicator } from '@/hooks/useSaveIndicator';
import { useShortcut } from '@/hooks/useShortcut';
import { can } from '@/lib/auth/permissions';
import { formatNumber } from '@/lib/format/number';
import type { ShortcutRegistry } from '@/lib/input/shortcutRegistry';
import type { NotificationBus } from '@/lib/mutations/notificationBus';
import { createSelectionChannel } from '@/lib/selection/syncChannel';
import { planReveals, revealAnchor, describeSelection } from '@/lib/selection/revealPolicy';
import { selectSingle, toggleSelection, type SelectionContext } from '@/lib/selection/selectionOps';
import { applyInvalidation } from '@/lib/query/invalidation';
import { queryKeys } from '@/lib/query/queryKeys';
import { durationMs } from '@/lib/motion';
import { shortcutForTool } from '@/lib/tools/shortcuts';
import { openingsOfWall } from '@/lib/commands/business/shared';
import { newestEntryId } from '@/lib/commands/history';
import { createToolState, reduceTool, DEFAULT_TOOL_SETTINGS } from '@/lib/tools/toolMachine';
import type {
  ToolContext,
  ToolEvent,
  ToolId,
  ToolInputValue,
  ToolMachineState,
  ToolTransition,
} from '@/lib/tools/toolMachine';
import { TOOLS } from '@/lib/tools/tools';
import { WALL_COMMAND_TYPES } from '@/lib/commands/business/commandTypes';
import {
  DEFAULT_DRAW_SNAP_RADIUS_MM,
  resolveDrawPoint,
  wallDrawSnapTargets,
  withInheritedWallStyle,
  type WallDrawSnap,
} from './wallDrawSnap';
import { planConnectedDraw, runWallCommands } from './wallDrawConnect';
import { ROUTES } from '@/routes/paths';
import { thicknessLockTextOf } from '@/lib/viewmodel/provisionalScale';
import { useStore } from '@/store';
import { currentSelection } from '@/store/commit';
import type { ProjectRole } from '@/types/project';

import {
  buildApproveWallCommand,
  buildUnapproveWallCommand,
  buildChangeThicknessCommand,
  buildChangeWallMaterialCommand,
  buildDeleteWallCommand,
  buildDragWallEndCommand,
  buildMergeWallsCommand,
  buildSplitWallCommand,
  commandContextOf,
  createMockWallLayerReviewGateway,
  createWallLayerDispatchDeps,
  createWallLayerReviewGateway,
  createWallUndoTicket,
  centreOfBounds,
  clampZoom,
  cursorLabelOf,
  DEFAULT_ZOOM,
  formatScaleLabel,
  geometryReasonsOf,
  geometrySuspectIdsOf,
  isLowConfidence,
  measurementOutcomeToPx,
  miniMapCentreMm,
  miniMapRectOf,
  isStandardThickness,
  reviewProgressLabel,
  runWallCommand,
  toWallInspector,
  toWallRow,
  wallLengthNumberOf,
  canvasLabelOf,
  drawingSizeOf,
  legendLevelsOf,
  scaleOfLevel,
  toCanvasShapes,
  toolOutcomeToCommand,
  toMeasurementPx,
  toMillimetrePoint,
  toPixelPoint,
  unionOfBounds,
  wallStatusCode,
  zoomPercentOf,
  WALL_LAYER_THICKNESS_CHOICES,
  ZOOM_STEP,
  type WallLayerBackground,
  type WallLayerCanvasShape,
  type WallLayerGraphPort,
  type WallLayerPointerReading,
  type WallLayerRectPx,
  type WallLayerReviewGateway,
  type WallLayerSizePx,
  type WallLayerViewportPx,
  type WallLayerViewportRectPercent,
} from './wallLayerReviewGateway';
import type { WallLayerLeftPanelExtras } from './WallLayerLeftPanel';
import {
  centredCanvasView,
  fitCanvasView,
  toFramePoint,
  toFrameRect,
  visibleDrawingRect,
} from '../shared/canvasFit';
import { SAVE_BLOCKED_LABEL, useFloorLayerReadFailure, type FloorLayerReadFailure } from '../shared/floorLayerReadFailure';
import { useProvisionalScaleNotice, type ProvisionalScaleNotice } from '../shared/provisionalScaleNotice';
import { isQcCompare, setQcCompare, useQcCompare } from '../shared/qcCompare';
import { focusBoundsOf, focusFrameOf, useQcViewMode } from '../shared/qcViewMode';
import { useLayerRuleIssues } from '../shared/useLayerRuleIssues';
import { useScaleLock } from '../shared/useScaleLock';
import type { WallLayerStatusBarProps } from './WallLayerStatusBar';
import { wallThicknessColorGroupOf } from './wallLayerHatch';
import type { WallLayerCanvasViewProps, WallLayerMeasurementPx, WallOpeningLayerToggle } from './wallLayerHatch';
import { openingSymbolsOf } from '../shared/openingSymbols';
import type { WallLayerToolId, WallLayerToolRailProps } from './WallLayerToolRail';
import type {
  WallLayerFilterKey,
  WallLayerFilters,
  WallLayerReviewProps,
  WallLayerScreenState,
  WallLayerViewProps,
  WallReviewCounter,
  WallRowViewModel,
  WallThicknessChoice,
} from './types';
import { arrowStepHandler } from './listArrowKeys';
import { useFrameState } from '@/hooks/useFrameState';
import { useWallReviewQueue } from './useWallReviewQueue';
import { wallTagOf } from './wallTag';
import { nextUnreviewedWallId, sortByReviewQueue, type WallReviewQueue, type WallReviewReason } from './wallReviewQueue';

/* -------------------------------------------------------------------------- */
/* Chuỗi của màn.                                                              */
/* -------------------------------------------------------------------------- */

/**
 * Mọi câu người dùng đọc, gom một chỗ.
 *
 * Viết thẳng tiếng Việt như mọi màn khác của repo (`src/i18n/vi.json` là từ
 * điển kiểm tra, không phải bảng dịch lúc chạy). Chữ thường kiểu câu theo A6,
 * trừ mã tường và tên phím — hai ngoại lệ A6 cho phép.
 */
export const WALL_LAYER_TEXT = {
  /*
   * Bốn câu dưới đây từng TRÔI khỏi `src/i18n/vi.json`: mã nói một đằng, từ
   * điển kiểm tra nói một nẻo, và không cổng nào bắt được vì `vi.json` không
   * phải bảng dịch lúc chạy. Bản trong từ điển là bản khớp đặc tả, nên mã đi
   * theo từ điển — xem `vi.json#wallLayerReview.state`.
   */
  emptyNotice:
    'Chưa phát hiện được đoạn tường nào ở tầng này. Bạn có thể vẽ tường thủ công bằng phím W, hoặc quay lại bước Xử lý để chạy nhận dạng lại.',
  viewerRoleNotice:
    'Bạn đang xem với vai người xem, nên không duyệt hay sửa được đoạn tường nào. Nhờ người có quyền sửa dự án duyệt giúp.',
  mergeLabel: 'Nối đoạn',
  mergeDescription: 'Nối hai đoạn tường đang chọn thành một.',
  /** Nhãn ô đánh dấu bật/tắt tim tường (BC-17). */
  /** Nhãn khối điều hướng tầng của panel trái (BC-05). */
  floorNavLabel: 'Tầng của bản vẽ',
  /** Nhãn nút thu gọn / mở lại hai panel (BT-16). */
  collapsePanelsLabel: 'Thu gọn hai panel',
  expandPanelsLabel: 'Mở lại hai panel',
  shortcutNext: 'Xuống tường tiếp theo.',
  shortcutPrevious: 'Lên tường phía trên.',
  /*
   * `shortcutApprove` đã BỊ XOÁ, không phải bỏ quên.
   *
   * Nó mô tả một phím duyệt chưa từng được đăng ký: `rg 'shortcutApprove'`
   * chỉ ra đúng một chỗ khai và không một `useShortcut` nào dùng. Đặc tả không
   * đòi phím duyệt, và `Enter` trên nút "Duyệt đoạn này" đang có tiêu điểm đã
   * là đường bàn phím đúng (xem ghi chú "Bàn phím" ở đầu file) — nên chỗ sửa
   * là xoá câu mô tả, không phải dựng thêm một phím để câu mô tả có việc.
   * Khoá `wallLayerReview.shortcuts.approve` trong `vi.json` để nguyên: lượt
   * này chỉ được THÊM khoá vào từ điển, không được xoá.
   */
  shortcutDelete: 'Xoá đoạn tường đang chọn.',
  shortcutUndo: 'Hoàn tác thao tác gần nhất.',
  /** U43: mỗi phím 1/2/3 ghi đúng số mm của nó, không ba dòng giống nhau. */
  shortcutThickness: (mm: number): string => `Đặt độ dày ${mm} mm cho đoạn tường đang chọn, hoặc cho nét đang vẽ.`,
  shortcutTool: 'Vẽ tường.',
  shortcutToolSelect: 'Công cụ chọn.',
  shortcutToolMeasure: 'Công cụ đo.',
  shortcutToolSplit: 'Tách đoạn tường.',
  shortcutArrowNext: 'Chọn dòng kế tiếp trong danh sách.',
  shortcutArrowPrevious: 'Chọn dòng phía trên trong danh sách.',
  shortcutApproveNext: 'Duyệt đoạn đang chọn rồi sang đoạn chưa duyệt kế tiếp.',
} as const;

/* -------------------------------------------------------------------------- */
/* Hai trường thoả thuận thêm với người viết view — NAY ĐỌC TỪ CHÍNH VIEW.     */
/* -------------------------------------------------------------------------- */

/*
 * `WallLayerToolRailProps` và `WallLayerStatusBarProps` từng được khai HAI BẢN:
 * một ở đây, một trong file của mỗi view, vì hook và view được viết song song
 * trên hai nhánh chưa gộp. Hai bản đã LỆCH NHAU thật:
 *
 * - ray công cụ: bản hook là một danh sách ô chung
 *   (`{ items, activeToolId }`), bản view là hợp đồng điều phối viên chốt
 *   (`{ activeTool, onSelectTool, canMerge, onMerge, readOnly }`);
 * - thanh trạng thái: bản hook có `saveState`/`reviewProgressLabel` nhưng
 *   THIẾU `cursorLabel`, thứ hợp đồng chốt đòi.
 *
 * Hợp đồng đã chốt thắng, và cách chắc chắn nhất để hai bên không lệch lần nữa
 * là bỏ hẳn bản thứ hai: hook đọc kiểu TỪ view. `import type` bị xoá lúc biên
 * dịch nên không dòng nhập nào kéo một component vào bản dựng của hook.
 *
 * `reviewProgressLabel` không mất đi — nó vẫn ở `WallLayerViewProps` của panel,
 * đúng một chỗ. `saveState` cũng vậy: nhãn `saveLabel` đã nói ra trạng thái tự
 * lưu bằng tiếng Việt, nên một mã máy đọc song song chỉ là chỗ thứ hai để lệch.
 */

/* -------------------------------------------------------------------------- */
/* Tham số vào và giá trị ra.                                                  */
/* -------------------------------------------------------------------------- */

export interface UseWallLayerReviewOptions {
  readonly projectId: string;
  readonly floorId: string;
  /** Tầng đang duyệt. Vắng mặt thì hook lấy tầng đầu tiên của đồ thị. */
  readonly levelId?: LevelId;
  readonly roles?: readonly ProjectRole[];
  /** Cổng dữ liệu tiêm được. Vắng mặt thì hook dựng cổng thật, đúng một lần. */
  readonly gateway?: WallLayerReviewGateway;
  /** Sổ phím tiêm được — bài kiểm dựng sổ riêng để không đụng sổ dùng chung. */
  readonly registry?: ShortcutRegistry;
  /** Ép thu gọn hai panel — cho story và bài kiểm muốn một câu trả lời cố định. */
  readonly forceCollapsed?: boolean;
  /**
   * Bus thông báo — chỗ toast hoàn tác của A8 đi ra.
   *
   * Bỏ trống là bus của cả phiên (`appNotificationBus`), thứ `NotificationHost`
   * ở `src/main.tsx` đang vẽ. Test và story tiêm bus riêng để hai lượt kiểm
   * không thấy thông báo của nhau — cùng khuôn `useProcessingScreen`.
   */
  readonly notifications?: NotificationBus;
  /** Lối ra của dải tỉ lệ tạm — container truyền `onNavigate` của nó. */
  readonly onNavigate?: (path: string) => void;
}

/*
 * Hợp đồng canvas: ĐỌC TỪ `wallLayerHatch.ts`, không khai lại.
 *
 * Hai khai báo từng đứng ở đây (`WallLayerMeasurementPx`,
 * `WallLayerCanvasViewProps`) là bản chép tay của hợp đồng lớp canvas, viết khi
 * nhánh canvas chưa gộp vào worktree này — cách duy nhất để hook biên dịch được
 * lúc đó. Nhánh đã gộp, nên bản chép biến mất theo đúng kế hoạch người viết nó
 * để lại: một hợp đồng, một chỗ khai.
 */
export type { WallLayerCanvasViewProps, WallLayerMeasurementPx } from './wallLayerHatch';

/** Đúng hợp đồng đã đóng băng, cộng bốn nhóm thoả thuận thêm với hai worker view. */
export interface UseWallLayerReviewResult extends WallLayerReviewProps {
  readonly canvas: WallLayerCanvasViewProps;
  readonly toolRail: WallLayerToolRailProps;
  readonly statusBar: WallLayerStatusBarProps;
  /** Những gì panel trái cần mà `WallLayerViewProps` (đã đóng băng) không mang. */
  readonly leftPanel: WallLayerLeftPanelExtras & WallOpeningLayerToggle;
  /** Hàng đợi duyệt (demo Z/S-15): nhóm danh sách, cổng, đổi về chuẩn — `useWallReviewQueue`. */
  readonly queue: WallReviewQueue;
  /** Khối lưu lớp của tầng — dải "Tải lại" / "Không lưu được" (F-04x-1). */
  readonly saveBlock: FloorLayerSaveBlock | null;
  /** Dải tỉ lệ tạm (F-04x-2); `null` khi tầng đã có tỉ lệ thật. */
  readonly provisionalScaleNotice: ProvisionalScaleNotice | null;
  /** Đọc lớp của tầng hỏng khi chưa có tài liệu — view thay cả màn (BUG-326). */
  readonly readFailure: FloorLayerReadFailure | null;
}

/* -------------------------------------------------------------------------- */
/* Hằng của riêng hook.                                                        */
/* -------------------------------------------------------------------------- */

/**
 * Loại thông báo của một lượt xoá tường.
 *
 * `notificationBus` gộp các thông báo CÙNG LOẠI trong một cửa sổ năm giây và
 * dựng một vé hoàn tác gộp cho cả nhóm, nên xoá năm tường liên tiếp cho ra một
 * toast "hoàn tác 5 thay đổi" chứ không phải năm toast chồng nhau. Chuỗi này
 * viết đúng một chỗ (R-71).
 */
const WALL_DELETE_NOTIFICATION_TYPE = 'wallLayerReview.deleteWall';
/** Toast "Hoàn tác" bị từ chối: bước đã rời lịch sử, hoặc một bước mới hơn sửa cùng tường (BUG-579). */
const WALL_UNDO_REFUSED_NOTIFICATION_TYPE = 'wallLayerReview.undoRefused';
/** "Nối đoạn" không nối được — trước đây bấm xong không có phản hồi gì (G4a-12). */
const WALL_MERGE_REFUSED_NOTIFICATION_TYPE = 'wallLayerReview.mergeRefused';
/* `mergeWalls` (domain/walls/edit.ts) đòi thẳng hàng, cùng dày/loại/cao độ; khe hở bao nhiêu cũng được. */
const WALL_MERGE_REFUSED_TEXT = 'Chỉ nối được hai đoạn thẳng hàng, cùng độ dày và cùng loại.';
/** Nét vẽ bị từ chối (không nối tường nào, quá ngắn…) — nói ngay, cả ở thanh trạng thái lẫn toast (#9). */
const WALL_DRAW_REFUSED_NOTIFICATION_TYPE = 'wallLayerReview.drawRefused';
const WALL_DRAW_ROOM_NOTICE_TYPE = 'wallLayerReview.drawRoomNotSplit';
const WALL_DRAW_ROOM_NOTICE_TITLE = 'Chưa tách phòng';
const WALL_DRAW_REFUSED_TITLE = 'Chưa vẽ được tường';
const isCommandList = <T extends object>(value: T | readonly T[]): value is readonly T[] => Array.isArray(value);
/** Bán kính bắt điểm khi vẽ tường, tính bằng px MÀN (đổi ra mm theo mức phóng). */
const DRAW_SNAP_SCREEN_PX = 12;
/* UX41 U09: phím A/Delete/đổi độ dày khi tầng chưa có tỷ lệ không được im lặng — nói lý do + lối ra. */
const WALL_SCALE_LOCKED_NOTIFICATION_TYPE = 'wallLayerReview.scaleLocked';
const WALL_UNDO_REFUSED_TEXT =
  'Chưa hoàn tác: một thay đổi sau đó đã sửa cùng tường. Dùng Ctrl+Z để hoàn tác lần lượt.';

/** Câu chỉ dẫn trên thanh trạng thái khi một công cụ vẽ/tách/đo đang bật (G4a-23). */
const TOOL_HINT_TITLES: Readonly<Record<string, string>> = {
  drawWall: 'Nhấn giữ rồi kéo để vẽ một nét · Phím 1/2/3 đổi độ dày · Shift khoá ngang/dọc · Esc dừng nét, Esc lần nữa về Chọn (V)',
  splitWall: 'Esc về Chọn (V)',
  measure: 'Esc huỷ lượt đo, Esc lần nữa về Chọn (V)',
};

const toolHintOf = (
  tool: string,
  pointCount: number,
  draw: { readonly thicknessMm: number | null; readonly isStartFloating: boolean } = { thicknessMm: null, isStartFloating: false },
): string => {
  switch (tool) {
    case 'drawWall': {
      const thickness = `Dày ${draw.thicknessMm === null ? 'theo tường nối' : `${draw.thicknessMm} mm`}`;

      if (pointCount === 0) {
        return `Bấm điểm đầu · ${thickness}`;
      }

      return draw.isStartFloating ? `Điểm cuối phải chạm một tường · ${thickness}` : `Bấm điểm cuối · ${thickness}`;
    }
    case 'splitWall':
      return 'Bấm lên tường tại chỗ cần tách';
    case 'measure':
      return pointCount === 0 ? 'Bấm điểm đầu để đo' : 'Bấm điểm thứ hai';
    default:
      return '';
  }
};

/** Ba cờ lọc lúc mở màn: chưa lọc gì. */
const NO_FILTERS: WallLayerFilters = {
  onlyUnreviewed: false,
  onlyLowConfidence: false,
  onlyNonStandardThickness: false,
};

const NO_WALLS: readonly Wall[] = [];
const NO_LEVELS: readonly Level[] = [];

/**
 * Tỷ lệ dùng khi tầng CHƯA hiệu chỉnh.
 *
 * `WallLayerCanvasProps.millimetresPerPixel` không nhận `null`, nên phải có một
 * giá trị; một milimét trên một điểm ảnh là phép biến đổi đồng nhất — canvas vẽ
 * đúng toạ độ đồ thị, không phóng đại cũng không thu nhỏ theo một tỷ lệ bịa.
 * Thanh trạng thái thì nói thẳng rằng chưa có tỷ lệ (xem {@link formatScaleLabel}).
 */
const UNCALIBRATED_SCALE = millimetresPerPixel(1);

/** Mã tầng rỗng khi đồ thị chưa tới — máy công cụ chưa dựng được gì ở trạng thái này. */
const NO_LEVEL_ID = '';
const NO_ROWS: readonly WallRowViewModel[] = [];

/**
 * Bốn công cụ của ray, theo đúng thứ tự đặc tả đọc chúng.
 *
 * `WallLayerToolId` (hợp đồng ray, khai ở `WallLayerToolRail.tsx`) là ĐÚNG bốn
 * mục này, và cả bốn có mặt trong `ToolId` của `toolMachine` — nên phép gán hai
 * chiều dưới đây không mất mát gì. "Nối đoạn" cố ý KHÔNG nằm trong danh sách:
 * `toolMachine` không có chế độ nào cho việc gộp, nó là một hành động theo vùng
 * chọn (`canMerge`/`onMerge` của hợp đồng ray), không phải một công cụ.
 */
const RAIL_TOOL_IDS: readonly WallLayerToolId[] = ['select', 'drawWall', 'splitWall', 'measure'];

/**
 * Vùng nhìn khởi tạo của bản đồ nhỏ, phần trăm khổ bản vẽ.
 *
 * Cùng bộ số mà `useMiniMap` vốn tự đặt (`useMiniMap.ts:36-39`), viết ra đây để
 * nó là một quyết định đọc được chứ không phải một mặc định ẩn của component.
 */
/** G4a-05: bề ngang chừa cho bản đồ nhỏ + chú giải khi "vừa khung" (tối đa 22% khung). */
/** P03: phóng tới lỗi quy chuẩn — khung nhìn phủ chừng 3 m quanh chỗ lỗi. */
const RULE_FOCUS_HALF_MM = 1500;
/** Bán kính dấu lỗi: không nhỏ hơn 300 mm trên bản vẽ hay 18 px trên màn. */
const RULE_MARKER_MIN_MM = 300;
const RULE_MARKER_MIN_FRAME_PX = 18;

const MINIMAP_INITIAL_VIEWPORT: WallLayerViewportRectPercent = {
  x: 20,
  y: 20,
  width: 40,
  height: 30,
};

/** Công cụ đang chọn của máy công cụ, đọc về đúng bốn mã ray. */
const railToolOf = (tool: ToolId): WallLayerToolId =>
  RAIL_TOOL_IDS.includes(tool as WallLayerToolId) ? (tool as WallLayerToolId) : 'select';

/* -------------------------------------------------------------------------- */
/* Phép ghép thuần — kiểm được mà không cần dựng hook.                          */
/* -------------------------------------------------------------------------- */

/** Tường của một tầng, theo đúng thứ tự đồ thị giữ chúng. */
/*
 * U07: nhãn `#W-xxx` đã hiện của một tầng, giữ qua lần tải lại (localStorage, theo dự án + tầng).
 * Nguồn chính là `displayCodesOf` đọc từ mã (giống nhau trên mọi máy, thêm tường không đánh lại
 * số); bộ nhớ này chỉ đỡ trường hợp XOÁ tường, khi thứ tự làm các tường sau lùi một số.
 * ponytail: chỉ trên trình duyệt này — máy khác vẫn lùi số sau khi xoá. Đường nâng cấp: máy chủ cấp mã hiển thị.
 */
const wallCodeMemoryKey = (projectId: string, levelId: string): string => `wall-codes:${projectId}:${levelId}`;

export function readWallCodeMemory(projectId: string, levelId: string | null): ReadonlyMap<string, string> {
  if (levelId === null) {
    return new Map();
  }

  try {
    const raw = localStorage.getItem(wallCodeMemoryKey(projectId, levelId));
    const parsed: unknown = raw === null ? null : JSON.parse(raw);

    return Array.isArray(parsed)
      ? new Map(parsed.filter((pair): pair is [string, string] => Array.isArray(pair) && typeof pair[0] === 'string' && typeof pair[1] === 'string'))
      : new Map();
  } catch {
    return new Map();
  }
}

export function writeWallCodeMemory(projectId: string, levelId: string | null, codes: ReadonlyMap<string, string>): void {
  if (levelId === null || codes.size === 0) {
    return;
  }

  try {
    localStorage.setItem(wallCodeMemoryKey(projectId, levelId), JSON.stringify([...codes]));
  } catch {
    /* Hết chỗ hoặc bị chặn: nhãn chỉ ổn định trong phiên, như trước. */
  }
}

export function wallsOfLevel(
  graph: NormalizedSpatial | null,
  levelId: LevelId | null,
): readonly Wall[] {
  if (graph === null || levelId === null) {
    return NO_WALLS;
  }

  const walls: Wall[] = [];

  for (const id of graph.byKind.wall) {
    const entity = graph.byId[id];

    if (entity !== undefined && 'centreline' in entity && entity.levelId === levelId) {
      walls.push(entity);
    }
  }

  return walls;
}

/** Tầng đang duyệt, hoặc tầng đầu tiên khi nơi gọi chưa chỉ định. */
export function levelOf(graph: NormalizedSpatial | null, levelId: LevelId | undefined): Level | null {
  if (graph === null) {
    return null;
  }

  const id = levelId ?? graph.byKind.level[0];

  if (id === undefined) {
    return null;
  }

  const entity = graph.byId[id];

  return entity !== undefined && 'elevationMm' in entity ? entity : null;
}

/**
 * Mọi tầng của bản vẽ, theo đúng thứ tự đồ thị giữ chúng (BC-05).
 *
 * Cùng khuôn {@link levelOf} — đọc `graph.byKind.level` rồi lọc ra thực thể có
 * `elevationMm`. KHÔNG một `useQuery` thứ hai nào: danh sách tầng đã nằm trong
 * chính đồ thị mà màn đang sửa.
 */
export function levelsOf(graph: NormalizedSpatial | null): readonly Level[] {
  if (graph === null) {
    return NO_LEVELS;
  }

  const levels: Level[] = [];

  for (const id of graph.byKind.level) {
    const entity = graph.byId[id];

    if (entity !== undefined && 'elevationMm' in entity) {
      levels.push(entity);
    }
  }

  return levels;
}

/** Ba cờ lọc áp lên danh sách. Cờ tắt thì không loại gì. */
export function applyWallFilters(
  walls: readonly Wall[],
  filters: WallLayerFilters,
  threshold?: number,
  suspectIds?: ReadonlySet<string>,
): readonly Wall[] {
  return walls.filter((wall) => {
    if (filters.onlyUnreviewed && wall.reviewed) {
      return false;
    }

    if (filters.onlyLowConfidence && !isLowConfidence(wall, threshold, suspectIds)) {
      return false;
    }

    return !(filters.onlyNonStandardThickness && isStandardThickness(wall.thicknessMm));
  });
}

/** Tường CHƯA DUYỆT kế tiếp — sống ở `wallReviewQueue.ts` (một hàng đợi), xuất lại cho nơi gọi cũ. */
export { nextUnreviewedWallId };

/** Hàng xóm của tường đang chọn theo một bước — `J` xuống, `K` lên. */
export function neighbourWallId(
  rows: readonly WallRowViewModel[],
  fromId: WallId | null,
  step: 1 | -1,
): WallId | null {
  if (rows.length === 0) {
    return null;
  }

  const current = fromId === null ? -1 : rows.findIndex((row) => row.id === fromId);
  const target = current + step;

  if (target < 0 || target >= rows.length) {
    return rows[current === -1 ? 0 : current]?.id ?? null;
  }

  return rows[target]?.id ?? null;
}

/**
 * Bảy trạng thái của A11, DẪN XUẤT từ dữ liệu chứ không phải bảy cờ rời rạc.
 *
 * Thứ tự quyết định là thứ tự trả lời: quyền trước (không có quyền thì mọi thứ
 * khác không đổi được gì), rồi vỏ màn, rồi mới tới dữ liệu. Bảy kịch bản của
 * `wallLayerReviewScenarios.ts` rơi đúng vào bảy nhánh này.
 */
export function deriveScreenState(input: {
  readonly isViewerRole: boolean;
  readonly isCollapsed: boolean;
  readonly hasError: boolean;
  readonly isLoading: boolean;
  readonly counter: WallReviewCounter;
}): WallLayerScreenState {
  if (input.isViewerRole) {
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

  return input.counter.reviewed === input.counter.total ? 'success' : 'partial';
}

/* -------------------------------------------------------------------------- */
/* Hook.                                                                       */
/* -------------------------------------------------------------------------- */

/** Cổng thật dựng đúng một lần cho suốt đời component. */
function useResolvedGateway(injected: WallLayerReviewGateway | undefined): WallLayerReviewGateway {
  const fallbackRef = useRef<WallLayerReviewGateway | null>(null);

  if (injected !== undefined) {
    return injected;
  }

  fallbackRef.current ??= createWallLayerReviewGateway();

  return fallbackRef.current;
}

export function useWallLayerReview(
  options: UseWallLayerReviewOptions,
): UseWallLayerReviewResult {
  const { floorId, projectId } = options;
  const gateway = useResolvedGateway(options.gateway);
  /* N4-07: đơn vị chiều dài của dự án (Cài đặt › Đơn vị đo) cho chiều dài, chiều cao và nhãn đo. */
  const { lengthUnit } = useProjectUnits(projectId);
  const lengthUnitRef = useRef(lengthUnit);
  lengthUnitRef.current = lengthUnit;
  const queryClient = useQueryClient();

  /* ---------------------------------------------------------------------- */
  /* Vai trò — trạng thái 6 vô hiệu MỌI hàm sửa, ở tầng hook.                */
  /* ---------------------------------------------------------------------- */

  const roles = options.roles ?? [];
  const canEdit = can('edit', 'layer', { roles });
  const isViewerRole = !canEdit;

  /* ---------------------------------------------------------------------- */
  /* Trạng thái của riêng giao diện.                                         */
  /* ---------------------------------------------------------------------- */

  const [filters, setFilters] = useState<WallLayerFilters>(NO_FILTERS);
  const [ownCollapsed, setOwnCollapsed] = useState(false);
  const [toolState, setToolState] = useState<ToolMachineState>(() => createToolState('select'));
  /** Hàng vừa đổi (TT-02) — nháy nền rồi tự tắt; xem khối "Xoá (D-05)" bên dưới. */
  const [flashingWallId, setFlashingWallId] = useState<WallId | null>(null);
  const isCollapsed = options.forceCollapsed ?? ownCollapsed;

  const onToggleCollapsed = useCallback(() => {
    setOwnCollapsed((previous) => !previous);
  }, []);

  /*
   * Trạng thái máy công cụ đọc được từ MỌI hàm xử lý, kể cả những hàm dựng
   * trước nó trong file — hai ref này đứng ngay cạnh `useState` vì `onSelect`
   * (dựng sớm hơn nhiều) phải hỏi máy công cụ đang chờ bước gì.
   */
  const toolStateRef = useRef(toolState);
  toolStateRef.current = toolState;
  const sendToolInputRef = useRef<((value: ToolInputValue) => void) | null>(null);
  const resumeWallDrawRef = useRef<((at: Point | null, snap: WallDrawSnap | null) => void) | null>(null);

  /* ---------------------------------------------------------------------- */
  /* Hai lượt đọc máy chủ, TÁCH BẠCH (R-64).                                  */
  /* ---------------------------------------------------------------------- */

  /*
   * Ảnh nền và lớp tường là HAI lượt đọc, dưới hai khoá khác nhau, và trạng
   * thái 4 của A11 chỉ nghe lượt thứ hai. Bản trước gộp chúng làm một
   * (`hasError = backgroundQuery.isError`), nên "ảnh nền hỏng" bị đọc thành
   * "lớp tường hỏng" VÀ canvas mất luôn ảnh gốc — đúng hai điều
   * `wallLayerReviewScenarios.ts` gọi là không được phép.
   */

  const backgroundQuery = useQuery({
    queryKey: queryKeys.drawing.byFloor(floorId),
    queryFn: ({ signal }) => gateway.readBackground({ floorId, projectId, signal }),
  });

  /* N16 của tầng — `useFloorLayer` quyết định nó vào kho thế nào (F-04x-2). */
  const floorLayer = useFloorLayer({ floorId, projectId, read: gateway.readLayer });
  const provisionalScaleNotice = useProvisionalScaleNotice(
    floorLayer.scaleStatus,
    projectId,
    floorId,
    options.onNavigate,
    canEdit,
  );
  const readFailure = useFloorLayerReadFailure(floorLayer, projectId, options.onNavigate);
  /* Tầng chưa có tỷ lệ đúng: bản vẽ và danh sách vẫn xem được, mọi lệnh sửa/duyệt bị từ chối ở `run`. */
  const scaleLock = useScaleLock(projectId, floorId);
  const isScaleLocked = scaleLock.locked;
  const { onNavigate } = options;
  const scaleLockView = useMemo(
    () =>
      scaleLock.reason === null || !canEdit
        ? null
        : { reason: scaleLock.reason, onOpenScale: () => onNavigate?.(ROUTES.project.scale(projectId, floorId)) },
    [canEdit, floorId, onNavigate, projectId, scaleLock.reason],
  );

  /*
   * Lần đọc ảnh nền THÀNH CÔNG gần nhất, giữ lại qua mọi lượt hỏng sau đó.
   *
   * `backgroundQuery.data` là `undefined` ngay khi lượt đọc hỏng, nên canvas
   * rơi về ô xám và kỹ sư mất ảnh gốc đúng lúc cần nó nhất để đối chiếu. Một
   * ref là đủ và trung thực: nó không bịa ra ảnh nào, chỉ không quên ảnh vừa
   * xem được.
   */
  const lastBackgroundRef = useRef<WallLayerBackground | null>(null);

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
  const hoveredId = useStore((state) => state.hoveredId);
  const setSelection = useStore((state) => state.setSelection);
  const setHovered = useStore((state) => state.setHovered);

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

  const level = useMemo(() => levelOf(graph, options.levelId), [graph, options.levelId]);
  const levelId = level?.id ?? null;
  /* P03: lỗi quy chuẩn của lớp tường trên tầng này; mở từ nút "Sửa" thì có sẵn lỗi đang chỉ. */
  const ruleIssues = useLayerRuleIssues({ projectId, levelId, layer: 'walls' });
  const walls = useMemo(() => wallsOfLevel(graph, levelId), [graph, levelId]);
  /*
   * Nhãn tường tính trên mọi tường của tầng, nên không trùng dù mã BE hay mã A14 — và GIỮ
   * nhãn đã hiện trong phiên (BUG-592): xoá #W-005 không làm #W-006 thành #W-005.
   */
  const shownWallCodesRef = useRef<{ readonly levelId: string | null; codes: ReadonlyMap<string, string> }>({
    levelId: null,
    codes: new Map(),
  });
  const wallCodes = useMemo(() => {
    const shown = shownWallCodesRef.current;
    /* U07: tải lại trang thì đọc lại nhãn đã hiện của tầng này, không đánh số lại. */
    const previous = shown.levelId === levelId ? shown.codes : readWallCodeMemory(projectId, levelId);
    const codes = keepDisplayCodes(previous, displayCodesOf(walls.map((wall) => wall.id)));

    shownWallCodesRef.current = { levelId, codes };
    writeWallCodeMemory(projectId, levelId, codes);

    return codes;
  }, [levelId, projectId, walls]);

  /* Ngưỡng của dự án, không hằng 0,70 (BUG-354, như FIX-1603). */
  const confidenceThreshold = useProjectConfidenceThreshold(projectId, gateway.readConfidenceThreshold);
  /*
   * Danh sách đã lọc, xếp theo mã hiển thị (BUG-592). Đây cũng là thứ tự J/K và tự chuyển sau
   * "Duyệt"/"Bỏ qua" đi theo, nên tự chuyển không nhảy ra khỏi bộ lọc đang bật (BUG-581).
   */
  /* G4a-21: lọc theo độ dày từ chú giải — áp cho cả danh sách lẫn bản vẽ. */
  const [thicknessFilter, setThicknessFilter] = useState<SpatialWallThickness | null>(null);
  const thicknessFilteredWalls = useMemo(
    () => (thicknessFilter === null ? walls : walls.filter((wall) => wallThicknessColorGroupOf(wall.thicknessMm) === thicknessFilter)),
    [thicknessFilter, walls],
  );
  /* "Máy chưa chắc" gồm cả tường sai hình (cắt chéo, không nối, vụn) — cùng luật màn Quy chuẩn (K21). */
  const suspectIds = useMemo(() => geometrySuspectIdsOf(graph, levelId), [graph, levelId]);
  /* Bố cục L23: hàng đợi chia theo lý do máy nghi (hình trước, rồi dưới ngưỡng tin cậy). */
  const geometryReasons = useMemo(() => geometryReasonsOf(graph, levelId), [graph, levelId]);
  const reasonOf = useMemo(
    () =>
      (wall: Wall): WallReviewReason | null =>
        geometryReasons.get(wall.id) ?? (wall.confidence < confidenceThreshold ? 'uncertain' : null),
    [confidenceThreshold, geometryReasons],
  );
  const visibleWalls = useMemo(
    /* MỘT hàng đợi (Z/S-15): không chuẩn trước, đã duyệt cuối — danh sách, J/K và tự chuyển cùng thứ tự. */
    () =>
      sortByReviewQueue(
        sortByDisplayCode(applyWallFilters(thicknessFilteredWalls, filters, confidenceThreshold, suspectIds), wallCodes),
        confidenceThreshold,
        suspectIds,
        reasonOf,
      ),
    [confidenceThreshold, filters, reasonOf, suspectIds, wallCodes, thicknessFilteredWalls],
  );

  /* ---------------------------------------------------------------------- */
  /* Cổng ghi — `dispatch` chạy qua `commit`, hoàn tác 100 bước của S-06.     */
  /* ---------------------------------------------------------------------- */

  const storePort = useMemo<WallLayerGraphPort>(
    () => ({ read: () => useStore.getState().spatial }),
    [],
  );

  const { autosave, saveBlock } = useFloorLayerAutosave({
    projectId,
    floorId,
    ...(gateway.apiClient === undefined ? {} : { apiClient: gateway.apiClient }),
  });
  // Khối lưu đang chặn thì lời đọc cho trình đọc màn hình cũng nói "Chưa lưu…", không hứa tự lưu lại (U14).
  const saveIndicator = useSaveIndicator(autosave, { failedLabel: saveBlock !== null ? SAVE_BLOCKED_LABEL : null });

  const selectionSnapshotRef = useRef<readonly EntityId[]>(selectedIds);
  selectionSnapshotRef.current = selectedIds;

  const dispatchBundle = useMemo(
    () =>
      createWallLayerDispatchDeps({
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
    () => (graph === null || levelId === null ? null : { spatial: graph, activeLevelId: levelId, layers: {} }),
    [graph, levelId],
  );

  const selectedWallId = useMemo<WallId | null>(() => {
    const last = selectedIds[selectedIds.length - 1];

    return last !== undefined && walls.some((wall) => wall.id === last) ? (last as WallId) : null;
  }, [selectedIds, walls]);

  const pushSelection = useCallback(
    (next: readonly EntityId[]) => {
      setSelection([...next]);
      /* S-11: một lượt đẩy cho cả canvas và danh sách, gộp trong một khung hình. */
      channel.push([...next]);
    },
    [channel, setSelection],
  );

  const onSelect = useCallback(
    (wallId: WallId | null) => {
      if (wallId === null) {
        pushSelection([]);

        return;
      }

      /*
       * Công cụ tách đoạn hỏi TƯỜNG trước, rồi mới hỏi điểm cắt
       * (`SPLIT_WALL_TOOL.steps`), nên một lượt bấm vào tường lúc nó đang chờ
       * bước `entity` là câu trả lời cho máy công cụ, không chỉ là một lượt
       * chọn. Chỉ `splitWall` đi đường này: `select` cũng có bước `entity`,
       * nhưng kết quả của nó là một `selection` quay ngược lại đúng hàm này.
       */
      const toolNow = toolStateRef.current;

      if (
        toolNow.tool === 'splitWall' &&
        TOOLS[toolNow.tool].steps[toolNow.values.length]?.kind === 'entity'
      ) {
        sendToolInputRef.current?.({ kind: 'entity', id: wallId });
      }

      /* Vẽ/đo/tách: bấm lên tường là một ĐIỂM (onCanvasPoint), không chọn — chọn kéo khung nhìn tới tường đó (~248 %), lần bấm sau lệch. */
      if (toolNow.tool === 'drawWall' || toolNow.tool === 'measure' || toolNow.tool === 'splitWall') {
        return;
      }

      const context = selectionContext;
      const next =
        context === null ? [wallId] : selectSingle(selectionSnapshotRef.current, wallId, context);

      pushSelection(next);
    },
    [pushSelection, selectionContext],
  );

  /**
   * Ctrl/Cmd-bấm: thêm hoặc bớt một tường khỏi vùng chọn (S-10).
   *
   * `selectSingle` luôn thay CẢ vùng chọn bằng đúng một mã, nên trước lượt sửa
   * này không có cách nào chọn được hai tường — và nút "nối đoạn", vốn bật theo
   * `selectedWallIds.length === 2`, là một nút chết vĩnh viễn. `toggleSelection`
   * của `src/lib/selection/selectionOps.ts` đã có sẵn đúng phép cần dùng.
   */
  const onToggleSelect = useCallback(
    (wallId: WallId) => {
      const context = selectionContext;

      if (context === null) {
        return;
      }

      pushSelection(toggleSelection(selectionSnapshotRef.current, wallId, context));
    },
    [pushSelection, selectionContext],
  );

  const onHover = useCallback(
    (wallId: WallId | null) => {
      setHovered(wallId);
    },
    [setHovered],
  );

  /* Ai còn phải cuộn để thấy tường vừa chọn — `planReveals` quyết, không phải màn. */
  useEffect(() => {
    if (selectedIds.length === 0) {
      return;
    }

    const anchor = revealAnchor(selectedIds);

    if (anchor === null) {
      return;
    }

    channel.reportVisible('list', selectedIds);
    planReveals(selectedIds, describeSelection(selectedIds), { list: selectedIds });
  }, [channel, selectedIds]);

  /* ---------------------------------------------------------------------- */
  /* Lệnh — mọi hàm sửa đi qua đây, và tắt hẳn ở vai Người xem.               */
  /* ---------------------------------------------------------------------- */

  const wallById = useCallback(
    (wallId: WallId): Wall | null => walls.find((wall) => wall.id === wallId) ?? null,
    [walls],
  );

  const invalidate = useCallback(() => {
    applyInvalidation(queryClient, 'editWall', { floorId, projectId });
  }, [floorId, projectId, queryClient]);

  /** Thao tác sửa bị khoá vì thiếu tỷ lệ: báo một lần bằng câu khoá chung, kèm hướng sang bước Tỷ lệ. */
  const notifyScaleLocked = useCallback(() => {
    if (!canEdit || scaleLock.reason === null) {
      return;
    }

    (options.notifications ?? appNotificationBus).publish({
      type: WALL_SCALE_LOCKED_NOTIFICATION_TYPE,
      title: scaleLock.reason,
      description: 'Bấm "Đặt tỷ lệ" ở cột trái để sang bước Tỷ lệ.',
    });
  }, [canEdit, options.notifications, scaleLock.reason]);

  const run = useCallback(
    async (
      build: (
        context: ReturnType<typeof commandContextOf>,
      ) => ReturnType<typeof buildApproveWallCommand> | readonly ReturnType<typeof buildApproveWallCommand>[] | null,
    ) => {
      const current = useStore.getState().spatial;

      if (isScaleLocked) {
        notifyScaleLocked();
        return false;
      }

      if (!canEdit || current === null) {
        return false;
      }

      const command = build(commandContextOf(current, gateway.actorId));

      if (command === null) {
        return false;
      }

      /* Một lô (vẽ + cắt chữ T) đi chung một bước hoàn tác. */
      const result = isCommandList(command)
        ? await runWallCommands(command, dispatchBundle, command[command.length - 1]?.description ?? '')
        : await runWallCommand(command, dispatchBundle);

      if (result.ok) {
        invalidate();
      }

      return result.ok;
    },
    [canEdit, dispatchBundle, gateway, invalidate, isScaleLocked, notifyScaleLocked],
  );

  /* UX-41: một lượt duyệt đang lưu thì bỏ qua lần bấm kế — bấm đúp khi mạng chậm không duyệt luôn đoạn sau. */
  const approvePendingRef = useRef(false);
  const onApprove = useCallback(
    (wallId: WallId) => {
      const wall = wallById(wallId);

      /* Khoá tỷ lệ: không duyệt, và cũng không tự nhảy sang tường kế như thể đã duyệt. */
      if (wall === null || wall.reviewed || approvePendingRef.current) {
        return;
      }

      if (isScaleLocked) {
        notifyScaleLocked();
        return;
      }

      /* Tự chuyển mục: tìm tường chưa duyệt kế tiếp TRƯỚC khi tường này đổi cờ. */
      const nextId = nextUnreviewedWallId(visibleWalls, wallId);

      approvePendingRef.current = true;
      void run(() => buildApproveWallCommand(wall, gateway.actorId, wallCodes))
        .then(() => {
          if (nextId !== null && nextId !== wallId) {
            onSelect(nextId);
          }
        })
        .finally(() => {
          approvePendingRef.current = false;
        });
    },
    [gateway, isScaleLocked, notifyScaleLocked, onSelect, run, visibleWalls, wallById, wallCodes],
  );

  const onUnapprove = useCallback(
    (wallId: WallId) => {
      const wall = wallById(wallId);

      if (wall === null || !wall.reviewed) {
        return;
      }

      void run(() => buildUnapproveWallCommand(wall, gateway.actorId, wallCodes));
    },
    [gateway, run, wallById, wallCodes],
  );

  /* Vật liệu: tường kính hay tường thường, hoàn tác được như mọi lệnh. */
  const onChangeMaterial = useCallback(
    (wallId: WallId, isGlass: boolean) => {
      const wall = wallById(wallId);

      if (wall !== null) {
        void run(() => buildChangeWallMaterialCommand(wall, isGlass, gateway.actorId, wallCodes));
      }
    },
    [gateway, run, wallById, wallCodes],
  );

  /* G74: hàng danh sách xin mở menu bằng phím — chọn tường, canvas mở menu của nó. */
  const [menuRequest, setMenuRequest] = useState<{ readonly wallId: WallId; readonly seq: number } | null>(null);
  const onOpenRowMenu = useCallback(
    (wallId: WallId) => {
      if (isViewerRole) {
        return;
      }

      onSelect(wallId);
      setMenuRequest((previous) => ({ wallId, seq: (previous?.seq ?? 0) + 1 }));
    },
    [isViewerRole, onSelect],
  );

  const onSkip = useCallback(
    (wallId: WallId) => {
      const nextId = nextUnreviewedWallId(visibleWalls, wallId);

      if (nextId !== null && nextId !== wallId) {
        onSelect(nextId);
      }
    },
    [onSelect, visibleWalls],
  );

  /* Thiếu tỷ lệ (hoặc trung vị < 50 mm): đổi độ dày lúc này chỉ che lỗi — khoá ô chọn, phím C, nút một đoạn và hàng loạt (K09). */
  const thicknessLockText = useMemo(
    () => thicknessLockTextOf(walls.map((wall) => wall.thicknessMm), floorLayer.scaleSource),
    [floorLayer.scaleSource, walls],
  );

  const onChangeThickness = useCallback(
    (wallId: WallId, thicknessMm: number) => {
      if (isScaleLocked) {
        notifyScaleLocked();
        return;
      }

      if (thicknessLockText !== null) {
        return;
      }

      void run((context) => {
        const result = buildChangeThicknessCommand({ wallId, thicknessMm }, context);

        return result.ok ? result.data : null;
      }).then(() => {
        /* TT-02: đổi độ dày là lượt nháy nền chính, không phải một ngoại lệ. */
        setFlashingWallId(wallId);
      });
    },
    [isScaleLocked, notifyScaleLocked, run, thicknessLockText],
  );

  /** P03: ô "Chiều dài" — giữ đầu tường, dời đầu cuối dọc hướng tường qua lệnh kéo đỉnh (hoàn tác được). */
  const onChangeLength = useCallback(
    (wallId: WallId, lengthMm: number) => {
      if (isScaleLocked) {
        notifyScaleLocked();
        return;
      }

      const wall = wallById(wallId);

      if (thicknessLockText !== null || wall === null || !(lengthMm > 0)) {
        return;
      }

      const { start, end } = wall.centreline;
      const current = Math.hypot(end.x - start.x, end.y - start.y);

      if (current === 0) {
        return;
      }

      const ratio = lengthMm / current;
      const to = {
        x: millimetres(start.x + (end.x - start.x) * ratio),
        y: millimetres(start.y + (end.y - start.y) * ratio),
      };

      void run((context) => {
        const result = buildDragWallEndCommand({ wallId, end: 'end', to }, context);

        return result.ok ? result.data : null;
      }).then((ok) => {
        if (ok) {
          setFlashingWallId(wallId);
        }
      });
    },
    [isScaleLocked, notifyScaleLocked, run, thicknessLockText, wallById],
  );

  const onSplit = useCallback(
    (wallId: WallId, at: Point) => {
      const secondWallId = gateway.nextWallId();

      void run((context) => {
        const result = buildSplitWallCommand({ wallId, at, secondWallId }, context);

        return result.ok ? result.data : null;
      });
    },
    [gateway, run],
  );

  const notifications = options.notifications ?? appNotificationBus;

  const onMerge = useCallback(
    (wallId: WallId, otherWallId: WallId) => {
      void run((context) => {
        const result = buildMergeWallsCommand({ wallId, otherWallId }, context);

        if (!result.ok) {
          notifications.publish({
            type: WALL_MERGE_REFUSED_NOTIFICATION_TYPE,
            title: WALL_MERGE_REFUSED_TEXT,
            description: '',
          });
        }

        return result.ok ? result.data : null;
      });
    },
    [notifications, run],
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
    setSelection(transition.selection.selectedIds);
    autosave.notifyChange();
    invalidate();
  }, [autosave, canEdit, dispatchBundle, invalidate, setSelection]);

  const onUndo = useCallback(() => {
    /* Hoàn tác trong chuỗi vẽ: điểm đầu đang giữ là đầu tường sắp bị gỡ, nên bỏ cùng lúc. */
    if (toolStateRef.current.tool === 'drawWall') {
      resumeWallDrawRef.current?.(null, null);
    }

    applyUndo();
  }, [applyUndo]);

  /* ---------------------------------------------------------------------- */
  /* Xoá (D-05) — tức thì, không hộp thoại, kèm vé hoàn tác 15 s (U35).      */
  /* ---------------------------------------------------------------------- */

  const undoTicketRef = useRef<ReturnType<typeof createWallUndoTicket> | null>(null);
  /* Hàng danh sách (gán ở dưới, sau khi `rows` dựng xong) — cho J/K và số thứ tự trong toast xoá. */
  const rowsRef = useRef<readonly WallRowViewModel[]>([]);

  /*
   * Nháy nền một hàng — bật ở đây, và TỰ TẮT.
   *
   * Bản trước bật cờ đúng một chỗ (lượt hoàn tác sau khi xoá) và không có một
   * lượt gọi nào đưa nó về `null`, nên hàng đó sáng vĩnh viễn. Nay cả hai lối
   * vào của TT-02 đều bật nó — đổi độ dày và hoàn tác-sau-khi-xoá — và một hẹn
   * giờ ở nấc `'slow'` của thang chuyển động tắt nó (không một con số mili-giây
   * nào viết tay, R-71).
   */
  useEffect(() => {
    if (flashingWallId === null) {
      return undefined;
    }

    const timer = setTimeout(() => setFlashingWallId(null), durationMs('slow'));

    return () => clearTimeout(timer);
  }, [flashingWallId]);

  const onDelete = useCallback(
    (wallId: WallId) => {
      /* Đọc TRƯỚC khi xoá: cửa trên tường đi cùng lệnh (U36), số trên hình là số hàng đợi (U57). */
      const before = useStore.getState().spatial;
      const openingCount = before === null ? 0 : openingsOfWall(before, wallId).length;
      const queueIndex = rowsRef.current.filter((row) => !row.isReviewed).findIndex((row) => row.id === wallId);
      const extras = { openingCount, ...(queueIndex === -1 ? {} : { queueNumber: queueIndex + 1 }) };

      void run((context) => {
        const result = buildDeleteWallCommand({ wallId }, context);

        return result.ok ? result.data : null;
      }).then((deleted) => {
        if (!deleted) {
          return;
        }

        /* BUG-579: vé giữ đúng bước của lượt xoá này, không "bước trên cùng" lúc bấm. */
        const entryId = newestEntryId(dispatchBundle.history);
        const ticket = createWallUndoTicket({
          wallId,
          wallCodes,
          extras,
          now: gateway.now,
          undo: () => {
            /* Own-step undo: this ticket takes back ITS delete, wherever it sits on the stack. */
            const transition = entryId === null ? null : dispatchBundle.history.undoEntry(entryId);

            if (transition === null) {
              notifications.publish({
                type: WALL_UNDO_REFUSED_NOTIFICATION_TYPE,
                title: WALL_UNDO_REFUSED_TEXT,
                description: '',
              });

              return;
            }

            dispatchBundle.deps.spatial.applyPatches(transition.patches);
            autosave.notifyChange();
            invalidate();
            /* Mục quay lại thì nháy nền — cờ do hook trả ra, view lo phần hiện. */
            setFlashingWallId(wallId);
          },
        });

        undoTicketRef.current = ticket;

        /*
         * A8: mọi thay đổi hoàn tác được, KÈM TOAST hoàn tác.
         *
         * Vé đã dựng đúng từ đầu, chỉ thiếu chỗ hiện. `NotificationHost` của
         * `src/main.tsx` vẽ bus này bằng `Toast.Item`, và nút "Hoàn tác" của nó
         * gọi thẳng `undoTicket.undo()` — tức đúng vé ở trên, chạy trên ngăn xếp
         * 100 bước của S-06. Cửa sổ (15 s, U35) do chính vé mang
         * (`LONG_UNDO_WINDOW_MS`), nên không có thời lượng nào phải truyền (R-71).
         *
         * `description` để rỗng có chủ đích: `NotificationHost` ghép tiêu đề với
         * mô tả bằng " — " khi hai câu khác nhau, và ở đây chỉ có MỘT câu.
         */
        notifications.publish({
          type: WALL_DELETE_NOTIFICATION_TYPE,
          title: ticket.description,
          description: '',
          undoTicket: ticket,
        });
      });
    },
    [autosave, dispatchBundle, gateway, invalidate, notifications, run, wallCodes],
  );

  /* ---------------------------------------------------------------------- */
  /* Công cụ (S-08) — máy công cụ thật, không một bản sao thứ hai.            */
  /* ---------------------------------------------------------------------- */

  const toolContext = useMemo<ToolContext>(
    () => ({
      levelId: (levelId ?? NO_LEVEL_ID) as LevelId,
      settings: DEFAULT_TOOL_SETTINGS,
      nextId: <K extends EntityKind>(kind: K): IdByKind[K] =>
        (kind === 'wall' ? gateway.nextWallId() : createId(kind)) as IdByKind[K],
    }),
    [gateway, levelId],
  );

  const toolContextRef = useRef(toolContext);
  toolContextRef.current = toolContext;

  /* Vẽ tường bắt vào đầu/thân tường có sẵn; điểm bắt của hai lần bấm giữ tới lúc chốt lệnh. */
  const drawSnapTargets = useMemo(() => wallDrawSnapTargets(walls), [walls]);
  const drawSnapTargetsRef = useRef(drawSnapTargets);
  drawSnapTargetsRef.current = drawSnapTargets;
  const drawSnapRadiusMmRef = useRef<number>(DEFAULT_DRAW_SNAP_RADIUS_MM);
  const drawSnapsRef = useRef<{ start: WallDrawSnap | null; end: WallDrawSnap | null }>({ start: null, end: null });
  const wallsRef = useRef(walls);
  wallsRef.current = walls;
  const levelRef = useRef(level);
  levelRef.current = level;

  /** Số đo ĐÃ CHỐT của công cụ đo; `null` cho tới khi có một lượt đo thật. */
  const [committedMeasurement, setCommittedMeasurement] =
    useState<WallLayerMeasurementPx | null>(null);
  /** Lý do nét vẽ vừa rồi không thành tường; hiện ở thanh trạng thái tới lần bấm kế. */
  const [drawRefusal, setDrawRefusal] = useState<string | null>(null);
  /** Độ dày đặt bằng phím 1/2/3 lúc vẽ; thắng độ dày kế thừa, giữ suốt chuỗi tới khi rời công cụ. */
  const [drawThicknessMm, setDrawThicknessMm] = useState<number | null>(null);
  const drawThicknessRef = useRef(drawThicknessMm);
  drawThicknessRef.current = drawThicknessMm;
  /* Shift: khoá ngang/dọc. Nghe ở cửa sổ để nét xem trước đổi ngay cả khi chuột đứng yên. */
  const [shiftHeld, setShiftHeld] = useState(false);
  const shiftHeldRef = useRef(shiftHeld);
  shiftHeldRef.current = shiftHeld;
  const isDrawingWall = toolState.tool === 'drawWall';

  useEffect(() => {
    if (!isDrawingWall) {
      return undefined;
    }

    const sync = (event: KeyboardEvent) => setShiftHeld(event.shiftKey);
    const release = () => setShiftHeld(false);

    window.addEventListener('keydown', sync);
    window.addEventListener('keyup', sync);
    window.addEventListener('blur', release);

    return () => {
      window.removeEventListener('keydown', sync);
      window.removeEventListener('keyup', sync);
      window.removeEventListener('blur', release);
      release();
    };
  }, [isDrawingWall]);

  /** Đưa công cụ vẽ về trạng thái "đã có điểm đầu `at`" (nét bị từ chối, vẽ nối tiếp), hoặc về đầu khi `at` rỗng. */
  const resumeWallDraw = useCallback((at: Point | null, snap: WallDrawSnap | null) => {
    if (toolStateRef.current.tool !== 'drawWall') {
      return;
    }

    const fresh = createToolState('drawWall');
    const next =
      at === null
        ? fresh
        : reduceTool(fresh, { type: 'input', value: { kind: 'point', at } }, { tools: TOOLS, context: toolContextRef.current }).state;

    toolStateRef.current = next;
    setToolState(next);
    drawSnapsRef.current = { start: snap, end: null };
  }, []);

  resumeWallDrawRef.current = resumeWallDraw;

  /**
   * Một sự kiện của máy công cụ, và kết quả nó sinh ra.
   *
   * `reduceTool` thuần và không bao giờ ghi; kết quả `kind: 'command'` là con
   * đường DUY NHẤT từ thanh công cụ tới dữ liệu, và {@link toolOutcomeToCommand}
   * là chỗ tên lệnh thành hàm dựng lệnh thật (`wall.draw` →
   * `createDrawWallCommand`, `wall.split` → `createSplitWallCommand`). Kết quả
   * `kind: 'selection'` đi thẳng vào vùng chọn của S-10.
   */
  const runToolEvent = useCallback(
    (event: ToolEvent): ToolTransition => {
      const transition = reduceTool(toolStateRef.current, event, {
        tools: TOOLS,
        context: toolContextRef.current,
      });

      toolStateRef.current = transition.state;
      setToolState(transition.state);

      /* Đổi công cụ là bỏ cử chỉ đang dở — nhãn đo cũ đi theo nó. */
      if (event.type === 'activate' || event.type === 'cancel') {
        setCommittedMeasurement(null);
        setDrawRefusal(null);
        drawSnapsRef.current = { start: null, end: null };
      }

      if (event.type === 'activate') {
        setDrawThicknessMm(null);
      }

      const outcome = transition.outcome;

      if (outcome === null) {
        return transition;
      }

      if (outcome.kind === 'selection') {
        const last = outcome.ids[outcome.ids.length - 1];

        onSelect(last === undefined ? null : (last as WallId));

        return transition;
      }

      /*
       * Một lượt đo KHÔNG phải một lệnh: nó không đổi bản vẽ, nên
       * `toolOutcomeToCommand` trả `null` cho nó và trước lượt sửa này kết quả
       * bị bỏ im lặng — đó là toàn bộ lý do `canvas.measurement` từng là `null`
       * cứng. Nay nó vào một `useState` và đi thẳng ra `MeasurementLabel`.
       */
      if (outcome.kind === 'measurement') {
        setCommittedMeasurement(
          measurementOutcomeToPx(outcome.measurement, scaleOfLevel(levelRef.current), lengthUnitRef.current),
        );

        return transition;
      }

      /* Tường mới bắt vào tường X (điểm đầu, không thì điểm cuối) thì lấy dày/cao/loại của X. */
      const snaps = drawSnapsRef.current;
      const joinedId = snaps.start?.wallId ?? snaps.end?.wallId ?? null;
      const source = joinedId === null ? null : (wallsRef.current.find((wall) => wall.id === joinedId) ?? null);
      const styled = withInheritedWallStyle(outcome, source, drawThicknessRef.current);

      drawSnapsRef.current = { start: null, end: null };

      if (styled.kind !== 'command' || styled.request.type !== WALL_COMMAND_TYPES.draw) {
        void run((context) => toolOutcomeToCommand(styled, context));

        return transition;
      }

      /* Vẽ: phải nối vào tường có sẵn; đầu bắt vào thân tường thì cắt tường đó (chữ T) — một bước hoàn tác. */
      const drawInput = styled.request.input;
      let refusal: string | null = null;
      let roomNotices: readonly string[] = [];

      void run((context) => {
        const plan = planConnectedDraw(drawInput, snaps, context, () => toolContextRef.current.nextId('wall'));

        if (!plan.ok) {
          refusal = plan.reason;
          /* Bị từ chối: giữ điểm đầu, người dùng chỉ cần bấm lại điểm cuối. */
          resumeWallDraw(drawInput.centreline.start, snaps.start);

          return null;
        }

        /* Vẽ nối tiếp: điểm cuối thành điểm đầu nét sau; Esc dừng chuỗi. */
        resumeWallDraw(plan.end, { point: plan.end, kind: 'wallVertex', wallId: drawInput.id });
        roomNotices = plan.notices;

        return plan.commands;
      }).then((ok) => {
        if (refusal !== null) {
          setDrawRefusal(refusal);
          notifications.publish({ type: WALL_DRAW_REFUSED_NOTIFICATION_TYPE, title: WALL_DRAW_REFUSED_TITLE, description: refusal });
        } else if (!ok) {
          /* Lệnh không vào được bản vẽ (khoá tỷ lệ, lỗi ghi): đầu chuỗi không có tường để nối. */
          resumeWallDraw(null, null);
        } else {
          roomNotices.forEach((description) => notifications.publish({ type: WALL_DRAW_ROOM_NOTICE_TYPE, title: WALL_DRAW_ROOM_NOTICE_TITLE, description }));
        }
      });

      return transition;
    },
    [notifications, onSelect, resumeWallDraw, run],
  );

  /**
   * Một bước đã điền, rồi CHỐT LUÔN khi cử chỉ đã đủ bước.
   *
   * `reduceTool` dừng ở `confirming` và chỉ phát kết quả khi nhận `commit`, vì
   * có công cụ cần một bước xác nhận. Ba công cụ của màn này thì không: vẽ
   * tường là hai lần bấm, tách đoạn là chọn tường rồi bấm chỗ cắt, đo là hai
   * lần bấm — lần bấm cuối CHÍNH LÀ lời xác nhận. Nên hook chốt trong cùng
   * lượt, và không có nút "xong" nào phải dựng ra chỉ để bấm.
   */
  const sendToolInput = useCallback(
    (value: ToolInputValue) => {
      const transition = runToolEvent({ type: 'input', value });

      if (transition.state.phase === 'confirming') {
        runToolEvent({ type: 'commit' });
      }
    },
    [runToolEvent],
  );

  sendToolInputRef.current = sendToolInput;

  const activateTool = useCallback(
    (tool: ToolId) => {
      runToolEvent({ type: 'activate', tool });
    },
    [runToolEvent],
  );

  /**
   * Canvas báo một điểm vừa bấm; máy công cụ nhận nó làm bước kế tiếp (NL-06,
   * NL-10, TT-10).
   *
   * Toạ độ vào ĐÃ là pixel bản vẽ (trình duyệt đổi giúp qua ma trận của
   * `<svg>`), và `reduceTool` làm việc bằng milimét công trình, nên ở đây có
   * đúng một phép quy đổi — `toMillimetrePoint`, tức `scale.pixelsToMillimetres`
   * của `src/domain/units/scale.ts`. Không một công thức hình học nào viết mới:
   * điểm cắt, chiều dài tường mới và khoảng cách đo đều do
   * `src/lib/tools/tools.ts` và `src/domain` tính.
   */
  const onCanvasPoint = useCallback(
    (at: WallLayerPointerReading) => {
      const currentLevel = levelRef.current;

      if (currentLevel === null) {
        return;
      }

      /* Bắt đầu một cử chỉ mới thì nhãn đo cũ nhường chỗ. */
      if (toolStateRef.current.values.length === 0) {
        setCommittedMeasurement(null);
      }

      const exact = toMillimetrePoint({ x: at.xPx, y: at.yPx }, scaleOfLevel(currentLevel));

      if (toolStateRef.current.tool === 'drawWall') {
        const first = toolStateRef.current.values[0];
        const start = first?.kind === 'point' ? first.at : null;
        const snap = resolveDrawPoint(exact, start, drawSnapTargetsRef.current, drawSnapRadiusMmRef.current, shiftHeldRef.current);

        /* Bấm đúp đúng điểm đầu không phải một nét: bỏ qua, khỏi toast "tường quá ngắn". */
        if (start !== null && snap.point.x === start.x && snap.point.y === start.y) {
          return;
        }

        setDrawRefusal(null);
        drawSnapsRef.current = start === null ? { start: snap, end: null } : { ...drawSnapsRef.current, end: snap };
        sendToolInput({ kind: 'point', at: snap.point });

        return;
      }

      /* Hợp đồng ghi (`WallSchema`): toạ độ là số nguyên mm — chuột thật cho số lẻ, PUT sẽ bị chặn (QA p04 FL-16-05). */
      sendToolInput({ kind: 'point', at: { x: Math.round(exact.x), y: Math.round(exact.y) } as typeof exact });
    },
    [sendToolInput],
  );

  /** Nhấn chuột trái khi đang vẽ: chưa có điểm đầu thì lượt nhấn này là điểm đầu (kéo-để-vẽ). */
  const onWallDrawPress = useCallback(
    (at: WallLayerPointerReading) => {
      if (toolStateRef.current.values.length > 0) {
        return false;
      }

      onCanvasPoint(at);

      return true;
    },
    [onCanvasPoint],
  );

  /* ---------------------------------------------------------------------- */
  /* Danh sách, thanh tra, hình canvas.                                       */
  /* ---------------------------------------------------------------------- */

  /* Trạng thái 4 nghe LỚP TƯỜNG, không nghe ảnh nền — xem khối hai lượt đọc trên. */
  const hasError = floorLayer.error !== null;
  const isLoading = backgroundQuery.isPending || floorLayer.isPending || graph === null;

  const counter = useMemo<WallReviewCounter>(
    () => ({
      reviewed: walls.filter((wall) => wall.reviewed).length,
      total: walls.length,
    }),
    [walls],
  );

  const rows = useMemo<readonly WallRowViewModel[]>(
    () =>
      hasError ? NO_ROWS : visibleWalls.map((wall) => toWallRow(wall, wallCodes, confidenceThreshold, suspectIds)),
    [confidenceThreshold, hasError, suspectIds, visibleWalls, wallCodes],
  );

  const shapes = useMemo<readonly WallLayerCanvasShape[]>(
    () =>
      level === null
        ? []
        : toCanvasShapes(thicknessFilteredWalls, level, wallStatusCode, wallCodes, confidenceThreshold, suspectIds),
    [confidenceThreshold, level, suspectIds, thicknessFilteredWalls, wallCodes],
  );

  const inspector = useMemo(() => {
    if (selectedWallId === null || level === null) {
      return null;
    }

    const wall = wallById(selectedWallId);

    if (wall === null) {
      return null;
    }

    const lengthMm = Math.hypot(wall.centreline.end.x - wall.centreline.start.x, wall.centreline.end.y - wall.centreline.start.y);
    /* P03: tường thẳng đã có tỷ lệ thì sửa được chiều dài; tường cong giữ chỉ đọc. */
    const lengthEdit =
      wall.curveOffsetMm !== undefined && wall.curveOffsetMm !== 0
        ? null
        : wallLengthNumberOf(lengthMm, floorLayer.scaleStatus, floorLayer.scaleSource) === null
          ? null
          : lengthUnit === 'mm'
            ? { valueText: String(Math.round(lengthMm)), unit: 'mm' as const }
            : { valueText: formatNumber(millimetresToMetres(millimetres(lengthMm)), { fractionDigits: 2 }), unit: 'm' as const };

    return {
      ...toWallInspector(wall, level, wallCodes, floorLayer.scaleStatus, lengthUnit, floorLayer.scaleSource, confidenceThreshold, suspectIds, floorLayer.scaleState),
      lengthEdit,
    };
  }, [confidenceThreshold, floorLayer.scaleSource, floorLayer.scaleState, floorLayer.scaleStatus, lengthUnit, level, selectedWallId, suspectIds, wallById, wallCodes]);

  /* Bộ đếm chạy 12 → 13 ở nấc `standard` (260 ms) — xem ghi chú đầu file. */
  /* Nhãn đọc-màn-hình lấy số THẬT, không phải số đang đếm lên (G69) — đếm lên chỉ là hiệu ứng. */
  const progressLabel = reviewProgressLabel(formatNumber(counter.reviewed, { fractionDigits: 0 }), counter.total);

  const state = deriveScreenState({ isViewerRole, isCollapsed, hasError, isLoading, counter });

  const errorMessage = hasError ? floorLayer.errorMessage : null;

  /* ---------------------------------------------------------------------- */
  /* Phím tắt (I-01) — không một `addEventListener` nào ở đây (R-72).         */
  /* ---------------------------------------------------------------------- */

  const shortcutOptions = useMemo(
    () => (options.registry === undefined ? {} : { registry: options.registry }),
    [options.registry],
  );

  rowsRef.current = rows;
  const selectedRef = useRef(selectedWallId);
  selectedRef.current = selectedWallId;

  const step = useCallback(
    (direction: 1 | -1) => {
      const target = neighbourWallId(rowsRef.current, selectedRef.current, direction);

      if (target !== null) {
        onSelect(target);
      }
    },
    [onSelect],
  );

  useShortcut(
    {
      id: 'wallLayerReview.next',
      combo: 'J',
      scope: 'canvas',
      description: WALL_LAYER_TEXT.shortcutNext,
      onTrigger: () => step(1),
    },
    shortcutOptions,
  );
  useShortcut(
    {
      id: 'wallLayerReview.previous',
      combo: 'K',
      scope: 'canvas',
      description: WALL_LAYER_TEXT.shortcutPrevious,
      onTrigger: () => step(-1),
    },
    shortcutOptions,
  );
  /* Impeccable A3: mũi tên lên/xuống đổi dòng chọn như J/K — danh sách tự cuộn và kéo tiêu điểm theo. */
  useShortcut(
    {
      id: 'wallLayerReview.arrowNext',
      combo: 'ArrowDown',
      scope: 'canvas',
      description: WALL_LAYER_TEXT.shortcutArrowNext,
      allowRepeat: true,
      preventDefault: false,
      onTrigger: arrowStepHandler(() => step(1)),
    },
    shortcutOptions,
  );
  useShortcut(
    {
      id: 'wallLayerReview.arrowPrevious',
      combo: 'ArrowUp',
      scope: 'canvas',
      description: WALL_LAYER_TEXT.shortcutArrowPrevious,
      allowRepeat: true,
      preventDefault: false,
      onTrigger: arrowStepHandler(() => step(-1)),
    },
    shortcutOptions,
  );
  /* "Duyệt và sang mục kế": `onApprove` đã tự chọn tường chưa duyệt kế tiếp. */
  const approveRef = useRef(onApprove);
  approveRef.current = onApprove;
  const visibleWallsRef = useRef(visibleWalls);
  visibleWallsRef.current = visibleWalls;
  useShortcut(
    {
      id: 'wallLayerReview.approveNext',
      combo: 'A',
      scope: 'canvas',
      description: WALL_LAYER_TEXT.shortcutApproveNext,
      onTrigger: () => {
        if (selectedRef.current !== null) {
          approveRef.current(selectedRef.current);
          return;
        }

        /* U31: chưa chọn đoạn nào thì A chọn đoạn đầu hàng đợi — nhấn A lần nữa để duyệt. */
        const first = visibleWallsRef.current.find((wall) => !wall.reviewed);

        if (first !== undefined) {
          onSelect(first.id);
        }
      },
    },
    { ...shortcutOptions, enabled: canEdit },
  );
  useShortcut(
    {
      id: 'wallLayerReview.delete',
      combo: 'Backspace',
      scope: 'canvas',
      description: WALL_LAYER_TEXT.shortcutDelete,
      onTrigger: () => {
        if (selectedRef.current !== null) {
          onDelete(selectedRef.current);
        }
      },
    },
    { ...shortcutOptions, enabled: canEdit },
  );
  /* G4a-09: phím Delete xoá như Backspace (cùng vé hoàn tác + toast A8). */
  useShortcut(
    {
      id: 'wallLayerReview.deleteKey',
      combo: 'Delete',
      scope: 'canvas',
      description: WALL_LAYER_TEXT.shortcutDelete,
      onTrigger: () => {
        if (selectedRef.current !== null) {
          onDelete(selectedRef.current);
        }
      },
    },
    { ...shortcutOptions, enabled: canEdit },
  );
  useShortcut(
    {
      id: 'wallLayerReview.undo',
      combo: 'Mod+Z',
      scope: 'canvas',
      description: WALL_LAYER_TEXT.shortcutUndo,
      onTrigger: onUndo,
    },
    { ...shortcutOptions, enabled: canEdit },
  );

  /*
   * `Escape` (A12, B-V6-11): bỏ cử chỉ đang vẽ dở trước, rồi mới bỏ chọn — cùng
   * thứ tự `objectLayerReview.closeTopLayer`. Chỉ bật khi có thứ để bỏ: một binding
   * thường trực ở phạm vi `canvas` sẽ nuốt `global.closeTopLayer`.
   */
  const committedMeasurementRef = useRef(committedMeasurement);
  committedMeasurementRef.current = committedMeasurement;
  const isComparing = useQcCompare();
  const gestureInFlight =
    toolState.values.length > 0 || toolState.pending !== null || committedMeasurement !== null;

  useShortcut(
    {
      id: 'wallLayerReview.closeTopLayer',
      combo: 'Escape',
      scope: 'canvas',
      description: 'Bỏ nét đang vẽ, rời công cụ về Chọn, hoặc bỏ chọn tường',
      onTrigger: () => {
        const current = toolStateRef.current;

        /* A committed measurement label is also a thing to drop: `cancel` clears it. */
        if (
          current.values.length > 0 ||
          current.pending !== null ||
          committedMeasurementRef.current !== null
        ) {
          runToolEvent({ type: 'cancel' });

          return;
        }

        /* Không còn nét dở mà vẫn đang ở Vẽ/Tách/Đo: Esc lần nữa về Chọn (V). */
        if (current.tool !== 'select') {
          activateTool('select');

          return;
        }

        /* Hết thứ để bỏ chọn mà đang "So sánh hai bên": Esc lần cuối thoát so sánh. */
        if (selectedRef.current === null && isQcCompare()) {
          setQcCompare(false);

          return;
        }

        onSelect(null);
      },
    },
    { ...shortcutOptions, enabled: gestureInFlight || toolState.tool !== 'select' || selectedWallId !== null || isComparing },
  );

  const thicknessRef = useRef(onChangeThickness);
  thicknessRef.current = onChangeThickness;

  const setThickness = useCallback((choice: WallThicknessChoice) => {
    /* Đang vẽ: phím đặt độ dày cho nét, không đổi tường đang chọn. */
    if (toolStateRef.current.tool === 'drawWall') {
      setDrawThicknessMm(choice);

      return;
    }

    if (selectedRef.current !== null) {
      thicknessRef.current(selectedRef.current, choice);
    }
  }, []);

  useShortcut(
    {
      id: 'wallLayerReview.thickness.1',
      combo: '1',
      scope: 'canvas',
      description: WALL_LAYER_TEXT.shortcutThickness(WALL_LAYER_THICKNESS_CHOICES[0] as WallThicknessChoice),
      onTrigger: () => setThickness(WALL_LAYER_THICKNESS_CHOICES[0] as WallThicknessChoice),
    },
    { ...shortcutOptions, enabled: canEdit },
  );
  useShortcut(
    {
      id: 'wallLayerReview.thickness.2',
      combo: '2',
      scope: 'canvas',
      description: WALL_LAYER_TEXT.shortcutThickness(WALL_LAYER_THICKNESS_CHOICES[1] as WallThicknessChoice),
      onTrigger: () => setThickness(WALL_LAYER_THICKNESS_CHOICES[1] as WallThicknessChoice),
    },
    { ...shortcutOptions, enabled: canEdit },
  );
  useShortcut(
    {
      id: 'wallLayerReview.thickness.3',
      combo: '3',
      scope: 'canvas',
      description: WALL_LAYER_TEXT.shortcutThickness(WALL_LAYER_THICKNESS_CHOICES[2] as WallThicknessChoice),
      onTrigger: () => setThickness(WALL_LAYER_THICKNESS_CHOICES[2] as WallThicknessChoice),
    },
    { ...shortcutOptions, enabled: canEdit },
  );

  useShortcut(
    {
      id: 'wallLayerReview.tool.select',
      combo: shortcutForTool('select'),
      scope: 'canvas',
      description: WALL_LAYER_TEXT.shortcutToolSelect,
      onTrigger: () => activateTool('select'),
    },
    shortcutOptions,
  );
  useShortcut(
    {
      id: 'wallLayerReview.tool.drawWall',
      combo: shortcutForTool('drawWall'),
      scope: 'canvas',
      description: WALL_LAYER_TEXT.shortcutTool,
      onTrigger: () => activateTool('drawWall'),
    },
    { ...shortcutOptions, enabled: canEdit },
  );
  useShortcut(
    {
      id: 'wallLayerReview.tool.measure',
      combo: shortcutForTool('measure'),
      scope: 'canvas',
      description: WALL_LAYER_TEXT.shortcutToolMeasure,
      onTrigger: () => activateTool('measure'),
    },
    /* Canvas người xem không nhận lượt bấm — công cụ đo không đo được gì (BUG-601). */
    { ...shortcutOptions, enabled: canEdit },
  );
  const onRequestSplitRef = useRef<(wallId: WallId) => void>(() => undefined);
  /* BUG-604: "Tách đoạn" có phím X như `TOOL_SHORTCUTS`; có tường đang chọn thì điền luôn bước đầu. */
  useShortcut(
    {
      id: 'wallLayerReview.tool.splitWall',
      combo: shortcutForTool('splitWall'),
      scope: 'canvas',
      description: WALL_LAYER_TEXT.shortcutToolSplit,
      onTrigger: () => {
        if (selectedRef.current === null) {
          activateTool('splitWall');
        } else {
          onRequestSplitRef.current(selectedRef.current);
        }
      },
    },
    { ...shortcutOptions, enabled: canEdit },
  );

  /* ---------------------------------------------------------------------- */
  /* Ray công cụ và thanh trạng thái.                                        */
  /* ---------------------------------------------------------------------- */

  const selectedWallIds = useMemo(
    () => selectedIds.flatMap((id) => walls.find((wall) => wall.id === id)?.id ?? []),
    [selectedIds, walls],
  );
  const mergePair = selectedWallIds.length === 2 ? selectedWallIds : null;

  const onSelectTool = useCallback(
    (tool: WallLayerToolId) => {
      activateTool(tool);
    },
    [activateTool],
  );

  const onMergeSelection = useCallback(() => {
    if (mergePair !== null) {
      onMerge(mergePair[0] as WallId, mergePair[1] as WallId);
    }
  }, [mergePair, onMerge]);

  /**
   * Ray công cụ, đúng hợp đồng điều phối viên chốt.
   *
   * `canMerge` là "đã chọn >= 2 tường" CỘNG quyền sửa: ở vai Người xem nút phải
   * tắt dù có chọn đủ hai đoạn, vì mọi hàm sửa đã bị vô hiệu ở tầng hook. A2 —
   * một nút bấm được mà không có tác dụng là thứ A2 tồn tại để chặn.
   */
  const toolRail = useMemo<WallLayerToolRailProps>(
    () => ({
      activeTool: railToolOf(toolState.tool),
      onSelectTool,
      canMerge: canEdit && mergePair !== null,
      onMerge: onMergeSelection,
      readOnly: isViewerRole,
      isCollapsed,
      onToggleCollapsed,
    }),
    [
      canEdit,
      isCollapsed,
      isViewerRole,
      mergePair,
      onMergeSelection,
      onSelectTool,
      onToggleCollapsed,
      toolState.tool,
    ],
  );

  /* P03: nút "Sửa" xin bật "Vẽ tường" (phòng hở) — bật một lần khi lớp đã tải và được sửa. */
  const initialToolDoneRef = useRef(false);
  useEffect(() => {
    if (initialToolDoneRef.current || ruleIssues.initialTool !== 'wall' || isLoading || !canEdit || isScaleLocked) {
      return;
    }

    initialToolDoneRef.current = true;
    onSelectTool('drawWall');
  }, [canEdit, isLoading, isScaleLocked, onSelectTool, ruleIssues.initialTool]);

  /* ---------------------------------------------------------------------- */
  /* Giá trị ra.                                                             */
  /* ---------------------------------------------------------------------- */

  /* ---------------------------------------------------------------------- */
  /* Hợp đồng mở rộng của lớp canvas — mọi toạ độ đã là pixel bản vẽ.         */
  /* ---------------------------------------------------------------------- */

  const zoom = useStore((current) => current.zoom);
  const viewCenter = useStore((current) => current.viewCenter);
  const hiddenLayers = useStore((current) => current.hiddenLayers);

  const isWallLayerVisible = !hiddenLayers.includes('wall');
  const toggleLayerVisibility = useStore((current) => current.toggleLayerVisibility);

  /**
   * Bật/tắt lớp Tường của cây lớp (BC-19).
   *
   * View KHÔNG gọi thẳng kho (R-60): cờ sống ở `viewSlice.hiddenLayers` và đi
   * ra qua đúng hàm này. Chú giải độ dày đọc cùng cờ đó, nên câu "chú giải luôn
   * hiện KHI LỚP TƯỜNG BẬT" giữ được cả hai vế.
   */
  const onToggleWallLayer = useCallback(() => {
    toggleLayerVisibility('wall');
  }, [toggleLayerVisibility]);

  /*
   * Tim tường: hành vi cũ là GIÁ TRỊ KHỞI TẠO, người dùng đè lên được (BC-17).
   *
   * `null` nghĩa là "chưa ai đè", nên bật công cụ vẽ/tách vẫn tự hiện tim tường
   * như trước; một lượt bấm ô đánh dấu ghim lấy câu trả lời của người dùng.
   */
  const [centrelineOverride, setCentrelineOverride] = useState<boolean | null>(null);
  const showCentrelines =
    centrelineOverride ?? (toolState.tool === 'drawWall' || toolState.tool === 'splitWall');
  const showCentrelinesRef = useRef(showCentrelines);
  showCentrelinesRef.current = showCentrelines;

  const onToggleCentrelines = useCallback(() => {
    setCentrelineOverride(!showCentrelinesRef.current);
  }, []);

  /** Danh sách tầng cho khối điều hướng của panel trái (BC-05). */
  /*
   * The graph holds one floor's layer (N16 is per floor), so the floor list comes
   * from the #30 read; gateways without `readFloors` (story, test) use graph levels.
   */
  const readFloors = gateway.readFloors;
  const floorsQuery = useQuery({
    queryKey: queryKeys.floor.list(projectId),
    queryFn: ({ signal }) => (readFloors === undefined ? [] : readFloors({ projectId, signal })),
    enabled: readFloors !== undefined,
  });
  const floors = useMemo(() => {
    const listed = floorsQuery.data;

    if (listed !== undefined && listed.length > 0) {
      return [...listed]
        .sort((first, second) => first.order - second.order)
        .map((item) => ({ id: item.id, label: item.name, isCurrent: item.id === floorId }));
    }

    return levelsOf(graph).map((item) => ({
      id: item.id,
      label: item.name,
      isCurrent: item.id === levelId,
    }));
  }, [floorsQuery.data, floorId, graph, levelId]);

  const drawingSizePx = useMemo<WallLayerSizePx | null>(
    () => drawingSizeOf(background ?? undefined, level),
    [background, level],
  );

  const contentBoundsPx = useMemo<WallLayerRectPx | null>(
    () => unionOfBounds(shapes.map((shape) => shape.boundsPx)),
    [shapes],
  );

  /*
   * Khung nhìn: tâm nhìn của kho, đọc bằng pixel bản vẽ, cộng mức phóng.
   *
   * Nay là đường HAI CHIỀU: kho vẫn quyết những gì canvas vẽ, nhưng cụm thu
   * phóng, phím `F` và bản đồ nhỏ đã lái ngược được qua `setZoom`/`setViewCenter`
   * (xem khối "Lái khung nhìn" ngay dưới).
   */
  const [frameSizePx, setFrameSizePx] = useState<WallLayerSizePx | null>(null);

  /*
   * Hệ số "vừa khung" của cả lớp (BUG-403): mức phóng của kho đọc TƯƠNG ĐỐI với nó, nên 100%
   * là thấy trọn mặt bằng dù tầng chưa hiệu chỉnh (1 mm = 1 px, mặt bằng 8 m = 8.220 px).
   * Tâm nhìn của kho đặt vào GIỮA khung — bản trước lấy nó làm độ dời, nên tâm (0; 0) mặc định
   * ghim góc trên-trái bản vẽ vào góc khung và "vừa khung" đẩy bản vẽ ra ngoài.
   */
  const fitAllBoundsPx = useMemo<WallLayerRectPx | null>(
    () =>
      contentBoundsPx ??
      (drawingSizePx === null ? null : { x: 0, y: 0, ...drawingSizePx }),
    [contentBoundsPx, drawingSizePx],
  );
  /*
   * Hộp ấy CHỐT một lần mỗi tầng (lúc "mở tầng là vừa khung" bên dưới): tính lại theo từng lượt
   * sửa thì vẽ/tách/xoá/đổi độ dày làm cả mặt bằng tự phóng/dịch (review-1 #1). Khung đổi cỡ thì
   * hệ số vẫn tính lại từ hộp đã chốt.
   */
  const [lockedFit, setLockedFit] = useState<{ levelId: LevelId; boundsPx: WallLayerRectPx } | null>(null);
  const fitReferencePx = lockedFit !== null && lockedFit.levelId === levelId ? lockedFit.boundsPx : fitAllBoundsPx;
  /* "Vừa khung" dùng cả khung: chú giải đã ở panel phải, bản đồ nhỏ chỉ hiện khi phóng to (mặt bằng tràn khung). */
  const fitFramePx = frameSizePx;
  const baseScale = fitCanvasView(fitFramePx, fitReferencePx)?.zoom ?? DEFAULT_ZOOM;

  const viewport = useMemo<WallLayerViewportPx>(
    () => centredCanvasView(frameSizePx, toPixelPoint(viewCenter, scaleOfLevel(level)), zoom * baseScale),
    [baseScale, frameSizePx, level, viewCenter, zoom],
  );

  const legendLevels = useMemo(
    () => ({ ...legendLevelsOf(walls), activeFilter: thicknessFilter, onFilterChange: setThicknessFilter }),
    [thicknessFilter, walls],
  );

  /* ---------------------------------------------------------------------- */
  /* Lái khung nhìn: cụm thu phóng, phím F, bản đồ nhỏ.                       */
  /* ---------------------------------------------------------------------- */

  /*
   * Trước lượt gộp này, `ZoomCluster` và `MiniMap` được dựng TRẦN trong canvas:
   * bấm được, không đổi được gì. Người duyệt đã chấp thuận một ngoại lệ R-68 để
   * hai component đó nhận props, nên bốn nút và bản đồ nhỏ giờ nối vào đúng
   * `zoom`/`viewCenter` của kho — cùng hai trường mà `viewport` ở trên đọc ra.
   *
   * Khổ khung do canvas báo lên (`onFrameResize`): "vừa khung" không tính được
   * nếu không biết khung rộng bao nhiêu, và khung là thứ chỉ view đo được.
   */

  const setZoom = useStore((current) => current.setZoom);
  const setViewCenter = useStore((current) => current.setViewCenter);

  const onFrameResize = useCallback((size: WallLayerSizePx) => {
    setFrameSizePx((previous) =>
      previous !== null && previous.width === size.width && previous.height === size.height
        ? previous
        : size,
    );
  }, []);

  const onZoomIn = useCallback(() => {
    setZoom(clampZoom(zoom + ZOOM_STEP));
  }, [setZoom, zoom]);

  const onZoomOut = useCallback(() => {
    setZoom(clampZoom(zoom - ZOOM_STEP));
  }, [setZoom, zoom]);

  const onResetZoom = useCallback(() => {
    setZoom(DEFAULT_ZOOM);
  }, [setZoom]);

  /**
   * G4a-19: kéo nền / chuột giữa / Space+kéo trên canvas — dời tâm nhìn ngược chiều kéo.
   * `dx`/`dy` là pixel KHUNG; chia mức phóng của khung để ra pixel bản vẽ.
   */
  const onPanBy = useCallback(
    (dx: number, dy: number) => {
      const scale = scaleOfLevel(level);
      const centre = toPixelPoint(viewCenter, scale);

      setViewCenter(
        toMillimetrePoint({ x: centre.x - dx / viewport.zoom, y: centre.y - dy / viewport.zoom }, scale),
      );
    },
    [level, setViewCenter, viewCenter, viewport.zoom],
  );

  /** Hộp mà phím `F` phủ: tường đang chọn nếu có, không thì cả lớp tường. */
  const fitBoundsPx = useMemo<WallLayerRectPx | null>(() => {
    if (selectedWallId !== null) {
      const selected = shapes.find((shape) => shape.id === selectedWallId);

      if (selected !== undefined) {
        return selected.boundsPx;
      }
    }

    return contentBoundsPx;
  }, [contentBoundsPx, selectedWallId, shapes]);

  /**
   * "Vừa khung" (nút bốn mũi tên và phím `F`) — phủ khắp vùng đang chọn.
   *
   * Đổi CẢ mức phóng lẫn tâm nhìn. Không có gì để phủ (chưa có tường, hoặc khung
   * chưa đo xong) thì KHÔNG làm gì — nhảy về một khung nhìn bịa còn tệ hơn là
   * đứng yên.
   */
  const onFitToScreen = useCallback(() => {
    if (fitBoundsPx === null) {
      return;
    }

    const fitted = fitCanvasView(fitFramePx, fitBoundsPx);

    setZoom(fitted === null ? DEFAULT_ZOOM : clampZoom(fitted.zoom / baseScale));
    setViewCenter(toMillimetrePoint(centreOfBounds(fitBoundsPx), scaleOfLevel(level)));
  }, [baseScale, fitBoundsPx, fitFramePx, level, setViewCenter, setZoom]);

  /*
   * Mở một tầng là thấy trọn tầng ấy (BUG-403): một lần cho mỗi tầng, khi đã có thứ để phủ.
   * Kho giữ mức phóng/tâm nhìn của màn trước (hoặc (0; 0) mặc định), không phải của tầng này.
   */
  useEffect(() => {
    if (levelId === null || fitAllBoundsPx === null || lockedFit?.levelId === levelId) {
      return;
    }

    setLockedFit({ boundsPx: fitAllBoundsPx, levelId });
    setZoom(DEFAULT_ZOOM);
    setViewCenter(toMillimetrePoint(centreOfBounds(fitAllBoundsPx), scaleOfLevel(level)));
  }, [fitAllBoundsPx, level, levelId, lockedFit, setViewCenter, setZoom]);

  /*
   * L23 — chế độ nhìn: Tổng thể vừa cả tầng; Từng việc giữ nguyên mức phóng khi chọn (mục dưới panel thì canvas chỉ dịch).
   * "So sánh hai bên": chọn là cả hai nửa phóng tới (nới ≥ 40 % cả tầng), kể cả đang Tổng thể; thoát thì về vừa cả tầng.
   * Chỉ chạy khi đổi khoá (`viewKeyRef`), không theo từng lượt sửa.
   */
  const chosenViewMode = useQcViewMode();
  const viewMode = isComparing ? 'task' : chosenViewMode;
  const viewKeyRef = useRef<string | null>(null);
  useEffect(() => {
    if (fitReferencePx === null || frameSizePx === null) {
      return;
    }

    const key = isComparing ? `compare:${selectedWallId ?? ''}` : chosenViewMode;
    const leftCompare = viewKeyRef.current?.startsWith('compare:') === true && !isComparing;

    if (viewKeyRef.current === key) {
      return;
    }

    viewKeyRef.current = key;
    const scale = scaleOfLevel(level);

    if (key === 'overview' || leftCompare) {
      setZoom(DEFAULT_ZOOM);
      setViewCenter(toMillimetrePoint(centreOfBounds(fitReferencePx), scale));
      return;
    }

    const selected = isComparing ? shapes.find((shape) => shape.id === selectedWallId) : undefined;

    if (selected === undefined) {
      return;
    }

    const focus = focusBoundsOf(selected.boundsPx, fitReferencePx);
    const fitted = fitCanvasView(focusFrameOf(frameSizePx), focus);

    /* Đoạn dài: không thu nhỏ dưới vừa khung, chỉ phóng tới. */
    setZoom(fitted === null ? DEFAULT_ZOOM : clampZoom(Math.max(fitted.zoom / baseScale, DEFAULT_ZOOM)));
    setViewCenter(toMillimetrePoint(centreOfBounds(focus), scale));
  }, [baseScale, chosenViewMode, fitReferencePx, frameSizePx, isComparing, level, selectedWallId, setViewCenter, setZoom, shapes]);

  /*
   * P03: lỗi quy chuẩn vừa được chỉ (từ URL hoặc bấm trong danh sách) — chọn tường lỗi nếu có, rồi
   * phóng sát chỗ lỗi ở CẢ hai chế độ nhìn. Chạy một lần mỗi lỗi; khoá `viewKeyRef` để khối trên
   * không phóng ngược ra cả đoạn khi vùng chọn đổi theo.
   */
  const ruleFocus = ruleIssues.focused;
  const ruleFocusKeyRef = useRef<string | null>(null);
  useEffect(() => {
    if (ruleFocus === null) {
      ruleFocusKeyRef.current = null;
      return;
    }

    if (ruleFocus.at === null || ruleFocusKeyRef.current === ruleFocus.key || isLoading || level === null || frameSizePx === null || fitReferencePx === null) {
      return;
    }

    ruleFocusKeyRef.current = ruleFocus.key;
    const wallId = walls.find((wall) => wall.id === ruleFocus.entityId)?.id ?? null;

    if (wallId !== null && wallId !== selectedWallId) {
      onSelect(wallId);
    }

    if (viewMode === 'task') {
      viewKeyRef.current = `task:${wallId ?? selectedWallId ?? ''}`;
    }

    const scale = scaleOfLevel(level);
    const centre = toPixelPoint(ruleFocus.at, scale);
    const halfPx = Math.abs(toPixelPoint({ x: millimetres(ruleFocus.at.x + RULE_FOCUS_HALF_MM), y: ruleFocus.at.y }, scale).x - centre.x);
    const fitted = fitCanvasView(focusFrameOf(frameSizePx), { x: centre.x - halfPx, y: centre.y - halfPx, width: halfPx * 2, height: halfPx * 2 });

    setZoom(fitted === null ? DEFAULT_ZOOM : clampZoom(fitted.zoom / baseScale));
    setViewCenter(toMillimetrePoint(centre, scale));
  }, [baseScale, fitReferencePx, frameSizePx, isLoading, level, onSelect, ruleFocus, selectedWallId, setViewCenter, setZoom, viewMode, walls]);

  /*
   * Surface the mini map draws: the drawing image, else the box hugging the walls
   * (same fallback as the canvas `surface`), so a floor without a drawing still has
   * a working mini map instead of a dead one (R46).
   */
  const miniMapSurfacePx = useMemo<WallLayerRectPx | null>(
    () => (drawingSizePx === null ? contentBoundsPx : { x: 0, y: 0, ...drawingSizePx }),
    [contentBoundsPx, drawingSizePx],
  );

  /** Bản đồ nhỏ: kéo hoặc bấm một chỗ thì tâm nhìn đi theo. */
  const onMiniMapViewportChange = useCallback(
    (rect: WallLayerViewportRectPercent) => {
      if (miniMapSurfacePx === null) {
        return;
      }

      setViewCenter(
        miniMapCentreMm(
          rect,
          miniMapSurfacePx,
          scaleOfLevel(level),
          { x: miniMapSurfacePx.x, y: miniMapSurfacePx.y },
        ),
      );
    },
    [miniMapSurfacePx, level, setViewCenter],
  );

  /*
   * Vùng nhìn của bản đồ nhỏ, phần trăm khổ bản vẽ: vùng ĐANG thấy của canvas, nên khung trên
   * bản đồ đi theo thu phóng/vừa khung (BUG-403 nợ). Chưa đo khung hay chưa có ảnh → mặc định.
   */
  const miniMapViewport =
    miniMapSurfacePx === null || frameSizePx === null
      ? MINIMAP_INITIAL_VIEWPORT
      : miniMapRectOf(
          (({ x, y, width, height }) => ({
            x: x - miniMapSurfacePx.x,
            y: y - miniMapSurfacePx.y,
            width,
            height,
          }))(visibleDrawingRect(viewport, frameSizePx)),
          miniMapSurfacePx,
        );

  /*
   * Phím `F` thuộc chế độ nhìn (`QcViewLayer`), nên màn không đăng ký nó; nút vừa khung vẫn giữ.
   * `Space` (giữ để tạm kéo khung nhìn) chưa đăng ký: kéo khung nhìn cần lớp canvas theo dõi cả
   * một cử chỉ kéo, thứ hợp đồng canvas không có chỗ nhận.
   */

  /* ---------------------------------------------------------------------- */
  /* Thanh trạng thái — ba chuỗi ĐÃ định dạng, view không tính gì (A15).      */
  /* ---------------------------------------------------------------------- */

  /* P5: gom theo khung hình — tối đa một lượt render mỗi khung khi rê chuột. */
  const [pointerReading, onPointerMove] = useFrameState<WallLayerPointerReading | null>(null);

  /**
   * Canvas báo lên toạ độ ĐÃ là pixel bản vẽ (trình duyệt đổi giúp qua ma trận
   * của `<svg>`); `cursorLabelOf` chỉ còn quy px → mm và định dạng. Đây là cách
   * thanh trạng thái có toạ độ THẬT mà thư mục màn vẫn không có một phép chia
   * quy đổi đơn vị nào (`local/no-raw-number`).
   */
  /**
   * Nhãn đo của canvas: đang đo thì đi theo con trỏ, đo xong thì đứng yên.
   *
   * Vế "đang đo" DẪN XUẤT từ chính máy công cụ — một điểm đã chấm cộng vị trí
   * con trỏ hiện tại — nên không có bản sao trạng thái thứ hai để lệch. Vế "đã
   * chốt" là kết quả `kind: 'measurement'` mà `runToolEvent` vừa cất. Khoảng
   * cách của cả hai vế đều do `measureDistance` của `src/domain/measure` tính.
   */
  const measurement = useMemo<WallLayerMeasurementPx | null>(() => {
    if (toolState.tool === 'measure' && toolState.values.length === 1 && pointerReading !== null) {
      const first = toolState.values[0];

      if (first !== undefined && first.kind === 'point') {
        const scale = scaleOfLevel(level);

        return toMeasurementPx(
          first.at,
          toMillimetrePoint({ x: pointerReading.xPx, y: pointerReading.yPx }, scale),
          scale,
          'measuring',
          lengthUnit,
        );
      }
    }

    return committedMeasurement;
  }, [committedMeasurement, lengthUnit, level, pointerReading, toolState.tool, toolState.values]);

  /* Bán kính bắt điểm vẽ tường: cỡ cố định trên MÀN, đổi ra mm theo mức phóng hiện tại. */
  const zoomedSnapRadiusMm = scaleOfLevel(level).pixelsToMillimetres(pixels(DRAW_SNAP_SCREEN_PX / viewport.zoom));
  const drawSnapRadiusMm: number =
    Number.isFinite(zoomedSnapRadiusMm) && zoomedSnapRadiusMm > 0 ? zoomedSnapRadiusMm : DEFAULT_DRAW_SNAP_RADIUS_MM;
  drawSnapRadiusMmRef.current = drawSnapRadiusMm;

  /* Xem trước bắt điểm y như lần bấm: cùng `resolveDrawPoint`, cùng điểm đầu, cùng Shift. */
  const drawFirst = toolState.tool === 'drawWall' ? toolState.values[0] : undefined;
  const drawStartMm = drawFirst?.kind === 'point' ? drawFirst.at : null;
  const drawHoverSnap = useMemo(
    () =>
      toolState.tool !== 'drawWall' || pointerReading === null
        ? null
        : resolveDrawPoint(
            toMillimetrePoint({ x: pointerReading.xPx, y: pointerReading.yPx }, scaleOfLevel(level)),
            drawStartMm,
            drawSnapTargets,
            drawSnapRadiusMm,
            shiftHeld,
          ),
    [drawSnapRadiusMm, drawSnapTargets, drawStartMm, level, pointerReading, shiftHeld, toolState.tool],
  );
  /* Độ dày nét sắp vẽ, cùng thứ tự với lúc chốt: phím 1/2/3, tường ở điểm đầu, tường ở điểm cuối. */
  const drawStartWallId = drawStartMm === null ? null : (drawSnapsRef.current.start?.wallId ?? null);
  const drawJoinedWallId = drawStartWallId ?? drawHoverSnap?.wallId ?? null;
  const drawEffectiveThicknessMm: number | null =
    drawThicknessMm ?? walls.find((wall) => wall.id === drawJoinedWallId)?.thicknessMm ?? null;

  /* G4a-23: nét tạm theo con trỏ cho Vẽ tường (từ điểm đầu) và Tách đoạn (dấu cắt). */
  const draftGuidePx = useMemo(() => {
    if (pointerReading === null) {
      return null;
    }

    const toPx = { x: pointerReading.xPx, y: pointerReading.yPx };

    if (toolState.tool === 'splitWall') {
      return { fromPx: null, toPx };
    }

    if (drawHoverSnap === null) {
      return null;
    }

    /* Chưa có điểm đầu: chỉ hiện vòng khi đang bắt được tường, không vẽ gì theo con trỏ trơn. */
    if (drawStartMm === null && drawHoverSnap.kind === null) {
      return null;
    }

    const scale = scaleOfLevel(level);

    return {
      fromPx: drawStartMm === null ? null : toPixelPoint(drawStartMm, scale),
      toPx: toPixelPoint(drawHoverSnap.point, scale),
      snapKind: drawHoverSnap.kind,
      /* Nét xem trước vẽ đúng bề dày sẽ lưu; chưa biết nối vào đâu thì lấy mặc định của công cụ. */
      thicknessPx: scale.millimetresToPixels(millimetres(drawEffectiveThicknessMm ?? DEFAULT_TOOL_SETTINGS.wallThicknessMm)),
    };
  }, [drawEffectiveThicknessMm, drawHoverSnap, drawStartMm, level, pointerReading, toolState.tool]);

  /* Nhãn độ dài cạnh nét xem trước — cùng `toMeasurementPx` với công cụ Đo. */
  const drawMeasurement = useMemo<WallLayerMeasurementPx | null>(
    () =>
      drawStartMm === null || drawHoverSnap === null
        ? null
        : toMeasurementPx(drawStartMm, drawHoverSnap.point, scaleOfLevel(level), 'measuring', lengthUnit),
    [drawHoverSnap, drawStartMm, lengthUnit, level],
  );

  const toolHint = toolHintOf(toolState.tool, toolState.values.length, {
    thicknessMm: drawEffectiveThicknessMm,
    isStartFloating: drawStartMm !== null && drawStartWallId === null,
  });

  const statusBar = useMemo<WallLayerStatusBarProps>(
    () => ({
      cursorLabel: [toolHint, cursorLabelOf(pointerReading, scaleOfLevel(level))]
        .filter((part) => part !== '')
        .join(' · '),
      toolHint: drawRefusal ?? toolHint,
      toolHintTitle: TOOL_HINT_TITLES[toolState.tool],
      scaleLabel: formatScaleLabel(level),
      /* P02: tầng bị khoá lưu (xung đột/từ chối) thì "sẽ thử lưu lại" là sai — chỉ về dải báo phía trên. */
      saveLabel: saveBlock === null ? saveIndicator.label : SAVE_BLOCKED_LABEL,
      saveFailed: saveBlock !== null || saveIndicator.state === 'failed',
    }),
    [drawRefusal, level, pointerReading, saveBlock, saveIndicator.label, saveIndicator.state, toolHint, toolState.tool],
  );

  /** Menu chuột phải "Đổi độ dày": đưa tường vào thanh tra, và focus vào ba lựa chọn (BUG-604). */
  const [thicknessFocusRequest, setThicknessFocusRequest] = useState(0);
  const onRequestThicknessChange = useCallback(
    (wallId: WallId) => {
      onSelect(wallId);
      setThicknessFocusRequest((count) => count + 1);
    },
    [onSelect],
  );

  /**
   * Menu chuột phải "Tách đoạn": chọn tường, bật công cụ, và ĐIỀN LUÔN bước
   * đầu.
   *
   * Người dùng vừa chỉ đúng tường cần tách, nên bắt họ bấm lại lần nữa để trả
   * lời bước `entity` là hỏi một câu đã có câu trả lời. Sau lượt này máy công
   * cụ chỉ còn chờ điểm cắt, và một lần bấm trên canvas là tách xong.
   */
  const onRequestSplit = useCallback(
    (wallId: WallId) => {
      onSelect(wallId);
      activateTool('splitWall');
      sendToolInput({ kind: 'entity', id: wallId });
    },
    [activateTool, onSelect, sendToolInput],
  );
  onRequestSplitRef.current = onRequestSplit;

  const onToggleFilter = useCallback((filter: WallLayerFilterKey) => {
    setFilters((previous) => ({ ...previous, [filter]: !previous[filter] }));
  }, []);

  const queue = useWallReviewQueue({
    graph,
    level,
    scaleStatus: floorLayer.scaleStatus,
    scaleSource: floorLayer.scaleSource,
    lockText: thicknessLockText,
    walls,
    visibleWalls,
    wallCodes,
    selectedWallId,
    canEdit: canEdit && !isScaleLocked,
    gateway,
    dispatchBundle,
    invalidate,
    onSelect,
    onSkip,
    onFlash: setFlashingWallId,
    registry: options.registry,
    suspectIds,
    reasonOf,
    onOpenThickness: onNavigate === undefined ? undefined : () => onNavigate(ROUTES.project.thickness(projectId, floorId)),
  });

  const panel: WallLayerViewProps = {
    state,
    rows,
    reviewCounter: counter,
    reviewProgressLabel: progressLabel,
    filters,
    thicknessChoices: WALL_LAYER_THICKNESS_CHOICES,
    thicknessFocusRequest,
    selectedWallId,
    selectedWallIds,
    hoveredWallId: hoveredId as WallId | null,
    inspector,
    isCompact: isCollapsed,
    isCollapsed,
    isViewerRole,
    viewerRoleNotice: isViewerRole ? WALL_LAYER_TEXT.viewerRoleNotice : null,
    scaleLock: scaleLockView,
    /* Vai Người xem giữ `forbidden` nhưng danh sách vẫn phải biết "rỗng thật" (16-D-008). */
    emptyNotice:
      state === 'empty' || (isViewerRole && !isLoading && !hasError && counter.total === 0)
        ? WALL_LAYER_TEXT.emptyNotice
        : null,
    errorMessage,
    onApprove,
    onUnapprove,
    onSkip,
    onOpenRowMenu,
    onChangeThickness,
    onChangeLength,
    onChangeMaterial,
    onDelete,
    onSplit,
    onMerge,
    onSelect,
    onHover,
    onToggleFilter,
    onUndo,
    onToggleCollapsed,
  };

  /*
   * Lớp vẽ theo pixel KHUNG (BUG-403): `<svg>` phủ kín khung với `viewBox` là vùng bản vẽ đang
   * thấy, còn ảnh nền, vòng chọn và nhãn đo là HTML đứng ở toạ độ khung — không lớp `scale()`
   * nào để viền và chữ của chúng teo theo hệ số "vừa khung".
   */
  const hasFrame = frameSizePx !== null && frameSizePx.width > 0 && frameSizePx.height > 0;
  const surfacePx = drawingSizePx === null ? contentBoundsPx : { x: 0, y: 0, ...drawingSizePx };
  const activeWallId = selectedWallId ?? (hoveredId as WallId | null) ?? null;
  const activeWall = shapes.find((shape) => shape.id === activeWallId) ?? null;
  const frameLayer = {
    viewBoxPx:
      surfacePx === null || !hasFrame ? surfacePx : visibleDrawingRect(viewport, frameSizePx),
    surfaceRectPx: surfacePx === null ? null : toFrameRect(viewport, surfacePx),
    haloRectPx: activeWall === null ? null : toFrameRect(viewport, activeWall.boundsPx),
  };
  /* WRU-B: nhãn dài × dày · tin cậy cạnh tường đang chọn/rê (`wallTag.ts`), pixel KHUNG. */
  const wallTag =
    activeWall === null || frameSizePx === null ? null : wallTagOf(activeWall, queue.extras.get(activeWall.id), viewport, frameSizePx);
  /* L23: ghim số cho tường còn chờ, cùng thứ tự hàng đợi của thẻ hỏi (`rows` chưa duyệt). */
  const viewLayer = {
    /* Số ghim = thứ tự trong hàng đợi (như dòng danh sách), kể cả khi đoạn bị lọc độ dày không vẽ ghim. */
    pins: rows.filter((row) => !row.isReviewed).flatMap((row, index) => {
      const shape = shapes.find((item) => item.id === row.id);
      return shape === undefined ? [] : [{ id: row.id, n: index + 1, ...toFramePoint(viewport, centreOfBounds(shape.boundsPx)) }];
    }),
    selectedId: selectedWallId,
    onPick: (id: string) => onSelect(id as WallId),
    /* Vẽ/tách/đo: ghim số không nuốt con trỏ, nét xem trước đi theo chuột cả khi rê qua ghim. */
    pinsInteractive: toolState.tool === 'select',
  };
  const onFrame = (point: WallLayerMeasurementPx['startPx']) =>
    point === null ? null : toFramePoint(viewport, point);
  const shownMeasurement = drawMeasurement ?? measurement;
  const frameMeasurement: WallLayerMeasurementPx | null =
    shownMeasurement === null
      ? null
      : {
          ...shownMeasurement,
          /* G4a-22: tỷ lệ còn tạm thì số đo cũng tạm — cùng lời với "Chiều dài: … tỷ lệ tạm" của thanh tra. */
          distanceLabel:
            provisionalScaleNotice === null ? shownMeasurement.distanceLabel : `${shownMeasurement.distanceLabel} (tạm)`,
          startPx: onFrame(shownMeasurement.startPx),
          currentPx: onFrame(shownMeasurement.currentPx),
          midPx: onFrame(shownMeasurement.midPx),
        };

  /* P03: dấu chỗ lỗi đang chỉ, pixel bản vẽ; to ít nhất 18 px khung hoặc 300 mm để thấy cả khe vài cm. */
  const ruleMarkerPx = (() => {
    if (ruleFocus?.at == null || level === null) {
      return null;
    }

    const scale = scaleOfLevel(level);
    const centre = toPixelPoint(ruleFocus.at, scale);
    const markPx = Math.abs(toPixelPoint({ x: millimetres(ruleFocus.at.x + RULE_MARKER_MIN_MM), y: ruleFocus.at.y }, scale).x - centre.x);

    return { x: centre.x, y: centre.y, radius: Math.max(RULE_MARKER_MIN_FRAME_PX / viewport.zoom, markPx) };
  })();

  /* Cửa đi / cửa sổ chỉ-đọc trên tường đang vẽ (lớp 'opening' của kho, mặc định bật). */
  const isOpeningLayerVisible = !hiddenLayers.includes('opening');
  const onToggleOpeningLayer = useCallback(() => toggleLayerVisibility('opening'), [toggleLayerVisibility]);
  const openingSymbols = useMemo(
    () => (isOpeningLayerVisible ? openingSymbolsOf(graph, thicknessFilteredWalls, level, scaleOfLevel(level)) : []),
    [graph, isOpeningLayerVisible, level, thicknessFilteredWalls],
  );

  const canvas: WallLayerCanvasViewProps = {
    shapes,
    openings: openingSymbols,
    ruleMarkerPx,
    selectedWallId,
    selectedWallIds,
    menuRequest,
    draftGuidePx,
    onWallDrawPress: canEdit && isDrawingWall ? onWallDrawPress : null,
    hoveredWallId: (hoveredId as WallId | null) ?? null,
    showCentrelines,
    millimetresPerPixel: level?.scaleMillimetresPerPixel ?? UNCALIBRATED_SCALE,
    /*
     * BT-06/BT-07: ở trạng thái `error` canvas VẪN xem được ảnh gốc. `background`
     * là lượt đọc thành công gần nhất, nên một lượt đọc hỏng sau đó không xoá
     * mất bản vẽ mà kỹ sư đang đối chiếu.
     */
    backgroundImageUrl: background?.imageUrl ?? null,
    backgroundImageAlt: background?.imageAlt ?? '',
    isInteractive: canEdit,
    /* G4a-22: đang đo thì bấm lên tường chỉ là chấm điểm đo, không đổi vùng chọn. */
    onSelect: toolState.tool === 'measure' ? () => undefined : onSelect,
    onHover,

    /* -- Hợp đồng mở rộng của lớp canvas (T7) ------------------------------ */
    state,
    canvasLabel: canvasLabelOf(level, counter.total),
    viewport,
    drawingSizePx,
    contentBoundsPx,
    isWallLayerVisible,
    legendLevels,
    measurement: frameMeasurement,
    ...frameLayer,
    viewLayer,
    wallTag,
    onApprove,
    onRequestThicknessChange,
    onRequestSplit,
    onDelete,

    /* -- Khung nhìn lái ngược được (T8) ---------------------------------- */
    zoomPercent: zoomPercentOf(zoom),
    unitPx: 1 / viewport.zoom,
    onZoomIn,
    onZoomOut,
    onResetZoom,
    onFitToScreen,
    miniMapViewport,
    onMiniMapViewportChange,
    onPanBy,
    onFrameResize,
    onPointerMove,
    onCanvasPoint,
    onToggleSelect,
  };

  const leftPanel: WallLayerLeftPanelExtras & WallOpeningLayerToggle = {
    floors,
    showCentrelines,
    onToggleCentrelines,
    isWallLayerVisible,
    onToggleWallLayer,
    isOpeningLayerVisible,
    onToggleOpeningLayer,
    flashingWallId,
    onToggleSelect,
    ruleIssues,
  };

  return { panel, canvas, toolRail, statusBar, leftPanel, queue, saveBlock, provisionalScaleNotice, readFailure };
}

/** Cổng có dữ liệu, xuất lại để story và bài kiểm cắm vào cùng một chỗ (R-73). */
export { createMockWallLayerReviewGateway, normalizeSpatial };
