/**
 * Bảng "Đề xuất của máy cho cả nhà" nối vào màn Quản lý tầng (Mức 3, lát cắt 1, việc F4).
 *
 * Đọc `houseProposal` một lần cho dự án, dựng dòng từ các tầng ĐANG có (nhận xong một ô thì giá trị
 * hiện tại đổi theo và ô đó tự hết "nhận được"), và đưa từng lượt "Nhận" qua `applyLevelValue` — đúng
 * đường ghi của ô nhập tay. Máy không bao giờ tự ghi vào tầng; không có nhận hàng loạt.
 *
 * ## Một lượt ghi một lúc
 *
 * `busy` khoá mọi nút "Nhận" khi một lượt đang chạy; `inFlightRef` chặn bấm đúp trước khi React kịp vẽ
 * lại. Sau `await` chỉ ghi state khi hook còn sống và vẫn cùng dự án (`liveRef`).
 *
 * ## Ẩn
 *
 * Ẩn khi công tắc tắt (`data === null`), khi không có cửa đọc (`api === null`), trong lượt đọc ĐẦU (lớp
 * http tự thử lại 503 ~4 giây trước khi trả `null`) và khi không còn gì để hiện — trừ khi phiên này đã
 * nhận ít nhất một ô hay đánh dấu / bỏ dấu mặt cắt (giữ câu báo và tiêu điểm, không để bảng biến mất
 * dưới tay người dùng). Dòng mặt cắt không bao giờ làm bảng thành "trống": nút bỏ dấu nằm ở đó.
 */

import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';

import type { ApiClient } from '@/api/client';
import { applyInvalidation } from '@/lib/query/invalidation';
import { queryKeys } from '@/lib/query/queryKeys';
import {
  type HouseCascadeEntry,
  type HouseProjectFloor,
  type HouseProposalRowVm,
  summarise,
  toHouseProposalRows,
} from '@/lib/viewmodel/houseProposal';

import type { FloorProposalPanelProps, FloorProposalState } from './FloorProposalPanel';
import type { ApplyLevelValue, LevelValueField } from './useFloorManager';

/** `spatial` để đánh dấu mặt cắt (PATCH #34 `isSection`); vắng thì nút đó báo chưa lưu được. */
export type HouseProposalApi = Pick<ApiClient, 'houseProposal'> & { readonly spatial?: Pick<ApiClient['spatial'], 'patchFloor'> };

export interface UseFloorProposalsOptions {
  readonly apply: ApplyLevelValue;
  /** Bỏ nháp ô nhập tay của tầng (cùng việc ô nhập tay làm khi chốt) để nháp cũ không ghi đè giá trị vừa nhận. */
  readonly releaseDraft: (floorId: string, field: LevelValueField) => void;
  readonly canEdit: boolean;
  /** Cửa đọc tiêm được; `null` = không đọc (bảng ẩn). Vắng thì dựng client thật, nạp lười. */
  readonly api?: HouseProposalApi | null | undefined;
}

export interface UseFloorProposalsResult {
  readonly hidden: boolean;
  readonly panel: FloorProposalPanelProps;
}

/** Tầng theo thứ tự màn đang hiện; `order` của viewmodel lấy từ vị trí. */
export type ProposalFloor = Omit<HouseProjectFloor, 'order'>;

const FIELD_NAMES: Readonly<Record<LevelValueField, string>> = { elevation: 'cao độ', height: 'chiều cao' };

export const acceptedKey = (floorId: string, field: LevelValueField): string => `${floorId}:${field}`;

/**
 * Cổng mẫu giữ trạng thái trong client: dùng chung một cái, kẻo dấu mặt cắt vừa ghi không đọc lại được.
 * Client thật ghim người dùng đầu tiên nên dựng mới mỗi lượt (đổi người trong cùng thẻ vẫn đúng).
 */
let mockClient: HouseProposalApi | undefined;
async function loadClient(api: HouseProposalApi | undefined): Promise<HouseProposalApi> {
  if (api !== undefined) {
    return api;
  }
  const module = await import('@/api/appClient');
  // `DEV` viết thẳng ở đây để bản dựng thật bỏ hẳn nhánh này.
  if (import.meta.env.DEV && module.resolveUseMockApi()) {
    return (mockClient ??= module.createAppApiClient());
  }
  return module.createAppApiClient();
}

/** "Cao độ Tầng 2, Tầng 3 dời −300 mm." — gộp khi mọi tầng dời cùng một khoảng. */
function cascadeSentence(cascade: readonly HouseCascadeEntry[]): string {
  const first = cascade[0];

  if (first === undefined) {
    return '';
  }
  const list = cascade.every((entry) => entry.shiftMm === first.shiftMm)
    ? `${cascade.map((entry) => entry.floorName).join(', ')} dời ${first.shiftText}`
    : cascade.map((entry) => `${entry.floorName} dời ${entry.shiftText}`).join(', ');

  return ` Cao độ ${list}.`;
}

