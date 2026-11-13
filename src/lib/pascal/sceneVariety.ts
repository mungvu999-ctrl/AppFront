/**
 * Chọn mô hình đồ đạc theo phong cách (J7): vai trò suy từ loại + hình hộp bao, ứng viên =
 * danh sách ưu tiên của phong cách ∩ catalog của vai trò mà vừa hộp (fill ≥ 0,6), chọn
 * bằng băm FNV-1a — cùng phòng + cùng vai trò thì cùng mô hình; cây và thảm băm theo món.
 *
 * Hàm thuần của (đồ đạc, phong cách, công năng phòng): không ngẫu nhiên, không phụ thuộc
 * thứ tự mảng. Giữ các cổng của `furnitureModelOf` (toPascal.ts): sofa và bàn trà chỉ ở
 * phòng khách; variant không có mô hình (`VARIANT_MODEL[v] === null`) đi đường hình hộp.
 */

import type { Furniture, RoomUsage } from '@/domain/spatial/types';
import { degrees, millimetres, millimetresToMetres } from '@/domain/units/types';

import { CATALOG_MODELS, isServerModel, VARIANT_MODEL } from './furnitureCatalog';
import LIBRARY_QC_JSON from './libraryQc.json' with { type: 'json' };
import LIBRARY_ROLES_JSON from './libraryRoles.json' with { type: 'json' };
import { isUserSeenModelId, itemFitOf } from './itemFit';
import { qualityOf } from './libraryQuality';
import { rectOfFurniture, rectsOverlap } from './placement';
import type { LayoutMove, LayoutRoom, Tried } from './layoutSearch';
import type { Rect } from './placement';
import { type Dims, fnv1a, LAYOUT_BUDGET, paletteOf, planRectOf, ROOMSET_ON, roomSetOf, SET_ROLES, textureBroken, type SetDecision, type SetMember, type SetZone } from './roomSet';
import { GENERATED_DRESS_PREFIX } from './sceneDressing';
import { accentKeyOf, harmonyKeyOf, LAYOUT_FLAGS_ON, roomHarmonyPlanOf, type LayoutFlag, type RoomHarmonyPlan } from './sceneHarmony';
import { SCENE_RULES_OFF } from './sceneLayer';
import type { SceneStyle } from './sceneStyles';

export type FurnitureRole =
  | 'doubleBed'
  | 'singleBed'
  | 'closet'
  | 'dresser'
  | 'bookshelf'
  | 'diningChair'
  /** Ghế băng / ghế ăn dài: variant `bench`, hoặc ghế dài > 1,5 m mà cạnh ngắn < 0,6 m. */
  | 'bench'
  | 'armchair'
  | 'sofa'
  | 'nightstand'
  | 'coffeeTable'
  | 'desk'
  | 'diningTable'
  | 'fridge'
  | 'counter'
  | 'toilet'
  | 'bathtub'
  | 'shower'
  | 'basin'
  /** Chậu rửa (`sanitaryFixture`) trong bếp: dãy tủ có chậu, không phải lavabo phòng tắm. */
  | 'kitchenSink'
  /** Thiết bị bếp `other` nhỏ hơn tủ lạnh (bếp nấu trong dãy tủ). */
  | 'cooktop'
  /** Món `other` dò được ngoài bếp, không rõ là gì: hộp tủ trung tính — không bao giờ là cây. */
  | 'cabinet'
  | 'washer'
  | 'plant'
  | 'smallPlant'
  | 'rug'
  | 'roundRug'
  | 'stair'
  /** Món có `variant` mà mô hình không thuộc vai trò nào (đèn, gương, tranh…). */
  | 'fixed';

/** Catalog của từng vai trò, mô hình mặc định đứng đầu. */
const ROLE_MODELS: Readonly<Record<FurnitureRole, readonly string[]>> = {
  doubleBed: ['double-bed'],
  singleBed: ['single-bed'],
  closet: ['closet'],
  dresser: ['dresser'],
  bookshelf: ['bookshelf'],
  // C2 — phong cách chỉ đổi kiểu trong cùng loại: ghế đẩu, ghế xoay không phải ghế ăn.
  diningChair: ['dining-chair'],
  bench: ['ottoman'],
  armchair: ['livingroom-chair'],
  sofa: ['sofa'],
  nightstand: ['bedside-table'],
  coffeeTable: ['coffee-table'],
  desk: ['office-table'],
  diningTable: ['dining-table'],
  fridge: ['fridge'],
  // Không dùng 'kitchen-counter' (hộp trơn): tủ có tay nắm trước, dãy dài có chậu rửa vừa hơn.
  counter: ['kitchen-cabinet', 'kitchen'],
  toilet: ['toilet'],
  bathtub: ['bathtub'],
  shower: ['shower-square'],
  basin: ['bathroom-sink'],
  kitchenSink: ['kitchen'],
  cooktop: ['stove'],
  cabinet: ['dresser'],
  washer: ['washing-machine'],
  plant: ['indoor-plant', 'small-indoor-plant'],
  smallPlant: ['small-indoor-plant', 'indoor-plant'],
  rug: ['rectangular-carpet', 'round-carpet'],
  roundRug: ['round-carpet', 'rectangular-carpet'],
  stair: [],
  fixed: [],
};

/** Vai trò băm theo từng món (mỗi cây/thảm một kiểu), còn lại theo phòng. */
const PER_ITEM_ROLES: ReadonlySet<FurnitureRole> = new Set(['plant', 'smallPlant', 'rug', 'roundRug']);

const metresOf = (valueMm: number): number => millimetresToMetres(millimetres(valueMm));

/** `reviewed`/`source`/`model` chỉ đọc khi có (đối tượng đầy đủ lúc dựng cảnh) — thiếu = coi như KHÔNG tự động. */
type Shaped = Pick<Furniture, 'kind' | 'variant' | 'boundingBox' | 'rotationDeg'> &
  Partial<Pick<Furniture, 'heightMm' | 'reviewed' | 'source' | 'model' | 'confidence' | 'edited' | 'slots'>>;

/** Cạnh ngắn/dài của mặt bằng (m) — không phụ thuộc hộp đã xoay 90° hay chưa. */
const footprintOf = (f: Shaped): readonly [number, number] => {
  const w = metresOf(f.boundingBox.max.x - f.boundingBox.min.x);
  const d = metresOf(f.boundingBox.max.y - f.boundingBox.min.y);
  return [Math.min(w, d), Math.max(w, d)];
};

const roleOfFolder = (folder: string): FurnitureRole =>
  (Object.keys(ROLE_MODELS) as FurnitureRole[]).find((role) => ROLE_MODELS[role][0] === folder) ?? 'fixed';

const COFFEE_TABLE_MAX_MM = 500;
/** Thiết bị `other` trong bếp có hai cạnh từ chừng này (m) là hộp tủ (tủ lạnh chỉ từ variant), nhỏ hơn là bếp nấu. */
const KITCHEN_FRIDGE_MIN_M = 0.55;
/** Bếp `hob` thấp hơn chừng này là mặt bếp nằm trên mặt đá (F-KITCHEN-HOB 600 × 500 × 20), không phải bếp liền lò. */
const THIN_HOB_MAX_MM = 300;

export const isThinHob = (f: Pick<Furniture, 'variant'> & Partial<Pick<Furniture, 'heightMm'>>): boolean =>
  f.variant === 'hob' && f.heightMm !== undefined && f.heightMm < THIN_HOB_MAX_MM;

/** Chậu `sink` mỏng (F-KITCHEN-SINK 800 × 450 × 20) nằm trên dãy tủ: dãy tủ đó dựng thành tủ có chậu. */
export const isThinSink = (f: Pick<Furniture, 'variant'> & Partial<Pick<Furniture, 'heightMm'>>): boolean =>
  f.variant === 'sink' && f.heightMm !== undefined && f.heightMm < THIN_HOB_MAX_MM;

/**
 * Mô hình của variant; variant không có mô hình (null) coi như không có variant.
 * Bàn `table` thấp hơn 0,5 m là bàn trà (F-LIVING-COFFEE 900 × 900 × 420), không phải bàn ăn;
 * bếp `hob` mỏng là mặt bếp `hob-sf` (bếp liền lò `stove` cao 0,85–1,09 m co đều về 20 mm thì biến mất).
 */
const variantModelOf = (f: Shaped) => {
  if (f.variant === undefined) return null;
  if (f.variant === 'table' && f.heightMm !== undefined && f.heightMm < COFFEE_TABLE_MAX_MM) return { folder: 'coffee-table' };
  if (isThinHob(f)) return { folder: 'hob-sf' };
  return VARIANT_MODEL[f.variant] ?? null;
};

/** Ghế dài hơn chừng này (m) là sofa hoặc ghế băng, theo cạnh ngắn (`SOFA_MIN_SHORT_M`). */
const LONG_SEAT_M = 1.5;
const SOFA_MIN_SHORT_M = 0.6;
/** Thiết bị vệ sinh (C2, E6 x2): khu tắm từ diện tích này (m²), bồn tắm từ cạnh dài này (m). */
const SHOWER_MIN_AREA_M2 = 1.0;
const BATHTUB_MIN_LONG_M = 1.4;
/** Bồn cầu: dài/ngắn ≥ 1,5 và cạnh dài ≤ 1,0 m; lavabo cùng cỡ nhưng vuông hơn. */
const TOILET_MIN_RATIO = 1.5;
const TOILET_MAX_LONG_M = 1.0;

/** Bàn cỡ bàn làm việc chỉ là `desk` ở các phòng này (hoặc không rõ phòng); bếp, phòng khách… là bàn ăn. */
const DESK_USAGES: ReadonlySet<RoomUsage | undefined> = new Set([undefined, 'bedroom', 'utility', 'other']);

/**
 * Vai trò của một món: có mô hình variant thì theo mô hình đó (không xét phòng), không thì
 * theo hình hộp. C2 — chỉ đổi loại khi có bằng chứng: ghế dài là sofa/ghế băng ở mọi phòng,
 * tủ lạnh chỉ từ variant, tủ áo nông vẫn là tủ; bàn trà vẫn chỉ ở phòng khách.
 */
