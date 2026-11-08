import { describe, expect, it } from 'vitest';

import { isLevelShown } from './level-shown';

describe('isLevelShown', () => {
  it('shows every level outside solo mode', () => {
    for (const levelMode of ['stacked', 'exploded', 'manual'] as const)
      expect(isLevelShown({ levelMode, hasSelectedLevel: true, isSelected: false })).toBe(true);
  });

  it('solo shows only the selected level, above and below alike', () => {
    expect(isLevelShown({ levelMode: 'solo', hasSelectedLevel: true, isSelected: true })).toBe(true);
    expect(isLevelShown({ levelMode: 'solo', hasSelectedLevel: true, isSelected: false })).toBe(false);
  });

  it('solo with nothing selected shows every level', () => {
    expect(isLevelShown({ levelMode: 'solo', hasSelectedLevel: false, isSelected: false })).toBe(true);
  });

  it('a level the author hid is never shown', () => {
    expect(isLevelShown({ levelMode: 'stacked', hasSelectedLevel: false, isSelected: false, nodeVisible: false })).toBe(false);
    expect(isLevelShown({ levelMode: 'solo', hasSelectedLevel: true, isSelected: true, nodeVisible: false })).toBe(false);
  });
});
