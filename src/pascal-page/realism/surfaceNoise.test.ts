import { MeshStandardMaterial } from 'three';
import { MeshPhysicalNodeMaterial, MeshStandardNodeMaterial } from 'three/webgpu';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { tuneFloorFinish } from './floorFinish';
import { DEFAULT_REALISM_FLAGS, useRealism } from './store';
import { APPLIED_KEY, applySurfaceNoise, surfaceNoiseDisabled } from './surfaceNoise';
import { tuneWallPaint } from './wallFinish';

const setMaterials = (materials: boolean) => useRealism.setState({ flags: { ...DEFAULT_REALISM_FLAGS, materials } });

describe('biến thiên bề mặt', () => {
  afterEach(() => {
    setMaterials(DEFAULT_REALISM_FLAGS.materials);
    window.history.replaceState(null, '', '/');
  });

  it('gắn roughness + màu một lần; gọi lại không tạo node mới', () => {
    const mat = new MeshStandardNodeMaterial({ roughness: 0.9 });
    expect(applySurfaceNoise(mat, { albedo: true })).toBe(mat);
    const { roughnessNode, colorNode } = mat;
    expect(roughnessNode).toBeTruthy();
    expect(colorNode).toBeTruthy();
    applySurfaceNoise(mat, { albedo: true });
    expect(mat.roughnessNode).toBe(roughnessNode);
    expect(mat.colorNode).toBe(colorNode);
  });

  it('bỏ qua kính/trong suốt, vật liệu không phải node, không có roughness', () => {
    const glass = new MeshPhysicalNodeMaterial({ roughness: 0.1, transparent: true });
    applySurfaceNoise(glass);
    expect(glass.roughnessNode).toBeNull();
    const classic = new MeshStandardMaterial({ roughness: 0.9 });
    applySurfaceNoise(classic);
    expect(classic.userData[APPLIED_KEY]).toBeUndefined();
  });

  it('tường: clone cache mang nhiễu, vật liệu vendor không đổi; gọi lại trả cùng clone', () => {
    setMaterials(true);
    const paint = new MeshStandardNodeMaterial({ roughness: 0.9 });
    const tuned = tuneWallPaint(paint) as MeshStandardNodeMaterial;
    expect(tuned).not.toBe(paint);
    expect(tuned.roughnessNode).toBeTruthy();
    expect(paint.roughnessNode).toBeNull();
    expect(paint.userData[APPLIED_KEY]).toBeUndefined();
    const node = tuned.roughnessNode;
    expect(tuneWallPaint(paint)).toBe(tuned);
    expect(tuned.roughnessNode).toBe(node);
  });

  it('sàn: chỉ thêm roughness, colorNode giữ của sàn', () => {
    setMaterials(true);
    const floor = new MeshStandardNodeMaterial({ roughness: 0.6 });
    tuneFloorFinish('library:flooring-statuarettowhite', floor);
    expect(floor.roughnessNode).toBeTruthy();
    expect(floor.userData[APPLIED_KEY]).toBe(true);
  });

  it('?disable=surfnoise → không gắn gì', async () => {
    expect(surfaceNoiseDisabled('?disable=ao,surfnoise')).toBe(true);
    expect(surfaceNoiseDisabled('?disable=ao')).toBe(false);
    window.history.replaceState(null, '', '/?disable=surfnoise');
    vi.resetModules();
    const fresh = await import('./surfaceNoise');
    const mat = new MeshStandardNodeMaterial({ roughness: 0.9 });
    fresh.applySurfaceNoise(mat, { albedo: true });
    expect(mat.roughnessNode).toBeNull();
    expect(mat.colorNode).toBeNull();
  });
});
