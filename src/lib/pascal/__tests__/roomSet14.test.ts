/**
 * Vòng 14 — MỘT đường chọn mẫu (`roomSetOf` cho mọi món vai bộ chưa ghim) và ca xấu vòng 13, tái hiện bằng luật CHUNG
 * trên dữ liệu chất lượng thật (id mẫu chỉ là dữ liệu test, luật không biết tên mẫu/căn):
 * - bàn gỗ đỏ chọn theo cỡ ở chỗ vuông nhỏ (ch-06, ch-10) — luật cũ không còn chọn trước;
 * - ghế trắng/xám lạnh cạnh bàn gỗ ấm (cn-03, kc-2t) — phần thân không gỗ của ghế chấm theo gỗ bàn;
 * - hai kiểu ghế quanh một bàn (f-03) — ghế gom theo bàn, mẫu chung chấp nhận được cho mọi ghế của bàn;
 * - chính sách món đã xác nhận chưa gán mẫu: cùng đánh giá, đổi theo catalog; món ghim không đổi.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import type { Furniture, RoomUsage } from '@/domain/spatial/types';

import { clearServerLibrary, registerServerLibrary } from '../furnitureCatalog';
import { itemFitOf } from '../itemFit';
import { LIBRARY_QUALITY, type ModelQuality } from '../libraryQuality';
import LIBRARY from '../libraryRoles.json' with { type: 'json' };
import { ANCHOR_BAND, FAIL_COST, hardRejectOf, paletteOf, planRectOf, roomSetOf, SHARE_BAND, type Dims, type SetContext, type SetMember } from '../roomSet';
import { sceneStyleOf } from '../sceneStyles';
import { addRoomSetMembers, contextRolesOf, finishRoomSet, modelFolderOf, roomSetPools, roomSetReport, roomSetSwapOf, setRoomSetKeys, type LayerStyle } from '../sceneVariety';

const roles = LIBRARY.roles as Record<string, string[]>;
const libStyles = (LIBRARY as unknown as { models: Record<string, { s: string[] }> }).models;
const real = (id: string): ModelQuality | undefined => LIBRARY_QUALITY.models[id];
const dimsOf = (id: string): Dims | undefined => {
  const u = real(id)?.useMm;
  return u === undefined ? undefined : [u[0] / 1000, u[1] / 1000, u[2] / 1000];
};
const am = sceneStyleOf('am-ap');
const wanted = am.libraryStyles ?? [];
const ctx: SetContext = {
  tierOf: (f) => {
    const s = libStyles[f]?.s ?? [];
    const best = Math.min(...wanted.map((c, i) => (s.includes(c) ? i : Infinity)));
    return best !== Infinity ? best : s.length === 0 ? wanted.length : wanted.length + 1;
  },
  tiers: wanted.length,
  dimsOf,
  palette: paletteOf(am, 'l'),
  qualityOf: real,
};
const ROLES = ['diningTable', 'diningChair', 'sofa'];
const pool = (role: string): string[] => (roles[role] ?? []).filter((id) => real(id) !== undefined);
const CEIL = 2.7;
/** Món có hộp thật (m), cỡ hiển thị bằng đúng phép co dựng cảnh (`itemFitOf`). */
const at = (id: string, role: string, current: string | null, w: number, d: number, cx: number, cy: number, extra: Partial<SetMember> = {}): SetMember => ({
  id,
  role,
  kind: role === 'diningTable' ? 'table' : 'chair',
  short: Math.min(w, d),
  long: Math.max(w, d),
  current,
  pool: pool(role),
  fixed: false,
  sizeFrom: 'ai',
  box: { cx, cy, w, d, rot: 0 },
  ceilingM: CEIL,
  shownOf: (x) => itemFitOf(x, w, d, undefined, CEIL * 1000)?.shownM,
  ...extra,
});
const pinnedAt = (id: string, role: string, folder: string, w: number, d: number, cx: number, cy: number): SetMember =>
  at(id, role, folder, w, d, cx, cy, { fixed: true, pool: [] });
/** a* trung bình theo tỉ phần của phần tông gỗ (gỗ đỏ/cam: a* cao). */
const woodA = (id: string | null | undefined): number => {
  const w = (real(id ?? '')?.parts ?? []).filter((p) => p.material === 'wood' && Math.hypot(p.lab[1], p.lab[2]) >= 8);
  const s = w.reduce((a, p) => a + p.share, 0);
  return s === 0 ? 0 : w.reduce((a, p) => a + p.lab[1] * p.share, 0) / s;
};
const WALNUT_TABLES = ['table-walnut-square-tapered-legs', 'table-walnut-small-splayed-legs', 'table-walnut-medium-splayed-legs'];
const COLD_CHAIRS = ['chair-white-windsor-spindle', 'chair-white-bistro-round-seat', 'chair-dining-grey-scandi-b', 'chair-white-slat-back-stackable'];

beforeAll(() => {
  registerServerLibrary(
    ROLES.flatMap((role) => pool(role)).map((id) => {
      const u = real(id)?.useMm ?? [1000, 1000, 1000];
      return { id, widthMm: u[0], heightMm: u[1], depthMm: u[2], modelUrl: `https://x.test/${id}.glb` };
    }),
  );
});
afterAll(() => clearServerLibrary());

describe('vòng 14 — bàn ăn ở chỗ vuông nhỏ (ca bàn gỗ đỏ ch-06/ch-10)', () => {
  it('luật cũ chọn óc chó vì vừa cỡ nhất; đánh giá chọn bàn gỗ sáng qua ràng buộc cứng, cause=selector', () => {
    const table = at('t', 'diningTable', 'table-walnut-square-tapered-legs', 0.91, 0.91, 0, 0);
    // Mẫu óc chó vẫn qua ràng buộc cứng (vừa hộp nhất) — trước đây nó là mẫu đương nhiệm được giữ vì "không hơn rõ".
    expect(roomSetOf('R', [table], new Map(), ctx).get('t')?.top?.some(([f]) => f === 'table-walnut-square-tapered-legs') ?? true).toBeDefined();
    const sofa = pinnedAt('s', 'sofa', 'sofa-grey-2s-wood-legs-b', 2.24, 0.82, 2.5, 0);
    const d = roomSetOf('R', [sofa, table], new Map(), ctx).get('t');
    expect(d?.cause).toBe('selector');
    expect(WALNUT_TABLES).not.toContain(d?.to);
    expect(woodA(d?.to)).toBeLessThanOrEqual(15);
    expect(d?.cost as number).toBeLessThan((d?.fromCost ?? Infinity) - 1);
  });
});

