import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { create } from 'zustand';

import { HomeownerCard, type HomeownerCardStores, UNCONFIRMED_NOTE } from '../HomeownerCard';
import type { SizedItem } from '../itemSize';
import {
  doorFlipUpdate,
  doorKindOf,
  doorKindUpdate,
  type HomeownerNode,
  quarterTurn,
  sourceLabelOf,
  windowFlipUpdate,
  windowKindOf,
  windowKindUpdate,
} from '../homeowner/kinds';

const read = (path: string) => readFileSync(resolve(process.cwd(), path), 'utf8');

/** Id AppFront hợp lệ (`<tiền tố>-<thân base36 ≥ 10>`) bọc tiền tố Pascal. */
const DOOR_ID = 'door_D-000001ABCDEFGHIJ';
const WINDOW_ID = 'window_D-000002ABCDEFGHIJ';
const PLAN_ITEM = 'item_F-000003ABCDEFGHIJ';
const DRESS_ITEM = 'item_DRESS-pillow-R-000004ABCDEFGHIJ-1';
const USER_ITEM = 'item_k3j2h1';
const BED_ITEM = 'item_F-000005ABCDEFGHIJ';
const OUTLINE_ITEM = 'item_DRESS-suggested-F-000006ABCDEFGHIJ';

const NODES: Record<string, HomeownerNode> = {
  [DOOR_ID]: { id: DOOR_ID, type: 'door', parentId: 'wall_x', doorType: 'hinged', leafCount: 1, openingKind: 'door', swingAngle: 1.22 },
  [WINDOW_ID]: { id: WINDOW_ID, type: 'window', parentId: 'wall_x', windowType: 'casement', casementStyle: 'single', hingesSide: 'left' },
  [PLAN_ITEM]: { id: PLAN_ITEM, type: 'item', name: 'Giường đôi', rotation: [0, 0, 0] },
  [DRESS_ITEM]: { id: DRESS_ITEM, type: 'item', asset: { name: 'Gối', dimensions: [0.5, 0.15, 0.3] }, scale: [1, 1, 1] } as HomeownerNode,
  // Pascal: dimensions [rộng x, cao y, sâu z] (m) × scale.
  [BED_ITEM]: { id: BED_ITEM, type: 'item', name: 'Giường', asset: { name: 'Giường', category: 'bed', dimensions: [1.2, 2, 0.6] }, scale: [1.5, 1, 1] } as HomeownerNode,
  [OUTLINE_ITEM]: {
    id: OUTLINE_ITEM,
    type: 'item',
    name: 'bàn (chưa xác nhận)',
    asset: { name: 'Thảm', dimensions: [1.829, 0.004, 0.972] },
    scale: [1, 1, 1],
    metadata: { unconfirmed: true },
  } as HomeownerNode,
  wall_x: { id: 'wall_x', type: 'wall' },
};

interface SceneState {
  nodes: Record<string, HomeownerNode>;
  dirtyNodes: Set<string>;
  updateNode(id: string, data: object): void;
  deleteNode(id: string): void;
}

const storesWith = (selectedIds: string[], editor: Partial<{ mode: string; tool: unknown; isPreviewMode: boolean; isFirstPersonMode: boolean }> = {}) => {
  const scene = create<SceneState>()((set) => ({
    nodes: { ...NODES },
    dirtyNodes: new Set(),
    // eslint-disable-next-line local/no-direct-set -- store giả của Pascal (vendor), không phải store AppFront.
    updateNode: (id, data) => set((s) => ({ nodes: { ...s.nodes, [id]: { ...s.nodes[id]!, ...data } } })),
    deleteNode: (id) =>
      // eslint-disable-next-line local/no-direct-set -- store giả của Pascal (vendor).
      set((s) => ({ nodes: Object.fromEntries(Object.entries(s.nodes).filter(([key]) => key !== id)) })),
  }));
  const viewer = create<{ selection: { selectedIds: string[] }; setSelection(sel: { selectedIds: string[] }): void }>()((set) => ({
    selection: { selectedIds },
    // eslint-disable-next-line local/no-direct-set -- store giả của Pascal (vendor).
    setSelection: (selection) => set({ selection }),
  }));
  const editorStore = create(() => ({ mode: 'select', tool: null, isPreviewMode: false, isFirstPersonMode: false, ...editor }));
  const undo = vi.fn();
  const forgetDoorOpenState = vi.fn();
  const stores = { useScene: scene, useViewer: viewer, useEditor: editorStore, undo, forgetDoorOpenState } as unknown as HomeownerCardStores;
  return { scene, viewer, undo, forgetDoorOpenState, stores };
};

