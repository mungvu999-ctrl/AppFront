/**
 * Phase 1 — recovery screens EDGE CASES, Track A: SCR-03 InvitationAccept (`/login/invitation`) and
 * SCR-04 PasswordReset (`/login/reset-password`). Gaps left by `phase01_auth.spec.ts` and
 * `phase01_auth_edge.spec.ts`; inventory in `qa/coverage/phase01-recovery.md`.
 *
 * Does NOT call `resetState()` and does NOT write `tests/.state/*`. Every expected result cites the FE
 * source of this worktree (`BE:` = `AppBack/fix378-x`). UI strings are copied from `src/i18n/vi.json`.
 *
 * ## Non-serial
 * Every test uses Playwright's own `page` fixture = a fresh, anonymous browser context per test, so one
 * failure never skips the rest. The two signed-in tests sign in through the UI (`signInAdmin`).
 *
 * ## Mocks
 * A happy path needs a real one-time token, which E2E cannot obtain; 429/5xx/network/origin failures
 * cannot be produced safely on the shared backend. Those tests replace ONLY the server response of the
 * single endpoint involved with `page.route` (title says "[mocked response]"): `POST
 * /api/auth/invitations/accept`, `POST /api/auth/password-reset/confirm`, and the follow-up `POST
 * /api/auth/logout` (reset success) or `POST /api/auth/refresh` (held/aborted, never faked into a session).
 * Every SCR-03 form with a fake token also answers `POST /api/auth/invitations/preview` with a valid preview
 * ([mocked preview], support/p01/recovery.ts): since 147c9620 the form only opens after that check.
 * A mocked request never reaches the backend, so no real token is consumed and the admin password is
 * NEVER changed (the only reset "success" is mocked).
 *
 * ## Real-backend budget per run (BE:apps/api/auth_recovery/settings.py:24-25, BE:auth_recovery/router.py:122-131)
 * - Recovery routes share 10 requests / 900 s per IP; `phase01_auth_edge.spec.ts` spends its own share (7, see its header).
 *   THIS file: exactly 1 real recovery request (the bidi-name test, bogus token → 422 before any token
 *   lookup). Every other recovery POST is intercepted.
 * - `POST /api/auth/login`: 2 successes (the two signed-in tests), 0 failures.
 * - `POST /api/auth/refresh`: page-load bootstraps + 2 follow-ups (not rate-limited recovery routes).
 */
import { expect, test } from '@playwright/test';
import type { Page, Request, Response, Route } from '@playwright/test';

import { ROUTES, pathOf } from '../../e2e/fixtures/routes';
import { PASSWORD_LABEL } from '../../e2e/fixtures/session';
import { BE_SHORT_PASSWORD, signInAdmin } from './support/auth';
import { attachJson, captureEvidence } from './support/evidence';
import { PHONE_OUT_OF_SCOPE, isPhoneOutOfScope, mockInvitationPreview } from './support/p01/recovery';

/** `src/api/endpoints.ts:86-91` under the `/api` base; logout = `src/lib/auth/session.ts:42,200`. */
const INVITATION_ACCEPT_API = '/api/auth/invitations/accept';
const PASSWORD_RESET_CONFIRM_API = '/api/auth/password-reset/confirm';
const LOGOUT_API = '/api/auth/logout';
const REFRESH_API = '/api/auth/refresh';

/* `src/i18n/vi.json` @7735bcda (line numbers of that file). */
const FULL_NAME_LABEL = 'Họ và tên'; // :112
const CONFIRM_PASSWORD_LABEL = 'Nhập lại mật khẩu'; // :109
const NEW_PASSWORD_LABEL = 'Mật khẩu mới'; // :113
const ACCEPT_INVITATION = 'Nhận lời mời'; // :117
const SET_NEW_PASSWORD = 'Đổi mật khẩu'; // :122
const SUBMITTING = 'Đang gửi…'; // :124
const GO_TO_SIGN_IN = 'Về trang đăng nhập'; // :119
const CONFIRM_MISMATCH = 'Hai mật khẩu chưa giống nhau.'; // :135
const CONFIRM_REQUIRED = 'Chưa nhập lại mật khẩu.'; // :136
const PASSWORD_REQUIRED = 'Chưa nhập mật khẩu.'; // :140
const PASSWORD_TOO_SHORT = 'Mật khẩu cần ít nhất 8 ký tự.'; // :141, {{count}} = MIN_PASSWORD_LENGTH 8
const FULL_NAME_REQUIRED = 'Chưa nhập họ và tên.'; // :142
const FULL_NAME_TOO_LONG = 'Họ và tên tối đa 120 ký tự.'; // :143, {{count}} = zod max 120
const FULL_NAME_INVALID =
  'Họ và tên có ký tự không dùng được, như ký tự điều khiển hoặc ký tự đảo chiều chữ. Gõ lại họ tên rồi thử lại.'; // :144 (BUG-016)
const TOO_MANY_TITLE = 'Đã thử quá nhiều lần'; // :152
const TOO_MANY_RECOVERY = 'Hãy đợi vài phút rồi thử lại.'; // auth.errors.tooManyRecovery :159 (title no longer repeated)
const RECOVERY_FAILED =
  'Máy chủ chưa xử lý được yêu cầu. Đợi giây lát rồi bấm gửi lại — những gì đã nhập vẫn còn nguyên.'; // :160 (BUG-015, BUG-091)
const ORIGIN_MISMATCH_TITLE = 'Máy chủ từ chối yêu cầu'; // :156
const ORIGIN_MISMATCH_DESCRIPTION =
  'Địa chỉ của trang này không nằm trong danh sách máy chủ chấp nhận. Đây là lỗi cấu hình, không phải lỗi tài khoản — hãy báo quản trị hệ thống.'; // :157 (BUG-021)
const INVITATION_EXPIRED =
  'Lời mời đã hết hạn hoặc đã được dùng. Nhờ quản trị viên gửi lại lời mời. Nếu bạn vừa đặt mật khẩu ở lượt trước, hãy đăng nhập.'; // :180
const INVITATION_INCOMPLETE =
  'Trang này không còn mã của liên kết lời mời (trang đã được tải lại hoặc liên kết bị cắt). Hãy mở lại đúng liên kết trong thư mời, hoặc nhờ quản trị viên gửi lại lời mời.'; // :181 (BUG-005)
/** InvitationAccept.tsx:49-51 DEAD_REASON_MESSAGES.invalid: a token on the URL but malformed (G1-10, useInvitationAccept.ts:407-408). */
const INVITATION_INVALID =
  'Liên kết lời mời không đúng (có thể bị chép thiếu hoặc sai). Hãy mở lại đúng liên kết trong thư mời, hoặc nhờ quản trị viên gửi lại lời mời.';