describe('vòng 14 — ghế cạnh bàn gỗ ấm (ca ghế trắng/xám lạnh cn-03, kc-2t)', () => {
  const chairs = (tableId: string): SetMember[] =>
    [
      [-0.4, -0.7],
      [0.4, -0.7],
      [-0.4, 0.7],
      [0.4, 0.7],
    ].map(([x, y], i) => at(`c${i}`, 'diningChair', 'chair-white-windsor-spindle', 0.48, 0.5, x as number, y as number, { group: tableId } as Partial<SetMember>));

  it('bàn sồi: bốn ghế một mẫu, không phải ghế trắng/xám không gỗ; ghế windsor bị phạt theo gỗ bàn', () => {
    const out = roomSetOf('R', [pinnedAt('T', 'diningTable', 'table-oak-light-tapered-legs', 1.6, 0.9, 0, 0), ...chairs('T')], new Map(), ctx);
    const picks = new Set(['c0', 'c1', 'c2', 'c3'].map((id) => out.get(id)?.to));
    expect(picks.size).toBe(1);
    expect(COLD_CHAIRS).not.toContain([...picks][0]);
    expect(out.get('c0')).toMatchObject({ group: 'T', cause: 'selector' });
    // Bàn trắng/kim loại (không gỗ): luật cặp không áp → ghế windsor rẻ hơn hẳn so với cạnh bàn sồi.
    const white = roomSetOf('R', [pinnedAt('T', 'diningTable', 'table-dining-white-flat', 1.3, 0.85, 0, 0), ...chairs('T')], new Map(), ctx);
    expect((out.get('c0')?.fromCost as number) - (white.get('c0')?.fromCost as number)).toBeGreaterThan(0.3);
  });
});

describe('vòng 14 — một kiểu ghế quanh một bàn (ca f-03), ghế ghim dẫn nhóm', () => {
  // Bàn A (sồi) và bàn B (khung thép) cùng phòng; ghế quanh B có hộp khác cỡ nhau (hộp AI dò).
  const room = (extra: SetMember[] = []): SetMember[] => [
    pinnedAt('A', 'diningTable', 'table-oak-light-tapered-legs', 1.6, 0.9, 0, 0),
    pinnedAt('B', 'diningTable', 'table-oak-black-metal-frame-180', 1.8, 0.9, 5, 0),
    at('a1', 'diningChair', null, 0.48, 0.5, -0.4, -0.7),
    at('a2', 'diningChair', null, 0.48, 0.5, 0.4, -0.7),
    at('a3', 'diningChair', null, 0.48, 0.5, 0, 0.7),
    at('b1', 'diningChair', null, 0.5, 0.52, 4.5, -0.72),
    at('b2', 'diningChair', null, 0.46, 0.55, 5.5, -0.72),
    at('b3', 'diningChair', null, 0.55, 0.5, 4.5, 0.72),
    at('b4', 'diningChair', null, 0.5, 0.5, 5.5, 0.72),
    ...extra,
  ];

  it('mọi ghế quanh cùng một bàn ra một mẫu (ghế gom theo bàn gần nhất)', () => {
    const out = roomSetOf('R', room(), new Map(), ctx);
    expect(new Set(['a1', 'a2', 'a3'].map((id) => out.get(id)?.to)).size).toBe(1);
    expect(new Set(['b1', 'b2', 'b3', 'b4'].map((id) => out.get(id)?.to)).size).toBe(1);
    expect(['a1', 'b1'].map((id) => out.get(id)?.group)).toEqual(['A', 'B']);
  });

  it('người dùng chọn mẫu cho một ghế của bàn B: ghế còn lại của B theo mẫu ấy; ghế bàn A không bị ép', () => {
    const own = roomSetOf('R', room(), new Map(), ctx).get('a1')?.to;
    const chosen = 'chair-dining-wishbone-white';
    const out = roomSetOf('R', room([pinnedAt('b5', 'diningChair', chosen, 0.57, 0.58, 6.2, 0)]), new Map(), ctx);
    for (const id of ['b1', 'b2', 'b3', 'b4']) expect(out.get(id)).toMatchObject({ to: chosen, why: expect.stringContaining('món ghim') });
    expect(out.get('a1')?.to).toBe(own);
  });

  it(`mẫu chung chỉ dùng khi không đắt hơn mẫu tốt nhất của chính món quá SHARE_BAND (${SHARE_BAND}): hộp dò lỗi không kéo cả bộ theo`, () => {
    // Một "ghế" dò thành dải 1,16 × 0,29 m: không mẫu ghế nào qua ràng buộc cứng (méo dáng/sai tỉ lệ) → luật cũ riêng nó.
    const out = roomSetOf('R', room([at('bad', 'diningChair', 'chair-dining-grey-shell-black-b', 1.16, 0.29, 5, -1.1)]), new Map(), ctx);
    expect(out.get('bad')).toMatchObject({ cause: 'fallback', to: 'chair-dining-grey-shell-black-b' });
    for (const id of ['b1', 'b2', 'b3', 'b4']) expect(out.get(id)?.cost as number).toBeLessThan(0.6);
  });
});

describe('vòng 14 — hoà trong nhiễu (≤ ANCHOR_BAND) rút theo băm khoá nội dung ở MỌI vai (ca tab đầu giường 17/17 một mẫu)', () => {
  // Tab đầu giường (không phải neo) cạnh giường ghim: nhiều mẫu chi phí màu 0, chênh chỉ từ phạt tỉ lệ.
  const room = (key: string): Map<string, ReturnType<typeof roomSetOf> extends Map<string, infer D> ? D : never> =>
    roomSetOf(
      key,
      [pinnedAt('B', 'doubleBed', 'bed-double-oak-pro', 1.8, 2.1, 0, 0), at('n1', 'nightstand', null, 0.45, 0.4, -1.2, 0.8, { kind: 'table' }), at('n2', 'nightstand', null, 0.45, 0.4, 1.2, 0.8, { kind: 'table' })],
      new Map(),
      ctx,
    );
  const keys = Array.from({ length: 12 }, (_, i) => `bedroom|${i}`);
  beforeAll(() => {
    registerServerLibrary(
      ['nightstand', 'doubleBed'].flatMap((role) => pool(role)).map((id) => {
        const u = real(id)?.useMm ?? [1000, 1000, 1000];
        return { id, widthMm: u[0], heightMm: u[1], depthMm: u[2], modelUrl: `https://x.test/${id}.glb` };
      }),
    );
  });

  it('cùng phòng chạy hai lần → cùng mẫu; hai tab trong phòng một mẫu', () => {
    for (const key of keys) {
      const a = room(key);
      expect(room(key).get('n1')?.to).toBe(a.get('n1')?.to);
      expect(a.get('n2')?.to).toBe(a.get('n1')?.to);
    }
  });

  it('nhiều phòng có ≥ 2 mẫu hoà → không phải mọi phòng cùng mẫu tên nhỏ nhất; mẫu rút luôn trong dải', () => {
    const picks = keys.map((key) => room(key).get('n1'));
    const top = picks[0]?.top ?? [];
    expect(top.filter(([, c]) => c <= (top[0]?.[1] ?? 0) + ANCHOR_BAND).length).toBeGreaterThanOrEqual(2);
    expect(new Set(picks.map((d) => d?.to)).size).toBeGreaterThan(1);
    for (const d of picks) expect(d?.cost as number).toBeLessThanOrEqual((d?.top?.[0]?.[1] ?? 0) + ANCHOR_BAND + 1e-3);
  });

  it('chênh > ANCHOR_BAND → mẫu tốt nhất luôn thắng ở mọi khoá phòng', () => {
    // Bàn óc chó ở chỗ vuông nhỏ, phòng sáng: mẫu sồi tốt nhất hơn hẳn → không phụ thuộc khoá.
    const best = new Set(keys.map((key) => roomSetOf(key, [at('t', 'diningTable', null, 0.91, 0.91, 0, 0, { pool: ['table-dining-oak-pedestal-a192', 'table-walnut-square-tapered-legs'] })], new Map(), ctx).get('t')?.to));
    expect([...best]).toEqual(['table-dining-oak-pedestal-a192']);
  });
});

