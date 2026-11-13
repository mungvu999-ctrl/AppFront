/**
 * Logic của VỎ CHUNG chín màn 3D — nối lại thứ đã có, không tự chế công thức
 * (R-61).
 *
 * Hook này là NGƯỜI GỌI ĐẦU TIÊN của `src/lib/three/camera`. Cả bốn file ở đó
 * (`modes`, `presets`, `frameObjects`, `settings`) đã có test đầy đủ và tính
 * vào ngưỡng độ phủ 80% của `src/lib`, nhưng `rg -ln "CAMERA_PRESETS|
 * switchCameraMode|frameViewpoint" src` trước lượt này chỉ ra chính chúng —
 * đúng thứ CLAUDE.md gọi là "tầng logic đã hoàn thành theo kế hoạch, chưa màn
 * nào gọi tới vì chưa có màn thật nào được dựng". Vỏ này cắm vào, không dựng
 * lại (R-64).
 *
 * | Việc | Hàm đã có | Ở đâu |
 * |---|---|---|
 * | quán tính, giảm chấn 0,08 | `CAMERA_SETTINGS.orbit.damping` | `camera/settings.ts:288` |
 * | quay, kéo màn, thu phóng | `OrbitCameraMode.rotate/pan/dolly` | `camera/modes.ts` |
 * | đổi chế độ, giữ nguyên điểm nhìn | `switchCameraMode` | `camera/modes.ts:1020` |
 * | bay 340 ms có gia tốc | `CameraDirector.goTo` | `camera/presets.ts:418` |
 * | khuôn đối tượng, chừa 15% | `CameraDirector.frameObjects` | `camera/presets.ts` |
 * | góc trục đo | `DEFAULT_CAMERA_RIG` + `restingHeading` | `present/director.ts:54,86` |
 * | chuyển 2D↔3D | `useSceneTransition` | `hooks/useSceneTransition.ts:66` |
 * | so le theo tầng | `staggerDelaysMs` | `lib/motion/stagger.ts:88` |
 * | vai Người xem | `can('edit', 'layer', …)` | `lib/auth/permissions.ts:127` |
 * | định dạng số | `formatArea`, `formatNumber`, `formatLength` | `lib/format/**` |
 *
 * ## Ba chỗ đặc tả nói khác luật, và vỏ theo luật
 *
 * LUAT_MAN_HINH.md xếp prompt SAU luật, và bắt báo lại chứ không im lặng chọn
 * bên. Ba chỗ đó:
 *
 * 1. **Đùn khối 2D→3D: 340 ms, không phải 700 ms.** `MOTION_DURATIONS_MS`
 *    (`lib/motion/tokens.ts:62`) chỉ có bốn giá trị 120/180/260/340, và 700 là
 *    `AMBIENT_LOOP_MS` với chú thích ngay tại chỗ: nó dành cho thứ LẶP, không
 *    cho thứ chuyển từ trạng thái này sang trạng thái kia. Handover 2D↔3D đã
 *    được khai sẵn ở `SCENE_TIMINGS.view = { total: 'slow' }` = 340 ms, và
 *    `PRESET_SETTINGS.transitionMs` cũng đọc đúng ô đó. Viết 700 vào màn sẽ
 *    làm `local/no-raw-duration` đỏ.
 * 2. **So le theo tầng: 24 ms, không phải 60 ms.** `STAGGER_STEP_MS`
 *    (`lib/motion/stagger.ts:49`) là nguồn duy nhất, và chú thích của nó nói
 *    rõ vì sao không lớn hơn.
 * 3. **"Dừng lại trong khoảng 400 ms" không phải một hằng số.** Nó là HỆ QUẢ
 *    của `damping = 0,08` ở 60 Hz. Vỏ không viết 400 ở đâu cả; nó để
 *    `OrbitCameraMode.update` giảm chấn và dừng khi `update` trả về `false`.
 *
 * ## Vì sao `E` nhớ độ tách cũ
 *
 * `E` là phím BẬT TẮT, nên tắt rồi bật lại phải trả về đúng chỗ người dùng đã
 * kéo tới, không nhảy về mặc định. {@link SEPARATION_STEP} chỉ dùng khi chưa
 * ai kéo thanh trượt lần nào.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Vector3 } from 'three';

import { resolveUseMockApi } from '@/api/appClient';
import { useBreakpoint } from '@/hooks/useAppShell';
import { useReducedMotion } from '@/hooks/useReducedMotion';
import { useSceneTransition } from '@/hooks/useSceneTransition';
import { can } from '@/lib/auth/permissions';
import { formatArea, formatLength } from '@/lib/format/measure';
import { formatNumber, formatPercent } from '@/lib/format/number';
import {
  appShortcutRegistry,
  type ShortcutRegistry,
} from '@/lib/input/shortcutRegistry';
import { queryKeys } from '@/lib/query/queryKeys';
import { millimetres } from '@/domain/units/types';
import { displayLabelIn, type NormalizedSpatial } from '@/domain/spatial/normalize';
import {
  CameraDirector,
  isFlatMode,
  PRESET_SETTINGS,
  presetById,
  presetViewpoint,
  type CameraPresetId,
} from '@/lib/three/camera/presets';
import { boxOfExtent, frameViewpoint } from '@/lib/three/camera/frameObjects';
import {
  createCameraMode,
  FlatCameraMode,
  OrbitCameraMode,
  type BuildingExtent,
  type CameraMode,
  type Viewpoint,
} from '@/lib/three/camera/modes';
import { DEFAULT_CAMERA_RIG, restingHeading } from '@/lib/three/present/director';
import { toSceneLength } from '@/lib/three/build/scene';
import { measureTextOfState, scaleStateOf, totalMeasureTextOf, type ScaleState } from '@/lib/viewmodel/provisionalScale';
import { useStore } from '@/store';
import type { ProjectRole } from '@/types/project';

import {
  createViewerShellFixtureGateway,
  createViewerShellGateway,
  footprintOf,
  shellDataOf,
  type ViewerShellData,
  type ViewerShellGateway,
} from './viewerShellGateway';
import {
  buildDeselectShortcut,
  buildViewerShortcuts,
  FRAME_COMBO,
  HIDE_COMBO,
  ISOLATE_COMBO,
  MEASURE_COMBO,
  ORTHOGRAPHIC_COMBO,
  TOOL_COMBOS,
  type ViewerShortcutHandlers,
} from './viewerShellShortcuts';
import {
  clampSeparation,
  storeyInlineName,
  stackedHeightMm,
  stackStoreys,
  type StackableStorey,
} from './viewerStoreyStack';
import {
  clampSectionPosition,
  DEFAULT_SECTION_AXIS,
  DEFAULT_SECTION_POSITION,
  sectionPlaneFor,
  type ViewerBoundsM,
} from './viewerSectionPlane';
import type {
  ViewerLegendItem,
  ViewerPointPx,
  ViewerPresetId,
  ViewerPresetViewModel,
  ViewerPropertyRow,
  ViewerScreenState,
  ViewerSectionPlaneValue,
  ViewerSelectionViewModel,
  ViewerShellProps,
  ViewerStoreyViewModel,
  ViewerToolId,
  ViewerToolViewModel,
} from './viewerShellTypes';

/* -------------------------------------------------------------------------- */
/* Hằng số của vỏ.                                                             */
/* -------------------------------------------------------------------------- */

