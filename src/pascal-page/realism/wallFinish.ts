/**
 * Tường sơn phẳng tuyệt đối trông như ảnh dựng giả. Vendor `wall-materials.ts` bọc kết quả
 * `resolveMaterialRef` của khe tường bằng `tuneWallPaint` (luật scripts/realism/r10-surfaces.mjs).
 * Sơn trơn (không ảnh) → clone + normal thạch cao trắng (R5 `plaster-white`) rất nhẹ, UV theo mét.
 * Thêm biến thiên độ nhám/màu tần số thấp (`surfaceNoise`, `?disable=surfnoise` tắt).
 * Vật liệu thư viện có ảnh, kính, kim loại, chế độ solid → giữ nguyên. Cờ `materials` tắt → y cũ.
 */
import { type Material, RepeatWrapping, type Texture, TextureLoader, Vector2 } from 'three';
import { useRealism } from './store';
import { applySurfaceNoise } from './surfaceNoise';

/** Ảnh normal thạch cao trắng (R5, Poly Haven CC0), cạnh thật 2,5 m. */
export const PLASTER_NORMAL_URL = '/pascal/material/extra/plaster-white/plaster-white_normal_512.webp';
export const PLASTER_SIZE_M = 2.5;
/** Độ nổi: 0,12 = vệt lăn sơn chỉ thấy khi nắng xiên; > 0,2 thành "vải lấm tấm". */
export const WALL_NORMAL_SCALE = 0.12;

type PaintMaterial = Material & {
  roughness?: number;
  metalness?: number;
  map?: Texture | null;
  normalMap?: Texture | null;
  normalScale?: Vector2;
};

const cache = new Map<string, PaintMaterial>();
let normal: Texture | null = null;
let loaded = false;

function plasterNormal(): Texture {
  if (normal) return normal;
  normal = new TextureLoader().load(PLASTER_NORMAL_URL, () => {
    loaded = true;
    // Clone tạo trước khi ảnh về: gán map rồi biên dịch lại (gán sớm → WebGPU giữ ảnh rỗng).
    for (const m of cache.values()) {
      m.normalMap = normal;
      m.needsUpdate = true;
    }
  });
  normal.wrapS = RepeatWrapping;
  normal.wrapT = RepeatWrapping;
  normal.repeat.set(1 / PLASTER_SIZE_M, 1 / PLASTER_SIZE_M);
  return normal;
}

/** Sơn trơn: PBR, chưa có ảnh, đục, không kim loại. */
export function isFlatPaint(mat: Material): boolean {
  const m = mat as PaintMaterial;
  return (
    typeof m.roughness === 'number' &&
    !m.map &&
    !m.normalMap &&
    !m.transparent &&
    (m.metalness ?? 0) <= 0.05 &&
    m.roughness >= 0.5
  );
}

export function tuneWallPaint<T extends Material | null | undefined>(mat: T): T {
  if (!mat || !useRealism.getState().flags.materials || !isFlatPaint(mat)) return mat;
  const hit = cache.get(mat.uuid);
  if (hit) return hit as unknown as T;
  const next = mat.clone() as PaintMaterial;
  next.name = `${mat.name}|plaster`;
  const tex = plasterNormal();
  if (loaded) next.normalMap = tex;
  next.normalScale = new Vector2(WALL_NORMAL_SCALE, WALL_NORMAL_SCALE);
  applySurfaceNoise(next, { albedo: true });
  cache.set(mat.uuid, next);
  return next as unknown as T;
}
