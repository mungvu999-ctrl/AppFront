import { Vector3 } from 'three';
import { describe, expect, it } from 'vitest';

import { RADIANS_PER_TURN } from '@/domain/units/types';
import type { HttpClient, HttpError, Result } from '@/lib/http';
import {
  encodeViewpoint,
  quantiseViewpoint,
  type SharedViewpoint,
} from '@/lib/three/camera/viewpointCodec';

import {
  DEFAULT_EMBED_HEIGHT_PX,
  DEFAULT_EMBED_PARAMS,
  DEFAULT_EMBED_TITLE,
  DEFAULT_EMBED_WIDTH_PX,
  buildEmbedCode,
  buildEmbedUrl,
  findSecretParams,
  formatEmbedParams,
  parseEmbedParams,
  resolveEmbedView,
  toEmbedParams,
  type EmbedParams,
  type EmbedParamsSource,
} from '../embedParams';
import {
  MAX_SHARE_LABEL_LENGTH,
  MAX_SHARE_PASSWORD_LENGTH,
  MAX_SHARE_WINDOW_DAYS,
  MIN_SHARE_PASSWORD_LENGTH,
  SHARE_LINK_ENDPOINTS,
  SHARE_LINKS_SUPPORTED,
  createHttpShareLinkGateway,
  createShareLink,
  describeShareLinkExpiry,
  listActiveShareLinks,
  listShareLinks,
  revokeShareLink,
  selectActiveShareLinks,
  shareLinkEmbedCode,
  shareLinkUrl,
  validateShareLinkRequest,
  type CreateShareLinkRequest,
  type ShareLink,
  type ShareLinkCreateInput,
  type ShareLinkGateway,
  type ShareLinkListInput,
  type ShareLinkRevokeInput,
} from '../shareLink';

/* -------------------------------------------------------------------------- */
/* Fixtures.                                                                   */
/* -------------------------------------------------------------------------- */

const NOW = new Date('2026-08-17T09:00:00.000Z');
const PROJECT_ID = 'prj-4821';
const SHARE_BASE_URL = 'https://app.example.com/s/8f2c1d';

/**
 * The second lock a sender may put on a link, as somebody would type it.
 *
 * Invented for these tests and distinctive on purpose: half the assertions below
 * are `not.toContain(SAMPLE_PASSPHRASE)` over a URL, a decoded link or a request
 * path, and a bland value could pass those by coincidence. Named without the
 * word the repository's secret scan looks for, because `password = "…"` in
 * committed source is exactly the shape that scan exists to refuse — see
 * `.agent/tools/bin/security-scan.py`.
 */
const SAMPLE_PASSPHRASE = 'mo-cua-2026';

/** Somewhere in the middle of the standard 24,86 m × 10 m sample plan. */
const VIEWPOINT: SharedViewpoint = {
  target: new Vector3(12.43, 1.6, 5),
  azimuthRad: RADIANS_PER_TURN / 4,
  polarRad: RADIANS_PER_TURN / 6,
  distanceM: 18.5,
  mode: 'orbit',
  levelId: 'L-02',
  coloring: 'reviewState',
};

const VIEWPOINT_CODE = encodeViewpoint(VIEWPOINT);

const MS_PER_DAY = 24 * 60 * 60 * 1000;

function daysFromNow(days: number): Date {
  return new Date(NOW.getTime() + days * MS_PER_DAY);
}

/** A reply shaped the way the contract says, with any field overridable. */
function wireLink(overrides: Readonly<Record<string, unknown>> = {}): Record<string, unknown> {
  return {
    id: 'shr-001',
    url: SHARE_BASE_URL,
    permission: 'view',
    status: 'active',
    createdAt: '2026-08-17T08:00:00.000Z',
    expiresAt: '2026-08-24T08:00:00.000Z',
    revokedAt: null,
    passwordProtected: false,
    viewpointCode: VIEWPOINT_CODE,
    label: 'Gửi tư vấn giám sát',
    ...overrides,
  };
}

function link(overrides: Partial<ShareLink> = {}): ShareLink {
  return {
    id: 'shr-001',
    projectId: PROJECT_ID,
    url: SHARE_BASE_URL,
    permission: 'view',
    status: 'active',
    createdAt: '2026-08-17T08:00:00.000Z',
    expiresAt: '2026-08-24T08:00:00.000Z',
    revokedAt: null,
    passwordProtected: false,
    viewpointCode: VIEWPOINT_CODE,
    label: null,
    ...overrides,
  };
}

function httpError(
  kind: HttpError['kind'],
  status?: number,
  wire?: { readonly code: string; readonly field?: string },
): HttpError {
  return {
    kind,
    requestId: 'req-1',
    retryable: false,
    raw: wire === undefined ? null : { ...wire, requestId: 'req-1' },
    ...(status !== undefined ? { status } : {}),
    ...(wire !== undefined ? { code: wire.code } : {}),
  };
}

interface GatewayHarness {
  readonly gateway: ShareLinkGateway;
  readonly createInputs: ShareLinkCreateInput[];
  readonly listInputs: ShareLinkListInput[];
  readonly revokeInputs: ShareLinkRevokeInput[];
}

