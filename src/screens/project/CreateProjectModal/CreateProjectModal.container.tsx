/**
 * "Tạo dự án mới", wired to the real API client and the query cache.
 *
 * The thinnest layer over {@link CreateProjectModal}, the same shape as
 * `src/screens/auth/AuthScreen/AuthScreen.container.tsx`: it builds the
 * gateway the hook is injected with, wraps the dialog in a
 * {@link ScreenErrorBoundary} so a crash never takes the page with it (A11),
 * and hands `isOpen`/`onDismiss`/`onCreated`/`onToast` straight through from
 * whoever mounts it — this container does not decide when the dialog opens.
 *
 * ## Why `onToast` is a prop here too, not `useToast()`
 *
 * `Toast.Provider` is mounted inside `ProjectDashboard`
 * (`src/screens/dashboard/ProjectDashboard/ProjectDashboard.tsx`), not here.
 * Calling `useToast()` from this file would throw the moment this dialog is
 * mounted anywhere that provider is not already an ancestor. The caller that
 * eventually renders `<CreateProjectModalContainer>` inside `ProjectDashboard`
 * passes its own `addToast` through; this file never assumes one exists.
 *
 * ## Why not `createOptimisticMutation`
 *
 * This dialog closes the moment a project is created, so there is nothing left
 * on screen for `applyOptimistic`/`rollback` to touch — both would be no-ops.
 * The helper also demands an `entityId` before one exists (a project has no id
 * until the server assigns one) and all six of its config keys, and it needs a
 * `QueryClient` passed into the *hook*, which `useCreateProjectModal.ts` is
 * built specifically not to depend on. A plain gateway call plus
 * `applyInvalidation` on success (D-03) is the honest shape for a create — and
 * for the undo's delete, which invalidates the same N1 list (BUG-112).
 */

import { useMemo } from 'react';
import { useQueryClient, type QueryClient } from '@tanstack/react-query';

import { createAppApiClient } from '@/api/appClient';
import { PROJECT_BUILDING_TYPES } from '@/api/schemas/projectSettings';
import type { ApiClient, Floor } from '@/api/client';
import { EmptyState } from '@/components/feedback/EmptyState';
import { ScreenErrorBoundary, type ScreenErrorFallback } from '@/components/feedback/ScreenErrorBoundary';
import { createUuid } from '@/lib/http/ids';
import { applyInvalidation } from '@/lib/query/invalidation';
import { queryKeys } from '@/lib/query/queryKeys';
import type { ProjectRole } from '@/types/project';

import { CreateProjectModal } from './CreateProjectModal';
import type { CreateProjectGateway, CreateProjectRequest } from './useCreateProjectModal';

/** Names this screen to the error boundary, and to anything reading its report. */
const SCREEN_ID = 'create-project';


/**
 * `CreateProjectRequest` → `ProjectWriteBody`.
 *
 * `buildingType` and `notes` are not project fields: they go through the
 * settings write (`saveStartSettings`) after the project exists.
 */
function toProjectWriteBody(request: CreateProjectRequest) {
  const floors: Floor[] = request.floors.map((floor, index) => ({
    id: createUuid(),
    name: floor.name,
    elevationMm: floor.floorElevationMm,
    heightMm: floor.clearHeightMm,
    order: index,
    drawings: [],
  }));

  return {
    name: request.name,
    status: 'draft' as const, // A5: automation never sets 'approved' — that marker is a person's alone.
    floors,
    ...(request.address !== '' ? { address: request.address } : {}),
    ...(request.code !== '' ? { code: request.code } : {}),
  };
}

/** Mặc định của BE; chọn đúng giá trị này và không ghi chú thì không có gì để gửi. */
const DEFAULT_BUILDING_TYPE = 'residential';

/**
 * Gửi "Loại công trình" và "Ghi chú" qua N5/N6 (PUT thay cả thân, nên đọc trước để giữ phần còn lại).
 * Chỉ gửi khi người dùng đã điền; trả `false` nếu hỏng — dự án đã tạo rồi, không được coi là lỗi tạo.
 */
async function saveStartSettings(client: ApiClient, projectId: string, request: CreateProjectRequest): Promise<boolean> {
  const buildingType = PROJECT_BUILDING_TYPES.find((value) => value === request.buildingType);
  const hasType = buildingType !== undefined && buildingType !== DEFAULT_BUILDING_TYPE;
  const hasNotes = request.notes !== '';

  if (!hasType && !hasNotes) {
    return true;
  }

  try {
    const current = await client.projectSettings.read({ projectId });

    if (!current.ok) {
      return false;
    }

    const { revision, ...settings } = current.data;
    const saved = await client.projectSettings.replace({
      projectId,
      baseVersion: revision,
      body: {
        ...settings,
        ...(hasType ? { buildingType } : {}),
        ...(hasNotes ? { notes: request.notes } : {}),
      },
    });

    return saved.ok;
  } catch {
    return false;
  }
}