describe('vòng 14 lượt 2 — ngưỡng hỏng FAIL_COST (ca thua rõ f-22/f-14: giường phòng nhỏ)', () => {
  beforeAll(() => {
    registerServerLibrary(
      [...pool('doubleBed'), ...pool('diningChair')].map((id) => {
        const u = real(id)?.useMm ?? [1000, 1000, 1000];
        return { id, widthMm: u[0], heightMm: u[1], depthMm: u[2], modelUrl: `https://x.test/${id}.glb` };
      }),
    );
  });

  it('dữ liệu thật f-22: hộp giường AI 2,08 × 2,91 m — mọi ứng viên > FAIL_COST, mẫu luật cũ chỉ trượt HÌNH DÁNG (qua va chạm, texture, trần) → giữ hiện trạng (fail-keep)', () => {
    const legacy = 'bed-double-white-duvet-light-oak-headboard';
    const m = at('b', 'doubleBed', legacy, 2.081, 2.905, 0, 0, { kind: 'bed' });
    expect(['sai tỉ lệ thật', 'méo dáng']).toContain(hardRejectOf(m, legacy, ctx));
    const d = roomSetOf('R', [m], new Map(), ctx).get('b');
    expect(d?.top?.[0]?.[1] as number).toBeGreaterThan(FAIL_COST);
    expect(d).toMatchObject({ to: legacy, cause: 'fail-keep' });
    expect(d?.why).toContain('hiện trạng, trượt hình dáng');
  });

  it('hiện trạng trượt hình dáng nhưng chồng vật cản / chạm trần → KHÔNG giữ, lấy ứng viên hợp lệ', () => {
    const c: SetContext = { ...ctxT('bookshelf', { slim: 100, old: 5 }), dimsOf: (x) => (x === 'old' ? [2, 1.8, 0.4] : [0.8, 1.8, 0.4]) };
    // Mẫu luật cũ 2,0 m co vào hộp 1,2 m (sai tỉ lệ thật) và hiện đủ 1,2 m → chồng tủ lạnh; ứng viên hẹp đắt 1,0.
    const m: SetMember = { id: 's', role: 'bookshelf', short: 0.4, long: 1.2, current: 'old', pool: ['old', 'slim'], fixed: false, box: { cx: 0, cy: 0, w: 1.2, d: 0.4, rot: 0 }, shownOf: (x) => (x === 'old' ? [1.2, 1.8, 0.24] : [0.8, 1.8, 0.4]) };
    expect(hardRejectOf(m, 'old', c)).toBe('sai tỉ lệ thật');
    const fridge = planRectOf(0.775, 0, 0.65, 0.6, 0);
    expect(roomSetOf('R', [m], new Map(), c, [fridge]).get('s')).toMatchObject({ to: 'slim', cause: 'selector' });
    // Không vật cản: cùng hiện trạng được giữ.
    expect(roomSetOf('R', [m], new Map(), c).get('s')).toMatchObject({ to: 'old', cause: 'fail-keep' });
    // Chạm trần (mẫu luật cũ cao 2,2 m, trần 2,4 m → tối đa 2,1 m; ứng viên hẹp 1,8 m qua): không giữ.
    const tall: SetContext = { ...c, dimsOf: (x) => (x === 'old' ? [2, 2.2, 0.4] : [0.8, 1.8, 0.4]) };
    const mt: SetMember = { ...m, ceilingM: 2.4, heightM: 2.2, shownOf: (x) => (x === 'old' ? [1.2, 2.2, 0.24] : [0.8, 1.8, 0.4]) };
    expect(roomSetOf('R', [mt], new Map(), tall).get('s')).toMatchObject({ to: 'slim', cause: 'selector' });
  });

  it('cùng luật mọi vai: ứng viên tốt nhất ≤ FAIL_COST thì vẫn đổi (hộp giường thường 1,8 × 2,1 m)', () => {
    const d = roomSetOf('R', [at('b', 'doubleBed', 'bed-double-white-duvet-light-oak-headboard', 1.8, 2.1, 0, 0, { kind: 'bed' })], new Map(), ctx).get('b');
    expect(d?.cause).not.toBe('fail-keep');
    expect(d?.cost as number).toBeLessThanOrEqual(FAIL_COST);
  });

  // Chi phí điều khiển bằng hạng phong cách (tier/100), phần gỗ trùng gỗ tham chiếu (phạt màu 0).
  const qd = (role: string): ModelQuality => ({ role, useMm: [1, 1, 1], front: { axis: '+z', check: 'ok' }, parts: [{ kind: 'frame', share: 1, lab: [67, 5, 22], material: 'wood', kindBy: 'm' }], detail: { tris: 1, kb: 1, textures: 0, maxTex: 0, tier: 'light' }, licence: 'CC0', source: 't' });
  const ctxT = (role: string, tiers: Record<string, number>, dims: Dims = [1, 0.8, 1]): SetContext => ({
    tierOf: (x) => tiers[x] ?? 0,
    tiers: 99,
    dimsOf: () => dims,
    palette: { light: true, tone: 'l' },
    qualityOf: (x) => (x in tiers ? qd(role) : undefined),
  });
  /** Cỡ hiển thị: co đều mẫu 1 × 1 m vào hộp vuông cạnh `s`. */
  const sq = (id: string, s: number, cx: number, current: string | null, pool: string[], extra: Partial<SetMember> = {}): SetMember => ({
    id, role: 'dresser', short: s, long: s, current, pool, fixed: false, box: { cx, cy: 0, w: s, d: s, rot: 0 },
    shownOf: () => [s, 0.8, s], ...extra,
  });

  it('thuần: mẫu luật cũ HỢP LỆ, mẫu tốt nhất > FAIL_COST → giữ mẫu luật cũ (fail-keep); có ứng viên rẻ → đổi', () => {
    const c = ctxT('dresser', { dark: 100, legacy: 110, oak: 0 });
    const m = (p: string[]): SetMember => sq('d', 1, 0, 'legacy', p);
    expect(roomSetOf('R', [m(['dark', 'legacy'])], new Map(), c).get('d')).toMatchObject({ to: 'legacy', cause: 'fail-keep' });
    expect(roomSetOf('R', [m(['dark', 'legacy', 'oak'])], new Map(), c).get('d')).toMatchObject({ to: 'oak', cause: 'selector' });
  });

  it('chi phí > FAIL_COST + va chạm: mẫu luật cũ chồng tủ lạnh (loại "va chạm") → KHÔNG khôi phục nó, giữ ứng viên hợp lệ đắt', () => {
    const c: SetContext = { ...ctxT('bookshelf', { wide: 5, slim: 100 }), dimsOf: (x) => (x === 'wide' ? [1.2, 1.8, 0.4] : [0.8, 1.8, 0.4]) };
    const m: SetMember = { id: 's', role: 'bookshelf', short: 0.4, long: 1.2, current: 'wide', pool: ['wide', 'slim'], fixed: false, box: { cx: 0, cy: 0, w: 1.2, d: 0.4, rot: 0 }, shownOf: (x) => (x === 'wide' ? [1.2, 1.8, 0.4] : [0.8, 1.8, 0.4]) };
    const d = roomSetOf('R', [m], new Map(), c, [planRectOf(0.775, 0, 0.65, 0.6, 0)]).get('s');
    expect(d?.rejects?.['va chạm']).toBe(1);
    expect(d).toMatchObject({ to: 'slim', cause: 'selector' });
    expect(d?.cost as number).toBeGreaterThan(FAIL_COST);
    expect(d?.why).toContain('không hợp lệ');
  });

  it('ngưỡng theo NHÓM, lưng chừng: mẫu chung trung bình ≤ 0,9 dù một món riêng > 0,9 → cả nhóm cùng mẫu chung', () => {
    // S hạng 81: món A (hộp vừa) 0,81; món B (co 0,85, phạt ≈ 0,16) 0,97; trung bình 0,89. L hạng 99 (luật cũ, hợp lệ).
    const c = ctxT('dresser', { S: 81, L: 99 });
    const out = roomSetOf('R', [sq('a', 1, 0, 'L', ['S', 'L']), sq('b', 0.85, 3, 'L', ['S', 'L'])], new Map(), c);
    expect((out.get('b')?.cost as number) > FAIL_COST).toBe(true);
    expect([out.get('a')?.to, out.get('b')?.to]).toEqual(['S', 'S']);
  });

  it('Codex SEL-5: dải hoà lưng chừng ngưỡng (S1 0,88, S2 0,93, chênh < ANCHOR_BAND) → mọi khoá băm ra S1, không fail-keep', () => {
    const c = ctxT('dresser', { S1: 88, S2: 93, L: 99 });
    const keys = Array.from({ length: 16 }, (_, i) => `R${i}`);
    for (const key of keys) {
      const out = roomSetOf(key, [sq('a', 1, 0, 'L', ['S1', 'S2', 'L']), sq('b', 1, 3, 'L', ['S1', 'S2', 'L'])], new Map(), c);
      expect([out.get('a')?.to, out.get('b')?.to, out.get('a')?.cause]).toEqual(['S1', 'S1', 'selector']);
    }
    // Cùng dải nhưng cả hai trên ngưỡng (S1 0,92, S2 0,97): băm vẫn rút trong dải, rồi cả nhóm fail-keep.
    const hi = ctxT('dresser', { S1: 92, S2: 97, L: 99 });
    for (const key of keys) expect(roomSetOf(key, [sq('a', 1, 0, 'L', ['S1', 'S2', 'L'])], new Map(), hi).get('a')).toMatchObject({ to: 'L', cause: 'fail-keep' });
  });

  it('ngưỡng theo NHÓM: mẫu chung trung bình > 0,9 → cả nhóm giữ mẫu luật cũ (không lệch nhau); có món ghim trong nhóm → mẫu ghim dẫn cả nhóm', () => {
    const c = ctxT('dresser', { S: 86, L: 99 });
    const two = [sq('a', 1, 0, 'L', ['S', 'L']), sq('b', 0.85, 3, 'L', ['S', 'L'])];
    const out = roomSetOf('R', two, new Map(), c);
    expect([out.get('a'), out.get('b')].map((d) => [d?.to, d?.cause])).toEqual([['L', 'fail-keep'], ['L', 'fail-keep']]);
    const withPin = roomSetOf('R', [...two, sq('p', 1, 6, 'S', [], { fixed: true })], new Map(), c);
    expect([withPin.get('a')?.to, withPin.get('b')?.to]).toEqual(['S', 'S']);
  });
});

