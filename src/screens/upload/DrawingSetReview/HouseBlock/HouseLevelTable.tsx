/**
 * Bảng tầng của khối "Ngôi nhà" (NHA-08b) — VIEW THUẦN. Mỗi ô cốt/chiều cao là một `HouseNumberCell`: giá trị
 * kèm chip nguồn, nút "Nhận" (chấp nhận số của máy), "Sửa" (nhập số theo mm) và "Bỏ số đã nhập".
 */

import { Table } from '@/components/ui/Table';
import type { HouseCell, HouseLevelEdit, HouseLevelRow } from '@/lib/viewmodel/setBuilding';
import {
  readLevelNumber,
  type HouseActions,
  type LevelField,
} from '@/lib/viewmodel/setBuildingDecisions';

import { HouseNumberCell } from './HouseNumberCell';

const TEXT = {
  caption: 'Các tầng máy đề xuất',
  levelName: 'Tầng',
  accept: 'Nhận',
  edit: 'Sửa',
} as const;

/** Tên ô: đứng đầu nhãn ô nhập, và viết thường giữa câu của nhãn nút. */
const FIELDS: Readonly<Record<LevelField, { title: string; lower: string }>> = {
  elevationMm: { title: 'Cốt', lower: 'cốt' },
  heightMm: { title: 'Chiều cao', lower: 'chiều cao' },
};

interface LevelCellProps {
  readonly actions: HouseActions;
  readonly cell: HouseCell | null;
  readonly edit: HouseLevelEdit;
  readonly field: LevelField;
  readonly levelRef: string;
  readonly levelName: string;
}

function LevelCell({ actions, cell, edit, field, levelName, levelRef }: LevelCellProps) {
  const { lower, title } = FIELDS[field];
  const { acceptMm } = edit;

  return (
    <HouseNumberCell
      accept={
        acceptMm === undefined
          ? undefined
          : {
              label: `${TEXT.accept} ${lower} của ${levelName}`,
              run: () => {
                actions.setLevel(levelRef, field, acceptMm);
              },
            }
      }
      cell={cell}
      clearLabel={`Bỏ số đã nhập cho ${lower} của ${levelName}`}
      editLabel={`${TEXT.edit} ${lower} của ${levelName}`}
      inputLabel={`${title} của ${levelName} (mm)`}
      onSet={(valueMm) => {
        actions.setLevel(levelRef, field, valueMm);
      }}
      read={(typed) => readLevelNumber(field, typed)}
      typedText={edit.typedMm === undefined ? '' : String(edit.typedMm)}
    />
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
