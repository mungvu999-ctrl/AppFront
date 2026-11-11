// Bảng tay chép từ vendor/pascal catalog-items.tsx (không import: file đó mang 333 URL supabase,
// còn toPascal được app chính import). furnitureCatalog.test.ts đối chiếu từng dòng với catalog.
import type { FurnitureKind } from '@/domain/spatial/types';

import { SCENE_PALETTE } from './scenePalette';
import { drapeFileFolderOf } from './sceneDressingDrape';
import SURFACE_TOPS from './surfaceTops.json' with { type: 'json' };

export interface CatalogModel {
  readonly folder: string;
  /** Mét, [w, h, d]. */
  readonly dimensions: readonly [number, number, number];
  readonly offset: readonly [number, number, number];
  readonly rotation: readonly [number, number, number];
  /** Scale riêng của catalog (bỏ = [1, 1, 1]): `dimensions` là cỡ SAU scale này, GLB gốc to hơn. */
  readonly scale?: readonly [number, number, number];
  readonly attachTo?: string;
  readonly interactive?: unknown;
  /** Mét (khung mẫu): mặt đặt đồ nhập tay, thắng số đo GLB `surfaceTops.json`; chỉ dùng khi số đo sai. */
  readonly topY?: number;
  /** Mẫu đã có chăn gối thật (giường Sketchfab): luật bày đồ không đặt chăn gấp lên nữa. */
  readonly dressed?: boolean;
}

