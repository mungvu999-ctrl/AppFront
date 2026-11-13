import { createAppApiClient } from '@/api/appClient';
import type { FloorLayerDocument } from '@/api/schemas/spatialLayer';
import { queryKeys } from '@/lib/query/queryKeys';
import type { FloorMetaEntry, FloorScaleKeys } from '@/store/spatialSlice';

/** N16 của một tầng dưới `layer.byFloor` (cùng khoá với `useFloorLayer`, dùng lại cache). */
export const floorLayerQuery = (projectId: string, floorId: string) => ({
  queryKey: queryKeys.layer.byFloor(projectId, floorId),
  queryFn: async ({ signal }: { readonly signal: AbortSignal }): Promise<FloorLayerDocument> => {
    const result = await createAppApiClient().spatial.readLayer({ floorId, projectId, signal });
    if (!result.ok) throw result.error;
    return result.data;
  },
});

/**
 * Khoá tỷ lệ của tầng. N15 (`hydrateProject`) không mang `scaleStatus`, nên `floorMeta` thiếu khoá
 * này nghĩa là "chưa đọc" chứ không phải "đã xác nhận": chỉ tin N16 không cũ hơn kho, hoặc kho đã
 * biết tầng là tạm. `null` = chưa đọc được.
 *
 * Từ K4, tầng mà người dùng chấp nhận số máy không còn `scaleStatus` nhưng vẫn giữ `scaleState`:
 * xét `scaleStatus` một mình thì đúng những tầng đó bị trả `null` và mọi nơi gọi đều bỏ sót.
 */
export function floorScaleKeysOf(
  document: FloorLayerDocument | undefined,
  meta: FloorMetaEntry | undefined,
): FloorScaleKeys | null {
  if (document !== undefined && (meta === undefined || document.revision >= meta.revision)) return document;
  if (meta === undefined) return null;
  return meta.scaleStatus === undefined && meta.scaleState === undefined ? null : meta;
}
