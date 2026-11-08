/** @vitest-environment node */
import { afterEach, describe, expect, it, vi } from 'vitest';

import { CH04, storedSuggestionsOf } from '@/lib/suggestions/__fixtures__/golden';
import { changedEntry, enabledEntry, receivedEntry, suggestionBodyOf, suggestionFloorsToSave, watchSuggestions } from '@/lib/suggestions/state';

import { useStore } from '../index';
import { useSuggestionStore } from '@/store/suggestionStore';

/** M2 — lớp đề xuất trong kho riêng (`lib/suggestions/store`): bật/tắt đánh dấu bẩn; bản máy chủ chỉ thay bản bẩn khi chính lượt đó đã gửi nó. */

const FLOOR = 'L-01M6GEZPRRGMBWR8D13KAF6YE6';
const STORED = storedSuggestionsOf(CH04);
const META = { ruleset: '2026.11-1', rulesetSha: CH04.rulesetSha, basisRevision: 1 };
const SERVER = { suggestions: STORED, meta: META, enabled: true as const };

afterEach(() => {
  useSuggestionStore.getState().putFloorSuggestions(FLOOR, { suggestions: [] });
});

describe('floorSuggestions (M2)', () => {
  it('đổi trạng thái đánh dấu bẩn; id lạ không đổi gì; bật/tắt lớp đặt cờ enabledChanged', () => {
    const base = receivedEntry(undefined, SERVER, true)!;
    const changed = changedEntry(base, STORED[0]!.id, 'disabled')!;
    expect(changed).toMatchObject({ dirty: true, enabled: true });
    expect(changedEntry(base, 'DRESS-X-nope', 'disabled')).toBeNull();
    const off = enabledEntry(changed, false);
    expect(off).toMatchObject({ enabledChanged: true, dirty: true });
    expect(off.enabled).toBeUndefined();
    expect(suggestionBodyOf(off)).toEqual({ suggestionState: [{ id: STORED[0]!.id, state: 'disabled' }], suggestionsEnabled: false });
    expect(suggestionBodyOf(base)).toBeNull();
    expect(suggestionFloorsToSave({ [FLOOR]: off }, { [FLOOR]: base })).toEqual([FLOOR]);
    expect(suggestionFloorsToSave({ [FLOOR]: base }, {})).toEqual([]);
  });

  it('bản máy chủ về sau lượt gửi xoá cờ bẩn; bản về khi chưa gửi không đè sửa đang chờ; kho chỉ thay mục', () => {
    const dirty = changedEntry(receivedEntry(undefined, SERVER, true)!, STORED[0]!.id, 'disabled')!;
    expect(receivedEntry(dirty, SERVER, false)).toBeNull();
    expect(receivedEntry(dirty, SERVER, true)?.dirty).toBeUndefined();
    useSuggestionStore.getState().putFloorSuggestions(FLOOR, dirty);
    expect(useSuggestionStore.getState().floorSuggestions[FLOOR]?.suggestions[0]?.state).toBe('disabled');
  });

  it('watchSuggestions: sửa lớp đề xuất của tầng báo tầng ấy cần lưu; bản máy chủ thì không', () => {
    const onTouched = vi.fn();
    const stop = watchSuggestions(useStore, useSuggestionStore, onTouched);
    useSuggestionStore.getState().putFloorSuggestions(FLOOR, receivedEntry(undefined, SERVER, true)!);
    expect(onTouched).not.toHaveBeenCalled();
    useSuggestionStore.getState().putFloorSuggestions(FLOOR, enabledEntry(useSuggestionStore.getState().floorSuggestions[FLOOR], false));
    expect(onTouched).toHaveBeenCalledWith([FLOOR]);
    stop();
  });

  it('saver_recreated__dirty_suggestions_marked_for_save: kho đã bẩn trước khi dựng bộ lưu thì báo lưu tầng ấy', async () => {
    useSuggestionStore.getState().putFloorSuggestions(FLOOR, enabledEntry(receivedEntry(undefined, SERVER, true)!, false));
    const onTouched = vi.fn();
    const stop = watchSuggestions(useStore, useSuggestionStore, onTouched);
    await Promise.resolve();
    expect(onTouched).toHaveBeenCalledWith([FLOOR]);
    stop();
    const late = vi.fn();
    watchSuggestions(useStore, useSuggestionStore, late)();
    await Promise.resolve();
    expect(late).not.toHaveBeenCalled();
  });
});
