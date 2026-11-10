'use client'
/**
 * VERBATIM copy of upstream Pascal apps/editor/app/page.tsx (F:\pascal-editor, commit cd14090, MIT).
 * Edits (the only ones):
 *   1. import paths: `@/components/*` -> relative `./components/*`.
 *   2. WebXR plugin gate removed (`vr` treated as null): no `@webxr/plugin` / `webxr-feature-gate`
 *      imports, no WebXRFeatureRuntime/Consumer wrappers, no PascalWebXRButton, no `immersive` prop
 *      (`vr?.session` was always undefined), `vrButton={null}`; `useWebXRInstalled` dropped.
 *   3. "Blank canvas - saved scenes are under Scenes" banner removed (/scenes does not exist here);
 *      with it the now-unused `next/link` import and the `PROJECT_ID` constant.
 *   4. `Home` takes props `{ projectId, onLoad, onSave, readOnly }` and passes
 *      `projectId` / `onLoad` / `onSave` to `<Editor>` (upstream Editor supports them). `readOnly`
 *      is accepted for the caller's contract; the read-only lease is taken in ../main.tsx.
 *   5. Optional `backCard` prop rendered first inside the `viewerToolbarLeft` slot (AppFront's
 *      only addition: a small "back to project" card, ../BackToProjectCard.tsx).
 *   6-8. AppFront UX edits from UI review P40 (Vietnamese labels, start in Select, ?tool/?view,
 *      Esc, delete-mode banner, frame model on load) - listed in ./README.md.
 *   9. UI review fix R3d: registry strings in Vietnamese (G5-03, ./lib/pascal-vi.ts), saved
 *      preferences (BUG-648, ./lib/editor-preferences.ts), sidebar auto-collapses under 1100 px
 *      (G5-11), Preview header shows the project name (G5-15). The one-time orbit hint (G5-08) is gone:
 *      left-drag orbits since UX41 U20 (scripts/realism/u20-left-orbit.mjs).
 *   10. FE3D WP8: ../scaleBanner.tsx (drawing-scale warning) heads the CanvasHelp column - see ./README.md.
 *   11. UX-R2: frame the viewed floor (./lib/view-frame.ts) on open and on every floor switch; the
 *       project setting "separate units" pins solo mode; the build panel opens collapsed (K35).
 *   12. Editor3D đợt 2: the snapshot callback passes `requestId` (the dock's "Ảnh" shot saves as
 *       `<tên>-3d.png`); `BottomDock` gets `projectId` (Ảnh, Gửi người nhà).
 */

import { emitter, nodeRegistry, onRegistryChange, useScene } from '@pascal-app/core'
import {
  Editor,
  ItemsPanel,
  subscribeCameraPose,
  useEditor,
  useSidebarStore,
  useViewer,
  ViewerSceneHeader,
} from '@pascal-app/editor'
import { Hammer, Layers, Package, Settings } from 'lucide-react'
import { type ComponentProps, type ReactNode, useCallback, useEffect, useRef } from 'react'
import { isSeparateUnits, postPascalNotice } from '../bridge'
import { downloadSnapshot } from '../realism/snapshot'
import { ScaleBanner, ScaleEmptyNotice } from '../scaleBanner'
import { BuildTab } from './components/build-tab'
import { CanvasHelp, MeasureClearButton } from './components/canvas-help'
import {
  BottomDock,
  CommunityViewerToolbarRight,
} from './components/viewer-toolbar'
import { installDragNotSelect } from './lib/drag-not-select'
import { installSelectPriority } from './lib/select-priority-install'
import { useEditorPreferencesPersistence } from './lib/editor-preferences'
import { fitWhenControlsReady } from './lib/fit-on-ready'
import { translateDefinition } from './lib/pascal-vi'
import { isMeasureActive } from './lib/select-exits-measure'
import { useSelectExitsMeasure } from './lib/use-select-exits-measure'
import { fitModel } from './lib/view-frame'
import { DraftAssist } from '../draftAssist/DraftAssist'

