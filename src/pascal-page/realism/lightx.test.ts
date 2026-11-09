import { describe, expect, it } from 'vitest';
import { AgXToneMapping, NeutralToneMapping } from 'three';

import { LIGHTX_AMBIENT, LIGHTX_SUN_POSITION, lightxExposure, lightxTheme, lightxToneMapping, parseLightx } from './lightx';

const theme = () => ({
  appearance: 'light',
  ambient: { intensity: 0.1 },
  hemi: { intensity: 0.25 },
  lights: [{ position: [14, 14, 10] as [number, number, number], intensity: 3.2, castShadow: true }, { position: [0, 1, 0] as [number, number, number], intensity: 0.2 }],
});

describe('lightx', () => {
  it('đọc ?lightx= và bỏ khoá lạ', () => {
    expect([...parseLightx('?lightx=env,foo,ao')]).toEqual(['env', 'ao']);
    expect(parseLightx('').size).toBe(0);
  });
  it('tắt → giữ nguyên mọi giá trị', () => {
    const t = theme();
    expect(lightxTheme(t, false).lights[0]!.position).toEqual([14, 14, 10]);
    expect(lightxToneMapping(AgXToneMapping, false)).toBe(AgXToneMapping);
    expect(lightxExposure(0.85, false)).toBe(0.85);
  });
  it('sun: hạ nắng, nền thấp, chỉ một lần, bỏ chủ đề tối', () => {
    const t = lightxTheme(theme(), true);
    expect(t.lights[0]!.position).toEqual(LIGHTX_SUN_POSITION);
    expect(t.ambient.intensity).toBe(LIGHTX_AMBIENT);
    t.lights[0]!.intensity = 9;
    expect(lightxTheme(t, true).lights[0]!.intensity).toBe(9);
    const dark = { ...theme(), appearance: 'dark' };
    expect(lightxTheme(dark, true).lights[0]!.position).toEqual([14, 14, 10]);
  });
  it('tone: Neutral + phơi sáng thấp hơn', () => {
    expect(lightxToneMapping(AgXToneMapping, true)).toBe(NeutralToneMapping);
    expect(lightxExposure(1, true)).toBeLessThan(1);
  });
});
