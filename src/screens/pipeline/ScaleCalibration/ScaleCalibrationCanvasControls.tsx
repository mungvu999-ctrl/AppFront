/**
 * Hai mảnh tương tác nằm TRÊN canvas Hiệu chỉnh tỷ lệ, tách khỏi `ScaleCalibrationCanvas.tsx` cho
 * file đó dưới trần 400 dòng (R-22): tay cầm hai đầu đoạn tham chiếu, và cụm thu phóng + bản đồ nhỏ.
 * View thuần — mọi thứ vào bằng props.
 *
 * ## Vì sao tay nắm bù ngược zoom
 *
 * Tay nắm nằm trong cùng lớp nhận `transform: scale(zoom)` để vị trí của nó luôn
 * khớp đúng điểm tỉ lệ đang bám theo khi kéo/phóng; `scale(1 / zoom)` cục bộ giữ
 * đường kính 10px không đổi trên màn hình dù khung nhìn phóng to bao nhiêu — nét
 * 2px của chính đoạn thẳng dùng `vector-effect="non-scaling-stroke"` cho cùng lý do.
 */

import type { CSSProperties, SyntheticEvent } from 'react';

import { MiniMap } from '@/components/canvas/MiniMap';
import { QcZoomMenu } from '../../qc/shared/QcZoomMenu';
import { cn } from '@/lib/utils';

import type {
  DimensionStringRow,
  ImageRatioPoint,
  NudgeDirection,
  ReferenceLineEndpoint,
  ScaleCalibrationCanvasProps,
  ScaleCanvasViewModel,
} from './types';

type CanvasActions = ScaleCalibrationCanvasProps['actions'];

const ROW_ARIA_LABEL_PREFIX = 'Chuỗi kích thước ';

function rowRectStyle(row: DimensionStringRow): CSSProperties {
  const { min, max } = row.boundingBox;
  return {
    left: `${min.x * 100}%`,
    top: `${min.y * 100}%`,
    width: `${(max.x - min.x) * 100}%`,
    height: `${(max.y - min.y) * 100}%`,
  };
}

interface DimensionRowBoxProps {
  readonly row: DimensionStringRow;
  readonly onHover: CanvasActions['onHoverDimensionRow'];
  readonly onSelect: CanvasActions['onSelectDimensionRow'];
}

/** Khung một chuỗi kích thước OCR trên ảnh: bấm để chọn, rê/tiêu điểm để tô sáng hàng tương ứng. */
export function DimensionRowBox({ row, onHover, onSelect }: DimensionRowBoxProps) {
  return (
    <button
      aria-label={`${ROW_ARIA_LABEL_PREFIX}${row.valueLabel}`}
      className={cn(
        'absolute flex items-center justify-center rounded-sm border-2 bg-transparent p-0',
        row.isLowConfidence ? 'border-state-attention' : 'border-accent',
      )}
      onBlur={() => onHover(null)}
      onClick={() => onSelect(row.id)}
      onMouseEnter={() => onHover(row.id)}
      onMouseLeave={() => onHover(null)}
      onFocus={() => onHover(row.id)}
      style={{
        ...rowRectStyle(row),
        backgroundImage: row.isLowConfidence
          ? 'repeating-linear-gradient(45deg, var(--state-attention) 0 1px, transparent 1px 6px)'
          : undefined,
      }}
      title={row.pixelLengthLabel}
      type="button"
    >
      {/* Nét khung chỉ dày 3 px: vùng bấm trong suốt ≥ 24 px quanh nét (WCAG 2.5.8). */}
      <span aria-hidden="true" className="absolute -inset-3" />
      <span
        className={cn(
          // Nền đặc sau chữ: chữ nằm trên nét bản vẽ, không nền thì vàng chỉ còn 2,6:1 (impeccable 1024).
          'pointer-events-none whitespace-nowrap rounded-sm bg-bg-surface px-1 font-mono text-[12px]',
          row.isLowConfidence ? 'text-state-attention-text' : 'text-accent',
        )}
      >
        {row.valueLabel}
      </span>
    </button>
  );
}

const HANDLE_ARIA_LABEL: Readonly<Record<ReferenceLineEndpoint, string>> = {
  start: 'Đầu đoạn tham chiếu, dùng phím mũi tên để nhích',
  end: 'Cuối đoạn tham chiếu, dùng phím mũi tên để nhích',
};
const ARROW_DIRECTIONS: Readonly<Record<string, NudgeDirection>> = {
  ArrowUp: 'up',
  ArrowDown: 'down',
  ArrowLeft: 'left',
  ArrowRight: 'right',
};