// The open-source editor only ships the built-in catalog (no uploaded items),
// so the Library/Community/Mine source chips and tag filters add nothing —
// drop them and keep the panel to plain categories.
function EditorItemsPanel() {
  return <ItemsPanel showSourceFilter={false} showTagFilters={false} />
}

// AppFront (wall-review-ux): the rail showed bare icons and users asked "what is this for?" —
// a short caption under each icon (the button keeps its aria-label + hover tooltip).
function railIcon(icon: ReactNode, label: string) {
  return (
    <span className="flex flex-col items-center gap-0.5">
      {icon}
      <span aria-hidden="true" className="whitespace-nowrap text-[10px] leading-none">
        {label}
      </span>
    </span>
  )
}

const SIDEBAR_TABS = [
  {
    id: 'site',
    label: 'Cảnh',
    component: () => null,
    mobileDefaultSnap: 0.5,
    mobileIcon: <Layers className="h-5 w-5" />,
    icon: railIcon(<Layers className="h-5 w-5" />, 'Cảnh'),
  },
  {
    id: 'build',
    label: 'Dựng',
    component: BuildTab,
    mobileDefaultSnap: 0.5,
    mobileIcon: <Hammer className="h-5 w-5" />,
    icon: railIcon(<Hammer className="h-5 w-5" />, 'Dựng'),
  },
  {
    id: 'items',
    label: 'Đồ vật',
    component: EditorItemsPanel,
    mobileDefaultSnap: 0.5,
    mobileIcon: <Package className="h-5 w-5" />,
    icon: railIcon(<Package className="h-5 w-5" />, 'Đồ vật'),
  },
  {
    id: 'settings',
    label: 'Cài đặt',
    component: () => null,
    mobileDefaultSnap: 0.5,
    mobileIcon: <Settings className="h-5 w-5" />,
    icon: railIcon(<Settings className="h-5 w-5" />, 'Cài đặt'),
  },
]

type EditorProps = ComponentProps<typeof Editor>

export interface HomeProps {
  projectId: string
  onLoad: NonNullable<EditorProps['onLoad']>
  onSave?: EditorProps['onSave']
  readOnly: boolean
  /** Head of the left panel (back link, steps, sidebar toggle) — the editor has no top bar. */
  backCard?: ReactNode
  /** Extra controls of the right "Xem" panel (style/lighting menu, placement chip, selection cards). */
  viewPanel?: ReactNode
  /** Shown in the Preview header (G5-15); from the bridge. */
  projectName?: string | undefined
}

/**
 * AppFront edit (P40): start state after the scene is applied. Always open in Select
 * (G5-05), honour `?tool=measure` (G5-44) and `?view=exploded` (G5-43) from the 3D links.
 */
function applyStartParams() {
  const params = new URLSearchParams(window.location.search)
  const ed = useEditor.getState()
  if (params.get('tool') === 'measure') {
    ed.setPhase('structure')
    ed.armToolMode({ mode: 'build', tool: 'measurement' })
  } else {
    ed.armToolMode({ mode: 'select' })
  }
  // AppFront edit (UX-R1 K19): open one floor at a time (product scope: one-floor apartments);
  // the stacked default built unrelated plans into a 46 m tower. `?view=exploded` still wins,
  // unless the project says its floors are separate units (UX-R2): then solo only.
  const levelCount = Object.values(useScene.getState().nodes).filter((n) => n.type === 'level').length
  const wantsExploded = params.get('view') === 'exploded'
  // AppFront edit (UX audit #29): one floor cannot be exploded; say why instead of opening a plain view.
  if (wantsExploded && levelCount < 2) postPascalNotice('Cần ít nhất 2 tầng để xem tách tầng')
  const exploded = wantsExploded && !isSeparateUnits()
  useViewer.getState().setLevelMode(exploded ? 'exploded' : 'solo')
  // AppFront edit (UX-R1): start solo on the first floor that has walls; missing-scale floors are
  // left empty by the bridge, and opening on one of them showed a blank scene.
  const { nodes } = useScene.getState()
  for (const node of Object.values(nodes)) {
    if (node.type === 'level' && node.children.some((id) => nodes[id]?.type === 'wall')) {
      useViewer.getState().setSelection({ levelId: node.id })
      break
    }
  }
  // G5-06 / QA-2 L2: frame the model once the camera controls have mounted (a cold first open
  // mounts them after the editor's own auto-frame and after any fixed delay).
  fitWhenControlsReady(subscribeCameraPose, fitModel)
}

