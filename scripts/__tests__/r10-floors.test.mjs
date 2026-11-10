// Vòng 6 làn 2: vai `floor` chỉ đi vào từ mặt trên tấm sàn; mọi chỗ gọi vendor khác giữ chữ ký cũ (không vai).
const { it: test } = globalThis.describe ? globalThis : await import('node:test');
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';

import { REALISM_RULES, transformRealism } from '../pascal-realism.mjs';
import { RENDER_RULES, transformRender } from '../pascal-render.mjs';

const PACKAGES = path.resolve('vendor/pascal/packages');
const patched = (file) => {
  const id = path.join(PACKAGES, file);
  const raw = readFileSync(id, 'utf8');
  const code = RENDER_RULES[file] ? transformRender(raw, id) : raw;
  return (transformRealism(code, id) ?? code).replaceAll('\r\n', '\n');
};
const count = (s, sub) => s.split(sub).length - 1;

test('slab: khe surface (cả mặc định) truyền vai sàn, khe side không', () => {
  const slab = patched('nodes/src/slab/geometry.ts');
  assert.equal(count(slab, "resolveMaterialRef(slotRef, sceneMaterials, shading, slotId === 'surface' ? 'floor' : undefined)"), 1);
  assert.equal(count(slab, "(slotId === 'surface' ? resolveMaterialRef(slotDefault, sceneMaterials, shading, 'floor') : null) ??"), 1);
  const raw = readFileSync(path.join(PACKAGES, 'nodes/src/slab/geometry.ts'), 'utf8');
  assert.equal(count(slab, "'floor'") - count(raw, "'floor'"), 2);
});

test('materials: vai đi tới floorFinishPreset + tuneFloorFinish; resolveMaterialRef chuyển tiếp vai', () => {
  const m = patched('viewer/src/lib/materials.ts');
  assert.equal(count(m, '  role?: \'floor\',\n'), 2);
  assert.equal(count(m, 'tuneFloorFinish(materialPreset, createMaterialFromPreset(floorFinishPreset(materialPreset, preset, role), shading), role)'), 1);
  assert.equal(count(m, "if (parsed.kind === 'library') return createMaterialFromPresetRef(ref, shading, role)"), 1);
});

test("không luật nào khác truyền vai 'floor' (mặt bàn, tường, đồ giữ vật liệu không vai)", () => {
  const others = REALISM_RULES.filter((r) => !r.source.includes('r10-floors'));
  for (const r of others) for (const [, to] of r.pairs) assert.ok(!String(to).includes("'floor')"), `${r.source} ${r.file}`);
});
