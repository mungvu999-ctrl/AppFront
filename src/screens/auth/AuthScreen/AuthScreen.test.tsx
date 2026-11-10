import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, describe, expect, it, vi } from 'vitest';

import viMessages from '@/i18n/vi.json';
import { findPositiveTabIndexes } from '@/lib/input/focusOrder';
import { durationMs } from '@/lib/motion';
import { expectAccessible } from '@/lib/testing/expectAccessible';
import { expectNoRawColor } from '@/lib/testing/expectNoRawColor';
import { expectSevenStates } from '@/lib/testing/expectSevenStates';
import { expectVietnamese } from '@/lib/testing/expectVietnamese';
import { createSevenStateScenarios, type SevenState } from '@/lib/testing/sevenStateScenarios';

import { ROUTES } from '@/routes/paths';

import { FIELD_ERROR_SLOT } from '../RecoveryShell';
import { AuthScreen, AuthScreenView, type AuthScreenViewProps } from './AuthScreen';
import { AuthRoute, createHttpAuthGateway, safeDestination } from './AuthScreen.container';
import { MIN_PASSWORD_LENGTH, type AuthGateway } from './useAuthScreen';
import type { ForgotPasswordModel } from './useForgotPassword';

const AUTH_MESSAGES = viMessages.auth;

/* -------------------------------------------------------------------------- */
/* Fixtures.                                                                   */
/* -------------------------------------------------------------------------- */

const EMAIL = 'thu.ha@vidu.vn';
const PASSWORD = 'khong-doan-duoc';

const UNAUTHORIZED_STATUS = 401;
const FORBIDDEN_STATUS = 403;
const TOO_MANY_REQUESTS_STATUS = 429;

/** A wire failure the way `src/lib/http` shapes it: status and `code` at the top, the body under `raw`. */
function httpFailure(status: number, code?: string, extra: Record<string, unknown> = {}) {
  return {
    ok: false as const,
    error: {
      kind: 'http',
      status,
      ...(code !== undefined ? { code } : {}),
      retryable: false,
      requestId: 'req-test',
      raw: null,
      ...extra,
    },
  };
}

const forgotBase: ForgotPasswordModel = {
  email: '',
  problem: undefined,
  notice: null,
  sentMessage: null,
  isSending: false,
  isSent: false,
  hasFailure: false,
  canSubmit: true,
  canResend: false,
  resendLabel: 'Gửi lại thư',
};

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

const noop = (): void => undefined;

/**
 * Every prop the view takes, at rest.
 *
 * Written out rather than generated: the point of the seven-state check is that
 * a state is described exactly, and a fixture that filled the gaps in would let
 * a scenario pass while describing nothing in particular.
 */
function baseProps(): AuthScreenViewProps {
  return {
    state: 'empty',
    panel: 'signIn',
    forgot: forgotBase,
    isCollapsed: false,
    isSubmitting: false,
    values: { email: '', password: '', rememberMe: false },
    problems: {},
    notice: null,
    canSubmit: true,
    submitLabel: AUTH_MESSAGES.actions.signIn,
    isBlocked: false,
    setEmail: noop,
    setPassword: noop,
    setRememberMe: noop,
    blurField: noop,
    setCollapsed: noop,
    submit: noop,
    ssoSignIn: noop,
    forgotPassword: noop,
    closeForgotPassword: noop,
    signInWithAnotherAccount: noop,
    forgotActions: { setEmail: noop, submit: noop, resend: noop, reset: noop },
  };
}

/** A gateway whose two calls are spies, refusing by default in the way asked for. */
function stubGateway(reply: Awaited<ReturnType<AuthGateway['signIn']>> = { ok: true, data: undefined }): {
  readonly gateway: AuthGateway;
  readonly signIn: ReturnType<typeof vi.fn<AuthGateway['signIn']>>;
  readonly requestPasswordReset: ReturnType<typeof vi.fn<AuthGateway['requestPasswordReset']>>;
} {
  const signIn = vi.fn<AuthGateway['signIn']>(async () => reply);
  const requestPasswordReset = vi.fn<AuthGateway['requestPasswordReset']>(async () => reply);

  return {
    gateway: { signIn, requestPasswordReset },
    signIn,
    requestPasswordReset,
  };
}

/** The screen with its logic attached, over a stub transport. */
function renderScreen(
  options: {
    readonly gateway?: AuthGateway;
    readonly onAuthenticated?: () => void;
    readonly onSsoSignIn?: () => void;
    readonly initialNotice?: 'passwordReset' | 'sessionEnded';
    readonly reducedMotion?: boolean;
  } = {},
) {
  const fallback = stubGateway();

  return render(
    <AuthScreen
      gateway={options.gateway ?? fallback.gateway}
      onAuthenticated={options.onAuthenticated ?? noop}
      {...(options.onSsoSignIn !== undefined ? { onSsoSignIn: options.onSsoSignIn } : {})}
      {...(options.initialNotice !== undefined ? { initialNotice: options.initialNotice } : {})}
      reducedMotion={options.reducedMotion ?? true}
    />,
  );
}

function emailField(): HTMLInputElement {
  return screen.getByLabelText(AUTH_MESSAGES.fields.email);
}

