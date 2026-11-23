/* eslint-disable react-refresh/only-export-components -- file này xuất `router`,
 * tức bảng route, nên fast refresh không có gì để làm mới ở đây dù trong file có
 * định nghĩa `UndoShortcuts`. `UndoShortcuts` được xuất có chủ đích: xem docblock
 * của nó — một binding không test được là một binding không ai chứng minh được. */
import { AdminNav } from '../components/shell/AdminNav';
import { AdminGate } from '../screens/admin/AdminGate';
import React, { lazy, useCallback, useEffect, useState } from 'react';
import {
  createBrowserRouter,
  Navigate,
  Outlet,
  useLocation,
  type RouteObject,
} from 'react-router-dom';

import { ScreenMain } from '@/components/shell/ScreenMain';
import { flushAutosaves } from '@/hooks/useAutosave';
import { useShortcut } from '@/hooks/useShortcut';
import {
  buildGlobalShortcuts,
  type GlobalShortcutHandlers,
  type ShortcutDefinition,
} from '@/lib/input/shortcutRegistry';
import { useStore } from '@/store';

import { AppLayout } from './AppLayout';
import { ROUTE_PATTERNS } from './paths';
import { ExplodedViewRedirect, MeasureViewRedirect, Pascal3dPage, PascalViewerRedirect } from './viewerRedirects';
import { RouteErrorScreen } from './RouteErrorScreen';
import { SessionBootstrap } from './SessionBootstrap';
import { SlowPendingShell } from './SlowPendingShell';
// Màn nạp lười: khai ở `lazyScreens.ts` để file này dưới trần 400 dòng.
import * as Screens from './lazyScreens';

/**
 * Vỏ chờ dùng chung, để hai mươi mấy route không mỗi chỗ viết một kiểu.
 *
 * Từng là `<div>Loading...</div>`: chữ tiếng Anh trên màn sản phẩm (A6) và một ô
 * trống ở góc thay cho trạng thái chờ (A11) — B-G-04. Nay là đúng vỏ chờ của
 * `SessionGate`, nên lượt tải chunk nối liền lượt mở phiên mà không nháy.
 * `PendingShell` đã nằm trong chunk vào (qua `SessionBootstrap`), nhập lại nó
 * không thêm byte nào vào đường tải đầu.
 */
const suspended = (node: React.ReactNode) => (
  <React.Suspense fallback={<SlowPendingShell label="Đang tải màn hình" />}>{node}</React.Suspense>
);

/**
 * Như {@link suspended}, cho route NGOÀI nhóm `ScreenMain` (FIX-381): không có
 * `main` bọc ngoài, nên lúc chờ chunk vỏ chờ phải tự mang `main`. Route trong
 * nhóm dùng `suspended` — bọc ở đó là hai `main`.
 */
const suspendedOutsideMain = (node: React.ReactNode) => (
  <React.Suspense
    fallback={
      <ScreenMain>
        <SlowPendingShell label="Đang tải màn hình" />
      </ScreenMain>
    }
  >
    {node}
  </React.Suspense>
);


/**
 * Bảy màn demo, và **chỉ trong bản dev**.
 *
 * Không phải chuyện gọn gàng. Trước lượt này `routes.tsx` chưa nơi nào import,
 * nên Vite không dựng route nào cả. Vừa gắn `RouterProvider` là bảy màn demo —
 * bảng chọn, design system, bốn màn demo tính năng — đi thẳng vào gói người dùng
 * tải về: gần 50 KiB gzip điều khiển dành cho lập trình viên, đúng thứ mục B nói
 * không được xuất hiện trên màn sản phẩm.
 *
 * `lazy(...)` nằm **trong** hàm này chứ không ở cấp module, và đó là điểm mấu
 * chốt: Rollup coi một lời gọi hàm ở cấp module là có thể có tác dụng phụ nên
 * không dám bỏ, và bảy chunk vẫn được dựng dù không route nào trỏ tới — đã đo,
 * đúng như vậy. Nằm trong hàm thì khi `import.meta.env.DEV` bị Vite thay bằng
 * `false`, cả hàm thành mã không ai gọi và bảy chunk biến mất cùng nó.
 */
