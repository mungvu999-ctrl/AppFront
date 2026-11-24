/**
 * Letting somebody outside the project see the drawing, and taking it back.
 *
 * A share link is how this product leaves the team that made it. That makes it
 * the one feature where being wrong is not a bad screen but a disclosure, so
 * three rules shape everything below, and each of them is a rule about *where a
 * fact lives* rather than a check somebody has to remember to write.
 *
 * ## 1. The server decides who gets in. The browser only writes the sentence
 *
 * An expiry that the browser enforced would be an expiry anyone could defeat by
 * setting their clock back, and a permission the browser enforced would be a
 * permission a devtools console could edit. So {@link ShareLink.status} is the
 * **server's verdict**, carried on the wire, and it is the only thing anything
 * here branches on — {@link selectActiveShareLinks} filters on that field and
 * never on a clock.
 *
 * {@link describeShareLinkExpiry} is the counterweight: it does read the local
 * clock, and it produces nothing but a Vietnamese sentence. A device whose clock
 * is a week fast shows a wrong countdown and still cannot open one link the
 * server would refuse. That split is worth the two functions.
 *
 * ## 2. A secret never reaches a URL
 *
 * The optional password travels in the **body of a POST**, once, at creation,
 * and is never stored on the {@link ShareLink} that comes back — the wire schema
 * simply has no field for it, so a server that mistakenly echoed one would have
 * it dropped before any caller could see it. Nothing in this module can put a
 * credential in an address, because the only URL writer is
 * {@link import('./embedParams').buildEmbedUrl}, which knows four fixed keys and
 * all four describe a viewport. `findSecretParams` there is how a test proves it
 * from the outside.
 *
 * ## 3. A link that quietly does the wrong thing is worse than an error
 *
 * A viewpoint that cannot be encoded stops the creation rather than producing a
 * link that opens somewhere else. A revoke whose reply still says the link works
 * is reported as a broken contract rather than shown as success, because a
 * person who has clicked "thu hồi" and been told it worked will not click it
 * again. Both are cases where silence is the expensive answer.
 *
 * ## Shape
 *
 * The transport is a port — {@link ShareLinkGateway} — with three methods that
 * return `unknown`. Every decision, every validation and every sentence lives in
 * the pure functions around it, so the whole feature tests with three stub
 * functions and no network. {@link createHttpShareLinkGateway} is the one adapter.
 *
 * ## Field names
 *
 * The brief names these `taoLienKet`, `thuHoi` and `hanDung`. Invariants B and
 * E.11 of `CLAUDE.md` forbid Vietnamese identifiers, so they are
 * {@link createShareLink}, {@link revokeShareLink} and
 * {@link ShareLink.expiresAt}. Every string a person reads stays Vietnamese,
 * lower case and sentence style, as invariant A6 requires.
 */

import { z } from 'zod';

import { unprocessableShareMessage } from '@/lib/export/shareLinkRejection';
import { formatNumber } from '@/lib/format/number';
import type { HttpClient, HttpError, HttpErrorKind, Result } from '@/lib/http';
import {
  MAX_VIEWPOINT_CODE_LENGTH,
  encodeViewpoint,
  isEncodableLevelId,
  type SharedViewpoint,
} from '@/lib/three/camera/viewpointCodec';

import {
  buildEmbedCode,
  buildEmbedUrl,
  toEmbedParams,
  type EmbedCodeInput,
  type EmbedParams,
} from './embedParams';

/* -------------------------------------------------------------------------- */
/* What a link grants.                                                         */
/* -------------------------------------------------------------------------- */

/**
 * What the receiver may do.
 *
 * Two levels, not a matrix. `comment` adds the ability to leave a note against
 * an object; it does not add the ability to change one, because invariant A10
 * routes every change through `commit()` and a link holder has no project to
 * commit to.
 */
export type SharePermission = 'view' | 'comment';

/** The two, in the order the picker lists them. */
export const SHARE_PERMISSIONS: readonly SharePermission[] = ['view', 'comment'];

/** What each grant is called on screen. */
export const SHARE_PERMISSION_LABELS: Readonly<Record<SharePermission, string>> = {
  view: 'Chỉ xem',
  comment: 'Góp ý',
};