function passwordField(): HTMLInputElement {
  return screen.getByLabelText(AUTH_MESSAGES.fields.password);
}

function submitButton(): HTMLButtonElement {
  return screen.getByRole('button', { name: AUTH_MESSAGES.actions.signIn });
}

/** Types into a controlled field the way a person would. */
function type(field: HTMLInputElement, value: string): void {
  fireEvent.change(field, { target: { value } });
}

/* -------------------------------------------------------------------------- */
/* The seven states (invariant A11).                                           */
/* -------------------------------------------------------------------------- */

/** One props object per state, keyed so a missing state cannot hide. */
const PROPS_BY_STATE: Readonly<Record<SevenState, () => AuthScreenViewProps>> = {
  empty: () => baseProps(),
  loading: () => ({
    ...baseProps(),
    state: 'loading',
    isSubmitting: true,
    canSubmit: false,
    values: { email: EMAIL, password: PASSWORD, rememberMe: false },
  }),
  partial: () => ({
    ...baseProps(),
    state: 'partial',
    values: { email: EMAIL, password: '', rememberMe: false },
  }),
  error: () => ({
    ...baseProps(),
    state: 'error',
    values: { email: EMAIL, password: PASSWORD, rememberMe: false },
    notice: {
      tone: 'violation',
      title: AUTH_MESSAGES.errors.invalidCredentials.title,
      message: AUTH_MESSAGES.errors.invalidCredentials.description,
    },
  }),
  success: () => ({
    ...baseProps(),
    state: 'success',
    canSubmit: false,
    notice: { tone: 'verified', message: AUTH_MESSAGES.notices.success },
  }),
  forbidden: () => ({
    ...baseProps(),
    state: 'forbidden',
    isBlocked: true,
    canSubmit: false,
    notice: {
      tone: 'attention',
      title: AUTH_MESSAGES.errors.accountDisabled.title,
      message: AUTH_MESSAGES.errors.accountDisabled.description,
    },
  }),
  collapsed: () => ({ ...baseProps(), state: 'collapsed', isCollapsed: true }),
};

describe('AuthScreenView — the seven states', () => {
  it('renders all seven states, and not one of them comes out blank', () => {
    expect(() => {
      expectSevenStates(
        (scenario) => render(<AuthScreenView {...PROPS_BY_STATE[scenario.state]()} />),
        createSevenStateScenarios(),
      );
    }).not.toThrow();
  });

  it('puts the current state on a data attribute rather than reading it aloud', () => {
    for (const state of Object.keys(PROPS_BY_STATE) as SevenState[]) {
      const { container, unmount } = render(<AuthScreenView {...PROPS_BY_STATE[state]()} />);

      expect(container.querySelector('main')).toHaveAttribute('data-auth-state', state);
      unmount();
    }
  });

  it('drops the form entirely when the account is disabled, leaving a strip in its place', () => {
    render(<AuthScreenView {...PROPS_BY_STATE.forbidden()} />);

    expect(screen.queryByLabelText(AUTH_MESSAGES.fields.email)).toBeNull();
    expect(screen.getByRole('alert')).toHaveTextContent(AUTH_MESSAGES.errors.accountDisabled.title);
  });

  it('offers a way out of the disabled-account strip (BUG-017)', () => {
    const signInWithAnotherAccount = vi.fn();
    render(<AuthScreenView {...PROPS_BY_STATE.forbidden()} signInWithAnotherAccount={signInWithAnotherAccount} />);
    fireEvent.click(screen.getByRole('button', { name: 'Đăng nhập bằng tài khoản khác' }));

    expect(signInWithAnotherAccount).toHaveBeenCalledTimes(1);
  });

  it('collapses to one sentence and a button that opens it again', () => {
    render(<AuthScreenView {...PROPS_BY_STATE.collapsed()} />);

    expect(screen.queryByLabelText(AUTH_MESSAGES.fields.email)).toBeNull();
    expect(screen.getByRole('button', { name: AUTH_MESSAGES.actions.expand })).toBeInTheDocument();
  });
});

/* -------------------------------------------------------------------------- */
/* Wording and tokens.                                                         */
/* -------------------------------------------------------------------------- */