/** Độ tách phím `E` nhảy tới khi chưa ai kéo thanh trượt lần nào. */
export const SEPARATION_STEP = 0.5;

/** Mỗi nấc cuộn chuột đổi bao nhiêu "nấc" của `OrbitCameraMode.dolly`. */
const DOLLY_NOTCH = 1;

/** Bước một lần bấm `+` / `−` của cụm thu phóng, theo nấc dolly. */
const ZOOM_BUTTON_NOTCHES = 2;

/**
 * Chữ trên nút ray tầng: tên tầng bỏ chữ "Tầng " đứng đầu — "Tầng trệt" → "Trệt",
 * "Tầng 02" → "02". Nút chỉ rộng 40 px nên không vẽ đủ tên; tên đủ vẫn ở
 * `aria-label`. Từng là `storey.id`, nên mọi đồ thị lộ mã máy lên nút (Q8).
 */
export function storeyShortLabel(name: string): string {
  const short = name.replace(/^Tầng\s+/u, '');

  return short === '' ? name : short.charAt(0).toLocaleUpperCase('vi') + short.slice(1);
}

/** Mốc `md` của Tailwind — từ đây hai ray đứng dọc. */
const MD_UP_QUERY = '(min-width: 768px)';

/**
 * Sáu công cụ của ray trái, kèm phím của chúng. Không công cụ nào sửa mô hình — đo
 * cũng chỉ đọc — nên vai Người xem có đủ sáu (B-V9-04).
 */
const VIEWER_TOOLS: readonly ViewerToolViewModel[] = Object.freeze([
  { id: 'orbit', label: 'Quay quanh mô hình', keyLabel: TOOL_COMBOS.orbit },
  { id: 'pan', label: 'Kéo màn', keyLabel: TOOL_COMBOS.pan },
  { id: 'measure', label: 'Đo', keyLabel: TOOL_COMBOS.measure },
  { id: 'section', label: 'Mặt cắt', keyLabel: TOOL_COMBOS.section },
  { id: 'select', label: 'Chọn', keyLabel: TOOL_COMBOS.select },
  { id: 'isolate', label: 'Cô lập', keyLabel: ISOLATE_COMBO },
]);

/** Bốn góc nhìn của `Select` trên thanh trên. */
const VIEWER_PRESETS: readonly ViewerPresetViewModel[] = Object.freeze([
  { id: 'perspective', label: 'Phối cảnh' },
  { id: 'axonometric', label: 'Trục đo' },
  { id: 'top', label: 'Trên xuống' },
  { id: 'section', label: 'Mặt cắt' },
]);

/**
 * Chú giải góc trái dưới.
 *
 * `colorToken` là TÊN BIẾN CSS, không phải mã màu (A1). Ba độ dày tường cộng
 * ô cửa: đúng những gì một khung nhìn 3D của sản phẩm này phân biệt bằng màu.
 */
const VIEWER_LEGEND: readonly ViewerLegendItem[] = Object.freeze([
  { id: 'wall-110', label: 'Tường 110', colorToken: '--wall-110' },
  { id: 'wall-220', label: 'Tường 220', colorToken: '--wall-220' },
  { id: 'wall-330', label: 'Tường 330', colorToken: '--wall-330' },
  { id: 'opening', label: 'Ô mở', colorToken: '--accent' },
]);

/** Câu dạy của panel phải khi chưa chọn gì — đúng chữ đặc tả yêu cầu. */
export const INSPECTOR_HINT = 'Chọn một đối tượng trên mô hình để xem thuộc tính.';

/**
 * Chữ trên thanh trạng thái lúc mô hình đang dựng. Xuất ra cho màn nội dung tự
 * dựng cảnh (màn đo) nói đúng câu này khi nó đang dựng mà vỏ đã xong (NO-388).
 */
export const BUILDING_MESSAGE = 'Đang dựng mô hình…';

/** Chữ trên thanh trạng thái khi mô hình đã dựng xong. */
const READY_MESSAGE = 'Mô hình đã dựng xong.';

/** Câu lỗi khi không dựng được mô hình. */
const ERROR_MESSAGE =
  'Không dựng được mô hình từ dữ liệu của dự án này. Thử lại, hoặc mở lại lớp tường để xem dữ liệu còn thiếu gì.';

/* -------------------------------------------------------------------------- */
/* Tuỳ chọn.                                                                   */
/* -------------------------------------------------------------------------- */

