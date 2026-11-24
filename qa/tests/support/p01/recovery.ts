/**
 * Phase 1 helpers shared by the `phase01_*` specs (SCR-03 preview, prod-build gate). Phase 1 only.
 */
import { test, type APIRequestContext, type Page, type Route } from '@playwright/test';

/** `src/api/endpoints.ts:91` under the `/api` base. */
export const INVITATION_PREVIEW_API = '/api/auth/invitations/preview';

/**
 * Since 147c9620 (G2-9/G2-10) SCR-03 checks the `#token=` with `POST /api/auth/invitations/preview` BEFORE it
 * shows the form (useInvitationAccept.ts:172-212): a fake token gets the real 422 INVITATION_TOKEN_INVALID →
 * dead-end, so the form never opens. Tests that need the FORM with a fake token answer that ONE call with a
 * valid preview (`InvitationPreviewSchema`, src/api/schemas/auth.ts:80-88) — [mocked preview]; the accept
 * request is untouched. It also keeps fake tokens off the shared recovery IP bucket (the preview spends it,
 * BE:apps/api/auth_recovery/router.py:475). Call before the page loads the invitation URL.
 */
export async function mockInvitationPreview(page: Page): Promise<Route[]> {
  const seen: Route[] = [];
  await page.route(
    (url) => url.pathname === INVITATION_PREVIEW_API,
    (route) => {
      if (route.request().method() !== 'POST') return route.fallback();
      seen.push(route);
      return route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          email: 'qa-preview@example.test',
          expiresAt: new Date(Date.now() + 86_400_000).toISOString(),
          role: 'viewer',
          status: 'valid',
        }),
      });
    },
  );
  return seen;
}

/** A production build serves an index.html that references `/assets/*.js`; Vite dev serves `/src/main.tsx`. */
export async function isProdBuild(request: APIRequestContext): Promise<boolean> {
  const html = await (await request.get('/')).text();
  return /["']\/assets\/[^"']+\.js["']/u.test(html);
}

/**
 * Prod-only rows (dev routes → NotFound / gate, lazy chunks under /assets) mean nothing on a Vite dev stack,
 * where the dev routes exist by design (router.tsx DEV_ONLY_ROUTES). Skip with the reason instead of a red.
 */
export async function skipUnlessProdBuild(request: APIRequestContext): Promise<void> {
  test.skip(!(await isProdBuild(request)), 'environment: the stack serves the Vite dev build, not the prod build');
}

/** Owner decision (2026-10): the web app is desktop + tablet only — QA 1920/1440/1024/768, no 375 phone rows. */
export const PHONE_OUT_OF_SCOPE = 'out of scope: web is desktop + tablet only (1920/1440/1024/768), no 375×812 rows';

/** Below this width a viewport is a phone (the app's `sm` breakpoint). */
export const PHONE_MAX_WIDTH = 640;

/** Flip to `true` when the owner puts phone rows back in scope: every phone-viewport skip below then lifts. */
export const PHONE_ROWS_IN_SCOPE = false;

/** True when `viewport` is a phone width and phone rows are out of scope — use as `test.skip(<this>, PHONE_OUT_OF_SCOPE)`. */
export function isPhoneOutOfScope(viewport: { width: number } | null | undefined): boolean {
  return !PHONE_ROWS_IN_SCOPE && viewport !== null && viewport !== undefined && viewport.width < PHONE_MAX_WIDTH;
}