const shapeRoleOf = (f: Shaped, usage?: RoomUsage): FurnitureRole => {
  const byVariant = variantModelOf(f);
  if (byVariant) return roleOfFolder(byVariant.folder);
  const living = usage === 'livingRoom';

  const [short, long] = footprintOf(f);
  const h = f.heightMm === undefined ? undefined : metresOf(f.heightMm);

  switch (f.kind) {
    case 'stair':
      return 'stair';
    case 'bed':
      return short < 1.2 ? 'singleBed' : 'doubleBed';
    case 'wardrobe':
      return h !== undefined && h < 1 ? 'dresser' : 'closet';
    case 'chair':
      if (long > LONG_SEAT_M) return short >= SOFA_MIN_SHORT_M ? 'sofa' : 'bench';
      return short >= 0.65 && long <= 1.5 ? 'armchair' : 'diningChair';
    case 'table':
      // Khoảng cách tới giường (≤ 0,3 m) xét ở `contextRolesOf` — roleOf chỉ thấy một món.
      if (long < 0.6 && usage === 'bedroom') return 'nightstand';
      if (living && h !== undefined && h < 0.5) return 'coffeeTable';
      return short <= 0.8 && long <= 1.6 && DESK_USAGES.has(usage) ? 'desk' : 'diningTable';
    case 'kitchenCabinet':
      // Tủ lạnh chỉ khi variant nói (`fridge`), không đoán theo cỡ.
      return 'counter';
    case 'sanitaryFixture':
      if (usage === 'kitchen') return 'kitchenSink';
      // Bồn tắm trước khu tắm: bồn ≥ 1,4 m luôn có diện tích ≈ 1 m², xét diện tích trước thì luật bồn tắm chết.
      if (long >= BATHTUB_MIN_LONG_M) return 'bathtub';
      if (short * long >= SHOWER_MIN_AREA_M2) return 'shower';
      if (long / short >= TOILET_MIN_RATIO && long <= TOILET_MAX_LONG_M) return 'toilet';
      return 'basin';
    case 'washingMachine':
      return 'washer';
    case 'shower':
      return 'shower';
    case 'other':
      if (h !== undefined && h < 0.05) return long - short < 0.15 * long ? 'roundRug' : 'rug';
      if (living && long > 1.5) return 'sofa';
      // Món dò được không bao giờ là cây: cây chỉ đến từ variant `plant`/`planter` của đồ bày biện.
      // Tủ lạnh chỉ từ variant: món lớn không nhãn trong bếp là hộp tủ.
      if (usage === 'kitchen') return short >= KITCHEN_FRIDGE_MIN_M ? 'cabinet' : 'cooktop';
      return 'cabinet';
  }
};

/**
 * L1 (vòng 17) — giường chỉ khi hộp đủ cỡ giường. Giường đơn hẹp nhất thực tế ~0,75 × 1,9 m (small single); cạnh dài
 * cho dung sai hộp dò ~15 % (1,9 × 0,85 ≈ 1,6). Thư viện: profile `doubleBed` (libraryRoles.json) p-thấp dài 2031 /
 * ngắn 1502 mm; `singleBed` chưa có profile (5 mẫu). Hộp 0,81 × 0,86 m hay 0,91 × 0,51 m không phải giường nào.
 */
const BED_MIN_SHORT_M = 0.75;
const BED_MIN_LONG_M = 1.6;
/** Phòng ngủ: giường đơn cỡ thật 0,9 × 1,9 m trừ trần vượt hộp 0,4 m (roomSet REAL_GROW_M). */
const BEDROOM_MIN_SHORT_M = 0.5;
const BEDROOM_MIN_LONG_M = 1.5;
const BED_ROLES: ReadonlySet<FurnitureRole> = new Set(['doubleBed', 'singleBed']);
/** L2 — vai đặc thù chỉ hợp các công năng này (vắng công năng = không xét); bếp mở nằm trong phòng khách, WC riêng trong phòng ngủ. */
const BED_USAGES: ReadonlySet<RoomUsage> = new Set(['bedroom', 'other']);
const KITCHEN_USAGES: ReadonlySet<RoomUsage> = new Set(['kitchen', 'livingRoom', 'other']);
const WC_USAGES: ReadonlySet<RoomUsage> = new Set(['bathroom', 'bedroom', 'other']);
const ROLE_USAGES: Partial<Record<FurnitureRole, ReadonlySet<RoomUsage>>> = {
  doubleBed: BED_USAGES,
  singleBed: BED_USAGES,
  counter: KITCHEN_USAGES,
  cooktop: KITCHEN_USAGES,
  kitchenSink: KITCHEN_USAGES,
  fridge: KITCHEN_USAGES,
  toilet: WC_USAGES,
  bathtub: WC_USAGES,
  shower: WC_USAGES,
};
/** Món AI dưới độ tin cậy này ở phòng ngoài bảng → vai chưa chắc. */
const ROLE_DOUBT_CONFIDENCE = 0.7;
/** Hộp ngoài [p-thấp / 1,4; p-cao × 1,4] của profile vai (libraryRoles.json) → cỡ không phải vai ấy. */
const PROFILE_SLACK = 1.4;
const PROFILES = (LIBRARY_ROLES_JSON as { readonly profiles?: Readonly<Record<string, { readonly long: readonly number[]; readonly short: readonly number[] }>> })
  .profiles ?? {};
const outOfProfile = (f: Shaped, role: FurnitureRole): boolean => {
  const p = PROFILES[role];
  if (p === undefined) return false;
  const [short, long] = footprintOf(f).map((m) => m * 1000) as [number, number];
  const out = (v: number, band: readonly number[]): boolean =>
    v < (band[0] as number) / PROFILE_SLACK || v > (band[band.length - 1] as number) * PROFILE_SLACK;
  return out(long, p.long) || out(short, p.short);
};
/** Món AI chưa ai xác nhận (không reviewed/human/edited, không mẫu/khe người dùng): thiếu trường = coi như đã xác nhận. */
const isUnconfirmedAi = (f: Shaped): boolean =>
  f.reviewed === false && f.source !== 'human' && f.edited !== true && f.model === undefined && f.slots === undefined;
const fmt = (m: number): string => m.toFixed(2).replace('.', ',');

/**
 * Lý do vai theo hình (`shapeRoleOf`) của món AI chưa xác nhận là CHƯA XÁC ĐỊNH (vắng = vai tin được):
 * L1 hộp không đủ cỡ giường; L2 vai đặc thù ở phòng ngoài bảng `ROLE_USAGES` mà tin cậy < 0,7 hoặc cỡ ngoài profile vai.
 * Món tin cậy cao, đúng cỡ (giường đôi 2,3 × 2,6 m trong phòng khách — có thể phòng đa năng) giữ vai.
 * Sổ bộ phòng (`roomSetReport`, trường `doubt`) ghi lý do này.
 */
export const roleDoubtOf = (f: Shaped, usage?: RoomUsage): string | undefined => {
  if (!isUnconfirmedAi(f)) return undefined;
  const role = shapeRoleOf(f, usage);
  const [short, long] = footprintOf(f);
  // R7 (set17 nt03t: hộp 0,70 × 1,71 m trong phòng ngủ thành đôn — "phòng ngủ không giường"): trong phòng ngủ nhãn giường là
  // bằng chứng mạnh; chỉ nghi khi cả giường đơn cỡ thật (0,9 × 1,9 m) cũng vượt hộp quá REAL_GROW_M (0,4 m).
  const bedroom = usage === 'bedroom';
  if (BED_ROLES.has(role) && (short < (bedroom ? BEDROOM_MIN_SHORT_M : BED_MIN_SHORT_M) || long < (bedroom ? BEDROOM_MIN_LONG_M : BED_MIN_LONG_M)))
    return `chưa xác định: hộp ${fmt(short)} × ${fmt(long)} m không đủ cỡ giường`;
  const allowed = ROLE_USAGES[role];
  if (allowed === undefined || usage === undefined || allowed.has(usage)) return undefined;
  const lowConf = f.confidence !== undefined && f.confidence < ROLE_DOUBT_CONFIDENCE;
  if (!lowConf && !outOfProfile(f, role)) return undefined;
  const why = lowConf ? `tin cậy ${fmt(f.confidence as number)}` : `hộp ${fmt(short)} × ${fmt(long)} m ngoài cỡ vai`;
  return `chưa xác định: vai ${role} không hợp phòng ${usage}, ${why}`;
};

/**
 * Vai trung tính của món vai chưa xác định: "giường" thấp (hoặc không rõ cao) → ghế đôn/băng; còn lại (giường cao, tủ bếp,
 * thiết bị vệ sinh) → hộp tủ trung tính. Không sinh mẫu giường thu nhỏ.
 */
const NEUTRAL_LOW_MAX_M = 0.6;
const neutralRoleOf = (f: Shaped, role: FurnitureRole): FurnitureRole =>
  BED_ROLES.has(role) && (f.heightMm === undefined || metresOf(f.heightMm) < NEUTRAL_LOW_MAX_M) ? 'bench' : 'cabinet';

/**
 * Vai trò của một món: có mô hình variant thì theo mô hình đó, không thì theo hình hộp (`shapeRoleOf`); món AI chưa
 * xác nhận có vai chưa xác định (`roleDoubtOf`, L1/L2 vòng 17) → vai trung tính. Một chỗ chung cho editor, viewer,
 * toPascal, lớp bày/trang trí. Đồ người dùng xác nhận không đổi vai.
 */
export const roleOf = (f: Shaped, usage?: RoomUsage): FurnitureRole => {
  const role = shapeRoleOf(f, usage);
  return roleDoubtOf(f, usage) === undefined ? role : neutralRoleOf(f, role);
};

/**
 * Chi phí cỡ của mô hình với hộp bao (C3): `|ln(L/Lm)| + |ln(S/Sm)|` theo cạnh dài/ngắn; 0 = đúng cỡ.
 * Khác `fillOf` cũ (chỉ so dáng): mẫu cùng dáng nhưng to gấp đôi giờ cũng bị phạt.
 */
const sizeCostOf = (f: Shaped, folder: string): number => {
  const model = CATALOG_MODELS[folder];
  if (model === undefined) return Infinity;
  const [short, long] = footprintOf(f);
  const [mw, , md] = model.dimensions;
  return Math.abs(Math.log(long / Math.max(mw, md))) + Math.abs(Math.log(short / Math.min(mw, md)));
};

/** Phong cách chỉ phá hoà giữa các mẫu có chi phí cỡ trong 10 % của mẫu vừa nhất. */
const STYLE_TIE = 1.1;

/**
 * Mẫu thư viện máy chủ theo vai trò (đồ `fixed` thì theo variant: tv, vase). Sinh một lần từ hồ sơ mẫu
 * F:/runs/library-profiles/profiles.jsonl: chỉ mẫu qc.ok + mặt trước đúng, giấy phép CC0/CC-BY (ghi công
 * hiện khi chọn món, `serverAttributionOf`). Bỏ đèn (mất nguồn sáng), tủ bếp dãy, gương/tranh (cần gắn tường).
 */
