/**
 * Đường lưu của màn Pascal, chạy đủ năm chặng trên store thật.
 *
 * Bài quan trọng nhất là bài thứ hai: **một lượt sửa trong Pascal phải tới được
 * `state.spatial`.** Hỏng nó thì màn hình hiện một bức tường mới, người dùng tin
 * là đã lưu, và không có nút lưu nào để họ thử lại — A7 không cho họ cơ hội ấy.
 */

import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { createSampleBuilding } from '@/domain/spatial/__fixtures__/sampleBuilding';
import { denormalizeSpatial, normalizeSpatial, type NormalizedSpatial } from '@/domain/spatial/normalize';
import type { Furniture, Room } from '@/domain/spatial/types';
import { degrees } from '@/domain/units/types';
import { registerServerLibrary } from '@/lib/pascal/furnitureCatalog';
import { isGeneratedLightId, isGeneratedNodeId } from '@/lib/pascal/sceneDressing';
import { SCENE_STYLES } from '@/lib/pascal/sceneStyles';
import { toPascalScene } from '@/lib/pascal/toPascal';
import type { PascalNode, PascalScene } from '@/lib/pascal/types';
import { useStore } from '@/store';

import {
  blockedGeneratedDeletes,
  blockedGeneratedEdits,
  commitOfScenes,
  PASCAL_READ_ONLY_REASON,
  settledScene,
  CEILING_LIGHT_MOVE_BLOCKED,
  GENERATED_EDIT_BLOCKED,
  SUGGESTION_ACCEPTED_NOTICE,
  unsavedEditsOf,
  unsavedPascalEdits,
  usePascalEdits,
} from './usePascalEdits';

const BUILDING = createSampleBuilding();
const SPATIAL = normalizeSpatial(BUILDING);
const SCENE = toPascalScene(BUILDING).scene;

/** Tường, không phải `PascalNode` chung: nhánh hẹp mới spread thêm `thickness` được. */
const firstWall = (): Extract<PascalNode, { readonly type: 'wall' }> => {
  const wall = Object.values(SCENE.nodes).find((node) => node.type === 'wall');

  if (wall === undefined || wall.type !== 'wall') {
    throw new Error('bộ mẫu phải có ít nhất một tường');
  }

  return wall;
};

/** Cảnh nền, tường đầu tiên dày thêm 130 mm. */
const thickened = (): PascalScene => {
  const wall = firstWall();

  return {
    nodes: { ...SCENE.nodes, [wall.id]: { ...wall, thickness: 0.33 } },
    rootNodeIds: SCENE.rootNodeIds,
  };
};

const mount = (
  overrides: {
    readonly readOnly?: boolean;
    readonly onRejected?: (reason: string) => void;
    readonly onMassDelete?: (request: { nodeIds: readonly string[]; reason: string }) => void;
    readonly onUnsaved?: (labels: readonly string[]) => void;
    readonly onNotice?: (message: string) => void;
  } = {},
) =>
  renderHook(() =>
    usePascalEdits({
      spatial: useStore.getState().spatial,
      loadedScene: SCENE,
      readOnly: overrides.readOnly ?? false,
      onRejected: overrides.onRejected ?? (() => undefined),
      ...(overrides.onMassDelete === undefined ? {} : { onMassDelete: overrides.onMassDelete }),
      ...(overrides.onUnsaved === undefined ? {} : { onUnsaved: overrides.onUnsaved }),
      ...(overrides.onNotice === undefined ? {} : { onNotice: overrides.onNotice }),
    }),
  );

/** Cảnh nền bỏ hẳn mọi tường — đúng thứ `MASS_DELETE_RATIO` tồn tại để chặn. */
const gutted = (): PascalScene => ({
  nodes: Object.fromEntries(Object.entries(SCENE.nodes).filter(([, node]) => node.type !== 'wall')),
  rootNodeIds: SCENE.rootNodeIds,
});

beforeEach(() => {
  act(() => {
    useStore.getState().setSpatial(SPATIAL, null);
  });
});

afterEach(() => {
  act(() => {
    useStore.getState().setSpatial(null, null);
  });
});

describe('commitOfScenes', () => {
  it('hai cảnh y hệt: không có lượt ghi nào', () => {
    expect(commitOfScenes(SCENE, SCENE)).toBeNull();
  });

  it('một tường đổi: đúng node ấy vào danh sách đã đổi, danh sách xoá rỗng', () => {
    const commit = commitOfScenes(SCENE, thickened());

    expect(commit?.changedNodeIds).toEqual([firstWall().id]);
    expect(commit?.removedNodeIds).toEqual([]);
  });

  it('sàn Pascal tự đặt theo tường (`autoFromWalls`) không vào lượt ghi; chỉ có nó thì không có lượt nào', () => {
    const slab = Object.values(SCENE.nodes).find((node) => node.type === 'slab') as PascalNode;
    const auto = { ...slab, id: 'slab_auto1', autoFromWalls: true } as PascalNode;
    const withAuto: PascalScene = { nodes: { ...SCENE.nodes, slab_auto1: auto }, rootNodeIds: SCENE.rootNodeIds };

    expect(commitOfScenes(SCENE, withAuto)).toBeNull();
    expect(commitOfScenes(withAuto, SCENE)).toBeNull();
    expect(commitOfScenes(SCENE, { ...withAuto, nodes: { ...withAuto.nodes, ...thickened().nodes } })?.changedNodeIds).toEqual([
      firstWall().id,
    ]);
  });
});

/** Cảnh nền với node đầu tiên loại `type` được ghép thêm `patch`. */
const patched = (type: string, patch: Record<string, unknown>): PascalScene => {
  const node = Object.values(SCENE.nodes).find((candidate) => candidate.type === type && !isGeneratedNodeId(candidate.id));

  if (node === undefined) throw new Error(`bộ mẫu phải có ${type}`);

  return { nodes: { ...SCENE.nodes, [node.id]: { ...node, ...patch } as PascalNode }, rootNodeIds: SCENE.rootNodeIds };
};

