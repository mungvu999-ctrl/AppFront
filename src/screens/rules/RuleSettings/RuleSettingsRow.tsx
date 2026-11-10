/**
 * Một luật: toggle, câu luật, severity, và ngưỡng của nó.
 *
 * "Bỏ qua" không phải mức thứ tư (quyết định D2 của hợp đồng) — `Toggle` tắt là
 * bỏ qua, `Select` chỉ đổi giữa ba severity thật. Một luật tắt vẫn đứng nguyên
 * trong danh sách, chỉ mờ đi (opacity 0.4, `duration-standard` = 260 ms lấy từ
 * `MOTION_DURATIONS_MS.standard`), vì "luật đã tắt vẫn phải nhìn thấy được".
 */

import { lowerFirst } from '@/lib/format/sentence';
import { Select } from '@/components/ui/Select';
import { NumericField } from '@/components/ui/NumericField';
import { Toggle } from '@/components/ui/Toggle';
import { cn } from '@/lib/utils';

import type { RuleSettingsRow as RuleSettingsRowModel, RuleSettingsThreshold } from './types';

export type RuleCode = RuleSettingsRowModel['code'];
type RuleSeverity = RuleSettingsRowModel['severity'];

/**
 * Ba severity thật của sổ đăng ký — không phải bốn (A4). Không export: đối
 * tượng/mảng export cạnh một component làm `react-refresh/only-export-components`
 * kêu (`allowConstantExport` chỉ tha hằng nguyên thuỷ), và chỉ file này cần bảng.
 */
const SEVERITY_LABELS: Readonly<Record<RuleSeverity, string>> = {
  critical: 'Nghiêm trọng',
  warning: 'Cảnh báo',
  suggestion: 'Gợi ý',
};

const SEVERITY_OPTIONS: readonly { label: string; value: RuleSeverity }[] = [
  { label: SEVERITY_LABELS.critical, value: 'critical' },
  { label: SEVERITY_LABELS.warning, value: 'warning' },
  { label: SEVERITY_LABELS.suggestion, value: 'suggestion' },
];

/** Id dải cảnh báo chỉ-đọc đầu trang: công tắc bị khoá trỏ `aria-describedby` tới đây để mỗi cái nói được lý do. */
export const READ_ONLY_REASON_ID = 'rule-settings-read-only-reason';

/** Vùng bấm 44 px khi con trỏ thô: nới hộp nút bên trong khung bọc của Toggle. */
export const TOGGLE_COARSE_HIT = 'coarse:[&>button]:min-h-11 coarse:[&>button]:min-w-11';

export const FOCUS_RING =
  'focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:ring-offset-bg-app';

interface SeverityPickerProps {
  readonly ruleSentence: string;
  readonly value: RuleSeverity;
  readonly canEdit: boolean;
  readonly onChange: (value: RuleSeverity) => void;
}

/**
 * `Select.Trigger` mang `role="combobox"`, vai đó không tự lấy tên từ chữ bên
 * trong — thiếu `label` là thiếu tên cho trình đọc màn hình. Dòng này chật ở
 * 56px nên nhãn ẩn bằng `sr-only` thay vì bỏ, gắn bằng `htmlFor` như mọi
 * `Select.Label` khác.
 */
function SeverityPicker({ ruleSentence, value, canEdit, onChange }: SeverityPickerProps) {
  if (!canEdit) {
    return (
      <span className="w-40 shrink-0 text-sm text-text-secondary">{SEVERITY_LABELS[value]}</span>
    );
  }

  return (
    <Select.Root
      value={value}
      onChange={(next) => {
        onChange(next as RuleSeverity);
      }}
      options={SEVERITY_OPTIONS.map((option) => ({ ...option }))}
      className="w-40 shrink-0"
    >
      <Select.Label className="sr-only">{`Mức độ của luật: ${ruleSentence}`}</Select.Label>
      <Select.Trigger options={SEVERITY_OPTIONS.map((option) => ({ ...option }))} />
      <Select.Content>
        {SEVERITY_OPTIONS.map((option) => (
          <Select.Item key={option.value} value={option.value}>
            {option.label}
          </Select.Item>
        ))}
      </Select.Content>
    </Select.Root>
  );
}

interface ThresholdFieldProps {
  readonly threshold: RuleSettingsThreshold;
  readonly canEdit: boolean;
  readonly onChange: (value: number) => void;
}

