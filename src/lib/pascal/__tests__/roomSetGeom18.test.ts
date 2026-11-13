import { describe, expect, it } from 'vitest';

import type { ModelQuality } from '../libraryQuality';
import { CONCEPT_LENIENT, functionalMissOf, hardRejectOf, type Dims, type SetContext, type SetMember } from '../roomSet';

/** Vòng 18 làn C — phân loại hình học: hộp người dùng, cận dưới giường, khoảng theo hình dạng. */
describe('vòng 18 — functionalMissOf hình học', () => {
  it('T-A: giường đôi dài 1720 (co từ 1951) → ngoài (cận dưới không dung sai); cỡ thật → đạt; 1900 → đạt', () => {
    const dims: Dims = [1.745, 0.832, 1.951];
    expect(functionalMissOf('doubleBed', dims, [1.319, 0.806, 1.72])).toMatch(/sâu 1720/);
    expect(functionalMissOf('doubleBed', dims, dims)).toBeUndefined();
    expect(functionalMissOf('doubleBed', dims, [1.6, 0.832, 1.9])).toBeUndefined();
    expect(functionalMissOf('singleBed', [0.93, 0.5, 2.14], [0.8, 0.5, 1.8])).toMatch(/sâu 1800/);
  });
  it('T-C: hộp người dùng — sofa co đều 0,72 bị chặn; cỡ cao 0,87+ và hộp rộng/sâu quá khoảng vẫn đạt', () => {
    const dims: Dims = [2.25, 1.02, 0.868];
    expect(functionalMissOf('sofa', dims, [1.628, 0.738, 0.628], true)).toMatch(/hệ số cao/);
    expect(functionalMissOf('sofa', dims, [1.8, 0.95, 0.7], true)).toBeUndefined();
    expect(functionalMissOf('sofa', [2.5, 0.84, 1.2], [2.6, 0.84, 2.04], true)).toBeUndefined();
  });
  it('T-B: hộp người dùng — hardRejectOf loại mẫu co 0,72, nhận mẫu vừa hộp', () => {
    const q = (id: string): ModelQuality => ({ role: 'sofa', front: { check: 'ok' }, parts: [{}], completeness: { v: 'full' }, useMm: id === 'big' ? [2250, 1020, 868] : [1650, 800, 740] }) as unknown as ModelQuality;
    const ctx = { dimsOf: (f: string) => (f === 'big' ? ([2.25, 1.02, 0.868] as Dims) : ([1.65, 0.8, 0.74] as Dims)), qualityOf: q, tierOf: () => 0, tiers: 1 } as unknown as SetContext;
    const m = {
      id: 's', role: 'sofa', kind: 'chair', short: 0.74, long: 1.63, current: null, pool: [], fixed: false, sizeFrom: 'user',
      box: { cx: 0, cy: 0, w: 1.63, d: 0.74, rot: 0 },
      shownOf: (f: string) => (f === 'big' ? ([1.628, 0.738, 0.628] as Dims) : ([1.63, 0.8, 0.74] as Dims)),
    } as unknown as SetMember;
    expect(hardRejectOf(m, 'big', ctx, CONCEPT_LENIENT)).toBe('ngoài công năng');
    expect(hardRejectOf(m, 'fit', ctx, CONCEPT_LENIENT)).not.toBe('ngoài công năng');
  });
  it('khoảng theo hình dạng: sofa L sâu 2036 đạt khi shape=L, trượt khi không có shape', () => {
    const dims: Dims = [2.5, 1.0, 2.0];
    expect(functionalMissOf('sofa', dims, dims)).toMatch(/sâu 2000/);
    expect(functionalMissOf('sofa', dims, dims, false, 'L')).toBeUndefined();
  });
});