/** Dòng chép từ catalog-items.tsx của Pascal — test bắt khớp từng trường. */
export const VENDOR_MODELS: Readonly<Record<string, CatalogModel>> = {
  'double-bed': {
    folder: 'double-bed',
    dimensions: [1.52, 0.71, 2],
    offset: [0.0042, 0, -0.0277],
    rotation: [0, 0, 0],
  },
  'single-bed': {
    folder: 'single-bed',
    dimensions: [1.08, 0.6, 2.14],
    offset: [-0.0024, 0, -0.013],
    rotation: [0, 0, 0],
  },
  closet: {
    folder: 'closet',
    dimensions: [1.95, 2.26, 0.6],
    offset: [0, 0, -0.0141],
    rotation: [0, 0, 0],
  },
  'dining-chair': {
    folder: 'dining-chair',
    dimensions: [0.47, 0.87, 0.5],
    offset: [0, 0, 0.0016],
    rotation: [0, 0, 0],
  },
  'office-chair': {
    folder: 'office-chair',
    dimensions: [0.66, 1.16, 0.69],
    offset: [0.0024, 0.0015, 0.0332],
    rotation: [0, 0, 0],
  },
  'dining-table': {
    folder: 'dining-table',
    dimensions: [2.16, 0.7, 0.95],
    offset: [0, 0, -0.0077],
    rotation: [0, 0, 0],
  },
  'bedside-table': {
    folder: 'bedside-table',
    dimensions: [0.45, 0.48, 0.46],
    offset: [0.0005, 0, -0.0062],
    rotation: [0, 0, 0],
  },
  'coffee-table': {
    folder: 'coffee-table',
    dimensions: [1.72, 0.3, 1.04],
    offset: [0, 0, 0.0089],
    rotation: [0, 0, 0],
  },
  'office-table': {
    folder: 'office-table',
    dimensions: [1.51, 0.76, 0.62],
    offset: [-0.0001, 0, -0.0052],
    rotation: [0, 0, 0],
  },
  'kitchen-counter': {
    folder: 'kitchen-counter',
    dimensions: [1.96, 0.73, 0.63],
    offset: [0.0012, 0, -0.0004],
    rotation: [0, 0, 0],
  },
  fridge: {
    folder: 'fridge',
    dimensions: [0.7, 1.92, 0.72],
    offset: [0, 0, -0.0507],
    rotation: [0, 0, 0],
  },
  // `kitchen-counter` là khối hộp trơn (không cửa, không tay nắm) — chỉ giữ cho dữ liệu cũ.
  // Tủ bếp dưới: ngăn kéo + cửa + tay nắm (khe cabinet/countertop/handle).
  'kitchen-cabinet': {
    folder: 'kitchen-cabinet',
    dimensions: [1.65, 1.09, 0.77],
    offset: [0, 0.0004, 0],
    rotation: [0, 0, 0],
  },
  // Dãy bếp dài có chậu rửa + vòi + cửa tủ (một vật liệu GLB, không khe).
  kitchen: {
    folder: 'kitchen',
    dimensions: [2.38, 1.03, 0.84],
    offset: [0, 0, 0],
    rotation: [0, 0, 0],
  },
  toilet: {
    folder: 'toilet',
    dimensions: [0.42, 0.82, 0.72],
    offset: [0, 0, -0.2393],
    rotation: [0, 0, 0],
  },
  'shower-square': {
    folder: 'shower-square',
    dimensions: [0.81, 1.8, 0.81],
    offset: [0.4, 0, -0.3995],
    rotation: [0, 0, 0],
  },
  bathtub: {
    folder: 'bathtub',
    dimensions: [2.34, 0.79, 1.11],
    offset: [0, 0, 0],
    rotation: [0, 0, 0],
  },
  'bathroom-sink': {
    folder: 'bathroom-sink',
    dimensions: [1.83, 0.97, 0.63],
    offset: [0.1037, 0, 0.0221],
    rotation: [0, 0, 0],
  },
  sofa: {
    folder: 'sofa',
    dimensions: [2.06, 0.74, 1.01],
    offset: [-0.0023, 0.009, 0.0459],
    rotation: [0, 0, 0],
  },
  'indoor-plant': {
    folder: 'indoor-plant',
    dimensions: [0.69, 1.63, 0.83],
    offset: [-0.0506, 0, 0.0664],
    rotation: [0, 0, 0],
  },
  'small-indoor-plant': {
    folder: 'small-indoor-plant',
    dimensions: [0.4, 0.67, 0.38],
    offset: [-0.0106, 0, 0.0067],
    rotation: [0, 0, 0],
  },
  'rectangular-carpet': {
    folder: 'rectangular-carpet',
    dimensions: [2.78, 0.04, 1.81],
    offset: [0, 0, 0],
    rotation: [0, 0, 0],
  },
  'round-carpet': {
    folder: 'round-carpet',
    dimensions: [1.99, 0.05, 1.99],
    offset: [0, 0, 0],
    rotation: [0, 0, 0],
  },
  'recessed-light': {
    folder: 'recessed-light',
    dimensions: [0.23, 0.06, 0.23],
    offset: [0, 0.0057, 0],
    rotation: [0, 0, 0],
    attachTo: 'ceiling',
    interactive: {
      controls: [
        { kind: 'toggle' },
        {
          kind: 'slider',
          label: 'Intensity',
          min: 0,
          max: 100,
          unit: '%',
          displayMode: 'dial',
          default: 100,
        },
      ],
      effects: [{ kind: 'light', intensityRange: [0, 2], color: SCENE_PALETTE.catalogLight, offset: [0, -0.1, 0] }],
    },
  },
  'ceiling-lamp': {
    folder: 'ceiling-lamp',
    dimensions: [0.55, 0.86, 0.55],
    offset: [0, 0.8545, 0],
    rotation: [0, 0, 0],
    attachTo: 'ceiling',
    interactive: {
      controls: [
        { kind: 'toggle' },
        {
          kind: 'slider',
          label: 'Intensity',
          min: 0,
          max: 100,
          unit: '%',
          displayMode: 'dial',
          default: 100,
        },
      ],
      effects: [{ kind: 'light', intensityRange: [0, 2], color: SCENE_PALETTE.catalogLight, offset: [0, -0.3, 0] }],
    },
  },
  'table-lamp': {
    folder: 'table-lamp',
    dimensions: [0.29, 0.74, 0.67],
    offset: [0, 0, 0],
    rotation: [0, 0, 0],
  },
  'round-mirror': {
    folder: 'round-mirror',
    dimensions: [0.57, 0.57, 0.05],
    offset: [0, 0.2848, 0],
    rotation: [0, 0, 0],
    attachTo: 'wall-side',
  },
  picture: {
    folder: 'picture',
    dimensions: [1.47, 0.82, 0.06],
    offset: [0, 0.41, 0],
    rotation: [0, 0, 0],
    attachTo: 'wall-side',
  },
  bookshelf: {
    folder: 'bookshelf',
    dimensions: [0.93, 1.99, 0.33],
    offset: [0, 0, 0.0032],
    rotation: [0, 0, 0],
  },
  'kitchen-shelf': {
    folder: 'kitchen-shelf',
    dimensions: [2.21, 0.89, 0.52],
    offset: [-0.0009, 0.4478, 0],
    rotation: [0, 0, 0],
    attachTo: 'wall-side',
  },
  hood: {
    folder: 'hood',
    dimensions: [1.21, 0.52, 0.51],
    offset: [0, 0.2718, 0],
    rotation: [0, 0, 0],
    attachTo: 'wall-side',
  },
  stove: {
    folder: 'stove',
    dimensions: [0.92, 0.85, 0.76],
    offset: [0.0043, 0, -0.0505],
    rotation: [0, 0, 0],
  },
  'washing-machine': {
    folder: 'washing-machine',
    dimensions: [0.6, 0.86, 0.53],
    offset: [0, 0, -0.0114],
    rotation: [0, 0, 0],
  },
  stool: {
    folder: 'stool',
    dimensions: [0.52, 1.16, 0.55],
    offset: [0, 0, 0],
    rotation: [0, 0, 0],
  },
  dresser: {
    folder: 'dresser',
    dimensions: [1.23, 0.73, 0.61],
    offset: [0, 0, -0.0066],
    rotation: [0, 0, 0],
  },
  television: {
    folder: 'television',
    dimensions: [1.62, 1.07, 0.38],
    offset: [0, 0, 0],
    rotation: [0, 0, 0],
  },
  'livingroom-chair': {
    folder: 'livingroom-chair',
    dimensions: [1.1, 0.75, 1.07],
    offset: [0, 0.0001, 0.0053],
    rotation: [0, 0, 0],
  },
  'floor-lamp': {
    folder: 'floor-lamp',
    dimensions: [0.7, 1.86, 0.69],
    offset: [0.0341, 0.0045, 0.0219],
    rotation: [0, 0, 0],
    interactive: {
      controls: [
        { kind: 'toggle' },
        {
          kind: 'slider',
          label: 'Intensity',
          min: 0,
          max: 100,
          unit: '%',
          displayMode: 'dial',
          default: 100,
        },
      ],
      effects: [{ kind: 'light', intensityRange: [0, 2], color: SCENE_PALETTE.catalogLight, offset: [0, 1.4, 0] }],
    },
  },
  sunbed: {
    folder: 'sunbed',
    dimensions: [0.86, 1.13, 1.01],
    offset: [0, 0.0516, 0.0137],
    rotation: [0, 0, 0],
  },
  palm: {
    folder: 'palm',
    dimensions: [0.525, 4.5, 0.496],
    offset: [0, 0.08, 0],
    rotation: [0, 0, 0],
    scale: [0.37, 0.37, 0.37],
  },
  'fir-tree': {
    folder: 'fir-tree',
    dimensions: [0.27, 3, 0.23],
    offset: [0.02, 0.05, -0.06],
    rotation: [0, 0, 0],
  },
  bush: {
    folder: 'bush',
    dimensions: [3, 1.04, 1.01],
    offset: [-0.1463, 0.0094, -0.113],
    rotation: [0, 0, 0],
    scale: [0.96, 0.96, 0.96],
  },
  // Có sẵn ở vendor/pascal/assets/items, đăng ký để biến thể / bày biện dùng được.
  cactus: {
    folder: 'cactus',
    dimensions: [0.34, 0.39, 0.27],
    offset: [-0.0039, 0, 0],
    rotation: [0, 0, 0],
  },
  books: {
    folder: 'books',
    dimensions: [0.22, 0.22, 0.18],
    offset: [-0.0851, 0.003, 0.0209],
    rotation: [0, 0, 0],
  },
  'tv-stand': {
    folder: 'tv-stand',
    dimensions: [1.86, 0.35, 0.32],
    offset: [0, 0.2066, 0],
    rotation: [0, 0, 0],
  },
  'lounge-chair': {
    folder: 'lounge-chair',
    dimensions: [0.68, 1.03, 1.26],
    offset: [0, 0.0034, 0.0894],
    rotation: [0, 0, 0],
  },
  shelf: {
    folder: 'shelf',
    dimensions: [0.74, 0.04, 0.32],
    offset: [0, 0.02, 0],
    rotation: [0, 0, 0],
    attachTo: 'wall-side',
  },
};

