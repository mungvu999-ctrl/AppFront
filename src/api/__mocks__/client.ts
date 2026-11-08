import { SAMPLE_BUILDING, SAMPLE_TOTAL_AREA_M2 } from '@/domain/spatial/__fixtures__/sampleBuilding';
import { FURNITURE_KIND_BY_LIBRARY_GROUP } from '../schemas/library';
import type { HttpError, Result } from '@/lib/http';
import type { FeatureFlagKey } from '@/lib/telemetry/flags';
import type { ProjectRole } from '@/types/project';
import { MOCK_SPATIAL_PROJECT } from '../../mocks/spatial';
import type { LevelId } from '@/domain/spatial/types';
import type { MillimetresPerPixel } from '@/domain/units/types';
import type { ProjectSettings } from '../schemas/projectSettings';
import type { ProjectSummary } from '../schemas/projectSummaries';
import type { Me } from '../schemas/me';
import type { LightingBake } from '../schemas/lightingBake';
import type { PipelineRun } from '../schemas/pipelineRuns';
import type { ProjectRuleConfig } from '../schemas/ruleConfig';
import type { FloorLayerDocument } from '../schemas/spatialLayer';
import type { Suggestion, SuggestionsMeta } from '../schemas/suggestions';
import type {
  AdminUser,
  AdminUserList,
  ApiClient,
  Drawing,
  FloorImageQuality,
  Floor,
  FloorVersionPage,
  FloorWriteBody,
  ImageQualityAssessment,
  ImageQualityFinding,
  LibraryGroup,
  LibraryItem,
  Notification,
  Progress,
  Project,
  ProjectSummaryList,
  ProjectWriteBody,
  PropertyTemplate,
  SpatialLayer,
  UserActivity,
  UserMembership,
  Version,
  VersionsApi,
} from '../client';

const ok = <T>(data: T): Result<T, never> => ({ ok: true, data });
const clone = <T>(value: T): T => structuredClone(value);

const makeDrawing = (id: string): Drawing => ({
  heightMm: 2200,
  id,
  name: `Drawing ${id}`,
  scale: 1,
  uploadedAt: '2026-08-03T08:00:00.000Z',
  uploaderId: 'user-1',
  url: `https://example.com/${id}.png`,
  widthMm: 1200,
});

const makeProgress = (overrides: Partial<Progress> = {}): Progress => ({
  id: 'upload-1',
  progressPercent: 50,
  startedAt: '2026-08-03T08:20:00.000Z',
  status: 'running',
  step: 'Upload drawing',
  ...overrides,
});

/**
 * One heavy feature switched on for the mock group, the rest off.
 *
 * Typed against the whole key union rather than left partial, so a flag added
 * to the table stops this file from compiling instead of quietly never being
 * exercised by anything that runs against the mock.
 */
const MOCK_SERVER_FEATURE_FLAGS: Readonly<Record<FeatureFlagKey, boolean>> = {
  'scene.instanced-walls': true,
  'scene.soft-shadows': false,
  'rules.parallel-run': false,
  'export.pdf-vector': false,
  'qc.live-collaboration': false,
  'viewer.realism-idle': true,
  'viewer.realism-traa': true,
  'viewer.realism-hdri': true,
  'viewer.realism-materials': true,
  'viewer.realism-details': true,
};

const makeVersion = (): Version => ({
  createdAt: '2026-08-03T08:00:00.000Z',
  creatorId: 'user-1',
  id: 'version-1',
  note: 'Mock snapshot',
  projectId: 'project-1',
  sequence: 1,
});

/**
 * N17 — ba phiên bản cho mỗi tầng có thật trong bộ mẫu, mới trước cũ sau (`sequence` giảm
 * dần, đúng thứ tự BE trả). Chỉ có siêu dữ liệu: nội dung bản chụp là N18, chưa nối.
 */
const makeFloorVersionPage = (floorId: string): FloorVersionPage => ({
  items: [
    {
      createdAt: '2026-08-05T09:30:00.000Z',
      creatorId: 'usr_01J9ZV8Q3M7X5B2N4K6P8R0T1A',
      creatorName: 'Kỹ sư mẫu',
      floorRevision: 3,
      hasSnapshot: true,
      id: 'ver_01J9ZV8Q3M7X5B2N4K6P8R0T3C',
      note: `sửa tay lớp tường của ${floorId}`,
      sequence: 3,
    },
    {
      createdAt: '2026-08-04T14:10:00.000Z',
      creatorId: 'system:pipeline',
      creatorName: 'Dây chuyền xử lý',
      floorRevision: 2,
      hasSnapshot: true,
      id: 'ver_01J9ZV8Q3M7X5B2N4K6P8R0T2B',
      note: 'trạng thái trước khi ghi kết quả AI',
      sequence: 2,
    },
    {
      createdAt: '2026-08-03T08:00:00.000Z',
      creatorId: 'system:pipeline',
      creatorName: 'Dây chuyền xử lý',
      floorRevision: 1,
      hasSnapshot: true,
      id: 'ver_01J9ZV8Q3M7X5B2N4K6P8R0T1A',
      note: 'bản dựng đầu tiên',
      sequence: 1,
    },
  ],
});

const makeFloor = (levelId: string, name: string, elevationM: number, heightM: number, order: number): Floor => ({
  // The standard sample total, read from the one fixture that owns it (A14).
  ...(levelId === 'L1' ? { areaM2: SAMPLE_TOTAL_AREA_M2 } : {}),
  drawings: levelId === 'L1' ? [makeDrawing('L1-drawing-1')] : [],
  elevationMm: Math.round(elevationM * 1000),
  heightMm: Math.round(heightM * 1000),
  id: levelId,
  name,
  order,
});

const makeFallbackFloor = (floorId: string): Floor => ({
  drawings: [],
  elevationMm: 0,
  heightMm: 3900,
  id: floorId,
  name: floorId,
  order: 0,
});

/**
 * Lớp của một tầng theo N16 (B-V6-01): tầng nào là một tầng của bộ mẫu chuẩn A14
 * thì nhận đúng phần của tầng ấy; tầng khác nhận lớp RỖNG — như BE trả
 * `empty_document` cho tầng chưa có tài liệu (`spatial_read/router.py`).
 *
 * Tên tầng viết lại bằng tiếng Việt: bộ mẫu đặt `Level n`, và tên ấy hiện lên nav
 * tầng của màn tường (A6). Trục đi kèm dù N16 v1 của BE luôn trả `axes: []` — xem
 * B-V6 trong `docs/notes/e2e/fragments/W04.md`.
 */
/**
 * Mã `Level` N16 giả trả cho một tầng ngoài bộ mẫu A14.
 *
 * BE đặt `level.id = floor.id` (`spatial_read/assemble.py`), và mã tầng của BE là
 * một `LevelId` hợp lệ vì FE tạo nó bằng `createId`. Mã tầng của bộ mẫu API
 * (`L1`, `L2`…) thì KHÔNG hợp lệ, nên ép thẳng nó thành `LevelId` làm
 * `isEntityOfKind`/`applyPatch` từ chối tầng ấy và "Áp dụng tỷ lệ" không vá được
 * gì (B-V5-01). Đây là ánh xạ của riêng bộ mẫu: thân mã là mã tầng viết hoa, `-`
 * thành `X`, đệm `0` đủ mười ký tự.
 */
const levelIdOfFloor = (floorId: string): LevelId =>
  `L-${floorId.toUpperCase().replace(/[^0-9A-Z]/gu, 'X').padStart(10, '0')}` as LevelId;

const makeLayerDocument = (floor: Floor, revision: number, layer?: SpatialLayer): FloorLayerDocument => {
  const scale = writtenScales.get(floor.id);
  const sampleLevel = SAMPLE_BUILDING.levels.find((level) => level.id === floor.id);
  const onFloor = <T extends { readonly levelId: string }>(items: readonly T[]): T[] =>
    sampleLevel === undefined ? [] : clone(items.filter((item) => item.levelId === sampleLevel.id));
  const walls = onFloor(SAMPLE_BUILDING.walls);
  const wallIds = new Set<string>(walls.map((wall) => wall.id));
  const origin = writtenOrigins.get(floor.id);
  const base: FloorLayerDocument = {
    axes: clone(writtenAxes.get(floor.id) ?? onFloor(SAMPLE_BUILDING.axes)),
    dimensions: onFloor(SAMPLE_BUILDING.dimensions),
    ...(origin === undefined ? {} : { origin: { ...origin } }),
    layer: layer ?? {
      furniture: onFloor(SAMPLE_BUILDING.furniture),
      openings: clone(SAMPLE_BUILDING.openings.filter((opening) => wallIds.has(opening.wallId))),
      rooms: onFloor(SAMPLE_BUILDING.rooms),
      walls,
    },
    level:
      sampleLevel === undefined
        ? {
            confidence: 1,
            elevationMm: floor.elevationMm,
            heightMm: floor.heightMm,
            id: levelIdOfFloor(floor.id),
            name: floor.name,
            order: floor.order,
            reviewed: true,
            source: 'human',
          }
        : { ...clone(sampleLevel), name: `Tầng ${String(sampleLevel.order + 1)}` },
    revision,
  };

  return {
    ...base,
    level: {
      ...base.level,
      ...(scale === undefined ? {} : { scaleMillimetresPerPixel: scale.value }),
    },
    ...(scale?.provisional === true ? { scaleStatus: 'unresolved' as const, scaleSource: scale.source } : {}),
  };
};

const buildProject = (): Project => {
  const floors = MOCK_SPATIAL_PROJECT.levels.map((level, index) =>
    makeFloor(level.level_id, level.name, level.elevation_m, level.height_m, index),
  );

  // Name and address come from the domain sample building, so the project the
  // mock API serves is the same project every other sample dataset describes.
  const { building } = SAMPLE_BUILDING;

  return {
    ...(building.address === undefined ? {} : { address: building.address }),
    createdAt: '2026-08-03T08:00:00.000Z',
    currentVersion: makeVersion(),
    floors,
    id: 'project-1',
    members: [
      { email: 'admin@example.com', id: 'user-1', name: 'Admin', role: 'admin' },
      { email: 'engineer@example.com', id: 'user-2', name: 'Engineer', role: 'engineer' },
      // Vai chỉ-xem có mặt để nhánh "không có quyền" của A11 CHẠY ĐƯỢC ở dev:
      // đăng nhập bằng địa chỉ này là cách quan sát nó, không phải một cờ.
      { email: 'viewer@example.com', id: 'user-3', name: 'Viewer', role: 'viewer' },
    ],
    name: building.name,
    progress: makeProgress({ id: 'ai-1', progressPercent: 100, status: 'completed' }),
    status: 'approved',
    updatedAt: '2026-08-03T08:30:00.000Z',
  };
};

/* -------------------------------------------------------------------------- */
/* Chất lượng ảnh đầu vào.                                                     */
/* -------------------------------------------------------------------------- */

/**
 * Bốn tầng, hai đã đo — đúng bậc thang mà màn `InputQualityGate` cần để dựng
 * được cả bảy trạng thái của A11.
 *
 * Hai tầng đo xong trên bốn là cách trạng thái `'partial'` có gì để nói ("2/4
 * tầng đã đo xong"); tầng 1 mang đúng ba phát hiện đặc tả nêu đích danh nên
 * `'ready'` có nội dung thật để vẽ; tầng 2 sạch nên `'empty'` — không phát hiện
 * nào — cũng dựng được mà không phải bịa thêm dữ liệu tại chỗ trong story.
 *
 * Mọi con số ở đây là **số đo thô**, chưa phân loại. Mức ba bậc của chúng do
 * `src/domain/quality` quyết; mock mà tự dán nhãn `'poor'` thì test của màn sẽ
 * xanh cả khi ngưỡng thật đã đổi.
 */
const QUALITY_IMAGE_ROOT = 'https://example.com/quality';

const makeRegion = (
  xRatio: number,
  yRatio: number,
  widthRatio: number,
  heightRatio: number,
): ImageQualityFinding['region'] => ({ heightRatio, widthRatio, xRatio, yRatio });

/** Ba phát hiện của tầng 1, đúng ba thứ đặc tả kể ra. */
const makeActiveFloorFindings = (): ImageQualityFinding[] => [
  {
    // 1.240 x 900 px: cạnh ngắn 900 px, tường 110 mm chỉ còn ~3,3 px.
    code: 'RESOLUTION_TOO_LOW',
    id: 'finding-resolution',
    region: makeRegion(0, 0, 1, 1),
    severity: 'poor',
  },
  {
    // 3,4 độ — nắn tự động xử lý được, nên phát hiện này có lối sửa.
    code: 'SKEW_DETECTED',
    id: 'finding-skew',
    region: makeRegion(0.08, 0.12, 0.84, 0.72),
    severity: 'attention',
  },
  {
    // Không tìm thấy khung bản vẽ: máy chịu, người chỉ bốn góc.
    code: 'FRAME_NOT_FOUND',
    id: 'finding-frame',
    region: makeRegion(0.02, 0.02, 0.96, 0.96),
    severity: 'attention',
  },
];

