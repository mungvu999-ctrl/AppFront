/**
 * Hook của S-33 — lịch sử phiên bản theo tầng (`/projects/:id/versions`).
 *
 * View thuần chỉ nhận `model` + `actions` (mục D); mọi câu, mọi phép tính ở đây hoặc ở
 * `versionHistoryModel.ts`/`versionHistoryScene.ts`/`versionHistoryCompare.ts` (thuần).
 *
 * ## Đọc
 * - N17: `useInfiniteQuery` trên `versionsQueryKey(floorId)` qua `gateway.listVersionPage`.
 * - N18: một `useQueries`, khoá `['version','snapshot',floorId,versionId]` — NGOÀI tiền tố N17,
 *   nên phục hồi không vô hiệu nội dung bất biến; `staleTime: Infinity`; tối đa
 *   {@link SNAPSHOT_CONCURRENCY} lượt cùng lúc; nạp trước {@link SNAPSHOT_PREFETCH_LIMIT} hàng đầu
 *   cộng cặp đang so, hàng khác nạp khi được chọn; `hasSnapshot: false` không gọi.
 *
 * ## Ghi (phục hồi, hoàn tác, "Tải lại")
 * 1. **Xả trước:** `flushAutosaves()`; tầng còn trong `unsavedFloorIds` → hộp thoại A9; đồng ý
 *    thì `discardFloor`, huỷ thì dừng.
 * 2. `baseVersion` = `floorMeta[floorId].revision` (vắng thì N16) — không bao giờ `sequence`.
 * 3. **Chuỗi nạp lại:** N16 → `applyFloorLayerRead` → `replaceFloorLayer(..., { external: true })` (lớp và `revision`
 *    cùng một `set`, xoá zundo, tăng `serverReplaceSeq`) → `applyInvalidation('restoreVersion')`.
 *    N16 hỏng thì `revision` trong kho không đổi (lượt tự lưu sau nhận 409, không ghi đè) và dải
 *    "Tải lại" hiện. Kích thước N16 vào kho cùng lớp — lượt N15 sau thấy cùng `revision` nên không thay.
 * 4. Không nhánh ghi đè: xung đột thành dải "Tải lại" (`model.conflict`).
 */

import { useInfiniteQuery, useQueries, useQueryClient } from '@tanstack/react-query';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import { loadSceneConcept, type SceneConcept } from '@/lib/pascal/sceneConcept';
import { abandonAssetRefresh, ensureSceneLibrary, sceneLibraryNow, type SceneLibrary } from '@/lib/pascal/sceneLibrary';
import type { FloorVersionSummary } from '@/api/schemas/versions';
import { flushAutosaves, useFloorLayerAutosave } from '@/hooks/useAutosave';
import { formatDuration } from '@/lib/format/datetime';
import { MOTION_DURATIONS_MS } from '@/lib/motion/tokens';
import { createUndoTicket, UNDO_WINDOW_MS, type UndoTicket } from '@/lib/mutations/undoTicket';
import { applyInvalidation } from '@/lib/query/invalidation';
import { diffVersions } from '@/lib/versioning/diff';
import type { VersionHistoryEntry } from '@/lib/versioning/restore';
import { useStore } from '@/store';
import { applyFloorLayerRead } from '@/store/commit';

import type {
  CompareModel,
  CompareTabId,
  ConflictNoticeModel,
  SevenState,
  UseVersionHistoryOptions,
  VersionHistoryActions,
  VersionHistoryModel,
  VersionHistoryOption,
  VersionHistoryResult,
  VersionSnapshotRead,
  VisualDiffModel,
} from './types';
import {
  COMPARE_TABS,
  compareSentenceOf,
  defaultPairOf,
  orderPair,
  togglePick,
  type VersionPair,
} from './versionHistoryCompare';
import {
  readFullVersion,
  toConflictNotice,
  toVersionMetadata,
  UNDO_EXPIRED_NOTICE,
  VERSION_LIST_FAILED_REASON,
  versionsQueryKey,
} from './versionHistoryGateway';
import {
  buildDiffGroups,
  buildJsonLines,
  buildRestoreConfirm,
  buildVersionRows,
  countsOf,
  createConcurrencyLimit,
  createPendingAnswer,
  EMPTY_DIFF_COUNTS,
  groupRowsByDay,
  isForbiddenRead,
  RELOAD_FAILED_NOTICE,
  RESTORE_CAPTION,
  RESTORE_FORBIDDEN_REASON,
  type RestoreDialog,
  UNDO_RETRY_TOAST,
  writeErrorNotice,
  unsavedEditsNotice,
} from './versionHistoryModel';
import { buildPlanDiffModel, entityCountsOf, togglePinned } from './versionHistoryPlan';
import {
  buildVisualModel,
  convertScene,
  graphOfVersion,
  isEmptySource,
  isOldSceneVersion,
  NO_SCENE,
  versionSceneOptions,
} from './versionHistoryScene';

