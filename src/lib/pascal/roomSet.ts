/**
 * Bộ nội thất theo phòng (vòng 12, làn S) — hàm thuần; `sceneVariety.ts` dựng thành viên phòng rồi gọi `roomSetOf`.
 *
 * Gốc lỗi cũ: mỗi món chọn mẫu ĐỘC LẬP (`rankedLibraryPickOf` lấy mẫu đầu) → mọi phòng cùng một giường; thử nghiệm
 * thử nghiệm vòng 11 (đã xoá) rút ngẫu nhiên trong hạng nên lệch tông, ra giường nệm trần, so màu bằng "gần mẫu cũ".
 *
 * Ở đây: một món NEO (vai ưu tiên cao nhất có mặt; món ghim thuộc vai đó thì nó là neo), các món còn lại chấm theo độ
 * hợp với neo và với nhau; món cùng vai trong phòng dùng một mẫu. Ràng buộc CỨNG loại trước (dữ liệu chất lượng v1,
 * `libraryQuality.ts`: thiếu = chưa biết = loại), rồi điểm mềm từng món so với BẢNG MÀU PHÒNG (tường, tông gỗ của căn,
 * đồ cố định, neo): hạng phong cách, ΔE gỗ tới gỗ tham chiếu, độ sáng phần bọc, món ngồi tối đậm, độ rực, họ nhấn
 * (`itemCostOf`). Lượt 2 (chấm ảnh mù 9 căn): mẫu cũ thắng trừ khi mẫu mới hơn RÕ (`MIN_GAIN`). Tất định.
 *
 * Cờ `?enable=roomset` / `?disable=roomset`; `ROOMSET_DEFAULT` là hằng duy nhất để lật mặc định.
 */

import { qualityOf as defaultQualityOf, type ModelQuality, type QualityPart } from './libraryQuality';
import { overlapAreaMm2, type Rect } from './placement';
import { SCENE_STYLE_MATERIALS, type SceneStyle } from './sceneStyles';

/** HẰNG LẬT MẶC ĐỊNH (điều phối viên lật sau QA ảnh). */
export const ROOMSET_DEFAULT = true;
/** Phiên bản luật, ghi vào provenance của món đổi mẫu. */
export const ROOMSET_VERSION = 1;

const listOf = (search: string, key: string): string[] => (new URLSearchParams(search).get(key) ?? '').split(',');
export const roomSetOnOf = (search: string, defaults: boolean = ROOMSET_DEFAULT): boolean =>
  !listOf(search, 'disable').includes('roomset') && (defaults || listOf(search, 'enable').includes('roomset'));
/** Đọc MỘT lần lúc nạp trang (như `?disable=` của lớp cảnh). */
export const ROOMSET_ON: boolean = typeof location === 'undefined' ? ROOMSET_DEFAULT : roomSetOnOf(location.search);

