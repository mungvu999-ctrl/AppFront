/**
 * Duyệt mái trong trang 3D (NHA-09). Thuần, không React, không nhập gói Pascal.
 *
 * Mái do tác vụ ráp nhà của BE dựng đến như mọi mái khác, chỉ khác túi `metadata.appfront` mang
 * `source: 'ai'`, chưa duyệt. Người dùng bấm "Duyệt mái" thì túi đổi thành `source: 'human', reviewed: true`;
 * lượt lưu đọc lại đúng túi này (`toSpatial.ts`, `reviewOf`). Phải đổi CẢ hai khoá: zod lẫn BE đều cấm `ai` đi
 * cùng `reviewed: true` (A5: máy không tự nhận đã duyệt).
 *
 * Sửa mái bằng công cụ không đụng tới túi này: đã sửa chưa phải là đã duyệt.
 */

interface LooseOrigin {
  readonly source?: unknown;
  readonly reviewed?: unknown;
}

interface LooseMetadata {
  readonly appfront?: LooseOrigin;
  readonly [key: string]: unknown;
}

export interface LooseRoofNode {
  readonly id: string;
  readonly type?: string;
  readonly parentId?: string | null;
  readonly metadata?: LooseMetadata;
}

export interface RoofTrustLabel {
  readonly text: string;
  readonly tone: 'verified' | 'attention';
  /** Mái máy dựng chưa ai duyệt: có nút "Duyệt mái". */
  readonly needsApproval: boolean;
}

/**
 * Nhãn của một mái; `null` khi không có gì cần nói (mái người vẽ, mái vừa vẽ trong 3D).
 *
 * Xanh chỉ cho cặp `human` + đã duyệt: túi `ai` mà mang `reviewed: true` là cặp dây cấm, lượt lưu không nhận,
 * nên mái đó vẫn là "cần duyệt".
 *
 * Nhãn đọc túi của cảnh, không đọc bản đã lưu. Sửa hình mái SAU khi duyệt thì bản lưu mất dấu duyệt (C2); lượt lưu
 * đó báo màn dựng lại cảnh từ kho (`staleReview.ts`, NHA-09b), nên túi và chip theo kịp ngay sau lượt lưu.
 */
export function roofTrustLabelOf(metadata: LooseMetadata | undefined): RoofTrustLabel | null {
  const origin = metadata?.appfront;

  if (origin?.source === 'ai')
    return { text: 'Mái do máy dựng — cần duyệt', tone: 'attention', needsApproval: true };

  return origin?.source === 'human' && origin.reviewed === true
    ? { text: 'Bạn đã duyệt', tone: 'verified', needsApproval: false }
    : null;
}

/** Metadata của node mái sau khi người dùng duyệt; mọi khoá khác giữ nguyên. */
export const approvedRoofMetadata = (
  metadata: LooseMetadata | undefined,
): Record<string, unknown> => ({
  ...metadata,
  appfront: { ...metadata?.appfront, source: 'human', reviewed: true },
});

/** Node mái chủ của node đang chọn: chính nó nếu là `roof`, node cha nếu là một mặt mái (`roof-segment`). */
export function roofNodeOfSelection<T extends LooseRoofNode>(
  nodes: Readonly<Record<string, T | undefined>>,
  selectedId: string,
): T | undefined {
  const node = nodes[selectedId];

  if (node?.type === 'roof') return node;
  const parent =
    node?.type === 'roof-segment' && typeof node.parentId === 'string'
      ? nodes[node.parentId]
      : undefined;

  return parent?.type === 'roof' ? parent : undefined;
}
