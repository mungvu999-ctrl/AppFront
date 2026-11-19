/**
 * Một dòng của bảng "Đề xuất của máy cho cả nhà" — VIEW THUẦN, chỉ đặt chữ của `HouseProposalRowVm`
 * vào thẻ (A15). Mọi giá trị máy đưa ra mang chữ "máy đề xuất" và một chip độ chắc bằng lời; chip
 * không bao giờ là `verified` (A5, xanh dành cho người duyệt).
 */

import { ArrowRight } from 'lucide-react';

import { Badge } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import type { HouseFieldVm, HouseProposalRowVm } from '@/lib/viewmodel/houseProposal';
import type { ViewStatusCode } from '@/lib/viewmodel/types';

/** Hai ô số mà lệnh "Nhận" ghi được. */
export type FloorProposalField = 'elevation' | 'height';

const MACHINE_MARK = 'máy đề xuất';
const SAME_AS_CURRENT = 'Giống giá trị hiện tại';
const NO_FIELD_PROPOSAL = 'Máy không đề xuất';
const ACCEPT_LABEL = 'Nhận';
const FIELD_NAMES: Readonly<Record<FloorProposalField, string>> = { elevation: 'cao độ', height: 'chiều cao' };
const CELL_CLASS = 'px-3 py-2 align-top';

type ChipVariant = Exclude<ViewStatusCode, 'verified'>;

/** A5: đầu ra của máy không mang xanh "đã xác minh"; mã `verified` lọt vào thì hạ về trung tính. */
const chipVariantOf = (code: ViewStatusCode): ChipVariant => (code === 'verified' ? 'neutral' : code);

type AcceptHandler = (floorId: string, field: FloorProposalField, valueMm: number) => void;

interface FieldCellProps {
  readonly floorId: string;
  readonly floorName: string;
  readonly field: FloorProposalField;
  readonly vm: HouseFieldVm;
  readonly canAccept: boolean;
  readonly onAccept: AcceptHandler;
}

function FieldCell({ floorId, floorName, field, vm, canAccept, onAccept }: FieldCellProps) {
  if (!vm.hasProposal || vm.proposedMm === null) {
    return (
      <td className={CELL_CLASS}>
        <span className="tabular-nums text-text-primary">{vm.currentText}</span>
        <p className="text-[12px] text-text-muted">{NO_FIELD_PROPOSAL}</p>
      </td>
    );
  }
  const proposedMm = vm.proposedMm;

  return (
    <td className={CELL_CLASS}>
      <div className="flex flex-wrap items-center gap-x-2 gap-y-1 tabular-nums">
        <span className="text-text-secondary">
          <span className="sr-only">Hiện tại </span>
          {vm.currentText}
        </span>
        {vm.differs ? (
          <>
            <ArrowRight aria-hidden="true" className="h-3.5 w-3.5 shrink-0 text-text-muted" />
            <span className="font-medium text-text-primary">
              <span className="sr-only">{MACHINE_MARK} </span>
              {vm.proposedText}
            </span>
            {vm.deltaText === null ? null : <span className="text-[12px] text-text-muted">({vm.deltaText})</span>}
          </>
        ) : (
          <span className="text-[12px] text-text-muted">{SAME_AS_CURRENT}</span>
        )}
      </div>
      <div className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1">
        <Badge variant={chipVariantOf(vm.statusCode)}>{vm.confidenceLabel ?? MACHINE_MARK}</Badge>
        <span className="text-[12px] text-text-muted">
          {MACHINE_MARK}
          {vm.sourceText === null ? '' : `, theo ${vm.sourceText}`}
        </span>
        {canAccept && vm.acceptable ? (
          <Button
            aria-label={`${ACCEPT_LABEL} ${FIELD_NAMES[field]} đề xuất cho ${floorName}`}
            onClick={() => onAccept(floorId, field, proposedMm)}
            size="sm"
            variant="secondary"
          >
            {ACCEPT_LABEL}
          </Button>
        ) : null}
      </div>
    </td>
  );
}

export interface FloorProposalRowProps {
  readonly row: HouseProposalRowVm;
  readonly canAccept: boolean;
  readonly onAccept: AcceptHandler;
}

export function FloorProposalRow({ row, canAccept, onAccept }: FloorProposalRowProps) {
  const { floorId, floorName } = row;

  return (
    <tr className="border-b border-border-default-50 last:border-0">
      <th className={`${CELL_CLASS} text-left font-medium text-text-primary`} scope="row">
        {floorName}
        {row.questions.length === 0 ? null : (
          <ul aria-label={`Câu hỏi của máy về ${floorName}`} className="mt-1 list-disc pl-4 text-[12px] font-normal text-text-secondary">
            {row.questions.map((question) => (
              <li key={question}>{question}</li>
            ))}
          </ul>
        )}
      </th>
      {row.hasProposal ? (
        <>
          <td className={CELL_CLASS}>
            <span className="text-text-primary">{row.storeyText}</span>
            <div className="mt-1 flex flex-wrap items-center gap-2">
              <Badge variant={chipVariantOf(row.storeyStatusCode)}>{row.storeyConfidenceLabel ?? MACHINE_MARK}</Badge>
              <span className="text-[12px] text-text-muted">{MACHINE_MARK}</span>
            </div>
          </td>
          <FieldCell canAccept={canAccept} field="elevation" floorId={floorId} floorName={floorName} onAccept={onAccept} vm={row.elevation} />
          <FieldCell canAccept={canAccept} field="height" floorId={floorId} floorName={floorName} onAccept={onAccept} vm={row.height} />
        </>
      ) : (
        <td className={`${CELL_CLASS} text-text-muted`} colSpan={3}>
          {row.noProposalText}
        </td>
      )}
    </tr>
  );
}
