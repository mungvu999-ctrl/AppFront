/**
 * Header chung của ứng dụng — có mặt ở mọi màn sau đăng nhập (gắn một lần ở
 * `routes/AppLayout.tsx`, không màn nào tự vẽ lại).
 *
 * Hàng trên (48 px): thương hiệu, điều hướng toàn cục, tên dự án đang mở (bấm mở menu các màn khác
 * của dự án — tách khỏi nav toàn cục), chuông, tài khoản, đăng xuất.
 * Hàng dưới (40 px), chỉ khi đang ở trong một dự án: sáu bước (kèm trạng thái xong/còn việc) và góc
 * phải mang MỘT nghĩa: việc kế tiếp. Bước đang đứng đã xong → nút chính "Tiếp: <bước>"; chưa xong → vẫn
 * "Tiếp: <bước>" nhưng kiểu phụ (cổng mềm); màn ngoài bước → "Tiếp tục: <bước đầu chưa xong>"; màn giữ
 * cổng riêng (FlowGate) thì cổng thay chỗ này. Hai hàng ≤ 96 px (V-16).
 *
 * View thuần: mọi dữ liệu đến qua props; liên kết dùng `Link` của router.
 */
import { useState, type ReactNode } from 'react';
import { ArrowLeft, ArrowRight, Check, ChevronDown, ChevronRight, LogOut, Users } from 'lucide-react';
import { Link, NavLink, useLocation, useMatch } from 'react-router-dom';

import { Skeleton } from '@/components/feedback/Skeleton';
import { Modal } from '@/components/overlay/Modal';
import { Avatar } from '@/components/ui/Avatar';
import { Button } from '@/components/ui/Button';
import { getButtonStyles } from '@/components/ui/buttonVariants';
import { cn } from '@/lib/utils';
import { ROUTES } from '@/routes/paths';
import { PROJECT_STEPS, stepPath, stepStateText, type ProjectStepState } from '@/routes/projectSteps';
import { BrandMark } from './BrandMark';
import { setFlowGateSlot, useFlowGateOwned } from './flowGateStore';
import { ProjectNav } from './ProjectNav';

export interface AppHeaderProject {
  readonly id: string;
  /** null khi tên chưa về từ máy chủ. */
  readonly name: string | null;
  /** -1 khi màn hiện tại nằm ngoài sáu bước. */
  readonly stepIndex: number;
  /** Tầng đang mở trong bước 3: ô "Duyệt tầng" trỏ về lớp đầu của tầng này. */
  readonly floorId?: string | undefined;
  /** Lớp đang duyệt (chỉ số trong FLOOR_LAYERS); -1 ở màn công cụ của tầng. Cổng tầng (FloorReviewGate) lo nút đi tiếp. */
  readonly layerIndex?: number | undefined;
  /** Dự án chưa có bản vẽ / lượt xử lý lỗi: nút chính không mời sang bước sau. */
  readonly blocker?: 'no-drawings' | 'processing' | 'pipeline-error' | undefined;
  /** Màn kiểm tra tầng gần nhất của dự án này (G4a-34/N4-08): ô bước 3 quay về đó thay vì danh sách tầng. */
  readonly lastFloorPath?: string | undefined;
  /** Trạng thái sáu bước (cùng thứ tự PROJECT_STEPS); vắng thì mọi bước "chưa tới". */
  readonly stepStates?: readonly ProjectStepState[] | undefined;
}

export interface AppHeaderProps {
  readonly accountInitials?: string | undefined;
  readonly accountLabel: string;
  readonly showAdmin: boolean;
  readonly notificationBell?: ReactNode;
  readonly project: AppHeaderProject | null;
  /** Dự án vừa rời (N4-05): ở màn Quản trị hiện lối "Về dự án …". */
  readonly returnProject?: { readonly id: string; readonly name: string } | null | undefined;
  readonly onSignOut: () => void;
}

/** Vòng tiêu điểm chung cho mọi liên kết/nút trên thanh đầu (cùng kiểu với Button). */
const FOCUS_RING =
  'focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:ring-offset-bg-surface';
/** Vùng bấm 24 px; 44 px khi con trỏ thô. */
const HIT = 'min-h-6 coarse:min-h-11 coarse:min-w-11';

