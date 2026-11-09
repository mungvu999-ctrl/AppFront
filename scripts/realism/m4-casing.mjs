/**
 * M4 làn 2: nẹp hai mặt tường + ốp lòng tường cho cửa đi. Logic ở `src/pascal-page/realism/casing.ts`
 * (một lưới gộp mỗi cửa, khe `frame`, `?disable=casing` tắt). Chèn ngay trước `syncDoorCutout` cuối
 * `updateDoorMesh` — sau mọi nhánh cánh cửa; ô trống (`openingKind: 'opening'`) đã `return` sớm nên
 * không nẹp. Bề dày lấy từ tường cha như `resolveOpeningCutoutProxyDepth`; tường cong/không phải tường → 0 → bỏ.
 */
export const RULES = {
  'viewer/src/systems/door/door-system.tsx': [
    [
      "import { getOpeningCutoutProxyDepth } from '../wall/opening-cutout-geometry'",
      "import { getOpeningCutoutProxyDepth } from '../wall/opening-cutout-geometry'\nimport { addDoorCasing } from '@pascal-realism/casing'",
      1,
    ],
    [
      '  syncDoorCutout(node, mesh)\n\n  // Guard: some degenerate',
      [
        '  {',
        '    const casingWall = node.parentId ? useScene.getState().nodes[node.parentId as AnyNodeId] : undefined',
        "    const casingWallT = casingWall?.type === 'wall' && !(casingWall as WallNode).curveOffset ? getWallThickness(casingWall as WallNode) : 0",
        '    addDoorCasing(mesh, frameMaterial, { width, height, openingShape }, casingWallT, applyWorldScaleBoxUVs)',
        '  }',
        '  syncDoorCutout(node, mesh)\n\n  // Guard: some degenerate',
      ].join('\n'),
      1,
    ],
  ],
};
