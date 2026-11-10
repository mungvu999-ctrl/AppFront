/**
 * Gieo dáng mở đầu (tô `rendered`, chủ đề tối) cho lần mở đầu tiên. Phải chạy trước khi React
 * vẽ: `<Viewer>` đọc `shadingByContext` lúc gắn. Thân ở `./applyFirstOpenLook`.
 *
 * Cùng lúc mở: ý định từ đường dẫn cũ (`?view=exploded`, `?tool=measure`) — thân ở `./urlIntent`.
 */
import { useScene } from '@pascal-app/core';
import { useEditor } from '@pascal-app/editor';
import { useViewer } from '@pascal-app/viewer';

import { applyFirstOpenLook } from './applyFirstOpenLook';
import { postPascalNotice } from './bridge';
import { applyUrlIntent } from './urlIntent';

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
});
