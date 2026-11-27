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

import { DRAWING_SET_NAME_MAX, type DrawingSet } from '@/api/schemas/drawingSet';
import type { BuildingDecisions } from '@/api/schemas/setBuilding';
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
  suggestedSetName,
  toDrafts,
  toViewEdits,
  type ConfirmCheck,
  type ReviewFloor,
  type ViewDraft,
} from '@/lib/viewmodel/drawingSetReview';
import { decisionsToSend } from '@/lib/viewmodel/setBuildingDecisions';

import type { DrawingSetGateway } from './drawingSetGateway';
import { describeDrawingSetFailure } from './drawingSetText';

/** Cửa sổ im lặng của A7. */
export const SAVE_DELAY_MS = 800;

const FLOORS_ERROR = 'Chưa đọc được danh sách tầng của dự án.';
const SAVE_FAILED = 'Chưa lưu được bản duyệt. Thử lại.';
const HOUSE_LOST = 'Lựa chọn chưa lưu trong khối “Ngôi nhà” đã mất.';

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
  /** Quyết định của khối "Ngôi nhà" (NHA-08b), đi cùng thân N59; vắng = người duyệt chưa đụng vào khối, không gửi. */
  readonly building?: BuildingDecisions | undefined;
  /** Quyết định đã lưu ở máy chủ: hình có quyết định ở đây mà bị bỏ thì lượt lưu gửi bản đã tỉa, dù khối chưa được chạm. */
  readonly storedBuilding?: BuildingDecisions | undefined;
  /** Những gì của khối còn chặn xác nhận. */
  readonly houseProblems?: readonly string[] | undefined;
  /** N59 lưu xong, kèm `revision` mới: khối "Ngôi nhà" đọc lại đề xuất. */
  readonly onSaved?: ((revision: number) => void) | undefined;
  /** N60 xong. */
  readonly onConfirmed: (set: DrawingSet) => void;
  /** N61 xong. */
  readonly onRemoved: () => void;
  /** Bộ đã đổi ở nơi khác: cha tải lại bản mới và dựng lại màn. */
  readonly onStale: (sentence: string) => void;
  /** Công tắc tắt giữa chừng. */
  readonly onDisabled: () => void;
}

/** Tên bộ người duyệt gõ; chỉ gửi khi người duyệt đã sửa (gợi ý điền sẵn không tự lưu) và còn chữ sau khi cắt khoảng trắng. */
const nameToSend = (name: string, touched: boolean): string | undefined => {
  const text = name.trim();

  return touched && text.length > 0 ? text.slice(0, DRAWING_SET_NAME_MAX) : undefined;
};

export interface UseDrawingSetReviewResult {
  /** Ô tên bộ: điền sẵn tên đã có, hoặc gợi ý từ khung tên khi chưa có tên. */
  readonly nameField: {
    readonly value: string;
    readonly isSuggestion: boolean;
    readonly maxLength: number;
    readonly onChange: (value: string) => void;
  };
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

  const suggestion = useMemo(() => suggestedSetName(set.titleBlock, set.name), [set.name, set.titleBlock]);
  const [nameState, setNameState] = useState<{ readonly value: string; readonly touched: boolean }>(() => ({
    value: set.name ?? suggestion ?? '',
    touched: false,
  }));

  const draftsRef = useRef(drafts);
  const nameRef = useRef(nameState);
  /** Tên đã lưu thành công ở N59 (xoá sạch ô thì giữ tên này, không gửi tên rỗng). */
  const savedNameRef = useRef<string | undefined>(undefined);
  const revisionRef = useRef(set.revision);
  const buildingRef = useRef(options.building);
  const storedBuildingRef = useRef(options.storedBuilding);
  /** Thân `building` đã lưu gần nhất (JSON), để biết 409 có làm mất lựa chọn nào của khối không. */
  const savedBuildingRef = useRef<string | undefined>(undefined);
  const payloadOf = useCallback((): {
    readonly edits: ReturnType<typeof toViewEdits>;
    readonly name: string | undefined;
    readonly building: BuildingDecisions | undefined;
  } => {
    const plans = new Set(draftsRef.current.filter((draft) => !draft.excluded && draft.kind === 'plan').map((draft) => draft.id));

    return {
      edits: toViewEdits(draftsRef.current),
      name: nameToSend(nameRef.current.value, nameRef.current.touched) ?? savedNameRef.current,
      // Quyết định của hình không còn là mặt bằng đang dùng làm N59 từ chối cả lượt lưu, và N60 chặn xác nhận.
      building: decisionsToSend(buildingRef.current, storedBuildingRef.current, plans),
    };
  }, []);
  const savedRef = useRef(JSON.stringify({ edits: toViewEdits(drafts), name: undefined }));
  const inFlightRef = useRef<Promise<boolean> | null>(null);
  const mountedRef = useRef(true);
  const callbacksRef = useRef(options);

