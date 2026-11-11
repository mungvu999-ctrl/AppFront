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
/**
 * V10 lát 2: lát 1 đo KHÔNG lợi (8 s: 2603 ms bật so với 2302 ms tắt) → mặc định = hành vi vòng 9; mỗi thay đổi bật bằng
 * `?enable=`: `lwshadow8` ép bóng mỗi 8 khung ấm; `lwshadow1` mỗi khung ép chỉ MỘT đèn bóng (xoay vòng); `lwnoshadow` không
 * ép bóng (cận dưới của phần bóng); `lwbudget` trần 10 ms việc ấm (cả khung đầu); `lwfast` dời vật quá ngân sách không tra
 * khoá + bỏ gọi vẽ vật đã sẵn sàng; `lwearly` cho làm ấm trong lần nạp đầu khi W2 rảnh. `?disable=lwphase` tắt đo pha.
 */
const ENABLED = typeof location !== 'undefined' ? (new URLSearchParams(location.search).get('enable') ?? '').split(',') : [];
const SHADOW_EVERY_OFF = !ENABLED.includes('lwshadow8');
const SHADOW_ONE = ENABLED.includes('lwshadow1');
const SHADOW_NONE = ENABLED.includes('lwnoshadow');
const BUDGET_CAP_OFF = !ENABLED.includes('lwbudget');
const FAST_SKIP_OFF = !ENABLED.includes('lwfast');
const EARLY = ENABLED.includes('lwearly');
const PHASE_OFF = DISABLED.includes('lwphase');

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
export const warmBudgetMs = (baseFrameMs: number, cap = BUDGET_CAP_OFF ? Infinity : WARM_CAP_MS): number =>
  Math.max(MIN_WARM_MS, Math.min(cap, LONG_TASK_MS - baseFrameMs));
/** Trần việc ấm mỗi khung (ms, đo bằng `performance.now`): khung ấm = khung thường + ≤ 10 ms, kể cả khi khung thường nhẹ. */
export const WARM_CAP_MS = 10;

/**
 * Bóng có cache: tầng ấm còn vật chờ thì ép vẽ lại MỌI shadow map (cả cảnh, mọi đèn đổ bóng) — nghi là phần lớn "phần vẽ
 * thường" 124–135 ms của khung ấm vòng 9. Chỉ ép ở khung ấm đầu của tầng và mỗi `SHADOW_EVERY` khung ấm sau đó.
 */
export const SHADOW_EVERY = 8;
/** Thuần: khung ấm thứ `n` (0 = đầu tiên của tầng) có ép vẽ lại bóng không. */
export const shadowDue = (n: number, every = SHADOW_EVERY_OFF ? 1 : SHADOW_EVERY): boolean => n % every === 0;

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
  // MỘT nghĩa (vòng 10): mẫu MỚI NHẤT chạm tầng còn vật chờ shader/pipeline thì chưa sẵn sàng, kể cả tầng đã ấm (cũ:
  // `warmed` thắng → `ready:true` cùng lúc `pendingDraws` 132 sau đổi nhanh: tầng đã ấm vẫn gặp khoá mới, ví dụ bộ đèn
  // khác khi tầng ấy thành tầng hiện, hoặc pipeline bất đồng bộ chưa xong). `warmed` chỉ thay số đo khi không có mẫu mới.
  if (l.touchedLastFrame && (l.pendingDraws ?? 0) > 0) return false;
  if (l.warmed) return true;
  return l.shown && l.touchedLastFrame && l.pendingDraws === 0 && !l.w2Busy;
}

/**
 * Số khung lấy mẫu LIÊN TIẾP mà số việc chờ (vật chờ shader/pipeline + việc W2/W1 + đồ GLB chưa nạp) không xuống dưới
 * mức thấp nhất đã thấy → coi phần ấy là KẸT (biên dịch hỏng, ảnh lỗi). Theo tiến triển, không theo đồng hồ: việc chậm
 * mà vẫn xong dần thì bộ đếm về 0 mỗi lần số chờ giảm, nên không bao giờ báo xong sớm. 600 khung ≈ 10 s vẽ liên tục ở
 * 60 fps — dài hơn nhiều một lần dựng pipeline chậm. Kẹt KHÔNG báo `ready`: chỉ ngừng nhường, ngừng tự vẽ lại (vòng vẽ
 * về nghỉ), tắt nhãn "đang chuẩn bị"; đầu dò ghi `stalled`. Số chờ giảm lại thì tự hết kẹt.
 */
export const STALL_FRAMES = 600;
/** Kẹt → tự thử lại (xoá theo dõi tiến triển, cho làm ấm/nhường lại) tối đa ngần này lần mỗi tầng mỗi cảnh; hết thì báo kẹt. */
export const MAX_STALL_RETRIES = 2;

