/**
 * Vòng 6 làn A — `?light=room-clip`: đèn điểm trong nhà chỉ chiếu trong phòng chứa nó.
 *
 * Gốc (đo lúc chạy, `F:/runs/m6/lA/BAO-CAO.md`): mọi đèn điểm (đèn phòng `roomLights.ts`, đèn âm trần/đèn đồ của
 * pool vendor, đèn cửa sổ `windowLight.ts`) đều `castShadow = false` → ánh sáng đi xuyên tường/sàn sang mọi điểm
 * trong tầm (3–7 m). Bóng cube cho ≤ 24 đèn quá đắt và vượt giới hạn texture mỗi shader; thay vào đó nhân phần chiếu
 * trực tiếp của đèn với mặt nạ HỘP PHÒNG (AABB đa giác phòng chứa đèn, nới `ROOM_CLIP_MARGIN_M` cho mặt trong của
 * tường, mép mềm `ROOM_CLIP_EDGE_M`; đáy = sàn tầng, đỉnh = sàn tầng trên). Tường kề có mặt hướng về đèn vẫn sáng
 * đúng; sàn/tường/đồ của phòng bên và tầng dưới không nhận đèn này nữa.
 *
 * Cửa đi / ô trống (cổng): ánh sáng đi tiếp qua tối đa `PORTALS_PER_LIGHT` ô mở trên biên phòng của đèn. Điểm P ngoài
 * hộp vẫn nhận đèn nếu tia đèn→P cắt mặt phẳng ô mở trong khung ô (mép mềm `PORTAL_EDGE_M` đo trong mặt ô), nhân suy giảm
 * mềm theo khoảng cách sau ô (`PORTAL_FADE_M`). Ngay sau ngưỡng hệ số = 1 → không có vệt cắt thẳng; sau tường đặc = 0.
 *
 * Cách gắn: vá `setupDirect` của `PointLightNode`/`SpotLightNode` (three r186) MỘT LẦN khi cờ bật — lightColor ×
 * mặt nạ theo `positionWorld`. Mỗi đèn: uniform hộp (min/max), vị trí đèn, 3 cổng × (vec4, vec4, vec3), cập nhật mỗi khung
 * (`syncRoomClip`); đèn ngoài mọi phòng giữ hộp vô hạn. Không cờ → không vá gì, shader y hệt hôm nay. Chạy cả WebGL2.
 *
 * Vòng 7: mặt XZ cắt theo ĐA GIÁC phòng (≤ 8 đỉnh, `roomClipShape.ts`). Phòng > 8 đỉnh → chữ nhật AABB (như vòng 6).
 *
 * Vòng 7 R2 (chi phí: đa giác 8 cạnh × 24 đèn × mọi vật liệu làm tải chậm gấp đôi):
 * - Chọn biến thể LÚC DỰNG NODE theo từng đèn: `edgesBy` (0 = đường hộp, n = đa giác đúng n cạnh). Chữ nhật thẳng trục /
 *   > 8 đỉnh / `?light=room-clip-box` → hộp (12 uniform, không vòng cạnh); chỉ phòng lõm/xoay sinh mã n cạnh.
 * - Số cạnh nằm trong cache key của `LightsNode` (vá `customCacheKey`, cùng cơ chế three dùng cho `castShadow`) ⇒ sửa tường
 *   đổi số cạnh thì render object bị dựng lại đúng cách; quay lại hình cũ dùng lại NodeBuilderState đã cache.
 *   Dữ liệu luôn an toàn cho mọi biến thể: hộp = AABB phòng + dải Y, đỉnh = đa giác (hoặc AABB).
 * - Uniform ở `renderGroup` (như uniform đèn của three) thay vì `objectGroup` mặc định: cập nhật 1 lần/lượt render,
 *   không phải mỗi lời gọi vẽ, và không nhân bản theo từng vật.
 * - `syncRoomClip` cache đa giác thế giới + hình cắt theo phòng (tính lại khi polygon hoặc matrixWorld của tầng đổi).
 */
