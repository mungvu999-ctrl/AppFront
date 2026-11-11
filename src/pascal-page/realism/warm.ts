/**
 * W1: lượt vẽ tạo pipeline BẤT ĐỒNG BỘ, để GPU không treo cả trang khi biên dịch shader.
 *
 * three 0.186 vẽ thì tạo pipeline đồng bộ (`device.createRenderPipeline`); trên Windows/D3D12 mỗi vật liệu
 * đồ đạc tốn ~250 ms biên dịch DXC trên luồng chính GPU → căn hộ F1 khựng từng đợt 5–8 s, tổng ~13 s
 * (đo 2026-10-29, `F:/App/qa-results/perf-load-editor3d/NGUYEN-NHAN.md`).
 *
 * three đã có sẵn đường không chặn: `Pipelines.getForRender(ro, promises)` với mảng `promises` gọi
 * `createRenderPipelineAsync` (Dawn biên dịch trên luồng worker), và `Renderer` bỏ qua vẽ vật nào pipeline
 * chưa sẵn (`isReady`). Ở đây cho chính lượt vẽ thật đi đường ấy — khoá pipeline đúng ngữ cảnh thật (đích,
 * MRT, callDepth, số mẫu), phủ cả bóng đổ. Đổi lại: vật hiện dần khi pipeline của nó xong thay vì cả trang
 * đứng. Xong một pipeline → `markDirty` để vòng vẽ theo nhu cầu (R2) vẽ lại.
 *
 * CHỈ trong khung sống (`liveFrame`) và CHỈ vật của cảnh chính: lượt vẽ một lần (thumbnail, snapshot,
 * `__pascalCapture`, PMREM/probe) bỏ vật thì ra ảnh thiếu — và PMREM còn bị cache luôn ở dạng thiếu; quad
 * hậu kỳ (QuadMesh tự là "scene" của nó) bỏ vẽ thì canvas nháy trống. Những lượt đó vẫn đồng bộ như cũ.
 *
 * Gắn từ vendor `post-processing.tsx` (luật `scripts/realism/w1-warm-pipelines.mjs`); `?disable=warm` tắt
 * để bộ đo so trước/sau.
 *
 * W2 (`installAsyncNodeBuilds`): phần JS dựng shader TSL (`NodeBuilder.build`, ~4,5 s trên luồng chính
 * trang khi nạp F1) cũng bỏ khỏi khung sống. Vật của cảnh chính chưa có shader thì khung này bỏ qua nó và
 * khởi động `getForRenderAsync` (three nhả luồng sau mỗi stage) — tối đa `BUILD_BUDGET_MS` mỗi khung cho
 * đoạn đồng bộ đầu (`prebuild` + `setup` fragment), còn lại để khung sau. Bản dựng đọc trạng thái renderer
 * (đích, MRT, `_currentRenderContext`, `contextNode`) rải sau các `await`, lúc khung đã xong → mỗi bản dựng
 * nhận một renderer "proxy" chụp đúng trạng thái của khung sống lúc khởi động. `?disable=nodebuild` tắt riêng.
 * Thứ tự dựng: vật lớn trên màn hình trước (`build-order.ts`, `?disable=buildorder` tắt).
 */
import { sceneRegistry } from '@pascal-app/core';

import { coversScreen, screenSize } from './build-order';
import { markDirty } from './idle';
import { installLoadOverlay, LOAD_CAP_MS } from './loadOverlay';
import { hasPendingTextures, whenTexturesReady } from './texturePreload';

interface RenderObjectLike {
  scene: unknown;
}

interface PipelinesLike {
  getForRender(renderObject: unknown, promises?: Promise<unknown>[] | null): unknown;
  updateForRender(renderObject: unknown): void;
  __asyncW1?: true;
}

const DISABLED = typeof location !== 'undefined' ? (new URLSearchParams(location.search).get('disable') ?? '').split(',') : [];
const URL_OFF = DISABLED.includes('warm');
const NODE_BUILD_OFF = DISABLED.includes('nodebuild');
const LAZY_DISPOSE_OFF = DISABLED.includes('lazydispose');
const ORDER_OFF = DISABLED.includes('buildorder');
const OVERLAY_OFF = DISABLED.includes('loadoverlay');

