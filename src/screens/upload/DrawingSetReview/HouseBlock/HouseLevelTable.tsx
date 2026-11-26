/**
 * Bảng tầng của khối "Ngôi nhà" (NHA-08b) — VIEW THUẦN. Mỗi ô cốt/chiều cao: giá trị kèm chip nguồn, nút
 * "Nhận" (chấp nhận số của máy), "Sửa" (nhập số theo mm) và "Bỏ số đã nhập".
 *
 * Không có nút lưu (A7): Enter hoặc rời ô là ghi vào bản duyệt, Esc đóng ô mà không ghi. Trạng thái duy nhất
 * giữ ở đây là chữ đang gõ trong ô sửa.
 */

import { useEffect, useRef, useState } from 'react';

import { Badge } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { Table } from '@/components/ui/Table';
import { MISSING_VALUE } from '@/lib/format/number';
import type { HouseCell, HouseLevelEdit, HouseLevelRow } from '@/lib/viewmodel/setBuilding';
import {
  levelValueFromText,
  levelValueProblem,
  type HouseActions,
  type LevelField,
} from '@/lib/viewmodel/setBuildingDecisions';

const TEXT = {
  caption: 'Các tầng máy đề xuất',
  levelName: 'Tầng',
  accept: 'Nhận',
  edit: 'Sửa',
  clear: 'Bỏ số đã nhập',
} as const;

/** Tên ô: đứng đầu nhãn ô nhập, và viết thường giữa câu của nhãn nút. */
const FIELDS: Readonly<Record<LevelField, { title: string; lower: string }>> = {
  elevationMm: { title: 'Cốt', lower: 'cốt' },
  heightMm: { title: 'Chiều cao', lower: 'chiều cao' },
};

export function HouseValue({ cell }: { cell: HouseCell | null }) {
  if (cell === null) return <span className="text-text-secondary">{MISSING_VALUE}</span>;

  return (
    <span className="inline-flex flex-wrap items-center gap-2">
      <span className="text-text-primary">{cell.text}</span>
      <Badge variant={cell.status}>{cell.chip}</Badge>
    </span>
  );
}

interface LevelCellProps {
  readonly actions: HouseActions;
  readonly cell: HouseCell | null;
  readonly edit: HouseLevelEdit;
  readonly field: LevelField;
  readonly levelRef: string;
  readonly levelName: string;
}

function LevelCell({ actions, cell, edit, field, levelName, levelRef }: LevelCellProps) {
  /** Chữ đang gõ; `null` = ô sửa đang đóng. */
  const [draft, setDraft] = useState<string | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const editButtonRef = useRef<HTMLButtonElement>(null);
  const wasOpenRef = useRef(false);
  /** Ô vừa được đóng có chủ ý: sự kiện rời ô lúc nó bị gỡ khỏi trang không được ghi lại lần nữa (Esc là huỷ). */
  const doneRef = useRef(false);
  const isOpen = draft !== null;
  const { lower, title } = FIELDS[field];
  const typedText = edit.typedMm === undefined ? '' : String(edit.typedMm);

  // Bàn phím (A12): mở ô thì con trỏ vào ô, đóng ô thì trả về nút "Sửa".
  useEffect(() => {
    if (isOpen) inputRef.current?.focus();
    else if (wasOpenRef.current) editButtonRef.current?.focus();
    wasOpenRef.current = isOpen;
  }, [isOpen]);

  const close = (): void => {
    doneRef.current = true;
    setDraft(null);
    setProblem(null);
  };
  const commit = (text: string): void => {
    if (text.trim() === '') {
      // Xoá trắng ô: bỏ số đã nhập (nếu có) rồi đóng.
      if (edit.typedMm !== undefined) actions.setLevel(levelRef, field, undefined);
      close();

      return;
    }
    const valueMm = levelValueFromText(text);
    const found = levelValueProblem(field, valueMm);

    if (found !== null) {
      setProblem(found);

      return;
    }
    actions.setLevel(levelRef, field, valueMm);
    close();
  };

  return (
    <div className="flex flex-col gap-1">
      <HouseValue cell={cell} />
      {draft === null ? (
        <span className="flex flex-wrap gap-1">
          {edit.acceptMm === undefined ? null : (
            <Button
              aria-label={`${TEXT.accept} ${lower} của ${levelName}`}
              onClick={() => {
                actions.setLevel(levelRef, field, edit.acceptMm);
                // Nút này sắp biến mất: giữ tiêu điểm trong ô cho người dùng bàn phím.
                editButtonRef.current?.focus();
              }}
              size="sm"
              variant="ghost"
            >
              {TEXT.accept}
            </Button>
          )}
          <Button
            aria-label={`${TEXT.edit} ${lower} của ${levelName}`}
            onClick={() => {
              doneRef.current = false;
              setDraft(typedText);
            }}
            ref={editButtonRef}
            size="sm"
            variant="ghost"
          >
            {TEXT.edit}
          </Button>
          {edit.typedMm === undefined ? null : (
            <Button
              aria-label={`Bỏ ${lower} đã nhập của ${levelName}`}
              onClick={() => {
                actions.setLevel(levelRef, field, undefined);
                editButtonRef.current?.focus();
              }}
              size="sm"
              variant="ghost"
            >
              {TEXT.clear}
            </Button>
          )}
        </span>
      ) : (
        <Input
          error={problem ?? undefined}
          inputMode="numeric"
          label={`${title} của ${levelName} (mm)`}
          onBlur={() => {
            // Rời ô mà không đổi gì thì đóng; có đổi thì ghi như Enter.
            if (doneRef.current) return;
            if (draft === typedText) close();
            else commit(draft);
          }}
          onChange={(event) => {
            setDraft(event.target.value);
          }}
          onKeyDown={(event) => {
            if (event.key === 'Enter') {
              // Không chặn thì phím rơi tiếp vào nút "Sửa" vừa nhận lại tiêu điểm và mở lại ô.
              event.preventDefault();
              commit(draft);
            }
            if (event.key === 'Escape') {
              event.stopPropagation();
              close();
            }
          }}
          ref={inputRef}
          value={draft}
        />
      )}
    </div>
  );
}

export function HouseLevelTable({
  actions,
  levels,
}: {
  actions: HouseActions;
  levels: readonly HouseLevelRow[];
}) {
  return (
    <Table.Root className="h-auto">
      <caption className="sr-only">{TEXT.caption}</caption>
      <Table.Header>
        <Table.Row>
          <Table.Head>{TEXT.levelName}</Table.Head>
          <Table.Head>{FIELDS.elevationMm.title}</Table.Head>
          <Table.Head>{FIELDS.heightMm.title}</Table.Head>
        </Table.Row>
      </Table.Header>
      <Table.Body>
        {levels.map((level) => (
          <Table.Row key={level.key}>
            <Table.Cell>{level.name}</Table.Cell>
            <Table.Cell>
              <LevelCell
                actions={actions}
                cell={level.elevation}
                edit={level.elevationEdit}
                field="elevationMm"
                levelName={level.name}
                levelRef={level.key}
              />
            </Table.Cell>
            <Table.Cell>
              <LevelCell
                actions={actions}
                cell={level.height}
                edit={level.heightEdit}
                field="heightMm"
                levelName={level.name}
                levelRef={level.key}
              />
            </Table.Cell>
          </Table.Row>
        ))}
      </Table.Body>
    </Table.Root>
  );
}
