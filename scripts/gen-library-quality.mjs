/**
 * Sinh `src/lib/pascal/libraryQuality.json` (schema v1, xem `libraryQuality.ts`) theo lô cho mọi mẫu có vai.
 *
 *   node scripts/gen-library-quality.mjs [--out-dir F:/runs/m12/q]
 *
 * Nguồn: GLB gốc (tìm theo `model_sha256` của `files.json` backend), `profiles.jsonl`, `libraryRoles*.json`,
 * `libraryQc.json`, nhãn ảnh `visual-tags.jsonl` (nếu có). Đo cho cả 883 mẫu (bản đầy đủ ghi ở out-dir), bundle chỉ
 * giữ mẫu có vai (`libraryRoles.json` + đèn `libraryRoles2.json`) và ở dạng nén (giải nén trong `libraryQuality.ts`).
 *
 * `parts`: diện tích tam giác sau biến đổi node, màu = baseColorFactor × texel lấy mẫu tại 4 điểm mỗi tam giác (vùng
 * UV thực dùng) × màu đỉnh, trung bình tuyến tính theo diện tích → Lab. Vật liệu có atlas được tách cụm màu (k-means
 * trên Lab theo diện tích) nên một vật liệu có thể ra nhiều phần. `kind`/`material` là luật chung theo tên, PBR, vị trí
 * hình học, `materials` của profiles — không theo id.
 */