/** Ánh sáng của đèn tường AppFront: nguồn sáng trong chao (khung mô hình, chưa nhân scale). */
const SCONCE_INTERACTIVE = {
  controls: [
    { kind: 'toggle' },
    { kind: 'slider', label: 'Intensity', min: 0, max: 100, unit: '%', displayMode: 'dial', default: 100 },
  ],
  effects: [{ kind: 'light', intensityRange: [0, 2], color: SCENE_PALETTE.catalogLight, offset: [0, 0.2, 0] }],
};

/**
 * Mẫu riêng của AppFront (FE3D-FIX-004 D), không có dòng trong catalog Pascal: nguồn ở
 * `assets/appfront-items/<folder>/` (sinh bằng `scripts/gen-decor-models.mjs`; 4 mẫu CC0 Poly Haven —
 * xem LICENSES.md), `copy-pascal-assets.mjs` chép tới `/pascal/items/`. Quy ước như mẫu Pascal: mét,
 * tâm x/z, đáy y = 0, mặt trước +z — nên offset/rotation đều 0. Kích thước = hộp bao của GLB.
 */
export const APPFRONT_MODELS: Readonly<Record<string, CatalogModel>> = {
  curtain: { folder: 'curtain', dimensions: [0.8, 2.272, 0.102], offset: [0, 0, 0], rotation: [0, 0, 0] },
  pillow: { folder: 'pillow', dimensions: [0.45, 0.45, 0.15], offset: [0, 0, 0], rotation: [0, 0, 0] },
  'throw-blanket': { folder: 'throw-blanket', dimensions: [1.2, 0.057, 0.5], offset: [0, 0, 0], rotation: [0, 0, 0] },
  // Bản có UV (`?drape=uv`, gen-decor-models.mjs --uv-only): cùng kích thước bản gốc.
  'curtain-uv': { folder: 'curtain-uv', dimensions: [0.8, 2.272, 0.102], offset: [0, 0, 0], rotation: [0, 0, 0] },
  'pillow-uv': { folder: 'pillow-uv', dimensions: [0.45, 0.45, 0.15], offset: [0, 0, 0], rotation: [0, 0, 0] },
  'throw-blanket-uv': { folder: 'throw-blanket-uv', dimensions: [1.2, 0.057, 0.5], offset: [0, 0, 0], rotation: [0, 0, 0] },
  'wall-sconce': {
    folder: 'wall-sconce',
    dimensions: [0.15, 0.23, 0.15],
    offset: [0, 0, 0],
    rotation: [0, 0, 0],
    attachTo: 'wall-side',
    interactive: SCONCE_INTERACTIVE,
  },
  'ceramic-vase': { folder: 'ceramic-vase', dimensions: [0.204, 0.4, 0.204], offset: [0, 0, 0], rotation: [0, 0, 0] },
  'ceramic-vase-slim': {
    folder: 'ceramic-vase-slim',
    dimensions: [0.112, 0.414, 0.112],
    offset: [0, 0, 0],
    rotation: [0, 0, 0],
  },
  'fancy-picture-frame': {
    folder: 'fancy-picture-frame',
    dimensions: [0.604, 0.464, 0.02],
    offset: [0, 0, 0],
    rotation: [0, 0, 0],
    attachTo: 'wall-side',
  },
  ottoman: { folder: 'ottoman', dimensions: [0.884, 0.624, 0.622], offset: [0, 0, 0], rotation: [0, 0, 0] },
  // editor-realism B1: Poly Haven CC0 (sofa_02, Armchair_01, dining_chair_02), một vật liệu, màu cố định.
  'sofa-ph': { folder: 'sofa-ph', dimensions: [1.807, 0.709, 0.818], offset: [0, 0, 0], rotation: [0, 0, 0] },
  'armchair-ph': { folder: 'armchair-ph', dimensions: [0.82, 1.023, 0.987], offset: [0, 0, 0], rotation: [0, 0, 0] },
  'dining-chair-ph': {
    folder: 'dining-chair-ph',
    dimensions: [0.431, 0.971, 0.576],
    offset: [0, 0, 0],
    rotation: [0, 0, 0],
  },
  // editor-realism P1: Poly Haven CC0, lá cắt bằng ảnh alpha thật (MASK 0.5, hai mặt). Hộp = khung bao GLB.
  // plant-ph: cây kim ngân pachira_aquatica_01 (cây cao nhất) trồng trong chậu potted_plant_02.
  'plant-ph': { folder: 'plant-ph', dimensions: [0.844, 1.809, 0.798], offset: [0, 0, 0], rotation: [0, 0, 0] },
  'planter-ph': { folder: 'planter-ph', dimensions: [0.691, 0.769, 0.605], offset: [0, 0, 0], rotation: [0, 0, 0] },
  // review2 gói 1: thảm chữ nhật Pascal bỏ tua (scripts/realism-assets/carpet.mjs), giữ khe slot_a/slot_b.
  'rug-nf': { folder: 'rug-nf', dimensions: [2.5, 0.03, 1.8], offset: [0, 0, 0], rotation: [0, 0, 0] },
  // review2 gói 2A: Poly Haven CC0 thay hộp Pascal yếu (gỗ sồi sáng / khung sáng), màu cố định.
  'bedside-table-ph': {
    folder: 'bedside-table-ph',
    dimensions: [0.55, 0.551, 0.45],
    offset: [0, 0, 0],
    rotation: [0, 0, 0],
  },
  'bookshelf-ph': { folder: 'bookshelf-ph', dimensions: [1.078, 1.556, 0.372], offset: [0, 0, 0], rotation: [0, 0, 0] },
  // Đèn thả trần: giữ attachTo + interactive (công tắc, độ sáng, nguồn sáng) của dòng Pascal — swap thay cả dòng.
  'ceiling-lamp-ph': {
    folder: 'ceiling-lamp-ph',
    dimensions: [0.432, 0.952, 0.432],
    offset: [0, 0, 0],
    rotation: [0, 0, 0],
    attachTo: 'ceiling',
    interactive: VENDOR_MODELS['ceiling-lamp']?.interactive,
  },
  'picture-ph': {
    folder: 'picture-ph',
    dimensions: [0.752, 0.5, 0.033],
    offset: [0, 0, 0],
    rotation: [0, 0, 0],
    attachTo: 'wall-side',
  },
  // Luống ban công (bush): bồn gỗ dài planter_box_02 + 5 cây lá alpha thật (potted_plant_02), tỉ lệ ≈ hộp bush.
  'planter-long': { folder: 'planter-long', dimensions: [2.378, 0.873, 0.653], offset: [0, 0, 0], rotation: [0, 0, 0] },
  // Gói 4B: tủ sinh bằng code (scripts/realism-assets/cabinets.mjs) thay tủ khối hộp Pascal — chân đế lùi, cánh tách
  // khe 3 mm, mép vát, tay nắm thanh, mặt đá nhô. Khe vật liệu đúng tên mẫu Pascal; hộp = hộp Pascal.
  // Gói 5: Sketchfab CC BY 4.0 (ghi nguồn ở LICENSES.md).
  'wardrobe-sf': { folder: 'wardrobe-sf', dimensions: [1.203, 2.2, 0.637], offset: [0, 0, 0], rotation: [0, 0, 0] },
  'fridge-sf': { folder: 'fridge-sf', dimensions: [0.921, 1.85, 0.795], offset: [0, 0, 0], rotation: [0, 0, 0] },
  'toilet-sf': { folder: 'toilet-sf', dimensions: [0.476, 0.74, 0.604], offset: [0, 0, 0], rotation: [0, 0, 0] },
  'vanity-sf': { folder: 'vanity-sf', dimensions: [0.917, 1.13, 0.636], offset: [0, 0, 0], rotation: [0, 0, 0] },
  'dining-table-sf': {
    folder: 'dining-table-sf',
    dimensions: [2.407, 0.76, 0.926],
    offset: [0, 0, 0],
    rotation: [0, 0, 0],
  },
  'dresser-sf': { folder: 'dresser-sf', dimensions: [1.096, 0.96, 0.55], offset: [0, 0, 0], rotation: [0, 0, 0] },
  'tv-sf': { folder: 'tv-sf', dimensions: [1.16, 0.716, 0.366], offset: [0, 0, 0], rotation: [0, 0, 0] },
  // Gói 6: giường (có sẵn chăn gối), cabin tắm ép vuông, máy hút mùi áp tường, bếp liền lò, bàn trà gỗ.
  'bed-sf': { folder: 'bed-sf', dimensions: [1.8, 0.938, 2.252], offset: [0, 0, 0], rotation: [0, 0, 0], dressed: true },
  'shower-sf': { folder: 'shower-sf', dimensions: [0.95, 1.998, 0.95], offset: [0, 0, 0], rotation: [0, 0, 0] },
  'hood-sf': {
    folder: 'hood-sf',
    dimensions: [0.76, 0.76, 0.503],
    offset: [0, 0, 0],
    rotation: [0, 0, 0],
    attachTo: 'wall-side',
  },
  'stove-sf': { folder: 'stove-sf', dimensions: [0.76, 1.09, 0.659], offset: [0, 0, 0], rotation: [0, 0, 0] },
  // Mặt bếp gas (hob mỏng trên mặt đá): phần trên mặt lò của cùng mẫu stove-sf, không có mẫu Pascal tương ứng.
  'hob-sf': { folder: 'hob-sf', dimensions: [0.76, 0.127, 0.617], offset: [0, 0, 0], rotation: [0, 0, 0] },
  'coffee-table-sf': {
    folder: 'coffee-table-sf',
    dimensions: [1.2, 0.42, 0.65],
    offset: [0, 0, 0],
    rotation: [0, 0, 0],
  },
  'closet-gen': { folder: 'closet-gen', dimensions: [1.95, 2.26, 0.6], offset: [0, 0, 0], rotation: [0, 0, 0] },
  'kitchen-counter-gen': {
    folder: 'kitchen-counter-gen',
    dimensions: [1.96, 0.73, 0.63],
    offset: [0, 0, 0],
    rotation: [0, 0, 0],
  },
  'kitchen-cabinet-gen': {
    folder: 'kitchen-cabinet-gen',
    dimensions: [1.65, 1.09, 0.77],
    offset: [0, 0, 0],
    rotation: [0, 0, 0],
  },
  // Tủ bếp có chậu inox âm bàn + vòi (thay `kitchen` một vật liệu của Pascal); cùng hộp với tủ bếp dưới.
  'kitchen-sink-gen': {
    folder: 'kitchen-sink-gen',
    dimensions: [1.65, 1.09, 0.77],
    offset: [0, 0, 0],
    rotation: [0, 0, 0],
  },
  // Tủ bếp trên: giữ gắn tường như dòng Pascal (swap thay cả dòng). Pascal dời y 0,4478 vì GLB tâm giữa; mẫu này đáy y = 0.
  'kitchen-shelf-gen': {
    folder: 'kitchen-shelf-gen',
    dimensions: [2.21, 0.89, 0.52],
    offset: [0, 0, 0],
    rotation: [0, 0, 0],
    attachTo: 'wall-side',
  },
  'tv-stand-gen': { folder: 'tv-stand-gen', dimensions: [1.86, 0.35, 0.32], offset: [0, 0, 0], rotation: [0, 0, 0] },
};

