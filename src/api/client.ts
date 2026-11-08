import type { AppError } from '@/lib/errors';
import type { HttpClient, HttpError, HttpRequestOptions, Result } from '@/lib/http';
import { z, type ZodTypeAny } from 'zod';
import type { Furniture, Opening, Roof, Room, Wall } from '@/domain/spatial/types';
import {
  FloorSchema,
  ImageQualityAssessmentSchema,
  LibraryItemSchema,
  ProgressSchema,
  ProjectSchema,
  VersionSchema,
  toFloorWirePayload,
  toProjectWirePayload,
  type DrawingCornersInput,
  type Floor,
  type FloorElevationMm,
  type FloorHeightMm,
  type FloorName,
  type FloorOrder,
  type FloorPayload,
  type ImageQualityAssessment,
  type LibraryItem,
  type Progress,
  type Project,
  type ProjectPayload,
  type Version,
} from './contracts';
import { ENDPOINTS } from './endpoints';
import {
  DetectedGeometrySchema,
  DimensionStringsSchema,
  type DetectedGeometry,
  type DimensionStrings,
} from './schemas/quality';
import {
  InvitationPreviewSchema,
  type AcceptInvitation,
  type InvitationPreview,
  type InvitationPreviewRequest,
  type PasswordResetConfirm,
  type PasswordResetRequest,
} from './schemas/auth';
import {
  DesignConceptSchema,
  DesignConceptStateSchema,
  type DesignConcept,
  type DesignConceptState,
  type DesignStyleId,
} from './schemas/designConcept';
import { LightingBakeSchema, type LightingBake, type LightingBakeFileName } from './schemas/lightingBake';
import { ModelExportSchema, type ModelExport, type ModelExportFileName } from './schemas/modelExport';
import { PipelineRunSchema, type PipelineRun } from './schemas/pipelineRuns';
import { UserSchema, type SignInInput, type User as ApiUser } from './schemas';
import {
  FloorLayerDocumentSchema,
  FloorLayerWriteResultSchema,
  type FloorLayerDocument,
  type FloorLayerWriteBody,
  type FloorLayerWriteResult,
} from './schemas/spatialLayer';
import {
  NotificationSchema,
  type MarkNotificationsReadInput,
  type Notification,
} from './schemas/notifications';
import {
  AdminUserListSchema,
  AdminUserSchema,
  UserActivitySchema,
  UserMembershipSchema,
  type AdminUser,
  type AdminUserList,
  type InviteUsersInput,
  type RemoveUserInput,
  type RoleChangeInput,
  type UserActivity,
  type UserMembership,
} from './schemas/users';
import { decode, safeParseList } from './schemas/decode';
import { CursorEnvelopeSchema } from './schemas/common';
import {
  ProjectSettingsSchema,
  type ProjectSettings,
  type ProjectSettingsBody,
} from './schemas/projectSettings';
import { ProjectSummarySchema, type ProjectSummary } from './schemas/projectSummaries';
import { ProjectRuleConfigSchema, type ProjectRuleConfig, type UpdateRuleConfig } from './schemas/ruleConfig';
import { MeSchema, type ChangePassword, type Me, type UpdateMe, type UploadAvatar } from './schemas/me';
import { LatestFloorUploadSchema, PageThumbnailsSchema, type LatestFloorUpload } from './schemas/uploads';
import {
  type FloorVersionPageSchema,
  FloorVersionSnapshotSchema,
  FloorVersionSummarySchema,
  type FloorVersionSnapshot,
  type FloorVersionSummary,
} from './schemas/versions';
import { SpatialGraphDocumentSchema, type SpatialGraphDocument } from './schemas/spatialGraph';
import { SuggestionRulesetSchema, type SuggestionRuleset } from './schemas/suggestionRules';
import { ShareLinkWireSchema } from '@/lib/export/shareLink';

export type {
  Drawing,
  DrawingCornersInput,
  DrawingFrame,
  Floor,
  FloorImageQuality,
  ImageQualityAssessment,
  ImageQualityFinding,
  ImageQualityMeasurement,
  LibraryFilterId,
  LibraryGroup,
  LibraryItem,
  LibrarySource,
  Progress,
  Project,
  QualityPoint,
  QualityRegion,
  User,
  Version,
} from './contracts';
export type { SignInInput } from './schemas';
export type { LatestFloorUpload } from './schemas/uploads';
export type {
  MarkNotificationsReadInput,
  Notification,
  NotificationKind,
  NotificationWire,
} from './schemas/notifications';
export type {
  AdminUser,
  AdminUserList,
  AdminUserStatus,
  AdminUserWire,
  InviteUsersInput,
  RemoveUserInput,
  RoleChangeInput,
  UserActivity,
  UserActivityWire,
  UserMembership,
  UserMembershipWire,
} from './schemas/users';

export type ApiError = HttpError | AppError;
export type ApiResult<T> = Result<T, ApiError>;

export interface RequestOptions {
  signal?: AbortSignal;
}

export interface WriteRequestOptions extends RequestOptions {
  idempotencyKey?: string;
  /** R3 (BE-00 §7): lượt ghi này an toàn khi gửi lại. Nơi gọi bật, không phải tầng này. */
  idempotent?: boolean;
  /** 429 trả về ngay, không tự thử lại — lượt ghi do người dùng bấm (BUG-510). Mặc định tắt. */
  failFastOnRateLimit?: boolean;
  /**
   * Ngân sách thời gian của lượt gửi.
   *
   * Hẹp hơn `HttpTimeoutMode` một nhánh: `'stream'` dành cho SSE, thứ không đi
   * qua một lượt ghi của `ApiClient`. Union hẹp gán vào trường rộng vẫn hợp lệ.
   */
  timeoutMode?: 'default' | 'file';
}

export interface ProjectWriteBody extends Omit<ProjectPayload, 'name'> {
  name: string;
}

export interface CreateProjectInput extends WriteRequestOptions {
  body: ProjectWriteBody;
}

export interface UpdateProjectInput extends WriteRequestOptions {
  body: Partial<ProjectWriteBody>;
  projectId: string;
}

export interface DeleteProjectInput extends WriteRequestOptions {
  projectId: string;
}

export interface ReadProjectInput extends RequestOptions {
  projectId: string;
}

export interface SignInApiInput extends WriteRequestOptions {
  body: SignInInput;
}

export interface AcceptInvitationApiInput extends WriteRequestOptions {
  body: AcceptInvitation;
}

/** N10b (UIFIX-B2) — chỉ đọc, không tiêu token. */
export interface PreviewInvitationApiInput extends WriteRequestOptions {
  body: InvitationPreviewRequest;
}

export interface ConfirmPasswordResetApiInput extends WriteRequestOptions {
  body: PasswordResetConfirm;
}

export interface RequestPasswordResetApiInput extends WriteRequestOptions {
  body: PasswordResetRequest;
}

export interface FloorWriteBody extends Omit<FloorPayload, 'elevationMm' | 'heightMm' | 'name' | 'order'> {
  elevationMm: FloorElevationMm;
  heightMm: FloorHeightMm;
  name: FloorName;
  order: FloorOrder;
}

export interface FloorCreateBody extends FloorWriteBody {
  id: string;
}

export interface CreateFloorInput extends WriteRequestOptions {
  body: FloorCreateBody;
  projectId: string;
}

export interface ListFloorsInput extends RequestOptions {
  projectId: string;
}

export interface ReorderFloorsInput extends WriteRequestOptions {
  body: {
    floorIds: string[];
  };
}

export interface DeleteFloorInput extends WriteRequestOptions {
  floorId: string;
}

/**
 * Vùng cắt của một tầng trên tờ nhiều tầng: tỉ lệ của CẢ trang (ảnh như trình
 * duyệt hiển thị; PDF là trang đã chọn), gốc trên-trái. Mỗi số trong [0,1],
 * `xRatio + widthRatio ≤ 1`, `yRatio + heightRatio ≤ 1`, diện tích ≥ 0,01.
 */
export interface DrawingCrop {
  readonly xRatio: number;
  readonly yRatio: number;
  readonly widthRatio: number;
  readonly heightRatio: number;
}

export interface InitDrawingUploadInput extends WriteRequestOptions {
  body: {
    /** Vắng = dựng cả trang. */
    crop?: DrawingCrop;
    fileName: string;
    floorId: string;
    mimeType: string;
    pageIndex?: number;
    projectId: string;
    sizeBytes: number;
  };
}

export interface SendDrawingChunkInput extends WriteRequestOptions {
  body: {
    chunk: string;
    chunkIndex: number;
  };
  projectId: string;
  uploadId: string;
}

export interface CompleteDrawingUploadInput extends WriteRequestOptions {
  body: {
    uploadId: string;
  };
  projectId: string;
}

export interface ReadDrawingProgressInput extends RequestOptions {
  projectId: string;
  uploadId: string;
}

export interface ReadPageThumbnailsInput extends RequestOptions {
  /** Byte PDF thô (≤ 8 MiB, trần thân của BE). */
  file: Blob;
  projectId: string;
}

