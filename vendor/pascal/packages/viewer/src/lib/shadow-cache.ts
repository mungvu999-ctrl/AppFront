// Shadow maps on demand. The key light's shadow frustum is fit to the BUILDING
// (lights.tsx), not the camera, so orbiting never changes the shadow map — yet
// three re-renders it every frame (ch-04, 2026-11-09: 259 casters, 2.2 M
// triangles, ~1/3 of draw calls per frame).
//
// Each drawn frame, build a signature of everything the shadow pass reads —
// shadow lights (pose, target, shadow camera, map size), casters (id, geometry
// + attribute identity/versions, draw range, layers, matrixWorld, materials
// with texture identity/version/UV transform, instance/batch
// state), and clipping groups (`clipShadows`: cut planes slide with the camera,
// cutSync.ts) — and only flag `shadow.needsUpdate` when it changed. A forced
// refresh every REFRESH_FRAMES drawn frames bounds any change the signature
// misses. Skinned/morphed casters push NaN, so they update every frame as before.
import type { Light, Material, Mesh, Object3D, Plane, Texture } from 'three'

type VersionedAttr = { version?: number; isInterleavedBufferAttribute?: boolean; data?: { version: number } }
/** InterleavedBufferAttribute keeps its version on `.data`; a plain attribute on itself. */
const attrVersion = (a: unknown): number => {
  const v = a as VersionedAttr | null | undefined
  if (!v) return -1
  return (v.isInterleavedBufferAttribute ? v.data?.version : v.version) ?? -1
}

/** Stable number per object (attribute, texture…): a swapped one with an equal version still changes the signature. */
const ids = new WeakMap<object, number>()
let nextId = 1
const idOf = (o: unknown): number => {
  if (!o || typeof o !== 'object') return -1
  let id = ids.get(o)
  if (id === undefined) ids.set(o, (id = nextId++))
  return id
}

export const SHADOW_REFRESH_FRAMES = 30

type ShadowLight = Light & {
  shadow?: { autoUpdate: boolean; needsUpdate: boolean; intensity: number; camera: { projectionMatrix: { elements: ArrayLike<number> } }; mapSize: { x: number; y: number } }
  target?: Object3D
}
type ClipGroup = Object3D & { isClippingGroup?: boolean; enabled?: boolean; clippingPlanes?: Plane[] }
type AnyMesh = Mesh & {
  isSkinnedMesh?: boolean
  isInstancedMesh?: boolean
  instanceMatrix?: { version: number }
  count?: number
  isBatchedMesh?: boolean
  _matricesTexture?: { version: number }
  _visibilityChanged?: boolean
  _multiDrawCount?: number
}

export class ShadowCache {
  private prev = new Float64Array(0)
  private next = new Float64Array(4096)
  private n = 0
  private sinceRefresh = 0
  private readonly seen = new WeakSet<object>()
  /** Shadow-map renders this cache requested (diagnostics/tests). */
  updates = 0

  private push(v: number) {
    if (this.n === this.next.length) {
      const grown = new Float64Array(this.next.length * 2)
      grown.set(this.next)
      this.next = grown
    }
    this.next[this.n++] = v
  }

  private pushMatrix(e: ArrayLike<number>) {
    for (let i = 0; i < 16; i++) this.push(e[i]!)
  }

  private pushTexture(t: Texture | null | undefined) {
    if (!t) return this.push(-1)
    this.push(idOf(t))
    this.push(t.version)
    this.push(t.offset.x), this.push(t.offset.y), this.push(t.repeat.x), this.push(t.repeat.y), this.push(t.rotation)
  }

  private pushMaterial(m: Material | undefined) {
    if (!m) return this.push(-1)
    const r = m as Material & { map?: Texture | null; alphaMap?: Texture | null }
    this.push((m as unknown as { id: number }).id)
    this.push(m.version)
    this.push(m.visible ? 1 : 0)
    this.push(m.alphaTest)
    // Texture identity + version + UV transform: a swapped map with an equal version, or a moved alpha map,
    // must still re-render alpha-tested shadows.
    this.pushTexture(r.map)
    this.pushTexture(r.alphaMap)
    for (const p of m.clippingPlanes ?? []) {
      this.push(p.normal.x), this.push(p.normal.y), this.push(p.normal.z), this.push(p.constant)
    }
  }

  /** Call once per drawn frame, before rendering. Returns true when the shadow maps will re-render. */
  sync(scene: Object3D): boolean {
    this.n = 0
    const lights: ShadowLight[] = []
    scene.traverseVisible((o) => {
      const light = o as ShadowLight
      if (light.isLight && light.castShadow && light.shadow) {
        lights.push(light)
        this.pushMatrix(light.matrixWorld.elements)
        const t = light.target?.matrixWorld.elements
        if (t) this.push(t[12]!), this.push(t[13]!), this.push(t[14]!)
        this.pushMatrix(light.shadow.camera.projectionMatrix.elements)
        this.push(light.shadow.mapSize.x)
        this.push(light.shadow.mapSize.y)
        this.push(light.shadow.intensity === 0 ? 0 : 1)
        return
      }
      const group = o as ClipGroup
      if (group.isClippingGroup) {
        this.push(group.id)
        this.push(group.enabled === false ? 0 : 1)
        for (const p of group.clippingPlanes ?? []) {
          this.push(p.normal.x), this.push(p.normal.y), this.push(p.normal.z), this.push(p.constant)
        }
      }
      const mesh = o as AnyMesh
      if (!mesh.isMesh || !mesh.castShadow) return
      const g = mesh.geometry
      if (mesh.isSkinnedMesh || g.morphAttributes.position) return this.push(Number.NaN)
      this.push(mesh.id)
      this.push(g.id)
      this.push(idOf(g.attributes.position))
      this.push(attrVersion(g.attributes.position))
      this.push(idOf(g.index))
      this.push(attrVersion(g.index))
      this.push(g.drawRange.start)
      this.push(g.drawRange.count)
      this.push(mesh.layers.mask)
      this.pushMatrix(mesh.matrixWorld.elements)
      if (Array.isArray(mesh.material)) for (const m of mesh.material) this.pushMaterial(m)
      else this.pushMaterial(mesh.material)
      if (mesh.isInstancedMesh) this.push(mesh.instanceMatrix?.version ?? -1), this.push(mesh.count ?? -1)
      if (mesh.isBatchedMesh) {
        this.push(mesh._matricesTexture?.version ?? -1)
        this.push(mesh._multiDrawCount ?? -1)
        this.push(mesh._visibilityChanged ? 1 : 0)
      }
    })

    let changed = this.n !== this.prev.length
    if (!changed) {
      for (let i = 0; i < this.n; i++) {
        // `!==` on purpose: NaN (skinned/morphed casters) never equals itself → always changed.
        if (this.next[i] !== this.prev[i]) {
          changed = true
          break
        }
      }
    }
    if (changed) this.prev = this.next.slice(0, this.n)
    const refresh = ++this.sinceRefresh >= SHADOW_REFRESH_FRAMES
    const update = changed || refresh
    if (update) {
      this.sinceRefresh = 0
      this.updates++
    }
    for (const light of lights) {
      const shadow = light.shadow!
      // Own the flag every frame: lights.tsx (rule r3t-tiers) rewrites `autoUpdate` each frame.
      shadow.autoUpdate = false
      // intensity 0 = tier low hid the shadow (same rule) — no point rendering its map.
      if (shadow.intensity === 0) continue
      if (update || !this.seen.has(light)) shadow.needsUpdate = true
      this.seen.add(light)
    }
    return update
  }
}
