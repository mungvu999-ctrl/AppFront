/**
 * S3 (levelwarm): làm ấm tầng ẩn khi trang rảnh, để lần đầu bấm "Tầng 2" không phải dựng shader/pipeline/texture.
 *
 * Gốc (đọc mã): tầng không chọn bị `obj.visible = false` (vendor `level-system.tsx`, luật u70 bỏ cả shadow-only);
 * three `Renderer._projectObject` dừng ở `visible === false` → tầng ẩn không có render object, không dựng TSL
 * (CPU), không tải texture/buffer lên GPU (bindings), không tạo pipeline (GPU) — kể cả lượt bóng. Lô gộp
 * (node-batch) của tầng ẩn không bao giờ vẽ nên sau 5 s vật gốc vẫn bị ẩn (`AWAIT_DRAW_MAX_MS`) → bấm tầng thì
 * sàn/đồ gộp vắng tới khi W2 (`warm.ts`) dựng xong từng khoá với ngân sách 150 ms/khung.
 *
 * Cách làm: mỗi lần trình duyệt rảnh (`requestIdleCallback`, còn ≥ `IDLE_MIN_MS`) sau khi lần nạp đầu xong và
 * cảnh đang xem đã dựng hết, khung sống kế tiếp bật tạm tầng ẩn (gần tầng đang xem trước) trong lúc vẽ, chặn
 * `backend.draw` cho vật của tầng ấy — three vẫn chạy đúng đường vẽ thật (đúng ngữ cảnh pass/MRT/bóng): dựng
 * shader qua W2, bindings/texture, pipeline bất đồng bộ qua W1 — nhưng không vẽ gì ra màn hình. Mỗi khung tối đa
 * `MAX_NEW_BUILDS` khoá shader mới. Đèn trong tầng ẩn bị tắt trong khung ấm (giữ nguyên bộ đèn → khoá shader
 * không đổi). Tầng xong khi một khung ấm thấy mọi vật của nó sẵn sàng và không còn đồ GLB chưa nạp.
 *
 * Không chạy ở tier `low`, khi W2 tắt (`?disable=warm|nodebuild`), hoặc `?disable=levelwarm`. Gắn từ vendor
 * `post-processing.tsx` (luật `scripts/realism/w3-level-warm.mjs`). Đầu dò: `levelReadiness()`.
 */
import { sceneRegistry, useScene } from '@pascal-app/core';

import { markDirty } from './idle';
import type { RealismTier } from './store';
import { currentTier } from './tiers';
import { isFirstLoad, warmStats } from './warm';

const DISABLED = typeof location !== 'undefined' ? (new URLSearchParams(location.search).get('disable') ?? '').split(',') : [];
const URL_OFF = DISABLED.includes('levelwarm');

/** Khoá shader mới tối đa mỗi khung ấm (~36 ms/khoá) — giữ khung ấm ngắn, không thành tác vụ dài. */
// ponytail: số cố định; đổi thành ngân sách ms nếu đo thấy khung ấm vẫn dài.
export const MAX_NEW_BUILDS = 2;
/** Thời gian rảnh tối thiểu trong lượt rảnh để xin một khung ấm (ms). */
export const IDLE_MIN_MS = 8;

export interface LevelInfo {
  id: string;
  index: number;
  shown: boolean;
  /** Tác giả tắt mắt tầng — không làm ấm (tốn bộ nhớ cho thứ không xem). */
  userHidden: boolean;
}

/** Thuần: tầng ẩn kế tiếp cần làm ấm — gần tầng đang hiện nhất, hoà thì tầng thấp trước. */
export function nextWarmLevel(
  levels: readonly LevelInfo[],
  warmed: ReadonlySet<string>,
  opts: { tier: RealismTier; off: boolean; busy: boolean },
): string | null {
  if (opts.off || opts.tier === 'low' || opts.busy) return null;
  const shown = levels.filter((l) => l.shown).map((l) => l.index);
  const ref = shown.length ? Math.min(...shown) : 0;
  const cand = levels.filter((l) => !l.shown && !l.userHidden && !warmed.has(l.id));
  cand.sort((a, b) => Math.abs(a.index - ref) - Math.abs(b.index - ref) || a.index - b.index);
  return cand[0]?.id ?? null;
}