interface ReferenceHandleProps {
  readonly endpoint: ReferenceLineEndpoint;
  readonly point: ImageRatioPoint;
  readonly zoom: number;
  /** Nhấn tay cầm — kèm toạ độ con trỏ, để đầu đoạn đi theo quãng con trỏ đi chứ không nhảy tới nó (G51b). */
  readonly onGrab: (endpoint: ReferenceLineEndpoint, clientX: number, clientY: number) => void;
  readonly onNudge: CanvasActions['onNudgeEndpoint'];
}

/**
 * Tay cầm một đầu đoạn. Vùng bấm 24 px (WCAG 2.5.8), chấm thấy được vẫn 10 px. Nhấn = kéo ĐÚNG đầu
 * này; mũi tên khi đang focus = nhích ĐÚNG đầu này (BUG-587). `preventDefault` báo cho
 * `shortcutRegistry` là phím đã có chủ, nên phím nhích chung của canvas không chạy lần hai.
 */
export function ReferenceHandle({ endpoint, onGrab, onNudge, point, zoom }: ReferenceHandleProps) {
  return (
    <button
      aria-label={HANDLE_ARIA_LABEL[endpoint]}
      className="absolute flex h-6 w-6 items-center justify-center rounded-full"
      onKeyDown={(event) => {
        const direction = ARROW_DIRECTIONS[event.key];

        if (direction !== undefined) {
          event.preventDefault();
          onNudge(endpoint, direction, event.shiftKey ? 'coarse' : 'fine');
        }
      }}
      onPointerDown={(event) => {
        if (event.button !== 0) {
          return;
        }

        event.stopPropagation();
        event.currentTarget.setPointerCapture(event.pointerId);
        onGrab(endpoint, event.clientX, event.clientY);
      }}
      style={{
        left: `${point.x * 100}%`,
        top: `${point.y * 100}%`,
        transform: `translate(-50%, -50%) scale(${1 / zoom})`,
      }}
      type="button"
    >
      <span aria-hidden="true" className="h-2.5 w-2.5 rounded-full border-2 border-accent bg-white" />
    </button>
  );
}

/** Nhấn lên cụm thu phóng hay bản đồ nhỏ không được nổi lên canvas mà vẽ đoạn mới (BUG-596). */
function stopAtOverlay(event: SyntheticEvent): void {
  event.stopPropagation();
}

interface CanvasNavigationProps {
  readonly zoomPercent: number;
  /** Ảnh bản vẽ cho bản đồ nhỏ; `null` thì bản đồ chỉ có khung nhìn. */
  readonly imageUrl: string | null;
  readonly miniMapViewport: ScaleCanvasViewModel['miniMapViewport'];
  readonly onZoomIn: CanvasActions['onZoomIn'];
  readonly onZoomOut: CanvasActions['onZoomOut'];
  readonly onFitView: CanvasActions['onFitView'];
  readonly onMiniMapViewportChange: CanvasActions['onMiniMapViewportChange'];
}

/** Cụm thu phóng và bản đồ nhỏ, nối vào khung nhìn của màn — trước đây là hai điều khiển chết (BUG-596). */
export function CanvasNavigation({
  imageUrl,
  miniMapViewport,
  onFitView,
  onMiniMapViewportChange,
  onZoomIn,
  onZoomOut,
  zoomPercent,
}: CanvasNavigationProps) {
  return (
    <div className="contents" onPointerDown={stopAtOverlay} onPointerUp={stopAtOverlay}>
      {/* Ở màn này 100% CHÍNH LÀ vừa khung (ảnh vuông trong khung vuông), nên hai nút cùng một việc. */}
      <QcZoomMenu
        fitShortcut="F"
        onFitToScreen={onFitView}
        onResetZoom={onFitView}
        onZoomIn={onZoomIn}
        onZoomOut={onZoomOut}
        zoomLevel={zoomPercent}
      />
      {/* Ở 100% bản đồ nhỏ tự ẩn (vùng nhìn phủ cả ảnh); phóng to thì hiện kèm ảnh thu nhỏ thật. */}
      <MiniMap onViewportChange={onMiniMapViewportChange} viewport={miniMapViewport}>
        {imageUrl === null ? null : (
          /*
           * Khung ảnh vuông kéo giãn đúng vào ô 160×120 (`none`), ảnh bên trong vẫn `contain` như
           * trên canvas — nên phần trăm vùng nhìn khớp đúng chỗ trên ảnh.
           */
          <svg className="h-full w-full" preserveAspectRatio="none" viewBox="0 0 1 1">
            <image height="1" href={imageUrl} preserveAspectRatio="xMidYMid meet" width="1" />
          </svg>
        )}
      </MiniMap>
    </div>
  );
}