function buildDevOnlyRoutes(): RouteObject[] {
  const RouteDemoGallery = lazy(() => import('../App').then(m => ({ default: m.App })));
  const RouteDesignSystem = lazy(() => import('../screens/DesignSystem').then(m => ({ default: m.DesignSystem })));
  const RouteDataEntryDemo = lazy(() => import('../screens/DataEntryDemo').then(m => ({ default: m.DataEntryDemo })));
  const RouteListReviewDemo = lazy(() => import('../screens/ListReviewDemo').then(m => ({ default: m.ListReviewDemo })));
  const RouteShellDemo = lazy(() => import('../screens/ShellDemo').then(m => ({ default: m.ShellDemo })));
  const RouteCanvasOverlaysDemo = lazy(() => import('../screens/CanvasOverlaysDemo').then(m => ({ default: m.CanvasOverlaysDemo })));
  const RouteFeedbackDemo = lazy(() => import('../screens/FeedbackDemo').then(m => ({ default: m.FeedbackDemo })));
  const RouteWelcomeLab = lazy(() => import('../screens/landing-lab/LabRoute').then(m => ({ default: m.LabRoute })));

  return [
    { path: ROUTE_PATTERNS.demoGallery, element: suspended(<RouteDemoGallery />) },
    { path: ROUTE_PATTERNS.designSystem, element: suspended(<RouteDesignSystem />) },
    { path: ROUTE_PATTERNS.dataEntryDemo, element: suspended(<RouteDataEntryDemo />) },
    { path: ROUTE_PATTERNS.listReviewDemo, element: suspended(<RouteListReviewDemo />) },
    { path: ROUTE_PATTERNS.shellDemo, element: suspended(<RouteShellDemo />) },
    { path: ROUTE_PATTERNS.canvasOverlaysDemo, element: suspended(<RouteCanvasOverlaysDemo />) },
    { path: ROUTE_PATTERNS.feedbackDemo, element: suspended(<RouteFeedbackDemo />) },
    { path: ROUTE_PATTERNS.welcomeLab, element: suspendedOutsideMain(<RouteWelcomeLab />) },
  ];
}

const DEV_ONLY_ROUTES: RouteObject[] = import.meta.env.DEV ? buildDevOnlyRoutes() : [];

/**
 * Màn duyệt bảy trạng thái (S-47), và **chỉ trong bản dev** — cùng lý do và
 * cùng khuôn với {@link buildDevOnlyRoutes} ngay trên: `lazy(...)` khai TRONG
 * hàm chứ không ở cấp module, để nhánh production bỏ được cả thân hàm lẫn
 * `import()` động bên trong nó. Đã đo bằng một chunk mang chuỗi đánh dấu:
 * `grep` trong `dist/` ra RỖNG.
 *
 * Nó đứng riêng chứ không nhập chung vào `buildDevOnlyRoutes` để giữ nguyên chỗ
 * của route trong mảng `children` — đúng chỗ route tạm cũ nằm, giữa
 * `mobileViewer` và `notFound`.
 *
 * Đường nhập ghi rõ `/index`: thư mục `screens/system/StateGallery/` có một file
 * anh em cùng tên `screens/system/StateGallery.tsx` (bảng demo QA cũ mà
 * `src/App.tsx` đang dùng), và cả Vite lẫn tsc đều ưu tiên file .tsx hơn thư
 * mục. Bỏ `/index` đi là nhập nhầm sang màn demo cũ, thứ không xuất
 * `StateGalleryRoute` nào cả.
 */
function buildStateGalleryDevOnlyRoutes(): RouteObject[] {
  const RouteStateGallery = lazy(() => import('../screens/system/StateGallery/index').then(m => ({ default: m.StateGalleryRoute })));

  return [{ path: ROUTE_PATTERNS.designSystemStates, element: suspendedOutsideMain(<RouteStateGallery />) }];
}

const STATE_GALLERY_DEV_ONLY_ROUTES: RouteObject[] = import.meta.env.DEV
  ? buildStateGalleryDevOnlyRoutes()
  : [];

/* -------------------------------------------------------------------------- */
/* Bàn phím của vỏ ứng dụng.                                                   */
/* -------------------------------------------------------------------------- */

