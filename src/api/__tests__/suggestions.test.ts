/** @vitest-environment node */
import { describe, expect, it, vi } from 'vitest';

import type { HttpClient, HttpError, Result } from '@/lib/http';
import { CH04, storedSuggestionsOf } from '@/lib/suggestions/__fixtures__/golden';
import { DEFAULT_RULESET } from '@/lib/suggestions/ruleset';

import { __resetMockLayerState, createMockApiClient, seedMockSuggestions } from '../__mocks__/client';
import { createApiClient } from '../client';
import { FloorLayerWriteBodySchema, FloorLayerWriteResultSchema } from '../schemas/spatialLayer';
import { SuggestionSchema, effectiveParams, isEffectiveSuggestion } from '../schemas/suggestions';

const notFound: HttpError = { kind: 'http', status: 404, code: 'NOT_FOUND', requestId: 'r', retryable: false, raw: null };

function makeClient(reply: Result<unknown, HttpError>) {
  const call = vi.fn(async () => reply as Result<never, HttpError>);
  const http: HttpClient = {
    delete: call,
    events: { emit: () => undefined, on: () => () => undefined },
    get: call,
    getRecentRequests: () => [],
    patch: call,
    post: call,
    put: call,
  };
  return { call, client: createApiClient(http) };
}

const META = { ruleset: '2026.11-1', rulesetSha: CH04.rulesetSha, basisRevision: 1 };

describe('M2 lớp đề xuất — schema và client', () => {
  it('GET /api/suggestion-rules: 404 (máy chủ chưa có) → null; bảng đúng → giải mã', async () => {
    expect(await makeClient({ ok: false, error: notFound }).client.suggestionRules?.read()).toEqual({ ok: true, data: null });
    const wire = {
      ruleset: DEFAULT_RULESET.ruleset,
      rulesetSha: CH04.rulesetSha,
      rules: Object.entries(DEFAULT_RULESET.rules).map(([id, spec]) => ({ id, version: spec.version, majorSince: spec.majorSince ?? 1, kind: spec.kind, nameVi: spec.nameVi, editor: spec.editor, params: spec.params, overridable: spec.overridable })),
    };
    const { call, client } = makeClient({ ok: true, data: wire });
    const result = await client.suggestionRules?.read();
    expect(result?.ok && result.data?.rulesetSha).toBe(CH04.rulesetSha);
    expect(result?.ok && result.data?.rules.R1?.nameVi).toBe('Len chân tường');
    expect(call.mock.calls[0]).toEqual(['/suggestion-rules', undefined]);
  });

  it('bản ghi ca vàng qua schema; override ngoài params bị chặn; adoptedAs chỉ đi với adopted', () => {
    const stored = storedSuggestionsOf(CH04);
    expect(stored.length).toBeGreaterThan(40);
    const skirting = stored.find((s) => s.kind === 'skirting')!;
    expect(SuggestionSchema.safeParse({ ...skirting, state: 'overridden', override: { heightMm: 120 } }).success).toBe(true);
    expect(SuggestionSchema.safeParse({ ...skirting, override: { modelId: 'x' } }).success).toBe(false);
    expect(SuggestionSchema.safeParse({ ...skirting, adoptedAs: 'F-1' }).success).toBe(false);
    expect(effectiveParams({ ...skirting, override: { heightMm: 120 } }).heightMm).toBe(120);
    expect(isEffectiveSuggestion({ state: 'disabled' })).toBe(false);
    expect(isEffectiveSuggestion({ state: 'active', stale: { since: 2, reasonVi: 'x' } })).toBe(false);
  });

  it('effectiveParams__invalid_override_dropped: override sai kiểu/miền bị bỏ, giữ params, không ra NaN', () => {
    const skirting = storedSuggestionsOf(CH04).find((s) => s.kind === 'skirting')!;
    for (const bad of [-5, 0, 'cao']) {
      const p = effectiveParams({ ...skirting, state: 'overridden', override: { heightMm: bad } });
      expect(p.heightMm).toBe(skirting.params.heightMm);
      expect(Number.isFinite(p.heightMm)).toBe(true);
    }
    expect(effectiveParams({ ...skirting, state: 'overridden', override: { heightMm: 100, thicknessMm: -1 } }).heightMm).toBe(skirting.params.heightMm);
  });

  it('thân #35 chỉ mang suggestionState / suggestionsEnabled là hợp lệ; kết quả ghi nhận suggestions', () => {
    expect(FloorLayerWriteBodySchema.safeParse({ suggestionState: [] }).success).toBe(true);
    expect(FloorLayerWriteBodySchema.safeParse({ suggestionsEnabled: false }).success).toBe(true);
    expect(FloorLayerWriteBodySchema.safeParse({ refreshSuggestions: true }).success).toBe(false);
    expect(FloorLayerWriteBodySchema.safeParse({}).success).toBe(false);
    const parsed = FloorLayerWriteResultSchema.parse({ layer: CH04.layer, revision: 2, suggestions: storedSuggestionsOf(CH04), suggestionsMeta: META });
    expect(parsed.suggestions?.length).toBe(CH04.drafts.length + CH04.serverDrafts.length);
  });

  it('mock: N16 trả lớp đã nạp, #35 áp trạng thái thưa, id lạ → 422', async () => {
    __resetMockLayerState();
    const client = createMockApiClient();
    const floorId = 'L-01';
    const stored = storedSuggestionsOf(CH04);
    seedMockSuggestions(floorId, stored, META);
    const read = await client.spatial.readLayer({ floorId, projectId: 'project-1' });
    expect(read.ok && read.data.suggestions?.length).toBe(stored.length);
    expect(read.ok && read.data.suggestionsEnabled).toBe(true);
    const target = stored[0]!.id;
    const write = await client.spatial.writeLayer({
      baseVersion: 0,
      body: { suggestionState: [{ id: target, state: 'disabled' }] },
      floorId,
      projectId: 'project-1',
    });
    expect(write.ok && write.data.suggestions?.find((s) => s.id === target)?.state).toBe('disabled');
    const bad = await client.spatial.writeLayer({
      baseVersion: 1,
      body: { suggestionState: [{ id: 'DRESS-X-nope', state: 'disabled' }] },
      floorId,
      projectId: 'project-1',
    });
    expect(bad.ok).toBe(false);
    __resetMockLayerState();
  });
});
