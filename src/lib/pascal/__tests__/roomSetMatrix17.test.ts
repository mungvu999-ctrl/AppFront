/**
 * Vòng 17 làn D — ma trận tương tác luật của `roomSetOf` (thuần, catalog tổng hợp). Trục: concept có/không × pool (đủ / rỗng /
 * chỉ mẫu cấm) × hộp AI (đúng cỡ / quá nhỏ / quá to / méo) × trần 2,7 / 2,2 m × món ghim / người dùng xác nhận / không × phòng
 * nhỏ 2,5×3 / lớn 6×5 m × vai (sofa, armchair, diningTable+diningChair, doubleBed, closet). Bất biến kiểm cho MỌI kết quả.
 * Cỡ hiển thị mô phỏng đúng công thức `itemFitOf` (khớp thường / co đều / cỡ thật) cho mẫu không thuộc STRETCH_FOLDERS.
 */
import { describe, expect, it } from 'vitest';

import { WALL_BACK_ROLES } from '../itemFit';
import type { ModelQuality, QualityPart } from '../libraryQuality';
import {
  CEILING_GAP_M,
  functionalMissOf,
  overlapAreaM2,
  planRectOf,
  REAL_GROW_M,
  ROOM_OVERLAP_TOL_M2,
  roomSetOf,
  UNIFORM_MIN,
  type Dims,
  type PlanRect,
  type SetBox,
  type SetContext,
  type SetDecision,
  type SetMember,
  type SetZone,
} from '../roomSet';

type Kind = 'ok' | 'qc' | 'broken' | 'partial';
interface Model {
  readonly role: string;
  readonly dims: Dims;
  readonly kind: Kind;
}
/** Catalog tổng hợp [rộng, cao, sâu] m. `*-qc` lỗi QC, `*-broken` vân vỡ, `*-partial` giường chưa hoàn chỉnh. */
const ROLES = {
  sofa: { ok: [[2.0, 0.85, 0.9], [1.8, 0.8, 0.85]], stock: [2.0, 0.8, 0.85] },
  armchair: { ok: [[0.8, 0.85, 0.8], [0.75, 0.8, 0.78]], stock: [0.8, 0.85, 0.8] },
  diningTable: { ok: [[1.6, 0.76, 0.9], [1.4, 0.75, 0.8]], stock: [1.4, 0.75, 0.8] },
  diningChair: { ok: [[0.45, 0.85, 0.52], [0.48, 0.8, 0.55]], stock: [0.45, 0.85, 0.5] },
  doubleBed: { ok: [[1.6, 0.9, 2.1], [1.8, 0.95, 2.1]], stock: [1.6, 0.9, 2.05] },
  closet: { ok: [[1.2, 2.0, 0.6], [1.0, 1.8, 0.58]], stock: [1.2, 2.0, 0.6] },
} as const satisfies Record<string, { ok: readonly Dims[]; stock: Dims }>;
type Role = keyof typeof ROLES;
const MODELS = new Map<string, Model>();
for (const [role, r] of Object.entries(ROLES) as [Role, (typeof ROLES)[Role]][]) {
  r.ok.forEach((dims, i) => MODELS.set(`${role}-ok${i + 1}`, { role, dims, kind: 'ok' }));
  MODELS.set(`${role}-qc`, { role, dims: r.ok[0], kind: 'qc' });
  MODELS.set(`${role}-broken`, { role, dims: r.ok[0], kind: 'broken' });
  if (role === 'doubleBed') MODELS.set(`${role}-partial`, { role, dims: r.ok[0], kind: 'partial' });
  MODELS.set(`${role}-stock`, { role, dims: r.stock, kind: 'ok' });
}
const PART: QualityPart = { kind: 'upholstery', share: 1, lab: [60, 0, -2], material: 'fabric', kindBy: 'm' } as QualityPart;
const qualityOf = (id: string): ModelQuality | undefined => {
  const m = MODELS.get(id);
  // Mẫu dựng sẵn: không có dữ liệu chất lượng (như mẫu thủ tục Pascal).
  if (m === undefined || id.endsWith('-stock')) return undefined;
  return {
    role: m.role,
    useMm: m.dims.map((v) => v * 1000),
    front: { axis: '+z', check: 'ok' },
    parts: [PART],
    completeness: { v: m.kind === 'partial' ? 'partial' : 'full', by: 'm' },
    detail: { tris: 1, kb: 1, textures: 0, maxTex: 0, tier: 'light' },
    licence: 'CC0',
    source: 'test',
    ...(m.kind === 'qc' ? { issues: ['hole'] } : {}),
    ...(m.kind === 'broken' ? { texture: { v: 'broken', by: 'i' } } : {}),
  } as unknown as ModelQuality;
};
const dimsOf = (id: string): Dims | undefined => MODELS.get(id)?.dims;
const ctx: SetContext = { tierOf: () => 0, tiers: 5, dimsOf, palette: {}, qualityOf };
const BANNED_KINDS: ReadonlySet<Kind> = new Set(['qc', 'broken', 'partial']);

