import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  APPFRONT_MODELS,
  CATALOG_MODELS,
  NO_SLOT_MODELS,
  REALISM_MODEL_SWAP,
  VARIANT_MODEL,
  VENDOR_MODELS,
  libraryOnlyCatalog,
  modelSrcOf,
  setRealismModels,
  thumbnailOf,
} from '../furnitureCatalog';
import { itemSlotsOf, lampInteractiveOf } from '../sceneDressing';
import { setDrapeFlags } from '../sceneDressingDrape';

const ROOT = resolve(__dirname, '../../../..');
const CATALOG_TSX = readFileSync(
  resolve(ROOT, 'vendor/pascal/packages/editor/src/components/ui/item-catalog/catalog-items.tsx'),
  'utf8',
);

// 35 variant đăng nhập (CONTRACT I1) — cứng trong test tới khi FURNITURE_VARIANTS có mặt.
const VARIANTS = (
  'bed nightstand tableLamp wardrobe rug plant shower wc basin mirror artwork shelves table chair ' +
  'baseRun upperRun hood hob sink fridge stool cabinet sofa sconce tv armchair sideTable floorLamp ' +
  'bench pendant vase lounger planter bamboo shrub'
).split(' ');

/** Đọc một trường cấp 4 của entry `folder` trong catalog-items.tsx (mảng/object/giá trị đơn). */
function catalogField(folder: string, name: string): unknown {
  const s = CATALOG_TSX.indexOf(`\n    id: '${folder}',`);
  expect(s, `catalog thiếu ${folder}`).toBeGreaterThan(-1);
  const blk = CATALOG_TSX.slice(s, CATALOG_TSX.indexOf('\n  },', s));
  const m = new RegExp(`\\n    ${name}:\\s*`).exec(blk);
  if (!m) return undefined;
  const i = m.index + m[0].length;
  let end: number;
  if (blk[i] === '{' || blk[i] === '[') {
    let depth = 0;
    end = i;
    for (; end < blk.length; end++) {
      if ('{['.includes(blk[end]!)) depth++;
      if ('}]'.includes(blk[end]!) && --depth === 0) break;
    }
    end++;
  } else end = blk.indexOf('\n', i);
  // eslint-disable-next-line no-new-func -- literal JS lấy từ catalog vendor, chỉ trong test
  return new Function(`return ${blk.slice(i, end).replace(/,\s*$/, '')}`)();
}

