/**
 * Nối hàng đợi duyệt (`wallReviewQueue.ts`) vào màn: dựng `WallReviewQueue`, hai lệnh đổi về
 * chuẩn (một đoạn và hàng loạt) và hai phím C (đổi chuẩn) / S (để sau) của thanh tra.
 *
 * Mọi ghi vẫn đi qua lệnh S-07 + `dispatch` của màn, mỗi lượt là MỘT `runTransaction` (một bước
 * hoàn tác): đổi một đoạn = đổi độ dày + duyệt; đổi hàng loạt = đổi độ dày cả lô.
 */

import { useCallback, useMemo, useRef } from 'react';

import type { NormalizedSpatial } from '@/domain/spatial/normalize';
import type { Level, Wall, WallId } from '@/domain/spatial/types';
import { useShortcut } from '@/hooks/useShortcut';
import { runTransaction } from '@/lib/commands/transaction';
import type { ShortcutRegistry } from '@/lib/input/shortcutRegistry';
import type { ScaleSource, ScaleStatus, WireScaleState } from '@/lib/viewmodel/provisionalScale';
import { useStore } from '@/store';

import {
  buildApproveWallCommand,
  buildChangeThicknessCommand,
  commandContextOf,
  wallLabelOf,
  type createWallLayerDispatchDeps,
  type WallLayerReviewGateway,
} from './wallLayerReviewGateway';
import {
  approveAllLabelOf,
  bulkLabelOf,
  confidentWallsOf,
  bulkPlanOf,
  gateConditionsOf,
  hasConfidenceSpread,
  nextUnreviewedWallId,
  queueGroupOf,
  rowExtraOf,
  sortByReviewQueue,
  thicknessTargetOf,
  toleranceTextOf,
  type WallReviewQueue,
  type WallReviewReason,
  type WallRowExtra,
} from './wallReviewQueue';

type DispatchBundle = ReturnType<typeof createWallLayerDispatchDeps>;

export interface UseWallReviewQueueInput {
  readonly graph: NormalizedSpatial | null;
  readonly level: Level | null;
  /** Tỷ lệ của tầng (N16) — cột "Dài, mm" theo cùng quy tắc với thanh tra (K16). */
  readonly scaleStatus?: ScaleStatus;
  readonly scaleSource?: ScaleSource | undefined;
  /** N16 `scaleState` (R9): cột "Dài, mm" mang dấu ước lượng theo đúng trạng thái này. */
  readonly scaleState?: WireScaleState | undefined;
  /** Câu khoá đổi độ dày (`thicknessLockTextOf`, tính ở hook màn); `null` = được đổi. */
  readonly lockText: string | null;
  /** Mọi tường của tầng (không lọc). */
  readonly walls: readonly Wall[];
  /** Tường đang hiện trong danh sách, đã xếp theo hàng đợi. */
  readonly visibleWalls: readonly Wall[];
  readonly wallCodes: ReadonlyMap<string, string>;
  readonly selectedWallId: WallId | null;
  readonly canEdit: boolean;
  readonly gateway: WallLayerReviewGateway;
  readonly dispatchBundle: DispatchBundle;
  readonly invalidate: () => void;
  readonly onSelect: (wallId: WallId | null) => void;
  readonly onSkip: (wallId: WallId) => void;
  readonly onFlash: (wallId: WallId) => void;
  readonly registry?: ShortcutRegistry | undefined;
  /** Tường máy chưa chắc theo hình (`geometrySuspectIdsOf`): có thì dấu "?" luôn hiện. */
  readonly suspectIds?: ReadonlySet<string> | undefined;
  readonly onOpenThickness?: (() => void) | undefined;
  /** Bố cục L23: lý do máy nghi của một đoạn; vắng = không chia theo lý do. */
  readonly reasonOf?: ((wall: Wall) => WallReviewReason | null) | undefined;
}

const S_DESCRIPTION = 'Để sau: sang đoạn kế trong hàng đợi.';
const C_DESCRIPTION = 'Đổi đoạn không chuẩn về chuẩn gần nhất rồi duyệt.';

