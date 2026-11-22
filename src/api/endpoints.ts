const ADMIN_ML_ROOT = '/admin/ml';
const PROJECTS_ROOT = '/projects';
const PROJECT_SUMMARIES_ROOT = '/project-summaries';
const FLOORS_ROOT = '/floors';
const DRAWINGS_ROOT = '/drawings';
const FEATURE_FLAGS_ROOT = '/feature-flags';
const LIBRARY_ROOT = '/library';
const MEASUREMENTS_ROOT = '/measurements';
const AUTH_ROOT = '/auth';
const ME_ROOT = '/me';
const PROPERTY_TEMPLATES_ROOT = 'property-templates';
const USERS_ROOT = '/users';
const NOTIFICATIONS_ROOT = '/notifications';

/**
 * Where the API lives when the build does not say.
 *
 * `createHttpClient` resolves each path with `new URL(path, baseUrl)`, which
 * needs an absolute base — so a caller with no `VITE_API_BASE_URL` resolves this
 * against the page's own origin rather than passing `/api` through as-is. It
 * sits here because it is the same kind of thing as the paths below: API
 * routing, owned by `src/api`, not retyped at each call site (R-07, R-65).
 */
export const API_BASE_PATH = '/api';

/**
 * Ghép `path` vào `baseUrl` thành URL tuyệt đối cho `EventSource`.
 *
 * `new URL('/streams/x', 'http://host/api')` cho `http://host/streams/x` — mất `/api` —
 * nên đường gốc của `baseUrl` được nối tay: `path` có scheme thì giữ nguyên, đã mang sẵn
 * đường gốc thì không ghép lần nữa, còn lại nối sau đường gốc.
 *
 * **Có một bản sinh đôi ở `src/lib/auth/bootstrap.ts` (`resolveAuthUrl`), và đó là cố
 * ý — đừng gộp hai hàm lại.** `src/lib/auth/**` không được nhập `src/api` (CLAUDE.md
 * mục 0.4), nên tầng phiên phải mang bản của riêng nó.
 *
 * Hai bản phải cho **cùng một kết quả trên cùng một đầu vào**, và điều đó được khoá
 * lại bằng một bảng đầu vào dùng chung chạy qua cả hai hàm
 * (`src/api/__tests__/urlJoiners.test.ts`). Trước đây chúng lệch nhau ở ba chỗ —
 * nhận diện scheme (`^https?:` so với mọi scheme), và `?`/`#` bị setter `pathname`
 * của WHATWG URL mã hoá thành `%3F`/`%23` — nên bản này đã được đưa về đúng thuật
 * toán của bản kia. Sửa một bên thì sửa cả hai, rồi chạy bảng ấy.
 */
export function toApiUrl(baseUrl: string, path: string): string {
  if (/^[a-z][a-z0-9+.-]*:/i.test(path)) return path;

  const base = new URL(baseUrl);
  const root = base.pathname.replace(/\/+$/, '');
  const suffix = path.startsWith('/') ? path : `/${path}`;

  if (root === '' || suffix === root || suffix.startsWith(`${root}/`)) {
    return new URL(suffix, base.origin).toString();
  }

  return new URL(`${root}${suffix}`, base.origin).toString();
}

