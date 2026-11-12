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
 * (`itemCostOf`). Tất định.
 *
 * Vòng 14: MỘT đường chọn mẫu — mọi món vai bộ chưa ghim (đồ sinh, AI chưa/đã xác nhận, người dùng nhập chưa gán mẫu) lấy
 * mẫu từ đánh giá này; luật thư viện cũ không còn chọn trước rồi để bộ chọn "sửa" (bỏ MIN_GAIN), chỉ là phương án cuối
 * khi không ứng viên nào qua ràng buộc cứng. Ràng buộc là tuyệt đối (hộp, tỉ lệ thật, chuẩn cao của vai, trần, va chạm),
 * không so với mẫu luật cũ. Thiết kế + vết đường cũ: F:/runs/m15/sel/DESIGN.md.
 *
 * Cờ `?enable=roomset` / `?disable=roomset`; `ROOMSET_DEFAULT` là hằng duy nhất để lật mặc định.
 */

import type { Furniture } from '@/domain/spatial/types';

import { qualityOf as defaultQualityOf, type ModelQuality, type QualityPart } from './libraryQuality';
import { overlapAreaMm2, rectsOverlap, tuckedSeat, type Rect } from './placement';
import { SCENE_STYLE_MATERIALS, type SceneStyle } from './sceneStyles';

/** HẰNG LẬT MẶC ĐỊNH (điều phối viên lật sau QA ảnh). */
export const ROOMSET_DEFAULT = true;
/** Phiên bản luật, ghi vào provenance của món đổi mẫu. 2 = vòng 14: một đường chọn mẫu (không còn mẫu đương nhiệm). */
export const ROOMSET_VERSION = 2;

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

/** Vai thuộc bộ, thứ tự = ưu tiên làm neo (luật chung mọi công năng phòng). Cây/thảm/đồ `fixed`/thiết bị không vào bộ. */
export const SET_ROLES: readonly string[] = [
  'doubleBed', 'singleBed', 'sofa', 'diningTable', 'desk', 'closet', 'dresser', 'bookshelf',
  'armchair', 'coffeeTable', 'nightstand', 'bench', 'diningChair', 'cabinet',
];
const BED_ROLES: ReadonlySet<string> = new Set(['doubleBed', 'singleBed']);

/** Cao hiển thị ≤ chuẩn cao × chừng này; chuẩn = `heightMm` của món, không có thì trung vị (trên) cao mẫu của pool vai. */
export const HEIGHT_GROW_MAX = 1.15;
/** Món cao (chuẩn ≥ chừng này, m: tủ áo, kệ): ứng viên không cao hơn chuẩn — chấm mù vòng 12 lượt 4: tủ "chạm gần trần". */
export const TALL_M = 2.0;
/** Khoảng hở tối thiểu tới trần phòng (m) khi đầu vào có `ceilingM`. */
export const CEILING_GAP_M = 0.3;
/**
 * Dung sai mặt bằng HIỂN THỊ (m) so với HỘP CHỖ ĐẶT của món (vòng 13): ứng viên không vượt hộp. Hộp là chỗ lớp tự sinh
 * đã chừa (đã kiểm chồng đồ, lối đi, ô mở), cỡ AI dò, hoặc cỡ người dùng xác nhận (vòng 14: hộp không bao giờ đổi, thêm
 * `USER_FILL`). Va chạm kiểm trên cả phòng (`ROOM_OVERLAP_TOL_M2`).
 */
export const SHOWN_TOL_M = 0.02;
/**
 * Tỉ lệ thật: mẫu co/giãn đều (trung bình nhân hai trục mặt bằng hiển thị / cỡ thật) ra ngoài [SCALE_MIN; SCALE_MAX] là
 * sai cỡ đồ thật (ghế co 0,75 thành đồ chơi) → loại; hai trục lệch nhau quá SCALE_MAX/SCALE_MIN → loại "méo dáng"; trong
 * dải thì phạt SCALE_W × (|ln sx| + |ln sz|)/2 — mẫu vừa hộp tự nhiên thắng mẫu bị co mạnh hoặc méo một trục.
 */
export const SCALE_MIN = 0.8;
export const SCALE_MAX = 1.25;
export const SCALE_W = 1;
/**
 * Không có cỡ hiển thị (test thuần): mẫu `[rộng, cao, sâu]` (m) lọt hộp `[ngắn, dài]` (m) khi co đều về hộp không quá
 * SCALE_MIN — cùng ngưỡng tỉ lệ thật của đường có `itemFitOf` (trung bình nhân hai trục mặt bằng).
 */
