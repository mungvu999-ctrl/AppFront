/**
 * Thẻ mái của khối "Ngôi nhà" (NHA-08c) — VIEW THUẦN. Mỗi mái máy đề xuất một thẻ; người duyệt sửa từng thông số:
 * dạng mái và vật liệu (chọn một), độ dốc và các số mm (ô nhập), hướng mái (xoay 90°). Giá trị đã nhập mang chip
 * "Người duyệt nhập" và có nút bỏ để quay về giá trị của máy.
 *
 * "Không dựng mái, tôi tự vẽ" khoá thẻ: giá trị còn để đọc, không còn gì để sửa. Không có nút lưu (A7).
 */

import { useId, useRef } from 'react';

import { Button } from '@/components/ui/Button';
import { Checkbox } from '@/components/ui/Checkbox';
import { Radio } from '@/components/ui/Radio';
import type { HouseRoofCard as HouseRoofCardVm, HouseRoofRow } from '@/lib/viewmodel/setBuilding';
import type { HouseActions } from '@/lib/viewmodel/setBuildingDecisions';
import { isRoofNumberField, readRoofNumber } from '@/lib/viewmodel/setBuildingRoofs';

import { HouseNumberCell, HouseValue } from './HouseNumberCell';

const TEXT = {
  skipRoof: 'Không dựng mái, tôi tự vẽ',
  turn: 'Xoay 90°',
  clearChoice: 'Bỏ lựa chọn',
  pitchUnits: '°, % hoặc x:12',
  mm: 'mm',
} as const;

interface RoofRowProps {
  readonly actions: HouseActions;
  readonly card: HouseRoofCardVm;
  readonly row: HouseRoofRow;
}

function RoofRow({ actions, card, row }: RoofRowProps) {
  const labelId = useId();
  const valueRef = useRef<HTMLElement>(null);
  const where = `${row.lower} — ${card.title}`;
  const change = (value: number | string | undefined): void => {
    actions.setRoof(card.key, row.field, value);
  };
  const { edit, field } = row;
  // Nút bỏ biến mất ngay sau khi bấm: đưa tiêu điểm về lựa chọn đang chọn (hoặc nút xoay) của chính dòng này.
  const clearChoice = row.isTyped ? (
    <Button
      aria-label={`${TEXT.clearChoice} ${where}`}
      onClick={() => {
        change(undefined);
        valueRef.current?.querySelector<HTMLElement>('input:checked, button')?.focus();
      }}
      size="sm"
      variant="ghost"
    >
      {TEXT.clearChoice}
    </Button>
  ) : null;

  return (
    <div className="flex flex-col gap-1">
      <dt className="text-text-secondary" id={labelId}>
        {row.label}:
      </dt>
      <dd className="flex min-w-0 flex-col gap-1" ref={valueRef}>
        {card.isSkipped ? <HouseValue cell={row.cell} /> : null}
        {!card.isSkipped && edit.kind === 'number' && isRoofNumberField(field) ? (
          <HouseNumberCell
            cell={row.cell}
            clearLabel={`Bỏ số đã nhập cho ${where}`}
            editLabel={`Sửa ${where}`}
            inputLabel={`${row.label} — ${card.title} (${field === 'pitchDeg' ? TEXT.pitchUnits : TEXT.mm})`}
            inputMode={field === 'pitchDeg' ? 'text' : 'numeric'}
            onSet={change}
            read={(text) => readRoofNumber(field, text)}
            typedText={edit.typedText}
          />
        ) : null}
        {!card.isSkipped && edit.kind === 'choice' ? (
          <>
            <HouseValue cell={row.cell} />
            <Radio.Group
              aria-labelledby={labelId}
              className="flex-row flex-wrap gap-x-4"
              onChange={change}
              value={edit.value}
            >
              {edit.options.map((option) => (
                <Radio.Item key={option.value} label={option.label} value={option.value} />
              ))}
            </Radio.Group>
            <span>{clearChoice}</span>
          </>
        ) : null}
        {!card.isSkipped && edit.kind === 'turn' ? (
          <>
            <HouseValue cell={row.cell} />
            <span className="flex flex-wrap gap-1">
              <Button
                aria-label={`${TEXT.turn} ${where}`}
                onClick={() => {
                  change(edit.next);
                }}
                size="sm"
                variant="ghost"
              >
                {TEXT.turn}
              </Button>
              {clearChoice}
            </span>
          </>
        ) : null}
      </dd>
    </div>
  );
}

export function HouseRoofCard({ actions, card }: { actions: HouseActions; card: HouseRoofCardVm }) {
  const titleId = useId();
  // Thẻ đã khoá chỉ để đọc: dòng không có giá trị thì bỏ, khỏi một cột gạch ngang.
  const rows = card.isSkipped ? card.rows.filter((row) => row.cell !== null) : card.rows;

  return (
    <div
      aria-labelledby={titleId}
      className="flex flex-col gap-2 rounded-lg border border-border-default p-3"
      role="group"
    >
      <h4 className="text-[14px] font-semibold text-text-primary" id={titleId}>
        {card.title}
      </h4>
      {rows.length === 0 ? null : (
        <dl className="flex flex-col gap-3 text-[14px]">
          {rows.map((row) => (
            <RoofRow actions={actions} card={card} key={row.field} row={row} />
          ))}
        </dl>
      )}
      <Checkbox
        checked={card.isSkipped}
        label={TEXT.skipRoof}
        onChange={(checked) => {
          actions.setRoofSkip(card.key, checked);
        }}
        size="sm"
      />
    </div>
  );
}
