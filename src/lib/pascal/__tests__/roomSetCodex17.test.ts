/**
 * Codex M17-1 (#2, #3, #4, #6, #7) — phương án cuối không trả mẫu cấm, mẫu dựng sẵn qua cùng kiểm va chạm/trần, vai trung
 * tính không ra mẫu giường, concept bị loại không góp màu, cỡ thật chọn mẫu nhỏ nhất trong dải hợp bộ.
 */
import { describe, expect, it } from 'vitest';

import type { Furniture } from '@/domain/spatial/types';
import { degrees, millimetres } from '@/domain/units/types';

import type { ModelQuality, PartMaterial, QualityPart } from '../libraryQuality';
import { FAIL_COST, roomSetOf, SHARE_BAND, type Dims, type SetContext, type SetMember, type SetZone } from '../roomSet';
import { SCENE_STYLES } from '../sceneStyles';
import { contextRolesOf, modelFolderOf, roleOf, roomSetReport, type LayerStyle } from '../sceneVariety';

type L = readonly [number, number, number];
const part = (kind: QualityPart['kind'], share: number, lab: L, material?: PartMaterial): QualityPart =>
  ({ kind, share, lab, ...(material === undefined ? {} : { material }), kindBy: 'm' }) as QualityPart;
const q = (role: string, parts: QualityPart[], extra: Record<string, unknown> = {}): ModelQuality =>
  ({
    role,
    useMm: [1000, 1000, 1000],
    front: { axis: '+z', check: 'ok' },
    parts,
    completeness: { v: 'full', by: 'm' },
    detail: { tris: 1, kb: 1, textures: 0, maxTex: 0, tier: 'light' },
    licence: 'CC0',
    source: 'test',
    ...extra,
  }) as unknown as ModelQuality;
const GREY: L = [60, 0, -2];
const Q: Record<string, ModelQuality> = {
  'sofa-qc': q('sofa', [part('upholstery', 1, GREY, 'fabric')], { issues: ['hole'] }),
  'sofa-broken': q('sofa', [part('upholstery', 1, GREY, 'fabric')], { texture: { v: 'broken', by: 'i' } }),
  'sofa-ok': q('sofa', [part('upholstery', 1, GREY, 'fabric')]),
  'sofa-big': q('sofa', [part('upholstery', 1, [86, 0, 4], 'fabric')]),
  'sofa-small': q('sofa', [part('upholstery', 1, [70, 0, 4], 'fabric')]),
  'sofa-small-off': q('sofa', [part('upholstery', 1, [40, 45, 40], 'fabric')]),
  'a-sofa-grey': q('sofa', [part('upholstery', 1, GREY, 'fabric')]),
  'b-sofa-cream': q('sofa', [part('upholstery', 0.71, [86, -1, 1], 'fabric'), part('upholstery', 0.29, [77, 2, 27], 'fabric')]),
  oak: q('diningTable', [part('top', 1, [77, 10, 33], 'wood')]),
  'tbl-grey': q('diningTable', [part('top', 1, GREY, 'fabric')]),
  'a-arm-grey': q('armchair', [part('upholstery', 1, GREY, 'fabric')]),
  'b-arm-tan': q('armchair', [part('upholstery', 1, [77, 10, 33], 'fabric')]),
};
const DIMS: Record<string, Dims> = {
  'sofa-qc': [2.0, 0.85, 0.9],
  'sofa-broken': [2.0, 0.85, 0.9],
  'sofa-ok': [2.0, 0.85, 0.9],
  'sofa-old': [1.5, 0.85, 0.85],
  sofa: [2.0, 0.8, 0.85],
  'sofa-tall': [2.0, 0.95, 0.85],
  'sofa-big': [2.4, 0.85, 1.0],
  'sofa-small': [1.5, 0.85, 0.8],
  'sofa-small-off': [1.4, 0.85, 0.8],
  'a-sofa-grey': [2.0, 0.85, 0.9],
  'b-sofa-cream': [2.0, 0.85, 0.9],
  oak: [0.8, 0.75, 0.8],
  'tbl-grey': [0.8, 0.75, 0.8],
  'a-arm-grey': [0.8, 0.85, 0.8],
  'b-arm-tan': [0.8, 0.85, 0.8],
};
const ctx: SetContext = { tierOf: () => 0, tiers: 5, dimsOf: (id) => DIMS[id], palette: {}, qualityOf: (id) => Q[id] };
const mem = (id: string, role: string, pool: string[], extra: Partial<SetMember> = {}): SetMember => ({
  id,
  role,
  short: 3,
  long: 3,
  current: pool[0] ?? null,
  pool,
  fixed: false,
  ...extra,
});
const BOX = { cx: 0, cy: 0, w: 2, d: 0.85, rot: 0 };
/** Toàn phòng bị chặn: không cỡ thật nào đặt được → đi tới luật cũ / mẫu dựng sẵn. */
const ALL: SetZone = { cx: 0, cy: 0, w: 9, d: 9, rotationDeg: 0 };

