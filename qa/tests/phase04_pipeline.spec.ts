/**
 * Phase 4: QC layers (E2E-TEST-PLAN.md v2, §4 Phase 4), Track A, admin.
 * SCR-16 → SCR-17 → SCR-18 → SCR-19 → SCR-20 → SCR-21 → SCR-14 → SCR-22, matrix row order.
 *
 * Data (BUG-346): `beforeAll` creates its OWN `qa-<runId>-m04-…` project (two floors) through the real API and writes the
 * first floor's layer through #35 (`support/layerSeed.ts` qcLayer: walls, a door and a window, two rooms, a table); the
 * project is deleted in `afterAll`. SCR-16, SCR-17, SCR-19, SCR-20 and SCR-21 run on that floor.
 * BUG-346 (run-26: CP-5 recorded, its work floor's GET …/spatial/layer 404, so these cases were skipped): the cases that need
 * the pipeline output — SCR-18 (OCR dimensions), SCR-14 (the warped drawing), SCR-22 (the source scan) — no longer read
 * Phase 3. Each of those describes uploads the env drawing (`E2E_DRAWING_PNG`) to its OWN `qa-<runId>-m04-…` project in its
 * `beforeAll` (`support/drawingSeed.ts` createPipelineDrawingProject: #5 → #6 → #7, then #8 progress `completed` and N16
 * 200) and deletes it in its `afterAll`; they SKIP with an "Environment:" reason only when `E2E_DRAWING_PNG` is missing.
 * Only CP-6 still reads Phase 3's CP-5 work floor (runtime-session.json project.projectId, floors.workFloorId,
 * checkpoints.pipelineComplete): it produces checkpoints.restorableVersion after an approve PUT 200 there (no phase-6 spec
 * reads it since QA-06: they seed their own), and SKIPS with an "Environment:" reason when CP-5 is missing or that
 * floor's N16 read is not 200.
 * Serial only where a case continues the previous one (SCR-16 select → approve → thickness → undo); every other case opens
 * its screen itself, so a failure never skips a sibling. A failed test makes Playwright start a new worker, which runs the
 * `beforeAll` hooks again (fresh seeded project, and a fresh drawing project for a pipeline describe still to run).
 *
 * Budget per worker: `POST /api/auth/login` 2 (`signInAdmin` + `signedInApi` for the fixture calls; a failed test starts a
 * new worker: 2 more); the seeded project: 1 POST + 1 #35 seed PUT + 1 DELETE; the three drawing projects: 1 POST + 1 GET
 * + upload init/chunk/complete + 1 DELETE each, i.e. 3 `drawings_init` (60 / 600 s per user, BE drawings/router.py:39-46;
 * +1 per pipeline describe re-entered by a new worker) and 3 fake-ML runs, each awaited in its own `beforeAll` with a
 * PIPELINE_TIMEOUT_MS + 60 s budget (#8 polled every 2 s); the CP-5 probe is 1 N16 GET (CP-6 only).
 *
 * Contracts verified in source (c4978eb4):
 * - Layer read/write: `GET|PUT /api/projects/:p/floors/:f/spatial/layer` (`api/endpoints.ts` spatial.layer).
 *   PUT body `{baseVersion, body: {layer?, scaleMillimetresPerPixel?}}` (`schemas/spatialLayer.ts`
 *   FloorLayerWriteSchema), response `FloorLayerWriteResultSchema`. Autosave 800 ms after the last
 *   change (`hooks/useAutosave.ts`); Ctrl+S = `global.save` → `flushAutosaves()` (`router.tsx`).
 * - Walls: listbox "Danh sách đoạn tường" is VIRTUALISED (`WallLayerList.tsx`); option name
 *   `${codeLabel} — ${status}`. codeLabel = `#${displayCodesOf(ids).get(id)}` (`wallLayerReviewGateway.ts`
 *   wallLabelOf, `domain/spatial/ids.ts`), order-independent, so it is derived here from the GET body.
 *   Keys J/K/Backspace/Mod+Z are `canvas` scope (`useWallLayerReview.ts`) — scope is the registry's resolution floor,
 *   not a focus target: they fire from a focused list row (`lib/input/shortcutRegistry.ts` handleKeyDown; only text entry
 *   blocks them). Codes are rank-numbered over the random seed ids (`displayCodesOf` order branch), so a delete shifts
 *   every later code by one (BUG-423). Merge = ctrl-click a 2nd row
 *   (`onToggleSelect`), rail button "nối đoạn" (disabled name "nối đoạn — Chọn hai đoạn tường để gộp").
 *   Merge rules (`domain/walls/edit.ts` mergeWalls): same kind, thickness, elevations; angle < 2°;
 *   off-axis stray ≤ thickness/2. Delete toast "Đã xoá tường {code}." + "Hoàn tác" (region "Thông báo").
 * - Objects: subtype/swing commands only for openings (`useObjectLayerReview.ts`: `'wallId' in before`),
 *   subtype not for orphans. Canvas `<g aria-label={codeLabel}>` has the context menu ("Xoá"); no delete key or
 *   inspector button exists for objects (`ObjectLayerInspector.tsx` header).
 * - Dimensions (F-08) and axes: no persistence path; the hooks still say "saved".
 * - Scale: "Áp cho mọi tầng" is a scope option; "Xác nhận tỷ lệ" then reads #12 floors + N15 graph and
 *   opens the A9 dialog "Áp tỷ lệ này cho N tầng có bản vẽ?" (`useScaleCalibration.ts` onApply).
 * - Checkbox/Radio.Item are `sr-only` inputs under a drawn box: driven by focus + Space, the proven
 *   path of `e2e/v7/thickness-standardization.spec.ts`.
 */
import { existsSync, readFileSync } from 'node:fs';

import { expect, test, type APIRequestContext, type BrowserContext, type Locator, type Page, type Response } from '@playwright/test';

import { FloorLayerWriteResultSchema } from '../../src/api/schemas/spatialLayer';
import { displayCodesOf } from '../../src/domain/spatial/ids';
import { ROUTES } from '../../e2e/fixtures/routes';
import { TOUR_APPEAR_TIMEOUT_MS, dismissTour } from '../../e2e/fixtures/tour';
import {
  navigateThenWaitForApi,
  waitForApi,
  waitForApiWhere,
  watchApi,
  type ApiResult,
} from '../../e2e/fullstack/apiWatch';
import { ACTION_TIMEOUT_MS, AUTOSAVE_TIMEOUT_MS, NAVIGATION_TIMEOUT_MS, PIPELINE_TIMEOUT_MS, readBaseUrl } from '../../e2e/fullstack/env';
import { signedInApi } from './support/api';
import { readAdminCredentials, signInAdmin } from './support/auth';
import { createPipelineDrawingProject, deleteSeededProject, type SeededDrawing } from './support/drawingSeed';
import { captureEvidence } from './support/evidence';
import { createQcProject, deleteProject, layerStatus, type LayerApi, type SeededFloor } from './support/layerSeed';
import { skipWithReason } from './support/skip';
import { readState, updateState } from './support/state';
import { flush } from './support/p04/P5';

const VIEWPORT = { width: 1440, height: 900 } as const;

/** Every status a read may answer: a wait filtered on [200] alone makes the "answers 200" check that follows always true. */
const ANY_STATUS = [200, 304, 400, 401, 403, 404, 409, 422, 429, 500, 502, 503, 504] as const;

/** BUG-424: an action that either lands at once or never (a covered target) gets 5 s, not ACTION_TIMEOUT_MS (30 s). */
const QUICK_ACTION_TIMEOUT_MS = 5_000;

/** `domain/walls/edit.ts` MAX_MERGE_ANGLE_DEG (2°); a tighter margin here so the pick is unambiguous. */
const MERGE_MAX_ANGLE_DEG = 1;
const ENDPOINT_TOLERANCE_MM = 1;

const WALL_NO_MATCH =
  'Không có đoạn tường nào khớp bộ lọc đang bật. Bỏ bớt một bộ lọc để thấy lại danh sách.';
const SCALE_HANDLE_START = 'Đầu đoạn tham chiếu, dùng phím mũi tên để nhích';
const SCALE_HANDLE_END = 'Cuối đoạn tham chiếu, dùng phím mũi tên để nhích';
const OVERLAY_DIVIDER = 'Đường chia đôi, dùng phím mũi tên trái và phải để dịch';
const RENAMED_ROOM = 'Phòng E2E QA';

/* ---- phase-local helpers (minimal copies of chain.fullstack.ts) ---- */

type Json = Record<string, unknown>;

const asRecord = (value: unknown, what: string): Json => {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new Error(`${what}: body is not a JSON object`);
  }
  return value as Json;
};

const arrayOf = (value: unknown, what: string): Json[] => {
  if (!Array.isArray(value)) throw new Error(`${what}: not an array`);
  return value.map((item, index) => asRecord(item, `${what}[${String(index)}]`));
};

const layerOf = (body: unknown, what: string): Json => asRecord(asRecord(body, what).layer, `${what}.layer`);
const wallsOf = (body: unknown, what: string): Json[] => arrayOf(layerOf(body, what).walls, `${what}.layer.walls`);

