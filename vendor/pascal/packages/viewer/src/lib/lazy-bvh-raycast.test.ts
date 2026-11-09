// @ts-expect-error — bun:test is provided by the Bun runtime; viewer does not
// depend on @types/bun so the import type is unresolved at compile time.
import { expect, test } from 'bun:test'
import * as THREE from 'three'
import { installLazyBvhRaycast, wantsLazyBvh } from './lazy-bvh-raycast'

test('lazy BVH raycast returns the same hits as the stock raycast', () => {
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
  const after = ray.intersectObject(mesh)
  expect((geometry as unknown as { boundsTree?: unknown }).boundsTree).toBeDefined()
  expect(after.map((h) => [h.faceIndex, h.distance.toFixed(6)])).toEqual(
    before.map((h) => [h.faceIndex, h.distance.toFixed(6)]),
  )
  // A ray that misses the bounding sphere builds nothing.
  const other = new THREE.Mesh(new THREE.SphereGeometry(1, 64, 64), mesh.material)
  other.position.set(50, 0, -5)
  other.updateMatrixWorld()
  expect(ray.intersectObject(other)).toEqual([])
  expect((other.geometry as unknown as { boundsTree?: unknown }).boundsTree).toBeUndefined()
  // Small geometry keeps the stock path.
  expect(wantsLazyBvh(new THREE.Mesh(new THREE.BoxGeometry(), mesh.material))).toBe(false)
})

test('draw range narrowed after the build falls back to the stock raycast; swapped attributes rebuild', () => {
  installLazyBvhRaycast()
  const geometry = new THREE.SphereGeometry(1, 64, 64)
  const mesh = new THREE.Mesh(geometry, new THREE.MeshBasicMaterial())
  mesh.position.set(0, 0, -5)
  mesh.updateMatrixWorld()
  const ray = new THREE.Raycaster(new THREE.Vector3(0, 0, 0), new THREE.Vector3(0, 0, -1))
  expect(ray.intersectObject(mesh).length).toBeGreaterThan(0)
  const tree = (geometry as unknown as { boundsTree?: unknown }).boundsTree
  expect(tree).toBeDefined()
  geometry.setDrawRange(0, 0)
  expect(ray.intersectObject(mesh)).toEqual([])
  geometry.setDrawRange(0, Infinity)
  const swapped = new THREE.SphereGeometry(1, 64, 64)
  geometry.setAttribute('position', swapped.attributes.position!) // same version numbers, new identity
  expect(ray.intersectObject(mesh).length).toBeGreaterThan(0)
  expect((geometry as unknown as { boundsTree?: unknown }).boundsTree).not.toBe(tree)
})
