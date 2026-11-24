/**
 * Phase 1 — Auth EDGE CASES, Track A: SCR-01 session gate + SCR-02 login (incl. the "Quên mật khẩu"
 * panel), plus the SCR-03/04 token cases kept from the first edge pass. Gaps left by
 * `phase01_auth.spec.ts`; inventory in `qa/coverage/phase01.md` (FE stamp f748afb0).
 *
 * FE refresh 7735bcda → f748afb0 (QA-01c): stale expectations rewritten in place — the gate notice is decided by
 * the pathname (a "/?query" gets none), every /login strip incl. the opening ones sits UNDER "Đăng nhập", a stray
 * `?token=` is stripped from the URL; assertions added to existing tests for the new focus return
 * (useReturnFocus / catchDroppedFocus / connection-strip "Ẩn"), BUG-059 full-width strip actions, strips and the
 * "sent" block under the panel button, the invitation warning + retry line under "Nhận lời mời". New tests are in
 * the "E01 FE refresh f748afb0" describe (field room, retry ladder + `online`, gate in front of SCR-08…40,
 * RecoveryLink modifier click, SCR-41 on /login, recovery Retry-After > 60 s, 24 px /login margins at 375).
 *
 * FE refresh c4978eb4 → 7735bcda (QA-01/QA-01b fixes): expectations re-cited to HEAD; every test whose copy
 * or behaviour moved was rewritten in place, and the "E01 FE refresh 7735bcda" describe holds the gaps the
 * new code opened (gate notice, partial rule, Enter on in-form buttons, emailTooLong, PasswordField on the
 * recovery screens, the reset form's sign-in link, new recovery strip copy, touch targets below 640 px).
 *
 * Does NOT call `resetState()` and does NOT write `tests/.state/*` (Phase 1 owns both). Every expected
 * result cites the FE source of this worktree or the BE source it was built from (`AppBack/fix378-x`,
 * written `BE:`). UI strings are copied from `src/i18n/vi.json` (`auth.*`, `errors.*`) or, for the gate,
 * from the literals in `src/routes/SessionBootstrap.tsx`.
 *
 * ## Non-serial
 * Every test uses Playwright's own `page` fixture = a fresh, anonymous browser context per test, opens
 * its own route and signs in itself when it needs a session, so one failure never skips the rest. A
 * missing precondition fails fast with its reason: `openWithBootstrap` names the bootstrap status it got,
 * `readAdminCredentials` names the missing variable.
 *
 * ## Mocks ("[mocked response]" in the title)
 * Only states the shared backend cannot produce safely are faked, ONLY the one endpoint involved, with
 * `page.route`, unrouted at the end: login 429 / ACCOUNT_DISABLED / ORIGIN_MISMATCH / 5xx / network /
 * VALIDATION / a 204 that sets no cookie (never a real session), the follow-up refresh (network loss, or held to see a transient state), the password-reset
 * request (sending / 429 / 5xx / network / origin / VALIDATION), the accept / confirm requests
 * (5xx / network / 429), the invitation page's bootstrap refresh (network loss) and, for the budget below,
 * the reset-confirm 422. "[held response]" = the real response, only delayed. The "session layer never
 * loads" case aborts the app's own lazy JS chunks, not an API. Every SCR-03 form opened with a fake token also
 * answers `POST /api/auth/invitations/preview` with a valid preview ([mocked preview], support/p01/recovery.ts):
 * since 147c9620 the form only opens after that check; the bogus-token test spends ONE real preview (422).
 * Rows on 375×812 are skipped (desktop + tablet only); prod-only rows skip on a Vite dev stack.
 * KEYBOARD: the panel is still opened with Space on the focused "Quên mật khẩu" (helper below); the click
 * (BUG-009, fixed at useAuthScreen.ts:562-569) and Enter (BUG-011, fixed at AuthScreen.tsx:88-98) paths
 * keep their own regression tests.
 *
 * ## Real-backend budget per run (BE:apps/api/auth/login_guard.py:1-17, BE:apps/api/auth/settings.py:36-46,
 * ## BE:apps/api/auth_recovery/settings.py:24-25; compose sets no override)
 * - `POST /api/auth/login`, per IP, ALL attempts (a 422 too): 30 / 60 s fixed window. THIS file: 17 =
 *   6 failures on fresh `@example.test` addresses (Enter, double, spaces, enum, notice, 375 wrong) + 11 admin
 *   successes (back 1, uppercase 1, remember 2, next 5, signing-in 1, mid-session 1) — the too-long address
 *   no longer reaches the BE (FE cap, schemas/index.ts:71) — plus the Mailpit pair's 2 API + 1 UI login = 20.
 *   With Phase 1 main (6) and the recovery spec (2): 28 ≤ 30 even inside one window. The f748afb0 additions spend
 *   NO login: the signed-in invitation warning reuses the "uppercase" test's session.
 * - per (email, IP): lock after 5 failures / 900 s. Admin FAILED attempts = 0; every failure address is
 *   run-unique and used for exactly ONE attempt.
 * - recovery routes share 10 / 900 s per IP (window opens at the FIRST hit: INCR + EXPIRE,
 *   BE:apps/api/core/ratelimit.py:48-49): THIS file 7 real = forgot unknown address, invitation bogus token,
 *   invitation bidi name (bogus token, 422 before any token lookup) + the Mailpit pair below (invitation
 *   accept 1; reset: setup accept 1 + forgot request 1 + confirm 1). With the recovery spec's 1 = 8 per UI
 *   run, so the edge step must NOT share a 15-min window with the API step (`phase01_auth_api.spec.ts`
 *   spends 11) unless the stack runs with `qa-limits.override.yml` (RECOVERY_IP_LIMIT=60, phase sum 19):
 *   else start it ≥ 15 min after the API step's first recovery call.
 * - Mailpit pair ("E01 real one-time tokens"): 2 admin API logins (`signedInApi`) + 1 UI login with the new
 *   password; 2 invitations (`POST /api/users/invitations`, 30 / h per admin, BE:apps/api/users/router.py:32-43).
 *   Their users are `qa-<runId>-…@example.test` viewers, deleted in `finally` with their mails.
 * - `POST /api/auth/refresh`: 300 / 60 s per IP (`refresh_total_limit`) — page loads only (f748afb0 block: ~16
 *   loads + 1 real refresh after the retry ladder; the ladder's 8 attempts are aborted in the browser, never sent).
 * - The f748afb0 block makes NO real recovery request (field-room / link / shortcut tests send nothing; the long
 *   Retry-After case is mocked), so the recovery count above is unchanged.
 */
import { expect, test } from '@playwright/test';
import type { APIRequestContext, Locator, Page, Request, Response, Route } from '@playwright/test';

import { ROUTES, UNKNOWN_PATH, loginUrl, pathOf } from '../../e2e/fixtures/routes';
import { EMAIL_LABEL, PASSWORD_LABEL, SIGN_IN_LABEL } from '../../e2e/fixtures/session';
import { readBaseUrl } from '../../e2e/fullstack/env';
import { apiBaseUrl, newApiContext, signedInApi } from './support/api';
import { DASHBOARD_TITLE, dashboardLoaded, readAdminCredentials, signInAdmin } from './support/auth';
import { TEST_DATA_PREFIX, TEST_EMAIL_DOMAIN, attachJson, captureEvidence, testEmail } from './support/evidence';
import { deleteMails, linkFrom, waitForMail, type Mail } from './support/mailpit';
import { PHONE_OUT_OF_SCOPE, isPhoneOutOfScope, isProdBuild, mockInvitationPreview, skipUnlessProdBuild } from './support/p01/recovery';

/** BE:apps/api/auth/cookies.py:13 */
const REFRESH_COOKIE = 'appback_refresh';
/** `src/api/endpoints.ts:86-91` under the `/api` base; refresh = `lib/auth` refreshPath. */
const LOGIN_API = '/api/auth/login';
const PASSWORD_RESET_API = '/api/auth/password-reset';
const PASSWORD_RESET_CONFIRM_API = '/api/auth/password-reset/confirm';
const INVITATION_ACCEPT_API = '/api/auth/invitations/accept';
const REFRESH_PATH = '/api/auth/refresh';
const REFRESH_API = /^\/api\/auth\/refresh$/u;

const COMPACT = { width: 375, height: 812 } as const;

/* `src/i18n/vi.json` @7735bcda (line numbers of that file). */
const HERO_HEADLINE = 'Soát bản vẽ mặt bằng trước khi sai sót kịp ra công trường.'; // :99
const REMEMBER_ME = 'Ghi nhớ máy này'; // :114
const NEW_PASSWORD_LABEL = 'Mật khẩu mới'; // :113
const FULL_NAME_LABEL = 'Họ và tên'; // :112
const CONFIRM_PASSWORD_LABEL = 'Nhập lại mật khẩu'; // :109
const ACCEPT_INVITATION = 'Nhận lời mời'; // :117
const BACK_TO_SIGN_IN = 'Quay lại đăng nhập'; // :118
const GO_TO_SIGN_IN = 'Về trang đăng nhập'; // :119
const GO_TO_PROJECTS = 'Về danh sách dự án'; // :120
const SEND_RESET_LINK = 'Gửi thư đặt lại mật khẩu'; // :121
const SET_NEW_PASSWORD = 'Đổi mật khẩu'; // :122
const SUBMITTING = 'Đang gửi…'; // :124
const OR_DIVIDER = 'Hoặc'; // :126
const SSO_SIGN_IN = 'Đăng nhập bằng SSO công ty'; // :127
const FORGOT_PASSWORD = 'Quên mật khẩu'; // :128 (also the panel title :171)
// Removed by BUG-090 (80a0ea95): no strip shows it any more; kept only for the `toHaveCount(0)` checks.
const RESET_PASSWORD_ACTION = 'Đặt lại mật khẩu';
const SHOW_PASSWORD = 'Hiện mật khẩu'; // :130
const HIDE_PASSWORD = 'Ẩn mật khẩu'; // :131
const SIGN_IN_ANOTHER_ACCOUNT = 'Đăng nhập bằng tài khoản khác'; // :132
const EMAIL_REQUIRED = 'Chưa nhập thư điện tử.'; // :137
const EMAIL_INVALID = 'Thư điện tử chưa đúng dạng. Kiểm tra lại phần trước và sau dấu a còng.'; // :138
const EMAIL_TOO_LONG = 'Thư điện tử dài quá 254 ký tự. Kiểm tra lại địa chỉ.'; // :139, {{count}} = MAX_EMAIL_LENGTH 254
const PASSWORD_REQUIRED = 'Chưa nhập mật khẩu.'; // :140
const PASSWORD_TOO_SHORT = 'Mật khẩu cần ít nhất 8 ký tự.'; // :141, {{count}} = MIN_PASSWORD_LENGTH 8
const FULL_NAME_INVALID =
  'Họ và tên có ký tự không dùng được, như ký tự điều khiển hoặc ký tự đảo chiều chữ. Gõ lại họ tên rồi thử lại.'; // :144
const INVALID_CREDENTIALS_TITLE = 'Sai thư điện tử hoặc mật khẩu'; // :148
const INVALID_CREDENTIALS_DESCRIPTION =
  'Kiểm tra lại thư điện tử và mật khẩu rồi thử lại. Thông tin bạn đã nhập vẫn được giữ.'; // :149 (BUG-091)
const TOO_MANY_TITLE = 'Đã thử quá nhiều lần'; // :152
const TOO_MANY_LOGIN = 'Hãy đợi vài phút rồi đăng nhập lại.'; // :153
const ORIGIN_MISMATCH_TITLE = 'Máy chủ từ chối yêu cầu'; // :156
const ORIGIN_MISMATCH_DESCRIPTION =
  'Địa chỉ của trang này không nằm trong danh sách máy chủ chấp nhận. Đây là lỗi cấu hình, không phải lỗi tài khoản — hãy báo quản trị hệ thống.'; // :157 (BUG-021)
const TOO_MANY_RECOVERY = 'Hãy đợi vài phút rồi thử lại.'; // :159
const RECOVERY_FAILED =
  'Máy chủ chưa xử lý được yêu cầu. Đợi giây lát rồi bấm gửi lại — những gì đã nhập vẫn còn nguyên.'; // :160 (BUG-091)
const VALIDATION_OTHER_TITLE = 'Dữ liệu chưa phù hợp'; // :162
const VALIDATION_OTHER_DESCRIPTION =
  'Máy chủ chưa nhận dữ liệu đăng nhập vừa gửi. Kiểm tra lại thư điện tử và mật khẩu rồi thử lại.'; // :163
const ACCOUNT_DISABLED_TITLE = 'Tài khoản đã bị vô hiệu'; // :166
const ACCOUNT_DISABLED_DESCRIPTION =
  'Tài khoản này không còn được phép đăng nhập. Liên hệ quản trị dự án để mở lại.'; // :167
const FORGOT_SUBTITLE = 'Nhập thư điện tử của tài khoản. Thư đặt lại mật khẩu sẽ được gửi tới đó.'; // :172
const FORGOT_SENT = 'Nếu địa chỉ này có tài khoản, thư đặt lại mật khẩu sẽ tới trong vài phút.'; // :173
const FORGOT_SENT_HINT = 'Đổi địa chỉ nếu muốn gửi tới thư khác.'; // :174
const INVITATION_DEAD_END_SUBTITLE = 'Liên kết này không mở được lời mời.'; // :179
const INVITATION_EXPIRED =
  'Lời mời đã hết hạn hoặc đã được dùng. Nhờ quản trị viên gửi lại lời mời. Nếu bạn vừa đặt mật khẩu ở lượt trước, hãy đăng nhập.'; // :180
const INVITATION_INCOMPLETE =
  'Trang này không còn mã của liên kết lời mời (trang đã được tải lại hoặc liên kết bị cắt). Hãy mở lại đúng liên kết trong thư mời, hoặc nhờ quản trị viên gửi lại lời mời.'; // :181
/** InvitationAccept.tsx:49-51 DEAD_REASON_MESSAGES.invalid — preview 422 INVITATION_TOKEN_INVALID, or a malformed token (G1-10). */
const INVITATION_INVALID =
  'Liên kết lời mời không đúng (có thể bị chép thiếu hoặc sai). Hãy mở lại đúng liên kết trong thư mời, hoặc nhờ quản trị viên gửi lại lời mời.';
const INVITATION_PREVIEW_PATH = '/api/auth/invitations/preview'; // endpoints.ts:91
const INVITATION_RETRY_FAILED = 'Đã thử lại nhưng vẫn chưa kết nối được máy chủ.'; // :184
const INVITATION_SIGNED_IN_WARNING = 'Nhận lời mời sẽ đăng xuất tài khoản đang đăng nhập.'; // auth.invitation.signedInWarning
const RESET_DEAD_END_SUBTITLE = 'Liên kết này không đặt lại được mật khẩu.'; // :190
const RESET_LINK_EXPIRED =
  'Liên kết đã hết hạn hoặc đã được dùng. Hãy yêu cầu liên kết mới ở trang đăng nhập.'; // :191
const RESET_LINK_INCOMPLETE =
  'Trang này không còn mã của liên kết đặt lại mật khẩu (trang đã được tải lại hoặc liên kết bị cắt). Hãy mở lại đúng liên kết trong thư, hoặc yêu cầu liên kết mới ở trang đăng nhập.'; // :192
const PARTIAL_NOTICE = 'Đã có thư điện tử, còn thiếu mật khẩu.'; // :196
const SESSION_ENDED_NOTICE = 'Phiên đăng nhập đã kết thúc. Hãy đăng nhập lại.'; // :198
const SIGN_IN_REQUIRED_NOTICE = 'Hãy đăng nhập để tiếp tục.'; // :199
const SIGNED_IN_NOTICE = 'Bạn đang đăng nhập. Đăng nhập ở đây sẽ thay cho phiên hiện tại.'; // :200
const SIGNED_IN_OFFLINE =
  'Mật khẩu đúng nhưng chưa kết nối được máy chủ để mở phiên. Bấm Đăng nhập để thử lại.'; // :201
const SESSION_NOT_OPENED =
  'Mật khẩu đúng nhưng chưa mở được phiên làm việc. Kiểm tra trình duyệt có cho phép cookie của trang này rồi đăng nhập lại.'; // :202
const SIGNED_IN_SUCCESS = 'Đã đăng nhập. Đang mở lại trang bạn đang xem.'; // :203
const NETWORK_DESCRIPTION = 'Không liên lạc được với máy chủ. Kiểm tra mạng rồi thử lại.'; // errors.network :15 (title :14 no longer shown)
const UNKNOWN_TITLE = 'Có trục trặc'; // errors.unknown :62
const UNKNOWN_DESCRIPTION = 'Hệ thống đã ghi nhận và sẽ kiểm tra. Hãy thử lại sau ít phút.'; // vi.json:63 (FIX-1387, BUG-209)
const CHECKING_CONNECTION = 'Đang kiểm tra kết nối.'; // connectionStates.checking :4197

/* `src/routes/SessionBootstrap.tsx` @7735bcda literals. */
const GATE_SETUP_FAILED_TITLE = 'Chưa mở được ứng dụng'; // :217 (EmptyState h1, :142)
const GATE_SETUP_FAILED_DESCRIPTION = 'Tải lại trang để thử mở lại.'; // :218
const RELOAD_PAGE = 'Tải lại trang'; // :219
const GATE_UNREACHABLE_TITLE = 'Mất kết nối máy chủ'; // :229
const GATE_UNREACHABLE_DESCRIPTION = 'Kiểm tra mạng rồi thử lại.'; // :230
const RETRY = 'Thử lại'; // :231, :103
const OPENING_SESSION = 'Đang mở phiên'; // :238 → PendingShell aria-label :174, visible "…" line :186-192
const CONNECTION_REGION = 'Trạng thái kết nối'; // :95
const MID_SESSION_LOST = 'Mất kết nối máy chủ. Kiểm tra mạng rồi bấm Thử lại.'; // :145 (BUG-093)
const HIDE_CONNECTION_STRIP = 'Ẩn thông báo kết nối'; // :111

/** BE:apps/api/auth/sessions.py:61 REMEMBER_IDLE = 7 days → cookie Max-Age (sessions.py:189). */
const REMEMBER_IDLE_S = 7 * 24 * 60 * 60;
/** Host ↔ container clock slack accepted on the persistent cookie's expiry. */
const CLOCK_SLACK_S = 60 * 60;

/** ≥ 8 chars (`src/api/schemas/index.ts:69`) so it reaches the server. Never a real password. */
const PROBE_PASSWORD = 'sai-mat-khau-e2e-edge';
/** Run-unique tag for fake tokens and project ids. */
const RUN_TAG = Date.now().toString(36);
/** A non-existent address, unique per call: each is used for exactly ONE attempt (see budget). BUG-064: rules prefix. */
const nobody = (slug: string): string => testEmail(`e01-${slug}`);
/** 64-char local part (the RFC maximum) starting with the run prefix; with the domain below the address is > 254. */
const LONG_LOCAL = `${TEST_DATA_PREFIX}e01-long-`.padEnd(64, 'a');

const authMain = (page: Page, state: string) => page.locator(`main[data-auth-state="${state}"]`);
const h1 = (page: Page, name: string) => page.getByRole('heading', { level: 1, name, exact: true });
const SIGN_IN_TITLE = 'Đăng nhập để tiếp tục dự án'; // AuthScreen.tsx SIGN_IN_TITLE (h1 of the sign-in form)
const button = (page: Page, name: string) => page.getByRole('button', { name, exact: true });
const emailBox = (page: Page) => page.getByLabel(EMAIL_LABEL, { exact: true });
// `exact`: otherwise it also matches the "Hiện mật khẩu" button.
const passwordBox = (page: Page) => page.getByLabel(PASSWORD_LABEL, { exact: true });
const rememberBox = (page: Page) => page.getByRole('checkbox', { name: REMEMBER_ME, exact: true });
/** The panel's always-mounted live region, a `div` since 7735bcda (ForgotPasswordPanel.tsx:57-65). */
const forgotStatus = (page: Page) => page.locator('form [role="status"]');
/** The recovery forms' always-mounted live line (InvitationAccept.tsx:109-114, PasswordReset.tsx:75-77). */
// RecoveryStatus (RecoveryShell.tsx) is a `div[role=status]` since BUG-097.
const recoveryStatus = (page: Page) => page.locator('form [role="status"]');
/** An InlineAlert carrying `text`; its title, when there is one, is an `h4` (InlineAlert.tsx:40-61). */
const alertWith = (page: Page, text: string) => page.getByRole('alert').filter({ hasText: text });

/* ------------------------------------------------------------------ helpers */

/** Status-only wait (Chromium never hands Playwright the body of auth 401s — see Phase 1). */
function waitForStatus(page: Page, method: string, path: RegExp, statuses: readonly number[]): Promise<Response> {
  return page.waitForResponse(
    (response) =>
      response.request().method() === method &&
      path.test(new URL(response.url()).pathname) &&
      statuses.includes(response.status()),
  );
}

/**
 * Open `url` and wait for its session bootstrap (`POST /api/auth/refresh`). A status outside `expected`
 * fails at once with the status it got (the precondition: anonymous = 401, signed in = 200).
 */
async function openWithBootstrap(page: Page, url: string, expected: readonly number[] = [401]): Promise<void> {
  const answered = page.waitForResponse(
    (response) => response.request().method() === 'POST' && REFRESH_API.test(new URL(response.url()).pathname),
  );
  await page.goto(url, { waitUntil: 'commit' });
  const status = (await answered).status();

  expect(expected, `precondition: bootstrap POST ${REFRESH_PATH} on ${url} answered ${status}`).toContain(status);
}

/** Anonymous sign-in form, painted. */
async function openAnonymousLogin(page: Page): Promise<void> {
  await openWithBootstrap(page, ROUTES.login);
  await expect(h1(page, SIGN_IN_TITLE)).toBeVisible();
}

/**
 * "Quên mật khẩu" by keyboard: focus the button, press Space (a `<button>` activates on Space keyup).
 * Not a click (BUG-009) and not Enter (AuthScreen.tsx:88-98 turns Enter into a submit) — see the two
 * dedicated tests. Focusing the button blurs the email box, which may add its problem; nothing moves
 * under a keyboard.
 */
async function openForgotByKeyboard(page: Page): Promise<void> {
  await button(page, FORGOT_PASSWORD).focus();
  await page.keyboard.press('Space');
  await expect(h1(page, FORGOT_PASSWORD)).toBeVisible();
}

const isPost = (path: string) => (request: Request): boolean =>
  request.method() === 'POST' && new URL(request.url()).pathname === path;

/** Next response to `POST path`, whatever its status (a wrong status fails with the status, not a timeout). */
function nextPost(page: Page, path: string): Promise<Response> {
  return page.waitForResponse((response) => isPost(path)(response.request()));
}

/** The two non-secret fields of a login body. The password is never read out of the request. */
interface SentLogin {
  readonly email: unknown;
  readonly rememberMe: unknown;
}

/** Run `submit` and return what the ONE login request carried and the status it got. */
async function captureLogin(page: Page, submit: () => Promise<void>): Promise<{ sent: SentLogin; status: number }> {
  const requested = page.waitForRequest(isPost(LOGIN_API));
  const answered = nextPost(page, LOGIN_API);

  await submit();
  const [request, response] = await Promise.all([requested, answered]);
  const body = request.postDataJSON() as Record<string, unknown> | null;

  return { sent: { email: body?.email, rememberMe: body?.rememberMe }, status: response.status() };
}

/** `/api/` requests sent by `page` from now on (for "no request" / "exactly one request" rows). */
function recordApiRequests(page: Page): { readonly sent: string[]; readonly stop: () => void } {
  const sent: string[] = [];
  const onRequest = (request: Request): void => {
    const { pathname } = new URL(request.url());

    if (pathname.startsWith('/api/')) sent.push(`${request.method()} ${pathname}`);
  };

  page.on('request', onRequest);
  return { sent, stop: () => page.off('request', onRequest) };
}

const posts = (sent: readonly string[], path: string): string[] => sent.filter((line) => line === `POST ${path}`);

/** Every dialog the page opens, dismissed (a script from user input must never run). */
function collectDialogs(page: Page): string[] {
  const seen: string[] = [];

  page.on('dialog', (dialog) => {
    seen.push(dialog.message());
    void dialog.dismiss();
  });
  return seen;
}

/** One painted frame: a synchronous handler has sent whatever it was going to send by then. */
async function nextFrame(page: Page): Promise<void> {
  await page.evaluate(() => new Promise<void>((resolve) => requestAnimationFrame(() => resolve())));
}

async function landsOnDashboard(page: Page, message: string): Promise<void> {
  await expect.poll(() => pathOf(page.url()), { message }).toBe(ROUTES.dashboard);
  expect(new URL(page.url()).origin, message).toBe(new URL(readBaseUrl()).origin);
  await expect(h1(page, DASHBOARD_TITLE), message).toBeVisible();
  await dashboardLoaded(page); // the shot that follows shows the list, not skeleton cards (BUG-089)
}

async function refreshCookie(page: Page) {
  return (await page.context().cookies()).find((cookie) => cookie.name === REFRESH_COOKIE);
}

/** Replace the response of `POST <path>` with `reply`; `stop()` unroutes it. */
async function mockPost(
  page: Page,
  path: string,
  reply: (route: Route) => Promise<void>,
): Promise<{ readonly seen: Request[]; readonly stop: () => Promise<void> }> {
  const seen: Request[] = [];
  const matcher = (url: URL): boolean => url.pathname === path;
  const handler = async (route: Route): Promise<void> => {
    if (route.request().method() !== 'POST') return route.fallback();
    seen.push(route.request());
    await reply(route);
  };

  await page.route(matcher, handler);
  return { seen, stop: () => page.unroute(matcher, handler) };
}

