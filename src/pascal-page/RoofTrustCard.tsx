/**
 * Thẻ "Duyệt mái" của trang 3D (NHA-09): chọn đúng MỘT mái (hoặc một mặt mái của nó) do máy dựng thì cụm chỉnh
 * cảnh nói rõ "Mái do máy dựng — cần duyệt" và có nút "Duyệt mái". Xanh "đã xác minh" chỉ hiện sau khi người
 * dùng duyệt (A5). Tầng có mái máy dựng chưa duyệt thì chưa "Sẵn sàng" (lý do `roofUnreviewed`, NHA-07b).
 *
 * Duyệt = MỘT bước hoàn tác đổi túi `metadata.appfront` của node mái (`approvedRoofMetadata`); bộ tự lưu → cầu
 * `onSave` ghi như mọi lượt sửa. Sửa mái bằng công cụ không tự tắt chip: đã sửa chưa phải là đã duyệt.
 *
 * Không nhập `@pascal-app/*` (như `OpeningKindCard`): `main.tsx` truyền store và `runAsSingleSceneHistoryStep`.
 */
import { approvedRoofMetadata, roofNodeOfSelection, roofTrustLabelOf, type LooseRoofNode, type RoofTrustLabel } from '@/lib/pascal/roofReview';

import type { SwapModelStores } from './SwapModelCard';

const APPROVE = 'Duyệt mái';

export interface RoofTrustStores {
  readonly useViewer: SwapModelStores['useViewer'];
  readonly useScene: {
    <T>(selector: (state: { nodes: object }) => T): T;
    getState(): { updateNode(id: string, data: object): void };
  };
  /** Gom mọi lượt ghi trong `run` thành một bước Ctrl+Z. */
  readonly singleStep: (run: () => void) => void;
}

const DOT_CLASS: Record<RoofTrustLabel['tone'], string> = {
  verified: 'bg-[var(--pa-ok)]',
  attention: 'bg-[var(--pa-warn)]',
};

export function RoofTrustCard({ stores, readOnly }: { readonly stores: RoofTrustStores; readonly readOnly: boolean }) {
  const ids = stores.useViewer((s) => s.selection.selectedIds);
  const roof = stores.useScene((s) =>
    ids.length === 1 ? roofNodeOfSelection(s.nodes as Record<string, LooseRoofNode | undefined>, ids[0] as string) : undefined,
  );
  const label = roofTrustLabelOf(roof?.metadata);

  if (roof === undefined || label === null) return null;

  const approve = () => {
    stores.singleStep(() => {
      stores.useScene.getState().updateNode(roof.id, { metadata: approvedRoofMetadata(roof.metadata) });
    });
  };

  return (
    <>
      <span
        className="flex h-8 shrink-0 items-center gap-1.5 whitespace-nowrap px-2 text-[12px] text-[var(--pa-text-2)]"
        data-tone={label.tone}
        role="status"
      >
        <span aria-hidden="true" className={`h-2 w-2 shrink-0 rounded-full ${DOT_CLASS[label.tone]}`} />
        {label.text}
      </span>
      {/* shortcut: máy chủ đòi quyền `qc.approve` để duyệt; hiện nó trùng quyền sửa lớp (admin, engineer) nên `readOnly`
          là đủ. Khi ma trận quyền có vai sửa được mà không duyệt được thì truyền riêng quyền duyệt vào đây. */}
      {label.needsApproval && !readOnly ? (
        <button
          className="h-8 shrink-0 whitespace-nowrap rounded-xl border border-[var(--pa-border)] bg-[var(--pa-surface)] px-2.5 text-[13px] font-medium text-[var(--pa-text-2)] shadow-[var(--pa-shadow-float)] transition-colors duration-120 hover:bg-[var(--pa-sunken)] hover:text-[var(--pa-text)] motion-reduce:transition-none outline-none focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-[var(--pa-accent)]"
          onClick={approve}
          type="button"
        >
          {APPROVE}
        </button>
      ) : null}
    </>
  );
}
