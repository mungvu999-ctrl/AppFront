/**
 * W5 (cắt đồ theo node): truyền node Pascal vào `capItemMeshesForCut` (dòng do `r7-item-materials.mjs` chèn) để
 * phân loại theo dữ liệu node (`asset.attachTo`, `wallId`, `asset.dimensions` × `scale`) thay vì tên thư mục mẫu.
 * Tên `w5` để chạy SAU `r7`. Logic + cờ tắt `?disable=itemwhole` ở `src/pascal-page/realism/cutSync.ts`.
 */
export const RULES = {
  'nodes/src/item/renderer.tsx': [
    [
      '\n    capItemMeshesForCut(meshEntries.map((entry) => entry.mesh), node.asset.src)',
      '\n    capItemMeshesForCut(meshEntries.map((entry) => entry.mesh), node.asset.src, node)',
      1,
    ],
  ],
};
