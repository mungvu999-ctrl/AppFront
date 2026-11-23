/**
 * Luồng của màn "Tải cả bộ hồ sơ" (K-32b): quyết màn đang ở pha nào và đưa dữ liệu vào đúng pha.
 *
 * | pha          | khi nào                                                        | vẽ gì                                  |
 * |--------------|----------------------------------------------------------------|----------------------------------------|
 * | `loading`    | đang đọc công tắc (N52) và, nếu có `setId`, bộ (N57)            | khung xương                            |
 * | `disabled`   | công tắc tắt (N52 `enabled: false`) hoặc 503 giữa chừng        | MỘT câu và lối về; KHÔNG thao tác nào  |
 * | `forbidden`  | vai không có quyền tải bản vẽ                                  | MỘT câu và lối về; KHÔNG thao tác nào  |
 * | `loadError`  | lỗi đọc thật (mạng, 5xx, không thấy bộ)                        | câu lỗi + "Thử lại"                    |
 * | `pick`       | không `setId`                                                  | chọn tệp, tải lên, các bộ đang dở      |
 * | `analyzing`  | bộ `analyzing`; thăm dò 2 giây                                 | "Máy đang đọc bộ hồ sơ…"               |
 * | `review`     | bộ `review`                                                    | lưới hình, sửa, xác nhận               |
 * | `confirmed`  | bộ `confirmed`                                                 | các tầng đã tạo, lối sang xử lý        |
 * | `failed`     | bộ `failed`                                                    | lý do + lối tải lại                    |
 * | `receiving`  | bộ còn `receiving` (tải dở, rồi tải lại trang)                 | nói rõ, cho bỏ bộ và tải lại           |
 *
 * Công tắc tắt thì affordance RỜI DOM (R-69): pha `disabled` không dựng nút tải, ô chọn tệp hay lưới nào.
 * Không có `useQuery`: màn giữ vòng thăm dò và trạng thái bản nháp của chính nó (ngoại lệ đi trước như
 * `useShareLinks.ts`, không phải khuôn mẫu để chép).
 */

import { useCallback, useEffect, useRef, useState } from 'react';

import type { DrawingSet, DrawingSetSummary } from '@/api/schemas/drawingSet';
import { can } from '@/lib/auth/permissions';
import { ROUTES } from '@/routes/paths';
import type { ProjectRole } from '@/types/project';

import type { DrawingSetGateway } from './drawingSetGateway';
import { DISABLED_SENTENCE, describeDrawingSetFailure } from './drawingSetText';

/** Chu kỳ thăm dò N57 khi `analyzing` (hợp đồng K-32a: 2 giây, không SSE). */
export const POLL_MS = 2000;
/** Số lần đọc hỏng liên tiếp trước khi bỏ thăm dò và báo lỗi. */
const MAX_POLL_ERRORS = 3;

export type DrawingSetPhase =
  | 'loading'
  | 'disabled'
  | 'forbidden'
  | 'loadError'
  | 'pick'
  | 'receiving'
  | 'analyzing'
  | 'review'
  | 'confirmed'
  | 'failed';

export interface RecentSet {
  readonly id: string;
  readonly name: string | undefined;
  readonly createdAt: string;
  readonly status: DrawingSetSummary['status'];
}

export interface UseDrawingSetFlowOptions {
  readonly projectId: string;
  /** `:setId` của đường dẫn; vắng = bước chọn tệp. */
  readonly setId?: string | undefined;
  readonly gateway: DrawingSetGateway;
  readonly roles?: readonly ProjectRole[];
  readonly onNavigate: (path: string) => void;
  readonly pollMs?: number;
}

export interface UseDrawingSetFlowResult {
  readonly phase: DrawingSetPhase;
  readonly set: DrawingSet | null;
  /** Đổi mỗi lần bộ được tải lại vì đã đổi ở nơi khác: dựng lại bước duyệt từ bản mới. */
  readonly reloadCount: number;
  readonly notice: string | null;
  readonly errorSentence: string | null;
  /** Bộ gần đây chưa xong (cho pha `pick`): `analyzing` và `review`. */
  readonly recentSets: readonly RecentSet[];
  readonly retry: () => void;
  readonly onUploaded: (setId: string) => void;
  readonly onDisabled: () => void;
  readonly onConfirmed: (set: DrawingSet) => void;
  readonly onRemoved: () => void;
  readonly onStale: (sentence: string) => void;
  readonly openSet: (setId: string) => void;
  readonly removeReceiving: () => void;
  readonly backToPick: () => void;
}

const phaseOfStatus = (status: DrawingSet['status']): DrawingSetPhase => (status === 'review' ? 'review' : status);

