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

import { WALL_BACK_ROLES } from './itemFit';
import { qualityOf as defaultQualityOf, type ModelQuality, type PartMaterial, type QualityPart } from './libraryQuality';
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
 * Phạm vi CÔNG NĂNG theo vai (vòng 17, m): cỡ HIỂN THỊ [rộng mặt trước W, sâu D, cao tổng H]; `sy` = hệ số cao hiển thị
 * (đồ ngồi: giữ cao ngồi 0,40–0,50); `edges` = W/D là cạnh ngắn/dài (bàn). Căn cứ: Neufert, Panero-Zelnik (ghế ăn ngồi
 * 0,43–0,48, bàn ăn/làm việc 0,72–0,76, bàn trà 0,35–0,50, giường đôi ≥ 1,35 × 1,9, giường đơn 0,9–1,2 × 1,9–2,0, sofa
 * ≥ 1,4, tủ áo sâu ≥ 0,50 — p10 catalog 510); catalog useMm ở cỡ thật lọt 78–100 % mỗi vai (F:/runs/m17/A/KET-QUA.txt §2).
 */
type Span = readonly [number, number];
const ANY: Span = [0, Infinity];
export const FUNC_RANGE: Readonly<Record<string, { readonly w: Span; readonly d: Span; readonly h: Span; readonly sy?: Span; readonly edges?: true }>> = {
  doubleBed: { w: [1.35, 2.2], d: [1.9, 2.45], h: ANY },
  singleBed: { w: [0.85, 1.3], d: [1.85, 2.3], h: ANY },
  sofa: { w: [1.4, Infinity], d: [0.75, 1.15], h: [0.65, 1.05], sy: [0.9, 1.1] },
  armchair: { w: [0.58, 1.15], d: [0.6, 1.1], h: [0.65, 1.15], sy: [0.9, 1.1] },
  diningChair: { w: [0.38, 0.65], d: [0.4, 0.68], h: [0.65, 1.1], sy: [0.9, 1.1] },
  bench: { w: [0.4, 2], d: [0.3, 0.7], h: [0.38, 0.52] },
  diningTable: { w: [0.7, 1.3], d: [0.7, 2.6], h: [0.7, 0.79], edges: true },
  desk: { w: [0.8, 2], d: [0.45, 0.9], h: [0.65, 0.8] },
  coffeeTable: { w: ANY, d: [0.5, 1.5], h: [0.3, 0.52], edges: true },
  nightstand: { w: [0.35, 0.7], d: [0.3, 0.55], h: [0.4, 0.75] },
  closet: { w: [0.45, 3.6], d: [0.5, 0.7], h: [1.75, 2.45] },
  dresser: { w: [0.5, 2], d: [0.35, 0.65], h: [0.5, 1.35] },
  bookshelf: { w: [0.5, 2], d: [0.25, 0.5], h: [0.8, 2.3] },
  cabinet: { w: [0.4, 2], d: [0.3, 0.6], h: [0.5, 1.25] },
};
const FUNC_EPS = 1e-6;
/**
 * Dung sai kích thước hiển thị (rộng/sâu/cao) quanh phạm vi công năng: chỉ trượt khi dưới min × 0,9 hoặc trên max × 1,1.
 * Ràng buộc nhắm đồ bị CO thành đồ thu nhỏ (s ~0,5–0,7), không nhắm sai lệch ±10 % của hộp AI / catalog (điều phối M17-2:
 * 44/47 `to: null` phát lại 18 căn là tủ sâu 437–496 mm, kệ 602–690 mm…). Phạm vi gốc (FUNC_RANGE) giữ nguyên.
 */
export const FUNC_TOL = 0.1;
export const FUNC_REJECT = 'ngoài công năng';
/**
 * Lý do "ngoài công năng" của cỡ hiển thị `shown` [rộng, cao, sâu] (mẫu cỡ thật `dims`) cho vai `role`; `undefined` = trong
 * phạm vi / vai không có bảng. Ràng buộc CỨNG: không thuộc CONCEPT_LENIENT (concept co đều cũng bị kiểm) lẫn SHAPE_REJECTS
 * (luật cũ không được giữ khi ngoài công năng).
 */
export const functionalMissOf = (role: string, dims: Dims, shown: Dims): string | undefined => {
  const r = FUNC_RANGE[role];
  if (r === undefined) return undefined;
  const [w, d] = r.edges === true ? [Math.min(shown[0], shown[2]), Math.max(shown[0], shown[2])] : [shown[0], shown[2]];
  const out = (v: number, [lo, hi]: Span, tol = 0): boolean => v < lo * (1 - tol) - FUNC_EPS || v > hi * (1 + tol) + FUNC_EPS;
  const mm = (v: number): string => (Number.isFinite(v) ? `${Math.round(v * 1000)}` : '∞');
  if (out(w, r.w, FUNC_TOL)) return `rộng ${mm(w)} mm ngoài ${mm(r.w[0])}–${mm(r.w[1])}`;
  if (out(d, r.d, FUNC_TOL)) return `sâu ${mm(d)} mm ngoài ${mm(r.d[0])}–${mm(r.d[1])}`;
  if (out(shown[1], r.h, FUNC_TOL)) return `cao ${mm(shown[1])} mm ngoài ${mm(r.h[0])}–${mm(r.h[1])}`;
  const sy = dims[1] > 0 ? shown[1] / dims[1] : 1;
  if (r.sy !== undefined && out(sy, r.sy)) return `hệ số cao ${sy.toFixed(2)} ngoài ${r.sy[0]}–${r.sy[1]}`;
  return undefined;
};
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
/**
 * Ngưỡng hỏng (vòng 12, chấm ảnh mù 9 căn: mẫu được khen 0,00–0,04, mẫu bị chê thấp nhất 0,98, còn lại 1,24–3,76). Vòng 14
 * đã bỏ nó cùng mẫu đương nhiệm; chấm mù vòng 14 (f-22, f-14 phòng ngủ nhỏ) cho thấy cần lại: khi mẫu TỐT NHẤT qua ràng buộc
 * cứng vẫn đắt hơn chừng này, đánh giá không có gì đáng chọn — giữ mẫu luật cũ (`cause: 'fail-keep'`), mọi vai.
 */
export const FAIL_COST = 0.9;
/**
 * Mẫu dựng CỠ THẬT (`uniform: 'real'`) được vượt hộp AI chưa xác nhận tối đa chừng này (m) MỖI trục mặt bằng — cỡ sai số dò
 * hộp. Vượt hơn nghĩa là hộp không phải món của vai ấy cỡ thường (điều phối M17-4, cn08: hộp cỡ ghế bành dựng sofa 2 m chắn
 * lối đi cạnh cửa; lối đi không phải vùng chặn nên kiểm va chạm không bắt) → không dựng cỡ thật, khung giữ chỗ.
 */
export const REAL_GROW_M = 0.4;
/*
 * Chính sách "không làm tệ hơn hiện trạng" (điều phối 12/11, mở rộng M17-4): không ứng viên nào ≤ FAIL_COST mà mẫu luật cũ
 * chỉ trượt lý do MỀM (không bị `forbiddenOf` cấm, không chồng vùng chặn thêm) → giữ mẫu luật cũ (`fail-keep`, "hiện trạng,
 * trượt hình dáng"). Xem `evalOf` (legacyShape).
 */
/**
 * Lý do hình dáng NHẸ không loại mẫu concept (điều phối 13/11): concept chỉ bị loại vì chất lượng/an toàn (giường chưa
 * hoàn chỉnh, vân vỡ, QC, va chạm, trần, méo dáng); lệch tỉ lệ/cỡ so với hộp thì giữ và dựng CO ĐỀU.
 */
/**
 * Hệ số co đều nhỏ nhất của concept: co dưới nửa cỡ thật (hoặc hệ số không hữu hạn / ≤ 0) là "co quá nhỏ" — concept
 * trượt (Codex M16-3 #3). Không phải hằng chi phí.
 */
export const UNIFORM_MIN = 0.5;
export const CONCEPT_LENIENT: ReadonlySet<string> = new Set(['sai tỉ lệ thật', 'vượt hộp chỗ đặt', 'cao hơn chuẩn vai', 'nhỏ hơn cỡ vai', 'không giữ cỡ người dùng']);
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
/**
 * Hợp bộ khách (vòng 17): sofa / ghế bành / bàn trà chấm thêm độ lệch với BẢNG MÀU BỘ (`SetRef`: món ghim + đã chốt +
 * concept còn giữ + đồ đứng sàn ngoài bộ có mẫu) — chỉ khi phòng có sofa (bộ ghế khách); phòng ngủ, bàn ăn không đổi.
 */
