/**
 * Đường lưu của màn Pascal: một lượt sửa trong editor thành một lệnh AppFront.
 *
 * Năm chặng, theo đúng thứ tự, và không chặng nào bỏ được:
 *
 * 1. `diffScenes(trước, sau)` — Pascal không khai node nào đã đổi, nó chỉ đưa
 *    cả cảnh. Phần chênh là thứ dựng ra `PascalCommit`.
 * 2. `createChangeGate().admit(...)` — chặn lượt ghi ma (đến trước lần nạp đầu,
 *    đến trong lúc nạp lại) và chặn xoá hàng loạt (`MASS_DELETE_RATIO`).
 * 3. `createPascalEditCommand(...)` — dựng `Command` với ảnh chụp đủ hai phía.
 * 4. `dispatch(...)` — năm bước của tầng lệnh: validate → apply → history →
 *    rules → sync. Bước `apply` gọi `commit(patches, nhãn)` (A10), và chính
 *    `commit` làm bản vẽ bẩn, nên tự lưu 800 ms của A7 chạy không cần ai gọi.
 * 5. Lượt nào bị từ chối thì màn nói ra bằng tiếng Việt và giữ nguyên cảnh đã
 *    lưu làm mốc — editor tự lùi thao tác, xem `use-auto-save.ts` của vendor.
 *
 * ## Hoàn tác (A8) — vì sao không nối Ctrl+Z của editor vào ngăn lệnh
 *
 * Zundo của Pascal hoàn tác bằng cách ghi lại store cảnh. Lượt ghi ấy đi qua
 * đúng cái đăng ký mà mọi lượt sửa khác đi qua, nên nó tới đây như một lượt
 * sửa bình thường và sinh ra một `Command` ngược — không thêm dòng mã nào.
 * Nối chéo Ctrl+Z sang `HistoryStack` của AppFront thì phải đồng bộ hai ngăn
 * xếp, và hai ngăn xếp lệch nhau là lỗi không ai dựng lại được.
 */

import { useCallback, useEffect, useMemo, useRef } from 'react';

import type { PascalCommitVerdict } from '@/components/pascal/pascalMountTypes';
import { isEntityOfKind, type NormalizedSpatial } from '@/domain/spatial/normalize';
import type { Furniture, FurnitureId, MaterialRef, Room } from '@/domain/spatial/types';
import { millimetres, normaliseDegrees, radians, radiansToDegrees } from '@/domain/units/types';
import { buildCommand } from '@/lib/commands/business/shared';
import { changeForAdd, changeForUpdate } from '@/lib/commands/createCommand';
import {
  createIncrementalRuleRunner,
  dispatch,
  type DispatchDeps,
  type SpatialPort,
} from '@/lib/commands/dispatch';
import { createHistoryStack, NO_SELECTION, type HistoryStack } from '@/lib/commands/history';
import type { EntityChange } from '@/lib/commands/types';
import { ok } from '@/lib/http/types';
import { diffScenes, isEmptyDiff, sameValue } from '@/lib/pascal/diff';
import { undoFloorTransforms } from '@/lib/pascal/floorAlignment';
import { createPascalEditCommand, PASCAL_COMMAND_TYPE, reviewLostNotices, withRoomOfCentre, type PascalEditResult } from '@/lib/pascal/fromPascal';
import { createChangeGate, type PascalCommit } from '@/lib/pascal/guard';
import { bodyOfPascalId, toPascalId } from '@/lib/pascal/ids';
import { splitRoomsAfterWalls } from '@/lib/pascal/roomSplitAfterWalls';
import { isGeneratedLightId, isGeneratedNodeId } from '@/lib/pascal/sceneDressing';
import { isServerModel } from '@/lib/pascal/furnitureCatalog';
import { SUGGESTED_OUTLINE_PREFIX } from '@/lib/pascal/toPascal';
import {
  adoptableRoomOf,
  dismissableNodeIdsOf,
  isAutoSurface,
  isLooseGenerated,
  saveableModelSrc,
  saveableRef,
  type PascalIdBook,
} from '@/lib/pascal/toSpatial';
import type { PascalItemNode, PascalNode, PascalScene } from '@/lib/pascal/types';
import { buildApproveObjectCommand, buildDeleteFurnitureCommand } from '@/screens/qc/ObjectLayerReview/objectLayerReviewGateway';
import { buildSplitRoomCommandFromWalls } from '@/screens/qc/RoomLabelReview/roomLabelReviewGateway';
import { useStore } from '@/store';
import { applyRollbackPatches, commit } from '@/store/commit';

/**
 * Ai đang sửa, khi màn chưa có danh tính thật.
 *
 * `validateCommands` từ chối một lệnh thiếu `actorId`, nên hằng này là cái giữ
 * cho đường ghi chạy được trước khi phiên mang id người dùng tới — cùng khuôn
 * `AXIS_GRID_DEFAULT_ACTOR_ID` của màn trục.
 */
export const PASCAL_DEFAULT_ACTOR_ID = 'pascal-editor';

/** Câu dự phòng khi một lượt sửa bị chặn mà không ai nêu được lý do. */
export const PASCAL_REJECTED_FALLBACK = 'Không ghi được thay đổi này.';

/** Lý do từ chối khi vai chỉ được xem. */
export const PASCAL_READ_ONLY_REASON = 'Vai của bạn chỉ được xem, không sửa được mô hình.';