interface GatewayReplies {
  readonly create?: Result<unknown, HttpError>;
  readonly list?: Result<unknown, HttpError>;
  readonly revoke?: Result<unknown, HttpError>;
}

/** The port, stubbed. No network, no HTTP client, no fetch. */
function harness(replies: GatewayReplies = {}): GatewayHarness {
  const createInputs: ShareLinkCreateInput[] = [];
  const listInputs: ShareLinkListInput[] = [];
  const revokeInputs: ShareLinkRevokeInput[] = [];

  return {
    createInputs,
    listInputs,
    revokeInputs,
    gateway: {
      supported: true,
      create: async (input) => {
        createInputs.push(input);

        return replies.create ?? { ok: true, data: wireLink() };
      },
      list: async (input) => {
        listInputs.push(input);

        return replies.list ?? { ok: true, data: [wireLink()] };
      },
      revoke: async (input) => {
        revokeInputs.push(input);

        return (
          replies.revoke ?? {
            ok: true,
            data: wireLink({ status: 'revoked', revokedAt: NOW.toISOString() }),
          }
        );
      },
    },
  };
}

function request(overrides: Partial<CreateShareLinkRequest> = {}): CreateShareLinkRequest {
  return {
    projectId: PROJECT_ID,
    permission: 'view',
    expiresAt: daysFromNow(7),
    now: NOW,
    ...overrides,
  };
}

function fields(problems: readonly { readonly field: string }[]): string[] {
  return problems.map((problem) => problem.field);
}

/* -------------------------------------------------------------------------- */
/* embedParams — reading a link.                                               */
/* -------------------------------------------------------------------------- */

describe('parseEmbedParams', () => {
  it('opens at the defaults when the link says nothing', () => {
    const sources: EmbedParamsSource[] = [
      undefined,
      null,
      '',
      '   ',
      'https://app.example.com/s/8f2c1d',
      new URLSearchParams(),
      {},
    ];

    for (const source of sources) {
      const result = parseEmbedParams(source);

      expect(result.params).toEqual(DEFAULT_EMBED_PARAMS);
      expect(result.ignored).toEqual([]);
    }
  });

  it('falls back per field and never throws on rubbish', () => {
    const result = parseEmbedParams(
      'https://app.example.com/s/8f2c1d?level=tầng 2&color=neon&toolbar=maybe&v=zzzz',
    );

    // Every field back to its default: nothing here can blank a screen.
    expect(result.params).toEqual(DEFAULT_EMBED_PARAMS);

    expect(result.ignored.map((entry) => entry.problem)).toEqual([
      'malformedLevel',
      'unknownColoring',
      'malformedToolbar',
      'unreadableViewpoint',
    ]);
    // Each complaint is a Vietnamese sentence somebody can act on.
    for (const entry of result.ignored) {
      expect(entry.message.length).toBeGreaterThan(0);
      expect(entry.message).toBe(entry.message.toLocaleLowerCase('vi-VN'));
    }
  });

  it('keeps the good fields when only one is broken', () => {
    const result = parseEmbedParams('?level=L-03&color=notAMode&toolbar=0');

    expect(result.params.levelId).toBe('L-03');
    expect(result.params.toolbar).toBe(false);
    expect(result.params.coloring).toBeNull();
    expect(result.ignored).toHaveLength(1);
  });

  it('takes the first value of a repeated key and says so', () => {
    const result = parseEmbedParams('?level=L-01&level=L-02');

    expect(result.params.levelId).toBe('L-01');
    expect(result.ignored[0]?.problem).toBe('repeated');
    expect(result.ignored[0]?.value).toBe('L-02');
  });

  it('understands a bare storey code and a differently-cased mode', () => {
    const result = parseEmbedParams('?level=02&color=ROOMUSAGE');

    expect(result.params.levelId).toBe('L-02');
    expect(result.params.coloring).toBe('roomUsage');
    expect(result.ignored).toEqual([]);
  });

  it('reads every spelling of yes and no', () => {
    for (const word of ['1', 'true', 'TRUE', 'yes', 'on']) {
      expect(parseEmbedParams(`?toolbar=${word}`).params.toolbar).toBe(true);
    }
    for (const word of ['0', 'false', 'FALSE', 'no', 'off']) {
      expect(parseEmbedParams(`?toolbar=${word}`).params.toolbar).toBe(false);
    }
  });

  it('reads parameters a hash router left in the fragment', () => {
    const result = parseEmbedParams('https://app.example.com/#/projects/7/3d?level=L-04&toolbar=0');

    expect(result.params.levelId).toBe('L-04');
    expect(result.params.toolbar).toBe(false);
  });

  it('lets the query win over the fragment for the same key', () => {
    const result = parseEmbedParams('https://app.example.com/?level=L-01#/view?level=L-09');

    expect(result.params.levelId).toBe('L-01');
  });

  it('treats an empty value as absence rather than a mistake', () => {
    const result = parseEmbedParams('?level=&color=&toolbar=&v=');

    expect(result.params).toEqual(DEFAULT_EMBED_PARAMS);
    expect(result.ignored).toEqual([]);
  });

  it('survives anything at all', () => {
    const nasty: unknown[] = [
      42,
      true,
      Symbol('x'),
      () => undefined,
      [],
      { level: { deep: true }, color: null, toolbar: [], v: undefined },
      '???&&&===',
      '%%%',
      'https://app.example.com/?v=' + 'A'.repeat(500),
      '#',
      '?',
      'javascript:alert(1)',
      ' \uFFFF\uD800',
    ];

    for (const source of nasty) {
      const call = (): unknown => parseEmbedParams(source as EmbedParamsSource);

      expect(call).not.toThrow();
      expect(parseEmbedParams(source as EmbedParamsSource).params.toolbar).toBe(true);
    }
  });
});