import { type Light, type Matrix4, type Object3D, Vector3, Vector4 } from 'three';
import { abs, clamp, dot, float, length, max, min, mod, positionWorld, renderGroup, step, uniform } from 'three/tsl';
import { LightsNode, type Node, PointLightNode, SpotLightNode } from 'three/webgpu';

import { backendOf, currentRenderer } from './backend';
import { lightFlagOn } from './lightFlag';
import { type ClipShape, clipShapeOf, openShape, polygonClipFactor, ROOM_CLIP_MAX_VERTS } from './roomClipShape';
import { sceneTier } from './tiers';

/** Nới hộp ra ngoài đa giác phòng (m): đa giác phòng nằm ở mép trong/tim tường → mặt trong tường vẫn trong hộp. */
export const ROOM_CLIP_MARGIN_M = 0.06;
/** Bề rộng mép mềm (m) — tránh răng cưa ở chân tường. */
export const ROOM_CLIP_EDGE_M = 0.04;
/** Đỉnh hộp khi không có tầng trên. */
export const ROOM_CLIP_HEIGHT_M = 4;
/** Hộp "không cắt" (đèn ngoài mọi phòng). */
export const OPEN_BOX = 1e5;

export type Polygon = ReadonlyArray<readonly [number, number]>;
export interface ClipRoom {
  polygon: Polygon;
  /** Cao độ thế giới của sàn tầng chứa phòng. */
  floorY: number;
  /** Cao độ sàn tầng ngay trên (hoặc floorY + ROOM_CLIP_HEIGHT_M). */
  topY: number;
}
export interface ClipBox {
  min: [number, number, number];
  max: [number, number, number];
}

function inPolygon(x: number, z: number, poly: Polygon): boolean {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [xi, zi] = poly[i]!;
    const [xj, zj] = poly[j]!;
    if (zi > z !== zj > z && x < ((xj - xi) * (z - zi)) / (zj - zi) + xi) inside = !inside;
  }
  return inside;
}
const areaOf = (poly: Polygon): number =>
  Math.abs(poly.reduce((s, [x0, z0], i) => s + x0 * poly[(i + 1) % poly.length]![1] - poly[(i + 1) % poly.length]![0] * z0, 0)) / 2;

/** Hộp bao của đa giác (nới margin) + dải Y tầng. Đường hộp dùng nguyên; đường đa giác nhân thêm mặt nạ n cạnh. */
export function roomClipBox(room: ClipRoom, margin = ROOM_CLIP_MARGIN_M): ClipBox {
  const xs = room.polygon.map((p) => p[0]);
  const zs = room.polygon.map((p) => p[1]);
  return {
    min: [Math.min(...xs) - margin, room.floorY - 0.05, Math.min(...zs) - margin],
    max: [Math.max(...xs) + margin, room.topY, Math.max(...zs) + margin],
  };
}

/** Phòng chứa điểm đèn: cùng tầng (floorY ≤ y < topY), trong đa giác; chồng nhau → phòng nhỏ nhất. */
export function roomOfLight<R extends ClipRoom>(p: { x: number; y: number; z: number }, rooms: readonly R[]): R | undefined {
  let best: R | undefined;
  let bestArea = Infinity;
  for (const r of rooms) {
    if (p.y < r.floorY - 0.05 || p.y >= r.topY || !inPolygon(p.x, p.z, r.polygon)) continue;
    const a = areaOf(r.polygon);
    if (a < bestArea) [best, bestArea] = [r, a];
  }
  return best;
}

/** Đỉnh hộp từng tầng: sàn tầng kế trên, hoặc + ROOM_CLIP_HEIGHT_M. */
export function topsOf(floorYs: readonly number[]): Map<number, number> {
  const ys = [...new Set(floorYs)].sort((a, b) => a - b);
  return new Map(ys.map((y, i) => [y, ys[i + 1] ?? y + ROOM_CLIP_HEIGHT_M]));
}