const makeMeasuredFloors = (): FloorImageQuality[] => [
  {
    floorId: 'L-1',
    floorName: 'Tầng hầm',
    findings: [],
    isMeasured: false,
    sourceUrl: `${QUALITY_IMAGE_ROOT}/L-1.png`,
  },
  {
    expectedConfidence: 0.82,
    findings: makeActiveFloorFindings(),
    floorId: 'L1',
    floorName: 'Tầng 1',
    frame: { isFound: false },
    isMeasured: true,
    measurement: {
      contrastScore: 0.81,
      heightPx: 900,
      noiseScore: 0.14,
      skewDeg: 3.4,
      widthPx: 1240,
    },
    sourceUrl: `${QUALITY_IMAGE_ROOT}/L1.png`,
  },
  {
    expectedConfidence: 0.94,
    findings: [],
    floorId: 'L2',
    floorName: 'Tầng 2',
    frame: {
      corners: [
        { xRatio: 0.04, yRatio: 0.05 },
        { xRatio: 0.96, yRatio: 0.05 },
        { xRatio: 0.96, yRatio: 0.95 },
        { xRatio: 0.04, yRatio: 0.95 },
      ],
      isFound: true,
    },
    isMeasured: true,
    measurement: {
      contrastScore: 0.88,
      heightPx: 2400,
      noiseScore: 0.07,
      skewDeg: 0.2,
      widthPx: 3200,
    },
    sourceUrl: `${QUALITY_IMAGE_ROOT}/L2.png`,
  },
  {
    floorId: 'L3',
    floorName: 'Tầng 3',
    findings: [],
    isMeasured: false,
    sourceUrl: `${QUALITY_IMAGE_ROOT}/L3.png`,
  },
];

const makeFallbackQualityFloor = (floorId: string): FloorImageQuality => ({
  findings: [],
  floorId,
  floorName: floorId,
  isMeasured: false,
  sourceUrl: `${QUALITY_IMAGE_ROOT}/${floorId}.png`,
});

const uploadKey = (projectId: string, uploadId: string): string => `${projectId}::${uploadId}`;

/**
 * `uploadId` của bản vẽ có sẵn trên Tầng 1 (`L1-drawing-1`) — đúng dạng
 * `upl_<ULID>` mà `LatestFloorUploadSchema` đòi, và đã xử lý xong, để N7 của bộ
 * mẫu có một mục hợp lệ ngay từ đầu (B-V4-01).
 */
const SEEDED_UPLOAD_ID = 'upl_01J8Z3K4Q5R6S7T8V9W0XYZABC';

const applyProjectBody = (project: Project, body: Partial<ProjectWriteBody>): Project => ({
  ...project,
  ...(body.address !== undefined ? { address: body.address } : {}),
  ...(body.code !== undefined ? { code: body.code } : {}),
  ...(body.currentVersion !== undefined ? { currentVersion: body.currentVersion } : {}),
  ...(body.floors !== undefined ? { floors: body.floors } : {}),
  ...(body.members !== undefined ? { members: body.members } : {}),
  ...(body.name !== undefined ? { name: body.name } : {}),
  ...(body.progress !== undefined ? { progress: body.progress } : {}),
  ...(body.status !== undefined ? { status: body.status } : {}),
});

/* -------------------------------------------------------------------------- */
/* Phiên: vai của người vừa đăng nhập.                                         */
/* -------------------------------------------------------------------------- */

/**
 * Vai của một địa chỉ chưa có trong danh sách thành viên của bộ mẫu.
 *
 * `engineer` chứ không phải `viewer`, và đó là một lựa chọn có hệ quả: vai này
 * là thứ `pnpm dev` chạy vào khi gõ đại một địa chỉ, nên nó phải là vai LÀM
 * ĐƯỢC VIỆC — `layer.edit` bật, `canEdit` đúng, `viewer3dScene` gắn được bộ
 * bắt tia và bấm chuột trong khung nhìn chọn được đối tượng. Nhánh "không có
 * quyền" của A11 không mất đi vì thế: đăng nhập bằng `viewer@example.com` (một
 * thành viên THẬT của bộ mẫu, xem `buildProject`) cho đúng `['viewer']`, và
 * `useViewer3D` chuyển sang trạng thái `forbidden`. Hai nhánh, hai địa chỉ,
 * không cờ môi trường nào ở giữa.
 */
const MOCK_FALLBACK_ROLES: readonly ProjectRole[] = ['engineer'];

/** Bao lâu thì token của bộ mẫu hết hạn — đủ dài để không lượt gia hạn nào chen vào một bài kiểm. */
const MOCK_SESSION_TTL_SECONDS = 3600;

/**
 * Địa chỉ của lượt đăng nhập gần nhất, ở cấp module chứ không trong closure của
 * `createMockApiClient()`.
 *
 * Một trang chỉ có MỘT phiên, còn `createMockApiClient()` thì mỗi nơi gọi dựng
 * một bản. Giữ ở closure nghĩa là lượt `signIn` của màn đăng nhập và lượt gia
 * hạn mà `bootstrapSession()` chạy sau đó đọc hai ô nhớ khác nhau, và vai lại
 * rơi mất đúng chỗ nó vừa được đặt.
 */
let lastSignedInEmail: string | null = null;

/** Thành viên của bộ mẫu mang địa chỉ này, nếu có. */
const roleOfEmail = (email: string | null): readonly ProjectRole[] => {
  if (email === null) {
    return MOCK_FALLBACK_ROLES;
  }

  const member = buildProject().members.find(
    (candidate) => candidate.email?.toLowerCase() === email.trim().toLowerCase(),
  );

  return member === undefined ? MOCK_FALLBACK_ROLES : [member.role];
};

/**
 * Thân của một lượt `POST /auth/refresh` do bộ mẫu trả lời.
 *
 * Đúng hình dạng `defaultParseRefreshResponse` (`src/lib/auth/refresh.ts`) đọc
 * được: `expiresIn` tính bằng giây, `roles` ở gốc, `user` mang lại chính vai ấy.
 */
const makeRefreshPayload = (): Record<string, unknown> => {
  const email = lastSignedInEmail;
  const roles = roleOfEmail(email);
  const member = buildProject().members.find(
    (candidate) => candidate.email?.toLowerCase() === email?.trim().toLowerCase(),
  );

  return {
    accessToken: 'mock-access-token',
    expiresIn: MOCK_SESSION_TTL_SECONDS,
    roles,
    user: {
      email: email ?? 'nguoi-dung@example.com',
      id: member?.id ?? 'user-mock',
      name: member?.name ?? 'Người dùng thử',
      roles,
    },
  };
};

/**
 * Chuyến đi mà `configureAuth({ fetchImpl })` cần, khi sau lưng không có máy chủ nào.
 *
 * Đây KHÔNG phải một đường đăng nhập thứ hai. `src/lib/auth` chỉ nhận phiên qua
 * đúng một cửa — `bootstrapSession()` gọi `POST /auth/refresh` rồi đưa thân trả
 * lời cho `setAuthenticatedSession` — và `ConfigureAuthOptions.fetchImpl` là chỗ
 * tiêm mà chính cửa ấy khai ra cho một máy chủ giả. Hàm dưới đây chỉ trả lời
 * đúng lượt gia hạn; mọi đường khác nhận `204`, vì bộ mẫu không mô phỏng thêm
 * hành vi nào của máy chủ (`/auth/logout` là lượt duy nhất còn lại đi qua đây).
 */
export const createMockAuthTransport =
  () =>
  async (input: URL | RequestInfo, init?: RequestInit): Promise<Response> => {
    void init;
    const url = typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url;

    if (!url.includes('/auth/refresh')) {
      return new Response(null, { status: 204 });
    }

    return new Response(JSON.stringify(makeRefreshPayload()), {
      headers: { 'Content-Type': 'application/json' },
      status: 200,
    });
  };

/** `/projects/:projectId/measurements` và `/…/measurements/:measurementId` — `ENDPOINTS.measurements`. */
const MEASUREMENTS_PATH = /\/projects\/([^/]+)\/measurements(?:\/([^/]+))?\/?$/u;

/** Phép đo đã ghim, theo dự án, ở cấp module — cùng lý do `lastSignedInEmail`. */
const pinnedMeasurements = new Map<string, readonly { readonly id: string }[]>();

const jsonResponse = (body: unknown, status: number): Response =>
  new Response(JSON.stringify(body), { headers: { 'Content-Type': 'application/json' }, status });

/**
 * Transport HTTP của bộ mẫu cho những nhóm KHÔNG đi qua `ApiClient` — B-G-05.
 *
 * Màn đo đọc và ghi phép đo bằng `HttpClient` trần (`lib/mutations/measurement.ts`
 * giải thích vì sao), nên `createMockApiClient()` không bao giờ được hỏi và lượt
 * `GET` rơi ra máy chủ dev — 404, màn đo luôn ở `error`. Hàm này trả lời đúng ba
 * lượt của `ENDPOINTS.measurements` từ bộ nhớ; mọi đường khác đi tiếp `next`, nên
 * hành vi của những nơi gọi khác không đổi. Không mô phỏng 409 trùng mã.
 */
export const createMockHttpTransport =
  (next: (input: URL | RequestInfo, init?: RequestInit) => Promise<Response>) =>
  async (input: URL | RequestInfo, init?: RequestInit): Promise<Response> => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url;
    const match = MEASUREMENTS_PATH.exec(new URL(url, 'http://mock.invalid').pathname);

    if (match === null) {
      return next(input, init);
    }

    const [, projectId = '', measurementId] = match;
    const rows = pinnedMeasurements.get(projectId) ?? [];
    const method = (init?.method ?? 'GET').toUpperCase();

    if (method === 'GET' && measurementId === undefined) {
      return jsonResponse(rows, 200);
    }

    if (method === 'POST' && measurementId === undefined) {
      const record = JSON.parse(String(init?.body)) as { readonly id: string };
      pinnedMeasurements.set(projectId, [...rows.filter((row) => row.id !== record.id), record]);
      return jsonResponse(record, 201);
    }

    if (method === 'DELETE' && measurementId !== undefined) {
      pinnedMeasurements.set(
        projectId,
        rows.filter((row) => row.id !== decodeURIComponent(measurementId)),
      );
      return new Response(null, { status: 204 });
    }

    return jsonResponse({ code: 'METHOD_NOT_ALLOWED' }, 405);
  };

/** Vai mà bộ mẫu cấp cho một địa chỉ — xuất ra để bài kiểm khỏi chép lại bảng. */
export const mockRolesForEmail = (email: string): readonly ProjectRole[] => roleOfEmail(email);

/** Quên lượt đăng nhập gần nhất. Bài kiểm gọi giữa hai ca để không rò vai sang nhau. */
export const resetMockAuthSession = (): void => {
  lastSignedInEmail = null;
};

/* -------------------------------------------------------------------------- */
/* Thư viện model.                                                             */
/* -------------------------------------------------------------------------- */

/**
 * Mười sáu model, đủ để dựng cả bảy trạng thái của panel thư viện — D-01/D-02/D-03.
 *
 * Bộ này không phải một danh sách cho có: từng đặc điểm dưới đây có mặt vì một
 * trạng thái cụ thể cần nó, và bỏ một cái đi là một story mất chỗ dựa.
 *
 * - **Cả tám nhóm đều có mặt, mỗi nhóm ít nhất hai mục.** Bấm một chip bất kỳ
 *   cũng còn thứ để vẽ, nên `'empty'` không bao giờ là kết quả của "chip này
 *   tình cờ rỗng".
 * - **Ba mục `source: 'mine'`, nằm ở ba nhóm KHÁC nhau** (`table`, `chair`,
 *   `technical`). Đây là cái chứng minh hai trục thật sự độc lập: chip `Ghế`
 *   phải tìm thấy chiếc ghế của tôi, và chip `Của tôi` phải tìm thấy cả ba —
 *   xem `matchesLibraryFilter` (`../schemas/library.ts`).
 * - **Một mục nặng bất thường** (`library-technical-2`, 1.240.000 tam giác).
 *   Nó một mình đã vượt `SCENE_BUDGET.maxTriangles` (900.000,
 *   `src/lib/three/perf/budget.ts`), nên `checkBudget()` cảnh báo KỂ CẢ khi
 *   cảnh đang rỗng — cảnh báo trước khi cho kéo của R-04 có đường chạy mà
 *   không ai phải bịa một ngưỡng thứ hai.
 * - **Hai mục thiếu `previewUrl`** (`library-storage-2`, `library-sanitary-2`).
 *   Đây là cái cho trạng thái `'partial'` của A11 có nội dung thật: 14/16 mục
 *   có ảnh xem trước.
 *
 * `furnitureKind` KHÔNG gõ tay ở đây. Nó suy ra từ `group` qua
 * `FURNITURE_KIND_BY_LIBRARY_GROUP`, đúng một phép suy mà `LibraryItemSchema`
 * chạy khi giải mã một payload thật — mock gõ tay một loại khác thì bài kiểm
 * của màn xanh với dữ liệu mà máy chủ thật không bao giờ gửi.
 */
