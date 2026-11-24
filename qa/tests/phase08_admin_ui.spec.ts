/**
 * Phase 8 — dedicated UI-verification cases (skill `qa-verify-ui`): one test per visible state of SCR-34 Model Library
 * (`/admin/models`), SCR-35 Training Jobs (`/admin/training/jobs`), SCR-36 Model Registry (`/admin/training/models`) and
 * SCR-37 User Management (`/admin/users`), each at 1440 / 1024 / 768 / 375 (`support/ui-verify.ts`), evidence
 * `U08_<state>_<width>.png` + `U08_<state>.json`. Reviewed by the "verify ui" step with the qa-review-ui checklist.
 * Models: `phase01_auth_ui.spec.ts` (second-user group), `phase07_account_ui.spec.ts` (`verifyAsAdmin` + write guard).
 *
 * Copy — every string checked in src/screens/admin/** (file noted next to it), as `phase08_admin.spec.ts`.
 *
 * Budget:
 *   - Sessions: no browser login; each test opens its OWN context from Phase 1's admin storage state
 *     (`ensureAdminSession` signs in only to replace a dead stored session) and writes the rotated cookies back.
 *     20 tests × (4 loads + 1 session check) = 100 `POST /api/auth/refresh` (`auth_refresh_total` 300 / 60 s per sid).
 *   - No admin write from the browser: every case asserts the page sent NO non-GET `/api/` request other than the
 *     session refresh (`verifyIn` guard). Never clicked: "Bắt đầu huấn luyện" (the create form is only opened, its
 *     "Số vòng" refused by the field itself), the activate dialog's "Kích hoạt" (only the row button that OPENS the
 *     dialog — R2: the registry is never switched here), "Tắt AI, dùng thuật toán cũ" (plan: do not click), "Gửi lời mời".
 *   - SCR-37 long data: 1 admin API login (`signedInApi`), 1 invitation (30 / h per admin) of a run-unique viewer whose
 *     address is 254 chars (BE `MAX_EMAIL_LENGTH`, apps/api/auth/emails.py:20; its name is derived from the address,
 *     users/service.py `_display_name`), then 1 `DELETE /api/users/:id` and its mail removed in `afterAll`.
 * No faked response: every state is the real stack. A state the environment's data cannot show (empty library, no
 * training job, no evaluated candidate — CP-8) SKIPS with an "environment:" reason. Loading skeletons, read errors and
 * the forbidden state are not drawn here (skill §1: error states come from the main / edge layers).
 * Dialogs and drawers (`position: fixed`) are shot viewport-only (BUG-161). Non-serial: each test uses its own context.
 */
import { readFileSync, writeFileSync } from 'node:fs';

import { expect, test, type APIRequestContext, type Browser, type BrowserContext, type Locator, type Page } from '@playwright/test';

import { ROUTES } from '../../e2e/fixtures/routes';
import { readBaseUrl } from '../../e2e/fullstack/env';
import { signedInApi } from './support/api';
import { ensureAdminSession, readAdminCredentials } from './support/auth';
import { TEST_DATA_PREFIX, testEmail } from './support/evidence';
import { deleteMails, waitForMail } from './support/mailpit';
import { typeHeight } from './support/numeric-field';
import { skipWithReason } from './support/skip';
import { ADMIN_STORAGE_STATE_FILE } from './support/state';
import { verifyUi } from './support/ui-verify';

/* ---- SCR-34 copy: ModelLibrary.tsx, ModelLibraryToolbar.tsx, ModelLibraryTable.tsx, ModelLibraryDetail.tsx ---- */
const LIBRARY_SEARCH = 'tìm model';
const LIBRARY_CATEGORY = 'danh mục';
const LIBRARY_EMPTY_TITLE = 'Chưa có mẫu 3D nào';
const LIBRARY_NO_MATCH = 'Không tìm thấy mẫu 3D phù hợp.';
const LIBRARY_VIEW_MODE = 'Chế độ xem';
const LIBRARY_GRID = 'Lưới';
const LIBRARY_GRID_LIST = 'lưới mẫu 3D';
const LIBRARY_DETAIL = 'Chi tiết model';
/** ModelLibrary.container.tsx:58 NARROW_QUERY — below it the table / grid become a card list. */
const NARROW_PX = 1024;

