/**
 * Bộ nội thất theo phòng (`roomSet.ts` + móc trong `sceneVariety.ts`/`toPascal.ts`, vòng 12 làn S): ràng buộc cứng
 * loại trước (dữ liệu vắng = loại), neo + món phụ hợp gỗ/vải, cặp cùng vai một mẫu, tất định, giữ bộ cũ khi không hơn;
 * cờ tắt = như cũ; không ghi mẫu dẫn xuất vào bản lưu; tải lại cùng kết quả; undo/redo không nhận món dẫn xuất.
 */
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

import { denormalizeSpatial, normalizeSpatial } from '@/domain/spatial/normalize';
import type { Furniture, Point, Room, SpatialGraph, Wall } from '@/domain/spatial/types';
import { createDerivedHistory, recordDerived, restoreDerived, touchedTargetFor } from '@/pascal-page/bridge/derivedHistory';

import { createPascalEditCommand } from '../fromPascal';
import { clearServerLibrary, registerServerLibrary } from '../furnitureCatalog';
import type { ModelQuality, QualityPart } from '../libraryQuality';
import LIBRARY from '../libraryRoles.json' with { type: 'json' };
import {
  hardRejectOf,
  MIN_GAIN,
  paletteOf,
  ROOMSET_VERSION,
  roomSetKeysOf,
  roomSetOf,
  roomSetOnOf,
  setCostOf,
  type Dims,
  type SetContext,
  type SetMember,
} from '../roomSet';
import { adoptedFurnitureIdOf } from '../sceneDressing';
import { PROV_FIELD, type SceneProvenance } from '../sceneLayer';
import { createRepairSession, sessionRepairs } from '../sceneRepair';
import { standardSceneOf } from '../sceneStandard';
import { sceneStyleOf } from '../sceneStyles';
import { roomSetReport, type LayerStyle } from '../sceneVariety';
import type { PascalItemNode, PascalNode, PascalScene } from '../types';

/** Dữ liệu chất lượng giả cho phần tích hợp (tệp thật đang rỗng): id → hồ sơ. */
const Q = vi.hoisted(() => new Map<string, unknown>());
vi.mock('../libraryQuality', async (importOriginal) => ({
  ...(await importOriginal<object>()),
  qualityOf: (id: string) => Q.get(id),
}));

type Lab = readonly [number, number, number];
const OAK: Lab = [62, 8, 24];
const WALNUT: Lab = [34, 10, 16];
const GREY: Lab = [70, 1, 2];

const qual = (
  role: string,
  o: { frame?: Lab; fabric?: Lab; completeness?: 'full' | 'partial' | 'bare'; front?: 'ok' | 'suspect'; issues?: string[]; noParts?: boolean } = {},
): ModelQuality => {
  const parts: QualityPart[] = [
    ...(o.frame === undefined ? [] : [{ kind: 'frame' as const, share: 0.5, lab: o.frame, material: 'wood' as const, kindBy: 'm' as const }]),
    ...(o.fabric === undefined ? [] : [{ kind: 'upholstery' as const, share: 0.4, lab: o.fabric, material: 'fabric' as const, kindBy: 'm' as const }]),
  ];
  return {
    role,
    useMm: [1000, 1000, 1000],
    front: { axis: '+z', check: o.front ?? 'ok' },
    ...(o.completeness === undefined ? {} : { completeness: { v: o.completeness, by: 'i' as const } }),
    ...(o.noParts ? {} : { parts: parts.length > 0 ? parts : [{ kind: 'other', share: 1, lab: GREY, kindBy: 'm' }] }),
    detail: { tris: 1, kb: 1, textures: 0, maxTex: 0, tier: 'light' },
    licence: 'CC0',
    source: 'test',
    ...(o.issues === undefined ? {} : { issues: o.issues }),
  };
};

const ctxOf = (table: Record<string, ModelQuality>, dims: Record<string, Dims> = {}, extra: Partial<SetContext> = {}): SetContext => ({
  tierOf: () => 0,
  tiers: 3,
  dimsOf: (id) => dims[id] ?? [0.5, 0.6, 0.45],
  palette: {},
  qualityOf: (id) => table[id],
  ...extra,
});
const member = (id: string, role: string, current: string | null, pool: string[], extra: Partial<SetMember> = {}): SetMember => ({
  id,
  role,
  short: 0.5,
  long: 0.6,
  current,
  pool,
  fixed: false,
  ...extra,
});
const BED_DIMS: Dims = [1.6, 0.9, 2];
const bedMember = (id: string, current: string, pool: string[], extra: Partial<SetMember> = {}): SetMember =>
  member(id, 'doubleBed', current, pool, { short: 1.6, long: 2, ...extra });

