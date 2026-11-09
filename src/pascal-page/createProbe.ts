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
  /** Bật/tắt mọi đèn (công tắc trong `useInteractive.lampItems`) — C10 đo màu sàn khi tắt đèn. */
  setLights(on: boolean): void;
  /** Chẩn đoán vật liệu lúc chạy của các item có `src` chứa `match` (tên, loại, trong suốt, màu, kim loại, nhám, map). */
  itemMaterials(match: string): Record<string, unknown>[];
  /** Số đo reflection probe (`realism/reflect.ts`): số lần chụp, ms CPU, số vật liệu bóng. */
  reflect(): unknown;
  /** Đổi nút vật liệu/phơi sáng lúc chạy (đo biến thể cùng một lần nạp): nhiễu bề mặt, kính, exposure. */
  setLook(v: { surf?: { rough?: number; albedo?: number; scale?: number }; exposure?: number; grade?: { contrast?: number; saturation?: number } }): void;
  /** Các lần sửa cảnh (`SceneRepair`: món, hành động, luật, lý do, trước/sau) mà lượt dựng gần nhất đã áp. */
  repairs(): readonly unknown[];
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
}

export const createPascalProbe = ({ useScene, useViewer, sceneRegistry, emitter, useInteractive, look, repairs }: PascalProbeStores): PascalProbe => {
  const nodes = () => useScene.getState().nodes as Record<string, LooseNode>;
  const entries = () => Object.entries(nodes());
  const entriesOf = (type: string) => entries().filter(([, n]) => n.type === type);

  return {
    // Có node và mọi item đã ổn (tải xong hoặc hỏng hẳn). Cảnh mặc định của editor trước khi
    // `onLoad` về cũng "sẵn sàng" — bài kiểm ghép thêm `counts()` với số mong đợi.
    ready: () =>
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
    setLights: (on) => {
      const { lampItems, setControlValue } = useInteractive.getState();
      for (const [id, indices] of Object.entries(lampItems)) for (const i of indices) setControlValue(id, i, on);
    },
    repairs: () => [...(repairs?.() ?? [])],
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

/** Gắn đầu dò lên `window` khi và chỉ khi `?probe=1`; không cờ thì không làm gì. */
export const installPascalProbe = (search: string, target: { __pascalProbe?: PascalProbe }, stores: PascalProbeStores) => {
  if (new URLSearchParams(search).get('probe') === '1') target.__pascalProbe = createPascalProbe(stores);
};
