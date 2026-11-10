/**
 * Bảng phiên bản của họ đang chọn — dòng 40; dưới 1024 thành một cột thẻ.
 *
 * Hàng mở chi tiết bằng nút trên nhãn (Enter/Space là của chính nút). Bản đang dùng không
 * có nút "Kích hoạt"; bản chưa đánh giá hay sai định dạng có nút tắt kèm lý do hiện ra.
 */

import { useId } from 'react';

import { Badge } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { Table } from '@/components/ui/Table';
import { cn } from '@/lib/utils';

import { MODEL_REGISTRY_TEXT } from './useModelRegistry';
import type { ModelRegistryActions, VersionRowModel } from './types';

const ACTIVATE_LABEL = 'Kích hoạt';
const ACTIVE_BADGE = 'Đang dùng';
const NOT_EVALUATED_REASON = MODEL_REGISTRY_TEXT.blockedNotEvaluated;
const HEADERS = ['Nhãn', 'Định dạng', 'Đánh giá', 'Số đo', 'Nguồn', 'Ngày tạo'] as const;
/** Dưới 1600px hai cột này nằm trong thẻ chi tiết, để nút Kích hoạt luôn thấy. */
const WIDE_ONLY: ReadonlySet<string> = new Set([HEADERS[1], HEADERS[4]]);
const WIDE_CLASS = 'hidden min-[1600px]:table-cell';
const ACTIONS_HEADER = 'Thao tác';
const FOCUS_RING =
  'rounded-sm outline-hidden focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:ring-offset-bg-surface';

interface RowPartProps {
  readonly row: VersionRowModel;
  readonly actions: ModelRegistryActions;
}

function LabelButton({ actions, row }: RowPartProps) {
  return (
    <button
      aria-pressed={row.isSelected}
      className={cn('block min-h-6 max-w-[22ch] truncate text-left font-medium text-text-primary', FOCUS_RING)}
      title={row.label}
      onClick={() => actions.onSelectVersion(row.isSelected ? null : row.id)}
      type="button"
    >
      {row.label}
    </button>
  );
}

function ActivateControl({ actions, row }: RowPartProps) {
  const reasonId = useId();

  if (row.isActive) {
    return <Badge variant="neutral">{ACTIVE_BADGE}</Badge>;
  }

  if (row.activateBlockedReason !== null) {
    return (
      <div className="flex items-center gap-2">
        <Button aria-describedby={reasonId} disabled size="sm" variant="secondary">
          {ACTIVATE_LABEL}
        </Button>
        {/* "Chưa đánh giá" đã có một chú thích chung trên đầu trang; chỉ lý do khác mới ghi ở dòng. */}
        <span className={row.activateBlockedReason === NOT_EVALUATED_REASON ? 'sr-only' : 'text-[12px] text-text-secondary'} id={reasonId}>
          {row.activateBlockedReason}
        </span>
      </div>
    );
  }

  return (
    <Button onClick={() => actions.onRequestActivate(row.id)} size="sm" variant="secondary">
      {ACTIVATE_LABEL}
    </Button>
  );
}

function EvaluationBadge({ row }: { readonly row: VersionRowModel }) {
  return <Badge variant={row.evaluationVariant}>{row.evaluationLabel}</Badge>;
}

export interface ModelRegistryVersionTableProps {
  readonly rows: readonly VersionRowModel[];
  readonly isCollapsed: boolean;
  readonly actions: ModelRegistryActions;
}

export function ModelRegistryVersionTable({ actions, isCollapsed, rows }: ModelRegistryVersionTableProps) {
  if (isCollapsed) {
    return (
      <ul className="flex flex-col gap-2">
        {rows.map((row) => (
          <li
            className={cn('flex flex-col gap-3 rounded-lg border border-border-default p-3', row.isSelected && 'bg-bg-selected')}
            key={row.id}
          >
            <div className="flex items-center justify-between gap-3">
              <LabelButton actions={actions} row={row} />
              <EvaluationBadge row={row} />
            </div>
            <dl className="grid grid-cols-2 gap-x-4 gap-y-2 text-[13px]">
              {[
                [HEADERS[1], row.formatLabel],
                [HEADERS[3], row.metricLabel],
                [HEADERS[4], row.sourceLabel],
                [HEADERS[5], row.createdLabel],
              ].map(([term, value]) => (
                <div className="flex justify-between gap-2" key={term}>
                  <dt className="text-text-secondary">{term}</dt>
                  <dd className="tabular-nums">{value}</dd>
                </div>
              ))}
            </dl>
            <ActivateControl actions={actions} row={row} />
          </li>
        ))}
      </ul>
    );
  }

  return (
    <Table.Root>
      <Table.Header>
        <Table.Row>
          {HEADERS.map((header) => (
            <Table.Head className={WIDE_ONLY.has(header) ? WIDE_CLASS : ''} key={header}>
              {header}
            </Table.Head>
          ))}
          <Table.Head>
            <span>{ACTIONS_HEADER}</span>
          </Table.Head>
        </Table.Row>
      </Table.Header>
      <Table.Body>
        {rows.map((row) => (
          <Table.Row key={row.id} selected={row.isSelected}>
            <Table.Cell>
              <LabelButton actions={actions} row={row} />
            </Table.Cell>
            <Table.Cell className={cn(WIDE_CLASS, 'font-mono')}>{row.formatLabel}</Table.Cell>
            <Table.Cell>
              <EvaluationBadge row={row} />
            </Table.Cell>
            <Table.Cell className="tabular-nums">{row.metricLabel}</Table.Cell>
            <Table.Cell className={cn(WIDE_CLASS, 'text-text-secondary')}>{row.sourceLabel}</Table.Cell>
            <Table.Cell className="text-text-secondary">{row.createdLabel}</Table.Cell>
            <Table.Cell>
              <ActivateControl actions={actions} row={row} />
            </Table.Cell>
          </Table.Row>
        ))}
      </Table.Body>
    </Table.Root>
  );
}