export interface ListLatestUploadsInput extends RequestOptions {
  projectId: string;
}

/** N7b (UIFIX-B7) — `limit` 1..200 (BE mặc định 50), `cursor` = `nextCursor` của trang trước. */
export interface ListPipelineRunsInput extends RequestOptions {
  cursor?: string;
  limit?: number;
  projectId: string;
}

/** Một trang nhật ký lượt xử lý. `droppedCount` = mục hỏng bị bỏ (A11). */
export interface PipelineRunList {
  droppedCount: number;
  items: PipelineRun[];
  nextCursor?: string;
}

export interface ReadSpatialFloorInput extends RequestOptions {
  floorId: string;
  projectId: string;
}

export interface PatchSpatialFloorInput extends WriteRequestOptions {
  body: Partial<FloorWriteBody>;
  floorId: string;
  projectId: string;
}

/**
 * The spatial layer of one floor: walls, openings, rooms, furniture — U4 gap #4.
 *
 * `Floor`/`FloorWriteBody` above only ever carried the floor's own metadata
 * (area, drawings, elevation, height, name, order); nothing in this file gave
 * a shape to the four entity lists a floor actually holds, so autosave had
 * nowhere to send them (`PERSIST_PROPERTIES_UNSUPPORTED_REASON`,
 * `screens/viewer/PropertyInspector/propertyInspectorGateway.ts`). Fields are
 * `readonly Wall[]` etc. straight from `@/domain/spatial/types`. A write always
 * sends the floor's complete four lists — this is the autosave flush of
 * "everything on this floor right now", not a per-field patch, so there is no
 * `Partial<SpatialLayer>` counterpart the way `PatchSpatialFloorInput` has one
 * for `Floor`.
 *
 * **Đính chính 2026-09-14.** Chỗ này từng viết rằng KHÔNG nên có wire schema,
 * vì "hình dạng miền đã phẳng và an toàn với JSON, nên một bản sao thứ hai của
 * cùng danh sách trường chỉ tạo thêm một chỗ để hai bên trôi ra xa nhau". Lập
 * luận ấy đúng về kiểu và sai về thời điểm: `readonly Wall[]` là lời hứa của
 * trình biên dịch về dữ liệu do ba mô hình AI sinh ra lúc chạy. `SpatialLayerSchema`
 * (`./schemas/spatial.ts`) nay giải mã lượt trả về, và nó tránh được đúng nỗi
 * lo trên bằng cách khai kiểu trả về là chính interface của miền — lệch một
 * trường là `pnpm typecheck` đỏ, không phải một lỗi lúc chạy.
 */
export interface SpatialLayer {
  furniture: readonly Furniture[];
  openings: readonly Opening[];
  rooms: readonly Room[];
  walls: readonly Wall[];
  /** Mái của tầng; vắng = không có mái (roof-contract.md). */
  roofs?: readonly Roof[];
}

export interface ReadSpatialGraphInput extends RequestOptions {
  projectId: string;
}

export interface ReadSpatialLayerInput extends RequestOptions {
  floorId: string;
  projectId: string;
}

export interface WriteSpatialLayerInput extends WriteRequestOptions {
  /**
   * `revision` của lượt đọc mà lớp này dựa trên (`readLayer`). BE #35 là một
   * `PUT` có version: thiếu nó là 428, cũ là 409 — không có lượt ghi "mù".
   */
  baseVersion: number;
  /** `{ layer?, scaleMillimetresPerPixel? }` — gửi nguyên; có cả hai thì `layer` hiểu ở tỉ lệ cũ (#35). */
  body: FloorLayerWriteBody;
  floorId: string;
  projectId: string;
}

export interface ReadSpatialVersionInput extends RequestOptions {
  projectId: string;
  versionId: string;
}

/** N17 — một trang lịch sử phiên bản của một tầng, `sequence` giảm dần. */
export type FloorVersionPage = z.infer<typeof FloorVersionPageSchema>;

export interface ReadImageQualityInput extends RequestOptions {
  floorId: string;
  projectId: string;
}

export interface StraightenDrawingInput extends WriteRequestOptions {
  floorId: string;
  projectId: string;
}

export interface SetDrawingCornersInput extends WriteRequestOptions {
  body: DrawingCornersInput;
  floorId: string;
  projectId: string;
}

/**
 * Thư viện model — D-01/D-02/D-03.
 *
 * `list` không nhận tham số nào ngoài `signal`: danh mục là toàn cục và gần như
 * tĩnh (`CACHE_POLICY.branches.static`, `src/lib/query/cachePolicy.ts`), nên màn
 * tải một lần rồi lọc tại chỗ bằng `matchesLibraryFilter` — không có tham số
 * lọc nào đi trên dây, và cũng không nên có: mười chip đổi qua lại là chuyện
 * tức thì, một lượt gọi mạng cho mỗi lần bấm chip thì không.
 *
 * `read` tồn tại riêng vì `queryKeys.library.detail(libraryItemId)` tồn tại và
 * vì D-03 cần NẠP TRƯỚC một mục khi con trỏ chạm thẻ — cái nạp trước ấy phải
 * đọc được đúng một mục, không phải cả danh mục lần nữa.
 */
export interface ReadLibraryItemInput extends RequestOptions {
  libraryItemId: string;
}

/**
 * Quản trị người dùng — T-04/T-05.
 *
 * `list` không nhận tham số nào ngoài `signal`, cùng lý lẽ với `LibraryApi.list`
 * ngay trên: bảng người dùng đổi theo tuần (`CACHE_POLICY.branches.static`), nên
 * màn tải một lượt rồi lọc theo vai và theo ô tìm tại chỗ. Nó trả về
 * `AdminUserList` — danh sách CỘNG `total` — chứ không một mảng trần, vì màn
 * phải nói được "đang hiện 20 trên 137" mà không tải cả 137 dòng về đếm.
 *
 * `enable` và `disable` nhận cùng một hình dạng đầu vào nhưng là hai phương
 * thức: xem `ENDPOINTS.users` cho lý do chúng không gộp thành một cờ.
 */
export interface ReadUserActivityInput extends RequestOptions {
  userId: string;
}

export interface ReadUserMembershipsInput extends RequestOptions {
  userId: string;
}

export interface InviteUsersApiInput extends WriteRequestOptions {
  body: InviteUsersInput;
}

export interface ChangeUserRoleInput extends WriteRequestOptions {
  body: RoleChangeInput;
}

export interface SetUserEnabledInput extends WriteRequestOptions {
  userId: string;
}

export interface ResendInviteInput extends WriteRequestOptions {
  userId: string;
}

/**
 * Xoá hẳn một người.
 *
 * Thân mang `confirmEmail` — địa chỉ người duyệt vừa gõ lại. Nó đi trên dây chứ
 * không dừng ở state của màn vì A9 nói hành động A8 không hoàn tác được thì
 * phải hỏi trước, và một xác nhận chỉ tồn tại trong màn thì nơi gọi thứ hai bỏ
 * qua được nó. Trả về chính bản ghi vừa xoá, cùng khuôn `projects.delete` và
 * `floors.delete`: nơi gọi có ngay dữ liệu để dựng toast mà không phải giữ lại
 * một bản chép trước đó.
 */
export interface RemoveUserApiInput extends WriteRequestOptions {
  body: RemoveUserInput;
}

/**
 * Property templates — U4 gap #5.
 *
 * A template is a named, reusable set of property values for ONE object
 * kind, copied from an object a user is inspecting so it can be re-applied to
 * another object of the same kind later (the "khuôn" button at the top of
 * `PropertyInspector`, `onCopyAsTemplate` /
 * `COPY_AS_TEMPLATE_UNSUPPORTED_REASON` in
 * `screens/viewer/PropertyInspector/propertyInspectorGateway.ts`). Before this
 * file, no layer of the app — domain, store, lib, api — had this concept at
 * all; there was nothing to read or write.
 *
 * `fields` is keyed by object kind and only lists the properties worth
 * presetting: geometry that is measured off the drawing (a wall's `length`,
 * a room's `area`, an opening's `hostWallId` relation) is derived, not a
 * value a template author chose, so it has no place here even though the
 * panel shows it. What is left is exactly the "preset-able" subset of each
 * kind's five default fields in `propertyInspectorTypes.ts`
 * (`DEFAULT_WALL_FIELD_IDS` etc.): a wall's thickness/height/kind, an
 * opening's width/height/sill height/swing, a room's usage (not its name —
 * every room needs its own), and a furniture item's kind/rotation (not its
 * bounding box, which is tied to a specific placement).
 */
export type PropertyTemplateObjectKind = 'furniture' | 'opening' | 'room' | 'wall';

export interface PropertyTemplateFieldsByKind {
  furniture: {
    kind?: Furniture['kind'];
    rotationDeg?: Furniture['rotationDeg'];
  };
  opening: {
    heightMm?: Opening['heightMm'];
    sillHeightMm?: Opening['sillHeightMm'];
    swing?: Opening['swing'];
    widthMm?: Opening['widthMm'];
  };
  room: {
    usage?: Room['usage'];
  };
  wall: {
    heightMm?: Wall['heightMm'];
    kind?: Wall['kind'];
    thicknessMm?: Wall['thicknessMm'];
  };
}

