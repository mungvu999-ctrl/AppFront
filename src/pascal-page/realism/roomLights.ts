/**
 * S4 "lights" (render look B): bóng nắng mềm + đèn ấm mỗi phòng. Vendor gọi qua luật
 * `scripts/realism/r10-lights.mjs` (`lights.tsx`).
 *
 * 1) Bóng đèn chính: three 0.186 đã bỏ PCFSoftShadowMap (cả WebGPU lẫn WebGL2 rơi về PCF); VSM tốn
 *    thêm 2 lượt mờ và lọt sáng qua tường/trần mỏng chồng nhau. Giữ PCF (5 mẫu Vogel xoay theo IGN,
 *    TRAA làm mịn) nhưng đặt `shadow.radius` theo bề rộng khung bóng → vùng nửa tối ~`KEY_SHADOW_PENUMBRA_M`
 *    ngoài đời, bất kể căn hộ to/nhỏ hay bản đồ 1024/2048. `radius` là uniform → đổi mỗi khung không
 *    biên dịch lại shader.
 * 2) Buổi tối (chủ đề `night`, chế độ Rendered, mức Vừa/Cao): mỗi phòng (zone) một PointLight ấm
 *    #ffc98a ở tâm phòng dưới trần, không đổ bóng, cường độ theo diện tích, tầm kẹp theo kích thước phòng
 *    → ít lọt sang phòng bên. Theo bản Blender `F:/runs/login-tour/apt3.py` (`add_spot`, 5 W/m², 30–150 W).
 *    Pool đèn cố định như `windowLight.ts` (đèn thừa cường độ 0) → số đèn không đổi theo khung.
 */
import { type Object3D, PointLight, type Scene, Vector3 } from 'three';

import { NIGHT_THEME_ID } from '../renderLook';
import { syncStudioGround } from './horizon';
import { lightFlagOn } from './lightFlag';
import { syncRoomClip } from './lightingRoomClip';
import { sceneTier } from './tiers';

/** Bề rộng vùng nửa tối mong muốn (m) của bóng nắng. */
export const KEY_SHADOW_PENUMBRA_M = 0.1;
/** = bán kính tĩnh của `r9-daylight` — không bao giờ cứng hơn hôm nay. */
export const KEY_SHADOW_RADIUS_MIN = 3;
/** PCF chỉ 5 mẫu: rộng hơn ~6 texel thì hạt nhiễu IGN lộ trước khi TRAA kịp làm mịn. */
export const KEY_SHADOW_RADIUS_MAX = 6;

/** Bán kính PCF (texel) cho khung bóng trực giao nửa cạnh `halfSize` m, bản đồ `mapSize` px. */
export function keyShadowRadius(halfSize: number, mapSize: number): number {
  if (!(halfSize > 0) || !(mapSize > 0)) return KEY_SHADOW_RADIUS_MIN;
  const texelM = (2 * halfSize) / mapSize;
  return Math.min(KEY_SHADOW_RADIUS_MAX, Math.max(KEY_SHADOW_RADIUS_MIN, KEY_SHADOW_PENUMBRA_M / texelM));
}

export const ROOM_LIGHT_MAX = 12;
export const ROOM_LIGHT_COLOR = 0xffc98a;
/** Núm chỉnh tay: cd mỗi m² sàn (Blender 5 W/m² ↔ ~0,5 cd/m² trên thang đèn của chủ đề `night`). */
export const ROOM_LIGHT_CD_PER_M2 = 0.5;
export const ROOM_LIGHT_MIN_CD = 3;
export const ROOM_LIGHT_MAX_CD = 15;
/** Độ cao đèn trên sàn phòng (m): dưới trần ~2,7–3 m, ngang tường mờ của zone. */
export const ROOM_LIGHT_HEIGHT_M = 2.3;
/** Tầm = khoảng từ đèn tới góc xa nhất × hệ số (three tắt mượt tới `distance`). */
export const ROOM_LIGHT_RANGE_SCALE = 1.15;
export const ROOM_LIGHT_RANGE_MIN_M = 2.5;
export const ROOM_LIGHT_RANGE_MAX_M = 7;
/** Ban công/lô gia: ngoài trời, Blender cũng bỏ. */
const OUTDOOR_ROOM = /ban công|balcony|lô ?gia|loggia/i;

