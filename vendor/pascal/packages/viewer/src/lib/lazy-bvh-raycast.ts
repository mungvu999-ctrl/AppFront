// Pointer raycasts (R3F hover/click) walk every triangle of every mesh under the
// pointer. GLB furniture carries 10^4–10^6 triangles, so on ch-04 one
// pointermove cost 150–280 ms of main thread (CPU profile 2026-11-09: top
// self-time fromBufferAttribute / getVertexPosition / intersectTriangle) —
// that was the p95 frame spike while orbiting, and the lag when hovering.
//
// Patch Mesh.prototype.raycast once: the first time a ray actually reaches a
// big geometry's bounding sphere, build a three-mesh-bvh tree for it
// (`indirect` — the geometry's index is never reordered), then raycast through
// the tree. Hits are the same as three's brute-force path. Small, skinned,
// morphed or draw-range-limited geometries (BatchedMesh/InstancedMesh temp
// meshes) keep the stock raycast.
import { type BufferGeometry, Mesh, type Raycaster, Sphere, type Intersection } from 'three'
import { acceleratedRaycast, MeshBVH } from 'three-mesh-bvh'

export const LAZY_BVH_MIN_TRIANGLES = 2000

type BvhGeometry = BufferGeometry & { boundsTree?: MeshBVH }

type BuiltKey = { position: unknown; index: unknown; sig: string }
const builtAt = new WeakMap<BufferGeometry, BuiltKey>()
const sphere = new Sphere()

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

const stockRaycast = Mesh.prototype.raycast

function lazyBvhRaycast(this: Mesh, raycaster: Raycaster, intersects: Intersection[]) {
  const g = this.geometry as BvhGeometry
  // Checked on every cast: a draw range narrowed after the build (or skinning/morphs) means the tree no
  // longer describes what is drawn → stock path.
  if (!wantsLazyBvh(this)) {
    stockRaycast.call(this, raycaster, intersects)
    return
  }
  // Edited or swapped attributes since the build → drop the stale tree (rebuilt below).
  if (g.boundsTree && !sameBuild(g, builtAt.get(g))) g.boundsTree = undefined
  if (!g.boundsTree) {
    if (g.boundingSphere === null) g.computeBoundingSphere()
    sphere.copy(g.boundingSphere!).applyMatrix4(this.matrixWorld)
    // Same early-out three's raycast takes; only geometries a ray reaches pay for a tree.
    if (!raycaster.ray.intersectsSphere(sphere)) return
    g.boundsTree = new MeshBVH(g, { indirect: true })
    builtAt.set(g, { position: g.attributes.position, index: g.index, sig: buildSig(g) })
  }
  acceleratedRaycast.call(this, raycaster, intersects)
}

let installed = false
/** Idempotent; `?disable=bvh` keeps the stock raycast (bench before/after). */
export function installLazyBvhRaycast() {
  if (installed) return
  installed = true
  if (
    typeof window !== 'undefined' &&
    (new URLSearchParams(window.location.search).get('disable') ?? '').split(',').includes('bvh')
  ) {
    return
  }
  Mesh.prototype.raycast = lazyBvhRaycast
}
