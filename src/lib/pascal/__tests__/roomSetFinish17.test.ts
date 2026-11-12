/**
 * Vòng 17 làn I2 — bảng màu neo có nền phòng (gỗ + tường), phương án cuối áp lưng tường, mẫu dựng sẵn của vai khi luật cũ
 * trượt, vai `bench` không ép băng dài vào hộp 0,81 × 0,86 m.
 */
import { describe, expect, it } from 'vitest';

import type { ModelQuality, QualityPart } from '../libraryQuality';
import { roomSetOf, type Dims, type SetContext, type SetMember, type SetZone } from '../roomSet';

type L = readonly [number, number, number];
const part = (kind: QualityPart['kind'], share: number, lab: L, material?: QualityPart['material']): QualityPart =>
  ({ kind, share, lab, ...(material === undefined ? {} : { material }), kindBy: 'm' }) as QualityPart;
const q = (role: string, parts: QualityPart[]): ModelQuality =>
  ({
    role,
    useMm: [1000, 1000, 1000],
    front: { axis: '+z', check: 'ok' },
    parts,
    completeness: { v: 'full', by: 'm' },
    detail: { tris: 1, kb: 1, textures: 0, maxTex: 0, tier: 'light' },
    licence: 'CC0',
    source: 'test',
  }) as unknown as ModelQuality;

const Q: Record<string, ModelQuality> = {
  'a-sofa-grey-leather': q('sofa', [part('upholstery', 1, [55, 0, -2], 'leather')]),
  'b-sofa-cream': q('sofa', [part('upholstery', 1, [86, 0, 4], 'fabric')]),
  'c-sofa-grey': q('sofa', [part('upholstery', 1, [58, 0, 0], 'fabric')]),
  'sofa-deep': q('sofa', [part('upholstery', 1, [80, 0, 5], 'fabric')]),
  'bench-long': q('bench', [part('frame', 1, [60, 8, 25], 'wood')]),
  ottoman: q('bench', [part('upholstery', 1, [80, 0, 5], 'fabric')]),
};
const DIMS: Record<string, Dims> = {
  'a-sofa-grey-leather': [2.0, 0.85, 0.9],
  'b-sofa-cream': [2.0, 0.85, 0.9],
  'c-sofa-grey': [2.0, 0.85, 0.9],
  'sofa-deep': [2.0, 0.85, 0.9],
  'sofa-old': [2.0, 0.85, 0.9],
  sofa: [2.0, 0.8, 0.85],
  'bench-long': [1.5, 0.45, 0.45],
  ottoman: [0.5, 0.42, 0.5],
};
const ctxOf = (wall?: L): SetContext => ({
  tierOf: () => 0,
  tiers: 5,
  dimsOf: (id) => DIMS[id],
  palette: wall === undefined ? {} : { wall, light: true },
  qualityOf: (id) => Q[id],
});
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
/** Phép khớp kéo giãn đúng hộp (méo khi dáng mẫu khác hộp) — đủ để đẩy pool ra phương án cuối. */
const stretch =
  (w: number, d: number) =>
  (f: string): Dims | undefined => {
    const x = DIMS[f];
    return x === undefined ? undefined : [w, x[1], d];
  };

describe('I2 — bảng màu neo có nền phòng', () => {
  it('neo sofa khi phòng chưa chốt gì: tường sáng làm bảng màu → không rút trúng sofa xám trong dải', () => {
    // Không tường: bảng màu chỉ có gỗ tông căn — mọi sofa vải/da cùng chi phí, dải neo rút băm.
    const pool = ['a-sofa-grey-leather', 'b-sofa-cream', 'c-sofa-grey'];
    for (const key of ['r1', 'r2', 'r3', 'r4', 'r5']) {
      const d = roomSetOf(key, [mem('s', 'sofa', pool)], new Map(), ctxOf([90, 0, 3])).get('s');
      expect(d?.to).toBe('b-sofa-cream');
    }
  });
});

