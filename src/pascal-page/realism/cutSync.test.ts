import { BackSide, DoubleSide, Group, MeshStandardMaterial, type Plane } from 'three';
import { MeshStandardNodeMaterial } from 'three/webgpu';
import { describe, expect, it } from 'vitest';

import { cutPlaneY } from './cut';
import { capCutMaterial, cutOn, lowCutOn, NO_CUT_CONSTANT, syncLowCut } from './cutSync';

type ClipLevel = Group & { isClippingGroup?: boolean; enabled?: boolean; clippingPlanes?: Plane[]; clipIntersection?: boolean; clipShadows?: boolean };

describe('cutSync: đổi chế độ không đổi khoá dựng của three', () => {
  it('nhóm tầng luôn bật, một mặt phẳng; Cắt ↔ Đầy đủ chỉ dời hằng số', () => {
    const level = new Group() as ClipLevel;
    level.position.y = 3;
    level.updateMatrixWorld();
    const registry = { nodes: { get: (id: string) => (id === 'L1' ? level : undefined) }, byType: { level: new Set(['L1']) } };

    syncLowCut(registry, 'up');
    expect(level.enabled).toBe(true);
    const plane = level.clippingPlanes?.[0];
    expect(plane?.constant).toBe(NO_CUT_CONSTANT);

    syncLowCut(registry, 'cutaway');
    syncLowCut(registry, 'up');
    syncLowCut(registry, 'cutaway');
    const fields = () => [level.isClippingGroup, level.enabled, level.clippingPlanes?.length, level.clipIntersection, level.clipShadows];
    const before = fields();
    expect(level.clippingPlanes?.[0]).toBe(plane);
    expect(plane?.constant).toBe(cutPlaneY(3));
    expect(cutOn.value).toBe(1);

    syncLowCut(registry, 'up');
    expect(fields()).toEqual(before);
    expect(before).toEqual([true, true, 1, false, true]);
    expect(level.clippingPlanes?.[0]).toBe(plane);
    expect(plane?.constant).toBe(NO_CUT_CONSTANT);
    expect(cutOn.value).toBe(0);
  });

  it('vá nắp một lần lúc tạo: hai mặt cố định, bóng giữ phía cũ; đổi chế độ không needsUpdate', () => {
    const material = new MeshStandardNodeMaterial();
    expect(capCutMaterial(material)).toBe(material);
    expect(material.side).toBe(DoubleSide);
    expect(material.shadowSide).toBe(BackSide);
    const colorNode = material.colorNode;
    expect(colorNode).not.toBeNull();
    const version = material.version;

    syncLowCut({ nodes: { get: () => undefined }, byType: {} }, 'cutaway');
    syncLowCut({ nodes: { get: () => undefined }, byType: {} }, 'up');
    capCutMaterial(material);
    expect(material.version).toBe(version);
    expect(material.colorNode).toBe(colorNode);

    const glass = new MeshStandardNodeMaterial({ transparent: true });
    capCutMaterial(glass);
    expect(glass.side).not.toBe(DoubleSide);
    const plain = new MeshStandardMaterial();
    capCutMaterial(plain);
    expect(plain.side).not.toBe(DoubleSide);
  });

  it('theo camera: mắt 1,6 m trong tầng → trượt lên trần rồi thôi cắt; lên cao → cắt lại; không lật enabled', () => {
    const level = new Group() as ClipLevel;
    level.updateMatrixWorld();
    const registry = { nodes: { get: () => level }, byType: { level: new Set(['L0']) } };
    const eye = { y: 30 };
    const view = { eye, storeyHeight: () => 3 };
    syncLowCut(registry, 'cutaway', view, 0);
    const plane = level.clippingPlanes?.[0];
    expect(plane?.constant).toBe(cutPlaneY(0));
    expect(cutOn.value).toBe(1);

    eye.y = 1.6;
    syncLowCut(registry, 'cutaway', view, 100);
    expect(plane?.constant).toBeGreaterThan(cutPlaneY(0));
    expect(plane?.constant).toBeLessThan(3);
    for (let t = 200; t <= 600; t += 50) syncLowCut(registry, 'cutaway', view, t);
    expect(plane?.constant).toBe(NO_CUT_CONSTANT);
    expect(cutOn.value).toBe(0);

    eye.y = 3.3; // trong khoảng trễ: vẫn không cắt
    syncLowCut(registry, 'cutaway', view, 650);
    expect(plane?.constant).toBe(NO_CUT_CONSTANT);

    eye.y = 12;
    for (let t = 700; t <= 1200; t += 50) syncLowCut(registry, 'cutaway', view, t);
    expect(plane?.constant).toBe(cutPlaneY(0));
    expect(cutOn.value).toBe(1);
    expect(level.clippingPlanes?.[0]).toBe(plane);
    expect([level.enabled, level.clippingPlanes?.length]).toEqual([true, 1]);
  });

  it('tầng ẩn còn cắt không bật nắp chung: xem tầng 2 từ trong nhà → cutOn = 0, tầng 1 ẩn vẫn dời mặt phẳng', () => {
    const ground = new Group() as ClipLevel;
    const upper = new Group() as ClipLevel;
    upper.position.y = 3;
    ground.updateMatrixWorld();
    upper.updateMatrixWorld();
    ground.visible = false; // "Tầng: từng tầng" đang xem tầng 2
    const levels: Record<string, Group> = { L1: ground, L2: upper };
    const registry = { nodes: { get: (id: string) => levels[id] }, byType: { level: new Set(['L1', 'L2']) } };
    const view = { eye: { y: 4.6 }, storeyHeight: () => 3 }; // mắt 1,6 m trên sàn tầng 2
    syncLowCut(registry, 'cutaway', view, 0);
    expect(upper.clippingPlanes?.[0]?.constant).toBe(NO_CUT_CONSTANT);
    expect(ground.clippingPlanes?.[0]?.constant).toBe(cutPlaneY(0));
    expect(cutOn.value).toBe(0);
    expect(lowCutOn()).toBe(false);

    ground.visible = true; // "Tầng: chồng": tầng 1 còn cắt đang hiện → nắp bật
    syncLowCut(registry, 'cutaway', view, 50);
    expect(cutOn.value).toBe(1);
    expect(lowCutOn()).toBe(true);
  });
});
