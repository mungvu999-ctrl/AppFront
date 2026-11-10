/**
 * Một thẻ nhóm luật, và thẻ "Ngưỡng chung".
 *
 * `RuleSettingsGroup.enabled` là giá trị đã tính sẵn (bật khi còn ít nhất một
 * luật con bật) — file này chỉ vẽ nó, không tính lại. `onToggleGroup` là hành
 * động duy nhất nhóm phát ra; tắt/bật từng luật con vẫn đi qua `onToggleRule`
 * trên chính hàng đó, không phải qua nhóm.
 *
 * Mỗi thẻ là đích của một liên kết trên thanh điều hướng, nên nó mang `id` và
 * `tabIndex={-1}`: thiếu `tabIndex` thì `focus()` không bám vào một `<section>`
 * được, và người đi bằng bàn phím nhảy tới mục xong lại rơi về đầu trang ở lần
 * Tab kế tiếp. `-1` chỉ mở đường cho `focus()` theo mã, không chen thêm một
 * điểm dừng nào vào thứ tự Tab.
 */

import { Section } from '@/components/shell/Section';
import { lowerFirst } from '@/lib/format/sentence';
import { NumericField } from '@/components/ui/NumericField';
import { Toggle } from '@/components/ui/Toggle';

import { type RuleCode, READ_ONLY_REASON_ID, RuleSettingsRuleRow, TOGGLE_COARSE_HIT } from './RuleSettingsRow';
import type { RuleSettingsGroup, RuleSettingsThreshold } from './types';

type RuleGroup = RuleSettingsGroup['group'];
type RuleSeverity = RuleSettingsGroup['rows'][number]['severity'];

export interface RuleSettingsGroupCardProps {
  /** `id` trong DOM — đích của liên kết cùng tên trên thanh điều hướng. */
  readonly sectionId: string;
  readonly group: RuleSettingsGroup;
  readonly canEdit: boolean;
  readonly isCollapsed: boolean;
  /** Câu của luật theo mã, để hàng có `supersededBy` nói rõ nó bị luật nào thay thế. */
  readonly sentenceByCode: ReadonlyMap<RuleCode, string>;
  readonly onToggleGroup: (group: RuleGroup, enabled: boolean) => void;
  readonly onToggleRule: (code: RuleCode, enabled: boolean) => void;
  readonly onChangeSeverity: (code: RuleCode, severity: RuleSeverity) => void;
  readonly onChangeThreshold: (code: RuleCode, key: string, value: number) => void;
}

/** Một nhóm luật: tên, mô tả, toggle tổng, rồi từng luật con. */
export function RuleSettingsGroupCard({
  sectionId,
  group,
  canEdit,
  isCollapsed,
  sentenceByCode,
  onToggleGroup,
  onToggleRule,
  onChangeSeverity,
  onChangeThreshold,
}: RuleSettingsGroupCardProps) {
  return (
    // MỘT khung cho mỗi nhóm (NGUYEN-TAC-BO-CUC §2): tên nhóm + công tắc tổng ở đầu khung.
    <Section
      id={sectionId}
      tabIndex={-1}
      aria-label={group.label}
      className="scroll-mt-4"
      title={group.label}
      actions={
        <Toggle
          className={TOGGLE_COARSE_HIT}
          aria-describedby={canEdit ? undefined : READ_ONLY_REASON_ID}
          aria-label={`Bật hoặc tắt cả nhóm: ${lowerFirst(group.label)}`}
          checked={group.enabled}
          isReadOnly={!canEdit}
          onChange={(checked) => {
            onToggleGroup(group.group, checked);
          }}
        />
      }
    >
      <p className="mb-2 text-sm text-text-secondary">{group.description}</p>
      <div className="flex flex-col">
        {group.rows.map((row) => (
          <RuleSettingsRuleRow
            key={row.code}
            row={row}
            canEdit={canEdit}
            isCollapsed={isCollapsed}
            supersededByLabel={row.supersededBy === null ? null : sentenceByCode.get(row.supersededBy) ?? null}
            onToggleRule={onToggleRule}
            onChangeSeverity={onChangeSeverity}
            onChangeThreshold={onChangeThreshold}
          />
        ))}
      </div>
    </Section>
  );
}

export interface RuleSettingsGeneralThresholdsCardProps {
  /** `id` trong DOM — đích của liên kết "ngưỡng chung" trên thanh điều hướng. */
  readonly sectionId: string;
  readonly thresholds: readonly RuleSettingsThreshold[];
  readonly canEdit: boolean;
  readonly onChangeGeneralThreshold: (key: string, value: number) => void;
}

/**
 * Thẻ "Ngưỡng chung" — dung sai hình học dùng chung cho nhiều luật, không
 * gồm "độ tin cậy tối thiểu để tự duyệt" hay Toggle "cho phép AI ghi đè": hai
 * thứ đó không có trong viewmodel (quyết định D5 của hợp đồng).
 */
export function RuleSettingsGeneralThresholdsCard({
  sectionId,
  thresholds,
  canEdit,
  onChangeGeneralThreshold,
}: RuleSettingsGeneralThresholdsCardProps) {
  return (
    <Section id={sectionId} tabIndex={-1} aria-label="Ngưỡng chung" className="scroll-mt-4" title="Ngưỡng chung">
      <p className="mb-4 text-sm text-text-secondary">
        Dung sai hình học dùng chung cho nhiều luật trong bộ này.
      </p>

      {thresholds.length === 0 ? (
        <p className="text-sm text-text-secondary">Chưa có ngưỡng chung nào để chỉnh.</p>
      ) : (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          {thresholds.map((threshold) => (
            <NumericField
              key={threshold.key}
              label={threshold.label}
              unit={threshold.unit}
              value={threshold.value}
              min={threshold.min}
              max={threshold.max}
              step={threshold.step}
              error={threshold.error}
              isReadOnly={!canEdit}
              onChange={(value) => {
                if (value !== undefined) {
                  onChangeGeneralThreshold(threshold.key, value);
                }
              }}
            />
          ))}
        </div>
      )}
    </Section>
  );
}
