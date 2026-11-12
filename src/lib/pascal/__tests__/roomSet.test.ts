/**
 * Bộ nội thất theo phòng (`roomSet.ts` + móc trong `sceneVariety.ts`/`toPascal.ts`, vòng 12 làn S): ràng buộc cứng
 * loại trước (dữ liệu vắng = loại), neo + món phụ hợp gỗ/vải, cặp cùng vai một mẫu, tất định; vòng 14: một đánh giá cho
 * mọi món chưa ghim (mẫu luật cũ chỉ là phương án cuối); cờ tắt = như cũ; không ghi mẫu dẫn xuất vào bản lưu; tải lại cùng kết quả; undo/redo không nhận món dẫn xuất.
 */
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

import { denormalizeSpatial, normalizeSpatial } from '@/domain/spatial/normalize';
import type { Furniture, Point, Room, SpatialGraph, Wall } from '@/domain/spatial/types';
import { createDerivedHistory, recordDerived, restoreDerived, touchedTargetFor } from '@/pascal-page/bridge/derivedHistory';

import { createPascalEditCommand } from '../fromPascal';
import { clearServerLibrary, registerServerLibrary } from '../furnitureCatalog';
import { itemFitOf } from '../itemFit';
import { LIBRARY_QUALITY, type ModelQuality, type QualityPart } from '../libraryQuality';
import LIBRARY from '../libraryRoles.json' with { type: 'json' };
import {
  DARK_L,
  CEILING_GAP_M,
  DARK_SEAT_SHARE,
  hardRejectOf,
  layersOf,
  paletteOf,
  ROOMSET_VERSION,
  roomSetKeysOf,
  roomSetOf,
  ROOMSET_DEFAULT,
  roomSetOnOf,
  scaleOf,
  SCALE_MAX,
  SCALE_MIN,
  SHOWN_TOL_M,
  type Dims,
  type SetContext,
  type SetMember,
} from '../roomSet';
import { PROV_FIELD, type SceneProvenance } from '../sceneLayer';
import { createRepairSession, sessionRepairs } from '../sceneRepair';
import { standardSceneOf } from '../sceneStandard';
import { SCENE_STYLE_IDS, sceneStyleOf, type SceneStyleId } from '../sceneStyles';
import { roomSetReport, type LayerStyle } from '../sceneVariety';
import type { PascalItemNode, PascalNode, PascalScene } from '../types';

