import { beforeEach, describe, expect, it } from 'vitest';

import { createSampleBuilding, sampleLevelId } from '../domain/spatial/__fixtures__/sampleBuilding';
import { normalizeSpatial } from '../domain/spatial/normalize';
import { CH04, storedSuggestionsOf } from '../lib/suggestions/__fixtures__/golden';
import { changedEntry, enabledEntry, receivedEntry, suggestionBodyOf } from '../lib/suggestions/state';
import { applyFloorLayerRead } from './commit';
import { useStore } from './index';
import { useSuggestionStore } from './suggestionStore';

/** M2 — "Tải lại tầng" / làm tươi (U14) thay cả lớp đề xuất: cờ bẩn của bản bỏ đi không được gửi lại. */

const floorId = sampleLevelId(0);
const STORED = storedSuggestionsOf(CH04);
const META = { ruleset: '2026.11-1', rulesetSha: CH04.rulesetSha, basisRevision: 1 };

const layer = () => {
  const graph = createSampleBuilding();
  const walls = graph.walls.filter((wall) => wall.levelId === floorId);
  const wallIds = new Set<string>(walls.map((wall) => wall.id));
  return {
    furniture: graph.furniture.filter((item) => item.levelId === floorId),
    openings: graph.openings.filter((opening) => wallIds.has(opening.wallId)),
    rooms: graph.rooms.filter((room) => room.levelId === floorId),
    walls,
  };
};

describe('applyFloorLayerRead + lớp đề xuất (M2)', () => {
  beforeEach(() => {
    useStore.temporal.getState().clear();
    useStore.setState({ spatial: normalizeSpatial(createSampleBuilding()), versionId: 'v1', floorMeta: {}, serverReplaceSeq: 0 });
  });

  it('reloadFloor__clears_dirty_and_takes_server_suggestions', () => {
    const base = receivedEntry(undefined, { suggestions: STORED, meta: META, enabled: true }, true)!;
    const dirty = enabledEntry(changedEntry(base, STORED[0]!.id, 'disabled')!, false);
    useSuggestionStore.getState().putFloorSuggestions(floorId, dirty);
    expect(suggestionBodyOf(useSuggestionStore.getState().floorSuggestions[floorId])).not.toBeNull();

    applyFloorLayerRead(floorId, { layer: layer(), revision: 9, suggestions: STORED.slice(1), suggestionsMeta: META, suggestionsEnabled: true });

    const entry = useSuggestionStore.getState().floorSuggestions[floorId]!;
    expect(entry.suggestions).toHaveLength(STORED.length - 1);
    expect(entry.dirty).toBeUndefined();
    expect(entry.enabledChanged).toBeUndefined();
    expect(entry.enabled).toBe(true);
    expect(suggestionBodyOf(entry)).toBeNull();
  });
});
