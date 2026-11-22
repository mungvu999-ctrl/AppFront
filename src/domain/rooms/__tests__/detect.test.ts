import { describe, expect, it } from 'vitest';

import { medianMs } from '@/lib/testing/timing';

import {
  SAMPLE_ROOM_COUNT,
  SAMPLE_WALL_COUNT,
} from '../../spatial/__fixtures__/sampleBuilding';
import type { WallId } from '../../spatial/types';
import type { PointMm } from '../../units/compare';
import { millimetres, squareMetres, type Millimetres } from '../../units/types';
import type { Wall, WallKind } from '../../walls/types';
import { buildWallGraph, DEFAULT_WELD_GAP_MM } from '../graph';
import { detectRooms, MIN_TRUSTED_ROOM_AREA_M2, totalRoomArea } from '../detect';

/* -------------------------------------------------------------------------- */
/* Fixtures.                                                                   */
/* -------------------------------------------------------------------------- */

const ENVELOPE_THICKNESS_MM: Millimetres = millimetres(220);
const PARTITION_THICKNESS_MM: Millimetres = millimetres(100);
const DEFAULT_THICKNESS_MM: Millimetres = millimetres(200);

function point(x: number, y: number): PointMm {
  return { x: millimetres(x), y: millimetres(y) };
}

interface WallOverrides {
  readonly kind?: WallKind;
  readonly thicknessMm?: Millimetres;
}

function makeWall(id: WallId, from: PointMm, to: PointMm, overrides: WallOverrides = {}): Wall {
  return {
    id,
    kind: overrides.kind ?? 'partition',
    centreline: { start: from, end: to },
    thicknessMm: overrides.thicknessMm ?? DEFAULT_THICKNESS_MM,
    baseElevationMm: millimetres(0),
    topElevationMm: millimetres(3000),
  };
}

/** Draws walls and numbers them, so a fixture never has to keep count by hand. */
type WallPen = (from: PointMm, to: PointMm, overrides?: WallOverrides) => Wall;

function createWallPen(): WallPen {
  let next = 0;
  return (from, to, overrides = {}) => {
    next += 1;
    return makeWall(`W-${String(next).padStart(4, '0')}`, from, to, overrides);
  };
}

/** A plain closed rectangle of four walls, given by its centrelines. */
function drawRectangle(
  pen: WallPen,
  widthMm: number,
  depthMm: number,
  thicknessMm: Millimetres = DEFAULT_THICKNESS_MM,
): readonly Wall[] {
  const corners = [point(0, 0), point(widthMm, 0), point(widthMm, depthMm), point(0, depthMm)];
  return corners.map((corner, index) =>
    pen(corner, corners[(index + 1) % corners.length] ?? corner, { thicknessMm }),
  );
}

/** The same rectangle when nothing else shares the numbering. */
function createRectangle(
  widthMm: number,
  depthMm: number,
  thicknessMm: Millimetres = DEFAULT_THICKNESS_MM,
): readonly Wall[] {
  return drawRectangle(createWallPen(), widthMm, depthMm, thicknessMm);
}

/* -------------------------------------------------------------------------- */
/* The standard sample plan: 48 walls, 14 rooms.                                */
/* -------------------------------------------------------------------------- */

/**
 * One storey laid out to the standard sample figures.
 *
 * Three bands of rooms either side of a full-width corridor make the fourteen
 * rooms; the five short piers hanging off the partitions bring the wall count to
 * forty-eight and bound nothing, which is the point of including them.
 */
const BAND_ONE_SPLITS_MM = [0, 3600, 7200, 10800, 14400, 18000];
const BAND_TWO_SPLITS_MM = [0, 3000, 6000, 9000, 12000, 15000, 18000];
const BAND_THREE_SPLITS_MM = [0, 8000, 18000];
const FLOOR_LEVELS_MM = { bottom: 0, corridorBottom: 4000, corridorTop: 5600, bandTop: 9600, top: 13000 };
const PLAN_WIDTH_MM = 18000;

/** Every x a wall crosses on the line between the upper two bands. */
const BAND_TOP_SPLITS_MM = [...new Set([...BAND_TWO_SPLITS_MM, ...BAND_THREE_SPLITS_MM])].sort(
  (first, second) => first - second,
);

