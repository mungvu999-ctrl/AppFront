/**
 * The share screen's whole mind: what is on it, what it says, what a click does.
 *
 * Invariant D splits every complex screen in two. This is the half that holds
 * state and does arithmetic; `src/screens/project/ShareScreen/` is the half
 * that only renders. The split is worth naming here because of what it buys on
 * *this* screen specifically: every string a person reads about a link — the
 * permission, the countdown, the notice about rows that would not parse — is
 * built in this file, so the view has no formatting to get wrong and no reason
 * to import `src/lib/format`. {@link ShareLinkRow} is therefore all strings and
 * booleans; there is not a `Date` or a raw count in it.
 *
 * ## What this hook refuses to decide
 *
 * **Whether a link still works.** That is `status` on the wire, and
 * `selectActiveShareLinks` filters on it. This hook reads a clock in exactly one
 * place — `describeShareLinkExpiry`, to write a countdown — and nothing branches
 * on the result. See the rules at the top of `src/lib/export/shareLink.ts`.
 *
 * **Whether this account may share.** `can('create', 'share', { roles })` from
 * `src/lib/auth/permissions` decides, and the answer only ever *removes* the
 * form. It is the second lock, not the only one: the server answers 403 to a
 * request this hook would have allowed, and that reply has its own sentence.
 * Hiding the button is courtesy; the server is the boundary.
 *
 * ## Why the gateway is a parameter
 *
 * The transport is injected, so this hook tests against three stub functions
 * with no network, no `fetch` and no HTTP client — and so the share screen can
 * be shown in Storybook with a gateway that returns fixtures. `src/lib` never
 * learns about React; React never learns about `fetch`.
 *
 * ## Field names
 *
 * The brief names this `dungLienKet` with `hanDung` and `matKhau`. Invariants B
 * and E.11 of `CLAUDE.md` forbid Vietnamese identifiers, so it is
 * {@link useShareLinks} with {@link ShareForm.expiryChoice} and
 * {@link ShareForm.password}. Every string a person reads stays Vietnamese,
 * lower case and sentence style, as invariant A6 requires.
 */

import { lowerFirst } from '@/lib/format/sentence';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import { can } from '@/lib/auth/permissions';
import {
  SHARE_PERMISSION_LABELS,
  SHARE_LINK_STATUS_LABELS,
  createShareLink,
  describeShareLinkExpiry,
  listShareLinks,
  revokeShareLink,
  shareLinkEmbedCode,
  shareLinkUrl,
  validateShareLinkRequest,
  type CreateShareLinkRequest,
  type ShareLink,
  type ShareLinkGateway,
  type ShareLinkRequestField,
  type SharePermission,
} from '@/lib/export/shareLink';
import { formatNumber } from '@/lib/format/number';
import type { SevenState } from '@/lib/testing/sevenStateScenarios';
import type { SharedViewpoint } from '@/lib/three/camera/viewpointCodec';
import type { ProjectRole } from '@/types/project';

/* -------------------------------------------------------------------------- */
/* How long a link may live.                                                   */
/* -------------------------------------------------------------------------- */

/**
 * The expiries offered, as a closed list rather than a date picker.
 *
 * A date picker on a share sheet asks somebody to make a decision they have no
 * information for. Four durations cover what people actually
 * mean — a day for a question, a week for a review round, a month for a
 * handover — and every one of them is inside the ninety-day ceiling the lib
 * and the server enforce, so this list cannot produce a request either rejects.
 * There is no "no expiry" (L6-N05): the server gives every new link a hard end.
 */
export const SHARE_EXPIRY_CHOICES = ['1d', '7d', '30d', '90d'] as const;

/** One of the offered expiries. */
export type ShareExpiryChoice = (typeof SHARE_EXPIRY_CHOICES)[number];

/** What each is called on the sheet — sentence style, capitalised (A6). */
export const SHARE_EXPIRY_LABELS: Readonly<Record<ShareExpiryChoice, string>> = {
  '1d': 'Một ngày',
  '7d': 'Bảy ngày',
  '30d': 'Ba mươi ngày',
  '90d': 'Chín mươi ngày',
};

const MS_PER_DAY = 24 * 60 * 60 * 1000;

const EXPIRY_DAYS: Readonly<Record<ShareExpiryChoice, number>> = {
  '1d': 1,
  '7d': 7,
  '30d': 30,
  '90d': 90,
};

