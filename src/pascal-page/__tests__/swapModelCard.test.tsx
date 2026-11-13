import { readdirSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { create } from 'zustand';

import { CATALOG_MODELS, clearServerLibrary, replaceServerLibrary } from '@/lib/pascal/furnitureCatalog';
import { itemFitOf } from '@/lib/pascal/itemFit';
import { USER_SEEN_FIELD } from '@/lib/pascal/toSpatial';

import {
  isCurrentModel,
  MAX_SWAP_OPTIONS,
  SWAP_GROUPS,
  swapCandidates,
  type SwapAsset,
  type SwapCatalogItem,
  SwapModelCard,
  type SwapModelStores,
  type SwapNode,
  swapUpdateOf,
} from '../SwapModelCard';

const read = (path: string) => readFileSync(resolve(process.cwd(), path), 'utf8');

const entry = (id: string, name: string, dimensions: [number, number, number], extra: Partial<SwapCatalogItem> = {}) => ({
  id,
  name,
  thumbnail: `/items/${id}/thumbnail.webp`,
  src: `/items/${id}/model.glb`,
  dimensions,
  offset: [0, 0, 0] as [number, number, number],
  rotation: [0, 0, 0] as [number, number, number],
  scale: [1, 1, 1] as [number, number, number],
  ...extra,
});

const CATALOG: SwapCatalogItem[] = [
  entry('sofa', 'Ghế sofa', [2.06, 0.74, 1.01]),
  entry('livingroom-chair', 'Ghế bành', [1.1, 0.75, 1.07], { offset: [0, 0.0001, 0.0053] }),
  entry('lounge-chair', 'Ghế thư giãn', [0.68, 1.03, 1.26]),
  entry('double-bed', 'Giường đôi', [1.52, 0.71, 2]),
  entry('single-bed', 'Giường đơn', [1.08, 0.6, 2.14]),
  entry('television', 'Ti vi', [1.62, 1.07, 0.38]),
];

/** Món đồ AppFront sinh ra (toPascal): id `appfront-<kind>`, mẫu `/items/<thư mục>/…`. */
const sofaAsset: SwapAsset = {
  id: 'appfront-sofa',
  category: 'sofa',
  name: 'Sofa',
  thumbnail: '/items/sofa/thumbnail.webp',
  src: '/items/sofa/model.glb',
  dimensions: [2.2, 0.8, 0.95],
  offset: [0, 0.01, 0.04],
  rotation: [0, 0, 0],
  scale: [1.07, 1.07, 1.07],
};

/** Node item quanh một asset (đường lùi: không siêu dữ liệu AppFront → không suy được vai → SWAP_GROUPS). */
const nodeOf = (asset: SwapAsset, extra: Partial<SwapNode> = {}): SwapNode => ({ id: 'item_x', type: 'item', asset, ...extra });

afterEach(() => clearServerLibrary());

describe('swapCandidates — đường lùi SWAP_GROUPS (thư viện lỗi/offline)', () => {
  it('cùng nhóm với mẫu đang dùng (tìm theo thư mục của src), giữ thứ tự nhóm', () => {
    expect(swapCandidates(nodeOf(sofaAsset), CATALOG).map((c) => c.id)).toEqual(['sofa', 'livingroom-chair', 'lounge-chair']);
    expect(swapCandidates(nodeOf({ ...sofaAsset, id: 'single-bed', src: '/items/single-bed/model.glb' }), CATALOG).map((c) => c.id)).toEqual([
      'double-bed',
      'single-bed',
    ]);
  });

  it('L3a-02: mẫu thật (bật realism, `/items/bed-sf/…`) vẫn tìm ra nhóm theo tên catalog', () => {
    const real = { ...sofaAsset, id: 'appfront-bed', src: '/items/bed-sf/model.glb' };
    expect(swapCandidates(nodeOf(real), CATALOG).map((c) => c.id)).toContain('single-bed');
    expect(CATALOG.filter((item) => isCurrentModel(real, item)).map((c) => c.id)).toEqual(['double-bed']);
  });

  it('không có nhóm hoặc nhóm chỉ còn một mẫu cục bộ → []', () => {
    expect(swapCandidates(nodeOf({ ...sofaAsset, src: '/items/television/model.glb' }), CATALOG)).toEqual([]);
    expect(swapCandidates(nodeOf({ ...sofaAsset, src: 'asset://appfront/stair' }), CATALOG)).toEqual([]);
    expect(swapCandidates(nodeOf(sofaAsset), CATALOG.filter((c) => c.id === 'sofa'))).toEqual([]);
  });

  it('mọi id trong SWAP_GROUPS có trong catalog-items.tsx của vendor và có thư mục mẫu cục bộ', () => {
    const catalog = read('vendor/pascal/packages/editor/src/components/ui/item-catalog/catalog-items.tsx');
    const local = new Set(readdirSync(resolve(process.cwd(), 'vendor/pascal/assets/items')));
    for (const id of SWAP_GROUPS.flat()) {
      expect(catalog, id).toContain(`id: '${id}',`);
      const src = new RegExp(`id: '${id}',[\\s\\S]*?src:\\s*'[^']*/items/(?:system|users/[^/]+)/([^/]+)/model\\.glb'`).exec(catalog)?.[1];
      expect(local.has(src ?? ''), `${id} → ${src}`).toBe(true);
    }
  });
});

describe('swapUpdateOf — khớp bằng đúng phép dựng cảnh (T3)', () => {
  it('= itemFitOf(thư mục, hộp, heightMm, trần) của lượt dựng lại; không còn chặn MAX_STRETCH riêng; giữ hộp ≤ hộp', () => {
    // Giường đôi vào hộp sofa 2,2 × 0,95: luật cũ (MAX_STRETCH 1,8) cho sx = 0,95/2 × 1,8 — khác phép khớp dựng cảnh.
    const node = nodeOf(sofaAsset, { metadata: { appfront: { fields: { heightMm: 700 } } } });
    const update = swapUpdateOf(node, CATALOG[3]!, 3000) as { asset: SwapAsset; metadata: { appfront: { fields: Record<string, unknown> } } };
    const fit = itemFitOf('double-bed', 2.2, 0.95, 700, 3000)!;
    expect(update.asset).toMatchObject({ id: 'double-bed', category: 'sofa', name: 'Giường đôi', src: '/items/double-bed/model.glb' });
    expect(update.asset.dimensions).toEqual(fit.shownM);
    expect(update.asset.scale).toEqual(fit.scale);
    expect(update.asset.offset?.[1]).toBeCloseTo(fit.offset[1]);
    expect(update.asset.dimensions?.[0]).toBeLessThanOrEqual(2.2 + 1e-9);
    // Node AppFront được đánh dấu "mẫu người dùng, cỡ đang thấy".
    expect(update.metadata.appfront.fields[USER_SEEN_FIELD]).toBe(true);
    expect(update.metadata.appfront.fields['heightMm']).toBe(700);
  });

  it('bỏ surface của mẫu cũ; node không có siêu dữ liệu AppFront không bị gắn cờ', () => {
    const update = swapUpdateOf(nodeOf({ ...sofaAsset, surface: { height: 0.4 } }), CATALOG[1]!) as { asset: SwapAsset; metadata?: unknown };
    expect(update.asset.surface).toBeUndefined();
    expect(update.metadata).toBeUndefined();
  });

  it('mẫu không khớp được (ngoài catalog) → null', () => {
    expect(swapUpdateOf(nodeOf(sofaAsset), entry('khong-co', 'X', [1, 1, 1]))).toBeNull();
  });
});

type Node = SwapNode;

const storesWith = (nodes: Record<string, Node>, selectedIds: string[]) => {
  const scene = create<{ nodes: Record<string, Node>; updateNode(id: string, data: object): void }>()((set) => ({
    nodes,
    // eslint-disable-next-line local/no-direct-set -- store giả của Pascal (vendor), không phải store AppFront.
    updateNode: (id, data) => set((s) => ({ nodes: { ...s.nodes, [id]: { ...s.nodes[id]!, ...data } } })),
  }));
  const viewer = create<{ selection: { selectedIds: string[] } }>()(() => ({ selection: { selectedIds } }));
  return { scene, viewer, stores: { useScene: scene, useViewer: viewer } as unknown as SwapModelStores };
};

const NODES: Record<string, Node> = {
  item_a: { id: 'item_a', type: 'item', asset: sofaAsset },
  item_b: { id: 'item_b', type: 'item', asset: { ...sofaAsset, src: '/items/double-bed/model.glb' } },
  wall_a: { id: 'wall_a', type: 'wall' },
};

describe('SwapModelCard', () => {
  it('một item được chọn: liệt kê mẫu cùng nhóm (mẫu đang dùng được đánh dấu), bấm → updateNode với asset đã khớp', () => {
    const { scene, stores } = storesWith(NODES, ['item_a']);
    render(<SwapModelCard catalog={CATALOG} readOnly={false} stores={stores} />);

    const list = screen.getByRole('list', { name: 'Mẫu cùng loại' });
    expect([...list.querySelectorAll('button')].map((b) => b.textContent)).toEqual(['Ghế sofa', 'Ghế bành', 'Ghế thư giãn']);
    expect(screen.getByRole('button', { pressed: true }).textContent).toBe('Ghế sofa');
    expect(list.querySelector('img')?.getAttribute('src')).toBe('/pascal/items/sofa/thumbnail.webp');

    fireEvent.click(screen.getByRole('button', { name: 'Ghế bành' }));
    expect(scene.getState().nodes.item_a!.asset).toEqual((swapUpdateOf(nodeOf(sofaAsset, { id: 'item_a' }), CATALOG[1]!) as { asset: SwapAsset }).asset);
    // Thẻ đọc lại node mới: mẫu đang dùng giờ là ghế bành.
    expect(screen.getByRole('button', { pressed: true }).textContent).toBe('Ghế bành');
  });

  it.each([
    ['không chọn gì', []],
    ['chọn hai item', ['item_a', 'item_b']],
    ['chọn một tường', ['wall_a']],
  ])('ẩn khi %s', (_label, ids) => {
    const { stores } = storesWith(NODES, ids);
    const { container } = render(<SwapModelCard catalog={CATALOG} readOnly={false} stores={stores} />);
    expect(container.innerHTML).toBe('');
  });

  it('ẩn ở chế độ chỉ đọc', () => {
    const { stores } = storesWith(NODES, ['item_a']);
    const { container } = render(<SwapModelCard catalog={CATALOG} readOnly stores={stores} />);
    expect(container.innerHTML).toBe('');
  });

  it('main.tsx gắn thẻ vào khe thanh trái với catalog và store thật', () => {
    expect(read('src/pascal-page/main.tsx')).toContain(
      '<SwapModelCard catalog={CATALOG_ITEMS} readOnly={readOnly} stores={{ useScene, useViewer }} />',
    );
  });
});

/** Ba mẫu sofa THẬT của `libraryRoles.json` (vai sofa) — URL ký; một mẫu không có ảnh xem trước. */
const SOFAS = [
  { id: 'sofa-ash-grey-3-seater-pillows', name: 'Sofa xám 3 chỗ', widthMm: 2100, heightMm: 850, depthMm: 900, previewUrl: 'https://s3.test/a.webp?sig=1' },
  { id: 'sofa-ash-grey-loveseat-pillows', name: 'Sofa xám đôi', widthMm: 1500, heightMm: 850, depthMm: 880, previewUrl: 'https://s3.test/b.webp?sig=1' },
  { id: 'sofa-beige-3-seater-slim-legs', name: 'Sofa be 3 chỗ', widthMm: 2050, heightMm: 800, depthMm: 900 },
] as const;
const signed = (id: string, sig: number): string => `https://s3.test/library/${id}.glb?X-Amz-Signature=${sig}`;
const loadLibrary = (): void => {
  replaceServerLibrary(SOFAS.map((m) => ({ ...m, modelUrl: signed(m.id, 1), furnitureKind: 'other', attribution: 'CC0' })));
};
/** Node sofa toPascal dựng (mẫu luật = mẫu máy chủ A, URL ký), siêu dữ liệu AppFront có loại/variant/hộp. */
const serverSofa = (src = signed(SOFAS[0].id, 1)): Node => ({
  id: 'item_F-0000000SOFA18',
  type: 'item',
  parentId: 'level_L',
  position: [2, 0, 2],
  rotation: [0, 0, 0],
  scale: [1, 1, 1],
  asset: { ...sofaAsset, src, thumbnail: SOFAS[0].previewUrl },
  metadata: {
    appfront: {
      confidence: 0.8,
      source: 'ai',
      reviewed: false,
      fields: { kind: 'other', variant: 'sofa', rotationDeg: 0, boundingBox: { min: { x: 900, y: 1525 }, max: { x: 3100, y: 2475 } } },
    },
  },
});

describe('M18 LA — thư viện máy chủ (T1, T2)', () => {
  it('T1: node appfront-sofa, src URL ký → ứng viên = sofa của thư viện hiện hành; mẫu đang dùng aria-pressed, mẫu khác bấm được', () => {
    loadLibrary();
    const node = serverSofa();
    const options = swapCandidates(node, []);
    expect(options.map((o) => o.id).sort()).toEqual(SOFAS.map((m) => m.id).sort());
    expect(options[0]?.id).toBe(SOFAS[0].id);
    expect(options.length).toBeLessThanOrEqual(MAX_SWAP_OPTIONS);

    const { scene, stores } = storesWith({ [node.id]: node, level_L: { id: 'level_L', type: 'level', height: 3 } }, [node.id]);
    const tiles = SOFAS.map((m) => ({ id: m.id, name: m.name, thumbnail: '', src: signed(m.id, 1) }));
    render(<SwapModelCard catalog={tiles} readOnly={false} stores={stores} />);
    expect(screen.getByTestId('swap-model')).toBeTruthy();
    const buttons = screen.getAllByTestId('swap-model-option');
    expect(buttons.map((b) => b.getAttribute('data-model-id')).sort()).toEqual(SOFAS.map((m) => m.id).sort());
    const pressed = screen.getByRole('button', { pressed: true });
    expect(pressed.getAttribute('data-model-id')).toBe(SOFAS[0].id);
    expect(pressed.textContent).toBe('Sofa xám 3 chỗ');
    // Mẫu không có ảnh xem trước: ô giữ chỗ, không <img src="">.
    expect(screen.getAllByTestId('swap-model-placeholder')).toHaveLength(1);
    expect([...document.querySelectorAll('img')].every((img) => (img.getAttribute('src') ?? '') !== '')).toBe(true);

    const target = buttons.find((b) => b.getAttribute('data-model-id') === SOFAS[2].id) as HTMLButtonElement;
    expect(target.disabled).toBe(false);
    fireEvent.click(target);
    const after = scene.getState().nodes[node.id]!;
    expect(after.asset?.id).toBe(SOFAS[2].id);
    expect(after.asset?.src).toBe(signed(SOFAS[2].id, 1));
    expect(after.metadata?.appfront?.fields?.[USER_SEEN_FIELD]).toBe(true);
    // Cỡ = phép khớp dựng cảnh trong hộp 2,2 × 0,95 với trần tầng cha 3 m.
    expect(after.asset?.dimensions).toEqual(itemFitOf(SOFAS[2].id, 2.2, 0.95, undefined, 3000)?.shownM);
    expect(CATALOG_MODELS[SOFAS[2].id]).toBeDefined();
  });

  it('T2: hai URL ký khác id → không phải mẫu đang dùng; cùng id khác chữ ký → là mẫu đang dùng', () => {
    loadLibrary();
    const asset = { ...sofaAsset, src: signed(SOFAS[0].id, 1) };
    expect(isCurrentModel(asset, { id: SOFAS[1].id, name: '', thumbnail: '', src: signed(SOFAS[1].id, 2) })).toBe(false);
    expect(isCurrentModel(asset, { id: SOFAS[0].id, name: '', thumbnail: '', src: signed(SOFAS[0].id, 9) })).toBe(true);
  });
});