describe('#2 — phương án cuối không bao giờ trả mẫu cấm', () => {
  it('luật cũ có lỗi QC, không mẫu dựng sẵn → null, sổ ghi lý do (không trả mẫu QC)', () => {
    const m = mem('s', 'sofa', [], { current: 'sofa-qc', box: BOX, shownOf: (f) => DIMS[f] });
    const d = roomSetOf('r', [m], new Map(), ctx, [ALL]).get('s');
    expect(d?.to).toBeNull();
    expect(d?.why).toMatch(/bị cấm \(có lỗi QC\)/);
  });

  it('luật cũ vân vỡ → mẫu dựng sẵn khi nó đặt được, không thì null', () => {
    const m = mem('s', 'sofa', [], { current: 'sofa-broken', stock: 'sofa', box: BOX, shownOf: (f) => DIMS[f] });
    expect(roomSetOf('r', [m], new Map(), ctx).get('s')?.to).toBe('sofa');
    const d = roomSetOf('r', [m], new Map(), ctx, [ALL]).get('s');
    expect(d?.to).toBeNull();
    expect(d?.why).toMatch(/vân vỡ/);
  });

  it('luật cũ chạm trần (kể độ nâng) bị che bởi lý do hình dáng vẫn bị cấm', () => {
    // Hiện vượt hộp (lý do đầu của hardRejectOf) nhưng cao 0,85 + nâng 0,2 > trần 1,3 − 0,3.
    const m = mem('s', 'sofa', [], { current: 'sofa-ok', box: { ...BOX, w: 1.5 }, ceilingM: 1.3, liftM: 0.2, shownOf: (f) => DIMS[f] });
    const d = roomSetOf('r', [m], new Map(), ctx, [ALL]).get('s');
    expect(d?.to).toBeNull();
    expect(d?.why).toMatch(/chạm gần trần/);
  });

  it('luật cũ ngoài công năng (sofa hiện rộng 1,0 m) → null, sổ ghi ngoài công năng', () => {
    const m = mem('s', 'sofa', [], { current: 'sofa-ok', box: BOX, shownOf: () => [1.0, 0.85, 0.85] });
    const d = roomSetOf('r', [m], new Map(), ctx, [ALL]).get('s');
    expect(d?.to).toBeNull();
    expect(d?.why).toMatch(/ngoài công năng/);
  });
});

describe('#4 — mẫu dựng sẵn qua cùng kiểm va chạm và hở trần', () => {
  // Luật cũ hẹp 1,5 m (thiếu dữ liệu chất lượng → thử mẫu dựng sẵn) ở giữa hộp 2 m; vật cản x ∈ [0,8; 1,5].
  const post: SetZone = { cx: 1.15, cy: 0, w: 0.7, d: 2, rotationDeg: 0 };
  const base = mem('s', 'sofa', [], { current: 'sofa-old', stock: 'sofa', box: BOX, shownOf: (f) => DIMS[f] });

  it('tiền đề: không vật cản → mẫu dựng sẵn', () => {
    expect(roomSetOf('r', [base], new Map(), ctx).get('s')?.to).toBe('sofa');
  });

  it('mẫu dựng sẵn rộng 2 m chồng vật cản → không nhận, giữ luật cũ hẹp không chồng', () => {
    const d = roomSetOf('r', [base], new Map(), ctx, [post]).get('s');
    expect(d?.to).toBe('sofa-old');
  });

  it('mẫu dựng sẵn chạm trần → không nhận', () => {
    // Trần 1,2 − 0,3 = 0,9 m: luật cũ cao 0,85 qua, mẫu dựng sẵn cao 0,95 không.
    const m = { ...base, stock: 'sofa-tall', ceilingM: 1.2 };
    expect(roomSetOf('r', [m], new Map(), ctx).get('s')?.to).toBe('sofa-old');
  });
});

