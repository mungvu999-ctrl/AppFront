import { describe, expect, it } from 'vitest';

import { fabricSheenColor, FLOOR_GLOSS, matxOn, parseMatx } from './matx';
import { FLOOR_FINISHES } from './floorFinish';

describe('matx (thử nghiệm vật liệu M5-L3b)', () => {
  it('đọc danh sách, `all`, bỏ tên lạ; không cờ = tắt hết', () => {
    expect([...parseMatx('?matx=glass,floor,xx')]).toEqual(['glass', 'floor']);
    expect(parseMatx('?matx=all').size).toBe(4);
    expect(parseMatx('').size).toBe(0);
    expect(matxOn('glass')).toBe(false);
  });

  it('sheen vải theo màu vải pha trắng, giữ trong 0..1', () => {
    const [r, g, b] = fabricSheenColor([0.1, 0.05, 0]);
    expect(r).toBeGreaterThan(0.1);
    expect(g).toBeLessThan(r);
    expect(b).toBeLessThan(1);
    expect(fabricSheenColor([1, 1, 1])).toEqual([1, 1, 1]);
  });

  it('mọi sàn trong bảng có họ; gạch/đá bóng hơn gỗ', () => {
    for (const [id, f] of Object.entries(FLOOR_FINISHES)) expect(f.kind, id).toBeDefined();
    expect(FLOOR_GLOSS.tile!.roughness!).toBeLessThan(0.3);
    expect(FLOOR_GLOSS.stone!.roughness!).toBeLessThan(0.3);
    expect(FLOOR_GLOSS.concrete).toBeNull();
  });
});
