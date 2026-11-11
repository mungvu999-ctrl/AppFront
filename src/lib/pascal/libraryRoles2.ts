/**
 * Vai thư viện mở rộng (vòng 11 làn b2, `?enable=libroles2`) — nguyên nhân #2 của `F:/runs/m11/b0/BAO-CAO.txt`: đèn sinh
 * (đèn đứng `floorLamp`, đèn bàn `tableLamp`) dựng bằng mẫu Pascal gói sẵn phẳng, 0 texture (floor-lamp 194 tam giác).
 *
 * Pool = `libraryRoles2.json`, sinh bằng `scripts/gen-library-roles2.mjs` theo ngưỡng chung (có texture, ≤ 60 k tam giác,
 * ≤ 1 MB, mặt bằng gần tròn, cao hợp vai) — không phải danh sách tay. Chỉ món SINH (`DRESS-`, lớp đề xuất) chưa có mẫu.
 * Mẫu được chọn phải LỌT hộp chỗ đặt (không phóng); hộp co về đúng mặt bằng mẫu quanh tâm cũ (co không bao giờ tạo
 * chồng lấn), cao = cao mẫu → mẫu giữ đúng tỉ lệ. Không mẫu nào lọt → giữ mẫu Pascal. Tất định: hạt giống = phòng + vai.
 * Đèn giữ nguồn sáng của mẫu Pascal cùng vai (cường độ không đổi), chỉ dời độ cao theo tỉ lệ chiều cao mẫu.
 *
 * KHÔNG thay (lý do trong báo cáo b2): rèm (pool chỉ còn curtain-pro: cả bộ 3 m có thanh, sâu 0,43 m — không thay được
 * một tấm 0,8 × 0,1 m mà không vỡ luật cắt tấm mỏng/vải của làn b3), dãy bếp (tủ kéo dài theo tường; mẫu thư viện là bộ
 * bếp chữ L cố định hoặc > 150 k tam giác), đèn âm trần (thư viện không có đèn âm trần phẳng có texture; đèn thả không
 * được lớp đề xuất sinh).
 */
import type { Furniture } from '@/domain/spatial/types';

import { CATALOG_MODELS, isServerModel, serverModelPath, VARIANT_MODEL } from './furnitureCatalog';
import POOLS_JSON from './libraryRoles2.json' with { type: 'json' };
import { GENERATED_DRESS_PREFIX, lampInteractiveOf } from './sceneDressing';
import type { SceneStyle } from './sceneStyles';

/** HẰNG LẬT MẶC ĐỊNH: `true` sau khi QA ảnh chọn. `?disable=libroles2` luôn tắt. */
export const LIBROLES2_DEFAULT = true;
export const LIBROLES2_FLAG = 'libroles2';

export const libRoles2FlagOf = (search: string, def: boolean = LIBROLES2_DEFAULT): boolean => {
  const q = new URLSearchParams(search);
  if ((q.get('disable') ?? '').split(',').includes(LIBROLES2_FLAG)) return false;
  return def || (q.get('enable') ?? '').split(',').includes(LIBROLES2_FLAG);
};
/** Đọc MỘT lần lúc nạp trang. */
export const LIBROLES2_ON: boolean = typeof location === 'undefined' ? LIBROLES2_DEFAULT : libRoles2FlagOf(location.search);

const POOLS = POOLS_JSON as {
  readonly roles: Readonly<Record<string, readonly string[]>>;
  readonly models: Readonly<Record<string, { readonly s: readonly string[] }>>;
  readonly flatPascal: readonly string[];
};
export const LIBROLES2_POOLS: Readonly<Record<string, readonly string[]>> = POOLS.roles;
const FLAT_PASCAL: ReadonlySet<string> = new Set(POOLS.flatPascal);

/**
 * `model` của món đổi mẫu = ĐÚNG mẫu máy chủ (`id` thư viện + đường cố định `/items/<id>/model.glb`), như mẫu người dùng
 * "Đổi mẫu": nhận món (sửa nó / cả phòng) thì `toSpatial` lưu đúng mẫu ấy (review Codex B1 #1 — id có tiền tố riêng làm
 * bản lưu mất mẫu). Provenance ở `PROV_FIELD` của node + sổ `swaps` (đầu dò), không nhúng vào id.
 */
const POOL_SRC = /^\/items\/([a-z0-9_-]+)\/model\.glb$/;

