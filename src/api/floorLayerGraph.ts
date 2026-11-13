import { normalizeSpatial, type NormalizedSpatial } from '@/domain/spatial/normalize';
import type { Building, SpatialGraph } from '@/domain/spatial/types';
import type { ProjectRole, Project as StoreProject } from '@/types/project';

import type { ApiClient, Project as ApiProject, SpatialApi } from './client';
import type { SpatialGraphDocument } from './schemas/spatialGraph';
import type { FloorLayerDocument } from './schemas/spatialLayer';
import { effectiveProjectRole } from '@/lib/auth/permissions';
import type { FloorScaleDetail, ScaleSource } from '@/lib/viewmodel/provisionalScale';

/**
 * Đường nạp thật của màn QC: N16 (`GET …/floors/{floorId}/spatial/layer`) →
 * `NormalizedSpatial` mà kho `spatial` giữ — B-V6-01.
 *
 * Trước tệp này, cổng mặc định của màn QC đọc lại chính cái kho
 * (`read: () => useStore.getState().spatial`): kho rỗng thì `null` mãi, nên màn
 * treo skeleton vĩnh viễn và không có đường nào đưa dữ liệu vào.
 */

/**
 * Toà nhà của một đồ thị MỘT tầng.
 *
 * N16 nói về một tầng và không mang `building` — thứ ấy ở N15. `SpatialGraph`
 * thì bắt buộc có, nên đây là chỗ đứng chứ không phải dữ liệu: không màn QC nào
 * đọc toà nhà. Nguồn `human` + đã duyệt vì nó không phải đầu ra của AI (A5).
 */
export const FLOOR_LAYER_BUILDING: Building = Object.freeze({
  confidence: 1,
  datumElevationMm: 0,
  name: '',
  reviewed: true,
  source: 'human',
});

/** Tài liệu tầng N16 thành đồ thị một tầng. */
export const floorLayerToGraph = (document: FloorLayerDocument): SpatialGraph => ({
  axes: document.axes,
  building: FLOOR_LAYER_BUILDING,
  dimensions: document.dimensions,
  furniture: document.layer.furniture,
  levels: [document.level],
  notes: [],
  openings: document.layer.openings,
  rooms: document.layer.rooms,
  walls: document.layer.walls,
  ...(document.layer.roofs === undefined ? {} : { roofs: document.layer.roofs }),
});

/** Đồ thị kho kèm `revision` N16 của từng tầng đã đọc — base lượt ghi đầu. */
export interface FloorLayerGraphRead {
  readonly floorRevisions: Readonly<Record<string, number>>;
  readonly graph: NormalizedSpatial;
  /** Tầng có tỷ lệ tạm (N16 `scaleStatus`) — cùng hình `SpatialSource.floorScaleStatus` của kho. */
  readonly floorScaleStatus?: Readonly<Record<string, 'unresolved'>>;
  /** Nguồn tỷ lệ tạm của các tầng ấy (N16 `scaleSource`, UX-R1 K12). */
  readonly floorScaleSource?: Readonly<Record<string, ScaleSource>>;
  /** N16 `scaleState`/`scaleReasons` (R9) của các tầng ấy. */
  readonly floorScaleDetail?: Readonly<Record<string, FloorScaleDetail>>;
}

export interface ReadFloorLayerGraphInput {
  readonly floorId: string;
  readonly projectId: string;
  readonly signal?: AbortSignal | undefined;
}

/**
 * Đọc lớp một tầng và trả về dạng kho. Lỗi thì NÉM — đó là cách `useQuery` của
 * màn đi vào trạng thái `error` của A11, thay vì `loading` mãi.
 */
export async function readFloorLayerRead(
  spatialApi: Pick<SpatialApi, 'readLayer'>,
  { floorId, projectId, signal }: ReadFloorLayerGraphInput,
): Promise<FloorLayerGraphRead> {
  const result = await spatialApi.readLayer(
    signal === undefined ? { floorId, projectId } : { floorId, projectId, signal },
  );

  if (!result.ok) {
    throw result.error;
  }

  return {
    floorRevisions: { [floorId]: result.data.revision },
    graph: normalizeSpatial(floorLayerToGraph(result.data)),
  };
}

/** Như {@link readFloorLayerRead}, chỉ lấy đồ thị. */
export async function readFloorLayerGraph(
  spatialApi: Pick<SpatialApi, 'readLayer'>,
  input: ReadFloorLayerGraphInput,
): Promise<NormalizedSpatial> {
  return (await readFloorLayerRead(spatialApi, input)).graph;
}

export interface ReadProjectLayerGraphInput {
  readonly floorIds: readonly string[];
  readonly projectId: string;
  readonly signal?: AbortSignal | undefined;
}

/**
 * Đồ thị của MỌI tầng trong dự án — thứ màn quản lý tầng vẽ (cao độ, số tường,
 * số phòng, diện tích theo tầng). Không có endpoint cả dự án, nên đọc N16 của
 * từng tầng rồi ghép. Một tầng hỏng thì cả lượt NÉM (A11 `error`), không vẽ nửa
 * dự án như thể đó là tất cả.
 *
 * ponytail: một lượt N16 cho mỗi tầng (trần `PROJECT_LIMITS.floorCountMax`); có
 * endpoint cả dự án thì thay đúng hàm này.
 */