/** Bản JS của mặt nạ trong shader (để test): tích 3 trục, mỗi trục dốc tuyến tính rộng `edge` quanh mép hộp. */
export function roomClipFactor(p: readonly [number, number, number], box: ClipBox, edge = ROOM_CLIP_EDGE_M): number {
  let k = 1;
  for (let i = 0; i < 3; i++) {
    const lo = Math.min(1, Math.max(0, (p[i]! - box.min[i]!) / edge + 0.5));
    const hi = Math.min(1, Math.max(0, (box.max[i]! - p[i]!) / edge + 0.5));
    k *= lo * hi;
  }
  return k;
}

/** Ô mở (cửa đi, ô trống) trên biên phòng — toạ độ thế giới. `n` hướng RA khỏi phòng của đèn. */
export interface Portal {
  c: [number, number, number];
  /** Trục ngang dọc tường (đơn vị). */
  u: [number, number, number];
  n: [number, number, number];
  halfW: number;
  halfH: number;
}
/** Số cổng mỗi đèn trong shader (ô thừa = tắt). Mỗi cổng ~20 phép tính/đèn/điểm ảnh. */
export const PORTALS_PER_LIGHT = 3;
/** Mép mềm của khung ô mở (m, đo trong mặt phẳng ô). */
export const PORTAL_EDGE_M = 0.08;
/** Ánh sáng qua cổng mờ dần về 0 sau quãng này (m) tính từ mặt ô — thay cho dội/che khuất không mô phỏng. */
export const PORTAL_FADE_M = 4;
/** Ô cửa cách biên phòng tối đa (m) để tính là cổng của phòng (nửa bề dày tường + dung sai). */
export const PORTAL_SNAP_M = 0.25;

type V3 = readonly [number, number, number];
const dot3 = (a: V3, b: V3): number => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const sub3 = (a: V3, b: V3): [number, number, number] => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const clamp01 = (v: number): number => Math.min(1, Math.max(0, v));

/** Bản JS của hệ số cổng trong shader (để test): 0 trước mặt ô / ngoài khung; 1 ngay sau ngưỡng, giảm dần theo PORTAL_FADE_M. */
export function portalFactor(P: V3, L: V3, q: Portal): number {
  const d = sub3(P, L);
  const past = dot3(sub3(P, q.c), q.n);
  const t = dot3(sub3(q.c, L), q.n) / Math.max(dot3(d, q.n), 1e-4);
  const H: V3 = [L[0] + d[0] * t, L[1] + d[1] * t, L[2] + d[2] * t];
  const inA = clamp01((q.halfW - Math.abs(dot3(sub3(H, q.c), q.u))) / PORTAL_EDGE_M + 0.5);
  const inB = clamp01((q.halfH - Math.abs(H[1] - q.c[1])) / PORTAL_EDGE_M + 0.5);
  return inA * inB * (1 - clamp01(past / PORTAL_FADE_M)) ** 2 * clamp01(past / 0.02);
}

/** Mặt nạ đầy đủ (JS, như shader): max(hộp phòng × đa giác phòng, các cổng). `verts` bỏ trống = chỉ hộp (vòng 6). */
export function lightMask(P: V3, L: V3, box: ClipBox, portals: readonly Portal[] = [], verts?: ReadonlyArray<readonly [number, number]>): number {
  const poly = verts ? polygonClipFactor(P[0], P[2], verts, ROOM_CLIP_MARGIN_M, ROOM_CLIP_EDGE_M) : 1;
  return portals.reduce((k, q) => Math.max(k, portalFactor(P, L, q)), roomClipFactor(P, box) * poly);
}

