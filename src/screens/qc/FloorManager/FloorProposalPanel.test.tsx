// @vitest-environment jsdom
/**
 * Lượt kiểm của bảng "Đề xuất của máy cho cả nhà" (F3): bảy trạng thái, khả năng tiếp cận, tiếng Việt,
 * không màu thô, từng ô nhận riêng (không nhận hàng loạt), số giả định không có nút, tiêu điểm sau khi
 * nhận, và không phần tử nào mang xanh "đã xác minh" (A5) ở bất kỳ trạng thái nào.
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
import { MOCK_HOUSE_PROPOSAL } from '@/api/__mocks__/client';
import { type HouseProposalRowVm, summarise, toHouseProposalRows } from '@/lib/viewmodel/houseProposal';

import { FloorProposalPanel, type FloorProposalPanelProps } from './FloorProposalPanel';
import { PROPOSAL_SAMPLE_FLOORS, proposalArgsFor, SECTION_ARGS } from './FloorProposalPanel.stories';

afterEach(cleanup);

const renderState = (state: SevenState, patch: Partial<FloorProposalPanelProps> = {}) =>
  renderWithProviders(<FloorProposalPanel {...proposalArgsFor(state)} {...patch} />);

const ACCEPT_BUTTON = /^Nhận (cao độ|chiều cao) đề xuất cho /;
const FIELDS = ['elevation', 'height'] as const;

const SUCCESS = proposalArgsFor('success');
const find = (predicate: (row: HouseProposalRowVm) => boolean): HouseProposalRowVm => {
  const row = SUCCESS.rows.find(predicate);
  if (row === undefined) throw new Error('bộ mẫu thiếu dòng cần cho bài kiểm');
  return row;
};
const HEIGHT_ROW = find((row) => row.height.acceptable);
const HEIGHT_NAME = `Nhận chiều cao đề xuất cho ${HEIGHT_ROW.floorName}: ${HEIGHT_ROW.height.proposedText}`;
/** Nút "Nhận" của một ô bất kể giá trị trong tên: `Nhận <ô> đề xuất cho <tầng>: <giá trị>`. */
const acceptNameOf = (row: HouseProposalRowVm, f: (typeof FIELDS)[number]) => (name: string) =>
  name.startsWith(`Nhận ${f === 'height' ? 'chiều cao' : 'cao độ'} đề xuất cho ${row.floorName}:`);
const withRow = (row: HouseProposalRowVm) => SUCCESS.rows.map((item) => (item.floorId === row.floorId ? row : item));

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

  it('lỗi: một dòng lặng trong thanh + "Thử lại", không báo đỏ', () => {
    const onRetry = vi.fn();

    renderState('error', { onRetry });
    expect(screen.getByText('Chưa lấy được đề xuất của máy.')).toBeInTheDocument();
    expect(screen.queryByRole('alert')).toBeNull();
    expect(screen.queryByRole('table')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Thử lại' }));
    expect(onRetry).toHaveBeenCalledTimes(1);
  });

  it('thu gọn: tên, câu tóm tắt và đúng một nút "Xem đề xuất" (aria-expanded=false)', () => {
    const onToggleExpanded = vi.fn();
    const props = proposalArgsFor('collapsed');

    renderState('collapsed', { onToggleExpanded });
    expect(screen.queryByRole('table')).toBeNull();
    expect(screen.getByText('Đề xuất của máy cho cả nhà')).toBeInTheDocument();
    expect(screen.getByText(props.summary.headline)).toBeInTheDocument();
    expect(screen.getAllByRole('button')).toHaveLength(1);
    fireEvent.click(screen.getByRole('button', { name: 'Xem đề xuất', expanded: false }));
    expect(onToggleExpanded).toHaveBeenCalledTimes(1);
  });

  it('thành công mà chưa mở: chỉ thanh; mở rồi thì có bảng và nút đổi thành "Ẩn đề xuất"', () => {
    renderState('success', { expanded: false });
    expect(screen.queryByRole('table')).toBeNull();
    expect(screen.getByRole('button', { name: 'Xem đề xuất', expanded: false })).toBeInTheDocument();
    cleanup();

    renderState('success', { expanded: true });
    expect(screen.getByRole('table')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Ẩn đề xuất', expanded: true })).toBeInTheDocument();
  });

  it('một phần: tầng máy không đề xuất có một dòng nói rõ', () => {
    const props = proposalArgsFor('partial');
    const missing = props.rows.find((row) => !row.hasProposal);

    renderState('partial');
    expect(screen.getByText(missing?.noProposalText ?? '?')).toBeInTheDocument();
  });
});