/* ---- SCR-35 copy: TrainingJobs.tsx, TrainingJobsTable.tsx, TrainingDatasetsTab.tsx, TrainingJobForm.tsx ---- */
const TRAINING_TITLE = 'Theo dõi huấn luyện';
const TAB_JOBS = 'Lượt huấn luyện';
const TAB_DATASETS = 'Bộ dữ liệu';
const JOBS_EMPTY_TITLE = 'Chưa có lượt huấn luyện';
const DATASETS_EMPTY_TITLE = 'Chưa có bộ dữ liệu';
const DATASETS_LIST = 'Danh sách bộ dữ liệu';
const STATUS_FILTER = 'Lọc theo trạng thái';
/** useTrainingJobs.ts:125 JOB_STATUS.cancelling — the status least likely to have rows (shows `emptyFiltered`). */
const STATUS_CANCELLING = 'Đang huỷ';
const JOBS_PATH = '/api/admin/ml/training-jobs';
const JOB_DETAIL = 'Chi tiết lượt huấn luyện';
const CREATE_JOB = 'Tạo lượt huấn luyện';
const START_TRAINING = 'Bắt đầu huấn luyện';
const EPOCHS_LABEL = 'Số vòng';
/** useNumericField.ts:72 with TRAINING_EPOCHS_MIN 1 (the field refuses 0 itself; nothing is committed or sent). */
const EPOCHS_BELOW_MIN = /^Giá trị không nhỏ hơn 1\.$/u;

/* ---- SCR-36 copy: ModelRegistry.tsx, ModelRegistryVersionTable.tsx, useModelRegistry.ts ---- */
const FAMILY_PICKER = 'Loại mô hình';
const FAMILY_LABELS = {
  walls: 'Tách lớp tường',
  opening: 'Nhận diện cửa và đồ đạc',
  dimension: 'Đọc kích thước',
} as const;
const REGISTRY_EMPTY_TITLE = 'Chưa có phiên bản';
const ACTIVATE = 'Kích hoạt';
const VERSION_DETAIL = 'Chi tiết phiên bản';
/** useModelRegistry.ts activateTitle: "Kích hoạt <label> cho <family>?". */
const ACTIVATE_DIALOG = /^Kích hoạt .+ cho .+\?$/u;

/* ---- SCR-37 copy: UserManagementToolbar.tsx, userManagementGateway.ts, useUserManagement.ts:137-138 ---- */
const USERS_LIST_PATH = /^\/api\/users$/u;
const USERS_SEARCH = 'Tìm người dùng';
const ROLE_FILTER = 'Vai';
const STATUS_FILTER_USERS = 'Trạng thái';
const ROLE_ADMIN = 'Quản trị';
const STATUS_ACTIVE = 'Đang hoạt động';
const STATUS_PENDING = 'Chờ chấp nhận';
const SELF_ROLE_BLOCKED = 'Bạn không thể tự đổi vai của mình';
const SELF_DISABLE_BLOCKED = 'Bạn không thể tự vô hiệu hoá tài khoản của mình';
const CLOSE_USER_DETAIL = 'Đóng chi tiết người dùng'; // UserManagementDetail.tsx (as phase01_auth_ui.spec.ts)

const API_PREFIX = '/api/';
const REFRESH_PATH = '/api/auth/refresh';
const TEST_TIMEOUT_MS = 120_000;
const SETTLE_TIMEOUT_MS = 20_000;
const MODAL_SHOT = { fullPage: false } as const;

/** 254 chars (BE MAX_EMAIL_LENGTH), from `testEmail` (BUG-064): local part padded to 64, three filler labels. */
function longEmail(): string {
  const [local = '', domain = ''] = testEmail('u08-long').split('@');
  if (local.length > 64) throw new Error(`testEmail local part is ${local.length} chars (> 64)`);
  const address = `${local.padEnd(64, 'a')}@${'b'.repeat(61)}.${'c'.repeat(61)}.${'d'.repeat(64 - domain.length)}.${domain}`;
  if (address.length !== 254) throw new Error(`long e-mail is ${address.length} chars, not 254`);
  return address;
}

/* ---- helpers (phase07_account_ui.spec.ts) ---- */

