import { describe, expect, it } from 'vitest';

import { floorScaleKeysOf } from './floorScaleKeys';

describe('floorScaleKeysOf', () => {
  it('kho không biết gì về tỷ lệ tầng → null ("chưa đọc"), không phải "đã xác nhận"', () => {
    expect(floorScaleKeysOf(undefined, undefined)).toBeNull();
    expect(floorScaleKeysOf(undefined, { revision: 3 })).toBeNull();
  });

  it('kho biết tầng là tỷ lệ tạm thì trả về chính bản ghi đó', () => {
    const meta = { revision: 3, scaleStatus: 'unresolved' } as const;

    expect(floorScaleKeysOf(undefined, meta)).toBe(meta);
  });

  it('R10: tầng đã chấp nhận số máy mất scaleStatus nhưng còn scaleState — vẫn phải trả về', () => {
    // Luật cũ chỉ xét scaleStatus nên trả null, và mọi nơi gọi coi như "chưa đọc" rồi bỏ sót tầng.
    const meta = { revision: 3, scaleState: 'estimated', scaleReasons: ['door', 'userAccepted'] } as const;

    expect(floorScaleKeysOf(undefined, meta)).toBe(meta);
  });
});