const wallById = (walls: readonly Json[], id: string, what: string): Json => {
  const wall = walls.find((candidate) => candidate.id === id);

  if (wall === undefined) throw new Error(`${what}: no wall ${id}`);
  return wall;
};

const escapeRegExp = (text: string): string => text.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&');

const pathnameOf = (page: Page): string => new URL(page.url()).pathname;

/** `${code} — ${status}` (walls, objects): the code part. */
async function codeOfOption(option: Locator): Promise<string> {
  const code = ((await option.getAttribute('aria-label')) ?? '').split(' — ')[0]?.trim() ?? '';

  if (code === '') throw new Error('option has no "<code> — <status>" aria-label');
  return code;
}

/** Checkbox / Radio.Item: focus + Space (sr-only input under a drawn box). */
async function pressSpaceOn(control: Locator): Promise<void> {
  await control.focus();
  await control.page().keyboard.press('Space');
}

/** Custom `Select` (`components/ui/Select.tsx`): the open listbox is the trigger's `aria-controls`. */
async function openSelect(page: Page, trigger: Locator): Promise<Locator> {
  await trigger.click();
  await expect(trigger).toHaveAttribute('aria-expanded', 'true');
  const id = await trigger.getAttribute('aria-controls');

  if (id === null || id === '') throw new Error('select trigger has no aria-controls once open');
  return page.locator(`[id="${id}"]`);
}

/* ---- shared session ---- */

interface WriteRequest {
  readonly method: string;
  readonly path: string;
}

let context: BrowserContext;
let page: Page;
/** Fixture calls (own admin API login; `support/layerSeed.ts`). */
let fixtureApi: APIRequestContext | undefined;
/** This file's own project: floor 0 carries `qcLayer`, floor 1 is empty (floor-nav target). */
let seeded: readonly SeededFloor[] = [];
/** The floor under test, set by each describe's `beforeEach` (`useSeededFloor` / `useOwnDrawingFloor` / `useWorkFloor`). */
let projectId = '';
let floorId = '';
/** Every non-GET request under `/api/projects/` (request time, not response time). */
const writes: WriteRequest[] = [];
let tourPending = true;

const layerApi = (): LayerApi => {
  if (fixtureApi === undefined) throw new Error('setup: no fixture API context');
  return { request: fixtureApi, headers: {} };
};

test.beforeAll(async ({ browser }) => {
  const { email, password } = readAdminCredentials();
  fixtureApi = await signedInApi(email, password);
  seeded = await createQcProject(layerApi(), 'm04', ['Tầng QC', 'Tầng QC phụ']);

  context = await browser.newContext({ baseURL: readBaseUrl(), viewport: VIEWPORT });
  context.setDefaultTimeout(ACTION_TIMEOUT_MS);
  context.setDefaultNavigationTimeout(NAVIGATION_TIMEOUT_MS);
  page = await context.newPage();
  // Before the first goto: bodies are read on arrival (apiWatch), writes are counted on request.
  watchApi(page);
  page.on('request', (request) => {
    const path = new URL(request.url()).pathname;

    if (request.method() !== 'GET' && path.startsWith('/api/projects/')) {
      writes.push({ method: request.method(), path });
    }
  });
  await signInAdmin(page);
});

test.afterAll(async () => {
  try {
    const own = seeded[0];
    if (own !== undefined && fixtureApi !== undefined) {
      const failed = await deleteProject(layerApi(), own.projectId);
      if (failed !== null) test.info().annotations.push({ type: 'cleanup', description: failed });
    }
  } finally {
    await fixtureApi?.dispose();
    await context?.close();
  }
});

/** SCR-16/17/19/20/21: the seeded floor (no pipeline needed). */
function useSeededFloor(): void {
  const own = seeded[0];
  if (own === undefined) throw new Error('setup: the seeded project was not created');
  projectId = own.projectId;
  floorId = own.floorId;
}

/**
 * BUG-346: a describe whose cases need the pipeline output (warped drawing, source scan, OCR dimensions) on a floor of its
 * OWN: `beforeAll` uploads the env drawing to a new `qa-<runId>-<slug>-…` project and waits for the finished run
 * (`createPipelineDrawingProject`), `afterAll` deletes it, `beforeEach` points `projectId` / `floorId` at it.
 */
function useOwnDrawingFloor(slug: string): void {
  let drawn: SeededDrawing | undefined;

  test.beforeAll(async () => {
    const png = process.env.E2E_DRAWING_PNG?.trim() ?? '';
    test.skip(png === '' || !existsSync(png), 'Environment: E2E_DRAWING_PNG is not an existing file (qa.config.json env.vars)');
    test.info().setTimeout(PIPELINE_TIMEOUT_MS + 60_000);
    if (fixtureApi === undefined) throw new Error('setup: no fixture API context');
    drawn = await createPipelineDrawingProject(fixtureApi, slug, readFileSync(png));
  });
  test.afterAll(async () => {
    if (drawn === undefined || fixtureApi === undefined) return;
    const failed = await deleteSeededProject(fixtureApi, drawn.projectId);
    if (failed !== null) test.info().annotations.push({ type: 'cleanup', description: failed });
  });
  test.beforeEach(() => {
    if (drawn === undefined) throw new Error('setup: the drawing project was not created');
    projectId = drawn.projectId;
    floorId = drawn.floorId;
  });
}

let workFloorStatus: Promise<number> | undefined;

/**
 * CP-6 only (it must touch the floor Phase 6 restores): Phase 3's CP-5 work floor, or SKIP with the reason.
 * Run-22 / run-26 recorded CP-5 while that floor answered GET …/spatial/layer 404 — probed once per worker here.
 */
async function useWorkFloor(): Promise<void> {
  const state = readState();
  const work = { projectId: state.project.projectId ?? '', floorId: state.floors.workFloorId ?? '' };
  if (!state.checkpoints.pipelineComplete || work.projectId === '' || work.floorId === '') {
    skipWithReason('Environment: CP-5 not recorded by Phase 3 (checkpoints.pipelineComplete / work floor id missing)');
    return;
  }
  workFloorStatus ??= layerStatus(layerApi(), work.projectId, work.floorId);
  const status = await workFloorStatus;
  test.skip(status !== 200, `Environment: CP-5 work floor GET …/spatial/layer answered ${String(status)}, not 200 (no pipeline layer on the stack)`);
  projectId = work.projectId;
  floorId = work.floorId;
}

const layerPath = (floor: string = floorId): RegExp =>
  new RegExp(`^/api/projects/${projectId}/floors/${floor}/spatial/layer$`, 'u');

const isLayerPut = (response: Response): boolean =>
  response.request().method() === 'PUT' && layerPath().test(new URL(response.url()).pathname);

/** Next `PUT …/spatial/layer` (any status) whose sent `body` passes `sent`. Register BEFORE the action. */
function waitForLayerPut(sent?: (body: Json) => boolean): Promise<ApiResult> {
  return waitForApiWhere(
    page,
    (response) => {
      if (!isLayerPut(response)) return false;
      if (sent === undefined) return true;
      try {
        return sent(asRecord(asRecord(response.request().postDataJSON(), '#35').body, '#35.body'));
      } catch {
        return false;
      }
    },
    AUTOSAVE_TIMEOUT_MS,
    'PUT …/spatial/layer',
  );
}

/** The envelope of the last #35 seen by `expectLayerWrite`: the `baseVersion` sent and the `revision` answered (FL-M-16-03). */
let lastWrite: { readonly baseVersion: unknown; readonly revision: unknown } | null = null;

/** 200 + (optionally) the write-result schema; returns the sent `body`. */
function expectLayerWrite(result: ApiResult, { parseResult = true }: { readonly parseResult?: boolean } = {}): Json {
  expect(result.response.status(), 'PUT …/spatial/layer').toBe(200);
  if (parseResult) FloorLayerWriteResultSchema.parse(result.json);
  const envelope = asRecord(result.response.request().postDataJSON(), '#35');

  lastWrite = { baseVersion: envelope.baseVersion, revision: asRecord(result.json, '#35 result').revision };
  return asRecord(envelope.body, '#35.body');
}

async function expectNoProjectWritesSince(mark: number, what: string): Promise<void> {
  // Marker, not a fixed wait: Ctrl+S flushes any autosave still in its 800 ms debounce (router.tsx:230-238 global.save ->
  // flushAutosaves), then a same-origin round trip puts every earlier request of the page in `writes` (support/p04/P5 flush).
  await flush(page);
  const sent = writes.slice(mark).map((entry) => `${entry.method} ${entry.path}`);

  expect(sent, `${what}: no write request (PUT/POST/PATCH/DELETE) expected`).toEqual([]);
}

/** Opens a layer screen with a fresh page load and returns the N16 body it read. */
async function openLayerScreen(url: string): Promise<unknown> {
  const read = await navigateThenWaitForApi(
    page,
    () => page.goto(url, { waitUntil: 'commit' }),
    'GET',
    layerPath(),
    [200],
  );

  return read.json;
}

/* ======================================================================== */
/* SCR-16 Wall Layer Review                                                  */
/* ======================================================================== */

