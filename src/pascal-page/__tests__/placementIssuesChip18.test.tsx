/** Vòng 18 — chip lỗi đặt đồ: mục "Chưa bố trí được" + nút "Xem hộp gốc"; lần dời `layout` vào "Đã tự xử lý". */
import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import type { SceneRepair, UnplacedItem } from '@/lib/pascal/sceneLayer';

import { PlacementIssuesView } from '../PlacementIssuesChip';

const UNPLACED: UnplacedItem[] = [
  { furnitureId: 'F-1', label: 'tủ', reason: 'Không tìm được chỗ: chạm tường (thử 3 mẫu, 40 tư thế)', outlineId: 'item_DRESS-unplaced-F-1' },
];
const LAYOUT: SceneRepair = {
  furnitureId: 'F-2',
  action: 'moved',
  rule: 'layout',
  reasonVi: 'Dời 0,17 m để giường đơn cỡ thật 0,92 × 2,00 m không cắt tường',
  before: { centre: { x: 0, y: 0 }, rotationDeg: 0 },
};

describe('PlacementIssuesView vòng 18', () => {
  it('chỉ có món chưa bố trí được: chip hiện, dòng tiếng Việt + nút bật khung hộp gốc', () => {
    const onToggleOutline = vi.fn();
    render(<PlacementIssuesView issues={[]} onToggleOutline={onToggleOutline} unplaced={UNPLACED} />);
    expect(screen.getByLabelText('1 món chưa bố trí được — mở danh sách')).not.toBeNull();
    expect(screen.getByTestId('unplaced-item').textContent).toContain('Chưa bố trí được: Tủ — Không tìm được chỗ: chạm tường');
    fireEvent.click(screen.getByTestId('unplaced-outline-toggle'));
    expect(onToggleOutline).toHaveBeenCalledWith('item_DRESS-unplaced-F-1');
    expect(screen.getByTestId('unplaced-outline-toggle').textContent).toBe('Xem hộp gốc');
  });

  it('lần dời của bộ chọn nằm trong "Đã tự xử lý", bấm chọn được món', () => {
    const onPick = vi.fn();
    render(<PlacementIssuesView issues={[]} onPick={onPick} repairs={[LAYOUT]} />);
    fireEvent.click(screen.getByRole('button', { name: /^Chọn món đồ: Đã dời: Dời 0,17 m/ }));
    expect(onPick).toHaveBeenCalledWith('F-2');
  });
});
