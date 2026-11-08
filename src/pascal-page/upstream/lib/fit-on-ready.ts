/**
 * AppFront addition (QA-2 L2), not an upstream file. Fresh camera controls start at a fixed pose
 * (20,20,20) and upstream's `fit-scene` handler ignores Preview.
 * A fixed timer fired before the controls existed on a cold first open, so the fit was lost.
 * Here we wait for the controls to publish their first pose, then fit with `apply-pose`
 * (honoured in Preview too). The pose is ≈52° elevation with a 24° lens (upstream 50°; FE3D-FIX-002
 * Q2 had 40°/40°), at the distance that makes the plan outline fill 90% of the free canvas (V5 D13),
 * centred in it (M3-web L1: the old box-corner fit at canvas centre left ch-04 at 36% of the width).
 * FE3D-FIX-004 V14: bounds come from walls + zones only (`planBoundsXZ`), the frame is the real
 * canvas rect (not the window, which counts the sidebar), and the azimuth turns the long side of
 * the plan across the screen.
 */
import type { CameraPose } from '@pascal-app/core'

/** `points`: the plan outline (wall ends, zone vertices) the fit frames; absent → the box corners. */
type Bounds = { center: [number, number]; size: [number, number]; points?: [number, number][] }
type Viewport = { width: number; height: number }

/**
 * Render look A (docs/blender-vs-editor/BAO-CAO.md §4): a long lens seen from higher up reads like the
 * architectural cut-away renders — verticals barely splay and walls hide far less floor behind them
 * (a 3 m wall at 40° hid 3.6 m). 24° keeps orbit/zoom usable while editing (16° felt like a telescope).
 */
const FIT_FOV = 24
const ELEVATION = (52 * Math.PI) / 180
/** Share of the free viewport the plan fills (FE3D-FIX-002 V5 D13; render look A: 0.8 → 0.9). */
const FILL = 0.9
/** Top toolbar plus the one-line scale banner under it, overlaying the canvas (px; UX-R2 K38). */
export const TOP_RESERVED_PX = 120
/** Walls stand above the XZ bounds; frame their tops too. ponytail: fixed 3 m, not per level. */
const WALL_TOP = 3
const MIN_DISTANCE = 6
/** Long plans: look ~25° off the short axis so the long side runs across the screen. */
const LONG_PLAN_RATIO = 1.3
const OFF_SHORT_AXIS = (25 * Math.PI) / 180

/**
 * XZ bounds of the house itself: wall endpoints and zone polygons, both in level coordinates.
 * Vendor `computeSceneBoundsXZ` also adds raw node positions (doors/windows are wall-local,
 * building/stair sit at the origin) and the site polygon, so the origin was always inside the box
 * and long houses came out tiny. ponytail: ignores building/level offsets (AppFront keeps them 0).
 * With `levelId` (UX-R2 K38): only that floor's walls and zones (their `parentId` is the level).
 */
export function planBoundsXZ(nodes: Record<string, unknown> | unknown[], levelId?: string): Bounds | null {
  let minX = Infinity
  let minZ = Infinity
  let maxX = -Infinity
  let maxZ = -Infinity
  const points: [number, number][] = []
  const add = (p: unknown) => {
    if (!Array.isArray(p) || typeof p[0] !== 'number' || typeof p[1] !== 'number') return
    if (!Number.isFinite(p[0]) || !Number.isFinite(p[1])) return
    points.push([p[0], p[1]])
    minX = Math.min(minX, p[0])
    maxX = Math.max(maxX, p[0])
    minZ = Math.min(minZ, p[1])
    maxZ = Math.max(maxZ, p[1])
  }
  for (const node of Object.values(nodes) as { type?: unknown; parentId?: unknown; start?: unknown; end?: unknown; polygon?: unknown }[]) {
    if (levelId !== undefined && node?.parentId !== levelId) continue
    if (node?.type === 'wall') {
      add(node.start)
      add(node.end)
    } else if (node?.type === 'zone' && Array.isArray(node.polygon)) {
      for (const p of node.polygon) add(p)
    }
  }
  if (minX > maxX) return null
  return { center: [(minX + maxX) / 2, (minZ + maxZ) / 2], size: [maxX - minX, maxZ - minZ], points }
}

export type RoomEntry = { id: string; name: string; areaM2: number }

/**
 * UX-R4 U40: rooms (zones) for the "Đi tới phòng" list — name + floor area (m², shoelace),
 * sorted by name. With `levelId`: only that floor's zones. Unnamed zones read "Phòng".
 */
