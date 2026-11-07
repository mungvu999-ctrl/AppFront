/**
 * Route `ROUTE_PATTERNS.projectExport` — nối hook với view, và với ranh giới
 * lỗi. Cùng khuôn `RuleSettings.container.tsx`.
 *
 * ## Vai không phải một prop, và cũng không phải việc của container
 *
 * `ExportPanelContainerProps` cố ý không có trường `roles`: màn gọi container
 * này không cần biết chuyện phân quyền. Lượt gộp còn đi thêm một bước — phép
 * đọc quyền nằm **trọn** trong `useExportPanel`, không lặp lại ở đây. Hook đọc
 * vai theo dự án đang mở trước, lấy vai của phiên đăng nhập làm dự phòng, rồi
 * hỏi đúng cổng phân quyền dùng chung `can('export', 'model', { roles })`
 * (`@/lib/auth/permissions.ts`) — cùng khoá `model.export` mà
 * `l1b-format-telemetry.md` đã khảo sát: `admin: true`, `engineer: true`,
 * `viewer: false`. Vai Người xem không xuất được **bất cứ định dạng nào** —
 * khoá này gác cả bốn, không có quyền riêng cho ảnh dù đặc tả cũ có nói vậy.
 * `false` là lý do hook trả trạng thái `forbidden` kèm `permissionCaption`.
 *
 * Container **từng** tự tính `canExport` từ `useSession().roles` rồi truyền
 * xuống. Đó là hai nguồn sự thật cho cùng một câu hỏi, và nguồn của container
 * hẹp hơn — nó không thấy vai theo dự án — nên lượt gộp bỏ nó đi thay vì để hai
 * phép đọc chạy song song rồi có ngày lệch nhau.
 *
 * ## `onNavigateToFix` — có mặc định thật, không phải một prop chết
 *
 * Mỗi `PreflightRow.fixHref` là một đường dẫn thật lấy từ `ROUTES` (không phải
 * một khả năng còn thiếu như `onUploadModel` của `FurnitureLibraryPanel`), nên
 * để hành động này là một prop tuỳ chọn không ai truyền sẽ biến nút "sửa"
 * thành một nút chết — đúng lỗi R-73 sinh ra để chặn. Container tự có
 * `useNavigate()` làm mặc định; `onNavigateToFix` chỉ tồn tại để một màn nhúng
 * container này thay bằng điều hướng riêng của nó.
 *
 * ## Không có `announcer`, `now` hay `isOnline` — và `onToast` chỉ đi tới hộp thoại chia sẻ
 *
 * Bốn prop (kể cả `onToast`) từng đứng ở đây như những khe cắm tuỳ chọn. `useExportPanel` —
 * viết song song trên nhánh khác — không nhận cái nào: repo chưa có nhà cung
 * cấp toast toàn cục, hook không xướng gì riêng, còn đồng hồ lẫn trạng thái
 * mạng đều đọc từ tầng dưới. Một prop không đi tới đâu là đúng thứ R-73 tồn
 * tại để chặn, nên lượt gộp gỡ cả bốn thay vì giữ một chữ ký đẹp mà rỗng.
 * `onToast` quay lại vì nó CÓ chỗ đi: hộp thoại chia sẻ phát toast (A8 đổi quyền),
 * và thiếu nó thì mọi câu ấy câm trên route thật (B-V3-07). `ExportPanelRoute`
 * dựng `Toast.Provider` như `ProjectSettingsRoute`.
 *
 * Ranh giới lỗi là bản ở `@/components/feedback` — bản `src/App.tsx` đang gắn
 * (R-62), **không** phải bản chưa nối ở `src/lib/screen-state`. Phần dự phòng
 * dựng bằng `EmptyState` từ `report.description`, cùng khuôn `RuleSettings`.
 *
 * ## "chia sẻ" mở `ShareDialogContainer` — vai đọc lại, không đọc chung
 *
 * `ShareDialogContainerProps.roles` là quyền của MỘT hộp thoại khác
 * (`can('create', 'share', …)`), không phải `model.export` mà `useExportPanel`
 * đã tự đọc cho quyền xuất. Container đọc vai lần thứ hai ở đây — cùng khuôn
 * "vai theo dự án trước, vai phiên đăng nhập sau" của `useExportPanel.ts:277`
 * và của `VersionHistory.container.tsx` — thay vì mở rộng hợp đồng của
 * `useExportPanel` để lộ ra một con số nó không dùng cho chính nó.
 *
 * `isShareOpen` sống ở container, không ở hook: đây là trạng thái CỦA MÀN NÀY
 * mở màn kia, không phải một phần "suy nghĩ của màn Xuất" mà
 * `useExportPanel.ts` mô tả nó giữ. Cùng khuôn `ProjectDashboard.container.tsx`
 * giữ `isCreateOpen` cho `CreateProjectModalContainer`.
 */

