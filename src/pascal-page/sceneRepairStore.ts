/**
 * Trạng thái sửa cảnh của trang 3D (lớp dẫn xuất, không lưu): bật/tắt "Hiện dữ liệu gốc" và danh sách
 * `SceneRepair` mà lượt dựng cảnh gần nhất đã áp (cầu nối ghi, đầu dò `repairs()` đọc). Chip lỗi đặt đồ bật/tắt;
 * cầu nối nghe `enabled` để dựng lại cảnh.
 */
import { useSyncExternalStore } from 'react';

import type { SceneLayerSummary, SceneRepair } from '@/lib/pascal/sceneLayer';
import type { RepairSession } from '@/lib/pascal/sceneRepair';

export interface SceneRepairState {
  /** `false` = người dùng chọn xem dữ liệu gốc (không sửa cảnh) trong phiên này. */
  readonly enabled: boolean;
  readonly repairs: readonly SceneRepair[];
  /** Phiên sửa cảnh của cầu nối (`sessionRepairs`): chip tính lỗi trên đúng cảnh cầu nối dựng, cùng món đã đụng. */
  readonly session: RepairSession | null;
  /** Tóm tắt lớp dẫn xuất của lượt dựng gần nhất (`toPascalScene().layer`): số món sinh theo luật, số sửa cảnh. */
  readonly layer: SceneLayerSummary | null;
}

let state: SceneRepairState = { enabled: true, repairs: [], session: null, layer: null };
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