export function roomsOf(nodes: Record<string, unknown>, levelId?: string | null): RoomEntry[] {
  const rooms: RoomEntry[] = []
  for (const [id, node] of Object.entries(nodes) as [string, { type?: unknown; parentId?: unknown; name?: unknown; polygon?: unknown }][]) {
    if (node?.type !== 'zone' || !Array.isArray(node.polygon)) continue
    if (levelId && node.parentId !== levelId) continue
    const pts = (node.polygon as unknown[]).filter(
      (p): p is [number, number] => Array.isArray(p) && Number.isFinite(p[0]) && Number.isFinite(p[1]),
    )
    let twice = 0
    pts.forEach(([x, z], i) => {
      const [nx, nz] = pts[(i + 1) % pts.length]!
      twice += x * nz - nx * z
    })
    const name = typeof node.name === 'string' && node.name.trim() !== '' ? node.name.trim() : 'Phòng'
    rooms.push({ id, name, areaM2: Math.abs(twice) / 2 })
  }
  return rooms.sort((a, b) => a.name.localeCompare(b.name, 'vi'))
}

/** Largest canvas on the page (the 3D view; thumbnails/previews are smaller), else the window. */
export const viewportOf = (): Viewport => {
  if (typeof document === 'undefined') return { width: 1920, height: 1080 }
  let best: Viewport | null = null
  for (const canvas of document.querySelectorAll('canvas')) {
    const { width, height } = canvas.getBoundingClientRect()
    if (width > 0 && height > 0 && (!best || width * height > best.width * best.height)) best = { width, height }
  }
  return best ?? { width: window.innerWidth || 1920, height: window.innerHeight || 1080 }
}

/** Azimuth (from +Z towards +X): 45° for squarish plans; long plans look ~25° off the short axis. */
export function fitAzimuth([sx, sz]: [number, number]): number {
  if (sx >= sz * LONG_PLAN_RATIO) return OFF_SHORT_AXIS
  if (sz >= sx * LONG_PLAN_RATIO) return Math.PI / 2 - OFF_SHORT_AXIS
  return Math.PI / 4
}

/** The canvas area no panel covers, in px from the canvas's top-left corner. */
export type FreeRect = { left: number; top: number; right: number; bottom: number }

/** Canvas minus the top toolbar + scale banner (what `fitPose` frames into when no panel rect is given). */
export function belowToolbar(viewport: Viewport): FreeRect {
  return { left: 0, top: Math.min(TOP_RESERVED_PX, viewport.height / 3), right: viewport.width, bottom: viewport.height }
}

type Point3 = readonly [number, number, number]

/**
 * Frame points, relative to the plan centre: the plan's own outline (wall ends, zone vertices) when known — at a
 * diagonal azimuth the box corners are empty diamond tips nothing occupies (ch-04: the far box corner set the
 * frame 80 px above the real roof line) — else the box corners. Each at floor and at `top`.
 */
function framePoints(bounds: Bounds, top: number): Point3[] {
  const [cx, cz] = bounds.center
  const [sx, sz] = bounds.size
  const plan: [number, number][] = bounds.points?.length
    ? bounds.points.map(([x, z]): [number, number] => [x - cx, z - cz])
    : [[-sx / 2, -sz / 2], [sx / 2, -sz / 2], [sx / 2, sz / 2], [-sx / 2, sz / 2]]
  return plan.flatMap(([x, z]) => [[x, 0, z] as const, [x, top, z] as const])
}

/**
 * Azimuth from `fitAzimuth`, 52° elevation, 24° lens. The smallest distance at which the points span FILL of
 * `free` on both axes (exact perspective, bisection), then the camera slides parallel to the image so the points
 * sit centred in `free` — the toolbar's reserve is paid once, not twice (old fit kept the plan centre at the canvas
 * centre: the top half lost 120 px and the bottom half kept ~160 px empty). The target then returns to the floor
 * along the view ray: same picture, and orbit still turns around a point on the floor.
 */
