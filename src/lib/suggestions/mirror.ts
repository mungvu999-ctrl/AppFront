/**
 * M2 — "tự chạy nhẹ" để xem trước (hợp đồng §5): R1, R4, C2, F1, L1 chép SỐ-THEO-SỐ từ AppBack
 * `packages/domain/suggestions/rules/{geom,walls,openings,furniture,rooms}.py`. Chỉ để xem trước trước khi máy
 * chủ reconcile; bản đã lưu luôn thắng. Mỗi luật phải ra đúng ca vàng của AppBack (`suggestionMirror.test.ts`);
 * luật nào lệch thì `MIRROR_RULES` bỏ nó (hạ về chỉ vẽ bản đã lưu).
 *
 * Quy ước: làm tròn `floor(x + 0.5)` (= `js_round` của AppBack), polylabel theo mapbox/polylabel với hàng đợi ưu tiên
 * hoà theo thứ tự chèn (như `heapq` + bộ đếm), mọi danh sách sắp theo id.
 */

import type { SuggestionRuleSpec, SuggestionRuleset } from '@/api/schemas/suggestionRules';
import { SuggestionSchema, type Suggestion } from '@/api/schemas/suggestions';
import type { Furniture, Opening, Room, Wall } from '@/domain/spatial/types';

type XY = readonly [number, number];
type Interval = readonly [number, number];

export interface MirrorLayer {
  readonly walls: readonly Wall[];
  readonly rooms: readonly Room[];
  readonly openings: readonly Opening[];
  readonly furniture: readonly Furniture[];
}

/** Bản nháp đúng hình tệp vàng của AppBack. */
export interface MirrorDraft {
  readonly id: string;
  readonly rule: string;
  readonly ruleVersion: number;
  readonly kind: string;
  readonly hostRef: Readonly<Record<string, string>>;
  readonly params: Readonly<Record<string, unknown>>;
}

/** Luật được chép; luật lệch ca vàng phải bị gỡ khỏi đây (test khoá). */
export const MIRROR_RULES = ['R1', 'R4', 'C2', 'F1', 'L1'] as const;
export type MirrorRule = (typeof MIRROR_RULES)[number];

const byId = <T extends { readonly id: string }>(items: readonly T[]): T[] =>
  [...items].sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
const cmpTuple = (a: readonly (number | string)[], b: readonly (number | string)[]): number => {
  for (let i = 0; i < Math.min(a.length, b.length); i += 1) {
    const [x, y] = [a[i]!, b[i]!];
    if (x !== y) return x < y ? -1 : 1;
  }
  return a.length - b.length;
};

/* --------------------------------- hình học --------------------------------- */

/** `js_round` của AppBack: `floor(x + 0.5)` (khác `Math.round` ở 0,49999999999999994). */
const jsRound = (value: number): number => Math.floor(value + 0.5);

const ring = (points: readonly { x: number; y: number }[]): XY[] => points.map((p) => [p.x, p.y] as const);

const signedArea = (pts: readonly XY[]): number =>
  pts.reduce((sum, a, i) => {
    const b = pts[(i + 1) % pts.length]!;
    return sum + a[0] * b[1] - b[0] * a[1];
  }, 0) / 2;

const pointInRing = (x: number, y: number, pts: readonly XY[]): boolean => {
  let inside = false;
  let j = pts.length - 1;
  for (let i = 0; i < pts.length; i += 1) {
    const [ax, ay] = pts[i]!;
    const [bx, by] = pts[j]!;
    if (ay > y !== by > y && x < ((bx - ax) * (y - ay)) / (by - ay) + ax) inside = !inside;
    j = i;
  }
  return inside;
};

const roomAt = (rooms: readonly Room[], x: number, y: number): Room | undefined =>
  byId(rooms).find((room) => pointInRing(x, y, ring(room.outline)));

interface Frame {
  readonly ox: number;
  readonly oy: number;
  readonly dx: number;
  readonly dy: number;
  readonly length: number;
}

const frameOf = (wall: Wall): Frame => {
  const { start: s, end: e } = wall.centreline;
  const length = Math.hypot(e.x - s.x, e.y - s.y);
  return { ox: s.x, oy: s.y, dx: (e.x - s.x) / length, dy: (e.y - s.y) / length, length };
};