describe('bảng đề xuất', () => {
  it('ghi chú "chưa có người duyệt" đúng một lần; bảng có caption và ba tiêu đề cột', () => {
    renderState('success');
    expect(screen.getAllByText('Đây là đề xuất của máy, chưa có người duyệt.')).toHaveLength(1);
    const table = screen.getByRole('table', { name: /Đề xuất của máy theo từng tầng/ });
    expect(within(table).getAllByRole('columnheader').map((th) => th.textContent)).toEqual([
      'Tầng',
      'Cao độ (hiện tại → đề xuất)',
      'Chiều cao (hiện tại → đề xuất)',
    ]);
  });

  it('giữ nguyên thứ tự dòng của viewmodel: thứ tự tầng của dự án', () => {
    renderState('success');
    const names = within(screen.getByRole('table'))
      .getAllByRole('rowheader')
      .map((header) => header.textContent ?? '');

    SUCCESS.rows.forEach((row, index) => expect(names[index]).toContain(row.floorName));
  });

  it('không có nút nhận hàng loạt ở bất kỳ trạng thái nào', () => {
    for (const state of SEVEN_STATES) {
      renderState(state);
      expect(screen.queryByRole('button', { name: /tất cả|hàng loạt|các đề xuất/i })).toBeNull();
      cleanup();
    }
  });

  it('nút "Nhận" gọi onAccept(dòng, ô); tên có giá trị đề xuất, câu "Nhận sẽ…" là mô tả của nút trước khi bấm', () => {
    const onAccept = vi.fn();
    const effect = 'Nhận sẽ dời cao độ Tầng 2, Tầng 3 (−300 mm)';
    const row = { ...HEIGHT_ROW, height: { ...HEIGHT_ROW.height, effectText: effect } };

    renderState('success', { onAccept, rows: withRow(row) });
    const button = screen.getByRole('button', { name: HEIGHT_NAME });
    expect(button).toHaveAccessibleDescription(effect);
    expect(button.parentElement).toHaveTextContent(effect);
    fireEvent.click(button);
    expect(onAccept).toHaveBeenCalledWith(row, 'height');
  });

  it('mỗi ô hiện hiện tại → đề xuất có đơn vị và chênh có dấu, độ chắc bằng lời và nguồn', () => {
    renderState('success');
    const cell = screen.getByRole('button', { name: HEIGHT_NAME }).closest('td');
    const { height } = HEIGHT_ROW;

    expect(cell).toHaveTextContent(height.currentText);
    expect(cell).toHaveTextContent(height.proposedText);
    expect(cell).toHaveTextContent(height.deltaText ?? '?');
    expect(cell).toHaveTextContent(height.confidenceLabel ?? '?');
    expect(cell).toHaveTextContent(height.sourceText ?? '?');
  });

  it('chỉ ô nhận được mới có nút "Nhận"; số giả định không có nút mà có lời giải thích', () => {
    renderState('success');
    const expected = SUCCESS.rows.reduce((sum, row) => sum + Number(row.elevation.acceptable) + Number(row.height.acceptable), 0);
    expect(screen.getAllByRole('button', { name: ACCEPT_BUTTON })).toHaveLength(expected);

    const assumed = SUCCESS.rows.flatMap((row) => FIELDS.filter((f) => row[f].sourceKind === 'assumed').map((f) => ({ row, f })));
    expect(assumed.length).toBeGreaterThan(0);
    for (const { row, f } of assumed) {
      expect(row[f].acceptable).toBe(false);
      expect(screen.queryByRole('button', { name: acceptNameOf(row, f) })).toBeNull();
    }
    expect(screen.getAllByText(new RegExp(assumed[0]?.row[assumed[0].f].hint ?? '?')).length).toBeGreaterThan(0);
  });

  it('busy: mọi nút "Nhận" tắt bằng aria-disabled, bấm không gọi onAccept', () => {
    const onAccept = vi.fn();

    renderState('success', { busy: true, onAccept });
    for (const button of screen.getAllByRole('button', { name: ACCEPT_BUTTON })) {
      expect(button).toHaveAttribute('aria-disabled', 'true');
      fireEvent.click(button);
    }
    expect(onAccept).not.toHaveBeenCalled();
  });

  it('tiêu điểm ở lại nút "Nhận" khi lượt ghi chạy và sau khi hỏng', () => {
    const view = renderState('success');
    screen.getByRole('button', { name: HEIGHT_NAME }).focus();

    view.rerender(<FloorProposalPanel {...SUCCESS} busy />);
    expect(screen.getByRole('button', { name: HEIGHT_NAME })).toHaveFocus();
    view.rerender(<FloorProposalPanel {...SUCCESS} message="Chưa nhận được: chưa ghi được." />);
    expect(screen.getByRole('button', { name: HEIGHT_NAME })).toHaveFocus();
    expect(screen.getByRole('button', { name: HEIGHT_NAME })).not.toHaveAttribute('aria-disabled');
  });

  it('không có quyền: mọi nút "Nhận" biến mất, bảng vẫn còn', () => {
    renderState('forbidden');
    expect(screen.getByRole('table')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /^Nhận/ })).toBeNull();
  });

  it('ô không nhận được vì lý do (không phải số giả định): hiện đúng lý do, không có nút', () => {
    const reason = 'Đặt ở cao độ này thì tầng chạm lên tầng trên. Nhập tay ở bảng tầng.';
    const row = { ...HEIGHT_ROW, height: { ...HEIGHT_ROW.height, acceptable: false, blockedReason: reason, effectText: null } };

    expect(row.height.sourceKind).not.toBe('assumed');
    renderState('success', { rows: withRow(row) });
    expect(screen.getByText(reason)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: acceptNameOf(row, 'height') })).toBeNull();
  });

  it('tầng trên tầng thấp nhất: hiện câu đối chiếu cao độ; lệch thì có chip "Cần xem"', () => {
    const checked = SUCCESS.rows.filter((row) => row.elevationCheck !== null);

    renderState('success');
    expect(checked.length).toBeGreaterThan(0);
    for (const row of checked) {
      expect(screen.getAllByText(row.elevationCheck?.text ?? '?').length).toBeGreaterThan(0);
    }
    expect(SUCCESS.rows[0]?.elevationCheck ?? null).toBeNull();
  });

  it('cao độ máy đọc lệch với cộng dồn: chip "Cần xem" cạnh câu đối chiếu', () => {
    const text = 'Máy đọc cao độ 7.200 mm; cộng dồn chiều cao ra 7.500 mm.';
    const row = {
      ...HEIGHT_ROW,
      elevationCheck: { stackedMm: 7500, stackedText: '7.500 mm', differenceMm: -300, agrees: false, text },
    };

    renderState('success', { rows: withRow(row) });
    expect(screen.getByText(text, { exact: false })).toHaveTextContent('Cần xem');
  });

  it('câu hỏi nằm dưới đúng chỗ: cả dòng dưới tên tầng, của ô dưới ô đó', () => {
    renderState('success');
    for (const row of SUCCESS.rows) {
      if (row.questionsFor.row.length > 0) {
        const list = screen.getByRole('list', { name: `Câu hỏi của máy về ${row.floorName}` });
        expect(list.closest('th')).not.toBeNull();
        expect(within(list).getAllByRole('listitem')).toHaveLength(row.questionsFor.row.length);
      }
      for (const f of FIELDS) {
        if (row.questionsFor[f].length > 0) {
          const name = `Câu hỏi của máy về ${f === 'height' ? 'chiều cao' : 'cao độ'} ${row.floorName}`;
          expect(screen.getByRole('list', { name }).closest('td')).not.toBeNull();
        }
      }
    }
    expect(SUCCESS.rows.some((row) => row.questionsFor.row.length + row.questionsFor.elevation.length + row.questionsFor.height.length > 0)).toBe(true);
  });
});