/** Lượt N18 cùng lúc. */
export const SNAPSHOT_CONCURRENCY = 2;
/** Số hàng đầu được nạp N18 trước khi ai chọn. */
export const SNAPSHOT_PREFETCH_LIMIT = 10;

/** Khoá N18 — ngoài tiền tố `versionsQueryKey`, nên `restoreVersion` không vô hiệu nó. */
export const snapshotQueryKey = (floorId: string, versionId: string) =>
  ['version', 'snapshot', floorId, versionId] as const;

interface Banner {
  readonly kind: 'reload' | 'error';
  readonly notice: ConflictNoticeModel;
}

/** Ổn định ở cấp module để `combine` của `useQueries` giữ được kết quả khi không gì đổi. */
const combineSnapshots = (
  results: readonly {
    data?: VersionSnapshotRead | undefined;
    isError: boolean;
    isFetching: boolean;
  }[],
) => ({
  reads: results.map((result) => result.data),
  fetching: results.map((result) => result.isFetching),
  failed: results.map((result) => result.isError),
});
type FlushOutcome = 'clean' | 'discarded' | 'cancelled';

const capitalizeFirst = (text: string): string =>
  `${text.charAt(0).toLocaleUpperCase('vi-VN')}${text.slice(1)}`;

const EMPTY_SUMMARIES: readonly FloorVersionSummary[] = Object.freeze([]);
const NO_ENTITY_CHANGES = Object.freeze({ added: 0, removed: 0, changed: 0 });

