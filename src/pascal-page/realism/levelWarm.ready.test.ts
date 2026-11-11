import { describe, expect, it, vi } from 'vitest';

vi.mock('@pascal-app/core', () => ({ sceneRegistry: { byType: {}, nodes: new Map() }, useScene: { getState: () => ({ nodes: {} }) } }));
vi.mock('./warm', () => ({ isFirstLoad: () => false, warmStats: () => ({ pending: 0, buildsPending: 0, texWaiting: 0, started: 0 }) }));
vi.mock('./tiers', () => ({ currentTier: () => 'high' }));
vi.mock('./idle', () => ({ HOLD_MS: 150, idleStats: () => ({ reasons: {} }), markDirty: () => {} }));

const { isLevelReady, warmBudgetMs, shadowDue, retryStalled, MAX_STALL_RETRIES, WARM_CAP_MS } = await import('./levelWarm');

const base = { pendingAssets: 0, warmed: true, shown: true, touchedLastFrame: true, pendingDraws: 0, w2Busy: false };

describe('isLevelReady — một nghĩa', () => {
  it('tầng đã ấm nhưng mẫu mới nhất còn vật chờ → CHƯA sẵn sàng (lỗi ready:true + pendingDraws 132)', () => {
    expect(isLevelReady({ ...base, pendingDraws: 132 })).toBe(false);
  });
  it('tầng đã ấm, số chờ cũ (không phải mẫu mới nhất) → sẵn sàng (không nháy khi quay lại)', () => {
    expect(isLevelReady({ ...base, touchedLastFrame: false, pendingDraws: 132 })).toBe(true);
  });
  it('đồ GLB còn chờ → chưa sẵn sàng dù đã ấm', () => {
    expect(isLevelReady({ ...base, pendingAssets: 1 })).toBe(false);
  });
  it('chưa ấm: cần mẫu mới, 0 chờ, W2 rảnh', () => {
    expect(isLevelReady({ ...base, warmed: false })).toBe(true);
    expect(isLevelReady({ ...base, warmed: false, w2Busy: true })).toBe(false);
    expect(isLevelReady({ ...base, warmed: false, touchedLastFrame: false })).toBe(false);
  });
});

describe('ngân sách khung ấm', () => {
  it('có trần WARM_CAP_MS khi khung thường nhẹ, sàn 4 ms khi khung thường nặng', () => {
    expect(warmBudgetMs(5, WARM_CAP_MS)).toBe(WARM_CAP_MS); // `?enable=lwbudget`
    expect(warmBudgetMs(5)).toBe(45); // mặc định vòng 9
    expect(warmBudgetMs(45, WARM_CAP_MS)).toBe(5);
    expect(warmBudgetMs(130, WARM_CAP_MS)).toBe(4);
    expect(warmBudgetMs(5, Infinity)).toBe(45); // `?disable=lwbudget`
  });
  it('ép vẽ lại bóng ở khung ấm đầu và mỗi 8 khung', () => {
    expect([0, 1, 7, 8, 16].map((n) => shadowDue(n, 8))).toEqual([true, false, false, true, true]);
    expect(shadowDue(3, 1)).toBe(true); // mặc định (vòng 9): mọi khung
  });
});

describe('retryStalled', () => {
  it('thử lại có giới hạn mỗi tầng', () => {
    const got = Array.from({ length: MAX_STALL_RETRIES + 2 }, () => retryStalled('L2'));
    expect(got).toEqual([...Array(MAX_STALL_RETRIES).fill(true), false, false]);
    expect(retryStalled('L3')).toBe(true);
  });
});

describe('trackUndrawable', () => {
  it('số chờ đứng yên khi W2 rảnh qua UNDRAWABLE_SAMPLES mẫu → coi là không vẽ được; W2 có việc/số đổi → lại từ đầu', async () => {
    const { trackUndrawable, UNDRAWABLE_SAMPLES } = await import('./levelWarm');
    const m = new Map();
    let got = 0;
    for (let i = 0; i < UNDRAWABLE_SAMPLES - 1; i++) got = trackUndrawable(m, 'L1', 2, 0);
    expect(got).toBe(0);
    expect(trackUndrawable(m, 'L1', 2, 0)).toBe(2);
    expect(trackUndrawable(m, 'L1', 2, 1)).toBe(0); // W2 có việc
    for (let i = 0; i < UNDRAWABLE_SAMPLES; i++) got = trackUndrawable(m, 'L1', i % 2 ? 2 : 3, 0);
    expect(got).toBe(0); // số dao động: đang có tiến triển
    expect(trackUndrawable(m, 'L1', 0, 0)).toBe(0);
    expect(m.size).toBe(0);
  });
});