describe('sau khi nhận', () => {
  it('tiêu điểm về ô đầu dòng (tabIndex -1) của tầng vừa nhận', () => {
    const view = renderState('success');
    view.rerender(<FloorProposalPanel {...SUCCESS} focus={{ floorId: HEIGHT_ROW.floorId }} />);
    const header = screen.getByRole('rowheader', { name: new RegExp(HEIGHT_ROW.floorName) });

    expect(header).toHaveAttribute('tabindex', '-1');
    expect(header).toHaveFocus();
  });

  it('ô đã nhận (không còn khác) hiện "Đã nhận từ đề xuất của máy"; thông báo nằm trong vùng lịch sự', () => {
    const settled: HouseProposalRowVm = {
      ...HEIGHT_ROW,
      height: { ...HEIGHT_ROW.height, differs: false, acceptable: false, deltaText: null, effectText: null },
    };
    const rows = SUCCESS.rows.map((row) => (row.floorId === HEIGHT_ROW.floorId ? settled : row));

    const { container } = renderState('success', { rows, accepted: new Set([`${HEIGHT_ROW.floorId}:height`]), message: 'Đã nhận chiều cao.' });
    expect(screen.getByText('Đã nhận từ đề xuất của máy')).toBeInTheDocument();
    expect(screen.getByRole('status')).toHaveTextContent('Đã nhận chiều cao.');
    expect(screen.getByRole('status')).toHaveAttribute('aria-live', 'polite');
    expect(screen.getByRole('status')).not.toHaveClass('sr-only');
    expect(container.querySelectorAll('[aria-live], [role="status"]')).toHaveLength(1);
  });

  it('nhận hỏng: câu "Chưa nhận được: …" trong vùng lịch sự, nút vẫn còn', () => {
    renderState('success', { message: 'Chưa nhận được: chưa ghi được.' });
    expect(screen.getByRole('status')).toHaveTextContent('Chưa nhận được: chưa ghi được.');
    expect(screen.getByRole('button', { name: HEIGHT_NAME })).toBeEnabled();
  });
});