import { createHash } from 'node:crypto';
import { existsSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import process from 'node:process';
import { pathToFileURL } from 'node:url';

import { NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import draco3d from 'draco3dgltf';
import { MeshoptDecoder } from 'meshoptimizer';
import sharp from 'sharp';

const FE = 'src/lib/pascal';
export const SRC = {
  files: 'F:/worktrees/AppBack/m2-ql/packages/domain/library/files.json',
  profiles: 'F:/runs/library-profiles/profiles.jsonl',
  roles: `${FE}/libraryRoles.json`,
  roles2: `${FE}/libraryRoles2.json`,
  qc: `${FE}/libraryQc.json`,
  tags: 'F:/runs/m12/q/visual-tags.jsonl',
};
export const GLB_DIRS = [
  'F:/runs/library-import-3/pack4/all',
  'F:/runs/library-import-3/pack3',
  'F:/runs/library-import-3/plants',
  'F:/runs/library-import-2',
  'F:/runs/can-mau/library-import/out',
];
/** Ngưỡng mức chi tiết (dùng chung với libraryRoles2: 60k tam giác / 1 MB là trần). */
export const TIER_RULE = 'light: tris<=20000 & kb<=512; heavy: tris>60000 | kb>1024; còn lại medium';
const tierOf = (tris, kb) => (tris > 60000 || kb > 1024 ? 'heavy' : tris <= 20000 && kb <= 512 ? 'light' : 'medium');
const MIN_SHARE = 0.05;
const MAX_PARTS = 4;

// ---------- màu ----------
const LIN = Float64Array.from({ length: 256 }, (_, i) => { const c = i / 255; return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4; });
const toSrgb8 = (l) => { const c = l <= 0.0031308 ? l * 12.92 : 1.055 * l ** (1 / 2.4) - 0.055; return Math.max(0, Math.min(255, Math.round(c * 255))); };
export const linToLab = ([r, g, b]) => {
  const f = (t) => (t > 216 / 24389 ? Math.cbrt(t) : (24389 / 27 * t + 16) / 116);
  const x = f((0.4124564 * r + 0.3575761 * g + 0.1804375 * b) / 0.95047);
  const y = f(0.2126729 * r + 0.7151522 * g + 0.072175 * b);
  const z = f((0.0193339 * r + 0.119192 * g + 0.9503041 * b) / 1.08883);
  return [116 * y - 16, 500 * (x - y), 200 * (y - z)];
};
export const dE = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);

// ---------- texture ----------
const MAX_SAMPLE_PX = 1024;
/** Giải mã ảnh texture → RGBA thô (thu về ≤1024 px để lấy mẫu). KTX2 → null. */
async function decodeImage(texture) {
  const buf = texture.getImage();
  if (!buf || texture.getMimeType() === 'image/ktx2') return { ktx2: true };
  const img = sharp(Buffer.from(buf));
  const meta = await img.metadata();
  const { data, info } = await img.ensureAlpha().resize({ width: MAX_SAMPLE_PX, height: MAX_SAMPLE_PX, fit: 'inside', withoutEnlargement: true }).raw().toBuffer({ resolveWithObject: true });
  return { data, w: info.width, h: info.height, size: Math.max(meta.width ?? 0, meta.height ?? 0) };
}
const wrap = (t, mode) => {
  if (mode === 33071) return Math.min(1, Math.max(0, t));
  if (mode === 33648) { const m = ((t % 2) + 2) % 2; return m > 1 ? 2 - m : m; }
  return t - Math.floor(t);
};
/** Bộ lấy mẫu cho một textureInfo (texCoord + KHR_texture_transform + wrap). */
function samplerOf(info, img) {
  if (!info || !img || img.ktx2) return null;
  const tf = info.getExtension?.('KHR_texture_transform');
  const [ox, oy] = tf ? tf.getOffset() : [0, 0];
  const rot = tf ? tf.getRotation() : 0;
  const [sx, sy] = tf ? tf.getScale() : [1, 1];
  const cos = Math.cos(rot), sin = Math.sin(rot);
  const tc = tf?.getTexCoord?.() ?? info.getTexCoord();
  const ws = info.getWrapS(), wt = info.getWrapT();
  const { data, w, h } = img;
  return {
    tc,
    at(u0, v0, out) {
      const u = wrap(ox + cos * sx * u0 + sin * sy * v0, ws), v = wrap(oy - sin * sx * u0 + cos * sy * v0, wt);
      const i = (Math.min(h - 1, Math.floor(v * h)) * w + Math.min(w - 1, Math.floor(u * w))) * 4;
      out[0] = data[i]; out[1] = data[i + 1]; out[2] = data[i + 2]; out[3] = data[i + 3];
      return out;
    },
  };
}

// ---------- đo một Document ----------
const NB = 11; // area, r, g, b, metal, rough, alpha, y, z, up, x
const tokens = (...names) => names.filter(Boolean).join(' ').replace(/([a-z])([A-Z])/g, '$1 $2').toLowerCase().replace(/[^a-z]+/g, ' ').trim();
const transformPoint = (m, x, y, z, out) => {
  out[0] = m[0] * x + m[4] * y + m[8] * z + m[12]; out[1] = m[1] * x + m[5] * y + m[9] * z + m[13]; out[2] = m[2] * x + m[6] * y + m[10] * z + m[14];
  return out;
};
const readAttr = (acc) => { if (!acc) return null; const n = acc.getCount(), k = acc.getElementSize(), out = new Float32Array(n * k), el = []; for (let i = 0; i < n; i++) { acc.getElement(i, el); for (let j = 0; j < k; j++) out[i * k + j] = el[j]; } return { a: out, k }; };

function materialInfo(mat) {
  if (!mat) return { factor: [1, 1, 1, 1], base: null, mr: null, metal: 1, rough: 1, transmission: 0, blend: false, name: '' };
  const sg = mat.getExtension('KHR_materials_pbrSpecularGlossiness');
  const tr = mat.getExtension('KHR_materials_transmission');
  return {
    factor: sg ? sg.getDiffuseFactor() : mat.getBaseColorFactor(),
    base: sg ? [sg.getDiffuseTexture(), sg.getDiffuseTextureInfo()] : [mat.getBaseColorTexture(), mat.getBaseColorTextureInfo()],
    mr: sg ? null : [mat.getMetallicRoughnessTexture(), mat.getMetallicRoughnessTextureInfo()],
    metal: sg ? 0 : mat.getMetallicFactor(),
    rough: sg ? 1 - sg.getGlossinessFactor() : mat.getRoughnessFactor(),
    transmission: tr ? tr.getTransmissionFactor() : 0,
    blend: mat.getAlphaMode() !== 'OPAQUE',
    name: mat.getName(),
  };
}

const BARY = [[1 / 3, 1 / 3, 1 / 3], [0.6, 0.2, 0.2], [0.2, 0.6, 0.2], [0.2, 0.2, 0.6]];

/**
 * Đo hình học + màu theo diện tích. Trả về hộp bao (m), số tam giác, và các cụm màu (theo vật liệu) với đặc trưng
 * trung bình theo diện tích. `imageMean` = màu trung bình CẢ ảnh base (chỉ để so sánh, không dùng làm phần).
 */
export async function measureDocument(doc) {
  const root = doc.getRoot();
  const scene = root.getDefaultScene() ?? root.listScenes()[0];
  const items = [];
  scene?.traverse((node) => { const mesh = node.getMesh(); if (mesh) items.push({ node, mesh, m: node.getWorldMatrix() }); });
  // Lượt 1: hộp bao thế giới.
  const mn = [Infinity, Infinity, Infinity], mx = [-Infinity, -Infinity, -Infinity], p = [0, 0, 0];
  const prims = [];
  for (const it of items) for (const prim of it.mesh.listPrimitives()) {
    if (prim.getMode() !== 4) continue;
    const pos = readAttr(prim.getAttribute('POSITION'));
    if (!pos) continue;
    for (let i = 0; i < pos.a.length; i += 3) { transformPoint(it.m, pos.a[i], pos.a[i + 1], pos.a[i + 2], p); for (let k = 0; k < 3; k++) { if (p[k] < mn[k]) mn[k] = p[k]; if (p[k] > mx[k]) mx[k] = p[k]; } }
    prims.push({ ...it, prim, pos });
  }
  const size = mn[0] === Infinity ? [0, 0, 0] : mx.map((v, k) => v - mn[k]);
  const H = size[1] || 1, D = size[2] || 1, W = size[0] || 1;
  // Lượt 2: diện tích, màu, đặc trưng theo ngăn màu (vật liệu × sRGB 5 bit).
  const imgCache = new Map();
  const img = async (tex) => { if (!tex) return null; if (!imgCache.has(tex)) imgCache.set(tex, await decodeImage(tex)); return imgCache.get(tex); };
  const mats = new Map(); // material → { info, names:Set, bins:Map }
  let tris = 0, ktx2 = false, totalArea = 0;
  const a = [0, 0, 0], b = [0, 0, 0], c = [0, 0, 0], tx = [0, 0, 0, 0], tm = [0, 0, 0, 0];
  for (const { node, mesh, m, prim, pos } of prims) {
    const mat = prim.getMaterial();
    let g = mats.get(mat);
    if (!g) { g = { info: materialInfo(mat), names: new Set(), bins: new Map() }; mats.set(mat, g); }
    g.names.add(mesh.getName()); g.names.add(node.getName());
    const info = g.info;
    const baseImg = await img(info.base?.[0]), mrImg = await img(info.mr?.[0]);
    if (baseImg?.ktx2 || mrImg?.ktx2) ktx2 = true;
    const bs = samplerOf(info.base?.[1], baseImg), ms = samplerOf(info.mr?.[1], mrImg);
    const uvB = bs ? readAttr(prim.getAttribute(`TEXCOORD_${bs.tc}`)) : null;
    const uvM = ms ? readAttr(prim.getAttribute(`TEXCOORD_${ms.tc}`)) : null;
    const col = readAttr(prim.getAttribute('COLOR_0'));
    const idx = prim.getIndices()?.getArray() ?? Uint32Array.from({ length: pos.a.length / 3 }, (_, i) => i);
    const f = info.factor;
    for (let t = 0; t + 2 < idx.length; t += 3) {
      const i0 = idx[t], i1 = idx[t + 1], i2 = idx[t + 2];
      transformPoint(m, pos.a[i0 * 3], pos.a[i0 * 3 + 1], pos.a[i0 * 3 + 2], a);
      transformPoint(m, pos.a[i1 * 3], pos.a[i1 * 3 + 1], pos.a[i1 * 3 + 2], b);
      transformPoint(m, pos.a[i2 * 3], pos.a[i2 * 3 + 1], pos.a[i2 * 3 + 2], c);
      const ux = b[0] - a[0], uy = b[1] - a[1], uz = b[2] - a[2], vx = c[0] - a[0], vy = c[1] - a[1], vz = c[2] - a[2];
      const nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
      const len = Math.hypot(nx, ny, nz);
      tris++;
      if (!(len > 0)) continue;
      const area = len / 2;
      totalArea += area;
      const up = ny / len > 0.8 ? 1 : 0;
      const cy = ((a[1] + b[1] + c[1]) / 3 - mn[1]) / H, cz = ((a[2] + b[2] + c[2]) / 3 - mn[2]) / D, cx = ((a[0] + b[0] + c[0]) / 3 - mn[0]) / W;
      const sw = area / BARY.length;
      for (const [w0, w1, w2] of BARY) {
        let r = f[0], gg = f[1], bb = f[2], al = f[3], me = info.metal, ro = info.rough;
        if (bs && uvB) {
          const k = uvB.k, uv = uvB.a;
          bs.at(w0 * uv[i0 * k] + w1 * uv[i1 * k] + w2 * uv[i2 * k], w0 * uv[i0 * k + 1] + w1 * uv[i1 * k + 1] + w2 * uv[i2 * k + 1], tx);
          r *= LIN[tx[0]]; gg *= LIN[tx[1]]; bb *= LIN[tx[2]]; al *= tx[3] / 255;
        }
        if (ms && uvM) {
          const k = uvM.k, uv = uvM.a;
          ms.at(w0 * uv[i0 * k] + w1 * uv[i1 * k] + w2 * uv[i2 * k], w0 * uv[i0 * k + 1] + w1 * uv[i1 * k + 1] + w2 * uv[i2 * k + 1], tm);
          ro *= tm[1] / 255; me *= tm[2] / 255;
        }
        if (col) { const k = col.k, ca = col.a; r *= w0 * ca[i0 * k] + w1 * ca[i1 * k] + w2 * ca[i2 * k]; gg *= w0 * ca[i0 * k + 1] + w1 * ca[i1 * k + 1] + w2 * ca[i2 * k + 1]; bb *= w0 * ca[i0 * k + 2] + w1 * ca[i1 * k + 2] + w2 * ca[i2 * k + 2]; }
        const key = (toSrgb8(r) >> 3) << 10 | (toSrgb8(gg) >> 3) << 5 | toSrgb8(bb) >> 3;
        let bin = g.bins.get(key);
        if (!bin) { bin = new Float64Array(NB); g.bins.set(key, bin); }
        bin[0] += sw; bin[1] += r * sw; bin[2] += gg * sw; bin[3] += bb * sw; bin[4] += me * sw; bin[5] += ro * sw; bin[6] += al * sw;
        bin[7] += cy * sw; bin[8] += cz * sw; bin[9] += up * sw; bin[10] += cx * sw;
      }
    }
  }
  // Màu trung bình cả ảnh × baseColorFactor (chỉ để so sánh): khi đúng một vật liệu có ảnh base.
  const textured = [...mats.values()].filter((g) => g.info.base?.[0]);
  let imageMean = null;
  if (textured.length === 1) {
    const im = imgCache.get(textured[0].info.base[0]), f = textured[0].info.factor;
    if (im && !im.ktx2) { const s = [0, 0, 0]; for (let i = 0; i < im.data.length; i += 4) { s[0] += LIN[im.data[i]]; s[1] += LIN[im.data[i + 1]]; s[2] += LIN[im.data[i + 2]]; } const n = im.data.length / 4; imageMean = linToLab(s.map((v, k) => (v / n) * f[k])); }
  }
  const textures = root.listTextures();
  let maxTex = 0;
  for (const t of textures) { const im = imgCache.get(t) ?? (await decodeImage(t)); if (im.ktx2) ktx2 = true; else maxTex = Math.max(maxTex, im.size); }
  const clusters = [];
  for (const g of mats.values()) for (const cl of clusterBins(g.bins)) clusters.push({ ...cl, names: tokens(g.info.name, ...g.names), transmission: g.info.transmission, blend: g.info.blend, share: cl.area / (totalArea || 1) });
  clusters.sort((x, y) => y.area - x.area);
  return { size, tris, totalArea, clusters, ktx2, imageMean, nMats: mats.size, textures: textures.length, maxTex };
}

/** k-means theo diện tích trên Lab của các ngăn màu một vật liệu; k nhỏ nhất đủ giải thích màu (k ≤ 4). */
function clusterBins(bins) {
  const pts = [...bins.values()].map((v) => ({ v, w: v[0], lab: linToLab([v[1] / v[0], v[2] / v[0], v[3] / v[0]]) })).filter((q) => q.w > 0);
  if (!pts.length) return [];
  const run = (k) => {
    const cent = [pts.reduce((x, y) => (y.w > x.w ? y : x)).lab];
    while (cent.length < k) { let best = null, bd = -1; for (const q of pts) { const d = Math.min(...cent.map((cc) => dE(cc, q.lab))) * Math.sqrt(q.w); if (d > bd) { bd = d; best = q; } } cent.push(best.lab); }
    let asg = [];
    for (let it = 0; it < 12; it++) {
      asg = pts.map((q) => { let bi = 0; for (let j = 1; j < cent.length; j++) if (dE(cent[j], q.lab) < dE(cent[bi], q.lab)) bi = j; return bi; });
      for (let j = 0; j < cent.length; j++) { const s = [0, 0, 0]; let w = 0; pts.forEach((q, i) => { if (asg[i] === j) { s[0] += q.lab[0] * q.w; s[1] += q.lab[1] * q.w; s[2] += q.lab[2] * q.w; w += q.w; } }); if (w) cent[j] = s.map((x) => x / w); }
    }
    let err = 0, wt = 0; pts.forEach((q, i) => { err += dE(cent[asg[i]], q.lab) * q.w; wt += q.w; });
    return { asg, k: cent.length, err: err / wt };
  };
  let best = run(1);
  for (let k = 2; k <= Math.min(4, pts.length) && best.err > 5; k++) { const r = run(k); if (r.err < 0.6 * best.err) best = r; else break; }
  const out = [];
  for (let j = 0; j < best.k; j++) {
    const s = new Float64Array(NB);
    pts.forEach((q, i) => { if (best.asg[i] === j) for (let n = 0; n < NB; n++) s[n] += q.v[n]; });
    if (!s[0]) continue;
    const w = s[0];
    out.push({ area: w, lin: [s[1] / w, s[2] / w, s[3] / w], metal: s[4] / w, rough: s[5] / w, alpha: s[6] / w, y: s[7] / w, z: s[8] / w, up: s[9] / w, x: s[10] / w });
  }
  return out;
}

// ---------- phân loại (suy luận) ----------
const MAT_BY_NAME = [
  ['glass', /glass|vetro|mirror|transparent|crystal/],
  ['metal', /metal|chrome|steel|alumin|brass|iron|gold|silver|copper|bronze|nickel/],
  ['leather', /leather|leder/],
  ['fabric', /fabric|cloth|linen|velvet|textile|blanket|duvet|quilt|comforter|edredon|bedspread|wool|cotton|carpet|\brug\b|felt|boucle/],
  ['wood', /wood|\boak\b|walnut|veneer|timber|birch|maple|teak|\bpine\b|plywood|bamboo/],
  ['stone', /marble|stone|granite|concrete|terrazzo|travertine/],
  ['ceramic', /ceramic|porcelain|\bclay\b|terracotta/],
  ['plastic', /plastic|rubber|acrylic|vinyl|resin/],
];
// Tên gợi ý LOẠI phần (kèm tiếng Tây Ban Nha hay gặp trong nguồn): đồ phủ giường, đệm/gối, mặt bàn, khung.
const BEDDING_NAME = /blanket|duvet|\bsheet\b|quilt|bedding|bedspread|\bthrow\b|comforter|edredon|manta/;
const SOFT_NAME = /pillow|cushion|mattress|matress|colchon|almo?h?ada|almuada|cojin/;
const SEAT_NAME = /\bseat\b|upholst|backrest/;
const TOP_NAME = /\btop\b|tabletop|countertop|worktop/;
const FRAME_NAME = /frame|\blegs?\b|\bfeet\b|feets|\bfoot\b|\bbase\b|\bbody\b|carcass|structure|wheel/;
export const BED_SIGNAL_NAME = new RegExp(`${BEDDING_NAME.source}|${SOFT_NAME.source}`);
const PROFILE_MAT = { metal_black: 'metal', metal_chrome: 'metal', metal_brass: 'metal', wood_dark: 'wood', wood_light: 'wood', fabric: 'fabric', linen: 'fabric', velvet: 'fabric', leather: 'leather', stone: 'stone', marble: 'stone', concrete: 'stone', ceramic: 'ceramic', glass: 'glass', mirror: 'glass', plastic: 'plastic' };
const SEAT = new Set(['sofa', 'armchair', 'diningChair', 'bench']);
const BED = new Set(['doubleBed', 'singleBed']);
const CASE = new Set(['coffeeTable', 'diningTable', 'desk', 'nightstand', 'dresser', 'cabinet', 'closet', 'bookshelf', 'basin']);
const SOFT = new Set(['fabric', 'leather']);
const chroma = (lab) => Math.hypot(lab[1], lab[2]);
const darkNeutral = (lab) => lab[0] < 35 && chroma(lab) < 10;
/** Màu có hợp với chất liệu không. Gỗ ở ghế/giường cần bằng chứng mạnh hơn (vải be dễ bị nhầm là gỗ). */
const plausible = (m, cl, strict) => {
  const lab = cl.lab;
  if (m === 'wood') return lab[0] < 92 && (lab[0] < 35 || (strict ? lab[2] > 12 && lab[1] > 2 : lab[2] > 4));
  if (m === 'stone' || m === 'ceramic') return chroma(lab) < 15;
  if (m === 'metal') return cl.metal >= 0.3 || (darkNeutral(lab) && cl.share < 0.4);
  return m !== 'glass';
};
// Vùng nệm: mặt hướng lên, trên khung, không phải đầu giường (mặt trước là +z → đầu giường ở z nhỏ).
const inSleepZone = (cl) => cl.up > 0.3 && cl.y > 0.25 && cl.z > 0.2;

/** Chất liệu từ danh sách `materials` của profiles, lọc theo màu, chọn theo vai + gợi ý tên (mềm/cứng). */
function materialFromProfile(cl, ctx, rank, hint) {
  const strict = SEAT.has(ctx.role) || BED.has(ctx.role);
  const cands = [...new Set((ctx.profMats ?? []).map((m) => PROFILE_MAT[m]).filter(Boolean))].filter((m) => plausible(m, cl, strict));
  const has = (m) => cands.includes(m);
  const soft = () => (has('leather') && has('fabric') ? (cl.rough < 0.55 ? 'leather' : 'fabric') : has('leather') ? 'leather' : has('fabric') ? 'fabric' : undefined);
  const hard = (...order) => (has('metal') && darkNeutral(cl.lab) ? 'metal' : order.find(has));
  if (hint === 'soft') return soft();
  if (hint === 'hard') return hard('wood', 'stone', 'metal', 'plastic', 'ceramic');
  if (cands.length <= 1) return cands[0];
  if (SEAT.has(ctx.role)) return rank === 0 ? soft() ?? hard('wood', 'plastic') : hard('wood', 'metal', 'plastic') ?? soft();
  const woodish = cl.lab[2] > 18 && cl.lab[1] > 3;
  if (BED.has(ctx.role)) return inSleepZone(cl) && !(woodish && has('wood')) ? soft() ?? hard('wood') : hard('wood', 'metal') ?? soft();
  if (CASE.has(ctx.role)) return hard('wood', 'stone', 'plastic', 'metal');
  return undefined;
}

const kindFromName = (n, role) => {
  if (BEDDING_NAME.test(n) && (BED.has(role) || SEAT.has(role))) return 'bedding';
  if (SOFT_NAME.test(n) && BED.has(role)) return 'bedding';
  if ((SOFT_NAME.test(n) || SEAT_NAME.test(n)) && SEAT.has(role)) return 'upholstery';
  if (TOP_NAME.test(n) && CASE.has(role)) return 'top';
  if (FRAME_NAME.test(n)) return 'frame';
  return undefined;
};

/** Suy luận kind/material cho một cụm. */
export function classify(cl, ctx, rank) {
  const nameKind = kindFromName(cl.names, ctx.role);
  let material = MAT_BY_NAME.find(([, re]) => re.test(cl.names))?.[0];
  if (!material && (cl.transmission > 0.3 || (cl.blend && cl.alpha < 0.5))) material = 'glass';
  if (!material && cl.metal >= 0.6) material = 'metal';
  if (!material) material = materialFromProfile(cl, ctx, rank, nameKind === 'bedding' || nameKind === 'upholstery' ? 'soft' : nameKind ? 'hard' : undefined);
  let kind = material === 'glass' ? 'glass' : material === 'metal' ? 'metal' : nameKind;
  if (!kind) {
    if (BED.has(ctx.role)) kind = SOFT.has(material) ? (inSleepZone(cl) ? 'bedding' : 'upholstery') : material ? 'frame' : 'other';
    else if (SEAT.has(ctx.role)) kind = SOFT.has(material) ? 'upholstery' : material ? 'frame' : 'other';
    else if (CASE.has(ctx.role)) kind = cl.up >= 0.35 && cl.y >= 0.55 && cl.share < 0.8 ? 'top' : material ? 'frame' : 'other';
    else kind = 'other';
  }
  return { kind, material };
}

/** Cụm → tối đa 4 phần: phân loại, gộp cùng loại + màu gần (ΔE<12), bỏ <5 %, tỉ phần trên tổng diện tích. */
export function partsOf(measure, ctx) {
  if (measure.ktx2 || !measure.clusters.length) return undefined;
  const cls = measure.clusters.map((cl, i) => { const lab = linToLab(cl.lin); const c = { ...cl, lab }; return { ...c, ...classify(c, ctx, i) }; });
  const merged = [];
  for (const c of cls) {
    const m = merged.find((x) => x.kind === c.kind && x.material === c.material && dE(x.lab, c.lab) < 12);
    if (!m) { merged.push({ ...c }); continue; }
    const w = m.share + c.share;
    m.lin = m.lin.map((v, k) => (v * m.share + c.lin[k] * c.share) / w);
    m.share = w; m.lab = linToLab(m.lin);
  }
  merged.sort((x, y) => y.share - x.share);
  const parts = merged.filter((x) => x.share >= MIN_SHARE).slice(0, MAX_PARTS).map((x) => ({
    kind: x.kind, share: Math.min(1, +x.share.toFixed(2)), lab: x.lab.map((v) => Math.round(v)), ...(x.material ? { material: x.material } : {}), kindBy: 'i',
  }));
  return parts.length ? parts : undefined;
}

// ---------- đọc nguồn ----------
const sha = (buf) => createHash('sha256').update(buf).digest('hex');
const readJsonl = (p) => readFileSync(p, 'utf8').split('\n').filter((l) => l.trim()).map((l) => JSON.parse(l));
const walk = (d, o = []) => { for (const f of readdirSync(d)) { const p = join(d, f); if (statSync(p).isDirectory()) walk(p, o); else if (f.endsWith('.glb')) o.push(p.split('\\').join('/')); } return o; };

export async function makeIO() {
  await MeshoptDecoder.ready;
  return new NodeIO().registerExtensions(ALL_EXTENSIONS).registerDependencies({ 'draco3d.decoder': await draco3d.createDecoderModule(), 'meshopt.decoder': MeshoptDecoder });
}

/** Luật ghép nhãn ảnh: bỏ phiếu `unsure`; ≥2 phiếu cùng giá trị và không giá trị nào khác ≥2 phiếu → ghi. */
export function tagConsensus(rows) {
  const by = new Map();
  for (const r of rows) {
    if (!r.id || !r.completeness || r.completeness === 'unsure') continue;
    const votes = by.get(r.id) ?? {};
    votes[r.completeness] = (votes[r.completeness] ?? 0) + 1;
    by.set(r.id, votes);
  }
  const out = new Map();
  for (const [id, votes] of by) { const top = Object.entries(votes).filter(([, n]) => n >= 2); if (top.length === 1) out.set(id, top[0][0]); }
  return out;
}

const stable = (v) => (Array.isArray(v) ? `[${v.map(stable).join(',')}]` : v && typeof v === 'object' ? `{${Object.keys(v).sort().map((k) => `${JSON.stringify(k)}:${stable(v[k])}`).join(',')}}` : JSON.stringify(v));

// ---------- dạng nén cho bundle (giải nén ở libraryQuality.ts) ----------
const KIND_CODES = ['upholstery', 'bedding', 'frame', 'top', 'metal', 'glass', 'other'];
const MAT_CODES = ['wood', 'fabric', 'leather', 'metal', 'stone', 'glass', 'plastic', 'ceramic'];
const TIER_CODES = ['light', 'medium', 'heavy'];
function compact(models) {
  const lic = [], src = [], auth = [];
  const ix = (arr, v) => { let i = arr.indexOf(v); if (i < 0) { i = arr.length; arr.push(v); } return i; };
  const prefixOf = (s) => { const i = s.lastIndexOf('/'); return i > 0 ? [s.slice(0, i + 1), s.slice(i + 1)] : ['', s]; };
  const out = {};
  for (const [id, q] of Object.entries(models)) {
    const [pre, rest] = prefixOf(q.source);
    const row = { u: q.useMm, d: [q.detail.tris, q.detail.kb, q.detail.textures, q.detail.maxTex, TIER_CODES.indexOf(q.detail.tier)], l: ix(lic, q.licence), o: [ix(src, pre), rest] };
    if (q.role) row.r = q.role;
    if (q.front.check !== 'ok') row.f = 1;
    if (q.completeness) row.c = q.completeness.v[0] + q.completeness.by;
    if (q.parts) row.p = q.parts.map((p) => [KIND_CODES.indexOf(p.kind), Math.round(p.share * 100), ...p.lab, ...(p.material ? [MAT_CODES.indexOf(p.material)] : [])]);
    if (q.styles?.length) row.s = q.styles;
    if (q.author) row.a = ix(auth, q.author);
    if (q.issues?.length) row.q = q.issues;
    out[id] = row;
  }
  return { dict: { licence: lic, sourcePrefix: src, author: auth, kind: KIND_CODES, material: MAT_CODES, tier: TIER_CODES }, rows: out };
}

async function main() {
  const outDir = process.argv.includes('--out-dir') ? process.argv[process.argv.indexOf('--out-dir') + 1] : 'F:/runs/m12/q';
  for (const p of [SRC.files, SRC.profiles, ...GLB_DIRS]) if (!existsSync(p)) throw new Error(`Thiếu nguồn: ${p}`);
  const files = JSON.parse(readFileSync(SRC.files, 'utf8'));
  const profiles = new Map(readJsonl(SRC.profiles).map((p) => [p.id, p]));
  const roles = JSON.parse(readFileSync(SRC.roles, 'utf8')).roles;
  const roles2 = JSON.parse(readFileSync(SRC.roles2, 'utf8')).roles;
  const qc = JSON.parse(readFileSync(SRC.qc, 'utf8')).excluded ?? {};
  const tagRows = existsSync(SRC.tags) ? readJsonl(SRC.tags) : [];
  const tags = tagConsensus(tagRows);
  const roleOf = new Map();
  for (const r of [roles, roles2]) for (const [role, ids] of Object.entries(r)) for (const id of ids) if (!roleOf.has(id)) roleOf.set(id, role);
  const glbs = GLB_DIRS.flatMap((d) => walk(d));
  const byHash = new Map(), dirHash = {};
  for (const f of glbs) { const h = sha(readFileSync(f)); byHash.set(h, f); const d = GLB_DIRS.find((x) => f.startsWith(x)); (dirHash[d] ??= []).push(h); }
  const io = await makeIO();
  const all = {}, features = [], sizeWarn = [], missing = [];
  let ktx2 = 0, n = 0;
  const t0 = Date.now();
  for (const entry of files) {
    const id = entry.id, file = byHash.get(entry.model_sha256), prof = profiles.get(id);
    if (!file) { missing.push(id); continue; }
    const doc = await io.read(file);
    const ms = await measureDocument(doc);
    const role = roleOf.get(id);
    const parts = partsOf(ms, { role, profMats: prof?.materials });
    if (ms.ktx2) ktx2++;
    const useMm = [ms.size[0], ms.size[1], ms.size[2]].map((v) => Math.round(v * 1000));
    if (prof?.sizeMm) { const pm = [prof.sizeMm.w, prof.sizeMm.h, prof.sizeMm.d]; const worst = Math.max(...pm.map((v, k) => Math.abs(useMm[k] - v) / Math.max(1, v))); if (worst > 0.05) sizeWarn.push({ id, useMm, profile: pm, worst: +worst.toFixed(3) }); }
    const kb = Math.round(statSync(file).size / 1024);
    const tag = tags.get(id);
    const issues = [...(prof?.qc?.issues ?? []), ...(qc[id]?.reasons ?? []).map((r) => `qc:${r}`)];
    const q = {
      ...(role ? { role } : {}),
      useMm,
      front: { axis: '+z', check: prof?.frontCheck === 'suspect' ? 'suspect' : 'ok' },
      ...(tag ? { completeness: { v: tag, by: 'i' } } : {}),
      ...(parts ? { parts } : {}),
      ...(prof?.styles?.length ? { styles: prof.styles } : {}),
      detail: { tris: ms.tris, kb, textures: ms.textures, maxTex: ms.maxTex, tier: tierOf(ms.tris, kb) },
      licence: entry.license || 'unknown',
      source: entry.source || '',
      ...(entry.author ? { author: entry.author } : {}),
      ...(issues.length ? { issues } : {}),
    };
    all[id] = q;
    const main0 = parts?.[0];
    features.push({ id, role, file, ktx2: ms.ktx2, imageMean: ms.imageMean?.map((v) => +v.toFixed(1)), mainLab: main0?.lab, mainShare: main0?.share, dEmainVsImage: ms.imageMean && main0 ? +dE(ms.imageMean, main0.lab).toFixed(1) : null, nClusters: ms.clusters.length, nMats: ms.nMats, bedNames: BED_SIGNAL_NAME.test(ms.clusters.map((c) => c.names).join(' ')), bedding: parts?.filter((p) => p.kind === 'bedding').reduce((s, p) => s + p.share, 0) ?? null, nBedding: parts?.filter((p) => p.kind === 'bedding').length ?? null, clusters: ms.clusters.slice(0, 8).map((c) => ({ s: +c.share.toFixed(3), lab: linToLab(c.lin).map(Math.round), m: +c.metal.toFixed(2), r: +c.rough.toFixed(2), y: +c.y.toFixed(2), z: +c.z.toFixed(2), up: +c.up.toFixed(2), names: c.names.slice(0, 60) })) });
    if (++n % 100 === 0) console.log(n, `${((Date.now() - t0) / 1000).toFixed(0)} s`);
  }
  const inputs = {
    [SRC.files]: `rows=${files.length} sha=${sha(readFileSync(SRC.files)).slice(0, 12)}`,
    [SRC.profiles]: `rows=${profiles.size} sha=${sha(readFileSync(SRC.profiles)).slice(0, 12)}`,
    [SRC.roles]: `sha=${sha(readFileSync(SRC.roles)).slice(0, 12)}`,
    [SRC.roles2]: `sha=${sha(readFileSync(SRC.roles2)).slice(0, 12)}`,
    [SRC.qc]: `sha=${sha(readFileSync(SRC.qc)).slice(0, 12)}`,
    [SRC.tags]: existsSync(SRC.tags) ? `rows=${tagRows.length} sha=${sha(readFileSync(SRC.tags)).slice(0, 12)}` : 'absent',
  };
  for (const d of GLB_DIRS) inputs[d] = `glb=${dirHash[d]?.length ?? 0} sha=${sha((dirHash[d] ?? []).sort().join('')).slice(0, 12)}`;
  const rules = { tier: TIER_RULE, parts: `area-weighted UV samples, k-means per material, merge same kind+material dE<12, drop share<${MIN_SHARE}, max ${MAX_PARTS}`, completeness: 'visual-tags: drop unsure; value with >=2 votes and no rival with >=2' };
  const head = (models) => ({ schema: 1, rev: sha(stable(models)).slice(0, 16), generatedBy: 'scripts/gen-library-quality.mjs', inputs, rules });
  const bundleModels = Object.fromEntries(Object.entries(all).filter(([id]) => roleOf.has(id)).sort(([x], [y]) => (x < y ? -1 : 1)));
  writeFileSync(join(outDir, 'libraryQuality-all.json'), JSON.stringify({ ...head(all), models: all }));
  writeFileSync(join(outDir, 'features.jsonl'), features.map((f) => JSON.stringify(f)).join('\n'));
  writeFileSync(join(outDir, 'size-mismatch.json'), JSON.stringify(sizeWarn, null, 1));
  // Kiểm chứng "không phải trung bình texture": mẫu atlas (một vật liệu duy nhất, có ảnh base), phần chính ≥ 50 %,
  // ΔE lớn nhất giữa phần chính và trung bình cả ảnh × baseColorFactor.
  const atlas = features.filter((f) => roleOf.has(f.id) && f.nMats === 1 && f.dEmainVsImage != null && f.mainShare >= 0.5).sort((x, y) => y.dEmainVsImage - x.dEmainVsImage)[0];
  if (atlas) writeFileSync(join(outDir, 'atlas-check.json'), JSON.stringify({ id: atlas.id, file: atlas.file, role: atlas.role, profMats: profiles.get(atlas.id)?.materials ?? [], mainLab: atlas.mainLab, imageMean: atlas.imageMean, dE: atlas.dEmainVsImage }, null, 1));
  const { dict, rows } = compact(bundleModels);
  const json = JSON.stringify({ ...head(bundleModels), format: 'compact-1', dict, models: rows });
  writeFileSync(`${FE}/libraryQuality.json`, `${json}\n`);
  const missingRole = [...roleOf.keys()].filter((id) => !all[id]);
  console.log(JSON.stringify({ measured: n, bundle: Object.keys(bundleModels).length, bundleKb: +(json.length / 1024).toFixed(1), ktx2, missing, missingRole, sizeWarn: sizeWarn.length, tags: tags.size, s: Math.round((Date.now() - t0) / 1000) }));
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((e) => { console.error(`gen-library-quality: ${e.message}`); process.exit(1); });
}
