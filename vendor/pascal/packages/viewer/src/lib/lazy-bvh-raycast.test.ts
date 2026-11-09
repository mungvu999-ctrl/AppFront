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

const treeOf = (g: THREE.BufferGeometry) => (g as unknown as { boundsTree?: unknown }).boundsTree
const hits = (list: THREE.Intersection[]) => list.map((h) => [h.faceIndex, h.distance.toFixed(6)])

test('a ray never builds a tree: it answers with the bounding box and jumps the background queue', () => {
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

  const stand = ray.intersectObject(mesh)
  expect(treeOf(geometry)).toBeUndefined()
  expect(pendingLazyBvh()).toBe(1)
  expect(stand.length).toBe(1)
  expect(stand[0]!.object).toBe(mesh)
  expect(stand[0]!.point.z).toBeCloseTo(-4, 5) // front face of the box (sphere radius 1 at z = -5)
  expect(stand[0]!.face!.normal.toArray()).toEqual([0, 0, 1])

  flushLazyBvh()
  expect(treeOf(geometry)).toBeDefined()
  expect(hits(ray.intersectObject(mesh))).toEqual(hits(before))

  // A ray that misses the bounding sphere queues nothing.
  const other = new THREE.Mesh(new THREE.SphereGeometry(1, 64, 64), mesh.material)
  other.position.set(50, 0, -5)
  other.updateMatrixWorld()
  expect(ray.intersectObject(other)).toEqual([])
  expect(pendingLazyBvh()).toBe(0)
  // Small geometry keeps the stock path.
  expect(wantsLazyBvh(new THREE.Mesh(new THREE.BoxGeometry(), mesh.material))).toBe(false)
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

test('first ray on a 978 k-triangle model stays cheap (review: 355 ms when it built the tree)', () => {
  installLazyBvhRaycast()
  const geometry = new THREE.SphereGeometry(1, 700, 700) // 978 600 triangles
  // GLTFLoader fills both bounds from accessor min/max at load; the renderer would have the sphere for culling anyway.
  geometry.computeBoundingSphere()
  geometry.computeBoundingBox()
  const mesh = new THREE.Mesh(geometry)
  mesh.position.set(0, 0, -5)
  mesh.updateMatrixWorld()
  const ray = new THREE.Raycaster(new THREE.Vector3(0, 0, 0), new THREE.Vector3(0, 0, -1))
  const t0 = performance.now()
  expect(ray.intersectObject(mesh).length).toBe(1)
  const first = performance.now() - t0
  const t1 = performance.now()
  flushLazyBvh()
  const buildMs = performance.now() - t1
  console.log(`978k tris: first ray ${first.toFixed(2)} ms, background build ${buildMs.toFixed(0)} ms`)
  expect(first).toBeLessThan(20)
  expect(ray.intersectObject(mesh)[0]!.faceIndex).toBeGreaterThanOrEqual(0)
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
  expect(ray.intersectObject(mesh).length).toBe(1) // stale tree dropped → box stand-in, rebuild queued
  expect(treeOf(geometry)).toBeUndefined()
  flushLazyBvh()
  expect(treeOf(geometry)).toBeDefined()
  expect(treeOf(geometry)).not.toBe(tree)
})