describe('roomSetOf — hàm thuần', () => {
  it('cờ: mặc định tắt, ?enable=roomset bật, ?disable thắng', () => {
    expect(roomSetOnOf('')).toBe(false);
    expect(roomSetOnOf('?enable=roomset')).toBe(true);
    expect(roomSetOnOf('?enable=roomset&disable=roomset')).toBe(false);
    expect(roomSetOnOf('', true)).toBe(true);
  });

  it('ràng buộc cứng: giường chưa hoàn chỉnh/chưa biết, mặt trước nghi, lỗi QC, thiếu phần, to/cao quá, sai vai → loại; giữ mẫu cũ', () => {
    const table: Record<string, ModelQuality> = {
      cur: qual('doubleBed', { frame: OAK, completeness: 'bare' }),
      bare: qual('doubleBed', { frame: OAK, completeness: 'bare' }),
      partial: qual('doubleBed', { frame: OAK, completeness: 'partial' }),
      unknown: qual('doubleBed', { frame: OAK }),
      suspect: qual('doubleBed', { frame: OAK, completeness: 'full', front: 'suspect' }),
      issue: qual('doubleBed', { frame: OAK, completeness: 'full', issues: ['hole'] }),
      noparts: qual('doubleBed', { completeness: 'full', noParts: true }),
      big: qual('doubleBed', { frame: OAK, completeness: 'full' }),
      tall: qual('doubleBed', { frame: OAK, completeness: 'full' }),
      sofa: qual('sofa', { frame: OAK, completeness: 'full' }),
    };
    const dims = { cur: BED_DIMS, bare: BED_DIMS, partial: BED_DIMS, unknown: BED_DIMS, suspect: BED_DIMS, issue: BED_DIMS, noparts: BED_DIMS, big: [2.4, 0.9, 2.6] as Dims, tall: [1.6, 1.5, 2] as Dims, sofa: BED_DIMS };
    const ctx = ctxOf(table, dims);
    const pool = [...Object.keys(table), 'nodata'];
    const m = bedMember('DRESS-bed-R-1', 'cur', pool);
    expect(Object.fromEntries(pool.map((id) => [id, hardRejectOf(m, id, ctx)]))).toEqual({
      cur: 'giường chưa hoàn chỉnh',
      bare: 'giường chưa hoàn chỉnh',
      partial: 'giường chưa hoàn chỉnh',
      unknown: 'giường chưa hoàn chỉnh',
      suspect: 'mặt trước chưa tin',
      issue: 'có lỗi QC',
      noparts: 'thiếu dữ liệu phần',
      big: 'không lọt chỗ',
      tall: 'cao hơn mẫu cũ',
      sofa: 'sai vai',
      nodata: 'thiếu dữ liệu chất lượng',
    });
    const d = roomSetOf('R-1', [m], new Map(), ctx).get(m.id);
    expect(d).toMatchObject({ to: 'cur', rule: 'keep', why: 'không ứng viên qua ràng buộc cứng' });
  });

  it('dữ liệu chất lượng vắng hoàn toàn: mọi món giữ mẫu cũ', () => {
    const ms = [bedMember('b', 'x', ['x', 'y']), member('n1', 'nightstand', 'p', ['p', 'q'])];
    const out = roomSetOf('R-1', ms, new Map(), ctxOf({}));
    expect([...out.values()].map((d) => [d.id, d.to, d.rule])).toEqual([
      ['b', 'x', 'keep'],
      ['n1', 'p', 'keep'],
    ]);
  });

  it('giường ghim là neo, không đổi; hai tab đầu giường chọn cùng mẫu hợp gỗ của neo (ΔE phần frame)', () => {
    const table = {
      'bed-oak': qual('doubleBed', { frame: OAK, completeness: 'full' }),
      'ns-oak': qual('nightstand', { frame: [60, 9, 25] }),
      'ns-walnut': qual('nightstand', { frame: WALNUT }),
    };
    const ms = [
      bedMember('F-bed', 'bed-oak', [], { fixed: true }),
      member('n1', 'nightstand', 'ns-walnut', ['ns-oak', 'ns-walnut']),
      member('n2', 'nightstand', 'ns-walnut', ['ns-oak', 'ns-walnut']),
    ];
    const out = roomSetOf('R-1', ms, new Map(), ctxOf(table, { 'bed-oak': BED_DIMS }));
    expect(out.has('F-bed')).toBe(false);
    expect(out.get('n1')).toMatchObject({ from: 'ns-walnut', to: 'ns-oak', rule: 'roomset' });
    expect(out.get('n2')?.to).toBe('ns-oak');
  });

  it('vải: tối đa một họ màu nhấn mỗi phòng — ghế bành không thêm họ thứ hai cạnh sofa xanh', () => {
    const table = {
      'sofa-blue': qual('sofa', { fabric: [50, -5, -25] }),
      'arm-green': qual('armchair', { fabric: [55, -25, 15] }),
      'arm-grey': qual('armchair', { fabric: GREY }),
    };
    const ms = [member('F-sofa', 'sofa', 'sofa-blue', [], { fixed: true }), member('a', 'armchair', 'arm-green', ['arm-green', 'arm-grey'])];
    const ctx = ctxOf(table);
    expect(roomSetOf('R-1', ms, new Map(), ctx).get('a')?.to).toBe('arm-grey');
    expect(setCostOf(['sofa-blue', 'arm-green'], ctx) - setCostOf(['sofa-blue', 'arm-grey'], ctx)).toBeGreaterThanOrEqual(1);
  });

  it('bảng màu từ SceneStyle so được: tường Lab + L* gỗ theo tông của căn', () => {
    const p = paletteOf(sceneStyleOf('am-ap'), 'd');
    expect(p.woodL).toBe(35);
    expect(p.wall?.[0]).toBeGreaterThan(85);
  });

  it('neo rút trong dải theo băm phòng + vai: sáu phòng không chung một giường; cùng đầu vào → cùng kết quả', () => {
    const beds = ['b1', 'b2', 'b3', 'b4'];
    const table = Object.fromEntries(beds.map((b) => [b, qual('doubleBed', { frame: OAK, completeness: 'full' })]));
    const dims = Object.fromEntries(beds.map((b) => [b, BED_DIMS]));
    const ctx = ctxOf(table, dims);
    const run = () => ['R-a', 'R-b', 'R-c', 'R-d', 'R-e', 'R-f'].map((r) => roomSetOf(r, [bedMember(`DRESS-bed-${r}`, 'cur', beds)], new Map(), ctxOf(table, { ...dims, cur: BED_DIMS })).get(`DRESS-bed-${r}`)?.to);
    const picks = run();
    expect(new Set(picks).size).toBeGreaterThan(1);
    expect(run()).toEqual(picks);
    expect(ctx).toBeDefined();
  });

  it('biên tối thiểu: bộ cũ đạt ràng buộc cứng và bộ mới không rẻ hơn ≥ MIN_GAIN → giữ bộ cũ', () => {
    const table = {
      bed: qual('doubleBed', { frame: OAK, completeness: 'full' }),
      'ns-a': qual('nightstand', { frame: [61.5, 8, 24] }),
      'ns-b': qual('nightstand', { frame: OAK }),
    };
    const ctx = ctxOf(table, { bed: BED_DIMS });
    expect(Math.abs(setCostOf(['bed', 'ns-a'], ctx) - setCostOf(['bed', 'ns-b'], ctx))).toBeLessThan(MIN_GAIN);
    const out = roomSetOf('R-1', [bedMember('F-bed', 'bed', [], { fixed: true }), member('n', 'nightstand', 'ns-a', ['ns-a', 'ns-b'])], new Map(), ctx);
    expect(out.get('n')).toMatchObject({ to: 'ns-a', rule: 'keep' });
  });

  it('nhanh: căn 6 phòng (giường + 2 tab + tủ áo + bàn + ghế, ~30 ứng viên mỗi vai) < 20 ms', () => {
    const pool = (role: string, n: number) => Array.from({ length: n }, (_, i) => `${role}-${i}`);
    const table: Record<string, ModelQuality> = {};
    const dims: Record<string, Dims> = {};
    for (const role of ['doubleBed', 'nightstand', 'closet', 'desk', 'diningChair'])
      for (const [i, id] of pool(role, 30).entries()) {
        table[id] = qual(role, { frame: [40 + i, 8, 20], completeness: 'full', fabric: [60, i - 15, 10] });
        dims[id] = role === 'doubleBed' ? BED_DIMS : [0.5, 0.6, 0.45];
      }
    const roomOf = (r: string): SetMember[] => [
      bedMember(`b-${r}`, 'doubleBed-0', pool('doubleBed', 30)),
      member(`n1-${r}`, 'nightstand', 'nightstand-0', pool('nightstand', 30)),
      member(`n2-${r}`, 'nightstand', 'nightstand-0', pool('nightstand', 30)),
      member(`c-${r}`, 'closet', 'closet-0', pool('closet', 30)),
      member(`d-${r}`, 'desk', 'desk-0', pool('desk', 30)),
      member(`h-${r}`, 'diningChair', 'diningChair-0', pool('diningChair', 30)),
    ];
    const ctx = ctxOf(table, dims);
    const flat = () => {
      const t0 = performance.now();
      for (const r of ['1', '2', '3', '4', '5', '6']) roomSetOf(r, roomOf(r), new Map(), ctx);
      return performance.now() - t0;
    };
    // Lượt đầu gồm biên dịch JIT (máy dùng chung, dao động 10–15 ms); kiểm lượt thứ hai.
    const cold = flat();
    const warm = flat();
    console.info(`roomSet 6 phòng: lạnh ${cold.toFixed(2)} ms, nóng ${warm.toFixed(2)} ms`);
    expect(warm).toBeLessThan(20);
  });
});

