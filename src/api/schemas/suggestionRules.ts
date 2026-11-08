import { z } from 'zod';

import { SUGGESTION_KINDS, type SuggestionKind } from './suggestions';

/**
 * Bảng tham số luật dùng chung (hợp đồng M2 §5). Hai hình:
 * - `SuggestionRulesetSchema`: tệp AppBack `rule_params.json` (luật là bản đồ theo mã) — bảng gói kèm của FE;
 * - `SuggestionRulesWireSchema`: thân `GET /api/suggestion-rules` (ETag = `rulesetSha`, luật là danh sách có `id`),
 *   đổi sang hình thứ nhất để nơi dùng chỉ biết một hình.
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

/** Thân `GET /api/suggestion-rules` (AppBack `SuggestionRulesOut`), đổi luật danh sách → bản đồ theo `id`. */
export const SuggestionRulesWireSchema = z
  .object({
    ruleset: z.string().min(1),
    rulesetSha: z.string().regex(/^[0-9a-f]{64}$/),
    rules: z.array(
      z
        .object({
          id: z.string().regex(/^[A-Z][A-Z0-9]{0,5}$/),
          version: z.number().int().min(1),
          majorSince: z.number().int().min(1),
          kind: kindSchema,
          nameVi: z.string().min(1),
          editor: z.enum(['render', 'mirror', 'list']),
          params: z.record(z.unknown()),
          overridable: z.array(z.string().regex(/^[a-z][A-Za-z0-9]{0,39}$/)),
        })
        .strict(),
    ),
  })
  .strict()
  .transform(
    ({ ruleset, rulesetSha, rules }): SuggestionRuleset => ({
      ruleset,
      rulesetSha,
      rules: Object.fromEntries(rules.map(({ id, ...spec }) => [id, spec])),
    }),
  );
