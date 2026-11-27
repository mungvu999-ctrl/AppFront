/**
 * NHA-09b — cảnh 3D còn nói "đã duyệt" mà bản lưu đã bỏ. Thuần, không React, không nhập gói Pascal.
 *
 * Lượt lưu luôn lấy phán quyết duyệt từ bản đã lưu (A5) và bỏ nó khi lượt sửa là thật (C2), nhưng không ghi
 * ngược vào cảnh: túi `metadata.appfront` của node vẫn mang `reviewed: true`, nên chip "Bạn đã duyệt" của thẻ
 * mái và thẻ đồ đạc còn xanh. Ctrl+Z cũng đưa túi cũ quay lại. Hàm này nhận ra đúng tình huống đó để màn dựng
 * lại cảnh từ kho.
 */

import type { Command, EntityChange } from '@/lib/commands/types';

import { reviewLostNotices } from './fromPascal';
import { bodyOfPascalId } from './ids';

interface BadgeNode {
  readonly id: string;
  readonly type?: string;
  readonly metadata?: { readonly appfront?: { readonly source?: unknown; readonly reviewed?: unknown } } | undefined;
}

type BadgeNodes = Readonly<Record<string, BadgeNode | undefined>>;

/** Loại thực thể có thẻ đọc túi duyệt của node (thẻ mái, thẻ đồ đạc). Loại khác không có chip nào để lệch. */
const BADGE_KINDS: ReadonlySet<string> = new Set(['roof', 'furniture']);
/** Cùng hai loại ấy, theo `type` của node cảnh. */
const BADGE_NODE_TYPES: ReadonlySet<string> = new Set(['roof', 'item']);

interface SavedChange {
  readonly kind: string;
  /** Thực thể sau lượt lưu; `null` khi lượt đó là xoá. */
  readonly after: { readonly id: string; readonly reviewed: boolean } | null;
}

/**
 * Có node nào của cảnh còn mang "đã duyệt" trong khi lượt vừa lưu ghi thực thể ấy là chưa duyệt không.
 * Chỉ xét loại có thẻ: tường, cửa, phòng cũng mang túi, nhưng dựng lại cảnh giữa lúc kéo vì chúng là thừa.
 */
export function hasStaleReviewBadge(nodes: BadgeNodes, changes: readonly SavedChange[]): boolean {
  const unreviewed = new Set(
    changes.flatMap(({ kind, after }) =>
      BADGE_KINDS.has(kind) && after !== null && !after.reviewed ? [after.id] : [],
    ),
  );

  return (
    unreviewed.size > 0 &&
    Object.values(nodes).some(
      (node) =>
        node?.metadata?.appfront?.reviewed === true && unreviewed.has(bodyOfPascalId(node.id)),
    )
  );
}

/**
 * Lượt không ghi gì mà túi nguồn/duyệt của một node đổi so với cảnh đã lưu: Ctrl+Z vừa đưa túi cũ về (vd. túi `ai`
 * của mái mà bản lưu đã là người sửa). Kho giữ phán quyết cũ, nên không dựng lại thì thẻ hiện nút duyệt bấm không lưu.
 * Node mới hay node đã gỡ thì bỏ qua: dựng lại cảnh sẽ xoá node đang vẽ dở. Node không có thẻ (tường, cửa, phòng) cũng vậy.
 */
export const hasRevertedBadge = (saved: BadgeNodes, nodes: BadgeNodes, changedNodeIds: readonly string[]): boolean =>
  changedNodeIds.some((id) => {
    const [before, after] = [saved[id], nodes[id]];

    return (
      before !== undefined &&
      after !== undefined &&
      BADGE_NODE_TYPES.has(after.type ?? '') &&
      (before.metadata?.appfront?.source !== after.metadata?.appfront?.source ||
        before.metadata?.appfront?.reviewed !== after.metadata?.appfront?.reviewed)
    );
  });

/**
 * Hệ quả về dấu duyệt của một lượt vừa lưu: câu báo "vừa sửa … đã duyệt" và việc cảnh có phải dựng lại không.
 * `own` là các thay đổi do chính lượt nhận gợi ý đặt: Ctrl+Z trả món về gợi ý là bỏ dấu duyệt của lượt nhận, không
 * phải "vừa sửa đồ đã duyệt", nên không báo.
 */
export const reviewLossOf = (
  nodes: BadgeNodes,
  command: Command,
  own: readonly EntityChange[],
): { readonly notices: string[]; readonly staleBadge: boolean } => ({
  notices: reviewLostNotices({
    ...command,
    changes: command.changes.filter((change) => !own.some((mine) => mine.id === change.id)),
  }),
  staleBadge: hasStaleReviewBadge(nodes, command.changes),
});
