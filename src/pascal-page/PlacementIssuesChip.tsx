/**
 * Chip "⚠ N lỗi đặt đồ" của thanh trên trang 3D (C7, trước nằm lẫn trong menu Chất lượng).
 * `scenePlacementIssues`: chồng nhau, chắn cửa, lấn tường; `sanitaryPlacementIssues`: thiết bị vệ sinh sai
 * phòng, trùng, bồn cầu đối diện lavabo. Lỗi tính trên đồ thị ĐÃ sửa cảnh (`repairScene`, đồ AI chưa xác nhận);
 * mục "Đã tự xử lý N" liệt kê từng lần sửa kèm lý do, nút "Hiện dữ liệu gốc" tắt sửa cảnh trong phiên
 * (`sceneRepairStore` → cầu nối dựng lại). Bấm một dòng thì chọn món đồ đó trong trình dựng. Không có gì thì ẩn.
 */
/* eslint-disable react-refresh/only-export-components -- hàm thuần đi kèm chip để test gọi thẳng. */
import { AlertTriangle } from 'lucide-react';
import { useMemo } from 'react';

import { denormalizeSpatial } from '@/domain/spatial/normalize';
import { toPascalId } from '@/lib/pascal/ids';
import { scenePlacementIssues, type PlacementIssue } from '@/lib/pascal/placement';
import { sanitaryPlacementIssues } from '@/lib/pascal/sanitaryRules';
import type { SceneRepair, SceneRepairAction } from '@/lib/pascal/sceneLayer';
import { repairScene, sessionRepairs } from '@/lib/pascal/sceneRepair';
import { selectViewerSpatial } from '@/screens/viewer/ViewerShell/viewerShellGateway';
import { useStore } from '@/store';

import { MENU_SUMMARY_CLASS, menuPanelClass, useMenuGroup } from './menuGroup';
import { sceneRepairStore, useSceneRepairState } from './sceneRepairStore';

/** Số dòng lỗi hiện trong danh sách; phần còn lại gộp thành "và N lỗi khác". */
const ISSUE_LINES = 12;

export function placementSummary(issues: readonly PlacementIssue[]): string {
  return issues.length === 0 ? 'Không thấy lỗi đặt đồ' : `${issues.length} lỗi đặt đồ`;
}

export interface PlacementSelectStore {
  getState(): {
    setSelection(updates: { selectedIds: string[] }): void;
  };
}

export interface PlacementIssuesViewProps {
  readonly issues: readonly PlacementIssue[];
  /** Lần sửa cảnh đang áp (rỗng khi đang xem dữ liệu gốc). */
  readonly repairs?: readonly SceneRepair[];
  /** Sửa cảnh đang bật; `false` = đang hiện dữ liệu gốc. */
  readonly repairsEnabled?: boolean;
  readonly onToggleRepairs?: () => void;
  /** Chọn món đồ theo id AppFront; không có thì danh sách chỉ để đọc. */
  readonly onPick?: (furnitureId: string) => void;
}

const ACTION_LABELS: Record<SceneRepairAction, string> = { moved: 'Đã dời', rotated: 'Đã xoay', hidden: 'Đã ẩn', rescaled: 'Đã chỉnh cỡ' };
const ROW_CLASS = 'flex min-h-8 w-full items-center rounded-lg px-2 text-left text-[var(--pa-text-2)]';
const BUTTON_CLASS = `${ROW_CLASS} transition-colors duration-120 hover:bg-[var(--pa-sunken)] hover:text-[var(--pa-text)] motion-reduce:transition-none outline-none focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-[var(--pa-accent)]`;

function Row({ text, id, onPick }: { readonly text: string; readonly id: string | undefined; readonly onPick: ((id: string) => void) | undefined }) {
  return onPick === undefined || id === undefined ? (
    <span className={ROW_CLASS}>{text}</span>
  ) : (
    <button className={BUTTON_CLASS} onClick={() => onPick(id)} title="Chọn món đồ này" type="button">
      {text}
    </button>
  );
}

