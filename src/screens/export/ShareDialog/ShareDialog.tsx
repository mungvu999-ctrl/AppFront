/**
 * Vỏ hộp thoại chia sẻ — hai mục xếp dọc trong `Modal.Body`, một nút "xong" ở chân.
 *
 * View thuần (R-60): mọi dữ liệu tới từ props, không store, không mạng. `Modal.Root`
 * tự bẫy tiêu điểm và tự xử Esc (`Modal.tsx:59-80`) — màn không đăng ký thêm phím tắt
 * nào, không tự vẽ lớp phủ nào khác (nó đã dùng `bg-bg-overlay`, đúng token A1 đòi).
 * `width` chỉ nhận 480/560/720; đặc tả đòi 640 không tồn tại nên dùng 720 (chú thích
 * đầu `types.ts`).
 *
 * Bảy trạng thái (A11): `loading` thay các mục bằng một khung xương thay vì để trống.
 * `error` thêm một băng cảnh báo phía trên các mục nhưng không gỡ mục nào — giữ nguyên
 * mọi lựa chọn đang có, đúng tinh thần "thử lại không xoá những gì đã chọn" của
 * `ExportPanel`. `collapsed` không cần xử ở đây (không còn khung xem trước để ẩn). Sáu
 * trạng thái còn lại render đủ hai mục và chân trang nên container không khi nào trống — đúng điều `expectSevenStates` đòi.
 */

import { Check, Lock } from 'lucide-react';

import { InlineAlert } from '@/components/feedback/InlineAlert';
import { Badge } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { Skeleton } from '@/components/feedback/Skeleton';
import { Modal } from '@/components/overlay/Modal';

import { ShareDialogFooter } from './ShareDialogFooter';
import { ShareDialogLink } from './ShareDialogLink';
import { ShareDialogPeople } from './ShareDialogPeople';
import type { ShareDialogModel, ShareDialogProps } from './types';

interface ShareStatus {
  readonly chip: { readonly variant: 'neutral' | 'attention' | 'violation'; readonly label: string } | null;
  readonly sentence: string;
}

/**
 * Một nguồn trạng thái (NGUYEN-TAC-BO-CUC §1): chip và câu dưới tiêu đề đọc cùng
 * `members`/`rows` mà các mục bên dưới vẽ. Lời mời đang chờ chưa có dữ liệu (T-01, CẦN BE).
 */
function deriveShareStatus(model: ShareDialogModel): ShareStatus {
  if (model.state === 'loading') return { chip: null, sentence: 'Đang tải người có quyền…' };
  const people = `${String(model.members.length)} người có quyền`;
  const liveLinks = model.rows.filter((row) => row.canRevoke).length;
  const linkPart = !model.linksSupported
    ? ''
    : liveLinks === 0
      ? '; liên kết xem đang tắt'
      : `; ${String(liveLinks)} liên kết xem đang bật`;
  const chip =
    model.state === 'error'
      ? ({ variant: 'violation', label: 'Chưa lưu được' } as const)
      : liveLinks > 0
        ? ({ variant: 'attention', label: 'Có liên kết xem' } as const)
        : ({ variant: 'neutral', label: 'Chỉ người được mời' } as const);
  return { chip, sentence: `${people}${linkPart}.` };
}

export function ShareDialog(props: ShareDialogProps) {
  return (
    <>
      <ShareDialogMain {...props} />
      <RevokeConfirm url={props.model.pendingRevokeUrl} actions={props.actions} />
    </>
  );
}

function ShareDialogMain({ isOpen, model, actions, titleId, scaleNotice }: ShareDialogProps) {
  const status = deriveShareStatus(model);
  return (
    <Modal.Root
      isOpen={isOpen}
      onClose={actions.dismiss}
      width={720}
      {...(titleId !== undefined ? { titleId } : {})}
    >
      <Modal.Header className="pb-2">
        <span aria-hidden="true" className="mb-1 block text-[12px] font-medium uppercase leading-4 tracking-wide text-text-secondary">
          Dự án
        </span>
        Chia sẻ dự án
      </Modal.Header>
      <Modal.Body>
        <div className="flex flex-col gap-6 pb-8">
          {/* Trạng thái: chip + một câu có số; "Đã lưu" thay nút Lưu (A7). */}
          <div className="flex flex-col gap-2 border-b border-border-default pb-4">
            <div className="flex flex-wrap items-center gap-3">
              {status.chip !== null && (
                <Badge variant={status.chip.variant} noDot>
                  {status.chip.variant === 'neutral' && <Lock size={12} aria-hidden="true" className="mr-1" />}
                  {status.chip.label}
                </Badge>
              )}
              {model.savedAtLabel !== null && (
                <span className="ml-auto flex items-center gap-1 text-[13px] text-text-muted">
                  <Check size={14} aria-hidden="true" />
                  {model.savedAtLabel}
                </span>
              )}
            </div>
            <p className="text-[14px] leading-5 text-text-secondary">{status.sentence}</p>
          </div>

          {scaleNotice != null && <InlineAlert level="attention" message={scaleNotice} />}

          {model.state === 'error' && model.errorMessage !== null && (
            <InlineAlert level="violation" message={model.errorMessage} />
          )}

          {model.state === 'loading' ? (
            <Skeleton preset="property-panel" />
          ) : (
            <>
              <ShareDialogPeople members={model.members} membersReadOnlyReason={model.membersReadOnlyReason} />

              {model.linksSupported && (
                <>
                  <ShareDialogLink
                    form={model.form}
                    rows={model.rows}
                    canCreateLink={model.canCreateLink}
                    noPermissionReason={model.noPermissionReason}
                    copiedTargetId={model.copiedTargetId}
                    actions={actions}
                  />
                </>
              )}
            </>
          )}
        </div>
      </Modal.Body>
      <Modal.Footer>
        <ShareDialogFooter onDismiss={actions.dismiss} />
      </Modal.Footer>
    </Modal.Root>
  );
}

/**
 * A9: thu hồi không có đường khôi phục, nên hỏi trước (B-V3-06). Anh em của hộp thoại
 * chia sẻ, không phải con: `Modal.Root` có `transform`, một `fixed` bên trong sẽ bám
 * theo nó. Esc của hộp thoại này đăng ký sau nên trả lời trước.
 */
function RevokeConfirm({ url, actions }: { url: string | null; actions: ShareDialogProps['actions'] }) {
  return (
    <Modal.Root isOpen={url !== null} onClose={actions.cancelRevoke}>
      <Modal.Header>Thu hồi liên kết này?</Modal.Header>
      <Modal.Body>
        <p className="text-sm text-text-secondary">
          Ai đang giữ liên kết sẽ không mở được bản vẽ nữa, và không lấy lại được liên kết này.
        </p>
        <p className="mt-2 truncate font-mono text-xs text-text-primary">{url}</p>
      </Modal.Body>
      <Modal.Footer>
        <Button variant="ghost" onClick={actions.cancelRevoke}>
          Để nguyên
        </Button>
        <Button variant="danger" onClick={actions.confirmRevoke}>
          Thu hồi
        </Button>
      </Modal.Footer>
    </Modal.Root>
  );
}
