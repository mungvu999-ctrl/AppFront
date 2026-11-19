// @vitest-environment jsdom
/**
 * Lượt kiểm của bảng "Đề xuất của máy cho cả nhà" (F3): bảy trạng thái, khả năng tiếp cận, tiếng Việt,
 * không màu thô, các nút "Nhận" gọi đúng hàm với đúng đối số, và không phần tử nào mang xanh "đã xác minh" (A5).
 * Dữ liệu dựng từ `proposalArgsFor` của story — cùng bộ với story (R-70).
 */

import { cleanup, fireEvent, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { expectAccessible } from '@/lib/testing/expectAccessible';
import { expectNoRawColor } from '@/lib/testing/expectNoRawColor';
import { expectSevenStates } from '@/lib/testing/expectSevenStates';
import { expectVietnamese } from '@/lib/testing/expectVietnamese';
import { renderWithProviders } from '@/lib/testing/render';
import { createSevenStateScenarios, SEVEN_STATES, type SevenState } from '@/lib/testing/sevenStateScenarios';

import { FloorProposalPanel, type FloorProposalPanelProps } from './FloorProposalPanel';
import { proposalArgsFor } from './FloorProposalPanel.stories';

afterEach(cleanup);

const renderState = (state: SevenState, patch: Partial<FloorProposalPanelProps> = {}) =>
  renderWithProviders(<FloorProposalPanel {...proposalArgsFor(state)} {...patch} />);

describe('bảy trạng thái của A11', () => {
  it('dựng đủ 7/7, không trạng thái nào ra màn trắng', () => {
    let rendered = 0;

    expectSevenStates((scenario) => {
      rendered += 1;

      return renderState(scenario.state);
    }, createSevenStateScenarios());

    expect(rendered).toBe(SEVEN_STATES.length);
  });

  it.each(SEVEN_STATES)('trạng thái %s: dễ tiếp cận và là tiếng Việt có dấu', (state) => {
    const view = renderState(state);

    expectAccessible(view);
    expectVietnamese(view);
  });

  it('không có màu thô trong mã nguồn của bảng', () => {
    expectNoRawColor('src/screens/qc/FloorManager/FloorProposalPanel.tsx');
    expectNoRawColor('src/screens/qc/FloorManager/FloorProposalRow.tsx');
  });

  it('rỗng nói máy chưa có đề xuất; lỗi có nút thử lại gọi onRetry', () => {
    const onRetry = vi.fn();

    renderState('empty');
    expect(screen.getByText('Máy chưa có đề xuất nào')).toBeInTheDocument();
    cleanup();

    renderState('error', { onRetry });
    fireEvent.click(screen.getByRole('button', { name: 'Thử lại' }));
    expect(onRetry).toHaveBeenCalledTimes(1);
  });

  it('thu gọn chỉ còn thanh đầu và nút mở lại; không có bảng', () => {
    const onExpand = vi.fn();

    renderState('collapsed', { onExpand });
    expect(screen.queryByRole('table')).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Mở bảng đề xuất' }));
    expect(onExpand).toHaveBeenCalledTimes(1);
  });

  it('một phần: tầng máy không đề xuất có một dòng nói rõ', () => {
    renderState('partial');
    expect(screen.getByText('Máy chưa có đề xuất cho tầng này')).toBeInTheDocument();
  });
});

describe('bảng đề xuất', () => {
  it('giữ nguyên thứ tự dòng của viewmodel: độ chắc thấp nhất lên đầu', () => {
    const props = proposalArgsFor('success');

    renderWithProviders(<FloorProposalPanel {...props} />);
    const names = within(screen.getByRole('table'))
      .getAllByRole('rowheader')
      .map((header) => header.textContent ?? '');

    props.rows.forEach((row, index) => expect(names[index]).toContain(row.floorName));
  });

  it('nút Nhận gọi onAccept với tầng, ô và giá trị mm đúng; tên nút nêu tầng và ô', () => {
    const onAccept = vi.fn();
    const props = proposalArgsFor('success');

    renderWithProviders(<FloorProposalPanel {...props} onAccept={onAccept} />);
    const row = props.rows.find((entry) => entry.height.acceptable);

    expect(row?.height.proposedMm).not.toBeNull();
    fireEvent.click(screen.getByRole('button', { name: `Nhận chiều cao đề xuất cho ${row?.floorName ?? ''}` }));
    expect(onAccept).toHaveBeenCalledWith(row?.floorId, 'height', row?.height.proposedMm);

    const elevationRow = props.rows.find((entry) => entry.elevation.acceptable);

    fireEvent.click(screen.getByRole('button', { name: `Nhận cao độ đề xuất cho ${elevationRow?.floorName ?? ''}` }));
    expect(onAccept).toHaveBeenLastCalledWith(elevationRow?.floorId, 'elevation', elevationRow?.elevation.proposedMm);
  });

  it('chỉ ô nhận được mới có nút Nhận', () => {
    const props = proposalArgsFor('success');

    renderWithProviders(<FloorProposalPanel {...props} />);
    const expected = props.rows.reduce((sum, row) => sum + Number(row.elevation.acceptable) + Number(row.height.acceptable), 0);

    expect(screen.getAllByRole('button', { name: /^Nhận (cao độ|chiều cao) đề xuất cho / })).toHaveLength(expected);
  });

  it('không có quyền: mọi nút Nhận biến mất, bảng vẫn còn', () => {
    renderState('forbidden');
    expect(screen.getByRole('table')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /^Nhận/ })).not.toBeInTheDocument();
  });

  it('câu hỏi của máy hiện dưới tên tầng', () => {
    const props = proposalArgsFor('success');
    const asking = props.rows.find((row) => row.questions.length > 0);

    renderWithProviders(<FloorProposalPanel {...props} />);
    const list = screen.getByRole('list', { name: `Câu hỏi của máy về ${asking?.floorName ?? ''}` });

    expect(within(list).getAllByRole('listitem')).toHaveLength(asking?.questions.length ?? -1);
  });
});