const SET_FIT_ROLES: ReadonlySet<string> = new Set(['sofa', 'armchair', 'coffeeTable']);
/** Phạt khác chất liệu bọc chính (da/vải) với chất liệu bọc trội của bộ: bằng một phần thân lệch hẳn tông ở tỉ phần ACCENT_MIN_SHARE. */
export const SET_MAT_MISMATCH = 0.15;
/** Tỉ lệ cặp với sofa của phòng (cỡ catalog): ghế bành cao ≤ ×ARM_H_MAX, rộng ≤ ×ARM_W_MAX; bàn trà rộng ≤ ×TABLE_W_MAX. Vượt: SCALE_W × ln(vượt). */
export const ARM_H_MAX = 1.1;
export const ARM_W_MAX = 0.75;
export const TABLE_W_MAX = 0.7;

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
  /** Mẫu dựng sẵn của vai (thủ tục, không thư viện): phương án cuối khi luật cũ trượt dáng/công năng/chất lượng (I2 vòng 17). */
  readonly stock?: string;
  /** Ứng viên: mẫu thư viện của vai đã lọc QC/hướng, KHÔNG lọc theo cỡ luật cũ (rỗng = không đổi được). */
  readonly pool: readonly string[];
  /** Ghim (mẫu người dùng chọn, khe vật liệu, twin của cặp đã nhận): không đổi, làm chuẩn. Mẫu concept không phải ghim. */
  readonly fixed: boolean;
  /**
   * Mẫu concept AI chọn cho vai (món chưa ghim): ứng viên ƯU TIÊN — qua mọi ràng buộc cứng của món (như `pool`, kể cả va
   * chạm) thì chọn nó không so chi phí (`cause: 'concept'`); không qua thì đi đường chọn bình thường. `reject` = lý do bên
   * gọi đã biết là trượt (QC loại).
   */
  readonly concept?: {
    readonly folder: string;
    readonly reject?: string;
    /** Cỡ hiển thị khi CO ĐỀU (`itemFitOf` uniform) — dùng khi concept chỉ lệch tỉ lệ hộp (`CONCEPT_LENIENT`). */
    readonly shownOf?: (folder: string) => Dims | undefined;
  };
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
  /**
   * F8 (vòng 17): vai NHỎ HƠN cùng nhóm đồ chứa (tủ áo → kệ cao / tủ ngăn kéo; tủ thấp → tủ đầu giường) + pool của vai ấy —
   * tầng cuối khi không mẫu nào của vai vừa hộp AI ở cỡ thật ("không vừa → mẫu nhỏ hơn đúng loại", không thu nhỏ món).
   */
  readonly smaller?: readonly { readonly role: string; readonly pool: readonly string[] }[];
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
 * cũ; `fallback` = không ứng viên qua ràng buộc cứng → luật cũ; `pinned` = món ghim, không chọn; `concept` = mẫu concept
 * AI qua mọi ràng buộc cứng của món, chọn không so chi phí.
 */
export type SetCause = 'selector' | 'same' | 'fallback' | 'fail-keep' | 'pinned' | 'concept';
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
  /** Mẫu concept giữ dù lệch tỉ lệ hộp: dựng bằng CO ĐỀU (toPascal `roomSetUniformOf`). */
  /** `'real'` (vòng 17): phương án cuối dựng mẫu ở CỠ THẬT, được vượt hộp AI chưa xác nhận (itemFitOf `uniform: 'real'`). */
  readonly uniform?: boolean | 'real';
  /** Đầu dò (vòng 17): mẫu được giữ/ghim nằm ngoài phạm vi công năng của vai (`functionalMissOf`). */
  readonly funcMiss?: string;
  /** Đầu dò (M17-2): mẫu dựng sẵn ở cỡ thật đặt DÙ lý do này (va chạm / ngoài công năng / không mẫu luật cũ) — thay khung đỏ null. */
  readonly forced?: string;
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

/**
 * Cờ texture của dữ liệu chất lượng (`ModelQuality.texture`, nhãn xem ảnh): 'broken' = vân vỡ/loang khi dựng → không bao giờ
 * là ứng viên, mọi vai. 'unsure' không ảnh hưởng (không hạ ưu tiên). Đọc cấu trúc để không buộc vào phiên bản kiểu.
 */
