import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { renderHook, waitFor } from '@testing-library/react';
import { createElement, type ReactNode } from 'react';
import { describe, expect, it } from 'vitest';

import type { Floor } from '@/api/client';

import { useProjectFloors } from './useProjectFloors';

const floor = (id: string, order: number, extra: Partial<Floor> = {}): Floor => ({
  drawings: [],
  elevationMm: order * 3000,
  heightMm: 3000,
  id,
  name: `Tầng ${String(order + 1)}`,
  order,
  ...extra,
});

describe('useProjectFloors (NO-482)', () => {
  it('dự án 3 tầng + 1 mặt cắt: thanh chọn tầng chỉ có 3 tầng', async () => {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const wrapper = ({ children }: { children: ReactNode }): ReactNode =>
      createElement(QueryClientProvider, { client }, children);
    const data = [floor('a', 0), floor('s', 1, { isSection: true, name: 'Mặt cắt A-A' }), floor('b', 2), floor('c', 3)];
    const { result } = renderHook(() => useProjectFloors('p1', () => Promise.resolve({ ok: true, data })), { wrapper });

    await waitFor(() => {
      expect(result.current).toHaveLength(3);
    });
    expect(result.current.map((item) => item.id)).toEqual(['a', 'b', 'c']);
  });
});