import { useState } from 'react';
import { useLocation, useNavigate, useParams } from 'react-router-dom';

import { EmptyState } from '@/components/feedback/EmptyState';
import { ProjectSpatialGate } from '@/components/feedback/ProjectSpatialGate';
import { InlineAlert } from '@/components/feedback/InlineAlert';
import { Toast, useToast } from '@/components/feedback/Toast';
import {
  ScreenErrorBoundary,
  type ScreenErrorFallback,
} from '@/components/feedback/ScreenErrorBoundary';
import { useSession } from '@/hooks/useSession';
import { SHARE_LINKS_SUPPORTED } from '@/lib/export/shareLink';
import { ShareDialogContainer } from '@/screens/export/ShareDialog';
import { ROUTES } from '@/routes/paths';
import { useStore } from '@/store';
import type { ProjectRole } from '@/types/project';

import { EditorTourContainer } from '@/screens/system/EditorTour';
import { ExportPanel } from './ExportPanel';
import { useExportPanel } from './useExportPanel';
import { isServerGlbEnabled, useServerGlbExport } from './useServerGlbExport';

const SERVER_GLB_ENABLED = isServerGlbEnabled();

/** Tên màn này với ranh giới lỗi, và với bất cứ ai đọc báo cáo của nó. */
const SCREEN_ID = 'export-panel';

const MISSING_PARAMS_TITLE = 'Thiếu mã dự án';
const MISSING_PARAMS_MESSAGE =
  'Đường dẫn không mang mã dự án, nên chưa mở được màn xuất. Quay lại danh sách dự án rồi chọn lại dự án cần xuất.';

/** Props thật của container — mọi thứ một màn khác cần để mở màn này (R-73). */
export interface ExportPanelContainerProps {
  /** Mã dự án. Khi có, dùng nó thay vì đọc URL — để màn khác nhúng được container. */
  readonly projectId?: string;
  /** Vỏ ngoài báo màn đang ở chế độ thu gọn (`isCollapsed` của A11 trạng thái 7). */
  readonly isCompact?: boolean;
  /**
   * Điều hướng khi bấm "sửa" ở một dòng kiểm tra trước khi xuất. Mặc định là
   * `useNavigate()` thật của container — chỉ truyền prop này khi một màn khác
   * nhúng container và cần tự quyết định cách điều hướng.
   */
  readonly onNavigateToFix?: (href: string) => void;
  /**
   * Toast của hộp thoại chia sẻ (A8: đổi quyền kèm "Hoàn tác"). Vắng nó thì mọi
   * câu báo của hộp thoại câm — đúng chuyện từng xảy ra trên route thật (B-V3-07).
   */
  readonly onToast?: (toast: { readonly message: string; readonly onUndo?: () => void }) => void;
}

