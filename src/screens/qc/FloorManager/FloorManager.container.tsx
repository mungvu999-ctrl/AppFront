/**
 * Màn S-16 "Quản lý tầng" đã NỐI DÂY — `useFloorManager` cộng `FloorManager`,
 * bọc trong ranh giới lỗi.
 *
 * Đây là thứ một màn khác gắn vào khung của nó bằng ĐÚNG MỘT THẺ (R-73):
 *
 * ```tsx
 * <FloorManagerContainer projectId={projectId} roles={session.roles} />
 * ```
 *
 * ## Ranh giới lỗi: bản ở `@/components/feedback`
 *
 * Đúng bản mà `src/App.tsx` đang gắn (R-62), **không** phải bản chưa nối ở
 * `src/lib/screen-state`. Phần dự phòng dựng bằng `EmptyState` từ
 * `report.description`, y hệt `ScreenCrashFallback` của `App.tsx`, nên màn
 * không bao giờ trắng (A11). `key={projectId}` lặp lại đúng ý
 * `key={activeScreen}`: đổi sang dự án khác thì ranh giới gắn LẠI, nên một lần
 * sập ở dự án này không để phần dự phòng nằm lại khi màn cha chuyển sang dự án
 * kia. Khuôn chép nguyên từ `AxisGridManager.container.tsx`.
 *
 * ## Lối ra duy nhất của màn có đường vào THẬT (R-73)
 *
 * Liên kết "tải lên" ở dòng tầng chưa có bản vẽ là hành động DUY NHẤT rời khỏi
 * màn. `useFloorManager` nhận nó qua `onNavigateToDrawings` và — khi vắng mặt —
 * chỉ chọn dòng đó rồi ĐỌC LÊN nơi cần tới thay vì giả vờ đã đi
 * (`useFloorManager.ts:709-722`). Nên nó không được để tồn tại như một prop
 * tuỳ chọn không ai truyền: {@link FloorManagerRoute} nối nó vào `useNavigate`
 * thật, đích là `ROUTES.project.upload(projectId)` — màn tải bản vẽ của dự án
 * (`FloorUploadRoute`, `ROUTE_PATTERNS.projectUpload`). Đó là màn tải bản vẽ
 * DUY NHẤT đang có route; bảng `ROUTES` không có đường nào mang theo mã tầng,
 * nên container KHÔNG bịa thêm một đường dẫn thứ hai (R-65).
 *
 * `@/routes/paths` chứ KHÔNG `@/routes`: `router.tsx` lazy-import mọi màn, và
 * một màn nhập ngược `@/routes` khép một vòng làm `pnpm cycles` đỏ (R-65).
 *
 * ## Toast hoàn tác đi qua `notificationBus`, KHÔNG qua `Toast.Provider`
 *
 * `useFloorManager` đẩy thông báo vào `appNotificationBus`, thứ mà
 * `NotificationHost` (`src/main.tsx`) vẽ ra bằng `Toast.Item` và nút "Hoàn tác"
 * của nó gọi `undoTicket.undo()` — đúng vé mà `createFloorUndoTicket` dựng. Bọc
 * thêm `Toast.Provider` quanh màn sẽ cho mỗi lượt commit MỘT toast thứ hai hoàn
 * tác bằng ngăn xếp **zundo**, tức một ngăn xếp khác với ngăn xếp lệnh của màn.
 * Nên container không bọc provider nào, và `notifications` vẫn là chỗ tiêm cho
 * bài kiểm. Tiền lệ: `AxisGridManager.container.tsx`, `WallLayerReview.container.tsx`.
 *
 * ## Khoảng trống đã biết: hai khả năng cổng chưa có
 *
 * `FLOOR_MANAGER_MISSING_CAPABILITIES` khai thẳng hai khoản
 * (`persistFloorContents`, `hideFloorFrom3d`): `ENDPOINTS` không có đường nào
 * cho chúng. Màn chạy TRONG BỘ NHỚ ở hai chỗ đó, cổng trả nhánh
 * `supported: false` CÓ KIỂU, và hook đọc lên câu giải thích. Không ai được bịa
 * một endpoint để lấp chỗ đó.
 */

