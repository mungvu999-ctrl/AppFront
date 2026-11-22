// Bộ đo editor 3D: mở trình duyệt thật (GPU rời, headless), đăng nhập f14, mở editor3d.html?project=…&probe=1.
// Chép từ bộ đo của đợt audit (docs/editor-3d-performance-ux-audit/impl-tools, ngoài repo) vào repo ở L7-03.
//
// Dùng (từ gốc repo, sau `pnpm build` của worktree cần đo):
//   PREVIEW_ROOT=<worktree> pnpm exec vite preview --config scripts/perf/vite.preview.config.mjs --port 18099 --strictPort
//   PERF_SECRETS_ENV=<tệp .env có E2E_ADMIN_EMAIL/E2E_ADMIN_PASSWORD> node scripts/perf/<kịch bản>.mjs …
// Biến môi trường: BASE (mặc định http://localhost:18099), PERF_OUT (thư mục ghi kết quả, mặc định
// `perf-runs/` ở thư mục đang đứng — đã nằm trong .gitignore), GPU=dgpu|igpu|swiftshader,
// E2E_ADMIN_EMAIL/E2E_ADMIN_PASSWORD (đọc thẳng từ môi trường khi không đặt PERF_SECRETS_ENV).
// Mọi kết quả ghi kèm `gpuInfo` (backend + adapter.info) để biết số đo của loại máy nào.
// AN TOÀN DỮ LIỆU: mọi lượt ghi (PUT/POST/PATCH/DELETE dưới /api) bị chặn ở trình duyệt đo; PUT …/spatial/layer
// được trả lời giả bằng chính lớp vừa gửi (revision + 1) để luồng lưu phía client chạy như thật mà f14 không đổi.
// Không in thông tin đăng nhập.
import { readFileSync, mkdirSync } from 'node:fs';
import path from 'node:path';

import { chromium } from '@playwright/test';

