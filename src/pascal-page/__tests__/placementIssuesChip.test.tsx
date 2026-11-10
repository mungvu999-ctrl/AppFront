/**
 * Chip lỗi đặt đồ (`../PlacementIssuesChip`): không lỗi thì ẩn; có lỗi thì "N lỗi đặt đồ",
 * bấm một dòng chọn món đồ đầu tiên của lỗi.
 */
import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import type { PlacementIssue } from '@/lib/pascal/placement';
import type { SceneRepair } from '@/lib/pascal/sceneLayer';

import { placementSummary, PlacementIssuesView } from '../PlacementIssuesChip';

const ISSUES: PlacementIssue[] = [
  { kind: 'overlap', furnitureIds: ['f1', 'f2'], message: 'Giường chồng lên tủ' },
  { kind: 'wall', furnitureIds: ['f3'], message: 'Bàn lấn vào tường' },
];

describe('PlacementIssuesView', () => {
  it('tóm tắt', () => {
    expect(placementSummary([])).toBe('Không thấy lỗi đặt đồ');
    expect(placementSummary(ISSUES)).toBe('2 lỗi đặt đồ');
  });

  it('không lỗi thì không hiện gì', () => {
    const { container } = render(<PlacementIssuesView issues={[]} />);
    expect(container.innerHTML).toBe('');
  });

  it('bấm dòng chọn món đồ', () => {
    const onPick = vi.fn();
    render(<PlacementIssuesView issues={ISSUES} onPick={onPick} />);
    expect(screen.getByLabelText('2 lỗi đặt đồ — mở danh sách')).not.toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Chọn món đồ: Bàn lấn vào tường' }));
    expect(onPick).toHaveBeenCalledWith('f3');
  });

  it('không có cách chọn thì chỉ là danh sách đọc', () => {
    render(<PlacementIssuesView issues={ISSUES} />);
    expect(screen.queryByRole('button', { name: /Giường chồng lên tủ/ })).toBeNull();
    expect(screen.getByText('Giường chồng lên tủ')).not.toBeNull();
  });

  const REPAIRS: SceneRepair[] = [
    { furnitureId: 'F-1', action: 'moved', rule: 'outsideRoom', reasonVi: 'Giường lòi ra ngoài “P1”: dịch vào trong 600 mm.', before: { centre: { x: 0, y: 0 }, rotationDeg: 0 } },
    { furnitureId: 'F-2', action: 'hidden', rule: 'roomMismatch', reasonVi: 'Bồn cầu nằm trong phòng ngủ; ẩn trong cảnh.', before: { centre: { x: 0, y: 0 }, rotationDeg: 0 } },
  ];

  it('chỉ có lần tự xử lý: hiện "Đã tự xử lý N món", món dời bấm chọn được, món ẩn thì không; nút dữ liệu gốc', () => {
    const onPick = vi.fn();
    const onToggle = vi.fn();
    render(<PlacementIssuesView issues={[]} onPick={onPick} onToggleRepairs={onToggle} repairs={REPAIRS} />);
    expect(screen.getByLabelText('Đã tự xử lý 2 món — mở danh sách')).not.toBeNull();
    fireEvent.click(screen.getByRole('button', { name: /^Chọn món đồ: Đã dời: Giường/ }));
    expect(onPick).toHaveBeenCalledWith('F-1');
    expect(screen.queryByRole('button', { name: /^Đã ẩn/ })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Hiện dữ liệu gốc (bỏ tự xử lý)' }));
    expect(onToggle).toHaveBeenCalledOnce();
  });

  it('đang xem dữ liệu gốc: vẫn hiện để bật lại', () => {
    render(<PlacementIssuesView issues={[]} onToggleRepairs={() => undefined} repairsEnabled={false} />);
    expect(screen.getByRole('button', { name: 'Bật lại tự xử lý đồ AI' })).not.toBeNull();
  });
});