describe('AuthScreenView — a strip never pushes the form down (BUG-008)', () => {
  const follows = (first: Element, second: Element): boolean =>
    (first.compareDocumentPosition(second) & Node.DOCUMENT_POSITION_FOLLOWING) !== 0;

  it.each(['error', 'success'] as const)('puts the %s strip under the sign-in button', (state) => {
    render(<AuthScreenView {...PROPS_BY_STATE[state]()} />);

    const button = screen.getByRole('button', { name: AUTH_MESSAGES.actions.signIn });

    expect(follows(button, screen.getByRole('alert'))).toBe(true);
    expect(follows(screen.getByLabelText(AUTH_MESSAGES.fields.email), button)).toBe(true);
  });

  it('offers one way to recover from a wrong password: the "Quên mật khẩu" link, no second button (BUG-090)', () => {
    render(<AuthScreenView {...PROPS_BY_STATE.error()} />);

    expect(screen.queryByRole('button', { name: 'Đặt lại mật khẩu' })).toBeNull();
    expect(screen.getAllByRole('button', { name: AUTH_MESSAGES.actions.forgotPassword })).toHaveLength(1);
  });

  it('puts an opening sentence under the button too, so it going away on submit moves nothing (nợ #19)', () => {
    render(
      <AuthScreenView
        {...baseProps()}
        notice={{ tone: 'attention', message: AUTH_MESSAGES.notices.sessionEnded }}
      />,
    );

    const signIn = screen.getByRole('button', { name: AUTH_MESSAGES.actions.signIn });

    expect(follows(signIn, screen.getByRole('alert'))).toBe(true);
  });

  it('puts the signed-in strip under the button, its way back full width right under it (BUG-058, BUG-059)', () => {
    render(
      <AuthScreenView
        {...baseProps()}
        notice={{
          tone: 'attention',
          message: AUTH_MESSAGES.notices.signedIn,
          action: { label: AUTH_MESSAGES.actions.goToProjects, onClick: noop },
        }}
      />,
    );

    const signIn = screen.getByRole('button', { name: AUTH_MESSAGES.actions.signIn });
    const back = screen.getByRole('button', { name: AUTH_MESSAGES.actions.goToProjects });
    const strip = screen.getByRole('alert');

    expect(follows(signIn, strip)).toBe(true);
    expect(follows(strip, back)).toBe(true);
    // In the strip's own group, edge to edge, the height of "Đăng nhập" — not a small button off on its own.
    expect(back.parentElement).toBe(strip.parentElement);
    expect(back).toHaveClass('w-full', 'h-11', 'sm:h-10');
  });

  it('keeps room for a two-line complaint under each field, so one appearing pushes nothing (nợ #15)', () => {
    const slotOf = (name: string): HTMLElement | null =>
      screen.getByText(name, { selector: 'label' }).parentElement;
    const names = [AUTH_MESSAGES.fields.email, AUTH_MESSAGES.fields.password];

    const { rerender } = render(<AuthScreenView {...baseProps()} />);

    for (const name of names) {
      expect(slotOf(name)).toHaveClass(FIELD_ERROR_SLOT);
    }

    rerender(
      <AuthScreenView
        {...baseProps()}
        problems={{ email: AUTH_MESSAGES.problems.emailInvalid, password: AUTH_MESSAGES.problems.passwordRequired }}
      />,
    );

    for (const name of names) {
      expect(slotOf(name)).toHaveClass(FIELD_ERROR_SLOT);
    }
    // No gap between the slots: the reserved room is the spacing, so it is not paid for twice.
    expect(slotOf(AUTH_MESSAGES.fields.email)?.parentElement).not.toHaveClass('gap-4');
  });

  it('wraps a complaint across the full field, no lone last word, not balanced into a narrow column (BUG-057, BUG-073)', () => {
    render(<AuthScreenView {...baseProps()} problems={{ email: AUTH_MESSAGES.problems.emailTooLong }} />);

    const complaint = screen.getByText(AUTH_MESSAGES.problems.emailTooLong);
    expect(complaint).toHaveClass('text-pretty');
    expect(complaint).not.toHaveClass('text-balance');
  });

  it('gives the text actions a 44 px target under 640 and 24 px from sm, without a bigger font (BUG-041)', () => {
    const TARGET = ['inline-flex', 'items-center', 'min-h-11', 'fine:min-h-6'];
    const { rerender } = render(<AuthScreenView {...baseProps()} />);
    expect(screen.getByRole('button', { name: AUTH_MESSAGES.actions.forgotPassword })).toHaveClass(...TARGET, 'text-[13px]');

    rerender(<AuthScreenView {...baseProps()} panel="forgotPassword" forgot={forgotBase} />);
    expect(screen.getByRole('button', { name: AUTH_MESSAGES.actions.backToSignIn })).toHaveClass(...TARGET, 'text-[13px]');
  });

  it('puts the forgot panel\'s strip and "đã gửi" block under its send button (nợ #18)', () => {
    render(
      <AuthScreenView
        {...baseProps()}
        panel="forgotPassword"
        forgot={{
          ...forgotBase,
          email: EMAIL,
          notice: { tone: 'violation', message: AUTH_MESSAGES.errors.recoveryFailed },
          sentMessage: AUTH_MESSAGES.forgotPassword.sent,
        }}
      />,
    );

    const send = screen.getByRole('button', { name: AUTH_MESSAGES.actions.sendResetLink });

    expect(follows(screen.getByLabelText(AUTH_MESSAGES.fields.email), send)).toBe(true);
    expect(follows(send, screen.getByRole('alert'))).toBe(true);
    expect(follows(send, screen.getByText(AUTH_MESSAGES.forgotPassword.sent))).toBe(true);
    expect(screen.getByText(AUTH_MESSAGES.fields.email, { selector: 'label' }).parentElement).toHaveClass(
      FIELD_ERROR_SLOT,
    );
  });

  it('says "còn thiếu mật khẩu" under the button, not over the field being typed in', () => {
    render(<AuthScreenView {...PROPS_BY_STATE.partial()} />);

    expect(
      follows(
        screen.getByRole('button', { name: AUTH_MESSAGES.actions.signIn }),
        screen.getByText(AUTH_MESSAGES.notices.partial),
      ),
    ).toBe(true);
  });
});

