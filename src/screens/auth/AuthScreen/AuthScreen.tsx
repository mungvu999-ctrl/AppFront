/**
 * `/login` — the first screen of the product, and the pattern for the rest.
 *
 * The rendering half of invariant D's split. {@link AuthScreenView} takes plain
 * props and returns markup: it holds no state, calls no gateway, validates
 * nothing and writes no sentence. Every string below arrived from
 * `useAuthScreen`, which is why there is not a user-facing literal in this file
 * and nothing for `local/no-raw-number` to catch.
 *
 * Three decisions worth defending:
 *
 * - **The failure is a strip inside the form, not a toast and not a modal.**
 *   Invariant A9 keeps blocking modals for create, delete and publish, and a
 *   toast for a wrong password would take the message away on a timer while the
 *   person is still reading it. Every strip — an opening sentence or what an
 *   attempt answered — sits under the button, and each field keeps room for its
 *   own complaint, so nothing appearing or going moves a field or the button
 *   under the cursor (BUG-008). A strip stays until the attempt changes.
 * - **The left column is the same ink-on-paper plan as /welcome** (`AuthFrame` + `ValuePanel`): a static
 *   SVG, no canvas. Below 1024 it folds to a short band above the form instead of vanishing (A1 P1).
 * - **"Quên mật khẩu" replaces the form, it does not float over it.** There is
 *   no register tab: sign-up is closed in v1. The reset request is a second
 *   panel (`ForgotPasswordPanel`) in the same slot, so Esc means "back" and
 *   focus has one obvious place to return to.
 *
 * All seven of invariant A11's states are rendered from
 * {@link AuthScreenViewProps.state}, and `AuthScreen.test.tsx` renders every one
 * of them through `expectSevenStates`.
 */

import { useCallback, useRef } from 'react';
import { CircleAlert, CircleCheck, Lock } from 'lucide-react';

import { InlineAlert } from '@/components/feedback/InlineAlert';
import { Badge } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { Checkbox } from '@/components/ui/Checkbox';
import { Input } from '@/components/ui/Input';
import { Kbd } from '@/components/ui/Kbd';

/* Nhập THEO TÊN, không default: default export của `vi.json` là một object literal liền
   khối nên Rollup phải giữ cả cuốn từ điển trong chunk vào. Đừng "dọn" về default. */
import { auth as AUTH_MESSAGES } from '@/i18n/vi.json';

import {
  useAuthScreen,
  type AuthField,
  type AuthScreenActions,
  type AuthScreenModel,
  type UseAuthScreenOptions,
} from './useAuthScreen';
import { AuthFrame } from '../AuthFrame';
import { PasswordField } from '../PasswordField';
import { FIELD_ERROR_SLOT } from '../RecoveryShell';
import { useFocusFirstInvalid, useReturnFocus } from '../useReturnFocus';
import { ForgotPasswordPanel } from './ForgotPasswordPanel';
import { useAutoFocusRing } from './useAutoFocusRing';

/* Chữ của bản Z S-01 (ba câu của màn). Chờ chuyển vào `vi.json` khối `auth` — khối đó đọc lúc chạy
   và nằm ngoài thư mục màn, nên tạm là hằng ở đây. */
const SIGN_IN_TITLE = 'Đăng nhập để tiếp tục dự án';
const STATUS_SIGNED_OUT = 'Chưa đăng nhập';
const STATUS_SIGNED_OUT_NOTE = 'Xong sẽ mở lại đúng trang bạn đang xem.';
const STATUS_REJECTED = 'Chưa đăng nhập được';
const STATUS_REJECTED_NOTE = 'Máy chủ từ chối lần thử vừa rồi.';
const STATUS_DONE = 'Đã đăng nhập';
const STATUS_SESSION_OPEN = 'Đang có phiên đăng nhập';
const NO_ACCOUNT_NOTE =
  'Chưa có tài khoản? Quản trị viên dự án gửi thư mời; mở liên kết trong thư để tạo tài khoản.';

