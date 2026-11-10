/**
 * Đặt cảnh editor về một cảnh đích bằng PHẦN CHÊNH (tạo / sửa / xoá đúng các node khác), không
 * `setScene` cả cây: thay cả cây làm mọi node dựng lại — cả mô hình nháy như tải lại (xoá một cửa
 * bị từ chối mà cả nhà chớp). Thuần dữ liệu, không nhập gói Pascal; `main.tsx` đổ kết quả vào
 * `useScene.applyNodeChanges`.
 */

import { isAutoSurface } from '@/lib/pascal/toSpatial';
import type { PascalNode } from '@/lib/pascal/types';

interface LooseNode {
  readonly id: string;
  readonly parentId?: string | null;
  readonly [key: string]: unknown;
}

export interface NodeChanges {
  readonly create: { readonly node: LooseNode; readonly parentId?: string }[];
  readonly update: { readonly id: string; readonly data: Readonly<Record<string, unknown>> }[];
  readonly delete: string[];
}

const same = (a: unknown, b: unknown): boolean => a === b || JSON.stringify(a) === JSON.stringify(b);

/**
 * Phần chênh từ `current` tới `target`. Node đích thường CHƯA điền mặc định lược đồ (cảnh dựng từ
 * kho), node hiện tại đã điền — nên chỉ so các khoá node đích có, không thì mọi node đều "khác".
 * Node tạo mới xếp cha trước con; xoá chỉ gốc của cành bị xoá (vendor xoá kéo theo con).
 */
export function nodeChangesTo(
  current: Readonly<Record<string, unknown>>,
  target: Readonly<Record<string, unknown>>,
): NodeChanges {
  const create: NodeChanges['create'] = [];
  const update: NodeChanges['update'] = [];
  const added = new Set<string>();
  /* Sàn/trần vendor tự sinh theo tường (`autoFromWalls`) không có trong cảnh dựng từ kho: xoá chúng
     (và gỡ khỏi `children` của tầng) là mất sàn/trần — đổi cả ánh sáng — mà không hệ nào dựng lại. */
  /* Vạch đo là node cục bộ của phiên (người "Chỉ xem" cũng đo được) — dựng lại hiển thị không được xoá chúng. */
  const kept = (id: string): boolean =>
    target[id] === undefined &&
    (isAutoSurface(current[id] as PascalNode | undefined) || (current[id] as { type?: unknown } | undefined)?.type === 'measurement');
  const visit = (id: string) => {
    if (added.has(id) || current[id] !== undefined) return;
    const node = target[id] as LooseNode | undefined;
    if (node === undefined) return;
    added.add(id);
    const parentId = node.parentId ?? null;
    if (parentId !== null) visit(parentId);
    create.push(parentId === null ? { node } : { node, parentId });
  };

  for (const [id, raw] of Object.entries(target)) {
    const before = current[id] as Readonly<Record<string, unknown>> | undefined;
    if (before === undefined) {
      visit(id);
      continue;
    }
    const keptChildren = Array.isArray(before['children']) ? (before['children'] as string[]).filter(kept) : [];
    const node =
      keptChildren.length > 0 && Array.isArray((raw as LooseNode)['children'])
        ? { ...(raw as LooseNode), children: [...((raw as LooseNode)['children'] as string[]), ...keptChildren] }
        : (raw as Readonly<Record<string, unknown>>);
    if (Object.keys(node).some((key) => !same(before[key], node[key]))) update.push({ id, data: node });
  }

  const gone = new Set(Object.keys(current).filter((id) => target[id] === undefined && !kept(id)));
  const removed = [...gone].filter((id) => {
    const parentId = (current[id] as LooseNode | undefined)?.parentId ?? null;
    return parentId === null || !gone.has(parentId);
  });

  return { create, update, delete: removed };
}

export const isEmptyChange = (changes: NodeChanges): boolean =>
  changes.create.length === 0 && changes.update.length === 0 && changes.delete.length === 0;