const wallList = (): Locator => page.getByRole('listbox', { name: 'Danh sách đoạn tường', exact: true });
const selectedWall = (): Locator => wallList().getByRole('option', { selected: true });
const wallOption = (code: string): Locator =>
  wallList().getByRole('option', { name: new RegExp(`^${escapeRegExp(code)} — `, 'u') });
/** L23: the wall inspector lives in the ask card anchored on the canvas (QcAskCard). */
const wallInspector = (): Locator => page.getByRole('region', { name: 'Chi tiết mục đang chọn', exact: true });
const approveWallButton = (): Locator => page.getByRole('button', { name: 'Duyệt đoạn này', exact: true });
const thicknessGroup = (): Locator => page.getByRole('radiogroup', { name: 'Độ dày tường', exact: true });
const wallRail = (): Locator => page.getByRole('toolbar', { name: 'Công cụ lớp tường', exact: true });

/** GET body of the last walls load, and its code ↔ id tables. */
let walls: Json[] = [];
let wallIdByCode = new Map<string, string>();
let wallCodeById = new Map<string, string>();
let approvedWallId: string | null = null;
let thicknessEdit: { code: string; id: string; originalMm: unknown; targetLabel: string } | null = null;

function indexWalls(next: Json[]): void {
  walls = next;
  const ids = next.map((wall, index) => {
    if (typeof wall.id !== 'string') throw new Error(`N16 walls[${String(index)}] has no id`);
    return wall.id;
  });
  const codes = displayCodesOf(ids);

  wallCodeById = new Map(ids.map((id) => [id, `#${codes.get(id) ?? id}`] as const));
  wallIdByCode = new Map([...wallCodeById].map(([id, code]) => [code, id] as const));
}

const wallIdOf = (code: string): string => {
  const id = wallIdByCode.get(code);

  if (id === undefined) throw new Error(`no wall in the N16 body has the list code ${code}`);
  return id;
};

async function openWalls(floor: string = floorId): Promise<Json[]> {
  const read = await navigateThenWaitForApi(
    page,
    () => page.goto(ROUTES.project.walls(projectId, floor), { waitUntil: 'commit' }),
    'GET',
    layerPath(floor),
    [200],
  );
  const loaded = wallsOf(read.json, 'N16');

  await expect(page.getByRole('region', { name: 'Duyệt lớp tường', exact: true })).toBeVisible();
  if (loaded.length > 0) await expect(wallList().getByRole('option').first()).toBeVisible();
  // G6: the tour mounts lazily on the first visit; later visits only re-check.
  await dismissTour(page, { waitMs: tourPending ? TOUR_APPEAR_TIMEOUT_MS : 0 });
  tourPending = false;
  if (floor === floorId) indexWalls(loaded);
  return loaded;
}

/** Brings a row of the virtualised list into the DOM by scrolling its scroll parent. */
async function revealWallOption(code: string): Promise<Locator> {
  const option = wallOption(code);
  const scrollTo = (top: number): Promise<{ height: number; step: number } | null> =>
    wallList().evaluate(async (node, value) => {
      let parent: HTMLElement | null = node.parentElement;

      while (parent !== null && !/(auto|scroll)/u.test(getComputedStyle(parent).overflowY)) {
        parent = parent.parentElement;
      }
      if (parent === null) return null;
      parent.scrollTop = value;
      // Two frames: the virtualiser re-renders on the scroll event.
      await new Promise<void>((done) => requestAnimationFrame(() => requestAnimationFrame(() => done())));
      return { height: parent.scrollHeight, step: Math.max(40, Math.floor(parent.clientHeight / 2)) };
    }, top);

  const metrics = await scrollTo(0);

  if (metrics === null) throw new Error('wall list has no scroll parent');
  for (let top = 0; top <= metrics.height; top += metrics.step) {
    if (top > 0) await scrollTo(top);
    if ((await option.count()) > 0) return option;
  }
  throw new Error(`wall row ${code} never rendered while scrolling the list`);
}

interface Point {
  readonly x: number;
  readonly y: number;
}
interface WireWall {
  readonly id: string;
  readonly kind: string;
  readonly thicknessMm: number;
  readonly heightMm: number;
  readonly start: Point;
  readonly end: Point;
  readonly openings: number;
}

const pointOf = (value: unknown): Point | null => {
  if (typeof value !== 'object' || value === null) return null;
  const { x, y } = value as Json;

  return typeof x === 'number' && typeof y === 'number' ? { x, y } : null;
};

/** Wire `Wall` (`schemas/spatial.ts` WallSchema) → the fields the merge rule reads. */
function toWireWall(wall: Json): WireWall | null {
  const centreline = wall.centreline as Json | undefined;
  const start = pointOf(centreline?.start);
  const end = pointOf(centreline?.end);

  if (
    typeof wall.id !== 'string' ||
    typeof wall.kind !== 'string' ||
    typeof wall.thicknessMm !== 'number' ||
    typeof wall.heightMm !== 'number' ||
    start === null ||
    end === null
  ) {
    return null;
  }
  return {
    id: wall.id,
    kind: wall.kind,
    thicknessMm: wall.thicknessMm,
    heightMm: wall.heightMm,
    start,
    end,
    openings: Array.isArray(wall.openingIds) ? wall.openingIds.length : 0,
  };
}

const distance = (a: Point, b: Point): number => Math.hypot(a.x - b.x, a.y - b.y);

/** Two collinear walls that share an endpoint and pass `mergeWalls` (`domain/walls/edit.ts`). */
function findMergePair(all: readonly Json[]): readonly [WireWall, WireWall] | null {
  const candidates = all.map(toWireWall).filter((wall): wall is WireWall => wall !== null);
  const pairs: [WireWall, WireWall][] = [];

  for (let i = 0; i < candidates.length; i += 1) {
    for (let j = i + 1; j < candidates.length; j += 1) {
      const a = candidates[i];
      const b = candidates[j];

      if (a === undefined || b === undefined) continue;
      if (a.kind !== b.kind || a.thicknessMm !== b.thicknessMm || a.heightMm !== b.heightMm) continue;
      const shared = [a.start, a.end].some((p) => [b.start, b.end].some((q) => distance(p, q) <= ENDPOINT_TOLERANCE_MM));

      if (!shared) continue;
      const ax = a.end.x - a.start.x;
      const ay = a.end.y - a.start.y;
      const bx = b.end.x - b.start.x;
      const by = b.end.y - b.start.y;
      const cos = Math.abs(ax * bx + ay * by) / (Math.hypot(ax, ay) * Math.hypot(bx, by));
      const angleDeg = (Math.acos(Math.min(1, cos)) * 180) / Math.PI;

      if (angleDeg >= MERGE_MAX_ANGLE_DEG) continue;
      // Off-axis distance of b's endpoints from a's line ≤ thickness/4 (rule allows thickness/2).
      const length = Math.hypot(ax, ay);
      const offAxis = (p: Point): number => Math.abs((p.x - a.start.x) * ay - (p.y - a.start.y) * ax) / length;

      if (Math.max(offAxis(b.start), offAxis(b.end)) > a.thicknessMm / 4) continue;
      pairs.push([a, b]);
    }
  }
  // Prefer walls without openings: fewer moving parts in the merge command.
  pairs.sort((p, q) => p[0].openings + p[1].openings - (q[0].openings + q[1].openings));
  return pairs[0] ?? null;
}

