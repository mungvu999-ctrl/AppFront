export type QueryKey = readonly unknown[];

type QueryDomain =
  | 'adminMl'
  | 'drawing'
  | 'floor'
  | 'layer'
  | 'library'
  | 'me'
  | 'measurement'
  | 'notification'
  | 'progress'
  | 'project'
  | 'quality'
  | 'room'
  | 'space'
  | 'template'
  | 'user'
  | 'version'
  | 'violation';

type QueryBranch = string;
type QueryBranchRoot = readonly [QueryDomain, QueryBranch];

type QueryKeyFactory<
  TArgs extends readonly unknown[],
  TKey extends QueryKey,
  TRoot extends QueryBranchRoot,
> = ((...args: TArgs) => TKey) & {
  root: () => TRoot;
};

export type QueryKeyOf<TFactory> = TFactory extends (...args: infer TArgs) => infer TKey
  ? TArgs extends readonly unknown[]
    ? TKey extends QueryKey
      ? TKey
      : never
    : never
  : never;

const freezeKey = <const TKey extends QueryKey>(key: TKey): TKey => Object.freeze(key) as TKey;

const createQueryKeyFactory = <
  const TRoot extends QueryBranchRoot,
  const TArgs extends readonly unknown[],
  const TKey extends QueryKey,
>(
  root: TRoot,
  createKey: (...args: TArgs) => TKey,
): QueryKeyFactory<TArgs, TKey, TRoot> =>
  Object.assign((...args: TArgs) => freezeKey(createKey(...args)), {
    root: () => root,
  });

const projectListRoot = freezeKey(['project', 'list'] as const);
const projectDetailRoot = freezeKey(['project', 'detail'] as const);
const projectHouseProposalRoot = freezeKey(['project', 'houseProposal'] as const);
const projectMembersRoot =freezeKey(['project', 'members'] as const);
/*
 * Danh sách dự án gần đây của màn "không tìm thấy trang" — khoá RIÊNG, không
 * dùng lại `project.list`.
 *
 * Hai màn từng dùng chung `project.list`, và nó đổ. `notFoundGateway` đọc
 * `client.projects.list()` nên nó ghi hình dạng `Project` của API;
 * bảng điều khiển ghi hình dạng `DashboardProject` (có thêm `members`), dẫn xuất từ
 * N1 và nay nằm dưới `project.summaries()`, không còn dưới `list`. Hai người ghi, hai hình dạng,
 * một khoá: vào 404 trước rồi bấm "về danh sách dự án" thì bảng điều khiển (khi còn dùng chung khoá) đọc lại
 * bộ đệm của 404 và `ProjectCardTile` ném
 * `Cannot read properties of undefined (reading 'length')` ở `project.members`.
 *
 * React Query không thấy được chỗ này (khoá chỉ là một mảng chuỗi) và TypeScript
 * cũng không (mỗi cổng tự khai kiểu trả về của mình). Nên lời chặn duy nhất là
 * **một khoá một hình dạng**.
 */
