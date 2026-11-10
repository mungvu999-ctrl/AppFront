import { describe, expect, it } from 'vitest';

import { thicknessGroupToken } from './thicknessGroupColor';

describe('thicknessGroupToken (#20)', () => {
  it('sáu bậc 100/150/200/220/300/400 cho sáu màu khác nhau', () => {
    const tokens = [100, 150, 200, 220, 300, 400].map(thicknessGroupToken);
    expect(new Set(tokens).size).toBe(6);
  });
});
