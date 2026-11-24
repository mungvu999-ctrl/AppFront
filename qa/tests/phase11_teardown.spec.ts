/**
 * Phase 11: Teardown, Track A (E2E-TEST-PLAN.md v2 §4 Phase 11, rules R1/R2/R5/R6).
 *
 * Order (user requirement): step 0 registry safety → drawing remove+undo → straighten → {scratch} delete
 * (+undo, re-resolve, delete) → delete all floors → delete CP-2 → [opt-in invitee: skipped] → logout via
 * `/khong-co-quyen` → session gate on the deleted project.
 *
 * WHY NOT `mode: 'serial'` (deliberate deviation from the shared structure rule, asked for by the task):
 * in serial mode one failure skips every later test, so a failed drawing/straighten step would leave CP-2
 * alive and the admin signed in (R5 says teardown always runs). Here the file runs in `default` mode with
 * `workers: 1` + `fullyParallel: false` (qa/playwright.config.ts): tests still run one by one in matrix
 * order, and after a failure Playwright starts a fresh worker, re-runs the file-level `beforeAll`
 * (new context, `signInAdmin`) and continues with the NEXT test. Nothing is retried (`retries: 0`).
 *
 * Dependency notes:
 * - Every destructive test first calls `assertRegistrySafe()`: if step 0 did not restore the registry
 *   (`registry.pendingRestore` still true in the state file), they all FAIL before touching anything.
 * - Every destructive test re-checks on the server that the target is CP-2 (`verifyCp2OnServer`).
 * - SCR-38 (logout) does not depend on earlier rows. SCR-01 (gate) needs the logout done in THIS worker;
 *   otherwise it is skipped with the reason.
 */
import { existsSync } from 'node:fs';
import { basename } from 'node:path';

import { expect, test } from '@playwright/test';
import type { BrowserContext, Page, Request, Response } from '@playwright/test';

import { ModelFamilyPageSchema, ModelVersionPageSchema } from '../../src/api/schemas/adminMl';
import { ImageQualityAssessmentSchema } from '../../src/api/schemas/quality';
import { guessFloorFromFileName } from '../../src/lib/upload/validate';
import { ROUTES, loginUrl, pathOf } from '../../e2e/fixtures/routes';
import { navigateThenWaitForApi, waitForApi, waitForApiWhere } from '../../e2e/fullstack/apiWatch';
import { signInAdmin } from './support/auth';
import { attachJson, captureEvidence } from './support/evidence';
import { skipWithReason } from './support/skip';
import { readState, requireState, updateState } from './support/state';

test.describe.configure({ mode: 'default' });

/** CP-2 naming rule (plan §2). */
const CP2_PREFIX = 'E2E-QA-';
/** `FAMILY_LABELS` of `src/screens/admin/ModelRegistry/useModelRegistry.ts` (copied: that module imports React). */
const FAMILY_LABELS: Readonly<Record<string, string>> = {
  wallSegmentation: 'Tách lớp tường',
  openingAndFurnitureDetection: 'Nhận diện cửa và đồ đạc',
  dimensionReading: 'Đọc kích thước',
};
/** The straighten write is a file-sized job (`timeoutMode: 'file'`, `src/api/client.ts`). */
const STRAIGHTEN_TIMEOUT_MS = 120_000;

type Json = Record<string, unknown>;

const escapeRegExp = (text: string): string => text.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&');
const pathnameOf = (page: Page): string => new URL(page.url()).pathname;
const responsePath = (response: Response): string => new URL(response.url()).pathname;
const note = (description: string): void => {
  test.info().annotations.push({ type: 'note', description });
};

const asRecord = (value: unknown, what: string): Json => {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new Error(`${what}: body is not a JSON object`);
  }
  return value as Json;
};

const stringField = (record: Json, key: string, what: string): string => {
  const value = record[key];

  if (typeof value !== 'string' || value === '') throw new Error(`${what}: no string "${key}"`);
  return value;
};

/** `GET /api/projects/:id/floors` returns a bare array of `FloorSchema` (`decodeList`, `src/api/client.ts`). */
const floorsOf = (body: unknown, what: string): { id: string; name: string }[] => {
  if (!Array.isArray(body)) throw new Error(`${what}: body is not an array`);
  return body.map((item, index) => {
    const floor = asRecord(item, `${what}[${String(index)}]`);

    return { id: stringField(floor, 'id', what), name: stringField(floor, 'name', what) };
  });
};

