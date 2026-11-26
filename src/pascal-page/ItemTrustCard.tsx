/**
 * Nhãn tin cậy của trang 3D (D7): chọn đúng MỘT món đồ thì cụm chỉnh cảnh nói món đó đến từ đâu —
 * máy tự thêm, máy chưa chắc, hay người đã duyệt. Đọc `metadata` mà `toPascal.ts` chép sang
 * (`appfront.confidence/reviewed`, `generated`). Xanh "đã xác minh" chỉ cho việc người duyệt (A5).
 */
/* eslint-disable react-refresh/only-export-components -- hàm thuần đi kèm thẻ để test gọi thẳng. */
import { formatNumber } from '@/lib/format/number';
import { appFrontIdOf } from '@/lib/pascal/ids';
import { CONFIDENCE_SUGGESTED_THRESHOLD } from '@/lib/format/semantic';

import type { SwapModelStores } from './SwapModelCard';

interface LooseMetadata {
  readonly generated?: unknown;
  readonly appfront?: { readonly confidence?: unknown; readonly reviewed?: unknown };
}

interface LooseNode {
  readonly type: string;
  readonly metadata?: LooseMetadata;
}

export interface ItemTrustLabel {
  readonly text: string;
  readonly tone: 'verified' | 'attention' | 'neutral';
}

/** Nhãn của một món đồ; `null` khi không có gì cần nói (máy khá chắc, chưa duyệt). */
export function itemTrustLabelOf(metadata: LooseMetadata | undefined): ItemTrustLabel | null {
  if (metadata === undefined) return null;
  if (metadata.generated !== undefined) return { text: 'Máy tự thêm — không có trên bản vẽ', tone: 'neutral' };
  const origin = metadata.appfront;
  if (origin === undefined) return null;
  if (origin.reviewed === true) return { text: 'Bạn đã duyệt', tone: 'verified' };
  const confidence = origin.confidence;
  if (typeof confidence === 'number' && confidence < CONFIDENCE_SUGGESTED_THRESHOLD) {
    return { text: `Máy chưa chắc (${formatNumber(confidence, { fractionDigits: 2 })}) — chưa ai duyệt`, tone: 'attention' };
  }
  return null;
}

/** Chữ ngắn của huy hiệu; câu đầy đủ nằm ở chú thích (`title`) và tên đọc được. */
export const TRUST_BADGE: Record<ItemTrustLabel['tone'], string> = {
  verified: 'Đã duyệt',
  attention: 'Chưa duyệt',
  neutral: 'Máy thêm',
};

const DOT_CLASS: Record<ItemTrustLabel['tone'], string> = {
  verified: 'bg-[var(--pa-ok)]',
  attention: 'bg-[var(--pa-warn)]',
  neutral: 'bg-[var(--pa-text-3)]',
};

export function ItemTrustCard({ stores }: { readonly stores: SwapModelStores }) {
  const ids = stores.useViewer((s) => s.selection.selectedIds);
  const metadata = stores.useScene((s) => {
    const node = ids.length === 1 ? (s.nodes as Record<string, LooseNode | undefined>)[ids[0] as string] : undefined;
    if (node?.type !== 'item') return undefined;
    // Món trình soạn vừa tạo (nhân bản) mang túi `appfront` chép từ món gốc; lượt lưu ghi nó là đồ người đặt, chưa duyệt.
    return appFrontIdOf('furniture', ids[0] as string) !== null || node.metadata?.generated !== undefined ? node.metadata : undefined;
  });
  const label = itemTrustLabelOf(metadata);
  if (label === null) return null;

  return (
    <span
      aria-label={label.text}
      className="flex h-8 shrink-0 items-center gap-1.5 whitespace-nowrap px-2 text-[12px] text-[var(--pa-text-2)]"
      data-tone={label.tone}
      role="status"
      title={label.text}
    >
      <span aria-hidden="true" className={`h-2 w-2 shrink-0 rounded-full ${DOT_CLASS[label.tone]}`} />
      {TRUST_BADGE[label.tone]}
    </span>
  );
}
