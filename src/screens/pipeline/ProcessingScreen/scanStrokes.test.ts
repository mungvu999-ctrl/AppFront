/** @vitest-environment node */
import { describe, expect, it } from 'vitest';

import { appendArrived, partialPoints, sweepOrder, toPathData, type ScanStroke } from './scanStrokes';

const wall = (x: number, y: number): ScanStroke => ({
  kind: 'wall',
  points: [
    [x, y],
    [x + 10, y],
  ],
});

const DOOR = { label: 'door', xMin: 0, yMin: 0, xMax: 2, yMax: 2 };

describe('scanStrokes', () => {
  it('đi theo dải và đảo chiều ở dải sau', () => {
    const ordered = sweepOrder([wall(50, 150), wall(0, 150), wall(50, 0), wall(0, 0)], 800);
    expect(ordered.map((stroke) => stroke.points[0]?.[0])).toEqual([0, 50, 50, 0]);
  });

  it('bước về sau nối đuôi, gọi lại không nhân đôi', () => {
    const results = { walls: [{ x1: 0, y1: 0, x2: 1, y2: 0 }], boxes: [] };
    const first = appendArrived([], results, 100);
    expect(appendArrived(first, results, 100)).toBe(first);
    const both = appendArrived(first, { ...results, boxes: [DOOR] }, 100);
    expect(both.map((stroke) => stroke.kind)).toEqual(['wall', 'box']);
    expect(both[1]?.points).toHaveLength(5);
  });

  it('dừng đúng giữa cạnh theo tỉ lệ chiều dài', () => {
    const [box] = appendArrived([], { walls: [], boxes: [DOOR] }, 10);
    if (box === undefined) throw new Error('thiếu nét');
    expect(partialPoints(box, 0.375)).toEqual([[0, 0], [2, 0], [2, 1]]);
    expect(partialPoints(box, 1)).toEqual(box.points);
    expect(toPathData(partialPoints(box, 0))).toBe('M0 0L0 0');
  });
});