/**
 * Ngân sách mỗi khung cho đoạn dựng đồng bộ đầu của các bản dựng mới (ms); `?buildbudget=` để so.
 * Một bản dựng ~36 ms, mà khung nào cũng vẽ lại cả cảnh (~25–30 ms): 8 ms = một bản mỗi khung, ~105 khung khi
 * nạp F1. 150 ms dựng ~4 bản mỗi khung → ít khung hơn; A/B 10 lượt mỗi bên: pha dựng 6,2 → 5,1 s (trung vị),
 * đổi lại khung lúc nạp dài hơn (`F:/App/qa-results/perf-load-editor3d/NGUYEN-NHAN.md`).
 */
export const BUILD_BUDGET_MS = Number(typeof location !== 'undefined' ? new URLSearchParams(location.search).get('buildbudget') : null) || 150;

const stats = { started: 0, done: 0, lastDoneAt: 0, builds: 0, buildsDone: 0, skipped: 0, lastBuildAt: 0, lastActivityAt: -Infinity, lazyDisposed: 0, texWaiting: 0, texStale: 0, structPending: 0, structDrawnAt: 0 };

/**
 * Vật liệu còn ảnh đang nạp (`texturePreload.ts`: `userData.texPending`): ảnh về là gán mọi map một lượt
 * → khoá node đổi → dựng lần hai. Không dựng tới khi `texturesready` (hoặc quá 10 s: đếm cũ trên bản clone
 * ngoài `queueTextureAssignment`, vd. vật liệu tô sáng tường — đếm `texStale`, dựng luôn).
 */
const texState = new WeakMap<object, 'wait' | 'stale'>();
function texturesPending(material: unknown): boolean {
  const m = material as Parameters<typeof hasPendingTextures>[0];
  if (!m?.userData || !hasPendingTextures(m)) return false;
  const st = texState.get(m);
  if (st === 'stale') return false;
  if (st === undefined) {
    texState.set(m, 'wait');
    stats.texWaiting++;
    touch();
    void whenTexturesReady(m).then(() => {
      stats.texWaiting--;
      if (hasPendingTextures(m)) {
        texState.set(m, 'stale');
        stats.texStale++;
      } else texState.delete(m);
      touch();
      markDirty('textures');
    });
  }
  return true;
}

/** Mốc biên dịch gần nhất (pipeline/dựng shader bắt đầu, xong, hay còn chờ) — `tiers.ts` không tính giây ấy là chậm. */
export function compileActiveSince(nowMs = performance.now()): number {
  return stats.started > stats.done || stats.builds > stats.buildsDone ? nowMs : stats.lastActivityAt;
}
const touch = () => {
  stats.lastActivityAt = performance.now();
};
/**
 * Lần nạp đầu (nhãn `loadOverlay.ts`, KHÔNG che cảnh): kết cấu (tường, sàn, trần, cửa…) dựng trước và vẽ
 * ngay khi xong; đồ đạc dựng sau với ngân sách lớn hơn (`LOAD_BUILD_BUDGET_MS`), và khi chỉ còn đồ đạc thì
 * chỉ vẽ ~1 khung mỗi `LOAD_DRAW_MS` (mỗi khung mã hoá cả cảnh ~25–30 ms). Hết khi nhãn gỡ (yên) hoặc tự hết
 * ở `firstLoadUntil` = mốc bắt đầu nạp + `LOAD_CAP_MS` (renderer tạo lại giữa chừng không dời mốc).
 */
let firstLoadUntil = 0;
let lastLoadDraw = -Infinity;
export const LOAD_DRAW_MS = 200;
/** Ngân sách dựng mỗi khung lúc nạp đầu: vô hạn thì một khung treo luồng chính vài giây (cảnh đã hiện, và
 * bộ đếm giờ của nhãn trễ theo — nguyên nhân nhãn ở tới 34 s dù giới hạn 20 s). */
