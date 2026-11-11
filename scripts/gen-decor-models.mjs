/**
 * Decor models of AppFront (FE3D-FIX-004 card D) -> `assets/appfront-items/<folder>/`.
 * `copy-pascal-assets.mjs` copies that dir next to the vendor items (`/pascal/items/<folder>/`).
 *
 *   node scripts/gen-decor-models.mjs                       procedural: curtain, pillow, throw-blanket, wall-sconce
 *   node scripts/gen-decor-models.mjs --polyhaven <dir>     convert the CC0 Poly Haven glTFs in <dir>/<id>/<id>_1k.gltf (or `file`)
 *        [--glb <dir2>] [--only id,id]                    entries with `glb` read <dir2>/<glb> (homepage-audit public/models)
 *
 * Convention (same as vendor items): metres, x/z centred, base at y = 0, front faces +z.
 * Material names are `slot_<slot>` so `sceneDressing.ts` SLOT_FAMILY can recolour them per style.
 * Output is deterministic (no timestamps; fixed generator string).
 */
import { Buffer } from 'node:buffer';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

import { Document, Format, NodeIO, getBounds } from '@gltf-transform/core';
import { ALL_EXTENSIONS, KHRDracoMeshCompression } from '@gltf-transform/extensions';
import { center, dedup, draco, prune, simplify, textureCompress, weld } from '@gltf-transform/functions';
import draco3d from 'draco3dgltf';
import { MeshoptSimplifier } from 'meshoptimizer';
import sharp from 'sharp';

export const OUT_DIR = join(dirname(fileURLToPath(import.meta.url)), '..', 'assets', 'appfront-items');

export const ioOf = async () =>
  new NodeIO().registerExtensions(ALL_EXTENSIONS).registerDependencies({
    'draco3d.decoder': await draco3d.createDecoderModule(),
    'draco3d.encoder': await draco3d.createEncoderModule(),
  });

// ---------- geometry helpers: parts are { pos: number[], idx: number[] } ----------

/** Grid surface f(u, v) in [0,1]^2 -> [x,y,z]; `flip` reverses winding (back faces). */
const grid = (nu, nv, f, flip = false) => {
  const pos = [];
  const idx = [];
  for (let j = 0; j <= nv; j++) for (let i = 0; i <= nu; i++) pos.push(...f(i / nu, j / nv));
  for (let j = 0; j < nv; j++)
    for (let i = 0; i < nu; i++) {
      const a = j * (nu + 1) + i;
      const b = a + 1;
      const c = a + nu + 1;
      const d = c + 1;
      if (flip) idx.push(a, b, c, b, d, c);
      else idx.push(a, c, b, b, c, d);
    }
  return { pos, idx };
};

export const merge = (...parts) => {
  const pos = [];
  const idx = [];
  for (const p of parts) {
    const base = pos.length / 3;
    pos.push(...p.pos);
    idx.push(...p.idx.map((i) => i + base));
  }
  return { pos, idx };
};

/** Smooth vertex normals (area weighted). */
export const normalsOf = ({ pos, idx }) => {
  const n = new Float32Array(pos.length);
  for (let t = 0; t < idx.length; t += 3) {
    const [a, b, c] = [idx[t] * 3, idx[t + 1] * 3, idx[t + 2] * 3];
    const e1 = [pos[b] - pos[a], pos[b + 1] - pos[a + 1], pos[b + 2] - pos[a + 2]];
    const e2 = [pos[c] - pos[a], pos[c + 1] - pos[a + 1], pos[c + 2] - pos[a + 2]];
    const fn = [e1[1] * e2[2] - e1[2] * e2[1], e1[2] * e2[0] - e1[0] * e2[2], e1[0] * e2[1] - e1[1] * e2[0]];
    for (const v of [a, b, c]) for (let k = 0; k < 3; k++) n[v + k] += fn[k];
  }
  for (let v = 0; v < n.length; v += 3) {
    const l = Math.hypot(n[v], n[v + 1], n[v + 2]) || 1;
    for (let k = 0; k < 3; k++) n[v + k] /= l;
  }
  return n;
};

/**
 * Superellipsoid (rounded box) of half sizes hx,hy,hz centred at c; e < 1 = boxier.
 * flip: (u = longitude, v = latitude) winds inward, which rendered pillows/throws inside-out (review2).
 */
