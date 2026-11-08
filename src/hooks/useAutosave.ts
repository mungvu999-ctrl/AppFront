import { useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';

import type { ApiClient } from '@/api/client';
import type { FloorLayerSaver } from '@/lib/autosave/spatialLayerSave';
import { getSessionSnapshot } from '@/lib/auth/state';
import { guardBeforeUnload } from '@/lib/autosave/beforeUnload';
import { clearPendingEdits, notePendingEdit } from '@/lib/autosave/pendingEdits';
import { queryClient } from '@/lib/query/queryClient';

import { createAutosave, isTransientAutosaveError, type Autosave, type AutosaveEngine } from '../lib/autosave/createAutosave';
import { formatClockTime } from '../lib/format/datetime';
import { appNotificationBus } from './useNotifications';
import type { RootState } from '../store';
import { useStore } from '../store';
import { floorMetaEntryOf } from '../store/spatialSlice';

/* -------------------------------------------------------------------------- */
/* Mọi bộ tự lưu đang gắn — để Ctrl+S có ĐÚNG MỘT hệ để xả.                    */
/* -------------------------------------------------------------------------- */

/**
 * Các engine `createAutosave` đang sống, một mục cho mỗi hook đang gắn.
 *
 * Vỏ ứng dụng (`src/routes/router.tsx`) cần một lối "lưu ngay" cho Ctrl+S, mà
 * vỏ thì không biết dự án nào đang mở hay màn nào đang sửa cái gì. Cách sai là
 * cho vỏ dựng bộ tự lưu THỨ HAI của riêng nó: hai engine cùng theo dõi
 * `state.spatial` sẽ gửi hai lượt ghi cho mỗi thay đổi, đúng thứ lỗ hổng #7
 * ("một hệ tự lưu duy nhất") vừa được dọn. Nên vỏ không sở hữu engine nào —
 * nó xả engine mà màn đang mở đã dựng, qua {@link flushAutosaves}.
 *
 * `Set` chứ không phải một biến đơn: hai màn có thể cùng gắn (panel thanh tra
 * nằm bên trong một màn khác), và cả hai đều đáng được lưu khi người dùng bấm
 * Ctrl+S. Rỗng là chuyện bình thường — một màn không sửa gì thì không có gì
 * để xả, và {@link flushAutosaves} khi đó không làm gì.
 */
const mountedAutosaves = new Set<Autosave>();

/**
 * Lưu ngay mọi bộ tự lưu đang gắn, thay vì đợi hết cửa sổ 800 ms của A7.
 *
 * An toàn khi không có gì để lưu: `saveNow` của một engine không có thay đổi
 * nào sẽ giải quyết mà không gọi `onSave` lần nào. Trả về một `Promise` đợi
 * ĐỦ mọi lượt lưu, để nơi gọi (và bài kiểm) biết lượt xả đã xong. Không ném: lượt
 * hỏng, xung đột phiên bản hay sửa còn chờ đều ra `{ok: false, reason}` (H3.1 — màn Xuất
 * chỉ xuất khi `ok`).
 *
 * Đây là thứ Ctrl+S gọi. **Không** có nút Lưu nào được sinh ra kèm theo — A7
 * nói phím tắt là lối tắt của bộ đếm giờ, không phải một nút bấm mới.
 */
export async function flushAutosaves(): Promise<FlushResult> {
  const engines = [...mountedAutosaves];

  await Promise.allSettled(engines.map((autosave) => autosave.saveNow()));

  // Sau lượt xả, engine nào không về `'saved'` là còn sửa chưa tới máy chủ (hỏng, chờ thử lại, mất mạng).
  if (engines.some((autosave) => autosave.getState() === 'offline')) {
    return { ok: false, reason: FLUSH_OFFLINE };
  }

  if (engines.some((autosave) => autosave.getState() !== 'saved')) {
    return { ok: false, reason: FLUSH_FAILED };
  }

  // Tầng bị khối (409 xung đột phiên bản, 422…) không còn "gửi được" nên engine vẫn về `'saved'`:
  // sổ `unsavedFloorIds` mới là thứ nói tầng ấy chưa lưu.
  const unsaved = useStore.getState().unsavedFloorIds;

  if (unsaved.length > 0) {
    const message = unsaved.map((floorId) => book?.saver?.getBlock(floorId)?.message).find((text) => text !== undefined);

    return { ok: false, reason: message ?? FLUSH_UNSENT };
  }

  return { ok: true };
}

/** Kết quả {@link flushAutosaves}: `ok: false` mang câu tiếng Việt nói vì sao chưa lưu hết. */
export type FlushResult = { ok: true } | { ok: false; reason: string };

export const FLUSH_FAILED = 'Chưa lưu được thay đổi: lượt lưu vừa rồi bị lỗi.';
export const FLUSH_OFFLINE = 'Chưa lưu được thay đổi: đang mất kết nối mạng.';
export const FLUSH_UNSENT = 'Còn thay đổi của tầng chưa gửi được lên máy chủ.';

/**
 * Ghi một engine vào sổ của {@link flushAutosaves} suốt thời gian component còn
 * gắn, gỡ khi tháo.
 *
 * Tách khỏi {@link useAutosave} vì hook ấy khoá cứng vào `state.spatial`: màn nào
 * tự dựng `createAutosave` (vì cần chọn đích lưu, hay cần `useSaveIndicator`) thì
 * trước đây không có đường nào vào sổ, nên Ctrl+S không thấy nó (B-V7-01).
 * Một engine chỉ được đăng ký ở MỘT chỗ — đăng ký hai lần là hai lượt lưu.
 */
export function useFlushOnSave(autosave: Autosave): void {
  useEffect(() => {
    mountedAutosaves.add(autosave);

    return () => {
      mountedAutosaves.delete(autosave);
    };
  }, [autosave]);
}

export interface UseAutosaveHandle {
  /**
   * The exact string this hook has always returned: `null` before the first
   * completed cycle, then `"Đã lưu lúc HH:mm"` or `"Lưu thất bại"`. Kept
   * byte-for-byte on purpose — `ConnectedSaveIndicator`
   * (`components/feedback/SaveIndicator.tsx:109`, outside this task's
   * whitelist) recognizes a failed save by exact string match
   * (`saveLabel === 'Lưu thất bại'`); the longer, friendlier failure copy in
   * `src/i18n/vi.json` (`autosave.failed`) belongs to `useSaveIndicator`
   * (`hooks/useSaveIndicator.ts`), a separate read-only view onto the same
   * engine, not to this one.
   */
  label: string | null;
  /**
   * Saves right now instead of waiting out the debounce window. Safe with
   * nothing pending — resolves without calling `onSave`. This is the export
   * `docs/contracts/property-inspector/commands.md` C8#7 found missing: with
   * nothing to call, Ctrl+S had nothing to do.
   */
  flush: () => Promise<void>;
}

/**
 * The engine shared by {@link useAutosave} and {@link useAutosaveFlush}: a
 * thin React face over `createAutosave`
 * (`src/lib/autosave/createAutosave.ts`), which is now the ONLY autosave
 * debounce implementation in the repo — this hook used to hand-roll its own
 * `setTimeout` (`AUTOSAVE_DEBOUNCE_MS`); it no longer does, and the 800 ms
 * figure itself is not written here — it is `createAutosave`'s own
 * `DEFAULT_DEBOUNCE_MS`, per invariant A7.
 *
 * Watches `state.spatial` directly, exactly as before: every existing caller
 * only supplies *where* a save goes
 * (`usePropertyInspector.ts:1059`, `useScaleCalibration.ts:625`,
 * `useDimensionOcrReview.ts:576`), never the data itself. A failed `onSave`
 * now runs through `createAutosave`'s own retry schedule
 * (`retrySchedule.ts`: 5s/15s/45s) and offline detection instead of flipping
 * straight to "Lưu thất bại" after one attempt.
 */
function useAutosaveHandle(onSave: (data: RootState['spatial']) => Promise<void>): UseAutosaveHandle {
  const spatial = useStore((state) => state.spatial);

  const spatialRef = useRef(spatial);
  spatialRef.current = spatial;

  const onSaveRef = useRef(onSave);
  onSaveRef.current = onSave;

  const autosave = useMemo<Autosave>(
    () =>
      createAutosave<NonNullable<RootState['spatial']>>({
        getChanges: () => spatialRef.current ?? undefined,
        // Returns the callback's own promise directly (no `async`/`await`
        // wrapper here) so a failing save rejects in the same number of
        // microtask turns as before this hook grew an engine underneath it.
        save: (changes) => onSaveRef.current(changes),
      }),
    [],
  );

  const label = useEngineLabel(autosave);

  /* Ghi tên engine này vào sổ dùng chung, để Ctrl+S của vỏ xả được nó mà không
     cần biết màn nào đang mở. */
  useFlushOnSave(autosave);

  /*
   * Chỉ một bản SỬA mới hẹn lưu. Một lượt nạp (`setSpatial`, kể cả của cổng nạp
   * kho dự án — B-V12-01) đổi `spatial` nhưng xoá lịch sử hoàn tác, nên hai ngăn
   * zundo cùng rỗng; lưu lại thứ vừa đọc từ máy chủ là ghi thừa, và với panel
   * thuộc tính là ghi đè (Q13). Hoàn tác về đúng bản đã nạp vẫn hẹn lưu, vì khi
   * ấy ngăn `futureStates` có một bước.
   */
  useEffect(() => {
    if (!spatial) {
      return;
    }

    const { futureStates, pastStates } = useStore.temporal.getState();

    if (pastStates.length + futureStates.length > 0) {
      autosave.notifyChange();
    }
  }, [spatial, autosave]);

  return { flush: autosave.saveNow, label };
}

/** `null` → "Đã lưu lúc HH:mm" | "Lưu thất bại"; `dirty`/`saving`/`offline` giữ nhãn đang hiện. */
function useEngineLabel(autosave: Autosave): string | null {
  const state = useSyncExternalStore(autosave.subscribe, autosave.getState, autosave.getState);
  const [label, setLabel] = useState<string | null>(null);

  useEffect(() => {
    if (state === 'saved') {
      const lastSavedAt = autosave.getLastSavedAt();

      // Chưa lưu lần nào mà về 'saved' (engine `reset()` sau tải lại — BUG-415): bỏ nhãn lỗi cũ.
      setLabel(lastSavedAt === undefined ? null : `Đã lưu lúc ${formatClockTime(new Date(lastSavedAt))}`);

      return;
    }

    if (state === 'failed') {
      setLabel('Lưu thất bại');
    }

    // 'dirty' | 'saving' | 'offline': sticky — the label already on screen
    // stays put, exactly as it did while the old hand-rolled timer counted
    // down (it only ever wrote a new label from inside its own callback).
  }, [state, autosave]);

  return label;
}

/**
 * Invariant A7's autosave: waits for 800 ms of silence after the last store
 * change, then calls `onSave` with the current `state.spatial`. Signature and
 * return value are unchanged from before this file gained an engine
 * underneath it.
 */
export function useAutosave(onSave: (data: RootState['spatial']) => Promise<void>): string | null {
  return useAutosaveHandle(onSave).label;
}

/**
 * Same engine as {@link useAutosave}, plus `flush` for a caller that needs to
 * save on demand (a "before you leave" guard, a test that would rather not
 * wait out 800 ms) rather than only after the debounce window.
 *
 * Ctrl+S does **not** go through here: the shell has no `onSave` of its own to
 * pass, so it calls {@link flushAutosaves} and flushes whichever engine the
 * open screen already built. Use this one when the caller owns the save
 * target itself.
 */
export function useAutosaveFlush(onSave: (data: RootState['spatial']) => Promise<void>): UseAutosaveHandle {
  return useAutosaveHandle(onSave);
}

/* -------------------------------------------------------------------------- */
/* Sổ saver lớp tầng (F-04x-1 bước 5): MỘT bộ lưu cho mỗi người–dự án.         */
/* -------------------------------------------------------------------------- */

type SpatialClient = Pick<ApiClient, 'spatial'>;

/**
 * Ống nặng nạp lười. File này nằm trong chunk vào (router nhập `flushAutosaves`), còn
 * `spatialLayerSave` kéo theo zod và schema — nhập tĩnh là +19 KiB gzip cho chunk vào.
 */
const loadPipes = () =>
  Promise.all([
    import('@/lib/autosave/spatialLayerSave'),
    import('@/store/commit'),
    import('@/lib/query/invalidation'),
  ]).then(([save, commitModule, invalidation]) => ({
    applyInvalidation: invalidation.applyInvalidation,
    changedDimensionLevelIds: save.changedDimensionLevelIds,
    changedLevelIds: save.changedLevelIds,
    classifyLayerSaveError: save.classifyLayerSaveError,
    dimensionsOf: save.dimensionsOf,
    createFloorLayerSaver: commitModule.withSuggestions(save.createFloorLayerSaver),
    applyFloorLayerRead: commitModule.applyFloorLayerRead,
    replaceFloorLayer: commitModule.replaceFloorLayer,
    spatialLayerOf: save.spatialLayerOf,
  }));

type Pipes = Awaited<ReturnType<typeof loadPipes>>;

let pipes: Pipes | null = null;
let pipesLoading: Promise<Pipes> | null = null;

const getPipes = (): Promise<Pipes> =>
  pipes
    ? Promise.resolve(pipes)
    : (pipesLoading ??= loadPipes().then(
        (loaded) => (pipes = loaded),
        (error: unknown) => {
          pipesLoading = null;
          throw error;
        },
      ));

interface SaverBook {
  readonly userId: string;
  readonly projectId: string;
  readonly engine: AutosaveEngine;
  readonly reloadErrors: Map<string, string>;
  readonly listeners: Set<() => void>;
  readonly stops: Array<() => void>;
  /**
   * Mốc so cho những sửa xảy ra trước khi ống nạp xong: đồ thị lúc mở sổ, dời theo mỗi lượt
   * nạp máy chủ (NO-359 — không thì lượt nạp ấy bị tính là sửa, sinh một PUT thừa).
   */
  opened: RootState['spatial'];
  saver: FloorLayerSaver | null;
  api: SpatialClient | null;
  /**
   * Bản cuối của dự án này khi kho đã rời sang dự án khác (cổng nạp ghi kho TRƯỚC khi hook
   * khoá mới gắn) — lượt xả lúc đóng sổ đọc lớp và revision từ đây (review F-04x-1 P2-1).
   */
  departed: Pick<RootState, 'spatial' | 'floorMeta'> | null;
  version: number;
  disposed: boolean;
}

let book: SaverBook | null = null;

const RELOAD_FAILED = 'Không tải lại được tầng này. Thử lại sau.';
const SAVE_UNAVAILABLE = 'Không lưu được thay đổi của tầng này.';
/** Toast sau "Tải lại" ở dải xung đột: sửa cục bộ (vd. duyệt tường) đã bị bỏ — `vi.json` `floorLayerSave.reloadDiscarded`. */
export const FLOOR_LAYER_RELOAD_DISCARDED = 'Đã tải lại bản mới nhất của tầng; các thay đổi chưa lưu đã bị bỏ.';
/** Toast khi quay lại tab mà tầng đã được sửa ở nơi khác (U14): kho nạp bản mới, không đợi 409. */
export const FLOOR_LAYER_UPDATED_ELSEWHERE = 'Tầng này vừa được sửa ở nơi khác. Đã cập nhật bản mới nhất.';

/**
 * UX-43: tab lưu xong một tầng thì báo các tab khác cùng trình duyệt — tab cũ đọc bản mới ngay,
 * không đợi người dùng sửa rồi mới gặp 409 (focus/visibilitychange không phải lúc nào cũng có).
 */
export const FLOOR_LAYER_SAVED_CHANNEL = 'floor-layer-saved';

interface PeerSaved {
  floorId?: string;
  projectId?: string;
}

/** Một kênh cho cả tab, gửi và nghe chung: kênh không tự nhận tin của chính nó, nên tab không tự đọc lại. */
let peerChannel: BroadcastChannel | null | undefined;
const peerListeners = new Set<(saved: PeerSaved) => void>();

const peer = (): BroadcastChannel | null => {
  if (peerChannel === undefined) {
    peerChannel = typeof BroadcastChannel === 'undefined' ? null : new BroadcastChannel(FLOOR_LAYER_SAVED_CHANNEL);

    if (peerChannel) {
      peerChannel.onmessage = (event: MessageEvent<PeerSaved | null>) => {
        peerListeners.forEach((listener) => listener(event.data ?? {}));
      };
    }
  }

  return peerChannel;
};

const announceSaved = (projectId: string, floorId: string): void => {
  peer()?.postMessage({ floorId, projectId });
};

const bump = (target: SaverBook): void => {
  target.version += 1;
  target.listeners.forEach((listener) => listener());
};

const spatialApiOf = async (target: SaverBook): Promise<SpatialClient> =>
  (target.api ??= (await import('@/api/appClient')).createAppApiClient());

const markChanged = (
  target: SaverBook,
  floorIds: readonly string[],
  dimensionFloorIds: readonly string[] = [],
): void => {
  if (target.saver && floorIds.length > 0) {
    target.saver.markDirty(floorIds, dimensionFloorIds);
    target.engine.notifyChange();
  }
};

/** Gắn saver khi ống đã nạp; sửa xảy ra trước đó (so với `opened`) được đánh dấu bẩn ngay. */
const attachSaver = (target: SaverBook, loaded: Pipes): void => {
  if (target.disposed || target.saver) {
    return;
  }

  const { opened, projectId } = target;
  const owns = (): boolean => useStore.getState().spatialProjectId === projectId;
  /** Kho của dự án này: kho sống khi còn sở hữu, không thì bản nhớ lúc rời. */
  const source = (): Pick<RootState, 'spatial' | 'floorMeta'> | null => (owns() ? useStore.getState() : target.departed);

  target.saver = loaded.createFloorLayerSaver(projectId, {
    onSaved(floorId, result, { redirtied, scaleSent }) {
      if (target.disposed || !owns()) {
        return;
      }


      if (redirtied) {
        // Sửa đang chờ giữ nguyên; `scaleStatus` chỉ mất khi chính lượt này mang tỉ lệ.
        const held = scaleSent ? undefined : useStore.getState().floorMeta[floorId];

        useStore.getState().updateFloorMeta(floorId, floorMetaEntryOf(result.revision, held));
      } else {
        loaded.replaceFloorLayer(floorId, result, scaleSent ? { scaleSent } : undefined);
      }

      loaded.applyInvalidation(queryClient, 'persistSpatialLayer', { floorId, projectId });
      announceSaved(projectId, floorId);

      if (scaleSent) {
        loaded.applyInvalidation(queryClient, 'persistFloorScale', { floorId, projectId });
      }
    },
    readLayer(floorId) {
      const spatial = target.disposed ? null : (source()?.spatial ?? null);
      const level = spatial?.byId[floorId];

      return spatial && level?.id === floorId && 'order' in level ? loaded.spatialLayerOf(spatial, level.id) : null;
    },
    readDimensions(floorId) {
      const spatial = target.disposed ? null : (source()?.spatial ?? null);
      const level = spatial?.byId[floorId];

      return spatial && level?.id === floorId && 'order' in level ? loaded.dimensionsOf(spatial, level.id) : null;
    },
    // Không chặn theo `disposed`: lượt xả lúc đổi dự án chạy SAU `dispose()`, và base 0 là 409 chắc.
    // M2: bật/tắt lớp/món đề xuất, nhận nuôi → lượt lưu của tầng ấy (`store/suggestionSave` theo dõi kho tới khi đóng sổ).
    onSuggestionTouched: (floorIds) => markChanged(target, floorIds),
    readRevision: (floorId) => source()?.floorMeta[floorId]?.revision ?? null,
    writeLayer: async (input) => (await spatialApiOf(target)).spatial.writeLayer(input),
  });
  target.saver.subscribe((unsavedFloorIds) => {
    useStore.getState().setUnsavedFloorIds(unsavedFloorIds);
    // UX-40: đã gửi hết thì dải mất mạng không còn thao tác nào chờ.
    if (unsavedFloorIds.length === 0) {
      clearPendingEdits();
    }
    bump(target);
  });

  const { spatial } = useStore.getState();

  if (opened && spatial && opened !== spatial && owns()) {
    markChanged(target, loaded.changedLevelIds(opened, spatial), loaded.changedDimensionLevelIds(opened, spatial));
  }
};

const closeBook = (target: SaverBook, flush: boolean): void => {
  if (flush) {
    void target.saver?.flush().catch(() => undefined);
  }

  target.disposed = true;
  target.saver?.dispose();
  target.stops.forEach((stop) => stop());
  mountedAutosaves.delete(target.engine);
  useStore.getState().setUnsavedFloorIds([]);
  clearPendingEdits();
};

/** Saver của cặp `userId:projectId` hiện tại; đổi khoá thì đóng saver cũ (cùng người: xả trước). */
function openBook(projectId: string): SaverBook {
  const userId = getSessionSnapshot().user?.id ?? '';

  if (book?.userId === userId && book.projectId === projectId) {
    return book;
  }

  if (book) {
    closeBook(book, book.userId === userId);
  }

  const opened = useStore.getState().spatial;
  /** Ống chưa gắn mà kho đã khác lúc mở sổ: có sửa chờ, dù saver chưa biết. */
  const pendingBeforeAttach = (): boolean => created.saver === null && useStore.getState().spatial !== created.opened;
  const created: SaverBook = {
    api: null,
    departed: null,
    disposed: false,
    engine: createAutosave<true>({
      getChanges: () => (created.saver?.hasDirty() || pendingBeforeAttach() ? true : undefined),
      // Cùng luật với saver: lỗi saver giữ thân để gửi lại (mọi 5xx, `aborted`) thì engine cũng hẹn
      // lại, không thì chấm đỏ đứng im tới lượt sửa sau dù thân đang chờ.
      isTransientError: (error) =>
        isTransientAutosaveError(error) || pipes?.classifyLayerSaveError(error) === 'temporary',
      // Nit-1: `import()` của ống hỏng thì lượt lưu ném (engine thử lại, rồi "Lưu thất bại"),
      // và mỗi lượt sau nạp lại ống — không im lặng bỏ sửa.
      save: async () => {
        if (created.saver === null) {
          attachSaver(created, await getPipes());
        }

        await created.saver?.flush();
      },
    }),
    listeners: new Set(),
    opened,
    projectId,
    reloadErrors: new Map(),
    saver: null,
    stops: [],
    userId,
    version: 0,
  };

  mountedAutosaves.add(created.engine);
  created.stops.push(
    useStore.subscribe((state, previous) => {
      if (state.spatialProjectId === projectId) {
        created.departed = null;
      } else if (previous.spatialProjectId === projectId) {
        created.departed = { floorMeta: previous.floorMeta, spatial: previous.spatial };
      }

      // Chỉ lượt `set` TỰ ghi `lastServerSpatial` là dữ liệu máy chủ (R14: một `set`). So
      // `spatial !== lastServerSpatial` thì bỏ sót Ctrl+Z về đúng bản đã nạp (review P1-1).
      const fromServer =
        state.lastServerSpatial !== previous.lastServerSpatial && state.spatial === state.lastServerSpatial;

      if (fromServer && created.saver === null && state.spatialProjectId === projectId) {
        created.opened = state.spatial;
      }

      if (
        fromServer ||
        state.spatialProjectId !== projectId ||
        !previous.spatial ||
        !state.spatial ||
        state.spatial === previous.spatial
      ) {
        return;
      }

      notePendingEdit();

      if (created.saver && pipes) {
        markChanged(
          created,
          pipes.changedLevelIds(previous.spatial, state.spatial),
          pipes.changedDimensionLevelIds(previous.spatial, state.spatial),
        );
      } else {
        created.engine.notifyChange();
      }
    }),
    guardBeforeUnload({
      // Tầng bị khối `reload` không bao giờ lưu được nữa, và dải báo đã nói tải lại là bỏ sửa — hộp
      // hỏi rời trang của trình duyệt cho nó chỉ chặn F5/"Tải lại" (U15).
      hasUnsavedChanges: () =>
        useStore.getState().unsavedFloorIds.some((id) => created.saver?.getBlock(id)?.kind !== 'reload') ||
        pendingBeforeAttach(),
      sendBeacon: () => undefined,
    }),
  );
  book = created;

  if (pipes) {
    attachSaver(created, pipes);
  } else {
    // Hỏng thì để lượt lưu của engine nạp lại (Nit-1).
    void getPipes().then(
      (loaded) => attachSaver(created, loaded),
      () => undefined,
    );
  }

  return created;
}

/** Đóng saver đang sống, không xả — chỉ cho `beforeEach` của test. */
export function __resetFloorLayerSavers(): void {
  peerChannel?.close();
  peerChannel = undefined;
  if (book) {
    closeBook(book, false);
    book = null;
  }
}

export interface FloorLayerSaveConfirm {
  open: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}

/** Dải lưu lớp cho view: `reload` → nút "Tải lại" (+ hộp thoại A9), `blocked` → chỉ câu. */
export interface FloorLayerSaveBlock {
  kind: 'reload' | 'blocked';
  message: string;
  onReload?: () => void;
  confirm: FloorLayerSaveConfirm | null;
}

export interface UseFloorLayerAutosaveOptions {
  projectId: string;
  /** Vắng (`/3d`) → dải theo tầng bị khối đầu tiên, câu kèm tên tầng. */
  floorId?: string;
  apiClient?: SpatialClient;
}

export interface FloorLayerAutosaveHandle {
  /** Engine dùng chung của saver; lỗi của tầng KHÁC không làm nó "failed" với màn này. */
  autosave: Autosave;
  label: string | null;
  saveBlock: FloorLayerSaveBlock | null;
  discardFloor: (floorId: string) => void;
  reloadFloor: (floorId: string) => Promise<void>;
  /**
   * Lưu tỉ lệ một tầng qua saver chung (F-04x-2 bước 5); trả khi máy chủ đã nhận, ném lỗi gốc
   * khi hỏng hay khi tầng đang bị khối (không gửi). `hint` = revision N15, chỉ vào thân chỉ tỉ lệ.
   */
  saveScale: (floorId: string, ratio: number, hint?: number) => Promise<void>;
  /** Tầng đang bị khối — `saveScale` sẽ không gửi (câu báo "áp mọi tầng" tách riêng nhóm này). */
  isFloorBlocked: (floorId: string) => boolean;
}

/**
 * Nối một màn vào saver lớp tầng của người–dự án đang mở (F-04x-1 bước 5). Saver sống ở
 * cấp module tới khi đổi khoá; hook tháo chỉ gỡ listener của nó.
 */
export function useFloorLayerAutosave({
  apiClient,
  floorId,
  projectId,
}: UseFloorLayerAutosaveOptions): FloorLayerAutosaveHandle {
  const current = openBook(projectId);

  if (apiClient) {
    current.api = apiClient;
  }

  const subscribe = useMemo(
    () => (listener: () => void) => {
      current.listeners.add(listener);

      return () => {
        current.listeners.delete(listener);
      };
    },
    [current],
  );
  const version = (): number => current.version;

  useSyncExternalStore(subscribe, version, version);

  const autosave = useMemo<Autosave>(() => {
    const { engine } = current;
    // Lỗi "của tầng khác" chỉ khi có tầng khác đang chưa lưu; không tầng nào (ống chưa nạp
    // được) thì lỗi là của mọi màn.
    const foreignFailure = (): boolean => {
      const unsaved = useStore.getState().unsavedFloorIds;

      return floorId !== undefined && engine.getState() === 'failed' && unsaved.length > 0 && !unsaved.includes(floorId);
    };

    return { ...engine, getState: () => (foreignFailure() ? 'saved' : engine.getState()) };
  }, [current, floorId]);

  const label = useEngineLabel(autosave);
  const [confirmOpen, setConfirmOpen] = useState(false);

  const reloadFloor = useMemo(
    () => async (target: string) => {
      const [loaded, api] = await Promise.all([getPipes(), spatialApiOf(current)]);
      const read = await api.spatial.readLayer({ floorId: target, projectId: current.projectId });

      if (current.disposed) {
        return;
      }

      if (read.ok) {
        const discarded = (current.saver?.getBlock(target) ?? null) !== null;

        current.reloadErrors.delete(target);
        current.saver?.discardFloor(target);
        // Lớp, `dimensions`, `level` (khớp lớp đã quy đổi, review-1 P2-2) và `scaleStatus` — chung với VersionHistory.
        loaded.applyFloorLayerRead(target, read.data);
        // Lỗi lưu của bản vừa bỏ hết nghĩa: tầng khác còn sửa chờ thì `reset` không làm gì (BUG-415).
        current.engine.reset();

        if (discarded) {
          appNotificationBus.publish({ description: '', title: FLOOR_LAYER_RELOAD_DISCARDED, type: 'floor-layer-reload' });
        }
      } else {
        current.reloadErrors.set(target, RELOAD_FAILED);
      }

      bump(current);
    },
    [current],
  );

  /*
   * U14: tab quay lại (focus / hiện ra) mà tầng không có sửa chờ → đọc N16; máy chủ có revision mới
   * hơn thì nạp ngay, thay vì để người dùng sửa trên bản cũ rồi mới gặp 409. Có sửa chờ thì để
   * lượt lưu tự báo xung đột như cũ — nạp đè là mất sửa.
   */
  useEffect(() => {
    if (floorId === undefined || typeof window === 'undefined') {
      return;
    }

    const isStale = (revision: number | undefined): boolean => {
      const state = useStore.getState();

      return (
        current.disposed ||
        state.spatialProjectId !== current.projectId ||
        state.unsavedFloorIds.includes(floorId) ||
        state.floorMeta[floorId]?.revision !== revision
      );
    };

    // `fromPeer`: tab khác vừa lưu tầng này — đọc cả khi tab đang ẩn, để lúc quay lại đã là bản mới.
    const refresh = (fromPeer: boolean): void => {
      const local = useStore.getState().floorMeta[floorId]?.revision;

      if ((!fromPeer && document.visibilityState === 'hidden') || local === undefined || isStale(local)) {
        return;
      }

      void Promise.all([getPipes(), spatialApiOf(current)])
        .then(async ([loaded, api]) => {
          const read = await api.spatial.readLayer({ floorId, projectId: current.projectId });

          if (!read.ok || read.data.revision <= local || isStale(local)) {
            return;
          }

          loaded.applyFloorLayerRead(floorId, read.data);
          // Số đếm của màn (vd. "31 cần xem") đọc qua truy vấn cũng phải đọc lại, không chỉ kho (UX-43).
          loaded.applyInvalidation(queryClient, 'persistSpatialLayer', { floorId, projectId: current.projectId });
          appNotificationBus.publish({ description: '', title: FLOOR_LAYER_UPDATED_ELSEWHERE, type: 'floor-layer-refresh' });
        })
        .catch(() => undefined);
    };
    const onReturn = (): void => refresh(false);
    const onPeerSaved = (saved: PeerSaved): void => {
      if (saved.projectId === current.projectId && saved.floorId === floorId) {
        refresh(true);
      }
    };

    peer();
    peerListeners.add(onPeerSaved);
    window.addEventListener('focus', onReturn);
    document.addEventListener('visibilitychange', onReturn);

    return () => {
      peerListeners.delete(onPeerSaved);
      window.removeEventListener('focus', onReturn);
      document.removeEventListener('visibilitychange', onReturn);
    };
  }, [current, floorId]);

  const discardFloor = useMemo(() => (target: string) => current.saver?.discardFloor(target), [current]);

  const saveScale = useMemo(
    () => async (target: string, ratio: number, hint?: number) => {
      if (current.saver === null) {
        attachSaver(current, await getPipes());
      }

      if (current.saver === null) {
        // Sổ đã đóng (đổi dự án): không có lượt gửi nào, nên không được báo là đã lưu (A5).
        throw new Error(SAVE_UNAVAILABLE);
      }

      try {
        await current.saver.saveScale(target, ratio, hint);
      } catch (error) {
        // Thân lớp + tỉ lệ hỏng tạm để tầng bẩn lại; đường này không qua engine, nên phải báo
        // nó — không thì không có lượt thử lại và nhãn vẫn "Đã lưu lúc …" (review-1 P2-3, A7).
        if (current.saver.hasDirty()) {
          current.engine.notifyChange();
        }

        throw error;
      }
    },
    [current],
  );

  const isFloorBlocked = useMemo(() => (target: string) => (current.saver?.getBlock(target) ?? null) !== null, [current]);

  const target = floorId ?? current.saver?.blockedFloorIds()[0];
  const block = target === undefined ? null : (current.saver?.getBlock(target) ?? null);
  let saveBlock: FloorLayerSaveBlock | null = null;

  if (block && target !== undefined) {
    const level = floorId === undefined ? useStore.getState().spatial?.byId[target] : undefined;
    const reason = current.reloadErrors.get(target) ?? block.message;
    const message = level && 'order' in level ? `${level.name}: ${reason}` : reason;

    saveBlock =
      block.kind === 'blocked'
        ? { confirm: null, kind: 'blocked', message }
        : {
            confirm: {
              onCancel: () => setConfirmOpen(false),
              onConfirm: () => {
                setConfirmOpen(false);
                void reloadFloor(target);
              },
              open: confirmOpen,
            },
            kind: 'reload',
            message,
            onReload: () => {
              if (useStore.getState().unsavedFloorIds.includes(target)) {
                setConfirmOpen(true);
              } else {
                void reloadFloor(target);
              }
            },
          };
  }

  return { autosave, discardFloor, isFloorBlocked, label, reloadFloor, saveBlock, saveScale };
}