/** (dọc, ngang) của một điểm; pháp tuyến trái n = (−dy, dx). */
const local = (f: Frame, x: number, y: number): XY => {
  const [rx, ry] = [x - f.ox, y - f.oy];
  return [rx * f.dx + ry * f.dy, rx * -f.dy + ry * f.dx];
};

/** Khoảng tham số t ∈ [0, 1] của đoạn a-b nằm trong hình chữ nhật tường nới `margin` (Liang-Barsky). */
const clipToBand = (f: Frame, a: XY, b: XY, halfWidth: number, margin: number): Interval | null => {
  const [au, av] = local(f, a[0], a[1]);
  const [bu, bv] = local(f, b[0], b[1]);
  let [t0, t1] = [0, 1];
  for (const [p, q] of [
    [-(bu - au), au - -margin],
    [bu - au, f.length + margin - au],
    [-(bv - av), av + halfWidth],
    [bv - av, halfWidth - av],
  ] as const) {
    if (p === 0) {
      if (q < 0) return null;
      continue;
    }
    const r = q / p;
    if (p < 0) t0 = Math.max(t0, r);
    else t1 = Math.min(t1, r);
    if (t0 > t1) return null;
  }
  return [t0, t1];
};

const union = (intervals: readonly Interval[]): [number, number][] => {
  const out: [number, number][] = [];
  for (const [lo, hi] of [...intervals].sort(cmpTuple)) {
    const last = out[out.length - 1];
    if (last !== undefined && lo <= last[1]) last[1] = Math.max(last[1], hi);
    else out.push([lo, hi]);
  }
  return out;
};

const subtract = (base: readonly Interval[], cuts: readonly Interval[]): Interval[] => {
  let out: Interval[] = union(base);
  for (const [clo, chi] of union(cuts)) {
    const next: Interval[] = [];
    for (const [lo, hi] of out) {
      if (chi <= lo || clo >= hi) {
        next.push([lo, hi]);
        continue;
      }
      if (clo > lo) next.push([lo, clo]);
      if (chi < hi) next.push([chi, hi]);
    }
    out = next;
  }
  return out;
};

const rounded = (spans: readonly Interval[], minMm: number): [number, number][] =>
  spans.map(([lo, hi]): [number, number] => [jsRound(lo), jsRound(hi)]).filter(([lo, hi]) => hi - lo >= minMm);

const segDistSq = (px: number, py: number, a: XY, b: XY): number => {
  let [x, y] = a;
  let [dx, dy] = [b[0] - x, b[1] - y];
  if (dx !== 0 || dy !== 0) {
    const t = ((px - x) * dx + (py - y) * dy) / (dx * dx + dy * dy);
    if (t > 1) [x, y] = b;
    else if (t > 0) {
      x += dx * t;
      y += dy * t;
    }
  }
  [dx, dy] = [px - x, py - y];
  return dx * dx + dy * dy;
};

const signedDist = (x: number, y: number, pts: readonly XY[]): number => {
  let best = Infinity;
  for (let i = 0; i < pts.length; i += 1) best = Math.min(best, segDistSq(x, y, pts[i]!, pts[(i - 1 + pts.length) % pts.length]!));
  if (best === 0) return 0;
  return pointInRing(x, y, pts) ? Math.sqrt(best) : -Math.sqrt(best);
};

interface Cell {
  readonly x: number;
  readonly y: number;
  readonly h: number;
  readonly d: number;
  readonly max: number;
}

/** Hàng đợi ưu tiên nhị phân: `max` lớn trước, hoà thì chèn trước ra trước (như `heapq` + bộ đếm). */
class CellQueue {
  private readonly items: { cell: Cell; order: number }[] = [];
  private next = 0;
  get size(): number {
    return this.items.length;
  }
  private before(i: number, j: number): boolean {
    const [a, b] = [this.items[i]!, this.items[j]!];
    return a.cell.max > b.cell.max || (a.cell.max === b.cell.max && a.order < b.order);
  }
  private swap(i: number, j: number): void {
    [this.items[i], this.items[j]] = [this.items[j]!, this.items[i]!];
  }
  push(cell: Cell): void {
    this.items.push({ cell, order: this.next++ });
    let i = this.items.length - 1;
    while (i > 0) {
      const parent = (i - 1) >> 1;
      if (!this.before(i, parent)) break;
      this.swap(i, parent);
      i = parent;
    }
  }
  pop(): Cell {
    const top = this.items[0]!.cell;
    const last = this.items.pop()!;
    if (this.items.length > 0) {
      this.items[0] = last;
      let i = 0;
      for (;;) {
        const [l, r] = [2 * i + 1, 2 * i + 2];
        let m = i;
        if (l < this.items.length && this.before(l, m)) m = l;
        if (r < this.items.length && this.before(r, m)) m = r;
        if (m === i) break;
        this.swap(i, m);
        i = m;
      }
    }
    return top;
  }
}