/* ---- Mô phỏng itemFitOf (mẫu không STRETCH, không exactFit, không heightMm) ---- */
const SEAT_TABLE: ReadonlySet<string> = new Set(['sofa', 'armchair', 'diningChair', 'diningTable']);
const clamp = (v: number, lo: number, hi: number): number => Math.min(hi, Math.max(lo, v));
const fitShown = (folder: string, box: SetBox, ceilingM: number, uniform: boolean | 'real'): Dims | undefined => {
  const m = MODELS.get(folder);
  if (m === undefined) return undefined;
  const [cw, ch, cd] = m.dims;
  const rx = box.w / cw;
  const rz = box.d / cd;
  if (uniform !== false) {
    const s = Math.min(uniform === 'real' ? 1 : Math.min(rx, rz), 1, ceilingM / ch);
    return [cw * s, ch * s, cd * s];
  }
  const maxH = Math.min(ceilingM, ch * 1.25);
  const g = Math.sqrt(rx * rz);
  const sy = Math.min(SEAT_TABLE.has(m.role) ? 1 : clamp(g, 0.9, 1.1), maxH / ch);
  const sx = Math.min(clamp(rx, g * 0.8, g * 1.25), rx);
  const sz = Math.min(clamp(rz, g * 0.8, g * 1.25), rz);
  return [cw * sx, ch * sy, cd * sz];
};

/* ---- Trục ---- */
type PoolAxis = 'đủ' | 'rỗng' | 'chỉ-cấm';
type BoxAxis = 'đúng' | 'nhỏ' | 'to' | 'méo';
type PinAxis = 'không' | 'ghim' | 'người-dùng';
const POOLS: readonly PoolAxis[] = ['đủ', 'rỗng', 'chỉ-cấm'];
const BOXES: readonly BoxAxis[] = ['đúng', 'nhỏ', 'to', 'méo'];
const PINS: readonly PinAxis[] = ['không', 'ghim', 'người-dùng'];
const CEILS = [2.7, 2.2] as const;
const ROOMS = { nhỏ: [2.5, 3], lớn: [6, 5] } as const;
interface Combo {
  role: Role | 'dining';
  room: keyof typeof ROOMS;
  pool: PoolAxis;
  box: BoxAxis;
  ceil: number;
  pin: PinAxis;
  concept: boolean;
}
const label = (c: Combo): string => `${c.role}/${c.room}/pool ${c.pool}/hộp ${c.box}/trần ${c.ceil}/${c.pin}/concept ${c.concept ? 'có' : 'không'}`;

const boxSize = (dims: Dims, b: BoxAxis): [number, number] => {
  const [w, , d] = dims;
  return b === 'đúng' ? [w, d] : b === 'nhỏ' ? [w * 0.6, d * 0.6] : b === 'to' ? [w * 1.6, d * 1.6] : [w * 1.6, d * 0.6];
};
/** Vùng chặn của phòng W×D: bốn thân tường dày 0,2 m canh trên mép + vùng mở cửa 0,9×0,9 ở góc trước phải. */
const zonesOf = (W: number, D: number): SetZone[] => [
  planRectOf(W / 2, 0, W + 0.2, 0.2, 0),
  planRectOf(W / 2, D, W + 0.2, 0.2, 0),
  planRectOf(0, D / 2, 0.2, D + 0.2, 0),
  planRectOf(W, D / 2, 0.2, D + 0.2, 0),
  planRectOf(W - 0.55, D - 0.55, 0.9, 0.9, 0),
];

