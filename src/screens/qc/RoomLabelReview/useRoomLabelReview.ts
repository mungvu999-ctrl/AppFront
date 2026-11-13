/**
 * Nửa "suy nghĩ" của màn S-17 "Duyệt tên phòng" — nơi cổng dữ liệu
 * (`roomLabelReviewGateway.ts`) gặp hợp đồng kiểu (`roomLabelTypes.ts`).
 *
 * View của màn thuần và kiểm được chỉ từ props (mục D của CLAUDE.md); mọi phép
 * đọc, mọi lượt ghi, mọi con số thành chuỗi đều xảy ra ở đây hoặc ở cổng, KHÔNG
 * ở view.
 *
 * ## Bảy thứ file này chịu trách nhiệm
 *
 * 1. **Hai lượt đọc máy chủ TÁCH BẠCH (R-64)** — ảnh nền dưới
 *    `queryKeys.drawing.byFloor`, lớp phòng là N16 dưới `queryKeys.layer.byFloor` (`useFloorLayer`).
 *    `isLoading`/`error` do `@tanstack/react-query` giữ; file này KHÔNG có một
 *    `useState` nào cho hai thứ đó (CLAUDE.md gọi `useShareLinks.ts` là ngoại
 *    lệ đi trước, "không phải khuôn mẫu để chép").
 * 2. **Bảy trạng thái (A11/R-63)** — {@link deriveRoomLabelScreenState}, một
 *    hàm thuần kiểm được không cần dựng hook.
 * 3. **Diện tích CHỈ tính lại khi HÌNH HỌC đổi.** Đổi tên một phòng không đụng
 *    tới `measureRoom`: bộ nhớ đệm khoá theo ranh phòng, xem
 *    {@link outlineKeyOf} và khối "Đo phòng" bên dưới. Bài kiểm khẳng định
 *    bằng ĐỒNG NHẤT THAM CHIẾU (`toBe`) chứ không bằng chuỗi bằng nhau, nên
 *    một lượt tính lại lén cũng lộ.
 * 4. **Chuẩn hoá tên luôn XEM TRƯỚC rồi mới áp** — `onOpenNormalizePreview`
 *    dựng bảng và KHÔNG đổi gì; chỉ `onApplyNormalize` mới phát lệnh.
 * 5. **Mọi lượt ghi kèm vé hoàn tác tám giây (A8)** — một lệnh, một mục trong
 *    ngăn xếp 100 bước của S-06, một toast mang `UNDO_WINDOW_MS` do chính vé
 *    giữ (R-71: con số không viết lại ở đây).
 * 6. **Tự lưu (A7)** — bộ lưu lớp chung `useFloorLayerAutosave` (#35, một bộ
 *    mỗi người–dự án, F-04x-1); 409 → dải "Tải lại", lỗi khác → dải "Không lưu
 *    được"; `useSaveIndicator` nói trạng thái ra cho trình đọc màn hình.
 * 7. **Nhắc công năng M-14 không bao giờ CHẶN** — `notices` chỉ đi kèm từng
 *    dòng phòng; không một hàm `on…` nào dưới đây hỏi `notices` trước khi chạy.
 *
 * ## Bốn quyết định đáng ghi
 *
 * - **Bộ lọc "Chưa đặt tên" thu hẹp `rooms`, và trạng thái đọc theo `rooms`.**
 *   Bất biến #1 của hợp đồng (`state === 'empty'` ⟺ `rooms.length === 0` ⟺
 *   `emptyNotice !== null`) nói về CHÍNH mảng `rooms` mà view nhận, nên khi bộ
 *   lọc lọc sạch danh sách thì màn đúng là rỗng — và `emptyNotice` nói ra lý do
 *   thứ hai ("bộ lọc đang bật") kèm bước đi tiếp, thay vì để người duyệt nhìn
 *   một danh sách trắng không lời giải thích. `summary` thì luôn đếm TOÀN BỘ
 *   phòng của tầng: nó là dòng tóm tắt của tầng, không phải của bộ lọc.
 * - **Một lượt ghi phòng làm mất hiệu lực đúng ba khoá `editWall` liệt kê.**
 *   `WRITE_OPERATIONS` (`src/lib/query/invalidation.ts`) không có mục nào tên
 *   `editRoom`, và thêm một mục là sửa `src/lib` — ngoài phạm vi của màn. Ba
 *   khoá `editWall` làm mất hiệu lực (khoá không gian và khoá phòng của tầng,
 *   `violation.byProject`) đúng bằng ba thứ một lượt đổi tên/gộp/tách phòng
 *   làm cũ đi, nên đây là lượt gọi ĐÚNG dưới một cái tên hẹp hơn thực tế.
 * - **Điều hướng đi qua `onNavigate` tiêm được, không phải `useNavigate`.**
 *   Hook phải dựng được trong `renderHook` mà không cần một `<MemoryRouter>`;
 *   đường dẫn thì luôn ghép bằng `ROUTES` (R-65), không một chuỗi `/…` thô nào.
 * - **`isCompact` do nơi gọi quyết.** Repo chưa có hook truy vấn media nào và
 *   viết thẳng `1024` ở đây là đúng thứ R-71 cấm, nên hook nhận `forceCompact`
 *   và mặc định đi theo `isCollapsed` — cùng cách `useWallLayerReview` đã chốt.
 *
 * ## Ba cảnh báo của `roomLabelTypes.ts` đã được trả lời ở tầng cổng
 *
 * Cả ba (không có lệnh duyệt phòng; gộp/tách thiếu hình học; chưa có phép chuẩn
 * hoá tên) đã được điều phối viên phán quyết và cài trong
 * `roomLabelReviewGateway.ts` — `buildApproveRoomCommand`,
 * `buildMergeRoomCommand`/`buildSplitRoomCommandFromWalls`,
 * `buildNormalizePreview`. File này chỉ GỌI chúng; không một đường ghi tắt nào
 * đặt `reviewed: true` và không một công thức hình học nào viết ở đây (R-61).
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';

import { computeCentroid, outlineContains } from '@/domain/rooms/area';
import { displayCodesOf } from '@/domain/spatial/ids';
import type {
  Level,
  LevelId,
  Point,
  Room,
  RoomId,
  RoomUsage,
  Wall,
  WallId,
} from '@/domain/spatial/types';
import { millimetresPerPixel } from '@/domain/units/scale';
import { useFloorLayerAutosave } from '@/hooks/useAutosave';
import { useFloorLayer } from '@/hooks/useFloorLayer';
import { appNotificationBus } from '@/hooks/useNotifications';
import { useSaveIndicator } from '@/hooks/useSaveIndicator';
import { useShortcut } from '@/hooks/useShortcut';
import { can } from '@/lib/auth/permissions';
import { toPoint, toPointMm, type CommandContext, type CommandResult } from '@/lib/commands/business/shared';
import { newestEntryId, undoIfNewest } from '@/lib/commands/history';
import type { Command } from '@/lib/commands/types';
import { ok } from '@/lib/http/types';
import type { ShortcutRegistry } from '@/lib/input/shortcutRegistry';
import type { NotificationBus } from '@/lib/mutations/notificationBus';
import { applyInvalidation } from '@/lib/query/invalidation';
import { queryKeys } from '@/lib/query/queryKeys';
import { ROUTES } from '@/routes/paths';
import { readSavedSegment } from '@/screens/pipeline/ScaleCalibration/useScaleCalibration';
import { useStore } from '@/store';
import { currentSelection } from '@/store/commit';
import type { ProjectRole } from '@/types/project';

import {
  buildApproveRoomCommand,
  buildChangeUsageCommand,
  buildMergeRoomCommand,
  buildNormalizeNamesCommand,
  buildNormalizePreview,
  buildRenameRoomCommand,
  buildSplitRoomCommandFromWalls,
  commandContextOf,
  usageOfRoomName,
  createMockRoomLabelReviewGateway,
  createRoomLabelDispatchDeps,
  createRoomLabelReviewGateway,
  createRoomLabelUndoTicket,
  detectRoomsOfLevel,
  gapsOf,
  hasRoomName,
  levelOf,
  measureRoom,
  noticesOfRoom,
  roomCodeLabel,
  roomsOfLevel,
  roomsSpillingOutside,
  runRoomCommand,
  runRoomRules,
  scaleOfLevel,
  summaryOf,
  toRoomLabelRow,
  approveConfidentRoomsLabelOf,
  confidentRoomsOf,
  runRoomTransaction,
  wallsOfLevel,
  ROOM_NAME_TARGETS,
  ROOM_USAGE_CHOICES,
  type RoomLabelBackground,
  type RoomLabelGraphPort,
  type RoomLabelMeasures,
  type RoomLabelReviewGateway,
  scaleSegmentOf,
} from './roomLabelReviewGateway';
import { SAVE_BLOCKED_LABEL, useFloorLayerReadFailure } from '../shared/floorLayerReadFailure';
import { SCALE_LOCK_REASON } from '../shared/floorReviewGateModel';
import { useProvisionalScaleNotice } from '../shared/provisionalScaleNotice';
import { useScaleLock } from '../shared/useScaleLock';
import { arrowStepHandler } from '../WallLayerReview/listArrowKeys';
import { layerGateOf } from '../ObjectLayerReview/layerGate';
import type {
  RoomLabelMergeCandidate,
  RoomLabelNormalizePreview,
  RoomLabelReviewProps,
  RoomLabelScreenState,
  RoomLabelSummaryViewModel,
  RoomLabelUsageOption,
  RoomLabelViewModel,
} from './roomLabelTypes';
import { byRoomReason } from './roomReviewReasons';

/* -------------------------------------------------------------------------- */
/* Chuỗi của hook — mọi câu người dùng đọc mà cổng không sinh ra.              */
/* -------------------------------------------------------------------------- */

