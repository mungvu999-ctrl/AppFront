/**
 * Trạng thái sửa cảnh của trang 3D (lớp dẫn xuất, không lưu): bật/tắt "Hiện dữ liệu gốc" và danh sách
 * `SceneRepair` mà lượt dựng cảnh gần nhất đã áp (cầu nối ghi, đầu dò `repairs()` đọc). Chip lỗi đặt đồ bật/tắt;
 * cầu nối nghe `enabled` để dựng lại cảnh.
 */
import { useSyncExternalStore } from 'react';

import type { FurnitureId } from '@/domain/spatial/types';
import type { SceneRepair } from '@/lib/pascal/sceneLayer';
import type { FrozenRepair } from '@/lib/pascal/sceneRepair';

export interface SceneRepairState {
  /** `false` = người dùng chọn xem dữ liệu gốc (không sửa cảnh) trong phiên này. */
  readonly enabled: boolean;
  readonly repairs: readonly SceneRepair[];
  /** Kết quả sửa cảnh đã chốt lúc nạp (`freezeRepairs`); chip tính lỗi trên đúng cảnh đó. */
  readonly frozen: ReadonlyMap<FurnitureId, FrozenRepair> | null;
}

let state: SceneRepairState = { enabled: true, repairs: [], frozen: null };
const listeners = new Set<() => void>();

export const sceneRepairStore = {
  get: (): SceneRepairState => state,
  set(patch: Partial<SceneRepairState>): void {
    state = { ...state, ...patch };
    for (const listener of listeners) listener();
  },
  subscribe(listener: () => void): () => void {
    listeners.add(listener);
    return () => listeners.delete(listener);
  },
};

export const useSceneRepairState = (): SceneRepairState =>
  useSyncExternalStore(sceneRepairStore.subscribe, sceneRepairStore.get, sceneRepairStore.get);