const LIBRARY = LIBRARY_ROLES_JSON as {
  readonly roles: Readonly<Record<string, readonly string[]>>;
  /**
   * s = mã phong cách (0–3 trong 12 mã), c = độ rực màu đo từ ảnh (C* Lab), t = tông gỗ chủ đạo (`l` sáng /
   * `d` tối, theo vật liệu hồ sơ), h = họ màu của màu chiếm nhiều nhất (cream/black/grey/brown/…).
   */
  readonly models: Readonly<Record<string, { readonly s: readonly string[]; readonly c: number; readonly t?: string; readonly h?: string }>>;
};

/** Phong cách + phần lớp cảnh tính một lần cho cả căn (`standardSceneOf`): luật đã tắt, tông gỗ của căn (`woodToneOf`). */
export type LayerStyle = SceneStyle & {
  readonly rulesOff?: ReadonlySet<string>;
  readonly woodTone?: 'l' | 'd';
  /** Thí nghiệm phối đồ `?layout=` (`sceneHarmony.ts`); thiếu = cờ URL lúc nạp. */
  readonly layout?: ReadonlySet<LayoutFlag>;
  /** Bộ nội thất theo phòng (`roomSet.ts`, mặc định bật, `?disable=roomset` tắt); thiếu = cờ URL lúc nạp. */
  readonly roomSet?: boolean;
};

const SAVED_FOLDER = /\/items\/([^/]+)\//;
/**
 * Luật `tone` (C): tông gỗ của căn = đa số tông (sáng/tối) của mẫu đang dựng cho đồ CÓ SẴN (người dùng xác nhận + AI);
 * hoà hoặc không món gỗ nào → đa số tông các mẫu thư viện của mã phong cách đầu (`libraryStyles[0]`), hoà → sáng.
 * `undefined` khi phong cách không có mã thư viện. Đồ sinh (`DRESS-`) không tính.
 */
export const woodToneOf = (
  items: readonly { readonly f: Shaped & Pick<Furniture, 'id' | 'roomId'> & Partial<Pick<Furniture, 'model'>>; readonly usage?: RoomUsage }[],
  style: SceneStyle,
): 'l' | 'd' | undefined => {
  const count = { l: 0, d: 0 };
  // Tông của căn đếm trên mẫu KHÔNG phối (`hue` dùng sổ phòng của lượt dựng, chưa có lúc này) → như khi không cờ.
  harmonySuspended = true;
  try {
    for (const { f, usage } of items) {
      if (isGenerated(f) || f.kind === 'stair') continue;
      const folder = f.model === undefined ? modelFolderOf(f, style, usage) : (SAVED_FOLDER.exec(f.model.src)?.[1] ?? null);
      const t = folder === null ? undefined : LIBRARY.models[folder]?.t;
      if (t === 'l' || t === 'd') count[t] += 1;
    }
  } finally {
    harmonySuspended = false;
  }
  if (count.l !== count.d) return count.d > count.l ? 'd' : 'l';
  const first = style.libraryStyles?.[0];
  if (first === undefined) return undefined;
  const byStyle = { l: 0, d: 0 };
  for (const m of Object.values(LIBRARY.models)) if (m.s.includes(first) && (m.t === 'l' || m.t === 'd')) byStyle[m.t] += 1;
  return byStyle.d > byStyle.l ? 'd' : 'l';
};
const rulesOffOf = (style: SceneStyle): ReadonlySet<string> => (style as LayerStyle).rulesOff ?? SCENE_RULES_OFF;
const isGenerated = (f: Pick<Furniture, 'id'>): boolean => f.id.startsWith(GENERATED_DRESS_PREFIX);
const layoutOf = (style: SceneStyle): ReadonlySet<LayoutFlag> => (style as LayerStyle).layout ?? LAYOUT_FLAGS_ON;
/**
 * Lựa chọn TỰ ĐỘNG (được thí nghiệm `?layout=` đổi mẫu): đồ sinh, hoặc đồ AI chưa xác nhận (`reviewed === false`,
 * không phải nguồn người) mà người dùng chưa gán mẫu. Mẫu concept chọn không đi qua xếp hạng thư viện nên tự giữ.
 */
const isAuto = (f: Pick<Furniture, 'id'> & Shaped): boolean =>
  isGenerated(f) || (f.reviewed === false && f.source !== 'human' && f.model === undefined);

/**
 * Luật `orient` (B): chi phí cỡ THEO HƯỚNG TRỤC — rộng mẫu với rộng hộp, sâu với sâu (`swap` = món xoay 90°).
 * `sizeCostOf` so cạnh dài/ngắn đã sắp xếp nên mẫu dài theo x vẫn "vừa" hộp dài theo y, rồi bị bóp từng trục.
 */
const orientedCostOf = (f: Shaped, folder: string, swap = false): number => {
  const model = CATALOG_MODELS[folder];
  if (model === undefined) return Infinity;
  const w = metresOf(f.boundingBox.max.x - f.boundingBox.min.x);
  const d = metresOf(f.boundingBox.max.y - f.boundingBox.min.y);
  const [mw, , md] = model.dimensions;
  const [a, b] = swap ? [d, w] : [w, d];
  return Math.abs(Math.log(a / mw)) + Math.abs(Math.log(b / md));
};
/** Mẫu nằm ngang hộp: xoay 90° vừa hơn quá chừng này (ln 1,2 ≈ lệch 20 % một trục). */
const ORIENT_MARGIN = Math.log(1.2);
const misOriented = (f: Shaped, folder: string): boolean => orientedCostOf(f, folder) - orientedCostOf(f, folder, true) > ORIENT_MARGIN;
/** Vai không có mặt trước rõ: xoay món 90° giữ dấu chân và giữ đúng mẫu đã chọn (không đổi màu/kiểu). */
const ROTATABLE_ROLES: ReadonlySet<FurnitureRole> = new Set(['rug', 'roundRug', 'coffeeTable', 'diningTable']);
const libraryFoldersOf = (role: FurnitureRole, variant: string | undefined): readonly string[] =>
  (role === 'fixed' ? (variant === undefined ? undefined : LIBRARY.roles[variant]) : LIBRARY.roles[role]) ?? [];
/** Mẫu thư viện vừa cỡ: chi phí cỡ không quá mẫu vừa nhất + chừng này (khớp hộp còn co giãn từng trục). */
const LIBRARY_SIZE_SLACK = 0.3;

/**
 * Hạng phong cách của mẫu với danh sách mã của căn (sớm = hợp hơn): trùng mã thứ i → i; mẫu trung tính
 * (không mã) đứng sau mọi mã; lệch phong cách xếp cuối.
 */
const styleTierOf = (folder: string, wanted: readonly string[]): number => {
  const styles = LIBRARY.models[folder]?.s ?? [];
  const hits = wanted.map((code, i) => (styles.includes(code) ? i : Infinity));
  const best = Math.min(...hits);
  if (best !== Infinity) return best;
  return styles.length === 0 ? wanted.length : wanted.length + 1;
};

/**
 * Mẫu thư viện của một món: cả căn một phong cách (`style.libraryStyles`), rồi màu dịu (độ rực thấp) để
 * các món hợp nhau, cuối cùng vừa cỡ. Cùng vai trò ra cùng mẫu khắp căn (bộ đồng bộ); cây/thảm thì đổi
 * theo từng món trong nhóm hợp nhất. null = thư viện chưa nạp mẫu nào của vai trò.
 */
/** Giường dưới chuẩn hoàn thiện (`libraryQuality`: nhãn khác `full`); lỗi QC đã do `QC_EXCLUDED` (`libraryQc.json`) lo. */
const belowQuality = (folder: string, role: FurnitureRole): boolean => {
  const q = qualityOf(folder);
  if (q === undefined) return false;
  // Vân vỡ khi dựng (cờ texture 'broken'): luật cũ (phương án cuối) cũng không tự chọn, mọi vai.
  if (textureBroken(q)) return true;
  return (role === 'doubleBed' || role === 'singleBed') && q.completeness !== undefined && q.completeness.v !== 'full';
};
const libraryModelOf = (f: Shaped & Pick<Furniture, 'id'> & Partial<Pick<Furniture, 'roomId'>>, role: FurnitureRole, style: SceneStyle): string | null => {
  const all = libraryFoldersOf(role, f.variant).filter(isServerModel);
  const pick = rankedLibraryPickOf(f, role, style, all);
  if (pick === null || (!QC_EXCLUDED.has(pick) && !belowQuality(pick, role))) return pick;
  // Mẫu bị loại (libraryQc.json) hoặc dưới chuẩn hoàn thiện (vòng 13: giường chưa đủ chăn gối): xếp hạng
  // lại trên phần còn lại; cả vai hết mẫu đạt thì giữ hành vi cũ. Áp cho MỌI món (kể cả món đã xác nhận nhưng chưa gán mẫu):
  // thư viện lớn lên không được kéo lựa chọn mặc định xuống mẫu kém hơn.
  const ok = all.filter((folder) => !QC_EXCLUDED.has(folder) && !belowQuality(folder, role));
  if (ok.length === 0) {
    // Hết mẫu đạt: giữ hành vi cũ, nhưng KHÔNG BAO GIỜ trả mẫu vân vỡ (Codex SEL-4 #2) — xếp lại trên phần không vỡ, hết
    // thì null (bên gọi đi đường mẫu dựng sẵn như khi chưa có thư viện).
    if (!textureBrokenOf(pick)) return pick;
    const whole = all.filter((folder) => !textureBrokenOf(folder));
    return whole.length === 0 ? null : rankedLibraryPickOf(f, role, style, whole);
  }
  const replacement = rankedLibraryPickOf(f, role, style, ok);
  if (replacement !== null) QC_SWAPS.set(f.id, { from: pick, to: replacement, role });
  return replacement ?? pick;
};
/** Mẫu có cờ texture 'broken' (vân vỡ khi dựng) — không đường tự chọn nào trả nó. */
const textureBrokenOf = (folder: string): boolean => {
  const q = qualityOf(folder);
  return q !== undefined && textureBroken(q);
};

interface QcSwap {
  readonly from: string;
  readonly to: string;
  readonly role: FurnitureRole;
}
/**
 * Kiểm chất lượng thư viện (`libraryQc.json`, sinh từ audit.mjs + duyệt mắt): mẫu lỗi thật nhìn thấy được không
 * được CHỌN TỰ ĐỘNG (luật thư viện, mẫu AI chọn). Món người dùng đã chỉ định (`model`) không đi qua `modelFolderOf`
 * nên giữ nguyên. Tắt: đặt `excluded` rỗng.
 */
