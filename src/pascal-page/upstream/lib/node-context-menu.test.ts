import { describe, expect, it } from 'vitest';

import { CLICK_SLOP_PX, isPlainClick, runMenuAction } from './node-context-menu';

describe('isPlainClick', () => {
  const down = { x: 100, y: 100 };

  it('nhả tại chỗ hoặc lệch dưới ngưỡng là bấm', () => {
    expect(isPlainClick(down, down)).toBe(true);
    expect(isPlainClick(down, { x: 103, y: 100 })).toBe(true);
    expect(isPlainClick(down, { x: 102, y: 102 })).toBe(true);
  });

  it('từ ngưỡng trở lên là kéo, tính theo khoảng cách chứ không theo từng trục', () => {
    expect(isPlainClick(down, { x: 100 + CLICK_SLOP_PX, y: 100 })).toBe(false);
    expect(isPlainClick(down, { x: 103, y: 103 })).toBe(false);
    expect(isPlainClick(down, { x: 20, y: 100 })).toBe(false);
  });

  it('không có lúc nhấn trong trang thì không phải bấm', () => {
    expect(isPlainClick(null, down)).toBe(false);
  });
});

describe('runMenuAction', () => {
  it('hạ cờ cameraDragging (kẹt từ cú chuột phải mở menu) TRƯỚC khi chạy mục menu', () => {
    const log: string[] = [];
    runMenuAction(() => log.push('run'), { setCameraDragging: (dragging) => log.push(`drag=${String(dragging)}`) });
    expect(log).toEqual(['drag=false', 'run']);
  });

  it('viewer không có setCameraDragging vẫn chạy mục menu', () => {
    let ran = false;
    runMenuAction(() => (ran = true), {});
    expect(ran).toBe(true);
  });
});
