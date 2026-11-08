import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { FloorLayerSaver, FloorLayerSaverPorts } from '../lib/autosave/spatialLayerSave';
import { CH04, storedSuggestionsOf } from '../lib/suggestions/__fixtures__/golden';
import { useStore } from './index';
import { enabledEntry } from '../lib/suggestions/state';
import { useSuggestionStore } from './suggestionStore';
import { withSuggestions } from './suggestionSave';

const FLOOR = 'L-01M6GEZPRRGMBWR8D13KAF6YE6';
const STORED = storedSuggestionsOf(CH04);

const open = () => {
  let ports!: FloorLayerSaverPorts;
  const inner = { dispose: vi.fn() } as unknown as FloorLayerSaver;
  const hostOnSaved = vi.fn();
  withSuggestions((_id, p) => {
    ports = p;
    return inner;
  })('P1', { onSaved: hostOnSaved } as unknown as FloorLayerSaverPorts);
  return { ports, hostOnSaved };
};

describe('withSuggestions (M2)', () => {
  beforeEach(() => {
    useSuggestionStore.getState().putFloorSuggestions(FLOOR, { suggestions: [] });
  });

  it('onSaved__other_project_does_not_touch_suggestion_store', () => {
    const { ports, hostOnSaved } = open();
    const result = { layer: CH04.layer, revision: 2, suggestions: STORED } as never;
    useStore.setState({ spatialProjectId: 'P2' });
    ports.onSaved(FLOOR, result, { redirtied: false });
    expect(useSuggestionStore.getState().floorSuggestions[FLOOR]?.suggestions).toHaveLength(0);
    expect(hostOnSaved).toHaveBeenCalledOnce();

    useStore.setState({ spatialProjectId: 'P1' });
    ports.onSaved(FLOOR, result, { redirtied: false });
    expect(useSuggestionStore.getState().floorSuggestions[FLOOR]?.suggestions).toHaveLength(STORED.length);
  });
});

describe('withSuggestions — máy chủ trước M2', () => {
  it('save__server_without_m2_does_not_block_geometry: chưa thấy dấu hiệu M2 thì thân #35 không mang khoá lớp đề xuất', () => {
    const entry = enabledEntry({ suggestions: [] }, false);
    useSuggestionStore.getState().replaceFloorSuggestions({ [FLOOR]: entry });
    expect(open().ports.readSuggestionBody?.(FLOOR)).toBeNull();

    useSuggestionStore.getState().replaceFloorSuggestions({ [FLOOR]: { ...entry, meta: { ruleset: '2026.11-1', rulesetSha: CH04.rulesetSha, basisRevision: 1 } } });
    expect(open().ports.readSuggestionBody?.(FLOOR)).toEqual({ suggestionsEnabled: false });
  });
});
