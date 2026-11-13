/**
 * QA-04c P6 helpers for the SCR-14 scale flows (`phase04_scale_{edge,mocked_edge,ui}.spec.ts`). Owned by P6 only.
 *
 * Seeds (all through the real API, as the file's pool admin `p04-scale`: its own `drawings_init` bucket):
 *   D1  = {@link seedD1}  env drawing after the fake-ML run: warped (FRAME_NOT_FOUND), provisional scale, AI layer.
 *   DF  = {@link seedDF}  framed drawing (`framedPng()`, `frame.isFound`): the only way to empty / partial / forbidden.
 *   DM  = {@link seedDM}  several floors, the env drawing on every floor (all measured).
 *   W2  = {@link staleWrite} one #35 PUT from the API at the page's base → the page's next save meets 409.
 * {@link sharedDrawingFloor} builds one D1 per file worker (`beforeAll`) for the read-only flows.
 *
 * Request budget per D1/DF: POST /api/projects 1, GET project 1, upload init/chunk/complete 3 (init counts against the
 * pool admin's `drawings_init` bucket), #8 polls every 2 s, N16 1, DELETE 1.
 */
import { expect, type APIRequestContext, type Locator, type Page } from '@playwright/test';

import { ROUTES } from '../../../../e2e/fixtures/routes';
import { signedInApi } from '../api';
import { readAdminCredentials } from '../auth';
import { createMeasuredFloorsProject, createPipelineDrawingProject, deleteSeededProject, type SeededDrawing } from '../drawingSeed';
import { layerPathOf, qcLayer, writeLayer, type LayerApi } from '../layerSeed';
import { framedPng } from '../p03/P12';
import { corruptPng, envDrawingPng, poolUser, uploadDrawing, waitForRunOutcome, type PoolUser } from '../phase03Seed';
import { createStackProject } from '../p03/P5';

export { corruptPng, deleteSeededProject, envDrawingPng, framedPng, poolUser, type PoolUser, type SeededDrawing };

export type Json = Record<string, unknown>;

/** Pool slot of the admin that owns every P6 project with a drawing. */
export const P6_SLOT = 'p04-scale';
export const DESKTOP = { width: 1440, height: 900 } as const;
export const PROJECTS = '/api/projects';

