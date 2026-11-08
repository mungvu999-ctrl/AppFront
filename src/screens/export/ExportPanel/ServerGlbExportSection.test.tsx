import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { ExportPanel } from './ExportPanel';
import { DEFAULT_FLOORS, buildExportPanelProps, formatsSelecting } from './exportPanelFixtures';
import { ServerGlbExportSection } from './ServerGlbExportSection';
import { SERVER_GLB_DISCLAIMER, type ServerGlbExportView } from './useServerGlbExport';

const base = (patch: Partial<ServerGlbExportView> = {}): ServerGlbExportView => ({
  engine: 'server',
  isBusy: false,
  progressLabel: null,
  errorMessage: null,
  snapshotLine: null,
  staleNote: null,
  result: null,
  onSelectEngine: vi.fn(),
  onDownload: vi.fn(),
  ...patch,
});

const result = (canDownloadGlb: boolean) => ({
  qualityLabel: canDownloadGlb ? 'Có thiếu sót' : 'Không dùng được',
  qualityTone: canDownloadGlb ? ('attention' as const) : ('violation' as const),
  issues: [{ key: 'k', severity: 'major' as const, reason: 'Cửa thiếu bộ cửa', countLabel: '× 2' }],
  canDownloadGlb,
  glbSizeLabel: '1,2 MB',
});

describe('ServerGlbExportSection', () => {
  it('đường nhanh: chỉ hai lựa chọn, không câu cố định', () => {
    const view = base({ engine: 'quick' });
    render(<ServerGlbExportSection view={view} />);
    expect(screen.getByText('GLB nhanh (không vật liệu)')).toBeTruthy();
    expect(screen.queryByText(SERVER_GLB_DISCLAIMER)).toBeNull();
    fireEvent.click(screen.getByText('GLB dựng trên máy chủ (có vật liệu)'));
    expect(view.onSelectEngine).toHaveBeenCalledWith('server');
  });

  it('đang dựng: câu cố định + tiến độ, không nút tải, không nút lưu', () => {
    render(<ServerGlbExportSection view={base({ isBusy: true, progressLabel: 'Máy chủ đang dựng mô hình…' })} />);
    expect(screen.getByText(SERVER_GLB_DISCLAIMER)).toBeTruthy();
    expect(screen.getByText('Máy chủ đang dựng mô hình…')).toBeTruthy();
    expect(screen.queryByRole('button', { name: /Tải/ })).toBeNull();
    expect(screen.queryByRole('button', { name: /Lưu/ })).toBeNull();
  });

  it('xong có thiếu sót: chất lượng, issues, bản lưu, stale, hai nút tải', () => {
    const view = base({
      result: result(true),
      snapshotLine: 'Dựng từ bản lưu: tầng L-1 revision 3 · lúc 12:00',
      staleNote: 'Dữ liệu đã thay đổi sau lần xuất này — xuất lại để có bản mới.',
    });
    render(<ServerGlbExportSection view={view} />);
    expect(screen.getByText('Có thiếu sót')).toBeTruthy();
    expect(screen.getByText('Cửa thiếu bộ cửa')).toBeTruthy();
    expect(screen.getByText('× 2')).toBeTruthy();
    expect(screen.getByText(/Dựng từ bản lưu: tầng L-1 revision 3/)).toBeTruthy();
    expect(screen.getByText(/Dữ liệu đã thay đổi/)).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Tải model.glb' }));
    fireEvent.click(screen.getByRole('button', { name: 'Tải report.json' }));
    expect(view.onDownload).toHaveBeenNthCalledWith(1, 'model.glb');
    expect(view.onDownload).toHaveBeenNthCalledWith(2, 'report.json');
  });

  it('Sẵn sàng: huy hiệu trung tính, không mang xanh "đã xác minh" (A5)', () => {
    const ready = { ...result(true), qualityLabel: 'Sẵn sàng', qualityTone: 'ok' as const, issues: [] };
    render(<ServerGlbExportSection view={base({ result: ready })} />);
    const badge = screen.getByText('Sẵn sàng').closest('span');
    expect(badge?.className).not.toMatch(/state-verified/);
    expect(badge?.className).toMatch(/bg-bg-sunken/);
  });

  it('blocked: ẩn tải GLB, còn report.json', () => {
    render(<ServerGlbExportSection view={base({ result: result(false) })} />);
    expect(screen.getByText('Không dùng được')).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Tải model.glb' })).toBeNull();
    expect(screen.getByRole('button', { name: 'Tải report.json' })).toBeTruthy();
  });

  it('lỗi: hiện câu tiếng Việt', () => {
    render(<ServerGlbExportSection view={base({ errorMessage: 'Chưa lưu được thay đổi — chưa xuất.' })} />);
    expect(screen.getByText('Chưa lưu được thay đổi — chưa xuất.')).toBeTruthy();
  });
});

describe('ExportPanel + đường máy chủ (M1-01)', () => {
  const noFloors = DEFAULT_FLOORS.map((floor) => ({ ...floor, isSelected: false }));

  it('đường máy chủ: ẩn tuỳ chọn đường cũ, không chặn vì chưa chọn tầng, ghi "Xuất mọi tầng"', () => {
    const props = buildExportPanelProps('success', { formats: formatsSelecting('glb'), floors: noFloors });
    render(<ExportPanel {...props} serverGlb={base()} />);
    expect(screen.getByText('Xuất mọi tầng của dự án.')).toBeTruthy();
    expect(screen.queryByText('Phạm vi và tuỳ chọn')).toBeNull();
    expect(screen.queryByText('Chọn ít nhất một tầng để xuất mô hình 3D.')).toBeNull();
    expect(screen.getByRole('button', { name: /^Xuất \.glb$/u })).not.toBeDisabled();
  });

  it('đường nhanh giữ nguyên: còn tuỳ chọn và vẫn chặn khi chưa chọn tầng', () => {
    const props = buildExportPanelProps('success', { formats: formatsSelecting('glb'), floors: noFloors });
    render(<ExportPanel {...props} serverGlb={base({ engine: 'quick' })} />);
    expect(screen.getByText('Phạm vi và tuỳ chọn')).toBeTruthy();
    expect(screen.getByRole('button', { name: /^Xuất \.glb$/u })).toBeDisabled();
  });
});
