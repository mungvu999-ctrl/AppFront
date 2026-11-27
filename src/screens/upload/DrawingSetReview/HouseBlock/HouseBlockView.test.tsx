import { cleanup, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { expectAccessible } from '@/lib/testing/expectAccessible';
import { expectVietnamese } from '@/lib/testing/expectVietnamese';
import type { HouseBlockVm } from '@/lib/viewmodel/setBuilding';
import type { HouseActions } from '@/lib/viewmodel/setBuildingDecisions';

import { HouseBlockView } from './HouseBlockView';

const NO_EDIT = { typedMm: undefined, acceptMm: undefined };

const VM: HouseBlockVm = {
  unitSystem: { text: 'Hệ mét', chip: 'Máy đọc từ mặt bằng · 90%', status: 'neutral' },
  levels: [
    {
      key: 'v1',
      name: 'Tầng 1',
      elevation: {
        text: '±0.000 m',
        chip: 'Máy đọc từ mặt bằng và mặt cắt · 90%',
        status: 'neutral',
      },
      height: { text: '3.300 mm', chip: 'Người duyệt nhập', status: 'verified' },
      elevationEdit: { typedMm: undefined, acceptMm: 0 },
      heightEdit: { typedMm: 3300, acceptMm: undefined },
    },
    {
      key: 'v2',
      name: 'Tầng 2',
      elevation: { text: '+3.300 m', chip: 'Máy đọc từ mặt bằng · 60%', status: 'attention' },
      height: null,
      elevationEdit: { typedMm: undefined, acceptMm: 3300 },
      heightEdit: NO_EDIT,
    },
  ],
  roofs: [
    {
      key: 'v2',
      title: 'Mái của Tầng 2',
      isSkipped: false,
      rows: [
        {
          field: 'form',
          label: 'Dạng mái',
          lower: 'dạng mái',
          cell: { text: 'Mái hai dốc', chip: 'Máy đọc từ mặt bằng mái · 80%', status: 'neutral' },
          isTyped: false,
          edit: { kind: 'choice', value: 'gable', options: [{ value: 'gable', label: 'Mái hai dốc' }] },
        },
        {
          field: 'pitchDeg',
          label: 'Độ dốc',
          lower: 'độ dốc',
          cell: { text: '30°', chip: 'Máy giả định · 30%', status: 'violation' },
          isTyped: false,
          edit: { kind: 'number', typedText: '' },
        },
      ],
    },
  ],
  conflicts: [
    {
      key: 'elevationMm:v2',
      title: 'Cốt tầng — Tầng 2',
      candidates: [
        { text: '+3.300 m', chip: 'Máy đọc từ mặt bằng · 80%', source: 'plan', isChosen: false },
        { text: '+3.600 m', chip: 'Máy đọc từ mặt cắt · 90%', source: 'section', isChosen: true },
      ],
    },
  ],
  violations: [
    {
      level: 'error',
      title: 'Lỗi',
      status: 'violation',
      items: [{ key: 'k1', text: 'Tầng 1, Tầng 2: Hai tầng chồng lấn nhau.', isSeen: false }],
    },
    {
      level: 'warning',
      title: 'Cảnh báo',
      status: 'attention',
      items: [
        { key: 'w1', text: 'Tầng 2: Chiều cao tầng là máy giả định.', isSeen: false },
        { key: 'w2', text: 'Tầng 2: Dạng mái là máy giả định.', isSeen: true },
      ],
    },
    {
      level: 'hint',
      title: 'Gợi ý',
      status: 'neutral',
      items: [
        { key: 'k2', text: 'Tầng 2: Mái bằng nhưng không thấy chỗ thoát nước.', isSeen: false },
      ],
    },
  ],
};

const EMPTY: HouseBlockVm = { ...VM, levels: [], roofs: [], conflicts: [], violations: [] };

const actionsOf = (): { [K in keyof HouseActions]: ReturnType<typeof vi.fn<HouseActions[K]>> } => ({
  setLevel: vi.fn<HouseActions['setLevel']>(),
  setRoofSkip: vi.fn<HouseActions['setRoofSkip']>(),
  setRoof: vi.fn<HouseActions['setRoof']>(),
  pick: vi.fn<HouseActions['pick']>(),
  markSeen: vi.fn<HouseActions['markSeen']>(),
});

const renderBlock = (props: Partial<Parameters<typeof HouseBlockView>[0]> = {}) =>
  render(
    <HouseBlockView
      actions={actionsOf()}
      isRefreshing={false}
      onRetry={() => undefined}
      status="ready"
      vm={VM}
      {...props}
    />,
  );

const ui = () => userEvent.setup({ delay: null });

afterEach(cleanup);

describe('HouseBlockView — trạng thái của khối', () => {
  it('ẩn: không dựng gì', () => {
    const { container } = renderBlock({ status: 'hidden', vm: null });

    expect(container.innerHTML).toBe('');
  });

  it('đang tải: có vùng "Ngôi nhà" và một câu trạng thái, chưa có bảng', () => {
    renderBlock({ status: 'loading', vm: null });
    const block = screen.getByRole('region', { name: 'Ngôi nhà' });

    expect(within(block).getByRole('status').textContent).toBe('Đang đọc đề xuất ngôi nhà…');
    expect(block.getAttribute('aria-busy')).toBe('true');
    expect(within(block).queryByRole('table')).toBeNull();
  });

  it('lỗi đọc: một câu và nút thử lại', async () => {
    const onRetry = vi.fn();

    renderBlock({ status: 'error', vm: null, onRetry });
    expect(screen.getByText('Chưa đọc được đề xuất ngôi nhà.')).toBeTruthy();
    await ui().click(screen.getByRole('button', { name: 'Thử lại' }));
    expect(onRetry).toHaveBeenCalledTimes(1);
  });

  it('đang đọc lại: khối báo bận nhưng vẫn giữ nội dung', () => {
    renderBlock({ isRefreshing: true });
    const block = screen.getByRole('region', { name: 'Ngôi nhà' });

    expect(block.getAttribute('aria-busy')).toBe('true');
    expect(within(block).getByText('Tầng 1')).toBeTruthy();
  });
});

describe('HouseBlockView — có đề xuất', () => {
  it('nói rõ đây là đề xuất của máy và phải làm gì thì mới xác nhận được', () => {
    renderBlock();
    expect(
      screen.getByText(
        'Máy đề xuất, cần bạn duyệt. Chọn nguồn cho từng mâu thuẫn, sửa các lỗi và xem hết cảnh báo thì mới xác nhận được.',
      ),
    ).toBeTruthy();
  });

  it('bảng tầng: mỗi tầng một hàng, giá trị kèm chip nguồn bằng chữ; ô vắng là gạch ngang', () => {
    renderBlock();
    const rows = within(screen.getByRole('table', { name: 'Các tầng máy đề xuất' })).getAllByRole(
      'row',
    );

    expect(rows).toHaveLength(3);
    expect(rows[1]?.textContent).toContain('Tầng 1');
    expect(rows[1]?.textContent).toContain('±0.000 m');
    expect(rows[1]?.textContent).toContain('Máy đọc từ mặt bằng và mặt cắt · 90%');
    expect(rows[1]?.textContent).toContain('Người duyệt nhập');
    expect(rows[2]?.textContent).toContain('—');
  });

  it('thẻ mái: tiêu đề theo tầng, từng dòng nhãn và giá trị', () => {
    renderBlock();
    const card = screen.getByRole('group', { name: 'Mái của Tầng 2' });

    expect(within(card).getByText('Dạng mái:')).toBeTruthy();
    // Hai lần: giá trị đang hiệu lực và lựa chọn cùng tên trong nhóm chọn dạng mái (NHA-08c).
    expect(within(card).getAllByText('Mái hai dốc')).toHaveLength(2);
    expect(within(card).getByText('Máy giả định · 30%')).toBeTruthy();
  });

  it('đề xuất rỗng: câu thay cho bảng và thẻ, không có mục mâu thuẫn hay vi phạm', () => {
    renderBlock({ vm: EMPTY });
    expect(screen.getByText('Máy chưa đề xuất tầng nào.')).toBeTruthy();
    expect(screen.getByText('Máy chưa đề xuất mái nào.')).toBeTruthy();
    expect(screen.queryByText('Mâu thuẫn giữa các nguồn')).toBeNull();
    expect(screen.queryByText('Luật kiểm')).toBeNull();
  });

  it('chữ tiếng Việt và khả năng tiếp cận', () => {
    const { container } = renderBlock();

    expectVietnamese(container);
    expectAccessible(container);
  });
});

describe('HouseBlockView — người duyệt quyết định (NHA-08b)', () => {
  it('"Nhận" ghi đúng số của máy cho đúng ô; ô đã có số người duyệt hoặc máy chưa có số thì không có nút', async () => {
    const actions = actionsOf();

    renderBlock({ actions });
    await ui().click(screen.getByRole('button', { name: 'Nhận cốt của Tầng 2' }));
    expect(actions.setLevel).toHaveBeenCalledWith('v2', 'elevationMm', 3300);
    expect(screen.queryByRole('button', { name: 'Nhận chiều cao của Tầng 1' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Nhận chiều cao của Tầng 2' })).toBeNull();
  });

  it('"Sửa" mở ô nhập theo mm; Enter ghi số và đóng ô', async () => {
    const actions = actionsOf();
    const user = ui();

    renderBlock({ actions });
    await user.click(screen.getByRole('button', { name: 'Sửa chiều cao của Tầng 2' }));
    const input = screen.getByLabelText('Chiều cao của Tầng 2 (mm)');

    await user.type(input, '3600{Enter}');
    expect(actions.setLevel).toHaveBeenCalledWith('v2', 'heightMm', 3600);
    expect(screen.queryByLabelText('Chiều cao của Tầng 2 (mm)')).toBeNull();
  });

  it('số ngoài dải hoặc không phải số: báo ngay dưới ô, không ghi; Esc đóng ô mà không ghi', async () => {
    const actions = actionsOf();
    const user = ui();

    renderBlock({ actions });
    await user.click(screen.getByRole('button', { name: 'Sửa chiều cao của Tầng 2' }));
    await user.type(screen.getByLabelText('Chiều cao của Tầng 2 (mm)'), '99{Enter}');
    expect(screen.getByText('Chiều cao phải trong khoảng 2.000 đến 10.000 mm.')).toBeTruthy();
    await user.clear(screen.getByLabelText('Chiều cao của Tầng 2 (mm)'));
    await user.type(screen.getByLabelText('Chiều cao của Tầng 2 (mm)'), 'abc{Enter}');
    expect(screen.getByText('Nhập số nguyên theo mm.')).toBeTruthy();
    await user.keyboard('{Escape}');
    expect(screen.queryByLabelText('Chiều cao của Tầng 2 (mm)')).toBeNull();
    expect(actions.setLevel).not.toHaveBeenCalled();
  });

  it('chữ lạ như "12a" không được đoán thành số; xoá trắng ô đã có số là bỏ số, ô chưa có số thì chỉ đóng', async () => {
    const actions = actionsOf();
    const user = ui();

    renderBlock({ actions });
    await user.click(screen.getByRole('button', { name: 'Sửa chiều cao của Tầng 2' }));
    await user.type(screen.getByLabelText('Chiều cao của Tầng 2 (mm)'), '3600a{Enter}');
    expect(screen.getByText('Nhập số nguyên theo mm.')).toBeTruthy();
    await user.clear(screen.getByLabelText('Chiều cao của Tầng 2 (mm)'));
    await user.keyboard('{Enter}');
    expect(screen.queryByLabelText('Chiều cao của Tầng 2 (mm)')).toBeNull();
    expect(actions.setLevel).not.toHaveBeenCalled();
    await user.click(screen.getByRole('button', { name: 'Sửa chiều cao của Tầng 1' }));
    await user.clear(screen.getByLabelText('Chiều cao của Tầng 1 (mm)'));
    await user.keyboard('{Enter}');
    expect(actions.setLevel).toHaveBeenCalledWith('v1', 'heightMm', undefined);
  });

  it('bàn phím: sau "Nhận" tiêu điểm ở nút "Sửa" của ô đó; sau "Đã xem" tiêu điểm ở dòng cảnh báo', async () => {
    const user = ui();

    renderBlock();
    await user.click(screen.getByRole('button', { name: 'Nhận cốt của Tầng 2' }));
    expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Sửa cốt của Tầng 2' }));
    const warning = within(screen.getByRole('list', { name: 'Cảnh báo' })).getAllByRole('listitem')[0] as HTMLElement;

    await user.click(within(warning).getByRole('button'));
    expect(document.activeElement).toBe(warning);
  });

  it('ô đã có số người duyệt: ô sửa điền sẵn số đó, và có nút bỏ số để quay về số của máy', async () => {
    const actions = actionsOf();
    const user = ui();

    renderBlock({ actions });
    await user.click(screen.getByRole('button', { name: 'Sửa chiều cao của Tầng 1' }));
    expect(screen.getByLabelText('Chiều cao của Tầng 1 (mm)')).toHaveProperty('value', '3300');
    await user.keyboard('{Escape}');
    await user.click(screen.getByRole('button', { name: 'Bỏ số đã nhập cho chiều cao của Tầng 1' }));
    expect(actions.setLevel).toHaveBeenCalledWith('v1', 'heightMm', undefined);
    expect(screen.queryByRole('button', { name: 'Bỏ số đã nhập cho cốt của Tầng 1' })).toBeNull();
  });

  it('"Không dựng mái, tôi tự vẽ": tick và bỏ tick; mái đã bỏ vẫn có thẻ để bỏ tick', async () => {
    const actions = actionsOf();
    const user = ui();
    const skippedOnly: HouseBlockVm = {
      ...VM,
      roofs: [{ key: 'v2', title: 'Mái của Tầng 2', rows: [], isSkipped: true }],
    };

    const { rerender } = renderBlock({ actions });

    await user.click(
      within(screen.getByRole('group', { name: 'Mái của Tầng 2' })).getByRole('checkbox', {
        name: 'Không dựng mái, tôi tự vẽ',
      }),
    );
    expect(actions.setRoofSkip).toHaveBeenCalledWith('v2', true);
    rerender(
      <HouseBlockView
        actions={actions}
        isRefreshing={false}
        onRetry={() => undefined}
        status="ready"
        vm={skippedOnly}
      />,
    );
    const box = within(screen.getByRole('group', { name: 'Mái của Tầng 2' })).getByRole(
      'checkbox',
      { name: 'Không dựng mái, tôi tự vẽ' },
    );

    expect(box).toHaveProperty('checked', true);
    await user.click(box);
    expect(actions.setRoofSkip).toHaveBeenLastCalledWith('v2', false);
  });

  it('mâu thuẫn là một nhóm chọn một có nhãn; chọn nguồn gửi đúng khoá và mã nguồn', async () => {
    const actions = actionsOf();

    renderBlock({ actions });
    const group = screen.getByRole('radiogroup', { name: 'Cốt tầng — Tầng 2' });
    const radios = within(group).getAllByRole('radio');

    expect(radios.map((radio) => (radio as HTMLInputElement).checked)).toEqual([false, true]);
    await ui().click(
      within(group).getByRole('radio', { name: '+3.300 m · Máy đọc từ mặt bằng · 80%' }),
    );
    expect(actions.pick).toHaveBeenCalledWith('elevationMm:v2', 'plan');
  });

  it('cảnh báo chưa xem có nút "Đã xem"; cảnh báo đã xem, lỗi và gợi ý thì không', async () => {
    const actions = actionsOf();

    renderBlock({ actions });
    const warnings = within(screen.getByRole('list', { name: 'Cảnh báo' })).getAllByRole(
      'listitem',
    );

    expect(within(warnings[1] as HTMLElement).queryByRole('button')).toBeNull();
    expect(warnings[1]?.textContent).toContain('Đã xem');
    await ui().click(
      within(warnings[0] as HTMLElement).getByRole('button', {
        name: 'Đã xem: Tầng 2: Chiều cao tầng là máy giả định.',
      }),
    );
    expect(actions.markSeen).toHaveBeenCalledWith('w1');
    expect(within(screen.getByRole('list', { name: 'Lỗi' })).queryByRole('button')).toBeNull();
    expect(within(screen.getByRole('list', { name: 'Gợi ý' })).queryByRole('button')).toBeNull();
  });
});