/** Câu 2 của màn: một chip + một câu, suy từ đúng trạng thái biểu mẫu đang theo. */
function SignInStatus({ state, rejected, sessionOpen }: { readonly state: string; readonly rejected: boolean; readonly sessionOpen: boolean }) {
  if (sessionOpen && !rejected && state !== 'success') { // chip không được nói "Chưa đăng nhập" khi dải dưới nói "Bạn đang đăng nhập"
    return (
      <Badge variant="attention" noDot>
        <CircleAlert aria-hidden="true" size={14} strokeWidth={2} />
        {STATUS_SESSION_OPEN}
      </Badge>
    );
  }
  if (state === 'success') {
    return (
      <Badge variant="verified" noDot>
        <CircleCheck aria-hidden="true" size={14} strokeWidth={2} />
        {STATUS_DONE}
      </Badge>
    );
  }

  return rejected ? (
    <>
      <Badge variant="violation" noDot>
        <CircleAlert aria-hidden="true" size={14} strokeWidth={2} />
        {STATUS_REJECTED}
      </Badge>
      <span>{STATUS_REJECTED_NOTE}</span>
    </>
  ) : (
    <>
      <Badge variant="neutral" noDot>
        <Lock aria-hidden="true" size={14} strokeWidth={2} />
        {STATUS_SIGNED_OUT}
      </Badge>
      <span>{STATUS_SIGNED_OUT_NOTE}</span>
    </>
  );
}

/* -------------------------------------------------------------------------- */
/* The sign-in form.                                                           */
/* -------------------------------------------------------------------------- */

interface CredentialFormProps {
  readonly model: AuthScreenModel;
  readonly actions: AuthScreenActions;
  /** Focuses the first field when the panel mounts, including after a panel change. */
  readonly registerFirstField: (element: HTMLInputElement | null) => void;
}

