/**
 * Sáu bước của một dự án, theo đúng thứ tự người dùng đi: tải bản vẽ → xử lý
 * → duyệt tầng → mô hình 3D → quy chuẩn → xuất. Header chung đọc bảng này để
 * vẽ thanh bước và nút "Bước tiếp theo" ở mọi màn `/projects/:projectId/*`.
 *
 * Chỉ nhập `./paths` (file không nhập gì), nên không vòng nào đi qua đây.
 */
import { ROUTES } from './paths';

export interface ProjectStep {
  readonly id: 'upload' | 'pipeline' | 'floors' | 'viewer' | 'rules' | 'export';
  readonly label: string;
  readonly path: (projectId: string) => string;
  /** Đoạn đường sau `/projects/:projectId/` thuộc về bước này. */
  readonly segments: readonly string[];
}

export const PROJECT_STEPS: readonly ProjectStep[] = [
  { id: 'upload', label: 'Tải bản vẽ', path: ROUTES.project.upload, segments: ['upload', 'drawing-sets'] },
  { id: 'pipeline', label: 'Xử lý', path: ROUTES.project.pipeline, segments: ['pipeline'] },
  { id: 'floors', label: 'Duyệt tầng', path: ROUTES.project.floors, segments: ['floors'] },
  { id: 'viewer', label: 'Mô hình 3D', path: ROUTES.project.viewer, segments: ['3d'] },
  { id: 'rules', label: 'Quy chuẩn', path: ROUTES.project.rules, segments: ['rules'] },
  { id: 'export', label: 'Xuất', path: ROUTES.project.export, segments: ['export'] },
];

/**
 * Màn của dự án nằm ngoài sáu bước (lịch sử phiên bản, dữ liệu, cài đặt):
 * thanh bước không sáng ô nào. Màn phụ của một bước (chất lượng ảnh, sơ đồ xử lý,
 * xác nhận CAD) sáng ô bước đó, xem {@link projectLocationOf}. Đường nào không
 * thuộc bước lẫn danh sách này là trang 404, header không vẽ thanh bước.
 */
const OFF_STEP_SEGMENTS: readonly string[] = ['versions', 'data', 'settings'];

/** Thứ tự duyệt các lớp của một tầng trong bước 3 (cùng thứ tự dải thẻ lớp trên màn). */
export type FloorLayerKey = 'walls' | 'objects' | 'rooms' | 'dimensions' | 'grids' | 'thickness';

/** Nguồn duy nhất cho tên và thứ tự lớp duyệt; `screens/qc/shared/qcLayers.ts` dựng thanh lớp từ đây. */
/** `title` = tên màn (tiêu đề tab, khớp H1 của màn). */
export const FLOOR_LAYERS: readonly { readonly key: FloorLayerKey; readonly label: string; readonly title: string; readonly path: (projectId: string, floorId: string) => string }[] = [
  { key: 'walls', label: 'Tường', title: 'Duyệt tường', path: ROUTES.project.walls },
  { key: 'objects', label: 'Cửa và nội thất', title: 'Duyệt cửa và nội thất', path: ROUTES.project.objects },
  { key: 'rooms', label: 'Phòng', title: 'Duyệt phòng', path: ROUTES.project.rooms },
  { key: 'dimensions', label: 'Kích thước', title: 'Kích thước', path: ROUTES.project.dimensions },
  { key: 'grids', label: 'Trục', title: 'Trục và gốc toạ độ', path: ROUTES.project.grids },
  { key: 'thickness', label: 'Độ dày tường', title: 'Độ dày tường', path: ROUTES.project.thickness },
];
const FLOOR_LAYER_SEGMENTS: readonly string[] = FLOOR_LAYERS.map((layer) => layer.key);

export interface ProjectLocation {
  readonly projectId: string;
  /** -1 khi đang ở màn của dự án nhưng ngoài sáu bước (ví dụ cài đặt). */
  readonly stepIndex: number;
  /** Tầng đang mở trong bước 3 (`/floors/:floorId/...`), nếu có. */
  readonly floorId?: string;
  /** Chỉ số trong {@link FLOOR_LAYERS} khi đang ở một lớp của tầng; -1 khi không. */
  readonly layerIndex?: number;
}

/** `/projects/p1/floors/f1/layers/walls` → `{ projectId: 'p1', stepIndex: 2, floorId: 'f1', layerIndex: 0 }`; ngoài dự án hoặc 404 → null. */
export function projectLocationOf(pathname: string): ProjectLocation | null {
  const match = /^\/projects\/([^/]+)(?:\/([^/]+))?(?:\/([^/]+))?(?:\/([^/]+))?(?:\/([^/]+))?/.exec(pathname);
  if (match?.[1] === undefined) return null;
  const projectId = decodeURIComponent(match[1]);
  const segment = match[2] ?? '';
  // Màn phụ sáng ô bước của nó: chất lượng ảnh → bước 1.
  if (segment === 'quality') return { projectId, stepIndex: 0 };
  const stepIndex = PROJECT_STEPS.findIndex((step) => step.segments.includes(segment));
  if (stepIndex === -1) return OFF_STEP_SEGMENTS.includes(segment) ? { projectId, stepIndex } : null;
  if (segment !== 'floors' || match[3] === undefined) return { projectId, stepIndex };
  const floorId = decodeURIComponent(match[3]);
  const layerIndex = match[4] === 'layers' ? FLOOR_LAYER_SEGMENTS.indexOf(match[5] ?? '') : -1;
  return { projectId, stepIndex, floorId, layerIndex };
}

