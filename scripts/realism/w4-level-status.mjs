/**
 * W4 (levelstatus): nhãn "Đang chuẩn bị tầng…" dưới bộ chọn tầng khi tầng vừa chọn chưa sẵn sàng — logic ở
 * `src/pascal-page/realism/levelWarmStatus.tsx` (đọc `levelReadiness()` của `levelWarm.ts`). `?disable=levelstatus` tắt.
 */
export const RULES = {
  'editor/src/components/ui/floating-level-selector.tsx': [
    [
      "import { markPerfAction, useViewer } from '@pascal-app/viewer'\n",
      "import { markPerfAction, useViewer } from '@pascal-app/viewer'\n" +
        "import { LevelWarmStatus } from '@pascal-realism/levelWarmStatus'\n",
    ],
    ['        <UnitFocusChip />\n      </div>\n', '        <UnitFocusChip />\n        <LevelWarmStatus levelId={levelId} />\n      </div>\n'],
  ],
};