describe('Codex SEL-4 #2 — luật cũ (mọi đường tự chọn) không trả mẫu vân vỡ', () => {
  const BROKEN = 'bed-double-linen-pro2';
  const style0: LayerStyle = { ...am, roomSet: false, layout: new Set(), rulesOff: new Set() };
  const bed = { id: 'F-B', levelId: 'L-1', roomId: 'R-T', kind: 'bed', centre: { x: 0, y: 0 }, boundingBox: { min: { x: -900, y: -1050 }, max: { x: 900, y: 1050 } }, rotationDeg: 0, source: 'ai', reviewed: true, confidence: 1 } as unknown as Furniture;
  const reg = (ids: string[]): void => {
    clearServerLibrary();
    registerServerLibrary(ids.map((id) => ({ id, widthMm: 1800, heightMm: 1000, depthMm: 2100, modelUrl: `https://x.test/${id}.glb` })));
  };
  afterAll(() => {
    clearServerLibrary();
    registerServerLibrary(ROLES.flatMap((role) => pool(role)).map((id) => {
      const u = real(id)?.useMm ?? [1000, 1000, 1000];
      return { id, widthMm: u[0], heightMm: u[1], depthMm: u[2], modelUrl: `https://x.test/${id}.glb` };
    }));
  });

  it('tiền đề: dữ liệu chất lượng ghi mẫu này là vân vỡ', () => {
    expect(real(BROKEN)?.texture?.v).toBe('broken');
  });

  it('pool vai chỉ còn mẫu vân vỡ → mẫu dựng sẵn, không phải mẫu vỡ', () => {
    reg([BROKEN]);
    expect(modelFolderOf(bed, style0, 'bedroom')).not.toBe(BROKEN);
  });

  it('mẫu concept (style.prefer) là mẫu vân vỡ → không trả nó', () => {
    reg([BROKEN, 'bed-double-oak-pro']);
    const pref: LayerStyle = { ...style0, prefer: { ...style0.prefer, doubleBed: [BROKEN] } };
    expect(modelFolderOf(bed, pref, 'bedroom')).not.toBe(BROKEN);
  });
});