/* -------------------------------------------------------------------------- */
/* embedParams — the round trip.                                               */
/* -------------------------------------------------------------------------- */

describe('the round trip through a link', () => {
  it('gives back exactly the state it was given', () => {
    const params: EmbedParams = {
      levelId: 'L-03',
      coloring: 'area',
      toolbar: false,
      viewpointCode: VIEWPOINT_CODE,
    };

    const url = buildEmbedUrl(SHARE_BASE_URL, params);

    expect(parseEmbedParams(url).params).toEqual(params);
    expect(parseEmbedParams(url).ignored).toEqual([]);
  });

  it('gives back the same camera, on the grid the code stores it on', () => {
    const url = buildEmbedUrl(SHARE_BASE_URL, toEmbedParams({ viewpointCode: VIEWPOINT_CODE }));
    const view = resolveEmbedView(parseEmbedParams(url).params);

    expect(view.viewpoint).toEqual(quantiseViewpoint(VIEWPOINT));
    // With nothing else in the link, the camera's own storey and colouring win.
    expect(view.levelId).toBe(VIEWPOINT.levelId);
    expect(view.coloring).toBe(VIEWPOINT.coloring);
    expect(view.toolbar).toBe(true);
  });

  it('lets the query override the camera code, and reconciles the camera to it', () => {
    const url = buildEmbedUrl(SHARE_BASE_URL, {
      levelId: 'L-03',
      coloring: 'area',
      toolbar: false,
      viewpointCode: VIEWPOINT_CODE,
    });

    const view = resolveEmbedView(parseEmbedParams(url).params);

    expect(view.levelId).toBe('L-03');
    expect(view.coloring).toBe('area');
    // The camera comes back agreeing with the two fields beside it, so applying
    // it cannot land the reviewer on the storey the code happened to carry.
    expect(view.viewpoint).toEqual({
      ...quantiseViewpoint(VIEWPOINT),
      levelId: 'L-03',
      coloring: 'area',
    });
  });

  it('drops an unreadable camera without losing the rest of the screen', () => {
    const truncated = VIEWPOINT_CODE.slice(0, VIEWPOINT_CODE.length - 4);
    const result = parseEmbedParams(`?level=L-03&color=area&v=${truncated}`);
    const view = resolveEmbedView(result.params);

    expect(view.viewpoint).toBeNull();
    expect(view.levelId).toBe('L-03');
    expect(view.coloring).toBe('area');
    expect(result.ignored[0]?.problem).toBe('unreadableViewpoint');
  });

  it('resolves a screen out of nothing at all', () => {
    expect(resolveEmbedView(DEFAULT_EMBED_PARAMS)).toEqual({
      levelId: null,
      coloring: 'default',
      toolbar: true,
      viewpoint: null,
    });
  });
});

/* -------------------------------------------------------------------------- */
/* embedParams — writing a link.                                               */
/* -------------------------------------------------------------------------- */

describe('buildEmbedUrl', () => {
  it('writes nothing for a screen that is already the default', () => {
    expect(formatEmbedParams(DEFAULT_EMBED_PARAMS)).toBe('');
    expect(buildEmbedUrl(SHARE_BASE_URL, DEFAULT_EMBED_PARAMS)).toBe(SHARE_BASE_URL);
  });

  it("keeps the server's own path, parameters and fragment", () => {
    const url = buildEmbedUrl('https://app.example.com/s/8f2c1d?ref=email#plan', {
      ...DEFAULT_EMBED_PARAMS,
      levelId: 'L-02',
    });

    expect(url).toContain('ref=email');
    expect(url).toContain('level=L-02');
    expect(url.endsWith('#plan')).toBe(true);
    expect(url.startsWith('https://app.example.com/s/8f2c1d?')).toBe(true);
  });

  it('replaces its own keys instead of appending them', () => {
    const first = buildEmbedUrl(SHARE_BASE_URL, { ...DEFAULT_EMBED_PARAMS, levelId: 'L-02' });
    const second = buildEmbedUrl(first, { ...DEFAULT_EMBED_PARAMS, levelId: 'L-05' });

    expect(second).toContain('level=L-05');
    expect(second).not.toContain('L-02');
    // Idempotent: a share sheet may rebuild this on every camera move.
    expect(buildEmbedUrl(second, { ...DEFAULT_EMBED_PARAMS, levelId: 'L-05' })).toBe(second);
  });

  it('works on a relative address as well as an absolute one', () => {
    const url = buildEmbedUrl('/projects/7/3d', { ...DEFAULT_EMBED_PARAMS, toolbar: false });

    expect(url).toBe('/projects/7/3d?toolbar=0');
    expect(parseEmbedParams(url).params.toolbar).toBe(false);
  });

  it('refuses to write a value this build cannot honour', () => {
    const bogus = {
      levelId: 'L-tầng 2',
      coloring: 'neon',
      toolbar: true,
      viewpointCode: 'not-a-code',
    } as unknown as EmbedParams;

    // A hand-built record loses the bad fields rather than producing a link
    // that reads back with three complaints attached.
    expect(formatEmbedParams(bogus)).toBe('v=not-a-code');
  });
});

