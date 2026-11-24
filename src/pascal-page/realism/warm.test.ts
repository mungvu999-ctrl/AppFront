/** @vitest-environment node */
import { describe, expect, it, vi } from 'vitest';

import { coversScreen, screenSize } from './build-order';
import { LOAD_CAP_MS } from './loadOverlay';
import { beginFirstLoad, BUILD_BUDGET_MS, compileActiveSince, endFirstLoad, installAsyncNodeBuilds, installAsyncPipelines, installLazyDispose, isFirstLoad, isStructure, liveFrame, LOAD_DRAW_MS, markDrawReady, warmStats } from './warm';

// Registry giả của vendor: chỉ gốc kết cấu `wall` (không nạp cả `@pascal-app/core` trong node).
const registry = vi.hoisted(() => {
  const nodes = Object.assign(new Map<string, unknown>(), { revision: 0 });
  return { nodes, byType: { wall: new Set<string>() } as Record<string, Set<string>> };
});
vi.mock('@pascal-app/core', () => ({ sceneRegistry: registry }));

describe('installAsyncPipelines', () => {
  it('chỉ vật của cảnh chính trong khung sống tạo pipeline bất đồng bộ, và đếm lúc xong', async () => {
    let resolve!: () => void;
    const getForRender = vi.fn((_ro: unknown, promises?: Promise<unknown>[] | null) => {
      promises?.push(new Promise<void>((r) => (resolve = r)));
    });
    const renderer: { _pipelines: { getForRender: typeof getForRender; updateForRender(ro: unknown): void } } = {
      _pipelines: { getForRender, updateForRender: () => undefined },
    };
    installAsyncPipelines(renderer, false);
    installAsyncPipelines(renderer, false); // gọi mỗi khung: chỉ bọc một lần
    const scene = {};
    renderer._pipelines.updateForRender({ scene });
    expect(getForRender).toHaveBeenLastCalledWith({ scene }); // ngoài khung sống: đồng bộ như cũ
    const quad = { scene: {} };
    liveFrame(scene, () => renderer._pipelines.updateForRender(quad));
    expect(getForRender).toHaveBeenLastCalledWith(quad); // quad hậu kỳ / cảnh khác: đồng bộ
    liveFrame(scene, () => renderer._pipelines.updateForRender({ scene }));
    expect(getForRender).toHaveBeenLastCalledWith({ scene }, expect.any(Array));
    expect(warmStats().pending).toBe(1);
    const later = performance.now() + 60_000;
    expect(compileActiveSince(later)).toBe(later); // còn pipeline chờ: đang biên dịch
    resolve();
    await Promise.resolve();
    expect(warmStats().pending).toBe(0);
    expect(compileActiveSince(later)).toBeLessThan(later); // xong: mốc hoạt động cuối
  });

  it('?disable=warm thì không đụng renderer', () => {
    const original = () => undefined;
    const renderer = { _pipelines: { getForRender: vi.fn(), updateForRender: original } };
    installAsyncPipelines(renderer, true);
    expect(renderer._pipelines.updateForRender).toBe(original);
  });
});

