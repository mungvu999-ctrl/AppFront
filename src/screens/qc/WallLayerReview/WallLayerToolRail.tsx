/**
 * Ray công cụ trái (56px) của màn Duyệt lớp tường.
 *
 * View THUẦN (R-60): không `useState` cho công cụ đang chọn — đó là trạng thái
 * NGHIỆP VỤ (S-08 `toolMachine`), sở hữu bởi hook, không phải bản sao cục bộ ở
 * đây (mục D). {@link WallLayerToolRailProps} là phần MỞ RỘNG ngoài `types.ts`
 * (đóng băng vì ba worker song song) — quyết định của điều phối viên sau khi
 * worker này báo lỗ hổng hợp đồng: component con được phép tự khai props của
 * chính nó, thay vì sửa `types.ts`. Container/hook (T8) truyền các trường này
 * khi ghép màn.
 *
 * "nối đoạn" KHÔNG phải một `ToolId` (toolMachine không có mục cho merge) — nó
 * là nút HÀNH ĐỘNG theo vùng chọn, vô hiệu qua `canMerge` (hook tính, vì canvas
 * hiện chỉ có một `selectedWallId`, không phải danh sách nhiều lựa chọn).
 */

import { Fragment } from 'react';
import {
  GitMerge,
  MousePointer2,
  Ruler,
  Scissors,
  Square,
  type LucideIcon,
} from 'lucide-react';

import { IconButton } from '@/components/ui/IconButton';
import { Tooltip } from '@/components/ui/Tooltip';

import { QcRailCollapse } from '../shared/QcRailCollapse';

/** Bốn chế độ công cụ thật của màn — khớp `ToolId` của `toolMachine` (không có mục merge). */
export type WallLayerToolId = 'select' | 'drawWall' | 'splitWall' | 'measure';

export interface WallLayerToolRailProps {
  readonly activeTool: WallLayerToolId;
  readonly onSelectTool: (tool: WallLayerToolId) => void;
  /** Bật khi đã chọn đủ hai đoạn tường để gộp. */
  readonly canMerge: boolean;
  readonly onMerge: () => void;
  /** `true` ở vai Người xem — ẩn công cụ vẽ/tách/gộp, chỉ còn chọn và đo. */
  readonly readOnly: boolean;
  /** Hai panel đang thu gọn hay không — nút cuối ray đổi nhãn theo nó. */
  readonly isCollapsed: boolean;
  /**
   * Thu gọn / mở lại hai panel (BT-16).
   *
   * `WallLayerViewProps.onToggleCollapsed` đã có từ hợp đồng L1 nhưng KHÔNG
   * view nào gọi, nên trạng thái `collapsed` chỉ tới được từ `forceCollapsed` —
   * một cửa của story và bài kiểm, không phải của người dùng. R-73 gọi đích
   * danh "một hành động chỉ tồn tại như một prop optional không ai truyền", nên
   * nút này là chỗ hành động đó có mặt trên màn.
   */
  readonly onToggleCollapsed: () => void;
}

interface WallLayerToolDef {
  readonly id: WallLayerToolId;
  /** Nhãn tiếng Việt, kiểu câu viết hoa chữ đầu (A6, BUG-604). */
  readonly label: string;
  readonly icon: LucideIcon;
  /** Tên phím — chữ hoa vì đây là tên phím, ngoại lệ của A6. */
  readonly kbd?: string;
  /**
   * `true` cho công cụ cần canvas tương tác — ẩn hẳn ở vai Người xem. "Đo" thuộc nhóm này: canvas của
   * người xem không nhận lượt bấm nên công cụ đo bấm không đo được gì (BUG-601).
   */
  readonly isEditTool: boolean;
}

const TOOLS: readonly WallLayerToolDef[] = [
  { id: 'select', label: 'Chọn', icon: MousePointer2, kbd: 'V', isEditTool: false },
  { id: 'drawWall', label: 'Vẽ tường', icon: Square, kbd: 'W', isEditTool: true },
  { id: 'splitWall', label: 'Tách đoạn', icon: Scissors, kbd: 'X', isEditTool: true },
  { id: 'measure', label: 'Đo', icon: Ruler, kbd: 'M', isEditTool: true },
];