export const textureBroken = (q: ModelQuality): boolean => (q as ModelQuality & { readonly texture?: { readonly v?: string } }).texture?.v === 'broken';
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
/** Méo dáng: hai trục mặt bằng co/giãn lệch nhau quá dải `itemFitOf` cho phép (SCALE_MAX/SCALE_MIN). */
const distorted = (dims: Dims, shown: Dims): boolean => {
  if (dims[0] <= 0 || dims[2] <= 0) return false;
  const sx = shown[0] / dims[0];
  const sz = shown[2] / dims[2];
  return Math.max(sx, sz) / Math.min(sx, sz) > SCALE_MAX / SCALE_MIN + 1e-9;
};
/** `skip`: lý do bỏ qua, kiểm tiếp các lý do sau (mẫu concept: `CONCEPT_LENIENT`). */
export const hardRejectOf = (m: SetMember, folder: string, ctx: SetContext, skip: ReadonlySet<string> = new Set()): string | undefined => {
  const no = (r: string): boolean => !skip.has(r);
  const q = (ctx.qualityOf ?? defaultQualityOf)(folder);
  if (q === undefined) return 'thiếu dữ liệu chất lượng';
  if (q.role !== m.role) return 'sai vai';
  if ((q.issues ?? []).length > 0) return 'có lỗi QC';
  if (textureBroken(q)) return 'vân vỡ';
  if (q.front.check !== 'ok') return 'mặt trước chưa tin';
  if (q.parts === undefined || q.parts.length === 0) return 'thiếu dữ liệu phần';
  if (BED_ROLES.has(m.role) && q.completeness?.v !== 'full') return 'giường chưa hoàn chỉnh';
  const dims = ctx.dimsOf(folder);
  if (dims === undefined) return 'không lọt chỗ';
  // Cỡ HIỂN THỊ (đúng phép co dựng cảnh `itemFitOf`, luôn nằm trong hộp); test thuần không có thì theo cỡ catalog.
  const shown = m.shownOf?.(folder);
  if (m.shownOf !== undefined) {
    if (shown === undefined) return 'không tính được cỡ hiển thị';
    if (no('vượt hộp chỗ đặt') && m.box !== undefined && (shown[0] > m.box.w + SHOWN_TOL_M || shown[2] > m.box.d + SHOWN_TOL_M)) return 'vượt hộp chỗ đặt';
    const g = scaleOf(dims, shown);
    if (no('sai tỉ lệ thật') && g !== undefined && (g < SCALE_MIN || g > SCALE_MAX)) return 'sai tỉ lệ thật';
    // Méo dáng: hai trục mặt bằng co/giãn lệch nhau quá dải mà chính `itemFitOf` cho phép (SCALE_MAX/SCALE_MIN) — hộp hẹp
    // hơn mẫu trên một trục thì trục ấy bị bóp không chặn dưới (hộp dò 1,16 × 0,29 m: ghế bị kéo 1,37 và bóp 0,48).
    if (distorted(dims, shown)) return 'méo dáng';
    if (no('không giữ cỡ người dùng') && m.sizeFrom === 'user' && m.box !== undefined && (shown[0] < m.box.w * USER_FILL || shown[2] < m.box.d * USER_FILL)) return 'không giữ cỡ người dùng';
    // Vòng 17: công năng trên cỡ HIỂN THỊ (cả co đều concept). Cỡ người dùng xác nhận không bị loại — chỉ ghi sổ (`funcMiss`).
    if (m.sizeFrom !== 'user' && functionalMissOf(m.role, dims, shown) !== undefined) return FUNC_REJECT;
  } else if (!fitsSpot(dims, m.short, m.long)) return 'không lọt chỗ';
  const h = shown?.[1] ?? dims[1];
  // Chuẩn cao: cao đã cho, không thì trung vị pool vai; chuẩn ≥ TALL_M (tủ áo, kệ) thì không cao hơn chuẩn.
  const hRef = m.heightM ?? poolMedianHOf(m, ctx);
  if (no('cao hơn chuẩn vai') && hRef !== undefined && h > hRef * (hRef >= TALL_M ? 1 : HEIGHT_GROW_MAX) + 1e-9) return 'cao hơn chuẩn vai';
  if (m.ceilingM !== undefined && (m.liftM ?? 0) + h > m.ceilingM - CEILING_GAP_M) return 'chạm gần trần';
  if (no('nhỏ hơn cỡ vai') && SIZE_FLOOR_ROLES.has(m.role)) {
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
  /** Lệch bảng màu bộ + chất liệu bọc (vòng 17, `SET_FIT_ROLES`). */
  readonly set: number;
  /** Tỉ lệ cặp với sofa (`ARM_*`, `TABLE_W_MAX`). */
  readonly ratio: number;
  readonly total: number;
}

/** Bảng màu bộ của phòng (vòng 17): màu các phần thân (không kim loại/kính, tỉ phần ≥ ACCENT_MIN_SHARE) + chất liệu bọc trội + cỡ sofa. */
interface SetRef {
  readonly labs: readonly Lab[];
  readonly mat?: PartMaterial;
  /** Cỡ catalog của sofa rộng nhất đã chốt/ghim trong phòng; vắng = chưa có sofa. */
  readonly sofa?: Dims;
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
  /** Bảng màu bộ (chỉ vai `SET_FIT_ROLES` trong phòng có sofa); vắng = không chấm hợp bộ. */
  readonly set?: SetRef;
}

/** Chất liệu bọc chính (phần bọc tỉ phần lớn nhất, da/vải); vắng = không có phần bọc đã biết chất liệu. */
const upholsteryMatOf = (parts: readonly QualityPart[]): PartMaterial | undefined =>
  [...parts]
    .filter((p) => p.kind === 'upholstery' && (p.material === 'leather' || p.material === 'fabric'))
    .sort((a, b) => b.share - a.share)[0]?.material;
/** Bảng màu bộ từ các mẫu: phần thân ≥ ACCENT_MIN_SHARE; chất liệu bọc trội theo tổng tỉ phần bọc da/vải. */
const setRefOf = (folders: readonly string[], ctx: SetContext, memo: Memo, sofa: Dims | undefined): SetRef => {
  const labs: Lab[] = [];
  const mats = new Map<PartMaterial, number>();
  for (const folder of folders) {
    const f = featOf(folder, ctx, memo);
    for (const p of [...f.wood, ...f.body]) if (p.share >= ACCENT_MIN_SHARE) labs.push(p.lab);
    for (const p of f.soft) if (p.kind === 'upholstery' && (p.material === 'leather' || p.material === 'fabric')) mats.set(p.material, (mats.get(p.material) ?? 0) + p.share);
  }
  const mat = [...mats].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))[0]?.[0];
  return { labs, ...(mat === undefined ? {} : { mat }), ...(sofa === undefined ? {} : { sofa }) };
};
const overRatio = (r: number, max: number): number => (r > max ? SCALE_W * Math.log(r / max) : 0);

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
  // Hợp bộ (vòng 17): mỗi phần thân so với màu GẦN NHẤT của bảng màu bộ, cùng thang gỗ (WOOD_TOL/WOOD_DE_REF); khác chất
  // liệu bọc trội của bộ → SET_MAT_MISMATCH.
  const ref = refs.set;
  const mat = ref?.mat === undefined ? undefined : upholsteryMatOf(f.soft);
  const set =
    ref === undefined || ref.labs.length === 0
      ? 0
      : W_WOOD *
          [...f.wood, ...f.body].reduce(
            (s, p) => s + (p.share * Math.max(0, Math.min(...ref.labs.map((r) => woodDeltaOf(p.lab, r))) - WOOD_TOL)) / WOOD_DE_REF,
            0,
          ) +
        (mat !== undefined && mat !== ref.mat ? SET_MAT_MISMATCH : 0);
  const d = ctx.dimsOf(folder);
  const sofa = ref?.sofa;
  const ratio =
    d === undefined || sofa === undefined || sofa[0] <= 0 || sofa[1] <= 0
      ? 0
      : role === 'armchair'
        ? overRatio(d[1] / sofa[1], ARM_H_MAX) + overRatio(d[0] / sofa[0], ARM_W_MAX)
        : role === 'coffeeTable'
          ? overRatio(d[0] / sofa[0], TABLE_W_MAX)
          : 0;
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
    set,
    ratio,
    total: style + wood + soft + dark + fabric + layer + mirror + contrast + pair + set + ratio,
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
  (a.box?.rot ?? 0) - (b.box?.rot ?? 0) ||
  (a.liftM ?? 0) - (b.liftM ?? 0) ||
  a.role.localeCompare(b.role) ||
  (a.fixed ? (a.current ?? '') : (a.pinTo ?? '')).localeCompare(b.fixed ? (b.current ?? '') : (b.pinTo ?? '')) ||
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
export type SetZone = PlanRect & {
  readonly kind?: string;
  /** Mẫu thư viện của đồ ngoài bộ (đã lưu / luật): góp vào bảng màu bộ (vòng 17); vắng = chỉ chặn chỗ. */
  readonly folder?: string;
};
/** Ghế kê dưới bàn/quầy chồng hình hợp lệ — không tính va chạm. */
const tucked = (a: string | undefined, b: string | undefined): boolean =>
  a !== undefined && b !== undefined && tuckedSeat({ kind: a } as Pick<Furniture, 'kind'>, { kind: b } as Pick<Furniture, 'kind'>);
const boxRectOf = (b: SetBox): PlanRect => planRectOf(b.cx, b.cy, b.w, b.d, b.rot);
/**
 * Co đều quá nhỏ: hệ số (cỡ hiển thị / cỡ thật) không hữu hạn, ≤ 0 hoặc < UNIFORM_MIN; hoặc đã co mà mặt bằng còn dưới
 * nửa hộp ở cả hai trục. Không có cỡ hiển thị (test thuần) → không kiểm.
 */
