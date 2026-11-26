/**
 * Khối "Ngôi nhà" của bước duyệt bộ hồ sơ (NHA-08a) — VIEW THUẦN, chỉ đọc.
 *
 * Hiện đề xuất của máy cho cả bộ: bảng tầng, thẻ mái, mâu thuẫn giữa các nguồn, và các luật kiểm. Mỗi giá trị
 * đi kèm một chip nói nguồn bằng chữ (không chỉ màu). Lát này chưa có ô sửa, chưa có "Đã xem", và khối không
 * chặn nút xác nhận (NHA-08b) — câu đầu khối nói thẳng điều đó.
 */

import { useId } from 'react';

import { InlineAlert } from '@/components/feedback/InlineAlert';
import { Skeleton } from '@/components/feedback/Skeleton';
import { Badge } from '@/components/ui/Badge';
import { Table } from '@/components/ui/Table';
import { MISSING_VALUE } from '@/lib/format/number';
import type {
  HouseBlockVm,
  HouseCell,
  HouseConflict,
  HouseRoofCard,
  HouseViolationGroup,
} from '@/lib/viewmodel/setBuilding';

const TEXT = {
  title: 'Ngôi nhà',
  loading: 'Đang đọc đề xuất ngôi nhà…',
  error: 'Chưa đọc được đề xuất ngôi nhà.',
  retry: 'Thử lại',
  note: 'Máy đề xuất, chỉ để xem. Phần này chưa ảnh hưởng tới việc xác nhận.',
  unitSystem: 'Hệ đơn vị',
  levels: 'Các tầng',
  levelsCaption: 'Các tầng máy đề xuất',
  levelName: 'Tầng',
  elevation: 'Cốt',
  height: 'Chiều cao',
  noLevels: 'Máy chưa đề xuất tầng nào.',
  roofs: 'Mái',
  noRoofs: 'Máy chưa đề xuất mái nào.',
  conflicts: 'Mâu thuẫn giữa các nguồn',
  chosen: 'Đã chọn',
  rules: 'Luật kiểm',
} as const;

const HEADING = 'text-[14px] font-semibold text-text-primary';
const BODY = 'text-[14px] text-text-secondary';

export interface HouseBlockViewProps {
  readonly status: 'loading' | 'hidden' | 'error' | 'ready';
  /** Có khi `status` là `ready`. */
  readonly vm: HouseBlockVm | null;
  /** Đang đọc lại sau một lần lưu: nội dung cũ vẫn hiện. */
  readonly isRefreshing: boolean;
  readonly onRetry: () => void;
}

function Value({ cell }: { cell: HouseCell | null }) {
  if (cell === null) return <span className="text-text-secondary">{MISSING_VALUE}</span>;

  return (
    <span className="inline-flex flex-wrap items-center gap-2">
      <span className="text-text-primary">{cell.text}</span>
      <Badge variant={cell.status}>{cell.chip}</Badge>
    </span>
  );
}

function RoofCard({ card }: { card: HouseRoofCard }) {
  const titleId = useId();

  return (
    <div
      aria-labelledby={titleId}
      className="flex flex-col gap-2 rounded-lg border border-border-default p-3"
      role="group"
    >
      <h4 className={HEADING} id={titleId}>
        {card.title}
      </h4>
      <dl className="flex flex-col gap-1 text-[14px]">
        {card.rows.map((row) => (
          <div className="flex flex-wrap items-center gap-2" key={row.label}>
            <dt className="text-text-secondary">{row.label}:</dt>
            <dd className="min-w-0">
              <Value cell={row.cell} />
            </dd>
          </div>
        ))}
      </dl>
    </div>
  );
}

