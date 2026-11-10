/**
 * S3 (levelwarm): làm ấm tầng ẩn khi trang rảnh, để lần đầu bấm "Tầng 2" không phải dựng shader/pipeline/texture.
 *
 * Gốc (đọc mã): tầng không chọn bị `obj.visible = false` (vendor `level-system.tsx`, luật u70 bỏ cả shadow-only);
 * three `Renderer._projectObject` dừng ở `visible === false` → tầng ẩn không có render object, không dựng TSL
 * (CPU), không tải texture/buffer lên GPU (bindings), không tạo pipeline (GPU) — kể cả lượt bóng. Lô gộp
 * (node-batch) của tầng ẩn không bao giờ vẽ nên sau 5 s vật gốc vẫn bị ẩn (`AWAIT_DRAW_MAX_MS`) → bấm tầng thì
 * sàn/đồ gộp vắng tới khi W2 (`warm.ts`) dựng xong từng khoá.
 *
 * Cách làm: `requestIdleCallback` chỉ để LÊN LỊCH (trang tự vẽ 50 fps nên `timeRemaining()` luôn < 8 ms — đo vòng 8,
 * 769/769 lượt bị chặn; không xét nó). Khi lần nạp đầu xong, W2 rảnh và người dùng không thao tác thì CHỌN một tầng ẩn (gần tầng đang xem trước). Từ đó MỌI khung sống liên tiếp bật tạm tầng ấy trong lúc vẽ
 * và chặn `backend.draw` cho vật của nó — three đi đúng đường vẽ thật (đúng pass/MRT, cả bóng): W2 dựng shader,
 * bindings tải texture/buffer, W1 tạo pipeline bất đồng bộ — nhưng không vẽ gì ra màn hình. Phải LIÊN TIẾP: W2
 * xếp hạng vật đục ở khung N rồi chỉ khởi động ở khung N+1 nếu gặp lại (`rankFrame` xoá `chosen` mỗi khung) — bản
 * đầu (1b2b796a) chỉ ấm một khung mỗi lượt rảnh nên vật đục không bao giờ được dựng.
 *
 * Ngân sách mỗi khung ấm: `LONG_TASK_MS` (ngưỡng tác vụ dài của trình duyệt) trừ phần vẽ thường của khung ấm trước
 * — khung ấm không tự biến thành tác vụ dài. Người dùng thao tác (camera/chuột/phím/chọn/hover — bộ đếm lý do của
 * `idle.ts` tăng) thì khung ấy không ấm; hết thao tác `HOLD_MS` thì ấm tiếp. Vật vượt ngân sách để khung sau. Đèn trong tầng ấm bị tắt trong khung
 * ấm (giữ bộ đèn → khoá shader không đổi). Tầng xong khi một khung ấm thấy mọi vật của nó sẵn sàng, W2/W1 hết việc
 * và không còn đồ GLB chưa nạp.
 *
 * Không chạy ở tier `low`, khi W2 tắt (`?disable=warm|nodebuild`), hoặc `?disable=levelwarm`. Gắn từ vendor
 * `post-processing.tsx` (luật `scripts/realism/w3-level-warm.mjs`; `installCalls`/`frameCalls` > 0 = luật đã áp).
 * Đầu dò: `levelReadiness()`, `levelWarmStats()` (`globalThis.__realismLevelWarm`).
 */
import { sceneRegistry, useScene } from '@pascal-app/core';

import { HOLD_MS, idleStats, markDirty } from './idle';
import type { RealismTier } from './store';
import { currentTier } from './tiers';
import { isFirstLoad, warmStats } from './warm';

const DISABLED = typeof location !== 'undefined' ? (new URLSearchParams(location.search).get('disable') ?? '').split(',') : [];
const URL_OFF = DISABLED.includes('levelwarm');

/** Ngưỡng tác vụ dài (Long Tasks API): cả khung ấm giữ dưới mức này. */
export const LONG_TASK_MS = 50;
/** Sàn ngân sách khung ấm: khung thường đã ≥ 50 ms thì vẫn tiến tối thiểu (một vật/khung). */
export const MIN_WARM_MS = 4;

export interface LevelInfo {
  id: string;
  index: number;
  shown: boolean;
  /** Tác giả tắt mắt tầng — không làm ấm (tốn bộ nhớ cho thứ không xem). */
  userHidden: boolean;
}

export type RejectReason = 'flagOff' | 'w2Off' | 'tierLow' | 'firstLoad' | 'w2Busy' | 'noHiddenLevel' | 'interacting';