describe('furnitureCatalog', () => {
  it('VARIANT_MODEL có đủ 35 variant, không thừa', () => {
    expect(Object.keys(VARIANT_MODEL).sort()).toEqual([...VARIANTS].sort());
  });

  it('mọi folder được tham chiếu có dòng catalog và model.glb thật', () => {
    const used = Object.values(VARIANT_MODEL).flatMap((v) => (v ? [v.folder] : []));
    for (const f of used) expect(CATALOG_MODELS[f], f).toBeDefined();
    for (const f of Object.keys(CATALOG_MODELS)) {
      const ok = ['public/pascal/items', 'vendor/pascal/assets/items', 'assets/appfront-items'].some((d) =>
        existsSync(resolve(ROOT, d, f, 'model.glb')),
      );
      expect(ok, `thiếu model.glb cho ${f}`).toBe(true);
    }
  });

  it('mọi dòng VENDOR_MODELS khớp catalog-items.tsx; CATALOG_MODELS = vendor + AppFront, không trùng', () => {
    expect(Object.keys(CATALOG_MODELS).sort()).toEqual([...Object.keys(VENDOR_MODELS), ...Object.keys(APPFRONT_MODELS)].sort());
    for (const f of Object.keys(APPFRONT_MODELS)) expect(VENDOR_MODELS[f], f).toBeUndefined();
    for (const [f, row] of Object.entries(VENDOR_MODELS)) {
      expect(row.folder).toBe(f);
      expect(row.dimensions, f).toEqual(catalogField(f, 'dimensions'));
      expect(row.offset, f).toEqual(catalogField(f, 'offset'));
      expect(row.rotation, f).toEqual(catalogField(f, 'rotation'));
      expect(row.scale ?? [1, 1, 1], f).toEqual(catalogField(f, 'scale') ?? [1, 1, 1]);
      expect(row.attachTo, f).toEqual(catalogField(f, 'attachTo'));
      expect(row.interactive, f).toEqual(catalogField(f, 'interactive'));
    }
  });

  it('C1: variant trước đây null/sai nay có mô hình hợp (không còn null nào)', () => {
    // D: đèn tường / bình gốm / ghế đôn nay là mẫu AppFront thật.
    expect(VARIANT_MODEL.sconce).toEqual({ folder: 'wall-sconce', liftMm: 1800 });
    expect(VARIANT_MODEL.vase).toEqual({ folder: 'ceramic-vase' });
    expect(VARIANT_MODEL.planter).toEqual({ folder: 'bush' });
    expect(VARIANT_MODEL.bamboo).toEqual({ folder: 'indoor-plant' });
    expect(VARIANT_MODEL.bench).toEqual({ folder: 'ottoman' });
    expect(Object.values(VARIANT_MODEL)).not.toContain(null);
    for (const f of ['cactus', 'books', 'tv-stand', 'lounge-chair', 'shelf']) expect(CATALOG_MODELS[f], f).toBeDefined();
  });

  it('dòng AppFront (D): model.glb + thumbnail.webp ở assets/appfront-items, có giấy phép, cỡ hợp lý, offset/rotation 0', () => {
    const licenses = readFileSync(resolve(ROOT, 'assets/appfront-items/LICENSES.md'), 'utf8');
    for (const [f, row] of Object.entries(APPFRONT_MODELS)) {
      expect(row.folder).toBe(f);
      for (const file of ['model.glb', 'thumbnail.webp'])
        expect(existsSync(resolve(ROOT, 'assets/appfront-items', f, file)), `${f}/${file}`).toBe(true);
      expect(licenses, f).toContain(f);
      expect(row.dimensions.every((v) => v > 0.01 && v <= 2.5), f).toBe(true);
      expect(row.offset).toEqual([0, 0, 0]);
      expect(row.rotation).toEqual([0, 0, 0]);
    }
    expect(CATALOG_MODELS['wall-sconce']?.attachTo).toBe('wall-side');
    // Đèn tường phát sáng: lampInteractiveOf đọc khối interactive của dòng AppFront, bật sẵn.
    const lamp = lampInteractiveOf('wall-sconce') as { controls: { kind: string; default?: unknown }[]; effects: { kind: string }[] };
    expect(lamp.controls.find((c) => c.kind === 'toggle')?.default).toBe(true);
    expect(lamp.effects.map((e) => e.kind)).toEqual(['light']);
    expect(CATALOG_MODELS['fancy-picture-frame']?.attachTo).toBe('wall-side');
  });

  it('modelSrcOf / thumbnailOf', () => {
    expect(modelSrcOf('sofa')).toBe('/items/sofa/model.glb');
    expect(thumbnailOf('sofa')).toBe('/items/sofa/thumbnail.webp');
  });

  it('?drape=uv: rèm/gối/chăn trỏ sang thư mục -uv; không cờ thì y như cũ', () => {
    for (const f of ['curtain', 'pillow', 'throw-blanket']) {
      expect(modelSrcOf(f)).toBe(`/items/${f}/model.glb`);
      expect(CATALOG_MODELS[`${f}-uv`]?.dimensions).toEqual(CATALOG_MODELS[f]?.dimensions);
    }
    setDrapeFlags(['uv']);
    try {
      for (const f of ['curtain', 'pillow', 'throw-blanket']) expect(modelSrcOf(f)).toBe(`/items/${f}-uv/model.glb`);
      expect(modelSrcOf('sofa')).toBe('/items/sofa/model.glb');
    } finally {
      setDrapeFlags([]);
    }
  });

  it('mọi khe đè vật liệu (itemSlotsOf) có thật trong GLB của mô hình (slot_<khe>) hoặc mẫu realism thay nó', () => {
    const materialsOf = (folder: string): string[] => {
      const dir = folder in APPFRONT_MODELS ? 'assets/appfront-items' : 'vendor/pascal/assets/items';
      const glb = readFileSync(resolve(ROOT, dir, folder, 'model.glb'));
      const json = JSON.parse(glb.subarray(20, 20 + glb.readUInt32LE(12)).toString('utf8')) as { materials?: { name?: string }[] };
      return (json.materials ?? []).map((m) => m.name ?? '');
    };
    for (const folder of Object.keys(CATALOG_MODELS)) {
      const slots = itemSlotsOf(folder);
      if (slots === undefined) continue;
      // `kitchen` của Pascal một vật liệu không khe; khe dành cho `kitchen-sink-gen` (cờ realism).
      const swap = REALISM_MODEL_SWAP[folder];
      const names = new Set([...materialsOf(folder), ...(swap === undefined ? [] : materialsOf(swap))]);
      for (const slot of Object.keys(slots)) expect(names.has(`slot_${slot}`), `${folder} slot_${slot}`).toBe(true);
    }
  });

  it('NO_SLOT_MODELS khớp GLB thật: mẫu không có material slot_* thì có tên trong danh sách, và ngược lại', () => {
    const noSlot = Object.keys(CATALOG_MODELS).filter((folder) => {
      const dir = folder in APPFRONT_MODELS ? 'assets/appfront-items' : 'vendor/pascal/assets/items';
      const glb = readFileSync(resolve(ROOT, dir, folder, 'model.glb'));
      const json = JSON.parse(glb.subarray(20, 20 + glb.readUInt32LE(12)).toString('utf8')) as { materials?: { name?: string }[] };
      return !(json.materials ?? []).some((m) => /^slot_/i.test(m.name ?? ''));
    });
    expect(noSlot.filter((folder) => !NO_SLOT_MODELS.has(folder))).toEqual([]);
    expect(Object.keys(CATALOG_MODELS).filter((folder) => NO_SLOT_MODELS.has(folder) && !noSlot.includes(folder))).toEqual([]);
  });

  it('mẫu không có khe không phát khe phong cách, kể cả khi mẫu realism thay thư mục có khe', () => {
    expect(itemSlotsOf('closet')).toBeDefined();
    setRealismModels(true);
    expect(itemSlotsOf('closet')).toBeUndefined();
    expect(itemSlotsOf('dresser')).toBeUndefined();
    setRealismModels(false);
  });
});

describe('libraryOnlyCatalog', () => {
  const builtins = [{ id: 'sofa' }, { id: 'cabinet' }, { id: 'single-bed' }];

  it('thay mẫu đóng gói bằng mẫu máy chủ, chỉ giữ công cụ tủ bếp mô-đun', () => {
    expect(libraryOnlyCatalog(builtins, [{ id: 'sofa-grey' }]).map((item) => item.id)).toEqual(['cabinet', 'sofa-grey']);
  });

  it('không có mẫu máy chủ (lỗi/offline) → giữ nguyên danh mục đóng gói', () => {
    expect(libraryOnlyCatalog(builtins, [])).toEqual(builtins);
  });
});
