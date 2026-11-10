import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { QcDisplayPopover } from './QcDisplayPopover';

describe('[UX #11] popover Lọc/Hiển thị', () => {
  it('mở: nút có aria-controls, Tab từ nút vào thẳng trong hộp thoại, Esc trả focus về nút', async () => {
    render(<QcDisplayPopover groups={[{ title: 'Lọc danh sách', items: [{ key: 'a', label: 'Chỉ hiện chưa duyệt', checked: false, onToggle: () => undefined }] }]} label="Lọc" popoverLabel="Lọc danh sách" />);
    const button = screen.getByRole('button', { name: /Lọc/ });
    button.focus();
    fireEvent.click(button);

    const dialog = await screen.findByRole('dialog', { name: 'Lọc danh sách' });
    expect(document.getElementById(button.getAttribute("aria-controls") ?? "x")).toBe(dialog);

    button.focus();
    fireEvent.keyDown(button, { key: 'Tab' });
    expect(dialog).toContainElement(document.activeElement as HTMLElement);

    fireEvent.keyDown(document.activeElement as HTMLElement, { key: 'Escape' });
    await waitFor(() => expect(document.activeElement).toBe(button));
  });
});