type Shot = { readonly fullPage?: boolean };

/** Writes the context's rotated cookies back to the admin storage-state file, keeping its saved localStorage. */
async function saveCookies(context: BrowserContext): Promise<void> {
  const saved = JSON.parse(readFileSync(ADMIN_STORAGE_STATE_FILE, 'utf8')) as Record<string, unknown>;
  const { cookies } = await context.storageState();
  writeFileSync(ADMIN_STORAGE_STATE_FILE, JSON.stringify({ ...saved, cookies }, null, 2));
}

/** `verifyUi` in `context`, failing softly if the page sent any non-GET `/api/` request but the session refresh. */
async function verifyIn(context: BrowserContext, name: string, open: (page: Page) => Promise<void>, shot: Shot): Promise<void> {
  const writes: string[] = [];
  const page = await context.newPage();
  page.on('request', (request) => {
    const path = new URL(request.url()).pathname;
    if (request.method() === 'GET' || !path.startsWith(API_PREFIX)) return;
    if (request.method() === 'POST' && path === REFRESH_PATH) return;
    writes.push(`${request.method()} ${path}`);
  });
  await verifyUi(page, name, open, undefined, shot);
  expect.soft(writes, 'a UI case sends no write request').toEqual([]);
}

/** Own context from the admin storage state; rotated refresh cookie written back (cookies only). */
async function verifyAsAdmin(browser: Browser, name: string, open: (page: Page) => Promise<void>, shot: Shot = {}): Promise<void> {
  const context = await browser.newContext({ baseURL: readBaseUrl(), storageState: ADMIN_STORAGE_STATE_FILE });
  try {
    await ensureAdminSession(context, ADMIN_STORAGE_STATE_FILE);
    await verifyIn(context, name, open, shot);
  } finally {
    await saveCookies(context);
    await context.close();
  }
}

/** Custom `Select` (button role=combobox, portaled listbox): open it and pick one option. */
async function pickOption(page: Page, combobox: Locator, option: string): Promise<void> {
  await combobox.click();
  await page.getByRole('option', { name: option, exact: true }).click();
}

const isNarrow = (page: Page): boolean => (page.viewportSize()?.width ?? 0) < NARROW_PX;
/** The screen container (parent of the h1; the breadcrumb nav was removed), so lists in the app shell are never matched. */
const screenOf = (page: Page): Locator => page.getByRole('heading', { level: 1 }).locator('xpath=..');
/** An inline side panel (≥1024) or the same content in a drawer (<1024), both named `label`. */
const panelOrDrawer = (page: Page, label: string): Locator =>
  page.locator(`aside[aria-label="${label}"]`).or(page.getByRole('dialog', { name: label, exact: true }));

/* -------------------------------------------------------------------------- */
/* SCR-34 Model Library                                                       */
/* -------------------------------------------------------------------------- */

/** /admin/models past loading; skips the test when the library is empty (nothing to browse). */
async function openLibrary(page: Page): Promise<void> {
  await page.goto(ROUTES.adminModels);
  const search = page.getByLabel(LIBRARY_SEARCH, { exact: true });
  const empty = page.getByText(LIBRARY_EMPTY_TITLE, { exact: true });
  await expect(search.or(empty)).toBeVisible({ timeout: SETTLE_TIMEOUT_MS });
  test.skip(await empty.isVisible(), 'environment: library is empty ("Chưa có mẫu 3D nào"), nothing to browse');
  await expect(libraryNames(page).first()).toBeVisible();
}

/** Model name buttons: table column 2 (≥1024) or the card list (<1024); the retry icon button has no text. */
const libraryNames = (page: Page): Locator =>
  screenOf(page).locator('tbody td:nth-child(2) button, ul li button').filter({ hasText: /\S/u });

