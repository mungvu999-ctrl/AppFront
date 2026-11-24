/**
 * Phép ratchet của cổng độ dài file (K-55) — khoá từng cách sai cụ thể.
 *
 * Dùng số đo dựng tay, không đọc đĩa: khoá PHÉP TÍNH chứ không khoá một bản cây mã.
 */

import { describe, expect, it } from 'vitest';

import { evaluate, isProductSource, nextBaseline } from '../check-file-length.mjs';

const file = (path, lines) => ({ path, lines });

describe('isProductSource — file nào được đếm', () => {
  it('nhận .ts và .tsx sản phẩm', () => {
    expect(isProductSource('useThing.ts')).toBe(true);
    expect(isProductSource('Thing.tsx')).toBe(true);
  });

  it('bỏ .d.ts, test, spec, stories', () => {
    for (const name of [
      'a.d.ts',
      'a.test.ts',
      'a.test.tsx',
      'a.spec.ts',
      'a.stories.tsx',
      'a.stories.ts',
    ]) {
      expect(isProductSource(name)).toBe(false);
    }
  });

  it('bỏ file không phải mã nguồn', () => {
    expect(isProductSource('a.json')).toBe(false);
    expect(isProductSource('a.css')).toBe(false);
  });
});

describe('evaluate — ratchet theo baseline', () => {
  it('file mới 401 dòng (không trong baseline) hỏng', () => {
    const result = evaluate([file('src/new.ts', 401)], {});

    expect(result.failed).toEqual([{ path: 'src/new.ts', lines: 401, reason: 'new' }]);
  });

  it('file mới đúng 400 dòng không hỏng', () => {
    const result = evaluate([file('src/new.ts', 400)], {});

    expect(result.failed).toEqual([]);
    expect(result.warned).toHaveLength(1);
  });

  it('file trong baseline dài thêm hỏng', () => {
    const result = evaluate([file('src/big.ts', 2932)], { 'src/big.ts': 2931 });

    expect(result.failed).toEqual([
      { path: 'src/big.ts', lines: 2932, recorded: 2931, reason: 'grew' },
    ]);
  });

  it('file trong baseline giữ nguyên số: chỉ nhắc, không hỏng', () => {
    const result = evaluate([file('src/big.ts', 2931)], { 'src/big.ts': 2931 });

    expect(result.failed).toEqual([]);
    expect(result.warned).toHaveLength(1);
    expect(result.shrunk).toEqual([]);
  });

  it('file trong baseline ngắn đi: chỉ nhắc cập nhật baseline', () => {
    const result = evaluate([file('src/big.ts', 2900)], { 'src/big.ts': 2931 });

    expect(result.failed).toEqual([]);
    expect(result.shrunk).toEqual([{ path: 'src/big.ts', lines: 2900, recorded: 2931 }]);
  });

  it('file trong baseline đã xuống dưới 400: nhắc xoá khỏi baseline', () => {
    const result = evaluate([file('src/big.ts', 390)], { 'src/big.ts': 450 });

    expect(result.failed).toEqual([]);
    expect(result.shrunk).toHaveLength(1);
  });

  it('mục baseline không còn file: báo gone, không hỏng', () => {
    const result = evaluate([], { 'src/deleted.ts': 500 });

    expect(result.failed).toEqual([]);
    expect(result.gone).toEqual(['src/deleted.ts']);
  });

  it('--max nhỏ hơn đổi ngưỡng hỏng cho file mới', () => {
    const result = evaluate([file('src/new.ts', 120)], {}, 100);

    expect(result.failed).toHaveLength(1);
  });
});

describe('nextBaseline — chỉ hạ, không nâng, không thêm', () => {
  it('chưa có baseline: ghi mọi file vượt 400, sắp theo đường dẫn', () => {
    const next = nextBaseline(
      [file('src/b.ts', 500), file('src/a.ts', 450), file('src/c.ts', 300)],
      null,
    );

    expect(Object.entries(next)).toEqual([
      ['src/a.ts', 450],
      ['src/b.ts', 500],
    ]);
  });

  it('có baseline: hạ số, không nâng số', () => {
    const next = nextBaseline([file('src/a.ts', 420), file('src/b.ts', 900)], {
      'src/a.ts': 450,
      'src/b.ts': 800,
    });

    expect(next).toEqual({ 'src/a.ts': 420, 'src/b.ts': 800 });
  });

  it('có baseline: không thêm file mới vượt 400', () => {
    const next = nextBaseline([file('src/new.ts', 600)], {});

    expect(next).toEqual({});
  });

  it('xoá mục khi file xuống ≤ 400 hoặc biến mất', () => {
    const next = nextBaseline([file('src/a.ts', 400)], { 'src/a.ts': 450, 'src/gone.ts': 500 });

    expect(next).toEqual({});
  });
});
