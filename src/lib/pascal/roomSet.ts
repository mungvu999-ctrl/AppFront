/**
 * Bộ nội thất theo phòng (vòng 12, làn S) — hàm thuần; `sceneVariety.ts` dựng thành viên phòng rồi gọi `roomSetOf`.
 *
 * Gốc lỗi cũ: mỗi món chọn mẫu ĐỘC LẬP (`rankedLibraryPickOf` lấy mẫu đầu) → mọi phòng cùng một giường; thử nghiệm
 * `roomvariety` rút ngẫu nhiên trong hạng nên lệch tông, ra giường nệm trần, so màu bằng "gần mẫu cũ".
 *
 * Ở đây: một món NEO (vai ưu tiên cao nhất có mặt; món ghim thuộc vai đó thì nó là neo), các món còn lại chấm theo độ
 * hợp với neo và với nhau; món cùng vai trong phòng dùng một mẫu. Ràng buộc CỨNG loại trước (dữ liệu chất lượng v1,
 * `libraryQuality.ts`: thiếu = chưa biết = loại), rồi điểm mềm: hạng phong cách + ΔE gỗ giữa phần CÙNG LOẠI + vải
 * (trung tính, tối đa một họ nhấn, trần độ rực). Bộ mới không hơn bộ cũ một biên → giữ bộ cũ. Tất định.
 *
 * Cờ `?enable=roomset` / `?disable=roomset`; `ROOMSET_DEFAULT` là hằng duy nhất để lật mặc định.
 */

import { qualityOf as defaultQualityOf, type ModelQuality, type QualityPart } from './libraryQuality';
import { fitsSpot, fnv1a } from './roomVariety';
import { SCENE_STYLE_MATERIALS, type SceneStyle } from './sceneStyles';

/** HẰNG LẬT MẶC ĐỊNH (điều phối viên lật sau QA ảnh). */
export const ROOMSET_DEFAULT = false;
/** Phiên bản luật, ghi vào provenance của món đổi mẫu. */
export const ROOMSET_VERSION = 1;

const listOf = (search: string, key: string): string[] => (new URLSearchParams(search).get(key) ?? '').split(',');
export const roomSetOnOf = (search: string, defaults: boolean = ROOMSET_DEFAULT): boolean =>
  !listOf(search, 'disable').includes('roomset') && (defaults || listOf(search, 'enable').includes('roomset'));
/** Đọc MỘT lần lúc nạp trang (như `?enable=` của `roomVariety`). */
export const ROOMSET_ON: boolean = typeof location === 'undefined' ? ROOMSET_DEFAULT : roomSetOnOf(location.search);

/** Vai thuộc bộ, thứ tự = ưu tiên làm neo (luật chung mọi công năng phòng). Cây/thảm/đồ `fixed`/thiết bị không vào bộ. */
export const SET_ROLES: readonly string[] = [
  'doubleBed', 'singleBed', 'sofa', 'diningTable', 'desk', 'closet', 'dresser', 'bookshelf',
  'armchair', 'coffeeTable', 'nightstand', 'bench', 'diningChair', 'cabinet',
];
const BED_ROLES: ReadonlySet<string> = new Set(['doubleBed', 'singleBed']);

/** Cao mẫu mới ≤ cao mẫu cũ × chừng này. */
export const HEIGHT_GROW_MAX = 1.15;
/** Dải neo: ứng viên có chi phí ≤ tốt nhất + chừng này được rút (băm phòng + vai). */
export const ANCHOR_BAND = 0.08;
/** Bộ mới phải rẻ hơn bộ cũ ít nhất chừng này, không thì giữ bộ cũ. */
export const MIN_GAIN = 0.05;
/** ΔE76 gỗ quy về 1 điểm phạt. */
export const WOOD_DE_REF = 20;
/** Lệch L* gỗ so với tông của phong cách quy về 1 điểm phạt; L* đích của tông sáng/tối. */
export const WOOD_L_REF = 40;
export const WOOD_L: Readonly<Record<'l' | 'd', number>> = { l: 65, d: 35 };
/** Vải: C* tới chừng này là trung tính; trần độ rực; hai màu nhấn khác họ khi lệch góc màu quá chừng này (độ). */
export const NEUTRAL_C = 10;
export const CHROMA_CAP = 25;
export const ACCENT_HUE_SPAN = 30;
/** Trọng số: phong cách, gỗ, vải. */
export const W_STYLE = 1;
export const W_WOOD = 1;
export const W_FABRIC = 1;

type Lab = readonly [number, number, number];
export type Dims = readonly [number, number, number];