/** Tham chiếu ghi được (phong cách dùng) và một màu ngoài luật ghi của `toSpatial`. */
const SAVEABLE = SCENE_STYLES['am-ap'].wall.interior;
const FOREIGN = 'library:khong-co-trong-thu-vien';

describe('unsavedPascalEdits (v3 V3 + W3e — phần sửa máy chủ chưa nhận)', () => {
  it('không đổi gì, hay chỉ đổi thứ lưu được (độ dày tường, sơn sàn/tường/đồ bằng tham chiếu ghi được): không báo', () => {
    expect(unsavedPascalEdits(SCENE, SCENE)).toEqual([]);
    expect(unsavedPascalEdits(SCENE, thickened())).toEqual([]);
    expect(unsavedPascalEdits(SCENE, patched('slab', { slots: { surface: SAVEABLE } }))).toEqual([]);
    expect(unsavedPascalEdits(SCENE, patched('wall', { slots: { interior: SAVEABLE } }))).toEqual([]);
    expect(unsavedPascalEdits(SCENE, patched('item', { slots: { body: SAVEABLE } }))).toEqual([]);
    // H4 — kiểu cửa trong từ vựng `swing` + hướng mở, màu trần ghi được: đã lưu.
    expect(unsavedPascalEdits(SCENE, patched('door', { hingesSide: 'right' }))).toEqual([]);
    expect(unsavedPascalEdits(SCENE, patched('door', { doorType: 'folding', leafCount: 4 }))).toEqual([]);
    expect(unsavedPascalEdits(SCENE, patched('door', { swingDirection: 'outward' }))).toEqual([]);
    expect(unsavedPascalEdits(SCENE, patched('window', { windowType: 'casement', casementStyle: 'french' }))).toEqual([]);
    expect(unsavedPascalEdits(SCENE, patched('ceiling', { slots: { surface: SAVEABLE } }))).toEqual([]);
  });

  it.each([
    ['slab', { slots: { surface: FOREIGN } }, 'màu sàn'],
    ['wall', { slots: { exterior: FOREIGN } }, 'màu tường'],
    ['wall', { material: { preset: 'tu-pha' } }, 'màu tường'],
    ['item', { slots: { body: FOREIGN } }, 'màu đồ đạc'],
    ['item', { materialPreset: 'tu-pha' }, 'màu đồ đạc'],
    ['door', { doorType: 'garage-rollup' }, 'kiểu cửa'],
    ['window', { windowType: 'awning' }, 'kiểu cửa'],
    ['ceiling', { slots: { surface: FOREIGN } }, 'màu trần'],
    ['door', { slots: { frame: SAVEABLE } }, 'màu cửa'],
  ])('%s đổi %j → "%s"', (type, patch, label) => {
    expect(unsavedPascalEdits(SCENE, patched(type, patch))).toEqual([label]);
  });

  it('đồ đạc: mẫu /items/… lưu được, mẫu lạ thì báo; màu lạ trên đồ mới; xoá đồ bày sẵn', () => {
    const item = { id: 'item_new', type: 'item', asset: { src: '/items/sofa/model.glb' } } as unknown as PascalNode;
    const added: PascalScene = { nodes: { ...SCENE.nodes, item_new: item }, rootNodeIds: SCENE.rootNodeIds };
    const swapped: PascalScene = {
      nodes: { ...added.nodes, item_new: { ...item, slots: { body: FOREIGN }, asset: { src: 'blob:http://x/ghe.glb' } } as unknown as PascalNode },
      rootNodeIds: SCENE.rootNodeIds,
    };
    const dressed: PascalScene = {
      nodes: { ...SCENE.nodes, 'item_DRESS-sofa-R-1': { ...item, id: 'item_DRESS-sofa-R-1' } as PascalNode },
      rootNodeIds: SCENE.rootNodeIds,
    };

    expect(unsavedPascalEdits(SCENE, added)).toEqual([]);
    expect(unsavedPascalEdits(added, swapped)).toEqual(['màu đồ đạc', 'mẫu đồ đạc']);
    expect(unsavedPascalEdits(SCENE, swapped)).toEqual(['màu đồ đạc', 'mẫu đồ đạc']);
    // Xoá món bày sẵn chưa nhớ được giờ bị chặn cả lượt (`blockedGeneratedDeletes`), không còn "ẩn tạm".
    expect(unsavedPascalEdits(dressed, SCENE)).toEqual([]);
    expect(blockedGeneratedDeletes(dressed, SCENE, ['item_DRESS-sofa-R-1'])).toEqual(['item_DRESS-sofa-R-1']);

    // Mẫu thư viện máy chủ: URL ký không lưu nguyên được nhưng toSpatial lưu `/items/<id>/…` thay vào.
    registerServerLibrary([{ id: 'srv-sofa', widthMm: 2000, heightMm: 800, depthMm: 900, modelUrl: 'https://minio.test/s?sig=1' }]);
    const server: PascalScene = {
      nodes: { ...SCENE.nodes, item_new: { ...item, asset: { id: 'srv-sofa', src: 'https://minio.test/s?sig=1' } } as unknown as PascalNode },
      rootNodeIds: SCENE.rootNodeIds,
    };
    expect(unsavedPascalEdits(SCENE, server)).toEqual([]);

    // H4 — zone khai món ấy (`dressIds`): xoá lưu được (`Room.dressingOff`), không báo.
    const zone = {
      id: 'zone_R-1',
      type: 'zone',
      metadata: { appfront: { confidence: 1, source: 'human', reviewed: false, fields: { dressIds: ['DRESS-sofa-R-1'] } } },
    } as unknown as PascalNode;
    const declared: PascalScene = { nodes: { ...dressed.nodes, 'zone_R-1': zone }, rootNodeIds: SCENE.rootNodeIds };

    expect(unsavedPascalEdits(declared, { nodes: { ...SCENE.nodes, 'zone_R-1': zone }, rootNodeIds: SCENE.rootNodeIds })).toEqual([]);
    expect(blockedGeneratedDeletes(declared, SCENE, ['item_DRESS-sofa-R-1'])).toEqual([]);
    // Mất theo cha (xoá trần kéo theo đèn): cha mới là thứ người dùng xoá, không chặn vì món con.
    const child: PascalScene = {
      nodes: { ...SCENE.nodes, 'item_DRESS-sofa-R-1': { ...item, id: 'item_DRESS-sofa-R-1', parentId: 'ceiling_gone' } as PascalNode },
      rootNodeIds: SCENE.rootNodeIds,
    };
    expect(blockedGeneratedDeletes(child, SCENE, ['item_DRESS-sofa-R-1'])).toEqual([]);
  });
});

