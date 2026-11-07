/**
 * Bảng tầng của `FloorManager` — cột phải, dòng cao 40px.
 *
 * VIEW THUẦN (R-60), file anh em của `FloorManager.tsx` (mục D CLAUDE.md).
 * `Pick<FloorManagerViewProps, …>` thay vì khai lại chữ ký handler.
 *
 * Một dòng bảng tách ra `FloorTableRow.tsx` — file anh em thứ 13 của thư mục,
 * điều phối viên đã duyệt vì `FloorTable.tsx` vượt trần 400 dòng của R-22 khi
 * gộp chung (xem đầu file đó và báo cáo `worker_done`).
 *
 * ## Menu ngữ cảnh (QĐ-C) và nhân bản hỏi ngay tại dòng
 *
 * `ContextMenu` nhập từ `@/components/canvas/ContextMenu` (không phải
 * `src/components/ui/`, xem `notes/floor-manager/ui.md` mục A.7). Nhân bản
 * KHÔNG mở hộp thoại: chọn mục "nhân bản" mở một dải hỏi "sao chép nội thất"
 * NGAY TRONG DÒNG đó (`duplicatingFloorId`, state cục bộ của view — không phải
 * dữ liệu nghiệp vụ, nên không phạm "view test được chỉ từ props": mọi lượt
 * xác nhận vẫn đi ra qua `onDuplicateFloor`).
 *
 * ## Kéo đổi thứ tự
 *
 * Chuột: HTML5 drag/drop trên tay nắm mỗi dòng. Nửa trên của dòng = chèn
 * trước nó (đường chèn 2px ở viền trên), nửa dưới = chèn sau nó — nên dòng cuối
 * cũng nhận được hàng kéo tới (BUG-518; đường chèn khi đó là viền dưới của nó). Bàn phím (A12, đường hạng nhất): dòng đang focus
 * + `Alt+↑`/`Alt+↓` hoán vị hai tầng liền kề — xử lý trong `FloorTableRow.tsx`.
 */

import { useRef, useState, type MouseEvent } from 'react';

import { ContextMenu } from '@/components/canvas/ContextMenu';
import { EmptyState } from '@/components/feedback/EmptyState';
import { InlineAlert } from '@/components/feedback/InlineAlert';
import { Section } from '@/components/shell/Section';
import { BACK_TO_PROJECTS_LABEL, PROJECT_NOT_FOUND_TITLE } from '@/components/feedback/ProjectSpatialGate';
import { Button } from '@/components/ui/Button';
import { Table } from '@/components/ui/Table';
import { Toggle } from '@/components/ui/Toggle';
import { useContextMenu } from '@/hooks/useContextMenu';

import { CELL, FloorTableRow } from './FloorTableRow';
import {
  FLOOR_COLUMN_LABELS,
  FLOOR_REVIEW_SCREENS,
  FLOOR_TOOL_SCREENS,
  type FloorManagerScreenState,
  type FloorManagerViewProps,
  type FloorRowVm,
} from './floorManagerTypes';

export interface FloorTableProps
  extends Pick<
    FloorManagerViewProps,
    | 'rows'
    | 'footer'
    | 'canEdit'
    | 'isAutoElevation'
    | 'emptyNotice'
    | 'errorMessage'
    | 'onSelectFloor'
    | 'onHoverFloor'
    | 'onFloorFieldChange'
    | 'onFloorFieldCommit'
    | 'onFloorFieldCancel'
    | 'onReorderFloors'
    | 'onAddFloor'
    | 'onDuplicateFloor'
    | 'onToggleHiddenIn3d'
    | 'onRemoveFloor'
    | 'onToggleAutoElevation'
    | 'onUploadDrawing'
    | 'onOpenOverlay'
    | 'onOpenFloorScreen'
    | 'onRetry'
    | 'isProjectMissing'
    | 'onBackToProjects'
  > {
  readonly state: FloorManagerScreenState;
  /** K34: dự án là các căn hộ riêng — không cao độ, không thêm hay đổi thứ tự tầng. */
  readonly separateUnits?: boolean;
}

