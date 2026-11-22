/**
 * Nửa "suy nghĩ" của màn S-11 "Một bước AI hỏng" — mọi thứ `PipelineFailure.tsx`
 * cần, đã xong.
 *
 * `types.ts` là hợp đồng props DUY NHẤT của màn và nó ĐÃ ĐÓNG BĂNG; hook này trả
 * về đúng {@link PipelineFailureProps}, không hơn không kém. Mọi chuỗi người đọc
 * được ghép và định dạng ở `pipelineFailureText.ts` (A15) — view không còn con số
 * thô nào phải làm tròn, không đếm giờ, không so một con số với một hằng số.
 *
 * ## Cái ô đổi nội dung TẠI CHỖ, không đổi trang
 *
 * Màn này không có route. Nó là một dải trong khung của màn S-10, và
 * {@link PipelineFailureBand} là cái ô ấy: `alert` khi đang báo lỗi, `retrying`
 * khi lượt chạy lại đang chạy (dải cảnh báo được THAY bằng `PipelineStepper`, cùng
 * chỗ, không mở lớp mới), `resolved` khi xong, `idle` khi chưa có gì hỏng. Dải
 * tầng và khối "Kết quả đã có" nằm NGOÀI band, nên bấm thử lại không làm tiến độ
 * đã có biến mất khỏi màn.
 *
 * ## Trạng thái máy chủ (R-64)
 *
 * Không `useState` nào giữ cờ đang-tải hay cờ hỏng. Hai lượt đọc đi qua
 * `useQuery` dưới khoá của `queryKeys.progress` (tier `aiProgress`,
 * `cachePolicy.ts:52-56`), lượt ghi đi qua `createOptimisticMutation` của
 * `src/lib/mutations`. `useShareLinks.ts` tự viết tay hai cờ đó — đó là ngoại lệ
 * đi trước, không phải khuôn mẫu. `useState` ở đây chỉ giữ trạng thái của riêng
 * giao diện: khối gấp đang mở, dải đang thu gọn, nhãn "Đã sao chép" đang hiện, và
 * số lần chính phiên này đã bấm thử lại.
 *
 * Một chỗ KHÔNG dùng được `applyInvalidation`: `invalidationMap`
 * (`src/lib/query/invalidation.ts`) chưa có `WriteOperation` nào cho việc chạy lại
 * một bước, và thêm một mục vào bảng đó là sửa `src/lib/**` — ngoài phạm vi của
 * lượt này. Nên lượt ghi làm mất hiệu lực đúng MỘT khoá, lấy từ `queryKeys`, chứ
 * không gọi `invalidateQueries` trần (thứ `applyInvalidation` tồn tại để chặn).
 *
 * ## Không công thức tự chế (R-61)
 *
 * - Tên sáu bước: `getPipelineStages()` — nó đọc `src/i18n/vi.json` khoá
 *   `pipeline`. Không gõ tay, không dịch lại.
 * - Gộp kết quả lượt chạy lại vào trạng thái đang có: `mergeEvents`
 *   (`src/lib/realtime/mergeEvents.ts` — T-07, CÓ THẬT). Nó khử trùng lặp theo
 *   `eventId` và bỏ sự kiện cũ theo `sequence`, nên một phản hồi về hai lần hoặc
 *   về muộn không đè lên trạng thái mới hơn.
 * - Mã lỗi và **mã yêu cầu**: `toAppError(...).code` / `.requestId`
 *   (`toAppError.ts:71-82`). Không chuỗi nào được gõ tay.
 * - Giờ của một dòng nhật ký: `formatClockTime` của `src/lib/format/datetime`.
 * - Số: `formatNumber`, gọi trong `pipelineFailureText.ts`.
 *
 * ## Khả năng chưa có endpoint — nhánh giao diện THẬT, không phải im lặng
 *
 * `pipelineFailureGateway.ts` khai bốn khả năng chưa nối được (`retryStep`,
 * `stepFailureDetail`, `technicalLog`, `skipFloor`). Hook đọc `gateway.supports`
 * và nói ra sự thật đó bằng chính giao diện:
 *
 * - `retryStep` chưa có → bộ đếm lần thử đi thẳng sang chế độ `'support'` với câu
 *   `supportRetryUnsupported`, kèm nút chép toàn bộ nhật ký và liên kết hỗ trợ.
 * - `skipFloor` chưa có → câu cảnh báo của hướng "Bỏ qua tầng đó" nói thêm rằng
 *   hướng này chưa dùng được, TRƯỚC khi người dùng bấm.
 * - `stepFailureDetail` chưa có → khối lỗi nói "chưa đọc được chi tiết bước hỏng"
 *   thay vì bịa ra một nguyên nhân.
 * - `technicalLog` chưa có → khối gấp còn nguyên, bên trong là đúng một dòng nói
 *   máy chủ chưa trả nhật ký. Không mảng rỗng giả vờ là "không có lỗi nào".
 *
 * Ba hướng đi tiếp vẫn còn đủ ở mọi nhánh trừ `forbidden` — kiểu
 * {@link PipelineFailureNextSteps} không nhận nổi một mảng ít hơn hai phần tử.
 *
 * ## A5
 *
 * Khối "Kết quả đã có" là đầu ra AI chưa ai duyệt, nên nó không mang trường màu
 * nào và hook không tìm cách thêm lại. Xanh "đã xác minh" chỉ đánh dấu việc người
 * duyệt.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import type { PipelineStepData } from '@/components/feedback/PipelineStepper';
import { useReducedMotion } from '@/hooks/useReducedMotion';
import { AUTH_ROLES, can } from '@/lib/auth/permissions';
import { formatClockTime } from '@/lib/format/datetime';
import { createOptimisticMutation } from '@/lib/mutations/createOptimisticMutation';
import { queryKeys } from '@/lib/query/queryKeys';
import type { QueryKey } from '@/lib/query/queryKeys';
import { mergeEvents } from '@/lib/realtime/mergeEvents';
import { getPipelineStages } from '@/lib/realtime/pipeline';
import { ROUTES } from '@/routes/paths';
import type { ProjectRole } from '@/types/project';

import { describePipelineError } from '../pipelineErrorText';

import {
  createAppPipelineFailureGateway,
  type PipelineFailureDetail,
  type PipelineFailureGateway,
  type PipelineFailureRawFloor,
  type PipelineFailureRawLogLine,
  type PipelineFailureRawStep,
  type PipelineFailureRetryOutcome,
} from './pipelineFailureGateway';
import {
  attemptLabel,
  causeSentence,
  codeLabel,
  collapsedSummaryLine,
  detailUnsupportedSummary,
  keptItemLabel,
  PIPELINE_FAILURE_FLOOR_STATUS_LABELS,
  PIPELINE_FAILURE_TEXT,
  readingLiveMessage,
  resolvedToastMessage,
  retryingLiveMessage,
  retryStepAriaLabel,
  summarySentence,
} from './pipelineFailureText';
import type {
  PipelineFailureBand,
  PipelineFailureContainerProps,
  PipelineFailureCopyAction,
  PipelineFailureFloorViewModel,
  PipelineFailureKeptWork,
  PipelineFailureLogLine,
  PipelineFailureNextStep,
  PipelineFailureNextSteps,
  PipelineFailureProps,
  PipelineFailureReasonViewModel,
  PipelineFailureRetryNotice,
  PipelineFailureState,
  PipelineFailureTechnicalDetails,
} from './types';

/* -------------------------------------------------------------------------- */
/* Hằng số của riêng hook.                                                     */
/* -------------------------------------------------------------------------- */

