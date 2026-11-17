/**
 * U81: menu noi (Tim / Di chuyen / Nhan ban / Xoa) khong con CHAN chuot tren chinh vat vua chon,
 * va khong con DE LEN no.
 *
 * NGUYEN NHAN GOC (do 16/11, `impl-tools/u1-probe.mjs`): lop boc `<Html>` cua menu dat
 * `pointerEvents: 'auto'`, nen HOP cua no — neo ngay tren vat — nuot `pointerdown`.
 * `document.elementsFromPoint` tai tam vat dang chon tra ve `div` (lop boc menu) TRUOC `canvas`;
 * nhat ky cua selection-manager rong hoan toan khi nhan-giu tren vat da chon. Vi vay:
 *   - U1 "nhan-giu roi keo vat dang chon thi khong gi xay ra" KHONG phai do cong `directDrag`,
 *     ma do cu nhan khong bao gio toi canvas;
 *   - U2 "menu che vat" la cung mot loi: hop cua menu nam dung tren vat.
 * Day vi tri menu (translateY) chi sua phan NHIN THAY; `transform` khong doi layout nen hop van
 * o cho cu. Phai sua ca hai.
 *
 * SAU:
 *  1. Lop boc `<Html>` dat `pointerEvents: 'none'` → cu nhan di thang xuong canvas. An toan vi hai
 *     con duy nhat nhan chuot deu tu bat lai: `NodeActionMenu` (`pointer-events-auto` o goc) va hang
 *     nut nhanh (`pointer-events-auto mt-1 inline-flex`); cac lop phu khac da la `pointer-events-none`.
 *  2. Giu phan day menu len: nhin tu tren xuong, neo the gioi chieu vao GIUA vat nen menu che mon do
 *     (do 13/11: F:/runs/editor-perf/try5, try6). Moi khung do do cao CHIEU LEN MAN HINH cua hop bao;
 *     neu menu con cham vat thi day len bang `translateY` (px man hinh + nua chieu cao menu + 12 px le).
 *     Nhin phoi canh `needed` <= 0 → khong doi gi.
 */
const FILE = 'editor/src/components/editor/floating-action-menu.tsx';

export const RULES = {
  [FILE]: [
    // 1. Lớp bọc không nhận chuột — phần sửa thật của U1/U2.
    [
      `        <Html
          center
          style={{
            pointerEvents: 'auto',
            touchAction: 'none',
          }}`,
      `        <Html
          center
          style={{
            // U81: hộp của lớp bọc neo NGAY TRÊN vật đang chọn; để 'auto' thì nó nuốt pointerdown và
            // không cách nào bấm/kéo chính món đó. Hai con nhận chuột tự bật 'pointer-events-auto'.
            pointerEvents: 'none',
            touchAction: 'none',
          }}`,
    ],
    // 2. Đẩy menu lên cho khỏi che vật (giữ nguyên neo thế giới).
    [
      `    if (menuScaleRef.current) {
      const scale = getFloatingMenuScale(state.camera, groupRef.current.position)
      menuScaleRef.current.style.transform = \`scale(\${scale})\`
    }`,
      `    if (menuScaleRef.current) {
      const scale = getFloatingMenuScale(state.camera, groupRef.current.position)
      // U81: day menu len cho khong de len vat (nhin tu tren xuong, neo the gioi chieu vao giua vat).
      let liftPx = 0
      const menuObj = selectedId ? sceneRegistry.nodes.get(selectedId) : undefined
      if (menuObj && !_menuBox.setFromObject(menuObj).isEmpty()) {
        const h = state.size.height
        const toScreenY = (v) => ((-v.project(state.camera).y + 1) / 2) * h
        const anchorY = toScreenY(_menuProbe.copy(groupRef.current.position))
        let topY = Infinity
        for (let i = 0; i < 8; i += 1) {
          _menuProbe.set(
            i & 1 ? _menuBox.max.x : _menuBox.min.x,
            i & 2 ? _menuBox.max.y : _menuBox.min.y,
            i & 4 ? _menuBox.max.z : _menuBox.min.z,
          )
          topY = Math.min(topY, toScreenY(_menuProbe))
        }
        const needed = anchorY - topY + menuScaleRef.current.offsetHeight / 2 + 12
        if (Number.isFinite(needed) && needed > 0) liftPx = needed
      }
      menuScaleRef.current.style.transform = liftPx > 0 ? \`translateY(\${-liftPx}px) scale(\${scale})\` : \`scale(\${scale})\`
    }`,
    ],
    // Hai bien tam dung chung cho ca trang (nhu `_anchorBox`): khong cap phat moi khung.
    [
      'const _anchorBox = new THREE.Box3()',
      'const _anchorBox = new THREE.Box3()\nconst _menuBox = new THREE.Box3()\nconst _menuProbe = new THREE.Vector3()',
    ],
  ],
};
