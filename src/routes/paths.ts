/**
 * Every URL the application has, in one table. (R-65, R-66)
 *
 * The counterpart to `src/api/endpoints.ts`: that file owns where the *server*
 * lives, this one owns where the *screens* live. Both exist for the same reason
 * — a path written at the call site is a string nothing checks, and it fails at
 * runtime, in the one environment you did not click through.
 *
 * ## Why this is its own file, not part of the router
 *
 * R-65 names `src/routes.tsx` as the home for these constants, and `@/routes`
 * still answers for them — `./index.ts` re-exports this module. But a screen
 * cannot import the *router*: that module lazily imports every screen, so a
 * screen reaching back for a constant closes an import cycle, and `pnpm cycles`
 * runs `import/no-cycle` at unlimited depth with dynamic imports counted. Tried
 * it: three cycle points. The remedy is the one the cycle gate prints in its own
 * failure message — move the shared part down to a lower module. This file
 * imports nothing at all, so nothing can cycle through it, and that is why
 * **screens import `@/routes/paths`** rather than `@/routes`.
 *
 * ## Two tables, because a route is written twice
 *
 * `ROUTE_PATTERNS` is what `createBrowserRouter` registers: `:projectId` is a hole
 * the router fills. `ROUTES` is what `navigate()` is given: the hole is already
 * filled. Keeping them apart means a screen cannot accidentally navigate to the
 * literal string `/projects/:projectId/export`, which renders a page that looks almost
 * right and is entirely wrong.
 */

const PROJECTS_ROOT = '/projects';
const LAYERS_ROOT = '/layers';
const ADMIN_ROOT = '/admin';
const DESIGN_SYSTEM_ROOT = '/design-system';
/**
 * Gốc của các màn dựng riêng cho điện thoại.
 *
 * `/m` chứ không phải một tham số hay một tên miền phụ: màn di động là một màn
 * *khác*, không phải cùng màn thu nhỏ lại, nên nó có đường dẫn riêng để chia sẻ
 * được thẳng cho người đang ở công trường.
 */
const MOBILE_ROOT = '/m';

/**
 * What `createBrowserRouter` registers. `:projectId` and `:floorId` are the
 * router's holes.
 *
 * **Đúng một quy ước đặt tên tham số, không phải hai.** Cho tới 14-09-2026 bảng
 * này đặt lỗ cấp dự án tên cộc lốc là `id` nhưng lỗ cấp tầng là `:floorId` — hai
 * quy ước trong một cây route, và mỗi `useParams` phải nhớ mình đang đứng ở
 * nhánh nào. Nay mọi lỗ đều mang tên đầy đủ của thứ nó giữ: `:projectId`,
 * `:floorId`. `/m/du-an/:projectId` vốn đã đúng nên không đổi.
 *
 * **Năm khoá không còn ở đây, và đó là chủ ý:** `floors`, `layerDimensions`,
 * `layerGrids`, `layerObjects`, `layerRooms` — năm đường dẫn cũ ở gốc
 * (`/floors`, `/layers/*`) không mang mã dự án lẫn mã tầng, nên không màn nào
 * mở nổi dữ liệu nào từ chúng: ba cái đầu render một `<div>Canvas</div>` rỗng,
 * hai cái sau trỏ trùng đích với bản đã có `:projectId`. Đường thật của năm
 * việc đó là `projectFloors` và bốn builder `ROUTES.project.{dimensions,grids,
 * objects,rooms}(projectId, floorId)`.
 */
