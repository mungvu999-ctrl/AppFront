// Hàm của build.mjs (có test): ánh xạ đường danh mục → ảnh nguồn, giải nén KTX2, sinh furniture-defaults.
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, isAbsolute, join, parse, relative, resolve, sep } from 'node:path';
import vm from 'node:vm';

/** Đường ảnh nguồn (webp/jpg/png) trong `assets` cho một map của danh mục; `.ktx2` qua `sourceFor`. */
export function sourceOfMap(assetsDir, mapPath, sourceFor, exists) {
  if (/\.ktx2$/.test(mapPath)) {
    try {
      const p = sourceFor(mapPath);
      return exists(p) ? p : null;
    } catch {
      return null;
    }
  }
  const p = join(assetsDir, mapPath);
  return exists(p) ? p : null;
}

/**
 * `{"<kind>|<variant>": folder, "<kind>": folder}`. Variant thắng kind (toPascal chọn theo variant bất kể kind),
 * nên mọi cặp kind x variant có mẫu đều ghi. `folderOfKind(kind)` = mẫu mặc định của kind (null = không mẫu).
 */
export function buildDefaults(kinds, variants, variantModel, folderOfKind) {
  const out = {};
  for (const kind of kinds) {
    const k = folderOfKind(kind);
    if (k) out[kind] = k;
    for (const v of variants) {
      const folder = variantModel[v]?.folder;
      if (folder) out[`${kind}|${v}`] = folder;
    }
  }
  return out;
}

/**
 * `Room.finish` → mục vật liệu (cùng định dạng scene-materials). `floorRefs` = `style.floor` của phong cách
 * mặc định (`floorMaterialOf` trong sceneDressing.ts). Ref `library:<id>` copy từ materials, `scene:<id>` từ
 * sceneMaterials (id không tiền tố `scene:`). Không phân giải được → `missing` ghi dòng.
 */
export function resolveFinishes(floorRefs, materials, sceneMaterials) {
  const out = {};
  const missing = [];
  for (const [finish, ref] of Object.entries(floorRefs)) {
    const [ns, id] = ref.split(/:(.+)/);
    const src = ns === 'library' ? materials[id] : ns === 'scene' ? sceneMaterials[id] : undefined;
    if (!src) {
      missing.push(`finish:${finish} (${ref})`);
      continue;
    }
    out[finish] = { ...src, ref };
    if (src.hasTexture && Object.keys(src.maps).length === 0) missing.push(`finish:${finish}:thiếu ảnh (${ref})`);
  }
  return { out, missing };
}

/** Mọi chuỗi `library:`/`scene:` lồng trong một đối tượng. */
export function collectRefs(value, acc = new Set()) {
  if (typeof value === 'string') {
    if (/^(library|scene):/.test(value)) acc.add(value);
  } else if (value && typeof value === 'object') {
    Object.values(value).forEach((v) => collectRefs(v, acc));
  }
  return acc;
}

/** Ref không có trong materials/sceneMaterials → dòng `missing`. */
export function missingRefs(refs, materials, sceneMaterials) {
  return [...refs]
    .filter((ref) => {
      const [ns, id] = ref.split(/:(.+)/);
      return !(ns === 'library' ? materials[id] : sceneMaterials[id]);
    })
    .map((ref) => `editor-defaults:${ref}`);
}

/** Bảng `Record` literal không export trong mã nguồn TS: `const NAME: ... = { a: 'x', ... };` → {a: 'x'}. */
export function parseStringRecord(src, name) {
  const m = new RegExp(String.raw`const ${name}\b[^=]*=\s*\{([^}]*)\}`).exec(src);
  if (!m) return null;
  return Object.fromEntries([...m[1].matchAll(/([A-Za-z_]+):\s*'([^']*)'/g)].map((x) => [x[1], x[2]]));
}

/** `const NAME = '...'` → chuỗi. */
export function parseConstString(src, name) {
  return new RegExp(String.raw`const ${name}\b[^=]*=\s*'([^']*)'`).exec(src)?.[1] ?? null;
}

const basisDir = join(dirname(createRequire(import.meta.url).resolve('three')), '..', 'examples', 'jsm', 'libs', 'basis');
let basis = null;
/** KTX2 (Basis) → ảnh `sharp` RGBA đúng cỡ gốc; hỏng → null. */
export async function decodeKtx2(file, sharp) {
  if (!basis) {
    const module = { exports: {} };
    const ctx = { module, exports: module.exports, console, WebAssembly, performance, TextDecoder };
    vm.runInNewContext(readFileSync(join(basisDir, 'basis_transcoder.js'), 'utf8'), ctx);
    basis = await ctx.module.exports({ wasmBinary: readFileSync(join(basisDir, 'basis_transcoder.wasm')) });
    basis.initializeBasis();
  }
  const ktx = new basis.KTX2File(new Uint8Array(readFileSync(file)));
  try {
    const RGBA32 = 13;
    const [width, height] = [ktx.getWidth(), ktx.getHeight()];
    const data = new Uint8Array(ktx.getImageTranscodedSizeInBytes(0, 0, 0, RGBA32));
    if (!width || !ktx.startTranscoding() || !ktx.transcodeImage(data, 0, 0, 0, RGBA32, 0, -1, -1)) return null;
    return sharp(Buffer.from(data), { raw: { width, height, channels: 4 } });
  } finally {
    ktx.close();
    ktx.delete();
  }
}

/** Tệp đánh dấu build.mjs ghi vào `--out`; chỉ thư mục có nó (hoặc rỗng/chưa có) mới được xoá để dựng lại. */
export const OUT_MARKER = '.export-pack-out';

const within = (parent, child) => {
  const r = relative(parent, child);
  return r === '' || (!isAbsolute(r) && r !== '..' && !r.startsWith('..' + sep));
};

/**
 * Lý do từ chối xoá `--out` (F1), hoặc null nếu xoá được: phải là đường tuyệt đối, không là gốc ổ, không chứa
 * và không nằm trong repo (trừ dưới `node_modules/.cache/export-pack/`), và thư mục có sẵn phải rỗng hoặc có OUT_MARKER.
 */
export function unsafeOutReason(rawOut, root, { exists, readdir }) {
  if (!rawOut || !isAbsolute(rawOut)) return '--out phải là đường tuyệt đối';
  const out = resolve(rawOut);
  if (parse(out).root === out) return '--out là gốc ổ đĩa';
  const cache = join(root, 'node_modules', '.cache', 'export-pack');
  if (within(out, root)) return '--out chứa thư mục repo';
  if (within(root, out) && (out === cache || !within(cache, out))) return '--out nằm trong repo (chỉ được dưới node_modules/.cache/export-pack/<tên>)';
  if (!exists(out) || readdir(out).length === 0 || exists(join(out, OUT_MARKER))) return null;
  return `thư mục có sẵn, không rỗng và không có ${OUT_MARKER} của lần dựng trước`;
}
