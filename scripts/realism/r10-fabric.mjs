/**
 * Render look B — S3 vải: sau khi item renderer gán xong vật liệu cho mọi mesh của món đồ,
 * nhuộm vật liệu vải có diện tích lớn nhất về màu vải bọc của phong cách
 * (`@pascal-realism/upholstery`, cờ `flags.materials`, textures=false → bỏ qua).
 * Vòng 11 b3: truyền thêm `node` (id + asset.src + slots) cho vật liệu vải dùng chung `?enable=fabricmat`.
 */
const IMPORT = "\nimport { applyUpholstery } from '@pascal-realism/upholstery'";

// Neo chỉ dùng "\n" ở đầu (vendor có thể CRLF).
export const RULES = {
  'nodes/src/item/renderer.tsx': [
    ["\nimport { useAnimations } from '@react-three/drei'", IMPORT + "\nimport { useAnimations } from '@react-three/drei'", 1],
    [
      '\n  }, [shading, textures, colorPreset, node.slots, sceneMaterials])',
      '\n    applyUpholstery(meshEntries.map((entry) => entry.mesh), textures, node)\n  }, [shading, textures, colorPreset, node.slots, sceneMaterials])',
      1,
    ],
  ],
};