const LIBRARY_ASSET_ROOT = 'https://example.com/library';

interface MockLibraryItemInput {
  depthMm: number;
  fileSizeBytes: number;
  group: LibraryGroup;
  /** Vắng mặt có chủ đích: xem mục "hai mục thiếu previewUrl" ở trên. */
  hasPreview?: false;
  heightMm: number;
  id: string;
  name: string;
  source?: LibraryItem['source'];
  triangleCount: number;
  widthMm: number;
}

const makeLibraryItem = (input: MockLibraryItemInput): LibraryItem => ({
  depthMm: input.depthMm,
  fileSizeBytes: input.fileSizeBytes,
  furnitureKind: FURNITURE_KIND_BY_LIBRARY_GROUP[input.group],
  group: input.group,
  heightMm: input.heightMm,
  id: input.id,
  modelUrl: `${LIBRARY_ASSET_ROOT}/${input.id}.glb`,
  name: input.name,
  ...(input.hasPreview === false ? {} : { previewUrl: `${LIBRARY_ASSET_ROOT}/${input.id}.png` }),
  source: input.source ?? 'catalogue',
  triangleCount: input.triangleCount,
  widthMm: input.widthMm,
});

const MOCK_LIBRARY_ITEMS: readonly LibraryItem[] = [
  makeLibraryItem({
    depthMm: 900,
    fileSizeBytes: 412_000,
    group: 'table',
    heightMm: 750,
    id: 'library-table-1',
    name: 'bàn ăn sáu chỗ',
    triangleCount: 8_400,
    widthMm: 1_800,
  }),
  makeLibraryItem({
    depthMm: 600,
    fileSizeBytes: 268_000,
    group: 'table',
    heightMm: 750,
    id: 'library-table-2',
    name: 'bàn làm việc chữ l',
    source: 'mine',
    triangleCount: 6_100,
    widthMm: 1_400,
  }),
  makeLibraryItem({
    depthMm: 520,
    fileSizeBytes: 184_000,
    group: 'chair',
    heightMm: 880,
    id: 'library-chair-1',
    name: 'ghế tựa gỗ sồi',
    triangleCount: 12_600,
    widthMm: 460,
  }),
  makeLibraryItem({
    depthMm: 620,
    fileSizeBytes: 226_000,
    group: 'chair',
    heightMm: 1_120,
    id: 'library-chair-2',
    name: 'ghế xoay văn phòng',
    source: 'mine',
    triangleCount: 24_800,
    widthMm: 640,
  }),
  makeLibraryItem({
    depthMm: 2_000,
    fileSizeBytes: 520_000,
    group: 'bed',
    heightMm: 420,
    id: 'library-bed-1',
    name: 'giường đôi 1m6',
    triangleCount: 9_800,
    widthMm: 1_600,
  }),
  makeLibraryItem({
    depthMm: 1_900,
    fileSizeBytes: 388_000,
    group: 'bed',
    heightMm: 400,
    id: 'library-bed-2',
    name: 'giường đơn có hộc kéo',
    triangleCount: 11_200,
    widthMm: 1_000,
  }),
  makeLibraryItem({
    depthMm: 880,
    fileSizeBytes: 742_000,
    group: 'sofa',
    heightMm: 820,
    id: 'library-sofa-1',
    name: 'sô pha ba chỗ bọc nỉ',
    triangleCount: 46_500,
    widthMm: 2_100,
  }),
  makeLibraryItem({
    depthMm: 1_600,
    fileSizeBytes: 964_000,
    group: 'sofa',
    heightMm: 820,
    id: 'library-sofa-2',
    name: 'sô pha góc chữ l',
    triangleCount: 61_300,
    widthMm: 2_600,
  }),
  makeLibraryItem({
    depthMm: 600,
    fileSizeBytes: 296_000,
    group: 'storage',
    heightMm: 2_200,
    id: 'library-storage-1',
    name: 'tủ quần áo ba cánh',
    triangleCount: 7_400,
    widthMm: 1_800,
  }),
  makeLibraryItem({
    depthMm: 320,
    fileSizeBytes: 158_000,
    group: 'storage',
    hasPreview: false,
    heightMm: 1_800,
    id: 'library-storage-2',
    name: 'kệ sách năm tầng',
    triangleCount: 5_200,
    widthMm: 800,
  }),
  makeLibraryItem({
    depthMm: 700,
    fileSizeBytes: 344_000,
    group: 'sanitary',
    heightMm: 780,
    id: 'library-sanitary-1',
    name: 'bệt liền khối',
    triangleCount: 18_900,
    widthMm: 380,
  }),
  makeLibraryItem({
    depthMm: 480,
    fileSizeBytes: 212_000,
    group: 'sanitary',
    hasPreview: false,
    heightMm: 850,
    id: 'library-sanitary-2',
    name: 'chậu rửa đặt bàn',
    triangleCount: 14_300,
    widthMm: 600,
  }),
  makeLibraryItem({
    depthMm: 600,
    fileSizeBytes: 486_000,
    group: 'kitchen',
    heightMm: 850,
    id: 'library-kitchen-1',
    name: 'tủ bếp dưới có chậu',
    triangleCount: 10_700,
    widthMm: 1_200,
  }),
  makeLibraryItem({
    depthMm: 350,
    fileSizeBytes: 238_000,
    group: 'kitchen',
    heightMm: 700,
    id: 'library-kitchen-2',
    name: 'tủ bếp trên cánh lật',
    triangleCount: 6_900,
    widthMm: 1_200,
  }),
  makeLibraryItem({
    depthMm: 300,
    fileSizeBytes: 176_000,
    group: 'technical',
    heightMm: 300,
    id: 'library-technical-1',
    name: 'cục nóng điều hoà',
    source: 'mine',
    triangleCount: 21_400,
    widthMm: 800,
  }),
  makeLibraryItem({
    depthMm: 900,
    fileSizeBytes: 24_800_000,
    group: 'technical',
    heightMm: 2_000,
    id: 'library-technical-2',
    name: 'cụm thông gió tầng hầm',
    triangleCount: 1_240_000,
    widthMm: 2_400,
  }),
  makeLibraryItem({
    depthMm: 650,
    fileSizeBytes: 610_000,
    group: 'decor',
    heightMm: 1_600,
    id: 'library-decor-1',
    name: 'chậu cây lá chuối lớn',
    triangleCount: 30_000,
    widthMm: 1_080,
  }),
  makeLibraryItem({
    depthMm: 1_800,
    fileSizeBytes: 5_000,
    group: 'decor',
    heightMm: 34,
    id: 'library-decor-2',
    name: 'thảm chữ nhật be',
    triangleCount: 1_100,
    widthMm: 2_770,
  }),
];

/**
 * Một mục thay thế khi id không có trong bộ mẫu — cùng khuôn với
 * `makeFallbackFloor` ở trên: mock của file này không bao giờ trả về thất bại,
 * vì nhánh lỗi của màn được lái qua cổng của nó chứ không qua đây.
 */
const makeFallbackLibraryItem = (libraryItemId: string): LibraryItem =>
  makeLibraryItem({
    depthMm: 600,
    fileSizeBytes: 120_000,
    group: 'technical',
    heightMm: 600,
    id: libraryItemId,
    name: 'model chưa đặt tên',
    triangleCount: 4_000,
    widthMm: 600,
  });

/* -------------------------------------------------------------------------- */
/* Quản trị người dùng — T-04/T-05.                                            */
/* -------------------------------------------------------------------------- */

/**
 * Bảy người, đủ để màn quản trị diễn được cả bảy trạng thái của A11.
 *
 * ## Mốc thời gian là hằng, không phải `Date.now()`
 *
 * {@link MOCK_USERS_REFERENCE_TIME} là "bây giờ" mà mọi mốc dưới đây được đặt
 * quanh. Một bộ mẫu đọc đồng hồ thật thì "vừa xong" hôm nay thành "ba tháng
 * trước" vào tháng sau, và bài kiểm cột thời gian tương đối sẽ hỏng vào một ngày
 * không ai đụng vào code. Bài kiểm đóng băng đồng hồ tại đúng mốc này
 * (`fakeClock`, `src/lib/testing`) rồi đọc bảng.
 *
 * ## Bảy trạng thái ánh xạ vào đâu
 *
 * 1. **Rỗng** — {@link MOCK_ADMIN_USERS_SOLO}: đúng một người, chính người đang
 *    đăng nhập. Bảng người dùng không bao giờ rỗng thật, vì người đang mở nó
 *    luôn có mặt trong đó; "rỗng" ở màn này nghĩa là "chưa mời ai".
 * 2. **Đang tải** — không có dữ liệu riêng. Bộ mẫu trả lời ngay lập tức, đúng
 *    như mọi nhóm khác trong file này: một độ trễ giả ở đây làm chậm mọi bài
 *    kiểm chạy qua bộ mẫu để đổi lấy một trạng thái mà story dựng được từ
 *    `isPending`. Tám hàng khung xương là việc của màn.
 * 3. **Một phần** — đúng ba lời mời `'pending'`, HAI trong số đó đã quá
 *    `inviteExpiresAt` so với mốc trên. Đó là lý do nút "gửi lại" có việc để làm.
 * 4. **Lỗi** — {@link MOCK_USERS_ERROR_USER_ID}: đọc dự án hay nhật ký của id ấy
 *    trả về `HttpError`. Một id chuyên trả lỗi thay vì một cờ môi trường, cùng
 *    lối nghĩ với `viewer@example.com` ở phần xác thực phía trên.
 * 5. **Xong** — {@link MOCK_ADMIN_USERS}: đủ ba vai, một người bị vô hiệu, và
 *    `lastActiveAt` rải từ vài phút tới vài tuần để cột thời gian tương đối có
 *    cái gì để hiện.
 * 6. **Không có quyền** — đăng nhập bằng `viewer@example.com` thì `users.list`
 *    trả `403`. Cùng một cửa với nhánh `forbidden` của `useViewer3D`: vai đi ra
 *    từ lượt gia hạn, không từ một cờ.
 * 7. **Thu gọn** — không cần dữ liệu riêng.
 *
 * ## Tên tiếng Việt có dấu, địa chỉ thư không dấu
 *
 * Tiền lệ ở `shareDialogFixtures.ts` ("Phạm An", "Nguyễn Bình", "Trần Chi"): bộ
 * mẫu phải nuôi được `expectVietnamese`, và một bảng toàn "User 1", "User 2" thì
 * không bao giờ phát hiện được một nhãn mất dấu. Địa chỉ thư thì ngược lại —
 * chúng là mã máy đọc và giữ đúng ba địa chỉ mà `buildProject()` đã đặt cho ba
 * vai, nên `users.list` và `project.members` nói về cùng những con người.
 *
 * (`buildProject()` vẫn gọi ba người ấy là "Admin" / "Engineer" / "Viewer". Đổi
 * tên ở đó nằm ngoài phạm vi lượt này — đó là dữ liệu của một lượt đọc khác, và
 * bài kiểm màn đăng nhập đang đọc nó.)
 */
export const MOCK_USERS_REFERENCE_TIME = '2026-09-08T09:00:00.000Z';

/** Hạn của một lời mời vừa gửi — bảy ngày sau {@link MOCK_USERS_REFERENCE_TIME}, viết thẳng để mốc không trôi theo đồng hồ thật. */
export const MOCK_USERS_INVITE_EXPIRY = '2026-09-15T09:00:00.000Z';

/** Id chuyên trả lỗi, để nhánh "Lỗi" của A11 chạy được ở dev mà không cần cờ. */
export const MOCK_USERS_ERROR_USER_ID = 'user-loi';

/** 403 và 404 của bộ mẫu — cùng hình dạng `HttpError` mà `createHttpClient` trả về thật. */
const mockUsersHttpError = (status: number, requestId: string): HttpError => ({
  kind: 'http',
  raw: undefined,
  requestId,
  retryable: false,
  status,
});