/**
 * Từ lần thử THỨ BA trở đi, bộ đếm đổi sang chế độ gợi ý liên hệ hỗ trợ.
 *
 * Một hằng số ĐẶT TÊN, không phải con số `3` rải trong nhánh `if` (R-71): ngưỡng
 * này sống ở đúng một chỗ, và view không bao giờ nhìn thấy nó — nó chỉ đọc
 * `retryNotice.kind`.
 */
const RETRY_ATTEMPTS_BEFORE_SUPPORT = 3;

/**
 * Nhãn "Đã sao chép" giữ bao lâu trước khi trở lại "Sao chép".
 *
 * 700 ms — một trong đúng năm giá trị mục B cho phép, và cùng con số
 * `COPY_FLASH_MS` của `useShareLinks.ts:251` đã dùng cho đúng việc này. Nó là một
 * hằng số ĐẶT TÊN chứ không phải số viết thẳng vào `setTimeout`, vì
 * `local/no-raw-duration` bắt đúng hình dạng đó (`no-raw-duration.js:190-199`).
 */
const COPIED_LABEL_HOLD_MS = 700;

/** Thời lượng của hai chuyển động màn này có — 260 ms, khai bằng token chứ không bằng số. */
const MOTION_SLOT = 'standard' as const;

/** Vai trò mặc định khi nơi gọi không nói gì — cùng lựa chọn của `useProcessingScreen.ts`. */
const DEFAULT_ROLES: readonly ProjectRole[] = ['engineer'];

/**
 * Hợp đồng khai `roles` là `readonly string[]` (nó không được import
 * `src/types/**`), còn `can()` chỉ nhận `ProjectRole`. Lọc chứ không ép kiểu: một
 * chuỗi lạ trong phiên đăng nhập phải RỚT khỏi danh sách quyền, không được đi
 * tiếp dưới lớp sơn của một phép `as`.
 */
const KNOWN_ROLES: ReadonlySet<string> = new Set<string>(AUTH_ROLES);

const isProjectRole = (role: string): role is ProjectRole => KNOWN_ROLES.has(role);

const toProjectRoles = (roles: readonly string[] | undefined): readonly ProjectRole[] => {
  if (roles === undefined) {
    return DEFAULT_ROLES;
  }

  return roles.filter(isProjectRole);
};

const EMPTY_STEPS: readonly PipelineFailureRawStep[] = [];
const EMPTY_LOG: readonly PipelineFailureRawLogLine[] = [];

/** Chưa áp sự kiện nào — `mergeEvents` coi `-1` là "chưa có gì" (`mergeEvents.ts:31`). */
const NO_SEQUENCE_APPLIED = -1;

/* -------------------------------------------------------------------------- */
/* Hình dạng dữ liệu nằm trong bộ nhớ đệm.                                     */
/* -------------------------------------------------------------------------- */

/**
 * Một lượt xử lý đã hỏng, như bộ nhớ đệm của react-query giữ nó.
 *
 * `steps` tách khỏi `detail.steps` vì nó ĐỔI sau mỗi lượt chạy lại, còn phần còn
 * lại của `detail` thì không. `lastAppliedSequence` đi cùng để `mergeEvents` biết
 * phản hồi nào đã áp rồi.
 */
interface StepFailureSnapshot {
  /** `null` khi `stepFailureDetail` chưa có endpoint — xem `missing`. */
  readonly detail: PipelineFailureDetail | null;
  /** Câu "còn thiếu gì", lấy nguyên từ cổng. `null` khi lượt đọc có dữ liệu thật. */
  readonly missing: string | null;
  readonly steps: readonly PipelineFailureRawStep[];
  readonly lastAppliedSequence: number;
}

/* -------------------------------------------------------------------------- */
/* Tham số vào.                                                                */
/* -------------------------------------------------------------------------- */

/**
 * Props màn cha truyền vào, cộng hai chỗ tiêm của lớp này.
 *
 * `types.ts` đã đóng băng và cố ý KHÔNG khai prop cổng dữ liệu (nó chưa tồn tại ở
 * lớp L1). Cách mở rộng hợp lệ duy nhất là `extends` trong file của người viết
 * hook — đúng khuôn `UseScaleCalibrationHookOptions extends UseScaleCalibrationOptions`
 * — và đây là chỗ đó.
 */