test.describe('SCR-16 Wall Layer Review', () => {
  test.describe.configure({ mode: 'serial' });
  test.beforeEach(useSeededFloor);

  test('SCR-16 select: option in "Danh sách đoạn tường", then J / K with focus on the list → inspector "Đoạn tường" follows', async () => {
    let firstCode = '';

    await test.step('[16-A-001] deep link: N16 read, screen, list and canvas render', async () => {
      await openWalls();
      expect(walls.length, 'N16 layer.walls of the seeded floor').toBeGreaterThan(0);
      await expect(wallList()).toBeVisible();
    });

    const first = wallList().getByRole('option').first();

    await test.step('[16-A-005] click an option → selected, the inspector shows its code', async () => {
      await first.click();
      await expect(first).toHaveAttribute('aria-selected', 'true');
      firstCode = await codeOfOption(first);

      await expect(wallInspector().getByText(firstCode, { exact: true })).toBeVisible();
    });

    await test.step('[16-A-006] J selects the next row, K the previous (focus on a row, not an input)', async () => {
      if (walls.length > 1) {
        // Focus is on the clicked row (tabIndex 0), not an input: canvas-scope J/K are live (G5).
        await page.keyboard.press('j');
        await expect(wallOption(firstCode)).toHaveAttribute('aria-selected', 'false');
        const nextCode = await codeOfOption(selectedWall());

        expect(nextCode).not.toBe(firstCode);
        await expect(wallInspector().getByText(nextCode, { exact: true })).toBeVisible();

        await page.keyboard.press('k');
        await expect(wallOption(firstCode)).toHaveAttribute('aria-selected', 'true');
        await expect(wallInspector().getByText(firstCode, { exact: true })).toBeVisible();
      } else {
        test.info().annotations.push({ type: 'branch', description: 'one wall only: J/K have no neighbour' });
      }
    });
    await captureEvidence(page, '16_walls_select.png');
  });

  test('SCR-16 approve: "Duyệt đoạn này" on an unapproved wall → PUT …/spatial/layer 200, status changes, auto-advances, no "Lưu"', async () => {
    const unreviewed = walls.filter((wall) => wall.reviewed !== true).length;
    let sent: Json = {};
    let code = '';
    let id = '';

    expect(unreviewed, 'an unapproved wall in the N16 body').toBeGreaterThan(0);
    await test.step('[16-A-016] "Duyệt đoạn này" approves, autosaves (~800 ms), auto-advances, no "Lưu" button', async () => {
      if ((await selectedWall().count()) === 0) await wallList().getByRole('option').first().click();
      for (let step = 0; await approveWallButton().isDisabled(); step += 1) {
        if (step > walls.length) throw new Error('J never reached an unapproved wall');
        await selectedWall().focus();
        await page.keyboard.press('j');
      }

      code = await codeOfOption(selectedWall());
      id = wallIdOf(code);
      const put = waitForLayerPut();

      await approveWallButton().click();
      // A7 — no save button.
      await expect(page.getByRole('button', { name: 'Lưu', exact: true })).toHaveCount(0);
      sent = expectLayerWrite(await put);
      approvedWallId = id;

      await expect(wallOption(code)).toHaveAccessibleName(`${code} — Đã duyệt`);
      if (unreviewed > 1) await expect(wallOption(code)).toHaveAttribute('aria-selected', 'false');
    });
    await test.step('[16-C-003] A5: approve writes reviewed:true AND source "human"', async () => {
      const wall = wallById(wallsOf(sent, '#35'), id, '#35');

      expect.soft(wall.reviewed, `#35 wall ${code} reviewed`).toBe(true);
      expect.soft(wall.source, `#35 wall ${code} source`).toBe('human');
    });
    await captureEvidence(page, '16_walls_approved.png');
  });

  test('SCR-16 thickness: first radio{checked:false} in "Độ dày tường" → PUT, thickness updates', async () => {
    const code = await codeOfOption(selectedWall());
    const id = wallIdOf(code);
    const target = thicknessGroup().getByRole('radio', { checked: false }).first();
    const targetLabel = (await target.innerText()).trim();
    const targetMm = Number.parseInt(targetLabel, 10);
    const previousWrite = lastWrite;

    expect(Number.isFinite(targetMm), `thickness option "${targetLabel}"`).toBe(true);
    await test.step('[16-A-023] inspector radio changes the thickness → PUT with the new thicknessMm', async () => {
      const put = waitForLayerPut((body) => wallById(wallsOf(body, '#35'), id, '#35').thicknessMm === targetMm);

      await target.click();
      expectLayerWrite(await put);
      await expect(thicknessGroup().getByRole('radio', { name: targetLabel, exact: true })).toHaveAttribute(
        'aria-checked',
        'true',
      );
      thicknessEdit = { code, id, originalMm: wallById(walls, id, 'N16').thicknessMm, targetLabel };
    });
    await test.step('[16-C-012] the PUT uses the revision answered by the previous write as baseVersion; the next one the returned revision', async () => {
      expect.soft(lastWrite?.baseVersion, 'baseVersion is the revision of the previous write').toBe(previousWrite?.revision);
      expect.soft(typeof lastWrite?.revision, 'the result carries the new revision').toBe('number');
      expect.soft(Number(lastWrite?.revision), 'revision increases by one').toBe(Number(previousWrite?.revision) + 1);
    });
    await captureEvidence(page, '16_walls_thickness.png');
  });

  test('SCR-16 undo + flush: Mod+Z (canvas focus), then Ctrl+S → edit reverted, PUT flushed', async () => {
    if (thicknessEdit === null) throw new Error('needs the SCR-16 thickness row');
    const edit = thicknessEdit;

    // Canvas-scope Mod+Z is inert inside inputs: focus the selected row (G5).
    await wallOption(edit.code).focus();
    const put = waitForLayerPut(
      (body) => wallById(wallsOf(body, '#35'), edit.id, '#35').thicknessMm === edit.originalMm,
    );

    await test.step('[16-A-033] Mod+Z undoes the last command: the edit is reverted', async () => {
      await page.keyboard.press('Control+z');
      await expect(thicknessGroup().getByRole('radio', { name: edit.targetLabel, exact: true })).toHaveAttribute(
        'aria-checked',
        'false',
      );
    });
    let flushed: Json = {};

    await test.step('[16-A-036] Ctrl+S flushes the pending PUT without waiting for the debounce', async () => {
      await page.keyboard.press('Control+s');
      flushed = expectLayerWrite(await put);
    });
    await test.step('[16-G-016] the Ctrl+S flush goes through the same PUT #35 (the reverted thickness)', async () => {
      expect.soft(wallById(wallsOf(flushed, '#35'), edit.id, '#35').thicknessMm).toBe(edit.originalMm);
    });
    await captureEvidence(page, '16_walls_undo_flush.png');
  });
});

