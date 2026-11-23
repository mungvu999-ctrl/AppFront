/** L1-N02: trang chia sẻ phân loại lỗi mở liên kết, có Thử lại, có trạng thái "chưa có tầng". */
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { describe, expect, it, vi } from 'vitest';

import type { ApiClient, SharedModel } from '@/api/client';
import type { HttpError } from '@/lib/http/types';

import { NO_LEVELS_NOTE, SharedModelPage, SharedModelView } from './SharedModelPage';
import { SHARE_LINK_GONE_MESSAGE } from './shareGone';

const httpError = (patch: Partial<HttpError>): HttpError => ({
  kind: 'http',
  raw: {},
  requestId: 'req-share',
  retryable: false,
  ...patch,
});

function renderWith(open: ReturnType<typeof vi.fn>) {
  const client = { share: { open } } as unknown as Pick<ApiClient, 'share'>;
  return render(
    <QueryClientProvider client={new QueryClient()}>
      <MemoryRouter initialEntries={['/share/tok']}>
        <Routes>
          <Route path="/share/:token" element={<SharedModelPage client={client} />} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}
const failing = (error: HttpError) => vi.fn().mockResolvedValue({ ok: false, error });

describe('trang chia sẻ — lỗi mở liên kết', () => {
  it('404: liên kết không còn hiệu lực, không có Thử lại', async () => {
    renderWith(failing(httpError({ status: 404, code: 'NOT_FOUND' })));
    expect(await screen.findByRole('heading', { name: SHARE_LINK_GONE_MESSAGE })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Thử lại' })).toBeNull();
    expect(screen.getByRole('link', { name: 'Về trang đăng nhập' })).toBeInTheDocument();
  });

  it('429 có Retry-After: nói số giây chờ và có Thử lại', async () => {
    renderWith(failing(httpError({ status: 429, code: 'RATE_LIMITED', retryAfterSeconds: 7 })));
    expect(await screen.findByRole('heading', { name: 'Có quá nhiều lượt mở liên kết' })).toBeInTheDocument();
    expect(screen.getByText(/khoảng 7 giây/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Thử lại' })).toBeInTheDocument();
  });

  it('mạng đứt: "Mất kết nối"', async () => {
    renderWith(failing(httpError({ kind: 'network' })));
    expect(await screen.findByRole('heading', { name: 'Mất kết nối' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Thử lại' })).toBeInTheDocument();
  });

  it('500: "Máy chủ đang bận"', async () => {
    renderWith(failing(httpError({ status: 500, code: 'INTERNAL' })));
    expect(await screen.findByRole('heading', { name: 'Máy chủ đang bận' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Thử lại' })).toBeInTheDocument();
  });

  it('bấm Thử lại gọi lại lượt mở liên kết', async () => {
    const open = failing(httpError({ status: 503 }));
    renderWith(open);
    fireEvent.click(await screen.findByRole('button', { name: 'Thử lại' }));
    await waitFor(() => { expect(open).toHaveBeenCalledTimes(2); });
  });
});

describe('trang chia sẻ — đồ thị không tầng', () => {
  it('hiện "Dự án chưa có tầng nào để xem", không vẽ mặt bằng trắng', () => {
    const model = {
      projectName: 'Trống',
      graph: { graph: { levels: [], walls: [], rooms: [], openings: [] }, floorRevisions: [] },
    } as unknown as SharedModel;
    const { container } = render(<SharedModelView model={model} />);
    expect(screen.getByText(NO_LEVELS_NOTE)).toBeInTheDocument();
    expect(container.querySelector('svg[aria-label="Mặt bằng chỉ đọc"]')).toBeNull();
  });
});