/** Hộp chỉ dải Y của tầng, XZ mở (tham chiếu bản đầu vòng 7; shader nay dùng `roomClipBox` cho cả đường đa giác). */
export function bandBox(room: ClipRoom): ClipBox {
  const b = roomClipBox(room);
  return { min: [-OPEN_BOX, b.min[1], -OPEN_BOX], max: [OPEN_BOX, b.max[1], OPEN_BOX] };
}

function segDist(x: number, z: number, a: readonly [number, number], b: readonly [number, number]): number {
  const dx = b[0] - a[0];
  const dz = b[1] - a[1];
  const t = clamp01(((x - a[0]) * dx + (z - a[1]) * dz) / (dx * dx + dz * dz || 1e-9));
  return Math.hypot(x - a[0] - t * dx, z - a[1] - t * dz);
}

export interface OpeningWorld {
  c: [number, number, number];
  /** Hướng tường (ngang, đơn vị). */
  dir: [number, number];
  width: number;
  height: number;
}

/** Cổng của phòng: tâm ô cách biên đa giác ≤ PORTAL_SNAP_M, cùng tầng; pháp tuyến quay ra ngoài; gần đèn trước, tối đa `max`. */
export function portalsOf(room: ClipRoom, openings: readonly OpeningWorld[], light: { x: number; z: number }, limit = PORTALS_PER_LIGHT): Portal[] {
  const poly = room.polygon;
  const onEdge = (o: OpeningWorld) => poly.some((a, i) => segDist(o.c[0], o.c[2], a, poly[(i + 1) % poly.length]!) <= PORTAL_SNAP_M);
  return openings
    .filter((o) => o.c[1] > room.floorY - 0.1 && o.c[1] < room.topY && onEdge(o))
    .sort((a, b) => Math.hypot(a.c[0] - light.x, a.c[2] - light.z) - Math.hypot(b.c[0] - light.x, b.c[2] - light.z))
    .slice(0, limit)
    .map((o): Portal => {
      let n: [number, number, number] = [-o.dir[1], 0, o.dir[0]];
      if (inPolygon(o.c[0] + n[0] * 0.3, o.c[2] + n[2] * 0.3, poly)) n = [-n[0], 0, -n[2]];
      return { c: o.c, u: [o.dir[0], 0, o.dir[1]], n, halfW: o.width / 2, halfH: o.height / 2 };
    });
}

/** Đúng dữ liệu shader nhận cho phòng (JS tham chiếu: `lightMask(P, L, box, portals, verts)`). */
export function roomMaskInputs(room: ClipRoom, shape: ClipShape): { box: ClipBox; verts?: [number, number][] } {
  return { box: roomClipBox(room), verts: shape.edges ? shape.verts.slice(0, shape.edges) : undefined };
}

const vec3Uniform = (v: number) => uniform(new Vector3(v, v, v)).setGroup(renderGroup);
const vec4Uniform = (v: number) => uniform(new Vector4(v, v, v, v)).setGroup(renderGroup);
interface PortalUniforms {
  /** xyz tâm ô, w nửa rộng (âm = ô tắt). */
  c: ReturnType<typeof vec4Uniform>;
  /** xyz trục dọc tường, w nửa cao. */
  u: ReturnType<typeof vec4Uniform>;
  n: ReturnType<typeof vec3Uniform>;
}
interface BoxUniforms {
  min: ReturnType<typeof vec3Uniform>;
  max: ReturnType<typeof vec3Uniform>;
  lp: ReturnType<typeof vec3Uniform>;
  portals: PortalUniforms[];
  /** Đỉnh đa giác XZ, 2 đỉnh / vec4 (x0, z0, x1, z1). */
  poly: ReturnType<typeof vec4Uniform>[];
}
const OFF_PORTAL = -10;
const boxes = new WeakMap<Light, BoxUniforms>();
/** Số cạnh đa giác shader của đèn được dựng với (0 = đường hộp). Đọc lúc dựng node và trong cache key. */
const edgesBy = new WeakMap<Light, number>();
const OPEN_VERTS = openShape(OPEN_BOX).verts;
function uniformsOf(light: Light): BoxUniforms {
  let u = boxes.get(light);
  if (!u) {
    u = {
      min: vec3Uniform(-OPEN_BOX),
      max: vec3Uniform(OPEN_BOX),
      lp: vec3Uniform(0),
      portals: Array.from({ length: PORTALS_PER_LIGHT }, () => ({ c: vec4Uniform(OFF_PORTAL), u: vec4Uniform(0), n: vec3Uniform(0) })),
      poly: Array.from({ length: ROOM_CLIP_MAX_VERTS / 2 }, () => vec4Uniform(0)),
    };
    setPoly(u, OPEN_VERTS);
    for (const q of u.portals) q.n.value.set(1, 0, 0);
    boxes.set(light, u);
  }
  return u;
}