describe('vòng 14 lượt 2 — cờ texture "broken" (vân vỡ) loại khỏi bể ứng viên mọi vai; "unsure" không ảnh hưởng', () => {
  const q = (texture?: 'broken' | 'unsure'): ModelQuality =>
    ({ role: 'sofa', useMm: [1, 1, 1], front: { axis: '+z', check: 'ok' }, parts: [{ kind: 'upholstery', share: 1, lab: [70, 1, 4], material: 'fabric', kindBy: 'm' }], detail: { tris: 1, kb: 1, textures: 0, maxTex: 0, tier: 'light' }, licence: 'CC0', source: 't', ...(texture === undefined ? {} : { texture: { v: texture, by: 'i' } }) }) as ModelQuality;
  const table: Record<string, ModelQuality> = { broken: q('broken'), unsure: q('unsure'), ok: q() };
  const c: SetContext = { tierOf: () => 0, tiers: 3, dimsOf: () => [2, 0.8, 0.9], palette: { light: true, tone: 'l' }, qualityOf: (x) => table[x] };
  const m: SetMember = { id: 's', role: 'sofa', short: 0.9, long: 2, current: null, pool: ['broken', 'unsure', 'ok'], fixed: false };

  it('broken → "vân vỡ"; unsure và ok đạt, cùng chi phí (không hạ ưu tiên)', () => {
    expect(hardRejectOf(m, 'broken', c)).toBe('vân vỡ');
    expect(hardRejectOf(m, 'unsure', c)).toBeUndefined();
    const d = roomSetOf('R', [m], new Map(), c).get('s');
    expect(d?.rejects?.['vân vỡ']).toBe(1);
    expect(d?.top?.map(([f, cost]) => [f, cost])).toEqual([['ok', 0], ['unsure', 0]]);
  });
});

/* ---- Chính sách món đã xác nhận chưa gán mẫu (DESIGN §2.6, phương án B) qua đường dựng thật của sceneVariety ---- */

describe('vòng 14 — món đã xác nhận chưa gán mẫu: cùng đánh giá, đổi theo catalog; món ghim không đổi', () => {
  const ROOM = 'R-POLICY';
  const usage = (): RoomUsage => 'livingRoom';
  const furniture = (id: string, kind: Furniture['kind'], w: number, d: number, x: number, y: number, extra: Partial<Furniture> = {}): Furniture =>
    ({
      id,
      levelId: 'L-1',
      roomId: ROOM,
      kind,
      centre: { x, y },
      boundingBox: { min: { x: x - w / 2, y: y - d / 2 }, max: { x: x + w / 2, y: y + d / 2 } },
      rotationDeg: 0,
      source: 'ai',
      reviewed: true,
      confidence: 1,
      ...extra,
    }) as Furniture;
  const table = furniture('F-TABLE', 'table', 1600, 900, 0, 0, { model: { id: 't', src: '/items/table-oak-light-tapered-legs/model.glb' } });
  const chair = furniture('F-CHAIR', 'chair', 480, 500, 0, -700);
  const style: LayerStyle = { ...am, roomSet: true, layout: new Set(), rulesOff: new Set(), woodTone: 'l' };
  const register = (chairs: readonly string[]): void => {
    clearServerLibrary();
    registerServerLibrary(
      [...chairs, 'table-oak-light-tapered-legs'].map((id) => {
        const u = real(id)?.useMm ?? [1000, 1000, 1000];
        return { id, widthMm: u[0], heightMm: u[1], depthMm: u[2], modelUrl: `https://x.test/${id}.glb` };
      }),
    );
  };
  const pick = (items: readonly Furniture[], id: string): string | null => {
    setRoomSetKeys(new Map(), new Map([[ROOM, CEIL]]));
    contextRolesOf(items, usage);
    return modelFolderOf(items.find((f) => f.id === id) as Furniture, style, 'livingRoom');
  };
  afterAll(() => {
    clearServerLibrary();
    registerServerLibrary(
      ROLES.flatMap((role) => pool(role)).map((id) => {
        const u = real(id)?.useMm ?? [1000, 1000, 1000];
        return { id, widthMm: u[0], heightMm: u[1], depthMm: u[2], modelUrl: `https://x.test/${id}.glb` };
      }),
    );
  });

  it('catalog thêm mẫu tốt hơn → món đã xác nhận đổi sang nó (by=user); món có `model` giữ nguyên; hộp không đổi', () => {
    const cold = ['chair-white-windsor-spindle', 'chair-dining-grey-scandi-b'];
    register(cold);
    const before = pick([table, chair], 'F-CHAIR');
    expect(cold).toContain(before);
    register([...cold, 'chair-dining-oak-rope-arm-b']);
    const after = pick([table, chair], 'F-CHAIR');
    expect(after).toBe('chair-dining-oak-rope-arm-b');
    expect(roomSetReport()[ROOM]?.items.find((d) => d.id === 'F-CHAIR')).toMatchObject({ by: 'user', cause: 'selector', group: 'F-TABLE' });
    expect(roomSetReport()[ROOM]?.items.find((d) => d.id === 'F-TABLE')).toMatchObject({ cause: 'pinned' });
    expect(chair.boundingBox).toEqual({ min: { x: -240, y: -950 }, max: { x: 240, y: -450 } });
    // Người dùng ghim mẫu cũ (đổi mẫu = ghi `model`) → không đổi dù catalog có mẫu tốt hơn; ghế chưa ghim cùng bàn theo nó.
    const pinned = { ...chair, model: { id: 'c', src: `/items/${before as string}/model.glb` } } as Furniture;
    const other = furniture('F-CHAIR2', 'chair', 480, 500, 0, 700);
    expect(pick([table, pinned, other], 'F-CHAIR2')).toBe(before);
    expect(roomSetReport()[ROOM]?.items.find((d) => d.id === 'F-CHAIR')).toMatchObject({ cause: 'pinned', to: before });
    expect([...(roomSetPools().diningChair ?? [])].sort()).toEqual([...cold, 'chair-dining-oak-rope-arm-b'].sort());
  });

  it('twin của cặp đã nhận ghim vào mẫu đã lưu của món thật, không chấm như đồ sinh', () => {
    register(['chair-white-windsor-spindle', 'chair-dining-oak-rope-arm-b']);
    const twin = furniture('DRESS-chair-R-POLICY-1', 'chair', 480, 500, 0, 700, { reviewed: false });
    const real = furniture('F-REAL', 'chair', 480, 500, 0, 700, { model: { id: 'r', src: '/items/chair-white-windsor-spindle/model.glb' } });
    setRoomSetKeys(new Map(), new Map([[ROOM, CEIL]]));
    contextRolesOf([table], usage);
    addRoomSetMembers([twin], usage, (f) => (f.id === twin.id ? real : undefined));
    expect(modelFolderOf(twin, style, 'livingRoom')).toBe('chair-white-windsor-spindle');
    // Món sinh bình thường (không twin) cùng chỗ: đánh giá chọn ghế gỗ.
    contextRolesOf([table], usage);
    addRoomSetMembers([twin], usage);
    expect(modelFolderOf(twin, style, 'livingRoom')).toBe('chair-dining-oak-rope-arm-b');
  });
});

/* ---- Codex review SEL-1 (vòng 14): năm điểm đúng/sai, mỗi điểm một test tái hiện ---- */