/* ---- copy (each cites its source; SC ScaleCalibration.tsx, SCP …Panel.tsx, SMR …MethodReference.tsx, USC useScaleCalibration.ts) ---- */
export const SCALE = {
  screen: 'Tỷ lệ bản vẽ', // SC:66
  canvasRegion: 'Khung bản vẽ để hiệu chỉnh tỷ lệ', // SC:67
  notice: 'Trạng thái của màn hiệu chỉnh tỷ lệ', // SC:68
  canvas: 'Bản vẽ đã nắn, kéo để vẽ đường tham chiếu', // SCV:69
  handleStart: 'Đầu đoạn tham chiếu, dùng phím mũi tên để nhích', // SCV:72
  handleEnd: 'Cuối đoạn tham chiếu, dùng phím mũi tên để nhích', // SCV:73
  panel: 'Bảng hiệu chỉnh tỷ lệ', // SCP:41
  methods: 'Chọn cách xác định tỷ lệ', // SCP:49
  methodDimension: 'Từ chuỗi kích thước', // USC COPY.methodDimensionString
  reference: 'Vẽ đường tham chiếu', // USC COPY.methodReferenceLine
  methodDisabledNotice: 'Không đọc được chuỗi kích thước nào trên bản vẽ này, nên chỉ còn cách vẽ đường tham chiếu.', // USC COPY
  realLength: 'Chiều dài thật', // SMR:39
  realHint: 'Không có chuỗi kích thước nào gần đoạn này để gợi ý.', // SMR:41
  realInvalid: 'Chiều dài thật phải là một số lớn hơn 0, ví dụ 4800.', // USC COPY.realLengthInvalid
  remeasure: 'Đo lại', // SMR:42
  incomplete: 'Còn thiếu một vế, nên chưa ra được tỷ lệ.', // SCP:55
  apply: 'Xác nhận tỷ lệ', // SCP:59
  applying: 'Đang lưu tỷ lệ…', // SCP:60
  scope: 'Phạm vi áp tỷ lệ', // SCP:61
  thisFloor: 'Tầng này', // USC COPY.scopeThisFloor
  allFloors: 'Mọi tầng', // USC COPY.scopeAllFloors
  collapse: 'Thu gọn bảng', // SCP:43
  expand: 'Bung bảng', // SCP:44
  badge: 'Đã duyệt', // SCP:45
  current: 'Tỷ lệ hiện tại', // SCP:47
  shortcuts: 'Phím tắt', // SCP:50
  computation: 'Phép tính ra tỷ lệ', // SCP:52
  crossChecks: 'Ba đại lượng dẫn xuất để kiểm chứng tỷ lệ', // SCP:57
  backToPreprocessing: 'Quay lại bước tiền xử lý', // SC:76
  retry: 'Tải lại ảnh', // SC:77
  goToUpload: 'Tải bản vẽ lên', // SC:78
  warpedTitle: 'Không tìm thấy khung bản vẽ, ảnh có thể chưa thẳng', // SC:72
  warpedBody: 'Bước tiền xử lý đã xong nhưng máy không tìm thấy khung bản vẽ, nên ảnh có thể chưa được nắn thẳng. Nếu thấy ảnh méo, quay lại bước tiền xử lý để nắn lại, vì tỷ lệ đo trên ảnh méo sẽ sai theo.', // USC COPY.warpingNotice
  provisional: 'Tỷ lệ tạm — số đo chưa tin được, hãy hiệu chỉnh tỷ lệ.', // lib/viewmodel/provisionalScale.ts
  emptyTitle: 'Chưa có chuỗi kích thước nào để đối chiếu', // SMD EMPTY_TITLE / SC:70
  emptyBody: 'Bản vẽ này không có chuỗi kích thước nào OCR đọc được. Vẽ một đường tham chiếu dọc cạnh đã biết, rồi nhập chiều dài thật của nó.', // USC COPY.emptyNotice
  partialTitle: 'Chưa đủ dữ liệu để chốt tỷ lệ', // SC:71
  partialBody: 'Đã có đoạn tham chiếu nhưng chưa có chiều dài thật, hoặc một số chuỗi kích thước đọc được với độ tin cậy thấp.', // USC COPY.partialNotice
  successTitle: 'Đã áp tỷ lệ cho bản vẽ', // SC:73
  successBody: 'Mọi kích thước dẫn xuất đã được tính lại theo tỷ lệ mới.', // USC COPY.successNotice
  forbiddenTitle: 'Bạn không có quyền hiệu chỉnh tỷ lệ', // SC:74
  noDrawingTitle: 'Tầng này chưa có bản vẽ', // USC COPY.noDrawingTitle
  noDrawingBody: 'Chưa có bản vẽ nào được tải lên cho tầng này. Tải bản vẽ lên và chờ bước tiền xử lý xong rồi mới hiệu chỉnh tỷ lệ.', // USC COPY.noDrawingNotice
  failed: 'Chưa lưu được tỷ lệ lên máy chủ, tầng giữ tỷ lệ cũ.', // USC COPY.applyFailed
  noSpatial: 'Chưa nạp dữ liệu không gian của tầng này, nên chưa áp được tỷ lệ.', // USC COPY.applyNoSpatial
  listFailed: 'Không tải được danh sách tầng để áp tỷ lệ.', // USC COPY.allFloorsReadFailed
  undoProvisional: 'Đã đặt lại tỷ lệ máy; tầng ghi là bạn chấp nhận số máy, độ tin giữ như máy báo.', // USC COPY.undoProvisional
  undo: 'Hoàn tác', // undo toast action
  statusBar: 'Thanh trạng thái', // StatusBar
} as const;

