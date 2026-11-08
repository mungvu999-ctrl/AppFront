import { useStore } from './index';
import type { RootState } from './index';
import { draftEntityId, type EditEntityDraft } from './draftSlice';
import { MERGE_WINDOW_MS } from '../lib/commands/mergeCommands';
import type { SelectionSnapshot } from '../lib/commands/history';
import type { SpatialLayer } from '../api/client';
import type { SpatialPatch } from '../domain/spatial/applyPatch';
import { isIdOfKind } from '../domain/spatial/ids';
import { replaceLevelEntities } from '../domain/spatial/replaceLevelEntities';
import type { SpatialEntity } from '../domain/spatial/normalize';
import type { Dimension, EntityId, Level } from '../domain/spatial/types';
import { floorMetaEntryOf, versionIdFor, type FloorMetaEntry } from './spatialSlice';
import type { ScaleSource } from '../lib/viewmodel/provisionalScale';
import type { Suggestion, SuggestionsMeta } from '../api/schemas/suggestions';
import { storeReceived } from '../lib/suggestions/state';
import { useSuggestionStore } from './suggestionStore';

/**
 * The selection as it stands right now, for a command recorder to stamp on its history step.
 *
 * Read live at the moment `dispatch` pushes the step, so undo hands back the selection the
 * person had WHEN the command ran (A8, S-06) — not the one before their last click, which is
 * what a ref updated on every selection change gave (B-V7-09: undoing a rename deselected
 * the room and closed its inspector).
 */
export const currentSelection = (): SelectionSnapshot => ({
  selectedIds: useStore.getState().selectedIds,
});

export interface CommitResult {
  undo: () => void;
  label: string;
  timestamp: number;
}

/* -------------------------------------------------------------------------- */
/* One drag, one undo step.                                                    */
/* -------------------------------------------------------------------------- */

/**
 * The two undo stacks used to disagree, and the user felt it.
 *
 * `MERGE_WINDOW_MS` (= `COALESCE_WINDOW_MS`) folds a run of same-kind edits
 * into one command in `lib/commands/history`, but the undo the application
 * actually performs is zundo's `temporal` on the store, and zundo had never
 * heard of that window: two writes 200 ms apart — well inside the 400 ms run —
 * left two zundo steps, so one Ctrl+Z gave back half a drag.
 *
 * The fold happens here rather than in a `handleSet` option on `temporal`
 * because the window is a **command-layer** rule, and `commit` is the command
 * layer's only door into the store (invariant A10). A `handleSet` throttle sees
 * every write to `spatial` with no idea where it came from, so it would also
 * fold a test seeding the graph together with the first edit that follows it,
 * and fold two unrelated edits that merely landed in the same tick. What is
 * folded has to be what `canMergeCommands` folds: the same operation, on the
 * same entities, over the same fields, close enough in time — and nothing else
 * touching the graph in between.
 *
 * Suppression uses zundo's own `pause`/`resume`, not a hand-rolled timer: the
 * continuing write still happens, it just does not open a new past state, so
 * the step the run started with stays the one undo returns to. Which is the
 * same thing `mergeCommands` keeps — the **first** command's `before`.
 */
interface OpenRun {
  /** What the run is: same op, same entities, same fields. */
  readonly key: string;
  /** When the run's most recent write landed; the gap is measured from here. */
  readonly at: number;
  /** The graph the run left behind, so a foreign write closes the run. */
  readonly spatial: RootState['spatial'];
}

let openRun: OpenRun | null = null;

/** One patch as its identity: what it does, to what, to which fields. */
const patchKey = (patch: SpatialPatch): string => {
  if (patch.op === 'add') {
    return `add:${patch.kind}:${patch.entity.id}`;
  }

  if (patch.op === 'remove') {
    return `remove:${patch.kind}:${patch.id}`;
  }

  return `update:${patch.kind}:${patch.id}:${Object.keys(patch.changes).sort().join(',')}`;
};

const runKey = (patches: readonly SpatialPatch[]): string => patches.map(patchKey).join('|');

/**
 * Does this write continue the run that is already open?
 *
 * The gap is measured against the previous write, not the start of the run —
 * the rule `canMergeCommands` uses — so a continuous drag folds however long it
 * lasts and a pause of `MERGE_WINDOW_MS` closes it. The graph identity is the
 * fourth condition: anything else that wrote to `spatial` in between (a screen
 * seeding it, an undo, another commit) means the run is over, whatever the
 * clock says.
 */