export { chromium };
export const BASE = process.env.BASE ?? 'http://localhost:18099'; // bản dựng của worktree qua `vite preview` (xem scripts/perf/vite.preview.config.mjs)
const ORIGIN = process.env.API_ORIGIN ?? 'http://localhost:18080'; // API f14 chỉ tin origin này
const INSTR = readFileSync(new URL('./instrument.js', import.meta.url), 'utf8');
const readEnvFile = (file) => Object.fromEntries(readFileSync(file, 'utf8')
  .split(/\r?\n/).filter((l) => l.includes('=') && !l.startsWith('#'))
  .map((l) => { const i = l.indexOf('='); return [l.slice(0, i).trim(), l.slice(i + 1).trim().replace(/^["']|["']$/g, '')]; }));
const env = process.env.PERF_SECRETS_ENV ? readEnvFile(process.env.PERF_SECRETS_ENV) : process.env;
/** Thư mục ghi kết quả của một nhãn đo. */
export const outDir = (...parts) => ensureDir(path.resolve(process.env.PERF_OUT ?? 'perf-runs', ...parts));

export const writes = { echoed: 0, blocked: [], real: [] };
/** Thẻ `Authorization` bắt được từ lượt gọi API đầu tiên của chính ứng dụng — để kịch bản gọi API thay người dùng. */
export const auth = { token: null };
/** ALLOW_WRITES=1: cho lượt ghi đi thật (chỉ dùng trên DỰ ÁN SAO CHÉP để kiểm lưu–tải lại). */
const ALLOW_WRITES = process.env.ALLOW_WRITES === '1';

export async function start({ w = 1920, h = 1080, dpr = 1, gpu = process.env.GPU ?? 'dgpu' } = {}) {
  const args = ['--enable-unsafe-webgpu', '--ignore-gpu-blocklist', '--headless=new',
    '--disable-features=CalculateNativeWinOcclusion', '--disable-backgrounding-occluded-windows',
    '--disable-renderer-backgrounding', '--disable-background-timer-throttling', '--disable-web-security',
    ...(gpu === 'swiftshader' ? ['--use-angle=swiftshader', '--enable-unsafe-swiftshader']
      : ['--use-angle=d3d11', ...(gpu === 'dgpu' ? ['--force_high_performance_gpu'] : gpu === 'igpu' ? ['--use-webgpu-power-preference=low-power'] : [])])];
  const browser = await chromium.launch({ channel: 'chrome', headless: false, args });
  const ctx = await browser.newContext({ viewport: { width: w, height: h }, locale: 'vi-VN', deviceScaleFactor: dpr, bypassCSP: true });
  await ctx.addInitScript(INSTR);
  await ctx.route('**/api/**', async (route) => {
    const req = route.request(); const m = req.method(); const url = req.url();
    const headers = { ...req.headers(), origin: ORIGIN, referer: ORIGIN + '/' };
    if (auth.token === null && typeof headers.authorization === 'string' && headers.authorization.startsWith('Bearer ')) auth.token = headers.authorization;
    const isAuth = /\/auth\/|\/sessions?\b|\/telemetry/.test(url);
    if (m === 'GET' || m === 'HEAD' || m === 'OPTIONS' || isAuth) return route.continue({ headers });
    if (ALLOW_WRITES) { writes.real.push(`${m} ${new URL(url).pathname}`); return route.continue({ headers }); }
    if (m === 'PUT' && /\/spatial\/layer$/.test(new URL(url).pathname)) {
      const body = JSON.parse(req.postData() || '{}');
      let layer = body.body?.layer;
      if (!layer) { const r = await route.fetch({ method: 'GET', headers }); layer = (await r.json()).layer; }
      writes.echoed += 1;
      return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ layer, revision: (body.baseVersion ?? 0) + 1 }) });
    }
    writes.blocked.push(`${m} ${new URL(url).pathname}`);
    return route.fulfill({ status: 503, contentType: 'application/json', body: '{"error":{"code":"MEASURE_BLOCKED"}}' });
  });
  const page = await ctx.newPage();
  if (!env.E2E_ADMIN_EMAIL || !env.E2E_ADMIN_PASSWORD) throw new Error('thiếu E2E_ADMIN_EMAIL/E2E_ADMIN_PASSWORD (đặt PERF_SECRETS_ENV hoặc biến môi trường)');
  await page.goto(`${BASE}/login`, { waitUntil: 'domcontentloaded', timeout: 90_000 });
  await page.getByLabel('Thư điện tử', { exact: true }).fill(env.E2E_ADMIN_EMAIL);
  await page.getByLabel('Mật khẩu', { exact: true }).fill(env.E2E_ADMIN_PASSWORD);
  await page.getByRole('button', { name: 'Đăng nhập', exact: true }).click();
  await page.waitForURL((u) => !u.pathname.startsWith('/login'), { timeout: 30_000 });
  return { browser, ctx, page };
}

export async function openEditor(page, projectId, extra = '') {
  const u = new URL(`${BASE}/editor3d.html`); u.searchParams.set('project', projectId); u.searchParams.set('probe', '1');
  for (const [k, v] of new URLSearchParams(extra)) u.searchParams.set(k, v);
  const t0 = Date.now();
  await page.goto(u.toString(), { waitUntil: 'domcontentloaded', timeout: 90_000 });
  await page.waitForFunction(() => window.__pascalProbe?.ready?.() === true, null, { timeout: 180_000 });
  await page.waitForFunction(() => { const p = window.__pascalProbe; const it = p.items?.() ?? []; return it.every((i) => i.settled !== false); }, null, { timeout: 90_000 }).catch(() => {});
  // Chờ số texture ổn định 1 s (trần 8 s) để không đo lúc còn nạp.
  await page.evaluate(async () => { const r = window.__ix.renderer; let last = -1, t = Date.now(), st = Date.now(); while (Date.now() - t < 8000) { const n = r?.info?.memory?.textures ?? 0; if (n !== last) { last = n; st = Date.now(); } else if (Date.now() - st > 1000) break; await new Promise((f) => setTimeout(f, 100)); } });
  return { loadMs: Date.now() - t0, url: u.toString() };
}

/**
 * Loại máy của số đo: backend renderer + `adapter.info` của WebGPU (vendor/architecture/description) và
 * renderer WebGL không che (nếu trình duyệt cho). Kết luận đo trên dGPU không mặc nhiên đúng cho iGPU (L7-N01).
 */
export const gpuInfo = async (page) => ({
  ...(await page.evaluate(async () => {
    const r = window.__ix?.renderer;
    const backend = r?.backend?.isWebGPUBackend ? 'webgpu' : r?.isWebGLRenderer ? 'webgl' : r?.backend ? 'webgl2-fallback' : 'none';
    let adapter = null;
    try {
      const a = await navigator.gpu?.requestAdapter();
      const info = a?.info ?? (await a?.requestAdapterInfo?.());
      if (info) adapter = { vendor: info.vendor, architecture: info.architecture, device: info.device, description: info.description };
    } catch { adapter = null; }
    let webgl = null;
    try {
      const gl = document.createElement('canvas').getContext('webgl2');
      const ext = gl?.getExtension('WEBGL_debug_renderer_info');
      if (gl && ext) webgl = { vendor: gl.getParameter(ext.UNMASKED_VENDOR_WEBGL), renderer: gl.getParameter(ext.UNMASKED_RENDERER_WEBGL) };
    } catch { webgl = null; }
    return { backend, adapter, webgl };
  })),
  gpuFlag: process.env.GPU ?? 'dgpu',
});

/** Số liệu scene: node theo loại, mesh/tam giác trong scene, renderer.info, DPR, backend. */
export const sceneStats = (page) => page.evaluate(() => {
  const p = window.__pascalProbe; const ix = window.__ix; const r = ix.renderer;
  let meshes = 0, tris = 0, inst = 0, objs = 0;
  (ix.mainScene ?? ix.scene)?.traverse((o) => { objs += 1; if (o.isMesh) { meshes += 1; if (o.isInstancedMesh) inst += 1; const g = o.geometry; const n = g?.index ? g.index.count : g?.attributes?.position?.count ?? 0; tris += (n / 3) * (o.isInstancedMesh ? o.count : 1); } });
  return {
    counts: p.counts(), walls: p.walls().length, openings: p.openings().length, items: p.items().length, rooms: p.rooms().length,
    sceneObjects: objs, meshes, instancedMeshes: inst, sceneTriangles: Math.round(tris),
    backend: r?.backend?.isWebGPUBackend ? 'webgpu' : r?.isWebGLRenderer ? 'webgl' : r?.backend ? 'webgl2-fallback' : 'none',
    pixelRatio: r?.getPixelRatio?.(), memory: r ? { ...r.info.memory } : null,
    canvases: document.querySelectorAll('canvas').length, dprWindow: devicePixelRatio,
    loaf: PerformanceObserver.supportedEntryTypes.includes('long-animation-frame'),
    heapMB: performance.memory ? Math.round(performance.memory.usedJSHeapSize / 1e6) : null,
  };
});

export const pct = (arr, p) => { if (!arr.length) return null; const s = [...arr].sort((a, b) => a - b); return Math.round(s[Math.min(s.length - 1, Math.floor(s.length * p))] * 10) / 10; };

/** Tóm tắt một cửa sổ đo trong trang. */
export const collect = (page) => page.evaluate(() => {
  const ix = window.__ix; ix.stop();
  const q = (a, p) => { if (!a.length) return null; const s = [...a].sort((x, y) => x - y); return Math.round(s[Math.min(s.length - 1, Math.floor(s.length * p))] * 10) / 10; };
  const st = (a) => ({ n: a.length, p50: q(a, 0.5), p95: q(a, 0.95), p99: q(a, 0.99), max: a.length ? Math.round(Math.max(...a) * 10) / 10 : null });
  const mv = ix.moves.filter((m) => m.bub != null);
  const dts = ix.frames.map((f) => f.dt).slice(1);
  const dur = ix.frames.length ? ix.frames.at(-1).t - ix.frames[0].t : 0;
  // Gom render theo khung (mỗi khung có thể có nhiều pass render).
  const perFrame = new Map(); let fi = 0;
  for (const r of ix.renders) { while (fi + 1 < ix.frames.length && ix.frames[fi + 1].t <= r.t) fi += 1; perFrame.set(fi, (perFrame.get(fi) ?? 0) + r.ms); }
  const commitsRendered = ix.commits.map((c) => c.rendered);
  const topComp = {}; for (const c of ix.commits) for (const [n, k] of c.top) topComp[n] = (topComp[n] ?? 0) + k;
  const rootComp = {}; for (const c of ix.commits) for (const [n, k] of c.roots ?? []) rootComp[n] = (rootComp[n] ?? 0) + k;
  const reqs = {}; for (const r of ix.req) { const k = `${r.m} ${r.u.replace(/[0-9A-Z]{26}|prj_\w+|flr_\w+|lvl_\w+/g, ':id')}`; reqs[k] = (reqs[k] ?? 0) + 1; }
  return {
    durationMs: Math.round(dur),
    frames: { ...st(dts), over33: dts.filter((d) => d > 33.4).length, over50: dts.filter((d) => d > 50).length, fps: dur ? Math.round((dts.length / dur) * 1000 * 10) / 10 : null },
    pointermove: {
      n: mv.length, perFrame: ix.frames.length ? Math.round((mv.length / ix.frames.length) * 100) / 100 : null,
      coalescedAvg: mv.length ? Math.round((mv.reduce((s, m) => s + m.coalesced, 0) / mv.length) * 10) / 10 : null,
      handlerMs: st(mv.map((m) => m.bub - m.cap)),
      queueMs: st(mv.map((m) => m.cap - m.ts)),
      toNextRafMs: st(mv.filter((m) => m.raf).map((m) => m.raf - m.ts)),
      toTaskEndMs: st(mv.filter((m) => m.done).map((m) => m.done - m.ts)),
    },
    discrete: ix.downs.map((d) => ({ type: d.type, key: d.key, handlerMs: d.bub ? Math.round((d.bub - d.cap) * 10) / 10 : null, toNextRafMs: d.raf ? Math.round((d.raf - d.ts) * 10) / 10 : null, toTaskEndMs: d.done ? Math.round((d.done - d.ts) * 10) / 10 : null })),
    renderCpuMsPerFrame: st([...perFrame.values()]), renderCalls: ix.renders.length,
    react: { commits: ix.commits.length, fibersPerCommit: st(commitsRendered), fibersTotal: commitsRendered.reduce((a, b) => a + b, 0), walkMsTotal: Math.round(ix.commits.reduce((s, c) => s + c.walkMs, 0)), topComponents: Object.entries(topComp).sort((a, b) => b[1] - a[1]).slice(0, 15), renderRoots: Object.entries(rootComp).sort((a, b) => b[1] - a[1]).slice(0, 12) },
    loaf: { n: ix.loaf.length, durMs: st(ix.loaf.map((l) => l.dur)), blockMsTotal: Math.round(ix.loaf.reduce((s, l) => s + l.block, 0)), worst: [...ix.loaf].sort((a, b) => b.dur - a.dur).slice(0, 3) },
    longtasks: { n: ix.longtasks.length, ms: st(ix.longtasks.map((l) => l.dur)) },
    requests: reqs,
    writeStacks: ix.req.filter((r) => r.stack).map((r) => ({ m: r.m, u: r.u, t: Math.round(r.t - ix.t0), stack: r.stack })),
    measures: (() => { const m = {}; for (const e of ix.measures) { const a = (m[e.n] ??= { n: 0, ms: 0, max: 0 }); a.n += 1; a.ms += e.d; a.max = Math.max(a.max, e.d); } for (const a of Object.values(m)) { a.ms = Math.round(a.ms * 10) / 10; a.max = Math.round(a.max * 10) / 10; } return m; })(),
    idle: (() => { const i = window.__pascalIdle?.(); const b = ix.idle0; if (!i || !b) return null; const reasons = {}; for (const [k, v] of Object.entries(i.reasons || {})) { const d = (typeof v === 'number' ? v : 0) - (typeof b.reasons[k] === 'number' ? b.reasons[k] : 0); if (d) reasons[k] = d; } return { drawn: i.drawn - b.drawn, skipped: i.skipped - b.skipped, reasons }; })(),
    timers: ix.timers.slice().sort((a, b) => b.dur - a.dur).slice(0, 6),
    shadowUpdates: window.__pascalShadowCache && ix.shadow0 != null ? window.__pascalShadowCache.updates - ix.shadow0 : null,
  };
});

/** Chiếu điểm thế giới → toạ độ màn hình CSS theo camera của lượt render gần nhất. */
export const project = (page, pts) => page.evaluate((pts) => {
  const ix = window.__ix; const cam = ix.cam; const cv = ix.renderer?.domElement ?? document.querySelector('canvas');
  const rect = cv.getBoundingClientRect(); const V = (ix.mainScene ?? ix.scene).position.constructor;
  return pts.map(([x, y, z]) => { const v = new V(x, y, z).project(cam); return [rect.left + ((v.x + 1) / 2) * rect.width, rect.top + ((1 - v.y) / 2) * rect.height, v.z]; });
}, pts);

/** Kéo chuột thẳng từ a → b với tốc độ đều (px/s), mỗi bước ~8 ms (gần 120 Hz chuột thật). */
export async function drag(page, a, b, { speed = 400, button = 'left', hold = 120, modifiers = [] } = {}) {
  const dist = Math.hypot(b[0] - a[0], b[1] - a[1]); const ms = (dist / speed) * 1000; const steps = Math.max(8, Math.round(ms / 8));
  await page.mouse.move(a[0], a[1]);
  for (const k of modifiers) await page.keyboard.down(k);
  await page.mouse.down({ button });
  await page.waitForTimeout(hold);
  const t0 = Date.now();
  for (let i = 1; i <= steps; i++) {
    const t = i / steps; await page.mouse.move(a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t);
    const left = t0 + ms * t - Date.now(); if (left > 0) await page.waitForTimeout(left);
  }
  await page.waitForTimeout(hold);
  await page.mouse.up({ button });
  for (const k of modifiers) await page.keyboard.up(k);
}

export const ensureDir = (d) => { mkdirSync(d, { recursive: true }); return d; };
export const sleep = (ms) => new Promise((f) => setTimeout(f, ms));