/** BE error envelope `{code, requestId, …}` (BE:apps/api/core/errors.py:82-99). */
const wire = (status: number, body: Record<string, unknown>, headers: Record<string, string> = {}) =>
  (route: Route): Promise<void> =>
    route.fulfill({
      status,
      contentType: 'application/json',
      headers,
      body: JSON.stringify({ requestId: 'req_e01', ...body }),
    });
const noContent = (route: Route): Promise<void> => route.fulfill({ status: 204 });
const networkDown = (route: Route): Promise<void> => route.abort('failed');

function deferred(): { readonly promise: Promise<void>; readonly open: () => void } {
  let open!: () => void;
  const promise = new Promise<void>((resolve) => {
    open = resolve;
  });

  return { promise, open };
}

/** Horizontal overflow of the document in px (≤ 0 = no sideways scroll). */
const horizontalOverflow = (page: Page): Promise<number> =>
  page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);

/** Layout size of an element, unaffected by CSS transforms (unlike `boundingBox()`). */
const layoutSize = (locator: Locator): Promise<{ width: number; height: number }> =>
  locator.evaluate((element) => ({
    width: (element as HTMLElement).offsetWidth,
    height: (element as HTMLElement).offsetHeight,
  }));

/** Resolves once every finite CSS/Web animation on the page has finished (infinite ones are ignored). */
async function animationsSettled(page: Page): Promise<void> {
  await page.evaluate(() =>
    Promise.all(
      document
        .getAnimations()
        .filter((animation) => animation.effect?.getComputedTiming().endTime !== Infinity)
        .map((animation) => animation.finished.then(() => undefined, () => undefined)),
    ).then(() => undefined),
  );
}

/* ------------------------------------------------------------ SCR-01 gate */

test.describe('E01 SCR-01 Session gate', () => {
  test('E01 · SCR-01 · [held response] gated non-root URL with a query: "Đang mở phiên" shell (named + visible line) while the bootstrap refresh is pending, then /login?next= keeps path AND query, with the "Hãy đăng nhập để tiếp tục." notice', async ({ page }) => {
    // status `unknown` → PendingShell role=status aria-label "Đang mở phiên", aria-busy, and since BUG-027 a
    // visible aria-hidden line "Đang mở phiên…" (SessionBootstrap.tsx:202-228, 281-285): no child mounted.
    // 401 → anonymous → <Navigate replace to=loginHref> (:288-301), loginHref = pathname + search encoded (:401).
    // f748afb0: the notice is decided by the PATHNAME, not by ?next= (:297, :403) — "/thong-bao" ≠ ROUTES.dashboard →
    // state.notice 'signInRequired' (:299) → noticeOf (AuthScreen.container.tsx:278-285) → INITIAL_NOTICES.signInRequired
    // (useAuthScreen.ts:345-349). The root with a query is "E01 · SCR-01 · anonymous /?query" below (no notice).
    const gated = `${ROUTES.notifications}?e01=gate`;
    const hold = deferred();
    const refresh = await mockPost(page, REFRESH_PATH, async (route) => {
      await hold.promise;
      await route.continue();
    });

    await page.goto(gated, { waitUntil: 'commit' });
    const shell = page.getByRole('status', { name: OPENING_SESSION, exact: true });

    await expect(shell).toBeVisible();
    await expect(shell).toHaveAttribute('aria-busy', 'true');
    await expect(shell.locator('p')).toHaveText(`${OPENING_SESSION}…`);
    await expect(h1(page, SIGN_IN_TITLE)).toHaveCount(0);
    await expect.poll(() => refresh.seen.length, { message: `POST ${REFRESH_PATH} held` }).toBe(1);
    await captureEvidence(page, 'E01_gate_opening_session.png');

    const answered = waitForStatus(page, 'POST', REFRESH_API, [401]);
    hold.open();
    await answered;
    await expect.poll(() => pathOf(page.url())).toBe(loginUrl(gated));
    expect(loginUrl(gated)).toBe('/login?next=%2Fthong-bao%3Fe01%3Dgate');
    await expect(h1(page, SIGN_IN_TITLE)).toBeVisible();
    await expect(alertWith(page, SIGN_IN_REQUIRED_NOTICE)).toBeVisible();
    await attachJson('E01_gate_redirect_query.json', { gated, landedUrl: pathOf(page.url()) });
    await captureEvidence(page, 'E01_gate_redirect_query.png', { caption: `requested ${gated} → next keeps path AND query` }); // BUG-034
    await refresh.stop();
  });

  test('E01 · SCR-01 · [mocked response] server unreachable at bootstrap → full-screen "Mất kết nối máy chủ" (h1) + "Thử lại", no redirect; retry → 401 → /login?next=%2F with no notice', async ({ page }) => {
    // Refresh fails at the network → handleTransientFailure: serverUnreachable on, status stays `unknown`
    // (lib/auth/refresh.ts:305-334) → GateScreen = EmptyState with an h1 inside `main` (SessionBootstrap.tsx:122-147,
    // 224-234; EmptyState.tsx:49-56). "Thử lại" → onRetry → retryAppSession (:344-349). Never authenticated →
    // no sessionEnded (:320-324), and next = "/" = ROUTES.dashboard → no signInRequired either (:250-254, BUG-007).
    // Auto-retries (refresh.ts:326-334) are held too, so the screen stays until the test releases ONE request.
    let mode: 'abort' | 'hold' = 'abort';
    const held: Route[] = [];
    const matcher = (url: URL): boolean => url.pathname === REFRESH_PATH;
    const handler = async (route: Route): Promise<void> => {
      if (mode === 'abort') return route.abort('failed');
      held.push(route);
    };
    await page.route(matcher, handler);

    await page.goto(ROUTES.dashboard, { waitUntil: 'commit' });
    const gate = page.getByRole('main');

    await expect(h1(page, GATE_UNREACHABLE_TITLE)).toBeVisible();
    await expect(gate.getByText(GATE_UNREACHABLE_DESCRIPTION, { exact: true })).toBeVisible();
    await expect(gate.getByRole('button', { name: RETRY, exact: true })).toBeVisible();
    await expect(page.getByRole('heading', { level: 1 }), 'the gate is the only h1').toHaveCount(1);
    await expect(h1(page, SIGN_IN_TITLE)).toHaveCount(0);
    expect(pathOf(page.url()), 'no redirect while the session is unknown').toBe(ROUTES.dashboard);
    await attachJson('E01_gate_server_unreachable.json', { urlWhileUnknown: pathOf(page.url()) }); // BUG-034
    await captureEvidence(page, 'E01_gate_server_unreachable.png');

    mode = 'hold';
    await gate.getByRole('button', { name: RETRY, exact: true }).click();
    await expect.poll(() => held.length, { message: `POST ${REFRESH_PATH} after "Thử lại"` }).toBeGreaterThan(0);
    await page.unroute(matcher, handler);
    const [first, ...rest] = held.splice(0);
    await Promise.all(rest.map((route) => route.abort('failed')));
    await first!.continue();

    await expect.poll(() => pathOf(page.url())).toBe(loginUrl(ROUTES.dashboard));
    await expect(h1(page, SIGN_IN_TITLE)).toBeVisible();
    await expect(page.getByText(SESSION_ENDED_NOTICE, { exact: true })).toHaveCount(0);
    await expect(page.getByText(SIGN_IN_REQUIRED_NOTICE, { exact: true })).toHaveCount(0);
    await attachJson('E01_gate_retry_to_login.json', { landedUrl: pathOf(page.url()) }); // BUG-034
    await captureEvidence(page, 'E01_gate_retry_to_login.png');
  });

  test('E01 · SCR-01 · [mocked response] session layer never loads (lazy JS chunks fail) → full-screen "Chưa mở được ứng dụng" (h1); "Tải lại trang" reloads and the app recovers', async ({ page }) => {
    // SessionBootstrap.tsx:328-342: `import('./sessionSetup')` rejects → setupFailed; auth never configured
    // (getOptionalAuthConfig() null, :360) → GateScreen h1 "Chưa mở được ứng dụng" + "Tải lại trang để thử mở lại."
    // + "Tải lại trang" → location.reload() (:212-221, 122-147). Faked by aborting every `/assets/*.js` NOT
    // referenced by index.html (the entry + its modulepreloads keep loading, every dynamic chunk fails).
    await skipUnlessProdBuild(page.request); // a Vite dev stack has no /assets chunks to abort
    const html = await (await page.request.get(ROUTES.dashboard)).text();
    const initial = new Set([...html.matchAll(/["'](\/assets\/[^"']+\.js)["']/gu)].map((match) => match[1]));

    expect(initial.size, 'precondition: a production build (index.html references /assets/*.js)').toBeGreaterThan(0);
    const aborted: string[] = [];
    const matcher = (url: URL): boolean =>
      url.pathname.startsWith('/assets/') && url.pathname.endsWith('.js') && !initial.has(url.pathname);
    const handler = (route: Route): Promise<void> => {
      aborted.push(new URL(route.request().url()).pathname);
      return route.abort('failed');
    };
    await page.route(matcher, handler);
    const requests = recordApiRequests(page);

    try {
      await page.goto(ROUTES.dashboard);
      const gate = page.getByRole('main');

      await expect(h1(page, GATE_SETUP_FAILED_TITLE)).toBeVisible();
      await expect(gate.getByText(GATE_SETUP_FAILED_DESCRIPTION, { exact: true })).toBeVisible();
      await expect(gate.getByRole('button', { name: RELOAD_PAGE, exact: true })).toBeVisible();
      expect(aborted.length, 'lazy chunks aborted').toBeGreaterThan(0);
      expect(posts(requests.sent, REFRESH_PATH), 'never configured → no bootstrap refresh').toEqual([]);
      await attachJson('E01_gate_setup_failed.json', { abortedChunks: aborted.length, bootstrapRefreshes: posts(requests.sent, REFRESH_PATH).length }); // BUG-034
      await captureEvidence(page, 'E01_gate_setup_failed.png');

      await page.unroute(matcher, handler);
      const reloaded = page.waitForRequest((request) => request.isNavigationRequest() && request.frame() === page.mainFrame());
      await gate.getByRole('button', { name: RELOAD_PAGE, exact: true }).click();
      await reloaded;
      await expect.poll(() => pathOf(page.url())).toBe(loginUrl(ROUTES.dashboard));
      await expect(h1(page, SIGN_IN_TITLE)).toBeVisible();
      await expect(page.getByText(SIGN_IN_REQUIRED_NOTICE, { exact: true }), 'next = / → no notice').toHaveCount(0);
      await attachJson('E01_gate_setup_reloaded.json', { landedUrl: pathOf(page.url()) }); // BUG-034
      // captureEvidence waits for the hero canvas's first frame (waitForHeroFrame, BUG-061).
      await captureEvidence(page, 'E01_gate_setup_reloaded.png', { caption: `"${RELOAD_PAGE}" → app recovered, gated / → /login?next=%2F, no notice` });
    } finally {
      requests.stop();
    }
  });

  test('E01 · SCR-01 · [mocked response] signed in, a refresh fails mid-session → "Mất kết nối máy chủ…" strip floating at the bottom edge, screen stays in place; "Thử lại" → strip gone; a second loss → the strip comes AFTER the screen in DOM/Tab order and "Ẩn thông báo kết nối" hides it without dropping focus on <body>', async ({ page }) => {
    // f748afb0: the strip is rendered after the screen (SessionBootstrap.tsx:315-321, review QA-01c #1), and "Ẩn"
    // hands focus back to where it came from, else to `main[tabindex]` or the first visible tabbable outside the
    // strip (:70-91, 116-122, 133-138), never <body>.
    // Login (real, budget: mid-session 1). Tab B's bootstrap broadcasts "signed-in" (refresh.ts:484) and
    // tab A answers with its own refresh (lib/auth/session.ts:239-241) — A's alone is aborted →
    // handleTransientFailure keeps status `authenticated` + serverUnreachable (refresh.ts:305-308) →
    // ConnectionStrip: region "Trạng thái kết nối", `fixed bottom-4` overlay, alert line, "Thử lại" and
    // "Ẩn thông báo kết nối" (SessionBootstrap.tsx:85-116, 270-275), the screen stays mounted and does not
    // move (BUG-019). Retry → bootstrapSession; the real 200 clears the flag (lib/auth/state.ts:91-97) and the
    // strip unmounts. A later loss mounts a fresh strip (dismissed = false, :86); "Ẩn" hides it (:88-90, 112).
    await signInAdmin(page);
    await expect(h1(page, DASHBOARD_TITLE)).toBeVisible();
    const titleTopBefore = (await h1(page, DASHBOARD_TITLE).boundingBox())?.y;

    let mode: 'abort' | 'hold' = 'abort';
    const held: Route[] = [];
    const matcher = (url: URL): boolean => url.pathname === REFRESH_PATH;
    const handler = async (route: Route): Promise<void> => {
      if (mode === 'abort') return route.abort('failed');
      held.push(route);
    };
    await page.route(matcher, handler);
    const tabB = await page.context().newPage();

    try {
      await openWithBootstrap(tabB, ROUTES.dashboard, [200]);
      await page.bringToFront();
      const region = page.getByRole('region', { name: CONNECTION_REGION, exact: true });

      await expect(region).toBeVisible();
      await expect(region.getByRole('alert')).toHaveText(MID_SESSION_LOST);
      await expect(region.getByRole('button', { name: HIDE_CONNECTION_STRIP, exact: true })).toBeVisible();
      await expect(h1(page, DASHBOARD_TITLE), 'the screen stays under the strip').toBeVisible();
      expect(pathOf(page.url())).toBe(ROUTES.dashboard);
      const viewport = page.viewportSize();
      const stripBox = await region.boundingBox();
      const titleTopDuring = (await h1(page, DASHBOARD_TITLE).boundingBox())?.y;
      expect(stripBox, 'strip box').not.toBeNull();
      expect(viewport, 'viewport').not.toBeNull();
      expect(await region.evaluate((element) => getComputedStyle(element).position), 'overlay, not in the flow').toBe('fixed');
      expect(stripBox!.y + stripBox!.height, 'strip sits on the bottom edge').toBeLessThanOrEqual(viewport!.height);
      expect(stripBox!.y, 'strip in the lower half').toBeGreaterThan(viewport!.height / 2);
      expect(
        Math.abs((titleTopDuring ?? Number.NaN) - (titleTopBefore ?? Number.NaN)),
        'the screen did not move under the strip (BUG-019), px',
      ).toBeLessThanOrEqual(1);
      await attachJson('E01_gate_mid_session_layout.json', {
        stripPosition: 'fixed',
        stripBottomGapPx: viewport!.height - (stripBox!.y + stripBox!.height),
        titleTopBefore,
        titleTopDuring,
      });
      await captureEvidence(page, 'E01_gate_mid_session_lost.png');

      mode = 'hold';
      await region.getByRole('button', { name: RETRY, exact: true }).click();
      await expect.poll(() => held.length, { message: `POST ${REFRESH_PATH} after "Thử lại"` }).toBeGreaterThan(0);
      await page.unroute(matcher, handler);
      const [first, ...rest] = held.splice(0);
      await Promise.all(rest.map((route) => route.abort('failed')));
      await first!.continue();

      await expect(region).toHaveCount(0);
      await expect(h1(page, DASHBOARD_TITLE)).toBeVisible();
      expect(pathOf(page.url())).toBe(ROUTES.dashboard);
      await captureEvidence(page, 'E01_gate_mid_session_back.png');

      // Second loss: a fresh strip, then "Ẩn thông báo kết nối".
      mode = 'abort';
      await page.route(matcher, handler);
      const tabC = await page.context().newPage();
      try {
        await openWithBootstrap(tabC, ROUTES.dashboard, [200]);
        await page.bringToFront();
        await expect(region).toBeVisible();
        const stripAfterScreen = await region.evaluate((strip) => {
          const title = document.querySelector('h1');
          return title !== null && (title.compareDocumentPosition(strip) & Node.DOCUMENT_POSITION_FOLLOWING) !== 0;
        });
        expect(stripAfterScreen, 'strip follows the screen in DOM (and Tab) order').toBe(true);
        await region.getByRole('button', { name: HIDE_CONNECTION_STRIP, exact: true }).click();
        await expect(region).toHaveCount(0);
        const focusAfterHide = await page.evaluate(() => ({
          onBody: document.activeElement === null || document.activeElement === document.body,
          tag: document.activeElement?.tagName ?? null,
        }));
        expect(focusAfterHide.onBody, '"Ẩn" does not drop focus on <body>').toBe(false);
        await attachJson('E01_gate_mid_session_dismiss_focus.json', { stripAfterScreen, focusAfterHide });
        await expect(h1(page, DASHBOARD_TITLE), 'the screen stays after hiding the strip').toBeVisible();
        expect(pathOf(page.url())).toBe(ROUTES.dashboard);
        await captureEvidence(page, 'E01_gate_mid_session_dismissed.png');
      } finally {
        await tabC.close();
        await page.unroute(matcher, handler);
      }
    } finally {
      await tabB.close();
    }
  });
});

/* ------------------------------------------------------- SCR-02 login form */

