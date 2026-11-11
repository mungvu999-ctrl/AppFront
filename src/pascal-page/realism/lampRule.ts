/**
 * Vòng 11 mốc B, làn b4 — nguyên nhân #4 (`F:/runs/m11/b0/BAO-CAO.txt`): đèn phòng (bể 12 `realism-room-light`) sáng mà
 * không có vật phát sáng; không đèn nào trong phòng đổ bóng. Hai cờ độc lập, TẮT mặc định:
 *
 * A. `?enable=lamprule`: mỗi đèn phòng gắn với một nguồn nhìn thấy. Luật (tất định, không thêm đèn, giữ cường độ):
 *    1) phòng có đèn trần thật (món `attachTo: 'ceiling'`, có hiệu ứng `light`, không âm trần) → đèn phòng dời tới bóng đèn đó;
 *    2) không thì phòng có bàn ăn → đèn ốp trần trên tâm bàn ăn;  3) còn lại → đèn ốp trần ở tâm phòng (vị trí cũ).
 *    Đèn ốp trần là lưới sinh mã (`fixtureSpec`) phát sáng cùng màu đèn, độ sáng tỉ lệ cường độ; đèn điểm đặt ngay dưới mặt
 *    phát sáng. Không đổi exposure/ambient/cường độ. Chỉ là trang trí lúc chạy (không ghi vào cảnh) → provenance qua probe.
 * B. `?enable=roomshadow`: ô 0 của bể đèn phòng bật `castShadow` NGAY LÚC TẠO bể (khoá đèn của LightsNode = id + castShadow
 *    mỗi đèn, three 0.186 `LightsNode.customCacheKey`) → không bao giờ đổi khoá về sau; mỗi khung chỉ DỜI nó tới phòng có
 *    camera (hoặc đèn gần camera nhất). Bóng cube 6 mặt `ROOM_SHADOW_MAP`², `autoUpdate = false`, vẽ lại chỉ khi đổi phòng/
 *    dời đèn/sửa cảnh.
 */
import { CylinderGeometry, Mesh, type Object3D, type PointLight, type Scene, Vector3 } from 'three';
import { color as tslColor, uniform } from 'three/tsl';
import { MeshBasicNodeMaterial } from 'three/webgpu';

import type { Polygon, RoomLightPlan } from './roomLights';

/** Hằng lật mặc định (điều phối viên đổi sau QA ảnh). `?disable=<tên>` luôn tắt. */
export const LAMP_RULE_DEFAULT = true;
export const ROOM_SHADOW_DEFAULT = false;

const params = (): URLSearchParams => new URLSearchParams(typeof location === 'undefined' ? '' : location.search);
export function flagOn(name: string, def: boolean, search?: string): boolean {
  const q = search === undefined ? params() : new URLSearchParams(search);
  if ((q.get('disable') ?? '').split(',').includes(name)) return false;
  return def || (q.get('enable') ?? '').split(',').includes(name);
}
let memo: { lamp: boolean; shadow: boolean } | undefined;
/** Đọc URL một lần: bật/tắt bóng giữa phiên = đổi khoá mọi vật liệu. */
const flags = () => (memo ??= { lamp: flagOn('lamprule', LAMP_RULE_DEFAULT), shadow: flagOn('roomshadow', ROOM_SHADOW_DEFAULT) });
export const lampRuleOn = (): boolean => flags().lamp;
export const roomShadowOn = (): boolean => flags().shadow;

/** Phòng ở (ngủ/khách/ăn/làm việc) — chỉ dùng cho số đo phủ. */
export const HABITABLE = /ngủ|khách|ăn|làm việc|sinh hoạt|bedroom|living|dining|study|office/i;
const DINING_TABLE = /dining[-_ ]?table|table[-_ ]?dining|bàn ăn/i;
const TABLE_LAMP = /table[-_ ]?lamp|lamp[-_ ]?(table|bedside)|bedside|đèn bàn|đèn ngủ/i;

/**
 * Điểm gắn mẫu đèn trần DUY NHẤT. Hôm nay là đèn ốp trần sinh mã (không tải GLB). Làn b2 đổi sang mẫu thư viện thì chỉ sửa
 * hàm này (giữ: `dropM` = khoảng từ mặt trần tới mặt phát sáng, đèn điểm đặt ngay dưới).
 */
export function fixtureSpec(): { kind: 'flush-procedural'; radiusM: number; dropM: number } {
  return { kind: 'flush-procedural', radiusM: 0.2, dropM: 0.06 };
}
/** Khe từ mặt phát sáng tới đèn điểm (m). */
export const FIXTURE_LIGHT_GAP_M = 0.03;
/** Núm chỉnh tay: độ sáng mặt đèn (màu nhân) ở cường độ tối đa `ROOM_LIGHT_MAX_CD`. */
export const FIXTURE_GAIN = 3;

