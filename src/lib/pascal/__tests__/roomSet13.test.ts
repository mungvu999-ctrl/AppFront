/**
 * Vòng 13 — luật CHUNG mới của bộ chọn: cỡ theo hộp chỗ đặt (không theo mẫu cũ), tỉ lệ thật, độ sáng theo đồ đã có trong
 * phòng (kể cả đồ trắng), màu lạnh là màu nhấn, va chạm cả phòng. Id mẫu thật chỉ để dựng lại ca xấu vòng 12.
 */
import { describe, expect, it } from 'vitest';

import { LIBRARY_QUALITY, type ModelQuality, type QualityPart } from '../libraryQuality';
import {
  CONTRAST_TOL,
  hardRejectOf,
  layersOf,
  tintedOf,
  paletteOf,
  planRectOf,
  roomSetOf,
  SCALE_MAX,
  scaleOf,
  type Dims,
  type SetContext,
  type SetMember,
} from '../roomSet';
import { sceneStyleOf } from '../sceneStyles';

type Lab = readonly [number, number, number];
const part = (kind: QualityPart['kind'], share: number, lab: Lab, material?: QualityPart['material']): QualityPart => ({
  kind,
  share,
  lab,
  kindBy: 'm',
  ...(material === undefined ? {} : { material }),
});
const qual = (role: string, parts: QualityPart[], extra: Partial<ModelQuality> = {}): ModelQuality => ({
  role,
  useMm: [1000, 1000, 1000],
  front: { axis: '+z', check: 'ok', by: 'import' },
  parts,
  detail: { tris: 1, kb: 1, textures: 0, maxTex: 0, tier: 'light' },
  licence: 'CC0',
  source: 'test',
  ...extra,
});
const ctxOf = (table: Record<string, ModelQuality>, dims: Record<string, Dims>, light = true): SetContext => ({
  tierOf: () => 0,
  tiers: 3,
  dimsOf: (id) => dims[id],
  palette: { light, tone: 'l' },
  qualityOf: (id) => table[id],
});
/** Món có hộp; cỡ hiển thị = co đều mẫu vào hộp (đủ cho test thuần). */
const boxed = (id: string, role: string, current: string | null, pool: string[], box: { cx: number; cy: number; w: number; d: number; rot?: number }, dims: Record<string, Dims>, extra: Partial<SetMember> = {}): SetMember => ({
  id,
  role,
  short: Math.min(box.w, box.d),
  long: Math.max(box.w, box.d),
  current,
  pool,
  fixed: false,
  box: { rot: 0, ...box },
  shownOf: (x) => {
    const m = dims[x];
    if (m === undefined) return undefined;
    const k = Math.min(box.w / m[0], box.d / m[2]);
    return [m[0] * k, m[1], m[2] * k];
  },
  ...extra,
});
const FULL = { completeness: { v: 'full' as const, by: 'i' as const } };

