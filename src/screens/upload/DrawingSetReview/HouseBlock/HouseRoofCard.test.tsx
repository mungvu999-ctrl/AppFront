import { cleanup, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { expectAccessible } from '@/lib/testing/expectAccessible';
import { expectVietnamese } from '@/lib/testing/expectVietnamese';
import type { HouseRoofCard as HouseRoofCardVm } from '@/lib/viewmodel/setBuilding';
import type { HouseActions } from '@/lib/viewmodel/setBuildingDecisions';

import { HouseRoofCard } from './HouseRoofCard';

const machine = (text: string) =>
  ({ text, chip: 'Máy giả định · 30%', status: 'violation' }) as const;
const typed = (text: string) => ({ text, chip: 'Người duyệt nhập', status: 'verified' }) as const;

const FORMS = [
  { value: 'flat', label: 'Mái bằng' },
  { value: 'shed', label: 'Mái một dốc' },
  { value: 'gable', label: 'Mái hai dốc' },
  { value: 'hip', label: 'Mái bốn dốc' },
];
const MATERIALS = [
  { value: 'tile', label: 'Ngói' },
  { value: 'metal', label: 'Tôn' },
  { value: 'shingle', label: 'Tấm lợp bitum' },
];

const CARD: HouseRoofCardVm = {
  key: 'v2',
  title: 'Mái của Tầng 2',
  isSkipped: false,
  rows: [
    {
      field: 'form',
      label: 'Dạng mái',
      lower: 'dạng mái',
      cell: machine('Mái hai dốc'),
      isTyped: false,
      edit: { kind: 'choice', value: 'gable', options: FORMS },
    },
    {
      field: 'pitchDeg',
      label: 'Độ dốc',
      lower: 'độ dốc',
      cell: machine('30°'),
      isTyped: false,
      edit: { kind: 'number', typedText: '' },
    },
    {
      field: 'quarterTurns',
      label: 'Hướng mái',
      lower: 'hướng mái',
      cell: machine('Không xoay'),
      isTyped: false,
      edit: { kind: 'turn', next: 1 },
    },
    {
      field: 'eaveElevationMm',
      label: 'Cốt diềm',
      lower: 'cốt diềm',
      cell: null,
      isTyped: false,
      edit: { kind: 'number', typedText: '' },
    },
    {
      field: 'overhangMm',
      label: 'Độ đua',
      lower: 'độ đua',
      cell: typed('450 mm'),
      isTyped: true,
      edit: { kind: 'number', typedText: '450' },
    },
    {
      field: 'material',
      label: 'Vật liệu',
      lower: 'vật liệu',
      cell: typed('Tôn'),
      isTyped: true,
      edit: { kind: 'choice', value: 'metal', options: MATERIALS },
    },
  ],
};

const actionsOf = () => ({
  setLevel: vi.fn<HouseActions['setLevel']>(),
  setRoofSkip: vi.fn<HouseActions['setRoofSkip']>(),
  setRoof: vi.fn<HouseActions['setRoof']>(),
  pick: vi.fn<HouseActions['pick']>(),
  markSeen: vi.fn<HouseActions['markSeen']>(),
});

const renderCard = (card: HouseRoofCardVm = CARD) => {
  const actions = actionsOf();
  const view = render(<HouseRoofCard actions={actions} card={card} />);

  return { actions, ...view, user: userEvent.setup({ delay: null }) };
};

afterEach(cleanup);

describe('HouseRoofCard — sửa thông số mái (NHA-08c)', () => {
  it('dạng mái là một nhóm chọn một có nhãn, đang chọn giá trị hiệu lực; chọn dạng khác ghi đúng mã', async () => {
    const { actions, user } = renderCard();
    const group = screen.getByRole('radiogroup', { name: 'Dạng mái:' });

    expect(within(group).getAllByRole('radio')).toHaveLength(4);
    expect(within(group).getByRole('radio', { name: 'Mái hai dốc' })).toHaveProperty(
      'checked',
      true,
    );
    await user.click(within(group).getByRole('radio', { name: 'Mái bốn dốc' }));
    expect(actions.setRoof).toHaveBeenCalledWith('v2', 'form', 'hip');
  });

  it('độ dốc: "Sửa" mở ô nhập nhận độ, phần trăm hoặc tỉ lệ; Enter ghi số đã quy về độ', async () => {
    const { actions, user } = renderCard();

    await user.click(screen.getByRole('button', { name: 'Sửa độ dốc — Mái của Tầng 2' }));
    await user.type(
      screen.getByRole('textbox', { name: 'Độ dốc — Mái của Tầng 2 (°, % hoặc x:12)' }),
      '6:12{Enter}',
    );
    expect(actions.setRoof).toHaveBeenCalledWith('v2', 'pitchDeg', 26.6);
    expect(screen.queryByRole('textbox')).toBeNull();
  });

  it('chữ lạ hoặc số ngoài khoảng: báo ngay dưới ô, không ghi; Esc đóng ô mà không ghi', async () => {
    const { actions, user } = renderCard();

    await user.click(screen.getByRole('button', { name: 'Sửa độ dốc — Mái của Tầng 2' }));
    const input = screen.getByRole('textbox');

    await user.type(input, 'dốc vừa{Enter}');
    expect(
      screen.getByText('Nhập độ dốc theo độ, phần trăm hoặc tỉ lệ, ví dụ 30°, 58% hoặc 7:12.'),
    ).toBeTruthy();
    await user.clear(input);
    await user.type(input, '85{Enter}');
    expect(screen.getByText('Độ dốc phải từ 0° đến dưới 85°.')).toBeTruthy();
    await user.keyboard('{Escape}');
    expect(screen.queryByRole('textbox')).toBeNull();
    expect(actions.setRoof).not.toHaveBeenCalled();
  });

  it('trường máy chưa có số (cốt diềm) hiện gạch ngang và vẫn nhập được theo mm', async () => {
    const { actions, user } = renderCard();

    await user.click(screen.getByRole('button', { name: 'Sửa cốt diềm — Mái của Tầng 2' }));
    const input = screen.getByRole('textbox', { name: 'Cốt diềm — Mái của Tầng 2 (mm)' });

    await user.type(input, '6,6{Enter}');
    expect(screen.getByText('Nhập số nguyên theo mm.')).toBeTruthy();
    await user.clear(input);
    await user.type(input, '6600{Enter}');
    expect(actions.setRoof).toHaveBeenCalledWith('v2', 'eaveElevationMm', 6600);
  });

  it('"Xoay 90°" ghi số lần xoay kế tiếp', async () => {
    const { actions, user } = renderCard();

    await user.click(screen.getByRole('button', { name: 'Xoay 90° hướng mái — Mái của Tầng 2' }));
    expect(actions.setRoof).toHaveBeenCalledWith('v2', 'quarterTurns', 1);
  });

  it('trường người duyệt đã nhập có nút bỏ để quay về giá trị của máy; trường của máy thì không', async () => {
    const { actions, user } = renderCard();

    await user.click(screen.getByRole('button', { name: 'Bỏ lựa chọn vật liệu — Mái của Tầng 2' }));
    expect(actions.setRoof).toHaveBeenLastCalledWith('v2', 'material', undefined);
    // Nút vừa bấm sắp biến mất: tiêu điểm về lựa chọn đang chọn của chính dòng đó, không rơi ra đầu trang.
    expect(document.activeElement).toBe(screen.getByRole('radio', { name: 'Tôn' }));
    await user.click(screen.getByRole('button', { name: 'Bỏ số đã nhập cho độ đua — Mái của Tầng 2' }));
    expect(actions.setRoof).toHaveBeenLastCalledWith('v2', 'overhangMm', undefined);
    expect(
      screen.queryByRole('button', { name: 'Bỏ lựa chọn dạng mái — Mái của Tầng 2' }),
    ).toBeNull();
    expect(screen.queryByRole('button', { name: 'Bỏ số đã nhập cho độ dốc — Mái của Tầng 2' })).toBeNull();
  });

  it('ô sửa của số đã nhập điền sẵn số đó', async () => {
    const { user } = renderCard();

    await user.click(screen.getByRole('button', { name: 'Sửa độ đua — Mái của Tầng 2' }));
    expect(screen.getByRole('textbox', { name: 'Độ đua — Mái của Tầng 2 (mm)' })).toHaveProperty(
      'value',
      '450',
    );
  });

  it('bàn phím: mở ô bằng Enter, gõ, Enter ghi; tiêu điểm quay về nút "Sửa" của dòng đó', async () => {
    const { actions, user } = renderCard();
    const edit = screen.getByRole('button', { name: 'Sửa độ dốc — Mái của Tầng 2' });

    edit.focus();
    await user.keyboard('{Enter}');
    expect(document.activeElement).toBe(screen.getByRole('textbox'));
    await user.keyboard('35{Enter}');
    expect(actions.setRoof).toHaveBeenCalledWith('v2', 'pitchDeg', 35);
    expect(document.activeElement).toBe(
      screen.getByRole('button', { name: 'Sửa độ dốc — Mái của Tầng 2' }),
    );
  });

  it('"Không dựng mái, tôi tự vẽ" khoá thẻ: còn giá trị để đọc, không còn ô chọn, nút sửa hay nút xoay', async () => {
    const { actions, user } = renderCard({ ...CARD, isSkipped: true });
    const card = screen.getByRole('group', { name: 'Mái của Tầng 2' });

    expect(within(card).getByText('Mái hai dốc')).toBeTruthy();
    expect(within(card).queryByRole('radio')).toBeNull();
    expect(within(card).queryByRole('button')).toBeNull();
    const box = within(card).getByRole('checkbox', { name: 'Không dựng mái, tôi tự vẽ' });

    expect(box).toHaveProperty('checked', true);
    await user.click(box);
    expect(actions.setRoofSkip).toHaveBeenCalledWith('v2', false);
  });

  it('chữ tiếng Việt và khả năng tiếp cận, cả khi ô sửa đang mở', async () => {
    const { container, user } = renderCard();

    // "bitum" là tên vật liệu đã thành từ tiếng Việt (tấm lợp bitum), không phải chữ Anh sót lại.
    expectVietnamese(container, { allowWords: ['bitum'] });
    expectAccessible(container);
    await user.click(screen.getByRole('button', { name: 'Sửa độ dốc — Mái của Tầng 2' }));
    expectAccessible(container);
  });
});