describe('#6 — concept bị loại không góp màu; `to: null` đã quyết không hồi sinh concept', () => {
  // Bàn ăn không có ứng viên; concept mặt xám (cùng màu sofa xám) đặt trong hộp chồng vật cản → concept trượt "va chạm".
  const tableBox = { cx: 5, cy: 5, w: 0.8, d: 0.8, rot: 0 };
  const block: SetZone = { cx: 5, cy: 5, w: 1, d: 1, rotationDeg: 0 };
  const table = (concept: boolean): SetMember =>
    mem('table', 'diningTable', [], { current: null, box: tableBox, ...(concept ? { concept: { folder: 'tbl-grey' } } : {}) });
  const sofa = mem('sofa', 'sofa', ['a-sofa-grey', 'b-sofa-cream']);
  const arm = mem('arm', 'armchair', ['a-arm-grey', 'b-arm-tan']);

  it('tiền đề: concept bàn được nhận → đổi chi phí sofa', () => {
    const accepted = roomSetOf('r', [sofa, table(true)], new Map(), ctx);
    const none = roomSetOf('r', [sofa, table(false)], new Map(), ctx);
    expect(accepted.get('table')?.cause).toBe('concept');
    expect(accepted.get('sofa')?.top).not.toEqual(none.get('sofa')?.top);
  });

  it('concept bàn trượt va chạm → sofa (chốt trước bàn) như khi không có concept', () => {
    const rejected = roomSetOf('r', [sofa, table(true)], new Map(), ctx, [block]);
    const none = roomSetOf('r', [sofa, table(false)], new Map(), ctx, [block]);
    expect(rejected.get('table')?.cause).not.toBe('concept');
    expect(rejected.get('sofa')).toMatchObject({ to: none.get('sofa')?.to, top: none.get('sofa')?.top });
  });

  it('bàn đã quyết `to: null` → ghế bành (chốt sau bàn) không thấy concept của bàn', () => {
    const rejected = roomSetOf('r', [sofa, table(true), arm], new Map(), ctx, [block]);
    const none = roomSetOf('r', [sofa, table(false), arm], new Map(), ctx, [block]);
    expect(rejected.get('table')?.to).toBeNull();
    expect(rejected.get('arm')).toMatchObject({ to: none.get('arm')?.to, top: none.get('arm')?.top });
  });
});

describe(`#7 — cỡ thật: dải SHARE_BAND (${SHARE_BAND}) quanh chi phí tốt nhất, rồi mẫu NHỎ NHẤT`, () => {
  // Hộp 0,5 × 0,5 m: mọi mẫu khớp thường đều méo/vượt → phương án cuối cỡ thật.
  const box = { cx: 0, cy: 0, w: 0.5, d: 0.5, rot: 0 };
  const shown = (): Dims => [0.5, 0.85, 0.5];
  const run = (pool: string[]) => roomSetOf('r', [mem('s', 'sofa', pool, { current: null, box, shownOf: shown })], new Map(), ctx).get('s');
  const ref = mem('wall', 'sofa', [], { current: 'b-sofa-cream', fixed: true });
  const runSet = (pool: string[]) =>
    roomSetOf('r', [ref, mem('s', 'sofa', pool, { current: null, box: { ...box, cx: 3 }, shownOf: shown })], new Map(), ctx).get('s');

  it('mẫu to hợp bộ hơn chút không thắng mẫu nhỏ trong dải', () => {
    const d = runSet(['sofa-big', 'sofa-small']);
    const big = runSet(['sofa-big']);
    const small = runSet(['sofa-small']);
    // Tiền đề: mẫu to rẻ hơn, chênh trong dải.
    expect(big?.to).toBe('sofa-big');
    expect(small?.to).toBe('sofa-small');
    expect(d).toMatchObject({ to: 'sofa-small', uniform: 'real', cause: 'fallback' });
    expect(run(['sofa-big', 'sofa-small'])?.to).toBe('sofa-small');
  });

  it('mẫu nhỏ lạc tông ngoài dải không thắng', () => {
    const d = runSet(['sofa-big', 'sofa-small-off']);
    expect(d?.to).toBe('sofa-big');
    expect(FAIL_COST).toBeGreaterThan(SHARE_BAND);
  });
});