describe('installAsyncNodeBuilds', () => {
  const setup = (buildMs = 0) => {
    const cache = new Map<string, unknown>();
    const data = new Map<unknown, { nodeBuilderState?: unknown }>();
    const seenTargets: unknown[] = [];
    const drawn: unknown[] = [];
    const nodes = {
      get: (ro: unknown) => data.get(ro) ?? (data.set(ro, {}), data.get(ro)!),
      nodeBuilderCache: cache,
      getForRenderCacheKey: (ro: unknown) => String((ro as { key: string }).key),
      // three: `_createNodeBuilder(renderObject, material)`; bản giả không cần tham số.
      _createNodeBuilder: (): { renderer: unknown } => ({ renderer }),
      getForRenderAsync(ro: unknown) {
        const builder = (this._createNodeBuilder as (r: unknown, m: unknown) => { renderer: unknown })(ro, null);
        seenTargets.push((builder.renderer as { getRenderTarget(): unknown }).getRenderTarget());
        const until = performance.now() + buildMs;
        while (performance.now() < until) {
          /* đoạn dựng đồng bộ đầu */
        }
        return Promise.resolve().then(() => cache.set(String((ro as { key: string }).key), {}));
      },
    };
    const renderer = {
      _nodes: nodes,
      _objects: { get: (object: unknown) => object },
      _renderObjectDirect: (...args: unknown[]) => void drawn.push(args[0]),
      _currentRenderContext: null,
      contextNode: null,
      target: 'pass-target' as unknown,
      getRenderTarget() {
        return this.target;
      },
      getMRT: () => 'pass-mrt',
    };
    installAsyncNodeBuilds(renderer, false);
    const draw = (scene: unknown, ...objects: unknown[]) => {
      for (const o of objects) renderer._renderObjectDirect(o, null, scene);
    };
    return { renderer, draw, drawn, seenTargets };
  };

  it('ngoài khung sống vẽ như cũ; trong khung sống bỏ qua vật chưa có shader, dựng với đích của khung', async () => {
    const { renderer, draw, drawn, seenTargets } = setup();
    const scene = {};
    const a = { key: 'a' };
    draw(scene, a);
    expect(drawn).toEqual([a]);
    liveFrame(scene, () => draw(scene, a)); // khung đầu: xếp hạng (build-order)
    liveFrame(scene, () => draw(scene, a));
    expect(drawn).toEqual([a]); // chưa vẽ: đang dựng
    renderer.target = null; // khung đã xong, renderer trả đích về
    await Promise.resolve();
    await Promise.resolve();
    expect(seenTargets).toEqual(['pass-target']);
    liveFrame(scene, () => draw(scene, a));
    expect(drawn).toEqual([a, a]); // dựng xong → vẽ
  });

  it('nhiều vật cùng khoá shader chỉ dựng một lần', () => {
    const { draw, seenTargets } = setup();
    const scene = {};
    const frame = () => liveFrame(scene, () => draw(scene, { key: 'k' }, { key: 'k' }, { key: 'k' }));
    frame();
    frame();
    expect(seenTargets).toHaveLength(1);
  });

  it('hết ngân sách khung thì để vật còn lại cho khung sau', () => {
    const { draw, seenTargets } = setup(BUILD_BUDGET_MS + 2);
    const scene = {};
    const frame = () => liveFrame(scene, () => draw(scene, { key: 'x' }, { key: 'y' }));
    frame();
    frame();
    expect(seenTargets).toHaveLength(1);
    expect(warmStats().buildsPending).toBeGreaterThan(0);
  });

  it('lần nạp đầu: chỉ còn đồ đạc thì vẽ mỗi LOAD_DRAW_MS', () => {
    const { draw, seenTargets } = setup(BUILD_BUDGET_MS + 2);
    const scene = {};
    const t = performance.now();
    beginFirstLoad(t);
    let draws = 0;
    const frame = (at: number) =>
      liveFrame(scene, () => {
        draws++;
        draw(scene, { key: 'p' }, { key: 'q' });
      }, at);
    frame(t);
    frame(t + 10); // bỏ: chưa đủ LOAD_DRAW_MS
    expect(draws).toBe(1);
    frame(t + LOAD_DRAW_MS);
    expect(draws).toBe(2);
    expect(seenTargets).toHaveLength(2);
    endFirstLoad();
    frame(t + LOAD_DRAW_MS + 1);
    expect(draws).toBe(3);
  });

  it('vật liệu còn ảnh đang nạp: chưa dựng; ảnh về (texturesready) thì dựng', async () => {
    const { renderer, seenTargets } = setup();
    const scene = {};
    const listeners: (() => void)[] = [];
    const mat = {
      userData: { texPending: 1 },
      addEventListener: (_: string, f: () => void) => void listeners.push(f),
      removeEventListener: () => undefined,
    };
    const frame = () => liveFrame(scene, () => renderer._renderObjectDirect({ key: 'tex' }, mat, scene));
    frame();
    frame();
    expect(seenTargets).toHaveLength(0);
    expect(warmStats().texWaiting).toBe(1);
    mat.userData.texPending = 0;
    for (const f of listeners) f();
    await Promise.resolve();
    await Promise.resolve();
    expect(warmStats().texWaiting).toBe(0);
    frame();
    frame();
    expect(seenTargets).toHaveLength(1);
  });
});

