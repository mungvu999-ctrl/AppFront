/**
 * Một hình máy tách được từ một trang — VIEW THUẦN của lưới "Duyệt bộ hồ sơ".
 *
 * Phần máy nói (loại, tầng, độ chắc, câu hỏi) chỉ là CHIP vàng/đỏ/trung tính — không bao giờ xanh "đã
 * xác minh" (A5): xanh dành cho việc người duyệt làm, và hình này chưa qua tay họ. Phần người duyệt làm
 * (loại, đích, bỏ hình) là các ô điều khiển. Mặt bằng cần ĐÍCH: tầng có sẵn (kèm ô "Thay bản vẽ cũ" khi tầng
 * đã có bản vẽ) hoặc tầng mới; mặt cắt thành dòng mặt cắt; các loại khác không thành tầng.
 */

import { Badge } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { Checkbox } from '@/components/ui/Checkbox';
import { Input } from '@/components/ui/Input';
import { cn } from '@/lib/utils';
import {
  REPLACE_WARNING,
  VIEW_KIND_OPTIONS,
  type ReviewFloor,
  type ViewCardVm,
  type ViewDraft,
} from '@/lib/viewmodel/drawingSetReview';

import type { UseDrawingSetReviewResult } from './useDrawingSetReview';

const NEW_FLOOR_VALUE = '__new__';
const NO_TARGET_VALUE = '';

const TEXT = {
  kind: 'Loại hình',
  target: 'Tầng của hình này',
  targetNone: 'Chưa chọn tầng',
  targetNew: 'Tạo tầng mới',
  hasDrawing: 'đã có bản vẽ',
  newName: 'Tên tầng mới',
  replace: 'Thay bản vẽ cũ',
  exclude: 'Bỏ hình này',
  include: 'Dùng lại hình này',
  excluded: 'Hình này đã bị bỏ và không được dùng.',
  noPreview: 'Chưa có ảnh xem trước',
  floorsLoading: 'Đang đọc các tầng…',
  section: 'Hình này thành một dòng mặt cắt, ẩn khỏi 3D.',
  other: 'Loại này không thành tầng.',
  sheetNo: 'Số bản vẽ',
} as const;

const SELECT_CLASS =
  'h-9 w-full min-w-0 rounded-md border border-border-default bg-bg-surface px-2 text-[14px] text-text-primary ' +
  'focus-visible:outline-solid focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent ' +
  'disabled:cursor-not-allowed disabled:opacity-60';

export interface DrawingSetViewCardProps {
  readonly draft: ViewDraft;
  readonly vm: ViewCardVm;
  /** "ten-tep.pdf · trang 2". */
  readonly sourceLabel: string;
  /** Vấn đề chặn xác nhận của riêng hình này; `null` khi không có. */
  readonly problem: string | null;
  /** `null` = đang đọc tầng. */
  readonly floors: readonly ReviewFloor[] | null;
  readonly actions: Pick<
    UseDrawingSetReviewResult['actions'],
    'chooseFloor' | 'chooseNewFloor' | 'clearTarget' | 'setExcluded' | 'setKind' | 'setNewFloorName' | 'setReplace'
  >;
}

const targetValueOf = (draft: ViewDraft): string =>
  draft.target.mode === 'floor' ? `floor:${draft.target.floorId}` : draft.target.mode === 'newFloor' ? NEW_FLOOR_VALUE : NO_TARGET_VALUE;

