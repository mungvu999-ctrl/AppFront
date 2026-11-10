/**
 * Thân đầu dò `?probe=1` (I5), tách khỏi `./probe` để vitest chạy được: hàm nhận store
 * Pascal qua tham số, không nhập `@pascal-app/*` (vitest không nạp được gói khi chưa dựng
 * `dist/*.js`). Nơi gắn store thật lên `window` là `./probe`.
 *
 * Chỉ đọc store, trừ `setCamera`, `setLights` và `editNode` (móc kiểm thử C13: sửa một node qua đúng
 * `useScene.updateNode` như inspector, để luồng tự lưu thật — `onSave` → N16 PUT — chạy). Lượt hỏng tải mô hình đọc từ `useViewer.itemLoadFailures`
 * (vendor `nodes/src/item/renderer.tsx`), "đã xong" đọc từ `userData.itemModelSettled` trên
 * nhóm item trong `sceneRegistry`.
 *
 * Giới hạn của `setCamera`: đi qua sự kiện `camera-controls:apply-pose` của editor, nên máy
 * quay **trượt dần** tới tư thế mới qua vài khung (không nhảy ngay), và bị bỏ qua ở chế độ
 * góc nhìn thứ nhất. Bài kiểm phải chờ một nhịp trước khi chụp.
 */

type Vec3 = [number, number, number];

export interface PascalProbe {
  ready(): boolean;
  counts(): Record<string, number>;
  itemLoadFailures(): Record<string, unknown>;
  materials(): { slabs: Record<string, string | undefined>; walls: Record<string, unknown> };
  shading(): string | undefined;
  setCamera(pos: Vec3, target: Vec3, fov: number | 'top-ortho'): void;
  /** Hình học tường (m, toạ độ tầng) cho C9. */
  walls(): ProbeWall[];
  /** Phòng (node `zone`): id, công năng (`metadata.appfront.usage`), đa giác (m, toạ độ tầng), tầng. */
  rooms(): ProbeRoom[];
  /** Cửa đi/cửa sổ: `position[0]` = khoảng cách (m) từ đầu tường `wallId` tới tâm ô mở, `position[1]` = cao độ tâm. */
  openings(): ProbeOpening[];
  /** Vị trí, góc quay (rad) và mô hình của item cho C8. */
  items(): ProbeItem[];
  /** Móc kiểm thử C13: `useScene.updateNode(id, patch)` — chỉ có khi `?probe=1`. */
  editNode(id: string, patch: object): void;
  /** Bản sao JSON của một node (đọc trước `editNode` để vá sâu, vd. `metadata`); `null` khi không có. */
  node(id: string): unknown;
  /** Bật/tắt mọi đèn (công tắc trong `useInteractive.lampItems`) — C10 đo màu sàn khi tắt đèn. */
  setLights(on: boolean): void;
  /** Chẩn đoán vật liệu lúc chạy của các item có `src` chứa `match` (tên, loại, trong suốt, màu, kim loại, nhám, map). */
  itemMaterials(match: string): Record<string, unknown>[];
  /** Tone mapper THẬT của renderer lúc chạy (M6 làn A): số + tên three, phơi sáng, không gian màu ra, backend, cờ `?tone=`. */
  renderer(): ProbeRenderer | null;
  /** Đối tượng three THÔ để thí nghiệm cô lập lúc chạy (M7): renderer + gốc cảnh (đi ngược `parent` từ một node đã đăng ký). */
  raw(): { gl: unknown; scene: unknown } | null;
  /** Số đo reflection probe (`realism/reflect.ts`): số lần chụp, ms CPU, số vật liệu bóng. */
  reflect(): unknown;
  /** Đổi nút vật liệu/phơi sáng lúc chạy (đo biến thể cùng một lần nạp): nhiễu bề mặt, kính, exposure. */
  setLook(v: { surf?: { rough?: number; albedo?: number; scale?: number }; exposure?: number; grade?: { contrast?: number; saturation?: number } }): void;
  /** Các lần sửa cảnh (`SceneRepair`: món, hành động, luật, lý do, trước/sau) mà lượt dựng gần nhất đã áp. */
  repairs(): readonly unknown[];
  /** Tóm tắt lớp dẫn xuất (`SceneLayerSummary`) của lượt dựng gần nhất; `null` khi chưa dựng. */
  layer(): unknown;
  /**
   * Nhật ký lượt dựng/áp cảnh (`sceneTrace`) + ảnh chụp kho editor NGAY LÚC GỌI (`now`): so `now` với dòng cuối để
   * tách "kho thiếu món" (dữ liệu) khỏi "kho đủ mà không vẽ" (tải mẫu/ảnh); `serverModelsNow` > `serverModels` của
   * lượt dựng = thư viện máy chủ về SAU lượt dựng (H1).
   */
  sceneState(): ReturnType<SceneTrace['state']> & { now: SceneSummary & { serverModelsNow?: number; itemLoadFailures: number } };
}

