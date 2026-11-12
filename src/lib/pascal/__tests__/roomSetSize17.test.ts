import { describe, expect, it } from 'vitest';

import { itemFitOf } from '../itemFit';
import { FUNC_RANGE, fitsSpot, functionalMissOf } from '../roomSet';

/** Vòng 17 làn A — phạm vi công năng trên cỡ HIỂN THỊ (số đo từ sổ 4181d388, F:/runs/m17/A/KET-QUA.txt §4). */
type D = readonly [number, number, number];
const shrink = (dims: D, s: number): D => [dims[0] * s, dims[1] * s, dims[2] * s];

describe('vòng 17 — functionalMissOf (ca T1–T14)', () => {
  it('T1/T2: ghế ăn concept co đều 0,625 / 0,758 → ngoài công năng (hệ số cao < 0,9)', () => {
    const wishbone: D = [0.57, 0.73, 0.58];
    expect(functionalMissOf('diningChair', wishbone, shrink(wishbone, 0.625))).toBeDefined();
    const velvet: D = [0.527, 0.861, 0.578];
    expect(functionalMissOf('diningChair', velvet, shrink(velvet, 0.758))).toMatch(/hệ số cao|rộng|sâu/);
  });
  it('T3/T4: tủ áo co đều 0,61 / 0,659 → ngoài (cao < 1,75, sâu < 0,5)', () => {
    expect(functionalMissOf('closet', [1.285, 1.903, 0.508], [0.784, 1.161, 0.31])).toBeDefined();
    expect(functionalMissOf('closet', [1.4, 2.07, 0.58], [0.922, 1.363, 0.382])).toBeDefined();
  });
  it('T5/T6: bàn ăn cao 684 / 693 → ngoài; cao thật 760 → đạt', () => {
    expect(functionalMissOf('diningTable', [1.6, 0.76, 0.9], [1.422, 0.684, 0.811])).toMatch(/cao 684/);
    expect(functionalMissOf('diningTable', [1.6, 0.76, 0.9], [1.396, 0.693, 0.821])).toBeDefined();
    expect(functionalMissOf('diningTable', [1.6, 0.76, 0.9], [1.422, 0.76, 0.811])).toBeUndefined();
  });
  it('T7: giường đôi rộng 1277 → ngoài (không hạ thành giường đơn: vai giữ nguyên)', () => {
    expect(functionalMissOf('doubleBed', [1.748, 0.895, 1.978], [1.277, 0.895, 2.077])).toMatch(/rộng 1277/);
  });
  it('T8: ghế ăn sâu 362 → ngoài', () => {
    expect(functionalMissOf('diningChair', [0.41, 0.8, 0.52], [0.41, 0.736, 0.362])).toMatch(/sâu 362/);
  });
  it('T9/T10: sofa co 0,22 (395 rộng), tủ áo 102 rộng → ngoài', () => {
    expect(functionalMissOf('sofa', [1.8, 0.9, 0.9], [0.395, 0.644, 0.686])).toBeDefined();
    expect(functionalMissOf('closet', [1.0, 1.9, 0.6], [0.102, 1.836, 0.26])).toBeDefined();
  });
  it('T11: ghế bành rộng 1269 → ngoài; T13: sofa concept ch03 2213×826×821 (sy 1) → đạt', () => {
    expect(functionalMissOf('armchair', [0.98, 0.8, 0.85], [1.269, 0.85, 0.9])).toBeDefined();
    expect(functionalMissOf('sofa', [2.213, 0.821, 0.826], [2.213, 0.821, 0.826])).toBeUndefined();
  });
  it('T12: ch07 tủ áo co 0,468 → ngoài (ngoài UNIFORM_MIN cũ)', () => {
    const d: D = [1.6, 2.1, 0.6];
    expect(functionalMissOf('closet', d, shrink(d, 0.468))).toBeDefined();
  });
  it('T14: test thuần — ghế ăn 0,57×0,58 không lọt hộp 0,36×0,41; ở cỡ thật trong phạm vi', () => {
    expect(fitsSpot([0.57, 0.73, 0.58], 0.36, 0.41)).toBe(false);
    expect(functionalMissOf('diningChair', [0.57, 0.73, 0.58], [0.57, 0.73, 0.58])).toBeUndefined();
  });
  it('vai không có bảng: không kiểm', () => {
    expect(functionalMissOf('rug', [1, 1, 1], [0.1, 0.1, 0.1])).toBeUndefined();
    expect(Object.keys(FUNC_RANGE)).toContain('closet');
  });
});

describe('vòng 17 — itemFitOf', () => {
  it("uniform 'real': cỡ thật dù vượt hộp; uniform true: co về hộp", () => {
    const real = itemFitOf('chair-wishbone-wood-b', 0.36, 0.41, undefined, 2700, false, 'real');
    const co = itemFitOf('chair-wishbone-wood-b', 0.36, 0.41, undefined, 2700, false, true);
    if (real === null || co === null) return; // mẫu chưa có trong catalog máy này
    expect(real.scale[0]).toBeCloseTo(real.scale[1]);
    expect(real.shownM[0]).toBeGreaterThan(co.shownM[0]);
  });
});
