/**
 * Tab "Trực quan" của S-33 — hình học và khung nhìn, không có React.
 *
 * Tách khỏi `useVersionHistory.ts` vì R-22. Nội dung ở đây trả lời đúng một câu hỏi:
 * **dựng được cảnh 3D không, và dựng bằng gì.**
 *
 * Nhắc lại quyết định đã duyệt ở docblock đầu `types.ts`, vì đây là nơi nó thành mã:
 * tab này dựng mô hình **HIỆN TẠI**, không dựng lại một phiên bản CŨ. `VersionSnapshot`
 * (`versioning/diff.ts:11`) là `Record<EntityKind, Record<string, EntityRecord>>` và
 * không có bộ đổi nào từ nó sang `NormalizedSpatial` — viết bộ đổi ấy là thêm logic
 * miền, mà R-68 cấm chạm `src/domain` và R-69 cấm tự chế. Nên cảnh lấy đồ thị hiện
 * tại, còn `VisualDiffModel.caption` nói thẳng điều đó ra cho người đọc.
 */

import { denormalizeSpatial, normalizeSpatial, type NormalizedSpatial } from '@/domain/spatial/normalize';
import { formatNumber } from '@/lib/format/number';
import { standardSceneOf } from '@/lib/pascal/sceneStandard';
import type { PascalScene } from '@/lib/pascal/types';
import type { VersionDiff } from '@/lib/versioning/diff';

import type { VersionHistoryCapabilities, VisualDiffModel } from './types';
import { changedEntityIdsOf } from './versionHistoryModel';
import { planEntityIdOf } from './versionHistoryPlan';
import type { VersionSnapshotSource } from './versionSnapshotAdapter';

/* -------------------------------------------------------------------------- */
/* 1 — Câu nói ra khi không dựng được                                         */
/* -------------------------------------------------------------------------- */

/** Nơi ráp không cấp đường dựng cảnh nào. */
export const NO_SCENE_REASON = 'Màn này chưa nối được vào bộ dựng cảnh 3D';

/** Chưa có đồ thị không gian trong kho — chưa tầng nào để dựng. */
export const NO_MODEL_REASON = 'Chưa có mô hình không gian nào được nạp, nên chưa dựng được cảnh';

/** Có đồ thị nhưng nó không thành hình được. */
export const BROKEN_MODEL_REASON =
  'Mô hình hiện tại chưa dựng được thành cảnh, nên tab này để trống';

/* -------------------------------------------------------------------------- */
/* 2 — Đồ thị thành đầu vào dựng sàn                                          */
/* -------------------------------------------------------------------------- */
/* 2 — Đồ thị thành cảnh Pascal                                               */
/* -------------------------------------------------------------------------- */

export interface SceneConversion {
  /** `null` khi chưa có đồ thị hoặc nó không thành hình được. */
  readonly scene: PascalScene | null;
  /** Đồ thị có nhưng không thành hình được — khác hẳn với "chưa có đồ thị nào". */
  readonly failed: boolean;
}

/** Chưa có gì để dựng, và cũng chưa có gì hỏng. */
export const NO_SCENE: SceneConversion = Object.freeze({ scene: null, failed: false });

/**
 * Đồ thị không gian thành cảnh Pascal — cảnh chuẩn `standardSceneOf` (cùng luật bày với màn 3D chính); `options` mang
 * concept AI của dự án (`conceptSceneOptions`) như editor.
 *
 * `toPascalScene` NÉM khi đồ thị mang số đo không hữu hạn: đó là một mô hình không dựng
 * được, không phải sự cố kỹ thuật để hiện mã lỗi — nó thành một câu giải thích trên tab.
 */
export function convertScene(
  graph: NormalizedSpatial | null,
  options: Parameters<typeof standardSceneOf>[1] = {},
): SceneConversion {
  if (graph === null) {
    return NO_SCENE;
  }

  try {
    const { scene } = standardSceneOf(denormalizeSpatial(graph), options);

    return scene.rootNodeIds.length === 0 ? { scene: null, failed: true } : { scene, failed: false };
  } catch {
    return { scene: null, failed: true };
  }
}

/**
 * Đồ thị của MỘT phiên bản cũ: lớp + kích thước từ N18, còn trục/tầng/toà nhà mượn của đồ thị hiện
 * tại (N18 không mang chúng). `null` khi chưa có đồ thị hiện tại để mượn.
 */
export function graphOfVersion(
  current: NormalizedSpatial | null,
  source: VersionSnapshotSource,
): NormalizedSpatial | null {
  if (current === null) {
    return null;
  }

  return normalizeSpatial({
    ...denormalizeSpatial(current),
    dimensions: [...source.dimensions],
    furniture: source.layer.furniture,
    openings: source.layer.openings,
    rooms: source.layer.rooms,
    walls: source.layer.walls,
  });
}

/**
 * Bản không có đối tượng nào để dựng (ví dụ "trạng thái trước khi ghi kết quả AI"): cảnh của nó
 * chỉ có nền trời. Khi bản gốc trống thì `useVersionHistory` dựng bản đối chiếu thay vào.
 */
export const isEmptySource = ({ layer }: VersionSnapshotSource): boolean =>
  layer.walls.length + layer.openings.length + layer.rooms.length + layer.furniture.length === 0;

