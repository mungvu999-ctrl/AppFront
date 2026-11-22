/**
 * U83: bỏ viền "rê chuột" trong lúc NGƯỜI DÙNG ĐANG KÉO một vật / tay nắm, không chỉ khi xoay camera.
 *
 * Đo 17/11 (F:/runs/editor-perf2/{fx1,fx3-*,rs1,ed1}): khung hình của editor KHÔNG bị chặn bởi số mesh
 * (ẩn một nửa số mesh: encode 10,2 → 9,4 ms, −8 %) cũng không bởi số điểm ảnh (buffer 1864×1080 →
 * 652×378, tức 1/8 số điểm ảnh: khung p50 13,9 → 13,9 ms, không đổi). Nó bị chặn bởi SỐ LƯỢT PASS:
 * ~0,2 ms CPU cho mỗi pass, 33–35 pass mỗi khung. Bỏ hết hậu kỳ (`?disable=postFx`, 35 → 2 pass) đưa
 * khung p50 từ 20,9 xuống 13,9 ms khi kéo và 13,9 xuống 7,0 ms khi xoay (4 lượt mỗi bên, dải không phủ nhau).
 * Số đo trên dGPU RTX 4050; iGPU chưa đo (L7-N01).
 *
 * `mergedOutline` chạy hai nhóm độc lập: nhóm A (đang chọn) và nhóm B (đang rê chuột), mỗi nhóm một
 * chuỗi mask → giảm mẫu → dò cạnh → làm mờ ×2 → ghép, khoảng 7–8 pass. Mã đã có đúng luật này cho
 * xoay camera, kèm chú thích "Hover outline is noise while orbiting ... skip its ~8 passes", nhưng chỉ
 * nối vào `cameraDragging`.
 *
 * Store đã sẵn có `inputDragging` — chính tài liệu của nó ghi "Conceptually a sibling of `cameraDragging`
 * — both mean 'user is dragging'". Cú kéo tay nắm tường bật cờ này suốt cú kéo
 * (editor/src/components/editor/handles/use-handle-drag.ts). Nên chỉ cần nối thêm cái cờ đã có.
 *
 * Giữ nguyên: viền của vật ĐANG CHỌN (nhóm A) vẫn vẽ bình thường — người dùng vẫn thấy mình đang kéo cái
 * gì. `?disable=hoverdrag` vẫn tắt cả hai nhánh như cũ.
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
    // U83: cũng là nhiễu khi đang KÉO một vật / tay nắm — \`inputDragging\` là cờ anh em của
    // \`cameraDragging\` (xem tài liệu của nó trong store). Đo 17/11: khung hình của editor bị chặn bởi
    // SỐ PASS, không bởi số mesh hay số điểm ảnh, nên bỏ bớt một nhóm viền là cách giảm thật sự.
    if (resourcesRef.current?.outline && !HOVER_DURING_DRAG) {
      const viewerState = useViewer.getState()
      resourcesRef.current.outline.suppressSecondary =
        viewerState.cameraDragging || viewerState.inputDragging
    }`,
    ],
  ],
};
