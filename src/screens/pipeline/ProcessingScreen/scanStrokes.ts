import type { ScanResults } from '@/api/schemas/uploads';

/** Một đỉnh, toạ độ pixel trang đã nắn. */
type ScanPoint = readonly [number, number];

/** Một nét con trỏ sẽ vẽ. */
export interface ScanStroke {
  readonly kind: 'box' | 'wall';
  /** Các đỉnh của đường; hộp khép kín nên đỉnh cuối trùng đỉnh đầu. */
  readonly points: readonly ScanPoint[];
}

const SWEEP_BANDS = 8;

const center = ({ points }: ScanStroke): ScanPoint => {
  const xs = points.map(([x]) => x);
  const ys = points.map(([, y]) => y);
  return [(Math.min(...xs) + Math.max(...xs)) / 2, (Math.min(...ys) + Math.max(...ys)) / 2];
};

/** Xếp theo từng dải ngang, đảo chiều mỗi dải, để con trỏ đi liền thay vì nhảy khắp trang. */
export function sweepOrder(strokes: readonly ScanStroke[], pageHeight: number): readonly ScanStroke[] {
  const bandHeight = Math.max(pageHeight, 1) / SWEEP_BANDS;
  const keyed = strokes.map((stroke) => {
    const [x, y] = center(stroke);
    const band = Math.floor(y / bandHeight);
    return { band, stroke, x: band % 2 === 0 ? x : -x };
  });
  keyed.sort((a, b) => a.band - b.band || a.x - b.x);
  return keyed.map(({ stroke }) => stroke);
}

const wallStrokes = ({ walls }: ScanResults): readonly ScanStroke[] =>
  walls.map(({ x1, x2, y1, y2 }) => ({
    kind: 'wall',
    points: [
      [x1, y1],
      [x2, y2],
    ],
  }));

const boxStrokes = ({ boxes }: ScanResults): readonly ScanStroke[] =>
  boxes.map(({ xMax, xMin, yMax, yMin }) => ({
    kind: 'box',
    points: [
      [xMin, yMin],
      [xMax, yMin],
      [xMax, yMax],
      [xMin, yMax],
      [xMin, yMin],
    ],
  }));

/** Nối kết quả của bước vừa về vào cuối hàng; bước đã có trong hàng không thêm lại. */
export function appendArrived(
  queue: readonly ScanStroke[],
  results: ScanResults,
  pageHeight: number,
): readonly ScanStroke[] {
  const has = (kind: ScanStroke['kind']) => queue.some((stroke) => stroke.kind === kind);
  const walls = has('wall') ? [] : sweepOrder(wallStrokes(results), pageHeight);
  const boxes = has('box') ? [] : sweepOrder(boxStrokes(results), pageHeight);
  return walls.length + boxes.length === 0 ? queue : [...queue, ...walls, ...boxes];
}

/** Phần đã vẽ của một nét ở tỉ lệ `t` (0..1) chiều dài; đỉnh cuối là chỗ con trỏ. */
export function partialPoints(stroke: ScanStroke, t: number): readonly ScanPoint[] {
  const [first, ...rest] = stroke.points;
  if (first === undefined) return [];
  let previous = first;
  const segments = rest.map((end) => {
    const segment = { end, length: Math.hypot(end[0] - previous[0], end[1] - previous[1]), start: previous };
    previous = end;
    return segment;
  });
  let left = Math.min(Math.max(t, 0), 1) * segments.reduce((sum, { length }) => sum + length, 0);
  const drawn: ScanPoint[] = [first];
  for (const { end, length, start } of segments) {
    if (left >= length) {
      drawn.push(end);
      left -= length;
      continue;
    }
    const ratio = left / length;
    drawn.push([start[0] + (end[0] - start[0]) * ratio, start[1] + (end[1] - start[1]) * ratio]);
    break;
  }
  return drawn;
}

export const toPathData = (points: readonly ScanPoint[]): string =>
  points.map(([x, y], index) => `${index === 0 ? 'M' : 'L'}${x} ${y}`).join('');