/**
 * Whether a link works — **as the server sees it**.
 *
 * The only field anything in this module branches on. It is not derived from
 * {@link ShareLink.expiresAt} here and must not be derived from it anywhere
 * else; see rule 1 at the top of this file.
 */
export type ShareLinkStatus = 'active' | 'expired' | 'revoked';

/** What each state is called on screen. */
export const SHARE_LINK_STATUS_LABELS: Readonly<Record<ShareLinkStatus, string>> = {
  active: 'đang dùng được',
  expired: 'đã hết hạn',
  revoked: 'đã thu hồi',
};

/**
 * A link as it exists on the server.
 *
 * Note what is missing: there is no password field, and there is no way to add
 * one — {@link ShareLinkWireSchema} strips whatever it does not name, so this
 * record cannot come to hold a credential by a server-side change alone.
 */
export interface ShareLink {
  readonly id: string;
  readonly projectId: string;
  /** The address to send. Opaque; its own query and fragment are the server's. */
  readonly url: string;
  readonly permission: SharePermission;
  /** The server's verdict. See {@link ShareLinkStatus}. */
  readonly status: ShareLinkStatus;
  /** ISO 8601. */
  readonly createdAt: string;
  /**
   * ISO 8601, or `null` for a link with no expiry.
   *
   * **For display only.** Whether the link opens is decided by
   * {@link ShareLink.status}, on the server.
   */
  readonly expiresAt: string | null;
  /** ISO 8601, set once somebody has taken the link back. */
  readonly revokedAt: string | null;
  /** Whether a password is required — never which one. */
  readonly passwordProtected: boolean;
  /** The camera the sender was looking through, as a code. */
  readonly viewpointCode: string | null;
  /** What the sender called it in the list, if anything. */
  readonly label: string | null;
}

/* -------------------------------------------------------------------------- */
/* The wire.                                                                   */
/* -------------------------------------------------------------------------- */

/**
 * The reply this module accepts, and the boundary that keeps secrets out.
 *
 * `z.object` strips every key it does not name, so a server that started
 * returning `password`, `sessionToken` or a raw project dump would have all of
 * it dropped here rather than carried into a store, a log or a screen. The
 * schema is therefore a filter first and a validator second.
 *
 * `projectId` is not on it: the caller always knows the project — it is in the
 * path it just requested — and asking the server to repeat it only adds a way
 * for a correct reply to be rejected.
 */
export const ShareLinkWireSchema = z.object({
  id: z.string().min(1),
  url: z.string().min(1),
  permission: z.enum(['view', 'comment']),
  status: z.enum(['active', 'expired', 'revoked']),
  createdAt: z.string().min(1),
  expiresAt: z.string().min(1).nullable().default(null),
  revokedAt: z.string().min(1).nullable().default(null),
  passwordProtected: z.boolean().default(false),
  viewpointCode: z.string().min(1).max(MAX_VIEWPOINT_CODE_LENGTH).nullable().default(null),
  label: z.string().nullable().default(null),
});

type ShareLinkWire = z.output<typeof ShareLinkWireSchema>;

