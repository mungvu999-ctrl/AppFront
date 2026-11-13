/**
 * Panel phải "Kiểm tra con số" của màn Đặt tỷ lệ (S-11, demo Z/S-11).
 *
 * View thuần (R-60): số tỷ lệ to (mm/px, ≈ 1:N theo DPI, phép tính), kiểm chéo
 * bằng kích thước đã biết, bảng đối chiếu mm/px theo DPI
 * (`ScaleCalibrationCheckNumbers`), ba dòng kiểm chứng, cảnh báo, rồi chân panel
 * với nút Áp dụng. Phương pháp đo nằm ở panel trái (`ScaleCalibrationSidebar`).
 * Cảnh báo không chặn, không hộp thoại nào được dựng ở đây.
 */

import { clsx } from 'clsx';
import { PanelRightOpen } from 'lucide-react';

import { InlineAlert, type InlineAlertLevel } from '@/components/feedback/InlineAlert';
import { Skeleton } from '@/components/feedback/Skeleton';
import { Button } from '@/components/ui/Button';
import { FieldRow } from '@/components/ui/FieldRow';
import { IconButton } from '@/components/ui/IconButton';
import { SegmentedControl } from '@/components/ui/SegmentedControl';
import { MISSING_VALUE } from '@/lib/format/number';

import { ScaleCalibrationCheckNumbers } from './ScaleCalibrationCheckNumbers';
import type { ScaleCalibrationPanelProps } from './types';
import type { ViewStatusCode } from '@/lib/viewmodel/types';

const PANEL_ARIA_LABEL = 'Bảng hiệu chỉnh tỷ lệ';
const TITLE = 'Kiểm tra con số';
const COLLAPSE_LABEL = 'Thu gọn bảng';
const EXPAND_LABEL = 'Bung bảng';
const SUCCESS_BADGE = 'Đã duyệt';

const CROSS_CHECKS_TITLE = 'Kiểm chứng';
const CROSS_CHECKS_ARIA_LABEL = 'Ba đại lượng dẫn xuất để kiểm chứng tỷ lệ';
const WARNING_ARIA_LABEL = 'Cảnh báo về tỷ lệ';
// UX-R2 K05: một nút chính, nói đúng việc người dùng làm — xác nhận tỷ lệ.
const APPLY_PRIMARY = 'Xác nhận tỷ lệ';
const APPLY_APPLYING = 'Đang lưu tỷ lệ…';
const OPEN_VIEWER_LABEL = 'Xem mô hình 3D →';
const SCOPE_ARIA_LABEL = 'Phạm vi áp tỷ lệ';
const SCOPE_LABEL = 'Áp dụng cho:';

const PANEL_CONTAINER_CLASSES = clsx(
  'flex w-full flex-col bg-bg-surface md:min-h-0 md:flex-1',
  // S-11: from 1280 the panel is its own 288 px column right of the canvas; below that it shares one
  // 312 px column with the left sidebar (ScaleCalibration.tsx). Either way the body scrolls and the
  // footer (scope + "Áp dụng tỷ lệ") stays pinned to the column bottom.
  'xl:order-3 xl:w-[288px] xl:flex-none xl:shrink-0 xl:border-l xl:border-border-default',
);

/** Thu gọn thì cột co về 48 px chỉ còn nút "Bung bảng" — canvas `flex-1` rộng ra (BUG-609, như SCR-16). */
const COLLAPSED_CONTAINER_CLASSES = clsx(
  'flex w-full justify-end border-t border-border-default bg-bg-surface p-2',
  'md:w-12 md:shrink-0 md:flex-col md:items-center md:justify-start md:border-t-0 xl:order-3 xl:border-l',
);

/** Cùng bảng ánh xạ mà `ScaleCalibrationMethodReference` dùng — cảnh báo ở màn này luôn `'attention'`. */
function toAlertLevel(statusCode: ViewStatusCode): InlineAlertLevel {
  return statusCode === 'neutral' ? 'attention' : statusCode;
}

