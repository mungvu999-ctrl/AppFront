/**
 * Một tầng của bảng "Đề xuất của máy cho cả nhà" — VIEW THUẦN, chỉ đặt chữ của `HouseProposalRowVm`
 * vào thẻ (A15). Mỗi ô số tự nói đủ: hiện tại → đề xuất (có đơn vị, chênh có dấu), chip độ chắc bằng
 * lời, nguồn; rồi MỘT trong: nút "Nhận" + câu "Nhận sẽ…" ngay dưới (trước khi bấm), lý do không nhận
 * được, hoặc "Đã nhận từ đề xuất của máy". Câu hỏi của máy nằm dưới đúng ô nó hỏi; câu hỏi cả dòng
 * nằm dưới tên tầng. Chip không bao giờ là `verified` (A5, xanh dành cho người duyệt).
 */

import { ArrowRight } from 'lucide-react';
import { useId } from 'react';

import { Badge } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import type { HouseFieldVm, HouseProposalRowVm } from '@/lib/viewmodel/houseProposal';
import type { ViewStatusCode } from '@/lib/viewmodel/types';

/** Hai ô số mà lệnh "Nhận" ghi được. */
export type FloorProposalField = 'elevation' | 'height';

const MACHINE_MARK = 'máy đề xuất';
const SAME_AS_CURRENT = 'giống giá trị hiện tại';
const NO_FIELD_PROPOSAL = 'máy không đề xuất';
const ACCEPTED_TEXT = 'Đã nhận từ đề xuất của máy';
const LOOK_LABEL = 'Cần xem';
const ACCEPT_LABEL = 'Nhận';
const FIELD_NAMES: Readonly<Record<FloorProposalField, string>> = { elevation: 'cao độ', height: 'chiều cao' };
const CELL_CLASS = 'px-3 py-1.5 align-top';
const NOTE_CLASS = 'text-[12px] text-text-secondary';

type ChipVariant = Exclude<ViewStatusCode, 'verified'>;

/** A5: đầu ra của máy không mang xanh "đã xác minh"; mã `verified` lọt vào thì hạ về trung tính. */
const chipVariantOf = (code: ViewStatusCode): ChipVariant => (code === 'verified' ? 'neutral' : code);

type AcceptHandler = (row: HouseProposalRowVm, field: FloorProposalField) => void;

function Questions({ label, items }: { readonly label: string; readonly items: readonly string[] }) {
  return items.length === 0 ? null : (
    <ul aria-label={label} className={`mt-1 flex list-none flex-col gap-0.5 ${NOTE_CLASS}`}>
      {items.map((question) => (
        <li key={question}>{question}</li>
      ))}
    </ul>
  );
}

interface FieldCellProps {
  readonly row: HouseProposalRowVm;
  readonly field: FloorProposalField;
  readonly canAccept: boolean;
  readonly busy: boolean;
  readonly isAccepted: boolean;
  readonly onAccept: AcceptHandler;
}

function Comparison({ vm, isAccepted }: { readonly vm: HouseFieldVm; readonly isAccepted: boolean }) {
  return (
    <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5 tabular-nums">
      <span className="text-text-secondary">
        <span className="sr-only">Hiện tại </span>
        {vm.currentText}
      </span>
      {vm.differs ? (
        <>
          <ArrowRight aria-hidden="true" className="h-3.5 w-3.5 shrink-0 text-text-secondary" />
          <span className="font-medium text-text-primary">
            <span className="sr-only">{MACHINE_MARK} </span>
            {vm.proposedText}
          </span>
          {vm.deltaText === null ? null : <span className={NOTE_CLASS}>({vm.deltaText})</span>}
        </>
      ) : (
        <span className={NOTE_CLASS}>{isAccepted ? ACCEPTED_TEXT : SAME_AS_CURRENT}</span>
      )}
      <Badge variant={chipVariantOf(vm.statusCode)}>{vm.confidenceLabel ?? MACHINE_MARK}</Badge>
      {vm.sourceText === null ? null : <span className={NOTE_CLASS}>theo {vm.sourceText}</span>}
    </div>
  );
}

