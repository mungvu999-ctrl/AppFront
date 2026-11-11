# AppFront decor items

Served at `/pascal/items/<folder>/` (copied by `scripts/copy-pascal-assets.mjs`).
Regenerate: `node scripts/gen-decor-models.mjs` (procedural) and
`node scripts/gen-decor-models.mjs --polyhaven <dir>` (Poly Haven 1k glTF -> GLB, Draco, textures 512 px webp).
Thumbnails are neutral icon cards with the item name (sharp, no 3D render).

| Folder | Source | License |
|---|---|---|
| curtain, pillow, throw-blanket, wall-sconce | procedural, `scripts/gen-decor-models.mjs` (AppFront) | project code |
| curtain-uv, pillow-uv, throw-blanket-uv | same generator with UV (`--uv-only`), used by `?drape=uv` | project code |
| ceramic-vase | https://polyhaven.com/a/ceramic_vase_01 | CC0 1.0 (Poly Haven) |
| ceramic-vase-slim | https://polyhaven.com/a/ceramic_vase_03 | CC0 1.0 (Poly Haven) |
| fancy-picture-frame | https://polyhaven.com/a/fancy_picture_frame_01 | CC0 1.0 (Poly Haven) |
| ottoman | https://polyhaven.com/a/Ottoman_01 | CC0 1.0 (Poly Haven) |
| sofa-ph | https://polyhaven.com/a/sofa_02 (2k glTF, textures -> 512 webp; B1b: diffuse lightened to light grey) | CC0 1.0 (Poly Haven) |
| armchair-ph | https://polyhaven.com/a/modern_arm_chair_01 (2k glTF, simplify 0.3, cushion diffuse lightened to light grey; B1b) | CC0 1.0 (Poly Haven) |
| dining-chair-ph | https://polyhaven.com/a/dining_chair_02 (homepage-audit `public/models/dining-chair.glb`) | CC0 1.0 (Poly Haven) |
| plant-ph | https://polyhaven.com/a/pachira_aquatica_01 (tallest of the 4 trees) in the pot + soil of https://polyhaven.com/a/potted_plant_02 (1k glTF, real `*_leaves_alpha_1k.png`; P1) | CC0 1.0 (Poly Haven) |
| planter-ph | https://polyhaven.com/a/potted_plant_02 (1k glTF, real `*_leaves_alpha_1k.png`; P1) | CC0 1.0 (Poly Haven) |
| bedside-table-ph | https://polyhaven.com/a/side_table_01 (1k glTF; review2 pack 2A) | CC0 1.0 (Poly Haven) |
| bookshelf-ph | https://polyhaven.com/a/wooden_display_shelves_01 (1k glTF, turned 90 deg about y; pack 2A) | CC0 1.0 (Poly Haven) |
| ceiling-lamp-ph | https://polyhaven.com/a/modern_ceiling_lamp_01 (1k glTF; pack 2A) | CC0 1.0 (Poly Haven) |
| picture-ph | https://polyhaven.com/a/hanging_picture_frame_02 (1k glTF; pack 2A) | CC0 1.0 (Poly Haven) |
| planter-long | https://polyhaven.com/a/planter_box_02 (stretched 1.9 x 0.9 x 1.4) + 3 copies of the foliage of https://polyhaven.com/a/potted_plant_02 (real `*_leaves_alpha_1k.png`; pack 2A) | CC0 1.0 (Poly Haven) |
| rug-nf | vendor Pascal `rectangular-carpet` with the fringe tabs removed (`scripts/realism-assets/carpet.mjs`; review2 pack 1) | same as vendor/pascal assets |
| closet-gen, kitchen-counter-gen, kitchen-cabinet-gen, kitchen-shelf-gen, tv-stand-gen | procedural, `scripts/realism-assets/cabinets.mjs` (AppFront; pack 4B, replace the Pascal box cabinets) | project code |

Downloaded 2026-10-21 from `https://api.polyhaven.com/files/<id>` -> `gltf.1k`.

editor-realism B1 (2026-10-23): `--polyhaven F:/App-review/homepage-v6/cinema/assets/models --glb <homepage-audit>/public/models --only sofa_02,Armchair_01,dining_chair_02`.
editor-realism B1b (2026-10-23): `--polyhaven F:/App-review/homepage-v6/cinema/assets/models --only sofa_02,modern_arm_chair_01`.
sofa-ph / dining-chair-ph have a single material (wood + fabric in one atlas); armchair-ph has two (legs, pillow). None is named `slot_*`: the colour is fixed and does not follow the scene style.
editor-realism P1 (2026-10-23): `node scripts/realism-assets/plants.mjs F:/tmp/ph-plants/dl` (Poly Haven 1k glTF downloads). Leaves = diffuse + the real alpha map (RGBA webp, MASK 0.5, double sided); triangles cut by dropping whole leaf islands (seeded shuffle) after a light meshopt pass, trunk/pot simplified. plant-ph 7.8k tris, planter-ph 4.8k tris.
editor-realism review2 pack 1 (2026-10-23): pillow/throw-blanket regenerated (roundedBox winding was inside-out); dining-chair-ph diffuse `linear(2.2, 10)` (`--only dining_chair_02`); rug-nf via `node scripts/realism-assets/carpet.mjs`.
editor-realism review2 pack 2A (2026-10-23): downloads in `F:/tmp/ph-pack2/<id>/` (1k glTF). `node scripts/gen-decor-models.mjs --polyhaven F:/tmp/ph-pack2 --only side_table_01,wooden_display_shelves_01,modern_ceiling_lamp_01,hanging_picture_frame_02`; `node scripts/realism-assets/planter-long.mjs F:/tmp/ph-pack2` (planter_box_02 + potted_plant_02; box 1.5k + 3 x 1.4k plants joined into one mesh per material = 5.7k tris; 5 plants cost the dGPU 7 -> 14-21 ms per frame).
editor-realism pack 4B (2026-10-24): `node scripts/realism-assets/cabinets.mjs` -> closet-gen / kitchen-counter-gen / kitchen-cabinet-gen / kitchen-sink-gen (2026-10-24, inox sink + faucet) / kitchen-shelf-gen / tv-stand-gen (bounding box = the Pascal box, slot names as the Pascal model + `slot_handle` dark metal, box-projected UV in metres).