export interface ProbeItem {
  id: string;
  position: Vec3 | undefined;
  rotation: Vec3 | undefined;
  src: string | undefined;
  /** Cỡ thật = mẫu × `assetScale` (đo sai cỡ C3); `dimensions` là hộp bao node. */
  assetScale: Vec3 | undefined;
  dimensions: Vec3 | undefined;
}

export interface ProbeRoom {
  id: string;
  name: string | undefined;
  usage: string | undefined;
  polygon: [number, number][];
  levelId: string | undefined;
  /** Số thứ tự tầng (`level.level`, 0 = tầng trệt); undefined khi không đọc được. */
  levelIndex: number | undefined;
}

export interface ProbeOpening {
  id: string;
  type: 'door' | 'window';
  wallId: string | undefined;
  position: Vec3 | undefined;
  width: number | undefined;
}

export interface ProbeWall {
  id: string;
  start: [number, number];
  end: [number, number];
  thickness: number | undefined;
  height: number | undefined;
}

interface LooseNode {
  readonly type: string;
  readonly slots?: Record<string, string>;
  readonly materialPreset?: string;
  readonly skirting?: unknown;
  readonly crown?: unknown;
  readonly start?: [number, number];
  readonly end?: [number, number];
  readonly thickness?: number;
  readonly height?: number;
  readonly position?: Vec3;
  readonly rotation?: Vec3;
  readonly name?: string;
  readonly level?: number;
  readonly wallId?: string;
  readonly width?: number;
  readonly parentId?: string;
  readonly polygon?: [number, number][];
  readonly metadata?: { readonly appfront?: { readonly fields?: { readonly usage?: string } } };
  readonly asset?: { readonly src?: string; readonly scale?: Vec3; readonly dimensions?: Vec3 };
}

export interface ProbeRenderer {
  toneMapping: number;
  toneMappingName: string;
  toneMappingExposure: number;
  outputColorSpace: string;
  backend: string;
  tone: string | null;
}

/** Hằng tone mapping của three (constants.js). */
const TONE_NAMES = ['None', 'Linear', 'Reinhard', 'Cineon', 'ACESFilmic', 'Custom', 'AgX', 'Neutral'];

interface ProbeObject {
  name: string;
  material?: ProbeMaterial | ProbeMaterial[];
}
interface ProbeMaterial {
  name: string;
  type: string;
  transparent?: boolean;
  opacity?: number;
  metalness?: number;
  roughness?: number;
  side?: number;
  color?: { getHexString(): string };
  map?: unknown;
}

type CameraPose =
  | { position: Vec3; target: Vec3; projection: 'orthographic' }
  | { position: Vec3; target: Vec3; projection: 'perspective'; fov: number };

/** Đúng phần store Pascal mà đầu dò đọc; `./probe` truyền store thật vào. */
export interface PascalProbeStores {
  readonly useScene: { getState(): { nodes: object; updateNode(id: string, data: object): void } };
  readonly useViewer: { getState(): { itemLoadFailures: object; shading?: string } };
  readonly sceneRegistry: {
    nodes: { get(id: string): { userData: Record<string, unknown>; traverse?(fn: (o: ProbeObject) => void): void } | undefined };
  };
  readonly emitter: { emit(event: 'camera-controls:apply-pose', pose: CameraPose): void };
  readonly useInteractive: {
    getState(): { lampItems: Record<string, number[]>; setControlValue(id: string, index: number, value: boolean): void };
  };
  /** Nút đổi lúc chạy (main.tsx nối vào realism): nhiễu bề mặt, kính, exposure mọi chủ đề. */
  readonly look?: {
    surf(v: { rough?: number; albedo?: number; scale?: number }): void;
    exposure(v: number): void;
    grade(v: { contrast?: number; saturation?: number }): void;
  };
  /** Danh sách sửa cảnh hiện hành (`sceneRepairStore`). */
  readonly repairs?: () => readonly unknown[];
  readonly layer?: () => unknown;
  /** Renderer hiện hành (`realism/backend` `currentRenderer`) + biến thể tone đang áp. */
  readonly renderer?: () => { gl: unknown; backend: string; tone: string | null } | undefined;
  /** Nhật ký lượt dựng cảnh; mặc định `sceneTrace` của trang. */
  readonly trace?: SceneTrace;
}