/**
 * Vật KHÔNG THỂ vẽ (lát 2: tầng hiện kẹt `pendingDraws` 2 mãi, `ready:false`): số vật chờ của tầng hiện đứng yên qua
 * `UNDRAWABLE_SAMPLES` khung lấy mẫu liên tiếp trong khi W2/W1 không có việc nào và tầng không còn đồ GLB chờ → không gì
 * đang dựng chúng; coi số ấy là "không vẽ được" (pipeline hỏng, vật không bao giờ được khởi động dựng) và loại khỏi
 * "sẵn sàng". Số chờ đổi hoặc W2 có việc → theo dõi lại từ đầu. Đầu dò: `undrawable`.
 */
export const UNDRAWABLE_SAMPLES = 60;
export interface UndrawableTrack {
  n: number;
  samples: number;
}
/** Thuần: ghi một mẫu; trả số vật coi là không vẽ được (0 nếu chưa đủ bằng chứng). */
export function trackUndrawable(map: Map<string, UndrawableTrack>, id: string, pending: number, otherWork: number): number {
  const t = map.get(id);
  if (pending <= 0 || otherWork > 0 || !t || t.n !== pending) {
    if (pending > 0 && otherWork === 0) map.set(id, { n: pending, samples: 1 });
    else map.delete(id);
    return 0;
  }
  t.samples++;
  return t.samples >= UNDRAWABLE_SAMPLES ? t.n : 0;
}
const undrawableTrack = new Map<string, UndrawableTrack>();
const undrawableOf = (id: string): number => {
  const t = undrawableTrack.get(id);
  return t && t.samples >= UNDRAWABLE_SAMPLES ? t.n : 0;
};
export interface Progress {
  best: number;
  flat: number;
}
/** Thuần: ghi số việc chờ của một khung; `true` = đã kẹt (không giảm qua `STALL_FRAMES` khung). 0 việc = xoá theo dõi. */
export function trackProgress(map: Map<string, Progress>, key: string, work: number): boolean {
  const p = map.get(key);
  if (work <= 0) {
    map.delete(key);
    return false;
  }
  if (!p || work < p.best) {
    map.set(key, { best: work, flat: 0 });
    return false;
  }
  return ++p.flat >= STALL_FRAMES;
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
/**
 * Đo từng pha của khung ấm (ms) — tìm chỗ tốn thật. `objMs` = trong lời gọi vẽ (đã chặn) của vật tầng ấm, tách ra
 * `bindMs` (bindings: tải texture/buffer lên GPU), `texUploads` (lần `updateTexture`), `pipeMs` (W1 tạo pipeline); phần
 * còn lại của `objMs` ≈ dựng node/TSL đồng bộ (W2 `startBuild`). `wrapMs` = toàn bộ thời gian trong bộ bọc cho vật tầng ấm
 * (gồm `objMs` + tra render object/khoá shader, kể cả vật bị dời). `prepMs` = duyệt tầng ấm + đánh dấu bóng. `restMs` =
 * phần còn lại của `draw()`: vẽ thường + chiếu/sắp xếp tầng ấm + lượt bóng ép vẽ lại.
 */
export interface WarmPhases {
  totalMs: number;
  prepMs: number;
  restMs: number;
  wrapMs: number;
  objMs: number;
  bindMs: number;
  pipeMs: number;
  texUploads: number;
  calls: number;
  objects: number;
  keysStarted: number;
  pipelinesStarted: number;
  shadowForced: boolean;
  /** Số đèn bóng bị ép vẽ lại ở khung này. */
  shadowLights: number;
  budgetMs: number;
}
const zeroPhases = (): WarmPhases => ({ totalMs: 0, prepMs: 0, restMs: 0, wrapMs: 0, objMs: 0, bindMs: 0, pipeMs: 0, texUploads: 0, calls: 0, objects: 0, keysStarted: 0, pipelinesStarted: 0, shadowForced: false, shadowLights: 0, budgetMs: 0 });
let phase = zeroPhases();
const roundPhases = (p: WarmPhases): WarmPhases =>
  Object.fromEntries(Object.entries(p).map(([k, v]) => [k, typeof v === 'number' ? Math.round(v * 10) / 10 : v])) as unknown as WarmPhases;
const phaseStats = {
  last: zeroPhases(),
  /** Pha của khung ấm dài nhất. */
  worst: zeroPhases(),
  /** Khung ấm dài nhất có / không ép vẽ lại bóng — tách phần bóng. */
  maxShadowFrameMs: 0,
  maxNoShadowFrameMs: 0,
  shadowFrames: 0,
  /** Khung sống KHÔNG ấm: `draw()` trung bình trượt / dài nhất — mức sàn của khung ấm. */
  normalFrameMs: 0,
  maxNormalFrameMs: 0,
  /** Vật tầng ấm bị dời khi đã hết ngân sách mà không tra khoá (đường nhanh). */
  fastSkips: 0,
  /** Vật tầng ấm đã sẵn sàng nên không gọi vẽ trong khung ấm. */
  readySkips: 0,
  stallRetries: 0,
};
/** Trong lời gọi vẽ của một vật tầng ấm (bộ đo bind/pipeline/texture chỉ ghi lúc này). */
let inWarmObj = false;
/**
 * Đường lạnh: đo MỌI khung sống không ấm (bấm tầng chưa ấm → W2 dựng khi cần). Pha: `w2BuildMs` (đoạn dựng node đồng bộ
 * W2 trong khung — `warmStats().frameBuildMs`), `bindMs`/`pipeMs`/`geomMs` (bindings, pipeline, buffer hình), `texUploads` +
 * `texMs` (tải texture lên GPU), `shadowObjMs` (lời gọi vẽ của vật liệu lượt bóng), `objMs` (mọi lời gọi vẽ vật), `slowest`
 * (lời gọi vật chậm nhất: loại + tên vật liệu, lượt bóng?). `longTasks`/`slowDraws`: tác vụ dài (PerformanceObserver) và
 * khung vẽ > 50 ms kể từ lần chọn tầng — so hai danh sách để biết tác vụ dài nằm trong hay ngoài lệnh vẽ.
 */
interface ColdFrame {
  drawMs: number;
  w2BuildMs: number;
  buildsStarted: number;
  pipelinesStarted: number;
  bindMs: number;
  pipeMs: number;
  geomMs: number;
  texUploads: number;
  texMs: number;
  shadowObjMs: number;
  objMs: number;
  calls: number;
  slowest: { ms: number; type: string; name: string; shadow: boolean };
}
const zeroCold = (): ColdFrame => ({ drawMs: 0, w2BuildMs: 0, buildsStarted: 0, pipelinesStarted: 0, bindMs: 0, pipeMs: 0, geomMs: 0, texUploads: 0, texMs: 0, shadowObjMs: 0, objMs: 0, calls: 0, slowest: { ms: 0, type: '', name: '', shadow: false } });
let cold = zeroCold();
let inCold = false;
const coldStats = { since: 0, frames: 0, over50: 0, worst: zeroCold(), longTasks: [] as number[], slowDraws: [] as number[] };
function resetCold(now: number): void {
  Object.assign(coldStats, { since: Math.round(now), frames: 0, over50: 0, worst: zeroCold(), longTasks: [], slowDraws: [] });
}
let longObs = false;
function observeLongTasks(): void {
  if (longObs || typeof PerformanceObserver === 'undefined') return;
  longObs = true;
  try {
    new PerformanceObserver((l) => {
      for (const e of l.getEntries()) if (coldStats.longTasks.length < 40) coldStats.longTasks.push(Math.round(e.duration));
    }).observe({ type: 'longtask' });
  } catch {
    /* trình duyệt không có longtask */
  }
}
const r1 = (v: number): number => Math.round(v * 10) / 10;
function coldSnapshot() {
  const w = coldStats.worst;
  const round = Object.fromEntries(Object.entries(w).map(([k, v]) => [k, typeof v === 'number' ? r1(v) : v]));
  return { ...coldStats, worst: { ...round, slowest: { ...w.slowest, ms: r1(w.slowest.ms) } }, longTasks: [...coldStats.longTasks], slowDraws: [...coldStats.slowDraws] };
}
/** Khung ấm có vật bị dời không tra khoá → không được kết luận "xong" ở khung đó. */
let uncounted = false;
const stallRetries = new Map<string, number>();
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
  /** Phần vẽ thường (không tính việc ấm) của khung ấm dài nhất — tách nguyên nhân khung ấm dài: base hay việc ấm. */
  maxBaseMs: 0,
  /** Khung không ấm vì tầng đang hiện còn vật chờ (nhường tầng người dùng vừa chọn). */
  yieldFrames: 0,
  /** Vật chưa dựng bị dời sang khung sau vì thời gian dựng trung bình (`avgColdMs`) sẽ vượt ngân sách còn lại. */
  predictSkips: 0,
  /** Trung bình trượt thời gian một vật CHƯA dựng trong khung ấm (W2 khởi động bản dựng đồng bộ trong lời gọi). */
  avgColdMs: 0,
};
/** Đo đổi tầng (bộ chọn tầng → `useLevelPreparing`): chọn lúc nào, sẵn sàng lúc nào. */
const switchStats = { levelId: null as string | null, selectedAt: 0, readyAt: null as number | null, lastWaitMs: null as number | null, maxWaitMs: 0, count: 0, waited: 0 };
const frameListeners = new Set<() => void>();
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
const firstBudget = (): number => (BUDGET_CAP_OFF ? LONG_TASK_MS : WARM_CAP_MS);
let budgetMs = firstBudget();
/** Đèn bóng kế tiếp được ép ở chế độ `lwshadow1`. */
let shadowTurn = 0;
let warmSpent = 0;
let shadowsPending = true;
/** Số khung ấm đã chạy cho tầng `current` (nhịp ép bóng `shadowDue`). */
let levelWarmFrames = 0;
/** `levelReadiness()` vừa được hỏi → khung kế tiếp đếm vật chờ của mọi tầng (ngoài ra chỉ đếm trong khung ấm). */
let wantSample = false;
let sampling = false;
let lastSampleFrame = -1;
/** Theo dõi tiến triển (`trackProgress`): khoá = id tầng đang hiện, `warm:<id>` tầng đang ấm, `#w2` hàng việc W2/W1. */
const progress = new Map<string, Progress>();
/** Tầng đang hiện kẹt (số chờ không giảm) / tầng ẩn bỏ làm ấm vì kẹt — không tính là sẵn sàng hay đã ấm. */
const stalledShown = new Set<string>();
const stalledWarm = new Set<string>();
let w2Stalled = false;

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
    progress.clear();
    stalledShown.clear();
    stalledWarm.clear();
    stallRetries.clear();
    undrawableTrack.clear();
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

