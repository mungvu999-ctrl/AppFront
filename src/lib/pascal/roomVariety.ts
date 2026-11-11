/**
 * Biến thể theo phòng + bộ ghế đồng nhất (vòng 11, làn b1) — hàm thuần, `sceneVariety.ts` gọi khi chọn mẫu thư viện.
 *
 * Gốc lỗi: `rankedLibraryPickOf` sắp ứng viên theo (tông, hạng phong cách, họ màu, độ rực, tên) rồi lấy ĐÚNG mẫu đầu
 * (`slice(0, 1)`), băm `fnv1a(id) % 1` luôn ra 0 → mỗi vai một mẫu cho cả căn, mọi căn cùng phong cách (giường
 * `bed-white-oak-headboard` độ rực 3 luôn đứng đầu doubleBed của scandinavian).
 *
 * - `roomvariety`: món trong phạm vi rút mẫu theo id phòng trong các mẫu cùng hạng (cùng tông/phong cách/họ màu như mẫu
 *   đầu), KHÔNG to hơn chỗ đặt; trong một phòng mọi món cùng tông gỗ của căn và chỉ một họ màu không trung tính (họ
 *   của phòng). Ghế cạnh bàn làm việc rút trong mẫu ghế làm việc khi pool có.
 * - `chairset`: mọi ghế quanh một bàn dùng một mẫu (mẫu của ghế cố định phổ biến nhất, không có thì ghế id nhỏ nhất).
 * - `varietyai`: mở phạm vi từ đồ sinh (`DRESS-`) sang cả đồ AI dò chưa xác nhận, chưa gán mẫu (vị trí/cỡ giữ nguyên).
 *
 * Cờ `?enable=` (tắt mặc định); `VARIETY_DEFAULTS` là hằng duy nhất để lật mặc định, `?disable=` tắt lại.
 */

import { isNeutralFamily } from './sceneHarmony';

export type VarietyFlag = 'roomvariety' | 'chairset' | 'varietyai';
const VARIETY_FLAGS: readonly VarietyFlag[] = ['roomvariety', 'chairset', 'varietyai'];

/** HẰNG LẬT MẶC ĐỊNH: thêm 'roomvariety' / 'chairset' (và 'varietyai' nếu được duyệt) sau khi QA ảnh chọn. */
export const VARIETY_DEFAULTS: ReadonlySet<VarietyFlag> = new Set<VarietyFlag>();

const listOf = (search: string, key: string): string[] => (new URLSearchParams(search).get(key) ?? '').split(',');

export const varietyFlagsOf = (search: string, defaults: ReadonlySet<VarietyFlag> = VARIETY_DEFAULTS): ReadonlySet<VarietyFlag> => {
  const on = new Set([...defaults, ...listOf(search, 'enable')]);
  for (const off of listOf(search, 'disable')) on.delete(off as VarietyFlag);
  return new Set(VARIETY_FLAGS.filter((flag) => on.has(flag)));
};
/** Đọc MỘT lần lúc nạp trang (như `?layout=`). */
export const VARIETY_FLAGS_ON: ReadonlySet<VarietyFlag> =
  typeof location === 'undefined' ? VARIETY_DEFAULTS : varietyFlagsOf(location.search);