const QC_EXCLUDED: ReadonlySet<string> = new Set(Object.keys((LIBRARY_QC_JSON as { readonly excluded: object }).excluded));
/** Lần thay mẫu gần nhất theo id món — chỉ để công bố "mẫu bị loại → mẫu thay", không ảnh hưởng kết quả. */
const QC_SWAPS = new Map<string, QcSwap>();
/** Món → { mẫu bị loại, mẫu thay, vai } của các lần chọn tự động đã phải thay mẫu. */
export const libraryQcSwaps = (): ReadonlyMap<string, QcSwap> => QC_SWAPS;

const rankedLibraryPickOf = (
  f: Shaped & Pick<Furniture, 'id'> & Partial<Pick<Furniture, 'roomId'>>,
  role: FurnitureRole,
  style: SceneStyle,
  library: readonly string[],
): string | null => {
  if (library.length === 0) return null;
  const best = Math.min(...library.map((folder) => sizeCostOf(f, folder)));
  const wanted = style.libraryStyles ?? [];
  const layout = layoutOf(style);
  const auto = isAuto(f);
  /* Luật `tone` (C): món sinh — mẫu lệch tông gỗ của căn xếp sau, trong cùng giới hạn cỡ (đồ AI/người dùng không đổi).
     `?layout=toneall`: mở cho MỌI đồ tự động (AI chưa xác nhận). Mẫu thiếu tông: miss 0 (không phạt, không thưởng). */
  const toneOn = isGenerated(f) || (layout.has('toneall') && auto);
  const tone = toneOn && !rulesOffOf(style).has('tone') ? (style as LayerStyle).woodTone : undefined;
  const toneMiss = (folder: string): number => {
    const t = LIBRARY.models[folder]?.t;
    return tone !== undefined && t !== undefined && t !== tone ? 1 : 0;
  };
  const harmony = layout.has('hue') && auto ? harmonyOf(f, role, style) : undefined;
  const hueKeys = (folder: string): readonly [number, number] => {
    const m = LIBRARY.models[folder];
    if (harmony === undefined) return [0, m?.c ?? 0];
    return harmony.accent ? accentKeyOf(harmony.h, m?.h, m?.c ?? 0) : [harmonyKeyOf(harmony.h, m?.h), m?.c ?? 0];
  };
  const ranked = library
    .filter((folder) => sizeCostOf(f, folder) <= best + LIBRARY_SIZE_SLACK)
    .map((folder) => ({ folder, miss: toneMiss(folder), tier: styleTierOf(folder, wanted), hue: hueKeys(folder) }))
    .sort((a, b) => a.miss - b.miss || a.tier - b.tier || a.hue[0] - b.hue[0] || a.hue[1] - b.hue[1] || a.folder.localeCompare(b.folder));
  const head = ranked[0];
  const top = ranked
    .filter((r) => r.tier === head?.tier && r.miss === head?.miss && r.hue[0] === head?.hue[0])
    .slice(0, PER_ITEM_ROLES.has(role) && harmony?.accent !== true ? 4 : 1);
  const chosen = top[fnv1a(f.id) % top.length];
  const first = chosen?.folder ?? null;
  const pick = first;
  const logged = (folder: string | null): string | null => {
    if (harmony !== undefined && folder !== null && chosen !== undefined) {
      const m = LIBRARY.models[folder];
      HARMONY_LOG.set(f.id, {
        roomId: harmony.roomId,
        role,
        folder,
        accent: harmony.accent,
        reason: `tier=${chosen.tier} tone=${chosen.miss === 0 ? 'ok' : 'lech'} ${harmony.accent ? 'nhan' : 'hop'}=${chosen.hue[0]} h=${m?.h ?? '-'} c=${m?.c ?? '-'}`,
      });
    }
    return folder;
  };
  /* Luật `orient` (B), món sinh có mặt trước (giường, tủ…): mẫu nằm ngang hộp → mẫu khác CÙNG HỌ MÀU vừa hướng hơn;
     không có thì giữ mẫu cũ (không đổi tông chỉ để khớp hướng). Vai đối xứng thì xoay món (`orientedGenerated`). */
  if (pick === null || !isGenerated(f) || ROTATABLE_ROLES.has(role) || rulesOffOf(style).has('orient') || !misOriented(f, pick)) return logged(pick);
  const family = LIBRARY.models[pick]?.h;
  const own = orientedCostOf(f, pick);
  const better = library
    .filter((folder) => family !== undefined && LIBRARY.models[folder]?.h === family && orientedCostOf(f, folder) + ORIENT_MARGIN < own)
    .map((folder) => ({ folder, miss: toneMiss(folder), tier: styleTierOf(folder, wanted), chroma: LIBRARY.models[folder]?.c ?? 0 }))
    .sort((a, b) => a.miss - b.miss || a.tier - b.tier || a.chroma - b.chroma || a.folder.localeCompare(b.folder));
  return logged(better[0]?.folder ?? pick);
};

/* ---- Phối đồ theo phòng (`?layout=hue`, `sceneHarmony.ts`) ---- */

interface HarmonyRoom {
  readonly usage: RoomUsage | undefined;
  readonly plan: RoomHarmonyPlan;
  readonly anchor: Placed | undefined;
  readonly anchorRole: FurnitureRole | undefined;
  /** Mẫu + họ màu của neo, tính lần đầu cần trong lượt dựng (phong cách cố định trong lượt). */
  anchorPick?: { readonly folder: string | null; readonly h: string | undefined };
}
interface HarmonyEntry {
  readonly roomId: string;
  readonly role: FurnitureRole;
  readonly folder: string;
  readonly accent: boolean;
  readonly reason: string;
}
/** Sổ phòng của lượt dựng hiện tại (`contextRolesOf` ghi lại mỗi lượt). */
const HARMONY_ROOMS = new Map<string, HarmonyRoom>();
const HARMONY_LOG = new Map<string, HarmonyEntry>();
let harmonySuspended = false;

/** Phối của một món tự động: họ màu neo + có phải món nhấn; `undefined` = món là neo / phòng chưa có sổ. */
const harmonyOf = (
  f: Shaped & Pick<Furniture, 'id'> & Partial<Pick<Furniture, 'roomId'>>,
  role: FurnitureRole,
  style: SceneStyle,
): { readonly roomId: string; readonly h: string | undefined; readonly accent: boolean } | undefined => {
  if (harmonySuspended || f.roomId === undefined) return undefined;
  const room = HARMONY_ROOMS.get(f.roomId);
  if (room === undefined || room.anchor === undefined || room.plan.anchorId === f.id) return undefined;
  if (room.anchorPick === undefined) {
    const a = room.anchor;
    const folder =
      a.model !== undefined ? (SAVED_FOLDER.exec(a.model.src)?.[1] ?? null) : modelFolderOf(a, style, room.usage, room.anchorRole);
    room.anchorPick = { folder, h: folder === null ? undefined : LIBRARY.models[folder]?.h };
  }
  // Phòng chưa có ứng viên nhấn trong đồ có sẵn: thảm (thường do lớp trang trí sinh) làm món nhấn.
  const accent = room.plan.accentId === undefined ? role === 'rug' || role === 'roundRug' : room.plan.accentId === f.id;
  return { roomId: f.roomId, h: room.anchorPick.h, accent };
};

const registerHarmonyRooms = (
  items: readonly Placed[],
  usageOf: (f: Placed) => RoomUsage | undefined,
  roles: ReadonlyMap<string, FurnitureRole>,
): void => {
  HARMONY_ROOMS.clear();
  HARMONY_LOG.clear();
  const byRoom = new Map<string, Placed[]>();
  for (const f of items) if (f.roomId !== undefined && f.kind !== 'stair') byRoom.set(f.roomId, [...(byRoom.get(f.roomId) ?? []), f]);
  for (const [roomId, list] of byRoom) {
    const usage = usageOf(list[0] as Placed);
    const roleOfItem = (f: Placed): FurnitureRole => roles.get(f.id) ?? roleOf(f, usage);
    const plan = roomHarmonyPlanOf(
      list.map((f) => {
        const [short, long] = footprintOf(f);
        return { id: f.id, role: roleOfItem(f), area: short * long, auto: isAuto(f) };
      }),
      usage,
    );
    const anchor = list.find((f) => f.id === plan.anchorId);
    HARMONY_ROOMS.set(roomId, { usage, plan, anchor, anchorRole: anchor === undefined ? undefined : roles.get(anchor.id) });
  }
};

type HarmonyReport = Record<
  string,
  {
    readonly usage: RoomUsage | undefined;
    readonly anchor: { readonly id: string; readonly folder: string | null; readonly h: string | undefined } | null;
    readonly accent: string;
    readonly items: readonly { readonly id: string; readonly role: FurnitureRole; readonly folder: string; readonly accent: boolean; readonly reason: string }[];
  }
>;
/**
 * Đầu dò `?layout=hue`: mỗi phòng → neo (id, mẫu, họ màu), món nhấn, và các món tự động đã phối (vai → mẫu, lý do).
 * Rỗng khi không cờ. `accent: 'rug'` = phòng không có ghế bành/ghế băng tự động → thảm làm nhấn.
 */
export const harmonyReport = (): HarmonyReport => {
  const out: Record<string, HarmonyReport[string]> = {};
  for (const [roomId, room] of HARMONY_ROOMS) {
    const items = [...HARMONY_LOG]
      .filter(([, e]) => e.roomId === roomId)
      .map(([id, e]) => ({ id, role: e.role, folder: e.folder, accent: e.accent, reason: e.reason }));
    if (items.length === 0) continue;
    out[roomId] = {
      usage: room.usage,
      anchor: room.plan.anchorId === undefined ? null : { id: room.plan.anchorId, folder: room.anchorPick?.folder ?? null, h: room.anchorPick?.h },
      accent: room.plan.accentId ?? 'rug',
      items,
    };
  }
  return out;
};

/**
 * Luật `orient` (B) cho món sinh vai đối xứng (thảm, bàn trà, bàn ăn): mẫu đã chọn nằm ngang hộp thì xoay MÓN 90°
 * (đổi hai cạnh hộp — dấu chân trên sàn không đổi) để chính mẫu ấy khớp hộp không méo; giữ đúng mẫu, đúng màu.
 * Món không phải đồ sinh, hoặc `?disable=orient`, giữ nguyên.
 */
