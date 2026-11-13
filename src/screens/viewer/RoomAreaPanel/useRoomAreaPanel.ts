/**
 * Nửa "suy nghĩ" của màn S-33 "Bảng diện tích phòng" — nơi kho, tầng lệnh,
 * camera và bộ tự lưu gặp hợp đồng kiểu `roomAreaTypes.ts`.
 *
 * View thuần và kiểm được chỉ từ props (mục D của CLAUDE.md); mọi phép đọc,
 * mọi lượt ghi và mọi con số thành chuỗi xảy ra ở đây hoặc ở
 * `useRoomAreaPanel.model.ts`, KHÔNG ở view.
 *
 * ## Sáu thứ file này chịu trách nhiệm
 *
 * 1. **Dữ liệu tới từ KHO, không từ mạng.** Không endpoint nào trả về phòng
 *    (`ENDPOINTS` không có nhóm `room`), nên R-64 không có trạng thái máy chủ
 *    nào để cắm vào đây. `selectRoomsWithArea` và `selectTotalAreaM2` của
 *    `src/store/selectors.ts` là hai nguồn duy nhất, và cả hai đã memo hoá.
 * 2. **Tổng có ĐÚNG một nguồn.** Khi bộ chọn tầng đang mở hết, tổng là
 *    `selectTotalAreaM2` nguyên vẹn; khi lọc theo một tầng, tổng là
 *    `subtotalOf` — cùng `totalArea` của domain, cộng ở mm² rồi làm tròn một
 *    lần. Không chỗ nào trong màn cộng tay hai con số đã làm tròn.
 * 3. **Bảy trạng thái suy ra từ dữ liệu thật** — {@link deriveRoomAreaScreenState},
 *    một hàm thuần kiểm được không cần dựng hook. Không một `useState` nào
 *    đứng thay cho "đang tải": kho chưa có đồ thị, hoặc cổng nạp kho đang nạp
 *    (`state.spatialLoading`, B-V8-04), đã là sự thật đó.
 * 4. **Đổi tên đi qua lệnh nghiệp vụ, không qua một đường ghi tắt.**
 *    `createRenameRoomCommand` (S-07) dựng lệnh, `dispatch` chạy đủ năm bước,
 *    và bước "apply" của nó gọi `commit(patches, label)` — A10 giữ nguyên, và
 *    file này không gọi `set()` một lần nào.
 * 5. **Tự lưu 800 ms (A7).** Cửa sổ đó do `createAutosave` giữ
 *    (`DEFAULT_DEBOUNCE_MS`), nên con số không xuất hiện ở đây (R-71). Gõ tên
 *    xong để yên là lưu; không có nút Lưu nào được sinh ra.
 * 6. **Mọi thay đổi hoàn tác được kèm toast (A8)** — một vé tám giây do chính
 *    `createUndoTicket` mang cửa sổ, hoàn tác lấy từ ngăn xếp lịch sử thật.
 *
 * ## Ba chỗ THIẾU LOGIC, ghi ra thay vì bịa (R-69)
 *
 * - **Hover từ panel sang mô hình 3D chưa nối được.** `ViewerSceneHandle` có
 *   đúng sáu phương thức (`update`, `status`, `frameRate`, `frameEntities`,
 *   `preview`, `dispose`); không cái nào đổi được độ mờ nền một phòng, và
 *   `preview` chỉ nhận hình học chứ không nhận khung nhìn. Nên `hoveredRoomId`
 *   sống trong hook này và `onRoomHover` là một props THẬT — hàng trong panel
 *   vẫn sáng lên — còn phía 3D thì chưa nối, và điều đó được nói ra ở đây thay vì
 *   che bằng một chỗ trống giả vờ đã nối.
 * - **Thời lượng khuôn camera không truyền từ đây.** `frameEntities` không
 *   nhận thời lượng: `CameraDirector` bên trong nó đã dùng
 *   `PRESET_SETTINGS.transitionMs`. Truyền thêm một con số ở đây là viết lại
 *   một hằng đã có chủ.
 * - **Bộ chọn tầng của panel lọc BẢNG, không đổi tầng đang xem của Viewer3D.**
 *   Giá trị đầu lấy từ `state.activeFloorId` để hai nơi khởi động cùng một
 *   tầng, nhưng panel không ghi ngược vào kho: đổi tầng của cả khung nhìn 3D
 *   là việc của vỏ, không phải của một panel thanh tra.
 *
 * ## Trường container tự cung cấp
 *
 * Đúng MỘT: `onOpenExport` (sang S-34). Điều hướng cần router, mà hook phải
 * dựng được trong `renderHook` không cần `<MemoryRouter>` — nên kiểu trả về là
 * `Omit<RoomAreaPanelProps, 'onOpenExport'>` và container ghép nốt trường ấy.
 */