function expiryDateFor(choice: ShareExpiryChoice, now: Date): Date {
  return new Date(now.getTime() + EXPIRY_DAYS[choice] * MS_PER_DAY);
}

/* -------------------------------------------------------------------------- */
/* What the form holds.                                                        */
/* -------------------------------------------------------------------------- */

/** The share sheet's fields, as values rather than as inputs. */
export interface ShareForm {
  readonly permission: SharePermission;
  readonly expiryChoice: ShareExpiryChoice;
  /** Whether the second lock is switched on. Off means no password is sent. */
  readonly passwordEnabled: boolean;
  readonly password: string;
  /** Whether the link opens on the camera the sender is looking through. */
  readonly includeViewpoint: boolean;
  /** Whether the receiver's screen shows our toolbar. */
  readonly toolbar: boolean;
}

const INITIAL_FORM: ShareForm = {
  permission: 'view',
  expiryChoice: '7d',
  passwordEnabled: false,
  password: '',
  includeViewpoint: true,
  toolbar: true,
};

/* -------------------------------------------------------------------------- */
/* What the view is given.                                                     */
/* -------------------------------------------------------------------------- */

/**
 * One link, ready to render.
 *
 * Every field is a string or a boolean because the view is not allowed to
 * compute — no dates to format, no counts to round, no status to map to a word.
 */
export interface ShareLinkRow {
  readonly id: string;
  /** The address to copy. Carries the camera and the screen settings. */
  readonly url: string;
  /** The `<iframe>` snippet for a page outside this product. */
  readonly embedCode: string;
  /** `chỉ xem` or `góp ý`. */
  readonly permissionLabel: string;
  /** `đang dùng được`, `đã hết hạn`, `đã thu hồi`. */
  readonly statusLabel: string;
  /** Which of the three state colours the row wears. */
  readonly tone: 'verified' | 'attention' | 'neutral';
  /** `còn 6 ngày`, or the sentence saying the server decides. */
  readonly expiryText: string;
  /** Whether a password guards it — never which one. */
  readonly passwordProtected: boolean;
  /** What the sender called it, or a fallback naming the permission. */
  readonly title: string;
  /** Whether this account may take it back. */
  readonly canRevoke: boolean;
}

/** Which field a form complaint sits under, so the view can place it. */
export type ShareFormProblems = Partial<Record<ShareLinkRequestField, string>>;

/** Everything the view needs, and nothing it has to work out. */
export interface ShareLinksModel {
  /** The headline state, for invariant A11 and for the state gallery. */
  readonly state: SevenState;
  readonly canCreate: boolean;
  readonly isCollapsed: boolean;
  readonly isLoading: boolean;
  readonly isCreating: boolean;
  readonly isRevoking: boolean;
  readonly rows: readonly ShareLinkRow[];
  readonly form: ShareForm;
  readonly formProblems: ShareFormProblems;
  /** Whether the create button is allowed to be pressed at all. */
  readonly canSubmit: boolean;
  /** Why the list could not be loaded, in Vietnamese. */
  readonly errorMessage: string | null;
  /** `2 dòng không đọc được…`, or `null` when everything parsed. */
  readonly unreadableNotice: string | null;
  /** The row a confirm dialog is currently asking about. */
  readonly revoking: ShareLinkRow | null;
  /** Which row's copy button last succeeded, for a "đã chép" flash. */
  readonly copiedId: string | null;
  /** Told to the person when the sender has no camera to attach. */
  readonly viewpointAvailable: boolean;
}

/** Everything the view can do. */
export interface ShareLinksActions {
  readonly setPermission: (permission: SharePermission) => void;
  readonly setExpiryChoice: (choice: ShareExpiryChoice) => void;
  readonly setPasswordEnabled: (enabled: boolean) => void;
  readonly setPassword: (password: string) => void;
  readonly setIncludeViewpoint: (include: boolean) => void;
  readonly setToolbar: (toolbar: boolean) => void;
  readonly setCollapsed: (collapsed: boolean) => void;
  readonly create: () => void;
  readonly reload: () => void;
  readonly copyUrl: (id: string) => void;
  readonly copyEmbedCode: (id: string) => void;
  readonly askRevoke: (id: string) => void;
  readonly cancelRevoke: () => void;
  readonly confirmRevoke: () => void;
}