/**
 * Ba câu của riêng màn, chữ thường kiểu câu (A6).
 *
 * Hai câu `empty…` BẮT BUỘC kèm bước đi tiếp — CẤM TUYỆT ĐỐI của đặc tả nói về
 * vòng hở, và một màn rỗng không nói được phải làm gì tiếp là đúng thứ A11 tồn
 * tại để chặn.
 */
export const ROOM_LABEL_SCREEN_TEXT = {
  emptyNotice:
    'Chưa dò ra phòng nào ở tầng này: vòng tường bao quanh các phòng chưa khép kín. Sang lớp tường khép các đoạn còn hở, rồi bấm "Kiểm tra lại vòng hở" để dò lại.',
  emptyFilteredNotice:
    'Không còn phòng nào chưa đặt tên. Tắt bộ lọc "Chưa đặt tên" để xem lại toàn bộ phòng của tầng.',
  viewerRoleNotice:
    'Bạn đang xem với vai người xem: đổi tên, đổi công năng, gộp, tách và duyệt đều tắt. Nhờ người quản trị dự án đổi vai nếu bạn cần sửa lớp phòng.',
  undoShortcut: 'Hoàn tác thay đổi phòng gần nhất.',
  arrowNextShortcut: 'Chọn phòng kế tiếp trong danh sách.',
  arrowPreviousShortcut: 'Chọn phòng phía trên trong danh sách.',
  approveNextShortcut: 'Duyệt phòng đang chọn rồi sang phòng chưa duyệt kế tiếp.',
} as const;

/** Toast "Hoàn tác" bị từ chối vì đã có bước mới hơn (BUG-579, cùng khuôn SCR-16/17/21). */
const ROOM_UNDO_REFUSED_TYPE = 'roomLabelReview.undoRefused';

/* -------------------------------------------------------------------------- */
/* Tham số vào và giá trị ra.                                                  */
/* -------------------------------------------------------------------------- */

export interface UseRoomLabelReviewOptions {
  readonly projectId: string;
  readonly floorId: string;
  /** Tầng đang duyệt. Vắng mặt thì hook lấy tầng đầu tiên của đồ thị. */
  readonly levelId?: LevelId;
  readonly roles?: readonly ProjectRole[];
  /** Cổng dữ liệu tiêm được. Vắng mặt thì hook dựng cổng thật, đúng một lần. */
  readonly gateway?: RoomLabelReviewGateway;
  /** Ép thu gọn hai panel — cho story và bài kiểm muốn một câu trả lời cố định. */
  readonly forceCollapsed?: boolean;
  /** Ép chế độ hẹp. Xem ghi chú "isCompact do nơi gọi quyết" ở đầu file. */
  readonly forceCompact?: boolean;
  /**
   * Bus thông báo — chỗ toast hoàn tác của A8 đi ra.
   *
   * Bỏ trống là bus của cả phiên (`appNotificationBus`), thứ `NotificationHost`
   * ở `src/main.tsx` đang vẽ. Test và story tiêm bus riêng để hai lượt kiểm
   * không thấy thông báo của nhau.
   */
  readonly notifications?: NotificationBus;
  /**
   * Nơi màn đi tới khi người duyệt bấm "sang lớp tường".
   *
   * Container (T8) nối nó với `useNavigate`; hook không gọi `useNavigate` để
   * `renderHook` dựng được mà không cần một `<MemoryRouter>`. Bỏ trống thì màn
   * không đi đâu cả — và bài kiểm thấy đúng đường dẫn `ROUTES` ghép ra.
   */
  readonly onNavigate?: (href: string) => void;
  /** Sổ phím tắt tiêm được; vắng mặt thì dùng sổ dùng chung của ứng dụng. */
  readonly shortcutRegistry?: ShortcutRegistry;
}

