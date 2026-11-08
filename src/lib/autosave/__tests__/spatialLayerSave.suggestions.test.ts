/** @vitest-environment node */
import { describe, expect, it, vi } from 'vitest';

import type { SpatialApi } from '@/api/client';
import { FloorLayerWriteSchema } from '@/api/schemas/spatialLayer';
import { CH04, storedSuggestionsOf } from '@/lib/suggestions/__fixtures__/golden';
import { sparseStateOf, withSuggestionState } from '@/lib/suggestions/state';
import type { Suggestion } from '@/api/schemas/suggestions';

import { createFloorLayerSaver } from '../spatialLayerSave';

/**
 * M2 — thân #35 mang `suggestionState` (trạng thái THƯA cả tầng) chỉ khi bẩn, và `refreshSuggestions` khi người
 * dùng bật/tắt lớp của tầng (`suggestionsEnabled`, hợp đồng M2 §4, §6). Kho giữ cờ bẩn (`store/__tests__/floorSuggestions.test.ts`);
 * saver chụp phần thân cùng lúc với lớp, qua cổng `readSuggestionBody` (ở đây đọc một bản ghi tại chỗ).
 */

const FLOOR = 'L-01M6GEZPRRGMBWR8D13KAF6YE6';
const STORED = storedSuggestionsOf(CH04);
const META = { ruleset: '2026.11-1', rulesetSha: CH04.rulesetSha, basisRevision: 1 };

let entry: { suggestions: readonly Suggestion[]; meta?: typeof META; dirty?: true; enabled?: true; enabledChanged?: true } | undefined;

const harness = () => {
  const writeLayer = vi.fn<SpatialApi['writeLayer']>().mockResolvedValue({ ok: true, data: { layer: CH04.layer, revision: 2 } });
  const saver = createFloorLayerSaver('project-1', {
    onSaved: vi.fn(),
    readLayer: () => CH04.layer,
    readRevision: () => 1,
    readSuggestionBody: (floorId) => {
      void floorId;
      if (entry === undefined || (entry.dirty !== true && entry.enabledChanged !== true)) return null;
      return {
        ...(entry.dirty === true ? { suggestionState: sparseStateOf(entry.suggestions) } : {}),
        ...(entry.enabledChanged === true ? { suggestionsEnabled: entry.enabled === true } : {}),
      };
    },
    writeLayer,
  });
  return { saver, writeLayer, body: (call = 0) => writeLayer.mock.calls[call]?.[0].body };
};

describe('spatialLayerSave — suggestionState (M2)', () => {
  it('trạng thái sạch → thân không mang suggestionState', async () => {
    entry = { suggestions: STORED, meta: META };
    const { saver, body } = harness();
    saver.markDirty([FLOOR]);
    await saver.flush();
    expect(body()).not.toHaveProperty('suggestionState');
    expect(body()).not.toHaveProperty('suggestionsEnabled');
  });

  it('tắt một món → thân mang đủ trạng thái thưa của tầng, sắp theo id, qua schema', async () => {
    const [a, b] = [STORED[3]!, STORED[0]!];
    const prior = withSuggestionState(STORED, a.id, 'disabled');
    entry = { suggestions: withSuggestionState(prior, b.id, 'disabled'), meta: META, dirty: true };

    const { saver, body } = harness();
    saver.markDirty([FLOOR]);
    await saver.flush();
    expect(body()?.suggestionState).toEqual([a.id, b.id].sort().map((id) => ({ id, state: 'disabled' })));
    expect(FloorLayerWriteSchema.safeParse({ baseVersion: 1, body: body() }).success).toBe(true);
  });

  it('bật lại hết → vẫn gửi (mảng rỗng = mọi bản về active); tắt cả lớp → suggestionsEnabled: false', async () => {
    entry = { suggestions: STORED, meta: META, dirty: true, enabledChanged: true };
    const { saver, body } = harness();
    saver.markDirty([FLOOR]);
    await saver.flush();
    expect(body()).toMatchObject({ suggestionState: [], suggestionsEnabled: false });
  });
});