export interface UsePascalEditsOptions {
  /** Bản vẽ đã chuẩn hoá đang sửa; `null` nghĩa là chưa có gì để ghi lên. */
  readonly spatial: NormalizedSpatial | null;
  /** Cảnh đã đẩy sang Pascal — mốc "trước" của phần chênh đầu tiên. */
  readonly loadedScene: PascalScene | null;
  /** Vai chỉ-xem thì không lượt ghi nào được dựng, kể cả khi editor gửi tới. */
  readonly readOnly: boolean;
  /** Nói ra lý do một lượt sửa bị chặn. Màn hình quyết định hiện bằng cách nào. */
  readonly onRejected: (reason: string) => void;
  /**
   * Cổng chặn một lượt xoá hàng loạt (`PASCAL_MASS_DELETE`): màn mở hộp xác nhận
   * (A9, `guard.ts`). Editor đã lùi lượt xoá; xác nhận thì gọi
   * `confirmMassDelete(nodeIds)` rồi cho editor xoá lại đúng các node ấy.
   */
  readonly onMassDelete?: (request: PascalMassDeleteRequest) => void;
  /**
   * Phần máy chủ chưa nhận của mỗi lượt sửa (`unsavedEditsOf`, có thể rỗng). Màn báo người dùng MỖI lần và đặt
   * `restoredNodes` vào editor: mốc "trước" của lượt sau đã là cảnh sau khi đặt lại.
   */
  readonly onUnsaved?: (labels: readonly string[], restoredNodes: Readonly<Record<string, PascalNode>>) => void;
  /** Câu báo sau một lượt đã lưu, vd "Phòng X có vách mới — mở màn Phòng để tách". */
  readonly onNotice?: (message: string) => void;
  readonly actorId?: string;
}

/** Một lượt xoá hàng loạt chờ người dùng xác nhận. */
export interface PascalMassDeleteRequest {
  /** Mã node Pascal bị xoá, kể cả con cháu. */
  readonly nodeIds: readonly string[];
  /** Câu tiếng Việt của cổng: "Thay đổi này xoá … nên phải được xác nhận trước." */
  readonly reason: string;
}

export interface UsePascalEditsResult {
  /** Truyền cho khung nhúng: cảnh sau một lượt sửa. `true` khi lượt ấy đã vào kho. */
  readonly onSceneCommit: (scene: PascalScene) => Promise<boolean>;
  /** Truyền cho khung nhúng: phán quyết 6A, chạy trước khi lượt sửa vào lịch sử. */
  readonly validateCommit: (scene: PascalScene) => PascalCommitVerdict;
  /** Cảnh editor đang giữ có lượt sửa ghi được mà chưa vào kho (vendor còn đợi debounce). */
  readonly hasPendingEdit: (scene: PascalScene) => boolean;
  /** Người dùng đã xác nhận xoá đúng các node này: lượt xoá kế tiếp của chúng được qua cổng. */
  readonly confirmMassDelete: (nodeIds: readonly string[]) => void;
  /**
   * Ngăn xếp lệnh của phiên — mỗi lượt sửa Pascal đã vào kho là một bước.
   * Bảng "Lịch sử thao tác" đọc và nhảy trên CHÍNH ngăn này (23H-A-016); nhảy
   * bước ghi lại kho, và cảnh mới về Pascal qua `setScene` như mọi đổi ngoài.
   */
  readonly history: HistoryStack;
  /** Lượt vừa lưu có món gợi ý được nhận: `true` một lần, màn dựng lại cảnh để tấm viền thành mẫu thật. */
  readonly takeSuggestionAccepted: () => boolean;
  /**
   * Cảnh này (của editor, ngay sau khi màn dựng lại từ kho, đã điền mặc định) thành mốc "trước". Phần chênh của lượt dựng lại không phải
   * lượt sửa của ai; thiếu mốc này, món vừa nhận và phòng của nó đi qua `changeBetween` lần nữa, trường máy chủ tự thêm
   * sau lượt PUT (`edited`, `clearAreaM2`) làm phép so ra "đổi" và dấu duyệt vừa đặt bị bỏ kèm câu báo sai.
   */
  readonly rebaseOnRebuilt: (scene: PascalScene) => void;
}

/** Phần chênh thành lời khai của Pascal về những node đã đụng tới. */
export const commitOfScenes = (
  previous: PascalScene,
  next: PascalScene,
): PascalCommit | null => {
  const diff = diffScenes(previous, next);

  if (isEmptyDiff(diff)) return null;

  // Sàn/trần Pascal tự đặt theo tường (`isAutoSurface`) không phải phần sửa của người dùng.
  const auto = (nodeId: string) => isAutoSurface(previous.nodes[nodeId]) || isAutoSurface(next.nodes[nodeId]);
  const upserted = diff.upsert.map((node) => node.id).filter((nodeId) => !auto(nodeId));
  const removed = diff.remove.filter((nodeId) => !auto(nodeId));

  if (upserted.length === 0 && removed.length === 0) return null;

  return { origin: 'local', changedNodeIds: [...upserted, ...removed], removedNodeIds: removed };
};

/**
 * Cảnh chỉ còn thứ người dùng đã đặt xong. Trong lúc đặt, nháp của Pascal (`metadata.isTransient`: bản sao chờ thả, món
 * đang dời) nằm ngay trong cảnh và lượt tự lưu vẫn chạy: thiếu bước này nháp lên máy chủ trước cả cú thả, kể cả khi chỗ thả
 * bị từ chối. Nháp mới bỏ cả cây con; món có sẵn về bản ở `previous`. Thả xong Pascal gỡ cờ, lượt lưu sau ghi như thường.
 */