const failed = <T>(error: HttpError): Result<T, HttpError> => ({ error, ok: false });
const endpointMissing = (resource: string): HttpError => ({
  kind: 'http',
  raw: { resource },
  requestId: `req-${resource}-missing`,
  retryable: false,
  status: 404,
});

/** Id dự án không có (hoặc người dùng không phải thành viên): `projects.read` trả 404 `resource: 'project'` — B-V1-43. */
export const MOCK_MISSING_PROJECT_ID = 'project-missing';

const AVATAR_ROOT = 'https://example.com/avatars';

export const MOCK_ADMIN_USERS: readonly AdminUser[] = [
  {
    avatarUrl: `${AVATAR_ROOT}/user-1.png`,
    email: 'admin@example.com',
    id: 'user-1',
    lastActiveAt: '2026-09-08T08:57:00.000Z',
    name: 'Phạm An',
    projectCount: 7,
    role: 'admin',
    status: 'active',
  },
  {
    avatarUrl: `${AVATAR_ROOT}/user-2.png`,
    email: 'engineer@example.com',
    id: 'user-2',
    lastActiveAt: '2026-09-08T05:30:00.000Z',
    name: 'Nguyễn Bình',
    projectCount: 4,
    role: 'engineer',
    status: 'active',
  },
  {
    email: 'viewer@example.com',
    id: 'user-3',
    lastActiveAt: '2026-09-05T14:10:00.000Z',
    name: 'Trần Chi',
    projectCount: 2,
    role: 'viewer',
    status: 'active',
  },
  {
    email: 'le.dung@example.com',
    id: 'user-4',
    lastActiveAt: '2026-08-21T10:05:00.000Z',
    name: 'Lê Thuỳ Dung',
    projectCount: 1,
    role: 'engineer',
    status: 'disabled',
  },
  {
    email: 'hoang.bao@example.com',
    id: 'user-5',
    inviteExpiresAt: '2026-09-14T09:00:00.000Z',
    invitedAt: '2026-09-07T09:00:00.000Z',
    lastActiveAt: null,
    name: 'Hoàng Gia Bảo',
    projectCount: 0,
    role: 'engineer',
    status: 'pending',
  },
  {
    email: 'vu.hanh@example.com',
    id: 'user-6',
    inviteExpiresAt: '2026-09-08T08:00:00.000Z',
    invitedAt: '2026-09-01T09:00:00.000Z',
    lastActiveAt: null,
    name: 'Vũ Thị Hạnh',
    projectCount: 0,
    role: 'viewer',
    status: 'pending',
  },
  {
    email: 'dang.khoi@example.com',
    id: 'user-7',
    inviteExpiresAt: '2026-09-01T09:00:00.000Z',
    invitedAt: '2026-08-25T09:00:00.000Z',
    lastActiveAt: null,
    name: 'Đặng Minh Khôi',
    projectCount: 0,
    role: 'viewer',
    status: 'pending',
  },
];

/** Trạng thái "Rỗng": chỉ còn người đang đăng nhập, chưa mời ai. */
export const MOCK_ADMIN_USERS_SOLO: readonly AdminUser[] = MOCK_ADMIN_USERS.slice(0, 1);

/**
 * Ba dự án, tên tiếng Việt có dấu — cùng lý do với tên người ở trên.
 *
 * Vai trong bảng này KHÔNG suy ra từ `AdminUser.role`: `user-2` là `engineer`
 * của hệ thống nhưng chỉ được xem dự án thứ ba. Bộ mẫu phải diễn được đúng chỗ
 * lệch ấy, nếu không màn sẽ được dựng trên giả định rằng hai vai luôn trùng.
 */
const MOCK_USER_MEMBERSHIPS: Readonly<Record<string, readonly UserMembership[]>> = {
  'user-1': [
    { projectId: 'project-1', projectName: 'Chung cư Sông Hàn', role: 'admin' },
    { projectId: 'project-2', projectName: 'Văn phòng Thủ Thiêm', role: 'admin' },
  ],
  'user-2': [
    { projectId: 'project-1', projectName: 'Chung cư Sông Hàn', role: 'engineer' },
    { projectId: 'project-3', projectName: 'Trường mầm non Hoa Sữa', role: 'viewer' },
  ],
  'user-3': [{ projectId: 'project-1', projectName: 'Chung cư Sông Hàn', role: 'viewer' }],
  'user-4': [{ projectId: 'project-2', projectName: 'Văn phòng Thủ Thiêm', role: 'engineer' }],
};

/**
 * Nhật ký hoạt động, mã đối tượng tách khỏi nhãn.
 *
 * `objectCode` là thứ màn hiện bằng chữ đều (`A-3`, `P.201`) — A6 cho phép chữ
 * hoa đúng ở mã trục và mã lỗi; `objectLabel` là câu viết thường kiểu câu. Gộp
 * làm một chuỗi thì màn không tách lại được.
 */
const MOCK_USER_ACTIVITY: Readonly<Record<string, readonly UserActivity[]>> = {
  'user-1': [
    {
      at: '2026-09-08T08:55:00.000Z',
      id: 'activity-1',
      kind: 'rules.run',
      objectCode: 'L1',
      objectLabel: 'chạy lại bộ luật cho tầng trệt',
    },
    {
      at: '2026-09-07T16:20:00.000Z',
      id: 'activity-2',
      kind: 'export.file',
      objectCode: 'PDF',
      objectLabel: 'xuất hồ sơ mặt bằng',
    },
  ],
  'user-2': [
    {
      at: '2026-09-08T05:28:00.000Z',
      id: 'activity-3',
      kind: 'wall.edit',
      objectCode: 'A-3',
      objectLabel: 'sửa tường trục a-3',
    },
    {
      at: '2026-09-06T09:12:00.000Z',
      id: 'activity-4',
      kind: 'room.edit',
      objectCode: 'P.201',
      objectLabel: 'đổi công năng phòng 201',
    },
  ],
  'user-3': [
    {
      at: '2026-09-05T14:08:00.000Z',
      id: 'activity-6',
      kind: 'project.open',
      objectCode: 'DA-1',
      objectLabel: 'mở dự án chung cư sông hàn',
    },
  ],
};

/* -------------------------------------------------------------------------- */
/* Hộp thư thông báo — T-09.                                                   */
/* -------------------------------------------------------------------------- */

/**
 * Năm mục, đủ bốn loại của `NOTIFICATION_KINDS` và cả hai trạng thái đã/chưa
 * đọc.
 *
 * Tên dự án khớp đúng `MOCK_USER_MEMBERSHIPS` ở trên — cùng ba dự án, cùng
 * tên — để hai bộ mẫu không kể hai câu chuyện khác nhau về cùng một hệ thống.
 * `notif-4` (`commentMention`) là mục DUY NHẤT mang `excerpt`, đúng ràng buộc
 * của `NotificationItemVm.excerpt` (chỉ loại nhắc tên); `notif-3`
 * (`projectInvite`) là mục DUY NHẤT không mang `floorId` — một lời mời chưa
 * gắn với tầng nào cả.
 *
 * `place` cố ý KHÔNG chạy song song với `kind`: hai mục `aiCompleted` mang
 * `walls` và `grids`, tức hai màn duyệt khác nhau cho cùng một loại. Đó chính
 * là điều lược đồ nói — nơi đến là dữ liệu của máy chủ, không suy được từ loại
 * — nên bộ mẫu phải thể hiện nó, chứ không phải một bảng một-đối-một mà mọi
 * người đọc sau sẽ tưởng là suy ra được.
 */
export const MOCK_NOTIFICATIONS: readonly Notification[] = [
  {
    createdAt: '2026-09-08T08:40:00.000Z',
    floorId: 'L1',
    id: 'notif-1',
    isRead: false,
    kind: 'aiCompleted',
    message: 'Hệ thống AI đã xử lý xong bản vẽ',
    objectLabel: 'tầng trệt',
    place: 'walls',
    projectId: 'project-1',
    projectName: 'Chung cư Sông Hàn',
  },
  {
    createdAt: '2026-09-08T07:10:00.000Z',
    floorId: 'L1',
    id: 'notif-2',
    isRead: false,
    kind: 'violationFound',
    message: 'Phát hiện 1 vi phạm luật ở',
    objectLabel: 'trục a-3',
    place: 'rules',
    projectId: 'project-2',
    projectName: 'Văn phòng Thủ Thiêm',
  },
  {
    createdAt: '2026-09-07T09:00:00.000Z',
    id: 'notif-3',
    isRead: false,
    kind: 'projectInvite',
    message: 'Lê Minh đã thêm bạn vào dự án',
    objectLabel: 'Trường mầm non Hoa Sữa',
    place: 'projectSettings',
    projectId: 'project-3',
    projectName: 'Trường mầm non Hoa Sữa',
  },
  {
    createdAt: '2026-09-06T16:20:00.000Z',
    excerpt: 'Kiểm tra lại kích thước cửa sổ ở góc này giúp mình nhé.',
    floorId: 'L1',
    id: 'notif-4',
    isRead: true,
    kind: 'commentMention',
    message: 'Trần Chi nhắc đến bạn trong một bình luận ở',
    objectLabel: 'phòng 201',
    place: 'rooms',
    projectId: 'project-1',
    projectName: 'Chung cư Sông Hàn',
  },
  {
    createdAt: '2026-09-05T09:00:00.000Z',
    floorId: 'L2',
    id: 'notif-5',
    isRead: true,
    kind: 'aiCompleted',
    message: 'Hệ thống AI đã xử lý xong bản vẽ',
    objectLabel: 'tầng hai',
    place: 'grids',
    projectId: 'project-1',
    projectName: 'Chung cư Sông Hàn',
  },
  {
    createdAt: '2026-09-08T05:00:00.000Z',
    floorId: 'L2',
    id: 'notif-6',
    isRead: true,
    kind: 'aiFailed',
    message: 'Dự án Chung cư Sông Hàn: AI chưa xử lý được bản vẽ',
    objectLabel: 'tầng hai',
    place: 'floors',
    projectId: 'project-1',
    projectName: 'Chung cư Sông Hàn',
  },
];

/** 404 của bộ mẫu — cùng hình dạng `HttpError` mà `createHttpClient` trả về thật. */
const mockNotificationsHttpError = (status: number, requestId: string): HttpError => ({
  kind: 'http',
  raw: undefined,
  requestId,
  retryable: false,
  status,
});

/* -------------------------------------------------------------------------- */
/* N1, N3–N6 — thẻ dự án, thành viên, cài đặt (F-07).                          */
/* -------------------------------------------------------------------------- */

/** `updatedAt` của N1 là hằng: e2e ghim đồng hồ (`e2e/app.visual.spec.ts`), nên một mốc theo giờ thật làm ảnh chuẩn trôi. */
const mockSummaryUpdatedAt = (day: number): string => `2026-09-${String(day).padStart(2, '0')}T08:00:00.000Z`;

/**
 * Ba dự án mang đúng tên, diện tích, trạng thái của bộ mẫu cũ (`SAMPLE_PROJECTS`, gỡ ở F-07) mà
 * `e2e/v2v3/dashboard.spec.ts` tìm theo tên và đếm đúng ba thẻ — đủ ba `status`. Sunrise đang xử
 * lý, chưa tách xong tầng nào: nó là dự án `floorCount: 0`, nên chưa có tường nào (`wallsTotalCount: 0`). Thứ tự `updatedAt` giữ thứ tự cũ.
 */
/** N7b — nhật ký lượt xử lý mẫu, mới nhất trước (một lượt lỗi, một lượt bị thay, một lượt xong). */
export const MOCK_PIPELINE_RUNS: readonly PipelineRun[] = [
  {
    createdAt: '2026-09-08T08:40:00.000Z',
    floorId: 'L-000001LVL0',
    floorName: 'Tầng 1',
    progressPercent: 55,
    runId: 'run-3',
    startedAt: '2026-09-08T08:40:03.000Z',
    status: 'running',
    step: 'openingAndFurnitureDetection',
    updatedAt: '2026-09-08T08:42:00.000Z',
    uploadId: 'upl_01JB0000000000000000000003',
  },
  {
    createdAt: '2026-09-08T08:20:00.000Z',
    errorCode: 'PIPELINE_SUPERSEDED',
    floorId: 'L-000001LVL0',
    floorName: 'Tầng 1',
    progressPercent: 5,
    runId: 'run-2',
    startedAt: '2026-09-08T08:20:03.000Z',
    status: 'failed',
    step: 'wallSegmentation',
    supersededBy: 'run-3',
    updatedAt: '2026-09-08T08:40:00.000Z',
    uploadId: 'upl_01JB0000000000000000000002',
  },
  {
    createdAt: '2026-09-08T08:00:00.000Z',
    endedAt: '2026-09-08T08:04:40.000Z',
    floorId: 'L-000001LVL0',
    floorName: 'Tầng 1',
    progressPercent: 100,
    runId: 'run-1',
    startedAt: '2026-09-08T08:00:02.000Z',
    status: 'completed',
    step: 'qualityCheck',
    updatedAt: '2026-09-08T08:04:40.000Z',
    uploadId: 'upl_01JB0000000000000000000001',
  },
];