interface Built {
  readonly members: SetMember[];
  readonly zones: SetZone[];
  readonly ceil: number;
}
const memberOf = (id: string, role: Role, box: SetBox, c: Combo, primary: boolean): SetMember => {
  const r = ROLES[role];
  const pool = c.pool === 'đủ' ? r.ok.map((_, i) => `${role}-ok${i + 1}`).concat(`${role}-qc`) : c.pool === 'rỗng' ? [] : [`${role}-qc`, `${role}-broken`, ...(role === 'doubleBed' ? [`${role}-partial`] : [])];
  const current = c.pool === 'đủ' ? `${role}-ok1` : c.pool === 'rỗng' ? null : `${role}-qc`;
  const conceptFolder = c.pool === 'chỉ-cấm' ? `${role}-broken` : `${role}-ok2`;
  const pinned = primary && c.pin === 'ghim';
  const user = primary && c.pin === 'người-dùng';
  return {
    id,
    role,
    short: Math.min(box.w, box.d),
    long: Math.max(box.w, box.d),
    current: pinned ? `${role}-ok1` : current,
    stock: `${role}-stock`,
    pool: pinned ? [] : pool,
    fixed: pinned,
    ...(c.concept && !pinned ? { concept: { folder: conceptFolder, shownOf: (f: string) => fitShown(f, box, c.ceil, true) } } : {}),
    ceilingM: c.ceil,
    shownOf: (f: string) => fitShown(f, box, c.ceil, false),
    box,
    sizeFrom: user ? 'user' : 'ai',
  };
};
const build = (c: Combo): Built => {
  const [W, D] = ROOMS[c.room];
  const zones = zonesOf(W, D);
  if (c.role !== 'dining') {
    const [w, d] = boxSize(ROLES[c.role].ok[0], c.box);
    // Lưng (−y cục bộ, rot 0) áp mép trong tường y = 0.
    const box: SetBox = { cx: W / 2, cy: 0.1 + d / 2, w, d, rot: 0 };
    return { members: [memberOf('M-0', c.role, box, c, true)], zones, ceil: c.ceil };
  }
  const [tw, td] = boxSize(ROLES.diningTable.ok[0], c.box);
  const table: SetBox = { cx: W / 2, cy: D / 2, w: tw, d: td, rot: 0 };
  const [cw, cd] = boxSize(ROLES.diningChair.ok[0], c.box);
  const chairs: SetBox[] = [
    { cx: W / 2, cy: D / 2 - td / 2 - 0.3, w: cw, d: cd, rot: 0 },
    { cx: W / 2, cy: D / 2 + td / 2 + 0.3, w: cw, d: cd, rot: 180 },
  ];
  return {
    members: [memberOf('M-0', 'diningTable', table, c, true), ...chairs.map((b, i) => memberOf(`M-${i + 1}`, 'diningChair', b, c, false))],
    zones,
    ceil: c.ceil,
  };
};

/* ---- Bất biến ---- */
/** Cỡ hiển thị thật của quyết định (đúng phép dựng: 'real' cỡ thật, true co đều, còn lại khớp thường). */
const shownOfDecision = (m: SetMember, d: SetDecision, ceil: number): Dims | undefined =>
  d.to === null || m.box === undefined ? undefined : fitShown(d.to, m.box, ceil, d.uniform ?? false);
/** Mặt bằng dựng: cỡ thật áp lưng tường như itemFitOf/realRectOf; còn lại canh giữa hộp. */
const rectOfDecision = (m: SetMember, d: SetDecision, shown: Dims): PlanRect => {
  const b = m.box as SetBox;
  const k = d.uniform === 'real' && WALL_BACK_ROLES.has(m.role) ? (shown[2] - b.d) / 2 : 0;
  const t = (b.rot * Math.PI) / 180;
  return planRectOf(b.cx - Math.sin(t) * k, b.cy + Math.cos(t) * k, shown[0], shown[2], b.rot);
};
const hitOf = (r: PlanRect, zones: readonly SetZone[]): number => zones.reduce((s, z) => s + overlapAreaM2(r, z), 0);