export const createPascalProbe = ({ useScene, useViewer, sceneRegistry, emitter, useInteractive, look, repairs, layer, renderer, trace = sceneTrace }: PascalProbeStores): PascalProbe => {
  const nodes = () => useScene.getState().nodes as Record<string, LooseNode>;
  const entries = () => Object.entries(nodes());
  const entriesOf = (type: string) => entries().filter(([, n]) => n.type === type);

  return {
    // Thư viện + concept đã chốt (không lượt đọc nào còn treo có thể đổi nội dung), có node và mọi item đã ổn (tải xong hoặc hỏng hẳn). Cảnh mặc định của editor trước khi
    // `onLoad` về cũng "sẵn sàng" — bài kiểm ghép thêm `counts()` với số mong đợi.
    ready: () =>
      trace.settled() &&
      entries().length > 0 &&
      entriesOf('item').every(([id]) => sceneRegistry.nodes.get(id)?.userData.itemModelSettled === true),
    counts: () => {
      const counts: Record<string, number> = {};
      for (const [, { type }] of entries()) counts[type] = (counts[type] ?? 0) + 1;
      return counts;
    },
    itemLoadFailures: () => ({ ...useViewer.getState().itemLoadFailures }),
    materials: () => ({
      slabs: Object.fromEntries(entriesOf('slab').map(([id, n]) => [id, n.slots?.surface ?? n.materialPreset])),
      walls: Object.fromEntries(
        entriesOf('wall').map(([id, n]) => [id, { slots: n.slots, skirting: n.skirting, crown: n.crown }]),
      ),
    }),
    shading: () => useViewer.getState().shading,
    setLook: (v) => {
      if (v.surf) look?.surf(v.surf);
      if (v.exposure !== undefined) look?.exposure(v.exposure);
      if (v.grade) look?.grade(v.grade);
    },
    setCamera: (position, target, fov) =>
      emitter.emit(
        'camera-controls:apply-pose',
        fov === 'top-ortho'
          ? { position, target, projection: 'orthographic' }
          : { position, target, projection: 'perspective', fov },
      ),
    walls: () =>
      entriesOf('wall').map(([id, n]) => ({
        id,
        start: n.start ?? [0, 0],
        end: n.end ?? [0, 0],
        thickness: n.thickness,
        height: n.height,
      })),
    rooms: () =>
      entriesOf('zone').map(([id, n]) => ({
        id,
        name: n.name,
        usage: n.metadata?.appfront?.fields?.usage,
        polygon: n.polygon ?? [],
        levelId: n.parentId,
        levelIndex: n.parentId === undefined ? undefined : (nodes()[n.parentId] as LooseNode | undefined)?.level,
      })),
    openings: () =>
      entries()
        .filter(([, n]) => n.type === 'window' || n.type === 'door')
        .map(([id, n]) => ({ id, type: n.type as 'door' | 'window', wallId: n.wallId, position: n.position, width: n.width })),
    items: () =>
      entriesOf('item').map(([id, n]) => ({
        id,
        position: n.position,
        rotation: n.rotation,
        src: n.asset?.src,
        assetScale: n.asset?.scale,
        dimensions: n.asset?.dimensions,
      })),
    editNode: (id, patch) => useScene.getState().updateNode(id, patch),
    node: (id) => {
      const found = nodes()[id];
      return found === undefined ? null : (JSON.parse(JSON.stringify(found)) as unknown);
    },
    setLights: (on) => {
      const { lampItems, setControlValue } = useInteractive.getState();
      for (const [id, indices] of Object.entries(lampItems)) for (const i of indices) setControlValue(id, i, on);
    },
    repairs: () => [...(repairs?.() ?? [])],
    layer: () => layer?.() ?? null,
    sceneState: () => ({
      ...trace.state(),
      now: {
        ...summarizeScene(nodes()),
        ...(trace.countServerModels === undefined ? {} : { serverModelsNow: trace.countServerModels() }),
        itemLoadFailures: Object.keys(useViewer.getState().itemLoadFailures).length,
      },
    }),
    renderer: () => {
      const r = renderer?.();
      const gl = r?.gl as { toneMapping?: number; toneMappingExposure?: number; outputColorSpace?: string } | undefined;
      if (!r || !gl || gl.toneMapping === undefined) return null;
      return {
        toneMapping: gl.toneMapping,
        toneMappingName: TONE_NAMES[gl.toneMapping] ?? String(gl.toneMapping),
        toneMappingExposure: gl.toneMappingExposure ?? Number.NaN,
        outputColorSpace: gl.outputColorSpace ?? '',
        backend: r.backend,
        tone: r.tone,
      };
    },
    raw: () => {
      const gl = renderer?.()?.gl;
      for (const [id] of entries()) {
        let o = sceneRegistry.nodes.get(id) as { parent?: unknown } | undefined;
        if (!o) continue;
        while ((o as { parent?: unknown }).parent) o = (o as { parent: { parent?: unknown } }).parent;
        return { gl, scene: o };
      }
      return null;
    },
    reflect: () => ({ ...((globalThis as { __realismReflect?: object }).__realismReflect ?? {}) }),
    itemMaterials: (match) => {
      const out: Record<string, unknown>[] = [];
      for (const [id, n] of entriesOf('item')) {
        if (!n.asset?.src?.includes(match)) continue;
        sceneRegistry.nodes.get(id)?.traverse?.((o) => {
          for (const m of [o.material ?? []].flat())
            out.push({
              id, mesh: o.name, name: m.name, type: m.type, transparent: m.transparent, opacity: m.opacity,
              metalness: m.metalness, roughness: m.roughness, side: m.side, color: m.color?.getHexString(), map: Boolean(m.map),
            });
        });
      }
      return out;
    },
  };
};

