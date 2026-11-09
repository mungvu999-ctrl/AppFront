import { afterEach, describe, expect, it } from 'vitest';

import type { Furniture, Room, SpatialGraph } from '@/domain/spatial/types';
import { dressingOf } from '@/lib/pascal/sceneDressingRules';
import { sceneStyleOf } from '@/lib/pascal/sceneStyles';

import { applyBuildx, buildxFlagsOf, setBuildxFlags, TRIM_CROWN, windowDivisions } from './buildx';

const META = { confidence: 1, source: 'human', reviewed: true } as const;
const room: Room = {
  ...META,
  id: 'R-liv' as Room['id'],
  levelId: 'L-1' as Room['levelId'],
  name: 'liv',
  usage: 'livingRoom',
  outline: [
    { x: 0, y: 0 },
    { x: 5000, y: 0 },
    { x: 5000, y: 4000 },
    { x: 0, y: 4000 },
  ],
  areaM2: 20,
  wallIds: [],
} as Room;
const sofa = {
  ...META,
  id: 'F-sofa',
  levelId: 'L-1',
  roomId: 'R-liv',
  kind: 'chair',
  variant: 'sofa',
  centre: { x: 2500, y: 550 },
  boundingBox: { min: { x: 1500, y: 100 }, max: { x: 3500, y: 1000 } },
  rotationDeg: 0,
} as unknown as Furniture;
const graph = {
  building: { ...META, name: 'b', datumElevationMm: 0 },
  levels: [{ ...META, id: 'L-1', name: 'T1', order: 0, elevationMm: 0, heightMm: 3000 }],
  walls: [],
  openings: [],
  furniture: [sofa],
  rooms: [room],
  axes: [],
  dimensions: [],
  notes: [],
} as unknown as SpatialGraph;
const ids = (): string[] => dressingOf(graph, sceneStyleOf(undefined)).map((f) => f.id);

afterEach(() => setBuildxFlags([]));

describe('buildx (M5 làn 3c)', () => {
  it('đọc cờ từ ?buildx=, bỏ tên lạ', () => {
    expect([...buildxFlagsOf('?buildx=trim,win,xyz')]).toEqual(['trim', 'win']);
    expect(buildxFlagsOf('?glass=sheet').size).toBe(0);
  });

  it('đố cửa sổ theo bề rộng, ô lật trên khi cao ≥ 1,3 m', () => {
    expect(windowDivisions(1.4, 1.4)).toEqual({ columnRatios: [0.5, 0.5], rowRatios: [0.3, 0.7] });
    expect(windowDivisions(0.6, 1.0)).toEqual({ columnRatios: [1], rowRatios: [1] });
  });

  it('không cờ: không đổi node; trim/win chỉ đổi tường có phào và cửa sổ cố định', () => {
    const wall = { type: 'wall', crown: { enabled: true, sides: 'interior', height: 0.05 }, skirting: { enabled: true, height: 0.1 } };
    const win = { type: 'window', windowType: 'fixed', openingKind: 'window', width: 2.1, height: 1.5 };
    const slide = { type: 'window', windowType: 'sliding', width: 2.1, height: 1.5 };
    const nodes: Record<string, { type: string; [k: string]: unknown }> = { w: wall, o: win, s: slide };
    applyBuildx(nodes);
    expect(nodes.w).toBe(wall);
    setBuildxFlags(['trim', 'win']);
    applyBuildx(nodes);
    expect(nodes.w).toMatchObject({ crown: { sides: 'interior', ...TRIM_CROWN } });
    expect(nodes.o).toMatchObject({ columnRatios: [1 / 3, 1 / 3, 1 / 3], rowRatios: [0.3, 0.7] });
    expect(nodes.s).toBe(slide);
  });

  it('dense: thêm đèn sàn + cây đúng id, chạy lại ra y hệt; minimal: chỉ thảm/rèm', () => {
    const base = ids();
    setBuildxFlags(['dense']);
    const dense = ids();
    expect(dense).toEqual(expect.arrayContaining([...base, 'DRESS-floorLamp-F-sofa', 'DRESS-plantx-R-liv']));
    expect(ids()).toEqual(dense);
    setBuildxFlags(['minimal']);
    expect(ids().every((id) => /^DRESS-(rug|curtain)-/.test(id))).toBe(true);
  });
});
