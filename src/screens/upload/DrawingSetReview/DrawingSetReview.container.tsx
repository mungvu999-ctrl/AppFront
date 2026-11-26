/**
 * Route `ROUTE_PATTERNS.projectDrawingSets` (`/projects/:projectId/drawing-sets/:setId?`), nối hook với view.
 *
 * Hai lớp, cùng khuôn `FloorUploadScreen.container.tsx`:
 *
 * - {@link DrawingSetContainer} nhận đủ mọi thứ qua props và KHÔNG gọi `useNavigate` / `useParams`,
 *   nên test và story mở nó bằng một dòng với cổng giả (R-73).
 * - {@link DrawingSetRoute} là nơi duy nhất biết tới router và phiên (vai).
 *
 * Mỗi pha dùng hook của riêng nó trong một thành phần con (`PickStep`, `ReviewStep`) để hook chỉ chạy khi
 * pha ấy đang hiện — pha công tắc tắt không dựng hook tải nào.
 */

import { useMemo } from 'react';
import { useNavigate, useParams } from 'react-router-dom';

import type { DrawingSet } from '@/api/schemas/drawingSet';
import { EmptyState } from '@/components/feedback/EmptyState';
import { InlineAlert } from '@/components/feedback/InlineAlert';
import { ScreenErrorBoundary, type ScreenErrorFallback } from '@/components/feedback/ScreenErrorBoundary';
import { Breadcrumb } from '@/components/shell/Breadcrumb';
import { PageHead } from '@/components/shell/PageHead';
import { useSession } from '@/hooks/useSession';
import { formatCalendarDate } from '@/lib/format/datetime';
import { confirmedLines } from '@/lib/viewmodel/drawingSetReview';
import { houseBlockOf, houseLevelNames } from '@/lib/viewmodel/setBuilding';
import { ROUTES } from '@/routes/paths';
import type { ProjectRole } from '@/types/project';

import { DrawingSetPickView, type RecentSetVm } from './DrawingSetPickView';
import { DrawingSetReviewView } from './DrawingSetReviewView';
import {
  DrawingSetAnalyzing,
  DrawingSetBlocked,
  DrawingSetConfirmed,
  DrawingSetEnded,
  DrawingSetLoadError,
  DrawingSetLoading,
} from './DrawingSetStatusViews';
import { useHouseBlock } from './HouseBlock/useHouseBlock';
import { createAppDrawingSetGateway, type DrawingSetGateway } from './drawingSetGateway';
import { DISABLED_SENTENCE, rejectedFileSentence } from './drawingSetText';
import { useDrawingSetFlow, type RecentSet, type UseDrawingSetFlowResult } from './useDrawingSetFlow';
import { useDrawingSetPick } from './useDrawingSetPick';
import { useDrawingSetReview } from './useDrawingSetReview';

export const DRAWING_SET_SCREEN_ID = 'drawing-set';

const TITLE = 'Tải cả bộ hồ sơ';
const FORBIDDEN_SENTENCE = 'Vai của bạn không tải được bản vẽ. Nhờ quản trị viên hoặc kỹ sư của dự án tải bộ hồ sơ.';
const MISSING_PROJECT_MESSAGE = 'Đường dẫn thiếu mã dự án, nên không biết phải mở bộ hồ sơ của dự án nào.';

export interface DrawingSetContainerProps {
  readonly projectId: string;
  readonly setId?: string | undefined;
  readonly roles?: readonly ProjectRole[];
  readonly onNavigate?: (path: string) => void;
  /** Seam dữ liệu. Mặc định là cổng chạy trên client thật của ứng dụng. */
  readonly gateway?: DrawingSetGateway;
  /** Chu kỳ thăm dò và độ trễ tự lưu tiêm được, để test không ngủ thật. */
  readonly pollMs?: number;
  readonly saveDelayMs?: number;
}

function DrawingSetCrashFallback({ report, retry }: ScreenErrorFallback) {
  return (
    <div className="absolute inset-0 flex items-center justify-center bg-bg-app">
      <EmptyState
        description={report.description.description}
        icon={<div aria-hidden="true" className="h-8 w-8 rounded-full bg-state-violation-tint" />}
        title={report.description.title}
        {...(report.retryable ? { action: { label: report.description.primaryButtonLabel, onClick: retry } } : {})}
      />
    </div>
  );
}

