// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  EXPORT_DONE,
  EXPORT_FAILED,
  EXPORT_PREPARING,
  EXPORT_READY_POLL_MS,
  EXPORT_READY_TIMEOUT_MS,
  EXPORT_TIMEOUT,
  runFullGlbExport,
} from '../exportFullGlb';

const setup = (ready: () => boolean, exportGlb: () => Promise<unknown> = vi.fn(() => Promise.resolve({}))) => {
  const deps = { isReady: vi.fn(ready), exportGlb: vi.fn(exportGlb), openSettings: vi.fn(), notify: vi.fn() };
  return { deps, cancel: runFullGlbExport(deps) };
};

describe('runFullGlbExport — GLB đầy đủ qua modelExport của editor', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('mở Cài đặt, báo đang chuẩn bị, xuất sau hai lượt sẵn sàng liên tiếp', async () => {
    let ok = false;
    const { deps } = setup(() => ok);
    expect(deps.openSettings).toHaveBeenCalledTimes(1);
    expect(deps.notify).toHaveBeenCalledWith(EXPORT_PREPARING);
    await vi.advanceTimersByTimeAsync(EXPORT_READY_POLL_MS * 3);
    expect(deps.exportGlb).not.toHaveBeenCalled();
    ok = true;
    await vi.advanceTimersByTimeAsync(EXPORT_READY_POLL_MS * 3);
    expect(deps.exportGlb).toHaveBeenCalledTimes(1);
    expect(deps.notify).toHaveBeenLastCalledWith(EXPORT_DONE);
  });

  it('một lượt sẵn sàng rồi lại dựng tiếp thì chưa xuất', async () => {
    const seq = [true, false, true, true];
    const { deps } = setup(() => seq.shift() ?? true);
    await vi.advanceTimersByTimeAsync(EXPORT_READY_POLL_MS * 2);
    expect(deps.exportGlb).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(EXPORT_READY_POLL_MS * 2);
    expect(deps.exportGlb).toHaveBeenCalledTimes(1);
  });

  it('quá hạn chờ thì báo và không xuất', async () => {
    const { deps } = setup(() => false);
    await vi.advanceTimersByTimeAsync(EXPORT_READY_TIMEOUT_MS + EXPORT_READY_POLL_MS);
    expect(deps.exportGlb).not.toHaveBeenCalled();
    expect(deps.notify).toHaveBeenLastCalledWith(EXPORT_TIMEOUT);
  });

  it('bộ xuất ném lỗi hoặc không ra tệp thì báo lỗi', async () => {
    const a = setup(() => true, vi.fn(() => Promise.reject(new Error('x'))));
    await vi.advanceTimersByTimeAsync(EXPORT_READY_POLL_MS * 2);
    expect(a.deps.notify).toHaveBeenLastCalledWith(EXPORT_FAILED);
    const b = setup(() => true, vi.fn(() => Promise.resolve(null)));
    await vi.advanceTimersByTimeAsync(EXPORT_READY_POLL_MS * 2);
    expect(b.deps.notify).toHaveBeenLastCalledWith(EXPORT_FAILED);
  });

  it('huỷ thì không xuất nữa', async () => {
    const { deps, cancel } = setup(() => false);
    cancel();
    await vi.advanceTimersByTimeAsync(EXPORT_READY_TIMEOUT_MS * 2);
    expect(deps.notify).toHaveBeenCalledTimes(1);
  });
});