const navLinkClass = ({ isActive }: { isActive: boolean }): string =>
  cn(
    'flex h-8 shrink-0 items-center whitespace-nowrap rounded-md px-3 text-[13px] font-medium transition-colors duration-fast coarse:min-h-11',
    FOCUS_RING,
    isActive ? 'bg-accent-wash text-accent' : 'text-text-secondary hover:bg-bg-sunken hover:text-text-primary',
  );

export function StepMarker({ index, isCurrent, state }: { readonly index: number; readonly isCurrent: boolean; readonly state: ProjectStepState }) {
  return (
    <span
      aria-hidden="true"
      className={cn(
        'relative flex h-5 w-5 shrink-0 items-center justify-center rounded-full text-[11px] font-semibold',
        isCurrent ? 'bg-accent text-white' : state === 'done' ? 'bg-state-verified-tint text-state-verified-text' : 'bg-bg-sunken text-text-secondary',
      )}
    >
      {state === 'done' && !isCurrent ? <Check size={12} strokeWidth={3} /> : index + 1}
      {state === 'attention' && (
        <span className="absolute -right-0.5 -top-0.5 h-2 w-2 rounded-full bg-state-attention ring-2 ring-bg-surface" />
      )}
    </span>
  );
}

/** Hộp hỏi lại trước khi đăng xuất, dùng chung cho header và menu tệp của màn biên tập. */
export function SignOutConfirm({ isOpen, onClose, onSignOut }: { readonly isOpen: boolean; readonly onClose: () => void; readonly onSignOut: () => void }) {
  return (
    <Modal.Root isOpen={isOpen} onClose={onClose} width={480}>
      <Modal.Header>Đăng xuất?</Modal.Header>
      <Modal.Body>
        <p>Bạn sẽ phải đăng nhập lại để tiếp tục làm việc.</p>
      </Modal.Body>
      <Modal.Footer>
        <Button variant="ghost" onClick={onClose}>Huỷ</Button>
        <Button variant="primary" onClick={onSignOut}>Đăng xuất</Button>
      </Modal.Footer>
    </Modal.Root>
  );
}

