/**
 * Ba cách vẽ danh sách model, tuỳ theo `model.isNarrow` và `model.viewMode`:
 *  - dưới 1024 (`isNarrow`) → luôn là thẻ xếp chồng, bất kể `viewMode` đang chọn gì;
 *  - `viewMode === 'grid'` → lưới thẻ lớn;
 *  - còn lại → bảng sáu cột.
 *
 * Sáu cột đúng bằng số cột CÓ NGUỒN THẬT trong `ModelLibraryRowModel` (xem docblock
 * `types.ts`): ảnh xem trước · tên · danh mục · kích thước bao · số tam giác · dung
 * lượng. Bốn cột đặc tả gốc còn đòi (số dự án đang dùng, người tải lên, ngày, trạng
 * thái) không có trường nào để đọc — không thêm cột rỗng.
 *
 * `Table.Row`/`Table.Cell` hard-code `h-10` (40px) trong className của chính chúng,
 * không có prop chiều cao; 48px của đặc tả chỉ đạt được bằng cách truyền `className="h-12"`
 * cho CẢ HAI (twMerge ghi đè `h-10`) — xem `contract-ui.md` mục 0.
 */
import { Box, RotateCw, SearchX } from 'lucide-react';
import { useState } from 'react';

import { EmptyState } from '@/components/feedback/EmptyState';
import { Badge } from '@/components/ui/Badge';
import { IconButton } from '@/components/ui/IconButton';
import { Table } from '@/components/ui/Table';
import { cn } from '@/lib/utils';

import type { ModelLibraryActions, ModelLibraryModel, ModelLibraryRowModel, ModelLibrarySortKey } from './types';

const HEADER_PREVIEW = 'Ảnh xem trước';
const HEADER_NAME = 'Tên';
const HEADER_GROUP = 'Danh mục';
const HEADER_BOUNDS = 'Kích thước bao';
const HEADER_TRIANGLES = 'Độ chi tiết (tam giác)';
const HEADER_FILE_SIZE = 'Dung lượng';
const EMPTY_MESSAGE = 'Không có mẫu 3D nào khớp với từ khoá hoặc danh mục đang chọn.';
const EMPTY_TITLE = 'Không tìm thấy mẫu 3D';
const CLEAR_SEARCH_LABEL = 'Xoá tìm kiếm và bộ lọc';
const HEAVY_BADGE_LABEL = 'Nặng';
const GRID_LIST_LABEL = 'lưới mẫu 3D';
const COLUMN_COUNT = 6;
const ROW_HEIGHT = 'h-12';

const FOCUS_RING =
  'outline-hidden focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:ring-offset-bg-surface';

const retryPreviewLabel = (name: string): string => `Thử tải lại ảnh xem trước của ${name}`;

/** Ảnh xem trước, hoặc biểu tượng thay thế trung tính + nút thử lại khi `isPreviewBroken`. */
function ModelPreviewThumb({
  onRetry,
  row,
  sizeClassName,
}: {
  readonly onRetry: (modelId: string) => void;
  readonly row: ModelLibraryRowModel;
  readonly sizeClassName: string;
}) {
  const boxClassName = cn(
    'flex shrink-0 items-center justify-center overflow-hidden rounded-md border border-border-default bg-bg-sunken text-text-tertiary',
    sizeClassName,
  );

  // Ảnh tải hỏng ở trình duyệt (404, sai định dạng) cũng về biểu tượng trung tính, không vẽ ảnh vỡ.
  const [failedUrl, setFailedUrl] = useState<string | null>(null);

  if (row.previewUrl !== null && !row.isPreviewBroken && failedUrl !== row.previewUrl) {
    const { previewUrl } = row;
    return (
      <img
        alt=""
        className={cn(boxClassName, 'object-cover')}
        decoding="async"
        height={96}
        loading="lazy"
        onError={() => setFailedUrl(previewUrl)}
        src={previewUrl}
        width={96}
      />
    );
  }

  return (
    <div className="flex items-center gap-1.5">
      <div aria-hidden="true" className={boxClassName}>
        <Box size={16} />
      </div>
      {row.isPreviewBroken && (
        <IconButton
          aria-label={retryPreviewLabel(row.name)}
          icon={<RotateCw size={14} />}
          onClick={(event) => {
            event.stopPropagation();
            onRetry(row.id);
          }}
          size="sm"
        />
      )}
    </div>
  );
}

