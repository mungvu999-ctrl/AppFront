/**
 * `usePascalProjectBridge` — nối trang 3D riêng (`public/editor3d.html`) với AppBack.
 *
 * Trang không có router hay `SessionBootstrap` của AppFront, nên cầu tự làm đúng
 * các bước ấy bằng CHÍNH hàm của chúng: mở phiên qua cookie làm mới
 * (`startAppSession`), nạp #24 + N15 vào kho (`readProjectDetail`/`readProjectGraph`
 * → `loadProjectGraph`, như `useProjectSpatial`), đọc qua `selectViewerSpatial` như
 * `/3d`, và ghi qua `usePascalEdits.onSceneCommit` → kho → `useFloorLayerAutosave` (N16).
 */

import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from 'react';

import { denormalizeSpatial } from '@/domain/spatial/normalize';
import type { SpatialGraph } from '@/domain/spatial/types';
import { useFloorLayerAutosave } from '@/hooks/useAutosave';
import { useSession } from '@/hooks/useSession';
import { can } from '@/lib/auth/permissions';
import { getSessionSnapshot } from '@/lib/auth/state';
import { readWireError } from '@/lib/errors/wireError';
import type { DesignAddition, DesignConcept, DesignConceptState, DesignStyleId } from '@/api/schemas/designConcept';
import { CATALOG_MODELS, isServerModel } from '@/lib/pascal/furnitureCatalog';
import { CONCEPT_FALLBACK_NOTICE, readConcept, sceneConceptOf } from '@/lib/pascal/sceneConcept';
import { LIBRARY_FALLBACK_NOTICE, libraryReadFailed, type LibrarySource } from '@/lib/pascal/serverLibrary';
import { readSceneStyle, type SceneStyle, type SceneStyleId } from '@/lib/pascal/sceneStyles';
import { toPascalId } from '@/lib/pascal/ids';
import { createRepairSession, sessionRepairs } from '@/lib/pascal/sceneRepair';
import { standardSceneOf } from '@/lib/pascal/sceneStandard';
import type { PascalNode, PascalNodeId, PascalScene } from '@/lib/pascal/types';
import { ROUTES } from '@/routes/paths';
import { startAppSession } from '@/routes/sessionSetup';
import { usePascalEdits } from '@/screens/viewer/PascalViewer/usePascalEdits';
import { selectViewerSpatial } from '@/screens/viewer/ViewerShell/viewerShellGateway';
import { useStore } from '@/store';
import type { ProjectRole } from '@/types/project';

import { sceneTrace, summarizeScene } from '../createProbe';
import { sceneRepairStore } from '../sceneRepairStore';
import { scaleStatusOf } from '../useScaleStatus';
import { resolveBackHref } from './backHref';
import { createDerivedHistory, recordDerived, restoreDerived, touchedTargetFor } from './derivedHistory';
import type { PascalBridge, PascalConfirm, PascalNotice, PascalSaveStatus, PascalSceneGraph } from './types';

export { LAST_APP_PATH_KEY, rememberAppPath, RETURN_TO_PARAM } from './backHref';
export type { PascalBridge, PascalConfirm, PascalNotice, PascalSaveStatus, PascalSceneGraph } from './types';

export const BRIDGE_SESSION_ERROR = 'Phiên đăng nhập đã hết. Đăng nhập lại rồi mở lại mô hình 3D.';
export const BRIDGE_NOT_FOUND_ERROR = 'Không tìm thấy dự án này, hoặc bạn chưa được thêm vào dự án.';
export const BRIDGE_LOAD_ERROR = 'Không tải được mô hình của dự án. Tải lại trang để thử lại.';
export const BRIDGE_EMPTY_ERROR = 'Dự án chưa có mô hình để mở trong 3D.';
// Concept AI (N47) dùng chung với lịch sử phiên bản + viewer di động (`sceneConcept.ts`).
export { CONCEPT_FALLBACK_NOTICE, furnishModeOf } from '@/lib/pascal/sceneConcept';

/** Câu khi lượt gửi N16 hỏng mà không có dải khối nào nêu lý do. */
export const BRIDGE_SAVE_FAILED = 'Lưu thất bại. Kiểm tra mạng rồi sửa tiếp để thử lại.';

/** Câu báo một lần mỗi phiên cho phần sửa máy chủ chưa nhận (`unsavedPascalEdits`). */
export const unsavedNoticeOf = (labels: readonly string[]): string =>
  `Chưa lưu được: ${labels.join(', ')} — sẽ có ở bản sau.`;

/** Câu ném cho editor khi tầng bị khối (409/422/403) — lý do đầy đủ + "Tải lại tầng" ở thẻ trang. */
export const BRIDGE_SAVE_BLOCKED = 'Tầng này chưa lưu được lên máy chủ. Xem thẻ ở góc trên để tải lại tầng.';

/** L3a-01: phiên hết giữa chừng — có sửa đang chờ thì nói rõ là CHƯA lưu. */
export const SESSION_LOST_UNSAVED = 'Phiên đăng nhập đã hết — thay đổi vừa rồi CHƯA được lưu. Đăng nhập lại rồi làm lại phần đó.';
export const SESSION_LOST = 'Phiên đăng nhập đã hết — sửa lúc này sẽ không được lưu. Đăng nhập lại để sửa tiếp.';

