import { describe, expect, it } from 'vitest';

import { type LevelInfo, nextWarmLevel, syncScene, type WarmState } from './levelWarm';

const L = (id: string, index: number, shown = false, userHidden = false): LevelInfo => ({ id, index, shown, userHidden });
const on = { tier: 'high' as const, off: false, busy: false };

describe('nextWarmLevel', () => {
  const levels = [L('t0', 0), L('t1', 1, true), L('t2', 2), L('t3', 3)];
  it('tầng gần tầng đang xem trước, hoà thì tầng thấp trước', () => {
    expect(nextWarmLevel(levels, new Set(), on)).toBe('t0');
    expect(nextWarmLevel(levels, new Set(['t0']), on)).toBe('t2');
    expect(nextWarmLevel(levels, new Set(['t0', 't2']), on)).toBe('t3');
    expect(nextWarmLevel(levels, new Set(['t0', 't2', 't3']), on)).toBeNull();
  });
  it('bỏ tầng tác giả tắt mắt', () => {
    expect(nextWarmLevel([L('a', 0, true), L('b', 1, false, true)], new Set(), on)).toBeNull();
  });
  it('không chạy ở tier low, khi cờ tắt, hoặc cảnh đang bận', () => {
    expect(nextWarmLevel(levels, new Set(), { ...on, tier: 'low' })).toBeNull();
    expect(nextWarmLevel(levels, new Set(), { ...on, off: true })).toBeNull();
    expect(nextWarmLevel(levels, new Set(), { ...on, busy: true })).toBeNull();
    expect(nextWarmLevel(levels, new Set(), { ...on, tier: 'medium' })).toBe('t0');
  });
});

describe('syncScene', () => {
  it('cảnh đổi thì huỷ tầng đang ấm và quên tầng đã ấm', () => {
    const s: WarmState = { sceneKey: 'a', warmed: new Set(['t2']), current: 't3' };
    expect(syncScene(s, 'a')).toBe(false);
    expect(s.current).toBe('t3');
    expect(syncScene(s, 'b')).toBe(true);
    expect(s).toEqual({ sceneKey: 'b', warmed: new Set(), current: null });
  });
});