export const fitsSpot = (dims: readonly [number, number, number], short: number, long: number): boolean => {
  const [w, , d] = dims;
  return Math.sqrt(Math.min(1, short / Math.min(w, d)) * Math.min(1, long / Math.max(w, d))) >= SCALE_MIN;
};

/** Va chạm cả phòng (m²): chồng của ứng viên được vượt mức nhỏ nhất đạt được trong các ứng viên của món chừng này. */
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
/** Dải hoà: ứng viên cùng số món chấp nhận, chi phí ≤ tốt nhất + chừng này được rút theo băm khoá nội dung (mọi vai, vòng 14). */
export const ANCHOR_BAND = 0.08;
/**
 * Vòng 14 — một đánh giá, không "mẫu cũ": luật thư viện cũ không còn chọn trước rồi để bộ chọn sửa (bỏ MIN_GAIN /
 * GOOD_COST / FAIL_COST, không còn mẫu đương nhiệm để giữ). Mẫu luật cũ (`SetMember.current` của món chưa ghim) chỉ là
 * phương án cuối khi không ứng viên nào qua ràng buộc cứng (`cause: 'fallback'`) và để sổ so (`from`).
 *
 * Cỡ người dùng đã xác nhận: mặt bằng hiển thị ≥ USER_FILL × hộp mỗi trục — người dùng thấy đúng cỡ đã xác nhận.
 */
export const USER_FILL = 0.9;
/** Ghế gom theo bàn: hộp bàn nở chừng này (m) chạm hộp ghế (chỗ kéo ghế của lớp bày phòng = 0,6 m). */
export const CHAIR_REACH_M = 0.6;
/**
 * Ghế cạnh bàn GỖ (ca xấu vòng 13: ghế trắng/xám lạnh cạnh sồi ấm): bàn của nhóm có gỗ ≥ PAIR_WOOD_SHARE bề mặt → phần
 * thân KHÔNG gỗ của ghế (không kim loại/kính) chấm đúng như phần gỗ (`woodDeltaOf`, WOOD_TOL, WOOD_DE_REF) so với gỗ bàn.
 * Trước đây chỉ phần GỖ của ghế được so: ghế trắng/xám không gỗ thì 0 phạt dù lệch hẳn bàn.
 */
export const PAIR_WOOD_SHARE = 0.5;
/**
 * Mẫu chung của nhóm (cùng vai trong phòng / quanh một bàn) chỉ dùng cho món mà nó không đắt hơn mẫu tốt nhất của CHÍNH món
 * quá chừng này — cùng mức nhiễu dữ liệu suy luận đo ở vòng 12 (chênh < 0,25 không phân biệt được trên ảnh, MIN_GAIN cũ).
 * Không có trần này, "lọt nhiều món nhất" từng kéo cả bộ ghế về một mẫu chi phí 4,2 chỉ vì nó lọt một hộp dò lỗi.
 */
export const SHARE_BAND = 0.25;
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
/** Món ngồi gom theo bàn (ghế ăn, ghế băng) và vai bàn của nhóm. */
const SEAT_GROUP_ROLES: ReadonlySet<string> = new Set(['diningChair', 'bench']);
const TABLE_ROLES: ReadonlySet<string> = new Set(['diningTable', 'desk']);

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
  /** Món ghim: mẫu đang dùng. Món chưa ghim: mẫu luật cũ — CHỈ là phương án cuối + để sổ so, không phải chuẩn. */
  readonly current: string | null;
  /** Ứng viên: mẫu thư viện của vai đã lọc QC/hướng, KHÔNG lọc theo cỡ luật cũ (rỗng = không đổi được). */
  readonly pool: readonly string[];
  /** Ghim (mẫu người dùng chọn, khe vật liệu, mẫu concept, twin của cặp đã nhận): không đổi, làm chuẩn. */
  readonly fixed: boolean;
  /** Loại đồ (`Furniture.kind`) — ghế kê dưới bàn/quầy không tính va chạm (`tuckedSeat`). */
  readonly kind?: string;
  /** Cao đã cho của món (m, `heightMm`); vắng = cao theo mẫu (chuẩn cao = trung vị pool vai). */
  readonly heightM?: number;
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
  /** Nguồn kích thước: lớp tự sinh / AI dò chưa xác nhận / người dùng đã xác nhận (hộp giữ nguyên, `USER_FILL`). */
  readonly sizeFrom?: 'generated' | 'ai' | 'user';
  /** Món nâng khỏi sàn (treo tường, đặt trên mặt khác): vẫn góp bảng màu, KHÔNG tính va chạm mặt sàn. */
  readonly lifted?: boolean;
  /** Độ nâng khỏi sàn (m); vắng = 0. Hở trần tính `liftM + cao hiển thị`. */
  readonly liftM?: number;
  /**
   * Twin của cặp đã nhận: mẫu đã lưu của món thật, chốt đúng lượt vai của món (không phải đồ cố định từ đầu) — anh em thấy
   * cùng ngữ cảnh như khi nó còn là đồ sinh; dẫn nhóm như món ghim.
   */
  readonly pinTo?: string;
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
/**
 * Vì sao món ra mẫu này (QA tách A/B/C): `selector` = đánh giá chọn mẫu khác luật cũ; `same` = đánh giá chọn trùng luật
 * cũ; `fallback` = không ứng viên qua ràng buộc cứng → luật cũ; `pinned` = món ghim, không chọn.
 */