import { useCallback, useMemo, useRef, useState } from 'react';
import type { QueryClient } from '@tanstack/react-query';

import { AREA_DECIMALS } from '@/domain/rooms/area';
import type { EntityId, LevelId, RoomId } from '@/domain/spatial/types';
import { useCountUp } from '@/hooks/useCountUp';
import { useCommitFlash } from '@/hooks/useCommitFlash';
import { can } from '@/lib/auth/permissions';
import { createAutosave } from '@/lib/autosave/createAutosave';
import { createRenameRoomCommand } from '@/lib/commands/business/roomFloorCommands';
import { createHistoryStack } from '@/lib/commands/history';
import {
  createIncrementalRuleRunner,
  dispatch,
  type DispatchDeps,
} from '@/lib/commands/dispatch';
import type { Command } from '@/lib/commands/types';
import { createUndoTicket } from '@/lib/mutations/undoTicket';
import type { NotificationBus } from '@/lib/mutations/notificationBus';
import { appNotificationBus } from '@/hooks/useNotifications';
import { applyInvalidation } from '@/lib/query/invalidation';
import { scaleStateOf, type ScaleState } from '@/lib/viewmodel/provisionalScale';
import { useStore } from '@/store';
import { commit } from '@/store/commit';
import { selectRoomsWithArea, selectTotalAreaM2 } from '@/store/graphSelectors';
import type { ProjectRole } from '@/types/project';

import type { ViewerSceneHandle } from '../Viewer3D/viewer3dTypes';
import type {
  RoomAreaGrouping,
  RoomAreaMode,
  RoomAreaPanelProps,
  RoomAreaScreenState,
  RoomAreaSort,
} from './roomAreaTypes';
import {
  buildBands,
  buildGroups,
  buildTotals,
  collapseToLargest,
  deriveRoomAreaScreenState,
  graphOf,
  levelOptionsOf,
  subtotalOf,
  tableAsText,
  WHOLE_BUILDING_LABEL,
} from './useRoomAreaPanel.model';

/* -------------------------------------------------------------------------- */
/* Hằng số của màn.                                                            */
/* -------------------------------------------------------------------------- */

/**
 * Người thực hiện mặc định khi nơi ráp chưa truyền ai.
 *
 * Một chuỗi ĐẶT TÊN chứ không phải chuỗi rỗng, đúng lý do
 * `ROOM_LABEL_DEFAULT_ACTOR_ID` của màn anh em S-17 nêu: `validateCommands` từ
 * chối lệnh thiếu `actorId`, nên một mặc định rỗng sẽ làm mọi lượt đổi tên hỏng
 * ở bước `validate` thay vì hỏng ở chỗ người nối dây quên truyền.
 */
export const ROOM_AREA_DEFAULT_ACTOR_ID = 'room-area-editor';

/** Câu nói ra khi một lượt ghi hỏng mà không kèm lý do nào đọc được. */
const UNKNOWN_WRITE_FAILURE = 'Không lưu được tên phòng vừa sửa. Thử lại giúp tôi.';