/**
 * Bốn màn duyệt tầng dạng trình biên tập (tỷ lệ, tường, cửa và nội thất, phòng): không vẽ header chung,
 * màn tự mang menu tệp + chip bước (`components/shell/EditorChrome.tsx`). Trục, kích thước,
 * độ dày, so với bản vẽ vẫn giữ header vì FlowGate của chúng cần khe trong thanh bước.
 */
export function isFloorEditorPath(pathname: string): boolean {
  return /^\/projects\/[^/]+\/floors\/[^/]+\/(?:scale|layers\/(?:walls|objects|rooms))\/?$/.test(pathname);
}

/** Trạng thái một bước trên thanh bước: xong (dấu tích), còn việc (chấm attention), chưa tới. */
export type ProjectStepState = 'done' | 'attention' | 'todo';

const STEP_STATE_TEXT: Readonly<Record<ProjectStepState, string>> = {
  done: 'đã xong',
  attention: 'còn việc',
  todo: 'chưa xong',
};

/**
 * Chữ trạng thái của một bước cho trình đọc màn hình. Bước đang đứng là "đang mở"; còn lại chỉ nói điều
 * dữ liệu xác nhận. Không suy "đã qua" từ vị trí URL: dán thẳng /export không có nghĩa bước 3–5 đã làm (UX-19).
 */
export function stepStateText(state: ProjectStepState, index: number, currentIndex: number): string {
  if (state !== 'todo') return STEP_STATE_TEXT[state];
  return index === currentIndex ? 'đang mở' : STEP_STATE_TEXT.todo;
}

/** Đích của ô bước `index`: bước 3 về lớp đầu của tầng đang mở, hoặc màn tầng gần nhất, hoặc danh sách tầng. */
export function stepPath(
  project: { readonly id: string; readonly floorId?: string | undefined; readonly lastFloorPath?: string | undefined },
  index: number,
): string {
  if (index === 2 && project.floorId !== undefined) return FLOOR_LAYERS[0]?.path(project.id, project.floorId) ?? ROUTES.project.floors(project.id);
  if (index === 2 && project.lastFloorPath !== undefined) return project.lastFloorPath;
  return PROJECT_STEPS[index]?.path(project.id) ?? ROUTES.dashboard;
}

/**
 * Trạng thái sáu bước suy từ #24 (đã có ở header, không gọi thêm API). Chỉ khẳng định
 * điều dữ liệu cho biết chắc: có bản vẽ → bước 1 xong; có tầng đã xử lý (`areaM2`)
 * → bước 2 xong; dự án đã duyệt → bốn bước đầu xong; xử lý lỗi hoặc đang chạy →
 * bước 2 còn việc. Chưa biết thì để "chưa tới", không đoán "xong".
 */
export function projectStepStates(input: {
  readonly status?: string | undefined;
  readonly hasDrawings?: boolean | undefined;
  /** Có tầng đã ra kết quả xử lý (#24 không gửi `progress`; `areaM2` của tầng chỉ có sau khi AI dựng xong). */
  readonly hasProcessedFloor?: boolean | undefined;
  /** Mọi tầng có bản vẽ đều đã ra kết quả (có diện tích). Tầng trống làm "Duyệt tầng" chưa xong dù dự án đã duyệt (U11). */
  readonly everyDrawnFloorProcessed?: boolean | undefined;
}): readonly ProjectStepState[] {
  const approved = input.status === 'approved';
  return PROJECT_STEPS.map((step): ProjectStepState => {
    if (step.id === 'upload') return input.hasDrawings === true ? 'done' : input.hasDrawings === false ? 'attention' : 'todo';
    if (step.id === 'pipeline') {
      if (input.status === 'error' || input.status === 'processing') return 'attention';
      return approved || input.hasProcessedFloor === true ? 'done' : 'todo';
    }
    if (step.id === 'floors' || step.id === 'viewer') {
      if (!approved) return 'todo';
      return input.everyDrawnFloorProcessed === false ? 'attention' : 'done';
    }
    return 'todo';
  });
}

/** Tên màn ngoài sáu bước, theo đoạn đường sau `/projects/:projectId/`. */
const OFF_STEP_TITLES: Readonly<Record<string, string>> = {
  quality: 'Chất lượng ảnh đầu vào',
  versions: 'Lịch sử phiên bản',
  data: 'Dữ liệu dự án',
  settings: 'Cài đặt dự án',
};

/** Tên màn cho tiêu đề tab: lớp đang duyệt, màn phụ, hoặc tên bước; ngoài dự án → null. */
export function projectScreenTitleOf(pathname: string): string | null {
  const location = projectLocationOf(pathname);
  if (location === null) return null;
  if (/\/pipeline\/graph\/?$/.test(pathname)) return 'Sơ đồ xử lý';
  const segment = /^\/projects\/[^/]+\/([^/]+)/.exec(pathname)?.[1] ?? '';
  const offStepTitle = OFF_STEP_TITLES[segment];
  if (offStepTitle !== undefined) return offStepTitle;
  const layer = location.layerIndex !== undefined && location.layerIndex >= 0 ? FLOOR_LAYERS[location.layerIndex] : undefined;
  if (layer !== undefined) return layer.title;
  if (location.floorId !== undefined) {
    if (pathname.endsWith('/scale')) return 'Tỷ lệ bản vẽ';
    if (pathname.endsWith('/overlay')) return 'So với bản vẽ';
  }
  return PROJECT_STEPS[location.stepIndex]?.label ?? null;
}
