/**
 * Nhóm C, chỉ dev: `?probe=1&baked=<thư mục>` thay cảnh sống bằng GLB đã nướng ánh sáng Cycles
 * (`src/pascal-page/realism/bakedPreview.ts`). Gắn vào hệ cắt tường của `r10-cut.mjs` (chạy mỗi khung).
 */
export const RULES = {
  'nodes/src/wall/system.tsx': [
    [
      "import { syncLowCut } from '@pascal-realism/cutSync'\n",
      "import { syncLowCut } from '@pascal-realism/cutSync'\nimport { syncBakedPreview } from '@pascal-realism/bakedPreview'\n",
    ],
    [
      '  useFrame(() => syncLowCut(sceneRegistry, useViewer.getState().wallMode))\n',
      '  useFrame((state) => {\n    syncLowCut(sceneRegistry, useViewer.getState().wallMode)\n    syncBakedPreview(state.scene, sceneRegistry)\n  })\n',
    ],
  ],
};
