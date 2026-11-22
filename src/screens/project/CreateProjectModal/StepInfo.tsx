/**
 * Step 1 of the "tạo dự án mới" wizard — thông tin công trình.
 *
 * Only the name is required; address and notes fold under "Thông tin bổ sung"
 * (shown step by step, spec §3.1). The fold opens by itself while the address
 * holds a complaint, so an error is never hidden. A pure view.
 */

import { ChevronDown, ChevronRight } from 'lucide-react';

import { Input } from '@/components/ui/Input';
import { Select } from '@/components/ui/Select';
import { Textarea } from '@/components/ui/Textarea';
import { cn } from '@/lib/utils';

import { FIELD_IDS } from './createProjectGate';
import { PROJECT_LIMITS, type CreateProjectModalViewProps } from './useCreateProjectModal';

export interface StepInfoProps extends CreateProjectModalViewProps {
  readonly isMoreOpen: boolean;
  readonly toggleMore: () => void;
}

export function StepInfo(props: StepInfoProps) {
  const gridClassName = cn('grid gap-4', props.isCompact ? 'grid-cols-1' : 'grid-cols-2');
  const isMoreOpen = props.isMoreOpen || props.problems.address !== null;

  return (
    <div className="flex flex-col gap-4">
      <Input
        id={FIELD_IDS.name}
        label="Tên dự án"
        value={props.name}
        onChange={(event) => props.setName(event.target.value)}
        onBlur={props.touchName}
        maxLength={PROJECT_LIMITS.nameMaxLength}
        error={props.problems.name}
        hint={props.nameHint}
        disabled={props.isSubmitting}
        placeholder="Ví dụ: Chung cư Bình Minh"
        data-autofocus
      />
      <div className={gridClassName}>
        <Input
          id={FIELD_IDS.code}
          label="Mã dự án"
          value={props.code}
          onChange={(event) => props.setCode(event.target.value)}
          error={props.problems.code}
          disabled={props.isSubmitting}
          hint="Tự tạo từ tên, sửa được"
        />
        <Select.Root
          value={props.buildingType}
          onChange={props.setBuildingType}
          options={props.buildingTypeOptions}
          isOpen={props.isSelectOpen}
          onOpenChange={props.setSelectOpen}
          disabled={props.isSubmitting}
        >
          <Select.Label>Loại công trình</Select.Label>
          <Select.Trigger options={props.buildingTypeOptions} />
          <Select.Content>
            {props.buildingTypeOptions.map((option, index) => (
              <Select.Item key={option.value} value={option.value} index={index}>
                {option.label}
              </Select.Item>
            ))}
          </Select.Content>
        </Select.Root>
      </div>

      <div className="flex flex-col gap-4 border-t border-border-default pt-3">
        <button
          type="button"
          aria-expanded={isMoreOpen}
          aria-controls="create-project-more"
          onClick={props.toggleMore}
          className="flex min-h-8 items-center gap-2 self-start rounded-md text-left text-[14px] text-text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2"
        >
          {isMoreOpen ? (
            <ChevronDown size={16} aria-hidden="true" className="text-text-secondary" />
          ) : (
            <ChevronRight size={16} aria-hidden="true" className="text-text-secondary" />
          )}
          <span>
            <span className="font-medium">Thông tin bổ sung</span>{' '}
            <span className="text-[13px] text-text-secondary">địa chỉ, ghi chú, không bắt buộc</span>
          </span>
        </button>
        {isMoreOpen && (
          <div id="create-project-more" className="flex flex-col gap-4">
            <Input
              id={FIELD_IDS.address}
              label="Địa chỉ"
              value={props.address}
              onChange={(event) => props.setAddress(event.target.value)}
              error={props.problems.address}
              disabled={props.isSubmitting}
            />
            <Textarea
              label="Ghi chú"
              maxLength={500}
              value={props.notes}
              onChange={(event) => props.setNotes(event.target.value)}
              disabled={props.isSubmitting}
              placeholder="Không bắt buộc"
            />
          </div>
        )}
      </div>

      {props.floorRows.length > 0 && (
        <p className="text-[13px] leading-[18px] text-text-secondary">
          Bước tiếp theo khai báo tầng: dự án mới có sẵn {props.floorRows.length} tầng, chỉ cần nhập chiều cao từng tầng.
        </p>
      )}
    </div>
  );
}