/** Static half of the CP-2 guard: ids from state, name must carry the run prefix. */
function cp2(): { projectId: string; projectName: string } {
  const projectId = requireState((s) => s.project.projectId, 'project.projectId', 'Phase 2 (SCR-05)');
  const projectName = requireState((s) => s.project.projectName, 'project.projectName', 'Phase 2 (SCR-05)');

  if (!projectName.startsWith(CP2_PREFIX)) {
    throw new Error(`REFUSED: project.projectName "${projectName}" does not start with ${CP2_PREFIX}; not CP-2`);
  }
  return { projectId, projectName };
}

/** R2/R5: never touch anything while the registry still waits for its restore. */
function assertRegistrySafe(): void {
  if (readState().registry.pendingRestore) {
    throw new Error('REFUSED: registry.pendingRestore is still true (step 0 did not restore it); teardown aborted');
  }
}

/** The URL being acted on belongs to CP-2. */
function assertUrlIsCp2(page: Page, projectId: string): void {
  const match = /^\/projects\/([^/]+)(?:\/|$)/u.exec(pathnameOf(page));

  if (match?.[1] !== projectId) {
    throw new Error(`REFUSED: URL ${pathnameOf(page)} is not under /projects/${projectId}`);
  }
}

/**
 * Server half of the CP-2 guard: opens Project Settings (it reads `GET /api/projects/:id`,
 * `projectSettingsGateway.ts` `read`) and checks the name. Returns the project's floor ids.
 */
async function verifyCp2OnServer(page: Page): Promise<{ projectId: string; projectName: string; floorIds: Set<string> }> {
  const { projectId, projectName } = cp2();
  const read = await navigateThenWaitForApi(
    page,
    () => page.goto(ROUTES.project.settings(projectId), { waitUntil: 'commit' }),
    'GET',
    new RegExp(`^/api/projects/${escapeRegExp(projectId)}$`, 'u'),
    [200],
  );
  const project = asRecord(read.json, `GET /api/projects/${projectId}`);
  const serverName = stringField(project, 'name', 'project');

  if (serverName !== projectName || !serverName.startsWith(CP2_PREFIX)) {
    throw new Error(`REFUSED: server name "${serverName}" ≠ state "${projectName}" (or lacks ${CP2_PREFIX})`);
  }
  assertUrlIsCp2(page, projectId);
  const floors = project.floors;

  if (!Array.isArray(floors)) throw new Error('project: no "floors" array');
  const floorIds = new Set(floors.map((floor, index) => stringField(asRecord(floor, `floors[${String(index)}]`), 'id', 'floor')));

  return { projectId, projectName, floorIds };
}

let context: BrowserContext;
let page: Page;
/** Set only by this worker's successful rows; SCR-01 needs both. */
let loggedOut = false;
let deletedProjectId: string | null = null;

test.beforeAll(async ({ browser }, testInfo) => {
  const baseURL = testInfo.project.use.baseURL;

  context = await browser.newContext({
    ...(baseURL !== undefined ? { baseURL } : {}),
    viewport: { width: 1440, height: 900 },
  });
  page = await context.newPage();
  await signInAdmin(page);
});

test.afterAll(async () => {
  await context.close();
});