/* ---- Khoá băm theo nội dung phòng (REVIEW-1 #2): id sinh lại khi chép dự án không được đổi nội thất ---- */

describe('roomSetKeysOf — khoá nội dung, không theo id', () => {
  const box = (x: number, y: number, w: number, h: number): Point[] => [
    { x, y },
    { x: x + w, y },
    { x: x + w, y: y + h },
    { x, y: y + h },
  ];
  const flat = (ids: readonly string[], level: string, dx = 0) => [
    { id: ids[0] as string, levelId: level, usage: 'bedroom', outline: box(dx, 0, 3500, 3200) },
    { id: ids[1] as string, levelId: level, usage: 'bedroom', outline: box(dx + 3600, 0, 3500, 3200) },
    { id: ids[2] as string, levelId: level, usage: 'bedroom', outline: box(dx, 3300, 4200, 3600) },
  ];
  const keysOf = (rooms: ReturnType<typeof flat>): string[] => {
    const keys = roomSetKeysOf(rooms);
    return rooms.map((r) => keys.get(r.id) as string);
  };

  it('cùng nội dung, id khác + căn dời chỗ → cùng khoá', () => {
    expect(keysOf(flat(['R-a', 'R-b', 'R-c'], 'L-1'))).toEqual(keysOf(flat(['R-x9', 'R-y9', 'R-z9'], 'L-2', 25_000)));
  });

  it('hai phòng trùng chữ ký: khoá khác nhau theo vị trí tương đối; phòng khác cỡ: chữ ký khác', () => {
    const [a, b, c] = keysOf(flat(['R-a', 'R-b', 'R-c'], 'L-1'));
    expect(a).not.toBe(b);
    expect(a?.split('#')[0]).toBe(b?.split('#')[0]);
    expect(c?.split('#')[0]).not.toBe(a?.split('#')[0]);
  });
});