/** Lỗi bất biến (1)–(4) của một kết quả; mỗi dòng ghi tổ hợp + món. */
const violationsOf = (c: Combo, b: Built, out: ReadonlyMap<string, SetDecision>, forcedHits: string[]): string[] => {
  const errs: string[] = [];
  for (const m of b.members) {
    const d = out.get(m.id);
    const at = `${label(c)} · ${m.id} ${m.role}`;
    if (d === undefined) {
      errs.push(`${at}: không có quyết định`);
      continue;
    }
    // (3) món ghim: mẫu không đổi; người dùng: hộp không đổi (không dựng cỡ thật vượt hộp).
    if (m.fixed) {
      if (d.to !== m.current || d.cause !== 'pinned') errs.push(`${at}: (3) món ghim đổi ${m.current} → ${d.to} (${d.cause})`);
      continue;
    }
    if (m.sizeFrom === 'user' && d.uniform === 'real') errs.push(`${at}: (3) cỡ người dùng bị dựng cỡ thật`);
    if (d.to === null) continue;
    const model = MODELS.get(d.to);
    // (1) không bao giờ mẫu cấm.
    if (model === undefined) errs.push(`${at}: mẫu lạ ${d.to}`);
    else if (BANNED_KINDS.has(model.kind)) errs.push(`${at}: (1) dựng mẫu cấm ${d.to} (${d.cause}, ${d.why})`);
    else if (model.role !== m.role) errs.push(`${at}: (1) sai vai ${d.to}`);
    const shown = shownOfDecision(m, d, b.ceil);
    if (shown === undefined || model === undefined) continue;
    if (m.sizeFrom !== 'user' && (m.liftM ?? 0) + shown[1] > b.ceil - CEILING_GAP_M + 1e-9) {
      errs.push(`${at}: (1) chạm trần — cao ${shown[1].toFixed(3)} trần ${b.ceil} (${d.to}, ${d.cause})`);
    }
    // (2) công năng trên cỡ hiển thị; không co đều dưới phạm vi.
    if (m.sizeFrom !== 'user') {
      const miss = functionalMissOf(m.role, model.dims, shown);
      if (miss !== undefined) errs.push(`${at}: (2) ngoài công năng ${miss} — ${d.to} uniform ${String(d.uniform ?? false)} (${d.cause}, ${d.why})`);
      if (d.uniform === true && shown[0] / model.dims[0] < UNIFORM_MIN - 1e-9) errs.push(`${at}: (2) co đều ${(shown[0] / model.dims[0]).toFixed(2)} < ${UNIFORM_MIN}`);
    }
    // (4) cỡ thật vượt hộp ≤ REAL_GROW_M; không chồng vùng chặn quá phần hộp đã chồng (trừ `forced` chồng đồ đạc, không tường/cửa).
    const box = m.box as SetBox;
    if (d.uniform === 'real' && (shown[0] > box.w + REAL_GROW_M + 1e-6 || shown[2] > box.d + REAL_GROW_M + 1e-6)) {
      errs.push(`${at}: (4) cỡ thật ${shown[0].toFixed(2)}×${shown[2].toFixed(2)} vượt hộp ${box.w.toFixed(2)}×${box.d.toFixed(2)} quá ${REAL_GROW_M}`);
    }
    const hit = hitOf(rectOfDecision(m, d, shown), b.zones);
    const boxHit = hitOf(planRectOf(box.cx, box.cy, box.w, box.d, box.rot), b.zones);
    if (hit > boxHit + ROOM_OVERLAP_TOL_M2 + 1e-9) {
      // F5-2: forced chỉ được chồng ĐỒ ĐẠC (vùng có `kind`); vùng ma trận là tường/cửa (không `kind`) → luôn là lỗi.
      if (d.forced?.includes('va chạm') === true && b.zones.some((z) => z.kind !== undefined)) forcedHits.push(`${at}: chồng ${hit.toFixed(3)} > hộp ${boxHit.toFixed(3)} m² — forced (${d.forced})`);
      else errs.push(`${at}: (4) chồng vùng chặn ${hit.toFixed(3)} > hộp ${boxHit.toFixed(3)} m² (${d.to}, ${d.cause}, uniform ${String(d.uniform ?? false)}, ${d.why})`);
    }
  }
  return errs;
};