function ConflictList({ conflict }: { conflict: HouseConflict }) {
  const titleId = useId();

  return (
    <div className="flex flex-col gap-1">
      <p className="text-[14px] text-text-primary" id={titleId}>
        {conflict.title}
      </p>
      <ul aria-labelledby={titleId} className={`list-disc pl-5 ${BODY}`}>
        {conflict.candidates.map((candidate) => (
          <li key={candidate.source}>
            {candidate.text} · {candidate.source}
            {candidate.isChosen ? ` · ${TEXT.chosen}` : ''}
          </li>
        ))}
      </ul>
    </div>
  );
}

function ViolationGroup({ group }: { group: HouseViolationGroup }) {
  const titleId = useId();

  return (
    <div className="flex flex-col gap-1">
      <div>
        <Badge id={titleId} variant={group.status}>
          {group.title}
        </Badge>
      </div>
      <ul aria-labelledby={titleId} className={`list-disc pl-5 ${BODY}`}>
        {group.items.map((item) => (
          <li key={item.key}>{item.text}</li>
        ))}
      </ul>
    </div>
  );
}

function Proposal({ vm }: { vm: HouseBlockVm }) {
  return (
    <>
      <p className={BODY}>{TEXT.note}</p>
      <p className="flex flex-wrap items-center gap-2 text-[14px] text-text-secondary">
        {TEXT.unitSystem}: <Value cell={vm.unitSystem} />
      </p>

      <h3 className={HEADING}>{TEXT.levels}</h3>
      {vm.levels.length === 0 ? (
        <p className={BODY}>{TEXT.noLevels}</p>
      ) : (
        <Table.Root className="h-auto">
          <caption className="sr-only">{TEXT.levelsCaption}</caption>
          <Table.Header>
            <Table.Row>
              <Table.Head>{TEXT.levelName}</Table.Head>
              <Table.Head>{TEXT.elevation}</Table.Head>
              <Table.Head>{TEXT.height}</Table.Head>
            </Table.Row>
          </Table.Header>
          <Table.Body>
            {vm.levels.map((level) => (
              <Table.Row key={level.key}>
                <Table.Cell>{level.name}</Table.Cell>
                <Table.Cell>
                  <Value cell={level.elevation} />
                </Table.Cell>
                <Table.Cell>
                  <Value cell={level.height} />
                </Table.Cell>
              </Table.Row>
            ))}
          </Table.Body>
        </Table.Root>
      )}

      <h3 className={HEADING}>{TEXT.roofs}</h3>
      {vm.roofs.length === 0 ? (
        <p className={BODY}>{TEXT.noRoofs}</p>
      ) : (
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          {vm.roofs.map((card) => (
            <RoofCard card={card} key={card.key} />
          ))}
        </div>
      )}

      {vm.conflicts.length === 0 ? null : (
        <>
          <h3 className={HEADING}>{TEXT.conflicts}</h3>
          {vm.conflicts.map((conflict) => (
            <ConflictList conflict={conflict} key={conflict.key} />
          ))}
        </>
      )}

      {vm.violations.length === 0 ? null : (
        <>
          <h3 className={HEADING}>{TEXT.rules}</h3>
          {vm.violations.map((group) => (
            <ViolationGroup group={group} key={group.level} />
          ))}
        </>
      )}
    </>
  );
}

export function HouseBlockView({ isRefreshing, onRetry, status, vm }: HouseBlockViewProps) {
  if (status === 'hidden') return null;

  return (
    <section
      aria-busy={isRefreshing || status === 'loading'}
      aria-label={TEXT.title}
      className="flex flex-col gap-3 rounded-lg border border-border-default bg-bg-surface p-3"
    >
      <h2 className={HEADING}>{TEXT.title}</h2>
      {status === 'loading' ? (
        <>
          <p className={BODY} role="status">
            {TEXT.loading}
          </p>
          <Skeleton className="h-16 w-full" preset="block" />
        </>
      ) : null}
      {status === 'error' ? (
        <InlineAlert
          action={{ label: TEXT.retry, onClick: onRetry }}
          level="violation"
          message={TEXT.error}
          role="status"
        />
      ) : null}
      {status === 'ready' && vm !== null ? <Proposal vm={vm} /> : null}
    </section>
  );
}
