/**
 * M5-L3b: thử nghiệm vật liệu, bật bằng `?matx=glass,fabric,floor,paint` (hoặc `all`). Không có cờ = y hiện tại.
 * Chỉ dữ liệu + hàm thuần (vitest kiểm được); chỗ áp ở `glass.ts`, `itemMaterials.ts`, `floorFinish.ts`, `wallFinish.ts`.
 * - glass : kính mỏng `sheet` (fresnel, phản xạ cộng đủ) + env RIÊNG có hình (HDRI sân đô thị, `matGlass.ts`) + tint xanh nhẹ.
 * - fabric: vải/chăn/rèm — sheen màu theo vải (không trắng), nhám 1, specular thấp (hết viền bóng nhựa ở nếp rèm).
 * - floor : gạch/đá bóng men (nhám thấp, phản chiếu phòng), gỗ phủ lacquer (nhám × 0,55, giữ vân nhám của ảnh).
 * - paint : sơn tường nhám hơn (0,95) + vệt lăn rõ hơn (normal 0,2).
 */
export const MATX_NAMES = ['glass', 'fabric', 'floor', 'paint'] as const;
export type MatxName = (typeof MATX_NAMES)[number];

export function parseMatx(search: string): ReadonlySet<MatxName> {
  const raw = new URLSearchParams(search).get('matx') ?? '';
  const list = raw === 'all' ? [...MATX_NAMES] : raw.split(',');
  return new Set(list.filter((n): n is MatxName => (MATX_NAMES as readonly string[]).includes(n)));
}

const active = typeof location === 'undefined' ? new Set<MatxName>() : parseMatx(location.search);
export const matxOn = (name: MatxName): boolean => active.has(name);

/** Kính: độ truyền theo kênh (r, g, b) nhân vào phản xạ — kính float ~ xanh lục nhạt. */
export const GLASS_TINT = [0.86, 0.95, 0.93] as const;
/** Cường độ env riêng của kính (env đã chuẩn hoá như HDRI cảnh). */
export const GLASS_ENV_INTENSITY = 1.2;

/** Vải: sheen = màu vải pha trắng theo tỉ lệ này (0 = đúng màu vải, 1 = trắng như hiện tại). */
export const FABRIC_SHEEN_WHITE = 0.35;
export const FABRIC = { roughness: 1, sheen: 0.8, sheenRoughness: 0.75, specularIntensity: 0.25 } as const;

/** Màu sheen (tuyến tính) từ màu vải: pha trắng `FABRIC_SHEEN_WHITE`. */
export function fabricSheenColor(rgb: readonly [number, number, number]): [number, number, number] {
  return rgb.map((c) => c + (1 - c) * FABRIC_SHEEN_WHITE) as [number, number, number];
}

export type FloorKind = 'wood' | 'tile' | 'stone' | 'concrete';
/** Sàn: gạch/đá đặt nhám cố định (bỏ ảnh nhám), gỗ nhân hệ số (giữ ảnh). Biên độ nhiễu nhám riêng (nhỏ hơn 0,2 chung). */
export const FLOOR_GLOSS: Readonly<Record<FloorKind, { roughness?: number; scale?: number; noise: number } | null>> = {
  tile: { roughness: 0.14, noise: 0.04 },
  stone: { roughness: 0.1, noise: 0.03 },
  wood: { scale: 0.55, noise: 0.08 },
  concrete: null,
};

export const PAINT = { roughness: 0.95, normalScale: 0.2 } as const;