/** Câu cho vùng thông báo. Thông báo hoàn tác chỉ nói "Đã đổi chiều cao tầng." nên câu này không lặp nó. */
function acceptedMessage(row: HouseProposalRowVm, field: LevelValueField): string {
  const cascade = field === 'height' ? cascadeSentence(row.cascade) : '';

  return `Đã nhận ${FIELD_NAMES[field]} ${row.floorName}: ${row[field].proposedText}.${cascade}`;
}

const failedMessage = (row: HouseProposalRowVm, field: LevelValueField): string =>
  `Chưa nhận được: ${FIELD_NAMES[field]} ${row.floorName} chưa ghi được, xem thông báo của bảng tầng.`;

/** Giá trị đã vào màn nhưng một lượt PATCH sau đó hỏng (`apply` trả `false` mà tầng đã mang giá trị nhận). */
export const UNSAVED_MESSAGE = 'Đã đổi trên màn hình nhưng chưa lưu được lên máy chủ. Thử lưu lại ở bảng tầng.';

/** Dấu đã lưu nhưng đọc lại đề xuất hỏng: bảng chuyển sang dòng lỗi có "Thử lại". */
export const REREAD_FAILED = 'Chưa đọc lại được đề xuất của máy, bấm “Thử lại”.';
export const MARK_FAILED_MESSAGE = 'Chưa lưu được lên máy chủ. Thử lại.';
const markedMessage = (row: HouseProposalRowVm, isSection: boolean): string =>
  isSection
    ? `Đã đánh dấu ${row.floorName} là mặt cắt. Tầng này được ẩn khỏi 3D.`
    : `Đã bỏ đánh dấu mặt cắt cho ${row.floorName}. Tầng này vẫn ẩn khỏi 3D; bật lại ở bảng tầng nếu cần.`;

const FIELD_MM: Readonly<Record<LevelValueField, 'elevationMm' | 'heightMm'>> = { elevation: 'elevationMm', height: 'heightMm' };

/** Phần trong phiên của một dự án: ô đã nhận và câu thông báo. Đổi dự án là phiên mới. */
interface Session {
  readonly projectId: string;
  readonly accepted: ReadonlySet<string>;
  /** Phiên đã có lượt đánh dấu / bỏ dấu mặt cắt: bảng không ẩn dưới tay người dùng. */
  readonly marked: boolean;
  readonly message: string;
  /** Đối tượng mới mỗi lượt nhận được: view dời tiêu điểm về ô đầu dòng của tầng đó. */
  readonly focus: { readonly floorId: string } | null;
}

const freshSession = (projectId: string): Session => ({ projectId, accepted: new Set(), marked: false, message: '', focus: null });

