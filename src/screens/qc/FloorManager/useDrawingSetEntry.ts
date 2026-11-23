/**
 * Lối vào "Tải cả bộ hồ sơ" ở màn Quản lý tầng (K-32b): hiện đúng khi công tắc `DRAWING_SET_ENABLED` bật
 * (N52 `enabled: true`) và người dùng sửa được bản vẽ. Công tắc tắt, vai người xem, đang đọc lượt đầu, lỗi
 * đọc, hay không có nơi dẫn tới màn bộ hồ sơ → `false`, và nút RỜI khỏi DOM (R-69; không nút chết, không
 * chữ báo "đang tắt").
 *
 * Dùng chung khoá `queryKeys.project.houseProposal` với `useFloorProposals`: cùng một lượt đọc N52, không
 * thêm lời gọi mạng nào.
 */

import { useQuery } from '@tanstack/react-query';

import { queryKeys } from '@/lib/query/queryKeys';

import { loadHouseProposalApi, type HouseProposalApi } from './useFloorProposals';

export interface UseDrawingSetEntryOptions {
  readonly canEdit: boolean;
  /** Cùng cửa đọc với bảng đề xuất; `null` = không đọc (lối vào ẩn). */
  readonly api?: HouseProposalApi | null | undefined;
}

export function useDrawingSetEntry(projectId: string, { api, canEdit }: UseDrawingSetEntryOptions): boolean {
  const query = useQuery({
    queryKey: queryKeys.project.houseProposal(projectId),
    enabled: api !== null && canEdit && projectId !== '',
    retry: false,
    queryFn: async ({ signal }) => {
      const result = await (await loadHouseProposalApi(api ?? undefined)).houseProposal.read({ projectId, signal });

      if (!result.ok) {
        throw result.error;
      }

      return result.data;
    },
  });

  // `enabled` chỉ tắt việc đọc; khoá đọc chung với bảng đề xuất nên dữ liệu có thể đã nằm trong bộ đệm. Vì vậy
  // quyền và cửa đọc được kiểm lại ở đây, không dựa vào `enabled`.
  return api !== null && canEdit && query.isSuccess && query.data !== null;
}