/** Cực xa biên nhất của một vòng đơn (mapbox/polylabel v2), đúng thứ tự phép tính của AppBack. */
export const polylabel = (pts: readonly XY[], precision: number): XY => {
  const xs = pts.map((p) => p[0]);
  const ys = pts.map((p) => p[1]);
  const [minX, minY, maxX, maxY] = [Math.min(...xs), Math.min(...ys), Math.max(...xs), Math.max(...ys)];
  const [width, height] = [maxX - minX, maxY - minY];
  const cellSize = Math.max(precision, Math.min(width, height));
  if (cellSize === precision) return [minX, minY];

  const cell = (x: number, y: number, h: number): Cell => {
    const d = signedDist(x, y, pts);
    return { x, y, h, d, max: d + h * Math.sqrt(2) };
  };
  let [area2, cx, cy] = [0, 0, 0];
  for (let i = 0; i < pts.length; i += 1) {
    const a = pts[i]!;
    const b = pts[(i - 1 + pts.length) % pts.length]!;
    const f = a[0] * b[1] - b[0] * a[1];
    cx += (a[0] + b[0]) * f;
    cy += (a[1] + b[1]) * f;
    area2 += f * 3;
  }
  const bbox = cell(minX + width / 2, minY + height / 2, 0);
  const centroid = area2 !== 0 ? cell(cx / area2, cy / area2, 0) : cell(pts[0]![0], pts[0]![1], 0);
  let best = bbox.d > centroid.d ? bbox : centroid;
  const queue = new CellQueue();
  const probe = (x: number, y: number, h: number): void => {
    const c = cell(x, y, h);
    if (c.max > best.d + precision) queue.push(c);
    if (c.d > best.d) best = c;
  };

  let h = cellSize / 2;
  for (let x = minX; x < maxX; x += cellSize) {
    for (let y = minY; y < maxY; y += cellSize) probe(x + h, y + h, h);
  }
  while (queue.size > 0) {
    const c = queue.pop();
    if (c.max - best.d <= precision) break;
    h = c.h / 2;
    probe(c.x - h, c.y - h, h);
    probe(c.x + h, c.y - h, h);
    probe(c.x - h, c.y + h, h);
    probe(c.x + h, c.y + h, h);
  }
  return [best.x, best.y];
};

/* ---------------------------------- luật ---------------------------------- */

const PARALLEL_SIN = 0.05;

type Params = Readonly<Record<string, unknown>>;
const num = (p: Params, key: string): number => p[key] as number;
const strs = (p: Params, key: string): readonly string[] => p[key] as readonly string[];

const doorCuts = (layer: MirrorLayer, margin: number): Map<string, Interval[]> => {
  const cuts = new Map<string, Interval[]>();
  for (const o of layer.openings) {
    if (o.kind === 'door') cuts.set(o.wallId, [...(cuts.get(o.wallId) ?? []), [o.offsetMm - margin, o.offsetMm + o.widthMm + margin]]);
  }
  return cuts;
};