export const MOCK_PROJECT_SUMMARIES: readonly ProjectSummary[] = [
  {
    areaM2: 1860,
    defaultFloorId: 'floor-01',
    floorCount: 4,
    id: 'prj_01HZX3K9M2Q4R6T8V0W1Y3A5C7',
    members: [
      { id: 'usr_01HZX3K9M2Q4R6T8V0W1Y3A5C1', name: 'Phạm An' },
      { id: 'usr_01HZX3K9M2Q4R6T8V0W1Y3A5C2', name: 'Nguyễn Bình' },
    ],
    name: 'Toà nhà HQ Renovation',
    status: 'qc',
    updatedAt: mockSummaryUpdatedAt(3),
    wallsReviewedCount: 30,
    wallsTotalCount: 48,
  },
  {
    areaM2: 8420,
    floorCount: 0,
    id: 'prj_01HZX3K9M2Q4R6T8V0W1Y3A5C8',
    members: [
      { id: 'usr_01HZX3K9M2Q4R6T8V0W1Y3A5C1', name: 'Phạm An' },
      { id: 'usr_01HZX3K9M2Q4R6T8V0W1Y3A5C2', name: 'Nguyễn Bình' },
      { id: 'usr_01HZX3K9M2Q4R6T8V0W1Y3A5C4', name: 'Trần Chi' },
    ],
    name: 'Chung cư Sunrise Block B',
    status: 'processing',
    updatedAt: mockSummaryUpdatedAt(4),
    wallsReviewedCount: 0,
    wallsTotalCount: 0,
  },
  {
    areaM2: 5200,
    defaultFloorId: 'floor-01',
    floorCount: 2,
    id: 'prj_01HZX3K9M2Q4R6T8V0W1Y3A5C9',
    members: [{ id: 'usr_01HZX3K9M2Q4R6T8V0W1Y3A5C2', name: 'Nguyễn Bình' }],
    name: 'Nhà máy Bắc Ninh',
    status: 'done',
    updatedAt: mockSummaryUpdatedAt(2),
    wallsReviewedCount: 26,
    wallsTotalCount: 26,
  },
];

/** Người thêm được bằng N3: một email lạ (ngoài danh sách này) trả 422 `MEMBER_USER_UNAVAILABLE`. */
export const MOCK_KNOWN_MEMBER_EMAILS: readonly string[] = ['newcomer@example.com', 'engineer@example.com'];

/** Id ULID cố định theo email đã biết (26 ký tự Crockford, không I L O U). */
const MOCK_KNOWN_MEMBER_IDS: Readonly<Record<string, string>> = {
  'engineer@example.com': 'usr_01HZX3K9M2Q4R6T8V0W1Y3A5C2',
  'newcomer@example.com': 'usr_01HZX3K9M2Q4R6T8V0W1Y3A5C3',
};

/**
 * Cài đặt mẫu: `revision` bắt đầu ở 3; `baseVersion` khác số này → 409 `VERSION_CONFLICT`. Ngưỡng tin
 * cậy 0,75 và dung sai 50 mm là mặc định cũ (`DEFAULT_UNWIRED_SETTINGS`) mà e2e cài đặt dự án đọc.
 */
const MOCK_SETTINGS_INITIAL: ProjectSettings = {
  buildingType: 'residential',
  confidenceThreshold: 0.75,
  defaultScaleMmPerPx: 1,
  lengthUnit: 'mm',
  revision: 3,
  snapToleranceMm: 50,
};

const mockWireError = (status: number, code: string, requestId: string, raw: Record<string, unknown> = {}): HttpError => ({
  code,
  kind: 'http',
  raw,
  requestId,
  retryable: false,
  status,
});

/**
 * Lớp tầng của bộ mẫu, cấp module: mọi `createMockApiClient()` thấy chung một
 * revision, như hai thẻ trình duyệt thấy chung một máy chủ (`createAppApiClient()`
 * dựng mock mới mỗi lần gọi). Trạng thái này sống cùng trang; test gọi
 * `__resetMockLayerState()` ở `beforeEach`.
 */
const layerRevisions = new Map<string, number>();
const writtenLayers = new Map<string, SpatialLayer>();
/** Lượt ghi cuối của mỗi tầng — nguồn của luật C09b (gửi lại trùng thì 200). */
const lastLayerWrites = new Map<string, { base: number; body: string; revision: number }>();
/** Tỉ lệ của tầng theo mã tầng: `provisional` → N16 trả `scaleStatus: 'unresolved'`; PUT có tỉ lệ gỡ nó. */
const writtenScales = new Map<
  string,
  { provisional: boolean; value: MillimetresPerPixel; source: 'pipeline' | 'project_default' }
>();
/** Trục và gốc đã lưu qua #35 (G4b-17): gửi `axes` thay nguyên danh sách, gửi `origin` thay gốc. */
const writtenAxes = new Map<string, FloorLayerDocument['axes']>();
const writtenOrigins = new Map<string, { x: number; y: number }>();
/**
 * M2 — lớp đề xuất của tầng (máy chủ thật sinh bằng `reconcile`; mock không sinh). Rỗng mặc định: test và
 * trang mock nạp bằng {@link seedMockSuggestions} (vd. ca vàng `ch-04` của AppBack). Không gói ca vàng vào
 * đây: tệp này vào bản dựng sản phẩm qua `appClient.ts`.
 */
const mockSuggestions = new Map<string, { suggestions: Suggestion[]; meta: SuggestionsMeta; enabled: boolean }>();

/** Như `lib/suggestions/state.applySuggestionState` (chép gọn: client giả không kéo tệp ấy vào chunk khác). */
const applyMockState = (current: Suggestion[], rows: readonly { id: string; state: Suggestion['state']; override?: Record<string, string | number | boolean> | undefined }[]): Suggestion[] => {
  const sent = new Map(rows.map((row) => [row.id, row]));
  if (rows.some((row) => !current.some((s) => s.id === row.id))) throw new Error('id đề xuất lạ');
  return current.map((s) => {
    const row = sent.get(s.id);
    const { override: _o, adoptedAs, ...rest } = s;
    void _o;
    const state = row?.state ?? 'active';
    return { ...rest, state, ...(row?.override === undefined ? {} : { override: row.override }), ...(state === 'adopted' && adoptedAs !== undefined ? { adoptedAs } : {}) } as Suggestion;
  });
};

export const seedMockSuggestions = (floorId: string, suggestions: readonly Suggestion[], meta: SuggestionsMeta): void => {
  mockSuggestions.set(floorId, { suggestions: clone([...suggestions]), meta: { ...meta }, enabled: true });
};

/** Như AppBack `suggestion_fields`: lớp tắt thì vắng cả ba khoá; danh sách rỗng thì vắng `suggestions`/`suggestionsMeta`. */
const suggestionKeysOf = (
  floorId: string,
): { suggestions?: Suggestion[]; suggestionsMeta?: SuggestionsMeta; suggestionsEnabled?: true } => {
  const stored = mockSuggestions.get(floorId);
  if (stored === undefined || !stored.enabled) return {};
  return stored.suggestions.length === 0
    ? { suggestionsEnabled: true }
    : { suggestions: clone(stored.suggestions), suggestionsMeta: { ...stored.meta }, suggestionsEnabled: true };
};

export const __resetMockLayerState = (): void => {
  mockSuggestions.clear();
  layerRevisions.clear();
  writtenLayers.clear();
  lastLayerWrites.clear();
  writtenScales.clear();
  writtenAxes.clear();
  writtenOrigins.clear();
};

/**
 * Tầng mang tỉ lệ tạm (`scaleStatus: 'unresolved'`) — như máy chủ đoán tỉ lệ mà chưa ai chốt.
 * `source: 'project_default'` = máy không đo được, đang dùng mặc định dự án (UX-R1 K12).
 */
export const simulateProvisionalScale = (
  floorId: string,
  value: number,
  source: 'pipeline' | 'project_default' = 'pipeline',
): void => {
  writtenScales.set(floorId, { provisional: true, source, value: value as MillimetresPerPixel });
};

const MOCK_REMOTE_ACTOR_ID = 'usr_01J9ZQK7X4N2M8P6R3T5V7W9Y1';

/**
 * Người khác vừa sửa tầng: tăng `revision` và xoá một tường khỏi lớp đã ghi (lớp mồi
 * của bộ mẫu nếu chưa ai ghi). Spec e2e gọi qua `import('/src/api/__mocks__/client.ts')`.
 */
export const simulateRemoteLayerEdit = (floorId: string): void => {
  const layer = writtenLayers.get(floorId) ?? makeLayerDocument(makeFallbackFloor(floorId), 0).layer;

  writtenLayers.set(floorId, { ...clone(layer), walls: layer.walls.slice(1).map(clone) });
  layerRevisions.set(floorId, (layerRevisions.get(floorId) ?? 0) + 1);
};

const applyFloorBody = (floor: Floor, body: Partial<FloorWriteBody>): Floor => ({
  ...floor,
  ...(body.areaM2 !== undefined ? { areaM2: body.areaM2 } : {}),
  ...(body.drawings !== undefined ? { drawings: body.drawings } : {}),
  ...(body.elevationMm !== undefined ? { elevationMm: body.elevationMm } : {}),
  ...(body.heightMm !== undefined ? { heightMm: body.heightMm } : {}),
  ...(body.name !== undefined ? { name: body.name } : {}),
  ...(body.order !== undefined ? { order: body.order } : {}),
});

const MOCK_ULID_ALPHABET = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';

/** `ver_` + ULID hợp lệ (Crockford, 26 ký tự) cho phiên bản mock sinh ra lúc phục hồi. */
const mockVersionId = (sequence: number): string => {
  let suffix = '';

  for (let rest = sequence, index = 0; index < 4; index += 1, rest = Math.floor(rest / 32)) {
    suffix = `${MOCK_ULID_ALPHABET[rest % 32] ?? '0'}${suffix}`;
  }

  return `ver_01J9ZV8Q3M7X5B2N4K6P9R${suffix}`;
};

type MockFloorVersion = FloorVersionPage['items'][number];

/**
 * N17–N20 mock: lịch sử mồi của `makeFloorVersionPage`, cộng các bản phục hồi sinh ra trong
 * phiên. Bản phục hồi đẩy `revision` của tầng lên trên mọi `floorRevision` mồi, nên đúng một
 * hàng là "hiện tại" sau khi nạp lại. Base theo luật #35: lớn hơn → 422, nhỏ hơn → 409.
 */