/** Cảnh nền + một node đồ phẳng tự sinh (khuôn tấm viền `suggestedOutlineOf`, không `roomId`). */
const withGenerated = (id: string, patch: Record<string, unknown> = {}, from: PascalScene = SCENE): PascalScene => ({
  nodes: {
    ...from.nodes,
    [id]: {
      id,
      type: 'item',
      name: 'bàn (chưa xác nhận)',
      position: [9, 0, 1],
      rotation: [0, 0, 0],
      scale: [1, 1, 1],
      asset: { id: 'appfront-rectangular-carpet', src: 'asset://appfront/table', dimensions: [1.829, 0.004, 0.972] },
      slots: { fabric: 'scene:mat_appfront_unconfirmed' },
      metadata: { generated: 'part', unconfirmed: true, appfront: { confidence: 0.4, source: 'ml', reviewed: false, fields: {} } },
      ...patch,
    } as unknown as PascalNode,
  },
  rootNodeIds: from.rootNodeIds,
});

/** Món tự sinh không có bản ghi nào đứng sau (không phải tấm viền gợi ý). */
const LOOSE_ID = 'item_DRESS-rail-L-1';

describe('blockedGeneratedEdits — món tự sinh không có đường lưu thì chặn, không mất lặng lẽ', () => {
  it('dời / xoay / kéo cỡ / sơn: chặn; không đổi gì, khác thứ tự khoá, hay đồ thật: không chặn', () => {
    const blocked = (patch: Record<string, unknown>) => blockedGeneratedEdits(withGenerated(LOOSE_ID), withGenerated(LOOSE_ID, patch), [LOOSE_ID]);

    expect(blocked({ scale: [1.0547, 1.0547, 1.0547] })).toEqual([LOOSE_ID]);
    expect(blocked({ position: [9.1, 0, 1] })).toEqual([LOOSE_ID]);
    expect(blocked({ rotation: [0, Math.PI / 2, 0] })).toEqual([LOOSE_ID]);
    expect(blocked({ slots: { fabric: SAVEABLE } })).toEqual([LOOSE_ID]);
    expect(blocked({ materialPreset: 'library:oak' })).toEqual([LOOSE_ID]);
    // Lượt nạp đầu khai mọi node "đã đổi": node y nguyên vị trí/góc/tỉ lệ/khe thì không chặn.
    expect(blocked({ name: 'khác' })).toEqual([]);
    expect(blocked({ scale: [1 + 1e-9, 1, 1] })).toEqual([]);
    const pair = { a: 'x', b: 'y' };
    expect(blockedGeneratedEdits(withGenerated(LOOSE_ID, { slots: pair }), withGenerated(LOOSE_ID, { slots: { b: 'y', a: 'x' } }), [LOOSE_ID])).toEqual([]);
    expect(blockedGeneratedEdits(withGenerated(LOOSE_ID, { slots: undefined }), withGenerated(LOOSE_ID, { slots: {} }), [LOOSE_ID])).toEqual([]);
    // Đèn trần tự sinh: phòng khai hộ (`dressIds`) nên dời được, không chặn.
    const light = Object.values(SCENE.nodes).find((node) => node.type === 'item' && node.id.startsWith('item_LIGHT-')) as PascalNode;
    const moved: PascalScene = { ...SCENE, nodes: { ...SCENE.nodes, [light.id]: { ...light, position: [0.5, 0, 0.5] } as PascalNode } };
    expect(blockedGeneratedEdits(SCENE, moved, [light.id])).toEqual([]);
    expect(unsavedPascalEdits(SCENE, moved)).toEqual([]);
    // Màu và cỡ đèn không có chỗ chứa: không chặn, nhưng báo.
    const painted = { ...moved, nodes: { ...moved.nodes, [light.id]: { ...light, slots: { body: SAVEABLE } } as PascalNode } };
    expect(unsavedPascalEdits(SCENE, painted)).toEqual(['màu và cỡ đèn trần']);
    // Đồ thật (id bản vẽ): không chặn.
    expect(blockedGeneratedEdits(withGenerated('item_F-1'), withGenerated('item_F-1', { scale: [2, 2, 2] }), ['item_F-1'])).toEqual([]);
  });

  it('món bày biện có phòng nhận nuôi (V4): không chặn — lượt về nhận nuôi', () => {
    const roomId = BUILDING.rooms[0]?.id ?? '';
    const fields = { roomId, min: { x: 8500, y: 500 }, max: { x: 9500, y: 1500 } };
    const metadata = { appfront: { confidence: 1, source: 'human', reviewed: false, fields } };
    const id = 'item_DRESS-sofa-R-1';

    expect(blockedGeneratedEdits(withGenerated(id, { metadata }), withGenerated(id, { metadata, scale: [1.2, 1.2, 1.2] }), [id])).toEqual([]);
    expect(blockedGeneratedEdits(withGenerated(id, { metadata }), withGenerated(id, { metadata, slots: { fabric: SAVEABLE } }), [id])).toEqual([]);
  });

  it('sơn món không có đường lưu bằng màu ghi được: từ chối kèm câu tiếng Việt không đẩy sang bước khác, bản vẽ không đổi', async () => {
    const onRejected = vi.fn();
    const loaded = withGenerated(LOOSE_ID);
    const { result } = renderHook(() =>
      usePascalEdits({ spatial: useStore.getState().spatial, loadedScene: loaded, readOnly: false, onRejected }),
    );
    const before = useStore.getState().spatial;
    const painted = withGenerated(LOOSE_ID, { slots: { fabric: SAVEABLE } });
    let ok = true;

    expect(result.current.validateCommit(painted)).toEqual({ ok: false, message: GENERATED_EDIT_BLOCKED });
    await act(async () => {
      ok = await result.current.onSceneCommit(painted);
    });

    expect(ok).toBe(false);
    expect(onRejected).toHaveBeenCalledWith(GENERATED_EDIT_BLOCKED);
    expect(useStore.getState().spatial).toBe(before);
    expect(GENERATED_EDIT_BLOCKED).not.toContain('Duyệt');
  });
});