export type SetCause = 'selector' | 'same' | 'fallback' | 'pinned';
export interface SetDecision {
  readonly id: string;
  readonly role: string;
  /** Mẫu luật cũ trong CÙNG catalog (món ghim: mẫu đang dùng). */
  readonly from: string | null;
  readonly to: string | null;
  /** `roomset` khi `to` ≠ `from`. */
  readonly rule: SetRule;
  readonly cause: SetCause;
  readonly anchor: boolean;
  /** Chi phí (nhỏ = hợp hơn) của mẫu được chọn. */
  readonly cost?: number;
  /** Chi phí mẫu luật cũ của CHÍNH món này trong cùng ngữ cảnh; vắng = mẫu luật cũ trượt ràng buộc cứng. */
  readonly fromCost?: number;
  /** Nguồn cỡ của món (`SetMember.sizeFrom`); `user` = đã xác nhận, mẫu tự chọn (người dùng ghim bằng cách đổi mẫu). */
  readonly by?: SetMember['sizeFrom'];
  /** Nhóm bộ: id bàn của nhóm ghế; vắng = cả phòng. */
  readonly group?: string;
  /** Số ứng viên trong pool của món. */
  readonly pool?: number;
  /** Lý do giữ / chọn (tiếng Việt, cho đầu dò). */
  readonly why: string;
  /** Đầu dò: số ứng viên trong tập bị loại theo từng lý do ràng buộc cứng (vắng = không bị loại cái nào). */
  readonly rejects?: Readonly<Record<string, number>>;
  /** Đầu dò: tối đa 3 ứng viên qua ràng buộc cứng rẻ nhất [mẫu, chi phí]. */
  readonly top?: readonly (readonly [string, number])[];
}

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

/** Trung vị (trên) cao mẫu (m) của pool vai — chuẩn cao khi món không cho `heightMm` (nhớ theo mảng pool). */
const MEDIAN_H = new WeakMap<readonly string[], number | undefined>();
const poolMedianHOf = (m: SetMember, ctx: SetContext): number | undefined => {
  if (MEDIAN_H.has(m.pool)) return MEDIAN_H.get(m.pool);
  const hs = m.pool.flatMap((x) => {
    const d = ctx.dimsOf(x);
    return d === undefined ? [] : [d[1]];
  });
  hs.sort((a, b) => a - b);
  const median = hs.length === 0 ? undefined : (hs[Math.floor(hs.length / 2)] as number);
  MEDIAN_H.set(m.pool, median);
  return median;
};

/**
 * Lý do loại cứng của mẫu `folder` cho món `m`; `undefined` = đạt. Vòng 14: mọi ràng buộc là TUYỆT ĐỐI (hộp, tỉ lệ thật,
 * chuẩn cao của vai, trần) — không so với mẫu luật cũ.
 */