export type LampKind = 'ceiling' | 'floor' | 'table';
export interface LampItem {
  id: string;
  kind: LampKind;
  /** Toạ độ tầng (cùng hệ với đa giác phòng); `y` = cao độ bóng đèn trên sàn tầng. */
  x: number;
  y: number;
  z: number;
}
export interface TableItem {
  id: string;
  x: number;
  /** Cao độ gốc món (cùng hệ `floorY` của phòng). */
  y: number;
  z: number;
}
/** Đa giác + cao độ sàn (cùng hệ toạ độ với món); `floorY` lọc món tầng khác chồng cùng x/z. */
export interface RoomShape {
  polygon: Polygon;
  floorY?: number;
}
/** Món thuộc phòng: trong đa giác và (nếu biết `floorY`) cao độ trong [sàn − 0,5, sàn + 4,5] m. */
export function inRoom(item: { x: number; y: number; z: number }, room: RoomShape): boolean {
  if (room.floorY !== undefined && (item.y < room.floorY - 0.5 || item.y > room.floorY + 4.5)) return false;
  return inside(item.x, item.z, room.polygon);
}
export type AnchorSource = 'existing-ceiling' | 'rule-dining' | 'rule-center';
export interface LampAnchor {
  source: AnchorSource;
  /** id món neo (đèn thật / bàn ăn); `undefined` với tâm phòng. */
  ref?: string;
  x: number;
  z: number;
  /** Cao độ bóng đèn khi neo đèn thật; `undefined` = theo trần. */
  y?: number;
  /** Cần lưới ốp trần sinh mã. */
  fixture: boolean;
}

function inside(x: number, z: number, poly: Polygon): boolean {
  let c = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [xi, zi] = poly[i]!;
    const [xj, zj] = poly[j]!;
    if (zi > z !== zj > z && x < ((xj - xi) * (z - zi)) / (zj - zi) + xi) c = !c;
  }
  return c;
}
const byId = <T extends { id: string }>(a: T, b: T): number => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);

/**
 * Luật A (thuần): mỗi mục kế hoạch → một neo. Phòng bị `lamp-cal` chia nhiều đèn giữ điểm chia (mỗi điểm một ốp trần).
 * Tất định: ứng viên sắp theo id. Không thêm/bớt mục → không vượt bể.
 */
export function planLampAnchors(
  plan: readonly RoomLightPlan[],
  rooms: readonly RoomShape[],
  lamps: readonly LampItem[],
  tables: readonly TableItem[],
): LampAnchor[] {
  const perRoom = new Map<number, number>();
  for (const p of plan) perRoom.set(p.index, (perRoom.get(p.index) ?? 0) + 1);
  const used = new Set<string>();
  return plan.map((p) => {
    const room = rooms[p.index]!;
    if (perRoom.get(p.index) === 1) {
      const lamp = lamps.filter((l) => l.kind === 'ceiling' && !used.has(l.id) && inRoom(l, room)).sort(byId)[0];
      if (lamp) {
        used.add(lamp.id);
        return { source: 'existing-ceiling', ref: lamp.id, x: lamp.x, z: lamp.z, y: lamp.y, fixture: false };
      }
      const table = tables.filter((t) => inRoom(t, room)).sort(byId)[0];
      if (table) return { source: 'rule-dining', ref: table.id, x: table.x, z: table.z, fixture: true };
    }
    return { source: 'rule-center', x: p.x, z: p.z, fixture: true };
  });
}

/** Phòng có ít nhất một nguồn nhìn thấy: có đèn phòng gắn neo, hoặc có đèn thật bất kỳ (bàn/đứng/trần) trong phòng. */
export function roomsWithVisibleSource(
  rooms: readonly RoomShape[],
  anchoredRooms: ReadonlySet<number>,
  lamps: readonly LampItem[],
): boolean[] {
  return rooms.map((r, i) => anchoredRooms.has(i) || lamps.some((l) => inRoom(l, r)));
}

// ── Runtime ────────────────────────────────────────────────────────────────────────────────────────────

interface ItemNodeLike {
  type?: string;
  asset?: {
    id?: string;
    name?: string;
    attachTo?: string;
    recessed?: boolean;
    interactive?: { effects?: { kind: string; offset?: number[] }[] };
  };
}
interface RegistryLike {
  nodes: Map<string, Object3D>;
  byType: Record<string, Set<string> | undefined>;
}

const _p = new Vector3();
const _q = new Vector3();

