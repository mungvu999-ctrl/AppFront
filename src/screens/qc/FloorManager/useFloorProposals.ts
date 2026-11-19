/**
 * Bảng "Đề xuất của máy cho cả nhà" nối vào màn Quản lý tầng (Mức 3, lát cắt 1, việc F4).
 *
 * Đọc `houseProposal` một lần cho dự án, dựng dòng từ các tầng ĐANG có (nên nhận xong một ô thì
 * giá trị hiện tại đổi theo và ô đó tự hết "nhận được"), và đưa mọi lượt "Nhận" qua
 * `applyLevelValue` — đúng đường ghi của ô nhập tay. Máy không bao giờ tự ghi vào tầng.
 *
 * ## Ẩn
 *
 * `hidden` khi công tắc tắt (`data === null`), khi không có cửa đọc (`api === null`) và trong lượt
 * đọc ĐẦU: lớp http tự thử lại 503 theo thang 300/900/2.700 ms trước khi trả `null`, nên hiện
 * khung xương lúc đó là cho công tắc tắt một bảng lóe lên ~4 giây. Khung xương chỉ hiện khi đọc
 * lại sau lỗi. Truy vấn không thử lại thêm (`retry: false`).
 */

import { useQuery } from '@tanstack/react-query';
import { useCallback, useMemo } from 'react';

import type { ApiClient } from '@/api/client';
import { describeError, toAppError } from '@/lib/errors';
import { queryKeys } from '@/lib/query/queryKeys';
import {
  summarise,
  toHouseProposalRows,
  type HouseProjectFloor,
} from '@/lib/viewmodel/houseProposal';

import type { FloorProposalPanelProps, FloorProposalState } from './FloorProposalPanel';
import type { ApplyLevelValue, LevelValueField } from './useFloorManager';

export type HouseProposalApi = Pick<ApiClient, 'houseProposal'>;

export interface UseFloorProposalsOptions {
  readonly apply: ApplyLevelValue;
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

const loadClient = async (api: HouseProposalApi | undefined): Promise<HouseProposalApi> =>
  api ?? (await import('@/api/appClient')).createAppApiClient();

export function useFloorProposals(
  projectId: string,
  floors: readonly ProposalFloor[],
  options: UseFloorProposalsOptions,
): UseFloorProposalsResult {
  const { apply, canEdit, api } = options;
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

  const proposal = query.data ?? null;
  const rows = useMemo(
    () =>
      proposal === null
        ? []
        : toHouseProposalRows(
            proposal,
            floors.map((floor, order) => ({ ...floor, order })),
          ),
    [floors, proposal],
  );
  const summary = useMemo(() => summarise(rows), [rows]);

  const onAccept = useCallback(
    (floorId: string, field: LevelValueField, valueMm: number) => {
      void apply(floorId, field, valueMm);
    },
    [apply],
  );

  /** Chỉ dòng `oneClick`, lần lượt; hỏng ở đâu dừng ở đó (lỗi đã được nói qua đường thường). */
  const onAcceptAll = useCallback(() => {
    const steps = rows
      .filter((row) => row.oneClick)
      .flatMap((row) =>
        (['elevation', 'height'] as const).flatMap((field) => {
          const cell = row[field];

          return cell.acceptable && cell.proposedMm !== null
            ? [{ floorId: row.floorId, field, valueMm: cell.proposedMm }]
            : [];
        }),
      );

    void (async () => {
      for (const step of steps) {
        if (!(await apply(step.floorId, step.field, step.valueMm))) {
          return;
        }
      }
    })();
  }, [apply, rows]);

  const { refetch } = query;
  const onRetry = useCallback(() => {
    void refetch();
  }, [refetch]);

  const state: FloorProposalState =
    query.isFetching && proposal === null
      ? 'loading'
      : query.isError
        ? 'error'
        : rows.every((row) => !row.hasProposal)
          ? 'empty'
          : !canEdit
            ? 'forbidden'
            : rows.some((row) => !row.hasProposal)
              ? 'partial'
              : 'success';

  return {
    hidden: api === null || query.status === 'pending' || (query.isSuccess && query.data === null),
    panel: {
      state,
      rows,
      summary,
      errorMessage: query.isError ? describeError(toAppError(query.error)).description : undefined,
      onAccept,
      onAcceptAll,
      onRetry,
    },
  };
}
