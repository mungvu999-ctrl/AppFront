/**
 * Phối đồ trong phòng (vòng 10, thí nghiệm sau cờ `?layout=`): hàm thuần, không đọc catalog — `sceneVariety.ts`
 * gọi khi xếp hạng mẫu thư viện cho đồ TỰ ĐỘNG (đồ sinh `DRESS-`, đồ AI chưa xác nhận, không `model` người dùng gán).
 *
 * - `toneall`: luật tông gỗ của căn áp cho mọi đồ tự động (trước chỉ đồ sinh). Mẫu thiếu tông: không phạt, không thưởng.
 * - `hue`: mỗi phòng một món NEO (sofa phòng khách, giường phòng ngủ, bàn ăn ở bếp; không có thì món lớn nhất). Các món
 *   khác xếp theo hợp họ màu với neo; đúng một món NHẤN lấy độ rực vừa (dải C* 12–18), còn lại ưu tiên trung tính.
 *
 * Không cờ → không có gì đổi. Tất định: chỉ phụ thuộc đầu vào (không ngẫu nhiên, không thứ tự mảng).
 */

import type { RoomUsage } from '@/domain/spatial/types';

export type LayoutFlag = 'toneall' | 'hue';
const LAYOUT_FLAGS: readonly LayoutFlag[] = ['toneall', 'hue'];

export const layoutFlagsOf = (search: string): ReadonlySet<LayoutFlag> =>
  new Set(
    (new URLSearchParams(search).get('layout') ?? '')
      .split(',')
      .filter((v): v is LayoutFlag => (LAYOUT_FLAGS as readonly string[]).includes(v)),
  );
/** Cờ đọc MỘT lần lúc nạp trang (như `?disable=`). */
export const LAYOUT_FLAGS_ON: ReadonlySet<LayoutFlag> = typeof location === 'undefined' ? new Set() : layoutFlagsOf(location.search);

/** Họ màu trung tính (hợp mọi họ). Nâu tính trung tính: gỗ/da nâu là nền của đồ nội thất. */
const NEUTRAL: ReadonlySet<string> = new Set(['grey', 'cream', 'black', 'brown']);
export const isNeutralFamily = (h: string | undefined): boolean => h === undefined || NEUTRAL.has(h);

/** Dải độ rực (C* Lab) của món nhấn: đủ thấy màu, chưa lòe loẹt (p50 catalog = 7, p90 = 22). */
export const ACCENT_CHROMA: readonly [number, number] = [12, 18];

/**
 * Khoá hợp màu (nhỏ = hợp hơn) của món THƯỜNG với neo: cùng họ 0 → trung tính 1 → khác họ 2.
 * Neo không có họ: trung tính 0, còn lại 2 (giữ phòng dịu).
 */
export const harmonyKeyOf = (anchorH: string | undefined, h: string | undefined): number => {
  if (anchorH !== undefined && h === anchorH) return 0;
  if (isNeutralFamily(h)) return anchorH === undefined ? 0 : 1;
  return 2;
};

/**
 * Khoá của món NHẤN: [họ, độ rực]. Neo trung tính → họ nào cũng được (0); neo có màu → cùng họ hoặc trung tính 0,
 * khác họ 1 (tránh hai màu đá nhau). Độ rực: 0 trong dải, ngoài dải = khoảng cách tới dải.
 */
export const accentKeyOf = (anchorH: string | undefined, h: string | undefined, c: number): readonly [number, number] => {
  const family = isNeutralFamily(anchorH) || h === anchorH || isNeutralFamily(h) ? 0 : 1;
  const [lo, hi] = ACCENT_CHROMA;
  return [family, c < lo ? lo - c : c > hi ? c - hi : 0];
};

/** Vai của món neo theo công năng phòng (thứ tự = ưu tiên). */
const ANCHOR_ROLES: Partial<Record<RoomUsage, readonly string[]>> = {
  livingRoom: ['sofa'],
  bedroom: ['doubleBed', 'singleBed'],
  kitchen: ['diningTable'],
};
/** Vai được làm món nhấn (thứ tự = ưu tiên): ghế bành, rồi thảm, ghế băng. */
const ACCENT_ROLES: readonly string[] = ['armchair', 'rug', 'roundRug', 'bench'];
/** Không bao giờ là neo/nhấn: không có mẫu thư viện theo màu hoặc không phải đồ nội thất bày. */
const SKIP_ROLES: ReadonlySet<string> = new Set(['stair', 'fixed', 'rug', 'roundRug', 'plant', 'smallPlant']);

export interface HarmonyMember {
  readonly id: string;
  readonly role: string;
  /** Diện tích mặt bằng (m²). */
  readonly area: number;
  /** Đồ tự động (được đổi mẫu). */
  readonly auto: boolean;
}

export interface RoomHarmonyPlan {
  readonly anchorId: string | undefined;
  /** Món nhấn trong các món đã biết của phòng; `undefined` = phòng chưa có ứng viên → thảm sinh trong phòng làm nhấn. */
  readonly accentId: string | undefined;
}

const byAreaThenId = (a: HarmonyMember, b: HarmonyMember): number => b.area - a.area || a.id.localeCompare(b.id);

/** Neo + món nhấn của một phòng từ các món đã biết (đồ có sẵn, chưa gồm đồ sinh). */
export const roomHarmonyPlanOf = (members: readonly HarmonyMember[], usage: RoomUsage | undefined): RoomHarmonyPlan => {
  const wantedRoles = (usage === undefined ? undefined : ANCHOR_ROLES[usage]) ?? [];
  const anchor =
    wantedRoles.map((role) => members.filter((m) => m.role === role).sort(byAreaThenId)[0]).find((m) => m !== undefined) ??
    members.filter((m) => !SKIP_ROLES.has(m.role)).sort(byAreaThenId)[0];
  const accent = ACCENT_ROLES.map((role) =>
    members.filter((m) => m.auto && m.role === role && m.id !== anchor?.id).sort(byAreaThenId)[0],
  ).find((m) => m !== undefined);
  return { anchorId: anchor?.id, accentId: accent?.id };
};
