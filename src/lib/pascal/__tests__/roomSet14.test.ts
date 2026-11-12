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
import { ANCHOR_BAND, paletteOf, roomSetOf, SHARE_BAND, type Dims, type SetContext, type SetMember } from '../roomSet';
import { sceneStyleOf } from '../sceneStyles';
import { addRoomSetMembers, contextRolesOf, modelFolderOf, roomSetPools, roomSetReport, setRoomSetKeys, type LayerStyle } from '../sceneVariety';

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
    setRoomSetKeys(new Map(), new Map([[ROOM, CEIL]]));
    contextRolesOf([table], usage);
    addRoomSetMembers([twin], usage, (f) => (f.id === twin.id ? 'chair-white-windsor-spindle' : undefined));
    expect(modelFolderOf(twin, style, 'livingRoom')).toBe('chair-white-windsor-spindle');
    // Món sinh bình thường (không twin) cùng chỗ: đánh giá chọn ghế gỗ.
    contextRolesOf([table], usage);
    addRoomSetMembers([twin], usage);
    expect(modelFolderOf(twin, style, 'livingRoom')).toBe('chair-dining-oak-rope-arm-b');
  });
});