/** Vì sao tab "Trực quan" không dựng được cảnh; `null` khi nó dựng được. */
export function unavailableReasonOf(
  canShowCurrentModel3d: boolean,
  graph: NormalizedSpatial | null,
  scene: SceneConversion,
  oldVersionLabel: string | null = null,
): string | null {
  if (!canShowCurrentModel3d) {
    return NO_SCENE_REASON;
  }
  if (graph === null) {
    return NO_MODEL_REASON;
  }
  if (scene.failed || scene.scene === null) {
    // Cảnh đang dựng là của bản cũ đã chọn (B-019): nói đúng bản ấy, không đổ cho mô hình hiện tại.
    return oldVersionLabel === null
      ? BROKEN_MODEL_REASON
      : `Phiên bản ${oldVersionLabel} chưa dựng được thành cảnh, nên tab này để trống`;
  }

  return null;
}

/* -------------------------------------------------------------------------- */

export interface VisualModelInput {
  readonly capabilities: VersionHistoryCapabilities;
  readonly graph: NormalizedSpatial | null;
  readonly scene: SceneConversion;
  readonly diff: VersionDiff | null;
  /** Nhãn của bản CŨ trong cặp đang so — câu caption nêu đích danh nó. */
  readonly leftVersionLabel: string | null;
  readonly hoveredEntityId: string | null;
  readonly isFetchingDiff: boolean;
  /** `graph`/`scene` là của bản CŨ `leftVersionLabel`, không phải mô hình hiện tại. */
  readonly isOldVersion?: boolean;
  /** Bản gốc trống nên cảnh dựng bản ĐỐI CHIẾU; `leftVersionLabel` khi đó là nhãn bản đối chiếu. */
  readonly isTargetVersion?: boolean;
  /** Thư viện mẫu chưa chốt: cảnh chờ, không dựng bằng danh mục đóng gói rồi đổi mẫu sau. */
  readonly libraryPending?: boolean;
  /** Câu báo dự phòng thư viện (`LIBRARY_FALLBACK_NOTICE`), `null` khi thư viện máy chủ dùng được. */
  readonly libraryNotice?: string | null;
}

/**
 * Tab "Trực quan" thành mô hình view đọc được.
 *
 * `caption` là trường bắt buộc hiện, không phải một lời chú thích cho đẹp: người đọc
 * không được phép tưởng cảnh trên màn là bản cũ. Nó nói thẳng đây là mô hình HIỆN TẠI,
 * và đếm bao nhiêu đối tượng đang được tô sáng.
 *
 * Mã đầu tường `V-<wallId>-start|end` quy về mã tường trước (cùng `planEntityIdOf` của mặt bằng
 * 2D): tường chỉ bị dời đầu vẫn được tô. Rồi mã lọc theo đồ thị của cảnh: mã không có trong
 * cảnh (cảnh là bản gốc thì đó là phần THÊM) không tô được, nên caption đếm riêng nó và chỉ
 * sang mặt bằng 2D thay vì lặng lẽ bỏ đi.
 */
export function buildVisualModel(input: VisualModelInput): VisualDiffModel {
  const { capabilities, graph, scene, diff, leftVersionLabel } = input;
  const pending = input.libraryPending === true && graph !== null;
  const isAvailable = capabilities.canShowCurrentModel3d && (scene.scene !== null || pending);
  const found = diff === null ? [] : [...new Set(changedEntityIdsOf(diff).map(planEntityIdOf))];
  const changedEntityIds =
    graph === null ? found : found.filter((id) => graph.byId[id] !== undefined);
  const missing = found.length - changedEntityIds.length;
  const marked =
    `${formatNumber(changedEntityIds.length)} đối tượng đã đổi đang được tô sáng` +
    (missing > 0
      ? `; ${formatNumber(missing)} đối tượng không có trong bản này nên không tô được, xem ở mặt bằng 2D`
      : '');

  return {
    isAvailable,
    unavailableReason: pending && capabilities.canShowCurrentModel3d ? null : unavailableReasonOf(
      capabilities.canShowCurrentModel3d,
      graph,
      scene,
      input.isOldVersion === true ? leftVersionLabel : null,
    ),
    isBuilding: isAvailable && (input.isFetchingDiff || pending),
    libraryNotice: input.libraryNotice ?? null,
    caption:
      input.isTargetVersion === true && leftVersionLabel !== null
        ? `Đây là phiên bản ${leftVersionLabel} (bản đối chiếu, vì bản gốc chưa có đối tượng nào); ${marked}`
        : input.isOldVersion === true && leftVersionLabel !== null
        ? `Đây là phiên bản ${leftVersionLabel}; ${marked}`
        : leftVersionLabel === null
          ? `Đây là mô hình hiện tại chứ không phải một bản cũ; ${marked}`
          : `Đây là mô hình hiện tại chứ không phải phiên bản ${leftVersionLabel}; ${marked}`,
    scene: scene.scene,
    changedEntityIds,
    hoveredEntityId:
      capabilities.canHighlightEntity && input.hoveredEntityId !== null
        ? planEntityIdOf(input.hoveredEntityId)
        : null,
  };
}
