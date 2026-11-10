/**
 * `MobileViewer` — view thuần của màn `/m/du-an/:projectId`, xem 3D **chỉ đọc**
 * trên điện thoại. Chủ đầu tư và kỹ sư mở nó ở công trường, một tay cầm máy.
 *
 * View thuần theo mục D và R-60: không `@/api`, không `@/store`, không
 * `@/domain`, không `@/lib/http`. Mọi dữ liệu và mọi hàm xử lý đến qua
 * {@link MobileViewerProps}, nên màn này test được **chỉ từ props**.
 *
 * **Khung 3D phủ kín màn, hai thanh nổi lên trên nó.** `<canvas>` nằm ở
 * `absolute inset-0` và view **không** tạo geometry hay material nào — nó chỉ
 * giao phần tử canvas cho container qua `canvasRef`. Chép khuôn
 * `Viewer3D.tsx:213-214`: chỉ vẽ canvas khi `canvasRef !== undefined`, để story
 * và bài kiểm bỏ trống được mà không phải dựng WebGL.
 *
 * **Bảy trạng thái, không trạng thái nào ra màn trắng** (A11, R-63). Ba trạng
 * thái phủ kín khung nhìn bằng nền đặc (`empty`, `forbidden`, `error`), ba
 * trạng thái để mô hình hiện ra và chỉ thêm một lớp chữ (`loading`, `partial`,
 * `success`/`collapsed`). `error` ở màn này nghĩa là **máy yếu**: nó mời xem bản
 * 2D qua `fallback2dHref` chứ không mời thử lại — cố dựng tiếp trên đúng cái máy
 * vừa không dựng nổi là hứa một thứ không có.
 *
 * **Vùng bấm.** Mọi biểu tượng là `IconButton size="lg"` (khảo sát đo được đúng
 * {@link MOBILE_VIEWER_MIN_HIT_TARGET_PX}px; `md` mặc định chỉ 40px và trượt đặc
 * tả). Thứ không phải `IconButton` — liên kết sang bản 2D — nhận `minHeight`
 * nội tuyến lấy thẳng từ hằng ấy.
 *
 * **Esc đóng lớp trên cùng** (A12), đăng ký qua `useShortcut` chứ không tự gắn
 * `addEventListener` (R-54). Chỉ MỘT đăng ký cho cả màn, và nó tự chọn lớp trên
 * cùng: tấm thông tin trước, rồi mới tới công cụ đang bật. Hai đăng ký cùng
 * phím trong cùng phạm vi `dialog` sẽ báo trùng ở bản dev, nên chỗ quyết định
 * "lớp nào là trên cùng" phải là một chỗ.
 */

import type { ReactNode } from 'react';

import { Box, Lock, Share2 } from 'lucide-react';

import { EmptyState } from '@/components/feedback/EmptyState';
import { IconButton } from '@/components/ui/IconButton';
import { getButtonStyles } from '@/components/ui/buttonVariants';
import { useShortcut } from '@/hooks/useShortcut';

import { MobileViewerBottomBar } from './MobileViewerBottomBar';
import { MobileViewerInfoSheet } from './MobileViewerInfoSheet';
import {
  MOBILE_VIEWER_MIN_HIT_TARGET_PX,
  MOBILE_VIEWER_TOP_BAR_PX,
} from './mobileViewerTypes';
import type { MobilePartialReason, MobileViewerProps, MobileViewerState } from './mobileViewerTypes';

/** Lớp phủ kín khung nhìn, nền đặc — chỗ ba trạng thái không có gì để xem. */
function CoveringLayer({ children }: { readonly children: ReactNode }) {
  return (
    <div className="absolute inset-0 flex items-center justify-center bg-bg-app">{children}</div>
  );
}

/** Thẻ chữ nổi trên mô hình — chỗ hai trạng thái vẫn có gì đó để xem. */
function FloatingNote({ children }: { readonly children: ReactNode }) {
  return (
    <div className="pointer-events-none absolute inset-x-0 top-0 flex justify-center p-3">
      <p className="max-w-full rounded-lg border border-border-default bg-bg-surface px-3 py-2 text-center text-[13px] leading-relaxed text-text-primary shadow-panel">
        {children}
      </p>
    </div>
  );
}

/** Máy yếu: lối ra là bản 2D, không phải một nút thử lại. */
function WeakDeviceLayer({ fallback2dHref }: { readonly fallback2dHref: string }) {
  return (
    <CoveringLayer>
      <div className="flex flex-col items-center gap-4 px-6 text-center">
        <h2 className="text-[16px] font-semibold text-text-primary">
          Máy này chưa dựng nổi mô hình 3D
        </h2>
        <p className="max-w-sm text-[14px] leading-relaxed text-text-secondary">
          Bản 2D nhẹ hơn nhiều và vẫn có đủ kích thước bạn cần khi đứng ở công trường.
        </p>
        <a
          className={getButtonStyles({ variant: 'primary' })}
          href={fallback2dHref}
          style={{ minHeight: MOBILE_VIEWER_MIN_HIT_TARGET_PX }}
        >
          Xem bản 2D
        </a>
      </div>
    </CoveringLayer>
  );
}

interface StateLayerProps {
  readonly state: MobileViewerState;
  readonly detailLabel: string | null;
  readonly partialReason: MobilePartialReason | null;
  readonly fallback2dHref: string;
}

