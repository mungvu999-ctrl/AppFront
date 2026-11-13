import { useMemo, type KeyboardEvent, type ReactNode } from 'react';
import { Check, ChevronDown, ChevronLeft, Lock } from 'lucide-react';
import { Link, useNavigate } from 'react-router-dom';

import { useEditorChrome } from '@/components/shell/EditorChromeContext';
import { useShortcut } from '@/hooks/useShortcut';

import { cn } from '@/lib/utils';
import { SCALE_STATE_VIEWS, type ScaleStateView } from '@/lib/viewmodel/provisionalScale';
import { ROUTES } from '@/routes/paths';

import {
  floorReviewCountsOf,
  floorReviewGateOf,
  SCALE_LOCK_REASON,
  type FloorReviewLayerState,
  type FloorScaleState,
} from './floorReviewGateModel';
import { useFloorLabel } from './floorDoneModel';
import { QC_LAYERS, qcLayerTitle, qcStepOf, type QcLayerKey } from './qcLayers';
import { useFloorReview } from './useFloorReview';

/**
 * Thanh bước của tầng (UX-R1 K25, UX-R2 K04), MỘT hàng 32 px dưới header:
 * "ch-03 ▾ | 1 ● Tỷ lệ cần kiểm · 2 ● Tường 0/30 · 3 ● Cửa và nội thất 0/39 · 4 ● Phòng 0/7".
 * Chấm bước Tỷ lệ theo `SCALE_STATE_VIEWS` (đỏ/vàng/xanh, cùng chữ với cổng và dải); bước khác
 * xanh khi xong. Không còn menu "Nâng cao": đứng ở bước Tỷ lệ thì cạnh thanh bước có link Kích thước
 * và So với bản vẽ (mục con của bước); Độ dày mở từ nút trong bước Tường; Trục mở từ màn Các tầng.
 * Nút đi tiếp của tầng nằm ở khe cổng của header (`FloorReviewGate`), không lặp ở đây.
 * Tầng chưa có tỷ lệ: các bước sau Tỷ lệ (và Độ dày tường) bị khoá, kèm lý do.
 * Phím `]` / `[` sang bước sau / về bước trước của tầng (U19), hiện trong bảng `?`.
 * Trong khung soạn thảo (`useEditorChrome()` khác null — 4 màn duyệt tầng không còn header, không còn hàng
 * trên cùng, kiểu Figma): bản đặt ở đầu màn chỉ giữ H1 ẩn + phím tắt; bản `stacked` (truyền vào
 * `QcStepColumn.fileHeader`) vẽ khối đầu cột:
 * MỘT hàng dự án ▾ (gồm đổi tầng, bước dự án, thông báo) + tên tầng, rồi dải ngang bốn bước (số, chấm, đếm, tên). Nút đi tiếp chỉ có ở đáy cột việc. Ngoài khung soạn thảo `stacked` không vẽ gì.
 * Gắn: `<QcFloorNav floorId={floorId} layer="rooms" projectId={projectId} />` (cần nằm trong Router).
 */
export interface QcFloorNavFloor {
  readonly id: string;
  readonly label: string;
  /** `false` = tầng chưa có bản vẽ nào: menu đổi tầng ghi rõ (U52). Vắng = chưa biết, không ghi. */
  readonly hasDrawing?: boolean | undefined;
}

export interface QcFloorNavProps {
  readonly projectId: string;
  readonly floorId: string;
  readonly layer: QcLayerKey;
  readonly floors?: readonly QcFloorNavFloor[] | undefined;
  /** Không còn vẽ (header đã có tên dự án); giữ để nơi gọi cũ không vỡ kiểu. */
  readonly projectName?: string | undefined;
  /** Dòng tiến độ cạnh tiêu đề, đã định dạng ("12/40 đã duyệt"). Vắng thì ẩn gọn. */
  readonly progress?: string | null | undefined;
  /** Màn đã có H1 thấy được (QcPanelHead): bỏ H1 ẩn ở đây để trang chỉ có một H1. */
  readonly titled?: boolean;
  /** Bố cục L23: bỏ dòng `progress` (chip ở đầu cột việc đã nói); số đã duyệt/tổng của từng bước vẫn hiện. */
  readonly minimal?: boolean;
  /** Khối đầu cột việc (chỉ vẽ trong khung soạn thảo); không đăng ký phím tắt — bản ở đầu màn đã đăng ký. */
  readonly stacked?: boolean;
}