/**
 * Mẫu thật thay sofa/ghế bành/ghế ăn (editor-realism B1). Đổi ở tầng thư mục → tệp: vai trò, phong cách,
 * `node.slots` vẫn theo thư mục cũ; chỉ `asset.src`/thumbnail và hộp khớp (CATALOG_MODELS) trỏ sang mẫu `-ph`.
 * Chỉ khi trang 3D bật cờ `viewer.realism-materials` (`setRealismModels(useRealism.getState().flags.materials)`
 * trong `src/pascal-page/main.tsx`). Mặc định TẮT: chỗ khác chạy `toPascalScene` (ngoài trang 3D, test) y cũ.
 */
export const REALISM_MODEL_SWAP: Readonly<Record<string, string>> = {
  sofa: 'sofa-ph',
  'livingroom-chair': 'armchair-ph',
  'dining-chair': 'dining-chair-ph',
  // P1: phủ `plant` + `bamboo` (cùng thư mục indoor-plant). Chậu theo phong cách (khe `pot`) không áp: màu cố định.
  'indoor-plant': 'plant-ph',
  // Chậu nhỏ (cây khi hộp < 0,25 m², phong cách ưu tiên cây nhỏ).
  'small-indoor-plant': 'planter-ph',
  'rectangular-carpet': 'rug-nf',
  // Gói 2A: `planter`/`shrub` ở F1 là luống dài sát lan can (bush kéo giãn theo trục) → bồn dài cùng tỉ lệ.
  bush: 'planter-long',
  'bedside-table': 'bedside-table-ph',
  bookshelf: 'bookshelf-ph',
  'ceiling-lamp': 'ceiling-lamp-ph',
  picture: 'picture-ph',
  // Gói 4B: tủ sinh bằng code (giữ khe slot_* như mẫu Pascal; khe mới slot_handle màu kim loại tối cố định).
  // Gói 5: mẫu Sketchfab CC BY 4.0 (người dùng tải, scripts/realism-assets/sketchfab.mjs). Tủ áo thay closet-gen.
  closet: 'wardrobe-sf',
  fridge: 'fridge-sf',
  toilet: 'toilet-sf',
  'bathroom-sink': 'vanity-sf',
  'dining-table': 'dining-table-sf',
  dresser: 'dresser-sf',
  television: 'tv-sf',
  'double-bed': 'bed-sf',
  'shower-square': 'shower-sf',
  hood: 'hood-sf',
  stove: 'stove-sf',
  'coffee-table': 'coffee-table-sf',
  'kitchen-counter': 'kitchen-counter-gen',
  'kitchen-cabinet': 'kitchen-cabinet-gen',
  kitchen: 'kitchen-sink-gen',
  'kitchen-shelf': 'kitchen-shelf-gen',
  'tv-stand': 'tv-stand-gen',
};
/** Thư mục tên gọi của một thư mục tệp (ngược `REALISM_MODEL_SWAP`, `bed-sf` → `double-bed`); thư mục khác giữ nguyên. */
const NAMED_FOLDER = new Map(Object.entries(REALISM_MODEL_SWAP).map(([folder, file]) => [file, folder]));
export const namedFolderOf = (fileFolder: string): string => NAMED_FOLDER.get(fileFolder) ?? fileFolder;

