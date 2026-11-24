/**
 * U80: nhan-giu roi keo tren vat DANG CHON thi DOI VAT, khong con roi vao xoay camera / khong lam gi.
 *
 * Truoc: `shouldStartDirectMoveDrag` chi cho keo thang khi loai node khai `capabilities.movable.directDrag`
 * (chi cabinet + procedural-item). Do nguoi dung (13/11, F:/runs/editor-perf/u1-table): nhan-giu tren ghe
 * hoac ban DA CHON roi keo thi mon dung yen; o goc nhin phoi canh thi camera xoay. Muon doi mon phai bam
 * lan hai (click-to-move) hoac nut "Di chuyen" cua menu noi — khong ai doan duoc.
 *
 * Sau: mon DANG CHON va la vat duy nhat dang chon thi nhan-giu + vuot nguong (DIRECT_DRAG_THRESHOLD_PX)
 * bat dau doi vat. Bam tren nen hay tren vat CHUA chon van xoay camera nhu cu (u20), vi nhanh nay chi
 * chay khi `selectedIds` da chua dung node do.
 *
 * Giu nguyen: `handleOwnsPointer` (tay nam resize/xoay) van thang; phim lenh (Ctrl/Cmd) khong doi;
 * chon nhieu (>= 2) khong keo thang.
 */
const FILE = 'editor/src/lib/direct-manipulation.ts';

export const RULES = {
  [FILE]: [
    [
      `  if (handleOwnsPointer) return false
  if (commandModifier) return selectedIds.length === 1 && selectedIds[0] === nodeId
  return allowPlainDrag && selectedIds.length < 2`,
      `  if (handleOwnsPointer) return false
  if (commandModifier) return selectedIds.length === 1 && selectedIds[0] === nodeId
  // U80: vat dang chon (va chi mot vat) keo thang duoc, khong can kha nang \`directDrag\` cua loai node.
  if (selectedIds.length === 1 && selectedIds[0] === nodeId) return true
  return allowPlainDrag && selectedIds.length < 2`,
    ],
  ],
};