describe('I2 — phương án cuối', () => {
  it('cỡ thật áp lưng tường: sofa sâu 0,9 trong hộp sâu 0,6 sát tường vẫn đặt được (canh tâm thì xuyên tường)', () => {
    // Hộp tâm (0,0), sâu 0,6: mép sau y = −0,3; thân tường y ∈ [−0,5; −0,3].
    const wall: SetZone = { cx: 0, cy: -0.4, w: 4, d: 0.2, rotationDeg: 0 };
    const m = mem('s', 'sofa', ['sofa-deep'], { current: null, box: { cx: 0, cy: 0, w: 2, d: 0.6, rot: 0 }, shownOf: stretch(1.0, 0.6) });
    const d = roomSetOf('r', [m], new Map(), ctxOf(), [wall]).get('s');
    expect(d?.to).toBe('sofa-deep');
    expect(d?.uniform).toBe('real');
  });

  it('cỡ thật xoay 180°: lưng là phía +y', () => {
    const wall: SetZone = { cx: 0, cy: 0.4, w: 4, d: 0.2, rotationDeg: 0 };
    const m = mem('s', 'sofa', ['sofa-deep'], { current: null, box: { cx: 0, cy: 0, w: 2, d: 0.6, rot: 180 }, shownOf: stretch(1.0, 0.6) });
    expect(roomSetOf('r', [m], new Map(), ctxOf(), [wall]).get('s')?.uniform).toBe('real');
  });

  it('luật cũ méo dáng, không cỡ thật nào đặt được → mẫu dựng sẵn của vai (không méo, trong công năng)', () => {
    // Codex M17-1 #4 (đổi có chủ đích): mẫu dựng sẵn cũng qua kiểm va chạm — vật cản chỉ chặn phần cỡ thật nhô ra trước hộp
    // (y > 0,425), không chặn mặt bằng trong hộp (cũ: khối 6 × 6 m phủ cả hộp).
    const block: SetZone = { cx: 0, cy: 0.715, w: 6, d: 0.57, rotationDeg: 0 };
    const m = mem('s', 'sofa', ['sofa-deep'], {
      current: 'sofa-old',
      stock: 'sofa',
      box: { cx: 0, cy: 0, w: 2, d: 0.85, rot: 0 },
      shownOf: (f) => (f === 'sofa' ? DIMS.sofa : [1.0, 0.85, 0.85]),
    });
    const d = roomSetOf('r', [m], new Map(), ctxOf(), [block]).get('s');
    expect(d?.to).toBe('sofa');
    expect(d?.why).toMatch(/mẫu dựng sẵn/);
  });

  it('mẫu dựng sẵn cũng méo → giữ luật cũ (méo dáng là ngoại lệ được phép), sổ ghi luật cũ trượt', () => {
    // Codex M17-2 #1 (đổi có chủ đích): luật cũ cũng qua kiểm va chạm — vật cản chỉ chặn phần cỡ thật rộng 2 m nhô ra
    // (x > 0,75), không chặn luật cũ rộng 1,4 m (cũ: khối 6 × 6 m phủ cả hộp, nay luật cũ bị chặn → null).
    const block: SetZone = { cx: 1.9, cy: 0, w: 2.3, d: 6, rotationDeg: 0 };
    // Codex M17-1 #2 (đổi có chủ đích): luật cũ phải trong công năng mới được giữ — méo (1,4 × 1,0 từ 2,0 × 0,9) nhưng rộng
    // 1,4, sâu 1,0 trong phạm vi sofa (cũ: rộng 1,0 ngoài công năng mà vẫn giữ).
    const m = mem('s', 'sofa', ['sofa-deep'], { current: 'sofa-old', stock: 'sofa', box: { cx: 0, cy: 0, w: 2, d: 0.85, rot: 0 }, shownOf: () => [1.4, 0.85, 1.0] });
    const d = roomSetOf('r', [m], new Map(), ctxOf(), [block]).get('s');
    expect(d?.to).toBe('sofa-old');
    expect(d?.why).toMatch(/luật cũ trượt/);
  });

  it('luật cũ ngoài công năng, mẫu dựng sẵn méo ở cỡ hiển thị → mẫu dựng sẵn CỠ THẬT dù va chạm (cờ forced), không giữ luật cũ', () => {
    // Điều phối M17-2 (đổi có chủ đích): null chỉ vì va chạm / ngoài công năng → mẫu dựng sẵn cỡ thật (cũ: null).
    const block: SetZone = { cx: 0, cy: 0, w: 6, d: 6, rotationDeg: 0 };
    const m = mem('s', 'sofa', ['sofa-deep'], { current: 'sofa-old', stock: 'sofa', box: { cx: 0, cy: 0, w: 2, d: 0.85, rot: 0 }, shownOf: () => [1.0, 0.85, 0.85] });
    const d = roomSetOf('r', [m], new Map(), ctxOf(), [block]).get('s');
    expect(d).toMatchObject({ to: 'sofa', uniform: 'real', cause: 'fallback' });
    expect(d?.forced).toMatch(/ngoài công năng.*va chạm/);
    expect(d?.why).toMatch(/ngoài công năng/);
  });
});

