import { z } from 'zod';

import { SUGGESTION_KINDS, type SuggestionKind } from './suggestions';

/**
 * `GET /api/v1/suggestion-rules` (ETag = `rulesetSha`): bảng tham số luật dùng chung, đúng hình
 * AppBack `packages/domain/suggestions/rule_params.json` (hợp đồng M2 §5). `rulesetSha` máy chủ tính
 * trên JSON chuẩn hoá; thân có thể mang nó, không thì lấy từ ETag hoặc để trống.
 */

const kindSchema = z.custom<SuggestionKind>((value) => typeof value === 'string' && (SUGGESTION_KINDS as readonly string[]).includes(value));

export const SuggestionRuleSpecSchema = z
  .object({
    version: z.number().int().min(1),
    majorSince: z.number().int().min(1).optional(),
    kind: kindSchema,
    nameVi: z.string().min(1),
    editor: z.enum(['render', 'mirror', 'list']),
    params: z.record(z.unknown()),
    overridable: z.array(z.string().regex(/^[a-z][A-Za-z0-9]{0,39}$/)),
    migrate: z.record(z.string()).optional(),
  })
  .strict();

export type SuggestionRuleSpec = z.infer<typeof SuggestionRuleSpecSchema>;

export const SuggestionRulesetSchema = z
  .object({
    ruleset: z.string().min(1),
    rulesetSha: z.string().regex(/^[0-9a-f]{64}$/).optional(),
    rules: z.record(z.string().regex(/^[A-Z][A-Z0-9]{0,5}$/), SuggestionRuleSpecSchema),
  })
  .strict();

export type SuggestionRuleset = z.infer<typeof SuggestionRulesetSchema>;
