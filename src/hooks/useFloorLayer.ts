import { useQuery } from '@tanstack/react-query';
import { useCallback, useEffect, useMemo } from 'react';

import { floorLayerToGraph } from '@/api/floorLayerGraph';
import type { FloorLayerDocument } from '@/api/schemas/spatialLayer';
import { normalizeSpatial } from '@/domain/spatial/normalize';
import { describeError, toAppError } from '@/lib/errors';
import { readWireError } from '@/lib/errors/wireError';
import { queryKeys } from '@/lib/query/queryKeys';
import { useStore } from '@/store';
import { replaceFloorLayer } from '@/store/commit';
import { floorMetaEntryOf } from '@/store/spatialSlice';
import type { ScaleSource, WireScaleState } from '@/lib/viewmodel/provisionalScale';

/**
 * Lượt đọc N16 của MỘT tầng cho màn một tầng (F-04x-2 bước 4).
 *
 * Màn QC tự nạp tầng của nó: N16 nằm dưới `layer.byFloor(projectId, floorId)`,
 * còn lớp hiển thị vẫn đọc kho. Hook này là chỗ duy nhất quyết định dữ liệu N16
 * vào kho thế nào, theo `revision` của tài liệu so với `floorMeta[floorId]`:
 *
 * - kho rỗng hoặc của dự án khác → `setSpatial` với `source`;
 * - cùng dự án mà kho thiếu tầng → `replaceFloorLayer` có `level` (thêm tầng, giữ lịch sử);
 * - bằng → chỉ `updateFloorMeta` (`Level` đổi theo lượt N15 kế, R14);
 * - lớn hơn hoặc vắng meta, tầng không trong `unsavedFloorIds` → thay từ ngoài, kèm `level`
 *   (tỉ lệ máy chủ đổi thì `Level` phải khớp lớp đã quy đổi — review-1 P2-2);
 * - lớn hơn/vắng meta mà tầng chưa lưu → không đụng gì (lượt lưu sẽ gặp 409);
 * - nhỏ hơn → bỏ.
 *
 * Không `set(`: chỉ gọi action của kho và `replaceFloorLayer` của `src/store`.
 */

export const FLOOR_NOT_FOUND_MESSAGE = 'Tầng này không còn tồn tại.';

export interface ReadFloorLayerInput {
  readonly floorId: string;
  readonly projectId: string;
  readonly signal?: AbortSignal;
}

export interface UseFloorLayerOptions {
  readonly projectId: string;
  readonly floorId: string;
  /** N16 thô — `apiClient.spatial.readLayer` của gateway, hoặc tài liệu dựng từ fixture. */
  readonly read: (input: ReadFloorLayerInput) => Promise<FloorLayerDocument>;
}

export interface UseFloorLayerResult {
  readonly data: FloorLayerDocument | undefined;
  readonly isPending: boolean;
  /** Lỗi thô của lượt đọc; `null` khi không lỗi. */
  readonly error: unknown;
  /** Câu tiếng Việt cho `error`; 404 `resource:"floor"` → `FLOOR_NOT_FOUND_MESSAGE`. */
  readonly errorMessage: string | null;
  /** `scaleStatus` của tầng trong kho (`floorMeta`). */
  readonly scaleStatus: 'unresolved' | undefined;
  /** Nguồn tỷ lệ tạm (chỉ khi có `scaleStatus`): `project_default` = máy không đo được (UX-R1 K12). */
  readonly scaleSource: ScaleSource | undefined;
  /** N16 `scaleState` (R9) của tầng trong kho; vắng = máy chủ cũ hoặc tỷ lệ người đặt. */
  readonly scaleState: WireScaleState | undefined;
  /** N16 `scaleReasons` (R9) của tầng trong kho. */
  readonly scaleReasons: readonly string[] | undefined;
  readonly refetch: () => void;
}

/** 404 của chính tầng — đọc theo `resource` của dây. */
export function isFloorNotFound(error: unknown): boolean {
  const wire = readWireError(error);

  return wire?.status === 404 && wire.resource === 'floor';
}

