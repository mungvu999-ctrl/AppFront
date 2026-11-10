/**
 * Hook của màn `/m/du-an/:projectId` — xem 3D **chỉ đọc** trên điện thoại.
 *
 * Nó nối lại logic đã có và không phát minh thêm cái nào. Mỗi việc dưới đây đã
 * có chủ ở tầng dưới, và hook chỉ đưa dữ liệu đi qua đúng chủ của nó:
 *
 * | Việc | Ai làm |
 * |---|---|
 * | tên dự án (trạng thái máy chủ) | `projectDetailQueryOptions` → khoá của `src/lib/query` |
 * | tầng · phòng · phần thiếu | `shellDataOf` / `storeysOf` của vỏ Viewer |
 * | tấm thông tin chỉ đọc | `toViewModel` + `src/lib/format`, lọc tập con ở `mobileViewerGateway` |
 * | đo | sáu hàm của `src/domain/measure` |
 * | mạng yếu (T-09) | `createNetworkMonitor` của `src/lib/offline` |
 * | ngưỡng fps (R-04) | `SCENE_BUDGET.minFrameRate.mobile` + `DEGRADE_WINDOW_MS` |
 * | liên kết chia sẻ (X-04) | `createShareLink` / `revokeShareLink` / `shareLinkUrl` |
 * | toast hoàn tác (A8) | `createUndoTicket` + `NotificationBus` |
 * | đường dẫn bản 2D | `ROUTES.project.floors` |
 *
 * ## `loading` và `error` KHÔNG phải `useState` — R-64
 *
 * Tên dự án là trạng thái máy chủ, nên nó đến từ `useQuery` với khoá của
 * `src/lib/query`; tạo liên kết là một lượt ghi, nên nó đến từ `useMutation`.
 * `hooks/useShareLinks.ts` tự giữ `isLoading`/`error` bằng tay — đó là NGOẠI LỆ
 * ĐI TRƯỚC, không phải khuôn mẫu, và chép nó là vi phạm. Những `useState` còn
 * lại trong file này KHÔNG phải trạng thái truy vấn: chúng là mức chi tiết mà
 * cảnh 3D đang dựng, việc máy có dựng nổi cảnh hay không, tầng đang xem, công
 * cụ đang mở, thứ đang chọn, và những phép đo người dùng vừa chấm — không lượt
 * HTTP nào đứng sau chúng để `useQuery` theo dõi.
 *
 * ## Cổng mặc định là cổng THẬT
 *
 * `useViewerShell.ts:409-410` mặc định dùng cổng GIẢ và vì thế hiện đúng bộ mẫu
 * bốn tầng trên MỌI dự án thật mà không báo gì. `useViewer3D.ts:386-388` mặc
 * định ngược lại. Màn này theo `useViewer3D`.
 *
 * ## Cảnh 3D đi vào bằng cách TIÊM, không bằng `import`
 *
 * `mountScene` là tham số BẮT BUỘC (thiếu là lỗi biên dịch, không phải màn im
 * lặng không có hình); bản thật là `mountMobileViewerPascal` — Pascal `view`
 * với camera chạm, chọn và đo hai điểm do Pascal lo (F-15 S15). Cùng lý do với
 * `notifications`: A8 đòi toast hoàn tác, nơi nhận phải do người gọi cấp.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import { useMutation, useQuery } from '@tanstack/react-query';

import { denormalizeSpatial, type NormalizedSpatial } from '@/domain/spatial/normalize';
import { readKindFromId } from '@/domain/spatial/ids';
import { bodyOfPascalId } from '@/lib/pascal/ids';
import type { SceneConcept } from '@/lib/pascal/sceneConcept';
import { can } from '@/lib/auth/permissions';
import {
  createShareLink,
  revokeShareLink,
  shareLinkUrl,
  type ShareLink,
  type ShareLinkGateway,
} from '@/lib/export/shareLink';
import { createUuid } from '@/lib/http/ids';
import { createUndoTicket } from '@/lib/mutations/undoTicket';
import type { NotificationBus } from '@/lib/mutations/notificationBus';
import type { NetworkMonitorStatus } from '@/lib/offline/networkMonitor';
import { ROUTES } from '@/routes/paths';
import { useStore } from '@/store';
import { useShareLinkGateway } from '@/hooks/useShareLinkGateway';
import { shellDataOf } from '@/screens/viewer/ViewerShell';
import type { ProjectRole } from '@/types/project';

import {
  createMobileViewerGateway,
  desktopLinkMailtoHref,
  floorsOf,
  isNetworkDegraded,
  measurementOfDistance,
  selectionOf,
  type MobilePick,
  type MobileViewerGateway,
} from './mobileViewerGateway';
import { projectDetailQueryOptions } from './mobileViewerQueries';
import {
  MOBILE_VIEWER_COMPACT_WIDTH_PX,
  type MobilePartialReason,
  type MobileViewerMeasurement,
  type MobileViewerModel,
  type MobileViewerSceneMount,
  type MobileViewerSceneOptions,
  type MobileViewerSelection,
  type MobileViewerState,
  type MobileViewerToolId,
} from './mobileViewerTypes';

/* -------------------------------------------------------------------------- */
/* Chuỗi tiếng Việt của màn. Bản sao để soát nằm ở `i18n.hook.fragment.json`.  */
/* -------------------------------------------------------------------------- */

