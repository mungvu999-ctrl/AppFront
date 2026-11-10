/**
 * Thẻ M1 (bước 2): vật liệu đồ nội thất theo loại, thay lúc chạy.
 * Bọc `resolveItemMaterial` của item renderer bằng `tuneItemMaterial`
 * (src/pascal-page/realism/itemMaterials.ts, alias @pascal-realism). Bản gốc đổi tên
 * thành `resolveItemMaterialBase`; `materialOptions` mang thêm `src` để biết thư mục mẫu.
 * Cờ `flags.materials` tắt / textures=false → vật liệu y cũ.
 * Nắp cắt (U62): sau vòng gán vật liệu (và nhuộm vải của r10-fabric — chạy trước theo thứ tự tên tệp),
 * `capItemMeshesForCut` đổi TỪNG MESH vượt mặt cắt thấp (đỉnh hộp bao thế giới > sàn tầng + 1,0 m) sang biến thể có nắp
 * (clone riêng, cache theo vật liệu gốc; gốc dùng chung không bị vá). Effect phụ thuộc thêm vị trí/xoay/scale của node
 * → nâng đồ, xoay, đổi scale: nắp tính lại theo trạng thái thật.
 * Bộ nạp GLB đăng ký plugin spec/gloss (`registerItemLoaderPlugins`) — three 0.186 bỏ phần mở rộng này.
 */
const IMPORT =
  "import { registerItemLoaderPlugins, tuneItemMaterial } from '@pascal-realism/itemMaterials'\n" +
  "import { capItemMeshesForCut } from '@pascal-realism/cutSync'\n";

const WRAPPER = `const resolveItemMaterial = (
  authoredMaterial: Material,
  slotId: string | null,
  curatedRef: string | undefined,
  opts: Parameters<typeof resolveItemMaterialBase>[3] & { src?: string },
): Material =>
  tuneItemMaterial(resolveItemMaterialBase(authoredMaterial, slotId, curatedRef, opts), {
    src: opts.src,
    slotId,
    ref: slotId != null ? (opts.nodeSlots?.[slotId] ?? curatedRef) : undefined,
    textures: opts.textures,
    donor: (ref: string) => resolveMaterialRef(ref, opts.sceneMaterials, opts.shading),
  })

const resolveItemMaterialBase = (`;

const DEPS = '\n  }, [shading, textures, colorPreset, node.slots, sceneMaterials])';

// Neo chỉ dùng "\n" ở đầu (vendor có thể CRLF).
export const RULES = {
  'nodes/src/item/renderer.tsx': [
    ["\nimport { BlockFaceHostFrame } from '../shared/block-face-host'", '\n' + IMPORT + "import { BlockFaceHostFrame } from '../shared/block-face-host'", 1],
    ['\nconst resolveItemMaterial = (', '\n' + WRAPPER, 1],
    ['\n    const materialOptions = {', '\n    const materialOptions = {\n      src: node.asset.src,', 1],
    [
      DEPS,
      '\n    capItemMeshesForCut(meshEntries.map((entry) => entry.mesh))' +
        '\n  }, [shading, textures, colorPreset, node.slots, sceneMaterials, node.position, node.rotation, node.scale])',
      1,
    ],
    ['\n  configureKtx2Support(loader, renderer)', '\n  configureKtx2Support(loader, renderer)\n  registerItemLoaderPlugins(loader)', 1],
  ],
};