/**
 * QA-2 L2: entering or leaving Preview resizes the shared canvas, and upstream's preview effect flies to
 * the level. Re-frame the model two frames later, once that effect and the new layout have run.
 */
function useFitOnPreviewToggle() {
  const isPreview = useEditor((state) => state.isPreviewMode)
  const seen = useRef(isPreview)
  useEffect(() => {
    if (seen.current === isPreview) return
    seen.current = isPreview
    let raf = requestAnimationFrame(() => {
      raf = requestAnimationFrame(fitModel)
    })
    return () => cancelAnimationFrame(raf)
  }, [isPreview])
}

/**
 * UX-R2 K38: a floor switch in solo mode re-frames that floor (upstream only pans the target to the
 * floor's height). Two frames later, so upstream's own level effect has run first.
 */
function useFitOnLevelChange() {
  useEffect(() => {
    let raf = 0
    const unsubscribe = useViewer.subscribe((state, previous) => {
      const { levelId } = state.selection
      // U45: only a real floor switch. Preview's click on empty space clears the level and its next click
      // re-picks one; both are selection, and neither should move the camera.
      if (levelId === previous.selection.levelId || !levelId || !previous.selection.levelId) return
      if (state.levelMode !== 'solo') return
      cancelAnimationFrame(raf)
      raf = requestAnimationFrame(() => {
        raf = requestAnimationFrame(fitModel)
      })
    })
    return () => {
      unsubscribe()
      cancelAnimationFrame(raf)
    }
  }, [])
}

/**
 * UX-R2: project setting "Đây là các căn hộ riêng" — floors are unrelated plans, so they never
 * stack: whichever control asks for stacked/exploded (toolbar, command palette, Preview bar), the
 * scene goes back to one floor. ponytail: the thumbnail generator's own stacked round-trip is
 * pinned too, so its shot shows one floor — what a separate unit should show anyway.
 */
function useSoloForSeparateUnits() {
  useEffect(() => {
    if (!isSeparateUnits()) return
    return useViewer.subscribe((state) => {
      if (state.levelMode !== 'solo') state.setLevelMode('solo')
    })
  }, [])
}

/** Select tool, the same public calls `use-select-exits-measure.ts` makes for V. */
function armSelect() {
  const ed = useEditor.getState()
  ed.armToolMode({ mode: 'select' })
  ed.setFloorplanSelectionTool('click')
}

/**
 * AppFront edit (Q4, D1a): leaving Preview (Esc or the header's back arrow) came back with the
 * Wall tool armed — the sidebar "Tường" tile lit, "Chọn (V)" not. Land in Select instead. Runs
 * on the state change, so every exit path (Esc in `useEscapeExits`, the back arrow) is covered.
 */
function useSelectAfterPreview() {
  const isPreview = useEditor((state) => state.isPreviewMode)
  const seen = useRef(isPreview)
  useEffect(() => {
    const left = seen.current && !isPreview
    seen.current = isPreview
    if (!left) return
    armSelect()
  }, [isPreview])
}

/**
 * AppFront edit (P40, G5-15 / N5-11 / G5-14): Esc leaves Preview, then Delete or Measure (both
 * measure tools, the same test V uses, RV3 #8). The Delete banner lives in `CanvasHelp`.
 */
