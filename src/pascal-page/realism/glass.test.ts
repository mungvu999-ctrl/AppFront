import { describe, expect, it } from 'vitest';
import { MeshStandardNodeMaterial } from 'three/webgpu';

import { GLASS_DEFAULT, glassVariant, isGlassCandidate, pickGlassMode } from './glass';

describe('glass (R10D)', () => {
  it('pickGlassMode: cờ URL A/B, tier low / WebGL luôn về vật liệu cũ', () => {
    expect(pickGlassMode(null, 'medium', 'webgpu')).toBe(GLASS_DEFAULT);
    expect(pickGlassMode('rác', 'high', 'webgpu')).toBe(GLASS_DEFAULT);
    expect(pickGlassMode('sheet', 'medium', 'webgpu')).toBe('sheet');
    expect(pickGlassMode('transmission', 'high', 'unknown')).toBe('transmission');
    expect(pickGlassMode('sheet', 'low', 'webgpu')).toBe('alpha');
    expect(pickGlassMode('transmission', 'medium', 'webgl')).toBe('alpha');
  });

  it('isGlassCandidate: chỉ Standard trong suốt mờ < 0,6 và bóng (không phải viền đồ chưa xác nhận)', () => {
    const base = { isMeshStandardNodeMaterial: true, transparent: true };
    expect(isGlassCandidate({ ...base, opacity: 0.25, roughness: 0.02 })).toBe(true);
    expect(isGlassCandidate({ ...base, opacity: 0.35, roughness: 0.8 })).toBe(false);
    expect(isGlassCandidate({ ...base, opacity: 0.8, roughness: 0.02 })).toBe(false);
    expect(isGlassCandidate({ ...base, transparent: false, opacity: 0.25, roughness: 0.02 })).toBe(false);
    expect(isGlassCandidate({ transparent: true, opacity: 0.25, roughness: 0.02 })).toBe(false);
  });

  it('glassVariant: không cờ → null (giữ kính vendor)', () => {
    const glass = new MeshStandardNodeMaterial({ transparent: true, opacity: 0.25, roughness: 0.02 });
    expect(glassVariant(glass)).toBeNull();
  });
});
