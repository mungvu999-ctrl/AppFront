/**
 * Cửa vào trang 3D riêng (`public/editor3d.html?project=<id>`): trang chính của Pascal upstream
 * (`./upstream/page.tsx`) cộng đúng một thẻ "về dự án". Dữ liệu chỉ đi qua `./bridge`.
 */
/* eslint-disable react-refresh/only-export-components -- tệp vào của bó riêng, không có biên HMR để giữ. */
import './selfHost';
import './probe';
import './icons';
import './firstOpen';
import { acquireSceneReadOnlyLease, AnyNode, pauseSceneHistory, resumeSceneHistory, runAsSingleSceneHistoryStep, type SceneGraph, useScene } from '@pascal-app/core';
import { CATALOG_ITEMS, useEditor, useInteractionScope, useSidebarStore } from '@pascal-app/editor';
import { loadPlugin, nodeRegistry } from '@pascal-app/core/registry';
import { builtinPlugin } from '@pascal-app/nodes';
import { createMaterialFromPresetRef, getSceneTheme, prewarmWebGpuDevice, SSGI_PARAMS, useViewer } from '@pascal-app/viewer';
import { type ReactNode, StrictMode, useCallback, useEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';

import { flushAutosaves } from '@/hooks/useAutosave';
import { libraryOnlyCatalog, serverCatalogTiles, setRealismModels } from '@/lib/pascal/furnitureCatalog';
import { getFeatureFlagsSnapshot } from '@/lib/telemetry/flags';

import { BRIDGE_SESSION_ERROR, type BridgeInteraction, loginHrefOf, savePascalNow, usePascalProjectBridge } from './bridge';
import { isEmptyChange, type NodeChanges, nodeChangesTo } from './bridge/sceneRevert';
import type { PascalSceneGraph } from './bridge/types';
import { BackToProjectCard, EditModelButton, ProjectStepsCard } from './BackToProjectCard';
import { syncChromeTheme } from './chromeTheme';
import { HomeownerCardMount } from './HomeownerCardMount';
import { ItemTrustCard } from './ItemTrustCard';
import { ModelCreditCard } from './ModelCreditCard';
import { OpeningKindCard, type OpeningKindStores } from './OpeningKindCard';
import { PlacementIssuesChip } from './PlacementIssuesChip';
import { prefetchHdri } from './realism/lighting-hdri';
import { realismFlagsFrom, useRealism } from './realism/store';
import { preloadSceneTextures } from './realism/texturePreload';
import { setDetailsEnabled } from './realism/details';
import { applyDayLook, applyLookExposure, applyRenderLook, DAY_THEME_ID, SUNSET_THEME_ID } from './renderLook';
import { useSceneLoader } from './sceneLoader';
import { SwapModelCard } from './SwapModelCard';
import { PascalTour } from './tour/PascalTour';
import { openBuildTabWithoutArming } from './upstream/components/build-tab';
import { NodeContextMenu } from './upstream/components/node-context-menu';
import { CommunityViewerToolbarLeft, DisplayMenu } from './upstream/components/viewer-toolbar';
import Home from './upstream/page';
import { ViewMenu } from './ViewMenu';
// CSS của trang (Tailwind 4, không bọc phạm vi) — bản dựng xuất thành `/assets/pascal/style.css`.
import './pascal.css';
import './pascal-theme.css';
import './pascal-panels.css';
import './pascal-chrome.css';

// Như upstream `apps/editor/lib/bootstrap.ts`, nhưng chỉ bộ node dựng sẵn — không plugin ngoài.
// Tải trước mọi chunk lazy (renderer/system của từng loại node) ngay khi đăng ký xong: không thì
// React.lazy chỉ đòi chúng khi Canvas đã lên (~12 s), nối đuôi sau cả chuỗi phiên → dự án → GPU.
const builtinsLoaded = loadPlugin(builtinPlugin).then(() => {
  for (const [, def] of nodeRegistry.entries()) {
    if (def.renderer?.kind === 'parametric') def.renderer.module().catch(() => {});
    def.system?.module().catch(() => {});
  }
});
// Dáng render ấm: đè chủ đề `night` + SSGI trước khi vẽ (cả khung sửa lẫn Preview đọc chung).
applyRenderLook(getSceneTheme('night'), SSGI_PARAMS);
// "Ban ngày" của thẻ Ánh sáng: đè chủ đề sáng `studio` cùng cách.
applyDayLook(getSceneTheme(DAY_THEME_ID));
applyLookExposure(getSceneTheme(SUNSET_THEME_ID));
// editor-realism: cờ `viewer.realism-*` → store (đọc một lần lúc mở trang: mặc định + override dev).
// eslint-disable-next-line local/no-direct-set -- store cờ realism riêng của trang Pascal (không phải store dự án), nạp một lần lúc mở trang.
useRealism.setState({ flags: realismFlagsFrom(getFeatureFlagsSnapshot().values) });
// R6: phào chân ngoài dựng lại trong `toPascalScene` mỗi lần nạp nên bền qua tải lại; fascia/gutter chỉ mái vẽ mới (mái chưa lưu về BE).
setDetailsEnabled(useRealism.getState().flags.details);
// B1 (bước 2): sofa/ghế bành/ghế ăn → mẫu Poly Haven `-ph` khi bật cờ materials (furnitureCatalog.ts).
setRealismModels(useRealism.getState().flags.materials);
// HDRI của chủ đề đang chọn tải từ lúc mở trang (lighting-hdri.ts), không đợi cảnh rảnh.
{
  const { sceneTheme } = useViewer.getState();
  prefetchHdri(sceneTheme, getSceneTheme(sceneTheme).appearance);
}
// Backend thật (vendor ghi sau khi renderer init) khác phép thử `navigator.gpu`, hoặc mức chất lượng đổi
// (SSGI bật/tắt theo mức) → đè lại số đèn.
// ponytail: đè tại chỗ, đèn đã vẽ chỉ đổi ở lượt dựng lại kế tiếp (đổi chủ đề/tải lại); GĐ3 nếu cần tức thì.
useRealism.subscribe((state, prev) => {
  if (state.backend === prev.backend && state.tier === prev.tier) return;
  applyRenderLook(getSceneTheme('night'), SSGI_PARAMS);
  applyDayLook(getSceneTheme(DAY_THEME_ID));
  applyLookExposure(getSceneTheme(SUNSET_THEME_ID));
});
// Áo trang theo sáng/tối của AppFront (`app-theme-mode`), trước lượt vẽ đầu.
syncChromeTheme();

// Thẻ "Loại ô mở": `createNode` không parse nên điền mặc định lược đồ ở đây; xoá + tạo là một bước Ctrl+Z.
const openingKindStores = {
  useScene,
  useViewer,
  parseNode: (node: object) => AnyNode.parse(node),
  singleStep: (run: () => void) => runAsSingleSceneHistoryStep(useScene, run),
} as unknown as OpeningKindStores;

function Notice({ children }: { readonly children: ReactNode }) {
  return (
    <div className="flex min-h-screen items-center justify-center bg-background p-6">
      <div className="w-full max-w-md rounded-2xl border border-border/60 bg-background p-6 text-center text-sm shadow-xl">
        {children}
      </div>
    </div>
  );
}

/** Màn tải: hai bước (tải mô hình đang chạy, dựng cảnh chờ), chỉ báo nhấp nháy opacity (không chuyển vị). */
function LoadingNotice() {
  return (
    <Notice>
      <div aria-live="polite" role="status">
        <p className="font-medium">Đang mở mô hình 3D…</p>
        <ol className="mx-auto mt-4 flex w-fit flex-col gap-2 text-left text-[var(--pa-text-2)]">
          <li className="flex items-center gap-2 text-[var(--pa-text)]">
            <span aria-hidden="true" className="h-2 w-2 animate-pulse rounded-full bg-[var(--pa-accent)]" />
            Tải mô hình
          </li>
          <li className="flex items-center gap-2">
            <span aria-hidden="true" className="h-2 w-2 rounded-full border border-[var(--pa-border)]" />
            Dựng cảnh
          </li>
        </ol>
      </div>
    </Notice>
  );
}

/**
 * UX-R2 K35: "Sửa mô hình" mở bảng dựng (thu gọn lúc mở trang) đúng ở thẻ "Dựng".
 * L3a-05: không để thẻ "Dựng" tự cầm công cụ đầu (Tường) — giữ chế độ Chọn và món đang chọn.
 */
function EditModel() {
  const collapsed = useSidebarStore((state) => state.isCollapsed);
  const open = () => {
    openBuildTabWithoutArming();
    useEditor.getState().setActiveSidebarPanel('build');
    useSidebarStore.getState().setIsCollapsed(false);
  };
  return <EditModelButton collapsed={collapsed} onOpen={open} />;
}

/** Bảng trái đang mở thẻ nào (`html[data-appfront-panel]`): thẻ "Cảnh" đã liệt kê tầng nên ẩn chip tầng (pascal-chrome.css). */
function PanelFlag() {
  const tab = useEditor((state) => state.activeSidebarPanel);
  const collapsed = useSidebarStore((state) => state.isCollapsed);
  useEffect(() => {
    document.documentElement.dataset.appfrontPanel = collapsed ? 'none' : tab;
  }, [tab, collapsed]);
  return null;
}

const readEditorScene = () => {
  const { nodes, rootNodeIds } = useScene.getState();

  return { nodes, rootNodeIds } as unknown as PascalSceneGraph;
};

/* Lượt sửa bị từ chối → đặt lại cảnh từ kho mà KHÔNG ghi bước hoàn tác và không xoá lịch sử
   (khác `applySceneGraphToEditor`): Ctrl+Z ngay sau đó về đúng cảnh trước lượt bị từ chối (no-op).
   Chỉ đổi các node khác (`nodeChangesTo`) — `setScene` cả cây làm cả mô hình dựng lại như tải trang.
   Cảnh đã khớp (xác nhận xoá nhiều) thì không làm gì. Tính chênh hỏng mới lùi về `setScene`. */
const applyRejectedRevert = (scene: unknown) => {
  const { nodes, rootNodeIds, collections, materials } = scene as SceneGraph;
  const store = useScene.getState();
  pauseSceneHistory(useScene);
  try {
    let changes: NodeChanges | null = null;
    try {
      changes = nodeChangesTo(store.nodes as Record<string, unknown>, nodes as Record<string, unknown>);
    } catch {
      changes = null;
    }
    if (changes === null) {
      store.setScene(nodes as never, rootNodeIds as never, { collections, materials } as never);
    } else if (!isEmptyChange(changes)) {
      store.applyNodeChanges(changes as never);
    }
  } finally {
    resumeSceneHistory(useScene);
  }
};

/** UX-R3 U10: chữ "Đang dựng" giữ tới khi kho cảnh đã có tường (người xem từng thấy nền trống). */
const hasWalls = () =>
  Object.values(useScene.getState().nodes).some((node) => (node as { type?: unknown }).type === 'wall');

/** Nướng ánh sáng: GLB của cảnh đang sửa qua bộ xuất của Pascal, không tải về máy. */
const exportSceneGlb = async (): Promise<Blob | null> =>
  (await useEditor.getState().modelExport?.('glb', { download: false }))?.blob ?? null;

/** Editor đang có lượt kéo/đặt/chỉnh chưa chốt (`useInteractionScope` không rảnh) hay camera đang kéo. */
const editorInteraction: BridgeInteraction = {
  active: () => useInteractionScope.getState().scope.kind !== 'idle' || useViewer.getState().inputDragging,
  subscribe: (listener) => {
    const stops = [useInteractionScope.subscribe(listener), useViewer.subscribe(listener)];
    return () => stops.forEach((stop) => stop());
  },
};

/** Trần chờ ảnh vật liệu trước lượt dựng đầu; quá thì dựng luôn, ảnh gán sau. */
const TEXTURE_HOLD_MS = 1500;

function PascalPage({ projectId }: { readonly projectId: string }) {
  const bridge = usePascalProjectBridge(projectId, applyRejectedRevert, readEditorScene, editorInteraction);
  const readOnly = bridge.status === 'ready' && bridge.readOnly;
  // Cầu khai kiểu lỏng (`PascalSceneGraph`, `unknown`) để không nhập Pascal; `useSceneLoader` ráp với `SceneGraph`.
  const loadScene = useSceneLoader(bridge.onLoad, bridge.rebaseLoaded);
  // Ảnh vật liệu thư viện của cảnh nạp ngay khi JSON về; đợi tối đa TEXTURE_HOLD_MS để lượt dựng đầu
  // trúng cache (khe ảnh đủ → không dựng lại pipeline). Danh tính giữ nguyên theo `loadScene`.
  const onLoad = useCallback(async () => {
    const graph = await loadScene();
    const create = (ref: string) => {
      try {
        return createMaterialFromPresetRef(ref);
      } catch {
        return null;
      }
    };
    await Promise.race([preloadSceneTextures(graph, create), new Promise((resolve) => setTimeout(resolve, TEXTURE_HOLD_MS))]);
    return graph;
  }, [loadScene]);

  const booted = useBooted();

  useEffect(() => (readOnly ? acquireSceneReadOnlyLease() : undefined), [readOnly]);

  if (bridge.status === 'loading') return <LoadingNotice />;
  if (bridge.status === 'error') {
    return (
      <Notice>
        <p className="text-muted-foreground">{bridge.error ?? 'Không mở được mô hình 3D.'}</p>
        {/* L3a-01: phiên hết thì có lối đăng nhập lại, xong quay về đúng mô hình 3D này. */}
        {bridge.error === BRIDGE_SESSION_ERROR ? (
          <a className="mt-4 mr-2 inline-block rounded-md border border-border bg-accent px-3 py-2 font-medium" href={loginHrefOf(projectId)}>
            Đăng nhập lại
          </a>
        ) : null}
        <a className="mt-4 inline-block rounded-md border border-border bg-accent px-3 py-2 font-medium" href={bridge.backHref}>
          Về dự án
        </a>
      </Notice>
    );
  }
  if (!booted) return <LoadingNotice />;

  const itemCards = (
    <>
      <SwapModelCard catalog={CATALOG_ITEMS} readOnly={readOnly} stores={{ useScene, useViewer }} />
      <ModelCreditCard stores={{ useScene, useViewer }} />
      <ItemTrustCard stores={{ useScene, useViewer }} />
      <OpeningKindCard readOnly={readOnly} stores={openingKindStores} />
    </>
  );

  return (
    <>
    <Home
      // Không thanh trên (kiểu Figma): đầu bảng trái = về dự án + lưu + thu gọn, rồi bước của dự án.
      backCard={
        <>
          <div className="flex w-full min-w-0 items-center gap-2 [&>a:first-child]:mr-auto">
            <BackToProjectCard href={bridge.backHref} projectName={bridge.projectName} save={bridge.save} />
            <CommunityViewerToolbarLeft />
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <ProjectStepsCard projectId={projectId} readOnly={readOnly} />
            {readOnly ? null : <EditModel />}
          </div>
        </>
      }
      // Bảng Xem góc phải: MỘT menu Xem (phong cách, ánh sáng, chất lượng, nướng, hiển thị) + chip lỗi đặt đồ (chỉ khi có lỗi).
      // Thẻ của món đang chọn nằm ở thẻ thao tác nhanh (HomeownerCard); người xem không có thẻ đó nên thẻ ở lại đây.
      viewPanel={
        <>
          {/* UI-1023 V-01: các chỉnh cảnh là một cụm liền khối (pascal-chrome.css `[data-appfront-cluster]`). */}
          <div aria-label="Cảnh" className="inline-flex shrink-0 items-center" data-appfront-cluster="" role="group">
            <ViewMenu
              display={<DisplayMenu />}
              flushAutosaves={flushAutosaves}
              projectId={projectId}
              readOnly={readOnly}
              reload={() => window.location.reload()}
              saveNow={savePascalNow}
              useViewer={useViewer}
              {...(readOnly ? {} : { exportGlb: exportSceneGlb })}
            />
            <PlacementIssuesChip useViewer={useViewer} />
            {readOnly ? itemCards : null}
          </div>
        </>
      }
      onLoad={onLoad}
      {...(readOnly ? {} : { onSave: bridge.onSave })}
      projectId={projectId}
      projectName={bridge.projectName}
      readOnly={readOnly}
    />
    <PanelFlag />
    <PascalTour hasModel={hasWalls} />
    <HomeownerCardMount extra={readOnly ? null : itemCards} readOnly={readOnly} />
    {readOnly ? null : <NodeContextMenu />}
    </>
  );
}

const root = createRoot(document.getElementById('root') as HTMLElement);
const projectId = new URLSearchParams(window.location.search).get('project');

if (projectId) {
  // Xin adapter/device WebGPU ngay, chồng lên lượt tải mạng; Canvas nhận lại đúng device này
  // (`renderer-capability.ts`). 'high-performance' = mặc định `gl` của R3F, khác thì vendor xin lại.
  prewarmWebGpuDevice('high-performance');
  // Bộ giải Draco/Basis (tự host, `scripts/pascal-self-host.mjs`) vào cache trước khi GLB đầu cần.
  for (const href of ['/draco/draco_wasm_wrapper.js', '/draco/draco_decoder.wasm', '/basis/basis_transcoder.js', '/basis/basis_transcoder.wasm']) {
    document.head.append(Object.assign(document.createElement('link'), { rel: 'prefetch', href }));
  }
  // Mô-đun cầu (`bridge/loadProject`) chỉ nhập sau phiên — nhập trước cho song song.
  void import('@/api/floorLayerGraph').catch(() => {});
  void import('@/store/projectHydration').catch(() => {});
}

// Thư viện máy chủ gộp vào danh mục trước lượt dựng đầu; lỗi/offline → danh mục đóng gói (serverLibrary.ts).
// Mở phiên TRƯỚC: token chỉ ở bộ nhớ, gọi ngay lúc tải trang là 401 và mất thư viện máy chủ (e2e fullstack
// bước 11). `startAppSession` nhớ lượt đang chạy nên cầu (`bridge/loadProject`) dùng lại đúng lượt này.
const serverLibraryLoaded = Promise.all([import('@/api/appClient'), import('@/routes/sessionSetup')])
  .then(async ([{ createAppApiClient }, { startAppSession }]) => {
    if (!(await startAppSession())) return 0;
    const { loadServerLibrary } = await import('@/lib/pascal/serverLibrary');
    const count = await loadServerLibrary(createAppApiClient().library);
    // Bảng đồ Pascal chỉ đọc `CATALOG_ITEMS`: có mẫu máy chủ thì thay mẫu đóng gói bằng chúng (giữ công cụ).
    CATALOG_ITEMS.splice(0, CATALOG_ITEMS.length, ...libraryOnlyCatalog(CATALOG_ITEMS, serverCatalogTiles()));
    return count;
  })
  .catch(() => 0);

// Trang vẽ ngay để cầu nạp dự án SONG SONG với thư viện máy chủ (cùng một lượt `startAppSession`);
// chỉ phần Pascal (`Home`) đợi node dựng sẵn + danh mục máy chủ, như trước.
let booted = false;
const bootReady = Promise.all([builtinsLoaded, serverLibraryLoaded]).then(() => {
  booted = true;
});

function useBooted(): boolean {
  const [ready, setReady] = useState(booted);
  useEffect(() => {
    if (ready) return undefined;
    let live = true;
    void bootReady.then(() => live && setReady(true));
    return () => {
      live = false;
    };
  }, [ready]);
  return ready;
}

root.render(
    <StrictMode>
      {projectId ? (
        <PascalPage projectId={projectId} />
      ) : (
        <Notice>
          <p>Thiếu mã dự án trong đường dẫn.</p>
          <a className="mt-4 inline-block font-medium underline" href="/">
            Về trang chính
          </a>
        </Notice>
      )}
    </StrictMode>,
);