/** FNV-1a 32 bit (băm rút neo trong dải; `sceneVariety` băm mẫu theo phòng/món). */
export const fnv1a = (text: string): number => {
  let hash = 0x811c9dc5;
  for (let i = 0; i < text.length; i += 1) {
    hash ^= text.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash;
};

/** Mẫu "không to hơn chỗ": từng cạnh mặt bằng (đã sắp) ≤ cạnh hộp × chừng này. */
export const FIT_SLACK = 1.1;
/** Mẫu `[rộng, cao, sâu]` (m) có lọt hộp `[ngắn, dài]` (m) không. */
export const fitsSpot = (dims: readonly [number, number, number], short: number, long: number): boolean => {
  const [w, , d] = dims;
  return Math.min(w, d) <= short * FIT_SLACK && Math.max(w, d) <= long * FIT_SLACK;
};

/** Vai thuộc bộ, thứ tự = ưu tiên làm neo (luật chung mọi công năng phòng). Cây/thảm/đồ `fixed`/thiết bị không vào bộ. */
export const SET_ROLES: readonly string[] = [
  'doubleBed', 'singleBed', 'sofa', 'diningTable', 'desk', 'closet', 'dresser', 'bookshelf',
  'armchair', 'coffeeTable', 'nightstand', 'bench', 'diningChair', 'cabinet',
];
const BED_ROLES: ReadonlySet<string> = new Set(['doubleBed', 'singleBed']);

/** Cao mẫu mới ≤ cao mẫu cũ × chừng này. */
export const HEIGHT_GROW_MAX = 1.15;
/** Món cao (mẫu cũ ≥ chừng này, m: tủ áo, kệ): ứng viên không cao hơn mẫu cũ — chấm mù lượt 4: tủ thay "chạm gần trần". */
export const TALL_M = 2.0;
/** Khoảng hở tối thiểu tới trần phòng (m) khi đầu vào có `ceilingM`. */
export const CEILING_GAP_M = 0.3;
/**
 * Dung sai mặt bằng HIỂN THỊ (m) so với HỘP CHỖ ĐẶT của món (vòng 13): ứng viên được lớn hơn mẫu cũ — mẫu cũ không phải
 * chuẩn đúng — nhưng không vượt hộp. Hộp là chỗ lớp tự sinh đã chừa (đã kiểm chồng đồ, lối đi, ô mở) hoặc cỡ AI dò CHƯA
 * xác nhận; cỡ người dùng xác nhận không vào bộ chọn. Va chạm sau khi chọn kiểm lại trên cả phòng (`ROOM_OVERLAP_TOL_M2`).
 */
export const SHOWN_TOL_M = 0.02;
/**
 * Tỉ lệ thật: mẫu co/giãn đều (trung bình nhân hai trục mặt bằng hiển thị / cỡ thật) ra ngoài [SCALE_MIN; SCALE_MAX] là
 * sai cỡ đồ thật (ghế co 0,75 thành đồ chơi) → loại; trong dải thì phạt SCALE_W × |ln g| (mẫu cũ cũng chịu) — mẫu vừa
 * hộp tự nhiên thắng mẫu bị co mạnh.
 */
export const SCALE_MIN = 0.8;
export const SCALE_MAX = 1.25;
export const SCALE_W = 1;
/** Va chạm cả phòng (m²): một lần đổi không được làm diện tích chồng (mặt bằng hiển thị) với đồ khác tăng quá chừng này. */
export const ROOM_OVERLAP_TOL_M2 = 0.002;
/**
 * Độ sáng/tương phản theo đồ ĐÃ CÓ trong phòng (vòng 13, ca xấu vòng 12): bề mặt cứng (khung, mặt — mọi chất liệu, kể cả
 * sơn trắng mà trước đây bị coi "trung tính, không ảnh hưởng") của đồ cố định + đồ đã chốt cho L* tham chiếu theo tỉ phần;
 * bề mặt cứng của ứng viên lệch quá CONTRAST_TOL phạt tỉ phần × (lệch − TOL)/CONTRAST_REF.
 */
export const CONTRAST_TOL = 25;
export const CONTRAST_REF = 25;
/**
 * Vai có sàn kích thước theo phân vị của chính pool vai (lượt 7): cạnh ngắn ứng viên ≥ phân vị SIZE_FLOOR_PCT của pool.
 * Pool armchair (72 mẫu) có mẫu đặt tên ghế ăn (`chair-dining-wood-woven` 541 mm, `chair-dining-grey-arm` 559 mm) mà
 * libraryQuality vẫn ghi vai armchair; cạnh ngắn ghế bành p10 = 614 mm, ghế ăn p90 = 584 mm → p10 tách hai nhóm.
 */
export const SIZE_FLOOR_PCT = 0.1;
const SIZE_FLOOR_ROLES: ReadonlySet<string> = new Set(['armchair', 'sofa']);
/**
 * Gương (`QualityPart.finish === 'mirror'`, làn Q: metallic ≥ 0,9, roughness ≤ 0,15): bộ dựng hình web CHƯA phản chiếu nên
 * gương hiện thành tấm trắng phẳng "như chưa gán vật liệu" (chấm mù lượt 4). Phạt MIRROR_PENALTY × tỉ phần: 15 % gương
 * = 0,30, 20 % = 0,40 → tủ gương không thay được tủ gỗ cùng tông chi phí ≤ 0,55 với biên MIN_GAIN 0,25.
 * GỠ khi bộ dựng hình có phản chiếu.
 */
export const MIRROR_PENALTY = 2;
/** Dải neo: ứng viên có chi phí ≤ tốt nhất + chừng này được rút (băm phòng + vai). */
export const ANCHOR_BAND = 0.08;
/**
 * Mẫu cũ (qua ràng buộc cứng) thắng trừ khi mẫu mới rẻ hơn ÍT NHẤT chừng này trên CHÍNH món đó. Lượt 1 = 0,05 nằm trong
 * nhiễu của dữ liệu suy luận: các lần đổi bị chê thắng với biên 0,05–0,2 (`F:/runs/m12/s2/diag.txt`); lần đổi được khen
 * (tủ greywash → mirror) hơn 0,28 theo công thức mới.
 */
export const MIN_GAIN = 0.25;
/**
 * Trần chi phí của mẫu THAY khi không so được với mẫu cũ (lượt 5, cảnh thật aka3 + chấm ảnh mù 9 căn):
 * - mẫu cũ CHƯA BIẾT (thiếu dữ liệu chất lượng / `parts`): chỉ thay bằng mẫu tốt tuyệt đối ≤ GOOD_COST;
 * - mẫu cũ trượt ràng buộc CHẤT LƯỢNG (issues, front, giường không full): thay bằng mẫu ≤ FAIL_COST, không bao giờ "rẻ nhất
 *   bất kể". Mẫu được khen có chi phí 0,00–0,04; mẫu bị chê thấp nhất 0,98 (sofa da xanh), còn lại 1,24–3,76.
 */
export const GOOD_COST = 0.3;
export const FAIL_COST = 0.9;
/** Gỗ: ΔE (L* tối hơn tham chiếu tính đủ, sáng hơn tính nửa) trong dung sai này coi là cùng tông; vượt thì /WOOD_DE_REF. */
export const WOOD_TOL = 15;
export const WOOD_DE_REF = 20;
export const WOOD_LIGHTER_L = 0.5;
/** Phần gỗ có C* dưới chừng này (sơn trắng/đen, nhãn "gỗ" sai) không tính là tông gỗ — chấm như bề mặt trung tính. */
export const WOOD_MIN_C = 8;
/** Gỗ tham chiếu theo tông của căn khi phòng không có đồ cố định/neo có gỗ: Lab đo của sồi sáng / óc chó trong thư viện. */
export const WOOD_LAB: Readonly<Record<'l' | 'd', Lab>> = { l: [67, 5, 22], d: [35, 10, 18] };
/** Bảng màu SÁNG khi tường trong có L* từ chừng này (4/5 phong cách ≥ 86; sang-trong-toi 50). */
export const LIGHT_WALL_L = 70;
/** Dải L* của phần bọc (upholstery/bedding) theo bảng màu sáng/tối; lệch dải /SOFT_L_REF × tỉ phần. */
export const SOFT_L: Readonly<Record<'light' | 'dark', readonly [number, number]>> = { light: [45, 95], dark: [20, 75] };
export const SOFT_L_REF = 25;
/** Tối đậm: L* dưới chừng này. Phòng sáng: món NGỒI tối đậm ≥ DARK_SEAT_SHARE bề mặt phạt DARK_SEAT; món khác phạt theo tỉ phần. */
export const DARK_L = 25;
export const DARK_SEAT_SHARE = 0.5;
export const DARK_SEAT = 1;
export const DARK_SURF = 1;
/** Phòng TỐI (lượt 6, sang-trong-toi tường L* 50): bề mặt rất sáng (L* > BRIGHT_L) phạt BRIGHT_SURF × tỉ phần — trước đó
 *  giường L*84, tủ trắng L*91 được chọn với chi phí 0. */
export const BRIGHT_L = 80;
export const BRIGHT_SURF = 1;
/** Màu: C* tới chừng này là trung tính (be/kem đo 11–12); trần độ rực; phần nhỏ hơn tỉ phần này không thành họ nhấn. */
export const NEUTRAL_C = 14;
export const CHROMA_CAP = 25;
export const ACCENT_HUE_SPAN = 30;
export const ACCENT_MIN_SHARE = 0.15;
/** Món NHẤN (phần màu ≥ 0,3 bề mặt) mà là NEO (món lớn nhất phòng): SceneStyle không có trường cho phép → luôn phạt. */
export const ACCENT_ANCHOR = 0.5;
/**
 * Lớp vải (lượt 6): giường có MỘT cụm màu vải (trắng trên trắng — chăn và ga gộp một cụm khi đo) đọc như ga trơn trong
 * cảnh. Cụm = phần không phải tông gỗ, kind bedding/upholstery/other, tỉ phần ≥ LAYER_MIN_SHARE; hai cụm khác nhau khi
 * ΔE ≥ LAYER_DE. Đúng một cụm → phạt SINGLE_LAYER; không cụm nào (nhãn kind sai, vd sọc ghi "metal") = chưa biết, không phạt.
 * SINGLE_LAYER 0,4 > MIN_GAIN + chênh 0,06 giữa bed-white-oak-headboard (0,10) và bed-double-oak-pro (0,04) — số ở diag3.
 */
export const LAYER_MIN_SHARE = 0.08;
export const LAYER_DE = 15;
export const SINGLE_LAYER = 0.4;
/**
 * Lớp phủ màu dịu (vòng 13): giường có một lớp chăn/khăn phủ màu dịu (C* trong [TINT_C_MIN, NEUTRAL_C], tỉ phần ≥
 * LAYER_MIN_SHARE) nằm trên nền chăn trung tính (C* < TINT_BASE_C) được trừ TINT_BONUS. Bằng chứng: 3 lượt chấm mù vòng 13,
 * 12 phiếu, giường chăn trơn trắng/be thua giường có tấm phủ màu dịu ở hầu hết phòng ngủ. Một tông be cho cả bộ (lanh) không tính.
 * TINT_BONUS 0,3 > MIN_GAIN: đủ để thay giường trơn hoà điểm, không đủ bù giường lệch tông (> 0,3).
 */
export const TINT_C_MIN = 6;
export const TINT_BASE_C = 3;
export const TINT_BONUS = 0.3;
const LAYER_ROLES: ReadonlySet<string> = new Set(['doubleBed', 'singleBed']);
const LAYER_KINDS: ReadonlySet<string> = new Set(['bedding', 'upholstery', 'other']);
/** Trọng số: phong cách, gỗ, vải/màu. */
export const W_STYLE = 1;
export const W_WOOD = 1;
export const W_FABRIC = 1;
const SEAT_ROLES: ReadonlySet<string> = new Set(['sofa', 'armchair', 'diningChair', 'bench']);
/** Món chấm gỗ theo món "cặp" của nó trước (ghế ăn ↔ bàn ăn). */
const PARTNER: Readonly<Record<string, string>> = { diningChair: 'diningTable' };

type Lab = readonly [number, number, number];
export type Dims = readonly [number, number, number];

/** Bảng màu so được của phòng: màu tường (Lab), tông gỗ của căn, sáng/tối. */
export interface SetPalette {
  readonly wall?: Lab;
  readonly tone?: 'l' | 'd';
  /** Tường sáng (L* ≥ LIGHT_WALL_L); vắng tường thì theo tông gỗ. */
  readonly light?: boolean;
}

/** sRGB hex → Lab (D65). */
const labOfHex = (hex: string): Lab | undefined => {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex);
  if (m === null) return undefined;
  const n = parseInt(m[1] as string, 16);
  const [r, g, b] = [n >> 16, (n >> 8) & 255, n & 255].map((v) => {
    const c = v / 255;
    return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  }) as [number, number, number];
  const f = (t: number): number => (t > 216 / 24389 ? Math.cbrt(t) : ((24389 / 27) * t + 16) / 116);
  const x = f((0.4124 * r + 0.3576 * g + 0.1805 * b) / 0.95047);
  const y = f(0.2126 * r + 0.7152 * g + 0.0722 * b);
  const z = f((0.0193 * r + 0.1192 * g + 0.9505 * b) / 1.08883);
  return [116 * y - 16, 500 * (x - y), 200 * (y - z)];
};
/** Bảng màu từ SceneStyle: sơn tường trong (vật liệu phẳng có màu) + tông gỗ của căn. Vân sàn là texture → tông gỗ thay. */
export const paletteOf = (style: SceneStyle, woodTone: 'l' | 'd' | undefined): SetPalette => {
  // Phong cách concept (AI) có thể thiếu `wall`/`wall.interior` lúc chạy dù kiểu bắt buộc → không có tường để so.
  const id = (style.wall as Partial<SceneStyle['wall']> | undefined)?.interior?.replace(/^scene:/, '') ?? '';
  const color = SCENE_STYLE_MATERIALS.find((m) => m.id === id)?.material.properties?.color;
  const wall = typeof color === 'string' ? labOfHex(color) : undefined;
  const light = wall === undefined ? woodTone !== 'd' : wall[0] >= LIGHT_WALL_L;
  return { ...(wall === undefined ? {} : { wall }), ...(woodTone === undefined ? {} : { tone: woodTone }), light };
};