export const ROUTE_PATTERNS = {
  // Ngoại lệ duy nhất của quy ước "đường dẫn viết bằng tiếng Anh": đường dẫn của
  // màn cài đặt tài khoản là thứ người dùng đọc và gõ, nên nó là tiếng Việt.
  // Khoá vẫn là định danh tiếng Anh `account` — mục E.11 nói về mã, không nói về
  // URL, và mọi nơi gọi vẫn viết `ROUTES.account`.
  accessDenied: '/khong-co-quyen',
  account: '/tai-khoan',
  adminModels: `${ADMIN_ROOT}/models`,
  adminTrainingJobs: `${ADMIN_ROOT}/training/jobs`,
  adminTrainingModels: `${ADMIN_ROOT}/training/models`,
  adminUsers: `${ADMIN_ROOT}/users`,
  canvasOverlaysDemo: '/demo/canvas-overlays',
  dashboard: '/',
  dataEntryDemo: '/data-entry-demo',
  demoGallery: '/demo',
  designSystem: DESIGN_SYSTEM_ROOT,
  designSystemStates: `${DESIGN_SYSTEM_ROOT}/states`,
  feedbackDemo: '/feedback-demo',
  forgotPassword: '/login/forgot',
  invitationAccept: '/login/invitation',
  listReviewDemo: '/list-review-demo',
  login: '/login',
  // Đường dẫn tiếng Việt, cùng ngoại lệ đã ghi ở `accessDenied` và `account`:
  // đây là thứ người dùng đọc và gõ, còn khoá vẫn là định danh tiếng Anh.
  mobileViewer: `${MOBILE_ROOT}/du-an/:projectId`,
  notFound: '*',
  notifications: '/thong-bao',
  onboarding: '/onboarding',
  passwordReset: '/login/reset-password',
  projectData: `${PROJECTS_ROOT}/:projectId/data`,
  projectDimensions: `${PROJECTS_ROOT}/:projectId/floors/:floorId${LAYERS_ROOT}/dimensions`,
  /** K-32b — tải cả bộ hồ sơ; `:setId` vắng = chọn tệp, có = duyệt bộ đã tải. */
  projectDrawingSets: `${PROJECTS_ROOT}/:projectId/drawing-sets/:setId?`,
  projectExploded: `${PROJECTS_ROOT}/:projectId/3d/exploded`,
  projectExport: `${PROJECTS_ROOT}/:projectId/export`,
  /** Trang xem công khai của liên kết chia sẻ (không cần phiên). */
  sharedModel: '/share/:token',
  projectFloors: `${PROJECTS_ROOT}/:projectId/floors`,
  projectGrids: `${PROJECTS_ROOT}/:projectId/floors/:floorId${LAYERS_ROOT}/grids`,
  projectMeasure: `${PROJECTS_ROOT}/:projectId/3d/measure`,
  projectObjects: `${PROJECTS_ROOT}/:projectId/floors/:floorId/layers/objects`,
  projectOverlay: `${PROJECTS_ROOT}/:projectId/floors/:floorId/overlay`,
  projectPipeline: `${PROJECTS_ROOT}/:projectId/pipeline`,
  projectPipelineGraph: `${PROJECTS_ROOT}/:projectId/pipeline/graph`,
  projectQuality: `${PROJECTS_ROOT}/:projectId/quality`,
  projectRooms: `${PROJECTS_ROOT}/:projectId/floors/:floorId/layers/rooms`,
  projectRules: `${PROJECTS_ROOT}/:projectId/rules`,
  projectRuleSettings: `${PROJECTS_ROOT}/:projectId/rules/settings`,
  projectScale: `${PROJECTS_ROOT}/:projectId/floors/:floorId/scale`,
  projectSettings: `${PROJECTS_ROOT}/:projectId/settings`,
  projectThickness: `${PROJECTS_ROOT}/:projectId/floors/:floorId${LAYERS_ROOT}/thickness`,
  projectUpload: `${PROJECTS_ROOT}/:projectId/upload`,
  projectVersions: `${PROJECTS_ROOT}/:projectId/versions`,
  projectViewer: `${PROJECTS_ROOT}/:projectId/3d`,
  projectViewerPascal: `${PROJECTS_ROOT}/:projectId/3d/pascal`,
  projectWalls: `${PROJECTS_ROOT}/:projectId/floors/:floorId/layers/walls`,
  shellDemo: '/shell-demo',
  welcome: '/welcome',
  welcomeLab: '/welcome-lab/:idea',
} as const;

/**
 * What `navigate()` is given.
 *
 * Parameterised routes are functions, exactly as in `ENDPOINTS` — a function
 * cannot be handed to `navigate` by mistake, whereas a template string can.
 */