/** Kết quả không phụ thuộc id: thay id món bằng thứ tự gốc, bỏ `id`. */
const normalOf = (out: ReadonlyMap<string, SetDecision>, ids: ReadonlyMap<string, string>): Record<string, unknown> => {
  const swap = (s: string): string => [...ids].reduce((t, [from, to]) => t.split(from).join(to), s);
  return Object.fromEntries(
    [...out].map(([id, d]) => {
      return [swap(id), JSON.parse(swap(JSON.stringify({ ...d, id: '' }))) as unknown];
    }),
  );
};

const combosOf = (role: Combo['role'], room: Combo['room'], pool: PoolAxis): Combo[] =>
  BOXES.flatMap((box) => CEILS.flatMap((ceil) => PINS.flatMap((pin) => [false, true].map((concept) => ({ role, room, pool, box, ceil, pin, concept })))));

const TOTAL = { combos: 0, forced: [] as string[], causes: new Map<string, number>() };
const MATRIX_ROLES: readonly Combo['role'][] = ['sofa', 'armchair', 'dining', 'doubleBed', 'closet'];

describe('vòng 17 làn D — ma trận roomSetOf (bất biến 1–6)', () => {
  for (const role of MATRIX_ROLES) {
    for (const room of Object.keys(ROOMS) as Combo['room'][]) {
      for (const pool of POOLS) {
        it(`${role} · phòng ${room} · pool ${pool} (48 tổ hợp)`, () => {
          const errs: string[] = [];
          for (const c of combosOf(role, room, pool)) {
            TOTAL.combos += 1;
            const b = build(c);
            const out = roomSetOf('room-key', b.members, new Map(), ctx, b.zones);
            errs.push(...violationsOf(c, b, out, TOTAL.forced));
            for (const d of out.values()) {
              const k = `${d.cause}${d.to === null ? ':null' : d.uniform === undefined ? '' : `:${String(d.uniform)}`}`;
              TOTAL.causes.set(k, (TOTAL.causes.get(k) ?? 0) + 1);
            }
            // (6) cùng đầu vào gọi hai lần → cùng kết quả.
            const again = roomSetOf('room-key', b.members, new Map(), ctx, b.zones);
            if (JSON.stringify([...again]) !== JSON.stringify([...out])) errs.push(`${label(c)}: (6) gọi lại khác kết quả`);
            // (5) đổi thứ tự + id (giữ nội dung) → cùng kết quả.
            const rename = new Map(b.members.map((m, i) => [m.id, `Q-${9 - i}`] as const));
            const back = new Map([...rename].map(([a, z]) => [z, a] as const));
            const shuffled = [...b.members].reverse().map((m) => ({ ...m, id: rename.get(m.id) as string }));
            const out2 = roomSetOf('room-key', shuffled, new Map(), ctx, [...b.zones].reverse());
            const a1 = JSON.stringify(normalOf(out, new Map()));
            const a2 = JSON.stringify(normalOf(out2, back));
            if (a1 !== a2) errs.push(`${label(c)}: (5) đổi thứ tự/id khác kết quả\n  ${a1}\n  ${a2}`);
          }
          expect(errs, errs.slice(0, 8).join('\n')).toEqual([]);
        });
      }
    }
  }
  it('tổng số tổ hợp + ghi sổ forced (va chạm có chủ đích)', () => {
    expect(TOTAL.combos).toBe(MATRIX_ROLES.length * 2 * POOLS.length * 48);
    // Đầu ra cho KET-QUA (không phải bất biến): mẫu dựng sẵn cỡ thật đặt DÙ va chạm, cờ `forced` ghi lại.
    console.info(`[matrix17] tổ hợp ${TOTAL.combos}; ${JSON.stringify(Object.fromEntries([...TOTAL.causes].sort()))}; forced va chạm ${TOTAL.forced.length}\n${TOTAL.forced.slice(0, 12).join('\n')}`);
  });
});