const roundedBox = (hx, hy, hz, c, e, bend = () => 0) =>
  grid(
    32,
    20,
    (u, v) => {
    const th = u * 2 * Math.PI;
    const ph = (v - 0.5) * Math.PI;
    const s = (x) => Math.sign(x) * Math.abs(x) ** e;
    const x = hx * s(Math.cos(ph)) * s(Math.cos(th));
    const y = hy * s(Math.sin(ph));
    const z = hz * s(Math.cos(ph)) * s(Math.sin(th));
    return [c[0] + x, c[1] + y + bend(x), c[2] - z];
    },
    true,
  );

/** Cylinder along axis 'x' or 'z', radius r, from a to b, centre (p, q) on the other two axes. */
const cylinder = (axis, r, a, b, p, q, caps = true) => {
  const at = (t, ang, rr = r) =>
    axis === 'x'
      ? [a + (b - a) * t, p + rr * Math.cos(ang), q + rr * Math.sin(ang)]
      : [p + rr * Math.cos(ang), q + rr * Math.sin(ang), a + (b - a) * t];
  const side = grid(16, 1, (u, v) => at(v, -u * 2 * Math.PI), axis === 'z');
  if (!caps) return side;
  const cap = (t, flip) => grid(16, 1, (u, v) => at(t, -u * 2 * Math.PI, r * (1 - v)), flip);
  return merge(side, cap(0, axis !== 'z'), cap(1, axis === 'z'));
};

/** Open truncated cone around +y axis at (cx, cz), both faces (shade seen from inside too). */
const cone = (r0, r1, y0, y1, cx, cz) => {
  const f = (u, v) => {
    const r = r0 + (r1 - r0) * v;
    const ang = u * 2 * Math.PI;
    return [cx + r * Math.cos(ang), y0 + (y1 - y0) * v, cz - r * Math.sin(ang)];
  };
  return merge(grid(24, 1, f), grid(24, 1, f, true));
};

export const box = (x0, x1, y0, y1, z0, z1) => {
  const p = [
    [x0, y0, z0], [x1, y0, z0], [x1, y1, z0], [x0, y1, z0],
    [x0, y0, z1], [x1, y0, z1], [x1, y1, z1], [x0, y1, z1],
  ];
  // flat faces: 4 verts per face so normals stay hard
  const faces = [
    [4, 5, 6, 7], [1, 0, 3, 2], [5, 1, 2, 6], [0, 4, 7, 3], [7, 6, 2, 3], [0, 1, 5, 4],
  ];
  return merge(...faces.map((f) => ({ pos: f.flatMap((i) => p[i]), idx: [0, 1, 2, 0, 2, 3] })));
};

// ---------- procedural models ----------

const CURTAIN = { w: 0.7, top: 2.26, bottom: 0.02, pleats: 5, t: 0.006 };

/** One drawn-open curtain panel (pleated, double sheet) + a rod stub; panel pair = two of these. */
const curtainParts = () => {
  const { w, top, bottom, pleats, t } = CURTAIN;
  const z = (u, v) => (0.03 + 0.015 * (1 - v)) * Math.sin(u * pleats * 2 * Math.PI);
  const at = (u, v, side) => [(u - 0.5) * w, bottom + (top - bottom) * v, z(u, v) + side * t];
  const front = grid(60, 12, (u, v) => at(u, v, 1));
  const back = grid(60, 12, (u, v) => at(u, v, -1), true);
  const edge = (u, flip) => grid(1, 12, (s, v) => at(u, v, s * 2 - 1), flip);
  const hem = (v, flip) => grid(60, 1, (u, s) => at(u, v, s * 2 - 1), flip);
  // UV (uv run): u = arc length along the pleat at that height, v = y -> texels follow the folds, 1 UV unit = 1 m.
  const arc = (x, y) => {
    const v = (y - bottom) / (top - bottom);
    const u1 = Math.min(1, Math.max(0, x / w + 0.5));
    const n = Math.max(1, Math.round(u1 * 120));
    let len = 0;
    for (let k = 1; k <= n; k++) len += Math.hypot(w * u1 / n, z((u1 * k) / n, v) - z((u1 * (k - 1)) / n, v));
    return len;
  };
  return {
    fabric: merge(front, back, edge(0, false), edge(1, true), hem(0, true), hem(1, false)),
    uv: { fabric: (x, y) => [arc(x, y), y] },
    metal: cylinder('x', 0.012, -w / 2 - 0.05, w / 2 + 0.05, top + 0.02, 0),
  };
};

