/**
 * U83: bo vien "re chuot" trong luc NGUOI DUNG DANG KEO mot vat / tay nam, khong chi khi xoay camera.
 *
 * Do 17/11 (F:/runs/editor-perf2/{fx1,fx3-*,rs1,ed1}): khung hinh cua editor KHONG bi chan boi so mesh
 * (an mot nua so mesh: encode 10,2 -> 9,4 ms, -8 %) cung khong boi so diem anh (buffer 1864x1080 ->
 * 652x378, tuc 1/8 so diem anh: khung p50 13,9 -> 13,9 ms, khong doi). No bi chan boi SO LUOT PASS:
 * ~0,2 ms CPU cho moi pass, 33-35 pass moi khung. Bo het hau ky (`?disable=postFx`, 35 -> 2 pass) dua
 * khung p50 tu 20,9 xuong 13,9 ms khi keo va 13,9 xuong 7,0 ms khi xoay (4 luot moi ben, dai khong phu nhau).
 *
 * `mergedOutline` chay hai nhom doc lap: nhom A (dang chon) va nhom B (dang re chuot), moi nhom mot
 * chuoi mask -> giam mau -> do canh -> lam mo x2 -> ghep, khoang 7-8 pass. Mã da co dung luat nay cho
 * xoay camera, kem chu thich "Hover outline is noise while orbiting ... skip its ~8 passes", nhung chi
 * noi vao `cameraDragging`.
 *
 * Store da san co `inputDragging` — chinh tai lieu cua no ghi "Conceptually a sibling of `cameraDragging`
 * — both mean 'user is dragging'". Cu keo tay nam tuong bat co nay suot cu keo
 * (editor/src/components/editor/handles/use-handle-drag.ts). Nen chi can noi them cai co da co.
 *
 * Giu nguyen: vien cua vat DANG CHON (nhom A) van ve binh thuong — nguoi dung van thay minh dang keo cai
 * gi. `?disable=hoverdrag` van tat ca hai nhanh nhu cu.
 */
const FILE = 'viewer/src/components/viewer/post-processing.tsx';

export const RULES = {
  [FILE]: [
    [
      `    // Hover outline is noise while orbiting (the pointer sweeps across items): skip its ~8 passes.
    if (resourcesRef.current?.outline && !HOVER_DURING_DRAG) {
      resourcesRef.current.outline.suppressSecondary = useViewer.getState().cameraDragging
    }`,
      `    // Hover outline is noise while orbiting (the pointer sweeps across items): skip its ~8 passes.
    // U83: cung la nhieu khi dang KEO mot vat / tay nam — \`inputDragging\` la co anh em cua
    // \`cameraDragging\` (xem tai lieu cua no trong store). Do 17/11: khung hinh cua editor bi chan boi
    // SO PASS, khong boi so mesh hay so diem anh, nen bo bot mot nhom vien la cach giam that su.
    if (resourcesRef.current?.outline && !HOVER_DURING_DRAG) {
      const viewerState = useViewer.getState()
      resourcesRef.current.outline.suppressSecondary =
        viewerState.cameraDragging || viewerState.inputDragging
    }`,
    ],
  ],
};