/** View thuần: test được chỉ từ props. */
export function PlacementIssuesView({ issues, repairs = [], repairsEnabled = true, onToggleRepairs, onPick }: PlacementIssuesViewProps) {
  useMenuGroup();
  if (issues.length === 0 && repairs.length === 0 && repairsEnabled) return null;
  const summary = issues.length > 0 || !repairsEnabled ? placementSummary(issues) : `Đã tự xử lý ${repairs.length} món`;
  return (
    <details className="relative" data-appfront-menu="">
      <summary
        aria-label={`${summary} — mở danh sách`}
        className={issues.length > 0 ? MENU_SUMMARY_CLASS.replace('text-[var(--pa-text)]', 'text-[var(--pa-warn)]') : MENU_SUMMARY_CLASS}
        title={summary}
      >
        <AlertTriangle aria-hidden="true" className="h-4 w-4 shrink-0" />
        {summary}
      </summary>
      <div className={menuPanelClass(false, 'w-80')}>
        {issues.length > 0 ? (
          <ul aria-label="Lỗi đặt đồ">
            {issues.slice(0, ISSUE_LINES).map((issue) => (
              <li key={`${issue.kind}-${issue.furnitureIds.join('-')}`}>
                <Row id={issue.furnitureIds[0]} onPick={onPick} text={issue.message} />
              </li>
            ))}
            {issues.length > ISSUE_LINES ? (
              <li className="px-2 py-1 text-[var(--pa-text-3)]">và {issues.length - ISSUE_LINES} lỗi khác</li>
            ) : null}
          </ul>
        ) : null}
        {repairs.length > 0 ? (
          <details className="mt-1">
            <summary className="flex min-h-8 cursor-pointer items-center px-2 font-medium text-[var(--pa-text)]">
              Đã tự xử lý {repairs.length}
            </summary>
            <ul aria-label="Đã tự xử lý">
              {repairs.map((r) => (
                <li key={r.furnitureId}>
                  {/* Món đã ẩn không còn trong cảnh nên không chọn được. */}
                  <Row id={r.action === 'hidden' ? undefined : r.furnitureId} onPick={onPick} text={`${ACTION_LABELS[r.action]}: ${r.reasonVi}`} />
                </li>
              ))}
            </ul>
          </details>
        ) : null}
        {onToggleRepairs === undefined ? null : (
          <button className={BUTTON_CLASS} onClick={onToggleRepairs} type="button">
            {repairsEnabled ? 'Hiện dữ liệu gốc (bỏ tự xử lý)' : 'Bật lại tự xử lý đồ AI'}
          </button>
        )}
        <p className="px-2 pt-1 pb-1.5 text-[12px] text-[var(--pa-text-3)]">
          Bấm một dòng để chọn món đồ, rồi kéo để sửa. Tự xử lý chỉ đổi cảnh, không đổi dữ liệu đã lưu.
        </p>
      </div>
    </details>
  );
}

export function PlacementIssuesChip({ useViewer }: { readonly useViewer?: PlacementSelectStore }) {
  const spatial = useStore(selectViewerSpatial);
  const { enabled, session } = useSceneRepairState();
  const { issues, repairs } = useMemo(() => {
    if (spatial === null) return { issues: [], repairs: [] };
    const stored = denormalizeSpatial(spatial);
    // Cùng phiên sửa cảnh của cầu nối (món người dùng đã đụng thì theo dữ liệu thật); chưa nạp thì tính tại chỗ.
    const { graph, repairs } = !enabled
      ? { graph: stored, repairs: [] }
      : session === null
        ? repairScene(stored)
        : sessionRepairs(session, stored);
    return { issues: [...sanitaryPlacementIssues(graph), ...scenePlacementIssues(graph)], repairs };
  }, [spatial, enabled, session]);
  // ponytail: chỉ chọn, không chuyển tầng — món ở tầng khác cần đổi tầng tay.
  const onPick =
    useViewer === undefined
      ? undefined
      : (furnitureId: string) => useViewer.getState().setSelection({ selectedIds: [toPascalId('item', furnitureId)] });
  return (
    <PlacementIssuesView
      issues={issues}
      onToggleRepairs={() => sceneRepairStore.set({ enabled: !enabled })}
      repairs={repairs}
      repairsEnabled={enabled}
      {...(onPick === undefined ? {} : { onPick })}
    />
  );
}