export const hardRejectOf = (m: SetMember, folder: string, ctx: SetContext): string | undefined => {
  const q = (ctx.qualityOf ?? defaultQualityOf)(folder);
  if (q === undefined) return 'thiếu dữ liệu chất lượng';
  if (q.role !== m.role) return 'sai vai';
  if ((q.issues ?? []).length > 0) return 'có lỗi QC';
  if (q.front.check !== 'ok') return 'mặt trước chưa tin';
  if (q.parts === undefined || q.parts.length === 0) return 'thiếu dữ liệu phần';
  if (BED_ROLES.has(m.role) && q.completeness?.v !== 'full') return 'giường chưa hoàn chỉnh';
  const dims = ctx.dimsOf(folder);
  if (dims === undefined) return 'không lọt chỗ';
  // Cỡ HIỂN THỊ (đúng phép co dựng cảnh `itemFitOf`, luôn nằm trong hộp); test thuần không có thì theo cỡ catalog.
  const shown = m.shownOf?.(folder);
  if (m.shownOf !== undefined) {
    if (shown === undefined) return 'không tính được cỡ hiển thị';
    if (m.box !== undefined && (shown[0] > m.box.w + SHOWN_TOL_M || shown[2] > m.box.d + SHOWN_TOL_M)) return 'vượt hộp chỗ đặt';
    const g = scaleOf(dims, shown);
    if (g !== undefined && (g < SCALE_MIN || g > SCALE_MAX)) return 'sai tỉ lệ thật';
    // Méo dáng: hai trục mặt bằng co/giãn lệch nhau quá dải mà chính `itemFitOf` cho phép (SCALE_MAX/SCALE_MIN) — hộp hẹp
    // hơn mẫu trên một trục thì trục ấy bị bóp không chặn dưới (hộp dò 1,16 × 0,29 m: ghế bị kéo 1,37 và bóp 0,48).
    if (dims[0] > 0 && dims[2] > 0) {
      const sx = shown[0] / dims[0];
      const sz = shown[2] / dims[2];
      if (Math.max(sx, sz) / Math.min(sx, sz) > SCALE_MAX / SCALE_MIN + 1e-9) return 'méo dáng';
    }
    if (m.sizeFrom === 'user' && m.box !== undefined && (shown[0] < m.box.w * USER_FILL || shown[2] < m.box.d * USER_FILL)) return 'không giữ cỡ người dùng';
  } else if (!fitsSpot(dims, m.short, m.long)) return 'không lọt chỗ';
  const h = shown?.[1] ?? dims[1];
  // Chuẩn cao: cao đã cho, không thì trung vị pool vai; chuẩn ≥ TALL_M (tủ áo, kệ) thì không cao hơn chuẩn.
  const hRef = m.heightM ?? poolMedianHOf(m, ctx);
  if (hRef !== undefined && h > hRef * (hRef >= TALL_M ? 1 : HEIGHT_GROW_MAX) + 1e-9) return 'cao hơn chuẩn vai';
  if (m.ceilingM !== undefined && (m.liftM ?? 0) + h > m.ceilingM - CEILING_GAP_M) return 'chạm gần trần';
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
  /** Phần thân KHÔNG gỗ (không kim loại/kính): chấm như gỗ so với gỗ bàn của nhóm ghế (`PAIR_WOOD_SHARE`). */
  readonly body: readonly QualityPart[];
  /** Tổng tỉ phần tông gỗ. */
  readonly woodShare: number;
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
    body: other.filter((p) => p.kind !== 'metal' && p.kind !== 'glass' && p.material !== 'metal' && p.material !== 'glass'),
    woodShare: share,
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
  readonly pair: number;
  readonly total: number;
}

/** Ngữ cảnh chấm một món: gỗ tham chiếu + họ nhấn đã có trong phòng (tường, đồ cố định, món đã chọn). */
interface ItemRefs {
  readonly wood: Lab;
  readonly families: readonly number[];
  readonly anchor: boolean;
  /** L* tham chiếu của bề mặt cứng đồ cố định + đã chốt trong phòng; vắng = phòng chưa có đồ nào để so. */
  readonly hardL?: number;
  /** Gỗ của bàn trong nhóm ghế khi bàn có gỗ ≥ PAIR_WOOD_SHARE (`PAIR_*`); vắng = không áp. */
  readonly pair?: Lab;
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
  const pairLab = refs.pair;
  const pair =
    pairLab === undefined ? 0 : W_WOOD * f.body.reduce((s, p) => s + (p.share * Math.max(0, woodDeltaOf(p.lab, pairLab) - WOOD_TOL)) / WOOD_DE_REF, 0);
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
    pair,
    total: style + wood + soft + dark + fabric + layer + mirror + contrast + pair,
  };
};

/** Gỗ tham chiếu theo tông: tông của căn, vắng thì theo sáng/tối của bảng màu. */
const toneWoodOf = (palette: SetPalette): Lab => WOOD_LAB[palette.tone ?? (palette.light === false ? 'd' : 'l')];
/** Họ nhấn của tường (tường có màu) — điểm xuất phát của họ nhấn phòng. */
const wallFamiliesOf = (palette: SetPalette): number[] =>
  palette.wall !== undefined && isLoud(palette.wall) ? [hueOf(palette.wall)] : [];