const SIGNED_IN_WARNING = 'Nhận lời mời sẽ đăng xuất tài khoản đang đăng nhập.'; // :182
const SESSION_NOT_OPENED =
  'Đã nhận lời mời nhưng chưa mở được phiên. Hãy đăng nhập bằng mật khẩu vừa đặt.'; // :183
const INVITATION_RETRY_FAILED = 'Đã thử lại nhưng vẫn chưa kết nối được máy chủ.'; // :184 (BUG-024)
const INVITATION_SUCCESS = 'Đã nhận lời mời. Đang mở tài khoản của bạn.'; // :185
const INVITATION_DONE_SUBTITLE = 'Tài khoản của bạn đã sẵn sàng.'; // auth.invitation.doneSubtitle (BUG-097)
const RESET_LINK_EXPIRED =
  'Liên kết đã hết hạn hoặc đã được dùng. Hãy yêu cầu liên kết mới ở trang đăng nhập.'; // :191
const RESET_LINK_INCOMPLETE =
  'Trang này không còn mã của liên kết đặt lại mật khẩu (trang đã được tải lại hoặc liên kết bị cắt). Hãy mở lại đúng liên kết trong thư, hoặc yêu cầu liên kết mới ở trang đăng nhập.'; // :192 (BUG-005)
const RESET_SUCCESS = 'Đã đổi mật khẩu. Đang chuyển tới trang đăng nhập.'; // :193
const RESET_DONE_SUBTITLE = 'Mật khẩu mới đã có hiệu lực.'; // auth.passwordReset.doneSubtitle (BUG-097)
const PASSWORD_RESET_NOTICE = 'Đã đổi mật khẩu. Hãy đăng nhập lại bằng mật khẩu mới.'; // :197
const RETRY = 'Thử lại'; // common.retry :8
const NETWORK_TITLE = 'Mất kết nối'; // errors.network.title :14 — asserted ABSENT from the strips (BUG-021)
const NETWORK_DESCRIPTION = 'Không liên lạc được với máy chủ. Kiểm tra mạng rồi thử lại.'; // :15
const UNKNOWN_TITLE = 'Có trục trặc'; // errors.unknown :62
const UNKNOWN_DESCRIPTION = 'Hệ thống đã ghi nhận và sẽ kiểm tra. Hãy thử lại sau ít phút.'; // vi.json:63 (FIX-1387) — ABSENT (BUG-015)
const CHECKING = 'Đang kiểm tra kết nối.'; // connectionStates.checking :4197

/** `ProjectDashboard.tsx:196` h1 — proof `/` painted (as in Phase 1). */
const DASHBOARD_TITLE = 'Chọn dự án để làm tiếp';

/** ≥ 8 chars (`src/api/schemas/auth.ts:14`). Never a real password; only ever sent to a mock or with a bogus token. */
const PROBE_PASSWORD = 'mat-khau-e2e-rec';
/** `src/api/schemas/auth.ts:15` / BE:auth_recovery/router.py:56 TOKEN_MAX_LEN. */
const TOKEN_MAX = 512;
const RUN_TAG = Date.now().toString(36);
const fakeToken = (slug: string): string => `e01rec-${RUN_TAG}-${slug}`;

const authMain = (page: Page, state: string) => page.locator(`main[data-auth-state="${state}"]`);
const h1 = (page: Page, name: string) => page.getByRole('heading', { level: 1, name, exact: true });
const SIGN_IN_TITLE = 'Đăng nhập để tiếp tục dự án'; // AuthScreen.tsx SIGN_IN_TITLE (h1 of the sign-in form)
const button = (page: Page, name: string) => page.getByRole('button', { name, exact: true });
const field = (page: Page, label: string) => page.getByLabel(label, { exact: true });
/** The always-mounted live line inside the form (InvitationAccept.tsx:107-112, PasswordReset.tsx:68-70). */
// RecoveryStatus (RecoveryShell.tsx) is a `div[role=status]` since BUG-097.
const formStatus = (page: Page) => page.locator('form [role="status"]');

/* ------------------------------------------------------------------ helpers */

/** Open `url` and wait for the page's session bootstrap (`POST /api/auth/refresh`) to answer `status`. */
async function openWithBootstrap(page: Page, url: string, status: 401 | 200): Promise<void> {
  const answered = page.waitForResponse(
    (response) =>
      response.request().method() === 'POST' &&
      new URL(response.url()).pathname === REFRESH_API &&
      response.status() === status,
  );
  await page.goto(url, { waitUntil: 'commit' });
  await answered;
}

/** `POST <path>` requests the page sends from now on (not intercepted; for "no request" rows). */
function recordPosts(page: Page, path: string): Request[] {
  const sent: Request[] = [];

  page.on('request', (request) => {
    if (request.method() === 'POST' && new URL(request.url()).pathname === path) sent.push(request);
  });
  return sent;
}

/** Replace the response of `POST <path>` with `reply`; returns the intercepted requests. */
async function mockPost(page: Page, path: string, reply: (route: Route) => Promise<void>): Promise<Request[]> {
  const seen: Request[] = [];

  await page.route(
    (url) => url.pathname === path,
    async (route) => {
      if (route.request().method() !== 'POST') return route.fallback();
      seen.push(route.request());
      await reply(route);
    },
  );
  return seen;
}

/** BE error envelope `{code, requestId, …}` (BE:apps/api/core/errors.py:82-99). */
const wire = (status: number, body: Record<string, unknown>, headers: Record<string, string> = {}) =>
  (route: Route): Promise<void> =>
    route.fulfill({
      status,
      contentType: 'application/json',
      headers,
      body: JSON.stringify({ requestId: 'req_e01rec', ...body }),
    });
const noContent = (route: Route): Promise<void> => route.fulfill({ status: 204 });

function deferred(): { readonly promise: Promise<void>; readonly open: () => void } {
  let open!: () => void;
  const promise = new Promise<void>((resolve) => {
    open = resolve;
  });

  return { promise, open };
}

/** An InlineAlert carrying `text`; its title, when there is one, is an `h4` (InlineAlert.tsx:41-58). */
const alertWith = (page: Page, text: string) => page.getByRole('alert').filter({ hasText: text });

/**
 * The submit strip sits UNDER the submit button (InvitationAccept.tsx:154-160, PasswordReset.tsx:104-108,
 * BUG-008): appearing, it pushes nothing the pointer just pressed.
 */
async function expectStripUnderSubmit(page: Page, strip: ReturnType<typeof alertWith>, submit: string): Promise<void> {
  const stripBox = await strip.boundingBox();
  const submitBox = await button(page, submit).boundingBox();
  expect(stripBox && submitBox, 'strip + submit boxes').toBeTruthy();
  expect(stripBox!.y, 'strip under the submit button').toBeGreaterThanOrEqual(submitBox!.y + submitBox!.height);
}

/** One painted frame: a synchronous handler has sent whatever it was going to send by then. */
async function nextFrame(page: Page): Promise<void> {
  await page.evaluate(() => new Promise<void>((resolve) => requestAnimationFrame(() => resolve())));
}