/* -------------------------------------------------------------------------- */
/* embedParams — the snippet for somebody else's page.                         */
/* -------------------------------------------------------------------------- */

describe('buildEmbedCode', () => {
  it('produces a frame carrying the screen the link asked for', () => {
    const code = buildEmbedCode({
      url: SHARE_BASE_URL,
      title: 'Mặt bằng tầng 2',
      params: { levelId: 'L-02', coloring: 'area', toolbar: false },
    });

    expect(code.startsWith('<iframe src="')).toBe(true);
    expect(code.endsWith('></iframe>')).toBe(true);
    expect(code).toContain('level=L-02');
    expect(code).toContain('color=area');
    expect(code).toContain('toolbar=0');
    // Ampersands are escaped, because this is markup on somebody else's page.
    expect(code).toContain('&amp;');
    expect(code).toContain('title="Mặt bằng tầng 2"');
    expect(code).toContain('referrerpolicy="no-referrer"');
    expect(code).toContain('loading="lazy"');
  });

  it('escapes a title that would otherwise break out of its attribute', () => {
    const code = buildEmbedCode({
      url: SHARE_BASE_URL,
      title: 'Dự án "A" <script>alert(1)</script>',
    });

    expect(code).not.toContain('<script>');
    expect(code).toContain('&quot;A&quot;');
    expect(code).toContain('&lt;script&gt;');
  });

  it('names the frame even when nobody gave it a name', () => {
    expect(buildEmbedCode({ url: SHARE_BASE_URL })).toContain(`title="${DEFAULT_EMBED_TITLE}"`);
    expect(buildEmbedCode({ url: SHARE_BASE_URL, title: '   ' })).toContain(
      `title="${DEFAULT_EMBED_TITLE}"`,
    );
  });

  it('falls back to a usable size rather than emitting a broken one', () => {
    for (const side of [Number.NaN, Number.POSITIVE_INFINITY, 0, -400, 99999]) {
      const code = buildEmbedCode({ url: SHARE_BASE_URL, widthPx: side, heightPx: side });

      expect(code).toContain(`width="${String(DEFAULT_EMBED_WIDTH_PX)}"`);
      expect(code).toContain(`height="${String(DEFAULT_EMBED_HEIGHT_PX)}"`);
    }

    expect(buildEmbedCode({ url: SHARE_BASE_URL, widthPx: 1280.4 })).toContain('width="1280"');
  });
});

/* -------------------------------------------------------------------------- */
/* embedParams — nothing sensitive reaches an address.                         */
/* -------------------------------------------------------------------------- */

describe('findSecretParams', () => {
  it('names credential-shaped parameters in a query or a fragment', () => {
    expect(findSecretParams('https://x.example.com/?password=abc&level=L-01')).toEqual(['password']);
    expect(findSecretParams('https://x.example.com/#/v?access_token=abc')).toEqual(['access_token']);
    expect(findSecretParams('https://x.example.com/?PassWord=a&SECRET=b')).toEqual([
      'password',
      'secret',
    ]);
  });

  it('leaves an opaque share address alone', () => {
    // The unguessable address *is* the capability; that is the mechanism, not
    // a leak. What must never appear is what unlocks more than this one view.
    expect(findSecretParams(SHARE_BASE_URL)).toEqual([]);
    expect(findSecretParams('https://x.example.com/s/8f2c1d?level=L-02&v=abc')).toEqual([]);
    expect(findSecretParams('not a url at all')).toEqual([]);
  });
});

/* -------------------------------------------------------------------------- */
/* shareLink — checking the form before anything is sent.                      */
/* -------------------------------------------------------------------------- */

