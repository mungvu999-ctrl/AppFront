/** K-22 — thẻ GLB ở màn Xuất là bản rút gọn, kèm lối sang editor để xuất bản đầy đủ. */

import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { ExportPanel } from './ExportPanel';
import { buildExportPanelProps, formatsSelecting } from './exportPanelFixtures';

afterEach(cleanup);

describe('K-22 — GLB: bản rút gọn và lối sang editor', () => {
  it('thẻ GLB có nút mở editor và bấm thì gọi onOpenEditorExport', () => {
    const onOpenEditorExport = vi.fn();
    render(<ExportPanel {...buildExportPanelProps('success', { formats: formatsSelecting('glb'), onOpenEditorExport })} />);

    fireEvent.click(screen.getByRole('button', { name: 'Mở editor để xuất bản đầy đủ' }));
    expect(onOpenEditorExport).toHaveBeenCalledTimes(1);
  });

  it('không truyền onOpenEditorExport thì nút rời khỏi DOM', () => {
    render(<ExportPanel {...buildExportPanelProps('success', { formats: formatsSelecting('glb') })} />);
    expect(screen.queryByRole('button', { name: 'Mở editor để xuất bản đầy đủ' })).toBeNull();
  });
});
