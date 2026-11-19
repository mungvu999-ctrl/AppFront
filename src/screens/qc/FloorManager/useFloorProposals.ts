/**
 * Bảng "Đề xuất của máy cho cả nhà" nối vào màn Quản lý tầng (Mức 3, lát cắt 1, việc F4).
 *
 * Đọc `houseProposal` một lần cho dự án, dựng dòng từ các tầng ĐANG có (nên nhận xong một ô thì
 * giá trị hiện tại đổi theo và ô đó tự hết "nhận được"), và đưa mọi lượt "Nhận" qua
 * `applyLevelValue` — đúng đường ghi của ô nhập tay. Máy không bao giờ tự ghi vào tầng.
 *
 * ## Ẩn
 *
 * `hidden` khi không có gì để hiện (không ô nào khác giá trị hiện tại và không câu hỏi — nhận xong hết
 * thì bảng tự biến), khi công tắc tắt (`data === null`), khi không có cửa đọc (`api === null`) và trong lượt
 * đọc ĐẦU: lớp http tự thử lại 503 theo thang 300/900/2.700 ms trước khi trả `null`, nên hiện
 * khung xương lúc đó là cho công tắc tắt một bảng lóe lên ~4 giây. Khung xương chỉ hiện khi đọc
 * lại sau lỗi. Truy vấn không thử lại thêm (`retry: false`).
 */

import { useQuery } from '@tanstack/react-query';
import { useCallback, useLayoutEffect, useMemo, useRef, useState } from 'react';

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
      const result = await (
        await loadClient(api ?? undefined)
      ).houseProposal.read({ projectId, signal });

      if (!result.ok) {
        throw result.error;
      }

      return result.data;
    },
  });

  /** Mặc định thu gọn; nhớ suốt phiên của màn (state của hook, không ghi ra ngoài). */
  const [expanded, setExpanded] = useState(false);
  const onToggleExpanded = useCallback(() => setExpanded((value) => !value), []);
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

  /*
   * Đổi chiều cao một tầng dồn cao độ các tầng trên (chồng tầng suy ra: cao độ = đỉnh tầng dưới, trừ ô
   * "Ghi đè" tay), nên danh sách ô `oneClick` chụp từ đầu là cũ ngay sau lượt ghi đầu. Giữ dòng mới nhất
   * trong ref (cập nhật đồng bộ sau mỗi lần dựng) để vòng lặp luôn đọc giá trị hiện tại.
   */
  const rowsRef = useRef(rows);
  useLayoutEffect(() => {
    rowsRef.current = rows;
  }, [rows]);

  /**
   * Chiều cao trước (tầng thấp lên cao), rồi cao độ còn khác giá trị ĐÃ suy ra sau đó: cao độ đề xuất
   * trùng cao độ suy ra thì không còn là ô `oneClick`, nên không bị ghi thành "Ghi đè". Mỗi vòng đọc lại
   * dòng mới; chặn cứng số ô + 1 vòng, và dừng ngay lượt ghi hỏng đầu (lỗi đã được nói qua đường thường).
   */
  const onAcceptAll = useCallback(() => {
    const nextStep = () => {
      for (const field of ['height', 'elevation'] as const) {
        for (const row of rowsRef.current) {
          const cell = row[field];

          if (cell.oneClick && cell.proposedMm !== null) {
            return { floorId: row.floorId, field, valueMm: cell.proposedMm };
          }
        }
      }

      return null;
    };

    void (async () => {
      let previous: ReturnType<typeof nextStep> = null;

      for (let budget = rowsRef.current.length * 2 + 1; budget > 0; budget -= 1) {
        const step = nextStep();

        // Không còn ô nào, hoặc dòng chưa kịp đổi sau lượt ghi trước (cùng ô, cùng số): dừng, không ghi lại.
        if (
          step === null ||
          (previous !== null &&
            previous.floorId === step.floorId &&
            previous.field === step.field &&
            previous.valueMm === step.valueMm)
        ) {
          return;
        }
        previous = step;

        if (!(await apply(step.floorId, step.field, step.valueMm))) {
          return;
        }
      }
    })();
  }, [apply]);

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
    hidden:
      api === null ||
      query.status === 'pending' ||
      (query.isSuccess && (query.data === null || summary.isEmpty)),
    panel: {
      state,
      rows,
      summary,
      expanded,
      onToggleExpanded,
      errorMessage: query.isError ? describeError(toAppError(query.error)).description : undefined,
      onAccept,
      onAcceptAll,
      onRetry,
    },
  };
}
