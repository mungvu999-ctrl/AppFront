/**
 * Tầng ẩn không đổ bóng (09/11). "Tầng: từng tầng" (`levelMode: 'solo'`) ẩn mọi tầng trừ tầng đang chọn, nhưng Pascal giữ
 * các tầng PHÍA TRÊN ở lớp SHADOW_ONLY_LAYER (`resolveLevelVisibility` → `applyShadowOnly` trong `level-system.tsx`): đèn
 * mặt trời vẫn vẽ chúng vào shadow map, nên mặt đất và tầng đang xem có bóng xám hình tầng 2 mà người xem không thấy.
 * Sau: tầng ẩn là ẩn hẳn (`visible: false`, không shadow-only) — quyết định chung ở `isLevelShown`, cũng dùng cho nhãn
 * phòng (u40). Còn một bản sao logic cũ ở `glb-scene.tsx` (đường xem GLB đã nướng) — làn khác sở hữu, chưa đổi.
 */
const FILE = 'viewer/src/systems/level/level-utils.ts';

export const RULES = {
  [FILE]: [
    [
      "import { getLevelElevations, type LevelNode, sceneRegistry, useScene } from '@pascal-app/core'\n",
      "import { getLevelElevations, type LevelNode, sceneRegistry, useScene } from '@pascal-app/core'\n" +
        "import { isLevelShown } from '@/pascal-page/upstream/lib/level-shown'\n",
    ],
    [
      '  const hidden = levelMode === \'solo\' && hasSelectedLevel && !isSelected\n' +
        '  const shadowOnly = hidden && selectedIndex !== undefined && index > selectedIndex\n' +
        '  return { visible: shadowOnly || !hidden, shadowOnly }\n',
      '  return { visible: isLevelShown({ levelMode, hasSelectedLevel, isSelected }), shadowOnly: false }\n',
    ],
  ],
};