export interface UsePipelineFailureOptions extends PipelineFailureContainerProps {
  /** Cổng dữ liệu tiêm được. Vắng mặt thì hook dựng cổng thật, đúng một lần. */
  readonly gateway?: PipelineFailureGateway;
  /** Ép dải thu gọn — cho story và test muốn một câu trả lời cố định. */
  readonly forceCollapsed?: boolean;
  /** `Progress.error` của lượt hỏng (mã máy chủ) — dùng khi chưa đọc được chi tiết. */
  readonly failureCode?: string;
  /** Tên tầng theo N7 — thay mã tầng ở nhãn tầng. */
  readonly failureFloorName?: string;
  /**
   * Các tầng màn Xử lý đã đọc — dải "Tiến độ theo tầng" khi chưa đọc được chi tiết (`stepFailureDetail`
   * chưa có endpoint), thay vì một danh sách rỗng (BUG-545).
   */
  readonly failureFloors?: readonly PipelineFailureRawFloor[];
}

/** Nhãn bước tải lên khi lượt hỏng do lỗi tạm: v1 chạy lượt mới bằng cách tải lại. */
const RERUN_BY_UPLOAD_LABEL = 'Tải lại bản vẽ để chạy lượt mới';

/* -------------------------------------------------------------------------- */
/* Phép ghép thuần — kiểm được mà không cần dựng hook.                          */
/* -------------------------------------------------------------------------- */

/** Nhãn tiếng Việt của một bước, tra từ `PIPELINE_STAGES`. Không tra được thì trả mã. */
function stepLabelOf(stepId: string): string {
  return getPipelineStages().find((stage) => stage.id === stepId)?.label ?? stepId;
}

/** Phần trăm của một bước. Xong là 100, còn lại là 0 — không bịa tiến độ. */
function stepPercentOf(status: PipelineFailureRawStep['status']): number {
  return status === 'done' ? 100 : 0;
}

/**
 * Trạng thái sáu bước → đúng hình dạng `PipelineStepper` nhận.
 *
 * Dựng thẳng `PipelineStepData` chứ không dựng một kiểu bước thứ hai rồi ánh xạ
 * qua lại — xem ghi chú "Hai kiểu mượn từ nơi khác" ở đầu `types.ts`.
 */
function toStepperSteps(
  steps: readonly PipelineFailureRawStep[],
  failedStepId: string,
  errorCode: string,
): readonly PipelineStepData[] {
  return steps.map((step) => ({
    id: step.stepId,
    name: stepLabelOf(step.stepId),
    status: step.status,
    progress: stepPercentOf(step.status),
    ...(step.stepId === failedStepId && step.status === 'failed' ? { errorCode } : {}),
  }));
}

/**
 * Gộp kết quả một lượt chạy lại vào trạng thái đang có, qua `mergeEvents` (T-07).
 *
 * Không tự viết phép gộp: `mergeEvents` đã khử trùng lặp theo `eventId`, bỏ sự
 * kiện có `sequence` không mới hơn, và không bao giờ để `lastAppliedSequence` lùi.
 * Đó đúng là ba tính chất cần ở đây, và chúng đã có test riêng
 * (`progressStream.test.ts:220-240`).
 */
function mergeRetryOutcome(
  snapshot: StepFailureSnapshot,
  outcome: PipelineFailureRetryOutcome,
): StepFailureSnapshot {
  const merged = mergeEvents<{ steps: readonly PipelineFailureRawStep[] }>({
    current: { steps: snapshot.steps },
    incoming: [
      {
        eventId: `${outcome.stepId}:${outcome.sequence}`,
        patch: { steps: outcome.steps },
        sequence: outcome.sequence,
      },
    ],
    lastAppliedSequence: snapshot.lastAppliedSequence,
  });

  // Không sự kiện nào được áp (phản hồi tới hai lần, hoặc tới muộn): giữ nguyên.
  if (merged.events.length === 0) {
    return snapshot;
  }

  return {
    ...snapshot,
    steps: merged.current.steps ?? snapshot.steps,
    lastAppliedSequence: merged.lastAppliedSequence,
  };
}

/** Đánh dấu đúng một bước đang chạy — phần "tối ưu trước" của lượt ghi. */
function markStepRunning(
  steps: readonly PipelineFailureRawStep[],
  stepId: string,
): readonly PipelineFailureRawStep[] {
  return steps.map((step) => (step.stepId === stepId ? { ...step, status: 'running' } : step));
}

/* -------------------------------------------------------------------------- */
/* Cổng đã tiêm, hoặc bản thật dựng đúng một lần.                               */
/* -------------------------------------------------------------------------- */

/**
 * Dựng lười vì `createAppPipelineFailureGateway` mở một bộ gửi đo đạc — không nên
 * tạo thêm một bộ nữa cho mỗi lượt gắn hook đã có cổng riêng. Cùng khuôn
 * `useResolvedGateway` của `useProcessingScreen.ts:451`.
 */
function useResolvedGateway(injected: PipelineFailureGateway | undefined): PipelineFailureGateway {
  const fallbackRef = useRef<PipelineFailureGateway | null>(null);

  if (injected !== undefined) {
    return injected;
  }

  fallbackRef.current ??= createAppPipelineFailureGateway();
  return fallbackRef.current;
}

/* -------------------------------------------------------------------------- */
/* Hook.                                                                       */
/* -------------------------------------------------------------------------- */