const realismModels = { on: false };
export const setRealismModels = (on: boolean): void => {
  realismModels.on = on;
};
const fileFolderOf = (folder: string): string =>
  drapeFileFolderOf(folder) ?? (realismModels.on ? REALISM_MODEL_SWAP[folder] : undefined) ?? folder;

/**
 * GLB không có material `slot_*` (bài kiểm quét GLB thật). Mẫu thế chỉ nhận "cả món một màu" (khe `a`, vá
 * `u53-whole-item-paint`), nên không phát khe phong cách: khe trơ làm lượt về không gộp được `a`, màu sơn mất khi lưu.
 */
export const NO_SLOT_MODELS: ReadonlySet<string> = new Set([
  'armchair-ph', 'ball', 'bathroom-sink', 'bed-sf', 'bedside-table-ph', 'books', 'bookshelf-ph', 'bunkbed',
  'ceiling-lamp', 'ceiling-lamp-ph', 'ceramic-vase', 'ceramic-vase-slim', 'coffee-table-sf', 'dining-chair-ph',
  'dining-table-sf', 'double-bed', 'dresser-sf', 'fancy-picture-frame', 'fridge', 'fridge-sf', 'hob-sf', 'hood',
  'hood-sf', 'kitchen', 'ottoman', 'picture-ph', 'plant-ph', 'planter-long', 'planter-ph', 'pool-table', 'shower-sf',
  'skate', 'sofa-ph', 'stove-sf', 'table-lamp', 'thermostat', 'threadmill', 'toilet-sf', 'toy', 'tv-sf', 'vanity-sf',
  'wardrobe-sf',
]);
export const modelHasSlots = (folder: string): boolean => !NO_SLOT_MODELS.has(fileFolderOf(folder));