describe('vòng 13 — cỡ theo hộp và tỉ lệ thật', () => {
  it('ứng viên LỚN hơn mẫu cũ nhưng trong hộp được nhận; mẫu phải co dưới SCALE_MIN bị loại "sai tỉ lệ thật"', () => {
    const table = { old: qual('diningChair', [part('frame', 1, [62, 8, 24], 'wood')]), fill: qual('diningChair', [part('frame', 1, [62, 8, 24], 'wood')]), tiny: qual('diningChair', [part('frame', 1, [62, 8, 24], 'wood')]) };
    const dims: Record<string, Dims> = { old: [0.4, 0.8, 0.4], fill: [0.46, 0.8, 0.5], tiny: [0.28, 0.5, 0.3] };
    const m = boxed('c', 'diningChair', 'old', ['fill', 'tiny'], { cx: 0, cy: 0, w: 0.46, d: 0.5 }, dims);
    const ctx = ctxOf(table, dims);
    expect(hardRejectOf(m, 'fill', ctx)).toBeUndefined();
    // Ghế đồ chơi 0,28 m phải phóng 1,5 lần mới đầy hộp → sai cỡ đồ thật.
    expect((scaleOf(dims.tiny, m.shownOf?.('tiny')) as number) > SCALE_MAX).toBe(true);
    expect(hardRejectOf(m, 'tiny', ctx)).toBe('sai tỉ lệ thật');
  });

  it('phạt tỉ lệ: mẫu cũ phải co mạnh trong hộp thua mẫu vừa hộp tự nhiên cùng màu', () => {
    const wood = [part('frame', 1, [62, 8, 24], 'wood')];
    const table = { shrunk: qual('dresser', wood), natural: qual('dresser', wood) };
    const dims: Record<string, Dims> = { shrunk: [1.3, 0.8, 0.62], natural: [1.0, 0.8, 0.48] };
    const m = boxed('d', 'dresser', 'shrunk', ['natural', 'shrunk'], { cx: 0, cy: 0, w: 1.0, d: 0.48 }, dims);
    const d = roomSetOf('R', [m], new Map(), ctxOf(table, dims)).get('d');
    expect(d?.to).toBe('natural');
    expect((d?.fromCost as number) - (d?.cost as number)).toBeGreaterThan(0.25);
  });
});

describe('vòng 13 — đồ có sẵn màu trắng tham gia độ sáng/tương phản', () => {
  it('tab đầu giường trắng cố định: giường khung sáng thắng giường khung gỗ tối cùng lớp chăn gối', () => {
    const bedding = [part('bedding', 0.3, [92, 0, 2], 'fabric'), part('bedding', 0.2, [70, 2, 12], 'fabric')];
    const table: Record<string, ModelQuality> = {
      white: qual('nightstand', [part('frame', 1, [98, 0, 0], 'plastic')]),
      darkBed: qual('doubleBed', [part('frame', 0.5, [36, 9, 16], 'wood'), ...bedding], FULL),
      lightBed: qual('doubleBed', [part('frame', 0.5, [80, 3, 10], 'wood'), ...bedding], FULL),
    };
    const dims: Record<string, Dims> = { white: [0.45, 0.55, 0.4], darkBed: [1.6, 1, 2], lightBed: [1.6, 1, 2] };
    const ns = boxed('ns', 'nightstand', 'white', [], { cx: -1.1, cy: 0, w: 0.45, d: 0.4 }, dims, { fixed: true });
    const bed = boxed('bed', 'doubleBed', 'darkBed', ['darkBed', 'lightBed'], { cx: 0, cy: 0, w: 1.6, d: 2 }, dims);
    expect(roomSetOf('R', [ns, bed], new Map(), ctxOf(table, dims)).get('bed')?.to).toBe('lightBed');
    // Không có đồ cố định nào: hai giường ngang nhau về độ sáng (không có tham chiếu) → luật cũ (tông gỗ căn) quyết định.
    const alone = roomSetOf('R', [bed], new Map(), ctxOf(table, dims)).get('bed');
    expect(alone?.to).toBeDefined();
  });

  it(`tương phản dưới CONTRAST_TOL (${CONTRAST_TOL}) không phạt: gỗ sáng cạnh đồ trắng vẫn hợp`, () => {
    const table: Record<string, ModelQuality> = {
      white: qual('nightstand', [part('frame', 1, [98, 0, 0], 'plastic')]),
      oak: qual('dresser', [part('frame', 1, [78, 5, 20], 'wood')]),
    };
    const dims: Record<string, Dims> = { white: [0.45, 0.55, 0.4], oak: [1, 0.8, 0.5] };
    const ns = boxed('ns', 'nightstand', 'white', [], { cx: -2, cy: 0, w: 0.45, d: 0.4 }, dims, { fixed: true });
    const dr = boxed('dr', 'dresser', 'oak', ['oak'], { cx: 0, cy: 0, w: 1, d: 0.5 }, dims);
    expect(roomSetOf('R', [ns, dr], new Map(), ctxOf(table, dims)).get('dr')?.fromCost as number).toBeLessThan(0.01);
  });
});