/** Token = đoạn cuối của `url` máy chủ (`<origin API>/share/<token>`). */
export function shareTokenOf(url: string): string {
  return url.replace(/[?#].*$/, '').replace(/\/+$/, '').split('/').pop() ?? '';
}

/**
 * Trang xem dựng từ origin FE + token: `url` của API mang origin của máy chủ API
 * (`request.base_url`), có thể khác origin FE.
 */
export function shareViewerUrl(token: string, origin: string = globalThis.location?.origin ?? ''): string {
  return `${origin}/share/${encodeURIComponent(token)}`;
}

function toShareLink(wire: ShareLinkWire, projectId: string): ShareLink {
  return { ...wire, url: shareViewerUrl(shareTokenOf(wire.url)), projectId };
}

/** What is sent when a link is made. The password lives here and nowhere else. */
export interface ShareLinkCreateBody {
  readonly permission: SharePermission;
  /** ISO 8601, or `null` for no expiry. The server enforces it. */
  readonly expiresAt: string | null;
  readonly viewpointCode: string | null;
  /** How the receiver's screen should open; mirrors the four embed keys. */
  readonly embed: {
    readonly level: string | null;
    readonly color: string | null;
    readonly toolbar: boolean;
  };
  /**
   * Optional, and the reason this is a POST body rather than a query.
   *
   * It is written once, to a request body, over TLS. It is not logged by
   * `@/lib/http` — that client's request log keeps a request id and a URL and
   * nothing else — and it never comes back.
   */
  readonly password?: string;
  readonly label?: string;
}

/* -------------------------------------------------------------------------- */
/* What can go wrong.                                                          */
/* -------------------------------------------------------------------------- */

/** Which part of the form a complaint belongs to. */
export type ShareLinkRequestField =
  | 'projectId'
  | 'permission'
  | 'expiresAt'
  | 'password'
  | 'viewpoint'
  | 'label';

/** One thing wrong with what was asked for, ready to sit under a field. */
export interface ShareLinkRequestProblem {
  readonly field: ShareLinkRequestField;
  /** Vietnamese sentence, lower case, as invariant A6 requires. */
  readonly message: string;
}

/**
 * Why a share operation did not happen.
 *
 * Three kinds, because the three want three different screens: fix the form,
 * try again later, or tell somebody the server is wrong.
 */
export type ShareLinkFailure =
  | {
      readonly kind: 'invalidRequest';
      readonly message: string;
      readonly problems: readonly ShareLinkRequestProblem[];
    }
  | { readonly kind: 'transport'; readonly message: string; readonly cause: HttpError }
  | { readonly kind: 'contract'; readonly message: string; readonly source: string };

/** What every operation here returns. */
export type ShareLinkResult<T> = Result<T, ShareLinkFailure>;

const TRANSPORT_MESSAGES: Readonly<Record<HttpErrorKind, string>> = {
  network: 'Không kết nối được máy chủ; liên kết chia sẻ chưa thay đổi',
  timeout: 'Máy chủ trả lời quá lâu; liên kết chia sẻ chưa thay đổi',
  aborted: 'Thao tác chia sẻ đã bị huỷ',
  auth: 'Phiên đăng nhập đã hết hiệu lực; đăng nhập lại rồi thử lại',
  http: 'Máy chủ từ chối yêu cầu chia sẻ',
  parse: 'Máy chủ trả về dữ liệu không đọc được',
};

const STATUS_FORBIDDEN = 403;
const STATUS_UNAUTHORISED = 401;
const STATUS_NOT_FOUND = 404;
const STATUS_CONFLICT = 409;
const STATUS_GONE = 410;
const STATUS_UNPROCESSABLE = 422;
const STATUS_TOO_MANY = 429;

function transportMessage(error: HttpError): string {
  if (error.kind === 'http') {
    switch (error.status) {
      case STATUS_UNAUTHORISED:
      case STATUS_FORBIDDEN:
        return 'Tài khoản này không có quyền chia sẻ dự án';
      case STATUS_NOT_FOUND:
      case STATUS_GONE:
        return 'liên kết không còn tồn tại; có thể đã được thu hồi';
      case STATUS_CONFLICT:
        return 'liên kết đã thay đổi ở nơi khác; tải lại danh sách rồi thử lại';
      case STATUS_UNPROCESSABLE:
        return unprocessableShareMessage(error, MAX_SHARE_WINDOW_DAYS);
      case STATUS_TOO_MANY:
        return 'Tạo liên kết quá nhanh (tối đa 20 lượt mỗi 10 phút); chờ một lát rồi thử lại';
      default:
        break;
    }
  }

  return TRANSPORT_MESSAGES[error.kind];
}

function transportFailure(error: HttpError): ShareLinkFailure {
  return { kind: 'transport', message: transportMessage(error), cause: error };
}

function contractFailure(source: string): ShareLinkFailure {
  return {
    kind: 'contract',
    message: 'máy chủ trả về dữ liệu liên kết chia sẻ không đúng hợp đồng',
    source,
  };
}

function invalidRequest(problems: readonly ShareLinkRequestProblem[]): ShareLinkFailure {
  return {
    kind: 'invalidRequest',
    message: problems.map((problem) => problem.message).join('; '),
    problems,
  };
}

/* -------------------------------------------------------------------------- */
/* The transport port.                                                         */
/* -------------------------------------------------------------------------- */

export interface ShareLinkCreateInput {
  readonly projectId: string;
  readonly body: ShareLinkCreateBody;
  readonly signal?: AbortSignal;
}

export interface ShareLinkListInput {
  readonly projectId: string;
  readonly signal?: AbortSignal;
}

export interface ShareLinkRevokeInput {
  readonly projectId: string;
  readonly linkId: string;
  readonly signal?: AbortSignal;
}

/**
 * The three calls this feature makes.
 *
 * Every method returns `unknown` rather than a `ShareLink`: decoding is a
 * decision about trust, and decisions belong on this side of the port with the
 * tests, not in the adapter with the fetch.
 */
export interface ShareLinkGateway {
  /**
   * Whether the server behind this port serves share links at all. `false`
   * means the screens leave the link parts out of the DOM and send nothing.
   */
  readonly supported: boolean;
  create(input: ShareLinkCreateInput): Promise<Result<unknown, HttpError>>;
  list(input: ShareLinkListInput): Promise<Result<unknown, HttpError>>;
  revoke(input: ShareLinkRevokeInput): Promise<Result<unknown, HttpError>>;
}

/**
 * Whether this build talks to a server that serves share links.
 *
 * The three routes — `GET`/`POST /projects/{id}/share-links` and
 * `DELETE /projects/{id}/share-links/{linkId}` (BE-BIND #47–#49) — belong to v2;
 * the v1 server does not mount them and answers 404. This is the one switch:
 * every screen that offers a link reads it, so v2 flips this and nothing else.
 */
export const SHARE_LINKS_SUPPORTED: boolean = true;

/** Where share links live. Ids are escaped: a project id is not a path. */
export const SHARE_LINK_ENDPOINTS = {
  collection: (projectId: string): string =>
    `/projects/${encodeURIComponent(projectId)}/share-links`,
  item: (projectId: string, linkId: string): string =>
    `/projects/${encodeURIComponent(projectId)}/share-links/${encodeURIComponent(linkId)}`,
} as const;

/**
 * The one adapter: the port, over this application's HTTP client.
 *
 * Creation is a `POST` and therefore never single-flighted — that client
 * de-duplicates `GET`s only — so two links asked for in the same second are two
 * links, which is what somebody clicking twice on purpose expects.
 */
export function createHttpShareLinkGateway(http: HttpClient): ShareLinkGateway {
  return {
    supported: SHARE_LINKS_SUPPORTED,
    create: async ({ body, projectId, signal }) =>
      http.post<unknown, ShareLinkCreateBody>(SHARE_LINK_ENDPOINTS.collection(projectId), {
        body,
        ...(signal !== undefined ? { signal } : {}),
      }),
    list: async ({ projectId, signal }) =>
      http.get<unknown>(
        SHARE_LINK_ENDPOINTS.collection(projectId),
        signal !== undefined ? { signal } : undefined,
      ),
    revoke: async ({ linkId, projectId, signal }) =>
      http.delete<unknown>(
        SHARE_LINK_ENDPOINTS.item(projectId, linkId),
        signal !== undefined ? { signal } : {},
      ),
  };
}

/* -------------------------------------------------------------------------- */
/* Asking for a link.                                                          */
/* -------------------------------------------------------------------------- */

/** Shortest password worth calling one. */
export const MIN_SHARE_PASSWORD_LENGTH = 6;

/** Longest the server stores; beyond this is a paste accident, not a password. */
export const MAX_SHARE_PASSWORD_LENGTH = 128;

/**
 * The furthest ahead an expiry may be set.
 *
 * Not a security boundary — the server holds that — but the reason a link
 * cannot quietly become permanent: three months is long enough for a review
 * cycle and short enough that a forgotten link stops working on its own.
 */
export const MAX_SHARE_WINDOW_DAYS = 90;

/** Longest name a link may be given in the list. */
export const MAX_SHARE_LABEL_LENGTH = 80;

/** What a person filled in on the share sheet. */
export interface CreateShareLinkRequest {
  readonly projectId: string;
  readonly permission: SharePermission;
  /** When it should stop working, or `null` for a link with no expiry. */
  readonly expiresAt: Date | null;
  /**
   * Optional second lock. Goes into the request body and nowhere else — never
   * into the returned link, never into a URL, never into storage here.
   */
  readonly password?: string;
  /** The view the sender is looking at right now; travels with the link. */
  readonly viewpoint?: SharedViewpoint | null;
  /** How the receiver's screen should open. */
  readonly embed?: Partial<EmbedParams>;
  readonly label?: string;
  /** The clock the expiry is checked against. Injected so tests are fixed. */
  readonly now?: Date;
  readonly signal?: AbortSignal;
}

const MS_PER_SECOND = 1000;
const SECONDS_PER_MINUTE = 60;
const MINUTES_PER_HOUR = 60;
const HOURS_PER_DAY = 24;
const MS_PER_MINUTE = MS_PER_SECOND * SECONDS_PER_MINUTE;
const MS_PER_HOUR = MS_PER_MINUTE * MINUTES_PER_HOUR;
const MS_PER_DAY = MS_PER_HOUR * HOURS_PER_DAY;

const wholeNumber = (value: number): string => formatNumber(value, { fractionDigits: 0 });

/**
 * Everything wrong with a request, all at once.
 *
 * An empty array means it is worth sending. Exported so a share sheet can
 * validate as somebody types without asking the network anything, and so the
 * rules live in one place rather than once in a form and once here.
 *
 * These are form checks, not access control: the expiry window below stops a
 * typo becoming a decade, while the expiry that decides whether a link opens is
 * checked on the server, every time, forever.
 */
export function validateShareLinkRequest(
  request: CreateShareLinkRequest,
): readonly ShareLinkRequestProblem[] {
  const problems: ShareLinkRequestProblem[] = [];
  const now = request.now ?? new Date();

  if (request.projectId.trim().length === 0) {
    problems.push({ field: 'projectId', message: 'thiếu mã dự án cho liên kết chia sẻ' });
  }

  if (!(SHARE_PERMISSIONS as readonly string[]).includes(request.permission)) {
    problems.push({
      field: 'permission',
      message: `quyền chia sẻ chỉ nhận ${SHARE_PERMISSION_LABELS.view} hoặc ${SHARE_PERMISSION_LABELS.comment}`,
    });
  }

  const { expiresAt } = request;
  if (expiresAt !== null) {
    const remainingMs = expiresAt.getTime() - now.getTime();
    if (Number.isNaN(expiresAt.getTime())) {
      problems.push({ field: 'expiresAt', message: 'hạn dùng không phải một thời điểm hợp lệ' });
    } else if (remainingMs <= 0) {
      problems.push({ field: 'expiresAt', message: 'hạn dùng phải nằm sau thời điểm hiện tại' });
    } else if (remainingMs > MAX_SHARE_WINDOW_DAYS * MS_PER_DAY) {
      problems.push({
        field: 'expiresAt',
        message: `hạn dùng không được quá ${wholeNumber(MAX_SHARE_WINDOW_DAYS)} ngày`,
      });
    }
  }

  const { password } = request;
  if (password !== undefined) {
    if (password !== password.trim()) {
      // Not trimmed silently: a password is compared byte for byte on the
      // server, so quietly removing a stray space would make a link that its
      // own author could not open.
      problems.push({
        field: 'password',
        message: 'Mật khẩu không được bắt đầu hoặc kết thúc bằng khoảng trắng',
      });
    } else if (password.length < MIN_SHARE_PASSWORD_LENGTH) {
      problems.push({
        field: 'password',
        message: `Mật khẩu cần ít nhất ${wholeNumber(MIN_SHARE_PASSWORD_LENGTH)} ký tự`,
      });
    } else if (password.length > MAX_SHARE_PASSWORD_LENGTH) {
      problems.push({
        field: 'password',
        message: `Mật khẩu không được quá ${wholeNumber(MAX_SHARE_PASSWORD_LENGTH)} ký tự`,
      });
    }
  }

  const viewpoint = request.viewpoint ?? null;
  if (viewpoint !== null && !isEncodableLevelId(viewpoint.levelId)) {
    problems.push({
      field: 'viewpoint',
      message: 'góc nhìn hiện tại thuộc một tầng không đặt được vào liên kết',
    });
  }

  if (request.label !== undefined && request.label.trim().length > MAX_SHARE_LABEL_LENGTH) {
    problems.push({
      field: 'label',
      message: `tên liên kết không được quá ${wholeNumber(MAX_SHARE_LABEL_LENGTH)} ký tự`,
    });
  }

  return problems;
}

/**
 * The camera as a code, or a refusal.
 *
 * `encodeViewpoint` throws on a view it cannot represent faithfully — a `NaN`
 * coordinate, a model impossibly far from the datum. Catching it and sending
 * the link anyway would hand somebody a link that opens on the wrong part of
 * the building, so the creation stops instead.
 */
function encodeRequestViewpoint(viewpoint: SharedViewpoint | null): ShareLinkResult<string | null> {
  if (viewpoint === null) {
    return { ok: true, data: null };
  }
  try {
    return { ok: true, data: encodeViewpoint(viewpoint) };
  } catch {
    return {
      ok: false,
      error: invalidRequest([
        { field: 'viewpoint', message: 'không đặt được góc nhìn hiện tại vào liên kết' },
      ]),
    };
  }
}

/**
 * Make a link.
 *
 * Validates first and returns without touching the network when the form is
 * wrong, so a bad expiry costs nothing and a bad password is never transmitted
 * at all.
 *
 * The example writes the second lock as a variable rather than a literal on
 * purpose: `password: '…'` in committed source is what the repository's secret
 * scan refuses, and a documentation example is not a reason to teach the shape.
 *
 * @example
 * const made = await createShareLink(gateway, {
 *   projectId,
 *   permission: 'comment',
 *   expiresAt: sevenDaysFromNow,
 *   password: typedPassphrase,
 *   viewpoint: controller.viewpoint(),
 *   embed: { toolbar: false },
 * });
 * if (made.ok) {
 *   copy(shareLinkUrl(made.data));
 * }
 */
export async function createShareLink(
  gateway: ShareLinkGateway,
  request: CreateShareLinkRequest,
): Promise<ShareLinkResult<ShareLink>> {
  const problems = validateShareLinkRequest(request);
  if (problems.length > 0) {
    return { ok: false, error: invalidRequest(problems) };
  }

  const encoded = encodeRequestViewpoint(request.viewpoint ?? null);
  if (!encoded.ok) {
    return encoded;
  }

  const projectId = request.projectId.trim();
  const embed = toEmbedParams({ ...request.embed, viewpointCode: encoded.data });
  const label = request.label?.trim() ?? '';

  const body: ShareLinkCreateBody = {
    permission: request.permission,
    expiresAt: request.expiresAt === null ? null : request.expiresAt.toISOString(),
    viewpointCode: embed.viewpointCode,
    embed: {
      level: embed.levelId,
      color: embed.coloring,
      toolbar: embed.toolbar,
    },
    ...(request.password !== undefined ? { password: request.password } : {}),
    ...(label.length > 0 ? { label } : {}),
  };

  const response = await gateway.create({
    projectId,
    body,
    ...(request.signal !== undefined ? { signal: request.signal } : {}),
  });

  return decodeOne(response, projectId, 'shareLinks.create');
}

/* -------------------------------------------------------------------------- */
/* Listing what is still alive.                                                */
/* -------------------------------------------------------------------------- */

function decodeOne(
  response: Result<unknown, HttpError>,
  projectId: string,
  source: string,
): ShareLinkResult<ShareLink> {
  if (!response.ok) {
    return { ok: false, error: transportFailure(response.error) };
  }
  const parsed = ShareLinkWireSchema.safeParse(response.data);
  if (!parsed.success) {
    return { ok: false, error: contractFailure(source) };
  }

  return { ok: true, data: toShareLink(parsed.data, projectId) };
}

/**
 * What a listing produced, including what it could not read.
 *
 * The count is not bookkeeping. A screen that dropped rows and said nothing
 * shows a list that looks complete and is not, and the person deciding whether
 * every outstanding link has been revoked would be deciding on a lie. So the
 * number comes back and invariant A11's "một phần" state exists to spend it.
 */
export interface ShareLinkListing {
  readonly links: readonly ShareLink[];
  /** Rows the server sent that this build could not read. Show it, never hide it. */
  readonly unreadableCount: number;
}

/**
 * Every link the server knows about for this project, whatever its state.
 *
 * A row that cannot be read is dropped rather than failing the whole list — one
 * malformed link should not hide the four good ones somebody needs to revoke —
 * but the drop is counted into {@link ShareLinkListing.unreadableCount} rather
 * than swallowed. A reply where **every** row is unreadable comes back as a
 * contract failure instead, because the alternative is an empty list, and an
 * empty list is a sentence — "nobody has this drawing" — that would be a lie.
 */
export async function listShareLinks(
  gateway: ShareLinkGateway,
  input: ShareLinkListInput,
): Promise<ShareLinkResult<ShareLinkListing>> {
  const response = await gateway.list(input);
  if (!response.ok) {
    return { ok: false, error: transportFailure(response.error) };
  }

  const rows = z.array(z.unknown()).safeParse(response.data);
  if (!rows.success) {
    return { ok: false, error: contractFailure('shareLinks.list') };
  }

  const links: ShareLink[] = [];
  for (const row of rows.data) {
    const parsed = ShareLinkWireSchema.safeParse(row);
    if (parsed.success) {
      links.push(toShareLink(parsed.data, input.projectId));
    }
  }

  if (links.length === 0 && rows.data.length > 0) {
    return { ok: false, error: contractFailure('shareLinks.list') };
  }

  return { ok: true, data: { links, unreadableCount: rows.data.length - links.length } };
}

/**
 * The links that still work.
 *
 * Filters on {@link ShareLink.status} — the server's word — and reads no clock.
 * A link the browser believes has expired stays in this list until the server
 * says otherwise, which is correct: the browser's belief is not what the person
 * following the link will meet.
 */
export function selectActiveShareLinks(links: readonly ShareLink[]): readonly ShareLink[] {
  return links.filter((link) => link.status === 'active');
}

/**
 * {@link listShareLinks}, narrowed to the links that still work.
 *
 * {@link ShareLinkListing.unreadableCount} survives the narrowing: a row that
 * could not be read might have been an active link, so hiding the count here
 * would be exactly the reassurance nobody has earned.
 */
export async function listActiveShareLinks(
  gateway: ShareLinkGateway,
  input: ShareLinkListInput,
): Promise<ShareLinkResult<ShareLinkListing>> {
  const result = await listShareLinks(gateway, input);

  return result.ok
    ? { ok: true, data: { ...result.data, links: selectActiveShareLinks(result.data.links) } }
    : result;
}

/* -------------------------------------------------------------------------- */
/* Taking a link back.                                                         */
/* -------------------------------------------------------------------------- */

/**
 * Revoke a link.
 *
 * Returns the link as it now stands, so a list can be updated from the reply
 * rather than re-fetched. A reply that still calls the link active is treated as
 * a broken contract rather than a success: somebody who has been told the revoke
 * worked will not try again, and a link they believe is dead but is not is the
 * worst outcome this whole module has.
 *
 * Revoking is not undoable through invariant A8's toast — a link that has been
 * out in the world cannot be un-shared by a local undo, and the honest interface
 * is a confirm before, not an undo after. Invariant A9 allows exactly that
 * modal.
 */
export async function revokeShareLink(
  gateway: ShareLinkGateway,
  input: ShareLinkRevokeInput,
): Promise<ShareLinkResult<ShareLink>> {
  if (input.linkId.trim().length === 0) {
    return {
      ok: false,
      error: invalidRequest([{ field: 'projectId', message: 'thiếu mã liên kết cần thu hồi' }]),
    };
  }

  const response = await gateway.revoke(input);
  const decoded = decodeOne(response, input.projectId, 'shareLinks.revoke');
  if (!decoded.ok) {
    return decoded;
  }
  if (decoded.data.status === 'active') {
    return {
      ok: false,
      error: {
        kind: 'contract',
        message: 'máy chủ báo liên kết vẫn dùng được sau khi thu hồi; kiểm tra lại rồi thử lại',
        source: 'shareLinks.revoke',
      },
    };
  }

  return decoded;
}

/* -------------------------------------------------------------------------- */
/* Showing a link.                                                             */
/* -------------------------------------------------------------------------- */

/** A sentence about a link's remaining life, and nothing more. */
export interface ShareLinkExpiryDisplay {
  /** Echoed from the server, so a caller never re-derives it. */
  readonly status: ShareLinkStatus;
  /** Vietnamese, ready for a caption. */
  readonly text: string;
  /**
   * The server still calls this link active, but this device's clock is past
   * its expiry.
   *
   * A hint for wording only — it must not gate anything. It is `true` either
   * because the link is about to lapse or because the clock is wrong, and this
   * side cannot tell which.
   */
  readonly clockPastExpiry: boolean;
}

function remainingText(remainingMs: number): string {
  if (remainingMs >= MS_PER_DAY) {
    return `còn ${wholeNumber(Math.ceil(remainingMs / MS_PER_DAY))} ngày`;
  }
  if (remainingMs >= MS_PER_HOUR) {
    return `còn ${wholeNumber(Math.floor(remainingMs / MS_PER_HOUR))} giờ`;
  }
  if (remainingMs >= MS_PER_MINUTE) {
    return `còn ${wholeNumber(Math.floor(remainingMs / MS_PER_MINUTE))} phút`;
  }

  return 'còn dưới một phút';
}

/**
 * What to write under a link in the list.
 *
 * **This is the only function here that reads a clock, and all it produces is a
 * string.** Nothing branches on its output; see rule 1 at the top of this file.
 * A device an hour behind shows an hour too much and opens exactly the same set
 * of links.
 *
 * @param now injected rather than read, so the sentence is testable and so the
 * clock this depends on is visible at the call site.
 */
export function describeShareLinkExpiry(link: ShareLink, now: Date): ShareLinkExpiryDisplay {
  if (link.status !== 'active') {
    return {
      status: link.status,
      text: SHARE_LINK_STATUS_LABELS[link.status],
      clockPastExpiry: false,
    };
  }
  if (link.expiresAt === null) {
    return { status: 'active', text: 'không đặt hạn dùng', clockPastExpiry: false };
  }

  const expiresMs = Date.parse(link.expiresAt);
  if (Number.isNaN(expiresMs)) {
    return {
      status: 'active',
      text: 'không đọc được hạn dùng; máy chủ vẫn là nơi quyết định',
      clockPastExpiry: false,
    };
  }

  const remainingMs = expiresMs - now.getTime();
  if (remainingMs <= 0) {
    return {
      status: 'active',
      text: 'đồng hồ máy này đã qua hạn; máy chủ quyết định khi có người mở',
      clockPastExpiry: true,
    };
  }

  return { status: 'active', text: remainingText(remainingMs), clockPastExpiry: false };
}

/**
 * The caller's screen overrides, with the link's own camera filled in.
 *
 * `null` and absent mean different things here, which is why this is not a
 * `??`. Saying nothing about the camera means "use the one the sender shared";
 * saying `viewpointCode: null` means "open on no particular camera", which is
 * what a host page wants when it frames a fixed overview rather than the corner
 * somebody happened to be looking at. Collapsing the two would make that second
 * request impossible to express.
 */
function withLinkViewpoint(link: ShareLink, embed: Partial<EmbedParams>): Partial<EmbedParams> {
  return embed.viewpointCode !== undefined
    ? embed
    : { ...embed, viewpointCode: link.viewpointCode };
}

/**
 * The address to copy, with the link's own camera and any screen overrides.
 *
 * Idempotent, because {@link buildEmbedUrl} replaces its four keys rather than
 * appending them — a share sheet may rebuild this on every camera move.
 */
export function shareLinkUrl(link: ShareLink, embed: Partial<EmbedParams> = {}): string {
  return buildEmbedUrl(link.url, toEmbedParams(withLinkViewpoint(link, embed)));
}

/**
 * The `<iframe>` snippet for this link, opening on the camera it carries.
 *
 * An explicit `params.viewpointCode` still wins — including an explicit `null`,
 * which drops the camera entirely. See {@link withLinkViewpoint}.
 */
export function shareLinkEmbedCode(
  link: ShareLink,
  input: Omit<EmbedCodeInput, 'url'> = {},
): string {
  return buildEmbedCode({
    ...input,
    url: link.url,
    params: withLinkViewpoint(link, input.params ?? {}),
  });
}