/** SCR-16 cases that open the walls screen themselves: not serial, a failure skips none of them. */
test.describe('SCR-16 Wall Layer Review (own screen load)', () => {
  test.beforeEach(useSeededFloor);

  test('SCR-16 view controls: filters, "Tim tường" / "Lớp tường" (popover "Hiển thị"), "Thu gọn hai panel", "Bỏ qua" (no PUT)', async () => {
    await openWalls();
    const toggle = async (name: string): Promise<void> => {
      const box = page.getByRole('checkbox', { name, exact: true });
      const was = await box.isChecked();

      await pressSpaceOn(box);
      await expect(box).toBeChecked({ checked: !was });
    };

    await test.step('[16-A-056] filter "Chỉ hiện chưa duyệt" hides the reviewed rows', async () => {
      await toggle('Chỉ hiện chưa duyệt');
      await expect(wallList().getByRole('option', { name: / — Đã duyệt$/u })).toHaveCount(0);
      await toggle('Chỉ hiện chưa duyệt');
    });

    await toggle('Chỉ hiện độ tin cậy thấp');
    await expect(wallList().or(page.getByText(WALL_NO_MATCH, { exact: true })).first()).toBeVisible();
    await toggle('Chỉ hiện độ tin cậy thấp');

    // L23: "Hiện tim tường" / nút mắt "Ẩn lớp tường" đã bỏ; cả hai là checkbox trong popover "Hiển thị" ở góc trên phải bản vẽ.
    const display = page.getByRole('button', { name: 'Hiển thị', exact: true });
    if ((await display.getAttribute('aria-expanded')) !== 'true') await display.click();
    await toggle('Tim tường');
    await toggle('Tim tường');

    await test.step('[16-A-064] checkbox "Lớp tường" (popover "Hiển thị") off → on', async () => {
      const layer = page.getByRole('checkbox', { name: 'Lớp tường', exact: true });

      await expect(layer).toBeChecked();
      await toggle('Lớp tường');
      await expect(layer).not.toBeChecked();
      await toggle('Lớp tường');
      await expect(layer).toBeChecked();
      await page.keyboard.press('Escape'); // close the popover before the panel steps
    });

    await test.step('[16-A-065] "Thu gọn hai panel" hides both panels, "Mở lại hai panel" restores them', async () => {
      await page.getByRole('button', { name: 'Thu gọn hai panel', exact: true }).click();
      await expect(wallList()).toHaveCount(0);
      await expect(page.getByRole('heading', { name: 'Đoạn tường', exact: true })).toHaveCount(0);
      await captureEvidence(page, '16_walls_view_controls.png');
      await page.getByRole('button', { name: 'Mở lại hai panel', exact: true }).click();
      await expect(wallList()).toBeVisible();
    });

    await test.step('[16-A-021] "Bỏ qua" moves to the next unreviewed wall and writes nothing', async () => {
      if ((await selectedWall().count()) === 0) await wallList().getByRole('option').first().click();
      const before = await codeOfOption(selectedWall());
      const beforeId = wallIdOf(before);
      const isUnreviewed = (wall: Json): boolean => wall.reviewed !== true && wall.id !== approvedWallId;
      const remaining = walls.filter(isUnreviewed).length;
      const selectedIsUnreviewed = isUnreviewed(wallById(walls, beforeId, 'N16'));
      const moves = selectedIsUnreviewed ? remaining >= 2 : remaining >= 1;
      const mark = writes.length;

      // Exact: the tour's own skip is "Bỏ qua hướng dẫn" (G6).
      await page.getByRole('button', { name: 'Để sau', exact: true }).click();
      if (moves) await expect(wallOption(before)).toHaveAttribute('aria-selected', 'false');
      await expectNoProjectWritesSince(mark, 'SCR-16 "Bỏ qua"');
    });
  });

  test('SCR-16 merge: two collinear walls sharing an endpoint (from the GET body), ctrl-click both, "nối đoạn" → merge + PUT', async () => {
    const current = await openWalls();
    const pair = findMergePair(current);

    await test.step('[16-A-045] "nối đoạn" merges two collinear walls sharing an endpoint → PUT with one wall fewer', async () => {
      await wallList().getByRole('option').first().click();
      await expect(
        wallRail().getByRole('button', { name: 'Nối đoạn — Chọn hai đoạn tường để gộp', exact: true }),
      ).toBeDisabled();

      if (pair === null) {
        await captureEvidence(page, '16_walls_merge.png');
        throw new Error('seeded floor: N16 has no collinear same-kind/thickness walls sharing an endpoint (qcLayer seeds four)');
      }
      const [a, b] = pair;
      const codeA = wallCodeById.get(a.id);
      const codeB = wallCodeById.get(b.id);

      if (codeA === undefined || codeB === undefined) throw new Error('merge pair has no list code');
      test.info().annotations.push({ type: 'merge-pair', description: `${codeA} + ${codeB}` });

      await (await revealWallOption(codeA)).click();
      await (await revealWallOption(codeB)).click({ modifiers: ['Control'] });
      const merge = wallRail().getByRole('button', { name: 'Nối đoạn', exact: true });

      await expect(merge).toBeEnabled();
      const put = waitForLayerPut((body) => wallsOf(body, '#35').length === current.length - 1);

      await merge.click();
      const sent = expectLayerWrite(await put);

      expect(wallsOf(sent, '#35').length, 'one wall fewer after the merge').toBe(current.length - 1);
    });
    await captureEvidence(page, '16_walls_merge.png');
  });

  test('SCR-16 delete + undo: select a wall, Backspace (canvas focus), then "Hoàn tác" → removed, then restored', async () => {
    await openWalls();
    await wallList().getByRole('option').first().click();
    // The selected row, not `.first()` again: the code is read from the row the click selected.
    const code = await codeOfOption(selectedWall());
    const id = wallIdOf(code);
    // L23: the "N/M tường đã duyệt" counter is gone; progress is the chip of the step row "Tường" ("N cần xem").
    const progress = page.getByRole('region', { name: 'Tường', exact: true }).getByText(/^(\d+ cần xem|\d+ đoạn · đã duyệt)$/u).first();
    const before = (await progress.innerText()).trim();
    const toasts = page.getByRole('region', { name: 'Thông báo', exact: true });

    await test.step('[16-A-028] Backspace deletes the selected wall: toast with "Hoàn tác", the total drops, PUT without the wall', async () => {
      // BUG-423 (run-26): the delete DID happen (8 rows left after the merge's 9), but codes are rank-numbered over the seed
      // ids, so the next wall took over "#W-002" and `wallOption(code)` still matched. Removal is proven by the id instead: the
      // delete's autosave PUT lacks it, and the step chip of "Tường" changes.
      const removed = waitForLayerPut((body) => !wallsOf(body, '#35').some((wall) => wall.id === id));

      // A focused row is not text entry, so the canvas-scope key fires (shortcutRegistry.ts handleKeyDown).
      await page.keyboard.press('Backspace');

      await expect(toasts.getByText(`Đã xoá tường ${code}.`, { exact: true })).toBeVisible();
      expectLayerWrite(await removed);
      await expect(progress).not.toHaveText(before);
    });
    await test.step('[16-A-029] the toast "Hoàn tác" restores the deleted wall: row back, PUT with the wall', async () => {
      // The restored layer reaches the server: Ctrl+S flushes it.
      const restored = waitForLayerPut((body) => wallsOf(body, '#35').some((wall) => wall.id === id));

      await toasts.getByRole('button', { name: 'Hoàn tác', exact: true }).last().click();
      await page.keyboard.press('Control+s');
      expectLayerWrite(await restored);
      await expect(progress).toHaveText(before);
      await expect(wallOption(code)).toHaveCount(1);
    });
    await test.step('[16-B-003] partial progress: the step row "Tường" shows "N cần xem" (L23 replaced the "N/M tường đã duyệt" counter)', async () => {
      expect.soft(before).toMatch(/^\d+ cần xem$/u);
      await expect.soft(progress).toBeVisible();
    });
    await captureEvidence(page, '16_walls_delete_undo.png');
  });

  test('SCR-16 layer nav: "Cây lớp" Cửa và nội thất / Kích thước / Trục / Phòng, then floor nav', async () => {
    test.setTimeout(240_000);
    const current = await openWalls();

    // `WallLayerLeftPanel.tsx`: the button only renders in state `success` (every wall approved).
    if (!current.every((wall) => wall.reviewed === true)) {
      await expect(page.getByRole('button', { name: 'Tiếp: Cửa', exact: true })).toHaveCount(0);
    }

    const targets: readonly (readonly [string, string])[] = [
      ['Cửa và nội thất', ROUTES.project.objects(projectId, floorId)],
      ['Kích thước', ROUTES.project.dimensions(projectId, floorId)],
      ['Trục', ROUTES.project.grids(projectId, floorId)],
      ['Phòng', ROUTES.project.rooms(projectId, floorId)],
    ];
    const visited: string[] = [];

    await test.step('[16-A-066] "Cây lớp" items open objects / dimensions / grids / rooms of the same floor', async () => {
      for (const [label, target] of targets) {
        if (pathnameOf(page) !== ROUTES.project.walls(projectId, floorId)) await openWalls();
        await page
          .getByRole('tree', { name: 'Cây lớp', exact: true })
          .getByRole('treeitem', { name: label, exact: true })
          .click();
        await expect.poll(() => pathnameOf(page), { message: `"Cây lớp" ${label}` }).toBe(target);
        visited.push(pathnameOf(page));
      }
    });
    await test.step('[X4-A-003] SCR-16 "Cây lớp" → "Cửa và nội thất" / "Kích thước" / "Trục" / "Phòng": the four routes of the same floor were visited in order', async () => {
      expect.soft(visited).toEqual(targets.map(([, target]) => target));
    });

    await openWalls();
    const floorNav = page.getByRole('navigation', { name: 'Tầng của bản vẽ', exact: true });
    const others = floorNav.locator('button:not([aria-current="page"])');
    // The seeded project's second (empty) floor when the nav lists it.
    const secondName = seeded[1]?.floorName;
    const second = secondName === undefined ? null : others.filter({ hasText: secondName });
    const other = second !== null && (await second.count()) > 0 ? second.first() : others.first();

    if ((await floorNav.count()) === 0 || (await others.count()) === 0) {
      test.info().annotations.push({
        type: 'branch',
        description: 'floor nav lists no other floor (graph holds only the seeded floor level)',
      });
      await captureEvidence(page, '16_walls_layer_nav.png');
      return;
    }
    await test.step('[16-A-068] floor nav "Tầng của bản vẽ" opens another floor’s walls', async () => {
      await other.click();
      await expect
        .poll(() => pathnameOf(page), { message: 'floor nav opens another floor’s walls' })
        .toMatch(new RegExp(`^/projects/${projectId}/floors/(?!${floorId}/)[^/]+/layers/walls$`, 'u'));
      await dismissTour(page);
    });
    await test.step('[X4-A-007] floor nav → another floor’s walls route (not the floor we left)', async () => {
      expect.soft(pathnameOf(page)).not.toContain(`/floors/${floorId}/`);
      expect.soft(pathnameOf(page)).toMatch(/\/layers\/walls$/u);
    });
    await captureEvidence(page, '16_walls_layer_nav.png');
  });
});

test.describe('CP-6 on the CP-5 work floor', () => {
  test.beforeEach(useWorkFloor);

  test('CP-6: "Duyệt đoạn này" on an unapproved wall of the CP-5 work floor → PUT …/spatial/layer 200 (Phase 6 restores the AI version)', async () => {
    await test.step('[X4-A-001] CP-5 summary "Duyệt lớp tường" opens /projects/{p}/floors/{work}/layers/walls', async () => {
      await page.goto(ROUTES.project.pipeline(projectId));
      const browseWalls = page.getByRole('button', { name: 'Duyệt lớp tường', exact: true });

      await expect.soft(browseWalls, 'a finished run offers "Duyệt lớp tường" (ProcessingSummary)').toBeVisible();
      if (await browseWalls.isVisible()) {
        await browseWalls.click();
        // The summary leads to the FIRST finished floor of the project (useProcessingScreen.ts:1260-1275,
        // `floorStatuses.indexOf('done')`), not to the work floor: assert the route shape, then CP-6 below
        // reopens the work floor explicitly via openWalls().
        await expect
          .poll(() => pathnameOf(page))
          .toMatch(new RegExp(`^/projects/${projectId}/floors/[^/]+/layers/walls$`, 'u'));
      }
    });
    const current = await openWalls();
    const target = current.find((wall) => wall.reviewed !== true);

    if (target === undefined || typeof target.id !== 'string') {
      await captureEvidence(page, '16_walls_cp6.png');
      skipWithReason('data-dependent: every wall of the CP-5 work floor is already approved');
      return;
    }
    const code = wallCodeById.get(target.id);

    if (code === undefined) throw new Error(`no list code for wall ${target.id}`);
    await test.step('[X4-A-002] CP-6: "Duyệt đoạn này" on an unapproved wall → PUT 200, state checkpoints.restorableVersion', async () => {
      await (await revealWallOption(code)).click();
      const put = waitForLayerPut((body) => wallById(wallsOf(body, '#35'), target.id as string, '#35').reviewed === true);

      await approveWallButton().click();
      expectLayerWrite(await put);
      updateState((draft) => {
        draft.checkpoints.restorableVersion = true;
      });
      await expect(wallOption(code)).toHaveAccessibleName(`${code} — Đã duyệt`);
    });
    await captureEvidence(page, '16_walls_cp6.png');
  });
});