/** FNV-1a 32 bit. */
export const fnv1a = (text: string): number => {
  let hash = 0x811c9dc5;
  for (let i = 0; i < text.length; i += 1) {
    hash ^= text.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash;
};

/** Số mẫu đầu (độ rực thấp trước) được rút: rộng hơn thì lẫn mẫu sặc sỡ. */
export const VARIETY_TOP = 8;
/** Mẫu "không to hơn chỗ": từng cạnh mặt bằng (đã sắp) ≤ cạnh hộp × chừng này. */
export const FIT_SLACK = 1.1;

/** Mẫu `[rộng, cao, sâu]` (m) có lọt hộp `[ngắn, dài]` (m) không. */
export const fitsSpot = (dims: readonly [number, number, number], short: number, long: number): boolean => {
  const [w, , d] = dims;
  return Math.min(w, d) <= short * FIT_SLACK && Math.max(w, d) <= long * FIT_SLACK;
};

export interface VarietyCandidate {
  readonly folder: string;
  /** Tông gỗ `l`/`d`. */
  readonly t?: string;
  /** Họ màu. */
  readonly h?: string;
}

/** Họ màu không trung tính của một phòng (cả phòng dùng chung, mọi vai): băm id phòng trên danh sách họ đã sắp. */
export const roomFamilyOf = (roomId: string, families: readonly string[]): string | undefined =>
  families.length === 0 ? undefined : families[fnv1a(`family|${roomId}`) % families.length];

/**
 * Mẫu của món theo phòng: `cands` đã xếp hạng + đã lọc cỡ. Lọc tông gỗ của căn, rồi họ màu (trung tính hoặc họ của
 * phòng) — lọc rỗng thì bỏ bước lọc đó; rút trong `VARIETY_TOP` mẫu đầu theo băm `phòng|vai`. Tất định.
 */
export const roomVarietyPickOf = (
  cands: readonly VarietyCandidate[],
  roomId: string,
  role: string,
  tone: string | undefined,
  families: readonly string[],
): string | undefined => {
  const toned = tone === undefined ? cands : cands.filter((c) => c.t === undefined || c.t === tone);
  const byTone = toned.length > 0 ? toned : cands;
  const family = roomFamilyOf(roomId, families);
  const hued = byTone.filter((c) => isNeutralFamily(c.h) || c.h === family);
  const pool = (hued.length > 0 ? hued : byTone).slice(0, VARIETY_TOP);
  return pool[fnv1a(`${roomId}|${role}`) % pool.length]?.folder;
};

/**
 * Mẫu ghế làm việc trong pool ghế: vai `deskChair` của thư viện nếu có (đề nghị làn b2 thêm), không thì mẫu pool ghế ăn
 * có từ loại trong tên (desk/office/task/swivel).
 * ponytail: theo tên thư mục vì libraryRoles chưa có tag công năng; thay bằng vai `deskChair` khi b2 sinh.
 */
const WORK_CHAIR = /(^|-)(desk|office|task|swivel)(-|$)/;
export const workChairsOf = (roles: Readonly<Record<string, readonly string[]>>): readonly string[] =>
  roles.deskChair ?? (roles.diningChair ?? []).filter((folder) => WORK_CHAIR.test(folder));

export interface ChairMember {
  readonly id: string;
  readonly folder: string | null;
  /** Ghế ngoài phạm vi đổi mẫu (người dùng/đồ dò giữ nguyên): mẫu của nó làm chuẩn. */
  readonly fixed: boolean;
}

/** Mẫu chung của bộ ghế: mẫu phổ biến nhất trong ghế cố định (hoà → ghế id nhỏ hơn); không có ghế cố định → ghế id nhỏ nhất. */
export const chairSetFolderOf = (members: readonly ChairMember[]): string | null => {
  const sorted = [...members].sort((a, b) => a.id.localeCompare(b.id));
  const fixed = sorted.filter((m) => m.fixed && m.folder !== null);
  if (fixed.length === 0) return sorted[0]?.folder ?? null;
  const count = new Map<string, number>();
  for (const m of fixed) count.set(m.folder as string, (count.get(m.folder as string) ?? 0) + 1);
  const top = Math.max(...count.values());
  return fixed.find((m) => count.get(m.folder as string) === top)?.folder ?? null;
};

/* ---- Luật chặn "xấu đi" (lát 2): ứng viên so với MẪU ĐANG THAY (mẫu luật cũ chọn), dữ liệu màu = hồ sơ ảnh (Lab, tỉ phần). ---- */

/** Một màu đo từ ảnh mẫu: [L, a, b, tỉ phần]. */
export type Swatch = readonly [number, number, number, number];
export interface GuardInput {
  /** Màu đo (`libraryColors.json`); thiếu = không phán được màu. */
  readonly colors?: readonly Swatch[] | undefined;
  /** [rộng, cao, sâu] (m). */
  readonly dims?: readonly [number, number, number] | undefined;
}
/** Màu tính là "đáng kể" từ tỉ phần này (chăn, nệm ghế…), không chỉ màu trội. */
export const SIGNIFICANT_SHARE = 0.15;
/** (a) món lớn: ΔE76 màu trội tới màu trội của mẫu đang thay. */
export const LARGE_DE_MAX = 15;
/** (a) món lớn: trần độ rực màu trội (hoặc không quá mẫu đang thay). */
export const LARGE_C_MAX = 16;
/** (b) tăng tối đa so với mẫu đang thay: chiều cao, khối tích. */
export const GROW_H_MAX = 1.25;
export const GROW_V_MAX = 1.5;
/** (c) màu có độ rực tới chừng này là trung tính (xám/be/trắng/đen). */
export const NEAR_GREY_C = 6;
/** (c) màu nổi phải gần (ΔE76) một màu đáng kể của mẫu đang thay — bảng màu mặc định = mẫu cũ + trung tính. */
export const FABRIC_DE_MAX = 12;

export type GuardRule = 'nodata' | 'size' | 'color' | 'chroma' | 'fabric';

const chromaOf = (s: Swatch): number => Math.hypot(s[1], s[2]);
const deltaE = (x: Swatch, y: Swatch): number => Math.hypot(x[0] - y[0], x[1] - y[1], x[2] - y[2]);
const dominantOf = (colors: readonly Swatch[]): Swatch | undefined => [...colors].sort((x, y) => y[3] - x[3])[0];
const significantOf = (colors: readonly Swatch[]): readonly Swatch[] => colors.filter((s) => s[3] >= SIGNIFICANT_SHARE);

/**
 * Lý do loại ứng viên so với mẫu đang thay; `undefined` = đạt. Thứ tự: thiếu dữ liệu màu, (b) cao/khối, (a) món lớn
 * lệch màu trội hoặc rực quá trần, (c) có màu nổi đáng kể ngoài bảng màu (mẫu cũ + trung tính).
 */
export const guardRejectOf = (cand: GuardInput, ref: GuardInput, large: boolean): GuardRule | undefined => {
  if (cand.colors === undefined || ref.colors === undefined || cand.colors.length === 0 || ref.colors.length === 0) return 'nodata';
  if (cand.dims !== undefined && ref.dims !== undefined) {
    const [cw, ch, cd] = cand.dims;
    const [rw, rh, rd] = ref.dims;
    if (ch > rh * GROW_H_MAX || cw * ch * cd > rw * rh * rd * GROW_V_MAX) return 'size';
  }
  const cDom = dominantOf(cand.colors) as Swatch;
  const rDom = dominantOf(ref.colors) as Swatch;
  if (large && deltaE(cDom, rDom) > LARGE_DE_MAX) return 'color';
  if (large && chromaOf(cDom) > Math.max(LARGE_C_MAX, chromaOf(rDom))) return 'chroma';
  const palette = significantOf(ref.colors);
  const loud = significantOf(cand.colors).filter((s) => chromaOf(s) > NEAR_GREY_C);
  if (loud.some((s) => !palette.some((p) => deltaE(s, p) <= FABRIC_DE_MAX))) return 'fabric';
  return undefined;
};