export const LOAD_BUILD_BUDGET_MS = 400;
/** Trả mốc hết lần nạp đầu; đang nạp dở thì giữ mốc cũ (giới hạn tính từ lúc nạp thật sự bắt đầu). */
export function beginFirstLoad(nowMs = performance.now()): number {
  if (nowMs < firstLoadUntil) return firstLoadUntil;
  firstLoadUntil = nowMs + LOAD_CAP_MS;
  lastLoadDraw = -Infinity;
  structDirty = false;
  return firstLoadUntil;
}
export function endFirstLoad(): void {
  if (firstLoadUntil === 0) return;
  firstLoadUntil = 0;
  markDirty('load-ready');
}
export const isFirstLoad = (nowMs = performance.now()): boolean => nowMs < firstLoadUntil;
const budget = (): number => (isFirstLoad() ? LOAD_BUILD_BUDGET_MS : BUILD_BUDGET_MS);

/** Loại nút kết cấu (registry `useRegistry(id, type, ref)`): dựng/vẽ trước đồ đạc lúc nạp đầu. */
const STRUCTURE_TYPES = ['wall', 'slab', 'ceiling', 'door', 'window', 'roof', 'roof-segment', 'stair', 'stair-segment', 'column'];
/** Hạng cộng thêm cho kết cấu — luôn trên mọi cỡ màn hình thật. */
const STRUCT_RANK = 1e6;
interface RegistryLike {
  nodes: Map<string, unknown> & { revision?: number };
  byType: Record<string, Set<string> | undefined>;
}
let structRoots = new Set<unknown>();
let structRev: number | undefined = -1;
/** Vật (mesh) thuộc một nút kết cấu: dò lên cha tới gốc đã đăng ký. */
export function isStructure(object: unknown, registry: RegistryLike = sceneRegistry as unknown as RegistryLike): boolean {
  const rev = registry.nodes.revision;
  if (rev === undefined || rev !== structRev) {
    structRev = rev;
    structRoots = new Set();
    for (const t of STRUCTURE_TYPES) for (const id of registry.byType[t] ?? []) structRoots.add(registry.nodes.get(id));
  }
  let o = object as { parent?: unknown } | null | undefined;
  for (let i = 0; o && i < 12; i++, o = o.parent as typeof o) if (structRoots.has(o)) return true;
  return false;
}
/** Kết cấu vừa xong bản dựng/pipeline → khung sau vẽ ngay, không đợi nhịp `LOAD_DRAW_MS`. */
let structDirty = false;
/** Số khoá kết cấu còn chờ dựng ở khung trước (lúc nạp đầu). */
let structBacklog = 0;

/** Thời gian dựng node đã tiêu trong khung sống hiện tại. */
let frameSpent = 0;
/** Renderer proxy cho bản dựng đang khởi động (đọc trong `_createNodeBuilder`); ngoài lúc ấy là `null`. */
let buildRenderer: unknown = null;
/** Khoá shader đang dựng: nhiều render object (pass cảnh, bóng, lớp) cùng khoá chỉ dựng một lần, xong thì lấy từ cache. */
const pendingKeys = new Set<string>();
/** Cảnh chính đang được vẽ ở khung sống; `null` = ngoài khung sống → tạo pipeline đồng bộ như three gốc. */
let liveScene: unknown = null;

/** Bọc lệnh vẽ khung sống của viewport (vendor `post-processing.tsx`). */
export function liveFrame(scene: unknown, draw: () => void, nowMs = performance.now()): void {
  if (isFirstLoad(nowMs)) {
    // Kết cấu còn chờ/vừa xong: vẽ ngay. Chỉ còn đồ đạc: ≤ 1 khung mỗi LOAD_DRAW_MS, khung bỏ vẫn giữ vòng vẽ chạy.
    if (structBacklog === 0 && !structDirty && nowMs - lastLoadDraw < LOAD_DRAW_MS) return void markDirty('load-wait');
    lastLoadDraw = nowMs;
    structDirty = false;
  }
  liveScene = scene;
  frameSpent = 0;
  try {
    draw();
  } finally {
    liveScene = null;
    rankFrame();
  }
  // Kết cấu đã vẽ đủ lần đầu (không còn chờ dựng/pipeline): chữ "Đang dựng mô hình 3D…" (`PascalTour`) tắt theo mốc này.
  if (stats.structDrawnAt === 0 && isFirstLoad(nowMs) && structSeen && structBacklog === 0 && stats.structPending === 0) {
    stats.structDrawnAt = Math.round(nowMs);
  }
}
/** Đã khởi động ít nhất một bản dựng/pipeline kết cấu trong lần nạp đầu. */
let structSeen = false;

