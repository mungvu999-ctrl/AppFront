import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { describe, expect, it, vi } from 'vitest';

import { millimetres, type Millimetres } from '@/domain/units/types';
import type { PointMm } from '@/domain/units/compare';
import type { AttachedOpening } from '@/domain/openings/types';
import type { Wall } from '@/domain/walls/types';
import type { OpeningId, RoomId, WallId } from '@/domain/spatial/types';
import { medianMs, sampleMs } from '@/lib/testing/timing';

import { readPartData } from '../scene';
import { buildWallMesh, type WallPartData } from '../wall';
import {
  buildFloorSlab,
  OPENING_PANEL_THICKNESS_MM,
  SLAB_THICKNESS_MM,
  type BuildFloorInput,
  type BuildableLevel,
  type BuildableRoom,
} from '../floor';
import {
  buildParts,
  respondTo,
  transferablesOf,
  type BuildJob,
  type BuildRequestMessage,
  type BuildResponseMessage,
  type BuiltPartBuffers,
  type WallBuildJob,
} from '../build.worker';
import * as plan from '../plan';
import {
  BuildQueue,
  planFullBuild,
  planRoomChange,
  planWallChange,
  toGeometry,
  toMesh,
  type BuildWorkerLike,
} from '../buildQueue';

/* -------------------------------------------------------------------------- */
/* Fixtures: the standard sample plan, 48 / 21 / 34 / 14 / 4.                  */
/* -------------------------------------------------------------------------- */

const WALL_COUNT = 48;
const OPENING_COUNT = 34;
const ROOM_COUNT = 14;

const LEVEL: BuildableLevel = {
  id: 'L-01',
  elevationMm: millimetres(0),
  heightMm: millimetres(3000),
};

function pointAt(x: number, y: number): PointMm {
  return { x: millimetres(x), y: millimetres(y) };
}

function twoDigits(value: number): string {
  return value < 10 ? `0${String(value)}` : String(value);
}

const WALLS: readonly Wall[] = Array.from({ length: WALL_COUNT }, (_unused, index): Wall => {
  const alongMm = Math.floor(index / 6) * 5000;
  const acrossMm = (index % 6) * 6000;

  return {
    id: `W-${twoDigits(index + 1)}` as WallId,
    kind: 'partition',
    centreline: { start: pointAt(alongMm, acrossMm), end: pointAt(alongMm + 4000, acrossMm) },
    thicknessMm: millimetres(200),
    baseElevationMm: millimetres(0),
    topElevationMm: millimetres(3000),
  };
});

const OPENINGS: readonly AttachedOpening[] = Array.from(
  { length: OPENING_COUNT },
  (_unused, index): AttachedOpening => ({
    id: `D-${twoDigits(index + 1)}` as OpeningId,
    kind: 'door',
    widthMm: millimetres(900),
    heightMm: millimetres(2100),
    sillHeightMm: millimetres(0),
    swing: 'left',
    wallId: `W-${twoDigits(index + 1)}` as WallId,
    relativePosition: 0.5,
  }),
);

const ROOMS: readonly BuildableRoom[] = Array.from(
  { length: ROOM_COUNT },
  (_unused, index): BuildableRoom => {
    const offsetMm = index * 6000;
    return {
      id: `R-${twoDigits(index + 1)}` as RoomId,
      outline: [
        pointAt(offsetMm, 0),
        pointAt(offsetMm + 5000, 0),
        pointAt(offsetMm + 5000, 4000),
        pointAt(offsetMm, 4000),
      ],
    };
  },
);

const STOREY: BuildFloorInput = {
  level: LEVEL,
  walls: WALLS,
  rooms: ROOMS,
  openings: OPENINGS,
};

function wallAt(index: number): Wall {
  const wall = WALLS[index];
  if (wall === undefined) {
    throw new Error(`No wall at ${String(index)}.`);
  }
  return wall;
}

function wallJob(wall: Wall, openings: readonly AttachedOpening[] = []): WallBuildJob {
  return { kind: 'wall', key: wall.id, levelId: LEVEL.id, wall, openings };
}

