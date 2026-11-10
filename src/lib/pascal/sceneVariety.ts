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
import { GENERATED_DRESS_PREFIX } from './sceneDressing';
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

type Shaped = Pick<Furniture, 'kind' | 'variant' | 'boundingBox' | 'rotationDeg'> & Partial<Pick<Furniture, 'heightMm'>>;

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

/** FNV-1a 32 bit. */
const fnv1a = (text: string): number => {
  let hash = 0x811c9dc5;
  for (let i = 0; i < text.length; i += 1) {
    hash ^= text.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash;
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
export type LayerStyle = SceneStyle & { readonly rulesOff?: ReadonlySet<string>; readonly woodTone?: 'l' | 'd' };

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
  for (const { f, usage } of items) {
    if (isGenerated(f) || f.kind === 'stair') continue;
    const folder = f.model === undefined ? modelFolderOf(f, style, usage) : (SAVED_FOLDER.exec(f.model.src)?.[1] ?? null);
    const t = folder === null ? undefined : LIBRARY.models[folder]?.t;
    if (t === 'l' || t === 'd') count[t] += 1;
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
const libraryModelOf = (f: Shaped & Pick<Furniture, 'id'>, role: FurnitureRole, style: SceneStyle): string | null => {
  const all = libraryFoldersOf(role, f.variant).filter(isServerModel);
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
  f: Shaped & Pick<Furniture, 'id'>,
  role: FurnitureRole,
  style: SceneStyle,
  library: readonly string[],
): string | null => {
  if (library.length === 0) return null;
  const best = Math.min(...library.map((folder) => sizeCostOf(f, folder)));
  const wanted = style.libraryStyles ?? [];
  // Luật `tone` (C): CHỈ món sinh — mẫu lệch tông gỗ của căn xếp sau, trong cùng giới hạn cỡ (đồ AI/người dùng không đổi).
  const tone = isGenerated(f) && !rulesOffOf(style).has('tone') ? (style as LayerStyle).woodTone : undefined;
  const toneMiss = (folder: string): number => {
    const t = LIBRARY.models[folder]?.t;
    return tone !== undefined && t !== undefined && t !== tone ? 1 : 0;
  };
  const ranked = library
    .filter((folder) => sizeCostOf(f, folder) <= best + LIBRARY_SIZE_SLACK)
    .map((folder) => ({ folder, miss: toneMiss(folder), tier: styleTierOf(folder, wanted), chroma: LIBRARY.models[folder]?.c ?? 0 }))
    .sort((a, b) => a.miss - b.miss || a.tier - b.tier || a.chroma - b.chroma || a.folder.localeCompare(b.folder));
  const top = ranked
    .filter((r) => r.tier === ranked[0]?.tier && r.miss === ranked[0]?.miss)
    .slice(0, PER_ITEM_ROLES.has(role) ? 4 : 1);
  const pick = top[fnv1a(f.id) % top.length]?.folder ?? null;
  /* Luật `orient` (B), món sinh có mặt trước (giường, tủ…): mẫu nằm ngang hộp → mẫu khác CÙNG HỌ MÀU vừa hướng hơn;
     không có thì giữ mẫu cũ (không đổi tông chỉ để khớp hướng). Vai đối xứng thì xoay món (`orientedGenerated`). */
  if (pick === null || !isGenerated(f) || ROTATABLE_ROLES.has(role) || rulesOffOf(style).has('orient') || !misOriented(f, pick)) return pick;
  const family = LIBRARY.models[pick]?.h;
  const own = orientedCostOf(f, pick);
  const better = library
    .filter((folder) => family !== undefined && LIBRARY.models[folder]?.h === family && orientedCostOf(f, folder) + ORIENT_MARGIN < own)
    .map((folder) => ({ folder, miss: toneMiss(folder), tier: styleTierOf(folder, wanted), chroma: LIBRARY.models[folder]?.c ?? 0 }))
    .sort((a, b) => a.miss - b.miss || a.tier - b.tier || a.chroma - b.chroma || a.folder.localeCompare(b.folder));
  return better[0]?.folder ?? pick;
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

/**
 * Thư mục mô hình của một món theo phong cách; `null` = không có mô hình (bên gọi dựng
 * chỗ giữ chỗ). Cùng hợp đồng với `furnitureModelOf` của `toPascal.ts`, chỉ trả thư mục.
 */
export const modelFolderOf = (
  f: Pick<Furniture, 'id' | 'kind' | 'variant' | 'boundingBox' | 'rotationDeg' | 'roomId'> &
    Partial<Pick<Furniture, 'heightMm'>>,
  style: SceneStyle,
  usage?: RoomUsage,
  /** Vai trò theo ngữ cảnh phòng (`contextRolesOf`): đè cả variant, chỉ đổi mẫu. */
  roleOverride?: FurnitureRole,
): string | null => {
  const role = roleOverride ?? roleOf(f, usage);
  const catalogue = ROLE_MODELS[role];
  const best = Math.min(...catalogue.map((folder) => sizeCostOf(f, folder)));
  const isNearBest = (folder: string): boolean => sizeCostOf(f, folder) <= best * STYLE_TIE + 1e-9;
  /* AID-01: mẫu thư viện máy chủ mà AI chọn cho vai trò (`sceneStyleFromConcept`) không nằm trong
     `ROLE_MODELS` — máy chủ đã lọc theo loại, cỡ khớp bằng `asset.scale`, nên không qua ngưỡng cỡ. */
  const preferred = (style.prefer[role] ?? []).filter((folder) =>
    catalogue.includes(folder) ? isNearBest(folder) : isServerModel(folder),
  );
  // Mẫu AI chọn bị loại (libraryQc.json) → luật thư viện chọn mẫu hợp lệ cùng vai; ghi nhận để công bố.
  const rejected = preferred.find((folder) => QC_EXCLUDED.has(folder));
  if (rejected !== undefined && !catalogue.includes(rejected)) {
    const replacement = libraryModelOf(f, role, style);
    if (replacement !== null && !QC_EXCLUDED.has(replacement)) {
      QC_SWAPS.set(f.id, { from: rejected, to: replacement, role });
      return replacement;
    }
  }
  const key = PER_ITEM_ROLES.has(role) ? f.id : `${f.roomId ?? 'none'}|${role}`;
  const pickHashed = (folders: readonly string[]): string => folders[fnv1a(key) % folders.length] as string;

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
  return roles;
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
