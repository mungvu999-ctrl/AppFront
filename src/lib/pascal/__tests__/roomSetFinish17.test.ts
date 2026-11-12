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
    const block: SetZone = { cx: 0, cy: 0, w: 6, d: 6, rotationDeg: 0 };
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

  it('mẫu dựng sẵn cũng méo → giữ luật cũ, sổ ghi luật cũ trượt', () => {
    const block: SetZone = { cx: 0, cy: 0, w: 6, d: 6, rotationDeg: 0 };
    const m = mem('s', 'sofa', ['sofa-deep'], { current: 'sofa-old', stock: 'sofa', box: { cx: 0, cy: 0, w: 2, d: 0.85, rot: 0 }, shownOf: () => [1.0, 0.85, 0.85] });
    const d = roomSetOf('r', [m], new Map(), ctxOf(), [block]).get('s');
    expect(d?.to).toBe('sofa-old');
    expect(d?.why).toMatch(/luật cũ trượt/);
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
