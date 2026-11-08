import { describe, expect, it } from 'vitest';
import { AO_DIRECT_HI, AO_DIRECT_LO, aoFactor, aoModeFor, type AoInput } from './ao';

const base: AoInput = { webGpu: true, postFx: true, shading: 'rendered', ssgiEnabled: false, search: '', traa: true };

describe('aoModeFor', () => {
  it('SSGI bật → AO của SSGI; SSGI tắt (mức low) → GTAO', () => {
    expect(aoModeFor({ ...base, ssgiEnabled: true })).toBe('ssgi');
    expect(aoModeFor(base)).toBe('gtao');
  });

  it('WebGL2, không hậu kỳ, không phải rendered → không AO', () => {
    expect(aoModeFor({ ...base, webGpu: false })).toBe('none');
    expect(aoModeFor({ ...base, postFx: false })).toBe('none');
    expect(aoModeFor({ ...base, shading: 'solid' })).toBe('none');
  });

  it('không TRAA (mức low / nền trong suốt → depth MSAA) → không GTAO', () => {
    expect(aoModeFor({ ...base, traa: false })).toBe('none');
    expect(aoModeFor({ ...base, traa: false, ssgiEnabled: true })).toBe('ssgi');
  });

  it('?disable=ao / gtao tắt GTAO', () => {
    expect(aoModeFor({ ...base, search: '?disable=ao' })).toBe('none');
    expect(aoModeFor({ ...base, search: '?disable=traa,gtao' })).toBe('none');
    expect(aoModeFor({ ...base, search: '?disable=traa' })).toBe('gtao');
  });
});

describe('aoFactor', () => {
  const albedo = 0.5;
  it('chỉ ambient (độ rọi thấp) → AO đủ', () => {
    expect(aoFactor(0.4, albedo * AO_DIRECT_LO * 0.5, albedo)).toBeCloseTo(0.4);
  });

  it('nắng trực tiếp (độ rọi cao) → không AO', () => {
    expect(aoFactor(0.4, albedo * AO_DIRECT_HI * 2, albedo)).toBeCloseTo(1);
  });

  it('vùng bóng Ban ngày (E ≈ 0,9: môi trường 0,8 + hemi 0,25 + ambient 0,1) → AO đủ', () => {
    expect(aoFactor(0.4, albedo * 0.9, albedo)).toBeCloseTo(0.4);
  });

  it('nắng Ban ngày trên sàn (E ≈ 2,9) → không AO', () => {
    expect(aoFactor(0.4, albedo * 2.9, albedo)).toBeCloseTo(1);
  });

  it('giữa hai ngưỡng → nằm giữa, tăng theo độ rọi', () => {
    const mid = aoFactor(0.4, albedo * ((AO_DIRECT_LO + AO_DIRECT_HI) / 2), albedo);
    expect(mid).toBeGreaterThan(0.4);
    expect(mid).toBeLessThan(1);
  });

  it('albedo đen không chia cho 0', () => {
    expect(Number.isFinite(aoFactor(0.4, 0.001, 0))).toBe(true);
    expect(aoFactor(0.4, 0.001, 0)).toBeCloseTo(0.4);
  });
});
