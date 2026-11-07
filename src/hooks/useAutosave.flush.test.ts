/** M1 H3.1 — `flushAutosaves()` nói rõ lượt xả có lưu hết hay không. */
import { act, renderHook } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';

import { createAutosave } from '@/lib/autosave/createAutosave';
import { useStore } from '@/store';

import { FLUSH_FAILED, FLUSH_OFFLINE, FLUSH_UNSENT, flushAutosaves, useFlushOnSave } from './useAutosave';

const mountEngine = (save: () => Promise<void>, online = true) => {
  const engine = createAutosave<true>({
    getChanges: () => true,
    isOnline: () => online,
    isTransientError: () => false,
    save,
  });

  renderHook(() => useFlushOnSave(engine));

  return engine;
};

afterEach(() => {
  act(() => useStore.getState().setUnsavedFloorIds([]));
});

describe('flushAutosaves', () => {
  it('không engine nào, không tầng chờ: ok', async () => {
    await expect(flushAutosaves()).resolves.toEqual({ ok: true });
  });

  it('lưu được: ok', async () => {
    mountEngine(() => Promise.resolve());
    await act(async () => {
      await expect(flushAutosaves()).resolves.toEqual({ ok: true });
    });
  });

  it('lượt lưu hỏng: ok false kèm lý do, không ném', async () => {
    mountEngine(() => Promise.reject(new Error('500')));
    await act(async () => {
      await expect(flushAutosaves()).resolves.toEqual({ ok: false, reason: FLUSH_FAILED });
    });
  });

  it('mất mạng: ok false', async () => {
    mountEngine(() => Promise.resolve(), false);
    await act(async () => {
      await expect(flushAutosaves()).resolves.toEqual({ ok: false, reason: FLUSH_OFFLINE });
    });
  });

  it('tầng còn trong unsavedFloorIds (409 xung đột, khối): ok false', async () => {
    act(() => useStore.getState().setUnsavedFloorIds(['floor-1']));
    await expect(flushAutosaves()).resolves.toEqual({ ok: false, reason: FLUSH_UNSENT });
  });
});