/** Cùng khuôn `RuleSettingsCrashFallback` — R-62, chữ lấy từ `report.description`. */
function ExportPanelCrashFallback({ report, retry }: ScreenErrorFallback) {
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

interface WiredExportPanelProps extends Omit<ExportPanelContainerProps, 'projectId'> {
  readonly projectId: string;
}

/**
 * Hook cộng view, không có provider nào ở giữa.
 *
 * `exactOptionalPropertyTypes` bật, nên một prop tuỳ chọn vắng mặt phải VẮNG
 * MẶT chứ không mang giá trị `undefined` — cùng khuôn trải có điều kiện của
 * `RuleSettings.container.tsx`.
 */
function WiredExportPanel(props: WiredExportPanelProps) {
  const navigate = useNavigate();
  const session = useSession();
  const storeRoles = useStore((state) => state.userRoles);
  const roles: readonly ProjectRole[] = storeRoles.length > 0 ? storeRoles : session.roles;

  const location = useLocation();
  // "Gửi người nhà" ở màn 3D mở Xuất với `?share=1` để vào thẳng hộp Chia sẻ.
  const [isShareOpen, setShareOpen] = useState(() => new URLSearchParams(location.search).get('share') === '1');

  const onNavigate =
    props.onNavigateToFix ??
    ((href: string) => {
      void navigate(href);
    });

  // UX-25: đã đồng ý "Vẫn sang Xuất" ở Quy chuẩn thì Xuất không hỏi lại.
  const routeState = location.state as { readonly exportConfirmed?: boolean } | null;

  const viewProps = useExportPanel({
    exportAlreadyConfirmed: routeState?.exportConfirmed === true,
    onNavigate,
    onShare: () => setShareOpen(true),
    projectId: props.projectId,
    ...(props.isCompact !== undefined ? { isCompact: props.isCompact } : {}),
  });
  const serverGlb = useServerGlbExport({ enabled: SERVER_GLB_ENABLED, projectId: props.projectId });
  const glbSelected = viewProps.formats.some((format) => format.id === 'glb' && format.isSelected);
  const exportOnServer = SERVER_GLB_ENABLED && glbSelected && serverGlb.view.engine === 'server';

  return (
    <>
      <ExportPanel
        {...viewProps}
        serverGlb={SERVER_GLB_ENABLED ? serverGlb.view : null}
        onExport={exportOnServer ? serverGlb.start : viewProps.onExport}
        onBackToProject={() => {
          void navigate(ROUTES.project.floors(props.projectId));
        }}
        onOpenData={() => {
          void navigate(ROUTES.project.data(props.projectId));
        }}
      />
      {/* Chip đứng sát trên chân dính đáy (cao 69 px + 7 px hở), không `bottom-24` mặc định: ở 1280×720
          mốc ấy đè nút "Tuỳ chọn" của cột phải (B-V2-05, e2e/v2v3/tour-chip.spec.ts). */}
      {viewProps.status !== 'forbidden' && <EditorTourContainer hostId="export-panel" chipAnchorClassName="bottom-[76px] right-4" />}
      {SHARE_LINKS_SUPPORTED && (
        <ShareDialogContainer
          isOpen={isShareOpen}
          onDismiss={() => setShareOpen(false)}
          projectId={props.projectId}
          roles={roles}
          {...(props.onToast !== undefined ? { onToast: props.onToast } : {})}
        />
      )}
    </>
  );
}

/**
 * `<ExportPanelContainer />` khi gắn qua router (đọc `:id` từ URL), hoặc
 * `<ExportPanelContainer projectId={...} />` khi một màn khác nhúng nó.
 */
export function ExportPanelContainer(props: ExportPanelContainerProps) {
  const params = useParams<{ projectId: string }>();
  const projectId = props.projectId ?? params.projectId;

  if (projectId === undefined || projectId.length === 0) {
    return (
      <div className="p-6">
        <InlineAlert
          level="violation"
          message={MISSING_PARAMS_MESSAGE}
          title={MISSING_PARAMS_TITLE}
        />
      </div>
    );
  }

  return (
    <ScreenErrorBoundary
      key={projectId}
      renderFallback={({ report, retry }) => (
        <ExportPanelCrashFallback report={report} retry={retry} />
      )}
      screenId={SCREEN_ID}
    >
      <WiredExportPanel
        projectId={projectId}
        {...(props.isCompact !== undefined ? { isCompact: props.isCompact } : {})}
        {...(props.onNavigateToFix !== undefined ? { onNavigateToFix: props.onNavigateToFix } : {})}
        {...(props.onToast !== undefined ? { onToast: props.onToast } : {})}
      />
    </ScreenErrorBoundary>
  );
}

/** Bên trong `Toast.Provider`, nên `useToast` ở đây chắc chắn tìm được provider. */
function ExportPanelRouteBody() {
  const { addToast } = useToast();

  return <ExportPanelContainer onToast={addToast} />;
}

/** Route thật của màn xuất, đăng ký tại `src/routes/router.tsx`. */
export function ExportPanelRoute() {
  const { projectId } = useParams<{ projectId: string }>();

  // Khung `h-dvh`: không vỏ nào cấp chiều cao cho route này, thiếu nó thì `h-full` của màn ra
  // auto và chân dính nằm giữa trang thay vì đáy khung nhìn (QA-06b K1, khuôn BUG-520).
  return (
    <div className="h-dvh">
      <Toast.Provider>
        <ProjectSpatialGate projectId={projectId}>
          <ExportPanelRouteBody />
        </ProjectSpatialGate>
      </Toast.Provider>
    </div>
  );
}
