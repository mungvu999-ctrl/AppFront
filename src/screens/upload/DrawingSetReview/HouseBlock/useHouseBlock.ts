/**
 * Khối "Ngôi nhà" của bước duyệt (NHA-08a): đọc đề xuất của máy cho cả bộ (`GET …/building`).
 *
 * Đọc khi mở màn và sau mỗi lần bản duyệt lưu xong (`revision` đổi): đề xuất phụ thuộc loại hình và đích tầng
 * người duyệt vừa sửa. Trong lúc đọc lại, đề xuất cũ vẫn ở trên màn. Công tắc tắt hoặc bộ chưa có đề xuất →
 * `hidden`: màn y như khi chưa có khối này, không báo lỗi.
 *
 * Lát này chỉ đọc: chưa gửi quyết định nào và không chặn xác nhận (NHA-08b).
 */

import { useCallback, useEffect, useState } from 'react';

import type { DrawingSetClient } from '@/api/drawingSetClient';
import type { BuildingProposal } from '@/api/schemas/setBuilding';

export type HouseBlockState =
  | { readonly status: 'loading' }
  | { readonly status: 'hidden' }
  | { readonly status: 'error' }
  | {
      readonly status: 'ready';
      readonly proposal: BuildingProposal;
      readonly isRefreshing: boolean;
    };

export interface UseHouseBlockOptions {
  readonly sets: Pick<DrawingSetClient, 'readBuilding'>;
  readonly projectId: string;
  readonly setId: string;
  /** `revision` của bản duyệt đã lưu; đổi là đọc lại. */
  readonly revision: number;
}

export interface UseHouseBlockResult {
  readonly state: HouseBlockState;
  readonly retry: () => void;
}

export function useHouseBlock({
  projectId,
  revision,
  setId,
  sets,
}: UseHouseBlockOptions): UseHouseBlockResult {
  const [state, setState] = useState<HouseBlockState>({ status: 'loading' });
  const [token, setToken] = useState(0);

  useEffect(() => {
    const controller = new AbortController();

    setState((current) =>
      current.status === 'ready' ? { ...current, isRefreshing: true } : { status: 'loading' },
    );
    void sets.readBuilding({ projectId, setId, signal: controller.signal }).then((result) => {
      if (controller.signal.aborted) return;
      if (!result.ok) setState({ status: 'error' });
      else if (!result.data.enabled || result.data.proposal === undefined)
        setState({ status: 'hidden' });
      else setState({ status: 'ready', proposal: result.data.proposal, isRefreshing: false });
    });

    return () => {
      controller.abort();
    };
  }, [projectId, revision, setId, sets, token]);

  const retry = useCallback(() => {
    setToken((value) => value + 1);
  }, []);

  return { state, retry };
}
