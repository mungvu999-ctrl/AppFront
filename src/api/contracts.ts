import * as sourceSchemas from './schemas';

export const DrawingSchema = sourceSchemas.DrawingSchema;
export const FloorSchema = sourceSchemas.FloorSchema;
export const ProgressSchema = sourceSchemas.ProgressSchema;
export const ProjectSchema = sourceSchemas.ProjectSchema;
export const UserSchema = sourceSchemas.UserSchema;
export const VersionSchema = sourceSchemas.VersionSchema;

/* Chất lượng ảnh đầu vào — T-04. Cùng cửa ra với sáu schema tài nguyên trên. */
export const DrawingCornersInputSchema = sourceSchemas.DrawingCornersInputSchema;
export const DrawingFrameSchema = sourceSchemas.DrawingFrameSchema;
export const FloorImageQualitySchema = sourceSchemas.FloorImageQualitySchema;
export const ImageQualityAssessmentSchema = sourceSchemas.ImageQualityAssessmentSchema;
export const ImageQualityFindingSchema = sourceSchemas.ImageQualityFindingSchema;
export const ImageQualityMeasurementSchema = sourceSchemas.ImageQualityMeasurementSchema;
export const QualityPointSchema = sourceSchemas.QualityPointSchema;
export const QualityRegionSchema = sourceSchemas.QualityRegionSchema;

export type Drawing = sourceSchemas.Drawing;
export type DrawingWire = sourceSchemas.DrawingWire;
export type Floor = sourceSchemas.Floor;
export type FloorWire = sourceSchemas.FloorWire;
export type Progress = sourceSchemas.Progress;
export type ProgressWire = sourceSchemas.ProgressWire;
export type Project = sourceSchemas.Project;
export type ProjectWire = sourceSchemas.ProjectWire;
export type User = sourceSchemas.User;
export type UserWire = sourceSchemas.UserWire;
export type Version = sourceSchemas.Version;
export type VersionWire = sourceSchemas.VersionWire;

export type DrawingCornersInput = sourceSchemas.DrawingCornersInput;
export type DrawingFrame = sourceSchemas.DrawingFrame;
export type DrawingFrameWire = sourceSchemas.DrawingFrameWire;
export type FloorImageQuality = sourceSchemas.FloorImageQuality;
export type FloorImageQualityWire = sourceSchemas.FloorImageQualityWire;
export type ImageQualityAssessment = sourceSchemas.ImageQualityAssessment;
export type ImageQualityAssessmentWire = sourceSchemas.ImageQualityAssessmentWire;
export type ImageQualityFinding = sourceSchemas.ImageQualityFinding;
export type ImageQualityFindingWire = sourceSchemas.ImageQualityFindingWire;
export type ImageQualityMeasurement = sourceSchemas.ImageQualityMeasurement;
export type ImageQualityMeasurementWire = sourceSchemas.ImageQualityMeasurementWire;
export type QualityPoint = sourceSchemas.QualityPoint;
export type QualityPointWire = sourceSchemas.QualityPointWire;
export type QualityRegion = sourceSchemas.QualityRegion;
export type QualityRegionWire = sourceSchemas.QualityRegionWire;

/* Thư viện model — D-01/D-02/D-03. Cùng cửa ra với mọi schema khác. */
export const LibraryItemSchema = sourceSchemas.LibraryItemSchema;
export const LIBRARY_FILTER_IDS = sourceSchemas.LIBRARY_FILTER_IDS;
export const LIBRARY_GROUPS = sourceSchemas.LIBRARY_GROUPS;
export const LIBRARY_SOURCES = sourceSchemas.LIBRARY_SOURCES;
export const FURNITURE_KIND_BY_LIBRARY_GROUP = sourceSchemas.FURNITURE_KIND_BY_LIBRARY_GROUP;
export const matchesLibraryFilter = sourceSchemas.matchesLibraryFilter;

export type LibraryFilterId = sourceSchemas.LibraryFilterId;
export type LibraryGroup = sourceSchemas.LibraryGroup;
export type LibraryItem = sourceSchemas.LibraryItem;
export type LibraryItemWire = sourceSchemas.LibraryItemWire;
export type LibrarySource = sourceSchemas.LibrarySource;

export type ProjectStatus = Project['status'];
export type FloorAreaM2 = Floor['areaM2'];
export type FloorElevationMm = Floor['elevationMm'];
export type FloorHeightMm = Floor['heightMm'];
export type FloorName = Floor['name'];
export type FloorOrder = Floor['order'];

const userRoleToWire = {
  admin: 'admin',
  engineer: 'engineer',
  viewer: 'viewer',
} as const satisfies Record<User['role'], UserWire['role']>;

const progressStatusToWire = {
  completed: 'completed',
  failed: 'failed',
  pending: 'pending',
  running: 'running',
} as const satisfies Record<Progress['status'], ProgressWire['status']>;

const projectStatusToWire = {
  approved: 'approved',
  draft: 'draft',
  error: 'error',
  processing: 'processing',
} as const satisfies Record<Project['status'], ProjectWire['status']>;

export interface ProjectPayload {
  address?: string;
  code?: string;
  currentVersion?: Version;
  floors?: Floor[];
  members?: User[];
  name?: string;
  progress?: Progress;
  status?: ProjectStatus;
}