describe('F6 — tầng cưỡng bức thử mẫu thư viện trước mẫu dựng sẵn', () => {
  it('hộp AI tự chồng đồ đạc, cỡ thật không chồng thêm: chọn mẫu thư viện của vai ở cỡ thật (forced), không mẫu dựng sẵn', () => {
    // R2 cn08: sofa trượt công năng → cũ: luôn mẫu dựng sẵn (vân nhoè, lạc bộ). Vùng đồ đạc trùng đúng hộp (boxHit = 1,7 m²).
    const sofaZone: SetZone = { cx: 0, cy: 0, w: 2.2, d: 0.85, rotationDeg: 0, kind: 'table' };
    const m = mem('s', 'sofa', ['sofa-deep'], { current: 'sofa-old', stock: 'sofa', box: { cx: 0, cy: 0, w: 2, d: 0.85, rot: 0 }, shownOf: () => [1.0, 0.85, 0.85] });
    const d = roomSetOf('r', [m], new Map(), ctxOf(), [sofaZone]).get('s');
    expect(d).toMatchObject({ to: 'sofa-deep', uniform: 'real', cause: 'fallback' });
    expect(d?.forced).toMatch(/ngoài công năng/);
  });

  it('F7: cỡ thật chồng thêm đồ đạc ngoài hộp → ẩn (null), không đè', () => {
    const wide: SetZone = { cx: 0, cy: 0, w: 6, d: 6, rotationDeg: 0, kind: 'table' };
    const m = mem('s', 'sofa', ['sofa-deep'], { current: 'sofa-old', stock: 'sofa', box: { cx: 0, cy: 0, w: 1.8, d: 0.6, rot: 0 }, shownOf: () => [1.0, 0.6, 0.6] });
    expect(roomSetOf('r', [m], new Map(), ctxOf(), [wide]).get('s')?.to).toBeNull();
  });

  it('cỡ thật mẫu thư viện đè tường nhưng mẫu dựng sẵn không → vẫn mẫu dựng sẵn', () => {
    // Tường sát mép sau hộp (y ≤ −0,425): sofa-deep sâu 0,9 áp lưng không đè; tường hai bên x > 1,0 chặn bề rộng 2,0 + 0,0.
    const wall: SetZone = { cx: 0, cy: 0, w: 6, d: 6, rotationDeg: 0 };
    const m = mem('s', 'sofa', ['sofa-deep'], { current: 'sofa-old', stock: 'sofa', box: { cx: 0, cy: 0, w: 2, d: 0.85, rot: 0 }, shownOf: () => [1.0, 0.85, 0.85] });
    expect(roomSetOf('r', [m], new Map(), ctxOf(), [wall]).get('s')?.to).toBe('sofa');
  });
});

describe('F8 — không mẫu nào của vai vừa hộp → mẫu nhỏ hơn cùng nhóm đồ chứa', () => {
  const QS: Record<string, ModelQuality> = {
    'wardrobe-wide': q('closet', [part('frame', 1, [90, 0, 3], 'wood')]),
    'shelf-tall': q('bookshelf', [part('frame', 1, [60, 8, 25], 'wood')]),
    'nightstand-a': q('nightstand', [part('frame', 1, [60, 8, 25], 'wood')]),
  };
  const DS: Record<string, Dims> = { 'wardrobe-wide': [0.86, 2.0, 0.6], 'shelf-tall': [0.6, 1.8, 0.35], 'nightstand-a': [0.34, 0.55, 0.35], closet: [1.2, 2.0, 0.6] };
  const ctx8: SetContext = { tierOf: () => 0, tiers: 5, dimsOf: (id) => DS[id], palette: {}, qualityOf: (id) => QS[id] };
  // R2–R4 s4pn: hộp tủ áo AI 0,41 × 0,45 m — tủ áo nhỏ nhất rộng 0,86 m (vượt 0,45 > 0,4) → cũ: ẩn món.
  const box = { cx: 0, cy: 0, w: 0.41, d: 0.45, rot: 0 };
  const closet = (extra: Partial<SetMember> = {}): SetMember =>
    mem('w', 'closet', ['wardrobe-wide'], { current: null, stock: 'closet', box, shownOf: () => [0.41, 2.0, 0.45], smaller: [{ role: 'bookshelf', pool: ['shelf-tall'] }], ...extra });

  it('tủ áo không vừa → kệ cao cỡ thật, sổ ghi vai bookshelf', () => {
    const d = roomSetOf('r', [closet()], new Map(), ctx8, []).get('w');
    expect(d).toMatchObject({ to: 'shelf-tall', uniform: 'real', role: 'bookshelf', cause: 'fallback' });
  });

  it('không có nhóm nhỏ hơn → vẫn ẩn (null) như cũ', () => {
    expect(roomSetOf('r', [closet({ smaller: [] })], new Map(), ctx8, []).get('w')?.to).toBeNull();
  });

  it('mẫu nhỏ hơn cũng chồng thêm đồ đạc → ẩn, không đè', () => {
    const sofa: SetZone = { cx: 0, cy: 0, w: 3, d: 3, rotationDeg: 0, kind: 'sofa' };
    // Hộp tự chồng sofa 0,18 m², kệ cỡ thật chồng 0,21 m² → không nhận.
    expect(roomSetOf('r', [closet()], new Map(), ctx8, [sofa]).get('w')?.to).toBeNull();
  });
});