const tooSmallOf = (dims: Dims | undefined, shown: Dims | undefined, box: SetBox | undefined): string | undefined => {
  if (dims === undefined || shown === undefined || dims[0] <= 0) return undefined;
  const s = shown[0] / dims[0];
  if (!Number.isFinite(s) || s <= 0 || !shown.every((v) => Number.isFinite(v) && v > 0) || s < UNIFORM_MIN) return 'co quá nhỏ';
  if (s < 1 && box !== undefined && shown[0] < box.w / 2 && shown[2] < box.d / 2) return 'co quá nhỏ';
  return undefined;
};
/** Món với cỡ hiển thị CO ĐỀU của mẫu concept (vắng thì như món). */
const conceptMemberOf = (m: SetMember): SetMember => (m.concept?.shownOf === undefined ? m : { ...m, shownOf: m.concept.shownOf });

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
    return near.sort((x, y) => dist(x) - dist(y) || byPlace(x, y))[0];
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
  /**
   * Vùng KẾT CẤU (F5-2, vòng 17): thân tường + vùng mở cửa (toPascal `wallRects`/`doorSwingRects`) = vùng `zones` đầu vào không
   * có `kind`; đồ đứng sàn ngoài bộ luôn mang `kind` của đồ (sceneVariety `obstacles`), món của bộ thêm sau vào `placed`.
   */
  const structural: readonly SetZone[] = zones.filter((z) => z.kind === undefined);
  const placeOf = (m: SetMember, folder: string, real = false): void => {
    const d = real ? ctx.dimsOf(folder) : undefined;
    const r = m.lifted === true ? undefined : d !== undefined && m.box !== undefined ? realRectOf(m, m.box, d) : shownRectOf(m, folder);
    if (r !== undefined) placed.push(m.kind === undefined ? r : { ...r, kind: m.kind });
  };
  /** Mặt bằng CỠ THẬT `d` trong hộp `b`: vai tựa tường áp lưng (−z cục bộ) vào mép sau hộp như itemFitOf, còn lại canh tâm. */
  const realRectOf = (m: SetMember, b: SetBox, d: Dims): PlanRect => {
    const k = WALL_BACK_ROLES.has(m.role) ? (d[2] - b.d) / 2 : 0;
    const t = (b.rot * Math.PI) / 180;
    return planRectOf(b.cx - Math.sin(t) * k, b.cy + Math.cos(t) * k, d[0], d[2], b.rot);
  };
  /**
   * Món dựng ở CỠ THẬT (phương án cuối vòng 17, `uniform: 'real'`): cỡ hiển thị = cỡ catalog (chỉ để kiểm ràng buộc cứng,
   * KHÔNG kiểm va chạm). Va chạm luôn qua `realRectOf` — đúng hình chữ nhật dựng: itemFitOf 'real' dời `asset.offset[2]` +
   * backShiftM = (sâu thật − sâu hộp)/2 theo z cục bộ cho WALL_BACK_ROLES (vai lấy từ dữ liệu chất lượng = `m.role`, vì
   * hardRejectOf loại "sai vai"), yaw = −rot → tâm (cx − sin·k, cy + cos·k). Co trần (s < 1) không xảy ra: cao thật vượt trần
   * đã bị "chạm gần trần" loại.
   */
  const realMemberOf = (m: SetMember): SetMember => ({ ...m, shownOf: (f) => ctx.dimsOf(f) });
  const memberAs = (m: SetMember, u: SetDecision['uniform']): SetMember => (u === 'real' ? realMemberOf(m) : u === true ? conceptMemberOf(m) : m);
  for (const m of inSet) {
    const f = folderOfFixed(m);
    // Món đã chốt co đều ở lượt trước: chiếm chỗ bằng mặt bằng co đều, không phải phép khớp thường (Codex M16-3 #2).
    if (f !== null) placeOf(memberAs(m, decided.get(m.id)?.uniform), f, decided.get(m.id)?.uniform === 'real');
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
  // Món bộ CHƯA chốt (kể cả cùng vai) giữ chỗ bằng cả hộp của nó (mặt bằng ⊆ hộp: bảo thủ).
  const pendingOf = (m: SetMember): SetZone[] =>
    inSet.flatMap((x) =>
      x === m || x.fixed || x.lifted === true || x.box === undefined || decided.has(x.id) || out.has(x.id)
        ? []
        : [x.kind === undefined ? boxRectOf(x.box) : { ...boxRectOf(x.box), kind: x.kind }],
    );
  const evalOf = (m: SetMember, costFor: (m: SetMember, f: string) => number) => {
    const rejects: Record<string, number> = {};
    const box = m.box;
    const near = box === undefined || m.lifted === true ? [] : [...placed, ...pendingOf(m)].filter((z) => !tucked(m.kind, z.kind) && rectsOverlap(boxRectOf(box), z));
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
    // Hiện trạng (mẫu luật cũ) chỉ trượt HÌNH DÁNG nhưng qua va chạm, texture, trần: được giữ khi không gì ≤ FAIL_COST.
    const cur = m.current;
    let legacyShape: string | undefined;
    if (cur !== null && !pass.has(cur)) {
      const r = hardRejectOf(m, cur, ctx);
      // Điều phối M17-4 (cn02: bàn sồi luật cũ méo nhẹ bị thay bằng ứng viên chi phí 1,85): hiện trạng chỉ trượt lý do MỀM
      // (hình dáng, méo dáng, thiếu dữ liệu — cùng "ngoại lệ được phép" của fallbackOf) thì được giữ; chỉ lý do CẤM
      // (`forbiddenOf`: QC, vân vỡ, giường chưa hoàn chỉnh, trần, ngoài công năng) hoặc chồng vùng chặn THÊM quá phần chính
      // hộp đã chồng (và quá ngân sách của pool) mới không giữ.
      if (forbiddenOf(m, cur, undefined) === undefined) {
        const rect = near.length === 0 ? undefined : shownRectOf(m, cur);
        const hit = rect === undefined ? 0 : near.reduce((s, z) => s + overlapAreaM2(rect, z), 0);
        const boxHit = box === undefined || near.length === 0 ? 0 : near.reduce((s, z) => s + overlapAreaM2(boxRectOf(box), z), 0);
        if (hit <= Math.max(minHit, boxHit) + ROOM_OVERLAP_TOL_M2) legacyShape = r ?? 'ngoài pool';
      }
    }
    // Mẫu concept: cùng ràng buộc cứng + cùng ngân sách va chạm như ứng viên của pool (không vào `pass`: đường chọn
    // bình thường giữ nguyên khi concept trượt).
    // Lệch tỉ lệ hộp (lý do nhẹ) không loại concept: kiểm lại chất lượng/an toàn trên cỡ CO ĐỀU + méo dáng của phép khớp
    // thường; qua thì dựng co đều (`uniform`), va chạm theo mặt bằng co đều.
    let concept: { readonly f: string; readonly cost?: number; readonly miss?: string; readonly uniform?: string } | undefined;
    if (m.concept !== undefined) {
      const f = m.concept.folder;
      const strict = m.concept.reject ?? hardRejectOf(m, f, ctx);
      // I2: phép khớp thường "ngoài công năng" (vd cao theo heightMm) cũng xét lại ở cỡ co đều — hardRejectOf(cm) bên dưới vẫn
      // kiểm công năng trên cỡ co đều, nên concept chỉ qua khi co đều trong phạm vi.
      const lenient = strict !== undefined && m.concept.reject === undefined && (CONCEPT_LENIENT.has(strict) || strict === FUNC_REJECT);
      const cm = lenient ? conceptMemberOf(m) : m;
      const dims = ctx.dimsOf(f);
      const shown = m.shownOf?.(f);
      const r = !lenient
        ? strict
        : (tooSmallOf(dims, cm.shownOf?.(f), m.box) ??
          hardRejectOf(cm, f, ctx, CONCEPT_LENIENT) ??
          (dims !== undefined && shown !== undefined && distorted(dims, shown) ? 'méo dáng' : undefined));
      const rect = r !== undefined || near.length === 0 ? undefined : shownRectOf(cm, f);
      const hit = rect === undefined ? 0 : near.reduce((s, z) => s + overlapAreaM2(rect, z), 0);
      // Pool không còn ứng viên lọt: ngân sách va chạm = 0 chồng (+ dung sai), không phải vô hạn (Codex M16-1 #2).
      const miss = r ?? (hit > (ok.length === 0 ? 0 : minHit) + ROOM_OVERLAP_TOL_M2 ? 'va chạm' : undefined);
      concept = miss === undefined ? { f, cost: costFor(m, f), ...(lenient ? { uniform: strict } : {}) } : { f, miss };
    }
    // Vòng 17 (L4): chi phí mẫu luật cũ cho trần FAIL_COST của phương án cuối — chỉ khi pool rỗng.
    const legacyCost = pass.size === 0 && cur !== null && ctx.dimsOf(cur) !== undefined ? costFor(m, cur) : undefined;
    return {
      pass,
      rejects,
      ...(legacyShape === undefined ? {} : { legacyShape }),
      ...(concept === undefined ? {} : { concept }),
      ...(legacyCost === undefined ? {} : { legacyCost }),
    };
  };
  /**
   * Lý do loại vì CHẤT LƯỢNG/AN TOÀN (L5, vòng 17): mẫu trượt các lý do này (ở pool, concept hay luật cũ) không quay lại qua
   * nhánh nào — kể cả phương án cuối.
   */
  const BANNED: ReadonlySet<string> = new Set(['thiếu dữ liệu chất lượng', 'có lỗi QC', 'vân vỡ', 'giường chưa hoàn chỉnh', 'chạm gần trần', 'va chạm']);
  /**
   * Mẫu bị CẤM làm kết quả cuối (Codex M17-1 #2): lỗi QC, vân vỡ, giường chưa hoàn chỉnh, chạm gần trần (kể độ nâng), concept
   * của chính mẫu trượt vì lý do trong BANNED, và ngoài công năng ở cỡ hiển thị. Kiểm từng lý do riêng — lý do đầu của
   * hardRejectOf (vd hình dáng) không được che lý do cấm. "Thiếu dữ liệu chất lượng" KHÔNG cấm ở đây: mẫu dựng sẵn/luật cũ
   * Pascal không có dữ liệu thư viện. Ngoại lệ được phép (méo dáng, chi phí > FAIL_COST) không nằm ở đây.
   * Trần và công năng chỉ miễn với cỡ NGƯỜI DÙNG xác nhận (tủ áo người dùng cao 2,3 m dưới trần 2,6 m vẫn dựng — F1-ext).
   * Món chưa xác nhận luôn kiểm hở trần kể độ nâng, kể cả khi cao hiển thị = `heightM` AI cho (Codex M17-2 #2: tủ áo AI 2,4 m
   * nâng 0,5 m dưới trần 2,7 m).
   */
  const forbiddenOf = (m: SetMember, f: string, conceptMiss: string | undefined): string | undefined => {
    const q = (ctx.qualityOf ?? defaultQualityOf)(f);
    const dims = ctx.dimsOf(f);
    const shown = m.shownOf?.(f) ?? dims;
    const h = shown?.[1];
    const byModel = m.sizeFrom !== 'user' && h !== undefined;
    return (
      (q !== undefined && (q.issues ?? []).length > 0 ? 'có lỗi QC' : undefined) ??
      (q !== undefined && textureBroken(q) ? 'vân vỡ' : undefined) ??
      (q !== undefined && BED_ROLES.has(m.role) && q.completeness?.v !== 'full' ? 'giường chưa hoàn chỉnh' : undefined) ??
      (byModel && m.ceilingM !== undefined && (m.liftM ?? 0) + (h as number) > m.ceilingM - CEILING_GAP_M ? 'chạm gần trần' : undefined) ??
      (conceptMiss !== undefined && BANNED.has(conceptMiss) ? conceptMiss : undefined) ??
      (m.sizeFrom === 'user' || dims === undefined || shown === undefined
        ? undefined
        : ((miss) => (miss === undefined ? undefined : `${FUNC_REJECT}: ${miss}`))(functionalMissOf(m.role, dims, shown)))
    );
  };
  /**
   * Phương án cuối khi không ứng viên nào qua (vòng 17, điều phối):
   * (a) CỠ THẬT (công năng trên cỡ thật, không co, áp lưng tường như itemFitOf), mẫu đúng vai qua chất lượng, không chồng vùng
   *     chặn/đồ ghim/món đã chốt/món chưa chốt quá ROOM_OVERLAP_TOL_M2, chi phí ≤ FAIL_COST — hộp AI chưa xác nhận nên được
   *     vượt hộp. Trong đó lấy dải SHARE_BAND quanh chi phí tốt nhất rồi chọn mẫu NHỎ NHẤT (diện tích mặt bằng), hoà → chi phí
   *     → tên (Codex M17-1 #7): mẫu to hợp bộ hơn chút không thắng mẫu nhỏ trong dải, mẫu nhỏ lạc tông ngoài dải không thắng.
   * (b) Luật cũ trượt (cấm / méo dáng / chi phí > FAIL_COST / thiếu dữ liệu) → mẫu DỰNG SẴN của vai ở cỡ hiển thị, nếu nó không
   *     méo, trong công năng, không cấm, và qua cùng kiểm va chạm + hở trần (Codex M17-1 #4).
   * (c) Mẫu luật cũ nếu nó KHÔNG bị cấm (`forbiddenOf`) và không va chạm (`clear`, Codex M17-2 #1) — ngoại lệ được phép: méo dáng, chi phí > FAIL_COST (ghi sổ).
   * (d) Còn lại `null`: sổ ghi lý do; toPascal không dựng mẫu thư viện nào cho món (chỗ giữ chỗ `asset://`), không bao giờ
   *     mẫu của vai gốc (vai hiệu lực do sceneVariety tính). Không bao giờ chọn mẫu co dưới phạm vi.
   */
  const fallbackOf = (
    m: SetMember,
    ev: { readonly legacyCost?: number; readonly concept?: { readonly f: string; readonly miss?: string } },
    costOf: (f: string) => number,
    lead?: string,
  ): { readonly to: string | null; readonly uniform?: 'real'; readonly forced?: string; readonly role?: string; readonly why: string } => {
    // F5 (vòng 17): `lead` = mẫu ghế của nhóm (một bàn một bộ) — chỉ thử đúng mẫu ấy (cỡ thật / hiển thị / cỡ thật cưỡng bức).
    const pool = lead === undefined ? m.pool : [lead];
    const b = m.box;
    const zones = m.lifted === true || b === undefined ? [] : [...placed, ...pendingOf(m)].filter((z) => !tucked(m.kind, z.kind));
    const hitOf = (rect: PlanRect | undefined): number => (rect === undefined ? 0 : zones.reduce((s, z) => s + overlapAreaM2(rect, z), 0));
    const clear = (rect: PlanRect | undefined, budget = 0): boolean => hitOf(rect) <= budget + ROOM_OVERLAP_TOL_M2;
    /** Cỡ thật `d` vượt hộp không quá REAL_GROW_M mỗi trục mặt bằng. */
    const grows = (box: SetBox, d: Dims): boolean => d[0] <= box.w + REAL_GROW_M + 1e-9 && d[2] <= box.d + REAL_GROW_M + 1e-9;
    if (b !== undefined && m.sizeFrom !== 'user') {
      const real = realMemberOf(m);
      const fits = pool.flatMap((f) => {
        const d = ctx.dimsOf(f);
        if (d === undefined || !grows(b, d) || hardRejectOf(real, f, ctx, CONCEPT_LENIENT) !== undefined || !clear(realRectOf(m, b, d))) return [];
        const c = r9(costOf(f));
        return c <= FAIL_COST ? [{ f, c, a: d[0] * d[2] }] : [];
      });
      const best = Math.min(...fits.map((x) => x.c));
      // Dải hợp bộ TRƯỚC, nhỏ nhất SAU (điều phối M17-2 #4): "nhỏ hơn đúng loại" nhưng không quay lại mẫu lạc tông ngoài dải.
      const pick = fits.filter((x) => x.c <= r9(best + SHARE_BAND)).sort((x, y) => x.a - y.a || x.c - y.c || x.f.localeCompare(y.f))[0];
      if (pick !== undefined) {
        return { to: pick.f, uniform: 'real', why: 'phương án cuối: mẫu nhỏ nhất đúng vai trong dải hợp bộ, ở cỡ thật (vượt hộp AI), không va chạm' };
      }
    }
    const cur = m.current;
    const conceptMissOf = (f: string): string | undefined => (ev.concept?.f === f ? ev.concept.miss : undefined);
    // Codex M17-2 #1: luật cũ cũng qua cùng kiểm va chạm (mặt bằng hiển thị, `clear`) như mẫu dựng sẵn / cỡ thật. Mẫu khớp
    // TRONG hộp (luật cũ, dựng sẵn) chỉ không được chồng THÊM quá phần chính hộp đã chồng (hộp AI chạm tường do sai số dò;
    // hộp người dùng là bố cục của họ) — kiểm tuyệt đối từng đẩy bàn AI 0,8 m nằm gọn trong hộp sang cỡ thật to hơn, chồng hơn.
    const boxHit = b !== undefined ? hitOf(boxRectOf(b)) : 0;
    const forbid = cur === null ? undefined : (forbiddenOf(m, cur, conceptMissOf(cur)) ?? (clear(shownRectOf(m, cur), boxHit) ? undefined : 'va chạm'));
    const dims = cur === null ? undefined : ctx.dimsOf(cur);
    const shown = cur === null ? undefined : (m.shownOf?.(cur) ?? dims);
    const r = cur === null ? undefined : hardRejectOf(m, cur, ctx);
    // Ngoại lệ được phép của luật cũ: vẫn thử mẫu dựng sẵn trước, không được thì giữ luật cũ + ghi sổ.
    const soft =
      (r !== undefined && BANNED.has(r) ? r : undefined) ??
      (dims !== undefined && shown !== undefined && distorted(dims, shown) ? 'méo dáng' : undefined) ??
      (ev.legacyCost !== undefined && ev.legacyCost > FAIL_COST ? `chi phí ${ev.legacyCost.toFixed(2)} > ${FAIL_COST}` : undefined);
    const slip = forbid ?? soft;
    const st = lead ?? m.stock;
    if ((cur === null || slip !== undefined) && st !== undefined && st !== cur) {
      const sd = ctx.dimsOf(st);
      const ss = m.shownOf?.(st) ?? sd;
      const stockOk =
        sd !== undefined &&
        ss !== undefined &&
        !distorted(sd, ss) &&
        forbiddenOf(m, st, conceptMissOf(st)) === undefined &&
        clear(m.lifted === true ? undefined : shownRectOf(m, st), boxHit);
      if (stockOk) {
        return { to: st, why: `phương án cuối: mẫu dựng sẵn của vai — ${cur === null ? 'không mẫu luật cũ' : `luật cũ trượt (${slip ?? ''})`}` };
      }
    }
    // Điều phối M17-2: null chỉ vì va chạm / ngoài công năng → mẫu dựng sẵn ở CỠ THẬT (không co, không méo, 'real') DÙ va chạm,
    // cờ `forced` cho đầu dò. Vẫn phải qua chất lượng/an toàn + trần ở cỡ thật (`forbiddenOf` trên cỡ thật). Khung đỏ (null) chỉ
    // còn khi lý do cấm là an toàn/chất lượng hoặc không có mẫu dựng sẵn hợp lệ. Cỡ người dùng xác nhận không dựng cỡ thật.
    const forceable = cur === null || forbid === 'va chạm' || (forbid?.startsWith(FUNC_REJECT) ?? false);
    if (forceable && b !== undefined && m.sizeFrom !== 'user') {
      // F6 (vòng 17, R2 cn08/s4pn): tầng cưỡng bức thử MỌI mẫu thư viện của vai ở cỡ thật (cùng kiểm chất lượng như (a)), không
      // chỉ mẫu dựng sẵn — mẫu dựng sẵn vân nhoè/lạc bộ chỉ là phương án cuối. Không được chồng đồ đạc (F7) hay
      // thân tường / vùng mở cửa quá phần hộp đã chồng (F5-2); vẫn ≤ REAL_GROW_M mỗi trục. Món chưa xác định không đặt được thì ẨN.
      const real = realMemberOf(m);
      const wallHit = (rect: PlanRect): number => structural.reduce((s, z) => s + overlapAreaM2(rect, z), 0);
      const wallOk = (d: Dims): boolean => m.lifted === true || wallHit(realRectOf(m, b, d)) <= wallHit(boxRectOf(b)) + ROOM_OVERLAP_TOL_M2;
      // Codex M17-9 P2: ngân sách đồ đạc TÁCH khỏi tường — bớt chồng tường không được đổi lấy chồng đồ đạc.
      const furnHit = (rect: PlanRect): number => hitOf(rect) - wallHit(rect);
      const furnOk = (rect: PlanRect): boolean => m.lifted === true || furnHit(rect) <= furnHit(boxRectOf(b)) + ROOM_OVERLAP_TOL_M2;
      const stockOk = (f: string): boolean => {
        const cm = conceptMissOf(f);
        return forbiddenOf(real, f, cm === 'va chạm' ? undefined : cm) === undefined;
      };
      const cands = [...new Set([...pool, ...(st === undefined ? [] : [st])])].flatMap((f) => {
        const d = ctx.dimsOf(f);
        // F7 (R3 ch07: tủ cỡ thật đè giường + bàn ăn): không chồng đồ đạc quá phần hộp AI đã chồng — món chưa xác nhận thà ẩn
        // còn hơn đè đồ khác (giám khảo mù R2/R3). Tầng này chỉ còn cưỡng bức lý do công năng / luật cũ, không cưỡng bức va chạm.
        if (d === undefined || !grows(b, d) || !wallOk(d) || !furnOk(realRectOf(m, b, d))) return [];
        if (f === st ? !stockOk(f) : hardRejectOf(real, f, ctx, CONCEPT_LENIENT) !== undefined) return [];
        const c = f === st ? FAIL_COST : r9(costOf(f));
        return c <= FAIL_COST ? [{ f, d, c, a: d[0] * d[2] }] : [];
      });
      // Thư viện trước (dải hợp bộ → nhỏ nhất, mức vượt hộp đã chặn ≤ REAL_GROW_M), mẫu dựng sẵn chỉ khi không còn mẫu thư viện.
      const lib = cands.filter((x) => x.f !== st);
      const from = lib.length > 0 ? lib : cands;
      const cBest = Math.min(...from.map((x) => x.c));
      const pick = from.filter((x) => x.c <= r9(cBest + SHARE_BAND)).sort((x, y) => x.a - y.a || x.c - y.c || x.f.localeCompare(y.f))[0];
      if (pick !== undefined) {
        const forced = [forbid ?? 'không mẫu luật cũ', ...(clear(realRectOf(m, b, pick.d)) ? [] : ['va chạm'])].filter((x, i, a) => a.indexOf(x) === i).join(', ');
        return { to: pick.f, uniform: 'real', forced, why: `phương án cuối: ${pick.f === st ? 'mẫu dựng sẵn' : 'mẫu thư viện nhỏ nhất trong dải hợp bộ'} ở cỡ thật dù ${forced} (luật cũ không dùng được)` };
      }
      // F8: không mẫu nào của vai vừa → mẫu NHỎ HƠN cùng nhóm đồ chứa, cùng kiểm (cỡ thật, ≤ REAL_GROW_M, không chồng tường/cửa/
      // đồ đạc, chất lượng + công năng theo vai mới). Vai mới ghi vào sổ (`role`) để dựng cảnh áp lưng / đo công năng đúng vai.
      for (const sib of lead === undefined ? (m.smaller ?? []) : []) {
        const sm: SetMember = { ...real, role: sib.role };
        const fit = sib.pool.flatMap((f) => {
          const d = ctx.dimsOf(f);
          if (d === undefined || !grows(b, d) || !wallOk(d) || !furnOk(realRectOf(sm, b, d))) return [];
          return hardRejectOf(sm, f, ctx, CONCEPT_LENIENT) === undefined ? [{ f, c: r9(costOf(f)), a: d[0] * d[2] }] : [];
        });
        const cMin = Math.min(...fit.map((x) => x.c));
        const sp = fit.filter((x) => x.c <= r9(cMin + SHARE_BAND)).sort((x, y) => x.a - y.a || x.c - y.c || x.f.localeCompare(y.f))[0];
        if (sp !== undefined) {
          return { to: sp.f, uniform: 'real', role: sib.role, forced: `không mẫu ${m.role} nào vừa hộp`, why: `phương án cuối: không mẫu ${m.role} nào vừa hộp AI ở cỡ thật — mẫu ${sib.role} nhỏ hơn cùng nhóm đồ chứa, cỡ thật` };
        }
      }
      const stDims = st === undefined ? undefined : ctx.dimsOf(st);
      if (st !== undefined && stDims !== undefined && stockOk(st)) {
        return grows(b, stDims)
          ? { to: null, why: 'phương án cuối: mẫu cỡ thật va chạm tường/cửa/đồ đạc — ẩn món' }
          : { to: null, why: `phương án cuối: hộp AI quá nhỏ cho vai — không mẫu cỡ thật nào vượt hộp dưới ${REAL_GROW_M} m` };
      }
    }
    if (cur === null) return { to: null, why: 'phương án cuối: không ứng viên, không mẫu luật cũ, mẫu dựng sẵn không đặt được' };
    if (forbid !== undefined) {
      return { to: null, why: `phương án cuối: không mẫu hợp lệ — luật cũ bị cấm (${forbid}), mẫu dựng sẵn không đặt được` };
    }
    return { to: cur, why: `không ứng viên qua ràng buộc cứng — mẫu luật cũ` + (soft === undefined ? '' : `; luật cũ trượt (${soft})`) };
  };

  // Bảng màu bộ (vòng 17, L1): mẫu đã có của từng món (ghim / đã chốt lượt trước / đã chốt trong lượt) — chưa chốt thì
  // mẫu concept nếu qua chất lượng/an toàn (bỏ qua lý do lệch hộp như CONCEPT_LENIENT; concept bị loại không góp màu) — cộng
  // đồ đứng sàn ngoài bộ có mẫu (`SetZone.folder`). Tính lại mỗi vai nên luôn theo các vai đã chốt.
  const hasSofa = inSet.some((m) => m.role === 'sofa');
  // Codex M17-1 #6: concept chỉ góp màu khi được NHẬN HẲN theo đúng phép của lượt vai (`evalOf`: chất lượng, co quá nhỏ, méo,
  // công năng, va chạm với vùng chặn + món chưa chốt giữ cả hộp — bảo thủ hơn lúc chốt thật) và nhóm không có mẫu ghim/đã
  // chốt dẫn nhóm; ghế quanh bàn: mọi ghế cùng bàn phải qua (như `byConcept`).
  const conceptAhead = new Map<string, boolean>();
  const conceptPasses = (m: SetMember): boolean => {
    const hit = conceptAhead.get(m.id);
    if (hit !== undefined) return hit;
    const c = m.concept === undefined ? undefined : evalOf(m, () => 0).concept;
    const ok = c !== undefined && c.miss === undefined;
    conceptAhead.set(m.id, ok);
    return ok;
  };
  const aheadOf = (m: SetMember): string | null => {
    if (m.concept === undefined || m.pinTo !== undefined) return null;
    const key = tableOf(m)?.id ?? '';
    const group = inSet.filter((x) => x.role === m.role && (tableOf(x)?.id ?? '') === key);
    if (group.some((x) => folderOfFixed(x) !== null || x.pinTo !== undefined)) return null;
    const holders = key !== '' && SEAT_GROUP_ROLES.has(m.role) ? group.filter((x) => !x.fixed && !decided.has(x.id) && x.concept !== undefined) : [m];
    return holders.every(conceptPasses) ? m.concept.folder : null;
  };
  const setRefNow = (): SetRef => {
    // `to: null` đã quyết (phương án cuối) là quyết định, không phải "chưa quyết" — không hồi sinh concept dự đoán.
    const own = inSet.map((m) => {
      const d = out.get(m.id) ?? decided.get(m.id);
      return d !== undefined ? d.to : m.fixed ? m.current : aheadOf(m);
    });
    const sofas = inSet.flatMap((m, i) => {
      const f = m.role === 'sofa' && (out.has(m.id) || m.fixed || decided.has(m.id)) ? own[i] : null;
      const d = f === null || f === undefined ? undefined : ctx.dimsOf(f);
      return d === undefined ? [] : [d];
    });
    const folders = [...own, ...zones.map((z) => z.folder)].filter((f): f is string => typeof f === 'string');
    return setRefOf(folders, ctx, memo, sofas.sort((a, b) => b[0] - a[0])[0]);
  };

  for (const role of roles) {
    const group = inSet.filter((m) => m.role === role);
    const todo = group.filter((m) => !m.fixed && !decided.has(m.id));
    const setRef = hasSofa && SET_FIT_ROLES.has(role) ? setRefNow() : undefined;
    if (todo.length === 0) continue;
    const anchor = role === anchorRole;
    const keyOf = new Map(group.map((m) => [m.id, tableOf(m)?.id ?? ''] as const));
    /** Ngữ cảnh chấm theo nhóm (bàn của nhóm ghế): gỗ tham chiếu + gỗ bàn cho `pair`. */
    const refsOf = (key: string): ItemRefs => {
      const table = key === '' ? undefined : inSet.find((m) => m.id === key);
      const tableFolder = table === undefined ? null : (out.get(table.id)?.to ?? folderOfFixed(table) ?? table.current);
      const tf = tableFolder === null ? undefined : featOf(tableFolder, ctx, memo);
      const wood =
        tf?.woodLab ??
        (SEAT_GROUP_ROLES.has(role) ? woodByRole.get('diningTable') : undefined) ??
        fixedWood ??
        (anchor ? undefined : anchorWood) ??
        toneWoodOf(ctx.palette);
      // I2 (vòng 17): bảng màu bộ luôn có nền của phòng — gỗ tham chiếu (đồ cố định / tông căn) + tường. Neo chọn khi phòng
      // chưa chốt gì từng có bảng màu RỖNG → hợp bộ = 0, dải neo chỉ còn nhiễu tỉ lệ (cn02: 7 sofa trong 0,08, rút trúng xám).
      const setNow = setRef === undefined ? undefined : { ...setRef, labs: [...setRef.labs, wood, ...(ctx.palette.wall === undefined ? [] : [ctx.palette.wall])] };
      return {
        wood,
        families,
        anchor,
        ...(hardShare > 0 ? { hardL: hardSum / hardShare } : {}),
        ...(tf?.woodLab !== undefined && tf.woodShare >= PAIR_WOOD_SHARE ? { pair: tf.woodLab } : {}),
        ...(setNow === undefined ? {} : { set: setNow }),
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
      const inBand = ranked.filter((r) => r.n === best.n && r.cost <= r9(best.cost + ANCHOR_BAND)).sort((a, b) => a.f.localeCompare(b.f));
      // Codex SEL-5: trong dải, mẫu dưới ngưỡng hỏng đi trước — băm không được rút trúng mẫu > FAIL_COST khi dải còn mẫu đạt.
      const good = inBand.filter((r) => r.cost <= FAIL_COST);
      const band = good.length > 0 ? good : inBand;
      return { f: (band[fnv1a(hashKey) % band.length] as { f: string }).f, n: best.n, band: band.length };
    };
    // Mẫu chung cả phòng; nhóm (bàn) dùng nó khi nó chấp nhận được cho MỌI món của nhóm, không thì mẫu chung của nhóm.
    // Khoá băm theo nội dung, không theo id (chép dự án sinh id mới): thứ hạng vị trí của bàn / món trong phòng.
    const tableRank = new Map([...tables].sort(byPlace).map((t, i) => [t.id, i] as const));
    const groupHash = (key: string): string => `${roomKey}|${role}|g${key === '' ? '-' : (tableRank.get(key) ?? '?')}`;
    const pinnedOf = (key: string): string | undefined =>
      group
        .filter((m) => keyOf.get(m.id) === key)
        .map((m) => folderOfFixed(m) ?? m.pinTo ?? null)
        .find((f): f is string => f !== null);
    // Mẫu concept trước (vòng 16): món qua mọi ràng buộc cứng → concept, không so chi phí. Nhóm ghế quanh bàn: concept là
    // mẫu chung chỉ khi qua cho MỌI ghế của bàn. Nhóm có mẫu ghim/đã chốt → mẫu ấy dẫn nhóm như cũ (một kiểu mỗi bàn).
    const conceptMiss = new Map<string, string>();
    const byConcept = new Set<string>();
    for (const key of new Set(todo.map((m) => keyOf.get(m.id) ?? ''))) {
      if (pinnedOf(key) !== undefined) continue;
      const holders = todo.filter((m) => keyOf.get(m.id) === key && m.pinTo === undefined && evals.get(m.id)?.concept !== undefined);
      const missOf = (m: SetMember): string | undefined => evals.get(m.id)?.concept?.miss;
      const first = key !== '' && SEAT_GROUP_ROLES.has(role) ? holders.find((m) => missOf(m) !== undefined) : undefined;
      for (const m of holders) {
        const miss = missOf(m) ?? (first === undefined ? undefined : `${missOf(first) ?? ''} (ghế ${first.id} cùng bàn)`);
        if (miss === undefined) byConcept.add(m.id);
        else conceptMiss.set(m.id, miss);
      }
    }
    for (const m of todo) {
      if (!byConcept.has(m.id)) continue;
      const ev = evals.get(m.id);
      const c = ev?.concept as { readonly f: string; readonly cost?: number; readonly uniform?: string };
      const fromCost = m.current === null ? undefined : ev?.pass.get(m.current);
      const key = keyOf.get(m.id) ?? '';
      out.set(m.id, {
        id: m.id,
        role,
        from: m.current,
        to: c.f,
        rule: c.f === m.current ? 'keep' : 'roomset',
        cause: 'concept',
        anchor,
        ...(c.cost === undefined ? {} : { cost: c.cost }),
        ...(fromCost === undefined ? {} : { fromCost }),
        ...(m.sizeFrom === undefined ? {} : { by: m.sizeFrom }),
        ...(key === '' ? {} : { group: key }),
        pool: m.pool.length,
        ...(c.uniform === undefined ? {} : { uniform: true }),
        why:
          c.uniform === undefined
            ? `concept: qua mọi ràng buộc cứng${c.cost === undefined ? '' : ` (${c.cost.toFixed(2)})`}`
            : `concept: qua chất lượng/an toàn, lệch hộp (${c.uniform}) — dựng co đều`,
        ...(ev !== undefined && Object.keys(ev.rejects).length > 0 ? { rejects: ev.rejects } : {}),
      });
      placeOf(c.uniform === undefined ? m : conceptMemberOf(m), c.f);
    }
    const open = todo.filter((m) => !byConcept.has(m.id));
    const roomShared = bestFor(open, `${roomKey}|${role}`);
    const keys = [...new Set(open.map((m) => keyOf.get(m.id) ?? ''))];
    for (const key of keys) {
      const todoG = open.filter((m) => keyOf.get(m.id) === key);
      const pinned = pinnedOf(key);
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
      // Ngưỡng hỏng theo NHÓM (Codex SEL-4 #3): mỗi mẫu chung của nhóm (mẫu chung / mẫu chung phụ / mẫu riêng) có chi phí
      // trung bình trên các món nhận nó; > FAIL_COST thì cả nhóm đó giữ mẫu luật cũ — không để thành viên lệch nhau. Mẫu ghim
      // của nhóm (người dùng chọn / cặp đã nhận) không bị ngưỡng đụng tới.
      const pickOf = (m: SetMember): { f: string; n: number; band: number } | undefined => {
        if (m.pinTo !== undefined) return { f: m.pinTo, n: 0, band: 1 };
        const ok = shared !== undefined && (pinned !== undefined ? passOf(m).has(shared.f) : okFor(m, shared.f));
        return ok ? shared : restPick.get(m.id);
      };
      const takers = new Map<string, number[]>();
      for (const m of todoG) {
        const p = pickOf(m);
        const c = p === undefined ? undefined : passOf(m).get(p.f);
        if (p !== undefined && c !== undefined && m.pinTo === undefined) takers.set(p.f, [...(takers.get(p.f) ?? []), c]);
      }
      const overOf = (f: string): number | undefined => {
        const cs = takers.get(f);
        if (cs === undefined || (pinned !== undefined && f === pinned)) return undefined;
        const avg = r9(cs.reduce((s, c) => s + c, 0) / cs.length);
        return avg > FAIL_COST ? avg : undefined;
      };
      // F5 (vòng 17) — một bàn một bộ ghế: ghế (SEAT_GROUP_ROLES) không nhận mẫu chung của nhóm (mẫu chung phụ / phương án
      // cuối chọn riêng) theo MẪU DẪN của nhóm: mẫu của món cùng nhóm ngoài lượt (concept / ghim / đã chốt) — dẫn cả nhóm —
      // không thì mẫu phổ biến nhất đã chốt trong lượt (món theo mẫu chung chốt trước). Lọt ràng buộc cứng → dùng; không thì
      // phương án cuối chỉ với mẫu dẫn (cỡ thật / hiển thị / cỡ thật cưỡng bức như mẫu dựng sẵn). Không được → luồng cũ.
      const seat = SEAT_GROUP_ROLES.has(role);
      const onShared = (m: SetMember): boolean => pickOf(m) !== undefined && pickOf(m)?.f === shared?.f;
      const todoIds = new Set(todoG.map((m) => m.id));
      const mostOf = (fs: readonly string[]): string | undefined =>
        [...new Set(fs)].sort((a, b) => fs.filter((x) => x === b).length - fs.filter((x) => x === a).length || a.localeCompare(b))[0];
      const groupFolders = (inner: boolean): string[] =>
        group.flatMap((x) => {
          if (keyOf.get(x.id) !== key || todoIds.has(x.id) !== inner) return [];
          const f = out.get(x.id)?.to ?? decided.get(x.id)?.to ?? folderOfFixed(x);
          return typeof f === 'string' ? [f] : [];
        });
      const outerLead = seat ? mostOf(groupFolders(false)) : undefined;
      for (const m of seat ? [...todoG.filter(onShared), ...todoG.filter((x) => !onShared(x))] : todoG) {
        const ev = evals.get(m.id) ?? { pass: new Map<string, number>(), rejects: {} };
        const lead = !seat || m.pinTo !== undefined ? undefined : (outerLead ?? (onShared(m) ? undefined : mostOf(groupFolders(true))));
        const leadPass = lead !== undefined && pickOf(m)?.f !== lead && ev.pass.has(lead);
        const leadFb =
          lead !== undefined && pickOf(m)?.f !== lead && !leadPass
            ? fallbackOf(m, ev, (f) => itemCostOf(f, role, refsOf(key), ctx, memo).total, lead)
            : undefined;
        const byLead = leadPass || (leadFb !== undefined && leadFb.to === lead);
        const fromCost = m.current === null ? undefined : ev.pass.get(m.current);
        const top = [...ev.pass]
          .sort((a, b) => a[1] - b[1] || a[0].localeCompare(b[0]))
          .slice(0, 3)
          .map(([f, c]) => [f, +c.toFixed(3)] as const);
        // Mẫu ghim của nhóm: chỉ cần lọt; mẫu chung: phải chấp nhận được cho chính món.
        const sharedOk = !byLead && shared !== undefined && (pinned !== undefined ? ev.pass.has(shared.f) : okFor(m, shared.f));
        const pick = leadPass ? { f: lead as string, n: 0, band: 1 } : leadFb !== undefined && byLead ? undefined : pickOf(m);
        const cost = pick === undefined ? undefined : ev.pass.get(pick.f);
        const old = fromCost === undefined ? 'luật cũ trượt/không có' : `luật cũ ${fromCost.toFixed(2)}`;
        const via = leadPass
          ? 'mẫu dẫn của nhóm ghế (một bàn một bộ)'
          : sharedOk && pinned !== undefined
            ? 'cùng mẫu món ghim/đã chốt của nhóm'
            : sharedOk && open.length > 1
              ? `mẫu chung ${roomOk ? 'phòng' : 'nhóm'} (chấp nhận ${shared.n}/${roomOk ? open.length : todoG.length})`
              : anchor
                ? `neo, dải ${pick?.band ?? 0}`
                : open.length > 1
                  ? `mẫu chung không hợp món: mẫu chung phụ (chấp nhận ${pick?.n ?? 0})`
                  : 'tốt nhất';
        // Ngưỡng hỏng = "không làm tệ hơn" (Codex SEL-4 #1): chỉ giữ mẫu luật cũ khi chính nó qua ràng buộc cứng VÀ cùng ngân
        // sách va chạm (có trong `pass`); không thì giữ ứng viên hợp lệ tốt nhất dù đắt.
        const over = pick === undefined || m.pinTo !== undefined ? undefined : overOf(pick.f);
        const legacyOk = m.current !== null && ev.pass.has(m.current);
        const legacyShape = (ev as { legacyShape?: string }).legacyShape;
        const failKeep = over !== undefined && (legacyOk || legacyShape !== undefined);
        const fb =
          leadFb !== undefined && byLead
            ? { ...leadFb, why: `${leadFb.why}; mẫu dẫn của nhóm ghế (một bàn một bộ)` }
            : pick === undefined
              ? fallbackOf(m, ev, (f) => itemCostOf(f, role, refsOf(keyOf.get(m.id) ?? ''), ctx, memo).total)
              : undefined;
        const to = fb !== undefined ? fb.to : failKeep ? m.current : (pick as { f: string }).f;
        const miss = conceptMiss.get(m.id);
        out.set(m.id, {
          id: m.id,
          role: fb?.role ?? role,
          from: m.current,
          to,
          rule: to === m.current ? 'keep' : 'roomset',
          cause: m.pinTo !== undefined ? 'pinned' : pick === undefined ? 'fallback' : failKeep ? 'fail-keep' : to === m.current ? 'same' : 'selector',
          anchor,
          ...(cost === undefined ? {} : { cost }),
          ...(fromCost === undefined ? {} : { fromCost }),
          ...(m.sizeFrom === undefined ? {} : { by: m.sizeFrom }),
          ...(key === '' ? {} : { group: key }),
          pool: m.pool.length,
          why:
            (miss === undefined ? '' : `concept trượt: ${miss}; `) +
            (m.pinTo !== undefined
              ? 'cặp đã nhận: mẫu của món thật, chốt đúng lượt vai'
              : fb !== undefined
                ? fb.why
                : cost === undefined
                ? 'không ứng viên qua ràng buộc cứng — mẫu luật cũ'
                : failKeep && !legacyOk
                  ? `giữ mẫu luật cũ: hiện trạng, trượt hình dáng (${legacyShape ?? ''}); mẫu chung ${pick?.f ?? ''} ${(over as number).toFixed(2)} > ngưỡng hỏng ${FAIL_COST}`
                  : failKeep
                  ? `giữ mẫu luật cũ: mẫu chung của nhóm ${pick?.f ?? ''} trung bình ${(over as number).toFixed(2)} > ngưỡng hỏng ${FAIL_COST}`
                  : over !== undefined
                    ? `${via}; ${cost.toFixed(2)} > ngưỡng hỏng ${FAIL_COST} nhưng mẫu luật cũ không hợp lệ (ràng buộc cứng/va chạm) — giữ ứng viên hợp lệ`
                    : `${via}; ${cost.toFixed(2)} (${old})`),
          ...(Object.keys(ev.rejects).length > 0 ? { rejects: ev.rejects } : {}),
          ...(top.length > 0 ? { top } : {}),
          ...(fb?.uniform === undefined ? {} : { uniform: fb.uniform }),
          ...(fb?.forced === undefined ? {} : { forced: fb.forced }),
        });
        if (to !== null) placeOf(memberAs(m, fb?.uniform), to, fb?.uniform === 'real');
        // Mẫu mặc định của loại (phương án cuối `null`) dựng trong hộp: chiếm chỗ bằng cả hộp.
        else if (m.box !== undefined && m.lifted !== true) placed.push(m.kind === undefined ? boxRectOf(m.box) : { ...boxRectOf(m.box), kind: m.kind });
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
  // Đầu dò (vòng 17): mẫu giữ/ghim/cỡ người dùng ngoài phạm vi công năng — ghi sổ, không đổi.
  for (const m of inSet) {
    const d = out.get(m.id);
    if (d === undefined || d.to === null) continue;
    const dims = ctx.dimsOf(d.to);
    const shown = memberAs(m, d.uniform).shownOf?.(d.to) ?? dims;
    const miss = dims === undefined || shown === undefined ? undefined : functionalMissOf(m.role, dims, shown);
    if (miss !== undefined) out.set(m.id, { ...d, funcMiss: miss });
  }
  return out;
};
