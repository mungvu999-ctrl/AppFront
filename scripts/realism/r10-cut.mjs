/**
 * S1 cắt thấp (render look B): chế độ "Tường: cắt" thôi đổi tường hướng ra ngoài sang chấm mờ, thay vào đó
 * cắt cả tầng ở sàn + 1,0 m (tường, vách giữa hai phòng, cửa, cửa sổ, đồ cao, trần) và tô mặt cắt gần đen.
 * Logic: `src/pascal-page/realism/cut.ts`; phần chạy mỗi khung: `cutSync.ts` (gắn vào bộ hệ tường).
 * "Tường: cao đủ" / "thấp" / "trong mờ" giữ nguyên.
 * Mặt cắt theo camera (mắt dưới trần thì thôi cắt): luật `u61-cut-camera.mjs` truyền camera + cao tầng.
 */
export const RULES = {
  'nodes/src/wall/system.tsx': [
    [
      "import { type AnyNodeId, useLiveNodeOverrides, useScene, type WallNode } from '@pascal-app/core'\nimport { timeSpan, WallCutout, WallSystem } from '@pascal-app/viewer'\n",
      "import { type AnyNodeId, sceneRegistry, useLiveNodeOverrides, useScene, type WallNode } from '@pascal-app/core'\nimport { timeSpan, useViewer, WallCutout, WallSystem } from '@pascal-app/viewer'\nimport { syncLowCut } from '@pascal-realism/cutSync'\n",
    ],
    [
      'const WallTreatmentMiterSystem = () => {',
      'const LowCutSystem = () => {\n  useFrame(() => syncLowCut(sceneRegistry, useViewer.getState().wallMode))\n  return null\n}\n\nconst WallTreatmentMiterSystem = () => {',
    ],
    ['      <WallBatchSystem />\n', '      <WallBatchSystem />\n      <LowCutSystem />\n'],
  ],
  'viewer/src/systems/wall/wall-cutout-cache.ts': [
    [
      "  negativeFacing: boolean,\n): boolean {\n  if (mode === 'up') return false",
      "  negativeFacing: boolean,\n): boolean {\n  if (mode === 'up' || mode === 'cutaway') return false",
    ],
  ],
  'viewer/src/systems/wall/wall-cutout.tsx': [
    [
      "  cameraDir: Vector3,\n): boolean {\n  if (wallMode === 'up') return false",
      "  cameraDir: Vector3,\n): boolean {\n  if (wallMode === 'up' || wallMode === 'cutaway') return false",
    ],
  ],
};