function createSamplePlan(): readonly Wall[] {
  const wall = createWallPen();
  const walls: Wall[] = [];

  const runAlongX = (y: number, splits: readonly number[], thicknessMm: Millimetres): void => {
    for (let index = 1; index < splits.length; index += 1) {
      walls.push(wall(point(splits[index - 1] ?? 0, y), point(splits[index] ?? 0, y), { thicknessMm }));
    }
  };

  runAlongX(FLOOR_LEVELS_MM.bottom, BAND_ONE_SPLITS_MM, ENVELOPE_THICKNESS_MM);
  runAlongX(FLOOR_LEVELS_MM.corridorBottom, BAND_ONE_SPLITS_MM, PARTITION_THICKNESS_MM);
  runAlongX(FLOOR_LEVELS_MM.corridorTop, BAND_TWO_SPLITS_MM, PARTITION_THICKNESS_MM);
  runAlongX(FLOOR_LEVELS_MM.bandTop, BAND_TOP_SPLITS_MM, PARTITION_THICKNESS_MM);
  runAlongX(FLOOR_LEVELS_MM.top, BAND_THREE_SPLITS_MM, ENVELOPE_THICKNESS_MM);

  const storeys = [
    FLOOR_LEVELS_MM.bottom,
    FLOOR_LEVELS_MM.corridorBottom,
    FLOOR_LEVELS_MM.corridorTop,
    FLOOR_LEVELS_MM.bandTop,
    FLOOR_LEVELS_MM.top,
  ];
  for (const x of [0, PLAN_WIDTH_MM]) {
    for (let index = 1; index < storeys.length; index += 1) {
      walls.push(
        wall(point(x, storeys[index - 1] ?? 0), point(x, storeys[index] ?? 0), {
          thicknessMm: ENVELOPE_THICKNESS_MM,
          kind: 'loadBearing',
        }),
      );
    }
  }

  for (const x of BAND_ONE_SPLITS_MM.slice(1, -1)) {
    walls.push(
      wall(point(x, FLOOR_LEVELS_MM.bottom), point(x, FLOOR_LEVELS_MM.corridorBottom), {
        thicknessMm: PARTITION_THICKNESS_MM,
      }),
    );
  }
  for (const x of BAND_TWO_SPLITS_MM.slice(1, -1)) {
    walls.push(
      wall(point(x, FLOOR_LEVELS_MM.corridorTop), point(x, FLOOR_LEVELS_MM.bandTop), {
        thicknessMm: PARTITION_THICKNESS_MM,
      }),
    );
  }
  walls.push(
    wall(point(8000, FLOOR_LEVELS_MM.bandTop), point(8000, FLOOR_LEVELS_MM.top), {
      thicknessMm: PARTITION_THICKNESS_MM,
    }),
  );

  // Five piers: each hangs off the middle of a partition and closes nothing.
  const piers: readonly (readonly [PointMm, PointMm])[] = [
    [point(3600, 2000), point(4800, 2000)],
    [point(10800, 2500), point(9600, 2500)],
    [point(3000, 7600), point(4200, 7600)],
    [point(12000, 8000), point(10800, 8000)],
    [point(8000, 11000), point(9400, 11000)],
  ];
  for (const [from, to] of piers) {
    walls.push(wall(from, to, { thicknessMm: PARTITION_THICKNESS_MM }));
  }

  return walls;
}

const SAMPLE_PLAN = createSamplePlan();

/** Ids of the five piers, which are always the last walls the plan lists. */
const PIER_WALL_IDS: readonly WallId[] = SAMPLE_PLAN.slice(-5).map((piece) => piece.id);

/* -------------------------------------------------------------------------- */
/* Assertion helpers.                                                          */
/* -------------------------------------------------------------------------- */

/** Shoelace area of a closed outline, in square metres. */
function outlineAreaM2(outline: readonly PointMm[]): number {
  let total = 0;
  for (let index = 0; index < outline.length; index += 1) {
    const current = outline[index];
    const next = outline[(index + 1) % outline.length];
    if (current === undefined || next === undefined) {
      continue;
    }
    total += current.x * next.y - next.x * current.y;
  }
  return total / 2 / 1e6;
}

function boundingWidthMm(outline: readonly PointMm[]): number {
  const xs = outline.map((corner) => corner.x);
  return Math.max(...xs) - Math.min(...xs);
}

function boundingDepthMm(outline: readonly PointMm[]): number {
  const ys = outline.map((corner) => corner.y);
  return Math.max(...ys) - Math.min(...ys);
}

/* -------------------------------------------------------------------------- */
/* Tests.                                                                      */
/* -------------------------------------------------------------------------- */

