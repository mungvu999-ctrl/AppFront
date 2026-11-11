import { describe, expect, it } from 'vitest';

import { interactionCount, isLevelReady, type LevelInfo, LONG_TASK_MS, MIN_WARM_MS, nextWarmLevel, syncScene, warmBudgetMs, type WarmState } from './levelWarm';

const L = (id: string, index: number, shown = false, userHidden = false): LevelInfo => ({ id, index, shown, userHidden });
const on = { tier: 'high' as const, off: false, firstLoad: false, busy: false, interacting: false };

describe('nextWarmLevel', () => {
  const levels = [L('t0', 0), L('t1', 1, true), L('t2', 2), L('t3', 3)];
  it('tầng gần tầng đang xem trước, hoà thì tầng thấp trước', () => {
    expect(nextWarmLevel(levels, new Set(), on)).toEqual({ id: 't0' });
    expect(nextWarmLevel(levels, new Set(['t0']), on)).toEqual({ id: 't2' });
    expect(nextWarmLevel(levels, new Set(['t0', 't2']), on)).toEqual({ id: 't3' });
    expect(nextWarmLevel(levels, new Set(['t0', 't2', 't3']), on)).toEqual({ reason: 'noHiddenLevel' });
  });
  it('bỏ tầng tác giả tắt mắt', () => {
    expect(nextWarmLevel([L('a', 0, true), L('b', 1, false, true)], new Set(), on)).toEqual({ reason: 'noHiddenLevel' });
  });
  it('từ chối kèm lý do: cờ tắt, tier low, đang nạp đầu, W2 còn việc', () => {
    expect(nextWarmLevel(levels, new Set(), { ...on, off: true })).toEqual({ reason: 'flagOff' });
    expect(nextWarmLevel(levels, new Set(), { ...on, tier: 'low' })).toEqual({ reason: 'tierLow' });
    expect(nextWarmLevel(levels, new Set(), { ...on, firstLoad: true })).toEqual({ reason: 'firstLoad' });
    expect(nextWarmLevel(levels, new Set(), { ...on, busy: true })).toEqual({ reason: 'w2Busy' });
    expect(nextWarmLevel(levels, new Set(), { ...on, interacting: true })).toEqual({ reason: 'interacting' });
    expect(nextWarmLevel(levels, new Set(), { ...on, tier: 'medium' })).toEqual({ id: 't0' });
  });
});

describe('warmBudgetMs', () => {
  it('cả khung ấm dưới ngưỡng tác vụ dài, có sàn tối thiểu', () => {
    expect(warmBudgetMs(20, Infinity)).toBe(LONG_TASK_MS - 20);
    expect(warmBudgetMs(45)).toBe(LONG_TASK_MS - 45);
    expect(warmBudgetMs(80)).toBe(MIN_WARM_MS);
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

describe('interactionCount', () => {
  it('chỉ đếm lý do do người dùng, bỏ lý do nội bộ', () => {
    expect(interactionCount({ camera: 2, input: 3, hover: 1, 'level-warm': 50, 'node-build': 9, pipeline: 4 })).toBe(6);
  });
});

describe('isLevelReady', () => {
  const base = { pendingAssets: 0, warmed: false, shown: false, touchedLastFrame: false, pendingDraws: null, w2Busy: false };
  it('tầng ẩn chưa ấm, chưa từng vẽ: chưa sẵn sàng', () => {
    expect(isLevelReady(base)).toBe(false);
    expect(isLevelReady({ ...base, pendingDraws: 0 })).toBe(false);
  });
  it('tầng đã ấm: sẵn sàng trừ khi còn đồ GLB chờ', () => {
    expect(isLevelReady({ ...base, warmed: true })).toBe(true);
    expect(isLevelReady({ ...base, warmed: true, pendingAssets: 1 })).toBe(false);
  });
  it('tầng vừa chọn: chỉ sẵn sàng khi khung gần nhất chạm nó, 0 vật chờ và W2 hết việc', () => {
    const shown = { ...base, shown: true, touchedLastFrame: true, pendingDraws: 0 };
    expect(isLevelReady(shown)).toBe(true);
    expect(isLevelReady({ ...shown, pendingDraws: 3 })).toBe(false);
    expect(isLevelReady({ ...shown, w2Busy: true })).toBe(false);
    expect(isLevelReady({ ...shown, touchedLastFrame: false })).toBe(false);
  });
});