export interface UseShareLinksOptions {
  readonly gateway: ShareLinkGateway;
  readonly projectId: string;
  /** This account's roles on this project; decides whether the form is offered. */
  readonly roles: readonly ProjectRole[];
  /** The camera the reviewer is looking through, if any. */
  readonly viewpoint?: SharedViewpoint | null;
  /** The clock, injected so a story and a test are fixed in time. */
  readonly now?: () => Date;
  /** Copies text. Injected because `navigator.clipboard` does not exist in jsdom. */
  readonly copyToClipboard?: (text: string) => Promise<void> | void;
  /** Invariant A8's undoable toast. */
  readonly onToast?: (toast: { readonly message: string; readonly onUndo?: () => void }) => void;
}

/* -------------------------------------------------------------------------- */
/* Wording.                                                                    */
/* -------------------------------------------------------------------------- */

const wholeNumber = (value: number): string => formatNumber(value, { fractionDigits: 0 });

/** `2 trong 5 liên kết không đọc được…` — the "một phần" state's sentence. */
export function unreadableNoticeText(shown: number, unreadable: number): string {
  const total = shown + unreadable;

  return (
    `${wholeNumber(unreadable)} trong ${wholeNumber(total)} liên kết không đọc được ` +
    'và không hiện ở đây; hãy tải lại hoặc báo quản trị trước khi kết luận dự án đã sạch.'
  );
}

const CREATED_TOAST = 'Đã tạo liên kết chia sẻ.';
const REVOKED_TOAST = 'Đã thu hồi liên kết. Người có liên kết cũ sẽ không mở được nữa.';
const COPIED_URL_TOAST = 'Đã chép liên kết.';
const COPIED_EMBED_TOAST = 'Đã chép mã nhúng.';

/** How long the "đã chép" flash stays on a row. One of the five durations. */
const COPY_FLASH_MS = 700;

const TONE_BY_STATUS: Readonly<Record<ShareLink['status'], ShareLinkRow['tone']>> = {
  // Green is reserved for what a person approved (invariant A5). A share link is
  // a person's own decision to publish, so `verified` is the honest tone here —
  // unlike an AI score, which never earns it.
  active: 'verified',
  expired: 'neutral',
  revoked: 'neutral',
};

function titleOf(link: ShareLink): string {
  const label = link.label?.trim() ?? '';

  return label.length > 0 ? label : `Liên kết ${lowerFirst(SHARE_PERMISSION_LABELS[link.permission])}`;
}

/* -------------------------------------------------------------------------- */
/* The hook.                                                                   */
/* -------------------------------------------------------------------------- */

/**
 * Load, create and revoke a project's share links.
 *
 * @example
 * const { model, actions } = useShareLinks({ gateway, projectId, roles });
 * return <ShareScreenView {...model} {...actions} />;
 */