describe('#3 — vai trung tính không ra mẫu giường (mọi đường mẫu theo vai hiệu lực)', () => {
  const bed: Furniture = {
    id: 'F-x',
    levelId: 'L-1',
    roomId: 'R-x',
    kind: 'bed',
    variant: 'bed',
    centre: { x: millimetres(400), y: millimetres(400) },
    boundingBox: { min: { x: millimetres(0), y: millimetres(0) }, max: { x: millimetres(800), y: millimetres(800) } },
    rotationDeg: degrees(0),
    confidence: 0.8,
    source: 'ai',
    reviewed: false,
  } as Furniture;
  const BEDS = ['double-bed', 'single-bed'];

  it('giường AI 0,8 × 0,8 m variant giường trong phòng khách: vai bench, luật cũ không ra double-bed', () => {
    expect(roleOf(bed, 'livingRoom')).toBe('bench');
    const off: LayerStyle = { ...SCENE_STYLES['am-ap'], roomSet: false };
    expect(BEDS).not.toContain(modelFolderOf(bed, off, 'livingRoom'));
  });

  it('bộ chọn bật: sổ ghi bench, mẫu dựng (kể `from` luật cũ) không phải giường', () => {
    const on: LayerStyle = { ...SCENE_STYLES['am-ap'], roomSet: true };
    contextRolesOf([bed], () => 'livingRoom');
    const got = modelFolderOf(bed, on, 'livingRoom');
    const entry = roomSetReport()['R-x']?.items.find((d) => d.id === bed.id);
    expect(entry?.role).toBe('bench');
    expect(BEDS).not.toContain(got);
    expect(BEDS).not.toContain(entry?.from);
  });
});

describe('Codex M17-2 #1, #2 — luật cũ / mẫu dựng sẵn ở phương án cuối', () => {
  it('#1: luật cũ chồng vùng chặn → null, sổ ghi va chạm (không vùng chặn → giữ luật cũ)', () => {
    const m = mem('s', 'sofa', [], { current: 'sofa-old', box: BOX, shownOf: (f) => DIMS[f] });
    expect(roomSetOf('r', [m], new Map(), ctx).get('s')?.to).toBe('sofa-old');
    const d = roomSetOf('r', [m], new Map(), ctx, [ALL]).get('s');
    expect(d?.to).toBeNull();
    expect(d?.why).toMatch(/bị cấm \(va chạm\)/);
  });

  it('#1: cỡ người dùng xác nhận — hộp đã chồng vùng chặn, luật cũ trong hộp không chồng thêm → giữ luật cũ', () => {
    const m = mem('s', 'sofa', [], { current: 'sofa-old', box: BOX, sizeFrom: 'user', shownOf: (f) => DIMS[f] });
    expect(roomSetOf('r', [m], new Map(), ctx, [ALL]).get('s')?.to).toBe('sofa-old');
  });

  it('#1: luật cũ chồng vùng chặn nhưng mẫu dựng sẵn hẹp không chồng → mẫu dựng sẵn', () => {
    // Vật cản x ∈ [0,8; 1,5]: luật cũ rộng 2 m chồng, mẫu dựng sẵn rộng 1,5 m (x ∈ [−0,75; 0,75]) không.
    const post: SetZone = { cx: 1.15, cy: 0, w: 0.7, d: 2, rotationDeg: 0 };
    const m = mem('s', 'sofa', [], { current: 'sofa', stock: 'sofa-old', box: BOX, shownOf: (f) => DIMS[f] });
    const d = roomSetOf('r', [m], new Map(), ctx, [post]).get('s');
    expect(d?.to).toBe('sofa-old');
    expect(d?.why).toMatch(/luật cũ trượt \(va chạm\)/);
  });

  // Tủ áo AI chưa xác nhận cao 2,4 m (cao hiển thị = heightM), nâng 0,5 m, trần 2,7 m: 2,9 m > 2,7 − 0,3.
  const closetDims: Record<string, Dims> = { 'closet-old': [1.2, 2.0, 0.6], 'closet-stock': [1.2, 2.2, 0.6] };
  const cctx: SetContext = { ...ctx, dimsOf: (id) => closetDims[id] };
  const closet = (sizeFrom: 'ai' | 'user'): SetMember =>
    mem('c', 'closet', [], {
      current: 'closet-old',
      stock: 'closet-stock',
      box: { cx: 0, cy: 0, w: 1.2, d: 0.6, rot: 0 },
      heightM: 2.4,
      liftM: 0.5,
      ceilingM: 2.7,
      sizeFrom,
      shownOf: (f) => (closetDims[f] === undefined ? undefined : [closetDims[f][0], 2.4, closetDims[f][2]]),
    });

  it('#2: món AI chưa xác nhận có heightM rõ → luật cũ và mẫu dựng sẵn vượt trần đều bị cấm → null', () => {
    const d = roomSetOf('r', [closet('ai')], new Map(), cctx).get('c');
    expect(d?.to).toBeNull();
    expect(d?.why).toMatch(/chạm gần trần/);
  });

  it('#2: cỡ người dùng xác nhận được miễn kiểm trần → vẫn dựng (không null)', () => {
    expect(roomSetOf('r', [closet('user')], new Map(), cctx).get('c')?.to).not.toBeNull();
  });
});

