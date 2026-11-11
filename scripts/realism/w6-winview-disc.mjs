/**
 * E-WINVIEW (vòng 10, `src/pascal-page/realism/winView.ts`): phần tan xa của đĩa chân trời (`site/renderer.tsx`) lấy
 * CÙNG phông với hậu kỳ (`hdriBackdrop`) thay vì gradient trần. Qua kính, nửa dưới chân trời là đĩa (800 m, che phông),
 * nên chỉ hạ `skyFloor` của phông không đủ: đĩa phải tan về cùng ảnh HDRI → không vạch ngang ở chân trời.
 * Không cờ: `skyFloor` = 0 và đĩa chỉ nhìn từ trên (dir.y < 0) → trọng số HDRI = 0, màu y như cũ. Có bầu trời
 * (`atmosphere`) giữ nguyên `fogRadiance`. Chạy sau `r9-daylight`/`r9h-horizon`/`r10-studio` (đĩa studio dùng cùng `backdrop`).
 */
export const RULES = {
  'nodes/src/site/renderer.tsx': [
    [
      "import { useEffect, useMemo, useRef } from 'react'",
      "import { useEffect, useMemo, useRef } from 'react'\nimport { hdriBackdrop } from '@pascal-realism/reflect'",
      1,
    ],
    ['      : backdropGradient({\n', '      : (hdriBackdrop as any)(viewDir, backdropGradient({\n', 1],
    ['          skyDeep: color(deepSkyColor(skyColor)),\n        })\n', '          skyDeep: color(deepSkyColor(skyColor)),\n        }))\n', 1],
  ],
};
