/**
 * R10 làn S: bảng diện tích phòng trong 3D là nơi người dùng đọc số nhiều nhất, và trước đợt này nó
 * không hề đọc trạng thái tỷ lệ — kể cả nút "Sao chép bảng" dán ra Excel.
 */
import { describe, expect, it } from 'vitest';

import { normalizeSpatial } from '@/domain/spatial/normalize';
import { SAMPLE_BUILDING } from '@/domain/spatial/__fixtures__/sampleBuilding';

import { computeArea } from '@/domain/rooms/area';
import { millimetres } from '@/domain/units/types';

import { buildGroups, graphOf, tableAsText } from './useRoomAreaPanel.model';

const spatial = normalizeSpatial(SAMPLE_BUILDING);
const entries = SAMPLE_BUILDING.rooms.map((room) => ({
  room,
  areaM2: computeArea(room.outline.map((point) => ({ x: millimetres(point.x), y: millimetres(point.y) }))),
}));
const firstLevelId = String(SAMPLE_BUILDING.levels[0]?.id);

const groupsWith = (states: Readonly<Record<string, 'estimated' | 'measured'>>) =>
  buildGroups(entries, 'level', 'area', graphOf(spatial, states));

describe('bảng diện tích 3D theo trạng thái tỷ lệ', () => {
  it('không biết trạng thái tầng nào thì mọi số để trần', () => {
    const rows = groupsWith({}).flatMap((group) => group.rows);

    expect(rows.length).toBeGreaterThan(0);
    expect(rows.every((row) => !row.areaText.includes('≈'))).toBe(true);
  });

  it('chỉ phòng của tầng ước lượng mới mang dấu, phòng tầng khác không bị gán oan', () => {
    const groups = groupsWith({ [firstLevelId]: 'estimated' });
    const rows = groups.flatMap((group) => group.rows);
    const onFirst = rows.filter((row) => String(row.levelId) === firstLevelId);
    const others = rows.filter((row) => String(row.levelId) !== firstLevelId);

    expect(onFirst.length).toBeGreaterThan(0);
    expect(others.length).toBeGreaterThan(0);
    expect(onFirst.every((row) => row.areaText.includes('(ước lượng)'))).toBe(true);
    expect(others.every((row) => !row.areaText.includes('(ước lượng)'))).toBe(true);
  });

  it('chu vi cũng là số suy từ tỷ lệ nên cũng phải mang dấu', () => {
    const rows = groupsWith({ [firstLevelId]: 'estimated' }).flatMap((group) => group.rows);
    const onFirst = rows.filter((row) => String(row.levelId) === firstLevelId);

    expect(onFirst.every((row) => row.perimeterText.includes('(ước lượng)'))).toBe(true);
  });

  it('"Sao chép bảng" dán ra ngoài ứng dụng cũng mang dấu, vì nó chép đúng chữ trên màn', () => {
    const groups = groupsWith({ [firstLevelId]: 'estimated' });
    const text = tableAsText(groups, { caption: 'Tổng diện tích sàn', totalM2: 248.6, totalText: '248,60', unitLabel: 'm²' });

    expect(text).toContain('(ước lượng)');
  });
});
