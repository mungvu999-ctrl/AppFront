import { describe, expect, it } from 'vitest';

import { isScaleTrusted, measureTextOfState, provisionalFloorsMessageOf, totalMeasureTextOf } from './provisionalScale';

describe('provisionalFloorsMessageOf', () => {
  it('không tầng → null; một tầng gọi tên; nhiều tầng thì đếm', () => {
    expect(provisionalFloorsMessageOf([])).toBeNull();
    expect(provisionalFloorsMessageOf(['Tầng 1'])).toBe('Tầng 1 chưa hiệu chỉnh tỷ lệ — kích thước 3D có thể sai');
    expect(provisionalFloorsMessageOf(['Tầng 1', 'Tầng 2'])).toBe(
      '2 tầng chưa hiệu chỉnh tỷ lệ — kích thước 3D có thể sai',
    );
  });
});

describe('isScaleTrusted', () => {
  it('chỉ tin số của tầng máy đọc được hoặc người đã hiệu chỉnh', () => {
    expect(isScaleTrusted(undefined, undefined, 'determined')).toBe(true);
    expect(isScaleTrusted(undefined, undefined, 'userCalibrated')).toBe(true);
    expect(isScaleTrusted(undefined, undefined, 'estimated')).toBe(false);
    expect(isScaleTrusted(undefined, undefined, 'unresolved')).toBe(false);
  });

  it('R10: tầng người dùng đã chấp nhận số máy không còn scaleStatus nhưng vẫn là số ước', () => {
    // Luật cũ `scaleStatus === 'unresolved'` trả false ở đây và bỏ sót đúng tầng này.
    expect(isScaleTrusted(undefined, undefined, 'estimated')).toBe(false);
    expect(isScaleTrusted('unresolved', undefined, 'estimated')).toBe(false);
  });
});

describe('measureTextOfState', () => {
  it('số tin được để trần, số ước mang dấu ≈ và lý do, tầng chưa có tỷ lệ thì không có số', () => {
    expect(measureTextOfState('42,6 m²', 'measured')).toBe('42,6 m²');
    expect(measureTextOfState('42,6 m²', 'confirmed')).toBe('42,6 m²');
    expect(measureTextOfState('42,6 m²', 'estimated')).toBe('≈ 42,6 m² (ước lượng)');
    expect(measureTextOfState('42,6 m²', 'undetermined')).toBe('≈ 42,6 m² (chưa xác định)');
    expect(measureTextOfState('42,6 m²', 'missing')).toBe('Chưa có');
  });
});

describe('totalMeasureTextOf', () => {
  it('mọi tầng đo được thì tổng để trần', () => {
    expect(
      totalMeasureTextOf('248,6 m²', [
        { name: 'Tầng 1', state: 'measured' },
        { name: 'Tầng 2', state: 'confirmed' },
      ]),
    ).toBe('248,6 m²');
  });

  it('một tầng ước giữa các tầng đo được thì tổng phải gọi tên tầng đó', () => {
    expect(
      totalMeasureTextOf('248,6 m²', [
        { name: 'Tầng 1', state: 'measured' },
        { name: 'Tầng 2', state: 'estimated' },
      ]),
    ).toBe('≈ 248,6 m² (ước lượng ở Tầng 2)');
  });

  it('mọi tầng đều ước thì chỉ cần một dấu chung, khỏi liệt kê hết', () => {
    expect(
      totalMeasureTextOf('248,6 m²', [
        { name: 'Tầng 1', state: 'estimated' },
        { name: 'Tầng 2', state: 'undetermined' },
      ]),
    ).toBe('≈ 248,6 m² (ước lượng)');
  });
});