/* ---- Tích hợp: cùng đường toPascalScene (standardSceneOf), thư viện máy chủ giả + dữ liệu chất lượng giả ---- */

const HUMAN = { source: 'human', reviewed: true, confidence: 1 } as const;
const AI = { source: 'ai', reviewed: false, confidence: 0.8 } as const;
const outline: Point[] = [
  { x: 0, y: 0 },
  { x: 5000, y: 0 },
  { x: 5000, y: 4000 },
  { x: 0, y: 4000 },
];
const ROOM = 'R-00000000ROOM';
const LVL = 'L-00000000LVL1';
const piece = (id: string, kind: Furniture['kind'], w: number, d: number, x: number, y: number, extra: Partial<Furniture> = {}) =>
  ({ ...AI, id, levelId: LVL, roomId: ROOM, kind, centre: { x, y }, boundingBox: { min: { x: x - w / 2, y: y - d / 2 }, max: { x: x + w / 2, y: y + d / 2 } }, rotationDeg: 0, ...extra }) as Furniture;
const BED = 'F-0000000000BED';
const NS1 = 'F-00000000000N1';
const NS2 = 'F-00000000000N2';
const CHAIR = 'F-00000000CHAIR';
const graphWith = (bedExtra: Partial<Furniture> = {}): SpatialGraph =>
  ({
    building: { ...HUMAN, name: 'b', datumElevationMm: 0 },
    levels: [{ ...HUMAN, id: LVL, name: 'T1', order: 0, elevationMm: 0, heightMm: 3000 }],
    walls: outline.map(
      (start, i) =>
        ({ ...HUMAN, id: `W-0000000WALL${i}`, levelId: LVL, centreline: { start, end: outline[(i + 1) % 4] as Point }, thicknessMm: 200, heightMm: 2700, kind: 'envelope', openingIds: [] }) as Wall,
    ),
    openings: [],
    rooms: [{ ...HUMAN, id: ROOM, levelId: LVL, name: 'Phòng ngủ', usage: 'bedroom', outline, areaM2: 20, wallIds: [] } as Room],
    furniture: [
      piece(BED, 'bed', 1600, 2000, 1350, 1150, { heightMm: 500, ...bedExtra } as Partial<Furniture>),
      piece(NS1, 'table', 450, 400, 300, 350, { heightMm: 550 } as Partial<Furniture>),
      piece(NS2, 'table', 450, 400, 2400, 350, { heightMm: 550 } as Partial<Furniture>),
      piece(CHAIR, 'chair', 450, 450, 4000, 3200, { ...HUMAN, rotationDeg: 90 } as Partial<Furniture>),
    ],
    axes: [],
    dimensions: [],
    notes: [],
  }) as unknown as SpatialGraph;