export interface SetBox {
  readonly cx: number;
  readonly cy: number;
  readonly w: number;
  readonly d: number;
  readonly rot: number;
}

export interface SetMember {
  readonly id: string;
  readonly role: string;
  /** Cạnh ngắn/dài chỗ đặt (m). */
  readonly short: number;
  readonly long: number;
  /** Mẫu luật cũ chọn (món ghim: mẫu đang dùng). */
  readonly current: string | null;
  /** Ứng viên đã lọc cỡ/QC/hướng (rỗng = không đổi được). */
  readonly pool: readonly string[];
  /** Ngoài phạm vi (người dùng ghim/đã chỉnh): không đổi, làm chuẩn. */
  readonly fixed: boolean;
  /** Chiều cao trần phòng (m) nếu bên gọi biết; vắng = không kiểm khoảng hở trần. */
  readonly ceilingM?: number;
  /**
   * Cỡ HIỂN THỊ [rộng, cao, sâu] (m) của một mẫu trong hộp của món, bằng đúng phép co dựng cảnh (`itemFitOf`); vắng =
   * bên gọi không có hộp (test thuần) → ràng buộc theo cỡ catalog.
   */
  readonly shownOf?: (folder: string) => Dims | undefined;
  /**
   * Hộp chỗ đặt (m): tâm trên mặt bằng tầng, rộng `w` × sâu `d` theo khung riêng của món (cùng trục `shownOf`), xoay `rot`
   * độ. Vắng = test thuần không có hình học phòng → bỏ kiểm hộp và va chạm.
   */
  readonly box?: SetBox;
  /** Nguồn kích thước: lớp tự sinh / AI dò chưa xác nhận (chỉ hai nguồn này vào bộ chọn). */
  readonly sizeFrom?: 'generated' | 'ai';
  /** Món nâng khỏi sàn (treo tường, đặt trên mặt khác): vẫn góp bảng màu, KHÔNG tính va chạm mặt sàn. */
  readonly lifted?: boolean;
}

export interface SetContext {
  readonly tierOf: (folder: string) => number;
  /** Số mã phong cách của căn (chuẩn hoá hạng). */
  readonly tiers: number;
  /** [rộng, cao, sâu] m của mẫu. */
  readonly dimsOf: (folder: string) => Dims | undefined;
  readonly palette: SetPalette;
  readonly qualityOf?: (id: string) => ModelQuality | undefined;
}

type SetRule = 'roomset' | 'keep';
export interface SetDecision {
  readonly id: string;
  readonly role: string;
  readonly from: string | null;
  readonly to: string | null;
  readonly rule: SetRule;
  readonly anchor: boolean;
  /** Chi phí (nhỏ = hợp hơn) của mẫu được chọn / mẫu cũ khi giữ. */
  readonly cost?: number;
  /** Chi phí mẫu luật cũ của CHÍNH món này trong cùng ngữ cảnh; vắng = mẫu cũ trượt ràng buộc cứng. */
  readonly fromCost?: number;
  /** Mẫu cũ trượt ràng buộc CHẤT LƯỢNG nào (máy đọc, thống kê); vắng = mẫu cũ đạt và so được. */
  readonly oldFail?: OldFail;
  /** Lý do giữ / chọn (tiếng Việt, cho đầu dò). */
  readonly why: string;
  /** Đầu dò: số ứng viên trong tập bị loại theo từng lý do ràng buộc cứng (vắng = không bị loại cái nào). */
  readonly rejects?: Readonly<Record<string, number>>;
  /** Đầu dò: tối đa 3 ứng viên qua ràng buộc cứng rẻ nhất [mẫu, chi phí]. */
  readonly top?: readonly (readonly [string, number])[];
}

/** Mẫu cũ "không đạt" vì: lỗi QC, mặt trước chưa tin, giường chưa đủ chăn gối, hoặc chưa biết (thiếu dữ liệu / parts). */
export type OldFail = 'issues' | 'front' | 'completeness' | 'unknown';
const OLD_FAIL_VI: Readonly<Record<OldFail, string>> = {
  issues: 'có lỗi QC',
  front: 'mặt trước chưa tin',
  completeness: 'giường chưa đủ chăn gối',
  unknown: 'chưa biết (thiếu dữ liệu chất lượng/parts)',
};
const chromaOf = (lab: Lab): number => Math.hypot(lab[1], lab[2]);
const hueOf = (lab: Lab): number => (Math.atan2(lab[2], lab[1]) * 180) / Math.PI;
const hueGap = (a: number, b: number): number => {
  const d = Math.abs(a - b) % 360;
  return d > 180 ? 360 - d : d;
};

/** Hệ số co đều của mẫu khi hiển thị: √(rộng_hiện/rộng_thật × sâu_hiện/sâu_thật); vắng = không có cỡ hiển thị. */
export const scaleOf = (dims: Dims | undefined, shown: Dims | undefined): number | undefined =>
  dims === undefined || shown === undefined || dims[0] <= 0 || dims[2] <= 0 ? undefined : Math.sqrt((shown[0] / dims[0]) * (shown[2] / dims[2]));