/**
 * `scope` is a decision recorded in data, not an assumption baked into the
 * shape: a template belongs to the PROJECT it was created in (coordinator
 * ruling for U4) — every other piece of spatial data in this codebase is
 * keyed by `projectId`/`floorId`, and "belongs to the user" would need a
 * per-user store this repo has nowhere else. The counter-argument is real
 * too — in an architecture tool, a standard kit (220mm load-bearing walls,
 * 12mm glazing) is often a firm-wide asset, not a per-project one — so this
 * field exists precisely to make that a new *value* here later
 * (`'user' | 'organization'`), not a data migration. Only `'project'` is
 * accepted today.
 */
export type PropertyTemplateScope = 'project';

export interface PropertyTemplate<
  TKind extends PropertyTemplateObjectKind = PropertyTemplateObjectKind,
> {
  createdAt: string;
  fields: PropertyTemplateFieldsByKind[TKind];
  id: string;
  name: string;
  objectKind: TKind;
  projectId: string;
  scope: PropertyTemplateScope;
}

export type PropertyTemplateDraft = {
  [TKind in PropertyTemplateObjectKind]: {
    fields: PropertyTemplateFieldsByKind[TKind];
    name: string;
    objectKind: TKind;
  };
}[PropertyTemplateObjectKind];

export interface CreatePropertyTemplateInput extends WriteRequestOptions {
  body: PropertyTemplateDraft;
  projectId: string;
}

export interface ListPropertyTemplatesInput extends RequestOptions {
  projectId: string;
}

export interface ProjectsApi {
  create(input: CreateProjectInput): Promise<ApiResult<Project>>;
  delete(input: DeleteProjectInput): Promise<ApiResult<Project>>;
  /** Người tạo huỷ dự án vừa tạo (không cần vai admin); 409 `CREATE_UNDO_CLOSED` khi hết cửa sổ. */
  cancelCreate(input: DeleteProjectInput): Promise<ApiResult<Project>>;
  list(options?: RequestOptions): Promise<ApiResult<Project[]>>;
  read(input: ReadProjectInput): Promise<ApiResult<Project>>;
  update(input: UpdateProjectInput): Promise<ApiResult<Project>>;
}

/**
 * Which heavy features are on for the person holding this session.
 *
 * The one read in this file that is deliberately **not** decoded with a schema.
 * Every other endpoint models a resource where a field of the wrong type means
 * the answer is unusable; a flag payload is a bag of independent switches, and
 * `decode` would turn one unknown flag — a sixth flag rolled out by a newer
 * server — into zero flags for a client that understood the other five.
 *
 * So the body travels as `unknown` to `parseFeatureFlagPayload` in
 * `src/lib/telemetry/flags.ts`, which drops bad entries one at a time and
 * leaves each surviving flag on the table's default. The `Result` envelope is
 * understood there too, so a failed request can be handed over as-is.
 */
export interface FeatureFlagsApi {
  read(options?: RequestOptions): Promise<ApiResult<unknown>>;
}

/**
 * M2 — `GET /suggestion-rules`. **Endpoint chưa có ở AppBack** (08/11/2026): 404 → `null` ("không có bảng"),
 * nơi gọi lùi về bảng gói kèm; app không bao giờ hỏng vì thiếu nó.
 */
export interface SuggestionRulesApi {
  read(options?: RequestOptions): Promise<ApiResult<SuggestionRuleset | null>>;
}

export interface FloorsApi {
  create(input: CreateFloorInput): Promise<ApiResult<Floor>>;
  delete(input: DeleteFloorInput): Promise<ApiResult<Floor>>;
  list(input: ListFloorsInput): Promise<ApiResult<Floor[]>>;
  reorder(input: ReorderFloorsInput): Promise<ApiResult<Floor[]>>;
}

export interface DrawingsApi {
  complete(input: CompleteDrawingUploadInput): Promise<ApiResult<Progress>>;
  initUpload(input: InitDrawingUploadInput): Promise<ApiResult<Progress>>;
  /**
   * N7 — lượt tải mới nhất của từng tầng, theo `Floor.order`, đã đọc HẾT các
   * trang. Đây là nguồn của danh sách màn xử lý theo dõi (B-V4-01): nó biết cả
   * tầng có bản vẽ từ trước, và mọi lối vào `/pipeline` đều đọc được nó.
   */
  latestUploads(input: ListLatestUploadsInput): Promise<ApiResult<LatestFloorUpload[]>>;
  /** N7b — một trang nhật ký lượt xử lý, mới nhất trước. */
  listPipelineRuns(input: ListPipelineRunsInput): Promise<ApiResult<PipelineRunList>>;
  /** N41 (UX41 U05) — ảnh nhỏ từng trang của một PDF chưa tải lên; `data:` URL theo thứ tự trang. */
  pageThumbnails(input: ReadPageThumbnailsInput): Promise<ApiResult<string[]>>;
  progress(input: ReadDrawingProgressInput): Promise<ApiResult<Progress>>;
  sendChunk(input: SendDrawingChunkInput): Promise<ApiResult<Progress>>;
}

/**
 * How good the drawing behind one floor is, and the two ways to improve it.
 *
 * Shaped like `DrawingsApi` — every method decodes through a schema, every
 * write takes an idempotency key — with one difference worth naming: both
 * writes return the freshly re-run `ImageQualityAssessment` rather than a
 * `Progress`. Straightening and re-cropping finish in one round trip on the
 * server, so there is no job to poll; handing the new reading straight back
 * lets the caller seed `queryKeys.quality.assessment(floorId)` instead of
 * invalidating and waiting for a second request to answer the same question.
 *
 * Nothing here classifies anything. The three levels a measurement falls into
 * are decided by `src/domain/quality`, from the raw numbers this group carries
 * — a wire payload that already said "poor" would be a second opinion nobody
 * could check against the thresholds.
 */
export interface QualityApi {
  assess(input: ReadImageQualityInput): Promise<ApiResult<ImageQualityAssessment>>;
  setCorners(input: SetDrawingCornersInput): Promise<ApiResult<ImageQualityAssessment>>;
  straighten(input: StraightenDrawingInput): Promise<ApiResult<ImageQualityAssessment>>;
  /** Lô 2b — tuỳ chọn (client giả cũ không có); máy chủ cũ trả 404/501, nơi gọi tự lùi về hành vi cũ. */
  dimensionStrings?(input: ReadImageQualityInput): Promise<ApiResult<DimensionStrings>>;
  detectedGeometry?(input: ReadImageQualityInput): Promise<ApiResult<DetectedGeometry>>;
}

export interface SpatialApi {
  patchFloor(input: PatchSpatialFloorInput): Promise<ApiResult<Floor>>;
  readFloor(input: ReadSpatialFloorInput): Promise<ApiResult<Floor>>;
  readVersion(input: ReadSpatialVersionInput): Promise<ApiResult<Version>>;
  /** N15 — the whole project graph plus one `revision` per floor. */
  readGraph(input: ReadSpatialGraphInput): Promise<ApiResult<SpatialGraphDocument>>;
  /** `POST /projects/{id}/exports` — cùng dạng N15 nhưng máy chủ kiểm `model.export` (viewer 403). */
  exportGraph(input: ReadSpatialGraphInput): Promise<ApiResult<SpatialGraphDocument>>;
  /** N16 — the floor's layer document: `revision`, `level`, four lists, axes, dimensions. */
  readLayer(input: ReadSpatialLayerInput): Promise<ApiResult<FloorLayerDocument>>;
  /**
   * #35 — saves the floor's whole spatial layer against `baseVersion` and hands
   * the persisted copy back with its new `revision` (`PUT`, B-G-07).
   */
  writeLayer(input: WriteSpatialLayerInput): Promise<ApiResult<FloorLayerWriteResult>>;
}

/**
 * Danh mục model dựng sẵn cộng model người dùng tự tải lên — D-01/D-02/D-03.
 *
 * Chỉ đọc. Đường tải model lên là việc của một tầng khác chưa dựng, nên nhóm
 * này KHÔNG có `create`/`delete` — thêm chúng ở đây khi chưa có ai gọi thì đúng
 * là thứ R-69 cấm. Hệ quả có thật: `src/lib/query/invalidation.ts` không cần một
 * mục `library` nào, vì không thao tác ghi nào làm danh mục cũ đi.
 *
 * Cả hai lượt đọc đều giải mã qua `LibraryItemSchema` — khác `propertyTemplates`
 * và `spatial.writeLayer`, hai nhóm đi thẳng không schema vì hình dạng của chúng
 * phụ thuộc `objectKind` hoặc phản chiếu bốn thực thể miền. Một mục thư viện thì
 * phẳng và cố định, nên nó được kiểm như `Project` và `Floor`: `list` dùng
 * `safeParseList`, nên một mục hỏng bị bỏ qua và ghi cảnh báo thay vì làm rỗng
 * cả panel — đúng thứ A11 tồn tại để chặn.
 */
