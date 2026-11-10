/**
 * The two bands that sit above the list: five numbers, then the filters.
 *
 * Both are here rather than in `RuleReport.tsx` because the frame crossed
 * invariant R-22's 400-line ceiling, and these two pieces are the ones nothing
 * else reaches into. Neither holds state; both are functions of the same props
 * the screen was handed.
 *
 * ## Why the four numbers carry no colour
 *
 * A summary strip is the most tempting place on this screen to put a red tile,
 * and the spec forbids exactly that: no coloured cards, no border, no fill, no
 * warning glyph. The reason is that a count is not a verdict — "7" is only
 * alarming next to a rule, and the rule is in the row. Colour on this band would
 * shout before the reader has read anything, and it would shout on every load,
 * including the loads where the number is 0. So the band is four numbers in
 * mono, four lower-case words under them, and nothing else.
 *
 * The numbers run up rather than appearing, through `useCountUp` — the React
 * face of the shared engine, which formats every frame through `formatNumber`.
 * Rendering `text` and never `value` is what guarantees no frame shows a
 * malformed number, and it is why invariant A15 has nothing to catch here.
 *
 * ## Why the level filter's options are derived and the group filter's are not
 *
 * The five rule groups are a closed union in the domain, so the group filter
 * lists all five always — a fixed control that does not change shape as results
 * arrive. Levels are not closed: a project has whatever floors it has, and the
 * only place the view is told their names is `row.levelLabel`. So that list is
 * read off the rows. It is a `useMemo` over props, not a computation about the
 * building — the view still knows nothing it was not handed.
 */

import { SlidersHorizontal } from 'lucide-react';
import { useMemo, useRef, useState } from 'react';

import { Button } from '@/components/ui/Button';
import { Select } from '@/components/ui/Select';
import { useCountUp } from '@/hooks/useCountUp';
import { cn } from '@/lib/utils';

import { ANY_OPTION, FOCUS_RING, GROUP_LABELS, GROUP_ORDER } from './RuleReportLabels';
import type {
  RuleReportFilters,
  RuleReportGroup,
  RuleReportLevelFilter,
  RuleReportRow,
  RuleReportSummary as RuleReportSummaryModel,
} from './types';

/** One figure: the number over the word that says what it counts. */
interface SummaryStatProps {
  readonly value: number;
  readonly label: string;
  /** V-10: colour of the number when it is above zero — red for violations, amber for warnings. */
  readonly toneClassName?: string;
  /** Có thì số là một nút lọc theo mức của ô (aria-pressed khi đang lọc đúng mức ấy). */
  readonly filter?: { readonly isActive: boolean; readonly onClick: () => void } | undefined;
}

function SummaryStat({ value, label, toneClassName, filter }: SummaryStatProps) {
  const { text } = useCountUp(value, { format: { fractionDigits: 0 } });
  const tone = value > 0 && toneClassName ? toneClassName : 'text-text-primary';

  // KPI chỉ khi bấm được để lọc (NGUYEN-TAC-BO-CUC §2): số là một nút bật lọc mức tương ứng.
  // Màu nằm ở `dd` (không ở nút) để mọi chỗ mang màu vi phạm vẫn chỉ là chữ số, chip hoặc chấm.
  return (
    <div className="flex flex-col-reverse gap-1">
      <dt className="text-sm text-text-secondary">{label}</dt>
      <dd className={cn('text-3xl tabular-nums', tone)}>
        {filter === undefined ? (
          text
        ) : (
          <button
            type="button"
            aria-pressed={filter.isActive}
            aria-label={`${label}: ${text}`}
            onClick={filter.onClick}
            className={cn(
              '-mx-2 min-h-6 min-w-6 rounded-md px-2 transition-colors duration-fast hover:bg-bg-hover coarse:min-h-11 coarse:min-w-11',
              filter.isActive && 'bg-bg-selected ring-1 ring-accent',
              FOCUS_RING,
            )}
          >
            {text}
          </button>
        )}
      </dd>
    </div>
  );
}

export interface RuleReportSummaryStripProps {
  readonly summary: RuleReportSummaryModel;
  /** Mức đang lọc; cùng `onFilterLevel` thì mỗi ô số thành một nút lọc. Vắng thì ô chỉ là số. */
  readonly activeLevel?: RuleReportLevelFilter;
  readonly onFilterLevel?: (level: RuleReportLevelFilter) => void;
}

/**
 * The five figures.
 *
 * All count RULES, so total = passed + violations + warnings + suggestions
 * (BUG-460), each rule filed under its worst finding. A suggestion is never
 * counted as a warning or a violation, so the alarming number is the one that
 * has actually earned it (V-10: it alone is tinted red when above zero).
 */