test.describe('E01 SCR-02 Login form', () => {
  test('E01 · empty submit → both "chưa nhập" problems, no POST /api/auth/login', async ({ page }) => {
    // useAuthScreen.ts:613-635 validates every field and returns before `gateway.signIn`;
    // schemas/index.ts:71,74 `.min(1)` first → MISSING_BY_FIELD (useAuthScreen.ts:358-361, 395).
    // Nothing typed and no failure → state `empty` (useAuthScreen.ts:733-758).
    await openAnonymousLogin(page);
    const requests = recordApiRequests(page);

    try {
      await button(page, SIGN_IN_LABEL).click();

      await expect(page.getByText(EMAIL_REQUIRED, { exact: true })).toBeVisible();
      await expect(page.getByText(PASSWORD_REQUIRED, { exact: true })).toBeVisible();
      await expect(emailBox(page)).toHaveAttribute('aria-invalid', 'true');
      await expect(authMain(page, 'empty')).toBeVisible();
      await nextFrame(page);
      expect(posts(requests.sent, LOGIN_API)).toEqual([]);
      await attachJson('E01_empty_submit.json', { loginRequests: posts(requests.sent, LOGIN_API).length }); // BUG-034
      await captureEvidence(page, 'E01_empty_submit.png');
    } finally {
      requests.stop();
    }
  });

  test('[BUG-012] E01 · keyboard: email autofocused; Tab order email → Mật khẩu → eye → Quên mật khẩu → checkbox → Đăng nhập (no SSO, no "Hoặc"); the form title is the only h1; value panel shown at 1440 and not focusable', async ({ page }) => {
    // registerFirstField focuses the email box on mount (AuthScreen.tsx:251-258, 138-139); DOM order
    // AuthScreen.tsx:134-219 (eye = PasswordField suffix PasswordField.tsx:55-73; checkbox :166-171, a single Tab
    // stop since BUG-012: plain `div` box, Checkbox.tsx:62-72). No host passes onSsoSignIn
    // (AuthScreen.container.tsx:372-379) → no `ssoSignIn` action (useAuthScreen.ts:781) → divider + SSO button not
    // rendered (AuthScreen.tsx:190-209). Hero headline is a `<p>` (ValuePanel.tsx:134, BUG-047); ValuePanel
    // `hidden lg:flex` (:108) has no focusable (rules/canvas aria-hidden).
    await openAnonymousLogin(page);
    await expect(emailBox(page)).toBeFocused();
    await expect(page.getByText(HERO_HEADLINE, { exact: true }) /* not a heading since BUG-047 */).toBeVisible();
    await expect(page.getByRole('heading', { level: 1 }), 'one h1 on /login').toHaveCount(1);
    await expect(button(page, SSO_SIGN_IN), 'no SSO flow wired → no button').toHaveCount(0);
    await expect(page.getByText(OR_DIVIDER, { exact: true }), 'no divider without SSO').toHaveCount(0);

    // Z/S-01 #5: "Quên mật khẩu" sits on the password label row, after the box (and its eye) in the DOM
    // (AuthScreen.tsx:194-218), so it is the next Tab stop after the eye, before the checkbox.
    const order = [
      ['Mật khẩu', passwordBox(page)],
      ['eye toggle', button(page, SHOW_PASSWORD)],
      ['Quên mật khẩu', button(page, FORGOT_PASSWORD)],
      ['remember me', rememberBox(page)],
      ['Đăng nhập', button(page, SIGN_IN_LABEL)],
    ] as const;

    for (const [name, target] of order) {
      await page.keyboard.press('Tab');
      await expect(target, `Tab → ${name}`).toBeFocused();
    }
    await captureEvidence(page, 'E01_login_tab_order.png');
  });

  test('E01 · keyboard: Space toggles "Ghi nhớ máy này" once; Enter on the checkbox submits (validation runs, no request)', async ({ page }) => {
    // Checkbox.tsx:32-37 Space → preventDefault + onChange(!checked) (one toggle); the form's onKeyDown handles
    // Enter from every INPUT incl. the checkbox (AuthScreen.tsx:88-98) → submit → client validation
    // (useAuthScreen.ts:613-635). Blur never flags an empty box (:562-569), so the problems prove the submit.
    await openAnonymousLogin(page);
    const requests = recordApiRequests(page);

    try {
      await rememberBox(page).focus();
      await page.keyboard.press('Space');
      await expect(rememberBox(page)).toBeChecked();
      await expect(page.getByText(PASSWORD_REQUIRED, { exact: true })).toHaveCount(0);

      await page.keyboard.press('Enter');
      await expect(passwordBox(page)).toHaveAccessibleDescription(PASSWORD_REQUIRED);
      await expect(emailBox(page)).toHaveAccessibleDescription(EMAIL_REQUIRED);
      await expect(rememberBox(page)).toBeChecked();
      await nextFrame(page);
      expect(posts(requests.sent, LOGIN_API)).toEqual([]);
      await attachJson('E01_login_checkbox_keys.json', { loginRequests: posts(requests.sent, LOGIN_API).length }); // BUG-034
      await captureEvidence(page, 'E01_login_checkbox_keys.png');
    } finally {
      requests.stop();
    }
  });

  test('E01 · password rules: blur on an EMPTY box flags nothing (BUG-009); 7 chars + blur → "cần ít nhất 8 ký tự"; typing clears it; Enter on the empty box → "Chưa nhập mật khẩu."; no request', async ({ page }) => {
    // blurField returns early for an empty value (useAuthScreen.ts:562-569), else firstProblem (:571-586);
    // editField drops that field's problem (:530-542); PasswordSchema min(1).min(8) (schemas/index.ts:74) →
    // sentenceFor too_small 8 (useAuthScreen.ts:389-393); the submit flags the empty box (:613-635, 358-361).
    await openAnonymousLogin(page);
    const requests = recordApiRequests(page);

    try {
      await emailBox(page).fill(nobody('rules'));
      await passwordBox(page).focus();
      await page.keyboard.press('Tab');
      await expect(passwordBox(page), 'empty box, blurred: no complaint').not.toHaveAttribute('aria-invalid', 'true');
      await expect(page.getByText(PASSWORD_REQUIRED, { exact: true })).toHaveCount(0);
      await expect(emailBox(page)).not.toHaveAttribute('aria-invalid', 'true');

      await passwordBox(page).fill('1234567');
      await passwordBox(page).blur();
      await expect(passwordBox(page)).toHaveAccessibleDescription(PASSWORD_TOO_SHORT);
      await expect(page.getByText(PASSWORD_TOO_SHORT, { exact: true })).toBeVisible();
      // BUG-092: the 8-character rule gets its own shot (the last shot below is the EMPTY-box state).
      await captureEvidence(page, 'E01_login_password_too_short.png', { caption: '"Mật khẩu" holds 7 characters, blurred → min-8 rule; no request' });

      await passwordBox(page).fill('12345678');
      await expect(passwordBox(page), 'typing clears the problem').not.toHaveAttribute('aria-invalid', 'true');

      await passwordBox(page).fill('');
      await passwordBox(page).press('Enter');
      await expect(passwordBox(page)).toHaveAccessibleDescription(PASSWORD_REQUIRED);
      await nextFrame(page);
      expect(posts(requests.sent, LOGIN_API)).toEqual([]);
      await attachJson('E01_login_password_rules.json', { loginRequests: posts(requests.sent, LOGIN_API).length }); // BUG-034
      await captureEvidence(page, 'E01_login_password_rules.png');
    } finally {
      requests.stop();
    }
  });

  test('E01 · Enter in "Mật khẩu" submits exactly once; focus is back in "Mật khẩu" after the answer; then Enter on the focused "Đặt lại mật khẩu" opens the panel (no second login)', async ({ page }) => {
    // f748afb0: the fields are disabled while sending (AuthScreen.tsx:72, 137, 150), which can drop focus on <body>;
    // useReturnFocus puts it back on the last focused field once the attempt ends (useReturnFocus.ts:16-46,
    // AuthScreen.tsx:73, 119-125) — either way the keyboard user is still in "Mật khẩu".
    // AuthScreen.tsx:88-98: the form's onKeyDown handles Enter from an INPUT and preventDefaults the native
    // implicit submission (one `submit()`); non-existent address → 401 (BE:router.py:175-177). Since BUG-011 an
    // Enter on a button is left to the button: the reset button under the strip (AuthScreen.tsx:116-120) →
    // openForgot (:260-263) with the typed address (useAuthScreen.ts:594-597).
    await openAnonymousLogin(page);
    const requests = recordApiRequests(page);

    try {
      const address = nobody('enter');

      await emailBox(page).fill(address);
      await passwordBox(page).fill(PROBE_PASSWORD);
      const { status } = await captureLogin(page, () => passwordBox(page).press('Enter'));

      expect(status, `POST ${LOGIN_API}`).toBe(401);
      await expect(page.getByText(INVALID_CREDENTIALS_TITLE, { exact: true })).toBeVisible();
      await expect(passwordBox(page), 'focus returned to "Mật khẩu" after the attempt').toBeFocused();
      await nextFrame(page);
      expect(posts(requests.sent, LOGIN_API)).toHaveLength(1);
      await captureEvidence(page, 'E01_enter_submits.png', {
        caption: `Enter in "Mật khẩu" → POST ${LOGIN_API} × ${posts(requests.sent, LOGIN_API).length} (${status}); focus back in "Mật khẩu"`,
      }); // BUG-034

      // BUG-090: the strip has no reset button; "Quên mật khẩu" (type="button") is the one route.
      await button(page, FORGOT_PASSWORD).focus();
      await page.keyboard.press('Enter');
      await expect(h1(page, FORGOT_PASSWORD)).toBeVisible();
      await expect(emailBox(page)).toHaveValue(address);
      await nextFrame(page);
      expect(posts(requests.sent, LOGIN_API), 'Enter on "Quên mật khẩu" is not a sign-in').toHaveLength(1);
      await attachJson('E01_enter_submits.json', {
        status,
        loginRequestsAfterEnterInPassword: 1,
        focusAfterAttempt: 'Mật khẩu',
        loginRequestsAfterEnterOnResetButton: posts(requests.sent, LOGIN_API).length,
      });
      await captureEvidence(page, 'E01_enter_reset_action.png');
    } finally {
      requests.stop();
    }
  });

  test('E01 · two clicks on "Đăng nhập" in the same tick → ONE login request', async ({ page }) => {
    // useAuthScreen.ts:480-487 + :614, 640: the `inFlight` ref is written synchronously, so a second submit in
    // the same tick returns early; AuthScreen.tsx:175 also disables the button while submitting.
    await openAnonymousLogin(page);
    const requests = recordApiRequests(page);

    try {
      await emailBox(page).fill(nobody('double'));
      await passwordBox(page).fill(PROBE_PASSWORD);
      const { status } = await captureLogin(page, () =>
        button(page, SIGN_IN_LABEL).evaluate((element) => {
          (element as HTMLButtonElement).click();
          (element as HTMLButtonElement).click();
        }),
      );

      expect(status, `POST ${LOGIN_API}`).toBe(401);
      await expect(page.getByText(INVALID_CREDENTIALS_TITLE, { exact: true })).toBeVisible();
      await nextFrame(page);
      expect(posts(requests.sent, LOGIN_API), 'login requests after a double submit').toHaveLength(1);
      await attachJson('E01_double_submit.json', { status, loginRequests: posts(requests.sent, LOGIN_API).length });
      await captureEvidence(page, 'E01_double_submit.png', {
        caption: `two clicks on "Đăng nhập" in one tick → POST ${LOGIN_API} × ${posts(requests.sent, LOGIN_API).length} (${status})`,
      }); // BUG-034
    } finally {
      requests.stop();
    }
  });

  test('E01 · email with surrounding spaces + uppercase → sent trimmed, case kept', async ({ page }) => {
    // AuthScreen.tsx:140 `type="email"`: the HTML value sanitization of email inputs strips leading and
    // trailing whitespace before React reads `event.target.value` (AuthScreen.tsx:146-148). The zod
    // regex (schemas/index.ts:71) admits no whitespace anyway, so a padded address can never be posted.
    // FE sends `current.email` verbatim, no lower-casing (useAuthScreen.ts:643-648).
    const address = nobody('spaces').toUpperCase();

    await openAnonymousLogin(page);
    await emailBox(page).fill(`  ${address}  `);
    await passwordBox(page).fill(PROBE_PASSWORD);
    const { sent, status } = await captureLogin(page, () => button(page, SIGN_IN_LABEL).click());

    expect(sent.email, 'email on the wire').toBe(address);
    expect(status, `POST ${LOGIN_API}`).toBe(401);
    await expect(page.getByText(INVALID_CREDENTIALS_TITLE, { exact: true })).toBeVisible();
    await attachJson('E01_email_spaces_case.json', { typed: `  ${address}  `, sentEmail: sent.email, status });
    await captureEvidence(page, 'E01_email_spaces_case.png', {
      caption: [`typed: "  ${address}  "`, `sent:  "${String(sent.email)}" → ${status}`],
    }); // BUG-034
  });

  test('E01 · unknown address → the SAME 401 and copy as a known address with a wrong password (no enumeration); the strip sits UNDER the password box, above "Đăng nhập", with no button of its own, fields do not move; "Quên mật khẩu" stays the way out (BUG-090)', async ({ page }) => {
    // BUG-090 (80a0ea95): a wrong password no longer gets a "Đặt lại mật khẩu" button under the strip;
    // the form's "Quên mật khẩu" text button is the one way to recover (AuthScreen.tsx stripAction comment).
    // BE:router.py:6-8,173-177: unknown email, `pending` user and wrong password share one path and
    // raise the same INVALID_CREDENTIALS (401, BE:packages/core/error_codes.py:19). The known-address
    // half is Phase 1 ("ONE wrong password", same title, no reset action) — not repeated here so the admin
    // address spends no failed attempt. FE: useAuthScreen.ts:265-266, 294-300; typed values are kept.
    // An attempt result (state error/success) renders the strip AFTER the submit button (AuthScreen.tsx:129-131,
    // 180, BUG-008); the form is anchored from the top, so the email box keeps its place.
    // The 401 body (code) is unreadable in Chromium, so the code itself is asserted from source only.
    const address = nobody('enum');

    await openAnonymousLogin(page);
    await emailBox(page).fill(address);
    await passwordBox(page).fill(PROBE_PASSWORD);
    const emailTopBefore = (await emailBox(page).boundingBox())?.y;
    const { status } = await captureLogin(page, () => button(page, SIGN_IN_LABEL).click());

    expect(status, `POST ${LOGIN_API} for an address with no account`).toBe(401);
    const strip = alertWith(page, INVALID_CREDENTIALS_TITLE);
    await expect(strip).toBeVisible();
    await expect(page.getByText(INVALID_CREDENTIALS_DESCRIPTION, { exact: true })).toBeVisible();
    await expect(button(page, RESET_PASSWORD_ACTION), 'no reset button under the strip (BUG-090)').toHaveCount(0);
    await expect(strip.getByRole('button'), 'no action inside the strip').toHaveCount(0);
    await expect(button(page, FORGOT_PASSWORD)).toBeVisible();
    await expect(authMain(page, 'error')).toBeVisible();
    await expect(emailBox(page)).toHaveValue(address);
    await expect(passwordBox(page)).toHaveValue(PROBE_PASSWORD);

    // Z/S-01 #6: a wrong-credentials strip reads right under the password box, next to what it is about
    // (AuthScreen.tsx:219-228); "Quên mật khẩu" is on the password label row (Z/S-01 #5), above both.
    const submitBox = await button(page, SIGN_IN_LABEL).boundingBox();
    const stripBox = await strip.boundingBox();
    const forgotBox = await button(page, FORGOT_PASSWORD).boundingBox();
    const passwordBoxBox = await passwordBox(page).boundingBox();
    const emailTopAfter = (await emailBox(page).boundingBox())?.y;
    expect(submitBox && stripBox && forgotBox && passwordBoxBox, 'boxes').toBeTruthy();
    expect(stripBox!.y, 'strip below the password box').toBeGreaterThanOrEqual(passwordBoxBox!.y + passwordBoxBox!.height);
    expect(stripBox!.y + stripBox!.height, 'strip above the submit button').toBeLessThanOrEqual(submitBox!.y);
    expect(forgotBox!.y + forgotBox!.height, '"Quên mật khẩu" above the strip').toBeLessThanOrEqual(stripBox!.y);
    expect(
      Math.abs((emailTopAfter ?? Number.NaN) - (emailTopBefore ?? Number.NaN)),
      'email box did not move (BUG-008), px',
    ).toBeLessThanOrEqual(1);
    await attachJson('E01_no_enumeration_layout.json', {
      status,
      submitBottom: submitBox!.y + submitBox!.height,
      stripTop: stripBox!.y,
      forgotTop: forgotBox!.y,
      submitSize: { width: submitBox!.width, height: submitBox!.height },
      emailTopBefore,
      emailTopAfter,
    });
    await captureEvidence(page, 'E01_no_enumeration.png');
  });

  test('E01 · <script>-like email → format problem, value shown as text, no request, no dialog', async ({ page }) => {
    // zod `.email()` rejects `<`, `>`, `(`, `)`, `/` (schemas/index.ts:71) → `invalid_string` → emailInvalid
    // (useAuthScreen.ts:381-383); submit returns before the gateway (useAuthScreen.ts:631-635).
    const hostile = `${TEST_DATA_PREFIX}<script>alert(1)</script>@${TEST_EMAIL_DOMAIN}`;
    const dialogs = collectDialogs(page);

    await openAnonymousLogin(page);
    const requests = recordApiRequests(page);

    try {
      await emailBox(page).fill(hostile);
      await passwordBox(page).fill(PROBE_PASSWORD);
      await button(page, SIGN_IN_LABEL).click();

      await expect(page.getByText(EMAIL_INVALID, { exact: true })).toBeVisible();
      await expect(emailBox(page)).toHaveValue(hostile);
      await nextFrame(page);
      expect(posts(requests.sent, LOGIN_API)).toEqual([]);
      expect(dialogs).toEqual([]);
      await attachJson('E01_email_script.json', { loginRequests: posts(requests.sent, LOGIN_API).length, dialogs: dialogs.length }); // BUG-034
      await captureEvidence(page, 'E01_email_script.png');
    } finally {
      requests.stop();
    }
  });

  test('E01 · email longer than 254 chars → "Thư điện tử dài quá 254 ký tự…" on blur and on submit, NO request (FE cap = BE cap)', async ({ page }) => {
    // FE since BUG-010: EmailSchema = min(1).email().max(MAX_EMAIL_LENGTH 254) (schemas/index.ts:62-71,
    // schemas/auth.ts:13-20) → `too_big` → emailTooLong (useAuthScreen.ts:385-387); blur flags a non-empty box
    // (:562-586); submit returns before the gateway (:631-635). Same cap as BE validate_wire_email
    // (BE:apps/api/auth/emails.py:20,37-39), so no 422 round trip (was the old behaviour on c4978eb4).
    const longAddress = `${LONG_LOCAL}@${'b'.repeat(60)}.${'c'.repeat(60)}.${'d'.repeat(60)}.${TEST_EMAIL_DOMAIN}`;

    expect(longAddress.length, 'probe length').toBeGreaterThan(254);
    await openAnonymousLogin(page);
    const requests = recordApiRequests(page);

    try {
      await emailBox(page).fill(longAddress);
      await emailBox(page).blur();
      await expect(emailBox(page)).toHaveAccessibleDescription(EMAIL_TOO_LONG);

      await passwordBox(page).fill(PROBE_PASSWORD);
      await button(page, SIGN_IN_LABEL).click();
      await expect(emailBox(page)).toHaveAccessibleDescription(EMAIL_TOO_LONG);
      await expect(page.getByText(EMAIL_INVALID, { exact: true })).toHaveCount(0);
      await expect(page.getByText(INVALID_CREDENTIALS_TITLE, { exact: true })).toHaveCount(0);
      await nextFrame(page);
      expect(posts(requests.sent, LOGIN_API), 'no login request for a too-long address').toEqual([]);
      await attachJson('E01_email_too_long.json', { addressLength: longAddress.length, loginRequests: 0 });
      await captureEvidence(page, 'E01_email_too_long.png');
    } finally {
      requests.stop();
    }
  });

  test('E01 · [history state] opening notice: unknown `notice` ignored; "sessionEnded" strip UNDER "Đăng nhập" (not above the fields since f748afb0), read once, survives an empty submit, replaced by the first real attempt', async ({ page }) => {
    // noticeOf accepts only passwordReset | sessionEnded | signInRequired (AuthScreen.container.tsx:278-285) →
    // INITIAL_NOTICES.sessionEnded (useAuthScreen.ts:345-349, 719); the entry is dropped from history once
    // read (container :358-370). f748afb0: EVERY strip, the opening ones too, renders after the submit button
    // (AuthScreen.tsx:174-190, BUG-008), so neither the email box nor the button moves when it comes or goes.
    // A submit that fails validation returns BEFORE setOpeningNotice(undefined)
    // (useAuthScreen.ts:631-639); a sent attempt clears it and its failure takes the strip (:637-639, 705-707).
    // The entry is written the way react-router's navigate(…, {state}) writes it (`history.state.usr`) —
    // what SessionBootstrap.tsx:250-251 does on a real session end (that path: main "refresh cookie gone").
    async function reloadWithNotice(notice: string): Promise<void> {
      await page.evaluate((value) => {
        history.replaceState({ ...(history.state as Record<string, unknown> | null), usr: { notice: value } }, '');
      }, notice);
      const answered = waitForStatus(page, 'POST', REFRESH_API, [401]);
      await page.reload({ waitUntil: 'commit' });
      await answered;
      await expect(h1(page, SIGN_IN_TITLE)).toBeVisible();
    }

    await openAnonymousLogin(page);
    await reloadWithNotice('e01-unknown');
    await expect(page.getByRole('alert')).toHaveCount(0);

    await reloadWithNotice('sessionEnded');
    await expect(alertWith(page, SESSION_ENDED_NOTICE)).toBeVisible();
    const noticeBox = await alertWith(page, SESSION_ENDED_NOTICE).boundingBox();
    const submitBox = await button(page, SIGN_IN_LABEL).boundingBox();
    expect(noticeBox && submitBox, 'notice and submit boxes').toBeTruthy();
    expect(noticeBox!.y, 'opening notice sits under "Đăng nhập"').toBeGreaterThanOrEqual(submitBox!.y + submitBox!.height);
    await expect
      .poll(() => page.evaluate(() => (history.state as { usr?: { notice?: unknown } | null } | null)?.usr?.notice))
      .toBeUndefined();
    await attachJson('E01_notice_session_ended.json', { // BUG-034: history state is not in the shot
      historyNoticeAfterRead: await page.evaluate(() => (history.state as { usr?: { notice?: unknown } | null } | null)?.usr?.notice ?? null),
    });
    await captureEvidence(page, 'E01_notice_session_ended.png', { caption: 'history.state.usr.notice = "sessionEnded" → strip shown, entry dropped once read' }); // BUG-034

    await emailBox(page).press('Enter');
    await expect(emailBox(page)).toHaveAccessibleDescription(EMAIL_REQUIRED);
    await expect(page.getByText(SESSION_ENDED_NOTICE, { exact: true })).toBeVisible();
    await captureEvidence(page, 'E01_notice_after_empty_submit.png', { caption: 'after an EMPTY submit (Enter): notice still shown, no request' }); // BUG-034: the "survives a submit" half

    await emailBox(page).fill(nobody('notice'));
    await passwordBox(page).fill(PROBE_PASSWORD);
    const { status } = await captureLogin(page, () => passwordBox(page).press('Enter'));

    expect(status, `POST ${LOGIN_API}`).toBe(401);
    await expect(page.getByText(INVALID_CREDENTIALS_TITLE, { exact: true })).toBeVisible();
    await expect(page.getByText(SESSION_ENDED_NOTICE, { exact: true })).toHaveCount(0);
    await attachJson('E01_notice_replaced.json', { loginStatus: status }); // BUG-034
    await captureEvidence(page, 'E01_notice_replaced.png');
  });
});

/* ------------------------------------------- SCR-02 login failure kinds */

test.describe('E01 SCR-02 Login failures', () => {
  test('E01 · [mocked response] 500 → "Có trục trặc" strip, no reset action, POST not retried, typed values kept', async ({ page }) => {
    // classifyFailure default → transport (useAuthScreen.ts:278-279) → noticeFor default: describeError(toAppError)
    // → 500 is not a known status → `unknown` (lib/errors/toAppError.ts:10-18,164-196) → title + description,
    // violation (useAuthScreen.ts:331-340). POST is not retryable (lib/http/retry.ts:25-26). showResetAction
    // only for invalidCredentials (useAuthScreen.ts:294-300).
    const login = await mockPost(page, LOGIN_API, wire(500, { code: 'INTERNAL' }));

    await openAnonymousLogin(page);
    await emailBox(page).fill(nobody('m500'));
    await passwordBox(page).fill(PROBE_PASSWORD);
    await button(page, SIGN_IN_LABEL).click();

    await expect(page.getByText(UNKNOWN_TITLE, { exact: true })).toBeVisible();
    await expect(page.getByText(UNKNOWN_DESCRIPTION, { exact: true })).toBeVisible();
    await expect(authMain(page, 'error')).toBeVisible();
    await expect(button(page, RESET_PASSWORD_ACTION)).toHaveCount(0);
    await expect(button(page, SIGN_IN_LABEL)).toBeEnabled();
    await expect(passwordBox(page)).toHaveValue(PROBE_PASSWORD);
    await nextFrame(page);
    expect(login.seen, `POST ${LOGIN_API}`).toHaveLength(1);
    await attachJson('E01_login_server_500.json', { loginRequests: login.seen.length }); // BUG-034: not retried
    await captureEvidence(page, 'E01_login_server_500.png');
    await login.stop();
  });

  test('E01 · [mocked response] network failure → "Mất kết nối máy chủ…" strip with no separate title; not locked, a second attempt goes out', async ({ page }) => {
    // fetch rejects → HttpError kind 'network' (lib/http/client.ts catch, retry.ts:17-23: POST not retried)
    // → transport → noticeFor: network → attention, description only, no title (useAuthScreen.ts:331-340,
    // BUG-021/BUG-020). canSubmit stays true (useAuthScreen.ts:769).
    const login = await mockPost(page, LOGIN_API, networkDown);

    await openAnonymousLogin(page);
    await emailBox(page).fill(nobody('mnet'));
    await passwordBox(page).fill(PROBE_PASSWORD);
    await button(page, SIGN_IN_LABEL).click();

    const strip = alertWith(page, NETWORK_DESCRIPTION);
    await expect(strip).toBeVisible();
    await expect(strip.getByRole('heading'), 'network strip has no title line').toHaveCount(0);
    await expect(authMain(page, 'error')).toBeVisible();
    await expect(button(page, SIGN_IN_LABEL)).toBeEnabled();
    await captureEvidence(page, 'E01_login_network.png');

    await button(page, SIGN_IN_LABEL).click();
    await expect.poll(() => login.seen.length, { message: `POST ${LOGIN_API} resubmitted` }).toBe(2);
    await attachJson('E01_login_network.json', { loginRequests: login.seen.length }); // BUG-034: second attempt went out
    await expect(strip).toBeVisible();
    await login.stop();
  });

  test('E01 · [mocked response] 429 → "Đã thử quá nhiều lần" strip, submit locked 60 s whatever Retry-After says, then strip gone and submit back', async ({ page }) => {
    // 429 → tooManyAttempts (useAuthScreen.ts:260-262) → lock(LOCKOUT_SECONDS = 60, :685-687,
    // recoveryShared.ts:22) — Retry-After ignored; canSubmit false (:769) and submit() guarded (:614).
    // useLockout counts down 1/s (useLockout.ts:15-27); at 0 the strip goes (useAuthScreen.ts:521-525).
    // page.clock fast-forwards the countdown.
    await page.clock.install();
    const login = await mockPost(page, LOGIN_API, wire(429, { code: 'RATE_LIMITED' }, { 'Retry-After': '5' }));

    await openAnonymousLogin(page);
    await emailBox(page).fill(nobody('m429'));
    await passwordBox(page).fill(PROBE_PASSWORD);
    await button(page, SIGN_IN_LABEL).click();

    await expect(page.getByText(TOO_MANY_TITLE, { exact: true })).toBeVisible();
    await expect(page.getByText(TOO_MANY_LOGIN, { exact: true })).toBeVisible();
    await expect(authMain(page, 'error')).toBeVisible();
    await expect(button(page, SIGN_IN_LABEL)).toBeDisabled();
    await captureEvidence(page, 'E01_login_429_locked.png');

    await page.clock.runFor(50_000);
    await expect(button(page, SIGN_IN_LABEL), 'still locked 50 s later (Retry-After was 5)').toBeDisabled();
    await passwordBox(page).press('Enter');
    expect(login.seen, `POST ${LOGIN_API} while locked`).toHaveLength(1);

    await page.clock.runFor(12_000);
    await expect(button(page, SIGN_IN_LABEL)).toBeEnabled();
    await expect(page.getByText(TOO_MANY_TITLE, { exact: true })).toHaveCount(0);
    expect(login.seen).toHaveLength(1);
    await attachJson('E01_login_429.json', { loginRequests: login.seen.length }); // BUG-034: nothing sent while locked
    await captureEvidence(page, 'E01_login_429_unlocked.png');
    await login.stop();
  });

  test('E01 · [mocked response] 403 ACCOUNT_DISABLED → the form is gone, the "Tài khoản đã bị vô hiệu" alert + "Đăng nhập bằng tài khoản khác" (state forbidden) which TAKES the dropped focus; Enter on it brings back an EMPTY form, focus in "Thư điện tử"', async ({ page }) => {
    // f748afb0 (b3f76fef): the form that held focus is replaced, so focus would fall on <body>; catchDroppedFocus
    // focuses the way out only when focus was dropped (AuthScreen.tsx:285-291, 359).
    // BE:packages/core/error_codes.py:21 (403), raised only after a correct password (BE:router.py:178-179).
    // accountDisabled → isBlocked (useAuthScreen.ts:267-268, 611) → state forbidden (:740-742); the view
    // renders the alert + the way out, no form, no forgot link (AuthScreen.tsx:333-343, BUG-017).
    // reopenForm → wantsFocus + signInWithAnotherAccount: failure, address, password and problems cleared
    // (AuthScreen.tsx:275-278, useAuthScreen.ts:603-607) → CredentialForm remounts, its email box focused
    // (AuthScreen.tsx:253-258). Nothing is sent by that button.
    const login = await mockPost(page, LOGIN_API, wire(403, { code: 'ACCOUNT_DISABLED' }));

    await openAnonymousLogin(page);
    await emailBox(page).fill(nobody('mdisabled'));
    await passwordBox(page).fill(PROBE_PASSWORD);
    await page.getByText(REMEMBER_ME, { exact: true }).click();
    await button(page, SIGN_IN_LABEL).click();

    await expect(authMain(page, 'forbidden')).toBeVisible();
    await expect(page.getByText(ACCOUNT_DISABLED_TITLE, { exact: true })).toBeVisible();
    await expect(page.getByText(ACCOUNT_DISABLED_DESCRIPTION, { exact: true })).toBeVisible();
    await expect(button(page, SIGN_IN_ANOTHER_ACCOUNT)).toBeVisible();
    await expect(emailBox(page)).toHaveCount(0);
    await expect(button(page, SIGN_IN_LABEL)).toHaveCount(0);
    await expect(button(page, FORGOT_PASSWORD)).toHaveCount(0);
    await expect(h1(page, SIGN_IN_TITLE)).toBeVisible();
    expect(login.seen).toHaveLength(1);
    await expect(button(page, SIGN_IN_ANOTHER_ACCOUNT), 'dropped focus caught by the way out').toBeFocused();
    await captureEvidence(page, 'E01_login_account_disabled.png');

    await page.keyboard.press('Enter');
    await expect(emailBox(page)).toBeFocused();
    await expect(emailBox(page)).toHaveValue('');
    await expect(passwordBox(page)).toHaveValue('');
    await expect(rememberBox(page), 'remember me is not part of the reset (useAuthScreen.ts:605)').toBeChecked();
    await expect(page.getByText(ACCOUNT_DISABLED_TITLE, { exact: true })).toHaveCount(0);
    await expect(authMain(page, 'empty')).toBeVisible();
    await expect(button(page, SIGN_IN_LABEL)).toBeEnabled();
    await nextFrame(page);
    expect(login.seen, 'the way out sends nothing').toHaveLength(1);
    await attachJson('E01_login_another_account.json', { loginRequests: login.seen.length }); // BUG-034
    await captureEvidence(page, 'E01_login_another_account.png');
    await login.stop();
  });

  test('E01 · [mocked response] 403 ORIGIN_MISMATCH → "Máy chủ từ chối yêu cầu" strip, form stays, no reset action', async ({ page }) => {
    // A bare 403 is not "disabled": ORIGIN_MISMATCH → originMismatch (useAuthScreen.ts:269-270, 307-312).
    const login = await mockPost(page, LOGIN_API, wire(403, { code: 'ORIGIN_MISMATCH' }));

    await openAnonymousLogin(page);
    await emailBox(page).fill(nobody('morigin'));
    await passwordBox(page).fill(PROBE_PASSWORD);
    await button(page, SIGN_IN_LABEL).click();

    await expect(page.getByText(ORIGIN_MISMATCH_TITLE, { exact: true })).toBeVisible();
    await expect(page.getByText(ORIGIN_MISMATCH_DESCRIPTION, { exact: true })).toBeVisible();
    await expect(authMain(page, 'error')).toBeVisible();
    await expect(emailBox(page)).toBeVisible();
    await expect(button(page, SIGN_IN_LABEL)).toBeEnabled();
    await expect(button(page, RESET_PASSWORD_ACTION)).toHaveCount(0);
    await captureEvidence(page, 'E01_login_origin_mismatch.png');
    await login.stop();
  });

  test('E01 · [mocked response] 422 VALIDATION field "password" → "cần ít nhất 8 ký tự" under the box, no strip; unknown field → "Dữ liệu chưa phù hợp" strip with the sign-in wording', async ({ page }) => {
    // field email|password → { validation, field } (useAuthScreen.ts:271-274) → no strip (:329-330) +
    // passwordTooShort under the box (:675-683); state error (:749-751). Any other field → validationOther
    // (:276-277, BUG-018) → auth.errors.validationOther title + description (:323-328), not the generic
    // "các trường được đánh dấu" of errors.validation.
    const fields = ['password', 'fullName'];
    let call = 0;
    const login = await mockPost(page, LOGIN_API, (route) =>
      wire(422, { code: 'VALIDATION', field: fields[call++] ?? 'fullName', count: 1 })(route),
    );

    await openAnonymousLogin(page);
    await emailBox(page).fill(nobody('m422'));
    // BUG-094 is fixed: the FE now counts code points (schemas/index.ts:78-82), so BE_SHORT_PASSWORD never leaves
    // the page. Any FE-valid password reaches this mocked 422; the mapping under the box is what is checked.
    await passwordBox(page).fill(PROBE_PASSWORD);
    await button(page, SIGN_IN_LABEL).click();

    await expect(passwordBox(page)).toHaveAccessibleDescription(PASSWORD_TOO_SHORT);
    await expect(page.getByText(VALIDATION_OTHER_TITLE, { exact: true })).toHaveCount(0);
    await expect(page.getByText(INVALID_CREDENTIALS_TITLE, { exact: true })).toHaveCount(0);
    await expect(authMain(page, 'error')).toBeVisible();
    await captureEvidence(page, 'E01_login_validation_password.png', {
      caption: `[mocked response] 422 VALIDATION field "password" (FE-valid box value) — real pair A01_login_422_password`,
    });

    await button(page, SIGN_IN_LABEL).click();
    await expect(page.getByText(VALIDATION_OTHER_TITLE, { exact: true })).toBeVisible();
    await expect(page.getByText(VALIDATION_OTHER_DESCRIPTION, { exact: true })).toBeVisible();
    await expect(page.getByText(PASSWORD_TOO_SHORT, { exact: true })).toHaveCount(0);
    expect(login.seen).toHaveLength(2);
    await attachJson('E01_login_validation.json', { loginRequests: login.seen.length }); // BUG-034
    await captureEvidence(page, 'E01_login_validation_other.png');
    await login.stop();
  });

  test('E01 · [mocked response] login 204 but the follow-up refresh cannot reach the server → "Mật khẩu đúng nhưng chưa kết nối được máy chủ… Bấm Đăng nhập để thử lại.", submit stays ENABLED and a second press sends a second login (BUG-013)', async ({ page }) => {
    // withSession: 204 → bootstrapAfterNewCookie() false with serverUnreachable → SignedInOfflineError
    // (AuthScreen.container.tsx:166-188) → signedInOffline notice, attention, no title (useAuthScreen.ts:250-252,
    // 319-320). Since BUG-013 nothing locks the button (canSubmit :769, submit guard :614): from an anonymous
    // /login the session layer schedules no retry (refresh.ts:321-326), so the person retries by pressing it.
    // Both 204s are mocked (no session is created); the refresh is aborted AFTER the page's own bootstrap.
    const login = await mockPost(page, LOGIN_API, noContent);

    await openAnonymousLogin(page);
    const refresh = await mockPost(page, REFRESH_PATH, networkDown);
    await emailBox(page).fill(nobody('moffline'));
    await passwordBox(page).fill(PROBE_PASSWORD);
    await button(page, SIGN_IN_LABEL).click();

    const strip = alertWith(page, SIGNED_IN_OFFLINE);
    await expect(strip).toBeVisible();
    await expect(strip.getByRole('heading')).toHaveCount(0);
    await expect(authMain(page, 'error')).toBeVisible();
    await expect(button(page, SIGN_IN_LABEL)).toBeEnabled();
    expect(login.seen).toHaveLength(1);
    expect(refresh.seen.length, `POST ${REFRESH_PATH} after the 204`).toBeGreaterThan(0);
    expect(pathOf(page.url())).toBe(ROUTES.login);
    await captureEvidence(page, 'E01_login_signed_in_offline.png', {
      caption: `[mocked response] press 1: POST ${LOGIN_API} × ${login.seen.length} (204), POST ${REFRESH_PATH} × ${refresh.seen.length} (network failed)`,
    });

    const refreshesBefore = refresh.seen.length;
    await button(page, SIGN_IN_LABEL).click();
    await expect.poll(() => login.seen.length, { message: `POST ${LOGIN_API} on the second press` }).toBe(2);
    await expect.poll(() => refresh.seen.length, { message: `POST ${REFRESH_PATH} after the second 204` }).toBeGreaterThan(refreshesBefore);
    await expect(strip).toBeVisible();
    await expect(button(page, SIGN_IN_LABEL)).toBeEnabled();
    expect(pathOf(page.url())).toBe(ROUTES.login);
    await attachJson('E01_login_signed_in_offline.json', {
      loginRequests: login.seen.length,
      refreshRequests: refresh.seen.length,
      landed: pathOf(page.url()),
    });
    // BUG-095: same screen by design (BUG-013: the strip stays, the button stays enabled) — the counts on the shot
    // are what shows the second attempt really went out.
    await captureEvidence(page, 'E01_login_signed_in_offline_retry.png', {
      caption: `[mocked response] press 2 (retry): POST ${LOGIN_API} × ${login.seen.length} (204 each), POST ${REFRESH_PATH} × ${refresh.seen.length} (was ${refreshesBefore}); still /login, "Đăng nhập" enabled`,
    });
    await refresh.stop();
    await login.stop();
  });

  test('E01 · [mocked response] login 204 but the session does not open (real refresh 401) → reported as a failure, not waved through: "Mật khẩu đúng nhưng chưa mở được phiên làm việc…" (cookie hint), stays on /login', async ({ page }) => {
    // withSession: established false, serverUnreachable false → SessionNotOpenedError (AuthScreen.container.tsx:
    // 176-187, BUG-014) → sessionNotOpened (useAuthScreen.ts:254-256) → notices.sessionNotOpened, attention, no
    // title (:321-322) — no longer "Phiên làm việc đã hết hạn". Only the login is mocked (no cookie is set);
    // the follow-up refresh is real and answers 401.
    const login = await mockPost(page, LOGIN_API, noContent);

    await openAnonymousLogin(page);
    await emailBox(page).fill(nobody('mnosession'));
    await passwordBox(page).fill(PROBE_PASSWORD);
    const refreshed = waitForStatus(page, 'POST', REFRESH_API, [401]);
    await button(page, SIGN_IN_LABEL).click();
    await refreshed;

    const strip = alertWith(page, SESSION_NOT_OPENED);
    await expect(strip).toBeVisible();
    await expect(strip.getByRole('heading')).toHaveCount(0);
    await expect(authMain(page, 'error')).toBeVisible();
    await expect(button(page, SIGN_IN_LABEL)).toBeEnabled();
    expect(pathOf(page.url())).toBe(ROUTES.login);
    expect(login.seen).toHaveLength(1);
    await attachJson('E01_login_no_session.json', { loginRequests: login.seen.length, followUpRefresh: 401, url: pathOf(page.url()) }); // BUG-034
    await captureEvidence(page, 'E01_login_no_session.png');
    await login.stop();
  });
});

