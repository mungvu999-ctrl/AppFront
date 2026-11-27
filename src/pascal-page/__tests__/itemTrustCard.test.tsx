import { act, cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { create } from 'zustand';

import { ItemTrustCard, itemTrustLabelOf } from '../ItemTrustCard';
import type { SwapModelStores } from '../SwapModelCard';

const origin = (confidence: number, reviewed: boolean) => ({ appfront: { confidence, reviewed, source: 'ai' } });

afterEach(cleanup);

describe('itemTrustLabelOf (D7)', () => {
  it('says "máy chưa chắc" with a Vietnamese decimal comma below 0,70', () => {
    expect(itemTrustLabelOf(origin(0.42, false))).toEqual({ text: 'Máy chưa chắc (0,42) — chưa ai duyệt', tone: 'attention' });
  });

  it('keeps the verified tone for a reviewed piece only (A5)', () => {
    expect(itemTrustLabelOf(origin(0.42, true))).toEqual({ text: 'Bạn đã duyệt', tone: 'verified' });
    expect(itemTrustLabelOf(origin(0.9, false))).toBeNull();
  });

  it('flags pieces the machine added that are not on the drawing', () => {
    expect(itemTrustLabelOf({ generated: 'dressing' })?.text).toBe('Máy tự thêm — không có trên bản vẽ');
    expect(itemTrustLabelOf(undefined)).toBeNull();
  });

  it('renders the label of the single selected item', () => {
    const useViewer = create(() => ({ selection: { selectedIds: ['item_F-0123456789AB'] as readonly string[] } }));
    const useScene = create(() => ({ nodes: { 'item_F-0123456789AB': { id: 'item_F-0123456789AB', type: 'item', metadata: origin(0.42, false) } } }));
    const stores = { useViewer, useScene } as unknown as SwapModelStores;

    render(<ItemTrustCard stores={stores} />);

    // Huy hiệu ngắn; câu đầy đủ ở chú thích và tên đọc được.
    const badge = screen.getByRole('status');
    expect(badge.textContent).toBe('Chưa duyệt');
    expect(badge.getAttribute('title')).toBe('Máy chưa chắc (0,42) — chưa ai duyệt');
    expect(badge.getAttribute('aria-label')).toBe('Máy chưa chắc (0,42) — chưa ai duyệt');
  });

  it('NHA-09b — bản sao trình soạn vừa tạo mang túi chép từ món đã duyệt: không hiện "đã duyệt" (A5); món máy tự thêm vẫn có nhãn', () => {
    const useViewer = create(() => ({ selection: { selectedIds: ['item_k3n9q2w8e7r6'] as readonly string[] } }));
    const useScene = create(() => ({
      nodes: {
        item_k3n9q2w8e7r6: { id: 'item_k3n9q2w8e7r6', type: 'item', metadata: origin(0.9, true) },
        'item_DRESS-rail-L-1': { id: 'item_DRESS-rail-L-1', type: 'item', metadata: { generated: 'dressing' } },
      },
    }));
    const stores = { useViewer, useScene } as unknown as SwapModelStores;
    const { container } = render(<ItemTrustCard stores={stores} />);

    expect(container.innerHTML).toBe('');
    act(() => {
      // eslint-disable-next-line local/no-direct-set -- kho giả của test (thay cho `useViewer` của Pascal), không phải kho AppFront.
      useViewer.setState({ selection: { selectedIds: ['item_DRESS-rail-L-1'] } });
    });
    expect(screen.getByRole('status').textContent).toBe('Máy thêm');
  });
});