/** C4/A2-07: "Tải lại tầng" bỏ phần sửa chưa lưu — hỏi trước. */
export const RELOAD_CONFIRM_TITLE = 'Tải lại tầng từ máy chủ?';
export const RELOAD_CONFIRM_BODY = 'Các thay đổi chưa lưu của tầng này sẽ bị bỏ, mô hình quay về bản đang lưu trên máy chủ.';
/** C4/A2-02: xoá từ một phần năm số đối tượng của tầng trở lên — hỏi trước (cổng `PASCAL_MASS_DELETE`). */
export const MASS_DELETE_TITLE = 'Xoá nhiều đối tượng cùng lúc?';
export const massDeleteBodyOf = (count: number): string =>
  `${String(count)} đối tượng sẽ bị xoá khỏi tầng này và lưu lên máy chủ. Sau khi xoá không hoàn tác được bằng Ctrl+Z.`;

/** Đường đăng nhập lại, xong thì quay về đúng mô hình 3D của dự án (`/3d` chuyển sang trang này). */
export const loginHrefOf = (projectId: string): string =>
  `${ROUTES.login}?next=${encodeURIComponent(ROUTES.project.viewer(projectId))}`;

class BridgeLoadError extends Error {}

/**
 * Cảnh 3D không dựng nội dung của tầng chưa có tỷ lệ (Codex P1): tỷ lệ mặc định 1 mm/px hay nhà
 * co dưới 3 m cho ra sàn cao mảnh, sai hẳn. Tầng vẫn còn trong danh sách tầng (trống); dải cảnh
 * báo nêu tên và dẫn tới "Đặt tỷ lệ". Hai cảnh trước/sau lượt sửa cùng bỏ tầng ấy, nên không có
 * lệnh xoá nào sinh ra cho nó.
 */
export function withoutFloorContents(graph: SpatialGraph, floorIds: ReadonlySet<string>): SpatialGraph {
  if (floorIds.size === 0) return graph;
  const removed = new Set<string>();
  const kept = <T extends { readonly id: string }>(items: readonly T[], drop: (item: T) => boolean) =>
    items.filter((item) => {
      if (!drop(item)) return true;
      removed.add(item.id);
      return false;
    });
  const onFloor = (item: { readonly levelId: string }) => floorIds.has(item.levelId);
  const walls = kept(graph.walls, onFloor);
  const openings = kept(graph.openings, (opening) => removed.has(opening.wallId));
  const furniture = kept(graph.furniture, onFloor);
  const rooms = kept(graph.rooms, onFloor);
  const axes = kept(graph.axes, onFloor);
  const dimensions = kept(graph.dimensions, onFloor);
  const roofs = graph.roofs === undefined ? undefined : kept(graph.roofs, onFloor);

  return {
    ...graph,
    walls,
    openings,
    furniture,
    rooms,
    axes,
    dimensions,
    notes: graph.notes.filter((note) => !removed.has(note.entityId)),
    ...(roofs === undefined ? {} : { roofs }),
  };
}

/** Khoá siêu dữ liệu đánh dấu tầng bị bỏ nội dung — danh sách tầng của editor làm mờ nó và ghi "Chưa dựng". */
export const NOT_BUILT_KEY = 'appfrontNotBuilt';

/**
 * UX-R2 K36: gắn `metadata.appfrontNotBuilt` lên node tầng bị `withoutFloorContents` bỏ nội dung.
 * Chỉ để hiển thị: `toSpatial` không đọc khoá này, và cảnh trước/sau lượt sửa cùng mang nó.
 */
export function markNotBuilt(scene: PascalScene, floorIds: ReadonlySet<string>): PascalScene {
  if (floorIds.size === 0) return scene;
  const nodes: Record<PascalNodeId, PascalNode> = { ...scene.nodes };
  floorIds.forEach((floorId) => {
    const id = toPascalId('level', floorId);
    const node = nodes[id];
    if (node !== undefined) nodes[id] = { ...node, metadata: { ...node.metadata, [NOT_BUILT_KEY]: true } } as PascalNode;
  });
  return { ...scene, nodes };
}

/** Phong cách cảnh của lượt mở trang (W4a) — thẻ "Phong cách" đọc nó. */
export interface ProjectSceneStyle {
  readonly projectId: string;
  readonly id: SceneStyleId;
  /** Ghi phong cách vào dự án (PUT N6, ném khi hỏng); vắng khi không có quyền sửa cài đặt hoặc chưa đọc được cài đặt. */
  readonly saveToProject?: (id: SceneStyleId) => Promise<void>;
  /** AID-01 — có khi N47 báo bật và người dùng sửa được cài đặt (quyền của N48); vắng = thẻ năm kiểu cũ. */
  readonly designConcept?: ProjectDesignConcept;
}

