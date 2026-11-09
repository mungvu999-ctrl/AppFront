/**
 * Chip "⚠ N lỗi đặt đồ" của thanh trên trang 3D (C7, trước nằm lẫn trong menu Chất lượng).
 * `scenePlacementIssues`: chồng nhau, chắn cửa, lấn tường; `sanitaryPlacementIssues`: thiết bị vệ sinh sai
 * phòng, trùng, bồn cầu đối diện lavabo — chỉ báo, không tự dời đồ. Bấm một dòng
 * thì chọn món đồ đó trong trình dựng. Không có lỗi thì không hiện gì.
 */
/* eslint-disable react-refresh/only-export-components -- hàm thuần đi kèm chip để test gọi thẳng. */
import { AlertTriangle } from 'lucide-react';
import { useMemo } from 'react';

import { denormalizeSpatial } from '@/domain/spatial/normalize';
import { toPascalId } from '@/lib/pascal/ids';
import { scenePlacementIssues, type PlacementIssue } from '@/lib/pascal/placement';
import { sanitaryPlacementIssues } from '@/lib/pascal/sanitaryRules';
import { selectViewerSpatial } from '@/screens/viewer/ViewerShell/viewerShellGateway';
import { useStore } from '@/store';

import { MENU_SUMMARY_CLASS, menuPanelClass, useMenuGroup } from './menuGroup';

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
  /** Chọn món đồ theo id AppFront; không có thì danh sách chỉ để đọc. */
  readonly onPick?: (furnitureId: string) => void;
}

/** View thuần: test được chỉ từ props. */
export function PlacementIssuesView({ issues, onPick }: PlacementIssuesViewProps) {
  useMenuGroup();
  if (issues.length === 0) return null;
  const summary = placementSummary(issues);
  return (
    <details className="relative" data-appfront-menu="">
      <summary
        aria-label={`${summary} — mở danh sách`}
        className={MENU_SUMMARY_CLASS.replace('text-[var(--pa-text)]', 'text-[var(--pa-warn)]')}
        title={summary}
      >
        <AlertTriangle aria-hidden="true" className="h-4 w-4 shrink-0" />
        {summary}
      </summary>
      <div className={menuPanelClass(false, 'w-72')}>
        <ul aria-label="Lỗi đặt đồ">
          {issues.slice(0, ISSUE_LINES).map((issue) => {
            const id = issue.furnitureIds[0];
            return (
              <li key={`${issue.kind}-${issue.furnitureIds.join('-')}`}>
                {onPick === undefined || id === undefined ? (
                  <span className="flex min-h-8 items-center px-2 text-[var(--pa-text-2)]">{issue.message}</span>
                ) : (
                  <button
                    className="flex min-h-8 w-full items-center rounded-lg px-2 text-left text-[var(--pa-text-2)] transition-colors duration-120 hover:bg-[var(--pa-sunken)] hover:text-[var(--pa-text)] motion-reduce:transition-none outline-none focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-[var(--pa-accent)]"
                    onClick={() => onPick(id)}
                    title="Chọn món đồ này"
                    type="button"
                  >
                    {issue.message}
                  </button>
                )}
              </li>
            );
          })}
          {issues.length > ISSUE_LINES ? (
            <li className="px-2 py-1 text-[var(--pa-text-3)]">và {issues.length - ISSUE_LINES} lỗi khác</li>
          ) : null}
        </ul>
        <p className="px-2 pt-1 pb-1.5 text-[12px] text-[var(--pa-text-3)]">Bấm một dòng để chọn món đồ, rồi kéo để sửa.</p>
      </div>
    </details>
  );
}

export function PlacementIssuesChip({ useViewer }: { readonly useViewer?: PlacementSelectStore }) {
  const spatial = useStore(selectViewerSpatial);
  const issues = useMemo(() => {
    if (spatial === null) return [];
    const graph = denormalizeSpatial(spatial);
    return [...sanitaryPlacementIssues(graph), ...scenePlacementIssues(graph)];
  }, [spatial]);
  // ponytail: chỉ chọn, không chuyển tầng — món ở tầng khác cần đổi tầng tay.
  const onPick =
    useViewer === undefined
      ? undefined
      : (furnitureId: string) => useViewer.getState().setSelection({ selectedIds: [toPascalId('item', furnitureId)] });
  return <PlacementIssuesView issues={issues} {...(onPick === undefined ? {} : { onPick })} />;
}