const w2Work = (): number => {
  const w = warmStats();
  return w.pending + w.buildsPending + w.texWaiting;
};
const w2Busy = (): boolean => w2Work() > 0;

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
  const pick = nextWarmLevel(levelInfos(), new Set([...state.warmed, ...stalledWarm]), {
    tier: currentTier(),
    off: URL_OFF,
    // `lwearly`: lần nạp đầu không chặn nếu W2/W1 rảnh (điều kiện `busy` bên dưới vẫn giữ: không giành việc của tầng hiện).
    firstLoad: EARLY ? false : isFirstLoad(),
    // Hàng việc W2/W1 kẹt (ví dụ một ảnh lỗi không bao giờ tải) không chặn làm ấm tầng ẩn mãi.
    busy: w2Busy() && !w2Stalled,
    interacting: interacting(),
  });
  if ('reason' in pick) return void stats.reject[pick.reason]++;
  state.current = pick.id;
  stats.levelsStarted++;
  shadowsPending = true;
  levelWarmFrames = 0;
  budgetMs = firstBudget();
  markDirty('level-warm');
}

/** Bọc lệnh vẽ trong `liveFrame` (vendor `post-processing.tsx`). Mọi thay đổi tạm lên cảnh nằm trong try/finally. */
export function levelWarmFrame(scene: unknown, draw: () => void): void {
  stats.frameCalls++;
  refreshRoots(scene);
  w2Stalled = trackProgress(progress, '#w2', w2Work());
  const root = state.current ? ([...rootIds].find(([, id]) => id === state.current)?.[0] ?? null) : null;
  if (state.current && (!root || root.visible)) {
    // Tầng mất (cảnh đổi) hoặc người dùng vừa chọn nó: W2 lo phần còn lại.
    state.current = null;
    stats.cancelled++;
  }
  const paused = root !== null && state.current !== null && interacting();
  if (paused) stats.pausedFrames++; // tầng vẫn là `current`; khung sau hết thao tác ấm tiếp
  // Tầng đang hiện còn vật chờ (người dùng vừa chọn tầng chưa ấm) → nhường W2/W1 cho nó; vẫn lấy mẫu để biết lúc xong.
  const yieldShown = root !== null && state.current !== null && !paused && [...rootIds].some(([o, id]) => o.visible && (lastPending.get(id) ?? 0) - undrawableOf(id) > 0 && !stalledShown.has(id));
  if (yieldShown) stats.yieldFrames++;
  const warm = root && state.current && !paused && !yieldShown ? root : null;
  sampling = wantSample || state.current !== null;
  wantSample = false;
  framePending.clear();
  const culled: Obj[] = [];
  const lights: Obj[] = [];
  let t0 = 0;
  const tp = performance.now();
  let shadowForced = false;
  if (warm) {
    phase = zeroPhases();
    uncounted = false;
  }
  const ws0 = warmStats();
  const pipes0 = ws0.started ?? 0;
  const builds0 = ws0.builds ?? 0;
  inCold = !warm && !PHASE_OFF;
  coldFrameActive = inCold;
  if (inCold) cold = zeroCold();
  try {
    if (warm) {
      warmRoot = warm;
      warm.visible = true;
      warm.traverse?.((o) => {
        if (o.isLight && o.visible) (o.visible = false), lights.push(o);
        else if (o.frustumCulled) (o.frustumCulled = false), culled.push(o);
      });
      // Bóng có cache (shadow-cache.ts): khi tầng ấm còn vật chưa sẵn sàng, ép vẽ lại map để lượt bóng cũng dựng.
      if (shadowsPending && !SHADOW_NONE && shadowDue(levelWarmFrames)) {
        shadowForced = true;
        const casters: Obj[] = [];
        (scene as Obj).traverse?.((o) => {
          if (o.isLight && o.castShadow && o.shadow) casters.push(o);
        });
        const pick = SHADOW_ONE && casters.length ? [casters[shadowTurn++ % casters.length]!] : casters;
        for (const o of pick) o.shadow!.needsUpdate = true;
        phase.shadowLights = pick.length;
      }
      stats.lastBudgetMs = budgetMs;
    }
    // Tầng đang hiện mà khung này không vẽ vật nào của nó (tầng rỗng, mọi vật ngoài khung nhìn) = 0 vật chờ.
    if (sampling) for (const [o, id] of rootIds) if (o.visible) framePending.set(id, 0);
    warmSpent = 0;
    frameScene = scene;
    t0 = performance.now();
    if (warm) phase.prepMs = t0 - tp;
    draw();
  } finally {
    inCold = false;
    coldFrameActive = false;
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
    const items = unsettledItems();
    const w2 = w2Work();
    for (const [o, id] of rootIds) {
      if (!o.visible || !framePending.has(id)) continue;
      const und = trackUndrawable(undrawableTrack, id, framePending.get(id) ?? 0, w2 + (items.get(id) ?? 0));
      const work = Math.max(0, (framePending.get(id) ?? 0) - und) + w2 + (items.get(id) ?? 0);
      // Tầng đang hiện đã sẵn sàng trọn một lần = coi như đã ấm (như tầng ấm xong): quay lại không báo chờ nhầm.
      if (work === 0) state.warmed.add(id);
      if (trackProgress(progress, id, work)) stalledShown.add(id);
      else stalledShown.delete(id);
    }
  }
  sampling = false;
  const total = performance.now() - t0;
  if (warm) {
    Object.assign(phase, { totalMs: phase.prepMs + total, restMs: total - phase.wrapMs, shadowForced, budgetMs, pipelinesStarted: (warmStats().started ?? 0) - (pipes0 ?? 0) });
    levelWarmFrames++;
    finishWarmFrame(total);
  } else if (!PHASE_OFF) {
    phaseStats.normalFrameMs = phaseStats.normalFrameMs === 0 ? total : phaseStats.normalFrameMs + (total - phaseStats.normalFrameMs) * 0.1;
    phaseStats.maxNormalFrameMs = Math.max(phaseStats.maxNormalFrameMs, Math.round(total));
    const ws = warmStats();
    Object.assign(cold, { drawMs: total, w2BuildMs: ws.frameBuildMs ?? 0, buildsStarted: (ws.builds ?? 0) - builds0, pipelinesStarted: (ws.started ?? 0) - pipes0 });
    coldStats.frames++;
    if (total > LONG_TASK_MS) {
      coldStats.over50++;
      if (coldStats.slowDraws.length < 40) coldStats.slowDraws.push(Math.round(total));
    }
    if (total >= coldStats.worst.drawMs) coldStats.worst = cold;
  }
  for (const f of [...frameListeners]) f();
}