/** Đèn thật + bàn ăn trong toạ độ của `frame` (vật tầng — zone). Bóng đèn = vị trí thế giới + `offset` (không nhân tỉ lệ, như vendor). */
export function collectRoomItems(
  registry: RegistryLike,
  nodes: Record<string, unknown>,
  frame: Object3D,
): { lamps: LampItem[]; tables: TableItem[] } {
  const lamps: LampItem[] = [];
  const tables: TableItem[] = [];
  for (const id of registry.byType.item ?? []) {
    const obj = registry.nodes.get(id);
    const asset = (nodes[id] as ItemNodeLike | undefined)?.asset;
    if (!obj || !asset) continue;
    let shownObj = true;
    for (let o: Object3D | null = obj; o; o = o.parent) if (!o.visible) shownObj = false;
    if (!shownObj) continue;
    const label = `${asset.id ?? ''} ${asset.name ?? ''}`;
    const light = asset.interactive?.effects?.find((e) => e.kind === 'light');
    if (light && !asset.recessed) {
      obj.getWorldPosition(_p);
      const off = light.offset ?? [0, 0, 0];
      _p.add(_q.set(off[0] ?? 0, off[1] ?? 0, off[2] ?? 0));
      frame.worldToLocal(_p);
      const kind: LampKind = asset.attachTo === 'ceiling' ? 'ceiling' : TABLE_LAMP.test(label) ? 'table' : 'floor';
      lamps.push({ id, kind, x: _p.x, y: _p.y, z: _p.z });
    } else if (DINING_TABLE.test(label)) {
      frame.worldToLocal(obj.getWorldPosition(_p));
      tables.push({ id, x: _p.x, y: _p.y, z: _p.z });
    }
  }
  return { lamps, tables };
}

/** Độ sáng mặt đèn (hệ số màu) theo cường độ đèn điểm của nó. */
export const fixtureRadiance = (intensity: number, maxCd: number): number => (FIXTURE_GAIN * Math.max(0, intensity)) / maxCd;

const fixtureGeo = (() => {
  let g: CylinderGeometry | undefined;
  return () => (g ??= new CylinderGeometry(fixtureSpec().radiusM, fixtureSpec().radiusM * 1.08, fixtureSpec().dropM, 32));
})();

const fixtures: Mesh[] = [];
function fixtureAt(i: number, scene: Scene, hex: number): Mesh {
  let m = fixtures[i];
  if (!m) {
    const mat = new MeshBasicNodeMaterial();
    const level = uniform(0);
    // Một cấu trúc node cho mọi ốp trần (cường độ là uniform) → một khoá shader.
    mat.colorNode = tslColor(hex).mul(level);
    m = new Mesh(fixtureGeo(), mat);
    m.userData.level = level;
    m.name = 'realism-lamp-fixture';
    m.castShadow = false;
    m.receiveShadow = false;
    m.raycast = () => {};
    fixtures[i] = m;
  }
  if (m.parent !== scene) scene.add(m);
  return m;
}

export interface LampRuleRoomReport {
  name: string;
  habitable: boolean;
  visibleSource: boolean;
  anchors: { source: AnchorSource; ref?: string; intensity: number; fixture: boolean }[];
}
const report = {
  rooms: [] as LampRuleRoomReport[],
  shadow: { casters: 0, mapSize: 0, updates: 0, lastUpdateMs: null as number | null, room: null as string | null },
};

export interface AppliedLight {
  plan: RoomLightPlan;
  anchor?: LampAnchor;
  /** Vị trí thế giới của đèn điểm. */
  world: Vector3;
  /** Cao độ mặt trần thế giới (cho ốp trần). */
  ceilingY: number;
}

/** Ốp trần cho mỗi đèn phòng đang sáng; ẩn khi camera ở trên trần (nhìn từ trên xuống trần không vẽ) hoặc tắt cờ. */
export function syncFixtures(scene: Scene, lights: readonly AppliedLight[], hex: number, maxCd: number, cameraY: number): void {
  let n = 0;
  if (lampRuleOn()) {
    for (const a of lights) {
      if (!a.anchor?.fixture || !(a.plan.intensity > 0)) continue;
      const m = fixtureAt(n++, scene, hex);
      const spec = fixtureSpec();
      m.position.set(a.world.x, a.ceilingY - spec.dropM / 2, a.world.z);
      (m.userData.level as { value: number }).value = fixtureRadiance(a.plan.intensity, maxCd);
      m.visible = cameraY < a.ceilingY;
    }
  }
  for (let i = n; i < fixtures.length; i++) fixtures[i]!.visible = false;
}

export function setRoomReport(rooms: LampRuleRoomReport[]): void {
  report.rooms = rooms;
}

// ── B: bóng ──────────────────────────────────────────────────────────────────────────────────────────────

/** Số đèn đổ bóng CỐ ĐỊNH (đổi số này = đổi khoá mọi vật liệu nhận bóng). */
export const ROOM_SHADOW_CASTERS = 1;
export const ROOM_SHADOW_MAP = 512;