export function useShareLinks(options: UseShareLinksOptions): {
  readonly model: ShareLinksModel;
  readonly actions: ShareLinksActions;
} {
  const { gateway, projectId, roles, onToast } = options;
  const viewpoint = options.viewpoint ?? null;

  const [form, setForm] = useState<ShareForm>(INITIAL_FORM);
  const [links, setLinks] = useState<readonly ShareLink[]>([]);
  const [unreadableCount, setUnreadableCount] = useState(0);
  const [isLoading, setIsLoading] = useState(true);
  const [isCreating, setIsCreating] = useState(false);
  const [isRevoking, setIsRevoking] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [revokingId, setRevokingId] = useState<string | null>(null);
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const [isCollapsed, setCollapsed] = useState(false);
  const [reloadCount, setReloadCount] = useState(0);

  // The clock and the clipboard are read through refs so that changing either
  // does not re-run the fetch effect. A story that passes a fresh `now` arrow on
  // every render would otherwise refetch on every render.
  const nowRef = useRef(options.now);
  nowRef.current = options.now;
  const copyRef = useRef(options.copyToClipboard);
  copyRef.current = options.copyToClipboard;
  const toastRef = useRef(onToast);
  toastRef.current = onToast;

  const readClock = useCallback((): Date => nowRef.current?.() ?? new Date(), []);

  const canCreate = useMemo(() => can('create', 'share', { roles }), [roles]);

  /* ---- loading ---------------------------------------------------------- */

  useEffect(() => {
    let cancelled = false;

    setIsLoading(true);
    void listShareLinks(gateway, { projectId }).then((result) => {
      if (cancelled) {
        return;
      }
      if (result.ok) {
        setLinks(result.data.links);
        setUnreadableCount(result.data.unreadableCount);
        setErrorMessage(null);
      } else {
        setLinks([]);
        setUnreadableCount(0);
        setErrorMessage(result.error.message);
      }
      setIsLoading(false);
    });

    return () => {
      // A screen left before its list arrives must not write into a dead tree.
      cancelled = true;
    };
  }, [gateway, projectId, reloadCount]);

  const reload = useCallback(() => {
    setReloadCount((count) => count + 1);
  }, []);

  /* ---- the request the form describes ------------------------------------ */

  const buildRequest = useCallback(
    (now: Date): CreateShareLinkRequest => ({
      projectId,
      permission: form.permission,
      expiresAt: expiryDateFor(form.expiryChoice, now),
      now,
      ...(form.passwordEnabled ? { password: form.password } : {}),
      ...(form.includeViewpoint && viewpoint !== null ? { viewpoint } : {}),
      embed: { toolbar: form.toolbar },
    }),
    [form, projectId, viewpoint],
  );

  /**
   * The form's complaints, recomputed as somebody types.
   *
   * Deliberately not gated on "has the field been touched": the only complaint
   * that can appear before anybody types is the password one, and the password
   * field is behind a switch the person had to turn on.
   */
  const formProblems = useMemo<ShareFormProblems>(() => {
    const problems: Record<string, string> = {};
    for (const problem of validateShareLinkRequest(buildRequest(readClock()))) {
      problems[problem.field] ??= problem.message;
    }

    return problems;
  }, [buildRequest, readClock]);

  const canSubmit =
    canCreate && !isCreating && !isLoading && Object.keys(formProblems).length === 0;

  /* ---- creating ---------------------------------------------------------- */

  const revokeById = useCallback(
    async (linkId: string): Promise<boolean> => {
      const result = await revokeShareLink(gateway, { projectId, linkId });
      if (!result.ok) {
        setErrorMessage(result.error.message);

        return false;
      }
      setLinks((current) => current.map((link) => (link.id === linkId ? result.data : link)));

      return true;
    },
    [gateway, projectId],
  );

  const create = useCallback(() => {
    if (!canSubmit) {
      return;
    }
    setIsCreating(true);
    void createShareLink(gateway, buildRequest(readClock())).then((result) => {
      setIsCreating(false);
      if (!result.ok) {
        setErrorMessage(result.error.message);

        return;
      }
      const created = result.data;
      setLinks((current) => [created, ...current]);
      setErrorMessage(null);
      // The password is not kept once it has been sent; the switch stays on so
      // the next link made in the same sitting is guarded too, but the value
      // itself does not sit in memory behind a screen anybody can walk up to.
      setForm((current) => ({ ...current, password: '' }));

      // Invariant A8: the change is undoable, and undoing a share means taking
      // it back. Revoking is the only honest undo — the link existed, and a
      // link that has been out in the world cannot be un-issued.
      toastRef.current?.({
        message: CREATED_TOAST,
        onUndo: () => {
          void revokeById(created.id);
        },
      });
    });
  }, [buildRequest, canSubmit, gateway, readClock, revokeById]);

  /* ---- revoking ---------------------------------------------------------- */

  const askRevoke = useCallback((id: string) => {
    setRevokingId(id);
  }, []);

  const cancelRevoke = useCallback(() => {
    setRevokingId(null);
  }, []);

  const confirmRevoke = useCallback(() => {
    if (revokingId === null || isRevoking) {
      return;
    }
    const linkId = revokingId;
    setIsRevoking(true);
    void revokeById(linkId).then((done) => {
      setIsRevoking(false);
      setRevokingId(null);
      if (done) {
        // No undo on this one, and the confirm dialog before it is why: invariant
        // A9 allows a modal for a delete precisely because some deletes cannot be
        // walked back, and a link somebody has already opened is one of them.
        toastRef.current?.({ message: REVOKED_TOAST });
      }
    });
  }, [isRevoking, revokeById, revokingId]);

  /* ---- rows -------------------------------------------------------------- */

  const rows = useMemo<readonly ShareLinkRow[]>(() => {
    const now = readClock();

    return links.map((link) => ({
      id: link.id,
      url: shareLinkUrl(link, { toolbar: form.toolbar }),
      embedCode: shareLinkEmbedCode(link, { title: titleOf(link) }),
      permissionLabel: SHARE_PERMISSION_LABELS[link.permission],
      statusLabel: SHARE_LINK_STATUS_LABELS[link.status],
      tone: TONE_BY_STATUS[link.status],
      expiryText: describeShareLinkExpiry(link, now).text,
      passwordProtected: link.passwordProtected,
      title: titleOf(link),
      canRevoke: canCreate && link.status === 'active',
    }));
  }, [canCreate, form.toolbar, links, readClock]);

  /* ---- copying ----------------------------------------------------------- */

  const copyFlash = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(
    () => () => {
      if (copyFlash.current !== null) {
        clearTimeout(copyFlash.current);
      }
    },
    [],
  );

  const copyText = useCallback((id: string, text: string, message: string) => {
    const copy = copyRef.current;
    if (copy === undefined) {
      return;
    }
    void Promise.resolve(copy(text)).then(
      () => {
        setCopiedId(id);
        toastRef.current?.({ message });
        if (copyFlash.current !== null) {
          clearTimeout(copyFlash.current);
        }
        copyFlash.current = setTimeout(() => {
          setCopiedId(null);
        }, COPY_FLASH_MS);
      },
      () => {
        // A clipboard the browser refused is not worth an error screen; the
        // address is on the page and can be selected by hand.
        setCopiedId(null);
      },
    );
  }, []);

  const copyUrl = useCallback(
    (id: string) => {
      const row = rows.find((candidate) => candidate.id === id);
      if (row !== undefined) {
        copyText(id, row.url, COPIED_URL_TOAST);
      }
    },
    [copyText, rows],
  );

  const copyEmbedCode = useCallback(
    (id: string) => {
      const row = rows.find((candidate) => candidate.id === id);
      if (row !== undefined) {
        copyText(id, row.embedCode, COPIED_EMBED_TOAST);
      }
    },
    [copyText, rows],
  );

  /* ---- the headline state ------------------------------------------------ */

  /**
   * One of the seven, by a precedence that answers "what is the most important
   * true thing about this screen right now".
   *
   * `collapsed` first because a folded screen shows none of the rest. `forbidden`
   * next because an account that cannot share does not care whether the list is
   * still loading. Then the list's own states, most-blocking first.
   */
  const state = useMemo<SevenState>(() => {
    if (isCollapsed) {
      return 'collapsed';
    }
    if (!canCreate) {
      return 'forbidden';
    }
    if (isLoading) {
      return 'loading';
    }
    if (errorMessage !== null) {
      return 'error';
    }
    if (unreadableCount > 0) {
      return 'partial';
    }

    return links.length === 0 ? 'empty' : 'success';
  }, [canCreate, errorMessage, isCollapsed, isLoading, links.length, unreadableCount]);

  const model: ShareLinksModel = {
    state,
    canCreate,
    isCollapsed,
    isLoading,
    isCreating,
    isRevoking,
    rows,
    form,
    formProblems,
    canSubmit,
    errorMessage,
    unreadableNotice:
      unreadableCount > 0 ? unreadableNoticeText(links.length, unreadableCount) : null,
    revoking: rows.find((row) => row.id === revokingId) ?? null,
    copiedId,
    viewpointAvailable: viewpoint !== null,
  };

  const actions: ShareLinksActions = {
    setPermission: useCallback((permission: SharePermission) => {
      setForm((current) => ({ ...current, permission }));
    }, []),
    setExpiryChoice: useCallback((expiryChoice: ShareExpiryChoice) => {
      setForm((current) => ({ ...current, expiryChoice }));
    }, []),
    setPasswordEnabled: useCallback((passwordEnabled: boolean) => {
      setForm((current) => ({
        ...current,
        passwordEnabled,
        // Switching the lock off clears what was typed, so a password cannot be
        // sent by a switch somebody turned back on without looking.
        password: passwordEnabled ? current.password : '',
      }));
    }, []),
    setPassword: useCallback((password: string) => {
      setForm((current) => ({ ...current, password }));
    }, []),
    setIncludeViewpoint: useCallback((includeViewpoint: boolean) => {
      setForm((current) => ({ ...current, includeViewpoint }));
    }, []),
    setToolbar: useCallback((toolbar: boolean) => {
      setForm((current) => ({ ...current, toolbar }));
    }, []),
    setCollapsed,
    create,
    reload,
    copyUrl,
    copyEmbedCode,
    askRevoke,
    cancelRevoke,
    confirmRevoke,
  };

  return { model, actions };
}