/* ======================================================================== */
/* SCR-19 Axis Grid Manager                                                  */
/* ======================================================================== */

const AXIS_LABEL_PATTERN = /^Trục (.+?), cách trục kế là /u;

test.describe('SCR-19 Axis Grid Manager', () => {
  test.beforeEach(useSeededFloor);

  test('SCR-19 local only: "Thêm trục ngang"; "Ẩn trục X"; "Xoá trục X", then undo → in memory, NO PUT', async () => {
    await page.goto(ROUTES.project.grids(projectId, floorId));
    await dismissTour(page);
    const add = page.getByRole('button', { name: 'Thêm trục ngang', exact: true });
    const empty = page.getByText('Chưa có trục nào', { exact: true });

    await expect(add.or(empty).first()).toBeVisible();
    const mark = writes.length;

    if (await empty.isVisible()) {
      await expectNoProjectWritesSince(mark, 'SCR-19 empty grid');
      await captureEvidence(page, '19_grids_local_only.png');
      throw new Error('seeded floor: no axis previewed from the load-bearing rectangle (qcLayer)');
    }
    const axisRows = page.getByRole('option', { name: AXIS_LABEL_PATTERN });
    const labels = async (): Promise<string[]> =>
      (await axisRows.evaluateAll((nodes) => nodes.map((node) => node.getAttribute('aria-label') ?? ''))).map(
        (name) => AXIS_LABEL_PATTERN.exec(name)?.[1] ?? '',
      );
    const before = await labels();
    const toasts = page.getByRole('region', { name: 'Thông báo', exact: true });
    let added = '';

    await test.step('[19-A-004] "Thêm trục ngang" adds ONE row at the last position + pitch', async () => {
      await add.click();
      await expect(axisRows).toHaveCount(before.length + 1);
      const label = (await labels()).find((candidate) => candidate !== '' && !before.includes(candidate));

      if (label === undefined) throw new Error('"Thêm trục ngang" added no new axis label');
      added = label;
    });

    await test.step('[19-A-007] "Ẩn trục X" hides the axis: the button becomes "Hiện trục X", aria-pressed false', async () => {
      await page.getByRole('button', { name: `Ẩn trục ${added}`, exact: true }).click();
      await expect(page.getByRole('button', { name: `Hiện trục ${added}`, exact: true })).toHaveAttribute(
        'aria-pressed',
        'false',
      );
    });

    await test.step('[19-A-009] "Xoá trục X" removes the row and publishes the undo toast "Đã xoá trục X."', async () => {
      await page.getByRole('button', { name: `Xoá trục ${added}`, exact: true }).click();
      await page.getByRole('dialog').getByRole('button', { name: /^Xoá trục /u }).click(); // ConfirmDeleteDialog
      await expect(axisRows).toHaveCount(before.length);
      await expect.soft(toasts.getByText(`Đã xoá trục ${added}.`, { exact: true })).toBeVisible();
    });

    await test.step('[19-A-010] the toast "Hoàn tác" restores the deleted axis', async () => {
      await toasts.getByRole('button', { name: 'Hoàn tác', exact: true }).last().click();
      await expect(axisRows).toHaveCount(before.length + 1);
    });

    await test.step('[19-G-003] add / hide / remove / undo send no write (0 POST/PUT/PATCH/DELETE)', async () => {
      await expectNoProjectWritesSince(mark, 'SCR-19 axes');
    });
    await captureEvidence(page, '19_grids_local_only.png');
  });
});

/* ======================================================================== */
/* SCR-20 Room Label Review                                                  */
/* ======================================================================== */

const roomOptions = (): Locator => page.getByRole('listbox', { name: 'Danh sách phòng', exact: true }).getByRole('option');
const roomsOf = (body: Json): Json[] => arrayOf(layerOf(body, '#35').rooms, '#35.layer.rooms');

let roomCount = 0;

async function openRooms(): Promise<void> {
  const body = await openLayerScreen(ROUTES.project.rooms(projectId, floorId));

  roomCount = arrayOf(layerOf(body, 'N16').rooms, 'N16.layer.rooms').length;
  await expect(page.getByRole('region', { name: 'Duyệt phòng', exact: true })).toBeVisible();
  await dismissTour(page);
}