/** Nhãn mức chi tiết trong lúc còn đang nâng dần lên. `full` là "hết chuyện để nói". */
const UNNAMED_PROJECT = 'Dự án chưa có tên';

/** Loại của mọi toast màn này phát ra — `NotificationBus` gộp theo trường này. */
const SHARE_NOTIFICATION_TYPE = 'shareLink';

const SHARE_COPIED_TITLE = 'Đã tạo liên kết chia sẻ';
const SHARE_COPIED_BODY = 'Liên kết chỉ xem đã được chép vào bộ nhớ tạm.';
const SHARE_COPY_BLOCKED_BODY = 'Máy không cho chép tự động, hãy mở liên kết rồi chép thủ công.';
const SHARE_MAILED_TITLE = 'Đã tạo liên kết cho máy tính';
const SHARE_MAILED_BODY = 'Ứng dụng thư đã mở sẵn một thư kèm liên kết và câu giải thích.';
const SHARE_FAILED_TITLE = 'Chưa tạo được liên kết chia sẻ';
const SHARE_FAILED_BODY = 'Chưa gọi được máy chủ chia sẻ, hãy thử lại khi mạng khá hơn.';
const SHARE_UNDO_LABEL = 'Thu hồi liên kết vừa tạo';

/* -------------------------------------------------------------------------- */
/* Tham số và những kiểu riêng của hook.                                       */
/* -------------------------------------------------------------------------- */

/** Chữ ký lắp cảnh của `mobileViewerPascal.ts`, tiêm vào chứ không `import`. */
export type MountMobileViewerScene = (
  element: HTMLElement,
  options: MobileViewerSceneOptions,
) => MobileViewerSceneMount;

/** Vì sao cảnh không dựng được — cả ba đều dẫn tới trạng thái `error`. */
type SceneFailure = 'webglUnavailable' | 'deviceTooWeak';

/** Hai kiểu chia sẻ, cùng một lượt tạo liên kết. */
type ShareIntent = 'copy' | 'mail';

/** Kết quả một lượt tạo liên kết; `link === null` là "máy chủ không cho". */
interface ShareOutcome {
  readonly intent: ShareIntent;
  readonly link: ShareLink | null;
}