describe('đèn trần không dời được', () => {
  it('đèn quay lại sau Ctrl+Z: không báo, không đặt lại cỡ', () => {
    const light = Object.values(SCENE.nodes).find((node) => isGeneratedLightId(node.id));
    if (light === undefined) throw new Error('bộ mẫu phải có đèn trần');
    const nodes = Object.fromEntries(Object.entries(SCENE.nodes).filter(([id]) => id !== light.id));

    expect(unsavedEditsOf({ ...SCENE, nodes }, SCENE)).toEqual({ labels: [], restoredNodes: {} });
  });

  it('đèn đổi chỗ: chặn kèm câu báo; xoá đèn vẫn lưu', async () => {
    const light = Object.values(SCENE.nodes).find((node) => isGeneratedLightId(node.id));

    if (light?.type !== 'item') throw new Error('bộ mẫu phải có đèn trần');
    const onRejected = vi.fn();
    const view = mount({ onRejected });
    const moved = { ...SCENE, nodes: { ...SCENE.nodes, [light.id]: { ...light, position: [light.position[0] + 0.002, light.position[1], light.position[2]] } } };
    let saved = true;

    await act(async () => {
      saved = await view.result.current.onSceneCommit(moved as PascalScene);
    });
    expect(saved).toBe(false);
    expect(onRejected).toHaveBeenCalledWith(CEILING_LIGHT_MOVE_BLOCKED);

    const nodes = { ...SCENE.nodes };
    delete nodes[light.id];
    await act(async () => {
      saved = await view.result.current.onSceneCommit({ ...SCENE, nodes });
    });
    expect(saved).toBe(true);
  });
});