export const ENDPOINTS = {
  /** Trang xem công khai của liên kết chia sẻ (không cần phiên). */
  share: (token: string): string => `/share/${encodeURIComponent(token)}`,
  /**
   * N23–N27 — registry model của chuỗi xử lý (F-11). Mọi đường `require_admin`.
   *
   * `familyActive(family)`: họ đi trên đường chứ không trong thân, vì luật "chỉ họ
   * tường được gửi `null`" là luật theo họ (`schemas/adminMl.ts`).
   */
  adminMl: {
    /** N28–N37 (F-12): bộ dữ liệu và lượt huấn luyện. */
    datasetVersions: (datasetId: string): string => `${ADMIN_ML_ROOT}/datasets/${datasetId}/versions`,
    datasets: `${ADMIN_ML_ROOT}/datasets`,
    families: `${ADMIN_ML_ROOT}/model-families`,
    familyActive: (family: string): string => `${ADMIN_ML_ROOT}/model-families/${family}/active`,
    job: (jobId: string): string => `${ADMIN_ML_ROOT}/training-jobs/${jobId}`,
    jobCancel: (jobId: string): string => `${ADMIN_ML_ROOT}/training-jobs/${jobId}/cancel`,
    jobLogs: (jobId: string): string => `${ADMIN_ML_ROOT}/training-jobs/${jobId}/logs`,
    jobMetrics: (jobId: string): string => `${ADMIN_ML_ROOT}/training-jobs/${jobId}/metrics`,
    jobs: `${ADMIN_ML_ROOT}/training-jobs`,
    version: (modelVersionId: string): string => `${ADMIN_ML_ROOT}/model-versions/${modelVersionId}`,
    versions: `${ADMIN_ML_ROOT}/model-versions`,
  },
  /**
   * The credential exchange, and the only paths a signed-out visitor posts to.
   *
   * Flat strings rather than functions because none takes a parameter: the
   * address, password and one-time token travel in the body, never in the path.
   * There is deliberately no `register`: sign-up is closed in v1 (K7 = B).
   */
  auth: {
    invitationAccept: `${AUTH_ROOT}/invitations/accept`,
    /** N10b (UIFIX-B2) — xem trước lời mời; token trong thân. */
    invitationPreview: `${AUTH_ROOT}/invitations/preview`,
    login: `${AUTH_ROOT}/login`,
    passwordReset: `${AUTH_ROOT}/password-reset`,
    passwordResetConfirm: `${AUTH_ROOT}/password-reset/confirm`,
  },
  drawings: {
    chunk: (projectId: string, uploadId: string): string =>
      `${PROJECTS_ROOT}/${projectId}${DRAWINGS_ROOT}/uploads/${uploadId}/chunks`,
    complete: (projectId: string, uploadId: string): string =>
      `${PROJECTS_ROOT}/${projectId}${DRAWINGS_ROOT}/uploads/${uploadId}/complete`,
    initUpload: (projectId: string, floorId: string): string =>
      `${PROJECTS_ROOT}/${projectId}/floors/${floorId}${DRAWINGS_ROOT}/uploads`,
    /** N7 — lượt tải mới nhất của từng tầng; `cursor` là `nextCursor` của trang trước. */
    latestUploads: (projectId: string, cursor?: string): string =>
      `${PROJECTS_ROOT}/${projectId}${DRAWINGS_ROOT}/uploads/latest` +
      (cursor === undefined ? '' : `?cursor=${encodeURIComponent(cursor)}`),
    /** N41 (UX41 U05) — ảnh nhỏ từng trang của PDF; thân là byte PDF thô. */
    pageThumbnails: (projectId: string): string => `${PROJECTS_ROOT}/${projectId}${DRAWINGS_ROOT}/page-thumbnails`,
    /** N7b (UIFIX-B7) — nhật ký lượt xử lý; `limit`/`cursor` đi qua `query`. */
    pipelineRuns: (projectId: string): string => `${PROJECTS_ROOT}/${projectId}/pipeline-runs`,
    progress: (projectId: string, uploadId: string): string =>
      `${PROJECTS_ROOT}/${projectId}${DRAWINGS_ROOT}/uploads/${uploadId}/progress`,
  },
  featureFlags: {
    read: FEATURE_FLAGS_ROOT,
  },
  floors: {
    create: (projectId: string): string => `${PROJECTS_ROOT}/${projectId}/floors`,
    delete: (floorId: string): string => `${FLOORS_ROOT}/${floorId}`,
    list: (projectId: string): string => `${PROJECTS_ROOT}/${projectId}/floors`,
    reorder: `${FLOORS_ROOT}/reorder`,
  },
  /**
   * Thư viện model — D-01/D-02/D-03.
   *
   * Đường TOÀN CỤC, không lồng dưới `PROJECTS_ROOT` như `propertyTemplates`:
   * một chiếc ghế trong danh mục là cùng một chiếc ghế ở mọi dự án, và
   * `queryKeys.library.list()` (`src/lib/query/queryKeys.ts`) — khoá có sẵn từ
   * trước, đây là lượt đầu tiên có người tiêu thụ nó — cũng không nhận
   * `projectId`. Bộ lọc "Của tôi" đi theo phiên đăng nhập, không theo dự án, nên
   * nó là một trường trên từng mục (`LibraryItem.source`) chứ không phải một
   * đoạn đường dẫn.
   *
   * `list` là hằng phẳng vì nó không nhận tham số nào — cùng khuôn với
   * `floors.list` và `projects.list`; lọc theo chip và theo ô tìm xảy ra trên
   * danh sách đã tải, không phải bằng một lượt gọi khác (danh mục gần như tĩnh,
   * `CACHE_POLICY.branches.static`).
   */
  library: {
    detail: (libraryItemId: string): string => `${LIBRARY_ROOT}/${libraryItemId}`,
    list: LIBRARY_ROOT,
  },
  /** N47, N48 — AI chọn phong cách nội thất: đọc trạng thái (GET), chọn kiểu / quay về đề xuất (POST). */
  designConcept: (projectId: string): string => `${PROJECTS_ROOT}/${projectId}/design-concept`,
  /** N42–N44 — nướng ánh sáng: gửi GLB, đọc lượt mới nhất, tải một trong ba tệp kết quả. */
  lightingBakes: {
    file: (projectId: string, bakeId: string, fileName: string): string =>
      `${PROJECTS_ROOT}/${projectId}/lighting-bakes/${bakeId}/files/${fileName}`,
    availability: (projectId: string): string => `${PROJECTS_ROOT}/${projectId}/lighting-bakes/availability`,
    latest: (projectId: string): string => `${PROJECTS_ROOT}/${projectId}/lighting-bakes/latest`,
    start: (projectId: string): string => `${PROJECTS_ROOT}/${projectId}/lighting-bakes`,
  },
  /** N11–N14 — hồ sơ của người đang đăng nhập: đọc/sửa, đổi mật khẩu, thay ảnh đại diện. */
  me: {
    avatar: `${ME_ROOT}/avatar`,
    password: `${ME_ROOT}/password`,
    profile: ME_ROOT,
  },
  /** N3, N4 — thành viên của một dự án. `userId` đi trong đường dẫn của N4, `email` đi trong thân của N3. */
  members: {
    add: (projectId: string): string => `${PROJECTS_ROOT}/${projectId}/members`,
    remove: (projectId: string, userId: string): string => `${PROJECTS_ROOT}/${projectId}/members/${userId}`,
  },
  /**
   * Phép đo đã ghim của một dự án, lưu KÈM dự án làm hồ sơ — LG-3.
   *
   * Số đo là lớp phủ theo phiên của màn đo (`MeasurementTool`), tách khỏi
   * hình học: `remove` xoá đúng MỘT bản ghi theo `measurementId`, không đi
   * qua `spatial.layer` như tường/ô mở/phòng/nội thất — bốn đó SỬA hình
   * học của tầng, còn đây chỉ ghi/xoá một dòng hồ sơ không đụng mô hình.
   *
   * `list` và `create` dùng chung một đường, cùng khuôn `floors.list`/
   * `floors.create`: đọc và ghi cùng một tài nguyên gốc.
   */
  measurements: {
    create: (projectId: string): string => `${PROJECTS_ROOT}/${projectId}${MEASUREMENTS_ROOT}`,
    list: (projectId: string): string => `${PROJECTS_ROOT}/${projectId}${MEASUREMENTS_ROOT}`,
    remove: (projectId: string, measurementId: string): string =>
      `${PROJECTS_ROOT}/${projectId}${MEASUREMENTS_ROOT}/${measurementId}`,
  },
  /**
   * Hộp thư của người đang đăng nhập — T-09.
   *
   * Đường TOÀN CỤC, không lồng dưới `PROJECTS_ROOT`: một thông báo trỏ tới MỘT
   * dự án cụ thể (`projectId` trên thực thể), nhưng hộp thư của một người gộp
   * thông báo từ mọi dự án họ có mặt — cùng lý lẽ đã đặt `users` và `library`
   * ở cấp toàn cục thay vì lồng theo dự án.
   *
   * `list` là hằng phẳng, cùng khuôn `users.list`/`floors.list`: không tham
   * số, vì bộ lọc (`NotificationFilter`,
   * `screens/system/NotificationCenter/notificationModel.ts`) chạy trên danh
   * sách đã tải, không phải một lượt gọi khác cho mỗi lần đổi tab.
   *
   * `markRead` và `markAllRead` là HAI đường chứ không một đường nhận danh
   * sách rỗng để hiểu là "tất cả" — cùng lý lẽ đã tách `users.enable`/`disable`:
   * một request rỗng có chủ đích và một request rỗng do lỗi ở nơi gọi thì
   * nhật ký máy chủ phải phân biệt được.
   *
   * `acceptInvite` nhận `notificationId`, không `inviteId`: người NHẬN chỉ
   * cầm trong tay đúng một khoá — mục thông báo đang hiện trên màn — nên đó
   * là thứ duy nhất có sẵn ở nơi gọi. Đây là phép ghi mà
   * `notificationModel.ts` (docblock của `NotificationInlineAction.kind`) ghi
   * là Ô CHỜ: `users.invite`/`users.resendInvite` ở trên đều là hành động của
   * NGƯỜI QUẢN TRỊ gửi lời mời, không phải của người nhận chấp nhận nó.
   */
  notifications: {
    acceptInvite: (notificationId: string): string => `${NOTIFICATIONS_ROOT}/${notificationId}/accept-invite`,
    list: NOTIFICATIONS_ROOT,
    markAllRead: `${NOTIFICATIONS_ROOT}/read-all`,
    markRead: `${NOTIFICATIONS_ROOT}/read`,
  },
  projects: {
    create: PROJECTS_ROOT,
    delete: (projectId: string): string => `${PROJECTS_ROOT}/${projectId}`,
    /** Huỷ tạo — Hoàn tác của toast "Đã tạo": chỉ người tạo, trong cửa sổ ngắn (BE 409 `CREATE_UNDO_CLOSED` khi hết). */
    cancelCreate: (projectId: string): string => `${PROJECTS_ROOT}/${projectId}/creation`,
    list: PROJECTS_ROOT,
    read: (projectId: string): string => `${PROJECTS_ROOT}/${projectId}`,
    update: (projectId: string): string => `${PROJECTS_ROOT}/${projectId}`,
  },
  /** N5, N6 — cài đặt dự án: một đường, đọc bằng GET, thay trọn bằng PUT có `baseVersion`. */
  projectSettings: {
    read: (projectId: string): string => `${PROJECTS_ROOT}/${projectId}/settings`,
    replace: (projectId: string): string => `${PROJECTS_ROOT}/${projectId}/settings`,
  },
  /** N1 — thẻ dự án của dashboard; `cursor`, `limit` đi bằng query. */
  projectSummaries: {
    list: PROJECT_SUMMARIES_ROOT,
  },
  /**
   * Khuôn mẫu thuộc tính — bộ giá trị đặt tên, sao chép từ một tường/ô
   * mở/phòng/nội thất để áp lại cho đối tượng khác cùng loại (nút "khuôn" ở
   * đầu `PropertyInspector`) — lỗ hổng #4, U4.
   *
   * Thuộc VỀ DỰ ÁN, không phải người dùng — quyết định của điều phối viên: mọi
   * dữ liệu không gian khác trong repo đều khoá theo `projectId`/`floorId`, và
   * "thuộc về người dùng" đòi một trục dữ liệu mới (kho theo người dùng) mà
   * repo chưa có ở bất cứ đâu. Xem `PropertyTemplate.scope`
   * (`src/api/client.ts`) cho lý do đầy đủ và đường mở rộng sau này.
   */
  propertyTemplates: {
    create: (projectId: string): string => `${PROJECTS_ROOT}/${projectId}/${PROPERTY_TEMPLATES_ROOT}`,
    list: (projectId: string): string => `${PROJECTS_ROOT}/${projectId}/${PROPERTY_TEMPLATES_ROOT}`,
  },
  /**
   * Phép đo chất lượng của bản vẽ một tầng, và hai cách sửa nó — T-05.
   *
   * Cả ba đều nhận `(projectId, floorId)` chứ không `uploadId`: cái màn hỏi là
   * "bản vẽ đang dùng của tầng này tốt tới đâu", một câu hỏi sống lâu hơn lượt
   * tải lên đã sinh ra nó. Khoá cache `queryKeys.quality.assessment(floorId)`
   * theo đúng cách đọc đó.
   *
   * `straighten` và `corners` là hai lối sửa cho hai phát hiện khác nhau — ảnh
   * nghiêng thì máy nắn được, khung bản vẽ không tìm ra thì phải người chỉ. Cả
   * hai trả về chính phép đo đã chạy lại, nên nơi gọi có ngay kết quả mới thay
   * vì phải đọc lại một lượt nữa.
   */
  quality: {
    assess: (projectId: string, floorId: string): string =>
      `${PROJECTS_ROOT}/${projectId}/floors/${floorId}/quality`,
    corners: (projectId: string, floorId: string): string =>
      `${PROJECTS_ROOT}/${projectId}/floors/${floorId}/quality/corners`,
    straighten: (projectId: string, floorId: string): string =>
      `${PROJECTS_ROOT}/${projectId}/floors/${floorId}/quality/straighten`,
    /** Lô 2b: số kích thước máy đọc được trên trang (màn Hiệu chỉnh tỷ lệ). */
    dimensionStrings: (projectId: string, floorId: string): string =>
      `${PROJECTS_ROOT}/${projectId}/floors/${floorId}/dimension-strings`,
    /** Lô 2b: bề dày tường, điểm bắt, cửa, phòng lớn nhất, hộp bao căn — px trang. */
    detectedGeometry: (projectId: string, floorId: string): string =>
      `${PROJECTS_ROOT}/${projectId}/floors/${floorId}/detected-geometry`,
  },
  /** N21 đọc, N22 thay trọn `overrides` (`PUT {baseVersion, body}`) — cấu hình bộ luật của dự án. */
  ruleConfig: {
    read: (projectId: string): string => `${PROJECTS_ROOT}/${projectId}/rule-config`,
    replace: (projectId: string): string => `${PROJECTS_ROOT}/${projectId}/rule-config`,
  },
  spatial: {
    floor: (projectId: string, floorId: string): string =>
      `${PROJECTS_ROOT}/${projectId}/floors/${floorId}/spatial`,
    /** N15 — đồ thị cả dự án cộng `floorRevisions` (B3-02). */
    graph: (projectId: string): string => `${PROJECTS_ROOT}/${projectId}/spatial`,
    /** Xuất mô hình có kiểm quyền `model.export` (viewer 403) — trả cùng dạng N15. */
    exports: (projectId: string): string => `${PROJECTS_ROOT}/${projectId}/exports`,
    /**
     * Lớp không gian của một tầng: tường, ô mở, phòng, nội thất — lỗ hổng #4,
     * U4. `spatial.floor` ở trên chỉ mang siêu dữ liệu tầng (`Floor`, không có
     * chỗ cho bốn thứ này — xem `FloorWriteBody`, `src/api/client.ts`), nên đây
     * là đường RIÊNG, cùng khuôn "một path dùng chung cho đọc lẫn ghi" mà
     * `spatial.floor` đã đặt.
     */
    layer: (projectId: string, floorId: string): string =>
      `${PROJECTS_ROOT}/${projectId}/floors/${floorId}/spatial/layer`,
    version: (projectId: string, versionId: string): string =>
      `${PROJECTS_ROOT}/${projectId}/versions/${versionId}`,
  },
  /**
   * Hai luồng SSE của BE (S1 tiến độ tải lên, S2 thông báo) — B4-01.
   *
   * Đứng riêng, không lồng dưới `notifications` hay `drawings`: đường thật nằm dưới
   * `/streams`, và một nhóm chung cho cả hai luồng khớp hợp đồng hơn. Là đường TƯƠNG ĐỐI
   * (không ghép `API_BASE_PATH`); `EventSource` không đi qua `createHttpClient`, nên nơi
   * gọi ghép bằng `toApiUrl(resolveApiBaseUrl(), ...)`.
   */
  streams: {
    notifications: (): string => '/streams/notifications',
    uploadProgress: (projectId: string, uploadId: string): string =>
      `/streams/projects/${projectId}/uploads/${uploadId}/progress`,
  },
  /**
   * Đường dẫn ĐÃ GHÉP với `API_BASE_PATH`, khác khuôn tương đối của mọi mục
   * khác trong `ENDPOINTS` — có chủ ý, không phải sơ suất.
   *
   * `createBeaconTransport` (`src/lib/telemetry/sender.ts`) gọi thẳng
   * `navigator.sendBeacon(url, ...)`, không đi qua `createHttpClient` — nên
   * không có bước nào tự ghép `API_BASE_PATH` vào một đường dẫn tương đối như
   * `new URL(path, baseUrl)` làm cho các mục khác. Nếu để `telemetry` là chuỗi
   * tương đối theo khuôn chung, bốn nơi gọi vẫn phải tự nhớ ghép — đúng cái lỗi
   * N1 đang dọn. Xuất sẵn đường dẫn đầy đủ ở đây thay vì lặp lại phép ghép ở cả
   * bốn màn.
   */
  telemetry: `${API_BASE_PATH}/telemetry`,
  /**
   * Quản trị người dùng — T-05.
   *
   * Đường TOÀN CỤC, không lồng dưới `PROJECTS_ROOT`: câu hỏi màn quản trị đặt ra
   * là "ai có mặt trong hệ thống này", một câu hỏi sống bên ngoài mọi dự án.
   * `memberships(userId)` chính là chiều ngược lại — người này có mặt ở những dự
   * án nào — nên nó treo dưới người dùng chứ không dưới dự án; treo ngược lại
   * thì phải quét mọi dự án mới trả lời được một câu hỏi về một người.
   *
   * `list` là hằng phẳng vì nó không nhận tham số nào, cùng khuôn với
   * `floors.list`, `projects.list` và `library.list`: lọc theo vai và ô tìm xảy
   * ra trên danh sách đã tải (bảng người dùng đổi theo tuần —
   * `CACHE_POLICY.branches.static`, `src/lib/query/cachePolicy.ts`), không phải
   * bằng một lượt gọi khác cho mỗi lần bấm chip.
   *
   * `enable` và `disable` là HAI đường chứ không một đường nhận cờ. Bật lại và
   * vô hiệu là hai ý định khác nhau, và một đường `PATCH .../status` nhận
   * `{ enabled: boolean }` thì nhật ký máy chủ không phân biệt được chúng —
   * `remove` mới là đường không hoàn tác được, nên nó phải đứng riêng hẳn và có
   * hộp thoại của A9 chắn trước.
   *
   * `invite` gửi tới một tài nguyên "lời mời" chứ không tới `USERS_ROOT`: một
   * lời mời chưa nhận CHƯA phải một người dùng, và `resendInvite(userId)` trỏ tới
   * `invitations/{user_id}/resend` — BE nhận id người được mời, tức `AdminUser.id`.
   */
  users: {
    activity: (userId: string): string => `${USERS_ROOT}/${userId}/activity`,
    changeRole: (userId: string): string => `${USERS_ROOT}/${userId}/role`,
    disable: (userId: string): string => `${USERS_ROOT}/${userId}/disable`,
    enable: (userId: string): string => `${USERS_ROOT}/${userId}/enable`,
    invite: `${USERS_ROOT}/invitations`,
    list: USERS_ROOT,
    memberships: (userId: string): string => `${USERS_ROOT}/${userId}/memberships`,
    remove: (userId: string): string => `${USERS_ROOT}/${userId}`,
    resendInvite: (userId: string): string => `${USERS_ROOT}/invitations/${userId}/resend`,
  },
  /** N17–N20 — phiên bản theo tầng (B3-04). Tầng đi bằng `query` (`floorId`), không ghép vào chuỗi. */
  versions: {
    label: (projectId: string, versionId: string): string =>
      `${PROJECTS_ROOT}/${projectId}/versions/${versionId}/label`,
    list: (projectId: string): string => `${PROJECTS_ROOT}/${projectId}/versions`,
    restore: (projectId: string, versionId: string): string =>
      `${PROJECTS_ROOT}/${projectId}/versions/${versionId}/restore`,
    snapshot: (projectId: string, versionId: string): string =>
      `${PROJECTS_ROOT}/${projectId}/versions/${versionId}/snapshot`,
  },
} as const;
