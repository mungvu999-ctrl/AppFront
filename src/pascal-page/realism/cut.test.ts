import { describe, expect, it } from 'vitest';

import { Group, Plane, Vector3 } from 'three';

import {
  clippedAway,
  CUT_HEIGHT_M,
  cutPlaneY,
  isCutFaceMesh,
  LIFT_EASE_S,
  LIFT_HYSTERESIS_M,
  liftedCutY,
  lowCutActive,
  stepLift,
  WALL_BATCH_MESH_NAME,
  wantsLift,
} from './cut';

describe('cut', () => {
  it('điểm trên mặt cắt của nhóm tầng là phần không vẽ; dưới mặt cắt, hoặc ngoài nhóm: vẫn còn', () => {
    const level = Object.assign(new Group(), { isClippingGroup: true, clippingPlanes: [new Plane(new Vector3(0, -1, 0), 1)] });
    const wall = new Group();
    level.add(wall);

    expect(clippedAway(wall, new Vector3(0, 2, 0))).toBe(true);
    expect(clippedAway(wall, new Vector3(0, 0.5, 0))).toBe(false);
    expect(clippedAway(wall, undefined)).toBe(false);
    expect(clippedAway(new Group(), new Vector3(0, 2, 0))).toBe(false);
  });

  it('chỉ chế độ "cắt" bật cắt thấp; "cao đủ" và "thấp" giữ nguyên', () => {
    expect(lowCutActive('cutaway')).toBe(true);
    expect(lowCutActive('up')).toBe(false);
    expect(lowCutActive('down')).toBe(false);
    expect(lowCutActive('translucent')).toBe(false);
  });

  it('mặt cắt ở 1,0 m trên sàn tầng', () => {
    expect(CUT_HEIGHT_M).toBe(1);
    expect(cutPlaneY(0)).toBe(1);
    expect(cutPlaneY(3.2)).toBeCloseTo(4.2);
  });

  it('tô mặt cắt cho tường lẻ (kể cả vách) và lưới gộp tường, không cho cửa/đồ', () => {
    const walls = new Set(['w1', 'partition']);
    expect(isCutFaceMesh('partition', '', walls)).toBe(true);
    expect(isCutFaceMesh(undefined, WALL_BATCH_MESH_NAME, walls)).toBe(true);
    expect(isCutFaceMesh('door1', 'door', walls)).toBe(false);
    expect(isCutFaceMesh(undefined, 'item', walls)).toBe(false);
  });
});

describe('mặt cắt theo camera', () => {
  it('nâng khi mắt dưới trần, cắt lại chỉ khi quá trần + trễ', () => {
    expect(wantsLift(false, 1.6, 3)).toBe(true);
    expect(wantsLift(false, -1.7, 3)).toBe(true);
    expect(wantsLift(false, 3.2, 3)).toBe(false);
    expect(wantsLift(true, 3.2, 3)).toBe(true);
    expect(wantsLift(true, 3 + LIFT_HYSTERESIS_M + 0.01, 3)).toBe(false);
    expect(wantsLift(false, 20, 3.3)).toBe(false);
  });

  it('trượt tuyến tính trong LIFT_EASE_S, kẹp 0..1', () => {
    expect(stepLift(0, true, LIFT_EASE_S / 2)).toBeCloseTo(0.5);
    expect(stepLift(0.9, true, LIFT_EASE_S)).toBe(1);
    expect(stepLift(0.1, false, LIFT_EASE_S)).toBe(0);
    expect(stepLift(0.5, true, -1)).toBe(0.5);
  });

  it('độ cao mặt cắt đi từ sàn + 1 m tới trần', () => {
    expect(liftedCutY(3, 3.3, 0)).toBeCloseTo(cutPlaneY(3));
    expect(liftedCutY(3, 3.3, 1)).toBeCloseTo(6.3);
    expect(liftedCutY(0, 3, 0.5)).toBeCloseTo(2);
  });
});