/**
 * Màu trung tính (không thành họ nhấn): độ rực tới NEUTRAL_C, mọi góc màu. Vòng 13 từng hạ ngưỡng màu lạnh xuống C* 8 (chăn
 * xanh xám C* 12 thành "màu nhấn"); 3 lượt chấm mù vòng 13 đều cho giường có tấm phủ xanh xám THẮNG giường chăn trơn, nên gỡ.
 */
const isLoud = (lab: Lab): boolean => chromaOf(lab) > NEUTRAL_C;
/** Bề mặt CỨNG (khung/mặt/gỗ/đá/nhựa — không bọc, không kim loại, không kính): tham gia độ sáng/tương phản phòng. */
const isHard = (p: QualityPart): boolean =>
  p.kind !== 'upholstery' && p.kind !== 'bedding' && p.kind !== 'metal' && p.kind !== 'glass' && p.material !== 'metal' && p.material !== 'glass';

/** Lý do loại cứng của mẫu `folder` cho món `m`; `undefined` = đạt. */
export const hardRejectOf = (m: SetMember, folder: string, ctx: SetContext): string | undefined => {
  const q = (ctx.qualityOf ?? defaultQualityOf)(folder);
  if (q === undefined) return 'thiếu dữ liệu chất lượng';
  if (q.role !== m.role) return 'sai vai';
  if ((q.issues ?? []).length > 0) return 'có lỗi QC';
  if (q.front.check !== 'ok') return 'mặt trước chưa tin';
  if (q.parts === undefined || q.parts.length === 0) return 'thiếu dữ liệu phần';
  if (BED_ROLES.has(m.role) && q.completeness?.v !== 'full') return 'giường chưa hoàn chỉnh';
  const dims = ctx.dimsOf(folder);
  const ref = m.current === null ? undefined : ctx.dimsOf(m.current);
  // Lượt 6: mẫu đang dùng đã bị CO vào hộp (hộp giường AI dò 1,30 × 1,94 m, mẫu 1,71 × 2,14 m) → ứng viên được co tới
  // cùng mức trên từng trục (chỗ = max(hộp, mặt bằng mẫu cũ)), không hơn — co thêm thì sai tỉ lệ.
  const refShort = ref === undefined ? 0 : Math.min(ref[0], ref[2]);
  const refLong = ref === undefined ? 0 : Math.max(ref[0], ref[2]);
  if (dims === undefined || !fitsSpot(dims, Math.max(m.short, refShort), Math.max(m.long, refLong))) return 'không lọt chỗ';
  // Lượt 9 (Codex review 4 #1, #4): chiều cao và mặt bằng xét trên cỡ HIỂN THỊ (phép co của dựng cảnh không đều trục,
  // `heightMm` đã lưu đè cao mẫu) — hộp node không đổi không có nghĩa mặt bằng nhìn thấy không đổi.
  const shown = m.shownOf?.(folder);
  const shownRef = m.current === null ? undefined : m.shownOf?.(m.current);
  if (m.shownOf !== undefined && (shown === undefined || shownRef === undefined)) return 'không tính được cỡ hiển thị';
  // Vòng 13: chặn theo HỘP chỗ đặt, không theo mẫu cũ (mẫu cũ co nhỏ trong hộp không còn là trần).
  if (shown !== undefined && m.box !== undefined) {
    if (shown[0] > m.box.w + SHOWN_TOL_M || shown[2] > m.box.d + SHOWN_TOL_M) return 'vượt hộp chỗ đặt';
  }
  const g = scaleOf(dims, shown);
  if (g !== undefined && (g < SCALE_MIN || g > SCALE_MAX)) return 'sai tỉ lệ thật';
  const h = shown ?? dims;
  const hRef = shownRef ?? ref;
  if (hRef === undefined || h[1] > hRef[1] * (hRef[1] >= TALL_M ? 1 : HEIGHT_GROW_MAX)) return 'cao hơn mẫu cũ';
  if (m.ceilingM !== undefined && h[1] > m.ceilingM - CEILING_GAP_M) return 'chạm gần trần';
  if (SIZE_FLOOR_ROLES.has(m.role)) {
    const shorts = m.pool.flatMap((x) => {
      const d = ctx.dimsOf(x);
      return d === undefined ? [] : [Math.min(d[0], d[2])];
    });
    shorts.sort((a, b) => a - b);
    const floor = shorts[Math.floor(SIZE_FLOOR_PCT * (shorts.length - 1))];
    if (floor !== undefined && Math.min(dims[0], dims[2]) < floor) return 'nhỏ hơn cỡ vai';
  }
  return undefined;
};
/**
 * Mẫu ĐANG DÙNG chỉ "không đạt" về CHẤT LƯỢNG (lượt 5): nó đã được đặt và co vào hộp nên hình học (lọt chỗ, cao) là
 * hiện trạng hợp lệ — trước đây `hardRejectOf` áp `fitsSpot` lên mẫu cũ, mẫu co vào hộp nhỏ hơn mặt bằng gốc (sofa 1,89 m
 * trong hộp 1,62 m) bị coi trượt và bị thay bằng mẫu rẻ nhất bất kể điểm phạt.
 */
export const oldFailOf = (m: SetMember, folder: string, ctx: SetContext): OldFail | undefined => {
  const q = (ctx.qualityOf ?? defaultQualityOf)(folder);
  if (q === undefined || q.parts === undefined || q.parts.length === 0) return 'unknown';
  if ((q.issues ?? []).length > 0) return 'issues';
  if (q.front.check !== 'ok') return 'front';
  if (BED_ROLES.has(m.role)) return q.completeness === undefined ? 'unknown' : q.completeness.v === 'full' ? undefined : 'completeness';
  return undefined;
};