/* -------------------------------------------------- SCR-02 forgot panel */

test.describe('E01 SCR-02 Forgot password', () => {
  test('[BUG-009] E01 · fresh /login → first click on "Quên mật khẩu" opens the panel', async ({ page }) => {
    // Regression test (BUG-009, fixed on 7735bcda). The empty email box is autofocused (AuthScreen.tsx:251-258);
    // mousedown on the link blurs it, and blurField now returns early for an empty value (useAuthScreen.ts:
    // 562-569), so nothing is inserted under the box and the link stays under the cursor. ONE click opens the
    // panel (AuthScreen.tsx:211-218 → openForgot :260-263 → title :306-308) and no "chưa nhập" appeared.
    await openAnonymousLogin(page);
    await expect(emailBox(page)).toBeFocused();
    await expect(emailBox(page)).toHaveValue('');

    await button(page, FORGOT_PASSWORD).click();
    const opened = await h1(page, FORGOT_PASSWORD)
      .waitFor({ timeout: 3_000 })
      .then(() => true, () => false);

    await captureEvidence(page, 'E01_bug009_first_click.png');
    expect(opened, 'BUG-009: the first click on "Quên mật khẩu" must open the panel').toBe(true);
    await expect(page.getByText(EMAIL_REQUIRED, { exact: true })).toHaveCount(0);
  });

  test('[BUG-011] E01 · Enter on the focused "Quên mật khẩu" opens the panel (not a sign-in submit)', async ({ page }) => {
    // Regression test (BUG-011, fixed on 7735bcda): the form's onKeyDown now returns unless the Enter came from
    // an INPUT (AuthScreen.tsx:88-98), so a focused type="button" (:211-218) activates on Enter (WCAG 2.1.1).
    // Empty form → had it been turned into a submit it would only validate; no request either way.
    await openAnonymousLogin(page);
    const requests = recordApiRequests(page);

    try {
      await button(page, FORGOT_PASSWORD).focus();
      await page.keyboard.press('Enter');
      const opened = await h1(page, FORGOT_PASSWORD)
        .waitFor({ timeout: 3_000 })
        .then(() => true, () => false);

      await captureEvidence(page, 'E01_forgot_enter_key.png');
      await nextFrame(page);
      expect(posts(requests.sent, LOGIN_API)).toEqual([]);
      await attachJson('E01_forgot_enter_key.json', { loginRequests: posts(requests.sent, LOGIN_API).length, opened }); // BUG-034
      expect(opened, 'Enter on the focused "Quên mật khẩu" must open the panel').toBe(true);
    } finally {
      requests.stop();
    }
  });

  test('E01 · keyboard: the panel opens with the typed address and focus in its box; "Quay lại đăng nhập" (Enter) returns focus to the sign-in email, its value kept', async ({ page }) => {
    // forgotPassword carries values.email into the panel (useAuthScreen.ts:594-597 → useForgotPassword.ts:79-84);
    // title AND subtitle now both in the screen header, the brand line replaced (AuthScreen.tsx:306-311 — the
    // panel no longer repeats it); wantsFocus → the mounted panel's email box (AuthScreen.tsx:251-263,
    // ForgotPasswordPanel.tsx:67-68); state partial (useAuthScreen.ts:428-440). The panel email is its own copy:
    // back keeps the sign-in value (useAuthScreen.ts:599-601). The back button sits outside any Enter handler
    // (ForgotPasswordPanel.tsx:42-51 handles Esc only).
    const address = nobody('carry');

    await openAnonymousLogin(page);
    await emailBox(page).fill(address);
    await openForgotByKeyboard(page);

    await expect(h1(page, FORGOT_PASSWORD).locator('xpath=following-sibling::p[1]')).toHaveText(FORGOT_SUBTITLE);
    await expect(page.getByText(FORGOT_SUBTITLE, { exact: true }), 'said once, in the header').toHaveCount(1);
    await expect(emailBox(page)).toBeFocused();
    await expect(emailBox(page)).toHaveValue(address);
    await expect(authMain(page, 'partial')).toBeVisible();
    await expect(forgotStatus(page)).toHaveText('');
    await captureEvidence(page, 'E01_forgot_keyboard_open.png');

    await emailBox(page).fill(`x${address}`);
    await button(page, BACK_TO_SIGN_IN).focus();
    await page.keyboard.press('Enter');
    await expect(h1(page, SIGN_IN_TITLE)).toBeVisible();
    await expect(emailBox(page)).toBeFocused();
    await expect(emailBox(page)).toHaveValue(address);
    await captureEvidence(page, 'E01_forgot_back_focus.png');
  });

  test('E01 · invalid / empty address → field problem, NO POST /api/auth/password-reset', async ({ page }) => {
    // useForgotPassword.ts:94-107: schema check first; empty → emailRequired, else emailInvalid (too_big: next test).
    await openAnonymousLogin(page);
    await openForgotByKeyboard(page);
    const requests = recordApiRequests(page);

    try {
      await emailBox(page).fill('khong-hop-le');
      await button(page, SEND_RESET_LINK).click();
      await expect(page.getByText(EMAIL_INVALID, { exact: true })).toBeVisible();
      // BUG-096: the malformed-address state, before the box is emptied for the "required" half.
      await captureEvidence(page, 'E01_forgot_invalid_format.png', { caption: `"khong-hop-le" sent → format problem; POST ${PASSWORD_RESET_API} × ${posts(requests.sent, PASSWORD_RESET_API).length}` });

      await emailBox(page).fill('');
      await button(page, SEND_RESET_LINK).click();
      await expect(page.getByText(EMAIL_REQUIRED, { exact: true })).toBeVisible();

      await nextFrame(page);
      expect(posts(requests.sent, PASSWORD_RESET_API)).toEqual([]);
      await attachJson('E01_forgot_invalid.json', { resetRequests: posts(requests.sent, PASSWORD_RESET_API).length }); // BUG-034
      await captureEvidence(page, 'E01_forgot_invalid.png');
    } finally {
      requests.stop();
    }
  });

  test('E01 · address with no account → 204 and the neutral "sent" block UNDER the send button (no enumeration); focus not dropped; send locked with "Đổi địa chỉ nếu muốn gửi tới thư khác."; Enter does not resend; editing the address unlocks it and clears the block', async ({ page }) => {
    // f748afb0: the strip and the "sent" block moved under the send button (ForgotPasswordPanel.tsx:79-99, BUG-008),
    // and useReturnFocus (:34, 57-63; useReturnFocus.ts:16-46) keeps focus off <body> after the send (the
    // clicked button stays disabled once sent, so focus goes to the first enabled control of the panel).
    // REAL recovery request #1. BE:apps/api/auth_recovery/router.py:6-11,186-198,234-245: always 204; an
    // unknown address only PINGs redis (no token, no mail). FE shows the same constant sentence for every
    // 204 (useForgotPassword.ts:154, vi.json:173) in a bordered block inside the live region
    // (ForgotPasswordPanel.tsx:57-65, BUG-022). After a send: canSubmit = phase idle (useForgotPassword.ts:158)
    // → button disabled + sentHint (ForgotPasswordPanel.tsx:84-89); submit() returns on `sent` (:86-90); setEmail
    // drops `sent` back to idle (:72-77) → block gone, button back. No second request is made here.
    // The existing-account half is the Mailpit test below (a suite account, never the admin).
    await openAnonymousLogin(page);
    await openForgotByKeyboard(page);
    const address = nobody('forgot');

    await emailBox(page).fill(address);
    const requests = recordApiRequests(page);
    try {
      const answered = nextPost(page, PASSWORD_RESET_API);
      await button(page, SEND_RESET_LINK).click();

      expect((await answered).status(), `POST ${PASSWORD_RESET_API}`).toBe(204);
      await expect(forgotStatus(page)).toHaveText(FORGOT_SENT);
      await expect(authMain(page, 'success')).toBeVisible();
      await expect(button(page, SEND_RESET_LINK), 'locked after a send').toBeDisabled();
      await expect(page.getByText(FORGOT_SENT_HINT, { exact: true })).toBeVisible();
      const sendBox = await button(page, SEND_RESET_LINK).boundingBox();
      const sentBox = await page.getByText(FORGOT_SENT, { exact: true }).boundingBox();
      expect(sendBox && sentBox, 'send button and sent block boxes').toBeTruthy();
      expect(sentBox!.y, '"sent" block under the send button').toBeGreaterThanOrEqual(sendBox!.y + sendBox!.height);
      expect(await page.evaluate(() => document.activeElement === document.body), 'focus not dropped on <body>').toBe(false);
      await captureEvidence(page, 'E01_forgot_unknown_sent.png');

      await emailBox(page).press('Enter');
      await nextFrame(page);
      expect(posts(requests.sent, PASSWORD_RESET_API), 'Enter after a send does not resend').toHaveLength(1);

      await emailBox(page).fill(`x${address}`);
      await expect(button(page, SEND_RESET_LINK), 'a new address unlocks the button').toBeEnabled();
      await expect(forgotStatus(page)).toHaveText('');
      await expect(page.getByText(FORGOT_SENT_HINT, { exact: true })).toHaveCount(0);
      await expect(authMain(page, 'partial')).toBeVisible();
      await nextFrame(page);
      expect(posts(requests.sent, PASSWORD_RESET_API)).toHaveLength(1);
      await attachJson('E01_forgot_sent_lock.json', { status: 204, resetRequests: posts(requests.sent, PASSWORD_RESET_API).length });
      await captureEvidence(page, 'E01_forgot_sent_unlocked.png');
    } finally {
      requests.stop();
    }
  });

  test('E01 · [mocked response] sending: "Đang gửi…" + box locked, double click sends ONE {email}; then the "sent" line in role=status', async ({ page }) => {
    // phase 'sending' → button label submitting + disabled, input disabled (ForgotPasswordPanel.tsx:67-83;
    // useForgotPassword.ts:112, 155-158); state loading (useAuthScreen.ts:429-431); inFlight ref drops the 2nd
    // submit of the tick (useForgotPassword.ts:88, 111); body {email} (:114). 204 → sentMessage (:118-119, 154).
    const address = nobody('sending');
    const hold = deferred();
    const reset = await mockPost(page, PASSWORD_RESET_API, async (route) => {
      await hold.promise;
      await noContent(route);
    });

    await openAnonymousLogin(page);
    await openForgotByKeyboard(page);
    await emailBox(page).fill(address);
    await button(page, SEND_RESET_LINK).evaluate((element) => {
      (element as HTMLButtonElement).click();
      (element as HTMLButtonElement).click();
    });

    await expect(authMain(page, 'loading')).toBeVisible();
    await expect(button(page, SUBMITTING)).toBeDisabled();
    await expect(emailBox(page)).toBeDisabled();
    await captureEvidence(page, 'E01_forgot_sending.png');
    await nextFrame(page);
    expect(reset.seen, `POST ${PASSWORD_RESET_API} after a double click`).toHaveLength(1);
    expect(reset.seen[0]!.postDataJSON()).toEqual({ email: address });

    hold.open();
    await expect(forgotStatus(page)).toHaveText(FORGOT_SENT);
    await expect(authMain(page, 'success')).toBeVisible();
    await expect(emailBox(page)).toBeEnabled();
    await attachJson('E01_forgot_sent_line.json', { resetRequests: reset.seen.length, body: reset.seen[0]!.postDataJSON() as unknown }); // BUG-034: {email} only
    await captureEvidence(page, 'E01_forgot_sent_line.png');
    await reset.stop();
  });

  test('E01 · [mocked response] 429 → "Đã thử quá nhiều lần" / "Hãy đợi vài phút rồi thử lại." strip, send locked', async ({ page }) => {
    // classifyRecoveryFailure 429 → rateLimited, max(Retry-After, 60) s (recoveryShared.ts:22, 44-49) →
    // lock (useForgotPassword.ts:136-138) → canSubmit false (:158); strip title + tooManyRecovery, which no
    // longer repeats the title (recoveryShared.ts:87-92, vi.json:159; ForgotPasswordPanel.tsx:55); state error
    // (useAuthScreen.ts:435-437).
    const reset = await mockPost(page, PASSWORD_RESET_API, wire(429, { code: 'RATE_LIMITED' }, { 'Retry-After': '10' }));

    await openAnonymousLogin(page);
    await openForgotByKeyboard(page);
    await emailBox(page).fill(nobody('f429'));
    await button(page, SEND_RESET_LINK).click();

    await expect(page.getByText(TOO_MANY_TITLE, { exact: true })).toBeVisible();
    await expect(page.getByText(TOO_MANY_RECOVERY, { exact: true })).toBeVisible();
    await expect(authMain(page, 'error')).toBeVisible();
    await expect(button(page, SEND_RESET_LINK)).toBeDisabled();
    await expect(forgotStatus(page)).toHaveText('');
    expect(reset.seen).toHaveLength(1);
    await attachJson('E01_forgot_rate_limited.json', { resetRequests: reset.seen.length }); // BUG-034
    await captureEvidence(page, 'E01_forgot_rate_limited.png');
    await reset.stop();
  });

  test('E01 · [mocked response] network / 403 ORIGIN_MISMATCH / 500 → strip each (network: no title; 500: "Có trục trặc" + "Máy chủ chưa xử lý được yêu cầu…", no reload advice), send stays enabled; 422 VALIDATION(email) → box problem; Esc + reopen clears it all', async ({ page }) => {
    // classifyRecoveryFailure → other / originMismatch (recoveryShared.ts:58-66) → noticeForRecovery
    // (:78-121): network → attention, description only (:112-118, BUG-021); ORIGIN_MISMATCH title + description
    // (:93-98); any other kind → errors.unknown title + auth.errors.recoveryFailed, never "tải lại" (:100-110,
    // BUG-015). Not locked (useForgotPassword.ts:158). VALIDATION + field email → `field` → emailInvalid under the
    // box, no strip (useForgotPassword.ts:126-132). Esc → back (ForgotPasswordPanel.tsx:42-51); reopening runs
    // reset(): problem + failure cleared, address = the sign-in one (useForgotPassword.ts:79-84).
    const replies: readonly ((route: Route) => Promise<void>)[] = [
      networkDown,
      wire(403, { code: 'ORIGIN_MISMATCH' }),
      wire(500, { code: 'INTERNAL' }),
      wire(422, { code: 'VALIDATION', field: 'email', count: 1 }),
    ];
    let call = 0;
    const reset = await mockPost(page, PASSWORD_RESET_API, (route) => replies[call++]!(route));
    const strips: readonly { slug: string; title: string | null; message: string }[] = [
      { slug: 'network', title: null, message: NETWORK_DESCRIPTION },
      { slug: 'origin', title: ORIGIN_MISMATCH_TITLE, message: ORIGIN_MISMATCH_DESCRIPTION },
      { slug: '500', title: UNKNOWN_TITLE, message: RECOVERY_FAILED },
    ];

    await openAnonymousLogin(page);
    await openForgotByKeyboard(page);
    await emailBox(page).fill(nobody('fstrips'));

    for (const { slug, title, message } of strips) {
      await button(page, SEND_RESET_LINK).click();
      const strip = alertWith(page, message);
      await expect(strip, slug).toBeVisible();
      if (title === null) {
        await expect(strip.getByRole('heading'), `${slug}: no title`).toHaveCount(0);
      } else {
        await expect(strip.getByRole('heading', { name: title, exact: true }), slug).toBeVisible();
      }
      await expect(page.getByText(/tải lại/), `${slug}: no reload advice`).toHaveCount(0);
      await expect(authMain(page, 'error'), slug).toBeVisible();
      await expect(button(page, SEND_RESET_LINK), slug).toBeEnabled();
      // f748afb0: strip under the send button (ForgotPasswordPanel.tsx:79-84, BUG-008); focus back on the
      // clicked button once sending ends (useReturnFocus.ts:16-46).
      const stripTop = (await strip.boundingBox())?.y ?? Number.NaN;
      const send = await button(page, SEND_RESET_LINK).boundingBox();
      expect(stripTop, `${slug}: strip under the send button`).toBeGreaterThanOrEqual(send!.y + send!.height);
      await expect(button(page, SEND_RESET_LINK), `${slug}: focus back on the send button`).toBeFocused();
      await captureEvidence(page, `E01_forgot_strip_${slug}.png`);
    }

    await button(page, SEND_RESET_LINK).click();
    await expect(emailBox(page)).toHaveAccessibleDescription(EMAIL_INVALID);
    await expect(page.getByText(UNKNOWN_TITLE, { exact: true })).toHaveCount(0);
    await expect(authMain(page, 'partial')).toBeVisible();
    expect(reset.seen).toHaveLength(4);
    await attachJson('E01_forgot_strips.json', { resetRequests: reset.seen.length }); // BUG-034
    await captureEvidence(page, 'E01_forgot_validation_email.png');

    await emailBox(page).press('Escape');
    await expect(h1(page, SIGN_IN_TITLE)).toBeVisible();
    await openForgotByKeyboard(page);
    await expect(emailBox(page)).toHaveValue('');
    await expect(emailBox(page)).not.toHaveAttribute('aria-invalid', 'true');
    await expect(page.getByRole('alert')).toHaveCount(0);
    await expect(authMain(page, 'empty')).toBeVisible();
    await reset.stop();
  });
});

/* ---------------------------------------------------- SCR-02 375×812 */