const projectRecentRoot = freezeKey(['project', 'recent'] as const);
/* Thẻ dự án của dashboard (N1) — khoá riêng, một hình dạng (`ProjectSummaryList`-dẫn-xuất); không đọc N1 dưới `list`/`detail`. */
const projectSummariesRoot = freezeKey(['project', 'summaries'] as const);
const floorListRoot = freezeKey(['floor', 'list'] as const);
const floorDetailRoot = freezeKey(['floor', 'detail'] as const);
const drawingByFloorRoot = freezeKey(['drawing', 'byFloor'] as const);
const progressByFloorRoot = freezeKey(['progress', 'byFloor'] as const);
const progressLatestUploadsRoot = freezeKey(['progress', 'latestUploads'] as const);
const spaceByFloorRoot = freezeKey(['space', 'byFloor'] as const);
const qualityAssessmentRoot = freezeKey(['quality', 'assessment'] as const);
const roomByFloorRoot = freezeKey(['room', 'byFloor'] as const);
const templateByProjectRoot = freezeKey(['template', 'byProject'] as const);
const violationByProjectRoot = freezeKey(['violation', 'byProject'] as const);
const versionByFloorRoot = freezeKey(['version', 'byFloor'] as const);
const layerGraphRoot = freezeKey(['layer', 'graph'] as const);
const layerByFloorRoot = freezeKey(['layer', 'byFloor'] as const);
const libraryListRoot = freezeKey(['library', 'list'] as const);
const libraryDetailRoot = freezeKey(['library', 'detail'] as const);
const meProfileRoot = freezeKey(['me', 'profile'] as const);
const measurementAllRoot = freezeKey(['measurement', 'all'] as const);
const notificationListRoot = freezeKey(['notification', 'list'] as const);
const userListRoot = freezeKey(['user', 'list'] as const);
const userCurrentRoot = freezeKey(['user', 'current'] as const);
const userMembershipsRoot = freezeKey(['user', 'memberships'] as const);
const userActivityRoot = freezeKey(['user', 'activity'] as const);
const adminMlDatasetsRoot = freezeKey(['adminMl', 'datasets'] as const);
const adminMlDatasetVersionsRoot = freezeKey(['adminMl', 'datasetVersions'] as const);
const adminMlFamiliesRoot = freezeKey(['adminMl', 'families'] as const);
const adminMlJobRoot = freezeKey(['adminMl', 'job'] as const);
const adminMlJobsRoot = freezeKey(['adminMl', 'jobs'] as const);
const adminMlVersionsRoot = freezeKey(['adminMl', 'versions'] as const);
const adminMlVersionRoot = freezeKey(['adminMl', 'version'] as const);