export function useVersionHistory(options: UseVersionHistoryOptions): VersionHistoryResult {
  const {
    apiClient,
    floorId,
    floorOptions,
    gateway,
    onExportVersion,
    onSelectFloor,
    onToast,
    projectId,
  } = options;
  const canRestore = options.canRestore ?? true;
  const isNarrow = options.isNarrow ?? false;
  const readNow = options.now;

  const queryClient = useQueryClient();
  const graph = useStore((state) => state.spatial);
  const currentRevision = useStore((state) => state.floorMeta[floorId]?.revision ?? null);
  // Màn không có engine nào khác: gắn bộ lưu lớp tầng để `flushAutosaves()` xả được ống (F-04x-1).
  const { discardFloor } = useFloorLayerAutosave({
    projectId,
    floorId,
    ...(apiClient !== undefined ? { apiClient } : {}),
  });
  /** Tên tầng (tên riêng, giữ hoa); vắng thì "tầng này". */
  const floorName = floorOptions?.find((option) => option.id === floorId)?.label ?? 'tầng này';

  /* ---- Lựa chọn của người dùng ----------------------------------------- */

  const [pickedPair, setPickedPair] = useState<VersionPair | null>(null);
  const [activeTab, setActiveTab] = useState<CompareTabId>('changes');
  const [hoveredEntityId, setHoveredEntityId] = useState<string | null>(null);
  const [pinnedEntityId, setPinnedEntityId] = useState<string | null>(null);
  const [dialog, setDialog] = useState<RestoreDialog | null>(null);
  const [banner, setBanner] = useState<Banner | null>(null);
  const [isRecomputing, setIsRecomputing] = useState(false);
  /** `confirmRestore()` gọi ngay sau `requestRestore()` trong cùng nhịp vẫn thấy mục tiêu. */
  const dialogRef = useRef<RestoreDialog | null>(null);
  const [discardQuestion] = useState(createPendingAnswer);

  const openDialog = useCallback((next: RestoreDialog | null): void => {
    dialogRef.current = next;
    setDialog(next);
  }, []);

  // Đổi tầng: bỏ cặp so, dải, hộp thoại của tầng cũ. Câu A9 đang chờ nhận "huỷ" để lượt ghi
  // của tầng cũ kết thúc thay vì treo trên `await`.
  useEffect(() => {
    setPickedPair(null);
    setBanner(null);
    discardQuestion.answer(false);
    openDialog(null);
  }, [discardQuestion, floorId, openDialog]);

  /* ---- N17 ---------------------------------------------------------------- */

  const versionsQuery = useInfiniteQuery({
    queryKey: versionsQueryKey(floorId),
    queryFn: ({ pageParam }) =>
      gateway.listVersionPage(pageParam === undefined ? {} : { cursor: pageParam }),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (last) => last.nextCursor,
  });

  const summaries = useMemo((): readonly FloorVersionSummary[] => {
    const byId = new Map<string, FloorVersionSummary>();

    for (const item of versionsQuery.data?.pages.flatMap((page) => page.items) ?? EMPTY_SUMMARIES) {
      byId.set(item.id, item);
    }

    return [...byId.values()].sort((a, b) => b.sequence - a.sequence);
  }, [versionsQuery.data]);
  const summaryMap = useMemo(() => new Map(summaries.map((item) => [item.id, item])), [summaries]);

  /* ---- N18 ---------------------------------------------------------------- */

  const [limit] = useState(() => createConcurrencyLimit(SNAPSHOT_CONCURRENCY));
  const wanted = useMemo(
    () =>
      new Set([
        ...summaries.slice(0, SNAPSHOT_PREFETCH_LIMIT).map((item) => item.id),
        ...[pickedPair?.left, pickedPair?.right].filter(
          (id): id is string => typeof id === 'string',
        ),
      ]),
    [summaries, pickedPair],
  );
  const snapshots = useQueries({
    queries: summaries.map((item) => ({
      queryKey: snapshotQueryKey(floorId, item.id),
      queryFn: ({ signal }: { readonly signal: AbortSignal }): Promise<VersionSnapshotRead> =>
        limit((held) => gateway.readSnapshot(item.id, held), signal),
      enabled: item.hasSnapshot && wanted.has(item.id),
      staleTime: Infinity,
    })),
    combine: combineSnapshots,
  });
  const snapshotsInFlight = snapshots.fetching.some(Boolean);
  const snapshotData = snapshots.reads;
  const snapshotFailed = snapshots.failed;

  const { failedIds, history, loadingIds, purgedIds } = useMemo(() => {
    const purged = new Set<string>();
    const failed = new Set<string>();
    const loading = new Set<string>();
    const entries = summaries.map((item, index): VersionHistoryEntry => {
      const read = snapshotData[index];

      if (!item.hasSnapshot || read?.kind === 'purged') {
        purged.add(item.id);
      } else if (snapshotFailed[index] === true && read === undefined && wanted.has(item.id)) {
        // Chỉ hàng còn bật truy vấn: hàng tắt thì `refetchQueries` bỏ qua, nút thử lại sẽ chết.
        failed.add(item.id);
      } else if (read === undefined && wanted.has(item.id)) {
        loading.add(item.id);
      }

      return read?.kind === 'snapshot'
        ? { kind: 'full', version: { ...toVersionMetadata(item), snapshot: read.snapshot } }
        : { kind: 'metadataOnly', version: toVersionMetadata(item) };
    });

    return { failedIds: failed, history: entries, loadingIds: loading, purgedIds: purged };
  }, [summaries, snapshotData, snapshotFailed, wanted]);

  /* ---- Cặp so, diff ----------------------------------------------------- */

  const pair = useMemo(
    () => orderPair(pickedPair ?? defaultPairOf(history), history),
    [pickedPair, history],
  );
  const { left: leftVersionId, right: rightVersionId } = pair;

  // Đổi cặp/tầng: bỏ ghim và rê của cặp cũ, để Esc không bị nuốt bởi ghim vô hình (RV2#11).
  useEffect(() => {
    setPinnedEntityId(null);
    setHoveredEntityId(null);
  }, [leftVersionId, rightVersionId, floorId]);
  const left = leftVersionId === null ? null : readFullVersion(history, leftVersionId);
  const right = rightVersionId === null ? null : readFullVersion(history, rightVersionId);
  const canDiff = left !== null && right !== null;
  const diff = useMemo(
    () => (left !== null && right !== null ? diffVersions(left.snapshot, right.snapshot) : null),
    [left, right],
  );
  const pairFetching = snapshots.fetching.some(
    (fetching, index) =>
      fetching && [leftVersionId, rightVersionId].includes(summaries[index]?.id ?? null),
  );

  useEffect(() => {
    if (!canDiff) {
      setIsRecomputing(false);

      return undefined;
    }

    setIsRecomputing(true);
    const timer = setTimeout(() => setIsRecomputing(false), MOTION_DURATIONS_MS.fast);

    return () => clearTimeout(timer);
  }, [canDiff, leftVersionId, rightVersionId]);

  /* ---- Hàng, nhóm ------------------------------------------------------- */

  const dataUpdatedAt = versionsQuery.dataUpdatedAt;
  /** Đồng hồ phút: "41 phút trước" tự cập nhật khi để trang mở. */
  const [minuteTick, setMinuteTick] = useState(0);

  useEffect(() => {
    // eslint-disable-next-line local/no-raw-duration -- thời gian chờ đồng hồ phút, không phải chuyển động
    const timer = window.setInterval(() => setMinuteTick((tick) => tick + 1), 60_000);

    return (): void => window.clearInterval(timer);
  }, []);

  const now = useMemo((): Date => {
    if (readNow !== undefined) {
      return readNow();
    }

    return new Date();
    // eslint-disable-next-line react-hooks/exhaustive-deps -- minuteTick/dataUpdatedAt chỉ để tính lại "bây giờ"
  }, [readNow, dataUpdatedAt, minuteTick]);

  const builds = useMemo(
    () =>
      buildVersionRows({
        history,
        now,
        leftVersionId,
        rightVersionId,
        summaries: summaryMap,
        purgedIds,
        failedIds,
        loadingIds,
        currentRevision,
      }),
    [
      history,
      now,
      leftVersionId,
      rightVersionId,
      summaryMap,
      purgedIds,
      failedIds,
      loadingIds,
      currentRevision,
    ],
  );
  const rows = useMemo(() => builds.map((build) => build.row), [builds]);
  const unsavedNotice = useMemo(() => unsavedEditsNotice(rows), [rows]);
  const groups = useMemo(() => groupRowsByDay(builds, now), [builds, now]);
  const versionOptions = useMemo(
    (): readonly VersionHistoryOption[] =>
      builds
        .filter((build) => !build.row.isMetadataOnly)
        .map((build) => ({
          id: build.row.id,
          label: `${build.row.label} · ${build.row.relativeTimeLabel}`,
        })),
    [builds],
  );

  /* ---- Tab "Trực quan", vùng so sánh ----------------------------------- */

  // Bản cũ có nội dung N18 thì dựng cảnh của CHÍNH nó; chưa có thì lùi về mô hình hiện tại.
  const leftIndex = summaries.findIndex((item) => item.id === leftVersionId);
  const leftRead = leftIndex < 0 ? undefined : snapshotData[leftIndex];
  const leftSource = leftRead?.kind === 'snapshot' ? leftRead.source : undefined;
  // Mặt bằng 2D cần ảnh chụp của CẢ HAI bản: xoá vẽ theo trái, thêm/sửa theo phải.
  const rightIndex = summaries.findIndex((item) => item.id === rightVersionId);
  const rightRead = rightIndex < 0 ? undefined : snapshotData[rightIndex];
  const rightSource = rightRead?.kind === 'snapshot' ? rightRead.source : undefined;
  // V1a: bản gốc trống (chỉ nền trời) thì khối 3D dựng bản đối chiếu, nơi có phần thêm.
  const sceneFromRight =
    leftSource !== undefined && rightSource !== undefined && isEmptySource(leftSource) && !isEmptySource(rightSource);
  const sceneSource = sceneFromRight ? rightSource : leftSource;
  const sceneGraph = useMemo(
    () => (sceneSource === undefined ? graph : (graphOfVersion(graph, sceneSource) ?? graph)),
    [graph, sceneSource],
  );
  // Thư viện máy chủ chốt TRƯỚC khi dựng cảnh — cùng điểm vào/phiên bản/fallback với editor (`ensureSceneLibrary`).
  const [library, setLibrary] = useState<SceneLibrary | null>(sceneLibraryNow);
  useEffect(() => {
    if (library !== null) return undefined;
    let live = true;
    void ensureSceneLibrary().then((loaded) => live && setLibrary(loaded));
    return () => {
      live = false;
    };
  }, [library]);
  /* Concept AI (N47) của dự án — cùng quy tắc với editor (`loadSceneConcept`): chờ kết quả, 403/404 im lặng, lỗi có
     câu báo. N47 chỉ có concept HIỆN HÀNH (không có lịch sử concept) nên chỉ bản hiện tại dùng nó; bản cũ dựng lại từ
     dữ liệu của chính phiên bản (`versionSceneOptions`). Kết quả của dự án cũ bị bỏ (`live`). */
  /* Gia hạn URL ký phủ cả màn này: lớp chặn fetch của `ensureSceneLibrary` chạm tới GLB do gói pascal-mount tải (bản
     three riêng). Rời dự án/màn thì lượt gia hạn đang chạy bị bỏ, không tải lại cho cảnh đã gỡ. */
  useEffect(() => () => abandonAssetRefresh(), [projectId]);
  const [concept, setConcept] = useState<{ readonly projectId: string; readonly value: SceneConcept } | null>(null);
  useEffect(() => {
    let live = true;
    void loadSceneConcept(projectId).then((value) => live && setConcept({ projectId, value }));
    return () => {
      live = false;
    };
  }, [projectId]);
  const sceneConcept = concept?.projectId === projectId ? concept.value : null;
  // Bản cũ: chỉ dữ liệu của phiên bản + chú thích; bản hiện tại: concept hiện hành (`versionSceneOptions`).
  // "Hiện tại" chỉ khi revision của bản khớp revision tầng (không theo hàng đầu tạm, không so tham chiếu đồ thị).
  const sceneVersionId = sceneFromRight ? rightVersionId : leftVersionId;
  const sceneIsOld = isOldSceneVersion(sceneSource !== undefined, sceneVersionId, summaryMap, currentRevision);
  const versionScene = useMemo(
    () => versionSceneOptions(sceneConcept, sceneIsOld),
    [sceneConcept, sceneIsOld],
  );
  const scene = useMemo(
    () => (library === null || versionScene === null ? NO_SCENE : convertScene(sceneGraph, versionScene.options)),
    [sceneGraph, library, versionScene],
  );
  const plan = useMemo(
    () =>
      diff === null || leftSource === undefined || rightSource === undefined
        ? null
        : buildPlanDiffModel({
            diff,
            floorLabel: capitalizeFirst(floorName),
            focusId: pinnedEntityId ?? hoveredEntityId,
            left: leftSource,
            right: rightSource,
          }),
    [diff, leftSource, rightSource, floorName, pinnedEntityId, hoveredEntityId],
  );
  const visual = useMemo(
    (): VisualDiffModel =>
      buildVisualModel({
        capabilities: gateway.capabilities,
        graph: sceneGraph,
        scene,
        isOldVersion: sceneGraph !== graph,
        isTargetVersion: sceneFromRight,
        diff,
        leftVersionLabel:
          builds.find((build) => build.row.id === (sceneFromRight ? rightVersionId : leftVersionId))?.row.label ??
          null,
        hoveredEntityId,
        isFetchingDiff: pairFetching,
        // Chờ cả thư viện lẫn concept: không dựng bằng mẫu đóng gói/phong cách mặc định rồi đổi sau.
        libraryPending: library === null || versionScene === null,
        libraryNotice: [library?.notice, versionScene?.note].filter(Boolean).join(' ') || null,
      }),
    [
      gateway.capabilities,
      graph,
      sceneGraph,
      scene,
      library,
      versionScene,
      diff,
      builds,
      leftVersionId,
      rightVersionId,
      sceneFromRight,
      hoveredEntityId,
      pairFetching,
    ],
  );

  const compare = useMemo(
    (): CompareModel => ({
      leftOptions: versionOptions,
      rightOptions: versionOptions,
      leftVersionId,
      rightVersionId,
      activeTab,
      tabs: COMPARE_TABS,
      totals: diff === null ? EMPTY_DIFF_COUNTS : countsOf(diff),
      entityTotals: diff === null ? NO_ENTITY_CHANGES : entityCountsOf(diff),
      groups: diff === null ? [] : buildDiffGroups(diff),
      jsonLines: diff === null ? [] : buildJsonLines(diff),
      visual,
      plan,
      pinnedEntityId,
      isRecomputing,
      teachingSentence: compareSentenceOf({
        hasDiff: diff !== null,
        isLoading: pairFetching || snapshotsInFlight,
        versionCount: history.length,
        fullCount: history.filter((entry) => entry.kind === 'full').length,
      }),
    }),
    [
      versionOptions,
      leftVersionId,
      rightVersionId,
      activeTab,
      diff,
      visual,
      plan,
      pinnedEntityId,
      isRecomputing,
      history,
      pairFetching,
      snapshotsInFlight,
    ],
  );

  /* ---- Ghi --------------------------------------------------------------- */

  const canTagVersion =
    gateway.capabilities.canTagVersion && gateway.tagVersion !== undefined && canRestore;
  const ticketNow = useMemo(
    () => (readNow === undefined ? {} : { now: () => readNow().getTime() }),
    [readNow],
  );

  /** Xả ống; tầng còn bẩn → hỏi A9. */
  const flushFirst = useCallback(async (): Promise<FlushOutcome> => {
    try {
      await flushAutosaves();
    } catch {
      // Lượt xả hỏng để tầng còn bẩn; câu hỏi A9 dưới đây mới là chỗ quyết.
    }

    if (!useStore.getState().unsavedFloorIds.includes(floorId)) {
      return 'clean';
    }

    const question = discardQuestion.ask();

    openDialog({ kind: 'discard' });

    if (!(await question)) {
      return 'cancelled';
    }

    discardFloor(floorId);

    return 'discarded';
  }, [discardFloor, discardQuestion, floorId, openDialog]);

  /** Chuỗi nạp lại tầng: N16 → `applyFloorLayerRead` (`replaceFloorLayer` external) → vô hiệu `restoreVersion`. */
  const reloadFloor = useCallback(async (): Promise<void> => {
    try {
      // N19 đổi cả kích thước; N15 sau đó thấy cùng `revision` nên không thay tầng (NO-369/NO-374).
      // Cùng hàm áp N16 với `reloadFloor` của autosave; lỗi ở đây thì ném ra dải "Tải lại".
      applyFloorLayerRead(floorId, await gateway.readFloorLayer());
    } catch {
      setBanner({ kind: 'reload', notice: RELOAD_FAILED_NOTICE });
    }

    applyInvalidation(queryClient, 'restoreVersion', { floorId, projectId });
  }, [floorId, gateway, projectId, queryClient]);

  /** Phiếu đang chạy hoàn tác: bấm đúp không xả, không hỏi A9, không gửi lần hai (NO-365). */
  const [undoing] = useState(() => new WeakSet<UndoTicket>());

  const runUndo = useCallback(
    (first: UndoTicket): Promise<void> => {
      const attempt = async (ticket: UndoTicket): Promise<void> => {
        if (ticket.getStatus() === 'expired') {
          // Toast (kể cả toast "thử lại") có thể sống quá hạn của phiếu: báo hết hạn, không im lặng.
          setBanner({ kind: 'error', notice: UNDO_EXPIRED_NOTICE });

          return;
        }

        if (ticket.getStatus() !== 'active' || undoing.has(ticket)) {
          return;
        }

        undoing.add(ticket);

        try {
          const flushed = await flushFirst();

          if (flushed === 'cancelled') {
            return;
          }

          try {
            const outcome = await gateway.revertRestore(ticket);

            if (outcome.kind === 'conflict') {
              setBanner({ kind: 'reload', notice: outcome.conflict ?? toConflictNotice(null) });
              if (flushed === 'discarded') await reloadFloor();

              return;
            }

            await reloadFloor();
            onToast?.({ message: 'Đã hoàn tác lượt phục hồi' });
          } catch (error) {
            setBanner({ kind: 'error', notice: writeErrorNotice('undo', error) });
            if (flushed === 'discarded') await reloadFloor();
            // Lỗi ném thì phiếu còn dùng (gateway): toast cũ đã đóng, nên mời bấm lại khi còn hạn.
            if (ticket.getStatus() === 'active') {
              onToast?.({
                message: UNDO_RETRY_TOAST,
                onUndo: () => void attempt(ticket),
                state: 'violation',
              });
            }
          }
        } finally {
          undoing.delete(ticket);
        }
      };

      return attempt(first);
    },
    [flushFirst, gateway, onToast, reloadFloor, undoing],
  );

  const runRestore = useCallback(
    async (versionId: string): Promise<void> => {
      const flushed = await flushFirst();

      if (flushed === 'cancelled') {
        return;
      }

      try {
        const base =
          useStore.getState().floorMeta[floorId]?.revision ??
          (await gateway.readFloorLayer()).revision;
        const outcome = await gateway.restore(versionId, base);

        if (outcome.kind === 'conflict') {
          setBanner({ kind: 'reload', notice: outcome.conflict ?? toConflictNotice(null) });
          if (flushed === 'discarded') await reloadFloor();

          return;
        }

        if (outcome.unchanged === true) {
          void queryClient.invalidateQueries({ queryKey: versionsQueryKey(floorId) });
          onToast?.({ message: 'Phiên bản này trùng với hiện trạng' });
          // Bản sửa vừa bỏ vẫn nằm trong kho (`discardFloor` chỉ xoá cờ bẩn) — trả kho về bản máy chủ.
          if (flushed === 'discarded') await reloadFloor();

          return;
        }

        await reloadFloor();

        const ticket = outcome.undoTicket;
        const label = summaryMap.get(versionId)?.sequence;

        onToast?.({
          message: `Đã phục hồi phiên bản${label === undefined ? '' : ` v${String(label)}`} của ${floorName}; hoàn tác được trong ${formatDuration(UNDO_WINDOW_MS)}`,
          ...(ticket === undefined ? {} : { onUndo: () => void runUndo(ticket) }),
        });
      } catch (error) {
        setBanner({ kind: 'error', notice: writeErrorNotice('restore', error) });
        if (flushed === 'discarded') await reloadFloor();
      }
    },
    [
      flushFirst,
      floorId,
      floorName,
      gateway,
      onToast,
      queryClient,
      reloadFloor,
      runUndo,
      summaryMap,
    ],
  );

  const sendLabel = useCallback(
    async (versionId: string, label: string, previous: string | null): Promise<void> => {
      try {
        await gateway.tagVersion?.(versionId, label);
        void queryClient.invalidateQueries({ queryKey: versionsQueryKey(floorId) });

        if (previous === null) {
          return;
        }

        const ticket = createUndoTicket({
          description: 'Hoàn tác nhãn phiên bản',
          ...ticketNow,
          undo: () => void sendLabel(versionId, previous, null),
        });

        const isBlank = label.trim().length === 0;

        // Bản chưa có nhãn mà gỡ nhãn: máy chủ không ghi gì, không báo "Đã gỡ nhãn" (C-046).
        if (isBlank && previous.trim().length === 0) {
          return;
        }

        onToast?.({
          message: isBlank ? 'Đã gỡ nhãn' : 'Đã gắn nhãn',
          onUndo: () => void ticket.undo(),
        });
      } catch (error) {
        setBanner({ kind: 'error', notice: writeErrorNotice('label', error, label) });
      }
    },
    [floorId, gateway, onToast, queryClient, ticketNow],
  );

  /* ---- Trạng thái -------------------------------------------------------- */

  const listError = versionsQuery.error;
  const forbidden = listError !== null && isForbiddenRead(listError);
  const errorMessage = listError !== null && !forbidden ? VERSION_LIST_FAILED_REASON : null;

  const state = ((): SevenState => {
    if (forbidden) return 'forbidden';
    if (versionsQuery.isPending) return 'loading';
    if (errorMessage !== null) return 'error';
    // Rỗng thắng thu gọn: dưới 1024 tầng không phiên bản vẫn phải nói "chưa có phiên bản nào" (BUG-473).
    if (summaries.length === 0) return 'empty';
    if (isNarrow) return 'collapsed';

    return snapshotsInFlight || visual.isBuilding || rows.some((row) => row.isMetadataOnly)
      ? 'partial'
      : 'success';
  })();

  /* ---- Việc làm được ---------------------------------------------------- */

  const {
    fetchNextPage,
    hasNextPage,
    isFetchingNextPage,
    refetch: refetchVersions,
  } = versionsQuery;

  const actions = useMemo(
    (): VersionHistoryActions => ({
      // `pair` đã xếp theo sequence (bản cũ trái): ô "gốc"/"đối chiếu" nói về hai bên HIỂN THỊ, không về thứ tự đã tích.
      // Chọn đúng bản đang ở bên kia thì hoán đổi hai bên (không thành cặp trùng {v, v}).
      selectLeftVersion: (versionId) =>
        setPickedPair({
          left: versionId,
          right: versionId === pair.right ? pair.left : pair.right,
        }),
      selectRightVersion: (versionId) =>
        setPickedPair({ left: versionId === pair.left ? pair.right : pair.left, right: versionId }),
      toggleCompareSelection: (versionId) =>
        setPickedPair((previous) => togglePick(previous ?? pair, versionId)),
      setTab: setActiveTab,
      hoverDiffRow: setHoveredEntityId,
      pinDiffRow: (entityId) => setPinnedEntityId((previous) => togglePinned(previous, entityId)),
      requestRestore: (versionId) => {
        if (canRestore && rows.find((row) => row.id === versionId)?.isCurrent !== true) {
          openDialog({ kind: 'restore', versionId });
        }
      },
      confirmRestore: () => {
        const current = dialogRef.current;

        openDialog(null);

        if (current?.kind === 'discard') {
          discardQuestion.answer(true);
        } else if (current?.kind === 'restore') {
          void runRestore(current.versionId);
        }
      },
      cancelRestore: () => {
        const current = dialogRef.current;

        openDialog(null);

        if (current?.kind === 'discard') {
          discardQuestion.answer(false);
        }
      },
      exportVersion: (versionId) => onExportVersion?.(versionId),
      tagVersion: (versionId, label) => {
        if (canTagVersion) {
          void sendLabel(versionId, label, summaryMap.get(versionId)?.label ?? '');
        }
      },
      dismissConflict: () => {
        const current = banner;

        setBanner(null);

        if (current?.kind === 'reload') {
          void flushFirst().then((flushed) =>
            flushed === 'cancelled' ? undefined : reloadFloor(),
          );
        }
      },
      loadMoreVersions: () => {
        if (hasNextPage && !isFetchingNextPage) {
          void fetchNextPage();
        }
      },
      selectFloor: (nextFloorId) => onSelectFloor?.(nextFloorId),
      // Qua `queryFn` của chính truy vấn, nên vẫn trong giới hạn SNAPSHOT_CONCURRENCY.
      retrySnapshot: (versionId) =>
        void queryClient.refetchQueries({
          queryKey: snapshotQueryKey(floorId, versionId),
          exact: true,
        }),
      retryVersions: () => void refetchVersions(),
    }),
    [
      banner,
      canRestore,
      canTagVersion,
      discardQuestion,
      fetchNextPage,
      floorId,
      flushFirst,
      hasNextPage,
      isFetchingNextPage,
      onExportVersion,
      onSelectFloor,
      openDialog,
      pair,
      queryClient,
      refetchVersions,
      reloadFloor,
      rows,
      runRestore,
      sendLabel,
      summaryMap,
    ],
  );

  const restoreConfirm = useMemo(
    () => buildRestoreConfirm(builds, dialog, floorName),
    [builds, dialog, floorName],
  );

  const model: VersionHistoryModel = {
    state,
    groups,
    rows,
    versionCount: summaries.length,
    isNarrow,
    compare,
    canRestore,
    restoreHiddenReason: canRestore ? null : RESTORE_FORBIDDEN_REASON,
    canTagVersion,
    // Xuất một phiên bản là ĐIỀU HƯỚNG sang S-34: khả năng đúng bằng "nơi gọi có cấp callback".
    canExportVersion: onExportVersion !== undefined,
    restoreCaption: RESTORE_CAPTION,
    restoreConfirm,
    conflict: banner?.notice ?? null,
    errorMessage,
    // HOP-DONG-MOI §5: tự lưu không sinh phiên bản, nên không có "đã lưu lúc" nào để đọc từ đây.
    savedAtLabel: null,
    canLoadMoreVersions: hasNextPage,
    ...(unsavedNotice === null ? {} : { unsavedNotice }),
    floorSelect:
      floorOptions !== undefined && floorOptions.length > 0
        ? { label: 'Tầng', options: floorOptions, selectedId: floorId }
        : null,
    emptyTitle: `${capitalizeFirst(floorName)} chưa có phiên bản nào`,
  };

  return [model, actions];
}