## Sketchfab (CC BY 4.0 — ghi nguồn bắt buộc)

Tải 2026-10-24 bằng tài khoản Sketchfab của chủ dự án (bản glTF), chuyển bằng `node scripts/realism-assets/sketchfab.mjs <dlDir>` (xoay mặt trước +z, đổi về mét, giảm lưới, ảnh webp 512/1024). Đã sửa đổi: cắt phần thừa (tường mẫu, ghế của bàn ăn, 2 món khác của bộ tủ), giảm lưới; gói 6 (2026-10-24): đổi vật liệu spec/gloss sang metal/rough (giường), ép cabin tắm và bàn trà theo tỉ lệ ô của editor.

| Folder | Source | License |
|---|---|---|
| wardrobe-sf | "Modern Wardrobe IKEA Style (White colors)" by Igor Piotrowiak (@Relowsky) — https://sketchfab.com/3d-models/b1c75cea276f4239b65d08d34c5eabe5 | CC BY 4.0 (https://creativecommons.org/licenses/by/4.0/) |
| fridge-sf | "Refrigerator - Grey Polished Metal" by Glowbox 3D (@glowbox3d) — https://sketchfab.com/3d-models/2071bda681b642218b6829b82e4fd93b | CC BY 4.0 (https://creativecommons.org/licenses/by/4.0/) |
| toilet-sf | "Toilet" by HippoStance (@hippostance) — https://sketchfab.com/3d-models/132a8ee2af3a40d39d270fbed3d3666c | CC BY 4.0 (https://creativecommons.org/licenses/by/4.0/) |
| vanity-sf | "Designer vessel on wooden vanity unit" by attilakozma (@attilakozma) — https://sketchfab.com/3d-models/b0b478131827419c8965132a19eb8993 | CC BY 4.0 (https://creativecommons.org/licenses/by/4.0/) |
| dining-table-sf | "Dining Table Glass" by Francesco Coldesina (@topfrank2013) — https://sketchfab.com/3d-models/c41a27d7a1b24dc484bc603e1bc2d0ef | CC BY 4.0 (https://creativecommons.org/licenses/by/4.0/) |
| dresser-sf | "Cabinets and shelf IKEA style" by janexx (@janexx) — https://sketchfab.com/3d-models/a1a84be7512f4389af7fd7bbd7060c2f | CC BY 4.0 (https://creativecommons.org/licenses/by/4.0/) |
| tv-sf | "Flat Screen Television" by HippoStance (@hippostance) — https://sketchfab.com/3d-models/f90d4fb91dd34b6791e8d66d00f96591 | CC BY 4.0 (https://creativecommons.org/licenses/by/4.0/) |
| bed-sf | "Soho bed - 3D Model" by BertO (@bertosalotti) — https://sketchfab.com/3d-models/97e361e8beda4112ac5b1b5bcd388cdf | CC BY 4.0 (https://creativecommons.org/licenses/by/4.0/) |
| shower-sf | "Shower Cabin" by Heliona (@Heliona) — https://sketchfab.com/3d-models/e2c6a8dd490e4e4398378e1f6c9121a8 | CC BY 4.0 (https://creativecommons.org/licenses/by/4.0/) |
| hood-sf | "Range Hood (Kitchen Hood)" by govindu94 (@govindu94) — https://sketchfab.com/3d-models/e846cb48e88446808af55976ff76b1da | CC BY 4.0 (https://creativecommons.org/licenses/by/4.0/) |
| stove-sf | "IKEA Range with Gas Cooktop" by MUSHROOM_BUILDS (@MUSHROOM_BUILDS) — https://sketchfab.com/3d-models/0568b8cf6a8444099c55eab7ca1a7de0 | CC BY 4.0 (https://creativecommons.org/licenses/by/4.0/) |
| hob-sf | "IKEA Range with Gas Cooktop" (cooktop part only) by MUSHROOM_BUILDS (@MUSHROOM_BUILDS) — https://sketchfab.com/3d-models/0568b8cf6a8444099c55eab7ca1a7de0 | CC BY 4.0 (https://creativecommons.org/licenses/by/4.0/) |
| coffee-table-sf | "Simple Wooden Coffee Table – Game Asset" by AspectStudios (@AspectStudio) — https://sketchfab.com/3d-models/e80cccd7091049d2becc13384e218bc5 | CC BY 4.0 (https://creativecommons.org/licenses/by/4.0/) |