export interface WarmState {
  sceneKey: string;
  warmed: Set<string>;
  current: string | null;
}
/** Thuần: cảnh dựng lại (bộ gốc tầng/cảnh đổi) → huỷ việc đang làm và quên các tầng đã ấm. */
export function syncScene(state: WarmState, sceneKey: string): boolean {
  if (state.sceneKey === sceneKey) return false;
  state.sceneKey = sceneKey;
  state.warmed.clear();
  state.current = null;
  return true;
}

interface Obj {
  parent?: Obj | null;
  visible: boolean;
  frustumCulled?: boolean;
  isLight?: boolean;
  castShadow?: boolean;
  shadow?: { needsUpdate: boolean };
  userData?: Record<string, unknown>;
  uuid?: string;
  traverse?(f: (o: Obj) => void): void;
}

const state: WarmState = { sceneKey: '', warmed: new Set(), current: null };
let armed = false;
let frameScene: unknown = null;
let warmRoot: Obj | null = null;
let rootIds = new Map<Obj, string>();
const rootOf = new WeakMap<object, Obj | null>();
const keysThisFrame = new Set<string>();
/** Vật chưa sẵn sàng theo tầng trong khung sống hiện tại / khung gần nhất chạm tầng ấy. */
const framePending = new Map<string, number>();
const lastPending = new Map<string, number>();

function levelRootOf(o: Obj): Obj | null {
  const hit = rootOf.get(o);
  if (hit !== undefined) return hit;
  let p: Obj | null | undefined = o;
  for (let i = 0; p && i < 24; i++, p = p.parent) if (rootIds.has(p)) break;
  const root = p && rootIds.has(p) ? p : null;
  rootOf.set(o, root);
  return root;
}

function refreshRoots(scene: unknown): void {
  const ids = [...(sceneRegistry.byType.level ?? [])];
  const next = new Map<Obj, string>();
  for (const id of ids) {
    const o = sceneRegistry.nodes.get(id) as Obj | undefined;
    if (o) next.set(o, id);
  }
  const key = `${(scene as { uuid?: string })?.uuid ?? ''}|${ids.join(',')}|${[...next.keys()].map((o) => o.uuid).join(',')}`;
  if (syncScene(state, key)) {
    lastPending.clear();
    armed = false;
  }
  rootIds = next;
}

function levelInfos(): LevelInfo[] {
  const nodes = useScene.getState().nodes as Record<string, { level?: number; visible?: boolean } | undefined>;
  return [...rootIds].map(([o, id]) => ({ id, index: nodes[id]?.level ?? 0, shown: o.visible, userHidden: nodes[id]?.visible === false }));
}

/** Đồ GLB chưa nạp xong (mạng/giải mã) theo tầng. */
function unsettledItems(): Map<string, number> {
  const out = new Map<string, number>();
  for (const id of sceneRegistry.byType.item ?? []) {
    const o = sceneRegistry.nodes.get(id) as Obj | undefined;
    if (!o || o.userData?.itemModelSettled === true) continue;
    const root = levelRootOf(o);
    const lid = root ? rootIds.get(root) : undefined;
    if (lid) out.set(lid, (out.get(lid) ?? 0) + 1);
  }
  return out;
}

const sceneBusy = (): boolean => {
  const w = warmStats();
  return isFirstLoad() || w.pending > 0 || w.buildsPending > 0 || w.texWaiting > 0;
};

let ricStarted = false;
function onIdle(deadline: { timeRemaining(): number }): void {
  requestIdleCallback(onIdle);
  if (armed || deadline.timeRemaining() < IDLE_MIN_MS) return;
  if (state.current === null) state.current = nextWarmLevel(levelInfos(), state.warmed, { tier: currentTier(), off: URL_OFF, busy: sceneBusy() });
  if (state.current === null) return;
  armed = true;
  markDirty('level-warm');
}

