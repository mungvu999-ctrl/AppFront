import { describe, expect, it, vi } from 'vitest';

import { applyUrlIntent, type UrlIntentStores } from '../urlIntent';

const fakeStores = () => {
  let nodes: Record<string, { type: string }> = {};
  const listeners = new Set<() => void>();
  const stores = {
    scene: {
      getState: () => ({ nodes }),
      subscribe: (listener: () => void) => {
        listeners.add(listener);
        return () => listeners.delete(listener);
      },
    },
    explodeLevels: vi.fn(),
    startMeasure: vi.fn(),
  } satisfies UrlIntentStores;
  const load = (next: Record<string, { type: string }>) => {
    nodes = next;
    listeners.forEach((listener) => listener());
  };
  return { stores, load, listeners };
};

describe('applyUrlIntent — ?view=exploded / ?tool=measure của đường chuyển tiếp', () => {
  it('không tham số thì không đăng ký gì', () => {
    const { stores, listeners } = fakeStores();
    applyUrlIntent('?project=P-1', stores);
    expect(listeners.size).toBe(0);
  });

  it('chờ cảnh có tường rồi áp đúng một lần', () => {
    const { stores, load, listeners } = fakeStores();
    applyUrlIntent('?view=exploded&tool=measure&project=P-1', stores);

    load({ site: { type: 'site' } });
    expect(stores.explodeLevels).not.toHaveBeenCalled();

    load({ w1: { type: 'wall' } });
    load({ w1: { type: 'wall' }, w2: { type: 'wall' } });
    expect(stores.explodeLevels).toHaveBeenCalledTimes(1);
    expect(stores.startMeasure).toHaveBeenCalledTimes(1);
    expect(listeners.size).toBe(0);
  });

  it('?view=exploded khi chỉ 1 tầng thì báo cần 2 tầng', () => {
    const { stores, load } = fakeStores();
    const notify = vi.fn();
    applyUrlIntent('?view=exploded', { ...stores, notify });
    load({ w1: { type: 'wall' }, l1: { type: 'level' } });
    expect(notify).toHaveBeenCalledWith('Cần ít nhất 2 tầng để xem tách tầng');
  });

  it('chỉ ?tool=measure thì không tách tầng', () => {
    const { stores, load } = fakeStores();
    applyUrlIntent('?tool=measure', stores);
    load({ w1: { type: 'wall' } });
    expect(stores.startMeasure).toHaveBeenCalledTimes(1);
    expect(stores.explodeLevels).not.toHaveBeenCalled();
  });
});
