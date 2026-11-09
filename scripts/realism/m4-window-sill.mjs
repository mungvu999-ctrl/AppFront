/**
 * M4 làn 2: bậu hai mặt cho cửa sổ chữ nhật. Logic ở `src/pascal-page/realism/casing.ts`
 * (`addWindowSill`, một lưới gộp mỗi cửa sổ, khe `frame`, `?disable=sill` tắt). Chèn đầu
 * `syncWindowCutout` — mọi nhánh kiểu cửa sổ của `updateWindowMesh` đều gọi nó cuối cùng, sau khi
 * đã xoá con cũ (giữ 'cutout'), nên dựng lại không nhân đôi. Ô trống (`openingKind: 'opening'`) bỏ.
 */
export const RULES = {
  'viewer/src/systems/window/window-system.tsx': [
    [
      "import { getOpeningCutoutProxyDepth } from '../wall/opening-cutout-geometry'",
      "import { getOpeningCutoutProxyDepth } from '../wall/opening-cutout-geometry'\nimport { addWindowSill } from '@pascal-realism/casing'",
      1,
    ],
    [
      'function syncWindowCutout(node: WindowNode, mesh: THREE.Mesh) {\n',
      [
        'function syncWindowCutout(node: WindowNode, mesh: THREE.Mesh) {',
        '  {',
        '    const sillWall = node.parentId ? useScene.getState().nodes[node.parentId as AnyNodeId] : undefined',
        "    const sillWallT = sillWall?.type === 'wall' && !(sillWall as WallNode).curveOffset ? getWallThickness(sillWall as WallNode) : 0",
        '    addWindowSill(mesh, baseMaterial, node, sillWallT, applyWorldScaleBoxUVs)',
        '  }',
        '',
      ].join('\n'),
      1,
    ],
  ],
};