export type Polygon = ReadonlyArray<readonly [number, number]>;

export function roomLightsOn(themeId: string, shading: string | undefined, tier: string): boolean {
  // Núm đo trước/sau (`window.__realismRoomLights = false`).
  if ((globalThis as { __realismRoomLights?: boolean }).__realismRoomLights === false) return false;
  return themeId === NIGHT_THEME_ID && shading !== 'solid' && tier !== 'low';
}

export function polygonArea(poly: Polygon): number {
  let s = 0;
  for (let i = 0; i < poly.length; i++) {
    const [x0, z0] = poly[i]!;
    const [x1, z1] = poly[(i + 1) % poly.length]!;
    s += x0 * z1 - x1 * z0;
  }
  return Math.abs(s) / 2;
}

/** Trọng tâm diện tích; đa giác suy biến → trung bình đỉnh. */
// ponytail: phòng chữ L có thể có trọng tâm ngoài phòng; khi gặp thì lấy điểm trong (pole of inaccessibility).
export function polygonCentroid(poly: Polygon): { x: number; z: number } {
  let a = 0;
  let cx = 0;
  let cz = 0;
  for (let i = 0; i < poly.length; i++) {
    const [x0, z0] = poly[i]!;
    const [x1, z1] = poly[(i + 1) % poly.length]!;
    const k = x0 * z1 - x1 * z0;
    a += k;
    cx += (x0 + x1) * k;
    cz += (z0 + z1) * k;
  }
  if (Math.abs(a) < 1e-9) {
    const n = Math.max(poly.length, 1);
    return { x: poly.reduce((s, p) => s + p[0], 0) / n, z: poly.reduce((s, p) => s + p[1], 0) / n };
  }
  return { x: cx / (3 * a), z: cz / (3 * a) };
}

export const roomLightIntensity = (area: number): number =>
  Math.min(ROOM_LIGHT_MAX_CD, Math.max(ROOM_LIGHT_MIN_CD, area * ROOM_LIGHT_CD_PER_M2));

/** Tầm sáng: tới góc xa nhất (tính cả độ cao đèn) × hệ số, kẹp [min, max]. */
export function roomLightRange(poly: Polygon, c: { x: number; z: number }, height = ROOM_LIGHT_HEIGHT_M): number {
  const far2 = poly.reduce((m, [x, z]) => Math.max(m, (x - c.x) ** 2 + (z - c.z) ** 2), 0);
  const reach = Math.sqrt(far2 + height * height) * ROOM_LIGHT_RANGE_SCALE;
  return Math.min(ROOM_LIGHT_RANGE_MAX_M, Math.max(ROOM_LIGHT_RANGE_MIN_M, reach));
}

export interface RoomInput {
  polygon: Polygon;
  name?: string;
}
export interface RoomLightPlan {
  /** Chỉ số trong mảng vào. */
  index: number;
  x: number;
  z: number;
  intensity: number;
  range: number;
}

/** Phòng nào có đèn: bỏ ngoài trời/suy biến, lớn trước (ổn định khi xoay camera), tối đa `max`. */
export function planRoomLights(rooms: readonly RoomInput[], max = ROOM_LIGHT_MAX): RoomLightPlan[] {
  return rooms
    .map((r, index) => ({ r, index, area: r.polygon.length >= 3 ? polygonArea(r.polygon) : 0 }))
    .filter(({ r, area }) => area > 0 && !OUTDOOR_ROOM.test(r.name ?? ''))
    .sort((a, b) => b.area - a.area)
    .slice(0, max)
    .map(({ r, index, area }) => {
      const c = polygonCentroid(r.polygon);
      return { index, x: c.x, z: c.z, intensity: roomLightIntensity(area), range: roomLightRange(r.polygon, c) };
    });
}

/**
 * `?light=lamp-cal`. Gốc "sàn cháy": PointLight three r186 là cd thật, decay 2 → rọi sàn ngay dưới đèn = I/h².
 * Phòng ≥ 30 m² → 15 cd ở 2,3 m → đỉnh 2,84, gấp ~4 lần nắng/đèn chính chủ đề `night` trên sàn
 * (1,2 × cos 54,7° = 0,69), trong khi góc phòng chỉ ~0,25. Giữ tổng quang thông (Φ = 4πI, không giảm sáng chung)
 * nhưng chia thành n đèn dọc cạnh dài để mỗi đèn có I/h² ≤ `LAMP_CAL_PEAK_E`. Dùng ô thừa của pool, không thêm đèn.
 */