test.describe('SCR-36 Model Registry: step 0 safety (R2/R5)', () => {
  test('SCR-36 step 0: restore the recorded active version when registry.pendingRestore is true', async () => {
    const before = readState();

    if (!before.registry.pendingRestore) {
      note('registry.pendingRestore is false: nothing to restore');
      return;
    }

    try {
      const family = requireState((s) => s.registry.family, 'registry.family', 'Phase 8 (SCR-36)');
      const original = before.registry.originalActiveVersionId;
      const familyLabel = FAMILY_LABELS[family];

      if (original === null) {
        // `null` = no active version; "Kích hoạt" cannot bring that back (only the walls "classic" path could).
        throw new Error(`originalActiveVersionId is null for ${family}; restore it by hand`);
      }
      if (familyLabel === undefined) throw new Error(`unknown family "${family}"`);

      const familiesPath = /^\/api\/admin\/ml\/model-families$/u;

      await page.goto(ROUTES.adminTrainingModels, { waitUntil: 'commit' });
      // Registered after commit (the page's JS has not run yet): both the families read and this family's versions read.
      const familiesRead = waitForApi(page, 'GET', familiesPath, [200]);
      const versionsRead = waitForApiWhere(
        page,
        (response) =>
          response.request().method() === 'GET' &&
          responsePath(response) === '/api/admin/ml/model-versions' &&
          response.url().includes(family) &&
          response.status() === 200,
        undefined,
        `GET /api/admin/ml/model-versions (${family})`,
      );

      // Not awaited on the early-return path: keep its timeout from surfacing as an unhandled rejection.
      versionsRead.catch(() => undefined);
      const families = ModelFamilyPageSchema.parse((await familiesRead).json);
      const current = families.items.find((item) => item.family === family);

      if (current === undefined) throw new Error(`GET model-families has no ${family}`);
      if (current.activeVersionId === original) {
        updateState((draft) => {
          draft.registry.pendingRestore = false;
        });
        note(`${family} already active on ${original}; pendingRestore cleared`);
        return;
      }

      const radio = page
        .getByRole('radiogroup', { name: 'Loại mô hình' })
        .getByRole('radio', { name: new RegExp(escapeRegExp(familyLabel), 'iu') });

      await expect(radio).toBeVisible();
      if (!(await radio.isChecked())) await radio.click();
      const versions = ModelVersionPageSchema.parse((await versionsRead).json);
      const target = versions.items.find((item) => item.id === original);

      if (target === undefined) throw new Error(`original version ${original} is not in the ${family} version list`);

      const activate = waitForApi(
        page,
        'PUT',
        new RegExp(`^/api/admin/ml/model-families/${escapeRegExp(family)}/active$`, 'u'),
        [200],
      );
      const row = page.getByRole('row').filter({ has: page.getByRole('button', { name: target.label, exact: true }) });

      await row.getByRole('button', { name: 'Kích hoạt', exact: true }).click();
      await page.getByRole('dialog').getByRole('button', { name: 'Kích hoạt', exact: true }).click();
      await activate;
      await expect(page.getByRole('dialog')).toHaveCount(0);

      const reread = await navigateThenWaitForApi(
        page,
        () => page.reload({ waitUntil: 'commit' }),
        'GET',
        familiesPath,
        [200],
      );
      const after = ModelFamilyPageSchema.parse(reread.json).items.find((item) => item.family === family);

      if (after?.activeVersionId !== original) {
        throw new Error(`after PUT, ${family} active is ${String(after?.activeVersionId)}, expected ${original}`);
      }
      updateState((draft) => {
        draft.registry.pendingRestore = false;
      });
    } catch (error) {
      throw new Error(
        `REGISTRY NOT RESTORED: every destructive teardown step will refuse to run. Restore it by hand. Cause: ${String(error)}`,
      );
    }
  });
});

