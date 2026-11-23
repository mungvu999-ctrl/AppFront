/**
 * Bước "Duyệt bộ hồ sơ" — VIEW THUẦN: lưới các hình, thanh việc, và hộp hỏi trước khi tạo tầng.
 *
 * Nói MỘT lần ở đầu: máy mới chỉ đề xuất, các hình chưa có người duyệt. Chỉ nút "Xác nhận và dựng" tạo tầng
 * (và nó mở hộp hỏi, A9). Không có nút lưu (A7): chỉ một dòng trạng thái tự lưu. Tệp máy không nhận được
 * (`rejected`) nằm trong một dải riêng, nêu đúng tên tệp.
 */

import { InlineAlert } from '@/components/feedback/InlineAlert';
import { SaveIndicator } from '@/components/feedback/SaveIndicator';
import { Skeleton } from '@/components/feedback/Skeleton';
import { Modal } from '@/components/overlay/Modal';
import { Button } from '@/components/ui/Button';
import { viewCardOf, type ConfirmCheck, type ReviewFloor, type ViewDraft } from '@/lib/viewmodel/drawingSetReview';

import { DrawingSetViewCard } from './DrawingSetViewCard';
import type { UseDrawingSetReviewResult } from './useDrawingSetReview';

const TEXT = {
  machineNote: 'Đây là đề xuất của máy, chưa có người duyệt. Chọn tầng cho từng mặt bằng rồi xác nhận.',
  confirm: 'Xác nhận và dựng',
  remove: 'Bỏ bộ này',
  floorsError: 'Chưa đọc được danh sách tầng của dự án.',
  retry: 'Thử lại',
  problemsTitle: 'Chưa xác nhận được',
  rejectedTitle: 'Tệp máy không nhận',
  empty: 'Máy không tách được hình nào từ bộ này.',
  confirmTitle: 'Xác nhận và dựng?',
  removeTitle: 'Bỏ bộ hồ sơ này?',
  cancel: 'Huỷ',
  saveLabel: { saved: 'Đã lưu bản duyệt', saving: 'Đang lưu…', pending: 'Có thay đổi, sắp lưu', error: 'Chưa lưu được bản duyệt' },
} as const;

export interface DrawingSetReviewViewProps {
  readonly drafts: readonly ViewDraft[];
  readonly floors: readonly ReviewFloor[] | null;
  readonly floorsError: string | null;
  readonly check: ConfirmCheck;
  readonly saveState: UseDrawingSetReviewResult['saveState'];
  readonly saveSentence: string | null;
  readonly dialog: UseDrawingSetReviewResult['dialog'];
  /** `fileId` → tên tệp. */
  readonly fileNames: ReadonlyMap<string, string>;
  /** Câu cho tệp bị từ chối, đã có tên tệp. */
  readonly rejectedFiles: readonly string[];
  readonly notice: string | null;
  readonly actions: UseDrawingSetReviewResult['actions'];
  readonly onRetryFloors: () => void;
  readonly onRetrySave: () => void;
}

export function DrawingSetReviewView(props: DrawingSetReviewViewProps) {
  const { actions, check, dialog, drafts, fileNames, floors } = props;
  const problemByView = new Map(check.problems.flatMap((problem) => (problem.viewId === undefined ? [] : [[problem.viewId, problem.text] as const])));
  const generalProblems = check.problems.filter((problem) => problem.viewId === undefined);
  const saveLabel = props.saveState === 'idle' ? null : TEXT.saveLabel[props.saveState];

  return (
    <div className="flex flex-col gap-4">
      <p className="text-[14px] text-text-secondary">{TEXT.machineNote}</p>
      {props.notice === null ? null : <InlineAlert level="attention" message={props.notice} role="status" />}
      {props.rejectedFiles.length === 0 ? null : (
        <InlineAlert level="attention" message={props.rejectedFiles.join(' ')} role="status" title={TEXT.rejectedTitle} />
      )}
      {props.floorsError === null ? null : (
        <InlineAlert
          action={{ label: TEXT.retry, onClick: props.onRetryFloors }}
          level="violation"
          message={props.floorsError}
          role="status"
        />
      )}

      <div className="flex flex-wrap items-center gap-3">
        <Button disabled={!check.canConfirm || floors === null} onClick={actions.openConfirm} variant="primary">
          {TEXT.confirm}
        </Button>
        <Button onClick={actions.openRemove} variant="ghost">
          {TEXT.remove}
        </Button>
        {saveLabel === null ? null : (
          <div aria-live="polite" className="ml-auto" role="status">
            <SaveIndicator label={props.saveSentence ?? saveLabel} saveState={props.saveState} />
            {props.saveState === 'error' ? (
              <Button onClick={props.onRetrySave} size="sm" variant="ghost">
                {TEXT.retry}
              </Button>
            ) : null}
          </div>
        )}
      </div>

      {generalProblems.length === 0 ? null : (
        <InlineAlert
          level="attention"
          message={generalProblems.map((problem) => problem.text).join(' ')}
          role="status"
          title={TEXT.problemsTitle}
        />
      )}

      {drafts.length === 0 ? (
        <p className="text-[14px] text-text-secondary">{TEXT.empty}</p>
      ) : (
        <ul aria-label="Các hình máy tách được" className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {drafts.map((draft) => (
            <li key={draft.id}>
              <DrawingSetViewCard
                actions={actions}
                draft={draft}
                floors={floors}
                problem={draft.excluded ? null : (problemByView.get(draft.id) ?? null)}
                sourceLabel={`${fileNames.get(draft.fileId) ?? 'Tệp'} · trang ${String(draft.pageIndex + 1)}`}
                vm={viewCardOf(draft)}
              />
            </li>
          ))}
        </ul>
      )}
      {floors === null && props.floorsError === null ? <Skeleton className="h-4 w-48" preset="block" /> : null}

      <Modal.Root isOpen={dialog !== null} onClose={actions.closeDialog} width={480}>
        {dialog === null ? null : (
          <>
            <Modal.Header>{dialog.kind === 'confirm' ? TEXT.confirmTitle : TEXT.removeTitle}</Modal.Header>
            <Modal.Body>
              <p className="pb-2">{dialog.body}</p>
              {dialog.error === null ? null : (
                <p className="pb-2 text-state-violation-text" role="alert">
                  {dialog.error}
                </p>
              )}
            </Modal.Body>
            <Modal.Footer>
              <Button disabled={dialog.isBusy} onClick={actions.closeDialog} variant="ghost">
                {TEXT.cancel}
              </Button>
              <Button disabled={dialog.isBusy} onClick={actions.submitDialog} variant="primary">
                {dialog.kind === 'confirm' ? TEXT.confirm : TEXT.remove}
              </Button>
            </Modal.Footer>
          </>
        )}
      </Modal.Root>
    </div>
  );
}