const MERGE_LABEL = 'Nối đoạn';
const MERGE_HINT = 'Chọn hai đoạn thẳng hàng để nối (Ctrl hoặc Shift + bấm)';
const RAIL_ARIA_LABEL = 'Công cụ lớp tường';

/**
 * Vị trí của "nối đoạn" trên ray — TRƯỚC "đo" (BC-02).
 *
 * Đặc tả đọc ray theo thứ tự chọn · vẽ tường · tách đoạn · nối đoạn · đo. "Nối
 * đoạn" vẫn KHÔNG phải một `ToolId` thứ chín (xem đầu file), nên nó không vào
 * được {@link TOOLS}; thay vào đó khối nút của nó được chèn ngay trước mục mang
 * mã này. Ở vai Người xem "đo" vẫn hiện còn "nối đoạn" bị ẩn, và thứ tự này
 * không đụng vào hai nhánh đó.
 */
const MERGE_BEFORE_TOOL: WallLayerToolId = 'measure';

export function WallLayerToolRail({
  activeTool,
  onSelectTool,
  canMerge,
  onMerge,
  readOnly,
  isCollapsed,
  onToggleCollapsed,
}: WallLayerToolRailProps) {
  const mergeButton = readOnly ? null : (
    <div className="relative flex w-full flex-col items-center gap-0.5" key="merge">
      <Tooltip label={canMerge ? MERGE_LABEL : MERGE_HINT}>
        {/* Nút tắt không nhận rê chuột — bọc span để lý do khoá vẫn hiện (G4a-12). */}
        <span className="inline-flex">
          <IconButton
            aria-label={canMerge ? MERGE_LABEL : `${MERGE_LABEL} — ${MERGE_HINT}`}
            disabled={!canMerge}
            icon={<GitMerge aria-hidden="true" className="h-[18px] w-[18px]" />}
            onClick={onMerge}
            size="lg"
            tooltip={false}
          />
        </span>
      </Tooltip>
      <span aria-hidden="true" className="w-full px-1 text-center text-[11px] leading-tight text-text-muted">{MERGE_LABEL}</span>
    </div>
  );

  return (
    <div
      aria-label={RAIL_ARIA_LABEL}
      aria-orientation="vertical"
      className="flex w-[72px] shrink-0 flex-col items-center gap-1 border-r border-border-default bg-bg-surface py-2"
      role="toolbar"
    >
      {TOOLS.map((tool) => {
        if (readOnly && tool.isEditTool) {
          return null;
        }

        const isActive = tool.id === activeTool;
        const Icon = tool.icon;

        const button = (
          <div className="relative flex w-full flex-col items-center gap-0.5" key={tool.id}>
            {isActive && (
              <span
                aria-hidden="true"
                className="absolute inset-y-1 left-0 w-0.5 rounded-full bg-accent"
              />
            )}
            <Tooltip {...(tool.kbd !== undefined ? { kbd: tool.kbd } : {})} label={tool.label}>
              <IconButton
                aria-label={tool.kbd ? `${tool.label} (phím ${tool.kbd})` : tool.label}
                className={isActive ? 'bg-accent-wash text-accent hover:bg-accent-wash' : undefined}
                icon={<Icon aria-hidden="true" className="h-[18px] w-[18px]" />}
                isActive={isActive}
                onClick={() => onSelectTool(tool.id)}
                size="lg"
                tooltip={false}
              />
            </Tooltip>
            {/* Nhãn chữ dưới icon (A3): rail không còn icon trần, cùng kiểu rail Cửa và nội thất. */}
            <span aria-hidden="true" className="w-full px-1 text-center text-[11px] leading-tight text-text-muted">{tool.label}</span>
          </div>
        );

        if (tool.id !== MERGE_BEFORE_TOOL) {
          return button;
        }

        return (
          <Fragment key={tool.id}>
            {mergeButton}
            {button}
          </Fragment>
        );
      })}

      <QcRailCollapse isCollapsed={isCollapsed} onToggle={onToggleCollapsed} />
    </div>
  );
}