describe('vòng 13 — tấm phủ xanh xám là trung tính (bằng chứng chấm mù)', () => {
  it('chăn xanh xám C* 12 không thành họ nhấn: phòng đã có ghế vàng mù tạt vẫn giữ giường có tấm phủ', () => {
    const teal: Lab = [40, -6, -10];
    const table: Record<string, ModelQuality> = {
      mustard: qual('armchair', [part('upholstery', 1, [60, 8, 45], 'fabric')]),
      tealBed: qual('doubleBed', [part('frame', 0.5, [70, 4, 18], 'wood'), part('bedding', 0.25, teal, 'fabric'), part('bedding', 0.25, [92, 0, 1], 'fabric')], FULL),
    };
    const dims: Record<string, Dims> = { mustard: [0.7, 0.8, 0.7], tealBed: [1.6, 1, 2] };
    const arm = boxed('arm', 'armchair', 'mustard', [], { cx: 2, cy: 0, w: 0.7, d: 0.7 }, dims, { fixed: true });
    const bed = boxed('bed', 'doubleBed', 'tealBed', ['tealBed'], { cx: 0, cy: 0, w: 1.6, d: 2 }, dims);
    const with_ = roomSetOf('R', [arm, bed], new Map(), ctxOf(table, dims)).get('bed');
    const without = roomSetOf('R', [bed], new Map(), ctxOf(table, dims)).get('bed');
    expect(with_?.cost).toBeCloseTo(without?.cost as number, 6);
  });
});