export const settledScene = (scene: PascalScene, previous: PascalScene | null): PascalScene => {
  const drafts = Object.values(scene.nodes).filter((node) => node.metadata?.['isTransient'] === true);

  if (drafts.length === 0) return scene;

  const nodes: Record<string, PascalNode> = { ...scene.nodes };
  const relink = (parentId: string | null | undefined, edit: (children: readonly string[]) => readonly string[]) => {
    const parent = parentId == null ? undefined : nodes[parentId];

    if (parent !== undefined && 'children' in parent) nodes[parent.id] = { ...parent, children: edit(parent.children) } as PascalNode;
  };
  const drop = (nodeId: string) => {
    const node = nodes[nodeId];

    if (node === undefined) return;
    delete nodes[nodeId];
    if ('children' in node) node.children.forEach(drop);
  };

  for (const draft of drafts) {
    const before = previous?.nodes[draft.id];

    if (draft.parentId !== before?.parentId) relink(draft.parentId, (children) => children.filter((id) => id !== draft.id));

    if (before === undefined) {
      drop(draft.id);
    } else {
      nodes[draft.id] = before;
      relink(before.parentId, (children) => (children.includes(draft.id) ? children : [...children, draft.id]));
    }
  }

  return { ...scene, nodes };
};

/** Câu khi người dùng xoá món bày sẵn mà không phòng nào khai hộ được (tầng không có phòng): chặn, món về chỗ cũ. */
export const GENERATED_DELETE_BLOCKED =
  'Món đồ bày sẵn này chưa xoá được: nó tự có theo phòng nên mở lại sẽ hiện lại. Món đã được đặt về chỗ cũ.';

/**
 * H4 — xoá món tự bày zone khai (`dressIds`, gồm cả đèn trần, lan can, dãy tủ: toPascal) thì lưu được
 * (`Room.dressingOff`). Còn lại chỉ món ở tầng không có phòng nào: chặn, không thì nó hiện lại ở lượt mở sau.
 * Món mất theo cha (xoá trần kéo theo đèn) không tính: cha mới là thứ người dùng xoá.
 */
export const blockedGeneratedDeletes = (previous: PascalScene, next: PascalScene, removed: readonly string[]): string[] => {
  const dismissable = dismissableNodeIdsOf(previous);

  return removed.filter((nodeId) => {
    const parentId = previous.nodes[nodeId]?.parentId ?? null;

    return (
      isGeneratedNodeId(nodeId) &&
      suggestedFurnitureIdOf(nodeId) === null &&
      !dismissable.has(nodeId) &&
      (parentId === null || next.nodes[parentId] !== undefined)
    );
  });
};

/** Câu khi người dùng sửa một món tự bày không phòng nào khai hộ được: chặn, món về như cũ. */
export const GENERATED_EDIT_BLOCKED =
  'Món đồ bày sẵn này chưa sửa được: nó tự có theo bản vẽ nên mở lại sẽ về như cũ. Món đã được đặt về như cũ.';

/** Đèn trần theo phòng, không có bản ghi nào nhớ được chỗ mới. */
export const CEILING_LIGHT_MOVE_BLOCKED = 'Đèn trần chưa dời được, chỉ xoá được.';

/** Câu sau lượt sửa đầu tiên trên món máy gợi ý: báo nhẹ, không phải lỗi. Trang dựng lại cảnh ngay nên tấm viền thành mẫu thật. */
export const SUGGESTION_ACCEPTED_NOTICE = 'Đã nhận món này vào bản vẽ.';

/** Mã món đồ gợi ý mà tấm viền `item_DRESS-suggested-<F>` đại diện (toPascal `suggestedOutlineOf`), hoặc `null`. */
const suggestedFurnitureIdOf = (nodeId: string): FurnitureId | null => {
  const body = bodyOfPascalId(nodeId);

  return body.startsWith(SUGGESTED_OUTLINE_PREFIX) ? (body.slice(SUGGESTED_OUTLINE_PREFIX.length) as FurnitureId) : null;
};

const TRANSFORM_FIELDS = ['position', 'rotation', 'scale'] as const;
const vec3Of = (value: unknown, fallback: number): readonly number[] =>
  Array.isArray(value) ? value.map((v) => (typeof v === 'number' ? v : Number.NaN)) : [fallback, fallback, fallback];
/** 1e-4 (0,1 mm / 0,0001 rad / 0,01 % tỉ lệ): lớn hơn sai số dấu phẩy động, nhỏ hơn mọi lượt sửa thật. */
const transformDiffers = (before: unknown, after: unknown): boolean =>
  TRANSFORM_FIELDS.some((key) => {
    const fallback = key === 'scale' ? 1 : 0;
    const a = vec3Of(fieldsOf(before)[key], fallback);
    const b = vec3Of(fieldsOf(after)[key], fallback);
    return a.length !== b.length || a.some((v, i) => !(Math.abs(v - (b[i] ?? Number.NaN)) < 1e-4));
  });
/** So theo giá trị, `slots` thiếu = rỗng: lượt chặn cả commit nên không được báo nhầm vì khác thứ tự khoá. */
const paintDiffers = (before: unknown, after: unknown): boolean =>
  !sameValue(fieldsOf(fieldsOf(before)['slots']), fieldsOf(fieldsOf(after)['slots'])) ||
  CUSTOM_PAINT_FIELDS.some((key) => !sameValue(fieldsOf(before)[key], fieldsOf(after)[key]));

/**
 * Lượt sửa (dời / xoay / kéo cỡ / sơn) một món tự sinh không có đường lưu: không phòng nhận nuôi (V4) và cũng
 * không phòng nào khai hộ (`dressIds`), tức chỉ còn món ở tầng không có phòng. Không chặn thì nó về như cũ khi tải lại.
 * Tấm viền gợi ý có `Furniture` đứng sau (`suggestionEditOf`); món rời thành đồ thật (`editedLooseNodeIds`).
 */
