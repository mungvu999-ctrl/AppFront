/**
 * Bộ nội thất theo phòng (vòng 12, làn S) — hàm thuần; `sceneVariety.ts` dựng thành viên phòng rồi gọi `roomSetOf`.
 *
 * Gốc lỗi cũ: mỗi món chọn mẫu ĐỘC LẬP (`rankedLibraryPickOf` lấy mẫu đầu) → mọi phòng cùng một giường; thử nghiệm
 * `roomvariety` rút ngẫu nhiên trong hạng nên lệch tông, ra giường nệm trần, so màu bằng "gần mẫu cũ".
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
/** Dung sai mặt bằng HIỂN THỊ (m): ứng viên không rộng/sâu hơn mẫu cũ hiển thị quá chừng này trên từng trục. */
export const SHOWN_TOL_M = 0.02;
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
  if (shown !== undefined && shownRef !== undefined && (shown[0] > shownRef[0] + SHOWN_TOL_M || shown[2] > shownRef[2] + SHOWN_TOL_M))
    return 'lớn hơn mẫu cũ khi hiển thị';
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
  /** Tổng tỉ phần bề mặt tối đậm (L* < DARK_L). */
  readonly dark: number;
  /** Tổng tỉ phần bề mặt rất sáng (L* > BRIGHT_L). */
  readonly bright: number;
  /** Tổng tỉ phần bề mặt gương (`finish: 'mirror'`, trường tuỳ chọn của làn Q; vắng = 0). */
  readonly mirror: number;
  /** Số cụm màu vải tương phản (`LAYER_*`); vắng = không đo được (không có phần vải). */
  readonly layers?: number;
  /** Lab gỗ trung bình theo tỉ phần (tham chiếu cho món khác); vắng = không có gỗ. */
  readonly woodLab?: Lab;
}
type Memo = Map<string, Feat>;
const isWoodTone = (p: QualityPart): boolean => p.material === 'wood' && chromaOf(p.lab) >= WOOD_MIN_C;
/** Cụm màu vải tương phản của một mẫu (gom tham lam theo tỉ phần giảm dần). */
export const layersOf = (parts: readonly QualityPart[]): { layers?: number } => {
  const soft = parts.filter((p) => p.share >= LAYER_MIN_SHARE && !isWoodTone(p) && LAYER_KINDS.has(p.kind)).sort((a, b) => b.share - a.share);
  if (soft.length === 0) return {};
  const reps: Lab[] = [];
  for (const p of soft) if (!reps.some((r) => Math.hypot(r[0] - p.lab[0], r[1] - p.lab[1], r[2] - p.lab[2]) < LAYER_DE)) reps.push(p.lab);
  return { layers: reps.length };
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
    loud: other.filter((p) => chromaOf(p.lab) > NEUTRAL_C && p.share >= ACCENT_MIN_SHARE),
    other,
    dark: parts.reduce((s, p) => s + (p.lab[0] < DARK_L ? p.share : 0), 0),
    bright: parts.reduce((s, p) => s + (p.lab[0] > BRIGHT_L ? p.share : 0), 0),
    mirror: parts.reduce((s, p) => s + ((p as QualityPart & { readonly finish?: string }).finish === 'mirror' ? p.share : 0), 0),
    ...layersOf(parts),
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
  readonly total: number;
}

/** Ngữ cảnh chấm một món: gỗ tham chiếu + họ nhấn đã có trong phòng (tường, đồ cố định, món đã chọn). */
interface ItemRefs {
  readonly wood: Lab;
  readonly families: readonly number[];
  readonly anchor: boolean;
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
  const layer = LAYER_ROLES.has(role) && f.layers === 1 ? SINGLE_LAYER : 0;
  const mirror = MIRROR_PENALTY * f.mirror;
  return { style, wood, soft, dark, chroma: W_FABRIC * chroma, accent: W_FABRIC * accent, layer, mirror, total: style + wood + soft + dark + fabric + layer + mirror };
};

/** Gỗ tham chiếu theo tông: tông của căn, vắng thì theo sáng/tối của bảng màu. */
const toneWoodOf = (palette: SetPalette): Lab => WOOD_LAB[palette.tone ?? (palette.light === false ? 'd' : 'l')];
/** Họ nhấn của tường (tường có màu) — điểm xuất phát của họ nhấn phòng. */
const wallFamiliesOf = (palette: SetPalette): number[] =>
  palette.wall !== undefined && chromaOf(palette.wall) > NEUTRAL_C ? [hueOf(palette.wall)] : [];

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
/**
 * Bộ của một phòng. `roomKey` = khoá nội dung (`roomSetKeysOf`), chỉ dùng để băm rút neo. `decided` = món đã chốt ở
 * lượt trước trong cùng lượt dựng (giữ nguyên, làm ngữ cảnh). Trả quyết định cho mọi món trong phạm vi chưa chốt.
 * Thứ tự xử lý: vai neo, rồi `SET_ROLES`; trong vai theo id.
 *
 * Gỗ tham chiếu của món: món cặp (ghế ăn ↔ bàn ăn) → gỗ đồ CỐ ĐỊNH trong phòng → gỗ của neo (món phụ) → tông của căn.
 * Mẫu cũ qua ràng buộc cứng thắng trừ khi mẫu mới rẻ hơn ≥ MIN_GAIN trên chính món đó.
 */
