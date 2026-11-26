import { cleanup, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { expectAccessible } from '@/lib/testing/expectAccessible';
import { expectVietnamese } from '@/lib/testing/expectVietnamese';
import type { HouseBlockVm } from '@/lib/viewmodel/setBuilding';

import { HouseBlockView } from './HouseBlockView';

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
    },
    {
      key: 'v2',
      name: 'Tầng 2',
      elevation: { text: '+3.300 m', chip: 'Máy đọc từ mặt bằng · 60%', status: 'attention' },
      height: null,
    },
  ],
  roofs: [
    {
      key: 'v2',
      title: 'Mái của Tầng 2',
      rows: [
        {
          label: 'Dạng mái',
          cell: { text: 'Mái hai dốc', chip: 'Máy đọc từ mặt bằng mái · 80%', status: 'neutral' },
        },
        { label: 'Độ dốc', cell: { text: '30°', chip: 'Máy giả định · 30%', status: 'violation' } },
      ],
    },
  ],
  conflicts: [
    {
      key: 'elevationMm:v2',
      title: 'Cốt tầng — Tầng 2',
      candidates: [
        { text: '+3.300 m', source: 'Máy đọc từ mặt bằng · 80%', isChosen: false },
        { text: '+3.600 m', source: 'Máy đọc từ mặt cắt · 90%', isChosen: true },
      ],
    },
  ],
  violations: [
    {
      level: 'error',
      title: 'Lỗi',
      status: 'violation',
      items: [{ key: 'k1', text: 'Tầng 1, Tầng 2: Hai tầng chồng lấn nhau.' }],
    },
    {
      level: 'hint',
      title: 'Gợi ý',
      status: 'neutral',
      items: [{ key: 'k2', text: 'Tầng 2: Mái bằng nhưng không thấy chỗ thoát nước.' }],
    },
  ],
};

const EMPTY: HouseBlockVm = { ...VM, levels: [], roofs: [], conflicts: [], violations: [] };

const renderBlock = (props: Partial<Parameters<typeof HouseBlockView>[0]> = {}) =>
  render(
    <HouseBlockView
      isRefreshing={false}
      onRetry={() => undefined}
      status="ready"
      vm={VM}
      {...props}
    />,
  );

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
    await userEvent.setup({ delay: null }).click(screen.getByRole('button', { name: 'Thử lại' }));
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
  it('nói rõ đây là đề xuất của máy, chỉ để xem, chưa ảnh hưởng tới xác nhận', () => {
    renderBlock();
    expect(
      screen.getByText(/Máy đề xuất, chỉ để xem\. Phần này chưa ảnh hưởng tới việc xác nhận\./u),
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
    expect(within(card).getByText('Mái hai dốc')).toBeTruthy();
    expect(within(card).getByText('Máy giả định · 30%')).toBeTruthy();
  });

  it('mâu thuẫn: liệt kê từng nguồn, nguồn đã chọn có chữ "Đã chọn"', () => {
    renderBlock();
    const items = within(screen.getByRole('list', { name: 'Cốt tầng — Tầng 2' })).getAllByRole(
      'listitem',
    );

    expect(items.map((item) => item.textContent)).toEqual([
      '+3.300 m · Máy đọc từ mặt bằng · 80%',
      '+3.600 m · Máy đọc từ mặt cắt · 90% · Đã chọn',
    ]);
  });

  it('vi phạm: mỗi mức một danh sách có tên', () => {
    renderBlock();
    expect(
      within(screen.getByRole('list', { name: 'Lỗi' })).getByText(
        'Tầng 1, Tầng 2: Hai tầng chồng lấn nhau.',
      ),
    ).toBeTruthy();
    expect(
      within(screen.getByRole('list', { name: 'Gợi ý' })).getAllByRole('listitem'),
    ).toHaveLength(1);
    expect(screen.queryByRole('list', { name: 'Cảnh báo' })).toBeNull();
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