const pillowParts = () => ({ fabric: roundedBox(0.225, 0.225, 0.075, [0, 0.225, 0], 0.35), uv: { fabric: (x, y) => [x, y] } });

/** Folded throw: flat-ish slab 1.2 x 0.05 x 0.5, ends sag 2 cm (draped). */
const throwParts = () => ({
  fabric: roundedBox(0.6, 0.02, 0.25, [0, 0.03, 0], 0.15, (x) => -0.02 * (x / 0.6) ** 2 + 0.0),
  uv: { fabric: (x, _y, z) => [x, z] },
});

/** Wall sconce: back plate on the wall (-z), short arm, fabric shade. Light source sits in the shade. */
const sconceParts = () => ({
  metal: merge(box(-0.05, 0.05, 0.07, 0.23, -0.075, -0.06), cylinder('z', 0.008, -0.06, 0.0, 0.0, 0.17, false)),
  shade: cone(0.075, 0.055, 0.12, 0.3, 0, 0),
});

export const PROCEDURAL = {
  curtain: { parts: curtainParts, label: 'Curtain' },
  pillow: { parts: pillowParts, label: 'Pillow' },
  'throw-blanket': { parts: throwParts, label: 'Throw' },
  'wall-sconce': { parts: sconceParts, label: 'Sconce' },
};

/** Base colours only matter when no style slot overrides them. */
const BASE_COLOUR = { fabric: [0.78, 0.74, 0.68, 1], metal: [0.35, 0.33, 0.3, 1], shade: [0.93, 0.9, 0.84, 1] };

/** `uv` run: same models + TEXCOORD_0 in metres (planar per part, curtain along the pleats) -> `<folder>-uv`. */
export const UV_FOLDERS = ['curtain', 'pillow', 'throw-blanket'];

const docOf = ({ uv, ...parts }, withUv = false) => {
  const doc = new Document();
  doc.getRoot().getAsset().generator = 'AppFront gen-decor-models';
  const buffer = doc.createBuffer();
  const mesh = doc.createMesh('decor');
  for (const [slot, part] of Object.entries(parts)) {
    const material = doc
      .createMaterial(`slot_${slot}`)
      .setBaseColorFactor(BASE_COLOUR[slot] ?? [0.8, 0.8, 0.8, 1])
      .setRoughnessFactor(slot === 'metal' ? 0.4 : 0.9)
      .setMetallicFactor(slot === 'metal' ? 0.8 : 0);
    const round = (a) => Float32Array.from(a, (x) => Math.round(x * 1e5) / 1e5);
    const prim = doc
      .createPrimitive()
      .setAttribute('POSITION', doc.createAccessor().setType('VEC3').setArray(round(part.pos)).setBuffer(buffer))
      .setAttribute('NORMAL', doc.createAccessor().setType('VEC3').setArray(normalsOf(part)).setBuffer(buffer))
      .setIndices(doc.createAccessor().setType('SCALAR').setArray(Uint32Array.from(part.idx)).setBuffer(buffer))
      .setMaterial(material);
    const uvOf = withUv ? uv?.[slot] : undefined;
    if (uvOf) {
      const t = [];
      for (let i = 0; i < part.pos.length; i += 3) t.push(...uvOf(part.pos[i], part.pos[i + 1], part.pos[i + 2]));
      prim.setAttribute('TEXCOORD_0', doc.createAccessor().setType('VEC2').setArray(round(t)).setBuffer(buffer));
    }
    mesh.addPrimitive(prim);
  }
  const node = doc.createNode('decor').setMesh(mesh);
  doc.createScene('Scene').addChild(node);
  doc.getRoot().setDefaultScene(doc.getRoot().listScenes()[0]);
  return doc;
};

/** 256 px neutral icon thumbnail with the item name (no renderer in node). */
export const thumbnailOf = (label) =>
  sharp(
    Buffer.from(
      `<svg xmlns="http://www.w3.org/2000/svg" width="256" height="256"><rect width="256" height="256" rx="24" fill="#efebe4"/>` +
        `<circle cx="128" cy="104" r="52" fill="#d8cfc2"/><text x="128" y="206" font-family="Arial, sans-serif" font-size="30" ` +
        `text-anchor="middle" fill="#4a4540">${label}</text></svg>`,
    ),
  )
    .webp({ quality: 80 })
    .toBuffer();