describe('validateShareLinkRequest', () => {
  it('accepts a filled-in share sheet', () => {
    expect(
      validateShareLinkRequest(
        request({ permission: 'comment', password: SAMPLE_PASSPHRASE, viewpoint: VIEWPOINT }),
      ),
    ).toEqual([]);
  });

  it('accepts a link with no expiry and no password', () => {
    expect(validateShareLinkRequest(request({ expiresAt: null }))).toEqual([]);
  });

  it('refuses an expiry in the past, too far out, or not a date', () => {
    expect(fields(validateShareLinkRequest(request({ expiresAt: daysFromNow(-1) })))).toEqual([
      'expiresAt',
    ]);
    expect(fields(validateShareLinkRequest(request({ expiresAt: NOW })))).toEqual(['expiresAt']);
    expect(
      fields(
        validateShareLinkRequest(request({ expiresAt: daysFromNow(MAX_SHARE_WINDOW_DAYS + 1) })),
      ),
    ).toEqual(['expiresAt']);
    expect(
      fields(validateShareLinkRequest(request({ expiresAt: new Date('không phải ngày') }))),
    ).toEqual(['expiresAt']);
  });

  it('allows an expiry exactly at the edge of the window', () => {
    expect(
      validateShareLinkRequest(request({ expiresAt: daysFromNow(MAX_SHARE_WINDOW_DAYS) })),
    ).toEqual([]);
  });

  it('refuses a password that would lock its own author out', () => {
    expect(fields(validateShareLinkRequest(request({ password: ` ${SAMPLE_PASSPHRASE} ` })))).toEqual([
      'password',
    ]);
    expect(
      fields(validateShareLinkRequest(request({ password: 'a'.repeat(MIN_SHARE_PASSWORD_LENGTH - 1) }))),
    ).toEqual(['password']);
    expect(
      fields(validateShareLinkRequest(request({ password: 'a'.repeat(MAX_SHARE_PASSWORD_LENGTH + 1) }))),
    ).toEqual(['password']);
    expect(
      validateShareLinkRequest(request({ password: 'a'.repeat(MIN_SHARE_PASSWORD_LENGTH) })),
    ).toEqual([]);
  });

  it('refuses a project, a permission, a storey or a name it cannot use', () => {
    expect(fields(validateShareLinkRequest(request({ projectId: '   ' })))).toEqual(['projectId']);
    expect(
      fields(
        validateShareLinkRequest(
          request({ permission: 'edit' as CreateShareLinkRequest['permission'] }),
        ),
      ),
    ).toEqual(['permission']);
    expect(
      fields(
        validateShareLinkRequest(
          request({ viewpoint: { ...VIEWPOINT, levelId: 'L-tầng hầm 1' } }),
        ),
      ),
    ).toEqual(['viewpoint']);
    expect(
      fields(validateShareLinkRequest(request({ label: 'a'.repeat(MAX_SHARE_LABEL_LENGTH + 1) }))),
    ).toEqual(['label']);
  });

  it('reports every problem at once rather than one per attempt', () => {
    const problems = validateShareLinkRequest(
      request({ projectId: '', expiresAt: daysFromNow(-3), password: 'x' }),
    );

    expect(fields(problems)).toEqual(['projectId', 'expiresAt', 'password']);
  });
});

/* -------------------------------------------------------------------------- */
/* shareLink — making a link.                                                  */
/* -------------------------------------------------------------------------- */

describe('createShareLink', () => {
  it('sends nothing at all when the form is wrong', async () => {
    const { gateway, createInputs } = harness();

    const result = await createShareLink(gateway, request({ expiresAt: daysFromNow(-1) }));

    expect(result.ok).toBe(false);
    expect(result.ok ? null : result.error.kind).toBe('invalidRequest');
    // The point: a rejected password never reaches the wire.
    expect(createInputs).toEqual([]);
  });

  it('puts the password in the body and nowhere else', async () => {
    const { gateway, createInputs } = harness();

    const result = await createShareLink(
      gateway,
      request({ permission: 'comment', password: SAMPLE_PASSPHRASE, viewpoint: VIEWPOINT }),
    );

    const sent = createInputs[0];
    expect(sent?.body.password).toBe(SAMPLE_PASSPHRASE);
    expect(sent?.projectId).toBe(PROJECT_ID);

    // Not in the address the gateway was asked to call, and not in the link
    // that comes back.
    expect(JSON.stringify(sent?.projectId)).not.toContain(SAMPLE_PASSPHRASE);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(JSON.stringify(result.data)).not.toContain(SAMPLE_PASSPHRASE);
      expect(findSecretParams(shareLinkUrl(result.data))).toEqual([]);
      expect(shareLinkUrl(result.data)).not.toContain(SAMPLE_PASSPHRASE);
    }
  });

  it('drops a password a server mistakenly echoed back', async () => {
    const { gateway } = harness({
      create: { ok: true, data: wireLink({ password: SAMPLE_PASSPHRASE, sessionToken: 'sess-9' }) },
    });

    const result = await createShareLink(gateway, request({ password: SAMPLE_PASSPHRASE }));

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(JSON.stringify(result.data)).not.toContain(SAMPLE_PASSPHRASE);
      expect(JSON.stringify(result.data)).not.toContain('sess-9');
    }
  });

  it('carries the camera the sender was looking through', async () => {
    const { gateway, createInputs } = harness();

    await createShareLink(gateway, request({ viewpoint: VIEWPOINT, embed: { toolbar: false } }));

    const body = createInputs[0]?.body;
    expect(body?.viewpointCode).toBe(VIEWPOINT_CODE);
    expect(body?.embed).toEqual({ level: null, color: null, toolbar: false });
    expect(body?.expiresAt).toBe(daysFromNow(7).toISOString());
    expect(body?.permission).toBe('view');
  });

  it('omits the password and the name when they were not given', async () => {
    const { gateway, createInputs } = harness();

    await createShareLink(gateway, request({ label: '   ' }));

    expect(createInputs[0]?.body).not.toHaveProperty('password');
    expect(createInputs[0]?.body).not.toHaveProperty('label');
  });

  it('refuses a camera it cannot write down rather than pointing somewhere else', async () => {
    const { gateway, createInputs } = harness();

    const result = await createShareLink(
      gateway,
      request({ viewpoint: { ...VIEWPOINT, target: new Vector3(Number.NaN, 0, 0) } }),
    );

    expect(result.ok).toBe(false);
    expect(result.ok ? null : result.error.kind).toBe('invalidRequest');
    expect(createInputs).toEqual([]);
  });

  it('turns a transport fault into a sentence somebody can act on', async () => {
    const cases: readonly [HttpError, string][] = [
      [httpError('network'), 'Không kết nối được máy chủ; liên kết chia sẻ chưa thay đổi'],
      [httpError('http', 403), 'Tài khoản này không có quyền chia sẻ dự án'],
      [httpError('http', 429), 'Tạo liên kết quá nhanh (tối đa 20 lượt mỗi 10 phút); chờ một lát rồi thử lại'],
      [httpError('http', 422), 'Máy chủ không chấp nhận hạn dùng hoặc mật khẩu này'],
      [
        httpError('http', 422, { code: 'SHARE_LINK_LIMIT_REACHED' }),
        'Dự án đã có 50 liên kết đang dùng; hãy thu hồi bớt một liên kết rồi tạo lại',
      ],
      [
        httpError('http', 422, { code: 'VALIDATION', field: 'expiresAt' }),
        'Hạn dùng phải sau thời điểm hiện tại và không quá 90 ngày',
      ],
      [
        httpError('http', 422, { code: 'VALIDATION', field: 'permission' }),
        'Liên kết mới chỉ có quyền xem',
      ],
      [httpError('http', 500), 'Máy chủ từ chối yêu cầu chia sẻ'],
    ];

    for (const [error, message] of cases) {
      const { gateway } = harness({ create: { ok: false, error } });
      const result = await createShareLink(gateway, request());

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.kind).toBe('transport');
        expect(result.error.message).toBe(message);
      }
    }
  });

  it('reports a reply it cannot read rather than inventing a link', async () => {
    const { gateway } = harness({ create: { ok: true, data: { id: 'shr-1' } } });

    const result = await createShareLink(gateway, request());

    expect(result.ok).toBe(false);
    expect(result.ok ? null : result.error.kind).toBe('contract');
  });
});