function ThresholdField({ threshold, canEdit, onChange }: ThresholdFieldProps) {
  const visibleLabel = threshold.label.charAt(0).toLocaleUpperCase('vi') + threshold.label.slice(1);

  return (
    <div className="flex w-[180px] shrink-0 flex-col items-stretch gap-0.5 self-start">
      <span aria-hidden="true" className="text-xs text-text-secondary">
        {visibleLabel}
      </span>
    <NumericField
      aria-label={threshold.label}
      className="h-8 w-full"
      unit={threshold.unit}
      value={threshold.value}
      min={threshold.min}
      max={threshold.max}
      step={threshold.step}
      error={threshold.error}
      isReadOnly={!canEdit}
      onChange={(value) => {
        if (value !== undefined) {
          onChange(value);
        }
      }}
    />
    </div>
  );
}

export interface RuleSettingsRuleRowProps {
  readonly row: RuleSettingsRowModel;
  readonly canEdit: boolean;
  readonly isCollapsed: boolean;
  /** Câu của luật `row.supersededBy`, đã tra sẵn ở file cha — hàng này không tra lại. */
  readonly supersededByLabel: string | null;
  readonly onToggleRule: (code: RuleCode, enabled: boolean) => void;
  readonly onChangeSeverity: (code: RuleCode, severity: RuleSeverity) => void;
  readonly onChangeThreshold: (code: RuleCode, key: string, value: number) => void;
}

/**
 * Một dòng luật — cao 56 từ 1024 trở lên. Tên và mô tả xuống dòng chứ không cắt;
 * ô ngưỡng nằm trên dòng riêng dưới tên luật (tới năm ô — chung một dòng với tên
 * thì chúng ăn hết chỗ của tên, BUG-439); số đối tượng bị ảnh hưởng là một dòng chữ
 * dưới mô tả. Thu gọn thì ô mức độ cũng xuống dòng dưới tên.
 */
export function RuleSettingsRuleRow({
  row,
  canEdit,
  isCollapsed,
  supersededByLabel,
  onToggleRule,
  onChangeSeverity,
  onChangeThreshold,
}: RuleSettingsRuleRowProps) {
  // Luật tắt: làm mờ từng phần, KHÔNG làm mờ ghi chú "Đã được thay thế bởi" — đó là lời
  // giải thích duy nhất cho trạng thái tắt, phải giữ tương phản AA (BUG-457).
  const dimmed = cn('transition-opacity duration-standard', !row.enabled && 'opacity-40');

  return (
    <div
      className={cn(
        'flex flex-wrap items-center gap-3 border-b border-border-default py-3 last:border-b-0',
        !isCollapsed && 'min-h-[56px]',
      )}
    >
      <Toggle
        className={cn(dimmed, TOGGLE_COARSE_HIT)}
        aria-label={`Bật hoặc tắt luật: ${lowerFirst(row.sentence)}`}
        aria-describedby={canEdit ? undefined : READ_ONLY_REASON_ID}
        checked={row.enabled}
        isReadOnly={!canEdit}
        onChange={(checked) => {
          onToggleRule(row.code, checked);
        }}
      />

      <div className="flex min-w-0 flex-1 flex-col gap-0.5">
        <div className={cn('flex flex-col gap-0.5', dimmed)}>
          <p className="text-sm text-text-primary">{row.sentence}</p>
          {row.description === '' ? null : <p className="text-xs text-text-secondary">{row.description}</p>}
          {row.impactCaption === '' ? null : <p className="text-xs text-text-secondary">{row.impactCaption}</p>}
        </div>
        {row.supersededBy !== null && (
          <p className="text-xs text-state-attention-text">
            Đã được thay thế bởi {supersededByLabel ?? row.supersededBy}
          </p>
        )}
      </div>

      <div className={cn('shrink-0', isCollapsed && 'basis-full pl-11', dimmed)}>
        <SeverityPicker
          ruleSentence={row.sentence}
          value={row.severity}
          canEdit={canEdit}
          onChange={(severity) => {
            onChangeSeverity(row.code, severity);
          }}
        />
      </div>

      {row.enabled && row.thresholds.length > 0 && (
        <div className={cn('flex basis-full flex-wrap items-center gap-2 pl-11', dimmed)}>
          {row.thresholds.map((threshold) => (
            <ThresholdField
              key={threshold.key}
              threshold={threshold}
              canEdit={canEdit}
              onChange={(value) => {
                onChangeThreshold(row.code, threshold.key, value);
              }}
            />
          ))}
        </div>
      )}
    </div>
  );
}
