/**
 * AppFront addition (UX-R2 K38), not an upstream file. One "frame the model" for the first open,
 * a floor switch, leaving Preview and the "Xem toàn bộ mô hình" button.
 *
 * Solo mode shows ONE floor, but that floor still sits at its stacked height (`baseY`, e.g. 6.6 m
 * for the third floor) and the other floors' walls still count in the plan bounds — so the old
 * whole-model frame (target y = 0, union of all floors) put the visible floor at the top edge,
 * under the toolbar and the scale banner. Here solo mode frames the selected floor only, at its
 * own height; stacked/exploded still frame the whole model.
 */
import { emitter, useScene } from '@pascal-app/core'
import { getLevelPresentationY, useViewer } from '@pascal-app/viewer'
import { computeSceneBoundsXZ } from '../../../../vendor/pascal/packages/editor/src/lib/scene-bounds'
import { fitPose, fitRoomPose, type FreeRect, planBoundsXZ, TOP_RESERVED_PX, viewportOf } from './fit-on-ready'

/** Bounds + base height of what the camera should frame now. */
export function viewedFrame() {
  const { nodes } = useScene.getState()
  const { levelMode, selection } = useViewer.getState()
  const levelId = levelMode === 'solo' ? selection.levelId : null
  const level = levelId ? planBoundsXZ(nodes, levelId) : null
  if (levelId && level) return { bounds: level, baseY: getLevelPresentationY(levelId, nodes, levelMode) }
  // FE3D-FIX-004 V14: frame walls + zones; vendor bounds only for a scene without either.
  return { bounds: planBoundsXZ(nodes) ?? computeSceneBoundsXZ(nodes), baseY: 0 }
}

/** Canvas area left by the top bar, the bottom dock and the floating property panel (px, canvas-relative). */
function freeRect(): FreeRect {
  const { width, height } = viewportOf()
  const free = { left: 0, top: Math.min(TOP_RESERVED_PX, height / 3), right: width, bottom: height }
  const canvas = [...document.querySelectorAll('canvas')]
    .map((c) => c.getBoundingClientRect())
    .find((r) => Math.round(r.width) === Math.round(width) && Math.round(r.height) === Math.round(height))
  if (!canvas) return free
  const dock = document.querySelector('[data-appfront-dock]')?.getBoundingClientRect()
  if (dock) free.bottom = Math.max(height / 2, dock.top - canvas.top)
  // The vendor's floating panel (`panel-wrapper.tsx`) has no other mark.
  const panel = document.querySelector('.fixed.top-20.right-4')?.getBoundingClientRect()
  if (panel && panel.width > 0) free.right = Math.max(width / 2, panel.left - canvas.left)
  return free
}

/** UX-R4 U40: fly the camera to one room (zone), at its own floor height, framed in the free part of the canvas. */
export function fitRoom(zoneId: string) {
  const { nodes } = useScene.getState()
  const zone = (nodes as unknown as Record<string, { parentId?: unknown } | undefined>)[zoneId]
  if (!zone) return
  const { levelMode, cameraMode } = useViewer.getState()
  const levelId = typeof zone.parentId === 'string' ? zone.parentId : null
  const baseY = levelId ? getLevelPresentationY(levelId, nodes, levelMode) : 0
  emitter.emit('camera-controls:apply-pose', fitRoomPose(planBoundsXZ({ [zoneId]: zone }), cameraMode, viewportOf(), freeRect(), baseY))
}

/**
 * Frame the viewed floor (solo) or the whole model, centred in the canvas part no toolbar/dock/panel covers;
 * `apply-pose`, because upstream's `fit-scene` is ignored in Preview.
 */
export function fitModel() {
  const { bounds, baseY } = viewedFrame()
  emitter.emit('camera-controls:apply-pose', fitPose(bounds, useViewer.getState().cameraMode, viewportOf(), baseY, freeRect()))
}