test.describe('U08 UI verify — SCR-34 Model Library', () => {
  test.beforeEach(() => {
    test.setTimeout(TEST_TIMEOUT_MS);
  });

  test('U08 · SCR-34 library, default (table ≥1024, cards <1024)', async ({ browser }) => {
    await verifyAsAdmin(browser, 'U08_library_default', openLibrary);
  });

  test('U08 · SCR-34 library, search with no match', async ({ browser }) => {
    await verifyAsAdmin(browser, 'U08_library_no_match', async (p) => {
      await openLibrary(p);
      await p.getByLabel(LIBRARY_SEARCH, { exact: true }).fill(`${TEST_DATA_PREFIX}khong-co-model`);
      await expect(p.getByText(LIBRARY_NO_MATCH, { exact: true })).toBeVisible();
    });
  });

  test('U08 · SCR-34 library, category list open', async ({ browser }) => {
    await verifyAsAdmin(browser, 'U08_library_category_open', async (p) => {
      await openLibrary(p);
      await p.getByRole('combobox', { name: LIBRARY_CATEGORY, exact: true }).click();
      await expect(p.getByRole('listbox')).toBeVisible();
    });
  });

  test('U08 · SCR-34 library, "Lưới" view (grid ≥1024; cards stay <1024)', async ({ browser }) => {
    await verifyAsAdmin(browser, 'U08_library_grid', async (p) => {
      await openLibrary(p);
      const grid = p.getByRole('radiogroup', { name: LIBRARY_VIEW_MODE }).getByRole('radio', { name: LIBRARY_GRID, exact: true });
      await grid.click();
      await expect(grid).toHaveAttribute('aria-checked', 'true');
      // ModelLibraryTable.tsx: `isNarrow` wins over `viewMode`, so the grid list exists only ≥1024.
      if (!isNarrow(p)) await expect(p.getByRole('list', { name: LIBRARY_GRID_LIST })).toBeVisible();
    });
  });

  test('U08 · SCR-34 library, model detail panel open', async ({ browser }) => {
    await verifyAsAdmin(browser, 'U08_library_detail', async (p) => {
      await openLibrary(p);
      const first = libraryNames(p).first();
      const name = (await first.innerText()).trim();
      await first.click();
      const detail = p.locator(`aside[aria-label="${LIBRARY_DETAIL}"]`);
      await expect(detail).toBeVisible();
      await expect(detail.getByRole('heading', { level: 2, name, exact: true })).toBeVisible();
    });
  });
});

/* -------------------------------------------------------------------------- */
/* SCR-35 Training Jobs                                                       */
/* -------------------------------------------------------------------------- */

const visiblePanel = (page: Page): Locator => page.getByRole('tabpanel');
/** Row buttons of the visible tab panel (job rows, or dataset list entries), `aria-pressed` per row. */
const panelRows = (page: Page): Locator => visiblePanel(page).locator('button[aria-pressed]');

/** /admin/training/jobs, jobs tab settled: rows or the empty state, no skeleton. */
async function openTraining(page: Page): Promise<void> {
  await page.goto(ROUTES.adminTrainingJobs);
  await expect(page.getByRole('heading', { level: 1, name: TRAINING_TITLE, exact: true })).toBeVisible({ timeout: SETTLE_TIMEOUT_MS });
  await expect(page.getByRole('tab', { name: TAB_JOBS, exact: true })).toHaveAttribute('aria-selected', 'true');
  await expect(page.locator('[aria-busy="true"]')).toHaveCount(0, { timeout: SETTLE_TIMEOUT_MS });
  await expect(page.getByText(JOBS_EMPTY_TITLE, { exact: true }).or(panelRows(page).first())).toBeVisible();
}

async function openCreateForm(page: Page): Promise<Locator> {
  await openTraining(page);
  await page.getByRole('button', { name: CREATE_JOB, exact: true }).click();
  const dialog = page.getByRole('dialog', { name: CREATE_JOB });
  await expect(dialog).toBeVisible();
  await expect(dialog.getByRole('button', { name: START_TRAINING, exact: true })).toBeVisible();
  return dialog;
}