/** Bảy nhánh, mỗi nhánh vẽ một thứ. Không nhánh nào trả về `null`. */
function StateLayer({ state, detailLabel, partialReason, fallback2dHref }: StateLayerProps) {
  if (state === 'error') {
    return <WeakDeviceLayer fallback2dHref={fallback2dHref} />;
  }

  if (state === 'empty') {
    return (
      <CoveringLayer>
        <EmptyState
          description="Dự án này chưa có bản dựng 3D nào để mở trên điện thoại."
          icon={<Box />}
          title="Chưa có mô hình để xem"
        />
      </CoveringLayer>
    );
  }

  if (state === 'forbidden') {
    return (
      <CoveringLayer>
        <EmptyState
          description="Hỏi chủ dự án để được cấp quyền xem mô hình."
          icon={<Lock />}
          title="Bạn chưa có quyền xem mô hình này"
        />
      </CoveringLayer>
    );
  }

  if (state === 'loading') {
    // Mức gọn dựng trước rồi mới nâng dần, nên câu này là thứ nói cho người
    // dùng biết họ đang nhìn mức nào — không có nó thì mô hình thô trông như
    // mô hình hỏng.
    return <FloatingNote>{detailLabel ?? 'Đang tải mô hình'}</FloatingNote>;
  }

  // `partial` luôn có một câu nói lý do — không bao giờ rơi xuống câu "đã dựng
  // xong" bên dưới (B-V1-11). Thiếu lý do thì câu thiếu phòng, câu chắc đúng hơn.
  if (state === 'partial') {
    return (
      <FloatingNote>
        {partialReason === 'weak-network'
          ? 'Mạng đang yếu. Mô hình đã tải xong vẫn xem được.'
          : 'Mô hình mới có một phần: một số tầng chưa có phòng nào được dựng từ bản vẽ.'}
      </FloatingNote>
    );
  }

  if (detailLabel !== null) {
    return <FloatingNote>{detailLabel}</FloatingNote>;
  }

  return <span className="sr-only">Mô hình đã dựng xong.</span>;
}

export function MobileViewer({
  state,
  projectName,
  onShare,
  canvasRef,
  isCompact,
  activeTool,
  onSelectTool,
  floors,
  activeFloorId,
  onSelectFloor,
  selection,
  onDismissSelection,
  onSendDesktopLink,
  measurements,
  detailLabel,
  partialReason,
  fallback2dHref,
  sceneNotice = null,
}: MobileViewerProps) {
  // `collapsed` là "màn rất nhỏ", tức cùng một điều kiện mà `isCompact` mang.
  // Đọc cả hai để một bên bật là thanh dưới rút, dù container nói bằng đường nào.
  const compact = isCompact || state === 'collapsed';
  const isSheetOpen = selection !== null || activeTool === 'info';

  const dismissSheet = (): void => {
    onDismissSelection();

    if (activeTool === 'info') {
      onSelectTool(null);
    }
  };

  useShortcut(
    {
      id: 'mobileViewer.closeTopLayer',
      combo: 'Escape',
      scope: 'dialog',
      description: 'Đóng lớp đang mở trên màn xem mô hình',
      preventDefault: false,
      onTrigger: () => {
        if (isSheetOpen) {
          dismissSheet();
          return;
        }

        onSelectTool(null);
      },
    },
    { enabled: isSheetOpen || activeTool !== null },
  );

  return (
    <div
      aria-label="Xem mô hình 3D trên điện thoại"
      className="relative flex h-full w-full flex-col overflow-hidden bg-canvas-3d"
      role="region"
    >
      {/* Mặt vẽ của module cảnh, dưới mọi lớp chữ. View không dựng cảnh ở đây. */}
      {canvasRef !== undefined && state !== 'error' && (
        <div aria-hidden="true" className="absolute inset-0 block h-full w-full" ref={canvasRef} />
      )}

      <header
        className="relative z-10 flex shrink-0 items-center gap-2 border-b border-border-default bg-bg-surface px-3"
        style={{ height: MOBILE_VIEWER_TOP_BAR_PX }}
      >
        <h1 className="min-w-0 flex-1 truncate text-[15px] font-semibold text-text-primary">
          {projectName}
        </h1>

        {onShare !== null && (
          <IconButton
            aria-label="Chia sẻ dự án"
            icon={<Share2 />}
            onClick={onShare}
            size="lg"
            tooltip={false}
          />
        )}
      </header>

      <main className="relative min-h-0 flex-1">
        {sceneNotice !== null && (
          <p
            className="absolute inset-x-3 top-2 z-10 rounded-md bg-bg-surface px-3 py-2 text-[13px] text-text-secondary shadow-xs"
            role="status"
          >
            {sceneNotice}
          </p>
        )}
        <StateLayer
          detailLabel={detailLabel}
          fallback2dHref={fallback2dHref}
          partialReason={partialReason}
          state={state}
        />
      </main>

      <MobileViewerBottomBar
        activeFloorId={activeFloorId}
        activeTool={activeTool}
        floors={floors}
        isCompact={compact}
        measurements={measurements}
        onSelectFloor={onSelectFloor}
        onSelectTool={onSelectTool}
      />

      <MobileViewerInfoSheet
        isOpen={isSheetOpen}
        onDismiss={dismissSheet}
        onSendDesktopLink={onSendDesktopLink}
        selection={selection}
      />
    </div>
  );
}
