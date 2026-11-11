/**
 * Phản chiếu + trời qua kính (bền, dùng chung mọi vật liệu). Vendor gọi qua `@pascal-realism/reflect`
 * (luật `scripts/realism/r9t-reflect.mjs`).
 *
 * - `hdriBackdrop`: phông hậu kỳ vốn là gradient tự tính (`lib/backdrop.ts`), HDRI chỉ làm
 *   `scene.environment` → nhìn qua kính chỉ thấy dải sương be ở chân trời. Trên chân trời giờ lấy
 *   HDRI (đã pha gradient như môi trường); sát chân trời giữ gradient để đĩa chân trời khớp không viền.
 * - `syncReflectionProbe`: gương/inox/kính/sàn bóng phản chiếu HDRI chung → "tấm bạc mờ". Khi camera
 *   đứng yên trong nhà (dưới trần, trong hộp trần) chụp một PMREM tại camera, gán `envMap` cho vật
 *   liệu bóng; ra ngoài nhà trả lại môi trường chung. Mức Thấp không chụp.
 */
import {
  Box3,
  DataTexture,
  EquirectangularReflectionMapping,
  FloatType,
  HalfFloatType,
  LinearFilter,
  LinearSRGBColorSpace,
  CubeUVReflectionMapping,
  type Mesh,
  PerspectiveCamera,
  type Material,
  type Object3D,
  RGBAFormat,
  RenderTarget,
  type Scene,
  type Texture,
  Vector3,
} from 'three';
import { equirectUV, float, mix, positionViewDirection, smoothstep, texture, transformedNormalView, uniform } from 'three/tsl';
import { MeshStandardNodeMaterial, type Node, PMREMGenerator, type WebGPURenderer } from 'three/webgpu';

import { glassTwinParams, isGlossy, isLambertGlass, pmremWithoutMrt, probeStep, reflectProbeWanted } from './reflectRules';
import { useRealism } from './store';
import { currentTier } from './tiers';
import { isFirstLoad } from './warm';
import { insideRoomBox, levelBoxes, type RoomBox, winApplies, type WinScope, winViewState } from './winView';

pmremWithoutMrt(PMREMGenerator.prototype as unknown as Record<string, unknown>);

// Ảnh giữ chỗ cùng kiểu với HDRI (RGBA float) → đổi `value` không đổi bố cục binding.
const placeholder = new DataTexture(new Float32Array(4), 1, 1, RGBAFormat, FloatType);
placeholder.minFilter = LinearFilter;
placeholder.magFilter = LinearFilter;
placeholder.generateMipmaps = false;
placeholder.needsUpdate = true;
const skyTex = texture(placeholder);
const skyWeight = uniform(0);
/** Mép dưới (dir.y) của HDRI trên phông: 0 = cắt ở chân trời (như cũ); `?winview` hạ xuống `WIN_FLOOR`. */
const skyFloor = uniform(0);
/** Trời của CHỦ ĐỀ (cũng là nền probe phản chiếu). Phông cửa sổ `?winview` để riêng, không vào probe. */
let skyHdri: Texture | null = null;
let winSky: Texture | null = null;
let winScope: WinScope = 'inside';
let winFloor = 0;
let camInside = false;
/** Yêu cầu tải phông cửa sổ đang chờ (tải lười): gọi một lần khi camera vào nhà / scope all, sau lần tải đầu. */
let winRequest: (() => void) | null = null;
let winRequestScope: WinScope = 'inside';

/**
 * Số đo probe, đọc qua `__pascalProbe.reflect()` (`?probe=1`). `lastMs` = thời gian CPU của `fromScene`;
 * `warmMs` = thời gian biên dịch trước (không chặn khung); `finishMs` = khung chụp + đổi kính; `at` = performance.now() lúc chụp.
 */
export const reflectStats = { captures: 0, lastMs: 0, maxMs: 0, glossy: 0, inside: false, warmMs: 0, finishMs: 0, maxFinishMs: 0, at: 0 };
(globalThis as { __realismReflect?: object }).__realismReflect = reflectStats;

/**
 * Bản HDRI THUẦN cho phông trời (chỉ chuẩn độ sáng, không pha gradient như môi trường) — pha gradient
 * làm mây nhạt, nhìn qua kính chỉ còn mảng xám. `raw` bị nhân `scale` tại chỗ.
 */
export function makeSkyTexture(raw: Float32Array, width: number, height: number, scale: number): Texture {
  for (let i = 0; i < raw.length; i++) if (i % 4 !== 3) raw[i]! *= scale;
  const t = new DataTexture(raw, width, height, RGBAFormat, FloatType);
  t.minFilter = LinearFilter;
  t.magFilter = LinearFilter;
  t.generateMipmaps = false;
  t.mapping = EquirectangularReflectionMapping;
  t.needsUpdate = true;
  return t;
}

