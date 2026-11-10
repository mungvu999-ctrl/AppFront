import { describe, expect, it } from 'vitest';

import { bandBox, type ClipRoom, lightMask, OPEN_BOX, ROOM_CLIP_EDGE_M, ROOM_CLIP_MARGIN_M, roomClipBox, roomClipFactor } from './lightingRoomClip';
import { clipShapeOf, openShape, polygonClipFactor, ROOM_CLIP_MAX_VERTS, simplifyPolygon } from './roomClipShape';

const M = ROOM_CLIP_MARGIN_M;
const E = ROOM_CLIP_EDGE_M;
const rect = (x: number, z: number, w: number, d: number): [number, number][] => [[x, z], [x + w, z], [x + w, z + d], [x, z + d]];
/** Mặt nạ đầy đủ như shader: hộp dải Y × đa giác. */
const mask = (room: ClipRoom, p: [number, number, number]) => lightMask(p, [0, 0, 0], bandBox(room), [], clipShapeOf(room.polygon).verts);

describe('room-clip theo đa giác phòng', () => {
  it('phòng chữ nhật: như hộp vòng 6 (trong, mép, ngoài)', () => {
    const A: ClipRoom = { polygon: rect(0, 0, 5, 4), floorY: 0, topY: 3.3 };
    const old = roomClipBox(A);
    for (const p of [[2.5, 1, 2], [5, 1.2, 2], [5.3, 0, 2], [5 + M, 1, 2], [2, 1, 4 + M + E / 2], [-0.02, 2, 1]] as [number, number, number][]) {
      expect(mask(A, p)).toBeCloseTo(roomClipFactor(p, old), 6);
    }
    expect(clipShapeOf(A.polygon).fallback).toBe(false);
  });

  it('phòng chữ L: phần khuyết (trong AABB) → NGOÀI; hai cánh L → TRONG', () => {
    // L: 0..6 × 0..2 cộng 0..2 × 2..5; khuyết = 2..6 × 2..5
    const L: ClipRoom = { polygon: [[0, 0], [6, 0], [6, 2], [2, 2], [2, 5], [0, 5]], floorY: 0, topY: 3 };
    expect(roomClipFactor([4, 1, 4], roomClipBox(L))).toBe(1); // vòng 6: lọt
    expect(mask(L, [4, 1, 4])).toBe(0);
    expect(mask(L, [5, 1, 1])).toBe(1);
    expect(mask(L, [1, 1, 4])).toBe(1);
    // mặt tường trong của khuyết (trên cạnh z = 2) vẫn sáng
    expect(mask(L, [4, 1, 2])).toBe(1);
  });

  it('phòng xoay 30°: góc AABB ngoài phòng → NGOÀI, tâm → TRONG', () => {
    const c = Math.cos(Math.PI / 6);
    const s = Math.sin(Math.PI / 6);
    const R: ClipRoom = { polygon: rect(-2, -1.5, 4, 3).map(([x, z]) => [x * c - z * s, x * s + z * c] as [number, number]), floorY: 0, topY: 3 };
    const box = roomClipBox(R);
    const corner: [number, number, number] = [box.max[0] - 0.1, 1, box.max[2] - 0.1];
    expect(roomClipFactor(corner, box)).toBe(1); // vòng 6: lọt
    expect(mask(R, corner)).toBe(0);
    expect(mask(R, [0, 1, 0])).toBe(1);
  });

  it('hai tầng: cùng XZ khác tầng → NGOÀI', () => {
    const G: ClipRoom = { polygon: rect(0, 0, 5, 4), floorY: 0, topY: 3.3 };
    const U: ClipRoom = { polygon: rect(0, 0, 5, 4), floorY: 3.3, topY: 7.3 };
    expect(mask(U, [2, 1, 2])).toBe(0);
    expect(mask(G, [2, 4.5, 2])).toBe(0);
    expect(mask(U, [2, 4.5, 2])).toBe(1);
  });

  it('quá nhiều đỉnh → lùi AABB (như vòng 6); đỉnh thẳng hàng được bỏ trước', () => {
    const comb: [number, number][] = [[0, 0], [10, 0], [10, 4]];
    for (let i = 0; i < 4; i++) comb.push([9 - 2 * i, 4], [9 - 2 * i, 2], [8 - 2 * i, 2], [8 - 2 * i, 4]);
    comb.push([0, 4]);
    const C: ClipRoom = { polygon: comb, floorY: 0, topY: 3 };
    const sh = clipShapeOf(C.polygon);
    expect(sh.fallback).toBe(true);
    expect(sh.verts).toHaveLength(ROOM_CLIP_MAX_VERTS);
    expect(mask(C, [8.5, 1, 3])).toBe(1); // trong răng lược nhưng trong AABB
    expect(mask(C, [10.3, 1, 2])).toBe(0);
    const dense = [...rect(0, 0, 5, 4), [0, 3], [0, 2], [0, 1]] as [number, number][];
    expect(simplifyPolygon(dense)).toHaveLength(4);
    expect(clipShapeOf(dense).fallback).toBe(false);
  });

  it('đèn ngoài phòng: hình mở → 1 khắp nơi', () => {
    expect(polygonClipFactor(123, -45, openShape(OPEN_BOX).verts, M, E)).toBe(1);
  });
});