describe('vòng 13 — va chạm cả phòng sau khi chọn', () => {
  it('đổi làm mặt bằng hiển thị chồng vật cản nhiều hơn mẫu cũ → trả mẫu cũ, lý do "va chạm cả phòng"', () => {
    const table = { slim: qual('bookshelf', [part('frame', 1, [28, 10, 14], 'wood')]), wide: qual('bookshelf', [part('frame', 1, [75, 4, 15], 'wood')]) };
    // Hộp AI dò (chưa xác nhận) 1,2 × 0,4 m; mẫu cũ hiện 0,8 m; mẫu mới hiện đủ 1,2 m và đè lên tủ lạnh sát cạnh.
    const dims: Record<string, Dims> = { slim: [0.8, 1.8, 0.4], wide: [1.2, 1.8, 0.4] };
    const m = boxed('s', 'bookshelf', 'slim', ['wide'], { cx: 0, cy: 0, w: 1.2, d: 0.4 }, dims, { sizeFrom: 'ai' });
    const ctx = ctxOf(table, dims);
    // Không vật cản: được đổi (mẫu cũ không phải trần cỡ).
    const free = roomSetOf('R', [m], new Map(), { ...ctx, palette: { light: true, tone: 'l' } }).get('s');
    expect(free?.to).toBe('wide');
    const fridge = planRectOf(0.775, 0, 0.65, 0.6, 0);
    const d = roomSetOf('R', [m], new Map(), ctx, [fridge]).get('s');
    expect(d).toMatchObject({ to: 'slim', rule: 'keep' });
    expect(d?.why).toContain('va chạm cả phòng');
  });

  // Codex review 1 #1: so với mặt bằng GỐC của từng cặp, không với mẫu CUỐI của món kia.
  it('hai món cùng đổi: từng món riêng không tăng chồng so với mẫu cuối của món kia, nhưng cả cặp chồng mới → trả về', () => {
    const table = { oldW: qual('bookshelf', [part('frame', 1, [28, 10, 14], 'wood')]), newW: qual('bookshelf', [part('frame', 1, [75, 4, 15], 'wood')]) };
    const dims: Record<string, Dims> = { oldW: [1.6, 1.8, 1.0], newW: [1.0, 1.8, 1.6] };
    const ctx = { ...ctxOf(table, dims), palette: { light: true, tone: 'l' as const } };
    const a = boxed('a', 'bookshelf', 'oldW', ['newW'], { cx: 0, cy: 0, w: 1.6, d: 1.6 }, dims, { sizeFrom: 'ai' });
    const b = boxed('b', 'bookshelf', 'oldW', ['newW'], { cx: 0.9, cy: 1.2, w: 1.6, d: 1.6 }, dims, { sizeFrom: 'ai' });
    expect(roomSetOf('R', [a], new Map(), ctx).get('a')?.to).toBe('newW');
    const out = roomSetOf('R', [a, b], new Map(), ctx);
    // Gốc: không chồng. Cả hai đổi: chồng 0,04 m². Kết quả phải không chồng mới.
    expect([out.get('a')?.to, out.get('b')?.to]).not.toEqual(['newW', 'newW']);
    expect(out.get('a')?.why).toContain('va chạm cả phòng');
  });

  // Codex review 1 #2: diện tích chung của hình XOAY, không của hộp thẳng trục bao ngoài.
  it('kệ xoay 45° song song với vật cản, cách nhau quá nửa sâu hai bên: không chạm thật → được đổi dù hộp bao chồng', () => {
    const table = { slim: qual('bookshelf', [part('frame', 1, [28, 10, 14], 'wood')]), wide: qual('bookshelf', [part('frame', 1, [75, 4, 15], 'wood')]) };
    const dims: Record<string, Dims> = { slim: [0.8, 1.8, 0.4], wide: [1.2, 1.8, 0.4] };
    const ctx = { ...ctxOf(table, dims), palette: { light: true, tone: 'l' as const } };
    const m = boxed('s', 'bookshelf', 'slim', ['wide'], { cx: 0, cy: 0, w: 1.2, d: 0.4, rot: 45 }, dims, { sizeFrom: 'ai' });
    // Lệch 0,5 m theo trục sâu riêng (−sin45°, cos45°) — lớn hơn 0,2 + 0,2.
    const shelf = planRectOf(-0.5 * Math.SQRT1_2, 0.5 * Math.SQRT1_2, 1.2, 0.4, 45);
    expect(roomSetOf('R', [m], new Map(), ctx, [shelf]).get('s')?.to).toBe('wide');
  });

  // Codex review 2 #2: món trong bộ nhưng NÂNG khỏi sàn (kệ treo) không tính va chạm mặt sàn.
  it('kệ treo cố định phía trên chỗ món đổi: không chặn đổi; cùng kệ đứng sàn thì chặn', () => {
    const table = { slim: qual('bookshelf', [part('frame', 1, [28, 10, 14], 'wood')]), wide: qual('bookshelf', [part('frame', 1, [75, 4, 15], 'wood')]) };
    const dims: Record<string, Dims> = { slim: [0.8, 1.8, 0.4], wide: [1.2, 1.8, 0.4] };
    const ctx = { ...ctxOf(table, dims), palette: { light: true, tone: 'l' as const } };
    const m = boxed('s', 'bookshelf', 'slim', ['wide'], { cx: 0, cy: 0, w: 1.2, d: 0.4 }, dims, { sizeFrom: 'ai' });
    const wall = (lifted: boolean): SetMember => boxed('w', 'cabinet', 'wide', [], { cx: 0.7, cy: 0, w: 0.5, d: 0.4 }, dims, { fixed: true, ...(lifted ? { lifted: true } : {}) });
    expect(roomSetOf('R', [m, wall(true)], new Map(), ctx).get('s')?.to).toBe('wide');
    expect(roomSetOf('R', [m, wall(false)], new Map(), ctx).get('s')?.to).toBe('slim');
  });
});

