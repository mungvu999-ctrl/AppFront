/** @vitest-environment node */
import { afterEach, describe, expect, it } from 'vitest';

import { CH04, storedSuggestionsOf } from '@/lib/suggestions/__fixtures__/golden';

import { useStore } from '../index';

/** M2 — lớp đề xuất trong kho: bật/tắt đánh dấu bẩn; bản máy chủ chỉ thay bản bẩn khi chính lượt đó đã gửi nó. */

const FLOOR = 'L-01M6GEZPRRGMBWR8D13KAF6YE6';
const STORED = storedSuggestionsOf(CH04);
const META = { ruleset: '2026.11-1', rulesetSha: CH04.rulesetSha, basisRevision: 1 };

afterEach(() => {
  useStore.getState().receiveFloorSuggestions(FLOOR, { suggestions: [] }, true);
});

describe('floorSuggestions (M2)', () => {
  it('đổi trạng thái đánh dấu bẩn; id lạ không đổi gì; bật/tắt lớp đặt cờ enabledChanged', () => {
    useStore.getState().receiveFloorSuggestions(FLOOR, { suggestions: STORED, meta: META, enabled: true }, true);
    useStore.getState().changeSuggestionState(FLOOR, STORED[0]!.id, 'disabled');
    expect(useStore.getState().floorSuggestions[FLOOR]).toMatchObject({ dirty: true });
    const before = useStore.getState().floorSuggestions;
    useStore.getState().changeSuggestionState(FLOOR, 'DRESS-X-nope', 'disabled');
    expect(useStore.getState().floorSuggestions).toBe(before);
    useStore.getState().setSuggestionsEnabled(FLOOR, false);
    expect(useStore.getState().floorSuggestions[FLOOR]).toMatchObject({ enabledChanged: true });
    expect(useStore.getState().floorSuggestions[FLOOR]?.enabled).toBeUndefined();
  });

  it('bản máy chủ về sau lượt gửi xoá cờ bẩn; bản về khi chưa gửi không đè sửa đang chờ', () => {
    useStore.getState().receiveFloorSuggestions(FLOOR, { suggestions: STORED, meta: META, enabled: true }, true);
    useStore.getState().changeSuggestionState(FLOOR, STORED[0]!.id, 'disabled');
    useStore.getState().receiveFloorSuggestions(FLOOR, { suggestions: STORED, meta: META });
    expect(useStore.getState().floorSuggestions[FLOOR]?.suggestions[0]?.state).toBe('disabled');
    useStore.getState().receiveFloorSuggestions(FLOOR, { suggestions: STORED, meta: META, enabled: true }, true);
    expect(useStore.getState().floorSuggestions[FLOOR]?.dirty).toBeUndefined();
  });
});