export interface UseViewerShellOptions {
  readonly projectId: string;
  /** Vai của người đang xem. Thiếu thì coi như chỉ xem được. */
  readonly roles?: readonly ProjectRole[];
  /** Cổng dữ liệu tiêm được. Vắng mặt thì dùng cổng bộ mẫu. */
  readonly gateway?: ViewerShellGateway;
  /** Đồ thị tiêm được. Vắng mặt thì đọc kho. */
  readonly spatial?: NormalizedSpatial | null;
  /** Ép một trạng thái — cho story và bài kiểm bảy trạng thái. */
  readonly forceState?: ViewerScreenState;
  /** Cờ nhà phát triển; quyết định chip hiệu năng có hiện không. */
  readonly isDev?: boolean;
  /** Số đo hiệu năng tiêm được; vắng mặt thì chưa có phép đo nào. */
  readonly perf?: { readonly frameRate: number; readonly triangles: number } | null;
  /** Cảnh 3D của màn nội dung. */
  readonly renderScene?: (
    frame: ViewerShellProps['frame'],
    actions: ViewerShellProps['sceneActions'],
  ) => React.ReactNode;
  /** Sổ đăng ký phím tiêm được — bài kiểm dùng sổ của riêng nó. */
  readonly registry?: ShortcutRegistry;
  /** Mở ô tìm đối tượng. Vỏ không tự dựng hộp thoại nào đè lên khung nhìn. */
  readonly onOpenSearch?: () => void;
  /** Cảnh của màn không tách tầng (màn đo đo trên cao độ thật): khoá thanh "Độ tách" và phím E (BUG-656). */
  readonly separationDisabled?: boolean;
}

/* -------------------------------------------------------------------------- */
/* Hình học của mô hình.                                                       */
/* -------------------------------------------------------------------------- */

/** Không có gì để nhìn — hộp bao suy biến, dùng khi đồ thị rỗng. */
const UNIT_EXTENT: BuildingExtent = {
  centre: new Vector3(0, 0, 0),
  sizeM: new Vector3(1, 1, 1),
};

/**
 * Hộp bao của mô hình, theo MÉT và theo trục của cảnh.
 *
 * `scene.ts` khai trục đúng một lần: bản vẽ `x → x`, cao độ `→ y`, bản vẽ
 * `y → z`. Hàm này theo đúng khai báo ấy thay vì tự chọn lại, nên hộp bao của
 * vỏ và hình mà màn nội dung dựng không thể lệch trục nhau.
 */
function extentOf(data: ViewerShellData, footprintMm: {
  readonly minXMm: number;
  readonly minYMm: number;
  readonly maxXMm: number;
  readonly maxYMm: number;
}, separation: number): BuildingExtent {
  const storeys: readonly StackableStorey[] = data.storeys.map((storey) => ({
    id: storey.id,
    order: storey.order,
    elevationMm: storey.elevationMm,
    heightMm: storey.heightMm,
  }));

  const heightMm = stackedHeightMm(storeys, separation);
  const widthMm = footprintMm.maxXMm - footprintMm.minXMm;
  const depthMm = footprintMm.maxYMm - footprintMm.minYMm;

  if (widthMm <= 0 || depthMm <= 0 || heightMm <= 0) {
    return UNIT_EXTENT;
  }

  return {
    centre: new Vector3(
      toSceneLength(millimetres((footprintMm.minXMm + footprintMm.maxXMm) / 2)),
      toSceneLength(millimetres(heightMm / 2)),
      toSceneLength(millimetres((footprintMm.minYMm + footprintMm.maxYMm) / 2)),
    ),
    sizeM: new Vector3(
      toSceneLength(millimetres(widthMm)),
      toSceneLength(millimetres(heightMm)),
      toSceneLength(millimetres(depthMm)),
    ),
  };
}

/**
 * Hộp bao của MỘT tầng, theo mét — bản một-tầng của {@link extentOf}.
 *
 * Mặt bằng mượn của cả toà nhà (một tầng không có mặt bằng riêng); chiều đứng
 * lấy từ cao độ ĐÃ TÁCH của {@link stackStoreys} tới cao độ đó cộng chiều cao
 * tầng — tầng đang tách thì khuôn vào chỗ nó ĐANG đứng, không phải chỗ nó đứng
 * khi chưa tách. `null` khi không có tầng nào mang đúng mã này.
 */
function extentOfStorey(
  data: ViewerShellData,
  footprintMm: {
    readonly minXMm: number;
    readonly minYMm: number;
    readonly maxXMm: number;
    readonly maxYMm: number;
  },
  storeyId: string,
  separation: number,
): BuildingExtent | null {
  const storey = data.storeys.find((each) => each.id === storeyId);

  if (storey === undefined) {
    return null;
  }

  const storeys: readonly StackableStorey[] = data.storeys.map((each) => ({
    id: each.id,
    order: each.order,
    elevationMm: each.elevationMm,
    heightMm: each.heightMm,
  }));

  const stacked = stackStoreys(storeys, separation).find((each) => each.id === storeyId);

  if (stacked === undefined) {
    return null;
  }

  const widthMm = footprintMm.maxXMm - footprintMm.minXMm;
  const depthMm = footprintMm.maxYMm - footprintMm.minYMm;

  if (widthMm <= 0 || depthMm <= 0 || storey.heightMm <= 0) {
    return UNIT_EXTENT;
  }

  const heightM = toSceneLength(millimetres(storey.heightMm));

  return {
    centre: new Vector3(
      toSceneLength(millimetres((footprintMm.minXMm + footprintMm.maxXMm) / 2)),
      stacked.offsetM + heightM / 2,
      toSceneLength(millimetres((footprintMm.minYMm + footprintMm.maxYMm) / 2)),
    ),
    sizeM: new Vector3(
      toSceneLength(millimetres(widthMm)),
      heightM,
      toSceneLength(millimetres(depthMm)),
    ),
  };
}

/** Hộp bao ấy, viết lại theo sáu mặt để `sectionPlaneFor` dùng. */
function boundsOf(extent: BuildingExtent): ViewerBoundsM {
  return {
    minX: extent.centre.x - extent.sizeM.x / 2,
    minY: extent.centre.y - extent.sizeM.y / 2,
    minZ: extent.centre.z - extent.sizeM.z / 2,
    maxX: extent.centre.x + extent.sizeM.x / 2,
    maxY: extent.centre.y + extent.sizeM.y / 2,
    maxZ: extent.centre.z + extent.sizeM.z / 2,
  };
}

/** Góc chúc xuống của giàn trục đo: `DEFAULT_CAMERA_RIG` đo TỪ đường chân trời. */
const AXONOMETRIC_POLAR_RAD = Math.PI / 2 - DEFAULT_CAMERA_RIG.elevationRad;