function CredentialForm({ model, actions, registerFirstField }: CredentialFormProps) {
  const { values, problems, isSubmitting, canSubmit, submitLabel, notice, state } = model;
  const credentialsRejected = model.credentialsRejected === true;
  const isDone = state === 'success';
  const fieldsDisabled = isSubmitting || isDone;
  const focusReturn = useReturnFocus(isSubmitting);

  const submit = useFocusFirstInvalid(focusReturn.ref, actions.submit);

  const handleSubmit = useCallback(
    (event: React.FormEvent<HTMLFormElement>) => {
      event.preventDefault();
      submit();
    },
    [submit],
  );

  /**
   * Enter sends from every field, including the checkbox — and only from a field.
   *
   * Implicit form submission already covers the text inputs, but not a focused
   * checkbox, and it is not something jsdom guarantees either. Handling the key
   * here makes the behaviour the same in a browser and in a test, and
   * `preventDefault` is what stops the native submission firing a second time.
   * Enter on a button is that button's own (WCAG 2.1.1), so it is left alone.
   */
  const handleKeyDown = useCallback(
    (event: React.KeyboardEvent<HTMLFormElement>) => {
      if (event.key !== 'Enter' || event.defaultPrevented || !(event.target instanceof HTMLInputElement)) {
        return;
      }

      event.preventDefault();
      submit();
    },
    [submit],
  );

  const blur = useCallback(
    (field: AuthField) => () => {
      actions.blurField(field);
    },
    [actions],
  );
  const emailField = useAutoFocusRing(registerFirstField, blur('email'), FIELD_ERROR_SLOT); // UX-34

  /* A strip's way out goes under it, full width and the height of "Đăng nhập" (BUG-059), not into
     its `action` slot: beside the text it squeezes the sentence into a ~100 px column at 360 px (BUG-003).
     A wrong password has none of its own: "Quên mật khẩu" below is the one way to recover (BUG-090). */
  const stripAction = notice?.action;

  return (
    <form
      ref={focusReturn.ref}
      className="flex flex-col gap-6"
      noValidate
      onSubmit={handleSubmit}
      onKeyDown={handleKeyDown}
      onFocus={focusReturn.onFocus}
    >
      {/* No gap here: each field keeps room for a two-line complaint, and that room is the spacing,
          so a complaint appearing or going moves nothing under the cursor (BUG-008). */}
      <div className="flex flex-col">
        <Input
          {...emailField}
          type="email"
          label={AUTH_MESSAGES.fields.email}
          autoComplete="username"
          value={values.email}
          disabled={fieldsDisabled}
          {...(problems.email !== undefined ? { error: problems.email } : {})}
          invalid={credentialsRejected}
          onChange={(event) => {
            actions.setEmail(event.target.value);
          }}
        />

        {/* "Quên mật khẩu" dưới ô, ngoài `<label>`: chỗ nhìn trùng thứ tự Tab (U46), tên ô vẫn là "Mật khẩu". */}
        <PasswordField
          label={AUTH_MESSAGES.fields.password}
          autoComplete="current-password"
          wrapperClassName={FIELD_ERROR_SLOT}
          value={values.password}
          disabled={fieldsDisabled}
          {...(problems.password !== undefined ? { error: problems.password } : {})}
          invalid={credentialsRejected}
          onChange={(event) => {
            actions.setPassword(event.target.value);
          }}
          onBlur={blur('password')}
        />
        <div className="-mt-2 mb-3 flex justify-end">
          <button
            type="button"
            disabled={fieldsDisabled}
            onClick={actions.forgotPassword}
            className="inline-flex min-h-11 items-center rounded-sm text-[13px] fine:min-h-6 font-medium leading-5 text-accent-hover transition-colors duration-120 hover:text-accent-active hover:underline underline-offset-2 outline-hidden focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:ring-offset-bg-surface disabled:cursor-not-allowed disabled:opacity-50"
          >
            {AUTH_MESSAGES.actions.forgotPassword}
          </button>
        </div>
        {/* Sai mật khẩu nói ngay dưới ô mật khẩu, cạnh đối tượng (Z/S-01 #6); các dải khác vẫn dưới nút. */}
        {credentialsRejected && notice !== null && (
          <div className="mb-4">
            <InlineAlert
              level={notice.tone}
              {...(notice.title !== undefined ? { title: notice.title } : {})}
              message={notice.message}
            />
          </div>
        )}

        <div className="flex flex-col gap-4">
          <Checkbox
            label={AUTH_MESSAGES.fields.rememberMe}
            checked={values.rememberMe}
            disabled={fieldsDisabled}
            onChange={actions.setRememberMe}
          />

          {/* `fullWidth` plus a fixed height is what keeps the button the same
              shape while it is sending — the label swaps, the box does not. */}
          <Button type="submit" size="lg" fullWidth loading={isSubmitting} disabled={!canSubmit}>
            {isSubmitting ? AUTH_MESSAGES.actions.submitting : submitLabel}
            {/* Phím của nút chính, ẩn khỏi tên nút: trình đọc màn hình vẫn đọc đúng "Đăng nhập". */}
            {!isSubmitting && (
              <span aria-hidden="true" className="ml-2 inline-flex">
                <Kbd className="border-transparent bg-transparent text-current opacity-80">Enter</Kbd>
              </span>
            )}
          </Button>
        </div>
      </div>

      {/* Every strip under the button, the opening ones too: above the fields, one appearing — or
          going, as the opening one does on submit — moved the fields and the button under the
          cursor (BUG-008). Right under it, above "Quên mật khẩu": a wrong password reads next to the button
          that answered it (A1 §8). */}
      {notice !== null && !credentialsRejected && (
        <div className="flex flex-col gap-3">
          <InlineAlert
            level={notice.tone}
            {...(notice.title !== undefined ? { title: notice.title } : {})}
            message={notice.message}
          />
          {stripAction !== undefined && (
            <Button type="button" variant="secondary" size="lg" fullWidth onClick={stripAction.onClick}>
              {stripAction.label}
            </Button>
          )}
        </div>
      )}
      {/* Under the button too: it appears while the address is being typed (BUG-008). */}
      {state === 'partial' && (
        <p className="text-[13px] leading-[18px] text-text-secondary">
          {AUTH_MESSAGES.notices.partial}
        </p>
      )}

      {actions.ssoSignIn !== undefined && (
        <div className="flex flex-col gap-4">
            <div className="flex items-center gap-3">
              <span aria-hidden="true" className="h-px flex-1 bg-border-default" />
              <span className="text-[13px] leading-[18px] text-text-muted">{AUTH_MESSAGES.actions.or}</span>
              <span aria-hidden="true" className="h-px flex-1 bg-border-default" />
            </div>

            <Button
              type="button"
              variant="secondary"
              size="lg"
              fullWidth
              disabled={fieldsDisabled}
              onClick={actions.ssoSignIn}
            >
              {AUTH_MESSAGES.actions.ssoSignIn}
            </Button>
        </div>
      )}
    </form>
  );
}

/* -------------------------------------------------------------------------- */
/* The view.                                                                   */
/* -------------------------------------------------------------------------- */

export type AuthScreenViewProps = AuthScreenModel & AuthScreenActions;

/**
 * The screen as a function of its props.
 *
 * Rendered directly by tests and stories, one call per state, which is what
 * lets all seven be checked without a gateway or a router.
 */