/** Concept AI của dự án lúc mở trang + hai lối gọi (ném khi hỏng). */
export interface ProjectDesignConcept {
  readonly state: DesignConceptState;
  /** N48; `undefined` = quay về đề xuất AI. */
  readonly select: (styleId: DesignStyleId | undefined) => Promise<DesignConcept>;
  /** N47. */
  readonly read: () => Promise<DesignConceptState>;
}

let projectSceneStyle: ProjectSceneStyle | null = null;

/** Phong cách của dự án đang mở; `null` trước khi cầu nạp xong. */
export const currentProjectSceneStyle = (): ProjectSceneStyle | null => projectSceneStyle;

/** Khoá cửa sổ mà bản vá danh sách tầng của vendor đọc (chỉ hiển thị, không vào cảnh nên không vào đường lưu). */
export const UNDRAWN_FLOORS_KEY = '__appfrontUndrawnFloors';

/** Tên các tầng của dự án chưa có trong đồ thị không gian (chưa có bản vẽ), tầng cao ở trên như danh sách tầng. */
export function undrawnFloorNames(
  floors: readonly { readonly id: string; readonly name: string; readonly order: number }[],
  drawnIds: ReadonlySet<string>,
): string[] {
  return floors
    .filter((floor) => !drawnIds.has(floor.id))
    .sort((a, b) => b.order - a.order)
    .map((floor) => floor.name);
}

/**
 * UX-R5 UX-32: tầng "có bản vẽ" là tầng có ít nhất một tường hoặc phòng. Tầng có trong đồ thị mà
 * trống (dự án 4 tầng, chỉ vẽ tầng trệt) trước đây hiện như tầng thường trong danh sách tầng.
 */
export function drawnFloorIds(graph: Pick<SpatialGraph, 'walls' | 'rooms'>): Set<string> {
  return new Set([...graph.walls, ...graph.rooms].map((item) => item.levelId));
}

let separateUnits = false;

/**
 * Thiết lập dự án "Đây là các căn hộ riêng" (`separateUnits` của N5), đọc lúc cầu nạp: bật thì
 * editor chỉ xem một tầng, không chồng tầng. Trang chỉ vẽ editor sau khi cầu nạp xong, nên đọc lúc
 * render là đủ. ponytail: đọc một lần mỗi lượt mở, đổi ở màn khác thì tải lại trang mới thấy.
 */
export const isSeparateUnits = (): boolean => separateUnits;

/** Đường cho trang (ngoài hook cầu) đưa một câu lên toast của cầu; chưa gắn thì bỏ. */
let noticeSink: ((message: string) => void) | null = null;
export const postPascalNotice = (message: string): void => noticeSink?.(message);

/** Lượt `onSave` gần nhất của cầu — `savePascalNow` đợi nó. */
let lastSave: Promise<unknown> = Promise.resolve();

/**
 * Lưu NGAY cảnh Pascal rồi đợi lượt ghi qua cầu xong (ném nếu lượt ấy bị từ chối). Gói
 * editor không xuất `saveNow`, nên đi đúng lối phím tắt của nó: Ctrl+S (`use-save-shortcut.ts`,
 * bắt ở pha capture trên `window`) → `saveNow` → `executeSave` gọi `onSave` ngay trong lượt
 * phát sự kiện, trước khi `dispatchEvent` trả về.
 */
export async function savePascalNow(): Promise<void> {
  window.dispatchEvent(new KeyboardEvent('keydown', { code: 'KeyS', key: 's', ctrlKey: true, cancelable: true }));
  await lastSave;
}

// `?probe=1`: nhật ký lượt dựng đếm mẫu thư viện máy chủ (giả thuyết H1: thư viện về sau lượt dựng).
const serverModelCount = (): number => Object.keys(CATALOG_MODELS).filter(isServerModel).length;
if (sceneTrace.enabled) sceneTrace.countServerModels = serverModelCount;

const messageOf = (error: unknown): string => {
  if (error instanceof BridgeLoadError) return error.message;

  const wire = readWireError(error);
  if (wire?.status === 401) return BRIDGE_SESSION_ERROR;
  if (wire?.status === 404 || wire?.status === 403) return BRIDGE_NOT_FOUND_ERROR;

  return BRIDGE_LOAD_ERROR;
};

