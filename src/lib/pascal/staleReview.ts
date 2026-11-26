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
  readonly metadata?: { readonly appfront?: { readonly reviewed?: unknown } } | undefined;
}

interface SavedChange {
  /** Thực thể sau lượt lưu; `null` khi lượt đó là xoá. */
  readonly after: { readonly id: string; readonly reviewed: boolean } | null;
}

/** Có node nào của cảnh còn mang "đã duyệt" trong khi lượt vừa lưu ghi thực thể ấy là chưa duyệt không. */
export function hasStaleReviewBadge(
  nodes: Readonly<Record<string, BadgeNode | undefined>>,
  changes: readonly SavedChange[],
): boolean {
  const unreviewed = new Set(
    changes.flatMap(({ after }) => (after !== null && !after.reviewed ? [after.id] : [])),
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
 * Hệ quả về dấu duyệt của một lượt vừa lưu: câu báo "vừa sửa … đã duyệt" và việc cảnh có phải dựng lại không.
 * `own` là các thay đổi do chính lượt nhận gợi ý đặt: Ctrl+Z trả món về gợi ý là bỏ dấu duyệt của lượt nhận, không
 * phải "vừa sửa đồ đã duyệt", nên không báo.
 */
export const reviewLossOf = (
  nodes: Readonly<Record<string, BadgeNode | undefined>>,
  command: Command,
  own: readonly EntityChange[],
): { readonly notices: string[]; readonly staleBadge: boolean } => ({
  notices: reviewLostNotices({
    ...command,
    changes: command.changes.filter((change) => !own.some((mine) => mine.id === change.id)),
  }),
  staleBadge: hasStaleReviewBadge(nodes, command.changes),
});