const errorMessageOf = (error: unknown): string =>
  isFloorNotFound(error) ? FLOOR_NOT_FOUND_MESSAGE : describeError(toAppError(error)).description;

/** Ghi một tài liệu N16 vào kho theo bảng revision ở đầu file. */
export function applyFloorLayerDocument(projectId: string, floorId: string, document: FloorLayerDocument): void {
  const state = useStore.getState();
  const scale = floorMetaEntryOf(document.revision, document);

  if (state.spatial === null || state.spatialProjectId !== projectId) {
    state.setSpatial(normalizeSpatial(floorLayerToGraph(document)), null, {
      floorRevisions: { [floorId]: document.revision },
      projectId,
      ...(document.scaleStatus === undefined ? {} : { floorScaleStatus: { [floorId]: document.scaleStatus } }),
      ...(scale.scaleSource === undefined ? {} : { floorScaleSource: { [floorId]: scale.scaleSource } }),
      ...(scale.scaleState === undefined && scale.scaleReasons === undefined
        ? {}
        : {
            floorScaleDetail: {
              [floorId]: {
                ...(scale.scaleState === undefined ? {} : { scaleState: scale.scaleState }),
                ...(scale.scaleReasons === undefined ? {} : { scaleReasons: scale.scaleReasons }),
              },
            },
          }),
    });

    return;
  }

  if (state.spatial.byId[floorId] === undefined) {
    replaceFloorLayer(floorId, {
      ...scale,
      dimensions: document.dimensions,
      layer: document.layer,
      level: document.level,
    });

    return;
  }

  const meta = state.floorMeta[floorId];

  if (meta !== undefined && document.revision === meta.revision) {
    if (
      meta.scaleStatus !== scale.scaleStatus ||
      meta.scaleSource !== scale.scaleSource ||
      meta.scaleState !== scale.scaleState ||
      meta.scaleReasons?.join() !== scale.scaleReasons?.join()
    ) {
      state.updateFloorMeta(floorId, scale);
    }

    return;
  }

  if (meta !== undefined && document.revision < meta.revision) {
    return;
  }

  if (state.unsavedFloorIds.includes(floorId)) {
    return;
  }

  replaceFloorLayer(
    floorId,
    { ...scale, dimensions: document.dimensions, layer: document.layer, level: document.level },
    { external: true },
  );
}

export function useFloorLayer({ projectId, floorId, read }: UseFloorLayerOptions): UseFloorLayerResult {
  const query = useQuery({
    queryKey: queryKeys.layer.byFloor(projectId, floorId),
    queryFn: ({ signal }) => read({ floorId, projectId, signal }),
  });
  const { data } = query;
  const metaRevision = useStore((state) => state.floorMeta[floorId]?.revision);
  const scaleStatus = useStore((state) => state.floorMeta[floorId]?.scaleStatus);
  const scaleSource = useStore((state) => state.floorMeta[floorId]?.scaleSource);
  const scaleState = useStore((state) => state.floorMeta[floorId]?.scaleState);
  const scaleReasons = useStore((state) => state.floorMeta[floorId]?.scaleReasons);
  const storeProjectId = useStore((state) => state.spatialProjectId);
  const hasFloor = useStore((state) => state.spatial?.byId[floorId] !== undefined);

  useEffect(() => {
    if (data !== undefined) {
      applyFloorLayerDocument(projectId, floorId, data);
    }
  }, [data, floorId, hasFloor, metaRevision, projectId, storeProjectId]);

  const { refetch: refetchQuery } = query;
  const refetch = useCallback(() => {
    void refetchQuery();
  }, [refetchQuery]);
  const errorMessage = useMemo(() => (query.error === null ? null : errorMessageOf(query.error)), [query.error]);

  return { data, isPending: query.isPending, error: query.error, errorMessage, scaleStatus, scaleSource, scaleState, scaleReasons, refetch };
}
