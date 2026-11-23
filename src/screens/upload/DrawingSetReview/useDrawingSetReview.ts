/**
 * Bước duyệt bộ hồ sơ (K-32b, N59–N61): bản nháp các hình máy tách được, tự lưu, và xác nhận.
 *
 * ## Máy chỉ đề xuất, người duyệt xác nhận
 *
 * Loại hình, tầng máy đọc, độ chắc nằm nguyên văn trong bản nháp. ĐÍCH của mỗi mặt bằng chỉ có khi người
 * duyệt chọn (hoặc máy chủ đã lưu lựa chọn của họ lượt trước). Không có đường "dựng luôn": chỉ
 * {@link UseDrawingSetReviewResult.confirm} gọi N60, và chỉ sau hộp hỏi (A9: tạo tầng không hoàn tác được
 * bằng một cú bấm) khi {@link checkConfirm} không còn vấn đề.
 *
 * ## Tự lưu (A7)
 *
 * Không có nút lưu: 800 ms sau thao tác cuối, cả danh sách hình đi một lượt N59 (thay cả danh sách) với
 * `baseVersion` = `revision` đã thấy. Một lượt một lúc; sửa thêm giữa lúc gửi thì vòng lặp gửi tiếp. Thoát
 * màn thì lưu nốt phần chưa gửi. `VERSION_CONFLICT`/`DRAWING_SET_REVISION_STALE` nghĩa là bộ đã đổi ở nơi
 * khác: màn không đè mà báo cha tải lại bản mới (`onStale`), vì ghi đè lặng lẽ là mất việc người khác.
 * Bấm "Xác nhận" luôn lưu nốt trước, rồi mới gửi N60 với đúng `revision` vừa nhận.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import type { DrawingSet } from '@/api/schemas/drawingSet';
import type { HouseViewKind } from '@/api/schemas/houseProposal';
import type { SaveState } from '@/components/feedback/SaveIndicator';
import {
  checkConfirm,
  chooseExistingFloor,
  chooseNewFloor,
  clearTarget,
  confirmSummaryText,
  setExcluded,
  setKind,
  setNewFloorName,
  setReplace,
  toDrafts,
  toViewEdits,
  type ConfirmCheck,
  type ReviewFloor,
  type ViewDraft,
} from '@/lib/viewmodel/drawingSetReview';

import type { DrawingSetGateway } from './drawingSetGateway';
import { describeDrawingSetFailure } from './drawingSetText';

/** Cửa sổ im lặng của A7. */
export const SAVE_DELAY_MS = 800;

const FLOORS_ERROR = 'Chưa đọc được danh sách tầng của dự án.';
const SAVE_FAILED = 'Chưa lưu được bản duyệt. Thử lại.';

export interface ReviewDialogState {
  readonly kind: 'confirm' | 'remove';
  readonly body: string;
  readonly isBusy: boolean;
  readonly error: string | null;
}

export interface UseDrawingSetReviewOptions {
  readonly projectId: string;
  readonly set: DrawingSet;
  readonly gateway: DrawingSetGateway;
  readonly saveDelayMs?: number;
  /** N60 xong. */
  readonly onConfirmed: (set: DrawingSet) => void;
  /** N61 xong. */
  readonly onRemoved: () => void;
  /** Bộ đã đổi ở nơi khác: cha tải lại bản mới và dựng lại màn. */
  readonly onStale: (sentence: string) => void;
  /** Công tắc tắt giữa chừng. */
  readonly onDisabled: () => void;
}

export interface UseDrawingSetReviewResult {
  readonly drafts: readonly ViewDraft[];
  /** `null` = đang đọc. */
  readonly floors: readonly ReviewFloor[] | null;
  readonly floorsError: string | null;
  readonly retryFloors: () => void;
  readonly check: ConfirmCheck;
  readonly saveState: SaveState;
  readonly saveSentence: string | null;
  readonly retrySave: () => void;
  readonly dialog: ReviewDialogState | null;
  readonly actions: {
    readonly setExcluded: (id: string, excluded: boolean) => void;
    readonly setKind: (id: string, kind: HouseViewKind) => void;
    readonly chooseFloor: (id: string, floorId: string) => void;
    readonly chooseNewFloor: (id: string) => void;
    readonly clearTarget: (id: string) => void;
    readonly setNewFloorName: (id: string, name: string) => void;
    readonly setReplace: (id: string, replace: boolean) => void;
    readonly openConfirm: () => void;
    readonly openRemove: () => void;
    readonly closeDialog: () => void;
    readonly submitDialog: () => void;
  };
}