describe('the standard sample plan', () => {
  it('is built from the standard wall count', () => {
    expect(SAMPLE_PLAN).toHaveLength(SAMPLE_WALL_COUNT);
  });

  it('finds the standard room count', () => {
    const { rooms } = detectRooms(SAMPLE_PLAN);

    expect(rooms).toHaveLength(SAMPLE_ROOM_COUNT);
  });

  it('trusts every room it finds there', () => {
    const { rooms } = detectRooms(SAMPLE_PLAN);

    expect(rooms.every((room) => room.trust === 'trusted')).toBe(true);
  });

  it('credits every room to the walls that bound it', () => {
    const { rooms } = detectRooms(SAMPLE_PLAN);

    for (const room of rooms) {
      expect(room.wallIds.length).toBeGreaterThanOrEqual(4);
      expect(new Set(room.wallIds).size).toBe(room.wallIds.length);
    }
  });

  it('reports the piers as dead ends rather than losing them', () => {
    const { graph } = detectRooms(SAMPLE_PLAN);

    expect(graph.deadEndWallIds).toEqual([...PIER_WALL_IDS].sort());
  });

  it('gives no pier a room to bound', () => {
    const { rooms } = detectRooms(SAMPLE_PLAN);
    const bounding = new Set(rooms.flatMap((room) => room.wallIds));

    for (const pierId of PIER_WALL_IDS) {
      expect(bounding.has(pierId)).toBe(false);
    }
  });

  it('welds nothing, because the plan has no holes', () => {
    const { graph } = detectRooms(SAMPLE_PLAN);

    expect(graph.weldedGaps).toEqual([]);
  });

  it('reads the same on a shuffled wall list', () => {
    const shuffled = [...SAMPLE_PLAN].reverse();
    const first = detectRooms(SAMPLE_PLAN).rooms;
    const second = detectRooms(shuffled).rooms;

    expect(second).toEqual(first);
  });

  it('leaves the walls it was given untouched', () => {
    const before = JSON.stringify(SAMPLE_PLAN);
    detectRooms(SAMPLE_PLAN);

    expect(JSON.stringify(SAMPLE_PLAN)).toBe(before);
  });

  it('prints the schedule the fourteen rooms measure out to', () => {
    const { rooms } = detectRooms(SAMPLE_PLAN);

    console.table(
      rooms.map((room, index) => ({
        room: index + 1,
        areaM2: Math.round(room.areaM2 * 100) / 100,
        corners: room.outline.length,
        walls: room.wallIds.length,
        trust: room.trust,
      })),
    );
    console.log(`total clear area: ${totalRoomArea(rooms).toFixed(2)} m²`);

    expect(rooms).toHaveLength(SAMPLE_ROOM_COUNT);
  });

  it('runs 48 walls well inside the 50 ms budget', () => {
    // Warm the code paths first, so the figure measures the algorithm rather
    // than the first-call compilation of it.
    detectRooms(SAMPLE_PLAN);

    // Median, not mean: one stall of the shared CI runner would otherwise be
    // spread over all ten runs.
    const perRunMs = medianMs(() => detectRooms(SAMPLE_PLAN), 10);

    console.log(`detectRooms over ${String(SAMPLE_WALL_COUNT)} walls: ${perRunMs.toFixed(2)} ms`);
    expect(perRunMs).toBeLessThan(50);
  });
});

describe('the face outside the building', () => {
  it('is not counted as a room', () => {
    const { rooms } = detectRooms(createRectangle(5000, 4000));

    expect(rooms).toHaveLength(1);
  });

  it('is dropped on a plan with many rooms too', () => {
    const { rooms, graph } = detectRooms(SAMPLE_PLAN);
    // Euler: a connected planar graph has `edges - vertices + 1` bounded faces,
    // and the walk traces every one of them plus the unbounded face. Finding
    // exactly the bounded count is what proves the outer one was discarded.
    const boundedFaceCount = graph.edges.length - graph.vertices.length + 1;

    expect(rooms).toHaveLength(boundedFaceCount);
  });

  it('leaves the total area below the footprint it encloses', () => {
    const { rooms } = detectRooms(SAMPLE_PLAN);
    const footprintM2 = (PLAN_WIDTH_MM * FLOOR_LEVELS_MM.top) / 1e6;

    expect(totalRoomArea(rooms)).toBeLessThan(footprintM2);
    expect(totalRoomArea(rooms)).toBeGreaterThan(footprintM2 * 0.8);
  });

  it('never hands back a clockwise outline', () => {
    const { rooms } = detectRooms(SAMPLE_PLAN);

    for (const room of rooms) {
      expect(outlineAreaM2(room.outline)).toBeGreaterThan(0);
      expect(outlineAreaM2(room.centrelineOutline)).toBeGreaterThan(0);
    }
  });
});