export function useDrawingSetFlow(options: UseDrawingSetFlowOptions): UseDrawingSetFlowResult {
  const { gateway, onNavigate, projectId, setId } = options;
  const pollMs = options.pollMs ?? POLL_MS;
  const roles = options.roles ?? [];
  const canUpload = can('upload', 'floor', { roles }) && can('edit', 'layer', { roles });
  const [phase, setPhase] = useState<DrawingSetPhase>('loading');
  const [set, setSet] = useState<DrawingSet | null>(null);
  const [reloadCount, setReloadCount] = useState(0);
  const [notice, setNotice] = useState<string | null>(null);
  const [errorSentence, setErrorSentence] = useState<string | null>(null);
  const [recentSets, setRecentSets] = useState<readonly RecentSet[]>([]);
  const [token, setToken] = useState(0);
  const navigateRef = useRef(onNavigate);

  useEffect(() => {
    navigateRef.current = onNavigate;
  });

  /* ---- Nạp: công tắc, rồi bộ hoặc danh sách bộ gần đây ---- */
  useEffect(() => {
    if (!canUpload) {
      setPhase('forbidden');

      return undefined;
    }
    const controller = new AbortController();
    const { signal } = controller;
    const fail = (sentence: string): void => {
      setErrorSentence(sentence);
      setPhase('loadError');
    };

    setPhase('loading');
    setErrorSentence(null);
    void (async () => {
      const enabled = await gateway.readEnabled(projectId, signal);

      if (signal.aborted) return;
      if (!enabled.ok) return fail(describeDrawingSetFailure(enabled.error).sentence);
      if (!enabled.data) return setPhase('disabled');

      if (setId === undefined) {
        const listed = await gateway.sets.list({ projectId, limit: 20, signal });

        if (signal.aborted) return;
        setRecentSets(
          listed.ok
            ? listed.data.items
                .filter((item) => item.status === 'analyzing' || item.status === 'review')
                .map((item) => ({ id: item.id, name: item.name, createdAt: item.createdAt, status: item.status }))
            : [],
        );
        setSet(null);

        return setPhase('pick');
      }
      const read = await gateway.sets.read({ projectId, setId, signal });

      if (signal.aborted) return;
      if (!read.ok) return fail(describeDrawingSetFailure(read.error).sentence);
      setSet(read.data);
      setPhase(phaseOfStatus(read.data.status));
    })();

    return () => {
      controller.abort();
    };
  }, [canUpload, gateway, projectId, setId, token]);

  /* ---- Thăm dò khi máy đang đọc ---- */
  useEffect(() => {
    if (phase !== 'analyzing' || setId === undefined) return undefined;
    let errors = 0;
    let stopped = false;
    const controller = new AbortController();
    const timer = setInterval(() => {
      void gateway.sets.read({ projectId, setId, signal: controller.signal }).then((read) => {
        if (stopped) return;
        if (!read.ok) {
          errors += 1;
          if (errors >= MAX_POLL_ERRORS) {
            stopped = true;
            setErrorSentence(describeDrawingSetFailure(read.error).sentence);
            setPhase('loadError');
          }

          return;
        }
        errors = 0;
        setSet(read.data);
        if (read.data.status !== 'analyzing') setPhase(phaseOfStatus(read.data.status));
      });
    }, pollMs);

    return () => {
      stopped = true;
      clearInterval(timer);
      controller.abort();
    };
  }, [gateway, phase, pollMs, projectId, setId]);

  const retry = useCallback(() => {
    setToken((value) => value + 1);
  }, []);
  const onUploaded = useCallback(
    (newSetId: string) => {
      navigateRef.current(ROUTES.project.drawingSets(projectId, newSetId));
    },
    [projectId],
  );
  const onDisabled = useCallback(() => {
    setErrorSentence(DISABLED_SENTENCE);
    setPhase('disabled');
  }, []);
  const onConfirmed = useCallback((confirmed: DrawingSet) => {
    setSet(confirmed);
    setPhase('confirmed');
  }, []);
  const backToPick = useCallback(() => {
    navigateRef.current(ROUTES.project.drawingSets(projectId));
  }, [projectId]);
  const onRemoved = backToPick;
  const onStale = useCallback(
    (sentence: string) => {
      if (setId === undefined) return;
      void gateway.sets.read({ projectId, setId }).then((read) => {
        setNotice(sentence);
        if (!read.ok) return;
        setSet(read.data);
        setPhase(phaseOfStatus(read.data.status));
        setReloadCount((value) => value + 1);
      });
    },
    [gateway, projectId, setId],
  );
  const openSet = useCallback(
    (target: string) => {
      navigateRef.current(ROUTES.project.drawingSets(projectId, target));
    },
    [projectId],
  );
  const removeReceiving = useCallback(() => {
    if (setId === undefined) return;
    void gateway.sets.remove({ projectId, setId }).then(() => {
      backToPick();
    });
  }, [backToPick, gateway, projectId, setId]);

  return {
    phase,
    set,
    reloadCount,
    notice,
    errorSentence,
    recentSets,
    retry,
    onUploaded,
    onDisabled,
    onConfirmed,
    onRemoved,
    onStale,
    openSet,
    removeReceiving,
    backToPick,
  };
}