/** Machine-sentence copy shared with the BE (src/i18n/vi.json `errors.*`). */
export const ERR = {
  unknown: 'Hệ thống đã ghi nhận và sẽ kiểm tra. Hãy thử lại sau ít phút.',
  network: 'Không liên lạc được với máy chủ. Kiểm tra mạng rồi thử lại.',
  notFound: 'Nội dung này có thể đã bị xoá, hoặc đường dẫn chưa đúng.',
  conflict: 'Bản vẽ đã được người khác cập nhật. Tải lại để xem phiên bản mới nhất.',
  validation: 'Kiểm tra lại các trường được đánh dấu rồi thử lại.',
} as const;

/* ---- owner, seeds ------------------------------------------------------------------------------ */

export interface Owner {
  readonly user: PoolUser;
  readonly api: APIRequestContext;
  dispose(): Promise<void>;
}

/** Pool admin `p04-scale` with a Bearer API client (2 logins: the main admin for the pool lookup, then the owner). */
export async function openOwner(): Promise<Owner> {
  const { email, password } = readAdminCredentials();
  const main = await signedInApi(email, password);
  try {
    const user = await poolUser(main, 'admin', P6_SLOT);
    const api = await signedInApi(user.email, user.password);
    return { user, api, dispose: () => api.dispose() };
  } finally {
    await main.dispose();
  }
}

/** D1: the env drawing after a finished fake-ML run (warped, provisional scale). */
export const seedD1 = (api: APIRequestContext, slug: string): Promise<SeededDrawing> => createPipelineDrawingProject(api, slug, envDrawingPng());

/** DF: a framed drawing after a finished run (`frame.isFound`): empty / partial / forbidden-for-viewer states. */
export const seedDF = (api: APIRequestContext, slug: string): Promise<SeededDrawing> => createPipelineDrawingProject(api, slug, framedPng());

/** DM: `floorNames` with the env drawing on EVERY floor (all measured). */
export const seedDM = (api: APIRequestContext, slug: string, floorNames: readonly string[]): ReturnType<typeof createMeasuredFloorsProject> =>
  createMeasuredFloorsProject(api, slug, envDrawingPng(), floorNames);

export interface MultiFloorSeed {
  readonly projectId: string;
  readonly floors: readonly { readonly id: string; readonly name: string }[];
  /** Outcome of the run of each upload, in the order given. */
  readonly runs: readonly { readonly floorId: string; readonly outcome: 'completed' | 'failed'; readonly error: string }[];
}

/**
 * Project with `floorNames` and one upload per `uploads` entry (`index` = floor position): DM (4 floors, 2 env drawings),
 * DM' (1 drawing of 4), or a floor whose run FAILED (`corruptPng()`). Waits for every run to end; deletes the project on any
 * setup failure. Budget: one `drawings_init` per upload, #8 polls every 2 s.
 */
export async function seedFloors(
  api: APIRequestContext,
  slug: string,
  floorNames: readonly string[],
  uploads: readonly { readonly index: number; readonly png: Buffer }[],
): Promise<MultiFloorSeed> {
  const created = await createStackProject(
    api,
    slug,
    floorNames.map((name, order) => ({ name, elevationMm: order * 3_000, heightMm: 3_000 })),
  );
  try {
    const sent: { floorId: string; uploadId: string }[] = [];
    for (const upload of uploads) {
      const floor = created.floors[upload.index];
      if (floor === undefined) throw new Error(`setup: no floor #${String(upload.index)}`);
      sent.push({ floorId: floor.id, uploadId: await uploadDrawing(api, created.projectId, floor.id, upload.png, `${created.name}-${String(upload.index)}.png`) });
    }
    const runs = [];
    for (const item of sent) {
      const outcome = await waitForRunOutcome(api, created.projectId, item.uploadId);
      runs.push({ floorId: item.floorId, outcome: outcome.status, error: outcome.error ?? '' });
    }
    return { projectId: created.projectId, floors: created.floors.map((f) => ({ id: f.id, name: f.name })), runs };
  } catch (error) {
    await deleteSeededProject(api, created.projectId);
    throw error;
  }
}