export function ScaleCalibrationPanel({
  actions,
  applyButtonRef,
  isCollapsed,
  panel,
  state,
}: ScaleCalibrationPanelProps) {
  const isLoading = state === 'loading';

  if (isCollapsed) {
    return (
      <section aria-label={PANEL_ARIA_LABEL} className={COLLAPSED_CONTAINER_CLASSES}>
        <IconButton
          aria-label={EXPAND_LABEL}
          icon={<PanelRightOpen size={16} />}
          onClick={actions.onToggleCollapsed}
        />
      </section>
    );
  }

  return (
    <section aria-label={PANEL_ARIA_LABEL} className={PANEL_CONTAINER_CLASSES}>
      <header className="flex items-center justify-between gap-3 border-b border-border-default px-4 py-3">
        <div className="flex min-w-0 items-center gap-2">
          <h2 className="truncate text-[16px] font-semibold text-text-primary">{TITLE}</h2>
          {panel.statusCode === 'verified' && (
            <span className="shrink-0 rounded-full bg-state-verified-tint px-2 py-0.5 text-[12px] font-medium text-state-verified-text">
              {SUCCESS_BADGE}
            </span>
          )}
        </div>
        <Button onClick={actions.onToggleCollapsed} size="sm" variant="ghost">
          {COLLAPSE_LABEL}
        </Button>
      </header>

      <div className="flex flex-col gap-4 px-4 py-4 md:min-h-0 md:flex-1 md:overflow-y-auto">
        {isLoading ? (
          <Skeleton preset="property-panel" />
        ) : (
          <ScaleCalibrationCheckNumbers
            check={panel.scaleCheck}
            computation={panel.computation}
            currentScaleLabel={panel.currentScaleLabel}
            derivedLine={panel.derivedLine}
          />
        )}

        {!isLoading && (
          <>
            {!panel.crossChecks.every((row) => row.valueLabel === MISSING_VALUE) && (
            <section aria-label={CROSS_CHECKS_ARIA_LABEL} className="flex flex-col">
              <h3 className="mb-1 text-[13px] font-medium text-text-secondary">
                {CROSS_CHECKS_TITLE}
              </h3>
              {panel.crossChecks.map((row, index) => (
                <FieldRow
                  isLast={index === panel.crossChecks.length - 1}
                  isText
                  key={row.id}
                  label={row.label}
                >
                  <div className="flex flex-col gap-0.5">
                    <span
                      className={clsx(
                        'font-mono text-[13px]',
                        row.statusCode === 'attention'
                          ? 'text-state-attention-text'
                          : 'text-text-primary',
                      )}
                    >
                      {row.valueLabel}
                    </span>
                    <span className="text-[12px] text-text-muted">{row.expectedRangeLabel}</span>
                    {row.warning !== undefined && (
                      <span className="text-[12px] text-state-attention-text" role="status">
                        {row.warning}
                      </span>
                    )}
                  </div>
                </FieldRow>
              ))}
            </section>

            )}

            {panel.warnings.length > 0 && (
              <section aria-label={WARNING_ARIA_LABEL} className="flex flex-col gap-2">
                {panel.warnings.map((notice, index) => (
                  <InlineAlert
                    key={`${notice.warning.kind}-${String(index)}`}
                    level={toAlertLevel(notice.statusCode)}
                    message={notice.message}
                  />
                ))}
              </section>
            )}
          </>
        )}
      </div>
      {!panel.areActionsHidden && (
        <div className="flex shrink-0 flex-col gap-2 border-t border-border-default bg-bg-surface px-4 py-3">
          {/* BUG-410: short labels ("Mọi tầng" / "Tầng này") keep both options on one line in the 288 px column. */}
          {/* Dự án căn hộ riêng chỉ còn "Tầng này": một lựa chọn thì không cần nút chọn. */}
          {panel.applyScopeOptions.length > 1 && (
            <>
              <p className="text-[13px] text-text-secondary">{SCOPE_LABEL}</p>
              <SegmentedControl
                aria-label={SCOPE_ARIA_LABEL}
                onChange={actions.onChangeApplyScope}
                options={panel.applyScopeOptions.map((option) => ({
                  label: option.label,
                  value: option.value,
                }))}
                value={panel.applyScope}
              />
            </>
          )}
          {/* R9: số máy chỉ ước / chưa xác định — đo trước, áp sau. */}
          {panel.measureFirst !== undefined && (
            <Button fullWidth onClick={actions.onPlaceSegment} variant="primary">
              {panel.measureFirst.label}
            </Button>
          )}
          <Button
            disabled={!panel.canApply}
            fullWidth
            loading={panel.isApplying}
            onClick={actions.onApply}
            ref={applyButtonRef}
            variant={panel.measureFirst === undefined ? 'primary' : 'secondary'}
          >
            {panel.isApplying ? APPLY_APPLYING : (panel.applyLabel ?? APPLY_PRIMARY)}
          </Button>
          {panel.measureFirst?.acceptLabel !== undefined && actions.onRequestAcceptMachine !== undefined && (
            <Button onClick={actions.onRequestAcceptMachine} size="sm" variant="ghost">
              {panel.measureFirst.acceptLabel}
            </Button>
          )}
          {panel.applyMissingHint !== undefined && (
            <p className="text-[12px] text-text-secondary">{panel.applyMissingHint}</p>
          )}
          {panel.applyBlockedNotice !== undefined && (
            <InlineAlert level="attention" message={panel.applyBlockedNotice} />
          )}
          {/* Áp xong thì bước kế là xem mô hình 3D của cả dự án. */}
          {panel.canOpenViewer3d && (
            <Button onClick={actions.onGoToViewer3d} size="sm" variant="primary">
              {OPEN_VIEWER_LABEL}
            </Button>
          )}
          <p className="text-[12px] text-text-muted">{panel.recalculationCaption}</p>
        </div>
      )}
    </section>
  );
}