/** Chọn ảnh phông: cửa sổ (`?winview`, khi áp) thắng trời chủ đề; không có gì → gradient. Đổi uniform, không biên dịch lại. */
function applySky(): void {
  const win = winSky && winApplies(winScope, camInside) ? winSky : null;
  const tex = win ?? skyHdri;
  skyTex.value = tex ?? placeholder;
  skyWeight.value = tex ? 1 : 0;
  skyFloor.value = win ? winFloor : 0;
  winViewState.active = !!win;
}

/** `installHdri` gọi khi HDRI nạp xong (null = gỡ). */
export function setHdriSky(tex: Texture | null): void {
  skyHdri = tex;
  applySky();
}

/** `installWinView` đăng ký (null = huỷ) hàm tải phông; `syncWinInside` gọi đúng một lần khi tới lúc. */
export function requestWinSky(fn: (() => void) | null, scope: WinScope = 'inside'): void {
  winRequest = fn;
  winRequestScope = scope;
}

/** `installWinView` gọi khi phông cửa sổ nạp xong (null = gỡ). `floor` = mép dưới dir.y của HDRI. */
export function setWinSky(tex: Texture | null, scope: WinScope = 'inside', floor = 0): void {
  winSky = tex;
  winScope = scope;
  winFloor = floor;
  applySky();
}

/** Phông trời: HDRI ngay trên chân trời (đủ 3,4°: tầm mắt qua cửa sổ thấy mây), dưới giữ gradient. Mức Thấp giữ gradient (không thêm lượt đọc ảnh). */
export function hdriBackdrop(worldDir: Node<'vec3'>, gradient: Node<'vec3'>): Node<'vec3'> {
  if (currentTier() === 'low') return gradient;
  const sky = skyTex.sample(equirectUV(worldDir)).rgb;
  return mix(gradient, sky, skyWeight.mul(smoothstep(skyFloor, skyFloor.add(0.06), worldDir.y)));
}

interface RegistryLike {
  nodes: Map<string, Object3D>;
  byType: Record<string, Set<string> | undefined>;
}

const ENV_KEY = '__realismProbe';
let pmrem: PMREMGenerator | null = null;
let probeRT: RenderTarget | null = null;
let applied = false;
const last = new Vector3(Number.NaN, 0, 0);
const prev = new Vector3();
let lastCount = -1;

/** Vật liệu có `envMap` (Standard/Physical/Basic…); `Material` gốc của three không khai báo trường này. */
type EnvMaterial = Material & { envMap: Texture | null };

function eachGlossy(scene: Scene, fn: (m: EnvMaterial) => void) {
  scene.traverse((o) => {
    if (!(o as Mesh).isMesh || !o.layers.isEnabled(0)) return;
    for (const m of [(o as Mesh).material ?? []].flat() as EnvMaterial[]) if (isGlossy(m)) fn(m);
  });
}

const GLASS_KEY = '__realismGlass';
const twins = new WeakMap<Material, MeshStandardNodeMaterial>();
let glassSwapped = false;

/** Bản Standard (cache theo vật liệu gốc) của kính Lambert, fresnel giống `applyGlassFresnel` của vendor. */
function glassTwin(src: Material): MeshStandardNodeMaterial {
  let t = twins.get(src);
  if (t) return t;
  t = new MeshStandardNodeMaterial(glassTwinParams(src));
  t.userData = { ...src.userData };
  const facing = transformedNormalView.dot(positionViewDirection).clamp(0, 1);
  t.opacityNode = mix(float(src.opacity), float(0.92), facing.oneMinus().pow(3));
  t.envMapIntensity = 1.4;
  twins.set(src, t);
  return t;
}

/**
 * Kính Lambert không phản chiếu → đổi sang bản Standard trên mesh (giữ gốc ở `userData`). Chạy cùng nhịp
 * chụp probe (cảnh đổi số node / camera dời > 1,5 m), không mỗi khung.
 * ponytail: vendor gán lại vật liệu mà số node không đổi → kính về Lambert tới lần đổi kế; cần thì móc vào renderer.
 */
function swapGlass(scene: Scene) {
  scene.traverse((o) => {
    const mesh = o as Mesh;
    if (!mesh.isMesh) return;
    const mats = [mesh.material ?? []].flat() as Material[];
    if (!mats.some(isLambertGlass)) return;
    if (!(GLASS_KEY in mesh.userData)) mesh.userData[GLASS_KEY] = mesh.material;
    const next = mats.map((m) => (isLambertGlass(m) ? glassTwin(m) : m));
    mesh.material = Array.isArray(mesh.material) ? next : next[0]!;
  });
  glassSwapped = true;
}