/** Bọc `updateForRender` của `renderer._pipelines` một lần; gọi mỗi khung cũng rẻ. */
export function installAsyncPipelines(renderer: unknown, off = URL_OFF): void {
  const pipelines = (renderer as { _pipelines?: PipelinesLike })._pipelines;
  if (off || !pipelines || pipelines.__asyncW1) return;
  pipelines.__asyncW1 = true;
  // Mỗi renderer mới (vào editor) một nhãn nạp đầu; node test không có `document`.
  const host = (renderer as { domElement?: HTMLElement }).domElement?.parentElement;
  if (!OVERLAY_OFF && typeof document !== 'undefined' && host) {
    installLoadOverlay(host, warmStats, endFirstLoad, beginFirstLoad());
  }
  const sink: Promise<unknown>[] = [];
  const onDone = () => {
    stats.done++;
    stats.lastDoneAt = Math.round(performance.now());
    touch();
    markDirty('pipeline');
  };
  const onStructDone = () => {
    structDirty = true;
    stats.structPending--;
    onDone();
  };
  pipelines.updateForRender = (renderObject) => {
    if (liveScene === null || (renderObject as RenderObjectLike).scene !== liveScene) {
      pipelines.getForRender(renderObject);
      return;
    }
    pipelines.getForRender(renderObject, sink);
    if (!sink.length) return;
    stats.started += sink.length;
    touch();
    // three luôn resolve (kể cả khi lỗi — pipeline hỏng thì vật không vẽ, đã báo lỗi ra console).
    const struct = isFirstLoad() && isStructure((renderObject as { object?: unknown }).object);
    if (struct) {
      structSeen = true;
      stats.structPending += sink.length;
    }
    for (const p of sink.splice(0)) p.then(struct ? onStructDone : onDone);
  };
}

interface NodeData {
  nodeBuilderState?: unknown;
}
interface NodesLike {
  get(renderObject: unknown): NodeData;
  nodeBuilderCache: Map<string, unknown>;
  getForRenderCacheKey(renderObject: unknown): string;
  getForRenderAsync(renderObject: unknown): Promise<unknown>;
  _createNodeBuilder(renderObject: unknown, material: unknown): { renderer: unknown };
}
interface RendererLike {
  _nodes?: NodesLike;
  _objects?: { get(...args: unknown[]): unknown };
  _renderObjectDirect: (...args: unknown[]) => void;
  _currentRenderContext: unknown;
  contextNode: unknown;
  getRenderTarget(): unknown;
  getMRT(): unknown;
  _pipelines?: { isReady(renderObject: unknown): boolean };
  __asyncW2?: true;
}

/** Renderer giả mang trạng thái của khung sống lúc này; mọi thứ khác đọc xuyên qua renderer thật. */
function snapshotRenderer(r: RendererLike): unknown {
  const target = r.getRenderTarget();
  const mrt = r.getMRT();
  return Object.assign(Object.create(r) as object, {
    getRenderTarget: () => target,
    getMRT: () => mrt,
    _currentRenderContext: r._currentRenderContext,
    contextNode: r.contextNode,
  });
}

