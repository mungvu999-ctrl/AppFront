/**
 * S2 — sàn đúng cỡ thật: mọi `library:<id>` đi qua `createMaterialFromPresetRef` được
 * `@pascal-realism/floorFinish` chỉnh (chỉ các id trong `FLOOR_FINISHES`, cờ `materials`):
 * repeat = 1 / cạnh thật, normal nhẹ (preset sao chép → khoá cache vendor riêng), rồi colorNode
 * đổi tông theo bảng màu giữ vân ảnh + ron mảnh cho đá lát.
 * Vòng 6 (làn 2): tham số tuỳ chọn `role` ('floor') cho `createMaterialFromPresetRef` / `resolveMaterialRef`. CHỈ mặt
 * trên tấm sàn (`slab` khe `surface`, kể cả mặc định của khe) truyền 'floor' → dải nhám theo loại, trên vật liệu cache
 * riêng của (mã × vai sàn). Mọi chỗ gọi khác (mặt bàn, tường, đồ, cầu thang…) không truyền → y như trước.
 */
export const RULES = {
  'viewer/src/lib/materials.ts': [
    [
      "import { stampPascalTextureRef } from './texture-reference'\n",
      "import { stampPascalTextureRef } from './texture-reference'\nimport { floorFinishPreset, tuneFloorFinish } from '@pascal-realism/floorFinish'\n",
    ],
    [
      "export function createMaterialFromPresetRef(\n  materialPreset?: string,\n  shading: RenderShading = 'rendered',\n): THREE.Material | null {\n",
      "export function createMaterialFromPresetRef(\n  materialPreset?: string,\n  shading: RenderShading = 'rendered',\n  role?: 'floor',\n): THREE.Material | null {\n",
    ],
    [
      '  if (!preset) return null\n  return createMaterialFromPreset(preset, shading)\n',
      '  if (!preset) return null\n  return tuneFloorFinish(materialPreset, createMaterialFromPreset(floorFinishPreset(materialPreset, preset, role), shading), role)\n',
    ],
    [
      "  shading: RenderShading = 'rendered',\n): THREE.Material | null {\n  const parsed = parseMaterialRef(ref)\n  if (!parsed) return null\n  if (parsed.kind === 'library') return createMaterialFromPresetRef(ref, shading)\n",
      "  shading: RenderShading = 'rendered',\n  role?: 'floor',\n): THREE.Material | null {\n  const parsed = parseMaterialRef(ref)\n  if (!parsed) return null\n  if (parsed.kind === 'library') return createMaterialFromPresetRef(ref, shading, role)\n",
    ],
  ],
  'nodes/src/slab/geometry.ts': [
    [
      '    const resolved = resolveMaterialRef(slotRef, sceneMaterials, shading)\n',
      "    const resolved = resolveMaterialRef(slotRef, sceneMaterials, shading, slotId === 'surface' ? 'floor' : undefined)\n",
    ],
    [
      '  return resolveSlotDefaultMaterial(slotDefault, shading, 0.8)\n',
      "  return (\n    (slotId === 'surface' ? resolveMaterialRef(slotDefault, sceneMaterials, shading, 'floor') : null) ??\n    resolveSlotDefaultMaterial(slotDefault, shading, 0.8)\n  )\n",
    ],
  ],
};
