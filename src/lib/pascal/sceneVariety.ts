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
import { rectOfFurniture, rectsOverlap } from './placement';
import LIBRARY_COLORS_JSON from './libraryColors.json' with { type: 'json' };
import {
  chairSetFolderOf,
  fitsSpot,
  fnv1a,
  guardRejectOf,
  type GuardRule,
  type Swatch,
  roomVarietyPickOf,
  VARIETY_FLAGS_ON,
  workChairsOf,
  type VarietyFlag,
} from './roomVariety';
import { GENERATED_DRESS_PREFIX } from './sceneDressing';
import { accentKeyOf, harmonyKeyOf, isNeutralFamily, LAYOUT_FLAGS_ON, roomHarmonyPlanOf, type LayoutFlag, type RoomHarmonyPlan } from './sceneHarmony';
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
  Partial<Pick<Furniture, 'heightMm' | 'reviewed' | 'source' | 'model'>>;

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
export const roleOf = (f: Shaped, usage?: RoomUsage): FurnitureRole => {
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
  /** Biến thể theo phòng / bộ ghế `?enable=roomvariety,chairset,varietyai` (`roomVariety.ts`); thiếu = cờ URL lúc nạp. */
  readonly variety?: ReadonlySet<VarietyFlag>;
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

/* ---- Biến thể theo phòng + bộ ghế (`roomVariety.ts`, vòng 11 b1) ---- */
const varietyOf = (style: SceneStyle): ReadonlySet<VarietyFlag> => (style as LayerStyle).variety ?? VARIETY_FLAGS_ON;
/** Món được đổi mẫu: đồ sinh (lớp đề xuất); `varietyai` mở thêm đồ AI dò chưa xác nhận, chưa gán mẫu. */
const inVarietyScope = (f: Pick<Furniture, 'id'> & Shaped, flags: ReadonlySet<VarietyFlag>): boolean =>
  isGenerated(f) || (flags.has('varietyai') && isAuto(f));
/** Họ màu không trung tính của thư viện (đã sắp) — họ của phòng băm trên danh sách này. */
const FAMILIES: readonly string[] = [
  ...new Set(Object.values(LIBRARY.models).flatMap((m) => (m.h === undefined || isNeutralFamily(m.h) ? [] : [m.h]))),
].sort();
const WORK_CHAIRS: readonly string[] = workChairsOf(LIBRARY.roles);
/** Ghế thật sát bàn làm việc (sổ của lượt dựng, `contextRolesOf`). Ghế sinh nhận ra theo vai trong id (`DRESS-deskChair-`). */
const DESK_CHAIRS = new Set<string>();
const isDeskChair = (f: Pick<Furniture, 'id'>): boolean =>
  f.id.startsWith(`${GENERATED_DRESS_PREFIX}deskChair-`) || DESK_CHAIRS.has(f.id);
interface ChairGroup {
  readonly tableId: string;
  readonly members: readonly Placed[];
  readonly usage: RoomUsage | undefined;
  readonly roles: ReadonlyMap<string, FurnitureRole>;
  cache?: { readonly style: SceneStyle; readonly folder: string | null };
}
/** Ghế → bộ ghế quanh bàn gần nhất (cùng phòng, cách ≤ `CHAIR_TABLE_GAP_MM`). */
const CHAIR_GROUPS = new Map<string, ChairGroup>();
const CHAIR_TABLE_GAP_MM = 600;
let chairsetBusy = false;
interface VarietyEntry {
  readonly roomId: string | undefined;
  readonly role: string;
  readonly folder: string | null;
}
/** Màu đo từ ảnh của mẫu thư viện (lát 2): id → [[L, a, b, tỉ phần]]. */
const LIBRARY_COLORS = (LIBRARY_COLORS_JSON as unknown as { readonly colors: Readonly<Record<string, readonly Swatch[]>> }).colors;
/** Vai món lớn (luật (a): gần màu trội của mẫu đang thay + trần độ rực). */
const LARGE_ROLES: ReadonlySet<FurnitureRole> = new Set([
  'doubleBed', 'singleBed', 'closet', 'dresser', 'cabinet', 'bookshelf', 'desk', 'diningTable', 'coffeeTable', 'nightstand', 'bench',
]);
/** Đếm ứng viên bị loại theo luật trong lượt dựng (+ `kept` = không ứng viên đạt, giữ mẫu cũ). */
const GUARD_REJECTS = new Map<GuardRule | 'kept', number>();
const bump = (key: GuardRule | 'kept'): void => {
  GUARD_REJECTS.set(key, (GUARD_REJECTS.get(key) ?? 0) + 1);
};
/** Ứng viên `folder` có đạt luật chặn so với mẫu đang thay `ref` không (đếm lý do loại). Chính `ref` luôn đạt. */
const guardOk = (folder: string, ref: string, role: FurnitureRole): boolean => {
  if (folder === ref) return true;
  const input = (id: string) => ({ colors: LIBRARY_COLORS[id], dims: CATALOG_MODELS[id]?.dimensions });
  const why = guardRejectOf(input(folder), input(ref), LARGE_ROLES.has(role));
  if (why !== undefined) bump(why);
  return why === undefined;
};
/** Mẫu cuối của mọi món trong lượt dựng (kể cả khi không cờ — số đo trước/sau). */
const VARIETY_LOG = new Map<string, VarietyEntry>();
type VarietyRule = 'room' | 'deskchair' | 'chairset';
/** Món đã đổi mẫu do luật này: id → { từ, sang, luật }. */
const VARIETY_CHANGES = new Map<string, { readonly from: string | null; readonly to: string | null; readonly rule: VarietyRule }>();

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
const libraryModelOf = (f: Shaped & Pick<Furniture, 'id'> & Partial<Pick<Furniture, 'roomId'>>, role: FurnitureRole, style: SceneStyle): string | null => {
  const flags = varietyOf(style);
  // `roomvariety`: ghế bàn học rút trong mẫu ghế làm việc (khi pool có), không dùng ghế ăn.
  const normal = libraryFoldersOf(role, f.variant).filter(isServerModel);
  const wantWork = role === 'diningChair' && flags.has('roomvariety') && !harmonySuspended && isDeskChair(f) && inVarietyScope(f, flags);
  // Ghế làm việc cũng qua luật chặn, so với ghế luật cũ chọn; không mẫu nào đạt → đường ghế thường (giữ mẫu cũ).
  const ref = wantWork ? rankedLibraryPickOf(f, role, plainStyleOf(style), normal) : null;
  const work = ref === null ? [] : WORK_CHAIRS.filter((folder) => isServerModel(folder) && guardOk(folder, ref, role));
  if (wantWork && work.length === 0) bump('kept');
  const all = work.length > 0 ? work : normal;
  const pick = rankedLibraryPickOf(f, role, style, all);
  if (pick === null || !QC_EXCLUDED.has(pick)) return pick;
  // Mẫu bị loại (libraryQc.json): xếp hạng lại trên phần còn lại; cả vai hết mẫu hợp lệ thì giữ hành vi cũ.
  const ok = all.filter((folder) => !QC_EXCLUDED.has(folder));
  if (ok.length === 0) return pick;
  const replacement = rankedLibraryPickOf(f, role, style, ok);
  if (replacement !== null) QC_SWAPS.set(f.id, { from: pick, to: replacement, role });
  return replacement ?? pick;
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
  /* `roomvariety`: món trong phạm vi rút theo id phòng trong các mẫu CÙNG HẠNG với mẫu đầu (tông, phong cách, khoá màu),
     không to hơn chỗ đặt, không bị loại QC; tông gỗ của căn + họ màu của phòng giữ cả phòng hài hoà. */
  const flags = varietyOf(style);
  const [short, long] = footprintOf(f);
  const roomId = f.roomId;
  const varietyOn =
    first !== null && roomId !== undefined && flags.has('roomvariety') && !harmonySuspended && !PER_ITEM_ROLES.has(role) && inVarietyScope(f, flags);
  const eligible =
    varietyOn && first !== null
      ? ranked.filter((r) => {
          const dims = CATALOG_MODELS[r.folder]?.dimensions;
          return (
            head !== undefined &&
            r.miss === head.miss &&
            r.tier === head.tier &&
            r.hue[0] === head.hue[0] &&
            !QC_EXCLUDED.has(r.folder) &&
            dims !== undefined &&
            fitsSpot(dims, short, long) &&
            guardOk(r.folder, first, role)
          );
        })
      : [];
  if (varietyOn && eligible.every((r) => r.folder === first)) bump('kept');
  const houseTone = rulesOffOf(style).has('tone') ? undefined : (style as LayerStyle).woodTone;
  const desk = isDeskChair(f);
  const varied =
    eligible.length === 0 || roomId === undefined
      ? undefined
      : roomVarietyPickOf(
          eligible.map(({ folder }) => ({ folder, ...LIBRARY.models[folder] })),
          roomId,
          desk ? 'deskChair' : role,
          houseTone,
          FAMILIES,
        );
  const pick = varied ?? first;
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

const NO_VARIETY: ReadonlySet<VarietyFlag> = new Set();
const PLAIN_STYLES = new WeakMap<SceneStyle, LayerStyle>();
/** Cùng phong cách, tắt mọi cờ biến thể (một đối tượng mỗi phong cách). */
const plainStyleOf = (style: SceneStyle): LayerStyle => {
  const hit = PLAIN_STYLES.get(style);
  if (hit !== undefined) return hit;
  const plain: LayerStyle = { ...style, variety: NO_VARIETY };
  PLAIN_STYLES.set(style, plain);
  return plain;
};

/** `chairset`: mẫu chung của bộ ghế quanh bàn của món; `undefined` = món không thuộc bộ nào. */
const chairSetOf = (f: FolderInput, style: SceneStyle, flags: ReadonlySet<VarietyFlag>): string | null | undefined => {
  const group = CHAIR_GROUPS.get(f.id);
  if (group === undefined) return undefined;
  if (group.cache?.style !== style) {
    chairsetBusy = true;
    try {
      const members = group.members.map((m) => ({
        id: m.id,
        folder:
          m.model !== undefined
            ? (SAVED_FOLDER.exec(m.model.src)?.[1] ?? null)
            : modelFolderOf(m, style, group.usage, group.roles.get(m.id)),
        fixed: !inVarietyScope(m, flags),
      }));
      group.cache = { style, folder: chairSetFolderOf(members) };
    } finally {
      chairsetBusy = false;
    }
  }
  return group.cache.folder;
};

/**
 * Thư mục mô hình của một món theo phong cách; `null` = không có mô hình (bên gọi dựng
 * chỗ giữ chỗ). Cùng hợp đồng với `furnitureModelOf` của `toPascal.ts`, chỉ trả thư mục.
 * `?enable=chairset`: món trong phạm vi lấy mẫu chung của bộ ghế quanh bàn của nó.
 */
export const modelFolderOf = (
  f: FolderInput,
  style: SceneStyle,
  usage?: RoomUsage,
  /** Vai trò theo ngữ cảnh phòng (`contextRolesOf`): đè cả variant, chỉ đổi mẫu. */
  roleOverride?: FurnitureRole,
): string | null => {
  if (harmonySuspended) return baseFolderOf(f, style, usage, roleOverride);
  const flags = varietyOf(style);
  const scoped = flags.size > 0 && inVarietyScope(f, flags);
  // Mẫu khi không cờ (tính TRƯỚC: sổ QC/phối ghi theo id, lượt sau thắng) — chỉ để ghi provenance đổi mẫu.
  const plain = scoped ? baseFolderOf(f, plainStyleOf(style), usage, roleOverride) : undefined;
  const own = baseFolderOf(f, style, usage, roleOverride);
  const set = scoped && flags.has('chairset') && !chairsetBusy ? chairSetOf(f, style, flags) : undefined;
  const folder = set === undefined || set === null ? own : set;
  if (plain !== undefined && folder !== plain)
    VARIETY_CHANGES.set(f.id, { from: plain, to: folder, rule: folder !== own ? 'chairset' : isDeskChair(f) ? 'deskchair' : 'room' });
  const role = roleOverride ?? roleOf(f, usage);
  VARIETY_LOG.set(f.id, { roomId: f.roomId, role: role === 'diningChair' && isDeskChair(f) ? 'deskChair' : role, folder });
  return folder;
};

const baseFolderOf = (f: FolderInput, style: SceneStyle, usage?: RoomUsage, roleOverride?: FurnitureRole): string | null => {
  const role = roleOverride ?? roleOf(f, usage);
  const catalogue = ROLE_MODELS[role];
  const best = Math.min(...catalogue.map((folder) => sizeCostOf(f, folder)));
  const isNearBest = (folder: string): boolean => sizeCostOf(f, folder) <= best * STYLE_TIE + 1e-9;
  /* AID-01: mẫu thư viện máy chủ mà AI chọn cho vai trò (`sceneStyleFromConcept`) không nằm trong
     `ROLE_MODELS` — máy chủ đã lọc theo loại, cỡ khớp bằng `asset.scale`, nên không qua ngưỡng cỡ. */
  const preferred = (style.prefer[role] ?? []).filter((folder) =>
    catalogue.includes(folder) ? isNearBest(folder) : isServerModel(folder),
  );
  const key = PER_ITEM_ROLES.has(role) ? f.id : `${f.roomId ?? 'none'}|${role}`;
  const hashed = (folders: readonly string[]): string => folders[fnv1a(key) % folders.length] as string;
  /* Mẫu AI chọn bị loại (libraryQc.json, chỉ mẫu máy chủ): băm trên CẢ danh sách như cũ — món băm vào mẫu tốt giữ
     đúng mẫu ấy; chỉ món băm vào mẫu bị loại mới băm lại trên phần còn lại; danh sách lọc xong rỗng thì luật thư viện. */
  const isRejected = (folder: string): boolean => QC_EXCLUDED.has(folder) && !catalogue.includes(folder);
  const pickHashed = (folders: readonly string[]): string => {
    const first = hashed(folders);
    if (!isRejected(first)) return first;
    const good = folders.filter((folder) => !isRejected(folder));
    const replacement = good.length > 0 ? hashed(good) : libraryModelOf(f, role, style);
    if (replacement === null || isRejected(replacement)) return first;
    QC_SWAPS.set(f.id, { from: first, to: replacement, role });
    return replacement;
  };

  // Mẫu đẹp của thư viện máy chủ thay mẫu Pascal low-poly cùng loại (khi thư viện đã nạp); mẫu AI chọn vẫn thắng.
  if (!preferred.some(isServerModel)) {
    const library = libraryModelOf(f, role, style);
    if (library !== null) return library;
  }

  const byVariant = roleOverride === undefined ? variantModelOf(f) : null;
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

type Placed = Shaped & Pick<Furniture, 'id' | 'centre' | 'roomId' | 'confidence'>;

/**
 * Vai trò theo ngữ cảnh cả phòng, đè lên `roleOf` khi chọn mẫu (không ghi variant vào dữ liệu):
 * phòng quá 2 bồn cầu thì món thừa thành lavabo; tủ đầu giường xa giường > 0,3 m thành bàn phụ.
 */
export const contextRolesOf = (
  items: readonly Placed[],
  usageOf: (f: Placed) => RoomUsage | undefined,
): ReadonlyMap<string, FurnitureRole> => {
  // Điểm vào một lượt dựng cảnh: `toPascalScene` gọi đúng một lần, trước vòng chọn mẫu → sổ thay mẫu chỉ giữ lượt này.
  QC_SWAPS.clear();
  VARIETY_LOG.clear();
  VARIETY_CHANGES.clear();
  GUARD_REJECTS.clear();
  const roles = new Map<string, FurnitureRole>();
  const toiletsOf = new Map<string, Placed[]>();
  const beds = items.filter((f) => f.kind === 'bed');

  for (const f of items) {
    const role = roleOf(f, usageOf(f));
    if (role === 'toilet' && f.roomId !== undefined) toiletsOf.set(f.roomId, [...(toiletsOf.get(f.roomId) ?? []), f]);
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
  registerChairGroups(items, usageOf, roles);
  return roles;
};

const centreGap = (a: Placed, b: Placed): number => Math.hypot(a.centre.x - b.centre.x, a.centre.y - b.centre.y);

/** Sổ ghế của lượt dựng: ghế (vai ghế ăn) → bàn gần nhất cùng phòng; bàn làm việc → ghế bàn học, bàn ăn → bộ ghế (≥ 2). */
const registerChairGroups = (
  items: readonly Placed[],
  usageOf: (f: Placed) => RoomUsage | undefined,
  roles: ReadonlyMap<string, FurnitureRole>,
): void => {
  DESK_CHAIRS.clear();
  CHAIR_GROUPS.clear();
  const roleOfItem = (f: Placed): FurnitureRole => roles.get(f.id) ?? roleOf(f, usageOf(f));
  const tables = items.filter((f) => f.roomId !== undefined && ['desk', 'diningTable'].includes(roleOfItem(f)));
  const byTable = new Map<string, Placed[]>();
  for (const chair of items) {
    if (chair.roomId === undefined || roleOfItem(chair) !== 'diningChair') continue;
    const rect = rectOfFurniture(chair);
    const near = tables
      .filter((t) => t.roomId === chair.roomId && rectsOverlap(rect, rectOfFurniture(t), CHAIR_TABLE_GAP_MM))
      .sort((a, b) => centreGap(a, chair) - centreGap(b, chair) || a.id.localeCompare(b.id))[0];
    if (near === undefined) continue;
    if (roleOfItem(near) === 'desk') DESK_CHAIRS.add(chair.id);
    else byTable.set(near.id, [...(byTable.get(near.id) ?? []), chair]);
  }
  for (const [tableId, members] of byTable) {
    if (members.length < 2) continue;
    const group: ChairGroup = { tableId, members, usage: usageOf(members[0] as Placed), roles };
    for (const m of members) CHAIR_GROUPS.set(m.id, group);
  }
};

interface VarietyReport {
  readonly flags: readonly VarietyFlag[];
  /** Vai → số món, số phòng, số mẫu khác nhau, số phòng nhiều nhất dùng chung một mẫu, mẫu → số món. */
  readonly byRole: Record<
    string,
    { readonly items: number; readonly rooms: number; readonly models: number; readonly maxRoomsOneModel: number; readonly folders: Record<string, number> }
  >;
  /** Bàn ăn thật → số ghế, số mẫu ghế, các mẫu. */
  readonly tables: Record<string, { readonly chairs: number; readonly models: number; readonly folders: readonly (string | null)[] }>;
  /** Ứng viên bị loại theo luật chặn (nodata/size/color/chroma/fabric) + `kept` = lượt chỉ còn mẫu cũ. */
  readonly guard: Record<string, number>;
  /** Món đổi mẫu do luật (provenance): id → { from, to, rule: room|deskchair|chairset }. */
  readonly changes: Record<string, { readonly from: string | null; readonly to: string | null; readonly rule: VarietyRule }>;
}
const REPORT_SKIP: ReadonlySet<string> = new Set(['fixed', 'stair', ...PER_ITEM_ROLES]);
/** Đầu dò `roomVariety` (`?probe=1`): có số cả khi không cờ (so trước/sau). Bỏ vai `fixed`/thang/cây/thảm. */
export const roomVarietyReport = (): VarietyReport => {
  const acc = new Map<string, { items: number; rooms: Set<string>; folders: Record<string, number>; roomsOf: Map<string, Set<string>> }>();
  for (const e of VARIETY_LOG.values()) {
    if (e.folder === null || REPORT_SKIP.has(e.role)) continue;
    const r = acc.get(e.role) ?? { items: 0, rooms: new Set<string>(), folders: {}, roomsOf: new Map<string, Set<string>>() };
    acc.set(e.role, r);
    const room = e.roomId ?? '-';
    r.items += 1;
    r.rooms.add(room);
    r.folders[e.folder] = (r.folders[e.folder] ?? 0) + 1;
    r.roomsOf.set(e.folder, (r.roomsOf.get(e.folder) ?? new Set<string>()).add(room));
  }
  const tables: Record<string, VarietyReport['tables'][string]> = {};
  for (const group of new Set(CHAIR_GROUPS.values())) {
    const folders = group.members.map((m) => VARIETY_LOG.get(m.id)?.folder ?? null);
    tables[group.tableId] = { chairs: folders.length, models: new Set(folders).size, folders };
  }
  return {
    flags: [...VARIETY_FLAGS_ON],
    byRole: Object.fromEntries(
      [...acc].map(([role, r]) => [
        role,
        {
          items: r.items,
          rooms: r.rooms.size,
          models: Object.keys(r.folders).length,
          maxRoomsOneModel: Math.max(...[...r.roomsOf.values()].map((s) => s.size)),
          folders: r.folders,
        },
      ]),
    ),
    tables,
    guard: Object.fromEntries(GUARD_REJECTS),
    changes: Object.fromEntries(VARIETY_CHANGES),
  };
};

/** Món nằm trên sàn (không nâng, không thảm, không chậu/mặt bếp mỏng trên mặt đá): chiếm chỗ, không được chồng. */
const isFloorStanding = (f: Furniture): boolean => {
  const role = roleOf(f);
  const lift = f.liftMm ?? (f.variant === undefined ? undefined : VARIANT_MODEL[f.variant]?.liftMm) ?? 0;
  return lift === 0 && role !== 'rug' && role !== 'roundRug' && !isThinHob(f) && !isThinSink(f);
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
