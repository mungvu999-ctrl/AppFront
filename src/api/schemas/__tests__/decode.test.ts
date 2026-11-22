import { describe, expect, it, vi } from 'vitest';

import { DrawingSchema, FloorSchema, ProgressSchema } from '@/api/schemas';
import { decode, safeParseList } from '@/api/schemas/decode';

const validDrawing = {
  heightMm: 20_000,
  id: 'drawing-1',
  name: 'floor plan 1',
  uploadedAt: '2026-08-03T08:00:00.000Z',
  uploaderId: 'user-1',
  url: 'https://example.com/drawing-1.png',
  widthMm: 30_000,
};

const createFloor = (id: string) => ({
  drawings: [validDrawing],
  elevationMm: 0,
  heightMm: 3_600,
  id,
  name: `floor ${id}`,
  order: 1,
});

describe('decode', () => {
  it('returns an error with the field name when a required response field is missing', () => {
    const result = decode(DrawingSchema, { ...validDrawing, name: undefined }, 'drawing');

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.params.message).toContain("Trường 'drawing.name' là bắt buộc.");
    }
  });

  it('rejects decimal numbers for millimeter length fields', () => {
    const result = decode(FloorSchema, { ...createFloor('1'), heightMm: 3_600.5 }, 'floor');

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.params.message).toContain("Trường 'floor.heightMm' cần số nguyên");
    }
  });
});

describe('FloorSchema hiddenIn3d (FE3D-FIX-003 R1)', () => {
  it('parses an old floor without hiddenIn3d unchanged', () => {
    expect(FloorSchema.parse(createFloor('1'))).toStrictEqual(createFloor('1'));
  });

  it.each([true, false])('keeps hiddenIn3d %s', (hiddenIn3d) => {
    expect(FloorSchema.parse({ ...createFloor('1'), hiddenIn3d })).toStrictEqual({ ...createFloor('1'), hiddenIn3d });
  });

  it.each([null, 'true', 1])('rejects hiddenIn3d %s', (hiddenIn3d) => {
    expect(FloorSchema.safeParse({ ...createFloor('1'), hiddenIn3d }).success).toBe(false);
  });
});

describe('FloorSchema isSection (K-31, NO-471)', () => {
  it('parses a floor without isSection unchanged', () => {
    expect(FloorSchema.parse(createFloor('1'))).not.toHaveProperty('isSection');
  });

  it('keeps isSection true', () => {
    expect(FloorSchema.parse({ ...createFloor('1'), isSection: true })).toStrictEqual({
      ...createFloor('1'),
      isSection: true,
    });
  });

  it.each([false, null, 'true', 1])('rejects isSection %s', (isSection) => {
    expect(FloorSchema.safeParse({ ...createFloor('1'), isSection }).success).toBe(false);
  });
});

describe('safeParseList', () => {
  it('drops invalid items and still returns the list when the invalid ratio is at most 20%', () => {
    const input = Array.from({ length: 10 }, (_value, index) =>
      index === 2 ? { ...createFloor(String(index)), elevationMm: '0' } : createFloor(String(index)),
    );
    const warn = vi.fn();

    const result = safeParseList(FloorSchema, input, 'floors', { warn });

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.data).toHaveLength(9);
    }
    expect(warn).toHaveBeenCalledTimes(1);
    expect(warn).toHaveBeenCalledWith(
      expect.objectContaining({
        index: 2,
        message: "Trường 'floors[2].elevationMm' cần số, nhận được chuỗi.",
      }),
    );
  });

  it('returns an error when the list has more than 20% invalid items', () => {
    const input = Array.from({ length: 10 }, (_value, index) =>
      index < 3 ? { ...createFloor(String(index)), elevationMm: '0' } : createFloor(String(index)),
    );

    const result = safeParseList(FloorSchema, input, 'floors', { warn: vi.fn() });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.params.message).toContain("3/10 phần tử từ 'floors' hỏng");
    }
  });
});

describe('ProgressSchema queueAhead', () => {
  const wire = { id: 'p1', progressPercent: 5, status: 'running', step: 'wall' } as const;

  it('giữ queueAhead là số, bỏ qua khi null hoặc vắng', () => {
    expect(ProgressSchema.parse({ ...wire, queueAhead: 3 }).queueAhead).toBe(3);
    expect('queueAhead' in ProgressSchema.parse({ ...wire, queueAhead: null })).toBe(false);
    expect('queueAhead' in ProgressSchema.parse(wire)).toBe(false);
  });
});