import { useCallback, useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';

import { EmptyState } from '@/components/feedback/EmptyState';
import { InlineAlert } from '@/components/feedback/InlineAlert';
import {
  ScreenErrorBoundary,
  type ScreenErrorFallback,
} from '@/components/feedback/ScreenErrorBoundary';
import { useSeparateUnits, type SeparateUnitsState } from '@/hooks/useSeparateUnits';
import { useSession } from '@/hooks/useSession';
import type { Announcer } from '@/lib/input/announcer';
import type { ShortcutRegistry } from '@/lib/input/shortcutRegistry';
import type { NotificationBus } from '@/lib/mutations/notificationBus';
import { ROUTES } from '@/routes/paths';
import type { ProjectRole } from '@/types/project';

import { FloorManager } from './FloorManager';
import type { FloorManagerGateway } from './floorManagerGateway';
import type { FloorReviewScreen } from './floorManagerTypes';
import { FloorDrawingSetEntry } from './FloorDrawingSetEntry';
import { FloorProposalPanel } from './FloorProposalPanel';
import { useDrawingSetEntry } from './useDrawingSetEntry';
import { useFloorManager } from './useFloorManager';
import { useFloorProposals, type HouseProposalApi } from './useFloorProposals';

/** Mã màn, cho ranh giới lỗi và cho nhật ký — một chỗ viết duy nhất (R-71). */
export const FLOOR_MANAGER_SCREEN_ID = 'floor-manager';

const MISSING_PROJECT_TITLE = 'Thiếu mã dự án';
const MISSING_PROJECT_MESSAGE =
  'Đường dẫn không mang mã dự án, nên chưa mở được danh sách tầng. Quay lại bảng dự án rồi chọn lại dự án cần xem.';

/**
 * Props màn cha truyền vào.
 *
 * Hai trường đầu là những gì một màn khác cần biết để mở màn này; các trường
 * còn lại là chỗ tiêm của test và story (R-73 — bản giả phải cắm được vào, và
 * cắm CÙNG bộ mẫu chứ không bịa bảng dữ liệu thứ hai, R-70).
 */
export interface FloorManagerContainerProps {
  readonly projectId: string;
  readonly roles?: readonly ProjectRole[];
  /**
   * Đưa người dùng tới màn tải bản vẽ của một tầng.
   *
   * Điều hướng là việc của vỏ route (`react-router-dom` chỉ được nhập ở đây),
   * nên container nhận nó từ ngoài và {@link FloorManagerRoute} truyền bản
   * thật xuống. Vắng mặt thì liên kết "tải lên" chọn dòng đó và NÓI RA nơi tải
   * lên, chứ không giả vờ đã làm gì.
   */
  readonly onNavigateToDrawings?: (floorId: string) => void;
  /** Mở màn Đối chiếu lớp phủ (SCR-22) của tầng; route nối vào `useNavigate`. */
  readonly onNavigateToOverlay?: (floorId: string) => void;
  readonly onNavigateToFloorScreen?: (floorId: string, screen: FloorReviewScreen) => void;
  /** Lối về danh sách dự án khi dự án không tồn tại (404); {@link FloorManagerRoute} nối vào `useNavigate`. */
  readonly onBackToProjects?: (() => void) | undefined;
  /** Cổng dữ liệu tiêm được. Vắng mặt thì hook dựng bản thật, đúng một lần. */
  readonly gateway?: FloorManagerGateway;
  /** Sổ phím tiêm được — bài kiểm dựng sổ riêng để không đụng sổ dùng chung. */
  readonly registry?: ShortcutRegistry;
  /** Bus thông báo tiêm được — bài kiểm đọc toast hoàn tác trên bus của riêng nó. */
  readonly notifications?: NotificationBus;
  /** Bộ đọc `aria-live` tiêm được — bài kiểm nghe câu chặn trùng cao độ qua nó. */
  readonly announcer?: Announcer;
  /** Ép thu gọn lát cắt — cho story và bài kiểm muốn một câu trả lời cố định. */
  readonly forceCollapsed?: boolean;
  /** Lát cắt thu gọn lúc mở màn; route truyền `true` dưới 1280 px (bản Z). */
  readonly initialCollapsed?: boolean;
  /** Dưới 1.024px lát cắt xuống dưới bảng; màn cha đo bề rộng và truyền vào. */
  readonly isCompact?: boolean;
  /** K34: thiết lập "các căn hộ riêng" của dự án; route đọc N5 rồi truyền vào. Vắng thì không có công tắc. */
  readonly separateUnits?: SeparateUnitsState;
  /** K33: mở Mô hình 3D; route nối vào `useNavigate`. */
  readonly onOpenViewer?: () => void;
  /**
   * Cửa đọc đề xuất của máy (F4). Vắng: màn thật dựng client thật; màn có `gateway` tiêm (test,
   * story) KHÔNG đọc gì — bảng ẩn — trừ khi truyền cửa này. `null` = không đọc.
   */
  readonly proposalApi?: HouseProposalApi | null;
  /**
   * Mở màn "Tải cả bộ hồ sơ" (K-32b). Vắng thì lối vào không dựng: không nút nào không dẫn đi đâu.
   * Lối vào chỉ hiện khi công tắc bật (N52) và người dùng sửa được bản vẽ.
   */
  readonly onNavigateToDrawingSets?: () => void;
}

/** Cùng khuôn `ScreenCrashFallback` của `src/App.tsx` — R-62. */
function FloorManagerCrashFallback({ report, retry }: ScreenErrorFallback) {
  return (
    <div className="absolute inset-0 flex items-center justify-center bg-bg-app">
      <EmptyState
        description={report.description.description}
        icon={<div aria-hidden="true" className="h-8 w-8 rounded-full bg-state-violation-tint" />}
        title={report.description.title}
        {...(report.retryable
          ? { action: { label: report.description.primaryButtonLabel, onClick: retry } }
          : {})}
      />
    </div>
  );
}

/**
 * Hook cộng view, không có provider nào ở giữa.
 *
 * `exactOptionalPropertyTypes` bật, nên một prop tuỳ chọn vắng mặt phải VẮNG
 * MẶT chứ không mang giá trị `undefined` — cùng khuôn trải có điều kiện của
 * `AxisGridManager.container.tsx`.
 */
function WiredFloorManager(props: FloorManagerContainerProps) {
  const result = useFloorManager({
    projectId: props.projectId,
    ...(props.roles !== undefined ? { roles: props.roles } : {}),
    ...(props.gateway !== undefined ? { gateway: props.gateway } : {}),
    ...(props.registry !== undefined ? { registry: props.registry } : {}),
    ...(props.notifications !== undefined ? { notifications: props.notifications } : {}),
    ...(props.announcer !== undefined ? { announcer: props.announcer } : {}),
    ...(props.forceCollapsed !== undefined ? { forceCollapsed: props.forceCollapsed } : {}),
    ...(props.initialCollapsed !== undefined ? { initialCollapsed: props.initialCollapsed } : {}),
    ...(props.isCompact !== undefined ? { isCompact: props.isCompact } : {}),
    ...(props.onNavigateToDrawings !== undefined
      ? { onNavigateToDrawings: props.onNavigateToDrawings }
      : {}),
  });
  const proposals = useFloorProposals(props.projectId, result.rows, {
    apply: result.applyLevelValue,
    // Cùng việc ô nhập tay làm khi chốt: chỉ bỏ nháp của tầng đó, để lần rời ô sau không ghi nháp cũ đè giá trị
    // vừa nhận — không xoá dấu "cao độ trùng" hay ô đang sửa của tầng khác (khác `onFloorFieldCancel`).
    releaseDraft: result.releaseFloorDraft,
    canEdit: result.canEdit,
    api: props.proposalApi ?? (props.gateway === undefined ? undefined : null),
  });

  const showDrawingSetEntry = useDrawingSetEntry(props.projectId, {
    canEdit: result.canEdit && props.onNavigateToDrawingSets !== undefined,
    api: props.proposalApi ?? (props.gateway === undefined ? undefined : null),
  });

  return (
    <FloorManager
      {...(proposals.hidden ? {} : { proposalPanel: <FloorProposalPanel {...proposals.panel} /> })}
      {...(showDrawingSetEntry && props.onNavigateToDrawingSets !== undefined
        ? { drawingSetEntry: <FloorDrawingSetEntry onOpen={props.onNavigateToDrawingSets} /> }
        : {})}
      bands={result.bands}
      canEdit={result.canEdit}
      duplicateElevationMessage={result.duplicateElevationMessage}
      duplicateElevationViolation={result.duplicateElevationViolation}
      elevationTicks={result.elevationTicks}
      emptyNotice={result.emptyNotice}
      errorMessage={result.errorMessage}
      footer={result.footer}
      isProjectMissing={result.isProjectMissing}
      onBackToProjects={props.onBackToProjects}
      forbiddenNotice={result.forbiddenNotice}
      isAutoElevation={result.isAutoElevation}
      isCollapsed={result.isCollapsed}
      isCompact={result.isCompact}
      onAddFloor={result.onAddFloor}
      onDuplicateFloor={result.onDuplicateFloor}
      onFloorFieldCancel={result.onFloorFieldCancel}
      onFloorFieldChange={result.onFloorFieldChange}
      onFloorFieldCommit={result.onFloorFieldCommit}
      onHoverFloor={result.onHoverFloor}
      onRemoveFloor={result.onRemoveFloor}
      onReorderFloors={result.onReorderFloors}
      onRetry={result.onRetry}
      onSelectFloor={result.onSelectFloor}
      onToggleAutoElevation={result.onToggleAutoElevation}
      onToggleCollapsed={result.onToggleCollapsed}
      onToggleHiddenIn3d={result.onToggleHiddenIn3d}
      onUndo={result.onUndo}
      onOpenOverlay={props.onNavigateToOverlay}
      onOpenFloorScreen={props.onNavigateToFloorScreen}
      onUploadDrawing={result.onUploadDrawing}
      rows={result.rows}
      state={result.state}
      totalHeightText={result.totalHeightText}
      unsupportedNotices={result.unsupportedNotices}
      axisMismatchNotice={result.axisMismatchNotice}
      projectName={result.projectName}
      onOpenViewer={props.onOpenViewer}
      {...(props.separateUnits === undefined
        ? {}
        : {
            separateUnits: props.separateUnits.separateUnits,
            isSeparateUnitsSaving: props.separateUnits.isSaving,
            separateUnitsError: props.separateUnits.saveError,
            onToggleSeparateUnits: props.separateUnits.setSeparateUnits,
          })}
    />
  );
}

/** `<FloorManagerContainer … />` — màn S-16 thật, đã nối, gắn được bằng một thẻ. */
export function FloorManagerContainer(props: FloorManagerContainerProps) {
  return (
    <ScreenErrorBoundary
      key={props.projectId}
      renderFallback={({ report, retry }) => (
        <FloorManagerCrashFallback report={report} retry={retry} />
      )}
      screenId={FLOOR_MANAGER_SCREEN_ID}
    >
      <WiredFloorManager {...props} />
    </ScreenErrorBoundary>
  );
}

/** Ngưỡng thu hẹp của bản thiết kế (`notes/floor-manager/blueprint.md` mục E). */
const COMPACT_QUERY = '(width < 1024px)';
/** Dưới 1280 px bảng cạnh lát cắt không đủ rộng: lát cắt mặc định thu gọn (bản Z). */
const NARROW_FOR_SECTION_CUT_QUERY = '(width < 1280px)';

/**
 * Lớp trên đo bề rộng cho `isCompact` (BUG-251: trước đây không ai đo nên màn không bao giờ
 * thu hẹp). Bản chép ngắn của `useIsNarrow` ở `UserManagement.container.tsx`: `useBreakpoint`
 * của `useAppShell.ts` là hàm riêng tư.
 */
function useIsCompact(): boolean {
  const [isCompact, setIsCompact] = useState(() => window.matchMedia(COMPACT_QUERY).matches);

  useEffect(() => {
    const media = window.matchMedia(COMPACT_QUERY);
    const listener = (event: MediaQueryListEvent): void => {
      setIsCompact(event.matches);
    };

    setIsCompact(media.matches);
    media.addEventListener('change', listener);

    return (): void => {
      media.removeEventListener('change', listener);
    };
  }, []);

  return isCompact;
}

/** Bên trong router thật, nên `useNavigate` chắc chắn tìm được provider. */
function FloorManagerRouteBody({
  projectId,
  roles,
}: {
  readonly projectId: string;
  readonly roles: readonly ProjectRole[];
}) {
  const navigate = useNavigate();
  const isCompact = useIsCompact();
  const separateUnits = useSeparateUnits(projectId);
  const [initialCollapsed] = useState(() => window.matchMedia(NARROW_FOR_SECTION_CUT_QUERY).matches);

  /*
   * Lối ra thật của liên kết "tải lên". `ROUTES.project.upload` là đường DUY
   * NHẤT tới màn tải bản vẽ và nó nhận mã dự án, không mã tầng; mã tầng vẫn đi
   * xuống hook để dòng đó được CHỌN trước khi màn đổi, nên người dùng quay lại
   * vẫn thấy đúng tầng mình vừa bấm.
   */
  const handleNavigateToDrawings = useCallback(() => {
    navigate(ROUTES.project.upload(projectId));
  }, [navigate, projectId]);

  const handleNavigateToOverlay = useCallback(
    (floorId: string) => {
      navigate(ROUTES.project.overlay(projectId, floorId));
    },
    [navigate, projectId],
  );

  const handleNavigateToFloorScreen = useCallback(
    (floorId: string, screen: FloorReviewScreen) => {
      navigate(ROUTES.project[screen](projectId, floorId));
    },
    [navigate, projectId],
  );

  const handleBackToProjects = useCallback(() => {
    navigate(ROUTES.dashboard);
  }, [navigate]);

  const handleOpenViewer = useCallback(() => {
    navigate(ROUTES.project.viewer(projectId));
  }, [navigate, projectId]);

  const handleOpenDrawingSets = useCallback(() => {
    navigate(ROUTES.project.drawingSets(projectId));
  }, [navigate, projectId]);

  // Không vỏ nào cấp chiều cao cho route này: thiếu khung `h-dvh` thì `h-full` của màn
  // không bám vào đâu, khung bảng cao bằng 50 tầng và cả trang cuộn (BUG-520).
  return (
    <div className="h-dvh">
      <FloorManagerContainer
        initialCollapsed={initialCollapsed}
        isCompact={isCompact}
        onBackToProjects={handleBackToProjects}
        onNavigateToDrawingSets={handleOpenDrawingSets}
        onNavigateToDrawings={handleNavigateToDrawings}
        onNavigateToFloorScreen={handleNavigateToFloorScreen}
        onNavigateToOverlay={handleNavigateToOverlay}
        onOpenViewer={handleOpenViewer}
        projectId={projectId}
        roles={roles}
        separateUnits={separateUnits}
      />
    </div>
  );
}

/** Route thật của màn Quản lý tầng, đăng ký tại `src/routes/router.tsx`. */
export function FloorManagerRoute() {
  const { projectId: id } = useParams<{ projectId: string }>();
  const session = useSession();

  if (id === undefined || id.length === 0) {
    return (
      <div className="p-6">
        <InlineAlert
          level="violation"
          message={MISSING_PROJECT_MESSAGE}
          title={MISSING_PROJECT_TITLE}
        />
      </div>
    );
  }

  return <FloorManagerRouteBody projectId={id} roles={session.roles} />;
}