test.describe('U08 UI verify — SCR-35 Training Jobs', () => {
  test.beforeEach(() => {
    test.setTimeout(TEST_TIMEOUT_MS);
  });

  test('U08 · SCR-35 training, jobs tab (rows or empty)', async ({ browser }) => {
    await verifyAsAdmin(browser, 'U08_training_jobs', openTraining);
  });

  test('U08 · SCR-35 training, "Bộ dữ liệu" tab', async ({ browser }) => {
    await verifyAsAdmin(browser, 'U08_training_datasets', async (p) => {
      await openTraining(p);
      const tab = p.getByRole('tab', { name: TAB_DATASETS, exact: true });
      await tab.click();
      await expect(tab).toHaveAttribute('aria-selected', 'true');
      await expect(
        p.getByText(DATASETS_EMPTY_TITLE, { exact: true }).or(p.getByRole('navigation', { name: DATASETS_LIST, exact: true })),
      ).toBeVisible();
    });
  });

  test('U08 · SCR-35 training, status filter "Đang huỷ" (filtered rows or "no match")', async ({ browser }) => {
    await verifyAsAdmin(browser, 'U08_training_filtered', async (p) => {
      await openTraining(p);
      const filtered = p.waitForResponse((r) => {
        const url = new URL(r.url());
        return r.request().method() === 'GET' && url.pathname === JOBS_PATH && url.searchParams.get('status') === 'cancelling';
      });
      const status = p.getByRole('combobox', { name: STATUS_FILTER, exact: true });
      await pickOption(p, status, STATUS_CANCELLING);
      expect((await filtered).status(), 'GET training-jobs?status=cancelling').toBe(200);
      await expect(status).toContainText(STATUS_CANCELLING);
      await expect(p.locator('[aria-busy="true"]')).toHaveCount(0);
      // useTrainingJobs.ts:819 emptyFiltered under the "Chưa có lượt huấn luyện" title, or the matching rows.
      await expect(p.getByText(JOBS_EMPTY_TITLE, { exact: true }).or(panelRows(p).first())).toBeVisible();
    });
  });

  test('U08 · SCR-35 training, job detail (panel ≥1024, drawer <1024)', async ({ browser }) => {
    await verifyAsAdmin(
      browser,
      'U08_training_job_detail',
      async (p) => {
        await openTraining(p);
        test.skip(await p.getByText(JOBS_EMPTY_TITLE, { exact: true }).isVisible(), 'environment: no training job to open');
        await panelRows(p).first().click();
        const detail = panelOrDrawer(p, JOB_DETAIL);
        await expect(detail).toBeVisible();
        await expect(detail.getByRole('region', { name: 'Số đo', exact: true })).toBeVisible();
        await expect(detail.getByRole('region', { name: 'Nhật ký', exact: true })).toBeVisible();
      },
      MODAL_SHOT,
    );
  });

  test('U08 · SCR-35 training, "Tạo lượt huấn luyện" form open (nothing sent)', async ({ browser }) => {
    await verifyAsAdmin(browser, 'U08_training_create_form', async (p) => {
      await openCreateForm(p);
    }, MODAL_SHOT);
  });

  test('U08 · SCR-35 training, form "Số vòng" = 0 → field refusal (nothing sent)', async ({ browser }) => {
    await verifyAsAdmin(browser, 'U08_training_create_invalid', async (p) => {
      const dialog = await openCreateForm(p);
      await typeHeight(dialog.getByLabel(EPOCHS_LABEL, { exact: true }), '0');
      await expect(dialog.getByText(EPOCHS_BELOW_MIN)).toBeVisible();
    }, MODAL_SHOT);
  });
});

/* -------------------------------------------------------------------------- */
/* SCR-36 Model Registry                                                      */
/* -------------------------------------------------------------------------- */

type FamilyKey = keyof typeof FAMILY_LABELS;
const FAMILY_ORDER: readonly FamilyKey[] = ['walls', 'opening', 'dimension'];

/**
 * Version label buttons (table ≥1024, card list <1024), `aria-pressed` per row (ModelRegistryVersionTable.tsx). Page-wide:
 * the registry's breadcrumb sits inside its header block (ModelRegistry.tsx Header), so `screenOf` does not reach the table.
 */
const versionLabels = (page: Page): Locator => page.locator('table button[aria-pressed], li button[aria-pressed]');
const enabledActivate = (page: Page): Locator =>
  page.getByRole('button', { name: ACTIVATE, exact: true }).and(page.locator(':enabled'));

