// Pointer raycasts (R3F hover/click) walk every triangle of every mesh under the
// pointer. GLB furniture carries 10^4–10^6 triangles, so on ch-04 one
// pointermove cost 150–280 ms of main thread (CPU profile 2026-11-09: top
// self-time fromBufferAttribute / getVertexPosition / intersectTriangle) —
// that was the p95 frame spike while orbiting, and the lag when hovering.
//
// Patch Mesh.prototype.raycast once and raycast big geometries through a
// three-mesh-bvh tree (`indirect` — the geometry's index is never reordered).
// Hits are the same as three's brute-force path. Small, skinned, morphed or
// draw-range-limited geometries (BatchedMesh/InstancedMesh temp meshes) keep the
// stock raycast.
//
// Trees are built in the BACKGROUND, one geometry per idle slot
// (`requestIdleCallback`, `setTimeout` fallback): item models queue themselves as
// soon as their GLB mounts (`queueLazyBvh`, item renderer). Building on the first
// hover cost 355 ms for a 978 k-triangle model right under the pointer (review
// 2026-11-09). A ray that reaches a geometry whose tree is not ready yet moves it
// to the front of the queue and answers with its bounding box (one hit where the
// ray enters the box, face normal = that box side) — cheap and close enough for
// hover/click until the tree lands a few frames later.
import {
  Box3,
  type BufferGeometry,
  type Intersection,
  Matrix4,
  Mesh,
  type Object3D,
  Ray,
  type Raycaster,
  Sphere,
  Vector3,
} from 'three'
import { acceleratedRaycast, MeshBVH } from 'three-mesh-bvh'

export const LAZY_BVH_MIN_TRIANGLES = 2000

type BvhGeometry = BufferGeometry & { boundsTree?: MeshBVH }

type BuiltKey = { position: unknown; index: unknown; sig: string }
const builtAt = new WeakMap<BufferGeometry, BuiltKey>()
const sphere = new Sphere()
const inverse = new Matrix4()
const localRay = new Ray()
const localHit = new Vector3()
const center = new Vector3()
const size = new Vector3()

type VersionedAttribute = { count: number; version: number; isInterleavedBufferAttribute?: boolean; data?: { version: number } }
const versionOf = (a: VersionedAttribute | null | undefined) =>
  a ? `${a.count}/${a.isInterleavedBufferAttribute ? a.data?.version : a.version}` : '-'

/** Everything the tree was built from: attribute identity (compared by reference), counts, versions, groups, range. */
function sameBuild(g: BufferGeometry, key: BuiltKey | undefined): boolean {
  return !!key && key.position === g.attributes.position && key.index === g.index && key.sig === buildSig(g)
}
function buildSig(g: BufferGeometry): string {
  let sig = `${versionOf(g.attributes.position as VersionedAttribute)}|${versionOf(g.index as VersionedAttribute | null)}|${g.drawRange.start},${g.drawRange.count}`
  for (const group of g.groups) sig += `|${group.start},${group.count},${group.materialIndex}`
  return sig
}

export function wantsLazyBvh(mesh: Mesh): boolean {
  const g = mesh.geometry
  const position = g?.attributes.position
  // Interleaved/quantized positions (meshopt GLBs) are fine for MeshBVH; an interleaved index is not.
  if (!position || (g.index as { isInterleavedBufferAttribute?: boolean } | null)?.isInterleavedBufferAttribute) {
    return false
  }
  if ((mesh as { isSkinnedMesh?: boolean }).isSkinnedMesh || g.morphAttributes.position) return false
  const count = g.index ? g.index.count : position.count
  if (count / 3 < LAZY_BVH_MIN_TRIANGLES) return false
  return g.drawRange.start === 0 && g.drawRange.count >= count
}

/** The tree when it still describes the geometry; a stale one (edited/swapped attributes) is dropped. */
function readyTree(g: BvhGeometry): MeshBVH | undefined {
  if (g.boundsTree && !sameBuild(g, builtAt.get(g))) g.boundsTree = undefined
  return g.boundsTree
}

function build(g: BvhGeometry): void {
  if (readyTree(g)) return
  g.boundsTree = new MeshBVH(g, { indirect: true })
  builtAt.set(g, { position: g.attributes.position, index: g.index, sig: buildSig(g) })
}

// ---- background queue ------------------------------------------------------
/** Insertion order = build order; a ray-hit geometry is moved to the front. */
let pending = new Set<BvhGeometry>()
let scheduled = false
type Deadline = { timeRemaining(): number }
const onIdle: (cb: (d: Deadline) => void) => void =
  typeof requestIdleCallback === 'function'
    ? (cb) => requestIdleCallback(cb, { timeout: 500 })
    : (cb) => setTimeout(() => cb({ timeRemaining: () => 0 }), 16)