/** Dữ liệu chất lượng giả cho phần tích hợp (tình huống dựng tay, độc lập với tệp thật): id → hồ sơ. */
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
  it('cờ: mặc định BẬT (lượt 10), ?disable=roomset tắt; cờ cũ ?enable=roomvariety,chairset,varietyai bỏ qua lặng lẽ', () => {
    expect(ROOMSET_DEFAULT).toBe(true);
    expect(roomSetOnOf('')).toBe(true);
    expect(roomSetOnOf('?disable=roomset')).toBe(false);
    expect(roomSetOnOf('?enable=roomset&disable=roomset')).toBe(false);
    expect(roomSetOnOf('?enable=roomvariety,chairset,varietyai')).toBe(true);
    expect(roomSetOnOf('', false)).toBe(false);
    expect(roomSetOnOf('?enable=roomset', false)).toBe(true);
  });

  it('ràng buộc cứng: giường chưa hoàn chỉnh/chưa biết, mặt trước nghi, lỗi QC, thiếu phần, to/cao quá chuẩn vai, sai vai → loại; không ứng viên → mẫu luật cũ', () => {
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
      tall: 'cao hơn chuẩn vai',
      sofa: 'sai vai',
      nodata: 'thiếu dữ liệu chất lượng',
    });
    const d = roomSetOf('R-1', [m], new Map(), ctx).get(m.id);
    expect(d).toMatchObject({ to: 'cur', rule: 'keep', cause: 'fallback', why: 'không ứng viên qua ràng buộc cứng — mẫu luật cũ' });
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
    expect(out.get('F-bed')).toMatchObject({ to: 'bed-oak', rule: 'keep', cause: 'pinned' });
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
  });

  it('bảng màu từ SceneStyle so được: tường Lab + L* gỗ theo tông của căn', () => {
    const p = paletteOf(sceneStyleOf('am-ap'), 'd');
    expect(p.tone).toBe('d');
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

  it('vòng 14 — không còn biên MIN_GAIN: món chưa ghim lấy mẫu rẻ nhất dù mẫu luật cũ chỉ kém chút; luật cũ chỉ ghi `from`', () => {
    const table = {
      bed: qual('doubleBed', { frame: OAK, completeness: 'full' }),
      // Chênh ≈ 0,18: lớn hơn dải hoà ANCHOR_BAND 0,08 (không rút băm), nhỏ hơn MIN_GAIN cũ 0,25 (trước đây sẽ giữ ns-a).
      'ns-a': qual('nightstand', { frame: [40, 8, 24] }),
      'ns-b': qual('nightstand', { frame: OAK }),
    };
    const ctx = ctxOf(table, { bed: BED_DIMS });
    const out = roomSetOf('R-1', [bedMember('F-bed', 'bed', [], { fixed: true }), member('n', 'nightstand', 'ns-a', ['ns-a', 'ns-b'])], new Map(), ctx);
    const d = out.get('n');
    expect(d).toMatchObject({ from: 'ns-a', to: 'ns-b', rule: 'roomset', cause: 'selector' });
    expect((d?.fromCost as number) - (d?.cost as number)).toBeLessThan(0.25);
    // Cùng mẫu tốt nhất với luật cũ → `same`.
    expect(roomSetOf('R-1', [bedMember('F-bed', 'bed', [], { fixed: true }), member('n', 'nightstand', 'ns-b', ['ns-a', 'ns-b'])], new Map(), ctx).get('n')).toMatchObject({ to: 'ns-b', cause: 'same', rule: 'keep' });
  });

  it('nhanh: căn 6 phòng (giường + 2 tab + tủ áo + bàn + ghế, ~30 ứng viên mỗi vai): in số đo, chốt bậc độ phức tạp < 250 ms', () => {
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
    // In số đo (mục tiêu < 20 ms trên máy dev). Trần 250 ms chỉ là chốt chống hồi quy BẬC độ phức tạp (vd vòng lặp
    // bình phương theo số ứng viên), KHÔNG phải ngân sách thời gian — ngưỡng cứng sát mục tiêu chập chờn trên CI.
    const cold = flat();
    const warm = flat();
    console.info(`roomSet 6 phòng: lạnh ${cold.toFixed(2)} ms, nóng ${warm.toFixed(2)} ms`);
    expect(warm).toBeLessThan(250);
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
const ON: LayerStyle = { ...base, roomSet: true, layout: new Set() };
const OFF: LayerStyle = { ...base, roomSet: false, layout: new Set() };
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
// Vòng 13: luật thư viện đã không tự chọn giường dưới chuẩn hoàn thiện, nên tiền đề "luật cũ chọn nệm trần" không còn
// dựng được; giường cũ ở đây ĐỦ chăn gối nhưng khung gỗ đỏ sẫm lệch tông → roomset vẫn phải thay và ghi sổ như trước.
const fillQuality = (offBed: string): void => {
  Q.clear();
  for (const role of SET_LIB_ROLES)
    for (const [i, id] of (roles[role] ?? []).entries()) {
      const wood: Lab = id === offBed ? [24, 30, 28] : [55 + (i % 5), 8, 22];
      Q.set(id, qual(role, { frame: wood, completeness: 'full' }));
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
    // Mẫu luật cũ chọn lệch tông → roomset phải thay bằng giường hợp bộ (vẫn đủ chăn gối).
    fillQuality(oldBed);
  });
  afterAll(() => {
    clearServerLibrary();
    Q.clear();
  });

  it('mặc định bật: cảnh không có khoá roomset = cảnh bật tường minh; tắt tường minh thì khác', () => {
    const plain = itemsOf(sceneOf(graphWith(), { ...base, layout: new Set() }));
    expect(plain).toBe(itemsOf(sceneOf(graphWith(), ON)));
    expect(plain).not.toBe(itemsOf(sceneOf(graphWith(), OFF)));
  });

  it('cờ bật: giường lệch tông thay bằng giường hợp bộ (đủ chăn gối), prov.model ghi luật + phiên bản + mẫu cũ; hai tab cùng mẫu; báo cáo', () => {
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

  it('"Hiện dữ liệu gốc" (raw) tắt roomset: mọi asset.src y hệt ?disable=roomset + raw', () => {
    const srcs = (scene: PascalScene): string =>
      JSON.stringify(Object.values(scene.nodes).filter((n) => (n as { type: string }).type === 'item').map((n) => [n.id, (n as PascalItemNode).asset.src]).sort());
    const rawOn = srcs(standardSceneOf(graphWith(), { style: ON, raw: true }).scene);
    expect(rawOn).toBe(srcs(standardSceneOf(graphWith(), { style: OFF, raw: true }).scene));
    expect(srcs(sceneOf(graphWith(), ON))).not.toBe(srcs(sceneOf(graphWith(), OFF)));
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

  it('vòng 14 — món người dùng xác nhận CHƯA gán mẫu: mẫu do cùng đánh giá chọn (không phải luật cũ), sổ ghi by=user; không mang prov.model', () => {
    const confirmed = graphWith({ ...HUMAN } as Partial<Furniture>);
    const scene = sceneOf(confirmed, ON);
    const bed = assetOf(scene, BED);
    expect(bed).not.toBe(oldBed);
    expect((Q.get(bed) as ModelQuality).completeness?.v).toBe('full');
    expect(provOf(scene, BED)?.model).toBeUndefined();
    expect(roomSetReport()[ROOM]?.items.find((d) => d.id === BED)).toMatchObject({ from: oldBed, to: bed, cause: 'selector', by: 'user' });
  });

  it('món GHIM (người dùng chọn mẫu `model`) giữ nguyên mẫu, sổ ghi cause=pinned; các món khác chấm theo nó', () => {
    const src = `/items/${oldBed}/model.glb`;
    const pinned = graphWith({ ...HUMAN, model: { id: oldBed, src } } as Partial<Furniture>);
    const on = sceneOf(pinned, ON);
    expect(roomSetReport()[ROOM]?.items.find((d) => d.id === BED)).toMatchObject({ to: oldBed, cause: 'pinned' });
    expect((on.nodes[`item_${BED}`] as PascalItemNode).asset.src).toBe((sceneOf(pinned, OFF).nodes[`item_${BED}`] as PascalItemNode).asset.src);
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

/* ---- Lượt 2: DỮ LIỆU THẬT (`LIBRARY_QUALITY`, không fixture) — kết quả chấm ảnh mù 9 căn; id chỉ để dựng tình huống ---- */

describe('roomset trên dữ liệu chất lượng thật (am-ap, tông sáng)', () => {
  const real = (id: string): ModelQuality | undefined => LIBRARY_QUALITY.models[id];
  const am = sceneStyleOf('am-ap');
  const wanted = am.libraryStyles ?? [];
  const libStyles = (LIBRARY as unknown as { models: Record<string, { s: string[] }> }).models;
  const ctx: SetContext = {
    // Như `styleTierOf` của sceneVariety.
    tierOf: (f) => {
      const s = libStyles[f]?.s ?? [];
      const best = Math.min(...wanted.map((c, i) => (s.includes(c) ? i : Infinity)));
      return best !== Infinity ? best : s.length === 0 ? wanted.length : wanted.length + 1;
    },
    tiers: wanted.length,
    dimsOf: (f) => {
      const u = real(f)?.useMm;
      return u === undefined ? undefined : [u[0] / 1000, u[1] / 1000, u[2] / 1000];
    },
    palette: paletteOf(am, 'l'),
    qualityOf: real,
  };
  const pool = (role: string): string[] => (roles[role] ?? []).filter((id) => real(id) !== undefined);
  /** Món trong phạm vi, chỗ đặt = mặt bằng mẫu cũ (ứng viên không to hơn chỗ cũ quá 10 %). */
  const at = (id: string, role: string, current: string, extra: Partial<SetMember> = {}): SetMember => {
    const [w, , d] = ctx.dimsOf(current) ?? [1, 1, 1];
    return { id, role, short: Math.min(w, d), long: Math.max(w, d), current, pool: pool(role), fixed: false, ...extra };
  };
  const partsOf = (id: string | null | undefined): readonly QualityPart[] => (id ? (real(id)?.parts ?? []) : []);
  const darkShare = (id: string | null | undefined): number => partsOf(id).reduce((s, p) => s + (p.lab[0] < DARK_L ? p.share : 0), 0);
  const mainSoftL = (id: string | null | undefined): number | undefined =>
    [...partsOf(id)].filter((p) => p.kind === 'upholstery' || p.kind === 'bedding').sort((a, b) => b.share - a.share)[0]?.lab[0];
  const woodA = (id: string | null | undefined): number | undefined => {
    const w = partsOf(id).filter((p) => p.material === 'wood' && Math.hypot(p.lab[1], p.lab[2]) >= 8);
    const s = w.reduce((a, p) => a + p.share, 0);
    return s === 0 ? undefined : w.reduce((a, p) => a + p.lab[1] * p.share, 0) / s;
  };
  const livingRoom = (): SetMember[] => [
    at('sofa', 'sofa', 'sofa-grey-linen-slim'),
    at('arm', 'armchair', 'chair-lenestol-oak-black'),
    at('coffee', 'coffeeTable', 'table-coffee-white-oval'),
    at('shelf', 'bookshelf', 'storage-shelf-metal-oak'),
  ];
  const diningChairs = (): SetMember[] => ['c1', 'c2', 'c3', 'c4'].map((id) => at(id, 'diningChair', 'chair-dining-wishbone-white'));

  it('phòng khách: sofa xám vải không bị thay bằng sofa da tối; ghế bành, kệ, bàn trà không thành món tối đậm', () => {
    const out = roomSetOf('living', livingRoom(), new Map(), ctx);
    const sofa = out.get('sofa')?.to;
    expect(mainSoftL(sofa)).toBeGreaterThanOrEqual(40);
    expect(darkShare(sofa)).toBeLessThan(DARK_SEAT_SHARE);
    for (const id of ['arm', 'shelf', 'coffee']) expect(darkShare(out.get(id)?.to)).toBeLessThan(DARK_SEAT_SHARE);
  });

  it('phòng ăn có tủ sồi cố định: bàn ăn không thành gỗ đỏ; ghế quanh bàn một mẫu, không khung/nệm đen', () => {
    const chairs = diningChairs();
    const out = roomSetOf(
      'dining',
      [at('oak', 'bookshelf', 'storage-shelf-metal-oak', { fixed: true, pool: [] }), at('table', 'diningTable', 'dining-table-pro'), ...chairs],
      new Map(),
      ctx,
    );
    expect(woodA(out.get('table')?.to) ?? 0).toBeLessThanOrEqual(15);
    const picked = new Set(chairs.map((c) => out.get(c.id)?.to));
    expect(picked.size).toBe(1);
    expect(darkShare([...picked][0])).toBeLessThan(DARK_SEAT_SHARE);
  });

  it('phòng ngủ: giường chưa đủ chăn gối được thay bằng giường `full` có phần chăn; tủ áo greywash → tủ ít phần tối hơn', () => {
    // Giường cao thường (≥ 0,9 m) chưa đủ chăn gối: giường khung thấp bị luật cao (HEIGHT_GROW_MAX) chặn mọi giường có đầu giường.
    const bare = pool('doubleBed').find((id) => real(id)?.completeness?.v !== 'full' && (real(id)?.useMm[1] ?? 0) >= 900 && (real(id)?.parts?.length ?? 0) > 0) as string;
    expect(bare).toBeDefined();
    // Chỗ giường đôi thường gặp (hộp 1,8 × 2,2 m); mẫu cũ chưa đủ chăn gối thì không qua ràng buộc cứng.
    const out = roomSetOf('bed', [at('bed', 'doubleBed', bare, { short: 1.8, long: 2.2 }), at('closet', 'closet', 'storage-wardrobe-greywash')], new Map(), ctx);
    const bed = out.get('bed')?.to;
    expect(real(bed ?? '')?.completeness?.v).toBe('full');
    expect(partsOf(bed).some((p) => p.kind === 'bedding')).toBe(true);
    // Vòng 13: tủ có đổi hay không tuỳ giường neo của catalog hiện tại (MIN_GAIN); nếu đổi thì phải ít phần tối hơn.
    const closet = out.get('closet');
    if (closet?.rule === 'roomset') expect(darkShare(closet.to)).toBeLessThan(darkShare('storage-wardrobe-greywash'));
    else expect(closet?.to).toBe('storage-wardrobe-greywash');
  });

  it('thống kê một căn mẫu (khách + ăn + 2 ngủ): số món đổi / giữ và lý do giữ', () => {
    const ns = pool('nightstand')[0] as string;
    const rooms: [string, SetMember[]][] = [
      ['living', livingRoom()],
      ['dining', [at('table', 'diningTable', 'dining-table-pro'), ...diningChairs()]],
      ['bed1', [at('b1', 'doubleBed', 'bed-double-oak-pro'), at('n1', 'nightstand', ns), at('n2', 'nightstand', ns), at('w1', 'closet', 'storage-wardrobe-greywash'), at('d1', 'dresser', 'storage-commode-beige')]],
      ['bed2', [at('b2', 'doubleBed', 'bed-double-oak-pro'), at('w2', 'closet', 'storage-wardrobe-greywash'), at('k2', 'desk', 'desk-pro')]],
    ];
    const all = rooms.flatMap(([key, ms]) => [...roomSetOf(key, ms, new Map(), ctx).values()]);
    const causes: Record<string, number> = {};
    for (const d of all) causes[d.cause] = (causes[d.cause] ?? 0) + 1;
    console.info(`roomset căn mẫu: ${all.length} món`, JSON.stringify(causes));
    console.info(all.map((d) => `${d.id}: ${d.from} → ${d.to} [${d.cause}] ${d.why}`).join('\n'));
    expect(all.length).toBe(17);
    // Vòng 14: không còn "giữ mẫu cũ"; mẫu chọn luôn qua ràng buộc cứng, luật cũ chỉ khi không ứng viên nào qua.
    for (const [, ms] of rooms)
      for (const m of ms) {
        const d = all.find((x) => x.id === m.id);
        if (d?.cause === 'fallback') expect(d.to).toBe(m.current);
        else expect(hardRejectOf(m, d?.to as string, ctx)).toBeUndefined();
      }
  });
});

/* ---- Lượt 3 (Codex review 2): ràng buộc cứng của CHÍNH từng món; khoá phòng không phụ thuộc phòng khác ---- */

describe('roomset lượt 3 — mỗi món chỉ nhận mẫu qua ràng buộc cứng của chính nó (dữ liệu thật)', () => {
  const real = (id: string): ModelQuality | undefined => LIBRARY_QUALITY.models[id];
  const am = sceneStyleOf('am-ap');
  const wanted = am.libraryStyles ?? [];
  const libStyles = (LIBRARY as unknown as { models: Record<string, { s: string[] }> }).models;
  const ctx: SetContext = {
    tierOf: (f) => {
      const s = libStyles[f]?.s ?? [];
      const best = Math.min(...wanted.map((c, i) => (s.includes(c) ? i : Infinity)));
      return best !== Infinity ? best : s.length === 0 ? wanted.length : wanted.length + 1;
    },
    tiers: wanted.length,
    dimsOf: (f) => {
      const u = real(f)?.useMm;
      return u === undefined ? undefined : [u[0] / 1000, u[1] / 1000, u[2] / 1000];
    },
    palette: paletteOf(am, 'l'),
    qualityOf: real,
  };
  const pool = (role: string): string[] => (roles[role] ?? []).filter((id) => real(id) !== undefined);

  it('hai giường cùng vai, chỗ khác cỡ, không mẫu chung nào lọt cả hai: giường đủ chăn gối không bị thay bằng giường trần', () => {
    const lib = ['bed-drawers-greywash', 'bed-double-grey-pro'];
    const beds: SetMember[] = [
      { id: 'b1', role: 'doubleBed', short: 1.45, long: 1.95, current: 'bed-drawers-greywash', pool: lib, fixed: false },
      { id: 'b2', role: 'doubleBed', short: 2.0, long: 2.2, current: 'bed-double-grey-pro', pool: lib, fixed: false },
    ];
    const out = roomSetOf('R', beds, new Map(), ctx);
    expect(out.get('b2')?.to).toBe('bed-double-grey-pro');
    expect(out.get('b2')?.rule).toBe('keep');
    // Giường 1: mẫu đủ chăn gối không lọt chỗ 1,45 × 1,95 m → giữ mẫu cũ của chính nó.
    expect(out.get('b1')?.to).toBe('bed-drawers-greywash');
  });

  it('bất biến trên 300 phòng sinh ngẫu nhiên (hạt cố định): mẫu chọn qua ràng buộc cứng của CHÍNH món; không ứng viên → mẫu luật cũ; món ghim không đổi', () => {
    let seed = 12345;
    const rand = (): number => {
      seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
      return seed / 2 ** 32;
    };
    const pickOf = <T>(xs: readonly T[]): T => xs[Math.floor(rand() * xs.length)] as T;
    const ROLES = ['doubleBed', 'nightstand', 'closet', 'dresser', 'sofa', 'armchair', 'coffeeTable', 'diningTable', 'diningChair', 'bookshelf', 'desk'];
    let swaps = 0;
    let checked = 0;
    // Cỡ hiển thị bằng đúng phép co dựng cảnh (`itemFitOf`): thư viện máy chủ giả lấy cỡ `useMm` thật.
    const ids = [...new Set(ROLES.flatMap((role) => pool(role)))];
    registerServerLibrary(ids.map((id) => {
      const [widthMm, heightMm, depthMm] = real(id)?.useMm ?? [1000, 1000, 1000];
      return { id, widthMm, heightMm, depthMm, modelUrl: `https://x.test/${id}.glb` };
    }));
    const CEIL = 2.7;
    try {
    for (let r = 0; r < 300; r += 1) {
      const members: SetMember[] = [];
      for (let i = 0, n = 2 + Math.floor(rand() * 6); i < n; i += 1) {
        const role = pickOf(ROLES);
        const ids = pool(role);
        if (ids.length === 0) continue;
        const current = pickOf(ids);
        const [w, , d] = ctx.dimsOf(current) ?? [1, 1, 1];
        const k = 0.8 + rand() * 0.5;
        const [bw, bd] = [Math.min(w, d) * k, Math.max(w, d) * k];
        members.push({ id: `m${i}`, role, short: bw, long: bd, current, pool: ids, fixed: rand() < 0.15, ceilingM: CEIL, shownOf: (x) => itemFitOf(x, bw, bd, undefined, CEIL * 1000)?.shownM });
      }
      for (const d of roomSetOf(`room-${r}`, members, new Map(), ctx).values()) {
        checked += 1;
        const m = members.find((x) => x.id === d.id) as SetMember;
        if (m.fixed) expect(d).toMatchObject({ cause: 'pinned', to: m.current });
        if (d.cause === 'fallback') expect(d.to).toBe(m.current);
        if (d.cause !== 'selector' && d.cause !== 'same') continue;
        if (d.rule === 'roomset') swaps += 1;
        expect(hardRejectOf(m, d.to as string, ctx)).toBeUndefined();
        // Lượt 6: giường được chọn luôn đủ chăn gối.
        if (m.role === 'doubleBed' || m.role === 'singleBed') expect(real(d.to as string)?.completeness?.v).toBe('full');
        // Vòng 13: mặt bằng HIỂN THỊ nằm trong HỘP chỗ đặt (không theo mẫu cũ), tỉ lệ thật trong dải; cao chừa hở trần.
        const to = m.shownOf?.(d.to as string) as Dims;
        expect(to[0]).toBeLessThanOrEqual(m.short + SHOWN_TOL_M + 1e-9);
        expect(to[2]).toBeLessThanOrEqual(m.long + SHOWN_TOL_M + 1e-9);
        const g = scaleOf(ctx.dimsOf(d.to as string), to) as number;
        expect(g >= SCALE_MIN - 1e-9 && g <= SCALE_MAX + 1e-9).toBe(true);
        expect((to as Dims)[1]).toBeLessThanOrEqual(CEIL - CEILING_GAP_M + 1e-9);
      }
    }
    } finally {
      clearServerLibrary();
    }
    console.info(`bất biến roomset: ${checked} quyết định, ${swaps} lần đổi`);
    expect(swaps).toBeGreaterThan(0);
  });
});

describe('roomSetKeysOf lượt 3 — sửa phòng A không đổi khoá phòng B', () => {
  const box = (x: number, y: number, w: number, h: number): Point[] => [
    { x, y },
    { x: x + w, y },
    { x: x + w, y: y + h },
    { x, y: y + h },
  ];
  const flat = (ids: readonly [string, string], level: string, dx = 0, dy = 0, widenA = 0) => [
    { id: ids[0], levelId: level, usage: 'bedroom', outline: box(dx, dy, 5000 + widenA, 4000) },
    { id: ids[1], levelId: level, usage: 'bedroom', outline: box(dx + 5200, dy, 5000, 4000) },
  ];
  const keysOf = (rooms: ReturnType<typeof flat>): string[] => {
    const keys = roomSetKeysOf(rooms);
    return rooms.map((r) => keys.get(r.id) as string);
  };

  it('hai phòng ngủ 5000×4000 giống hệt: khoá khác nhau; nới phòng A 50 mm → khoá phòng B giữ nguyên', () => {
    const [a, b] = keysOf(flat(['R-a', 'R-b'], 'L-1'));
    expect(a).not.toBe(b);
    const [a2, b2] = keysOf(flat(['R-a', 'R-b'], 'L-1', 0, 0, 50));
    expect(b2).toBe(b);
    expect(a2).not.toBe(a);
  });

  it('chép cả căn sang id khác + tịnh tiến → cùng khoá', () => {
    expect(keysOf(flat(['R-x', 'R-y'], 'L-9', 31_234, -7_777))).toEqual(keysOf(flat(['R-a', 'R-b'], 'L-1')));
  });
});

describe('roomSetKeysOf lượt 4 — biên ô không lật vì nhiễu dấu phẩy động', () => {
  const room = (dx: number, dy: number, w: number, h: number, noise = 0) => ({
    id: 'R-1',
    levelId: 'L-1',
    usage: 'bedroom',
    outline: [
      { x: dx + noise, y: dy - noise },
      { x: dx + w - noise, y: dy + noise },
      { x: dx + w + noise, y: dy + h - noise },
      { x: dx - noise, y: dy + h + noise },
    ],
  });
  const keyOf = (r: ReturnType<typeof room>, other = room(6000, 0, 3000, 3000)): string =>
    roomSetKeysOf([r, { ...other, id: 'R-2' }]).get('R-1') as string;

  it('phòng 4500×4000 tại x=0 (tâm tương đối 2250 mm): tịnh tiến ±0,003 / ±0,4 mm và nhiễu 1e-9 → cùng khoá', () => {
    for (const [w, h] of [[4500, 4000], [4550, 4050], [3000, 2500]] as const) {
      const base = keyOf(room(0, 0, w, h));
      for (const t of [0.003, -0.003, 0.4, -0.4]) {
        // Tịnh tiến CẢ căn (cả phòng làm mốc góc tầng).
        expect(keyOf(room(t, t, w, h), room(6000 + t, t, 3000, 3000))).toBe(base);
      }
      expect(keyOf(room(0, 0, w, h, 1e-9))).toBe(base);
      expect(keyOf(room(0, 0, w, h, -1e-9))).toBe(base);
    }
  });
});

/* ---- Lượt 5: cảnh thật aka3 (probe roomSet) — mẫu cũ bị coi trượt vì co vào hộp nhỏ hơn mặt bằng gốc ---- */

describe('roomset lượt 5 — mẫu đang dùng chỉ "không đạt" về chất lượng (dữ liệu thật, hộp món như aka3)', () => {
  const real = (id: string): ModelQuality | undefined => LIBRARY_QUALITY.models[id];
  const am = sceneStyleOf('am-ap');
  const wanted = am.libraryStyles ?? [];
  const libStyles = (LIBRARY as unknown as { models: Record<string, { s: string[] }> }).models;
  const ctx: SetContext = {
    tierOf: (f) => {
      const s = libStyles[f]?.s ?? [];
      const best = Math.min(...wanted.map((c, i) => (s.includes(c) ? i : Infinity)));
      return best !== Infinity ? best : s.length === 0 ? wanted.length : wanted.length + 1;
    },
    tiers: wanted.length,
    dimsOf: (f) => {
      const u = real(f)?.useMm;
      return u === undefined ? undefined : [u[0] / 1000, u[1] / 1000, u[2] / 1000];
    },
    palette: paletteOf(am, 'l'),
    qualityOf: real,
  };
  const pool = (role: string): string[] => (roles[role] ?? []).filter((id) => real(id) !== undefined);
  /** Hộp món (m) đọc từ `items[].dimensions` của probe aka3: [rộng, cao, sâu]. */
  const boxed = (id: string, role: string, current: string, w: number, d: number): SetMember => ({
    id,
    role,
    short: Math.min(w, d),
    long: Math.max(w, d),
    current,
    pool: pool(role),
    fixed: false,
  });
  const aka3Room = (): SetMember[] => [
    boxed('sofa', 'sofa', 'sofa-grey-linen-slim', 1.22, 1.62),
    boxed('table', 'diningTable', 'dining-table-pro', 1.4, 0.8),
    boxed('commode', 'dresser', 'storage-commode-beige', 1.2, 0.6),
    boxed('shelf', 'bookshelf', 'storage-shelf-metal-oak', 0.9, 0.35),
    ...['c1', 'c2', 'c3', 'c4'].map((id) => boxed(id, 'diningChair', 'dining-chair-pro', 0.45, 0.45)),
  ];

  it('mẫu đang dựng co vào hộp nhỏ hơn mặt bằng gốc (aka3) vẫn lọt chỗ: tỉ lệ thật theo co đều về hộp ≥ SCALE_MIN', () => {
    for (const m of aka3Room().filter((x) => ['sofa', 'table', 'commode', 'c1'].includes(x.id))) {
      expect(m.long).toBeLessThan(Math.max(...(ctx.dimsOf(m.current as string) ?? [0]).filter((_, i) => i !== 1)));
      expect(hardRejectOf(m, m.current as string, ctx)).toBeUndefined();
    }
  });

  it('sofa xám, bàn ăn sồi, ghế ăn, tủ commode: không ra sofa da đen, gỗ tối, ghế uốn đen; ghế quanh bàn một mẫu', () => {
    const out = roomSetOf('aka3', aka3Room(), new Map(), ctx);
    for (const d of out.values()) expect(['sofa-black-leather-2', 'table-dining-dark-wood', 'chair-bentwood-classic', 'storage-dresser-pine']).not.toContain(d.to);
    expect(new Set(['c1', 'c2', 'c3', 'c4'].map((id) => out.get(id)?.to)).size).toBe(1);
    console.info([...out.values()].map((d) => `${d.id}: ${d.from} → ${d.to} [${d.cause}] ${d.why}`).join('\n'));
  });

  it('mẫu luật cũ không có trong dữ liệu chất lượng: không ảnh hưởng — món vẫn lấy mẫu tốt nhất qua ràng buộc cứng', () => {
    const out = roomSetOf('u', [boxed('c', 'diningChair', 'khong-co-trong-du-lieu', 0.5, 0.55)], new Map(), ctx);
    const d = out.get('c');
    expect(d?.cause).toBe('selector');
    expect(d?.fromCost).toBeUndefined();
    // Vai duy nhất là neo: rút trong dải ANCHOR_BAND quanh mẫu rẻ nhất.
    expect(d?.cost as number).toBeLessThanOrEqual((d?.top?.[0]?.[1] ?? 0) + 0.08 + 1e-3);
  });
});

/* ---- Lượt 6: lớp vải tương phản của giường + ứng viên co tới cùng mức mẫu cũ + 5 phong cách (dữ liệu thật) ---- */

describe('roomset lượt 6 — giường nhiều lớp vải, co công bằng, mọi phong cách (dữ liệu thật)', () => {
  const real = (id: string): ModelQuality | undefined => LIBRARY_QUALITY.models[id];
  const libStyles = (LIBRARY as unknown as { models: Record<string, { s: string[] }> }).models;
  const ctxFor = (styleId: SceneStyleId): SetContext => {
    const style = sceneStyleOf(styleId);
    const wanted = style.libraryStyles ?? [];
    return {
      tierOf: (f) => {
        const s = libStyles[f]?.s ?? [];
        const best = Math.min(...wanted.map((c, i) => (s.includes(c) ? i : Infinity)));
        return best !== Infinity ? best : s.length === 0 ? wanted.length : wanted.length + 1;
      },
      tiers: wanted.length,
      dimsOf: (f) => {
        const u = real(f)?.useMm;
        return u === undefined ? undefined : [u[0] / 1000, u[1] / 1000, u[2] / 1000];
      },
      palette: paletteOf(style, styleId === 'go-am' || styleId === 'sang-trong-toi' ? 'd' : 'l'),
      qualityOf: real,
    };
  };
  const pool = (role: string): string[] => (roles[role] ?? []).filter((id) => real(id) !== undefined);
  const boxed = (id: string, role: string, current: string, w: number, d: number): SetMember => ({
    id,
    role,
    short: Math.min(w, d),
    long: Math.max(w, d),
    current,
    pool: pool(role),
    fixed: false,
  });
  /** Căn mẫu theo hộp món thật (sun1/f17/aka3 lượt 4): khách + ăn + 2 ngủ (hộp giường AI dò nhỏ hơn mẫu). */
  const flat = (): [string, SetMember[]][] => [
    ['living', [boxed('sofa', 'sofa', 'sofa-grey-linen-slim', 1.22, 1.62), boxed('arm', 'armchair', 'chair-lenestol-oak-black', 0.74, 0.78), boxed('coffee', 'coffeeTable', 'table-coffee-white-oval', 0.9, 0.5), boxed('shelf', 'bookshelf', 'storage-shelf-metal-oak', 0.9, 0.35)]],
    ['dining', [boxed('table', 'diningTable', 'dining-table-pro', 1.4, 0.8), ...['c1', 'c2', 'c3', 'c4'].map((id) => boxed(id, 'diningChair', 'dining-chair-pro', 0.45, 0.45))]],
    ['bed1', [boxed('b1', 'doubleBed', 'bed-white-oak-headboard', 1.3, 1.94), boxed('w1', 'closet', 'storage-wardrobe-greywash', 1.2, 0.6), boxed('d1', 'dresser', 'storage-commode-beige', 1.2, 0.6)]],
    ['bed2', [boxed('b2', 'doubleBed', 'bed-white-oak-headboard', 1.55, 1.62), boxed('w2', 'closet', 'storage-wardrobe-greywash', 1.2, 0.6)]],
  ];

  it('đo lớp vải: bed-white-oak-headboard một cụm (trắng trên trắng), bed-double-oak-pro hai cụm', () => {
    expect(layersOf(real('bed-white-oak-headboard')?.parts ?? []).layers).toBe(1);
    expect(layersOf(real('bed-double-oak-pro')?.parts ?? []).layers).toBe(2);
  });

  it('giường AI dò hộp 1,30 × 1,94 m (mẫu 1,71 × 2,14 m co đều 0,83 ≥ SCALE_MIN): chọn giường full ≥ 2 lớp vải', () => {
    const ctx = ctxFor('am-ap');
    const m = boxed('b', 'doubleBed', 'bed-white-oak-headboard', 1.3, 1.94);
    expect(hardRejectOf(m, 'bed-double-oak-pro', ctx)).toBeUndefined();
    const d = roomSetOf('bed', [m], new Map(), ctx).get('b');
    expect(d?.rule).toBe('roomset');
    expect(real(d?.to ?? '')?.completeness?.v).toBe('full');
    expect(layersOf(real(d?.to ?? '')?.parts ?? []).layers ?? 0).toBeGreaterThanOrEqual(2);
  });

  it('5 phong cách: bộ chọn chạy, mọi lần đổi giữ bất biến; phòng sáng không nhận món ngồi tối đậm', () => {
    const lines: string[] = [];
    for (const styleId of SCENE_STYLE_IDS) {
      const ctx = ctxFor(styleId);
      const byRole: Record<string, [number, number]> = {};
      for (const [key, ms] of flat())
        for (const d of roomSetOf(`${styleId}|${key}`, ms, new Map(), ctx).values()) {
          const cell = (byRole[d.role] ??= [0, 0]);
          cell[d.rule === 'roomset' ? 0 : 1] += 1;
          if (d.cause === 'fallback' || d.cause === 'pinned') continue;
          const m = ms.find((x) => x.id === d.id) as SetMember;
          expect(hardRejectOf(m, d.to as string, ctx)).toBeUndefined();
          const dark = (real(d.to as string)?.parts ?? []).reduce((s, p) => s + (p.lab[0] < DARK_L ? p.share : 0), 0);
          if (ctx.palette.light !== false && ['sofa', 'armchair', 'diningChair'].includes(d.role)) expect(dark).toBeLessThan(DARK_SEAT_SHARE);
        }
      lines.push(`${styleId.padEnd(15)} ${Object.entries(byRole).map(([r, [c, k]]) => `${r} ${c}/${c + k}`).join(' · ')}`);
    }
    console.info(`roomset 5 phong cách (đổi/tổng theo vai):\n${lines.join('\n')}`);
  });
});

/* ---- Lượt 7: gương (giới hạn bộ dựng hình), sàn cỡ vai ghế bành, món cao không cao thêm / không chạm trần ---- */

describe('roomset lượt 7', () => {
  const wardrobe = (mirror: number, dark = 0): ModelQuality => ({
    ...qual('closet', { frame: OAK }),
    parts: [
      { kind: 'frame', share: 1 - mirror - dark, lab: OAK, material: 'wood', kindBy: 'm' },
      ...(mirror > 0 ? [{ kind: 'other' as const, share: mirror, lab: [85, 0, 0] as const, material: 'glass' as const, kindBy: 'm' as const, finish: 'mirror' }] : []),
      ...(dark > 0 ? [{ kind: 'other' as const, share: dark, lab: [5, 0, 0] as const, kindBy: 'm' as const }] : []),
    ] as QualityPart[],
  });
  const closetDims: Dims = [1.2, 1.9, 0.6];

  it('gương 20 % (finish mirror) thua tủ gỗ cùng tông có 28 % phần tối; tủ gỗ không gương thắng cả hai', () => {
    const table = { old: wardrobe(0, 0.28), mirror: wardrobe(0.2), plain: wardrobe(0) };
    const ctx = ctxOf(table, { old: closetDims, mirror: closetDims, plain: closetDims });
    const m = (pool: string[]): SetMember => member('w', 'closet', 'x', pool, { short: 0.6, long: 1.2 });
    expect(roomSetOf('R', [m(['mirror', 'old'])], new Map(), ctx).get('w')?.to).toBe('old');
    expect(roomSetOf('R', [m(['mirror', 'old', 'plain'])], new Map(), ctx).get('w')?.to).toBe('plain');
  });

  it('món cao: chuẩn cao (heightMm, không thì trung vị pool vai) ≥ 2,0 m thì ứng viên không cao hơn chuẩn; có trần thì chừa khoảng hở', () => {
    const table = { old: wardrobe(0), taller: wardrobe(0), lower: wardrobe(0) };
    const ctx = ctxOf(table, { old: [1.2, 2.05, 0.6], taller: [1.2, 2.2, 0.6], lower: [1.2, 1.95, 0.6] });
    // Trung vị pool [1,95; 2,05; 2,2] = 2,05 ≥ TALL_M.
    const m = member('w', 'closet', 'old', ['taller', 'lower', 'old'], { short: 0.6, long: 1.2 });
    expect(hardRejectOf(m, 'taller', ctx)).toBe('cao hơn chuẩn vai');
    expect(hardRejectOf(m, 'lower', ctx)).toBeUndefined();
    expect(hardRejectOf({ ...m, ceilingM: 2.2 }, 'lower', ctx)).toBe('chạm gần trần');
  });

  it('dữ liệu thật: ghế bành không nhận mẫu cạnh ngắn dưới p10 vai (mẫu tên ghế ăn 541–559 mm) ở cả 5 phong cách', () => {
    const real = (id: string): ModelQuality | undefined => LIBRARY_QUALITY.models[id];
    const pool = (roles.armchair ?? []).filter((id) => real(id) !== undefined);
    for (const styleId of SCENE_STYLE_IDS) {
      const style = sceneStyleOf(styleId);
      const ctx: SetContext = {
        tierOf: () => 0,
        tiers: (style.libraryStyles ?? []).length,
        dimsOf: (f) => {
          const u = real(f)?.useMm;
          return u === undefined ? undefined : [u[0] / 1000, u[1] / 1000, u[2] / 1000];
        },
        palette: paletteOf(style, styleId === 'go-am' || styleId === 'sang-trong-toi' ? 'd' : 'l'),
        qualityOf: real,
      };
      const m: SetMember = { id: 'a', role: 'armchair', short: 0.74, long: 0.78, current: 'chair-lenestol-oak-black', pool, fixed: false };
      expect(hardRejectOf(m, 'chair-dining-wood-woven', ctx)).toBe('nhỏ hơn cỡ vai');
      const to = roomSetOf(styleId, [m], new Map(), ctx).get('a')?.to as string;
      const u = real(to)?.useMm ?? [0, 0, 0];
      expect(Math.min(u[0], u[2])).toBeGreaterThanOrEqual(600);
    }
  });
});

/* ---- Lượt 8: trần phòng thật (chiều cao tầng dựng tường) qua toPascalScene ---- */

describe('roomset — trần phòng lấy từ chiều cao tầng (toPascalScene)', () => {
  const WARD = 'F-00000000WARD1';
  const closets = (roles.closet ?? []).slice(0, 3) as [string, string, string];
  const graphAt = (levelMm: number): SpatialGraph => {
    const g = graphWith();
    return {
      ...g,
      levels: g.levels.map((l) => ({ ...l, heightMm: levelMm })),
      // Không `heightMm` đã lưu: cao hiển thị theo mẫu (có `heightMm` thì mọi mẫu hiện đúng cao ấy — xem test Codex #1).
      furniture: [...g.furniture, piece(WARD, 'wardrobe', 1000, 600, 4300, 3500)],
    } as SpatialGraph;
  };
  let current = '';
  let tall = '';
  let low = '';
  beforeAll(() => {
    const reg = (h: (id: string) => number) =>
      registerServerLibrary(closets.map((id) => ({ id, widthMm: 1000, heightMm: h(id), depthMm: 600, modelUrl: `https://x.test/${id}.glb` })));
    reg(() => 1900);
    current = assetOf(sceneOf(graphAt(3000), OFF), WARD);
    [tall, low] = closets.filter((id) => id !== current) as [string, string];
    // Trung vị pool 1,90 m (dưới TALL_M: tới ×1,15 = 2,185 m); ứng viên cao 2,15 m (chi phí 0) và 1,90 m (gỗ lệch tông);
    // mẫu luật cũ 1,80 m có lỗi QC.
    reg((id) => (id === tall ? 2150 : id === low ? 1900 : 1800));
    Q.clear();
    Q.set(current, qual('closet', { frame: OAK, issues: ['test'] }));
    Q.set(tall, qual('closet', { frame: [67, 5, 22] }));
    Q.set(low, qual('closet', { frame: [48, 12, 30] }));
  });
  afterAll(() => {
    clearServerLibrary();
    Q.clear();
  });

  it('trần 3,0 m nhận tủ 2,15 m; trần 2,4 m (hở 0,3 m → tối đa 2,1 m) không nhận tủ ấy', () => {
    expect(assetOf(sceneOf(graphAt(3000), ON), WARD)).toBe(tall);
    // Trần 2,4 m: tủ 2,15 m bị loại "chạm gần trần" → tủ còn lại.
    expect(assetOf(sceneOf(graphAt(2400), ON), WARD)).not.toBe(tall);
    expect(roomSetReport()[ROOM]?.items.find((d) => d.id === WARD)?.to).not.toBe(tall);
  });
});

/* ---- Lượt 8 (Codex review 4 #3): mẫu ghim dùng chung phải nằm trong tập ứng viên của món nhận ---- */

describe('roomset lượt 8 — mẫu dùng chung qua đúng bộ lọc ứng viên của món nhận', () => {
  it('sofa sinh hộp 800×2000 không nhận sofa ghim 2000×800 mà bộ lọc hướng của nó đã loại', () => {
    const table = {
      pinned: qual('sofa', { fabric: GREY }),
      own: qual('sofa', { fabric: GREY }),
    };
    const ctx = ctxOf(table, { pinned: [2, 0.8, 0.8], own: [0.8, 0.8, 2], old: [0.8, 0.8, 2] });
    const out = roomSetOf(
      'R',
      [
        member('F-sofa', 'sofa', 'pinned', [], { fixed: true, short: 0.8, long: 2 }),
        // Bộ lọc của món nhận (setPoolOf: QC/hướng) chỉ để lại `own`.
        member('DRESS-sofa', 'sofa', 'old', ['own'], { short: 0.8, long: 2 }),
      ],
      new Map(),
      ctx,
    );
    expect(hardRejectOf(member('x', 'sofa', 'pinned', [], { short: 0.8, long: 2 }), 'pinned', ctx)).toBeUndefined();
    expect(out.get('DRESS-sofa')?.to).not.toBe('pinned');
    expect(out.get('DRESS-sofa')?.to).toBe('own');
  });
});

/* ---- Lượt 9 (Codex review 4 #1, #4): ràng buộc trên cỡ HIỂN THỊ bằng đúng phép co dựng cảnh ---- */

describe('roomset lượt 9 — cỡ hiển thị (itemFitOf)', () => {
  const ids = ['fit-old', 'fit-new', 'fit-tall'];
  beforeAll(() => {
    const dims: Record<string, [number, number, number]> = { 'fit-old': [500, 800, 500], 'fit-new': [500, 800, 1000], 'fit-tall': [1000, 1900, 600] };
    registerServerLibrary(ids.map((id) => {
      const [widthMm, heightMm, depthMm] = dims[id] as [number, number, number];
      return { id, widthMm, heightMm, depthMm, modelUrl: `https://x.test/${id}.glb` };
    }));
  });
  afterAll(() => clearServerLibrary());
  const ctx = ctxOf(
    { 'fit-old': qual('dresser', { frame: OAK }), 'fit-new': qual('dresser', { frame: OAK }), 'fit-tall': qual('closet', { frame: OAK }) },
    { 'fit-old': [0.5, 0.8, 0.5], 'fit-new': [0.5, 0.8, 1.0], 'fit-tall': [1.0, 1.9, 0.6] },
  );

  it('#4 (vòng 13): hộp 500×1000 mm — mẫu thay hiện sâu đủ 1 m (lớn hơn mẫu cũ) vẫn đạt vì nằm trong hộp; vượt hộp thì loại', () => {
    const shownOf = (x: string) => itemFitOf(x, 0.5, 1.0, undefined, 2700)?.shownM;
    expect((shownOf('fit-old') as Dims)[2]).toBeLessThan(0.95);
    expect((shownOf('fit-new') as Dims)[2]).toBeCloseTo(1.0, 6);
    const box = { cx: 0, cy: 0, w: 0.5, d: 1.0, rot: 0 };
    expect(hardRejectOf(member('d', 'dresser', 'fit-old', ['fit-new'], { short: 0.5, long: 1.0, shownOf, box }), 'fit-new', ctx)).toBeUndefined();
    const tight = { ...box, d: 0.9 };
    expect(hardRejectOf(member('d', 'dresser', 'fit-old', ['fit-new'], { short: 0.5, long: 1.0, shownOf, box: tight }), 'fit-new', ctx)).toBe('vượt hộp chỗ đặt');
  });

  it('#1: tủ catalog 1,9 m, `heightMm` đã lưu 2300, trần 2,4 m → hiển thị 2,3 m, loại "chạm gần trần"', () => {
    const shownOf = (x: string) => itemFitOf(x, 1.0, 0.6, 2300, 2400)?.shownM;
    expect((shownOf('fit-tall') as Dims)[1]).toBeCloseTo(2.3, 6);
    const m = member('w', 'closet', 'fit-tall', ['fit-tall'], { short: 0.6, long: 1.0, ceilingM: 2.4, heightM: 2.3, shownOf });
    expect(hardRejectOf(m, 'fit-tall', ctx)).toBe('chạm gần trần');
  });
});

/* ---- Lượt 10: bật mặc định — phong cách concept thiếu `wall` không làm vỡ bảng màu ---- */
describe('roomset lượt 10', () => {
  it('paletteOf: phong cách thiếu wall / wall.interior (concept AI lúc chạy) → không tường, không lỗi', () => {
    const base = sceneStyleOf('am-ap');
    expect(paletteOf({ ...base, wall: undefined } as unknown as typeof base, 'l')).toEqual({ tone: 'l', light: true });
    expect(paletteOf({ ...base, wall: {} } as unknown as typeof base, 'd')).toEqual({ tone: 'd', light: false });
  });
});