const EMPTY_TITLE = 'Chưa có tầng nào';
const ERROR_TITLE = 'Không đọc được danh sách tầng';
const ADD_FLOOR_LABEL = 'Thêm tầng';
const DUPLICATE_SELECTED_LABEL = 'Nhân bản tầng';
const RETRY_LABEL = 'Thử lại';
/* Chú thích theo đúng công tắc, không một câu cố định nói "tự động" khi công tắc tắt (BUG-289). */
const CAPTION_AUTO = 'Cao độ tính tự động từ chiều cao các tầng dưới.';
const CAPTION_MANUAL = 'Cao độ đang nhập tay.';
const CAPTION_OVERRIDE = 'Ô ghi "Ghi đè" khác cao độ tính từ các tầng dưới.';
const COLUMN_WIDTH: Record<string, string> = {
  handle: 'w-10',
  name: 'w-[22%]',
  elevation: 'w-24',
  height: 'w-28',
  progress: '',
  actions: 'w-[140px]',
};
const OVERLAY_ACTION_LABEL = 'Đối chiếu lớp phủ';
const AUTO_ELEVATION_LABEL = 'Tự tính cao độ';
const SECTION_TITLE = 'Các tầng';
const CAPTION_REORDER = 'Kéo tay nắm hoặc dùng Alt + ↑ ↓ để đổi thứ tự.';

const EDITABLE_HEADERS = (Object.keys(FLOOR_COLUMN_LABELS) as (keyof typeof FLOOR_COLUMN_LABELS)[])
  .filter((key) => key !== 'qc')
  .map((key) => ({ key, label: FLOOR_COLUMN_LABELS[key] }));