/** Đúng hợp đồng đã đóng băng, không thêm một lát nào. */
export type UseRoomLabelReviewResult = RoomLabelReviewProps;

/* -------------------------------------------------------------------------- */
/* Hằng của riêng hook.                                                        */
/* -------------------------------------------------------------------------- */

const NO_CANDIDATES: readonly RoomLabelMergeCandidate[] = [];

/**
 * Tỷ lệ dùng khi tầng CHƯA hiệu chỉnh.
 *
 * `RoomLabelReviewProps.millimetresPerPixel` không nhận `null`, nên phải có một
 * giá trị; một milimét trên một điểm ảnh là phép biến đổi đồng nhất — canvas vẽ
 * đúng toạ độ đồ thị, không phóng đại cũng không thu nhỏ theo một tỷ lệ bịa.
 */
const UNCALIBRATED_SCALE = millimetresPerPixel(1);

/** Phòng chiếm hơn tỷ lệ sàn này thì gắn cờ "có thể là khung tên bản vẽ" (Z/S-20, B1-9). */
const OVERSIZED_ROOM_SHARE = 0.8;

/**
 * Câu dưới "Diện tích" của thanh tra: nói diện tích đo Ở ĐÂU, bằng lời thường.
 * Từng lấy đoạn phép tính của `explainRoom` (công thức dây giày, "x1 × y2 − x2 × y1")
 * — chi tiết của người lập trình, không phải của người duyệt tên phòng (BUG-408).
 */
/* Ranh phòng là đường tim tường: số tính từ nó không phải thông thuỷ. */
const AREA_CAPTION = 'Diện tích tính theo tim tường của ranh phòng.';
const CLEAR_AREA_CAPTION = 'Số chính là diện tích thông thuỷ (trừ nửa bề dày tường bao); số phụ tính theo tim tường.';

/* -------------------------------------------------------------------------- */
/* Phép ghép thuần — kiểm được mà không cần dựng hook.                          */
/* -------------------------------------------------------------------------- */

/**
 * Chữ ký HÌNH HỌC của một phòng: mã phòng cộng ranh phòng.
 *
 * Đây là khoá của bộ nhớ đệm số đo. Nó CỐ Ý không mang `name`, `usage`,
 * `reviewed` hay `confidence` — đổi tên một phòng phải không làm `measureRoom`
 * chạy lại, và cách chắc chắn nhất để giữ lời hứa đó là khoá không biết tên
 * phòng tồn tại. Thuần nối chuỗi: không một phép tính, không một lượt định dạng
 * số nào (A15 — con số ra chuỗi người đọc là việc của `formatArea`).
 */
export function outlineKeyOf(room: Room): string {
  const corners = room.outline
    .map((corner) => `${String(corner.x)},${String(corner.y)}`)
    .join(' ');

  return `${room.id}|${corners}`;
}

/** Chỉ phòng chưa đặt tên, khi chip "Chưa đặt tên" đang bật. */
export function applyUnnamedFilter(
  rooms: readonly RoomLabelViewModel[],
  showOnlyUnnamed: boolean,
): readonly RoomLabelViewModel[] {
  return showOnlyUnnamed ? rooms.filter((room) => !room.hasName) : rooms;
}

/**
 * Bảy trạng thái của A11, theo đúng thứ tự ưu tiên `useWallLayerReview` đã chốt.
 *
 * Vai trò đi trước vì trạng thái 6 vô hiệu MỌI hàm sửa: một người xem nhìn màn
 * thu gọn vẫn là một người xem. `error` đi trước `loading` vì một lượt đọc đã
 * hỏng thì không còn "đang tải" nữa.
 */
export function deriveRoomLabelScreenState(input: {
  readonly isViewerRole: boolean;
  readonly isCollapsed: boolean;
  readonly hasError: boolean;
  readonly isLoading: boolean;
  readonly visibleRooms: readonly RoomLabelViewModel[];
  readonly unnamedCount: number;
}): RoomLabelScreenState {
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

  if (input.visibleRooms.length === 0) {
    return 'empty';
  }

  return input.unnamedCount === 0 && input.visibleRooms.every((room) => room.status === 'confirmed')
    ? 'success'
    : 'partial';
}

/** Phòng khác của cùng tầng — nguyên liệu của danh sách "gộp với…". */
export function mergeCandidatesOf(
  rooms: readonly Room[],
  selectedRoomId: RoomId | null,
  codes?: ReadonlyMap<string, string>,
): readonly RoomLabelMergeCandidate[] {
  if (selectedRoomId === null) {
    return NO_CANDIDATES;
  }

  return rooms
    .filter((room) => room.id !== selectedRoomId)
    .map((room) => ({ id: room.id, codeLabel: roomCodeLabel(room.id, codes), name: room.name }));
}

/**
 * Điểm cắt của một lượt tách, do HOOK chọn (R-60).
 *
 * Chạy lại M-06 trên tường hiện tại và hỏi: có đúng HAI vùng dò được nằm trong
 * ranh phòng này không? Có thì điểm cắt là trọng tâm của vùng thứ hai —
 * `computeCentroid` của M-07 tính, hook chỉ chuyền tay. Không thì `null`, và
 * thanh tra nói ra cách vẽ đoạn tường ngăn thay vì hiện một nút tách chết.
 *
 * Đúng phép lọc mà `buildSplitRoomCommandFromWalls` dùng để nhận hai phần, nên
 * một điểm cắt khác `null` ở đây là một lượt tách chắc chắn qua được cổng.
 */
export function splitPointOf(
  room: Room | null,
  walls: readonly Wall[],
  level: Level | null,
): Point | null {
  if (room === null) {
    return null;
  }

  const detected = detectRoomsOfLevel(walls, level);

  if (detected === null) {
    return null;
  }

  const outlineMm = room.outline.map(toPointMm);
  const parts = detected.rooms.filter((part) =>
    outlineContains(outlineMm, computeCentroid(part.outline)),
  );

  const second = parts.length === 2 ? parts[1] : undefined;

  return second === undefined ? null : toPoint(computeCentroid(second.outline));
}

/** Câu giải thích diện tích; `''` khi tầng chưa có phòng nào — không có ranh phòng thì không có gì để giải thích. */
export function areaCaptionOf(room: Room | null): string {
  if (room === null) return '';
  return room.clearAreaM2 === undefined ? AREA_CAPTION : CLEAR_AREA_CAPTION;
}

/** Tám nhãn công năng làm gợi ý tên — GỢI Ý, không bao giờ ép (CẤM TUYỆT ĐỐI). */
export const ROOM_LABEL_NAME_SUGGESTIONS: readonly string[] = ROOM_NAME_TARGETS;