export function useFloorProposals(
  projectId: string,
  floors: readonly ProposalFloor[],
  options: UseFloorProposalsOptions,
): UseFloorProposalsResult {
  const { apply, releaseDraft, canEdit, api } = options;
  const query = useQuery({
    queryKey: queryKeys.project.houseProposal(projectId),
    enabled: api !== null && projectId !== '',
    retry: false,
    queryFn: async ({ signal }) => {
      const result = await (await loadClient(api ?? undefined)).houseProposal.read({ projectId, signal });

      if (!result.ok) {
        throw result.error;
      }

      return result.data;
    },
  });

  const [expanded, setExpanded] = useState(false);
  const onToggleExpanded = useCallback(() => setExpanded((value) => !value), []);
  const [stored, setSession] = useState(() => freshSession(projectId));
  const session = stored.projectId === projectId ? stored : freshSession(projectId);
  const [busy, setBusy] = useState(false);

  // Chỉ các trường viewmodel đọc: chọn/rê chuột ở bảng tầng không dựng lại dòng (C F8).
  const floorsKey = floors.map((f) => `${f.id}\u0000${f.name}\u0000${f.elevationMm}\u0000${f.heightMm}`).join('\u0001');
  const stableFloors = useMemo(
    () => floors.map((floor, order) => ({ id: floor.id, name: floor.name, order, elevationMm: floor.elevationMm, heightMm: floor.heightMm })),
    // eslint-disable-next-line react-hooks/exhaustive-deps -- khoá theo nội dung, không theo danh tính mảng.
    [floorsKey],
  );
  const proposal = query.data ?? null;
  const rows = useMemo(() => (proposal === null ? [] : toHouseProposalRows(proposal, stableFloors)), [proposal, stableFloors]);
  const summary = useMemo(() => summarise(rows), [rows]);

  /** Còn sống và cùng dự án với lúc bắt đầu lượt ghi. */
  const liveRef = useRef({ mounted: true, projectId });
  useLayoutEffect(() => {
    liveRef.current.projectId = projectId;
  }, [projectId]);
  useEffect(() => {
    const live = liveRef.current;
    live.mounted = true;
    return () => {
      live.mounted = false;
    };
  }, []);
  const inFlightRef = useRef(false);
  /** Tầng mới nhất, đọc sau `await` để biết lượt ghi hỏng có để lại giá trị trên màn hay không. */
  const floorsRef = useRef(floors);
  useLayoutEffect(() => {
    floorsRef.current = floors;
  }, [floors]);

  const runAccept = useCallback(
    async (row: HouseProposalRowVm, field: LevelValueField) => {
      const valueMm = row[field].proposedMm;

      if (inFlightRef.current || valueMm === null || !row[field].acceptable) {
        return;
      }
      inFlightRef.current = true;
      setBusy(true);
      // Xoá câu cũ trước: câu hỏng y hệt lần trước vẫn được đọc lại khi nó quay về.
      setSession((previous) => (previous.message === '' ? previous : { ...previous, message: '' }));
      const startedFor = projectId;
      const isLive = () => liveRef.current.mounted && liveRef.current.projectId === startedFor;
      let ok = false;

      try {
        ok = await apply(row.floorId, field, valueMm, () => releaseDraft(row.floorId, field));
      } catch {
        ok = false;
      } finally {
        inFlightRef.current = false;
      }

      if (!liveRef.current.mounted) {
        return;
      }
      setBusy(false);

      if (!isLive()) {
        return;
      }
      const onScreen = floorsRef.current.find((floor) => floor.id === row.floorId)?.[FIELD_MM[field]] === valueMm;
      setSession((previous) => {
        const base = previous.projectId === startedFor ? previous : freshSession(startedFor);
        return ok
          ? {
              ...base,
              accepted: new Set([...base.accepted, acceptedKey(row.floorId, field)]),
              message: acceptedMessage(row, field),
              focus: { floorId: row.floorId },
            }
          : { ...base, message: onScreen ? UNSAVED_MESSAGE : failedMessage(row, field) };
      });
    },
    [apply, projectId, releaseDraft],
  );
  const onAccept = useCallback(
    (row: HouseProposalRowVm, field: LevelValueField) => {
      void runAccept(row, field);
    },
    [runAccept],
  );

  const queryClient = useQueryClient();
  const { refetch } = query;
  /** Đánh dấu / bỏ đánh dấu mặt cắt; dùng chung `busy` và chặn bấm lặp với "Nhận". */
  const runMark = useCallback(
    async (row: HouseProposalRowVm) => {
      if (inFlightRef.current) {
        return;
      }
      inFlightRef.current = true;
      setBusy(true);
      setSession((previous) => (previous.message === '' ? previous : { ...previous, message: '' }));
      const startedFor = projectId;
      const isSection = !row.isSection;
      const isLive = () => liveRef.current.mounted && liveRef.current.projectId === startedFor;
      let ok = false;
      let reread = true;

      try {
        const spatial = (await loadClient(api ?? undefined)).spatial;
        ok = spatial !== undefined && (await spatial.patchFloor({ body: { isSection }, floorId: row.floorId, projectId })).ok;
        if (ok) {
          // BE đổi `hiddenIn3d` theo dấu: danh sách tầng lẫn đề xuất của dự án đã ghi đều cũ, kể cả khi người
          // dùng đã rời dự án đó. Còn ở đây thì đọc lại ngay và giữ khoá tới khi dòng đã đổi, kẻo bấm lại gửi
          // đúng giá trị vừa gửi.
          applyInvalidation(queryClient, 'editFloor', { floorId: row.floorId, projectId: startedFor });
          void queryClient.invalidateQueries({ queryKey: queryKeys.project.houseProposal(startedFor), refetchType: 'none' });
          if (isLive()) {
            reread = !(await refetch()).isError;
          }
        }
      } catch {
        ok = false;
      } finally {
        inFlightRef.current = false;
      }

      if (!liveRef.current.mounted) {
        return;
      }
      setBusy(false);

      if (!isLive()) {
        return;
      }
      setSession((previous) => ({
        ...(previous.projectId === startedFor ? previous : freshSession(startedFor)),
        marked: true,
        message: !ok ? MARK_FAILED_MESSAGE : reread ? markedMessage(row, isSection) : `${markedMessage(row, isSection)} ${REREAD_FAILED}`,
      }));
    },
    [api, projectId, queryClient, refetch],
  );
  const onToggleSection = useCallback(
    (row: HouseProposalRowVm) => {
      void runMark(row);
    },
    [runMark],
  );
  const onRetry = useCallback(() => {
    void refetch();
  }, [refetch]);

  const state: FloorProposalState =
    query.isFetching && proposal === null
      ? 'loading'
      : query.isError
        ? 'error'
        : rows.every((row) => !row.hasProposal && !row.isSection)
          ? 'empty'
          : !canEdit
            ? 'forbidden'
            : rows.some((row) => !row.hasProposal)
              ? 'partial'
              : 'success';

  return {
    hidden:
      api === null ||
      query.status === 'pending' ||
      (query.isSuccess && (query.data === null || (summary.isEmpty && session.accepted.size === 0 && !session.marked && !rows.some((row) => row.isSection)))),
    panel: {
      state,
      rows,
      summary,
      expanded,
      onToggleExpanded,
      busy,
      accepted: session.accepted,
      message: session.message,
      focus: session.focus,
      onAccept,
      onToggleSection,
      onRetry,
    },
  };
}