/** Bọc lệnh vẽ trong `liveFrame` (vendor `post-processing.tsx`). */
export function levelWarmFrame(scene: unknown, draw: () => void): void {
  refreshRoots(scene);
  frameScene = scene;
  framePending.clear();
  keysThisFrame.clear();
  const root = armed && state.current ? ([...rootIds].find(([, id]) => id === state.current)?.[0] ?? null) : null;
  armed = false;
  if (state.current && !root) state.current = null;
  const culled: Obj[] = [];
  const lights: Obj[] = [];
  if (root && root.visible) state.current = null; // người dùng vừa chọn tầng ấy: W2 lo
  else if (root) {
    warmRoot = root;
    root.visible = true;
    root.traverse?.((o) => {
      if (o.isLight && o.visible) (o.visible = false), lights.push(o);
      else if (o.frustumCulled) (o.frustumCulled = false), culled.push(o);
    });
    // Bóng có cache (shadow-cache.ts): ép vẽ lại map để lượt bóng cũng tạo pipeline cho tầng ấm.
    (scene as Obj).traverse?.((o) => {
      if (o.isLight && o.castShadow && o.shadow) o.shadow.needsUpdate = true;
    });
  }
  try {
    draw();
  } finally {
    frameScene = null;
    for (const [id, n] of framePending) lastPending.set(id, n);
    if (warmRoot) {
      warmRoot.visible = false;
      for (const o of culled) o.frustumCulled = true;
      for (const o of lights) o.visible = true;
      const id = state.current!;
      const done = (framePending.get(id) ?? 0) === 0 && !sceneBusy() && !unsettledItems().get(id);
      if (done) {
        state.warmed.add(id);
        state.current = null;
      }
      warmRoot = null;
    }
  }
}

interface RendererLike {
  _objects?: { get(...a: unknown[]): unknown };
  _nodes?: { get(ro: unknown): { nodeBuilderState?: unknown }; nodeBuilderCache: Map<string, unknown>; getForRenderCacheKey(ro: unknown): string };
  _pipelines?: { isReady(ro: unknown): boolean };
  backend?: { draw: (...a: unknown[]) => void };
  _renderObjectDirect: (...a: unknown[]) => void;
  _currentRenderContext: unknown;
  __asyncW2?: true;
  __levelWarm?: true;
}
const noop = () => {};

/** Bọc `_renderObjectDirect` (lớp ngoài W2) một lần; gọi sau `installAsyncNodeBuilds`. */
export function installLevelWarm(renderer: unknown, off = URL_OFF): void {
  const r = renderer as RendererLike;
  const { _objects: objects, _nodes: nodes, _pipelines: pipelines, backend } = r;
  if (off || r.__levelWarm || !r.__asyncW2 || !objects || !nodes || !pipelines || !backend) return;
  r.__levelWarm = true;
  if (!ricStarted && typeof requestIdleCallback === 'function') {
    ricStarted = true;
    requestIdleCallback(onIdle);
  }
  const inner = r._renderObjectDirect;
  r._renderObjectDirect = function (this: RendererLike, ...args: unknown[]) {
    const [object, material, scene, camera, lightsNode, , clippingContext, passId] = args;
    if (frameScene === null || scene !== frameScene) return inner.apply(this, args);
    const root = levelRootOf(object as Obj);
    const id = root ? rootIds.get(root) : undefined;
    if (id === undefined) return inner.apply(this, args);
    const ro = objects.get(object, material, scene, camera, lightsNode, r._currentRenderContext, clippingContext, passId);
    const key = nodes.getForRenderCacheKey(ro);
    const built = nodes.get(ro).nodeBuilderState !== undefined || nodes.nodeBuilderCache.has(key);
    framePending.set(id, (framePending.get(id) ?? 0) + (built && pipelines.isReady(ro) ? 0 : 1));
    if (root !== warmRoot) return inner.apply(this, args);
    if (!built && !keysThisFrame.has(key)) {
      if (keysThisFrame.size >= MAX_NEW_BUILDS) return void markDirty('level-warm');
      keysThisFrame.add(key);
    }
    const draw = backend.draw;
    backend.draw = noop;
    try {
      inner.apply(this, args);
    } finally {
      backend.draw = draw;
    }
  };
}

export interface LevelReadiness {
  levelId: string;
  shown: boolean;
  /** Đồ GLB của tầng chưa nạp xong. */
  pendingAssets: number;
  /** Vật chưa có shader/pipeline ở khung gần nhất chạm tầng; `null` = tầng chưa từng vào khung nào. */
  pendingDraws: number | null;
  warmed: boolean;
  ready: boolean;
}

/** Cho đầu dò/E2E: tầng nào còn đang nạp. */
export function levelReadiness(): LevelReadiness[] {
  const items = unsettledItems();
  return [...rootIds].map(([o, levelId]) => {
    const pendingAssets = items.get(levelId) ?? 0;
    const pendingDraws = lastPending.get(levelId) ?? null;
    const warmed = state.warmed.has(levelId);
    return { levelId, shown: o.visible, pendingAssets, pendingDraws, warmed, ready: pendingAssets === 0 && (pendingDraws === 0 || (pendingDraws === null && warmed)) };
  });
}