/** Góc nhìn nào của vỏ chạy ở chế độ camera nào. */
const MODE_BY_PRESET: Readonly<Record<ViewerPresetId, CameraMode>> = Object.freeze({
  perspective: 'orbit',
  axonometric: 'top',
  top: 'top',
  section: 'top',
});

/** Preset thư viện tương ứng, cho hai góc nhìn mượn thẳng được. */
const LIBRARY_PRESET: Readonly<Partial<Record<ViewerPresetId, CameraPresetId>>> = Object.freeze({
  perspective: 'perspective',
  top: 'top',
});

/** Mock → nhà mẫu; ngược lại → đọc kho. */
export function defaultViewerShellGateway(useMock: boolean): ViewerShellGateway {
  return useMock
    ? createViewerShellFixtureGateway()
    : createViewerShellGateway(() => useStore.getState().spatial);
}

/**
 * Điểm nhìn của một góc nhìn vỏ.
 *
 * Hai góc mượn thẳng `presetViewpoint` của thư viện. Hai góc còn lại
 * (`axonometric`, `section`) dựng từ `DEFAULT_CAMERA_RIG` — giàn trục đo đã
 * tinh chỉnh của `present/director.ts`, chứ không phải hai con số góc gõ tay
 * trong màn (R-71).
 */
function viewpointForPreset(
  preset: ViewerPresetId,
  extent: BuildingExtent,
  aspect: number,
): Viewpoint {
  const library = LIBRARY_PRESET[preset];

  if (library !== undefined) {
    return presetViewpoint(presetById(library), extent, aspect);
  }

  return {
    target: extent.centre.clone(),
    azimuthRad: restingHeading(DEFAULT_CAMERA_RIG),
    polarRad: AXONOMETRIC_POLAR_RAD,
    distanceM: Math.max(extent.sizeM.x, extent.sizeM.y, extent.sizeM.z) * DEFAULT_CAMERA_RIG.margin,
  };
}

/* -------------------------------------------------------------------------- */
/* Hook.                                                                       */
/* -------------------------------------------------------------------------- */