const continuesRun = (key: string, timestamp: number, spatial: RootState['spatial']): boolean =>
  openRun !== null &&
  openRun.key === key &&
  openRun.spatial === spatial &&
  timestamp - openRun.at >= 0 &&
  timestamp - openRun.at < MERGE_WINDOW_MS;

/** Forgets the open run, so the next commit starts a fresh undo step. */
export function resetCommitRun(): void {
  openRun = null;
}

/**
 * The single gateway for all spatial data mutations.
 * Returns an object allowing undo, plus metadata for toasts.
 *
 * @param patch One patch, or an ordered batch applied as a single undo step.
 * @param label The Vietnamese label describing the action (e.g. "Xoá tường").
 */
export function commit(
  patch: SpatialPatch | readonly SpatialPatch[],
  label: string
): CommitResult {
  const store = useStore.getState();
  const timestamp = Date.now();
  const patches = Array.isArray(patch) ? (patch as readonly SpatialPatch[]) : [patch as SpatialPatch];
  const key = runKey(patches);

  const temporal = useStore.temporal.getState();
  const folds = continuesRun(key, timestamp, store.spatial) && temporal.isTracking;

  // Apply the patch batch to the spatial slice
  if (folds) {
    temporal.pause();
  }

  try {
    store._applyPatches(patches);
  } finally {
    if (folds) {
      useStore.temporal.getState().resume();
    }
  }

  openRun = { key, at: timestamp, spatial: useStore.getState().spatial };

  // Thả tay là lúc lượt ghi thật thay chỗ bản xem trước, nên bản nháp bị dọn ở
  // ĐÂY chứ không ở người gọi: một panel quên gọi `discardPreview` sẽ để lại một
  // bức tường ma vẽ đè lên chính bức tường vừa sửa, và không ai nhìn thấy lỗi ấy
  // trong lúc đọc mã panel. Dọn sau khi vá đã áp: giữa hai lượt `set` này không
  // có lượt vẽ nào, nên không có khung hình nào thấy "mất preview mà chưa có
  // hình mới". Xem `previewEdit` ở cuối file.
  discardPreview();

  // zundo provides temporal api on useStore
  const undo = (): void => {
    useStore.temporal.getState().undo();
  };

  // Update history slice for UI to react. The undo goes with the label: the
  // toast that offers it must not have to guess which stack the write landed on
  // (see `historySlice.lastCommitUndo`).
  store.setLastCommit(label, timestamp, undo);

  // Return the interface as requested
  return {
    undo,
    label,
    timestamp,
  };
}

/* -------------------------------------------------------------------------- */
/* Lùi lại một lượt dispatch hỏng: ghi thật, nhưng KHÔNG mở bước hoàn tác.     */
/* -------------------------------------------------------------------------- */

/**
 * Puts the graph back after a failed dispatch, without opening an undo step.
 *
 * This is `SpatialPort.revertPatches` (`lib/commands/dispatch`) for the zustand
 * store, and it is not a second door past A10: the patches it applies are the
 * ones the command layer computed to cancel its own write, and nothing outside
 * the pipeline's rollback has a reason to call it.
 *
 * A rollback is not something the user did, so it must not be something they can
 * undo. Going through {@link commit} for it left two zundo past-states for one
 * failed dispatch — the run-folding does not merge them, because a create or a
 * delete rolls back under a different patch key than it applied under — and the
 * user's next Ctrl+Z re-applied the very change that had just been cancelled.
 *
 * zundo's own `pause`/`resume` does the suppressing, the same mechanism `commit`
 * uses to fold a drag: the write still happens, it just opens no new past state,
 * so the step Ctrl+Z returns to stays the one before the failed dispatch.
 */
export function applyRollbackPatches(patches: readonly SpatialPatch[]): void {
  const temporal = useStore.temporal.getState();
  const tracking = temporal.isTracking;

  if (tracking) {
    temporal.pause();
  }

  try {
    useStore.getState()._applyPatches(patches);
  } finally {
    if (tracking) {
      useStore.temporal.getState().resume();
    }
  }

  // The failed dispatch is over; whatever run was open died with it, so the next
  // commit must not fold into it.
  resetCommitRun();
  discardPreview();
}

/* -------------------------------------------------------------------------- */
/* Lớp tầng từ máy chủ: ghi thật, không mở bước hoàn tác, không toast.         */
/* -------------------------------------------------------------------------- */