function finishWarmFrame(total: number): void {
  stats.warmFrames++;
  stats.lastWarmMs = Math.round(warmSpent);
  stats.lastBaseMs = Math.round(total - warmSpent);
  if (Math.round(total) > stats.maxWarmFrameMs) {
    stats.maxWarmFrameMs = Math.round(total);
    stats.maxBaseMs = stats.lastBaseMs;
  }
  budgetMs = warmBudgetMs(total - warmSpent);
  if (!PHASE_OFF) {
    phaseStats.last = roundPhases(phase);
    if (phase.totalMs >= phaseStats.worst.totalMs) phaseStats.worst = phaseStats.last;
    if (phase.shadowForced) {
      phaseStats.shadowFrames++;
      phaseStats.maxShadowFrameMs = Math.max(phaseStats.maxShadowFrameMs, Math.round(phase.totalMs));
    } else phaseStats.maxNoShadowFrameMs = Math.max(phaseStats.maxNoShadowFrameMs, Math.round(phase.totalMs));
  }
  const id = state.current!;
  // Khung có vật bị dời mà không tra khoá: số chờ thiếu → ít nhất 1, không kết luận xong ở khung này.
  const pending = Math.max(framePending.get(id) ?? 0, uncounted ? 1 : 0);
  shadowsPending = pending > 0;
  const work = pending + w2Work() + (unsettledItems().get(id) ?? 0);
  const stuck = trackProgress(progress, `warm:${id}`, work);
  if (work === 0) {
    state.warmed.add(id);
    state.current = null;
  } else if (stuck) {
    // Kẹt: bỏ tầng này (không ghi là đã ấm), thôi tự vẽ lại; tầng ẩn khác vẫn được làm ấm.
    progress.delete(`warm:${id}`);
    stalledWarm.add(id);
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
  _bindings?: object;
  _textures?: object;
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
    if (inCold) return coldCall(this, args, material);
    if (!sampling || frameScene === null || scene !== frameScene) return inner.apply(this, args);
    const tw = performance.now();
    const root = levelRootOf(object as Obj);
    const id = root ? rootIds.get(root) : undefined;
    if (id === undefined) return inner.apply(this, args);
    if (root === warmRoot) phase.calls++;
    // Đường nhanh: hết ngân sách → vật tầng ấm dời luôn, không tra render object/khoá (tầng ấm có hàng nghìn lời gọi
    // mỗi khung qua các lượt bóng; tra khoá từng cái là chi phí nằm NGOÀI ngân sách ở bản cũ).
    if (root === warmRoot && !FAST_SKIP_OFF && warmSpent >= budgetMs) {
      uncounted = true;
      phaseStats.fastSkips++;
      stats.budgetSkips++;
      phase.wrapMs += performance.now() - tw;
      return;
    }
    const ro = objects.get(object, material, scene, camera, lightsNode, r._currentRenderContext, clippingContext, passId);
    const key = nodes.getForRenderCacheKey(ro);
    const built = nodes.get(ro).nodeBuilderState !== undefined || nodes.nodeBuilderCache.has(key);
    const ready = built && pipelines.isReady(ro);
    framePending.set(id, (framePending.get(id) ?? 0) + (ready ? 0 : 1));
    if (root !== warmRoot) return inner.apply(this, args);
    // Vật đã có shader + pipeline (nên đã có bindings/texture GPU): làm ấm không còn gì để dựng → khỏi gọi vẽ, không tốn
    // ngân sách. Nhờ vậy khi tầng gần xong, ngân sách không bị vật xong ăn hết, khung đếm đủ và tầng kết luận xong được.
    // Lưới gộp chưa `drawReady` vẫn gọi (W2 gắn cờ khi gọi vẽ được — `markDrawReady`).
    const ob = object as { isBatchedMesh?: boolean; userData?: Record<string, unknown> };
    if (ready && !FAST_SKIP_OFF && !(ob.isBatchedMesh && ob.userData?.drawReady !== true)) {
      phaseStats.readySkips++;
      phase.wrapMs += performance.now() - tw;
      return;
    }
    try {
      warmObject(this, args, built, key, id);
    } finally {
      phase.wrapMs += performance.now() - tw;
    }
  };
  const own = r._renderObjectDirect;
  /** Khung lạnh: đo từng lời gọi vẽ vật (vẫn đi đường lấy mẫu nếu khung này lấy mẫu). */
  function coldCall(self: RendererLike, args: unknown[], material: unknown): void {
    inCold = false; // lời gọi lồng (lấy mẫu) không đo lại
    const t = performance.now();
    try {
      own.apply(self, args);
    } finally {
      inCold = true;
      const ms = performance.now() - t;
      const m = material as { type?: string; name?: string; isShadowPassMaterial?: boolean } | null;
      cold.objMs += ms;
      cold.calls++;
      if (m?.isShadowPassMaterial) cold.shadowObjMs += ms;
      if (ms > cold.slowest.ms) cold.slowest = { ms, type: m?.type ?? '', name: m?.name ?? '', shadow: m?.isShadowPassMaterial === true };
    }
  }
  function warmObject(self: RendererLike, args: unknown[], built: boolean, key: string, id: string): void {
    if (!built) {
      let need = keysNeeded.get(id);
      if (!need) keysNeeded.set(id, (need = new Set()));
      need.add(key);
    }
    if (warmSpent >= budgetMs) return void stats.budgetSkips++;
    // Ngân sách chỉ kiểm GIỮA các vật: vật chưa dựng dự kiến vượt phần còn lại → để khung sau (vật đầu khung luôn được làm).
    if (!built && warmSpent > 0 && warmSpent + stats.avgColdMs > budgetMs) return void stats.predictSkips++;
    if (!built) {
      stats.keysStarted++;
      phase.keysStarted++;
    }
    stats.warmObjects++;
    phase.objects++;
    const b = backend!;
    const draw = b.draw;
    b.draw = noop;
    const t = performance.now();
    inWarmObj = !PHASE_OFF;
    try {
      inner.apply(self, args);
    } finally {
      inWarmObj = false;
      b.draw = draw;
      const spent = performance.now() - t;
      warmSpent += spent;
      phase.objMs += spent;
      if (spent > stats.maxObjectMs) stats.maxObjectMs = Math.round(spent);
      if (!built) stats.avgColdMs = stats.avgColdMs === 0 ? spent : stats.avgColdMs + (spent - stats.avgColdMs) * 0.2;
    }
  }
  // Bộ đo pha: ghi khi đang trong lời gọi vẽ của vật tầng ấm (`inWarmObj`) hoặc trong khung lạnh; ngoài đó gọi thẳng.
  const timed = (host: object | undefined, name: string, into: 'bind' | 'pipe' | 'tex' | 'geom'): void => {
    const h = host as Record<string, unknown> | undefined;
    const f = h?.[name];
    if (!h || typeof f !== 'function') return;
    h[name] = function (this: unknown, ...a: unknown[]): unknown {
      if (!inWarmObj && !coldOn()) return f.apply(this, a);
      const t = performance.now();
      try {
        return f.apply(this, a);
      } finally {
        const ms = performance.now() - t;
        if (inWarmObj) {
          if (into === 'tex') phase.texUploads++;
          else if (into === 'bind') phase.bindMs += ms;
          else if (into === 'pipe') phase.pipeMs += ms;
        } else if (into === 'tex') (cold.texUploads++, (cold.texMs += ms));
        else cold[`${into}Ms`] += ms;
      }
    };
  };
  timed(r._bindings, 'updateForRender', 'bind');
  timed(pipelines, 'updateForRender', 'pipe');
  timed(r._textures, 'updateTexture', 'tex');
  timed((r as { _geometries?: object })._geometries, 'updateForRender', 'geom');
  observeLongTasks();
}
/** Đang trong lệnh vẽ của khung lạnh (kể cả trong lời gọi vật, nơi `inCold` tạm tắt). */
let coldFrameActive = false;
const coldOn = (): boolean => coldFrameActive;