/**
 * Bảng phím tắt tải muộn — cùng lý do bảy màn demo ở trên tải muộn (mục B: gói
 * người dùng không mang thứ chưa được yêu cầu).
 *
 * `UndoShortcuts` bọc cả ba mươi route, nên bất cứ thứ gì nó nhập TĨNH đều nằm
 * trong đường tải đầu tiên của MỌI màn — đã đo: nhập tĩnh đẩy "chunk vào" từ
 * 128,7 KiB lên 171,1 KiB (vượt trần 170 KiB của `pnpm size`), vì
 * `GlobalShortcutHelp` kéo theo `framer-motion` qua `@/components/motion` mà
 * trước đó chỉ những màn tải muộn mới chạm tới. `lazy()` + `Suspense` tách nó
 * ra một chunk riêng, chỉ tải khi người dùng bấm `?` lần đầu — đúng lúc cần,
 * không phải lúc mở trang.
 */
const LazyGlobalShortcutHelp = lazy(() =>
  import('@/components/shell/GlobalShortcutHelp').then((m) => ({
    default: m.GlobalShortcutHelp,
  })),
);

/**
 * Sáu tay cầm không bao giờ được gọi tới, chỉ để **đếm được**.
 *
 * `buildGlobalShortcuts` là bảng DUY NHẤT đánh vần các tổ hợp toàn cục, và nó
 * đòi đủ sáu tay cầm trước khi đưa ra bất cứ định nghĩa nào. Năm trong sáu
 * định nghĩa được lấy bên dưới (`globalShortcut` gọi trong `UndoShortcuts`),
 * và cả năm đều bị thay `onTrigger` trên đường ra, nên không hàm nào trong đối
 * tượng này có đường chạy tới. Đúng kiểu mượn mà `buildShortcutRows` dùng ở
 * `useAccountTables.ts:236` để dựng bảng phím tắt của màn tài khoản: một chuỗi
 * `'Ctrl+Z'` viết tay ở đây là một nguồn thứ hai, và nguồn thứ hai thì lệch.
 */
const UNREACHABLE_HANDLERS: GlobalShortcutHandlers = {
  undo: (): void => undefined,
  redo: (): void => undefined,
  save: (): void => undefined,
  openSearch: (): void => undefined,
  openShortcutHelp: (): void => undefined,
  closeTopLayer: (): void => undefined,
};

/** Một binding lấy từ bảng toàn cục, gắn tay cầm thật của vỏ vào. */
function globalShortcut(id: string, onTrigger: () => void): ShortcutDefinition {
  const definition = buildGlobalShortcuts(UNREACHABLE_HANDLERS).find((entry) => entry.id === id);

  if (definition === undefined) {
    throw new Error(`không có phím tắt toàn cục nào mang id ${id}`);
  }

  return { ...definition, onTrigger };
}

/**
 * Ba phím không mang state của component nào — hoàn tác đọc thẳng cửa sổ gộp
 * của kho, Ctrl+S đọc sổ engine tự lưu dùng chung, không phím nào đọc gì từ
 * `UndoShortcuts`. Nên một đối tượng dựng đúng một
 * lần ở cấp module cũng là một lượt đăng ký đứng yên; hai phím còn lại (`?` và
 * Escape) cần trạng thái của chính `UndoShortcuts` nên được dựng lại mỗi lượt
 * render, ngay trong thân component — `useShortcut` chấp nhận việc đó, vì
 * handler được đọc qua ref (`hooks/useShortcut.ts:86-89`), không nằm trong
 * mảng phụ thuộc của lượt đăng ký.
 */
const UNDO_SHORTCUT = globalShortcut('global.undo', (): void => {
  useStore.temporal.getState().undo();
});

const REDO_SHORTCUT = globalShortcut('global.redo', (): void => {
  useStore.temporal.getState().redo();
});

/**
 * Ctrl+S — xả bộ tự lưu đang gắn thay vì đợi hết 800 ms.
 *
 * Cùng lý do hai phím trên đứng ở cấp module: `flushAutosaves` đọc sổ engine
 * dùng chung của `hooks/useAutosave.ts`, không đọc gì từ `UndoShortcuts`.
 */
const SAVE_SHORTCUT = globalShortcut('global.save', (): void => {
  void flushAutosaves();
});