/**
 * Thứ tự NỘI DUNG (Codex SEL-1 #4): vị trí + cỡ hộp, id chỉ phá hoà cuối — đổi id (chép dự án) giữ cùng thứ tự cộng dồn,
 * cùng thứ tự chốt món và cùng thứ hạng nhóm.
 */
const byPlace = (a: SetMember, b: SetMember): number =>
  (a.box?.cx ?? 0) - (b.box?.cx ?? 0) ||
  (a.box?.cy ?? 0) - (b.box?.cy ?? 0) ||
  (a.box?.w ?? a.long) - (b.box?.w ?? b.long) ||
  (a.box?.d ?? a.short) - (b.box?.d ?? b.short) ||
  a.id.localeCompare(b.id);
/** Làm tròn chi phí trước khi so/sắp: tổng dấu phẩy động theo thứ tự khác nhau không được lật dải hoà. */
const r9 = (x: number): number => Math.round(x * 1e9) / 1e9;

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

/** Vùng chặn trên mặt bằng (m): đồ đứng sàn ngoài bộ, vùng mở cửa đi, thân tường; `kind` = loại đồ (`tuckedSeat`). */
export type SetZone = PlanRect & { readonly kind?: string };
/** Ghế kê dưới bàn/quầy chồng hình hợp lệ — không tính va chạm. */
const tucked = (a: string | undefined, b: string | undefined): boolean =>
  a !== undefined && b !== undefined && tuckedSeat({ kind: a } as Pick<Furniture, 'kind'>, { kind: b } as Pick<Furniture, 'kind'>);
const boxRectOf = (b: SetBox): PlanRect => planRectOf(b.cx, b.cy, b.w, b.d, b.rot);

/**
 * Bộ của một phòng — MỘT đánh giá cho mọi món chưa ghim (vòng 14). `roomKey` = khoá nội dung (`roomSetKeysOf`), chỉ để
 * băm rút neo. `decided` = món đã chốt ở lượt trước trong cùng lượt dựng (giữ, làm ngữ cảnh). `zones` = vùng chặn (m) của
 * phòng. Trả quyết định cho mọi món của bộ (món ghim: `cause: 'pinned'`).
 *
 * Thứ tự: vai neo, rồi `SET_ROLES`; ghế ăn/ghế băng gom theo bàn (hộp bàn nở `CHAIR_REACH_M` chạm hộp ghế), vai khác một
 * nhóm mỗi phòng. Mỗi nhóm: mẫu ghim/đã chốt trong nhóm → mẫu chung; không thì mẫu lọt NHIỀU món nhất rồi chi phí trung
 * bình nhỏ nhất (hoà trong dải ANCHOR_BAND: rút theo băm khoá nội dung, mọi vai). Món không lọt mẫu chung chọn riêng. Không ứng viên → mẫu luật
 * cũ (`fallback`). "Lọt" = qua `hardRejectOf` VÀ va chạm: chồng của mặt bằng hiển thị với vùng chặn + đồ ghim + món đã
 * chốt (mặt bằng hiển thị) + món chưa chốt (cả hộp) ≤ mức nhỏ nhất đạt được trong các ứng viên của món +
 * ROOM_OVERLAP_TOL_M2 (mặt bằng ⊆ hộp, nên hộp không chồng gì thì va chạm không loại ứng viên nào).
 *
 * Gỗ tham chiếu: bàn của nhóm ghế → gỗ đồ cố định → gỗ của neo (món phụ) → tông của căn. Chi phí = `itemCostOf` + phạt
 * tỉ lệ SCALE_W × (|ln sx| + |ln sz|)/2 trong hộp của chính món.
 */