function restoreGlass(scene: Scene) {
  scene.traverse((o) => {
    if (!(GLASS_KEY in o.userData)) return;
    (o as Mesh).material = o.userData[GLASS_KEY] as Mesh['material'];
    delete o.userData[GLASS_KEY];
  });
  glassSwapped = false;
}

function restore(scene: Scene) {
  eachGlossy(scene, (m) => {
    if (!(ENV_KEY in m.userData)) return;
    m.envMap = m.userData[ENV_KEY];
    delete m.userData[ENV_KEY];
    m.needsUpdate = true;
  });
  applied = false;
}

// Đích probe giống hệt `_createRenderTarget` của PMREMGenerator (size 256) → biên dịch trước khớp pipeline khi chụp.
function makeProbeTarget(): RenderTarget {
  const rt = new RenderTarget(3 * 256, 4 * 256, {
    magFilter: LinearFilter,
    minFilter: LinearFilter,
    generateMipmaps: false,
    type: HalfFloatType,
    format: RGBAFormat,
    colorSpace: LinearSRGBColorSpace,
    depthBuffer: true,
  });
  rt.texture.mapping = CubeUVReflectionMapping;
  rt.texture.name = 'PMREM.cubeUv';
  (rt.texture as Texture & { isPMREMTexture?: boolean }).isPMREMTexture = true;
  rt.scissorTest = true;
  return rt;
}

const cubeCam = new PerspectiveCamera(90, 1, 0.05, 60);
const FACES: [number, number, number][] = [[1, 0, 0], [-1, 0, 0], [0, 1, 0], [0, -1, 0], [0, 0, 1], [0, 0, -1]];
let busy = false;
let ready = false;
const at = new Vector3();
let wantInside = false;

/**
 * Biên dịch trước (bất đồng bộ, khung vẫn chạy) cả cảnh ở đích probe theo 6 hướng. Không biên dịch trước
 * kính bản thay/vật liệu bóng mang envMap cho đích chính nữa: `compileAsync` dựng cho đích xuất (không MRT
 * của hậu kỳ, không lượt bóng) → khoá khác lượt vẽ thật, công cốc; W2 (`warm.ts`) dựng chúng bất đồng bộ.
 */
async function warm(r: WebGPURenderer, scene: Scene, p: Vector3, inside: boolean): Promise<void> {
  const t0 = performance.now();
  probeRT ??= makeProbeTarget();
  if (inside) {
    const old = r.getRenderTarget();
    const bg = scene.background;
    for (const [x, y, z] of FACES) {
      cubeCam.position.copy(p);
      cubeCam.up.set(0, y === 0 ? 1 : 0, y === 0 ? 0 : 1);
      cubeCam.lookAt(p.x + x, p.y + y, p.z + z);
      cubeCam.updateMatrixWorld();
      if (skyHdri) scene.background = skyHdri;
      r.setRenderTarget(probeRT); // compileAsync đọc đích ngay lúc gọi (đồng bộ) → trả lại đích cũ liền
      const job = r.compileAsync(scene, cubeCam);
      r.setRenderTarget(old);
      scene.background = bg;
      await job;
    }
  }
  reflectStats.warmMs = performance.now() - t0;
}

/** Khung chụp: đổi kính + chụp PMREM + gán envMap (pipeline đã biên dịch ở `warm`). */
function finish(renderer: unknown, scene: Scene, p: Vector3, inside: boolean) {
  const t0 = performance.now();
  swapGlass(scene);
  reflectStats.inside = inside;
  if (!inside) {
    if (applied) restore(scene);
    return;
  }
  pmrem ??= new PMREMGenerator(renderer as WebGPURenderer);
  const bg = scene.background;
  // Cửa sổ trong ảnh chụp thấy trời HDRI thay màu nền phẳng.
  if (skyHdri) scene.background = skyHdri;
  probeRT = pmrem.fromScene(scene, 0, 0.05, 60, { size: 256, position: p, renderTarget: probeRT });
  scene.background = bg;
  reflectStats.lastMs = performance.now() - t0;
  reflectStats.maxMs = Math.max(reflectStats.maxMs, reflectStats.lastMs);
  reflectStats.captures++;
  reflectStats.at = t0;
  reflectStats.glossy = 0;
  const env = probeRT.texture;
  eachGlossy(scene, (m) => {
    reflectStats.glossy++;
    if (!(ENV_KEY in m.userData)) m.userData[ENV_KEY] = m.envMap;
    if (m.envMap !== env) {
      m.envMap = env;
      m.needsUpdate = true;
    }
  });
  applied = true;
  reflectStats.finishMs = performance.now() - t0;
  reflectStats.maxFinishMs = Math.max(reflectStats.maxFinishMs, reflectStats.finishMs);
}

