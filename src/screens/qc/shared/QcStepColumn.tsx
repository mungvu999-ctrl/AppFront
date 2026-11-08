import { Info, RotateCcw } from 'lucide-react';
import { useMemo, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { useNavigate } from 'react-router-dom';

import { CommandPalette } from '@/components/overlay/CommandPalette';
import type { CommandItem } from '@/hooks/useCommandPalette';
import { useScreenCommands } from '@/hooks/useScreenCommands';

import { cn } from '@/lib/utils';
import { SCALE_STATE_VIEWS } from '@/lib/viewmodel/provisionalScale';

import { floorReviewCountsOf, floorReviewGateOf, type FloorReviewLayerState, type RequiredLayerKey } from './floorReviewGateModel';
import { QcFloorDoneGate, QcFloorDoneSummary } from './QcFloorDone';
import { floorDoneTexts, reopenFloor, useFloorDone, useFloorLabel } from './floorDoneModel';
import { QC_COMMAND_GROUP } from './qcLayout';
import { QC_LAYERS } from './qcLayers';
import { QcStepPager } from './QcStepPager';
import { useFloorReview } from './useFloorReview';

/**
 * Cột việc 360 px của bố cục L23, kiểu bảng lớp của Figma — gọn, một vùng cuộn:
 *   1. đầu cột: H1 ngắn ("Duyệt tường") + chip "30 cần xem", không cắt chữ; câu việc mở bằng nút (i).
 *      Tiến độ các bước khác ở thanh bước `QcFloorNav`, không lặp ở đây;
 *   2. thân bước (`children`) lấp phần còn lại — màn tự đặt vùng cuộn duy nhất của nó;
 *   3. đáy cột: cổng (`gate`, nút mở mục kế tiếp của bước) rồi cặp nút đổi bước `QcStepPager`, cùng một chỗ ở mọi bước.
 * Đầu cột + thân nằm trong `<section aria-label={bước} aria-current="step">` (qa tìm chip qua đó).
 * Bước Phòng của tầng đã xong (`useFloorDone`) đổi thành màn Xong tầng: tổng kết thay hàng đợi, cổng
 * là "Dựng mô hình 3D"; nút nhỏ ở đầu cột mở lại hàng đợi.
 */
export type QcStepKey = 'scale' | RequiredLayerKey;

export interface QcStepColumnProps {
  readonly projectId: string;
  readonly floorId: string;
  readonly activeStep: QcStepKey;
  /** Câu việc của bước ("Duyệt từng đoạn tường. Đúng thì giữ, nét thừa thì xoá."): dòng mờ dưới H1. */
  readonly task: string;
  /** H1 ngắn, động từ + đối tượng. Vắng = tên mặc định của bước ("Duyệt tường"). */
  readonly title?: string | undefined;
  readonly hint?: string | undefined;
  /** Chip ở đầu cột; vắng thì dùng số của tầng ("7 cần xem", "30 đoạn · đã duyệt"). */
  readonly activeSummary?: ReactNode;
  /** Thân bước đang làm: bộ lọc + hàng đợi của màn. */
  readonly children: ReactNode;
  /** Cổng ở đáy cột (nút đi tiếp của tầng). */
  readonly gate?: ReactNode;
  /** Đầu tệp trên cùng cột, trên H1 (như "Tên tệp ▾ / Drafts" của Figma): thường là `QcFileHeader`. */
  readonly fileHeader?: ReactNode;
}

export interface QcFileHeaderProps {
  /** Tên dự án / tầng, cắt gọn một dòng. */
  readonly title: ReactNode;
  /** Dòng mờ dưới tên (tên tầng, trạng thái lưu…). */
  readonly subtitle?: ReactNode;
  /** Trigger menu (▾) ở cuối dòng tên. */
  readonly menu?: ReactNode;
}

/** Khối đầu tệp ≈ 56 px, kẻ mảnh dưới: chỗ cho nội dung header app khi bố cục bỏ header (chỉ khung, chưa chuyển nội dung). */
export function QcFileHeader({ title, subtitle, menu }: QcFileHeaderProps) {
  return (
    <div className="flex min-h-14 shrink-0 items-center gap-2 border-b border-border-default px-4 py-2.5">
      <div className="min-w-0 flex-1">
        <div className="truncate text-body font-semibold text-text-primary">{title}</div>
        {subtitle == null ? null : <div className="truncate text-caption text-text-muted">{subtitle}</div>}
      </div>
      {menu == null ? null : <div className="flex shrink-0 items-center">{menu}</div>}
    </div>
  );
}

const STEP_KEYS: readonly QcStepKey[] = ['scale', 'walls', 'objects', 'rooms'];
const UNIT: Readonly<Record<RequiredLayerKey, string>> = { walls: 'đoạn', objects: 'mục', rooms: 'phòng' };
const STEP_H1: Readonly<Record<QcStepKey, string>> = {
  scale: 'Kiểm tỷ lệ',
  walls: 'Duyệt tường',
  objects: 'Duyệt cửa và nội thất',
  rooms: 'Đặt tên phòng',
};
const REOPEN_LABEL = 'Mở lại bước Phòng';
/** Bảng lệnh của khung L23 chỉ mang lệnh màn đăng ký (`useScreenCommands`), không mang lệnh mẫu của `CommandPalette`. */
const NO_SHARED_COMMANDS: CommandItem[] = [];

const stepTitle = (key: QcStepKey): string => QC_LAYERS.find((item) => item.key === key)?.label ?? key;
const stepRoute = (key: QcStepKey) => (QC_LAYERS.find((item) => item.key === key) ?? QC_LAYERS[0]!).route;

/** Chữ chip của bước lớp: số còn phải xem, xong thì tổng số. */
function summaryOf(layer: FloorReviewLayerState | undefined): string {
  /* Chưa có mục nào (tầng chưa dò ra phòng): không chip "0 cần xem". */
  if (layer === undefined || layer.total === 0) return '';
  if (layer.done) return `${layer.total} ${UNIT[layer.key]} · đã duyệt`;
  return `${layer.total - layer.reviewed} cần xem`;
}

/** Chip của bước đang làm: vàng khi còn việc, xanh khi xong. */
function ActiveChip({ done, text }: { readonly done: boolean; readonly text: string }) {
  if (text === '') return null;
  return (
    <span
      className={cn(
        'shrink-0 rounded-md px-2 py-0.5 text-body-sm font-medium tabular-nums',
        done ? 'bg-state-verified-tint text-state-verified-text' : 'bg-state-attention-tint text-state-attention-text',
      )}
    >
      {text}
    </span>
  );
}

interface ColumnHeadProps {
  readonly title: string;
  readonly line: string | undefined;
  readonly side: ReactNode;
}

const LINE_TOGGLE_LABEL = 'Bước này làm gì';

/** Đầu cột: H1 + chip không bao giờ cắt chữ (hẹp thì chip xuống dòng); câu việc mở bằng nút (i), đọc được bằng trình đọc màn hình. */
function ColumnHead({ title, line, side }: ColumnHeadProps) {
  const [open, setOpen] = useState(false);
  const hasLine = line !== undefined && line !== '';
  return (
    <header className="shrink-0 border-b border-border-default px-3 py-2">
      <div className="flex items-start gap-1">
        <div className="flex min-h-7 min-w-0 flex-1 flex-wrap items-center gap-x-2 gap-y-1">
          <h1 className="min-w-0 text-[15px] font-medium leading-tight text-text-primary">{title}</h1>
          {side}
        </div>
        {hasLine ? (
          <button
            aria-expanded={open}
            aria-label={LINE_TOGGLE_LABEL}
            className={cn(
              'flex h-7 w-7 shrink-0 items-center justify-center rounded-md hover:bg-bg-hover hover:text-text-primary focus-visible:outline-solid focus-visible:outline-2 focus-visible:outline-accent',
              open ? 'text-accent' : 'text-text-muted',
            )}
            onClick={() => setOpen(!open)}
            title={line}
            type="button"
          >
            <Info aria-hidden="true" className="h-4 w-4" />
          </button>
        ) : null}
      </div>
      {hasLine ? <p className={open ? 'mt-1 text-caption text-text-secondary' : 'sr-only'}>{line}</p> : null}
    </header>
  );
}

/* Không bóng: hai panel neo là khối phẳng cạnh bản vẽ (bố cục hai panel). */
const COLUMN_CLASS = 'flex h-full min-h-0 w-full flex-col overflow-hidden bg-bg-surface max-lg:rounded-xl';
const FOOTER_CLASS = 'flex shrink-0 flex-col gap-2 border-t border-border-default px-3 py-2.5';
/* Dưới 1024 cột việc là ngăn kéo đóng: cặp nút nổi giữa trên bản vẽ để luôn thấy (cột mở thì ngăn kéo phủ lên nó). */
const PAGER_FLOAT_CLASS = 'fixed left-1/2 top-3 z-20 -translate-x-1/2 lg:hidden';

export function QcStepColumn({ projectId, floorId, activeStep, task, title, hint, activeSummary, children, gate, fileHeader }: QcStepColumnProps) {
  const { graph, scale } = useFloorReview(projectId, floorId);
  const layer = useMemo(
    () =>
      activeStep === 'scale' || graph === null
        ? undefined
        : floorReviewGateOf(floorReviewCountsOf(graph, floorId)).layers.find((item) => item.key === activeStep),
    [activeStep, floorId, graph],
  );
  const { done: floorDone, graph: doneGraph } = useFloorDone(projectId, floorId);
  const isDoneScreen = activeStep === 'rooms' && floorDone && doneGraph !== null;
  const floorLabel = useFloorLabel(projectId, floorId);
  const navigate = useNavigate();
  const commands = useMemo<CommandItem[]>(
    () =>
      STEP_KEYS.filter((key) => key !== activeStep && (key === 'scale' || scale !== 'missing')).map((key) => ({
        id: `qc-step-${key}`,
        group: QC_COMMAND_GROUP,
        label: `Đi tới bước ${stepTitle(key)}`,
        keywords: ['bước', 'duyệt tầng'],
        onSelect: () => navigate(stepRoute(key)(projectId, floorId)),
      })),
    [activeStep, floorId, navigate, projectId, scale],
  );
  useScreenCommands(commands);

  const done = activeStep === 'scale' ? scale === 'confirmed' : layer?.done === true;
  const remaining =
    activeStep === 'scale'
      ? done || scale === null ? null : `${SCALE_STATE_VIEWS[scale].name}.`
      : layer === undefined || layer.done || layer.total === layer.reviewed ? null : `Còn ${layer.total - layer.reviewed} ${UNIT[layer.key]} chưa duyệt.`;
  const pagerProps = { activeStep, floorId, projectId, remaining, stepDone: done, quiet: isDoneScreen };
  const floatingPager = createPortal(
    <div className={PAGER_FLOAT_CLASS}>
      <QcStepPager {...pagerProps} compact />
    </div>,
    document.body,
  );

  if (isDoneScreen) {
    const doneHead = floorDoneTexts(floorLabel);
    return (
      <div className={COLUMN_CLASS}>
        {fileHeader}
        <ColumnHead
          line={doneHead.hint}
          side={
            <button
              className="flex h-8 shrink-0 items-center gap-1.5 rounded-md px-2 text-body-sm text-text-secondary transition-colors duration-120 hover:bg-bg-hover hover:text-text-primary focus-visible:outline-solid focus-visible:outline-2 focus-visible:outline-accent"
              onClick={() => reopenFloor(floorId)}
              type="button"
            >
              <RotateCcw aria-hidden="true" className="h-3.5 w-3.5" />
              {REOPEN_LABEL}
            </button>
          }
          title={doneHead.task}
        />
        <div className="flex min-h-0 flex-1 flex-col overflow-y-auto">
          <QcFloorDoneSummary floorId={floorId} graph={doneGraph} />
        </div>
        <CommandPalette commands={NO_SHARED_COMMANDS} />
        <footer className={FOOTER_CLASS}>
          <QcFloorDoneGate projectId={projectId} />
          <QcStepPager {...pagerProps} />
        </footer>
        {floatingPager}
      </div>
    );
  }

  const chipText = activeStep === 'scale' ? (scale === null ? '' : SCALE_STATE_VIEWS[scale].name) : summaryOf(layer);

  return (
    <div className={COLUMN_CLASS}>
      {fileHeader}
      <section aria-current="step" aria-label={stepTitle(activeStep)} className="flex min-h-0 flex-1 flex-col">
        <ColumnHead
          line={hint === undefined ? task : `${task} ${hint}`}
          side={activeSummary ?? <ActiveChip done={done} text={chipText} />}
          title={title ?? STEP_H1[activeStep]}
        />
        {/* Thân lấp phần còn lại; màn chưa tự cuộn (Phòng, Tỷ lệ) thì cuộn ở đây, danh sách tường tự cuộn bên trong. */}
        <div className="flex min-h-0 flex-1 flex-col overflow-y-auto">{children}</div>
      </section>
      <CommandPalette commands={NO_SHARED_COMMANDS} />
      <footer className={FOOTER_CLASS}>
        {gate == null ? null : <div className="flex flex-col gap-2 empty:hidden [&_a]:w-full [&_a]:justify-between [&_button]:w-full [&_button]:justify-between">{gate}</div>}
        <QcStepPager {...pagerProps} />
      </footer>
      {floatingPager}
    </div>
  );
}