/**
 * Tầng kẹt → thử lại: xoá theo dõi tiến triển + cờ kẹt của tầng (tầng ẩn được chọn làm ấm lại, tầng hiện được nhường lại),
 * tối đa `MAX_STALL_RETRIES` lần mỗi tầng mỗi cảnh. `false` = hết lượt (UI báo kẹt; chuyển tầng theo đường thường: W2 dựng
 * khi vật được vẽ).
 */
export function retryStalled(levelId: string): boolean {
  const n = stallRetries.get(levelId) ?? 0;
  if (n >= MAX_STALL_RETRIES) return false;
  stallRetries.set(levelId, n + 1);
  phaseStats.stallRetries++;
  progress.delete(levelId);
  progress.delete(`warm:${levelId}`);
  stalledShown.delete(levelId);
  stalledWarm.delete(levelId);
  markDirty('level-retry');
  return true;
}

export interface LevelReadiness {
  levelId: string;
  shown: boolean;
  /** Đồ GLB của tầng chưa nạp xong. */
  pendingAssets: number;
  /** Vật chưa có shader/pipeline ở khung lấy mẫu gần nhất chạm tầng; `null` = chưa từng lấy mẫu tầng này. */
  pendingDraws: number | null;
  /** Trong `pendingDraws`: vật không thể vẽ (`trackUndrawable`), không tính vào `compiled`/`ready`. */
  undrawable: number;
  /** `pendingDraws` lấy ở khung lấy mẫu MỚI NHẤT (không phải số cũ của lần chạm trước). */
  fresh: boolean;
  /** Mọi vật của tầng có shader + pipeline ở mẫu mới nhất (`fresh && pendingDraws === 0`), hoặc đã ấm và chưa có mẫu mới. */
  compiled: boolean;
  warmed: boolean;
  /** = không còn đồ GLB chờ VÀ `compiled` (tầng chưa ấm thêm: W2/W1 hết việc). Nhãn UI và đầu dò dùng đúng trường này. */
  ready: boolean;
  /** Số việc chờ không giảm qua `STALL_FRAMES` khung (biên dịch hỏng/ảnh lỗi): không sẵn sàng, nhưng thôi chờ. */
  stalled: boolean;
}

