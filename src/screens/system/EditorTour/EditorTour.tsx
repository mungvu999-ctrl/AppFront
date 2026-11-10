/**
 * Lớp dạy việc chạy đè lên trình soạn thảo — nửa vẽ của mục D.
 *
 * View thuần: mọi thứ nó biết nằm trong {@link EditorTourProps}. Không store,
 * không mạng, không `@/domain` — `local/no-data-layer-in-view` (R-60) giữ điều
 * đó, và nhờ vậy sáu bước dựng lại được trong test chỉ bằng một object.
 *
 * Ba quyết định đáng nói, vì cả ba trông như tự làm khó mình:
 *
 * - **Nền tối là bốn tấm quanh lỗ, không phải một tấm có mặt nạ.** Lớp này
 *   không được chặn người dùng làm việc: thứ đang được dạy phải bấm được ngay
 *   trong lúc thẻ nhắc nói về nó. Bốn tấm để lại một ô trống thật sự — không
 *   phần tử nào phủ lên vùng khoét, nên không cần mẹo `pointer-events` nào cả.
 *   Bấm vào tấm tối là bỏ qua.
 * - **Đây không phải hộp thoại.** Không `role="dialog"`, không `aria-modal`,
 *   không bẫy tiêu điểm — Tab phải đi được từ thẻ ra đúng thứ đang tô sáng.
 *   Thẻ là một `<section>` mang tên từ tiêu đề của chính bước.
 * - **Độ mờ của nền viết nội tuyến.** Hậu tố alpha của Tailwind (`bg-x/28`) và
 *   `bg-opacity-N` biên dịch ra rỗng ở repo này vì biến màu là `var()` trần.
 *   Màu vẫn lấy từ token (A1); chỉ độ trong suốt là `opacity` nội tuyến.
 *
 * Bộ đếm lấy mẫu số từ `steps.length`, không phải hằng sáu: bước mất cả phím
 * lẫn neo đã bị hook bỏ khỏi mảng, và bộ đếm phải rút theo.
 */

import { useEffect, useId, useLayoutEffect, useRef, useState, type CSSProperties } from 'react';

import { Button } from '@/components/ui/Button';
import { Kbd } from '@/components/ui/Kbd';
import { cn } from '@/lib/utils';
import { cssDurationMs, MOTION_EASINGS } from '@/lib/motion/tokens';

import type { EditorTourProps, TourPlacement } from './useEditorTour';

import {
  ARROW,
  ARROW_EDGES,
  ARROW_INSET,
  ARROW_OUT,
  BACKDROP_OPACITY,
  CARD_WIDTH,
  SLIDE,
  backdropPanels,
  cardOrigin,
  clamp,
} from './editorTourGeometry';

/**
 * Góc mặc định của chip; màn chủ đổi được qua `chipAnchorClassName` (NO-208).
 * Giữa cạnh dưới (B-V2-05): đo cả ba màn chủ ở 1280×720 và 1440×900, chỗ này không đè
 * điều khiển nào. Bài: e2e/v2v3/tour-chip.spec.ts.
 */
// B4-10/J-16: màn có chân dính đáy (`data-sticky-footer`, như màn Xuất) thì chip đứng trên chân đó — cùng mẹo với Toast.
const DEFAULT_CHIP_ANCHOR = 'bottom-4 right-4 [html:has([data-sticky-footer])_&]:bottom-24';