export function useWallReviewQueue(input: UseWallReviewQueueInput): WallReviewQueue {
  const { graph, level, walls, visibleWalls, wallCodes, selectedWallId, canEdit, gateway, dispatchBundle } = input;
  const { invalidate, onSelect, onSkip, onFlash } = input;

  const { scaleStatus, scaleSource, scaleState, lockText, reasonOf } = input;
  const extras = useMemo(
    () =>
      new Map<string, WallRowExtra>(
        walls.map(
          (wall) => [wall.id, rowExtraOf(wall, level, scaleStatus, scaleSource, reasonOf?.(wall), scaleState)] as const,
        ),
      ),
    [reasonOf, level, scaleSource, scaleState, scaleStatus, walls],
  );
  const nonStandardCount = useMemo(() => walls.filter((wall) => queueGroupOf(wall) === 'nonStandard').length, [walls]);
  /* Cả tầng, không theo bộ lọc: số trên nút "Đưa N tường về chuẩn" khớp màn Độ dày. */
  const bulk = useMemo(() => bulkPlanOf(walls), [walls]);
  const wallsDone = walls.length > 0 && walls.every((wall) => wall.reviewed);
  const conditions = useMemo(() => gateConditionsOf(graph, level?.id ?? null, wallsDone), [graph, level, wallsDone]);
  /* Bộ lọc giấu hết việc còn lại thì vẫn có lối: tìm trên cả tầng theo cùng thứ tự. */
  const nextWallId = useMemo(
    () => nextUnreviewedWallId(visibleWalls, selectedWallId) ?? nextUnreviewedWallId(sortByReviewQueue(walls, undefined, undefined, reasonOf), selectedWallId),
    [reasonOf, selectedWallId, visibleWalls, walls],
  );

  const onStandardize = useCallback(
    (wallId: WallId) => {
      const wall = walls.find((candidate) => candidate.id === wallId);
      const targetMm = wall === undefined ? null : thicknessTargetOf(wall.thicknessMm, wall.source);

      if (wall === undefined || targetMm === null || !canEdit || lockText !== null) {
        return;
      }

      const current = useStore.getState().spatial;

      if (current === null) {
        return;
      }

      const nextId = nextUnreviewedWallId(visibleWalls, wallId);
      const change = buildChangeThicknessCommand({ wallId, thicknessMm: targetMm }, commandContextOf(current, gateway.actorId));

      if (!change.ok) {
        return;
      }

      /* Duyệt dựng trên ảnh SAU khi đổi độ dày: `dispatch` áp lệnh theo thứ tự, hoàn tác theo thứ tự ngược. */
      const changedWall = change.data.changes.find(
        (entry): entry is Extract<typeof entry, { kind: 'wall' }> => entry.kind === 'wall' && entry.id === wallId,
      )?.after;
      const approve = buildApproveWallCommand(changedWall ?? { ...wall, thicknessMm: targetMm }, gateway.actorId, wallCodes);
      const label = `${change.data.description} ${approve.description}`;

      dispatchBundle.setLabel(label);
      /* MỘT bước hoàn tác cho "đổi về chuẩn + duyệt" (Ctrl+Z một lần trả cả hai). */
      void runTransaction([change.data, approve], dispatchBundle.deps, { label }).then((result) => {
        if (!result.ok) {
          return;
        }

        invalidate();
        onFlash(wallId);

        if (nextId !== null && nextId !== wallId) {
          onSelect(nextId);
        }
      });
    },
    [canEdit, dispatchBundle, gateway, invalidate, lockText, onFlash, onSelect, visibleWalls, wallCodes, walls],
  );

  const onBulkStandardize = useCallback(() => {
    const current = useStore.getState().spatial;

    if (!canEdit || lockText !== null || current === null || bulk.changeCount === 0) {
      return;
    }

    const context = commandContextOf(current, gateway.actorId);
    const commands = bulk.targets.flatMap(({ wallId, targetMm }) => {
      const result = buildChangeThicknessCommand({ wallId, thicknessMm: targetMm }, context);

      return result.ok ? [result.data] : [];
    });

    if (commands.length === 0) {
      return;
    }

    const label = bulkLabelOf(commands.length);

    dispatchBundle.setLabel(label);
    void runTransaction(commands, dispatchBundle.deps, { label }).then((result) => {
      if (result.ok) {
        invalidate();
      }
    });
  }, [bulk, canEdit, dispatchBundle, gateway, invalidate, lockText]);

  /* U17: cả tầng (không theo bộ lọc), cùng quy tắc với nút đổi chuẩn hàng loạt. */
  const confident = useMemo(() => confidentWallsOf(walls, input.suspectIds, reasonOf), [input.suspectIds, reasonOf, walls]);

  const onApproveConfident = useCallback(() => {
    if (!canEdit || confident.length === 0) {
      return;
    }

    const commands = confident.map((wall) => buildApproveWallCommand(wall, gateway.actorId, wallCodes));
    const label = approveAllLabelOf(commands.length);

    dispatchBundle.setLabel(label);
    /* MỘT bước hoàn tác: Ctrl+Z một lần trả cả lượt. */
    void runTransaction(commands, dispatchBundle.deps, { label }).then((result) => {
      if (result.ok) {
        invalidate();
      }
    });
  }, [canEdit, confident, dispatchBundle, gateway, invalidate, wallCodes]);

  const selectedRef = useRef(selectedWallId);
  selectedRef.current = selectedWallId;
  const shortcutOptions = input.registry === undefined ? {} : { registry: input.registry };

  useShortcut(
    {
      id: 'wallLayerReview.skip',
      combo: 'S',
      scope: 'canvas',
      description: S_DESCRIPTION,
      onTrigger: () => {
        if (selectedRef.current !== null) {
          onSkip(selectedRef.current);
        }
      },
    },
    shortcutOptions,
  );
  useShortcut(
    {
      id: 'wallLayerReview.standardize',
      combo: 'C',
      scope: 'canvas',
      description: C_DESCRIPTION,
      onTrigger: () => {
        if (selectedRef.current !== null) {
          onStandardize(selectedRef.current);
        }
      },
    },
    { ...shortcutOptions, enabled: canEdit && lockText === null },
  );

  return {
    extras,
    nonStandardCount,
    bulk,
    nextWallId,
    nextWallLabel: nextWallId === null ? null : wallLabelOf(nextWallId, wallCodes),
    conditions,
    toleranceText: toleranceTextOf(),
    showConfidence: hasConfidenceSpread(walls) || (input.suspectIds?.size ?? 0) > 0,
    lockText,
    onStandardize,
    onBulkStandardize,
    confidentCount: confident.length,
    ...(canEdit ? { onApproveConfident } : {}),
    onOpenThickness: input.onOpenThickness,
  };
}
