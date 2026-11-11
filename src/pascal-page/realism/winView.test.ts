import { describe, expect, it } from 'vitest';

import { DAY_HDRI_URL, HDRI_URL } from './lighting';
import { parseWinView, WIN_GAIN, WIN_URL, winApplies } from './winView';

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
});
