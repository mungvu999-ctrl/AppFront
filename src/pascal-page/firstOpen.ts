/**
 * Gieo dáng mở đầu (tô `rendered`, chủ đề tối) cho lần mở đầu tiên. Phải chạy trước khi React
 * vẽ: `<Viewer>` đọc `shadingByContext` lúc gắn. Thân ở `./applyFirstOpenLook`.
 *
 * Cùng lúc mở: ý định từ đường dẫn (`?view=exploded`, `?tool=measure`, `?panel=export|snapshot|settings`) — thân ở `./urlIntent`.
 */
import { sceneRegistry, useScene } from '@pascal-app/core';
import { useEditor } from '@pascal-app/editor';
import { useViewer } from '@pascal-app/viewer';

import { applyFirstOpenLook } from './applyFirstOpenLook';
import { postPascalNotice } from './bridge';
import { sceneTrace } from './createProbe';
import { runFullGlbExport } from './exportFullGlb';
import { applyUrlIntent } from './urlIntent';

/** Đủ điều kiện xuất: bộ xuất đã gắn, nguồn thư viện đã chốt, mọi đồ đã tải xong hoặc hỏng hẳn. */
const isExportReady = (): boolean =>
  useEditor.getState().modelExport !== null &&
  sceneTrace.settled() &&
  Object.entries(useScene.getState().nodes).every(
    ([id, node]) =>
      (node as { type?: string }).type !== 'item' ||
      (sceneRegistry.nodes.get(id) as { userData?: { itemModelSettled?: boolean } } | undefined)?.userData
        ?.itemModelSettled === true,
  );

applyFirstOpenLook(useViewer, () => window.localStorage);

applyUrlIntent(window.location.search, {
  scene: useScene,
  notify: postPascalNotice,
  explodeLevels: () => useViewer.getState().setLevelMode('exploded'),
  // Cùng các bước nút "Đo" của Pascal (`measurement-control.tsx` › `activateMeasurement`).
  startMeasure: () => {
    const editor = useEditor.getState();
    editor.setPhase('structure');
    editor.setStructureLayer('elements');
    editor.setMode('build');
    editor.setTool('measurement');
  },
  // K-23: chỉ mở tab Cài đặt (nút Xuất OBJ nằm ở đó).
  openSettings: () => useEditor.getState().setActiveSidebarPanel('settings'),
  // K-22: tab Cài đặt + GLB đầy đủ bằng `modelExport` (cùng đường nướng ánh sáng).
  openExport: () => {
    runFullGlbExport({
      isReady: isExportReady,
      exportGlb: async () => (await useEditor.getState().modelExport?.('glb')) ?? null,
      openSettings: () => useEditor.getState().setActiveSidebarPanel('settings'),
      notify: postPascalNotice,
    });
  },
});