export const CATALOG_MODELS: Readonly<Record<string, CatalogModel>> = { ...VENDOR_MODELS, ...APPFRONT_MODELS };
for (const [folder, ph] of Object.entries(REALISM_MODEL_SWAP)) {
  const base = CATALOG_MODELS[folder] as CatalogModel;
  const swapped = { ...(APPFRONT_MODELS[ph] as CatalogModel), folder };
  Object.defineProperty(CATALOG_MODELS, folder, { enumerable: true, get: () => (realismModels.on ? swapped : base) });
}

/** Variant đăng nhập → model Pascal; null = không có model hợp, dùng fallback. liftMm = độ cao đặt trên sàn. */
export const VARIANT_MODEL: Readonly<
  Record<string, { readonly folder: string; readonly liftMm?: number } | null>
> = {
  bed: { folder: 'double-bed' },
  nightstand: { folder: 'bedside-table' },
  tableLamp: { folder: 'table-lamp', liftMm: 480 },
  wardrobe: { folder: 'closet' },
  rug: { folder: 'rectangular-carpet' },
  plant: { folder: 'indoor-plant' },
  shower: { folder: 'shower-square' },
  wc: { folder: 'toilet' },
  basin: { folder: 'bathroom-sink' },
  mirror: { folder: 'round-mirror', liftMm: 1200 },
  artwork: { folder: 'picture', liftMm: 1400 },
  shelves: { folder: 'bookshelf' },
  table: { folder: 'dining-table' },
  chair: { folder: 'dining-chair' },
  baseRun: { folder: 'kitchen-cabinet' },
  upperRun: { folder: 'kitchen-shelf', liftMm: 1450 },
  hood: { folder: 'hood', liftMm: 1500 },
  hob: { folder: 'stove' },
  sink: { folder: 'kitchen' },
  fridge: { folder: 'fridge' },
  stool: { folder: 'stool' },
  cabinet: { folder: 'dresser' },
  sofa: { folder: 'sofa' },
  // Đèn tường AppFront (đế áp tường + chao vải), có phát sáng; đáy ở 1,8 m.
  sconce: { folder: 'wall-sconce', liftMm: 1800 },
  tv: { folder: 'television' },
  armchair: { folder: 'livingroom-chair' },
  sideTable: { folder: 'bedside-table' },
  floorLamp: { folder: 'floor-lamp' },
  // Ghế đôn bọc vải (Poly Haven Ottoman_01, CC0) — trước đây mượn kệ TV.
  bench: { folder: 'ottoman' },
  pendant: { folder: 'ceiling-lamp', liftMm: 1500 },
  vase: { folder: 'ceramic-vase' },
  lounger: { folder: 'sunbed' },
  planter: { folder: 'bush' },
  bamboo: { folder: 'indoor-plant' },
  shrub: { folder: 'bush' },
};