describe('measuring to the clear face', () => {
  it('takes half a wall off each side of the centrelines', () => {
    const { rooms } = detectRooms(createRectangle(5000, 4000, millimetres(200)));
    const room = rooms[0];

    expect(room).toBeDefined();
    expect(boundingWidthMm(room?.outline ?? [])).toBeCloseTo(4800, 6);
    expect(boundingDepthMm(room?.outline ?? [])).toBeCloseTo(3800, 6);
    expect(room?.areaM2).toBeCloseTo(18.24, 6);
  });

  it('keeps the centrelines separately, unshrunk', () => {
    const { rooms } = detectRooms(createRectangle(5000, 4000, millimetres(200)));
    const room = rooms[0];

    expect(boundingWidthMm(room?.centrelineOutline ?? [])).toBeCloseTo(5000, 6);
    expect(boundingDepthMm(room?.centrelineOutline ?? [])).toBeCloseTo(4000, 6);
  });

  it('takes each side back by the wall that actually drew it', () => {
    const wall = createWallPen();
    // A thick south wall and three thin ones: the room loses 150 mm at the
    // bottom and 50 mm at the top, so it is not simply the centrelines scaled.
    const walls = [
      wall(point(0, 0), point(4000, 0), { thicknessMm: millimetres(300) }),
      wall(point(4000, 0), point(4000, 3000), { thicknessMm: millimetres(100) }),
      wall(point(4000, 3000), point(0, 3000), { thicknessMm: millimetres(100) }),
      wall(point(0, 3000), point(0, 0), { thicknessMm: millimetres(100) }),
    ];

    const { rooms } = detectRooms(walls);

    expect(boundingWidthMm(rooms[0]?.outline ?? [])).toBeCloseTo(3900, 6);
    expect(boundingDepthMm(rooms[0]?.outline ?? [])).toBeCloseTo(2800, 6);
  });

  it('is what the area is measured from', () => {
    const { rooms } = detectRooms(createRectangle(5000, 4000, millimetres(200)));
    const room = rooms[0];

    expect(room?.areaM2).toBeCloseTo(outlineAreaM2(room?.outline ?? []), 9);
    // The centrelines would have measured 20,00 m²; the clear face is smaller.
    expect(room?.areaM2).toBeLessThan(20);
  });
});

describe('welding the holes a tracer left', () => {
  /** A rectangle whose north wall stops `gapMm` short of the north-east corner. */
  function createRectangleWithGap(gapMm: number): readonly Wall[] {
    const wall = createWallPen();
    return [
      wall(point(0, 0), point(5000, 0)),
      wall(point(5000, 0), point(5000, 4000)),
      wall(point(5000 - gapMm, 4000), point(0, 4000)),
      wall(point(0, 4000), point(0, 0)),
    ];
  }

  it('closes a hole narrower than the weld gap', () => {
    const { rooms, graph } = detectRooms(createRectangleWithGap(60));

    expect(rooms).toHaveLength(1);
    expect(graph.weldedGaps).toHaveLength(1);
    expect(graph.weldedGaps[0]?.gapMm).toBeCloseTo(60, 6);
  });

  it('closes a hole exactly the width of the weld gap', () => {
    const { rooms } = detectRooms(createRectangleWithGap(DEFAULT_WELD_GAP_MM));

    expect(rooms).toHaveLength(1);
  });

  it('leaves a hole wider than the weld gap open', () => {
    const { rooms } = detectRooms(createRectangleWithGap(120));

    expect(rooms).toEqual([]);
  });

  it('names both walls a weld pulled together', () => {
    const { graph } = detectRooms(createRectangleWithGap(60));

    expect(graph.weldedGaps[0]?.wallIds).toEqual(['W-0002', 'W-0003']);
  });

  it('takes a narrower weld gap as an instruction, not a suggestion', () => {
    const { rooms } = detectRooms(createRectangleWithGap(60), { weldGapMm: millimetres(20) });

    expect(rooms).toEqual([]);
  });

  it('pulls an end that overshoots back onto the run it crossed', () => {
    const wall = createWallPen();
    // The north wall runs 60 mm past the north-east corner instead of short of
    // it: the same hole, drawn the other way round.
    const walls = [
      wall(point(0, 0), point(5000, 0)),
      wall(point(5000, 0), point(5000, 4000)),
      wall(point(5060, 4000), point(0, 4000)),
      wall(point(0, 4000), point(0, 0)),
    ];

    const { rooms } = detectRooms(walls);

    expect(rooms).toHaveLength(1);
  });
});