/** Chấm "cần chú ý" cạnh số tam giác. Chỉ một mức — xem docblock `types.ts` vì sao. */
function TriangleCountValue({ row }: { readonly row: ModelLibraryRowModel }) {
  return (
    <span className="inline-flex items-center gap-1.5 tabular-nums">
      {row.isHeavy && <span aria-hidden="true" className="h-1.5 w-1.5 shrink-0 rounded-full bg-state-attention" />}
      {row.triangleCountLabel}
    </span>
  );
}

interface RowLayoutProps {
  readonly actions: ModelLibraryActions;
  readonly rows: readonly ModelLibraryRowModel[];
}

/** Dưới 1024: bảng thành một cột thẻ xếp chồng. */
function ModelLibraryCardList({ actions, rows }: RowLayoutProps) {
  if (rows.length === 0) {
    return <p className="p-4 text-[13px] text-text-secondary">{EMPTY_MESSAGE}</p>;
  }

  return (
    <ul className="flex flex-col gap-2">
      {rows.map((row) => (
        <li className="flex flex-col gap-2 rounded-lg border border-border-default p-3" key={row.id}>
          <div className="flex items-center gap-3">
            <ModelPreviewThumb onRetry={actions.retryPreviewImage} row={row} sizeClassName="h-10 w-10" />
            <button
              className={cn('min-h-6 text-left font-medium text-text-primary', FOCUS_RING)}
              onClick={() => actions.openDetail(row.id)}
              type="button"
            >
              {row.name}
            </button>
            {row.isHeavy && <Badge className="ml-auto" variant="attention">{HEAVY_BADGE_LABEL}</Badge>}
          </div>
          <dl className="grid grid-cols-2 gap-x-4 gap-y-1 text-[13px]">
            <div className="flex justify-between gap-2">
              <dt className="text-text-secondary">Danh mục</dt>
              <dd>{row.groupLabel}</dd>
            </div>
            <div className="flex justify-between gap-2">
              <dt className="text-text-secondary">Kích thước bao</dt>
              <dd className="tabular-nums">{row.boundsLabel}</dd>
            </div>
            <div className="flex justify-between gap-2">
              <dt className="text-text-secondary">Độ chi tiết (tam giác)</dt>
              <dd>
                <TriangleCountValue row={row} />
              </dd>
            </div>
            <div className="flex justify-between gap-2">
              <dt className="text-text-secondary">Dung lượng</dt>
              <dd className="tabular-nums">{row.fileSizeLabel}</dd>
            </div>
          </dl>
        </li>
      ))}
    </ul>
  );
}

/** `viewMode === 'grid'`: lưới thẻ lớn, cho màn rộng muốn duyệt bằng mắt. */
function ModelLibraryGrid({ actions, rows }: RowLayoutProps) {
  if (rows.length === 0) {
    return <p className="p-4 text-[13px] text-text-secondary">{EMPTY_MESSAGE}</p>;
  }

  return (
    <div aria-label={GRID_LIST_LABEL} className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-4" role="list">
      {rows.map((row) => (
        <div
          aria-label={row.name}
          className={cn(
            'flex cursor-pointer flex-col gap-2 rounded-lg border border-border-default bg-bg-surface p-3',
            'transition-colors duration-120 hover:bg-bg-hover',
            FOCUS_RING,
          )}
          key={row.id}
          onClick={() => actions.openDetail(row.id)}
          onKeyDown={(event) => {
            if (event.key === 'Enter') actions.openDetail(row.id);
          }}
          role="listitem"
          tabIndex={0}
        >
          <ModelPreviewThumb onRetry={actions.retryPreviewImage} row={row} sizeClassName="h-24 w-24 self-center" />
          <p className="truncate text-[14px] font-medium text-text-primary">{row.name}</p>
          <p className="truncate text-[13px] text-text-secondary">{row.groupLabel}</p>
          <div className="flex items-center justify-between gap-2 text-[13px]">
            <span className="tabular-nums text-text-secondary">{row.boundsLabel}</span>
            <TriangleCountValue row={row} />
          </div>
          <div className="flex items-center justify-between gap-2">
            <span className="tabular-nums text-[13px] text-text-secondary">{row.fileSizeLabel}</span>
            {row.isHeavy && <Badge variant="attention">{HEAVY_BADGE_LABEL}</Badge>}
          </div>
        </div>
      ))}
    </div>
  );
}