/* -------------------------------------------------------------------------- */
/* shareLink — the links still alive.                                          */
/* -------------------------------------------------------------------------- */

describe('listing links', () => {
  it('returns every link the server knows about', async () => {
    const { gateway, listInputs } = harness({
      list: {
        ok: true,
        data: [wireLink(), wireLink({ id: 'shr-002', status: 'revoked' })],
      },
    });

    const result = await listShareLinks(gateway, { projectId: PROJECT_ID });

    expect(result.ok).toBe(true);
    expect(result.ok ? result.data.links.map((entry) => entry.id) : []).toEqual([
      'shr-001',
      'shr-002',
    ]);
    // The project the caller asked about, not one the server had to repeat.
    expect(result.ok ? result.data.links[0]?.projectId : null).toBe(PROJECT_ID);
    expect(result.ok ? result.data.unreadableCount : null).toBe(0);
    expect(listInputs[0]?.projectId).toBe(PROJECT_ID);
  });

  it('drops one unreadable row but counts it rather than swallowing it', async () => {
    const { gateway } = harness({
      list: { ok: true, data: [wireLink(), { id: 'shr-002' }, wireLink({ id: 'shr-003' })] },
    });

    const result = await listShareLinks(gateway, { projectId: PROJECT_ID });

    expect(result.ok ? result.data.links.map((entry) => entry.id) : []).toEqual([
      'shr-001',
      'shr-003',
    ]);
    // The count is what invariant A11's "một phần" state is built out of: a
    // list that dropped a row and said nothing looks complete and is not.
    expect(result.ok ? result.data.unreadableCount : null).toBe(1);
  });

  it('refuses to show an empty list when nothing could be read', async () => {
    const { gateway } = harness({ list: { ok: true, data: [{ id: 'a' }, { id: 'b' }] } });

    const result = await listShareLinks(gateway, { projectId: PROJECT_ID });

    // An empty list is a sentence — "nobody has this drawing" — and it would
    // be a lie here.
    expect(result.ok).toBe(false);
    expect(result.ok ? null : result.error.kind).toBe('contract');
  });

  it('shows a genuinely empty project as empty', async () => {
    const { gateway } = harness({ list: { ok: true, data: [] } });

    const result = await listShareLinks(gateway, { projectId: PROJECT_ID });

    expect(result).toEqual({ ok: true, data: { links: [], unreadableCount: 0 } });
  });

  it('filters on the server’s verdict, never on this machine’s clock', async () => {
    const longExpired = link({ id: 'shr-clock', expiresAt: '2020-01-01T00:00:00.000Z' });
    const serverExpired = link({ id: 'shr-server', status: 'expired', expiresAt: null });

    // The first link's expiry is years past by this clock and the server still
    // calls it active; the second has no expiry at all and the server calls it
    // expired. The server wins both times.
    expect(selectActiveShareLinks([longExpired, serverExpired]).map((entry) => entry.id)).toEqual([
      'shr-clock',
    ]);
  });

  it('narrows the fetched list to the links that still work', async () => {
    const { gateway } = harness({
      list: {
        ok: true,
        data: [
          wireLink(),
          wireLink({ id: 'shr-002', status: 'revoked' }),
          wireLink({ id: 'shr-003', status: 'expired' }),
        ],
      },
    });

    const result = await listActiveShareLinks(gateway, { projectId: PROJECT_ID });

    expect(result.ok ? result.data.links.map((entry) => entry.id) : []).toEqual(['shr-001']);
  });

  it('keeps the unreadable count through the narrowing', async () => {
    const { gateway } = harness({
      list: { ok: true, data: [wireLink(), { id: 'broken' }] },
    });

    const result = await listActiveShareLinks(gateway, { projectId: PROJECT_ID });

    // A row that could not be read might have been an active link, so hiding
    // the count here would be exactly the reassurance nobody has earned.
    expect(result.ok ? result.data.unreadableCount : null).toBe(1);
  });

  it('passes a transport fault through unchanged', async () => {
    const { gateway } = harness({ list: { ok: false, error: httpError('timeout') } });

    const result = await listActiveShareLinks(gateway, { projectId: PROJECT_ID });

    expect(result.ok).toBe(false);
    expect(result.ok ? null : result.error.kind).toBe('transport');
  });
});

