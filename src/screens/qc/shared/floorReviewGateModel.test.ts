/** @vitest-environment node */
import { describe, expect, it } from 'vitest';

import { createSampleBuilding } from '@/domain/spatial/__fixtures__/sampleBuilding';
import { normalizeSpatial } from '@/domain/spatial/normalize';
import { millimetres } from '@/domain/units/types';

import {
  floorPendingText,
  floorReviewConditionLabel,
  floorReviewGateOf,
  floorScaleStateOf,
  nextFloorOf,
  scaleImplausibleOf,
  scaleIsConfirmed,
} from './floorReviewGateModel';

const count = (reviewed: number, total: number) => ({ reviewed, total });

describe('floorReviewGateOf', () => {
  it('chỉ lớp bắt buộc đầu tiên chưa xong làm bước tiếp', () => {
    const gate = floorReviewGateOf({ walls: count(81, 81), objects: count(0, 12), rooms: count(0, 2) });

    expect(gate.layers.map(floorReviewConditionLabel)).toEqual(['Tường 81/81', 'Cửa 0/12', 'Phòng 0/2']);
    expect(gate.next?.key).toBe('objects');
  });

  it('tường và phòng trống thì chưa xong, cửa và nội thất trống thì xong', () => {
    const gate = floorReviewGateOf({ walls: count(0, 0), objects: count(0, 0), rooms: count(0, 0) });

    expect(gate.layers.map((layer) => layer.done)).toEqual([false, true, false]);
    expect(gate.next?.key).toBe('walls');
  });

  it('cả ba xong thì không còn bước duyệt', () => {
    expect(floorReviewGateOf({ walls: count(3, 3), objects: count(0, 0), rooms: count(2, 2) }).next).toBeNull();
  });
});

describe('scaleIsConfirmed', () => {
  it('tỷ lệ tạm hoặc chưa có tỷ lệ thì chưa kiểm', () => {
    expect(scaleIsConfirmed('unresolved', 23.1)).toBe(false);
    expect(scaleIsConfirmed(undefined, undefined)).toBe(false);
    expect(scaleIsConfirmed(undefined, 23.1)).toBe(true);
  });
});

describe('floorScaleStateOf', () => {
  it('máy đo được thì cần kiểm; mặc định dự án hoặc không có tỷ lệ thì thiếu; người đặt thì xong', () => {
    expect(floorScaleStateOf('unresolved', 'pipeline', 13.9)).toBe('check');
    expect(floorScaleStateOf('unresolved', undefined, 13.9)).toBe('check');
    expect(floorScaleStateOf('unresolved', 'project_default', 1)).toBe('missing');
    expect(floorScaleStateOf(undefined, undefined, undefined)).toBe('missing');
    expect(floorScaleStateOf(undefined, undefined, 13.9)).toBe('confirmed');
  });

  it('Codex P1: máy đo mà hình vô lý thì cũng là thiếu; người đã đặt thì vẫn xong', () => {
    expect(floorScaleStateOf('unresolved', 'pipeline', 13.9, true)).toBe('missing');
    expect(floorScaleStateOf(undefined, undefined, 13.9, true)).toBe('confirmed');
  });

  it('R9: theo scaleState; unresolved không bao giờ thành missing (tầng vẫn dựng 3D) trừ mặc định dự án / hình vô lý', () => {
    expect(floorScaleStateOf('unresolved', 'pipeline', 13.9, false, 'determined')).toBe('measured');
    expect(floorScaleStateOf('unresolved', 'pipeline', 4.73, false, 'estimated')).toBe('estimated');
    expect(floorScaleStateOf('unresolved', 'pipeline', 4.73, false, 'unresolved')).toBe('undetermined');
    expect(floorScaleStateOf('unresolved', 'project_default', 1, false, 'unresolved')).toBe('missing');
    expect(floorScaleStateOf('unresolved', 'pipeline', 4.73, true, 'determined')).toBe('missing');
    expect(floorScaleStateOf(undefined, undefined, 13.9, true, 'userCalibrated')).toBe('confirmed');
    expect(floorScaleStateOf('unresolved', 'pipeline', undefined, false, 'estimated')).toBe('missing');
  });
});

describe('scaleImplausibleOf', () => {
  it('tường thật thì không; co cả tầng 100 lần (tường < 50 mm, khung < 3 m) thì vô lý', () => {
    const sample = createSampleBuilding();
    const levelId = sample.levels[0]!.id;
    const shrink = (point: { x: number; y: number }) => ({ x: point.x / 100, y: point.y / 100 });
    const tiny = {
      ...sample,
      walls: sample.walls.map((wall) => ({
        ...wall,
        thicknessMm: millimetres(wall.thicknessMm * 0.01),
        centreline: { start: shrink(wall.centreline.start), end: shrink(wall.centreline.end) },
      })),
    };

    expect(scaleImplausibleOf(normalizeSpatial(sample), levelId)).toBe(false);
    expect(scaleImplausibleOf(normalizeSpatial(tiny), levelId)).toBe(true);
  });
});

describe('nextFloorOf', () => {
  const floors = [{ id: 'f1' }, { id: 'f2' }, { id: 'f3' }];

  it('tầng sau chưa xong trước, rồi vòng lại; hết thì null', () => {
    expect(nextFloorOf(floors, 'f2', () => false)?.id).toBe('f3');
    expect(nextFloorOf(floors, 'f2', (id) => id === 'f3')?.id).toBe('f1');
    expect(nextFloorOf(floors, 'f2', () => true)).toBeNull();
    expect(nextFloorOf([{ id: 'f1' }], 'f1', () => false)).toBeNull();
  });
});

describe('[UX-22] floorPendingText', () => {
  it('nói rõ số mục chưa duyệt và tỷ lệ chưa xác nhận', () => {
    const gate = floorReviewGateOf({ walls: count(3, 31), objects: count(0, 34), rooms: count(7, 7) });
    expect(floorPendingText(gate, 'check')).toBe('Còn 28 tường, 34 cửa và nội thất chưa duyệt; tỷ lệ chưa xác nhận');
  });

  it('xong cả và tỷ lệ đã xác nhận thì không nhắc', () => {
    const gate = floorReviewGateOf({ walls: count(5, 5), objects: count(0, 0), rooms: count(2, 2) });
    expect(floorPendingText(gate, 'confirmed')).toBeNull();
  });
});