const asRecord = (value: unknown, what: string): Json => {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) throw new Error(`${what}: not a JSON object`);
  return value as Json;
};

/** Fixture calls of `api` (it carries Origin + Bearer itself). */
export const layerApi = (api: APIRequestContext): LayerApi => ({ request: api, headers: {} });

/** W2: one #35 PUT at the floor's current revision (a fresh QC layer: random ids, so every call bumps the revision); the page that loaded earlier now holds a stale base. */
export async function staleWrite(api: APIRequestContext, floor: { readonly projectId: string; readonly floorId: string }): Promise<void> {
  await writeLayer(layerApi(api), floor.projectId, floor.floorId, qcLayer);
}

/** N16 `revision` and the level's stored `scaleMillimetresPerPixel` (read-back for the persisted ratio). */
export async function readLevel(api: APIRequestContext, projectId: string, floorId: string): Promise<{ revision: number; scale: number | null }> {
  const res = await api.get(layerPathOf(projectId, floorId));
  expect(res.status(), `read-back: GET ${layerPathOf(projectId, floorId)}`).toBe(200);
  const doc = asRecord(await res.json(), 'N16');
  const scale = asRecord(doc.level, 'N16.level').scaleMillimetresPerPixel;
  return { revision: Number(doc.revision), scale: typeof scale === 'number' ? scale : null };
}

/** Pixel size of the floor's drawing as the screen sees it (#30 `measurement`). */
export async function readImageSize(api: APIRequestContext, projectId: string, floorId: string): Promise<{ w: number; h: number }> {
  const res = await api.get(`${PROJECTS}/${projectId}/floors/${floorId}/quality`);
  expect(res.status(), 'read-back: GET …/quality (#30)').toBe(200);
  const floors = asRecord(await res.json(), '#30').floors;
  const row = (Array.isArray(floors) ? floors : []).map((f) => asRecord(f, 'floor')).find((f) => f.floorId === floorId);
  const m = asRecord(row?.measurement, '#30 measurement');
  return { w: Number(m.widthPx), h: Number(m.heightPx) };
}

function fail(what: string): never {
  throw new Error(what);
}

/** A D1 shared by the read-only flows of one file worker: built in `beforeAll`, deleted in `afterAll`. */
export interface SharedFloor {
  floor(): SeededDrawing;
  size(): { w: number; h: number };
  owner(): Owner;
  setup(): Promise<void>;
  teardown(): Promise<void>;
}

export function sharedDrawingFloor(slug: string): SharedFloor {
  let owner: Owner | undefined;
  let floor: SeededDrawing | undefined;
  let size: { w: number; h: number } | undefined;
  return {
    floor: () => floor ?? fail('shared D1 not built'),
    size: () => size ?? fail('shared D1 not built'),
    owner: () => owner ?? fail('owner not opened'),
    async setup() {
      owner = await openOwner();
      floor = await seedD1(owner.api, slug);
      size = await readImageSize(owner.api, floor.projectId, floor.floorId);
    },
    async teardown() {
      if (owner !== undefined && floor !== undefined) await deleteSeededProject(owner.api, floor.projectId);
      await owner?.dispose();
    },
  };
}

/* ---- screen helpers ---------------------------------------------------------------------------- */

export const pathOf = (page: Page): string => new URL(page.url()).pathname;
export const canvasOf = (page: Page): Locator => page.getByRole('group', { name: SCALE.canvas, exact: true });
export const panelOf = (page: Page): Locator => page.getByRole('region', { name: SCALE.panel, exact: true });
export const noticeOf = (page: Page): Locator => page.getByRole('region', { name: SCALE.notice, exact: true });
export const lengthField = (page: Page): Locator => page.getByLabel(SCALE.realLength, { exact: true });
export const btn = (scope: Page | Locator, name: string): Locator => scope.getByRole('button', { name, exact: true });
export const applyBtn = (page: Page): Locator => page.getByRole('button', { name: /^(Xác nhận tỷ lệ|Đang lưu tỷ lệ…)$/u });
export const computationOf = (page: Page): Locator => page.getByRole('region', { name: SCALE.computation, exact: true });
export const handleStart = (page: Page): Locator => btn(page, SCALE.handleStart);
export const handleEnd = (page: Page): Locator => btn(page, SCALE.handleEnd);
export const scopeRadio = (page: Page, name: string): Locator =>
  page.getByRole('radiogroup', { name: SCALE.scope, exact: true }).getByRole('radio', { name, exact: true });