/** Bọc `_renderObjectDirect` + `_nodes._createNodeBuilder` một lần (W2). */
export function installAsyncNodeBuilds(renderer: unknown, off = URL_OFF || NODE_BUILD_OFF): void {
  const r = renderer as RendererLike;
  const nodes = r._nodes;
  const objects = r._objects;
  if (off || !nodes || !objects || r.__asyncW2) return;
  r.__asyncW2 = true;
  // Hệ gộp vẽ (vendor `node-batch/system.tsx`) chỉ ẩn vật gốc khi lưới gộp đã vẽ được (`userData.drawReady`).
  (globalThis as { __pascalDrawReady?: boolean }).__pascalDrawReady = true;
  const create = nodes._createNodeBuilder.bind(nodes);
  nodes._createNodeBuilder = (renderObject, material) => {
    const builder = create(renderObject, material);
    if (buildRenderer !== null) builder.renderer = buildRenderer;
    return builder;
  };
  const direct = r._renderObjectDirect;
  r._renderObjectDirect = function (this: RendererLike, ...args: unknown[]) {
    const [object, material, scene, camera, lightsNode, , clippingContext, passId] = args;
    let ro: unknown = null;
    if (liveScene !== null && scene === liveScene) {
      ro = objects.get(object, material, scene, camera, lightsNode, r._currentRenderContext, clippingContext, passId);
      const key = nodes.getForRenderCacheKey(ro);
      if (nodes.get(ro).nodeBuilderState === undefined && !nodes.nodeBuilderCache.has(key)) {
        stats.skipped++;
        if (pendingKeys.has(key) || texturesPending(material)) return;
        const m = (material ?? {}) as { isShadowPassMaterial?: boolean; transparent?: boolean };
        // Thứ tự (`build-order.ts`): vật đục lượt chính lớn trên màn hình trước; bóng đổ và vật trong suốt
        // chờ tới khi hàng ấy hết; vật phủ màn hình (nền) dựng ngay. Mọi bản dựng vẫn khởi động ngay tại
        // chỗ vẽ của vật — three gán tạm thuộc tính vật liệu theo từng lượt (bóng, mặt sau/trước của vật
        // trong suốt, ngữ cảnh pass), dựng lúc khác là sai shader (đã thử: F1 ra nền đen, tối cả cảnh).
        const cover = coversScreen(object);
        const opaqueMain = !ORDER_OFF && !cover && m.isShadowPassMaterial !== true && m.transparent !== true;
        // Lần nạp đầu: kết cấu xếp trên mọi đồ đạc; bóng/kính của kết cấu chỉ đợi hàng kết cấu, không đợi đồ đạc.
        const struct = !ORDER_OFF && isFirstLoad() && isStructure(object);
        if (opaqueMain && (!chosen.has(key) || frameSpent >= budget())) {
          // Xếp hạng ở khung này, khởi động ở khung sau ngay tại chỗ vẽ (trạng thái renderer đúng lượt).
          const size = screenSize(object, camera) + (struct ? STRUCT_RANK : 0);
          if ((ranked.get(key) ?? -1) < size) ranked.set(key, size);
          return;
        }
        if (!opaqueMain && !ORDER_OFF && !cover && (struct ? structBacklog : mainBacklog) > 0) return void markDirty('node-build');
        // Hết ngân sách khung này: khung sau khởi động tiếp (vòng vẽ theo nhu cầu phải còn chạy).
        if (frameSpent >= budget()) return void markDirty('node-build');
        startBuild(nodes, ro, key, snapshotRenderer(r), struct);
        return;
      }
    }
    direct.apply(this, args);
    if (ro !== null) markDrawReady(object, material, ro, r);
  };
}

/**
 * Lưới gộp (BatchedMesh) mới có khoá shader riêng (nút batching): tới khi lượt chính vẽ được nó, vật gốc
 * phải còn hiện — ẩn sớm là sàn/đồ đạc biến mất ~1–2 s lúc nạp đầu (sàn gỗ nháy trắng, đo 05/11).
 */
export function markDrawReady(object: unknown, material: unknown, ro: unknown, r: Pick<RendererLike, '_pipelines'>): void {
  const o = object as { isBatchedMesh?: boolean; userData?: Record<string, unknown> } | null;
  if (!o?.isBatchedMesh || !o.userData || o.userData.drawReady === true) return;
  if ((material as { isShadowPassMaterial?: boolean } | null)?.isShadowPassMaterial === true) return;
  if (r._pipelines?.isReady(ro)) o.userData.drawReady = true;
}