describe('AuthScreenView — wording and colour', () => {
  it('writes every visible string in Vietnamese, diacritics and all', () => {
    for (const state of Object.keys(PROPS_BY_STATE) as SevenState[]) {
      const { container, unmount } = render(<AuthScreenView {...PROPS_BY_STATE[state]()} />);

      expect(() => {
        expectVietnamese(container);
      }).not.toThrow();
      unmount();
    }
  });

  it('capitalises the first letter of every label (A6), typed out rather than read back from vi.json', () => {
    renderScreen();

    expect(screen.getByRole('heading', { name: 'Đăng nhập để tiếp tục dự án' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Đăng nhập' })).toBeInTheDocument();
    expect(screen.getByLabelText('Thư điện tử')).toBeInTheDocument();
    expect(screen.getByLabelText('Mật khẩu')).toBeInTheDocument();
  });

  it('UX-34: ô email tự nhận tiêu điểm giữ vòng accent tới khi rời ô', () => {
    renderScreen();

    const email = screen.getByLabelText('Thư điện tử');
    expect(document.activeElement).toBe(email);
    expect(email).toHaveAttribute('data-auto-focus-ring', 'true');
    fireEvent.blur(email);
    expect(email).not.toHaveAttribute('data-auto-focus-ring');
  });

  it('holds no raw colour in any of the three source files', () => {
    expect(() => {
      expectNoRawColor('src/screens/auth/AuthScreen/AuthScreen.tsx');
      expectNoRawColor('src/screens/auth/AuthScreen/useAuthScreen.ts');
      expectNoRawColor('src/screens/auth/AuthScreen/AuthScreen.container.tsx');
    }).not.toThrow();
  });
});

/* -------------------------------------------------------------------------- */
/* Accessibility.                                                              */
/* -------------------------------------------------------------------------- */

describe('AuthScreenView — accessibility', () => {
  /**
   * R-72, run over all seven states rather than the empty one alone.
   *
   * The other six are where this breaks: fields disabled mid-send, the form gone
   * when the account is disabled, a strip standing where the inputs were. Each
   * one is a different element tree, so each one has to hold up on its own.
   *
   * Contrast is not measured here. jsdom cannot resolve `var(--…)`, and
   * `requireResolvedContrast` is left at its default of off, so this pass checks
   * names, labels and the keyboard path. Colour is `expectNoRawColor`'s job and
   * the token set's.
   */
  it('keeps every state usable by keyboard and readable by a screen reader', () => {
    for (const state of Object.keys(PROPS_BY_STATE) as SevenState[]) {
      const { container, unmount } = render(<AuthScreenView {...PROPS_BY_STATE[state]()} />);

      expect(() => {
        expectAccessible(container);
      }, `state: ${state}`).not.toThrow();
      unmount();
    }
  });

  it('has one h1, the name of the panel, and the hero is not a heading (BUG-047)', () => {
    for (const [panel, name] of [
      ['signIn', AUTH_MESSAGES.tabs.signIn],
      ['forgotPassword', AUTH_MESSAGES.forgotPassword.title],
    ] as const) {
      const { unmount } = render(<AuthScreenView {...baseProps()} panel={panel} />);

      const headings = screen.getAllByRole('heading', { level: 1 });
      expect(headings, panel).toHaveLength(1);
      expect(headings[0], panel).toHaveTextContent(name);
      expect(screen.queryByRole('heading', { name: AUTH_MESSAGES.hero.headline }), panel).toBeNull();
      expect(screen.getByText(AUTH_MESSAGES.hero.headline), panel).toBeInTheDocument();
      unmount();
    }
  });
});

/* -------------------------------------------------------------------------- */
/* Keyboard.                                                                   */
/* -------------------------------------------------------------------------- */

describe('AuthScreen — keyboard', () => {
  it('puts focus in the first field as soon as it opens', () => {
    renderScreen();

    expect(document.activeElement).toBe(emailField());
  });

  it('uses no positive tabindex, so tab order is document order', () => {
    const { container } = renderScreen();

    expect(findPositiveTabIndexes(container)).toHaveLength(0);
  });

  it('A-10: gửi form trống thì tiêu điểm nhảy tới ô lỗi đầu tiên', async () => {
    renderScreen();

    fireEvent.click(submitButton());

    await waitFor(() => {
      expect(document.activeElement).toBe(emailField());
    });
    expect(emailField()).toHaveAttribute('aria-invalid', 'true');
  });

  it('submits on Enter from every field, the checkbox included', () => {
    const { gateway, signIn } = stubGateway();
    renderScreen({ gateway });

    type(emailField(), EMAIL);
    type(passwordField(), PASSWORD);

    fireEvent.keyDown(emailField(), { key: 'Enter' });
    expect(signIn).toHaveBeenCalledTimes(1);

    cleanup();

    const second = stubGateway();
    renderScreen({ gateway: second.gateway });
    type(emailField(), EMAIL);
    type(passwordField(), PASSWORD);
    fireEvent.keyDown(passwordField(), { key: 'Enter' });
    expect(second.signIn).toHaveBeenCalledTimes(1);

    cleanup();

    const third = stubGateway();
    renderScreen({ gateway: third.gateway });
    type(emailField(), EMAIL);
    type(passwordField(), PASSWORD);
    fireEvent.keyDown(screen.getByLabelText(AUTH_MESSAGES.fields.rememberMe), { key: 'Enter' });
    expect(third.signIn).toHaveBeenCalledTimes(1);
  });

  it('leaves Enter on a button to the button itself: nothing is sent, the key is not swallowed (BUG-011)', () => {
    const { gateway, signIn } = stubGateway();
    renderScreen({ gateway, onSsoSignIn: noop });

    type(emailField(), EMAIL);
    type(passwordField(), PASSWORD);

    for (const name of [
      AUTH_MESSAGES.actions.forgotPassword,
      AUTH_MESSAGES.actions.ssoSignIn,
      AUTH_MESSAGES.actions.showPassword,
    ]) {
      // `fireEvent` returns false when a handler called `preventDefault`, which is what kills the native click.
      expect(fireEvent.keyDown(screen.getByRole('button', { name }), { key: 'Enter' }), name).toBe(true);
    }

    expect(signIn).not.toHaveBeenCalled();
  });

  it('signs in with Tab and Enter alone: first field focused, the rest in order, Enter sends', () => {
    const { gateway, signIn } = stubGateway();
    const { container } = renderScreen({ gateway, onSsoSignIn: noop });

    const form = container.querySelector('form');
    expect(form).not.toBeNull();

    const stops = Array.from(
      form?.querySelectorAll<HTMLElement>('input:not([type="hidden"]), button') ?? [],
    ).filter((element) => !element.hasAttribute('disabled'));

    // Document order is tab order, because nothing carries a positive tabindex.
    expect(stops[0]).toBe(emailField());
    expect(stops[1]).toBe(passwordField());
    expect(stops[2]).toBe(
      screen.getByRole('button', { name: AUTH_MESSAGES.actions.showPassword }),
    );
    // "Quên mật khẩu" nằm ngay dưới ô mật khẩu (U46), nên tới ngay sau nút mắt; không nổi lên trên ô
    // bằng `absolute`, để chỗ nhìn thấy trùng thứ tự Tab.
    const forgot = screen.getByRole('button', { name: AUTH_MESSAGES.actions.forgotPassword });
    expect(stops[3]).toBe(forgot);
    expect(forgot).not.toHaveClass('absolute');
    expect(forgot.parentElement).not.toHaveClass('absolute');
    expect(stops[4]).toBe(screen.getByLabelText(AUTH_MESSAGES.fields.rememberMe));
    expect(stops[5]).toBe(submitButton());
    expect(stops[6]).toBe(
      screen.getByRole('button', { name: AUTH_MESSAGES.actions.ssoSignIn }),
    );

    type(emailField(), EMAIL);
    type(passwordField(), PASSWORD);
    fireEvent.keyDown(passwordField(), { key: 'Enter' });

    expect(signIn).toHaveBeenCalledWith({ email: EMAIL, password: PASSWORD, rememberMe: true });
  });
});

/* -------------------------------------------------------------------------- */
/* Password visibility.                                                       */
/* -------------------------------------------------------------------------- */

describe('AuthScreen — password visibility', () => {
  it('starts masked and reveals the typed password on toggle, without touching its value', () => {
    renderScreen();

    type(passwordField(), PASSWORD);
    expect(passwordField()).toHaveAttribute('type', 'password');

    fireEvent.click(screen.getByRole('button', { name: AUTH_MESSAGES.actions.showPassword }));

    expect(passwordField()).toHaveAttribute('type', 'text');
    expect(passwordField().value).toBe(PASSWORD);

    fireEvent.click(screen.getByRole('button', { name: AUTH_MESSAGES.actions.hidePassword }));
    expect(passwordField()).toHaveAttribute('type', 'password');
  });
});

/* -------------------------------------------------------------------------- */
/* SSO and password reset.                                                    */
/* -------------------------------------------------------------------------- */

describe('AuthScreen — SSO and password reset', () => {
  it('calls the host callback when the SSO button is pressed, and shows no button when none was given', () => {
    const onSsoSignIn = vi.fn();
    renderScreen({ onSsoSignIn });

    fireEvent.click(screen.getByRole('button', { name: AUTH_MESSAGES.actions.ssoSignIn }));

    expect(onSsoSignIn).toHaveBeenCalledTimes(1);

    cleanup();
    renderScreen();

    // BUG-002: no flow, no button — and no "Hoặc" divider leading to nothing.
    expect(screen.queryByRole('button', { name: AUTH_MESSAGES.actions.ssoSignIn })).toBeNull();
    expect(screen.queryByText(AUTH_MESSAGES.actions.or)).toBeNull();
  });

  it('opens the forgot-password panel when "Quên mật khẩu" is pressed', () => {
    renderScreen();

    fireEvent.click(screen.getByRole('button', { name: AUTH_MESSAGES.actions.forgotPassword }));

    expect(screen.getByRole('button', { name: AUTH_MESSAGES.actions.sendResetLink })).toBeInTheDocument();
    expect(screen.queryByLabelText(AUTH_MESSAGES.fields.password)).toBeNull();
  });

  it('opens the same panel from "Quên mật khẩu" after a wrong password', async () => {
    const { gateway } = stubGateway(httpFailure(UNAUTHORIZED_STATUS, 'INVALID_CREDENTIALS'));
    renderScreen({ gateway });

    type(emailField(), EMAIL);
    type(passwordField(), PASSWORD);
    fireEvent.keyDown(passwordField(), { key: 'Enter' });

    await screen.findByText(AUTH_MESSAGES.errors.invalidCredentials.title);
    // G1-09: both boxes turn red with the strip, without a second sentence under each.
    expect(emailField()).toHaveAttribute('aria-invalid', 'true');
    expect(passwordField()).toHaveAttribute('aria-invalid', 'true');
    fireEvent.click(screen.getByRole('button', { name: AUTH_MESSAGES.actions.forgotPassword }));

    expect(screen.getByRole('button', { name: AUTH_MESSAGES.actions.sendResetLink })).toBeInTheDocument();
  });
});

/* -------------------------------------------------------------------------- */
/* Validation.                                                                 */
/* -------------------------------------------------------------------------- */

describe('AuthScreen — field validation', () => {
  it('validates a field on the way out of it, in a sentence from the bundle', () => {
    renderScreen();

    type(emailField(), 'thu.ha');
    fireEvent.blur(emailField());

    expect(screen.getByText(AUTH_MESSAGES.problems.emailInvalid)).toBeInTheDocument();
  });

  it('drops a complaint the moment that field is edited again', () => {
    renderScreen();

    type(emailField(), 'thu.ha');
    fireEvent.blur(emailField());
    expect(screen.getByText(AUTH_MESSAGES.problems.emailInvalid)).toBeInTheDocument();

    type(emailField(), EMAIL);
    expect(screen.queryByText(AUTH_MESSAGES.problems.emailInvalid)).toBeNull();
  });

  it('refuses to send a password below the minimum, and says what the minimum is', () => {
    const { gateway, signIn } = stubGateway();
    renderScreen({ gateway });

    type(emailField(), EMAIL);
    type(passwordField(), 'ngan');
    fireEvent.keyDown(passwordField(), { key: 'Enter' });

    expect(signIn).not.toHaveBeenCalled();
    expect(
      screen.getByText(
        AUTH_MESSAGES.problems.passwordTooShort.replace('{{count}}', String(MIN_PASSWORD_LENGTH)),
      ),
    ).toBeInTheDocument();
  });

  it('sits in the partial state once there is an address and no password', () => {
    const { container } = renderScreen();

    type(emailField(), EMAIL);

    expect(container.querySelector('main')).toHaveAttribute('data-auth-state', 'partial');
    expect(screen.getByText(AUTH_MESSAGES.notices.partial)).toBeInTheDocument();
  });
});

/* -------------------------------------------------------------------------- */
/* Submitting.                                                                 */
/* -------------------------------------------------------------------------- */

describe('AuthScreen — submitting', () => {
  it('refuses a second submit while the first is still in flight', () => {
    const signIn = vi.fn<AuthGateway['signIn']>(() => new Promise(() => undefined));
    const gateway: AuthGateway = { signIn, requestPasswordReset: vi.fn() };
    renderScreen({ gateway });

    type(emailField(), EMAIL);
    type(passwordField(), PASSWORD);

    fireEvent.keyDown(passwordField(), { key: 'Enter' });
    fireEvent.keyDown(passwordField(), { key: 'Enter' });
    fireEvent.keyDown(passwordField(), { key: 'Enter' });

    expect(signIn).toHaveBeenCalledTimes(1);
  });

  it('keeps the button width and swaps only its label while sending', async () => {
    const signIn = vi.fn<AuthGateway['signIn']>(() => new Promise(() => undefined));
    const gateway: AuthGateway = { signIn, requestPasswordReset: vi.fn() };
    renderScreen({ gateway });

    const widthBefore = submitButton().className.includes('w-full');

    type(emailField(), EMAIL);
    type(passwordField(), PASSWORD);
    fireEvent.keyDown(passwordField(), { key: 'Enter' });

    const sending = await screen.findByRole('button', { name: AUTH_MESSAGES.actions.submitting });

    expect(widthBefore).toBe(true);
    expect(sending.className).toContain('w-full');
    expect(sending).toBeDisabled();
  });

  it('shows a strip inside the form on a wrong password, and keeps what was typed', async () => {
    const { gateway } = stubGateway(httpFailure(UNAUTHORIZED_STATUS, 'INVALID_CREDENTIALS'));
    renderScreen({ gateway });

    type(emailField(), EMAIL);
    type(passwordField(), PASSWORD);
    fireEvent.keyDown(passwordField(), { key: 'Enter' });

    expect(
      await screen.findByText(AUTH_MESSAGES.errors.invalidCredentials.description),
    ).toBeInTheDocument();
    expect(emailField().value).toBe(EMAIL);
    expect(passwordField().value).toBe(PASSWORD);
    // No modal, no toast: the message lives in the form (invariant A9).
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('counts the lockout down and shuts the submit button', async () => {
    const { gateway } = stubGateway(
      httpFailure(TOO_MANY_REQUESTS_STATUS, undefined, { retryAfterSeconds: 5 }),
    );
    renderScreen({ gateway });

    type(emailField(), EMAIL);
    type(passwordField(), PASSWORD);
    fireEvent.keyDown(passwordField(), { key: 'Enter' });

    const sentence = await screen.findByText(AUTH_MESSAGES.errors.tooManyAttempts.description);

    // The lockout is a fixed 60 s whatever `Retry-After` says, and no number is promised.
    expect(sentence.textContent).not.toMatch(/\d/u);
    expect(submitButton()).toBeDisabled();
  });

  it('moves to the forbidden state when the account is disabled', async () => {
    const { gateway } = stubGateway(httpFailure(FORBIDDEN_STATUS, 'ACCOUNT_DISABLED'));
    const { container } = renderScreen({ gateway });

    type(emailField(), EMAIL);
    type(passwordField(), PASSWORD);
    fireEvent.keyDown(passwordField(), { key: 'Enter' });

    await waitFor(() => {
      expect(container.querySelector('main')).toHaveAttribute('data-auth-state', 'forbidden');
    });
    expect(screen.queryByLabelText(AUTH_MESSAGES.fields.email)).toBeNull();
  });

  it('borrows the sentence from src/lib/errors on a transport failure rather than writing one', async () => {
    const { gateway } = stubGateway({
      ok: false,
      error: { kind: 'network', retryable: true, requestId: 'req-4', raw: null },
    });
    renderScreen({ gateway });

    type(emailField(), EMAIL);
    type(passwordField(), PASSWORD);
    fireEvent.keyDown(passwordField(), { key: 'Enter' });

    expect(await screen.findByText(viMessages.errors.network.description)).toBeInTheDocument();
  });

  it('flashes once before it changes the page', async () => {
    vi.useFakeTimers();
    const onAuthenticated = vi.fn();
    const { gateway } = stubGateway();

    render(
      <AuthScreen gateway={gateway} onAuthenticated={onAuthenticated} reducedMotion={false} />,
    );

    type(emailField(), EMAIL);
    type(passwordField(), PASSWORD);
    fireEvent.keyDown(passwordField(), { key: 'Enter' });

    await vi.advanceTimersByTimeAsync(0);
    expect(onAuthenticated).not.toHaveBeenCalled();

    await vi.advanceTimersByTimeAsync(durationMs('standard'));
    expect(onAuthenticated).toHaveBeenCalledTimes(1);
  });

  it('skips the flash entirely for someone who asked for less motion', async () => {
    const onAuthenticated = vi.fn();
    const { gateway } = stubGateway();
    renderScreen({ gateway, onAuthenticated, reducedMotion: true });

    type(emailField(), EMAIL);
    type(passwordField(), PASSWORD);
    fireEvent.keyDown(passwordField(), { key: 'Enter' });

    await waitFor(() => {
      expect(onAuthenticated).toHaveBeenCalledTimes(1);
    });
  });
});

/* -------------------------------------------------------------------------- */
/* Boundaries.                                                                 */
/* -------------------------------------------------------------------------- */

describe('AuthRoute — the form is never withheld', () => {
  /**
   * A regression that shipped once and must not ship twice.
   *
   * The route used to probe `src/lib/auth` on mount and, when `configureAuth()`
   * had not run, render a notice *instead of* the form. That locks a visitor out
   * before they have typed a character, over a deployment fault they cannot act
   * on — and "the host has not configured auth" is not one of invariant A11's
   * seven states. A sign-in form is static markup; whether a server answers is
   * not knowable until someone presses the button, and that answer belongs in
   * the strip inside the form.
   *
   * Nothing configures auth in this test, which is the whole point.
   */
  it('renders the form even when nothing has configured the auth layer', () => {
    const { container } = render(
      <MemoryRouter initialEntries={['/login']}>
        <AuthRoute />
      </MemoryRouter>,
    );

    expect(container.querySelector('main')).toHaveAttribute('data-auth-state', 'empty');
    expect(screen.getByLabelText(AUTH_MESSAGES.fields.email)).toBeInTheDocument();
    expect(screen.getByLabelText(AUTH_MESSAGES.fields.password)).toBeInTheDocument();
    expect(screen.queryAllByRole('tab')).toHaveLength(0);
    expect(screen.queryByRole('tablist')).toBeNull();
  });
});

/* -------------------------------------------------------------------------- */
/* Where a successful sign-in lands.                                           */
/* -------------------------------------------------------------------------- */

describe('safeDestination — never off this origin, never back onto the sign-in page', () => {
  /** Every row lands on the dashboard; the second column says why it must. */
  const REJECTED = [
    ['//evil.example', 'two leading slashes name another host'],
    ['https://evil.example', 'an absolute address'],
    ['evil', 'no leading slash'],
    ['', 'empty'],
    [`/${String.fromCharCode(92)}evil.example`, 'the browser reads a backslash as a slash'],
    ['/\\evil.example', 'the same, typed as an escaped literal'],
    ['/tai-khoan\\x', 'a backslash anywhere in the path'],
    [`/tai-khoan${String.fromCharCode(10)}`, 'a control character'],
    [`/${String.fromCharCode(9)}/evil.example`, 'the browser drops a tab, leaving two slashes'],
    ['//evil.example:99999', 'a host that does not even parse'],
    ['/login', 'the sign-in page itself (B-V1-02)'],
    ['/LOGIN/', 'the same page: routes match case-insensitively and ignore a trailing slash'],
    ['/tai-khoan/../login', 'the same page once the dots resolve'],
  ] as const;

  for (const [candidate, why] of REJECTED) {
    it(`rejects ${JSON.stringify(candidate)} — ${why}`, () => {
      expect(safeDestination(candidate)).toBe(ROUTES.dashboard);
    });
  }

  it('rejects anything that is not a string', () => {
    expect(safeDestination(undefined)).toBe(ROUTES.dashboard);
    expect(safeDestination({ pathname: '/tai-khoan' })).toBe(ROUTES.dashboard);
  });

  it('keeps a path on this site whole — query and hash included', () => {
    expect(safeDestination('/tai-khoan?x=1#h')).toBe('/tai-khoan?x=1#h');
    expect(safeDestination('/m/du-an/project-1')).toBe('/m/du-an/project-1');
  });

  it('lets a page under the sign-in prefix through — only the sign-in page itself is refused', () => {
    expect(safeDestination('/login/invitation/abc')).toBe('/login/invitation/abc');
  });
});

/* -------------------------------------------------------------------------- */
/* Layer boundaries.                                                           */
/* -------------------------------------------------------------------------- */

describe('AuthScreen — layer boundaries', () => {
  it('reaches no network directly anywhere in the screen', async () => {
    const { readFileSync, readdirSync } = await import('node:fs');
    const directory = 'src/screens/auth/AuthScreen';

    for (const name of readdirSync(directory)) {
      const source = readFileSync(`${directory}/${name}`, 'utf8');

      expect(source).not.toMatch(/\bfetch\s*\(/);
    }
  });

  it('keeps the view clear of src/api and src/store', async () => {
    const { readFileSync } = await import('node:fs');
    const view = readFileSync('src/screens/auth/AuthScreen/AuthScreen.tsx', 'utf8');

    expect(view).not.toMatch(/@\/api/);
    expect(view).not.toMatch(/@\/store/);
  });
});

/* -------------------------------------------------------------------------- */
/* R1 — the session the gateway is worth nothing without.                      */
/* -------------------------------------------------------------------------- */

describe('createHttpAuthGateway — vai chảy được sau lượt đăng nhập', () => {
  /**
   * Mắt xích đã đứt, và bài này là chỗ nó gãy lại nếu ai gỡ.
   *
   * `setAuthenticatedSession` chỉ có đúng một người gọi trong `src`
   * (`lib/auth/refresh.ts`), người ấy chạy trong `bootstrapSession()`, và
   * `bootstrapSession()` ném ngay khi `configureAuth()` chưa chạy — mà trước
   * lượt này KHÔNG nơi nào trong `src` gọi `configureAuth()`. Nên `roles` không
   * bao giờ tới được phiên, `useSession().roles` rỗng ở mọi màn, `canEdit` sai,
   * và bấm chuột trong khung nhìn 3D không chọn được gì.
   *
   * Không có máy chủ nào ở đây: bộ mẫu vừa trả lời lượt post vừa trả lời lượt
   * gia hạn, đúng cặp mà `VITE_USE_MOCK_API` dựng ở `pnpm dev`. Thứ được kiểm
   * là chuỗi, không phải bộ mẫu.
   */
  const signInWithMockSession = async (email: string) => {
    const { createMockApiClient, createMockAuthTransport } = await import('@/api/__mocks__/client');
    const { __resetAuthForTests, getSession } = await import('@/lib/auth');

    __resetAuthForTests();

    const gateway = createHttpAuthGateway(createMockApiClient(), createMockAuthTransport());
    const result = await gateway.signIn({ email, password: 'matkhau-du-dai', rememberMe: false });

    return { result, session: getSession() };
  };

  it('mở phiên thật và mang vai về, thay vì trả ok rồi bỏ mặc phiên rỗng', async () => {
    const { result, session } = await signInWithMockSession('nguoi-la@example.com');

    expect(result.ok).toBe(true);
    expect(session.status).toBe('authenticated');
    expect(session.roles).toEqual(['engineer']);
  });

  it('cấp vai chỉ-xem cho địa chỉ chỉ-xem, nên nhánh không-có-quyền của A11 vẫn chạy ra được', async () => {
    const { session } = await signInWithMockSession('viewer@example.com');

    expect(session.roles).toEqual(['viewer']);
  });

  it('trả về thất bại chứ không mở phiên khi lượt post bị từ chối', async () => {
    const { __resetAuthForTests, getSession } = await import('@/lib/auth');

    __resetAuthForTests();

    const refused: AuthGateway = createHttpAuthGateway({
      auth: {
        signIn: async () => ({ ok: false, error: { status: 401 } }),
      },
    } as unknown as Parameters<typeof createHttpAuthGateway>[0]);

    const result = await refused.signIn({
      email: 'nguoi-la@example.com',
      password: 'matkhau-du-dai',
      rememberMe: false,
    });

    expect(result.ok).toBe(false);
    expect(getSession().status).not.toBe('authenticated');
  });
});
