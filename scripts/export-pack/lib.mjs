// Hàm thuần của build.mjs (có test): ánh xạ đường danh mục → ảnh nguồn, sinh furniture-defaults.
import { join } from 'node:path';

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