export interface LibraryApi {
  list(options?: RequestOptions): Promise<ApiResult<LibraryItem[]>>;
  read(input: ReadLibraryItemInput): Promise<ApiResult<LibraryItem>>;
}

/**
 * Property templates — U4 gap #5. `create` echoes back the stored record
 * (id, `createdAt`, `scope` filled in), the same "write returns the fresh
 * read" shape `QualityApi` uses above, so a caller can seed
 * `queryKeys.template.byProject(projectId)` without a second round trip.
 */
export interface PropertyTemplatesApi {
  create(input: CreatePropertyTemplateInput): Promise<ApiResult<PropertyTemplate>>;
  list(input: ListPropertyTemplatesInput): Promise<ApiResult<PropertyTemplate[]>>;
}

/**
 * Ai có mặt trong hệ thống, và ba việc người quản trị làm với họ — T-04/T-05.
 *
 * Chín phương thức, khớp chín đường của `ENDPOINTS.users`. Bảy lượt GHI đều trả
 * về bản ghi `AdminUser` đã đổi — không phải `void` — vì mọi lượt trong số đó
 * hoàn tác được (A8) và cái toast hoàn tác cần biết trạng thái trước lẫn sau.
 * `invite` là ngoại lệ về SỐ LƯỢNG chứ không về hình dạng: một lời mời gửi cho
 * nhiều địa chỉ một lượt, nên nó trả về mảng những người vừa được tạo ở trạng
 * thái `'pending'`.
 *
 * `list` giải mã qua `AdminUserListSchema` bằng `decodeSingle`, KHÔNG bằng
 * `safeParseList` như `LibraryApi.list`: ở đây `total` và `users` là một hình
 * dạng duy nhất, và bỏ qua một dòng hỏng rồi vẫn in `total` cũ thì màn nói dối
 * về con số. `memberships` và `activity` thì ngược lại — chúng là danh sách
 * thật, nên chúng dùng `safeParseList` và một dòng hỏng không làm rỗng cả panel.
 */
export interface UsersApi {
  activity(input: ReadUserActivityInput): Promise<ApiResult<UserActivity[]>>;
  changeRole(input: ChangeUserRoleInput): Promise<ApiResult<AdminUser>>;
  disable(input: SetUserEnabledInput): Promise<ApiResult<AdminUser>>;
  enable(input: SetUserEnabledInput): Promise<ApiResult<AdminUser>>;
  invite(input: InviteUsersApiInput): Promise<ApiResult<AdminUser[]>>;
  list(options?: RequestOptions): Promise<ApiResult<AdminUserList>>;
  memberships(input: ReadUserMembershipsInput): Promise<ApiResult<UserMembership[]>>;
  remove(input: RemoveUserApiInput): Promise<ApiResult<AdminUser>>;
  resendInvite(input: ResendInviteInput): Promise<ApiResult<AdminUser>>;
}

/**
 * Hộp thư của người đang đăng nhập — T-09.
 *
 * `list` không nhận tham số nào ngoài `signal`, cùng lý lẽ với `UsersApi.list`:
 * bộ lọc (`NotificationFilter`,
 * `screens/system/NotificationCenter/notificationModel.ts`) chạy trên danh
 * sách đã tải, không phải một lượt gọi khác cho mỗi lần đổi tab.
 *
 * `acceptInvite` là phép ghi MỚI của lượt này — trước T-09 không có cách nào
 * cho NGƯỜI NHẬN chấp nhận một lời mời (`UsersApi.invite`/`resendInvite` ở
 * trên đều là việc của người quản trị GỬI lời mời). Nó nhận `notificationId`,
 * không `inviteId`: xem `ENDPOINTS.notifications` cho lý do.
 */
export interface MarkNotificationsReadApiInput extends WriteRequestOptions {
  body: MarkNotificationsReadInput;
}

export interface AcceptNotificationInviteInput extends WriteRequestOptions {
  notificationId: string;
}

/**
 * Bốn phương thức, khớp bốn đường của `ENDPOINTS.notifications` mà tầng này
 * gọi qua `HttpClient` — `stream` không có mặt ở đây vì nó là địa chỉ cho một
 * `EventSource` mở thẳng, không đi qua client này (xem docblock của
 * `ENDPOINTS.notifications`).
 *
 * `markRead` và `markAllRead` trả `void`, đúng chữ ký
 * `NotificationCenterGateway.markRead`/`markAllRead` mà nhóm này phục vụ
 * (`screens/system/NotificationCenter/notificationModel.ts`) — không có toast
 * hoàn tác nào cần một bản ghi trước/sau ở đây, khác `UsersApi.disable`/`enable`.
 *
 * `list` giải mã qua `safeParseList` (như `LibraryApi.list`), không như
 * `UsersApi.list`: một hộp thư không có tổng số cần giữ đúng, nên một mục hỏng
 * bị bỏ qua thay vì làm rỗng cả hộp thư — đúng thứ A11 tồn tại để chặn.
 *
 * `acceptInvite` trả về chính thông báo vừa đổi, cùng khuôn mọi lượt GHI khác
 * trong `UsersApi`.
 */
/** UIFIX-B7 — `GET /api/notifications?limit&cursor`; `cursor` = `nextCursor` trang trước. */
export interface ListNotificationsPageInput extends RequestOptions {
  cursor?: string;
  limit?: number;
}

/** `nextCursor` lấy từ header `X-Next-Cursor`; vắng nghĩa là hết. */
export interface NotificationPage {
  items: Notification[];
  nextCursor?: string;
}

export interface NotificationsApi {
  acceptInvite(input: AcceptNotificationInviteInput): Promise<ApiResult<Notification>>;
  list(options?: RequestOptions): Promise<ApiResult<Notification[]>>;
  /** "Xem cũ hơn": thân vẫn là mảng trần, trang kế đi trong header `X-Next-Cursor`. */
  listPage(input?: ListNotificationsPageInput): Promise<ApiResult<NotificationPage>>;
  markAllRead(options?: WriteRequestOptions): Promise<ApiResult<void>>;
  markRead(input: MarkNotificationsReadApiInput): Promise<ApiResult<void>>;
}

/**
 * The credential exchange.
 *
 * Two things make this group unlike every other one in this file.
 *
 * **It is the only group a signed-out caller uses.** Everything else needs a
 * session to be worth calling; these two are how one starts.
 *
 * **It decodes nothing, and that is deliberate rather than unfinished.** The
 * session in this application is refresh-cookie based — `src/lib/auth` holds the
 * access token, renews it and hands it to the transport, and it obtains one by
 * calling the refresh path, not by reading a login response. So a successful
 * post here means "the server accepted these credentials and set the cookie";
 * turning that into a session is `bootstrapSession()`'s job, one layer up. There
 * is no token in the body for this module to model, which is why the result is
 * `void` rather than a schema nobody could write yet.
 *
 * **Nhóm này đi một `HttpClient` TRẦN — không token, không refresh** (BE-00
 * W10, tham số `authHttp` của {@link createApiClient}). Đăng nhập sai mật khẩu
 * trả 401 `INVALID_CREDENTIALS`; trên một client có refresh thì 401 ấy kích
 * một lượt refresh, refresh cũng 401, rồi `onAuthError` đăng xuất **mọi thẻ**
 * đang mở — một người gõ sai mật khẩu ở thẻ A đá văng phiên ở thẻ B. Gửi kèm
 * `Authorization` cũng vô nghĩa: đây chính là lượt gọi để CÓ được thẻ bài.
 *
 * N8–N10 của F-09a (quên mật khẩu, đặt lại, xác minh email) vào đúng nhóm này,
 * vì cùng một lý do.
 */
export interface AuthApi {
  acceptInvitation(input: AcceptInvitationApiInput): Promise<ApiResult<void>>;
  confirmPasswordReset(input: ConfirmPasswordResetApiInput): Promise<ApiResult<void>>;
  previewInvitation(input: PreviewInvitationApiInput): Promise<ApiResult<InvitationPreview>>;
  requestPasswordReset(input: RequestPasswordResetApiInput): Promise<ApiResult<void>>;
  signIn(input: SignInApiInput): Promise<ApiResult<void>>;
}

export interface ListProjectSummariesInput extends RequestOptions {
  cursor?: string;
  limit?: number;
}

/** N1 — một trang thẻ dự án. `droppedCount` = dòng thô trừ dòng giữ (một dòng hỏng không khoá cả lưới, A11). */
export interface ProjectSummaryList {
  droppedCount: number;
  items: ProjectSummary[];
  nextCursor?: string;
}

export interface ProjectSummariesApi {
  list(input?: ListProjectSummariesInput): Promise<ApiResult<ProjectSummaryList>>;
}

export interface AddProjectMemberInput extends WriteRequestOptions {
  email: string;
  projectId: string;
  /** U24: vai trong dự án; vắng = theo vai toàn hệ thống. */
  role?: 'engineer' | 'viewer';
}

export interface RemoveProjectMemberInput extends WriteRequestOptions {
  projectId: string;
  userId: string;
}