interface RecoveryScreen {
  readonly id: 'SCR-03' | 'SCR-04';
  readonly slug: 'invite' | 'reset';
  readonly path: string;
  readonly api: string;
  readonly submit: string;
  readonly title: string;
  readonly subtitle: string;
  /** Dead-end copy for a token the server rejected (422 token / *_TOKEN_INVALID). */
  readonly expired: string;
  /** Dead-end copy when the page has no usable token at all (isLinkIncomplete, BUG-005). */
  readonly incomplete: string;
  /** Dead-end copy for a token present on the URL but malformed (over 512 chars). */
  readonly malformed: string;
  /** Required-field copy per label on an empty submit, in form order. */
  readonly required: readonly { readonly label: string; readonly copy: string }[];
  readonly fillValid: (page: Page) => Promise<void>;
}

const INVITE: RecoveryScreen = {
  id: 'SCR-03',
  slug: 'invite',
  path: ROUTES.invitationAccept,
  api: INVITATION_ACCEPT_API,
  submit: ACCEPT_INVITATION,
  title: 'Nhận lời mời', // vi.json:177
  subtitle: 'Đặt họ tên và mật khẩu để bắt đầu làm việc.', // :178 (no "AppFront" since BUG-004)
  expired: INVITATION_EXPIRED,
  incomplete: INVITATION_INCOMPLETE,
  malformed: INVITATION_INVALID, // G1-10: present but malformed = a broken link, not a "cut" one
  // useInvitationAccept.ts:193-205 (fullNameProblem :109-121, recoveryShared.ts:119-137).
  required: [
    { label: FULL_NAME_LABEL, copy: FULL_NAME_REQUIRED },
    { label: PASSWORD_LABEL, copy: PASSWORD_REQUIRED },
    { label: CONFIRM_PASSWORD_LABEL, copy: CONFIRM_REQUIRED },
  ],
  fillValid: async (page) => {
    await field(page, FULL_NAME_LABEL).fill('E2E QA');
    // `exact`: "Mật khẩu" must not match "Nhập lại mật khẩu".
    await field(page, PASSWORD_LABEL).fill(PROBE_PASSWORD);
    await field(page, CONFIRM_PASSWORD_LABEL).fill(PROBE_PASSWORD);
  },
};

const RESET: RecoveryScreen = {
  id: 'SCR-04',
  slug: 'reset',
  path: ROUTES.passwordReset,
  api: PASSWORD_RESET_CONFIRM_API,
  submit: SET_NEW_PASSWORD,
  title: 'Đặt lại mật khẩu', // vi.json:188
  subtitle: 'Nhập mật khẩu mới cho tài khoản của bạn.', // :189
  expired: RESET_LINK_EXPIRED,
  incomplete: RESET_LINK_INCOMPLETE,
  malformed: RESET_LINK_INCOMPLETE,
  // usePasswordReset.ts:147-157.
  required: [
    { label: NEW_PASSWORD_LABEL, copy: PASSWORD_REQUIRED },
    { label: CONFIRM_PASSWORD_LABEL, copy: CONFIRM_REQUIRED },
  ],
  fillValid: async (page) => {
    await field(page, NEW_PASSWORD_LABEL).fill(PROBE_PASSWORD);
    await field(page, CONFIRM_PASSWORD_LABEL).fill(PROBE_PASSWORD);
  },
};

/**
 * Open the form with a fake `#token=` (anonymous unless `bootstrap` = 200) and wait until it can submit:
 * the invitation button stays disabled while the session is pending (useInvitationAccept.ts:333).
 * The token never reaches the backend unless the test lets the submit through.
 */
async function openForm(page: Page, screen: RecoveryScreen, token: string, bootstrap: 401 | 200 = 401): Promise<void> {
  // [mocked preview] for SCR-03: the form opens only after the token preview (support/p01/recovery.ts).
  if (screen.slug === 'invite') await mockInvitationPreview(page);
  await openWithBootstrap(page, `${screen.path}#token=${token}`, bootstrap);
  await expect(field(page, screen.required[0]!.label)).toBeVisible();
  await expect(button(page, screen.submit)).toBeEnabled();
  // fragmentToken.ts:41-45: the hash is dropped in the same call that reads it.
  await expect.poll(() => new URL(page.url()).hash).toBe('');
}

/* ------------------------------------------------------- shared, per screen */

