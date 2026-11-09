import { ACESFilmicToneMapping, AgXToneMapping, NeutralToneMapping } from 'three';
import { describe, expect, it } from 'vitest';

import { GRADE_U } from './grade';
import { activeTone, applyTone, parseTone, TONE_VARIANTS } from './tone';

const webgpu = { backend: { isWebGPUBackend: true } };
const webgl = { backend: { isWebGPUBackend: false } };
const gl = (exposure = 0.8) => ({ toneMapping: ACESFilmicToneMapping, toneMappingExposure: exposure });

describe('tone', () => {
  it('đọc ?tone=, bỏ giá trị lạ', () => {
    expect(parseTone('?tone=agx-cal&probe=1')).toBe('agx-cal');
    expect(parseTone('?tone=neutral')).toBe('neutral');
    expect(parseTone('?tone=foo')).toBeNull();
    expect(parseTone('?tone=toString')).toBeNull();
    expect(parseTone('')).toBeNull();
  });

  it('không cờ → không đụng renderer (baseline y hệt)', () => {
    expect(activeTone(webgpu, null, 'high')).toBeNull();
    const g = gl();
    applyTone(g, null);
    expect(g).toEqual(gl());
  });

  it('mức low hoặc WebGL2 → ACES phơi sáng gốc', () => {
    expect(activeTone(webgpu, 'agx', 'low')).toBe('aces');
    expect(activeTone(webgl, 'agx-cal', 'high')).toBe('aces');
    expect(activeTone(webgpu, 'agx', 'medium')).toBe('agx');
    const g = gl();
    applyTone(g, 'aces');
    expect(g).toEqual(gl());
  });

  it('agx giữ phơi sáng; neutral đổi tone map; agx-cal ×0,92 + bão hoà 1,10', () => {
    const a = gl();
    applyTone(a, 'agx');
    expect(a).toEqual({ toneMapping: AgXToneMapping, toneMappingExposure: 0.8 });
    const n = gl();
    applyTone(n, 'neutral');
    expect(n.toneMapping).toBe(NeutralToneMapping);
    const c = gl();
    applyTone(c, 'agx-cal');
    expect(c.toneMapping).toBe(AgXToneMapping);
    expect(c.toneMappingExposure).toBeCloseTo(0.8 * TONE_VARIANTS['agx-cal'].exposureScale);
    expect(GRADE_U.saturation.value).toBe(1.1);
  });
});