export function AuthScreenView(props: AuthScreenViewProps) {
  const { state, panel, isCollapsed, notice, isBlocked, forgot, forgotActions } = props;
  const { setCollapsed, forgotPassword, closeForgotPassword, signInWithAnotherAccount } = props;

  const model: AuthScreenModel = props;
  const actions: AuthScreenActions = props;

  /**
   * True until the first field of the freshly mounted panel has been focused.
   *
   * A callback ref rather than an effect: the field mounts with its panel, so at
   * the moment an effect keyed on `panel` would run there is nothing to focus
   * yet. Both panels hand the same ref to their email box, which is what makes
   * "open the panel" and "back to sign in" each land on an email field.
   */
  const wantsFocus = useRef(true);

  const registerFirstField = useCallback((element: HTMLInputElement | null) => {
    if (element !== null && wantsFocus.current) {
      wantsFocus.current = false;
      element.focus();
    }
  }, []);

  const openForgot = useCallback(() => {
    wantsFocus.current = true;
    forgotPassword();
  }, [forgotPassword]);

  const closeForgot = useCallback(() => {
    wantsFocus.current = true;
    closeForgotPassword();
  }, [closeForgotPassword]);

  const expand = useCallback(() => {
    wantsFocus.current = true;
    setCollapsed(false);
  }, [setCollapsed]);

  /* The disabled-account strip replaces the form that held focus: catch it on the way out of the
     strip rather than leave it on `body` — only when it is there, not to pull it from anyone. */
  const catchDroppedFocus = useCallback((element: HTMLButtonElement | null) => {
    if (element !== null && (document.activeElement === null || document.activeElement === document.body)) {
      element.focus();
    }
  }, []);

  const reopenForm = useCallback(() => {
    wantsFocus.current = true;
    signInWithAnotherAccount();
  }, [signInWithAnotherAccount]);

  const isForgot = panel === 'forgotPassword';

  return (
    /* Which of the seven states the screen is in, as an attribute rather than
       as text. ShareScreen prints it into an `sr-only` span; that announces an
       English word — "partial" — to a Vietnamese screen-reader user, and the
       strip below already says the same thing in a sentence. A `data-`
       attribute is readable by a test and silent to everyone else. */
    <AuthFrame
      state={state}
      title={isForgot ? AUTH_MESSAGES.forgotPassword.title : SIGN_IN_TITLE}
      subtitle={isForgot ? AUTH_MESSAGES.forgotPassword.subtitle : undefined}
      status={isForgot ? undefined : <SignInStatus state={state} rejected={props.credentialsRejected === true} sessionOpen={notice?.message === AUTH_MESSAGES.notices.signedIn} />}
      footer={isForgot ? undefined : NO_ACCOUNT_NOTE}
    >
      {isCollapsed ? (
        <div className="flex flex-col gap-4">
          <p className="text-[14px] leading-5 text-text-secondary">
            {AUTH_MESSAGES.notices.collapsed}
          </p>
          <Button size="lg" fullWidth onClick={expand}>
            {AUTH_MESSAGES.actions.expand}
          </Button>
        </div>
      ) : isForgot ? (
        <div key={panel} className="animate-dropdown-open motion-reduce:animate-none">
          <ForgotPasswordPanel
            model={forgot}
            actions={forgotActions}
            onBack={closeForgot}
            registerEmailField={registerFirstField}
          />
        </div>
      ) : isBlocked ? (
        <div className="flex flex-col gap-4">
          <InlineAlert
            level={notice?.tone ?? 'attention'}
            title={notice?.title ?? AUTH_MESSAGES.errors.accountDisabled.title}
            message={notice?.message ?? AUTH_MESSAGES.errors.accountDisabled.description}
          />
          <Button ref={catchDroppedFocus} type="button" variant="secondary" size="lg" fullWidth onClick={reopenForm}>
            {AUTH_MESSAGES.actions.signInWithAnotherAccount}
          </Button>
        </div>
      ) : (
        <div key={panel} className="animate-dropdown-open motion-reduce:animate-none">
          <CredentialForm
            model={model}
            actions={{ ...actions, forgotPassword: openForgot }}
            registerFirstField={registerFirstField}
          />
        </div>
      )}
    </AuthFrame>
  );
}

/* -------------------------------------------------------------------------- */
/* The screen.                                                                 */
/* -------------------------------------------------------------------------- */

export type AuthScreenProps = UseAuthScreenOptions;

/**
 * The view, wired to its logic.
 *
 * @example
 * <AuthScreen gateway={gateway} onAuthenticated={() => navigate(from)} />
 */
export function AuthScreen(props: AuthScreenProps) {
  const { model, actions } = useAuthScreen(props);

  return <AuthScreenView {...model} {...actions} />;
}