describe('thứ tự dựng (build-order)', () => {
  const sized = (key: string, radius: number) => ({
    key,
    matrixWorld: { elements: [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1] },
    geometry: { boundingSphere: { center: { x: 0, y: 0, z: -10 }, radius }, computeBoundingSphere: () => undefined },
  });
  const camera = { matrixWorld: { elements: [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1] } };

  it('vật lớn trên màn hình dựng trước; bóng đổ chờ lượt chính hết hàng', () => {
    const order: string[] = [];
    const nodes = {
      get: () => ({}),
      nodeBuilderCache: new Map<string, unknown>(),
      getForRenderCacheKey: (ro: unknown) => (ro as { key: string }).key,
      _createNodeBuilder: () => ({ renderer: null }),
      getForRenderAsync(ro: unknown) {
        order.push((ro as { key: string }).key);
        const until = performance.now() + BUILD_BUDGET_MS + 1;
        while (performance.now() < until) {
          /* một bản dựng đã hết ngân sách khung */
        }
        return new Promise<never>(() => undefined);
      },
    };
    const renderer = {
      _nodes: nodes,
      _objects: { get: (object: unknown, material: unknown) => (material ? { key: `shadow-${(object as { key: string }).key}` } : object) },
      _renderObjectDirect: vi.fn<(...args: unknown[]) => void>(),
      _currentRenderContext: null,
      contextNode: null,
      getRenderTarget: () => null,
      getMRT: () => null,
    };
    installAsyncNodeBuilds(renderer, false);
    const scene = {};
    const small = sized('small', 0.2);
    const room = sized('room', 5);
    const shadow = { isShadowPassMaterial: true };
    liveFrame(scene, () => undefined); // hàng chờ của test trước về 0
    const main = () =>
      liveFrame(scene, () => {
        renderer._renderObjectDirect(small, null, scene, camera);
        renderer._renderObjectDirect(room, null, scene, camera);
      });
    main();
    expect(order).toEqual([]); // khung đầu chỉ xếp hạng
    main();
    expect(order).toEqual(['room']); // khung sau: vật lớn nhất, dựng ngay tại chỗ vẽ
    const lamp = sized('lamp', 0.1);
    const frame = () =>
      liveFrame(scene, () => {
        renderer._renderObjectDirect(lamp, shadow, scene, camera); // bóng vẽ trước lượt chính trong khung
        renderer._renderObjectDirect(small, null, scene, camera);
      });
    frame();
    expect(order).toEqual(['room', 'small']); // khung trước còn hàng chờ chính → bóng đợi
    frame();
    expect(order).toEqual(['room', 'small', 'shadow-lamp']); // hết hàng chờ chính → dựng bóng
  });

  it('bản dựng nhanh thì một khung khởi động nhiều khoá (trong ngân sách)', () => {
    const order: string[] = [];
    const nodes = {
      get: () => ({}),
      nodeBuilderCache: new Map<string, unknown>(),
      getForRenderCacheKey: (ro: unknown) => (ro as { key: string }).key,
      _createNodeBuilder: () => ({ renderer: null }),
      getForRenderAsync(ro: unknown) {
        order.push((ro as { key: string }).key);
        return new Promise<never>(() => undefined);
      },
    };
    const renderer = {
      _nodes: nodes,
      _objects: { get: (object: unknown) => object },
      _renderObjectDirect: vi.fn<(...args: unknown[]) => void>(),
      _currentRenderContext: null,
      contextNode: null,
      getRenderTarget: () => null,
      getMRT: () => null,
    };
    installAsyncNodeBuilds(renderer, false);
    const scene = {};
    const objs = Array.from({ length: 12 }, (_, i) => sized(`k${i}`, i + 1));
    liveFrame(scene, () => undefined);
    let most = 0;
    for (let f = 0; f < 20 && order.length < objs.length; f++) {
      const before = order.length;
      liveFrame(scene, () => objs.forEach((o) => renderer._renderObjectDirect(o, null, scene, camera)));
      most = Math.max(most, order.length - before);
    }
    expect(order).toHaveLength(objs.length);
    expect(most).toBeGreaterThan(1); // thời gian dựng trung bình hạ → nhiều khoá mỗi khung
  });

  it('lần nạp đầu: kết cấu dựng trước đồ đạc lớn hơn; xong kết cấu thì vẽ ngay, không đợi nhịp', async () => {
    const order: string[] = [];
    const resolvers: (() => void)[] = [];
    const nodes = {
      get: () => ({}),
      nodeBuilderCache: new Map<string, unknown>(),
      getForRenderCacheKey: (ro: unknown) => (ro as { key: string }).key,
      _createNodeBuilder: () => ({ renderer: null }),
      getForRenderAsync(ro: unknown) {
        order.push((ro as { key: string }).key);
        return new Promise<void>((res) => resolvers.push(res));
      },
    };
    const renderer = {
      _nodes: nodes,
      _objects: { get: (object: unknown) => object },
      _renderObjectDirect: vi.fn<(...args: unknown[]) => void>(),
      _currentRenderContext: null,
      contextNode: null,
      getRenderTarget: () => null,
      getMRT: () => null,
    };
    installAsyncNodeBuilds(renderer, false);
    const wallRoot = {};
    registry.nodes.set('w1', wallRoot);
    registry.byType.wall!.add('w1');
    registry.nodes.revision++;
    const wall = { ...sized('wall', 0.5), parent: wallRoot }; // nhỏ trên màn hình
    const sofa = sized('sofa', 5); // lớn hơn nhiều
    expect(isStructure(wall)).toBe(true);
    expect(isStructure(sofa)).toBe(false);
    const scene = {};
    const t = performance.now() + LOAD_CAP_MS; // xa mọi mốc nạp đầu của test trước
    endFirstLoad();
    beginFirstLoad(t);
    let draws = 0;
    const frame = (at: number) =>
      liveFrame(scene, () => {
        draws++;
        renderer._renderObjectDirect(sofa, null, scene, camera);
        renderer._renderObjectDirect(wall, null, scene, camera);
      }, at);
    frame(t); // xếp hạng
    frame(t + 1); // còn kết cấu chờ → vẽ ngay; chỉ khởi động kết cấu
    expect(order).toEqual(['wall']);
    expect(draws).toBe(2);
    frame(t + 2); // hết hàng kết cấu: đồ đạc tới lượt (khung này chỉ xếp hạng)
    frame(t + LOAD_DRAW_MS + 2);
    expect(order).toEqual(['wall', 'sofa']);
    const before = draws;
    frame(t + LOAD_DRAW_MS + 3); // chỉ còn đồ đạc: bỏ khung (nhịp ≤ 5/s)
    expect(draws).toBe(before);
    resolvers[0]!(); // bản dựng tường xong
    await Promise.resolve();
    await Promise.resolve();
    frame(t + LOAD_DRAW_MS + 4); // kết cấu vừa xong → vẽ ngay dù chưa đủ LOAD_DRAW_MS
    expect(draws).toBe(before + 1);
    endFirstLoad();
    registry.byType.wall!.clear();
    registry.nodes.clear();
    registry.nodes.revision++;
  });

  it('mốc nạp đầu: tính từ lúc nạp bắt đầu, renderer gắn lại giữa chừng không dời mốc', () => {
    endFirstLoad();
    const t = performance.now() + 2 * LOAD_CAP_MS;
    expect(beginFirstLoad(t)).toBe(t + LOAD_CAP_MS);
    expect(beginFirstLoad(t + 7_000)).toBe(t + LOAD_CAP_MS); // renderer mới lúc 7 s: giữ mốc cũ
    expect(isFirstLoad(t + LOAD_CAP_MS - 1)).toBe(true);
    expect(isFirstLoad(t + LOAD_CAP_MS)).toBe(false);
    expect(beginFirstLoad(t + LOAD_CAP_MS + 1)).toBe(t + 2 * LOAD_CAP_MS + 1); // lần nạp sau: mốc mới
    endFirstLoad();
  });

  it('L7-04: lần nạp đầu giữ hàng BVH nền, nhả khi nhãn gỡ hoặc tới mốc', () => {
    vi.useFakeTimers();
    try {
      const held = () => (globalThis as { __pascalBvhHold?: boolean }).__pascalBvhHold;
      endFirstLoad();
      expect(held()).toBe(false);
      const now = performance.now();
      beginFirstLoad(now);
      expect(held()).toBe(true);
      endFirstLoad(); // nhãn gỡ
      expect(held()).toBe(false);
      beginFirstLoad(performance.now() + 2 * LOAD_CAP_MS); // lần nạp sau (mốc mới)
      expect(held()).toBe(true);
      vi.advanceTimersByTime(3 * LOAD_CAP_MS); // renderer gỡ giữa chừng: không ai gọi endFirstLoad
      expect(held()).toBe(false);
    } finally {
      endFirstLoad();
      vi.useRealTimers();
    }
  });

  it('screenSize: bán kính / khoảng cách, 0 khi thiếu dữ liệu', () => {
    expect(screenSize(sized('a', 1), camera)).toBeCloseTo(0.1);
    expect(screenSize({}, camera)).toBe(0);
    expect(coversScreen({ frustumCulled: false })).toBe(true); // nền phủ màn hình: dựng ngay
    expect(coversScreen({ frustumCulled: false, isBatchedMesh: true })).toBe(false);
  });
});