describe('Nhận tất cả', () => {
  it('nêu số tầng chắc chắn trên nút, gọi onAcceptAll khi bấm', () => {
    const onAcceptAll = vi.fn();
    const props = proposalArgsFor('success');

    expect(props.summary.oneClickCount).toBeGreaterThan(0);
    renderWithProviders(<FloorProposalPanel {...props} onAcceptAll={onAcceptAll} />);
    fireEvent.click(screen.getByRole('button', { name: `Nhận ${props.summary.oneClickCount} đề xuất chắc chắn` }));
    expect(onAcceptAll).toHaveBeenCalledTimes(1);
    expect(screen.getByText('Chỉ nhận các tầng máy chắc chắn và không còn câu hỏi.')).toBeInTheDocument();
  });

  it('tắt khi không tầng nào nhận được bằng một cú bấm', () => {
    const onAcceptAll = vi.fn();

    renderState('success', { summary: { ...proposalArgsFor('success').summary, oneClickCount: 0 }, onAcceptAll });
    const button = screen.getByRole('button', { name: 'Nhận đề xuất chắc chắn' });

    expect(button).toBeDisabled();
    fireEvent.click(button);
    expect(onAcceptAll).not.toHaveBeenCalled();
  });
});

describe('đề xuất của máy không bao giờ là "đã xác minh" (A5)', () => {
  it.each(SEVEN_STATES)('trạng thái %s: không phần tử nào mang token xanh xác minh', (state) => {
    const { container } = renderState(state);

    expect(container.querySelector('[class*="state-verified"]')).toBeNull();
  });

  it('mã verified lọt vào từ viewmodel vẫn bị hạ về trung tính', () => {
    const props = proposalArgsFor('success');
    const [first, ...rest] = props.rows;

    if (first === undefined) {
      throw new Error('bộ mẫu không có dòng nào');
    }
    const forged = { ...first, storeyStatusCode: 'verified' as const, elevation: { ...first.elevation, statusCode: 'verified' as const } };
    const { container } = renderWithProviders(<FloorProposalPanel {...props} rows={[forged, ...rest]} />);

    expect(container.querySelector('[class*="state-verified"]')).toBeNull();
  });

  it('mọi giá trị máy đưa ra mang chữ "máy đề xuất" và độ chắc bằng lời, không chỉ bằng màu', () => {
    renderState('success');
    expect(screen.getByText('Đây là đề xuất của máy, chưa có người duyệt.')).toBeInTheDocument();
    expect(screen.getAllByText(/máy đề xuất/).length).toBeGreaterThan(0);
    expect(screen.getAllByText(/Hai nguồn khớp|Một nguồn|Chưa chắc/).length).toBeGreaterThan(0);
  });
});