test.describe('SCR-10 Floor Upload', () => {
  test('SCR-10 remove drawing then undo (local only, no request)', async () => {
    assertRegistrySafe();
    const { projectId } = await verifyCp2OnServer(page);
    const drawingPng = process.env.E2E_DRAWING_PNG?.trim();

    if (drawingPng === undefined || drawingPng === '' || !existsSync(drawingPng)) {
      throw new Error('E2E_DRAWING_PNG is missing or not a file (same variable as Phase 3 / F-14)');
    }
    const fileName = basename(drawingPng);

    // The card of F_work shows the SERVER drawing, which has no remove control (`removeLabel` needs an
    // in-session attachment, useFloorUploadScreen.ts). Re-adding the same file puts it in the
    // "Tệp chưa gán tầng" tray, whose "Xoá bản vẽ <file>" button is local. A name that guesses a floor
    // would be auto-assigned and uploaded, so refuse that.
    if (guessFloorFromFileName(fileName).ok) {
      throw new Error(`REFUSED: "${fileName}" guesses a floor, adding it would start a real upload`);
    }

    await page.goto(ROUTES.project.upload(projectId));
    await expect(page.getByTestId('floor-upload-dropzone')).toBeVisible();
    assertUrlIsCp2(page, projectId);

    const writes: string[] = [];
    const onRequest = (request: Request): void => {
      const path = new URL(request.url()).pathname;

      if (path.startsWith('/api/') && request.method() !== 'GET' && path !== '/api/auth/refresh') {
        writes.push(`${request.method()} ${path}`);
      }
    };

    page.on('request', onRequest);
    try {
      await page.getByTestId('floor-upload-file-input').setInputFiles(drawingPng);
      const remove = page.getByRole('button', { name: `Xoá bản vẽ ${fileName}`, exact: true });

      await expect(remove).toHaveCount(1);
      await remove.click();
      await expect(remove).toHaveCount(0);

      // The toast is "Đã xoá bản vẽ <file>" + "Hoàn tác" (Toast.tsx); "Hoàn tác xoá bản vẽ …" is the
      // ticket description, not rendered.
      const toast = page.getByRole('status').filter({ hasText: `Đã xoá bản vẽ ${fileName}` });

      await toast.getByRole('button', { name: 'Hoàn tác', exact: true }).click();
      await expect(remove).toHaveCount(1);
      await captureEvidence(page, 'D_10_drawing_remove_undo.png');
    } finally {
      page.off('request', onRequest);
    }
    expect(writes, 'remove + undo of a drawing is local only').toEqual([]);
  });
});

test.describe('SCR-11 Input Quality Gate', () => {
  test('SCR-11 "Tự động nắn" then "Nắn thẳng" (POST quality/straighten with Idempotency-Key)', async () => {
    test.setTimeout(STRAIGHTEN_TIMEOUT_MS + 120_000);
    assertRegistrySafe();
    const { projectId } = await verifyCp2OnServer(page);
    const workFloorId = requireState((s) => s.floors.workFloorId, 'floors.workFloorId', 'Phase 3 (SCR-09)');
    const workFloorName = requireState((s) => s.floors.workFloorName, 'floors.workFloorName', 'Phase 3 (SCR-09)');
    const projectPart = escapeRegExp(projectId);

    const assessment = await navigateThenWaitForApi(
      page,
      () => page.goto(ROUTES.project.quality(projectId), { waitUntil: 'commit' }),
      'GET',
      new RegExp(`^/api/projects/${projectPart}/floors/[^/]+/quality$`, 'u'),
      [200],
    );
    await expect(page.getByRole('region', { name: 'Báo cáo chất lượng' })).toBeVisible();
    assertUrlIsCp2(page, projectId);

    const work = ImageQualityAssessmentSchema.parse(assessment.json).floors.find((floor) => floor.floorId === workFloorId);

    // "Tự động nắn" is only rendered for a SKEW_DETECTED finding (useInputQualityGate.ts `describeFinding`).
    test.skip(
      work === undefined || !work.findings.some((finding) => finding.code === 'SKEW_DETECTED'),
      `data: no SKEW_DETECTED finding for ${workFloorName}, so "Tự động nắn" is not rendered`,
    );

    await page.getByRole('button', { name: 'Tự động nắn', exact: true }).click();
    // The title names the active floor: anything other than {work} is refused here, before confirming.
    const dialog = page.getByRole('dialog', { name: `Nắn thẳng bản vẽ tầng ${workFloorName}?`, exact: true });

    await expect(dialog).toBeVisible();
    const straighten = waitForApiWhere(
      page,
      (response) =>
        response.request().method() === 'POST' &&
        responsePath(response) === `/api/projects/${projectId}/floors/${workFloorId}/quality/straighten`,
      STRAIGHTEN_TIMEOUT_MS,
      'POST …/quality/straighten',
    );

    await dialog.getByRole('button', { name: 'Nắn thẳng', exact: true }).click();
    const { response } = await straighten;

    expect(response.status(), 'POST …/quality/straighten').toBeLessThan(300);
    expect(await response.request().headerValue('Idempotency-Key'), 'Idempotency-Key header').toBeTruthy();
    await expect(page.getByRole('dialog')).toHaveCount(0);
    await captureEvidence(page, 'D_11_straightened.png');
  });
});

