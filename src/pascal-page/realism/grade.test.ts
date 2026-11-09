import { describe, expect, it } from 'vitest';

import { GRADE_U, setGrade } from './grade';
import { DEFAULT_LOOK } from './lookOverride';

describe('grade: uniform chấm màu đổi lúc chạy', () => {
  it('mặc định theo DEFAULT_LOOK; setGrade đổi từng khoá, bỏ số hỏng', () => {
    expect(GRADE_U.contrast.value).toBe(DEFAULT_LOOK.contrast);
    expect(GRADE_U.saturation.value).toBe(DEFAULT_LOOK.saturation);
    setGrade({ contrast: 1.3 });
    expect(GRADE_U.contrast.value).toBe(1.3);
    expect(GRADE_U.saturation.value).toBe(DEFAULT_LOOK.saturation);
    setGrade({ contrast: -1, saturation: 0 });
    expect(GRADE_U.contrast.value).toBe(1.3);
    expect(GRADE_U.saturation.value).toBe(0);
  });
});
