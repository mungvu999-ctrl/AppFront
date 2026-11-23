/**
 * Các ô của một dòng `FloorTableRow` (S-19 bản Z), tách ra vì file dòng vượt trần 400 dòng
 * của R-22: ô tên (chữ lúc nghỉ, bấm/F2 mới sửa), ô số sửa tại chỗ, ô tiến độ, ô hành động.
 * VIEW THUẦN: mọi chuỗi đã suy sẵn ở `floorProgress.ts`.
 */

import { MoreVertical } from 'lucide-react';
import type { MouseEvent, ReactNode } from 'react';

import { Badge } from '@/components/ui/Badge';
import { IconButton } from '@/components/ui/IconButton';
import { Input } from '@/components/ui/Input';
import { Table } from '@/components/ui/Table';
import { cn } from '@/lib/utils';

import type { FloorStepVm } from './floorProgress';
import { FloorRowLinks } from './FloorRowLinks';
import type { FloorManagerViewProps, FloorRowVm } from './floorManagerTypes';

const UPLOAD_LINK_LABEL = 'Tải bản vẽ';
const SECTION_ROW_LABEL = 'Mặt cắt';
const NEXT_STEP_PREFIX = 'Việc tiếp:';

const EDIT_VALUE_CLASS =
  'inline-flex min-h-11 items-center rounded-md px-1.5 text-[13px] text-text-primary fine:min-h-6 hover:bg-bg-hover focus-visible:outline-solid focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent';

/** Số lúc nghỉ là chữ; bấm vào mới thành ô nhập (bản Z). Rời ô thì về lại chữ. */
export function InlineNumber({ label, text, isOpen, onOpen, onClose, children }: {
  readonly label: string;
  readonly text: string;
  readonly isOpen: boolean;
  readonly onOpen: () => void;
  readonly onClose: () => void;
  readonly children: ReactNode;
}) {
  return isOpen ? (
    <span onBlur={onClose}>{children}</span>
  ) : (
    <button
      aria-label={`Sửa ${label}: ${text}`}
      className={EDIT_VALUE_CLASS}
      onClick={(event) => {
        event.stopPropagation();
        onOpen();
      }}
      type="button"
    >
      {text}
    </button>
  );
}


export interface FloorNameCellProps
  extends Pick<FloorManagerViewProps, 'onFloorFieldChange' | 'onFloorFieldCommit' | 'onFloorFieldCancel'> {
  readonly row: FloorRowVm;
  readonly canEdit: boolean;
  readonly className: string;
  readonly summaryText: string;
  readonly isRenaming: boolean;
  readonly onRenameStart: (floorId: string) => void;
  readonly onRenameEnd: () => void;
}

export function FloorNameCell({
  row,
  canEdit,
  className,
  summaryText,
  isRenaming,
  onRenameStart,
  onRenameEnd,
  onFloorFieldChange,
  onFloorFieldCommit,
  onFloorFieldCancel,
}: FloorNameCellProps) {
  return (
    <Table.Cell className={className}>
      <div className="flex min-w-0 flex-col gap-0.5">
        {canEdit && isRenaming ? (
          <Input
            aria-label={`Tên tầng ${row.name}`}
            autoFocus
            className="w-full text-[13px]"
            onBlur={() => {
              onFloorFieldCommit(row.id, 'name');
              onRenameEnd();
            }}
            onChange={(event) => onFloorFieldChange(row.id, 'name', event.target.value)}
            onClick={(event) => event.stopPropagation()}
            onKeyDown={(event) => {
              if (event.key === 'Enter') {
                event.currentTarget.blur();
              }

              if (event.key === 'Escape') {
                onFloorFieldCancel(row.id, 'name');
                event.currentTarget.blur();
              }
            }}
            value={row.draft.name}
          />
        ) : canEdit ? (
          <button
            aria-label={`Đổi tên tầng ${row.name}`}
            className={cn(EDIT_VALUE_CLASS, 'max-w-full justify-start truncate font-medium')}
            onClick={(event) => {
              event.stopPropagation();
              onRenameStart(row.id);
            }}
            onKeyDown={(event) => {
              if (event.key === 'F2') {
                event.preventDefault();
                onRenameStart(row.id);
              }
            }}
            type="button"
          >
            {row.name}
          </button>
        ) : (
          <span className="text-[13px] font-medium text-text-primary">{row.name}</span>
        )}
        {row.isSection && (
          <Badge className="w-fit" variant="neutral">
            {SECTION_ROW_LABEL}
          </Badge>
        )}
        {/* Dòng phụ: số tường, phòng, diện tích. Điểm luật chỉ ở màn Quy chuẩn (UX-R1 K05). */}
        {row.hasDrawing && <span className="text-[12px] text-text-secondary">{summaryText}</span>}
      </div>
    </Table.Cell>
  );
}