const roles = LIBRARY.roles as Record<string, string[]>;
const SET_LIB_ROLES = ['doubleBed', 'nightstand', 'closet', 'dresser', 'desk', 'diningChair', 'armchair', 'coffeeTable', 'sofa', 'bench', 'bookshelf', 'cabinet', 'diningTable'];
const mmOf = (role: string): [number, number, number] =>
  role === 'doubleBed' ? [1600, 900, 2000] : role === 'nightstand' ? [450, 550, 400] : role === 'closet' ? [1000, 2000, 600] : [800, 800, 800];
const base = sceneStyleOf(undefined);
const ON: LayerStyle = { ...base, roomSet: true, layout: new Set(), variety: new Set() };
const OFF: LayerStyle = { ...base, roomSet: false, layout: new Set(), variety: new Set() };
const sceneOf = (graph: SpatialGraph, style: LayerStyle): PascalScene => standardSceneOf(graph, { style }).scene;
const itemsOf = (scene: PascalScene): string =>
  JSON.stringify(Object.values(scene.nodes).filter((n) => (n as { type: string }).type === 'item').sort((a, b) => (a.id < b.id ? -1 : 1)));
/** Mẫu thư viện của node: id trong URL mẫu giả (`https://x.test/<id>.glb`); không phải mẫu thư viện → src. */
const assetOf = (scene: PascalScene, id: string): string => {
  const src = (scene.nodes[`item_${id}`] as PascalItemNode).asset.src;
  return /x\.test\/([^/?]+)\.glb/.exec(src)?.[1] ?? src;
};
const provOf = (scene: PascalScene, id: string): SceneProvenance | undefined =>
  (scene.nodes[`item_${id}`]?.metadata as { appfront?: { fields?: Record<string, unknown> } } | undefined)?.appfront?.fields?.[PROV_FIELD] as SceneProvenance | undefined;

let oldBed = '';
const fillQuality = (bareBed: string): void => {
  Q.clear();
  for (const role of SET_LIB_ROLES)
    for (const [i, id] of (roles[role] ?? []).entries()) {
      const wood: Lab = [55 + (i % 5), 8, 22];
      Q.set(id, qual(role, { frame: wood, completeness: id === bareBed ? 'bare' : 'full' }));
    }
};

