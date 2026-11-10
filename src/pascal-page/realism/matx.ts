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

function parseList<N extends string>(search: string, key: string, names: readonly N[]): ReadonlySet<N> {
  const raw = new URLSearchParams(search).get(key) ?? '';
  const list = raw === 'all' ? [...names] : raw.split(',');
  return new Set(list.filter((n): n is N => (names as readonly string[]).includes(n)));
}

export const parseMatx = (search: string): ReadonlySet<MatxName> => parseList(search, 'matx', MATX_NAMES);

const search = typeof location === 'undefined' ? '' : location.search;
const active = parseMatx(search);
export const matxOn = (name: MatxName): boolean => active.has(name);

/**
 * M5-LC: cờ `?mat=cap-top,floor-rough` (hoặc `all`), độc lập với `?matx=`. Vòng 5 (chấm mù 5/0/7, không thua): KHÔNG cờ
 * = bật cả hai. Rollback `?mat=none` (= baseline cũ); tắt từng cái `?disable=captop` / `?disable=floorrough`.
 * Có `?mat=` thì chỉ bật đúng tên liệt kê.
 * - cap-top    : đồ dạng tủ có vật liệu HAI MẶT (GLB thư viện/Sketchfab xuất doubleSided) bị mặt cắt 1,0 m của
 *                "Tường: cắt" cắt ngang cũng được tô nắp phẳng như tường (trước đây bỏ qua → lòng tủ đen tuyền).
 * - floor-rough: mặt SÀN (vai `floor`) nhám trong dải theo loại `FLOOR_ROUGH_BAND` — bớt vệt cháy gần đèn mà đá bóng
 *                vẫn bóng; mặt bàn/tường cùng mã giữ vật liệu catalogue.
 */
export const MAT_NAMES = ['cap-top', 'floor-rough'] as const;
export type MatName = (typeof MAT_NAMES)[number];
const MAT_DISABLE: Record<MatName, string> = { 'cap-top': 'captop', 'floor-rough': 'floorrough' };
export function parseMat(search: string): ReadonlySet<MatName> {
  const q = new URLSearchParams(search);
  const on = q.has('mat') ? parseList(search, 'mat', MAT_NAMES) : new Set(MAT_NAMES);
  const off = (q.get('disable') ?? '').split(',');
  return new Set([...on].filter((n) => !off.includes(MAT_DISABLE[n])));
}
const activeMat = parseMat(search);
export const matOn = (name: MatName): boolean => activeMat.has(name);

/**
 * `?mat=floor-rough` (vòng 6): dải nhám [min, max] theo LOẠI sàn, chỉ áp cho vai `floor` (mặt trên tấm sàn), không áp
 * cho mặt bàn/tường/đồ dùng cùng mã. Vòng 5 ép mọi sàn ≥ 0,45 → đá bóng mất bóng. Loại ngoài bảng (bê tông, gạch thô,
 * đá nhám, …) = giữ nguyên vật liệu catalogue. Căn cứ số (đỉnh phản xạ dưới đèn phòng): `F:/runs/m6/l2/BAO-CAO.md`.
 */
export type FloorBandKind = 'wood' | 'tile' | 'stone' | 'carpet';
export const FLOOR_ROUGH_BAND: Readonly<Record<FloorBandKind, readonly [number, number]>> = {
  stone: [0.2, 0.3], // đá đánh bóng: còn ảnh phản chiếu mờ
  tile: [0.3, 0.4], // gạch men: bóng nhẹ
  wood: [0.45, 0.6], // gỗ phủ dầu/sơn mờ
  carpet: [0.85, 1], // thảm: không bóng
};
/**
 * `?mat=cap-top`: chỉ thư mục mẫu dạng tủ KÍN (mẫu Pascal + thư viện máy chủ `/items/<id>/`). Đồ mở (kệ sách, kệ, kệ
 * tivi, console) làm bằng tấm một lớp: mặt sau là mặt thật, bật DoubleSide sẽ tô màu nắp lên chỗ không bị cắt.
 */
export const CAP_TOP_FOLDER = /wardrobe|closet|dresser|sideboard|commode|fridge|cabinet|chest/;

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