/** N3 (`add`, `idempotencyKey` đi header) và N4 (`remove`). Cả hai trả người vừa thêm/gỡ. */
export interface MembersApi {
  add(input: AddProjectMemberInput): Promise<ApiResult<ApiUser>>;
  remove(input: RemoveProjectMemberInput): Promise<ApiResult<ApiUser>>;
}

export interface ReadProjectSettingsInput extends RequestOptions {
  projectId: string;
}

export interface ReplaceProjectSettingsInput extends WriteRequestOptions {
  baseVersion: number;
  body: ProjectSettingsBody;
  projectId: string;
}

/** N5 đọc, N6 thay trọn thân (`PUT {baseVersion, body}`). */
export interface ProjectSettingsApi {
  read(input: ReadProjectSettingsInput): Promise<ApiResult<ProjectSettings>>;
  replace(input: ReplaceProjectSettingsInput): Promise<ApiResult<ProjectSettings>>;
}

export interface ReadProjectRuleConfigInput extends RequestOptions {
  projectId: string;
}

export interface ReplaceProjectRuleConfigInput extends WriteRequestOptions {
  baseVersion: number;
  body: UpdateRuleConfig['body'];
  projectId: string;
}

/** N21 đọc, N22 thay trọn `overrides` (`PUT {baseVersion, body}`); 409 mang `remoteChanges: []`. */
export interface RuleConfigApi {
  read(input: ReadProjectRuleConfigInput): Promise<ApiResult<ProjectRuleConfig>>;
  replace(input: ReplaceProjectRuleConfigInput): Promise<ApiResult<ProjectRuleConfig>>;
}

export interface ReplaceAvatarInput extends WriteRequestOptions {
  body: UploadAvatar;
}

export interface ChangeMePasswordInput extends WriteRequestOptions {
  body: ChangePassword;
}

export interface UpdateProfileInput extends WriteRequestOptions {
  body: UpdateMe;
}

/** N11 đọc, N12 sửa, N13 đổi mật khẩu (204), N14 thay ảnh đại diện (PUT, timeout `file`). */
export interface MeApi {
  changePassword(input: ChangeMePasswordInput): Promise<ApiResult<void>>;
  readProfile(options?: RequestOptions): Promise<ApiResult<Me>>;
  replaceAvatar(input: ReplaceAvatarInput): Promise<ApiResult<Me>>;
  updateProfile(input: UpdateProfileInput): Promise<ApiResult<Me>>;
}

export interface ApiClient {
  auth: AuthApi;
  designConcept: DesignConceptApi;
  drawings: DrawingsApi;
  featureFlags: FeatureFlagsApi;
  floors: FloorsApi;
  library: LibraryApi;
  lightingBakes: LightingBakesApi;
  me: MeApi;
  modelExports: ModelExportsApi;
  members: MembersApi;
  notifications: NotificationsApi;
  projectSettings: ProjectSettingsApi;
  projectSummaries: ProjectSummariesApi;
  projects: ProjectsApi;
  propertyTemplates: PropertyTemplatesApi;
  quality: QualityApi;
  ruleConfig: RuleConfigApi;
  share: ShareApi;
  spatial: SpatialApi;
  /** M2 — tuỳ chọn: client giả/cũ có thể không có; vắng = dùng bảng gói kèm. */
  suggestionRules?: SuggestionRulesApi;
  users: UsersApi;
  versions: VersionsApi;
}

export const SharedModelSchema = z.object({
  link: ShareLinkWireSchema,
  projectName: z.string(),
  graph: SpatialGraphDocumentSchema,
});
export type SharedModel = z.infer<typeof SharedModelSchema>;

/** N47 đọc trạng thái AI phong cách của dự án; N48 chọn kiểu (`styleId` vắng = quay về đề xuất AI, gửi `{}`). */
export interface DesignConceptApi {
  read(input: { projectId: string } & RequestOptions): Promise<ApiResult<DesignConceptState>>;
  select(input: { projectId: string; styleId?: DesignStyleId } & WriteRequestOptions): Promise<ApiResult<DesignConcept>>;
}

/**
 * N42–N44 — nướng ánh sáng. `readLatest` trả `null` khi dự án chưa có lượt nào (404), vì
 * "chưa nướng" là trạng thái bình thường của màn, không phải lỗi. `readFile` trả Blob (tệp cần
 * header Bearer nên không gắn thẳng URL vào loader được; nơi gọi tự `URL.createObjectURL`).
 */
export interface LightingBakesApi {
  readFile(projectId: string, bakeId: string, name: LightingBakeFileName, options?: RequestOptions): Promise<ApiResult<Blob>>;
  readLatest(projectId: string, options?: RequestOptions): Promise<ApiResult<LightingBake | null>>;
  start(projectId: string, glb: Blob, options?: RequestOptions): Promise<ApiResult<LightingBake>>;
}

/**
 * N49–N51 — xuất GLB dựng phía máy chủ. `start` gửi thân `{}`; 202 (job mới) và 200 (cache cùng
 * fingerprint) cùng một schema nên nơi gọi không phân biệt. `readLatest` trả `null` khi 404
 * (chưa xuất lần nào). `readFile` trả Blob như lighting bake.
 */
export interface ModelExportsApi {
  readFile(projectId: string, exportId: string, name: ModelExportFileName, options?: RequestOptions): Promise<ApiResult<Blob>>;
  readLatest(projectId: string, options?: RequestOptions): Promise<ApiResult<ModelExport | null>>;
  start(projectId: string, options?: RequestOptions): Promise<ApiResult<ModelExport>>;
}

export interface ShareApi {
  /** `GET /share/{token}` công khai, chỉ đọc; token lạ/hết hạn/thu hồi → 404 `resource:"share_link"`. */
  open(input: { token: string } & RequestOptions): Promise<ApiResult<SharedModel>>;
}

export interface ListFloorVersionPageInput extends RequestOptions {
  cursor?: string;
  floorId: string;
  limit?: number;
  projectId: string;
}

export interface ReadFloorVersionSnapshotInput extends RequestOptions {
  floorId: string;
  projectId: string;
  versionId: string;
}

export interface RestoreFloorVersionInput extends WriteRequestOptions {
  /** `revision` hiện tại của TẦNG — không phải `sequence` của phiên bản (HOP-DONG-MOI §5). */
  baseVersion: number;
  floorId: string;
  projectId: string;
  versionId: string;
}

export interface LabelFloorVersionInput extends WriteRequestOptions {
  /** `''` là gỡ nhãn. */
  label: string;
  projectId: string;
  versionId: string;
}

/** N17 sau giải mã: mục hỏng bị bỏ kèm cảnh báo (`safeParseList`), không làm rỗng cả trang. */
export interface FloorVersionList {
  items: FloorVersionSummary[];
  nextCursor?: string;
}

/** N17 trang, N18 nội dung, N19 phục hồi (201 hay 200 như nhau), N20 nhãn. */
export interface VersionsApi {
  label(input: LabelFloorVersionInput): Promise<ApiResult<FloorVersionSummary>>;
  list(input: ListFloorVersionPageInput): Promise<ApiResult<FloorVersionList>>;
  restore(input: RestoreFloorVersionInput): Promise<ApiResult<FloorVersionSummary>>;
  snapshot(input: ReadFloorVersionSnapshotInput): Promise<ApiResult<FloorVersionSnapshot>>;
}

const asApiResult = <T>(result: Result<T, HttpError>): ApiResult<T> => result as ApiResult<T>;

const decodeSingle = <S extends ZodTypeAny>(
  result: Result<unknown, HttpError>,
  schema: S,
  source: string,
): ApiResult<z.output<S>> => {
  if (!result.ok) {
    return asApiResult(result);
  }

  return decode(schema, result.data, source) as ApiResult<z.output<S>>;
};

const decodeList = <S extends ZodTypeAny>(
  result: Result<unknown, HttpError>,
  schema: S,
  source: string,
): ApiResult<z.output<S>[]> => {
  if (!result.ok) {
    return asApiResult(result);
  }

  return safeParseList(schema, result.data, source) as ApiResult<z.output<S>[]>;
};

type TransportWriteOptions = Pick<
  HttpRequestOptions,
  'failFastOnRateLimit' | 'idempotencyKey' | 'idempotent' | 'signal' | 'timeoutMode'
>;

/**
 * Năm khoá đi thẳng xuống transport, từng khoá chép khi `!== undefined`.
 *
 * Trải cả `undefined` xuống sẽ dựng ra `{ idempotent: undefined }`, thứ mà
 * `exactOptionalPropertyTypes` từ chối và `toStrictEqual` trong bài kiểm bắt
 * được: "khoá vắng" và "khoá mang undefined" là hai thứ khác nhau ở đây.
 */