export function DrawingSetViewCard({ actions, draft, floors, problem, sourceLabel, vm }: DrawingSetViewCardProps) {
  const { id } = draft;
  const kindId = `dws-kind-${id}`;
  const targetId = `dws-target-${id}`;
  const usable = floors?.filter((floor) => !floor.isSection) ?? [];
  const target = draft.target;
  const chosen = target.mode === 'floor' ? floors?.find((floor) => floor.id === target.floorId) : undefined;

  const onTargetChange = (value: string): void => {
    if (value === NO_TARGET_VALUE) actions.clearTarget(id);
    else if (value === NEW_FLOOR_VALUE) actions.chooseNewFloor(id);
    else actions.chooseFloor(id, value.slice('floor:'.length));
  };

  return (
    <article
      aria-label={sourceLabel}
      className={cn(
        'flex flex-col gap-3 rounded-lg border bg-bg-surface p-3',
        problem === null ? 'border-border-default' : 'border-state-violation',
        draft.excluded && 'opacity-70',
      )}
    >
      {draft.imageUrl === undefined ? (
        <div className="flex h-40 items-center justify-center rounded-md bg-bg-sunken text-[13px] text-text-secondary">{TEXT.noPreview}</div>
      ) : (
        <img alt={`Hình cắt từ ${sourceLabel}`} className="h-40 w-full rounded-md bg-bg-sunken object-contain" src={draft.imageUrl} />
      )}
      <p className="text-[13px] text-text-secondary">{sourceLabel}</p>
      {draft.sheetNo === undefined ? null : (
        <p className="text-[13px] text-text-secondary">
          {TEXT.sheetNo}: <span className="font-semibold text-text-primary">{draft.sheetNo}</span>
        </p>
      )}

      <div className="flex flex-wrap items-center gap-2 text-[14px]">
        <span className="font-semibold text-text-primary">{vm.kindText}</span>
        <Badge variant={vm.kindStatus}>{vm.kindChip}</Badge>
        {draft.kind === 'plan' ? (
          <>
            <span className="text-text-secondary">{vm.storeyText}</span>
            <Badge variant={vm.storeyStatus}>{vm.storeyChip}</Badge>
          </>
        ) : null}
      </div>
      {vm.questions.length === 0 ? null : (
        <ul className="list-disc pl-5 text-[13px] text-text-secondary">
          {vm.questions.map((text) => (
            <li key={text}>{text}</li>
          ))}
        </ul>
      )}

      {draft.excluded ? (
        <p className="text-[13px] text-text-secondary">{TEXT.excluded}</p>
      ) : (
        <>
          <div className="flex flex-col gap-1">
            <label className="text-[13px] font-medium text-text-secondary" htmlFor={kindId}>
              {TEXT.kind}
            </label>
            <select
              className={SELECT_CLASS}
              id={kindId}
              onChange={(event) => {
                actions.setKind(id, event.target.value as ViewDraft['kind']);
              }}
              value={draft.kind}
            >
              {VIEW_KIND_OPTIONS.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
          </div>

          {draft.kind === 'plan' ? (
            <div className="flex flex-col gap-2">
              <div className="flex flex-col gap-1">
                <label className="text-[13px] font-medium text-text-secondary" htmlFor={targetId}>
                  {TEXT.target}
                </label>
                <select
                  aria-describedby={problem === null ? undefined : `${targetId}-problem`}
                  aria-invalid={problem !== null}
                  className={SELECT_CLASS}
                  disabled={floors === null}
                  id={targetId}
                  onChange={(event) => {
                    onTargetChange(event.target.value);
                  }}
                  value={targetValueOf(draft)}
                >
                  <option value={NO_TARGET_VALUE}>{floors === null ? TEXT.floorsLoading : TEXT.targetNone}</option>
                  {usable.map((floor) => (
                    <option key={floor.id} value={`floor:${floor.id}`}>
                      {floor.hasDrawing ? `${floor.name} (${TEXT.hasDrawing})` : floor.name}
                    </option>
                  ))}
                  <option value={NEW_FLOOR_VALUE}>{TEXT.targetNew}</option>
                </select>
              </div>
              {target.mode === 'newFloor' ? (
                <Input
                  label={TEXT.newName}
                  onChange={(event) => {
                    actions.setNewFloorName(id, event.target.value);
                  }}
                  value={target.name}
                />
              ) : null}
              {target.mode === 'floor' && chosen?.hasDrawing === true ? (
                <div className="flex flex-col gap-1">
                  <Checkbox
                    checked={target.replace}
                    label={TEXT.replace}
                    onChange={(checked) => {
                      actions.setReplace(id, checked);
                    }}
                  />
                  {target.replace ? <p className="text-[13px] text-state-attention-text">{REPLACE_WARNING}</p> : null}
                </div>
              ) : null}
            </div>
          ) : (
            <p className="text-[13px] text-text-secondary">{draft.kind === 'section' ? TEXT.section : TEXT.other}</p>
          )}
        </>
      )}

      {problem === null ? null : (
        <p className="text-[13px] text-state-violation-text" id={`${targetId}-problem`}>
          {problem}
        </p>
      )}
      <Button
        onClick={() => {
          actions.setExcluded(id, !draft.excluded);
        }}
        size="sm"
        variant="ghost"
      >
        {draft.excluded ? TEXT.include : TEXT.exclude}
      </Button>
    </article>
  );
}