test.describe('E01 SCR-02 compact 375×812', () => {
  // Layout breakpoint `lg` (1024): ValuePanel `hidden lg:flex` (ValuePanel.tsx:108), form column
  // `w-full … lg:w-[55%]`, form `w-[360px] max-w-full` (AuthScreen.tsx:295-296). Since 7735bcda controls also
  // change at `sm` (640): 46 px fields (Input.tsx:61-64), 44 px lg buttons (buttonVariants.ts:16-17), 44 px eye
  // button (PasswordField.tsx:65-66) — the touch-target case is in "E01 FE refresh 7735bcda". 768 ≥ sm renders
  // the 375 column with desktop control sizes; no case of its own. `isCollapsed` is unreachable (inventory).
  test.skip(({ viewport }) => isPhoneOutOfScope(viewport), PHONE_OUT_OF_SCOPE);
  test.use({ viewport: COMPACT });

  test('E01 · 375×812: value panel gone, form alone, no horizontal scroll, submit in view; Enter on the empty form → both problems fit', async ({ page }) => {
    await openAnonymousLogin(page);

    await expect(page.getByText(HERO_HEADLINE, { exact: true }) /* not a heading since BUG-047 */).toBeHidden();
    await emailBox(page).press('Enter');
    await expect(emailBox(page)).toHaveAccessibleDescription(EMAIL_REQUIRED);
    await expect(passwordBox(page)).toHaveAccessibleDescription(PASSWORD_REQUIRED);

    expect(await horizontalOverflow(page), 'horizontal overflow (px)').toBeLessThanOrEqual(0);
    const box = await button(page, SIGN_IN_LABEL).boundingBox();
    expect(box, 'submit button box').not.toBeNull();
    expect(box!.x).toBeGreaterThanOrEqual(0);
    expect(box!.x + box!.width).toBeLessThanOrEqual(COMPACT.width);
    await captureEvidence(page, 'E01_compact_login_375.png', { fullPage: true });
  });

  test('E01 · 375×812: wrong-credentials strip and "Quên mật khẩu" fit; the link opens the panel with the typed address', async ({ page }) => {
    // Real 401 (budget: "375 wrong"). BUG-090: no reset button under the strip any more; "Quên mật khẩu" →
    // openForgot → address carried (useAuthScreen.ts), focus in the panel box. Below 640 px the text button is
    // a 44 px touch target (BUG-041, `min-h-[44px] sm:min-h-6`).
    const address = nobody('compact');

    await openAnonymousLogin(page);
    await emailBox(page).fill(address);
    await passwordBox(page).fill(PROBE_PASSWORD);
    const { status } = await captureLogin(page, () => passwordBox(page).press('Enter'));

    expect(status, `POST ${LOGIN_API}`).toBe(401);
    await expect(page.getByText(INVALID_CREDENTIALS_TITLE, { exact: true })).toBeVisible();
    await expect(button(page, RESET_PASSWORD_ACTION), 'no reset button under the strip (BUG-090)').toHaveCount(0);
    const action = await button(page, FORGOT_PASSWORD).boundingBox();
    expect(action, '"Quên mật khẩu" box').not.toBeNull();
    expect(action!.x + action!.width).toBeLessThanOrEqual(COMPACT.width);
    expect(action!.height, '"Quên mật khẩu" touch target below 640 px (BUG-041), px').toBeGreaterThanOrEqual(44);
    expect(await horizontalOverflow(page), 'horizontal overflow (px)').toBeLessThanOrEqual(0);
    await captureEvidence(page, 'E01_compact_wrong_375.png', { fullPage: true });

    await button(page, FORGOT_PASSWORD).click();
    await expect(h1(page, FORGOT_PASSWORD)).toBeVisible();
    await expect(emailBox(page)).toHaveValue(address);
    await expect(emailBox(page)).toBeFocused();
    await captureEvidence(page, 'E01_compact_reset_action_375.png');
  });

  test('E01 · 375×812: forgot panel with its field problem fits, no horizontal scroll', async ({ page }) => {
    await openAnonymousLogin(page);
    await openForgotByKeyboard(page);
    const requests = recordApiRequests(page);

    try {
      await emailBox(page).fill('khong-hop-le');
      await emailBox(page).press('Enter');
      await expect(emailBox(page)).toHaveAccessibleDescription(EMAIL_INVALID);
      expect(await horizontalOverflow(page), 'horizontal overflow (px)').toBeLessThanOrEqual(0);
      const box = await button(page, SEND_RESET_LINK).boundingBox();
      expect(box, 'send button box').not.toBeNull();
      expect(box!.x + box!.width).toBeLessThanOrEqual(COMPACT.width);
      await nextFrame(page);
      expect(posts(requests.sent, PASSWORD_RESET_API)).toEqual([]);
      await attachJson('E01_compact_forgot_375.json', { resetRequests: posts(requests.sent, PASSWORD_RESET_API).length }); // BUG-034
      await captureEvidence(page, 'E01_compact_forgot_375.png', { fullPage: true });
    } finally {
      requests.stop();
    }
  });
});

/* ---------------------------------------- SCR-03 / SCR-04 recovery tokens */

test.describe('E01 anonymous — SCR-03 / SCR-04 recovery tokens', () => {
  test('E01 · invitation #token=bogus → real preview 422 INVITATION_TOKEN_INVALID → "không đúng" dead-end, no form, no accept; [mocked preview] + valid matching passwords → real accept 422 → dead-end', async ({ page }) => {
    // Since 147c9620 (G2-9/G2-10) the token is checked BEFORE the form: POST /invitations/preview
    // (useInvitationAccept.ts:172-212); BE 422 INVITATION_TOKEN_INVALID → deadReason 'invalid' → `forbidden` with
    // DEAD_REASON_MESSAGES.invalid (InvitationAccept.tsx:49-51, 139-149). REAL recovery requests: preview 1 + accept 1.
    const requests = recordApiRequests(page);
    try {
      const previewed = nextPost(page, INVITATION_PREVIEW_PATH);
      await openWithBootstrap(page, `${ROUTES.invitationAccept}#token=e01-bogus-${RUN_TAG}`);
      expect((await previewed).status(), `POST ${INVITATION_PREVIEW_PATH}`).toBe(422);
      await expect(authMain(page, 'forbidden')).toBeVisible();
      await expect(page.getByText(INVITATION_INVALID, { exact: true })).toBeVisible();
      await expect(page.getByText(INVITATION_DEAD_END_SUBTITLE, { exact: true })).toBeVisible();
      await expect(page.getByText(INVITATION_INCOMPLETE, { exact: true })).toHaveCount(0);
      await expect(page.getByLabel(FULL_NAME_LABEL, { exact: true }), 'no form for a rejected token').toHaveCount(0);
      await expect.poll(() => new URL(page.url()).hash).toBe('');
      await nextFrame(page);
      expect(posts(requests.sent, INVITATION_ACCEPT_API), 'nothing accepted').toEqual([]);
      await captureEvidence(page, 'E01_invite_bogus_token_preview.png');
    } finally {
      requests.stop();
    }

    // Submit path (a token that turns bad between preview and submit): classifyRecoveryFailure → tokenInvalid
    // (recoveryShared.ts, useInvitationAccept.ts:247) → isDead, no deadReason → the "expired" copy.
    await mockInvitationPreview(page);
    await page.goto('about:blank');
    await openWithBootstrap(page, `${ROUTES.invitationAccept}#token=e01-bogus-submit-${RUN_TAG}`);
    await expect(page.getByLabel(FULL_NAME_LABEL, { exact: true })).toBeVisible();
    await expect.poll(() => new URL(page.url()).hash).toBe('');

    await page.getByLabel(FULL_NAME_LABEL, { exact: true }).fill('E2E QA');
    await passwordBox(page).fill(PROBE_PASSWORD);
    await page.getByLabel(CONFIRM_PASSWORD_LABEL, { exact: true }).fill(PROBE_PASSWORD);
    const answered = nextPost(page, INVITATION_ACCEPT_API);
    await button(page, ACCEPT_INVITATION).click();

    expect((await answered).status(), `POST ${INVITATION_ACCEPT_API}`).toBe(422);
    await expect(authMain(page, 'forbidden')).toBeVisible();
    await expect(page.getByText(INVITATION_EXPIRED, { exact: true })).toBeVisible();
    await expect(page.getByText(INVITATION_DEAD_END_SUBTITLE, { exact: true })).toBeVisible();
    await expect(page.getByText(INVITATION_INCOMPLETE, { exact: true })).toHaveCount(0);
    await expect(page.getByRole('link', { name: GO_TO_SIGN_IN, exact: true })).toBeVisible();
    await attachJson('E01_invite_bogus_token.json', { previewStatus: 422, hashAfterLoad: new URL(page.url()).hash, acceptStatus: 422 }); // BUG-034
    await captureEvidence(page, 'E01_invite_bogus_token.png');
  });

  test('E01 · invitation ?token= in the QUERY (not the hash) → "incomplete link" dead-end (not "expired"), no request; the stray token is stripped from the URL, other query keys kept', async ({ page }) => {
    // fragmentToken.ts:81-108 reads the token ONLY from `location.hash`; since f748afb0 a stray `?token=` is
    // NOT read but IS removed from the address bar/history, every other query key kept (:86-98, QA-01 debt #4).
    // token null → hasUsableToken false (useInvitationAccept.ts:131-135) → `forbidden` (:182, 302-303) with
    // isLinkIncomplete (:340) → invitation.incomplete + deadEndSubtitle (InvitationAccept.tsx:80-99; BUG-005).
    const url = `${ROUTES.invitationAccept}?e01=keep&token=e01-query-${RUN_TAG}`;
    const requests = recordApiRequests(page);

    try {
      await openWithBootstrap(page, url);
      await expect(authMain(page, 'forbidden')).toBeVisible();
      await expect(page.getByText(INVITATION_INCOMPLETE, { exact: true })).toBeVisible();
      await expect(page.getByText(INVITATION_DEAD_END_SUBTITLE, { exact: true })).toBeVisible();
      await expect(page.getByText(INVITATION_EXPIRED, { exact: true })).toHaveCount(0);
      await expect(page.getByLabel(FULL_NAME_LABEL, { exact: true })).toHaveCount(0);
      await expect.poll(() => pathOf(page.url()), { message: 'stray ?token= stripped' }).toBe(`${ROUTES.invitationAccept}?e01=keep`);
      expect(posts(requests.sent, INVITATION_ACCEPT_API)).toEqual([]);
      await attachJson('E01_invite_query_token.json', { url: pathOf(page.url()), acceptRequests: posts(requests.sent, INVITATION_ACCEPT_API).length }); // BUG-034
      await captureEvidence(page, 'E01_invite_query_token.png');
    } finally {
      requests.stop();
    }
  });

  test('E01 · reset #token=bogus + valid matching passwords → [mocked response] 422 PASSWORD_RESET_TOKEN_INVALID → dead-end', async ({ page }) => {
    // Mocked for the recovery budget only (≤ 2 real recovery requests in this file); the reply is the one the
    // BE gives a bogus token (BE:auth_recovery/router.py:286-287 → 422 PASSWORD_RESET_TOKEN_INVALID, :55).
    // FE: usePasswordReset.ts:141, 191 → tokenInvalid → `forbidden`; well-formed token → "expired" + dead-end
    // subtitle (usePasswordReset.ts:252; PasswordReset.tsx:47-51, 63-71, BUG-005).
    const confirm = await mockPost(page, PASSWORD_RESET_CONFIRM_API, wire(422, { code: 'PASSWORD_RESET_TOKEN_INVALID' }));

    await openWithBootstrap(page, `${ROUTES.passwordReset}#token=e01-bogus-${RUN_TAG}`);
    await expect(page.getByLabel(NEW_PASSWORD_LABEL, { exact: true })).toBeVisible();
    await expect.poll(() => new URL(page.url()).hash).toBe('');

    await page.getByLabel(NEW_PASSWORD_LABEL, { exact: true }).fill(PROBE_PASSWORD);
    await page.getByLabel(CONFIRM_PASSWORD_LABEL, { exact: true }).fill(PROBE_PASSWORD);
    const answered = nextPost(page, PASSWORD_RESET_CONFIRM_API);
    await button(page, SET_NEW_PASSWORD).click();

    expect((await answered).status(), `POST ${PASSWORD_RESET_CONFIRM_API}`).toBe(422);
    expect(confirm.seen).toHaveLength(1);
    await expect(authMain(page, 'forbidden')).toBeVisible();
    await expect(page.getByText(RESET_LINK_EXPIRED, { exact: true })).toBeVisible();
    await expect(page.getByText(RESET_DEAD_END_SUBTITLE, { exact: true })).toBeVisible();
    await expect(page.getByRole('link', { name: GO_TO_SIGN_IN, exact: true })).toBeVisible();
    await attachJson('E01_reset_bogus_token.json', { hashAfterLoad: new URL(page.url()).hash, confirmRequests: confirm.seen.length }); // BUG-034
    await captureEvidence(page, 'E01_reset_bogus_token.png');
    await confirm.stop();
  });

  test('E01 · reset ?token= in the QUERY → "incomplete link" dead-end (not "expired"), no request; the stray token is stripped from the URL', async ({ page }) => {
    // Same reader (fragmentToken.ts:81-108; strip :86-98 since f748afb0) → token null → hasUsableToken false
    // (usePasswordReset.ts:97-101) → `forbidden` (:141, 228-229) with isLinkIncomplete (:252) →
    // passwordReset.incomplete (PasswordReset.tsx:71-79). `token` was the only key → no `?` left at all.
    const url = `${ROUTES.passwordReset}?token=e01-query-${RUN_TAG}`;
    const requests = recordApiRequests(page);

    try {
      await openWithBootstrap(page, url);
      await expect(authMain(page, 'forbidden')).toBeVisible();
      await expect(page.getByText(RESET_LINK_INCOMPLETE, { exact: true })).toBeVisible();
      await expect(page.getByText(RESET_DEAD_END_SUBTITLE, { exact: true })).toBeVisible();
      await expect(page.getByText(RESET_LINK_EXPIRED, { exact: true })).toHaveCount(0);
      await expect(page.getByLabel(NEW_PASSWORD_LABEL, { exact: true })).toHaveCount(0);
      await expect.poll(() => pathOf(page.url()), { message: 'stray ?token= stripped' }).toBe(ROUTES.passwordReset);
      expect(posts(requests.sent, PASSWORD_RESET_CONFIRM_API)).toEqual([]);
      await attachJson('E01_reset_query_token.json', { url: pathOf(page.url()), confirmRequests: posts(requests.sent, PASSWORD_RESET_CONFIRM_API).length }); // BUG-034
      await captureEvidence(page, 'E01_reset_query_token.png');
    } finally {
      requests.stop();
    }
  });
});

/* --------------------------------------------- SCR-01 / SCR-02 signing in */

test.describe('E01 signing in — SCR-01 / SCR-02', () => {
  test('E01 · real sign-in: "Đang gửi…" with every control locked while the session opens, then the success line under the button, then /', async ({ page }) => {
    // Admin success (budget: signing-in 1). The follow-up refresh (AuthScreen.container.tsx:166-191) is HELD,
    // so phase stays 'submitting': state loading, label "Đang gửi…", fields/eye/checkbox/forgot disabled
    // (AuthScreen.tsx:66-69, 138-218; PasswordField.tsx:57; useAuthScreen.ts:743-745) — there is no SSO button
    // (no host wires it, useAuthScreen.ts:781). Released → success notice for one 'standard' beat, state success
    // (useAuthScreen.ts:652-667, 699-703, 746-748), drawn under the button (AuthScreen.tsx:131, 180) →
    // onAuthenticated → /. Motion forced to no-preference: reduced motion skips the beat (:655-659).
    const { email, password } = readAdminCredentials();

    await page.emulateMedia({ reducedMotion: 'no-preference' });
    await openAnonymousLogin(page);
    const hold = deferred();
    const refresh = await mockPost(page, REFRESH_PATH, async (route) => {
      await hold.promise;
      await route.continue();
    });

    await emailBox(page).fill(email);
    await passwordBox(page).fill(password);
    const login = nextPost(page, LOGIN_API);
    await button(page, SIGN_IN_LABEL).click();

    expect((await login).status(), `POST ${LOGIN_API}`).toBe(204);
    await expect(authMain(page, 'loading')).toBeVisible();
    await expect(button(page, SUBMITTING)).toBeDisabled();
    for (const [name, control] of [
      ['email', emailBox(page)],
      ['password', passwordBox(page)],
      ['eye toggle', button(page, SHOW_PASSWORD)],
      ['remember me', rememberBox(page)],
      ['Quên mật khẩu', button(page, FORGOT_PASSWORD)],
    ] as const) {
      await expect(control, `${name} locked while signing in`).toBeDisabled();
    }
    await expect.poll(() => refresh.seen.length, { message: `POST ${REFRESH_PATH} after the 204` }).toBe(1);
    await captureEvidence(page, 'E01_login_signing_in.png');

    const flash = page.getByText(SIGNED_IN_SUCCESS, { exact: true }).waitFor({ state: 'visible' });
    hold.open();
    await flash;
    await landsOnDashboard(page, 'after the success line');
    await attachJson('E01_login_landed.json', { loginStatus: 204, heldRefreshes: refresh.seen.length, landed: pathOf(page.url()) }); // BUG-034
    await captureEvidence(page, 'E01_login_landed.png');
    await refresh.stop();
  });

  test('E01 · Back after a gated sign-in skips /login (both hops replace history)', async ({ page }) => {
    // SessionBootstrap.tsx:243-256 redirects with `<Navigate replace>`, and the screen leaves with
    // `navigate(destination, { replace: true })` (AuthScreen.container.tsx:340-342): /login never stays in
    // history, so Back returns to the entry before the gated URL — here the invitation page, which (no hash)
    // shows the "incomplete link" dead-end (InvitationAccept.tsx:84-90).
    const { email, password } = readAdminCredentials();

    await openWithBootstrap(page, ROUTES.invitationAccept);
    await expect(authMain(page, 'forbidden')).toBeVisible();

    await openWithBootstrap(page, ROUTES.dashboard);
    await expect.poll(() => pathOf(page.url())).toBe(loginUrl(ROUTES.dashboard));
    await expect(h1(page, SIGN_IN_TITLE)).toBeVisible();

    await emailBox(page).fill(email);
    await passwordBox(page).fill(password);
    const { status } = await captureLogin(page, () => button(page, SIGN_IN_LABEL).click());

    expect(status, `POST ${LOGIN_API}`).toBe(204);
    await landsOnDashboard(page, 'after sign-in');

    const landed = pathOf(page.url());
    await page.goBack();
    await expect.poll(() => pathOf(page.url()), { message: 'after Back' }).toBe(ROUTES.invitationAccept);
    await expect(page.getByText(INVITATION_INCOMPLETE, { exact: true })).toBeVisible();
    await expect(h1(page, SIGN_IN_TITLE)).toHaveCount(0);
    await attachJson('E01_back_after_login.json', { status, landed, afterBack: pathOf(page.url()) });
    await captureEvidence(page, 'E01_back_after_login.png');
  });

  test('E01 · admin email in UPPERCASE → sent verbatim, BE normalises → 204; then, signed in, an invitation link shows "Nhận lời mời sẽ đăng xuất…" UNDER "Nhận lời mời", nothing sent', async ({ page }) => {
    // FE sends the typed case (useAuthScreen.ts:643-648). BE looks the user up by
    // `normalize_email` = NFC + strip + casefold (BE:router.py:142-151, BE:packages/core/text.py:17-19)
    // and keys the throttle the same way (BE:apps/api/auth/emails.py:45-48), so this is the admin, and a success.
    // Second half reuses THIS session (no extra login, see budget): signed in + session known → warning
    // invitation.signedInWarning (useInvitationAccept.ts:330-333), drawn under the submit button since f748afb0
    // (InvitationAccept.tsx:161-175, 67e23fac). The form stays usable; only typing happens, no POST.
    const { email, password } = readAdminCredentials();
    const upper = email.toUpperCase();

    expect(upper, 'the admin address must contain letters for this probe').not.toBe(email);
    await openAnonymousLogin(page);
    await emailBox(page).fill(upper);
    await passwordBox(page).fill(password);
    const { sent, status } = await captureLogin(page, () => button(page, SIGN_IN_LABEL).click());

    expect(sent.email, 'email on the wire').toBe(upper);
    expect(status, `POST ${LOGIN_API}`).toBe(204);
    await landsOnDashboard(page, 'uppercase sign-in');
    await attachJson('E01_email_uppercase_admin.json', { sentEmailIsUppercase: sent.email === upper, status, landed: pathOf(page.url()) });
    await captureEvidence(page, 'E01_email_uppercase_admin.png', {
      caption: `admin address sent in UPPERCASE (${sent.email === upper ? 'verbatim' : 'CHANGED'}) → POST ${LOGIN_API} ${status} → signed in`,
    }); // BUG-034

    const requests = recordApiRequests(page);
    try {
      await mockInvitationPreview(page); // [mocked preview] (support/p01/recovery.ts)
      await openWithBootstrap(page, `${ROUTES.invitationAccept}#token=e01-signed-in-${RUN_TAG}`, [200]);
      const warning = alertWith(page, INVITATION_SIGNED_IN_WARNING);
      await expect(warning).toBeVisible();
      await expect(button(page, ACCEPT_INVITATION)).toBeEnabled();
      const warningTop = (await warning.boundingBox())?.y ?? Number.NaN;
      const acceptBox = await button(page, ACCEPT_INVITATION).boundingBox();
      expect(warningTop, 'warning under "Nhận lời mời"').toBeGreaterThanOrEqual(acceptBox!.y + acceptBox!.height);
      await nextFrame(page);
      expect(posts(requests.sent, INVITATION_ACCEPT_API), 'nothing accepted').toEqual([]);
      await attachJson('E01_invite_signed_in_warning.json', {
        warningTop,
        acceptBottom: acceptBox!.y + acceptBox!.height,
        acceptRequests: posts(requests.sent, INVITATION_ACCEPT_API).length,
      });
      await captureEvidence(page, 'E01_invite_signed_in_warning.png');
    } finally {
      requests.stop();
    }
  });

  test('E01 · "Ghi nhớ máy này" off → session refresh cookie; signed-in /login says "Bạn đang đăng nhập…" + "Về danh sách dự án" (→ /, Back → /login); on → persistent ~7 days', async ({ page }) => {
    // FE: rememberMe defaults to false and is posted as-is (useAuthScreen.ts:445, 647).
    // BE: Max-Age only when remembered, idle = 7 days; otherwise a browser-session cookie
    // (BE:apps/api/auth/sessions.py:61-64,187-190; cookies.py:24-26). The follow-up refresh re-issues it
    // with the session's own `remember` (sessions.py:476-477, router.py:266-275).
    // Signed-in /login (BUG-006): container passes onReturnToApp while authenticated (AuthScreen.container.tsx:
    // 344-346, 378) → at rest the strip says notices.signedIn with action goToProjects (useAuthScreen.ts:709-717).
    // f748afb0: strip UNDER "Đăng nhập" like every strip, its action a full-width lg button under it
    // (AuthScreen.tsx:111-116, 174-190, BUG-008/059); the form stays usable.
    // navigate(ROUTES.dashboard) WITHOUT replace (container :345) → Back returns to /login.
    const { email, password } = readAdminCredentials();

    await openAnonymousLogin(page);
    await expect(rememberBox(page)).not.toBeChecked();
    await emailBox(page).fill(email);
    await passwordBox(page).fill(password);
    const off = await captureLogin(page, () => button(page, SIGN_IN_LABEL).click());

    expect(off.sent.rememberMe, 'rememberMe on the wire (unchecked)').toBe(false);
    expect(off.status, `POST ${LOGIN_API}`).toBe(204);
    await landsOnDashboard(page, 'remember off');
    expect((await refreshCookie(page))?.expires, 'unchecked → session cookie').toBe(-1);
    await attachJson('E01_remember_off.json', {
      sentRememberMe: off.sent.rememberMe,
      status: off.status,
      refreshCookieExpires: (await refreshCookie(page))?.expires,
    });
    await captureEvidence(page, 'E01_remember_off.png', {
      caption: `"${REMEMBER_ME}" off → rememberMe=${String(off.sent.rememberMe)}, ${off.status}; ${REFRESH_COOKIE} expires=-1 (session cookie)`,
    }); // BUG-034

    // Signed in now: a signed-in /login still shows the form (main "signed in, /login shows the form"),
    // with the "already signed in" strip and its way back.
    await openWithBootstrap(page, ROUTES.login, [200]);
    const signedInStrip = alertWith(page, SIGNED_IN_NOTICE);
    await expect(signedInStrip).toBeVisible();
    await expect(button(page, GO_TO_PROJECTS)).toBeVisible();
    await expect(emailBox(page)).toBeEnabled();
    await expect(button(page, SIGN_IN_LABEL)).toBeEnabled();
    const signInBox = await button(page, SIGN_IN_LABEL).boundingBox();
    const signedInStripTop = (await signedInStrip.boundingBox())?.y ?? Number.NaN;
    const goBox = await button(page, GO_TO_PROJECTS).boundingBox();
    expect(signedInStripTop, '"already signed in" strip under "Đăng nhập"').toBeGreaterThanOrEqual(signInBox!.y + signInBox!.height);
    expect(goBox!.y, '"Về danh sách dự án" under the strip').toBeGreaterThan(signedInStripTop);
    expect(Math.abs(goBox!.width - signInBox!.width), '"Về danh sách dự án" full width, px').toBeLessThanOrEqual(1);
    await attachJson('E01_login_signed_in_strip.json', {
      stripTop: signedInStripTop,
      submitBottom: signInBox!.y + signInBox!.height,
      actionSize: { width: goBox!.width, height: goBox!.height },
    });
    await captureEvidence(page, 'E01_login_signed_in_strip.png');

    await button(page, GO_TO_PROJECTS).click();
    await landsOnDashboard(page, '"Về danh sách dự án"');
    await page.goBack();
    await expect.poll(() => pathOf(page.url()), { message: 'Back after "Về danh sách dự án"' }).toBe(ROUTES.login);
    await expect(h1(page, SIGN_IN_TITLE)).toBeVisible();
    await expect(signedInStrip).toBeVisible();
    await attachJson('E01_login_signed_in_return.json', { returnedTo: ROUTES.dashboard, afterBack: pathOf(page.url()) });

    await emailBox(page).fill(email);
    await passwordBox(page).fill(password);
    // The input is `sr-only` inside its label (Checkbox.tsx:40-57): click the label text, like a person.
    await page.getByText(REMEMBER_ME, { exact: true }).click();
    await expect(rememberBox(page)).toBeChecked();
    // [held response] the follow-up refresh of THIS attempt, so the in-flight state can be seen: the
    // "already signed in" strip shows only at rest (useAuthScreen.ts:709-711, BUG-006) — no flash while sending.
    const holdOn = deferred();
    const heldRefresh = await mockPost(page, REFRESH_PATH, async (route) => {
      await holdOn.promise;
      await route.continue();
    });
    const on = await captureLogin(page, () => button(page, SIGN_IN_LABEL).click());

    expect(on.sent.rememberMe, 'rememberMe on the wire (checked)').toBe(true);
    expect(on.status, `POST ${LOGIN_API}`).toBe(204);
    await expect(authMain(page, 'loading')).toBeVisible();
    await expect(signedInStrip, 'no "already signed in" strip while this attempt is in flight').toHaveCount(0);
    await expect.poll(() => heldRefresh.seen.length, { message: `POST ${REFRESH_PATH} after the 204` }).toBeGreaterThan(0);
    await captureEvidence(page, 'E01_login_signed_in_resubmit.png');
    holdOn.open();
    await landsOnDashboard(page, 'remember on');
    await heldRefresh.stop();

    const expires = (await refreshCookie(page))?.expires ?? Number.NaN;
    const expected = Date.now() / 1000 + REMEMBER_IDLE_S;

    expect(expires, 'checked → persistent cookie').toBeGreaterThan(expected - CLOCK_SLACK_S);
    expect(expires, 'checked → persistent cookie').toBeLessThan(expected + CLOCK_SLACK_S);
    await attachJson('E01_remember_on.json', {
      sentRememberMe: on.sent.rememberMe,
      status: on.status,
      refreshCookieExpiresInDays: Number(((expires - Date.now() / 1000) / 86_400).toFixed(3)),
    });
    await captureEvidence(page, 'E01_remember_on.png', {
      caption: `"${REMEMBER_ME}" on → rememberMe=${String(on.sent.rememberMe)}, ${on.status}; ${REFRESH_COOKIE} persistent, ${((expires - Date.now() / 1000) / 86_400).toFixed(2)} days`,
    }); // BUG-034
  });

  /*
   * `safeDestination` (AuthScreen.container.tsx:131-151), fed by `?next=` (:337):
   * - not starting with `/` → dashboard (:132): `javascript:…`, and a double-encoded `%2F%2F…` which
   *   decodes ONCE to the literal text `%2F%2Fexample.org` (Phase 1 covers the single-encoded `//`);
   * - a backslash → dashboard (:107-113, :132);
   * - `/login` itself, with or without a query → dashboard (:144-147), so no sign-in loop.
   */
  const NEXT_CASES = [
    { slug: 'javascript', next: 'javascript:alert(1)' },
    { slug: 'backslash', next: '/\\example.org' },
    { slug: 'double_encoded', next: '%2F%2Fexample.org' },
    { slug: 'login', next: '/login' },
    { slug: 'login_loop', next: '/login?next=/login' },
  ] as const;

  test('E01 · ?next= javascript:, /\\host, %2F%2Fhost, /login, /login?next=/login → sign in lands in-app at /', async ({ page }) => {
    const { email, password } = readAdminCredentials();
    const dialogs = collectDialogs(page);
    const landed: Record<string, string> = {};

    for (const [index, { slug, next }] of NEXT_CASES.entries()) {
      // First pass anonymous (fresh context), then signed in by the previous pass.
      await openWithBootstrap(page, loginUrl(next), index === 0 ? [401] : [200]);
      await expect(h1(page, SIGN_IN_TITLE), `next=${next}`).toBeVisible();
      await emailBox(page).fill(email);
      await passwordBox(page).fill(password);
      const { status } = await captureLogin(page, () => button(page, SIGN_IN_LABEL).click());

      expect(status, `POST ${LOGIN_API} (next=${next})`).toBe(204);
      await landsOnDashboard(page, `next=${next}`);
      landed[next] = page.url();
      await captureEvidence(page, `E01_next_${slug}.png`, { caption: `opened ${loginUrl(next)} → signed in (${status}) → landed in-app at /` }); // BUG-034
    }
    expect(dialogs, 'no script ran from ?next=').toEqual([]);
    await attachJson('E01_next_cases.json', { landedUrlByNext: landed, dialogs });
  });
});