test.describe('SCR-09 Floor Manager', () => {
  test('SCR-09 "Xoá tầng" {scratch}, "Hoàn tác" (<8 s), re-resolve, "Xoá tầng" again', async () => {
    assertRegistrySafe();
    const { projectId, floorIds } = await verifyCp2OnServer(page);
    const scratchId = requireState((s) => s.floors.scratchFloorId, 'floors.scratchFloorId', 'Phase 3 (SCR-09)');

    if (!floorIds.has(scratchId)) throw new Error(`REFUSED: scratch floor ${scratchId} is not a floor of CP-2`);

    const projectPart = escapeRegExp(projectId);
    const listPath = new RegExp(`^/api/projects/${projectPart}/floors$`, 'u');
    const readFloors = async (): Promise<{ id: string; name: string }[]> =>
      floorsOf(
        (
          await navigateThenWaitForApi(
            page,
            () => page.goto(ROUTES.project.floors(projectId), { waitUntil: 'commit' }),
            'GET',
            listPath,
            [200],
          )
        ).json,
        'GET floors',
      );
    const uniqueByName = (floors: readonly { id: string; name: string }[], name: string): { id: string; name: string } => {
      const matches = floors.filter((floor) => floor.name === name);

      if (matches.length !== 1 || matches[0] === undefined) {
        throw new Error(`REFUSED: ${String(matches.length)} floors named "${name}" in CP-2 (need exactly one)`);
      }
      return matches[0];
    };
    // Evidence (R1 red: no DELETE seen in 30 s): every write request since the mark, in order, plus what the page shows.
    const writeLog: string[] = [];
    page.on('request', (request) => {
      const path = new URL(request.url()).pathname;

      if (path.startsWith('/api/') && request.method() !== 'GET') writeLog.push(`${request.method()} ${path}`);
    });
    let snapSeq = 0;
    const snapshot = async (phase: string, floorId: string, name: string): Promise<void> => {
      snapSeq += 1;
      const rows = await page.getByRole('button', { name: /^Thao tác khác cho tầng /u }).evaluateAll((els) =>
        els.map((el) => el.getAttribute('aria-label') ?? ''),
      );
      const menu = page.getByRole('menu', { name: 'Tuỳ chọn' });

      await attachJson(`E11_scr09_${String(snapSeq)}_${phase}.json`, {
        phase,
        floorId,
        name,
        url: page.url(),
        menuButtonRows: rows,
        menuOpen: (await menu.count()) > 0,
        menuItems: await menu.getByRole('menuitem').allTextContents(),
        toasts: await page.getByRole('status').allTextContents(),
        dialogs: await page.getByRole('dialog').count(),
        writesSinceStart: [...writeLog],
      });
    };
    const deleteVia = async (floorId: string, name: string): Promise<void> => {
      const removed = waitForApiWhere(
        page,
        (response) => response.request().method() === 'DELETE' && responsePath(response) === `/api/floors/${floorId}`,
        undefined,
        `DELETE /api/floors/${floorId}`,
      );

      await snapshot('before-menu', floorId, name);
      await page.getByRole('button', { name: `Thao tác khác cho tầng ${name}`, exact: true }).click();
      await snapshot('menu-open', floorId, name);
      await page.getByRole('menu', { name: 'Tuỳ chọn' }).getByRole('menuitem', { name: 'Xoá tầng' }).click();
      // G5: hovering the toast pauses its 8 s timer; keep the mouse away.
      await page.mouse.move(0, 0);
      await snapshot('after-click', floorId, name);
      try {
        expect((await removed).response.status(), `DELETE /api/floors/${floorId}`).toBeLessThan(300);
      } finally {
        await snapshot('after-wait', floorId, name);
      }
    };

    const floors = await readFloors();
    assertUrlIsCp2(page, projectId);
    const scratch = floors.find((floor) => floor.id === scratchId);

    if (scratch === undefined) throw new Error(`floor ${scratchId} is not in GET /api/projects/${projectId}/floors`);
    uniqueByName(floors, scratch.name);
    const menuButton = page.getByRole('button', { name: `Thao tác khác cho tầng ${scratch.name}`, exact: true });

    await expect(menuButton).toHaveCount(1);

    /* 1 — delete (no confirm, F-05), then undo: a new POST …/floors. */
    await deleteVia(scratchId, scratch.name);
    const recreated = waitForApi(page, 'POST', listPath, [200, 201]);
    const toast = page.getByRole('status').filter({ hasText: `Đã xoá tầng ${scratch.name}.` });

    await toast.getByRole('button', { name: 'Hoàn tác', exact: true }).click();
    const recreatedId = stringField(asRecord((await recreated).json, 'POST floors'), 'id', 'POST floors');

    // The FE sends the old level id in the body (`persistAddFloor`); whether the server keeps it is recorded, not assumed.
    note(`undo POST …/floors returned id ${recreatedId} (old ${scratchId}; ${recreatedId === scratchId ? 'same' : 'new'} id)`);
    updateState((draft) => {
      draft.floors.scratchFloorId = recreatedId;
    });

    /* 2 — re-resolve {scratch} by name from the server list, then delete it for good. */
    const resolved = uniqueByName(await readFloors(), scratch.name);

    expect(resolved.id, 're-resolved {scratch} id = undo POST id').toBe(recreatedId);
    await expect(menuButton).toHaveCount(1);
    await deleteVia(resolved.id, resolved.name);
    await expect(menuButton).toHaveCount(0);
    await captureEvidence(page, 'D_09_floor_deleted.png');
    updateState((draft) => {
      draft.floors.scratchFloorId = null;
    });
  });
});