export const methodRadio = (page: Page, name: string): Locator =>
  page.getByRole('radiogroup', { name: SCALE.methods, exact: true }).getByRole('radio', { name, exact: true });

/** Screen up with the drawing read: canvas frame + panel footer visible and the image decoded. */
export async function openScale(page: Page, projectId: string, floorId: string): Promise<void> {
  await page.goto(ROUTES.project.scale(projectId, floorId));
  await expect(canvasOf(page)).toBeVisible({ timeout: 45_000 });
  await expect(btn(page, SCALE.remeasure)).toBeVisible({ timeout: 45_000 });
  await expect(canvasOf(page).locator('img')).toHaveJSProperty('complete', true, { timeout: 45_000 });
}

/** Frame box of the canvas (the square the 0..1 coordinates map onto at zoom 1). */
export async function frameBox(page: Page): Promise<{ x: number; y: number; width: number; height: number }> {
  await canvasOf(page).scrollIntoViewIfNeeded();
  const box = await canvasOf(page).boundingBox();
  if (box === null) throw new Error('scale canvas has no bounding box');
  return box;
}

export interface DragOptions {
  readonly shift?: boolean;
  readonly steps?: number;
  /** Release the button (default) or leave it down. */
  readonly release?: boolean;
}

/** Left-drag on the canvas from `from` to `to`, both fractions of the frame. */
export async function dragLine(page: Page, from: readonly [number, number], to: readonly [number, number], options: DragOptions = {}): Promise<void> {
  const box = await frameBox(page);
  const at = (p: readonly [number, number]): readonly [number, number] => [box.x + box.width * p[0], box.y + box.height * p[1]];
  const [sx, sy] = at(from);
  const [ex, ey] = at(to);
  await page.mouse.move(sx, sy);
  if (options.shift === true) await page.keyboard.down('Shift');
  await page.mouse.down();
  await page.mouse.move(ex, ey, { steps: options.steps ?? 8 });
  if (options.release !== false) {
    await page.mouse.up();
    if (options.shift === true) await page.keyboard.up('Shift');
  }
}

/** Parses a vi-VN number label ("4.800,5 mm", "1.234 px") to a number; `NaN` for "—". */
export function numberOf(text: string): number {
  const m = /-?[\d.]+(?:,\d+)?/u.exec(text.replace(/ /gu, ' '));
  return m === null ? Number.NaN : Number(m[0].replace(/\./gu, '').replace(',', '.'));
}

/** Text of the three computation spans: numerator, denominator, result. */
export async function computation(page: Page): Promise<{ numerator: string; denominator: string; result: string }> {
  const texts = (await computationOf(page).locator('span:not([aria-hidden="true"])').allInnerTexts()).map((t) => t.trim());
  return { numerator: texts[0] ?? '', denominator: texts[1] ?? '', result: texts[2] ?? '' };
}

/** `^/api/projects/<p>/floors/<f>/spatial/layer$` (N16 / #35). */
export const layerRe = (projectId: string, floorId: string): RegExp => new RegExp(`^/api/projects/${projectId}/floors/${floorId}/spatial/layer$`, 'u');

/* ---- request tracking and gestures ------------------------------------------------------------ */

export interface Sent {
  readonly method: string;
  readonly path: string;
  readonly body: unknown;
  /** `Date.now()` at the request / at its end (set when the response finished). */
  readonly startedAt: number;
  finishedAt: number | null;
}