/* ------------------------- SCR-03 / SCR-04 with REAL one-time tokens (Mailpit) */

/*
 * Coverage rows recovery #44 / #57 and login #90 were UNKNOWN / n/a ("no token obtainable") — Mailpit now
 * catches every mail (tests/support/mailpit.ts), so the happy paths run on the real stack with users this
 * file creates (`qa-<runId>-…@example.test` viewers, never the admin) and deletes in `finally`.
 * Setup calls are the ones `phase01_auth_api.spec.ts` proved this run: invite (BE:apps/api/users/router.py:55),
 * accept (BE:apps/api/auth_recovery/router.py:337-365), delete (BE:apps/api/users/router.py:111-123).
 */
const TEST_PREFIX = TEST_DATA_PREFIX;
const INVITE_SUBJECT = 'Lời mời tham gia AppFront'; // BE:apps/api/auth_recovery/messages.py:20,39 (fb005b27)
const RESET_SUBJECT = 'Yêu cầu đặt lại mật khẩu AppFront'; // BE:apps/api/auth_recovery/messages.py:20,48
const INVITATION_SUCCESS = 'Đã nhận lời mời. Đang mở tài khoản của bạn.'; // vi.json:185
const RESET_SUCCESS = 'Đã đổi mật khẩu. Đang chuyển tới trang đăng nhập.'; // vi.json:193
const PASSWORD_RESET_NOTICE = 'Đã đổi mật khẩu. Hãy đăng nhập lại bằng mật khẩu mới.'; // vi.json:197
const LOGOUT_PATH = '/api/auth/logout'; // lib/auth/session.ts:42,200 under the /api base

const suiteEmail = (slug: string): string => testEmail(`e01-${slug}`);
const suitePassword = (): string => `Qa-e01-${Math.random().toString(36).slice(2, 10)}-${Date.now().toString(36)}`;

/** Newest mail to `address` with `subject` (an earlier mail to the same address may still be listed). */
async function mailWithSubject(address: string, subject: string, since: Date): Promise<Mail> {
  const deadline = Date.now() + 30_000;
  for (;;) {
    const mail = await waitForMail(address, since, Math.max(1_000, deadline - Date.now()));
    if (mail.subject === subject) return mail;
    if (Date.now() > deadline) throw new Error(`No "${subject}" mail to ${address} within 30 s`);
    await new Promise((resolve) => setTimeout(resolve, 1_000));
  }
}

/**
 * In-app path + hash of the mailed link. The link is `{PUBLIC_BASE_URL}{path}#token=…`
 * (BE:apps/api/auth_recovery/messages.py:46); the FE reads ONLY the hash (src/screens/auth/fragmentToken.ts:37-54).
 */
function mailedPath(mail: Mail, path: string): string {
  const link = new URL(linkFrom(mail, path));
  expect(link.origin, 'mailed link origin = the app under test').toBe(new URL(apiBaseUrl()).origin);
  expect(link.pathname).toBe(path);
  expect(new URLSearchParams(link.hash.slice(1)).get('token'), 'mailed link carries #token=').toBeTruthy();
  return `${link.pathname}${link.hash}`;
}

interface SuiteUser {
  readonly id: string;
  readonly email: string;
}

/** Admin invites one viewer → 201 `[{id, email, status: pending}]`; returns it and its invitation mail. */
async function inviteViewer(admin: APIRequestContext, email: string): Promise<{ user: SuiteUser; mail: Mail }> {
  const since = new Date(Date.now() - 5_000);
  const res = await admin.post('/api/users/invitations', { data: { emails: [email], role: 'viewer' } });
  expect(res.status(), 'precondition: POST /api/users/invitations').toBe(201);
  const out = (await res.json()) as { id: unknown; email: unknown; status: unknown }[];
  const row = out.find((u) => u.email === email);
  expect(row?.status, 'precondition: invited user is pending').toBe('pending');
  const mail = await mailWithSubject(email, INVITE_SUBJECT, since);
  return { user: { id: String(row!.id), email }, mail };
}

async function cleanupSuiteUser(admin: APIRequestContext | undefined, user: SuiteUser | undefined, mails: string[]): Promise<void> {
  try {
    if (admin && user) {
      const res = await admin.delete(`/api/users/${user.id}`, { data: { userId: user.id, confirmEmail: user.email } });
      if (res.status() !== 200) test.info().annotations.push({ type: 'cleanup', description: `DELETE user → ${res.status()}` });
    }
    await deleteMails(mails);
  } catch (error) {
    test.info().annotations.push({ type: 'cleanup', description: String(error) });
  } finally {
    await admin?.dispose();
  }
}

test.describe('E01 real one-time tokens (Mailpit) — SCR-03 / SCR-04', () => {
  test('E01 · SCR-03 · real invitation link from Mailpit → "Nhận lời mời" → real 204, "Đã nhận lời mời…" while the session opens [held response], then / signed in', async ({ page }) => {
    // Token only from the hash, stripped on read (fragmentToken.ts:37-54). Submit → accept {token, fullName trimmed,
    // password} (useInvitationAccept.ts:218-219) → 204 → phase succeeded (:222) = success line + fields locked
    // (InvitationAccept.tsx:109-114, vi.json:185) → bootstrapSession (:225) → navigate('/', replace) (:229-230).
    // BE: 204 opens a session (BE:apps/api/auth_recovery/router.py:351-365). The follow-up refresh is the REAL
    // response, only held so the success line can be seen.
    const email = suiteEmail('invite');
    const password = suitePassword();
    const fullName = `${TEST_PREFIX}E01 Invitee`;
    const mails: string[] = [];
    let admin: APIRequestContext | undefined;
    let user: SuiteUser | undefined;

    try {
      const { email: adminEmail, password: adminPassword } = readAdminCredentials();
      admin = await signedInApi(adminEmail, adminPassword);
      const invited = await inviteViewer(admin, email);
      user = invited.user;
      mails.push(invited.mail.id);
      const path = mailedPath(invited.mail, ROUTES.invitationAccept);

      await page.emulateMedia({ reducedMotion: 'no-preference' });
      await openWithBootstrap(page, path);
      await expect(button(page, ACCEPT_INVITATION)).toBeEnabled();
      await expect.poll(() => new URL(page.url()).hash, { message: '#token stripped' }).toBe('');

      await page.getByLabel(FULL_NAME_LABEL, { exact: true }).fill(`  ${fullName}  `);
      await passwordBox(page).fill(password);
      await page.getByLabel(CONFIRM_PASSWORD_LABEL, { exact: true }).fill(password);

      const hold = deferred();
      const refresh = await mockPost(page, REFRESH_PATH, async (route) => {
        await hold.promise;
        await route.continue();
      });
      const requested = page.waitForRequest(isPost(INVITATION_ACCEPT_API));
      const accepted = nextPost(page, INVITATION_ACCEPT_API);
      await button(page, ACCEPT_INVITATION).click();
      const [request, response] = await Promise.all([requested, accepted]);
      const body = request.postDataJSON() as Record<string, unknown>;

      expect(response.status(), `POST ${INVITATION_ACCEPT_API}`).toBe(204);
      expect(body.fullName, 'fullName trimmed on the wire').toBe(fullName);
      expect(typeof body.token === 'string' && body.token.length > 0, 'token from the hash in the body').toBe(true);
      expect(new URL(request.url()).search, 'token never in the query').toBe('');
      await expect(page.getByText(INVITATION_SUCCESS, { exact: true })).toBeVisible();
      await expect(authMain(page, 'success')).toBeVisible();
      await expect(page.getByLabel(FULL_NAME_LABEL, { exact: true })).toBeDisabled();
      await expect.poll(() => refresh.seen.length, { message: `POST ${REFRESH_PATH} after the 204` }).toBe(1);
      await captureEvidence(page, 'E01_real_invite_success.png');

      const opened = waitForStatus(page, 'POST', REFRESH_API, [200]);
      hold.open();
      await opened;
      await landsOnDashboard(page, 'after accepting a real invitation');
      const cookie = await refreshCookie(page);
      expect(cookie, 'session cookie set by the real 204').toBeDefined();
      await attachJson('E01_real_invite_success.json', {
        acceptStatus: response.status(),
        sentFullName: body.fullName,
        sentKeys: Object.keys(body).sort(),
        requestQuery: new URL(request.url()).search,
        landed: pathOf(page.url()),
        refreshCookie: cookie ? { present: true, httpOnly: cookie.httpOnly, secure: cookie.secure, sameSite: cookie.sameSite } : null,
      });
      await captureEvidence(page, 'E01_real_invite_landed.png');
      await refresh.stop();
    } finally {
      await cleanupSuiteUser(admin, user, mails);
    }
  });

  test('E01 · SCR-02 → SCR-04 · real reset: forgot panel for an existing account → 204 + mail; mailed link → "Đổi mật khẩu" → real 204, logout [held response], /login "Đã đổi mật khẩu…" notice; the new password signs in', async ({ page }) => {
    // Forgot: UFP posts {email} (useForgotPassword.ts:111-114) → BE issues a token + mail for an ACTIVE user
    // (BE:apps/api/auth_recovery/router.py:186-198,234-245) → the same neutral sentence (vi.json:173).
    // Reset: confirm {token, newPassword} (usePasswordReset.ts:172-173) → 204 → success line (:175-176,
    // PasswordReset.tsx:75-77) → endLocalSession = signOut → POST /api/auth/logout (PasswordReset.container.tsx:30,
    // lib/auth/session.ts:200,305-311) → navigate('/login', replace, notice passwordReset) (:182) → notice
    // (AuthScreen.container.tsx:278-285,358-370). BE: new hash, token consumed (router.py:255-292).
    const email = suiteEmail('reset');
    const firstPassword = suitePassword();
    const newPassword = suitePassword();
    const mails: string[] = [];
    let admin: APIRequestContext | undefined;
    let user: SuiteUser | undefined;

    try {
      // Precondition: an ACTIVE suite account (invite + accept through the API, as the API spec does).
      const { email: adminEmail, password: adminPassword } = readAdminCredentials();
      admin = await signedInApi(adminEmail, adminPassword);
      const invited = await inviteViewer(admin, email);
      user = invited.user;
      mails.push(invited.mail.id);
      const inviteToken = new URLSearchParams(new URL(linkFrom(invited.mail, ROUTES.invitationAccept)).hash.slice(1)).get('token');
      const anon = await newApiContext();
      try {
        const accepted = await anon.post(INVITATION_ACCEPT_API, {
          data: { token: inviteToken, fullName: `${TEST_PREFIX}E01 Reset`, password: firstPassword },
        });
        expect(accepted.status(), 'precondition: account activated (POST invitations/accept)').toBe(204);
      } finally {
        await anon.dispose();
      }

      // SCR-02 forgot panel, real 204 for an existing account.
      await openAnonymousLogin(page);
      await emailBox(page).fill(email);
      await openForgotByKeyboard(page);
      await expect(emailBox(page)).toHaveValue(email);
      const since = new Date(Date.now() - 5_000);
      const requested = nextPost(page, PASSWORD_RESET_API);
      await button(page, SEND_RESET_LINK).click();
      const requestStatus = (await requested).status();
      expect(requestStatus, `POST ${PASSWORD_RESET_API} (existing account)`).toBe(204);
      await expect(forgotStatus(page)).toHaveText(FORGOT_SENT);
      await expect(authMain(page, 'success')).toBeVisible();
      await captureEvidence(page, 'E01_real_reset_requested.png');

      const resetMail = await mailWithSubject(email, RESET_SUBJECT, since);
      mails.push(resetMail.id);
      const path = mailedPath(resetMail, ROUTES.passwordReset);

      // SCR-04 with the real token.
      await openWithBootstrap(page, path);
      await expect(button(page, SET_NEW_PASSWORD)).toBeEnabled();
      await expect.poll(() => new URL(page.url()).hash, { message: '#token stripped' }).toBe('');
      await page.getByLabel(NEW_PASSWORD_LABEL, { exact: true }).fill(newPassword);
      await page.getByLabel(CONFIRM_PASSWORD_LABEL, { exact: true }).fill(newPassword);

      const hold = deferred();
      const logout = await mockPost(page, LOGOUT_PATH, async (route) => {
        await hold.promise;
        await route.continue();
      });
      const confirmed = nextPost(page, PASSWORD_RESET_CONFIRM_API);
      await button(page, SET_NEW_PASSWORD).click();
      const confirmStatus = (await confirmed).status();

      expect(confirmStatus, `POST ${PASSWORD_RESET_CONFIRM_API}`).toBe(204);
      await expect(page.getByText(RESET_SUCCESS, { exact: true })).toBeVisible();
      await expect(authMain(page, 'success')).toBeVisible();
      await expect(page.getByLabel(NEW_PASSWORD_LABEL, { exact: true })).toBeDisabled();
      await expect.poll(() => logout.seen.length, { message: `POST ${LOGOUT_PATH} after the 204` }).toBe(1);
      await captureEvidence(page, 'E01_real_reset_success.png');

      hold.open();
      await expect.poll(() => pathOf(page.url())).toBe(ROUTES.login);
      await expect(page.getByRole('alert').filter({ hasText: PASSWORD_RESET_NOTICE })).toBeVisible();
      await captureEvidence(page, 'E01_real_reset_notice.png');
      await logout.stop();

      // The new password works (one real login, a suite account).
      await emailBox(page).fill(email);
      await passwordBox(page).fill(newPassword);
      const { status: loginStatus } = await captureLogin(page, () => button(page, SIGN_IN_LABEL).click());
      expect(loginStatus, `POST ${LOGIN_API} with the new password`).toBe(204);
      await landsOnDashboard(page, 'signed in with the new password');
      await attachJson('E01_real_reset.json', {
        resetRequestStatus: requestStatus,
        resetMailSubject: resetMail.subject,
        mailedPath: ROUTES.passwordReset,
        confirmStatus,
        logoutRequests: logout.seen.length,
        afterReset: ROUTES.login,
        newPasswordLoginStatus: loginStatus,
        landed: pathOf(page.url()),
      });
      await captureEvidence(page, 'E01_real_reset_new_password.png');
    } finally {
      await cleanupSuiteUser(admin, user, mails);
    }
  });
});

/* ------------------------------- gaps opened by the FE refresh c4978eb4 → 7735bcda */

/** The two recovery forms, as the tests below fill them (labels: vi.json:109-113). */
interface RecoveryForm {
  readonly slug: 'invite' | 'reset';
  readonly path: string;
  readonly api: string;
  readonly submit: string;
  /** The box that carries the 8-character hint (InvitationAccept.tsx:129-139, PasswordReset.tsx:80-91). */
  readonly passwordLabel: string;
  /** Usable-form subtitle (vi.json:178 invitation — reworded on 7735bcda —, :189 reset). */
  readonly subtitle: string;
  readonly fillValid: (page: Page) => Promise<void>;
}

const RECOVERY_FORMS: readonly RecoveryForm[] = [
  {
    slug: 'invite',
    path: ROUTES.invitationAccept,
    api: INVITATION_ACCEPT_API,
    submit: ACCEPT_INVITATION,
    passwordLabel: PASSWORD_LABEL,
    subtitle: 'Đặt họ tên và mật khẩu để bắt đầu làm việc.',
    fillValid: async (page) => {
      await page.getByLabel(FULL_NAME_LABEL, { exact: true }).fill('E2E QA');
      await passwordBox(page).fill(PROBE_PASSWORD);
      await page.getByLabel(CONFIRM_PASSWORD_LABEL, { exact: true }).fill(PROBE_PASSWORD);
    },
  },
  {
    slug: 'reset',
    path: ROUTES.passwordReset,
    api: PASSWORD_RESET_CONFIRM_API,
    submit: SET_NEW_PASSWORD,
    passwordLabel: NEW_PASSWORD_LABEL,
    subtitle: 'Nhập mật khẩu mới cho tài khoản của bạn.',
    fillValid: async (page) => {
      await page.getByLabel(NEW_PASSWORD_LABEL, { exact: true }).fill(PROBE_PASSWORD);
      await page.getByLabel(CONFIRM_PASSWORD_LABEL, { exact: true }).fill(PROBE_PASSWORD);
    },
  },
];

const recoveryForm = (slug: RecoveryForm['slug']): RecoveryForm => {
  const form = RECOVERY_FORMS.find((candidate) => candidate.slug === slug);
  if (form === undefined) throw new Error(`no recovery form ${slug}`);
  return form;
};

/**
 * Open a recovery form with a well-formed but unknown `#token=` (anonymous) and wait until it can submit:
 * the invitation button is disabled while the session is pending (useInvitationAccept.ts:188, 334).
 * The token reaches the backend only if a test lets a submit through.
 */
async function openRecoveryForm(page: Page, form: RecoveryForm, tag: string): Promise<void> {
  // [mocked preview] for the invitation: the form opens only after the token preview (support/p01/recovery.ts).
  if (form.slug === 'invite') await mockInvitationPreview(page);
  await openWithBootstrap(page, `${form.path}#token=e01-${tag}-${RUN_TAG}`);
  await expect(button(page, form.submit)).toBeEnabled();
  await expect.poll(() => new URL(page.url()).hash, { message: '#token stripped' }).toBe(''); // fragmentToken.ts:41-45
}

/** The eye button of the box labelled `label` (PasswordField.tsx:55-61: `aria-controls` = the input id). */
async function eyeOf(page: Page, label: string): Promise<{ id: string; eye: Locator }> {
  const id = await page.getByLabel(label, { exact: true }).getAttribute('id');
  expect(id, `${label} has an id`).toBeTruthy();
  return { id: id!, eye: page.locator(`button[aria-controls="${id}"]`) };
}