/** (tường, mặt) → các đoạn trục tường mà một cạnh phòng chạy dọc, phía phòng. */
const facesOf = (room: Room, walls: readonly (readonly [Wall, Frame])[], tol: number): Map<string, Interval[]> => {
  const pts = ring(room.outline);
  const turn = signedArea(pts) > 0 ? 1 : -1;
  const faces = new Map<string, Interval[]>();
  pts.forEach((a, i) => {
    const b = pts[(i + 1) % pts.length]!;
    const length = Math.hypot(b[0] - a[0], b[1] - a[1]);
    if (length === 0) return;
    const [ex, ey] = [(b[0] - a[0]) / length, (b[1] - a[1]) / length];
    const [inx, iny] = [-ey * turn, ex * turn];
    for (const [wall, f] of walls) {
      if (Math.abs(ex * f.dy - ey * f.dx) > PARALLEL_SIN) continue;
      const [, across] = local(f, (a[0] + b[0]) / 2, (a[1] + b[1]) / 2);
      if (Math.abs(across) > wall.thicknessMm / 2 + tol) continue;
      const [u0, u1] = [local(f, a[0], a[1])[0], local(f, b[0], b[1])[0]];
      const [s0, s1] = [Math.max(Math.min(u0, u1), 0), Math.min(Math.max(u0, u1), f.length)];
      if (s1 > s0) {
        const side = inx * -f.dy + iny * f.dx > 0 ? 'left' : 'right';
        const key = `${wall.id}\u0000${side}`;
        faces.set(key, [...(faces.get(key) ?? []), [s0, s1]]);
      }
    }
  });
  return faces;
};

const r1 = (layer: MirrorLayer, spec: SuggestionRuleSpec): MirrorDraft[] => {
  const p = spec.params;
  const excluded = new Set(strs(p, 'excludeUsages'));
  const [minSpan, tol] = [Math.trunc(num(p, 'minSpanMm')), Math.trunc(num(p, 'faceToleranceMm'))];
  const cuts = doorCuts(layer, Math.trunc(num(p, 'doorMarginMm')));
  const straight = byId(layer.walls)
    .filter((w) => !w.curveOffsetMm)
    .map((w) => [w, frameOf(w)] as const);
  const out: MirrorDraft[] = [];
  for (const room of byId(layer.rooms)) {
    if (excluded.has(room.usage)) continue;
    const byWall = new Map<string, Map<string, [number, number][]>>();
    const faces = [...facesOf(room, straight, tol).entries()].sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
    for (const [key, spans] of faces) {
      const [wallId, side] = key.split('\u0000') as [string, string];
      const kept = rounded(subtract(union(spans), cuts.get(wallId) ?? []), minSpan);
      if (kept.length > 0) byWall.set(wallId, (byWall.get(wallId) ?? new Map()).set(side, kept));
    }
    for (const wallId of [...byWall.keys()].sort()) {
      const sides = byWall.get(wallId)!;
      const score = (s: string): [number, number] => [sides.get(s)!.reduce((sum, [lo, hi]) => sum + hi - lo, 0), s === 'left' ? 1 : 0];
      let side = '';
      for (const s of sides.keys()) if (side === '' || cmpTuple(score(s), score(side)) > 0) side = s;
      out.push({
        id: `DRESS-R1-${room.id}-${wallId}`,
        rule: 'R1',
        ruleVersion: spec.version,
        kind: 'skirting',
        hostRef: { room: room.id, wall: wallId },
        params: { side, spansMm: sides.get(side)!, heightMm: p['heightMm'], thicknessMm: p['thicknessMm'], material: p['material'] },
      });
    }
  }
  return out;
};

const r4 = (layer: MirrorLayer, spec: SuggestionRuleSpec): MirrorDraft[] => {
  const p = spec.params;
  const [gap, minEdge] = [Math.trunc(num(p, 'wallGapMm')), Math.trunc(num(p, 'minEdgeMm'))];
  const walls = byId(layer.walls).map((w) => [w, frameOf(w)] as const);
  const out: MirrorDraft[] = [];
  for (const room of byId(layer.rooms)) {
    if (!strs(p, 'usages').includes(room.usage)) continue;
    const pts = ring(room.outline);
    pts.forEach((a, k) => {
      const b = pts[(k + 1) % pts.length]!;
      const length = Math.hypot(b[0] - a[0], b[1] - a[1]);
      const covered = walls.flatMap(([wall, f]) => {
        const iv = clipToBand(f, a, b, wall.thicknessMm / 2 + gap, gap);
        return iv === null ? [] : [[iv[0] * length, iv[1] * length] as const];
      });
      const spans = rounded(subtract([[0, length]], covered), minEdge);
      if (spans.length === 0) return;
      const [start, end] = [room.outline[k]!, room.outline[(k + 1) % pts.length]!];
      out.push({
        id: `DRESS-R4-${room.id}-e${k}`,
        rule: 'R4',
        ruleVersion: spec.version,
        kind: 'railing',
        hostRef: { room: room.id },
        params: {
          edgeIndex: k,
          start: { x: start.x, y: start.y },
          end: { x: end.x, y: end.y },
          spansMm: spans,
          heightMm: p['heightMm'],
          handrailMm: p['handrailMm'],
          glassMm: p['glassMm'],
          postSpacingMaxMm: p['postSpacingMaxMm'],
          metalMaterial: p['metalMaterial'],
          glassMaterial: p['glassMaterial'],
        },
      });
    });
  }
  return out;
};