/** Selects one family on an already open registry and waits until its versions (or "Chưa có phiên bản") are drawn. */
async function selectFamily(page: Page, family: FamilyKey): Promise<void> {
  const radio = page.getByRole('radiogroup', { name: FAMILY_PICKER }).getByRole('radio', { name: FAMILY_LABELS[family], exact: true });
  await radio.click();
  await expect(radio).toHaveAttribute('aria-checked', 'true');
  await expect(page.locator('[aria-busy="true"]')).toHaveCount(0, { timeout: SETTLE_TIMEOUT_MS });
  await expect(page.getByText(REGISTRY_EMPTY_TITLE, { exact: true }).or(versionLabels(page).first())).toBeVisible({
    timeout: SETTLE_TIMEOUT_MS,
  });
}

async function openRegistry(page: Page, family: FamilyKey): Promise<void> {
  await page.goto(ROUTES.adminTrainingModels);
  await expect(page.getByRole('radiogroup', { name: FAMILY_PICKER })).toBeVisible({ timeout: SETTLE_TIMEOUT_MS });
  await selectFamily(page, family);
}

/** Opens the registry on the first family (FAMILY_ORDER) where `found` has a match; skips with `why` when none has. */
async function openRegistryWhere(page: Page, found: (page: Page) => Locator, why: string): Promise<Locator> {
  await openRegistry(page, FAMILY_ORDER[0]!);
  for (const family of FAMILY_ORDER) {
    await selectFamily(page, family);
    if ((await found(page).count()) > 0) return found(page).first();
  }
  skipWithReason(why);
  throw new Error('unreachable');
}

test.describe('U08 UI verify — SCR-36 Model Registry', () => {
  test.beforeEach(() => {
    test.setTimeout(TEST_TIMEOUT_MS);
  });

  for (const family of FAMILY_ORDER) {
    test(`U08 · SCR-36 registry, family "${FAMILY_LABELS[family]}" (versions or empty)`, async ({ browser }) => {
      await verifyAsAdmin(browser, `U08_registry_${family}`, (p) => openRegistry(p, family));
    });
  }

  test('U08 · SCR-36 registry, version detail (panel ≥1024, drawer <1024)', async ({ browser }) => {
    await verifyAsAdmin(
      browser,
      'U08_registry_version_detail',
      async (p) => {
        const label = await openRegistryWhere(p, versionLabels, 'environment: no family has a model version');
        const name = (await label.innerText()).trim();
        await label.click();
        await expect(label).toHaveAttribute('aria-pressed', 'true');
        // ModelRegistryDetail.tsx: h2 = version.label (useModelRegistry.ts:297).
        await expect(panelOrDrawer(p, VERSION_DETAIL).getByRole('heading', { level: 2, name, exact: true })).toBeVisible();
      },
      MODAL_SHOT,
    );
  });

  test('U08 · SCR-36 registry, activate confirm dialog open (never confirmed)', async ({ browser }) => {
    await verifyAsAdmin(
      browser,
      'U08_registry_activate_dialog',
      async (p) => {
        const button = await openRegistryWhere(
          p,
          enabledActivate,
          'environment: CP-8 missing, no family has an evaluated onnx candidate (every "Kích hoạt" is disabled)',
        );
        await button.click();
        const dialog = p.getByRole('dialog', { name: ACTIVATE_DIALOG });
        await expect(dialog).toBeVisible();
        await expect(dialog.getByRole('button', { name: ACTIVATE, exact: true })).toBeVisible();
      },
      MODAL_SHOT,
    );
  });
});

/* -------------------------------------------------------------------------- */
/* SCR-37 User Management                                                     */
/* -------------------------------------------------------------------------- */

/** /admin/users after `GET /api/users` 200, the toolbar drawn. */
async function openUsers(page: Page): Promise<void> {
  const listed = page.waitForResponse((r) => r.request().method() === 'GET' && USERS_LIST_PATH.test(new URL(r.url()).pathname));
  await page.goto(ROUTES.adminUsers);
  expect((await listed).status(), 'GET /api/users').toBe(200);
  await expect(page.getByLabel(USERS_SEARCH, { exact: true })).toBeVisible({ timeout: SETTLE_TIMEOUT_MS });
}

/** A user's row: table row (≥1024) or card (<1024), as phase01_auth_ui.spec.ts `ownUserRow`. */
const userRow = (page: Page, email: string): Locator => page.locator('tbody tr, main li').filter({ hasText: email }).first();