const recentLabel = (item: RecentSet): string => {
  const name = item.name ?? `Bộ hồ sơ ngày ${formatCalendarDate(new Date(item.createdAt))}`;

  return `${name} · ${item.status === 'analyzing' ? 'máy đang đọc' : 'đang duyệt'}`;
};

function PickStep({ flow, gateway, projectId }: { flow: UseDrawingSetFlowResult; gateway: DrawingSetGateway; projectId: string }) {
  const pick = useDrawingSetPick({ gateway, projectId, onUploaded: flow.onUploaded, onDisabled: flow.onDisabled });
  const recent = useMemo<RecentSetVm[]>(() => flow.recentSets.map((item) => ({ id: item.id, label: recentLabel(item) })), [flow.recentSets]);

  return <DrawingSetPickView onOpenSet={flow.openSet} pick={pick} recentSets={recent} />;
}

function ReviewStep({ flow, gateway, projectId }: { flow: UseDrawingSetFlowResult; gateway: DrawingSetGateway; projectId: string }) {
  const { set } = flow;

  if (set === null) return null;

  return <ReviewStepBody flow={flow} gateway={gateway} key={`${set.id}:${String(flow.reloadCount)}`} projectId={projectId} set={set} />;
}

interface ReviewStepBodyProps {
  readonly flow: UseDrawingSetFlowResult;
  readonly gateway: DrawingSetGateway;
  readonly projectId: string;
  readonly set: DrawingSet;
}

function ReviewStepBody({ flow, gateway, projectId, set }: ReviewStepBodyProps) {
  const review = useDrawingSetReview({
    projectId,
    set,
    gateway,
    onConfirmed: flow.onConfirmed,
    onRemoved: flow.onRemoved,
    onStale: flow.onStale,
    onDisabled: flow.onDisabled,
  });
  const fileNames = useMemo(() => new Map(set.files.map((file) => [file.id, file.fileName] as const)), [set.files]);
  const house = useHouseBlock({ sets: gateway.sets, projectId, setId: set.id, revision: review.revision });
  const houseVm = useMemo(
    () => (house.state.status === 'ready' ? houseBlockOf(house.state.proposal, houseLevelNames(review.drafts, review.floors ?? [])) : null),
    [house.state, review.drafts, review.floors],
  );
  const rejected = set.files.flatMap((file) => (file.status === 'rejected' ? [rejectedFileSentence(file.fileName, file.rejectedCode)] : []));

  return (
    <DrawingSetReviewView
      actions={review.actions}
      check={review.check}
      dialog={review.dialog}
      drafts={review.drafts}
      fileNames={fileNames}
      floors={review.floors}
      floorsError={review.floorsError}
      house={{
        status: house.state.status,
        vm: houseVm,
        isRefreshing: house.state.status === 'ready' && house.state.isRefreshing,
        onRetry: house.retry,
      }}
      notice={flow.notice}
      onRetryFloors={review.retryFloors}
      onRetrySave={review.retrySave}
      rejectedFiles={rejected}
      saveSentence={review.saveSentence}
      saveState={review.saveState}
      nameField={review.nameField}
      titleBlock={set.titleBlock}
    />
  );
}

