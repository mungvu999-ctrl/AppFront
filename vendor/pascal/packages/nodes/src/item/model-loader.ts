import { DefaultLoadingManager, Group, LoadingManager, type Material, type Mesh, Texture } from 'three'
import { type GLTF, GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js'

const ITEM_ASSET_UNAVAILABLE_KEY = 'pascalItemAssetUnavailable'
const DEFAULT_RETRY_DELAYS_MS = [1_000, 3_000] as const
const itemLoadGenerations = new Map<string, number>()

type HttpErrorLike = Error & {
  response?: { status?: number }
}

export type ItemAssetUnavailable = {
  message: string
  url: string
}

export type ItemModelLoadFailureKind = 'retryable' | 'unavailable' | 'unexpected'

export function classifyItemModelLoadFailure(error: unknown): ItemModelLoadFailureKind {
  if (!(error instanceof Error)) return 'unexpected'

  const status = (error as HttpErrorLike).response?.status
  if (
    status === 408 ||
    status === 425 ||
    status === 429 ||
    (status !== undefined && status >= 500)
  ) {
    return 'retryable'
  }
  if (status !== undefined && status >= 400 && status < 500) return 'unavailable'
  if (error instanceof TypeError && /failed to fetch/i.test(error.message)) return 'retryable'

  return 'unexpected'
}

export function createUnavailableItemGltf(url: string, error: unknown): GLTF {
  const unavailable: ItemAssetUnavailable = {
    message: error instanceof Error ? error.message : String(error),
    url,
  }
  const scene = new Group()
  scene.userData[ITEM_ASSET_UNAVAILABLE_KEY] = unavailable

  return {
    animations: [],
    asset: { version: '2.0' },
    cameras: [],
    parser: null as never,
    scene,
    scenes: [scene],
    userData: { [ITEM_ASSET_UNAVAILABLE_KEY]: unavailable },
  }
}

export function getUnavailableItemAsset(gltf: GLTF): ItemAssetUnavailable | null {
  const value = gltf.userData?.[ITEM_ASSET_UNAVAILABLE_KEY]
  if (!value || typeof value !== 'object') return null
  const candidate = value as Partial<ItemAssetUnavailable>
  return typeof candidate.url === 'string' && typeof candidate.message === 'string'
    ? { url: candidate.url, message: candidate.message }
    : null
}

/**
 * Bản đồ phụ (pháp tuyến / nhám / kim loại / AO) của mẫu GLB thu về tối đa 512 px lúc tải; `map` (màu) giữ nguyên.
 * ch-04 (09/11): 33 texture 1024² RGBA chưa nén ≈ 185 MB GPU, đa số là bản đồ phụ — chi tiết của chúng không
 * thấy ở khoảng cách xem mặt bằng, mipmap vẫn sinh như cũ (minFilter của GLTFLoader).
 */
export const ITEM_AUX_TEXTURE_MAX = 512
const ITEM_AUX_SLOTS = ['normalMap', 'roughnessMap', 'metalnessMap', 'aoMap'] as const
/** `?disable=auxcap`: giữ cỡ gốc (bộ đo so trước/sau). */
const AUX_CAP_OFF =
  typeof window !== 'undefined' &&
  (new URLSearchParams(window.location.search).get('disable') ?? '').split(',').includes('auxcap')

export function auxTextureTargetSize(width: number, height: number, max = ITEM_AUX_TEXTURE_MAX) {
  const side = Math.max(width, height)
  if (!side || side <= max) return null
  const k = max / side
  return { width: Math.max(1, Math.round(width * k)), height: Math.max(1, Math.round(height * k)) }
}

type AuxImage = { width: number; height: number; close?: () => void }
export type AuxResize = (image: AuxImage, size: { width: number; height: number }) => Promise<AuxImage>

const resizeWithImageBitmap: AuxResize = (image, size) =>
  createImageBitmap(image as unknown as ImageBitmapSource, {
    resizeWidth: size.width,
    resizeHeight: size.height,
    resizeQuality: 'high',
    premultiplyAlpha: 'none',
    colorSpaceConversion: 'none',
  })

/**
 * Thu nhỏ theo `Source` (three `Texture.clone()` và GLTFLoader dùng chung Source giữa các texture): mỗi Source
 * thu nhỏ một lần, mọi texture trỏ tới nó cùng nhận ảnh mới. Source mà bất kỳ khe KHÔNG phụ nào (map, emissiveMap,
 * …) cũng dùng thì giữ nguyên cỡ. Ảnh gốc chỉ đóng khi mọi người dùng đã chuyển sang ảnh nhỏ.
 */
export async function capItemAuxTextures(gltf: GLTF, resize: AuxResize = resizeWithImageBitmap): Promise<void> {
  if (!gltf.scene || AUX_CAP_OFF) return
  if (resize === resizeWithImageBitmap && typeof createImageBitmap === 'undefined') return
  const users = new Map<Texture['source'], Set<Texture>>()
  const keep = new Set<Texture['source']>()
  const aux = new Set<string>(ITEM_AUX_SLOTS)
  gltf.scene.traverse((object) => {
    const material = (object as Mesh).material as Material | Material[] | undefined
    if (!material) return
    for (const m of Array.isArray(material) ? material : [material]) {
      const slots = m as unknown as Record<string, unknown>
      for (const key in slots) {
        const texture = slots[key]
        if (!(texture instanceof Texture)) continue
        if (!aux.has(key)) keep.add(texture.source)
        let set = users.get(texture.source)
        if (!set) users.set(texture.source, (set = new Set()))
        set.add(texture)
      }
    }
  })
  const jobs: Promise<void>[] = []
  for (const [source, textures] of users) {
    if (keep.has(source)) continue
    const sample = textures.values().next().value as Texture & { isDataTexture?: boolean; isCompressedTexture?: boolean }
    if (sample.isDataTexture || sample.isCompressedTexture) continue
    const image = source.data as AuxImage | null
    if (!image || typeof image.width !== 'number' || typeof image.height !== 'number') continue
    const size = auxTextureTargetSize(image.width, image.height)
    if (!size) continue
    jobs.push(
      resize(image, size).then((small) => {
        source.data = small
        for (const texture of textures) texture.needsUpdate = true
        image.close?.()
      }),
    )
  }
  await Promise.allSettled(jobs)
}

export function cancelItemModelLoad(url: string) {
  itemLoadGenerations.set(url, (itemLoadGenerations.get(url) ?? 0) + 1)
}

export class ItemGLTFLoader extends GLTFLoader {
  readonly hostManager: LoadingManager
  readonly retryDelaysMs: readonly number[]

  constructor(manager?: LoadingManager, retryDelaysMs = DEFAULT_RETRY_DELAYS_MS) {
    super(new LoadingManager())
    this.hostManager = manager ?? DefaultLoadingManager
    this.retryDelaysMs = retryDelaysMs
  }

  override load(
    url: string,
    onLoad: (gltf: GLTF) => void,
    onProgress?: (event: ProgressEvent) => void,
    onError?: (error: unknown) => void,
  ): void {
    const generation = itemLoadGenerations.get(url) ?? 0
    let retryCount = 0
    let finished = false

    const wasCancelled = () => (itemLoadGenerations.get(url) ?? 0) !== generation

    const cancel = () => {
      if (finished) return
      finished = true
      this.hostManager.itemEnd(url)
    }

    const complete = (gltf: GLTF) => {
      if (finished) return
      if (wasCancelled()) {
        cancel()
        return
      }
      finished = true
      try {
        onLoad(gltf)
      } finally {
        this.hostManager.itemEnd(url)
      }
    }

    const fail = (error: unknown) => {
      if (finished) return
      if (wasCancelled()) {
        cancel()
        return
      }
      finished = true
      try {
        if (onError) onError(error)
        else console.error(error)
      } finally {
        this.hostManager.itemError(url)
        this.hostManager.itemEnd(url)
      }
    }

    const attempt = () => {
      if (wasCancelled()) {
        cancel()
        return
      }
      super.load(url, (gltf) => void capItemAuxTextures(gltf).finally(() => complete(gltf)), onProgress, (error) => {
        if (wasCancelled()) {
          cancel()
          return
        }
        const kind = classifyItemModelLoadFailure(error)
        if (kind === 'unexpected') {
          fail(error)
          return
        }
        if (kind === 'unavailable' || retryCount >= this.retryDelaysMs.length) {
          complete(createUnavailableItemGltf(url, error))
          return
        }

        const delay = this.retryDelaysMs[retryCount] ?? 0
        retryCount += 1
        setTimeout(attempt, delay)
      })
    }

    this.hostManager.itemStart(url)
    attempt()
  }
}