export const orientedGenerated = (f: Furniture, style: SceneStyle, usage?: RoomUsage): Furniture => {
  if (!isGenerated(f) || rulesOffOf(style).has('orient') || !ROTATABLE_ROLES.has(roleOf(f, usage))) return f;
  const folder = modelFolderOf(f, style, usage);
  if (folder === null || !misOriented(f, folder)) return f;
  const { min, max } = f.boundingBox;
  const cx = (min.x + max.x) / 2;
  const cy = (min.y + max.y) / 2;
  const hw = (max.y - min.y) / 2;
  const hd = (max.x - min.x) / 2;
  return {
    ...f,
    rotationDeg: degrees((f.rotationDeg + 90) % 360),
    boundingBox: { min: { x: cx - hw, y: cy - hd }, max: { x: cx + hw, y: cy + hd } } as Furniture['boundingBox'],
  };
};

type FolderInput = Pick<Furniture, 'id' | 'kind' | 'variant' | 'boundingBox' | 'rotationDeg' | 'roomId'> &
  Partial<Pick<Furniture, 'heightMm' | 'reviewed' | 'source' | 'model'>>;

/**
 * Thư mục mô hình của một món theo phong cách; `null` = không có mô hình (bên gọi dựng
 * chỗ giữ chỗ). Cùng hợp đồng với `furnitureModelOf` của `toPascal.ts`, chỉ trả thư mục.
 * Bộ nội thất theo phòng (`roomset`, mặc định): món trong phạm vi lấy mẫu của bộ phòng (`roomSet.ts`).
 */
export const modelFolderOf = (
  f: FolderInput,
  style: SceneStyle,
  usage?: RoomUsage,
  /** Vai trò theo ngữ cảnh phòng (`contextRolesOf`): đè cả variant, chỉ đổi mẫu. */
  roleOverride?: FurnitureRole,
): string | null => {
  if (harmonySuspended) return baseFolderOf(f, style, usage, roleOverride);
  if (roomSetOn(style)) return roomSetFolderOf(f, style, usage, roleOverride);
  return baseFolderOf(f, style, usage, roleOverride);
};

/** Mẫu concept AI chọn cho vai (`sceneStyleFromConcept` đặt đầu `prefer`): mẫu thư viện máy chủ đầu tiên; vắng = không có. */
const conceptOf = (role: FurnitureRole, style: SceneStyle): string | undefined => (style.prefer[role] ?? []).find(isServerModel);

/** `noConcept`: bỏ mẫu concept khỏi `prefer` — mẫu luật cũ của món chưa ghim khi bộ chọn bật (concept là ứng viên ưu tiên của `roomSetOf`, không phải luật cũ). */
const baseFolderOf = (f: FolderInput, style: SceneStyle, usage?: RoomUsage, roleOverride?: FurnitureRole, noConcept = false): string | null => {
  const role = roleOverride ?? roleOf(f, usage);
  // Codex M17-1 #3: vai đã trung tính hoá (`roleDoubtOf`) thì variant gốc (giường) không còn quyết mẫu — mọi đường mẫu
  // (thư viện, ưu tiên, mặc định) theo VAI HIỆU LỰC, không ra mẫu giường thu nhỏ.
  const variantOf = roleOverride === undefined && role === shapeRoleOf(f, usage) ? variantModelOf : (): null => null;
  const catalogue = ROLE_MODELS[role];
  const best = Math.min(...catalogue.map((folder) => sizeCostOf(f, folder)));
  const isNearBest = (folder: string): boolean => sizeCostOf(f, folder) <= best * STYLE_TIE + 1e-9;
  /* AID-01: mẫu thư viện máy chủ mà AI chọn cho vai trò (`sceneStyleFromConcept`) không nằm trong
     `ROLE_MODELS` — máy chủ đã lọc theo loại, cỡ khớp bằng `asset.scale`, nên không qua ngưỡng cỡ. */
  // Luật cũ của món chưa ghim khi bộ chọn bật: không bao giờ ra mẫu concept, kể cả khi luật thư viện tự chọn trúng nó
  // (Codex M16-1 #1) — concept chỉ vào cảnh qua `roomSetOf` khi qua ràng buộc cứng; hết lựa chọn → mẫu dựng sẵn.
  const excluded = noConcept ? conceptOf(role, style) : undefined;
  const libraryOf = (): string | null => {
    const x = libraryModelOf(f, role, style);
    return x === excluded ? null : x;
  };
  const preferred = (style.prefer[role] ?? []).filter((folder) =>
    catalogue.includes(folder) ? isNearBest(folder) : !noConcept && isServerModel(folder),
  );
  const key = PER_ITEM_ROLES.has(role) ? f.id : `${f.roomId ?? 'none'}|${role}`;
  const hashed = (folders: readonly string[]): string => folders[fnv1a(key) % folders.length] as string;
  /* Mẫu AI chọn bị loại (libraryQc.json, chỉ mẫu máy chủ): băm trên CẢ danh sách như cũ — món băm vào mẫu tốt giữ
     đúng mẫu ấy; chỉ món băm vào mẫu bị loại mới băm lại trên phần còn lại; danh sách lọc xong rỗng thì luật thư viện. */
  // Mẫu vân vỡ (cờ texture) cũng bị loại khỏi mẫu concept chọn (Codex SEL-4 #2); hết lựa chọn → mẫu dựng sẵn của vai/variant.
  const isRejected = (folder: string): boolean => (QC_EXCLUDED.has(folder) && !catalogue.includes(folder)) || textureBrokenOf(folder);
  const builtIn = variantOf(f)?.folder ?? catalogue[0] ?? null;
  const pickHashed = (folders: readonly string[]): string | null => {
    const first = hashed(folders);
    if (!isRejected(first)) return first;
    const good = folders.filter((folder) => !isRejected(folder));
    const replacement = good.length > 0 ? hashed(good) : libraryOf();
    if (replacement === null || isRejected(replacement)) return textureBrokenOf(first) ? builtIn : first;
    QC_SWAPS.set(f.id, { from: first, to: replacement, role });
    return replacement;
  };

  // Mẫu đẹp của thư viện máy chủ thay mẫu Pascal low-poly cùng loại (khi thư viện đã nạp); mẫu AI chọn vẫn thắng.
  if (!preferred.some(isServerModel)) {
    const library = libraryOf();
    if (library !== null) return library;
  }

  const byVariant = variantOf(f);
  if (byVariant) {
    return preferred.some((folder) => folder !== byVariant.folder) ? pickHashed(preferred) : byVariant.folder;
  }
  if (catalogue.length === 0) return null;
  if (preferred.length > 0) return pickHashed(preferred);

  // Không ưu tiên nào vừa: mô hình mặc định nếu nó gần vừa nhất (giữ dáng cảnh hôm nay), không thì
  // mô hình chi phí cỡ nhỏ nhất — hoà thì mô hình đứng trước.
  const [fallback] = catalogue as readonly [string, ...string[]];
  if (isNearBest(fallback)) return fallback;
  return catalogue.reduce((a, folder) => (sizeCostOf(f, folder) < sizeCostOf(f, a) ? folder : a));
};

/** Một phòng có tối đa chừng này bồn cầu; món thừa (độ tin thấp nhất trước) dựng thành lavabo. */
const MAX_TOILETS_PER_ROOM = 2;
/** Bàn nhỏ phòng ngủ là tủ đầu giường chỉ khi cách giường gần nhất ≤ chừng này (mm). */
const NIGHTSTAND_MAX_GAP_MM = 300;
/**
 * R7 (set17 cn21/cn22: bàn 0,8 × 0,6 m sát sofa dựng thành bàn ăn cao 0,75 m): bàn nhỏ trong phòng khách sát sofa/ghế bành và
 * không có ghế ăn quanh là bàn trà — lỗi ánh xạ vai, không đổi công năng phòng.
 */
const COFFEE_MAX_LONG_M = 1.3;
const COFFEE_SOFA_GAP_MM = 600;
const COFFEE_CHAIR_GAP_MM = 300;

type Placed = Shaped & Pick<Furniture, 'id' | 'centre' | 'roomId' | 'confidence'>;

/**
 * Vai trò theo ngữ cảnh cả phòng, đè lên `roleOf` khi chọn mẫu (không ghi variant vào dữ liệu):
 * phòng quá 2 bồn cầu thì món thừa thành lavabo; tủ đầu giường xa giường > 0,3 m thành bàn phụ.
 */
export const contextRolesOf = (
  items: readonly Placed[],
  usageOf: (f: Placed) => RoomUsage | undefined,
  /** Món dựng KHỚP ĐÚNG hộp (cặp đã nhận, `adoptedPairOf`): bộ chọn đo cỡ hiển thị của nó đúng như lúc dựng. */
  exactFitOf: (f: Placed) => boolean = () => false,
): ReadonlyMap<string, FurnitureRole> => {
  // Điểm vào một lượt dựng cảnh: `toPascalScene` gọi đúng một lần, trước vòng chọn mẫu → sổ thay mẫu chỉ giữ lượt này.
  QC_SWAPS.clear();
  SET_ROOMS.clear();
  SET_OBSTACLES.clear();
  SET_EXACT.clear();
  SET_PINNED.clear();
  SET_REVS.clear();
  for (const f of items) if (exactFitOf(f)) SET_EXACT.add(f.id);
  SET_LOG.clear();
  SET_TIMING = { ms: 0, rooms: 0, layoutMs: 0 };
  SET_LAYOUT_RUN = { left: LAYOUT_BUDGET, ms: 0 };
  SET_MOVES.clear();
  SET_UNPLACED.clear();
  SET_APPLIED.clear();
  setPlans = new WeakMap();
  const roles = new Map<string, FurnitureRole>();
  const toiletsOf = new Map<string, Placed[]>();
  const beds = items.filter((f) => f.kind === 'bed');
  const baseRole = new Map(items.map((f) => [f.id, roleOf(f, usageOf(f))] as const));
  /** Ghế/sofa theo phòng (R7 bàn trà) — một lần, không quét cả cảnh cho mỗi bàn (Codex M17-12 P2). */
  const seatsByRoom = new Map<string | undefined, Placed[]>();
  for (const x of items) {
    const r = baseRole.get(x.id);
    if (r === 'sofa' || r === 'armchair' || r === 'diningChair') seatsByRoom.set(x.roomId, [...(seatsByRoom.get(x.roomId) ?? []), x]);
  }

  for (const f of items) {
    const role = baseRole.get(f.id) ?? roleOf(f, usageOf(f));
    if (role === 'toilet' && f.roomId !== undefined) toiletsOf.set(f.roomId, [...(toiletsOf.get(f.roomId) ?? []), f]);
    // Codex M17-12 P1: chỉ món AI chưa xác nhận — đồ người dùng xác nhận / có mẫu / khe vật liệu không đổi vai.
    if ((role === 'diningTable' || role === 'desk') && isUnconfirmedAi(f) && usageOf(f) === 'livingRoom' && footprintOf(f)[1] <= COFFEE_MAX_LONG_M) {
      const rect = rectOfFurniture(f);
      const near = (r: FurnitureRole, gap: number): boolean =>
        (seatsByRoom.get(f.roomId) ?? []).some((x) => baseRole.get(x.id) === r && rectsOverlap(rect, rectOfFurniture(x), gap + 1));
      if ((near('sofa', COFFEE_SOFA_GAP_MM) || near('armchair', COFFEE_SOFA_GAP_MM)) && !near('diningChair', COFFEE_CHAIR_GAP_MM)) roles.set(f.id, 'coffeeTable');
    }
    if (role === 'nightstand') {
      const rect = rectOfFurniture(f);
      const nearBed = beds.some((bed) => rectsOverlap(rect, rectOfFurniture(bed), NIGHTSTAND_MAX_GAP_MM + 1));
      // Bàn phụ: mẫu bàn trà co về cỡ bàn nhỏ (catalog chưa có mẫu bàn phụ riêng).
      if (!nearBed) roles.set(f.id, 'coffeeTable');
    }
  }
  for (const toilets of toiletsOf.values()) {
    [...toilets]
      .sort((a, b) => b.confidence - a.confidence || a.id.localeCompare(b.id))
      .slice(MAX_TOILETS_PER_ROOM)
      .forEach((f) => roles.set(f.id, 'basin'));
  }
  registerHarmonyRooms(items, usageOf, roles);
  addSetMembers(items, usageOf, roles);
  return roles;
};