const createMockVersionsApi = (readFloors: () => readonly Floor[]): VersionsApi => {
  const histories = new Map<string, MockFloorVersion[]>();
  const historyOf = (floorId: string): MockFloorVersion[] => {
    const known = histories.get(floorId) ?? [...makeFloorVersionPage(floorId).items];

    histories.set(floorId, known);

    return known;
  };
  const findVersion = (versionId: string): { items: MockFloorVersion[]; index: number } | null => {
    for (const items of histories.values()) {
      const index = items.findIndex((item) => item.id === versionId);

      if (index >= 0) {
        return { items, index };
      }
    }

    return null;
  };

  return {
    label: async ({ label, versionId }) => {
      const found = findVersion(versionId);
      const current = found?.items[found.index];

      if (found === null || current === undefined) {
        return failed(mockWireError(404, 'NOT_FOUND', 'req-version-label', { code: 'NOT_FOUND', resource: 'version' }));
      }

      const next: MockFloorVersion = { ...current, label: label.trim() };

      if (next.label === '') {
        delete next.label;
      }

      found.items[found.index] = next;

      return ok(clone(next));
    },
    // Mọi mã tầng đều có lịch sử mồi: N15 mock đặt mã `Level` khác mã `Floor` của #12 (lệch có từ F-04x-2).
    list: async ({ cursor, floorId, limit }) => {
      const all = historyOf(floorId);
      const start = cursor === undefined ? 0 : Number(cursor);
      const end = start + (limit ?? all.length);

      return ok({
        items: clone(all.slice(start, end)),
        ...(end < all.length ? { nextCursor: String(end) } : {}),
      });
    },
    restore: async ({ baseVersion, floorId, versionId }) => {
      const current = layerRevisions.get(floorId) ?? 0;
      const requestId = `req-version-restore-${floorId}`;

      if (baseVersion > current) {
        return failed(
          mockWireError(422, 'VALIDATION', requestId, { code: 'VALIDATION', field: 'baseVersion', requestId }),
        );
      }

      if (baseVersion < current) {
        return failed(
          mockWireError(409, 'VERSION_CONFLICT', requestId, {
            code: 'VERSION_CONFLICT',
            currentVersion: current,
            remoteChanges: [
              {
                changedAt: '2026-09-17T05:09:00.123Z',
                changedBy: MOCK_REMOTE_ACTOR_ID,
                changedByName: 'Trần Minh',
                entityId: 'W-WALL0014',
                entityType: 'wall',
                field: 'thickness_mm',
                value: 220,
              },
            ],
            requestId,
          }),
        );
      }

      const items = historyOf(floorId);
      const source = items.find((item) => item.id === versionId);

      if (source === undefined) {
        return failed(
          mockWireError(422, 'VERSION_FLOOR_MISMATCH', requestId, { code: 'VERSION_FLOOR_MISMATCH', field: 'body.floorId' }),
        );
      }

      const sequence = Math.max(...items.map((item) => item.sequence)) + 1;
      const revision = Math.max(current, ...items.map((item) => item.floorRevision)) + 1;
      const restored: MockFloorVersion = {
        createdAt: '2026-09-17T05:10:00.000Z',
        creatorId: 'usr_01J9ZV8Q3M7X5B2N4K6P8R0T1A',
        creatorName: 'Kỹ sư mẫu',
        floorRevision: revision,
        hasSnapshot: true,
        id: mockVersionId(sequence),
        note: `Phục hồi nội dung của phiên bản v${String(source.sequence)}`,
        sequence,
      };

      items.unshift(restored);
      layerRevisions.set(floorId, revision);

      return ok(clone(restored));
    },
    snapshot: async ({ floorId, versionId }) => {
      const items = historyOf(floorId);
      const version = items.find((item) => item.id === versionId);

      if (version === undefined) {
        return failed(
          mockWireError(422, 'VERSION_FLOOR_MISMATCH', 'req-version-snapshot', {
            code: 'VERSION_FLOOR_MISMATCH',
            field: 'floorId',
          }),
        );
      }

      const floor = readFloors().find((item) => item.id === floorId) ?? makeFallbackFloor(floorId);
      const document = makeLayerDocument(floor, layerRevisions.get(floorId) ?? 0, writtenLayers.get(floorId));
      // Bản càng cũ càng thiếu tường cuối — đủ để so sánh hiện ra thay đổi trong bản mock.
      const age = (items[0]?.sequence ?? version.sequence) - version.sequence;
      const walls = document.layer.walls.slice(0, Math.max(0, document.layer.walls.length - age));

      return ok({ dimensions: document.dimensions, layer: { ...document.layer, walls }, versionId });
    },
  };
};

/**
 * N42–N44 trong bộ nhớ: lượt mới là `queued`, sau `MOCK_LIGHTING_BAKE_MS` đọc lại thấy `done`.
 * Tệp là Blob giữ chỗ (manifest hợp lệ, GLB/PNG không dựng được cảnh) — đủ cho luồng trạng thái.
 */
export const MOCK_LIGHTING_BAKE_MS = 3000;
const mockBakes = new Map<string, { id: string; createdAt: string; startMs: number }>();

const mockBakeView = (bake: { id: string; createdAt: string; startMs: number }): LightingBake =>
  Date.now() - bake.startMs < MOCK_LIGHTING_BAKE_MS
    ? { id: bake.id, status: 'queued', createdAt: bake.createdAt }
    : { id: bake.id, status: 'done', createdAt: bake.createdAt, startedAt: bake.createdAt, endedAt: new Date().toISOString() };

const mockLightingBakes: ApiClient['lightingBakes'] = {
  readFile: async (_projectId, _bakeId, name) =>
    ok(
      name === 'manifest.json'
        ? new Blob([JSON.stringify({ lightmap: 'lightmap.png', intensity: 1, channel: 1 })], { type: 'application/json' })
        : new Blob([name], { type: name === 'baked.glb' ? 'model/gltf-binary' : 'image/png' }),
    ),
  readLatest: async (projectId) => {
    const bake = mockBakes.get(projectId);
    return ok(bake === undefined ? null : mockBakeView(bake));
  },
  start: async (projectId) => {
    const current = mockBakes.get(projectId);
    if (current !== undefined && mockBakeView(current).status === 'queued') {
      return {
        ok: false,
        error: { kind: 'http', status: 409, code: 'LIGHTING_BAKE_IN_PROGRESS', requestId: 'mock', retryable: false, raw: null },
      };
    }
    const bake = { id: `bak_01JMBAKE${String(mockBakes.size).padStart(18, '0')}`, createdAt: new Date().toISOString(), startMs: Date.now() };
    mockBakes.set(projectId, bake);
    return ok(mockBakeView(bake));
  },
};

export const MOCK_SHARE_TOKEN = 'mock-share-ok';