/** Thuần: tầng ẩn kế tiếp cần làm ấm (gần tầng đang hiện nhất, hoà thì tầng thấp trước), hoặc lý do từ chối. */
export function nextWarmLevel(
  levels: readonly LevelInfo[],
  warmed: ReadonlySet<string>,
  opts: { tier: RealismTier; off: boolean; firstLoad: boolean; busy: boolean; interacting: boolean },
): { id: string } | { reason: RejectReason } {
  if (opts.off) return { reason: 'flagOff' };
  if (opts.tier === 'low') return { reason: 'tierLow' };
  if (opts.firstLoad) return { reason: 'firstLoad' };
  if (opts.busy) return { reason: 'w2Busy' };
  if (opts.interacting) return { reason: 'interacting' };
  const shown = levels.filter((l) => l.shown).map((l) => l.index);
  const ref = shown.length ? Math.min(...shown) : 0;
  const cand = levels.filter((l) => !l.shown && !l.userHidden && !warmed.has(l.id));
  cand.sort((a, b) => Math.abs(a.index - ref) - Math.abs(b.index - ref) || a.index - b.index);
  return cand[0] ? { id: cand[0].id } : { reason: 'noHiddenLevel' };
}

/** Thuần: ngân sách khung ấm kế tiếp từ phần vẽ thường (không tính việc ấm) của khung ấm trước. */
export const warmBudgetMs = (baseFrameMs: number): number => Math.max(MIN_WARM_MS, LONG_TASK_MS - baseFrameMs);

/** Lý do bẩn của `idle.ts` do người dùng gây ra. */
export const INTERACTION_REASONS = ['camera', 'input', 'hover', 'selection', 'resize'] as const;
/** Thuần: tổng số lần bẩn do thao tác — tăng giữa hai lần đọc = đang thao tác. */
export const interactionCount = (reasons: Readonly<Record<string, number>>): number =>
  INTERACTION_REASONS.reduce((n, r) => n + (reasons[r] ?? 0), 0);

/**
 * Thuần: tầng sẵn sàng khi không còn đồ GLB chờ và: đã làm ấm xong, HOẶC đang hiện, được chạm ở khung vẽ gần nhất
 * với 0 vật chờ shader/pipeline và W2/W1 hết việc. Tầng ẩn chưa ấm (chưa từng vẽ) luôn chưa sẵn sàng.
 */
