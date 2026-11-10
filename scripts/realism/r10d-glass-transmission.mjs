/**
 * R10D — kính cửa sổ "có mặt" (A/B `?glass=alpha|sheet|transmission`, mặc định theo `GLASS_DEFAULT`).
 * Logic ở `src/pascal-page/realism/glass.ts`: `createMaterial` (vật liệu cảnh, vd `scene:mat_appfront_glass`)
 * trả biến thể kính thay vật liệu vendor (đã qua `applyGlassFresnel`); null = giữ nguyên. Cache vendor giữ biến thể.
 */
export const RULES = {
  'viewer/src/lib/materials.ts': [
    [
      "import { getSceneTheme } from './scene-themes'\n",
      "import { getSceneTheme } from './scene-themes'\nimport { glassVariant } from '@pascal-realism/glass'\n",
    ],
    [
      '  maybeApplyGlassFresnel(threeMaterial)\n  threeMaterial.userData.__pascalCachedMaterial = true\n  materialCache.set(cacheKey, threeMaterial)\n  return threeMaterial\n',
      '  maybeApplyGlassFresnel(threeMaterial)\n  const glass = glassVariant(threeMaterial) ?? threeMaterial\n  glass.userData.__pascalCachedMaterial = true\n  materialCache.set(cacheKey, glass)\n  return glass\n',
    ],
  ],
};
