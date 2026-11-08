/**
 * M2 — bảng luật của lớp đề xuất. Nguồn thật là `GET /suggestion-rules` (AppBack `rule_params.json`);
 * `defaultRuleset.json` là bản chép gói kèm, dùng khi máy chủ chưa có endpoint (404) và cho các hằng
 * cần đồng bộ lúc dựng (len chân tường `INTERIOR_SKIRTING`). Chép lại khi bảng AppBack đổi:
 * `suggestionMirror.test.ts` so `rulesetSha` của bản chép với ca vàng của AppBack.
 */

import { SuggestionRulesetSchema, type SuggestionRuleSpec, type SuggestionRuleset } from '@/api/schemas/suggestionRules';

import defaultRulesetJson from './defaultRuleset.json';

export const DEFAULT_RULESET: SuggestionRuleset = SuggestionRulesetSchema.parse(defaultRulesetJson);

/** Một luật của bảng; vắng thì `undefined` (bảng máy chủ mới hơn/cũ hơn FE). */
export const ruleOf = (ruleset: SuggestionRuleset, rule: string): SuggestionRuleSpec | undefined => ruleset.rules[rule];

/** Tên tiếng Việt của luật cho bảng "Lớp đề xuất"; luật lạ thì hiện mã. */
export const ruleNameVi = (ruleset: SuggestionRuleset, rule: string): string => ruleset.rules[rule]?.nameVi ?? `Luật ${rule}`;

const numberParam = (spec: SuggestionRuleSpec | undefined, key: string, fallback: number): number => {
  const value = spec?.params[key];
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
};

/** Cỡ len chân tường R1 (mm) — thống nhất FE với compiler (G1): 90 × 12 mm. */
export const SKIRTING_MM = {
  height: numberParam(DEFAULT_RULESET.rules.R1, 'heightMm', 90),
  thickness: numberParam(DEFAULT_RULESET.rules.R1, 'thicknessMm', 12),
} as const;