/** Cấu hình đèn đổ bóng lúc tạo bể (gọi đúng một lần mỗi đèn, trước lượt vẽ đầu). */
export function setupShadowCaster(l: PointLight, scene: Scene): void {
  l.castShadow = true;
  l.shadow.mapSize.set(ROOM_SHADOW_MAP, ROOM_SHADOW_MAP);
  l.shadow.autoUpdate = false;
  l.shadow.needsUpdate = true;
  l.shadow.bias = -0.002;
  l.shadow.normalBias = 0.02;
  report.shadow.casters = ROOM_SHADOW_CASTERS;
  report.shadow.mapSize = ROOM_SHADOW_MAP;
  hookTiming(scene, l);
}

/** Đo thời gian CPU các lượt vẽ bóng của đèn (bọc scene.onBefore/AfterRender, giữ hàm cũ). */
function hookTiming(scene: Scene, l: PointLight): void {
  const before = scene.onBeforeRender;
  const after = scene.onAfterRender;
  let t0 = 0;
  let acc = 0;
  let lastFrame = -1;
  scene.onBeforeRender = function (...args) {
    if (args[2] === l.shadow.camera) t0 = performance.now();
    before.apply(this, args);
  };
  scene.onAfterRender = function (...args) {
    after.apply(this, args);
    if (args[2] !== l.shadow.camera || !t0) return;
    const frame = (args[0] as { info?: { frame?: number } }).info?.frame ?? -1;
    acc = frame === lastFrame ? acc + performance.now() - t0 : performance.now() - t0; // cube = nhiều lượt trong một khung
    lastFrame = frame;
    report.shadow.lastUpdateMs = Math.round(acc * 10) / 10;
    t0 = 0;
  };
}

const camPos = new Vector3();
let camSeen = false;
const tracked = new WeakSet<Scene>();
/** Vị trí camera chính của lượt vẽ trước (bỏ lượt bóng: `overrideMaterial.isShadowPassMaterial`). */
export function trackCamera(scene: Scene): Vector3 | undefined {
  if (!tracked.has(scene)) {
    tracked.add(scene);
    const before = scene.onBeforeRender;
    scene.onBeforeRender = function (...args) {
      const cam = args[2] as Object3D & { isCamera?: boolean };
      const ov = (args[1] as Scene).overrideMaterial as { isShadowPassMaterial?: boolean } | null;
      if (cam?.isCamera && !ov?.isShadowPassMaterial) {
        cam.getWorldPosition(camPos);
        camSeen = true;
      }
      before.apply(this, args);
    };
  }
  return camSeen ? camPos : undefined;
}

/** Thứ tự ưu tiên ô 0 (đèn đổ bóng): phòng chứa camera, không thì đèn gần camera nhất (ngang). Trả chỉ số trong `plan`. */
export function shadowSlotIndex(
  plan: readonly RoomLightPlan[],
  rooms: readonly { polygon: Polygon }[],
  cam: { x: number; z: number } | undefined,
): number {
  if (!cam || !plan.length) return 0;
  const inRoom = plan.findIndex((p) => inside(cam.x, cam.z, rooms[p.index]!.polygon));
  if (inRoom >= 0) return inRoom;
  let best = 0;
  let bestD = Infinity;
  plan.forEach((p, i) => {
    const d = (p.x - cam.x) ** 2 + (p.z - cam.z) ** 2;
    if (d < bestD) [best, bestD] = [i, d];
  });
  return best;
}

let lastShadowKey = '';
let lastNodes: unknown;
/** Vẽ lại bóng chỉ khi đèn đổ bóng đổi chỗ (> 1 cm) / bật-tắt, hoặc cảnh đổi (`nodes` là đối tượng mới sau mỗi sửa). */
export function maybeUpdateShadow(l: PointLight, nodes: unknown, roomName: string | null): void {
  const key = `${Math.round(l.position.x * 100)},${Math.round(l.position.y * 100)},${Math.round(l.position.z * 100)},${l.intensity > 0 ? 1 : 0}`;
  if (key === lastShadowKey && nodes === lastNodes) return;
  lastShadowKey = key;
  lastNodes = nodes;
  l.shadow.needsUpdate = true;
  report.shadow.updates++;
  report.shadow.room = roomName;
}

/** `window.__pascalProbe.lampRule()`. */
export function lampRuleReport() {
  const hab = report.rooms.filter((r) => r.habitable);
  return {
    lamprule: lampRuleOn(),
    roomshadow: roomShadowOn(),
    habitableWithSource: hab.filter((r) => r.visibleSource).length,
    habitableTotal: hab.length,
    roomsWithSource: report.rooms.filter((r) => r.visibleSource).length,
    roomsTotal: report.rooms.length,
    fixtures: fixtures.filter((m) => m.visible).length,
    rooms: report.rooms,
    shadow: { ...report.shadow },
  };
}