/** Đặc trưng màu của một mẫu (tính một lần mỗi lượt `roomSetOf`), chỉ từ Lab ĐO + tỉ phần; nhãn chất liệu chỉ dùng để nhận gỗ. */
interface Feat {
  readonly tier: number;
  /** Phần tông gỗ (material wood, C* ≥ WOOD_MIN_C). */
  readonly wood: readonly QualityPart[];
  /** Phần bọc (upholstery/bedding, mọi chất liệu — da ghi nhầm vải vẫn chấm theo Lab). */
  readonly soft: readonly QualityPart[];
  /** Phần màu đủ lớn để thành họ nhấn (không phải tông gỗ, C* > NEUTRAL_C, tỉ phần ≥ ACCENT_MIN_SHARE). */
  readonly loud: readonly QualityPart[];
  /** Mọi phần không phải tông gỗ (trần độ rực). */
  readonly other: readonly QualityPart[];
  /** Bề mặt cứng (`isHard`): độ sáng/tương phản với đồ đã có trong phòng. */
  readonly hard: readonly QualityPart[];
  /** Tổng tỉ phần bề mặt tối đậm (L* < DARK_L). */
  readonly dark: number;
  /** Tổng tỉ phần bề mặt rất sáng (L* > BRIGHT_L). */
  readonly bright: number;
  /** Tổng tỉ phần bề mặt gương (`finish: 'mirror'`, trường tuỳ chọn của làn Q; vắng = 0). */
  readonly mirror: number;
  /** Số cụm màu vải tương phản (`LAYER_*`); vắng = không đo được (không có phần vải). */
  readonly layers?: number;
  /** Có lớp phủ màu dịu trên nền chăn trung tính (`TINT_*`). */
  readonly tint: boolean;
  /** Lab gỗ trung bình theo tỉ phần (tham chiếu cho món khác); vắng = không có gỗ. */
  readonly woodLab?: Lab;
}
type Memo = Map<string, Feat>;
const isWoodTone = (p: QualityPart): boolean => p.material === 'wood' && chromaOf(p.lab) >= WOOD_MIN_C;
/** Cụm màu vải tương phản của một mẫu (gom tham lam theo tỉ phần giảm dần). */
export const layersOf = (parts: readonly QualityPart[]): { layers?: number } => {
  // Vòng 13: lớp vải là lớp TRÊN NỆM — có phần `bedding` thì chỉ đếm `bedding` (đầu giường bọc nệm xám + chăn trắng đọc
  // thành "hai lớp" dù trên nệm chỉ một lớp trắng); mẫu không có phần `bedding` nào (nhãn loại chưa tin) giữ cách đếm cũ.
  const eligible = parts.filter((p) => p.share >= LAYER_MIN_SHARE && !isWoodTone(p) && LAYER_KINDS.has(p.kind));
  const bedding = eligible.filter((p) => p.kind === 'bedding');
  const soft = (bedding.length > 0 ? bedding : eligible).sort((a, b) => b.share - a.share);
  if (soft.length === 0) return {};
  const reps: Lab[] = [];
  for (const p of soft) if (!reps.some((r) => Math.hypot(r[0] - p.lab[0], r[1] - p.lab[1], r[2] - p.lab[2]) < LAYER_DE)) reps.push(p.lab);
  return { layers: reps.length };
};
/** Lớp phủ màu dịu trên nền chăn trung tính: một phần `bedding` C* ∈ [TINT_C_MIN, NEUTRAL_C] + một phần `bedding` C* < TINT_BASE_C. */
export const tintedOf = (parts: readonly QualityPart[]): boolean => {
  const bedding = parts.filter((p) => p.kind === 'bedding' && p.share >= LAYER_MIN_SHARE);
  return bedding.some((p) => chromaOf(p.lab) >= TINT_C_MIN && chromaOf(p.lab) <= NEUTRAL_C) && bedding.some((p) => chromaOf(p.lab) < TINT_BASE_C);
};
const featOf = (folder: string, ctx: SetContext, memo: Memo): Feat => {
  const hit = memo.get(folder);
  if (hit !== undefined) return hit;
  const parts = (ctx.qualityOf ?? defaultQualityOf)(folder)?.parts ?? [];
  const wood = parts.filter(isWoodTone);
  const other = parts.filter((p) => !isWoodTone(p));
  const share = wood.reduce((s, p) => s + p.share, 0);
  const woodLab: Lab | undefined =
    share === 0
      ? undefined
      : ([0, 1, 2].map((i) => wood.reduce((s, p) => s + (p.lab[i] as number) * p.share, 0) / share) as unknown as Lab);
  const feat: Feat = {
    tier: ctx.tierOf(folder),
    wood,
    soft: parts.filter((p) => p.kind === 'upholstery' || p.kind === 'bedding'),
    loud: other.filter((p) => isLoud(p.lab) && p.share >= ACCENT_MIN_SHARE),
    hard: parts.filter(isHard),
    other,
    dark: parts.reduce((s, p) => s + (p.lab[0] < DARK_L ? p.share : 0), 0),
    bright: parts.reduce((s, p) => s + (p.lab[0] > BRIGHT_L ? p.share : 0), 0),
    mirror: parts.reduce((s, p) => s + ((p as QualityPart & { readonly finish?: string }).finish === 'mirror' ? p.share : 0), 0),
    ...layersOf(parts),
    tint: tintedOf(parts),
    ...(woodLab === undefined ? {} : { woodLab }),
  };
  memo.set(folder, feat);
  return feat;
};

/** ΔE gỗ: L* tối hơn tham chiếu tính đủ, sáng hơn tính WOOD_LIGHTER_L (gỗ sáng trong phòng sáng ít "lạc" hơn gỗ tối). */
const woodDeltaOf = (lab: Lab, ref: Lab): number => {
  const dl = lab[0] - ref[0];
  return Math.hypot(dl < 0 ? dl : dl * WOOD_LIGHTER_L, lab[1] - ref[1], lab[2] - ref[2]);
};

/** Thành phần chi phí của một món trong phòng (nhỏ = hợp hơn) — đầu dò/diag đọc. */
interface ItemCost {
  readonly style: number;
  readonly wood: number;
  readonly soft: number;
  readonly dark: number;
  readonly chroma: number;
  readonly accent: number;
  readonly layer: number;
  readonly mirror: number;
  readonly contrast: number;
  readonly total: number;
}

/** Ngữ cảnh chấm một món: gỗ tham chiếu + họ nhấn đã có trong phòng (tường, đồ cố định, món đã chọn). */
interface ItemRefs {
  readonly wood: Lab;
  readonly families: readonly number[];
  readonly anchor: boolean;
  /** L* tham chiếu của bề mặt cứng đồ cố định + đã chốt trong phòng; vắng = phòng chưa có đồ nào để so. */
  readonly hardL?: number;
}

const familiesWith = (families: readonly number[], labs: readonly Lab[]): number[] => {
  const out = [...families];
  for (const lab of labs) if (!out.some((h) => hueGap(h, hueOf(lab)) <= ACCENT_HUE_SPAN)) out.push(hueOf(lab));
  return out;
};

/**
 * Chi phí một món = W_STYLE × hạng/(số mã+1)
 *   + W_WOOD × Σ tỉ phần × max(0, ΔE_gỗ(phần, gỗ tham chiếu) − WOOD_TOL)/WOOD_DE_REF
 *   + Σ tỉ phần bọc × khoảng cách L* tới dải SOFT_L / SOFT_L_REF
 *   + (phòng sáng) món ngồi tối đậm ≥ DARK_SEAT_SHARE → DARK_SEAT, còn lại DARK_SURF × tỉ phần tối đậm
 *   + W_FABRIC × (Σ tỉ phần × vượt CHROMA_CAP/CHROMA_CAP + số họ nhấn MỚI thêm vào phòng + ACCENT_ANCHOR nếu neo là món nhấn).
 */
const itemCostOf = (folder: string, role: string, refs: ItemRefs, ctx: SetContext, memo: Memo = new Map()): ItemCost => {
  const f = featOf(folder, ctx, memo);
  const light = ctx.palette.light !== false;
  const style = W_STYLE * (f.tier / (ctx.tiers + 1));
  const wood = W_WOOD * f.wood.reduce((s, p) => s + (p.share * Math.max(0, woodDeltaOf(p.lab, refs.wood) - WOOD_TOL)) / WOOD_DE_REF, 0);
  const [lo, hi] = SOFT_L[light ? 'light' : 'dark'];
  const soft = f.soft.reduce((s, p) => s + (p.share * Math.max(0, lo - p.lab[0], p.lab[0] - hi)) / SOFT_L_REF, 0);
  // Lệch bảng màu: phòng sáng phạt bề mặt tối đậm (món ngồi nặng hơn), phòng tối phạt bề mặt rất sáng.
  const dark = !light ? BRIGHT_SURF * f.bright : SEAT_ROLES.has(role) && f.dark >= DARK_SEAT_SHARE ? DARK_SEAT : DARK_SURF * f.dark;
  const chroma = f.other.reduce((s, p) => s + (p.share * Math.max(0, chromaOf(p.lab) - CHROMA_CAP)) / CHROMA_CAP, 0);
  const added = familiesWith(refs.families, f.loud.map((p) => p.lab)).length - refs.families.length;
  const loudShare = f.loud.reduce((s, p) => s + p.share, 0);
  const accent = Math.max(0, added - (refs.families.length === 0 ? 1 : 0)) + (refs.anchor && loudShare >= 0.3 ? ACCENT_ANCHOR : 0);
  const fabric = W_FABRIC * (chroma + accent);
  const layer = LAYER_ROLES.has(role) ? (f.layers === 1 ? SINGLE_LAYER : 0) - (f.tint ? TINT_BONUS : 0) : 0;
  const mirror = MIRROR_PENALTY * f.mirror;
  const hardL = refs.hardL;
  const contrast =
    hardL === undefined ? 0 : f.hard.reduce((s, p) => s + (p.share * Math.max(0, Math.abs(p.lab[0] - hardL) - CONTRAST_TOL)) / CONTRAST_REF, 0);
  return {
    style,
    wood,
    soft,
    dark,
    chroma: W_FABRIC * chroma,
    accent: W_FABRIC * accent,
    layer,
    mirror,
    contrast,
    total: style + wood + soft + dark + fabric + layer + mirror + contrast,
  };
};

