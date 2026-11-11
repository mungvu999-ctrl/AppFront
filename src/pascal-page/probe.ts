/**
 * Đầu dò cho bài e2e (`?probe=1`): `window.__pascalProbe` đọc trạng thái cảnh Pascal mà
 * không cần chụp hình. Không có cờ thì không gắn gì. Thân đầu dò ở `./createProbe`.
 */
import { emitter, sceneRegistry, useInteractive, useScene } from '@pascal-app/core';
import { getSceneTheme, useViewer } from '@pascal-app/viewer';

import libraryQc from '@/lib/pascal/libraryQc.json';
import { libraryQcSwaps } from '@/lib/pascal/sceneVariety';

import { installPascalProbe, type PascalProbe } from './createProbe';
import { backendOf, currentRenderer } from './realism/backend';
import { setGrade } from './realism/grade';
import { markDirty } from './realism/idle';
import { setSurfaceNoise } from './realism/surfaceNoise';
import { activeTone, applyTone } from './realism/tone';
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
  layer: () => sceneRepairStore.get().layer,
  renderer: () => (currentRenderer ? { gl: currentRenderer, backend: backendOf(currentRenderer), tone: activeTone(currentRenderer) } : undefined),
  look: {
    surf: (v) => { setSurfaceNoise(v); markDirty('probe:look', 1500); },
    grade: (v) => { setGrade(v); markDirty('probe:look', 1500); },
    // `v` là phơi sáng của CHỦ ĐỀ (như `?look=exposure:`): `ToneMappingExposure` đọc lại từ chủ đề rồi `applyTone` nhân hệ
    // số tone (agx-cal ×0,92). Đặt renderer cũng qua `applyTone` để cùng một `v` ra cùng số trước và sau khi đổi chủ đề.
    exposure: (v) => {
      for (const id of ['night', DAY_THEME_ID, SUNSET_THEME_ID] as const) getSceneTheme(id).toneMappingExposure = v;
      const r = currentRenderer as { toneMapping: number; toneMappingExposure: number } | undefined;
      if (r) {
        r.toneMappingExposure = v;
        applyTone(r);
      }
      markDirty('probe:look', 1500);
    },
  },
});

// Công bố mẫu bị loại khỏi lựa chọn tự động và các lượt thay trong phiên (id món → {from, to, role}).
if (window.__pascalProbe) {
  Object.assign(window.__pascalProbe, {
    libraryQc: () => ({ rev: libraryQc.rev, excluded: Object.keys(libraryQc.excluded), swaps: Object.fromEntries(libraryQcSwaps()) }),
  });
}

// Luật cắt đồ (vòng 10, `cutSync.ts`): id món → { kind: whole|capped|plain, reason, bottom, top, whole, capped, src }.
// Nạp động để khối này tách khỏi phần import (cutSync vốn đã trong cùng gói, không thêm chunk).
if (window.__pascalProbe) {
  void import('./realism/cutSync').then(({ itemCutReport }) => {
    if (window.__pascalProbe) Object.assign(window.__pascalProbe, { itemCut: itemCutReport });
  });
}