export const roomSetOf = (
  roomKey: string,
  members: readonly SetMember[],
  decided: ReadonlyMap<string, SetDecision>,
  ctx: SetContext,
): Map<string, SetDecision> => {
  const inSet = members.filter((m) => SET_ROLES.includes(m.role)).sort(byId);
  const roles = SET_ROLES.filter((role) => inSet.some((m) => m.role === role));
  const anchorRole = roles[0];
  const memo: Memo = new Map();
  const folderOfFixed = (m: SetMember): string | null => (m.fixed ? m.current : (decided.get(m.id)?.to ?? null));
  // Bảng màu phòng: tường + đồ cố định/đã chốt (gỗ trung bình theo tỉ phần, họ nhấn).
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
    };
    const costOf = (folder: string): number => itemCostOf(folder, role, refs, ctx, memo).total;
    const fits = (m: SetMember, folder: string): boolean => hardRejectOf(m, folder, ctx) === undefined;
    /** Mẫu rẻ nhất cho các món `ms` (qua ràng buộc cứng của MỌI món trong `ms`); neo rút trong dải theo băm. */
    const bestFor = (ms: readonly SetMember[]): { f: string; cost: number; band: number } | undefined => {
      const ranked = [...new Set(ms.flatMap((m) => m.pool))]
        .filter((f) => ms.every((m) => m.pool.includes(f) && fits(m, f)))
        .sort()
        .map((f) => ({ f, cost: costOf(f) }))
        .sort((a, b) => a.cost - b.cost || a.f.localeCompare(b.f));
      const best = ranked[0];
      if (best === undefined) return undefined;
      const band = anchor ? ranked.filter((r) => r.cost <= best.cost + ANCHOR_BAND) : [best];
      return { ...(band[fnv1a(`${roomKey}|${role}`) % band.length] as { f: string; cost: number }), band: band.length };
    };
    // Mẫu chung của nhóm cùng vai: món cùng vai đã có mẫu (ghim / đã chốt), không thì mẫu tốt nhất lọt MỌI chỗ.
    const pinned = group.map(folderOfFixed).find((f): f is string => f !== null);
    const shared = pinned !== undefined ? { f: pinned, cost: costOf(pinned), band: 1 } : bestFor(todo);
    // Từng món quyết định RIÊNG (lượt 3): chỉ nhận mẫu qua ràng buộc cứng của chính nó VÀ hơn mẫu luật cũ của chính
    // nó ≥ MIN_GAIN (hoặc mẫu cũ trượt ràng buộc cứng); không thì giữ mẫu cũ của nó. Món cùng mẫu cũ ra cùng kết quả.
    for (const m of todo) {
      // Mẫu cũ: chỉ xét CHẤT LƯỢNG (hình học là hiện trạng). Đạt → so biên MIN_GAIN; trượt → trần FAIL_COST; chưa biết → GOOD_COST.
      const oldFail: OldFail | undefined = m.current === null ? 'unknown' : oldFailOf(m, m.current, ctx);
      const curCost = oldFail === undefined ? costOf(m.current as string) : Infinity;
      const cap = oldFail === undefined ? Infinity : oldFail === 'unknown' ? GOOD_COST : FAIL_COST;
      const old = oldFail === undefined ? curCost.toFixed(2) : `trượt: ${OLD_FAIL_VI[oldFail]}`;
      // Mẫu chung (kể cả mẫu ghim) phải nằm trong ĐÚNG tập ứng viên của món nhận (lọc cỡ/QC/hướng), không thì chấm riêng.
      const pick = shared !== undefined && m.pool.includes(shared.f) && fits(m, shared.f) ? shared : bestFor([m]);
      if (pick === undefined) {
        decide(m, m.current, anchor, 'không ứng viên qua ràng buộc cứng', undefined, curCost, oldFail);
      } else if (pick.cost > cap) {
        decide(m, m.current, anchor, `giữ: mẫu cũ ${old}; ứng viên tốt nhất ${pick.cost.toFixed(2)} > trần ${cap}`, curCost, curCost, oldFail);
      } else if (pick.cost <= curCost - MIN_GAIN) {
        const via = pick === shared && pinned !== undefined ? 'cùng mẫu món cùng vai đã có' : anchor ? `neo, dải ${pick.band}` : 'hợp bộ';
        decide(m, pick.f, anchor, `${via}; ${pick.cost.toFixed(2)} < cũ ${old}`, pick.cost, curCost, oldFail);
      } else {
        decide(m, m.current, anchor, `mẫu mới không hơn rõ (tốt nhất ${pick.cost.toFixed(2)}, cũ ${old})`, curCost, curCost, oldFail);
      }
    }
    for (const m of todo) {
      const to = out.get(m.id)?.to;
      if (to === null || to === undefined) continue;
      const feat = featOf(to, ctx, memo);
      if (anchor && anchorWood === undefined && feat.woodLab !== undefined) anchorWood = feat.woodLab;
      if (feat.woodLab !== undefined && !woodByRole.has(role)) woodByRole.set(role, feat.woodLab);
      families = familiesWith(families, feat.loud.map((p) => p.lab));
    }
  }
  return out;
};