/** What a server read or save hands {@link replaceFloorLayer}. */
export interface FloorLayerReplacement {
  layer: SpatialLayer;
  revision: number;
  /**
   * The floor's dimensions from N16 (they sit beside `layer` on the wire). Absent → the
   * store keeps the floor's dimensions (a save result carries none). NO-374: without it a
   * reload left them stale, and the N15 refresh after it skips an equal `revision`.
   */
  dimensions?: readonly Dimension[];
  /** The floor's `Level`; when the store lacks the floor, it is added with this level. */
  level?: Level;
  /** From N16: the floor's scale is provisional. */
  scaleStatus?: 'unresolved';
  /** From N16, only with `scaleStatus`: where the provisional scale came from. */
  scaleSource?: ScaleSource;
  /** M2 — lớp đề xuất của tầng (N16/#35); đường đọc lại thay hẳn mục của kho lớp đề xuất. */
  suggestions?: readonly Suggestion[] | undefined;
  suggestionsMeta?: SuggestionsMeta | undefined;
  suggestionsEnabled?: true | undefined;
}

export interface ReplaceFloorLayerOptions {
  /** Somebody else changed the floor: empty history, bump `serverReplaceSeq`. */
  external?: boolean;
  /** The save carried a scale the server accepted: drop `scaleStatus`. */
  scaleSent?: boolean;
}

/**
 * Puts a layer the server returned (a save result, or a reload) into the store.
 *
 * One `set` writes `spatial`, `lastServerSpatial`, `floorMeta` and `versionId` together
 * (R14), and `temporal` is paused around it so the write opens no undo step.
 * `external: true` on a floor the store held means somebody else changed it: history is
 * emptied and `serverReplaceSeq` bumped so screens that own a second history can clear
 * theirs. A floor the store lacks is added when `result.level` comes along (history kept);
 * without it only the revision is recorded. `scaleStatus` (with `scaleSource`) stays as it
 * was unless `scaleSent` (dropped) or `result.scaleStatus` (set).
 */
export function replaceFloorLayer(
  floorId: string,
  result: FloorLayerReplacement,
  options?: ReplaceFloorLayerOptions,
): void {
  const state = useStore.getState();
  const current = state.spatial;
  const entryOf = (previous: FloorMetaEntry | undefined): FloorMetaEntry => {
    if (options?.scaleSent === true) {
      return floorMetaEntryOf(result.revision);
    }

    return floorMetaEntryOf(result.revision, result.scaleStatus === undefined ? previous : result);
  };
  const held = current !== null && current.byId[floorId] !== undefined;

  if (current === null || !isIdOfKind('level', floorId) || (!held && result.level === undefined)) {
    state.updateFloorMeta(floorId, entryOf(state.floorMeta[floorId]));

    return;
  }

  const spatial = replaceLevelEntities(current, floorId, {
    ...result.layer,
    // Máy chủ bỏ khoá `roofs` khi tầng không có mái: vắng = [] (roof-contract.md).
    roofs: result.layer.roofs ?? [],
    ...(result.dimensions === undefined ? {} : { dimensions: result.dimensions }),
    ...(result.level === undefined ? {} : { level: result.level }),
  });
  const replacedHeld = held && options?.external === true;
  const temporal = useStore.temporal.getState();
  const tracking = temporal.isTracking;

  if (tracking) {
    temporal.pause();
  }

  try {
    useStore.setState((latest) => {
      const floorMeta = { ...latest.floorMeta, [floorId]: entryOf(latest.floorMeta[floorId]) };

      return {
        spatial,
        lastServerSpatial: spatial,
        floorMeta,
        versionId: versionIdFor(floorMeta, latest.versionId),
        ...(replacedHeld ? { serverReplaceSeq: latest.serverReplaceSeq + 1 } : {}),
      };
    });
  } finally {
    if (tracking) {
      useStore.temporal.getState().resume();
    }
  }

  if (replacedHeld) {
    useStore.temporal.getState().clear();
  }

  resetCommitRun();
}

/**
 * Applies a fresh N16 read of one floor as an outside replacement — the reload path that
 * autosave (`reloadFloor` after a 409) and VersionHistory (after N19) share (review R2-4).
 *
 * `dimensions`, `level` and `scaleStatus` travel with the layer. N16 without `scaleStatus`
 * means the floor's scale is real, so a provisional status the store still holds is
 * dropped (`replaceFloorLayer` alone would keep it). Error handling stays with the caller.
 */