/* -------------------------------------------------------------------------- */
/* A worker that does not exist.                                               */
/* -------------------------------------------------------------------------- */

/**
 * A stand-in for the worker thread, driven by the test.
 *
 * `jsdom` has no `Worker`, and a real one would make every assertion depend on
 * scheduling. This records what was posted and answers only when the test says
 * so, which is what makes "the first request was cancelled" something that can be
 * observed rather than raced against.
 */
class FakeWorker implements BuildWorkerLike {
  onmessage: ((event: MessageEvent<BuildResponseMessage>) => void) | null = null;

  readonly posted: BuildRequestMessage[] = [];
  readonly terminate = vi.fn();

  postMessage(message: BuildRequestMessage): void {
    this.posted.push(message);
  }

  /** Answer the oldest unanswered request, the way the real worker would. */
  answerNext(): void {
    const request = this.posted[this.answered];
    if (request === undefined) {
      throw new Error('There is no request left to answer.');
    }
    this.answered += 1;
    this.onmessage?.(new MessageEvent('message', { data: respondTo(request) }));
  }

  /** Answer every outstanding request. */
  answerAll(): void {
    while (this.answered < this.posted.length) {
      this.answerNext();
    }
  }

  private answered = 0;
}

/**
 * A stand-in that pays what a real worker pays, apart from the thread hop.
 *
 * The request is serialised the way `postMessage` serialises it, built, and the
 * answer serialised back with its buffers handed over. That is every cost of a
 * round trip that a single-threaded test can reproduce, which is what makes the
 * 80 ms budget worth asserting against rather than a measurement of `buildParts`
 * with the boundaries wished away.
 */
class CloningWorker implements BuildWorkerLike {
  onmessage: ((event: MessageEvent<BuildResponseMessage>) => void) | null = null;

  readonly terminate = vi.fn();

  postMessage(message: BuildRequestMessage): void {
    const response = respondTo(structuredClone(message));
    const delivered =
      'parts' in response
        ? structuredClone(response, { transfer: transferablesOf(response.parts) })
        : structuredClone(response);

    queueMicrotask(() => {
      this.onmessage?.(new MessageEvent('message', { data: delivered }));
    });
  }
}

function queueWith(maxInFlight = 1): { queue: BuildQueue; worker: FakeWorker } {
  const worker = new FakeWorker();
  return { queue: new BuildQueue({ createWorker: () => worker, maxInFlight }), worker };
}

/* -------------------------------------------------------------------------- */
/* Helpers.                                                                    */
/* -------------------------------------------------------------------------- */

/** The volume a closed triangle soup encloses, by the divergence theorem. */
function enclosedVolume(position: Float32Array): number {
  let total = 0;

  for (let corner = 0; corner + 8 < position.length; corner += 9) {
    const ax = position[corner] ?? 0;
    const ay = position[corner + 1] ?? 0;
    const az = position[corner + 2] ?? 0;
    const bx = position[corner + 3] ?? 0;
    const by = position[corner + 4] ?? 0;
    const bz = position[corner + 5] ?? 0;
    const cx = position[corner + 6] ?? 0;
    const cy = position[corner + 7] ?? 0;
    const cz = position[corner + 8] ?? 0;

    total += (ax * (by * cz - bz * cy) - ay * (bx * cz - bz * cx) + az * (bx * cy - by * cx)) / 6;
  }

  return Math.abs(total);
}

/** The same measure, taken off a mesh the main thread built. */
function meshVolume(mesh: { geometry: { getAttribute: (name: string) => { array: ArrayLike<number> } } }): number {
  return enclosedVolume(Float32Array.from(mesh.geometry.getAttribute('position').array));
}

function boxVolume(first: Millimetres, second: Millimetres, third: Millimetres): number {
  return (first / 1000) * (second / 1000) * (third / 1000);
}

function partOf(parts: readonly BuiltPartBuffers[], entityId: string): BuiltPartBuffers {
  const found = parts.find((part) => part.entityId === entityId);
  if (found === undefined) {
    throw new Error(`No part was built for ${entityId}.`);
  }
  return found;
}