  useEffect(() => {
    draftsRef.current = drafts;
    nameRef.current = nameState;
    buildingRef.current = options.building;
    storedBuildingRef.current = options.storedBuilding;
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
      const payload = payloadOf();
      const key = JSON.stringify(payload);

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
        views: payload.edits,
        ...(payload.name !== undefined ? { name: payload.name } : {}),
        ...(payload.building !== undefined ? { building: payload.building } : {}),
      });

      if (!result.ok) {
        const failure = describeDrawingSetFailure(result.error);

        if (failure.kind === 'disabled') callbacksRef.current.onDisabled();
        else if (failure.kind === 'stale') {
          // Chỉ lựa chọn người duyệt vừa tự tay đặt mới là "đã mất"; bản tỉa tự động thì lượt mở lại sẽ tỉa lại.
          const lost = buildingRef.current !== undefined && JSON.stringify(payload.building) !== savedBuildingRef.current;

          callbacksRef.current.onStale(lost ? `${failure.sentence} ${HOUSE_LOST}` : failure.sentence);
        } else {
          safe(() => {
            setSaveState('error');
            setSaveSentence(failure.sentence.length > 0 ? failure.sentence : SAVE_FAILED);
          });
        }

        return false;
      }
      revisionRef.current = result.data.revision;
      savedRef.current = key;
      savedBuildingRef.current = JSON.stringify(payload.building);
      if (mountedRef.current) callbacksRef.current.onSaved?.(result.data.revision);
      savedNameRef.current = payload.name;
    }
  }, [gateway.sets, payloadOf, projectId, safe, set.id]);

  const flush = useCallback((): Promise<boolean> => {
    inFlightRef.current ??= runSave().finally(() => {
      inFlightRef.current = null;
    });

    return inFlightRef.current;
  }, [runSave]);

  useEffect(() => {
    // Các ref đã được effect phía trên chép từ chính lượt render này.
    if (JSON.stringify(payloadOf()) === savedRef.current) return undefined;
    setSaveState('pending');
    const timer = setTimeout(() => {
      void flush();
    }, saveDelayMs);

    return () => {
      clearTimeout(timer);
    };
    // `storedBuilding`: quyết định đã lưu về trễ (khối còn đang đọc lúc người duyệt bỏ hình) thì xét lại, để bản tỉa vẫn được gửi.
  }, [drafts, flush, nameState, options.building, options.storedBuilding, payloadOf, saveDelayMs]);

  useEffect(() => {
    mountedRef.current = true;

    return () => {
      mountedRef.current = false;
      // Rời màn: lưu nốt phần chưa gửi (không đợi, không còn ai nghe kết quả).
      if (JSON.stringify(payloadOf()) !== savedRef.current) void flush();
    };
  }, [flush, payloadOf]);

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

  const onNameChange = useCallback((value: string) => {
    setNameState({ value: value.slice(0, DRAWING_SET_NAME_MAX), touched: true });
  }, []);

  const check = useMemo(() => checkConfirm(drafts, floors ?? [], options.houseProblems), [drafts, floors, options.houseProblems]);

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
    nameField: { value: nameState.value, maxLength: DRAWING_SET_NAME_MAX, isSuggestion: !nameState.touched && set.name === undefined && suggestion !== null, onChange: onNameChange },
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