/** Cho đầu dò/E2E: tầng nào còn đang nạp. */
export function levelReadiness(opts: { passive?: boolean } = {}): LevelReadiness[] {
  // Số đếm vật chờ lấy ở khung có lấy mẫu gần nhất; hỏi lần này thì khung kế lấy mẫu (bài kiểm hỏi lặp).
  // Tầng đang hiện đều kẹt thì chỉ lấy mẫu ở khung tự có, không ép vẽ lại (vòng vẽ không chạy mãi vì một vật hỏng).
  // `passive`: chỉ đọc số đã có (nhãn theo dõi tiếp sau khi sẵn sàng mà không giữ vòng vẽ chạy).
  if (!opts.passive) {
    if (!wantSample && [...rootIds].some(([o, id]) => o.visible && !stalledShown.has(id))) markDirty('level-readiness');
    wantSample = true;
  }
  const items = unsettledItems();
  const busy = w2Busy();
  return [...rootIds].map(([o, levelId]) => {
    const pendingAssets = items.get(levelId) ?? 0;
    const pendingDraws = lastPending.get(levelId) ?? null;
    const warmed = state.warmed.has(levelId);
    const touchedLastFrame = lastTouch.get(levelId) === lastSampleFrame;
    const undrawable = o.visible ? undrawableOf(levelId) : 0;
    // "Sẵn sàng" tính trên vật VẼ ĐƯỢC: trừ vật không thể vẽ.
    const drawable = pendingDraws === null ? null : Math.max(0, pendingDraws - undrawable);
    const ready = isLevelReady({ pendingAssets, warmed, shown: o.visible, touchedLastFrame, pendingDraws: drawable, w2Busy: busy });
    const stalled = !ready && (stalledShown.has(levelId) || stalledWarm.has(levelId));
    const compiled = touchedLastFrame ? drawable === 0 : warmed;
    return { levelId, shown: o.visible, pendingAssets, pendingDraws, undrawable, fresh: touchedLastFrame, compiled, warmed, ready, stalled };
  });
}

