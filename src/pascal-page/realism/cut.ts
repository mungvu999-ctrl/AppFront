/**
 * Cắt thấp cho chế độ "Tường: cắt" (thẻ S1): mọi thứ trên một tầng (tường, kể cả vách giữa hai
 * phòng, cửa, cửa sổ, đồ cao, trần) bị cắt ở 1,0 m trên sàn tầng để nhìn từ trên xuống thấy phòng.
 * Mặt cắt của khối tường kín (mặt sau + mặt hướng lên lộ trong lòng tường) → tô phẳng màu nắp sáng.
 * Logic thuần, phần chạy ở `cutSync.ts`.
 */
import type { Object3D, Plane, Vector3 } from 'three';

import { SCENE_PALETTE } from '@/lib/pascal/scenePalette';

/** Độ cao mặt cắt tính từ sàn tầng (m). */
export const CUT_HEIGHT_M = 1.0;
/** Màu nắp cắt tối của bản xem nướng sáng (`bakedPreview`). */
export const CUT_FACE_COLOR = SCENE_PALETTE.cutFace;
/** Màu nắp cắt của cảnh thường: phẳng, sáng (như poché trắng của bản vẽ), không nhận bóng. */
export const CUT_CAP_COLOR = SCENE_PALETTE.cutCap;
/** Chế độ tường dùng cắt thấp (nhãn "Tường: cắt" trên thanh công cụ). */
export const CUT_WALL_MODE = 'cutaway';
/** Tên lưới gộp tường của vendor (`wall-batch-system.tsx`). */
export const WALL_BATCH_MESH_NAME = 'wall-batch';

export function lowCutActive(wallMode: string): boolean {
  return wallMode === CUT_WALL_MODE;
}

/** Độ cao thế giới của mặt cắt cho một tầng có sàn ở `levelWorldY`. */
export function cutPlaneY(levelWorldY: number): number {
  return levelWorldY + CUT_HEIGHT_M;
}

type ClipGroupLike = Object3D & { isClippingGroup?: boolean; enabled?: boolean; clippingPlanes?: Plane[] };

/**
 * Điểm trúng nằm ở phần không vẽ: "Tường: cắt" (`cutSync.ts`) cắt từng tầng bằng ClippingGroup, nhưng tia vẫn
 * trúng cả tường cao phía trên mặt cắt nên đỉnh tường vô hình chặn vật phía sau.
 */
export function clippedAway(object: Object3D, point: Vector3 | undefined): boolean {
  if (!point) return false;
  for (let o: Object3D | null = object; o; o = o.parent) {
    const group = o as ClipGroupLike;
    if (group.isClippingGroup && group.enabled !== false && group.clippingPlanes?.some((plane) => plane.distanceToPoint(point) < 0)) {
      return true;
    }
  }
  return false;
}

/**
 * Lưới nào cần tô mặt sau gần đen: tường lẻ (id nằm trong tập tường) hoặc lưới gộp tường.
 * Cửa, cửa sổ, đồ, trần vẫn bị cắt (theo nhóm tầng) nhưng giữ vật liệu gốc.
 */
export function isCutFaceMesh(id: string | undefined, name: string, wallIds: ReadonlySet<string>): boolean {
  return name === WALL_BATCH_MESH_NAME || (id !== undefined && wallIds.has(id));
}

/** Cao tầng mặc định (m) khi node `level` chưa có `height` (dữ liệu cũ). */
export const DEFAULT_STOREY_M = 3.0;
/** Trễ khi camera đi lên lại: chỉ cắt lại khi mắt cao hơn trần tầng thêm chừng này (m) — không nhấp nháy ở mép trần. */
export const LIFT_HYSTERESIS_M = 0.6;
/** Thời gian trượt mặt cắt giữa sàn + 1,0 m và trần (s). */
export const LIFT_EASE_S = 0.3;

/**
 * Mặt cắt theo camera: mắt thấp hơn trần một tầng (đứng trong phòng, đi bộ, ngang mắt ngoài nhà) thì tầng ấy
 * thôi cắt — tường đủ cao, trần hiện; lên cao lại thì cắt 1,0 m như cũ. Có trễ: đang nâng thì giữ tới khi mắt
 * cao hơn trần + `LIFT_HYSTERESIS_M`. `eyeAboveFloor` âm (tầng nằm trên camera) cũng nâng.
 */
export function wantsLift(lifted: boolean, eyeAboveFloor: number, storeyM: number): boolean {
  return eyeAboveFloor < storeyM + (lifted ? LIFT_HYSTERESIS_M : 0);
}

/** Bước trượt 0 (cắt) ↔ 1 (không cắt) về phía `lifted`, tuyến tính trong `LIFT_EASE_S`. */
export function stepLift(lift: number, lifted: boolean, dtS: number): number {
  const step = Math.max(0, dtS) / LIFT_EASE_S;
  return lifted ? Math.min(1, lift + step) : Math.max(0, lift - step);
}

/** Độ cao thế giới mặt cắt khi đang trượt: sàn + 1,0 m (lift 0) → trần tầng (lift 1). Gọi hàm này chỉ khi lift < 1. */
export function liftedCutY(levelWorldY: number, storeyM: number, lift: number): number {
  return cutPlaneY(levelWorldY) + Math.max(0, storeyM - CUT_HEIGHT_M) * lift;
}