test.describe('SCR-08 Project Settings', () => {
  test('SCR-08 "Vùng nguy hiểm" → "Xoá mọi tầng" → confirm (no typed name)', async () => {
    assertRegistrySafe();
    const { projectId, floorIds } = await verifyCp2OnServer(page);

    await page.getByRole('navigation', { name: 'Mục trong trang' }).getByRole('link', { name: 'Vùng nguy hiểm' }).click();
    // DangerZoneTab renders "Xoá mọi tầng" only while the project has floors.
    test.skip(floorIds.size === 0, 'CP-2 has no floors left to delete');

    const deleted: { id: string; status: number }[] = [];
    const onResponse = (response: Response): void => {
      const match = /^\/api\/floors\/([^/]+)$/u.exec(responsePath(response));

      if (response.request().method() === 'DELETE' && match?.[1] !== undefined) {
        deleted.push({ id: match[1], status: response.status() });
      }
    };

    await page.getByRole('button', { name: 'Xoá mọi tầng', exact: true }).click();
    const dialog = page.getByRole('dialog', { name: 'Xoá mọi tầng của dự án?', exact: true });

    await expect(dialog).toBeVisible();
    await expect(dialog.getByLabel('Gõ lại tên dự án để xác nhận')).toHaveCount(0);
    assertUrlIsCp2(page, projectId);

    page.on('response', onResponse);
    try {
      await dialog.getByRole('button', { name: 'Xoá mọi tầng', exact: true }).click();
      const toast = page.getByRole('status').filter({ hasText: /^Đã xoá \d+ tầng của dự án\.$/u });

      await expect(toast).toBeVisible();
      await expect(toast).toHaveText(`Đã xoá ${String(floorIds.size)} tầng của dự án.`);
    } finally {
      page.off('response', onResponse);
    }

    expect(deleted.every((entry) => floorIds.has(entry.id)), 'every DELETE targets a CP-2 floor').toBe(true);
    expect(deleted.every((entry) => entry.status < 300), 'every DELETE /api/floors/:id succeeded').toBe(true);
    expect(deleted).toHaveLength(floorIds.size);
    await captureEvidence(page, 'D_08_all_floors_deleted.png');
    updateState((draft) => {
      draft.floors = { workFloorId: null, scratchFloorId: null, workFloorName: null, scratchFloorName: null };
    });
  });

  test('SCR-08 "Xoá dự án": wrong name (disabled), exact name, DELETE, notice, card gone', async () => {
    assertRegistrySafe();
    const { projectId, projectName } = await verifyCp2OnServer(page);

    await page.getByRole('navigation', { name: 'Mục trong trang' }).getByRole('link', { name: 'Vùng nguy hiểm' }).click();
    await page.getByRole('button', { name: 'Xoá dự án', exact: true }).click();
    const dialog = page.getByRole('dialog', { name: 'Xoá dự án này?', exact: true });
    const typed = dialog.getByLabel('Gõ lại tên dự án để xác nhận');
    const confirm = dialog.getByRole('button', { name: 'Xoá dự án', exact: true });

    await expect(dialog).toBeVisible();
    await typed.fill(`${projectName}-sai`);
    await expect(confirm).toBeDisabled();
    await typed.fill(projectName);
    await expect(confirm).toBeEnabled();
    assertUrlIsCp2(page, projectId);

    const removed = waitForApiWhere(
      page,
      (response) => response.request().method() === 'DELETE' && responsePath(response) === `/api/projects/${projectId}`,
      undefined,
      `DELETE /api/projects/${projectId}`,
    );

    await confirm.click();
    expect((await removed).response.status(), `DELETE /api/projects/${projectId}`).toBeLessThan(300);
    deletedProjectId = projectId;
    updateState((draft) => {
      draft.project = { projectId: null, projectName: null };
      draft.floors = { workFloorId: null, scratchFloorId: null, workFloorName: null, scratchFloorName: null };
    });

    await expect.poll(() => pathnameOf(page)).toBe(ROUTES.dashboard);
    await expect(page.getByRole('status').filter({ hasText: /Đã xoá dự án( "[^"]+")?\./u })).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Chọn dự án để làm tiếp', level: 1 })).toBeVisible();
    await expect(
      page.getByRole('list', { name: 'Danh sách dự án' }).or(page.getByText('Chưa có dự án nào', { exact: true })).first(),
    ).toBeVisible();
    await expect(page.getByText(projectName, { exact: true })).toHaveCount(0);
    await captureEvidence(page, 'D_08_project_deleted.png');
  });
});

test.describe('SCR-37 User Management', () => {
  test('SCR-37 disable / enable / delete the opt-in invitee', () => {
    skipWithReason('opt-in: no invitee was created (email)');
  });
});

test.describe('SCR-38 Access Denied', () => {
  test('SCR-38 "Về danh sách dự án" → /', async () => {
    await page.goto(ROUTES.accessDenied);
    await page.getByRole('button', { name: 'Về danh sách dự án', exact: true }).click();
    await expect.poll(() => pathnameOf(page)).toBe(ROUTES.dashboard);
    await expect(page.getByRole('heading', { name: 'Chọn dự án để làm tiếp', level: 1 })).toBeVisible();
    await captureEvidence(page, '38_denied_home.png');
  });

  test('SCR-38 "Đăng nhập bằng tài khoản khác" → POST /api/auth/logout → /login', async () => {
    await page.goto(ROUTES.accessDenied);
    const logout = waitForApiWhere(
      page,
      (response) => response.request().method() === 'POST' && responsePath(response) === '/api/auth/logout',
      undefined,
      'POST /api/auth/logout',
    );

    await page.getByRole('button', { name: 'Đăng nhập bằng tài khoản khác', exact: true }).click();
    expect((await logout).response.status(), 'POST /api/auth/logout').toBeLessThan(300);
    await expect.poll(() => pathnameOf(page)).toBe(ROUTES.login);
    await captureEvidence(page, '38_logout.png');
    loggedOut = true;
    updateState((draft) => {
      draft.session = { cookie: null, token: null, storageStatePath: null };
    });

    // `/` now goes to the login screen (SessionBootstrap, anonymous).
    await page.goto(ROUTES.dashboard);
    await expect.poll(() => pathnameOf(page)).toBe(ROUTES.login);
  });
});

test.describe('SCR-01 Session gate', () => {
  test('SCR-01 /projects/<deleted-id>/3d after logout → /login?next=…', async () => {
    const projectId = deletedProjectId ?? readState().project.projectId;

    test.skip(!loggedOut, 'depends on SCR-38 logout, which did not complete in this worker');
    test.skip(projectId === null, 'no CP-2 project id (deleted in another worker and cleared from state)');
    const target = ROUTES.project.viewer(projectId ?? '');

    await page.goto(target);
    await expect.poll(() => pathOf(page.url())).toBe(loginUrl(target));
    await captureEvidence(page, '01_gate_after_logout.png');
  });
});
