// @ts-expect-error — bun:test is provided by the Bun runtime; viewer does not
// depend on @types/bun so the import type is unresolved at compile time.
import { expect, test } from 'bun:test'
import * as THREE from 'three'
import {
  flushLazyBvh,
  installLazyBvhRaycast,
  pendingLazyBvh,
  queueLazyBvh,
  wantsLazyBvh,
} from './lazy-bvh-raycast'

const stockRaycast = THREE.Mesh.prototype.raycast
const treeOf = (g: THREE.BufferGeometry) => (g as unknown as { boundsTree?: unknown }).boundsTree
const hits = (list: THREE.Intersection[]) => list.map((h) => [h.faceIndex, h.distance.toFixed(6)])

test('a ray never answers with a stand-in: exact hits while the tree is pending, which jumps the queue', () => {
  const stock = THREE.Mesh.prototype.raycast
  const geometry = new THREE.SphereGeometry(1, 64, 64) // 7 936 triangles → eligible
  const mesh = new THREE.Mesh(geometry, new THREE.MeshBasicMaterial())
  mesh.position.set(0.3, 0, -5)
  mesh.updateMatrixWorld()
  expect(wantsLazyBvh(mesh)).toBe(true)
  const ray = new THREE.Raycaster(new THREE.Vector3(0, 0.2, 0), new THREE.Vector3(0, 0, -1))
  const before = ray.intersectObject(mesh)
  installLazyBvhRaycast()
  expect(THREE.Mesh.prototype.raycast).not.toBe(stock)

  const pendingHits = ray.intersectObject(mesh)
  expect(treeOf(geometry)).toBeUndefined()
  expect(pendingLazyBvh()).toBe(1)
  expect(hits(pendingHits)).toEqual(hits(before))
  expect(pendingHits[0]!.point.toArray()).toEqual(before[0]!.point.toArray())

  flushLazyBvh()
  expect(treeOf(geometry)).toBeDefined()
  const built = ray.intersectObject(mesh)
  expect(hits(built)).toEqual(hits(pendingHits))
  expect(built[0]!.point.distanceTo(pendingHits[0]!.point)).toBeLessThan(1e-9)

  // A ray that misses the bounding sphere queues nothing.
  const other = new THREE.Mesh(new THREE.SphereGeometry(1, 64, 64), mesh.material)
  other.position.set(50, 0, -5)
  other.updateMatrixWorld()
  expect(ray.intersectObject(other)).toEqual([])
  expect(pendingLazyBvh()).toBe(0)
  // Small geometry keeps the stock path.
  expect(wantsLazyBvh(new THREE.Mesh(new THREE.BoxGeometry(), mesh.material))).toBe(false)
})

test('a ray through the hole of a pending torus hits nothing (review: the box stand-in hit it)', () => {
  installLazyBvhRaycast()
  const geometry = new THREE.TorusGeometry(1, 0.3, 64, 64) // 8 192 triangles, hole radius 0.7 around z
  const mesh = new THREE.Mesh(geometry, new THREE.MeshBasicMaterial())
  mesh.position.set(0, 0, -5)
  mesh.updateMatrixWorld()
  expect(wantsLazyBvh(mesh)).toBe(true)
  const hole = new THREE.Raycaster(new THREE.Vector3(0, 0, 0), new THREE.Vector3(0, 0, -1))
  expect(hole.intersectObject(mesh)).toEqual([])
  expect(pendingLazyBvh()).toBe(1) // the sphere test passed → queued at the front
  const tube = new THREE.Raycaster(new THREE.Vector3(0.97, 0.13, 0), new THREE.Vector3(0, 0, -1)) // off the u/v seams
  const pendingHits = tube.intersectObject(mesh)
  expect(pendingHits.length).toBe(1)
  flushLazyBvh()
  expect(hole.intersectObject(mesh)).toEqual([])
  expect(hits(tube.intersectObject(mesh))).toEqual(hits(pendingHits))
})

test('queueLazyBvh builds in the background (idle slots), not on the caller', async () => {
  installLazyBvhRaycast()
  const group = new THREE.Group()
  const a = new THREE.Mesh(new THREE.SphereGeometry(1, 64, 64))
  const b = new THREE.Mesh(new THREE.SphereGeometry(1, 64, 32))
  const small = new THREE.Mesh(new THREE.BoxGeometry())
  group.add(a, b, small)
  queueLazyBvh(group)
  expect(pendingLazyBvh()).toBe(2)
  expect(treeOf(a.geometry)).toBeUndefined()
  await new Promise((r) => setTimeout(r, 200))
  expect(pendingLazyBvh()).toBe(0)
  expect(treeOf(a.geometry)).toBeDefined()
  expect(treeOf(b.geometry)).toBeDefined()
  expect(treeOf(small.geometry)).toBeUndefined()
})

test('a pending model above LAZY_BVH_SYNC_TRIANGLES builds its tree on the first ray, exactly once', () => {
  installLazyBvhRaycast()
  const geometry = new THREE.SphereGeometry(1, 700, 700) // 978 600 triangles
  const mesh = new THREE.Mesh(geometry)
  mesh.position.set(0, 0, -5)
  mesh.updateMatrixWorld()
  queueLazyBvh(mesh)
  expect(pendingLazyBvh()).toBe(1)
  const ray = new THREE.Raycaster(new THREE.Vector3(0, 0, 0), new THREE.Vector3(0, 0, -1))
  const t0 = performance.now()
  const first = ray.intersectObject(mesh)
  const buildMs = performance.now() - t0
  const tree = treeOf(geometry)
  expect(tree).toBeDefined()
  expect(pendingLazyBvh()).toBe(0) // left the queue: no second build in the background
  expect(first.length).toBe(1)
  expect(first[0]!.point.z).toBeCloseTo(-4, 3)
  const t1 = performance.now()
  ray.intersectObject(mesh)
  const nextMs = performance.now() - t1
  expect(treeOf(geometry)).toBe(tree)
  const t2 = performance.now()
  stockRaycast.call(mesh, ray, [])
  const bruteMs = performance.now() - t2
  console.log(`978k tris: build-on-ray ${buildMs.toFixed(0)} ms, next ray ${nextMs.toFixed(2)} ms, brute-force ray ${bruteMs.toFixed(0)} ms`)
})

test('draw range narrowed after the build falls back to the stock raycast; swapped attributes rebuild', () => {
  installLazyBvhRaycast()
  const geometry = new THREE.SphereGeometry(1, 64, 64)
  const mesh = new THREE.Mesh(geometry, new THREE.MeshBasicMaterial())
  mesh.position.set(0, 0, -5)
  mesh.updateMatrixWorld()
  const ray = new THREE.Raycaster(new THREE.Vector3(0, 0, 0), new THREE.Vector3(0, 0, -1))
  queueLazyBvh(mesh)
  flushLazyBvh()
  expect(ray.intersectObject(mesh).length).toBeGreaterThan(0)
  const tree = treeOf(geometry)
  expect(tree).toBeDefined()
  geometry.setDrawRange(0, 0)
  expect(ray.intersectObject(mesh)).toEqual([])
  geometry.setDrawRange(0, Infinity)
  const swapped = new THREE.SphereGeometry(1, 64, 64)
  geometry.setAttribute('position', swapped.attributes.position!) // same version numbers, new identity
  expect(ray.intersectObject(mesh).length).toBe(1) // stale tree dropped → exact stock hit, rebuild queued
  expect(treeOf(geometry)).toBeUndefined()
  flushLazyBvh()
  expect(treeOf(geometry)).toBeDefined()
  expect(treeOf(geometry)).not.toBe(tree)
})