/** FNV-1a 32 bit. */
const fnv1a = (text: string): number => {
  let hash = 0x811c9dc5;
  for (let i = 0; i < text.length; i += 1) {
    hash ^= text.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash;
};

/** Hạng phong cách (sớm = hợp): trùng mã thứ i → i; mẫu không mã sau mọi mã; lệch phong cách cuối. */
const tierOf = (folder: string, wanted: readonly string[]): number => {
  const styles = POOLS.models[folder]?.s ?? [];
  const hit = wanted.findIndex((code) => styles.includes(code));
  if (hit >= 0) return hit;
  return styles.length === 0 ? wanted.length : wanted.length + 1;
};

const EPS_M = 1e-6;
type Pickable = Pick<Furniture, 'id' | 'variant' | 'boundingBox'> & Partial<Pick<Furniture, 'roomId' | 'model'>>;

/**
 * Mẫu pool cho một món sinh, `null` = giữ mẫu cũ. Thứ tự: hạng phong cách, trong hạng xoay vòng từ băm (phòng|vai); lấy mẫu
 * đầu tiên LỌT hộp (rộng ≤ hộp x, sâu ≤ hộp y). Hộp nhỏ đi chỉ loại bớt mẫu → chọn lại trên hộp đã co ra đúng mẫu cũ.
 */
export const libRoles2PickOf = (f: Pickable, style: SceneStyle, on: boolean = LIBROLES2_ON): string | null => {
  if (!on || !f.id.startsWith(GENERATED_DRESS_PREFIX) || f.model !== undefined || f.variant === undefined) return null;
  const pool = (POOLS.roles[f.variant] ?? []).filter(isServerModel);
  if (pool.length === 0) return null;
  const boxW = (f.boundingBox.max.x - f.boundingBox.min.x) / 1000;
  const boxD = (f.boundingBox.max.y - f.boundingBox.min.y) / 1000;
  const wanted = style.libraryStyles ?? [];
  const start = fnv1a(`${f.roomId ?? f.id}|${f.variant}`);
  const tiers = [...new Set(pool.map((folder) => tierOf(folder, wanted)))].sort((a, b) => a - b);
  for (const tier of tiers) {
    const group = pool.filter((folder) => tierOf(folder, wanted) === tier).sort((a, b) => a.localeCompare(b));
    for (let i = 0; i < group.length; i += 1) {
      const folder = group[(start + i) % group.length] as string;
      const dims = CATALOG_MODELS[folder]?.dimensions;
      if (dims !== undefined && dims[0] <= boxW + EPS_M && dims[2] <= boxD + EPS_M) return folder;
    }
  }
  return null;
};

interface Swap {
  readonly variant: string;
  readonly from: string | undefined;
  readonly to: string;
}
const SWAPS = new Map<string, Swap>();

/** Món sinh đổi sang mẫu pool: hộp co về mặt bằng mẫu quanh tâm cũ, cao = cao mẫu, `model` trỏ mẫu máy chủ. */
export const withLibRoles2 = <F extends Furniture>(f: F, style: SceneStyle, on: boolean = LIBROLES2_ON): F => {
  const pick = libRoles2PickOf(f, style, on);
  const dims = pick === null ? undefined : CATALOG_MODELS[pick]?.dimensions;
  if (pick === null || dims === undefined || f.variant === undefined) return f;
  const cx = (f.boundingBox.min.x + f.boundingBox.max.x) / 2;
  const cy = (f.boundingBox.min.y + f.boundingBox.max.y) / 2;
  const [hw, h, hd] = [(dims[0] * 1000) / 2, dims[1] * 1000, (dims[2] * 1000) / 2];
  SWAPS.set(f.id, { variant: f.variant, from: VARIANT_MODEL[f.variant]?.folder, to: pick });
  return {
    ...f,
    boundingBox: { min: { x: cx - hw, y: cy - hd }, max: { x: cx + hw, y: cy + hd } } as F['boundingBox'],
    heightMm: Math.round(h) as F['heightMm'],
    model: { id: pick, src: serverModelPath(pick) },
  };
};

/** Một lượt dựng (`toPascalScene`): sổ đổi mẫu chỉ giữ lượt này. */
export const libRoles2Apply = <F extends Furniture>(generated: readonly F[], style: SceneStyle, on: boolean = LIBROLES2_ON): F[] => {
  SWAPS.clear();
  return generated.map((f) => withLibRoles2(f, style, on));
};

/**
 * Nguồn sáng của đèn đã đổi mẫu: của mẫu Pascal cùng vai (cường độ, màu, tầm giữ nguyên), độ cao nguồn nhân tỉ lệ chiều
 * cao mẫu mới / mẫu Pascal. `undefined` = món không mang mẫu pool của vai nó (hoặc cờ tắt).
 */
export const libRoles2LampOf = (
  f: Pick<Furniture, 'variant'> & Partial<Pick<Furniture, 'model' | 'heightMm'>>,
  style: SceneStyle,
  on: boolean = LIBROLES2_ON,
): unknown => {
  // Mọi món vai đèn mang mẫu trong pool (đèn sinh vừa đổi, hoặc đèn đã nhận nạp lại từ bản lưu) đều sáng như đèn Pascal.
  const folder = POOL_SRC.exec(f.model?.src ?? '')?.[1];
  if (!on || f.variant === undefined || folder === undefined || !(POOLS.roles[f.variant] ?? []).includes(folder)) return undefined;
  const base = VARIANT_MODEL[f.variant]?.folder;
  const baseH = base === undefined ? undefined : CATALOG_MODELS[base]?.dimensions[1];
  const lamp = base === undefined ? undefined : (structuredClone(lampInteractiveOf(base, style)) as { effects?: { kind: string; offset?: number[] }[] } | undefined);
  if (lamp === undefined || baseH === undefined || f.heightMm === undefined) return lamp;
  const k = f.heightMm / 1000 / baseH;
  for (const effect of lamp.effects ?? []) {
    if (effect.kind === 'light' && effect.offset !== undefined) effect.offset = [effect.offset[0] ?? 0, (effect.offset[1] ?? 0) * k, effect.offset[2] ?? 0];
  }
  return lamp;
};

interface ProbeNode {
  readonly id: string;
  readonly type?: string;
  readonly asset?: { readonly src?: string };
  readonly metadata?: { readonly generated?: unknown };
}
const PASCAL_SRC = /\/items\/([^/?]+)\/model\.glb/;
const roleOfNodeId = (id: string): string => id.slice(id.indexOf(GENERATED_DRESS_PREFIX) + GENERATED_DRESS_PREFIX.length).split('-')[0] ?? '';

/**
 * Đầu dò (`__pascalProbe.libroles2()`): cờ, cỡ pool, các lượt đổi (id → vai, từ, sang), và số món SINH "phẳng" (mẫu Pascal
 * gói sẵn 0 texture) theo vai — `after` đếm trên node cảnh, `before` = after + món đã đổi khỏi mẫu phẳng.
 */
export interface LibRoles2Report {
  readonly on: boolean;
  readonly default: boolean;
  readonly pools: Readonly<Record<string, number>>;
  readonly loaded: Readonly<Record<string, number>>;
  readonly swaps: Readonly<Record<string, Swap>>;
  readonly flat: { readonly before: Readonly<Record<string, number>>; readonly after: Readonly<Record<string, number>> };
}
export const libRoles2Report = (nodes: readonly ProbeNode[]): LibRoles2Report => {
  const after: Record<string, number> = {};
  for (const node of nodes) {
    if (node.type !== 'item' || node.metadata?.generated !== 'dressing' || !node.id.includes(GENERATED_DRESS_PREFIX)) continue;
    const folder = PASCAL_SRC.exec(node.asset?.src ?? '')?.[1];
    if (folder === undefined || !FLAT_PASCAL.has(folder)) continue;
    const role = roleOfNodeId(node.id);
    after[role] = (after[role] ?? 0) + 1;
  }
  const before: Record<string, number> = { ...after };
  for (const [id, swap] of SWAPS) {
    if (swap.from === undefined || !FLAT_PASCAL.has(swap.from)) continue;
    const role = roleOfNodeId(id);
    before[role] = (before[role] ?? 0) + 1;
  }
  return {
    on: LIBROLES2_ON,
    default: LIBROLES2_DEFAULT,
    pools: Object.fromEntries(Object.entries(POOLS.roles).map(([role, list]) => [role, list.length])),
    loaded: Object.fromEntries(Object.entries(POOLS.roles).map(([role, list]) => [role, list.filter(isServerModel).length])),
    swaps: Object.fromEntries(SWAPS),
    flat: { before, after },
  };
};