const FLOOR_FALLBACK = 'Tầng';
const STEP_BAR_LABEL = 'Các bước duyệt tầng';
const ALL_FLOORS_LABEL = 'Tất cả tầng';
const NO_DRAWING_LABEL = 'chưa có bản vẽ';
const NEXT_STEP_SHORTCUT = 'Sang bước sau của tầng';
const PREVIOUS_STEP_SHORTCUT = 'Về bước trước của tầng';
const OPEN_VIEWER_SHORTCUT = 'Sang Mô hình 3D';
/** Mục phụ thuộc số đo: khoá khi máy không đo được tỷ lệ. */
const SCALE_LOCKED: ReadonlySet<QcLayerKey> = new Set<QcLayerKey>(['walls', 'objects', 'rooms', 'thickness']);
const DOT_CLASS: Readonly<Record<ScaleStateView['statusCode'] | 'neutral', string>> = {
  violation: 'bg-state-violation',
  attention: 'bg-state-attention',
  verified: 'bg-state-verified',
  neutral: 'bg-border-control',
};
const SCALE_TEXT_CLASS: Readonly<Record<FloorScaleState, string>> = {
  missing: 'text-state-violation-text',
  check: 'text-state-attention-text',
  undetermined: 'text-state-attention-text',
  estimated: 'text-state-attention-text',
  measured: '',
  confirmed: '',
};

/** Nơi gọi không truyền `floors` (Tỷ lệ, Cửa, Phòng): tên tầng lấy từ danh sách tầng của dự án, không để chữ "Tầng" trơ. */
function ProjectFloorLabel({ projectId, floorId }: { readonly projectId: string; readonly floorId: string }) {
  const label = useFloorLabel(projectId, floorId);
  return <>{label === '' ? FLOOR_FALLBACK : label}</>;
}

function StatusDot({ tone }: { readonly tone: keyof typeof DOT_CLASS }) {
  return <span aria-hidden="true" className={cn('h-2 w-2 shrink-0 rounded-full', DOT_CLASS[tone])} />;
}

const TAB_CLASS = cn(
  'flex shrink-0 items-center gap-1 whitespace-nowrap rounded-md px-2 py-0.5 text-[13px] transition-colors duration-120',
  'focus-visible:outline-solid focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent',
);
const CURRENT_CLASS = 'bg-accent-wash font-medium text-accent';
const IDLE_CLASS = 'text-text-secondary hover:bg-bg-hover hover:text-text-primary';
const MENU_ITEM_CLASS = 'flex w-full items-center gap-1 rounded-md px-3 py-1.5 text-left';
/** Một ô trong dải bốn bước ở đầu cột việc: dòng trên số + chấm + đếm, dòng dưới tên bước (xuống dòng, không cắt). */
const CELL_CLASS = cn(
  'relative flex min-w-0 flex-auto flex-col gap-0.5 rounded-md px-1.5 py-1 text-[12px] leading-tight transition-colors duration-120 [&>svg]:absolute [&>svg]:right-1 [&>svg]:top-1.5',
  'focus-visible:outline-solid focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent',
);

/** A12: Esc đóng menu đang mở và trả tiêu điểm về nút mở. */
function closeOnEscape(event: KeyboardEvent<HTMLDetailsElement>) {
  if (event.key !== 'Escape' || !event.currentTarget.open) return;
  event.currentTarget.open = false;
  event.currentTarget.querySelector('summary')?.focus();
}

interface NavMenuProps {
  readonly label: string;
  readonly summary: ReactNode;
  readonly children: ReactNode;
}

