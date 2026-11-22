import { createElement, type ReactNode } from 'react';
import { QueryClientProvider } from '@tanstack/react-query';
import { act, cleanup, renderHook, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { createTestQueryClient } from '@/lib/testing/render';

import { useFloorProposals, type HouseProposalApi } from './useFloorProposals';

/** Bảng không được tiêm cửa đọc: client dựng qua `@/api/appClient` (giả ở đây). */
const app = vi.hoisted(() => ({ mock: false, created: 0, reads: 0 }));

vi.mock('@/api/appClient', () => ({
  resolveUseMockApi: () => app.mock,
  createAppApiClient: (): HouseProposalApi => {
    app.created += 1;
    return {
      houseProposal: {
        read: () => {
          app.reads += 1;
          return Promise.resolve({ ok: true, data: null });
        },
      },
    };
  },
}));

function mount() {
  const client = createTestQueryClient();
  return renderHook(
    () => useFloorProposals('project-client', [], { apply: () => Promise.resolve(true), releaseDraft: () => undefined, canEdit: true }),
    { wrapper: ({ children }: { children: ReactNode }) => createElement(QueryClientProvider, { client }, children) },
  );
}

/** Đọc lần đầu rồi "Thử lại": hai lượt lấy client. */
async function readTwice() {
  app.created = 0;
  app.reads = 0;
  const mounted = mount();
  await waitFor(() => expect(app.reads).toBe(1));
  act(() => mounted.result.current.panel.onRetry());
  await waitFor(() => expect(app.reads).toBe(2));
}

afterEach(cleanup);

describe('useFloorProposals — client', () => {
  it('chế độ thật: mỗi lượt dựng client mới (client thật ghim người dùng đầu tiên)', async () => {
    app.mock = false;
    await readTwice();
    expect(app.created).toBe(2);
  });

  it('chế độ mẫu: dùng chung một client để dấu vừa ghi đọc lại được', async () => {
    app.mock = true;
    await readTwice();
    expect(app.created).toBe(1);
  });
});