describe('Codex SEL-1', () => {
  const ROOM = 'R-SEL1';
  const usage = (): RoomUsage => 'livingRoom';
  const furniture = (id: string, kind: Furniture['kind'], w: number, d: number, x: number, y: number, extra: Partial<Furniture> = {}): Furniture =>
    ({
      id,
      levelId: 'L-1',
      roomId: ROOM,
      kind,
      centre: { x, y },
      boundingBox: { min: { x: x - w / 2, y: y - d / 2 }, max: { x: x + w / 2, y: y + d / 2 } },
      rotationDeg: 0,
      source: 'ai',
      reviewed: true,
      confidence: 1,
      ...extra,
    }) as Furniture;
  const style: LayerStyle = { ...am, roomSet: true, layout: new Set(), rulesOff: new Set(), woodTone: 'l' };

  it('#1 món ghim mẫu ngoài thư viện (current null) vẫn giữ chỗ bằng cả hộp: món bên cạnh không chọn mẫu phình vào nó', () => {
    const q = (lab: [number, number, number]): ModelQuality => ({ role: 'bookshelf', useMm: [1, 1, 1], front: { axis: '+z', check: 'ok' }, parts: [{ kind: 'frame', share: 1, lab, material: 'wood', kindBy: 'm' }], detail: { tris: 1, kb: 1, textures: 0, maxTex: 0, tier: 'light' }, licence: 'CC0', source: 't' });
    const table: Record<string, ModelQuality> = { slim: q([50, 6, 20]), wide: q([75, 4, 15]) };
    const dims: Record<string, Dims> = { slim: [0.8, 1.8, 0.4], wide: [1.2, 1.8, 0.4] };
    const c: SetContext = { tierOf: () => 0, tiers: 3, dimsOf: (x) => dims[x], palette: { light: true, tone: 'l' }, qualityOf: (x) => table[x] };
    const shownOf = (x: string): Dims | undefined => {
      const m = dims[x];
      return m === undefined ? undefined : [Math.min(m[0], 1.2), m[1], Math.min(m[2], 0.4)];
    };
    const m: SetMember = { id: 's', role: 'bookshelf', kind: 'other', short: 0.4, long: 1.2, current: null, pool: ['wide', 'slim'], fixed: false, box: { cx: 0, cy: 0, w: 1.2, d: 0.4, rot: 0 }, shownOf };
    const custom: SetMember = { id: 'p', role: 'closet', kind: 'wardrobe', short: 0.6, long: 0.65, current: null, pool: [], fixed: true, box: { cx: 0.775, cy: 0, w: 0.65, d: 0.6, rot: 0 } };
    expect(roomSetOf('R', [m], new Map(), c).get('s')?.to).toBe('wide');
    expect(roomSetOf('R', [m, custom], new Map(), c).get('s')?.to).toBe('slim');
  });

  it('#2 cặp đã nhận mà người dùng đổi mẫu: một đại diện (món thật), twin là bí danh — không đếm hai lần', () => {
    const real = furniture('F-REAL', 'chair', 480, 500, 0, 700, { model: { id: 'r', src: '/items/chair-white-windsor-spindle/model.glb' } });
    const twin = furniture('DRESS-chair-R-SEL1-1', 'chair', 480, 500, 0, 700, { reviewed: false });
    const other = furniture('F-OTHER', 'chair', 480, 500, 900, 700);
    setRoomSetKeys(new Map(), new Map([[ROOM, CEIL]]));
    contextRolesOf([real, other], usage);
    addRoomSetMembers([twin], usage, (f) => (f.id === twin.id ? real : undefined));
    expect(modelFolderOf(twin, style, 'livingRoom')).toBe('chair-white-windsor-spindle');
    modelFolderOf(other, style, 'livingRoom');
    const ids = (roomSetReport()[ROOM]?.items ?? []).map((d) => d.id).sort();
    expect(ids).toEqual(['F-OTHER', 'F-REAL']);
  });

  it('#3 hở trần tính cả độ nâng: kệ cao 1 m nâng 2 m dưới trần 2,7 m bị loại', () => {
    const m: SetMember = { id: 'k', role: 'bookshelf', short: 0.35, long: 0.8, current: null, pool: ['shelf-oak-white-cube-a160'], fixed: false, ceilingM: 2.7, lifted: true, liftM: 2 };
    const c: SetContext = { ...ctx, dimsOf: () => [0.8, 1.0, 0.35] };
    expect(hardRejectOf(m, 'shelf-oak-white-cube-a160', c)).toBe('chạm gần trần');
    expect(hardRejectOf({ ...m, liftM: 0 }, 'shelf-oak-white-cube-a160', c)).toBeUndefined();
  });

  it('#4 đổi id, giữ nội dung (chép dự án) → cùng mẫu cho từng chỗ', () => {
    const build = (ids: readonly string[]): Map<string, string | null> => {
      const [t, a, b, c2, d] = ids as [string, string, string, string, string];
      const ms = [
        pinnedAt(t, 'diningTable', 'table-oak-light-tapered-legs', 1.6, 0.9, 0, 0),
        at(a, 'diningChair', null, 0.48, 0.5, -0.4, -0.7),
        at(b, 'diningChair', null, 0.5, 0.52, 0.4, -0.7),
        at(c2, 'diningChair', null, 0.46, 0.55, -0.4, 0.7),
        at(d, 'diningChair', null, 0.52, 0.5, 0.4, 0.7),
      ];
      const out = roomSetOf('kitchen|1', ms, new Map(), ctx);
      return new Map(ms.map((m, i) => [`slot${i}`, out.get(m.id)?.to ?? null]));
    };
    const a = build(['T', 'c1', 'c2', 'c3', 'c4']);
    expect(build(['zz-T', 'aa-9', 'mm-1', 'bb-7', 'xx-0'])).toEqual(a);
    expect(build(['F-9', 'F-1', 'F-8', 'F-2', 'F-7'])).toEqual(a);
  });

  it('#5 / SEL-2 #3 phòng chỉ có món ghim: sổ đủ mục (neo, nhóm, by, pool) sau finishRoomSet, không cần tra mẫu; roomset tắt → không ghi', () => {
    const table = furniture('F-PTAB', 'table', 1600, 900, 0, 0, { model: { id: 't', src: '/items/table-oak-light-tapered-legs/model.glb' } });
    const pinned = furniture('F-PIN', 'chair', 480, 500, 0, -700, { model: { id: 'p', src: '/items/chair-white-windsor-spindle/model.glb' } });
    setRoomSetKeys(new Map(), new Map([[ROOM, CEIL]]));
    contextRolesOf([table, pinned], usage);
    finishRoomSet(style);
    const report = roomSetReport()[ROOM];
    expect(report?.anchor).toBe('F-PTAB');
    expect(report?.items.find((d) => d.id === 'F-PIN')).toMatchObject({ cause: 'pinned', to: 'chair-white-windsor-spindle', by: 'user', pool: 0, group: 'F-PTAB' });
    contextRolesOf([table, pinned], usage);
    const off: LayerStyle = { ...style, roomSet: false };
    finishRoomSet(off);
    expect(roomSetReport()).toEqual({});
  });

  it('SEL-2 #1 đại diện cặp đã nhận mang hình học THẬT (người dùng dời + nới bàn): ghế cạnh chỗ thật gom vào bàn ấy', () => {
    const chair = furniture('F-NEARC', 'chair', 480, 500, 3000, -700);
    // Twin (chỗ sinh cũ) ở x = 0; món thật người dùng dời sang x = 3 m và nới 1,6 → 2,0 m.
    const twin = furniture('DRESS-diningTable-R-SEL1-1', 'table', 1600, 900, 0, 0, { reviewed: false });
    const real = furniture('F-REALT', 'table', 2000, 900, 3000, 0, { model: { id: 'r', src: '/items/table-oak-light-tapered-legs/model.glb' } });
    const run = (rep: Furniture): string | undefined => {
      setRoomSetKeys(new Map(), new Map([[ROOM, CEIL]]));
      contextRolesOf([chair], usage);
      addRoomSetMembers([twin], usage, (f) => (f.id === twin.id ? rep : undefined));
      modelFolderOf(chair, style, 'livingRoom');
      return roomSetReport()[ROOM]?.items.find((d) => d.id === 'F-NEARC')?.group;
    };
    expect(run(real)).toBe(twin.id);
    // Hình học cũ của twin (bàn ở x = 0): ghế ở x = 3 m không thuộc bàn nào.
    expect(run({ ...real, boundingBox: twin.boundingBox, centre: twin.centre })).toBeUndefined();
    expect(roomSetReport()[ROOM]?.items.find((d) => d.id === twin.id)).toMatchObject({ cause: 'pinned', to: 'table-oak-light-tapered-legs' });
  });

  it('SEL-2 #2 hai kệ ghim chồng đúng chỗ, khác mẫu: đổi id cho nhau không đổi kết quả của kệ thứ ba', () => {
    const q = (lab: [number, number, number]): ModelQuality => ({ role: 'bookshelf', useMm: [1, 1, 1], front: { axis: '+z', check: 'ok' }, parts: [{ kind: 'frame', share: 1, lab, material: 'wood', kindBy: 'm' }], detail: { tris: 1, kb: 1, textures: 0, maxTex: 0, tier: 'light' }, licence: 'CC0', source: 't' });
    const table: Record<string, ModelQuality> = { a: q([60, 8, 24]), b: q([40, 8, 24]) };
    const c: SetContext = { tierOf: () => 0, tiers: 3, dimsOf: () => [0.8, 1.8, 0.4], palette: { light: true, tone: 'l' }, qualityOf: (x) => table[x] };
    const shelf = (id: string, current: string | null, fixed: boolean, x: number): SetMember => ({ id, role: 'bookshelf', short: 0.4, long: 0.8, current, pool: fixed ? [] : ['a', 'b'], fixed, box: { cx: x, cy: 0, w: 0.8, d: 0.4, rot: 0 } });
    const run = (idA: string, idB: string): string | null | undefined =>
      roomSetOf('R', [shelf(idA, 'a', true, 0), shelf(idB, 'b', true, 0), shelf('third', null, false, 3)], new Map(), c).get('third')?.to;
    expect(run('p1', 'p2')).toBe(run('p2', 'p1'));
  });
});