export const LAMP_CAL_PEAK_E = 1;
export const LAMP_CAL_MAX_SPLIT = 3;

export function pointInPolygon(x: number, z: number, poly: Polygon): boolean {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [xi, zi] = poly[i]!;
    const [xj, zj] = poly[j]!;
    if (zi > z !== zj > z && x < ((xj - xi) * (z - zi)) / (zj - zi) + xi) inside = !inside;
  }
  return inside;
}

/** Điểm chia đều dọc cạnh dài của khung bao, qua trọng tâm; có điểm ngoài phòng (chữ L) → `undefined`. */
// ponytail: chia theo khung bao; phòng chữ L/chéo giữ một đèn. Cần thì chia theo trục chính (PCA).
function splitPoints(poly: Polygon, c: { x: number; z: number }, n: number): { x: number; z: number }[] | undefined {
  const xs = poly.map((p) => p[0]);
  const zs = poly.map((p) => p[1]);
  const [x0, x1, z0, z1] = [Math.min(...xs), Math.max(...xs), Math.min(...zs), Math.max(...zs)];
  const alongX = x1 - x0 >= z1 - z0;
  const pts = Array.from({ length: n }, (_, i) => {
    const t = (i + 0.5) / n;
    return alongX ? { x: x0 + t * (x1 - x0), z: c.z } : { x: c.x, z: z0 + t * (z1 - z0) };
  });
  return pts.every((p) => pointInPolygon(p.x, p.z, poly)) ? pts : undefined;
}

export function calibrateRoomLights(
  plan: readonly RoomLightPlan[],
  rooms: readonly RoomInput[],
  max = ROOM_LIGHT_MAX,
  height = ROOM_LIGHT_HEIGHT_M,
): RoomLightPlan[] {
  let spare = max - plan.length;
  const capCd = LAMP_CAL_PEAK_E * height * height;
  return plan.flatMap((p) => {
    const want = Math.min(LAMP_CAL_MAX_SPLIT, Math.ceil(p.intensity / capCd));
    const n = Math.min(want, 1 + Math.max(0, spare));
    const poly = rooms[p.index]!.polygon;
    const pts = n > 1 ? splitPoints(poly, p, n) : undefined;
    if (!pts) return [p];
    spare -= n - 1;
    return pts.map((q) => ({ index: p.index, x: q.x, z: q.z, intensity: p.intensity / n, range: roomLightRange(poly, q, height) }));
  });
}

/**
 * `?light=lamp-ceil` (vòng 6). Gốc "đốm sáng không nguồn" (đo lúc chạy ch-10, `F:/runs/m6/lA/BAO-CAO.md`): mỗi phòng có
 * HAI nguồn cùng toạ độ ngang — đèn này (≤ 15 cd, treo 2,3 m, không vỏ) và đèn âm trần sinh (`LIGHT-<phòng>`, 2,4 cd sát
 * trần, vỏ thu 0,1 %); vũng sáng là khuếch tán (roughness=1 không đổi số đo). Cờ dời đèn phòng lên sát trần của phòng
 * (cùng độ cao đèn âm trần): giữ nguyên cường độ ⇒ giữ quang thông Φ = 4πI, đỉnh rọi sàn I/h² giảm (15 cd: 2,84 → ~1,5 ở
 * trần 3,2 m), không thêm đèn. Không tìm thấy trần chứa tâm phòng → giữ 2,3 m.
 */
export const LAMP_CEIL_GAP_M = 0.05;

export interface CeilingInput {
  polygon: Polygon;
  /** Cao độ mặt trần so với sàn tầng (m). */
  height: number;
}

/** Độ cao đèn phòng (m trên sàn tầng) cho tâm (x, z): trần thấp nhất chứa điểm − khe; không có trần → `fallback`. */
export function ceilingLightHeight(x: number, z: number, ceilings: readonly CeilingInput[], fallback = ROOM_LIGHT_HEIGHT_M): number {
  let h = Infinity;
  for (const c of ceilings) if (c.height > fallback && c.height < h && pointInPolygon(x, z, c.polygon)) h = c.height;
  return Number.isFinite(h) ? h - LAMP_CEIL_GAP_M : fallback;
}