describe('Điều phối M17-2 — null chỉ vì va chạm / ngoài công năng → mẫu dựng sẵn CỠ THẬT (cờ forced)', () => {
  it('luật cũ chồng vùng chặn, có mẫu dựng sẵn → mẫu dựng sẵn cỡ thật dù va chạm, cause fallback + forced', () => {
    const m = mem('s', 'sofa', [], { current: 'sofa-old', stock: 'sofa', box: BOX, shownOf: (f) => DIMS[f] });
    const d = roomSetOf('r', [m], new Map(), ctx, [ALL]).get('s');
    expect(d).toMatchObject({ to: 'sofa', uniform: 'real', cause: 'fallback', forced: 'va chạm' });
    expect(d?.why).toMatch(/cỡ thật dù va chạm/);
  });

  it('không mẫu luật cũ → mẫu dựng sẵn cỡ thật (forced ghi "không mẫu luật cũ")', () => {
    const m = mem('s', 'sofa', [], { current: null, stock: 'sofa', box: BOX, shownOf: (f) => DIMS[f] });
    expect(roomSetOf('r', [m], new Map(), ctx, [ALL]).get('s')).toMatchObject({ to: 'sofa', uniform: 'real', forced: expect.stringContaining('không mẫu luật cũ') });
  });

  it('mẫu dựng sẵn cỡ thật vượt trần → vẫn null (trần không được bỏ qua)', () => {
    // Trần 1,2 − 0,3 = 0,9: luật cũ cao 0,85 qua trần nhưng va chạm; mẫu dựng sẵn cao 0,95 không.
    const m = mem('s', 'sofa', [], { current: 'sofa-old', stock: 'sofa-tall', box: BOX, ceilingM: 1.2, shownOf: (f) => DIMS[f] });
    expect(roomSetOf('r', [m], new Map(), ctx, [ALL]).get('s')?.to).toBeNull();
  });

  it('lý do an toàn/chất lượng (có lỗi QC) → null dù có mẫu dựng sẵn; người dùng xác nhận không dựng cỡ thật', () => {
    const qc = mem('s', 'sofa', [], { current: 'sofa-qc', stock: 'sofa', box: BOX, shownOf: (f) => DIMS[f] });
    expect(roomSetOf('r', [qc], new Map(), ctx, [ALL]).get('s')?.to).toBeNull();
    const user = mem('s', 'sofa', [], { current: null, stock: 'sofa', box: BOX, sizeFrom: 'user', shownOf: (f) => DIMS[f] });
    expect(roomSetOf('r', [user], new Map(), ctx, [ALL]).get('s')?.uniform).not.toBe('real');
  });
});