export const blockedGeneratedEdits = (previous: PascalScene, next: PascalScene, changed: readonly string[]): string[] => {
  const dismissable = dismissableNodeIdsOf(previous);

  return changed.filter((nodeId) => {
    const before = previous.nodes[nodeId];
    const after = next.nodes[nodeId];

    return (
      before !== undefined &&
      after?.type === 'item' &&
      isGeneratedNodeId(nodeId) &&
      suggestedFurnitureIdOf(nodeId) === null &&
      adoptableRoomOf(after) === null &&
      !dismissable.has(nodeId) &&
      (transformDiffers(before, after) || paintDiffers(before, after))
    );
  });
};

/** Đèn trần vừa bị dời (bằng đường nào cũng vậy): chặn, đèn về chỗ cũ. */
export const movedCeilingLights = (previous: PascalScene, next: PascalScene, changed: readonly string[]): string[] =>
  changed.filter((nodeId) => {
    const before = previous.nodes[nodeId];
    const after = next.nodes[nodeId];

    return (
      isGeneratedLightId(nodeId) &&
      before !== undefined &&
      after !== undefined &&
      transformDiffers({ position: fieldsOf(before)['position'] }, { position: fieldsOf(after)['position'] })
    );
  });

/**
 * Món rời (`isLooseGenerated`) đang khác lúc nạp: thành đồ thật, id gốc vào `dressingOff`. So với cảnh nạp nên
 * Ctrl+Z về đúng như cũ thì món lại là đồ tự sinh; tính trên cả cảnh vì `dressingOff` dựng lại mỗi lượt.
 */
export const editedLooseNodeIds = (loaded: PascalScene, scene: PascalScene): string[] => {
  const dismissable = dismissableNodeIdsOf(loaded);

  return Object.values(scene.nodes)
    .filter((node) => {
      const before = loaded.nodes[node.id];

      return before !== undefined && dismissable.has(node.id) && isLooseGenerated(node) && (transformDiffers(before, node) || paintDiffers(before, node));
    })
    .map((node) => node.id);
};

const PAINT_FIELDS = ['slots', 'material', 'materialPreset'] as const;
/** Màu tự pha (vật liệu riêng của node) — bản vẽ chưa có chỗ chứa. */
const CUSTOM_PAINT_FIELDS = ['material', 'materialPreset'] as const;
const DOOR_FIELDS = ['doorType', 'leafCount', 'hingesSide', 'swingDirection', 'slideDirection', 'openingKind'] as const;
const WINDOW_FIELDS = ['windowType', 'casementStyle', 'hingesSide', 'awningDirection'] as const;
/** H4 — kiểu `toSpatial` ghi được lên `Opening` (`doorSwingOf`/`windowSwingOf`). */
const SAVED_DOOR_TYPES: ReadonlySet<unknown> = new Set(['hinged', 'double', 'french', 'sliding', 'pocket', 'barn', 'folding']);
const SAVED_WINDOW_TYPES: ReadonlySet<unknown> = new Set(['fixed', 'sliding', 'casement']);
/** Kiểu cửa vừa đổi mà dây chưa chứa: cửa đi garage-*, cửa sổ hất/chớp…; ô trống không cánh thì lưu được. */
const openingKindUnsaved = (type: unknown, after: Readonly<Record<string, unknown>>): boolean =>
  type === 'door'
    ? after['openingKind'] !== 'opening' && !SAVED_DOOR_TYPES.has(after['doorType'] ?? 'hinged')
    : !SAVED_WINDOW_TYPES.has(after['windowType'] ?? 'fixed');

const fieldsOf = (node: unknown): Readonly<Record<string, unknown>> => (node ?? {}) as Readonly<Record<string, unknown>>;
const assetSrcOf = (node: Readonly<Record<string, unknown>>): unknown => fieldsOf(node['asset'])['src'];
const differs = (a: Readonly<Record<string, unknown>>, b: Readonly<Record<string, unknown>>, keys: readonly string[]): boolean =>
  keys.some((key) => JSON.stringify(a[key]) !== JSON.stringify(b[key]));

/** Ảnh chụp lúc món còn là gợi ý: Ctrl+Z về đúng node này thì món về đúng bản ghi này. */
type SuggestionSnapshots = Map<string, { readonly furniture: Furniture; readonly node: PascalNode }>;

/** Khe vừa sơn bằng tham chiếu ghi được; màu ngoài luật thì `unsavedPascalEdits` báo. */
const paintedSlotsOf = (before: PascalItemNode, after: PascalItemNode): Readonly<Record<string, MaterialRef>> =>
  Object.fromEntries(
    Object.entries(after.slots ?? {}).filter(
      (entry): entry is [string, MaterialRef] => entry[1] !== before.slots?.[entry[0]] && saveableRef(entry[1]),
    ),
  );

/** Lượt sửa của tấm viền đè lên `Furniture`: dời/kéo theo chênh hai cảnh, góc theo cảnh, khe mới ghi được. */
const editedFurnitureOf = (base: Furniture, before: PascalItemNode, after: PascalItemNode): Furniture => {
  const centre = {
    x: base.centre.x + Math.round((after.position[0] - before.position[0]) * 1000),
    y: base.centre.y + Math.round((after.position[2] - before.position[2]) * 1000),
  };
  const edge = (value: number, from: number, to: number, ratio: number) => Math.round(to + (value - from) * ratio);
  const sx = after.scale[0] / before.scale[0];
  const sy = after.scale[2] / before.scale[2];
  const { min, max } = base.boundingBox;
  const painted = paintedSlotsOf(before, after);
  // Ô Cao ghi `scale[1]`; `dimensions` của tấm viền mang chiều cao thật (toPascal) nên tích của chúng là số người dùng gõ.
  const heightMm = Math.round(after.asset.dimensions[1] * after.scale[1] * 1000);

  return {
    ...base,
    centre,
    ...(Math.abs(after.scale[1] - before.scale[1]) < 1e-4 || heightMm < 1 ? {} : { heightMm: millimetres(heightMm) }),
    boundingBox: {
      min: { x: edge(min.x, base.centre.x, centre.x, sx), y: edge(min.y, base.centre.y, centre.y, sy) },
      max: { x: edge(max.x, base.centre.x, centre.x, sx), y: edge(max.y, base.centre.y, centre.y, sy) },
    },
    ...(Math.abs(after.rotation[1] - before.rotation[1]) < 1e-4
      ? {}
      : { rotationDeg: normaliseDegrees(radiansToDegrees(radians(-after.rotation[1]))) }),
    ...(Object.keys(painted).length === 0 ? {} : { slots: { ...base.slots, ...painted } }),
  };
};

