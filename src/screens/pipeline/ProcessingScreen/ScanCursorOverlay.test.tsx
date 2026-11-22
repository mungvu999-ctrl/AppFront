import { act, cleanup, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { ScanResults } from '@/api/schemas/uploads';

import { ScanCursorOverlay } from './ScanCursorOverlay';

const RESULTS: ScanResults = {
  boxes: [{ label: 'door', xMax: 40, xMin: 20, yMax: 40, yMin: 20 }],
  walls: [{ x1: 0, x2: 100, y1: 10, y2: 10 }],
};
const WALL_PATH = 'M0 10L100 10';
const BOX_PATH = 'M20 20L40 20L40 40L20 40L20 20';

const pathsOf = (): (string | null)[] =>
  [...screen.getByTestId('scan-cursor-overlay').querySelectorAll('path')].map((path) => path.getAttribute('d'));

describe('ScanCursorOverlay', () => {
  let frames: FrameRequestCallback[];

  /** Chạy khung hình đang chờ ở mốc `at` (mili giây), như trình duyệt gọi `requestAnimationFrame`. */
  const runFrame = (at: number): void => {
    const pending = frames;
    frames = [];
    act(() => pending.forEach((callback) => callback(at)));
  };

  beforeEach(() => {
    frames = [];
    vi.spyOn(performance, 'now').mockReturnValue(0);
    vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => frames.push(callback));
    vi.stubGlobal('cancelAnimationFrame', () => undefined);
  });

  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it('con trỏ vẽ dần từng nét rồi biến mất khi vẽ hết', () => {
    render(<ScanCursorOverlay height={100} prefersReducedMotion={false} results={RESULTS} width={100} />);

    runFrame(90);
    expect(screen.getByTestId('scan-cursor')).toBeTruthy();
    expect(pathsOf()).not.toContain(WALL_PATH);

    runFrame(100_000);
    expect(pathsOf()).toEqual([WALL_PATH, BOX_PATH]);
    expect(screen.queryByTestId('scan-cursor')).toBeNull();
  });

  it('giảm chuyển động: hiện hết ngay, không có con trỏ, không xin khung hình', () => {
    render(<ScanCursorOverlay height={100} prefersReducedMotion results={RESULTS} width={100} />);

    expect(pathsOf()).toEqual([WALL_PATH, BOX_PATH]);
    expect(screen.queryByTestId('scan-cursor')).toBeNull();
    expect(frames).toHaveLength(0);
  });
});