interface RegistryLike {
  nodes: Map<string, Object3D>;
  byType: Record<string, Set<string> | undefined>;
}
type ZoneNodeLike = { polygon?: Array<[number, number]>; name?: string } | undefined;

const shown = (o: Object3D | null): boolean => {
  for (let p = o; p; p = p.parent) if (!p.visible) return false;
  return true;
};

let pool: PointLight[] = [];
const pos = new Vector3();

/** Trần (node `ceiling`): đa giác (toạ độ tầng) + cao độ thế giới. Trần tầng khác bị loại theo độ cao (`ceilingLightHeight`). */
function ceilingsOf(registry: RegistryLike, nodes: Record<string, unknown>): { polygon: Polygon; y: number }[] {
  const out: { polygon: Polygon; y: number }[] = [];
  for (const id of registry.byType.ceiling ?? []) {
    const obj = registry.nodes.get(id);
    const poly = (nodes[id] as ZoneNodeLike)?.polygon;
    if (obj && poly && poly.length >= 3) out.push({ polygon: poly, y: obj.matrixWorld.elements[13]! });
  }
  return out;
}

/** Gọi mỗi khung từ `Lights` (vendor). `nodes` = `useScene.getState().nodes`. */
export function syncRoomLights(
  registry: RegistryLike,
  nodes: Record<string, unknown>,
  scene: Scene,
  themeId: string,
  shading: string | undefined,
): void {
  syncStudioGround(themeId);
  syncRoomClip(registry, nodes, scene);
  if (!roomLightsOn(themeId, shading, sceneTier())) {
    if (pool.length) {
      for (const l of pool) l.removeFromParent();
      pool = [];
    }
    return;
  }
  if (!pool.length) {
    pool = Array.from({ length: ROOM_LIGHT_MAX }, () => {
      const l = new PointLight(ROOM_LIGHT_COLOR, 0, ROOM_LIGHT_RANGE_MIN_M, 2);
      l.castShadow = false;
      l.name = 'realism-room-light';
      return l;
    });
  }
  for (const l of pool) if (l.parent !== scene) scene.add(l);
  // ponytail: dùng `polygon` đã lưu của zone (không giải lại autoFromWalls) — đủ cho căn hộ nạp từ backend.
  const zones: { obj: Object3D; room: RoomInput }[] = [];
  for (const id of registry.byType.zone ?? []) {
    const obj = registry.nodes.get(id);
    const node = nodes[id] as ZoneNodeLike;
    if (obj && node?.polygon && shown(obj)) zones.push({ obj, room: { polygon: node.polygon, name: node.name } });
  }
  const rooms = zones.map((z) => z.room);
  const ceil = lightFlagOn('lamp-ceil');
  const ceilings = ceil ? ceilingsOf(registry, nodes) : [];
  const heightAt = (p: RoomLightPlan): number => {
    if (!ceil) return ROOM_LIGHT_HEIGHT_M;
    const obj = zones[p.index]!.obj;
    const floorY = obj.localToWorld(pos.set(0, 0, 0)).y;
    return ceilingLightHeight(p.x, p.z, ceilings.map((c) => ({ polygon: c.polygon, height: c.y - floorY })));
  };
  let plan = planRoomLights(rooms);
  if (ceil) plan = plan.map((p) => ({ ...p, range: roomLightRange(rooms[p.index]!.polygon, p, heightAt(p)) }));
  if (lightFlagOn('lamp-cal')) plan = calibrateRoomLights(plan, rooms, ROOM_LIGHT_MAX, ceil ? Math.min(...plan.map(heightAt)) : ROOM_LIGHT_HEIGHT_M);
  pool.forEach((l, i) => {
    const p = plan[i];
    if (!p) {
      l.intensity = 0;
      return;
    }
    zones[p.index]!.obj.localToWorld(pos.set(p.x, heightAt(p), p.z));
    l.position.copy(pos);
    l.intensity = p.intensity;
    l.distance = p.range;
  });
}
