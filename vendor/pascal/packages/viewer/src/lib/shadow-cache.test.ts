// @ts-expect-error — bun:test is provided by the Bun runtime; viewer does not
// depend on @types/bun so the import type is unresolved at compile time.
import { expect, test } from 'bun:test'
import * as THREE from 'three'
import { SHADOW_REFRESH_FRAMES, ShadowCache } from './shadow-cache'

function setup() {
  const scene = new THREE.Scene()
  const light = new THREE.DirectionalLight()
  light.castShadow = true
  scene.add(light, light.target)
  const level = new THREE.Group() as THREE.Group & { isClippingGroup: boolean; clippingPlanes: THREE.Plane[] }
  level.isClippingGroup = true
  level.clippingPlanes = [new THREE.Plane(new THREE.Vector3(0, -1, 0), 1e6)]
  const box = new THREE.Mesh(new THREE.BoxGeometry(), new THREE.MeshStandardMaterial())
  box.castShadow = true
  level.add(box)
  scene.add(level)
  scene.updateMatrixWorld()
  return { scene, light, level, box, cache: new ShadowCache() }
}

test('shadow map re-renders only when casters, lights or cut planes change', () => {
  const { scene, light, level, box, cache } = setup()
  expect(cache.sync(scene)).toBe(true) // first sight
  expect(light.shadow.autoUpdate).toBe(false)
  expect(light.shadow.needsUpdate).toBe(true)
  light.shadow.needsUpdate = false // the renderer clears it after drawing

  expect(cache.sync(scene)).toBe(false) // camera-only frame: nothing the shadow pass reads changed
  expect(light.shadow.needsUpdate).toBe(false)

  box.position.x = 2
  scene.updateMatrixWorld()
  expect(cache.sync(scene)).toBe(true)
  light.shadow.needsUpdate = false

  level.clippingPlanes[0]!.constant = 1.4 // cut slides (cutSync) → shadows clip differently
  expect(cache.sync(scene)).toBe(true)
  light.shadow.needsUpdate = false

  box.castShadow = false
  expect(cache.sync(scene)).toBe(true)
  light.shadow.needsUpdate = false
})

test('forced refresh every SHADOW_REFRESH_FRAMES frames', () => {
  const { scene, cache } = setup()
  cache.sync(scene)
  let updates = 0
  for (let i = 0; i < SHADOW_REFRESH_FRAMES * 2; i++) if (cache.sync(scene)) updates++
  expect(updates).toBe(2)
})

test('owner writing autoUpdate every frame (r3t-tiers) does not force renders; intensity 0 (tier low) renders nothing', () => {
  const { scene, light, box, cache } = setup()
  cache.sync(scene)
  light.shadow.needsUpdate = false
  light.shadow.autoUpdate = true // lights.tsx, medium tier, next frame
  expect(cache.sync(scene)).toBe(false)
  expect(light.shadow.needsUpdate).toBe(false)
  expect(light.shadow.autoUpdate).toBe(false)
  box.position.y = 1 // no owner write this frame: still tracked
  scene.updateMatrixWorld()
  expect(cache.sync(scene)).toBe(true)
  expect(light.shadow.needsUpdate).toBe(true)
  light.shadow.needsUpdate = false
  light.shadow.intensity = 0 // tier low
  light.position.x = 5
  scene.updateMatrixWorld()
  cache.sync(scene)
  expect(light.shadow.needsUpdate).toBe(false)
  expect(light.shadow.autoUpdate).toBe(false)
})

test('swapped alpha texture (same version) and material clip-plane normal re-render', () => {
  const { scene, light, box, cache } = setup()
  const mat = box.material as THREE.MeshStandardMaterial
  mat.alphaMap = new THREE.Texture()
  mat.clippingPlanes = [new THREE.Plane(new THREE.Vector3(0, -1, 0), 2)]
  cache.sync(scene)
  light.shadow.needsUpdate = false
  expect(cache.sync(scene)).toBe(false)
  mat.alphaMap = new THREE.Texture() // new identity, version 0 like the old one
  expect(cache.sync(scene)).toBe(true)
  mat.clippingPlanes[0]!.normal.set(1, 0, 0) // constant unchanged
  expect(cache.sync(scene)).toBe(true)
})