/* ponytail: <details> gốc như menu dự án ở AppHeader — không đóng khi bấm ra ngoài; cần thì đổi sang Popover. */
function NavMenu({ label, summary, children }: NavMenuProps) {
  return (
    <details className="relative shrink-0" onKeyDown={closeOnEscape}>
      <summary
        aria-label={label}
        className={cn(TAB_CLASS, 'cursor-pointer list-none [&::-webkit-details-marker]:hidden', IDLE_CLASS)}
      >
        {summary}
        <ChevronDown aria-hidden="true" className="h-3.5 w-3.5 text-text-muted" />
      </summary>
      <ul className="absolute left-0 top-full z-30 mt-1 min-w-[200px] rounded-md border border-border-default bg-bg-surface p-1 text-[13px] shadow-float">
        {children}
      </ul>
    </details>
  );
}

interface StepProps {
  /** `page` = màn đang mở; `step` = bước cha của màn phụ đang mở (Kích thước thuộc Tỷ lệ). */
  readonly current?: 'page' | 'step' | undefined;
  readonly locked: boolean;
  readonly to: string;
  readonly className: string;
  readonly children: ReactNode;
}

/** Một bước/mục: link, hoặc chữ khoá kèm lý do khi thiếu tỷ lệ. */
function Step({ current, locked, to, className, children }: StepProps) {
  if (locked) {
    return (
      <span
        aria-current={current}
        aria-disabled="true"
        className={cn(className, 'cursor-not-allowed text-text-muted', current !== undefined && 'bg-bg-sunken')}
        title={SCALE_LOCK_REASON}
      >
        <Lock aria-hidden="true" className="h-3 w-3" />
        {children}
        <span className="sr-only">{`: ${SCALE_LOCK_REASON}`}</span>
      </span>
    );
  }
  return (
    <Link aria-current={current} className={cn(className, current === undefined ? IDLE_CLASS : CURRENT_CLASS)} to={to}>
      {children}
    </Link>
  );
}

interface FloorMenuItemProps {
  readonly projectId: string;
  readonly floor: QcFloorNavFloor;
  readonly layer: QcLayerKey;
  readonly isCurrent: boolean;
}

/** Một tầng trong menu đổi tầng: tầng thiếu tỷ lệ mà bước đang mở bị khoá thì sang bước Tỷ lệ của nó. */
function FloorMenuItem({ projectId, floor, layer, isCurrent }: FloorMenuItemProps) {
  const { scale } = useFloorReview(projectId, floor.id);
  const target = scale === 'missing' && SCALE_LOCKED.has(layer) ? 'scale' : layer;
  const route = (QC_LAYERS.find((item) => item.key === target) ?? QC_LAYERS[0]!).route;
  return (
    <li>
      <Link
        aria-current={isCurrent ? 'page' : undefined}
        className={cn(MENU_ITEM_CLASS, 'justify-between', isCurrent ? 'text-accent' : 'text-text-primary hover:bg-bg-hover')}
        to={route(projectId, floor.id)}
      >
        <span className="flex min-w-0 items-baseline gap-2">
          {floor.label}
          {floor.hasDrawing === false ? ' ' : null}
          {floor.hasDrawing === false ? <span className="text-[12px] text-text-muted">{NO_DRAWING_LABEL}</span> : null}
        </span>
        {isCurrent && <Check aria-hidden="true" className="h-3.5 w-3.5" />}
      </Link>
    </li>
  );
}