/** Món nằm trên sàn (không nâng, không thảm, không chậu/mặt bếp mỏng trên mặt đá): chiếm chỗ, không được chồng. */
/** Độ nâng khỏi sàn (mm): `liftMm` của món, không có thì độ nâng mặc định của biến thể (đèn bàn, đồ treo tường). */
const liftOf = (f: Pick<Furniture, 'liftMm' | 'variant'>): number =>
  f.liftMm ?? (f.variant === undefined ? undefined : VARIANT_MODEL[f.variant]?.liftMm) ?? 0;
const isFloorStanding = (f: Furniture): boolean => {
  const role = roleOf(f);
  return liftOf(f) === 0 && role !== 'rug' && role !== 'roundRug' && !isThinHob(f) && !isThinSink(f);
};

/**
 * Lưới chặn cuối của đồ sinh ra: món đứng sàn chồng khung bao lên đồ thật hoặc món sinh đã giữ (cùng tầng)
 * thì bỏ. Đồ trang trí nâng lên (bình, đèn bàn trên mặt bàn/kệ), thảm, chậu/bếp trên dãy tủ được nằm chồng.
 */
export const withoutOverlaps = (generated: readonly Furniture[], fixed: readonly Furniture[]): Furniture[] => {
  const taken = fixed.filter(isFloorStanding).map((f) => ({ levelId: f.levelId, rect: rectOfFurniture(f) }));
  return generated.filter((f) => {
    if (!isFloorStanding(f)) return true;
    const rect = rectOfFurniture(f);
    if (taken.some((t) => t.levelId === f.levelId && rectsOverlap(rect, t.rect))) return false;
    taken.push({ levelId: f.levelId, rect });
    return true;
  });
};

/* ---- Bộ nội thất theo phòng (`?enable=roomset`, `roomSet.ts`, vòng 12 làn S) ---- */

const roomSetOn = (style: SceneStyle): boolean => (style as LayerStyle).roomSet ?? ROOMSET_ON;
type SetInput = FolderInput & Partial<Pick<Furniture, 'edited' | 'slots' | 'centre' | 'liftMm'>>;
/** Twin của cặp đã nhận → mẫu đã lưu của món thật (`addRoomSetMembers`): ghim, không chấm như đồ sinh. */
const SET_PINNED = new Map<string, string>();
/**
 * Món GHIM: mẫu người dùng chọn / cặp đã nhận (`model`), khe vật liệu theo mẫu đang có (`slots`), twin của cặp đã nhận.
 * Mẫu concept AI chọn cho vai (`style.prefer`) KHÔNG phải ghim (vòng 16): là ứng viên ưu tiên của `roomSetOf`, chỉ được
 * chọn khi qua mọi ràng buộc cứng của món. Mọi món vai bộ còn lại lấy mẫu từ MỘT đánh giá; luật cũ chỉ là phương án cuối.
 */
const isPinned = (f: SetInput): boolean => f.model !== undefined || f.slots !== undefined || SET_PINNED.has(f.id);
/** Nguồn cỡ của món chưa ghim: đồ sinh / AI chưa xác nhận / người dùng đã xác nhận (hộp không bao giờ đổi). */
const sizeFromOf = (f: SetInput): NonNullable<SetMember['sizeFrom']> =>
  isGenerated(f) ? 'generated' : f.reviewed === false && f.source !== 'human' && f.edited !== true ? 'ai' : 'user';
/** Chữ ký món lúc đăng ký: dữ liệu đổi (cỡ, phòng, loại, nguồn, ghim, mẫu) thì quyết định cũ không dùng. */
const setSigOf = (f: SetInput): string => {
  const [short, long] = footprintOf(f);
  return [
    f.kind,
    f.variant ?? '',
    short.toFixed(3),
    long.toFixed(3),
    f.roomId,
    f.slots === undefined ? 0 : 1,
    isGenerated(f) ? 'g' : sizeFromOf(f),
    f.model?.src ?? '',
  ].join('|');
};
interface SetRoom {
  readonly usage: RoomUsage | undefined;
  readonly members: Map<string, { readonly f: SetInput; readonly role: FurnitureRole; readonly override?: FurnitureRole; readonly sig: string }>;
}
/** Sổ phòng của lượt dựng: đồ đã lưu (`contextRolesOf`) + đồ bày phòng trống (`addRoomSetMembers`, trước lớp trang trí). */
const SET_ROOMS = new Map<string, SetRoom>();
/** Phòng → đồ ĐỨNG SÀN không thuộc bộ (tủ lạnh, bồn cầu, cây…) — vật cản khi kiểm va chạm cả phòng (đo ở `planRoom`). */
const SET_OBSTACLES = new Map<string, Map<string, { readonly f: SetInput; readonly usage: RoomUsage | undefined; readonly override?: FurnitureRole }>>();
/** Id món dựng khớp đúng hộp trong lượt dựng (cặp đã nhận) — `shownOf` dùng cùng phép khớp với `toPascal`. */
const SET_EXACT = new Set<string>();
/** Hộp chỗ đặt của món (m): tâm + cạnh theo khung riêng + góc xoay; vắng tâm = không kiểm hộp/va chạm. */
const setBoxOf = (f: SetInput): SetMember['box'] =>
  f.centre === undefined
    ? undefined
    : {
        cx: metresOf(f.centre.x),
        cy: metresOf(f.centre.y),
        w: metresOf(f.boundingBox.max.x - f.boundingBox.min.x),
        d: metresOf(f.boundingBox.max.y - f.boundingBox.min.y),
        rot: f.rotationDeg,
      };
/** Đang trong `planRoom` (chặn đệ quy). */
let setPlanning = false;
/** Id phòng → khoá nội dung (`roomSetKeysOf`) của lượt dựng; vắng thì băm theo id. */
let SET_ROOM_KEYS: ReadonlyMap<string, string> = new Map();
/** Id phòng → chiều cao trần (m) của lượt dựng (chiều cao tầng mà toPascal dựng tường); vắng = không kiểm hở trần. */
let SET_ROOM_CEILINGS: ReadonlyMap<string, number> = new Map();
/** Id phòng → vùng chặn (m) của tầng chứa phòng: vùng mở cửa đi, thân tường (`placement.doorSwingRects/wallRects`). */
let SET_ROOM_ZONES: ReadonlyMap<string, readonly SetZone[]> = new Map();
/** toPascal: khoá nội dung + chiều cao trần + vùng chặn các phòng của lượt dựng, gọi trước vòng chọn mẫu. */
export const setRoomSetKeys = (
  keys: ReadonlyMap<string, string>,
  ceilings: ReadonlyMap<string, number> = new Map(),
  zones: ReadonlyMap<string, readonly SetZone[]> = new Map(),
  layoutRooms: ReadonlyMap<string, LayoutRoom> = new Map(),
): void => {
  SET_ROOM_KEYS = keys;
  SET_ROOM_CEILINGS = ceilings;
  SET_ROOM_ZONES = zones;
  SET_ROOM_LAYOUTS = layoutRooms;
};
/** M18 L2: id phòng → hình học bố trí (`layoutRoomOf`); vắng = thang dời chỗ T1–T3 không chạy cho phòng (như vòng 17). */
let SET_ROOM_LAYOUTS: ReadonlyMap<string, LayoutRoom> = new Map();
/** Ngân sách dời-thử + thời gian tìm chỗ của cả căn trong lượt dựng (`contextRolesOf` làm mới). */
let SET_LAYOUT_RUN = { left: LAYOUT_BUDGET, ms: 0 };
/** Id món (neo hoặc thành viên cụm đi theo) → kết quả dời của lượt dựng. */
const SET_MOVES = new Map<string, LayoutMove>();
/** Món chưa bố trí được (T4) của lượt dựng. */
export interface UnplacedEntry {
  readonly id: string;
  readonly roomId: string;
  readonly role: string;
  readonly reason: string;
  /** Hộp đã lưu (m). */
  readonly box: Rect;
  readonly tried: Tried;
}
const SET_UNPLACED = new Map<string, UnplacedEntry>();
/** Quyết định đã chốt trong lượt dựng theo đối tượng phong cách (mỗi lượt một đối tượng); `contextRolesOf` làm mới. */
let setPlans = new WeakMap<SceneStyle, Map<string, SetDecision>>();
/** Sổ báo cáo (đầu dò): id món → quyết định + phòng + băm danh sách mẫu thấy được của vai. */
const SET_LOG = new Map<string, SetDecision & { readonly roomId: string; readonly rev?: string; readonly doubt?: string }>();
/** Món thật sự dựng bằng mẫu `roomset` khác mẫu luật cũ trong lượt. */
const SET_APPLIED = new Set<string>();
/** Thời gian chọn bộ (ms) của lượt dựng hiện tại: tổng `roomSetOf` + số phòng (đầu dò `roomSetTiming`). */
let SET_TIMING = { ms: 0, rooms: 0, layoutMs: 0 };
/** Vai → băm danh sách mẫu thư viện thấy được (nhớ trong lượt). */
const SET_REVS = new Map<string, string>();
/** Mẫu thư viện máy chủ THẤY ĐƯỢC của vai (trước lọc QC/hướng) — đầu dò `roomSetPools`, băm `rev`. */
const visibleOf = (role: FurnitureRole, variant?: string): string[] => libraryFoldersOf(role, variant).filter(isServerModel);
const revOf = (role: FurnitureRole): string => {
  const hit = SET_REVS.get(role);
  if (hit !== undefined) return hit;
  const rev = fnv1a([...visibleOf(role)].sort().join(',')).toString(36);
  SET_REVS.set(role, rev);
  return rev;
};

