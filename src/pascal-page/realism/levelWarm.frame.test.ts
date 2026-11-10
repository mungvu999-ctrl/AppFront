import { describe, expect, it, vi } from 'vitest';

interface O {
  visible: boolean;
  frustumCulled?: boolean;
  isLight?: boolean;
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
const mesh = node('mesh', { frustumCulled: true });
const lamp = node('lamp', { isLight: true });
const l1 = node('L1');
const l2 = node('L2', { visible: false }, [mesh, lamp]);
const scene = node('scene', {}, [l1, l2]);

vi.mock('@pascal-app/core', () => ({
  sceneRegistry: { byType: { level: new Set(['L1', 'L2']), item: new Set() }, nodes: new Map([['L1', l1], ['L2', l2]]) },
  useScene: { getState: () => ({ nodes: { L1: { level: 0 }, L2: { level: 1 } } }) },
}));
vi.mock('./warm', () => ({ isFirstLoad: () => false, warmStats: () => ({ pending: 0, buildsPending: 0, texWaiting: 0 }) }));
vi.mock('./tiers', () => ({ currentTier: () => 'high' }));
vi.mock('./idle', () => ({ HOLD_MS: 150, idleStats: () => ({ reasons: {} }), markDirty: () => {} }));

describe('levelWarmFrame khi vẽ ném lỗi', () => {
  it('trả lại visible/đèn/frustumCulled/backend.draw và không ghi warmed', async () => {
    let idle: (() => void) | undefined;
    vi.stubGlobal('requestIdleCallback', (cb: () => void) => void (idle ??= cb));
    vi.spyOn(performance, 'now').mockReturnValue(10_000); // xa mọi mốc thao tác
    const { installLevelWarm, levelWarmFrame, levelWarmStats } = await import('./levelWarm');
    const realDraw = () => {};
    const r = {
      __asyncW2: true as const,
      _objects: { get: () => ({}) },
      _nodes: { get: () => ({ nodeBuilderState: {} }), nodeBuilderCache: new Map(), getForRenderCacheKey: () => 'k' },
      _pipelines: { isReady: () => false },
      backend: { draw: realDraw },
      _currentRenderContext: null,
      _renderObjectDirect: ((): void => {
        throw new Error('vẽ hỏng');
      }) as (...a: unknown[]) => void,
    };
    installLevelWarm(r, false);
    levelWarmFrame(scene, () => {}); // lấy gốc tầng
    idle!(); // chọn L2
    expect(levelWarmStats().current).toBe('L2');
    expect(() =>
      levelWarmFrame(scene, () => {
        expect(l2.visible).toBe(true);
        expect(lamp.visible).toBe(false);
        expect(mesh.frustumCulled).toBe(false);
        r._renderObjectDirect.call(r, mesh, {}, scene, {}, null, null, null, 'p');
      }),
    ).toThrow('vẽ hỏng');
    expect(l2.visible).toBe(false);
    expect(lamp.visible).toBe(true);
    expect(mesh.frustumCulled).toBe(true);
    expect(r.backend.draw).toBe(realDraw);
    expect(levelWarmStats().warmed).toEqual([]);
    expect(levelWarmStats().warmFrames).toBe(0);
  });
});