export function QcFloorNav({ projectId, floorId, layer, floors = [], progress, titled = false, minimal = false, stacked = false }: QcFloorNavProps) {
  const current = QC_LAYERS.find((item) => item.key === layer) ?? QC_LAYERS[0]!;
  const floorLabel = floors.find((floor) => floor.id === floorId)?.label ?? FLOOR_FALLBACK;
  const screenTitle = qcLayerTitle(layer);
  const { graph, scale } = useFloorReview(projectId, floorId);
  const chrome = useEditorChrome();
  /* Tiến độ từng lớp bắt buộc; chưa đọc được tầng thì chỉ đánh số. */
  const layerStates = useMemo(
    () =>
      new Map<QcLayerKey, FloorReviewLayerState>(
        graph === null ? [] : floorReviewGateOf(floorReviewCountsOf(graph, floorId)).layers.map((item) => [item.key, item]),
      ),
    [floorId, graph],
  );
  const isLocked = (key: QcLayerKey) => scale === 'missing' && SCALE_LOCKED.has(key);
  const steps = QC_LAYERS.filter((item) => item.group === 'step');
  const activeStep = qcStepOf(layer);
  /* Mục con của bước đang sáng: Kích thước, So với bản vẽ ở bước Tỷ lệ; màn phụ khác chỉ hiện khi đang đứng ở đó. */
  const subLinks = QC_LAYERS.filter((item) => item.parent !== undefined && item.parent === activeStep && (item.listed === true || item.key === layer));
  const navigate = useNavigate();
  const stepIndex = steps.findIndex((item) => item.key === activeStep);
  /* U19: đổi bước bằng bàn phím; bước khoá (thiếu tỷ lệ) thì đứng yên. */
  const goStep = (delta: number) => {
    const target = steps[stepIndex + delta];
    if (target === undefined || isLocked(target.key)) return;
    void navigate(target.route(projectId, floorId));
  };
  useShortcut({ id: 'qcFloorNav.nextStep', combo: ']', scope: 'global', description: NEXT_STEP_SHORTCUT, onTrigger: () => goStep(1) }, { enabled: !stacked });
  useShortcut({ id: 'qcFloorNav.previousStep', combo: '[', scope: 'global', description: PREVIOUS_STEP_SHORTCUT, onTrigger: () => goStep(-1) }, { enabled: !stacked });
  /* UX-12: sang Mô hình 3D không phải lần Tab qua cả màn; có trong bảng `?`. */
  useShortcut({ id: 'qcFloorNav.openViewer', combo: 'Shift+M', scope: 'global', description: OPEN_VIEWER_SHORTCUT, onTrigger: () => void navigate(ROUTES.project.viewer(projectId)) }, { enabled: !stacked });
  const currentOf = (key: QcLayerKey): StepProps['current'] => {
    if (key === layer) return 'page';
    return key === activeStep ? 'step' : undefined;
  };

  const floorItems = (
    <>
      {floors.map((floor) => (
        <FloorMenuItem key={floor.id} floor={floor} isCurrent={floor.id === floorId} layer={current.key} projectId={projectId} />
      ))}
      <li className={cn(floors.length > 0 && 'mt-1 border-t border-border-default pt-1')}>
        <Link className={cn(MENU_ITEM_CLASS, IDLE_CLASS)} to={ROUTES.project.floors(projectId)}>
          {ALL_FLOORS_LABEL}
        </Link>
      </li>
    </>
  );
  const floorMenu = (
    /* key: đổi tầng/màn thì menu đóng lại. */
    <NavMenu
      key={`floor:${floorId}:${layer}`}
      label={`Đổi tầng: đang ở ${floorLabel}`}
      summary={<span className="font-medium text-text-primary">{floorLabel}</span>}
    >
      {floorItems}
    </NavMenu>
  );
  const stepNav = (
    <nav aria-label={STEP_BAR_LABEL} className={stacked ? 'flex flex-wrap items-stretch gap-1' : 'flex min-w-0 flex-1 items-center gap-1 border-l border-border-default pl-3'}>
      {/* Bốn bước luôn một hàng (hẹp thì tên bước xuống dòng trong ô); mục con của bước nằm hàng dưới. */}
      <div className={stacked ? 'flex w-full items-stretch gap-1' : 'contents'}>
      {steps.map((item, index) => {
        const state = layerStates.get(item.key);
        const isScale = item.key === 'scale';
        const isDone = isScale ? scale === 'confirmed' : state?.done === true;
        const scaleView = isScale && scale !== null ? SCALE_STATE_VIEWS[scale] : null;
        /* Tỷ lệ chưa xác nhận: bước mang đúng tên trạng thái ("Chưa có tỷ lệ", "Tỷ lệ cần kiểm"). */
        const label = scaleView !== null && scale !== 'confirmed' ? scaleView.name : item.label;
        const count = state !== undefined && !isDone ? `${state.reviewed}/${state.total}` : null;
        return (
          <Step
            key={item.key}
            className={stacked ? CELL_CLASS : TAB_CLASS}
            current={currentOf(item.key)}
            locked={isLocked(item.key)}
            to={item.route(projectId, floorId)}
          >
            <span className={stacked ? 'flex items-center gap-1 tabular-nums' : 'contents'}>
              <span aria-hidden="true" className="tabular-nums text-text-muted">{index + 1}</span>
              {isLocked(item.key) ? null : <StatusDot tone={scaleView?.statusCode ?? (isDone ? 'verified' : 'neutral')} />}
              {stacked && count !== null ? <span aria-hidden="true" className="ml-auto text-text-muted">{count}</span> : null}
            </span>
            {/* Ô hẹp: tên ngắn ("Tỷ lệ", "Phòng") không vỡ giữa chữ; chỉ tên dài ("Cửa và nội thất") xuống dòng. */}
            <span className={cn('min-w-0', stacked ? label.length <= 10 && 'whitespace-nowrap' : 'truncate', isScale && scale !== null && SCALE_TEXT_CLASS[scale])}>{label}</span>
            {isDone && <span className="sr-only">: đã xong</span>}
            {count !== null && (
              <>
                {stacked ? null : <span aria-hidden="true" className="tabular-nums text-text-muted">{count}</span>}
                <span className="sr-only">{`: đã duyệt ${state?.reviewed} trên ${state?.total}`}</span>
              </>
            )}
          </Step>
        );
      })}
      </div>
      {subLinks.length === 0 ? null : (
        <>
          {stacked ? <span aria-hidden="true" className="w-full" /> : <span aria-hidden="true" className="mx-2 h-5 w-px shrink-0 bg-border-control" />}
          {subLinks.map((item) => (
            <Step key={item.key} className={TAB_CLASS} current={currentOf(item.key)} locked={isLocked(item.key)} to={item.route(projectId, floorId)}>
              {item.label}
            </Step>
          ))}
        </>
      )}
    </nav>
  );
  const heading = titled ? null : <h1 className="sr-only">{`${screenTitle} · ${floorLabel}`}</h1>;

  if (stacked) {
    if (chrome === null) return null;
    /* Đầu cột việc kiểu Figma: MỘT hàng tên dự án ▾ (gồm đổi tầng, chuông, sáu bước dự án) + tên tầng; rồi dải bốn bước. */
    return (
      <div className="flex shrink-0 flex-col gap-1 border-b border-border-default px-2 py-1.5" data-testid="qc-panel-nav">
        <div className="flex min-w-0 items-center justify-between gap-2">
          {chrome.fileMenu(floorItems)}
          {/* #24: lối ra luôn nhìn thấy, không chỉ trong menu thả của dự án. */}
          <Link
            aria-label="Về danh sách dự án"
            className="flex h-6 shrink-0 items-center gap-0.5 rounded-md px-1.5 text-caption text-text-secondary hover:bg-bg-hover hover:text-text-primary focus-visible:outline-solid focus-visible:outline-2 focus-visible:outline-accent"
            title="Về danh sách dự án"
            to={ROUTES.dashboard}
          >
            <ChevronLeft aria-hidden="true" className="h-3.5 w-3.5" />
            Dự án
          </Link>
          <p className="max-w-[45%] shrink-0 truncate pr-2 text-[13px] font-medium text-text-secondary">
            {floors.some((floor) => floor.id === floorId) ? floorLabel : <ProjectFloorLabel floorId={floorId} projectId={projectId} />}
          </p>
        </div>
        {stepNav}
      </div>
    );
  }
  /* Khung soạn thảo: không còn hàng trên cùng — đầu màn chỉ giữ H1 ẩn và phím tắt; nội dung ở đầu cột việc. */
  if (chrome !== null) return heading;

  return (
    <div className="flex h-8 shrink-0 items-center gap-3 px-4">
      {heading}
      {floorMenu}
      {stepNav}
      {/* Tiến độ của lớp (Impeccable A3), cuối cùng hàng 32 px — không thêm hàng (V-16). */}
      {progress == null || minimal ? null : (
        <p className="shrink-0 whitespace-nowrap text-[12px] tabular-nums text-text-secondary" data-testid="qc-progress">
          {progress}
        </p>
      )}
    </div>
  );
}