function framePose(
  bounds: Bounds,
  top: number,
  projection: CameraPose['projection'],
  viewport: Viewport,
  free: FreeRect,
  baseY: number,
): CameraPose {
  const [cx, cz] = bounds.center
  const azimuth = fitAzimuth(bounds.size)
  const sin = Math.sin(ELEVATION)
  const cos = Math.cos(ELEVATION)
  const sa = Math.sin(azimuth)
  const ca = Math.cos(azimuth)
  // Camera basis: back (target -> camera), right, up.
  const back = [cos * sa, sin, cos * ca] as const
  const right = [ca, 0, -sa] as const
  const up = [-sin * sa, cos, -sin * ca] as const
  const dot = (a: readonly number[], b: readonly number[]) => a[0]! * b[0]! + a[1]! * b[1]! + a[2]! * b[2]!
  const points = framePoints(bounds, top).map((c) => [dot(c, right), dot(c, up), dot(c, back)] as const)
  const tanV = Math.tan((FIT_FOV * Math.PI) / 360)
  const tanH = tanV * (viewport.width / viewport.height)
  const freeX = [((2 * free.left) / viewport.width - 1) * tanH, ((2 * free.right) / viewport.width - 1) * tanH] as const
  const freeY = [(1 - (2 * free.bottom) / viewport.height) * tanV, (1 - (2 * free.top) / viewport.height) * tanV] as const
  // Extents on the image plane at distance d (image coordinates in tan units).
  const extents = (d: number) => {
    const e = { x0: Infinity, x1: -Infinity, y0: Infinity, y1: -Infinity }
    for (const [r, u, b] of points) {
      const x = r / (d - b)
      const y = u / (d - b)
      e.x0 = Math.min(e.x0, x)
      e.x1 = Math.max(e.x1, x)
      e.y0 = Math.min(e.y0, y)
      e.y1 = Math.max(e.y1, y)
    }
    return e
  }
  const fits = (d: number) => {
    const e = extents(d)
    return e.x1 - e.x0 <= FILL * (freeX[1] - freeX[0]) && e.y1 - e.y0 <= FILL * (freeY[1] - freeY[0])
  }
  let near = MIN_DISTANCE
  for (const p of points) near = Math.max(near, p[2] + 0.5)
  let far = near
  while (!fits(far) && far < 1e4) far *= 1.5
  for (let i = 0; i < 30 && far - near > 0.01; i++) {
    const mid = (near + far) / 2
    if (fits(mid)) far = mid
    else near = mid
  }
  const e = extents(far)
  const slideX = ((e.x0 + e.x1) / 2 - (freeX[0] + freeX[1]) / 2) * far
  const slideY = ((e.y0 + e.y1) / 2 - (freeY[0] + freeY[1]) / 2) * far
  const px = right[0] * slideX + up[0] * slideY + back[0] * far
  const py = right[1] * slideX + up[1] * slideY + back[1] * far
  const pz = right[2] * slideX + up[2] * slideY + back[2] * far
  const toFloor = py / back[1]
  return {
    position: [cx + px, baseY + py, cz + pz],
    target: [cx + px - back[0] * toFloor, baseY, cz + pz - back[2] * toFloor],
    projection,
    fov: FIT_FOV,
  }
}

/**
 * The whole plan (floor to wall tops) filling FILL of `free` — by default the canvas below the toolbar. `baseY`
 * lifts the frame to a floor that stands above ground (solo mode keeps its stacked height, UX-R2 K38).
 */
export function fitPose(
  bounds: Bounds | null,
  projection: CameraPose['projection'],
  viewport: Viewport = viewportOf(),
  baseY = 0,
  free: FreeRect = belowToolbar(viewport),
): CameraPose {
  if (!bounds) return { position: [20, 20, 20], target: [0, 0, 0], projection }
  return framePose(bounds, WALL_TOP, projection, viewport, free, baseY)
}

/** Room frame height (m): floor and furniture must show; tall wall tops may run behind the toolbar. */
const ROOM_FRAME_TOP = 1.2

/** UX-R4 U40: one room filling FILL of `free` (same solver as `fitPose`, frame height ROOM_FRAME_TOP). */
export function fitRoomPose(
  bounds: Bounds | null,
  projection: CameraPose['projection'],
  viewport: Viewport,
  free: FreeRect,
  baseY = 0,
): CameraPose {
  if (!bounds) return { position: [20, 20, 20], target: [0, 0, 0], projection }
  return framePose(bounds, ROOM_FRAME_TOP, projection, viewport, free, baseY)
}

/**
 * Run `fit` once the next camera-controls instance has published a pose (it fires right away
 * if one is already mounted), two frames later so its own mount-time `setLookAt` has run.
 * ponytail: gives up after `timeoutMs`; the "Xem toàn bộ" button is the manual fallback.
 */
export function fitWhenControlsReady(
  subscribe: (listener: () => void) => () => void,
  fit: () => void,
  timeoutMs = 10_000,
): () => void {
  let done = false
  let raf = 0
  let unsubscribe: (() => void) | null = null
  const stop = () => {
    done = true
    unsubscribe?.()
    unsubscribe = null
  }
  const timer = setTimeout(stop, timeoutMs)
  unsubscribe = subscribe(() => {
    if (done) return
    stop()
    clearTimeout(timer)
    raf = requestAnimationFrame(() => {
      raf = requestAnimationFrame(fit)
    })
  })
  if (done) unsubscribe?.()
  return () => {
    stop()
    clearTimeout(timer)
    cancelAnimationFrame(raf)
  }
}