const toRequestOptions = (options: WriteRequestOptions = {}): TransportWriteOptions => ({
  ...(options.failFastOnRateLimit !== undefined ? { failFastOnRateLimit: options.failFastOnRateLimit } : {}),
  ...(options.idempotencyKey !== undefined ? { idempotencyKey: options.idempotencyKey } : {}),
  ...(options.idempotent !== undefined ? { idempotent: options.idempotent } : {}),
  ...(options.signal !== undefined ? { signal: options.signal } : {}),
  ...(options.timeoutMode !== undefined ? { timeoutMode: options.timeoutMode } : {}),
});

/** N7 — trần `limit` của hợp đồng (openapi: mặc định 50, tối đa 200): ít chuyến nhất cho cùng một danh sách. */
const LATEST_UPLOADS_PAGE_LIMIT = 200;

const callGet = async <T>(http: HttpClient, path: string, signal?: AbortSignal): Promise<Result<T, HttpError>> =>
  http.get<T>(path, signal !== undefined ? { signal } : undefined);

const callDelete = async <T>(http: HttpClient, path: string, options: WriteRequestOptions): Promise<Result<T, HttpError>> =>
  http.delete<T>(path, toRequestOptions(options));

/**
 * A delete that carries a body.
 *
 * `callDelete` above cannot be reused: `users.remove` has to send the address
 * the reviewer retyped (`RemoveUserSchema.confirmEmail`, A9), and a confirmation
 * that travels as a query parameter ends up in a server access log next to the
 * request that acted on it. `HttpRequestOptions<TBody>` already models a body on
 * every verb, so this is the same call `callDelete` makes with one more field.
 */
const callDeleteWithBody = async <T, TBody>(
  http: HttpClient,
  path: string,
  body: TBody,
  options: WriteRequestOptions,
): Promise<Result<T, HttpError>> => http.delete<T, TBody>(path, { body, ...toRequestOptions(options) });

const callPost = async <T, TBody>(
  http: HttpClient,
  path: string,
  body: TBody,
  options: WriteRequestOptions,
): Promise<Result<T, HttpError>> => http.post<T, TBody>(path, { body, ...toRequestOptions(options) });

const callPut = async <T, TBody>(
  http: HttpClient,
  path: string,
  body: TBody,
  options: WriteRequestOptions,
): Promise<Result<T, HttpError>> => http.put<T, TBody>(path, { body, ...toRequestOptions(options) });

const callPatch = async <T, TBody>(
  http: HttpClient,
  path: string,
  body: TBody,
  options: WriteRequestOptions,
): Promise<Result<T, HttpError>> => http.patch<T, TBody>(path, { body, ...toRequestOptions(options) });

/**
 * A post whose only interesting answer is whether it worked.
 *
 * `decodeSingle` cannot be reused here: it needs a schema, and there is nothing
 * in either response this client models. Discarding the body keeps that explicit
 * — the alternative is `ApiResult<unknown>`, which invites a caller to reach
 * into a payload nothing has validated.
 */
const postWithoutBody = async <TBody>(
  http: HttpClient,
  path: string,
  body: TBody,
  options: WriteRequestOptions,
): Promise<ApiResult<void>> => {
  const result = await callPost<unknown, TBody>(http, path, body, options);

  return result.ok ? { ok: true, data: undefined } : asApiResult(result);
};

/**
 * Mọi nhóm đi `http`; riêng nhóm `auth` đi `options.authHttp` khi có.
 *
 * Vắng `authHttp` thì cả hai là một client — nơi gọi `createApiClient(http)` cũ
 * không đổi nghĩa.
 */