describe('đồ máy gợi ý — xoá = Bỏ gợi ý, sửa = Nhận gợi ý rồi áp phần sửa, Ctrl+Z về như cũ', () => {
  const realItem = SPATIAL.byKind.furniture[0] ?? '';
  const asSuggestion = (): NormalizedSpatial => {
    const item = SPATIAL.byId[realItem] as Furniture;

    return { ...SPATIAL, byId: { ...SPATIAL.byId, [realItem]: { ...item, suggested: true, source: 'ml', reviewed: false, rotationDeg: degrees(0) } } } as NormalizedSpatial;
  };
  const OUTLINE = `item_DRESS-suggested-${realItem}`;
  /* Như `toPascalScene`: món gợi ý không có node thật, chỉ có tấm viền. */
  const bare = (): PascalScene => ({
    nodes: Object.fromEntries(Object.entries(SCENE.nodes).filter(([id]) => id !== `item_${realItem}`)),
    rootNodeIds: SCENE.rootNodeIds,
  });
  const outlined = (patch: Record<string, unknown> = {}) => withGenerated(OUTLINE, patch, bare());
  const item = () => useStore.getState().spatial?.byId[realItem] as Furniture | undefined;
  const hook = (onRejected = vi.fn(), onNotice = vi.fn()) => {
    const loaded = outlined();
    const view = renderHook(() =>
      usePascalEdits({ spatial: useStore.getState().spatial, loadedScene: loaded, readOnly: false, onRejected, onNotice }),
    );

    return { ...view, onRejected, onNotice };
  };
  /* Bản dựng lại sau mỗi lượt lưu, như cầu Pascal: `spatial` mới theo kho. */
  const save = async (view: ReturnType<typeof hook>, scene: PascalScene) => {
    let ok = false;

    await act(async () => {
      ok = await view.result.current.onSceneCommit(scene);
    });
    view.rerender();

    return ok;
  };

  beforeEach(() => {
    act(() => {
      useStore.getState().setSpatial(asSuggestion(), null);
    });
  });

  it('xoá tấm viền: bản ghi gợi ý mất, không báo lỗi; hiện lại (Ctrl+Z): bản ghi gợi ý về nguyên vẹn', async () => {
    const view = hook();
    const { result, onRejected } = view;
    const original = item();

    expect(result.current.validateCommit(bare())).toEqual({ ok: true });
    expect(await save(view, bare())).toBe(true);
    expect(item()).toBeUndefined();
    expect(onRejected).not.toHaveBeenCalled();

    expect(await save(view, outlined())).toBe(true);
    expect(item()).toEqual(original);
  });

  it('dời + kéo cỡ: thành đồ thật đã nhận (không còn cờ gợi ý), hộp theo, báo nhẹ; Ctrl+Z về đúng bản ghi gợi ý', async () => {
    const view = hook();
    const { onNotice, onRejected } = view;
    const original = item() as Furniture;
    const width = original.boundingBox.max.x - original.boundingBox.min.x;

    expect(await save(view, outlined({ position: [9.1, 0, 1], scale: [2, 1, 1] }))).toBe(true);
    expect(item()).toMatchObject({ reviewed: true, source: 'human', centre: { x: original.centre.x + 100, y: original.centre.y } });
    expect(item()?.suggested).toBeUndefined();
    expect((item() as Furniture).boundingBox.max.x - (item() as Furniture).boundingBox.min.x).toBe(width * 2);
    expect(onNotice).toHaveBeenCalledWith(SUGGESTION_ACCEPTED_NOTICE);
    expect(onRejected).not.toHaveBeenCalled();

    expect(await save(view, outlined())).toBe(true);
    expect(item()).toEqual(original);
    // Ctrl+Z không báo nhầm "vừa sửa đồ đã duyệt".
    expect(onNotice).toHaveBeenCalledTimes(1);
  });

  it('xoay rồi sơn hai lượt: lượt sau cộng dồn trên đồ đã nhận; màu ngoài luật không tự nhận gợi ý', async () => {
    const view = hook();
    const { onNotice } = view;

    expect(await save(view, outlined({ slots: { fabric: FOREIGN } }))).toBe(false);
    expect(item()?.suggested).toBe(true);

    expect(await save(view, outlined({ rotation: [0, -Math.PI / 2, 0] }))).toBe(true);
    expect(item()?.rotationDeg).toBe(90);
    expect(await save(view, outlined({ rotation: [0, -Math.PI / 2, 0], slots: { fabric: SAVEABLE } }))).toBe(true);
    expect(item()).toMatchObject({ rotationDeg: 90, slots: { fabric: SAVEABLE } });
    expect(onNotice).toHaveBeenCalledTimes(1);
  });

  it('gõ ô Cao trên tấm viền: ghi `heightMm` đúng số gõ; dời sang phòng khác: `roomId` theo tâm mới; báo màn dựng lại một lần', async () => {
    const view = hook();
    const dimensions = [1.829, 0.75, 0.972];
    const asset = { id: 'appfront-rectangular-carpet', src: 'asset://appfront/table', dimensions };
    const other = BUILDING.rooms.find((room) => room.id !== item()?.roomId && room.levelId === item()?.levelId);
    const target = other?.outline[0];

    if (other === undefined || target === undefined) throw new Error('bộ mẫu phải có phòng thứ hai cùng tầng');
    const xs = other.outline.map((p) => p.x);
    const ys = other.outline.map((p) => p.y);
    const cx = (Math.min(...xs) + Math.max(...xs)) / 2;
    const cy = (Math.min(...ys) + Math.max(...ys)) / 2;
    const original = item() as Furniture;

    await save(view, withGenerated(OUTLINE, { asset }, bare()));
    expect(view.result.current.takeSuggestionAccepted()).toBe(false);
    expect(
      await save(view, withGenerated(OUTLINE, { asset, scale: [1, 1.2, 1], position: [9 + (cx - original.centre.x) / 1000, 0, 1 + (cy - original.centre.y) / 1000] }, bare())),
    ).toBe(true);
    expect(item()).toMatchObject({ heightMm: 900, roomId: other.id });
    expect(view.result.current.takeSuggestionAccepted()).toBe(true);
    expect(view.result.current.takeSuggestionAccepted()).toBe(false);
  });

  it('cảnh dựng lại ngay sau khi nhận: tấm viền đổi thành món thật không phải lần xoá, không ghi thêm; Ctrl+Z vẫn về bản ghi gợi ý', async () => {
    const view = hook();
    const original = item() as Furniture;

    expect(await save(view, outlined({ position: [9.1, 0, 1] }))).toBe(true);
    const accepted = item();
    const rebuilt = toPascalScene(denormalizeSpatial(useStore.getState().spatial as NormalizedSpatial)).scene;
    expect(rebuilt.nodes[OUTLINE]).toBeUndefined();
    expect(rebuilt.nodes[`item_${realItem}`]).toBeDefined();

    await save(view, rebuilt);
    expect(item()).toMatchObject({ centre: accepted?.centre, reviewed: true });
    expect(item()?.suggested).toBeUndefined();

    expect(await save(view, outlined())).toBe(true);
    expect(item()).toEqual(original);
  });


  it('nhận rồi máy chủ thêm `edited`/`clearAreaM2`: lượt dựng lại không hạ dấu duyệt của món và phòng, không báo sai, không ghi', async () => {
    const view = hook();

    expect(await save(view, outlined({ slots: { a: SAVEABLE } }))).toBe(true);
    const graph = useStore.getState().spatial as NormalizedSpatial;
    const accepted = graph.byId[realItem] as Furniture;
    const room = Object.values(graph.byId).find((entity) => entity.id === accepted.roomId) as Room;
    const rebuilt = toPascalScene(denormalizeSpatial(graph)).scene;

    /* Như sau lượt PUT: bản ghi về từ máy chủ mang các trường `toSpatial` không viết ra. */
    act(() => {
      useStore.getState().setSpatial(
        { ...graph, byId: { ...graph.byId, [realItem]: { ...accepted, edited: true }, [room.id]: { ...room, reviewed: true, clearAreaM2: 13.73 } } } as NormalizedSpatial,
        null,
      );
    });
    view.rerender();
    const stored = useStore.getState().spatial;

    view.result.current.rebaseOnRebuilt(rebuilt);

    expect(await save(view, rebuilt)).toBe(false);
    expect(useStore.getState().spatial).toBe(stored);
    expect(item()).toMatchObject({ reviewed: true, edited: true });
    expect(view.onNotice).toHaveBeenCalledTimes(1);
    expect(view.onNotice).toHaveBeenCalledWith(SUGGESTION_ACCEPTED_NOTICE);

    // Sửa thật sau đó vẫn bỏ dấu duyệt (C2).
    const real = rebuilt.nodes[`item_${realItem}`] as Extract<PascalNode, { readonly type: 'item' }>;

    expect(await save(view, { ...rebuilt, nodes: { ...rebuilt.nodes, [real.id]: { ...real, position: [real.position[0] + 0.5, real.position[1], real.position[2]] } } })).toBe(true);
    expect(item()?.reviewed).toBe(false);
  });

  it('sơn tấm viền: mẫu thật phủ màu ở mọi khe, lượt về không đổi gì, không báo "đã duyệt"; sơn lại một khe thì giữ các khe kia', async () => {
    const view = hook();

    expect(await save(view, outlined({ slots: { a: SAVEABLE } }))).toBe(true);
    expect(item()).toMatchObject({ reviewed: true, slots: { a: SAVEABLE } });

    const graph = denormalizeSpatial(useStore.getState().spatial as NormalizedSpatial);
    const rebuilt = toPascalScene(graph).scene;
    const real = rebuilt.nodes[`item_${realItem}`] as Extract<PascalNode, { readonly type: 'item' }>;
    const styleKeys = Object.keys(real.slots ?? {}).filter((slot) => slot !== 'a');

    expect(styleKeys.length).toBeGreaterThan(0);
    for (const slot of styleKeys) expect(real.slots?.[slot]).toBe(SAVEABLE);

    expect(await save(view, rebuilt)).toBe(false);
    expect(item()).toMatchObject({ reviewed: true, slots: { a: SAVEABLE } });
    expect(view.onNotice).toHaveBeenCalledTimes(1);
    expect(view.onNotice).toHaveBeenCalledWith(SUGGESTION_ACCEPTED_NOTICE);

    const other = SCENE_STYLES['am-ap'].wall.exterior;
    const [first = '', ...rest] = styleKeys;

    expect(await save(view, { ...rebuilt, nodes: { ...rebuilt.nodes, [real.id]: { ...real, slots: { ...real.slots, [first]: other } } } })).toBe(true);
    expect(item()?.slots).toEqual(Object.fromEntries([[first, other], ...rest.map((slot) => [slot, SAVEABLE])]));
  });

  it('đổi tên tấm viền (không phải hình học): không nhận gì, không ghi', async () => {
    const view = hook();
    const before = useStore.getState().spatial;

    expect(await save(view, outlined({ name: 'khác' }))).toBe(false);
    expect(useStore.getState().spatial).toBe(before);
  });
});

