/**
 * Hook của màn `MeasurementTool`: nối lại logic đã có, không phát minh thêm cái nào.
 *
 * Mỗi việc dưới đây đã có chủ, và hook chỉ đưa dữ liệu đi qua đúng chủ của nó:
 *
 * | Việc | Ai làm |
 * |---|---|
 * | Chrome, camera, ray tầng, ray công cụ, panel phải | `useViewerShell` của vỏ |
 * | Bắn tia, gạn nhịp, phân biệt kéo với chấm | `createScenePick` + `createPointerPicker` (R-09) |
 * | Bắt điểm | `snapToTargets` của `src/domain/units/snap` (M-03) |
 * | Bốn phép đo | `measureDistance` · `measurePointToPlane` · `measureHeight` · `measurePolygonArea` |
 * | Mét → milimét | `metresToMillimetres` của `src/domain/units` |
 * | Số thành chuỗi | `formatLength` · `formatArea` · `formatNumber` (A15) |
 * | Phím tắt | `useShortcut` → `shortcutRegistry` (R-54, A12, R-72) |
 * | `isLoading` / `error` | `useQuery` / `useMutation` (R-64) |
 * | Vé hoàn tác | `deleteMeasurement` → `createUndoTicket` (A8, D-05) |
 * | Trạng thái công cụ | `reduceTool` của S-08 |
 *
 * Không một phép đo, một phép quy đổi đơn vị hay một phép làm tròn nào được viết
 * mới ở đây (R-61). Phần số học thuần nằm ở `measurementToolViewModel.ts`, phần
 * mạng và phần dựng mồi bắt điểm nằm ở `measurementToolGateway.ts`.
 *
 * ## Hook TỰ LẮP cảnh, và view vẫn là một lớp phủ
 *
 * `MeasurementToolProps` không có `canvasRef`: `MeasurementTool.tsx` là lớp nổi
 * `pointer-events-none`, và nó không dựng canvas nào. Canvas do chính
 * `renderScene` của hook dựng, nằm NGAY DƯỚI lớp phủ ấy, `aria-hidden` và
 * không nhận con trỏ — nên mọi cử chỉ vẫn đi qua đúng một đường
 * (`onViewportPointerMove/Down/Up` của vỏ) và không có hai nguồn sự kiện tranh
 * nhau trả lời một cú chấm.
 *
 * Cảnh lắp lên canvas ấy qua {@link useMeasurementToolScene}, đúng khuôn
 * `useExplodedView`: hook có `levels` (đồ thị → `toBuildFloorInput`) và có
 * `frame` (thứ `useViewerShell` trả về), còn container thì không — bắt container
 * tự lắp là bắt nó dựng lại nửa cái hook này.
 *
 * {@link UseMeasurementToolOptions.scene} Ở LẠI và vẫn THẮNG cảnh tự lắp: nó là
 * đường tiêm của bài kiểm, cùng `pick` và `projectToScreen`. Vắng cảnh — chưa có
 * canvas, chưa có tầng nào dựng được, hay máy không có WebGL — thì không chấm
 * được điểm và `screenPoints` là `null`, còn danh sách, đổi đơn vị, ẩn hiện, xoá
 * và hoàn tác vẫn chạy đủ. Không ném lỗi, không màn trắng (A11).
 *
 * ## `M` thuộc về VỎ, và chỉ vỏ
 *
 * `buildViewerShortcuts` đã giữ `M` ở phạm vi `canvas` với mã
 * `viewer.tool.measure`. Màn này KHÔNG đăng ký `M` lần thứ hai: hai người trả
 * lời một phím là đúng thứ `findOverlaps()` kể tên, và một cảnh báo đúng thì
 * cách xử là bỏ bớt một người đăng ký, không phải xếp cho ai trả lời trước.
 *
 * `onToggleTool` vẫn đi xuống view và vẫn có nút gọi tới nó (A12: bàn phím là
 * đường hạng nhất, không phải đường duy nhất) — chỉ là nó không còn tự đăng ký
 * phím nữa. "Công cụ đang bật" đọc từ `shell.activeToolId`.
 *
 * ## `Esc` ở phạm vi `canvas`, và chỉ ở đó
 *
 * `SCOPE_PRIORITY` xếp `dialog` trước `canvas`, nên một hộp thoại đang mở vẫn
 * nuốt `Escape` trước màn đo — đúng lời hứa A12 mà không tính năng nào được lấy
 * đi. Đăng ký nó ở `global` hay `dialog` sẽ cướp mất `closeTopLayer`.
 *
 * ## Bộ đệm điểm KHÔNG phải một máy trạng thái thứ hai
 *
 * `reduceTool` giữ pha cử chỉ của S-08 (`activate` / `cancel`), và nó là chỗ duy
 * nhất giữ pha ấy. Nó KHÔNG giữ được các điểm đã chấm của màn này:
 * `MEASURE_TOOL` của `src/lib/tools/tools.ts` khai đúng HAI bước `point` và
 * `complete` của nó luôn gọi `measureDistance` — nên chế độ "diện tích mặt sàn"
 * (từ ba điểm trở lên) không đi lọt qua nó, còn "chiều cao" và "vuông góc" sẽ
 * nhận về một khoảng cách thẳng thay vì phép đo của chúng. Một danh sách điểm
 * không phải một máy trạng thái; nó là dữ liệu của cử chỉ mà S-08 chưa có từ
 * vựng để mang.
 */

