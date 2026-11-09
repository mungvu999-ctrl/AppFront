/**
 * Tầng ẩn không đổ bóng (09/11). "Tầng: từng tầng" (`levelMode: 'solo'`) ẩn mọi tầng trừ tầng đang chọn, nhưng Pascal giữ
 * các tầng PHÍA TRÊN ở lớp SHADOW_ONLY_LAYER (`resolveLevelVisibility` → `applyShadowOnly` trong `level-system.tsx`): đèn
 * mặt trời vẫn vẽ chúng vào shadow map, nên mặt đất và tầng đang xem có bóng xám hình tầng 2 mà người xem không thấy.
 * Sau: tầng ẩn là ẩn hẳn (`visible: false`, không shadow-only) — quyết định chung ở `isLevelShown`, cũng dùng cho nhãn
 * phòng (u40). Đường xem GLB (`glb-scene.tsx`) đọc cùng `isLevelShown`, bỏ shadow-only, giữ ngoại lệ đi bộ (walkthrough
 * hiện cả toà: va chạm dựng từ mesh đang hiện). AppFront không import `GlbScene` — bản dựng production không có nó
 * (kiểm 09/11: chuỗi riêng của tệp không có trong `dist/`); vá để hai đường không lệch nếu có ai bật lại.
 */
const FILE = 'viewer/src/systems/level/level-utils.ts';
const GLB = 'viewer/src/components/viewer/glb-scene.tsx';
const IMPORT_SHOWN = "import { isLevelShown } from '@/pascal-page/upstream/lib/level-shown'\n";

const GLB_OLD = [
  '      // Solo: hidden levels above the soloed one keep casting shadows',
  "      // (shadow-caster-only); below-levels can't block the sun, so plain-hide.",
  '      const hidden =',
  "        !walkthroughMode && levelMode === 'solo' && Boolean(selectedLevel) && id !== selectedLevel",
  '      const castsWhileHidden = hidden && selectedIdx >= 0 && index > selectedIdx',
  '      if (castsWhileHidden) {',
  '        applyShadowOnly(node)',
  '        node.visible = true',
  '      } else {',
  '        clearShadowOnly(node)',
  '        node.visible = !hidden',
  '      }',
].join('\n');

const GLB_NEW = [
  '      // AppFront u70: same rule as the node path — a hidden level draws nothing, shadow included.',
  '      clearShadowOnly(node)',
  '      node.visible =',
  '        walkthroughMode ||',
  '        isLevelShown({ levelMode, hasSelectedLevel: Boolean(selectedLevel), isSelected: id === selectedLevel })',
].join('\n');

export const RULES = {
  [FILE]: [
    [
      "import { getLevelElevations, type LevelNode, sceneRegistry, useScene } from '@pascal-app/core'\n",
      "import { getLevelElevations, type LevelNode, sceneRegistry, useScene } from '@pascal-app/core'\n" + IMPORT_SHOWN,
    ],
    [
      '  const hidden = levelMode === \'solo\' && hasSelectedLevel && !isSelected\n' +
        '  const shadowOnly = hidden && selectedIndex !== undefined && index > selectedIndex\n' +
        '  return { visible: shadowOnly || !hidden, shadowOnly }\n',
      '  return { visible: isLevelShown({ levelMode, hasSelectedLevel, isSelected }), shadowOnly: false }\n',
    ],
  ],
  [GLB]: [
    [
      "import { applyShadowOnly, clearShadowOnly } from '../../lib/shadow-only'\n",
      "import { applyShadowOnly, clearShadowOnly } from '../../lib/shadow-only'\n" + IMPORT_SHOWN,
    ],
    ['    const selectedIdx = selectedLevel ? levels.findIndex((l) => l.id === selectedLevel) : -1\n', ''],
    [GLB_OLD, GLB_NEW],
  ],
};