/** Sau mỗi khung sống đã lấy mẫu (`levelWarmFrame`) — tín hiệu thật cho UI hỏi lại `levelReadiness()`. */
export function onLevelWarmFrame(f: () => void): () => void {
  frameListeners.add(f);
  return () => void frameListeners.delete(f);
}

/** Luật w3 đã áp và khung sống đang chạy qua `levelWarmFrame` (không thì không có tín hiệu để báo xong). */
export const levelWarmActive = (): boolean => stats.frameCalls > 0;

export function noteLevelSelected(levelId: string, now = performance.now()): void {
  resetCold(now);
  Object.assign(switchStats, { levelId, selectedAt: now, readyAt: null, lastWaitMs: null, count: switchStats.count + 1 });
}

/** Tầng vừa chọn báo sẵn sàng (chỉ lần đầu sau `noteLevelSelected` của đúng tầng ấy). */
export function noteLevelReady(levelId: string, now = performance.now()): void {
  if (switchStats.levelId !== levelId || switchStats.readyAt !== null) return;
  switchStats.readyAt = now;
  switchStats.lastWaitMs = Math.round(now - switchStats.selectedAt);
  if (switchStats.lastWaitMs > 0) switchStats.waited++;
  switchStats.maxWaitMs = Math.max(switchStats.maxWaitMs, switchStats.lastWaitMs);
}