describe('rooms too small to believe', () => {
  /** A closed square whose clear area lands under a square metre. */
  const TINY_ROOM: readonly Wall[] = createRectangle(900, 900, PARTITION_THICKNESS_MM);

  it('are kept rather than deleted', () => {
    const { rooms } = detectRooms(TINY_ROOM);

    expect(rooms).toHaveLength(1);
  });

  it('are marked suspect', () => {
    const { rooms } = detectRooms(TINY_ROOM);

    expect(rooms[0]?.trust).toBe('suspect');
    expect(rooms[0]?.areaM2).toBeCloseTo(0.64, 6);
    expect(rooms[0]?.areaM2).toBeLessThan(MIN_TRUSTED_ROOM_AREA_M2);
  });

  it('are trusted once they clear the threshold', () => {
    const { rooms } = detectRooms(createRectangle(1200, 1200, PARTITION_THICKNESS_MM));

    expect(rooms[0]?.areaM2).toBeCloseTo(1.21, 6);
    expect(rooms[0]?.trust).toBe('trusted');
  });

  it('takes a different threshold from the caller', () => {
    const { rooms } = detectRooms(TINY_ROOM, { minTrustedAreaM2: squareMetres(0.5) });

    expect(rooms[0]?.trust).toBe('trusted');
  });
});

describe('splitting runs where they meet', () => {
  it('divides a room in two when a partition tees into a long wall', () => {
    const wall = createWallPen();
    const walls = [
      ...drawRectangle(wall, 6000, 4000),
      wall(point(3000, 0), point(3000, 4000), { thicknessMm: PARTITION_THICKNESS_MM }),
    ];

    const { rooms } = detectRooms(walls);

    expect(rooms).toHaveLength(2);
    expect(rooms.map((room) => Math.round(room.areaM2 * 100) / 100)).toEqual([10.83, 10.83]);
  });

  it('makes four rooms out of two walls crossing inside a rectangle', () => {
    const wall = createWallPen();
    const walls = [
      ...drawRectangle(wall, 6000, 6000),
      wall(point(0, 3000), point(6000, 3000), { thicknessMm: PARTITION_THICKNESS_MM }),
      wall(point(3000, 0), point(3000, 6000), { thicknessMm: PARTITION_THICKNESS_MM }),
    ];

    const { rooms } = detectRooms(walls);

    expect(rooms).toHaveLength(4);
    for (const room of rooms) {
      expect(room.areaM2).toBeCloseTo(8.1225, 6);
    }
  });

  it('leaves a rectangle four corners, not one per piece it was drawn in', () => {
    const wall = createWallPen();
    // The south wall arrives in two pieces; the room is still a rectangle.
    const walls = [
      wall(point(0, 0), point(2000, 0)),
      wall(point(2000, 0), point(5000, 0)),
      wall(point(5000, 0), point(5000, 4000)),
      wall(point(5000, 4000), point(0, 4000)),
      wall(point(0, 4000), point(0, 0)),
    ];

    const { rooms } = detectRooms(walls);

    expect(rooms[0]?.outline).toHaveLength(4);
    expect(rooms[0]?.areaM2).toBeCloseTo(18.24, 6);
  });
});

describe('walls that bound nothing', () => {
  it('do not invent a room', () => {
    const wall = createWallPen();
    const walls = [
      ...drawRectangle(wall, 5000, 4000),
      wall(point(2500, 2000), point(3500, 2000), { thicknessMm: PARTITION_THICKNESS_MM }),
    ];

    const { rooms, graph } = detectRooms(walls);

    expect(rooms).toHaveLength(1);
    expect(graph.deadEndWallIds).toEqual(['W-0005']);
  });

  it('leave nothing behind when nothing closes', () => {
    const wall = createWallPen();
    const walls = [
      wall(point(0, 0), point(5000, 0)),
      wall(point(5000, 0), point(5000, 4000)),
    ];

    const { rooms, graph } = detectRooms(walls);

    expect(rooms).toEqual([]);
    expect(graph.edges).toEqual([]);
    expect(graph.vertices).toEqual([]);
  });

  it('are pruned back through a whole chain, not one step', () => {
    const wall = createWallPen();
    const walls = [
      ...drawRectangle(wall, 5000, 4000),
      wall(point(2500, 0), point(2500, 2000), { thicknessMm: PARTITION_THICKNESS_MM }),
      wall(point(2500, 2000), point(3500, 2000), { thicknessMm: PARTITION_THICKNESS_MM }),
    ];

    const { rooms, graph } = detectRooms(walls);

    expect(rooms).toHaveLength(1);
    expect(graph.deadEndWallIds).toEqual(['W-0005', 'W-0006']);
  });
});

