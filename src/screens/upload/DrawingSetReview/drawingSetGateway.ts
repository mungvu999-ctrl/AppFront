/**
 * Nguồn dữ liệu của màn "Tải cả bộ hồ sơ" — mọi lời gọi ra khỏi màn đi qua đây (cùng khuôn
 * `floorUploadGateway.ts`): một `interface` cho hình dạng, một factory nhận client để test cắm bản giả vào
 * đúng phép ánh xạ mà bản sản phẩm dùng (R-70), và một factory dựng client thật cho container.
 *
 * ## Công tắc
 *
 * Tín hiệu "tính năng bật" là N52 (`houseProposal.read`): `null` (thân `enabled: false` hoặc 404) = tắt.
 * N57/N58/N61 vẫn chạy khi tắt (L4-N04) nên chúng KHÔNG dùng làm tín hiệu; ghi (N54–N56, N59, N60) trả
 * 503 `DRAWING_SET_DISABLED` và màn xử lý nó như công tắc vừa tắt giữa chừng.
 */

import { createAppApiClient } from '@/api/appClient';
import type { ApiClient, ApiResult } from '@/api/client';
import { createAppDrawingSetClient, type DrawingSetClient } from '@/api/drawingSetClient';
import { createUuid } from '@/lib/http/ids';
import type { ReviewFloor } from '@/lib/viewmodel/drawingSetReview';

export interface DrawingSetGateway {
  /** N54–N61. */
  readonly sets: DrawingSetClient;
  /** Công tắc `DRAWING_SET_ENABLED` theo N52; lỗi thật (5xx, mạng) vẫn là `ok: false`. */
  readonly readEnabled: (projectId: string, signal?: AbortSignal) => Promise<ApiResult<boolean>>;
  /** Tầng của dự án (đích của mặt bằng, và tầng nào đã có bản vẽ). */
  readonly readFloors: (projectId: string, signal?: AbortSignal) => Promise<ApiResult<readonly ReviewFloor[]>>;
  /** Mã `L-…` cho một tầng mới (máy khách sinh, như #10); chữ số hex hoa nằm trong bảng chữ của mã tầng. */
  readonly createFloorId: () => string;
}

export function createDrawingSetGateway(
  sets: DrawingSetClient,
  client: Pick<ApiClient, 'houseProposal' | 'projects'>,
): DrawingSetGateway {
  return {
    sets,

    readEnabled: async (projectId, signal) => {
      const result = await client.houseProposal.read({ projectId, ...(signal !== undefined ? { signal } : {}) });

      return result.ok ? { ok: true, data: result.data !== null } : result;
    },

    readFloors: async (projectId, signal) => {
      const result = await client.projects.read({ projectId, ...(signal !== undefined ? { signal } : {}) });

      if (!result.ok) {
        return result;
      }

      return {
        ok: true,
        data: result.data.floors.map((floor) => ({
          id: floor.id,
          name: floor.name,
          hasDrawing: floor.drawings.length > 0,
          isSection: floor.isSection === true,
        })),
      };
    },

    createFloorId: () => `L-${createUuid().replace(/-/gu, '').slice(0, 20).toUpperCase()}`,
  };
}

/** Cổng dựng trên client thật của ứng dụng — thứ container gọi. */
export function createAppDrawingSetGateway(): DrawingSetGateway {
  return createDrawingSetGateway(createAppDrawingSetClient(), createAppApiClient());
}
