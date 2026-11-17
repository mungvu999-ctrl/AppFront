/**
 * `rectsOverlap` viết lại cho nhanh (không cấp phát + loại nhanh theo hộp bao) phải cho ĐÚNG kết quả
 * như bản tham chiếu SAT viết thẳng theo công thức. Bài này là lưới an toàn của đợt tối ưu 15/11:
 * mọi luật đặt đồ, sửa cảnh và thang bố trí đều gọi hàm này.
 */
import { describe, expect, it } from 'vitest';

import { rectsOverlap, type Rect } from '../placement';

const radiansOf = (deg: number): number => (deg * Math.PI) / 180;
const axesOf = (r: Rect): readonly [{ x: number; y: number }, { x: number; y: number }] => {
  const t = radiansOf(r.rotationDeg);
  const c = Math.cos(t);
  const s = Math.sin(t);
  return [
    { x: c, y: s },
    { x: -s, y: c },
  ];
};
const dot = (p: { x: number; y: number }, q: { x: number; y: number }): number => p.x * q.x + p.y * q.y;

/** Bản tham chiếu: đúng mã trước khi tối ưu (SAT 4 trục, không loại nhanh). */
const referenceOverlap = (a: Rect, b: Rect, gapMm = 0): boolean => {
  const [ax, ay] = axesOf(a);
  const [bx, by] = axesOf(b);
  const between = { x: b.cx - a.cx, y: b.cy - a.cy };
  const half = (r: Rect, ex: { x: number; y: number }, ey: { x: number; y: number }, u: { x: number; y: number }): number =>
    Math.abs(dot(ex, u)) * (r.w / 2) + Math.abs(dot(ey, u)) * (r.d / 2);
  return [ax, ay, bx, by].every((u) => Math.abs(dot(between, u)) < half(a, ax, ay, u) + half(b, bx, by, u) + gapMm - 1e-6);
};

/** Bộ sinh giả ngẫu nhiên tất định (mulberry32) — chạy lại cho cùng một tập ca. */
const rng = (seed: number) => () => {
  seed = (seed + 0x6d2b79f5) | 0;
  let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
};

describe('rectsOverlap (bản nhanh)', () => {
  it('khớp bản tham chiếu trên 20 000 cặp ngẫu nhiên, mọi mức gap', () => {
    const rand = rng(20261115);
    const gaps = [0, 50, 300, -50, -120];
    let checked = 0;
    let overlaps = 0;
    for (let i = 0; i < 20_000; i += 1) {
      const scale = 1 + Math.floor(rand() * 3) * 900; // cả cặp sát nhau lẫn cặp xa nhau
      const a: Rect = {
        cx: rand() * scale,
        cy: rand() * scale,
        w: 100 + rand() * 2200,
        d: 100 + rand() * 2200,
        rotationDeg: Math.round(rand() * 720 - 360),
      };
      const b: Rect = {
        cx: a.cx + (rand() - 0.5) * 2 * scale,
        cy: a.cy + (rand() - 0.5) * 2 * scale,
        w: 100 + rand() * 2200,
        d: 100 + rand() * 2200,
        rotationDeg: Math.round(rand() * 720 - 360),
      };
      const gap = gaps[i % gaps.length] as number;
      const got = rectsOverlap(a, b, gap);
      const want = referenceOverlap(a, b, gap);
      if (got !== want) expect.fail(`lệch ở cặp ${i} (gap ${gap}): ${JSON.stringify({ a, b, got, want })}`);
      checked += 1;
      if (want) overlaps += 1;
    }
    expect(checked).toBe(20_000);
    // Tập ca phải có cả hai kết quả, không thì phép đối chiếu vô nghĩa.
    expect(overlaps).toBeGreaterThan(1_000);
    expect(overlaps).toBeLessThan(19_000);
  });

  it('giữ các ca biên quen thuộc: trùng khít, chạm cạnh, xoay 45°', () => {
    const base: Rect = { cx: 0, cy: 0, w: 1000, d: 600, rotationDeg: 0 };
    expect(rectsOverlap(base, base)).toBe(true);
    // Chạm đúng cạnh (khoảng cách = tổng nửa cạnh) không tính là chồng.
    expect(rectsOverlap(base, { ...base, cx: 1000 })).toBe(false);
    expect(rectsOverlap(base, { ...base, cx: 999 })).toBe(true);
    // Có gap 50 mm: cách 1020 mm vẫn "chồng" theo nghĩa chưa đủ khe.
    expect(rectsOverlap(base, { ...base, cx: 1020 }, 50)).toBe(true);
    expect(rectsOverlap(base, { ...base, cx: 1060 }, 50)).toBe(false);
    // Xoay 45°: hai hình chéo nhau ở góc.
    expect(rectsOverlap(base, { cx: 760, cy: 360, w: 800, d: 800, rotationDeg: 45 })).toBe(true);
    expect(rectsOverlap(base, { cx: 1600, cy: 1200, w: 800, d: 800, rotationDeg: 45 })).toBe(false);
  });
});
