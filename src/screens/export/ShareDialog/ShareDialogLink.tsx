/**
 * Mục 2 — tạo liên kết chia sẻ, và danh sách liên kết đang hoạt động.
 *
 * Liên kết mới luôn là "chỉ xem": quyền "góp ý" không có giao diện hay đường ghi nào ở
 * trang chia sẻ nên không được chào mời. Liên kết cũ mang quyền ấy vẫn hiện đúng nhãn
 * trong danh sách. Không có mật khẩu: máy chủ chưa kiểm mật khẩu nên không hứa gì về nó.
 * Hạn dùng đến từ `model.form.expiryChoices`, không hardcode ở đây.
 */

import { Check, Copy } from 'lucide-react';

import { Badge } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { IconButton } from '@/components/ui/IconButton';
import { Select } from '@/components/ui/Select';

import type { ShareDialogActions, ShareLinkFormModel, ShareLinkRowModel } from './types';

export interface ShareDialogLinkProps {
  readonly form: ShareLinkFormModel;
  readonly rows: readonly ShareLinkRowModel[];
  readonly canCreateLink: boolean;
  readonly noPermissionReason: string | null;
  readonly copiedTargetId: string | null;
  readonly actions: Pick<
    ShareDialogActions,
    'setExpiryChoice' | 'createLink' | 'revokeLink' | 'copyLink'
  >;
}

function FieldError({ message }: { readonly message: string | undefined }) {
  if (message === undefined) {
    return null;
  }

  return (
    <p role="alert" className="text-xs text-state-violation-text">
      {message}
    </p>
  );
}

interface LinkRowProps {
  readonly row: ShareLinkRowModel;
  readonly isCopied: boolean;
  readonly onCopy: () => void;
  readonly onRevoke: () => void;
}

function LinkRow({ row, isCopied, onCopy, onRevoke }: LinkRowProps) {
  return (
    <li className="flex flex-col gap-2 rounded-lg border border-border-default p-3">
      <div className="flex flex-wrap items-center gap-2">
        <Badge variant={row.tone}>{row.statusLabel}</Badge>
        <Badge variant="neutral">{row.permissionLabel}</Badge>
        <span className="ml-auto text-xs text-text-secondary">{row.expiryText}</span>
      </div>

      <div className="flex items-center gap-2">
        <p className="flex-1 truncate rounded-lg border border-border-default bg-bg-surface px-3 py-2 font-mono text-xs text-text-primary">
          {row.url}
        </p>
        <IconButton
          aria-label={isCopied ? 'Đã sao chép liên kết' : 'Sao chép liên kết'}
          icon={isCopied ? <Check size={16} aria-hidden="true" /> : <Copy size={16} aria-hidden="true" />}
          onClick={onCopy}
        />
      </div>

      {row.canRevoke && (
        <Button variant="ghost" size="sm" onClick={onRevoke} className="self-start">
          Thu hồi
        </Button>
      )}
    </li>
  );
}

export function ShareDialogLink({
  form,
  rows,
  canCreateLink,
  noPermissionReason,
  copiedTargetId,
  actions,
}: ShareDialogLinkProps) {
  const expirySelectOptions = form.expiryChoices.map((option) => ({ label: option.label, value: option.id }));

  return (
    <section aria-label="Liên kết chia sẻ" className="flex flex-col gap-3">
      <h3 className="text-sm font-medium text-text-secondary">Liên kết chia sẻ</h3>

      {!canCreateLink ? (
        <p className="text-xs text-text-secondary">{noPermissionReason}</p>
      ) : (
        <div className="flex flex-col gap-3 rounded-lg border border-border-default p-3">
          <p className="text-xs text-text-secondary">Người có liên kết chỉ xem được bản vẽ, không sửa được.</p>

          <div className="flex flex-col gap-1">
            <Select
              label="Hạn dùng"
              options={expirySelectOptions}
              value={form.expiryChoiceId}
              onChange={actions.setExpiryChoice}
            />
            <FieldError message={form.problems.expiresAt} />
          </div>

          <Button
            variant="primary"
            disabled={!form.canSubmit}
            onClick={actions.createLink}
            className="self-start"
          >
            Tạo liên kết
          </Button>
        </div>
      )}

      {rows.length > 0 && (
        <ul className="flex flex-col gap-2">
          {rows.map((row) => (
            <LinkRow
              key={row.id}
              row={row}
              isCopied={copiedTargetId === row.id}
              onCopy={() => {
                actions.copyLink(row.id);
              }}
              onRevoke={() => {
                actions.revokeLink(row.id);
              }}
            />
          ))}
        </ul>
      )}
    </section>
  );
}
