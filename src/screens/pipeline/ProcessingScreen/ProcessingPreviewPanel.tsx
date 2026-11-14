/**
 * Panel xem trước của màn Xử lý — cột phải, tab "Xem trước" (V6).
 *
 * View thuần của mục D: mọi thứ vào bằng {@link ProcessingPreviewPanelProps},
 * không `src/api`, không `src/store`, không `src/domain`, không `src/lib/http`
 * (R-60).
 *
 * ## Vì sao khung có tỉ lệ cố định
 *
 * `sourceImageUrl` có thể chưa về (đang tải), nên khung phải giữ đúng một kích
 * thước bất kể có ảnh hay chưa — nếu không, ảnh về sẽ làm bố cục nhảy. `aspect-4/3`
 * cố định tỉ lệ khung; ảnh vào sau chỉ lấp đầy bằng `object-contain`, không đổi
 * kích thước khung.
 *
 * ## Vì sao đường quét là một dải hẹp bọc một nét 1px
 *
 * `animate-pipeline-sweep` (khai ở `tailwind.config.ts`) di chuyển bằng
 * `translateX` theo phần trăm CHIỀU RỘNG CỦA CHÍNH PHẦN TỬ — một phần tử rộng
 * đúng 1px gần như không nhích khỏi chỗ cũ. Phần tử ngoài rộng 1/3 khung mới đủ
 * để đường quét đi hết chiều ngang; nét 1px nhìn thấy được nằm ở mép phải của nó
 * — đúng khuôn `PipelineStepper.tsx` đã dùng, chỉ đổi cạnh hiện thành 1px thay vì
 * cả dải mờ (mục [CẤM TUYỆT ĐỐI]: không glow, không gradient).
 *
 * ## Vì sao hoà tan dùng state cục bộ thay vì animation có sẵn
 *
 * Không class chuyển động nào khai ở `tailwind.config.ts` là một cú hoà tan
 * thuần opacity ở nhịp `standard` — `toast-enter`/`panel-rise` đều kèm dịch
 * chuyển vị trí, không hợp cho một tấm ảnh đổi tầng. `key` theo `activeFloorId`
 * buộc ảnh cũ gỡ hẳn khỏi DOM (không còn hiện tượng ảnh cũ đọng lại chờ ảnh mới
 * giải mã); `isRevealed` bật lại sau một khung hình để CSS transition có một
 * lần đổi giá trị opacity mà chạy — style hoà tan dùng đúng `cssDurationMs('standard', …)`
 * như D-B đã chốt.
 */

import { useEffect, useState } from 'react';
import { ImageOff } from 'lucide-react';

import { EmptyState } from '@/components/feedback/EmptyState';
import { cssDurationMs, staggerSchedule } from '@/lib/motion';

import { ScanCursorOverlay } from './ScanCursorOverlay';
import type { ProcessingPreviewPanelProps } from './types';

/* -------------------------------------------------------------------------- */
/* Chuỗi người đọc. Tiếng Việt có dấu, viết thường kiểu câu (A6).              */
/* -------------------------------------------------------------------------- */

const PANEL_LABEL = 'Xem trước bản vẽ đang xử lý';
const NO_FLOOR_TITLE = 'Chưa có tầng nào để xem trước';
const NO_FLOOR_DESCRIPTION = 'Panel sẽ hiện bản vẽ ngay khi có tầng bắt đầu xử lý.';
const WAITING_IMAGE_LABEL = 'Đang chờ ảnh xem trước…';

/** Toạ độ các path hình học coi là tỉ lệ 0..100 của khung ảnh — cùng hệ toạ độ InputQualityGate đã dùng cho lớp phủ hình học. */
const GEOMETRY_VIEWBOX = '0 0 100 100';

const FRAME_CLASSES =
  'relative flex aspect-4/3 w-full items-center justify-center overflow-hidden rounded-2xl border border-border-default bg-bg-sunken';

