/**
 * Ánh sáng cửa sổ (Ban ngày, mức Vừa/Cao): phòng thật được chiếu chủ yếu bởi ánh trời lọt qua ô
 * kính — sáng gần cửa, tối dần vào sâu, mặt hướng cửa sáng hơn. Mỗi cửa sổ gần camera nhất (tối đa
 * `WINDOW_LIGHT_MAX`) có một PointLight không đổ bóng ở tâm ô cửa, cường độ theo diện tích ô, màu
 * trời (màu bầu trời của hemisphereLight); ambient/hemi phẳng giảm theo `WINDOW_AMBIENT_SCALE`.
 * Đèn lùi vào trong phòng `WINDOW_LIGHT_INSET_M` theo pháp tuyến ô cửa.
 * Pool = số cửa sổ (≤ max), chỉ tăng; đèn thừa cường độ 0 → số đèn không đổi theo khung, không biên dịch lại shader.
 * Vendor gọi qua luật `scripts/realism/r9w-window-light.mjs`. Mức Thấp, chủ đề khác: không gì cả.
 */
import { Box3, type HemisphereLight, type Object3D, PointLight, type Scene, SpotLight, Vector3 } from 'three';

import { DAY_THEME_ID } from '../renderLook';
import { lightFlagOn } from './lightFlag';
import { sceneTier } from './tiers';

export const WINDOW_LIGHT_MAX = 8;
/** cd mỗi m² ô cửa (decay 2 → độ rọi I/d²). */
export const WINDOW_LIGHT_PER_M2 = 3;
export const WINDOW_LIGHT_RANGE_M = 7;
export const WINDOW_AMBIENT_SCALE = 0.6;
/** Lùi đèn vào trong phòng theo pháp tuyến ô cửa → rèm/khung sát cửa không bị đốm cháy. */
export const WINDOW_LIGHT_INSET_M = 0.7;
/**
 * `?light=window-spot` (vòng 6): ô cửa là nguồn DIỆN TÍCH chỉ phát vào trong phòng. Đèn điểm cách kính 0,7 m phát
 * cả nửa sau → hắt ngược lên chính mảng tường quanh cửa (quầng cháy cạnh khung, 58c3b934) và qua tường sang phòng
 * bên. Spot sát mặt kính, trục hướng vào phòng chếch xuống, nửa góc ~75° mép mềm ≈ phân bố cos của ô cửa.
 */
export const WINDOW_SPOT_INSET_M = 0.12;
export const WINDOW_SPOT_ANGLE = (75 * Math.PI) / 180;
/** Trục spot: điểm đích cách ô `WINDOW_SPOT_AIM_M` vào trong, thấp hơn tâm ô `WINDOW_SPOT_DROP_M` (ánh trời rọi xuống sàn). */
export const WINDOW_SPOT_AIM_M = 2.5;
export const WINDOW_SPOT_DROP_M = 1.2;

export function windowLightsOn(themeId: string, appearance: string, tier: string): boolean {
  // Núm đo trước/sau trong cùng một lượt chụp (`window.__realismWindowLight = false`).
  if ((globalThis as { __realismWindowLight?: boolean }).__realismWindowLight === false) return false;
  return themeId === DAY_THEME_ID && appearance !== 'dark' && tier !== 'low';
}

/** Hệ số nhân ambient/hemi của vendor (1 khi tắt) — áp vào giá trị đích nên lerp không cộng dồn. */
export function windowAmbientScale(themeId: string, appearance: string): number {
  return windowLightsOn(themeId, appearance, sceneTier()) ? WINDOW_AMBIENT_SCALE : 1;
}

export interface WindowPane {
  x: number;
  y: number;
  z: number;
  area: number;
  /** Pháp tuyến ngang của ô cửa (dấu chưa định; `insetPoint` chọn phía trong). */
  nx: number;
  nz: number;
}

/** Chỉ số các ô gần camera nhất (≤ max), gần trước. */
export function pickWindows(panes: readonly WindowPane[], cam: { x: number; y: number; z: number }, max = WINDOW_LIGHT_MAX): number[] {
  const d = (p: WindowPane) => (p.x - cam.x) ** 2 + (p.y - cam.y) ** 2 + (p.z - cam.z) ** 2;
  return panes
    .map((p, i) => [d(p), i] as const)
    .sort((a, b) => a[0] - b[0])
    .slice(0, max)
    .map(([, i]) => i);
}

/** Cỡ pool đèn cửa sổ: theo số cửa (≤ max), không bao giờ giảm (giữ khoá đèn của shader ổn định). */
export const windowPoolSize = (current: number, windows: number): number => Math.max(current, Math.min(windows, WINDOW_LIGHT_MAX));

export const windowIntensity =(area: number): number => Math.min(Math.max(area, 0), 6) * WINDOW_LIGHT_PER_M2;

