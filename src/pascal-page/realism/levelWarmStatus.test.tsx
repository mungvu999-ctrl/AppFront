import { act, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

const ready = new Map<string, boolean>();
const stalled = new Set<string>();
const listeners = new Set<() => void>();
const noteSelected = vi.fn();
const noteReady = vi.fn();
let retriesLeft = 0;
const retry = vi.fn(() => retriesLeft-- > 0);
vi.mock('./levelWarm', () => ({
  levelReadiness: () => [...ready].map(([levelId, r]) => ({ levelId, ready: r, stalled: stalled.has(levelId) })),
  levelWarmActive: () => true,
  noteLevelSelected: (id: string) => noteSelected(id),
  noteLevelReady: (id: string) => noteReady(id),
  retryStalled: () => retry(),
  onLevelWarmFrame: (f: () => void) => {
    listeners.add(f);
    return () => void listeners.delete(f);
  },
}));

const { LevelWarmStatus } = await import('./levelWarmStatus');
const frame = () => act(() => [...listeners].forEach((f) => f()));
const label = () => screen.getByTestId('level-warm-status').textContent;
const stallNote = () => screen.getByTestId('level-warm-stalled');

afterEach(() => {
  ready.clear();
  listeners.clear();
  noteSelected.mockClear();
  noteReady.mockClear();
});

describe('LevelWarmStatus', () => {
  it('tầng chưa sẵn sàng → hiện tới khi khung báo sẵn sàng, rồi tắt và gỡ đăng ký', () => {
    ready.set('L2', false);
    render(<LevelWarmStatus levelId="L2" />);
    expect(label()).toBe('Đang chuẩn bị tầng…');
    expect(screen.getByTestId('level-warm-status').getAttribute('aria-live')).toBe('polite');
    frame();
    expect(label()).toBe('Đang chuẩn bị tầng…'); // khung chưa xong: không báo xong sớm
    ready.set('L2', true);
    frame();
    expect(label()).toBe('');
    expect(listeners.size).toBe(0);
    expect(noteReady).toHaveBeenCalledWith('L2');
  });

  it('tầng đã sẵn sàng → không hiện', () => {
    ready.set('L1', true);
    render(<LevelWarmStatus levelId="L1" />);
    expect(label()).toBe('');
    expect(listeners.size).toBe(0);
  });

  it('đổi nhanh nhiều tầng → trạng thái theo tầng cuối', () => {
    ready.set('L2', false).set('L3', false).set('L1', true);
    const { rerender } = render(<LevelWarmStatus levelId="L2" />);
    rerender(<LevelWarmStatus levelId="L3" />);
    rerender(<LevelWarmStatus levelId="L1" />);
    expect(label()).toBe('');
    expect(listeners.size).toBe(0);
    rerender(<LevelWarmStatus levelId="L3" />);
    expect(label()).toBe('Đang chuẩn bị tầng…');
    ready.set('L2', true); // tầng cũ xong: không tắt nhãn của tầng đang chọn
    frame();
    expect(label()).toBe('Đang chuẩn bị tầng…');
    expect(listeners.size).toBe(1);
    expect(noteSelected).toHaveBeenLastCalledWith('L3');
  });

  it('unmount khi đang chờ → gỡ đăng ký, khung sau không setState', () => {
    ready.set('L2', false);
    const err = vi.spyOn(console, 'error').mockImplementation(() => {});
    const { unmount } = render(<LevelWarmStatus levelId="L2" />);
    unmount();
    expect(listeners.size).toBe(0);
    ready.set('L2', true);
    frame();
    expect(err).not.toHaveBeenCalled();
    err.mockRestore();
  });

  it('tầng kẹt → tự thử lại có giới hạn, rồi báo kẹt (role=status), tự tắt sau 10 s, KHÔNG ghi là sẵn sàng', () => {
    vi.useFakeTimers();
    retriesLeft = 2;
    retry.mockClear();
    ready.set('L2', false);
    render(<LevelWarmStatus levelId="L2" />);
    expect(label()).toBe('Đang chuẩn bị tầng…');
    stalled.add('L2');
    frame(); // lượt thử 1
    frame(); // lượt thử 2
    expect(label()).toBe('Đang chuẩn bị tầng…');
    expect(stallNote().textContent).toBe('');
    frame(); // hết lượt → báo kẹt
    expect(retry).toHaveBeenCalledTimes(3);
    expect(label()).toBe('');
    expect(stallNote().getAttribute('role')).toBe('status');
    expect(stallNote().textContent).toContain('chuẩn bị lâu hơn bình thường');
    frame();
    expect(retry).toHaveBeenCalledTimes(3); // không thử lại vô hạn
    act(() => void vi.advanceTimersByTime(10_000));
    expect(stallNote().textContent).toBe('');
    expect(noteReady).not.toHaveBeenCalled();
    stalled.clear();
    vi.useRealTimers();
  });

  it('báo kẹt rồi tầng xong muộn → tắt ngay, ghi sẵn sàng, gỡ đăng ký', () => {
    retriesLeft = 0;
    ready.set('L2', false);
    stalled.add('L2');
    render(<LevelWarmStatus levelId="L2" />);
    expect(stallNote().textContent).not.toBe('');
    stalled.clear();
    ready.set('L2', true);
    frame();
    expect(stallNote().textContent).toBe('');
    expect(listeners.size).toBe(0);
    expect(noteReady).toHaveBeenCalledWith('L2');
  });

  it('không có tầng chọn → rỗng', () => {
    render(<LevelWarmStatus levelId={null} />);
    expect(label()).toBe('');
  });
});
