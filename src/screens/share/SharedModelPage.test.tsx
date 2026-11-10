import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { describe, expect, it, vi } from 'vitest';

import type { SharedModel } from '@/api/client';
import { SAMPLE_BUILDING } from '@/domain/spatial/__fixtures__/sampleBuilding';

import { createMockApiClient, MOCK_SHARE_TOKEN } from '@/api/__mocks__/client';
import { createExportPanelGateway, ExportAccessError } from '@/screens/export/ExportPanel/exportPanelGateway';
import { createShareLink, revokeShareLink, type ShareLinkGateway } from '@/lib/export/shareLink';

import { PROVISIONAL_AREA_NOTE, SharedModelPage, SharedModelView } from './SharedModelPage';
import { SHARE_LINK_GONE_MESSAGE, shareGoneReason } from './shareGone';

// Cảnh 3D thật cần WebGL; ở đây chỉ kiểm thẻ chuyển và nạp lười.
vi.mock('./SharedModel3D', () => ({ SharedModel3D: ({ levelId }: { levelId: string }) => <p>cảnh 3D {levelId}</p> }));

function renderAt(token: string) {
  const client = createMockApiClient();
  return render(
    <QueryClientProvider client={new QueryClient()}>
      <MemoryRouter initialEntries={[`/share/${token}`]}>
        <Routes>
          <Route path="/share/:token" element={<SharedModelPage client={client} />} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

const wire = (status: string) => ({
  id: 'shl_1',
  url: 'http://api.example:8000/share/tok_abc',
  permission: 'view',
  status,
  createdAt: '2026-10-25T00:00:00Z',
  expiresAt: null,
  revokedAt: status === 'revoked' ? '2026-10-25T01:00:00Z' : null,
  passwordProtected: false,
  viewpointCode: null,
  label: null,
});

describe('trang chia sẻ công khai', () => {
  it('[U17] mặc định mặt bằng 2D, bấm thẻ "Mô hình 3D" thì mở cảnh 3D chỉ đọc', async () => {
    const model = { projectName: 'Mẫu', graph: { graph: SAMPLE_BUILDING, floorRevisions: [] } } as unknown as SharedModel;
    const { container } = render(<SharedModelView model={model} />);
    expect(screen.getByRole('tab', { name: 'Mặt bằng 2D' })).toHaveAttribute('aria-selected', 'true');
    expect(container.querySelector('svg[aria-label="Mặt bằng chỉ đọc"]')).not.toBeNull();
    fireEvent.click(screen.getByRole('tab', { name: 'Mô hình 3D' }));
    expect(await screen.findByText(/^cảnh 3D /)).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: 'Mô hình 3D' })).toHaveAttribute('aria-selected', 'true');
    expect(container.querySelector('svg[aria-label="Mặt bằng chỉ đọc"]')).toBeNull();
  });

  it('token lạ/hết hạn (404) hiện "Liên kết không còn hiệu lực"', async () => {
    renderAt('khong-co');
    expect(await screen.findByRole('heading', { name: SHARE_LINK_GONE_MESSAGE })).toBeInTheDocument();
  });

  it('token hợp lệ hiện tên dự án và mặt bằng chỉ đọc', async () => {
    renderAt(MOCK_SHARE_TOKEN);
    expect(await screen.findByText('Bản xem chỉ đọc qua liên kết chia sẻ.')).toBeInTheDocument();
  });

  it('[U23] mặt bằng vẽ cả phòng có tên, có nút phóng/thu/vừa khung đổi được khung nhìn', async () => {
    // Đồ thị giả của máy chủ mock không có tường trên tầng nào; dùng bộ mẫu A14 để có phòng thật mà vẽ.
    const model = { projectName: 'Mẫu', graph: { graph: SAMPLE_BUILDING, floorRevisions: [] } } as unknown as SharedModel;
    const { container } = render(<SharedModelView model={model} />);
    const zoomIn = await screen.findByRole('button', { name: 'Phóng to' });
    expect(screen.getByRole('button', { name: 'Thu nhỏ' })).toBeInTheDocument();
    expect(container.querySelectorAll('svg[aria-label="Mặt bằng chỉ đọc"] polygon').length).toBeGreaterThan(0);
    expect(container.querySelectorAll('svg[aria-label="Mặt bằng chỉ đọc"] text').length).toBeGreaterThan(0);

    const plan = screen.getByRole('img', { name: 'Mặt bằng chỉ đọc' });
    const before = plan.getAttribute('viewBox');
    fireEvent.click(zoomIn);
    expect(plan.getAttribute('viewBox')).not.toBe(before);
    fireEvent.click(screen.getByRole('button', { name: 'Vừa khung' }));
    expect(plan.getAttribute('viewBox')).toBe(before);
  });

  it('[U03] tầng chưa đặt tỷ lệ: nói rõ diện tích là số tạm tính; có tỷ lệ thì không', () => {
    const withScale = (scale: number | undefined) =>
      ({
        projectName: 'Mẫu',
        graph: {
          graph: {
            ...SAMPLE_BUILDING,
            levels: SAMPLE_BUILDING.levels.map((level) => ({ ...level, scaleMillimetresPerPixel: scale })),
          },
          floorRevisions: [],
        },
      }) as unknown as SharedModel;
    const { unmount } = render(<SharedModelView model={withScale(undefined)} />);
    expect(screen.getByText(PROVISIONAL_AREA_NOTE)).toBeInTheDocument();
    unmount();
    render(<SharedModelView model={withScale(5)} />);
    expect(screen.queryByText(PROVISIONAL_AREA_NOTE)).not.toBeInTheDocument();
  });

  it('[U59] 404 kèm reason nói đúng lý do; vắng reason giữ câu gộp', () => {
    expect(shareGoneReason({ status: 404, raw: { reason: 'revoked' } })).toContain('đã thu hồi');
    expect(shareGoneReason({ status: 404, raw: { reason: 'expired' } })).toBe(
      'Liên kết đã hết hạn. Hãy xin người chia sẻ một liên kết mới.',
    );
    expect(shareGoneReason({ status: 404, raw: { code: 'NOT_FOUND' } })).toContain('hoặc không đúng');
  });
});