/* ---------------------------------------------------------------------------------------------------------------
 * Nhật ký lượt dựng cảnh (S1 vòng 8): mỗi lượt cầu nối dựng cảnh từ kho (`built`) và mỗi lượt cảnh ấy vào kho editor
 * (`full`/`partial`) ghi một dòng có số `gen` tăng dần — thấy được lượt cũ đè lượt mới hay cảnh trung gian bị giữ.
 * Chỉ ghi khi `?probe=1`; mảng ≤ 50 dòng; không log console; không đổi hành vi.
 * ------------------------------------------------------------------------------------------------------------- */

export type SceneApplied = 'built' | 'full' | 'partial';

export interface SceneSummary {
  /** Số node `item` của cảnh. */
  readonly nItemsScene: number;
  /** Số item do FE sinh (`metadata.generated`). */
  readonly nGenerated: number;
  /** Vật liệu mặt sàn (`slots.surface`/`materialPreset`) → số tấm sàn. */
  readonly slabMaterials: Readonly<Record<string, number>>;
}

export interface SceneBuild extends SceneSummary {
  readonly gen: number;
  /** ms từ navigationStart (`performance.now()`). */
  readonly at: number;
  readonly reason: string;
  readonly applied: SceneApplied;
  readonly style?: string;
  readonly furnish?: string;
  readonly raw?: boolean;
  readonly repairsEnabled?: boolean;
  readonly nLevels?: number;
  readonly nFurnitureStored?: number;
  /** Số mẫu thư viện máy chủ đã đăng ký LÚC dựng (giả thuyết H1: thư viện về trễ sau lượt dựng). */
  readonly serverModels?: number;
  readonly readOnly?: boolean;
}

interface LooseSceneNode {
  readonly type?: string;
  readonly slots?: Record<string, string>;
  readonly materialPreset?: string;
  readonly metadata?: { readonly generated?: unknown };
}

