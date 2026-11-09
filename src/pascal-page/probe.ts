/**
 * Đầu dò cho bài e2e (`?probe=1`): `window.__pascalProbe` đọc trạng thái cảnh Pascal mà
 * không cần chụp hình. Không có cờ thì không gắn gì. Thân đầu dò ở `./createProbe`.
 */
import { emitter, sceneRegistry, useInteractive, useScene } from '@pascal-app/core';
import { getSceneTheme, useViewer } from '@pascal-app/viewer';

import { installPascalProbe, type PascalProbe } from './createProbe';
import { currentRenderer } from './realism/backend';
import { setGrade } from './realism/grade';
import { markDirty } from './realism/idle';
import { setSurfaceNoise } from './realism/surfaceNoise';
import { DAY_THEME_ID, SUNSET_THEME_ID } from './renderLook';
import { sceneRepairStore } from './sceneRepairStore';

declare global {
  interface Window {
    __pascalProbe?: PascalProbe;
  }
}

installPascalProbe(window.location.search, window, {
  useScene,
  useViewer,
  sceneRegistry,
  emitter,
  useInteractive,
  repairs: () => sceneRepairStore.get().repairs,
  look: {
    surf: (v) => { setSurfaceNoise(v); markDirty('probe:look', 1500); },
    grade: (v) => { setGrade(v); markDirty('probe:look', 1500); },
    // Exposure được `ToneMappingExposure` đọc lại từ chủ đề mỗi khung → sửa cả ba chủ đề là đủ.
    exposure: (v) => {
      for (const id of ['night', DAY_THEME_ID, SUNSET_THEME_ID] as const) getSceneTheme(id).toneMappingExposure = v;
      const r = currentRenderer as { toneMappingExposure?: number } | undefined;
      if (r) r.toneMappingExposure = v;
      markDirty('probe:look', 1500);
    },
  },
});
