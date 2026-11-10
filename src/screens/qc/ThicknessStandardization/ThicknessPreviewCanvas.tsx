/**
 * Canvas của màn QC "Chuẩn hoá độ dày tường" — bản Z chiếm cả vùng giữa (trước: cột phải rộng
 * {@link THICKNESS_PREVIEW_CANVAS_WIDTH_PX}, mặt bằng thu nhỏ giữ ngữ cảnh
 * không gian cho biểu đồ và hai bảng bên trái). Phép chiếu tính theo kích thước khung đo được.
 *
 * View thuần của mục D (R-60): mọi thứ vào bằng
 * {@link ThicknessPreviewCanvasProps}, không `src/api`, không `src/store`,
 * không `src/domain`, không `src/lib/http`. Phần tính — hộp bao, tỉ lệ, khoảng
 * lệch căn giữa, hộp bao pixel của từng tường — nằm ở module anh em thuần
 * `thicknessPreviewGeometry.ts`; file này chỉ gọi rồi vẽ.
 *
 * ## Đây là XEM TRƯỚC PHỤ, không phải chỗ thao tác chính
 *
 * Đặc tả nói rõ như vậy, và nó quyết định hai điều dễ làm sai:
 *
 * - Canvas KHÔNG chọn, KHÔNG sửa, KHÔNG áp gì. Đường ra duy nhất của nó là
 *   `onHoverWall` — chỉ báo "con trỏ đang ở tường nào", còn việc tô sáng hàng
 *   nào trong hai bảng là do màn cha điều phối.
 * - Đa giác không phải nút bấm. Đường đi hạng nhất của bàn phím (A12) ở màn này
 *   là hai bảng và ba ngưỡng của biểu đồ — cả ba đều đặt cùng một
 *   `hoveredWallId`/`hoveredGroup` mà canvas đọc. Gắn 48 đa giác vào vòng Tab
 *   sẽ thêm 48 chặng dừng cho một mặt bằng chỉ để nhìn, và làm loãng đúng
 *   đường đi mà A12 muốn giữ ngắn.
 *
 * ## Tô sáng và viền
 *
 * Tường "khớp" là tường đang được trỏ tới, hoặc thuộc nhóm đang được trỏ tới
 * (nhóm đó chính là thứ một cột biểu đồ ánh xạ sang). Khớp thì nền đậm lên và
 * nhận một `SelectionHalo`; không khớp thì mờ đi. `SelectionHalo` là `<div>`
 * tuyệt đối tính bằng pixel còn đa giác vẽ bằng SVG — hai lớp chỉ chồng khít
 * nhau nhờ dùng CHUNG một phép chiếu, xem đầu `thicknessPreviewGeometry.ts`.
 *
 * ## Trạng thái `collapsed`
 *
 * Cấm tuyệt đối: ẩn canvas xem trước, KHÔNG xoá dữ liệu. Component trả `null`
 * — màn còn lại biểu đồ và hai bảng, và mọi thứ quay lại nguyên vẹn khi mở ra,
 * vì props không hề bị đụng tới.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import { thicknessGroupToken } from './thicknessGroupColor';
import { SelectionHalo } from '@/components/canvas/SelectionHalo';

import {
  computeProjection,
  projectOutline,
  projectedBoundsOf,
  svgPointsAttr,
  THICKNESS_PREVIEW_CANVAS_HEIGHT_PX,
  WALL_FILL_OPACITY,
  WALL_FILL_OPACITY_DIMMED,
  WALL_FILL_OPACITY_MATCHED,
  WALL_OUTLINE_STROKE_WIDTH_PX,
} from './thicknessPreviewGeometry';
import {
  THICKNESS_PREVIEW_CANVAS_WIDTH_PX,
  type ThicknessPreviewCanvasProps,
  type ThicknessWallShapeViewModel,
} from './thicknessTypes';

const NO_WALL_IDS: NonNullable<ThicknessPreviewCanvasProps['hoveredBinWallIds']> = [];

/* -------------------------------------------------------------------------- */
/* Chuỗi tiếng Việt tĩnh — khớp `docs/notes/thickness/t6.i18n.fragment.json`.  */
/* -------------------------------------------------------------------------- */

const CANVAS_LABEL = 'Mặt bằng xem trước theo nhóm độ dày';
const LEGEND_LABEL = 'Chú giải độ dày tường';
const EMPTY_NOTICE = 'Chưa có hình tường để xem trước';
const ATTENTION_LEGEND = 'Không chuẩn';
const ATTENTION_STROKE = 'var(--state-attention-stroke)';
const ATTENTION_STROKE_WIDTH_PX = 2.5;

const LEGEND_SWATCH_PX = 16;

/** Dải đáy dành cho khay chú giải nổi: mặt bằng vừa khung PHÍA TRÊN khay, không bị che. */
const LEGEND_RESERVE_PX = 56;

/** Khung chưa đo được (jsdom, lượt vẽ đầu): dùng kích thước cũ 320 × 260. */
const FALLBACK_SIZE = { width: THICKNESS_PREVIEW_CANVAS_WIDTH_PX, height: THICKNESS_PREVIEW_CANVAS_HEIGHT_PX };

/** Kích thước thật của khung vẽ — bản Z: canvas chiếm hết vùng giữa (≥ 65 % bề ngang). */
function useStageSize() {
  const ref = useRef<HTMLDivElement | null>(null);
  const [size, setSize] = useState(FALLBACK_SIZE);

  useEffect(() => {
    const stage = ref.current;

    if (stage === null || typeof ResizeObserver === 'undefined') {
      return undefined;
    }

    const observer = new ResizeObserver(() => {
      if (stage.clientWidth > 0 && stage.clientHeight > 0) {
        setSize({ width: stage.clientWidth, height: stage.clientHeight });
      }
    });

    observer.observe(stage);

    return () => observer.disconnect();
  }, []);

  return { ref, size };
}