/** Every `/api/` request the page sends, in order, with the JSON body of non-GET ones (call before `goto`). */
export function trackRequests(page: Page): Sent[] {
  const sent: Sent[] = [];
  const byRequest = new Map<unknown, Sent>();
  page.on('request', (request) => {
    const url = new URL(request.url());
    if (!url.pathname.startsWith('/api/')) return;
    let body: unknown = null;
    if (request.method() !== 'GET') {
      try {
        body = request.postDataJSON();
      } catch {
        body = request.postData();
      }
    }
    const item: Sent = { method: request.method(), path: url.pathname, body, startedAt: Date.now(), finishedAt: null };
    sent.push(item);
    byRequest.set(request, item);
  });
  const finish = (request: unknown): void => {
    const item = byRequest.get(request);
    if (item !== undefined) item.finishedAt = Date.now();
  };
  page.on('requestfinished', finish);
  page.on('requestfailed', finish);
  return sent;
}

/** Two animation frames: React has committed what the last input did (not a time wait). */
export const flush = (page: Page): Promise<void> =>
  page.evaluate(() => new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))));

/** PUTs to the floor's layer since `from` (an index into the tracked list). */
export const putsSince = (sent: readonly Sent[], from: number, projectId: string, floorId: string): Sent[] =>
  sent.slice(from).filter((r) => r.method === 'PUT' && layerRe(projectId, floorId).test(r.path));

/** Any non-GET request (minus refresh and telemetry) since `from`. */
export const writesSince = (sent: readonly Sent[], from: number): string[] =>
  sent
    .slice(from)
    .filter((r) => r.method !== 'GET' && r.path !== '/api/auth/refresh' && !r.path.startsWith('/api/telemetry'))
    .map((r) => `${r.method} ${r.path}`);

/** `scaleMillimetresPerPixel` of a tracked PUT body (`{baseVersion, body: {…}}`), or NaN. */
export function putRatio(sent: Sent | undefined): number {
  const body = (sent?.body ?? null) as { body?: { scaleMillimetresPerPixel?: unknown } } | null;
  const value = body?.body?.scaleMillimetresPerPixel;
  return typeof value === 'number' ? value : Number.NaN;
}

/** `{x, y}` (0..1 of the frame) of a reference-line handle. */
export async function handleAt(handle: Locator): Promise<{ x: number; y: number }> {
  return handle.evaluate((el) => {
    const style = (el as HTMLElement).style;
    return { x: Number.parseFloat(style.left) / 100, y: Number.parseFloat(style.top) / 100 };
  });
}

/** Zoom factor and translation of the canvas content layer. */
export async function viewOf(page: Page): Promise<{ zoom: number; x: number; y: number }> {
  return canvasOf(page)
    .locator(':scope > div.origin-top-left')
    .evaluate((el) => {
      const m = new DOMMatrixReadOnly(getComputedStyle(el).transform);
      return { zoom: m.a, x: m.e, y: m.f };
    });
}

/** Denominator of the computation as a number (image px), `NaN` for "—". */
export async function pixelsOf(page: Page): Promise<number> {
  return numberOf((await computation(page)).denominator);
}

/** vi-VN label of a ratio like the screen writes it (≤ 3 fraction digits). */
export const ratioLabel = (value: number): string => `${new Intl.NumberFormat('vi-VN', { maximumFractionDigits: 3 }).format(value)} mm/px`;

/** Clears the current line and typed length through the "Đo lại" button. */
export async function clearLine(page: Page): Promise<void> {
  const remeasure = btn(page, SCALE.remeasure);
  if (await remeasure.isEnabled()) await remeasure.click();
  await expect(handleEnd(page)).toHaveCount(0);
}

/** The horizontal reference line 20 % → 80 % at 50 % and its real length, as the specs of SCR-14 use it. */
export async function drawStandard(page: Page, length = '5000'): Promise<void> {
  await dragLine(page, [0.2, 0.5], [0.8, 0.5]);
  await expect(handleEnd(page)).toBeVisible();
  await lengthField(page).fill(length);
}
