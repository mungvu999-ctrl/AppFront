/**
 * Bước chọn tệp và tải cả bộ (K-32b, N54–N56). Không cần tạo tầng trước.
 *
 * Tệp được ĐO ngay khi chọn (`measureDrawingSetFile`: dung lượng, định dạng, `.dwg`, trần trang mỗi PDF),
 * rồi cả bộ được cộng lại ({@link checkDrawingSetBatch}: 20 tệp, 200 MiB, 40 trang). Vượt trần thì nút
 * "Tải lên" tắt và câu nói rõ con số lẫn cách gỡ; không byte nào được gửi. Tệp bị từ chối riêng nằm lại
 * trong danh sách với lý do (người dùng bỏ nó đi), không chặn các tệp còn lại.
 *
 * Lượt tải chạy ở {@link uploadDrawingSet}; xong thì gọi `onUploaded(setId)` để màn chuyển sang `analyzing`.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import type { DrawingSetGateway } from './drawingSetGateway';
import { batchIssueSentence, describeDrawingSetFailure, rejectionSentence, type DrawingSetFailure } from './drawingSetText';
import { createUuid } from '@/lib/http/ids';
import {
  checkDrawingSetBatch,
  measureDrawingSetFile,
  uploadDrawingSet,
  type DrawingSetCandidate,
  type MeasuredDrawingSetFile,
} from '@/lib/upload/drawingSetUpload';

export interface PickEntry {
  readonly id: string;
  readonly file: DrawingSetCandidate;
  /** `null` = đang đo. */
  readonly measured: MeasuredDrawingSetFile | null;
}

export interface PickEntryVm {
  readonly id: string;
  readonly name: string;
  readonly size: number;
  readonly pageCount: number | null;
  readonly isMeasuring: boolean;
  /** Câu lý do khi tệp không nhận được; `null` khi nhận được hoặc đang đo. */
  readonly rejection: string | null;
}

export interface UploadingState {
  readonly percent: number;
  readonly fileName: string | null;
  readonly stage: 'create' | 'chunk' | 'complete';
}

export interface UseDrawingSetPickOptions {
  readonly projectId: string;
  readonly gateway: DrawingSetGateway;
  /** Bộ đã tải xong và máy chủ nhận (đã `complete`). */
  readonly onUploaded: (setId: string) => void;
  /** Công tắc tắt giữa chừng (503 `DRAWING_SET_DISABLED`). */
  readonly onDisabled: () => void;
}

export interface UseDrawingSetPickResult {
  readonly entries: readonly PickEntryVm[];
  readonly batchSentences: readonly string[];
  /** Tệp nhận được / trang / cả bộ, để hiện dòng tổng. */
  readonly totals: { readonly files: number; readonly pages: number; readonly bytes: number };
  readonly canStart: boolean;
  readonly uploading: UploadingState | null;
  readonly failure: DrawingSetFailure | null;
  readonly addFiles: (files: readonly DrawingSetCandidate[]) => void;
  readonly removeEntry: (id: string) => void;
  readonly start: () => void;
  readonly cancel: () => void;
}

export function useDrawingSetPick({ gateway, onDisabled, onUploaded, projectId }: UseDrawingSetPickOptions): UseDrawingSetPickResult {
  const [entries, setEntries] = useState<readonly PickEntry[]>([]);
  const [uploading, setUploading] = useState<UploadingState | null>(null);
  const [failure, setFailure] = useState<DrawingSetFailure | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  const mountedRef = useRef(true);

  useEffect(() => {
    mountedRef.current = true;

    return () => {
      mountedRef.current = false;
      abortRef.current?.abort();
    };
  }, []);

  const addFiles = useCallback((files: readonly DrawingSetCandidate[]) => {
    const added: PickEntry[] = files.map((file) => ({ id: createUuid(), file, measured: null }));

    setFailure(null);
    setEntries((previous) => [...previous, ...added]);
    for (const entry of added) {
      void measureDrawingSetFile(entry.file).then((measured) => {
        if (!mountedRef.current) return;
        setEntries((previous) => previous.map((item) => (item.id === entry.id ? { ...item, measured } : item)));
      });
    }
  }, []);

  const removeEntry = useCallback((id: string) => {
    setFailure(null);
    setEntries((previous) => previous.filter((entry) => entry.id !== id));
  }, []);

  const measured = useMemo(() => entries.flatMap((entry) => (entry.measured === null ? [] : [entry.measured])), [entries]);
  const batch = useMemo(() => checkDrawingSetBatch(measured), [measured]);
  const isMeasuring = entries.some((entry) => entry.measured === null);
  const accepted = useMemo(() => measured.flatMap((item) => (item.ok ? [item.file] : [])), [measured]);

  const start = useCallback(() => {
    if (uploading !== null || accepted.length === 0) return;
    const controller = new AbortController();

    abortRef.current = controller;
    setFailure(null);
    setUploading({ percent: 0, fileName: null, stage: 'create' });
    void uploadDrawingSet({
      api: gateway.sets,
      projectId,
      files: accepted,
      signal: controller.signal,
      onProgress: (progress) => {
        if (mountedRef.current) setUploading({ percent: progress.percent, fileName: progress.fileName ?? null, stage: progress.stage });
      },
    }).then(async (result) => {
      if (!mountedRef.current) return;
      if (result.ok) {
        onUploaded(result.set.id);

        return;
      }
      // Bộ đã tạo mà tải hỏng/huỷ thì bỏ nó đi, kẻo để mồ côi ở trạng thái `receiving` (N61 vẫn chạy khi tắt).
      if (result.setId !== undefined) {
        await gateway.sets.remove({ projectId, setId: result.setId });
      }
      if (!mountedRef.current) return;
      setUploading(null);
      if (result.stage === 'cancelled') return;
      const described = describeDrawingSetFailure(result.error);

      if (described.kind === 'disabled') onDisabled();
      else setFailure(described);
    });
  }, [accepted, gateway.sets, onDisabled, onUploaded, projectId, uploading]);

  const cancel = useCallback(() => {
    abortRef.current?.abort();
  }, []);

  const entryVms = useMemo<readonly PickEntryVm[]>(
    () =>
      entries.map((entry) => ({
        id: entry.id,
        name: entry.file.name,
        size: entry.file.size,
        pageCount: entry.measured?.ok === true ? entry.measured.pageCount : null,
        isMeasuring: entry.measured === null,
        rejection:
          entry.measured !== null && !entry.measured.ok ? rejectionSentence(entry.file.name, entry.measured.reason) : null,
      })),
    [entries],
  );

  return {
    entries: entryVms,
    batchSentences: batch.issues.map(batchIssueSentence),
    totals: { files: batch.totalFiles, pages: batch.totalPages, bytes: batch.totalBytes },
    canStart: accepted.length > 0 && !isMeasuring && batch.issues.length === 0 && uploading === null,
    uploading,
    failure,
    addFiles,
    removeEntry,
    start,
    cancel,
  };
}
