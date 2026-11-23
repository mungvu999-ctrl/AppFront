/**
 * Lối vào "Tải cả bộ hồ sơ" ở màn Quản lý tầng (K-32b): hiện đúng khi công tắc `DRAWING_SET_ENABLED` bật
 * (N52 `enabled: true`) và người dùng sửa được bản vẽ; mọi trường hợp khác nút RỜI khỏi DOM (R-69), và DOM
 * y như màn không có khe.
 */

import { act, cleanup, fireEvent, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { createShortcutRegistry } from '@/lib/input/shortcutRegistry';
import { renderWithProviders } from '@/lib/testing/render';
import { useStore } from '@/store';
import { resetSelectorCaches } from '@/store/selectors';

import { FloorManagerContainer } from './FloorManager.container';
import { createMockFloorManagerGateway } from './floorManagerGateway';
import type { HouseProposalApi } from './useFloorProposals';

const ENTRY_LABEL = 'Tải cả bộ hồ sơ';
const EMPTY_PROPOSAL = { enabled: true, floors: [], runIds: [] };

const api = (data: typeof EMPTY_PROPOSAL | null): HouseProposalApi => ({
  houseProposal: { read: () => Promise.resolve({ ok: true, data }) },
});

const domOf = (): string => document.body.innerHTML.replace(/_r_[0-9a-z]+_/g, '_id_');

async function mount(options: { proposalApi: HouseProposalApi; roles?: readonly ('admin' | 'engineer' | 'viewer')[]; onOpen?: () => void }) {
  const view = renderWithProviders(
    <FloorManagerContainer
      gateway={createMockFloorManagerGateway()}
      projectId="project-drawing-set-entry"
      proposalApi={options.proposalApi}
      registry={createShortcutRegistry()}
      roles={options.roles ?? ['engineer']}
      {...(options.onOpen === undefined ? {} : { onNavigateToDrawingSets: options.onOpen })}
    />,
  );

  await waitFor(() => expect(view.queryClient.isFetching()).toBe(0));
  await act(() => new Promise((done) => setTimeout(done, 0)));

  return view;
}

afterEach(() => {
  cleanup();
  useStore.getState().setSpatial(null, null);
  resetSelectorCaches();
});

describe('lối vào "Tải cả bộ hồ sơ"', () => {
  it('công tắc bật và sửa được: nút hiện, bấm mở màn bộ hồ sơ', async () => {
    const onOpen = vi.fn();

    await mount({ proposalApi: api(EMPTY_PROPOSAL), onOpen });
    fireEvent.click(await screen.findByRole('button', { name: ENTRY_LABEL }));
    expect(onOpen).toHaveBeenCalledTimes(1);
  });

  it('công tắc tắt (N52 → null): không nút, DOM y như màn không có lối vào', async () => {
    await mount({ proposalApi: api(null), onOpen: vi.fn() });
    const off = domOf();

    cleanup();
    useStore.getState().setSpatial(null, null);
    resetSelectorCaches();
    await mount({ proposalApi: api(null) });
    expect(screen.queryByRole('button', { name: ENTRY_LABEL })).toBeNull();
    expect(screen.queryByText(ENTRY_LABEL)).toBeNull();
    expect(domOf()).toBe(off);
  });

  it('vai người xem: không nút dù công tắc bật', async () => {
    await mount({ proposalApi: api(EMPTY_PROPOSAL), onOpen: vi.fn(), roles: ['viewer'] });
    expect(screen.queryByRole('button', { name: ENTRY_LABEL })).toBeNull();
  });

  it('không có nơi dẫn tới màn bộ hồ sơ: không dựng nút chết', async () => {
    await mount({ proposalApi: api(EMPTY_PROPOSAL) });
    expect(screen.queryByRole('button', { name: ENTRY_LABEL })).toBeNull();
  });

  it('lỗi đọc công tắc (5xx): không nút', async () => {
    const failing: HouseProposalApi = {
      houseProposal: {
        read: () =>
          Promise.resolve({ ok: false, error: { kind: 'http', status: 500, code: 'INTERNAL', requestId: 'r', retryable: false, raw: null } }),
      },
    };

    await mount({ proposalApi: failing, onOpen: vi.fn() });
    expect(screen.queryByRole('button', { name: ENTRY_LABEL })).toBeNull();
  });
});