function setPoly(u: BoxUniforms, verts: ReadonlyArray<readonly [number, number]>): void {
  u.poly.forEach((q, i) => q.value.set(verts[2 * i]![0], verts[2 * i]![1], verts[2 * i + 1]![0], verts[2 * i + 1]![1]));
}

let installed = false;
/** Vá một lần (khi cờ bật). Đèn được tạo trước hay sau đều có mặt nạ: uniform tạo lười lúc dựng shader. */
export function installRoomClip(): void {
  if (installed) return;
  installed = true;
  // Số cạnh từng đèn vào cache key ⇒ đổi số cạnh = render object dựng lại (RenderObjects so getDynamicCacheKey mỗi lần vẽ).
  const lp = LightsNode.prototype as unknown as { customCacheKey(): number; getBuiltinLights(): Light[] };
  const origKey = lp.customCacheKey;
  lp.customCacheKey = function (this: typeof lp) {
    let k = origKey.call(this);
    for (const l of this.getBuiltinLights()) k = (Math.imul(k, 31) + (edgesBy.get(l) ?? 0)) | 0;
    return k;
  };
  for (const Cls of [PointLightNode, SpotLightNode] as const) {
    const proto = Cls.prototype as { setupDirect: (b: never) => { lightColor: unknown } | undefined; light: Light | null };
    const orig = proto.setupDirect;
    proto.setupDirect = function (this: { light: Light | null }, builder: never) {
      const out = orig.call(this, builder) as { lightColor: { mul(k: unknown): unknown } } | undefined;
      // Tier low / WebGL2: mỗi đèn thêm 12 uniform → dễ vượt trần uniform fragment (224 bảo đảm) ⇒ không cắt (review vòng 6).
      if (!out || !this.light || sceneTier() === 'low' || backendOf(currentRenderer) !== 'webgpu') return out;
      const u = uniformsOf(this.light);
      const P = positionWorld;
      const b = clamp(P.sub(u.min).div(ROOM_CLIP_EDGE_M).add(0.5), 0, 1).mul(clamp(u.max.sub(P).div(ROOM_CLIP_EDGE_M).add(0.5), 0, 1));
      let k: Node<'float'> = b.x.mul(b.y).mul(b.z);
      // Đa giác XZ đúng n cạnh của phòng lúc dựng (n = 0 → chỉ hộp) — cùng công thức `polygonClipFactor` (test bản JS).
      const n = edgesBy.get(this.light) ?? 0;
      if (n >= 3) {
        const xz = P.xz;
        const V = u.poly.flatMap((q) => [q.xy, q.zw]).slice(0, n);
        let dmin: Node<'float'> = float(1e9);
        let cnt: Node<'float'> = float(0);
        V.forEach((a, i) => {
          const bv = V[(i + 1) % n]!;
          const e = bv.sub(a);
          const w = xz.sub(a);
          const t = clamp(dot(w, e).div(max(dot(e, e), 1e-8)), 0, 1);
          dmin = min(dmin, length(w.sub(e.mul(t))));
          // step(edge, x) = x ≥ edge ⇒ (a.z ≥ z) − (b.z ≥ z); vec2 .y ở đây là trục Z thế giới.
          const straddle = abs(step(xz.y, a.y).sub(step(xz.y, bv.y)));
          cnt = cnt.add(straddle.mul(step(0, e.x.mul(w.y).sub(w.x.mul(e.y)).mul(e.y))));
        });
        const sd = dmin.mul(mod(cnt, 2).mul(2).sub(1));
        k = k.mul(clamp(sd.add(ROOM_CLIP_MARGIN_M).div(ROOM_CLIP_EDGE_M).add(0.5), 0, 1));
      }
      const d = P.sub(u.lp);
      // Cùng công thức `portalFactor` (test bản JS).
      for (const q of u.portals) {
        const c = q.c.xyz;
        const past = dot(P.sub(c), q.n);
        const t = dot(c.sub(u.lp), q.n).div(max(dot(d, q.n), 1e-4));
        const H = u.lp.add(d.mul(t));
        const inA = clamp(q.c.w.sub(abs(dot(H.sub(c), q.u.xyz))).div(PORTAL_EDGE_M).add(0.5), 0, 1);
        const inB = clamp(q.u.w.sub(abs(H.y.sub(c.y))).div(PORTAL_EDGE_M).add(0.5), 0, 1);
        const fade = clamp(past.div(PORTAL_FADE_M), 0, 1).oneMinus().pow(2);
        k = max(k, inA.mul(inB).mul(fade).mul(clamp(past.div(0.02), 0, 1)));
      }
      return { ...out, lightColor: out.lightColor.mul(k) };
    } as never;
  }
}

