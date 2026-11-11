import { act, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

type Status = 'ready' | 'pending' | 'stalled';
const rows = new Map<string, { status: Status; shown?: boolean; fresh?: boolean }>();
const listeners = new Set<() => void>();
const noteSelected = vi.fn();
const noteReady = vi.fn();
const sampled = vi.fn();
let work = false;
vi.mock('./levelWarm', () => ({
  levelReadiness: (sample = true) => {
    sampled(sample);
    return [...rows].map(([levelId, r]) => ({ levelId, shown: true, fresh: true, ...r }));
  },
  levelWorkActive: () => work,
  noteLevelSelected: (id: string) => noteSelected(id),
  noteLevelReady: (id: string) => noteReady(id),
  onLevelWarmFrame: (f: () => void) => {
    listeners.add(f);
    return () => void listeners.delete(f);
  },
}));

const { LevelWarmStatus } = await import('./levelWarmStatus');
const frame = () => act(() => [...listeners].forEach((f) => f()));
const label = () => screen.getByTestId('level-warm-status').textContent;
const stallNote = () => screen.getByTestId('level-warm-stalled').textContent;
const set = (id: string, status: Status, extra: { shown?: boolean; fresh?: boolean } = {}) => rows.set(id, { status, ...extra });

afterEach(() => {
  rows.clear();
  listeners.clear();
  noteSelected.mockClear();
  noteReady.mockClear();
  sampled.mockClear();
});

describe('LevelWarmStatus — nhãn = levelReadiness().status, không bao giờ ready:false mà im lặng', () => {
  it('chưa sẵn sàng → hiện tới khi khung báo sẵn sàng, rồi tắt; ghi thời gian chờ', () => {
    set('L2', 'pending');
    render(<LevelWarmStatus levelId="L2" />);
    expect(label()).toBe('Đang chuẩn bị tầng…');
    expect(screen.getByTestId('level-warm-status').getAttribute('aria-live')).toBe('polite');
    frame();
    expect(label()).toBe('Đang chuẩn bị tầng…');
    set('L2', 'ready');
    frame();
    expect(label()).toBe('');
    expect(noteReady).toHaveBeenCalledWith('L2');
  });

  it('LỖI VÒNG 10: sẵn sàng (số cũ của tầng đã ấm) rồi mẫu mới còn vật chờ → nhãn HIỆN LẠI (vẫn nghe khung)', () => {
    set('L2', 'ready', { shown: false, fresh: false }); // ngay sau bấm: tầng chưa hiện, `warmed` → ready
    render(<LevelWarmStatus levelId="L2" />);
    expect(label()).toBe('');
    expect(listeners.size).toBe(1);
    set('L2', 'ready', { shown: true, fresh: false }); // khung sau: tầng hiện, chưa có mẫu mới → xin mẫu
    sampled.mockClear();
    frame();
    frame();
    expect(sampled).toHaveBeenLastCalledWith(true);
    set('L2', 'pending'); // mẫu mới: 30 vật chờ
    frame();
    expect(label()).toBe('Đang chuẩn bị tầng…');
    set('L2', 'ready');
    frame();
    expect(label()).toBe('');
    sampled.mockClear();
    frame();
    expect(sampled).toHaveBeenLastCalledWith(false); // sẵn sàng + mẫu mới: chỉ đọc, không giữ vòng vẽ chạy
    expect(listeners.size).toBe(1);
  });

  it('gắn trước khung đầu (chưa có dòng nào) → vẫn nghe, khung đầu có dòng chờ thì hiện', () => {
    render(<LevelWarmStatus levelId="L2" />);
    expect(label()).toBe('');
    set('L2', 'pending');
    frame();
    expect(label()).toBe('Đang chuẩn bị tầng…');
  });

  it('đổi nhanh nhiều tầng → trạng thái theo tầng cuối, một đăng ký', () => {
    set('L2', 'pending');
    set('L3', 'pending');
    set('L1', 'ready');
    const { rerender } = render(<LevelWarmStatus levelId="L2" />);
    rerender(<LevelWarmStatus levelId="L3" />);
    rerender(<LevelWarmStatus levelId="L1" />);
    expect(label()).toBe('');
    rerender(<LevelWarmStatus levelId="L3" />);
    expect(label()).toBe('Đang chuẩn bị tầng…');
    set('L2', 'ready'); // tầng cũ xong: không tắt nhãn của tầng đang chọn
    frame();
    expect(label()).toBe('Đang chuẩn bị tầng…');
    expect(listeners.size).toBe(1);
    expect(noteSelected).toHaveBeenLastCalledWith('L3');
  });

  it('unmount (rời dự án) khi đang chờ → gỡ đăng ký, khung sau không setState', () => {
    set('L2', 'pending');
    const err = vi.spyOn(console, 'error').mockImplementation(() => {});
    const { unmount } = render(<LevelWarmStatus levelId="L2" />);
    unmount();
    expect(listeners.size).toBe(0);
    set('L2', 'ready');
    frame();
    expect(err).not.toHaveBeenCalled();
    err.mockRestore();
  });

  it('kẹt → báo kẹt (role=status), GIỮ khi còn kẹt (không tự tắt), KHÔNG ghi là sẵn sàng; xong muộn → tắt', () => {
    vi.useFakeTimers();
    set('L2', 'stalled');
    render(<LevelWarmStatus levelId="L2" />);
    expect(label()).toBe('');
    expect(screen.getByTestId('level-warm-stalled').getAttribute('role')).toBe('status');
    expect(stallNote()).toContain('chuẩn bị lâu hơn bình thường');
    act(() => void vi.advanceTimersByTime(60_000));
    frame();
    expect(stallNote()).toContain('chuẩn bị lâu hơn bình thường');
    expect(noteReady).not.toHaveBeenCalled();
    set('L2', 'ready');
    frame();
    expect(stallNote()).toBe('');
    expect(noteReady).toHaveBeenCalledWith('L2');
    vi.useRealTimers();
  });

  it('Codex #4: sẵn sàng rồi W2 dựng lại (đổi chủ đề) → xin mẫu dù đang ready; hết việc thì thôi', () => {
    set('L2', 'ready');
    render(<LevelWarmStatus levelId="L2" />);
    frame();
    sampled.mockClear();
    work = true;
    frame();
    expect(sampled).toHaveBeenLastCalledWith(false); // mẫu của khung này đọc thụ động; khung sau mới xin
    frame();
    expect(sampled).toHaveBeenLastCalledWith(true);
    set('L2', 'pending');
    frame();
    expect(label()).toBe('Đang chuẩn bị tầng…');
    work = false;
    set('L2', 'ready');
    frame();
    frame();
    expect(sampled).toHaveBeenLastCalledWith(false);
  });

  it('Codex #4 (noticed): báo kẹt rồi số chờ giảm lại (hết kẹt, vẫn chờ) → nhãn chuẩn bị HIỆN LẠI', () => {
    set('L2', 'stalled');
    render(<LevelWarmStatus levelId="L2" />);
    expect(stallNote()).not.toBe('');
    set('L2', 'pending');
    frame();
    expect(stallNote()).toBe('');
    expect(label()).toBe('Đang chuẩn bị tầng…');
  });

  it('không có tầng chọn → rỗng', () => {
    render(<LevelWarmStatus levelId={null} />);
    expect(label()).toBe('');
  });
});