/** Cỡ trên màn hình của vật đục lượt chính chưa có shader gặp trong khung này, theo khoá. */
const ranked = new Map<string, number>();
/** Các khoá lớn nhất của khung trước — khung này khởi động chúng ngay tại chỗ vẽ. Số khoá = ngân sách chia
 * thời gian dựng trung bình (ít nhất 1), để vật lớn không bị vật nhỏ vẽ trước chiếm hết ngân sách. */
const chosen = new Set<string>();
/** Thời gian đoạn dựng đồng bộ trung bình (ms, trung bình trượt). */
let avgBuildMs = BUILD_BUDGET_MS;
/** Số vật đục lượt chính còn chờ ở khung trước — bóng đổ và vật trong suốt chưa dựng khi còn số này. */
let mainBacklog = 0;

function rankFrame(): void {
  mainBacklog = ranked.size;
  chosen.clear();
  const take = Math.max(1, Math.floor(budget() / avgBuildMs));
  let order = [...ranked].sort((a, b) => b[1] - a[1]);
  const structOnly = order.filter(([, size]) => size >= STRUCT_RANK);
  structBacklog = structOnly.length;
  // Còn kết cấu chờ: khung sau chỉ khởi động kết cấu (đồ đạc vẽ trước trong danh sách không chiếm ngân sách).
  if (structOnly.length) order = structOnly;
  for (const [key] of order.slice(0, take)) chosen.add(key);
  ranked.clear();
  if (mainBacklog > 0) markDirty('node-build');
}

function startBuild(nodes: NodesLike, ro: unknown, key: string, snap: unknown, struct = false): void {
  pendingKeys.add(key);
  stats.builds++;
  if (struct) {
    structSeen = true;
    stats.structPending++;
  }
  touch();
  const t0 = performance.now();
  buildRenderer = snap;
  let job: Promise<unknown>;
  try {
    // Thân async chạy đồng bộ tới `await` đầu: `_createNodeBuilder` thấy `buildRenderer` ngay trong lời gọi này.
    job = nodes.getForRenderAsync(ro);
  } finally {
    buildRenderer = null;
    const spent = performance.now() - t0;
    frameSpent += spent;
    avgBuildMs += (spent - avgBuildMs) * 0.2;
  }
  const done = () => {
    pendingKeys.delete(key);
    stats.buildsDone++;
    stats.lastBuildAt = Math.round(performance.now());
    if (struct) {
      structDirty = true;
      stats.structPending--;
    }
    touch();
    markDirty('node-build');
  };
  job.then(done, done);
}

interface BindingsLike {
  deleteForRender(renderObject: { _bindings: unknown }): void;
  delete(renderObject: unknown): void;
  __lazyDispose?: true;
}

/**
 * Huỷ render object chưa từng tạo bindings thì bỏ bước tạo. three (`Bindings.deleteForRender`) gọi
 * `getBindings()` để xoá, mà lời gọi ấy dựng ĐỒNG BỘ cả shader TSL nếu chưa có — R3F gỡ vật liệu/hình
 * khi đồ đạc nạp lại, W2 lại để nhiều vật chưa dựng, nên F1 mất ~1,3–1,7 s luồng chính chỉ để dựng rồi
 * vứt. Bindings chỉ sinh qua `getBindings()` (gán `_bindings`), nên `_bindings === null` là không có gì
 * để xoá. `?disable=lazydispose` tắt.
 */
export function installLazyDispose(renderer: unknown, off = LAZY_DISPOSE_OFF): void {
  const b = (renderer as { _bindings?: BindingsLike })._bindings;
  if (off || !b || b.__lazyDispose) return;
  b.__lazyDispose = true;
  const del = b.deleteForRender.bind(b);
  b.deleteForRender = (ro) => {
    if (ro._bindings === null) {
      stats.lazyDisposed++;
      b.delete(ro);
    } else del(ro);
  };
}

/** Cho bộ đo (`window.__pascalWarm`). */
export const warmStats = () => ({
  ...stats,
  pending: stats.started - stats.done,
  buildsPending: stats.builds - stats.buildsDone,
  off: URL_OFF,
  nodeBuildOff: NODE_BUILD_OFF,
});

if (typeof window !== 'undefined') (window as unknown as { __pascalWarm?: typeof warmStats }).__pascalWarm = warmStats;