/* -------------------------------------------------------------------------- */
/* shareLink — taking a link back.                                             */
/* -------------------------------------------------------------------------- */

describe('revokeShareLink', () => {
  it('returns the link as it now stands', async () => {
    const { gateway, revokeInputs } = harness();

    const result = await revokeShareLink(gateway, { projectId: PROJECT_ID, linkId: 'shr-001' });

    expect(result.ok).toBe(true);
    expect(result.ok ? result.data.status : null).toBe('revoked');
    expect(result.ok ? result.data.revokedAt : null).toBe(NOW.toISOString());
    expect(revokeInputs[0]).toEqual({ projectId: PROJECT_ID, linkId: 'shr-001' });
  });

  it('refuses to call a revoke successful when the link still works', async () => {
    const { gateway } = harness({ revoke: { ok: true, data: wireLink({ status: 'active' }) } });

    const result = await revokeShareLink(gateway, { projectId: PROJECT_ID, linkId: 'shr-001' });

    // Somebody told the revoke worked will not click it again.
    expect(result.ok).toBe(false);
    expect(result.ok ? null : result.error.kind).toBe('contract');
  });

  it('explains a link that was already gone', async () => {
    const { gateway } = harness({ revoke: { ok: false, error: httpError('http', 404) } });

    const result = await revokeShareLink(gateway, { projectId: PROJECT_ID, linkId: 'shr-001' });

    expect(result.ok ? null : result.error.message).toBe(
      'liên kết không còn tồn tại; có thể đã được thu hồi',
    );
  });

  it('asks for nothing when there is no link to revoke', async () => {
    const { gateway, revokeInputs } = harness();

    const result = await revokeShareLink(gateway, { projectId: PROJECT_ID, linkId: '  ' });

    expect(result.ok).toBe(false);
    expect(revokeInputs).toEqual([]);
  });
});

/* -------------------------------------------------------------------------- */
/* shareLink — what the list says out loud.                                    */
/* -------------------------------------------------------------------------- */

describe('describeShareLinkExpiry', () => {
  it('reads back the server’s verdict for a link that is done', () => {
    expect(describeShareLinkExpiry(link({ status: 'expired' }), NOW)).toEqual({
      status: 'expired',
      text: 'đã hết hạn',
      clockPastExpiry: false,
    });
    expect(describeShareLinkExpiry(link({ status: 'revoked' }), NOW).text).toBe('đã thu hồi');
  });

  it('counts down in the largest unit that still says something (6 ngày 23 giờ làm tròn lên 7 ngày)', () => {
    expect(describeShareLinkExpiry(link({ expiresAt: '2026-08-24T08:00:00.000Z' }), NOW).text).toBe(
      'còn 7 ngày',
    );
    expect(describeShareLinkExpiry(link({ expiresAt: '2026-08-17T14:30:00.000Z' }), NOW).text).toBe(
      'còn 5 giờ',
    );
    expect(describeShareLinkExpiry(link({ expiresAt: '2026-08-17T09:30:00.000Z' }), NOW).text).toBe(
      'còn 30 phút',
    );
    expect(describeShareLinkExpiry(link({ expiresAt: '2026-08-17T09:00:30.000Z' }), NOW).text).toBe(
      'còn dưới một phút',
    );
    expect(describeShareLinkExpiry(link({ expiresAt: null }), NOW).text).toBe('không đặt hạn dùng');
  });

  it('says whose decision it is when this clock disagrees with the server', () => {
    const display = describeShareLinkExpiry(link({ expiresAt: '2020-01-01T00:00:00.000Z' }), NOW);

    expect(display.status).toBe('active');
    expect(display.clockPastExpiry).toBe(true);
    expect(display.text).toContain('máy chủ quyết định');
  });

  it('does not guess at an expiry it cannot read', () => {
    const display = describeShareLinkExpiry(link({ expiresAt: 'hôm nào đó' }), NOW);

    expect(display.status).toBe('active');
    expect(display.clockPastExpiry).toBe(false);
    expect(display.text).toContain('máy chủ');
  });
});