export function useDrawingSetReview(options: UseDrawingSetReviewOptions): UseDrawingSetReviewResult {
  const { gateway, projectId, set } = options;
  const saveDelayMs = options.saveDelayMs ?? SAVE_DELAY_MS;
  const [drafts, setDrafts] = useState<readonly ViewDraft[]>(() => toDrafts(set.views));
  const [floors, setFloors] = useState<readonly ReviewFloor[] | null>(null);
  const [floorsError, setFloorsError] = useState<string | null>(null);
  const [floorsToken, setFloorsToken] = useState(0);
  const [saveState, setSaveState] = useState<SaveState>('idle');
  const [saveSentence, setSaveSentence] = useState<string | null>(null);
  const [dialog, setDialog] = useState<ReviewDialogState | null>(null);

  const draftsRef = useRef(drafts);
  const revisionRef = useRef(set.revision);
  const savedRef = useRef(JSON.stringify(toViewEdits(drafts)));
  const inFlightRef = useRef<Promise<boolean> | null>(null);
  const mountedRef = useRef(true);
  const callbacksRef = useRef(options);

  useEffect(() => {
    draftsRef.current = drafts;
    callbacksRef.current = options;
  });

  /* ---- Tầng của dự án ---- */
  useEffect(() => {
    const controller = new AbortController();

    setFloorsError(null);
    void gateway.readFloors(projectId, controller.signal).then((result) => {
      if (controller.signal.aborted) return;
      if (result.ok) setFloors(result.data);
      else setFloorsError(FLOORS_ERROR);
    });

    return () => {
      controller.abort();
    };
  }, [gateway, projectId, floorsToken]);
  const retryFloors = useCallback(() => {
    setFloorsToken((value) => value + 1);
  }, []);

  /* ---- Tự lưu ---- */
  const safe = useCallback((run: () => void) => {
    if (mountedRef.current) run();
  }, []);

  const runSave = useCallback(async (): Promise<boolean> => {
    for (;;) {
      const edits = toViewEdits(draftsRef.current);
      const key = JSON.stringify(edits);

      if (key === savedRef.current) {
        safe(() => {
          setSaveState('saved');
          setSaveSentence(null);
        });

        return true;
      }
      safe(() => {
        setSaveState('saving');
      });
      const result = await gateway.sets.replaceViews({
        projectId,
        setId: set.id,
        baseVersion: revisionRef.current,
        views: edits,
      });

      if (!result.ok) {
        const failure = describeDrawingSetFailure(result.error);

        if (failure.kind === 'disabled') callbacksRef.current.onDisabled();
        else if (failure.kind === 'stale') callbacksRef.current.onStale(failure.sentence);
        else {
          safe(() => {
            setSaveState('error');
            setSaveSentence(failure.sentence.length > 0 ? failure.sentence : SAVE_FAILED);
          });
        }

        return false;
      }
      revisionRef.current = result.data.revision;
      savedRef.current = key;
    }
  }, [gateway.sets, projectId, safe, set.id]);

  const flush = useCallback((): Promise<boolean> => {
    inFlightRef.current ??= runSave().finally(() => {
      inFlightRef.current = null;
    });

    return inFlightRef.current;
  }, [runSave]);

  useEffect(() => {
    if (JSON.stringify(toViewEdits(drafts)) === savedRef.current) return undefined;
    setSaveState('pending');
    const timer = setTimeout(() => {
      void flush();
    }, saveDelayMs);

    return () => {
      clearTimeout(timer);
    };
  }, [drafts, flush, saveDelayMs]);

  useEffect(() => {
    mountedRef.current = true;

    return () => {
      mountedRef.current = false;
      // Rời màn: lưu nốt phần chưa gửi (không đợi, không còn ai nghe kết quả).
      if (JSON.stringify(toViewEdits(draftsRef.current)) !== savedRef.current) void flush();
    };
  }, [flush]);

  const retrySave = useCallback(() => {
    void flush();
  }, [flush]);

  /* ---- Sửa ---- */
  const edit = useCallback((change: (previous: readonly ViewDraft[]) => ViewDraft[]) => {
    setDrafts((previous) => change(previous));
  }, []);
  const actionsEdit = useMemo(
    () => ({
      setExcluded: (id: string, excluded: boolean) => {
        edit((previous) => setExcluded(previous, id, excluded));
      },
      setKind: (id: string, kind: HouseViewKind) => {
        edit((previous) => setKind(previous, id, kind));
      },
      chooseFloor: (id: string, floorId: string) => {
        edit((previous) => chooseExistingFloor(previous, id, floorId));
      },
      chooseNewFloor: (id: string) => {
        const floorId = gateway.createFloorId();

        edit((previous) => chooseNewFloor(previous, id, floorId));
      },
      clearTarget: (id: string) => {
        edit((previous) => clearTarget(previous, id));
      },
      setNewFloorName: (id: string, name: string) => {
        edit((previous) => setNewFloorName(previous, id, name));
      },
      setReplace: (id: string, replace: boolean) => {
        edit((previous) => setReplace(previous, id, replace));
      },
    }),
    [edit, gateway],
  );

  const check = useMemo(() => checkConfirm(drafts, floors ?? []), [drafts, floors]);

  /* ---- Hộp hỏi: xác nhận và bỏ bộ ---- */
  const closeDialog = useCallback(() => {
    setDialog((current) => (current?.isBusy === true ? current : null));
  }, []);
  const openConfirm = useCallback(() => {
    if (!check.canConfirm || floors === null) return;
    setDialog({ kind: 'confirm', body: confirmSummaryText(check.summary), isBusy: false, error: null });
  }, [check, floors]);
  const openRemove = useCallback(() => {
    setDialog({
      kind: 'remove',
      body: 'Bộ hồ sơ này sẽ không còn trong danh sách. Chưa có tầng nào được tạo từ nó.',
      isBusy: false,
      error: null,
    });
  }, []);

  const fail = useCallback(
    (sentence: string) => {
      safe(() => {
        setDialog((current) => (current === null ? current : { ...current, isBusy: false, error: sentence }));
      });
    },
    [safe],
  );

  const submitDialog = useCallback(() => {
    if (dialog === null || dialog.isBusy) return;
    const kind = dialog.kind;

    setDialog({ ...dialog, isBusy: true, error: null });
    void (async () => {
      if (kind === 'remove') {
        const removed = await gateway.sets.remove({ projectId, setId: set.id });

        if (removed.ok) callbacksRef.current.onRemoved();
        else fail(describeDrawingSetFailure(removed.error).sentence);

        return;
      }
      // Lưu nốt rồi mới xác nhận, với đúng `revision` vừa nhận.
      if (!(await flush())) {
        fail(SAVE_FAILED);

        return;
      }
      const confirmed = await gateway.sets.confirm({ projectId, setId: set.id, revision: revisionRef.current });

      if (confirmed.ok) {
        callbacksRef.current.onConfirmed(confirmed.data);

        return;
      }
      const failure = describeDrawingSetFailure(confirmed.error);

      if (failure.kind === 'disabled') callbacksRef.current.onDisabled();
      else if (failure.kind === 'stale') callbacksRef.current.onStale(failure.sentence);
      else {
        // Mã tầng mới bị trùng: cấp mã khác cho mọi tầng mới, người duyệt bấm lại.
        if (failure.kind === 'floorIdTaken') {
          safe(() => {
            setDrafts((previous) =>
              previous.map((draft) =>
                draft.target.mode === 'newFloor' ? { ...draft, target: { ...draft.target, floorId: gateway.createFloorId() } } : draft,
              ),
            );
          });
        }
        fail(failure.sentence);
      }
    })();
  }, [dialog, fail, flush, gateway, projectId, safe, set.id]);

  return {
    drafts,
    floors,
    floorsError,
    retryFloors,
    check,
    saveState,
    saveSentence,
    retrySave,
    dialog,
    actions: { ...actionsEdit, openConfirm, openRemove, closeDialog, submitDialog },
  };
}