afterEach(cleanup);

describe('hàm thuần', () => {
  it('nguồn: DRESS- → AI thêm; id AppFront → Theo bản vẽ; id Pascal đẻ → Bạn thêm', () => {
    expect(sourceLabelOf(NODES[DRESS_ITEM]!)).toBe('AI thêm');
    expect(sourceLabelOf(NODES[PLAN_ITEM]!)).toBe('Theo bản vẽ');
    expect(sourceLabelOf(NODES[DOOR_ID]!)).toBe('Theo bản vẽ');
    expect(sourceLabelOf({ id: USER_ITEM, type: 'item' })).toBe('Bạn thêm');
  });

  it('kiểu cửa đi đọc từ trường Pascal (cả "cánh đôi" kiểu toPascal: hinged + leafCount 2)', () => {
    expect(doorKindOf({ id: 'd', type: 'door' })).toBe('single');
    expect(doorKindOf({ id: 'd', type: 'door', doorType: 'hinged', leafCount: 2 })).toBe('double');
    expect(doorKindOf({ id: 'd', type: 'door', doorType: 'double' })).toBe('double');
    expect(doorKindOf({ id: 'd', type: 'door', doorType: 'sliding' })).toBe('sliding');
    expect(doorKindOf({ id: 'd', type: 'door', openingKind: 'opening', doorType: 'sliding' })).toBe('opening');
    expect(doorKindOf({ id: 'd', type: 'door', doorType: 'barn' })).toBeUndefined();
  });

  it('đổi kiểu cửa đi ghi đúng trường Pascal, không đụng rộng/cao, đổi qua lại giữ góc hé', () => {
    const door = NODES[DOOR_ID]!;
    expect(doorKindUpdate(door, 'double')).toMatchObject({ doorType: 'double', leafCount: 2, openingKind: 'door', swingAngle: 1.22 });
    expect(doorKindUpdate(door, 'sliding')).toMatchObject({ doorType: 'sliding', trackStyle: 'visible', swingAngle: 0, operationState: 0.5 });
    expect(doorKindUpdate(door, 'pocket')).toMatchObject({ doorType: 'pocket', trackStyle: 'pocket' });
    expect(doorKindUpdate(door, 'folding')).toMatchObject({ doorType: 'folding', leafCount: 4 });
    expect(doorKindUpdate(door, 'opening')).toEqual({ openingKind: 'opening', swingAngle: 0, operationState: 0 });
    expect(doorKindUpdate({ ...door, swingAngle: 0 }, 'single')).toMatchObject({ doorType: 'hinged', leafCount: 1, swingAngle: 1.22 });
    for (const kind of ['single', 'double', 'sliding', 'pocket', 'folding', 'opening'] as const) {
      const fields = doorKindUpdate(door, kind);
      expect(fields).not.toHaveProperty('width');
      expect(fields).not.toHaveProperty('height');
      expect(doorKindOf({ ...door, ...fields })).toBe(kind);
    }
  });

  it('đổi hướng mở: bản lề vào ↔ ra, lùa trái ↔ phải, không cánh/xếp không có', () => {
    expect(doorFlipUpdate(NODES[DOOR_ID]!)).toEqual({ swingDirection: 'outward' });
    expect(doorFlipUpdate({ ...NODES[DOOR_ID]!, swingDirection: 'outward' })).toEqual({ swingDirection: 'inward' });
    expect(doorFlipUpdate({ id: 'd', type: 'door', doorType: 'sliding' })).toEqual({ slideDirection: 'right' });
    expect(doorFlipUpdate({ id: 'd', type: 'door', doorType: 'folding' })).toBeUndefined();
    expect(doorFlipUpdate({ id: 'd', type: 'door', openingKind: 'opening' })).toBeUndefined();
  });

  it('kiểu cửa sổ: đọc/ghi windowType + casementStyle, lùa về chữ nhật, hopper đọc là mở hất', () => {
    const win = NODES[WINDOW_ID]!;
    expect(windowKindOf(win)).toBe('casement');
    expect(windowKindOf({ id: 'w', type: 'window', windowType: 'hopper' })).toBe('awning');
    expect(windowKindOf({ id: 'w', type: 'window', windowType: 'bay' })).toBeUndefined();
    expect(windowKindUpdate(win, 'sliding')).toEqual({ openingKind: 'window', windowType: 'sliding', openingShape: 'rectangle' });
    for (const kind of ['fixed', 'sliding', 'casement', 'casement2', 'awning', 'louvered'] as const) {
      expect(windowKindOf({ ...win, ...windowKindUpdate(win, kind) })).toBe(kind);
    }
    expect(windowFlipUpdate(win)).toEqual({ hingesSide: 'right' });
    expect(windowFlipUpdate({ id: 'w', type: 'window', windowType: 'awning' })).toEqual({ windowType: 'awning', awningDirection: 'down' });
    expect(windowFlipUpdate({ id: 'w', type: 'window', windowType: 'fixed' })).toBeUndefined();
  });

  it('xoay 90° quanh trục đứng', () => {
    expect(quarterTurn([0.1, 1, 0])).toEqual([0.1, 1 + Math.PI / 2, 0]);
    expect(quarterTurn(undefined)).toEqual([0, Math.PI / 2, 0]);
  });
});