export function applyFloorLayerRead(floorId: string, read: FloorLayerReplacement): void {
  const { dimensions, layer, level, revision, scaleSource, scaleStatus } = read;

  replaceFloorLayer(
    floorId,
    {
      layer,
      revision,
      ...(dimensions === undefined ? {} : { dimensions }),
      ...(level === undefined ? {} : { level }),
      ...(scaleStatus === undefined ? {} : { scaleStatus }),
      ...(scaleSource === undefined ? {} : { scaleSource }),
    },
    { external: true },
  );

  if (scaleStatus === undefined && useStore.getState().floorMeta[floorId]?.scaleStatus !== undefined) {
    useStore.getState().updateFloorMeta(floorId, { revision });
  }

  // M2: bản đọc từ máy chủ thay cả lớp đề xuất; cờ bẩn/enabledChanged của bản bỏ đi không được gửi lại lên tầng mới.
  storeReceived(useSuggestionStore, floorId, read, true);
}

/* -------------------------------------------------------------------------- */
/* Xem trước: lượt ghi TẠM, cùng cửa ra vào với lượt ghi thật.                 */
/* -------------------------------------------------------------------------- */

/**
 * Đề nghị một thay đổi TẠM THỜI, để mọi người xem đọc được nó mà mô hình đã lưu
 * không bị đụng tới.
 *
 * Đây là đường hợp lệ DUY NHẤT cho tầng màn hình: `local/no-draft-write-outside-commands`
 * khoá `stageDraftOperation`/`amendDraftOperation`/`discardDraft` ngoài `src/store`,
 * và luật ấy đúng — một panel gọi thẳng vào slice thì không ai còn bảo đảm được
 * bản nháp bị dọn. Nên bản nháp có một người sản xuất, ở đúng chỗ `commit` đứng:
 * cùng một cửa, một cửa cho lượt ghi thật và một cửa cho lượt ghi tạm, và cửa
 * tạm biết tự đóng khi cửa thật mở.
 *
 * Ba lời hứa của một bản nháp, và cả ba đều có chỗ giữ:
 *
 * - **Không bao giờ vào lịch sử hoàn tác.** `temporal` chỉ theo dõi `spatial`
 *   (`store/index.ts`, `partialize`), và bản nháp không nằm trong `spatial`.
 * - **Không bao giờ được tự lưu ra máy chủ.** `useAutosave` cũng chỉ đọc
 *   `state.spatial`; bản nháp không có đường nào tới đó.
 * - **Bị dọn khi người dùng thả tay.** Lúc ấy lệnh thật chạy qua {@link commit},
 *   và `commit` dọn bản nháp trước khi trả về — xem dưới.
 *
 * Một đối tượng có nhiều nhất MỘT thao tác nháp: kéo một thanh trượt phát hàng
 * chục lượt đề nghị trên cùng một bức tường, và cộng dồn chúng thành hàng chục
 * thao tác sẽ bắt người đọc phải tự tìm cái cuối. Lượt sau SỬA lại lượt trước
 * (`amendDraftOperation`) — đúng việc mà hàm ấy được viết ra để làm.
 *
 * @param entityId Đối tượng đã lưu mà bản xem trước đứng thay.
 * @param preview Cả đối tượng như nó sẽ trông, không phải một phần khác biệt.
 */
export function previewEdit(entityId: EntityId, preview: SpatialEntity): void {
  const store = useStore.getState();
  const operation: EditEntityDraft = { kind: 'editEntity', entityId, preview };
  const index = store.draftOperations.findIndex(
    (staged) => draftEntityId(staged) === entityId,
  );

  if (index === -1) {
    store.stageDraftOperation(operation);

    return;
  }

  store.amendDraftOperation(index, operation);
}

/**
 * Bỏ bản nháp đang treo. Không có nháp nào thì không ghi gì cả.
 *
 * Người dùng huỷ (Esc, bỏ ô nhập, lệnh bị từ chối) gọi hàm này. Người dùng thả
 * tay thì không cần gọi: {@link commit} tự dọn.
 */
export function discardPreview(): void {
  if (useStore.getState().draftOperations.length > 0) {
    useStore.getState().discardDraft();
  }
}

/** M2 — phần lớp đề xuất của bộ tự lưu đi cùng chunk này (xem `suggestionSave.ts`). */
export { withSuggestions } from './suggestionSave';
