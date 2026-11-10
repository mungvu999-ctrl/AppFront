/**
 * Bước 2 (thẻ M1): bảng loại vật liệu cho đồ nội thất Pascal.
 * Chỉ dữ liệu + hàm thuần (không three) để vitest kiểm được.
 */

import { REALISM_PALETTE } from '@/lib/pascal/scenePalette';

export type MaterialKind =
  | 'fabric'
  | 'bedding'
  | 'leather'
  | 'wood'
  | 'metal'
  | 'ceramic'
  | 'leaf'
  | 'bark'
  | 'plastic'
  | 'matte'
  | 'mirror'
  | 'screen'
  | 'steel'
  | 'porcelain';

/**
 * Luật chung cho MỌI vật liệu mẫu (cả mẫu lạ/người dùng tải lên); ITEM_KIND chỉ là ngoại lệ.
 * Phòng trong nhà phản chiếu tối → kim loại 100 % ra đen: kẹp hệ số kim loại
 * (có metalnessMap: three nhân hệ số với kênh ảnh → phần gỗ/vải kênh 0 không đổi).
 */
export const AUTO = {
  metalMax: 0.6,
  metalMaxMapped: 0.5,
  /** Kim loại bóng gương (r≈0) phản chiếu phòng tối → kẹp nhám. */
  metalRoughMin: 0.25,
  roughMin: 0.12,
  anisotropy: 8,
} as const;

export interface MatFacts {
  metalness: number;
  roughness: number;
  metalnessMap: boolean;
  roughnessMap: boolean;
  transparent: boolean;
  /** Tên vật liệu GLB — luật phi kim theo tên (`dielectricName`); thiếu = bỏ qua luật đó. */
  name?: string;
}

/**
 * M7 làn B: vật liệu tên rõ là phi kim (vải/gỗ/da/đá/lá…) mà GLB vẫn đặt kim loại > 0 — vd `Lenestol_fabric`
 * metallicFactor 0,68 không ảnh, `Wood_12` ảnh metallicRoughness kênh B ≈ 1 khắp ảnh. Kim loại pha nhân phần khuếch tán
 * với (1 − m) và đổi sang phản xạ màu; env trong nhà yếu nên vải/gỗ tối bệt. Tên có cả từ kim loại → không đoán.
 * Tắt: `?disable=dielectric`.
 */
export function dielectricName(name: string): boolean {
  const n = name.toLowerCase();
  if (/metal|brass|steel|chrome|copper|alumin|iron|gold|silver|inox|bronze|nickel|zinc|titan|pewter|stainless|handle/.test(n)) return false;
  const k = refKind(n);
  return k != null && k !== 'metal';
}

export const flagOff = (search: string, name: string): boolean =>
  (new URLSearchParams(search).get('disable') ?? '').split(',').includes(name);
const DIELECTRIC_ON = !flagOff(typeof location === 'undefined' ? '' : location.search, 'dielectric');

export interface MatPatch {
  metalness?: number;
  roughness?: number;
}

/** Thuộc tính vật liệu → phần cần đổi (rỗng = giữ nguyên). Kính trong suốt: chỉ kẹp kim loại. */
export function autoPatch(f: MatFacts, dielectric = DIELECTRIC_ON): MatPatch {
  const p: MatPatch = {};
  const cap = dielectric && f.name && dielectricName(f.name) ? 0 : f.metalnessMap ? AUTO.metalMaxMapped : AUTO.metalMax;
  if (f.metalness > cap) p.metalness = cap;
  if (!f.roughnessMap && !f.transparent) {
    const min = (p.metalness ?? f.metalness) >= 0.5 ? AUTO.metalRoughMin : AUTO.roughMin;
    if (f.roughness < min) p.roughness = min;
  }
  return p;
}

/**
 * Loại đoán theo tên vật liệu GLB (mẫu không có trong ITEM_KIND). Gương luôn nhận;
 * đã có ảnh màu = PBR tác giả làm sẵn → không đoán. Kim loại để `autoPatch` lo (giữ màu).
 */
export function nameKind(name: string, hasMap: boolean): MaterialKind | null {
  const n = name.toLowerCase();
  if (/mirror|specchio|spiegel/.test(n)) return 'mirror';
  if (hasMap || /glass|vetr|crystal/.test(n)) return null;
  const k = refKind(n);
  return k === 'metal' ? null : k;
}