async function loadProject(projectId: string): Promise<{
  readonly projectName: string;
  readonly style: SceneStyle;
  readonly additions: readonly DesignAddition[];
  readonly furnish: 'on' | 'off';
  /** `done` | `none` | `fallback:<lý do>` (đọc N47 hỏng). */
  readonly concept: string;
}> {
  if (!(await startAppSession())) throw new BridgeLoadError(BRIDGE_SESSION_ERROR);

  const [{ createAppApiClient }, { readProjectDetail, readProjectGraph, toProjectSpatial }, { loadProjectGraph }] =
    await Promise.all([import('@/api/appClient'), import('@/api/floorLayerGraph'), import('@/store/projectHydration')]);
  const client = createAppApiClient();
  // N5 lỗi thì vẫn mở trang, phong cách lùi về bộ nhớ máy (W4a).
  const settingsRead = (async () => {
    const result = await client.projectSettings.read({ projectId });
    return result.ok ? result.data : null;
  })().catch(() => null);
  /* N47 lúc mở trang: chờ ĐÚNG kết quả (không đua giờ riêng — concept về chậm từng làm mất phong cách + đồ AI
     âm thầm). Giới hạn thời gian là của client HTTP chung; lỗi/ném → dự phòng có lý do (AID-01). */
  const conceptRead = readConcept(client.designConcept, projectId);
  const floorsRead = (async () => {
    const result = await client.floors.list({ projectId });
    return result.ok ? result.data : [];
  })().catch(() => []);
  const project = await readProjectDetail(client.projects, { projectId });
  const document = await readProjectGraph(client.spatial, { projectId });
  /* Chưa có tầng nào thì không có chỗ để vẽ — báo trạng thái rỗng (C15). Có tầng mà chưa
     có tường thì vẫn mở: người dùng vẽ tường ngay trong 3D. */
  if (document.graph.levels.length === 0) {
    throw new BridgeLoadError(BRIDGE_EMPTY_ERROR);
  }
  const session = getSessionSnapshot();

  /* U52: tầng chưa có bản vẽ không có trong N15 nên danh sách tầng chỉ thấy tầng đã vẽ. Ghi tên để
     danh sách vẽ thêm dòng mờ "Chưa có bản vẽ" (chỉ hiển thị, không là node cảnh). */
  const drawn = drawnFloorIds(document.graph);
  (window as unknown as Record<string, unknown>)[UNDRAWN_FLOORS_KEY] = undrawnFloorNames(await floorsRead, drawn);

  loadProjectGraph(toProjectSpatial(project, document, { roles: session.roles, userId: session.user?.id ?? null }));
  /* UX-R2 K39: bắt đầu xét tỷ lệ ngay khi kho có cảnh, song song với lượt tải gói editor — `onLoad`
     và dải cảnh báo dùng lại đúng lượt này (memo của `scaleStatusOf`), không đợi thêm một vòng. */
  void scaleStatusOf(projectId);

  const settings = await settingsRead;
  separateUnits = settings?.separateUnits === true;
  const conceptLoaded = await conceptRead;
  const conceptState = conceptLoaded.state;
  // Concept đã xong thắng mọi phong cách khác (kể cả bản xem thử trên máy); chưa xong/hỏng → phong cách cũ.
  const concept = sceneConceptOf(conceptLoaded);
  const style = concept.style ?? readSceneStyle(() => localStorage, { id: projectId, style: settings?.sceneStyle });
  // Cùng cổng vai như hook: vai theo dự án vừa nạp trước, phiên dự phòng.
  const storeRoles = useStore.getState().userRoles;
  const canEditSettings = can('edit', 'project.settings', { roles: storeRoles.length > 0 ? storeRoles : session.roles });

  projectSceneStyle = {
    projectId,
    id: style.id,
    ...(settings !== null && canEditSettings
      ? {
          // Gửi đủ thân như màn Cài đặt, đúng `revision` vừa đọc; 409 thì ném, thẻ báo lỗi.
          saveToProject: async (id: SceneStyleId) => {
            const { revision, ...body } = settings;
            const result = await client.projectSettings.replace({
              projectId,
              baseVersion: revision,
              body: { ...body, sceneStyle: id },
            });
            if (!result.ok) throw result.error;
          },
        }
      : {}),
    ...(conceptState?.enabled === true && canEditSettings
      ? {
          designConcept: {
            state: conceptState,
            select: async (styleId: DesignStyleId | undefined) => {
              const result = await client.designConcept.select({ projectId, ...(styleId === undefined ? {} : { styleId }) });
              if (!result.ok) throw result.error;
              return result.data;
            },
            read: async () => {
              const result = await client.designConcept.read({ projectId });
              if (!result.ok) throw result.error;
              return result.data;
            },
          },
        }
      : {}),
  };

  sceneTrace.source('concept', concept.source);
  return {
    projectName: project.name,
    style,
    additions: concept.additions,
    furnish: concept.furnish,
    concept: concept.source,
  };
}

/** Giữ tối đa chừng này thông báo nổi; câu cũ nhất rơi ra trước. */
const MAX_NOTICES = 3;
let nextNoticeId = 1;

interface LoadState {
  readonly status: PascalBridge['status'];
  readonly error?: string;
  readonly projectName?: string;
  readonly style?: SceneStyle;
  readonly additions?: readonly DesignAddition[];
  readonly furnish?: 'on' | 'off';
}

/**
 * `applyScene` — đặt cảnh vào editor đúng lối nạp (`applySceneGraphToEditor`: không bước hoàn tác,
 * không đụng camera). Cầu gọi nó khi một lượt sửa bị từ chối để cảnh 3D quay về khớp kho.
 */