/** Trạng thái mặc định của ba trục điều khiển. */
const DEFAULT_MODE: RoomAreaMode = 'panel';
const DEFAULT_GROUPING: RoomAreaGrouping = 'level';
const DEFAULT_SORT: RoomAreaSort = 'area';

/* -------------------------------------------------------------------------- */
/* Tham số.                                                                    */
/* -------------------------------------------------------------------------- */

export interface UseRoomAreaPanelOptions {
  /**
   * Vai của người dùng trên dự án.
   *
   * Vắng mặt là "CHƯA BIẾT vai", không phải "biết là không có quyền" — hai thứ
   * A11 phân biệt rõ, và `useViewer3D` đã chốt đúng cách đọc này. Panel chỉ vào
   * trạng thái `forbidden` khi `roles` đã tới VÀ vai đó không sửa được lớp.
   */
  readonly roles?: readonly ProjectRole[];
  /**
   * Tay cầm cảnh 3D, do nơi ráp truyền xuống — hook không tự đi tìm cảnh.
   *
   * Vắng mặt thì bấm một dòng vẫn CHỌN phòng (và cảnh tô sáng nó qua `update`
   * như mọi lựa chọn khác); chỉ riêng camera là đứng yên.
   */
  readonly scene?: ViewerSceneHandle | null;
  /** Panel đang thu gọn hay không — nút thu gọn thuộc về vỏ, không thuộc panel. */
  readonly isCollapsed?: boolean;
  /** Ép một trong bảy trạng thái, cho story và bài kiểm A11. */
  readonly forceState?: RoomAreaScreenState;
  /** Dự án đang mở; đi vào khoá làm mất hiệu lực cache sau một lượt đổi tên. */
  readonly projectId?: string;
  /**
   * Bộ nhớ đệm truy vấn của vỏ.
   *
   * Tuỳ chọn vì màn này KHÔNG đọc gì qua mạng (PQ-3): nó chỉ trả ơn những màn
   * khác đang giữ `space.byFloor` · `room.byFloor` · `violation.byProject` — đúng
   * ba khoá `editRoom` liệt kê. Vắng mặt thì không có cache nào để dọn, và hook
   * vẫn dựng được trong `renderHook` không cần `QueryClientProvider`.
   */
  readonly queryClient?: QueryClient;
  /** Chép bảng ra chữ. Mặc định ghi vào khay nhớ tạm của trình duyệt. */
  readonly copyText?: (text: string) => void;
  /** Ai đang thao tác — đi vào `Command.actorId` và nhật ký hoạt động. */
  readonly actorId?: string;
  /** Đồng hồ của vé hoàn tác; chỗ tiêm cho bài kiểm. */
  readonly now?: () => number;
  /** Kênh toast. Mặc định là kênh dùng chung của ứng dụng. */
  readonly notifications?: NotificationBus;
  /**
   * Sang chỗ soát khe hở tường — hành động của trạng thái rỗng.
   *
   * Nơi ráp cấp, hook chỉ chuyển tiếp: đích đến của nút này là một màn KHÁC,
   * và một hook của màn diện tích không được tự quyết chuyện điều hướng. Bắt
   * buộc chứ không tuỳ chọn — R-73 nói mỗi hành động phải có một sợi dây thật,
   * và một mặc định "không làm gì" sẽ là đúng thứ R-69 gọi là bản tạm.
   */
  readonly onCheckWallGaps: () => void;
}

/**
 * Mọi props của hai view, trừ đúng một trường container tự cung cấp.
 *
 * `RoomAreaTableProps` là tập con của kiểu này cộng `onOpenExport`, nên cùng
 * một model ghép thẳng vào cả hai chế độ mà không phải nắn lại lần nào.
 */
export type RoomAreaPanelModel = Omit<RoomAreaPanelProps, 'onOpenExport'>;