function useEscapeExits() {
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return
      const ed = useEditor.getState()
      if (ed.isPreviewMode) ed.setPreviewMode(false)
      else if (ed.mode === 'delete' || isMeasureActive(ed))
        ed.armToolMode({ mode: 'select' })
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])
}

/**
 * Editor3D G2 (K4, L1-07): walking switches walls to "cao đủ" (vendor Editor effect) and leaving
 * kept it. Remember the wall mode when the walk starts (this store listener runs before that
 * effect) and put it back when the walk ends.
 */
function useWallModeAfterWalk() {
  useEffect(() => {
    let before: ReturnType<typeof useViewer.getState>['wallMode'] | null = null
    return useEditor.subscribe((state, previous) => {
      if (state.isFirstPersonMode === previous.isFirstPersonMode) return
      if (state.isFirstPersonMode) {
        before = useViewer.getState().wallMode
      } else if (before) {
        useViewer.getState().setWallMode(before)
        before = null
      }
    })
  }, [])
}

let viInstalled = false

/**
 * AppFront edit (R3d, G5-03): Vietnamese registry strings, now and whenever a kind or plugin
 * registers later. Runs during render, before the HUD first reads them. Idempotent.
 */
function usePascalVi() {
  if (viInstalled) return
  viInstalled = true
  const run = () => {
    for (const [, def] of nodeRegistry.entries()) translateDefinition(def)
  }
  run()
  onRegistryChange(run)
}

const NARROW_PX = 1100

/**
 * AppFront edit (R3d, G5-11): under 1100 px the 344 px sidebar pushes the toolbars off screen.
 * Collapse it once the saved state is loaded and whenever the window narrows past 1100 px.
 * Never re-opens it: a user who opens it again on a tablet keeps it open.
 * UX-R2 K35: the page opens to LOOK at the model, so it never opens on the build panel.
 * wall-review-ux (fewer buttons, open workspace): it opens COLLAPSED at every width — the head (back
 * link, steps) floats by the rail and the scene tree is one click away. Within one tab session the
 * last open/closed choice wins from 1100 px (reopens on "Cảnh", never on the build panel — K35).
 */
const PANEL_OPEN_KEY = 'appfront.pascal.panelOpen'

function useAutoCollapseSidebar() {
  useEffect(() => {
    const collapse = () => useSidebarStore.getState().setIsCollapsed(true)
    let wasNarrow = window.innerWidth < NARROW_PX
    let ready = false
    const onHydrated = () => {
      let open = false
      try {
        open = sessionStorage.getItem(PANEL_OPEN_KEY) === '1'
      } catch {}
      if (window.innerWidth < NARROW_PX || !open) collapse()
      else {
        useEditor.getState().setActiveSidebarPanel('site')
        useSidebarStore.getState().setIsCollapsed(false)
      }
      ready = true
    }
    const stopRemember = useSidebarStore.subscribe((state, prev) => {
      if (!ready || state.isCollapsed === prev.isCollapsed) return
      try {
        sessionStorage.setItem(PANEL_OPEN_KEY, state.isCollapsed ? '0' : '1')
      } catch {}
    })
    const onResize = () => {
      const narrow = window.innerWidth < NARROW_PX
      if (narrow && !wasNarrow) collapse()
      wasNarrow = narrow
    }
    const unsubscribe = useSidebarStore.persist.onFinishHydration(onHydrated)
    if (useSidebarStore.persist.hasHydrated()) onHydrated()
    window.addEventListener('resize', onResize)
    return () => {
      unsubscribe()
      stopRemember()
      window.removeEventListener('resize', onResize)
    }
  }, [])
}

// Pascal's own Preview header (the only node with these classes) is hidden while ours shows.
const HIDE_VENDOR_HEADER =
  '.dark.absolute.top-4.left-4.z-20:not([data-appfront-header] > *) { display: none !important; }'