const statsOf = (doc) => {
  let tris = 0;
  for (const m of doc.getRoot().listMeshes())
    for (const p of m.listPrimitives()) tris += (p.getIndices()?.getCount() ?? p.getAttribute('POSITION').getCount()) / 3;
  const b = getBounds(doc.getRoot().listScenes()[0]);
  return { tris, size: b.max.map((v, i) => Math.round((v - b.min[i]) * 1000) / 1000), min: b.min, max: b.max };
};

/**
 * GLB whose images are sibling files (`<name>.webp` next to model.glb), not bufferViews.
 * Embedded images make GLTFLoader fetch `blob:` URLs, which nginx CSP `connect-src` forbids;
 * a relative `uri` resolves against the GLB url (`/pascal/items/<folder>/`), same origin.
 */
const glbWithExternalImages = async (io, doc, dir) => {
  for (const t of doc.getRoot().listTextures()) t.setURI(`${t.getName().replace(/\.(png|jpe?g)$/i, '')}.webp`);
  const { json, resources } = await io.writeJSON(doc, { format: Format.GLTF, basename: 'model' });
  if (json.buffers?.length !== 1) throw new Error(`expected 1 buffer, got ${json.buffers?.length}`);
  for (const img of json.images ?? []) writeFileSync(join(dir, img.uri), resources[img.uri]);
  const bin = Buffer.from(resources[json.buffers[0].uri]);
  delete json.buffers[0].uri;
  const pad = (b, fill) => Buffer.concat([b, Buffer.alloc((4 - (b.length % 4)) % 4, fill)]);
  const jsonChunk = pad(Buffer.from(JSON.stringify(json)), 0x20);
  const binChunk = pad(bin, 0);
  const head = Buffer.alloc(12);
  head.writeUInt32LE(0x46546c67, 0); // 'glTF'
  head.writeUInt32LE(2, 4);
  head.writeUInt32LE(12 + 8 + jsonChunk.length + 8 + binChunk.length, 8);
  const chunk = (data, type) => {
    const h = Buffer.alloc(8);
    h.writeUInt32LE(data.length, 0);
    h.writeUInt32LE(type, 4);
    return [h, data];
  };
  return Buffer.concat([head, ...chunk(jsonChunk, 0x4e4f534a), ...chunk(binChunk, 0x004e4942)]);
};

/** `keepAttributes`: giữ TEXCOORD_0 dù vật liệu chưa có ảnh (phong cách gắn ảnh vân sau, cabinets.mjs). */
export const writeModel = async (io, folder, doc, label, { keepAttributes = false } = {}) => {
  await doc.transform(center({ pivot: 'below' }), dedup(), prune({ keepAttributes }), draco({ method: 'edgebreaker', quantizePosition: 14 }));
  doc.createExtension(KHRDracoMeshCompression).setRequired(true);
  const dir = join(OUT_DIR, folder);
  mkdirSync(dir, { recursive: true });
  const glb = doc.getRoot().listTextures().length ? await glbWithExternalImages(io, doc, dir) : await io.writeBinary(doc);
  writeFileSync(join(dir, 'model.glb'), glb);
  writeFileSync(join(dir, 'thumbnail.webp'), await thumbnailOf(label));
  const s = statsOf(doc);
  console.log(`${folder}: ${glb.byteLength} B, ${s.tris} tris, size ${s.size.join(' x ')} m`);
};