for (const screen of [INVITE, RESET]) {
  const { id, slug } = screen;

  test.describe(`${id} recovery edges`, () => {
    test(`${id} · unusable #fragments (empty token, no token key, ${TOKEN_MAX + 1} chars) → dead-end, hash stripped, no request; ${TOKEN_MAX} chars → form`, async ({ page }) => {
      // fragmentToken.ts:41-54 strips ANY hash; token '' / absent → null; zod token max 512
      // (schemas/auth.ts:15) → hasUsableToken false (useInvitationAccept.ts:131-134, usePasswordReset.ts:93-96)
      // → isDead → `forbidden` → RecoveryDeadEnd (RecoveryShell.tsx:85-91). No usable token = isLinkIncomplete
      // (useInvitationAccept.ts:340 / usePasswordReset.ts:252) → the "incomplete" sentence, never "đã hết hạn"
      // (InvitationAccept.tsx:86 / PasswordReset.tsx:65-67, BUG-005).
      const sent = recordPosts(page, screen.api);

      for (const hash of ['#token=', '#foo=bar', `#token=${'a'.repeat(TOKEN_MAX + 1)}`]) {
        await page.goto('about:blank');
        await openWithBootstrap(page, `${screen.path}${hash}`, 401);
        await expect(authMain(page, 'forbidden'), hash.slice(0, 20)).toBeVisible();
        // SCR-03 since G1-10: a token that is there but malformed (513 chars) reads "không đúng", not "bị cắt".
        const copy = hash.length > TOKEN_MAX ? screen.malformed : screen.incomplete;
        await expect(page.getByText(copy, { exact: true }), hash.slice(0, 20)).toBeVisible();
        await expect(page.getByText(screen.expired, { exact: true }), 'no "expired" copy without a server 422').toHaveCount(0);
        await expect.poll(() => new URL(page.url()).hash, { message: hash.slice(0, 20) }).toBe('');
      }
      await captureEvidence(page, `E01_rec_${slug}_unusable_token.png`);

      await page.goto('about:blank');
      await openForm(page, screen, 'a'.repeat(TOKEN_MAX));
      await expect(authMain(page, 'empty')).toBeVisible();
      await nextFrame(page);
      expect(sent, `POST ${screen.api}`).toEqual([]);
      await attachJson(`E01_rec_${slug}_unusable_token.json`, { posts: sent.length, hashesStripped: true }); // BUG-034
    });

    test(`${id} · reload after the #token was stripped → dead-end (token lives only for one page load)`, async ({ page }) => {
      // fragmentToken.ts:16-18,26: the remembered token is a module variable, gone on reload; the URL has no
      // hash any more → null → `forbidden` with the "incomplete" sentence (BUG-005: the copy names the reload).
      await openForm(page, screen, fakeToken(`${slug}-reload`));

      const reloaded = page.waitForResponse(
        (response) => new URL(response.url()).pathname === REFRESH_API && response.status() === 401,
      );
      await page.reload({ waitUntil: 'commit' });
      await reloaded;

      await expect(authMain(page, 'forbidden')).toBeVisible();
      await expect(page.getByText(screen.incomplete, { exact: true })).toBeVisible();
      await expect(page.getByText(screen.expired, { exact: true })).toHaveCount(0);
      expect(pathOf(page.url())).toBe(screen.path);
      await attachJson(`E01_rec_${slug}_reload_deadend.json`, { url: pathOf(page.url()), reloadRefresh: 401 }); // BUG-034
      await captureEvidence(page, `E01_rec_${slug}_reload_deadend.png`);
    });

    test(`${id} · dead-end "Về trang đăng nhập" → /login sign-in form`, async ({ page }) => {
      // RecoveryShell.tsx:66-69 preventDefault + goToSignIn → navigate(ROUTES.login)
      // (useInvitationAccept.ts:266-268, usePasswordReset.ts:207-209).
      await openWithBootstrap(page, screen.path, 401);
      await expect(authMain(page, 'forbidden')).toBeVisible();

      await page.getByRole('link', { name: GO_TO_SIGN_IN, exact: true }).click();

      await expect.poll(() => pathOf(page.url())).toBe(ROUTES.login);
      await expect(h1(page, SIGN_IN_TITLE)).toBeVisible();
      await attachJson(`E01_rec_${slug}_deadend_link.json`, { landed: pathOf(page.url()) }); // BUG-034
      await captureEvidence(page, `E01_rec_${slug}_deadend_link.png`);
    });

    test(`${id} · title/subtitle, first field autofocused; Enter on the empty form submits → every "chưa nhập" copy under its field, no request`, async ({ page }) => {
      // RecoveryShell.tsx:27-31 h1 + subtitle; autoFocus (InvitationAccept.tsx:119 / PasswordReset.tsx:77).
      // <form onSubmit> (InvitationAccept.tsx:98-103,54-60 / PasswordReset.tsx:65,32-38): Enter = implicit
      // submission → submit() → client validation returns before the port.
      await openForm(page, screen, fakeToken(`${slug}-enter`));
      const sent = recordPosts(page, screen.api);

      await expect(h1(page, screen.title)).toBeVisible();
      await expect(page.getByText(screen.subtitle, { exact: true })).toBeVisible();
      await expect(field(page, screen.required[0]!.label)).toBeFocused();

      await field(page, screen.required[0]!.label).press('Enter');

      for (const { label, copy } of screen.required) {
        await expect(field(page, label), label).toHaveAccessibleDescription(copy);
        await expect(field(page, label), label).toHaveAttribute('aria-invalid', 'true');
      }
      await expect(authMain(page, 'empty')).toBeVisible();
      await expect(page.getByText(SIGNED_IN_WARNING, { exact: true })).toHaveCount(0);
      await nextFrame(page);
      expect(sent, `POST ${screen.api}`).toEqual([]);
      await attachJson(`E01_rec_${slug}_enter_empty.json`, { posts: sent.length }); // BUG-034
      await captureEvidence(page, `E01_rec_${slug}_enter_empty.png`);
    });

    test(`${id} · 375×812: form fits, no horizontal scroll, submit in view`, async ({ page }) => {
      // RecoveryShell.tsx:22,25: no breakpoint variants (`p-12`, `w-[360px] max-w-full`) — same layout,
      // narrower column. Asserted: nothing overflows the phone width.
      const phone = { width: 375, height: 812 };
      test.skip(isPhoneOutOfScope(phone), PHONE_OUT_OF_SCOPE);
      await page.setViewportSize(phone);
      await openForm(page, screen, fakeToken(`${slug}-375`));

      const overflow = await page.evaluate(
        () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
      );
      expect(overflow, 'horizontal overflow (px)').toBeLessThanOrEqual(0);
      const box = await button(page, screen.submit).boundingBox();
      expect(box, 'submit button box').not.toBeNull();
      expect(box!.x).toBeGreaterThanOrEqual(0);
      expect(box!.x + box!.width).toBeLessThanOrEqual(375);
      await captureEvidence(page, `E01_rec_${slug}_compact_375.png`, { fullPage: true });
    });

    test(`${id} · [mocked response] slow 500: "Đang gửi…" + fields locked, double click sends ONE request; then "Có trục trặc", form back`, async ({ page }) => {
      // Loading: phase 'submitting' → state `loading`, button label `actions.submitting`, disabled;
      // fields disabled (InvitationAccept.tsx:62,153-157 / PasswordReset.tsx:40,98-100). inFlight ref
      // (useInvitationAccept.ts:187,214 / usePasswordReset.ts:141,164) drops the 2nd submit of the tick.
      // 500 → classify `other` (recoveryShared.ts:37-67) → kind 'unknown' → errors.unknown title +
      // auth.errors.recoveryFailed, NOT the "tải lại" advice: a reload loses the link's token (recoveryShared.ts:
      // 99-110, BUG-015). Strip under the button (BUG-008). POST is never retried (lib/http/retry.ts:25-26,87).
      const hold = deferred();
      const seen = await mockPost(page, screen.api, async (route) => {
        await hold.promise;
        await wire(500, { code: 'INTERNAL' })(route);
      });

      await openForm(page, screen, fakeToken(`${slug}-slow`));
      await screen.fillValid(page);
      await button(page, screen.submit).evaluate((element) => {
        (element as HTMLButtonElement).click();
        (element as HTMLButtonElement).click();
      });

      await expect(authMain(page, 'loading')).toBeVisible();
      await expect(button(page, SUBMITTING)).toBeDisabled();
      await expect(field(page, screen.required[0]!.label)).toBeDisabled();
      await captureEvidence(page, `E01_rec_${slug}_loading.png`);
      await nextFrame(page);
      expect(seen, `POST ${screen.api} after a double click`).toHaveLength(1);

      hold.open();
      const strip = alertWith(page, RECOVERY_FAILED);
      await expect(strip).toBeVisible();
      await expect(strip.getByRole('heading', { name: UNKNOWN_TITLE, exact: true })).toBeVisible();
      await expect(strip.getByText(RECOVERY_FAILED, { exact: true })).toBeVisible();
      await expect(page.getByText(/tải lại/), 'no reload advice (BUG-015)').toHaveCount(0);
      await expect(authMain(page, 'error')).toBeVisible();
      await expectStripUnderSubmit(page, strip, screen.submit);
      await expect(button(page, screen.submit)).toBeEnabled();
      await expect(field(page, CONFIRM_PASSWORD_LABEL)).toHaveValue(PROBE_PASSWORD);
      expect(seen).toHaveLength(1);
      await attachJson(`E01_rec_${slug}_server_500.json`, { requests: seen.length }); // BUG-034: double click sent one
      await captureEvidence(page, `E01_rec_${slug}_server_500.png`);
    });

    test(`${id} · [mocked response] network failure → "Mất kết nối" strip, can resubmit`, async ({ page }) => {
      // fetch rejects → HttpError kind 'network' (lib/http/client.ts catch branch) → `other` → attention strip
      // with the description only: it already opens with "Mất kết nối máy chủ.", so no title (recoveryShared.ts:
      // 112-118, BUG-021/020). Strip under the button (BUG-008). Not locked: canSubmit stays true.
      const seen = await mockPost(page, screen.api, (route) => route.abort('failed'));

      await openForm(page, screen, fakeToken(`${slug}-net`));
      await screen.fillValid(page);
      await button(page, screen.submit).click();

      const strip = alertWith(page, NETWORK_DESCRIPTION);
      await expect(strip).toBeVisible();
      await expect(strip.getByText(NETWORK_DESCRIPTION, { exact: true })).toBeVisible();
      await expect(strip.getByRole('heading'), 'no title repeating the sentence (BUG-021)').toHaveCount(0);
      await expect(page.getByText(NETWORK_TITLE, { exact: true })).toHaveCount(0);
      await expect(authMain(page, 'error')).toBeVisible();
      await expectStripUnderSubmit(page, strip, screen.submit);
      await expect(button(page, screen.submit)).toBeEnabled();
      expect(seen).toHaveLength(1);
      await attachJson(`E01_rec_${slug}_network.json`, { requests: seen.length }); // BUG-034
      await captureEvidence(page, `E01_rec_${slug}_network.png`);
    });

    test(`${id} · [mocked response] 429 RATE_LIMITED → "Đã thử quá nhiều lần" strip, submit locked`, async ({ page }) => {
      // recoveryShared.ts:44-49 → rateLimited, seconds = max(Retry-After, 60) (:22); notice :87-92 = title
      // tooManyAttempts.title + body tooManyRecovery, which no longer repeats the title; strip under the button;
      // lock() → canSubmit false (useInvitationAccept.ts:255-257,333 / usePasswordReset.ts:196-198,244).
      await mockPost(page, screen.api, wire(429, { code: 'RATE_LIMITED' }, { 'Retry-After': '10' }));

      await openForm(page, screen, fakeToken(`${slug}-429`));
      await screen.fillValid(page);
      await button(page, screen.submit).click();

      const strip = alertWith(page, TOO_MANY_RECOVERY);
      await expect(strip).toBeVisible();
      await expect(strip.getByRole('heading', { name: TOO_MANY_TITLE, exact: true })).toBeVisible();
      // Exact body text = the title is not repeated inside it.
      await expect(strip.getByText(TOO_MANY_RECOVERY, { exact: true })).toBeVisible();
      await expect(authMain(page, 'error')).toBeVisible();
      await expectStripUnderSubmit(page, strip, screen.submit);
      await expect(button(page, screen.submit)).toBeDisabled();
      await captureEvidence(page, `E01_rec_${slug}_rate_limited.png`);
    });

    test(`${id} · [mocked response] 403 ORIGIN_MISMATCH → "Máy chủ từ chối yêu cầu" strip`, async ({ page }) => {
      // recoveryShared.ts:58-60 → originMismatch; notice :93-98 (violation). Not locked.
      await mockPost(page, screen.api, wire(403, { code: 'ORIGIN_MISMATCH' }));

      await openForm(page, screen, fakeToken(`${slug}-origin`));
      await screen.fillValid(page);
      await button(page, screen.submit).click();

      await expect(page.getByText(ORIGIN_MISMATCH_TITLE, { exact: true })).toBeVisible();
      await expect(page.getByText(ORIGIN_MISMATCH_DESCRIPTION, { exact: true })).toBeVisible();
      await expect(authMain(page, 'error')).toBeVisible();
      await expect(button(page, screen.submit)).toBeEnabled();
      await captureEvidence(page, `E01_rec_${slug}_origin_mismatch.png`);
    });

    test(`${id} · [mocked response] 422 VALIDATION field "token" → dead-end like an invalid token`, async ({ page }) => {
      // recoveryShared.ts:51-56: `VALIDATION` + field `token` = tokenInvalid → isDead → `forbidden`.
      await mockPost(page, screen.api, wire(422, { code: 'VALIDATION', field: 'token', count: 1 }));

      await openForm(page, screen, fakeToken(`${slug}-vtoken`));
      await screen.fillValid(page);
      await button(page, screen.submit).click();

      await expect(authMain(page, 'forbidden')).toBeVisible();
      await expect(page.getByText(screen.expired, { exact: true })).toBeVisible();
      await expect(page.getByRole('link', { name: GO_TO_SIGN_IN, exact: true })).toBeVisible();
      await captureEvidence(page, `E01_rec_${slug}_validation_token.png`);
    });
  });
}

