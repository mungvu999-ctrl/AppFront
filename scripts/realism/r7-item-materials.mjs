/**
 * Thẻ M1 (bước 2): vật liệu đồ nội thất theo loại, thay lúc chạy.
 * Bọc `resolveItemMaterial` của item renderer bằng `tuneItemMaterial`
 * (src/pascal-page/realism/itemMaterials.ts, alias @pascal-realism). Bản gốc đổi tên
 * thành `resolveItemMaterialBase`; `materialOptions` mang thêm `src` để biết thư mục mẫu.
 * Cờ `flags.materials` tắt / textures=false → vật liệu y cũ.
 * Đồ cao quá mặt cắt thấp (`topM` > 1,0 m) qua `capTallItemMaterial`: ruột lộ qua mặt cắt tô màu nắp (U62).
 * Bộ nạp GLB đăng ký plugin spec/gloss (`registerItemLoaderPlugins`) — three 0.186 bỏ phần mở rộng này.
 */
const IMPORT = "import { capTallItemMaterial, registerItemLoaderPlugins, tuneItemMaterial } from '@pascal-realism/itemMaterials'\n";

const WRAPPER = `const resolveItemMaterial = (
  authoredMaterial: Material,
  slotId: string | null,
  curatedRef: string | undefined,
  opts: Parameters<typeof resolveItemMaterialBase>[3] & { src?: string; topM?: number },
): Material =>
  capTallItemMaterial(
    tuneItemMaterial(resolveItemMaterialBase(authoredMaterial, slotId, curatedRef, opts), {
      src: opts.src,
      slotId,
      ref: slotId != null ? (opts.nodeSlots?.[slotId] ?? curatedRef) : undefined,
      textures: opts.textures,
      donor: (ref: string) => resolveMaterialRef(ref, opts.sceneMaterials, opts.shading),
    }),
    opts.topM ?? 0,
  )

const resolveItemMaterialBase = (`;

// Neo chỉ dùng "\n" ở đầu (vendor có thể CRLF).
export const RULES = {
  'nodes/src/item/renderer.tsx': [
    ["\nimport { BlockFaceHostFrame } from '../shared/block-face-host'", '\n' + IMPORT + "import { BlockFaceHostFrame } from '../shared/block-face-host'", 1],
    ['\nconst resolveItemMaterial = (', '\n' + WRAPPER, 1],
    ['\n    const materialOptions = {', '\n    const materialOptions = {\n      src: node.asset.src,\n      topM: node.position[1] + node.asset.dimensions[1] * node.scale[1],', 1],
    ['\n  configureKtx2Support(loader, renderer)', '\n  configureKtx2Support(loader, renderer)\n  registerItemLoaderPlugins(loader)', 1],
  ],
};