function FieldCell({ row, field, canAccept, busy, isAccepted, onAccept }: FieldCellProps) {
  const vm = row[field];
  const effectId = useId();
  const questions = <Questions items={row.questionsFor[field]} label={`Câu hỏi của máy về ${FIELD_NAMES[field]} ${row.floorName}`} />;

  if (!vm.hasProposal) {
    return (
      <td className={CELL_CLASS}>
        <span className="tabular-nums text-text-primary">{vm.currentText}</span> <span className={NOTE_CLASS}>{NO_FIELD_PROPOSAL}</span>
        {questions}
      </td>
    );
  }
  const assumed = vm.sourceKind === 'assumed';
  const check = field === 'elevation' ? row.elevationCheck : null;

  return (
    <td className={CELL_CLASS}>
      <Comparison isAccepted={isAccepted} vm={vm} />
      {assumed ? <p className={NOTE_CLASS}>{vm.blockedReason ?? vm.hint}</p> : null}
      {!assumed && canAccept && vm.acceptable ? (
        <div className="mt-1 flex flex-col items-start gap-0.5">
          {/* aria-disabled, không `disabled`: nút giữ tiêu điểm khi lượt ghi chạy và khi nó hỏng. */}
          <Button
            aria-describedby={vm.effectText === null ? undefined : effectId}
            aria-disabled={busy || undefined}
            aria-label={`${ACCEPT_LABEL} ${FIELD_NAMES[field]} đề xuất cho ${row.floorName}: ${vm.proposedText}`}
            onClick={() => {
              if (!busy) onAccept(row, field);
            }}
            size="sm"
            variant="secondary"
          >
            {ACCEPT_LABEL}
          </Button>
          {vm.effectText === null ? null : (
            <p className={NOTE_CLASS} id={effectId}>
              {vm.effectText}
            </p>
          )}
        </div>
      ) : null}
      {!assumed && !vm.acceptable && vm.blockedReason !== null ? <p className={NOTE_CLASS}>{vm.blockedReason}</p> : null}
      {check === null ? null : check.agrees ? (
        <p className={NOTE_CLASS}>{check.text}</p>
      ) : (
        <p className="mt-0.5 flex flex-wrap items-center gap-x-2 text-[12px] text-text-primary">
          <Badge variant="attention">{LOOK_LABEL}</Badge>
          {check.text}
        </p>
      )}
      {questions}
    </td>
  );
}

export interface FloorProposalRowProps {
  readonly row: HouseProposalRowVm;
  readonly canAccept: boolean;
  readonly busy: boolean;
  readonly accepted: ReadonlySet<string>;
  readonly onAccept: AcceptHandler;
}

export function FloorProposalRow({ row, canAccept, busy, accepted, onAccept }: FloorProposalRowProps) {
  const { floorId, floorName } = row;
  const cell = (field: FloorProposalField) => (
    <FieldCell
      busy={busy}
      canAccept={canAccept}
      field={field}
      isAccepted={accepted.has(`${floorId}:${field}`)}
      onAccept={onAccept}
      row={row}
    />
  );

  return (
    <tbody className="border-b border-border-default-50 last:border-0">
      <tr>
        <th className={`${CELL_CLASS} text-left font-normal`} data-floor-header={floorId} scope="row" tabIndex={-1}>
          <span className="font-medium text-text-primary">{floorName}</span>
          {row.hasProposal ? (
            <span className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-0.5">
              <span className={NOTE_CLASS}>máy đọc: {row.storeyText}</span>
              <Badge variant={chipVariantOf(row.storeyStatusCode)}>{row.storeyConfidenceLabel ?? MACHINE_MARK}</Badge>
            </span>
          ) : null}
          <Questions items={row.questionsFor.row} label={`Câu hỏi của máy về ${floorName}`} />
        </th>
        {row.hasProposal ? (
          <>
            {cell('elevation')}
            {cell('height')}
          </>
        ) : (
          <td className={`${CELL_CLASS} text-text-secondary`} colSpan={2}>
            {row.noProposalText}
          </td>
        )}
      </tr>
    </tbody>
  );
}
