import { act, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  ALERT_TOAST_MS,
  AUTOSAVE_CHIP,
  BackToProjectCard,
  INFO_TOAST_MS,
  OFFLINE_CHIP,
  READ_ONLY_REASON,
  SaveStatusCard,
} from '../BackToProjectCard';
import type { PascalNotice, PascalSaveStatus } from '../bridge/types';

const status = (patch: Partial<PascalSaveStatus> = {}): PascalSaveStatus => ({
  state: 'saved',
  label: 'Đã lưu lúc 10:00',
  blockMessage: null,
  onReloadFloor: vi.fn(),
  notices: [],
  dismissNotice: vi.fn(),
  ...patch,
});

const note = (text: string, tone: PascalNotice['tone'] = 'info', id = 1): PascalNotice => ({ id, tone, text, createdAt: 0 });

afterEach(() => {
  vi.useRealTimers();
});

describe('SaveStatusCard (v3 V3 — trạng thái lưu thật trên trang Pascal)', () => {
  it('đã lưu / đang lưu / thất bại', () => {
    const { rerender } = render(<SaveStatusCard save={status()} />);
    expect(screen.getByRole('status')).toHaveTextContent('Đã lưu lúc 10:00');

    rerender(<SaveStatusCard save={status({ state: 'saving' })} />);
    expect(screen.getByRole('status')).toHaveTextContent('Đang lưu…');

    rerender(<SaveStatusCard save={status({ state: 'failed', label: 'Lưu thất bại' })} />);
    expect(screen.getByRole('alert')).toHaveTextContent('Lưu thất bại');
    expect(screen.queryByRole('button', { name: 'Tải lại tầng' })).toBeNull();
  });

  it('bị khối: lý do + nút "Tải lại tầng"', () => {
    const save = status({ state: 'blocked', blockMessage: 'Bản vẽ đã đổi ở nơi khác.' });
    render(<SaveStatusCard save={save} />);

    expect(screen.getByRole('alert')).toHaveTextContent('Bản vẽ đã đổi ở nơi khác.');
    fireEvent.click(screen.getByRole('button', { name: 'Tải lại tầng' }));
    expect(save.onReloadFloor).toHaveBeenCalledTimes(1);
    // Không neo góc phải: bảng đồ vật của vendor nằm ở đó (hàng "Tỉ lệ chung" bị đè, 04/11).
    expect(screen.getByRole('alert').parentElement).not.toHaveClass('right-3');
    expect(screen.getByRole('alert').parentElement).toHaveClass('left-1/2', 'top-24');
  });

  it('câu "Chưa lưu được" đóng được, đủ chữ (không cắt); chưa lưu lần nào thì chip vẫn có: "Tự động lưu" (K5)', () => {
    const save = status({ label: null, notices: [note('Chưa lưu được: màu sàn — sẽ có ở bản sau.', 'info', 7)] });
    render(<SaveStatusCard save={save} />);

    const text = screen.getByText('Chưa lưu được: màu sàn — sẽ có ở bản sau.');
    expect(text.className).not.toContain('truncate');
    const [chip, ...rest] = screen.getAllByRole('status');
    expect(rest).toHaveLength(1);
    expect(chip).toHaveTextContent(AUTOSAVE_CHIP);
    fireEvent.click(screen.getByRole('button', { name: 'Đóng thông báo' }));
    expect(save.dismissNotice).toHaveBeenCalledWith(7);
  });

  it('V10 — câu thông báo là toast cổng ra body (không chiếm chỗ trên thanh), chip lưu co được', () => {
    const save = status({ notices: [note('Chưa lưu được: màu sàn.')] });
    const { container } = render(
      <div data-testid="bar">
        <SaveStatusCard save={save} />
      </div>,
    );

    const toast = screen.getByText('Chưa lưu được: màu sàn.').closest('[role="status"]')!;
    expect(container.contains(toast)).toBe(false);
    expect(toast.parentElement!.parentElement).toBe(document.body);
    expect(toast.parentElement!.className).toContain('fixed');
    expect(toast.querySelector('button[aria-label="Đóng thông báo"]')).not.toBeNull();
    // Chip gọn: một chấm, câu đầy đủ ở chú thích (title) và cho trình đọc màn hình.
    const chip = screen.getByText('Đã lưu lúc 10:00').parentElement!;
    expect(container.contains(chip)).toBe(true);
    expect(chip).toHaveAttribute('title', 'Đã lưu lúc 10:00');
    expect(screen.getByText('Đã lưu lúc 10:00').className).toContain('sr-only');
  });

  it('N1 — lượt lưu bị từ chối: toast là cảnh báo (role alert, màu đỏ)', () => {
    render(<SaveStatusCard save={status({ notices: [note('Không lưu được: món đồ đặt lên đồ khác.', 'alert')] })} />);

    const toast = screen.getByRole('alert');
    expect(toast).toHaveTextContent('Không lưu được: món đồ đặt lên đồ khác.');
    expect(toast.className).toContain('text-[var(--pa-danger)]');
  });

  it('B3-09 — lưu hỏng: câu đầy đủ + "Tải lại tầng" ở toast ngoài thanh, chip chỉ "Chưa lưu" và không co', () => {
    const { container } = render(
      <div>
        <SaveStatusCard save={status({ state: 'blocked', blockMessage: 'Máy chủ không nhận dữ liệu của tầng này.' })} />
      </div>,
    );

    const toast = screen.getByRole('alert');
    expect(container.contains(toast)).toBe(false);
    expect(toast).toHaveTextContent('Máy chủ không nhận dữ liệu của tầng này.');
    expect(toast).toContainElement(screen.getByRole('button', { name: 'Tải lại tầng' }));
    const chip = screen.getByRole('status');
    expect(chip).toHaveTextContent('Chưa lưu');
    expect(chip.className).toContain('shrink-0');
  });

  it('câu báo và câu lỗi là hai toast riêng: câu báo không bị nhuộm đỏ', () => {
    render(<SaveStatusCard save={status({ notices: [note('Lỗi A', 'alert', 1), note('Báo B', 'info', 2)] })} />);

    expect(screen.getByRole('alert')).toHaveTextContent('Lỗi A');
    expect(screen.getByRole('alert')).not.toHaveTextContent('Báo B');
    expect(screen.getByText('Báo B').closest('[role="status"]')!.className).not.toContain('pa-danger');
  });

  it('toast tự gỡ: câu báo sau 6 s, câu lỗi sau 8 s; rê chuột vào thì dừng đếm', () => {
    vi.useFakeTimers();
    const save = status({ notices: [note('Lỗi A', 'alert', 1), note('Báo B', 'info', 2)] });
    render(<SaveStatusCard save={save} />);

    act(() => vi.advanceTimersByTime(INFO_TOAST_MS));
    expect(save.dismissNotice).toHaveBeenCalledWith(2);
    expect(save.dismissNotice).not.toHaveBeenCalledWith(1);

    fireEvent.mouseEnter(screen.getByRole('alert'));
    act(() => vi.advanceTimersByTime(ALERT_TOAST_MS * 2));
    expect(save.dismissNotice).not.toHaveBeenCalledWith(1);

    fireEvent.mouseLeave(screen.getByRole('alert'));
    act(() => vi.advanceTimersByTime(ALERT_TOAST_MS));
    expect(save.dismissNotice).toHaveBeenCalledWith(1);
  });

  it('bị khối (có nút "Tải lại tầng") thì toast giữ; lưu hỏng thường tự gỡ sau 8 s', () => {
    vi.useFakeTimers();
    const { rerender } = render(<SaveStatusCard save={status({ state: 'blocked', blockMessage: 'Bản vẽ đã đổi.' })} />);

    act(() => vi.advanceTimersByTime(ALERT_TOAST_MS * 3));
    expect(screen.getByRole('alert')).toHaveTextContent('Bản vẽ đã đổi.');

    rerender(<SaveStatusCard save={status({ state: 'failed', label: 'Lưu thất bại' })} />);
    expect(screen.getByRole('alert')).toHaveTextContent('Lưu thất bại');
    act(() => vi.advanceTimersByTime(ALERT_TOAST_MS));
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('K5/A2-06 — mất mạng: chip riêng "Mất mạng — chưa gửi được", không phải "Đang lưu…"', () => {
    render(<SaveStatusCard save={status({ state: 'offline' })} />);

    expect(screen.getByRole('status')).toHaveTextContent(OFFLINE_CHIP);
    expect(screen.queryByText('Đang lưu…')).toBeNull();
  });

  it('L3a-01 — phiên hết: cảnh báo + "Đăng nhập lại" về đúng 3D', () => {
    render(
      <SaveStatusCard
        save={status({ state: 'session', blockMessage: 'Phiên đăng nhập đã hết — thay đổi vừa rồi CHƯA được lưu.', loginHref: '/login?next=%2Fprojects%2Fp1%2F3d' })}
      />,
    );

    expect(screen.getByRole('alert')).toHaveTextContent('thay đổi vừa rồi CHƯA được lưu');
    expect(screen.getByRole('link', { name: 'Đăng nhập lại' })).toHaveAttribute('href', '/login?next=%2Fprojects%2Fp1%2F3d');
    expect(screen.getByRole('status')).toHaveTextContent('Chưa lưu');
  });

  it('C4 — hộp xác nhận: Huỷ nhận tiêu điểm, Esc là huỷ, nút xác nhận gọi đúng việc', () => {
    const confirm = { title: 'Tải lại tầng từ máy chủ?', body: 'Các thay đổi chưa lưu sẽ bị bỏ.', confirmLabel: 'Bỏ phần sửa và tải lại', onConfirm: vi.fn(), onCancel: vi.fn() };
    render(<SaveStatusCard save={status({ confirm })} />);

    const dialog = screen.getByRole('alertdialog', { name: 'Tải lại tầng từ máy chủ?' });
    expect(dialog).toHaveAccessibleDescription('Các thay đổi chưa lưu sẽ bị bỏ.');
    expect(screen.getByRole('button', { name: 'Huỷ' })).toHaveFocus();
    fireEvent.keyDown(dialog, { key: 'Escape' });
    expect(confirm.onCancel).toHaveBeenCalledTimes(1);
    fireEvent.click(screen.getByRole('button', { name: 'Bỏ phần sửa và tải lại' }));
    expect(confirm.onConfirm).toHaveBeenCalledTimes(1);
  });

  it('BackToProjectCard: không có `save` (chỉ đọc) thì có lối về và câu nói vì sao chỉ xem, không có chip lưu', () => {
    render(<BackToProjectCard href="/projects/p1/floors" projectName="Nhà mẫu" />);

    expect(screen.getByRole('link', { name: 'Về dự án: Nhà mẫu' })).toBeInTheDocument();
    expect(screen.queryByRole('status')).toBeNull();
    expect(screen.getByRole('note')).toHaveTextContent(READ_ONLY_REASON);
  });

  it('BackToProjectCard: có `save` thì không hiện chip chỉ xem', () => {
    render(<BackToProjectCard href="/projects/p1/floors" projectName="Nhà mẫu" save={status()} />);

    expect(screen.queryByRole('note')).toBeNull();
  });
});

describe('SaveStatusCard — mẫu thư viện hết hạn không tải lại được', () => {
  it('hiện câu báo (role=status, data-testid) khi refreshAssetUrl hỏng hẳn, không tự ẩn', async () => {
    const { registerServerLibrary, clearServerLibrary } = await import('@/lib/pascal/furnitureCatalog');
    const { ASSET_EXPIRED_NOTICE, refreshAssetUrl, resetSceneLibraryForTests } = await import('@/lib/pascal/sceneLibrary');
    resetSceneLibraryForTests();
    registerServerLibrary([{ id: 'lib-x', widthMm: 900, heightMm: 800, depthMm: 500, modelUrl: 'https://minio.test/lib-x.glb?sig=1' }]);
    render(<SaveStatusCard save={status()} />);
    expect(screen.queryByTestId('asset-expired-notice')).toBeNull();

    const forbidden = async () => ({ list: async () => ({ ok: false, error: { kind: 'forbidden' } }) }) as never;
    await act(async () => {
      await refreshAssetUrl('https://minio.test/lib-x.glb?sig=1', 403, forbidden, async () => undefined);
    });
    const toast = screen.getByTestId('asset-expired-notice');
    expect(toast).toHaveAttribute('role', 'status');
    expect(toast).toHaveTextContent(ASSET_EXPIRED_NOTICE);

    vi.useFakeTimers();
    act(() => vi.advanceTimersByTime(INFO_TOAST_MS * 3));
    expect(screen.getByTestId('asset-expired-notice')).toBeInTheDocument();
    act(() => resetSceneLibraryForTests());
    clearServerLibrary();
  });

  it('vai CHỈ XEM (không có `save`) cũng thấy câu báo — vòng 11: trước đây câu báo chỉ nằm trong chip lưu', async () => {
    vi.useRealTimers();
    const { registerServerLibrary, clearServerLibrary } = await import('@/lib/pascal/furnitureCatalog');
    const { ASSET_EXPIRED_NOTICE, refreshAssetUrl, resetSceneLibraryForTests } = await import('@/lib/pascal/sceneLibrary');
    resetSceneLibraryForTests();
    registerServerLibrary([{ id: 'lib-y', widthMm: 900, heightMm: 800, depthMm: 500, modelUrl: 'https://minio.test/lib-y.glb?sig=1' }]);
    render(<BackToProjectCard href="/projects/p1/floors" projectName="Nhà mẫu" />);
    expect(screen.queryByTestId('asset-expired-notice')).toBeNull();
    const forbidden = async () => ({ list: async () => ({ ok: false, error: { kind: 'forbidden' } }) }) as never;
    await act(async () => {
      await refreshAssetUrl('https://minio.test/lib-y.glb?sig=1', 403, forbidden, async () => undefined);
    });
    const toast = screen.getByTestId('asset-expired-notice');
    expect(toast).toHaveAttribute('role', 'status');
    expect(toast).toHaveTextContent(ASSET_EXPIRED_NOTICE);
    fireEvent.click(screen.getByRole('button', { name: /đóng/i }));
    expect(screen.queryByTestId('asset-expired-notice')).toBeNull();
    act(() => resetSceneLibraryForTests());
    clearServerLibrary();
  });

  it('Codex-2 #7: đóng câu báo, danh sách lỗi về 0 (đổi người) → lỗi đầu tiên sau đó VẪN hiện', async () => {
    vi.useRealTimers();
    const { registerServerLibrary, clearServerLibrary } = await import('@/lib/pascal/furnitureCatalog');
    const { refreshAssetUrl, resetSceneLibraryForTests } = await import('@/lib/pascal/sceneLibrary');
    const forbidden = async () => ({ list: async () => ({ ok: false, error: { kind: 'forbidden' } }) }) as never;
    const failOnce = async (id: string): Promise<void> => {
      registerServerLibrary([{ id, widthMm: 900, heightMm: 800, depthMm: 500, modelUrl: `https://minio.test/${id}.glb?sig=1` }]);
      await act(async () => {
        await refreshAssetUrl(`https://minio.test/${id}.glb?sig=1`, 403, forbidden, async () => undefined);
      });
    };
    resetSceneLibraryForTests();
    render(<BackToProjectCard href="/projects/p1/floors" projectName="Nhà mẫu" />);
    await failOnce('lib-z1');
    fireEvent.click(screen.getByRole('button', { name: /đóng/i }));
    expect(screen.queryByTestId('asset-expired-notice')).toBeNull();
    act(() => resetSceneLibraryForTests()); // như forget khi đổi người: danh sách lỗi về 0
    await failOnce('lib-z2');
    expect(screen.getByTestId('asset-expired-notice')).toBeInTheDocument();
    act(() => resetSceneLibraryForTests());
    clearServerLibrary();
  });
});