const addSetMembers = <T extends SetInput>(
  items: readonly T[],
  usageOf: (f: T) => RoomUsage | undefined,
  roles?: ReadonlyMap<string, FurnitureRole>,
): void => {
  for (const f of items) {
    if (f.roomId === undefined || f.kind === 'stair') continue;
    const usage = usageOf(f);
    const override = roles?.get(f.id);
    const role = override ?? roleOf(f, usage);
    if (!SET_ROLES.includes(role)) {
      // Vật cản: đứng sàn (không nâng, không thảm, không chậu/bếp mỏng trên mặt đá), có toạ độ.
      const box = setBoxOf(f);
      if (box !== undefined && liftOf(f) === 0 && role !== 'rug' && role !== 'roundRug' && !isThinHob(f) && !isThinSink(f)) {
        const room = SET_OBSTACLES.get(f.roomId) ?? new Map();
        room.set(f.id, { f, usage, ...(override === undefined ? {} : { override }) });
        SET_OBSTACLES.set(f.roomId, room);
      }
      continue;
    }
    const room = SET_ROOMS.get(f.roomId) ?? { usage, members: new Map() };
    SET_ROOMS.set(f.roomId, room);
    room.members.set(f.id, { f, role, ...(override === undefined ? {} : { override }), sig: setSigOf(f) });
  }
};
/**
 * toPascal: đồ bày phòng trống vào sổ bộ TRƯỚC lớp trang trí (đèn bàn/chăn đọc mẫu của món chủ). `realOf` = món thật của
 * twin (cặp đã nhận). MỘT đại diện cho mỗi cặp (Codex SEL-1 #2): món thật đã có trong sổ (người dùng đổi mẫu → nó đi qua
 * `contextRolesOf`) thì twin chỉ là bí danh, không vào va chạm/bảng màu; chưa có (mẫu luật đã lưu) thì id twin đại diện
 * với HÌNH HỌC và mẫu của món thật, chốt ĐÚNG lượt vai của nó như khi còn là đồ sinh (`pinTo`) — anh em thấy cùng thứ tự
 * ngữ cảnh như trước khi nhận. Twin luôn trả mẫu của món thật khi hỏi (`modelFolderOf`, chủ trang trí).
 */
export const addRoomSetMembers = (
  items: readonly Furniture[],
  usageOf: (f: Pick<Furniture, 'roomId'>) => RoomUsage | undefined,
  realOf: (f: Furniture) => Furniture | undefined = () => undefined,
): void => {
  const own: Furniture[] = [];
  for (const f of items) {
    const real = realOf(f);
    if (real === undefined) {
      own.push(f);
      continue;
    }
    const folder = real.model === undefined ? undefined : SAVED_FOLDER.exec(real.model.src)?.[1];
    if (folder !== undefined) SET_PINNED.set(f.id, folder);
    const registered = real.roomId !== undefined && (SET_ROOMS.get(real.roomId)?.members.has(real.id) === true || SET_OBSTACLES.get(real.roomId)?.has(real.id) === true);
    if (registered) continue;
    // Hình học THẬT của món thật (cỡ, cao, nâng, xoay — người dùng có thể đã co giãn/nâng) dưới id đại diện; cặp nhận
    // dựng khớp đúng hộp (exact-fit) như `toPascal`. Thứ tự chốt vẫn theo lượt vai (`pinTo`), không cố định từ đầu.
    SET_EXACT.add(f.id);
    own.push({ ...real, id: f.id });
  }
  addSetMembers(own, usageOf);
};

/** Ứng viên của món chưa ghim: MỌI mẫu thư viện của vai (không lọc theo cỡ luật cũ), trừ QC loại; đồ sinh có mặt trước: bỏ mẫu nằm ngang hộp. */
/** F8 (vòng 17): vai nhỏ hơn cùng nhóm đồ chứa, thử theo thứ tự khi không mẫu nào của vai vừa hộp ở cỡ thật (roomSet `smaller`). */
const SMALLER_STORAGE: Partial<Record<FurnitureRole, readonly FurnitureRole[]>> = {
  closet: ['bookshelf', 'dresser'],
  dresser: ['nightstand'],
  cabinet: ['nightstand'],
};

/**
 * Mẫu thư viện máy chủ ĐỔI ĐƯỢC của vai (thẻ "Đổi mẫu", M18 LA): cùng tập bộ chọn thấy (`visibleOf` − QC loại), trừ mẫu
 * vân vỡ; không lọc hướng/cỡ (người dùng chọn). Rỗng = thư viện chưa nạp mẫu nào của vai.
 */
export const swapPoolOf = (role: string, variant?: string): string[] =>
  visibleOf(role as FurnitureRole, variant).filter((x) => !QC_EXCLUDED.has(x) && !textureBrokenOf(x));

const setPoolOf = (f: SetInput, role: FurnitureRole, style: SceneStyle): readonly string[] => {
  const lib = visibleOf(role, f.variant).filter((x) => !QC_EXCLUDED.has(x));
  const orient = isGenerated(f) && !ROTATABLE_ROLES.has(role) && !rulesOffOf(style).has('orient');
  return orient ? lib.filter((x) => !misOriented(f, x)) : lib;
};

const planRoom = (roomId: string, room: SetRoom, style: SceneStyle, decided: ReadonlyMap<string, SetDecision>): Map<string, SetDecision> => {
  const wanted = style.libraryStyles ?? [];
  const ceilingM = SET_ROOM_CEILINGS.get(roomId);
  /** Cỡ HIỂN THỊ [rộng, cao, sâu] m của mẫu `x` trong hộp của món — đúng phép khớp dựng cảnh (`itemFitOf`, cặp nhận khớp đúng). */
  const shownIn = (f: SetInput, x: string, uniform = false): Dims | undefined =>
    ceilingM === undefined
      ? undefined
      : itemFitOf(
          x,
          metresOf(f.boundingBox.max.x - f.boundingBox.min.x),
          metresOf(f.boundingBox.max.y - f.boundingBox.min.y),
          f.heightMm,
          ceilingM * 1000,
          SET_EXACT.has(f.id),
          uniform,
        )?.shownM;
  // Vùng chặn: vùng mở cửa + thân tường của tầng, và mặt bằng HIỂN THỊ của đồ đứng sàn ngoài bộ (mẫu đã lưu, không thì
  // mẫu luật — vai ngoài bộ); không xác định được mẫu → hộp.
  const obstacles: SetZone[] = [...(SET_OBSTACLES.get(roomId)?.values() ?? [])].flatMap(({ f, usage, override }) => {
    const box = setBoxOf(f);
    if (box === undefined) return [];
    const saved = f.model === undefined ? undefined : (SAVED_FOLDER.exec(f.model.src)?.[1] ?? null);
    const folder = saved !== undefined ? saved : baseFolderOf(f, style, usage, override);
    const shown = folder === null ? undefined : shownIn(f, folder);
    // `folder`: đồ ngoài bộ góp màu vào bảng màu bộ (vòng 17, `roomSet` SetRef).
    return [{ ...planRectOf(box.cx, box.cy, shown?.[0] ?? box.w, shown?.[2] ?? box.d, box.rot), kind: f.kind, ...(folder === null ? {} : { folder }) }];
  });
  const members: SetMember[] = [...room.members.values()].map(({ f, role, override }) => {
    const twinPin = SET_PINNED.get(f.id);
    const pin = twinPin ?? (f.model === undefined ? undefined : (SAVED_FOLDER.exec(f.model.src)?.[1] ?? null));
    // M18 LA (S3, LF1): mẫu NGƯỜI DÙNG chọn qua "Đổi mẫu" (hậu tố cỡ-đã-thấy, không khe/twin): món vào bộ chọn NHƯ MÓN AI
    // CHƯA GHIM (pool, luật cũ, concept) + `userModel` — anh em giữ đúng quyết định như trước khi đổi. `model` lưu từ trước
    // (không hậu tố: vòng cũ, cặp nhận, mẫu luật) giữ hành vi ghim cũ.
    const userSeen = twinPin === undefined && f.slots === undefined && f.model !== undefined && isUserSeenModelId(f.model.id);
    const pinned = twinPin === undefined && !userSeen && isPinned(f);
    const concept = pinned || twinPin !== undefined ? undefined : conceptOf(role, style);
    const [short, long] = footprintOf(f);
    const box = setBoxOf(f);
    return {
      id: f.id,
      role,
      kind: f.kind,
      ...(box === undefined ? {} : { box }),
      ...(liftOf(f) === 0 ? {} : { lifted: true, liftM: metresOf(liftOf(f)) }),
      // LF2: lưu sau "Đổi mẫu" làm máy chủ đặt `edited` (BE provenance) — quyết định ảo bỏ cờ ấy để anh em thấy đúng nguồn cỡ
      // như trước khi đổi. ponytail: món đã sửa+lưu TRƯỚC khi đổi mẫu cũng mất cờ ở đây; thêm dấu riêng nếu ca ấy cần.
      sizeFrom: userSeen ? sizeFromOf({ ...f, edited: false }) : sizeFromOf(f),
      ...(f.heightMm === undefined ? {} : { heightM: metresOf(f.heightMm) }),
      short,
      long,
      // Món chưa ghim: mẫu luật cũ CHỈ là phương án cuối + để sổ so (`from`).
      // Mẫu luật cũ của món chưa ghim không chứa mẫu concept: concept trượt ràng buộc cứng thì không quay lại qua `fallback`/`fail-keep`.
      current: pin !== undefined && !userSeen ? pin : baseFolderOf(f, style, room.usage, override, !pinned),
      // Mẫu dựng sẵn của vai: phương án cuối khi luật cũ trượt dáng/công năng (roomSet `fallbackOf`).
      ...(ROLE_MODELS[role][0] === undefined ? {} : { stock: ROLE_MODELS[role][0] }),
      pool: pinned || twinPin !== undefined ? [] : setPoolOf(f, role, style),
      ...(pinned || twinPin !== undefined || SMALLER_STORAGE[role] === undefined
        ? {}
        : { smaller: SMALLER_STORAGE[role].map((r) => ({ role: r, pool: setPoolOf(f, r, style) })) }),
      fixed: pinned,
      ...(userSeen ? { userModel: pin ?? null } : {}),
      ...(concept === undefined
        ? {}
        : {
            concept: {
              folder: concept,
              ...(QC_EXCLUDED.has(concept) ? { reject: 'QC loại' } : {}),
              ...(ceilingM === undefined ? {} : { shownOf: (x: string) => shownIn(f, x, true) }),
            },
          }),
      ...(twinPin === undefined ? {} : { pinTo: twinPin }),
      ...(ceilingM === undefined
        ? {}
        : {
            ceilingM,
            // Cỡ hiển thị = đúng phép co dựng cảnh (`itemFitOf`) trong hộp của món, trần tầng làm chặn cao.
            shownOf: (x: string) => shownIn(f, x),
          }),
    };
  });
  const tone = rulesOffOf(style).has('tone') ? undefined : (style as LayerStyle).woodTone;
  const t0 = performance.now();
  const plan = roomSetOf(
    SET_ROOM_KEYS.get(roomId) ?? roomId,
    members,
    decided,
    {
      tierOf: (x) => styleTierOf(x, wanted),
      tiers: wanted.length,
      dimsOf: (x) => CATALOG_MODELS[x]?.dimensions,
      palette: paletteOf(style, tone),
    },
    [...(SET_ROOM_ZONES.get(roomId) ?? []), ...obstacles],
    ((layoutRoom) => (layoutRoom === undefined ? undefined : { room: layoutRoom, run: SET_LAYOUT_RUN }))(SET_ROOM_LAYOUTS.get(roomId)),
  );
  SET_TIMING = { ms: SET_TIMING.ms + performance.now() - t0, rooms: SET_TIMING.rooms + 1, layoutMs: SET_LAYOUT_RUN.ms };
  for (const [id, d] of plan) {
    const member = room.members.get(id);
    const doubt = member === undefined ? undefined : roleDoubtOf(member.f, room.usage);
    SET_LOG.set(id, { ...d, roomId, rev: revOf(d.role as FurnitureRole), ...(doubt === undefined ? {} : { doubt }) });
    // Thành viên cụm tra ngược theo id; món tự dời riêng (move của chính nó) thắng move của neo.
    if (d.move !== undefined) for (const mp of d.move.members) if (!d.move.broken.includes(mp.id) && plan.get(mp.id)?.move === undefined) SET_MOVES.set(mp.id, d.move);
    if (d.move !== undefined) SET_MOVES.set(id, d.move);
    const box = member === undefined ? undefined : setBoxOf(member.f);
    if (d.unplaced !== undefined && box !== undefined) {
      SET_UNPLACED.set(id, { id, roomId, role: d.role, reason: d.unplaced.reason, box: planRectOf(box.cx, box.cy, box.w, box.d, box.rot), tried: d.unplaced.tried });
    }
  }
  return plan;
};