export interface SuggestionEdit {
  readonly changes: readonly EntityChange[];
  /** Node đã lo ở đây, `createPascalEditCommand` không xét lại. */
  readonly handled: ReadonlySet<string>;
  /** Có món vừa từ gợi ý thành đồ thật. */
  readonly accepted: boolean;
}

/**
 * Tấm viền gợi ý trong một lượt sửa = việc của màn "Duyệt cửa và nội thất", làm hộ ngay ở 3D:
 * xoá là "Bỏ gợi ý" (`buildDeleteFurnitureCommand`), dời/xoay/kéo/sơn là "Nhận gợi ý"
 * (`buildApproveObjectCommand`) rồi áp phần sửa. Ctrl+Z của Pascal tới đây như một lượt sửa thường:
 * tấm viền về đúng node gợi ý (hoặc hiện lại sau khi xoá) thì trả bản ghi gợi ý lúc đầu.
 */
export const suggestionEditOf = (
  graph: NormalizedSpatial,
  previous: PascalScene,
  next: PascalScene,
  changedNodeIds: readonly string[],
  snapshots: SuggestionSnapshots,
  actorId: string,
): SuggestionEdit => {
  const changes: EntityChange[] = [];
  const handled = new Set<string>();
  let accepted = false;
  const outlineIds = changedNodeIds.filter((nodeId) => suggestedFurnitureIdOf(nodeId) !== null);

  if (outlineIds.length === 0) return { changes, handled, accepted };

  const flatBefore = undoFloorTransforms(previous);
  const flatAfter = undoFloorTransforms(next);

  for (const nodeId of outlineIds) {
    const furnitureId = suggestedFurnitureIdOf(nodeId) as FurnitureId;

    handled.add(nodeId);
    const entity = graph.byId[furnitureId];
    const current = entity !== undefined && isEntityOfKind('furniture', entity) ? entity : undefined;
    const before = previous.nodes[nodeId];
    const after = next.nodes[nodeId];
    const realNodeId = toPascalId('item', furnitureId);

    if (current?.suggested === true && before !== undefined && !snapshots.has(nodeId)) {
      snapshots.set(nodeId, { furniture: current, node: before });
    }
    const snapshot = snapshots.get(nodeId);

    if (after === undefined) {
      // Cảnh đã dựng lại món thật thay tấm viền: không phải một lần xoá.
      if (next.nodes[realNodeId] !== undefined) continue;
      const removal = current === undefined ? null : buildDeleteFurnitureCommand({ furnitureId }, { graph, actorId });

      if (removal?.ok === true) changes.push(...removal.data.changes);
    } else if (before === undefined || (snapshot !== undefined && sameValue(after, snapshot.node))) {
      // Ctrl+Z: món về như lúc còn là gợi ý; node món thật (nếu cảnh đã dựng lại) đi theo.
      handled.add(realNodeId);
      if (snapshot === undefined) continue;
      if (current === undefined) changes.push(changeForAdd('furniture', snapshot.furniture) as EntityChange);
      else if (!sameValue(current, snapshot.furniture)) changes.push(changeForUpdate('furniture', current, snapshot.furniture) as EntityChange);
    } else if (current !== undefined && before.type === 'item' && after.type === 'item') {
      const flatOld = flatBefore.nodes[nodeId] as PascalItemNode;
      const flatNew = flatAfter.nodes[nodeId] as PascalItemNode;

      if (!transformDiffers(flatOld, flatNew) && Object.keys(paintedSlotsOf(flatOld, flatNew)).length === 0) continue;

      const base =
        current.suggested === true
          ? (buildApproveObjectCommand(current, actorId, current.id).changes[0]?.after as Furniture)
          : current;

      accepted ||= current.suggested === true;
      const rooms = Object.values(graph.byId).filter((entity): entity is Room => isEntityOfKind('room', entity));
      changes.push(changeForUpdate('furniture', current, withRoomOfCentre(editedFurnitureOf(base, flatOld, flatNew), rooms)) as EntityChange);
    }
  }

  return { changes, handled, accepted };
};

/**
 * Sơn sàn/tường/đồ có phần không ghi được: màu tự pha, hay một khe vừa đổi sang tham chiếu
 * ngoài `saveableRef` (khe về mặc định — bỏ khe — thì `toSpatial` vẫn lưu được).
 */
const paintUnsaved = (before: Readonly<Record<string, unknown>>, after: Readonly<Record<string, unknown>>): boolean => {
  const slotsBefore = fieldsOf(before['slots']);

  return (
    differs(before, after, CUSTOM_PAINT_FIELDS) ||
    Object.entries(fieldsOf(after['slots'])).some(
      ([key, ref]) => ref !== slotsBefore[key] && ref !== undefined && (typeof ref !== 'string' || !saveableRef(ref)),
    )
  );
};