/* -------------------------------------------------------------------------- */
/* Khay nhớ tạm.                                                               */
/* -------------------------------------------------------------------------- */

/** Ghi vào khay nhớ tạm, im lặng khi trình duyệt không cho. */
const writeToClipboard = (text: string): void => {
  if (typeof navigator === 'undefined') {
    return;
  }

  void navigator.clipboard?.writeText(text);
};

/* -------------------------------------------------------------------------- */
/* Hook.                                                                       */
/* -------------------------------------------------------------------------- */

export function useRoomAreaPanel(options: UseRoomAreaPanelOptions): RoomAreaPanelModel {
  const roles = options.roles;
  const actorId = options.actorId ?? ROOM_AREA_DEFAULT_ACTOR_ID;
  const notifications = options.notifications ?? appNotificationBus;
  const now = options.now ?? Date.now;

  /* ---- Đọc kho ----------------------------------------------------------- */

  const spatial = useStore((state) => state.spatial);
  const floorMeta = useStore((state) => state.floorMeta);
  const spatialLoading = useStore((state) => state.spatialLoading);
  const entries = useStore(selectRoomsWithArea);
  const storeTotalM2 = useStore(selectTotalAreaM2);
  const storeFloorId = useStore((state) => state.activeFloorId);
  const select = useStore((state) => state.select);
  const setSelection = useStore((state) => state.setSelection);

  const canEdit = useMemo(
    () => can('edit', 'layer', roles === undefined ? {} : { roles }),
    [roles],
  );

  /* ---- Ba trục điều khiển ------------------------------------------------ */

  const [mode, setMode] = useState<RoomAreaMode>(DEFAULT_MODE);
  const [grouping, setGrouping] = useState<RoomAreaGrouping>(DEFAULT_GROUPING);
  const [sort, setSort] = useState<RoomAreaSort>(DEFAULT_SORT);
  const [pickedLevelId, setPickedLevelId] = useState<LevelId | null>(null);
  const [hoveredRoomId, setHoveredRoomId] = useState<RoomId | null>(null);
  const [renamedRoomId, setRenamedRoomId] = useState<RoomId | null>(null);

  /**
   * Lý do lượt ghi gần nhất không thành, bằng tiếng Việt của chính tầng lệnh.
   *
   * KHÔNG phải một cờ `error` tự chế đứng thay cho trạng thái máy chủ — thứ
   * `useShareLinks.ts` làm và CLAUDE.md gọi là ngoại lệ đi trước. Ở màn này
   * không có lượt đọc máy chủ nào để hỏng; thứ duy nhất hỏng được là một lượt
   * GHI, và đây là kết quả thật của nó, do `CommandRefusal.reasons` hoặc
   * `DispatchFailure` viết ra.
   */
  const [writeFailure, setWriteFailure] = useState<string | null>(null);

  const activeLevelId = pickedLevelId ?? storeFloorId;

  /* ---- Dựng dữ liệu hiển thị --------------------------------------------- */

  /* R10 làn S: mọi m² và mét của bảng này suy từ tỷ lệ — mang trạng thái tỷ lệ TỪNG TẦNG vào theo. */
  const scaleStates = useMemo<Readonly<Record<string, ScaleState>>>(() => {
    const out: Record<string, ScaleState> = {};
    for (const [floorId, meta] of Object.entries(floorMeta)) {
      if (meta === undefined) continue;
      if (meta.scaleStatus === undefined && meta.scaleState === undefined) continue;
      out[floorId] = scaleStateOf(meta.scaleStatus, meta.scaleSource, meta.scaleState);
    }
    return out;
  }, [floorMeta]);
  const graph = useMemo(() => graphOf(spatial, scaleStates), [scaleStates, spatial]);

  const visibleEntries = useMemo(
    () =>
      activeLevelId === null
        ? entries
        : entries.filter((entry) => entry.room.levelId === activeLevelId),
    [activeLevelId, entries],
  );

  const levels = useMemo(() => levelOptionsOf(entries, graph), [entries, graph]);

  const missingLevelNames = useMemo(
    () => levels.filter((level) => !level.hasArea).map((level) => level.name),
    [levels],
  );

  /* ---- Bảy trạng thái, suy ra TRƯỚC danh sách ----------------------------- */

  /*
   * Trạng thái đứng trước `groups` vì trạng thái `collapsed` ĐỔI danh sách:
   * tấm trượt thu gọn hiện năm phòng lớn nhất toàn màn chứ không phải mọi
   * nhóm. Không vòng phụ thuộc nào ở đây — cả bảy nhánh của
   * `deriveRoomAreaScreenState` đọc số phòng, số tầng thiếu và vai, không nhánh
   * nào đọc `groups`.
   */
  const unnamedCount = useMemo(
    () => visibleEntries.filter((entry) => entry.room.name.trim() === '').length,
    [visibleEntries],
  );

  const derivedState = deriveRoomAreaScreenState({
    isViewerRole: roles !== undefined && !canEdit,
    hasWriteFailure: writeFailure !== null,
    spatialLoaded: spatial !== null && !spatialLoading,
    isCollapsed: options.isCollapsed === true,
    visibleRoomCount: visibleEntries.length,
    unnamedCount,
    missingLevelCount: missingLevelNames.length,
  });

  const state = options.forceState ?? derivedState;

  /*
   * Thu gọn thì `groups` là MỘT nhóm gồm năm phòng lớn nhất toàn màn — một phép
   * CHỌN, và chọn thì thuộc hook (PQ-7). View không làm thay được: `areaRatio`
   * là tỷ lệ trong nhóm nên hai hàng khác nhóm không so được với nhau.
   */
  const groups = useMemo(
    () =>
      state === 'collapsed'
        ? collapseToLargest(visibleEntries, graph)
        : buildGroups(visibleEntries, grouping, sort, graph),
    [graph, grouping, sort, state, visibleEntries],
  );

  const bands = useMemo(() => buildBands(visibleEntries), [visibleEntries]);

  /*
   * Tổng: MỘT nguồn cho mỗi phạm vi. Không lọc gì thì lấy nguyên
   * `selectTotalAreaM2` — bản đã memo hoá của kho, cộng ở mm² và làm tròn đúng
   * một lần. Có lọc thì `subtotalOf` chạy CÙNG hàm `totalArea` trên tập hẹp
   * hơn. Hai nhánh, một phép cộng, không nhánh nào cộng lại các số đã tròn.
   */
  const totalM2 =
    visibleEntries.length === entries.length ? storeTotalM2 : subtotalOf(visibleEntries);

  /*
   * Chạy số khi đổi tầng. `useCountUp` tự dùng slot `standard` (260 ms) — đặc
   * tả viết 240 ms, con số đó không tồn tại trong thang chuyển động (PQ-1), và
   * hook engine đã ghi lại đúng quyết định này trong docblock của nó.
   */
  const runningTotal = useCountUp(totalM2, { format: { fractionDigits: AREA_DECIMALS } });

  const scopeLabel = useMemo(
    () => levels.find((level) => level.id === activeLevelId)?.name ?? WHOLE_BUILDING_LABEL,
    [activeLevelId, levels],
  );

  const totals = useMemo(
    () =>
      buildTotals({
        totalM2,
        totalText: runningTotal.text,
        scopeLabel,
        roomCount: visibleEntries.length,
      }),
    [runningTotal.text, scopeLabel, totalM2, visibleEntries.length],
  );

  /* ---- Đường ghi: dispatch năm bước, apply gọi `commit` ------------------- */

  const history = useMemo(() => createHistoryStack(), []);
  const commitLabelRef = useRef('');
  const selectionBeforeRef = useRef<readonly EntityId[]>([]);

  const deps = useMemo<DispatchDeps>(
    () => ({
      spatial: {
        read: () => useStore.getState().spatial,
        /* Dòng DUY NHẤT của màn chạm tới kho, và nó đi qua `commit` chứ không
           qua `set()` (A10). Nhãn là mô tả của chính lệnh, nên nút hoàn tác và
           nhật ký hoạt động đọc cùng một câu. */
        applyPatches: (patches) => {
          commit(patches, commitLabelRef.current);
        },
      },
      history: {
        push: (entry) => {
          history.push({
            entry,
            selectionBefore: { selectedIds: selectionBeforeRef.current },
            selectionAfter: { selectedIds: useStore.getState().selectedIds },
          });
        },
        drop: (entryId) => {
          history.drop(entryId);
        },
      },
      rules: createIncrementalRuleRunner(),
      /* Hàng đợi gửi đi rỗng vì KHÔNG có endpoint nào nhận phòng (PQ-3): lượt
         ghi đã nằm trong kho, và giả vờ xếp hàng gửi đi sẽ là một lời hứa sai. */
      sync: { enqueue: () => undefined },
    }),
    [history],
  );

  const applyUndo = useCallback(() => {
    const transition = history.undo();

    if (transition === null) {
      return;
    }

    commitLabelRef.current = transition.step.label;
    deps.spatial.applyPatches(transition.patches);
    setSelection([...transition.selection.selectedIds]);
  }, [deps, history, setSelection]);

  const invalidate = useCallback(() => {
    const queryClient = options.queryClient;
    const projectId = options.projectId;
    const floorId = activeLevelId ?? storeFloorId;

    if (queryClient === undefined || projectId === undefined || floorId === null) {
      return;
    }

    applyInvalidation(queryClient, 'editRoom', { floorId, projectId });
  }, [activeLevelId, options.projectId, options.queryClient, storeFloorId]);

  /**
   * Chạy một lệnh qua đủ năm bước, rồi MỜI HOÀN TÁC (A8).
   *
   * Vai chỉ xem không đi qua đây được: `canEdit` chặn ngay dòng đầu, nên trạng
   * thái 6 vô hiệu hoá lượt ghi ở tầng hook chứ không phải bằng cách giấu ô
   * nhập ở view. Cửa sổ tám giây do chính vé mang (`UNDO_WINDOW_MS`), nên không
   * một thời lượng nào phải truyền ở đây (R-71).
   */
  const runCommand = useCallback(
    async (command: Command): Promise<boolean> => {
      selectionBeforeRef.current = useStore.getState().selectedIds;
      commitLabelRef.current = command.description;

      const result = await dispatch(command, deps);

      if (!result.ok) {
        setWriteFailure(result.error.reasons[0] ?? result.error.message);

        return false;
      }

      invalidate();

      const ticket = createUndoTicket({
        description: command.description,
        now,
        undo: applyUndo,
      });

      notifications.publish({
        type: command.type,
        title: ticket.description,
        description: '',
        undoTicket: ticket,
      });

      return true;
    },
    [applyUndo, deps, invalidate, notifications, now],
  );

  /* ---- Sửa tên trong dòng → tự lưu 800 ms → nháy dòng -------------------- */

  const pendingRef = useRef(new Map<RoomId, string>());

  /**
   * Áp những tên đang chờ.
   *
   * Một lệnh cho MỖI phòng, đúng như S-07 định nghĩa: `room.rename` đổi tên một
   * phòng, và gộp nhiều phòng vào một lệnh sẽ là một lệnh thứ năm không ai
   * viết. Lệnh bị từ chối thì tên vẫn nằm lại trong hàng chờ, để `onRetry` gửi
   * lại chính nó thay vì bắt người dùng gõ lại.
   */
  const savePending = useCallback(
    async (pending: ReadonlyMap<RoomId, string>): Promise<void> => {
      const graphNow = useStore.getState().spatial;

      if (!canEdit || graphNow === null) {
        return;
      }

      for (const [roomId, name] of pending) {
        const built = createRenameRoomCommand({ roomId, name }, { graph: graphNow, actorId });

        if (!built.ok) {
          setWriteFailure(built.error.reasons[0] ?? UNKNOWN_WRITE_FAILURE);
          continue;
        }

        if (await runCommand(built.data)) {
          pendingRef.current.delete(roomId);
          setRenamedRoomId(roomId);
        }
      }
    },
    [actorId, canEdit, runCommand],
  );

  /*
   * Cửa sổ 800 ms của A7 do `createAutosave` giữ; con số không viết ở đây
   * (R-71), và không một `setTimeout` nào của màn đếm nó. Bản hook
   * `useAutosave` theo dõi `state.spatial` — đúng tín hiệu cho một lượt lưu lên
   * máy chủ, sai tín hiệu ở đây, vì cái đang chờ là một cái tên CHƯA vào kho.
   */
  const savePendingRef = useRef(savePending);
  savePendingRef.current = savePending;

  const autosave = useMemo(
    () =>
      createAutosave<ReadonlyMap<RoomId, string>>({
        getChanges: () =>
          pendingRef.current.size === 0 ? undefined : new Map(pendingRef.current),
        save: (pending) => savePendingRef.current(pending),
      }),
    [],
  );

  const onRoomRename = useCallback(
    (roomId: RoomId, name: string) => {
      pendingRef.current.set(roomId, name);
      autosave.notifyChange();
    },
    [autosave],
  );

  /*
   * Dòng nháy một nhịp sau khi lưu xong. `useCommitFlash` bật lên sau BẤT KỲ
   * lượt ghi nào, nên nó phải đi cùng mã phòng mà chính màn này vừa đổi tên —
   * một lượt ghi của màn khác không được làm dòng ở đây nháy.
   */
  const isFlashing = useCommitFlash();
  const flashedRoomId = isFlashing ? renamedRoomId : null;

  /* ---- Bấm một dòng: chọn phòng + khuôn camera (R-07) -------------------- */

  const scene = options.scene;

  const onRoomActivate = useCallback(
    (roomId: RoomId) => {
      /* 1. Chọn thật — phòng vào `selectedIds`, và cảnh tô sáng nó khi vỏ đẩy
         khung nhìn mới xuống `handle.update`. Không có API "tô sáng không kèm
         chọn" trên `ViewerSceneHandle`, nên đây là con đường có sẵn. */
      select(roomId);

      /* 2. Khuôn camera — `CameraDirector.frameObjects` của R-07 chạy trên
         chính cây lưới đã dựng, và tự dùng `PRESET_SETTINGS.transitionMs`. */
      scene?.frameEntities([roomId]);
    },
    [scene, select],
  );

  const onRetry = useCallback(() => {
    setWriteFailure(null);
    autosave.notifyChange();
  }, [autosave]);

  const copyText = options.copyText ?? writeToClipboard;

  const onCopyAsText = useCallback(() => {
    copyText(tableAsText(groups, totals));
  }, [copyText, groups, totals]);

  return {
    state,
    groups,
    totals,
    sort,
    onSortChange: setSort,
    mode,
    onModeChange: setMode,
    hoveredRoomId,
    onRoomHover: setHoveredRoomId,
    onRoomActivate,
    onRoomRename,
    flashedRoomId,
    errorMessage: state === 'error' ? (writeFailure ?? UNKNOWN_WRITE_FAILURE) : '',
    onRetry,
    onCheckWallGaps: options.onCheckWallGaps,
    levels,
    activeLevelId,
    onLevelChange: setPickedLevelId,
    grouping,
    onGroupingChange: setGrouping,
    bands,
    missingLevelNames,
    onCopyAsText,
  };
}
