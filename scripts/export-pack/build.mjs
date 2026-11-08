/**
 * Sinh gói vật liệu/mẫu cho bộ xuất mô hình (M1-01, HOP-DONG-M1 §8).
 *   pnpm export-pack -- --out <dir> --version <v>
 * TS (danh mục vật liệu, bảng mẫu) nhập qua `ssrLoadModule` của Vite (có sẵn, alias `@/` theo vite.config).
 */
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';

import { NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import { dequantize } from '@gltf-transform/functions';
import draco3d from 'draco3dgltf';
import { MeshoptDecoder } from 'meshoptimizer';
import sharp from 'sharp';
import { createServer } from 'vite';

import { sourceFor } from '../pascal-material-webp.mjs';
import { OUT_MARKER, buildDefaults, collectRefs, decodeKtx2, missingRefs, parseConstString, parseStringRecord, resolveFinishes, sourceOfMap, unsafeOutReason } from './lib.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const ASSETS = join(ROOT, 'vendor', 'pascal', 'assets');
const { values } = parseArgs({ args: process.argv.slice(2).filter((a) => a !== '--'), options: { out: { type: 'string' }, version: { type: 'string' } }, strict: false });
if (!values.out || !values.version) throw new Error('Cần --out <dir> --version <v>');
const OUT = resolve(values.out);
const unsafe = unsafeOutReason(values.out, ROOT, { exists: existsSync, readdir: readdirSync });
if (unsafe) throw new Error(`Không xoá ${OUT}: ${unsafe}`);
rmSync(OUT, { recursive: true, force: true });
mkdirSync(join(OUT, 'textures'), { recursive: true });
writeFileSync(join(OUT, OUT_MARKER), 'export-pack\n');
mkdirSync(join(OUT, 'models'), { recursive: true });

const vite = await createServer({ root: ROOT, server: { middlewareMode: true, hmr: false, watch: null }, appType: 'custom', logLevel: 'error' });
const load = (p) => vite.ssrLoadModule(p);
const { MATERIAL_CATALOG } = await load('/vendor/pascal/packages/core/src/material-library.ts');
const { SCENE_MATERIALS } = await load('/src/lib/pascal/sceneDressing.ts');
const { SCENE_STYLE_MATERIALS, DEFAULT_SCENE_STYLE, SCENE_STYLES, sceneStyleOf } = await load('/src/lib/pascal/sceneStyles.ts');
const { VENDOR_MODELS, APPFRONT_MODELS, VARIANT_MODEL } = await load('/src/lib/pascal/furnitureCatalog.ts');
const { CEILING_DEFAULT, RAILING_GLASS_REF } = await load('/src/lib/pascal/sceneDressing.ts');
const { modelFolderOf } = await load('/src/lib/pascal/sceneVariety.ts');
const { FURNITURE_VARIANTS } = await load('/src/domain/spatial/types.ts');

const missing = [];
/** Map chỉ có KTX2 trong vendor (không ảnh gốc): giải nén bằng bộ Basis của three — đúng ảnh editor hiển thị (512 px). */
const decodedFromKtx2 = [];
const hex = (c) => (typeof c === 'string' && /^#[0-9a-f]{6}$/i.test(c) ? c.toLowerCase() : '#ffffff');

// ── vật liệu ──
const ROLES = { albedoMap: ['base', 'jpg'], normalMap: ['normal', 'png'], roughnessMap: ['rough', 'png'] };
const materials = {};
for (const item of MATERIAL_CATALOG) {
  const p = item.preset ?? {};
  const mp = p.mapProperties ?? p.properties ?? {};
  const entry = {
    label: item.label,
    color: hex(mp.color ?? item.previewColor),
    roughness: mp.roughness ?? 0.5,
    metalness: mp.metalness ?? 0,
    repeatX: mp.repeatX ?? 1,
    maps: {},
    hasTexture: false,
  };
  const wanted = Object.entries(ROLES).filter(([k]) => p.maps?.[k]);
  entry.hasTexture = wanted.length > 0;
  for (const [key, [role, ext]] of wanted) {
    const src = sourceOfMap(ASSETS, p.maps[key], sourceFor, existsSync);
    const ktx2 = join(ASSETS, p.maps[key]);
    const decoded = !src && /\.ktx2$/.test(p.maps[key]) && existsSync(ktx2) ? await decodeKtx2(ktx2, sharp) : null;
    if (!src && !decoded) {
      missing.push(`material:${item.id}:${role} (${p.maps[key]})`);
      continue;
    }
    if (decoded) decodedFromKtx2.push(`material:${item.id}:${role} (${p.maps[key]})`);
    const file = `textures/${item.id}_${role}.${ext}`;
    const img = (decoded ?? sharp(src)).resize({ width: 1024, height: 1024, fit: 'inside', withoutEnlargement: true });
    await (ext === 'jpg' ? img.jpeg({ quality: 88 }) : img.png({ compressionLevel: 9 })).toFile(join(OUT, file));
    entry.maps[role] = file;
  }
  materials[item.id] = entry;
}
writeFileSync(join(OUT, 'materials.json'), JSON.stringify(materials, null, 1));

const sceneMaterials = {};
for (const m of [...SCENE_MATERIALS, ...SCENE_STYLE_MATERIALS]) {
  const pr = m.material.properties;
  sceneMaterials[m.id] = {
    label: m.name,
    color: hex(pr.color),
    roughness: pr.roughness ?? 0.5,
    metalness: pr.metalness ?? 0,
    repeatX: 1,
    opacity: pr.opacity ?? 1,
    transparent: !!pr.transparent,
    maps: {},
    hasTexture: false,
  };
}
// A1: Room.finish -> sàn của phong cách mặc định (sceneDressing.floorMaterialOf: style.floor[finish]).
const fin = resolveFinishes(sceneStyleOf(DEFAULT_SCENE_STYLE).floor, materials, sceneMaterials);
Object.assign(sceneMaterials, fin.out);
missing.push(...fin.missing);
writeFileSync(join(OUT, 'scene-materials.json'), JSON.stringify(sceneMaterials, null, 1));

// ── mẫu đồ ──
const licenseRows = new Map();
const lic = readFileSync(join(ROOT, 'assets', 'appfront-items', 'LICENSES.md'), 'utf8');
for (const line of lic.split('\n')) {
  const cells = line.split('|').map((s) => s.trim());
  if (cells.length < 5 || cells[1] === 'Folder' || /^-+$/.test(cells[1])) continue;
  for (const f of cells[1].split(',').map((s) => s.trim())) licenseRows.set(f, { source: cells[2], license: cells[3] });
}
const authorOf = (src) => {
  const by = / by ([^(]+?) \(/.exec(src)?.[1];
  if (by) return by.trim();
  return /polyhaven/i.test(src) ? 'Poly Haven' : /procedural|project code|AppFront/i.test(src) ? 'AppFront' : 'Pascal';
};

const dracoDec = await draco3d.createDecoderModule();
await MeshoptDecoder.ready;
const io = new NodeIO().registerExtensions(ALL_EXTENSIONS).registerDependencies({ 'meshopt.decoder': MeshoptDecoder, 'draco3d.decoder': dracoDec });

const folders = [...new Set([...Object.keys(VENDOR_MODELS), ...Object.keys(APPFRONT_MODELS)])];
const models = {};
for (const id of folders) {
  const src = [join(ROOT, 'assets', 'appfront-items', id, 'model.glb'), join(ASSETS, 'items', id, 'model.glb')].find(existsSync);
  if (!src) {
    missing.push(`model:${id}`);
    continue;
  }
  const doc = await io.read(src);
  const root = doc.getRoot();
  root.listExtensionsUsed().filter((e) => ['EXT_meshopt_compression', 'KHR_draco_mesh_compression'].includes(e.extensionName)).forEach((e) => e.dispose());
  await doc.transform(dequantize());
  root.listExtensionsUsed().filter((e) => e.extensionName === 'KHR_mesh_quantization').forEach((e) => e.dispose());
  for (const tex of root.listTextures()) {
    if (tex.getMimeType() !== 'image/webp') continue;
    const s = sharp(Buffer.from(tex.getImage()));
    const png = (await s.metadata()).hasAlpha;
    const buf = await (png ? s.png() : s.jpeg({ quality: 90 })).toBuffer();
    tex.setImage(new Uint8Array(buf)).setMimeType(png ? 'image/png' : 'image/jpeg');
  }
  root.listExtensionsUsed().filter((e) => e.extensionName === 'EXT_texture_webp').forEach((e) => e.dispose());
  await io.write(join(OUT, 'models', `${id}.glb`), doc);
  const m = (VENDOR_MODELS[id] ?? APPFRONT_MODELS[id]).dimensions;
  // Mẫu của assets/appfront-items phải có dòng trong LICENSES.md: thiếu thì ghi vào `missing`, không đoán giấy phép.
  const fromAppFront = src.includes('appfront-items');
  if (fromAppFront && !licenseRows.has(id)) missing.push(`licence:${id} (thiếu dòng trong assets/appfront-items/LICENSES.md)`);
  const l =
    licenseRows.get(id) ??
    (fromAppFront
      ? { source: 'AppFront', license: 'chưa rõ' }
      : { source: 'https://github.com/pascalorg/editor (vendor/pascal/NGUON.md)', license: 'MIT (Pascal)' });
  models[id] = {
    file: `models/${id}.glb`,
    license: l.license,
    author: authorOf(l.source),
    source: l.source,
    sizeMm: { w: Math.round(m[0] * 1000), d: Math.round(m[2] * 1000), h: Math.round(m[1] * 1000) },
  };
}
writeFileSync(join(OUT, 'models.json'), JSON.stringify(models, null, 1));

// ── mặc định chọn mẫu: đúng hàm toPascal dùng (modelFolderOf + VARIANT_MODEL) ──
const style = sceneStyleOf(DEFAULT_SCENE_STYLE);
const box = (w, d) => ({ min: { x: 0, y: 0 }, max: { x: w, y: d } });
const KIND_PROBE = {
  table: [1200, 800],
  chair: [450, 450],
  bed: [1600, 2000],
  wardrobe: [1200, 600],
  kitchenCabinet: [600, 600],
  sanitaryFixture: [400, 700],
  washingMachine: [600, 600],
  shower: [900, 900],
  stair: [1000, 2500],
  other: [600, 600],
};
const defaults = buildDefaults(Object.keys(KIND_PROBE), FURNITURE_VARIANTS, VARIANT_MODEL, (kind) =>
  modelFolderOf({ id: 'probe', kind, boundingBox: box(...KIND_PROBE[kind]), rotationDeg: 0 }, style, undefined),
);
for (const [k, f] of Object.entries(defaults)) if (!models[f]) missing.push(`default:${k}->${f}`);
writeFileSync(join(OUT, 'furniture-defaults.json'), JSON.stringify(defaults, null, 1));

// ── editor-defaults.json: luật mặc định khi document không có ref (A1) ──
const dressingSrc = readFileSync(join(ROOT, 'src/lib/pascal/sceneDressing.ts'), 'utf8');
const toPascalSrc = readFileSync(join(ROOT, 'src/lib/pascal/toPascal.ts'), 'utf8');
const usageFinish = parseStringRecord(dressingSrc, 'USAGE_FINISH'); // sceneDressing.ts:101, không export
const windowSlots = parseStringRecord(toPascalSrc, 'WINDOW_SLOTS'); // toPascal.ts:468
const stairSide = parseConstString(toPascalSrc, 'STAIR_SIDE_MATERIAL'); // toPascal.ts:688
if (!usageFinish || !windowSlots || !stairSide) missing.push('editor-defaults:không đọc được USAGE_FINISH/WINDOW_SLOTS/STAIR_SIDE_MATERIAL');
const styles = {};
for (const [id, st] of Object.entries(SCENE_STYLES)) {
  // wallDressingOf: tường thấp/kính = RAILING_GLASS_REF; vách ngăn sơn trong cả hai mặt; tường khác trong/ngoài.
  styles[id] = { floor: st.floor, wall: st.wall, partition: st.wall.interior, ceiling: CEILING_DEFAULT, glassWall: RAILING_GLASS_REF, families: st.families, stairTread: st.floor.wood };
}
const editorDefaults = { defaultStyle: DEFAULT_SCENE_STYLE, usageFinish, outdoorFinishNoCeiling: 'decking', window: windowSlots, stairSide, styles };
missing.push(...missingRefs(collectRefs(editorDefaults), materials, sceneMaterials));
writeFileSync(join(OUT, 'editor-defaults.json'), JSON.stringify(editorDefaults, null, 1));

// ── giấy phép + manifest ──
const rows = Object.entries(models).map(([id, m]) => `| ${id} | ${m.author} | ${m.license} | ${m.source} |`);
// MIT bắt buộc kèm thông báo bản quyền: chép nguyên LICENSE của Pascal vào gói.
writeFileSync(join(OUT, 'LICENSE-PASCAL-MIT.txt'), readFileSync(join(ROOT, 'vendor', 'pascal', 'LICENSE')));
writeFileSync(
  join(OUT, 'LICENSES.md'),
  `# Giấy phép mẫu đồ trong gói ${values.version}\n\nVật liệu: ảnh từ vendor/pascal/assets/material (Pascal, MIT). Toàn văn giấy phép MIT của Pascal: LICENSE-PASCAL-MIT.txt.\n\n| Mẫu | Tác giả | Giấy phép | Nguồn |\n|---|---|---|---|\n${rows.join('\n')}\n`,
);

const files = {};
const walk = (d) =>
  readdirSync(d).forEach((n) => {
    const p = join(d, n);
    if (p === join(OUT, OUT_MARKER)) return;
    if (statSync(p).isDirectory()) return walk(p);
    files[relative(OUT, p).replaceAll('\\', '/')] = createHash('sha256').update(readFileSync(p)).digest('hex');
  });
walk(OUT);
const manifest = {
  version: values.version,
  createdAt: new Date().toISOString(),
  sources: ['vendor/pascal material-library.ts', 'src/lib/pascal sceneDressing/sceneStyles/furnitureCatalog', 'assets/appfront-items', 'vendor/pascal/assets/items'],
  files,
  missing,
  decodedFromKtx2,
};
writeFileSync(join(OUT, 'manifest.json'), JSON.stringify(manifest, null, 1));
await vite.close();

const total = Object.keys(files).reduce((s, f) => s + statSync(join(OUT, f)).size, 0);
const withTex = Object.values(materials).filter((m) => m.hasTexture);
console.log(
  JSON.stringify({
    materials: Object.keys(materials).length,
    withTexture: withTex.length,
    withAnyImage: withTex.filter((m) => Object.keys(m.maps).length > 0).length,
    sceneMaterials: Object.keys(sceneMaterials).length,
    models: Object.keys(models).length,
    defaults: Object.keys(defaults).length,
    missing: missing.length,
    decodedFromKtx2: decodedFromKtx2.length,
    MB: +(total / 1048576).toFixed(1),
  }),
);
if (missing.length) console.log('missing:\n  ' + missing.slice(0, 40).join('\n  '));