export const roomSetOf = (
  roomKey: string,
  members: readonly SetMember[],
  decided: ReadonlyMap<string, SetDecision>,
  ctx: SetContext,
  zones: readonly SetZone[] = [],
): Map<string, SetDecision> => {
  const inSet = members.filter((m) => SET_ROLES.includes(m.role)).sort(byPlace);
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
  const tables = inSet.filter((m) => TABLE_ROLES.has(m.role) && m.box !== undefined);
  /** Bàn của ghế: bàn gần tâm nhất mà hộp nở CHAIR_REACH_M chạm hộp ghế; vắng = ghế lẻ. */
  const tableOf = (m: SetMember): SetMember | undefined => {
    const b = m.box;
    if (b === undefined || !SEAT_GROUP_ROLES.has(m.role)) return undefined;
    const near = tables.filter((t) => rectsOverlap(boxRectOf(t.box as SetBox), boxRectOf(b), CHAIR_REACH_M));
    const dist = (t: SetMember): number => Math.hypot((t.box as SetBox).cx - b.cx, (t.box as SetBox).cy - b.cy);
    return near.sort((x, y) => dist(x) - dist(y) || x.id.localeCompare(y.id))[0];
  };
  const out = new Map<string, SetDecision>();
  for (const m of inSet) {
    if (!m.fixed) continue;
    out.set(m.id, {
      id: m.id,
      role: m.role,
      from: m.current,
      to: m.current,
      rule: 'keep',
      cause: 'pinned',
      anchor: m.role === anchorRole,
      ...(m.sizeFrom === undefined ? {} : { by: m.sizeFrom }),
      ...(tableOf(m) === undefined ? {} : { group: (tableOf(m) as SetMember).id }),
      pool: m.pool.length,
      why: m.current === null ? 'món ghim: mẫu ngoài thư viện, giữ chỗ bằng cả hộp' : 'món ghim: giữ mẫu đang dùng',
    });
  }
  // Vùng chặn của lượt: `zones` + mặt bằng hiển thị của đồ ghim và món đã chốt (thêm sau mỗi vai).
  const placed: SetZone[] = [...zones];
  const placeOf = (m: SetMember, folder: string): void => {
    const r = m.lifted === true ? undefined : shownRectOf(m, folder);
    if (r !== undefined) placed.push(m.kind === undefined ? r : { ...r, kind: m.kind });
  };
  for (const m of inSet) {
    const f = folderOfFixed(m);
    if (f !== null) placeOf(m, f);
    // Codex SEL-1 #1: món ghim có mẫu ngoài thư viện (`current` null) vẫn chiếm chỗ — giữ bằng cả hộp.
    else if (m.fixed && m.lifted !== true && m.box !== undefined) placed.push(m.kind === undefined ? boxRectOf(m.box) : { ...boxRectOf(m.box), kind: m.kind });
  }
  /** Phạt tỉ lệ của mẫu trong hộp của món (0 khi không có cỡ hiển thị): méo một trục cũng bị phạt. */
  const scaleCostOf = (m: SetMember, folder: string): number => {
    const d = ctx.dimsOf(folder);
    const s = m.shownOf?.(folder);
    if (d === undefined || s === undefined || d[0] <= 0 || d[2] <= 0) return 0;
    return (SCALE_W * (Math.abs(Math.log(s[0] / d[0])) + Math.abs(Math.log(s[2] / d[2])))) / 2;
  };
  /** Ứng viên lọt của món: mẫu → chi phí (qua ràng buộc cứng + va chạm), lý do loại theo số lượng. */
  const evalOf = (m: SetMember, costFor: (m: SetMember, f: string) => number) => {
    const rejects: Record<string, number> = {};
    const box = m.box;
    // Món bộ CHƯA chốt (kể cả cùng vai) giữ chỗ bằng cả hộp của nó (mặt bằng ⊆ hộp: bảo thủ).
    const pending: SetZone[] = inSet.flatMap((x) =>
      x === m || x.fixed || x.lifted === true || x.box === undefined || decided.has(x.id) || out.has(x.id)
        ? []
        : [x.kind === undefined ? boxRectOf(x.box) : { ...boxRectOf(x.box), kind: x.kind }],
    );
    const near = box === undefined || m.lifted === true ? [] : [...placed, ...pending].filter((z) => !tucked(m.kind, z.kind) && rectsOverlap(boxRectOf(box), z));
    const ok: { f: string; cost: number; hit: number }[] = [];
    for (const f of m.pool) {
      const r = hardRejectOf(m, f, ctx);
      if (r !== undefined) {
        rejects[r] = (rejects[r] ?? 0) + 1;
        continue;
      }
      const rect = near.length === 0 ? undefined : shownRectOf(m, f);
      const hit = rect === undefined ? 0 : near.reduce((s, z) => s + overlapAreaM2(rect, z), 0);
      ok.push({ f, cost: costFor(m, f), hit });
    }
    const minHit = Math.min(...ok.map((o) => o.hit));
    const pass = new Map<string, number>();
    for (const o of ok) {
      if (o.hit <= minHit + ROOM_OVERLAP_TOL_M2) pass.set(o.f, o.cost);
      else rejects['va chạm'] = (rejects['va chạm'] ?? 0) + 1;
    }
    return { pass, rejects };
  };

  for (const role of roles) {
    const group = inSet.filter((m) => m.role === role);
    const todo = group.filter((m) => !m.fixed && !decided.has(m.id));
    if (todo.length === 0) continue;
    const anchor = role === anchorRole;
    const keyOf = new Map(group.map((m) => [m.id, tableOf(m)?.id ?? ''] as const));
    /** Ngữ cảnh chấm theo nhóm (bàn của nhóm ghế): gỗ tham chiếu + gỗ bàn cho `pair`. */
    const refsOf = (key: string): ItemRefs => {
      const table = key === '' ? undefined : inSet.find((m) => m.id === key);
      const tableFolder = table === undefined ? null : (out.get(table.id)?.to ?? folderOfFixed(table) ?? table.current);
      const tf = tableFolder === null ? undefined : featOf(tableFolder, ctx, memo);
      return {
        wood:
          tf?.woodLab ??
          (SEAT_GROUP_ROLES.has(role) ? woodByRole.get('diningTable') : undefined) ??
          fixedWood ??
          (anchor ? undefined : anchorWood) ??
          toneWoodOf(ctx.palette),
        families,
        anchor,
        ...(hardShare > 0 ? { hardL: hardSum / hardShare } : {}),
        ...(tf?.woodLab !== undefined && tf.woodShare >= PAIR_WOOD_SHARE ? { pair: tf.woodLab } : {}),
      };
    };
    const evals = new Map(
      todo.map((m) => {
        const refs = refsOf(keyOf.get(m.id) ?? '');
        return [m.id, evalOf(m, (x, f) => itemCostOf(f, role, refs, ctx, memo).total + scaleCostOf(x, f))] as const;
      }),
    );
    const passOf = (m: SetMember): ReadonlyMap<string, number> => evals.get(m.id)?.pass ?? new Map<string, number>();
    const ownBest = new Map(todo.map((m) => [m.id, Math.min(...passOf(m).values())] as const));
    /** Mẫu `f` CHẤP NHẬN được cho món: lọt và không đắt hơn mẫu tốt nhất của chính món quá SHARE_BAND. */
    const okFor = (m: SetMember, f: string): boolean => {
      const c = passOf(m).get(f);
      return c !== undefined && c <= (ownBest.get(m.id) ?? Infinity) + SHARE_BAND + 1e-9;
    };
    /** Mẫu chấp nhận được cho NHIỀU món nhất của `list`, rồi chi phí trung bình nhỏ nhất; neo rút trong dải theo băm. */
    const bestFor = (list: readonly SetMember[], hashKey: string): { f: string; n: number; band: number } | undefined => {
      const ranked = [...new Set(list.flatMap((m) => [...passOf(m).keys()]))]
        .map((f) => {
          const costs = list.flatMap((m) => (okFor(m, f) ? [passOf(m).get(f) as number] : []));
          return { f, n: costs.length, cost: r9(costs.reduce((s, c) => s + c, 0) / costs.length) };
        })
        .filter((r) => r.n > 0)
        .sort((a, b) => b.n - a.n || a.cost - b.cost || a.f.localeCompare(b.f));
      const best = ranked[0];
      if (best === undefined) return undefined;
      // Hoà trong nhiễu (≤ ANCHOR_BAND, cùng số món chấp nhận): rút theo băm khoá NỘI DUNG (phòng/nhóm/món), mọi vai —
      // tất định, không ép đa dạng; chỉ bỏ việc "tên thư mục nhỏ nhất thắng ở mọi phòng".
      const band = ranked.filter((r) => r.n === best.n && r.cost <= r9(best.cost + ANCHOR_BAND)).sort((a, b) => a.f.localeCompare(b.f));
      return { f: (band[fnv1a(hashKey) % band.length] as { f: string }).f, n: best.n, band: band.length };
    };
    // Mẫu chung cả phòng; nhóm (bàn) dùng nó khi nó chấp nhận được cho MỌI món của nhóm, không thì mẫu chung của nhóm.
    // Khoá băm theo nội dung, không theo id (chép dự án sinh id mới): thứ hạng vị trí của bàn / món trong phòng.
    const tableRank = new Map([...tables].sort(byPlace).map((t, i) => [t.id, i] as const));
    const groupHash = (key: string): string => `${roomKey}|${role}|g${key === '' ? '-' : (tableRank.get(key) ?? '?')}`;
    const roomShared = bestFor(todo, `${roomKey}|${role}`);
    const keys = [...new Set(todo.map((m) => keyOf.get(m.id) ?? ''))];
    for (const key of keys) {
      const todoG = todo.filter((m) => keyOf.get(m.id) === key);
      const pinned = group
        .filter((m) => keyOf.get(m.id) === key)
        .map((m) => folderOfFixed(m) ?? m.pinTo ?? null)
        .find((f): f is string => f !== null);
      const roomOk = roomShared !== undefined && todoG.every((m) => okFor(m, roomShared.f));
      const shared = pinned !== undefined ? { f: pinned, n: 0, band: 1 } : roomOk ? roomShared : bestFor(todoG, groupHash(key));
      // Món không hợp mẫu chung: gom tiếp thành mẫu chung thứ hai, thứ ba… của phần còn lại (ít kiểu nhất trong nhóm).
      const restPick = new Map<string, { f: string; n: number; band: number }>();
      let rest = todoG.filter((m) => shared === undefined || !(pinned !== undefined ? passOf(m).has(shared.f) : okFor(m, shared.f)));
      for (let round = 2; rest.length > 0; round += 1) {
        const next = bestFor(rest, `${groupHash(key)}|r${round}`);
        if (next === undefined) break;
        for (const m of rest) if (okFor(m, next.f)) restPick.set(m.id, next);
        rest = rest.filter((m) => !restPick.has(m.id));
      }
      for (const m of todoG) {
        const ev = evals.get(m.id) ?? { pass: new Map<string, number>(), rejects: {} };
        const fromCost = m.current === null ? undefined : ev.pass.get(m.current);
        const top = [...ev.pass]
          .sort((a, b) => a[1] - b[1] || a[0].localeCompare(b[0]))
          .slice(0, 3)
          .map(([f, c]) => [f, +c.toFixed(3)] as const);
        // Mẫu ghim của nhóm: chỉ cần lọt; mẫu chung: phải chấp nhận được cho chính món.
        const sharedOk = shared !== undefined && (pinned !== undefined ? ev.pass.has(shared.f) : okFor(m, shared.f));
        const pick = m.pinTo !== undefined ? { f: m.pinTo, n: 0, band: 1 } : sharedOk ? shared : restPick.get(m.id);
        const cost = pick === undefined ? undefined : ev.pass.get(pick.f);
        const old = fromCost === undefined ? 'luật cũ trượt/không có' : `luật cũ ${fromCost.toFixed(2)}`;
        const via =
          sharedOk && pinned !== undefined
            ? 'cùng mẫu món ghim/đã chốt của nhóm'
            : sharedOk && todo.length > 1
              ? `mẫu chung ${roomOk ? 'phòng' : 'nhóm'} (chấp nhận ${shared.n}/${roomOk ? todo.length : todoG.length})`
              : anchor
                ? `neo, dải ${pick?.band ?? 0}`
                : todo.length > 1
                  ? `mẫu chung không hợp món: mẫu chung phụ (chấp nhận ${pick?.n ?? 0})`
                  : 'tốt nhất';
        const to = pick === undefined ? m.current : pick.f;
        out.set(m.id, {
          id: m.id,
          role,
          from: m.current,
          to,
          rule: to === m.current ? 'keep' : 'roomset',
          cause: m.pinTo !== undefined ? 'pinned' : pick === undefined ? 'fallback' : to === m.current ? 'same' : 'selector',
          anchor,
          ...(cost === undefined ? {} : { cost }),
          ...(fromCost === undefined ? {} : { fromCost }),
          ...(m.sizeFrom === undefined ? {} : { by: m.sizeFrom }),
          ...(key === '' ? {} : { group: key }),
          pool: m.pool.length,
          why: cost === undefined ? 'không ứng viên qua ràng buộc cứng — mẫu luật cũ' : `${via}; ${cost.toFixed(2)} (${old})`,
          ...(Object.keys(ev.rejects).length > 0 ? { rejects: ev.rejects } : {}),
          ...(top.length > 0 ? { top } : {}),
        });
        if (to !== null) placeOf(m, to);
      }
    }
    for (const m of todo) {
      const to = out.get(m.id)?.to;
      if (to === null || to === undefined) continue;
      const feat = featOf(to, ctx, memo);
      if (anchor && anchorWood === undefined && feat.woodLab !== undefined) anchorWood = feat.woodLab;
      if (feat.woodLab !== undefined && !woodByRole.has(role)) woodByRole.set(role, feat.woodLab);
      families = familiesWith(families, feat.loud.map((p) => p.lab));
      addHard(to);
    }
  }
  return out;
};
