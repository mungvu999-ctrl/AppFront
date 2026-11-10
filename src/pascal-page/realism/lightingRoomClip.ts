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
 * Cách gắn: vá `setupDirect` của `PointLightNode`/`SpotLightNode` (three r186) MỘT LẦN khi cờ bật — lightColor ×
 * mặt nạ theo `positionWorld`. Mỗi đèn có 2 uniform vec3 (min/max) cập nhật mỗi khung (`syncRoomClip`); đèn ngoài mọi
 * phòng (ngoài trời) giữ hộp vô hạn. Không cờ → không vá gì, shader y hệt hôm nay. Chạy cả WebGL2 (node system).
 */
import { type Light, type Object3D, Vector3 } from 'three';
import { clamp, positionWorld, uniform } from 'three/tsl';
import { PointLightNode, SpotLightNode } from 'three/webgpu';

import { lightFlagOn } from './lightFlag';

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

// ponytail: hộp bao của đa giác — phòng chữ L vẫn rò sang góc phòng khác nằm trong hộp. Cần thì truyền ≤ 8 cạnh vào shader.
export function roomClipBox(room: ClipRoom, margin = ROOM_CLIP_MARGIN_M): ClipBox {
  const xs = room.polygon.map((p) => p[0]);
  const zs = room.polygon.map((p) => p[1]);
  return {
    min: [Math.min(...xs) - margin, room.floorY - 0.05, Math.min(...zs) - margin],
    max: [Math.max(...xs) + margin, room.topY, Math.max(...zs) + margin],
  };
}

/** Phòng chứa điểm đèn: cùng tầng (floorY ≤ y < topY), trong đa giác; chồng nhau → phòng nhỏ nhất. */
export function roomOfLight(p: { x: number; y: number; z: number }, rooms: readonly ClipRoom[]): ClipRoom | undefined {
  let best: ClipRoom | undefined;
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

const vec3Uniform = (v: number) => uniform(new Vector3(v, v, v));
interface BoxUniforms {
  min: ReturnType<typeof vec3Uniform>;
  max: ReturnType<typeof vec3Uniform>;
}
const boxes = new WeakMap<Light, BoxUniforms>();
function uniformsOf(light: Light): BoxUniforms {
  let u = boxes.get(light);
  if (!u) {
    u = { min: vec3Uniform(-OPEN_BOX), max: vec3Uniform(OPEN_BOX) };
    boxes.set(light, u);
  }
  return u;
}

let installed = false;
/** Vá một lần (khi cờ bật). Đèn được tạo trước hay sau đều có mặt nạ: uniform tạo lười lúc dựng shader. */
export function installRoomClip(): void {
  if (installed) return;
  installed = true;
  for (const Cls of [PointLightNode, SpotLightNode] as const) {
    const proto = Cls.prototype as { setupDirect: (b: never) => { lightColor: unknown } | undefined; light: Light | null };
    const orig = proto.setupDirect;
    proto.setupDirect = function (this: { light: Light | null }, builder: never) {
      const out = orig.call(this, builder) as { lightColor: { mul(k: unknown): unknown } } | undefined;
      if (!out || !this.light) return out;
      const u = uniformsOf(this.light);
      const k = clamp(positionWorld.sub(u.min).div(ROOM_CLIP_EDGE_M).add(0.5), 0, 1).mul(
        clamp(u.max.sub(positionWorld).div(ROOM_CLIP_EDGE_M).add(0.5), 0, 1),
      );
      return { ...out, lightColor: out.lightColor.mul(k.x.mul(k.y).mul(k.z)) };
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

let lights: Light[] = [];
let scanAt = -Infinity;
const p = new Vector3();
const zp = new Vector3();
/** Quét lại danh sách đèn mỗi ~0,5 s (pool đèn đồ của vendor có thể dựng muộn). */
const RESCAN_MS = 500;

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
  }
  const raw: { polygon: Polygon; floorY: number }[] = [];
  for (const id of registry.byType.zone ?? []) {
    const obj = registry.nodes.get(id);
    const poly = (nodes[id] as ZoneNodeLike)?.polygon;
    if (!obj || !poly || poly.length < 3) continue;
    // Đa giác zone ở toạ độ cục bộ của tầng; tầng chỉ dời theo y (và có thể x/z khi tách tầng) → đổi sang thế giới.
    const pts = poly.map(([x, z]) => {
      obj.localToWorld(zp.set(x, 0, z));
      return [zp.x, zp.z] as const;
    });
    raw.push({ polygon: pts, floorY: obj.localToWorld(zp.set(0, 0, 0)).y });
  }
  const tops = topsOf(raw.map((r) => r.floorY));
  const rooms: ClipRoom[] = raw.map((r) => ({ ...r, topY: tops.get(r.floorY)! }));
  for (const l of lights) {
    const u = uniformsOf(l);
    l.getWorldPosition(p);
    const room = roomOfLight(p, rooms);
    if (!room) {
      u.min.value.setScalar(-OPEN_BOX);
      u.max.value.setScalar(OPEN_BOX);
      continue;
    }
    const b = roomClipBox(room);
    u.min.value.set(...b.min);
    u.max.value.set(...b.max);
  }
}