/* ---- Vòng 16: mẫu concept AI không còn là ghim — ứng viên ưu tiên, chỉ chọn khi qua mọi ràng buộc cứng của món ---- */

describe('vòng 16 — mẫu concept là ứng viên ưu tiên, không phải ghim', () => {
  const table = (extra: Partial<SetMember> = {}): SetMember => at('t', 'diningTable', null, 1.6, 0.9, 0, 0, extra);

  it('concept qua mọi ràng buộc cứng → chọn concept (cause concept), không so chi phí', () => {
    const base = roomSetOf('R', [table()], new Map(), ctx).get('t');
    const concept = base?.top?.find(([f]) => f !== base.to)?.[0] as string;
    expect(concept).toBeDefined();
    const d = roomSetOf('R', [table({ concept: { folder: concept } })], new Map(), ctx).get('t');
    expect(d).toMatchObject({ to: concept, cause: 'concept', why: expect.stringContaining('concept') });
  });

  it('concept méo / không vừa hộp → bộ chọn chọn mẫu khác như không có concept, không kéo giãn concept', () => {
    const m = table();
    const bad = m.pool.find((f) => ['méo dáng', 'sai tỉ lệ thật', 'vượt hộp chỗ đặt'].includes(hardRejectOf(m, f, ctx) ?? '')) as string;
    expect(bad).toBeDefined();
    const base = roomSetOf('R', [m], new Map(), ctx).get('t');
    const d = roomSetOf('R', [table({ concept: { folder: bad } })], new Map(), ctx).get('t');
    expect(d?.to).toBe(base?.to);
    expect(d?.to).not.toBe(bad);
    expect(d?.cause).not.toBe('concept');
    expect(d?.why).toContain(`concept trượt: ${hardRejectOf(m, bad, ctx) ?? ''}`);
  });

  it('Codex M16-1 #2: pool không còn ứng viên lọt → ngân sách va chạm 0, concept chồng vật cản trượt', () => {
    const base = roomSetOf('R', [table()], new Map(), ctx).get('t');
    const concept = base?.to as string;
    const zone = [planRectOf(0, 0, 0.5, 0.5, 0)];
    const free = roomSetOf('R', [table({ pool: [], concept: { folder: concept } })], new Map(), ctx).get('t');
    expect(free).toMatchObject({ cause: 'concept', to: concept });
    const blocked = roomSetOf('R', [table({ pool: [], concept: { folder: concept } })], new Map(), ctx, zone).get('t');
    expect(blocked?.cause).toBe('fallback');
    expect(blocked?.to).not.toBe(concept);
    expect(blocked?.why).toContain('concept trượt: va chạm');
  });

  it('nhóm ghế quanh bàn: concept là mẫu chung khi qua cho MỌI ghế; một ghế trượt → cả nhóm đi đường thường, một mẫu', () => {
    const chairs = (extra: Partial<SetMember> = {}): SetMember[] => [
      pinnedAt('A', 'diningTable', 'table-oak-light-tapered-legs', 1.6, 0.9, 0, 0),
      at('a1', 'diningChair', null, 0.48, 0.5, -0.4, -0.7, extra),
      at('a2', 'diningChair', null, 0.48, 0.5, 0.4, -0.7, extra),
      at('a3', 'diningChair', null, 0.48, 0.5, 0, 0.7, extra),
    ];
    const base = roomSetOf('R', chairs(), new Map(), ctx);
    const concept = base.get('a1')?.top?.find(([f]) => f !== base.get('a1')?.to)?.[0] as string;
    const all = roomSetOf('R', chairs({ concept: { folder: concept } }), new Map(), ctx);
    for (const id of ['a1', 'a2', 'a3']) expect(all.get(id)).toMatchObject({ to: concept, cause: 'concept', group: 'A' });
    // Ghế thứ tư dò thành dải 1,16 × 0,29 m: concept méo ở ghế này → không ghế nào của bàn lấy concept.
    const strip = at('bad', 'diningChair', null, 1.16, 0.29, 0, -1.1, { concept: { folder: concept } });
    const out = roomSetOf('R', [...chairs({ concept: { folder: concept } }), strip], new Map(), ctx);
    expect(out.get('bad')?.why).toContain('concept trượt');
    for (const id of ['a1', 'a2', 'a3']) {
      expect(out.get(id)?.cause).not.toBe('concept');
      expect(out.get(id)?.why).toContain('(ghế bad cùng bàn)');
    }
    expect(new Set(['a1', 'a2', 'a3'].map((id) => out.get(id)?.to)).size).toBe(1);
  });

  describe('qua đường dựng thật (sceneVariety)', () => {
    const ROOM = 'R-CONCEPT';
    const usage = (): RoomUsage => 'livingRoom';
    const furniture = (id: string, kind: Furniture['kind'], w: number, d: number, x: number, y: number, extra: Partial<Furniture> = {}): Furniture =>
      ({
        id,
        levelId: 'L-1',
        roomId: ROOM,
        kind,
        centre: { x, y },
        boundingBox: { min: { x: x - w / 2, y: y - d / 2 }, max: { x: x + w / 2, y: y + d / 2 } },
        rotationDeg: 0,
        source: 'ai',
        reviewed: false,
        confidence: 1,
        ...extra,
      }) as Furniture;
    const CHAIRS = ['chair-white-windsor-spindle', 'chair-dining-grey-scandi-b', 'chair-dining-oak-rope-arm-b'];
    const OTHER_TABLE = 'table-walnut-medium-splayed-legs';
    const userTable = furniture('F-T', 'table', 1600, 900, 0, 0, { model: { id: 't', src: '/items/table-oak-light-tapered-legs/model.glb' } });
    const chair = furniture('F-C', 'chair', 480, 500, 0, -700);
    const strip = furniture('F-S', 'chair', 1160, 290, 3000, 3000);
    const base: LayerStyle = { ...am, roomSet: true, layout: new Set(), rulesOff: new Set(), woodTone: 'l' };
    const withConcept = (chairPick: string): LayerStyle => ({ ...base, prefer: { ...base.prefer, diningChair: [chairPick], diningTable: [OTHER_TABLE] } });
    const pick = (items: readonly Furniture[], id: string, style: LayerStyle): string | null => {
      setRoomSetKeys(new Map(), new Map([[ROOM, CEIL]]));
      contextRolesOf(items, usage);
      return modelFolderOf(items.find((f) => f.id === id) as Furniture, style, 'livingRoom');
    };
    const entry = (id: string) => roomSetReport()[ROOM]?.items.find((d) => d.id === id);
    beforeAll(() => {
      clearServerLibrary();
      registerServerLibrary(
        [...CHAIRS, 'table-oak-light-tapered-legs', OTHER_TABLE].map((id) => {
          const u = real(id)?.useMm ?? [1000, 1000, 1000];
          return { id, widthMm: u[0], heightMm: u[1], depthMm: u[2], modelUrl: `https://x.test/${id}.glb` };
        }),
      );
    });
    afterAll(() => {
      clearServerLibrary();
      registerServerLibrary(
        ROLES.flatMap((role) => pool(role)).map((id) => {
          const u = real(id)?.useMm ?? [1000, 1000, 1000];
          return { id, widthMm: u[0], heightMm: u[1], depthMm: u[2], modelUrl: `https://x.test/${id}.glb` };
        }),
      );
    });

    it('concept hợp lệ → chọn concept; món có `model` người dùng vẫn ghim dù concept vai ấy khác', () => {
      const selected = pick([userTable, chair], 'F-C', base);
      const concept = CHAIRS.find((c) => c !== selected && entry('F-C')?.top?.some(([f]) => f === c)) as string;
      expect(concept).toBeDefined();
      expect(pick([userTable, chair], 'F-C', withConcept(concept))).toBe(concept);
      expect(entry('F-C')).toMatchObject({ cause: 'concept', to: concept });
      // `from` = luật cũ KHÔNG BAO GIỜ là concept (luật thư viện trúng concept → bỏ, Codex M16-1 #1).
      expect(entry('F-C')?.from).not.toBe(concept);
      // Món có `model` dựng bằng mẫu đã lưu (không hỏi modelFolderOf): sổ ghi ghim, mẫu đã lưu, không phải concept bàn.
      expect(entry('F-T')).toMatchObject({ cause: 'pinned', to: 'table-oak-light-tapered-legs' });
    });

    it('concept méo trong hộp → không trả concept, cả qua đường fallback (luật cũ không chứa concept); roomSet tắt → như cũ (concept)', () => {
      const off: LayerStyle = { ...base, roomSet: false };
      const legacy = pick([strip], 'F-S', off);
      const concept = CHAIRS.find((c) => c !== legacy) as string;
      const got = pick([strip], 'F-S', withConcept(concept));
      expect(got).not.toBe(concept);
      expect(entry('F-S')?.why).toContain('concept trượt');
      expect(entry('F-S')?.from).not.toBe(concept);
      expect(pick([strip], 'F-S', { ...withConcept(concept), roomSet: false })).toBe(concept);
    });

    it('Codex M16-1 #1: thư viện chỉ còn đúng mẫu concept, concept méo → luật cũ không trả nó (mẫu dựng sẵn), không fail-keep nó', () => {
      const only = 'chair-white-windsor-spindle';
      clearServerLibrary();
      const u = real(only)?.useMm ?? [1000, 1000, 1000];
      registerServerLibrary([{ id: only, widthMm: u[0], heightMm: u[1], depthMm: u[2], modelUrl: `https://x.test/${only}.glb` }]);
      try {
        const got = pick([strip], 'F-S', withConcept(only));
        expect(got).not.toBe(only);
        expect(entry('F-S')).toMatchObject({ cause: 'fallback', why: expect.stringContaining('concept trượt') });
        expect(entry('F-S')?.from).not.toBe(only);
      } finally {
        clearServerLibrary();
        registerServerLibrary(
          [...CHAIRS, 'table-oak-light-tapered-legs', OTHER_TABLE].map((id) => {
            const v = real(id)?.useMm ?? [1000, 1000, 1000];
            return { id, widthMm: v[0], heightMm: v[1], depthMm: v[2], modelUrl: `https://x.test/${id}.glb` };
          }),
        );
      }
    });

    it('Codex M16-1 #3: concept khác mẫu luật cũ (`from`) → roomSetSwapOf có quyết định (prov.model), cùng mốc với sổ', () => {
      pick([userTable, chair], 'F-C', base);
      const legacy = entry('F-C')?.from;
      const concept = CHAIRS.find((c) => c !== legacy && entry('F-C')?.top?.some(([f]) => f === c)) as string;
      expect(concept).toBeDefined();
      expect(pick([userTable, chair], 'F-C', withConcept(concept))).toBe(concept);
      expect(entry('F-C')).toMatchObject({ cause: 'concept', rule: 'roomset', from: legacy, to: concept });
      expect(roomSetSwapOf('F-C')).toMatchObject({ from: legacy, to: concept });
    });
  });
});