export async function readProjectLayerRead(
  spatialApi: Pick<SpatialApi, 'readLayer'>,
  { floorIds, projectId, signal }: ReadProjectLayerGraphInput,
): Promise<FloorLayerGraphRead> {
  const documents = await Promise.all(
    floorIds.map(async (floorId) => {
      const result = await spatialApi.readLayer(
        signal === undefined ? { floorId, projectId } : { floorId, projectId, signal },
      );

      if (!result.ok) {
        throw result.error;
      }

      return result.data;
    }),
  );
  const graphs = documents.map(floorLayerToGraph);

  const graph = normalizeSpatial({
    axes: graphs.flatMap((graph) => graph.axes),
    building: FLOOR_LAYER_BUILDING,
    dimensions: graphs.flatMap((graph) => graph.dimensions),
    furniture: graphs.flatMap((graph) => graph.furniture),
    levels: graphs.flatMap((graph) => graph.levels),
    notes: [],
    openings: graphs.flatMap((graph) => graph.openings),
    rooms: graphs.flatMap((graph) => graph.rooms),
    walls: graphs.flatMap((one) => one.walls),
    roofs: graphs.flatMap((one) => one.roofs ?? []),
  });

  const floorScaleStatus: Record<string, 'unresolved'> = {};
  const floorScaleSource: Record<string, ScaleSource> = {};
  const floorScaleDetail: Record<string, FloorScaleDetail> = {};

  floorIds.forEach((floorId, index) => {
    const document = documents[index];

    if (document?.scaleStatus !== undefined) floorScaleStatus[floorId] = document.scaleStatus;
    if (document?.scaleSource !== undefined) floorScaleSource[floorId] = document.scaleSource;
    if (document?.scaleState !== undefined || document?.scaleReasons !== undefined) {
      floorScaleDetail[floorId] = {
        ...(document.scaleState === undefined ? {} : { scaleState: document.scaleState }),
        ...(document.scaleReasons === undefined ? {} : { scaleReasons: document.scaleReasons }),
      };
    }
  });

  return {
    floorRevisions: Object.fromEntries(floorIds.map((floorId, index) => [floorId, documents[index]?.revision ?? 0])),
    floorScaleDetail,
    floorScaleSource,
    floorScaleStatus,
    graph,
  };
}

/** Như {@link readProjectLayerRead}, chỉ lấy đồ thị. */
export async function readProjectLayerGraph(
  spatialApi: Pick<SpatialApi, 'readLayer'>,
  input: ReadProjectLayerGraphInput,
): Promise<NormalizedSpatial> {
  return (await readProjectLayerRead(spatialApi, input)).graph;
}

export interface ReadProjectSpatialInput {
  readonly projectId: string;
  readonly signal?: AbortSignal | undefined;
}

/** What the project gate hands `hydrateProject`/`loadProjectGraph`. */
export interface ProjectSpatial {
  readonly document: SpatialGraphDocument;
  readonly project: StoreProject;
  readonly roles: readonly ProjectRole[];
}

/** Who is reading: the signed-in user and the roles of their session. */
export interface SpatialReader {
  readonly userId: string | null;
  readonly roles: readonly ProjectRole[];
}

/** Dự án #24 thành hình `projectSlice` giữ — kho không mang email thành viên. */
const toStoreProject = (project: ApiProject): StoreProject => ({
  created_at: project.createdAt,
  id: project.id,
  members: project.members.map((member) => ({
    ...(member.avatarUrl !== undefined ? { avatar_url: member.avatarUrl } : {}),
    id: member.id,
    name: member.name,
    role: member.role,
  })),
  name: project.name,
  updated_at: project.updatedAt,
});

/** Vai của người đang đọc trong `members`; không phải thành viên thì vai của phiên. */
export const rolesOf = (project: ApiProject, reader: SpatialReader): readonly ProjectRole[] => {
  const member = project.members.find((candidate) => candidate.id === reader.userId);

  return member === undefined ? reader.roles : [effectiveProjectRole(member)];
};

/** #24 thô (cùng hình bộ đệm `queryKeys.project.detail` của `mobileViewerQueries.ts`); lỗi thì NÉM. */
export async function readProjectDetail(
  projects: Pick<ApiClient['projects'], 'read'>,
  { projectId, signal }: ReadProjectSpatialInput,
): Promise<ApiProject> {
  const result = await projects.read(signal === undefined ? { projectId } : { projectId, signal });

  if (!result.ok) {
    throw result.error;
  }

  return result.data;
}

/** N15 — cả đồ thị kèm `floorRevisions`; lỗi thì NÉM. */
export async function readProjectGraph(
  spatialApi: Pick<SpatialApi, 'readGraph'>,
  { projectId, signal }: ReadProjectSpatialInput,
): Promise<SpatialGraphDocument> {
  const result = await spatialApi.readGraph(signal === undefined ? { projectId } : { projectId, signal });

  if (!result.ok) {
    throw result.error;
  }

  return result.data;
}

/** Ghép #24 + N15 thành thứ cổng ghi vào kho. */
export const toProjectSpatial = (
  project: ApiProject,
  document: SpatialGraphDocument,
  reader: SpatialReader,
): ProjectSpatial => ({ document, project: toStoreProject(project), roles: rolesOf(project, reader) });

/**
 * Đường nạp kho của một dự án (F-04x-2): #24 cho dự án và thành viên, N15 cho cả đồ thị
 * cùng `revision` từng tầng — thay N16 từng tầng. #24 hỏng thì không đọc N15. Lỗi thì NÉM.
 */
export async function readProjectSpatial(
  api: Pick<ApiClient, 'projects' | 'spatial'>,
  input: ReadProjectSpatialInput,
  reader: SpatialReader,
): Promise<ProjectSpatial> {
  const project = await readProjectDetail(api.projects, input);

  return toProjectSpatial(project, await readProjectGraph(api.spatial, input), reader);
}