/** Danh mục công năng dưới đúng hình dạng ô chọn cần. Nhãn tới từ tầng luật. */
export const ROOM_LABEL_USAGE_OPTIONS: readonly RoomLabelUsageOption[] = ROOM_USAGE_CHOICES.map(
  (choice) => ({ value: choice.usage, label: choice.label }),
);

/* -------------------------------------------------------------------------- */
/* Hook.                                                                       */
/* -------------------------------------------------------------------------- */

/** Cổng thật dựng đúng một lần cho suốt đời component. */
function useResolvedGateway(injected: RoomLabelReviewGateway | undefined): RoomLabelReviewGateway {
  const fallbackRef = useRef<RoomLabelReviewGateway | null>(null);

  if (injected !== undefined) {
    return injected;
  }

  fallbackRef.current ??= createRoomLabelReviewGateway();

  return fallbackRef.current;
}

export function useRoomLabelReview(
  options: UseRoomLabelReviewOptions,
): UseRoomLabelReviewResult {
  const { floorId, projectId } = options;
  const gateway = useResolvedGateway(options.gateway);
  const queryClient = useQueryClient();
  const notifications = options.notifications ?? appNotificationBus;

  /* ---------------------------------------------------------------------- */
  /* Vai trò — trạng thái 6 vô hiệu MỌI hàm sửa, ở tầng hook.                */
  /* ---------------------------------------------------------------------- */

  const roles = options.roles ?? [];
  const canEditRole = can('edit', 'layer', { roles });
  const isViewerRole = !canEditRole;

  /* ---------------------------------------------------------------------- */
  /* Trạng thái của riêng giao diện — KHÔNG có isLoading/error ở đây (R-64). */
  /* ---------------------------------------------------------------------- */

  const [showOnlyUnnamed, setShowOnlyUnnamed] = useState(false);
  const [ownCollapsed, setOwnCollapsed] = useState(false);
  const [normalizePreview, setNormalizePreview] = useState<RoomLabelNormalizePreview | null>(null);
  const isCollapsed = options.forceCollapsed ?? ownCollapsed;
  const isCompact = options.forceCompact ?? isCollapsed;

  /* ---------------------------------------------------------------------- */
  /* Hai lượt đọc máy chủ, TÁCH BẠCH (R-64).                                 */
  /* ---------------------------------------------------------------------- */

  /*
   * Ảnh nền và lớp phòng là HAI lượt đọc dưới hai khoá khác nhau, và trạng thái
   * `error` chỉ nghe lượt thứ hai: "ảnh nền hỏng" KHÔNG được đọc thành "lớp
   * phòng hỏng", vì ở trạng thái 4 canvas vẫn phải xem được ảnh gốc.
   */

  const backgroundQuery = useQuery({
    queryKey: queryKeys.drawing.byFloor(floorId),
    queryFn: ({ signal }) => gateway.readBackground({ floorId, projectId, signal }),
  });

  /* N16 của tầng — `useFloorLayer` quyết định nó vào kho thế nào (F-04x-2). */
  const floorLayer = useFloorLayer({ floorId, projectId, read: gateway.readLayer });
  const { scaleStatus, scaleSource, scaleState } = floorLayer;
  const provisionalScaleNotice = useProvisionalScaleNotice(scaleStatus, projectId, floorId, options.onNavigate, canEditRole);
  const readFailure = useFloorLayerReadFailure(floorLayer, projectId, options.onNavigate);
  /*
   * Tầng thiếu tỷ lệ: bản vẽ và danh sách vẫn xem được, nhưng mọi hàm sửa và phím sửa tắt (UX-R1 r3).
   * PHẢI gọi SAU `useFloorLayer`: `useScaleLock` mượn hàm đọc N16 đã đăng ký trên khoá cache; gọi
   * trước thì hàm đọc mặc định thắng và đè cổng tiêm vào (story, bài kiểm) — xem `useFloorReview`.
   */
  const scaleLock = useScaleLock(projectId, floorId);
  const isScaleLocked = canEditRole && scaleLock.locked;
  const canEdit = canEditRole && !isScaleLocked;

  /*
   * Lần đọc ảnh nền THÀNH CÔNG gần nhất, giữ lại qua mọi lượt hỏng sau đó.
   *
   * `backgroundQuery.data` là `undefined` ngay khi lượt đọc hỏng, nên canvas
   * rơi về ô xám và người duyệt mất ảnh gốc đúng lúc cần nó nhất để đối chiếu.
   */
  const lastBackgroundRef = useRef<RoomLabelBackground | null>(null);

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
  const rooms = useMemo(() => roomsOfLevel(graph, levelId), [graph, levelId]);
  /* Nhãn phòng tính trên mọi phòng của tầng, nên không trùng dù mã BE hay mã A14 (B-V6-09). */
  const roomCodes = useMemo(() => displayCodesOf(rooms.map((room) => room.id)), [rooms]);
  const walls = useMemo(() => wallsOfLevel(graph, levelId), [graph, levelId]);
  const scale = useMemo(() => scaleOfLevel(level), [level]);

  /* ---------------------------------------------------------------------- */
  /* Đo phòng — CHỈ chạy lại khi hình học đổi.                                */
  /* ---------------------------------------------------------------------- */

  /*
   * Bộ nhớ đệm số đo, khoá bằng {@link outlineKeyOf}.
   *
   * Đây là chỗ lời hứa "đổi tên KHÔNG tính lại diện tích" được giữ. Một
   * `useMemo` khoá theo `rooms` không đủ: `commit` sinh một mảng phòng MỚI sau
   * mỗi lượt ghi, kể cả lượt chỉ đổi `name`, nên một memo như thế sẽ đo lại cả
   * mười bốn phòng sau mỗi lần đổi tên. Đệm theo ranh phòng thì lượt đổi tên
   * trả về ĐÚNG object số đo cũ — bài kiểm khẳng định bằng `toBe`.
   */
  const measuresRef = useRef(
    new Map<RoomId, { readonly key: string; readonly value: RoomLabelMeasures }>(),
  );

  const measures = useMemo(() => {
    const cache = measuresRef.current;
    const next = new Map<RoomId, RoomLabelMeasures>();

    for (const room of rooms) {
      const key = `${outlineKeyOf(room)}|${String(room.clearAreaM2)}|${scaleStatus ?? ''}|${scaleSource ?? ''}|${scaleState ?? ''}`;
      const cached = cache.get(room.id);

      if (cached !== undefined && cached.key === key) {
        next.set(room.id, cached.value);
        continue;
      }

      const value = measureRoom(room, scale, scaleStatus, scaleSource, scaleState);

      cache.set(room.id, { key, value });
      next.set(room.id, value);
    }

    return next;
  }, [rooms, scale, scaleSource, scaleState, scaleStatus]);

  /* ---------------------------------------------------------------------- */
  /* Nhắc công năng M-14 — NHẮC, không bao giờ CHẶN.                          */
  /* ---------------------------------------------------------------------- */

  const ruleRouteHref = useMemo(() => ROUTES.project.rules(projectId), [projectId]);

  const violations = useMemo(() => (graph === null ? [] : runRoomRules(graph)), [graph]);

  /* ---------------------------------------------------------------------- */
  /* Vòng hở — GỌI LẠI M-06, kèm kích thước khe hở.                           */
  /* ---------------------------------------------------------------------- */

  const detected = useMemo(() => detectRoomsOfLevel(walls, level), [level, walls]);
  const wallCodes = useMemo(() => displayCodesOf(walls.map((wall) => wall.id)), [walls]);
  const gaps = useMemo(() => gapsOf(detected, wallCodes), [detected, wallCodes]);

  /* ---------------------------------------------------------------------- */
  /* Dòng phòng và tóm tắt.                                                  */
  /* ---------------------------------------------------------------------- */

  const backgroundImageUrl = background?.imageUrl ?? null;
  const spillingRoomIds = useMemo(() => roomsSpillingOutside(rooms, walls), [rooms, walls]);

  const allRows = useMemo<readonly RoomLabelViewModel[]>(
    () =>
      rooms.map((room) =>
        toRoomLabelRow(room, {
          measures: measures.get(room.id) ?? measureRoom(room, scale, scaleStatus, scaleSource, scaleState),
          notices: noticesOfRoom(violations, room.id, ruleRouteHref).filter(
            /* G4a-30: tỷ lệ tạm thì diện tích chưa có, không nhắc "thiếu m²" trái với panel. */
            (notice) => scaleStatus === undefined || notice.ruleCode !== 'ROOM-AREA-BELOW-MINIMUM',
          ),
          backgroundImageUrl,
          scale,
          codes: roomCodes,
          outlineSpills: spillingRoomIds.has(room.id),
        }),
      ),
    [
      backgroundImageUrl,
      measures,
      roomCodes,
      rooms,
      ruleRouteHref,
      scale,
      scaleSource,
      scaleState,
      scaleStatus,
      spillingRoomIds,
      violations,
    ],
  );

  const summary = useMemo<RoomLabelSummaryViewModel>(
    () => summaryOf(rooms, violations, scaleStatus, scaleSource, scaleState),
    [rooms, scaleSource, scaleState, scaleStatus, violations],
  );

  /* Cờ Z/S-20: một phòng chiếm >80 % sàn thường là khung tên bản vẽ bị dò thành phòng (B1-9). */
  const oversizedRoom = useMemo(() => {
    const areas = rooms.map((room) => ({ id: room.id, areaM2: measures.get(room.id)?.areaM2 ?? room.areaM2 }));
    const total = areas.reduce((sum, room) => sum + room.areaM2, 0);
    const big = areas.length < 2 || total <= 0 ? undefined : areas.find((room) => room.areaM2 / total > OVERSIZED_ROOM_SHARE);

    return big === undefined
      ? null
      : { id: big.id, text: `Chiếm ${Math.round((big.areaM2 / total) * 100)} % sàn. Có thể là khung tên bản vẽ` };
  }, [measures, rooms]);
  const layerGate = useMemo(() => layerGateOf(graph, levelId), [graph, levelId]);
  /* Đếm trên MỌI phòng của tầng, không trên danh sách đang lọc "Chưa đặt tên". */
  const roomProgress = useMemo(
    () => ({ reviewed: allRows.filter((row) => row.status === 'confirmed').length, total: allRows.length }),
    [allRows],
  );

  const visibleRows = useMemo(
    () => applyUnnamedFilter(allRows, showOnlyUnnamed),
    [allRows, showOnlyUnnamed],
  );

  /* ---------------------------------------------------------------------- */
  /* Vùng chọn và rê chuột — kho dùng chung với canvas và danh sách.          */
  /* ---------------------------------------------------------------------- */

  const selectedRoomId = useMemo<RoomId | null>(() => {
    const last = selectedIds[selectedIds.length - 1];

    return last !== undefined && rooms.some((room) => room.id === last) ? (last as RoomId) : null;
  }, [rooms, selectedIds]);

  /* Nút "Duyệt tiếp" của cổng: phòng chưa duyệt kế tiếp, khác phòng đang chọn nếu còn. */
  const nextPendingRoom = useMemo(() => {
    const notYet = allRows.filter((row) => row.status !== 'confirmed');
    /* Cùng thứ tự với danh sách — chưa có tên trước. */
    const pending = byRoomReason(notYet);
    const next = pending.find((row) => row.id !== selectedRoomId) ?? pending[0];

    return next === undefined ? null : { id: next.id, codeLabel: next.codeLabel };
  }, [allRows, selectedRoomId]);

  const selectedRoom = useMemo<Room | null>(
    () => rooms.find((room) => room.id === selectedRoomId) ?? null,
    [rooms, selectedRoomId],
  );

  const onSelect = useCallback(
    (roomId: RoomId | null) => {
      setSelection(roomId === null ? [] : [roomId]);
    },
    [setSelection],
  );

  const onHover = useCallback(
    (roomId: RoomId | null) => {
      setHovered(roomId);
    },
    [setHovered],
  );

  /* ---------------------------------------------------------------------- */
  /* Tự lưu (A7) — không có nút lưu, và không bịa một lượt lưu đã xong.       */
  /* ---------------------------------------------------------------------- */

  const storePort = useMemo<RoomLabelGraphPort>(
    () => ({ read: () => useStore.getState().spatial }),
    [],
  );

  const { autosave, saveBlock } = useFloorLayerAutosave({
    projectId,
    floorId,
    ...(gateway.apiClient === undefined ? {} : { apiClient: gateway.apiClient }),
  });

  // Khối lưu đang chặn thì lời đọc cho trình đọc màn hình cũng nói "Chưa lưu…", không hứa tự lưu lại (U14).
  const indicator = useSaveIndicator(autosave, { failedLabel: saveBlock !== null ? SAVE_BLOCKED_LABEL : null });
  // G46: chữ trạng thái lưu cho người nhìn thấy (trước đây chỉ có aria-live). Chưa lưu lần nào thì không có chữ.
  const saveStatus =
    saveBlock !== null
      ? SAVE_BLOCKED_LABEL
      : indicator.state === 'saved' && autosave.getLastSavedAt() === undefined
        ? null
        : indicator.label;

  /* ---------------------------------------------------------------------- */
  /* Đường ghi — `dispatch` chạy qua `commit`, hoàn tác 100 bước của S-06.    */
  /* ---------------------------------------------------------------------- */

  const dispatchBundle = useMemo(
    () =>
      createRoomLabelDispatchDeps({
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

  const invalidate = useCallback(() => {
    applyInvalidation(queryClient, 'editWall', { floorId, projectId });
  }, [floorId, projectId, queryClient]);

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
    invalidate();
  }, [autosave, canEdit, dispatchBundle, invalidate, setSelection]);

  const onUndo = useCallback(() => {
    applyUndo();
  }, [applyUndo]);

  /**
   * Chạy một lệnh qua đủ năm bước, rồi MỜI HOÀN TÁC (A8).
   *
   * Vai Người xem không đi qua đây được: `canEdit` chặn ngay dòng đầu, nên
   * trạng thái 6 vô hiệu mọi hàm sửa ở tầng hook chứ không phải bằng cách ẩn
   * nút ở view.
   *
   * Loại thông báo là CHÍNH `command.type`, nên `notificationBus` gộp các lượt
   * cùng loại trong cửa sổ năm giây của nó — đổi tên năm phòng liên tiếp cho
   * một toast "hoàn tác 5 thay đổi", không phải năm toast chồng nhau. Cửa sổ
   * tám giây do chính vé mang (`UNDO_WINDOW_MS`), nên không một thời lượng nào
   * phải truyền ở đây (R-71).
   */
  const navigate = options.onNavigate;

  const onNavigateToWalls = useCallback(
    (wallId?: WallId) => {
      const path = ROUTES.project.walls(projectId, floorId);
      // G4a-39: the Walls screen reads `?wall=` and selects/zooms to that segment.
      navigate?.(wallId === undefined ? path : `${path}?wall=${encodeURIComponent(wallId)}`);
    },
    [floorId, navigate, projectId],
  );

  const run = useCallback(
    async (build: (context: CommandContext) => CommandResult | null): Promise<Command | null> => {
      const current = useStore.getState().spatial;

      if (!canEdit || current === null) {
        return null;
      }

      const built = build(commandContextOf(current, gateway.actorId));

      if (built === null) {
        return null;
      }

      /* Một lệnh bị từ chối phải NÓI RA vì sao (B-V7-08) — cổng đã soạn sẵn câu
         "Chưa gộp được: …"; nuốt nó thì người duyệt bấm xác nhận mà không thấy gì. */
      if (!built.ok) {
        const [title = '', ...rest] = built.error.reasons;
        notifications.publish({
          type: `${built.error.type}.refused`,
          title,
          description: rest.join(' '),
          // BUG-605: a refusal that says "Sang lớp tường" carries the way there.
          ...(title.includes('Sang lớp tường')
            ? { action: { label: 'Sang lớp tường', onClick: () => onNavigateToWalls() } }
            : {}),
        });

        return null;
      }

      const command = built.data;
      const result = await runRoomCommand(command, dispatchBundle);

      if (!result.ok) {
        notifications.publish({
          type: `${command.type}.refused`,
          title: result.error.message,
          description: result.error.reasons.join(' '),
        });

        return null;
      }

      invalidate();

      /* Vé giữ đúng bước của lệnh này, không "bước trên cùng" lúc bấm (BUG-579/582). */
      const entryId = newestEntryId(dispatchBundle.history);
      const ticket = createRoomLabelUndoTicket({
        description: command.description,
        now: gateway.now,
        undo: () => {
          const refused = undoIfNewest(dispatchBundle.history, entryId, applyUndo);

          if (refused !== null) {
            notifications.publish({ type: ROOM_UNDO_REFUSED_TYPE, title: refused, description: '' });
          }
        },
      });

      notifications.publish({
        type: command.type,
        title: ticket.description,
        description: '',
        undoTicket: ticket,
      });

      return command;
    },
    [applyUndo, canEdit, dispatchBundle, gateway, invalidate, notifications, onNavigateToWalls],
  );

  /* ---------------------------------------------------------------------- */
  /* Bốn hành động trên một phòng, cộng lượt duyệt.                           */
  /* ---------------------------------------------------------------------- */

  const roomById = useCallback(
    (roomId: RoomId): Room | null => rooms.find((room) => room.id === roomId) ?? null,
    [rooms],
  );

  const onRename = useCallback(
    (roomId: RoomId, name: string) => {
      /* U44: tên là một nhãn công năng thì công năng đổi theo (lệnh thứ hai, sau khi đổi tên xong). */
      const usage = usageOfRoomName(name);
      const before = roomById(roomId)?.usage;

      void run((context) => buildRenameRoomCommand({ roomId, name }, context)).then((renamed) => {
        if (renamed !== null && usage !== null && usage !== before) {
          void run((context) => buildChangeUsageCommand({ roomId, usage }, context));
        }
      });
    },
    [roomById, run],
  );

  const onChangeUsage = useCallback(
    (roomId: RoomId, usage: RoomUsage) => {
      void run((context) => buildChangeUsageCommand({ roomId, usage }, context));
    },
    [run],
  );

  /*
   * Gộp và tách: hình học tới từ M-06 chạy lại trên tường HIỆN TẠI, do cổng
   * suy ra (xem khối chú thích đầu `roomLabelReviewGateway.ts`). Hook chỉ
   * chuyền tay `walls`/`level`; không một phép hợp/cắt đa giác nào ở đây.
   */

  const onMerge = useCallback(
    (roomId: RoomId, otherRoomId: RoomId) => {
      void run((context) =>
        buildMergeRoomCommand({ targetRoomId: roomId, absorbedRoomId: otherRoomId }, context, walls, level),
      );
    },
    [level, run, walls],
  );

  const onSplit = useCallback(
    (roomId: RoomId, at: Point) => {
      const newRoomId = gateway.nextRoomId();

      void run((context) => buildSplitRoomCommandFromWalls({ roomId, newRoomId, at }, context, walls, level));
    },
    [gateway, level, run, walls],
  );

  const onApprove = useCallback(
    (roomId: RoomId) => {
      const room = roomById(roomId);

      /* Phòng chưa tên thì duyệt không đổi được trạng thái (vẫn "chưa đặt tên") — view tắt nút và nói vì sao (BUG-602).
         Đường bao tràn ra ngoài tường bao thì duyệt là sai (K10): chặn ở đây cho cả nút lẫn phím A. */
      if (room === null || room.reviewed || !hasRoomName(room) || spillingRoomIds.has(roomId)) {
        return;
      }

      void run(() => ok(buildApproveRoomCommand(room, gateway.actorId, roomCodes)));
    },
    [gateway, roomById, roomCodes, run, spillingRoomIds],
  );

  /* UX-18: một nút duyệt mọi phòng máy chắc chắn — MỘT bước hoàn tác (Ctrl+Z hoặc nút trên toast). */
  const confidentRooms = useMemo(
    () => confidentRoomsOf(rooms, spillingRoomIds),
    [rooms, spillingRoomIds],
  );

  const onApproveConfidentRooms = useCallback(() => {
    if (!canEdit || confidentRooms.length === 0) {
      return;
    }

    const label = approveConfidentRoomsLabelOf(confidentRooms.length);
    const commands = confidentRooms.map((room) => buildApproveRoomCommand(room, gateway.actorId, roomCodes));

    void runRoomTransaction(commands, dispatchBundle, label).then((result) => {
      if (!result.ok) {
        notifications.publish({ type: 'room.approveMany.refused', title: result.error.message, description: '' });

        return;
      }

      invalidate();
      const entryId = newestEntryId(dispatchBundle.history);
      const ticket = createRoomLabelUndoTicket({
        description: label,
        now: gateway.now,
        undo: () => {
          const refused = undoIfNewest(dispatchBundle.history, entryId, applyUndo);

          if (refused !== null) {
            notifications.publish({ type: ROOM_UNDO_REFUSED_TYPE, title: refused, description: '' });
          }
        },
      });

      notifications.publish({ type: 'room.approveMany', title: label, description: '', undoTicket: ticket });
    });
  }, [applyUndo, canEdit, confidentRooms, dispatchBundle, gateway, invalidate, notifications, roomCodes]);
  const canApproveConfidentRooms = canEdit && confidentRooms.length > 0;

  /* ---------------------------------------------------------------------- */
  /* Chuẩn hoá tên — XEM TRƯỚC rồi mới áp (CẤM TUYỆT ĐỐI).                    */
  /* ---------------------------------------------------------------------- */

  const hasNamesToNormalize = useMemo(() => buildNormalizePreview(rooms, roomCodes).changedCount > 0, [roomCodes, rooms]);

  const onOpenNormalizePreview = useCallback(() => {
    /* Dựng BẢNG, không phát lệnh: không một tên nào đổi ở bước này. */
    setNormalizePreview(buildNormalizePreview(rooms, roomCodes));
  }, [roomCodes, rooms]);

  const onCancelNormalize = useCallback(() => {
    setNormalizePreview(null);
  }, []);

  const onApplyNormalize = useCallback(() => {
    const preview = normalizePreview;

    if (preview === null) {
      return;
    }

    setNormalizePreview(null);
    /* MỘT lệnh mang nhiều thay đổi → MỘT mục hoàn tác, MỘT toast tám giây. */
    void run(() => {
      const command = buildNormalizeNamesCommand(rooms, preview, gateway.actorId);

      return command === null ? null : ok(command);
    });
  }, [gateway, normalizePreview, rooms, run]);

  /* ---------------------------------------------------------------------- */
  /* Bộ lọc, vòng hở, điều hướng, vỏ màn.                                     */
  /* ---------------------------------------------------------------------- */

  const onToggleUnnamedFilter = useCallback(() => {
    setShowOnlyUnnamed((previous) => !previous);
  }, []);

  const onToggleCollapsed = useCallback(() => {
    setOwnCollapsed((previous) => !previous);
  }, []);

  const refetchRoomLayer = floorLayer.refetch;

  /**
   * "Kiểm tra vòng hở" — đọc LẠI lớp phòng, rồi để M-06 chạy lại trên đồ thị mới.
   *
   * Phép dò là thuần và đã chạy trong một `useMemo` khoá theo tường, nên việc
   * duy nhất còn lại là làm mới nguyên liệu: một lượt đọc mới. Bấm lại khi
   * không có gì đổi thì cho đúng danh sách cũ — đúng, và trung thực.
   */
  const onCheckWallGaps = useCallback(() => {
    invalidate();
    refetchRoomLayer();
  }, [invalidate, refetchRoomLayer]);

  /* BUG-582: Mod+Z đi vào ngăn xếp của chính màn — cùng việc với "Hoàn tác" — không rơi xuống undo toàn cục. */
  useShortcut(
    {
      id: 'roomLabelReview.undo',
      combo: 'Mod+Z',
      scope: 'canvas',
      description: ROOM_LABEL_SCREEN_TEXT.undoShortcut,
      onTrigger: onUndo,
    },
    {
      ...(options.shortcutRegistry === undefined ? {} : { registry: options.shortcutRegistry }),
      enabled: canEdit,
    },
  );

  /* Impeccable A3: mũi tên đổi dòng chọn, A duyệt rồi sang phòng chưa duyệt kế tiếp. */
  const roomShortcutOptions = options.shortcutRegistry === undefined ? {} : { registry: options.shortcutRegistry };
  const listOrderRef = useRef(visibleRows);
  listOrderRef.current = visibleRows;
  const selectedRoomIdRef = useRef(selectedRoomId);
  selectedRoomIdRef.current = selectedRoomId;
  const stepRoom = (direction: 1 | -1): void => {
    const order = listOrderRef.current;
    const current = selectedRoomIdRef.current;
    const index = current === null ? -1 : order.findIndex((row) => row.id === current);
    const target = index === -1 ? order[direction === 1 ? 0 : order.length - 1] : order[index + direction];

    if (target !== undefined) {
      onSelect(target.id);
    }
  };
  const approveAndNext = (): void => {
    const current = selectedRoomIdRef.current;

    /* Phòng tràn đường bao: A không duyệt và không nhảy đi — người dùng ở lại đọc lý do (K10). */
    if (current === null || spillingRoomIds.has(current)) {
      return;
    }

    const order = listOrderRef.current;
    const start = order.findIndex((row) => row.id === current);
    const next = [...order.slice(start + 1), ...order.slice(0, Math.max(start, 0))].find(
      (row) => row.id !== current && row.status !== 'confirmed',
    );

    onApprove(current);

    if (next !== undefined) {
      onSelect(next.id);
    }
  };
  useShortcut(
    {
      id: 'roomLabelReview.arrowNext',
      combo: 'ArrowDown',
      scope: 'canvas',
      description: ROOM_LABEL_SCREEN_TEXT.arrowNextShortcut,
      allowRepeat: true,
      preventDefault: false,
      onTrigger: arrowStepHandler(() => stepRoom(1)),
    },
    roomShortcutOptions,
  );
  useShortcut(
    {
      id: 'roomLabelReview.arrowPrevious',
      combo: 'ArrowUp',
      scope: 'canvas',
      description: ROOM_LABEL_SCREEN_TEXT.arrowPreviousShortcut,
      allowRepeat: true,
      preventDefault: false,
      onTrigger: arrowStepHandler(() => stepRoom(-1)),
    },
    roomShortcutOptions,
  );
  useShortcut(
    {
      id: 'roomLabelReview.approveNext',
      combo: 'A',
      scope: 'canvas',
      description: ROOM_LABEL_SCREEN_TEXT.approveNextShortcut,
      onTrigger: approveAndNext,
    },
    { ...roomShortcutOptions, enabled: canEdit && selectedRoomId !== null },
  );
  /* Phím J = "phòng chưa duyệt kế" như màn tường (Tab bị cấm, A12): cùng việc nút "Duyệt tiếp" của cổng. */
  const nextPendingRoomId = nextPendingRoom?.id ?? null;
  useShortcut(
    {
      id: 'roomLabelReview.nextPending',
      combo: 'J',
      scope: 'canvas',
      description: 'Sang phòng chưa duyệt kế tiếp',
      onTrigger: () => {
        if (nextPendingRoomId !== null) {
          onSelect(nextPendingRoomId);
        }
      },
    },
    { ...roomShortcutOptions, enabled: nextPendingRoomId !== null },
  );
  /* A12: Esc bỏ chọn phòng như × "Bỏ chọn" của panel phải (cùng `onSelect(null)` như màn tường, đồ vật). Chỉ bật khi có phòng chọn. */
  useShortcut(
    {
      id: 'roomLabelReview.closeTopLayer',
      combo: 'Escape',
      scope: 'canvas',
      description: 'Bỏ chọn phòng',
      onTrigger: () => onSelect(null),
    },
    { ...roomShortcutOptions, enabled: selectedRoomId !== null },
  );

  /* ---------------------------------------------------------------------- */
  /* Bảy trạng thái và ba câu đi kèm.                                        */
  /* ---------------------------------------------------------------------- */

  const errorMessage = floorLayer.error === null ? null : floorLayer.errorMessage;

  const state = deriveRoomLabelScreenState({
    isViewerRole,
    isCollapsed,
    hasError: errorMessage !== null,
    isLoading: floorLayer.isPending,
    visibleRooms: visibleRows,
    unnamedCount: summary.unnamedCount,
  });

  /*
   * Bất biến #1: `emptyNotice` khác `null` ĐÚNG khi màn rỗng. Hai lý do rỗng,
   * hai câu — và cả hai câu nói ra bước đi tiếp.
   */
  const emptyFiltered = showOnlyUnnamed && allRows.length > 0;
  /* G41: vai Người xem ra `forbidden` trước `empty` — tầng không có phòng vẫn phải nghe câu rỗng. */
  const isEmptyView =
    state === 'empty' ||
    (state === 'forbidden' && errorMessage === null && !floorLayer.isPending && visibleRows.length === 0);
  const emptyNotice =
    isEmptyView
      ? emptyFiltered
        ? ROOM_LABEL_SCREEN_TEXT.emptyFilteredNotice
        : ROOM_LABEL_SCREEN_TEXT.emptyNotice
      : null;

  /* ---------------------------------------------------------------------- */
  /* Sáu trường thanh tra.                                                   */
  /* ---------------------------------------------------------------------- */

  const mergeCandidates = useMemo(
    () => mergeCandidatesOf(rooms, selectedRoomId, roomCodes),
    [roomCodes, rooms, selectedRoomId],
  );

  const splitPointMm = useMemo(
    () => splitPointOf(selectedRoom, walls, level),
    [level, selectedRoom, walls],
  );

  const areaCaption = useMemo(
    () => areaCaptionOf(selectedRoom ?? rooms[0] ?? null),
    [rooms, selectedRoom],
  );

  const backgroundImageSizeMm = useMemo(
    () =>
      background?.widthMm != null && background.heightMm != null && background.widthMm > 0 && background.heightMm > 0
        ? { widthMm: background.widthMm, heightMm: background.heightMm }
        : null,
    [background],
  );
  /* UX-08: đoạn đo của bước Tỷ lệ, vẽ lên bản vẽ để kỹ sư thấy số đã bám vào đâu. */
  const scaleSegment = useMemo(
    () => scaleSegmentOf(readSavedSegment(floorId), backgroundImageSizeMm),
    [backgroundImageSizeMm, floorId],
  );

  return {
    state,
    rooms: visibleRows,
    summary,
    gaps,
    selectedRoomId,
    hoveredRoomId: (hoveredId as RoomId | null) ?? null,
    showOnlyUnnamed,
    normalizePreview,
    hasNamesToNormalize,
    backgroundImageUrl,
    backgroundImageAlt: background?.imageAlt ?? '',
    backgroundImageSizeMm,
    scaleSegment,
    millimetresPerPixel: level?.scaleMillimetresPerPixel ?? UNCALIBRATED_SCALE,
    isCompact,
    isCollapsed,
    isViewerRole,
    viewerRoleNotice: isViewerRole ? ROOM_LABEL_SCREEN_TEXT.viewerRoleNotice : null,
    emptyNotice,
    errorMessage,
    isFloorWithoutRooms: errorMessage === null && !floorLayer.isPending && allRows.length === 0,

    nameSuggestions: ROOM_LABEL_NAME_SUGGESTIONS,
    usageOptions: ROOM_LABEL_USAGE_OPTIONS,
    areaCaption,
    mergeCandidates,
    splitPointMm,

    onRename,
    onChangeUsage,
    onMerge,
    onSplit,
    onApprove,
    approveConfidentRoomsLabel: canApproveConfidentRooms ? approveConfidentRoomsLabelOf(confidentRooms.length) : null,
    ...(canApproveConfidentRooms ? { onApproveConfidentRooms } : {}),
    onSelect,
    onHover,
    onOpenNormalizePreview,
    onApplyNormalize,
    onCancelNormalize,
    onToggleUnnamedFilter,
    onCheckWallGaps,
    onNavigateToWalls,
    onUndo,
    onToggleCollapsed,
    saveBlock,
    saveStatus,
    provisionalScaleNotice,
    readFailure,
    scaleLock: isScaleLocked
      ? {
          reason: scaleLock.reason ?? SCALE_LOCK_REASON,
          onOpenScale: navigate === undefined ? null : () => navigate(ROUTES.project.scale(projectId, floorId)),
        }
      : null,
    layerGate,
    oversizedRoom,
    roomProgress,
    nextPendingRoom,
    onOpenLayer:
      navigate === undefined
        ? null
        : (target: 'objects' | 'viewer') =>
            navigate(target === 'viewer' ? ROUTES.project.viewer(projectId) : ROUTES.project.objects(projectId, floorId)),
  };
}

/** Cổng có dữ liệu, xuất lại để story và bài kiểm cắm vào cùng một chỗ (R-73). */
export { createMockRoomLabelReviewGateway };