describe('roomset trong đường dựng cảnh', () => {
  beforeAll(() => {
    registerServerLibrary(
      SET_LIB_ROLES.flatMap((role) =>
        (roles[role] ?? []).map((id) => {
          const [widthMm, heightMm, depthMm] = mmOf(role);
          return { id, widthMm, heightMm, depthMm, modelUrl: `https://x.test/${id}.glb` };
        }),
      ),
    );
    oldBed = assetOf(sceneOf(graphWith(), OFF), BED);
    // Mẫu luật cũ chọn là giường nệm trần → roomset phải thay bằng giường hoàn chỉnh.
    fillQuality(oldBed);
  });
  afterAll(() => {
    clearServerLibrary();
    Q.clear();
  });

  it('cờ tắt: cảnh y như không có khoá roomset', () => {
    expect(itemsOf(sceneOf(graphWith(), OFF))).toBe(itemsOf(sceneOf(graphWith(), { ...base, layout: new Set(), variety: new Set() })));
  });

  it('cờ bật: giường trần thay bằng giường hoàn chỉnh, prov.model ghi luật + phiên bản + mẫu cũ; hai tab cùng mẫu; báo cáo', () => {
    const scene = sceneOf(graphWith(), ON);
    const bed = assetOf(scene, BED);
    expect(bed).not.toBe(oldBed);
    expect((Q.get(bed) as ModelQuality).completeness?.v).toBe('full');
    expect(provOf(scene, BED)).toMatchObject({ cls: 'ai', rule: 'roomset', model: { rule: 'roomset', version: ROOMSET_VERSION, from: oldBed } });
    expect(assetOf(scene, NS1)).toBe(assetOf(scene, NS2));
    const report = roomSetReport()[ROOM];
    expect(report?.anchor).toBe(BED);
    expect(report?.items.find((d) => d.id === BED)).toMatchObject({ from: oldBed, to: bed, rule: 'roomset' });
  });

  it('tải lại cho cùng kết quả; dữ liệu chất lượng đổi thì lượt sau tính lại (không cache giữa lượt)', () => {
    const first = itemsOf(sceneOf(graphWith(), ON));
    expect(itemsOf(sceneOf(graphWith(), ON))).toBe(first);
    const picked = assetOf(sceneOf(graphWith(), ON), BED);
    Q.set(picked, qual('doubleBed', { frame: OAK, completeness: 'bare' }));
    try {
      expect(assetOf(sceneOf(graphWith(), ON), BED)).not.toBe(picked);
    } finally {
      fillQuality(oldBed);
    }
  });

  it('chép sang dự án khác (id phòng/tầng sinh lại): mọi món, kể cả đồ sinh, giữ mẫu', () => {
    const copies = ['R-0000COPYA001', 'R-0000COPYB002', 'R-0000COPYC003', 'R-0000COPYD004'];
    const renamed = (g: SpatialGraph, roomId: string): SpatialGraph =>
      JSON.parse(JSON.stringify(g).split(ROOM).join(roomId).split(LVL).join('L-0000COPY0001')) as SpatialGraph;
    const picks = (g: SpatialGraph, roomId: string): string[] => {
      const scene = sceneOf(g, ON);
      return Object.values(scene.nodes)
        .filter((n): n is PascalItemNode => n.type === 'item')
        .map((n) => `${n.id.split(roomId).join(ROOM)}=${assetOf(scene, n.id.slice(5))}`)
        .sort();
    };
    for (const g of [graphWith(), { ...graphWith(), furniture: [] }]) {
      const original = picks(g, ROOM);
      for (const id of copies) expect(picks(renamed(g, id), id)).toEqual(original);
    }
    // Dải neo của phòng này có 6 ứng viên: băm theo id thì 4 bản chép gần như chắc chắn rút khác nhau.
  });

  it('món ghim (người dùng xác nhận) giữ nguyên mẫu, không mang prov.model', () => {
    const pinned = graphWith({ ...HUMAN } as Partial<Furniture>);
    const scene = sceneOf(pinned, ON);
    expect(assetOf(scene, BED)).toBe(assetOf(sceneOf(pinned, OFF), BED));
    expect(provOf(scene, BED)?.model).toBeUndefined();
  });

  it('lưu: lượt nạp đầu (mọi node "đã đổi") không ghi mẫu roomset vào dữ liệu', () => {
    const graph = graphWith();
    const scene = sceneOf(graph, ON);
    const result = createPascalEditCommand({
      graph: normalizeSpatial(graph),
      scene,
      commit: { origin: 'local', changedNodeIds: Object.keys(scene.nodes) },
      actorId: 'U-1',
    });
    const changes = result.ok ? result.data.changes : [];
    const written = changes.flatMap((c) => {
      const after = c.after as Partial<Furniture> | null | undefined;
      return after?.model === undefined ? [] : [after.model.src];
    });
    expect(written.filter((src) => src.includes(assetOf(scene, BED)))).toEqual([]);
  });

  describe('undo/redo qua derivedHistory', () => {
    class Page {
      stored: SpatialGraph = denormalizeSpatial(normalizeSpatial(graphWith()));
      session = createRepairSession();
      history = createDerivedHistory();
      base!: PascalScene;
      build(): PascalScene {
        const { graph, repairs } = sessionRepairs(this.session, this.stored);
        return standardSceneOf(graph, { style: ON, repairs: new Map(repairs.map((r) => [r.furnitureId, r])) }).scene;
      }
      load(): PascalScene {
        const scene = this.build();
        recordDerived(this.history, scene, []);
        this.base = scene;
        return scene;
      }
      save(raw: PascalScene): string[] {
        const target = touchedTargetFor(this.session, () => this.stored, (g) => standardSceneOf(g, { style: ON, repairs: new Map() }).scene);
        const { scene } = restoreDerived(this.history, raw, target);
        // Như `commitOfScenes` (tầng lib không import screens): node khác mốc là "đã đổi".
        const changedNodeIds = Object.keys(scene.nodes).filter((id) => JSON.stringify(scene.nodes[id]) !== JSON.stringify(this.base.nodes[id]));
        const result = createPascalEditCommand({ graph: normalizeSpatial(this.stored), scene, commit: { origin: 'local', changedNodeIds }, actorId: 'U-1' });
        if (!result.ok && result.error.code !== 'PASCAL_NO_CHANGE') throw new Error(result.error.reasons.join(' '));
        const changes = result.ok ? result.data.changes : [];
        for (const c of changes) {
          const after = c.after as Furniture | null | undefined;
          const id = (after ?? (c.before as Furniture)).id;
          this.stored = { ...this.stored, furniture: this.stored.furniture.map((f) => (f.id === id && after ? after : f)) };
        }
        this.base = scene;
        this.load();
        return changes.map((c) => ((c.after ?? c.before) as Furniture).id);
      }
    }
    const moveNode = (scene: PascalScene, id: string, dx: number): PascalScene => {
      const node = scene.nodes[id] as PascalItemNode;
      return { ...scene, nodes: { ...scene.nodes, [id]: { ...node, position: [node.position[0] + dx, node.position[1], node.position[2]] } as PascalNode } };
    };
    const unclaimed = (g: SpatialGraph, id: string) => {
      const f = g.furniture.find((x) => x.id === id) as Furniture;
      return f.model === undefined && f.edited !== true && f.reviewed === false;
    };

    it('dời món khác rồi Ctrl+Z / Ctrl+Y: món dẫn xuất không thành đã nhận, mẫu bộ không đổi', () => {
      const page = new Page();
      const loaded = page.load();
      const bed = assetOf(loaded, BED);
      const moved = moveNode(loaded, `item_${CHAIR}`, 0.2);
      expect(page.save(moved)).toEqual([CHAIR]);
      expect(page.save(loaded)).toEqual([CHAIR]);
      expect(page.save(moved)).toEqual([CHAIR]);
      for (const id of [BED, NS1, NS2]) expect(unclaimed(page.stored, id)).toBe(true);
      expect(assetOf(page.base, BED)).toBe(bed);
    });

    it('dời một tab đầu giường: chỉ món đó được ghi; neo và tab kia giữ mẫu', () => {
      const page = new Page();
      const loaded = page.load();
      const [bed, ns2] = [assetOf(loaded, BED), assetOf(loaded, NS2)];
      expect(page.save(moveNode(loaded, `item_${NS1}`, 0.05))).toEqual([NS1]);
      expect(unclaimed(page.stored, BED)).toBe(true);
      expect(unclaimed(page.stored, NS2)).toBe(true);
      expect(assetOf(page.base, BED)).toBe(bed);
      expect(assetOf(page.base, NS2)).toBe(ns2);
    });
  });

  /* Điểm chặn REVIEW-1 #1: sửa MỘT món sinh chỉ ghi món đó (kèm mẫu đang thấy); anh em vẫn là lớp dẫn xuất. */
  describe('sửa một món sinh: ghi đúng một món, lưu + tải lại giữ chỗ và mẫu cả phòng', () => {
    const empty = (): SpatialGraph => ({ ...graphWith(), furniture: [] });
    const roomItems = (scene: PascalScene): PascalItemNode[] =>
      Object.values(scene.nodes).filter(
        (n): n is PascalItemNode =>
          n.type === 'item' && n.id.startsWith('item_DRESS-') && n.metadata?.appfront?.fields?.['roomId'] === ROOM,
      );
    const spot = (n: PascalNode | undefined): string =>
      n?.type === 'item' ? `${n.position[0].toFixed(3)},${n.position[2].toFixed(3)}|${assetOf({ nodes: { [n.id]: n } } as PascalScene, n.id.slice(5))}` : 'vắng';
    /** Áp lệnh lên đồ thị như máy chủ: thêm/sửa/xoá đồ, thay phòng. */
    const apply = (graph: SpatialGraph, changes: readonly { kind: string; before?: unknown; after?: unknown }[]): SpatialGraph =>
      changes.reduce((g, c) => {
        const after = c.after as { id: string } | null;
        const id = (after ?? (c.before as { id: string })).id;
        if (c.kind === 'room') return { ...g, rooms: g.rooms.map((r) => (r.id === id ? (after as Room) : r)) };
        const rest = g.furniture.filter((f) => f.id !== id);
        return { ...g, furniture: after === null ? rest : [...rest, after as Furniture] };
      }, graph);

    for (const [name, style] of [['bật', ON], ['tắt', OFF]] as const) {
      it(`roomset ${name}: dời giường sinh → 1 món + phòng (dressingOff); tải lại: giường đúng chỗ/mẫu, anh em y nguyên; Ctrl+Z trả về đồ sinh`, () => {
        const graph = empty();
        const scene = sceneOf(graph, style);
        const before = roomItems(scene);
        const bed = before.find((n) => n.metadata?.appfront?.fields?.['kind'] === 'bed') as PascalItemNode;
        expect(before.length).toBeGreaterThan(2);
        const movedBed = { ...bed, position: [bed.position[0] + 0.1, bed.position[1], bed.position[2]] } as PascalItemNode;
        const moved: PascalScene = { ...scene, nodes: { ...scene.nodes, [bed.id]: movedBed } };
        const idBook = new Map<string, string>();
        const result = createPascalEditCommand({ graph: normalizeSpatial(graph), scene: moved, commit: { origin: 'local', changedNodeIds: [bed.id] }, actorId: 'U-1', idBook });
        if (!result.ok) throw new Error(result.error.reasons.join(' '));
        const furniture = result.data.changes.filter((c) => c.kind === 'furniture');
        const adoptedId = adoptedFurnitureIdOf(bed.id.slice(5));
        expect(furniture).toHaveLength(1);
        expect(furniture[0]?.after).toMatchObject({ id: adoptedId, model: { src: `/items/${assetOf(scene, bed.id.slice(5))}/model.glb` } });
        expect(result.data.changes.find((c) => c.kind === 'room')?.after).toMatchObject({ dressingOff: [bed.id.slice(5)] });

        const saved = apply(graph, result.data.changes);
        const reloaded = sceneOf(saved, style);
        expect(spot(reloaded.nodes[`item_${adoptedId}`])).toBe(spot(movedBed));
        expect(reloaded.nodes[bed.id]).toBeUndefined();
        for (const n of before.filter((x) => x.id !== bed.id)) expect(spot(reloaded.nodes[n.id])).toBe(spot(n));
        expect(roomItems(reloaded)).toHaveLength(before.length - 1);
        // Tải lại lần nữa: không trôi.
        expect(itemsOf(sceneOf(saved, style))).toBe(itemsOf(reloaded));

        // Ctrl+Z (cảnh về như lúc nạp, cùng sổ id): đồ thật đi, id rời `dressingOff`, phòng lại như chưa sửa.
        const undo = createPascalEditCommand({ graph: normalizeSpatial(saved), scene, commit: { origin: 'local', changedNodeIds: [bed.id] }, actorId: 'U-1', idBook });
        if (!undo.ok) throw new Error(undo.error.reasons.join(' '));
        const restored = apply(saved, undo.data.changes);
        expect(restored.furniture).toHaveLength(0);
        expect(restored.rooms[0]?.dressingOff ?? []).toEqual([]);
        expect(itemsOf(sceneOf(restored, style))).toBe(itemsOf(scene));
      });
    }

    it('dữ liệu cũ (cả phòng đã nhận, id ngẫu nhiên, không dressingOff): tải lại y nguyên, không mọc đồ sinh', () => {
      const scene = sceneOf(empty(), ON);
      const nodes = roomItems(scene);
      const all = createPascalEditCommand({
        graph: normalizeSpatial(empty()),
        scene,
        commit: { origin: 'local', changedNodeIds: nodes.map((n) => n.id) },
        actorId: 'U-1',
        adoptNodeIds: nodes.map((n) => n.id),
      });
      if (!all.ok) throw new Error(all.error.reasons.join(' '));
      const legacy: SpatialGraph = {
        ...empty(),
        furniture: all.data.changes
          .filter((c) => c.kind === 'furniture')
          .map((c, i) => {
            // Hợp đồng cũ không ghi mẫu luật chọn.
            const f = { ...(c.after as Furniture), id: `F-0000LEGACY${String(i).padStart(2, '0')}` as Furniture['id'] };
            delete f.model;
            return f;
          }),
      };
      const reloaded = sceneOf(legacy, ON);
      expect(legacy.furniture).toHaveLength(nodes.length);
      expect(roomItems(reloaded).map((n) => n.id)).toEqual([]);
      for (const f of legacy.furniture) {
        const node = reloaded.nodes[`item_${f.id}`] as PascalItemNode;
        expect([Math.round(node.position[0] * 1000), Math.round(node.position[2] * 1000)]).toEqual([f.centre.x, f.centre.y]);
      }
      expect(itemsOf(sceneOf(legacy, ON))).toBe(itemsOf(reloaded));
    });
  });
});
