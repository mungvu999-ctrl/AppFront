import { Group, MeshBasicMaterial } from 'three';
import { describe, expect, it } from 'vitest';

import {
  addDoorCasing,
  addWindowSill,
  CASING_MESH_NAME,
  CASING_PROUD_M,
  CASING_W_M,
  casingBoxes,
  casingDisabled,
  casingGeometry,
  SILL_MESH_NAME,
  SILL_NOSE_M,
  windowSillBoxes,
} from './casing';

describe('casing', () => {
  it('nẹp hai mặt nằm ngoài mặt tường, ôm ô cửa; ốp lòng đủ bề dày tường', () => {
    const boxes = casingBoxes(0.9, 2.1, 0.2);
    expect(boxes).toHaveLength(9);
    const faces = boxes.filter(([, , d]) => d === CASING_PROUD_M);
    expect(faces).toHaveLength(6);
    for (const [, , d, , , z] of faces) expect(Math.abs(z) - d / 2).toBeCloseTo(0.1, 6);
    const head = faces.find(([w]) => w > 0.9)!;
    expect(head[4] + CASING_W_M / 2).toBeGreaterThan(2.1 / 2); // đầu nẹp trên đỉnh ô
    const linings = boxes.filter(([, , d]) => d === 0.2);
    expect(linings).toHaveLength(3);
  });

  it('tường mỏng / ô suy biến → không nẹp', () => {
    expect(casingBoxes(0.9, 2.1, 0.04)).toEqual([]);
    expect(casingBoxes(0, 2.1, 0.2)).toEqual([]);
    expect(casingGeometry([])).toBeNull();
  });

  it('gộp một lưới mỗi cửa, dựng lại do vendor xoá con cũ', () => {
    const g = new Group();
    addDoorCasing(g, new MeshBasicMaterial(), { width: 0.9, height: 2.1 }, 0.2);
    expect(g.children.map((c) => c.name)).toEqual([CASING_MESH_NAME]);
    addDoorCasing(g, new MeshBasicMaterial(), { width: 0.9, height: 2.1, openingShape: 'arch' }, 0.2);
    expect(g.children).toHaveLength(1);
  });

  it('?disable=casing', () => {
    expect(casingDisabled('?disable=warm,casing')).toBe(true);
    expect(casingDisabled('?disable=warm')).toBe(false);
  });

  it('bậu hai mặt nhô khỏi tường, bỏ cửa sát sàn', () => {
    const boxes = windowSillBoxes(1.2, 1.4, 0.2, 0.07);
    expect(boxes).toHaveLength(2);
    for (const [, , d, , , z] of boxes) expect(Math.abs(z) + d / 2).toBeCloseTo(0.1 + SILL_NOSE_M, 6);
    const g = new Group();
    addWindowSill(g, new MeshBasicMaterial(), { width: 1.2, height: 1.4, frameDepth: 0.07, position: [1, 1.6, 0] }, 0.2);
    expect(g.children.map((c) => c.name)).toEqual([SILL_MESH_NAME]);
    addWindowSill(g, new MeshBasicMaterial(), { width: 1.2, height: 2.2, frameDepth: 0.07, position: [1, 1.1, 0] }, 0.2);
    expect(g.children).toHaveLength(1);
  });
});
