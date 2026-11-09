// @vitest-environment node
/**
 * Đầu dò `?probe=1` (I5): không cờ thì không gắn; có cờ thì đọc store Pascal.
 *
 * Store Pascal ở đây là bản giả: vitest không nạp được `@pascal-app/*` thật khi gói chưa
 * dựng `dist/*.js`, nên bài kiểm gọi thẳng `./createProbe` (phần `./probe` chỉ nối store thật).
 */
import { describe, expect, it, vi } from 'vitest';

import { installPascalProbe, type PascalProbe, type PascalProbeStores } from '../createProbe';

const fakeStores = () => {
  const registry = new Map<string, { userData: Record<string, unknown> }>();
  const updateNode = vi.fn();
  const setControlValue = vi.fn();
  const stores = {
    useScene: {
      getState: () => ({
        nodes: {
          w1: { type: 'wall', slots: { interior: 'scene:plaster' }, skirting: { height: 0.1 } },
          w2: { type: 'wall', start: [0, 0], end: [4, 0], thickness: 0.2, height: 2.7 },
          s1: { type: 'slab', slots: { surface: 'scene:wood' } },
          s2: { type: 'slab', materialPreset: 'tile' },
          i1: { type: 'item', position: [1, 0, 2], rotation: [0, -1.5, 0], asset: { src: '/items/bed/model.glb' } },
        },
        updateNode,
      }),
    },
    useViewer: { getState: () => ({ itemLoadFailures: { i2: '/items/x/model.glb' }, shading: 'rendered' }) },
    sceneRegistry: { nodes: registry },
    emitter: { emit: vi.fn() },
    useInteractive: { getState: () => ({ lampItems: { L1: [0], L2: [1] }, setControlValue }) },
  } satisfies PascalProbeStores;
  return { stores, registry, updateNode, setControlValue };
};

const install = (search: string, stores: PascalProbeStores) => {
  const target: { __pascalProbe?: PascalProbe } = {};
  installPascalProbe(search, target, stores);
  return target.__pascalProbe;
};

describe('pascal probe', () => {
  it('không gắn khi thiếu ?probe=1', () => {
    const { stores } = fakeStores();
    expect(install('?project=p1', stores)).toBeUndefined();
    expect(install('?project=p1&probe=0', stores)).toBeUndefined();
  });

  it('counts() gom node theo loại; ready() chờ mọi item đã ổn; materials() đọc slot', () => {
    const { stores, registry } = fakeStores();
    const probe = install('?project=p1&probe=1', stores);

    expect(probe?.counts()).toEqual({ wall: 2, slab: 2, item: 1 });
    expect(probe?.materials().slabs).toEqual({ s1: 'scene:wood', s2: 'tile' });
    expect(probe?.materials().walls.w1).toEqual({
      slots: { interior: 'scene:plaster' },
      skirting: { height: 0.1 },
      crown: undefined,
    });
    expect(probe?.itemLoadFailures()).toEqual({ i2: '/items/x/model.glb' });
    expect(probe?.shading()).toBe('rendered');

    expect(probe?.ready()).toBe(false);
    registry.set('i1', { userData: { itemModelSettled: true } });
    expect(probe?.ready()).toBe(true);
  });

  it('setCamera phát apply-pose; top-ortho thành phép chiếu trực giao', () => {
    const { stores } = fakeStores();
    const probe = install('?probe=1', stores);
    probe?.setCamera([0, 30, 0], [0, 0, 0], 'top-ortho');
    probe?.setCamera([5, 5, 5], [0, 0, 0], 40);
    expect(stores.emitter.emit.mock.calls).toEqual([
      ['camera-controls:apply-pose', { position: [0, 30, 0], target: [0, 0, 0], projection: 'orthographic' }],
      ['camera-controls:apply-pose', { position: [5, 5, 5], target: [0, 0, 0], projection: 'perspective', fov: 40 }],
    ]);
  });

  it('walls() trả hình học tường (C9)', () => {
    const { stores } = fakeStores();
    expect(install('?probe=1', stores)?.walls()).toEqual([
      { id: 'w1', start: [0, 0], end: [0, 0], thickness: undefined, height: undefined },
      { id: 'w2', start: [0, 0], end: [4, 0], thickness: 0.2, height: 2.7 },
    ]);
  });

  it('items() trả vị trí, góc quay và mô hình của item (C8)', () => {
    const { stores } = fakeStores();
    expect(install('?probe=1', stores)?.items()).toEqual([
      { id: 'i1', position: [1, 0, 2], rotation: [0, -1.5, 0], src: '/items/bed/model.glb' },
    ]);
  });

  it('rooms() và openings() trả phòng (zone) và ô mở (m4-l5)', () => {
    const { stores } = fakeStores();
    const nodes = {
      level_a: { type: 'level', level: 0 },
      z1: { type: 'zone', name: 'PN', parentId: 'level_a', polygon: [[0, 0], [4, 0], [4, 3]], metadata: { appfront: { fields: { usage: 'bedroom' } } } },
      d1: { type: 'door', wallId: 'w2', position: [1, 1, 0], width: 0.9 },
      n1: { type: 'window', wallId: 'w2', position: [2, 1.5, 0], width: 1.2 },
    };
    const probe = install('?probe=1', { ...stores, useScene: { getState: () => ({ nodes, updateNode: vi.fn() }) } });
    expect(probe?.rooms()).toEqual([{ id: 'z1', name: 'PN', usage: 'bedroom', polygon: [[0, 0], [4, 0], [4, 3]], levelId: 'level_a', levelIndex: 0 }]);
    expect(probe?.openings().map((o) => [o.id, o.type, o.wallId])).toEqual([['d1', 'door', 'w2'], ['n1', 'window', 'w2']]);
  });

  it('editNode() gọi useScene.updateNode (móc C13)', () => {
    const { stores, updateNode } = fakeStores();
    install('?probe=1', stores)?.editNode('w2', { thickness: 0.3 });
    expect(updateNode.mock.calls).toEqual([['w2', { thickness: 0.3 }]]);
  });

  it('setLights() bật/tắt công tắc của mọi đèn trong lampItems (C10)', () => {
    const { stores, setControlValue } = fakeStores();
    install('?probe=1', stores)?.setLights(false);
    expect(setControlValue.mock.calls).toEqual([
      ['L1', 0, false],
      ['L2', 1, false],
    ]);
  });
});
