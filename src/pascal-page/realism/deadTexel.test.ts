import { describe, expect, it } from 'vitest';

import { deadTexelOn, planDeadTexel } from './deadTexel';

/** n texel RGBA: `black` đen, còn lại màu (r, g, b). */
function px(n: number, black: number, rgb: [number, number, number], a = 255): Uint8ClampedArray {
  const d = new Uint8ClampedArray(n * 4);
  for (let i = 0; i < n; i++) d.set(i < black ? [0, 0, 0, a] : [...rgb, a], i * 4);
  return d;
}

describe('deadTexel: quyết định vá từ texel', () => {
  it('nửa đen nửa be → vá, màu ≈ be (tuyến tính)', () => {
    const plan = planDeadTexel(px(100, 50, [200, 180, 150]));
    expect(plan).not.toBeNull();
    expect(plan!.deadFrac).toBeCloseTo(0.5);
    expect(plan!.rgb[0]).toBeCloseTo(0.578, 2);
    expect(plan!.rgb[0]).toBeGreaterThan(plan!.rgb[2]);
  });
  it('toàn tối (đồ đen thật) → không vá', () => {
    expect(planDeadTexel(px(100, 60, [20, 20, 20]))).toBeNull();
    expect(planDeadTexel(px(100, 100, [0, 0, 0]))).toBeNull();
  });
  it('không có texel đen → không vá', () => {
    expect(planDeadTexel(px(100, 0, [200, 180, 150]))).toBeNull();
  });
  it('quá ít texel đen (< 5 %) hoặc thân quá ít (< 20 %) → không vá', () => {
    expect(planDeadTexel(px(100, 3, [200, 180, 150]))).toBeNull();
    expect(planDeadTexel(px(100, 90, [200, 180, 150]))).toBeNull();
  });
  it('ảnh rỗng / toàn trong suốt → không vá', () => {
    expect(planDeadTexel(new Uint8ClampedArray(0))).toBeNull();
    expect(planDeadTexel(px(100, 50, [200, 180, 150], 0))).toBeNull();
  });
  it('cờ ?disable=deadtexel', () => {
    expect(deadTexelOn('')).toBe(true);
    expect(deadTexelOn('?disable=ao,deadtexel')).toBe(false);
  });
});