export const createMockApiClient = (): ApiClient => {
  let project = buildProject();
  let floors = clone(project.floors);
  const currentLayer = (floorId: string): SpatialLayer =>
    clone(
      writtenLayers.get(floorId) ??
        makeLayerDocument(floors.find((item) => item.id === floorId) ?? makeFallbackFloor(floorId), 0).layer,
    );
  const uploads = new Map<string, Progress>([
    [
      uploadKey(project.id, SEEDED_UPLOAD_ID),
      makeProgress({ id: SEEDED_UPLOAD_ID, progressPercent: 100, status: 'completed' }),
    ],
  ]);
  /** Lượt tải mới nhất của từng tầng — nguồn của N7. Tầng có bản vẽ sẵn mang lượt mồi. */
  const latestUploadByFloor = new Map<string, string>(
    floors.filter((floor) => floor.drawings.length > 0).map((floor) => [floor.id, SEEDED_UPLOAD_ID]),
  );
  let uploadSequence = 0;
  let qualityFloors = makeMeasuredFloors();
  const propertyTemplates: PropertyTemplate[] = [];
  let adminUsers: AdminUser[] = MOCK_ADMIN_USERS.map(clone);
  let nextInviteSequence = adminUsers.length;
  /** Hồ sơ của người đang đăng nhập (N11–N14); dựng lười từ thư của lượt đăng nhập giả gần nhất. */
  let mockMe: Me | null = null;
  let avatarSequence = 0;
  const readMockMe = (): Me => {
    const email = lastSignedInEmail ?? 'nguoi-dung@example.com';

    // Đổi người đăng nhập giả thì hồ sơ dựng lại, không mang hồ sơ của người trước.
    if (mockMe?.email !== email) {
      mockMe = { email, fullName: 'Người dùng thử', language: 'vi' };
    }

    return mockMe;
  };

  const readAdminUser = (userId: string): AdminUser | undefined =>
    adminUsers.find((candidate) => candidate.id === userId);

  const writeAdminUser = (next: AdminUser): AdminUser => {
    adminUsers = adminUsers.map((candidate) => (candidate.id === next.id ? next : candidate));

    return clone(next);
  };

  /** Vai của phiên hiện tại có được đọc bảng người dùng không — `user.manage` là quyền của quản trị. */
  const isUserAdminForbidden = (): boolean => !roleOfEmail(lastSignedInEmail).includes('admin');

  const missingAdminUser = (userId: string): Result<never, HttpError> =>
    failed(mockUsersHttpError(404, `req-users-${userId}`));

  let notifications: Notification[] = MOCK_NOTIFICATIONS.map(clone);
  let summaries: ProjectSummary[] = MOCK_PROJECT_SUMMARIES.map(clone);
  const mockSettings = new Map<string, ProjectSettings>();
  /** N21/N22 theo dự án, sống trong một lượt `createMockApiClient()`; chưa lưu → `{ revision: 0, overrides: {} }`. */
  const mockRuleConfigs = new Map<string, ProjectRuleConfig>();

  const readNotification = (notificationId: string): Notification | undefined =>
    notifications.find((candidate) => candidate.id === notificationId);

  const writeNotification = (next: Notification): Notification => {
    notifications = notifications.map((candidate) => (candidate.id === next.id ? next : candidate));

    return clone(next);
  };

  const missingNotification = (notificationId: string): Result<never, HttpError> =>
    failed(mockNotificationsHttpError(404, `req-notifications-${notificationId}`));

  const readQualityFloor = (floorId: string): FloorImageQuality =>
    qualityFloors.find((item) => item.floorId === floorId) ?? makeFallbackQualityFloor(floorId);

  const writeQualityFloor = (floorId: string, next: FloorImageQuality): void => {
    qualityFloors = qualityFloors.some((item) => item.floorId === floorId)
      ? qualityFloors.map((item) => (item.floorId === floorId ? next : item))
      : [...qualityFloors, next];
  };

  const readAssessment = (projectId: string, floorId: string): ImageQualityAssessment => ({
    floorId,
    floors: clone(qualityFloors),
    projectId,
  });

  const readMockGraph = () => {
    const documents = floors.map((floor) =>
      makeLayerDocument(floor, layerRevisions.get(floor.id) ?? 0, writtenLayers.get(floor.id)),
    );
    const ofLayer = <K extends Exclude<keyof SpatialLayer, 'roofs'>>(key: K): SpatialLayer[K][number][] =>
      documents.flatMap((doc) => [...doc.layer[key]]);

    return ok({
      floorRevisions: documents.map((doc) => ({ floorId: doc.level.id, revision: doc.revision })),
      graph: {
        axes: documents.flatMap((doc) => doc.axes),
        building: clone(SAMPLE_BUILDING.building),
        dimensions: documents.flatMap((doc) => doc.dimensions),
        furniture: ofLayer('furniture'),
        levels: documents.map((doc) => doc.level),
        notes: [],
        openings: ofLayer('openings'),
        rooms: ofLayer('rooms'),
        walls: ofLayer('walls'),
      },
    });
  };

  return {
    /**
     * Accepts whatever it is given, like every other group in this file.
     *
     * A mock that refused some passwords would be modelling a policy no test
     * here asserts, and the screen's own failure paths are driven through its
     * gateway port instead — see `AuthScreen.test.tsx`. `undefined` rather than
     * a token because the real client returns none either: the session arrives
     * through `bootstrapSession()`, not through this response.
     *
     * Cái GHI LẠI địa chỉ vừa gửi là phần mới, và nó không đổi hình dạng trả về
     * một chút nào — `ApiResult<void>` vẫn là `ApiResult<void>`. Vai không thể
     * đi ra bằng đường này: `AuthApi.signIn` khai `void`, đúng vì máy chủ thật
     * cũng không trả vai ở đây. Vai đi ra ở lượt gia hạn ngay sau đó, và
     * {@link createMockAuthTransport} là bên trả lời lượt ấy — nó đọc đúng địa
     * chỉ ghi ở đây để biết cấp vai nào.
     */
    auth: {
      acceptInvitation: async () => ok(undefined),
      confirmPasswordReset: async () => ok(undefined),
      /** Token chứa `invalid`/`expired`/`used` → 422 đúng mã B2, để dựng ba màn lỗi trên dev mock. */
      previewInvitation: async ({ body }) => {
        const code = (['invalid', 'expired', 'used'] as const).find((word) => body.token.includes(word));

        return code === undefined
          ? ok({
              email: 'engineer@example.com',
              expiresAt: MOCK_USERS_INVITE_EXPIRY,
              inviterName: 'Quản Trị Viên',
              role: 'engineer' as const,
              status: 'valid' as const,
            })
          : failed({
              // Như HttpError thật: mã ở `code` (cho `readWireError`), thân lỗi ở `raw`.
              code: `INVITATION_TOKEN_${code.toUpperCase()}`,
              kind: 'http',
              raw: { code: `INVITATION_TOKEN_${code.toUpperCase()}` },
              requestId: 'req-invitation-preview',
              retryable: false,
              status: 422,
            });
      },
      requestPasswordReset: async () => ok(undefined),
      signIn: async ({ body }) => {
        lastSignedInEmail = body.email;
        return ok(undefined);
      },
    },
    drawings: {
      complete: async ({ body, projectId }) => {
        const completed = makeProgress({ id: body.uploadId, progressPercent: 100, status: 'completed' });
        uploads.set(uploadKey(projectId, body.uploadId), completed);
        return ok(completed);
      },
      initUpload: async ({ body }) => {
        // `upl_<ULID>` như máy chủ thật, để N7 của mock vẫn qua `LatestFloorUploadSchema`.
        uploadSequence += 1;
        const uploadId = `upl_01J8Z3K4Q5R6S7T8V9W${String(uploadSequence).padStart(7, '0')}`;
        const progress = makeProgress({ id: uploadId, step: 'Initialize upload' });
        uploads.set(uploadKey(body.projectId, uploadId), progress);
        latestUploadByFloor.set(body.floorId, progress.id);
        return ok(progress);
      },
      latestUploads: async () =>
        ok(
          [...floors]
            .sort((left, right) => left.order - right.order)
            .flatMap((floor) => {
              const uploadId = latestUploadByFloor.get(floor.id);

              return uploadId === undefined ? [] : [{ floorId: floor.id, floorName: floor.name, uploadId }];
            }),
        ),
      listPipelineRuns: async ({ cursor, limit = 50 }) => {
        const start = cursor === undefined ? 0 : Number(cursor);
        const page = MOCK_PIPELINE_RUNS.slice(start, start + limit).map(clone);
        const next = start + limit < MOCK_PIPELINE_RUNS.length ? String(start + limit) : undefined;

        return ok({ droppedCount: 0, items: page, ...(next !== undefined ? { nextCursor: next } : {}) });
      },
      // Không dựng PDF trong mock: ô chọn trang lùi về danh sách chữ.
      pageThumbnails: async () => ok([]),
      progress: async ({ projectId, uploadId }) =>
        ok(uploads.get(uploadKey(projectId, uploadId)) ?? makeProgress({ id: uploadId, progressPercent: 0 })),
      sendChunk: async ({ body, projectId, uploadId }) => {
        const key = uploadKey(projectId, uploadId);
        const current = uploads.get(key) ?? makeProgress({ id: uploadId, progressPercent: 0 });
        const next = clone(current);
        next.step = 'Send chunk';
        next.progressPercent = Math.min(99, next.progressPercent + 25 + body.chunkIndex);
        uploads.set(key, next);
        return ok(next);
      },
    },
    featureFlags: {
      read: async () => ok({ flags: { ...MOCK_SERVER_FEATURE_FLAGS } }),
    },
    floors: {
      create: async ({ body }) => {
        const next: Floor = {
          ...(body.areaM2 !== undefined ? { areaM2: body.areaM2 } : {}),
          drawings: body.drawings ?? [],
          elevationMm: body.elevationMm,
          heightMm: body.heightMm,
          id: body.id,
          name: body.name,
          order: body.order,
        };
        floors = [...floors, next];
        project = { ...project, floors: clone(floors) };
        return ok(next);
      },
      delete: async ({ floorId }) => {
        const removed = floors.find((item) => item.id === floorId) ?? makeFallbackFloor(floorId);
        floors = floors.filter((item) => item.id !== floorId);
        project = { ...project, floors: clone(floors) };
        return ok(clone(removed));
      },
      list: async () => ok(clone(floors)),
      reorder: async ({ body }) => {
        const ordered = body.floorIds
          .map((floorId) => floors.find((item) => item.id === floorId))
          .filter((item): item is Floor => item !== undefined);
        if (ordered.length > 0) {
          floors = ordered;
          project = { ...project, floors: clone(floors) };
        }
        return ok(clone(floors));
      },
    },
    /**
     * Cùng mười sáu mục cho mọi lượt gọi, và `read` không bao giờ trượt.
     *
     * Không có trạng thái ghi nào ở đây, khác `quality` và `propertyTemplates`:
     * `LibraryApi` chỉ đọc, nên không thao tác nào của màn làm danh mục đổi đi.
     */
    library: {
      list: async () => ok(MOCK_LIBRARY_ITEMS.map(clone)),
      read: async ({ libraryItemId }) =>
        ok(
          clone(
            MOCK_LIBRARY_ITEMS.find((item) => item.id === libraryItemId) ??
              makeFallbackLibraryItem(libraryItemId),
          ),
        ),
    },
    // AID-01: mock không có AI phong cách — thẻ giữ năm kiểu cũ.
    suggestionRules: {
      // `null` = "máy chủ không có bảng" (như 404): nơi gọi dùng bảng gói kèm — client giả không kéo bảng vào gói.
      read: async () => ok(null),
    },
    designConcept: {
      read: async () => ok({ enabled: false }),
      select: async () => failed(mockWireError(503, 'DESIGN_DIRECTOR_DISABLED', 'req-design-concept')),
    },
    lightingBakes: mockLightingBakes,
    // M1-01: mock chưa có máy dựng GLB — chưa xuất lần nào, gửi xuất thì báo hỏng.
    modelExports: {
      readFile: async () => failed(mockWireError(404, 'NOT_FOUND', 'req-model-export')),
      readLatest: async () => ok(null),
      start: async () => failed(mockWireError(503, 'MODEL_EXPORT_FAILED', 'req-model-export')),
    },
    /** N11–N14 có trạng thái trong mock: sửa xong đọc lại thấy ngay; `''` ở `jobTitle`/`phone` là xoá. */
    me: {
      changePassword: async () => ok(undefined),
      readProfile: async () => ok(clone(readMockMe())),
      replaceAvatar: async () => {
        avatarSequence += 1;
        mockMe = {
          ...readMockMe(),
          avatarUrl: `https://cdn.example.test/avatars/01J0MOCKAVATAR${String(avatarSequence).padStart(4, '0')}.png`,
        };

        return ok(clone(mockMe));
      },
      updateProfile: async ({ body }) => {
        const { jobTitle, phone, ...rest } = readMockMe();
        const nextJobTitle = body.jobTitle === undefined ? jobTitle : body.jobTitle;
        const nextPhone = body.phone === undefined ? phone : body.phone;

        mockMe = {
          ...rest,
          ...(body.fullName !== undefined ? { fullName: body.fullName } : {}),
          ...(body.language !== undefined ? { language: body.language } : {}),
          ...(nextJobTitle !== undefined && nextJobTitle !== '' ? { jobTitle: nextJobTitle } : {}),
          ...(nextPhone !== undefined && nextPhone !== '' ? { phone: nextPhone } : {}),
        };

        return ok(clone(mockMe));
      },
    },
    /**
     * Chấp nhận trả về chính mục vừa đổi, cùng khuôn mọi lượt GHI khác của
     * `users` bên dưới — `changeRole`/`disable`/`enable` đều làm vậy.
     * `markRead`/`markAllRead` trả `void`, đúng chữ ký
     * `NotificationCenterGateway` mà nhóm này phục vụ.
     */
    members: {
      add: async ({ email, projectId }) => {
        const address = email.trim().toLowerCase();

        if (!MOCK_KNOWN_MEMBER_EMAILS.includes(address)) {
          return failed(mockWireError(422, 'MEMBER_USER_UNAVAILABLE', `req-members-${projectId}`));
        }

        return ok({
          email: address,
          id: MOCK_KNOWN_MEMBER_IDS[address] ?? 'usr_01HZX3K9M2Q4R6T8V0W1Y3A5C3',
          name: address.split('@')[0] ?? address,
          role: 'viewer',
        });
      },
      remove: async ({ userId }) => {
        const known = Object.entries(MOCK_KNOWN_MEMBER_IDS).find(([, id]) => id === userId)?.[0];
        const email = known ?? `${userId}@example.com`;

        return ok({ email, id: userId, name: email.split('@')[0] ?? email, role: 'viewer' });
      },
    },
    notifications: {
      acceptInvite: async ({ notificationId }) => {
        const current = readNotification(notificationId);

        return current === undefined
          ? missingNotification(notificationId)
          : ok(writeNotification({ ...current, isRead: true }));
      },
      list: async () => ok(notifications.map(clone)),
      listPage: async ({ cursor, limit = 200 } = {}) => {
        const start = cursor === undefined ? 0 : Number(cursor);
        const next = start + limit < notifications.length ? String(start + limit) : undefined;

        return ok({
          items: notifications.slice(start, start + limit).map(clone),
          ...(next !== undefined ? { nextCursor: next } : {}),
        });
      },
      markAllRead: async () => {
        notifications = notifications.map((item) => ({ ...item, isRead: true }));

        return ok(undefined);
      },
      markRead: async ({ body }) => {
        notifications = notifications.map((item) =>
          body.ids.includes(item.id) ? { ...item, isRead: true } : item,
        );

        return ok(undefined);
      },
    },
    projectSettings: {
      read: async ({ projectId }) => ok(clone(mockSettings.get(projectId) ?? MOCK_SETTINGS_INITIAL)),
      replace: async ({ baseVersion, body, projectId }) => {
        const current = mockSettings.get(projectId) ?? MOCK_SETTINGS_INITIAL;

        if (baseVersion !== current.revision) {
          return failed(mockWireError(409, 'VERSION_CONFLICT', `req-settings-${projectId}`, { remoteChanges: [] }));
        }

        const { notes, ...rest } = body;
        const next: ProjectSettings = { ...rest, ...(notes !== undefined ? { notes } : {}), revision: current.revision + 1 };

        mockSettings.set(projectId, next);

        return ok(clone(next));
      },
    },
    projectSummaries: {
      list: async (): Promise<Result<ProjectSummaryList, never>> =>
        ok({ droppedCount: 0, items: summaries.map(clone) }),
    },
    projects: {
      create: async ({ body }) => {
        project = applyProjectBody(
          {
            ...buildProject(),
            floors: clone(floors),
          },
          body,
        );
        project = {
          ...project,
          createdAt: '2026-08-03T08:35:00.000Z',
          id: `project-${body.name.replace(/\s+/g, '-').toLowerCase()}`,
          floors: clone(floors),
          updatedAt: '2026-08-03T08:35:00.000Z',
        };
        return ok(clone(project));
      },
      delete: async ({ projectId }) => {
        summaries = summaries.filter((row) => row.id !== projectId);
        const removed = clone(project);
        project = buildProject();
        floors = clone(project.floors);
        return ok({ ...removed, id: projectId });
      },
      cancelCreate: async ({ projectId }) => {
        summaries = summaries.filter((row) => row.id !== projectId);
        const removed = clone(project);
        project = buildProject();
        floors = clone(project.floors);
        return ok({ ...removed, id: projectId });
      },
      list: async () => ok([clone(project)]),
      read: async ({ projectId }) =>
        projectId === MOCK_MISSING_PROJECT_ID
          ? failed({
              kind: 'http',
              raw: { resource: 'project' },
              requestId: 'req-project-missing',
              retryable: false,
              status: 404,
            })
          : ok({ ...clone(project), id: projectId }),
      update: async ({ body, projectId }) => {
        if (body.name !== undefined) {
          const name = body.name;

          summaries = summaries.map((row) => (row.id === projectId ? { ...row, name } : row));
        }
        project = {
          ...applyProjectBody(project, body),
          id: projectId,
          floors: clone(floors),
          updatedAt: '2026-08-03T08:40:00.000Z',
        };
        return ok(clone(project));
      },
    },
    /**
     * Khuôn mẫu thuộc tính, giữ trong bộ nhớ của MỘT lượt `createMockApiClient()`
     * — cùng vòng đời với `floors`/`project` ở trên, không phải một bảng dữ
     * liệu toàn cục (`mockApiClient` module-level vẫn dùng chung một bản, đúng
     * như mọi nhóm khác của file này).
     */
    propertyTemplates: {
      create: async ({ body, projectId }) => {
        const next: PropertyTemplate = {
          createdAt: '2026-08-03T08:00:00.000Z',
          fields: clone(body.fields),
          id: `template-${propertyTemplates.length + 1}`,
          name: body.name,
          objectKind: body.objectKind,
          projectId,
          scope: 'project',
        };

        propertyTemplates.push(next);
        return ok(clone(next));
      },
      list: async ({ projectId }) =>
        ok(propertyTemplates.filter((template) => template.projectId === projectId).map(clone)),
    },
    /**
     * Cùng bốn tầng cho mọi lượt gọi, và hai lối sửa thật sự đổi dữ liệu.
     *
     * `straighten` và `setCorners` ghi lại vào `qualityFloors` chứ không trả
     * một bản dựng sẵn: story và test của màn cần thấy phát hiện tương ứng biến
     * mất sau khi bấm, và một mock trả mãi cùng một câu trả lời thì không phân
     * biệt được "đã sửa" với "chưa bấm".
     */
    quality: {
      assess: async ({ floorId, projectId }) => ok(readAssessment(projectId, floorId)),
      /* Bộ mẫu như máy chủ cũ: chưa có hai endpoint lô 2b — màn tự lùi về hành vi cũ. */
      dimensionStrings: async () => failed(endpointMissing('dimension-strings')),
      detectedGeometry: async () => failed(endpointMissing('detected-geometry')),
      setCorners: async ({ body, floorId, projectId }) => {
        const current = readQualityFloor(floorId);

        writeQualityFloor(floorId, {
          ...current,
          expectedConfidence: 0.88,
          findings: current.findings.filter((finding) => finding.code !== 'FRAME_NOT_FOUND'),
          frame: { corners: clone(body.corners), isFound: true },
          isMeasured: true,
        });

        return ok(readAssessment(projectId, floorId));
      },
      straighten: async ({ floorId, projectId }) => {
        const current = readQualityFloor(floorId);
        const measurement = current.measurement;

        writeQualityFloor(floorId, {
          ...current,
          expectedConfidence: 0.86,
          findings: current.findings.filter((finding) => finding.code !== 'SKEW_DETECTED'),
          isMeasured: true,
          ...(measurement !== undefined ? { measurement: { ...measurement, skewDeg: 0.2 } } : {}),
        });

        return ok(readAssessment(projectId, floorId));
      },
    },
    ruleConfig: {
      read: async ({ projectId }) => ok(clone(mockRuleConfigs.get(projectId) ?? { overrides: {}, revision: 0 })),
      replace: async ({ baseVersion, body, projectId }) => {
        const revision = mockRuleConfigs.get(projectId)?.revision ?? 0;

        if (baseVersion !== revision) {
          return failed(
            mockWireError(409, 'VERSION_CONFLICT', `req-rule-config-${projectId}`, {
              currentVersion: revision,
              remoteChanges: [],
            }),
          );
        }

        // Thân gửi cho phép khoá mang `undefined`; bản lưu thì vắng là vắng (`exactOptionalPropertyTypes`).
        const overrides = Object.fromEntries(
          Object.entries(body.overrides).map(([code, { enabled, severity, thresholds }]) => [
            code,
            {
              ...(enabled !== undefined ? { enabled } : {}),
              ...(severity !== undefined ? { severity } : {}),
              ...(thresholds !== undefined ? { thresholds: { ...thresholds } } : {}),
            },
          ]),
        );
        const next: ProjectRuleConfig = { overrides, revision: revision + 1 };

        mockRuleConfigs.set(projectId, next);

        return ok(clone(next));
      },
    },
    share: {
      /** Token `mock-share-ok` mở được; mọi token khác 404 `resource:"share_link"` như máy chủ. */
      open: async ({ token }) => {
        if (token !== MOCK_SHARE_TOKEN) {
          return failed(mockWireError(404, 'NOT_FOUND', 'req-share-open', { code: 'NOT_FOUND', resource: 'share_link' }));
        }
        const graph = readMockGraph();

        return graph.ok
          ? ok({
              graph: graph.data,
              link: {
                createdAt: '2026-10-25T00:00:00Z',
                expiresAt: null,
                id: 'shl_mock',
                label: null,
                passwordProtected: false,
                permission: 'view' as const,
                revokedAt: null,
                status: 'active' as const,
                url: `/share/${MOCK_SHARE_TOKEN}`,
                viewpointCode: null,
              },
              projectName: project.name,
            })
          : failed(mockWireError(500, "INTERNAL", "req-share-open"));
      },
    },
    spatial: {
      patchFloor: async ({ body, floorId }) => {
        const current = floors.find((item) => item.id === floorId) ?? makeFallbackFloor(floorId);
        const next = applyFloorBody({ ...current, id: floorId }, body);
        floors = floors.map((item) => (item.id === floorId ? next : item));
        project = { ...project, floors: clone(floors) };
        return ok(next);
      },
      readFloor: async ({ floorId }) => ok(clone(floors.find((item) => item.id === floorId) ?? makeFallbackFloor(floorId))),
      readVersion: async ({ projectId, versionId }) => ok({ ...makeVersion(), projectId, id: versionId }),
      /** Xuất có kiểm quyền: mock coi người gọi có `model.export`, trả y như N15. */
      exportGraph: async () => readMockGraph(),
      /** N15: lớp chung của mọi tầng `floors`, một dòng `revision` mỗi `Level` (không `scaleStatus`). */
      readGraph: async () => readMockGraph(),
      readLayer: async ({ floorId }) => {
        const floor = floors.find((item) => item.id === floorId) ?? makeFallbackFloor(floorId);

        return ok({
          ...makeLayerDocument(floor, layerRevisions.get(floorId) ?? 0, writtenLayers.get(floorId)),
          ...suggestionKeysOf(floorId),
        });
      },
      /**
       * Lưu lớp theo luật base của #35 (`writer.py`): base > revision → 422 `baseVersion`;
       * base cũ → 409 `VERSION_CONFLICT`, trừ lượt gửi lại ĐÚNG base và thân của lượt
       * ghi cuối (C09b) → 200 kết quả hiện tại; còn lại tăng `revision`.
       */
      writeLayer: async ({ baseVersion, body, floorId }) => {
        const current = layerRevisions.get(floorId) ?? 0;
        const requestId = `req-layer-${floorId}`;
        const bodyKey = JSON.stringify(body);
        const last = lastLayerWrites.get(floorId);

        if (baseVersion > current) {
          return failed(
            mockWireError(422, 'VALIDATION', requestId, {
              code: 'VALIDATION',
              field: 'baseVersion',
              message: 'baseVersion vượt quá revision hiện tại',
              requestId,
            }),
          );
        }

        if (baseVersion < current) {
          if (last !== undefined && last.base === baseVersion && last.body === bodyKey && last.revision === current) {
            return ok({ layer: currentLayer(floorId), revision: current });
          }

          return failed(
            mockWireError(409, 'VERSION_CONFLICT', requestId, {
              code: 'VERSION_CONFLICT',
              currentVersion: current,
              remoteChanges: [
                {
                  changedAt: '2026-09-17T05:09:00.123Z',
                  changedBy: MOCK_REMOTE_ACTOR_ID,
                  changedByName: 'Trần Minh',
                  entityId: 'W-WALL0014',
                  entityType: 'wall',
                  field: 'thickness_mm',
                  value: 220,
                },
              ],
              requestId,
            }),
          );
        }

        const revision = current + 1;

        layerRevisions.set(floorId, revision);
        lastLayerWrites.set(floorId, { base: baseVersion, body: bodyKey, revision });

        if (body.layer !== undefined) {
          writtenLayers.set(floorId, clone(body.layer));
        }

        if (body.axes !== undefined) {
          writtenAxes.set(floorId, clone(body.axes));
        }

        if (body.origin !== undefined) {
          writtenOrigins.set(floorId, { ...body.origin });
        }

        // Thân chỉ tỉ lệ giữ lớp; có tỉ lệ → tỉ lệ nguồn `human`, gỡ `scaleStatus` (#35).
        if (body.scaleMillimetresPerPixel !== undefined) {
          writtenScales.set(floorId, {
            provisional: false,
            source: 'pipeline',
            value: body.scaleMillimetresPerPixel as MillimetresPerPixel,
          });
        }

        // M2: trạng thái thưa thay cả trạng thái người dùng của tầng; id lạ → 422 như máy chủ (hợp đồng §4).
        const stored = mockSuggestions.get(floorId);
        if (body.suggestionState !== undefined && (stored !== undefined || body.suggestionState.length > 0)) {
          try {
            // Tầng chưa có lớp đề xuất nào: mọi id đều lạ → 422 như máy chủ.
            if (stored === undefined) throw new Error('unknown');
            stored.suggestions = applyMockState(stored.suggestions, body.suggestionState);
          } catch {
            return failed(mockWireError(422, 'VALIDATION', requestId, { code: 'VALIDATION', field: 'suggestionState', message: 'id đề xuất lạ', requestId }));
          }
        }
        if (body.suggestionsEnabled !== undefined && stored !== undefined) {
          stored.enabled = body.suggestionsEnabled;
        }

        return ok({ layer: currentLayer(floorId), revision, ...suggestionKeysOf(floorId) });
      },
    },
    /**
     * Quản trị người dùng — T-04/T-05.
     *
     * Giữ trong bộ nhớ của MỘT lượt `createMockApiClient()`, cùng khuôn với
     * `propertyTemplates` ở trên: mời rồi đọc lại trong cùng một phiên thì thấy
     * người vừa mời, còn hai bài kiểm cạnh nhau không dẫm lên nhau vì mỗi bài
     * dựng client riêng.
     *
     * `list` là lượt gọi DUY NHẤT trong file này từ chối phục vụ, và nó từ chối
     * theo VAI chứ không theo cờ: `roleOfEmail(lastSignedInEmail)` là cùng bảng
     * mà lượt gia hạn đọc, nên đăng nhập bằng `viewer@example.com` cho ra `403`
     * ở đây đúng lúc `useViewer3D` chuyển sang `forbidden` ở kia. Một cờ môi
     * trường riêng cho màn này sẽ là nguồn thứ hai cho cùng một câu hỏi.
     *
     * Hai lượt đọc theo người trả `500` cho {@link MOCK_USERS_ERROR_USER_ID} —
     * đó là nhánh "Lỗi" của A11, và nó là một ID chứ không phải một cờ vì cùng
     * một màn phải hiện được panel lỗi cho một người trong khi bảng bên cạnh vẫn
     * đúng: đúng định nghĩa trạng thái "Một phần".
     */
    users: {
      activity: async ({ userId }) =>
        userId === MOCK_USERS_ERROR_USER_ID
          ? failed(mockUsersHttpError(500, 'req-users-activity'))
          : ok((MOCK_USER_ACTIVITY[userId] ?? []).map(clone)),
      changeRole: async ({ body }) => {
        // N4-03: kịch bản "người sửa cuối cùng" — hạ Engineer (user-2) của project-1 xuống Người xem bị từ chối.
        if (body.userId === 'user-2' && body.role === 'viewer') {
          return failed(
            mockWireError(422, 'MEMBER_LAST_EDITOR', 'req-users-role-last-editor', { code: 'MEMBER_LAST_EDITOR' }),
          );
        }

        const current = readAdminUser(body.userId);

        return current === undefined
          ? missingAdminUser(body.userId)
          : ok(writeAdminUser({ ...current, role: body.role }));
      },
      disable: async ({ userId }) => {
        const current = readAdminUser(userId);

        return current === undefined
          ? missingAdminUser(userId)
          : ok(writeAdminUser({ ...current, status: 'disabled' }));
      },
      enable: async ({ userId }) => {
        const current = readAdminUser(userId);

        return current === undefined
          ? missingAdminUser(userId)
          : ok(writeAdminUser({ ...current, status: 'active' }));
      },
      /**
       * Một lời mời cho nhiều địa chỉ sinh ra nhiều người ở trạng thái `'pending'`.
       *
       * `invitedAt` và `inviteExpiresAt` đặt quanh {@link MOCK_USERS_REFERENCE_TIME}
       * chứ không quanh `Date.now()` — xem docblock của bảng người dùng cho lý
       * do. Lời mời mới luôn CÒN hạn: người vừa bấm mời phải thấy một dòng chưa
       * hết hạn, còn hai dòng hết hạn sẵn có là để nút "gửi lại" có việc ngay khi
       * mở màn.
       *
       * `name` lấy chính địa chỉ thư: người được mời chưa từng đăng nhập nên chưa
       * có tên nào để biết, và bịa một cái tên ở đây là dạy cho màn một sự thật
       * mà máy chủ thật không có.
       */
      invite: async ({ body }) => {
        const invited = body.emails.map((email): AdminUser => {
          nextInviteSequence += 1;

          return {
            email,
            id: `user-${nextInviteSequence}`,
            inviteExpiresAt: MOCK_USERS_INVITE_EXPIRY,
            invitedAt: MOCK_USERS_REFERENCE_TIME,
            lastActiveAt: null,
            name: email,
            projectCount: 0,
            role: body.role,
            status: 'pending',
          };
        });

        adminUsers = [...adminUsers, ...invited];

        return ok(invited.map(clone));
      },
      list: async () =>
        isUserAdminForbidden()
          ? failed(mockUsersHttpError(403, 'req-users-list'))
          : ok({ total: adminUsers.length, users: adminUsers.map(clone) } satisfies AdminUserList),
      memberships: async ({ userId }) =>
        userId === MOCK_USERS_ERROR_USER_ID
          ? failed(mockUsersHttpError(500, 'req-users-memberships'))
          : ok((MOCK_USER_MEMBERSHIPS[userId] ?? []).map(clone)),
      remove: async ({ body }) => {
        const current = readAdminUser(body.userId);

        if (current === undefined) {
          return missingAdminUser(body.userId);
        }

        adminUsers = adminUsers.filter((candidate) => candidate.id !== body.userId);

        return ok(clone(current));
      },
      /** Gửi lại đẩy hạn về phía trước; `userId` là id người được mời. */
      resendInvite: async ({ userId }) => {
        const current = readAdminUser(userId);

        return current === undefined
          ? missingAdminUser(userId)
          : ok(
              writeAdminUser({
                ...current,
                inviteExpiresAt: MOCK_USERS_INVITE_EXPIRY,
                invitedAt: MOCK_USERS_REFERENCE_TIME,
              }),
            );
      },
    },
    versions: createMockVersionsApi(() => floors),
  };
};

export const mockApiClient = createMockApiClient();
export const createApiClientMock = createMockApiClient;

