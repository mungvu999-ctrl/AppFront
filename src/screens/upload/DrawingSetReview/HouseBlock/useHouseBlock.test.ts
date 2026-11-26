import { act, cleanup, renderHook, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import type { ApiResult } from '@/api/client';
import type { DrawingSetClient } from '@/api/drawingSetClient';
import type { BuildingProposal, SetBuilding } from '@/api/schemas/setBuilding';

import { useHouseBlock } from './useHouseBlock';

type Read = DrawingSetClient['readBuilding'];

const proposalOf = (levelRef: string): BuildingProposal => ({
  unitSystem: { value: 'metric', confidence: 0.9, source: 'plan', viewIds: [] },
  floors: [],
  levels: [{ levelRef }],
  roofs: [],
  conflicts: [],
  violations: [],
});

const ok = (data: SetBuilding): ApiResult<SetBuilding> => ({ ok: true, data });
const FAILED = { ok: false, error: { kind: 'network' } } as unknown as ApiResult<SetBuilding>;

/** Lượt đọc mà test tự quyết lúc nào trả. */
function deferred(): {
  readonly promise: Promise<ApiResult<SetBuilding>>;
  readonly resolve: (value: ApiResult<SetBuilding>) => void;
} {
  let resolve: (value: ApiResult<SetBuilding>) => void = () => undefined;
  const promise = new Promise<ApiResult<SetBuilding>>((done) => {
    resolve = done;
  });

  return { promise, resolve };
}

const renderBlock = (readBuilding: Read, revision = 1) => {
  // Một đối tượng cho mọi lượt render, như `gateway.sets` của màn: hook đọc lại khi `sets` đổi.
  const sets = { readBuilding };

  return renderHook(
    ({ rev }) => useHouseBlock({ sets, projectId: 'p1', setId: 's1', revision: rev }),
    {
      initialProps: { rev: revision },
    },
  );
};

afterEach(cleanup);

describe('useHouseBlock', () => {
  it('mở màn: đang tải, rồi có đề xuất; gọi đúng bộ', async () => {
    const readBuilding = vi
      .fn<Read>()
      .mockResolvedValue(ok({ enabled: true, proposal: proposalOf('v1') }));
    const { result } = renderBlock(readBuilding);

    expect(result.current.state).toEqual({ status: 'loading' });
    await waitFor(() => expect(result.current.state.status).toBe('ready'));
    expect(result.current.state).toEqual({
      status: 'ready',
      proposal: proposalOf('v1'),
      isRefreshing: false,
    });
    expect(readBuilding).toHaveBeenCalledTimes(1);
    expect(readBuilding.mock.calls[0]?.[0]).toMatchObject({ projectId: 'p1', setId: 's1' });
  });

  it.each([
    ['công tắc tắt', { enabled: false }],
    ['bộ chưa có đề xuất', { enabled: true }],
  ] as const)('%s: ẩn khối, không báo lỗi', async (_name, body) => {
    const { result } = renderBlock(vi.fn<Read>().mockResolvedValue(ok(body)));

    await waitFor(() => expect(result.current.state).toEqual({ status: 'hidden' }));
  });

  it('lỗi đọc: báo lỗi; thử lại thì đọc lại và hiện đề xuất', async () => {
    const readBuilding = vi
      .fn<Read>()
      .mockResolvedValueOnce(FAILED)
      .mockResolvedValue(ok({ enabled: true, proposal: proposalOf('v1') }));
    const { result } = renderBlock(readBuilding);

    await waitFor(() => expect(result.current.state).toEqual({ status: 'error' }));
    act(() => {
      result.current.retry();
    });
    await waitFor(() => expect(result.current.state.status).toBe('ready'));
    expect(readBuilding).toHaveBeenCalledTimes(2);
  });

  it('bản duyệt vừa lưu (revision đổi): đọc lại, giữ đề xuất cũ trên màn trong lúc chờ', async () => {
    const second = deferred();
    const readBuilding = vi
      .fn<Read>()
      .mockResolvedValueOnce(ok({ enabled: true, proposal: proposalOf('v1') }))
      .mockReturnValueOnce(second.promise);
    const { result, rerender } = renderBlock(readBuilding);

    await waitFor(() => expect(result.current.state.status).toBe('ready'));
    rerender({ rev: 2 });
    await waitFor(() =>
      expect(result.current.state).toEqual({
        status: 'ready',
        proposal: proposalOf('v1'),
        isRefreshing: true,
      }),
    );
    await act(async () => {
      second.resolve(ok({ enabled: true, proposal: proposalOf('v2') }));
      await second.promise;
    });
    expect(result.current.state).toEqual({
      status: 'ready',
      proposal: proposalOf('v2'),
      isRefreshing: false,
    });
  });

  it('lượt cũ về sau lượt mới thì bị bỏ, và bị huỷ qua signal', async () => {
    const first = deferred();
    const readBuilding = vi
      .fn<Read>()
      .mockReturnValueOnce(first.promise)
      .mockResolvedValue(ok({ enabled: true, proposal: proposalOf('v2') }));
    const { result, rerender } = renderBlock(readBuilding);

    rerender({ rev: 2 });
    await waitFor(() => expect(result.current.state.status).toBe('ready'));
    expect(readBuilding.mock.calls[0]?.[0].signal?.aborted).toBe(true);
    await act(async () => {
      first.resolve(ok({ enabled: true, proposal: proposalOf('v1') }));
      await first.promise;
    });
    expect(result.current.state).toMatchObject({ proposal: proposalOf('v2') });
  });

  it.each([
    ['lỗi', FAILED, { status: 'error' }],
    ['không còn đề xuất', ok({ enabled: true }), { status: 'hidden' }],
  ] as const)('đọc lại sau khi lưu mà %s: bỏ đề xuất cũ (nó thuộc bản duyệt trước), không giữ số cũ như số mới', async (_name, second, expected) => {
    const readBuilding = vi
      .fn<Read>()
      .mockResolvedValueOnce(ok({ enabled: true, proposal: proposalOf('v1') }))
      .mockResolvedValueOnce(second);
    const { result, rerender } = renderBlock(readBuilding);

    await waitFor(() => expect(result.current.state.status).toBe('ready'));
    rerender({ rev: 2 });
    await waitFor(() => expect(result.current.state).toEqual(expected));
  });

  it('rời màn giữa lúc đọc: huỷ lượt đang chạy', () => {
    const readBuilding = vi.fn<Read>().mockReturnValue(deferred().promise);
    const { unmount } = renderBlock(readBuilding);

    unmount();
    expect(readBuilding.mock.calls[0]?.[0].signal?.aborted).toBe(true);
  });
});
