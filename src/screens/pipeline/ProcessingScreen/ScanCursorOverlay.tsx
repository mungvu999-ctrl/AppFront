import { useEffect, useRef, useState } from 'react';

import type { ScanResults } from '@/api/schemas/uploads';

import { appendArrived, partialPoints, toPathData, type ScanStroke } from './scanStrokes';

/** Nhịp chậm nhất một nét, và trần cho cả hàng còn lại: nhiều nét thì vẽ nhanh lên, không bắt người dùng chờ. */
const SLOWEST_STROKE_SPAN = 180;
const QUEUE_BUDGET_SPAN = 3500;
/** Con trỏ dài bằng 1/30 cạnh dài trang, để trang to nhỏ đều thấy như nhau. */
const CURSOR_PAGE_FRACTION = 1 / 30;
const CURSOR_PATH_SIZE = 24;
const CURSOR_PATH = 'M0 0L0 20L5.5 15L9.5 24L13 22.5L9 13.5L16 13Z';

interface ScanCursorOverlayProps {
  readonly height: number;
  readonly prefersReducedMotion: boolean;
  readonly results: ScanResults;
  readonly width: number;
}

const strokeClass = (stroke: ScanStroke) => (stroke.kind === 'box' ? 'stroke-accent' : 'stroke-wall-idle');

/**
 * Con trỏ vẽ lại kết quả THẬT của mô hình lên ảnh trang. viewBox bằng đúng khổ ảnh với
 * `xMidYMid meet`, nên lớp vẽ tự khớp ảnh `object-contain` kể cả phần lề.
 */
export function ScanCursorOverlay({ height, prefersReducedMotion, results, width }: ScanCursorOverlayProps) {
  const [queue, setQueue] = useState<readonly ScanStroke[]>([]);
  const [position, setPosition] = useState(0);
  const positionRef = useRef(0);

  useEffect(() => {
    setQueue((current) => appendArrived(current, results, height));
  }, [height, results]);

  const total = queue.length;

  useEffect(() => {
    if (prefersReducedMotion) {
      positionRef.current = total;
      setPosition(total);
      return undefined;
    }
    let frame = 0;
    let last = performance.now();
    const tick = (now: number) => {
      const perSpan = Math.max(1 / SLOWEST_STROKE_SPAN, (total - positionRef.current) / QUEUE_BUDGET_SPAN);
      positionRef.current = Math.min(total, positionRef.current + perSpan * (now - last));
      last = now;
      setPosition(positionRef.current);
      if (positionRef.current < total) frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [prefersReducedMotion, total]);

  const whole = Math.floor(position);
  const current = queue[whole];
  const partial = current === undefined ? [] : partialPoints(current, position - whole);
  const tip = partial.at(-1);
  const cursorScale = (Math.max(width, height) * CURSOR_PAGE_FRACTION) / CURSOR_PATH_SIZE;

  return (
    <svg
      aria-hidden="true"
      className="pointer-events-none absolute inset-0 h-full w-full"
      data-testid="scan-cursor-overlay"
      preserveAspectRatio="xMidYMid meet"
      viewBox={`0 0 ${width} ${height}`}
    >
      {queue.slice(0, whole).map((stroke, index) => (
        <path
          className={`fill-none ${strokeClass(stroke)}`}
          d={toPathData(stroke.points)}
          key={index}
          strokeWidth={1.5}
          vectorEffect="non-scaling-stroke"
        />
      ))}
      {current === undefined ? null : (
        <path
          className={`fill-none ${strokeClass(current)}`}
          d={toPathData(partial)}
          strokeWidth={1.5}
          vectorEffect="non-scaling-stroke"
        />
      )}
      {tip === undefined || prefersReducedMotion ? null : (
        <path
          className="fill-text-primary stroke-bg-surface"
          d={CURSOR_PATH}
          data-testid="scan-cursor"
          strokeWidth={1}
          transform={`translate(${tip[0]} ${tip[1]}) scale(${cursorScale})`}
          vectorEffect="non-scaling-stroke"
        />
      )}
    </svg>
  );
}