function ProjectStepBar({ project }: { readonly project: AppHeaderProject }) {
  const routerLocation = useLocation();
  // Màn Xử lý tự giữ cổng sang bước sau (thiếu tỷ lệ thì chặn, S-10 cụm 3): header không mời "Tiếp" song song.
  const onPipelineScreen = /\/pipeline\/?$/u.test(routerLocation.pathname);
  // Màn đang giữ cổng riêng (FlowGate): nút "Tiếp" mặc định nhường chỗ cho cổng của màn.
  const gateOwned = useFlowGateOwned();
  // Bước đang đứng xong → nút chính; chưa xong → nút phụ (màn tự có nút chính trong thân trang).
  const currentDone = project.stepStates?.[project.stepIndex] === 'done';
  // UX-07: ở Tải bản vẽ mà bản vẽ đã xử lý xong thì việc kế tiếp là Duyệt tầng, không mời "Tiếp: Xử lý" lần nữa.
  const skipToReview = project.stepIndex === 0 && project.stepStates?.[1] === 'done';
  const nextIndex = skipToReview ? 2 : project.stepIndex + 1;
  const next = PROJECT_STEPS[nextIndex];
  // Màn ngoài bước: quay lại bước đầu tiên chưa xong (hết bước thì về bước cuối).
  const firstOpen = PROJECT_STEPS.findIndex((_, index) => project.stepStates?.[index] !== 'done');
  const resumeIndex = firstOpen === -1 ? PROJECT_STEPS.length - 1 : firstOpen;

  // Màn Tải bản vẽ tự có nút chính "Bắt đầu xử lý": nút đi tiếp của thanh bước luôn kiểu phụ (A2 #4).
  const nextClass = cn(getButtonStyles({ variant: skipToReview || (currentDone && project.stepIndex !== 0) ? 'primary' : 'secondary', size: 'sm' }), 'shrink-0 gap-2 whitespace-nowrap');

  return (
    <nav aria-label="Các bước của dự án" className="flex h-10 items-center gap-3 border-t border-border-default px-4 sm:px-6">
      <ol className="flex min-w-0 flex-1 items-center gap-1 overflow-x-auto">
        {PROJECT_STEPS.map((step, index) => {
          const isCurrent = index === project.stepIndex;
          const state = project.stepStates?.[index] ?? 'todo';
          return (
            <li key={step.id} className="flex shrink-0 items-center gap-1">
              {index > 0 && <ChevronRight size={14} aria-hidden="true" className="text-text-muted" />}
              <Link
                to={stepPath(project, index)}
                aria-current={isCurrent ? 'step' : undefined}
                aria-label={`Bước ${index + 1}: ${step.label}, ${stepStateText(state, index, project.stepIndex)}`}
                title={step.label}
                className={cn(
                  'flex h-7 items-center gap-2 rounded-md px-2 text-[13px] transition-colors duration-fast coarse:min-h-11 coarse:min-w-11',
                  FOCUS_RING,
                  isCurrent ? 'bg-accent-wash font-semibold text-accent' : 'text-text-secondary hover:bg-bg-sunken hover:text-text-primary',
                )}
              >
                <StepMarker index={index} isCurrent={isCurrent} state={state} />
                {/* Dưới 1280 hiện chữ cho bước đang đứng và bước kế tiếp; bước khác còn số, tên nằm ở aria-label/title (UX-33, #25). */}
                <span className={cn('whitespace-nowrap', !isCurrent && index !== nextIndex && 'hidden xl:inline')}>{step.label}</span>
              </Link>
            </li>
          );
        })}
      </ol>
      <div ref={setFlowGateSlot} className="contents" />
      {gateOwned ? null : project.stepIndex >= 0 && project.blocker === 'no-drawings' ? (
        project.stepIndex === 0 ? (
          <span className="shrink-0 text-[13px] text-text-secondary">Tải bản vẽ lên để đi tiếp</span>
        ) : (
          <Link to={ROUTES.project.upload(project.id)} className={cn(getButtonStyles({ variant: 'primary', size: 'sm' }), 'shrink-0 gap-2')}>
            Tải bản vẽ để bắt đầu
            <ArrowRight size={16} aria-hidden="true" />
          </Link>
        )
      ) : project.stepIndex >= 0 && project.blocker === 'processing' ? (
        <span className="shrink-0 text-[13px] text-text-secondary">Đang xử lý bản vẽ: chờ xong rồi đi tiếp</span>
      ) : project.stepIndex === 1 && project.blocker === 'pipeline-error' ? (
        <span className="shrink-0 text-[13px] text-text-secondary">Xử lý gặp lỗi: xem chi tiết bên dưới trước khi đi tiếp</span>
      ) : project.stepIndex === -1 ? (
        <Link to={stepPath(project, resumeIndex)} className={cn(getButtonStyles({ variant: 'secondary', size: 'sm' }), 'shrink-0 gap-2 whitespace-nowrap')}>
          Tiếp tục: {PROJECT_STEPS[resumeIndex]?.label}
          <ArrowRight size={16} aria-hidden="true" />
        </Link>
      ) : onPipelineScreen ? null : (
        next !== undefined && (
          <Link to={skipToReview ? stepPath(project, nextIndex) : next.path(project.id)} className={nextClass}>
            Tiếp: {next.label}
            <ArrowRight size={16} aria-hidden="true" />
          </Link>
        )
      )}
    </nav>
  );
}