/** Bộ đếm chẩn đoán (đầu dò `levelWarmStats()`). */
export function levelWarmStats() {
  const remaining = rootIds.size ? levelInfos().filter((l) => !l.shown && !l.userHidden && !state.warmed.has(l.id) && !stalledWarm.has(l.id)).length : 0;
  return {
    ...stats,
    remaining,
    switch: { ...switchStats },
    reject: { ...stats.reject },
    off: URL_OFF,
    current: state.current,
    warmed: [...state.warmed],
    /** Tầng ẩn bỏ làm ấm vì kẹt / tầng đang hiện kẹt / hàng việc W2-W1 kẹt. */
    stalled: [...stalledWarm],
    stalledShown: [...stalledShown],
    w2Stalled,
    keysNeeded: Object.fromEntries([...keysNeeded].map(([id, s]) => [id, s.size])),
    /** Pha từng khung ấm (`WarmPhases`): `phases.last`, `phases.worst`, khung có/không ép bóng, khung thường. */
    phases: { ...phaseStats, normalFrameMs: Math.round(phaseStats.normalFrameMs * 10) / 10 },
    flags: { shadow8: !SHADOW_EVERY_OFF, shadow1: SHADOW_ONE, noShadow: SHADOW_NONE, budgetCap: !BUDGET_CAP_OFF, fastSkip: !FAST_SKIP_OFF, early: EARLY, phase: !PHASE_OFF, setupBudget: warmStats().setupBudget ?? false },
    /** Đường lạnh (khung sống KHÔNG ấm) từ lần chọn tầng gần nhất: khung vẽ tệ nhất tách pha. */
    cold: coldSnapshot(),
  };
}

(globalThis as { __realismLevelWarm?: object }).__realismLevelWarm = { levelReadiness, levelWarmStats };