describe('vòng 13 — ca xấu vòng 12 trên dữ liệu thật (căn người dùng đã sửa, phòng ngủ)', () => {
  const real = (id: string): ModelQuality | undefined => LIBRARY_QUALITY.models[id];
  const dimsOf = (id: string): Dims | undefined => {
    const u = real(id)?.useMm;
    return u === undefined ? undefined : [u[0] / 1000, u[1] / 1000, u[2] / 1000];
  };
  const am = sceneStyleOf('am-ap');
  const ctx: SetContext = { tierOf: () => 0, tiers: 3, dimsOf, palette: paletteOf(am, 'l'), qualityOf: real };

  it('tab đầu giường TRẮNG cố định làm tăng chi phí giường khung gỗ trung bình so với khi không có nó', () => {
    const d = dimsOf('bed-double-oak-pro') as Dims;
    const bed = { id: 'bed', role: 'doubleBed', short: d[0], long: d[2], current: 'bed-double-grey-pro2', pool: ['bed-double-oak-pro'], fixed: false } satisfies SetMember;
    const white = { id: 'ns', role: 'nightstand', short: 0.36, long: 0.4, current: 'storage-nightstand-white-3d', pool: [], fixed: true } satisfies SetMember;
    const withWhite = roomSetOf('R', [white, bed], new Map(), ctx).get('bed');
    const without = roomSetOf('R', [bed], new Map(), ctx).get('bed');
    const costOfPick = (x: typeof without): number => (x?.rule === 'roomset' ? (x.cost as number) : Number.parseFloat(/tốt nhất ([0-9.]+)/.exec(x?.why ?? '')?.[1] ?? 'NaN'));
    expect(costOfPick(withWhite)).toBeGreaterThan(costOfPick(without));
  });
});

describe('vòng 13 — lớp vải chỉ đếm lớp trên nệm', () => {
  it('đầu giường bọc xám + chăn trắng một màu = MỘT lớp; chăn hai màu = hai lớp; không có phần bedding → đếm như cũ', () => {
    const head = part('upholstery', 0.52, [58, 0, -1], 'fabric');
    expect(layersOf([head, part('bedding', 0.35, [89, 0, 0], 'fabric'), part('upholstery', 0.09, [93, 0, 0], 'fabric')]).layers).toBe(1);
    expect(layersOf([head, part('bedding', 0.3, [89, 0, 0], 'fabric'), part('bedding', 0.18, [45, -6, -10], 'fabric')]).layers).toBe(2);
    expect(layersOf([head, part('upholstery', 0.3, [89, 0, 0], 'fabric')]).layers).toBe(2);
  });
});

describe('vòng 13 — mẫu chung của nhóm vượt trần của một món', () => {
  it('phòng hai giường: mẫu chung (rẻ nhất trung bình) quá trần với giường hộp hẹp → giường đó chấm riêng, không giữ giường trần', () => {
    const bedding = [part('frame', 0.4, [70, 4, 18], 'wood'), part('bedding', 0.3, [88, 0, 1], 'fabric'), part('bedding', 0.3, [60, 0, 2], 'fabric')];
    const table = {
      bare: qual('doubleBed', [part('frame', 0.4, [70, 4, 18], 'wood'), part('bedding', 0.6, [88, 0, 1], 'fabric')], { completeness: { v: 'partial', by: 'i' } }),
      A: qual('doubleBed', bedding, FULL),
      B: qual('doubleBed', bedding, FULL),
    };
    const dims: Record<string, Dims> = { bare: [1.4, 1, 2.0], A: [1.6, 1, 2.0], B: [1.4, 1, 1.75] };
    // Phong cách quyết định chi phí: A hạng 80/100, B hạng 88/100 (cùng phần, cùng màu).
    const ctx: SetContext = { ...ctxOf(table, dims), tierOf: (x) => (x === 'A' ? 80 : x === 'B' ? 88 : 0), tiers: 99 };
    const wide = boxed('b1', 'doubleBed', 'bare', ['A', 'B'], { cx: 0, cy: 0, w: 1.6, d: 2.0 }, dims, { sizeFrom: 'generated' });
    const narrow = boxed('b2', 'doubleBed', 'bare', ['A', 'B'], { cx: 3, cy: 0, w: 1.6, d: 1.75 }, dims, { sizeFrom: 'generated' });
    const out = roomSetOf('R', [wide, narrow], new Map(), ctx);
    expect(out.get('b1')?.to).toBe('A');
    // A trong hộp sâu 1,75 m co 0,875 → +|ln 0,875| ≈ 0,13 → quá trần 0,9; B vừa hộp, dưới trần. Trung bình A < B → mẫu chung A.
    expect(out.get('b2')).toMatchObject({ to: 'B', rule: 'roomset' });
  });
});

