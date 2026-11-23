/**
 * Màn "Tải cả bộ hồ sơ" (K-32b) trên MOCK: cổng dựng trên `createMockApiClient()` (công tắc N52, tầng của
 * dự án) và `createMockDrawingSetClient()` (N54–N61), đúng phép ánh xạ mà bản sản phẩm dùng (R-70).
 */

import { cleanup, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { createMockApiClient, MOCK_HOUSE_PROPOSAL_DISABLED_PROJECT_ID } from '@/api/__mocks__/client';
import { __resetMockDrawingSets, createMockDrawingSetClient, type MockDrawingSetOptions } from '@/api/__mocks__/drawingSetClient';
import type { DrawingSetClient } from '@/api/drawingSetClient';
import { expectVietnamese } from '@/lib/testing/expectVietnamese';

import { DrawingSetContainer } from './DrawingSetReview.container';
import { createDrawingSetGateway, type DrawingSetGateway } from './drawingSetGateway';

const PROJECT = 'project-1';
/** Tầng có bản vẽ sẵn của dự án mẫu (`makeFloor('L1')`). */
const OCCUPIED_FLOOR = 'L-00000000L1';

const pdf = (name: string, pages: number): File =>
  new File([`%PDF-1.4\n${'<< /Type /Page >>\n'.repeat(pages)}`], name, { type: 'application/pdf' });
const png = (name: string): File => new File([new Uint8Array(8)], name, { type: 'image/png' });

function gatewayOf(options: MockDrawingSetOptions & { projectId?: string } = {}): { gateway: DrawingSetGateway; sets: DrawingSetClient } {
  const sets = createMockDrawingSetClient({ occupiedFloorIds: [OCCUPIED_FLOOR], ...options });
  const gateway = createDrawingSetGateway(sets, createMockApiClient());

  return { gateway, sets };
}

/** Một bộ đã tải xong ở máy chủ giả, sẵn sàng cho màn mở bằng `setId`. */
async function seedSet(sets: DrawingSetClient, fileName = 'bo-6-trang.pdf'): Promise<string> {
  const created = await sets.createSet({ projectId: PROJECT, body: { files: [{ fileName, mimeType: 'application/pdf', sizeBytes: 100 }] } });

  if (!created.ok) throw new Error('create');
  await sets.complete({ projectId: PROJECT, setId: created.data.id });

  return created.data.id;
}

/** Ô chọn tầng tắt tới khi danh sách tầng của dự án về; chờ nó bật rồi mới chọn. */
async function chooseNewFloor(ui: ReturnType<typeof userEvent.setup>, card: HTMLElement): Promise<void> {
  const select = within(card).getByLabelText('Tầng của hình này') as HTMLSelectElement;

  await waitFor(() => expect(select.disabled).toBe(false));
  await ui.selectOptions(select, 'Tạo tầng mới');
}

const renderScreen = (props: Partial<Parameters<typeof DrawingSetContainer>[0]> & { gateway: DrawingSetGateway }) =>
  render(
    <MemoryRouter>
      <DrawingSetContainer pollMs={10} projectId={PROJECT} roles={['engineer']} saveDelayMs={10} {...props} />
    </MemoryRouter>,
  );

beforeEach(() => {
  __resetMockDrawingSets();
});
afterEach(cleanup);

describe('công tắc tắt / không có quyền: không affordance nào (R-69)', () => {
  it('công tắc tắt (N52 enabled: false): một câu và lối về, không ô chọn tệp, không nút tải', async () => {
    const { gateway } = gatewayOf();

    renderScreen({ gateway, projectId: MOCK_HOUSE_PROPOSAL_DISABLED_PROJECT_ID });
    expect(await screen.findByText(/đang tắt/u)).toBeTruthy();
    expect(screen.queryByTestId('drawing-set-file-input')).toBeNull();
    expect(screen.queryByRole('button', { name: /chọn tệp|tải lên|xác nhận/iu })).toBeNull();
    expect(screen.getByRole('button', { name: 'Về Duyệt tầng' })).toBeTruthy();
  });

  it('vai người xem: không tải được, không nút tải', async () => {
    const { gateway } = gatewayOf();

    renderScreen({ gateway, roles: ['viewer'] });
    expect(await screen.findByText(/không tải được bản vẽ/u)).toBeTruthy();
    expect(screen.queryByTestId('drawing-set-file-input')).toBeNull();
    expect(screen.queryByRole('button', { name: /chọn tệp|tải lên/iu })).toBeNull();
  });

  it('công tắc tắt giữa chừng (503 ở N54): màn chuyển sang pha tắt, nút rời DOM', async () => {
    const { gateway } = gatewayOf({ enabled: false });
    // N52 vẫn nói bật (đọc cũ), nhưng ghi trả 503 `DRAWING_SET_DISABLED`.
    const ui = userEvent.setup({ delay: null, applyAccept: false });

    renderScreen({ gateway: { ...gateway, readEnabled: async () => ({ ok: true, data: true }) } });
    await ui.upload(await screen.findByTestId('drawing-set-file-input'), pdf('a.pdf', 2));
    await waitFor(() => expect((screen.getByRole('button', { name: 'Tải lên' }) as HTMLButtonElement).disabled).toBe(false));
    await ui.click(screen.getByRole('button', { name: 'Tải lên' }));
    expect(await screen.findByText(/đang tắt/u)).toBeTruthy();
    expect(screen.queryByTestId('drawing-set-file-input')).toBeNull();
  });
});

describe('chọn tệp: giới hạn nói rõ, không gửi byte nào khi vượt', () => {
  it('21 tệp → nói số tệp và cách gỡ, nút "Tải lên" tắt; bỏ bớt thì bật', async () => {
    const { gateway, sets } = gatewayOf();
    const create = vi.spyOn(sets, 'createSet');
    const ui = userEvent.setup({ delay: null, applyAccept: false });

    renderScreen({ gateway });
    const input = await screen.findByTestId('drawing-set-file-input');

    await ui.upload(input, Array.from({ length: 21 }, (_, index) => png(`t${String(index)}.png`)));
    expect(await screen.findByText(/21 tệp, tối đa 20 tệp/u)).toBeTruthy();
    expect((screen.getByRole('button', { name: 'Tải lên' }) as HTMLButtonElement).disabled).toBe(true);
    await ui.click(screen.getByRole('button', { name: 'Bỏ t0.png' }));
    await waitFor(() => expect((screen.getByRole('button', { name: 'Tải lên' }) as HTMLButtonElement).disabled).toBe(false));
    expect(create).not.toHaveBeenCalled();
  });

  it('PDF 21 trang và .dwg bị từ chối đúng tên tệp; tệp tốt vẫn tải được', async () => {
    const { gateway } = gatewayOf();
    const ui = userEvent.setup({ delay: null, applyAccept: false });

    renderScreen({ gateway });
    await ui.upload(await screen.findByTestId('drawing-set-file-input'), [
      pdf('dai.pdf', 21),
      new File([new Uint8Array(4)], 'ban-ve.dwg'),
      png('tot.png'),
    ]);
    expect(await screen.findByText(/dai\.pdf: 21 trang, mỗi PDF tối đa 20 trang/u)).toBeTruthy();
    expect(screen.getByText(/ban-ve\.dwg: Bản vẽ CAD/u)).toBeTruthy();
    await waitFor(() => expect((screen.getByRole('button', { name: 'Tải lên' }) as HTMLButtonElement).disabled).toBe(false));
  });

  it('cả bộ 41 trang → câu nói số trang đang có; chữ không hứa điều chưa có', async () => {
    const { gateway } = gatewayOf();
    const ui = userEvent.setup({ delay: null, applyAccept: false });

    const { container } = renderScreen({ gateway });
    await ui.upload(await screen.findByTestId('drawing-set-file-input'), [pdf('a.pdf', 20), pdf('b.pdf', 20), png('c.png')]);
    expect(await screen.findByText(/41 trang, tối đa 40 trang/u)).toBeTruthy();
    expectVietnamese(container);
  });

  it('tải xong → chuyển sang màn của bộ (setId trên đường dẫn)', async () => {
    const { gateway } = gatewayOf();
    const onNavigate = vi.fn();
    const ui = userEvent.setup({ delay: null, applyAccept: false });

    renderScreen({ gateway, onNavigate });
    await ui.upload(await screen.findByTestId('drawing-set-file-input'), pdf('bo-6-trang.pdf', 6));
    await waitFor(() => expect((screen.getByRole('button', { name: 'Tải lên' }) as HTMLButtonElement).disabled).toBe(false));
    await ui.click(screen.getByRole('button', { name: 'Tải lên' }));
    await waitFor(() => expect(onNavigate).toHaveBeenCalledWith(expect.stringMatching(/^\/projects\/project-1\/drawing-sets\/dws_/u)));
  });

  it('lối vào lại bộ đang dở: danh sách N58 hiện bộ đang duyệt', async () => {
    const { gateway, sets } = gatewayOf();
    const setId = await seedSet(sets);
    const onNavigate = vi.fn();
    const ui = userEvent.setup({ delay: null, applyAccept: false });

    renderScreen({ gateway, onNavigate });
    await ui.click(await screen.findByRole('button', { name: 'Tiếp tục' }));
    expect(onNavigate).toHaveBeenCalledWith(`/projects/project-1/drawing-sets/${setId}`);
  });
});

describe('duyệt bộ hồ sơ', () => {
  it('máy đọc xong → lưới 6 hình; chip máy không xanh; chưa chọn tầng thì chưa xác nhận được', async () => {
    const { gateway, sets } = gatewayOf();
    const setId = await seedSet(sets);

    const { container } = renderScreen({ gateway, setId });
    expect(await screen.findByText(/Máy đang đọc bộ hồ sơ/u)).toBeTruthy();
    const grid = await screen.findByRole('list', { name: 'Các hình máy tách được' });

    expect(within(grid).getAllByRole('article')).toHaveLength(6);
    expect(screen.getByText(/đề xuất của máy, chưa có người duyệt/u)).toBeTruthy();
    expect(container.querySelector('.bg-state-verified-tint')).toBeNull();
    await waitFor(() => expect((screen.getByRole('button', { name: 'Xác nhận và dựng' }) as HTMLButtonElement).disabled).toBe(true));
    expect(screen.getByText(/Chọn tầng cho ít nhất một hình mặt bằng/u)).toBeTruthy();
  });

  it('K-65: số bản vẽ hiện cạnh hình, khung "Thông tin hồ sơ" hiện trường đọc được và gợi ý tên bộ', async () => {
    const { gateway, sets } = gatewayOf();
    const setId = await seedSet(sets);

    renderScreen({ gateway, setId });
    const grid = await screen.findByRole('list', { name: 'Các hình máy tách được' });
    const first = within(grid).getAllByRole('article')[0]!;

    expect(within(first).getByText('KT-01')).toBeTruthy();
    const info = screen.getByRole('region', { name: 'Thông tin hồ sơ' });

    expect(within(info).getByText('Anh Nguyễn Văn An')).toBeTruthy();
    expect(within(info).getByText('Quận 7, TP. Hồ Chí Minh')).toBeTruthy();
    expect(within(info).queryByText('Ngày:')).toBeNull();
    expect(within(info).getByText(/Gợi ý tên bộ hồ sơ/u)).toBeTruthy();
    expectVietnamese(info);
  });

  it('chọn tầng cho từng mặt bằng, tự lưu, xác nhận qua hộp hỏi → "đã xác nhận" kèm dòng mặt cắt', async () => {
    const { gateway, sets } = gatewayOf();
    const setId = await seedSet(sets);
    const ui = userEvent.setup({ delay: null, applyAccept: false });

    renderScreen({ gateway, setId });
    const grid = await screen.findByRole('list', { name: 'Các hình máy tách được' });
    const cards = within(grid).getAllByRole('article');

    for (const card of cards.slice(0, 3)) {
      await chooseNewFloor(ui, card);
    }
    expect(within(cards[0] as HTMLElement).getByLabelText('Tên tầng mới')).toHaveProperty('value', 'Tầng trệt');
    const section = cards[3] as HTMLElement;

    expect(within(section).getByText(/dòng mặt cắt, ẩn khỏi 3D/u)).toBeTruthy();
    // Hình thứ 6 máy không đoán được loại: bỏ đi.
    await ui.click(within(cards[5] as HTMLElement).getByRole('button', { name: 'Bỏ hình này' }));
    await waitFor(() => expect(screen.getByText('Đã lưu bản duyệt')).toBeTruthy());
    const confirm = screen.getByRole('button', { name: 'Xác nhận và dựng' }) as HTMLButtonElement;

    expect(confirm.disabled).toBe(false);
    await ui.click(confirm);
    const dialog = await screen.findByRole('dialog');

    expect(within(dialog).getByText(/tạo 3 tầng mới, thêm 1 dòng mặt cắt/u)).toBeTruthy();
    await ui.click(within(dialog).getByRole('button', { name: 'Xác nhận và dựng' }));
    expect(await screen.findByText('Đã xác nhận bộ hồ sơ')).toBeTruthy();
    expect(screen.getByText(/Mặt cắt A-A: dòng mặt cắt/u)).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Xem tiến độ xử lý' })).toBeTruthy();
    // Bộ đã xác nhận: màn không còn nút xác nhận.
    expect(screen.queryByRole('button', { name: 'Xác nhận và dựng' })).toBeNull();
  });

  it('tầng đã có bản vẽ: chặn tới khi tick "Thay bản vẽ cũ", kèm câu tầng phải duyệt lại', async () => {
    const { gateway, sets } = gatewayOf();
    const setId = await seedSet(sets, 'bo-1-trang.pdf');
    const ui = userEvent.setup({ delay: null, applyAccept: false });

    renderScreen({ gateway, setId });
    const card = within(await screen.findByRole('list', { name: 'Các hình máy tách được' })).getAllByRole('article')[0] as HTMLElement;
    const select = within(card).getByLabelText('Tầng của hình này');

    await waitFor(() => expect(within(select).getByRole('option', { name: /Tầng 1 \(đã có bản vẽ\)/u })).toBeTruthy());
    await ui.selectOptions(select, within(select).getByRole('option', { name: /Tầng 1 \(đã có bản vẽ\)/u }));
    expect(within(card).getByText(/đã có bản vẽ\. Chọn “Thay bản vẽ cũ”/u)).toBeTruthy();
    expect((screen.getByRole('button', { name: 'Xác nhận và dựng' }) as HTMLButtonElement).disabled).toBe(true);
    await ui.click(within(card).getByRole('checkbox', { name: 'Thay bản vẽ cũ' }));
    expect(within(card).getByText('Tầng này sẽ phải duyệt lại sau khi thay bản vẽ.')).toBeTruthy();
    await waitFor(() => expect((screen.getByRole('button', { name: 'Xác nhận và dựng' }) as HTMLButtonElement).disabled).toBe(false));
    await ui.click(screen.getByRole('button', { name: 'Xác nhận và dựng' }));
    expect(within(await screen.findByRole('dialog')).getByText(/phải duyệt lại/u)).toBeTruthy();
  });

  it('thoát ra vào lại vẫn giữ phần đã sửa (tự lưu N59)', async () => {
    const { gateway, sets } = gatewayOf();
    const setId = await seedSet(sets);
    const ui = userEvent.setup({ delay: null, applyAccept: false });
    const first = renderScreen({ gateway, setId });
    const card = within(await screen.findByRole('list', { name: 'Các hình máy tách được' })).getAllByRole('article')[0] as HTMLElement;

    await chooseNewFloor(ui, card);
    await ui.clear(within(card).getByLabelText('Tên tầng mới'));
    await ui.type(within(card).getByLabelText('Tên tầng mới'), 'Tầng trệt A');
    await waitFor(() => expect(screen.getByText('Đã lưu bản duyệt')).toBeTruthy());
    first.unmount();

    renderScreen({ gateway, setId });
    const again = within(await screen.findByRole('list', { name: 'Các hình máy tách được' })).getAllByRole('article')[0] as HTMLElement;

    expect(within(again).getByLabelText('Tên tầng mới')).toHaveProperty('value', 'Tầng trệt A');
  });

  it('bộ đã đổi ở nơi khác (VERSION_CONFLICT): không đè, tải lại bản mới và nói rõ', async () => {
    const { gateway, sets } = gatewayOf();
    const setId = await seedSet(sets);
    const ui = userEvent.setup({ delay: null, applyAccept: false });

    renderScreen({ gateway, setId });
    const card = within(await screen.findByRole('list', { name: 'Các hình máy tách được' })).getAllByRole('article')[0] as HTMLElement;
    // Nơi khác lưu trước một lượt.
    const current = await sets.read({ projectId: PROJECT, setId });

    if (!current.ok) throw new Error('read');
    await sets.replaceViews({ projectId: PROJECT, setId, baseVersion: current.data.revision, views: [] });
    await chooseNewFloor(ui, card);
    expect(await screen.findByText(/Bộ hồ sơ vừa đổi ở nơi khác/u)).toBeTruthy();
  });

  it('bộ hỏng toàn bộ: nói tệp nào bị từ chối ở pha lỗi, tải bộ khác', async () => {
    const { gateway, sets } = gatewayOf();
    const setId = await seedSet(sets, 'hong.pdf');

    renderScreen({ gateway, setId });
    expect(await screen.findByText(/Máy không nhận tệp nào của bộ này/u)).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Tải bộ khác' })).toBeTruthy();
  });

  it('tệp hỏng một phần: báo đúng tên tệp, các tệp còn lại vẫn có hình', async () => {
    const { gateway, sets } = gatewayOf();
    const created = await sets.createSet({
      projectId: PROJECT,
      body: {
        files: [
          { fileName: 'hong.pdf', mimeType: 'application/pdf', sizeBytes: 10 },
          { fileName: 'tot-2-trang.pdf', mimeType: 'application/pdf', sizeBytes: 10 },
        ],
      },
    });

    if (!created.ok) throw new Error('create');
    await sets.complete({ projectId: PROJECT, setId: created.data.id });
    renderScreen({ gateway, setId: created.data.id });
    expect(await screen.findByText(/hong\.pdf: Tệp bị hỏng/u)).toBeTruthy();
    expect(within(await screen.findByRole('list', { name: 'Các hình máy tách được' })).getAllByRole('article')).toHaveLength(2);
  });

  it('"Bỏ bộ này" hỏi trước rồi quay về màn chọn tệp', async () => {
    const { gateway, sets } = gatewayOf();
    const setId = await seedSet(sets);
    const onNavigate = vi.fn();
    const ui = userEvent.setup({ delay: null, applyAccept: false });

    renderScreen({ gateway, onNavigate, setId });
    await ui.click(await screen.findByRole('button', { name: 'Bỏ bộ này' }));
    await ui.click(within(await screen.findByRole('dialog')).getByRole('button', { name: 'Bỏ bộ này' }));
    await waitFor(() => expect(onNavigate).toHaveBeenCalledWith('/projects/project-1/drawing-sets'));
  });
});