export function FloorTable({
  state,
  rows,
  footer,
  canEdit,
  isAutoElevation,
  emptyNotice,
  errorMessage,
  onSelectFloor,
  onHoverFloor,
  onFloorFieldChange,
  onFloorFieldCommit,
  onFloorFieldCancel,
  onReorderFloors,
  onAddFloor,
  onDuplicateFloor,
  onToggleHiddenIn3d,
  onRemoveFloor,
  onToggleAutoElevation,
  onUploadDrawing,
  onOpenOverlay,
  onOpenFloorScreen,
  onRetry,
  isProjectMissing,
  onBackToProjects,
  separateUnits = false,
}: FloorTableProps) {
  const menu = useContextMenu();
  const [duplicatingFloorId, setDuplicatingFloorId] = useState<string | null>(null);
  const [copyFurniture, setCopyFurniture] = useState(false);
  /* Tên lúc nghỉ là chữ (bản Z): "Đổi tên" mở ô nhập của đúng dòng. */
  const [renamingFloorId, setRenamingFloorId] = useState<string | null>(null);
  const draggedFloorId = useRef<string | null>(null);
  const [dragOverIndex, setDragOverIndex] = useState<number | null>(null);

  const handleDrop = () => {
    const fromIndex = rows.findIndex((row) => row.id === draggedFloorId.current);

    if (fromIndex === -1 || dragOverIndex === null) {
      draggedFloorId.current = null;
      setDragOverIndex(null);
      return;
    }

    const ids = rows.map((row) => row.id);
    const moved = ids.splice(fromIndex, 1)[0];

    if (moved !== undefined) {
      const insertAt = fromIndex < dragOverIndex ? dragOverIndex - 1 : dragOverIndex;
      ids.splice(insertAt, 0, moved);
      onReorderFloors(ids);
    }

    draggedFloorId.current = null;
    setDragOverIndex(null);
  };

  const handleDragEnd = () => {
    draggedFloorId.current = null;
    setDragOverIndex(null);
  };

  /* Cột hành động có mặt đúng khi dòng có ô hành động — số cột tiêu đề = số ô của dòng. */
  // Một tầng: không có gì để đổi thứ tự hay tự tính cao độ.
  const canReorder = canEdit && rows.length > 1 && !separateUnits;
  const hasActions = canEdit || onOpenOverlay !== undefined || onOpenFloorScreen !== undefined;
  const headers = EDITABLE_HEADERS.filter(
    (header) =>
      (canReorder || header.key !== 'handle') &&
      (hasActions || header.key !== 'actions') &&
      (!separateUnits || header.key !== 'elevation'),
  );
  const columnCount = headers.length;

  const openRowMenu = (event: MouseEvent, row: FloorRowVm) => {
    /* Bản Z: hành động phụ (Đối chiếu lớp phủ) vào menu "…", hàng chỉ giữ một link chính. */
    const overlayGroup =
      onOpenOverlay !== undefined && row.hasDrawing
        ? [{ id: 'row-open', items: [{ id: 'overlay', label: OVERLAY_ACTION_LABEL, action: () => onOpenOverlay(row.id) }] }]
        : [];

    if (!canEdit) {
      menu.openMenu(event.clientX, event.clientY, overlayGroup);
      return;
    }

    menu.openMenu(event.clientX, event.clientY, [
      ...overlayGroup,
      {
        id: 'row-actions',
        items: [
          {
            id: 'rename',
            label: 'Đổi tên',
            action: () => setRenamingFloorId(row.id),
          },
          {
            id: 'duplicate',
            label: 'Nhân bản',
            action: () => {
              setCopyFurniture(false);
              setDuplicatingFloorId(row.id);
            },
          },
          {
            id: 'toggle-hidden',
            label: row.isHiddenIn3d ? 'Hiện trong mô hình 3D' : 'Ẩn khỏi mô hình 3D',
            action: () => onToggleHiddenIn3d(row.id),
          },
        ],
      },
      // Việc phá huỷ tách thành nhóm riêng, có vạch ngăn với "Ẩn khỏi mô hình 3D". Xoá có hoàn tác (Z), không hỏi lại.
      {
        id: 'row-danger',
        items: [
          {
            id: 'remove',
            label: 'Xoá tầng',
            isDestructive: true,
            action: () => onRemoveFloor(row.id),
          },
        ],
      },
    ]);
  };

  const openReviewMenu = (event: MouseEvent, row: FloorRowVm) => {
    if (onOpenFloorScreen === undefined) return;
    // Mở bằng phím thì clientX/Y = 0: neo menu vào chính nút.
    const anchor = event.currentTarget.getBoundingClientRect();
    menu.openMenu(anchor.left, anchor.bottom, [
      {
        id: 'review-screens',
        items: FLOOR_REVIEW_SCREENS.map((screen) => ({
          id: screen.id,
          label: screen.label,
          action: () => onOpenFloorScreen(row.id, screen.id),
        })),
      },
      {
        id: 'floor-tools',
        // Căn hộ riêng không chung trục: bỏ Trục (Codex P2, UX-R2 K14).
        items: FLOOR_TOOL_SCREENS.filter((screen) => !separateUnits || screen.id !== 'grids').map((screen) => ({
          id: screen.id,
          label: screen.label,
          action: () => onOpenFloorScreen(row.id, screen.id),
        })),
      },
    ]);
  };

  const selectedRow = rows.find((row) => row.isSelected) ?? null;

  if (state === 'empty') {
    return (
      <EmptyState
        {...(canEdit ? { action: { label: ADD_FLOOR_LABEL, onClick: onAddFloor } } : {})}
        className="h-full"
        description={emptyNotice ?? ''}
        icon={<div aria-hidden="true" className="h-8 w-8 rounded-full bg-bg-sunken" />}
        title={EMPTY_TITLE}
      />
    );
  }

  if (state === 'error' && isProjectMissing === true) {
    return (
      <InlineAlert
        {...(onBackToProjects !== undefined
          ? { action: { label: BACK_TO_PROJECTS_LABEL, onClick: onBackToProjects } }
          : {})}
        level="violation"
        message={errorMessage ?? ''}
        title={PROJECT_NOT_FOUND_TITLE}
      />
    );
  }

  if (state === 'error') {
    return (
      <InlineAlert
        action={{ label: RETRY_LABEL, onClick: onRetry }}
        level="violation"
        message={errorMessage ?? ''}
        title={ERROR_TITLE}
      />
    );
  }

  return (
    <Section
      actions={
        canEdit && state !== 'loading' ? (
          <>
            {rows.length > 1 && !separateUnits && (
              <Toggle checked={isAutoElevation} label={AUTO_ELEVATION_LABEL} onChange={onToggleAutoElevation} />
            )}
            {selectedRow !== null && (
              <Button
                onClick={() => {
                  setCopyFurniture(false);
                  setDuplicatingFloorId(selectedRow.id);
                }}
                size="sm"
                variant="ghost"
              >
                {DUPLICATE_SELECTED_LABEL}
              </Button>
            )}
            {!separateUnits && (
              <Button onClick={onAddFloor} size="sm" variant="secondary">
                {ADD_FLOOR_LABEL}
              </Button>
            )}
          </>
        ) : undefined
      }
      className="flex max-h-full min-h-0 flex-col"
      flush
      title={
        <>
          {SECTION_TITLE} <span className="ml-1 text-[13px] font-normal text-text-secondary">{rows.length}</span>
        </>
      }
    >
      {/* Không `flex-1`: khung cao theo số tầng, chỉ co lại và tự cuộn khi nhiều tầng (BUG-520). */}
      <div className="min-h-0 overflow-auto">
        {/* Bố cục cố định + độ rộng cột: không tràn ngang ở 1440/1024 khi lát cắt mở (bản Z). */}
        <Table.Root className="[&>table]:table-fixed">
          <colgroup>
            {headers.map((header) => (
              <col className={COLUMN_WIDTH[header.key]} key={header.key} />
            ))}
          </colgroup>
          <Table.Header>
            <tr>
              {headers.map((header) => (
                <Table.Head className={CELL} key={header.key}>
                  {header.key === 'handle' || header.key === 'actions' ? (
                    <span className="sr-only">{header.label}</span>
                  ) : (
                    header.label
                  )}
                </Table.Head>
              ))}
            </tr>
          </Table.Header>
          <Table.Body>
            {state === 'loading' ? (
              <Table.Skeleton columns={columnCount} rows={4} />
            ) : (
              rows.map((row, index) => (
                <FloorTableRow
                  canEdit={canEdit}
                  canReorder={canReorder}
                  showElevation={!separateUnits}
                  copyFurniture={copyFurniture}
                  duplicatingFloorId={duplicatingFloorId}
                  index={index}
                  isAutoElevation={isAutoElevation}
                  key={row.id}
                  isRenaming={renamingFloorId === row.id}
                  onRenameEnd={() => setRenamingFloorId(null)}
                  onRenameStart={setRenamingFloorId}
                  onCancelDuplicate={() => setDuplicatingFloorId(null)}
                  onConfirmDuplicate={(floorId) => {
                    onDuplicateFloor(floorId, { copyFurniture });
                    setDuplicatingFloorId(null);
                  }}
                  onDragEnd={handleDragEnd}
                  onDragHandleStart={(floorId) => {
                    draggedFloorId.current = floorId;
                  }}
                  onDragOverRow={setDragOverIndex}
                  onDropRow={handleDrop}
                  onFloorFieldCancel={onFloorFieldCancel}
                  onFloorFieldChange={onFloorFieldChange}
                  onFloorFieldCommit={onFloorFieldCommit}
                  onHoverFloor={onHoverFloor}
                  onOpenMenu={openRowMenu}
                  onReorderFloors={onReorderFloors}
                  onSelectFloor={onSelectFloor}
                  onSetCopyFurniture={setCopyFurniture}
                  onOpenOverlay={onOpenOverlay}
                  {...(onOpenFloorScreen !== undefined ? { onOpenReviewMenu: openReviewMenu } : {})}
                  onUploadDrawing={onUploadDrawing}
                  row={row}
                  rows={rows}
                  showInsertionLineAfter={dragOverIndex === rows.length && index === rows.length - 1}
                  showInsertionLineBefore={dragOverIndex === index}
                />
              ))
            )}
          </Table.Body>
        </Table.Root>
      </div>

      {state !== 'loading' && separateUnits && (
        <p className="border-t border-border-default px-5 py-3 text-[12px] text-text-secondary">
          {footer.floorCountText} · {footer.totalAreaText}
        </p>
      )}
      {state !== 'loading' && !separateUnits && (
        <p className="border-t border-border-default px-5 py-3 text-[12px] text-text-secondary">
          <span>
            {isAutoElevation ? CAPTION_AUTO : CAPTION_MANUAL}
            {!isAutoElevation && rows.some((row) => row.isElevationOverridden) && ` ${CAPTION_OVERRIDE}`}
          </span>{' '}
          {canReorder && `${CAPTION_REORDER} `}
          {footer.floorCountText} · tổng cao {footer.totalHeightText} · {footer.totalAreaText}
        </p>
      )}

      <ContextMenu groups={menu.groups} isVisible={menu.isVisible} onClose={menu.closeMenu} position={menu.position} />
    </Section>
  );
}
