import { describe, expect, it } from 'vitest';

import { DEFAULT_LIGHT_FLAGS, parseLightFlags } from './lightFlag';
import { calibrateRoomLights, ceilingLightHeight, LAMP_CAL_PEAK_E, LAMP_CEIL_GAP_M, planRoomLights, ROOM_LIGHT_HEIGHT_M, type Polygon } from './roomLights';

const rect = (w: number, d: number): Polygon => [[0, 0], [w, 0], [w, d], [0, d]];
const peak = (cd: number) => cd / ROOM_LIGHT_HEIGHT_M ** 2;

describe('?light=', () => {
  it('chỉ nhận khoá hợp lệ, không đụng ?tone/?mat', () => {
    expect([...parseLightFlags('?light=lamp-cal,cut-shadow,x&tone=agx&mat=y')]).toEqual(['lamp-cal', 'cut-shadow']);
    expect([...parseLightFlags('?tone=agx')]).toEqual([...DEFAULT_LIGHT_FLAGS]);
    expect(parseLightFlags('?light=none').size).toBe(0);
    expect([...parseLightFlags('?light=lamp-cal')]).toEqual(['lamp-cal']);
  });
});

describe('lamp-cal', () => {
  it('phòng 30 m²: 15 cd (đỉnh 2,84) → 3 đèn 5 cd, giữ tổng cường độ, đỉnh mỗi đèn ≤ ngưỡng', () => {
    const rooms = [{ polygon: rect(6, 5) }];
    const base = planRoomLights(rooms);
    expect(base[0]!.intensity).toBe(15);
    expect(peak(15)).toBeCloseTo(2.84, 2);
    const cal = calibrateRoomLights(base, rooms);
    expect(cal).toHaveLength(3);
    expect(cal.reduce((s, p) => s + p.intensity, 0)).toBeCloseTo(15);
    for (const p of cal) expect(peak(p.intensity)).toBeLessThanOrEqual(LAMP_CAL_PEAK_E);
    expect(cal.map((p) => p.x)).toEqual([1, 3, 5]);
  });

  it('phòng nhỏ giữ nguyên; hết ô pool thì không chia', () => {
    const small = [{ polygon: rect(2, 3) }];
    expect(calibrateRoomLights(planRoomLights(small), small)).toEqual(planRoomLights(small));
    const big = [{ polygon: rect(6, 5) }];
    expect(calibrateRoomLights(planRoomLights(big), big, 1)).toHaveLength(1);
  });

  it('phòng chữ L: điểm chia rơi ra ngoài → một đèn', () => {
    const l: Polygon = [[0, 0], [8, 0], [8, 1], [1, 1], [1, 6], [0, 6]];
    const rooms = [{ polygon: l }];
    expect(calibrateRoomLights(planRoomLights(rooms), rooms)).toHaveLength(1);
  });
});

describe('lamp-ceil', () => {
  const ceil = (h: number, w = 6, d = 5) => ({ polygon: rect(w, d), height: h });
  it('đèn phòng lên sát trần thấp nhất chứa tâm; giữ cường độ ⇒ quang thông giữ, đỉnh rọi sàn giảm', () => {
    const h = ceilingLightHeight(3, 2.5, [ceil(6.5), ceil(3.2)]);
    expect(h).toBeCloseTo(3.2 - LAMP_CEIL_GAP_M);
    expect(peak(15)).toBeCloseTo(2.84, 2);
    expect(15 / h ** 2).toBeLessThan(1.6);
  });
  it('không có trần chứa tâm / trần thấp hơn 2,3 m / trần tầng dưới → giữ 2,3 m', () => {
    expect(ceilingLightHeight(10, 10, [ceil(3.2)])).toBe(ROOM_LIGHT_HEIGHT_M);
    expect(ceilingLightHeight(3, 2.5, [ceil(2.1), ceil(-0.1)])).toBe(ROOM_LIGHT_HEIGHT_M);
    expect(ceilingLightHeight(3, 2.5, [])).toBe(ROOM_LIGHT_HEIGHT_M);
  });
  it('cờ cộng dồn', () => {
    expect([...parseLightFlags('?light=lamp-ceil,room-clip')]).toEqual(['lamp-ceil', 'room-clip']);
  });
});
