import { act, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

const ready = new Map<string, boolean>();
const stalled = new Set<string>();
const listeners = new Set<() => void>();
const noteSelected = vi.fn();
const noteReady = vi.fn();
vi.mock('./levelWarm', () => ({
  levelReadiness: () => [...ready].map(([levelId, r]) => ({ levelId, ready: r, stalled: stalled.has(levelId) })),
  levelWarmActive: () => true,
  noteLevelSelected: (id: string) => noteSelected(id),
  noteLevelReady: (id: string) => noteReady(id),
  onLevelWarmFrame: (f: () => void) => {
    listeners.add(f);
    return () => void listeners.delete(f);
  },
}));

const { LevelWarmStatus } = await import('./levelWarmStatus');
const frame = () => act(() => [...listeners].forEach((f) => f()));
const label = () => screen.getByRole('status').textContent;

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
    expect(screen.getByRole('status').getAttribute('aria-live')).toBe('polite');
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

  it('tầng kẹt (stalled) → tắt nhãn, gỡ đăng ký, KHÔNG ghi là sẵn sàng', () => {
    ready.set('L2', false);
    render(<LevelWarmStatus levelId="L2" />);
    expect(label()).toBe('Đang chuẩn bị tầng…');
    stalled.add('L2');
    frame();
    expect(label()).toBe('');
    expect(listeners.size).toBe(0);
    expect(noteReady).not.toHaveBeenCalled();
    stalled.clear();
  });

  it('không có tầng chọn → rỗng', () => {
    render(<LevelWarmStatus levelId={null} />);
    expect(label()).toBe('');
  });
});