/**
 * Ghi đè theo thư mục mẫu. Khoá: slotId, hoặc ref vật liệu (`library:…`),
 * hoặc `*` = mẫu không có khe (một vật liệu gốc trong GLB).
 */
export const ITEM_KIND: Record<string, Record<string, MaterialKind>> = {
  // Thân sofa/ghế bành là preset-taupe phẳng = khối nâu trơn → bọc vải.
  sofa: { 'library:preset-taupe': 'fabric' },
  'livingroom-chair': { 'library:preset-taupe': 'fabric' },
  'dining-chair': { 'library:preset-taupe': 'fabric', legs: 'metal' },
  'rectangular-carpet': { 'library:preset-taupe': 'fabric' },
  // Gói 1: thảm bỏ tua (mẫu `rug-nf`, cùng khe với rectangular-carpet).
  'rug-nf': { 'library:preset-taupe': 'fabric' },
  // Ba mẫu không khe, vật liệu gốc trắng r0.364 + specular ("nhựa trắng").
  // Giường: UV nhỏ → normal vải lặp dày thành hạt giấy nhám (review2) → vải trơn, không map.
  'double-bed': { '*': 'bedding' },
  // Gói 4A: tủ lạnh một vật liệu không tay nắm → trắng bóng vẫn là hộp trắng;
  // inox chải phản chiếu HDRI/RoomEnvironment cho thấy khối và đọc ra đồ bếp.
  fridge: { '*': 'steel' },
  'ceiling-lamp': { '*': 'matte' },
  // Gói 4A: đồ còn "nhựa xám mờ" (review2 R-assets). Khe = slotId (tên vật liệu bỏ `slot_`).
  'round-mirror': { glass: 'mirror' },
  television: { screen: 'screen', frame: 'matte' },
  computer: { screen: 'screen' },
  toilet: { toilet: 'porcelain', buttons: 'porcelain' },
  'bathroom-sink': { '*': 'porcelain' },
  bathtub: { tub: 'porcelain', fixtures: 'metal' },
  // Kính vách tắm (`glass`) để nguyên: gói 1 đã sửa preset-glass, không bật transmission.
  'shower-angle': { fixtures: 'metal' },
  'shower-square': { fixtures: 'metal' },
  'toilet-paper': { holder: 'metal' },
  // Tay nắm + chân đen: kim loại, giữ màu khe. Chân gán ref gỗ → refKind thắng (itemKindOf).
  'kitchen-cabinet': { handle: 'metal' },
  'kitchen-shelf': { handle: 'metal' },
  // Gói 4B: mẫu tủ sinh bằng code (swap sau cờ materials) — tra theo thư mục tệp mới.
  'closet-gen': { handle: 'metal' },
  'kitchen-counter-gen': { handle: 'metal' },
  'kitchen-cabinet-gen': { handle: 'metal' },
  'kitchen-sink-gen': { handle: 'metal', steel: 'steel' },
  'kitchen-shelf-gen': { handle: 'metal' },
  // Gói 5 `fridge-sf` (kim loại 100 % + metalnessMap ra đen) → nay luật chung `autoPatch` lo.
  // Gói 6: giường Soho bọc vải (spec/gloss đã đổi sang metal/rough khi chuyển).
  'bed-sf': { '*': 'fabric' },
  'tv-stand-gen': { handle: 'metal' },
  dresser: { handle: 'metal' },
  'office-table': { handle: 'metal' },
  microwave: { handle: 'metal' },
  'bedside-table': { handle: 'metal', legs: 'metal' },
  'dining-table': { legs: 'metal' },
  'coffee-table': { legs: 'metal' },
  'lounge-chair': { legs: 'metal' },
  'floor-lamp': { legs: 'metal' },
  'ironing-board': { legs: 'metal' },
  stove: { legs: 'metal' },
};

/** Đoán loại theo tên ref (`library:fabric-linen`, `scene:mat_appfront_bark`…). */
export function refKind(ref: string | undefined | null): MaterialKind | null {
  if (!ref) return null;
  const r = ref.toLowerCase();
  if (/leather/.test(r)) return 'leather';
  if (/fabric|textile|cloth|linen|wool|velvet|boucle|cotton|suede/.test(r)) return 'fabric';
  if (/bark/.test(r)) return 'bark';
  if (/preset-forest|leaf|foliage/.test(r)) return 'leaf';
  if (/marble|statuar|ceramic|terracotta|porcelain|tile/.test(r)) return 'ceramic';
  if (/wood|oak|walnut|parquet/.test(r)) return 'wood';
  if (/metal|brass|steel|chrome|copper|alumin/.test(r)) return 'metal';
  return null;
}