import { createElement, Fragment, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { ReactNode } from 'react';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import type { MeasurePoint } from '@/domain/measure/measure';
import type { NormalizedSpatial } from '@/domain/spatial/normalize';
import type { LevelId } from '@/domain/spatial/types';
import { appNotificationBus } from '@/hooks/useNotifications';
import { useShortcut, useShortcutListener } from '@/hooks/useShortcut';
import type { NotificationBus } from '@/lib/mutations/notificationBus';
import { deleteMeasurement, saveMeasurement } from '@/lib/mutations/measurement';
import type { UndoTicket } from '@/lib/mutations/undoTicket';
import { MOTION_DURATIONS_MS } from '@/lib/motion/tokens';
import { measurementKeys } from '@/lib/query/queryKeys';
import type { ShortcutRegistry } from '@/lib/input/shortcutRegistry';
import { createPointerPicker, createScenePick, type PickAt } from '@/lib/three/interaction/raycast';
import { TOOLS } from '@/lib/tools/tools';
import {
  createToolState,
  reduceTool,
  DEFAULT_TOOL_SETTINGS,
  type ToolContext,
  type ToolEvent,
  type ToolMachineState,
} from '@/lib/tools/toolMachine';
import type { MeasurementRecord } from '@/types/measurement';
import type { ProjectRole } from '@/types/project';
import { ROUTES } from '@/routes/paths';
import { SCALE_SEVERITY, scaleStateOf, type ScaleState } from '@/lib/viewmodel/provisionalScale';
import { useStore } from '@/store';
// Nhập THẲNG module thay vì qua cửa nhập của ViewerShell — xem ghi chú cùng
// lý do trong `useMeasurementToolScene.ts`.
import {
  createViewerShellGateway,
  type ViewerShellGateway,
} from '@/screens/viewer/ViewerShell/viewerShellGateway';
import { BUILDING_MESSAGE, useViewerShell } from '@/screens/viewer/ViewerShell/useViewerShell';
import type {
  ViewerPointPx,
  ViewerScreenState,
  ViewerShellProps,
} from '@/screens/viewer/ViewerShell/viewerShellTypes';

import { MeasurementList } from './MeasurementList';
import { MeasurementTool } from './MeasurementTool';
import type { MountMeasurementScene } from './measurementToolScene';
import {
  createMeasurementHttpClient,
  createMeasurementToolGateway,
  formatMeasurementRow,
  INITIAL_MEASURE_UNIT,
  measurementCountLabel,
  measurementErrorCodeOf,
  type MeasurementToolHttpGateway,
  nextMeasurementIdentity,
  NO_SNAP_LABEL,
  snapIndicatorOf,
  snapMeasurePoint,
  snapTargetsOf,
  toMeasurementRecord,
  toMeasurementRowCore,
} from './measurementToolGateway';
import type {
  DraftMeasurement,
  MeasurementScreenState,
  MeasurementToolGateway,
  MeasurementToolProps,
  MeasureMode,
  MeasureUnit,
  PinnedMeasurement,
  PinnedMeasurementId,
  ScreenPoint,
  SnapIndicator,
} from './measurementToolTypes';
import { useMeasurementToolScene } from './useMeasurementToolScene';
import {
  attemptMeasure,
  projectAll,
  projectorFor,
  rawValueOf,
  REQUIRED_POINTS,
  toMeasurePoint,
  viewerStateOf,
  type MeasurementScene,
  type MeasurePick,
  type ScreenProjector,
} from './measurementToolViewModel';

/* -------------------------------------------------------------------------- */
/* Hằng số.                                                                    */
/* -------------------------------------------------------------------------- */

/** Mã binding — cái tên mà cảnh báo trùng phím của registry in ra. */
const ESCAPE_ID = 'measurementTool.draft.cancel';
const PIN_ID = 'measurementTool.draft.pin';
const DELETE_ID = 'measurementTool.list.delete';

const ESCAPE_COMBO = 'Escape';
const PIN_COMBO = 'Enter';
const DELETE_COMBO = 'Delete';

/** Câu tiếng Việt cho bảng phím tắt, viết thường kiểu câu (A6). */
const ESCAPE_DESCRIPTION = 'Bỏ phần đường đo dở dang, vẫn ở chế độ đo';
const PIN_DESCRIPTION = 'Ghim phép đo đang đọc';
const DELETE_DESCRIPTION = 'Xoá phép đo đang chọn';

/**
 * Công cụ đo, và công cụ mỗi bên trả về khi tắt.
 *
 * Hai cái tên "tắt" khác nhau vì hai bảng công cụ khác nhau: ray trái của vỏ
 * dùng `ViewerToolId` (`'orbit'` là công cụ mặc định của nó), còn máy công cụ
 * S-08 dùng `ToolId` (`'select'` là công cụ mặc định của nó). `'measure'` là ô
 * duy nhất hai bảng cùng có, và đó là ô màn này sống trong.
 */
const MEASURE_TOOL_ID = 'measure';
const IDLE_SHELL_TOOL_ID = 'orbit';
const IDLE_MACHINE_TOOL_ID = 'select';

/** Trạng thái 4: tia trúng một bề mặt không mang pháp tuyến nào. */
const NO_SURFACE_MESSAGE =
  'Chưa bắt được bề mặt để đo vuông góc. Hãy chấm lại vào một mặt tường hoặc mặt sàn.';

/** Trạng thái 4: lượt tải danh sách hỏng. */
const LOAD_ERROR_MESSAGE =
  'Chưa tải được danh sách phép đo của dự án. Kiểm tra kết nối rồi thử lại.';

/** Câu khi mọi tầng dựng hỏng — cảnh không có gì để chấm (NO-385). */
const SCENE_FAILED_MESSAGE = 'Chưa dựng được mô hình để đo. Bấm thử lại để dựng lại.';

/** Trạng thái 6: có quyền xem, không có quyền ghim. */
const PIN_BLOCKED_CAPTION =
  'Bạn chỉ có quyền xem dự án này, nên chưa ghim được phép đo. Vẫn đo và đọc số bình thường.';

/** Câu của toast hoàn tác — cửa sổ tám giây do chính vé mang (`UNDO_WINDOW_MS`). */
const DELETE_NOTIFICATION_TYPE = 'measurementTool.deleteMeasurement';

/** Câu lỗi theo mã máy chủ — người dùng KHÔNG bao giờ thấy mã trần. */
const MEASUREMENT_ERROR_TEXT: Readonly<Record<string, string>> = {
  MEASUREMENT_LIMIT_REACHED:
    'Dự án đã chạm giới hạn số phép đo; hãy xoá bớt phép đo cũ rồi ghim lại',
  MEASUREMENT_ID_TAKEN: 'Mã phép đo vừa bị một phiên khác dùng; hãy ghim lại',
  FORBIDDEN: 'Bạn không có quyền ghim phép đo trong dự án này',
};
const PIN_FAILED_TEXT = 'Chưa ghim được phép đo, hãy thử lại';
const DELETE_FAILED_TEXT = 'Chưa xoá được phép đo, hãy thử lại';
const DELETE_GONE_TEXT = 'Phép đo này đã bị xoá ở nơi khác';
const DELETE_FORBIDDEN_TEXT = 'Bạn không có quyền xoá phép đo trong dự án này';
const UNDO_FAILED_TEXT = 'Chưa hoàn tác được việc xoá phép đo';

const PIN_ERROR_NOTIFICATION_TYPE = 'measurementTool.pinFailed';
const DELETE_ERROR_NOTIFICATION_TYPE = 'measurementTool.deleteFailed';
const UNDO_ERROR_NOTIFICATION_TYPE = 'measurementTool.undoFailed';

/** Không có phép đo nào. */
const NO_ROWS: readonly PinnedMeasurement[] = Object.freeze([]);
const NO_RECORDS: readonly MeasurementRecord[] = Object.freeze([]);
const NO_PICKS: readonly MeasurePick[] = Object.freeze([]);
const NO_HIDDEN: ReadonlySet<PinnedMeasurementId> = new Set<PinnedMeasurementId>();
const NO_SCREEN_POINTS: readonly ScreenPoint[] = Object.freeze([]);

/** Chip lúc chưa có con trỏ nào trên khung nhìn — vẫn gọi tên tình trạng. */
const IDLE_SNAP: SnapIndicator = Object.freeze({ kind: null, label: NO_SNAP_LABEL });

/** Mã tầng rỗng: máy công cụ chưa dựng được gì khi đồ thị chưa tới. */
const NO_LEVEL_ID = '';

/**
 * Ngữ cảnh của máy công cụ S-08.
 *
 * `reduceTool` chỉ đọc `context` khi một bước cử chỉ được điền, và hook này chỉ
 * gửi `activate`/`cancel` — hai sự kiện không chạm tới nó. Ngữ cảnh vẫn phải có
 * thật vì kiểu đòi, nên nó là một hằng: công cụ đo có `creates: null` nên
 * `nextId` không bao giờ được gọi, và gọi nó là một lỗi lập trình chứ không
 * phải một ca người dùng.
 */
const TOOL_CONTEXT: ToolContext = {
  levelId: NO_LEVEL_ID as LevelId,
  settings: DEFAULT_TOOL_SETTINGS,
  nextId: (): never => {
    throw new Error('Màn đo không tạo thực thể nào, nên không có mã nào để cấp.');
  },
};

/* -------------------------------------------------------------------------- */
/* Tuỳ chọn.                                                                   */
/* -------------------------------------------------------------------------- */

export interface UseMeasurementToolOptions {
  readonly projectId: string;
  /** Cổng riêng của màn. Vắng mặt thì hook dựng cổng THẬT đi ra mạng. */
  readonly gateway?: MeasurementToolGateway;
  /** Cổng của vỏ. Vắng mặt thì hook dựng cổng THẬT đọc kho. */
  readonly shellGateway?: ViewerShellGateway;
  /** Đồ thị tiêm cho story/bài kiểm; vắng mặt thì đọc kho. */
  readonly spatial?: NormalizedSpatial | null;
  /** Vai người xem. Vắng mặt KHÔNG vào `forbidden` — "chưa biết vai" khác "không có quyền". */
  readonly roles?: readonly ProjectRole[];
  /** Ép một trong bảy trạng thái, cho story và bài kiểm A11. */
  readonly forceState?: MeasurementScreenState;
  readonly isDev?: boolean;
  readonly registry?: ShortcutRegistry;
  /** Khe `/` của vỏ; vỏ gọi nó khi người dùng bấm phím tìm. */
  readonly onOpenSearch?: () => void;
  /**
   * Cảnh 3D đã lắp sẵn, THẮNG cảnh hook tự lắp — xem {@link MeasurementScene}.
   *
   * `null` truyền vào là "màn này không có cảnh", một câu trả lời dứt khoát;
   * vắng mặt hẳn mới là "hook tự lắp lấy".
   */
  readonly scene?: MeasurementScene | null;
  /** Thay module cảnh, cho bài kiểm không cần WebGL. */
  readonly mountScene?: MountMeasurementScene;
  /** Thay lượt bắn tia, cho bài kiểm không cần WebGL. */
  readonly pick?: PickAt;
  /** Thay phép chiếu, cho bài kiểm không cần camera. */
  readonly projectToScreen?: ScreenProjector;
  /** Nơi toast hoàn tác đi tới. Vắng mặt thì bus dùng chung của ứng dụng. */
  readonly notifications?: NotificationBus;
  /** Tầng đang soát, để lọc mồi bắt điểm. Vắng mặt thì lấy mồi của cả mô hình. */
  readonly levelId?: string | null;
  /** Điều hướng của router; có mặt thì breadcrumb bấm được (route không có AppShell, 25-A-003). */
  readonly onNavigate?: (to: string) => void;
}

/**
 * Thanh trạng thái của vỏ, với câu đọc to (aria-live) theo cảnh CỦA MÀN: đang
 * dựng thì "đang dựng", dựng hỏng thì câu lỗi; còn lại giữ câu của vỏ.
 */
function liveStatusOf(
  status: ViewerShellProps['status'],
  viewerState: ViewerScreenState,
  sceneFailed: boolean,
): ViewerShellProps['status'] {
  if (sceneFailed) {
    return { ...status, liveMessage: SCENE_FAILED_MESSAGE };
  }

  return viewerState === 'loading' ? { ...status, liveMessage: BUILDING_MESSAGE } : status;
}

/** Câu của trạng thái 4, hoặc `null` khi không có gì hỏng. */
function errorMessageOf(
  surfaceFailed: boolean,
  loadFailed: boolean,
  sceneFailed: boolean,
): string | null {
  if (sceneFailed) {
    return SCENE_FAILED_MESSAGE;
  }
  if (surfaceFailed) {
    return NO_SURFACE_MESSAGE;
  }

  return loadFailed ? LOAD_ERROR_MESSAGE : null;
}

/* -------------------------------------------------------------------------- */
/* Hook.                                                                       */
/* -------------------------------------------------------------------------- */

/**
 * Mọi thứ container của `MeasurementTool` cần, và không gì hơn.
 *
 * @param options Dự án, hai cổng, cảnh 3D, và các chỗ tiêm cho story và bài kiểm.
 * @returns `ViewerShellProps` đủ để dựng `<ViewerShell {...props} />` bằng đúng
 * một thẻ: `renderScene` đã cắm sẵn `<MeasurementTool>`, `inspectorSections` đã
 * cắm sẵn mục "Phép đo".
 */
export function useMeasurementTool(options: UseMeasurementToolOptions): ViewerShellProps {
  /* A12: giữ listener bàn phím sống suốt lúc màn còn gắn. Sổ thuê đếm người
     giữ, nên gọi ở đây không gắn listener lần thứ hai. */
  useShortcutListener(options.registry !== undefined ? { registry: options.registry } : {});

  /* ---- Kho và cổng của vỏ ------------------------------------------------ */

  const storeSpatial = useStore((state) => state.spatial);
  const floorMeta = useStore((state) => state.floorMeta);
  const spatial = options.spatial !== undefined ? options.spatial : storeSpatial;

  const shellGateway = useMemo(
    () => options.shellGateway ?? createViewerShellGateway(() => useStore.getState().spatial),
    [options.shellGateway],
  );

  /* ---- Tầng máy chủ: một lượt đọc, hai lượt ghi (R-64) ------------------- */

  const queryClient = useQueryClient();
  const http = useMemo(() => createMeasurementHttpClient(), []);

  const notifications = options.notifications ?? appNotificationBus;

  /* Cổng thật giữ TÁCH khỏi `options.gateway`: vé hoàn tác cần hàm hoà giải của
     nó, mà deps của mutation dựng trước cổng nên nối qua ref. Cổng được tiêm thì
     không có hàm này, và 409 của hoàn tác đi thẳng `onUndoFailed`. */
  const httpGatewayRef = useRef<MeasurementToolHttpGateway | null>(null);
  const injectedGateway = options.gateway !== undefined;

  const saveMutation = useMutation(saveMeasurement({ http, queryClient }));
  const deleteMutation = useMutation(
    deleteMeasurement({
      http,
      queryClient,
      onUndoFailed: () => {
        notifications.publish({
          type: UNDO_ERROR_NOTIFICATION_TYPE,
          title: UNDO_FAILED_TEXT,
          description: '',
        });
      },
      ...(injectedGateway
        ? {}
        : {
            resolveUndoConflict: (targetProject: string, measurement: MeasurementRecord) =>
              httpGatewayRef.current !== null
                ? httpGatewayRef.current.resolveUndoConflict(targetProject, measurement)
                : Promise.reject(new Error('Cổng đo chưa dựng xong.')),
          }),
    }),
  );

  /**
   * Vé hoàn tác thành một toast có nút "Hoàn tác" (A8).
   *
   * `NotificationHost` của `src/main.tsx` vẽ bus này và gọi thẳng
   * `ticket.undo()`. Cửa sổ tám giây do chính vé mang (`UNDO_WINDOW_MS`), nên
   * không có thời lượng nào phải truyền ở đây (R-71).
   */
  const publishUndo = useCallback(
    (ticket: UndoTicket): void => {
      notifications.publish({
        type: DELETE_NOTIFICATION_TYPE,
        title: ticket.description,
        description: '',
        undoTicket: ticket,
      });
    },
    [notifications],
  );

  /* `mutateAsync` giữ nguyên danh tính qua các lượt vẽ của react-query, nhưng
     đọc qua ref vẫn rẻ hơn là dựng lại cổng mỗi khi một lượt ghi đổi trạng
     thái — và cổng phải ổn định vì `renderScene` chạy lại mỗi khung hình. */
  const runnersRef = useRef({ save: saveMutation.mutateAsync, remove: deleteMutation.mutateAsync });
  runnersRef.current = { save: saveMutation.mutateAsync, remove: deleteMutation.mutateAsync };

  const httpGateway = useMemo(
    (): MeasurementToolHttpGateway =>
      createMeasurementToolGateway({
        http,
        queryClient,
        save: (variables) => runnersRef.current.save(variables),
        remove: (variables) => runnersRef.current.remove(variables),
        onUndoTicket: publishUndo,
      }),
    [http, queryClient, publishUndo],
  );
  httpGatewayRef.current = httpGateway;

  const gateway: MeasurementToolGateway = options.gateway ?? httpGateway;

  const { projectId } = options;

  /**
   * Lượt đọc danh sách.
   *
   * Bộ nhớ đệm dưới khoá `measurementKeys.all` thuộc về `src/lib/mutations`: hai
   * lượt cập nhật lạc quan ở đó ghi `MeasurementRecord[]` vào đúng khoá này. Nên
   * `queryFn` trả về bản ghi chứ không trả hàng đã định dạng — nếu không, một
   * lượt ghim sẽ chèn một hình dạng khác vào cùng một mảng. `select` là chỗ bản
   * ghi thành hàng, và nó chạy lại khi `unit` đổi.
   */
  const rowsQuery = useQuery({
    queryKey: measurementKeys.all(projectId),
    queryFn: async (): Promise<readonly MeasurementRecord[]> =>
      (await gateway.listMeasurements(projectId)).map(toMeasurementRecord),
  });

  /* ---- Trạng thái của màn ----------------------------------------------- */

  const [mode, setMode] = useState<MeasureMode>('pointToPoint');
  const [unit, setUnit] = useState<MeasureUnit>(INITIAL_MEASURE_UNIT);
  const [unitJustChanged, setUnitJustChanged] = useState(false);
  const [picks, setPicks] = useState<readonly MeasurePick[]>(NO_PICKS);
  const [cursor, setCursor] = useState<{
    readonly point: MeasurePoint | null;
    readonly px: ScreenPoint | null;
    readonly snap: SnapIndicator;
  }>({ point: null, px: null, snap: IDLE_SNAP });
  const [hidden, setHidden] = useState<ReadonlySet<PinnedMeasurementId>>(NO_HIDDEN);
  const [highlightedId, setHighlightedId] = useState<PinnedMeasurementId | null>(null);
  const [collapsed, setCollapsed] = useState(false);
  const [surfaceFailed, setSurfaceFailed] = useState(false);
  const [toolState, setToolState] = useState<ToolMachineState>(() =>
    createToolState(IDLE_MACHINE_TOOL_ID),
  );

  /* ---- Vỏ chung --------------------------------------------------------- */

  const buildPropsRef = useRef<() => MeasurementToolProps>(() => {
    throw new Error('renderScene được gọi trước khi hook dựng xong phép dựng props.');
  });

  /* Canvas của cảnh. `setCanvas` ổn định qua mọi lượt vẽ, nên `renderScene` —
     thứ chạy lại mỗi khung hình trong lúc camera còn bay — không gắn lại ref và
     không tháo dựng cảnh theo từng khung hình. */
  const [canvas, setCanvas] = useState<HTMLCanvasElement | null>(null);

  /**
   * Khe cắm cảnh: canvas trước, lớp phủ sau.
   *
   * Thứ tự này là cả bố cục lẫn hợp đồng con trỏ. Canvas nằm dưới nên lớp phủ vẽ
   * chồng lên nó; `aria-hidden` vì mọi thứ đọc được đã nằm trong lớp phủ; và
   * `pointer-events-none` để cú chấm rơi thẳng xuống khung nhìn của vỏ — chỉ vỏ
   * bắt con trỏ, và hook nối lượt bắt ấy vào `picker`.
   */
  const renderScene = useCallback(
    (): ReactNode =>
      createElement(
        Fragment,
        null,
        createElement('canvas', {
          'aria-hidden': 'true',
          className: 'pointer-events-none absolute inset-0 h-full w-full',
          key: 'scene',
          ref: setCanvas,
        }),
        createElement(MeasurementTool, { ...buildPropsRef.current(), key: 'overlay' }),
      ),
    [],
  );

  const shell = useViewerShell({
    projectId,
    gateway: shellGateway,
    spatial,
    renderScene,
    // Cảnh đo dựng tầng ở cao độ thật và điểm đo bám hình thật: không tách tầng (BUG-656).
    separationDisabled: true,
    ...(options.roles !== undefined ? { roles: options.roles } : {}),
    ...(options.isDev !== undefined ? { isDev: options.isDev } : {}),
    ...(options.registry !== undefined ? { registry: options.registry } : {}),
    ...(options.onOpenSearch !== undefined ? { onOpenSearch: options.onOpenSearch } : {}),
  });

  /**
   * Một sự kiện của máy công cụ S-08.
   *
   * `reduceTool` thuần và không bao giờ ghi; nó là chỗ DUY NHẤT giữ pha cử chỉ
   * của màn, và hook không dựng một máy thứ hai bên cạnh nó.
   */
  const runToolEvent = useCallback((event: ToolEvent): void => {
    setToolState(
      (current) => reduceTool(current, event, { tools: TOOLS, context: TOOL_CONTEXT }).state,
    );
  }, []);

  /*
   * Ray công cụ của vỏ là MẶT của S-08, không phải một trạng thái thứ hai.
   *
   * Vỏ giữ `activeToolId` cho chrome của nó (ô nào sáng trên ray trái), còn máy
   * công cụ giữ công cụ và pha cử chỉ. Một chiều đồng bộ, từ vỏ sang máy: bấm
   * vào ô "đo" trên ray và bấm phím `M` đều đi qua `shell.onToolChange`, nên
   * không có đường nào làm hai bên lệch nhau.
   */
  useEffect(() => {
    const next =
      shell.activeToolId === MEASURE_TOOL_ID ? MEASURE_TOOL_ID : IDLE_MACHINE_TOOL_ID;

    if (toolState.tool !== next) {
      runToolEvent({ type: 'activate', tool: next });
    }
  }, [shell.activeToolId, toolState.tool, runToolEvent]);

  /* "Công cụ đang bật" đọc THẲNG từ vỏ, không đọc từ máy công cụ: vỏ giữ `M` và
     giữ ray trái, nên nó là nguồn duy nhất, còn máy công cụ chỉ đi sau nó một
     nhịp và không được phép trả lời trước nó. */
  const isMeasuring = shell.activeToolId === MEASURE_TOOL_ID;

  /* ---- Bắt điểm --------------------------------------------------------- */

  const snapTargets = useMemo(
    () => snapTargetsOf(spatial, options.levelId ?? null),
    [spatial, options.levelId],
  );

  /**
   * Một điểm bắn tia, đã bắt vào mồi gần nhất.
   *
   * `snapToTargets` làm việc trên mặt bằng hai chiều, nên trục ĐỨNG giữ nguyên
   * từ điểm bắn tia: kéo cao độ của một cú chấm về đỉnh tường gần nhất sẽ đổi
   * chiều cao mà người dùng vừa đo mà không nói gì.
   */
  const snapPoint = useCallback(
    (point: MeasurePoint): { readonly point: MeasurePoint; readonly snap: SnapIndicator } => {
      const result = snapMeasurePoint(point, snapTargets);

      return {
        point: { x: result.point.x, y: result.point.y, ...(point.z !== undefined ? { z: point.z } : {}) },
        snap: snapIndicatorOf(result),
      };
    },
    [snapTargets],
  );

  /* ---- Bắn tia ---------------------------------------------------------- */

  const mountedScene = useMeasurementToolScene({
    canvas,
    spatial,
    frame: shell.frame,
    ...(options.mountScene !== undefined ? { mountScene: options.mountScene } : {}),
  });

  const scene = options.scene !== undefined ? options.scene : mountedScene.scene;

  const pick = useMemo((): PickAt | null => {
    if (options.pick !== undefined) {
      return options.pick;
    }

    if (scene === null) {
      return null;
    }

    return createScenePick({
      camera: scene.camera,
      root: scene.root,
      viewport: scene.viewport,
      ...(scene.merge !== undefined ? { merge: scene.merge } : {}),
      ...(scene.layers !== undefined ? { layers: scene.layers } : {}),
    });
  }, [options.pick, scene]);

  const project = useMemo(
    (): ScreenProjector | null =>
      options.projectToScreen ?? (scene === null ? null : projectorFor(scene)),
    [options.projectToScreen, scene],
  );

  /* Con trỏ và cú chấm đọc trạng thái mới nhất qua ref: picker được dựng một
     lần cho mỗi lượt bắn tia và không được dựng lại theo từng lượt vẽ. */
  const latest = useRef({ isMeasuring, snapPoint, project, mode, pickCount: picks.length });
  useEffect(() => {
    latest.current = { isMeasuring, snapPoint, project, mode, pickCount: picks.length };
  });

  const picker = useMemo(() => {
    if (pick === null) {
      return null;
    }

    return createPointerPicker({
      pick,
      onEvent: (event) => {
        if (!latest.current.isMeasuring) {
          return;
        }

        const hit = event.hit;

        if (hit === null) {
          setCursor((current) => ({ ...current, point: null, px: event.pointer, snap: IDLE_SNAP }));

          return;
        }

        const snapped = latest.current.snapPoint(toMeasurePoint(hit.point));

        if (event.type === 'hover') {
          setCursor({ point: snapped.point, px: event.pointer, snap: snapped.snap });

          return;
        }

        // Chế độ hai điểm đủ điểm thì cú chấm thêm bị bỏ: giá trị và bản ghim chỉ
        // dùng hai điểm đầu, nên vẽ điểm thứ ba là nói dối (25-C-022).
        const { mode: liveMode, pickCount } = latest.current;
        if (liveMode !== 'floorArea' && pickCount >= REQUIRED_POINTS[liveMode]) {
          return;
        }

        setSurfaceFailed(false);
        setPicks((current) => [...current, { point: snapped.point, normal: hit.normal }]);
      },
    });
  }, [pick]);

  useEffect(() => (): void => picker?.dispose(), [picker]);

  /* ---- Con trỏ của vỏ, bọc thêm một lượt cho picker ---------------------- */

  const lastPointerRef = useRef<ViewerPointPx>({ x: 0, y: 0 });

  const onViewportPointerMove = useCallback(
    (point: ViewerPointPx, buttons: number): void => {
      lastPointerRef.current = point;
      shell.onViewportPointerMove(point, buttons);
      picker?.pointerMove(point);
    },
    [shell, picker],
  );

  const onViewportPointerDown = useCallback(
    (point: ViewerPointPx): void => {
      lastPointerRef.current = point;
      shell.onViewportPointerDown(point);
      picker?.pointerDown(point);
    },
    [shell, picker],
  );

  const onViewportPointerUp = useCallback((): void => {
    shell.onViewportPointerUp();
    picker?.pointerUp(lastPointerRef.current);
  }, [shell, picker]);

  /* ---- Phép đo đang dở --------------------------------------------------- */

  const livePicks = useMemo((): readonly MeasurePick[] => {
    if (cursor.point === null || picks.length >= REQUIRED_POINTS[mode]) {
      return picks;
    }

    return [...picks, { point: cursor.point, normal: null }];
  }, [picks, cursor.point, mode]);

  const attempt = useMemo(() => attemptMeasure(mode, picks), [mode, picks]);
  const liveAttempt = useMemo(() => attemptMeasure(mode, livePicks), [mode, livePicks]);

  useEffect(() => {
    if (attempt.kind === 'noSurface') {
      setSurfaceFailed(true);
    }
  }, [attempt]);

  /**
   * R10 làn S: trạng thái tỷ lệ XẤU NHẤT trong mô hình. Một thước 3D không ghi nó thuộc tầng nào,
   * nên nếu còn một tầng chưa tin được thì số đo nào cũng có thể là số ước — nói ra, đừng im.
   */
  const worstScaleState = useMemo((): ScaleState | undefined => {
    let worst: ScaleState | undefined;
    for (const meta of Object.values(floorMeta)) {
      if (meta === undefined || (meta.scaleStatus === undefined && meta.scaleState === undefined)) continue;
      const state = scaleStateOf(meta.scaleStatus, meta.scaleSource, meta.scaleState);
      if (state === 'measured' || state === 'confirmed') continue;
      if (worst === undefined || SCALE_SEVERITY[state] > SCALE_SEVERITY[worst]) worst = state;
    }
    return worst;
  }, [floorMeta]);

  const draftRow = useMemo((): PinnedMeasurement | null => {
    if (attempt.kind !== 'measured') {
      return null;
    }

    const identity = nextMeasurementIdentity(rowsQuery.data ?? NO_RECORDS);

    return formatMeasurementRow(
      {
        ...identity,
        mode,
        rawValueMm: rawValueOf(attempt.measurement),
        points: attempt.measurement.points,
        visible: true,
        stale: false,
        staleReason: null,
      },
      unit,
      worstScaleState,
    );
  }, [attempt, mode, unit, rowsQuery.data, worstScaleState]);

  const draft = useMemo((): DraftMeasurement | null => {
    if (picks.length === 0) {
      return null;
    }

    const points = livePicks.map((entry) => entry.point);
    const label =
      liveAttempt.kind === 'measured'
        ? formatMeasurementRow(
            {
              id: 'MS-draft',
              name: '',
              mode,
              rawValueMm: rawValueOf(liveAttempt.measurement),
              points: liveAttempt.measurement.points,
              visible: true,
              stale: false,
              staleReason: null,
            },
            unit,
            worstScaleState,
          ).valueLabel
        : null;

    return {
      mode,
      points,
      valueLabel: label,
      screenPoints: projectAll(points, project) ?? NO_SCREEN_POINTS,
      cursorPx: cursor.px,
      snap: cursor.snap,
    };
  }, [picks.length, livePicks, liveAttempt, mode, unit, project, cursor.px, cursor.snap, worstScaleState]);

  /* ---- Danh sách đã ghim ------------------------------------------------- */

  const rows = useMemo((): readonly PinnedMeasurement[] => {
    const records = rowsQuery.data;

    if (records === undefined || records.length === 0) {
      return NO_ROWS;
    }

    return records.map((record) => {
      const row = formatMeasurementRow(toMeasurementRowCore(record), unit, worstScaleState);

      return {
        ...row,
        visible: !hidden.has(row.id),
        screenPoints: projectAll(row.points, project),
      };
    });
  }, [rowsQuery.data, unit, hidden, project, worstScaleState]);

  /* ---- Hành động --------------------------------------------------------- */

  const clearDraft = useCallback((): void => {
    setPicks(NO_PICKS);
    setSurfaceFailed(false);
    setCursor((current) => ({ ...current, point: null }));
  }, []);

  const onEscape = useCallback((): void => {
    runToolEvent({ type: 'cancel' });
    clearDraft();
  }, [runToolEvent, clearDraft]);

  const onToggleTool = useCallback((): void => {
    shell.onToolChange(isMeasuring ? IDLE_SHELL_TOOL_ID : MEASURE_TOOL_ID);
    clearDraft();
  }, [shell, isMeasuring, clearDraft]);

  /** Cờ của MỌI thao tác ghi (ghim, xoá — B-V9-41), không riêng ghim. */
  const canPin = shell.state !== 'forbidden';
  /** Đã nạp xong mà không có tầng nào: không có mô hình để mời đo (25-B-017). */
  const noModel = shell.state !== 'loading' && shell.storeys.length === 0;

  /* Điểm của bản nháp chỉ bị bỏ khi `saveMeasurement` xong: hỏng thì chúng còn
     nguyên đó, cùng một câu lỗi, và người dùng ghim lại được. */
  /* Một lượt ghim đang bay thì bấm đúp hay Enter lặp không gửi lượt thứ hai
     (NO-384); lượt ấy xong — được hay hỏng — thì chốt mở lại. */
  const pinInFlightRef = useRef(false);

  const onPin = useCallback((): void => {
    if (!canPin || draftRow === null || pinInFlightRef.current) {
      return;
    }

    pinInFlightRef.current = true;
    // Bọc trong executor: một cổng tiêm vào ném ĐỒNG BỘ cũng thành lượt hỏng có
    // câu báo và mở lại chốt, thay vì kẹt chốt mãi (review DEBT-03 Nit).
    new Promise<unknown>((resolve) => {
      resolve(gateway.saveMeasurement(projectId, draftRow));
    })
      .then(clearDraft)
      .catch((error: unknown) => {
        notifications.publish({
          type: PIN_ERROR_NOTIFICATION_TYPE,
          title: MEASUREMENT_ERROR_TEXT[measurementErrorCodeOf(error).code ?? ''] ?? PIN_FAILED_TEXT,
          description: '',
        });
      })
      .finally(() => {
        pinInFlightRef.current = false;
      });
  }, [canPin, draftRow, gateway, projectId, clearDraft, notifications]);

  const onDelete = useCallback(
    (id: PinnedMeasurementId): void => {
      if (!canPin) {
        return;
      }

      setHighlightedId((current) => (current === id ? null : current));
      gateway.deleteMeasurement(projectId, id).catch((error: unknown) => {
        const { code, resource } = measurementErrorCodeOf(error);
        const gone = resource === 'measurement' && code === 'NOT_FOUND';

        notifications.publish({
          type: DELETE_ERROR_NOTIFICATION_TYPE,
          title: gone
            ? DELETE_GONE_TEXT
            : code === 'FORBIDDEN'
              ? DELETE_FORBIDDEN_TEXT
              : DELETE_FAILED_TEXT,
          description: '',
        });

        if (gone) {
          void queryClient.invalidateQueries({ queryKey: measurementKeys.all(projectId) });
        }
      });
    },
    [canPin, gateway, projectId, notifications, queryClient],
  );

  const onToggleVisibility = useCallback((id: PinnedMeasurementId): void => {
    setHidden((current) => {
      const next = new Set(current);

      if (!next.delete(id)) {
        next.add(id);
      }

      return next;
    });
  }, []);

  const onUnitChange = useCallback((next: MeasureUnit): void => {
    setUnit(next);
    setUnitJustChanged(true);
  }, []);

  /**
   * Nhãn chạy số đúng MỘT nhịp sau khi đổi đơn vị.
   *
   * `standard` (260 ms) là chỗ đặc tả nói "240 ms"; 240 không có trong
   * `MOTION_DURATIONS_MS` và R-71 cấm viết một con số thứ năm.
   */
  useEffect(() => {
    if (!unitJustChanged) {
      return undefined;
    }

    const timer = setTimeout(() => {
      setUnitJustChanged(false);
    }, MOTION_DURATIONS_MS.standard);

    return (): void => {
      clearTimeout(timer);
    };
  }, [unitJustChanged]);

  const retryScene = mountedScene.failed ? mountedScene.retry : null;
  const onRetry = useCallback((): void => {
    setSurfaceFailed(false);
    retryScene?.();
    void rowsQuery.refetch();
  }, [rowsQuery, retryScene]);

  /* ---- Phím tắt (A12, R-54, R-72) ---------------------------------------- */

  const registryOption = options.registry !== undefined ? { registry: options.registry } : {};

  useShortcut(
    {
      id: ESCAPE_ID,
      combo: ESCAPE_COMBO,
      scope: 'canvas',
      // Không chặn hành vi Escape của trình duyệt (thoát toàn màn hình), đúng
      // như binding Escape của vỏ.
      preventDefault: false,
      description: ESCAPE_DESCRIPTION,
      onTrigger: onEscape,
    },
    registryOption,
  );

  useShortcut(
    { id: PIN_ID, combo: PIN_COMBO, scope: 'canvas', description: PIN_DESCRIPTION, onTrigger: onPin },
    { ...registryOption, enabled: canPin },
  );

  useShortcut(
    {
      id: DELETE_ID,
      combo: DELETE_COMBO,
      scope: 'canvas',
      description: DELETE_DESCRIPTION,
      onTrigger: (): void => {
        if (highlightedId !== null) {
          onDelete(highlightedId);
        }
      },
    },
    { ...registryOption, enabled: canPin },
  );

  /* ---- Bảy trạng thái (A11, R-63) ---------------------------------------- */

  const state = useMemo((): MeasurementScreenState => {
    if (options.forceState !== undefined) {
      return options.forceState;
    }
    if (surfaceFailed || rowsQuery.isError || mountedScene.failed) {
      return 'error';
    }
    if (collapsed) {
      return 'collapsed';
    }
    if (shell.state === 'forbidden') {
      return 'forbidden';
    }
    if (picks.length > 0) {
      // Đủ điểm mà chưa ghim là chuỗi đo CHƯA ĐÓNG; một điểm là đang đo.
      return picks.length >= REQUIRED_POINTS[mode] ? 'partial' : 'measuring';
    }
    if (rows.length === 0) {
      return 'empty';
    }

    return 'ready';
  }, [
    options.forceState,
    surfaceFailed,
    rowsQuery.isError,
    mountedScene.failed,
    collapsed,
    shell.state,
    picks.length,
    mode,
    rows.length,
  ]);

  const errorMessage = errorMessageOf(surfaceFailed, rowsQuery.isError, mountedScene.failed);

  /* ---- Props của view, chốt lại mỗi lượt vẽ ------------------------------ */

  const toolProps = useMemo(
    (): MeasurementToolProps => ({
      state,
      mode,
      onModeChange: (next: MeasureMode): void => {
        setMode(next);
        clearDraft();
      },
      snap: cursor.snap,
      draft,
      draftComplete: draftRow !== null,
      noModel,
      measurements: rows,
      countLabel: measurementCountLabel(rows.length),
      highlightedId,
      onHighlight: setHighlightedId,
      onToggleVisibility,
      onDelete,
      onToggleTool,
      onEscape,
      onPin,
      unit,
      onUnitChange,
      unitJustChanged,
      canPin,
      pinBlockedCaption: canPin ? null : PIN_BLOCKED_CAPTION,
      collapsed,
      onToggleCollapsed: (): void => {
        setCollapsed((current) => !current);
      },
      errorMessage,
      onRetry,
    }),
    [
      state,
      mode,
      cursor.snap,
      draft,
      draftRow,
      noModel,
      rows,
      highlightedId,
      onToggleVisibility,
      onDelete,
      onToggleTool,
      onEscape,
      onPin,
      unit,
      onUnitChange,
      unitJustChanged,
      canPin,
      collapsed,
      errorMessage,
      onRetry,
      clearDraft,
    ],
  );

  buildPropsRef.current = (): MeasurementToolProps => toolProps;

  /* ---- `ViewerShellProps` đầy đủ ----------------------------------------- */

  const viewerState = viewerStateOf(state, shell.state, mountedScene.building);

  const { onNavigate } = options;
  const projectCrumb = shell.breadcrumbs[0];
  const breadcrumbs = useMemo(
    () => [
      {
        id: 'project',
        label: projectCrumb?.label ?? 'Dự án',
        onClick: onNavigate && ((): void => onNavigate(ROUTES.dashboard)),
      },
      {
        id: 'viewer',
        label: 'Mô hình 3D',
        onClick: onNavigate && ((): void => onNavigate(ROUTES.project.viewer(projectId))),
      },
      { id: 'measure', label: 'Công cụ đo' },
    ],
    [projectCrumb?.label, onNavigate, projectId],
  );

  return {
    ...shell,
    breadcrumbs,
    state: viewerState,
    // Vỏ chỉ biết lượt nạp của nó; cảnh của màn đo dựng riêng, nên câu "đã dựng
    // xong" của vỏ phải nhường khi khung nhìn còn đang dựng (NO-388) hay đã dựng
    // hỏng (review DEBT-03 P3-3) — lúc hỏng, nói đúng câu lỗi của màn.
    status: liveStatusOf(shell.status, viewerState, mountedScene.failed),
    onViewportPointerMove,
    onViewportPointerDown,
    onViewportPointerUp,
    inspectorSections: createElement(MeasurementList, {
      measurements: toolProps.measurements,
      countLabel: toolProps.countLabel,
      highlightedId: toolProps.highlightedId,
      onHighlight: toolProps.onHighlight,
      onToggleVisibility: toolProps.onToggleVisibility,
      onDelete: toolProps.onDelete,
      unit: toolProps.unit,
      onUnitChange: toolProps.onUnitChange,
      canPin: toolProps.canPin,
      noModel: toolProps.noModel,
      collapsed: toolProps.collapsed,
      onToggleCollapsed: toolProps.onToggleCollapsed,
    }),
  };
}