/** A tenth of a millimetre, which is finer than any drawing this app carries. */
const PLACES = 4;

/* -------------------------------------------------------------------------- */
/* The worker computes numbers, and only numbers.                              */
/* -------------------------------------------------------------------------- */

describe('build.worker', () => {
  /** An import is erased when the whole clause, or every specifier, is a type. */
  function runtimeImportsOf(fileName: string): readonly string[] {
    const source = readFileSync(resolve(__dirname, '..', fileName), 'utf8')
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .replace(/\/\/[^\n]*/g, '');

    const statements = [...source.matchAll(/^import\s+([\s\S]*?)from\s+'([^']+)';/gm)];
    expect(statements.length).toBeGreaterThan(0);

    const isTypeOnly = (clause: string): boolean =>
      /^\s*type\s/.test(clause) ||
      (clause.includes('{') &&
        clause
          .slice(clause.indexOf('{') + 1, clause.lastIndexOf('}'))
          .split(',')
          .filter((specifier) => specifier.trim() !== '')
          .every((specifier) => specifier.trim().startsWith('type ')));

    return statements
      .filter((statement) => !isTypeOnly(statement[1] ?? ''))
      .map((statement) => statement[2] ?? '');
  }

  it('imports nothing at runtime that would pull three.js into the thread', () => {
    // The entry point only reaches for the pure core; the core reaches pure
    // domain modules and `./plan`, and nothing else. `./scene`, `./floor` and
    // `./wall` all import three, so the worker may only reach them for their
    // types.
    const entryImports = runtimeImportsOf('build.worker.ts');
    expect(entryImports.length).toBeGreaterThan(0);
    for (const specifier of entryImports) {
      expect(specifier).toBe('./buildCore');
    }

    const coreImports = runtimeImportsOf('buildCore.ts');
    expect(coreImports.length).toBeGreaterThan(0);
    for (const specifier of coreImports) {
      expect(specifier).toMatch(/^(@\/domain\/|\.\/plan$)/);
    }
  });

  it('keeps the shared plan free of three.js, so the worker can read it', () => {
    for (const specifier of runtimeImportsOf('plan.ts')) {
      expect(specifier).toMatch(/^@\/domain\//);
    }
  });

  it('returns transferable buffers rather than three.js objects', () => {
    const parts = buildParts(wallJob(wallAt(0)));
    const wall = partOf(parts, 'W-01');

    expect(wall.position).toBeInstanceOf(Float32Array);
    expect(wall.normal).toBeInstanceOf(Float32Array);
    expect(wall.uv).toBeInstanceOf(Float32Array);
    expect(wall.position.length).toBe(wall.normal.length);
    expect(wall.uv.length).toBe((wall.position.length / 3) * 2);

    const transfer = transferablesOf(parts);
    expect(transfer).toHaveLength(parts.length * 3);
    expect(transfer[0]).toBeInstanceOf(ArrayBuffer);
  });

  it('builds the same solid as the main-thread wall builder', () => {
    const wall = wallAt(0);
    const door = OPENINGS[0];
    expect(door).toBeDefined();
    if (door === undefined) {
      return;
    }

    for (const openings of [[], [door]]) {
      const onMain = buildWallMesh(wall, { levelId: LEVEL.id, openings });
      const inWorker = partOf(buildParts(wallJob(wall, openings)), 'W-01');

      expect(inWorker.position.length / 9).toBe(
        onMain.geometry.getAttribute('position').count / 3,
      );
      expect(enclosedVolume(inWorker.position)).toBeCloseTo(meshVolume(onMain), PLACES);
    }
  });

  it('cuts a door out, leaving one door of wall missing', () => {
    const wall = wallAt(0);
    const door = OPENINGS[0];
    expect(door).toBeDefined();
    if (door === undefined) {
      return;
    }

    const solid = partOf(buildParts(wallJob(wall)), 'W-01');
    const cut = partOf(buildParts(wallJob(wall, [door])), 'W-01');

    expect(cut.openingIds).toEqual(['D-01']);
    expect(cut.refusals).toEqual([]);
    expect(enclosedVolume(cut.position)).toBeCloseTo(
      enclosedVolume(solid.position) - boxVolume(door.widthMm, door.heightMm, wall.thicknessMm),
      PLACES,
    );
  });

  it('refuses openings with the very same sentence the main thread writes', () => {
    const wall = wallAt(0);
    const impossible: readonly AttachedOpening[] = [
      { ...(OPENINGS[0] as AttachedOpening), id: 'D-90' as OpeningId, relativePosition: 1 },
      {
        ...(OPENINGS[0] as AttachedOpening),
        id: 'D-91' as OpeningId,
        sillHeightMm: millimetres(2000),
        heightMm: millimetres(1400),
      },
      { ...(OPENINGS[0] as AttachedOpening), id: 'D-92' as OpeningId, widthMm: millimetres(0) },
    ];

    const onMain = buildWallMesh(wall, { levelId: LEVEL.id, openings: impossible }).userData as
      WallPartData;
    const inWorker = partOf(buildParts(wallJob(wall, impossible)), 'W-01');

    // Not "the same reasons" — the same objects, sentence included, because both
    // sides call `planCuts` in `plan.ts` rather than each keeping a copy of it.
    expect(inWorker.refusals).toEqual(onMain.refusals);
    expect(inWorker.openingIds).toEqual(onMain.openingIds);
    expect(inWorker.refusals[0]?.message).toContain('Cửa đi D-90');
  });

  it('hangs a panel in every opening it cut, and none in a void', () => {
    const wall = wallAt(0);
    const door = OPENINGS[0] as AttachedOpening;
    const archway: AttachedOpening = { ...door, id: 'D-93' as OpeningId, kind: 'void' };

    const withDoor = buildParts(wallJob(wall, [door]));
    expect(withDoor.map((part) => part.entityId)).toEqual(['W-01', 'D-01']);
    expect(enclosedVolume(partOf(withDoor, 'D-01').position)).toBeCloseTo(
      boxVolume(door.widthMm, door.heightMm, OPENING_PANEL_THICKNESS_MM),
      PLACES,
    );

    const withArchway = buildParts(wallJob(wall, [archway]));
    expect(withArchway.map((part) => part.entityId)).toEqual(['W-01']);
  });

  it('builds a room as a slab and a ceiling matching floor.ts', () => {
    const room = ROOMS[0];
    expect(room).toBeDefined();
    if (room === undefined) {
      return;
    }

    const job: BuildJob = { kind: 'room', key: room.id, levelId: LEVEL.id, room, level: LEVEL };
    const parts = buildParts(job);

    expect(parts.map((part) => part.kind)).toEqual(['floorSlab', 'ceiling']);
    expect(enclosedVolume(partOf(parts, 'R-01').position)).toBeCloseTo(
      meshVolume(buildFloorSlab(room, LEVEL)),
      PLACES,
    );
  });

  it('reads the slab and panel thicknesses from the one place they are defined', () => {
    expect(SLAB_THICKNESS_MM).toBe(plan.SLAB_THICKNESS_MM);
    expect(OPENING_PANEL_THICKNESS_MM).toBe(plan.OPENING_PANEL_THICKNESS_MM);
    expect(plan.SLAB_THICKNESS_MM).toBe(150);
    expect(plan.OPENING_PANEL_THICKNESS_MM).toBe(40);
  });

  it('answers a model it cannot build with a message, not a silence', () => {
    const broken: Wall = { ...wallAt(0), thicknessMm: millimetres(30) };
    const response = respondTo({ ticket: 7, job: wallJob(broken) });

    expect(response.ticket).toBe(7);
    expect('error' in response ? response.error : null).toContain('thickness');
  });
});

/* -------------------------------------------------------------------------- */
/* The incremental budget.                                                     */
/* -------------------------------------------------------------------------- */

describe('incremental build budget', () => {
  /** What one changed object is allowed to cost. */
  const BUDGET_MS = 80;

  it('rebuilds one wall and its openings well inside 80 ms', () => {
    const wall = wallAt(0);
    const door = OPENINGS[0] as AttachedOpening;
    const job = wallJob(wall, [door]);

    // Warm the code path, then hold nineteen of twenty runs to the budget rather
    // than an average: a budget that only holds on a good run is not a budget.
    // The one run let off is the one a GC pause or the shared CI runner lands on.
    buildParts(job);

    expect(sampleMs(() => buildParts(job), 20).at(-2)).toBeLessThan(BUDGET_MS);
  });

  it('stays inside the budget for the whole round trip, boundaries included', async () => {
    // Everything a real request pays for except the thread hop itself, which no
    // test in `jsdom` can produce: the job is serialised the way `postMessage`
    // serialises it, built, and the answer is serialised back with its buffers
    // handed over rather than copied.
    const worker = new CloningWorker();
    const queue = new BuildQueue({ createWorker: () => worker });
    const job = wallJob(wallAt(0), [OPENINGS[0] as AttachedOpening]);

    await queue.enqueue(job);

    const runsMs: number[] = [];
    for (let run = 0; run < 20; run += 1) {
      const startedAt = performance.now();
      const outcome = await queue.enqueue(job);
      runsMs.push(performance.now() - startedAt);
      expect(outcome.status).toBe('done');
    }

    // Nineteen of twenty, as above.
    expect(runsMs.sort((a, b) => a - b).at(-2)).toBeLessThan(BUDGET_MS);
    queue.dispose();
  });

  it('hands the geometry over rather than copying it', () => {
    const parts = buildParts(wallJob(wallAt(0), [OPENINGS[0] as AttachedOpening]));
    const transfer = transferablesOf(parts);
    const lengthsBefore = parts.map((part) => part.position.length);

    expect(lengthsBefore.every((length) => length > 0)).toBe(true);
    // Every buffer of every part is in the transfer list: nothing about the
    // geometry — the big half of the round trip — is structurally cloned.
    expect(transfer).toHaveLength(parts.length * 3);

    const arrived = structuredClone({ ticket: 1, parts }, { transfer });

    expect(arrived.parts.map((part) => part.position.length)).toEqual(lengthsBefore);
    // The originals are detached, which is what "transferred" means: the worker
    // no longer holds a second copy of a storey's worth of vertices.
    for (const part of parts) {
      expect(part.position.byteLength).toBe(0);
    }
  });

  it('costs far less than rebuilding the storey', () => {
    const jobs = planFullBuild(STOREY);

    const oneWall = wallJob(wallAt(0), [OPENINGS[0] as AttachedOpening]);

    // Medians of five, not one sample each: on PR #31 a single stall made one wall
    // (21 ms) cost more than a whole storey (19 ms) that normally takes ~30x longer.
    const wholeStoreyMs = medianMs(() => {
      for (const job of jobs) {
        buildParts(job);
      }
    });
    const oneWallMs = medianMs(() => buildParts(oneWall));

    expect(jobs).toHaveLength(WALL_COUNT + ROOM_COUNT);
    expect(oneWallMs).toBeLessThan(BUDGET_MS);
    expect(oneWallMs).toBeLessThanOrEqual(wholeStoreyMs);
  });
});

/* -------------------------------------------------------------------------- */
/* Planning the smallest job.                                                  */
/* -------------------------------------------------------------------------- */

describe('planWallChange', () => {
  it('plans one job for one changed wall, not forty-eight', () => {
    const jobs = planWallChange(STOREY, 'W-01');

    expect(jobs).toHaveLength(1);
    expect(jobs[0]?.key).toBe('W-01');
    expect(planFullBuild(STOREY)).toHaveLength(WALL_COUNT + ROOM_COUNT);
  });

  it('sends only the openings cut into that wall', () => {
    const job = planWallChange(STOREY, 'W-05')[0];

    expect(job?.kind).toBe('wall');
    if (job === undefined || job.kind !== 'wall') {
      return;
    }

    expect(job.openings.map((opening) => opening.id)).toEqual(['D-05']);
  });

  it('rebuilds the wall together with the panels hung in it', () => {
    const job = planWallChange(STOREY, 'W-01')[0];
    expect(job).toBeDefined();
    if (job === undefined) {
      return;
    }

    expect(buildParts(job).map((part) => part.entityId)).toEqual(['W-01', 'D-01']);
  });

  it('plans nothing for an id the storey does not hold', () => {
    expect(planWallChange(STOREY, 'W-99')).toEqual([]);
    expect(planRoomChange(STOREY, 'R-99')).toEqual([]);
  });

  it('plans a slab and a ceiling for one changed room', () => {
    const jobs = planRoomChange(STOREY, 'R-02');

    expect(jobs).toHaveLength(1);
    expect(buildParts(jobs[0] as BuildJob).map((part) => part.kind)).toEqual([
      'floorSlab',
      'ceiling',
    ]);
  });
});

/* -------------------------------------------------------------------------- */
/* The queue.                                                                  */
/* -------------------------------------------------------------------------- */

describe('BuildQueue', () => {
  it('posts one request when one wall changes', async () => {
    const { queue, worker } = queueWith();

    const outcomes = queue.enqueueAll(planWallChange(STOREY, 'W-01'));
    expect(worker.posted).toHaveLength(1);

    worker.answerAll();
    const [outcome] = await outcomes;

    expect(outcome?.status).toBe('done');
    queue.dispose();
  });

  it('cancels the first of two requests for the same entity', async () => {
    const { queue, worker } = queueWith();

    const first = queue.enqueue(wallJob(wallAt(0)));
    const second = queue.enqueue(wallJob(wallAt(0)));

    // The first is answered at once, before the worker has said anything.
    await expect(first).resolves.toEqual({ status: 'cancelled', reason: 'superseded' });

    worker.answerAll();
    expect((await second).status).toBe('done');
    queue.dispose();
  });

  it('never sends a request that was superseded while it was still queued', async () => {
    const { queue, worker } = queueWith();

    const blocking = queue.enqueue(wallJob(wallAt(1)));
    const first = queue.enqueue(wallJob(wallAt(0)));
    const second = queue.enqueue(wallJob(wallAt(0)));

    expect(worker.posted).toHaveLength(1);
    await expect(first).resolves.toEqual({ status: 'cancelled', reason: 'superseded' });

    worker.answerAll();
    await blocking;
    worker.answerAll();
    await second;

    // Two walls were asked for three times and posted twice: the queued job that
    // was replaced never left the main thread.
    expect(worker.posted.map((request) => request.job.key)).toEqual(['W-02', 'W-01']);
    queue.dispose();
  });

  it('throws away the result of a job that was superseded mid-flight', async () => {
    const { queue, worker } = queueWith();

    const first = queue.enqueue(wallJob(wallAt(0)));
    const second = queue.enqueue(wallJob(wallAt(0)));

    await expect(first).resolves.toEqual({ status: 'cancelled', reason: 'superseded' });

    // The worker answers the request nobody wants any more, then the new one.
    worker.answerNext();
    expect(worker.posted).toHaveLength(2);
    worker.answerNext();

    const outcome = await second;
    expect(outcome.status).toBe('done');
    queue.dispose();
  });

  it('coalesces a drag down to what the worker can keep up with', async () => {
    const { queue, worker } = queueWith();
    const wall = wallAt(0);

    const outcomes: Promise<unknown>[] = [];
    for (let frame = 0; frame < 50; frame += 1) {
      outcomes.push(queue.enqueue(wallJob(wall)));
    }

    // One with the worker, one waiting; the other forty-eight were dropped.
    expect(worker.posted).toHaveLength(1);
    expect(queue.pendingCount).toBe(1);

    worker.answerAll();
    await Promise.resolve();
    worker.answerAll();
    await Promise.all(outcomes);

    expect(worker.posted).toHaveLength(2);
    queue.dispose();
  });

  it('keeps jobs for different entities apart', async () => {
    const { queue, worker } = queueWith(4);

    const outcomes = queue.enqueueAll([wallJob(wallAt(0)), wallJob(wallAt(1)), wallJob(wallAt(2))]);
    expect(worker.posted.map((request) => request.job.key)).toEqual(['W-01', 'W-02', 'W-03']);

    worker.answerAll();
    for (const outcome of await outcomes) {
      expect(outcome.status).toBe('done');
    }
    queue.dispose();
  });

  it('reports a job the worker could not build', async () => {
    const { queue, worker } = queueWith();
    const broken: Wall = { ...wallAt(0), topElevationMm: millimetres(0) };

    const outcome = queue.enqueue(wallJob(broken));
    worker.answerAll();

    expect((await outcome).status).toBe('failed');
    queue.dispose();
  });
});

/* -------------------------------------------------------------------------- */
/* Closing the worker.                                                         */
/* -------------------------------------------------------------------------- */

describe('BuildQueue disposal', () => {
  it('never starts a worker for a queue that builds nothing', () => {
    const createWorker = vi.fn(() => new FakeWorker());
    const queue = new BuildQueue({ createWorker });

    queue.dispose();

    expect(createWorker).not.toHaveBeenCalled();
    expect(queue.isDisposed).toBe(true);
  });

  it('ends the thread and settles everything outstanding', async () => {
    const { queue, worker } = queueWith();

    const inFlight = queue.enqueue(wallJob(wallAt(0)));
    const waiting = queue.enqueue(wallJob(wallAt(1)));
    expect(queue.inFlightCount).toBe(1);
    expect(queue.pendingCount).toBe(1);

    queue.dispose();

    await expect(inFlight).resolves.toEqual({ status: 'cancelled', reason: 'disposed' });
    await expect(waiting).resolves.toEqual({ status: 'cancelled', reason: 'disposed' });
    expect(worker.terminate).toHaveBeenCalledTimes(1);
    expect(worker.onmessage).toBeNull();
    expect(queue.inFlightCount).toBe(0);
    expect(queue.pendingCount).toBe(0);
  });

  it('is safe to close twice, and answers anything enqueued afterwards', async () => {
    const { queue, worker } = queueWith();

    const outcome = queue.enqueue(wallJob(wallAt(0)));
    worker.answerAll();
    expect((await outcome).status).toBe('done');

    queue.dispose();
    queue.dispose();

    expect(worker.terminate).toHaveBeenCalledTimes(1);
    await expect(queue.enqueue(wallJob(wallAt(1)))).resolves.toEqual({
      status: 'cancelled',
      reason: 'disposed',
    });
    expect(worker.posted).toHaveLength(1);
  });

  it('drops a message that arrives after the queue was closed', async () => {
    const { queue, worker } = queueWith();

    const outcome = queue.enqueue(wallJob(wallAt(0)));
    queue.dispose();

    await expect(outcome).resolves.toEqual({ status: 'cancelled', reason: 'disposed' });
    // The real worker is gone; a late message from a slow one changes nothing.
    expect(() => {
      worker.onmessage?.(
        new MessageEvent('message', { data: { ticket: 1, parts: [] } as BuildResponseMessage }),
      );
    }).not.toThrow();
  });
});

/* -------------------------------------------------------------------------- */
/* Buffers back into the scene.                                                */
/* -------------------------------------------------------------------------- */

describe('toMesh', () => {
  it('tags a worker-built mesh exactly as the main-thread builders do', () => {
    const parts = buildParts(wallJob(wallAt(0), [OPENINGS[0] as AttachedOpening]));
    const mesh = toMesh(partOf(parts, 'W-01'));

    expect(readPartData(mesh)).toMatchObject({
      kind: 'wall',
      entityId: 'W-01',
      levelId: 'L-01',
    });
    expect(mesh.name).toBe('W-01');
    expect((mesh.userData as WallPartData).openingIds).toEqual(['D-01']);
  });

  it('carries the vertex data across without copying it', () => {
    const part = partOf(buildParts(wallJob(wallAt(0))), 'W-01');
    const geometry = toGeometry(part);

    expect(geometry.getAttribute('position').array).toBe(part.position);
    expect(geometry.getAttribute('position').count).toBe(part.position.length / 3);
    expect(geometry.boundingBox?.min.x).toBeCloseTo(0, PLACES);
    expect(geometry.boundingBox?.max.y).toBeCloseTo(3, PLACES);
  });

  it('lands the wall where the main-thread builder lands it', () => {
    const wall = wallAt(7);
    const fromWorker = toGeometry(partOf(buildParts(wallJob(wall)), wall.id)).boundingBox;
    const fromMain = buildWallMesh(wall, { levelId: LEVEL.id }).geometry.boundingBox;

    expect(fromWorker?.min.x).toBeCloseTo(fromMain?.min.x ?? Number.NaN, PLACES);
    expect(fromWorker?.max.x).toBeCloseTo(fromMain?.max.x ?? Number.NaN, PLACES);
    expect(fromWorker?.min.y).toBeCloseTo(fromMain?.min.y ?? Number.NaN, PLACES);
    expect(fromWorker?.max.y).toBeCloseTo(fromMain?.max.y ?? Number.NaN, PLACES);
    expect(fromWorker?.min.z).toBeCloseTo(fromMain?.min.z ?? Number.NaN, PLACES);
    expect(fromWorker?.max.z).toBeCloseTo(fromMain?.max.z ?? Number.NaN, PLACES);
  });
});

/* -------------------------------------------------------------------------- */
/* A platform that refuses.                                                    */
/* -------------------------------------------------------------------------- */

describe('BuildQueue when the platform refuses the worker', () => {
  it('answers failed and frees the slot when the worker cannot be made', async () => {
    const queue = new BuildQueue({
      createWorker: () => {
        throw new Error('worker-src bị CSP chặn');
      },
    });

    // `pump` runs inside the executor of this promise, so a throw that escapes
    // would reject it instead of answering it — and leave the slot taken.
    await expect(queue.enqueue(wallJob(wallAt(0)))).resolves.toEqual({
      status: 'failed',
      message: 'worker-src bị CSP chặn',
    });
    expect(queue.inFlightCount).toBe(0);
    expect(queue.pendingCount).toBe(0);

    queue.dispose();
  });

  it('keeps draining the queue after a job that could not be sent', async () => {
    const worker = new FakeWorker();
    let firstPost = true;
    const failingOnce = {
      get onmessage() {
        return worker.onmessage;
      },
      set onmessage(handler: BuildWorkerLike['onmessage']) {
        worker.onmessage = handler;
      },
      postMessage: (message: BuildRequestMessage) => {
        if (firstPost) {
          firstPost = false;
          throw new DOMException('Không sao chép được job', 'DataCloneError');
        }
        worker.postMessage(message);
      },
      terminate: () => {
        worker.terminate();
      },
    } satisfies BuildWorkerLike;

    const queue = new BuildQueue({ createWorker: () => failingOnce });

    const first = queue.enqueue(wallJob(wallAt(0)));
    const second = queue.enqueue(wallJob(wallAt(1)));

    expect((await first).status).toBe('failed');

    // The second job was posted for real: the slot the first one took was given back.
    expect(worker.posted).toHaveLength(1);
    worker.answerAll();
    expect((await second).status).toBe('done');

    queue.dispose();
  });

  it('refuses a maxInFlight that is not a whole number of at least one', () => {
    expect(() => new BuildQueue({ maxInFlight: Number.NaN })).toThrow(RangeError);
    expect(() => new BuildQueue({ maxInFlight: 2.5 })).toThrow(RangeError);
    expect(() => new BuildQueue({ maxInFlight: 0 })).toThrow(RangeError);
    expect(() => new BuildQueue({ maxInFlight: -1 })).toThrow(RangeError);
  });

  it('still sends jobs when maxInFlight is a whole number', async () => {
    const { queue, worker } = queueWith(2);

    const outcomes = [queue.enqueue(wallJob(wallAt(0))), queue.enqueue(wallJob(wallAt(1)))];
    expect(worker.posted).toHaveLength(2);

    worker.answerAll();
    expect((await Promise.all(outcomes)).map((outcome) => outcome.status)).toEqual(['done', 'done']);

    queue.dispose();
  });
});