/** `(options) => PipelineFailureProps` cho `PipelineFailure.tsx`. */
export function usePipelineFailure(options: UsePipelineFailureOptions): PipelineFailureProps {
  const { failureCode, failureFloorName, failureFloors, floorId, projectId, stepId } = options;
  const serverError = failureCode === undefined ? null : describePipelineError(failureCode);
  const roles = toProjectRoles(options.roles);
  const gateway = useResolvedGateway(options.gateway);
  const queryClient = useQueryClient();
  const prefersReducedMotion = useReducedMotion();

  /* ---------------------------------------------------------------------- */
  /* Trạng thái của riêng giao diện.                                         */
  /* ---------------------------------------------------------------------- */

  const [isTechnicalOpen, setIsTechnicalOpen] = useState(false);
  const [isCollapsed, setIsCollapsed] = useState(false);
  const [copiedTarget, setCopiedTarget] = useState<'code' | 'log' | 'allLogs' | null>(null);
  /**
   * Số lần chính phiên này đã bấm thử lại.
   *
   * KHÔNG phải trạng thái máy chủ: `retryStep` chưa có endpoint, nên không nơi nào
   * ngoài màn này biết con số đó — đưa nó vào react-query là giả vờ có một nguồn
   * sự thật không tồn tại. Nền của nó (`detail.attemptCount`) thì đến từ cổng.
   */
  const [sessionAttempts, setSessionAttempts] = useState(0);
  /**
   * `true` khi một lượt chạy lại của CHÍNH phiên này đã chạy xong bước hỏng.
   *
   * Không nằm trong bộ nhớ đệm: lượt ghi làm mất hiệu lực nhánh `progress` (đúng
   * việc nó phải làm — màn cha S-10 cần đọc lại tiến độ), và một lượt đọc mới sẽ
   * xoá sạch cờ này nếu nó sống trong đệm. Nó cũng là thứ phân biệt `success`
   * (vừa chạy lại xong) với `empty` (chưa bước nào hỏng) — hai trạng thái có cùng
   * một hình dạng dữ liệu và khác nhau ở chuyện đã xảy ra.
   */
  const [hasRetryResolved, setHasRetryResolved] = useState(false);

  /* ---------------------------------------------------------------------- */
  /* Hai lượt đọc — R-64.                                                    */
  /* ---------------------------------------------------------------------- */

  /**
   * Khoá đệm: nhánh `progress` của `queryKeys`, thêm hai đoạn định vị đúng bước.
   *
   * Nối thêm đoạn chứ không dựng một khoá mới từ mảng trần — cùng khuôn
   * `usePipelineGraph.ts:263`. Giữ `progress` làm đoạn đầu là cố ý: nó xếp lượt
   * đọc này vào tier `aiProgress` (`staleTime` 0, `cachePolicy.ts:52-56`), đúng
   * loại dữ liệu đổi liên tục mà một bản đệm cũ sẽ nói dối.
   */
  const failureKey: QueryKey = useMemo(
    () => [...queryKeys.progress.byFloor(floorId), 'stepFailure', stepId],
    [floorId, stepId],
  );

  const logKey: QueryKey = useMemo(
    () => [...queryKeys.progress.byFloor(floorId), 'technicalLog', stepId],
    [floorId, stepId],
  );

  const failureQuery = useQuery({
    queryKey: failureKey,
    queryFn: async (): Promise<StepFailureSnapshot> => {
      const result = await gateway.readStepFailure({ floorId, projectId, stepId });

      if (!result.supported) {
        return {
          detail: null,
          missing: result.missing,
          steps: EMPTY_STEPS,
          lastAppliedSequence: NO_SEQUENCE_APPLIED,
        };
      }

      return {
        detail: result.value,
        missing: null,
        steps: result.value.steps,
        lastAppliedSequence: NO_SEQUENCE_APPLIED,
      };
    },
  });

  const logQuery = useQuery({
    queryKey: logKey,
    queryFn: async (): Promise<readonly PipelineFailureRawLogLine[]> => {
      const result = await gateway.readTechnicalLog({ floorId, projectId, stepId });

      return result.supported ? result.value : EMPTY_LOG;
    },
  });

  const snapshot = failureQuery.data;
  const detail = snapshot?.detail ?? null;
  const steps = snapshot?.steps ?? EMPTY_STEPS;
  const isResolved = hasRetryResolved;

  /* ---------------------------------------------------------------------- */
  /* Lượt ghi — chạy lại ĐÚNG một bước (R-64).                                */
  /* ---------------------------------------------------------------------- */

  const failedStepId = detail?.stepId ?? stepId;

  const retryMutation = useMutation(
    createOptimisticMutation<
      { lowerThreshold: boolean },
      Awaited<ReturnType<PipelineFailureGateway['retryStep']>>
    >(queryClient, {
      affectedKeys: () => [failureKey],
      applyOptimistic: () => {
        // Backend chưa có endpoint thì bước không chạy lại: đừng vẽ nó "đang chạy" (FIX-P0-13).
        if (!gateway.supports.retryStep) return;
        queryClient.setQueryData<StepFailureSnapshot>(failureKey, (existing) =>
          existing === undefined
            ? existing
            : { ...existing, steps: markStepRunning(existing.steps, failedStepId) },
        );
      },
      // Một khả năng chưa có endpoint KHÔNG phải một lỗi: nó là câu trả lời thật,
      // và ném nó ra sẽ đẩy màn sang trạng thái `error` — nói sai chuyện gì đã xảy
      // ra. Nó đi ra như một kết quả, và `afterSuccess` xử nó.
      callServer: ({ lowerThreshold }) =>
        gateway.retryStep({ floorId, lowerThreshold, projectId, stepId: failedStepId }),
      afterSuccess: (result) => {
        if (!result.supported) {
          // O-01: một khả năng người dùng vừa hỏi tới mà hệ thống chưa có. Ghi lại
          // là việc duy nhất làm được, và nó là việc đúng — câu tiếng Việt đã báo
          // trước cho người dùng qua `retryNotice` chế độ `'support'`.
          gateway.reportStepFailure({
            error: new Error(result.missing),
            floorId,
            stepId: failedStepId,
          });
          return;
        }

        setSessionAttempts((previous) => previous + 1);

        if (result.value.status === 'done') {
          setHasRetryResolved(true);
        }

        queryClient.setQueryData<StepFailureSnapshot>(failureKey, (existing) =>
          existing === undefined ? existing : mergeRetryOutcome(existing, result.value),
        );
        // Đúng MỘT khoá, lấy từ `queryKeys` — xem ghi chú R-64 ở đầu file.
        void queryClient.invalidateQueries({ queryKey: queryKeys.progress.byFloor(floorId) });
      },
      entityId: () => floorId,
      rollback: () => {
        // Không có gì ngoài bộ nhớ đệm để hoàn lại: `applyOptimistic` chỉ ghi vào
        // đúng khoá mà `affectedKeys` đã chụp ảnh, và lớp lệnh tự khôi phục nó.
      },
    }),
  );

  /* ---------------------------------------------------------------------- */
  /* O-01 — ghi sự kiện lỗi đúng một lần cho mỗi bước hỏng.                   */
  /* ---------------------------------------------------------------------- */

  const reportedKeyRef = useRef<string | null>(null);

  useEffect(() => {
    if (detail === null) {
      return;
    }

    const key = `${projectId}|${detail.floorId}|${detail.stepId}`;

    if (reportedKeyRef.current === key) {
      return;
    }

    reportedKeyRef.current = key;
    gateway.reportStepFailure({
      error: detail.error,
      floorId: detail.floorId,
      stepId: detail.stepId,
    });
  }, [detail, gateway, projectId]);

  /* ---------------------------------------------------------------------- */
  /* Nhãn "Đã sao chép" — hook giữ đồng hồ, view không bao giờ.               */
  /* ---------------------------------------------------------------------- */

  const copyTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(
    () => () => {
      if (copyTimerRef.current !== null) {
        clearTimeout(copyTimerRef.current);
      }
    },
    [],
  );

  const flashCopied = useCallback((target: 'code' | 'log' | 'allLogs') => {
    setCopiedTarget(target);

    if (copyTimerRef.current !== null) {
      clearTimeout(copyTimerRef.current);
    }

    copyTimerRef.current = setTimeout(() => {
      copyTimerRef.current = null;
      setCopiedTarget(null);
    }, COPIED_LABEL_HOLD_MS);
  }, []);

  /* ---------------------------------------------------------------------- */
  /* Lỗi thành câu (L-03).                                                   */
  /* ---------------------------------------------------------------------- */

  const readError = failureQuery.error;

  const apiFailure = useMemo(
    () => (readError === null ? null : gateway.describeApiFailure(readError)),
    [gateway, readError],
  );

  const missing = snapshot?.missing ?? null;

  /**
   * Mã lỗi và mã yêu cầu của bước hỏng, đọc ra từ `AppError` chứ không gõ tay.
   *
   * Nhánh thứ ba là nhánh của khả năng chưa có endpoint: KHÔNG bịa một mã, mà đưa
   * đúng câu "còn thiếu gì" của cổng qua chính bảng lỗi dùng chung. Nó rơi vào
   * `unknown` và mang mã `UNKNOWN` của `APP_ERROR_KIND_CONFIG` — một mã thật, do
   * bảng lỗi cấp, chứ không phải một chuỗi ai đó gõ ra ở đây. Hợp đồng nói mã lỗi
   * "luôn có mặt, không bao giờ rỗng", và đây là cách giữ lời đó mà không nói dối.
   */
  const failureIdentity = useMemo(() => {
    if (detail !== null) {
      return gateway.describeApiFailure(detail.error);
    }

    if (apiFailure !== null) {
      return apiFailure;
    }

    return missing === null ? null : gateway.describeApiFailure(new Error(missing));
  }, [apiFailure, detail, gateway, missing]);

  // Chưa đọc được chi tiết nhưng máy chủ đã nói mã: mã thật, không `UNKNOWN`.
  const usesServerCode = detail === null && apiFailure === null && serverError !== null;
  const errorCode = usesServerCode ? serverError.code : (failureIdentity?.code ?? '');
  const errorCodeLabel = codeLabel(errorCode, usesServerCode ? '' : (failureIdentity?.requestId ?? ''));

  const floorLabel = detail?.floorName ?? failureFloorName ?? floorId;
  const failedStepLabel = stepLabelOf(failedStepId);

  /* ---------------------------------------------------------------------- */
  /* Bảy trạng thái (A11).                                                   */
  /* ---------------------------------------------------------------------- */

  const floors = useMemo<readonly PipelineFailureFloorViewModel[]>(
    () =>
      (detail?.floors ?? failureFloors ?? []).map((floor) => ({
        id: floor.floorId,
        label: floor.floorName,
        status: floor.status,
        statusLabel: PIPELINE_FAILURE_FLOOR_STATUS_LABELS[floor.status],
        isFailedFloor: floor.floorId === (detail?.floorId ?? floorId),
      })),
    [detail, failureFloors, floorId],
  );

  const isCompact = options.forceCollapsed ?? isCollapsed;
  const isReading = failureQuery.isPending;
  const isRetrying = retryMutation.isPending;
  // Chỉ chi tiết của máy chủ nói được "mọi tầng hỏng"; dải mượn từ màn Xử lý thì không đổi trạng thái.
  const detailFloors = detail?.floors ?? [];
  const hasEveryFloorFailed = detailFloors.length > 0 && detailFloors.every((floor) => floor.status === 'failed');
  const hasFailedStep = steps.some((step) => step.status === 'failed');
  const canAct = can('upload', 'floor', { roles });

  /**
   * Thứ tự xét, cùng khuôn `useProcessingScreen.ts:685` và `usePipelineGraph.ts:530`:
   * đang chạy → thu gọn → lỗi → không có quyền → xong → rỗng → một phần.
   *
   * Hai chỗ riêng của màn này:
   *
   * - `loading` gộp cả lượt đọc đầu tiên LẪN lượt chạy lại, vì cả hai đều là "cái
   *   ô đang chạy" và cả hai đều dựng {@link PipelineFailureRetryingBand}. Không có
   *   nhánh thứ tám cho "đang đọc" — hợp đồng chỉ có bảy.
   * - `success` thắng `collapsed`: một lượt chạy lại vừa xong phải nói ra điều
   *   đó ở mọi bề rộng, chứ không im lặng thu gọn (A11).
   * - `collapsed` xét TRƯỚC lỗi và quyền: nút "Thu gọn" luôn được vẽ, nên bấm nó
   *   phải thu gọn thân ở mọi nhánh (BUG-544). Nút và nhật ký của `forbidden` vẫn
   *   ẩn theo `canAct`, không theo nhánh.
   */
  const state: PipelineFailureState =
    isReading || isRetrying
      ? 'loading'
      : isCompact && !isResolved
        ? 'collapsed'
        : failureQuery.isError || hasEveryFloorFailed
          ? 'error'
          : !canAct
            ? 'forbidden'
            : isResolved
              ? 'success'
              : detail !== null && !hasFailedStep
                ? 'empty'
                : 'partial';

  /* ---------------------------------------------------------------------- */
  /* Nhật ký kỹ thuật.                                                       */
  /* ---------------------------------------------------------------------- */

  const logLines = useMemo<readonly PipelineFailureLogLine[]>(() => {
    const raw = logQuery.data ?? EMPTY_LOG;

    if (raw.length === 0) {
      // Nói ra sự thật ở đúng chỗ người dùng đi tìm nó. Một mảng rỗng ở đây đọc
      // như "không có lỗi nào được ghi", mà đó không phải chuyện đang xảy ra.
      return [
        {
          id: 'technical-log-unsupported',
          timeLabel: formatClockTime(null),
          text: PIPELINE_FAILURE_TEXT.logUnsupportedLine,
        },
      ];
    }

    return raw.map((line) => ({
      id: line.id,
      timeLabel: formatClockTime(new Date(line.atIso)),
      text: line.text,
    }));
  }, [logQuery.data]);

  const logText = useMemo(
    () => logLines.map((line) => `${line.timeLabel} ${line.text}`).join('\n'),
    [logLines],
  );

  /** Chép TOÀN BỘ: mã lỗi và câu nguyên nhân đứng đầu, rồi tới từng dòng nhật ký. */
  const allLogsText = useMemo(
    () => [errorCodeLabel, ...logLines.map((line) => `${line.timeLabel} ${line.text}`)].join('\n'),
    [errorCodeLabel, logLines],
  );

  /* ---------------------------------------------------------------------- */
  /* Ba nút sao chép.                                                        */
  /* ---------------------------------------------------------------------- */

  const onCopyCode = useCallback(() => {
    void gateway.copyText(errorCodeLabel);
    flashCopied('code');
  }, [errorCodeLabel, flashCopied, gateway]);

  const onCopyLog = useCallback(() => {
    void gateway.copyText(logText);
    flashCopied('log');
  }, [flashCopied, gateway, logText]);

  const onCopyAllLogs = useCallback(() => {
    void gateway.copyText(allLogsText);
    flashCopied('allLogs');
  }, [allLogsText, flashCopied, gateway]);

  /**
   * Dựng một nút sao chép với nhãn ĐÃ tính sẵn.
   *
   * `useCallback` khoá theo `copiedTarget` chứ không phải một hàm tự do: ba khối
   * dùng nó đều nằm trong `useMemo`, và một hàm mới mỗi lượt render sẽ làm ba bộ
   * nhớ đệm ấy không bao giờ trúng.
   */
  const copyActionOf = useCallback(
    (
      target: 'code' | 'log' | 'allLogs',
      ariaLabel: string,
      onCopy: () => void,
    ): PipelineFailureCopyAction => {
      const isCopied = copiedTarget === target;

      return {
        label: isCopied ? PIPELINE_FAILURE_TEXT.copiedLabel : PIPELINE_FAILURE_TEXT.copyLabel,
        ariaLabel,
        isCopied,
        onCopy,
      };
    },
    [copiedTarget],
  );

  /* ---------------------------------------------------------------------- */
  /* Ba lối ra của màn cha.                                                  */
  /* ---------------------------------------------------------------------- */

  // Khuôn "ref mới nhất": nơi gọi truyền hàm mới mỗi lượt render vẫn không làm các
  // `useCallback` dưới đây đổi danh tính.
  const onNavigateRef = useRef(options.onNavigate);
  onNavigateRef.current = options.onNavigate;
  const onResolvedRef = useRef(options.onResolved);
  onResolvedRef.current = options.onResolved;
  const onDismissRef = useRef(options.onDismiss);
  onDismissRef.current = options.onDismiss;

  const onContinue = useCallback(() => {
    const resolved = onResolvedRef.current;

    if (resolved !== undefined) {
      resolved();
      return;
    }

    // Màn cha không nối `onResolved` thì dải này đã hết chuyện để nói; xin gỡ nó
    // khỏi khung là việc đúng còn lại. Cùng khuôn "given ?? dự phòng" của
    // `useProcessingScreen.onGoToSupport`.
    onDismissRef.current?.();
  }, []);

  const onToggleCollapse = useCallback(() => {
    setIsCollapsed((previous) => !previous);
  }, []);

  const onToggleTechnical = useCallback(() => {
    setIsTechnicalOpen((previous) => !previous);
  }, []);

  /** Cấp "Dự án" của đường dẫn về danh sách dự án, như ở Tải bản vẽ và Cổng chất lượng (BUG-546). */
  const onBackToProjects = useCallback(() => {
    onNavigateRef.current?.(ROUTES.dashboard);
  }, []);

  /* ---------------------------------------------------------------------- */
  /* Ba hướng đi tiếp.                                                       */
  /* ---------------------------------------------------------------------- */

  const onRetry = useCallback(() => {
    retryMutation.mutate({ lowerThreshold: false });
  }, [retryMutation]);

  const onRetryLowerThreshold = useCallback(() => {
    retryMutation.mutate({ lowerThreshold: true });
  }, [retryMutation]);

  const onUploadClearer = useCallback(() => {
    onNavigateRef.current?.(ROUTES.project.upload(projectId));
  }, [projectId]);

  const isSkipSupported = gateway.supports.skipFloor;
  const isRetryStepSupported = gateway.supports.retryStep;

  const onSkipFloor = useCallback(() => {
    void gateway.skipFloor({ floorId, projectId }).then((result) => {
      if (!result.supported) {
        // Cùng lý lẽ với nhánh `retryStep` chưa có endpoint: ghi lại là việc duy
        // nhất làm được, và câu cảnh báo đã nói trước rằng hướng này chưa dùng được.
        gateway.reportStepFailure({
          error: new Error(result.missing),
          floorId,
          stepId: failedStepId,
        });
      }
    });
  }, [failedStepId, floorId, gateway, projectId]);

  const nextSteps: PipelineFailureNextSteps = useMemo(() => {
    const retryLower: PipelineFailureNextStep = {
      id: 'retry-lower-threshold',
      label: PIPELINE_FAILURE_TEXT.retryLowerThresholdLabel,
      warningSentence: PIPELINE_FAILURE_TEXT.retryLowerThresholdWarning,
      // Ở `error` (cả bốn tầng hỏng) hành động chính đổi sang tải lại ảnh — đó là
      // toàn bộ cách hợp đồng diễn đạt việc đó, không cần một trường thứ hai.
      isPrimary: serverError === null && state !== 'error',
      onSelect: onRetryLowerThreshold,
    };

    // Có mã máy chủ: `reupload`/`retry` → tải lên là chính; `contactAdmin`, mã lạ → không bước chính.
    const action = serverError?.action;
    const uploadClearer: PipelineFailureNextStep = {
      id: 'upload-clearer',
      label: action === 'retry' ? RERUN_BY_UPLOAD_LABEL : PIPELINE_FAILURE_TEXT.uploadClearerLabel,
      warningSentence: null,
      isPrimary:
        serverError === null ? state === 'error' || !isRetryStepSupported : action === 'reupload' || action === 'retry',
      onSelect: onUploadClearer,
    };

    const skipFloor: PipelineFailureNextStep = {
      id: 'skip-floor',
      label: PIPELINE_FAILURE_TEXT.skipFloorLabel,
      // A8/A9 — hành động mất mát nói ra cái mất TRƯỚC khi được bấm.
      warningSentence: isSkipSupported
        ? PIPELINE_FAILURE_TEXT.skipFloorWarning
        : `${PIPELINE_FAILURE_TEXT.skipFloorWarning} ${PIPELINE_FAILURE_TEXT.skipFloorUnsupportedWarning}`,
      isPrimary: false,
      onSelect: onSkipFloor,
    };

    // Bản Z (S-14): BE chưa có `skipFloor` thì không vẽ nút "Bỏ qua tầng đó" — không nút chết.
    // FIX-P0-13: BE chưa có `retryStep` thì không vẽ "Thử lại với ngưỡng thấp hơn"; tải lại ảnh thành nút chính.
    // Cả hai đều chưa có thì "Về danh sách dự án" là hướng thứ hai — luật "luôn ít nhất hai đường" giữ bằng
    // một đường thật, không bằng một nút chết.
    const backToProjects: PipelineFailureNextStep = {
      id: 'back-to-projects',
      label: PIPELINE_FAILURE_TEXT.backToProjectsLabel,
      warningSentence: null,
      isPrimary: false,
      onSelect: onBackToProjects,
    };
    const first = isRetryStepSupported ? retryLower : uploadClearer;
    const rest = [
      ...(isRetryStepSupported ? [uploadClearer] : []),
      ...(isSkipSupported ? [skipFloor] : []),
    ];
    const [second = backToProjects, ...more] = rest;
    return [first, second, ...more];
  }, [
    isRetryStepSupported,
    isSkipSupported,
    onBackToProjects,
    onRetryLowerThreshold,
    onSkipFloor,
    onUploadClearer,
    serverError,
    state,
  ]);

  /* ---------------------------------------------------------------------- */
  /* Bộ đếm lần thử — hook chọn chế độ, view chỉ đọc `kind` (R-71).           */
  /* ---------------------------------------------------------------------- */

  const isRetrySupported = gateway.supports.retryStep;
  const attemptCount = (detail?.attemptCount ?? 1) + sessionAttempts;

  const retryNotice = useMemo<PipelineFailureRetryNotice>(() => {
    // Tệp không dùng được: việc duy nhất là chọn tệp khác (U48).
    if (serverError?.action === 'reupload') {
      return { kind: 'none' };
    }

    const label = attemptLabel(attemptCount);
    const needsSupport = !isRetrySupported || attemptCount >= RETRY_ATTEMPTS_BEFORE_SUPPORT;

    if (!needsSupport) {
      return { kind: 'attempt', attemptLabel: label };
    }

    return {
      kind: 'support',
      attemptLabel: label,
      suggestionSentence: isRetrySupported
        ? PIPELINE_FAILURE_TEXT.supportAfterAttempts
        : PIPELINE_FAILURE_TEXT.supportRetryUnsupported,
      copyAllLogs: copyActionOf(
        'allLogs',
        PIPELINE_FAILURE_TEXT.copyAllLogsAriaLabel,
        onCopyAllLogs,
      ),
      uploadLink: {
        label: PIPELINE_FAILURE_TEXT.uploadAgainLabel,
        onOpen: onUploadClearer,
      },
    };
    // `copyActionOf` đổi danh tính mỗi khi nhãn "Đã sao chép" bật/tắt, nên nó phải
    // nằm trong danh sách phụ thuộc — nếu không nút chép toàn bộ nhật ký sẽ không
    // bao giờ đổi nhãn.
  }, [
    attemptCount,
    copyActionOf,
    isRetrySupported,
    onCopyAllLogs,
    onUploadClearer,
    serverError,
  ]);

  /* ---------------------------------------------------------------------- */
  /* Khối lỗi.                                                               */
  /* ---------------------------------------------------------------------- */

  const reason = useMemo<PipelineFailureReasonViewModel>(() => {
    const copyCode = copyActionOf('code', PIPELINE_FAILURE_TEXT.copyCodeAriaLabel, onCopyCode);

    if (apiFailure !== null) {
      // Lượt đọc hỏng: câu lấy nguyên từ bảng lỗi dùng chung (L-03), không viết lại.
      return {
        summarySentence: PIPELINE_FAILURE_TEXT.readFailureSummary,
        causeSentence: apiFailure.sentence,
        codeLabel: errorCodeLabel,
        copyCode,
      };
    }

    if (detail === null && serverError !== null) {
      return {
        summarySentence: summarySentence(failedStepLabel, floorLabel),
        causeSentence: serverError.sentence,
        codeLabel: errorCodeLabel,
        copyCode,
      };
    }

    if (detail === null) {
      // `stepFailureDetail` chưa có endpoint — nói ra, thay vì bịa một nguyên nhân.
      return {
        summarySentence: detailUnsupportedSummary(floorLabel),
        causeSentence: PIPELINE_FAILURE_TEXT.detailUnsupportedCause,
        codeLabel: errorCodeLabel,
        copyCode,
      };
    }

    return {
      summarySentence: summarySentence(failedStepLabel, floorLabel),
      causeSentence: causeSentence(detail.cause),
      codeLabel: errorCodeLabel,
      copyCode,
    };
  }, [
    apiFailure,
    copyActionOf,
    detail,
    errorCodeLabel,
    failedStepLabel,
    floorLabel,
    onCopyCode,
    serverError,
  ]);

  /* ---------------------------------------------------------------------- */
  /* Bốn hình dạng của cái ô.                                                */
  /* ---------------------------------------------------------------------- */

  const band = useMemo<PipelineFailureBand>(() => {
    if (state === 'empty') {
      return { kind: 'idle', messageSentence: PIPELINE_FAILURE_TEXT.idleMessage };
    }

    if (state === 'loading') {
      return {
        kind: 'retrying',
        steps: toStepperSteps(steps, failedStepId, errorCode),
        stepperAriaLabel: PIPELINE_FAILURE_TEXT.stepperAriaLabel,
        liveMessage: isRetrying
          ? retryingLiveMessage(failedStepLabel, floorLabel)
          : readingLiveMessage(floorLabel),
      };
    }

    if (state === 'success') {
      return {
        kind: 'resolved',
        toastMessage: resolvedToastMessage(failedStepLabel, floorLabel),
        continueLabel: PIPELINE_FAILURE_TEXT.continueLabel,
        onContinue,
      };
    }

    return {
      kind: 'alert',
      reason,
      retryAction: {
        label: PIPELINE_FAILURE_TEXT.retryLabel,
        stepId: failedStepId,
        stepName: retryStepAriaLabel(failedStepLabel),
        isRunning: isRetrying,
        ...(isRetryStepSupported ? {} : { isUnsupported: true }),
        onRetry,
      },
      // `null` ĐÚNG ở `forbidden`: ba nút hành động biến mất hẳn, không khoá mờ.
      nextSteps: canAct ? nextSteps : null,
      retryNotice,
    };
  }, [
    canAct,
    errorCode,
    failedStepId,
    failedStepLabel,
    floorLabel,
    isRetrying,
    isRetryStepSupported,
    nextSteps,
    onContinue,
    onRetry,
    reason,
    retryNotice,
    state,
    steps,
  ]);

  /* ---------------------------------------------------------------------- */
  /* Khối "Kết quả đã có" (A5: không trường màu, view vẽ chấm trung tính).    */
  /* ---------------------------------------------------------------------- */

  const keptWork = useMemo<PipelineFailureKeptWork>(() => {
    const items = (detail?.keptResults ?? []).map((kept) => ({
      id: kept.stepId,
      label: keptItemLabel(stepLabelOf(kept.stepId), kept.count, kept.unit),
    }));

    // Ở `error` khối rút thành đúng một dòng; khi chưa đọc được gì cũng vậy — một
    // danh sách rỗng kèm câu "những kết quả này đã được giữ lại" là hứa suông.
    if (state === 'error' || items.length === 0) {
      return { kind: 'line', line: PIPELINE_FAILURE_TEXT.keptWorkLine };
    }

    return { kind: 'list', items, captionSentence: PIPELINE_FAILURE_TEXT.keptWorkCaption };
  }, [detail, state]);

  /* ---------------------------------------------------------------------- */
  /* Khối gấp.                                                               */
  /* ---------------------------------------------------------------------- */

  const technicalDetails = useMemo<PipelineFailureTechnicalDetails | null>(() => {
    // Người không có quyền không thấy nhật ký, và cách đúng để nói điều đó là khối
    // biến mất chứ không phải một nút khoá mờ.
    if (!canAct) {
      return null;
    }

    return {
      toggleLabel: PIPELINE_FAILURE_TEXT.technicalToggleLabel,
      isOpen: isTechnicalOpen,
      onToggle: onToggleTechnical,
      logLines,
      copyLog: copyActionOf('log', PIPELINE_FAILURE_TEXT.copyLogAriaLabel, onCopyLog),
    };
  }, [canAct, copyActionOf, isTechnicalOpen, logLines, onCopyLog, onToggleTechnical]);

  return {
    state,
    band,
    floors,
    keptWork,
    technicalDetails,
    collapsedSummaryLine: collapsedSummaryLine(floorLabel, failedStepLabel, errorCode),
    collapseToggleLabel:
      state === 'collapsed'
        ? PIPELINE_FAILURE_TEXT.expandLabel
        : PIPELINE_FAILURE_TEXT.collapseLabel,
    onToggleCollapse,
    onBackToProjects,
    motionDurationName: MOTION_SLOT,
    prefersReducedMotion,
  };
}
