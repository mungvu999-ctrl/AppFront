import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';

import type { NumberRead } from '@/lib/viewmodel/setBuildingDecisions';

import { HouseNumberCell } from './HouseNumberCell';

/** Bộ đọc giả: chỉ nhận chữ số; viewmodel thật có test riêng. */
const read = (text: string): NumberRead =>
  /^\d+$/u.test(text) ? { value: Number(text) } : { problem: 'Nhập số nguyên theo mm.' };

function renderCell(typedText = '') {
  const onSet = vi.fn<(value: number | undefined) => void>();

  render(
    <>
      <HouseNumberCell
        cell={{ text: '600 mm', chip: 'Theo quy ước · 40%', status: 'neutral' }}
        clearLabel="Bỏ số đã nhập cho độ đua"
        editLabel="Sửa độ đua"
        inputLabel="Độ đua (mm)"
        onSet={onSet}
        read={read}
        typedText={typedText}
      />
      <button type="button">Chỗ khác</button>
    </>,
  );

  return { onSet, user: userEvent.setup({ delay: null }) };
}

afterEach(cleanup);

describe('HouseNumberCell — rời ô sửa (không có nút lưu, A7)', () => {
  it('rời ô với số hợp lệ: ghi đúng một lần rồi đóng ô', async () => {
    const { onSet, user } = renderCell();

    await user.click(screen.getByRole('button', { name: 'Sửa độ đua' }));
    await user.type(screen.getByRole('textbox', { name: 'Độ đua (mm)' }), '450');
    await user.click(screen.getByRole('button', { name: 'Chỗ khác' }));
    expect(onSet).toHaveBeenCalledTimes(1);
    expect(onSet).toHaveBeenCalledWith(450);
    expect(screen.queryByRole('textbox')).toBeNull();
  });

  it('rời ô mà không đổi gì: đóng ô, không ghi', async () => {
    const { onSet, user } = renderCell('450');

    await user.click(screen.getByRole('button', { name: 'Sửa độ đua' }));
    await user.click(screen.getByRole('button', { name: 'Chỗ khác' }));
    expect(onSet).not.toHaveBeenCalled();
    expect(screen.queryByRole('textbox')).toBeNull();
  });

  it('rời ô với chữ không đọc được: ô vẫn mở kèm câu báo, không ghi', async () => {
    const { onSet, user } = renderCell();

    await user.click(screen.getByRole('button', { name: 'Sửa độ đua' }));
    await user.type(screen.getByRole('textbox'), '4,5');
    await user.click(screen.getByRole('button', { name: 'Chỗ khác' }));
    expect(onSet).not.toHaveBeenCalled();
    expect(screen.getByRole('textbox')).toBeTruthy();
    expect(screen.getByText('Nhập số nguyên theo mm.')).toBeTruthy();
  });

  it('Enter rồi ô bị gỡ khỏi trang: không ghi lần hai; Esc là huỷ, kể cả khi đã gõ số hợp lệ', async () => {
    const { onSet, user } = renderCell();

    await user.click(screen.getByRole('button', { name: 'Sửa độ đua' }));
    await user.type(screen.getByRole('textbox'), '450{Enter}');
    await user.click(screen.getByRole('button', { name: 'Chỗ khác' }));
    expect(onSet).toHaveBeenCalledTimes(1);
    await user.click(screen.getByRole('button', { name: 'Sửa độ đua' }));
    await user.type(screen.getByRole('textbox'), '700{Escape}');
    await user.click(screen.getByRole('button', { name: 'Chỗ khác' }));
    expect(onSet).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole('textbox')).toBeNull();
  });

  it('nhãn đọc lên của nút bỏ mở đầu bằng đúng chữ trên nút (điều khiển bằng giọng nói)', () => {
    renderCell('450');
    const clear = screen.getByRole('button', { name: 'Bỏ số đã nhập cho độ đua' });

    // `Button` dựng chữ hai lần (một bản giữ chỗ), nên so bằng "chứa".
    expect(clear.textContent).toContain('Bỏ số đã nhập');
    expect(clear.getAttribute('aria-label')).toMatch(/^Bỏ số đã nhập/u);
  });
});