export interface UseMobileViewerOptions {
  readonly projectId: string;
  /** Canvas do container cấp; `null` khi cây chưa gắn xong. */
  readonly canvas: HTMLDivElement | null;
  /** `mountMobileViewerPascal` của `mobileViewerPascal.ts`. */
  readonly mountScene: MountMobileViewerScene;
  /** Nơi nhận toast hoàn tác của A8. */
  readonly notifications: Pick<NotificationBus, 'publish'>;
  /** Vai của người đang xem. Vắng mặt là "chưa biết vai", KHÁC với "không có vai". */
  readonly roles?: readonly ProjectRole[] | undefined;
  /** Cổng dữ liệu; vắng thì dùng cổng THẬT, không phải cổng giả. */
  readonly gateway?: MobileViewerGateway | undefined;
  /** Cổng chia sẻ; vắng thì lấy cổng của phiên đăng nhập hiện tại. */
  readonly shareLinks?: ShareLinkGateway | null | undefined;
  /** Đồ thị; vắng thì đọc kho. Truyền vào để test và story không cần dựng kho. */
  readonly spatial?: NormalizedSpatial | null | undefined;
  /** Đồng hồ của phép đếm "fps thấp bao lâu rồi". */
  readonly now?: (() => number) | undefined;
}

/* -------------------------------------------------------------------------- */
/* Phép đọc thuần.                                                             */
/* -------------------------------------------------------------------------- */

/**
 * Truy vấn phương tiện cho bề ngang gọn.
 *
 * Viết bằng cú pháp dải (`width < …`) chứ không `max-width: … - 1px`: đặc tả nói
 * "nhỏ HƠN", và cú pháp dải nói đúng điều đó mà không phải trừ một pixel ra khỏi
 * một hằng số bố cục.
 */
const COMPACT_MEDIA_QUERY = `(width < ${String(MOBILE_VIEWER_COMPACT_WIDTH_PX)}px)`;

/** Máy có `matchMedia` không — jsdom và worker thì không, và đó không phải sự cố. */
function hasMatchMedia(): boolean {
  return typeof window !== 'undefined' && typeof window.matchMedia === 'function';
}

/* -------------------------------------------------------------------------- */
/* Hook.                                                                       */
/* -------------------------------------------------------------------------- */

/**
 * Mọi thứ `MobileViewer.tsx` cần, và không gì hơn.
 *
 * @param options Dự án, canvas, cảnh để lắp, và các chỗ tiêm.
 * @returns Đúng {@link MobileViewerModel} — `MobileViewerProps` trừ `canvasRef`.
 */