test.describe('E01 FE refresh 7735bcda — SCR-01..SCR-04', () => {
  test('E01 · SCR-01 · anonymous on a gated non-root path → /login with "Hãy đăng nhập để tiếp tục." carried in history state (not read from ?next=), read once: F5 on the same /login?next= shows none; anonymous / → no notice', async ({ page }) => {
    // SessionBootstrap.tsx:243-256 (BUG-007): sessionEnded → 'sessionEnded'; else next ≠ ROUTES.dashboard →
    // state.notice 'signInRequired'; next = "/" → no state. /login: noticeOf (AuthScreen.container.tsx:278-285) →
    // INITIAL_NOTICES.signInRequired, attention (useAuthScreen.ts:345-349); the entry is dropped once read
    // (container :358-370), so a reload of the very same URL (same ?next=) shows nothing.
    const gated = ROUTES.project.floors('x');

    await openWithBootstrap(page, gated);
    await expect.poll(() => pathOf(page.url())).toBe(loginUrl(gated));
    await expect(h1(page, SIGN_IN_TITLE)).toBeVisible();
    await expect(alertWith(page, SIGN_IN_REQUIRED_NOTICE)).toBeVisible();
    await expect
      .poll(() => page.evaluate(() => (history.state as { usr?: { notice?: unknown } | null } | null)?.usr?.notice))
      .toBeUndefined();
    await captureEvidence(page, 'E01_gate_sign_in_required.png');

    const reloaded = waitForStatus(page, 'POST', REFRESH_API, [401]);
    await page.reload({ waitUntil: 'commit' });
    await reloaded;
    await expect(h1(page, SIGN_IN_TITLE)).toBeVisible();
    expect(pathOf(page.url()), 'same ?next= after F5').toBe(loginUrl(gated));
    await expect(page.getByText(SIGN_IN_REQUIRED_NOTICE, { exact: true }), 'F5: notice not re-derived from ?next=').toHaveCount(0);
    await captureEvidence(page, 'E01_gate_sign_in_required_f5.png');

    await openWithBootstrap(page, ROUTES.dashboard);
    await expect.poll(() => pathOf(page.url())).toBe(loginUrl(ROUTES.dashboard));
    await expect(h1(page, SIGN_IN_TITLE)).toBeVisible();
    await expect(page.getByText(SIGN_IN_REQUIRED_NOTICE, { exact: true }), 'guest on / → nothing to explain').toHaveCount(0);
    await attachJson('E01_gate_sign_in_required.json', {
      gated,
      landed: loginUrl(gated),
      noticeAfterF5: false,
      rootLanded: pathOf(page.url()),
    });
    await captureEvidence(page, 'E01_gate_root_no_notice.png');
  });

  test('E01 · SCR-02 · "Đã có thư điện tử, còn thiếu mật khẩu." only for a well-formed address: malformed + empty password → state empty, no partial line; a valid address → partial, line under "Đăng nhập"; no request', async ({ page }) => {
    // state: partial only when firstProblem('email') is undefined and the password is empty (useAuthScreen.ts:
    // 752-755); the line renders after the submit button (AuthScreen.tsx:182-187, BUG-008). Blur on a non-empty
    // malformed address flags it (useAuthScreen.ts:562-586).
    await openAnonymousLogin(page);
    const requests = recordApiRequests(page);

    try {
      await emailBox(page).fill('khong-hop-le');
      await expect(authMain(page, 'empty')).toBeVisible();
      await expect(page.getByText(PARTIAL_NOTICE, { exact: true })).toHaveCount(0);
      await emailBox(page).blur();
      await expect(emailBox(page)).toHaveAccessibleDescription(EMAIL_INVALID);
      await captureEvidence(page, 'E01_partial_malformed.png');

      await emailBox(page).fill(nobody('partial'));
      await expect(authMain(page, 'partial')).toBeVisible();
      const line = page.getByText(PARTIAL_NOTICE, { exact: true });
      await expect(line).toBeVisible();
      const lineBox = await line.boundingBox();
      const submitBox = await button(page, SIGN_IN_LABEL).boundingBox();
      expect(lineBox && submitBox, 'boxes').toBeTruthy();
      expect(lineBox!.y, 'partial line under the button').toBeGreaterThanOrEqual(submitBox!.y + submitBox!.height);
      await nextFrame(page);
      expect(posts(requests.sent, LOGIN_API)).toEqual([]);
      await attachJson('E01_partial.json', { loginRequests: posts(requests.sent, LOGIN_API).length }); // BUG-034
      await captureEvidence(page, 'E01_partial_valid.png');
    } finally {
      requests.stop();
    }
  });

  test('E01 · SCR-02 · keyboard: Enter, then Space, on the focused eye button only toggles "Hiện mật khẩu" / "Ẩn mật khẩu" — no submit, no validation, no request (BUG-011); the button names its input and has no aria-pressed', async ({ page }) => {
    // The form's onKeyDown ignores an Enter whose target is not an INPUT (AuthScreen.tsx:88-98); the eye is a
    // type="button" toggling the box type, label Hiện/Ẩn, aria-controls = the input id, no aria-pressed
    // (PasswordField.tsx:49-73). The email box is empty: a submit would have said "Chưa nhập thư điện tử."
    await openAnonymousLogin(page);
    const requests = recordApiRequests(page);

    try {
      await passwordBox(page).fill(PROBE_PASSWORD);
      const { id, eye } = await eyeOf(page, PASSWORD_LABEL);

      await expect(eye).toHaveAccessibleName(SHOW_PASSWORD);
      await eye.focus();
      await page.keyboard.press('Enter');
      await expect(passwordBox(page)).toHaveAttribute('type', 'text');
      await expect(eye).toHaveAccessibleName(HIDE_PASSWORD);
      await expect(eye).toBeFocused();
      await expect(eye).toHaveAttribute('aria-controls', id);
      await expect(eye).not.toHaveAttribute('aria-pressed');
      await expect(page.getByText(EMAIL_REQUIRED, { exact: true }), 'Enter on the eye is not a submit').toHaveCount(0);
      await captureEvidence(page, 'E01_eye_enter_key.png');

      await page.keyboard.press('Space');
      await expect(passwordBox(page)).toHaveAttribute('type', 'password');
      await expect(eye).toHaveAccessibleName(SHOW_PASSWORD);
      await expect(passwordBox(page)).toHaveValue(PROBE_PASSWORD);
      await nextFrame(page);
      expect(posts(requests.sent, LOGIN_API)).toEqual([]);
      await attachJson('E01_eye_enter_key.json', { ariaControlsMatchesInput: true, loginRequests: 0 });
    } finally {
      requests.stop();
    }
  });

  test('E01 · SCR-02 forgot panel · address longer than 254 chars → "Thư điện tử dài quá 254 ký tự…" (not "chưa đúng dạng"), NO POST /api/auth/password-reset', async ({ page }) => {
    // useForgotPassword.ts:94-107: PasswordResetRequestSchema email = min(1).email().max(254) (schemas/auth.ts:
    // 13-20) → issue `too_big` → emailTooLong (BUG-010), returned before the request (:106).
    const longAddress = `${LONG_LOCAL}@${'b'.repeat(60)}.${'c'.repeat(60)}.${'d'.repeat(60)}.${TEST_EMAIL_DOMAIN}`;

    expect(longAddress.length, 'probe length').toBeGreaterThan(254);
    await openAnonymousLogin(page);
    await openForgotByKeyboard(page);
    const requests = recordApiRequests(page);

    try {
      await emailBox(page).fill(longAddress);
      await button(page, SEND_RESET_LINK).click();
      await expect(emailBox(page)).toHaveAccessibleDescription(EMAIL_TOO_LONG);
      await expect(page.getByText(EMAIL_INVALID, { exact: true })).toHaveCount(0);
      await nextFrame(page);
      expect(posts(requests.sent, PASSWORD_RESET_API)).toEqual([]);
      await attachJson('E01_forgot_too_long.json', { addressLength: longAddress.length, resetRequests: 0 });
      await captureEvidence(page, 'E01_forgot_too_long.png');
    } finally {
      requests.stop();
    }
  });

  test('E01 · SCR-03 / SCR-04 · password boxes: one eye per box (aria-controls its own input) toggling only that box; "Mật khẩu cần ít nhất 8 ký tự." describes the first box BEFORE any submit and gives way to the error after one; no request', async ({ page }) => {
    // PasswordField (BUG-051): eye per box (PasswordField.tsx:49-73); `hint` shown with its own id and wired into
    // aria-describedby, dropped when the box has an error (:36-40, 79-83, BUG-049). The hint is passed only to
    // the first password box (InvitationAccept.tsx:129-131, PasswordReset.tsx:80-82). 7 characters → passwordProblem
    // (recoveryShared.ts:136-145) on submit. Usable-form subtitle (InvitationAccept.tsx:70-72, PasswordReset.tsx:47-51).
    const requests = recordApiRequests(page);

    try {
      for (const form of RECOVERY_FORMS) {
        await openRecoveryForm(page, form, `pw-${form.slug}`);
        const first = page.getByLabel(form.passwordLabel, { exact: true });
        const confirm = page.getByLabel(CONFIRM_PASSWORD_LABEL, { exact: true });
        const { id: firstId, eye: firstEye } = await eyeOf(page, form.passwordLabel);
        const { eye: confirmEye } = await eyeOf(page, CONFIRM_PASSWORD_LABEL);
        const hint = page.locator(`[id="${firstId}-hint"]`);

        await expect(page.getByText(form.subtitle, { exact: true }), `${form.slug}: usable-form subtitle`).toBeVisible();
        await expect(first, `${form.slug}: hint before submit`).toHaveAccessibleDescription(PASSWORD_TOO_SHORT);
        await expect(hint).toHaveText(PASSWORD_TOO_SHORT);
        await expect(first).not.toHaveAttribute('aria-invalid', 'true');
        await expect(confirm, `${form.slug}: no hint on the confirm box`).toHaveAccessibleDescription('');

        await first.fill('1234567');
        await confirm.fill('1234567');
        await firstEye.click();
        await expect(first).toHaveAttribute('type', 'text');
        await expect(confirm, 'the other box stays hidden').toHaveAttribute('type', 'password');
        await expect(firstEye).toHaveAccessibleName(HIDE_PASSWORD);
        await expect(confirmEye).toHaveAccessibleName(SHOW_PASSWORD);
        await captureEvidence(page, `E01_pwfield_${form.slug}_hint.png`);

        await button(page, form.submit).click();
        await expect(first).toHaveAttribute('aria-invalid', 'true');
        await expect(first).toHaveAccessibleDescription(PASSWORD_TOO_SHORT);
        await expect(hint, 'hint gives way to the error').toHaveCount(0);
        await nextFrame(page);
        expect(posts(requests.sent, form.api), `${form.slug}: client rule, no request`).toEqual([]);
        await attachJson(`E01_pwfield_${form.slug}.json`, { requests: posts(requests.sent, form.api).length }); // BUG-034
        await captureEvidence(page, `E01_pwfield_${form.slug}_error.png`);
      }
    } finally {
      requests.stop();
    }
  });

  test('E01 · SCR-04 · the usable reset form has "Về trang đăng nhập" under its button (BUG-050) → client-side navigation to /login, no request', async ({ page }) => {
    // PasswordReset.tsx:104-110: RecoveryLink after the submit button, also when the form is usable;
    // RecoveryLink preventDefaults the href and calls goToSignIn (RecoveryShell.tsx:62-75) → navigate(ROUTES.login)
    // (usePasswordReset.ts:212-214). A window marker set before the click survives → no document load.
    const requests = recordApiRequests(page);

    try {
      await openRecoveryForm(page, recoveryForm('reset'), 'link');
      const link = page.getByRole('link', { name: GO_TO_SIGN_IN, exact: true });
      await expect(link).toBeVisible();
      await expect(link).toHaveAttribute('href', ROUTES.login);
      const linkBox = await link.boundingBox();
      const submitBox = await button(page, SET_NEW_PASSWORD).boundingBox();
      expect(linkBox && submitBox, 'boxes').toBeTruthy();
      expect(linkBox!.y, 'link under the submit button').toBeGreaterThanOrEqual(submitBox!.y + submitBox!.height);
      await captureEvidence(page, 'E01_reset_form_sign_in_link.png');

      await page.evaluate(() => {
        (window as unknown as { e01Marker?: number }).e01Marker = 1;
      });
      await link.click();
      await expect.poll(() => pathOf(page.url())).toBe(ROUTES.login);
      await expect(h1(page, SIGN_IN_TITLE)).toBeVisible();
      const sameDocument = await page.evaluate(() => (window as unknown as { e01Marker?: number }).e01Marker === 1);
      expect(sameDocument, 'client-side navigation (no reload)').toBe(true);
      await nextFrame(page);
      expect(posts(requests.sent, PASSWORD_RESET_CONFIRM_API)).toEqual([]);
      await attachJson('E01_reset_form_sign_in_link.json', { landed: pathOf(page.url()), sameDocument, confirmRequests: 0 });
      await captureEvidence(page, 'E01_reset_form_link_landed.png');
    } finally {
      requests.stop();
    }
  });

  test('E01 · SCR-03 · real BE: name with U+202E (bidi override) + unknown token → 422 field fullName → "Họ và tên có ký tự không dùng được…" under the typed name (BUG-016), form stays', async ({ page }) => {
    // REAL recovery request (budget: bidi). FE accepts it (schemas/auth.ts:53 only trims and measures); BE
    // rejects bidi / control characters in fullName during body validation, before any token lookup
    // (BE:packages/core/text.py:6,35-46; BE:apps/api/auth_recovery/router.py:64-69,98-102 — BE coverage row BI3)
    // → 422 VALIDATION field "fullName". FE: classifyRecoveryFailure → field (recoveryShared.ts:62-64) →
    // serverFieldProblem('fullName') = fullNameInvalid (recoveryShared.ts:156-162; useInvitationAccept.ts:246-251).
    const bidiName = 'E2E ‮QA';

    await openRecoveryForm(page, recoveryForm('invite'), 'bidi');
    await page.getByLabel(FULL_NAME_LABEL, { exact: true }).fill(bidiName);
    await passwordBox(page).fill(PROBE_PASSWORD);
    await page.getByLabel(CONFIRM_PASSWORD_LABEL, { exact: true }).fill(PROBE_PASSWORD);
    const answered = nextPost(page, INVITATION_ACCEPT_API);
    await button(page, ACCEPT_INVITATION).click();

    const status = (await answered).status();
    expect(status, `POST ${INVITATION_ACCEPT_API}`).toBe(422);
    const name = page.getByLabel(FULL_NAME_LABEL, { exact: true });
    await expect(name).toHaveAccessibleDescription(FULL_NAME_INVALID);
    await expect(name).toHaveValue(bidiName);
    await expect(authMain(page, 'forbidden')).toHaveCount(0);
    await expect(button(page, ACCEPT_INVITATION)).toBeEnabled();
    await attachJson('E01_invite_bidi_name.json', { status, copyUnderName: FULL_NAME_INVALID });
    await captureEvidence(page, 'E01_invite_bidi_name.png');
  });

  test('E01 · SCR-03 / SCR-04 · [mocked response] 500 → "Có trục trặc" + "Máy chủ chưa xử lý được yêu cầu…" (no reload advice); network → "Mất kết nối máy chủ…" with no title; 429 → "Hãy đợi vài phút rồi thử lại.", submit locked — each strip UNDER the submit button, typed values kept', async ({ page }) => {
    // noticeForRecovery (recoveryShared.ts:78-121): any non-network/timeout kind → errors.unknown title +
    // auth.errors.recoveryFailed, violation (:100-110, BUG-015: a reload would lose the link's token); network →
    // attention, description only (:112-118, BUG-021/020); 429 → title + tooManyRecovery (:87-92), lock ≥ 60 s
    // (:44-49; useInvitationAccept.ts:256-258, usePasswordReset.ts:201-203; canSubmit :334 / :249). The strip is
    // rendered after the submit button (InvitationAccept.tsx:159-160, PasswordReset.tsx:107-108, BUG-008).
    const kinds: readonly {
      readonly kind: string;
      readonly reply: (route: Route) => Promise<void>;
      readonly title: string | null;
      readonly message: string;
    }[] = [
      { kind: '500', reply: wire(500, { code: 'INTERNAL' }), title: UNKNOWN_TITLE, message: RECOVERY_FAILED },
      { kind: 'network', reply: networkDown, title: null, message: NETWORK_DESCRIPTION },
      { kind: '429', reply: wire(429, { code: 'RATE_LIMITED' }, { 'Retry-After': '10' }), title: TOO_MANY_TITLE, message: TOO_MANY_RECOVERY },
    ];

    for (const form of RECOVERY_FORMS) {
      let call = 0;
      const mocked = await mockPost(page, form.api, (route) => kinds[Math.min(call++, kinds.length - 1)]!.reply(route));

      try {
        await openRecoveryForm(page, form, `strips-${form.slug}`);
        await form.fillValid(page);

        for (const { kind, title, message } of kinds) {
          await button(page, form.submit).click();
          const strip = alertWith(page, message);
          await expect(strip, `${form.slug} ${kind}`).toBeVisible();
          if (title === null) {
            await expect(strip.getByRole('heading'), `${form.slug} ${kind}: no title`).toHaveCount(0);
          } else {
            await expect(strip.getByRole('heading', { name: title, exact: true })).toBeVisible();
          }
          await expect(page.getByText(/tải lại/), 'no reload advice').toHaveCount(0);
          await expect(authMain(page, 'error')).toBeVisible();
          await expect(page.getByLabel(CONFIRM_PASSWORD_LABEL, { exact: true })).toHaveValue(PROBE_PASSWORD);
          const stripBox = await strip.boundingBox();
          const submitBox = await button(page, form.submit).boundingBox();
          expect(stripBox && submitBox, 'boxes').toBeTruthy();
          expect(stripBox!.y, `${form.slug} ${kind}: strip under the button`).toBeGreaterThanOrEqual(submitBox!.y + submitBox!.height);
          if (kind === '429') {
            await expect(button(page, form.submit), 'locked after a 429').toBeDisabled();
          } else {
            await expect(button(page, form.submit)).toBeEnabled();
            // f748afb0: useReturnFocus (InvitationAccept.tsx:73, 111-116; PasswordReset.tsx:49, 82-86) — the
            // clicked button has focus again once the attempt ends.
            await expect(button(page, form.submit), `${form.slug} ${kind}: focus back on the submit button`).toBeFocused();
          }
          await captureEvidence(page, `E01_recovery_strip_${form.slug}_${kind}.png`);
        }
        expect(mocked.seen, `${form.slug}: one request per press`).toHaveLength(kinds.length);
        await attachJson(`E01_recovery_strip_${form.slug}.json`, { requests: mocked.seen.length, presses: kinds.length }); // BUG-034
      } finally {
        await mocked.stop();
      }
    }
  });

  test('E01 · SCR-03 · [mocked response] server unreachable at load → "Mất kết nối máy chủ…" strip with no title + "Thử lại"; pending "Đang kiểm tra kết nối."; a failed retry says "Đã thử lại nhưng vẫn chưa kết nối được máy chủ." (BUG-024); a retry that reaches the server (real 401) → strip gone, focus on "Họ và tên"', async ({ page }) => {
    // Bootstrap refresh fails at the network → serverUnreachable while status stays `unknown` (lib/auth/refresh.ts:
    // 305-334) → isSessionUnavailable (useInvitationAccept.ts:323) → InlineAlert without title + "Thử lại"
    // (InvitationAccept.tsx:94-100). retrySession → pending = connectionStates.checking, failed =
    // invitation.retryFailed, not the strip's own sentence again (useInvitationAccept.ts:277-292, 341-348).
    // The last retry goes through (real 401 → anonymous): the strip unmounts and focus, left on <body> by the
    // vanished button, returns to the first field (InvitationAccept.tsx:43-54).
    let mode: 'abort' | 'hold' | 'pass' = 'abort';
    const held: Route[] = [];
    const matcher = (url: URL): boolean => url.pathname === REFRESH_PATH;
    const handler = async (route: Route): Promise<void> => {
      if (mode === 'abort') return route.abort('failed');
      if (mode === 'pass') return route.fallback();
      held.push(route);
    };
    await page.route(matcher, handler);

    try {
      await mockInvitationPreview(page); // [mocked preview] (support/p01/recovery.ts)
      await page.goto(`${ROUTES.invitationAccept}#token=e01-offline-${RUN_TAG}`, { waitUntil: 'commit' });
      const strip = alertWith(page, NETWORK_DESCRIPTION);
      await expect(strip).toBeVisible();
      await expect(strip.getByRole('heading'), 'no repeated title').toHaveCount(0);
      await expect(page.getByLabel(FULL_NAME_LABEL, { exact: true })).toBeVisible();
      await captureEvidence(page, 'E01_invite_offline_strip.png');

      mode = 'hold';
      await strip.getByRole('button', { name: RETRY, exact: true }).click();
      await expect(recoveryStatus(page)).toHaveText(CHECKING_CONNECTION);
      await expect.poll(() => held.length, { message: `POST ${REFRESH_PATH} after "Thử lại"` }).toBeGreaterThan(0);
      mode = 'abort';
      await Promise.all(held.splice(0).map((route) => route.abort('failed')));
      await expect(recoveryStatus(page)).toHaveText(INVITATION_RETRY_FAILED);
      await expect(strip).toBeVisible();
      // f748afb0 (67e23fac): the retry line sits UNDER "Nhận lời mời" (InvitationAccept.tsx:161-174, QA-01c debt #11).
      const retryLineTop = (await recoveryStatus(page).boundingBox())?.y ?? Number.NaN;
      const acceptBox = await button(page, ACCEPT_INVITATION).boundingBox();
      expect(retryLineTop, 'retry line under "Nhận lời mời"').toBeGreaterThanOrEqual(acceptBox!.y + acceptBox!.height);
      await attachJson('E01_invite_offline_retry_line.json', { retryLineTop, acceptBottom: acceptBox!.y + acceptBox!.height });
      await captureEvidence(page, 'E01_invite_offline_retry_failed.png');

      mode = 'pass';
      const resolved = waitForStatus(page, 'POST', REFRESH_API, [401]);
      await strip.getByRole('button', { name: RETRY, exact: true }).click();
      await resolved;
      await expect(strip).toHaveCount(0);
      await expect(page.getByLabel(FULL_NAME_LABEL, { exact: true })).toBeFocused();
      await expect(recoveryStatus(page)).toHaveText('');
      await attachJson('E01_invite_offline_retry_ok.json', { retryRefreshStatus: 401 }); // BUG-034
      await captureEvidence(page, 'E01_invite_offline_retry_ok.png');
    } finally {
      await page.unroute(matcher, handler);
    }
  });

  test('E01 · SCR-03 · "Họ và tên" autofocused; Enter on the empty form → "Chưa nhập họ và tên." / "Chưa nhập mật khẩu." / "Chưa nhập lại mật khẩu." under their boxes, no request', async ({ page }) => {
    // Re-covers rec "title/subtitle … Enter on the empty form" for SCR-03, which now stops at its old subtitle
    // (vi.json:178 reworded). autoFocus (InvitationAccept.tsx:117-121); <form onSubmit> (:101-106, 56-62) →
    // submit() → fullNameProblem / passwordProblem / confirmProblem (useInvitationAccept.ts:110-122, 192-211;
    // recoveryShared.ts:136-154) before the port. vi.json:142, 140, 136.
    const invite = recoveryForm('invite');
    const requests = recordApiRequests(page);

    try {
      await openRecoveryForm(page, invite, 'empty');
      const name = page.getByLabel(FULL_NAME_LABEL, { exact: true });
      await expect(name).toBeFocused();
      await name.press('Enter');

      await expect(name).toHaveAccessibleDescription('Chưa nhập họ và tên.');
      await expect(passwordBox(page)).toHaveAccessibleDescription(PASSWORD_REQUIRED);
      await expect(page.getByLabel(CONFIRM_PASSWORD_LABEL, { exact: true })).toHaveAccessibleDescription('Chưa nhập lại mật khẩu.');
      await expect(authMain(page, 'empty')).toBeVisible();
      await nextFrame(page);
      expect(posts(requests.sent, INVITATION_ACCEPT_API)).toEqual([]);
      await attachJson('E01_invite_enter_empty.json', { acceptRequests: posts(requests.sent, INVITATION_ACCEPT_API).length }); // BUG-034
      await captureEvidence(page, 'E01_invite_enter_empty.png');
    } finally {
      requests.stop();
    }
  });

  test.describe('375×812', () => {
    test.skip(({ viewport }) => isPhoneOutOfScope(viewport), PHONE_OUT_OF_SCOPE);
    test.use({ viewport: COMPACT });

    test('E01 · 375×812 · touch targets below 640 px: 46 px field boxes (44 px inside the border), "Đăng nhập" 44 px, eye button 44×44, "Quên mật khẩu" and "Về trang đăng nhập" on the reset form 44 px tall (BUG-041), "Ghi nhớ máy này" ≥ 24 px; recovery screens use 24 px side margins (BUG-048/040/052/098)', async ({ page }) => {
      // Input.tsx:61-64 `h-[46px] sm:h-[38px]`; buttonVariants.ts:16-17 lg `h-11 … sm:h-10`; PasswordField.tsx:65-66
      // `h-11 w-11 … sm:h-6 sm:w-6`; text links/buttons `min-h-[44px] sm:min-h-6` (AuthScreen.tsx, RecoveryShell.tsx
      // RecoveryLink, BUG-041); RecoveryShell.tsx `px-6 … sm:px-12`.
      // Run-06 measured 44 for the 46 px box: the panel was still in `animate-panel-rise` (a transform scale,
      // AuthScreen.tsx:296 / RecoveryShell.tsx:27, tailwind.config.ts:132,200) and boundingBox() includes the
      // transform. So: reduced motion (`motion-reduce:animate-none` on both panels), wait for every finite
      // animation to end, and read LAYOUT sizes (offsetWidth/offsetHeight ignore transforms).
      // Hand-measured on the stack before BUG-041: field box 46, "Đăng nhập" 44, eye 44×44, "Quên mật khẩu" 88×26 (now 44 tall).
      await page.emulateMedia({ reducedMotion: 'reduce' });
      await openAnonymousLogin(page);
      await animationsSettled(page);
      const field = await layoutSize(emailBox(page).locator('xpath=..'));
      const input = await layoutSize(emailBox(page));
      const submit = await layoutSize(button(page, SIGN_IN_LABEL));
      const eye = await layoutSize(button(page, SHOW_PASSWORD));
      const forgot = await layoutSize(button(page, FORGOT_PASSWORD));
      expect(field.height, 'field box').toBe(46);
      expect(input.height, 'input inside the border').toBeGreaterThanOrEqual(44);
      expect(submit.height, '"Đăng nhập"').toBe(44);
      expect(eye.width, 'eye width').toBe(44);
      expect(eye.height, 'eye height').toBe(44);
      expect(forgot.height, '"Quên mật khẩu" below 640 px (BUG-041)').toBeGreaterThanOrEqual(44);
      // BUG-098: every control on the shot is measured. The checkbox input is `sr-only` inside its label
      // (Checkbox.tsx:40-57, label `min-h-[32px]`), so the touch target is the label; the drawn box is 18 px.
      // Bug threshold 24 px (WCAG 2.5.8, soft so the shot is still taken); 44 px is the recommendation, recorded.
      const remember = await layoutSize(rememberBox(page).locator('xpath=ancestor::label[1]'));
      expect.soft(remember.height, `"${REMEMBER_ME}" label (touch target) height`).toBeGreaterThanOrEqual(24);
      expect.soft(remember.width, `"${REMEMBER_ME}" label (touch target) width`).toBeGreaterThanOrEqual(24);
      expect(await horizontalOverflow(page), 'horizontal overflow (px)').toBeLessThanOrEqual(0);
      await captureEvidence(page, 'E01_touch_targets_login_375.png', {
        fullPage: true,
        caption: `field ${field.height} · "Đăng nhập" ${submit.height} · eye ${eye.width}×${eye.height} · "Quên mật khẩu" ${forgot.width}×${forgot.height} · "${REMEMBER_ME}" ${remember.width}×${remember.height} (bug < 24, recommended 44)`,
      });

      await openRecoveryForm(page, recoveryForm('reset'), 'touch');
      await animationsSettled(page);
      const main = page.locator('main[data-auth-state]');
      const padding = await main.evaluate((element) => {
        const style = getComputedStyle(element);
        return { left: style.paddingLeft, right: style.paddingRight };
      });
      const titleBox = await h1(page, 'Đặt lại mật khẩu' /* vi.json:188 */).boundingBox();
      expect(padding, 'recovery side margins below 640').toEqual({ left: '24px', right: '24px' });
      expect(titleBox, 'title box').not.toBeNull();
      expect(Math.round(titleBox!.x), 'title starts at the 24 px margin').toBe(24);
      // BUG-098: the reset form's "Về trang đăng nhập" (RecoveryLink, PasswordReset.tsx:104-110) is measured too.
      const backLink = await layoutSize(page.getByRole('link', { name: GO_TO_SIGN_IN, exact: true }));
      expect.soft(backLink.height, `"${GO_TO_SIGN_IN}" height below 640 px (BUG-041)`).toBeGreaterThanOrEqual(44);
      expect(await horizontalOverflow(page), 'horizontal overflow (px)').toBeLessThanOrEqual(0);
      await attachJson('E01_touch_targets_375.json', {
        measuredWith: 'offsetWidth/offsetHeight, reducedMotion=reduce, animations settled',
        thresholds: { bugBelowPx: 24, recommendedPx: 44 },
        fieldBoxHeight: field.height,
        inputHeight: input.height,
        submitHeight: submit.height,
        eye,
        forgot,
        rememberLabel: remember,
        rememberMeets44: remember.width >= 44 && remember.height >= 44,
        resetBackLink: backLink,
        resetBackLinkMeets44: backLink.width >= 44 && backLink.height >= 44,
        recoveryPadding: padding,
      });
      await captureEvidence(page, 'E01_touch_targets_reset_375.png', {
        fullPage: true,
        caption: `side margins ${padding.left}/${padding.right} · "${GO_TO_SIGN_IN}" ${backLink.width}×${backLink.height} (bug < 24, recommended 44)`,
      });
    });
  });
});

/* ------------------------------- gaps opened by the FE refresh 7735bcda → f748afb0 */

/** `GlobalShortcutHelp.tsx:160-182`: role=dialog labelled by the h2 "Phím tắt". */
const SHORTCUT_HELP_TITLE = 'Phím tắt';
/** `vi.json` auth.actions.expand — only rendered in the `collapsed` state, which no host can reach. */
const EXPAND_FORM = 'Mở lại biểu mẫu';
/** `lib/auth/refresh.ts:46` REFRESH_MAX_TRANSIENT_ATTEMPTS. */
const REFRESH_MAX_TRANSIENT_ATTEMPTS = 8;

