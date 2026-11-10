/**
 * M6 làn A: `?tone=aces|agx|agx-cal|neutral` — logic ở `src/pascal-page/realism/tone.ts`; không cờ = `agx-cal` (vòng 5),
 * `low`/WebGL2 = ACES. `applyTone` chạy SAU `lightxToneMapping`/`lightxExposure` nên `?lightx=tone` không ghép được với
 * tone này: tone map bị `applyTone` đè, phơi sáng nhân cả ×0,9 lẫn hệ số tone. Muốn Neutral thì dùng `?tone=neutral`.
 * Neo trên dòng phơi sáng mà `m5-light.mjs` (xếp trước) đã viết lại trong `ToneMappingExposure`: hiệu ứng này chạy SAU
 * `configure()` của R3F (nơi đặt lại ACES), và chạy lại mỗi lần đổi chủ đề.
 */
export const RULES = {
  'viewer/src/components/viewer/index.tsx': [
    ["'use client'\n", "'use client'\nimport { applyTone } from '@pascal-realism/tone'\n"],
    [
      '    gl.toneMappingExposure = lightxExposure(getSceneTheme(sceneTheme).toneMappingExposure)\n',
      '    gl.toneMappingExposure = lightxExposure(getSceneTheme(sceneTheme).toneMappingExposure)\n    applyTone(gl)\n',
    ],
  ],
};
