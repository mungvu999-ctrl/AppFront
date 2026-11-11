/**
 * Thẻ nhỏ "về dự án" và dải bước của dự án — hai thứ AppFront thêm vào trang Pascal.
 * Nằm đầu khe `viewerToolbarLeft` nên không đè thanh bên; kiểu chép từ `TOOLBAR_CONTAINER`
 * của upstream `viewer-toolbar.tsx`.
 */
import { ArrowLeft, ArrowRight, ChevronDown, Eye, PencilRuler, TriangleAlert, WifiOff, X } from 'lucide-react';
import { type ReactNode, useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { createPortal } from 'react-dom';

import { assetRefreshStatus, subscribeAssetRefresh } from '@/lib/pascal/sceneLibrary';
import { ROUTES } from '@/routes/paths';
import { PROJECT_STEPS } from '@/routes/projectSteps';

import type { PascalConfirm, PascalSaveStatus } from './bridge/types';
import { SCALE_NEXT_REASON } from './scaleBanner';
import { useScaleUnresolvedFloor } from './scaleUnresolved';

export interface BackToProjectCardProps {
  readonly href: string;
  readonly projectName?: string | undefined;
  /** Trạng thái lưu thật của tầng (cầu); vắng khi chỉ đọc. */
  readonly save?: PascalSaveStatus | undefined;
}

export function BackToProjectCard({ href, projectName, save }: BackToProjectCardProps) {
  return (
    <>
      <BackLink href={href} projectName={projectName} />
      {save !== undefined ? (
        <SaveStatusCard save={save} />
      ) : (
        <>
          <ReadOnlyChip />
          <ReadOnlyAssetNotice />
        </>
      )}
    </>
  );
}

/**
 * UX-R2 K35: trang mở để XEM mô hình — bảng công cụ dựng thu gọn (upstream page.tsx). Nút này mở
 * nó ở thẻ "Dựng"; bảng đang mở thì nút ẩn đi (thanh dọc vẫn đóng/mở được như cũ).
 */
export function EditModelButton({ collapsed, onOpen }: { readonly collapsed: boolean; readonly onOpen: () => void }) {
  if (!collapsed) return null;
  return (
    <button
      className={`${CARD} ${FOCUS_OUT} inline-flex cursor-pointer gap-1.5 whitespace-nowrap px-2.5 font-medium transition-colors duration-120 hover:bg-[var(--pa-sunken)] motion-reduce:transition-none`}
      onClick={onOpen}
      title="Sửa mô hình"
      type="button"
    >
      <PencilRuler aria-hidden="true" className="h-3.5 w-3.5 shrink-0" />
      {/* UX41 U58 + Editor3D 01/11: < 1200px chỉ còn biểu tượng (thanh 1024 tràn); tên vẫn đọc được (sr-only) và ở title. */}
      <span className="@max-[1200px]/appbar:sr-only" data-appfront-head-label="">Sửa mô hình</span>
    </button>
  );
}

/** A11: vai chỉ xem thì màn nói vì sao không sửa được (cầu không trả `save` khi chỉ đọc). */
export const READ_ONLY_REASON = 'Bạn đang xem ở vai người xem nên không sửa được mô hình 3D.';

function ReadOnlyChip() {
  return (
    <div className={`${CARD} inline-flex gap-1.5 px-2.5 text-[var(--pa-text-2)]`} role="note" title={READ_ONLY_REASON}>
      <Eye aria-hidden="true" className="h-3.5 w-3.5 shrink-0" />
      <span aria-hidden="true">Chỉ xem</span>
      <span className="sr-only">{READ_ONLY_REASON}</span>
    </div>
  );
}

const FOCUS_OUT = 'outline-2 outline-transparent focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--pa-accent)]';

function BackLink({ href, projectName }: Omit<BackToProjectCardProps, 'save'>) {
  return (
    <a
      {...(projectName !== undefined ? { 'aria-label': `Về dự án: ${projectName}` } : {})}
      className={`${FOCUS_OUT} inline-flex h-8 max-w-56 shrink-[50] items-center gap-1.5 @min-[1500px]/appbar:max-w-80 rounded-xl border border-[var(--pa-border)] bg-[var(--pa-surface)] px-2.5 font-medium text-[13px] text-[var(--pa-text)] shadow-[var(--pa-shadow-float)] transition-colors duration-120 hover:bg-[var(--pa-sunken)] motion-reduce:transition-none @max-[1200px]/appbar:min-w-8! @max-[1200px]/appbar:px-2`}
      href={href}
    >
      <ArrowLeft aria-hidden="true" className="h-3.5 w-3.5 shrink-0" />
      <span className="truncate @max-[1200px]/appbar:sr-only">{projectName ?? 'Về dự án'}</span>
    </a>
  );
}

const CARD = 'h-8 shrink-0 items-center rounded-xl border border-[var(--pa-border)] bg-[var(--pa-surface)] text-[13px] text-[var(--pa-text)] shadow-[var(--pa-shadow-float)]';
/** Như `CARD` nhưng màu viền/chữ theo trạng thái — hai lớp màu cùng loại thì Tailwind không chắc lớp nào thắng. */
const STATUS_CARD = 'h-8 shrink-0 items-center rounded-xl border bg-[var(--pa-surface)] text-[13px] shadow-[var(--pa-shadow-float)]';
/**
 * FE3D-FIX-004 V10: thông báo nổi (toast) cổng ra `body` nên không chiếm chỗ trong thanh và đè được
 * canvas (thanh nằm trong khối `clipPath` của vendor). Giữa, ngay DƯỚI thanh trên (dưới nút "?"): góc
 * phải dưới đè hàng "Tỉ lệ chung" của bảng đồ vật bên phải, giữa dưới đè thẻ kích thước (`HomeownerCard`)
 * và dock. Lớp z dưới menu thả xuống (`z-50`) — toast không che menu đang mở. Lỗi lưu ở trên, câu báo ở dưới.
 */
const TOAST_STACK = 'fixed top-24 left-1/2 z-40 flex -translate-x-1/2 flex-col items-center gap-2';
const TOAST =
  'inline-flex min-h-10 max-w-[min(28rem,calc(100vw-2rem))] items-center gap-3 rounded-xl border bg-[var(--pa-surface)] px-4 py-2 text-[14px] leading-[22px] shadow-[var(--pa-shadow-overlay)]';
const ALERT_TONE = 'border-[var(--pa-danger)] text-[var(--pa-danger)]';
const INFO_TONE = 'border-[var(--pa-border)] text-[var(--pa-text)]';
const SAVING_TEXT = 'Đang lưu…';
/** Chữ của chip khi lưu hỏng; câu đầy đủ nằm ở toast. */
const UNSAVED_CHIP = 'Chưa lưu';
/** K5: chip có ngay từ lúc mở, trước lượt lưu đầu. */
export const AUTOSAVE_CHIP = 'Tự động lưu';
/** K5/A2-06: mất mạng không gộp vào "Đang lưu…". */
export const OFFLINE_CHIP = 'Mất mạng — chưa gửi được';
const BUTTON_LINK = `${FOCUS_OUT} inline-flex min-h-8 shrink-0 items-center rounded-lg px-2 font-medium text-[var(--pa-accent)] hover:bg-[var(--pa-sunken)] hover:text-[var(--pa-accent-hover)]`;
const CLOSE_BUTTON = `${FOCUS_OUT} flex h-8 w-8 shrink-0 items-center justify-center rounded-lg text-[var(--pa-text-2)] hover:bg-[var(--pa-sunken)] hover:text-[var(--pa-text)]`;
/** Toast tự gỡ: câu báo sau 6 s, câu lỗi sau 8 s. */
export const INFO_TOAST_MS = 6000;
export const ALERT_TOAST_MS = 8000;

/**
 * Một toast. Có `autoHideMs` thì tự gỡ sau chừng ấy; rê chuột vào / có tiêu điểm thì dừng, ra thì
 * đếm lại từ đầu (đang đọc thì không biến mất). Esc đóng. Vắng `autoHideMs` = giữ tới khi việc được
 * làm (toast có nút hành động: "Tải lại tầng", "Đăng nhập lại").
 */
function Toast({
  alert,
  autoHideMs,
  children,
  onClose,
  testId,
}: {
  readonly alert: boolean;
  readonly autoHideMs?: number;
  readonly children: ReactNode;
  readonly onClose?: () => void;
  readonly testId?: string;
}) {
  const [paused, setPaused] = useState(false);
  // Hàm đóng đổi danh tính mỗi lượt vẽ của cầu: giữ trong ref để đồng hồ không đếm lại.
  const close = useRef(onClose);
  useEffect(() => {
    close.current = onClose;
  });

  useEffect(() => {
    if (paused || autoHideMs === undefined) return undefined;
    const timer = setTimeout(() => close.current?.(), autoHideMs);
    return () => clearTimeout(timer);
  }, [autoHideMs, paused]);

  return (
    <div
      className={`${TOAST} ${alert ? ALERT_TONE : INFO_TONE}`}
      data-testid={testId}
      onBlur={() => setPaused(false)}
      onFocus={() => setPaused(true)}
      onKeyDown={(event) => {
        if (event.key === 'Escape' && onClose !== undefined) onClose();
      }}
      onMouseEnter={() => setPaused(true)}
      onMouseLeave={() => setPaused(false)}
      role={alert ? 'alert' : 'status'}
    >
      <span aria-hidden="true" className={`h-1.5 w-1.5 shrink-0 rounded-full ${alert ? 'bg-[var(--pa-danger)]' : 'bg-[var(--pa-ok)]'}`} />
      {children}
      {onClose !== undefined && (
        <button aria-label="Đóng thông báo" className={CLOSE_BUTTON} onClick={onClose} type="button">
          <X aria-hidden="true" className="h-3.5 w-3.5" />
        </button>
      )}
    </div>
  );
}

/**
 * Mẫu thư viện hết hạn không tải lại được (`refreshAssetUrl`): giữ câu báo, không tự ẩn (món vẫn đang hỏng);
 * người dùng đóng được, mẫu hỏng thêm thì hiện lại. Đổi người (`forget`) xoá danh sách lỗi → câu báo tắt.
 * Dùng ở CẢ hai vai: người sửa (trong chồng toast của chip lưu) và người xem (không có chip lưu — vòng 11: câu báo
 * từng chỉ nằm trong `SaveStatusCard` nên người xem không bao giờ thấy).
 */
function useAssetNotice(): { readonly text: string | null; readonly dismiss: () => void } {
  const failures = useSyncExternalStore(subscribeAssetRefresh, () => assetRefreshStatus().failures.length);
  const text = useSyncExternalStore(subscribeAssetRefresh, () => assetRefreshStatus().notice);
  const [dismissedAt, setDismissedAt] = useState(0);
  // Danh sách lỗi đã bị xoá (đổi người) rồi đầy lại: số đã đóng cũ không còn nghĩa.
  const dismissed = dismissedAt <= failures ? dismissedAt : 0;
  return { text: failures > dismissed ? text : null, dismiss: () => setDismissedAt(failures) };
}

function AssetNoticeToast({ text, onClose }: { readonly text: string; readonly onClose: () => void }) {
  return (
    <Toast alert={false} onClose={onClose} testId="asset-expired-notice">
      <span className="min-w-0 break-words">{text}</span>
    </Toast>
  );
}

/** Vai chỉ xem: không có chip lưu nên câu báo mẫu hết hạn có chồng toast riêng (cùng vị trí). */
export function ReadOnlyAssetNotice() {
  const asset = useAssetNotice();
  if (asset.text === null) return null;
  return createPortal(
    <div className={TOAST_STACK} data-appfront-toast="">
      <AssetNoticeToast onClose={asset.dismiss} text={asset.text} />
    </div>,
    document.body,
  );
}

/**
 * Chip lưu của tầng (v3 BE.md major 1): MỘT chấm màu — xanh đã lưu, vàng đang lưu, đỏ chưa lưu; mất
 * mạng là biểu tượng wifi gạch. Câu đầy đủ ("Đã lưu lúc 10:02"…) ở chú thích khi rê chuột và cho trình
 * đọc màn hình; thanh trên chật nên không in chữ.
 *
 * Lưu hỏng (B3-09): câu đầy đủ lên toast cổng ra `body`. Bị khối / phiên hết có nút hành động nên toast
 * giữ tới khi xử lý; lưu hỏng thường tự gỡ. Câu báo của lượt sửa (`notices`) mỗi câu một toast riêng.
 */
export function SaveStatusCard({ save }: { readonly save: PascalSaveStatus }) {
  const alert = save.state === 'blocked' || save.state === 'failed' || save.state === 'session';
  const sticky = save.state === 'blocked' || save.state === 'session';
  const offline = save.state === 'offline';
  const alertText =
    save.state === 'blocked' || save.state === 'session' ? (save.blockMessage ?? 'Tầng này chưa lưu được.') : (save.label ?? 'Lưu thất bại');
  const text = alert ? UNSAVED_CHIP : offline ? OFFLINE_CHIP : save.state === 'saving' ? SAVING_TEXT : (save.label ?? AUTOSAVE_CHIP);
  const dot = alert ? 'bg-[var(--pa-danger)]' : offline || save.state === 'saving' ? 'bg-[var(--pa-warn)]' : 'bg-[var(--pa-ok)]';
  // Lưu hỏng thường (không nút hành động) tự gỡ như câu lỗi; lần hỏng sau với câu khác thì hiện lại.
  const [hiddenFailure, setHiddenFailure] = useState<string | null>(null);
  const showAlert = alert && (sticky || hiddenFailure !== alertText);
  const notices = save.notices;
  const asset = useAssetNotice();
  const assetNotice = asset.text;

  return (
    <>
      <div
        aria-live="polite"
        className={`${STATUS_CARD} inline-flex w-8 justify-center ${alert ? ALERT_TONE : offline ? 'border-[var(--pa-warn)] text-[var(--pa-text)]' : INFO_TONE}`}
        data-appfront-save-alert={alert || offline ? '' : undefined}
        role="status"
        title={alert ? alertText : text}
      >
        {offline ? (
          <WifiOff aria-hidden="true" className="h-3.5 w-3.5 shrink-0 text-[var(--pa-warn)]" />
        ) : (
          <span aria-hidden="true" className={`h-2.5 w-2.5 shrink-0 rounded-full ${dot}`} />
        )}
        <span className="sr-only">{text}</span>
      </div>
      {(showAlert || notices.length > 0 || assetNotice !== null) &&
        createPortal(
          <div className={TOAST_STACK} data-appfront-toast="">
            {showAlert && (
              <Toast alert {...(sticky ? {} : { autoHideMs: ALERT_TOAST_MS, onClose: () => setHiddenFailure(alertText) })}>
                <span>{alertText}</span>
                {save.state === 'blocked' && (
                  <button className={BUTTON_LINK} onClick={save.onReloadFloor} type="button">
                    Tải lại tầng
                  </button>
                )}
                {save.state === 'session' && save.loginHref !== undefined && (
                  <a className={BUTTON_LINK} href={save.loginHref}>
                    Đăng nhập lại
                  </a>
                )}
              </Toast>
            )}
            {assetNotice !== null && <AssetNoticeToast onClose={asset.dismiss} text={assetNotice} />}
            {notices.map((notice) => (
              <Toast
                alert={notice.tone === 'alert'}
                autoHideMs={notice.tone === 'alert' ? ALERT_TOAST_MS : INFO_TOAST_MS}
                key={notice.id}
                onClose={() => save.dismissNotice(notice.id)}
              >
                {/* C1/F-01: câu đủ chữ (xuống dòng, không cắt). */}
                <span className="min-w-0 break-words">{notice.text}</span>
              </Toast>
            ))}
          </div>,
          document.body,
        )}
      {save.confirm !== undefined && save.confirm !== null && <ConfirmBox confirm={save.confirm} />}
    </>
  );
}

/** Hộp hỏi trước việc làm mất dữ liệu (C4): Esc / "Huỷ" là giữ nguyên; nút huỷ nhận tiêu điểm trước. */
function ConfirmBox({ confirm }: { readonly confirm: PascalConfirm }) {
  return createPortal(
    <div className="fixed inset-0 z-[110] flex items-center justify-center bg-[var(--pa-overlay)] p-4" data-appfront-confirm="">
      <div
        aria-describedby="appfront-confirm-body"
        aria-labelledby="appfront-confirm-title"
        aria-modal="true"
        className="w-full max-w-md rounded-2xl border border-[var(--pa-border)] bg-[var(--pa-surface)] p-5 text-[14px] text-[var(--pa-text)] shadow-[var(--pa-shadow-overlay)]"
        onKeyDown={(event) => {
          if (event.key === 'Escape') confirm.onCancel();
        }}
        role="alertdialog"
      >
        <h2 className="font-semibold text-[16px]" id="appfront-confirm-title">
          {confirm.title}
        </h2>
        <p className="mt-2 text-[var(--pa-text-2)] leading-[22px]" id="appfront-confirm-body">
          {confirm.body}
        </p>
        <div className="mt-5 flex justify-end gap-2">
          <button autoFocus className={`${FOCUS_OUT} h-9 rounded-lg border border-[var(--pa-border)] px-3 font-medium hover:bg-[var(--pa-sunken)]`} onClick={confirm.onCancel} type="button">
            Huỷ
          </button>
          <button className={`${FOCUS_OUT} h-9 rounded-lg bg-[var(--pa-danger)] px-3 font-medium text-[var(--pa-surface)] hover:opacity-90`} onClick={confirm.onConfirm} type="button">
            {confirm.confirmLabel}
          </button>
        </div>
      </div>
    </div>,
    document.body,
  );
}

/** Cổng đủ điều kiện: nút chính "Sang <bước sau>". Tỷ lệ chưa hiệu chỉnh: nút phụ dẫn tới việc còn thiếu. */
const NEXT_OK = 'border-transparent bg-[var(--pa-accent)] text-[var(--pa-surface)] hover:bg-[var(--pa-accent-hover)] active:bg-[var(--pa-accent-active)]';
const NEXT_TODO = 'border-[var(--pa-border)] bg-[var(--pa-surface)] text-[var(--pa-text)] hover:bg-[var(--pa-sunken)]';
const NEXT_LINK = `${FOCUS_OUT} inline-flex h-8 shrink-0 items-center gap-1 whitespace-nowrap rounded-xl border px-3 @max-[800px]/appbar:px-2 font-medium text-[13px] shadow-[var(--pa-shadow-float)] transition-colors duration-120 motion-reduce:transition-none`;

const VIEWER_STEP = PROJECT_STEPS.findIndex((step) => step.id === 'viewer');

/**
 * Cụm "bước của dự án" trên thanh 3D (G5-04, N0-07; UI-1023 V-01): trang 3D không có header chung
 * của app nên tự vẽ lại từ cùng bảng `PROJECT_STEPS`. Một cụm có nhãn, luôn cùng một chỗ (ngay sau
 * thẻ về dự án): chip "Bước 4 · Mô hình 3D + menu sáu bước" rồi MỘT nút cổng (HOP-DONG-V6 §1):
 * đủ điều kiện = nút chính "Sang Quy chuẩn"; tỷ lệ chưa hiệu chỉnh = nút phụ "Đặt tỷ lệ" (cùng tên với dải cảnh báo, UX-R2 K35) tới màn
 * tỷ lệ của tầng sai (bước sau vẫn mở được từ menu bước — tỷ lệ là khuyến nghị, không khoá).
 * Ngưỡng theo bề rộng thanh (container `appbar`, pascal.css): < 1500px chip chỉ còn số bước (tên ở
 * `title`) để nhường chỗ cho tên đầy đủ của nút cổng từ 1200px; 800–1199px nút còn "Quy chuẩn →" /
 * "Tỷ lệ" (800–1599px); < 800px chỉ còn biểu tượng (tên ở `aria-label`/`title`). Nút không bao giờ ẩn.
 */
export function ProjectStepsCard({ projectId, readOnly = false }: { readonly projectId: string; readonly readOnly?: boolean }) {
  const next = PROJECT_STEPS[VIEWER_STEP + 1];
  const current = PROJECT_STEPS[VIEWER_STEP] ?? PROJECT_STEPS[0]!;
  const scaleFloor = useScaleUnresolvedFloor();
  return (
    <nav aria-label="Các bước của dự án" className="inline-flex shrink-0 items-center gap-1.5">
      <details className="relative" data-appfront-menu="">
        <summary
          aria-label={`Bước ${VIEWER_STEP + 1}/${PROJECT_STEPS.length}: ${current.label} — mở danh sách bước`}
          title={`Bước ${VIEWER_STEP + 1}: ${current.label}`}
          className={`${CARD} flex cursor-pointer list-none gap-1.5 whitespace-nowrap px-2 font-medium transition-colors duration-120 hover:bg-[var(--pa-sunken)] motion-reduce:transition-none ${FOCUS_OUT} [&::-webkit-details-marker]:hidden`}
        >
          {/* UX41 U58: < 800px (cửa sổ 768) chip chỉ còn số bước, tên ở aria-label/title; thanh trái hết đè thanh phải. */}
          <span>
            Bước {VIEWER_STEP + 1}<span className="@max-[800px]/appbar:hidden" data-appfront-head-label=""> · {current.label}</span>
          </span>
          <ChevronDown aria-hidden="true" className="h-3.5 w-3.5 shrink-0 text-[var(--pa-text-3)] @max-[720px]/appbar:hidden" />
        </summary>
        <ol aria-label="Danh sách bước" className="absolute top-full left-0 z-50 mt-1 min-w-48 rounded-xl border border-[var(--pa-border)] bg-[var(--pa-surface)] p-1 text-[13px] text-[var(--pa-text)] shadow-[var(--pa-shadow-overlay)]">
          {PROJECT_STEPS.map((step, index) => (
            <li key={step.id}>
              <a
                // UX-R2 K40: bước đang mở cũng có tên (trước chỉ có `aria-current`, tên đọc ra rỗng).
                {...(index === VIEWER_STEP ? { 'aria-current': 'step' as const } : {})}
                aria-label={`Bước ${index + 1}: ${step.label}`}
                className={`${FOCUS_OUT} flex h-8 items-center gap-2 whitespace-nowrap rounded-lg px-2 text-[var(--pa-text-2)] hover:bg-[var(--pa-sunken)] hover:text-[var(--pa-text)] aria-[current=step]:bg-[var(--pa-selected)] aria-[current=step]:font-medium aria-[current=step]:text-[var(--pa-accent)]`}
                href={step.path(projectId)}
              >
                <span className="w-3 tabular-nums text-[var(--pa-text-3)]">{index + 1}</span>
                {step.label}
              </a>
            </li>
          ))}
        </ol>
      </details>
      {/* UX-R3 U45: nút sang bước sau luôn có; tỷ lệ chưa hiệu chỉnh thì thêm nút phụ "Đặt tỷ lệ" bên cạnh
          (tỷ lệ là khuyến nghị, không khoá). U37: người xem không đặt tỷ lệ được nên không thấy nút đó. */}
      {next !== undefined && scaleFloor !== null && !readOnly ? (
        <a
          aria-label={`Đặt tỷ lệ trước khi sang ${next.label}`}
          className={`${NEXT_LINK} ${NEXT_TODO}`}
          data-appfront-gate="todo"
          href={ROUTES.project.scale(projectId, scaleFloor)}
          title={SCALE_NEXT_REASON}
        >
          <TriangleAlert aria-hidden="true" className="h-3.5 w-3.5 shrink-0 text-[var(--pa-warn)]" />
          <span className="@max-[800px]/appbar:hidden @min-[1600px]/appbar:hidden">Tỷ lệ</span>
          <span className="hidden @min-[1600px]/appbar:inline">Đặt tỷ lệ</span>
        </a>
      ) : null}
      {next !== undefined ? (
        <a
          aria-label={`Sang ${next.label}`}
          className={`${NEXT_LINK} ${NEXT_OK}`}
          data-appfront-gate="ready"
          href={next.path(projectId)}
          title={`Sang bước ${VIEWER_STEP + 2}: ${next.label}`}
        >
          <span className="@max-[800px]/appbar:sr-only">
            <span className="hidden @min-[1200px]/appbar:inline">Sang </span>
            {next.label}
          </span>
          <ArrowRight aria-hidden="true" className="h-3.5 w-3.5 shrink-0" />
        </a>
      ) : null}
    </nav>
  );
}
