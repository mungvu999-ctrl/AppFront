/**
 * Xem thử ánh sáng nướng (nhóm C, thử nghiệm): `editor3d.html?baked=</thư mục cùng origin>` nạp `<thư mục>/baked.glb`,
 * `manifest.json`, `lightmap.png` do `F:/runs/login-tour/bake/bake_glb.py` (Blender Cycles) xuất, ẩn cảnh sống
 * và vẽ tường/sàn chỉ bằng lightmap (vật liệu không qua đèn). Đồ đạc trong GLB vẫn nhận đèn thời gian thực.
 * Gọi mỗi khung từ hệ tường vendor (luật `scripts/realism/r11-baked.mjs`).
 * Cùng xem thử bật được từ API (C3): `showBakedPreview` nhận URL `blob:` của ba tệp N44 (`../useLightingBake`).
 */
import { BackSide, FileLoader, type Material, Mesh, MeshBasicMaterial, type MeshStandardMaterial, type Object3D, SRGBColorSpace, type Texture, TextureLoader } from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';

import { CUT_FACE_COLOR } from './cut';

export interface BakedManifest {
  lightmap: string;
  /** π / hệ số nén lúc ghi PNG (`bake_glb.py`). */
  intensity: number;
  /** Bộ UV của lightmap (TEXCOORD_1 → `uv1`). */
  channel: number;
}

export interface BakedRegistry {
  nodes: { get(id: string): Object3D | undefined };
  byType: Readonly<Record<string, Set<string>>>;
}

const PARAM = 'baked';
const NO_IDS: ReadonlySet<string> = new Set();

/**
 * Thư mục nướng từ URL. Chỉ nhận đường cùng origin (`/…`, không `//`, không `..`): gói Pascal dựng ở chế độ
 * production nên không dựa được vào `import.meta.env.DEV`; chặn URL lạ thay vì chặn theo bản dựng.
 * Đường URL là công cụ dev (so ảnh Cycles): chỉ nhận khi có `?probe=1` (cùng cổng với đầu dò e2e), để bản production
 * không có lối tắt tới cảnh nướng ngoài thẻ "Nướng ánh sáng" (N44).
 */
export function bakedDirFrom(search: string): string | null {
  const params = new URLSearchParams(search);
  if (params.get('probe') !== '1') return null;
  const dir = params.get(PARAM);
  if (!dir?.startsWith('/') || dir.startsWith('//') || dir.includes('..')) return null;
  return dir.replace(/\/+$/, '');
}

/** Vật liệu không qua đèn: màu × ảnh × lightmap (Blender đã tính nắng + ánh dội). */
export function bakedMaterial(source: Material, lightMap: Texture, manifest: BakedManifest): MeshBasicMaterial {
  const std = source as MeshStandardMaterial;
  return new MeshBasicMaterial({
    name: `${source.name}|baked`,
    color: std.color?.clone(),
    map: std.map ?? null,
    lightMap,
    lightMapIntensity: manifest.intensity,
    side: source.side,
    transparent: source.transparent,
    opacity: source.opacity,
  });
}

/** Nắp cắt: mặt sau của tường đã cắt (khối kín) tô gần đen, như chế độ cắt sống và ảnh Blender. */
const capMaterial = new MeshBasicMaterial({ color: CUT_FACE_COLOR, side: BackSide });

/** Nguồn của một lượt xem thử: hai URL (thư mục tĩnh hoặc `blob:` từ N44) và manifest đã đọc. */
export interface BakedSource {
  glbUrl: string;
  lightmapUrl: string;
  manifest: BakedManifest;
}

let started = false;
let root: Object3D | null = null;
/** Lượt nạp mới nhất; lượt cũ về muộn bị bỏ (đổi lượt nướng giữa chừng, hay ẩn trước khi nạp xong). */
let generation = 0;
const hiddenLevels = new Set<Object3D>();

async function load({ glbUrl, lightmapUrl, manifest }: BakedSource): Promise<Object3D> {
  const [gltf, lightMap] = await Promise.all([
    new GLTFLoader().loadAsync(glbUrl),
    new TextureLoader().loadAsync(lightmapUrl),
  ]);
  lightMap.colorSpace = SRGBColorSpace;
  lightMap.flipY = false;
  lightMap.channel = manifest.channel;
  const caps: Mesh[] = [];
  gltf.scene.traverse((child) => {
    const mesh = child as Mesh;
    if (!mesh.isMesh || !mesh.userData['lightmap']) return;
    mesh.material = Array.isArray(mesh.material)
      ? mesh.material.map((m) => bakedMaterial(m, lightMap, manifest))
      : bakedMaterial(mesh.material, lightMap, manifest);
    caps.push(mesh);
  });
  for (const mesh of caps) mesh.add(new Mesh(mesh.geometry, capMaterial));
  gltf.scene.name = 'baked-preview';
  return gltf.scene;
}

/** `?baked=<thư mục>`: tệp tĩnh cạnh GLB, nạp bằng loader của three (không phải gọi API). */
async function sourceFromDir(dir: string): Promise<BakedSource> {
  const manifest = JSON.parse(String(await new FileLoader().loadAsync(`${dir}/manifest.json`))) as BakedManifest;
  return { glbUrl: `${dir}/baked.glb`, lightmapUrl: `${dir}/${manifest.lightmap}`, manifest };
}

/**
 * Bật xem thử từ một nguồn (thay lượt đang hiện). Xong khi cảnh nướng đã nạp — nơi gọi có thể thu hồi
 * URL `blob:` sau đó. Cảnh được gắn vào ở khung kế tiếp của `syncBakedPreview`.
 */
export async function showBakedPreview(source: BakedSource): Promise<void> {
  const mine = ++generation;
  const loaded = await load(source);
  if (mine !== generation) return;
  root?.removeFromParent();
  root = loaded;
}

/** Tắt xem thử: gỡ cảnh nướng, hiện lại cảnh sống. */
export function hideBakedPreview(): void {
  generation += 1;
  root?.removeFromParent();
  root = null;
  for (const level of hiddenLevels) level.visible = true;
  hiddenLevels.clear();
}

export function syncBakedPreview(scene: Object3D, registry: BakedRegistry): void {
  if (!started) {
    started = true;
    const dir = bakedDirFrom(globalThis.location?.search ?? '');
    if (dir) {
      sourceFromDir(dir)
        .then(showBakedPreview)
        .catch((error: unknown) => console.warn('[baked] không nạp được', dir, error));
    }
  }
  if (!root) return;
  if (root.parent !== scene) scene.add(root);
  // Cảnh sống bị vendor bật lại khi đổi tầng/chế độ → ẩn mỗi khung.
  for (const id of registry.byType['level'] ?? NO_IDS) {
    const level = registry.nodes.get(id);
    if (!level) continue;
    level.visible = false;
    hiddenLevels.add(level);
  }
}