/**
 * Bàn phím của vỏ ứng dụng: hoàn tác, làm lại, lưu ngay, bảng phím tắt, đóng
 * lớp trên cùng — và đúng chừng đó.
 *
 * Cả năm từng có tầng lệnh đứng sau nhưng không phím nào chạm tới được:
 * `useGlobalShortcuts` (`hooks/useShortcut.ts:172`) được xuất mà không nơi nào
 * gọi, nên không màn nào trong repo có bàn phím vỏ. Component này là chỗ đứng
 * cho `useShortcut`, vì `useShortcut` là hook nên nối một phím thì buộc phải
 * có một component.
 *
 * Nó nằm ở **bảng route** chứ không ở `src/main.tsx` vì hai lý do, và lý do thứ
 * hai mới là lý do quyết định:
 *
 * 1. Ở đây "mọi route đều có" là một sự thật CẤU TRÚC: bảng route bên dưới có
 *    đúng một route gốc không path, ba mươi route kia là con của nó. Thêm một
 *    route mới không thể quên phím tắt được.
 * 2. `src/main.tsx` gọi `createRoot(...).render(...)` ở cấp module, nên không
 *    bài kiểm nào import được nó. Đặt binding ở đó thì phép nghiệm thu chỉ còn
 *    cách tự dựng lại một bản sao của binding rồi kiểm bản sao — tức là không
 *    chứng minh gì cả (R-70). Ở đây thì `PropertyInspector.test.tsx` mount đúng
 *    component sản phẩm này, gõ Ctrl+Z thật, và đo độ dày trong store.
 *
 * `src/main.tsx` vì thế KHÔNG đổi một dòng nào: thứ tự provider mà docblock của
 * nó lập luận rất kỹ — `QueryClientProvider` ngoài cùng, `MotionProvider` bọc cả
 * vỏ, `RouterProvider` trong cùng, `NotificationHost` là anh em chứ không phải
 * cha hay con — được giữ nguyên vẹn theo cách an toàn nhất: không đụng vào.
 *
 * ## Vì sao chỉ năm, không phải sáu
 *
 * `useGlobalShortcuts` đăng ký cả sáu phím toàn cục một lượt, mà registry gọi
 * `preventDefault()` cho mọi lượt khớp không xin miễn (`shortcutRegistry.ts:466`)
 * — nên nối một tay cầm rỗng vào một phím không phải là để dành chỗ, nó là lấy
 * mất một phím của trình duyệt hoặc của màn khác mà không trả lại gì. Đúng một
 * phím còn bị bỏ lại:
 *
 * - **Ctrl+F KHÔNG đăng ký ở đây.** Nó chỉ có nghĩa khi đang xem mô hình
 *   không gian — đăng ký nó ở phạm vi `global` sẽ cướp tìm-trong-trang của
 *   trình duyệt ở hai mươi mấy màn không có gì để tìm. Tổ hợp thật sống ở
 *   phạm vi `canvas`, cạnh phím `/` đã có sẵn — xem docblock đầu
 *   `screens/viewer/Viewer3D/ObjectSearch.tsx`. `buildGlobalShortcuts` vẫn
 *   khai `'global.search'` (cho `buildShortcutRows` của màn tài khoản đếm),
 *   nhưng `UndoShortcuts` không lấy định nghĩa đó ra.
 *
 * **Ctrl+S nay ĐÃ nối** (lỗ hổng #7). Vỏ không dựng bộ tự lưu của riêng nó —
 * nó không biết dự án nào đang mở — mà gọi `flushAutosaves()`
 * (`hooks/useAutosave.ts`), thứ xả mọi engine `createAutosave` đang gắn. Một
 * màn không sửa gì thì không có engine nào để xả và phím không làm gì, đúng như
 * `saveNow` của một bộ tự lưu sạch. Và **không** có nút Lưu nào mọc lên theo
 * (A7): đây là lối tắt của bộ đếm 800 ms, không phải một nút mới.
 *
 * Hai phím còn lại — `?` mở `GlobalShortcutHelp`, Escape gọi
 * `uiSlice.closeDialog()` — ĐÃ nối ở lượt này. `GlobalShortcutHelp` tự đăng ký
 * hai binding phạm vi `dialog` của riêng nó (Esc và `?` lần hai) khi đang mở,
 * nên `SCOPE_PRIORITY` (`shortcutRegistry.ts:59`) luôn cho bảng tự đóng trước
 * khi Escape rơi được tới `closeTopLayer` — đúng lời hứa A12: không màn nào
 * đang tự giữ Esc của mình (`dialog`/`sidePanel`/`canvas` đứng trước `global`)
 * bị lấy mất phím, vì binding `global` chỉ chạy khi không phạm vi nào phía
 * trên trả lời.
 */