describe('xuất qua tuyến có kiểm quyền', () => {
  it('403 thành lỗi nói rõ không có quyền xuất', async () => {
    const gateway = createExportPanelGateway({
      exportGraph: async () => ({ ok: false, error: { kind: 'http', status: 403 } as never }),
    });
    const run = gateway.loadExportGraph!('p1');
    await expect(run).rejects.toBeInstanceOf(ExportAccessError);
    await expect(run).rejects.toThrow('không có quyền xuất');
  });

  it('404 nói không tìm thấy dự án', async () => {
    const gateway = createExportPanelGateway({
      exportGraph: async () => ({ ok: false, error: { kind: 'http', status: 404 } as never }),
    });
    await expect(gateway.loadExportGraph!('p1')).rejects.toThrow('Không tìm thấy dự án');
  });
});

describe('tạo/thu hồi liên kết', () => {
  const gateway: ShareLinkGateway = {
    supported: true,
    create: async () => ({ ok: true, data: wire('active') }),
    list: async () => ({ ok: true, data: [wire('active')] }),
    revoke: async () => ({ ok: true, data: wire('revoked') }),
  };

  it('URL dựng từ origin FE + token, không dùng origin API', async () => {
    const result = await createShareLink(gateway, { projectId: 'p1', permission: 'view', expiresAt: null });
    expect(result.ok && result.data.url).toBe(`${window.location.origin}/share/tok_abc`);
  });

  it('thu hồi trả trạng thái revoked', async () => {
    const result = await revokeShareLink(gateway, { projectId: 'p1', linkId: 'shl_1' });
    expect(result.ok && result.data.status).toBe('revoked');
  });
});

describe('A-09 — liên kết hết hiệu lực', () => {
  it('có lối "Về trang đăng nhập"', async () => {
    renderAt('khong-co');
    const link = await screen.findByRole('link', { name: 'Về trang đăng nhập' });
    expect(link).toHaveAttribute('href', '/login');
  });
});