// Vá ngay lúc nạp (trước lần biên dịch shader đầu): NodeBuilderState được cache theo hash đồ thị, vá muộn thì vật liệu
// đã biên dịch không dựng lại (đo lúc chạy: `needsUpdate` thôi không đủ).
if (lightFlagOn('room-clip')) installRoomClip();

interface RegistryLike {
  nodes: Map<string, Object3D>;
  byType: Record<string, Set<string> | undefined>;
}
type ZoneNodeLike = { polygon?: Array<[number, number]> } | undefined;
interface DoorNodeLike {
  type?: string;
  wallId?: string;
  position?: [number, number, number];
  width?: number;
  height?: number;
}
interface WallNodeLike {
  start?: [number, number];
  end?: [number, number];
  parentId?: string;
}

interface RoomEntry {
  poly: unknown;
  m: Matrix4;
  polygon: Polygon;
  floorY: number;
  shape: ClipShape;
}
let roomCache = new Map<string, RoomEntry>();
let lights: Light[] = [];
let openings: OpeningWorld[] = [];
let scanAt = -Infinity;
const p = new Vector3();
const zp = new Vector3();
/** Quét lại danh sách đèn + ô cửa mỗi ~0,5 s (pool đèn đồ của vendor dựng muộn; cửa đổi khi sửa). */
const RESCAN_MS = 500;

/** Cửa đi (gồm ô trống `openingKind: 'opening'`) → thế giới qua nhóm tầng của tường. Cửa sổ không là cổng (kính/ra ngoài). */
function openingsOf(registry: RegistryLike, nodes: Record<string, unknown>): OpeningWorld[] {
  const out: OpeningWorld[] = [];
  for (const n of Object.values(nodes) as (DoorNodeLike | undefined)[]) {
    if (n?.type !== 'door' || !n.wallId || !n.position) continue;
    const w = nodes[n.wallId] as WallNodeLike | undefined;
    if (!w?.start || !w.end) continue;
    const len = Math.hypot(w.end[0] - w.start[0], w.end[1] - w.start[1]);
    if (!(len > 0)) continue;
    const dir: [number, number] = [(w.end[0] - w.start[0]) / len, (w.end[1] - w.start[1]) / len];
    zp.set(w.start[0] + dir[0] * n.position[0], n.position[1], w.start[1] + dir[1] * n.position[0]);
    // ponytail: giả định tầng chỉ tịnh tiến (không xoay) — đúng với cách xếp tầng hiện tại.
    const level = w.parentId ? registry.nodes.get(w.parentId) : undefined;
    if (level) level.localToWorld(zp);
    out.push({ c: [zp.x, zp.y, zp.z], dir, width: n.width ?? 0.9, height: n.height ?? 2.1 });
  }
  return out;
}

