import { describe, expect, it, vi } from 'vitest';

interface O {
  visible: boolean;
  frustumCulled?: boolean;
  parent: O | null;
  uuid: string;
  children: O[];
  traverse(f: (o: O) => void): void;
}
const node = (uuid: string, extra: Partial<O> = {}, children: O[] = []): O => {
  const o: O = {
    visible: true, parent: null, uuid, children, ...extra,
    traverse(f) {
      f(o);
      for (const c of o.children) c.traverse(f);
    },
  };
  for (const c of children) c.parent = o;
  return o;
};
const m1 = node('m1');
const m2 = node('m2');
const m3 = node('m3');
const m4 = node('m4');
const l1 = node('L1', {}, [m1]);
const l2 = node('L2', { visible: false }, [m2, m3, m4]);
const l3 = node('L3', { visible: false });
const scene = node('scene', {}, [l1, l2, l3]);

vi.mock('@pascal-app/core', () => ({
  sceneRegistry: { byType: { level: new Set(['L1', 'L2', 'L3']), item: new Set() }, nodes: new Map([['L1', l1], ['L2', l2], ['L3', l3]]) },
  useScene: { getState: () => ({ nodes: { L1: { level: 0 }, L2: { level: 1 }, L3: { level: 2 } } }) },
}));
vi.mock('./warm', () => ({ isFirstLoad: () => false, warmStats: () => ({ pending: 0, buildsPending: 0, texWaiting: 0 }) }));
vi.mock('./tiers', () => ({ currentTier: () => 'high' }));
vi.mock('./idle', () => ({ HOLD_MS: 150, idleStats: () => ({ reasons: {} }), markDirty: () => {} }));

describe('levelWarm: ngân sách khung, nhường tầng đang hiện, tín hiệu khung', () => {
  it('chạy đúng thứ tự một phiên', async () => {
    let now = 10_000;
    vi.spyOn(performance, 'now').mockImplementation(() => now);
    let idle: (() => void) | undefined;
    vi.stubGlobal('requestIdleCallback', (cb: () => void) => void (idle ??= cb));
    const lw = await import('./levelWarm');
    const notReady = new Set<O>([m2, m3, m4]);
    const r = {
      __asyncW2: true as const,
      _objects: { get: (o: O) => o },
      _nodes: { get: (o: O) => ({ nodeBuilderState: notReady.has(o) ? undefined : {} }), nodeBuilderCache: new Map(), getForRenderCacheKey: (o: O) => o.uuid },
      _pipelines: { isReady: (o: O) => !notReady.has(o) },
      backend: { draw: () => {} },
      _currentRenderContext: null,
      _renderObjectDirect: (() => {
        now += 30; // mỗi vật tốn 30 ms
      }) as (...a: unknown[]) => void,
    };
    lw.installLevelWarm(r, false);
    const drawAll = (objs: O[]) => () => objs.forEach((o) => r._renderObjectDirect.call(r, o, {}, scene, {}, null, null, null, 'p'));
    const frames = vi.fn();
    const stop = lw.onLevelWarmFrame(frames);

    lw.levelWarmFrame(scene, () => {});
    expect(frames).toHaveBeenCalledTimes(1);
    idle!();
    expect(lw.levelWarmStats().current).toBe('L2');
    expect(lw.levelWarmStats().remaining).toBe(2);

    // Ngân sách 50 ms: vật 1 (30) + vật 2 (60 ≥ 50) rồi dừng; vật 3 để khung sau.
    lw.levelWarmFrame(scene, drawAll([m2, m3, m4]));
    let s = lw.levelWarmStats();
    expect(s.warmObjects).toBe(2);
    expect(s.budgetSkips).toBe(1);
    expect(s.maxWarmFrameMs).toBe(60);
    expect(s.maxBaseMs).toBe(0);

    // Người dùng chọn L3 (chưa ấm): L3 hiện, còn vật chờ → khung sau KHÔNG ấm L2 (nhường), vẫn lấy mẫu.
    l3.visible = true;
    l3.children.push(m4);
    const m4Parent = m4.parent;
    m4.parent = l3;
    lw.levelWarmFrame(scene, drawAll([m2, m4])); // L2 vẫn còn vật chờ
    expect(lw.levelReadiness().find((l) => l.levelId === 'L3')?.ready).toBe(false);
    const warmBefore = lw.levelWarmStats().warmFrames;
    lw.levelWarmFrame(scene, () => expect(l2.visible).toBe(false));
    s = lw.levelWarmStats();
    expect(s.yieldFrames).toBeGreaterThan(0);
    expect(s.warmFrames).toBe(warmBefore);

    // L3 dựng xong: khung lấy mẫu thấy 0 vật chờ → L3 sẵn sàng, L2 ấm tiếp.
    notReady.delete(m4);
    lw.levelReadiness();
    lw.levelWarmFrame(scene, drawAll([m4]));
    expect(lw.levelReadiness().find((l) => l.levelId === 'L3')?.ready).toBe(true);
    lw.levelWarmFrame(scene, () => {});
    expect(lw.levelWarmStats().warmFrames).toBe(warmBefore + 1);

    // Tầng đang hiện mà khung không vẽ vật nào của nó (rỗng/ngoài khung nhìn) = sẵn sàng, không treo nhãn.
    m4.parent = m4Parent;
    l3.children.pop();
    lw.levelReadiness();
    lw.levelWarmFrame(scene, () => {});
    expect(lw.levelReadiness().find((l) => l.levelId === 'L3')?.ready).toBe(true);

    // Đo đổi tầng.
    lw.noteLevelSelected('L3', 1000);
    lw.noteLevelReady('L2', 1500); // tầng khác: bỏ qua
    lw.noteLevelReady('L3', 1800);
    lw.noteLevelReady('L3', 9000); // lần sau: bỏ qua
    expect(lw.levelWarmStats().switch).toMatchObject({ levelId: 'L3', lastWaitMs: 800, maxWaitMs: 800, count: 1 });

    const calls = frames.mock.calls.length;
    stop();
    lw.levelWarmFrame(scene, () => {});
    expect(frames).toHaveBeenCalledTimes(calls);
    expect(lw.levelWarmActive()).toBe(true);
  });
});