/** Mục thư viện máy chủ tối thiểu mà danh mục cần (khớp `LibraryItem` của `@/api/client`). */
export interface ServerLibraryModel {
  readonly id: string;
  readonly widthMm: number;
  readonly heightMm: number;
  readonly depthMm: number;
  readonly modelUrl: string;
  readonly previewUrl?: string;
  readonly name?: string;
  readonly group?: string;
  readonly furnitureKind?: FurnitureKind;
  readonly attribution?: string;
}

/** Thư viện máy chủ (`GET /api/library`) đã nạp: thư mục → URL tệp. Rỗng = chỉ danh mục đóng gói. */
const SERVER_FILES = new Map<
  string,
  { readonly model: string; readonly preview?: string; readonly item: ServerLibraryModel; readonly prior: CatalogModel | undefined }
>();

/**
 * Gộp thư viện máy chủ vào `CATALOG_MODELS` (thư mục = `id` mục): mục máy chủ thắng mục đóng gói
 * cùng id, trừ mục đang bị swap realism (getter không ghi đè được). Trả số mục đã gộp.
 */
export const registerServerLibrary = (items: readonly ServerLibraryModel[]): number => {
  const target = CATALOG_MODELS as Record<string, CatalogModel>;
  let count = 0;
  for (const item of items) {
    const own = Object.getOwnPropertyDescriptor(target, item.id);
    if (own !== undefined && own.writable !== true) continue;
    const base = target[item.id];
    // Mục đóng gói bị che (nếu có) — `clearServerLibrary` trả lại khi đổi phiên. Đăng ký lại giữ mục gốc đầu tiên.
    const prior = SERVER_FILES.has(item.id) ? SERVER_FILES.get(item.id)?.prior : base;
    target[item.id] = {
      offset: base?.offset ?? [0, 0, 0],
      rotation: base?.rotation ?? [0, 0, 0],
      ...(base?.interactive === undefined ? {} : { interactive: base.interactive }),
      folder: item.id,
      dimensions: [item.widthMm / 1000, item.heightMm / 1000, item.depthMm / 1000],
    };
    SERVER_FILES.set(item.id, { model: item.modelUrl, ...(item.previewUrl === undefined ? {} : { preview: item.previewUrl }), item, prior });
    count += 1;
  }
  return count;
};

/**
 * Gỡ mọi mẫu máy chủ đã gộp (đổi/xoá phiên): thư viện máy chủ có cả mẫu riêng + URL ký của người dùng, người sau
 * không được thấy. Mục đóng gói bị che được trả lại; mục chỉ có trên máy chủ bị xoá khỏi `CATALOG_MODELS`.
 */
export const clearServerLibrary = (): void => {
  const target = CATALOG_MODELS as Record<string, CatalogModel>;
  for (const [id, { prior }] of SERVER_FILES) {
    if (prior === undefined) delete target[id];
    else target[id] = prior;
  }
  SERVER_FILES.clear();
};

/**
 * Id mẫu máy chủ đang giữ URL `url` (so phần trước `?`: chữ ký đổi mỗi lượt ký). `undefined` = không phải mẫu thư viện
 * đang nạp — kể cả URL của người dùng trước khi đã đổi phiên (`clearServerLibrary`).
 */
