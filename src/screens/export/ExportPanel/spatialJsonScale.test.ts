/**
 * R10 làn S: tệp JSON xuất ra phải mang trạng thái tỷ lệ của từng tầng.
 *
 * Trước đây tệp có `scaleMillimetresPerPixel` và `areaM2` nhưng không có chỗ nào nói tỷ lệ là máy
 * đo hay máy ước, nên người nhận tệp đọc 29,57 m² như một con số chắc.
 */
import { describe, expect, it } from 'vitest';

import { normalizeSpatial } from '@/domain/spatial/normalize';

import { SAMPLE_BUILDING } from '@/domain/spatial/__fixtures__/sampleBuilding';
import { toSpatialJson } from './exportPanelGateway';

const levelsOfJson = (text: string): readonly Record<string, unknown>[] =>
  (JSON.parse(text) as { levels: Record<string, unknown>[] }).levels;

describe('toSpatialJson mang trạng thái tỷ lệ', () => {
  const graph = normalizeSpatial(SAMPLE_BUILDING);
  const firstLevelId = String(SAMPLE_BUILDING.levels[0]?.id);

  it('không truyền trạng thái thì tệp giữ nguyên hình dạng cũ', () => {
    const levels = levelsOfJson(toSpatialJson(graph, true));

    expect(levels.length).toBeGreaterThan(0);
    expect(levels[0]).not.toHaveProperty('scaleState');
  });

  it('tầng tỷ lệ ước lượng: tệp nói rõ trạng thái, lý do và là số chưa tin được', () => {
    const levels = levelsOfJson(
      toSpatialJson(graph, true, {
        [firstLevelId]: { scaleState: 'estimated', scaleReasons: ['door'], isTrusted: false },
      }),
    );
    const marked = levels.find((level) => String(level['id']) === firstLevelId);

    expect(marked?.['scaleState']).toBe('estimated');
    expect(marked?.['scaleReasons']).toEqual(['door']);
    expect(marked?.['isTrusted']).toBe(false);
  });

  it('chỉ tầng được nêu mới mang trạng thái, tầng khác không bị gán oan', () => {
    const levels = levelsOfJson(
      toSpatialJson(graph, true, {
        [firstLevelId]: { scaleState: 'estimated', isTrusted: false },
      }),
    );
    const others = levels.filter((level) => String(level['id']) !== firstLevelId);

    expect(others.length).toBeGreaterThan(0);
    expect(others.every((level) => !('scaleState' in level))).toBe(true);
  });

  it('bỏ độ tin cậy vẫn giữ trạng thái tỷ lệ — hai lựa chọn độc lập', () => {
    const levels = levelsOfJson(
      toSpatialJson(graph, false, {
        [firstLevelId]: { scaleState: 'unresolved', isTrusted: false },
      }),
    );
    const marked = levels.find((level) => String(level['id']) === firstLevelId);

    expect(marked?.['scaleState']).toBe('unresolved');
    expect(marked).not.toHaveProperty('confidence');
  });
});