export function usePascalProjectBridge(
  projectId: string,
  applyScene?: (scene: PascalSceneGraph) => void,
  /** Cảnh editor đang giữ, đã điền mặc định lược đồ. */
  editorScene?: () => PascalSceneGraph,
  /** Nguồn danh mục lượt dựng đầu (`main.tsx`): đọc thư viện hỏng → báo người dùng. */
  librarySource?: Promise<LibrarySource>,
): PascalBridge {
  const [load, setLoad] = useState<LoadState>({ status: 'loading' });
  const { style, additions, furnish } = load;
  // Đọc một lần lúc mở trang: màn vừa rời (N1-01, N5-13, N3-09), không có thì Quản lý tầng.
  const [backHref] = useState(() => resolveBackHref(projectId));
  const session = useSession();
  const storeRoles = useStore((state) => state.userRoles);
  const spatial = useStore((state) => state.spatial);

  // Cùng cổng quyền với `PascalViewer.container`: vai theo dự án trước, phiên dự phòng.
  const roles: readonly ProjectRole[] = storeRoles.length > 0 ? storeRoles : session.roles;
  const readOnly = !can('edit', 'layer', { roles });
  // Chỉ cho nhật ký lượt dựng (`sceneTrace`): ref để `sceneFromStore`/`onLoad` không đổi danh tính theo vai.
  const readOnlyRef = useRef(readOnly);
  readOnlyRef.current = readOnly;

  /* Thông báo nổi: mỗi câu một mục (id, giọng, lúc tạo), không gộp — câu báo thường dính câu lỗi
     từng bị nhuộm đỏ cả cụm. Thẻ tự gỡ (BackToProjectCard). Câu trùng câu đang hiện thì không thêm. */
  const [notices, setNotices] = useState<readonly PascalNotice[]>([]);
  const push = useCallback((tone: PascalNotice['tone'], text: string) => {
    setNotices((current) =>
      current.some((item) => item.text === text)
        ? current
        : [...current, { id: nextNoticeId++, tone, text, createdAt: Date.now() }].slice(-MAX_NOTICES),
    );
  }, []);
  useEffect(() => {
    let cancelled = false;

    setLoad({ status: 'loading' });
    loadProject(projectId).then(
      ({ projectName, style, additions, furnish, concept }) => {
        if (cancelled) return;
        setLoad({ status: 'ready', projectName, style, additions, furnish });
        if (concept.startsWith('fallback:')) push('info', CONCEPT_FALLBACK_NOTICE);
      },
      (error: unknown) => {
        // Trang lỗi cũng là "đã chốt": `ready()` không kẹt false (E2E/kit chờ nó).
        sceneTrace.source('concept', 'error');
        if (!cancelled) setLoad({ status: 'error', error: messageOf(error) });
      },
    );

    return () => {
      cancelled = true;
    };
  }, [projectId, push]);
  useEffect(() => {
    let cancelled = false;
    void librarySource?.then((source) => {
      if (!cancelled && libraryReadFailed(source)) push('info', LIBRARY_FALLBACK_NOTICE);
    });
    return () => {
      cancelled = true;
    };
  }, [librarySource, push]);

  /* Bộ tự lưu tầng dùng chung (A7): mỗi `commit` của `usePascalEdits` đổi kho, saver gửi N16.
     Trạng thái thật của nó (đang lưu / đã lưu / bị khối) lên thẻ trang — "đã lưu" của Pascal chỉ
     là lượt vào kho, không phải lượt PUT (v3 BE.md major 1). */
  const { autosave, isFloorBlocked, label: savedLabel, reloadFloor, saveBlock } = useFloorLayerAutosave({ projectId });
  const engineState = useSyncExternalStore(autosave.subscribe, autosave.getState, autosave.getState);

  /* Phần sửa chưa lưu được: mỗi nhãn báo một lần mỗi phiên. */
  const noticed = useRef(new Set<string>());
  const noticedMessages = useRef(new Set<string>());
  const onUnsaved = useCallback(
    (labels: readonly string[]) => {
      const fresh = labels.filter((item) => !noticed.current.has(item));

      if (fresh.length === 0) return;
      fresh.forEach((item) => noticed.current.add(item));
      push('info', unsavedNoticeOf(fresh));
    },
    [push],
  );
  // Lời báo của lượt sửa (vd. vách mới cần tách phòng — W3d): mỗi câu một lần mỗi phiên.
  const onNotice = useCallback(
    (message: string) => {
      if (noticedMessages.current.has(message)) return;
      noticedMessages.current.add(message);
      push('info', message);
    },
    [push],
  );
  const showAlert = useCallback((alert: string) => push('alert', alert), [push]);
  useEffect(() => {
    noticeSink = onNotice;
    return () => {
      if (noticeSink === onNotice) noticeSink = null;
    };
  }, [onNotice]);
  const dismissNotice = useCallback((id: number) => setNotices((current) => current.filter((item) => item.id !== id)), []);

  // C4/A2-07: hỏi trước khi "Tải lại tầng" bỏ phần sửa chưa lưu.
  const [askReload, setAskReload] = useState(false);
  // C4/A2-02: lượt xoá nhiều bị cổng chặn, chờ người dùng xác nhận (cảnh sau lượt xoá + các node).
  const [massDelete, setMassDelete] = useState<{ readonly nodeIds: readonly string[]; readonly scene: unknown } | null>(null);
  const massDeleteRef = useRef<{ readonly reason: string } | null>(null);
  const pendingScene = useRef<unknown>(null);
  const onMassDelete = useCallback(({ nodeIds, reason }: { readonly nodeIds: readonly string[]; readonly reason: string }) => {
    massDeleteRef.current = { reason };
    setMassDelete({ nodeIds, scene: pendingScene.current });
  }, []);

  // Mốc "trước" của lượt sửa đầu: đúng cảnh vừa trao cho Pascal ở `onLoad`.
  const [loadedScene, setLoadedScene] = useState<PascalScene | null>(null);
  const rejection = useRef<string | null>(null);
  const onRejected = useCallback(
    (reason: string) => {
      rejection.current = reason;
      // Lượt xoá nhiều đang chờ hộp xác nhận: hộp đã hỏi, không thêm toast đỏ.
      if (massDeleteRef.current?.reason === reason) return;
      // N1 — lượt bị từ chối phải thấy được trên thẻ, không chỉ là lỗi ném cho editor (nó có thể nuốt).
      showAlert(reason);
    },
    [showAlert],
  );
  const { onSceneCommit, validateCommit, confirmMassDelete, takeSuggestionAccepted, rebaseOnRebuilt } = usePascalEdits({
    spatial,
    loadedScene,
    readOnly,
    onRejected,
    onMassDelete,
    onUnsaved,
    onNotice,
    ...(session.user?.id === undefined ? {} : { actorId: session.user.id }),
  });

  /* Đọc kho lúc gọi chứ không theo render: sau mỗi lượt sửa kho đổi, và một `onLoad`
     đổi danh tính sẽ khiến trang nạp lại cảnh đè lên việc đang làm. */
  /* Phong cách cảnh chốt MỘT lần mỗi lượt mở trang (J9, W4a: dự án → máy → mặc định): mọi
     `toPascalScene` dùng chung nó, không thì giá trị sinh ra lệch nhau → "sửa ma". */
  /* Tầng chưa có tỷ lệ (cùng danh sách của dải cảnh báo): chốt ở `onLoad`, mọi lượt dựng lại dùng chung. */
  const missingFloors = useRef<ReadonlySet<string>>(new Set());
  /* Sửa cảnh (`sceneRepair.ts` `sessionRepairs`): tính theo chữ ký đầu vào, không chốt một lần — dời tường/đổi phòng/
     dời đồ thì lượt dựng sau tính lại, món người dùng đã đụng trong phiên không bị sửa. `derived` nhớ các bản node
     dẫn xuất từng trao cho editor để Ctrl+Z về chúng không bị coi là sửa (`derivedHistory.ts`). */
  const repairSession = useRef(createRepairSession());
  const derived = useRef(createDerivedHistory());
  const storedGraph = useCallback((): SpatialGraph | null => {
    const current = selectViewerSpatial(useStore.getState());
    return current === null ? null : withoutFloorContents(denormalizeSpatial(current), missingFloors.current);
  }, []);
  const sceneOptions = useCallback(
    () => ({
      style: style ?? readSceneStyle(() => localStorage),
      ...(furnish === undefined ? {} : { furnish }),
      ...(additions === undefined || additions.length === 0 ? {} : { additions }),
    }),
    [style, additions, furnish],
  );
  const sceneFromStore = useCallback((reason = 'build'): PascalScene | null => {
    const stored = storedGraph();
    if (stored === null) return null;

    /* Sửa cảnh cho đồ AI chưa xác nhận: chỉ trên đồ thị trao cho cảnh, kho giữ bản gốc nên tự lưu ghi đúng dữ liệu
       gốc; lượt sửa sau chỉ ghi node người dùng đụng (chênh với mốc = cảnh editor sau lượt dựng gần nhất). */
    const { graph, repairs } = sceneRepairStore.get().enabled ? sessionRepairs(repairSession.current, stored) : { graph: stored, repairs: [] };
    // Hợp đồng lớp cảnh dẫn xuất v1 (`sceneLayer.ts`): mọi đường vào dùng `standardSceneOf`; sửa cảnh ghi lên node (`fields.repair`).
    // Đồ AI bổ sung (AID-01) và chế độ tự bày dự phòng đi cùng phong cách: chốt một lần mỗi lượt
    // mở trang, mọi lượt dựng dùng chung, không thì "sửa ma".
    const options = sceneOptions();
    const raw = !sceneRepairStore.get().enabled;
    const { scene, layer } = standardSceneOf(graph, {
      ...options,
      raw,
      repairs: new Map(repairs.map((r) => [r.furnitureId, r])),
    });
    sceneRepairStore.set({ repairs, session: repairSession.current, layer });
    const built = markNotBuilt(scene, missingFloors.current);
    if (sceneTrace.enabled) {
      sceneTrace.built({
        reason: missingFloors.current.size === 0 ? reason : `${reason}:missingFloors=${missingFloors.current.size}`,
        style: options.style.id,
        furnish: options.furnish ?? 'on',
        raw,
        repairsEnabled: !raw,
        nLevels: stored.levels.length,
        nFurnitureStored: stored.furniture.length,
        serverModels: serverModelCount(),
        readOnly: readOnlyRef.current,
        ...summarizeScene(built.nodes),
      });
    }

    return built;
  }, [sceneOptions, storedGraph]);

  /** Sửa cảnh của kho hiện tại khác danh sách lượt dựng gần nhất đã áp → cảnh editor phải dựng lại. */
  const repairsStale = useCallback((): boolean => {
    const stored = storedGraph();
    if (stored === null) return false;
    const next = sceneRepairStore.get().enabled ? sessionRepairs(repairSession.current, stored).repairs : [];
    return JSON.stringify(next) !== JSON.stringify(sceneRepairStore.get().repairs);
  }, [storedGraph]);

  /** Node của món đã đụng ở dữ liệu trước khi đụng (đích hoàn tác về một vị trí đã sửa cảnh); dựng lười, chỉ khi cần. */
  const touchedTargetOf = useCallback(
    () =>
      touchedTargetFor(
        repairSession.current,
        storedGraph,
        (graph) => standardSceneOf(graph, { ...sceneOptions(), raw: !sceneRepairStore.get().enabled, repairs: new Map() }).scene,
      ),
    [sceneOptions, storedGraph],
  );

  /* Tải lại tầng bị khối (409/422/403): bỏ bản chưa lưu được, nạp lại tầng từ máy chủ vào kho rồi
     dựng lại cảnh từ kho. Không có `applyScene` thì nạp lại cả trang như trước. */
  const reloadBlockedFloor = useCallback(async () => {
    const target = useStore.getState().unsavedFloorIds.find(isFloorBlocked);
    const reason = saveBlock?.message ?? null;

    if (target !== undefined) await reloadFloor(target);
    const restored = applyScene === undefined ? null : sceneFromStore('reload-floor');
    if (restored === null) {
      window.location.reload();
      return;
    }
    applyScene?.(restored);
    if (reason !== null) showAlert(reason);
  }, [applyScene, isFloorBlocked, reloadFloor, saveBlock, sceneFromStore, showAlert]);

  /* Cảnh editor sau lượt nạp (sceneLoader) hay dựng lại: thành mốc của lượt sửa sau và bản dẫn xuất hiện hành. */
  const rebaseLoaded = useCallback((scene: PascalSceneGraph) => {
    sceneTrace.held('editor-holds', scene.nodes, { readOnly: readOnlyRef.current });
    const hidden = sceneRepairStore.get().repairs.filter((r) => r.action === 'hidden').map((r) => toPascalId('item', r.furnitureId));
    recordDerived(derived.current, scene as PascalScene, hidden);
    setLoadedScene(scene as PascalScene);
  }, []);

  const onLoad = useCallback(async (): Promise<PascalSceneGraph> => {
    const scale = await scaleStatusOf(projectId);
    missingFloors.current = new Set(scale.status === 'unresolved' ? scale.missingIds : []);
    const scene = sceneFromStore('load');
    if (scene === null) throw new BridgeLoadError(BRIDGE_EMPTY_ERROR);
    setLoadedScene(scene);

    return scene;
  }, [projectId, sceneFromStore]);

  /* `applyScene` đổi đúng phần chênh (main.tsx), không dựng lại cả mô hình. */
  const revertToStore = useCallback(() => {
    const restored = sceneFromStore('revert');
    if (restored !== null) applyScene?.(restored);
  }, [applyScene, sceneFromStore]);

  /* Dựng lại cảnh từ kho (không bước hoàn tác) rồi lấy cảnh editor SAU khi dựng (đã điền mặc định) làm mốc — cả mốc
     lượt sửa kế (`rebaseOnRebuilt`) lẫn mốc nạp (đồ sinh rời so với nó, `editedLooseNodeIds`): bản dựng không phải sửa. */
  const rebuildFromStore = useCallback(() => {
    revertToStore();
    const rebuilt = editorScene?.();
    if (rebuilt === undefined) return;
    rebaseOnRebuilt(rebuilt as PascalScene);
    rebaseLoaded(rebuilt);
  }, [editorScene, rebaseLoaded, rebaseOnRebuilt, revertToStore]);

  /* "Hiện dữ liệu gốc" (chip lỗi đặt đồ) bật/tắt sửa cảnh: dựng lại từ kho, như lượt nhận gợi ý — đổi hiển thị không
     phải lượt sửa, không được ghi vị trí nào về máy chủ. */
  useEffect(() => {
    let last = sceneRepairStore.get().enabled;
    return sceneRepairStore.subscribe(() => {
      const { enabled } = sceneRepairStore.get();
      if (enabled === last) return;
      last = enabled;
      rebuildFromStore();
    });
  }, [rebuildFromStore]);

  const onSave = useCallback(
    async (raw: unknown): Promise<void> => {
      if (readOnly) return;

      // Ctrl+Z về node dẫn xuất cũ không phải lượt sửa: đưa về bản hiện hành trước khi so (`derivedHistory.ts`).
      const { scene, restored } = restoreDerived(derived.current, raw as PascalScene, touchedTargetOf());
      rejection.current = null;
      massDeleteRef.current = null;
      pendingScene.current = scene;
      // Chạy cổng trước (phán quyết nhớ theo cảnh, `onSceneCommit` dùng lại): xoá nhiều → `onMassDelete` mở hộp hỏi.
      validateCommit(scene);
      const pending = onSceneCommit(scene).then(async (ok) => {
        // `false` mà không có lời từ chối là "không có gì để ghi" (sửa node sinh ra) — vẫn là thành công.
        if (!ok && rejection.current !== null) {
          /* Lượt bị từ chối (luật toàn vẹn, node lạ, lệnh hỏng): kho không đổi, nên đặt lại cảnh
             từ kho để 3D khớp dữ liệu thật thay vì giữ phần sửa ma. Lượt xoá nhiều đang chờ hộp hỏi
             thì giữ nguyên cảnh đã xoá: "Xoá" không phải đặt lại gì, "Huỷ" mới đặt về kho. */
          if (massDeleteRef.current?.reason !== rejection.current) revertToStore();
          throw new Error(rejection.current);
        }
        // Hoàn tác chỉ chạm node dẫn xuất (không có gì để ghi): vẫn dựng lại để cảnh hết node cũ.
        if (!ok) {
          if (restored) rebuildFromStore();
          return;
        }
        /* Dựng lại cảnh từ kho khi: vừa nhận món gợi ý (tấm viền thành mẫu thật; Ctrl+Z về cảnh còn tấm viền và
           `suggestionEditOf` trả bản ghi gợi ý), sửa cảnh của dữ liệu mới khác cảnh đang hiện (dời tường, dời món, …),
           hay vừa gỡ node dẫn xuất cũ do hoàn tác. */
        const accepted = takeSuggestionAccepted();
        if (accepted || restored || repairsStale()) rebuildFromStore();
        /* Đợi đúng lượt PUT N16 rồi mới báo Pascal "đã lưu": lượt gửi hỏng hay tầng bị khối thì
           ném, để chỉ báo của editor không nói "đã lưu" khi máy chủ chưa nhận. */
        await autosave.saveNow().catch(() => undefined);
        if (useStore.getState().unsavedFloorIds.some(isFloorBlocked)) throw new Error(BRIDGE_SAVE_BLOCKED);
        if (autosave.getState() === 'failed') throw new Error(BRIDGE_SAVE_FAILED);
      });
      lastSave = pending;
      await pending;
    },
    [autosave, isFloorBlocked, onSceneCommit, readOnly, rebuildFromStore, repairsStale, revertToStore, takeSuggestionAccepted, touchedTargetOf, validateCommit],
  );

  /* Đã xác nhận xoá nhiều: mở cổng cho đúng các node ấy rồi lưu (bản sao nông để không trúng phán
     quyết đã nhớ của cảnh cũ). Cảnh trong editor vẫn là cảnh đã xoá (lượt chờ hỏi không đặt lại), nên
     không nạp lại gì — trước đây `setScene` cả cây ở đây làm cả mô hình nháy. */
  const confirmMassDeleteNow = useCallback(() => {
    const request = massDelete;
    setMassDelete(null);
    massDeleteRef.current = null;
    if (request === null || request.scene === null) return;
    confirmMassDelete(request.nodeIds);
    void onSave({ ...(request.scene as object) }).catch(() => undefined);
  }, [confirmMassDelete, massDelete, onSave]);
  const cancelMassDelete = useCallback(() => {
    setMassDelete(null);
    massDeleteRef.current = null;
    revertToStore();
  }, [revertToStore]);

  const confirm: PascalConfirm | null = askReload
    ? {
        title: RELOAD_CONFIRM_TITLE,
        body: RELOAD_CONFIRM_BODY,
        confirmLabel: 'Bỏ phần sửa và tải lại',
        onConfirm: () => {
          setAskReload(false);
          void reloadBlockedFloor();
        },
        onCancel: () => setAskReload(false),
      }
    : massDelete !== null
      ? {
          title: MASS_DELETE_TITLE,
          body: massDeleteBodyOf(massDelete.nodeIds.length),
          confirmLabel: 'Xoá',
          onConfirm: confirmMassDeleteNow,
          onCancel: cancelMassDelete,
        }
      : null;

  /* K5/A2-06: mất mạng tách khỏi "Đang lưu…"; L3a-01: phiên hết thì báo ngay, kèm "Đăng nhập lại". */
  const sessionLost = session.status === 'anonymous';
  const save: PascalSaveStatus = {
    state: sessionLost
      ? 'session'
      : saveBlock !== null
        ? 'blocked'
        : engineState === 'failed'
          ? 'failed'
          : engineState === 'offline'
            ? 'offline'
            : engineState === 'saved'
              ? 'saved'
              : 'saving',
    label: savedLabel,
    blockMessage: sessionLost ? (engineState === 'saved' ? SESSION_LOST : SESSION_LOST_UNSAVED) : (saveBlock?.message ?? null),
    onReloadFloor: () => {
      if (useStore.getState().unsavedFloorIds.length > 0) setAskReload(true);
      else void reloadBlockedFloor();
    },
    notices,
    dismissNotice,
    loginHref: loginHrefOf(projectId),
    confirm,
  };

  return {
    ...load,
    readOnly,
    backHref,
    onLoad,
    rebaseLoaded,
    onSave,
    ...(readOnly ? {} : { save }),
  };
}