/* ---------------------------------------------------------- SCR-03 only */

test.describe('SCR-03 InvitationAccept edges', () => {
  test('SCR-03 · client rules: blank name, name > 120, password < 8; typing clears that field\'s problem; no request', async ({ page }) => {
    // fullNameProblem (useInvitationAccept.ts:109-121; schemas/auth.ts:46 trim().min(1).max(120));
    // passwordProblem (recoveryShared.ts:119-128); edit() drops the field's problem (useInvitationAccept.ts:148-160).
    await openForm(page, INVITE, fakeToken('invite-rules'));
    const sent = recordPosts(page, INVITATION_ACCEPT_API);
    const name = field(page, FULL_NAME_LABEL);
    const password = field(page, PASSWORD_LABEL);

    await name.fill('    ');
    await password.fill('1234567');
    await field(page, CONFIRM_PASSWORD_LABEL).fill('1234567');
    await button(page, ACCEPT_INVITATION).click();
    await expect(name).toHaveAccessibleDescription(FULL_NAME_REQUIRED);
    await expect(password).toHaveAccessibleDescription(PASSWORD_TOO_SHORT);

    await name.fill('x'.repeat(121));
    await expect(name).not.toHaveAttribute('aria-invalid', 'true');
    await expect(page.getByText(FULL_NAME_REQUIRED, { exact: true })).toHaveCount(0);
    await button(page, ACCEPT_INVITATION).click();
    await expect(name).toHaveAccessibleDescription(FULL_NAME_TOO_LONG);
    await expect(password).toHaveAccessibleDescription(PASSWORD_TOO_SHORT);

    await nextFrame(page);
    expect(sent, `POST ${INVITATION_ACCEPT_API}`).toEqual([]);
    await attachJson('E01_rec_invite_field_rules.json', { posts: sent.length }); // BUG-034
    await captureEvidence(page, 'E01_rec_invite_field_rules.png');
  });

  test('SCR-03 · [mocked response] 422 VALIDATION field fullName / password → copy under that field, form stays', async ({ page }) => {
    // recoveryShared.ts:62-64 → `field`; useInvitationAccept.ts:246-251 maps fullName → "Họ và tên",
    // anything else known → "Mật khẩu"; serverFieldProblem (recoveryShared.ts:160-162): a server-side fullName
    // problem can only be a forbidden character now (FE blocks blank / too long) → fullNameInvalid (BUG-016).
    const fields = ['fullName', 'password'];
    let call = 0;
    await mockPost(page, INVITATION_ACCEPT_API, (route) =>
      wire(422, { code: 'VALIDATION', field: fields[call++] ?? 'password', count: 1 })(route),
    );

    await openForm(page, INVITE, fakeToken('invite-vfield'));
    await INVITE.fillValid(page);
    await button(page, ACCEPT_INVITATION).click();
    await expect(field(page, FULL_NAME_LABEL)).toHaveAccessibleDescription(FULL_NAME_INVALID);
    await expect(page.getByText(FULL_NAME_REQUIRED, { exact: true }), 'not "chưa nhập" under a typed name').toHaveCount(0);
    await expect(authMain(page, 'partial')).toBeVisible();

    // BUG-094: the password half with a password the real BE answers 422 for (4 code points, 8 UTF-16 units).
    await field(page, PASSWORD_LABEL).fill(BE_SHORT_PASSWORD);
    await field(page, CONFIRM_PASSWORD_LABEL).fill(BE_SHORT_PASSWORD);
    await button(page, ACCEPT_INVITATION).click();
    await expect(field(page, PASSWORD_LABEL)).toHaveAccessibleDescription(PASSWORD_TOO_SHORT);
    await expect(field(page, FULL_NAME_LABEL)).toHaveValue('E2E QA');
    await captureEvidence(page, 'E01_rec_invite_server_field.png', {
      caption: '[mocked response] 422 VALIDATION field "password"; boxes: 4 astral chars (BE counts 4 < 8) — real pair A01_accept_422_password',
    });
  });

  test('SCR-03 · real BE: name with U+202E (bidi override) → 422 field fullName → "Họ và tên có ký tự không dùng được…" under the typed name (BUG-016)', async ({ page }) => {
    // REAL request #1 (the only one of this file). FE accepts it (schemas/auth.ts:46 only trims and measures);
    // BE clean_text rejects bidi overrides (BE:packages/core/text.py:6,35-46; auth_recovery/router.py:59-64,102-106)
    // during body validation, before any token lookup → 422 VALIDATION field "fullName". FE maps a server
    // fullName problem to `fullNameInvalid` (recoveryShared.ts:156-162, BUG-016 fixed: it no longer says the
    // name is missing while it is visibly typed). Same check as the E01 bidi test in phase01_auth_edge.spec.ts,
    // which also asserts the button stays enabled; kept here (not 100 % identical) for the recovery inventory.
    await openForm(page, INVITE, fakeToken('invite-bidi'));
    await field(page, FULL_NAME_LABEL).fill('E2E ‮QA');
    await field(page, PASSWORD_LABEL).fill(PROBE_PASSWORD);
    await field(page, CONFIRM_PASSWORD_LABEL).fill(PROBE_PASSWORD);
    const answered = page.waitForResponse(
      (response) =>
        response.request().method() === 'POST' && new URL(response.url()).pathname === INVITATION_ACCEPT_API,
    );
    await button(page, ACCEPT_INVITATION).click();

    expect((await answered).status(), `POST ${INVITATION_ACCEPT_API}`).toBe(422);
    await expect(field(page, FULL_NAME_LABEL)).toHaveAccessibleDescription(FULL_NAME_INVALID);
    await expect(field(page, FULL_NAME_LABEL)).toHaveValue('E2E ‮QA');
    await expect(authMain(page, 'forbidden')).toHaveCount(0);
    await attachJson('E01_rec_invite_bidi_name.json', { acceptStatus: 422 }); // BUG-034
    await captureEvidence(page, 'E01_rec_invite_bidi_name.png');
  });

  test('SCR-03 · [mocked response] 204 but no session (anonymous) → "Đã nhận lời mời nhưng chưa mở được phiên…", form locked, link → /login; body = hash token + trimmed name', async ({ page }) => {
    // 204 → bootstrapSession (= bootstrapAfterNewCookie, InvitationAccept.container.tsx:40) → real refresh
    // has no cookie → false → sessionNotOpened (useInvitationAccept.ts:221-235); notice :317-320; fields and
    // button locked (:182,333; InvitationAccept.tsx:62); link (InvitationAccept.tsx:159-170).
    // Body: token from the hash only, name trimmed (useInvitationAccept.ts:218).
    const token = fakeToken('invite-nosession');
    const seen = await mockPost(page, INVITATION_ACCEPT_API, noContent);

    await openForm(page, INVITE, token);
    await field(page, FULL_NAME_LABEL).fill('  E2E QA  ');
    await field(page, PASSWORD_LABEL).fill(PROBE_PASSWORD);
    await field(page, CONFIRM_PASSWORD_LABEL).fill(PROBE_PASSWORD);
    await button(page, ACCEPT_INVITATION).click();

    await expect(page.getByText(SESSION_NOT_OPENED, { exact: true })).toBeVisible();
    await expect(authMain(page, 'error')).toBeVisible();
    await expect(button(page, ACCEPT_INVITATION)).toBeDisabled();
    await expect(field(page, FULL_NAME_LABEL)).toBeDisabled();
    await expect(page.getByRole('link', { name: GO_TO_SIGN_IN, exact: true })).toBeVisible();
    expect(seen).toHaveLength(1);
    expect(seen[0]!.postDataJSON()).toEqual({ token, fullName: 'E2E QA', password: PROBE_PASSWORD });
    expect(new URL(seen[0]!.url()).search, 'token never in the query').toBe('');
    await captureEvidence(page, 'E01_rec_invite_session_not_opened.png');

    await page.getByRole('link', { name: GO_TO_SIGN_IN, exact: true }).click();
    await expect.poll(() => pathOf(page.url())).toBe(ROUTES.login);
    await expect(h1(page, SIGN_IN_TITLE)).toBeVisible();
    // BUG-034: body and URL are not in the shots; the password value is never attached.
    await attachJson('E01_rec_invite_session_not_opened.json', {
      requests: seen.length,
      bodyKeys: Object.keys(seen[0]!.postDataJSON() as Record<string, unknown>),
      fullName: (seen[0]!.postDataJSON() as { fullName?: unknown }).fullName,
      tokenInQuery: new URL(seen[0]!.url()).search !== '',
      landed: pathOf(page.url()),
    });
  });

  test('SCR-03 · [mocked response] server unreachable at load → "Mất kết nối" + "Thử lại"; retry pending/failed copy; retry OK → strip gone, focus on "Họ và tên"', async ({ page }) => {
    // Refresh fails at the network → handleTransientFailure sets serverUnreachable (lib/auth/refresh.ts:306-308,
    // 491) while status stays `unknown` → isSessionUnavailable (InvitationAccept.container.tsx:32) → alert
    // with retry and NO title (InvitationAccept.tsx:94-100). Retry: retryAppSession (container :47) → retryNotice
    // pending = connectionStates.checking, failed = invitation.retryFailed — something new, not the strip's own
    // sentence again (useInvitationAccept.ts:276-291,341-348, BUG-024). When the session resolves (401 →
    // anonymous) the strip unmounts and focus returns to the first field (InvitationAccept.tsx:43-54).
    let mode: 'abort' | 'hold' | 'pass' = 'abort';
    const held: Route[] = [];
    await page.route(
      (url) => url.pathname === REFRESH_API,
      async (route) => {
        if (mode === 'abort') return route.abort('failed');
        if (mode === 'hold') {
          held.push(route);
          return undefined;
        }
        return route.fallback();
      },
    );

    await mockInvitationPreview(page); // [mocked preview] (support/p01/recovery.ts)
    await page.goto(`${ROUTES.invitationAccept}#token=${fakeToken('invite-offline')}`, { waitUntil: 'commit' });
    const alert = alertWith(page, NETWORK_DESCRIPTION);
    await expect(alert).toBeVisible();
    await expect(alert.getByText(NETWORK_DESCRIPTION, { exact: true })).toBeVisible();
    await expect(alert.getByRole('heading'), 'no title repeating the sentence').toHaveCount(0);
    await expect(field(page, FULL_NAME_LABEL)).toBeVisible();
    await expect(button(page, ACCEPT_INVITATION)).toBeEnabled();
    await captureEvidence(page, 'E01_rec_invite_server_unreachable.png');

    mode = 'hold';
    await button(page, RETRY).click();
    await expect(formStatus(page)).toHaveText(CHECKING);
    mode = 'abort';
    await expect.poll(() => held.length).toBeGreaterThan(0);
    await Promise.all(held.splice(0).map((route) => route.abort('failed')));
    await expect(formStatus(page)).toHaveText(INVITATION_RETRY_FAILED);
    await expect(alert, 'strip still there after a failed retry').toBeVisible();
    await captureEvidence(page, 'E01_rec_invite_retry_failed.png');

    mode = 'pass';
    const resolved = page.waitForResponse(
      (response) => new URL(response.url()).pathname === REFRESH_API && response.status() === 401,
    );
    await button(page, RETRY).click();
    await resolved;
    await expect(alert).toHaveCount(0);
    await expect(field(page, FULL_NAME_LABEL)).toBeFocused();
    await expect(formStatus(page)).toHaveText('');
    await attachJson('E01_rec_invite_retry_ok.json', { retryRefreshStatus: 401 }); // BUG-034
    await captureEvidence(page, 'E01_rec_invite_retry_ok.png');
  });

  test('SCR-03 · signed in → "Nhận lời mời sẽ đăng xuất tài khoản đang đăng nhập." above the form', async ({ page }) => {
    // Login #1. isSignedIn = authenticated (InvitationAccept.container.tsx:30) → warning
    // (useInvitationAccept.ts:329-332; InvitationAccept.tsx:104). Nothing is submitted.
    await signInAdmin(page);
    await openForm(page, INVITE, fakeToken('invite-signedin'), 200);

    await expect(page.getByText(SIGNED_IN_WARNING, { exact: true })).toBeVisible();
    await expect(authMain(page, 'empty')).toBeVisible();
    await captureEvidence(page, 'E01_rec_invite_signed_in_warning.png');
  });

  test('SCR-03 · [mocked response] signed in, 204 → "Đã nhận lời mời. Đang mở tài khoản của bạn." → session opens → /', async ({ page }) => {
    // Login #2. Accept mocked 204; the follow-up REAL refresh (this context's own admin cookie) is held to
    // see the `success` state (useInvitationAccept.ts:221; InvitationAccept.tsx:111; warning hidden when
    // isDone :330), then released → established → navigate(ROUTES.dashboard, replace) (:224-229).
    await signInAdmin(page);
    await openForm(page, INVITE, fakeToken('invite-happy'), 200);
    await mockPost(page, INVITATION_ACCEPT_API, noContent);
    const release = deferred();
    await page.route(
      (url) => url.pathname === REFRESH_API,
      async (route) => {
        await release.promise;
        await route.fallback();
      },
    );

    await INVITE.fillValid(page);
    await button(page, ACCEPT_INVITATION).click();

    await expect(authMain(page, 'success')).toBeVisible();
    await expect(formStatus(page)).toHaveText(INVITATION_SUCCESS);
    // BUG-097: the fields are locked, so the "fill this in" subtitle gives way to the done one.
    await expect(page.getByText(INVITE.subtitle, { exact: true })).toHaveCount(0);
    await expect(page.getByText(INVITATION_DONE_SUBTITLE, { exact: true })).toBeVisible();
    await expect(page.getByText(SIGNED_IN_WARNING, { exact: true })).toHaveCount(0);
    await expect(field(page, FULL_NAME_LABEL)).toBeDisabled();
    await captureEvidence(page, 'E01_rec_invite_success.png');

    release.open();
    await expect.poll(() => pathOf(page.url())).toBe(ROUTES.dashboard);
    await expect(h1(page, DASHBOARD_TITLE)).toBeVisible();
    await attachJson('E01_rec_invite_landed.json', { landed: pathOf(page.url()) }); // BUG-034
    await captureEvidence(page, 'E01_rec_invite_landed.png');
  });
});