/** Gọi mỗi khung từ `Lights` (qua `syncRoomLights`). Không cờ → không làm gì. */
export function syncRoomClip(registry: RegistryLike, nodes: Record<string, unknown>, scene: Object3D, nowMs = performance.now()): void {
  if (!lightFlagOn('room-clip')) return;
  installRoomClip();
  if (nowMs - scanAt > RESCAN_MS) {
    scanAt = nowMs;
    lights = [];
    scene.traverse((o) => {
      if ((o as Light & { isPointLight?: boolean }).isPointLight || (o as Light & { isSpotLight?: boolean }).isSpotLight) lights.push(o as Light);
    });
    openings = openingsOf(registry, nodes);
  }
  const forceBox = lightFlagOn('room-clip-box');
  const raw: RoomEntry[] = [];
  const next = new Map<string, RoomEntry>();
  for (const id of registry.byType.zone ?? []) {
    const obj = registry.nodes.get(id);
    const poly = (nodes[id] as ZoneNodeLike)?.polygon;
    if (!obj || !poly || poly.length < 3) continue;
    let e = roomCache.get(id);
    // Đa giác zone ở toạ độ cục bộ của tầng → thế giới; chỉ tính lại khi polygon (store bất biến) hoặc matrixWorld tầng đổi.
    if (!e || e.poly !== poly || !e.m.equals(obj.matrixWorld)) {
      const polygon = poly.map(([x, z]) => {
        obj.localToWorld(zp.set(x, 0, z));
        return [zp.x, zp.z] as const;
      });
      const floorY = obj.localToWorld(zp.set(0, 0, 0)).y;
      e = { poly, m: obj.matrixWorld.clone(), polygon, floorY, shape: clipShapeOf(polygon, forceBox) };
    }
    next.set(id, e);
    raw.push(e);
  }
  roomCache = next;
  const tops = topsOf(raw.map((r) => r.floorY));
  const rooms = raw.map((r) => ({ polygon: r.polygon, floorY: r.floorY, topY: tops.get(r.floorY)!, shape: r.shape }));
  for (const l of lights) {
    const u = uniformsOf(l);
    l.getWorldPosition(p);
    u.lp.value.copy(p);
    const room = roomOfLight(p, rooms);
    const ports = room ? portalsOf(room, openings, p) : [];
    u.portals.forEach((q, i) => {
      const o = ports[i];
      if (!o) {
        q.c.value.set(0, OPEN_BOX, 0, OFF_PORTAL);
        return;
      }
      q.c.value.set(o.c[0], o.c[1], o.c[2], o.halfW);
      q.u.value.set(o.u[0], o.u[1], o.u[2], o.halfH);
      q.n.value.set(...o.n);
    });
    if (!room) {
      u.min.value.setScalar(-OPEN_BOX);
      u.max.value.setScalar(OPEN_BOX);
      setPoly(u, OPEN_VERTS);
      edgesBy.set(l, 0);
      continue;
    }
    // Hộp = AABB + dải Y (đúng cho cả đường hộp lẫn đường đa giác: đa giác ⊂ AABB) ⇒ shader chưa dựng lại vẫn không rò.
    const b = roomClipBox(room);
    u.min.value.set(...b.min);
    u.max.value.set(...b.max);
    setPoly(u, room.shape.verts);
    edgesBy.set(l, room.shape.edges);
  }
}