export function isLevelReady(l: { pendingAssets: number; warmed: boolean; shown: boolean; touchedLastFrame: boolean; pendingDraws: number | null; w2Busy: boolean }): boolean {
  if (l.pendingAssets > 0) return false;
  if (l.warmed) return true;
  return l.shown && l.touchedLastFrame && l.pendingDraws === 0 && !l.w2Busy;
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
const stats = {
  installCalls: 0,
  installed: false,
  installReject: '' as '' | RejectReason | 'noRendererParts' | 'noIdleCallback',
  frameCalls: 0,
  idleCalls: 0,
  reject: { flagOff: 0, w2Off: 0, tierLow: 0, firstLoad: 0, w2Busy: 0, noHiddenLevel: 0, interacting: 0 } as Record<RejectReason, number>,
  levelsStarted: 0,
  warmFrames: 0,
  warmObjects: 0,
  budgetSkips: 0,
  keysStarted: 0,
  lastBudgetMs: 0,
  lastBaseMs: 0,
  lastWarmMs: 0,
  maxWarmFrameMs: 0,
  cancelled: 0,
  pausedFrames: 0,
  /** Lời gọi vẽ (đã chặn) dài nhất của một vật tầng ấm — ngân sách chỉ kiểm GIỮA các vật. */
  maxObjectMs: 0,
};
/** Khoá shader chưa dựng gặp trong khung ấm, theo tầng (≈ số bản dựng tầng ấy cần). */
const keysNeeded = new Map<string, Set<string>>();
let frameScene: unknown = null;
let warmRoot: Obj | null = null;
let rootIds = new Map<Obj, string>();
/** Gốc tầng đã tra theo vật, kèm cha trực tiếp lúc tra (đổi cha → tra lại). Không cache `null`. */
let rootOf = new WeakMap<object, { root: Obj; parent: Obj | null | undefined }>();
/** Vật chưa sẵn sàng theo tầng trong khung sống hiện tại / khung gần nhất chạm tầng ấy. */
const framePending = new Map<string, number>();
const lastPending = new Map<string, number>();
/** `frameCalls` của khung vẽ gần nhất chạm tầng. */
const lastTouch = new Map<string, number>();
let lastInteractions = -1;
let lastInteractAt = -Infinity;
let budgetMs = LONG_TASK_MS;
let warmSpent = 0;
let shadowsPending = true;
/** `levelReadiness()` vừa được hỏi → khung kế tiếp đếm vật chờ của mọi tầng (ngoài ra chỉ đếm trong khung ấm). */
let wantSample = false;
let sampling = false;
let lastSampleFrame = -1;

// ponytail: chỉ kiểm cha trực tiếp; một tổ tiên xa đổi cha thì cache sai tới lúc cảnh dựng lại.
function levelRootOf(o: Obj): Obj | null {
  const hit = rootOf.get(o);
  if (hit && hit.parent === o.parent && rootIds.has(hit.root)) return hit.root;
  let p: Obj | null | undefined = o;
  for (let i = 0; p && i < 24; i++, p = p.parent) if (rootIds.has(p)) break;
  if (!p || !rootIds.has(p)) return null; // không cache: vật vừa gắn vào tầng phải tra ra ngay khung sau
  rootOf.set(o, { root: p, parent: o.parent });
  return p;
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
    lastTouch.clear();
    rootOf = new WeakMap();
    keysNeeded.clear();
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

const w2Busy = (): boolean => {
  const w = warmStats();
  return w.pending > 0 || w.buildsPending > 0 || w.texWaiting > 0;
};

/** Đang thao tác: bộ đếm lý do thao tác của `idle.ts` vừa tăng, hoặc tăng trong `HOLD_MS` vừa qua. */
function interacting(nowMs = performance.now()): boolean {
  const n = interactionCount(idleStats().reasons);
  if (n !== lastInteractions) {
    if (lastInteractions !== -1) lastInteractAt = nowMs; // lần đọc đầu chỉ lấy mốc, không phải thao tác
    lastInteractions = n;
  }
  return nowMs - lastInteractAt < HOLD_MS;
}

function onIdle(): void {
  requestIdleCallback(onIdle);
  stats.idleCalls++;
  if (state.current !== null) return;
  const pick = nextWarmLevel(levelInfos(), state.warmed, {
    tier: currentTier(),
    off: URL_OFF,
    firstLoad: isFirstLoad(),
    busy: w2Busy(),
    interacting: interacting(),
  });
  if ('reason' in pick) return void stats.reject[pick.reason]++;
  state.current = pick.id;
  stats.levelsStarted++;
  shadowsPending = true;
  markDirty('level-warm');
}

/** Bọc lệnh vẽ trong `liveFrame` (vendor `post-processing.tsx`). Mọi thay đổi tạm lên cảnh nằm trong try/finally. */
export function levelWarmFrame(scene: unknown, draw: () => void): void {
  stats.frameCalls++;
  refreshRoots(scene);
  const root = state.current ? ([...rootIds].find(([, id]) => id === state.current)?.[0] ?? null) : null;
  if (state.current && (!root || root.visible)) {
    // Tầng mất (cảnh đổi) hoặc người dùng vừa chọn nó: W2 lo phần còn lại.
    state.current = null;
    stats.cancelled++;
  }
  const paused = root !== null && state.current !== null && interacting();
  if (paused) stats.pausedFrames++; // tầng vẫn là `current`; khung sau hết thao tác ấm tiếp
  const warm = root && state.current && !paused ? root : null;
  sampling = wantSample || warm !== null;
  wantSample = false;
  framePending.clear();
  const culled: Obj[] = [];
  const lights: Obj[] = [];
  let t0 = 0;
  try {
    if (warm) {
      warmRoot = warm;
      warm.visible = true;
      warm.traverse?.((o) => {
        if (o.isLight && o.visible) (o.visible = false), lights.push(o);
        else if (o.frustumCulled) (o.frustumCulled = false), culled.push(o);
      });
      // Bóng có cache (shadow-cache.ts): khi tầng ấm còn vật chưa sẵn sàng, ép vẽ lại map để lượt bóng cũng dựng.
      if (shadowsPending) {
        (scene as Obj).traverse?.((o) => {
          if (o.isLight && o.castShadow && o.shadow) o.shadow.needsUpdate = true;
        });
      }
      stats.lastBudgetMs = budgetMs;
    }
    warmSpent = 0;
    frameScene = scene;
    t0 = performance.now();
    draw();
  } finally {
    frameScene = null;
    warmRoot = null;
    if (warm) warm.visible = false;
    for (const o of culled) o.frustumCulled = true;
    for (const o of lights) o.visible = true;
  }
  // Chỉ tới đây khi `draw` không ném: mới ghi số đo/`warmed`.
  if (sampling) {
    lastSampleFrame = stats.frameCalls;
    for (const [id, n] of framePending) {
      lastPending.set(id, n);
      lastTouch.set(id, stats.frameCalls);
    }
  }
  sampling = false;
  if (!warm) return;
  const total = performance.now() - t0;
  stats.warmFrames++;
  stats.lastWarmMs = Math.round(warmSpent);
  stats.lastBaseMs = Math.round(total - warmSpent);
  stats.maxWarmFrameMs = Math.max(stats.maxWarmFrameMs, Math.round(total));
  budgetMs = warmBudgetMs(total - warmSpent);
  const id = state.current!;
  const pending = framePending.get(id) ?? 0;
  shadowsPending = pending > 0;
  if (pending === 0 && !w2Busy() && !unsettledItems().get(id)) {
    state.warmed.add(id);
    state.current = null;
  } else markDirty('level-warm'); // khung ấm kế tiếp phải liền ngay (bắt tay xếp hạng→dựng của W2)
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
let ricStarted = false;

/** Bọc `_renderObjectDirect` (lớp ngoài W2) một lần; gọi sau `installAsyncNodeBuilds`. */
export function installLevelWarm(renderer: unknown, off = URL_OFF): void {
  stats.installCalls++;
  const r = renderer as RendererLike;
  if (r.__levelWarm) return;
  const { _objects: objects, _nodes: nodes, _pipelines: pipelines, backend } = r;
  if (off) return void (stats.installReject = 'flagOff');
  if (!r.__asyncW2) return void (stats.installReject = 'w2Off');
  if (!objects || !nodes || !pipelines || !backend) return void (stats.installReject = 'noRendererParts');
  if (typeof requestIdleCallback !== 'function') return void (stats.installReject = 'noIdleCallback');
  r.__levelWarm = true;
  stats.installed = true;
  stats.installReject = '';
  if (!ricStarted) {
    ricStarted = true;
    requestIdleCallback(onIdle);
  }
  const inner = r._renderObjectDirect;
  r._renderObjectDirect = function (this: RendererLike, ...args: unknown[]) {
    const [object, material, scene, camera, lightsNode, , clippingContext, passId] = args;
    if (!sampling || frameScene === null || scene !== frameScene) return inner.apply(this, args);
    const root = levelRootOf(object as Obj);
    const id = root ? rootIds.get(root) : undefined;
    if (id === undefined) return inner.apply(this, args);
    const ro = objects.get(object, material, scene, camera, lightsNode, r._currentRenderContext, clippingContext, passId);
    const key = nodes.getForRenderCacheKey(ro);
    const built = nodes.get(ro).nodeBuilderState !== undefined || nodes.nodeBuilderCache.has(key);
    framePending.set(id, (framePending.get(id) ?? 0) + (built && pipelines.isReady(ro) ? 0 : 1));
    if (root !== warmRoot) return inner.apply(this, args);
    if (!built) {
      let need = keysNeeded.get(id);
      if (!need) keysNeeded.set(id, (need = new Set()));
      need.add(key);
    }
    if (warmSpent >= budgetMs) return void stats.budgetSkips++;
    if (!built) stats.keysStarted++;
    stats.warmObjects++;
    const draw = backend.draw;
    backend.draw = noop;
    const t = performance.now();
    try {
      inner.apply(this, args);
    } finally {
      backend.draw = draw;
      const spent = performance.now() - t;
      warmSpent += spent;
      if (spent > stats.maxObjectMs) stats.maxObjectMs = Math.round(spent);
    }
  };
}

export interface LevelReadiness {
  levelId: string;
  shown: boolean;
  /** Đồ GLB của tầng chưa nạp xong. */
  pendingAssets: number;
  /** Vật chưa có shader/pipeline ở khung lấy mẫu gần nhất chạm tầng; `null` = chưa từng lấy mẫu tầng này. */
  pendingDraws: number | null;
  warmed: boolean;
  ready: boolean;
}

/** Cho đầu dò/E2E: tầng nào còn đang nạp. */
export function levelReadiness(): LevelReadiness[] {
  // Số đếm vật chờ lấy ở khung có lấy mẫu gần nhất; hỏi lần này thì khung kế lấy mẫu (bài kiểm hỏi lặp).
  if (!wantSample) {
    wantSample = true;
    markDirty('level-readiness');
  }
  const items = unsettledItems();
  const busy = w2Busy();
  return [...rootIds].map(([o, levelId]) => {
    const pendingAssets = items.get(levelId) ?? 0;
    const pendingDraws = lastPending.get(levelId) ?? null;
    const warmed = state.warmed.has(levelId);
    const touchedLastFrame = lastTouch.get(levelId) === lastSampleFrame;
    const ready = isLevelReady({ pendingAssets, warmed, shown: o.visible, touchedLastFrame, pendingDraws, w2Busy: busy });
    return { levelId, shown: o.visible, pendingAssets, pendingDraws, warmed, ready };
  });
}

/** Bộ đếm chẩn đoán (đầu dò `levelWarmStats()`). */
export function levelWarmStats() {
  return {
    ...stats,
    reject: { ...stats.reject },
    off: URL_OFF,
    current: state.current,
    warmed: [...state.warmed],
    keysNeeded: Object.fromEntries([...keysNeeded].map(([id, s]) => [id, s.size])),
  };
}

(globalThis as { __realismLevelWarm?: object }).__realismLevelWarm = { levelReadiness, levelWarmStats };