export interface FloorPayload {
  areaM2?: FloorAreaM2;
  drawings?: Drawing[];
  elevationMm?: FloorElevationMm;
  heightMm?: FloorHeightMm;
  /** Chỉ PATCH #34 mang nó (BE bb255414); POST tạo tầng không gửi. */
  hiddenIn3d?: boolean;
  /** Chỉ PATCH #34: đánh dấu bản vẽ của tầng là mặt cắt (BE tự ẩn khỏi 3D). Phản hồi không mang lại khoá này. */
  isSection?: boolean;
  name?: FloorName;
  order?: FloorOrder;
}

export interface DrawingWireInput {
  heightMm: number;
  id: string;
  name: string;
  scale?: number;
  uploaderId: string;
  uploadedAt: string;
  url: string;
  widthMm: number;
}

export interface FloorWireInput {
  areaM2?: FloorAreaM2;
  drawings?: Drawing[];
  elevationMm: FloorElevationMm;
  heightMm: FloorHeightMm;
  id: string;
  name: string;
  order: FloorOrder;
}

export interface ProgressWireInput {
  endedAt?: string;
  error?: string;
  id: string;
  startedAt?: string;
  status: Progress['status'];
  step: string;
  progressPercent: number;
}

export interface ProjectWireInput {
  address?: string;
  code?: string;
  createdAt: string;
  currentVersion?: Version;
  floors: Floor[];
  id: string;
  members: User[];
  name: string;
  progress?: Progress;
  status: ProjectStatus;
  updatedAt: string;
}

export interface VersionWireInput {
  createdAt: string;
  creatorId: string;
  id: string;
  note?: string;
  projectId: string;
  sequence: number;
}

export const toUserWirePayload = (input: User): UserWire => ({
  ...(input.avatarUrl !== undefined ? { avatarUrl: input.avatarUrl } : {}),
  email: input.email,
  id: input.id,
  name: input.name,
  role: userRoleToWire[input.role],
});

export const toDrawingWirePayload = (input: Drawing | DrawingWireInput): DrawingWire => ({
  heightMm: input.heightMm,
  id: input.id,
  name: input.name,
  ...(input.scale !== undefined ? { scale: input.scale } : {}),
  uploadedAt: input.uploadedAt,
  uploaderId: input.uploaderId,
  url: input.url,
  widthMm: input.widthMm,
});

/** `isSection` chỉ đi lên (PATCH #34); `FloorSchema` của phản hồi không có nó nên ghép riêng. */
export const toFloorWirePayload = (input: FloorPayload): Partial<FloorWire> & { isSection?: boolean } => ({
  ...(input.areaM2 !== undefined ? { areaM2: input.areaM2 } : {}),
  ...(input.drawings !== undefined ? { drawings: input.drawings.map(toDrawingWirePayload) } : {}),
  ...(input.elevationMm !== undefined ? { elevationMm: input.elevationMm } : {}),
  ...(input.heightMm !== undefined ? { heightMm: input.heightMm } : {}),
  ...(input.hiddenIn3d !== undefined ? { hiddenIn3d: input.hiddenIn3d } : {}),
  ...(input.isSection !== undefined ? { isSection: input.isSection } : {}),
  ...(input.name !== undefined ? { name: input.name } : {}),
  ...(input.order !== undefined ? { order: input.order } : {}),
});

export const toProgressWirePayload = (input: Progress | ProgressWireInput): ProgressWire => ({
  ...(input.endedAt !== undefined ? { endedAt: input.endedAt } : {}),
  ...(input.error !== undefined ? { error: input.error } : {}),
  id: input.id,
  progressPercent: input.progressPercent,
  ...(input.startedAt !== undefined ? { startedAt: input.startedAt } : {}),
  status: progressStatusToWire[input.status],
  step: input.step,
});

export const toProjectWirePayload = (input: ProjectPayload): Partial<ProjectWire> => ({
  ...(input.address !== undefined ? { address: input.address } : {}),
  ...(input.code !== undefined ? { code: input.code } : {}),
  ...(input.currentVersion !== undefined ? { currentVersion: toVersionWirePayload(input.currentVersion) } : {}),
  ...(input.floors !== undefined ? { floors: input.floors.map((floor) => toFloorWirePayload(floor) as FloorWire) } : {}),
  ...(input.members !== undefined ? { members: input.members.map(toUserWirePayload) } : {}),
  ...(input.name !== undefined ? { name: input.name } : {}),
  ...(input.progress !== undefined ? { progress: toProgressWirePayload(input.progress) } : {}),
  ...(input.status !== undefined ? { status: projectStatusToWire[input.status] } : {}),
});

export const toVersionWirePayload = (input: Version | VersionWireInput): VersionWire => ({
  createdAt: input.createdAt,
  creatorId: input.creatorId,
  id: input.id,
  ...(input.note !== undefined ? { note: input.note } : {}),
  projectId: input.projectId,
  sequence: input.sequence,
});

export const createDrawingWire = toDrawingWirePayload;

export const createFloorWire = (input: FloorWireInput): FloorWire =>
  toFloorWirePayload(input) as FloorWire;

export const createProgressWire = toProgressWirePayload;

export const createProjectWire = (input: ProjectWireInput): ProjectWire => ({
  ...(toProjectWirePayload(input) as ProjectWire),
  createdAt: input.createdAt,
  id: input.id,
  updatedAt: input.updatedAt,
});

export const createVersionWire = toVersionWirePayload;
