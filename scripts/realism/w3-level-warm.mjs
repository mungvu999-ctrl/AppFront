/**
 * W3 (levelwarm): làm ấm tầng ẩn khi trang rảnh — logic ở `src/pascal-page/realism/levelWarm.ts`.
 * Tên `w3` để chạy SAU `w1-warm-pipelines` (neo vào dòng W1 đã chèn): bọc `_renderObjectDirect` ngoài W2,
 * và bọc lệnh vẽ khung sống bên trong `liveFrame`. `?disable=levelwarm` tắt.
 */
export const RULES = {
  'viewer/src/components/viewer/post-processing.tsx': [
    [
      "import { installShadowAlphaSkip } from '@pascal-realism/shadow-alpha'\n",
      "import { installShadowAlphaSkip } from '@pascal-realism/shadow-alpha'\n" +
        "import { installLevelWarm, levelWarmFrame } from '@pascal-realism/levelWarm'\n",
    ],
    ['    installShadowAlphaSkip(renderer)\n    if (!shouldDraw()) return\n', '    installShadowAlphaSkip(renderer)\n    installLevelWarm(renderer)\n    if (!shouldDraw()) return\n'],
    ['        liveFrame(scene, () => pipeline.render())\n', '        liveFrame(scene, () => levelWarmFrame(scene, () => pipeline.render()))\n'],
    [
      '          liveFrame(scene, () => (renderer as any).render(scene, camera))\n',
      '          liveFrame(scene, () => levelWarmFrame(scene, () => (renderer as any).render(scene, camera)))\n',
    ],
  ],
};