export const serverModelIdOfUrl = (url: string): string | undefined => {
  const bare = url.split('?')[0];
  for (const [id, file] of SERVER_FILES) if (file.model.split('?')[0] === bare) return id;
  return undefined;
};

/** true khi thư mục đến từ thư viện máy chủ. */
export const isServerModel = (folder: string): boolean => SERVER_FILES.has(folder);

/** Loại đồ của mẫu máy chủ (theo nhóm thư viện) — món mới đặt từ bảng đồ chưa có `kind` trong siêu dữ liệu. */
export const serverKindOf = (folder: string): FurnitureKind | undefined => SERVER_FILES.get(folder)?.item.furnitureKind;

/** Ghi công tác giả + giấy phép của mẫu máy chủ tải về; mẫu dựng sẵn không có. */
export const serverAttributionOf = (folder: string): string | undefined => SERVER_FILES.get(folder)?.item.attribution;

/**
 * `src` lưu xuống của mẫu máy chủ: URL ký hết hạn nên không lưu được; lưu dạng `/items/<id>/model.glb`
 * (khớp `MODEL_SRC` của toSpatial), lượt mở lại tra `modelSrcOf` ra URL ký mới.
 */
export const serverModelPath = (folder: string): string => `/items/${folder}/model.glb`;

/** Nhóm thư viện → hạng mục bảng đồ Pascal (`CatalogCategory`); còn lại là đồ nội thất. */
const PASCAL_CATEGORY_BY_GROUP: Readonly<Record<string, string>> = {
  sanitary: 'bathroom',
  kitchen: 'kitchen',
  technical: 'appliance',
};

/** Một ô bảng đồ Pascal (`CatalogItem` của `@pascal-app/editor`, khai lỏng vì lib không nhập Pascal). */
export interface ServerCatalogTile {
  readonly id: string;
  readonly category: string;
  readonly name: string;
  readonly tags: string[];
  readonly thumbnail: string;
  readonly src: string;
  readonly dimensions: [number, number, number];
  readonly offset: [number, number, number];
  readonly rotation: [number, number, number];
  readonly scale: [number, number, number];
}

/**
 * Ô bảng đồ cho các mẫu máy chủ tải về (có ghi công). Mẫu hộp dựng sẵn của máy chủ không vào:
 * Pascal đã có mẫu thật cùng loại, hộp màu chỉ làm rối bảng đồ.
 */
export const serverCatalogTiles = (): ServerCatalogTile[] =>
  [...SERVER_FILES.entries()]
    .filter(([, file]) => file.item.attribution !== undefined)
    .map(([id, file]) => ({
      id,
      category: PASCAL_CATEGORY_BY_GROUP[file.item.group ?? ''] ?? 'furniture',
      name: file.item.name ?? id,
      tags: ['floor'],
      thumbnail: file.preview ?? '',
      src: file.model,
      dimensions: [file.item.widthMm / 1000, file.item.heightMm / 1000, file.item.depthMm / 1000],
      offset: [0, 0, 0],
      rotation: [0, 0, 0],
      scale: [1, 1, 1],
    }));

/** Mục đóng gói vẫn giữ khi đã có thư viện máy chủ: công cụ tủ bếp mô-đun (`upstream/lib/build-palette.ts`). */
const KEPT_BUILTIN_IDS: ReadonlySet<string> = new Set(['cabinet']);

/**
 * Bảng đồ Pascal khi thư viện máy chủ tải được: bỏ mẫu đóng gói low-poly, chỉ giữ công cụ + mẫu tải về.
 * Không có mẫu máy chủ (lỗi/offline) → giữ nguyên danh mục đóng gói.
 */
export const libraryOnlyCatalog = <T extends { readonly id: string }>(builtins: readonly T[], tiles: readonly T[]): T[] =>
  tiles.length === 0 ? [...builtins] : [...builtins.filter((item) => KEPT_BUILTIN_IDS.has(item.id)), ...tiles];

export const modelSrcOf = (folder: string): string =>
  SERVER_FILES.get(folder)?.model ?? `/items/${fileFolderOf(folder)}/model.glb`;
export const thumbnailOf = (folder: string): string =>
  SERVER_FILES.get(folder)?.preview ?? `/items/${fileFolderOf(folder)}/thumbnail.webp`;

/**
 * Mặt đặt đồ của mẫu, tỉ lệ chiều cao (0 = đáy, 1 = đỉnh): `topY` tay thắng, không thì số đo GLB của
 * thư mục file thật (đã swap realism) — `node scripts/realism-assets/surface-tops.mjs`. undefined = chưa đo.
 */
export const topFractionOf = (folder: string): number | undefined => {
  const m = CATALOG_MODELS[folder];
  if (m === undefined) return undefined;
  return m.topY !== undefined ? m.topY / m.dimensions[1] : (SURFACE_TOPS as Record<string, number>)[fileFolderOf(folder)];
};
