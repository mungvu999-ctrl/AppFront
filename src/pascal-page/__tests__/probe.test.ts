// @vitest-environment node
/**
 * Đầu dò `?probe=1` (I5): không cờ thì không gắn; có cờ thì đọc store Pascal.
 *
 * Store Pascal ở đây là bản giả: vitest không nạp được `@pascal-app/*` thật khi gói chưa
 * dựng `dist/*.js`, nên bài kiểm gọi thẳng `./createProbe` (phần `./probe` chỉ nối store thật).
 */
import { describe, expect, it, vi } from 'vitest';

import { createSceneTrace, installPascalProbe, type PascalProbe, type PascalProbeStores } from '../createProbe';

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

  it('counts() gom node theo loại; ready() chờ thư viện + concept chốt và mọi item đã ổn; materials() đọc slot', () => {
    const { stores, registry } = fakeStores();
    const trace = createSceneTrace(false);
    const probe = install('?project=p1&probe=1', { ...stores, trace });

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
    expect(probe?.ready()).toBe(false); // thư viện/concept còn treo: nội dung còn có thể đổi
    trace.source('library', 'fallback:timeout');
    expect(probe?.ready()).toBe(false);
    trace.source('concept', 'none'); // ghi cả khi nhật ký tắt
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

  it('node() trả bản sao JSON của node (vá sâu trước editNode), null khi không có', () => {
    const { stores } = fakeStores();
    const probe = install('?probe=1', stores);
    const copy = probe?.node('w2') as { thickness: number } | null;
    expect(copy).toMatchObject({ type: 'wall', thickness: 0.2 });
    if (copy !== null && copy !== undefined) copy.thickness = 9;
    expect(probe?.node('w2')).toMatchObject({ thickness: 0.2 });
    expect(probe?.node('khong-co')).toBeNull();
  });

  it('setLights() bật/tắt công tắc của mọi đèn trong lampItems (C10)', () => {
    const { stores, setControlValue } = fakeStores();
    install('?probe=1', stores)?.setLights(false);
    expect(setControlValue.mock.calls).toEqual([
      ['L1', 0, false],
      ['L2', 1, false],
    ]);
  });

  it('repairs() trả danh sách sửa cảnh (rỗng khi không nối nguồn)', () => {
    const { stores } = fakeStores();
    expect(install('?probe=1', stores)?.repairs()).toEqual([]);
    const repair = { furnitureId: 'F-1', action: 'hidden', rule: 'roomMismatch', reasonVi: 'x', before: { centre: { x: 0, y: 0 }, rotationDeg: 0 } };
    expect(install('?probe=1', { ...stores, repairs: () => [repair] })?.repairs()).toEqual([repair]);
  });

  it('renderer() đọc tone mapper thật của renderer (null khi chưa có renderer)', () => {
    const { stores } = fakeStores();
    expect(install('?probe=1', stores)?.renderer()).toBeNull();
    const gl = { toneMapping: 4, toneMappingExposure: 0.8, outputColorSpace: 'srgb' };
    expect(install('?probe=1', { ...stores, renderer: () => ({ gl, backend: 'webgpu', tone: null }) })?.renderer()).toEqual({
      toneMapping: 4,
      toneMappingName: 'ACESFilmic',
      toneMappingExposure: 0.8,
      outputColorSpace: 'srgb',
      backend: 'webgpu',
      tone: null,
    });
    const agx = { toneMapping: 6, toneMappingExposure: 0.736, outputColorSpace: 'srgb' };
    expect(install('?probe=1', { ...stores, renderer: () => ({ gl: agx, backend: 'webgpu', tone: 'agx-cal' }) })?.renderer()).toMatchObject({
      toneMappingName: 'AgX',
      tone: 'agx-cal',
    });
  });

  it('sceneState(): lượt dựng + lượt áp có gen tăng dần; áp thiếu món/sàn khác là partial; ready chỉ khi áp đủ', () => {
    const { stores } = fakeStores();
    let clock = 100;
    const trace = createSceneTrace(true, () => clock);
    trace.countServerModels = () => 7;
    const probe = install('?probe=1', { ...stores, trace });
    const builtNodes = {
      a: { type: 'item', metadata: { generated: 'dressing' } },
      b: { type: 'item' },
      s: { type: 'slab', slots: { surface: 'library:flooring-woodparquet76' } },
    };
    expect(probe?.sceneState().ready).toBe(false);
    trace.built({ reason: 'load', style: 'am-ap', furnish: 'on', serverModels: 0, nLevels: 1, nFurnitureStored: 1, raw: false, repairsEnabled: true, readOnly: true, nItemsScene: 2, nGenerated: 1, slabMaterials: { 'library:flooring-woodparquet76': 1 } });
    clock = 250;
    trace.held('editor-holds', { b: builtNodes.b, s: { type: 'slab', slots: { surface: 'scene:x' } } });
    let state = probe?.sceneState();
    expect(state?.builds.map((b) => [b.gen, b.at, b.applied, b.reason])).toEqual([
      [1, 100, 'built', 'load'],
      [2, 250, 'partial', 'editor-holds<-gen1'],
    ]);
    expect(state?.ready).toBe(false);
    trace.held('editor-holds', builtNodes);
    expect(probe?.sceneState().ready).toBe(false); // áp đủ nhưng nguồn chưa chốt
    trace.source('library', 'server');
    trace.source('concept', 'fallback:network');
    state = probe?.sceneState();
    expect(state?.ready).toBe(true);
    expect(state).toMatchObject({ library: 'server', concept: 'fallback:network' });
    expect(state?.builds[2]).toMatchObject({ applied: 'full', nItemsScene: 2, nGenerated: 1 });
    // `now`: kho editor lúc gọi (bản giả có 1 item, 2 sàn) + thư viện máy chủ hiện tại.
    expect(state?.now).toMatchObject({ nItemsScene: 1, nGenerated: 0, slabMaterials: { 'scene:wood': 1, tile: 1 }, serverModelsNow: 7, itemLoadFailures: 1 });
  });

  it('sceneTrace tắt (không ?probe=1) thì không ghi; giữ tối đa 50 dòng', () => {
    const off = createSceneTrace(false);
    expect(off.built({ reason: 'x', nItemsScene: 0, nGenerated: 0, slabMaterials: {} })).toBe(0);
    off.held('y', {});
    expect(off.state().builds).toEqual([]);
    const on = createSceneTrace(true, () => 0);
    for (let i = 0; i < 60; i += 1) on.held('h', {});
    expect(on.state().builds).toHaveLength(50);
    expect(on.state().generation).toBe(60);
  });
});