/** Cảnh nền + một vách mới vẽ giữa phòng đầu (0..4 m × 0..4,25 m), cùng tầng với tường đầu. */
const withNewWall = (): PascalScene => {
  const host = firstWall();
  const parent = host.parentId === null ? undefined : SCENE.nodes[host.parentId];
  const wall = { ...host, id: 'wall_w3d_new', children: [], start: [0.5, 2.1], end: [3.5, 2.1], metadata: {} } as PascalNode;

  if (parent === undefined || !('children' in parent)) throw new Error('tường đầu phải có tầng cha');

  return {
    nodes: { ...SCENE.nodes, [wall.id]: wall, [parent.id]: { ...parent, children: [...parent.children, wall.id] } as PascalNode },
    rootNodeIds: SCENE.rootNodeIds,
  };
};

/** Cảnh nền thêm một bản sao chờ thả, đúng như Pascal giữ trong lúc đặt: nhánh `metadata` là thứ duy nhất khác bản đã đặt. */
const withDraft = (metadata: Record<string, unknown>, id = 'item_ban_sao'): PascalScene => {
  const parent = SCENE.nodes[firstWall().parentId ?? ''];

  if (parent === undefined || !('children' in parent)) throw new Error('tường đầu phải có tầng cha');

  const draft = { object: 'node', id, type: 'item', parentId: parent.id, children: [], position: [1, 0, 1], rotation: [0, 0, 0], scale: [1, 1, 1], asset: { id: 'sofa', src: '/items/sofa/model.glb', dimensions: [1, 1, 1] }, metadata } as unknown as PascalNode;

  return {
    nodes: { ...SCENE.nodes, [id]: draft, [parent.id]: { ...parent, children: [...parent.children, id] } as PascalNode },
    rootNodeIds: SCENE.rootNodeIds,
  };
};

describe('settledScene — nháp đang đặt không phải dữ liệu', () => {
  it('cảnh không có nháp: trả đúng cảnh ấy, không dựng lại', () => {
    expect(settledScene(SCENE, SCENE)).toBe(SCENE);
  });

  it('bản sao chờ thả: bỏ khỏi cảnh và khỏi tầng cha, không còn gì để ghi', () => {
    const settled = settledScene(withDraft({ isTransient: true }), SCENE);

    expect(settled.nodes['item_ban_sao']).toBeUndefined();
    expect(commitOfScenes(SCENE, settled)).toBeNull();
  });

  it('nháp có con: con đi theo', () => {
    const scene = withDraft({ isTransient: true });
    const child = { ...scene.nodes['item_ban_sao'], id: 'item_con', parentId: 'item_ban_sao', metadata: {} } as unknown as PascalNode;
    const nested: PascalScene = {
      ...scene,
      nodes: { ...scene.nodes, item_con: child, item_ban_sao: { ...scene.nodes['item_ban_sao'], children: ['item_con'] } as unknown as PascalNode },
    };

    expect(commitOfScenes(SCENE, settledScene(nested, SCENE))).toBeNull();
  });

  it('món có sẵn đang dời: về đúng bản đã lưu, không lưu chỗ đang rê', () => {
    const wall = firstWall();
    const moving: PascalScene = {
      nodes: { ...SCENE.nodes, [wall.id]: { ...wall, thickness: 0.33, metadata: { ...wall.metadata, isTransient: true } } },
      rootNodeIds: SCENE.rootNodeIds,
    };

    expect(settledScene(moving, SCENE).nodes[wall.id]).toBe(wall);
  });

  it('món có sẵn đang dời sang cha khác: cha mới bỏ nó, cha cũ giữ nó', () => {
    const before = withDraft({});
    const itemBefore = before.nodes['item_ban_sao'] as PascalNode;
    const oldParent = before.nodes[itemBefore.parentId ?? ''] as Extract<PascalNode, { readonly type: 'level' }>;
    const moving: PascalScene = {
      rootNodeIds: before.rootNodeIds,
      nodes: {
        ...before.nodes,
        [oldParent.id]: { ...oldParent, children: oldParent.children.filter((id) => id !== itemBefore.id) },
        item_ke: { ...itemBefore, id: 'item_ke', children: [itemBefore.id] } as unknown as PascalNode,
        [itemBefore.id]: { ...itemBefore, parentId: 'item_ke', metadata: { isTransient: true } } as PascalNode,
      },
    };
    const previous: PascalScene = { ...before, nodes: { ...before.nodes, item_ke: { ...itemBefore, id: 'item_ke' } as PascalNode } };

    expect(commitOfScenes(previous, settledScene(moving, previous))).toBeNull();
  });
});