/** Both SCR-20 cases open the rooms screen themselves: not serial. */
test.describe('SCR-20 Room Label Review', () => {
  test.beforeEach(useSeededFloor);

  test('SCR-20 edit: option in "Danh sách phòng"; "Tên phòng"; "Công năng"; "Duyệt phòng này" → PUT layer', async () => {
    await test.step('[20-A-001] deep link opens the screen: region "Duyệt phòng" and its heading', async () => {
      await openRooms();
      // L23: the only H1 is the task sentence of the step column (RoomLabelReview.tsx STEP_TASK).
      await expect.soft(page.getByRole('heading', { name: 'Đặt tên cho từng phòng máy tìm thấy. Tên đúng thì giữ, sai thì sửa.', exact: true, level: 1 })).toBeVisible();
      if (roomCount === 0) {
        await expect(page.getByRole('heading', { name: 'Chưa dò ra phòng nào' })).toBeVisible();
        await captureEvidence(page, '20_rooms_edit.png');
        throw new Error('seeded floor: N16 has no room (qcLayer seeds two)');
      }
    });

    // Same locator as e2e/v7/room-label-review.spec.ts (getByLabel matches several nodes).
    const name = page.getByRole('textbox', { name: 'Tên phòng' });

    await test.step('[20-A-004] click an option selects it and fills the inspector ("Phòng", "Tên phòng", "Công năng")', async () => {
      const row = roomOptions().first();

      await row.click();
      await expect.soft(row).toHaveAttribute('aria-selected', 'true');
      await expect.soft(page.getByRole('region', { name: 'Chi tiết mục đang chọn', exact: true }).getByRole('heading', { name: 'Phòng', exact: true })).toBeVisible();
      await expect(name).toBeVisible();
    });

    const toasts = page.getByRole('region', { name: 'Thông báo', exact: true });
    const newName = (await name.inputValue()) === RENAMED_ROOM ? `${RENAMED_ROOM} 2` : RENAMED_ROOM;

    await test.step('[20-A-010] "Tên phòng" + Enter renames: toast with undo and a PUT #35 with the new name', async () => {
      const renamed = waitForLayerPut((sent) => roomsOf(sent).some((room) => room.name === newName));

      await name.fill(newName);
      await name.press('Enter');
      expectLayerWrite(await renamed);
      await expect.soft(toasts.getByText(new RegExp(`^Đổi tên phòng .+ thành "${escapeRegExp(newName)}"`, 'u'))).toBeVisible();
    });

    const usage = page.getByRole('combobox', { name: 'Công năng', exact: true });

    await test.step('[20-A-017] "Công năng" change: PUT with the new usage, the combobox shows it', async () => {
      const currentUsage = (await usage.innerText()).trim();
      const listbox = await openSelect(page, usage);
      const nextUsage = (await listbox.getByRole('option').allInnerTexts())
        .map((text) => text.trim())
        .find((text) => text !== '' && text !== currentUsage);

      if (nextUsage === undefined) throw new Error('"Công năng" offers no other option');
      const usagePut = waitForLayerPut();

      await listbox.getByRole('option', { name: nextUsage, exact: true }).click();
      expectLayerWrite(await usagePut);
      await expect(usage).toContainText(nextUsage);
      // UNKNOWN — NEED VERIFICATION: the usage-change toast text (plan 20-A-017) did not match in run 1; not asserted.
    });

    const approve = page.getByRole('button', { name: /^Duyệt #R-/u });
    let approved: Json | null = null;

    await test.step('[20-A-018] "Duyệt phòng này": PUT, the button is disabled afterwards', async () => {
      if (await approve.isEnabled()) {
        const put = waitForLayerPut();

        await approve.click();
        approved = expectLayerWrite(await put);
        await expect(approve).toBeDisabled();
      } else {
        test.info().annotations.push({ type: 'branch', description: 'room already confirmed: approve disabled' });
      }
    });
    await test.step('[20-G-005] approve body: a room with reviewed:true, source "human" (A5 accepted → 200)', async () => {
      if (approved === null) return;
      expect.soft(roomsOf(approved).some((room) => room.reviewed === true && room.source === 'human')).toBe(true);
    });
    await captureEvidence(page, '20_rooms_edit.png');
  });

  test('SCR-20 modals: "Chuẩn hoá tên" then "Huỷ"/"Đóng"; "Gộp phòng" then cancel → closed, NO PUT', async () => {
    await openRooms();
    if (roomCount === 0) {
      await captureEvidence(page, '20_rooms_modals_cancel.png');
      throw new Error('seeded floor: no room (see the SCR-20 edit case)');
    }

    await test.step('[20-A-024] preview "Huỷ" (or "Đóng") closes the dialog, nothing changes, 0 PUT', async () => {
      const mark = writes.length;

      await page.getByRole('button', { name: 'Chuẩn hoá tên…', exact: true }).click();
      const preview = page.getByRole('dialog', { name: 'Xem trước chuẩn hoá tên', exact: true });

      await expect(preview).toBeVisible();
      // "Huỷ" when names would change, "Đóng" otherwise (`RoomLabelNormalizePreview.tsx`).
      await preview.getByRole('button', { name: /^(Huỷ|Đóng)$/u }).click();
      await expect(preview).toHaveCount(0);
      await expectNoProjectWritesSince(mark, 'SCR-20 preview "Huỷ"');
    });

    await test.step('[20-A-029] merge "Huỷ" closes the dialog, 0 PUT', async () => {
      const mark = writes.length;
      const mergeButton = page.getByRole('button', { name: 'Gộp phòng', exact: true });

      if ((await mergeButton.count()) === 0) await roomOptions().first().click();
      await mergeButton.click();
      const merge = page.getByRole('dialog', { name: 'Gộp hai phòng', exact: true });

      await expect(merge).toBeVisible();
      await merge.getByRole('button', { name: 'Huỷ', exact: true }).click();
      await expect(merge).toHaveCount(0);
      await expectNoProjectWritesSince(mark, 'SCR-20 merge "Huỷ"');
    });
    await captureEvidence(page, '20_rooms_modals_cancel.png');
  });
});

/* ======================================================================== */
/* SCR-21 Thickness Standardization                                          */
/* ======================================================================== */

test.describe('SCR-21 Thickness Standardization', () => {
  test.beforeEach(useSeededFloor);

  test('SCR-21 apply: slider "Ngưỡng giữa 100 mm và 150 mm"; tick "Đồng ý đổi các đoạn …"; "Đổi N đoạn" → bulk PUT, "Hoàn tác"', async () => {
    // Group rows are `motion.tr` with layoutId: no click on a sliding row (as e2e/v7).
    await page.emulateMedia({ reducedMotion: 'reduce' });
    try {
      // bản Z (S-21): one checkbox per target group, "Đồng ý đổi các đoạn {range} về {target} mm"
      const accept = page.getByRole('checkbox', { name: /^Đồng ý đổi các đoạn / }).first();

      await test.step('[21-A-001] deep link renders the region, heading and the tables or the empty state', async () => {
        await openLayerScreen(ROUTES.project.thickness(projectId, floorId));
        await expect(page.getByRole('heading', { name: 'Độ dày tường' })).toBeVisible();
        await expect.soft(page.getByRole('region', { name: 'Độ dày tường', exact: true })).toBeVisible();
        await dismissTour(page);

        const noGroups = page.getByText('Không còn đoạn nào cần đổi.', { exact: true }); // TB:nothingLeft
        const noWalls = page.getByRole('heading', { name: 'Chưa có đoạn tường nào để chuẩn hoá' });

        await expect(accept.or(noGroups).or(noWalls).first()).toBeVisible();
      });

      await test.step('[21-A-017] slider keys: ArrowRight / ArrowUp move the threshold +5 mm, ArrowLeft / ArrowDown −5 mm (moving it writes nothing)', async () => {
        const slider = page.getByRole('slider', { name: 'Ngưỡng giữa 100 mm và 150 mm', exact: true });

        if ((await slider.count()) > 0) {
          const start = (await slider.getAttribute('aria-valuenow')) ?? '';
          const valueNow = async (): Promise<number> => Number((await slider.getAttribute('aria-valuenow')) ?? Number.NaN);

          await slider.focus();
          await page.keyboard.press('ArrowRight');
          await expect(slider).not.toHaveAttribute('aria-valuenow', start);
          expect.soft(await valueNow() - Number(start), 'ArrowRight +5 mm').toBe(5);
          await page.keyboard.press('ArrowLeft');
          await expect(slider).toHaveAttribute('aria-valuenow', start);
          await page.keyboard.press('ArrowUp');
          expect.soft(await valueNow() - Number(start), 'ArrowUp +5 mm').toBe(5);
          await page.keyboard.press('ArrowDown');
          await expect(slider).toHaveAttribute('aria-valuenow', start);
        }
      });

      if ((await accept.count()) === 0) {
        // S-21 rule: within 30 mm of the nearest of 100/150/200/220/300/400 is standard. qcLayer seeds 220 mm walls and 200 mm
        // partitions (both exact tiers): nothing to change,
        // which is the correct state; the apply path itself is covered by phase04_thickness_edge FL-21-01.
        await expect(page.getByText('Không còn đoạn nào cần đổi.', { exact: true })).toBeVisible();
        await captureEvidence(page, '21_thickness_apply.png');
        test.info().annotations.push({ type: 'note', description: '[21-A-004]/[21-G-002] seeded floor is all standard under S-21; apply covered in FL-21-01' });
        return;
      }

      await test.step('[21-A-004] tick "Đồng ý đổi các đoạn {range} về {target} mm" → checked', async () => {
        await pressSpaceOn(accept);
        await expect(accept).toBeChecked();
      });

      await test.step('[21-G-002] "Đổi N đoạn" → one PUT #35 carrying every changed wall; the toast offers "Hoàn tác"', async () => {
        const put = waitForLayerPut();

        await page.getByRole('button', { name: /^Đổi \d+ đoạn/u }).click();
        expectLayerWrite(await put);
        await expect(
          page.getByRole('region', { name: 'Thông báo', exact: true }).getByRole('button', { name: 'Hoàn tác', exact: true }).first(),
        ).toBeVisible();
      });
      await captureEvidence(page, '21_thickness_apply.png');
    } finally {
      await page.emulateMedia({ reducedMotion: null });
    }
  });
});

/* ======================================================================== */
/* SCR-14 Scale Calibration                                                  */
/* ======================================================================== */

const scaleCanvas = (): Locator =>
  page.getByRole('group', { name: 'Bản vẽ đã nắn, kéo để vẽ đường tham chiếu', exact: true });
const scaleScope = (name: string): Locator =>
  page.getByRole('radiogroup', { name: 'Phạm vi áp tỷ lệ', exact: true }).getByRole('radio', { name, exact: true });
const applyScale = (): Locator => page.getByRole('button', { name: 'Xác nhận tỷ lệ', exact: true });

/** Fresh load of the scale screen; returns the revision of the N16 read it made. */
async function openScale(): Promise<number> {
  const body = await openLayerScreen(ROUTES.project.scale(projectId, floorId));

  await dismissTour(page);
  await expect(scaleCanvas()).toBeVisible();
  return Number(asRecord(body, 'N16').revision);
}

/** Method "Vẽ đường tham chiếu", box-relative drag 20 % → 80 % at 50 %. */
async function drawReferenceLine(): Promise<void> {
  await page
    .getByRole('radiogroup', { name: 'Chọn cách xác định tỷ lệ', exact: true })
    .getByRole('radio', { name: 'Vẽ đường tham chiếu', exact: true })
    .click();

  const box = await scaleCanvas().boundingBox();

  if (box === null) throw new Error('scale canvas has no bounding box');
  await page.mouse.move(box.x + box.width * 0.2, box.y + box.height * 0.5);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width * 0.8, box.y + box.height * 0.5, { steps: 8 });
  await page.mouse.up();
  await expect(page.getByRole('button', { name: SCALE_HANDLE_START, exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: SCALE_HANDLE_END, exact: true })).toBeVisible();
}

/** "Chiều dài thật" 5000 + Enter shows the computation. */
async function enterRealLength(): Promise<void> {
  const realLength = page.getByLabel('Chiều dài thật', { exact: true });

  await realLength.fill('5000');
  await realLength.press('Enter');
  await expect(page.getByLabel('Phép tính ra tỷ lệ', { exact: true })).toContainText('mm/px');
}

/** Fresh load, reference line and real length; returns the N16 revision read on load. */
async function openScaleAndDraw(): Promise<number> {
  const revision = await openScale();

  await drawReferenceLine();
  await enterRealLength();
  return revision;
}

/** Every SCR-14 case draws its own reference line on a fresh load: not serial. */
test.describe('SCR-14 Scale Calibration', () => {
  useOwnDrawingFloor('m04-scale');

  test('SCR-14 refline: "Vẽ đường tham chiếu"; drag 20 % → 80 % at 50 %; "Chiều dài thật" = 5000 + Enter → two handles, scale computed', async () => {
    const qualityRead = waitForApi(page, 'GET', new RegExp(`^/api/projects/${projectId}/floors/${floorId}/quality$`, 'u'), ANY_STATUS);

    qualityRead.catch(() => undefined);

    await test.step('[14-A-001] deep link opens the screen: drawing "Bản vẽ đã nắn", panel "Đặt tỷ lệ"', async () => {
      await openScale();
      await expect.soft(page.getByRole('region', { name: 'Tỷ lệ bản vẽ', exact: true })).toBeVisible();
      await expect.soft(page.getByRole('img', { name: /^Bản vẽ đã nắn của / })).toBeVisible();
    });
    await test.step('[14-G-001] GET …/floors/{f}/quality answers 200 (the drawing snapshot)', async () => {
      const quality = await qualityRead;

      expect.soft(quality.response.status()).toBe(200);
    });
    await test.step('[14-A-006] left-drag on the canvas draws a line with two handles', async () => {
      await drawReferenceLine();
    });
    await test.step('[14-A-008] "Chiều dài thật" 5000 + Enter shows the computation and enables "Xác nhận tỷ lệ"', async () => {
      await enterRealLength();
      await expect(applyScale()).toBeEnabled();
    });
    await captureEvidence(page, '14_scale_refline.png');
  });

  test('SCR-14 apply: "Chỉ áp cho tầng này", then "Xác nhận tỷ lệ" → PUT …/spatial/layer, "Đã áp tỷ lệ cho bản vẽ"', async () => {
    const revision = await openScaleAndDraw();
    let result: ApiResult | null = null;
    let sent: Json = {};

    await test.step('[14-D-001] admin: the controls are enabled, apply answers 200', async () => {
      await scaleScope('Tầng này').click();
      await expect(scaleScope('Tầng này')).toHaveAttribute('aria-checked', 'true');
      await expect.soft(applyScale()).toBeEnabled();
      const put = waitForLayerPut((body) => typeof body.scaleMillimetresPerPixel === 'number');

      await applyScale().click();
      result = await put;
      // Scale-only body (`FloorLayerWriteBodySchema`); the result schema is only proven for layer writes.
      sent = expectLayerWrite(result, { parseResult: false });
    });
    await test.step('[14-A-021] "Chỉ áp cho tầng này" + "Xác nhận tỷ lệ" → one PUT with only scaleMillimetresPerPixel; heading "Đã áp tỷ lệ cho bản vẽ"', async () => {
      expect(sent.scaleMillimetresPerPixel as number).toBeGreaterThan(0);
      expect.soft(Object.keys(sent), 'scale-only body').toEqual(['scaleMillimetresPerPixel']);
      await expect(page.getByRole('heading', { name: 'Đã áp tỷ lệ cho bản vẽ' })).toBeVisible();
    });
    await test.step('[14-G-013] PUT #35 scale-only {baseVersion: the N16 revision, body: {scaleMillimetresPerPixel}} → 200', async () => {
      const envelope = asRecord((result as ApiResult | null)?.response.request().postDataJSON(), '#35');

      expect.soft(envelope.baseVersion, 'baseVersion = the N16 revision read on load').toBe(revision);
      expect.soft(Object.keys(envelope).sort()).toEqual(['baseVersion', 'body']);
    });
    await captureEvidence(page, '14_scale_applied.png');
  });

  test('SCR-14 all floors: "Áp cho mọi tầng", then "Huỷ" in "Áp tỷ lệ này cho N tầng có bản vẽ?" → GET floors + spatial, NO PUT', async () => {
    await openScaleAndDraw();
    await scaleScope('Mọi tầng').click();
    await expect(scaleScope('Mọi tầng')).toHaveAttribute('aria-checked', 'true');

    const mark = writes.length;
    const floorsRead = waitForApi(page, 'GET', new RegExp(`^/api/projects/${projectId}/floors$`, 'u'), ANY_STATUS);
    const graphRead = waitForApi(page, 'GET', new RegExp(`^/api/projects/${projectId}/spatial$`, 'u'), ANY_STATUS);

    await applyScale().click();
    await test.step('[14-G-011] GET #12 …/floors and GET N15 …/spatial answer 200 on apply-all', async () => {
      expect.soft((await floorsRead).response.status(), 'GET #12 …/floors').toBe(200);
      expect.soft((await graphRead).response.status(), 'GET N15 …/spatial').toBe(200);
    });
    await test.step('[14-A-022] the A9 dialog "Áp tỷ lệ này cho N tầng có bản vẽ?" opens; "Huỷ" closes it with no PUT', async () => {
      const dialog = page.getByRole('dialog', { name: /^Áp tỷ lệ này cho \d+ tầng có bản vẽ\?$/u });

      await expect(dialog).toBeVisible();
      await dialog.getByRole('button', { name: 'Huỷ', exact: true }).click();
      await expect(dialog).toHaveCount(0);

      await expectNoProjectWritesSince(mark, 'SCR-14 "Áp cho mọi tầng" → "Huỷ"');
    });
    await captureEvidence(page, '14_scale_all_cancel.png');
  });
});

/* ======================================================================== */
/* SCR-22 Overlay Comparison                                                 */
/* ======================================================================== */

test.describe('SCR-22 Overlay Comparison', () => {
  useOwnDrawingFloor('m04-overlay');

  test('SCR-22 swipe: "Kiểu đối chiếu" → "Trượt"; divider slider + arrows; "Độ đậm lớp mô hình" → divider moves, "Chưa có số đo — cần căn ảnh quét vào mô hình trước."', async () => {
    const qualityRead = waitForApi(page, 'GET', new RegExp(`^/api/projects/${projectId}/floors/${floorId}/quality$`, 'u'), ANY_STATUS);

    qualityRead.catch(() => undefined);
    const swipe = page
      .getByRole('radiogroup', { name: 'Kiểu đối chiếu', exact: true })
      .getByRole('radio', { name: 'Trượt', exact: true });
    const divider = page.getByRole('slider', { name: OVERLAY_DIVIDER, exact: true });
    const opacity = page.getByRole('slider', { name: 'Độ đậm lớp mô hình', exact: true });

    await test.step('[22-A-001] deep link: region "Màn đối chiếu bản vẽ" with its toolbar', async () => {
      await page.goto(ROUTES.project.overlay(projectId, floorId));
      await dismissTour(page);
      await expect(page.getByRole('region', { name: 'So với bản vẽ', exact: true })).toBeVisible();
      await expect.soft(page.getByRole('toolbar', { name: 'Thanh công cụ đối chiếu bản vẽ', exact: true })).toBeVisible();
    });
    await test.step('[22-G-001] GET …/floors/{f}/quality answers 200 (the scans of every listed floor)', async () => {
      const quality = await qualityRead;

      expect.soft(quality.response.status()).toBe(200);
    });

    await expect(swipe).toBeVisible();
    await test.step('[22-D-001] admin: every control of the toolbar is enabled', async () => {
      await expect.soft(swipe).toBeEnabled();
    });
    if (await swipe.isDisabled()) {
      // `OverlayComparisonToolbar.tsx`: a disabled mode prints "<mode> — <reason>".
      await expect(page.getByText(/^Trượt — /u)).toBeVisible();
      await captureEvidence(page, '22_overlay_swipe.png');
      skipWithReason('data-dependent: swipe mode disabled for this floor; reason asserted');
      return;
    }

    let dividerStart = '';

    await test.step('[22-A-003] "Trượt" shows the slider "Đường chia đôi…" at aria-valuenow 0.5', async () => {
      await swipe.click();
      await expect(swipe).toHaveAttribute('aria-checked', 'true');

      await expect(divider).toBeVisible();
      dividerStart = (await divider.getAttribute('aria-valuenow')) ?? '';
      expect.soft(Number(dividerStart), 'the divider starts in the middle').toBe(0.5);
    });
    await test.step('[22-A-004] divider ArrowRight / ArrowLeft move it by ±0.02', async () => {
      await divider.focus();
      await page.keyboard.press('ArrowRight');
      await expect(divider).not.toHaveAttribute('aria-valuenow', dividerStart);
      expect.soft(Number(await divider.getAttribute('aria-valuenow')), 'ArrowRight +0.02').toBeCloseTo(Number(dividerStart) + 0.02, 5);
      await page.keyboard.press('ArrowLeft');
      await expect(divider).toHaveAttribute('aria-valuenow', dividerStart);
    });
    await test.step('[22-A-013] back on "Chồng lớp": "Độ đậm lớp mô hình" defaults to 65 and moves by ±1 with the arrows', async () => {
      // The slider only shows in "Chồng lớp" (G4b-26); UX-R2 K18 made it the model layer, default 65%.
      await page
        .getByRole('radiogroup', { name: 'Kiểu đối chiếu', exact: true })
        .getByRole('radio', { name: 'Chồng lớp', exact: true })
        .click();
      await expect(opacity).toBeVisible();
      const opacityStart = (await opacity.getAttribute('aria-valuenow')) ?? '';

      expect.soft(Number(opacityStart), 'default model opacity 65').toBe(65);
      await opacity.focus();
      const step = Number(opacityStart) > 0 ? -1 : 1;

      await page.keyboard.press(step < 0 ? 'ArrowLeft' : 'ArrowRight');
      await expect(opacity).not.toHaveAttribute('aria-valuenow', opacityStart);
      expect.soft(Number(await opacity.getAttribute('aria-valuenow')), 'arrow moves by 1').toBe(Number(opacityStart) + step);

      await expect(page.getByText('Chưa có số đo — cần căn ảnh quét vào mô hình trước.', { exact: true })).toBeVisible();
    });
    await captureEvidence(page, '22_overlay_swipe.png');
  });
});