/** Poly Haven id -> AppFront folder (CC0, see assets/appfront-items/LICENSES.md). */
export const POLYHAVEN = {
  ceramic_vase_01: { folder: 'ceramic-vase', label: 'Vase', simplify: 0.2 },
  ceramic_vase_03: { folder: 'ceramic-vase-slim', label: 'Vase', simplify: 0.2 },
  fancy_picture_frame_01: { folder: 'fancy-picture-frame', label: 'Frame' },
  Ottoman_01: { folder: 'ottoman', label: 'Ottoman' },
  // editor-realism B1: one material (wood + fabric in one atlas) -> NOT named slot_*, colour fixed per model.
  // B1b: modern light style. No light-fabric sofa on disk (sofa_03 is brown vintage) -> sofa_02 shape, atlas lightened to light grey.
  sofa_02: { folder: 'sofa-ph', label: 'Sofa', file: 'sofa_02/sofa_02_2k.gltf', lighten: ['sofa_02'] },
  // light oak legs + black cushion -> cushion lightened to light grey; 8.9k tris -> simplify.
  modern_arm_chair_01: {
    folder: 'armchair-ph',
    label: 'Armchair',
    file: 'modern_arm_chair_01/modern_arm_chair_01_2k.gltf',
    simplify: 0.3,
    lighten: ['modern_arm_chair_01_pillow'],
  },
  // review2: diffuse mean ~(42,29,21) reads almost black in the room -> linear lift to mid brown.
  dining_chair_02: { folder: 'dining-chair-ph', label: 'Chair', glb: 'dining-chair.glb', brighten: [2.2, 10] },
  // review2 goi 2A: weak Pascal boxes -> Poly Haven CC0 (light oak / light frame), one material each unless noted.
  side_table_01: { folder: 'bedside-table-ph', label: 'Side table' },
  // depth runs along x in the source; bins open both sides, so either yaw faces +z.
  wooden_display_shelves_01: { folder: 'bookshelf-ph', label: 'Shelves', rotateY: 90 },
  // glass + metal + globe materials; light sits in the globe (interactive copied from the Pascal row).
  modern_ceiling_lamp_01: { folder: 'ceiling-lamp-ph', label: 'Lamp' },
  hanging_picture_frame_02: { folder: 'picture-ph', label: 'Picture' },
};

/** Wrap the scene roots in one node turned `deg` about +y (source front not on +z). */
const yaw = (doc, deg) => {
  const scene = doc.getRoot().listScenes()[0];
  const a = (deg * Math.PI) / 360;
  const pivot = doc.createNode('yaw').setRotation([0, Math.sin(a), 0, Math.cos(a)]);
  for (const n of scene.listChildren()) pivot.addChild(n);
  scene.addChild(pivot);
};

const convertPolyHaven = async (io, src, glbDir, only) => {
  await MeshoptSimplifier.ready;
  for (const [id, { folder, label, simplify: ratio, file, glb, lighten, brighten, rotateY }] of Object.entries(POLYHAVEN)) {
    if (only && !only.includes(id)) continue;
    const doc = await io.read(glb ? join(glbDir, glb) : join(src, file ?? join(id, `${id}_1k.gltf`)));
    for (const m of doc.getRoot().listMaterials()) {
      const base = brighten && m.getBaseColorTexture();
      if (base) {
        base.setImage(await sharp(base.getImage()).linear(...brighten).jpeg().toBuffer());
        base.setMimeType('image/jpeg');
      }
      const tex = lighten?.includes(m.getName()) && m.getBaseColorTexture();
      if (!tex) continue;
      // grey -> lift into a light neutral grey; keeps the weave/seams of the original diffuse (greyscale runs last in sharp, so no tint).
      tex.setImage(await sharp(tex.getImage()).greyscale().linear(0.35, 165).jpeg().toBuffer());
      tex.setMimeType('image/jpeg');
    }
    doc.getRoot().getAsset().generator = 'AppFront gen-decor-models';
    if (rotateY) yaw(doc, rotateY);
    await doc.transform(
      weld(),
      ...(ratio ? [simplify({ simplifier: MeshoptSimplifier, ratio, error: 0.002 })] : []),
      center({ pivot: 'below' }),
      textureCompress({ encoder: sharp, targetFormat: 'webp', resize: [512, 512], quality: 80 }),
    );
    await writeModel(io, folder, doc, label);
  }
};

const main = async () => {
  const io = await ioOf();
  const at = process.argv.indexOf('--polyhaven');
  const arg = (flag) => (process.argv.includes(flag) ? process.argv[process.argv.indexOf(flag) + 1] : undefined);
  if (at > -1) return convertPolyHaven(io, process.argv[at + 1], arg('--glb'), arg('--only')?.split(','));
  const uvOnly = process.argv.includes('--uv-only');
  for (const [folder, { parts, label }] of Object.entries(PROCEDURAL)) {
    if (!uvOnly) await writeModel(io, folder, docOf(parts()), label);
    if (UV_FOLDERS.includes(folder)) await writeModel(io, `${folder}-uv`, docOf(parts(), true), label, { keepAttributes: true });
  }
};

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) await main();
