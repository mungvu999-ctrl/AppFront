/**
 * Vòng 11 b3 — luật nhận diện bề mặt vải (hàm thuần, không three, không import → script đếm chạy thẳng bằng node).
 * Hai bước, theo dữ liệu chung (không tên asset riêng):
 *  1. Vai món (`fabricRoleOf`): token vai trong id món sinh (`item_DRESS-<vai>-…`), rồi vai catalog của mẫu (người gọi
 *     tra `libraryRoles.json` / `VARIANT_MODEL` / nhóm thư viện qua `roleOfKey`). Chỉ giường, sofa, rèm, gối, chăn.
 *  2. Bề mặt (`fabricSurfaceOf`) trên món có vai vải: tên vật liệu/khe GLB có từ vải → vải; có từ phi vải (gỗ, kim loại,
 *     chân, khung, kính, da…) → không; loại vải đã gắn (`itemLook`) → vải; còn lại vật liệu TRƠN (không ảnh màu), phi kim,
 *     nhám ≥ 0,7 → vải. Có ảnh màu và mesh có UV → giữ ảnh của tác giả (không đổi).
 */
export type FabricRole = 'bed' | 'sofa' | 'curtain' | 'pillow' | 'throw';

/** Token vai (id món sinh, vai catalog, variant) → vai vải. Ghế bành/ghế ăn không: nhiều mẫu gỗ/da/nhựa trơn. */
export const ROLE_TOKEN: Readonly<Record<string, FabricRole>> = {
  bed: 'bed',
  doubleBed: 'bed',
  singleBed: 'bed',
  sofa: 'sofa',
  curtain: 'curtain',
  pillow: 'pillow',
  throw: 'throw',
};

/** `/items/<k>/model.glb`, `/appfront-items/<k>/…`, `…/library/<k>/model.glb?sig` → `<k>` (bỏ đuôi `-uv`). */
export function modelKeyOf(src: string | null | undefined): string | null {
  const m = src ? /\/(?:appfront-items|items|library)\/([^/?#]+)\//.exec(src) : null;
  return m ? m[1]!.replace(/-uv$/, '') : null;
}

export function fabricRoleOf(id: string | null | undefined, src: string | null | undefined, roleOfKey: (key: string) => string | undefined): FabricRole | null {
  const token = id ? /(?:^|_)DRESS-([A-Za-z]+)-/.exec(id)?.[1] : undefined;
  if (token) return ROLE_TOKEN[token] ?? null;
  const key = modelKeyOf(src);
  const role = key ? roleOfKey(key) : undefined;
  return role ? (ROLE_TOKEN[role] ?? null) : null;
}

export const FABRIC_NAME = /fabric|cloth|textile|linen|cotton|wool|velvet|boucle|suede|sheet|duvet|quilt|blanket|bedding|pillow|cushion|mattress|upholst|curtain|drape|throw|seat|towel/;
/** Từ ngắn (chân, thanh) chỉ khớp nguyên từ: `leg` không khớp `elegant`, `rod` không khớp `product`. */
export const NOT_FABRIC =
  /wood|oak|walnut|pine|teak|metal|steel|chrome|brass|iron|alumin|gold|silver|copper|inox|frame|handle|glass|mirror|plastic|leather|marble|stone|lamp|bulb|emiss|screw|edge|button|outline|(?:^|[^a-z])(?:legs?|feet|foot|rod|rail|hook)(?:[^a-z]|$)/;
/**
 * Ngưỡng vật liệu trơn coi là vải trên món có vai vải. Lát 2: CHĂN của giường thư viện (mesh `Box001`, 4550 đỉnh) dùng
 * vật liệu `Box002__0` nhám 0,6 (mặc định xuất FBX/3ds Max) → ngưỡng 0,7 bỏ sót đúng mặt chính. Dải 0,5–0,7 chỉ nhận màu
 * SÁNG (độ sáng tuyến tính ≥ `PLAIN_LIGHT_MIN`): vật liệu tối nhám vừa thường là khung/chân/viền.
 */
export const PLAIN_MIN_ROUGHNESS = 0.7;
export const PLAIN_LIGHT_MIN_ROUGHNESS = 0.5;
export const PLAIN_LIGHT_MIN = 0.5;
export const PLAIN_MAX_METALNESS = 0.1;

export interface SurfaceFacts {
  /** Tên vật liệu GLB gốc, id khe, tên vật liệu hiện hành. */
  names: readonly (string | null | undefined)[];
  hasMap: boolean;
  hasUv: boolean;
  metalness: number;
  roughness: number;
  transparent: boolean;
  /** Độ sáng tuyến tính màu vật liệu (0..1); thiếu = 1 (glTF mặc định trắng). */
  luminance?: number;
  /** Loại `itemLook` đã gắn (`userData.upholstery.kind`). */
  tagKind?: string | null;
}

export type FabricMatch = 'named' | 'tagged' | 'plain';

export function fabricSurfaceOf(f: SurfaceFacts): FabricMatch | null {
  if (f.transparent || f.tagKind === 'leather') return null;
  const n = f.names.filter(Boolean).join(' ').toLowerCase();
  if (NOT_FABRIC.test(n)) return null;
  // Ảnh màu chỉ vô dụng khi mesh không có UV (rèm/gối/chăn Pascal: mọi điểm lấy cùng một texel).
  if (f.hasMap && f.hasUv) return null;
  if (FABRIC_NAME.test(n)) return 'named';
  if (f.tagKind === 'fabric' || f.tagKind === 'bedding') return 'tagged';
  if (f.hasMap || f.metalness > PLAIN_MAX_METALNESS) return null;
  if (f.roughness >= PLAIN_MIN_ROUGHNESS) return 'plain';
  if (f.roughness >= PLAIN_LIGHT_MIN_ROUGHNESS && (f.luminance ?? 1) >= PLAIN_LIGHT_MIN) return 'plain';
  return null;
}