/** `/items/sofa/model.glb` → `sofa` (cả `/appfront-items/<x>/`). */
export function folderOf(src: string | undefined | null): string | null {
  const m = src ? /\/(?:appfront-)?items\/([^/?#]+)\//.exec(src) : null;
  return m?.[1] ?? null;
}

/** Loại do chính khe quyết định, không để ref thư viện của phong cách đè. */
const SLOT_NATURE: ReadonlySet<MaterialKind> = new Set<MaterialKind>(['mirror', 'screen', 'porcelain', 'steel']);

export function itemKindOf(
  folder: string | null,
  slotId: string | null,
  ref: string | undefined | null,
): MaterialKind | null {
  const table = folder ? ITEM_KIND[folder] : undefined;
  if (table) {
    // Người dùng gán vật liệu thư viện cho khe (gỗ cho chân…) → loại theo ref thắng; trừ loại "bản chất"
    // của khe (gương/màn hình/sứ/inox): phong cách gán ref kim loại cho kính gương → gương ra kim loại nhám đen.
    const own = slotId != null ? table[slotId] : undefined;
    if (own) return SLOT_NATURE.has(own) ? own : (refKind(ref) ?? own);
    if (ref && table[ref]) return table[ref];
    if (slotId == null && table['*']) return table['*'];
  }
  return refKind(ref);
}

export interface KindLook {
  /** roughness cố định; `null` = nhân `roughnessScale` rồi kẹp ≥ `roughnessMin`. */
  roughness: number | null;
  roughnessScale?: number;
  roughnessMin?: number;
  metalness?: number;
  /** Vật liệu thư viện lấy normalMap/roughnessMap khi bản thân không có. */
  donor?: string;
  /** Nhân màu (r, g, b): gỗ bớt cam. */
  tint?: readonly [number, number, number];
  /** Đè màu (hex sRGB) — chỉ cho vật liệu gốc của mẫu (không có ref thư viện). */
  color?: string;
  /** Lớp sheen vải (vật liệu physical, Blender sheen 0.5–0.6): vải hết nhìn như nhựa mờ. */
  sheen?: number;
  sheenRoughness?: number;
}

export const KIND_LOOK: Record<MaterialKind, KindLook> = {
  fabric: { roughness: 0.95, donor: 'library:fabric-cotton', sheen: 0.5, sheenRoughness: 0.5 },
  bedding: { roughness: 0.92, sheen: 0.5, sheenRoughness: 0.5 },
  leather: { roughness: 0.55, donor: 'library:leather-calf' },
  // Gói 1: gỗ đồ (tủ đầu giường, bàn) dưới đèn ấm ra cam rực → kéo về trung tính, tối nhẹ.
  wood: { roughness: null, roughnessScale: 1.6, roughnessMin: 0.45, tint: [0.8, 0.86, 0.95] },
  metal: { roughness: 0.3, metalness: 1 },
  ceramic: { roughness: 0.25 },
  leaf: { roughness: 0.7 },
  bark: { roughness: 0.9 },
  plastic: { roughness: 0.5 },
  matte: { roughness: 0.8 },
  // Gói 4A. Gương: bạc phản chiếu; màn tắt: đen bóng; inox chải; men sứ bóng.
  // metalness 1 ra đen trong phòng (môi trường phản chiếu trong nhà tối, review2 gói 4) → pha nửa khuếch tán.
  mirror: { roughness: 0.08, metalness: 0.5, color: REALISM_PALETTE.mirror },
  screen: { roughness: 0.15, metalness: 0, color: REALISM_PALETTE.screen },
  steel: { roughness: 0.35, metalness: 0.6, color: REALISM_PALETTE.steel },
  porcelain: { roughness: 0.12, metalness: 0, color: REALISM_PALETTE.porcelain },
};

export function tunedRoughness(kind: MaterialKind, current: number): number {
  const look = KIND_LOOK[kind];
  if (look.roughness != null) return look.roughness;
  return Math.min(1, Math.max(look.roughnessMin ?? 0, current * (look.roughnessScale ?? 1)));
}