describe('đề xuất của máy không bao giờ là "đã xác minh" (A5)', () => {
  it.each(SEVEN_STATES)('trạng thái %s: không phần tử nào mang token xanh xác minh', (state) => {
    const { container } = renderState(state);

    expect(container.querySelector('[class*="verified"]')).toBeNull();
  });

  it('cả sau khi nhận và khi viewmodel lọt mã verified: vẫn trung tính', () => {
    const [first, ...rest] = SUCCESS.rows;

    if (first === undefined) {
      throw new Error('bộ mẫu không có dòng nào');
    }
    const forged = { ...first, storeyStatusCode: 'verified' as const, elevation: { ...first.elevation, statusCode: 'verified' as const } };
    const accepted = new Set(SUCCESS.rows.flatMap((row) => FIELDS.map((f) => `${row.floorId}:${f}`)));
    const { container } = renderState('success', { rows: [forged, ...rest], accepted });

    expect(container.querySelector('[class*="verified"]')).toBeNull();
  });
});

describe('đánh dấu mặt cắt', () => {
  it('mỗi dòng có nút với tên truy cập theo tầng; dòng mặt cắt có nhãn và nút bỏ dấu', () => {
    const onToggleSection = vi.fn();
    renderWithProviders(<FloorProposalPanel {...SECTION_ARGS} onToggleSection={onToggleSection} />);
    const marked = SECTION_ARGS.rows.filter((row) => row.isSection);
    expect(marked.map((row) => row.floorName)).toEqual(['Tầng 3']);

    for (const row of SECTION_ARGS.rows.filter((item) => !item.isSection)) {
      expect(screen.getByRole('button', { name: `Đánh dấu bản vẽ của ${row.floorName} là mặt cắt` })).toHaveTextContent('Đây là mặt cắt');
    }
    const unmark = screen.getByRole('button', { name: 'Bỏ đánh dấu mặt cắt cho Tầng 3' });
    expect(unmark).toHaveTextContent('Không phải mặt cắt');
    expect(screen.getByText(/Bạn đã đánh dấu bản vẽ này là mặt cắt/)).toBeInTheDocument();
    expect(screen.getByText(/Có bản vẽ mặt cắt\? Tải nó lên như một tầng thêm/)).toBeInTheDocument();
    fireEvent.click(unmark);
    expect(onToggleSection).toHaveBeenCalledWith(marked[0]);
  });

  it('đang gửi: nút aria-disabled và không gọi lại; câu kết quả ở dòng status', () => {
    const onToggleSection = vi.fn();
    const message = 'Đã đánh dấu Tầng 3 là mặt cắt. Tầng này được ẩn khỏi 3D.';
    renderWithProviders(<FloorProposalPanel {...SECTION_ARGS} busy message={message} onToggleSection={onToggleSection} />);
    const unmark = screen.getByRole('button', { name: 'Bỏ đánh dấu mặt cắt cho Tầng 3' });
    expect(unmark).toHaveAttribute('aria-disabled', 'true');
    fireEvent.click(unmark);
    expect(onToggleSection).not.toHaveBeenCalled();
    expect(screen.getByRole('status')).toHaveTextContent(message);
  });

  it('chỉ đọc: không có nút đánh dấu', () => {
    renderState('forbidden');
    expect(screen.queryByRole('button', { name: /mặt cắt/ })).toBeNull();
  });

  it('chỉ còn dòng mặt cắt: vẫn có bảng, nút bỏ dấu và vùng status', () => {
    const rows = SECTION_ARGS.rows.filter((row) => row.isSection);
    renderWithProviders(<FloorProposalPanel {...SECTION_ARGS} message="Đã đánh dấu Tầng 3 là mặt cắt." rows={rows} summary={summarise(rows)} />);
    expect(screen.getByRole('table')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Bỏ đánh dấu mặt cắt cho Tầng 3' })).toBeInTheDocument();
    expect(screen.getByRole('status')).toHaveTextContent('Đã đánh dấu Tầng 3 là mặt cắt.');
  });

  it('trống: vùng status vẫn có và đọc câu kết quả', () => {
    renderState('empty', { message: 'Đã bỏ đánh dấu mặt cắt cho Tầng 3.' });
    expect(screen.getByRole('status')).toHaveTextContent('Đã bỏ đánh dấu mặt cắt cho Tầng 3.');
  });

  it('tầng không có trong đề xuất của máy chủ: không có nút; dòng máy hỏi NOT_A_PLAN không số: vẫn có nút', () => {
    const notAPlan = toHouseProposalRows(
      {
        ...MOCK_HOUSE_PROPOSAL,
        floors: [{ floorId: 'L-00000000L2', kind: 'section', kindConfidence: 0.9, storeyConfidence: 0.5, questions: [{ code: 'NOT_A_PLAN' }] }],
      },
      PROPOSAL_SAMPLE_FLOORS,
    );
    renderWithProviders(<FloorProposalPanel {...SECTION_ARGS} rows={notAPlan} summary={summarise(notAPlan)} />);
    expect(screen.getByRole('button', { name: 'Đánh dấu bản vẽ của Tầng 2 là mặt cắt' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Đánh dấu bản vẽ của Tầng 1 là mặt cắt' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Đánh dấu bản vẽ của Tầng 3 là mặt cắt' })).toBeNull();
  });
});
