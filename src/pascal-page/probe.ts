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
  kick: () => markDirty('probe:screenOf', 500),
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

// E-WINVIEW (vòng 10, `winView.ts`): phông HDRI qua kính — { mode, gain, scope, loaded, active }.
if (window.__pascalProbe) {
  void import('./realism/winView').then(({ winViewReport }) => {
    if (window.__pascalProbe) Object.assign(window.__pascalProbe, { winView: winViewReport });
  });
}

// Rèm/vải sinh (vòng 10, `?drape=light,tall,uv`, sceneDressingDrape.ts): { flags, curtains: [{ id, heightMm, fabric, color }] }.
if (window.__pascalProbe) {
  void import('@/lib/pascal/sceneDressingDrape').then(({ drapeReport }) => {
    if (window.__pascalProbe) Object.assign(window.__pascalProbe, { drape: drapeReport });
  });
}

// Phối đồ (vòng 10, `?layout=toneall|hue`, `sceneHarmony.ts`): phòng → { usage, anchor{id,folder,h}, accent, items[{id,role,folder,accent,reason}] }.
// Rỗng khi không cờ `hue`. Nạp động để khối tách khỏi phần import (sceneVariety vốn đã trong gói).
if (window.__pascalProbe) {
  void import('@/lib/pascal/sceneVariety').then(({ harmonyReport }) => {
    if (window.__pascalProbe) Object.assign(window.__pascalProbe, { harmony: harmonyReport });
  });
}

// Gia hạn URL ký mẫu thư viện (vòng 10, `sceneLibrary.ts`): trạng thái số lần gia hạn / hết lượt.
// Tải thư viện theo trang (vòng 14): libraryLoad() → { pages, items, revision, restarts, ms, bytes, resolvedById, missingById }.
if (window.__pascalProbe) {
  void import('@/lib/pascal/sceneLibrary').then(({ assetRefreshStatus, libraryLoadStatus }) => {
    if (window.__pascalProbe) Object.assign(window.__pascalProbe, { assetRefresh: assetRefreshStatus, libraryLoad: libraryLoadStatus });
  });
}

// Đèn có nguồn + bóng trong phòng (vòng 11 b4, `?enable=lamprule`, `?enable=roomshadow`, `lampRule.ts`):
// { habitableWithSource, habitableTotal, fixtures, rooms[{name, anchors[{source, ref}]}], shadow{casters, mapSize, updates, lastUpdateMs, room} }.
if (window.__pascalProbe) {
  void import('./realism/lampRule').then(({ lampRuleReport }) => {
    if (window.__pascalProbe) Object.assign(window.__pascalProbe, { lampRule: lampRuleReport });
  });
}


// Bộ nội thất theo phòng (`roomSet.ts`): phòng → { anchor, items[{id, role, from (mẫu luật cũ), to, rule, cause, by, group,
// pool, rev, cost, why, rejects, top}] }. Rỗng khi cờ tắt. `cause`: selector / same / fallback / pinned (vòng 14).
// `roomSetPools()`: vai → mẫu thư viện thấy được (so hai lượt để tách A catalog / B asset mới / C bộ chọn, DESIGN §2.7).
if (window.__pascalProbe) {
  void import('@/lib/pascal/sceneVariety').then(({ roomSetPools, roomSetReport, roomSetTiming }) => {
    if (window.__pascalProbe) Object.assign(window.__pascalProbe, { roomSet: roomSetReport, roomSetTiming, roomSetPools });
  });
}

// Vai thư viện mở rộng (vòng 11 b2, `?enable=libroles2`, `libraryRoles2.ts`):
// { on, default, pools, loaded, swaps{id→{variant, from, to}}, flat{before, after} — số món sinh dùng mẫu Pascal 0 texture theo vai }.
if (window.__pascalProbe) {
  void import('@/lib/pascal/libraryRoles2').then(({ libRoles2Report }) => {
    if (window.__pascalProbe) Object.assign(window.__pascalProbe, { libroles2: () => libRoles2Report(Object.values(useScene.getState().nodes)) });
  });
}
