import { describe, expect, it, vi } from 'vitest';

interface O {
  visible: boolean;
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
const ok = node('ok');
const broken = node('broken');
const hid = node('hid');
const l1 = node('L1', {}, [ok]);
const l2 = node('L2', {}, [broken]);
const l3 = node('L3', { visible: false }, [hid]);
const scene = node('scene', {}, [l1, l2, l3]);
const dirty = vi.fn();

vi.mock('@pascal-app/core', () => ({
  sceneRegistry: { byType: { level: new Set(['L1', 'L2', 'L3']), item: new Set() }, nodes: new Map([['L1', l1], ['L2', l2], ['L3', l3]]) },
  useScene: { getState: () => ({ nodes: { L1: { level: 0 }, L2: { level: 1 }, L3: { level: 2 } } }) },
}));
vi.mock('./warm', () => ({ isFirstLoad: () => false, warmStats: () => ({ pending: 0, buildsPending: 0, texWaiting: 0 }) }));
vi.mock('./tiers', () => ({ currentTier: () => 'high' }));
vi.mock('./idle', () => ({ HOLD_MS: 150, idleStats: () => ({ reasons: {} }), markDirty: (r: string) => dirty(r) }));

describe('levelWarm: tầng đã sẵn sàng không báo chờ nhầm; vật hỏng thì báo kẹt, không treo', () => {
  it('trackProgress: giảm thì về 0, đứng yên STALL_FRAMES khung thì kẹt, 0 việc thì xoá', async () => {
    const { trackProgress, STALL_FRAMES } = await import('./levelWarm');
    const m = new Map();
    expect(trackProgress(m, 'a', 5)).toBe(false);
    for (let i = 1; i < STALL_FRAMES; i++) expect(trackProgress(m, 'a', 5)).toBe(false);
    expect(trackProgress(m, 'a', 4)).toBe(false); // tiến triển: không kẹt dù chậm
    for (let i = 1; i < STALL_FRAMES; i++) trackProgress(m, 'a', 6);
    expect(trackProgress(m, 'a', 6)).toBe(true);
    expect(trackProgress(m, 'a', 0)).toBe(false);
    expect(m.has('a')).toBe(false);
  });

  it('một phiên', async () => {
    let idle: (() => void) | undefined;
    vi.stubGlobal('requestIdleCallback', (cb: () => void) => void (idle ??= cb));
    const lw = await import('./levelWarm');
    const r = {
      __asyncW2: true as const,
      _objects: { get: (o: O) => o },
      _nodes: { get: (o: O) => ({ nodeBuilderState: o === broken ? undefined : {} }), nodeBuilderCache: new Map(), getForRenderCacheKey: (o: O) => o.uuid },
      _pipelines: { isReady: (o: O) => o !== broken },
      backend: { draw: () => {} },
      _currentRenderContext: null,
      _renderObjectDirect: (() => {}) as (...a: unknown[]) => void,
    };
    lw.installLevelWarm(r, false);
    const drawShown = () => [ok, broken, hid].forEach((o) => o.parent!.visible && r._renderObjectDirect.call(r, o, {}, scene, {}, null, null, null, 'p'));
    const sample = () => {
      lw.levelReadiness();
      lw.levelWarmFrame(scene, drawShown);
    };
    const of = (id: string) => lw.levelReadiness().find((l) => l.levelId === id)!;

    // D: L1 sẵn sàng một lần → ẩn rồi hiện lại: báo sẵn sàng NGAY, trước khi có mẫu mới (không nhấp nháy nhãn).
    l2.visible = false;
    sample();
    expect(of('L1').ready).toBe(true);
    l1.visible = false;
    l2.visible = true;
    sample();
    l1.visible = true;
    expect(of('L1')).toMatchObject({ ready: true, stalled: false });

    // C: L2 hiện với một vật không bao giờ sẵn sàng. Trước ngưỡng: chưa kẹt, nhường (không ấm L3).
    l1.visible = false;
    sample();
    expect(of('L2')).toMatchObject({ ready: false, stalled: false });
    idle!();
    expect(lw.levelWarmStats().current).toBe('L3');
    sample();
    expect(lw.levelWarmStats()).toMatchObject({ warmFrames: 0, yieldFrames: 1 });
    // Một chu kỳ STALL_FRAMES không giảm → levelWarm TỰ thử lại (không cần UI): vẫn `pending`, chưa kẹt.
    for (let i = 0; i < lw.STALL_FRAMES + 2; i++) sample();
    expect(of('L2')).toMatchObject({ ready: false, stalled: false, status: 'pending' });
    expect(lw.levelWarmStats().phases.stallRetries).toBe(1);
    // (i)+(ii) hết MAX_STALL_RETRIES lượt → L2 kẹt: thôi nhường, L3 được ấm; L2 không báo sẵn sàng.
    const cycles = (lw.MAX_STALL_RETRIES + 1) * (lw.STALL_FRAMES + 1);
    for (let i = 0; i < cycles; i++) sample();
    const s = lw.levelWarmStats();
    expect(s.warmFrames).toBeGreaterThan(0);
    expect(s.warmed).toContain('L3');
    expect(s.yieldFrames).toBeLessThanOrEqual(cycles);
    expect(s.phases.stallRetries).toBe(lw.MAX_STALL_RETRIES);
    expect(of('L2')).toMatchObject({ ready: false, stalled: true, status: 'stalled' });
    expect(s.stalledShown).toContain('L2');
    // (iii) kẹt → hỏi trạng thái không ép vẽ lại nữa.
    dirty.mockClear();
    lw.levelReadiness();
    lw.levelReadiness();
    expect(dirty).not.toHaveBeenCalledWith('level-readiness');
    // Pipeline đã tạo nhưng HỎNG (three `error`): không còn gì để chuẩn bị → không tính là chờ, tầng sẵn sàng.
    r._nodes.get = () => ({ nodeBuilderState: {} }); // pipeline chỉ có sau khi đã dựng node
    Object.assign(r._pipelines, { get: (o: O) => ({ pipeline: o === broken ? 'P' : undefined }) });
    Object.assign(r.backend, { get: () => ({ error: true }) });
    sample();
    expect(of('L2')).toMatchObject({ ready: true, stalled: false, status: 'ready', pendingDraws: 0 });
    expect(lw.levelWarmStats().failedDraws).toBeGreaterThan(0);
    Object.assign(r.backend, { get: () => ({}) });
    sample();
    expect(of('L2').status).toBe('pending'); // không hỏng mà chưa có pipeline: lại chờ, không giả sẵn sàng
    // Số chờ giảm lại (vật dựng xong) → hết kẹt, sẵn sàng thật.
    broken.visible = true;
    r._pipelines.isReady = () => true;
    r._nodes.get = () => ({ nodeBuilderState: {} });
    lw.levelWarmFrame(scene, drawShown); // khung tự vẽ (không do levelReadiness ép)
    expect(of('L2')).toMatchObject({ ready: true, stalled: false });
  });
});