/** Gỗ tham chiếu theo tông: tông của căn, vắng thì theo sáng/tối của bảng màu. */
const toneWoodOf = (palette: SetPalette): Lab => WOOD_LAB[palette.tone ?? (palette.light === false ? 'd' : 'l')];
/** Họ nhấn của tường (tường có màu) — điểm xuất phát của họ nhấn phòng. */
const wallFamiliesOf = (palette: SetPalette): number[] =>
  palette.wall !== undefined && isLoud(palette.wall) ? [hueOf(palette.wall)] : [];

const byId = (a: { readonly id: string }, b: { readonly id: string }): number => a.id.localeCompare(b.id);

/** Cỡ ô của chữ ký phòng, mm (cạnh hộp bao) và mm² (diện tích 0,1 m²). */
const KEY_GRID_MM = 100;
const KEY_AREA_MM2 = 1e5;
/** Lưới thô của vị trí phòng trong tầng, mm: sửa phòng khác vài chục mm không đẩy tâm phòng này qua ô. */
const KEY_SPOT_MM = 500;
/**
 * Lệch biên ô (lượt 4): `floor((v + lệch) / ô)` đặt biên ô ở v ≡ −lệch (mod ô) thay vì giữa ô của `round` — giá trị
 * thường gặp (bội 25/50/100 mm, diện tích bội 0,01 m²) nằm đúng giữa hai ô của `round` (4550/100 = 45,5) nên nhiễu
 * dấu phẩy động lật ô. Lệch lẻ (37 mm; 2×tâm lệch 251 mm; diện tích 37 000 mm²) đưa biên ra xa các bội ấy.
 */
const KEY_EDGE_MM = 37;
const KEY_SPOT_EDGE_2MM = 251;
const KEY_AREA_EDGE_MM2 = 37_000;

/**
 * Khoá băm của từng phòng theo NỘI DUNG, không theo id (id sinh lại khi chép sang dự án khác → nội thất không được
 * đổi): công năng + cạnh ngắn/dài hộp bao (ô 100 mm) + diện tích (ô 0,1 m²) + tâm hộp bao TƯƠNG ĐỐI so với góc nhỏ
 * nhất của các phòng cùng tầng (ô 500 mm). Toạ độ làm tròn về mm NGUYÊN trước mọi phép tính (nhiễu < 0,5 mm, tịnh
 * tiến cả căn không đổi khoá); tâm tính bằng tổng x0 + x1 nguyên (2 × tâm) để không có số lẻ dấu phẩy động.
 * Không dùng thứ hạng giữa các phòng trùng chữ ký (lượt 3): sửa phòng A không đổi khoá phòng B. Đánh đổi: sửa làm DỜI
 * góc nhỏ nhất của tầng (phòng ở mép trái/trên nới ra ngoài) thì khoá mọi phòng tầng ấy có thể đổi; giá trị nằm đúng
 * biên ô (đã lệch khỏi các bội thường gặp) vẫn lật ô khi sửa 1 mm.
 */
export const roomSetKeysOf = (
  rooms: readonly { readonly id: string; readonly levelId: string; readonly usage: string | undefined; readonly outline: readonly { readonly x: number; readonly y: number }[] }[],
): Map<string, string> => {
  const cell = (v: number, edge: number, size: number): number => Math.floor((v + edge) / size);
  const snapped = rooms.map((r) => ({ ...r, outline: r.outline.map((p) => ({ x: Math.round(p.x), y: Math.round(p.y) })) }));
  const originOf = new Map<string, { x: number; y: number }>();
  for (const r of snapped) {
    for (const p of r.outline) {
      const o = originOf.get(r.levelId);
      originOf.set(r.levelId, o === undefined ? { x: p.x, y: p.y } : { x: Math.min(o.x, p.x), y: Math.min(o.y, p.y) });
    }
  }
  const info = snapped.map((r) => {
    const xs = r.outline.map((p) => p.x);
    const ys = r.outline.map((p) => p.y);
    const [x0, x1, y0, y1] = [Math.min(...xs), Math.max(...xs), Math.min(...ys), Math.max(...ys)];
    const o = originOf.get(r.levelId) ?? { x: 0, y: 0 };
    // Shoelace trên mm nguyên: tổng nguyên chính xác (|toạ độ| < 9·10⁷ mm); ×2 diện tích để khỏi chia lẻ.
    const area2 = Math.abs(r.outline.reduce((sum, p, i) => {
      const q = r.outline[(i + 1) % r.outline.length] ?? p;
      return sum + p.x * q.y - q.x * p.y;
    }, 0));
    const [w, h] = [x1 - x0, y1 - y0];
    const side = (v: number): number => cell(v, KEY_EDGE_MM, KEY_GRID_MM);
    const sig = `${r.usage ?? ''}|${side(Math.min(w, h))}x${side(Math.max(w, h))}|${cell(area2, 2 * KEY_AREA_EDGE_MM2, 2 * KEY_AREA_MM2)}`;
    const spot = (twice: number): number => cell(twice, KEY_SPOT_EDGE_2MM, 2 * KEY_SPOT_MM);
    return { id: r.id, key: `${sig}#${spot(x0 + x1 - 2 * o.x)},${spot(y0 + y1 - 2 * o.y)}` };
  });
  return new Map(info.map(({ id, key }) => [id, key]));
};
/** Hình chữ nhật XOAY trên mặt bằng, đơn vị mét (cùng quy ước `placement.Rect`: khung riêng w × d, xoay quanh tâm). */
export type PlanRect = Rect;
export const planRectOf = (cx: number, cy: number, w: number, d: number, rot: number): PlanRect => ({ cx, cy, w, d, rotationDeg: rot });
/** Diện tích chung (m²) của hai hình xoay: cắt đa giác thật (`overlapAreaMm2`), không dùng hộp thẳng trục bao ngoài. */
const MM = 1000;
export const overlapAreaM2 = (a: PlanRect, b: PlanRect): number =>
  overlapAreaMm2({ ...a, cx: a.cx * MM, cy: a.cy * MM, w: a.w * MM, d: a.d * MM }, { ...b, cx: b.cx * MM, cy: b.cy * MM, w: b.w * MM, d: b.d * MM }) / (MM * MM);
