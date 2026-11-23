import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { BRIDGE_EMPTY_ERROR, BRIDGE_LOAD_ERROR, BRIDGE_NOT_FOUND_ERROR, BRIDGE_SESSION_ERROR } from '../bridge';
import { LoadErrorBody } from '../LoadErrorBody';

const body = (error: string | null, extra: { online?: boolean; onRetry?: () => void } = {}) =>
  render(<LoadErrorBody error={error} projectId="p1" backHref="/projects/p1" {...extra} />);

describe('LoadErrorBody (L1-N03 — màn 3D lỗi tải có nút Thử lại)', () => {
  it('lỗi tải chung: có Thử lại gọi onRetry, vẫn có Về dự án', () => {
    const onRetry = vi.fn();
    body(BRIDGE_LOAD_ERROR, { onRetry });
    fireEvent.click(screen.getByRole('button', { name: 'Thử lại' }));
    expect(onRetry).toHaveBeenCalledTimes(1);
    expect(screen.getByRole('link', { name: 'Về dự án' })).toHaveAttribute('href', '/projects/p1');
  });

  it('ngoại tuyến: đổi câu, vẫn có Thử lại', () => {
    body(BRIDGE_LOAD_ERROR, { online: false });
    expect(screen.getByText(/Đang ngoại tuyến.*bấm Thử lại/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Thử lại' })).toBeInTheDocument();
  });

  it('hết phiên: Đăng nhập lại, không Thử lại', () => {
    body(BRIDGE_SESSION_ERROR);
    expect(screen.getByRole('link', { name: 'Đăng nhập lại' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Thử lại' })).toBeNull();
  });

  it.each([BRIDGE_NOT_FOUND_ERROR, BRIDGE_EMPTY_ERROR])('lỗi không thử lại được (%s): không có nút Thử lại', (error) => {
    body(error);
    expect(screen.queryByRole('button', { name: 'Thử lại' })).toBeNull();
    expect(screen.getByRole('link', { name: 'Về dự án' })).toBeInTheDocument();
  });
});