const c2 = (layer: MirrorLayer, spec: SuggestionRuleSpec): MirrorDraft[] =>
  byId(layer.openings.filter((o) => o.kind === 'window')).map((o) => ({
    id: `DRESS-C2-${o.id}`,
    rule: 'C2',
    ruleVersion: spec.version,
    kind: 'sash',
    hostRef: { opening: o.id },
    params: { frameWidthMm: spec.params['frameWidthMm'], frameDepthMm: spec.params['frameDepthMm'] },
  }));

/** `f"{mm / 1000:.{digits}f}"` của Python (làm tròn theo giá trị nhị phân, hoà đúng thì về số chẵn) với dấu phẩy. */
export const metresVi = (mm: number, digits: number): string => {
  const x = mm / 1000;
  const scaled = mm * 10 ** digits;
  // Hoà thật (giá trị nhị phân đúng bằng ...5): Python làm tròn về chẵn, `toFixed` làm tròn lên.
  const exactTie = Number.isInteger(mm) && scaled % 1000 === 500 && Number.isInteger(x * 8);
  const text = exactTie
    ? (() => {
        const lower = Math.floor(scaled / 1000);
        const even = lower % 2 === 0 ? lower : lower + 1;
        return (even / 10 ** digits).toFixed(digits);
      })()
    : x.toFixed(digits);
  return text.replace('.', ',');
};

interface F1Row {
  readonly kind: string;
  readonly variant?: string;
  readonly roomUsages?: readonly string[];
  readonly minLongMm?: number;
  readonly maxLongMm?: number;
  readonly minShortMm?: number;
  readonly maxShortMm?: number;
  readonly maxAspect?: number;
  readonly pick: string | null;
  readonly reasonVi?: string;
  readonly kindAs?: string;
  readonly variantAs?: string;
}

const f1 = (layer: MirrorLayer, spec: SuggestionRuleSpec): MirrorDraft[] => {
  const p = spec.params;
  const table = p['table'] as readonly F1Row[];
  const models = p['models'] as Readonly<Record<string, { sizeMm: readonly number[]; nameVi: string }>>;
  const rooms = new Map(layer.rooms.map((r) => [r.id as string, r]));
  const kinds = new Set(table.map((row) => row.kind));
  const out: MirrorDraft[] = [];
  for (const f of byId(layer.furniture)) {
    if (f.suggested === true || !kinds.has(f.kind) || f.model !== undefined) continue;
    const w = f.boundingBox.max.x - f.boundingBox.min.x;
    const d = f.boundingBox.max.y - f.boundingBox.min.y;
    const [long, short] = [Math.max(w, d), Math.min(w, d)];
    const room = f.roomId !== undefined ? rooms.get(f.roomId) : roomAt(layer.rooms, f.centre.x, f.centre.y);
    const usage = room?.usage;
    const row = table.find(
      (r) =>
        r.kind === f.kind &&
        ('variant' in r ? r.variant : f.variant) === f.variant &&
        (r.roomUsages === undefined || (usage !== undefined && r.roomUsages.includes(usage))) &&
        (r.minLongMm ?? 0) <= long &&
        long <= (r.maxLongMm ?? long) &&
        (r.minShortMm ?? 0) <= short &&
        short <= (r.maxShortMm ?? short) &&
        (r.maxAspect === undefined || long < r.maxAspect * short),
    );
    if (row === undefined || row.pick === null) continue;
    const locked = f.source !== 'ai' || f.reviewed || f.edited === true;
    if ((row.kindAs !== undefined || row.variantAs !== undefined) && locked) continue;
    const model = models[row.pick]!;
    const [mw, md] = [model.sizeMm[0]!, model.sizeMm[1]!];
    const ratio = Math.min(long / Math.max(mw, md), short / Math.min(mw, md));
    if (ratio < 1 - num(p, 'scaleTolPct') / 100) continue;
    out.push({
      id: `DRESS-F1-${f.id}`,
      rule: 'F1',
      ruleVersion: spec.version,
      kind: 'modelPick',
      hostRef: { furniture: f.id },
      params: {
        modelId: row.pick,
        scale: ratio >= 1 ? 1 : jsRound(ratio * 1000) / 1000,
        reasonVi: `hộp ${metresVi(long, 2)} × ${metresVi(short, 2)} m → ${model.nameVi}`,
        ...(row.kindAs === undefined ? {} : { kindAs: row.kindAs }),
        ...(row.variantAs === undefined ? {} : { variantAs: row.variantAs }),
      },
    });
  }
  return out;
};

