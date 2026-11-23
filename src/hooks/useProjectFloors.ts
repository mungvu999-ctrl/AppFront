import { useQuery } from '@tanstack/react-query';
import { useMemo } from 'react';

import { createAppApiClient } from '@/api/appClient';
import type { ApiResult, Floor } from '@/api/client';
import { queryKeys } from '@/lib/query/queryKeys';

export interface ProjectFloorItem {
  readonly id: string;
  readonly label: string;
  /** Tầng đã có bản vẽ chưa — `QcFloorNav` ghi "chưa có bản vẽ" cho tầng trống (U52). */
  readonly hasDrawing?: boolean;
}

type ReadFloorList = (input: { readonly projectId: string }) => Promise<ApiResult<Floor[]>>;

const appReadFloorList: ReadFloorList = ({ projectId }) => createAppApiClient().floors.list({ projectId });

/**
 * Danh sách tầng của dự án theo mã tầng API, đúng mã trên route (N2-11): dùng cho
 * cấp Tầng của `QcFloorNav` ở mọi màn kiểm tra để đổi tầng giống nhau. Xếp theo `order`.
 * Màn có gateway riêng (bộ mẫu/test) truyền `readFloorList` của gateway.
 */
export function useProjectFloors(
  projectId: string | undefined,
  readFloorList: ReadFloorList = appReadFloorList,
): readonly ProjectFloorItem[] {
  const query = useQuery({
    queryKey: queryKeys.floor.list(projectId ?? ''),
    queryFn: async () => {
      const result = await readFloorList({ projectId: projectId ?? '' });

      if (!result.ok) {
        throw result.error;
      }

      return result.data;
    },
    enabled: projectId !== undefined && projectId.length > 0,
  });

  return useMemo(
    () =>
      [...(query.data ?? [])]
        // NO-482: mặt cắt không phải tầng — không vào thanh chọn tầng.
        .filter((item) => item.isSection !== true)
        .sort((first, second) => first.order - second.order)
        .map((item) => ({ id: item.id, label: item.name, hasDrawing: item.drawings.length > 0 })),
    [query.data],
  );
}