/**
 * Những gì Pascal sửa được mà bản vẽ AppBack chưa có chỗ chứa (v3 BE.md major 2, EDIT.md):
 * màu cửa, kiểu cửa ngoài từ vựng `swing` (garage, cửa sổ hất…), màu và cỡ đèn trần, màu tự pha. Màu trần,
 * kiểu cửa đơn/đôi/lùa/xếp + hướng mở, xoá đồ tự bày đã lưu được (H4). Màu sàn/tường/đồ và mẫu đồ `/items/…`
 * đã lưu được (W3a, W3b) nên chỉ báo khi tham chiếu mới nằm ngoài luật ghi của `toSpatial`.
 * Lượt sửa ấy vẫn lưu phần còn lại (hoặc ra PASCAL_NO_CHANGE), nên phần không lưu được phải đặt về như cũ NGAY
 * và nói ra: người dùng không được thấy thứ mở lại sẽ mất.
 */
const unsavedOfNode = (
  nodeId: string,
  before: Readonly<Record<string, unknown>>,
  after: Readonly<Record<string, unknown>>,
): readonly (readonly [label: string, fields: readonly string[]])[] => {
  const type = after['type'];
  const painted = differs(before, after, PAINT_FIELDS);

  if (type === 'ceiling' && painted && paintUnsaved(before, after)) return [['màu trần', PAINT_FIELDS]];
  if (type === 'slab' && painted && paintUnsaved(before, after)) return [['màu sàn', PAINT_FIELDS]];
  if (type === 'wall' && painted && paintUnsaved(before, after)) return [['màu tường', PAINT_FIELDS]];
  if (isGeneratedLightId(nodeId)) {
    // Đèn trần chỉ nhớ được việc xoá (`Room.dressingOff`).
    return painted || !sameValue(before['scale'], after['scale']) ? [['màu và cỡ đèn trần', [...PAINT_FIELDS, 'scale']]] : [];
  }
  if (type === 'item') {
    // Mẫu thư viện máy chủ: `src` là URL ký nhưng toSpatial lưu đường `/items/<id>/…` thay vào.
    const serverModel = isServerModel(String(fieldsOf(after['asset'])['id']));
    const modelUnsaved = assetSrcOf(before) !== assetSrcOf(after) && !serverModel && !saveableModelSrc(assetSrcOf(after));

    return [
      ...(painted && paintUnsaved(before, after) ? [['màu đồ đạc', PAINT_FIELDS] as const] : []),
      ...(modelUnsaved ? [['mẫu đồ đạc', ['asset']] as const] : []),
    ];
  }
  if (type === 'door' || type === 'window') {
    const kindFields = type === 'door' ? DOOR_FIELDS : WINDOW_FIELDS;

    return [
      ...(painted ? [['màu cửa', PAINT_FIELDS] as const] : []),
      ...(differs(before, after, kindFields) && openingKindUnsaved(type, after) ? [['kiểu cửa', kindFields] as const] : []),
    ];
  }
  return [];
};

export interface UnsavedEdits {
  readonly labels: readonly string[];
  /** Node có phần chưa lưu được, các trường ấy đã về như `previous`; phần còn lại của node vẫn là bản mới. */
  readonly restoredNodes: Readonly<Record<string, PascalNode>>;
}

export function unsavedEditsOf(previous: PascalScene, next: PascalScene): UnsavedEdits {
  const labels = new Set<string>();
  const restoredNodes: Record<string, PascalNode> = {};

  for (const [nodeId, node] of Object.entries(next.nodes)) {
    const after = fieldsOf(node);
    // Đồ mới thêm so với "chưa có gì": khe và mẫu của nó đều là phần sửa.
    // Đèn trần sinh ra quay lại (Ctrl+Z sau khi xoá): không phải món mới mang mẫu lạ, và `scale` ~0 của nó không được xoá đi.
    const isNewItem = after['type'] === 'item' && !isGeneratedLightId(nodeId);
    const before = previous.nodes[nodeId] === undefined ? (isNewItem ? {} : null) : fieldsOf(previous.nodes[nodeId]);

    if (before === null) continue;
    const edits = unsavedOfNode(nodeId, before, after);

    if (edits.length === 0) continue;
    const restored: Record<string, unknown> = { ...after };

    for (const [label, fields] of edits) {
      labels.add(label);
      // ponytail: đồ MỚI mang mẫu không ghi được không có mẫu cũ để về, nên chỉ được báo; toàn bộ mẫu trong danh mục đều ghi được.
      for (const field of fields) if (field !== 'asset' || before['asset'] !== undefined) restored[field] = before[field];
    }
    restoredNodes[nodeId] = restored as unknown as PascalNode;
  }

  // Xoá món bày sẵn không nhớ được không tới đây: `blockedGeneratedDeletes` chặn cả lượt.
  return { labels: [...labels], restoredNodes };
}

export const unsavedPascalEdits = (previous: PascalScene, next: PascalScene): string[] => [...unsavedEditsOf(previous, next).labels];

