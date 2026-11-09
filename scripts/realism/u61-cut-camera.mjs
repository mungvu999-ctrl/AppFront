/**
 * U61: mặt cắt "Tường: cắt" theo camera. Chạy sau `r10-cut` + `r11-baked` (neo là chuỗi chúng đã chèn vào
 * `LowCutSystem`): truyền vị trí camera và cao tầng (`level.height`) cho `syncLowCut` — mắt thấp hơn trần một tầng
 * thì tầng ấy thôi cắt (tường đủ cao, trần hiện), lên cao lại thì cắt 1,0 m. Logic: `wantsLift`/`stepLift` ở
 * `src/pascal-page/realism/cut.ts`, phần chạy ở `cutSync.ts`.
 */
export const RULES = {
  'nodes/src/wall/system.tsx': [
    [
      'const LowCutSystem = () => {\n',
      'const lowCutStorey = (id: string) => (useScene.getState().nodes as Record<string, { height?: number }>)[id]?.height\n' +
        'const LowCutSystem = () => {\n',
    ],
    [
      '    syncLowCut(sceneRegistry, useViewer.getState().wallMode)\n',
      '    syncLowCut(sceneRegistry, useViewer.getState().wallMode, { eye: state.camera.position, storeyHeight: lowCutStorey })\n',
    ],
  ],
};
