/**
 * Ghi công mẫu 3D tải về: chọn đúng một món đồ dùng mẫu thư viện máy chủ có ghi công thì hiện
 * "Mẫu 3D: …" trong cụm chỉnh cảnh. Máy chủ gửi một dòng nối bằng " · " (CC BY đủ TASL, NO-437):
 * [“tên gốc”] · tác giả · giấy phép · URL giấy phép · URL nguồn… · đã chỉnh sửa: …
 * Phần là URL hiện thành liên kết ngắn ("giấy phép" / "nguồn"); ghi chú chỉnh sửa rút gọn, câu đủ ở chú thích.
 */
/* eslint-disable react-refresh/only-export-components -- hàm thuần đi kèm thẻ để test gọi thẳng. */
import { Fragment } from 'react';

import { serverAttributionOf } from '@/lib/pascal/furnitureCatalog';

import type { SwapModelStores } from './SwapModelCard';

interface LooseNode {
  readonly type: string;
  readonly asset?: { readonly id: string };
}

export type CreditPart =
  | { readonly kind: 'text'; readonly text: string }
  | { readonly kind: 'link'; readonly text: string; readonly href: string };

const MODIFIED = 'đã chỉnh sửa';

/** Tách chuỗi ghi công thành phần chữ và liên kết (chỉ http/https mới thành liên kết). */
export function creditPartsOf(credit: string): readonly CreditPart[] {
  return credit.split(' · ').map((part): CreditPart => {
    if (/^https?:\/\//.test(part)) {
      // URL chung /licenses/ (không có /by/<bản>/) = giấy phép chưa rõ phiên bản (NO-438).
      const text = part.startsWith('https://creativecommons.org/') ? (/^https:\/\/creativecommons\.org\/licenses\/?$/.test(part) ? 'giấy phép (chưa rõ phiên bản)' : 'giấy phép') : 'nguồn';
      return { kind: 'link', text, href: part };
    }
    return { kind: 'text', text: part.startsWith(MODIFIED) ? MODIFIED : part };
  });
}

export function ModelCreditCard({ stores }: { readonly stores: SwapModelStores }) {
  const ids = stores.useViewer((s) => s.selection.selectedIds);
  const assetId = stores.useScene((s) => {
    const node = ids.length === 1 ? (s.nodes as Record<string, LooseNode | undefined>)[ids[0] as string] : undefined;
    return node?.type === 'item' ? node.asset?.id : undefined;
  });
  const credit = assetId === undefined ? undefined : serverAttributionOf(assetId);
  if (credit === undefined) return null;

  return (
    <span
      className="flex h-8 shrink-0 items-center whitespace-nowrap px-2.5 text-[12px] text-[var(--pa-text-3)]"
      title={credit}
    >
      {/* Một khối chữ trong thẻ flex để khoảng trắng quanh liên kết không bị nuốt. */}
      <span>
        Mẫu 3D:{' '}
        {creditPartsOf(credit).map((part, i) => (
          <Fragment key={i}>
            {i > 0 ? ' · ' : null}
            {part.kind === 'link' ? (
              <a className="underline hover:text-[var(--pa-text-2)]" href={part.href} rel="noopener noreferrer" target="_blank">
                {part.text}
              </a>
            ) : (
              part.text
            )}
          </Fragment>
        ))}
      </span>
    </span>
  );
}