export const ROUTES = {
  accessDenied: ROUTE_PATTERNS.accessDenied,
  account: ROUTE_PATTERNS.account,
  adminModels: ROUTE_PATTERNS.adminModels,
  adminTrainingJobs: ROUTE_PATTERNS.adminTrainingJobs,
  adminTrainingModels: ROUTE_PATTERNS.adminTrainingModels,
  adminUsers: ROUTE_PATTERNS.adminUsers,
  /** Where a visitor lands when nothing more specific was asked for. */
  dashboard: ROUTE_PATTERNS.dashboard,
  demoGallery: ROUTE_PATTERNS.demoGallery,
  designSystem: ROUTE_PATTERNS.designSystem,
  designSystemStates: ROUTE_PATTERNS.designSystemStates,
  forgotPassword: ROUTE_PATTERNS.forgotPassword,
  invitationAccept: ROUTE_PATTERNS.invitationAccept,
  login: ROUTE_PATTERNS.login,
  mobileViewer: (projectId: string): string => `${MOBILE_ROOT}/du-an/${projectId}`,
  notifications: ROUTE_PATTERNS.notifications,
  onboarding: ROUTE_PATTERNS.onboarding,
  passwordReset: ROUTE_PATTERNS.passwordReset,
  project: {
    /** S-36 — Spatial JSON chỉ đọc của dự án. */
    data: (projectId: string): string => `${PROJECTS_ROOT}/${projectId}/data`,
    dimensions: (projectId: string, floorId: string): string =>
      `${PROJECTS_ROOT}/${projectId}/floors/${floorId}${LAYERS_ROOT}/dimensions`,
    drawingSets: (projectId: string, setId?: string): string =>
      `${PROJECTS_ROOT}/${projectId}/drawing-sets${setId === undefined ? '' : `/${setId}`}`,
    exploded: (projectId: string): string => `${PROJECTS_ROOT}/${projectId}/3d/exploded`,
    export: (projectId: string): string => `${PROJECTS_ROOT}/${projectId}/export`,
    floors: (projectId: string): string => `${PROJECTS_ROOT}/${projectId}/floors`,
    grids: (projectId: string, floorId: string): string =>
      `${PROJECTS_ROOT}/${projectId}/floors/${floorId}${LAYERS_ROOT}/grids`,
    measure: (projectId: string): string => `${PROJECTS_ROOT}/${projectId}/3d/measure`,
    objects: (projectId: string, floorId: string): string =>
      `${PROJECTS_ROOT}/${projectId}/floors/${floorId}${LAYERS_ROOT}/objects`,
    overlay: (projectId: string, floorId: string): string =>
      `${PROJECTS_ROOT}/${projectId}/floors/${floorId}/overlay`,
    pipeline: (projectId: string): string => `${PROJECTS_ROOT}/${projectId}/pipeline`,
    pipelineGraph: (projectId: string): string => `${PROJECTS_ROOT}/${projectId}/pipeline/graph`,
    quality: (projectId: string): string => `${PROJECTS_ROOT}/${projectId}/quality`,
    rooms: (projectId: string, floorId: string): string =>
      `${PROJECTS_ROOT}/${projectId}/floors/${floorId}/layers/rooms`,
    rules: (projectId: string): string => `${PROJECTS_ROOT}/${projectId}/rules`,
    ruleSettings: (projectId: string): string =>
      `${PROJECTS_ROOT}/${projectId}/rules/settings`,
    scale: (projectId: string, floorId: string): string =>
      `${PROJECTS_ROOT}/${projectId}/floors/${floorId}/scale`,
    settings: (projectId: string): string => `${PROJECTS_ROOT}/${projectId}/settings`,
    thickness: (projectId: string, floorId: string): string =>
      `${PROJECTS_ROOT}/${projectId}/floors/${floorId}${LAYERS_ROOT}/thickness`,
    upload: (projectId: string): string => `${PROJECTS_ROOT}/${projectId}/upload`,
    versions: (projectId: string): string => `${PROJECTS_ROOT}/${projectId}/versions`,
    viewer: (projectId: string): string => `${PROJECTS_ROOT}/${projectId}/3d`,
    viewerPascal: (projectId: string): string => `${PROJECTS_ROOT}/${projectId}/3d/pascal`,
    walls: (projectId: string, floorId: string): string =>
      `${PROJECTS_ROOT}/${projectId}/floors/${floorId}${LAYERS_ROOT}/walls`,
  },
  welcome: ROUTE_PATTERNS.welcome,
} as const;