/*
 * The group invites one run-unique viewer with a 254-char address (long data, and a second user so the list is never
 * the "Chưa có người dùng nào khác" empty state), and deletes it after the group (see header budget).
 */
test.describe('U08 UI verify — SCR-37 User Management', () => {
  let admin: APIRequestContext | undefined;
  let invitee: { id: string; email: string } | undefined;
  const address = longEmail();
  let since = new Date();

  test.beforeAll(async () => {
    const { email, password } = readAdminCredentials();
    admin = await signedInApi(email, password);
    since = new Date(Date.now() - 5_000);
    const res = await admin.post('/api/users/invitations', { data: { emails: [address], role: 'viewer' } });
    expect(res.status(), 'setup: POST /api/users/invitations').toBe(201);
    const answer = (await res.json()) as { id?: unknown; email?: unknown }[];
    const created = answer.find((u) => u.email === address) ?? answer[0];
    // Recorded BEFORE the check below, so `afterAll` deletes whoever was created.
    if (created?.id !== undefined) invitee = { id: String(created.id), email: String(created.email ?? address) };
    expect(created?.email, 'setup: the invited user is in the answer').toBe(address);
  });

  test.afterAll(async () => {
    try {
      if (admin && invitee) {
        // BE apps/api/users/router.py soft delete (as phase01_auth_ui.spec.ts cleanup).
        const res = await admin.delete(`/api/users/${invitee.id}`, { data: { userId: invitee.id, confirmEmail: invitee.email } });
        if (res.status() !== 200) test.info().annotations.push({ type: 'cleanup', description: `DELETE user → ${res.status()}` });
        await deleteMails([(await waitForMail(invitee.email, since, 10_000)).id]);
      }
    } catch (error) {
      test.info().annotations.push({ type: 'cleanup', description: String(error) });
    } finally {
      await admin?.dispose();
    }
  });

  test.beforeEach(() => {
    test.setTimeout(TEST_TIMEOUT_MS);
  });

  test('U08 · SCR-37 users, filtered "Vai" = Quản trị + "Trạng thái" = Đang hoạt động', async ({ browser }) => {
    await verifyAsAdmin(browser, 'U08_users_filtered', async (p) => {
      await openUsers(p);
      await pickOption(p, p.getByRole('combobox', { name: ROLE_FILTER, exact: true }), ROLE_ADMIN);
      await pickOption(p, p.getByRole('combobox', { name: STATUS_FILTER_USERS, exact: true }), STATUS_ACTIVE);
      await expect(userRow(p, readAdminCredentials().email)).toBeVisible();
      await expect(userRow(p, address)).toHaveCount(0);
    });
  });

  test('U08 · SCR-37 users, own row self-guard text', async ({ browser }) => {
    await verifyAsAdmin(browser, 'U08_users_self_guard', async (p) => {
      await openUsers(p);
      const { email } = readAdminCredentials();
      await p.getByLabel(USERS_SEARCH, { exact: true }).fill(email);
      const row = userRow(p, email);
      await expect(row).toBeVisible();
      await expect(row.getByText(SELF_ROLE_BLOCKED, { exact: true })).toBeVisible();
      await expect(row.getByText(SELF_DISABLE_BLOCKED, { exact: true })).toBeVisible();
    });
  });

  test('U08 · SCR-37 users, 254-char pending invitee row (long data)', async ({ browser }) => {
    await verifyAsAdmin(browser, 'U08_users_long_pending', async (p) => {
      await openUsers(p);
      await p.getByLabel(USERS_SEARCH, { exact: true }).fill(address);
      const row = userRow(p, address);
      await expect(row).toBeVisible();
      await expect(row.getByText(STATUS_PENDING, { exact: true })).toBeVisible();
    });
  });

  test('U08 · SCR-37 users, 254-char invitee detail (panel ≥1024, drawer <1024)', async ({ browser }) => {
    await verifyAsAdmin(
      browser,
      'U08_users_long_detail',
      async (p) => {
        await openUsers(p);
        await p.getByLabel(USERS_SEARCH, { exact: true }).fill(address);
        await userRow(p, address).getByRole('button').first().click();
        await expect(p.getByRole('button', { name: CLOSE_USER_DETAIL, exact: true })).toBeVisible();
      },
      MODAL_SHOT,
    );
  });
});