/**
 * AppFront edit (R3d, G5-15): `<Editor>` never passes `projectName` to its Preview overlay, so
 * the header read "Untitled". Render the exported `ViewerSceneHeader` with the bridge's name.
 */
function PreviewHeader({ projectName }: { projectName?: string | undefined }) {
  const isPreview = useEditor((state) => state.isPreviewMode)
  if (!isPreview) return null
  return (
    <div className="pointer-events-none fixed inset-0 z-30" data-appfront-header="">
      <style>{HIDE_VENDOR_HEADER}</style>
      <ViewerSceneHeader
        onBack={() => useEditor.getState().setPreviewMode(false)}
        projectName={projectName ?? null}
      />
    </div>
  )
}

/** V1 (viewer-measure): người xem không dựng/đặt đồ — bỏ tab Dựng + Đồ vật; đo nằm ở thanh hành động. */
const READ_ONLY_SIDEBAR_TABS = SIDEBAR_TABS.filter((tab) => tab.id !== 'build' && tab.id !== 'items')

export default function Home({ projectId, onLoad, onSave, readOnly, backCard, viewPanel, projectName }: HomeProps) {
  useEditorPreferencesPersistence()
  usePascalVi()
  useEscapeExits()
  useSelectExitsMeasure()
  useAutoCollapseSidebar()
  useFitOnPreviewToggle()
  useFitOnLevelChange()
  useSoloForSeparateUnits()
  useSelectAfterPreview()
  useWallModeAfterWalk()
  // UX-R3 U16: left-drag from a wall orbits; it must not select the wall on release.
  useEffect(
    () =>
      installDragNotSelect(window, {
        get: () => useViewer.getState().inputDragging,
        set: (value) => useViewer.getState().setInputDragging(value),
      }),
    [],
  )
  useEffect(installSelectPriority, []) // H1 C2: bấm trúng đồ vật, không trúng tường cắt/sàn trước nó
  const handleLoad = useCallback(async () => {
    const graph = await onLoad()
    // After Editor's own continuation has applied the graph (it awaits this promise).
    setTimeout(applyStartParams, 0)
    return graph
  }, [onLoad])
  return (
    <div className="relative h-screen w-screen">
      <Editor
        layoutVersion="v2"
        onLoad={handleLoad}
        {...(onSave ? { onSave } : {})}
        // F2: không có API lưu snapshot -> nút chụp tải ảnh về máy (trước đây báo "Snapshot storage is unavailable").
        // Overlay chỉ đóng khi nghe `snapshot:saved` — không phát thì nút chụp khoá mãi.
        onThumbnailCapture={(blob, camera) => {
          downloadSnapshot(blob, projectName, camera.requestId)
          emitter.emit('snapshot:saved', { projectId, id: 'download', url: '', width: 0, height: 0 })
        }}
        projectId={projectId}
        sidebarTabs={readOnly ? READ_ONLY_SIDEBAR_TABS : SIDEBAR_TABS}
        viewerToolbarLeft={backCard}
        viewerToolbarRight={
          <CommunityViewerToolbarRight vrButton={null} vrLabel="Enter VR">
            {viewPanel}
          </CommunityViewerToolbarRight>
        }
      />
      <PreviewHeader projectName={projectName} />
      <CanvasHelp banner={<ScaleBanner projectId={projectId} readOnly={readOnly} />} />
      <BottomDock projectId={projectId} readOnly={readOnly} />
      {/* AppFront edit (Codex P1): every floor lacks a scale -> empty scene, say why mid-screen. */}
      <ScaleEmptyNotice projectId={projectId} readOnly={readOnly} />
      <MeasureClearButton />
      {/* AppFront edit (SketchUp UX): typed wall length + snap label beside the cursor. */}
      <DraftAssist />
    </div>
  )
}