/**
 * Những đường một người chưa đăng nhập vẫn phải vào được.
 *
 * `SessionBootstrap` đọc bảng này để biết lúc nào **không** được chặn màn con
 * lại chờ phiên. Ba chuỗi viết thẳng chứ không lấy từ `ROUTE_PATTERNS`, và đó là
 * chủ ý: hai đường sau là route F-09a sắp thêm, còn bảng trên chỉ ghi những
 * route đã tồn tại. Một hằng ở đây không dựng ra route nào — nó chỉ nói "nếu
 * đường này tồn tại thì nó công khai".
 *
 * ## Vì sao hai đường sau mang `/*` còn `/login` thì không
 *
 * `matchesPublicRoute` so bằng `matchPath({ end: true })`. Đường lời mời và
 * đường đặt lại mật khẩu có thể mang đoạn đuôi (`/login/invitation/<…>`; link
 * mời thật chỉ mang `#token=` — `HOP-DONG-MOI.md:266`, và hash không vào
 * `matchPath`), và một mẫu trần **không** khớp dạng có đuôi — người bấm link
 * mời sẽ bị đá về `/login?next=…` thay vì thấy màn nhận lời mời. Đuôi `/*` khớp cả dạng có tham số lẫn dạng
 * trần, nên lời hứa ở trên đứng vững. `/login` thì cố ý để trần: nó là một màn
 * cụ thể, không phải một nhánh.
 *
 * **F-09a không phải làm gì thêm ở đây** — chỉ cần đặt route thật dưới đúng hai
 * tiền tố này. Đặt route công khai ở tiền tố KHÁC thì phải thêm một dòng vào
 * bảng, và thêm một ca vào `SessionBootstrap.test.tsx`.
 * Màn nhận lời mời: sau N10 thành công → `ROUTES.onboarding` (B-V1-42).
 */
export const PUBLIC_ROUTE_PATTERNS = [
  '/login',
  '/login/forgot',
  '/login/invitation/*',
  '/login/reset-password/*',
  /** Trang giới thiệu cuộn (landing): ai cũng xem được, không cần phiên. */
  '/welcome',
  /** Liên kết chia sẻ: người nhận không có tài khoản. */
  '/share/*',
] as const;

/**
 * Tám đường chỉ có trong bản dev, và cũng không cần phiên.
 *
 * Bảy khoá của `buildDevOnlyRoutes` (`router.tsx`) cộng màn duyệt bảy trạng
 * thái. Chúng là màn của lập trình viên, không đọc dữ liệu của ai, nên bắt
 * chúng chờ một lượt gia hạn không bao giờ tới (ví dụ `pnpm dev` không có máy
 * chủ sau lưng) là dựng một cái cổng chắn ngay lối đi hằng ngày.
 *
 * File này **không đọc `import.meta.env`** — `e2e/viewer3d.spec.ts` nhập nó
 * trong Node, nơi `import.meta.env` không tồn tại. Chỗ hỏi "có phải bản dev
 * không" là nơi gọi.
 */
export const DEV_PUBLIC_ROUTE_PATTERNS = [
  ROUTE_PATTERNS.demoGallery,
  ROUTE_PATTERNS.designSystem,
  ROUTE_PATTERNS.dataEntryDemo,
  ROUTE_PATTERNS.listReviewDemo,
  ROUTE_PATTERNS.shellDemo,
  ROUTE_PATTERNS.canvasOverlaysDemo,
  ROUTE_PATTERNS.feedbackDemo,
  ROUTE_PATTERNS.designSystemStates,
  ROUTE_PATTERNS.welcomeLab,
] as const;

/** Địa chỉ trang 3D riêng của Pascal; query cũ (vd `?tool=measure`) đi theo, `project` ghi đè. */
export function editor3dHref(projectId: string, search = ''): string {
  const query = new URLSearchParams(search);

  query.set('project', projectId);

  return `/editor3d.html?${query.toString()}`;
}