describe('Codex M17-9 P2 — ngân sách đồ đạc tách khỏi tường ở tầng cưỡng bức', () => {
  it('cỡ thật bớt chồng tường nhưng chồng thêm đồ đạc → không nhận (ẩn)', () => {
    // Hộp 2,4 × 0,6 tâm (0,0) chồng tường bên x ∈ [1,0; 1,4] (0,24 m²); sofa cỡ thật rộng 2,0 không chạm tường nhưng sâu 0,9
    // chồng bàn (kind) y ∈ [0,5; 0,6] 0,2 m² ≤ 0,24 — luật gộp cũ nhận (đổi chồng tường lấy chồng đồ), luật tách không nhận.
    const wall: SetZone = { cx: 1.2, cy: 0, w: 0.4, d: 3, rotationDeg: 0 };
    const table: SetZone = { cx: 0, cy: 0.55, w: 2, d: 0.1, rotationDeg: 0, kind: 'table' };
    const m = mem('s', 'sofa', ['sofa-deep'], { current: 'sofa-old', stock: 'sofa', box: { cx: 0, cy: 0, w: 2.4, d: 0.6, rot: 0 }, shownOf: () => [1.0, 0.6, 0.6] });
    expect(roomSetOf('r', [m], new Map(), ctxOf(), [wall, table]).get('s')?.to).toBeNull();
  });
});

describe('I2 — vai bench (giường cỡ nhỏ đổi vai)', () => {
  it('hộp 0,81 × 0,86: không ép băng dài 1,5 m vào hộp — ra đôn nhỏ ở cỡ thật', () => {
    const m = mem('b', 'bench', ['bench-long', 'ottoman'], { current: null, box: { cx: 0, cy: 0, w: 0.81, d: 0.86, rot: 0 }, shownOf: stretch(0.81, 0.86) });
    const d = roomSetOf('r', [m], new Map(), ctxOf(), []).get('b');
    expect(d?.to).not.toBe('bench-long');
    expect(d?.to).toBe('ottoman');
    expect(d?.uniform).toBe('real');
  });
});

describe('I2 — concept khi phép khớp thường ngoài công năng', () => {
  const box = { cx: 0, cy: 0, w: 2.2, d: 1.0, rot: 0 };
  it('khớp thường cao 1,2 m (ngoài công năng) nhưng co đều trong phạm vi → concept co đều', () => {
    const m = mem('s', 'sofa', ['c-sofa-grey'], {
      box,
      shownOf: (f) => (f === 'sofa-deep' ? [2.0, 1.2, 0.9] : DIMS[f]),
      concept: { folder: 'sofa-deep', shownOf: () => [2.0, 0.85, 0.9] },
    });
    const d = roomSetOf('r', [m], new Map(), ctxOf(), []).get('s');
    expect(d?.cause).toBe('concept');
    expect(d?.uniform).toBe(true);
  });
  it('co đều cũng ngoài công năng → concept trượt', () => {
    const m = mem('s', 'sofa', ['c-sofa-grey'], {
      box,
      shownOf: (f) => (f === 'sofa-deep' ? [2.0, 1.2, 0.9] : DIMS[f]),
      concept: { folder: 'sofa-deep', shownOf: () => [1.0, 0.42, 0.45] },
    });
    expect(roomSetOf('r', [m], new Map(), ctxOf(), []).get('s')?.cause).not.toBe('concept');
  });
});