/* -------------------------------------------------------------------------- */
/* Panel.                                                                      */
/* -------------------------------------------------------------------------- */

export function ProcessingPreviewPanel({ prefersReducedMotion, preview }: ProcessingPreviewPanelProps) {
  const { activeFloorId, altText, detectedGeometryPaths, isScanning, scanResults, scanRunId, sourceImageUrl } = preview;
  const [pageSize, setPageSize] = useState<{ readonly height: number; readonly width: number } | null>(null);

  /** Bật lại một khung hình sau khi tầng đổi, để CSS transition có việc mà chạy. */
  const [isRevealed, setIsRevealed] = useState(false);

  useEffect(() => {
    setIsRevealed(false);
    const frame = requestAnimationFrame(() => setIsRevealed(true));
    return () => cancelAnimationFrame(frame);
  }, [activeFloorId]);

  if (activeFloorId === null) {
    return (
      <div aria-label={PANEL_LABEL} role="region" className={FRAME_CLASSES}>
        <EmptyState description={NO_FLOOR_DESCRIPTION} icon={<ImageOff aria-hidden="true" />} title={NO_FLOOR_TITLE} />
      </div>
    );
  }

  const crossfadeDuration = cssDurationMs('standard', { reducedMotion: prefersReducedMotion });
  const geometrySchedule = staggerSchedule(detectedGeometryPaths.length, {
    reducedMotion: prefersReducedMotion,
  });
  const showAnimatedSweep = isScanning && !prefersReducedMotion;
  const showStaticSweep = isScanning && prefersReducedMotion;

  return (
    <div aria-label={PANEL_LABEL} role="region" className={FRAME_CLASSES}>
      {sourceImageUrl === undefined ? (
        <span className="px-4 text-center text-[13px] text-text-muted">{WAITING_IMAGE_LABEL}</span>
      ) : (
        <div className="relative h-full w-full" key={activeFloorId}>
          <img
            alt={altText}
            className="h-full w-full object-contain transition-opacity ease-enter"
            onLoad={(event) =>
              setPageSize({ height: event.currentTarget.naturalHeight, width: event.currentTarget.naturalWidth })
            }
            src={sourceImageUrl}
            style={{ opacity: isRevealed ? 1 : 0, transitionDuration: crossfadeDuration }}
          />

          {scanResults === undefined || pageSize === null ? null : (
            <ScanCursorOverlay
              height={pageSize.height}
              key={scanRunId}
              prefersReducedMotion={prefersReducedMotion}
              results={scanResults}
              width={pageSize.width}
            />
          )}

          {detectedGeometryPaths.length === 0 ? null : (
            <svg
              aria-hidden="true"
              className="pointer-events-none absolute inset-0 h-full w-full"
              preserveAspectRatio="none"
              viewBox={GEOMETRY_VIEWBOX}
            >
              {detectedGeometryPaths.map((path, index) => {
                const step = geometrySchedule[index];

                return (
                  <path
                    className="fill-none stroke-wall-idle"
                    d={path}
                    key={path}
                    strokeWidth={1}
                    style={{
                      opacity: isRevealed ? 0.6 : 0,
                      transitionDelay: step === undefined ? undefined : `${step.delayMs}ms`,
                      transitionDuration: step === undefined ? undefined : `${step.durationMs}ms`,
                      transitionProperty: 'opacity',
                    }}
                    vectorEffect="non-scaling-stroke"
                  />
                );
              })}
            </svg>
          )}
        </div>
      )}

      {showAnimatedSweep ? (
        <div aria-hidden="true" className="pointer-events-none absolute inset-y-0 left-0 w-1/3 animate-pipeline-sweep">
          <div className="absolute inset-y-0 right-0 w-px bg-accent opacity-40" />
        </div>
      ) : null}
      {showStaticSweep ? (
        <div aria-hidden="true" className="pointer-events-none absolute inset-y-0 left-1/2 w-px bg-accent opacity-40" />
      ) : null}
    </div>
  );
}