const l1 = (layer: MirrorLayer, spec: SuggestionRuleSpec): MirrorDraft[] => {
  const p = spec.params;
  return byId(layer.rooms)
    .filter((room) => !strs(p, 'skipUsages').includes(room.usage))
    .map((room) => {
      const [x, y] = polylabel(ring(room.outline), num(p, 'precisionMm'));
      const lamp = strs(p, 'lampUsages').includes(room.usage) && room.areaM2 >= num(p, 'lampMinAreaM2');
      return {
        id: `DRESS-L1-${room.id}`,
        rule: 'L1',
        ruleVersion: spec.version,
        kind: 'ceilingLight',
        hostRef: { room: room.id },
        params: {
          centre: { x: jsRound(x), y: jsRound(y) },
          fixture: lamp ? 'pendant' : 'panel',
          ...(lamp ? { modelId: p['lampModelId'] } : { sizeMm: p['panelSizeMm'] }),
        },
      };
    });
};

const RULE_FNS: Readonly<Record<MirrorRule, (layer: MirrorLayer, spec: SuggestionRuleSpec) => MirrorDraft[]>> = { R1: r1, R4: r4, C2: c2, F1: f1, L1: l1 };

/** Bản nháp các luật chép (mặc định cả năm), sắp theo id như tệp vàng; luật vắng trong bảng thì bỏ. */
export function mirrorSuggestions(
  layer: MirrorLayer,
  ruleset: SuggestionRuleset,
  rules: readonly MirrorRule[] = MIRROR_RULES,
): MirrorDraft[] {
  return byId(
    rules.flatMap((rule) => {
      const spec = ruleset.rules[rule];
      return spec === undefined ? [] : RULE_FNS[rule](layer, spec);
    }),
  );
}

/**
 * Xem trước khi máy chủ chưa reconcile (tầng có sửa chưa lưu): bản đã lưu của luật chép nhận `params` mới từ
 * gương, giữ `state`/`override`; id gương sinh mới thì thêm `active`; bản gương không sinh nữa thì coi như cũ
 * (không vẽ) tới khi máy chủ trả lời. Luật khác giữ nguyên. Kết quả sắp theo id.
 */
export function previewSuggestions(saved: readonly Suggestion[], layer: MirrorLayer, ruleset: SuggestionRuleset): Suggestion[] {
  const drafts = new Map(mirrorSuggestions(layer, ruleset).map((draft) => [draft.id, draft]));
  const mirrored = new Set<string>(MIRROR_RULES);
  const known = new Set(saved.map((s) => s.id));
  const kept = saved.map((s): Suggestion => {
    if (!mirrored.has(s.rule) || s.stale !== undefined) return s;
    const draft = drafts.get(s.id);
    const next = draft === undefined ? { ...s, stale: { since: s.createdRevision, reasonVi: PREVIEW_STALE_VI } } : { ...s, params: draft.params };
    const parsed = SuggestionSchema.safeParse(next);
    return parsed.success ? parsed.data : s;
  });
  const added = [...drafts.values()].flatMap((draft) => {
    if (known.has(draft.id)) return [];
    const parsed = SuggestionSchema.safeParse({ ...draft, state: 'active', createdRevision: 0 });
    return parsed.success ? [parsed.data] : [];
  });
  return byId([...kept, ...added]);
}

/** Lý do tạm của bản gương không còn sinh, trong lúc chờ máy chủ. */
export const PREVIEW_STALE_VI = 'đang chờ máy chủ cập nhật gợi ý';