/* -------------------------------------------------------------------------- */
/* Canvas.                                                                     */
/* -------------------------------------------------------------------------- */

export function ThicknessPreviewCanvas({
  shapes,
  legend,
  hoveredGroup,
  hoveredWallId,
  onHoverWall,
  isCollapsed,
  hoveredBinWallIds = NO_WALL_IDS,
  attentionWallIds = NO_WALL_IDS,
}: ThicknessPreviewCanvasProps) {
  const { ref, size } = useStageSize();
  const projection = useMemo(
    () => computeProjection(shapes, size.width, Math.max(size.height - LEGEND_RESERVE_PX, 0)),
    [shapes, size.height, size.width],
  );

  /** Mỗi tường một lần chiếu, dùng cho cả đa giác SVG lẫn hộp bao của `SelectionHalo`. */
  const figures = useMemo(
    () =>
      shapes.map((shape) => ({
        wallId: shape.wallId,
        group: shape.group,
        colorToken: thicknessGroupToken(shape.group),
        points: svgPointsAttr(projectOutline(shape.outline, projection)),
        boundsPx: projectedBoundsOf(shape, projection),
      })),
    [projection, shapes],
  );

  const handleLeave = useCallback(() => {
    onHoverWall(null);
  }, [onHoverWall]);

  if (isCollapsed) {
    return null;
  }

  /* Rê một cột biểu đồ thì tường của cột đó sáng lên (BUG-606) — cùng cách một tường đang trỏ. */
  const binWalls = new Set(hoveredBinWallIds);
  const attentionWalls = new Set(attentionWallIds);
  const isMatchedFigure = (figure: Pick<ThicknessWallShapeViewModel, 'wallId' | 'group'>): boolean =>
    figure.wallId === hoveredWallId || figure.group === hoveredGroup || binWalls.has(figure.wallId);
  const hasHover = hoveredGroup !== null || hoveredWallId !== null || binWalls.size > 0;

  return (
    <aside aria-label={CANVAS_LABEL} className="relative flex h-full w-full flex-col">
      <div
        ref={ref}
        className="relative min-h-0 w-full flex-1 overflow-hidden rounded-xl bg-canvas-2d shadow-panel"
        onMouseLeave={handleLeave}
      >
        {figures.length === 0 ? (
          <p className="absolute inset-0 flex items-center justify-center px-4 text-center text-body-sm text-text-secondary">
            {EMPTY_NOTICE}
          </p>
        ) : (
          <>
            <svg
              aria-hidden="true"
              className="absolute inset-0 h-full w-full"
              role="presentation"
              viewBox={`0 0 ${String(size.width)} ${String(size.height)}`}
            >
              {figures.map((figure) => {
                const isMatched = isMatchedFigure(figure);

                return (
                  <polygon
                    key={figure.wallId}
                    className="transition-opacity duration-standard motion-reduce:transition-none"
                    fill={figure.colorToken}
                    fillOpacity={
                      isMatched
                        ? WALL_FILL_OPACITY_MATCHED
                        : hasHover
                          ? WALL_FILL_OPACITY_DIMMED
                          : WALL_FILL_OPACITY
                    }
                    points={figure.points}
                    stroke={attentionWalls.has(figure.wallId) ? ATTENTION_STROKE : figure.colorToken}
                    strokeWidth={attentionWalls.has(figure.wallId) ? ATTENTION_STROKE_WIDTH_PX : WALL_OUTLINE_STROKE_WIDTH_PX}
                    onMouseEnter={() => {
                      onHoverWall(figure.wallId);
                    }}
                  />
                );
              })}
            </svg>

            {/* Viền cho những tường khớp nhóm / cột biểu đồ đang trỏ tới. */}
            {figures
              .filter(isMatchedFigure)
              .map((figure) => (
                <SelectionHalo
                  key={figure.wallId}
                  height={figure.boundsPx.height}
                  isVisible
                  variant={figure.wallId === hoveredWallId ? 'selected' : 'hover'}
                  width={figure.boundsPx.width}
                  x={figure.boundsPx.x}
                  y={figure.boundsPx.y}
                />
              ))}
          </>
        )}

        {/* Chú giải nổi trong khung (bản Z): rỗng thì không có khay trắng mồ côi (BUG-412). */}
        {legend.length === 0 && attentionWalls.size === 0 ? null : (
          <ul
            aria-label={LEGEND_LABEL}
            className="absolute bottom-3 left-3 flex flex-wrap gap-x-4 gap-y-1 rounded-lg bg-bg-surface px-3 py-2 shadow-panel"
          >
            {legend.map((entry) => (
              <li key={String(entry.group)} className="flex items-center gap-2">
                <span
                  aria-hidden="true"
                  className="shrink-0 rounded-[3px]"
                  style={{
                    backgroundColor: entry.colorToken,
                    height: LEGEND_SWATCH_PX,
                    width: LEGEND_SWATCH_PX,
                  }}
                />
                <span className="text-body-sm leading-none text-text-primary">{entry.label}</span>
              </li>
            ))}
            {attentionWalls.size === 0 ? null : (
              <li className="flex items-center gap-2">
                <span
                  aria-hidden="true"
                  className="shrink-0 rounded-[3px] border-2 bg-state-attention-tint"
                  style={{ borderColor: ATTENTION_STROKE, height: LEGEND_SWATCH_PX, width: LEGEND_SWATCH_PX }}
                />
                <span className="text-body-sm leading-none text-text-primary">{ATTENTION_LEGEND}</span>
              </li>
            )}
          </ul>
        )}
      </div>
    </aside>
  );
}
