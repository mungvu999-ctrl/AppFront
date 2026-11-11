/**
 * Mẫu trang trí AppFront (FE3D-FIX-004 D): mọi thư mục có GLB + ảnh nhỏ, hộp bao GLB khớp dòng
 * APPFRONT_MODELS (đáy y = 0, tâm x/z), khe vật liệu đúng tên, và bộ sinh thủ tục cho ra đúng byte cũ.
 */
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

import { NodeIO, getBounds } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import draco3d from 'draco3dgltf';
import { describe, expect, it } from 'vitest';

import { APPFRONT_MODELS } from '../../src/lib/pascal/furnitureCatalog';
import { OUT_DIR, POLYHAVEN, PROCEDURAL, UV_FOLDERS } from '../gen-decor-models.mjs';
import { CABINETS } from '../realism-assets/cabinets.mjs';

const io = new NodeIO()
  .registerExtensions(ALL_EXTENSIONS)
  .registerDependencies({ 'draco3d.decoder': await draco3d.createDecoderModule() });

const SLOTS = {
  curtain: ['slot_fabric', 'slot_metal'],
  pillow: ['slot_fabric'],
  'throw-blanket': ['slot_fabric'],
  'wall-sconce': ['slot_metal', 'slot_shade'],
};

describe('gen-decor-models', () => {
  // scripts/realism-assets/{plants,carpet}.mjs chạy ngay khi nhập → liệt kê tay.
  const REALISM_ASSETS = ['plant-ph', 'planter-ph', 'rug-nf', 'wardrobe-sf', 'fridge-sf', 'toilet-sf', 'vanity-sf', 'dining-table-sf', 'dresser-sf', 'tv-sf', 'bed-sf', 'shower-sf', 'hood-sf', 'stove-sf', 'hob-sf', 'coffee-table-sf', 'planter-long'];
  const folders = [
    ...Object.keys(PROCEDURAL),
    ...Object.values(POLYHAVEN).map((p) => p.folder),
    ...REALISM_ASSETS,
    ...Object.keys(CABINETS),
    ...UV_FOLDERS.map((f) => `${f}-uv`),
  ];

  it('mỗi mẫu sinh ra / chuyển đổi đều có dòng catalog AppFront và ngược lại', () => {
    expect(folders.sort()).toEqual(Object.keys(APPFRONT_MODELS).sort());
  });

  it.each(folders)('%s: hộp bao GLB = dimensions của catalog (±5 mm), đáy y = 0, tâm x/z', async (folder) => {
    const doc = await io.read(join(OUT_DIR, folder, 'model.glb'));
    const { min, max } = getBounds(doc.getRoot().listScenes()[0]);
    const size = max.map((v, i) => v - min[i]);
    const dims = APPFRONT_MODELS[folder].dimensions;
    size.forEach((v, i) => expect(Math.abs(v - dims[i]), `${folder} trục ${i}`).toBeLessThan(0.005));
    expect(Math.abs(min[1])).toBeLessThan(0.002);
    expect(Math.abs(min[0] + max[0])).toBeLessThan(0.004);
    expect(Math.abs(min[2] + max[2])).toBeLessThan(0.004);
    const thumb = readFileSync(join(OUT_DIR, folder, 'thumbnail.webp'));
    expect(thumb.subarray(8, 12).toString()).toBe('WEBP');
    const slots = SLOTS[folder] ?? SLOTS[folder.replace(/-uv$/, '')];
    if (slots) expect(doc.getRoot().listMaterials().map((m) => m.getName()).sort()).toEqual(slots);
  });

  // CSP (connect-src không có blob:): ảnh nhúng trong GLB bị GLTFLoader biến thành blob: URL rồi fetch -> vi phạm.
  // Ảnh phải là tệp cạnh model.glb (uri tương đối), BIN chỉ còn hình học (không byte mồ côi).
  it.each(readdirSync(OUT_DIR).filter((f) => existsSync(join(OUT_DIR, f, 'model.glb'))))(
    '%s: ảnh GLB là uri tương đối tới tệp có thật, không bufferView, BIN gọn',
    (folder) => {
      const glb = readFileSync(join(OUT_DIR, folder, 'model.glb'));
      const json = JSON.parse(glb.subarray(20, 20 + glb.readUInt32LE(12)).toString('utf8'));
      for (const img of json.images ?? []) {
        expect(img.bufferView, `${folder}/${img.name}`).toBeUndefined();
        expect(img.uri).toMatch(/^[\w.-]+\.webp$/u);
        expect(existsSync(join(OUT_DIR, folder, img.uri)), `${folder}/${img.uri}`).toBe(true);
      }
      const used = (json.bufferViews ?? []).reduce((n, v) => n + v.byteLength, 0);
      expect(json.buffers?.[0]?.byteLength ?? 0).toBeLessThanOrEqual(used + 3 * (json.bufferViews?.length ?? 0));
    },
  );

  // Gói 4B: swap giữ node.slots của thư mục Pascal → mẫu mới phải có mọi khe của mẫu Pascal (+ slot_handle),
  // có UV (vân gỗ/đá của phong cách), ≤ 3k tam giác, hộp = hộp Pascal (±5 %) để kéo giãn không méo.
  it.each(Object.entries(CABINETS))('%s: khe ⊇ khe Pascal, có UV, ≤ 3k tam giác, hộp ≈ hộp Pascal', async (folder, { pascal }) => {
    const doc = await io.read(join(OUT_DIR, folder, 'model.glb'));
    const old = await io.read(join(OUT_DIR, '../../vendor/pascal/assets/items', pascal, 'model.glb'));
    const names = (d) => d.getRoot().listMaterials().map((m) => m.getName());
    expect(names(doc)).toEqual(expect.arrayContaining(names(old)));
    expect(names(doc).every((n) => n.startsWith('slot_'))).toBe(true);
    const prims = doc.getRoot().listMeshes().flatMap((m) => m.listPrimitives());
    for (const p of prims) expect(p.getAttribute('TEXCOORD_0'), folder).not.toBeNull();
    expect(prims.reduce((n, p) => n + p.getIndices().getCount() / 3, 0)).toBeLessThanOrEqual(3000);
    const sizeOf = (d) => {
      const { min, max } = getBounds(d.getRoot().listScenes()[0]);
      return max.map((v, i) => v - min[i]);
    };
    const want = sizeOf(old);
    sizeOf(doc).forEach((v, i) => expect(Math.abs(v / want[i] - 1), `${folder} trục ${i}`).toBeLessThan(0.05));
  });
});