/** Ô cửa từ hộp bao: cửa nằm trong mặt tường → rộng = cạnh ngang lớn hơn, cao = dy. */
export function paneFromBox(min: { x: number; y: number; z: number }, max: { x: number; y: number; z: number }): WindowPane {
  const dx = max.x - min.x;
  const dz = max.z - min.z;
  const alongX = dx >= dz; // ô cửa trải theo x → pháp tuyến theo z
  return { x: (min.x + max.x) / 2, y: (min.y + max.y) / 2, z: (min.z + max.z) / 2, area: Math.max(dx, dz) * (max.y - min.y), nx: alongX ? 0 : 1, nz: alongX ? 1 : 0 };
}

/**
 * Điểm đặt đèn: lùi `inset` m theo pháp tuyến về phía `inside` (tâm các cửa sổ — cửa bao quanh nhà
 * nên tâm của chúng nằm trong nhà; chỉ một cửa thì dùng camera). Cùng phía với pháp tuyến → +.
 */
export function insetPoint(p: WindowPane, inside: { x: number; z: number }, inset = WINDOW_LIGHT_INSET_M): { x: number; y: number; z: number } {
  const dot = (inside.x - p.x) * p.nx + (inside.z - p.z) * p.nz;
  const s = dot >= 0 ? inset : -inset;
  return { x: p.x + p.nx * s, y: p.y, z: p.z + p.nz * s };
}

interface RegistryLike {
  nodes: Map<string, Object3D>;
  byType: Record<string, Set<string> | undefined>;
}

const box = new Box3();
const cache = new WeakMap<Object3D, { key: string; pane: WindowPane }>();
function paneOf(o: Object3D): WindowPane {
  const e = o.matrixWorld.elements;
  const key = `${e[12]},${e[13]},${e[14]},${e[0]},${e[10]}`;
  const hit = cache.get(o);
  if (hit && hit.key === key) return hit.pane;
  box.setFromObject(o);
  const pane = box.isEmpty() ? { x: e[12]!, y: e[13]!, z: e[14]!, area: 0, nx: 0, nz: 0 } : paneFromBox(box.min, box.max);
  cache.set(o, { key, pane });
  return pane;
}

let pool: (PointLight | SpotLight)[] = [];
const camPos = new Vector3();
const spotOn = () => lightFlagOn('window-spot');
function makeLight(): PointLight | SpotLight {
  if (!spotOn()) return new PointLight(0xffffff, 0, WINDOW_LIGHT_RANGE_M, 2);
  return new SpotLight(0xffffff, 0, WINDOW_LIGHT_RANGE_M, WINDOW_SPOT_ANGLE, 1, 2);
}

/** Gọi mỗi khung từ `Lights` (vendor). */
export function syncWindowLights(
  registry: RegistryLike,
  scene: Scene,
  camera: Object3D,
  themeId: string,
  appearance: string,
  hemi: HemisphereLight | null,
): void {
  const on = windowLightsOn(themeId, appearance, sceneTier());
  if (!on) {
    if (pool.length) {
      for (const l of pool) {
        l.removeFromParent();
        if ((l as SpotLight).isSpotLight) (l as SpotLight).target.removeFromParent();
      }
      pool = [];
    }
    return;
  }
  const objs = [...(registry.byType.window ?? [])].map((id) => registry.nodes.get(id)).filter(Boolean) as Object3D[];
  // Số đèn = số cửa sổ (≤ max), chỉ tăng: TSL sinh mã cho mọi đèn kể cả cường độ 0, và đổi số đèn là dựng
  // lại mọi shader có ánh sáng — nên không bớt khi cửa ít đi, và nhà ít cửa không mang 8 đèn thừa.
  for (let n = windowPoolSize(pool.length, objs.length); pool.length < n; ) {
    const l = makeLight();
    l.castShadow = false;
    l.name = 'realism-window-light';
    pool.push(l);
  }
  for (const l of pool) {
    if (l.parent !== scene) scene.add(l);
    if ((l as SpotLight).isSpotLight && (l as SpotLight).target.parent !== scene) scene.add((l as SpotLight).target);
  }
  const panes = objs.map(paneOf);
  camera.getWorldPosition(camPos);
  const picked = pickWindows(panes, camPos, pool.length);
  // ponytail: "trong nhà" = tâm các cửa sổ; nhà chữ L/U lệch nhiều có thể sai phía — khi đó dùng zone.
  const inside = panes.length > 1
    ? { x: panes.reduce((a, p) => a + p.x, 0) / panes.length, z: panes.reduce((a, p) => a + p.z, 0) / panes.length }
    : { x: camPos.x, z: camPos.z };
  pool.forEach((l, i) => {
    const p = picked[i] === undefined ? undefined : panes[picked[i]!];
    if (!p) {
      l.intensity = 0;
      return;
    }
    if ((l as SpotLight).isSpotLight) {
      const spot = l as SpotLight;
      const q = insetPoint(p, inside, WINDOW_SPOT_INSET_M);
      const aim = insetPoint(p, inside, WINDOW_SPOT_AIM_M);
      spot.position.set(q.x, q.y, q.z);
      spot.target.position.set(aim.x, aim.y - WINDOW_SPOT_DROP_M, aim.z);
      spot.target.updateMatrixWorld();
    } else {
      const q = insetPoint(p, inside);
      l.position.set(q.x, q.y, q.z);
    }
    l.intensity = windowIntensity(p.area);
    if (hemi) l.color.copy(hemi.color);
  });
}