describe('vòng 13 — dải neo không rút trúng ứng viên quá trần (Codex lượt 3)', () => {
  it('giường cũ chưa đủ, mẫu ghim cùng vai B quá trần, A dưới trần trong cùng dải: mọi khoá phòng đều ra A', () => {
    const bedding = [part('frame', 0.4, [70, 4, 18], 'wood'), part('bedding', 0.3, [88, 0, 1], 'fabric'), part('bedding', 0.3, [60, 0, 2], 'fabric')];
    const table = {
      bare: qual('doubleBed', [part('frame', 0.4, [70, 4, 18], 'wood'), part('bedding', 0.6, [88, 0, 1], 'fabric')], { completeness: { v: 'partial', by: 'i' } }),
      A: qual('doubleBed', bedding, FULL),
      B: qual('doubleBed', bedding, FULL),
    };
    const dims: Record<string, Dims> = { bare: [1.6, 1, 2.0], A: [1.6, 1, 2.0], B: [1.6, 1, 2.0] };
    const ctx: SetContext = { ...ctxOf(table, dims), tierOf: (x) => (x === 'A' ? 86 : x === 'B' ? 93 : 0), tiers: 99 };
    const pinned = boxed('p', 'doubleBed', 'B', [], { cx: 5, cy: 0, w: 1.6, d: 2.0 }, dims, { fixed: true });
    for (const key of ['R0', 'R1', 'R2', 'R3', 'R4', 'R5', 'R6', 'R7']) {
      const m = boxed('b', 'doubleBed', 'bare', ['A', 'B'], { cx: 0, cy: 0, w: 1.6, d: 2.0 }, dims, { sizeFrom: 'generated' });
      expect(roomSetOf(key, [pinned, m], new Map(), ctx).get('b')?.to).toBe('A');
    }
  });
});

describe('vòng 13 — lớp phủ màu dịu trên nền chăn trung tính', () => {
  const real = (id: string) => LIBRARY_QUALITY.models[id]?.parts ?? [];
  it('dữ liệu thật: oak-pro (phủ xanh xám) có; chăn trắng trơn và bộ lanh một tông be không', () => {
    expect(tintedOf(real('bed-double-oak-pro'))).toBe(true);
    expect(tintedOf(real('bed-double-white-duvet-light-oak-headboard'))).toBe(false);
    expect(tintedOf(real('bed-double-linen-pro2'))).toBe(false);
  });

  it('hai giường đủ chăn gối hoà điểm: giường có lớp phủ màu dịu thay giường chăn trơn (hơn ≥ MIN_GAIN)', () => {
    const frame = part('frame', 0.4, [70, 4, 18], 'wood');
    const table = {
      plain: qual('doubleBed', [frame, part('bedding', 0.3, [65, 0, 0], 'fabric'), part('bedding', 0.3, [100, 0, 0], 'fabric')], FULL),
      tinted: qual('doubleBed', [frame, part('bedding', 0.3, [76, 0, 0], 'fabric'), part('bedding', 0.3, [40, -6, -10], 'fabric')], FULL),
    };
    const dims: Record<string, Dims> = { plain: [1.6, 1, 2.0], tinted: [1.6, 1, 2.0] };
    const m = boxed('b', 'doubleBed', 'plain', ['plain', 'tinted'], { cx: 0, cy: 0, w: 1.6, d: 2.0 }, dims, { sizeFrom: 'generated' });
    expect(roomSetOf('R', [m], new Map(), ctxOf(table, dims)).get('b')).toMatchObject({ to: 'tinted', rule: 'roomset' });
  });
});