/* -------------------------------------------------------------------------- */
/* shareLink — from the share sheet to the receiver's screen.                  */
/* -------------------------------------------------------------------------- */

describe('the whole trip, sender to receiver', () => {
  it('opens the receiver on the view the sender was looking at', async () => {
    const { gateway } = harness();

    const made = await createShareLink(
      gateway,
      request({ permission: 'comment', password: SAMPLE_PASSPHRASE, viewpoint: VIEWPOINT }),
    );

    expect(made.ok).toBe(true);
    if (!made.ok) {
      return;
    }

    // What the sender copies.
    const url = shareLinkUrl(made.data, { toolbar: false });

    // What the receiver's browser hands the application.
    const opened = parseEmbedParams(url);
    const view = resolveEmbedView(opened.params);

    expect(opened.ignored).toEqual([]);
    expect(view.viewpoint).toEqual(quantiseViewpoint(VIEWPOINT));
    expect(view.levelId).toBe(VIEWPOINT.levelId);
    expect(view.coloring).toBe(VIEWPOINT.coloring);
    expect(view.toolbar).toBe(false);

    // And nothing that unlocks anything travelled with it.
    expect(findSecretParams(url)).toEqual([]);
    expect(url).not.toContain(SAMPLE_PASSPHRASE);
  });

  it('builds an embed snippet that carries the link’s own camera', () => {
    const code = shareLinkEmbedCode(link(), { title: 'Mặt bằng', widthPx: 800, heightPx: 500 });

    expect(code).toContain(`v=${VIEWPOINT_CODE}`);
    expect(code).toContain('width="800"');
    expect(code).toContain('height="500"');
  });

  it('lets a host page pin its own camera over the link’s', () => {
    const code = shareLinkEmbedCode(link(), { params: { viewpointCode: null, levelId: 'L-01' } });

    expect(code).toContain('level=L-01');
    expect(code).not.toContain(VIEWPOINT_CODE);
  });

  it('adds a screen override without disturbing the address it was given', () => {
    const url = shareLinkUrl(link({ url: 'https://app.example.com/s/x?ref=email' }), {
      coloring: 'violationSeverity',
    });

    expect(url).toContain('ref=email');
    expect(url).toContain('color=violationSeverity');
    expect(parseEmbedParams(url).params.coloring).toBe('violationSeverity');
  });
});

/* -------------------------------------------------------------------------- */
/* shareLink — the one adapter.                                                */
/* -------------------------------------------------------------------------- */

interface HttpCall {
  readonly method: string;
  readonly path: string;
  readonly options: unknown;
}

/**
 * A stand-in for the HTTP client, recording what it was asked to do.
 *
 * Cast once, deliberately: only the four verbs are exercised, and writing the
 * rest of the interface out would add nothing this test checks.
 */
function recordingHttpClient(calls: HttpCall[]): HttpClient {
  const capture =
    (method: string) =>
    async (path: string, options?: unknown): Promise<Result<unknown, HttpError>> => {
      calls.push({ method, path, options });

      return { ok: true, data: wireLink() };
    };

  return {
    delete: capture('DELETE'),
    get: capture('GET'),
    patch: capture('PATCH'),
    post: capture('POST'),
    put: capture('PUT'),
    events: { emit: () => undefined, on: () => () => undefined },
    getRecentRequests: () => [],
  } as unknown as HttpClient;
}

describe('createHttpShareLinkGateway', () => {
  it('says the server serves share links (fix/share-authz, BE-BIND #47–#49)', () => {
    expect(SHARE_LINKS_SUPPORTED).toBe(true);
    expect(createHttpShareLinkGateway(recordingHttpClient([])).supported).toBe(true);
  });

  it('posts a new link to the project’s collection, password in the body', async () => {
    const calls: HttpCall[] = [];
    const gateway = createHttpShareLinkGateway(recordingHttpClient(calls));

    await createShareLink(gateway, request({ password: SAMPLE_PASSPHRASE, viewpoint: VIEWPOINT }));

    const call = calls[0];
    expect(call?.method).toBe('POST');
    expect(call?.path).toBe(SHARE_LINK_ENDPOINTS.collection(PROJECT_ID));
    expect(call?.path).not.toContain(SAMPLE_PASSPHRASE);
    expect(JSON.stringify(call?.options)).toContain(SAMPLE_PASSPHRASE);
  });

  it('escapes ids rather than letting them become path segments', () => {
    expect(SHARE_LINK_ENDPOINTS.item('a/b', 'c d')).toBe('/projects/a%2Fb/share-links/c%20d');
  });

  it('lists with a GET and revokes with a DELETE', async () => {
    const calls: HttpCall[] = [];
    const gateway = createHttpShareLinkGateway(recordingHttpClient(calls));

    await gateway.list({ projectId: PROJECT_ID });
    await gateway.revoke({ projectId: PROJECT_ID, linkId: 'shr-001' });

    expect(calls[0]?.method).toBe('GET');
    expect(calls[0]?.path).toBe(SHARE_LINK_ENDPOINTS.collection(PROJECT_ID));
    expect(calls[1]?.method).toBe('DELETE');
    expect(calls[1]?.path).toBe(SHARE_LINK_ENDPOINTS.item(PROJECT_ID, 'shr-001'));
  });
});