describe('usePascalEdits', () => {
  it('bản sao bị từ chối chỗ thả: lượt tự lưu không ghi gì; thả được rồi mới lưu đúng một món', async () => {
    const { result } = mount();
    const before = useStore.getState().spatial;
    let saved = true;

    await act(async () => {
      saved = await result.current.onSceneCommit(withDraft({ isTransient: true }));
    });

    expect(saved).toBe(false);
    expect(useStore.getState().spatial).toBe(before);
    expect(result.current.validateCommit(withDraft({ isTransient: true }))).toEqual({ ok: true });

    await act(async () => {
      saved = await result.current.onSceneCommit(withDraft({}));
    });

    expect(saved).toBe(true);
    expect(useStore.getState().spatial?.byKind.furniture).toHaveLength((before?.byKind.furniture.length ?? 0) + 1);
  });

  it('W3d — vách mới không khép thành hai phòng: tường vẫn lưu, báo mở màn Phòng để tách', async () => {
    const onNotice = vi.fn();
    const { result } = mount({ onNotice });
    const wallsBefore = useStore.getState().spatial?.byKind.wall.length ?? 0;
    let ok = false;

    await act(async () => {
      ok = await result.current.onSceneCommit(withNewWall());
    });

    expect(ok).toBe(true);
    expect(useStore.getState().spatial?.byKind.wall).toHaveLength(wallsBefore + 1);
    expect(onNotice).toHaveBeenCalledWith('Phòng "Room 0" có vách mới — mở màn Phòng để tách.');
  });

  it('N2 — tường công cụ vẽ không mang thickness/height: vẫn lưu, dày 100 mm, cao bằng tầng', async () => {
    const { result } = mount();
    const wallsBefore = useStore.getState().spatial?.byKind.wall.length ?? 0;
    const scene = withNewWall();
    const bare = Object.fromEntries(
      Object.entries(scene.nodes['wall_w3d_new'] as object).filter(([key]) => key !== 'thickness' && key !== 'height'),
    ) as Omit<Extract<PascalNode, { readonly type: 'wall' }>, 'thickness' | 'height'>;
    const level = scene.nodes[bare.parentId ?? ''] as Extract<PascalNode, { readonly type: 'level' }>;
    let ok = false;

    await act(async () => {
      ok = await result.current.onSceneCommit({ ...scene, nodes: { ...scene.nodes, [bare.id]: bare as PascalNode } });
    });

    const walls = useStore.getState().spatial?.byKind.wall ?? [];
    const addedId = walls.find((id) => !SPATIAL.byKind.wall.includes(id)) ?? '';
    const added = useStore.getState().spatial?.byId[addedId];

    expect(ok).toBe(true);
    expect(walls).toHaveLength(wallsBefore + 1);
    expect(added).toMatchObject({ thicknessMm: 100, heightMm: Math.round(level.height * 1000) });
  });

  it('V9 — mỗi lượt lưu gọi onUnsaved, kể cả khi không còn gì chưa lưu (danh sách rỗng)', async () => {
    const onUnsaved = vi.fn();
    const { result } = mount({ onUnsaved });

    await act(async () => {
      await result.current.onSceneCommit(thickened());
    });

    expect(onUnsaved).toHaveBeenCalledWith([], {});
  });

  it('A5 — phần chưa lưu được về như cũ, phần còn lại của node vẫn lưu; lượt tự lưu sau không tính là sửa nữa', async () => {
    const onUnsaved = vi.fn();
    const { result } = mount({ onUnsaved });
    const door = Object.values(SCENE.nodes).find((node) => node.type === 'door') as PascalNode;
    const painted: PascalScene = {
      nodes: { ...thickened().nodes, [door.id]: { ...door, slots: { panel: SAVEABLE } } as PascalNode },
      rootNodeIds: SCENE.rootNodeIds,
    };

    await act(async () => {
      await result.current.onSceneCommit(painted);
    });

    const [labels, restored] = onUnsaved.mock.calls[0] as [string[], Record<string, PascalNode>];
    expect(labels).toEqual(['màu cửa']);
    expect(Object.keys(restored)).toEqual([door.id]);
    expect((restored[door.id] as unknown as { slots?: unknown }).slots).toBeUndefined();

    // Editor đã nhận cảnh đặt lại: so với mốc mới thì không còn gì, không báo lần hai cho lượt ấy.
    onUnsaved.mockClear();
    let ok = true;
    await act(async () => {
      ok = await result.current.onSceneCommit({ nodes: { ...painted.nodes, ...restored }, rootNodeIds: SCENE.rootNodeIds });
    });
    expect(ok).toBe(false);
    expect(onUnsaved).not.toHaveBeenCalled();

    // Sơn cửa lần nữa: vẫn báo và vẫn đặt lại.
    await act(async () => {
      await result.current.onSceneCommit(painted);
    });
    expect(onUnsaved).toHaveBeenCalledWith(['màu cửa'], expect.objectContaining({ [door.id]: expect.anything() }));
  });

  it('A3 — hasPendingEdit: có lượt ghi được chưa vào kho thì true, ghi xong hay không có gì để ghi thì false', async () => {
    const { result } = mount();

    expect(result.current.hasPendingEdit(SCENE)).toBe(false);
    expect(result.current.hasPendingEdit(thickened())).toBe(true);
    const edited = thickened();
    await act(async () => {
      await result.current.onSceneCommit(edited);
    });
    // Mỗi lần hỏi là một ảnh chụp mới của editor (`readEditorScene`), như ở đây.
    expect(result.current.hasPendingEdit({ ...edited })).toBe(false);
    // Lượt bị từ chối (xoá hàng loạt) không có gì để mất.
    expect(result.current.hasPendingEdit(gutted())).toBe(false);
  });

  it('A3 — vai chỉ xem không bao giờ có lượt chờ', () => {
    const { result } = mount({ readOnly: true });

    expect(result.current.hasPendingEdit(thickened())).toBe(false);
  });

  it('v3 V3 — sửa chỉ màu đồ đạc: không có gì để ghi, nhưng báo "màu đồ đạc" chưa lưu được', async () => {
    const onUnsaved = vi.fn();
    const onRejected = vi.fn();
    const { result } = mount({ onUnsaved, onRejected });
    let ok = true;
    // Đồ thật của bản vẽ: món tự sinh đứng đầu danh sách (đèn trần) nay bị `blockedGeneratedEdits` chặn.
    const real = Object.values(SCENE.nodes).find((node) => node.type === 'item' && !isGeneratedNodeId(node.id)) as PascalNode;
    const painted: PascalScene = { nodes: { ...SCENE.nodes, [real.id]: { ...real, slots: { body: FOREIGN } } as PascalNode }, rootNodeIds: SCENE.rootNodeIds };

    await act(async () => {
      ok = await result.current.onSceneCommit(painted);
    });

    expect(ok).toBe(false);
    expect(onRejected).not.toHaveBeenCalled();
    expect(onUnsaved).toHaveBeenCalledWith(['màu đồ đạc'], expect.objectContaining({ [real.id]: expect.anything() }));
  });

  it('nạp xong mà chưa ai sửa gì: KHÔNG ghi vào bản vẽ', async () => {
    const { result } = mount();
    const before = useStore.getState().spatial;

    await act(async () => {
      await result.current.onSceneCommit(SCENE);
    });

    expect(useStore.getState().spatial).toBe(before);
  });

  it('sửa độ dày một tường thì bản vẽ trong store đổi theo (A10 — qua commit)', async () => {
    const { result } = mount();
    const wallId = Object.keys(SPATIAL.byId).find((id) => id.startsWith('W-'));

    if (wallId === undefined) throw new Error('bản vẽ phải có tường');

    await act(async () => {
      await result.current.onSceneCommit(thickened());
    });

    const after = useStore.getState().spatial?.byId[wallId];

    expect(after !== undefined && 'thicknessMm' in after ? after.thicknessMm : null).toBe(330);
  });

  it('23H-A-016 — lượt sửa đã vào kho thành một bước trên ngăn lịch sử trả ra cho bảng', async () => {
    const { result } = mount();

    expect(result.current.history.undoSteps()).toHaveLength(0);

    await act(async () => {
      await result.current.onSceneCommit(thickened());
    });

    expect(result.current.history.undoSteps()).toHaveLength(1);
  });

  it('C2 — bức tường vừa sửa mất dấu xác minh', async () => {
    const { result } = mount();
    const wallId = Object.keys(SPATIAL.byId).find((id) => id.startsWith('W-'));

    if (wallId === undefined) throw new Error('bản vẽ phải có tường');

    await act(async () => {
      await result.current.onSceneCommit(thickened());
    });

    expect(useStore.getState().spatial?.byId[wallId]?.reviewed).toBe(false);
  });

  it('vai chỉ-xem: `validateCommit` từ chối và `onSceneCommit` không ghi gì', async () => {
    const onRejected = vi.fn();
    const { result } = mount({ readOnly: true, onRejected });
    const before = useStore.getState().spatial;

    expect(result.current.validateCommit(thickened())).toEqual({
      ok: false,
      message: PASCAL_READ_ONLY_REASON,
    });

    await act(async () => {
      await result.current.onSceneCommit(thickened());
    });

    expect(useStore.getState().spatial).toBe(before);
    expect(onRejected).not.toHaveBeenCalled();
  });

  it('6A — cổng chặn lượt xoá hàng loạt, và nói ra lý do bằng tiếng Việt', async () => {
    const onRejected = vi.fn();
    const { result } = mount({ onRejected });
    const before = useStore.getState().spatial;

    /* Bỏ hẳn mọi tường của cảnh: đúng thứ `MASS_DELETE_RATIO` tồn tại để chặn. */
    const gutted: PascalScene = {
      nodes: Object.fromEntries(
        Object.entries(SCENE.nodes).filter(([, node]) => node.type !== 'wall'),
      ),
      rootNodeIds: SCENE.rootNodeIds,
    };

    const verdict = result.current.validateCommit(gutted);

    expect(verdict.ok).toBe(false);
    expect(verdict.ok ? '' : verdict.message).toMatch(/\p{L}/u);

    await act(async () => {
      await result.current.onSceneCommit(gutted);
    });

    expect(useStore.getState().spatial).toBe(before);
    expect(onRejected).toHaveBeenCalledTimes(1);
  });

  it('23-A-026 — xoá hàng loạt: báo màn mở hộp xác nhận; xác nhận rồi thì đúng lượt xoá ấy được ghi', async () => {
    const onMassDelete = vi.fn();
    const { result } = mount({ onMassDelete });
    const wallIds = Object.values(SCENE.nodes)
      .filter((node) => node.type === 'wall')
      .map((node) => node.id);

    expect(result.current.validateCommit(gutted()).ok).toBe(false);
    expect(onMassDelete).toHaveBeenCalledTimes(1);

    const request = onMassDelete.mock.calls[0]?.[0] as { nodeIds: readonly string[]; reason: string };

    expect(request.nodeIds).toEqual(expect.arrayContaining(wallIds));
    expect(request.reason).toMatch(/xác nhận/u);

    act(() => {
      result.current.confirmMassDelete(request.nodeIds);
    });

    // Editor xoá lại sau khi người dùng bấm "Xoá": cảnh mới, cùng phần xoá.
    expect(result.current.validateCommit(gutted())).toEqual({ ok: true });

    await act(async () => {
      expect(await result.current.onSceneCommit(gutted())).toBe(true);
    });

    expect(useStore.getState().spatial?.byKind.wall ?? []).toHaveLength(0);
  });
});