export interface ModelLibraryTableProps {
  readonly actions: ModelLibraryActions;
  readonly model: ModelLibraryModel;
}

export function ModelLibraryTable({ actions, model }: ModelLibraryTableProps) {
  if (model.isNarrow) {
    return <ModelLibraryCardList actions={actions} rows={model.rows} />;
  }

  if (model.viewMode === 'grid') {
    return <ModelLibraryGrid actions={actions} rows={model.rows} />;
  }

  return (
    <Table.Root
      onSort={(key) => actions.sortBy(key as ModelLibrarySortKey)}
      sortDir={model.sortDirection}
      sortKey={model.sortKey}
    >
      <Table.Header>
        <Table.Row>
          <Table.Head>
            <span className="sr-only">{HEADER_PREVIEW}</span>
          </Table.Head>
          <Table.Head sortKey="name">{HEADER_NAME}</Table.Head>
          <Table.Head sortKey="group">{HEADER_GROUP}</Table.Head>
          <Table.Head sortKey="bounds">{HEADER_BOUNDS}</Table.Head>
          <Table.Head sortKey="triangles">{HEADER_TRIANGLES}</Table.Head>
          <Table.Head sortKey="fileSize">{HEADER_FILE_SIZE}</Table.Head>
        </Table.Row>
      </Table.Header>
      <Table.Body>
        {model.rows.length === 0 ? (
          <tr>
            <td className="py-12" colSpan={COLUMN_COUNT}>
              <EmptyState
                action={{
                  label: CLEAR_SEARCH_LABEL,
                  onClick: () => {
                    actions.setSearchText('');
                    actions.setFilter('all');
                  },
                  variant: 'secondary',
                }}
                description={EMPTY_MESSAGE}
                icon={<SearchX aria-hidden="true" />}
                title={EMPTY_TITLE}
              />
            </td>
          </tr>
        ) : (
          model.rows.map((row) => (
            <Table.Row className={ROW_HEIGHT} key={row.id}>
              <Table.Cell className={ROW_HEIGHT}>
                <ModelPreviewThumb onRetry={actions.retryPreviewImage} row={row} sizeClassName="h-8 w-8" />
              </Table.Cell>
              <Table.Cell className={ROW_HEIGHT}>
                <button
                  className={cn('min-h-6 text-left font-medium text-text-primary', FOCUS_RING)}
                  onClick={() => actions.openDetail(row.id)}
                  type="button"
                >
                  {row.name}
                </button>
              </Table.Cell>
              <Table.Cell className={ROW_HEIGHT}>{row.groupLabel}</Table.Cell>
              <Table.Cell className={cn(ROW_HEIGHT, 'tabular-nums')}>{row.boundsLabel}</Table.Cell>
              {/*
                Chữ đều nằm trên chính ô, không chỉ trên `<span>` bên trong — cùng khuôn hai
                cột số anh em ở trên và dưới. Badge "Nặng" là chữ thường nên nó tự kéo mình
                về bộ chữ giao diện, thay vì mọi thứ trong ô cùng thành chữ đều.
              */}
              <Table.Cell className={cn(ROW_HEIGHT, 'tabular-nums')}>
                <div className="flex items-center gap-2">
                  <TriangleCountValue row={row} />
                  {row.isHeavy && (
                    <Badge className="font-sans" variant="attention">
                      {HEAVY_BADGE_LABEL}
                    </Badge>
                  )}
                </div>
              </Table.Cell>
              <Table.Cell className={cn(ROW_HEIGHT, 'tabular-nums')}>{row.fileSizeLabel}</Table.Cell>
            </Table.Row>
          ))
        )}
      </Table.Body>
    </Table.Root>
  );
}