export const queryKeys = {
  /**
   * Registry model của chuỗi xử lý — F-11 (N23, N25, N27).
   *
   * `versions` khoá theo họ: ba họ là ba danh sách tách biệt, và kích hoạt một bản ở họ này
   * không làm cũ danh sách họ kia. `version` khoá theo mã bản: một bản không đổi sau khi
   * tạo trừ trạng thái đánh giá, nên lượt kích hoạt không làm cũ nó.
   *
   * F-12 (N28, N30, N32, N34): `jobs` khoá theo bộ lọc (vắng = `null`, không phải chuỗi
   * "tất cả" có thể trùng giá trị thật); `jobs.root()` là tiền tố để làm cũ mọi bộ lọc.
   */
  adminMl: {
    datasetVersions: createQueryKeyFactory(adminMlDatasetVersionsRoot, (datasetId: string) => [
      ...adminMlDatasetVersionsRoot,
      datasetId,
    ] as const),
    datasets: createQueryKeyFactory(adminMlDatasetsRoot, (family: string | undefined) => [
      ...adminMlDatasetsRoot,
      family ?? null,
    ] as const),
    families: createQueryKeyFactory(adminMlFamiliesRoot, () => adminMlFamiliesRoot),
    job: createQueryKeyFactory(adminMlJobRoot, (jobId: string) => [...adminMlJobRoot, jobId] as const),
    jobs: createQueryKeyFactory(
      adminMlJobsRoot,
      (filter: { readonly family?: string | undefined; readonly status?: string | undefined }) => [
        ...adminMlJobsRoot,
        filter.family ?? null,
        filter.status ?? null,
      ] as const,
    ),
    version: createQueryKeyFactory(adminMlVersionRoot, (modelVersionId: string) => [
      ...adminMlVersionRoot,
      modelVersionId,
    ] as const),
    versions: createQueryKeyFactory(adminMlVersionsRoot, (family: string) => [
      ...adminMlVersionsRoot,
      family,
    ] as const),
  },
  drawing: {
    byFloor: createQueryKeyFactory(drawingByFloorRoot, (floorId: string) => [...drawingByFloorRoot, floorId] as const),
  },
  floor: {
    detail: createQueryKeyFactory(floorDetailRoot, (floorId: string) => [...floorDetailRoot, floorId] as const),
    list: createQueryKeyFactory(floorListRoot, (projectId: string) => [...floorListRoot, projectId] as const),
    /**
     * Ảnh chụp `{ graph, floors, floorRevisions }` của Quản lý tầng — khoá RIÊNG dưới `list(projectId)`.
     * `list` mang `Floor[]` (Tải bản vẽ, cổng chất lượng); chung khoá thì màn kia trải một object và sập
     * (BUG-348). Nằm dưới `list` nên làm mất hiệu lực `list(projectId)` vẫn làm mới khoá này.
     */
    manager: createQueryKeyFactory(floorListRoot, (projectId: string) => [
      ...floorListRoot,
      projectId,
      'manager',
    ] as const),
  },
  /**
   * Đồ thị không gian theo máy chủ: N15 cả dự án (`graph`), N16 một tầng (`byFloor`).
   * F-05b, F-08 vô hiệu hai khoá này khi máy chủ thay tầng từ ngoài.
   */
  layer: {
    byFloor: createQueryKeyFactory(layerByFloorRoot, (projectId: string, floorId: string) => [
      ...layerByFloorRoot,
      projectId,
      floorId,
    ] as const),
    graph: createQueryKeyFactory(layerGraphRoot, (projectId: string) => [...layerGraphRoot, projectId] as const),
  },
  library: {
    detail: createQueryKeyFactory(libraryDetailRoot, (libraryItemId: string) => [
      ...libraryDetailRoot,
      libraryItemId,
    ] as const),
    list: createQueryKeyFactory(libraryListRoot, () => libraryListRoot),
  },
  /** Hồ sơ của người đang đăng nhập (N11): bản nháp hồ sơ đã ánh xạ, một khoá một hình dạng. */
  me: {
    profile: createQueryKeyFactory(meProfileRoot, () => meProfileRoot),
  },
  /**
   * Thông báo của người đang đăng nhập — T-09.
   *
   * Một nhánh duy nhất: `NotificationCenterGateway` (T09-CONTRACT.md mục 0,
   * `notificationModel.ts`) chỉ có một lượt ĐỌC (`list`) — đánh dấu đã đọc và
   * chấp nhận lời mời là hai lượt GHI, khai ở `invalidation.ts`, không phải
   * khoá truy vấn. Không lồng dưới `user`: đây là danh sách của PHIÊN đăng
   * nhập hiện tại chứ không phải hồ sơ một người dùng bất kỳ, và nó đổi theo
   * sự kiện thời gian thực chứ không theo tuần như bảng người dùng — xem bậc
   * `notification` riêng trong `cachePolicy.ts`.
   */
  notification: {
    list: createQueryKeyFactory(notificationListRoot, () => notificationListRoot),
  },
  progress: {
    byFloor: createQueryKeyFactory(progressByFloorRoot, (floorId: string) => [
      ...progressByFloorRoot,
      floorId,
    ] as const),
    /** N7 — lượt tải mới nhất của từng tầng trong dự án: màn xử lý theo dõi danh sách này. */
    latestUploads: createQueryKeyFactory(progressLatestUploadsRoot, (projectId: string) => [
      ...progressLatestUploadsRoot,
      projectId,
    ] as const),
  },
  project: {
    detail: createQueryKeyFactory(projectDetailRoot, (projectId: string) => [...projectDetailRoot, projectId] as const),
    /** Đề xuất số tầng/cốt/chiều cao cho cả nhà (Mức 3): chỉ đọc, `null` khi công tắc tắt. */
    houseProposal: createQueryKeyFactory(projectHouseProposalRoot, (projectId: string) => [
      ...projectHouseProposalRoot,
      projectId,
    ] as const),
    list: createQueryKeyFactory(projectListRoot, () => projectListRoot),
    recent: createQueryKeyFactory(projectRecentRoot, () => projectRecentRoot),
    members: createQueryKeyFactory(projectMembersRoot, (projectId: string) => [
      ...projectMembersRoot,
      projectId,
    ] as const),
    summaries: createQueryKeyFactory(projectSummariesRoot, () => projectSummariesRoot),
  },
  /**
   * Phép đo chất lượng ảnh của một tầng.
   *
   * Khoá theo `floorId` chứ không theo `uploadId`: câu hỏi là "bản vẽ đang dùng
   * của tầng này tốt tới đâu", và nó vẫn là cùng câu hỏi sau khi người dùng tải
   * lên một lượt khác — xem `ENDPOINTS.quality.assess`. Lượt đọc trả về trạng
   * thái của mọi tầng trong dự án, nên hai tầng khác nhau vẫn là hai khoá khác
   * nhau: mỗi khoá giữ một lượt đọc, và tầng đang xem là thứ phân biệt chúng.
   */
  quality: {
    assessment: createQueryKeyFactory(qualityAssessmentRoot, (floorId: string) => [
      ...qualityAssessmentRoot,
      floorId,
    ] as const),
  },
  room: {
    byFloor: createQueryKeyFactory(roomByFloorRoot, (floorId: string) => [...roomByFloorRoot, floorId] as const),
  },
  space: {
    byFloor: createQueryKeyFactory(spaceByFloorRoot, (floorId: string) => [...spaceByFloorRoot, floorId] as const),
  },
  /**
   * Khuôn mẫu thuộc tính — U4 gap #5. Khoá theo `projectId`, không theo
   * `floorId`: một khuôn mẫu (ví dụ "tường 220 chịu lực") dùng lại được ở MỌI
   * tầng của cùng dự án, đúng phạm vi `scope: 'project'` của
   * `PropertyTemplate` (`src/api/client.ts`).
   */
  template: {
    byProject: createQueryKeyFactory(templateByProjectRoot, (projectId: string) => [
      ...templateByProjectRoot,
      projectId,
    ] as const),
  },
  /**
   * Người dùng — T-04/T-05.
   *
   * `list` và `current` đã nằm ở đây từ trước; `memberships` và `activity` là
   * hai nhánh MỚI của cùng miền `'user'`, không phải một miền `'users'` thứ hai.
   * Lý do cụ thể: `TIER_BY_DOMAIN` (`./cachePolicy.ts`) xếp bậc theo ĐOẠN ĐẦU
   * của khoá, và nó đã có `user: 'static'`. Một miền `'users'` riêng sẽ rơi về
   * bậc `'default'` 30 giây trong im lặng — cùng một bảng người dùng, hai chính
   * sách cache khác nhau, không ai thấy cho tới lúc một màn refetch nhiều gấp
   * mười màn kia. R-71 nói không dựng nguồn thứ hai cho một quyết định đã có
   * chủ; đây là hình dạng cụ thể của luật ấy ở tầng khoá.
   *
   * Cả hai nhánh mới đều khoá theo `userId`: chúng trả lời "người NÀY thuộc
   * những dự án nào" và "người NÀY vừa làm gì", nên hai người dùng là hai lượt
   * đọc tách biệt và làm mất hiệu lực một người không đụng người kia.
   */
  user: {
    activity: createQueryKeyFactory(userActivityRoot, (userId: string) => [...userActivityRoot, userId] as const),
    current: createQueryKeyFactory(userCurrentRoot, () => userCurrentRoot),
    list: createQueryKeyFactory(userListRoot, () => userListRoot),
    memberships: createQueryKeyFactory(userMembershipsRoot, (userId: string) => [
      ...userMembershipsRoot,
      userId,
    ] as const),
  },
  version: {
    byFloor: createQueryKeyFactory(versionByFloorRoot, (floorId: string) => [
      ...versionByFloorRoot,
      floorId,
    ] as const),
  },
  violation: {
    byProject: createQueryKeyFactory(violationByProjectRoot, (projectId: string) => [
      ...violationByProjectRoot,
      projectId,
    ] as const),
  },
} as const;

/**
 * Khoá của danh sách phép đo đã ghim trong một dự án — LG-3 ("lưu số đo kèm
 * dự án làm hồ sơ").
 *
 * Xuất RIÊNG thay vì lồng vào `queryKeys` phía trên: hợp đồng màn đo
 * (CONTRACT.md mục 3, LG-3) chốt đúng chữ ký phẳng `measurementKeys.all(...)`
 * cho `src/lib/mutations` tiêu thụ, và phép đo là thực thể MỚI — không có
 * lượt đọc nào khác của nó cần lồng chung gốc với một nhánh có sẵn. Dùng
 * cùng `createQueryKeyFactory` mà mọi nhánh trong `queryKeys` dùng, nên khoá
 * vẫn đông lạnh và có `root()` cho việc làm mất hiệu lực theo tiền tố.
 */
export const measurementKeys = {
  all: createQueryKeyFactory(measurementAllRoot, (projectId: string) => [
    ...measurementAllRoot,
    projectId,
  ] as const),
};
