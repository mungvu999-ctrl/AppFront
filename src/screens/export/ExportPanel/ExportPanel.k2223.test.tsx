/** K-22 — thẻ GLB ở màn Xuất là bản rút gọn, kèm lối sang editor để xuất bản đầy đủ. */

import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { ExportPanel } from './ExportPanel';
import { buildExportPanelProps, formatsSelecting } from './exportPanelFixtures';

afterEach(cleanup);

describe('K-22 — GLB: bản rút gọn và lối sang editor', () => {
  it('thẻ GLB có nút mở editor và bấm thì gọi onOpenEditorExport', () => {
    const onOpenEditor = vi.fn();
    render(<ExportPanel {...buildExportPanelProps('success', { formats: formatsSelecting('glb'), onOpenEditor })} />);

    fireEvent.click(screen.getByRole('button', { name: 'Mở editor để xuất bản đầy đủ' }));
    expect(onOpenEditor).toHaveBeenCalledWith('export');
  });

  it('không truyền onOpenEditorExport thì nút rời khỏi DOM', () => {
    render(<ExportPanel {...buildExportPanelProps('success', { formats: formatsSelecting('glb') })} />);
    expect(screen.queryByRole('button', { name: 'Mở editor để xuất bản đầy đủ' })).toBeNull();
  });

  it('K-23: có lối sang trình xem cho Ảnh và OBJ, và nói thật IFC/DXF chưa có', () => {
    const onOpenEditor = vi.fn();
    render(<ExportPanel {...buildExportPanelProps('success', { formats: formatsSelecting('glb'), onOpenEditor })} />);

    fireEvent.click(screen.getByRole('button', { name: 'Mở trình xem 3D để chụp ảnh' }));
    fireEvent.click(screen.getByRole('button', { name: 'Mở trình xem 3D để xuất OBJ' }));
    expect(onOpenEditor.mock.calls).toEqual([['snapshot'], ['settings']]);
    expect(screen.getByText(/IFC và DXF: dự án chưa có bộ xuất/u)).toBeTruthy();
  });

  it('K-23: không có onOpenEditor thì không có khối lối sang trình xem', () => {
    render(<ExportPanel {...buildExportPanelProps('success', { formats: formatsSelecting('glb') })} />);
    expect(screen.queryByRole('region', { name: 'Ảnh và OBJ' })).toBeNull();
  });
});