export function usePascalEdits({
  spatial,
  loadedScene,
  readOnly,
  onRejected,
  onMassDelete,
  onUnsaved,
  onNotice,
  actorId = PASCAL_DEFAULT_ACTOR_ID,
}: UsePascalEditsOptions): UsePascalEditsResult {
  /** Cảnh máy chủ đang giữ. Mốc "trước" của lượt sửa kế tiếp. */
  const savedScene = useRef<PascalScene | null>(null);

  /* Cảnh từ nguồn ngoài vừa nạp vào editor thay mốc: lượt sửa sau so với nó,
     không so với lượt lưu cũ — thiếu dòng này thì thay đổi ngoài bị ghi lại
     như một lượt sửa của Pascal. */
  useEffect(() => {
    savedScene.current = null;
  }, [loadedScene]);
  /** Sổ id của phiên: đối tượng Pascal vừa vẽ giữ nguyên id qua nhiều lượt sửa. */
  const idBook = useRef<PascalIdBook>(new Map());
  const suggestionSnapshots = useRef<SuggestionSnapshots>(new Map());
  const gate = useMemo(() => createChangeGate(), []);
  /**
   * Phán quyết gần nhất, kèm cảnh nó đã xét.
   *
   * `validateCommit` và `onSceneCommit` nhận **cùng một cảnh** cho cùng một
   * lượt sửa, nên dựng lệnh hai lần là dựng thừa — và `toSpatialGraph` chạy
   * trên cả cây, không phải phép tính rẻ.
   */
  const lastVerdict = useRef<{
    scene: PascalScene;
    result: PascalEditResult | null;
    /** Lượt này là xoá hàng loạt bị cổng chặn — các node bị xoá. */
    massDelete: readonly string[] | null;
    /** Phòng có vách mới mà không tách gọn được (`splitRoomsAfterWalls`). */
    notices: readonly string[];
    /** Có món gợi ý vừa được nhận. */
    accepted: boolean;
  } | null>(null);
  const acceptedPending = useRef(false);
  /** Node người dùng đã xác nhận xoá; sống tới khi lượt xoá ấy vào kho. */
  const confirmedRemoval = useRef<ReadonlySet<string> | null>(null);

  const label = useRef('');
  const history = useMemo(() => createHistoryStack(), []);

  const deps = useMemo<DispatchDeps>(() => {
    const spatialPort: SpatialPort = {
      read: () => useStore.getState().spatial,
      applyPatches: (patches) => {
        commit(patches, label.current);
      },
      revertPatches: applyRollbackPatches,
    };

    return {
      spatial: spatialPort,
      history: {
        push: (entry) => {
          history.push({ entry, selectionBefore: NO_SELECTION, selectionAfter: NO_SELECTION });
        },
        drop: (entryId) => {
          history.drop(entryId);
        },
      },
      rules: createIncrementalRuleRunner(),
      /* Bước `sync` không xếp hàng gì: `commit` đã làm bản vẽ bẩn và bộ tự lưu
         tầng mà container gắn (`useFloorLayerAutosave`) nhặt nó lên sau 800 ms. Một lượt gửi thứ
         hai ở đây là gửi hai lần cùng một thay đổi. */
      sync: { enqueue: () => undefined },
    };
  }, [history]);

  /** `validateCommit` và `onSceneCommit` phải thấy cùng một cảnh đã lọc, phán quyết mới dùng lại được. */
  const settled = useRef<{ raw: PascalScene; scene: PascalScene } | null>(null);
  const settle = useCallback(
    (raw: PascalScene): PascalScene => {
      if (settled.current?.raw !== raw) settled.current = { raw, scene: settledScene(raw, savedScene.current ?? loadedScene) };

      return settled.current.scene;
    },
    [loadedScene],
  );

  /** Lệnh cho một cảnh, lời từ chối, hoặc `null` khi không có gì để ghi. */
  const buildFor = useCallback(
    (scene: PascalScene): PascalEditResult | null => {
      if (lastVerdict.current?.scene === scene) return lastVerdict.current.result;

      const previous = savedScene.current ?? loadedScene;

      if (spatial === null || previous === null) return null;

      const pascalCommit = commitOfScenes(previous, scene);

      if (pascalCommit === null) return null;

      // Cảnh đầu đã nằm trong Pascal rồi mới có lượt sửa này, nên cổng ở
      // trạng thái "đã nạp" — không có đường nào khác để nó biết điều đó.
      if (!gate.hasLoaded()) gate.acknowledgeLoad();

      const removed = pascalCommit.removedNodeIds ?? [];

      const blockedDeletes = blockedGeneratedDeletes(previous, scene, removed);
      const blockedEdits = blockedGeneratedEdits(previous, scene, pascalCommit.changedNodeIds);

      const movedLights = movedCeilingLights(previous, scene, pascalCommit.changedNodeIds);

      if (blockedDeletes.length > 0 || blockedEdits.length > 0 || movedLights.length > 0) {
        const reason =
          movedLights.length > 0 ? CEILING_LIGHT_MOVE_BLOCKED : blockedDeletes.length > 0 ? GENERATED_DELETE_BLOCKED : GENERATED_EDIT_BLOCKED;
        const blocked: PascalEditResult = {
          ok: false,
          error: { type: 'pascal.edit', code: 'PASCAL_UNKNOWN_NODE', reasons: [reason] },
        };

        lastVerdict.current = { scene, result: blocked, massDelete: null, notices: [], accepted: false };

        return blocked;
      }

      const confirmed = confirmedRemoval.current;
      const gateVerdict = gate.admit(pascalCommit, previous);
      const massDelete = !gateVerdict.admitted && gateVerdict.code === 'PASCAL_MASS_DELETE';
      const verdict =
        massDelete && confirmed !== null && removed.every((nodeId) => confirmed.has(nodeId))
          ? ({ admitted: true } as const)
          : gateVerdict;

      const suggestion = suggestionEditOf(spatial, previous, scene, pascalCommit.changedNodeIds, suggestionSnapshots.current, actorId);
      const others = (nodeIds: readonly string[]) => nodeIds.filter((nodeId) => !suggestion.handled.has(nodeId));
      const rest: PascalEditResult = verdict.admitted
        ? createPascalEditCommand({
            graph: spatial,
            scene,
            commit: { ...pascalCommit, changedNodeIds: others(pascalCommit.changedNodeIds), removedNodeIds: others(removed) },
            adoptNodeIds: editedLooseNodeIds(loadedScene ?? previous, scene),
            actorId,
            idBook: idBook.current,
          })
        : { ok: false, error: { type: 'pascal.edit', code: 'PASCAL_UNKNOWN_NODE', reasons: [verdict.reason] } };
      const restEmpty = !rest.ok && rest.error.code === 'PASCAL_NO_CHANGE';
      const edit: PascalEditResult =
        suggestion.changes.length > 0 && (rest.ok || restEmpty)
          ? ok(
              buildCommand(
                PASCAL_COMMAND_TYPE,
                rest.ok ? rest.data.description : 'Từ màn 3D: sửa đồ máy gợi ý.',
                [...(rest.ok ? rest.data.changes : []), ...suggestion.changes],
                { graph: spatial, actorId },
              ),
            )
          : rest;

      // W3d — vách mới cắt đôi phòng: lệnh tách gộp vào cùng lệnh, một bước hoàn tác.
      const split = edit.ok ? splitRoomsAfterWalls(spatial, edit.data, buildSplitRoomCommandFromWalls) : null;
      const result: PascalEditResult = split === null ? edit : { ok: true, data: split.command };

      lastVerdict.current = {
        scene,
        result,
        massDelete: massDelete && !verdict.admitted ? removed : null,
        accepted: result.ok && suggestion.accepted,
        notices: [
          ...(split?.notices ?? []),
          // Ctrl+Z trả món về gợi ý là bỏ dấu duyệt do chính lượt nhận đặt: không phải "vừa sửa đồ đã duyệt".
          ...(result.ok
            ? reviewLostNotices({
                ...result.data,
                changes: result.data.changes.filter((change) => !suggestion.changes.some((own) => own.id === change.id)),
              })
            : []),
          ...(result.ok && suggestion.accepted ? [SUGGESTION_ACCEPTED_NOTICE] : []),
        ],
      };

      return result;
    },
    [actorId, gate, loadedScene, spatial],
  );

  const validateCommit = useCallback(
    (scene: PascalScene): PascalCommitVerdict => {
      if (readOnly) return { ok: false, message: PASCAL_READ_ONLY_REASON };

      const built = buildFor(settle(scene));

      /* Không có gì để ghi là chuyện bình thường — lượt nạp đầu gần như luôn
         rơi vào đây — nên nó KHÔNG phải một lời từ chối với người dùng. */
      if (built === null || built.ok || built.error.code === 'PASCAL_NO_CHANGE') {
        return { ok: true };
      }

      const message = built.error.reasons[0] ?? PASCAL_REJECTED_FALLBACK;
      const massDelete = lastVerdict.current?.massDelete ?? null;

      // 23-A-026 — A9: lượt xoá lớn hỏi trước (GD:27-30), không chỉ toast.
      if (massDelete !== null) onMassDelete?.({ nodeIds: massDelete, reason: message });

      return { ok: false, message };
    },
    [buildFor, onMassDelete, readOnly, settle],
  );

  const confirmMassDelete = useCallback((nodeIds: readonly string[]) => {
    confirmedRemoval.current = new Set(nodeIds);
  }, []);

  // Lượt bị từ chối cũng không tính: có lưu đâu mà mất, editor đặt nó về như cũ ở lượt lưu kế tiếp.
  const hasPendingEdit = useCallback(
    (scene: PascalScene): boolean => !readOnly && buildFor(settle(scene))?.ok === true,
    [buildFor, readOnly, settle],
  );

  const onSceneCommit = useCallback(
    async (raw: PascalScene): Promise<boolean> => {
      if (readOnly) return false;

      const scene = settle(raw);
      const previous = savedScene.current ?? loadedScene;
      const built = buildFor(scene);
      const notices = lastVerdict.current?.scene === scene ? lastVerdict.current.notices : [];
      const accepted = lastVerdict.current?.scene === scene && lastVerdict.current.accepted;

      if (built === null) return false;

      /* Phần máy chủ chưa nhận: đặt về như cũ và báo, cả khi phần còn lại lưu được lẫn khi chỉ còn "không có gì để ghi".
         Mốc đi theo cảnh đã đặt lại, không thì lượt tự lưu sau tính phần đặt lại thành một lượt sửa nữa. */
      const settleUnsaved = (): void => {
        if (previous === null) return;
        const { labels, restoredNodes } = unsavedEditsOf(previous, scene);

        if (labels.length > 0) savedScene.current = { ...scene, nodes: { ...scene.nodes, ...restoredNodes } };
        onUnsaved?.(labels, restoredNodes);
      };

      if (!built.ok) {
        if (built.error.code === 'PASCAL_NO_CHANGE') {
          settleUnsaved();
        } else {
          onRejected(built.error.reasons[0] ?? PASCAL_REJECTED_FALLBACK);
        }

        return false;
      }

      label.current = built.data.description;

      const result = await dispatch(built.data, deps);

      if (!result.ok) {
        onRejected(result.error.reasons[0] ?? PASCAL_REJECTED_FALLBACK);

        return false;
      }

      savedScene.current = scene;
      settleUnsaved();
      confirmedRemoval.current = null;
      acceptedPending.current ||= accepted;
      notices.forEach((message) => onNotice?.(message));

      return true;
    },
    [buildFor, deps, loadedScene, onNotice, onRejected, onUnsaved, readOnly, settle],
  );

  const takeSuggestionAccepted = useCallback(() => {
    const accepted = acceptedPending.current;

    acceptedPending.current = false;

    return accepted;
  }, []);

  const rebaseOnRebuilt = useCallback((scene: PascalScene) => {
    savedScene.current = scene;
  }, []);

  return { onSceneCommit, validateCommit, hasPendingEdit, confirmMassDelete, history, takeSuggestionAccepted, rebaseOnRebuilt };
}