export function AppHeader({ accountInitials, accountLabel, showAdmin, notificationBell, project, returnProject, onSignOut }: AppHeaderProps) {
  const adminActive = useMatch('/admin/*') !== null;
  const location = useLocation();
  const [confirmOut, setConfirmOut] = useState(false);
  return (
    <header className="shrink-0 border-b border-border-default bg-bg-surface">
      <div className="flex h-12 items-center gap-x-4 px-4 sm:px-6">
        <Link to={ROUTES.dashboard} className={cn('flex shrink-0 items-center gap-2 rounded-md text-text-primary', HIT, FOCUS_RING)}>
          <BrandMark size={22} />
          <span className="text-[15px] font-semibold">AppFront</span>
        </Link>

        <nav aria-label="Điều hướng chính" className="flex items-center gap-1">
          <NavLink to={ROUTES.dashboard} end className={navLinkClass}>
            Dự án
          </NavLink>
          {showAdmin && (
            /* Sáng trên mọi màn `/admin/*`, không chỉ màn người dùng mà link trỏ tới. */
            <Link to={ROUTES.adminUsers} aria-current={adminActive ? 'page' : undefined} className={navLinkClass({ isActive: adminActive })}>
              Quản trị
            </Link>
          )}
        </nav>
        {adminActive && returnProject != null && (
          <Link
            to={ROUTES.project.floors(returnProject.id)}
            className="flex min-w-0 items-center gap-1 truncate rounded-md px-2 text-[13px] text-text-secondary hover:bg-bg-sunken hover:text-text-primary"
          >
            <ArrowLeft size={14} aria-hidden="true" className="shrink-0" />
            <span className="truncate">Về dự án {returnProject.name}</span>
          </Link>
        )}

        {project !== null && (
          // Nav của dự án nằm trong menu tên dự án, không cùng hàng với nav toàn cục (aesthetic 2.1 #1).
          // ponytail: <details> gốc, không đóng khi bấm ra ngoài; cần thì đổi sang Popover.
          <details
            key={location.pathname}
            className="relative min-w-0 border-l border-border-default pl-4"
            // A12: Esc đóng lớp trên cùng — menu đang mở thì Esc đóng nó và trả tiêu điểm về nút.
            onKeyDown={(event) => {
              if (event.key !== 'Escape' || !event.currentTarget.open) return;
              event.currentTarget.open = false;
              event.currentTarget.querySelector('summary')?.focus();
            }}
          >
            <summary
              aria-label={project.name === null ? 'Màn khác của dự án' : `${project.name}: màn khác của dự án`}
              className="flex h-8 min-w-0 cursor-pointer list-none items-center gap-1 rounded-md px-2 text-[13px] hover:bg-bg-sunken [&::-webkit-details-marker]:hidden"
            >
              {project.name === null ? (
                <Skeleton preset="block" className="h-4 w-32" aria-label="Đang tải tên dự án" />
              ) : (
                <span className="truncate font-medium text-text-primary" title={project.name}>{project.name}</span>
              )}
              <ChevronDown size={14} aria-hidden="true" className="shrink-0 text-text-muted" />
            </summary>
            <div className="absolute left-4 top-full z-30 mt-1 min-w-[200px] rounded-md border border-border-default bg-bg-surface p-1 shadow-float">
              <ProjectNav projectId={project.id} pathname={location.pathname} search={location.search} />
            </div>
          </details>
        )}
        {project !== null && (
          // UX-44: lối mời người cùng làm thấy ngay, không giấu trong menu tên dự án (cùng đích với ProjectNav).
          // ponytail: hiện cho mọi vai; header không biết vai trong dự án, tab Thành viên tự chặn người không có quyền sửa.
          <Link
            to={`${ROUTES.project.settings(project.id)}?tab=members`}
            className={cn('flex h-8 shrink-0 items-center gap-1 whitespace-nowrap rounded-md px-2 text-[13px] text-text-secondary hover:bg-bg-sunken hover:text-text-primary coarse:min-h-11', FOCUS_RING)}
          >
            <Users size={14} aria-hidden="true" />
            Thành viên
          </Link>
        )}

        <div className="ml-auto flex shrink-0 items-center gap-2">
          {notificationBell}
          <Link to={ROUTES.account} aria-label="Tài khoản của bạn" title={accountLabel} className={cn('flex items-center justify-center rounded-full', HIT, FOCUS_RING)}>
            <Avatar alt="" {...(accountInitials ? { initials: accountInitials } : {})} />
          </Link>
          <button
            type="button"
            onClick={() => setConfirmOut(true)}
            aria-label="Đăng xuất"
            title="Đăng xuất"
            className={cn('flex h-8 w-8 items-center justify-center rounded-md text-text-secondary hover:bg-bg-sunken hover:text-text-primary', HIT, FOCUS_RING)}
          >
            <LogOut size={16} aria-hidden="true" />
          </button>
        </div>
      </div>
      {project !== null && <ProjectStepBar project={project} />}
      <SignOutConfirm isOpen={confirmOut} onClose={() => setConfirmOut(false)} onSignOut={onSignOut} />
    </header>
  );
}