function DrawingSetBody({ flow, gateway, navigate, projectId }: { flow: UseDrawingSetFlowResult; gateway: DrawingSetGateway; navigate: (path: string) => void; projectId: string }) {
  const toFloors = (): void => {
    navigate(ROUTES.project.floors(projectId));
  };
  const { set } = flow;

  switch (flow.phase) {
    case 'loading':
      return <DrawingSetLoading />;
    case 'disabled':
      return <DrawingSetBlocked backLabel="Về Duyệt tầng" message={flow.errorSentence ?? DISABLED_SENTENCE} onBack={toFloors} title={TITLE} />;
    case 'forbidden':
      return <DrawingSetBlocked backLabel="Về Duyệt tầng" message={FORBIDDEN_SENTENCE} onBack={toFloors} title={TITLE} />;
    case 'loadError':
      return <DrawingSetLoadError message={flow.errorSentence ?? ''} onRetry={flow.retry} />;
    case 'pick':
      return <PickStep flow={flow} gateway={gateway} projectId={projectId} />;
    case 'analyzing':
      return <DrawingSetAnalyzing onBack={flow.backToPick} percent={set?.progressPercent ?? 0} />;
    case 'review':
      return <ReviewStep flow={flow} gateway={gateway} projectId={projectId} />;
    case 'confirmed':
      return (
        <DrawingSetConfirmed
          lines={confirmedLines(set?.views ?? [])}
          onOpenFloors={toFloors}
          onOpenPipeline={() => {
            navigate(ROUTES.project.pipeline(projectId));
          }}
        />
      );
    case 'failed':
      return (
        <DrawingSetEnded
          level="violation"
          message={
            set?.errorCode === 'DRAWING_SET_ALL_FILES_REJECTED'
              ? 'Máy không nhận tệp nào của bộ này. Kiểm tra lại các tệp rồi tải bộ khác.'
              : 'Máy chưa đọc xong bộ hồ sơ này. Thử tải lại bộ.'
          }
          primary={{ label: 'Tải bộ khác', onClick: flow.backToPick }}
          title="Bộ hồ sơ chưa dùng được"
        />
      );
    case 'receiving':
      return (
        <DrawingSetEnded
          level="attention"
          message="Bộ này tải chưa xong nên máy chưa đọc. Bỏ bộ này rồi tải lại."
          primary={{ label: 'Bỏ bộ này và tải lại', onClick: flow.removeReceiving }}
          title="Bộ hồ sơ tải dở"
        />
      );
  }
}

function WiredDrawingSet(props: DrawingSetContainerProps) {
  const fallbackGateway = useMemo(() => createAppDrawingSetGateway(), []);
  const gateway = props.gateway ?? fallbackGateway;
  const navigate = props.onNavigate ?? ((): void => undefined);
  const flow = useDrawingSetFlow({
    projectId: props.projectId,
    setId: props.setId,
    gateway,
    onNavigate: navigate,
    ...(props.roles !== undefined ? { roles: props.roles } : {}),
    ...(props.pollMs !== undefined ? { pollMs: props.pollMs } : {}),
  });

  return (
    <div className="mx-auto flex w-full max-w-[1280px] flex-col gap-4 px-8 pb-8 pt-8">
      <Breadcrumb
        items={[
          { id: 'projects', label: 'Dự án', onClick: () => navigate(ROUTES.dashboard) },
          { id: 'floors', label: 'Duyệt tầng', onClick: () => navigate(ROUTES.project.floors(props.projectId)) },
          { id: 'drawing-sets', label: TITLE },
        ]}
      />
      <PageHead className="mb-0" eyebrow={TITLE} title="Tải cả bộ hồ sơ bản vẽ" />
      <DrawingSetBody flow={flow} gateway={gateway} navigate={navigate} projectId={props.projectId} />
    </div>
  );
}

/** `<DrawingSetContainer projectId={...} />` — màn tải cả bộ hồ sơ thật, đã nối. */
export function DrawingSetContainer(props: DrawingSetContainerProps) {
  return (
    <ScreenErrorBoundary
      key={`${props.projectId}:${props.setId ?? ''}`}
      renderFallback={({ report, retry }) => <DrawingSetCrashFallback report={report} retry={retry} />}
      screenId={DRAWING_SET_SCREEN_ID}
    >
      <WiredDrawingSet {...props} />
    </ScreenErrorBoundary>
  );
}

/** Route thật, đăng ký ở `src/routes/router.tsx`. */
export function DrawingSetRoute() {
  const { projectId, setId } = useParams<{ projectId: string; setId?: string }>();
  const session = useSession();
  const navigate = useNavigate();

  if (projectId === undefined || projectId.length === 0) {
    return (
      <div className="p-6">
        <InlineAlert level="violation" message={MISSING_PROJECT_MESSAGE} title="Không xác định được dự án" />
      </div>
    );
  }

  return (
    <DrawingSetContainer
      onNavigate={(path) => {
        void navigate(path);
      }}
      projectId={projectId}
      roles={session.roles}
      setId={setId}
    />
  );
}