describe('installLazyDispose', () => {
  it('render object chưa có bindings: chỉ xoá dữ liệu, không gọi đường xoá dựng shader', () => {
    const deleteForRender = vi.fn();
    const del = vi.fn();
    const renderer = { _bindings: { deleteForRender, delete: del } };
    installLazyDispose(renderer, false);
    installLazyDispose(renderer, false);
    const never = { _bindings: null };
    renderer._bindings.deleteForRender(never);
    expect(deleteForRender).not.toHaveBeenCalled();
    expect(del).toHaveBeenCalledWith(never);
    const built = { _bindings: [] };
    renderer._bindings.deleteForRender(built);
    expect(deleteForRender).toHaveBeenCalledWith(built);
  });
});

describe('markDrawReady', () => {
  it('chỉ lưới gộp, lượt chính, pipeline đã sẵn mới được đánh dấu vẽ được', () => {
    const ready = { _pipelines: { isReady: () => true } };
    const notReady = { _pipelines: { isReady: () => false } };
    const batch = { isBatchedMesh: true, userData: {} as Record<string, unknown> };
    markDrawReady(batch, {}, {}, notReady);
    expect(batch.userData.drawReady).toBeUndefined();
    markDrawReady(batch, { isShadowPassMaterial: true }, {}, ready);
    expect(batch.userData.drawReady).toBeUndefined();
    markDrawReady(batch, {}, {}, ready);
    expect(batch.userData.drawReady).toBe(true);
    const mesh = { userData: {} as Record<string, unknown> };
    markDrawReady(mesh, {}, {}, ready);
    expect(mesh.userData.drawReady).toBeUndefined();
  });
});
