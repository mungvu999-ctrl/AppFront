import { afterEach, describe, expect, it, vi } from 'vitest';

import { DEFAULT_LOOK, parseLook } from './lookOverride';

afterEach(() => {
  vi.unstubAllGlobals();
  vi.resetModules();
});

describe('parseLook', () => {
  it('đọc tập con số hợp lệ', () => {
    expect(parseLook('?look=exposure:0.9,contrast:1.1,saturation:1.05,env:0.7,bloom:0.15')).toEqual({
      exposure: 0.9,
      contrast: 1.1,
      saturation: 1.05,
      env: 0.7,
      bloom: 0.15,
    });
    expect(parseLook('?x=1&look=envDark:0.4,bloom:0')).toEqual({ envDark: 0.4, bloom: 0 });
  });

  it('bỏ khoá lạ, số hỏng, âm, rỗng', () => {
    expect(parseLook('?look=foo:1,contrast:abc,env:-1,bloom:,saturation,exposure:Infinity,:2')).toEqual({});
    expect(parseLook('')).toEqual({});
  });
});

describe('lookOverride', () => {
  it('nhớ lần đọc đầu; đổi URL sau đó không đổi', async () => {
    vi.stubGlobal('location', { search: '?look=contrast:1.2' });
    const { lookOverride, withLookOverride } = await import('./lookOverride');
    const first = lookOverride();
    expect(first).toEqual({ contrast: 1.2 });
    vi.stubGlobal('location', { search: '?look=contrast:2' });
    expect(lookOverride()).toBe(first);
    expect(withLookOverride(DEFAULT_LOOK)).toEqual({ ...DEFAULT_LOOK, contrast: 1.2 });
  });

  it('không có location / không có ?look= → đúng mặc định', async () => {
    vi.stubGlobal('location', undefined);
    const { lookOverride, withLookOverride } = await import('./lookOverride');
    expect(lookOverride()).toEqual({});
    expect(withLookOverride(DEFAULT_LOOK)).toEqual(DEFAULT_LOOK);
    expect(withLookOverride({ exposure: 0.85 }).exposure).toBe(0.85);
  });
});