function schedule() {
  if (scheduled || pending.size === 0) return
  scheduled = true
  onIdle(pump)
}

/** One geometry per slot at least (a tree cannot be split), more while the idle slot has time left. */
function pump(deadline: Deadline) {
  scheduled = false
  let first = true
  for (const g of pending) {
    if (!first && deadline.timeRemaining() < 4) break
    pending.delete(g)
    build(g)
    first = false
  }
  schedule()
}

function enqueue(g: BvhGeometry, front: boolean) {
  if (front) {
    if (pending.values().next().value === g) return
    pending.delete(g)
    pending = new Set([g, ...pending])
  } else {
    pending.add(g)
  }
  schedule()
}

/** Queue background trees for every eligible mesh under `root` (call once its geometry is final, e.g. a GLB mounted). */
export function queueLazyBvh(root: Object3D): void {
  if (!installed || disabled || syncBuild) return
  root.traverse((o) => {
    const mesh = o as Mesh
    if (!mesh.isMesh || !wantsLazyBvh(mesh)) return
    const g = mesh.geometry as BvhGeometry
    if (!readyTree(g)) enqueue(g, false)
  })
}

/** Build everything queued now (tests, or a caller that must have exact hits before going on). */
export function flushLazyBvh(): void {
  for (const g of pending) build(g)
  pending.clear()
}

/** Geometries still waiting for a tree (diagnostics/tests). */
export const pendingLazyBvh = (): number => pending.size

// ---- raycast ---------------------------------------------------------------
const stockRaycast = Mesh.prototype.raycast

/** Stand-in hit while the tree is queued: where the ray enters the local bounding box. */
function boxRaycast(mesh: Mesh, g: BufferGeometry, raycaster: Raycaster, intersects: Intersection[]) {
  if (g.boundingBox === null) g.computeBoundingBox()
  const bb = g.boundingBox!
  inverse.copy(mesh.matrixWorld).invert()
  localRay.copy(raycaster.ray).applyMatrix4(inverse)
  if (!localRay.intersectBox(bb, localHit)) return
  // Box side the ray entered through → outward normal (local space, like three's face normals).
  bb.getCenter(center)
  bb.getSize(size)
  const rx = (localHit.x - center.x) / (size.x || 1)
  const ry = (localHit.y - center.y) / (size.y || 1)
  const rz = (localHit.z - center.z) / (size.z || 1)
  const ax = Math.abs(rx)
  const ay = Math.abs(ry)
  const az = Math.abs(rz)
  const normal =
    ax >= ay && ax >= az
      ? new Vector3(Math.sign(rx), 0, 0)
      : ay >= az
        ? new Vector3(0, Math.sign(ry), 0)
        : new Vector3(0, 0, Math.sign(rz))
  const point = localHit.clone().applyMatrix4(mesh.matrixWorld)
  const distance = raycaster.ray.origin.distanceTo(point)
  if (distance < raycaster.near || distance > raycaster.far) return
  intersects.push({ distance, point, object: mesh, face: { a: 0, b: 0, c: 0, normal, materialIndex: 0 }, faceIndex: 0 })
}

function lazyBvhRaycast(this: Mesh, raycaster: Raycaster, intersects: Intersection[]) {
  const g = this.geometry as BvhGeometry
  // Checked on every cast: a draw range narrowed after the build (or skinning/morphs) means the tree no
  // longer describes what is drawn → stock path.
  if (!wantsLazyBvh(this)) {
    stockRaycast.call(this, raycaster, intersects)
    return
  }
  if (!readyTree(g)) {
    if (g.boundingSphere === null) g.computeBoundingSphere()
    sphere.copy(g.boundingSphere!).applyMatrix4(this.matrixWorld)
    // Same early-out three's raycast takes; only geometries a ray reaches jump the queue.
    if (!raycaster.ray.intersectsSphere(sphere)) return
    if (syncBuild) {
      build(g)
      acceleratedRaycast.call(this, raycaster, intersects)
      return
    }
    enqueue(g, true)
    boxRaycast(this, g, raycaster, intersects)
    return
  }
  acceleratedRaycast.call(this, raycaster, intersects)
}

let installed = false
let disabled = false
/** `?disable=bvhidle`: build on the first ray like before (A/B for the first-hover bench). */
const syncBuild =
  typeof window !== 'undefined' &&
  (new URLSearchParams(window.location.search).get('disable') ?? '').split(',').includes('bvhidle')
/** Idempotent; `?disable=bvh` keeps the stock raycast (bench before/after). */
export function installLazyBvhRaycast() {
  if (installed) return
  installed = true
  if (
    typeof window !== 'undefined' &&
    (new URLSearchParams(window.location.search).get('disable') ?? '').split(',').includes('bvh')
  ) {
    disabled = true
    return
  }
  Mesh.prototype.raycast = lazyBvhRaycast
}