export const summarizeScene = (nodes: object): SceneSummary => {
  let nItemsScene = 0;
  let nGenerated = 0;
  const slabMaterials: Record<string, number> = {};
  for (const node of Object.values(nodes as Record<string, LooseSceneNode>)) {
    if (node.type === 'item') {
      nItemsScene += 1;
      if (node.metadata?.generated !== undefined) nGenerated += 1;
    } else if (node.type === 'slab') {
      const material = node.slots?.surface ?? node.materialPreset ?? '?';
      slabMaterials[material] = (slabMaterials[material] ?? 0) + 1;
    }
  }
  return { nItemsScene, nGenerated, slabMaterials };
};

/** Cảnh editor so với lượt dựng: thiếu item hay sàn khác → `partial`. */
export const appliedOf = (built: SceneSummary, held: SceneSummary): 'full' | 'partial' =>
  held.nItemsScene >= built.nItemsScene && JSON.stringify(held.slabMaterials) === JSON.stringify(built.slabMaterials)
    ? 'full'
    : 'partial';

const MAX_BUILDS = 50;

export const createSceneTrace = (enabled: boolean, now: () => number = () => performance.now()) => {
  let generation = 0;
  const builds: SceneBuild[] = [];
  const sources: { library?: string; concept?: string } = {};
  const settled = (): boolean => sources.library !== undefined && sources.concept !== undefined;
  const lastBuilt = (): SceneBuild | undefined => [...builds].reverse().find((b) => b.applied === 'built');
  return {
    enabled,
    /** Đếm mẫu thư viện máy chủ đã đăng ký (cầu nối gắn; createProbe không nhập danh mục). */
    countServerModels: undefined as (() => number) | undefined,
    /**
     * Nguồn dữ liệu cuối của cảnh (S2 vòng 8): `library` = `server` | `fallback:<lý do>`, `concept` = `done` | `none` |
     * `fallback:<lý do>`. Ghi cả khi tắt (hai chuỗi): `ready` cần biết không còn lượt đọc nào treo.
     */
    source(key: 'library' | 'concept', value: string): void {
      sources[key] = value;
    },
    settled,
    /** Ghi một lượt dựng; trả `gen` (0 khi tắt). */
    built(entry: Omit<SceneBuild, 'gen' | 'at' | 'applied'>): number {
      if (!enabled) return 0;
      generation += 1;
      builds.push({ ...entry, gen: generation, at: Math.round(now()), applied: 'built' });
      if (builds.length > MAX_BUILDS) builds.shift();
      return generation;
    },
    /** Ghi cảnh editor đang giữ sau một lượt áp, so với lượt dựng gần nhất. */
    held(reason: string, nodes: object, extra: { readonly readOnly?: boolean } = {}): void {
      if (!enabled) return;
      const summary = summarizeScene(nodes);
      const built = lastBuilt();
      generation += 1;
      builds.push({
        ...summary,
        ...extra,
        gen: generation,
        at: Math.round(now()),
        reason: built === undefined ? reason : `${reason}<-gen${built.gen}`,
        applied: built === undefined ? 'partial' : appliedOf(built, summary),
      });
      if (builds.length > MAX_BUILDS) builds.shift();
    },
    /** `ready`: nguồn đã chốt và dòng cuối là lượt áp `full` của lượt dựng mới nhất. */
    state(): { generation: number; builds: SceneBuild[]; ready: boolean; library?: string; concept?: string } {
      const last = builds[builds.length - 1];
      return { generation, builds: [...builds], ...sources, ready: settled() && last?.applied === 'full' };
    },
  };
};

export type SceneTrace = ReturnType<typeof createSceneTrace>;

/** Nhật ký dùng chung của trang (cầu nối + main.tsx ghi, đầu dò đọc). */
export const sceneTrace: SceneTrace = createSceneTrace(
  typeof location !== 'undefined' && new URLSearchParams(location.search).get('probe') === '1',
);

/** Gắn đầu dò lên `window` khi và chỉ khi `?probe=1`; không cờ thì không làm gì. */
export const installPascalProbe = (search: string, target: { __pascalProbe?: PascalProbe }, stores: PascalProbeStores) => {
  if (new URLSearchParams(search).get('probe') === '1') target.__pascalProbe = createPascalProbe(stores);
};