export function useViewerShell(options: UseViewerShellOptions): ViewerShellProps {
  const {
    projectId,
    roles,
    forceState,
    isDev = false,
    perf = null,
    renderScene,
    registry = appShortcutRegistry,
    onOpenSearch,
    separationDisabled = false,
  } = options;

  const reducedMotion = useReducedMotion();
  // Dưới `md` hai ray nằm ngang (`ViewerToolRail`, `ViewerStoreyRail`): khai đúng hướng ấy.
  const isMdUp = useBreakpoint(MD_UP_QUERY);

  /* ---- Dữ liệu ---------------------------------------------------------- */

  const gateway = useMemo(
    () => options.gateway ?? defaultViewerShellGateway(resolveUseMockApi()),
    [options.gateway],
  );

  const storeSpatial = useStore((state) => state.spatial);
  const spatialLoading = useStore((state) => state.spatialLoading);
  const spatial = options.spatial !== undefined ? options.spatial : storeSpatial;

  const projectQuery = useQuery({
    queryKey: projectNameQueryKey(projectId),
    queryFn: (): Promise<string | null> => gateway.readProjectName(projectId),
  });

  const data = useMemo<ViewerShellData>(
    () => (options.spatial !== undefined ? shellDataOf(spatial) : gateway.readShellData()),
    [gateway, options.spatial, spatial],
  );

  const footprint = useMemo(() => footprintOf(spatial), [spatial]);

  /* ---- Trạng thái người dùng lái ---------------------------------------- */

  const [activeToolId, setActiveToolId] = useState<ViewerToolId>('orbit');
  const [activePresetId, setActivePresetId] = useState<ViewerPresetId>('perspective');
  const [viewMode, setViewMode] = useState<'2d' | '3d'>('3d');
  const [activeStoreyIds, setActiveStoreyIds] = useState<readonly string[]>([]);
  const [hiddenStoreyIds, setHiddenStoreyIds] = useState<readonly string[]>([]);
  const [separation, setSeparation] = useState(0);
  const [rememberedSeparation, setRememberedSeparation] = useState(SEPARATION_STEP);
  const [sectionPosition, setSectionPositionState] = useState(DEFAULT_SECTION_POSITION);
  const [hiddenEntityIds, setHiddenEntityIds] = useState<readonly string[]>([]);
  const [isolatedEntityIds, setIsolatedEntityIds] = useState<readonly string[] | null>(null);
  const [hoverPointPx, setHoverPointPx] = useState<ViewerPointPx | null>(null);
  const [isOrthographic, setIsOrthographic] = useState(false);

  const floorMeta = useStore((state) => state.floorMeta);
  /* R10 làn S: diện tích, độ dày và tổng ở đây đều suy từ tỷ lệ — mang trạng thái từng tầng theo. */
  const scaleStateOfLevel = useCallback(
    (levelId: string | undefined): ScaleState | undefined => {
      if (levelId === undefined) return undefined;
      const meta = floorMeta[levelId];
      if (meta === undefined || (meta.scaleStatus === undefined && meta.scaleState === undefined)) return undefined;
      return scaleStateOf(meta.scaleStatus, meta.scaleSource, meta.scaleState);
    },
    [floorMeta],
  );
  const selectedIds = useStore((state) => state.selectedIds);
  const hoveredId = useStore((state) => state.hoveredId);
  const setSelection = useStore((state) => state.setSelection);
  const clearSelection = useStore((state) => state.clearSelection);
  const setHovered = useStore((state) => state.setHovered);

  /* ---- Camera ------------------------------------------------------------ */

  const extent = useMemo(
    () => extentOf(data, footprint, separation),
    [data, footprint, separation],
  );

  const directorRef = useRef<CameraDirector | null>(null);
  const [cameraTick, setCameraTick] = useState(0);
  const bumpCamera = useCallback((): void => {
    setCameraTick((tick) => tick + 1);
  }, []);

  /* Hộp của MÔ HÌNH (không tính độ tách): đổi thì dựng lại camera đúng khuôn.
     Lượt render đầu còn đồ thị rỗng (đang nạp) nên hộp là UNIT_EXTENT; camera dựng
     một lần từ hộp ấy thì giới hạn khoảng cách của chế độ orbit kẹp nó sát mô hình
     thật — mở màn ở 511–723 % (BUG-582, E2-B1). Kéo độ tách không đổi khoá này. */
  const modelExtent = extentOf(data, footprint, 0);
  const modelKey = [...modelExtent.centre.toArray(), ...modelExtent.sizeM.toArray()].join(',');
  const framedKeyRef = useRef<string | null>(null);

  if (directorRef.current === null || framedKeyRef.current !== modelKey) {
    framedKeyRef.current = modelKey;
    const mode = MODE_BY_PRESET[activePresetId];
    const initial = viewpointForPreset(activePresetId, extent, PRESET_SETTINGS.defaultAspect);
    directorRef.current = new CameraDirector(
      createCameraMode(mode, initial, { extent }),
      { extent },
      { reducedMotion },
    );
  }

  const director = directorRef.current;

  useEffect(() => {
    director.setReducedMotion(reducedMotion);
  }, [director, reducedMotion]);

  /**
   * Vòng cập nhật theo nhu cầu.
   *
   * Chỉ chạy khi có gì đó còn đang chuyển động: `update` trả về `false` là
   * camera đã đứng yên và vòng dừng hẳn. Đây là chỗ quán tính "dừng lại trong
   * khoảng 400 ms" xảy ra — bằng giảm chấn 0,08 của `CAMERA_SETTINGS`, không
   * bằng một con số 400 viết ở đâu đó.
   */
  const [isSettling, setIsSettling] = useState(false);

  useEffect(() => {
    if (!isSettling || typeof requestAnimationFrame !== 'function') {
      return undefined;
    }

    let frame = 0;
    let previousMs = 0;
    let cancelled = false;

    const step = (nowMs: number): void => {
      if (cancelled) {
        return;
      }

      const dtSeconds = previousMs === 0 ? 0 : (nowMs - previousMs) / 1_000;
      previousMs = nowMs;

      const moved = director.update(dtSeconds);
      bumpCamera();

      if (moved) {
        frame = requestAnimationFrame(step);
      } else {
        setIsSettling(false);
      }
    };

    frame = requestAnimationFrame(step);

    return (): void => {
      cancelled = true;
      cancelAnimationFrame(frame);
    };
  }, [isSettling, director, bumpCamera]);

  /**
   * Đánh thức vòng cập nhật.
   *
   * Giảm chuyển động thì KHÔNG có quán tính: camera ngồi thẳng vào đích trên
   * chính lần bấm đó, đúng câu "tắt quán tính quay" của đặc tả.
   */
  const wake = useCallback((): void => {
    if (reducedMotion) {
      director.controller.settle();
      bumpCamera();
      return;
    }

    setIsSettling(true);
  }, [director, reducedMotion, bumpCamera]);

  /* ---- Chuyển 2D ↔ 3D ---------------------------------------------------- */

  const sceneTransition = useSceneTransition(viewMode, { kind: 'view' });

  /* ---- Quyền ------------------------------------------------------------- */

  const canEdit = can('edit', 'layer', roles === undefined ? {} : { roles });

  const state: ViewerScreenState = useMemo(() => {
    if (forceState !== undefined) {
      return forceState;
    }

    if (!canEdit && roles !== undefined) {
      return 'forbidden';
    }

    if (projectQuery.isError) {
      return 'error';
    }

    /* Cổng nạp kho đang nạp (B-V8-04): chưa có gì để nói "rỗng". */
    if (projectQuery.isLoading || spatialLoading) {
      return 'loading';
    }

    if (data.storeys.length === 0) {
      return 'empty';
    }

    return data.isPartial ? 'partial' : 'success';
  }, [forceState, canEdit, roles, projectQuery.isError, projectQuery.isLoading, spatialLoading, data]);

  /* ---- Tầng -------------------------------------------------------------- */

  const visibleStoreyIds = useMemo(
    () => data.storeys.map((storey) => storey.id).filter((id) => !hiddenStoreyIds.includes(id)),
    [data.storeys, hiddenStoreyIds],
  );

  const storeys = useMemo<readonly ViewerStoreyViewModel[]>(
    () =>
      data.storeys.map((storey) => ({
        id: storey.id,
        name: storey.name,
        code: storeyShortLabel(storey.name),
        inlineName: storeyInlineName(storey.name),
        elevationLabel: formatLength(millimetres(storey.elevationMm), { unit: 'm' }),
        isActive: activeStoreyIds.includes(storey.id),
        isVisible: !hiddenStoreyIds.includes(storey.id),
        isReady: state !== 'loading' && !(state === 'partial' && storey.order > 0),
      })),
    [data.storeys, activeStoreyIds, hiddenStoreyIds, state],
  );

  const onStoreyActivate = useCallback((id: string, additive: boolean): void => {
    setActiveStoreyIds((current) => {
      if (!additive) {
        return [id];
      }

      return current.includes(id) ? current.filter((each) => each !== id) : [...current, id];
    });
  }, []);

  const onStoreyVisibilityToggle = useCallback((id: string): void => {
    setHiddenStoreyIds((current) =>
      current.includes(id) ? current.filter((each) => each !== id) : [...current, id],
    );
  }, []);

  const onSeparationChange = useCallback((value: number): void => {
    const next = clampSeparation(value);
    setSeparation(next);

    if (next > 0) {
      setRememberedSeparation(next);
    }
  }, []);

  /* ---- Mặt cắt ----------------------------------------------------------- */

  const sectionPlane = useMemo<ViewerSectionPlaneValue | null>(() => {
    if (activePresetId !== 'section' && activeToolId !== 'section') {
      return null;
    }

    return sectionPlaneFor(boundsOf(extent), DEFAULT_SECTION_AXIS, sectionPosition);
  }, [activePresetId, activeToolId, extent, sectionPosition]);

  /**
   * Tay nắm mặt phẳng cắt gọi vào đây qua {@link ViewerSceneActions.setSectionPosition}.
   *
   * Giá trị luôn đi qua `clampSectionPosition` — không tự kẹp biên bằng tay ở
   * đây hay ở màn nội dung — nên `sectionPosition` không bao giờ rời [0, 1]
   * dù tay nắm kéo quá đầu thanh trượt.
   */
  const setSectionPosition = useCallback((value: number): void => {
    setSectionPositionState(clampSectionPosition(value));
  }, []);

  /* ---- Camera: hành động ------------------------------------------------- */

  const goToPreset = useCallback(
    (preset: ViewerPresetId): void => {
      setActivePresetId(preset);
      setIsOrthographic(MODE_BY_PRESET[preset] !== 'orbit');
      director.goTo(
        viewpointForPreset(preset, extent, PRESET_SETTINGS.defaultAspect),
        MODE_BY_PRESET[preset],
      );
      wake();
    },
    [director, extent, wake],
  );

  const onFitAll = useCallback((): void => {
    director.goTo(
      viewpointForPreset(activePresetId, extent, PRESET_SETTINGS.defaultAspect),
      MODE_BY_PRESET[activePresetId],
    );
    wake();
  }, [director, activePresetId, extent, wake]);

  const frameSelection = useCallback((): void => {
    if (selectedIds.length === 0) {
      onFitAll();
      return;
    }

    const transition = director.frameObjects(selectedIds);

    if (transition === null) {
      onFitAll();
      return;
    }

    wake();
  }, [director, selectedIds, onFitAll, wake]);

  /**
   * Khuôn khung nhìn vào đúng một tầng — nối cho hành động "bấm thẻ tầng" của
   * `ExplodedView`.
   *
   * Giữ nguyên góc nhìn (kinh độ, góc chúc) và chế độ camera đang dùng, chỉ đổi
   * điểm ngắm và khoảng cách — cùng cách {@link frameSelection} khuôn một lựa
   * chọn mà không xoay lại mô hình. Mã tầng không khớp tầng nào thì
   * {@link extentOfStorey} trả về `null` và hàm này không làm gì (không ném
   * lỗi, không gọi camera).
   */
  const frameStorey = useCallback(
    (storeyId: string): void => {
      const singleExtent = extentOfStorey(data, footprint, storeyId, separation);

      if (singleExtent === null) {
        return;
      }

      const current = director.viewpoint();
      const mode = director.controller.mode === 'walk' ? 'orbit' : director.controller.mode;

      director.goTo(
        frameViewpoint(boxOfExtent(singleExtent), {
          azimuthRad: current.azimuthRad,
          polarRad: current.polarRad,
          aspect: PRESET_SETTINGS.defaultAspect,
          paddingFraction: PRESET_SETTINGS.framePaddingFraction,
          clearanceMarginM: PRESET_SETTINGS.clearanceMarginM,
          orthographic: isFlatMode(mode),
        }),
        mode,
      );
      wake();
    },
    [director, data, footprint, separation, wake],
  );

  const toggleOrthographic = useCallback((): void => {
    setIsOrthographic((current) => {
      const next = !current;
      director.goTo(director.viewpoint(), next ? 'top' : 'orbit');
      wake();
      return next;
    });
  }, [director, wake]);

  /* ---- Con trỏ ----------------------------------------------------------- */

  const dragRef = useRef<ViewerPointPx | null>(null);

  const onViewportPointerDown = useCallback(
    (point: ViewerPointPx): void => {
      dragRef.current = point;
      director.interrupt();
    },
    [director],
  );

  const onViewportPointerMove = useCallback(
    (point: ViewerPointPx, buttons: number): void => {
      setHoverPointPx(point);

      const previous = dragRef.current;

      if (previous === null || buttons === 0) {
        return;
      }

      const deltaX = point.x - previous.x;
      const deltaY = point.y - previous.y;
      dragRef.current = point;

      const controller = director.controller;

      if (activeToolId === 'pan' && 'pan' in controller) {
        (controller as { pan: (x: number, y: number, height: number) => void }).pan(
          deltaX,
          deltaY,
          window.innerHeight,
        );
      } else if ('rotate' in controller) {
        (controller as { rotate: (x: number, y: number) => void }).rotate(deltaX, deltaY);
      }

      wake();
    },
    [director, activeToolId, wake],
  );

  const onViewportPointerUp = useCallback((): void => {
    dragRef.current = null;
  }, []);

  /**
   * Phối cảnh thu phóng bằng `dolly` (dời mắt), ba góc phẳng — Trục đo, Trên
   * xuống, Mặt cắt — bằng `zoom` (`FlatCameraMode`, đổi nửa chiều cao khung).
   * Chỉ biết `dolly` thì ba góc ấy cuộn chuột lẫn nút `+`/`−` đều chết (B-V8-01).
   */
  const onViewportWheel = useCallback(
    (notches: number): void => {
      const controller = director.controller;

      if (controller instanceof FlatCameraMode) {
        controller.zoom(notches * DOLLY_NOTCH);
        wake();
      } else if (controller instanceof OrbitCameraMode) {
        controller.dolly(notches * DOLLY_NOTCH);
        wake();
      }
    },
    [director, wake],
  );

  const onViewportDoubleClick = useCallback((): void => {
    frameSelection();
  }, [frameSelection]);

  /* ---- Bàn phím (I-01) --------------------------------------------------- */

  const handlersRef = useRef<ViewerShortcutHandlers | null>(null);

  handlersRef.current = {
    selectStorey: (index: number): void => {
      const storey = data.storeys[index];

      if (storey !== undefined) {
        onStoreyActivate(storey.id, false);
      }
    },
    fitAll: onFitAll,
    toggleOrthographic,
    hideSelection: (): void => {
      setHiddenEntityIds((current) => [
        ...current,
        ...selectedIds.filter((id) => !current.includes(id)),
      ]);
    },
    isolateSelection: (): void => {
      // Chưa chọn gì thì không có gì để giữ lại: bật cô lập lúc ấy sẽ ẩn cả mô hình.
      setIsolatedEntityIds((current) =>
        current === null && selectedIds.length > 0 ? [...selectedIds] : null,
      );
    },
    frameSelection,
    toggleSeparation: (): void => {
      if (!separationDisabled) {
        setSeparation((current) => (current > 0 ? 0 : rememberedSeparation));
      }
    },
    activateTool: setActiveToolId,
    openSearch: (): void => {
      onOpenSearch?.();
    },
    clearSelection,
  };

  useEffect(() => {
    const proxy: ViewerShortcutHandlers = {
      selectStorey: (index) => handlersRef.current?.selectStorey(index),
      fitAll: () => handlersRef.current?.fitAll(),
      toggleOrthographic: () => handlersRef.current?.toggleOrthographic(),
      hideSelection: () => handlersRef.current?.hideSelection(),
      isolateSelection: () => handlersRef.current?.isolateSelection(),
      frameSelection: () => handlersRef.current?.frameSelection(),
      toggleSeparation: () => handlersRef.current?.toggleSeparation(),
      activateTool: (id) => handlersRef.current?.activateTool(id),
      openSearch: () => handlersRef.current?.openSearch(),
      clearSelection: () => handlersRef.current?.clearSelection(),
    };

    const disposers = buildViewerShortcuts(proxy).map((definition) =>
      registry.register(definition),
    );

    return (): void => {
      for (const dispose of disposers) {
        dispose();
      }
    };
  }, [registry]);

  /* "Cô lập" trên ray là công tắc như Alt+H, không phải một chế độ thay công cụ đang bật (BUG-655). */
  const onToolChange = useCallback((id: ViewerToolId): void => {
    if (id === 'isolate') {
      handlersRef.current?.isolateSelection();
    } else {
      setActiveToolId(id);
    }
  }, []);

  useEffect(() => {
    if (selectedIds.length === 0) {
      return undefined;
    }

    return registry.register(
      buildDeselectShortcut({
        clearSelection: (): void => {
          handlersRef.current?.clearSelection();
        },
      }),
    );
  }, [registry, selectedIds.length]);

  /* ---- Viewmodel --------------------------------------------------------- */

  const viewpoint = director.viewpoint();

  /** Khuôn chuẩn chia khoảng cách đang đứng; xem {@link zoomLabel}. */
  const zoomRatio = useMemo(() => {
    const framed = createCameraMode(
      MODE_BY_PRESET[activePresetId],
      viewpointForPreset(activePresetId, extent, PRESET_SETTINGS.defaultAspect),
      { extent },
    ).viewpoint();

    return viewpoint.distanceM <= 0 ? 1 : framed.distanceM / viewpoint.distanceM;
  }, [activePresetId, extent, viewpoint.distanceM]);

  const panX = viewpoint.target.x - extent.centre.x;
  const panY = viewpoint.target.y - extent.centre.y;
  const panZ = viewpoint.target.z - extent.centre.z;

  const frame = useMemo(
    () => ({
      azimuthRad: viewpoint.azimuthRad,
      polarRad: viewpoint.polarRad,
      distanceM: viewpoint.distanceM,
      zoom: zoomRatio,
      panOffsetM: [panX, panY, panZ] as const,
      isOrthographic,
      visibleStoreyIds,
      separation,
      sectionPlane,
      selectedEntityIds: selectedIds,
      hoveredEntityId: hoveredId,
      isolatedEntityIds,
      hiddenEntityIds,
      reducedMotion,
    }),
    /* `cameraTick` là chỗ vòng cập nhật báo cho viewmodel biết camera đã dịch. */
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [
      cameraTick,
      viewpoint.azimuthRad,
      viewpoint.polarRad,
      viewpoint.distanceM,
      zoomRatio,
      panX,
      panY,
      panZ,
      isOrthographic,
      visibleStoreyIds,
      separation,
      sectionPlane,
      selectedIds,
      hoveredId,
      isolatedEntityIds,
      hiddenEntityIds,
      reducedMotion,
    ],
  );

  const selection = useMemo<ViewerSelectionViewModel | null>(() => {
    const entityId = selectedIds[0];

    if (entityId === undefined || spatial === null) {
      return null;
    }

    const entity = spatial.byId[entityId];

    if (entity === undefined) {
      return null;
    }

    const rows: ViewerPropertyRow[] = [{ id: 'id', label: 'Mã đối tượng', value: entityId }];
    const entityState = scaleStateOfLevel(
      'levelId' in entity ? String((entity as { levelId: unknown }).levelId) : undefined,
    );
    const marked = (text: string): string => (entityState === undefined ? text : measureTextOfState(text, entityState));

    if ('areaM2' in entity) {
      rows.push({
        id: 'area',
        label: 'Diện tích',
        value: marked(formatArea((entity as { areaM2: number }).areaM2)),
      });
    }

    if ('thicknessMm' in entity) {
      rows.push({
        id: 'thickness',
        label: 'Độ dày',
        value: marked(formatLength(millimetres((entity as { thicknessMm: number }).thicknessMm))),
      });
    }

    if ('name' in entity) {
      rows.push({ id: 'name', label: 'Tên', value: String((entity as { name: string }).name) });
    }

    const kindLabel = entityId.startsWith('R-') ? 'phòng' : entityId.startsWith('W-') ? 'tường' : 'đối tượng';
    // Tiêu đề là nhãn đứng đầu nên viết hoa chữ đầu (A6, BUG-376); `kindLabel` giữ chữ thường để ghép giữa câu.
    const kindTitle = kindLabel.charAt(0).toLocaleUpperCase('vi') + kindLabel.slice(1);

    // Tiêu đề gọi đối tượng bằng mã người đọc — cùng mã dải "Đang sửa"; hàng "mã đối tượng"
    // ở trên giữ mã máy (B-V8-05).
    return { entityId, kindLabel, title: `${kindTitle} ${displayLabelIn(spatial, entityId)}`, rows };
  }, [scaleStateOfLevel, selectedIds, spatial]);

  const status = useMemo(() => {
    /* Tổng cộng cả nhà: tầng nào tỷ lệ chưa tin được thì gọi tên tầng đó, không để số tổng trần. */
    const parts = [
      `${formatNumber(data.storeys.length)} tầng`,
      `${formatNumber(data.roomCount)} phòng`,
      totalMeasureTextOf(
        formatArea(data.totalAreaM2),
        data.storeys.flatMap((storey) => {
          const state = scaleStateOfLevel(String(storey.id));
          return state === undefined ? [] : [{ name: storey.name, state }];
        }),
      ),
    ];

    if (perf !== null) {
      parts.push(`${formatNumber(perf.frameRate)} fps`);
    }

    return {
      summary: parts.join(' · '),
      liveMessage: sceneTransition.isRunning || state === 'loading' ? BUILDING_MESSAGE : READY_MESSAGE,
    };
  }, [data, perf, scaleStateOfLevel, sceneTransition.isRunning, state]);

  /**
   * Mức thu phóng, ĐÃ ĐỊNH DẠNG ở đây chứ không ở view (A15).
   *
   * Tỉ lệ giữa khoảng cách khuôn hình chuẩn và khoảng cách camera đang đứng:
   * đứng đúng chỗ khuôn thì là mức chuẩn, lại gần thì lớn hơn.
   * `formatPercent` của `src/lib/format/number` lo phần chữ, nên view không có
   * phép chia hay `toFixed` nào — thứ `local/no-raw-number` cấm.
   *
   * Khuôn chuẩn đi qua chính chế độ camera (giới hạn khoảng cách của nó), vì
   * camera đóng khung cũng bị kẹp như thế: không kẹp thì màn vừa mở đã ghi
   * "112,6%" thay vì 100% (25-C-044).
   */
  const zoomLabel = useMemo(() => formatPercent(zoomRatio), [zoomRatio]);

  const hoverLabel = useMemo(() => {
    if (hoveredId === null || spatial === null) {
      return null;
    }

    const entity = spatial.byId[hoveredId];

    if (entity !== undefined && 'name' in entity) {
      return String((entity as { name: string }).name);
    }

    return displayLabelIn(spatial, hoveredId);
  }, [hoveredId, spatial]);

  /**
   * Hai việc cảnh 3D báo ngược lên vỏ.
   *
   * Đây là chiều "3D → panel" của S-11: chỉ cảnh biết con trỏ đang chỉ vào tam
   * giác của đối tượng nào, nên nó gọi vào đây, vỏ ghi vào KHO CHỌN DÙNG CHUNG
   * (`selectionSlice`), và cả panel phải lẫn mọi màn khác đang mở cùng đọc một
   * nguồn. Chiều ngược lại không cần dây riêng vì nó đi qua chính kho ấy.
   *
   * Ghi vào kho bằng action của slice (`setSelection`, `setHovered`), KHÔNG gọi
   * `set()` — A10 và `local/no-direct-set`.
   */
  const sceneActions = useMemo(
    () => ({
      selectEntity: (entityId: string | null, additive: boolean): void => {
        if (entityId === null) {
          clearSelection();
          return;
        }

        setSelection(
          additive && !selectedIds.includes(entityId as (typeof selectedIds)[number])
            ? [...selectedIds, entityId as (typeof selectedIds)[number]]
            : [entityId as (typeof selectedIds)[number]],
        );
      },
      hoverEntity: (entityId: string | null): void => {
        setHovered(entityId as (typeof selectedIds)[number] | null);
      },
      setSectionPosition,
      frameStorey,
    }),
    [clearSelection, setSelection, setHovered, selectedIds, setSectionPosition, frameStorey],
  );

  const breadcrumbs = useMemo(
    () => [
      { id: 'project', label: projectQuery.data ?? 'Dự án' },
      { id: 'viewer', label: 'Mô hình 3D' },
    ],
    [projectQuery.data],
  );

  return {
    state,
    hasModel: data.hasModel,

    breadcrumbs,
    viewMode,
    onViewModeChange: setViewMode,
    presets: VIEWER_PRESETS,
    activePresetId,
    onPresetChange: goToPreset,

    railOrientation: isMdUp ? 'vertical' : 'horizontal',
    tools: VIEWER_TOOLS,
    activeToolId,
    onToolChange,

    storeys,
    onStoreyActivate,
    onStoreyVisibilityToggle,
    separation,
    onSeparationChange,
    separationLabel: 'Độ tách',
    ...(separationDisabled ? { separationDisabled } : {}),

    frame,
    sceneActions,
    ...(renderScene !== undefined ? { renderScene } : {}),
    onViewportPointerMove,
    onViewportPointerDown,
    onViewportPointerUp,
    onViewportWheel,
    onViewportDoubleClick,
    hoverLabel,
    hoverPointPx,

    onCubeFaceSelect: goToPreset,
    zoomLabel,
    onZoomIn: (): void => {
      onViewportWheel(-ZOOM_BUTTON_NOTCHES);
    },
    onZoomOut: (): void => {
      onViewportWheel(ZOOM_BUTTON_NOTCHES);
    },
    onZoomReset: onFitAll,
    onFitAll,
    legend: VIEWER_LEGEND,
    perf: isDev && perf !== null ? { trianglesLabel: `${formatNumber(perf.triangles)} tam giác` } : null,

    selection,
    inspectorHint: INSPECTOR_HINT,
    scrollToEntityId: selectedIds[0] ?? null,

    status,

    errorMessage: state === 'error' ? ERROR_MESSAGE : null,
    onRetry: (): void => {
      void projectQuery.refetch();
    },
  };
}

/** Những phím vỏ đăng ký, để bảng phím tắt và bài kiểm đọc chung một nguồn. */
export const VIEWER_KEY_LABELS = Object.freeze({
  frame: FRAME_COMBO,
  hide: HIDE_COMBO,
  isolate: ISOLATE_COMBO,
  measure: MEASURE_COMBO,
  orthographic: ORTHOGRAPHIC_COMBO,
});

/** Danh sách công cụ của ray — mọi vai thấy đủ, story và bài kiểm đếm trên nó. */
export const ALL_VIEWER_TOOLS = VIEWER_TOOLS;

/**
 * Khoá CON chứa tên dự án (một chuỗi) — B-V1-12. Khoá gốc `project.detail(id)`
 * thuộc về đối tượng dự án; ghi chuỗi vào đó thì nơi khác đọc nó như đối tượng
 * và sập. Khoá con vẫn nằm dưới tiền tố gốc, nên vô hiệu hoá theo dự án lan xuống.
 */
export const projectNameQueryKey = (projectId: string) =>
  [...queryKeys.project.detail(projectId), 'name'] as const;