export function UndoShortcuts({ children }: { children: React.ReactNode }): React.ReactElement {
  const closeDialog = useStore((state) => state.closeDialog);
  const [isHelpOpen, setIsHelpOpen] = useState(false);
  /* Dựng `LazyGlobalShortcutHelp` chỉ khi ĐÃ từng mở — giữ nó (và chunk
     framer-motion của nó) ngoài cây cho tới lần bấm `?` đầu tiên, đúng lý do
     `lazy()` ở trên tồn tại. */
  const [hasOpenedHelp, setHasOpenedHelp] = useState(false);

  const openHelp = useCallback((): void => {
    setIsHelpOpen(true);
    setHasOpenedHelp(true);
  }, []);

  const closeHelp = useCallback((): void => {
    setIsHelpOpen(false);
  }, []);

  /* Đổi đường dẫn thì đóng bảng (10K-C-009): `UndoShortcuts` bọc mọi route nên
     `isHelpOpen` sống qua điều hướng; không reset thì bảng nằm lại trên màn mới. */
  const { pathname } = useLocation();
  useEffect(() => {
    setIsHelpOpen(false);
  }, [pathname]);

  useShortcut(UNDO_SHORTCUT);
  useShortcut(REDO_SHORTCUT);
  useShortcut(SAVE_SHORTCUT);
  useShortcut(globalShortcut('global.shortcutHelp', openHelp));
  useShortcut(globalShortcut('global.closeTopLayer', closeDialog));

  return (
    <>
      {children}
      {hasOpenedHelp && (
        <React.Suspense fallback={null}>
          <LazyGlobalShortcutHelp isOpen={isHelpOpen} onClose={closeHelp} />
        </React.Suspense>
      )}
    </>
  );
}

const withAdminNav = (page: React.ReactNode) => (
  <AdminGate>
    <AdminNav />
    {page}
  </AdminGate>
);

