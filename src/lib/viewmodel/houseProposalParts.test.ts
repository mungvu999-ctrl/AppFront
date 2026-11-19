import { describe, expect, it } from 'vitest';

import { applyPatch } from '@/domain/spatial/applyPatch';
import { normalizeSpatial } from '@/domain/spatial/normalize';
import type { Level, LevelId, SpatialGraph } from '@/domain/spatial/types';
import {
  createReorderLevelsCommand,
  isElevationOverridden,
  overriddenLevelIds,
} from '@/lib/commands/business/roomFloorCommands';
import { commandToPatches } from '@/lib/commands/invert';
import type { CommandContext } from '@/lib/commands/business/shared';

import { isOverridden, restackWithHeights } from './houseProposalParts';

const APPROVED = { confidence: 1, source: 'human', reviewed: true } as const;
const IDS = ['L-PINA0000001', 'L-PINA0000002', 'L-PINA0000003', 'L-PINA0000004'] as LevelId[];

const levelsOf = (stack: ReadonlyArray<readonly [number, number]>): Level[] =>
  stack.map(([elevationMm, heightMm], order) => ({
    ...APPROVED,
    id: IDS[order]!,
    name: `Tầng ${order + 1}`,
    order,
    elevationMm,
    heightMm,
  }));

const contextOf = (levels: Level[]): CommandContext => {
  const graph: SpatialGraph = {
    building: { ...APPROVED, name: 'Ghim xếp chồng', datumElevationMm: 0, grossFloorAreaM2: 100 },
    levels,
    walls: [],
    openings: [],
    furniture: [],
    rooms: [],
    axes: [],
    dimensions: [],
    notes: [],
  };
  return { graph: normalizeSpatial(graph), actorId: 'U-PIN', id: 'C-PIN00001', timestamp: '2026-11-19T09:00:00+07:00' };
};

/** Đúng các bước của `floorManagerGateway` khi đổi chiều cao: đổi, rồi restack với tầng Ghi đè đọc TRƯỚC khi đổi. */
function screenElevations(levels: Level[], index: number, heightMm: number): number[] {
  const before = contextOf(levels);
  const changed = levels.map((level, i) => (i === index ? { ...level, heightMm } : level));
  const after = contextOf(changed);
  const reorder = createReorderLevelsCommand(
    { levelIds: changed.map((level) => level.id), keptElevationIds: overriddenLevelIds(before) },
    after,
  );
  const graph = reorder.ok ? applyPatch(after.graph, commandToPatches(reorder.data)) : after.graph;
  return changed.map((level) => (graph.byId[level.id] as Level).elevationMm);
}

const CASES: Array<{ name: string; stack: Array<[number, number]>; index: number; heightMm: number }> = [
  { name: 'chồng khít, giảm T1', stack: [[0, 3600], [3600, 3600], [7200, 3600]], index: 0, heightMm: 3300 },
  { name: 'T3 Ghi đè, giảm T1', stack: [[0, 3600], [3600, 3600], [8000, 3600], [11600, 3000]], index: 0, heightMm: 3300 },
  { name: 'T3 Ghi đè bị đẩy khi tăng T2', stack: [[0, 3600], [3600, 3600], [8000, 3600], [11600, 3000]], index: 1, heightMm: 5000 },
  { name: 'tầng hầm dưới mốc, tăng hầm', stack: [[-3000, 3000], [0, 3900], [3900, 3600]], index: 0, heightMm: 3300 },
  { name: 'đổi tầng trên cùng', stack: [[0, 3600], [3600, 3600]], index: 1, heightMm: 3000 },
];

describe('restackWithHeights ghim vào lệnh thật của màn', () => {
  it.each(CASES)('$name', ({ stack, index, heightMm }) => {
    const levels = levelsOf(stack);
    const floors = levels.map(({ id, elevationMm, heightMm: h }) => ({ id, elevationMm, heightMm: h }));
    expect(restackWithHeights(floors, new Map([[levels[index]!.id, heightMm]]))).toEqual(
      screenElevations(levels, index, heightMm),
    );
  });

  it('cờ Ghi đè trùng `isElevationOverridden`', () => {
    const levels = levelsOf([[0, 3600], [3600, 3600], [8000, 3600]]);
    levels.forEach((level, i) => expect(isOverridden(level, levels[i - 1])).toBe(isElevationOverridden(level, levels[i - 1])));
  });
});