export function RuleReportSummaryStrip({ summary, activeLevel, onFilterLevel }: RuleReportSummaryStripProps) {
  const filterOf = (level: RuleReportLevelFilter): SummaryStatProps['filter'] =>
    onFilterLevel === undefined
      ? undefined
      : { isActive: activeLevel === level, onClick: () => onFilterLevel(level) };

  return (
    <dl className="grid grid-cols-2 gap-6 sm:grid-cols-5">
      <SummaryStat value={summary.evaluated} label="Luật đã kiểm" filter={filterOf('all')} />
      <SummaryStat value={summary.passed} label="Luật đạt" filter={filterOf('passed')} />
      <SummaryStat value={summary.suggestions} label="Luật có gợi ý" filter={filterOf('suggestion')} />
      <SummaryStat
        value={summary.warnings}
        label="Luật cảnh báo"
        toneClassName="text-state-attention-text"
        filter={filterOf('warning')}
      />
      <SummaryStat
        value={summary.violations}
        label="Luật nghiêm trọng"
        toneClassName="text-state-violation-text"
        filter={filterOf('violation')}
      />
    </dl>
  );
}

/** A floor the results actually mention, as the level filter offers it. */
interface LevelOption {
  readonly value: string;
  readonly label: string;
}

/**
 * The floors named by the rows on screen, each once, in the order first seen.
 *
 * Rows filed under a building-wide rule carry `levelId: null` and are left out —
 * there is no floor to offer for them.
 */
function levelOptionsOf(
  groups: readonly RuleReportGroup[],
  resolvedRows: readonly RuleReportRow[],
  seen: Map<string, string>,
): readonly LevelOption[] {

  const remember = (row: RuleReportRow): void => {
    if (row.levelId !== null && row.levelLabel !== null && !seen.has(row.levelId)) {
      seen.set(row.levelId, row.levelLabel);
    }
  };

  for (const group of groups) {
    for (const row of group.rows) {
      remember(row);
    }
  }

  for (const row of resolvedRows) {
    remember(row);
  }

  return [...seen].map(([value, label]) => ({ value, label }));
}

export interface RuleReportFilterBarProps {
  readonly filters: RuleReportFilters;
  readonly groups: readonly RuleReportGroup[];
  readonly resolvedRows: readonly RuleReportRow[];
  readonly onFilterChange: (next: RuleReportFilters) => void;
}

/**
 * The segmented control and the two selects.
 *
 * Every `Select` on this screen passes `label`. That is not a style preference:
 * `Select.Trigger` carries `role="combobox"`, which is not a role that takes its
 * name from the text inside it, so a select without `label` has no accessible
 * name at all and `expectAccessible` refuses it. The label is visible rather
 * than `sr-only` because a filter bar with two unlabelled dropdowns is a puzzle
 * for everybody, not only for a screen reader.
 */
export function RuleReportFilterBar({
  filters,
  groups,
  resolvedRows,
  onFilterChange,
}: RuleReportFilterBarProps) {
  // 28-C-012: các tầng đã thấy được nhớ lại, để bộ lọc khác làm rỗng danh sách
  // không làm ô "Tầng" mất tầng đã chọn (hay các tầng còn lại).
  const seenLevels = useRef(new Map<string, string>());
  const levelOptions = useMemo(
    () => levelOptionsOf(groups, resolvedRows, seenLevels.current),
    [groups, resolvedRows],
  );

  // Dưới 1280 hai ô chọn gom sau nút "Lọc", để hàng lọc không vỡ ba dòng ở 768.
  const [isMoreOpen, setMoreOpen] = useState(false);
  const narrowed = filters.group !== ANY_OPTION || filters.levelId !== ANY_OPTION;

  return (
    <div className="flex flex-wrap items-end gap-4">
      <Button
        variant="secondary"
        className="xl:hidden"
        aria-expanded={isMoreOpen}
        iconBefore={<SlidersHorizontal aria-hidden="true" className="h-4 w-4" />}
        onClick={() => {
          setMoreOpen((open) => !open);
        }}
      >
        {narrowed ? 'Lọc (đang thu hẹp)' : 'Lọc'}
      </Button>

      <div className={cn('w-full flex-wrap items-end gap-4 xl:flex xl:w-auto', isMoreOpen ? 'flex' : 'hidden')}>
      <Select
        label="Nhóm luật"
        className="w-[200px]"
        value={filters.group}
        options={[
          { label: 'Tất cả nhóm luật', value: ANY_OPTION },
          ...GROUP_ORDER.map((group) => ({ label: GROUP_LABELS[group], value: group })),
        ]}
        onChange={(value) => {
          onFilterChange({ ...filters, group: value as RuleReportFilters['group'] });
        }}
      />

      <Select
        label="Tầng"
        className="w-[200px]"
        value={filters.levelId}
        options={[
          { label: 'Tất cả các tầng', value: ANY_OPTION },
          ...levelOptions.map((option) => ({ label: option.label, value: option.value })),
        ]}
        onChange={(value) => {
          onFilterChange({ ...filters, levelId: value as RuleReportFilters['levelId'] });
        }}
      />
      </div>
    </div>
  );
}
