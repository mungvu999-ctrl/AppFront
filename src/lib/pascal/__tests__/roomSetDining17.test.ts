/**
 * F5 (vòng 17) — một bàn một bộ ghế. Hồi quy chấm mù (hin3, s4pn): ghế bị bóp hộp (sâu 0,29 m, ngoài công năng) không lọt
 * ứng viên nào → phương án cuối chọn RIÊNG mẫu nhỏ nhất / mẫu dựng sẵn → lệch kiểu với các ghế cùng bàn. Nay phương án
 * cuối thử trước mẫu dẫn của nhóm (mẫu các ghế cùng bàn đã nhận) ở cỡ thật.
 */
import { describe, expect, it } from 'vitest';

import type { ModelQuality, QualityPart } from '../libraryQuality';
import { roomSetOf, type Dims, type SetContext, type SetMember } from '../roomSet';

const part = (kind: QualityPart['kind'], lab: readonly [number, number, number], material: QualityPart['material']): QualityPart =>
  ({ kind, share: 1, lab, material, kindBy: 'm' }) as QualityPart;
const q = (role: string, p: QualityPart): ModelQuality =>
  ({
    role,
    useMm: [1000, 1000, 1000],
    front: { axis: '+z', check: 'ok' },
    parts: [p],
    completeness: { v: 'full', by: 'm' },
    detail: { tris: 1, kb: 1, textures: 0, maxTex: 0, tier: 'light' },
    licence: 'CC0',
    source: 'test',
  }) as unknown as ModelQuality;
const OAK = [70, 8, 28] as const;
const Q: Record<string, ModelQuality> = {
  oak: q('diningTable', part('top', OAK, 'wood')),
  'chair-a': q('diningChair', part('frame', OAK, 'wood')),
  'chair-b': q('diningChair', part('frame', OAK, 'wood')),
  'chair-stock': q('diningChair', part('frame', OAK, 'wood')),
};
const DIMS: Record<string, Dims> = {
  oak: [1.2, 0.75, 0.8],
  'chair-a': [0.46, 0.85, 0.5],
  // Nhỏ hơn chair-a: luật cũ của phương án cuối (mẫu NHỎ NHẤT trong dải) chọn nó → lệch bộ.
  'chair-b': [0.42, 0.85, 0.46],
  'chair-stock': [0.44, 0.85, 0.48],
};
const ctx: SetContext = { tierOf: () => 0, tiers: 5, dimsOf: (id) => DIMS[id], palette: {}, qualityOf: (id) => Q[id] };
const chair = (id: string, cx: number, cy: number, extra: Partial<SetMember> = {}): SetMember => ({
  id,
  role: 'diningChair',
  short: 1,
  long: 1,
  current: 'chair-a',
  pool: ['chair-a', 'chair-b'],
  stock: 'chair-stock',
  fixed: false,
  sizeFrom: 'ai',
  box: { cx, cy, w: 0.46, d: 0.5, rot: 0 },
  ...extra,
});
const table: SetMember = {
  id: 't',
  role: 'diningTable',
  short: 3,
  long: 3,
  current: 'oak',
  pool: ['oak'],
  fixed: false,
  sizeFrom: 'ai',
  box: { cx: 0, cy: 0, w: 1.2, d: 0.8, rot: 0 },
};
/** Hộp AI bị bóp: mọi mẫu hiện sâu 0,29 m — ngoài công năng ghế (≥ 0,4 m × 0,9) → không ứng viên nào lọt. */
const squashed = chair('c3', 0.9, 0, { box: { cx: 0.9, cy: 0, w: 0.46, d: 0.29, rot: 0 }, shownOf: (f) => (DIMS[f] === undefined ? undefined : [DIMS[f][0], DIMS[f][1], 0.29]) });

describe('F5 một bàn một bộ ghế', () => {
  it('ghế bóp hộp: phương án cuối theo mẫu dẫn của các ghế cùng bàn (cỡ thật), không chọn riêng mẫu nhỏ nhất', () => {
    const out = roomSetOf('r', [table, chair('c1', 0, 0.7), chair('c2', 0, -0.7), squashed], new Map(), ctx);
    const lead = out.get('c1')?.to;
    expect(out.get('c2')?.to).toBe(lead);
    const d = out.get('c3');
    expect(d?.group).toBe('t');
    expect(d?.cause).toBe('fallback');
    expect(d?.to).toBe(lead);
    expect(d?.uniform).toBe('real');
    expect(d?.why).toContain('mẫu dẫn của nhóm ghế');
  });

  it('ghế không thuộc bàn nào và một mình: không có mẫu dẫn — giữ luồng phương án cuối cũ', () => {
    const lone = { ...squashed, id: 'solo', box: { cx: 5, cy: 5, w: 0.46, d: 0.29, rot: 0 } };
    const d = roomSetOf('r', [lone], new Map(), ctx).get('solo');
    expect(d?.cause).toBe('fallback');
    expect(d?.why).not.toContain('mẫu dẫn');
  });
});