/** Bảng màu so được của phong cách: màu tường (Lab) + L* gỗ đích theo tông của căn. */
export interface SetPalette {
  readonly wall?: Lab;
  readonly woodL?: number;
}

/** sRGB hex → Lab (D65). */
export const labOfHex = (hex: string): Lab | undefined => {
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

/** Bảng màu từ SceneStyle: sơn tường trong (vật liệu phẳng có màu) + tông gỗ của căn. Vân sàn là texture → không so. */
export const paletteOf = (style: SceneStyle, woodTone: 'l' | 'd' | undefined): SetPalette => {
  const id = style.wall.interior.replace(/^scene:/, '');
  const color = SCENE_STYLE_MATERIALS.find((m) => m.id === id)?.material.properties?.color;
  const wall = typeof color === 'string' ? labOfHex(color) : undefined;
  return { ...(wall === undefined ? {} : { wall }), ...(woodTone === undefined ? {} : { woodL: WOOD_L[woodTone] }) };
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

export type SetRule = 'roomset' | 'keep';
export interface SetDecision {
  readonly id: string;
  readonly role: string;
  readonly from: string | null;
  readonly to: string | null;
  readonly rule: SetRule;
  readonly anchor: boolean;
  /** Chi phí bộ (nhỏ = hợp hơn) lúc chốt món này. */
  readonly cost?: number;
  /** Lý do giữ / chọn (tiếng Việt, cho đầu dò). */
  readonly why: string;
}

const chromaOf = (lab: Lab): number => Math.hypot(lab[1], lab[2]);
const hueOf = (lab: Lab): number => (Math.atan2(lab[2], lab[1]) * 180) / Math.PI;
const deltaE = (x: Lab, y: Lab): number => Math.hypot(x[0] - y[0], x[1] - y[1], x[2] - y[2]);
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
  if (dims === undefined || !fitsSpot(dims, m.short, m.long)) return 'không lọt chỗ';
  const ref = m.current === null ? undefined : ctx.dimsOf(m.current);
  if (ref === undefined || dims[1] > ref[1] * HEIGHT_GROW_MAX) return 'cao hơn mẫu cũ';
  return undefined;
};

/** Đặc trưng màu của một mẫu (tính một lần mỗi lượt `roomSetOf`). */
interface Feat {
  readonly tier: number;
  /** Lab phần gỗ theo loại (`frame`, `top`). */
  readonly wood: readonly (Lab | undefined)[];
  /** Phần vải (upholstery/bedding). */
  readonly fabrics: readonly QualityPart[];
}
const WOOD_KINDS: readonly QualityPart['kind'][] = ['frame', 'top'];
const featOf = (folder: string, ctx: SetContext, memo: Map<string, Feat>): Feat => {
  const hit = memo.get(folder);
  if (hit !== undefined) return hit;
  const parts = (ctx.qualityOf ?? defaultQualityOf)(folder)?.parts ?? [];
  const feat: Feat = {
    tier: ctx.tierOf(folder),
    wood: WOOD_KINDS.map((kind) => parts.find((p) => p.kind === kind && p.material === 'wood')?.lab),
    fabrics: parts.filter((p) => p.kind === 'upholstery' || p.kind === 'bedding'),
  };
  memo.set(folder, feat);
  return feat;
};

/**
 * Chi phí một bộ mẫu (nhỏ = hợp hơn) = W_STYLE × hạng TB chuẩn hoá + W_WOOD × (ΔE TB giữa phần gỗ CÙNG LOẠI frame/top
 * của mọi cặp món / WOOD_DE_REF + |L* gỗ − L* đích| TB / WOOD_L_REF) + W_FABRIC × (số họ nhấn thừa + phần vượt trần độ rực).
 * Họ nhấn: phần vải C* > NEUTRAL_C (và tường nếu tường có màu); hai họ khác nhau khi lệch góc màu > ACCENT_HUE_SPAN.
 * `memo`: đặc trưng mẫu trong MỘT lượt chọn (không giữ qua lượt).
 */
export const setCostOf = (folders: readonly string[], ctx: SetContext, memo: Map<string, Feat> = new Map()): number => {
  if (folders.length === 0) return 0;
  const feats = folders.map((f) => featOf(f, ctx, memo));
  let tiers = 0;
  for (const f of feats) tiers += f.tier;
  const style = tiers / feats.length / (ctx.tiers + 1);

  let pairSum = 0;
  let pairs = 0;
  let lSum = 0;
  let woods = 0;
  for (let k = 0; k < WOOD_KINDS.length; k += 1) {
    for (let i = 0; i < feats.length; i += 1) {
      const a = (feats[i] as Feat).wood[k];
      if (a === undefined) continue;
      for (let j = i + 1; j < feats.length; j += 1) {
        const b = (feats[j] as Feat).wood[k];
        if (b === undefined) continue;
        pairSum += deltaE(a, b);
        pairs += 1;
      }
      if (ctx.palette.woodL !== undefined) {
        lSum += Math.abs(a[0] - ctx.palette.woodL);
        woods += 1;
      }
    }
  }
  const wood = (pairs === 0 ? 0 : pairSum / pairs / WOOD_DE_REF) + (woods === 0 ? 0 : lSum / woods / WOOD_L_REF);

  let over = 0;
  const loud: QualityPart[] = [];
  for (const f of feats)
    for (const p of f.fabrics) {
      const c = chromaOf(p.lab);
      over += Math.max(0, c - CHROMA_CAP) / CHROMA_CAP;
      if (c > NEUTRAL_C) loud.push(p);
    }
  loud.sort((a, b) => b.share - a.share);
  const wall = ctx.palette.wall !== undefined && chromaOf(ctx.palette.wall) > NEUTRAL_C ? [ctx.palette.wall] : [];
  const families: number[] = [];
  for (const lab of [...wall, ...loud.map((p) => p.lab)])
    if (!families.some((h) => hueGap(h, hueOf(lab)) <= ACCENT_HUE_SPAN)) families.push(hueOf(lab));
  const fabric = Math.max(0, families.length - 1) + over;

  return W_STYLE * style + W_WOOD * wood + W_FABRIC * fabric;
};

const byId = (a: { readonly id: string }, b: { readonly id: string }): number => a.id.localeCompare(b.id);

/** Cỡ ô làm tròn của chữ ký phòng, mm (diện tích làm tròn 0,1 m²). */
const KEY_GRID_MM = 100;

/**
 * Khoá băm của từng phòng theo NỘI DUNG, không theo id (id sinh lại khi chép sang dự án khác → nội thất không được
 * đổi): công năng + cạnh ngắn/dài hộp bao (làm tròn 100 mm) + diện tích (0,1 m²), rồi thứ hạng giữa các phòng trùng
 * chữ ký theo tâm hộp bao TƯƠNG ĐỐI trong tầng (góc nhỏ nhất của mọi phòng cùng tầng; sắp y rồi x, làm tròn 100 mm).
 * Hai tầng giống hệt cho cùng khoá — cùng nội dung thì cùng bộ.
 */
export const roomSetKeysOf = (
  rooms: readonly { readonly id: string; readonly levelId: string; readonly usage: string | undefined; readonly outline: readonly { readonly x: number; readonly y: number }[] }[],
): Map<string, string> => {
  const grid = (v: number): number => Math.round(v / KEY_GRID_MM);
  const originOf = new Map<string, { x: number; y: number }>();
  for (const r of rooms) {
    for (const p of r.outline) {
      const o = originOf.get(r.levelId);
      originOf.set(r.levelId, o === undefined ? { x: p.x, y: p.y } : { x: Math.min(o.x, p.x), y: Math.min(o.y, p.y) });
    }
  }
  const info = rooms.map((r) => {
    const xs = r.outline.map((p) => p.x);
    const ys = r.outline.map((p) => p.y);
    const [x0, x1, y0, y1] = [Math.min(...xs), Math.max(...xs), Math.min(...ys), Math.max(...ys)];
    const o = originOf.get(r.levelId) ?? { x: 0, y: 0 };
    const area = Math.abs(r.outline.reduce((sum, p, i) => {
      const q = r.outline[(i + 1) % r.outline.length] ?? p;
      return sum + p.x * q.y - q.x * p.y;
    }, 0)) / 2;
    const [w, h] = [x1 - x0, y1 - y0];
    const sig = `${r.usage ?? ''}|${grid(Math.min(w, h))}x${grid(Math.max(w, h))}|${Math.round(area / 1e5)}`;
    return { id: r.id, sig, at: [grid((y0 + y1) / 2 - o.y), grid((x0 + x1) / 2 - o.x)] as const };
  });
  const keys = new Map<string, string>();
  for (const { id, sig, at } of info) {
    const spots = [...new Set(info.filter((r) => r.sig === sig).map((r) => r.at.join(',')))]
      .map((s) => s.split(',').map(Number) as [number, number])
      .sort((a, b) => a[0] - b[0] || a[1] - b[1])
      .map((a) => a.join(','));
    keys.set(id, `${sig}#${spots.indexOf(at.join(','))}`);
  }
  return keys;
};

/**
 * Bộ của một phòng. `roomKey` = khoá nội dung (`roomSetKeysOf`), chỉ dùng để băm rút neo. `decided` = món đã chốt ở
 * lượt trước trong cùng lượt dựng (giữ nguyên, làm ngữ cảnh). Trả quyết định cho mọi món trong phạm vi chưa chốt.
 * Thứ tự xử lý: vai neo, rồi `SET_ROLES`; trong vai theo id.
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
  const folderOfFixed = (m: SetMember): string | null => (m.fixed ? m.current : (decided.get(m.id)?.to ?? null));
  const context: string[] = inSet.flatMap((m) => {
    const f = folderOfFixed(m);
    return f === null ? [] : [f];
  });
  const out = new Map<string, SetDecision>();
  const memo = new Map<string, Feat>();
  const chosen: { m: SetMember; to: string | null; anchor: boolean; cost?: number; why: string }[] = [];

  for (const role of roles) {
    const group = inSet.filter((m) => m.role === role);
    const todo = group.filter((m) => !m.fixed && !decided.has(m.id));
    if (todo.length === 0) continue;
    const anchor = role === anchorRole;
    const keepAll = (why: string): void => {
      for (const m of todo) chosen.push({ m, to: m.current, anchor, why });
    };
    const ok = (folder: string): boolean => todo.every((m) => hardRejectOf(m, folder, ctx) === undefined);
    // Món cùng vai đã có mẫu (ghim / đã chốt): cặp dùng chung mẫu ấy nếu nó lọt mọi chỗ.
    const pinned = group.map(folderOfFixed).find((f): f is string => f !== null);
    if (pinned !== undefined && ok(pinned)) {
      for (const m of todo) chosen.push({ m, to: pinned, anchor, why: 'cùng mẫu món cùng vai đã có' });
      context.push(pinned);
      continue;
    }
    const pool = [...new Set(todo.flatMap((m) => m.pool))].filter((f) => todo.every((m) => m.pool.includes(f)));
    const cands = pool.filter(ok).sort();
    if (cands.length === 0) {
      keepAll('không ứng viên qua ràng buộc cứng');
      continue;
    }
    // Neo chấm một mình (phong cách + bảng màu): nhận/ghim món phụ không làm đổi neo.
    const ranked = cands
      .map((f) => ({ f, cost: setCostOf(anchor ? [f] : [...context, f], ctx, memo) }))
      .sort((a, b) => a.cost - b.cost || a.f.localeCompare(b.f));
    const best = ranked[0] as { f: string; cost: number };
    // Neo: rút trong dải sát tốt nhất theo băm khoá nội dung phòng + vai (đa dạng có kiểm soát); món khác: rẻ nhất.
    const band = anchor ? ranked.filter((r) => r.cost <= best.cost + ANCHOR_BAND) : [best];
    const pick = band[fnv1a(`${roomKey}|${role}`) % band.length] as { f: string; cost: number };
    for (const m of todo) chosen.push({ m, to: pick.f, anchor, cost: pick.cost, why: anchor ? `neo, dải ${band.length}` : 'hợp neo' });
    context.push(pick.f);
  }

  // Biên tối thiểu: bộ cũ qua mọi ràng buộc cứng và bộ mới không rẻ hơn ≥ MIN_GAIN → giữ cả bộ cũ.
  const fixedCtx = inSet.flatMap((m) => {
    const f = m.fixed || decided.has(m.id) ? folderOfFixed(m) : null;
    return f === null ? [] : [f];
  });
  const oldOk = chosen.every((c) => c.m.current !== null && hardRejectOf(c.m, c.m.current, ctx) === undefined);
  const oldCost = setCostOf([...fixedCtx, ...chosen.flatMap((c) => (c.m.current === null ? [] : [c.m.current]))], ctx, memo);
  const newCost = setCostOf([...fixedCtx, ...chosen.flatMap((c) => (c.to === null ? [] : [c.to]))], ctx, memo);
  const keepOld = oldOk && chosen.some((c) => c.to !== c.m.current) && newCost > oldCost - MIN_GAIN;

  for (const c of chosen) {
    const to = keepOld ? c.m.current : c.to;
    out.set(c.m.id, {
      id: c.m.id,
      role: c.m.role,
      from: c.m.current,
      to,
      rule: to === c.m.current ? 'keep' : 'roomset',
      anchor: c.anchor,
      cost: keepOld ? oldCost : newCost,
      why: keepOld ? 'bộ mới không hơn bộ cũ ≥ biên' : c.why,
    });
  }
  return out;
};
