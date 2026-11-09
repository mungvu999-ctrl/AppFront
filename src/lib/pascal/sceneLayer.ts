/**
 * Lớp cảnh dẫn xuất v1 — hợp đồng dùng chung cho mọi dự án (cũ lẫn mới) khi bấm "Xem mô hình 3D".
 *
 * Cảnh 3D = dữ liệu đã lưu (tường/ô mở/phòng/đồ của N15) + một lớp DẪN XUẤT tính lúc đọc:
 *   - đồ bày thêm / trang trí / đèn (`sceneFurnish.ts`, `sceneDressingRules.ts`, `sceneDressing.ts`) — id `DRESS-…`;
 *   - sửa cảnh có lý do cho đồ AI chưa xác nhận (`sceneRepair.ts`) — không đổi dữ liệu đã lưu.
 * Lớp này KHÔNG lưu về máy chủ: cùng dữ liệu + cùng `SCENE_LAYER_VERSION` → cùng cảnh (idempotent); dữ liệu đổi
 * thì lớp tự tính lại (vô hiệu tự nhiên). Người dùng sở hữu: món đã nhận (`F-…` sau khi sửa) và `Room.dressingOff`.
 * Mọi node dẫn xuất mang `metadata.appfront.fields.prov` (`SceneProvenance`) để kiểm tra/tắt/chỉnh được.
 *
 * Ba hạng vật thể và quyền của luật chung:
 *   - `human`: người dùng đã xác nhận (`source: 'human'` hoặc `reviewed`/`edited`) — luật KHÔNG đụng.
 *   - `ai`: kết quả AI chưa xác nhận — luật được chọn lại/dời/ẩn trong CẢNH, ghi `SceneRepair` kèm lý do.
 *   - `generated`: luật tự sinh — xem/tắt/chỉnh được; chỉnh = nhận (V4), tắt = `dressingOff`.
 * Lớp đề xuất M2 (`suggestions[]`, chưa trên master) khi vào phải đi qua đúng hợp đồng này: bản đã lưu thắng bản
 * dẫn xuất cùng `rule` + host; không có bộ luật bố trí thứ hai chạy song song.
 */

import type { Furniture, FurnitureId } from '@/domain/spatial/types';

/** Tăng khi luật sinh/sửa cảnh đổi kết quả cho cùng dữ liệu (ghi vào provenance để so cảnh cũ/mới). */
export const SCENE_LAYER_VERSION = 1;

export type SceneObjectClass = 'human' | 'ai' | 'generated';

/** Vật thể đã lưu thuộc hạng nào; chỉ `ai` mới được luật sửa cảnh đụng tới. */
export const classOf = (f: Pick<Furniture, 'source' | 'reviewed' | 'edited'>): Exclude<SceneObjectClass, 'generated'> =>
  f.source === 'human' || f.reviewed || f.edited === true ? 'human' : 'ai';

/** Provenance ghi trên node dẫn xuất (`metadata.appfront.fields.prov`). */
export interface SceneProvenance {
  readonly cls: 'generated';
  /** Luật sinh (vd `furnish:bed`, `dress:curtain`, `light:ceiling`, `railing`, `kitchenRun`). */
  readonly rule: string;
  readonly version: typeof SCENE_LAYER_VERSION;
  /** Id thực thể làm mốc (phòng, ô mở, đồ chủ) — để `dressingOff`/nhận biết phần tử gốc đổi. */
  readonly hostId?: string;
}

export type SceneRepairAction = 'moved' | 'rotated' | 'hidden' | 'rescaled';

/** Một lần luật chung sửa đồ AI chưa xác nhận trong cảnh (không lưu); hiện trong bảng kiểm tra của chip lỗi đặt đồ. */
export interface SceneRepair {
  readonly furnitureId: FurnitureId;
  readonly action: SceneRepairAction;
  /** Mã luật (`roomMismatch`, `outsideRoom`, `wallOverlap`, `overlap`, `notAgainstWall`, `duplicateFixture`, `facing`). */
  readonly rule: string;
  readonly reasonVi: string;
  /** Trạng thái gốc để hoàn/đối chiếu. */
  readonly before: Pick<Furniture, 'centre' | 'rotationDeg' | 'roomId'>;
  readonly after?: Pick<Furniture, 'centre' | 'rotationDeg' | 'roomId'>;
}

export const PROV_FIELD = 'prov';
export const REPAIR_FIELD = 'repair';

/** Trần của `Room.dressingOff` — bằng `.max()` của lược đồ (`api/schemas/spatial.ts`); vượt thì PUT bị từ chối. */
export const DRESSING_OFF_MAX = 200;

export const provenanceOf = (rule: string, hostId?: string): SceneProvenance => ({
  cls: 'generated',
  rule,
  version: SCENE_LAYER_VERSION,
  ...(hostId === undefined ? {} : { hostId }),
});

/** Tóm tắt lớp dẫn xuất của một lượt `toPascalScene` (probe/QA đọc). */
export interface SceneLayerSummary {
  readonly version: typeof SCENE_LAYER_VERSION;
  /** Số node dẫn xuất trong cảnh theo `SceneProvenance.rule`. */
  readonly generatedByRule: Readonly<Record<string, number>>;
  /** Số node đồ mang `SceneRepair` (`metadata.appfront.fields.repair`). */
  readonly repairs: number;
}
