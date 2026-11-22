// Chạy trước mọi script của trang (addInitScript). Chỉ đo, không đổi hành vi sản phẩm.
// window.__ix: bộ đếm cho một "cửa sổ đo" (mark() → collect()).
(() => {
  const now = () => performance.now();
  const ix = {
    // Bật sẵn từ lúc nạp trang để bắt cả measure lúc tải (mark() chỉ xoá mảng và đặt mốc).
    on: true, t0: 0,
    moves: [],        // pointermove: { ts, cap, bub, raf, done, coalesced, x, y }
    downs: [],        // pointerdown/up/keydown: { type, ts, cap, bub, done }
    frames: [],       // mỗi rAF: { t, dt }
    renders: [],      // mỗi renderer.render: { t, ms, track }
    loaf: [], longtasks: [],
    commits: [],      // React commit: { t, rendered, top }
    req: [],          // fetch/XHR khởi phát trong cửa sổ đo
    timers: [],       // callback setTimeout > 25 ms
    measures: [],     // performance.measure của ?perf (wall-rebuild, wall-csg, frame-cpu, ...)
    track: null,      // { id, obj } — Object3D đang theo dõi vị trí
    cam: null,        // camera của lượt render gần nhất
    renderer: null, scene: null,
  };
  window.__ix = ix;

  // ---- three: bắt renderer + scene qua móc devtools của three ----
  const hook = new EventTarget();
  hook.addEventListener('observe', (e) => {
    const d = e.detail;
    if (d?.isScene) { if (!ix.scene) ix.scene = d; }
    else if (d?.info && d?.render && !d.__ixWrapped) wrapRenderer(d);
  });
  window.__THREE_DEVTOOLS__ = hook;
  let depth = 0;
  function wrapRenderer(r) {
    r.__ixWrapped = true; ix.renderer = r;
    for (const name of ['render', 'renderAsync']) {
      const orig = r[name]; if (typeof orig !== 'function') continue;
      r[name] = function (scene, camera, ...rest) {
        // Camera chính = camera của lượt vẽ scene chính (nhiều con), không phải quad hậu kỳ.
        if (camera?.isCamera && (scene?.children?.length ?? 0) > 3) { const cv = r.domElement; const asp = cv ? cv.clientWidth / Math.max(1, cv.clientHeight) : 0; const ok = camera.isOrthographicCamera ? camera.parent?.type !== 'CubeCamera' && !camera.userData?.shadow : Math.abs((camera.aspect ?? 0) - asp) < 0.02 && camera.parent?.type !== 'CubeCamera'; if (ok) { ix.cam = camera; ix.mainScene = scene; } }
        if (!ix.on || depth > 0) { depth += 1; try { return orig.call(this, scene, camera, ...rest); } finally { depth -= 1; } }
        const t = now(); depth += 1; let out;
        try { out = orig.call(this, scene, camera, ...rest); } finally { depth -= 1; }
        let tr = null;
        if (ix.track?.obj) { const p = ix.track.obj.getWorldPosition(new ix.track.V()); tr = [p.x, p.y, p.z]; }
        ix.renders.push({ t, ms: now() - t, main: scene === ix.mainScene ? 1 : 0, track: tr });
        return out;
      };
    }
  }

  // ---- React: móc devtools giả để đếm commit và số fiber đã render (cờ PerformedWork = 1) ----
  let rid = 0;
  window.__REACT_DEVTOOLS_GLOBAL_HOOK__ = {
    isDisabled: false, supportsFiber: true, renderers: new Map(),
    inject(r) { rid += 1; this.renderers.set(rid, r); return rid; },
    onScheduleFiberRoot() {}, onCommitFiberUnmount() {}, onPostCommitFiberRoot() {}, checkDCE() {},
    onCommitFiberRoot(_id, root) {
      if (!ix.on) return;
      const t0 = now(); let rendered = 0; const names = {};
      // Duyệt cây đã commit; chỉ đếm fiber có PerformedWork trong lượt này.
      const nameOf = (f) => { const ty = f.type; return typeof ty === 'function' ? (ty.displayName || ty.name || 'anon') : (typeof ty === 'object' && ty ? (ty.displayName || ty.render?.displayName || ty.render?.name || ty.type?.displayName || ty.type?.name || 'memo') : null); };
      // Gốc render = fiber đã render mà fiber cha (gần nhất có tên) không render: chỗ state/props thực sự đổi.
      const roots = {};
      const stack = [[root.current, false]]; let guard = 0;
      while (stack.length && guard++ < 300000) {
        const [f, parentWorked] = stack.pop();
        const worked = (f.flags & 1) === 1 && typeof f.type !== 'string' && (f.alternate === null || f.memoizedProps !== f.alternate.memoizedProps || f.memoizedState !== f.alternate.memoizedState || f.alternate.child !== f.child || true);
        if (worked) {
          rendered += 1; const n = nameOf(f); if (n) names[n] = (names[n] || 0) + 1;
          if (!parentWorked) { let a = f, path = []; for (let i = 0; i < 3 && a; a = a.return) { const nn = a.type && nameOf(a); if (nn) { path.push(nn); i++; } } const k = path.join('<'); roots[k] = (roots[k] || 0) + 1; }
        }
        if (f.sibling) stack.push([f.sibling, parentWorked]);
        // Như React DevTools: cây con chỉ được dựng lại khi con của fiber đổi so với bản cũ;
        // cây con giữ nguyên còn mang cờ PerformedWork CŨ của lượt trước → không duyệt.
        const alt = f.alternate;
        if (f.child && (alt === null || f.child !== alt.child)) stack.push([f.child, worked || (parentWorked && typeof f.type === 'string')]);
      }
      const top = Object.entries(names).sort((a, b) => b[1] - a[1]).slice(0, 12);
      ix.commits.push({ t: t0, rendered, top, roots: Object.entries(roots), walkMs: now() - t0 });
    },
  };

  // ---- Input: capture (đầu tiên) / bubble trên window / MessageChannel (hết tác vụ) ----
  const mc = new MessageChannel(); const pending = [];
  mc.port1.onmessage = () => { const rec = pending.shift(); if (rec) rec.done = now(); };
  let rafWaiters = [];
  window.addEventListener('pointermove', (e) => {
    if (!ix.on) return;
    const rec = { ts: e.timeStamp, cap: now(), bub: null, raf: null, done: null, coalesced: e.getCoalescedEvents ? e.getCoalescedEvents().length : 1, x: e.clientX, y: e.clientY, buttons: e.buttons };
    ix.moves.push(rec); rafWaiters.push(rec); pending.push(rec); mc.port2.postMessage(0);
  }, { capture: true });
  window.addEventListener('pointermove', () => { if (ix.on) { const r = ix.moves.at(-1); if (r) r.bub = now(); } });
  for (const type of ['pointerdown', 'pointerup', 'keydown', 'click', 'wheel']) {
    window.addEventListener(type, (e) => {
      if (!ix.on) return;
      const rec = { type, ts: e.timeStamp, cap: now(), bub: null, done: null, raf: null, key: e.key };
      ix.downs.push(rec); rafWaiters.push(rec); pending.push(rec); mc.port2.postMessage(0);
    }, { capture: true, passive: true });
    window.addEventListener(type, () => { if (ix.on) { const r = ix.downs.at(-1); if (r) r.bub = now(); } }, { passive: true });
  }
  let last = now();
  const tick = (t) => {
    if (ix.on) { ix.frames.push({ t, dt: t - last }); for (const r of rafWaiters) r.raf = t; rafWaiters = []; }
    last = t; requestAnimationFrame(tick);
  };
  requestAnimationFrame(tick);

  // ---- LoAF + long task ----
  try {
    new PerformanceObserver((l) => { if (!ix.on) return; for (const e of l.getEntries()) ix.loaf.push({
      start: e.startTime, dur: e.duration, block: e.blockingDuration, render: e.renderStart ? e.duration - (e.renderStart - e.startTime) : null,
      styleLayout: e.styleAndLayoutStart ? e.startTime + e.duration - e.styleAndLayoutStart : null,
      scripts: (e.scripts || []).map((s) => ({ inv: s.invoker, type: s.invokerType, fn: s.sourceFunctionName, url: (s.sourceURL || '').split('/').pop(), pos: s.sourceCharPosition, dur: Math.round(s.duration), fsl: Math.round(s.forcedStyleAndLayoutDuration || 0) })),
    }); }).observe({ type: 'long-animation-frame', buffered: false });
  } catch {}
  try { new PerformanceObserver((l) => { if (ix.on) for (const e of l.getEntries()) ix.measures.push({ n: e.name, d: e.duration, t: e.startTime }); }).observe({ entryTypes: ['measure'] }); } catch {}
  try { new PerformanceObserver((l) => { if (ix.on) for (const e of l.getEntries()) ix.longtasks.push({ start: e.startTime, dur: e.duration }); }).observe({ type: 'longtask' }); } catch {}

  // ---- Mạng: đếm fetch/XHR theo method + đường dẫn ----
  const of = window.fetch;
  window.fetch = function (input, init) {
    if (ix.on) {
      const u = typeof input === 'string' ? input : input?.url ?? String(input);
      const m = (init?.method || input?.method || 'GET').toUpperCase();
      const rec = { t: now(), m, u: u.replace(location.origin, '').split('?')[0] };
      if (m !== 'GET') rec.stack = (new Error().stack || '').split(String.fromCharCode(10)).slice(1, 9).map((l) => l.trim()).join(' <- ').slice(0, 700);
      ix.req.push(rec);
    }
    return of.apply(this, arguments);
  };
  const oo = XMLHttpRequest.prototype.open;
  XMLHttpRequest.prototype.open = function (m, u) { if (ix.on) ix.req.push({ t: now(), m: String(m).toUpperCase(), u: String(u).replace(location.origin, '').split('?')[0] }); return oo.apply(this, arguments); };

  // Tác vụ hẹn giờ dài (tự lưu dùng setTimeout 1 s): đo ĐÚNG thời gian callback chạy, tách khỏi khung vẽ.
  const ost = window.setTimeout;
  window.setTimeout = function (fn, delay, ...rest) {
    if (typeof fn !== 'function') return ost.call(this, fn, delay, ...rest);
    const site = (new Error().stack || '').split(String.fromCharCode(10)).slice(2, 4).join(' | ').slice(0, 220);
    return ost.call(this, function () {
      const t = now();
      try { return fn.apply(this, arguments); }
      finally { const d = now() - t; if (ix.on && d > 25) ix.timers.push({ delay, dur: Math.round(d), site }); }
    }, delay, ...rest);
  };

  ix.mark = () => {
    for (const k of ['moves', 'downs', 'frames', 'renders', 'loaf', 'longtasks', 'commits', 'req', 'measures', 'timers']) ix[k] = [];
    const idl = window.__pascalIdle?.(); ix.idle0 = idl ? { drawn: idl.drawn, skipped: idl.skipped, reasons: { ...(idl.reasons || {}) } } : null;
    ix.shadow0 = window.__pascalShadowCache?.updates ?? null;
    ix.t0 = now(); ix.on = true;
  };
  ix.stop = () => { ix.on = false; };
})();