export const createApiClient = (http: HttpClient, options: { authHttp?: HttpClient } = {}): ApiClient => ({
  auth: {
    acceptInvitation: async (input) =>
      postWithoutBody(options.authHttp ?? http, ENDPOINTS.auth.invitationAccept, input.body, input),
    previewInvitation: async (input) =>
      decodeSingle(
        await callPost(options.authHttp ?? http, ENDPOINTS.auth.invitationPreview, input.body, input),
        InvitationPreviewSchema,
        'auth.previewInvitation',
      ),
    confirmPasswordReset: async (input) =>
      postWithoutBody(options.authHttp ?? http, ENDPOINTS.auth.passwordResetConfirm, input.body, input),
    requestPasswordReset: async (input) =>
      postWithoutBody(options.authHttp ?? http, ENDPOINTS.auth.passwordReset, input.body, input),
    signIn: async (input) => postWithoutBody(options.authHttp ?? http, ENDPOINTS.auth.login, input.body, input),
  },
  drawings: {
    complete: async (input) => {
      const { body, projectId } = input;

      return decodeSingle(
        await callPost(http, ENDPOINTS.drawings.complete(projectId, body.uploadId), body, { ...input, timeoutMode: 'file' }),
        ProgressSchema,
        'drawings.complete',
      );
    },
    initUpload: async (input) => {
      const { body } = input;

      return decodeSingle(
        await callPost(http, ENDPOINTS.drawings.initUpload(body.projectId, body.floorId), body, input),
        ProgressSchema,
        'drawings.initUpload',
      );
    },
    latestUploads: async ({ projectId, signal }) => {
      const uploads: LatestFloorUpload[] = [];
      let cursor: string | undefined;

      // Phong bì kiểm chặt, từng mục qua `safeParseList`: một mục hỏng bị bỏ kèm
      // cảnh báo chứ không làm rỗng cả màn (`CursorEnvelopeSchema`).
      do {
        const page = decodeSingle(
          await http.get<unknown>(ENDPOINTS.drawings.latestUploads(projectId, cursor), {
            query: { limit: LATEST_UPLOADS_PAGE_LIMIT },
            ...(signal !== undefined ? { signal } : {}),
          }),
          CursorEnvelopeSchema,
          'drawings.latestUploads',
        );

        if (!page.ok) {
          return page;
        }

        const items = safeParseList(LatestFloorUploadSchema, page.data.items, 'drawings.latestUploads');

        if (!items.ok) {
          return items;
        }

        uploads.push(...items.data);
        cursor = page.data.nextCursor;
      } while (cursor !== undefined);

      return { ok: true, data: uploads };
    },
    listPipelineRuns: async ({ cursor, limit, projectId, signal }) => {
      const page = decodeSingle(
        await http.get<unknown>(ENDPOINTS.drawings.pipelineRuns(projectId), {
          query: {
            ...(cursor !== undefined ? { cursor } : {}),
            ...(limit !== undefined ? { limit } : {}),
          },
          ...(signal !== undefined ? { signal } : {}),
        }),
        CursorEnvelopeSchema,
        'drawings.listPipelineRuns',
      );

      if (!page.ok) {
        return page;
      }

      const items = safeParseList(PipelineRunSchema, page.data.items, 'drawings.listPipelineRuns');

      if (!items.ok) {
        return items;
      }

      return {
        ok: true,
        data: {
          droppedCount: page.data.items.length - items.data.length,
          items: items.data,
          ...(page.data.nextCursor !== undefined ? { nextCursor: page.data.nextCursor } : {}),
        },
      };
    },
    pageThumbnails: async ({ file, projectId, signal }) => {
      const decoded = decodeSingle(
        await callPost(http, ENDPOINTS.drawings.pageThumbnails(projectId), file, {
          timeoutMode: 'file',
          ...(signal !== undefined ? { signal } : {}),
        }),
        PageThumbnailsSchema,
        'drawings.pageThumbnails',
      );

      return decoded.ok ? { ok: true, data: decoded.data.pages } : decoded;
    },
    progress: async ({ projectId, signal, uploadId }) =>
      decodeSingle(
        await callGet<unknown>(http, ENDPOINTS.drawings.progress(projectId, uploadId), signal),
        ProgressSchema,
        'drawings.progress',
      ),
    sendChunk: async (input) => {
      const { body, projectId, uploadId } = input;

      return decodeSingle(
        await callPost(http, ENDPOINTS.drawings.chunk(projectId, uploadId), body, { ...input, timeoutMode: 'file' }),
        ProgressSchema,
        'drawings.sendChunk',
      );
    },
  },
  featureFlags: {
    read: async (options) =>
      asApiResult(await callGet<unknown>(http, ENDPOINTS.featureFlags.read, options?.signal)),
  },
  floors: {
    create: async (input) => {
      const { body, projectId } = input;

      return decodeSingle(
        await callPost(http, ENDPOINTS.floors.create(projectId), { ...toFloorWirePayload(body), id: body.id }, input),
        FloorSchema,
        'floors.create',
      );
    },
    delete: async (input) => {
      const { floorId } = input;

      return decodeSingle(
        await callDelete<unknown>(http, ENDPOINTS.floors.delete(floorId), input),
        FloorSchema,
        'floors.delete',
      );
    },
    list: async (input) =>
      decodeList(
        await callGet<unknown>(http, ENDPOINTS.floors.list(input.projectId), input.signal),
        FloorSchema,
        'floors.list',
      ),
    reorder: async (input) => {
      const { body } = input;

      return decodeList(
        await callPatch(http, ENDPOINTS.floors.reorder, body, input),
        FloorSchema,
        'floors.reorder',
      );
    },
  },
  library: {
    list: async (options) =>
      decodeList(await callGet<unknown>(http, ENDPOINTS.library.list, options?.signal), LibraryItemSchema, 'library.list'),
    read: async ({ libraryItemId, signal }) =>
      decodeSingle(
        await callGet<unknown>(http, ENDPOINTS.library.detail(libraryItemId), signal),
        LibraryItemSchema,
        'library.read',
      ),
  },
  suggestionRules: {
    read: async (options) => {
      const result = await callGet<unknown>(http, ENDPOINTS.suggestionRules, options?.signal);
      if (!result.ok && result.error.status === 404) return { ok: true, data: null };
      return decodeSingle(result, SuggestionRulesetSchema, 'suggestionRules.read');
    },
  },
  designConcept: {
    read: async ({ projectId, signal }) =>
      decodeSingle(
        await callGet<unknown>(http, ENDPOINTS.designConcept(projectId), signal),
        DesignConceptStateSchema,
        'designConcept.read',
      ),
    // N48 luôn trả 202 (kể cả khi dùng lại lượt cùng đầu vào); `asApiResult` nhận mọi 2xx.
    select: async ({ projectId, styleId, ...options }) =>
      decodeSingle(
        await callPost(http, ENDPOINTS.designConcept(projectId), styleId === undefined ? {} : { styleId }, options),
        DesignConceptSchema,
        'designConcept.select',
      ),
  },
  lightingBakes: {
    readFile: async (projectId, bakeId, name, options) =>
      asApiResult(
        await http.get<Blob>(ENDPOINTS.lightingBakes.file(projectId, bakeId, name), {
          responseType: 'blob',
          timeoutMode: 'file',
          ...(options?.signal !== undefined ? { signal: options.signal } : {}),
        }),
      ),
    readLatest: async (projectId, options) => {
      const result = await callGet<unknown>(http, ENDPOINTS.lightingBakes.latest(projectId), options?.signal);
      if (!result.ok && result.error.status === 404) return { ok: true, data: null };
      return decodeSingle(result, LightingBakeSchema, 'lightingBakes.readLatest');
    },
    start: async (projectId, glb, options) =>
      decodeSingle(
        await http.post<unknown, Blob>(ENDPOINTS.lightingBakes.start(projectId), {
          body: glb,
          headers: { 'Content-Type': 'model/gltf-binary' },
          timeoutMode: 'file',
          ...(options?.signal !== undefined ? { signal: options.signal } : {}),
        }),
        LightingBakeSchema,
        'lightingBakes.start',
      ),
  },
  modelExports: {
    readFile: async (projectId, exportId, name, options) =>
      asApiResult(
        await http.get<Blob>(ENDPOINTS.modelExports.file(projectId, exportId, name), {
          responseType: 'blob',
          timeoutMode: 'file',
          ...(options?.signal !== undefined ? { signal: options.signal } : {}),
        }),
      ),
    readLatest: async (projectId, options) => {
      const result = await callGet<unknown>(http, ENDPOINTS.modelExports.latest(projectId), options?.signal);
      if (!result.ok && result.error.status === 404) return { ok: true, data: null };
      return decodeSingle(result, ModelExportSchema, 'modelExports.readLatest');
    },
    start: async (projectId, options) =>
      decodeSingle(
        await http.post<unknown, Record<string, never>>(ENDPOINTS.modelExports.start(projectId), {
          body: {},
          ...(options?.signal !== undefined ? { signal: options.signal } : {}),
        }),
        ModelExportSchema,
        'modelExports.start',
      ),
  },
  me: {
    changePassword: async (input) => postWithoutBody(http, ENDPOINTS.me.password, input.body, input),
    readProfile: async (options) =>
      decodeSingle(await callGet<unknown>(http, ENDPOINTS.me.profile, options?.signal), MeSchema, 'me.readProfile'),
    replaceAvatar: async (input) =>
      decodeSingle(
        await callPut(http, ENDPOINTS.me.avatar, input.body, { ...input, timeoutMode: 'file' }),
        MeSchema,
        'me.replaceAvatar',
      ),
    updateProfile: async (input) =>
      decodeSingle(await callPatch(http, ENDPOINTS.me.profile, input.body, input), MeSchema, 'me.updateProfile'),
  },
  members: {
    add: async (input) => {
      const { email, projectId, role } = input;

      return decodeSingle(
        await callPost(http, ENDPOINTS.members.add(projectId), role === undefined ? { email } : { email, role }, input),
        UserSchema,
        'members.add',
      );
    },
    remove: async (input) => {
      const { projectId, userId } = input;

      return decodeSingle(
        await callDelete<unknown>(http, ENDPOINTS.members.remove(projectId, userId), input),
        UserSchema,
        'members.remove',
      );
    },
  },
  notifications: {
    acceptInvite: async (input) => {
      const { notificationId } = input;

      return decodeSingle(
        await callPost(http, ENDPOINTS.notifications.acceptInvite(notificationId), {}, input),
        NotificationSchema,
        'notifications.acceptInvite',
      );
    },
    list: async (options) =>
      decodeList(
        await callGet<unknown>(http, ENDPOINTS.notifications.list, options?.signal),
        NotificationSchema,
        'notifications.list',
      ),
    listPage: async ({ cursor, limit, signal } = {}) => {
      const raw = await http.get<Response>(ENDPOINTS.notifications.list, {
        query: {
          ...(cursor !== undefined ? { cursor } : {}),
          ...(limit !== undefined ? { limit } : {}),
        },
        responseType: 'response',
        ...(signal !== undefined ? { signal } : {}),
      });

      if (!raw.ok) {
        return asApiResult(raw);
      }

      const nextCursor = raw.data.headers.get('X-Next-Cursor') ?? '';
      const items = decodeList(
        { ok: true, data: (await raw.data.json()) as unknown },
        NotificationSchema,
        'notifications.listPage',
      );

      if (!items.ok) {
        return items;
      }

      return { ok: true, data: { items: items.data, ...(nextCursor !== '' ? { nextCursor } : {}) } };
    },
    markAllRead: async (options = {}) =>
      postWithoutBody(http, ENDPOINTS.notifications.markAllRead, {}, options),
    markRead: async (input) =>
      postWithoutBody(http, ENDPOINTS.notifications.markRead, input.body, input),
  },
  projects: {
    create: async (input) => {
      const { body } = input;

      return decodeSingle(
        await callPost(http, ENDPOINTS.projects.create, toProjectWirePayload(body), input),
        ProjectSchema,
        'projects.create',
      );
    },
    delete: async (input) => {
      const { projectId } = input;

      return decodeSingle(
        await callDelete<unknown>(http, ENDPOINTS.projects.delete(projectId), input),
        ProjectSchema,
        'projects.delete',
      );
    },
    cancelCreate: async (input) =>
      decodeSingle(
        await callDelete<unknown>(http, ENDPOINTS.projects.cancelCreate(input.projectId), input),
        ProjectSchema,
        'projects.cancelCreate',
      ),
    list: async (options) =>
      decodeList(await callGet<unknown>(http, ENDPOINTS.projects.list, options?.signal), ProjectSchema, 'projects.list'),
    read: async ({ projectId, signal }) =>
      decodeSingle(
        await callGet<unknown>(http, ENDPOINTS.projects.read(projectId), signal),
        ProjectSchema,
        'projects.read',
      ),
    update: async (input) => {
      const { body, projectId } = input;

      return decodeSingle(
        await callPatch(http, ENDPOINTS.projects.update(projectId), toProjectWirePayload(body), input),
        ProjectSchema,
        'projects.update',
      );
    },
  },
  projectSettings: {
    read: async ({ projectId, signal }) =>
      decodeSingle(
        await callGet<unknown>(http, ENDPOINTS.projectSettings.read(projectId), signal),
        ProjectSettingsSchema,
        'projectSettings.read',
      ),
    replace: async (input) => {
      const { baseVersion, body, projectId } = input;

      return decodeSingle(
        await callPut(http, ENDPOINTS.projectSettings.replace(projectId), { baseVersion, body }, input),
        ProjectSettingsSchema,
        'projectSettings.replace',
      );
    },
  },
  projectSummaries: {
    list: async ({ cursor, limit, signal } = {}) => {
      const page = decodeSingle(
        await http.get<unknown>(ENDPOINTS.projectSummaries.list, {
          query: {
            ...(cursor !== undefined ? { cursor } : {}),
            ...(limit !== undefined ? { limit } : {}),
          },
          ...(signal !== undefined ? { signal } : {}),
        }),
        CursorEnvelopeSchema,
        'projectSummaries.list',
      );

      if (!page.ok) {
        return page;
      }

      const items = safeParseList(ProjectSummarySchema, page.data.items, 'projectSummaries.list');

      if (!items.ok) {
        return items;
      }

      return {
        data: {
          droppedCount: page.data.items.length - items.data.length,
          items: items.data,
          ...(page.data.nextCursor !== undefined ? { nextCursor: page.data.nextCursor } : {}),
        },
        ok: true,
      };
    },
  },
  /**
   * No schema decode here, same reasoning as `featureFlags.read` above: a
   * template's `fields` shape depends on `objectKind` (see
   * `PropertyTemplateFieldsByKind`), and this file has no wire-schema
   * vocabulary for `Wall`/`Opening`/`Room`/`Furniture` to validate it against
   * — building one is future work, not something this endpoint should block
   * on.
   */
  propertyTemplates: {
    create: async (input) => {
      const { body, projectId } = input;

      return asApiResult(
        await callPost<PropertyTemplate, PropertyTemplateDraft>(
          http,
          ENDPOINTS.propertyTemplates.create(projectId),
          body,
          input,
        ),
      );
    },
    list: async ({ projectId, signal }) =>
      asApiResult(
        await callGet<PropertyTemplate[]>(http, ENDPOINTS.propertyTemplates.list(projectId), signal),
      ),
  },
  quality: {
    assess: async ({ floorId, projectId, signal }) =>
      decodeSingle(
        await callGet<unknown>(http, ENDPOINTS.quality.assess(projectId, floorId), signal),
        ImageQualityAssessmentSchema,
        'quality.assess',
      ),
    dimensionStrings: async ({ floorId, projectId, signal }) =>
      decodeSingle(
        await callGet<unknown>(http, ENDPOINTS.quality.dimensionStrings(projectId, floorId), signal),
        DimensionStringsSchema,
        'quality.dimensionStrings',
      ),
    detectedGeometry: async ({ floorId, projectId, signal }) =>
      decodeSingle(
        await callGet<unknown>(http, ENDPOINTS.quality.detectedGeometry(projectId, floorId), signal),
        DetectedGeometrySchema,
        'quality.detectedGeometry',
      ),
    setCorners: async (input) => {
      const { body, floorId, projectId } = input;

      return decodeSingle(
        await callPost(http, ENDPOINTS.quality.corners(projectId, floorId), body, { ...input, timeoutMode: 'file' }),
        ImageQualityAssessmentSchema,
        'quality.setCorners',
      );
    },
    straighten: async (input) => {
      const { floorId, projectId } = input;

      return decodeSingle(
        await callPost(http, ENDPOINTS.quality.straighten(projectId, floorId), {}, { ...input, timeoutMode: 'file' }),
        ImageQualityAssessmentSchema,
        'quality.straighten',
      );
    },
  },
  ruleConfig: {
    read: async ({ projectId, signal }) =>
      decodeSingle(
        await callGet<unknown>(http, ENDPOINTS.ruleConfig.read(projectId), signal),
        ProjectRuleConfigSchema,
        'ruleConfig.read',
      ),
    replace: async (input) => {
      const { baseVersion, body, projectId } = input;

      return decodeSingle(
        await callPut(http, ENDPOINTS.ruleConfig.replace(projectId), { baseVersion, body }, input),
        ProjectRuleConfigSchema,
        'ruleConfig.replace',
      );
    },
  },
  share: {
    // Client trần (không token, không refresh): trang công khai không có phiên.
    open: async ({ signal, token }) =>
      decodeSingle(
        await callGet<unknown>(options.authHttp ?? http, ENDPOINTS.share(token), signal),
        SharedModelSchema,
        'share.open',
      ),
  },
  spatial: {
    patchFloor: async (input) => {
      const { body, floorId, projectId } = input;

      return decodeSingle(
        await callPatch(http, ENDPOINTS.spatial.floor(projectId, floorId), toFloorWirePayload(body), input),
        FloorSchema,
        'spatial.patchFloor',
      );
    },
    readFloor: async ({ floorId, projectId, signal }) =>
      decodeSingle(
        await callGet<unknown>(http, ENDPOINTS.spatial.floor(projectId, floorId), signal),
        FloorSchema,
        'spatial.readFloor',
      ),
    readVersion: async ({ projectId, signal, versionId }) =>
      decodeSingle(
        await callGet<unknown>(http, ENDPOINTS.spatial.version(projectId, versionId), signal),
        VersionSchema,
        'spatial.readVersion',
      ),
    readGraph: async ({ projectId, signal }) =>
      decodeSingle(
        await callGet<unknown>(http, ENDPOINTS.spatial.graph(projectId), signal),
        SpatialGraphDocumentSchema,
        'spatial.readGraph',
      ),
    exportGraph: async (input) =>
      decodeSingle(
        await callPost<unknown, Record<string, never>>(http, ENDPOINTS.spatial.exports(input.projectId), {}, input),
        SpatialGraphDocumentSchema,
        'spatial.exportGraph',
      ),
    readLayer: async ({ floorId, projectId, signal }) =>
      decodeSingle(
        await callGet<unknown>(http, ENDPOINTS.spatial.layer(projectId, floorId), signal),
        FloorLayerDocumentSchema,
        'spatial.readLayer',
      ),
    /**
     * `PUT {baseVersion, body}` — `body` là `{ layer?, scaleMillimetresPerPixel? }`, gửi nguyên. Đúng route #35 của BE
     * (`spatial_write/router.py`). Bản trước gửi `PATCH` trần lớp, mà BE không
     * có `PATCH` nào ở đường này: mọi lượt lưu trên máy chủ thật là 405 (B-G-07).
     */
    writeLayer: async (input) => {
      const { baseVersion, body, floorId, projectId } = input;

      return decodeSingle(
        await callPut(http, ENDPOINTS.spatial.layer(projectId, floorId), { baseVersion, body }, input),
        FloorLayerWriteResultSchema,
        'spatial.writeLayer',
      );
    },
  },
  users: {
    activity: async ({ signal, userId }) =>
      decodeList(
        await callGet<unknown>(http, ENDPOINTS.users.activity(userId), signal),
        UserActivitySchema,
        'users.activity',
      ),
    changeRole: async (input) => {
      const { body } = input;

      return decodeSingle(
        await callPatch(http, ENDPOINTS.users.changeRole(body.userId), body, input),
        AdminUserSchema,
        'users.changeRole',
      );
    },
    disable: async (input) => {
      const { userId } = input;

      return decodeSingle(
        await callPost(http, ENDPOINTS.users.disable(userId), {}, input),
        AdminUserSchema,
        'users.disable',
      );
    },
    enable: async (input) => {
      const { userId } = input;

      return decodeSingle(
        await callPost(http, ENDPOINTS.users.enable(userId), {}, input),
        AdminUserSchema,
        'users.enable',
      );
    },
    invite: async (input) => {
      const { body } = input;

      return decodeList(
        await callPost(http, ENDPOINTS.users.invite, body, input),
        AdminUserSchema,
        'users.invite',
      );
    },
    list: async (options) =>
      decodeSingle(
        await callGet<unknown>(http, ENDPOINTS.users.list, options?.signal),
        AdminUserListSchema,
        'users.list',
      ),
    memberships: async ({ signal, userId }) =>
      decodeList(
        await callGet<unknown>(http, ENDPOINTS.users.memberships(userId), signal),
        UserMembershipSchema,
        'users.memberships',
      ),
    remove: async (input) => {
      const { body } = input;

      return decodeSingle(
        await callDeleteWithBody(http, ENDPOINTS.users.remove(body.userId), body, input),
        AdminUserSchema,
        'users.remove',
      );
    },
    resendInvite: async (input) => {
      const { userId } = input;

      return decodeSingle(
        await callPost(http, ENDPOINTS.users.resendInvite(userId), {}, input),
        AdminUserSchema,
        'users.resendInvite',
      );
    },
  },
  versions: {
    label: async (input) => {
      const { label, projectId, versionId } = input;

      return decodeSingle(
        await callPatch(http, ENDPOINTS.versions.label(projectId, versionId), { label }, input),
        FloorVersionSummarySchema,
        'versions.label',
      );
    },
    list: async ({ cursor, floorId, limit, projectId, signal }) => {
      const page = decodeSingle(
        await http.get<unknown>(ENDPOINTS.versions.list(projectId), {
          query: { floorId, ...(cursor !== undefined ? { cursor } : {}), ...(limit !== undefined ? { limit } : {}) },
          ...(signal !== undefined ? { signal } : {}),
        }),
        CursorEnvelopeSchema,
        'versions.list',
      );

      if (!page.ok) {
        return page;
      }

      const items = safeParseList(FloorVersionSummarySchema, page.data.items, 'versions.list');

      if (!items.ok) {
        return items;
      }

      return {
        ok: true,
        data: { items: items.data, ...(page.data.nextCursor !== undefined ? { nextCursor: page.data.nextCursor } : {}) },
      };
    },
    restore: async (input) => {
      const { baseVersion, floorId, projectId, versionId } = input;

      return decodeSingle(
        await callPost(http, ENDPOINTS.versions.restore(projectId, versionId), { baseVersion, body: { floorId } }, input),
        FloorVersionSummarySchema,
        'versions.restore',
      );
    },
    snapshot: async ({ floorId, projectId, signal, versionId }) =>
      decodeSingle(
        await http.get<unknown>(ENDPOINTS.versions.snapshot(projectId, versionId), {
          query: { floorId },
          ...(signal !== undefined ? { signal } : {}),
        }),
        FloorVersionSnapshotSchema,
        'versions.snapshot',
      ),
  },
});

