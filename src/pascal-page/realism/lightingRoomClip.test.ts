import { describe, expect, it } from 'vitest';

import { parseLightFlags } from './lightFlag';
import {
  type ClipRoom,
  ROOM_CLIP_EDGE_M,
  ROOM_CLIP_HEIGHT_M,
  ROOM_CLIP_MARGIN_M,
  roomClipBox,
  roomClipFactor,
  roomOfLight,
  topsOf,
} from './lightingRoomClip';

const rect = (x: number, z: number, w: number, d: number): [number, number][] => [[x, z], [x + w, z], [x + w, z + d], [x, z + d]];

// Hai phòng kề nhau qua bức tường x = 5 (A: 0..5, B: 5..9), tầng 0 sàn 0, tầng 1 sàn 3,3.
const A: ClipRoom = { polygon: rect(0, 0, 5, 4), floorY: 0, topY: 3.3 };
const B: ClipRoom = { polygon: rect(5, 0, 4, 4), floorY: 0, topY: 3.3 };
const A1: ClipRoom = { polygon: rect(0, 0, 5, 4), floorY: 3.3, topY: 3.3 + ROOM_CLIP_HEIGHT_M };

describe('?light=room-clip', () => {
  it('cờ cộng dồn với cờ cũ', () => {
    expect([...parseLightFlags('?light=lamp-cal,room-clip')]).toEqual(['lamp-cal', 'room-clip']);
  });

  it('hộp = khung đa giác nới margin, đáy sàn tầng, đỉnh sàn tầng trên', () => {
    const b = roomClipBox(A);
    expect(b.min).toEqual([-ROOM_CLIP_MARGIN_M, -0.05, -ROOM_CLIP_MARGIN_M]);
    expect(b.max).toEqual([5 + ROOM_CLIP_MARGIN_M, 3.3, 4 + ROOM_CLIP_MARGIN_M]);
    expect(topsOf([3.3, 0, 0, 3.3])).toEqual(new Map([[0, 3.3], [3.3, 3.3 + ROOM_CLIP_HEIGHT_M]]));
  });

  it('mặt nạ: trong phòng = 1, sàn phòng kề sau tường = 0, mép tường trong ~1', () => {
    const b = roomClipBox(A);
    expect(roomClipFactor([2.5, 0, 2], b)).toBe(1);
    // mặt trong tường chung (x = 5, đa giác ở mép trong): vẫn sáng đủ
    expect(roomClipFactor([5, 1.2, 2], b)).toBe(1);
    // sàn phòng B cách tường 0,3 m: không nhận đèn A
    expect(roomClipFactor([5.3, 0, 2], b)).toBe(0);
    // đúng mép hộp: một nửa (mép mềm rộng ROOM_CLIP_EDGE_M)
    expect(roomClipFactor([5 + ROOM_CLIP_MARGIN_M, 0, 2], b)).toBeCloseTo(0.5);
    expect(roomClipFactor([5 + ROOM_CLIP_MARGIN_M + ROOM_CLIP_EDGE_M / 2, 0, 2], b)).toBeCloseTo(0, 6);
    // tầng dưới không nhận đèn tầng trên
    expect(roomClipFactor([2.5, 0, 2], roomClipBox(A1))).toBe(0);
  });

  it('đèn thuộc phòng chứa nó, đúng tầng; chồng nhau lấy phòng nhỏ; ngoài mọi phòng → không cắt', () => {
    const rooms = [A, B, A1];
    expect(roomOfLight({ x: 2, y: 2.3, z: 2 }, rooms)).toBe(A);
    expect(roomOfLight({ x: 7, y: 3.18, z: 2 }, rooms)).toBe(B);
    expect(roomOfLight({ x: 2, y: 5.6, z: 2 }, rooms)).toBe(A1);
    const nook: ClipRoom = { polygon: rect(1, 1, 1, 1), floorY: 0, topY: 3.3 };
    expect(roomOfLight({ x: 1.5, y: 2, z: 1.5 }, [A, nook])).toBe(nook);
    expect(roomOfLight({ x: 20, y: 2, z: 2 }, rooms)).toBeUndefined();
  });
});
