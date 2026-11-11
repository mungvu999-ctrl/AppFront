import { describe, expect, it, vi } from 'vitest';

vi.mock('@pascal-app/core', () => ({ sceneRegistry: { byType: {}, nodes: new Map() }, useScene: { getState: () => ({ nodes: {} }) } }));
vi.mock('./warm', () => ({ isFirstLoad: () => false, warmStats: () => ({ pending: 0, buildsPending: 0, texWaiting: 0, started: 0 }) }));
vi.mock('./tiers', () => ({ currentTier: () => 'high' }));
vi.mock('./idle', () => ({ HOLD_MS: 150, idleStats: () => ({ reasons: {} }), markDirty: () => {} }));

const { isLevelReady, warmBudgetMs, shadowDue, WARM_CAP_MS } = await import('./levelWarm');

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
  it('không cờ → ba núm lát 1 TẮT (= vòng 9): không trần ngân sách, ép bóng mọi khung, flags tắt, không đo pha', async () => {
    const { levelWarmStats } = await import('./levelWarm');
    expect(warmBudgetMs(5)).toBe(45); // 50 − khung thường, không trần 10 ms
    expect([0, 1, 7, 8].map((n) => shadowDue(n))).toEqual([true, true, true, true]);
    expect(levelWarmStats().flags).toEqual({ shadowEvery: false, budgetCap: false, fastSkip: false, phase: false });
  });
  it('`?enable=lwbudget`: trần WARM_CAP_MS khi khung thường nhẹ, sàn 4 ms khi khung thường nặng', () => {
    expect(warmBudgetMs(5, WARM_CAP_MS)).toBe(WARM_CAP_MS);
    expect(warmBudgetMs(45, WARM_CAP_MS)).toBe(5);
    expect(warmBudgetMs(130, WARM_CAP_MS)).toBe(4);
  });
  it('`?enable=lwshadow8`: ép vẽ lại bóng ở khung ấm đầu và mỗi 8 khung', () => {
    expect([0, 1, 7, 8, 16].map((n) => shadowDue(n, 8))).toEqual([true, false, false, true, true]);
  });
});