const wallBox = new Box3();
let roomBoxes: RoomBox[] = [];
let roomBoxesCount = -1;
let roomBoxesAge = 0;

/** Hộp trong-nhà mỗi tầng từ tường + trần của registry (gom theo tổ tiên là node `level`). */
function collectRoomBoxes(registry: RegistryLike): RoomBox[] {
  const levels = new Set([...(registry.byType.level ?? [])].map((id) => registry.nodes.get(id)).filter(Boolean) as Object3D[]);
  const items: { level: string; kind: 'wall' | 'ceiling'; box: RoomBox }[] = [];
  for (const kind of ['wall', 'ceiling'] as const) {
    for (const id of registry.byType[kind] ?? []) {
      const obj = registry.nodes.get(id);
      if (!obj) continue;
      let lv: Object3D | null = obj.parent;
      while (lv && !levels.has(lv)) lv = lv.parent;
      wallBox.setFromObject(obj);
      if (wallBox.isEmpty()) continue;
      const { min, max } = wallBox;
      items.push({ level: lv?.uuid ?? '', kind, box: { minX: min.x, minY: min.y, minZ: min.z, maxX: max.x, maxY: max.y, maxZ: max.z } });
    }
  }
  return levelBoxes(items);
}

/**
 * Tín hiệu trong-nhà cho phông cửa sổ: mỗi khung (chỉ khi phông đã nạp hoặc đang chờ tải), độc lập probe phản chiếu.
 * Hộp tính lại khi số node đổi hoặc mỗi 60 khung (tường kéo/sửa). Xuất cho test.
 */
export function syncWinInside(p: Vector3, registry: RegistryLike): void {
  if (!winSky && !winRequest) return;
  if (registry.nodes.size !== roomBoxesCount || ++roomBoxesAge >= 60) {
    roomBoxes = collectRoomBoxes(registry);
    roomBoxesCount = registry.nodes.size;
    roomBoxesAge = 0;
  }
  const inside = insideRoomBox(p, roomBoxes);
  winViewState.inside = inside;
  if (winRequest && !isFirstLoad() && winApplies(winRequestScope, inside)) {
    const load = winRequest;
    winRequest = null;
    load();
  }
  if (inside !== camInside) {
    camInside = inside;
    applySky();
  }
}

/**
 * Gọi mỗi khung từ `Lights` (vendor). Rẻ khi không chụp: so vị trí camera + đếm node.
 * Khi camera đứng yên và đã đi > 1,5 m / cảnh thêm node: biên dịch trước (`warm`) rồi chụp ở khung sau (`probeStep`).
 */
export function syncReflectionProbe(renderer: unknown, scene: Scene, camera: PerspectiveCamera, registry: RegistryLike): void {
  const p = camera.position;
  syncWinInside(p, registry);
  const moving = p.distanceToSquared(prev) > 1e-6;
  prev.copy(p);
  const { tier, backend, flags } = useRealism.getState();
  const enabled = backend === 'webgpu' && flags.materials && tier !== 'low';
  if (!enabled) {
    if (applied) restore(scene);
    if (glassSwapped) restoreGlass(scene);
    lastCount = -1; // bật lại → đổi kính ngay lần đứng yên đầu
    ready = false;
    return;
  }
  // Lần nạp đầu (lớp che `loadOverlay`): đồ đạc còn đổ về → số node đổi liên tục, mỗi lần chụp lại đổi
  // envMap → dựng lại shader vật bóng. Đợi nạp xong, lần đứng yên kế tiếp mới chụp (lastCount cũ → "đổi").
  if (isFirstLoad()) return;
  const count = registry.nodes.size;
  const changed = count !== lastCount || last.distanceToSquared(p) >= 2.25;
  const step = probeStep({ busy, ready, moving: moving || (ready && at.distanceToSquared(p) > 1e-6), changed });
  if (step === 'idle') return;
  if (step === 'drop') {
    ready = false;
    lastCount = -1; // camera đã đi trong lúc biên dịch → làm lại khi đứng yên
    return;
  }
  if (step === 'finish') {
    ready = false;
    finish(renderer, scene, p, wantInside);
    return;
  }
  last.copy(p);
  lastCount = count;
  at.copy(p);
  const ceilings = [...(registry.byType.ceiling ?? [])].map((id) => registry.nodes.get(id)).filter(Boolean) as Object3D[];
  wantInside = reflectProbeWanted(p, ceilings);
  busy = true;
  warm(renderer as WebGPURenderer, scene, at.clone(), wantInside)
    .catch(() => undefined) // biên dịch trước hỏng thì vẫn chụp (đồng bộ như cũ)
    .finally(() => {
      busy = false;
      ready = true;
    });
}