/** Mặt bằng HIỂN THỊ của mẫu `folder` trong hộp của món (canh giữa hộp, xoay theo hộp); vắng = không có hộp. */
const shownRectOf = (m: SetMember, folder: string | null): PlanRect | undefined => {
  const b = m.box;
  if (b === undefined) return undefined;
  const shown = folder === null ? undefined : m.shownOf?.(folder);
  return planRectOf(b.cx, b.cy, shown?.[0] ?? b.w, shown?.[2] ?? b.d, b.rot);
};

/**
 * Bộ của một phòng. `roomKey` = khoá nội dung (`roomSetKeysOf`), chỉ dùng để băm rút neo. `decided` = món đã chốt ở
 * lượt trước trong cùng lượt dựng (giữ nguyên, làm ngữ cảnh). `obstacles` = mặt bằng (m) đồ đứng sàn khác trong phòng
 * (không thuộc bộ). Trả quyết định cho mọi món trong phạm vi chưa chốt. Thứ tự xử lý: vai neo, rồi `SET_ROLES`; trong
 * vai theo id.
 *
 * Gỗ tham chiếu của món: món cặp (ghế ăn ↔ bàn ăn) → gỗ đồ CỐ ĐỊNH trong phòng → gỗ của neo (món phụ) → tông của căn.
 * Độ sáng tham chiếu: bề mặt cứng của đồ cố định + đã chốt (kể cả sơn trắng). Chi phí món = chi phí mẫu trong phòng +
 * SCALE_W × |ln tỉ lệ| trong hộp của CHÍNH món. Mẫu cũ qua ràng buộc cứng thắng trừ khi mẫu mới rẻ hơn ≥ MIN_GAIN.
 * Sau cùng kiểm va chạm cả phòng: lần đổi nào làm chồng lấn tăng thì trả về mẫu cũ.
 */