export function FloorProgressCell({ className, step }: { readonly className: string; readonly step: FloorStepVm }) {
  const cell = className;

  return (
        <Table.Cell className={cn(cell, 'overflow-hidden')}>
          {/* Tiến độ = chip bước + một dòng việc tiếp. App chỉ biết có/chưa có bản vẽ;
              các bước AI đọc / đang duyệt / duyệt xong / lỗi CẦN BE (GHI-CHU S-19). */}
          <div className="flex min-w-0 flex-col items-start gap-1">
            {/* UX-33: chip xuống dòng trong ô hẹp (768/1024), không cắt thành "Tỷ lệ cần kiể". */}
            <Badge className="h-auto min-h-[22px] max-w-full whitespace-normal py-0.5 text-left leading-tight" title={step.label} variant={step.tone}>
              {step.label}
            </Badge>
            {/* Xuống dòng, không cắt chữ: ô bảng mặc định `whitespace-nowrap` (UX-R2). */}
            <span className="block w-full whitespace-normal break-words text-[12px] text-text-secondary">
              {NEXT_STEP_PREFIX} {step.nextText}
            </span>
          </div>
        </Table.Cell>
  );
}

export interface FloorActionsCellProps {
  readonly row: FloorRowVm;
  readonly canEdit: boolean;
  readonly className: string;
  readonly onUploadDrawing: (floorId: string) => void;
  readonly onOpenOverlay?: ((floorId: string) => void) | undefined;
  readonly onOpenReviewMenu?: ((event: MouseEvent, row: FloorRowVm) => void) | undefined;
  readonly onOpenMenu: (event: MouseEvent, row: FloorRowVm) => void;
}

export function FloorActionsCell({
  row,
  canEdit,
  className,
  onUploadDrawing,
  onOpenOverlay,
  onOpenReviewMenu,
  onOpenMenu,
}: FloorActionsCellProps) {
  const cell = className;

  return (
    <>
        {(canEdit || onOpenOverlay !== undefined || onOpenReviewMenu !== undefined) && (
          <Table.Cell className={cn(cell, 'overflow-hidden')}>
            {/* Nút ⋮ cùng dòng với "Duyệt lớp", không rơi xuống dòng riêng (G3-21). */}
            <div className="flex items-center justify-end gap-1">
              {row.needsDrawing && canEdit ? (
                <button
                  className="inline-flex min-h-11 items-center rounded-md px-1.5 text-[13px] text-accent underline-offset-2 fine:min-h-6 hover:underline focus-visible:outline-solid focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
                  onClick={(event) => {
                    event.stopPropagation();
                    onUploadDrawing(row.id);
                  }}
                  type="button"
                >
                  {UPLOAD_LINK_LABEL}
                </button>
              ) : (
                <FloorRowLinks onOpenReviewMenu={onOpenReviewMenu} row={row} />
              )}
              {(canEdit || (onOpenOverlay !== undefined && row.hasDrawing)) && (
                <IconButton
                  aria-label={`Thao tác khác cho tầng ${row.name}`}
                  icon={<MoreVertical className="h-4 w-4" />}
                  onClick={(event) => {
                    event.stopPropagation();
                    onOpenMenu(event, row);
                  }}
                  size="sm"
                  tooltip={false}
                />
              )}
            </div>
          </Table.Cell>
        )}
    </>
  );
}