describe('HomeownerCard', () => {
  it('đồ vật theo bản vẽ: tên + nguồn, Xoay 90° ghi rotation, Hoàn tác gọi runUndo; portal vào body', () => {
    const { scene, undo, stores } = storesWith([PLAN_ITEM]);
    const { container } = render(<HomeownerCard readOnly={false} stores={stores} />);
    expect(container.innerHTML).toBe('');
    const card = screen.getByRole('region', { name: 'Thao tác nhanh: Giường đôi' });
    expect(card.parentElement).toBe(document.body);
    expect(card.textContent).toContain('Theo bản vẽ');
    expect(screen.queryByRole('group', { name: 'Kiểu cửa đi' })).toBeNull();

    fireEvent.click(screen.getByRole('button', { name: 'Xoay 90°' }));
    expect(scene.getState().nodes[PLAN_ITEM]!.rotation?.[1]).toBeCloseTo(Math.PI / 2);
    fireEvent.click(screen.getByRole('button', { name: 'Hoàn tác' }));
    expect(undo).toHaveBeenCalledOnce();
  });

  it('đồ AI bày: nhãn "AI thêm", Xoá bỏ node và bỏ chọn', () => {
    const { scene, viewer, stores } = storesWith([DRESS_ITEM]);
    render(<HomeownerCard readOnly={false} stores={stores} />);
    expect(screen.getByRole('region', { name: 'Thao tác nhanh: Gối' }).textContent).toContain('AI thêm');
    fireEvent.click(screen.getByRole('button', { name: 'Xoá' }));
    expect(scene.getState().nodes[DRESS_ITEM]).toBeUndefined();
    expect(viewer.getState().selection.selectedIds).toEqual([]);
  });

  it('đồ máy gợi ý chưa xác nhận: vẫn đủ ô kích thước / Xoay / Xoá, nói rõ sửa là nhận, xoá là bỏ', () => {
    const { scene, stores } = storesWith([OUTLINE_ITEM]);
    render(<HomeownerCard readOnly={false} stores={stores} />);
    const card = screen.getByRole('region', { name: 'Thao tác nhanh: bàn (chưa xác nhận)' });
    expect(card.textContent).toContain(UNCONFIRMED_NOTE);
    expect(UNCONFIRMED_NOTE).not.toContain('Duyệt');
    expect(screen.getByLabelText('Dài (mm)')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Xoay 90°' })).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Xoá' }));
    expect(scene.getState().nodes[OUTLINE_ITEM]).toBeUndefined();
  });

  it('kích thước: Dài × Rộng × Cao (mm) = dimensions × scale, nhóm nghìn kiểu Việt; cửa không có hàng này', () => {
    const { stores } = storesWith([BED_ITEM]);
    render(<HomeownerCard readOnly={false} stores={stores} />);
    expect(screen.getByLabelText<HTMLInputElement>('Dài (mm)').value).toBe('1.800');
    expect(screen.getByLabelText<HTMLInputElement>('Rộng (mm)').value).toBe('600');
    expect(screen.getByLabelText<HTMLInputElement>('Cao (mm)').value).toBe('2.000');
    expect(screen.getByRole('button', { name: 'Giữ tỉ lệ' }).getAttribute('aria-pressed')).toBe('true');
    expect(screen.queryByText(/bộ bày sẵn/)).toBeNull();
    cleanup();
    render(<HomeownerCard readOnly={false} stores={storesWith([DOOR_ID]).stores} />);
    expect(screen.queryByRole('group', { name: 'Kích thước (mm)' })).toBeNull();
  });

  it('kích thước giữ tỉ lệ: Enter ở Dài nhân đều ba trục, ghi scale vào store', () => {
    const { scene, stores } = storesWith([BED_ITEM]);
    render(<HomeownerCard readOnly={false} stores={stores} />);
    const width = screen.getByLabelText<HTMLInputElement>('Dài (mm)');
    fireEvent.change(width, { target: { value: '3.600' } });
    fireEvent.keyDown(width, { key: 'Enter' });
    const scale = (scene.getState().nodes[BED_ITEM] as SizedItem).scale;
    expect(scale?.[0]).toBeCloseTo(3);
    expect(scale?.[1]).toBeCloseTo(2);
    expect(scale?.[2]).toBeCloseTo(2);
    expect(screen.getByLabelText<HTMLInputElement>('Rộng (mm)').value).toBe('1.200');
    expect(screen.getByLabelText<HTMLInputElement>('Cao (mm)').value).toBe('4.000');
  });

  it('kích thước tắt giữ tỉ lệ: chỉ một trục; đồ cứng kéo méo quá thì kẹp + báo; số sai không ghi', () => {
    const { scene, stores } = storesWith([BED_ITEM]);
    render(<HomeownerCard readOnly={false} stores={stores} />);
    fireEvent.click(screen.getByRole('button', { name: 'Giữ tỉ lệ' }));
    const height = screen.getByLabelText<HTMLInputElement>('Cao (mm)');
    fireEvent.change(height, { target: { value: '1000' } });
    fireEvent.blur(height);
    expect((scene.getState().nodes[BED_ITEM] as SizedItem).scale).toEqual([1.5, 0.5, 1]);

    // Rộng 1.200 → scale z 2 so với x 1,5: 1,33 < 1,5625 → nhận.
    const depth = screen.getByLabelText<HTMLInputElement>('Rộng (mm)');
    fireEvent.change(depth, { target: { value: '1200' } });
    fireEvent.keyDown(depth, { key: 'Enter' });
    expect((scene.getState().nodes[BED_ITEM] as SizedItem).scale?.[2]).toBeCloseTo(2);
    expect(screen.queryByText('Đồ cứng không kéo méo quá 25%')).toBeNull();

    // Rộng 3.000 → z 5 > 1,5 × 1,5625 → kẹp về 2,34375 (1.406 mm).
    const depth2 = screen.getByLabelText<HTMLInputElement>('Rộng (mm)');
    fireEvent.change(depth2, { target: { value: '3000' } });
    fireEvent.keyDown(depth2, { key: 'Enter' });
    expect((scene.getState().nodes[BED_ITEM] as SizedItem).scale?.[2]).toBeCloseTo(1.5 * 1.5625);
    expect(screen.getByText('Đồ cứng không kéo méo quá 25%')).toBeTruthy();
    expect(screen.getByLabelText<HTMLInputElement>('Rộng (mm)').value).toBe('1.406');

    const before = scene.getState().nodes[BED_ITEM];
    const width = screen.getByLabelText<HTMLInputElement>('Dài (mm)');
    fireEvent.change(width, { target: { value: '0' } });
    fireEvent.keyDown(width, { key: 'Enter' });
    expect(scene.getState().nodes[BED_ITEM]).toBe(before);
    expect(width.value).toBe('1.800');
    expect(screen.getByRole('status').textContent).toMatch(/Nhập số từ 1 đến 10\.000 mm/);
  });

  it('kích thước đồ AI bày: báo đổi cỡ thì thành đồ của bạn', () => {
    render(<HomeownerCard readOnly={false} stores={storesWith([DRESS_ITEM]).stores} />);
    expect(screen.getByText(/không còn thuộc bộ bày sẵn của phòng/)).toBeTruthy();
  });

  it('cửa đi: chọn kiểu bằng nút hình, ghi store + đánh dấu tường dựng lại, kiểu đã lưu được thì không ghi chú, đổi hướng mở', () => {
    const { scene, forgetDoorOpenState, stores } = storesWith([DOOR_ID]);
    render(<HomeownerCard readOnly={false} stores={stores} />);
    const group = screen.getByRole('group', { name: 'Kiểu cửa đi' });
    expect(group.querySelectorAll('svg')).toHaveLength(6);
    expect(screen.getByRole('button', { pressed: true }).textContent).toBe('Cánh đơn');
    expect(screen.queryByText(/Chưa lưu vào dự án/)).toBeNull();
    expect(screen.queryByRole('button', { name: 'Xoay 90°' })).toBeNull();

    fireEvent.click(screen.getByRole('button', { name: 'Cửa lùa' }));
    expect(scene.getState().nodes[DOOR_ID]).toMatchObject({ doorType: 'sliding' });
    expect(scene.getState().dirtyNodes.has('wall_x')).toBe(true);
    expect(forgetDoorOpenState).toHaveBeenCalledWith(DOOR_ID);
    expect(screen.getByRole('button', { pressed: true }).textContent).toBe('Cửa lùa');

    fireEvent.click(screen.getByRole('button', { name: 'Đổi hướng mở' }));
    expect(scene.getState().nodes[DOOR_ID]).toMatchObject({ slideDirection: 'right' });
  });

  it('cửa sổ: chỉ các kiểu lưu được, chọn "Mở quay 2 cánh" ghi casementStyle french', () => {
    const { scene, stores } = storesWith([WINDOW_ID]);
    render(<HomeownerCard readOnly={false} stores={stores} />);
    expect(screen.getByRole('group', { name: 'Kiểu cửa sổ' }).querySelectorAll('button')).toHaveLength(4);
    expect(screen.queryByRole('button', { name: 'Mở hất' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Lá sách' })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Mở quay 2 cánh' }));
    expect(scene.getState().nodes[WINDOW_ID]).toMatchObject({ windowType: 'casement', casementStyle: 'french' });
  });

  it.each([
    ['không chọn gì', [], {}],
    ['chọn hai món', [PLAN_ITEM, DRESS_ITEM], {}],
    ['chọn tường', ['wall_x'], {}],
    ['đang bật công cụ', [PLAN_ITEM], { mode: 'build', tool: 'wall' }],
    ['đang đi bộ', [PLAN_ITEM], { isFirstPersonMode: true }],
    ['đang xem trước', [PLAN_ITEM], { isPreviewMode: true }],
  ])('ẩn khi %s', (_label, ids, editor) => {
    const { stores } = storesWith(ids, editor);
    render(<HomeownerCard readOnly={false} stores={stores} />);
    expect(document.querySelector('[data-appfront-homeowner-card]')).toBeNull();
  });

  it('ẩn ở chế độ chỉ đọc', () => {
    const { stores } = storesWith([PLAN_ITEM]);
    render(<HomeownerCard readOnly stores={stores} />);
    expect(document.querySelector('[data-appfront-homeowner-card]')).toBeNull();
  });

  it('main.tsx gắn thẻ với cờ chỉ đọc và thẻ của món đang chọn', () => {
    expect(read('src/pascal-page/main.tsx')).toContain('<HomeownerCardMount extra={readOnly ? null : itemCards} readOnly={readOnly} />');
  });

  it('thẻ của món đang chọn (Đổi mẫu, Nguồn mẫu, Độ tin) nằm cuối hàng nút', () => {
    const { stores } = storesWith([PLAN_ITEM]);
    render(<HomeownerCard extra={<button type="button">Đổi mẫu</button>} readOnly={false} stores={stores} />);
    const card = document.querySelector('[data-appfront-homeowner-card]')!;
    expect(card.querySelector('button:last-of-type')?.textContent).toBe('Đổi mẫu');
  });
});
