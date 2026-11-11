import { describe, expect, it } from 'vitest';

import { DAY_HDRI_URL, HDRI_URL } from './lighting';
import { insideRoomBox, levelBoxes, MIN_ROOM_HEIGHT_M, parseWinView, WIN_GAIN, WIN_URL, winApplies, WINVIEW_DEFAULT } from './winView';

describe('parseWinView', () => {
  it('không cờ / off / giá trị lạ → null (hành vi như cũ)', () => {
    expect(parseWinView('', 'dark')).toBeNull();
    expect(parseWinView('?winview=off', 'dark')).toBeNull();
    expect(parseWinView('?winview=forest', 'light')).toBeNull();
    expect(parseWinView('?winview=', 'light')).toBeNull();
  });

  it('gain theo chủ đề, scope mặc định inside', () => {
    expect(parseWinView('?winview=sunset', 'dark')).toEqual({ mode: 'sunset', gain: WIN_GAIN.dark, scope: 'inside' });
    expect(parseWinView('?winview=courtyard', 'light')).toEqual({ mode: 'courtyard', gain: WIN_GAIN.light, scope: 'inside' });
  });

  it(':gain đè; ngoài (0, 4] hoặc không phải số → gain chủ đề', () => {
    expect(parseWinView('?winview=sky:0.5', 'dark')?.gain).toBe(0.5);
    expect(parseWinView('?winview=sky:4', 'dark')?.gain).toBe(4);
    for (const bad of ['0', '-1', '9', 'abc', '']) expect(parseWinView(`?winview=sky:${bad}`, 'dark')?.gain).toBe(WIN_GAIN.dark);
  });

  it('winscope=all áp cả toàn cảnh; giá trị khác → inside', () => {
    expect(parseWinView('?winview=sunset&winscope=all', 'dark')?.scope).toBe('all');
    expect(parseWinView('?winview=sunset&winscope=x', 'dark')?.scope).toBe('inside');
    expect(winApplies('inside', false)).toBe(false);
    expect(winApplies('inside', true)).toBe(true);
    expect(winApplies('all', false)).toBe(true);
  });

  it('chỉ dùng ảnh có sẵn trong repo', () => {
    expect(WIN_URL.sunset).toBe(HDRI_URL);
    expect(WIN_URL.sky).toBe(DAY_HDRI_URL);
    expect(WIN_URL.courtyard).toMatch(/urban-courtyard/);
  });

  it('auto: Buổi tối → sunset gain tối; chủ đề sáng → null (giữ trời chủ đề)', () => {
    expect(parseWinView('?winview=auto', 'dark')).toEqual({ mode: 'sunset', gain: WIN_GAIN.dark, scope: 'inside' });
    expect(parseWinView('?winview=auto:0.8&winscope=all', 'dark')).toEqual({ mode: 'sunset', gain: 0.8, scope: 'all' });
    expect(parseWinView('?winview=auto', 'light')).toBeNull();
  });

  it('không cờ → WINVIEW_DEFAULT (off); fallback auto bật; ?disable=winview thắng mọi thứ', () => {
    expect(WINVIEW_DEFAULT).toBe('off');
    expect(parseWinView('', 'dark')).toBeNull();
    expect(parseWinView('', 'dark', 'auto')?.mode).toBe('sunset');
    expect(parseWinView('?disable=foo,winview', 'dark', 'auto')).toBeNull();
    expect(parseWinView('?winview=sunset&disable=winview', 'dark')).toBeNull();
    expect(parseWinView('?winview=off', 'dark', 'auto')).toBeNull();
  });
});

const box = (minX: number, minY: number, minZ: number, maxX: number, maxY: number, maxZ: number) => ({ minX, minY, minZ, maxX, maxY, maxZ });

describe('tín hiệu trong nhà (hộp bao tường + dưới trần)', () => {
  const boxes = levelBoxes([
    { level: 'L1', kind: 'wall', box: box(0, 0, 0, 10, 3, 0.2) },
    { level: 'L1', kind: 'wall', box: box(0, 0, 7.8, 10, 3, 8) },
    { level: 'L1', kind: 'ceiling', box: box(0, 3.1, 0, 10, 3.15, 8) },
    { level: 'L2', kind: 'wall', box: box(0, 3.2, 0, 6, 3.6, 6) }, // tường hạ (chế độ cắt) → trần tối thiểu
    { level: 'L3', kind: 'ceiling', box: box(50, 0, 50, 60, 3, 60) }, // trần không có tường → bỏ
  ]);

  it('gom theo tầng; trần nâng đỉnh; tường thấp lấy trần tối thiểu; tầng không tường bị bỏ', () => {
    expect(boxes).toHaveLength(2);
    expect(boxes[0]).toEqual(box(0, 0, 0, 10, 3.15, 8));
    expect(boxes[1]!.maxY).toBeCloseTo(3.2 + MIN_ROOM_HEIGHT_M);
  });

  it('trong phòng ở tầm mắt → true; trên mái (toàn cảnh) / ngoài mặt bằng → false', () => {
    expect(insideRoomBox({ x: 5, y: 1.6, z: 4 }, boxes)).toBe(true);
    expect(insideRoomBox({ x: 3, y: 4.8, z: 3 }, boxes)).toBe(true); // tầng 2
    expect(insideRoomBox({ x: 5, y: 15, z: 4 }, boxes)).toBe(false);
    expect(insideRoomBox({ x: 12, y: 1.6, z: 4 }, boxes)).toBe(false);
    expect(insideRoomBox({ x: 55, y: 1.6, z: 55 }, boxes)).toBe(false);
    expect(insideRoomBox({ x: 5, y: 1.6, z: 4 }, [])).toBe(false);
  });
});
