/**
 * Một tầng của bảng "Đề xuất của máy cho cả nhà" — VIEW THUẦN, chỉ đặt chữ của `HouseProposalRowVm`
 * vào thẻ (A15). Một dòng bảng cho tầng; câu hỏi của máy nằm trên MỘT dòng nhỏ ngay dưới. Chữ "máy đề
 * xuất" nói một lần ở chú thích bảng, không lặp ở từng ô. Chip độ chắc luôn bằng lời và không bao giờ là
 * `verified` (A5, xanh dành cho người duyệt).
 *
 * Ô số là lưới hai cột: bên trái số + chip + nguồn, bên phải một khe cố định cho nút "Nhận" — nút luôn
 * nằm đúng một chỗ ở mọi ô, kể cả ở 1024 px.
 */

import { ArrowRight } from 'lucide-react';

import { Badge } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import type { HouseFieldVm, HouseProposalRowVm } from '@/lib/viewmodel/houseProposal';
import type { ViewStatusCode } from '@/lib/viewmodel/types';

/** Hai ô số mà lệnh "Nhận" ghi được. */
export type FloorProposalField = 'elevation' | 'height';

const MACHINE_MARK = 'máy đề xuất';
const SAME_AS_CURRENT = 'giống giá trị hiện tại';
const NO_FIELD_PROPOSAL = 'máy không đề xuất';
const ACCEPT_LABEL = 'Nhận';
const FIELD_NAMES: Readonly<Record<FloorProposalField, string>> = { elevation: 'cao độ', height: 'chiều cao' };
const CELL_CLASS = 'px-3 py-1.5 align-middle';
/** Khe cố định của nút "Nhận": cùng một chỗ ở mọi ô. */
const ACCEPT_SLOT_CLASS = 'flex w-14 shrink-0 justify-end';

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
        <span className="tabular-nums text-text-primary">{vm.currentText}</span>{' '}
        <span className="text-[12px] text-text-secondary">{NO_FIELD_PROPOSAL}</span>
      </td>
    );
  }
  const proposedMm = vm.proposedMm;

  return (
    <td className={CELL_CLASS}>
      <div className="grid grid-cols-[1fr_auto] items-center gap-x-2">
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
              {vm.deltaText === null ? null : <span className="text-[12px] text-text-secondary">({vm.deltaText})</span>}
            </>
          ) : (
            <span className="text-[12px] text-text-secondary">{SAME_AS_CURRENT}</span>
          )}
          <Badge variant={chipVariantOf(vm.statusCode)}>{vm.confidenceLabel ?? MACHINE_MARK}</Badge>
          {vm.sourceText === null ? null : <span className="text-[12px] text-text-secondary">theo {vm.sourceText}</span>}
        </div>
        {canAccept ? (
          <div className={ACCEPT_SLOT_CLASS}>
            {vm.acceptable ? (
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
    <tbody className="border-b border-border-default-50 last:border-0">
      <tr>
        <th className={`${CELL_CLASS} text-left font-normal`} scope="row">
          <span className="font-medium text-text-primary">{floorName}</span>
          {row.hasProposal ? (
            <span className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-0.5">
              <span className="text-[12px] text-text-secondary">máy đọc: {row.storeyText}</span>
              <Badge variant={chipVariantOf(row.storeyStatusCode)}>{row.storeyConfidenceLabel ?? MACHINE_MARK}</Badge>
            </span>
          ) : null}
        </th>
        {row.hasProposal ? (
          <>
            <FieldCell canAccept={canAccept} field="elevation" floorId={floorId} floorName={floorName} onAccept={onAccept} vm={row.elevation} />
            <FieldCell canAccept={canAccept} field="height" floorId={floorId} floorName={floorName} onAccept={onAccept} vm={row.height} />
          </>
        ) : (
          <td className={`${CELL_CLASS} text-text-secondary`} colSpan={2}>
            {row.noProposalText}
          </td>
        )}
      </tr>
      {row.questions.length === 0 ? null : (
        <tr>
          <td className="px-3 pb-1.5 pt-0" colSpan={3}>
            <ul
              aria-label={`Câu hỏi của máy về ${floorName}`}
              className="flex list-none flex-wrap gap-x-4 gap-y-0.5 text-[12px] text-text-secondary"
            >
              {row.questions.map((question) => (
                <li key={question}>{question}</li>
              ))}
            </ul>
          </td>
        </tr>
      )}
    </tbody>
  );
}