/* ---------------------------------------------------------- SCR-04 only */

test.describe('SCR-04 PasswordReset edges', () => {
  test('SCR-04 · short new password → "cần ít nhất 8 ký tự"; mismatch → "Hai mật khẩu chưa giống nhau."; no request', async ({ page }) => {
    // usePasswordReset.ts:146-158; recoveryShared.ts:136-154. "Mật khẩu cần ít nhất 8 ký tự." is ALSO the hint
    // passed to the first box (PasswordReset.tsx:80-82, passwordTooShort recoveryShared.ts:129-130): always shown
    // under it as `<id>-hint` and wired as its accessible description; while the box has an error the hint gives
    // way to the error `<id>-error` (PasswordField.tsx:36-40,79-83; Input.tsx:83,106 — BUG-049).
    await openForm(page, RESET, fakeToken('reset-rules'));
    const sent = recordPosts(page, PASSWORD_RESET_CONFIRM_API);
    const fresh = field(page, NEW_PASSWORD_LABEL);
    const confirm = field(page, CONFIRM_PASSWORD_LABEL);
    const freshId = await fresh.getAttribute('id');
    expect(freshId, '"Mật khẩu mới" input id').toBeTruthy();
    const hint = page.locator(`[id="${freshId}-hint"]`);
    const error = page.locator(`[id="${freshId}-error"]`);

    // Before any submit: the rule is a hint under the box, described, not an error.
    await expect(hint).toHaveText(PASSWORD_TOO_SHORT);
    await expect(fresh).toHaveAccessibleDescription(PASSWORD_TOO_SHORT);
    await expect(fresh).not.toHaveAttribute('aria-invalid', 'true');

    await fresh.fill('1234567');
    await confirm.fill('1234567');
    await button(page, SET_NEW_PASSWORD).click();
    // After a failed submit the error takes the hint's place (same sentence, now an error).
    await expect(error).toHaveText(PASSWORD_TOO_SHORT);
    await expect(hint, 'hint gives way to the error').toHaveCount(0);
    await expect(fresh).toHaveAttribute('aria-invalid', 'true');
    await expect(fresh).toHaveAccessibleDescription(PASSWORD_TOO_SHORT);
    await captureEvidence(page, 'E01_rec_reset_short_error.png');

    await fresh.fill(PROBE_PASSWORD);
    await confirm.fill(`${PROBE_PASSWORD}-2`);
    await button(page, SET_NEW_PASSWORD).click();
    await expect(confirm).toHaveAccessibleDescription(CONFIRM_MISMATCH);
    // The length problem is gone: no error under the first box, the hint is back (once, not twice).
    await expect(error).toHaveCount(0);
    await expect(fresh).not.toHaveAttribute('aria-invalid', 'true');
    await expect(hint).toHaveText(PASSWORD_TOO_SHORT);
    await expect(page.getByText(PASSWORD_TOO_SHORT, { exact: true }), 'only the hint carries the rule').toHaveCount(1);
    await expect(authMain(page, 'partial')).toBeVisible();

    await nextFrame(page);
    expect(sent, `POST ${PASSWORD_RESET_CONFIRM_API}`).toEqual([]);
    await attachJson('E01_rec_reset_field_rules.json', { posts: sent.length }); // BUG-034
    await captureEvidence(page, 'E01_rec_reset_field_rules.png');
  });

  test('SCR-04 · [mocked response] 422 VALIDATION field newPassword → copy under "Mật khẩu mới", form stays', async ({ page }) => {
    // recoveryShared.ts:62-64 (FIELDS = ['newPassword'], usePasswordReset.ts:81) → usePasswordReset.ts:188-191.
    await mockPost(page, PASSWORD_RESET_CONFIRM_API, wire(422, { code: 'VALIDATION', field: 'newPassword', count: 1 }));

    await openForm(page, RESET, fakeToken('reset-vfield'));
    // BUG-094: a new password the real BE answers 422 for (4 code points) and the FE still sends (8 UTF-16 units).
    await field(page, NEW_PASSWORD_LABEL).fill(BE_SHORT_PASSWORD);
    await field(page, CONFIRM_PASSWORD_LABEL).fill(BE_SHORT_PASSWORD);
    await button(page, SET_NEW_PASSWORD).click();

    await expect(field(page, NEW_PASSWORD_LABEL)).toHaveAccessibleDescription(PASSWORD_TOO_SHORT);
    await expect(authMain(page, 'partial')).toBeVisible();
    await expect(button(page, SET_NEW_PASSWORD)).toBeEnabled();
    await captureEvidence(page, 'E01_rec_reset_server_field.png', {
      caption: '[mocked response] 422 VALIDATION field "newPassword"; boxes: 4 astral chars (BE counts 4 < 8) — real pair A01_confirm_422_new_password',
    });
  });

  test('SCR-04 · [mocked response] 204 → success line → signOut (POST logout) → /login with "Đã đổi mật khẩu. Hãy đăng nhập lại bằng mật khẩu mới."; F5 drops the notice', async ({ page }) => {
    // usePasswordReset.ts:167-178: confirm {token, newPassword} → `success` (PasswordReset.tsx:68-70) →
    // endLocalSession = signOut (PasswordReset.container.tsx:30; lib/auth/session.ts:305-311 → POST logout,
    // :200) → navigate('/login', {replace, state:{notice:'passwordReset'}}). Login: noticeOf
    // (AuthScreen.container.tsx:275-281) → INITIAL_NOTICES.passwordReset (useAuthScreen.ts:296,411,642);
    // the history state is dropped once (AuthScreen.container.tsx:348-360) so a reload shows no notice.
    // Logout is held only to see the transient success line, then answered 204. The admin password is untouched.
    const token = fakeToken('reset-ok');
    const seen = await mockPost(page, PASSWORD_RESET_CONFIRM_API, noContent);
    const releaseLogout = deferred();
    const logouts = await mockPost(page, LOGOUT_API, async (route) => {
      await releaseLogout.promise;
      await noContent(route);
    });

    await openForm(page, RESET, token);
    await RESET.fillValid(page);
    await button(page, SET_NEW_PASSWORD).click();

    await expect(authMain(page, 'success')).toBeVisible();
    await expect(formStatus(page)).toHaveText(RESET_SUCCESS);
    await expect(page.getByText(RESET.subtitle, { exact: true })).toHaveCount(0);
    await expect(page.getByText(RESET_DONE_SUBTITLE, { exact: true })).toBeVisible(); // BUG-097
    await expect(field(page, NEW_PASSWORD_LABEL)).toBeDisabled();
    await captureEvidence(page, 'E01_rec_reset_success_line.png');
    expect(seen).toHaveLength(1);
    expect(seen[0]!.postDataJSON()).toEqual({ token, newPassword: PROBE_PASSWORD });
    await expect.poll(() => logouts.length, { message: `POST ${LOGOUT_API}` }).toBe(1);

    releaseLogout.open();
    await expect.poll(() => pathOf(page.url())).toBe(ROUTES.login);
    await expect(h1(page, SIGN_IN_TITLE)).toBeVisible();
    await expect(page.getByText(PASSWORD_RESET_NOTICE, { exact: true })).toBeVisible();
    await attachJson('E01_rec_reset_login_notice.json', { // BUG-034; the password value is never attached
      confirmRequests: seen.length,
      bodyKeys: Object.keys(seen[0]!.postDataJSON() as Record<string, unknown>),
      logoutRequests: logouts.length,
      landed: pathOf(page.url()),
    });
    await captureEvidence(page, 'E01_rec_reset_login_notice.png');

    const reloaded: Promise<Response> = page.waitForResponse(
      (response) => new URL(response.url()).pathname === REFRESH_API && response.status() === 401,
    );
    await page.reload({ waitUntil: 'commit' });
    await reloaded;
    await expect(h1(page, SIGN_IN_TITLE)).toBeVisible();
    await expect(page.getByText(PASSWORD_RESET_NOTICE, { exact: true })).toHaveCount(0);
  });
});