export const roomSetOf = (
  roomKey: string,
  members: readonly SetMember[],
  decided: ReadonlyMap<string, SetDecision>,
  ctx: SetContext,
  obstacles: readonly PlanRect[] = [],
): Map<string, SetDecision> => {
  const inSet = members.filter((m) => SET_ROLES.includes(m.role)).sort(byId);
  const roles = SET_ROLES.filter((role) => inSet.some((m) => m.role === role));
  const anchorRole = roles[0];
  const memo: Memo = new Map();
  const folderOfFixed = (m: SetMember): string | null => (m.fixed ? m.current : (decided.get(m.id)?.to ?? null));
  // Bảng màu phòng: tường + đồ cố định/đã chốt (gỗ trung bình theo tỉ phần, họ nhấn, độ sáng bề mặt cứng).
  const fixedFolders = inSet.flatMap((m) => {
    const f = folderOfFixed(m);
    return f === null ? [] : [f];
  });
  const fixedWoods = fixedFolders.map((f) => featOf(f, ctx, memo)).filter((x) => x.woodLab !== undefined);
  const fixedWood: Lab | undefined =
    fixedWoods.length === 0
      ? undefined
      : ([0, 1, 2].map((i) => fixedWoods.reduce((s, x) => s + ((x.woodLab as Lab)[i] as number), 0) / fixedWoods.length) as unknown as Lab);
  let families = familiesWith(wallFamiliesOf(ctx.palette), fixedFolders.flatMap((f) => featOf(f, ctx, memo).loud.map((p) => p.lab)));
  // Độ sáng bề mặt cứng: tổng L*×tỉ phần và tổng tỉ phần của đồ cố định + đã chốt (cập nhật khi chốt thêm).
  let hardSum = 0;
  let hardShare = 0;
  const addHard = (folder: string): void => {
    for (const p of featOf(folder, ctx, memo).hard) {
      hardSum += p.lab[0] * p.share;
      hardShare += p.share;
    }
  };
  fixedFolders.forEach(addHard);
  const woodByRole = new Map<string, Lab>();
  for (const m of inSet) {
    const f = folderOfFixed(m);
    const lab = f === null ? undefined : featOf(f, ctx, memo).woodLab;
    if (lab !== undefined && !woodByRole.has(m.role)) woodByRole.set(m.role, lab);
  }
  let anchorWood: Lab | undefined;
  const out = new Map<string, SetDecision>();
  const decide = (m: SetMember, to: string | null, anchor: boolean, why: string, cost?: number, fromCost?: number, oldFail?: OldFail): void => {
    out.set(m.id, {
      id: m.id,
      role: m.role,
      from: m.current,
      to,
      rule: to === m.current ? 'keep' : 'roomset',
      anchor,
      ...(cost === undefined || !Number.isFinite(cost) ? {} : { cost }),
      ...(fromCost === undefined || !Number.isFinite(fromCost) ? {} : { fromCost }),
      ...(oldFail === undefined ? {} : { oldFail }),
      why,
    });
  };
  /** Phạt tỉ lệ của mẫu trong hộp của món (0 khi không có cỡ hiển thị). */
  const scaleCostOf = (m: SetMember, folder: string): number => {
    const g = scaleOf(ctx.dimsOf(folder), m.shownOf?.(folder));
    return g === undefined ? 0 : SCALE_W * Math.abs(Math.log(g));
  };

  for (const role of roles) {
    const group = inSet.filter((m) => m.role === role);
    const todo = group.filter((m) => !m.fixed && !decided.has(m.id));
    if (todo.length === 0) continue;
    const anchor = role === anchorRole;
    const partner = PARTNER[role];
    const refs: ItemRefs = {
      wood: (partner === undefined ? undefined : woodByRole.get(partner)) ?? fixedWood ?? (anchor ? undefined : anchorWood) ?? toneWoodOf(ctx.palette),
      families,
      anchor,
      ...(hardShare > 0 ? { hardL: hardSum / hardShare } : {}),
    };
    const costOf = (folder: string): number => itemCostOf(folder, role, refs, ctx, memo).total;
    const costFor = (m: SetMember, folder: string): number => costOf(folder) + scaleCostOf(m, folder);
    const fits = (m: SetMember, folder: string): boolean => hardRejectOf(m, folder, ctx) === undefined;
    /** Mẫu rẻ nhất (trung bình trên các món) cho các món `ms` (qua ràng buộc cứng của MỌI món); neo rút trong dải theo băm. */
    const bestFor = (ms: readonly SetMember[], cap = Infinity): { f: string; band: number } | undefined => {
      const ranked = [...new Set(ms.flatMap((m) => m.pool))]
        .filter((f) => ms.every((m) => m.pool.includes(f) && fits(m, f)))
        .sort()
        .map((f) => ({ f, cost: ms.reduce((s, m) => s + costFor(m, f), 0) / ms.length }))
        // Trần lọc TRƯỚC dải neo: băm không được rút trúng ứng viên quá trần (Codex vòng 13 lượt 3).
        .filter((r) => r.cost <= cap)
        .sort((a, b) => a.cost - b.cost || a.f.localeCompare(b.f));
      const best = ranked[0];
      if (best === undefined) return undefined;
      const band = anchor ? ranked.filter((r) => r.cost <= best.cost + ANCHOR_BAND) : [best];
      return { f: (band[fnv1a(`${roomKey}|${role}`) % band.length] as { f: string }).f, band: band.length };
    };
    // Mẫu chung của nhóm cùng vai: món cùng vai đã có mẫu (ghim / đã chốt), không thì mẫu tốt nhất lọt MỌI chỗ.
    const pinned = group.map(folderOfFixed).find((f): f is string => f !== null);
    const shared = pinned !== undefined ? { f: pinned, band: 1 } : bestFor(todo);
    // Từng món quyết định RIÊNG (lượt 3): chỉ nhận mẫu qua ràng buộc cứng của chính nó VÀ hơn mẫu luật cũ của chính
    // nó ≥ MIN_GAIN (hoặc mẫu cũ trượt ràng buộc cứng); không thì giữ mẫu cũ của nó. Món cùng mẫu cũ ra cùng kết quả.
    /** Sổ đầu dò của món: lý do loại + 3 ứng viên rẻ nhất (chỉ đọc, không ảnh hưởng quyết định). */
    const probeOf = (m: SetMember): Pick<SetDecision, 'rejects' | 'top'> => {
      const rejects: Record<string, number> = {};
      const ok: [string, number][] = [];
      for (const f of m.pool) {
        const r = hardRejectOf(m, f, ctx);
        if (r === undefined) ok.push([f, +costFor(m, f).toFixed(3)]);
        else rejects[r] = (rejects[r] ?? 0) + 1;
      }
      ok.sort((a, b) => a[1] - b[1] || a[0].localeCompare(b[0]));
      return { ...(Object.keys(rejects).length > 0 ? { rejects } : {}), ...(ok.length > 0 ? { top: ok.slice(0, 3) } : {}) };
    };
    for (const m of todo) {
      // Mẫu cũ: chỉ xét CHẤT LƯỢNG (hình học là hiện trạng). Đạt → so biên MIN_GAIN; trượt → trần FAIL_COST; chưa biết → GOOD_COST.
      const oldFail: OldFail | undefined = m.current === null ? 'unknown' : oldFailOf(m, m.current, ctx);
      const curCost = oldFail === undefined ? costFor(m, m.current as string) : Infinity;
      const cap = oldFail === undefined ? Infinity : oldFail === 'unknown' ? GOOD_COST : FAIL_COST;
      const old = oldFail === undefined ? curCost.toFixed(2) : `trượt: ${OLD_FAIL_VI[oldFail]}`;
      // Mẫu chung (kể cả mẫu ghim) phải nằm trong ĐÚNG tập ứng viên của món nhận (lọc cỡ/QC/hướng), không thì chấm riêng.
      // Vòng 13: mẫu chung vượt trần của CHÍNH món (mẫu cũ trượt chất lượng) thì chấm riêng — không giữ mẫu hỏng chỉ vì
      // mẫu chung của nhóm không hợp món này.
      const sharedOk = shared !== undefined && m.pool.includes(shared.f) && fits(m, shared.f) && costFor(m, shared.f) <= cap;
      // Không ứng viên nào dưới trần → vẫn lấy ứng viên tốt nhất để ghi lý do giữ ("> trần") đúng.
      const pick = sharedOk ? shared : (bestFor([m], cap) ?? bestFor([m]));
      const pickCost = pick === undefined ? Infinity : costFor(m, pick.f);
      if (pick === undefined) {
        decide(m, m.current, anchor, 'không ứng viên qua ràng buộc cứng', undefined, curCost, oldFail);
      } else if (pickCost > cap) {
        decide(m, m.current, anchor, `giữ: mẫu cũ ${old}; ứng viên tốt nhất ${pickCost.toFixed(2)} > trần ${cap}`, curCost, curCost, oldFail);
      } else if (pickCost <= curCost - MIN_GAIN) {
        const via = pick === shared && pinned !== undefined ? 'cùng mẫu món cùng vai đã có' : anchor ? `neo, dải ${pick.band}` : 'hợp bộ';
        decide(m, pick.f, anchor, `${via}; ${pickCost.toFixed(2)} < cũ ${old}`, pickCost, curCost, oldFail);
      } else {
        decide(m, m.current, anchor, `mẫu mới không hơn rõ (tốt nhất ${pickCost.toFixed(2)}, cũ ${old})`, curCost, curCost, oldFail);
      }
    }
    for (const m of todo) {
      const d = out.get(m.id);
      if (d !== undefined) out.set(m.id, { ...d, ...probeOf(m) });
      const to = d?.to;
      if (to === null || to === undefined) continue;
      const feat = featOf(to, ctx, memo);
      if (anchor && anchorWood === undefined && feat.woodLab !== undefined) anchorWood = feat.woodLab;
      if (feat.woodLab !== undefined && !woodByRole.has(role)) woodByRole.set(role, feat.woodLab);
      families = familiesWith(families, feat.loud.map((p) => p.lab));
      addHard(to);
    }
  }

  // Va chạm cả phòng (vòng 13): so TỪNG CẶP (món ↔ món trong bộ, món ↔ đồ đứng sàn khác) giữa mặt bằng hiển thị CUỐI và
  // mặt bằng GỐC (mẫu trước khi chọn). Cặp nào chồng tăng quá ROOM_OVERLAP_TOL_M2 → trả mẫu cũ cho món đổi có id nhỏ nhất
  // của cặp (tất định), rồi kiểm lại từ đầu tới khi ổn định. Mỗi vòng chỉ trả về nên vòng lặp dừng; trả hết = hiện trạng.
  const origOf = (m: SetMember): string | null => folderOfFixed(m) ?? m.current;
  const finalOf = (m: SetMember): string | null => out.get(m.id)?.to ?? origOf(m);
  const changedOf = (m: SetMember): boolean => out.get(m.id)?.rule === 'roomset';
  const revert = (m: SetMember, why: string): void => {
    const d = out.get(m.id) as SetDecision;
    decide(m, m.current, d.anchor, `va chạm cả phòng: ${d.to ?? ''} ${why}`, d.fromCost, d.fromCost, d.oldFail);
    out.set(m.id, { ...(out.get(m.id) as SetDecision), ...(d.rejects ? { rejects: d.rejects } : {}), ...(d.top ? { top: d.top } : {}) });
  };
  const boxed = inSet.filter((m) => m.box !== undefined && m.lifted !== true);
  for (let again = true; again; ) {
    again = false;
    const grown = (a: PlanRect | undefined, b: PlanRect | undefined, a0: PlanRect | undefined, b0: PlanRect | undefined): boolean =>
      a !== undefined && b !== undefined && a0 !== undefined && b0 !== undefined && overlapAreaM2(a, b) > overlapAreaM2(a0, b0) + ROOM_OVERLAP_TOL_M2;
    outer: for (const [i, m] of boxed.entries()) {
      if (!changedOf(m)) continue;
      const [mF, m0] = [shownRectOf(m, finalOf(m)), shownRectOf(m, origOf(m))];
      for (const o of obstacles) {
        if (grown(mF, o, m0, o)) {
          revert(m, 'chồng đồ đứng sàn khác');
          again = true;
          break outer;
        }
      }
      for (const x of boxed.slice(i + 1)) {
        if (grown(mF, shownRectOf(x, finalOf(x)), m0, shownRectOf(x, origOf(x)))) {
          revert(m, `chồng ${x.id}`);
          again = true;
          break outer;
        }
      }
      for (const x of boxed.slice(0, i)) {
        // Cặp với món id nhỏ hơn mà món đó KHÔNG đổi: chỉ món này có thể trả về.
        if (!changedOf(x) && grown(mF, shownRectOf(x, finalOf(x)), m0, shownRectOf(x, origOf(x)))) {
          revert(m, `chồng ${x.id}`);
          again = true;
          break outer;
        }
      }
    }
  }
  return out;
};