describe('the graph the walk runs on', () => {
  it('orders the edges around every vertex counter-clockwise', () => {
    const wall = createWallPen();
    const graph = buildWallGraph([
      ...drawRectangle(wall, 6000, 6000),
      wall(point(0, 3000), point(6000, 3000)),
      wall(point(3000, 0), point(3000, 6000)),
    ]);

    const centre = graph.vertices.find((vertex) => vertex.edgeIds.length === 4);

    expect(centre).toBeDefined();
    // Bearings are folded into `[0, 360)`, the range the graph orders on, so
    // due south reads as 270° rather than as the −90° `atan2` hands back.
    const bearings = (centre?.edgeIds ?? []).map((edgeId) => {
      const edge = graph.edges[edgeId];
      const otherId = edge?.fromVertexId === centre?.id ? edge?.toVertexId : edge?.fromVertexId;
      const other = graph.vertices[otherId ?? 0]?.position ?? point(0, 0);
      const here = centre?.position ?? point(0, 0);
      const raw = (Math.atan2(other.y - here.y, other.x - here.x) * 180) / Math.PI;
      return (raw + 360) % 360;
    });

    expect(bearings).toEqual([0, 90, 180, 270]);
  });

  it('gives every surviving vertex at least two edges', () => {
    const graph = buildWallGraph(SAMPLE_PLAN);
    const degree = new Map<number, number>();
    for (const edge of graph.edges) {
      degree.set(edge.fromVertexId, (degree.get(edge.fromVertexId) ?? 0) + 1);
      degree.set(edge.toVertexId, (degree.get(edge.toVertexId) ?? 0) + 1);
    }

    for (const vertex of graph.vertices) {
      expect(degree.get(vertex.id) ?? 0).toBeGreaterThanOrEqual(2);
    }
  });

  it('never lets an edge pass through another vertex', () => {
    const graph = buildWallGraph(SAMPLE_PLAN);

    for (const edge of graph.edges) {
      const from = graph.vertices[edge.fromVertexId]?.position ?? point(0, 0);
      const to = graph.vertices[edge.toVertexId]?.position ?? point(0, 0);
      const runX = to.x - from.x;
      const runY = to.y - from.y;
      const lengthSquared = runX * runX + runY * runY;

      for (const vertex of graph.vertices) {
        if (vertex.id === edge.fromVertexId || vertex.id === edge.toVertexId) {
          continue;
        }
        const along =
          ((vertex.position.x - from.x) * runX + (vertex.position.y - from.y) * runY) / lengthSquared;
        if (along <= 0 || along >= 1) {
          continue;
        }
        const offLine =
          Math.abs(runX * (vertex.position.y - from.y) - runY * (vertex.position.x - from.x)) /
          Math.sqrt(lengthSquared);
        expect(offLine).toBeGreaterThan(1);
      }
    }
  });
});

describe('input the geometry cannot use', () => {
  it('refuses two walls sharing an id', () => {
    const walls = [
      makeWall('W-1', point(0, 0), point(5000, 0)),
      makeWall('W-1', point(5000, 0), point(5000, 4000)),
    ];

    expect(() => detectRooms(walls)).toThrow(/appears more than once/u);
  });

  it('refuses a wall too thin to build', () => {
    const walls = [makeWall('W-1', point(0, 0), point(5000, 0), { thicknessMm: millimetres(40) })];

    expect(() => detectRooms(walls)).toThrow(RangeError);
  });

  it('refuses a weld gap that is not a positive length', () => {
    expect(() => detectRooms(createRectangle(5000, 4000), { weldGapMm: millimetres(0) })).toThrow(
      RangeError,
    );
  });

  it('finds nothing in an empty plan', () => {
    const { rooms } = detectRooms([]);

    expect(rooms).toEqual([]);
  });
});