const roomSetFolderOf = (f: FolderInput, style: SceneStyle, usage?: RoomUsage, roleOverride?: FurnitureRole): string | null => {
  const current = baseFolderOf(f, style, usage, roleOverride);
  const room = f.roomId === undefined ? undefined : SET_ROOMS.get(f.roomId);
  const member = room?.members.get(f.id);
  const role = roleOverride ?? roleOf(f, usage);
  let folder = current;
  /** Mốc so "đã đổi do roomset": mẫu luật cũ của chính quyết định (`from`) khi áp quyết định (Codex M16-1 #3). */
  let baseline = current;
  const pin = SET_PINNED.get(f.id);
  // Đang lập bộ (planRoom gọi mẫu luật cũ của từng món; `?layout=hue` hỏi mẫu neo qua modelFolderOf) → mẫu luật cũ, không đệ quy.
  // Vai/ngữ cảnh khác lúc đăng ký (chữ ký, vai) → luật cũ. Twin của cặp đã nhận → mẫu của món thật.
  if (pin !== undefined) folder = pin;
  else if (!setPlanning && room !== undefined && member !== undefined && member.sig === setSigOf(f) && member.role === role) {
    const plan = setPlans.get(style) ?? new Map<string, SetDecision>();
    setPlans.set(style, plan);
    // Lập bộ cả khi món hỏi là món ghim (sổ đủ mục cho phòng chỉ có món ghim — Codex SEL-1 #5).
    if (!plan.has(f.id)) {
      setPlanning = true;
      try {
        for (const [id, d] of planRoom(f.roomId as string, room, style, plan)) plan.set(id, d);
      } finally {
        setPlanning = false;
      }
    }
    const decision = plan.get(f.id);
    if (decision !== undefined && !isPinned(f)) {
      folder = decision.to;
      baseline = decision.from;
    }
  }
  if (folder !== baseline) SET_APPLIED.add(f.id);
  else SET_APPLIED.delete(f.id);
  return folder;
};

/** Món dựng mẫu concept bằng CO ĐỀU trong lượt dựng (concept giữ dù lệch tỉ lệ hộp, `roomSetOf`): toPascal khớp `uniform`. */
export const roomSetUniformOf = (id: string, folder: string): boolean | 'real' => {
  const d = SET_LOG.get(id);
  // Vòng 17 (làn A): 'real' = phương án cuối dựng CỠ THẬT, được vượt hộp AI.
  return d !== undefined && d.to === folder ? (d.uniform ?? false) : false;
};

/** Vai HIỆU LỰC bộ chọn đã dùng cho món trong lượt dựng (kể cả vai ngữ cảnh) — dựng cảnh áp lưng tường theo đúng vai này (Codex M17-4 #1). */
export const roomSetRoleOf = (id: string): string | undefined => SET_LOG.get(id)?.role;

/**
 * Món CHƯA xác nhận (đồ sinh / AI) bị bộ chọn từ chối mọi mẫu: dựng ẩn (`visible: false`, giữ node để lượt lưu không đọc
 * thành xoá) thay vì khung dây đỏ — trạng thái "chưa xác định", dữ liệu giữ nguyên, sổ ghi lý do. Món người dùng xác nhận
 * vẫn hiện khung để họ thấy và sửa. Vòng 17: khung đỏ là lý do thua chính ở 9/14 nhóm phòng kém hơn trong chấm mù hồi quy.
 */
export const roomSetHiddenOf = (id: string): boolean => {
  const d = SET_LOG.get(id);
  return d !== undefined && d.to === null && d.by !== 'user';
};

/** Bộ chọn đã từ chối mọi mẫu cho món (phương án cuối `to: null`) trong lượt dựng hiện tại. */
export const roomSetRejectedOf = (id: string): boolean => {
  const d = SET_LOG.get(id);
  return d !== undefined && d.to === null;
};

/** Món đổi mẫu do `roomset` trong lượt dựng hiện tại (toPascal ghi provenance; đồ người dùng xác nhận không mang prov `ai`). */
export const roomSetSwapOf = (id: string): SetDecision | undefined => {
  const d = SET_LOG.get(id);
  return d?.rule === 'roomset' && d.by !== 'user' && SET_APPLIED.has(id) ? d : undefined;
};

/**
 * toPascal, cuối lượt dựng: lập bộ cho mọi phòng còn món chưa có quyết định (phòng chỉ có món ghim, món dựng bằng mẫu đã
 * lưu không bao giờ hỏi `modelFolderOf`) — sổ đủ mục ghim kèm neo/nhóm, độc lập với lượt tra mẫu. Roomset tắt: không làm gì.
 */
export const finishRoomSet = (style: SceneStyle): void => {
  if (!roomSetOn(style)) return;
  const plan = setPlans.get(style) ?? new Map<string, SetDecision>();
  setPlans.set(style, plan);
  for (const [roomId, room] of SET_ROOMS) {
    if ([...room.members.keys()].every((id) => plan.has(id))) continue;
    setPlanning = true;
    try {
      for (const [id, d] of planRoom(roomId, room, style, plan)) plan.set(id, d);
    } finally {
      setPlanning = false;
    }
  }
};

/** Đầu dò `__pascalProbe.roomSetPools()`: vai bộ → mẫu thư viện thấy được (QA so catalog giữa hai lượt, tách A/B/C). */
export const roomSetPools = (): Record<string, readonly string[]> =>
  Object.fromEntries(SET_ROLES.map((role) => [role, visibleOf(role as FurnitureRole)]));

/** Đầu dò `__pascalProbe.roomSetTiming()`: thời gian chọn bộ của lượt dựng gần nhất (ms, số phòng). */
export const roomSetTiming = (): { readonly ms: number; readonly rooms: number; readonly layoutMs: number } => ({ ...SET_TIMING });

/**
 * M18 L2: kết quả dời chỗ của món trong lượt dựng (neo, hoặc thành viên cụm — tư thế ở `members`). `to` = tâm mặt bằng CỠ
 * THẬT của mẫu `modelId` (thư mục mẫu, như `SetDecision.to`); toPascal áp vào BẢN SAO, không ghi kho.
 */
export const roomSetMoveOf = (id: string): LayoutMove | undefined => SET_MOVES.get(id);

/** M18 L2: món chưa bố trí được (T4) của lượt dựng — node vẫn tạo, ẩn; chip "Chưa bố trí được". */
export const roomSetUnplaced = (): readonly UnplacedEntry[] => [...SET_UNPLACED.values()];

/** `doubt`: vai món chưa xác định (`roleDoubtOf`), món dựng bằng vai trung tính. */
type RoomSetEntry = SetDecision & { readonly roomId: string; readonly rev?: string; readonly doubt?: string };
/** Đầu dò `__pascalProbe.roomSet()`: phòng → neo + từng món (vai, mẫu cũ → mới, luật, chi phí, lý do giữ/chọn). */
export const roomSetReport = (): Record<string, { readonly anchor: string | null; readonly items: readonly RoomSetEntry[] }> => {
  const out: Record<string, { anchor: string | null; items: RoomSetEntry[] }> = {};
  for (const d of SET_LOG.values()) {
    const room = (out[d.roomId] ??= { anchor: null, items: [] });
    room.items.push(d);
    if (d.anchor && room.anchor === null) room.anchor = d.id;
  }
  return out;
};