export function EditorTour(props: EditorTourProps) {
  const {
    screenState,
    steps,
    activeIndex,
    cutout,
    isCollapsed,
    isReducedMotion,
    summary,
    isSkipChipVisible,
    chipAnchorClassName = DEFAULT_CHIP_ANCHOR,
    liveMessage,
    onNext,
    onSkip,
    onJump,
    onFinish,
    onReopen,
    onOpenSampleProject,
  } = props;

  const titleId = useId();
  /* Ref của KHUNG (thẻ + hàng chấm), không phải riêng thẻ: hàng chấm cao thêm 32px
     dưới thẻ, đo thiếu thì thẻ đặt "trên" neo lại đè lên neo (BUG-716). */
  const cardRef = useRef<HTMLDivElement | null>(null);

  /* Đo lại chiều cao thẻ: trạng thái thuần trình bày, không phải dữ liệu máy
     chủ. Thẻ đứng trên neo thì phải biết mình cao bao nhiêu mới đặt được mép. */
  const [cardHeight, setCardHeight] = useState(0);

  /* Hướng đi giữa hai bước, và một nhịp "vừa vào" để CSS có cái để chạy tới. */
  const previousIndexRef = useRef(activeIndex);
  const [entering, setEntering] = useState<-1 | 0 | 1>(0);

  const step = activeIndex >= 0 ? (steps[activeIndex] ?? null) : null;

  useLayoutEffect(() => {
    const node = cardRef.current;
    if (node !== null) {
      setCardHeight(node.getBoundingClientRect().height);
    }
  }, [step, screenState, isCollapsed, summary]);

  useLayoutEffect(() => {
    const previous = previousIndexRef.current;
    if (previous === activeIndex) {
      return undefined;
    }
    previousIndexRef.current = activeIndex;
    setEntering(activeIndex >= previous ? 1 : -1);
    const handle = requestAnimationFrame(() => {
      setEntering(0);
    });
    return () => {
      cancelAnimationFrame(handle);
    };
  }, [activeIndex]);

  const isInvite = screenState === 'loading';
  const isSummary = screenState === 'success';
  const isBlank = screenState === 'empty';
  const showsCard = !isBlank && (isInvite || isSummary || step !== null);
  const showsCutout = !isBlank && !isCollapsed && !isInvite && !isSummary && cutout !== null;
  const showsDots = showsCard && !isInvite && !isSummary && steps.length > 0;

  /* UX-45: nền tối không nuốt cú bấm. Bấm ra ngoài thẻ thì hướng dẫn đóng VÀ cú bấm
     vẫn tới nút bên dưới (vd. "Duyệt N đoạn máy chắc chắn") — người mới khỏi bấm hai lần. */
  useEffect(() => {
    if (!showsCutout) return undefined;
    const onPointerDown = (event: PointerEvent): void => {
      const card = cardRef.current;
      if (card !== null && event.target instanceof Node && card.contains(event.target)) return;
      // Bấm vào đúng ô đang được dạy (vd. ray công cụ ở bước 1): để người dùng làm thử, không đóng.
      if (
        cutout !== null &&
        event.clientX >= cutout.left &&
        event.clientX <= cutout.left + cutout.width &&
        event.clientY >= cutout.top &&
        event.clientY <= cutout.top + cutout.height
      ) {
        return;
      }
      onSkip();
    };
    document.addEventListener('pointerdown', onPointerDown, true);
    return () => {
      document.removeEventListener('pointerdown', onPointerDown, true);
    };
  }, [showsCutout, cutout, onSkip]);

  /* --- Chuyển động: ba con số, cả ba đọc từ bảng của src/lib/motion. ------ */

  const slide = isReducedMotion ? 0 : entering * SLIDE;
  const cardStyle: CSSProperties = {
    opacity: entering === 0 ? 1 : 0,
    transform: `translateX(${slide}px)`,
    transitionProperty: isReducedMotion ? 'opacity' : 'opacity, transform',
    transitionDuration: cssDurationMs(isReducedMotion ? 'instant' : 'standard'),
    transitionTimingFunction: MOTION_EASINGS.enter.css,
  };

  /* Giảm chuyển động: `cssDurationMs` trả 0ms, nên vùng khoét nhảy thẳng tới
     chỗ mới thay vì chạy — đúng nghĩa "đứng yên". */
  const cutoutMotion: CSSProperties = {
    transitionProperty: 'top, left, width, height',
    transitionDuration: cssDurationMs('slow', { reducedMotion: isReducedMotion }),
    transitionTimingFunction: MOTION_EASINGS.inOut.css,
  };

  /* --- Chỗ đứng của thẻ. -------------------------------------------------- */

  const viewWidth = typeof window === 'undefined' ? 0 : window.innerWidth;
  const viewHeight = typeof window === 'undefined' ? 0 : window.innerHeight;
  const anchor = isCollapsed || isInvite || isSummary ? null : (step?.anchorRect ?? null);
  const placement: TourPlacement = step?.placement ?? 'bottom';
  const origin =
    anchor === null ? null : cardOrigin(anchor, placement, cardHeight, viewWidth, viewHeight);

  /* V-11: ≤1024 (thu gọn) là thẻ nổi nhỏ góc phải dưới — cùng chỗ với chip, không tấm đáy che việc. */
  const framePosition: CSSProperties = isCollapsed
    ? {}
    : origin === null
      ? { left: '50%', top: '50%', transform: 'translate(-50%, -50%)' }
      : { left: origin.left, top: origin.top };

  const arrowStyle: CSSProperties =
    anchor === null || origin === null
      ? {}
      : placement === 'top' || placement === 'bottom'
        ? {
            left: clamp(
              anchor.left + anchor.width / 2 - origin.left - ARROW / 2,
              ARROW_INSET,
              CARD_WIDTH - ARROW_INSET,
            ),
            ...(placement === 'top' ? { bottom: ARROW_OUT } : { top: ARROW_OUT }),
          }
        : {
            top: clamp(
              anchor.top + anchor.height / 2 - origin.top - ARROW / 2,
              ARROW_INSET,
              Math.max(ARROW_INSET, cardHeight - ARROW_INSET),
            ),
            ...(placement === 'left' ? { right: ARROW_OUT } : { left: ARROW_OUT }),
          };

  const cardShape = isCollapsed ? 'w-72 rounded-xl border' : 'w-80 rounded-xl border';

  return (
    <div className="pointer-events-none fixed inset-0 z-40">
      <p aria-live="polite" className="sr-only">
        {liveMessage}
      </p>

      {showsCutout && cutout !== null && (
        <>
          {backdropPanels(cutout).map((panel) => (
            <div
              key={panel.side}
              aria-hidden="true"
              className="pointer-events-none fixed bg-bg-overlay"
              style={{ ...panel.box, ...cutoutMotion, opacity: BACKDROP_OPACITY }}
            />
          ))}
          <div
            aria-hidden="true"
            className="pointer-events-none fixed rounded-md border-2 border-accent"
            style={{
              top: cutout.top,
              left: cutout.left,
              width: cutout.width,
              height: cutout.height,
              ...cutoutMotion,
            }}
          />
        </>
      )}

      {showsCard && (
        <div
          ref={cardRef}
          data-testid="editor-tour-frame"
          className={cn('fixed', isCollapsed && DEFAULT_CHIP_ANCHOR)}
          style={framePosition}
        >
          <section
            aria-labelledby={titleId}
            className={`pointer-events-auto relative border-border-default bg-bg-surface p-5 shadow-float ${cardShape}`}
            style={cardStyle}
          >
            {anchor !== null && !isCollapsed && placement !== 'corner' && (
              <span
                aria-hidden="true"
                className={`absolute h-2 w-2 rotate-45 border-border-default bg-bg-surface ${ARROW_EDGES[placement]}`}
                style={arrowStyle}
              />
            )}

            {isInvite ? (
              <>
                <h3 id={titleId} className="text-[15px] font-medium text-text-primary">
                  Chưa có gì trên khung vẽ
                </h3>
                <p className="mt-2 text-[13px] leading-relaxed text-text-secondary">
                  Lớp chỉ dẫn cần một mặt bằng đang mở thì mới trỏ vào đâu được. Mở bộ mẫu
                  rồi quay lại đây.
                </p>
                <div className="mt-5 flex items-center justify-between">
                  <Button variant="ghost" size="sm" onClick={onSkip}>
                    Bỏ qua hướng dẫn
                  </Button>
                  <Button variant="primary" size="sm" onClick={onOpenSampleProject}>
                    Mở bộ mẫu
                  </Button>
                </div>
              </>
            ) : isSummary ? (
              <>
                <h3 id={titleId} className="text-[15px] font-medium text-text-primary">
                  Bấy nhiêu phím là đủ dùng
                </h3>
                <ul className="mt-3 flex flex-col gap-2">
                  {summary.map((row) => (
                    <li key={row.id} className="flex items-center justify-between gap-3">
                      <span className="text-[13px] text-text-secondary">{row.label}</span>
                      <Kbd>{row.combo}</Kbd>
                    </li>
                  ))}
                </ul>
                <div className="mt-5 flex justify-end">
                  <Button variant="primary" size="sm" onClick={onFinish}>
                    Bắt đầu làm việc
                  </Button>
                </div>
              </>
            ) : (
              step !== null && (
                <>
                  <p className="text-[13px] tabular-nums text-text-muted">
                    {activeIndex + 1} / {steps.length}
                  </p>
                  <h3 id={titleId} className="mt-2 text-[15px] font-medium text-text-primary">
                    {step.title}
                  </h3>
                  <p className="mt-2 text-[13px] leading-relaxed text-text-secondary">
                    {step.body}
                  </p>
                  {step.combo !== null && (
                    <p className="mt-3 flex items-center gap-2 text-[13px] text-text-secondary">
                      <Kbd>{step.combo}</Kbd>
                      {step.comboDescription !== null && <span>{step.comboDescription}</span>}
                    </p>
                  )}
                  <p className="mt-3 text-[12px] text-text-muted">Bấm Esc để đóng hướng dẫn.</p>
                  <div className="mt-5 flex items-center justify-between">
                    <Button variant="ghost" size="sm" onClick={onSkip}>
                      Bỏ qua hướng dẫn
                    </Button>
                    <Button variant="primary" size="sm" onClick={onNext}>
                      {activeIndex === steps.length - 1 ? 'Xong' : 'Tiếp theo'}
                    </Button>
                  </div>
                </>
              )
            )}

          {showsDots && (
            <div
              role="group"
              aria-label="Tiến độ hướng dẫn"
              className="mt-3 flex justify-center"
            >
              {steps.map((dot, index) => (
                <button
                  key={dot.id}
                  type="button"
                  onClick={() => {
                    onJump(index);
                  }}
                  aria-label={`Tới bước ${index + 1}: ${dot.title}`}
                  aria-current={index === activeIndex ? 'step' : undefined}
                  className="flex h-6 w-6 coarse:h-11 coarse:w-11 items-center justify-center rounded-full outline-hidden focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:ring-offset-bg-app"
                >
                  <span
                    aria-hidden="true"
                    className={`h-1.5 rounded-full ${
                      index === activeIndex ? 'w-4 bg-accent' : 'w-1.5 bg-text-muted opacity-40'
                    }`}
                  />
                </button>
              ))}
            </div>
          )}
          </section>
        </div>
      )}

      {/* Vị trí do màn chủ truyền (NO-208); mặc định góc phải dưới như thẻ hướng dẫn (G4a-07) — xem `DEFAULT_CHIP_ANCHOR`. */}
      {isSkipChipVisible && (
        <div className={cn('pointer-events-auto fixed', chipAnchorClassName)}>
          <Button variant="secondary" size="sm" onClick={onReopen}>
            Xem hướng dẫn
          </Button>
        </div>
      )}
    </div>
  );
}