/**
 * Exported so a test can wire this exact mapping to `createMockApiClient()`
 * (`src/api/__mocks__/client.ts`) instead of hand-rolling a second, competing
 * idea of what a gateway reply looks like — R-70.
 */
/* eslint-disable-next-line react-refresh/only-export-components -- named export
   sits beside the container it serves (mục D) rather than in a seventh file for
   one pure function; nothing here is a component, so Fast Refresh is unaffected. */
export function createProjectGateway(client: ApiClient, queryClient: QueryClient): CreateProjectGateway {
  return {
    create: async (request) => {
      const result = await client.projects.create({
        body: toProjectWriteBody(request),
        idempotencyKey: createUuid(),
      });

      if (!result.ok) {
        return result;
      }

      applyInvalidation(queryClient, 'createProject', {});
      // G3-01/G1-32: chờ danh sách dự án tải lại rồi mới báo "Đã tạo", để thẻ mới đã có khi toast hiện.
      // Chỉ chờ đúng hai khoá danh sách; `cancelRefetch: false` dùng lại lượt tải mà invalidate vừa mở.
      // refetchQueries mặc định không ném lỗi nên lỗi tải lại không chặn lượt tạo.
      await Promise.all(
        [queryKeys.project.list(), queryKeys.project.summaries()].map((queryKey) =>
          queryClient.refetchQueries({ queryKey, type: 'active' }, { cancelRefetch: false }),
        ),
      );

      const settingsSaved = await saveStartSettings(client, result.data.id, request);

      return { ok: true, data: { id: result.data.id, ...(settingsSaved ? {} : { settingsSaved: false }) } };
    },
    remove: async (projectId) => {
      // Huỷ tạo, không phải #27: Kỹ sư không có quyền xoá dự án nhưng được huỷ dự án mình vừa tạo.
      const result = await client.projects.cancelCreate({ projectId });

      // `projects.delete` answers with the deleted `Project`, not `void`; the
      // undo ticket this backs (A8) only ever needs to know it worked.
      if (!result.ok) {
        return result;
      }

      // BUG-112: the card the create put on the dashboard (N1) goes with the project.
      applyInvalidation(queryClient, 'deleteProject', { projectId });

      return { ok: true, data: undefined };
    },
  };
}

function useCreateProjectGateway(): CreateProjectGateway {
  const queryClient = useQueryClient();
  const client = useMemo(() => createAppApiClient(), []);

  return useMemo(() => createProjectGateway(client, queryClient), [client, queryClient]);
}

/**
 * Thứ người dùng thấy thay cho hộp thoại đã sập.
 *
 * Cùng khuôn với `AuthScreen.container.tsx`'s `AuthCrashFallback`: chữ lấy
 * thẳng từ `report.description`, nút "thử lại" chỉ hiện khi lỗi thuộc loại
 * đáng thử lại.
 */
function CreateProjectCrashFallback({ report, retry }: ScreenErrorFallback) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-bg-overlay">
      <div className="w-[480px] max-w-full rounded-2xl bg-bg-surface p-6 shadow-modal">
        <EmptyState
          icon={<div className="h-8 w-8 rounded-full bg-state-violation-tint" aria-hidden="true" />}
          title={report.description.title}
          description={report.description.description}
          {...(report.retryable
            ? { action: { label: report.description.primaryButtonLabel, onClick: retry } }
            : {})}
        />
      </div>
    </div>
  );
}

export interface CreateProjectModalContainerProps {
  readonly isOpen: boolean;
  readonly onDismiss: () => void;
  readonly onCreated?: (projectId: string) => void;
  /** Invariant A8's undoable toast. Injected by whoever already mounts `Toast.Provider`. */
  readonly onToast?: (toast: { readonly message: string; readonly onUndo?: () => void }) => void;
  readonly role?: ProjectRole;
  /** Overrides the viewport probe — for a story or a test that wants a fixed answer. */
  readonly forceCompact?: boolean;
}

/** `<CreateProjectModalContainer>` — the real dialog, wired. */
export function CreateProjectModalContainer(props: CreateProjectModalContainerProps) {
  const gateway = useCreateProjectGateway();

  return (
    <ScreenErrorBoundary
      screenId={SCREEN_ID}
      renderFallback={({ report, retry }) => <CreateProjectCrashFallback report={report} retry={retry} />}
    >
      <CreateProjectModal
        gateway={gateway}
        isOpen={props.isOpen}
        // Căn hộ một tầng là phổ biến nhất: bắt đầu với một tầng, thêm bằng "Thêm tầng" (U40).
        initialFloorCount={1}
        // Chung cư thường cao 3,0 m sàn–sàn: điền sẵn, vẫn sửa được (UX-20).
        initialFloorHeightM={3}
        onDismiss={props.onDismiss}
        {...(props.onCreated !== undefined ? { onCreated: props.onCreated } : {})}
        {...(props.onToast !== undefined ? { onToast: props.onToast } : {})}
        {...(props.role !== undefined ? { role: props.role } : {})}
        {...(props.forceCompact !== undefined ? { forceCompact: props.forceCompact } : {})}
      />
    </ScreenErrorBoundary>
  );
}