export function useMobileViewer(options: UseMobileViewerOptions): MobileViewerModel {
  const { canvas, mountScene, notifications, projectId, roles } = options;

  /* ---- Cổng và kho ------------------------------------------------------ */

  const gateway = useMemo(
    () => options.gateway ?? createMobileViewerGateway(),
    [options.gateway],
  );

  const sessionShareLinks = useShareLinkGateway();
  const shareLinks = options.shareLinks !== undefined ? options.shareLinks : sessionShareLinks;
  // Không cổng, hoặc cổng nói máy chủ không phục vụ liên kết (v1, BE-BIND #47–#49):
  // hai nút chia sẻ rời DOM và không lượt gọi nào đi ra.
  const canShareLinks = shareLinks !== null && shareLinks.supported;

  const storeSpatial = useStore((state) => state.spatial);
  const storeLoading = useStore((state) => state.spatialLoading);
  // Đang nạp dự án mới thì kho còn giữ mô hình của dự án trước: không vẽ nó dưới tên dự án này.
  const spatialLoading = storeLoading && options.spatial === undefined;
  const spatial = options.spatial ?? (spatialLoading ? null : storeSpatial);

  const nowRef = useRef<() => number>(Date.now);
  nowRef.current = options.now ?? Date.now;

  /* ---- Trạng thái máy chủ: nguồn DUY NHẤT của loading và error (R-64) ---- */

  const projectQuery = useQuery(projectDetailQueryOptions(gateway.projectsApi, projectId));

  const projectName = useMemo(() => {
    const name = projectQuery.data?.name.trim() ?? '';

    return name === '' ? UNNAMED_PROJECT : name;
  }, [projectQuery.data]);

  /* ---- Tầng, đọc từ đồ thị chứ không từ mạng ---------------------------- */

  const data = useMemo(() => shellDataOf(spatial), [spatial]);
  const floors = useMemo(() => floorsOf(spatial, data.storeys), [spatial, data.storeys]);
  const floorIds = useMemo(() => floors.map((floor) => floor.id), [floors]);

  // Đồ thị cho Pascal; tầng có tên mà không có tường lẫn phòng chưa phải mô hình (B-V1-11).
  const graph = useMemo(() => (spatial === null ? null : denormalizeSpatial(spatial)), [spatial]);
  const hasGeometry =
    graph !== null &&
    (graph.walls.length > 0 ||
      graph.rooms.length > 0 ||
      graph.openings.length > 0 ||
      graph.furniture.length > 0);

  const [activeFloorId, setActiveFloorId] = useState<string | null>(null);

  // Tầng đang xem luôn là một tầng CÓ THẬT trong đồ thị đang mở. Đồ thị đổi thì
  // tầng cũ có thể không còn, và giữ lại một mã tầng đã biến mất là cách nhanh
  // nhất để dải tầng không tô sáng gì cả.
  useEffect(() => {
    setActiveFloorId((current) =>
      current !== null && floorIds.includes(current) ? current : (floorIds[0] ?? null),
    );
  }, [floorIds]);

  /* ---- Bề ngang: `collapsed` do khung nhìn quyết định, không do dữ liệu -- */

  const [isCompact, setIsCompact] = useState(
    () => hasMatchMedia() && window.matchMedia(COMPACT_MEDIA_QUERY).matches,
  );

  useEffect(() => {
    if (!hasMatchMedia()) {
      return undefined;
    }

    const media = window.matchMedia(COMPACT_MEDIA_QUERY);

    setIsCompact(media.matches);

    const listen = (event: MediaQueryListEvent): void => setIsCompact(event.matches);

    media.addEventListener('change', listen);

    return () => media.removeEventListener('change', listen);
  }, []);

  /* ---- Mạng yếu — T-09 --------------------------------------------------- */

  const [isNetworkWeak, setIsNetworkWeak] = useState(false);

  useEffect(() => {
    const monitor = gateway.createMonitor();

    const read = (status: NetworkMonitorStatus): void => setIsNetworkWeak(isNetworkDegraded(status));

    read(monitor.getStatus());

    const unsubscribe = monitor.subscribe(read);

    monitor.start();

    return () => {
      unsubscribe();
      monitor.stop();
    };
  }, [gateway]);

  /* ---- Quyền ------------------------------------------------------------- */

  // Không có năng lực "xem" nào trong `permissionMatrix` — cả mười mục ở đó đều
  // là năng lực GHI, và cả ba vai (kể cả `viewer`) đều mở được màn này. Nên
  // "không có quyền" ở đây nghĩa là biết chắc người này KHÔNG mang vai nào trên
  // dự án. Vắng `roles` là "chưa biết vai", một cảnh khác hẳn mà A11 phân biệt.
  const isForbidden = roles !== undefined && roles.length === 0;

  const canEditOnDesktop = useMemo(
    () => can('edit', 'layer', roles === undefined ? {} : { roles }),
    [roles],
  );

  /* ---- Cảnh 3D ----------------------------------------------------------- */

  const [isSceneMounted, setIsSceneMounted] = useState(false);
  const [sceneNotice, setSceneNotice] = useState<string | null>(null);
  const [sceneFailure, setSceneFailure] = useState<SceneFailure | null>(null);

  const [selection, setSelection] = useState<MobileViewerSelection | null>(null);
  const [measurements, setMeasurements] = useState<readonly MobileViewerMeasurement[]>([]);

  const [activeTool, setActiveTool] = useState<MobileViewerToolId | null>(null);
  const isMeasuring = activeTool === 'measure';

  /**
   * Chạm trúng một node Pascal. Mã node mang nguyên mã AppFront trong thân
   * (`wall_W-…`); node do Pascal tự đẻ hoặc không thuộc đồ thị thì không mở gì.
   */
  const handleScenePick = useCallback(
    (nodeId: string | null): void => {
      const entityId = nodeId === null ? null : bodyOfPascalId(nodeId);
      const kind = entityId === null || spatial?.byId[entityId] === undefined ? null : readKindFromId(entityId);
      const pick: MobilePick | null =
        entityId === null || kind === null || kind === 'level' || kind === 'roof' ? null : { entityId, kind };

      setSelection(selectionOf(pick, spatial, canEditOnDesktop));
    },
    [canEditOnDesktop, spatial],
  );

  const handleMeasure = useCallback((distanceM: number): void => {
    setMeasurements((current) => [...current, measurementOfDistance(distanceM, createUuid())]);
  }, []);

  // Các lời gọi ngược đi qua một ô nhớ để việc chúng đổi theo mỗi lượt vẽ KHÔNG
  // kéo theo một lượt dọn cảnh và dựng lại từ đầu.
  const sceneCallbacksRef = useRef({ onPick: handleScenePick, onMeasure: handleMeasure });

  useEffect(() => {
    sceneCallbacksRef.current = { onPick: handleScenePick, onMeasure: handleMeasure };
  }, [handleScenePick, handleMeasure]);

  // Concept AI nhớ theo dự án: bật/tắt đo dựng lại cảnh (Pascal đọc `measure` lúc dựng) nhưng không gọi lại N47.
  const loadConcept = useMemo(() => {
    let pending: Promise<SceneConcept> | undefined;
    return (): Promise<SceneConcept> =>
      (pending ??= import('@/lib/pascal/sceneConcept').then(({ loadSceneConcept }) => loadSceneConcept(projectId)));
  }, [projectId]);

  useEffect(() => {
    if (canvas === null || graph === null || !hasGeometry) {
      return undefined;
    }

    const mount = mountScene(canvas, {
      graph,
      loadConcept,
      // Pascal đọc `measure` lúc dựng, nên bật/tắt công cụ đo dựng lại cảnh.
      measure: isMeasuring,
      onPick: (nodeId) => sceneCallbacksRef.current.onPick(nodeId),
      onMeasure: (distanceM) => sceneCallbacksRef.current.onMeasure(distanceM),
      onReady: () => setIsSceneMounted(true),
      onFailure: setSceneFailure,
      projectId,
      onLibraryNotice: setSceneNotice,
    });

    if (!mount.ok) {
      setSceneFailure(mount.reason);

      return undefined;
    }

    setSceneFailure(null);

    return () => {
      mount.handle.dispose();
      setIsSceneMounted(false);
    };
  }, [canvas, graph, hasGeometry, isMeasuring, loadConcept, mountScene, projectId]);

  /* ---- Chia sẻ — X-04, và toast hoàn tác của A8 -------------------------- */

  const shareMutation = useMutation<ShareOutcome, Error, ShareIntent>({
    mutationFn: async (intent: ShareIntent): Promise<ShareOutcome> => {
      if (!canShareLinks) {
        return { intent, link: null };
      }

      const made = await createShareLink(shareLinks, {
        projectId,
        // Màn chỉ đọc chia sẻ một lối xem chỉ đọc; bình luận là việc của máy tính.
        permission: 'view',
        expiresAt: null,
      });

      return { intent, link: made.ok ? made.data : null };
    },
    onSuccess: async ({ intent, link }: ShareOutcome): Promise<void> => {
      if (link === null || shareLinks === null) {
        notifications.publish({
          type: SHARE_NOTIFICATION_TYPE,
          title: SHARE_FAILED_TITLE,
          description: SHARE_FAILED_BODY,
        });

        return;
      }

      const url = shareLinkUrl(link);

      // A8: tạo liên kết là một thay đổi, nên nó đi kèm vé hoàn tác. Hoàn tác
      // của "tạo" là "thu hồi" — đúng cửa thứ ba của `ShareLinkGateway`.
      const undoTicket = createUndoTicket({
        description: SHARE_UNDO_LABEL,
        undo: () => {
          void revokeShareLink(shareLinks, { projectId, linkId: link.id });
        },
      });

      if (intent === 'mail') {
        gateway.openMail(desktopLinkMailtoHref(projectName, url));

        notifications.publish({
          type: SHARE_NOTIFICATION_TYPE,
          title: SHARE_MAILED_TITLE,
          description: SHARE_MAILED_BODY,
          undoTicket,
        });

        return;
      }

      const copied = await gateway.copyText(url);

      notifications.publish({
        type: SHARE_NOTIFICATION_TYPE,
        title: SHARE_COPIED_TITLE,
        description: copied ? SHARE_COPIED_BODY : SHARE_COPY_BLOCKED_BODY,
        undoTicket,
      });
    },
  });

  const { mutate: share } = shareMutation;

  const onShare = useCallback((): void => share('copy'), [share]);
  const onSendDesktopLink = useCallback((): void => share('mail'), [share]);

  /* ---- Thanh dưới và tấm thông tin --------------------------------------- */

  const onSelectTool = useCallback(
    (tool: MobileViewerToolId | null): void => {
      // Ở bề ngang gọn, `view` không biến mất mà GỘP vào tấm "tầng" — nên bấm
      // vào nó ở đó vẫn mở đúng tấm ấy, không rơi vào khoảng không.
      setActiveTool(isCompact && tool === 'view' ? 'floors' : tool);
    },
    [isCompact],
  );

  const onSelectFloor = useCallback((floorId: string): void => setActiveFloorId(floorId), []);

  const onDismissSelection = useCallback((): void => setSelection(null), []);

  /* ---- Bảy trạng thái — A11 / R-63 --------------------------------------- */

  /**
   * Bảy nhánh, không nhánh nào bỏ sót — màn trắng là thất bại DUY NHẤT mà A11
   * tồn tại để chặn, và nó chỉ xảy ra khi một tổ hợp rơi ra khỏi bảng này.
   *
   * Thứ tự có lý do: hỏng và đang chạy dở đứng TRƯỚC bố cục, vì `collapsed` chỉ
   * nói bề ngang màn hình chứ không nói được rằng dữ liệu chưa về. Nên
   * `collapsed` thay chỗ của `success`, không thay chỗ của sáu nhánh kia.
   */
  /**
   * Lý do của `partial` (B-V1-11). Thiếu phòng thắng mạng yếu: nó là sự thật về
   * mô hình, còn mạng có thể khá lên ngay. `data.isPartial` là cùng phép thử
   * "tầng có phòng" mà huy hiệu của dải tầng dùng (`floorHasRooms`).
   */
  const partialReason = useMemo((): MobilePartialReason | null => {
    if (data.isPartial) {
      return 'missing-rooms';
    }

    return isNetworkWeak ? 'weak-network' : null;
  }, [data.isPartial, isNetworkWeak]);

  const state = useMemo((): MobileViewerState => {
    if (isForbidden) {
      return 'forbidden';
    }
    if (sceneFailure !== null || projectQuery.isError) {
      return 'error';
    }
    if (
      projectQuery.isLoading ||
      spatialLoading ||
      (canvas !== null && hasGeometry && !isSceneMounted)
    ) {
      return 'loading';
    }
    if (!hasGeometry) {
      return 'empty';
    }
    if (partialReason !== null) {
      return 'partial';
    }
    if (isCompact) {
      return 'collapsed';
    }

    return 'success';
  }, [
    isForbidden,
    sceneFailure,
    projectQuery.isError,
    projectQuery.isLoading,
    spatialLoading,
    canvas,
    hasGeometry,
    isSceneMounted,
    partialReason,
    isCompact,
  ]);

  return {
    state,
    projectName,
    onShare: canShareLinks ? onShare : null,
    isCompact,
    activeTool,
    onSelectTool,
    floors,
    activeFloorId,
    onSelectFloor,
    selection,
    onDismissSelection,
    onSendDesktopLink: canShareLinks ? onSendDesktopLink : null,
    measurements,
    detailLabel: null,
    partialReason: state === 'partial' ? partialReason : null,
    // Bản 2D của cùng dự án là danh sách tầng — lối thoát luôn hợp lệ, kể cả
    // khi đồ thị chưa có tầng nào để đặt tên vào đường dẫn.
    fallback2dHref: ROUTES.project.floors(projectId),
    sceneNotice,
  };
}