/** Top edge of every locator, in px (layout must not move: compare before/after). */
async function tops(entries: readonly (readonly [string, Locator])[]): Promise<Record<string, number>> {
  const out: Record<string, number> = {};
  for (const [name, locator] of entries) {
    out[name] = (await locator.boundingBox())?.y ?? Number.NaN;
  }
  return out;
}

function expectSameTops(before: Record<string, number>, after: Record<string, number>, what: string): void {
  for (const name of Object.keys(before)) {
    expect(
      Math.abs((after[name] ?? Number.NaN) - (before[name] ?? Number.NaN)),
      `${what}: "${name}" did not move (BUG-008), px`,
    ).toBeLessThanOrEqual(1);
  }
}

test.describe('E01 FE refresh f748afb0 — SCR-01..SCR-04 (+ the gate in front of SCR-08…40, SCR-41 on /login)', () => {
  test('E01 · SCR-01 · anonymous /?query (the home page with a query) → /login?next= keeps the query but shows NO notice (the rule reads the pathname now)', async ({ page }) => {
    // SessionBootstrap.tsx:288-301: not sessionEnded and pathname === ROUTES.dashboard → no state at all (BUG-007);
    // f748afb0 compares `pathname` (:297, passed at :403) instead of the decoded ?next= — "/?e01=root" used to get
    // 'signInRequired'. loginHref still carries pathname + search (:401).
    const gated = `${ROUTES.dashboard}?e01=root`;

    await openWithBootstrap(page, gated);
    await expect.poll(() => pathOf(page.url())).toBe(loginUrl(gated));
    await expect(h1(page, SIGN_IN_TITLE)).toBeVisible();
    await expect(page.getByRole('alert'), 'no opening notice for the home page').toHaveCount(0);
    await expect(page.getByText(SIGN_IN_REQUIRED_NOTICE, { exact: true })).toHaveCount(0);
    await attachJson('E01_gate_root_query_no_notice.json', { gated, landedUrl: pathOf(page.url()) });
    await captureEvidence(page, 'E01_gate_root_query_no_notice.png');
  });

  test('E01 · SCR-01 · anonymous on the routes of SCR-08/10/11/37/38/39/40 → each /login?next=<path> with "Hãy đăng nhập để tiếp tục."; prod build: no NotFound, no dev screen, no AccessDenied without a session', async ({ page }) => {
    // Only `/login`, `/login/invitation/*`, `/login/reset-password/*` are public in a prod build; the 8 dev
    // patterns join them only under import.meta.env.DEV (paths.ts:203-230, SessionBootstrap.tsx:326-332). Every
    // other path — a project screen, an admin screen, /khong-co-quyen, an unknown path (the `*` NotFound) — is
    // gated BEFORE the router picks a screen (router.tsx: SessionBootstrap wraps every route) → <Navigate> with
    // state.notice 'signInRequired' (SessionBootstrap.tsx:288-301). One bootstrap refresh per load (300/60 s budget).
    const cases = [
      { slug: 'scr08_settings', path: ROUTES.project.settings(`e01-${RUN_TAG}`) },
      { slug: 'scr10_upload', path: ROUTES.project.upload(`e01-${RUN_TAG}`) },
      { slug: 'scr11_quality', path: ROUTES.project.quality(`e01-${RUN_TAG}`) },
      { slug: 'scr37_users', path: ROUTES.adminUsers },
      { slug: 'scr38_denied', path: ROUTES.accessDenied },
      { slug: 'scr39_unknown', path: UNKNOWN_PATH },
      { slug: 'scr40_demo', path: ROUTES.demoGallery },
    ] as const;
    const landed: Record<string, string> = {};
    // On a Vite dev stack /demo is a public dev route by design (paths.ts dev patterns): that row is prod-only.
    const prod = await isProdBuild(page.request);

    for (const { slug, path } of cases) {
      if (slug === 'scr40_demo' && !prod) {
        test.info().annotations.push({ type: 'skipped-row', description: 'scr40_demo: Vite dev stack, prod-only row' });
        continue;
      }
      await openWithBootstrap(page, path);
      await expect.poll(() => pathOf(page.url()), { message: slug }).toBe(loginUrl(path));
      await expect(h1(page, SIGN_IN_TITLE), slug).toBeVisible();
      await expect(alertWith(page, SIGN_IN_REQUIRED_NOTICE), slug).toBeVisible();
      await expect(page.getByRole('heading', { level: 1 }), `${slug}: the sign-in title is the only h1`).toHaveCount(1);
      landed[slug] = pathOf(page.url());
      await captureEvidence(page, `E01_gate_family_${slug}.png`, { caption: `requested ${path} → ${landed[slug]}` }); // BUG-102
    }
    await attachJson('E01_gate_family.json', landed);
  });

  test('E01 · SCR-01 · [mocked response] server unreachable at the gate: the retry ladder stops after 8 attempts; "online" mid-ladder adds nothing, "online" after it gives a fresh attempt → real 401 → /login', async ({ page }) => {
    // lib/auth/refresh.ts:325-357: each transient failure sets serverUnreachable and schedules the next try after
    // resolveRetryDelayMs (bootstrap.ts:88-109: 1, 2, 4 … s, capped 60 s) until transientAttempt reaches
    // REFRESH_MAX_TRANSIENT_ATTEMPTS = 8 (:46, 348-353); then nothing more is scheduled. f748afb0 (QA-01 debt #12):
    // window `online` / `focus` after the ladder is spent resets it and refreshes once — also while the status is
    // still `unknown`; mid-ladder they are ignored (:268-287). Network loss = mocked (unpairable: network loss);
    // page.clock runs the backoff. The gate shows "Mất kết nối máy chủ" meanwhile (SessionBootstrap.tsx:269-279).
    await page.clock.install();
    let mode: 'abort' | 'pass' = 'abort';
    let refreshes = 0;
    const matcher = (url: URL): boolean => url.pathname === REFRESH_PATH;
    const handler = async (route: Route): Promise<void> => {
      if (route.request().method() !== 'POST') return route.fallback();
      refreshes += 1;
      if (mode === 'abort') return route.abort('failed');
      return route.fallback();
    };
    await page.route(matcher, handler);

    try {
      await page.goto(ROUTES.dashboard, { waitUntil: 'commit' });
      await expect(h1(page, GATE_UNREACHABLE_TITLE)).toBeVisible();
      await expect.poll(() => refreshes, { message: 'bootstrap refresh' }).toBe(1);
      // The installed clock still flows in real time: freeze it before the 1 s retry is due, so only the
      // `online` path could send during the real wait below.
      await page.clock.pauseAt(await page.evaluate(() => Date.now() + 50));

      await page.evaluate(() => window.dispatchEvent(new Event('online')));
      await page.waitForTimeout(500);
      expect(refreshes, '"online" mid-ladder sends nothing').toBe(1);

      const deadline = Date.now() + 60_000;
      while (refreshes < REFRESH_MAX_TRANSIENT_ATTEMPTS && Date.now() < deadline) {
        await page.clock.runFor(2_000);
        await page.waitForTimeout(50);
      }
      expect(refreshes, 'attempts until the ladder is spent').toBe(REFRESH_MAX_TRANSIENT_ATTEMPTS);
      for (let step = 0; step < 10; step += 1) {
        await page.clock.runFor(20_000);
        await page.waitForTimeout(50);
      }
      expect(refreshes, 'no attempt scheduled after the 8th (200 s later)').toBe(REFRESH_MAX_TRANSIENT_ATTEMPTS);
      await page.clock.resume(); // time flows again (screenshots, the /login hero); nothing is scheduled any more
      await expect(h1(page, GATE_UNREACHABLE_TITLE)).toBeVisible();
      await attachJson('E01_gate_ladder_spent.json', { refreshes, fakeSecondsAfterLast: 200 });
      await captureEvidence(page, 'E01_gate_ladder_spent.png', {
        caption: [
          `POST ${REFRESH_PATH} attempts: ${refreshes} / ${REFRESH_MAX_TRANSIENT_ATTEMPTS} (all failed: network) — ladder spent`,
          '"online" mid-ladder: no extra attempt; 200 s (fake clock) after the last: nothing scheduled',
        ],
      }); // BUG-102
      expect(refreshes, 'still spent after resuming the clock').toBe(REFRESH_MAX_TRANSIENT_ATTEMPTS);

      mode = 'pass';
      const answered = waitForStatus(page, 'POST', REFRESH_API, [401]);
      await page.evaluate(() => window.dispatchEvent(new Event('online')));
      await answered;
      await expect.poll(() => pathOf(page.url())).toBe(loginUrl(ROUTES.dashboard));
      await expect(h1(page, SIGN_IN_TITLE)).toBeVisible();
      expect(refreshes, '"online" after the ladder → exactly one fresh attempt').toBe(REFRESH_MAX_TRANSIENT_ATTEMPTS + 1);
      await attachJson('E01_gate_online_recovers.json', { refreshes, landedUrl: pathOf(page.url()) });
      await captureEvidence(page, 'E01_gate_online_recovers.png', {
        caption: `"online" after the spent ladder → attempt ${refreshes} → real 401 → /login`,
      });
    } finally {
      await page.unroute(matcher, handler);
    }
  });

  test('E01 · SCR-02 · every field keeps room for its complaint: an empty submit and an invalid address in the forgot panel move neither the next field nor the buttons; no collapsed-state control; no request', async ({ page }) => {
    // f748afb0: FIELD_ERROR_SLOT (RecoveryShell.tsx, min-h 124 px from sm since BUG-073, was 112) on both sign-in boxes and on the
    // panel box (AuthScreen.tsx:127-157; ForgotPasswordPanel.tsx:65-70), no `gap` between them — the reserved room is
    // the spacing, so a complaint appearing moves nothing (BUG-008). Empty submit → both "chưa nhập"
    // (useAuthScreen.ts:613-635); panel submit → emailInvalid (useForgotPassword.ts:94-106). `collapsed` needs a host
    // calling setCollapsed — none does (AuthScreen.tsx:316-321, 334-342) → "Mở lại biểu mẫu" never rendered.
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await openAnonymousLogin(page);
    await animationsSettled(page);
    const requests = recordApiRequests(page);

    try {
      await expect(button(page, EXPAND_FORM), 'collapsed state unreachable').toHaveCount(0);
      const signInParts = [
        ['Mật khẩu', passwordBox(page)],
        ['Ghi nhớ máy này', rememberBox(page)],
        ['Đăng nhập', button(page, SIGN_IN_LABEL)],
        ['Quên mật khẩu', button(page, FORGOT_PASSWORD)],
      ] as const;
      const before = await tops(signInParts);
      await emailBox(page).press('Enter');
      await expect(emailBox(page)).toHaveAccessibleDescription(EMAIL_REQUIRED);
      await expect(passwordBox(page)).toHaveAccessibleDescription(PASSWORD_REQUIRED);
      const after = await tops(signInParts);
      expectSameTops(before, after, 'sign-in empty submit');
      await captureEvidence(page, 'E01_field_room_login.png');

      await openForgotByKeyboard(page);
      await animationsSettled(page);
      const panelParts = [
        ['Gửi thư đặt lại mật khẩu', button(page, SEND_RESET_LINK)],
        ['Quay lại đăng nhập', button(page, BACK_TO_SIGN_IN)],
      ] as const;
      const panelBefore = await tops(panelParts);
      await emailBox(page).fill('khong-hop-le');
      await emailBox(page).press('Enter');
      await expect(emailBox(page)).toHaveAccessibleDescription(EMAIL_INVALID);
      const panelAfter = await tops(panelParts);
      expectSameTops(panelBefore, panelAfter, 'forgot panel invalid address');
      await nextFrame(page);
      expect(posts(requests.sent, LOGIN_API)).toEqual([]);
      expect(posts(requests.sent, PASSWORD_RESET_API)).toEqual([]);
      await attachJson('E01_field_room_login.json', { before, after, panelBefore, panelAfter, requests: requests.sent.length });
      await captureEvidence(page, 'E01_field_room_forgot.png');
    } finally {
      requests.stop();
    }
  });

  test('E01 · SCR-03 / SCR-04 · Enter on the empty recovery form → every "chưa nhập" complaint, the submit button (and the reset form\'s "Về trang đăng nhập") do not move; no collapsed-state control; no request', async ({ page }) => {
    // f748afb0 (4b714af4): FIELD_ERROR_SLOT / _THREE_LINES on every box, no gap (InvitationAccept.tsx:118-158,
    // PasswordReset.tsx:93-120, RecoveryShell.tsx:41-54). Submit validates before the port
    // (useInvitationAccept.ts:187-211, usePasswordReset.ts:145-165). `collapsed` only with a host's isCollapsed —
    // the routes pass none (InvitationAccept.container.tsx:51, PasswordReset.container.tsx:37).
    await page.emulateMedia({ reducedMotion: 'reduce' });
    const requests = recordApiRequests(page);

    try {
      for (const form of RECOVERY_FORMS) {
        await openRecoveryForm(page, form, `room-${form.slug}`);
        await animationsSettled(page);
        await expect(button(page, EXPAND_FORM), `${form.slug}: collapsed state unreachable`).toHaveCount(0);
        const parts: (readonly [string, Locator])[] = [[form.submit, button(page, form.submit)]];
        if (form.slug === 'reset') parts.push([GO_TO_SIGN_IN, page.getByRole('link', { name: GO_TO_SIGN_IN, exact: true })]);
        const before = await tops(parts);

        await page.keyboard.press('Enter'); // the first box is autofocused (InvitationAccept.tsx:126, PasswordReset.tsx:101)
        await expect(page.getByLabel(CONFIRM_PASSWORD_LABEL, { exact: true })).toHaveAccessibleDescription('Chưa nhập lại mật khẩu.');
        await expect(page.getByLabel(form.passwordLabel, { exact: true })).toHaveAccessibleDescription(PASSWORD_REQUIRED);
        const after = await tops(parts);
        expectSameTops(before, after, `${form.slug} empty submit`);
        await attachJson(`E01_field_room_${form.slug}.json`, { before, after });
        await captureEvidence(page, `E01_field_room_${form.slug}.png`);
      }
      await nextFrame(page);
      expect(posts(requests.sent, INVITATION_ACCEPT_API)).toEqual([]);
      expect(posts(requests.sent, PASSWORD_RESET_CONFIRM_API)).toEqual([]);
    } finally {
      requests.stop();
    }
  });

  test('E01 · SCR-03 / SCR-04 · Ctrl+click on "Về trang đăng nhập" is left to the browser (new tab on /login), the page itself stays; a plain click is the in-app navigation', async ({ page }) => {
    // f748afb0: RecoveryLink handles only a plain primary click; with Ctrl/Meta/Shift/Alt it does not
    // preventDefault, so the browser opens the href itself (RecoveryShell.tsx:77-96, QA-01b debt #10).
    const opened: Record<string, string> = {};

    for (const [slug, path] of [['invite', ROUTES.invitationAccept], ['reset', ROUTES.passwordReset]] as const) {
      await openWithBootstrap(page, path);
      await expect(authMain(page, 'forbidden')).toBeVisible();
      const link = page.getByRole('link', { name: GO_TO_SIGN_IN, exact: true });
      const popup = page.context().waitForEvent('page');
      await link.click({ modifiers: ['Control'] });
      const tab = await popup;
      try {
        await expect.poll(() => pathOf(tab.url()), { message: `${slug}: new tab` }).toBe(ROUTES.login);
        await expect(h1(tab, SIGN_IN_TITLE)).toBeVisible();
        opened[slug] = pathOf(tab.url());
      } finally {
        await tab.close();
      }
      expect(pathOf(page.url()), `${slug}: this tab did not navigate`).toBe(path);
      await expect(authMain(page, 'forbidden')).toBeVisible();
      await captureEvidence(page, `E01_recovery_link_ctrl_${slug}.png`);
    }

    await page.getByRole('link', { name: GO_TO_SIGN_IN, exact: true }).click();
    await expect.poll(() => pathOf(page.url())).toBe(ROUTES.login);
    await expect(h1(page, SIGN_IN_TITLE)).toBeVisible();
    await attachJson('E01_recovery_link_ctrl.json', { newTabs: opened, plainClickLanded: pathOf(page.url()) });
  });

  test('E01 · SCR-02 × SCR-41 · "?" typed in "Thư điện tử" stays text; "?" on the focused "Quay lại đăng nhập" opens "Phím tắt" over the forgot panel; Esc closes ONLY the help (focus back), the next Esc goes back to sign-in; no request', async ({ page }) => {
    // router.tsx UndoShortcuts wraps EVERY route, /login included, and binds `?` → GlobalShortcutHelp (lazy) and
    // Escape → closeTopLayer. Nothing fires while focus is in an INPUT (shortcutRegistry.ts:23-26;
    // lib/tools/shortcuts.ts:189-209). The open help is a `dialog`-scope layer with a focus trap
    // (GlobalShortcutHelp.tsx:98-131) that hands focus back to its opener (focusTrap.ts:137-143, 184-193) — so the
    // first Esc closes the top layer only (A12); the second reaches the panel's own Esc = back (ForgotPasswordPanel.tsx:44-53).
    await openAnonymousLogin(page);
    const requests = recordApiRequests(page);
    const help = page.getByRole('dialog', { name: SHORTCUT_HELP_TITLE, exact: true });

    try {
      await emailBox(page).focus();
      await page.keyboard.press('?');
      await expect(emailBox(page)).toHaveValue('?');
      await expect(help, '"?" while typing is text').toHaveCount(0);
      await emailBox(page).fill('');

      await openForgotByKeyboard(page);
      await button(page, BACK_TO_SIGN_IN).focus();
      await page.keyboard.press('?');
      await expect(help).toBeVisible();
      await expect(h1(page, FORGOT_PASSWORD)).toBeVisible();
      await captureEvidence(page, 'E01_login_shortcut_help.png');

      await page.keyboard.press('Escape');
      await expect(help).toBeHidden();
      await expect(h1(page, FORGOT_PASSWORD), 'the panel under the help stays').toBeVisible();
      await expect(button(page, BACK_TO_SIGN_IN), 'focus back on the opener').toBeFocused();
      await captureEvidence(page, 'E01_login_shortcut_help_closed.png');

      await page.keyboard.press('Escape');
      await expect(h1(page, SIGN_IN_TITLE)).toBeVisible();
      await nextFrame(page);
      const writes = requests.sent.filter((line) => line.startsWith('POST ') && line !== `POST ${REFRESH_PATH}`);
      expect(writes, 'no POST besides session refreshes').toEqual([]);
      await attachJson('E01_login_shortcut_help.json', { apiRequests: requests.sent });
    } finally {
      requests.stop();
    }
  });

  test('E01 · SCR-02 forgot panel · [mocked response] 429 with Retry-After 120 → send stays locked past 60 s (recovery honours a LONGER Retry-After, unlike sign-in), unlocks after 120 s and the strip goes', async ({ page }) => {
    // lib/http/client.ts:495-503 reads Retry-After (capped at MAX_RETRY_AFTER_DELAY_MS 120 s, retry.ts:7, 28-31 — so
    // 120 is the longest a server can ask for); classifyRecoveryFailure: rateLimited seconds = max(Retry-After,
    // RECOVERY_LOCKOUT_SECONDS 60) (recoveryShared.ts:136, 158-163) → lock (useForgotPassword.ts:136-138) → canSubmit false (:158), submit()
    // returns while locked (:88); the 429 strip goes when the lock ends (:148). Sign-in ignores Retry-After (60 s
    // flat, useAuthScreen.ts:685-687 — "429 → … whatever Retry-After says" above). IP-wide 429 = mocked
    // (unpairable on the shared stack: the recovery limit is per IP, 10 / 900 s).
    await page.clock.install();
    const reset = await mockPost(page, PASSWORD_RESET_API, wire(429, { code: 'RATE_LIMITED' }, { 'Retry-After': '120' }));

    try {
      await openAnonymousLogin(page);
      await openForgotByKeyboard(page);
      await emailBox(page).fill(nobody('f429long'));
      await button(page, SEND_RESET_LINK).click();
      await expect(page.getByText(TOO_MANY_RECOVERY, { exact: true })).toBeVisible();
      await expect(button(page, SEND_RESET_LINK)).toBeDisabled();

      await page.clock.runFor(70_000);
      await expect(button(page, SEND_RESET_LINK), 'still locked 70 s later').toBeDisabled();
      await expect(page.getByText(TOO_MANY_RECOVERY, { exact: true })).toBeVisible();
      await emailBox(page).press('Enter');
      expect(reset.seen, 'nothing sent while locked').toHaveLength(1);
      await captureEvidence(page, 'E01_forgot_429_long_locked.png');

      await page.clock.runFor(52_000);
      await expect(button(page, SEND_RESET_LINK)).toBeEnabled();
      await expect(page.getByText(TOO_MANY_RECOVERY, { exact: true })).toHaveCount(0);
      expect(reset.seen).toHaveLength(1);
      await attachJson('E01_forgot_429_long.json', { retryAfter: 120, lockedAt70s: true, requests: reset.seen.length });
      await captureEvidence(page, 'E01_forgot_429_long_unlocked.png');
    } finally {
      await reset.stop();
    }
  });

  test('E01 · SCR-04 → SCR-02 · [mocked response] reset 204 but the logout cannot reach the server → still /login with "Đã đổi mật khẩu…" UNDER "Đăng nhập" (local sign-out is enough)', async ({ page }) => {
    // usePasswordReset.ts:172-185: on 204 → `try { await port.endLocalSession() } finally { navigate('/login',
    // {replace, state:{notice:'passwordReset'}}) }`; endLocalSession = signOut (PasswordReset.container.tsx:30),
    // whose revoke POST swallows a network failure (lib/auth/session.ts:199-208). /login: noticeOf →
    // INITIAL_NOTICES.passwordReset (AuthScreen.container.tsx:278-285, useAuthScreen.ts:345-349), drawn under the
    // submit button since f748afb0 (AuthScreen.tsx:174-190). Confirm 204 mocked (paired: A01 real Mailpit reset
    // 204); logout network loss mocked (unpairable: network loss). The admin is never touched.
    const confirm = await mockPost(page, PASSWORD_RESET_CONFIRM_API, noContent);
    const logout = await mockPost(page, LOGOUT_PATH, networkDown);

    try {
      await openRecoveryForm(page, recoveryForm('reset'), 'logout-offline');
      await recoveryForm('reset').fillValid(page);
      await button(page, SET_NEW_PASSWORD).click();

      await expect.poll(() => pathOf(page.url()), { message: 'lands on /login despite the failed logout' }).toBe(ROUTES.login);
      await expect(h1(page, SIGN_IN_TITLE)).toBeVisible();
      const notice = alertWith(page, PASSWORD_RESET_NOTICE);
      await expect(notice).toBeVisible();
      const noticeTop = (await notice.boundingBox())?.y ?? Number.NaN;
      const submitBox = await button(page, SIGN_IN_LABEL).boundingBox();
      expect(noticeTop, '"Đã đổi mật khẩu…" under "Đăng nhập"').toBeGreaterThanOrEqual(submitBox!.y + submitBox!.height);
      expect(confirm.seen).toHaveLength(1);
      expect(logout.seen.length, 'the revoke was attempted').toBeGreaterThanOrEqual(1);
      await attachJson('E01_reset_logout_offline.json', {
        confirmRequests: confirm.seen.length,
        logoutAttempts: logout.seen.length,
        landed: pathOf(page.url()),
      });
      await captureEvidence(page, 'E01_reset_logout_offline.png');
    } finally {
      await confirm.stop();
      await logout.stop();
    }
  });

  test.describe('375×812', () => {
    test.skip(({ viewport }) => isPhoneOutOfScope(viewport), PHONE_OUT_OF_SCOPE);
    test.use({ viewport: COMPACT });

    test('E01 · 375×812 · /login uses 24 px side margins (BUG-052); the longest two-line complaint (bad address) + "Chưa nhập mật khẩu." move neither the password box nor "Đăng nhập"; no request', async ({ page }) => {
      // AuthScreen.tsx:309-314: column `px-6 … sm:px-12` (24 px below 640, like RecoveryShell); FIELD_ERROR_SLOT is
      // `min-h-[132px]` below 640 (BUG-073, was 120) = room for a two-line complaint in a ~258 px column (RecoveryShell.tsx).
      await page.emulateMedia({ reducedMotion: 'reduce' });
      await openAnonymousLogin(page);
      await animationsSettled(page);
      const requests = recordApiRequests(page);

      try {
        const column = page.locator('main[data-auth-state] > div');
        const padding = await column.evaluate((element) => {
          const style = getComputedStyle(element);
          return { left: style.paddingLeft, right: style.paddingRight };
        });
        expect(padding, '/login side margins below 640').toEqual({ left: '24px', right: '24px' });
        const titleBox = await h1(page, SIGN_IN_TITLE).boundingBox();
        expect(titleBox, 'title box').not.toBeNull();
        expect(Math.round(titleBox!.x), 'title starts at the 24 px margin').toBe(24);

        const parts = [
          ['Mật khẩu', passwordBox(page)],
          ['Đăng nhập', button(page, SIGN_IN_LABEL)],
        ] as const;
        const before = await tops(parts);
        await emailBox(page).fill('khong-hop-le');
        await emailBox(page).press('Enter');
        await expect(emailBox(page)).toHaveAccessibleDescription(EMAIL_INVALID);
        await expect(passwordBox(page)).toHaveAccessibleDescription(PASSWORD_REQUIRED);
        const after = await tops(parts);
        expectSameTops(before, after, '375 complaints');
        expect(await horizontalOverflow(page), 'horizontal overflow (px)').toBeLessThanOrEqual(0);
        await nextFrame(page);
        expect(posts(requests.sent, LOGIN_API)).toEqual([]);
        await attachJson('E01_compact_login_margins_375.json', { padding, before, after });
        await captureEvidence(page, 'E01_compact_login_margins_375.png', { fullPage: true });
      } finally {
        requests.stop();
      }
    });
  });
});