/** Bảng route — xuất riêng để bài kiểm dựng nó trên `createMemoryRouter`. */
export const routes: RouteObject[] = [
  {
    errorElement: <RouteErrorScreen />,
    element: (
      <SessionBootstrap>
        <UndoShortcuts>
          <Outlet />
        </UndoShortcuts>
      </SessionBootstrap>
    ),
    children: [
      ...DEV_ONLY_ROUTES,
      { path: ROUTE_PATTERNS.login, element: suspendedOutsideMain(<Screens.RouteAuth />) },
      { path: ROUTE_PATTERNS.forgotPassword, element: suspendedOutsideMain(<Screens.RouteAuth />) },
      /* Trang giới thiệu cuộn: công khai, toàn màn hình, ngoài `AppLayout`; tự mang `<main>`. */
      { path: ROUTE_PATTERNS.welcome, element: suspendedOutsideMain(<Screens.RouteLanding />) },
      { path: ROUTE_PATTERNS.sharedModel, element: suspendedOutsideMain(<Screens.RouteSharedModel />) },
      { path: ROUTE_PATTERNS.invitationAccept, element: suspendedOutsideMain(<Screens.RouteInvitationAccept />) },
      { path: ROUTE_PATTERNS.passwordReset, element: suspendedOutsideMain(<Screens.RoutePasswordReset />) },
      /* Mô hình 3D: trang riêng toàn màn hình, KHÔNG header/thanh bước của `AppLayout`;
         nhóm `ScreenMain` riêng để trang vẫn có đúng một `<main>`. */
      {
        element: (
          <ScreenMain>
            <Outlet />
          </ScreenMain>
        ),
        children: [
          { path: ROUTE_PATTERNS.projectViewer, element: <Pascal3dPage /> },
          { path: ROUTE_PATTERNS.projectViewerPascal, element: <PascalViewerRedirect /> },
        ],
      },
      // Màn di động: route MỚI, không thay chỗ một route tạm nào (R-66).
      { path: ROUTE_PATTERNS.mobileViewer, element: suspendedOutsideMain(<Screens.RouteMobileViewer />) },
      ...STATE_GALLERY_DEV_ONLY_ROUTES,
      /* Mọi màn sau đăng nhập: header chung + thanh bước dự án (`AppLayout`). */
      {
        element: <AppLayout />,
        children: [
          { path: ROUTE_PATTERNS.dashboard, element: suspendedOutsideMain(<Screens.RouteDashboard />) },
          /* Danh sách dự án ở `/`; `/projects` (gõ tay, liên kết cũ) không còn ra 404. */
          { path: '/projects', element: <Navigate replace to={ROUTE_PATTERNS.dashboard} /> },
          { path: ROUTE_PATTERNS.projectExploded, element: <ExplodedViewRedirect /> },
          { path: ROUTE_PATTERNS.projectMeasure, element: <MeasureViewRedirect /> },
          /* Nhóm màn không tự có `<main>`: một landmark chung ở đây thay vì ba mươi chỗ
             (FIX-381). Màn đã có `<main>` riêng đứng NGOÀI nhóm để không lồng `<main>`. */
          {
            element: (
              <ScreenMain>
                <Outlet />
              </ScreenMain>
            ),
            children: [
              { path: ROUTE_PATTERNS.accessDenied, element: suspended(<Screens.RouteAccessDenied />) },
              { path: ROUTE_PATTERNS.onboarding, element: suspended(<Screens.RouteOnboarding />) },
              { path: ROUTE_PATTERNS.projectSettings, element: suspended(<Screens.RouteProjectSettings />) },
              { path: ROUTE_PATTERNS.projectUpload, element: suspended(<Screens.RouteFloorUpload />) },
              { path: ROUTE_PATTERNS.projectDrawingSets, element: suspended(<Screens.RouteDrawingSet />) },
              { path: ROUTE_PATTERNS.projectQuality, element: suspended(<Screens.RouteInputQualityGate />) },
              { path: ROUTE_PATTERNS.projectPipeline, element: suspended(<Screens.RouteProcessing />) },
              { path: ROUTE_PATTERNS.projectPipelineGraph, element: suspended(<Screens.RoutePipelineGraph />) },
              { path: ROUTE_PATTERNS.projectScale, element: suspended(<Screens.RouteScaleCalibration />) },
              { path: ROUTE_PATTERNS.projectOverlay, element: suspended(<Screens.RouteOverlayComparison />) },
              { path: ROUTE_PATTERNS.projectWalls, element: suspended(<Screens.RouteWallLayerReview />) },
              { path: ROUTE_PATTERNS.projectObjects, element: suspended(<Screens.RouteObjectLayerReview />) },
              { path: ROUTE_PATTERNS.projectDimensions, element: suspended(<Screens.RouteDimensionOcrReview />) },
              { path: ROUTE_PATTERNS.projectGrids, element: suspended(<Screens.RouteAxisGridManager />) },
              { path: ROUTE_PATTERNS.projectRooms, element: suspended(<Screens.RouteRoomLabelReview />) },
              { path: ROUTE_PATTERNS.projectFloors, element: suspended(<Screens.RouteFloorManager />) },
              { path: ROUTE_PATTERNS.projectThickness, element: suspended(<Screens.RouteThicknessStandardization />) },
              { path: ROUTE_PATTERNS.projectRules, element: suspended(<Screens.RouteRules />) },
              { path: ROUTE_PATTERNS.projectRuleSettings, element: suspended(<Screens.RouteRuleSettings />) },
              { path: ROUTE_PATTERNS.projectExport, element: suspended(<Screens.RouteExportPanel />) },
              { path: ROUTE_PATTERNS.projectData, element: suspended(<Screens.RouteSpatialJsonViewer />) },
              { path: ROUTE_PATTERNS.projectVersions, element: suspended(<Screens.RouteVersionHistory />) },
              { path: ROUTE_PATTERNS.adminModels, element: withAdminNav(suspended(<Screens.RouteModelLibrary />)) },
              { path: ROUTE_PATTERNS.adminTrainingJobs, element: withAdminNav(suspended(<Screens.RouteTrainingJobs />)) },
              { path: ROUTE_PATTERNS.adminTrainingModels, element: withAdminNav(suspended(<Screens.RouteModelRegistry />)) },
              { path: ROUTE_PATTERNS.adminUsers, element: withAdminNav(suspended(<Screens.RouteUserManagement />)) },
              { path: ROUTE_PATTERNS.account, element: suspended(<Screens.RouteAccountSettings />) },
              { path: ROUTE_PATTERNS.notifications, element: suspended(<Screens.RouteNotificationCenter />) },
              { path: ROUTE_PATTERNS.notFound, element: suspended(<Screens.RouteNotFound />) },
            ],
          },
        ],
      },
    ],
  },
];

export const router = createBrowserRouter(routes);
