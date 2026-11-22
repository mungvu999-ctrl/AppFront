// node scripts/perf/run-scn.mjs <label> <projectId> <scenarios,...> [reps=4]
// Kịch bản: idle, hover, orbit, pan, zoom, item-drag, item-click, wall-end, wall-move, door-drag (+ undo/redo sau mỗi kịch bản sửa).
// Góc nhìn trên cùng (top-ortho) cho mọi thao tác sửa: tia chuột vuông góc sàn, điểm nắm = tâm vật, dễ chiếu toạ độ.
// Env: PROFILE=1 → ghi CPU profile (CDP) cho lượt đầu của mỗi kịch bản sửa; PERF=1 → thêm ?perf (performance.measure).
import { writeFileSync } from 'node:fs';
import { start, openEditor, sceneStats, gpuInfo, collect, project, outDir, writes, sleep } from './lib.mjs';
const [label, pid, scnArg, repsArg = '4'] = process.argv.slice(2);
const SCN = scnArg.split(','); const REPS = Number(repsArg);
const OUT = outDir('run-scn', label);
const W = Number(process.env.W ?? 1920), H = Number(process.env.H ?? 1080);
const { browser, ctx, page } = await start({ w: W, h: H });
const cdp = await ctx.newCDPSession(page);
const log = (...a) => console.log(new Date().toISOString().slice(11, 19), ...a);
const P = window => window; // eslint
const probe = (fn, arg) => page.evaluate(fn, arg);
const mark = () => page.evaluate(() => window.__ix.mark());

async function profileStart() { await cdp.send('Profiler.enable'); await cdp.send('Profiler.setSamplingInterval', { interval: 200 }); await cdp.send('Profiler.start'); }
async function profileStop(name) {
  const { profile } = await cdp.send('Profiler.stop');
  const self = new Map(); const dt = profile.timeDeltas; const byId = new Map(profile.nodes.map((n) => [n.id, n]));
  const cnt = new Map(); for (const s of profile.samples) cnt.set(s, (cnt.get(s) ?? 0) + 1);
  const avg = dt.reduce((a, b) => a + b, 0) / Math.max(1, dt.length) / 1000; // ms/mẫu
  let total = 0;
  for (const [id, c] of cnt) { const n = byId.get(id); const f = n.callFrame; const k = `${f.functionName || '(anon)'} @ ${f.url.split('/').pop().split('?')[0]}:${f.lineNumber + 1}`; self.set(k, (self.get(k) ?? 0) + c * avg); total += c * avg; }
  const top = [...self.entries()].sort((a, b) => b[1] - a[1]).slice(0, 30).map(([k, v]) => [k, Math.round(v * 10) / 10]);
  writeFileSync(`${OUT}/${pid}-${name}.cpuprofile`, JSON.stringify(profile));
  return { totalMs: Math.round(total), top };
}

const walls = () => probe(() => window.__pascalProbe.walls());
const items = () => probe(() => window.__pascalProbe.items());
const openings = () => probe(() => window.__pascalProbe.openings());
const scr = async (p) => (await project(page, [p]))[0];

/** Kéo giữ nút trái từ a tới b, tốc độ đều, chia bước 8 ms; trả mảng mẫu thời gian. */
async function pressDrag(a, b, { speed = 400, preHold = 80, postHold = 250 } = {}) {
  const dist = Math.hypot(b[0] - a[0], b[1] - a[1]); const ms = Math.max(300, (dist / speed) * 1000); const steps = Math.round(ms / 8);
  await page.mouse.move(a[0], a[1]); await page.mouse.down(); await sleep(preHold);
  const t0 = Date.now();
  for (let i = 1; i <= steps; i++) { const t = i / steps; await page.mouse.move(a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t); const left = t0 + ms * t - Date.now(); if (left > 0) await sleep(left); }
  await sleep(postHold); await page.mouse.up();
}

/** Vật được theo dõi = Object3D dời xa nhất sau vài bước kéo (bản xem trước hoặc chính lưới). */
const snapPositions = () => page.evaluate(() => { const ix = window.__ix; ix.snap = new Map(); (ix.mainScene ?? ix.scene).traverse((o) => { const p = o.getWorldPosition(new o.position.constructor()); ix.snap.set(o.uuid, [p.x, p.y, p.z]); }); });
const pickMoved = () => page.evaluate(() => { const ix = window.__ix; let best = null, bd = 0; (ix.mainScene ?? ix.scene).traverse((o) => { if (!o.visible) return; const p = o.getWorldPosition(new o.position.constructor()); const q = ix.snap.get(o.uuid); if (!q) return; const d = Math.hypot(p.x - q[0], p.z - q[2]); if (d > bd + 1e-6) { bd = d; best = o; } }); ix.track = best ? { obj: best, V: best.position.constructor } : null; return best ? { type: best.type, name: best.name, moved: Math.round(bd * 1000) / 1000 } : null; });

/** Độ trễ vật ↔ con trỏ (dọc hướng kéo, theo thời gian) cho các lượt render có vị trí vật. */
const lag = (dir, buttons = 1) => page.evaluate(([dir, buttons]) => {
  const ix = window.__ix; const cam = ix.cam; const rect = ix.renderer.domElement.getBoundingClientRect(); const V = (ix.mainScene ?? ix.scene).position.constructor;
  const sc = (p) => { const v = new V(p[0], p[1], p[2]).project(cam); return [rect.left + ((v.x + 1) / 2) * rect.width, rect.top + ((1 - v.y) / 2) * rect.height]; };
  const mv = ix.moves.filter((m) => m.buttons === buttons); if (mv.length < 5) return null;
  const n = Math.hypot(dir[0], dir[1]); const s = (x, y) => (x * dir[0] + y * dir[1]) / n;
  const ptrAt = (t) => { let last = null; for (const m of mv) { if (m.ts <= t) last = m; else break; } return last; };
  const fr = ix.renders.filter((r) => r.track).map((r) => { const [x, y] = sc(r.track); const m = ptrAt(r.t); return m ? { t: r.t, so: s(x, y), sp: s(m.x, m.y), age: r.t - m.ts } : null; }).filter(Boolean);
  if (fr.length < 5) return { frames: fr.length };
  const tail = fr.slice(-3); const off = tail.reduce((a, f) => a + (f.so - f.sp), 0) / 3;
  const t0 = mv[0].ts, t1 = mv.at(-1).ts; const s0 = s(mv[0].x, mv[0].y); const v = (s(mv.at(-1).x, mv.at(-1).y) - s0) / (t1 - t0);
  const moving = fr.filter((f) => f.t > t0 + 80 && f.t < t1);
  const lags = moving.map((f) => f.t - (t0 + ((f.so - off) - s0) / v));
  const q = (a, p) => { if (!a.length) return null; const x = [...a].sort((u, w) => u - w); return Math.round(x[Math.min(x.length - 1, Math.floor(x.length * p))] * 10) / 10; };
  // Số khung liên tiếp vật đứng yên trong khi con trỏ vẫn chạy (dấu hiệu khựng).
  let stuck = 0, maxStuck = 0; for (let i = 1; i < moving.length; i++) { if (Math.abs(moving[i].so - moving[i - 1].so) < 0.5) { stuck += 1; maxStuck = Math.max(maxStuck, stuck); } else stuck = 0; }
  return { renderFrames: moving.length, pxPerMs: Math.round(v * 100) / 100, offsetPx: Math.round(off), lagMs: { p50: q(lags, 0.5), p95: q(lags, 0.95), max: q(lags, 1) }, eventAgeMs: { p50: q(moving.map((f) => f.age), 0.5), p95: q(moving.map((f) => f.age), 0.95) }, maxFramesStill: maxStuck };
}, [dir, buttons]);


/** Di chuyển qua nút "Di chuyển" của menu nổi: (đã chọn) bấm nút → đưa chuột về điểm bắt đầu → rê đều → bấm đặt. */
async function menuMove(rec, from, d, name, first) {
  const btn = page.getByRole('button', { name: 'Di chuyển', exact: true }).first();
  await mark(); await btn.click({ timeout: 3000 }); await sleep(300); rec.pick = await collect(page);
  await page.mouse.move(from[0], from[1], { steps: 4 }); await sleep(250);
  await snapPositions();
  if (first && process.env.PROFILE) await profileStart();
  await mark(); const ms = 1400, steps = Math.round(ms / 8), t0 = Date.now();
  for (let i = 1; i <= steps; i++) { const t = i / steps; await page.mouse.move(from[0] + d[0] * t, from[1] + d[1] * t); if (i === 10) rec.track = await pickMoved(); const left = t0 + ms * t - Date.now(); if (left > 0) await sleep(left); }
  await sleep(300); rec.lag = await lag(d, 0); rec.move = await collect(page);
  if (first) await page.screenshot({ path: `${OUT}/${pid}-${name}-moving.png` });
  await mark(); await page.mouse.click(from[0] + d[0], from[1] + d[1]); await sleep(2000); rec.commit = await collect(page);
  if (first && process.env.PROFILE) rec.cpu = await profileStop(name);
}

async function undoRedo(rec) {
  await mark(); await page.keyboard.press('Control+z'); await sleep(1500); rec.undo = await collect(page);
  await mark(); await page.keyboard.press('Control+Shift+z'); await sleep(1500); rec.redo = await collect(page);
}

const res = { label, pid, at: new Date().toISOString(), viewport: [W, H], env: { perf: !!process.env.PERF, profile: !!process.env.PROFILE }, scenarios: {} };
try {
  res.load = await openEditor(page, pid, [process.env.PERF ? 'perf=1' : '', process.env.Q ?? ''].filter(Boolean).join('&')); log('nạp', res.load.loadMs, 'ms');
  const ws0 = await walls();
  const b = { minX: 1e9, maxX: -1e9, minZ: 1e9, maxZ: -1e9 }; for (const w of ws0) for (const [x, z] of [w.start, w.end]) { b.minX = Math.min(b.minX, x); b.maxX = Math.max(b.maxX, x); b.minZ = Math.min(b.minZ, z); b.maxZ = Math.max(b.maxZ, z); }
  const cx = (b.minX + b.maxX) / 2, cz = (b.minZ + b.maxZ) / 2, span = Math.max(b.maxX - b.minX, b.maxZ - b.minZ, 4);
  // Nhìn thẳng xuống bằng camera phối cảnh (top-ortho của probe không đặt zoom → mặt bằng chỉ ~100 px).
  const top = async () => { await probe((c) => window.__pascalProbe.setCamera([c[0], c[2] * 11, c[1] + 0.05], [c[0], 0, c[1]], 7.5), [cx, cz, span]); await sleep(1200); };
  const persp = async () => { await probe((c) => window.__pascalProbe.setCamera([c[0] + c[2] * 0.45, c[2] * 0.75, c[1] + c[2] * 0.55], [c[0], 0, c[1]], 50), [cx, cz, span]); await sleep(1200); };
  await top(); res.stats = await sceneStats(page); res.gpu = await gpuInfo(page); log('gpu', JSON.stringify(res.gpu)); log('scene', JSON.stringify({ ...res.stats.counts, tris: res.stats.sceneTriangles, meshes: res.stats.meshes }));
  const [o0, o1] = [await scr([cx, 0, cz]), await scr([cx + 1, 0, cz])]; const pxPerM = Math.hypot(o1[0] - o0[0], o1[1] - o0[1]); res.pxPerM = Math.round(pxPerM);
  await page.screenshot({ path: `${OUT}/${pid}-top.png` });
  const inView = ([x, y]) => x > 260 && x < W - 260 && y > 140 && y < H - 160;

  for (const scn of SCN) {
    const out = (res.scenarios[scn] = { reps: [] });
    try {
      if (scn === 'idle') { await top(); await mark(); await sleep(3000); out.reps.push(await collect(page)); }
      else if (scn === 'hover') {
        await top();
        for (let r = 0; r < REPS; r++) { if (r === 0 && process.env.PROFILE) await profileStart(); await mark(); const t0 = Date.now(); while (Date.now() - t0 < 2000) { const t = (Date.now() - t0) / 2000; await page.mouse.move(o0[0] + Math.cos(t * 6.28) * pxPerM * span * 0.35, o0[1] + Math.sin(t * 12.56) * pxPerM * span * 0.25); await sleep(8); } await sleep(300); const c = await collect(page); if (r === 0 && process.env.PROFILE) c.cpu = await profileStop('hover'); out.reps.push(c); }
        await page.mouse.move(5, H / 2);
      } else if (scn === 'orbit' || scn === 'pan' || scn === 'zoom') {
        await persp();
        for (let r = 0; r < REPS; r++) {
          await page.mouse.move(W / 2, H / 2); await mark();
          if (scn === 'zoom') { for (let i = 0; i < 20; i++) { await page.mouse.wheel(0, r % 2 ? 100 : -100); await sleep(60); } }
          else { const btn = scn === 'pan' ? 'middle' : 'left'; await page.mouse.down({ button: btn }); const t0 = Date.now(); while (Date.now() - t0 < 1500) { const t = (Date.now() - t0) / 1500; await page.mouse.move(W / 2 + Math.sin(t * 6.28) * 250 * (r % 2 ? -1 : 1), H / 2 + Math.sin(t * 3.14) * 40); await sleep(8); } await page.mouse.up({ button: btn }); }
          await sleep(1200); out.reps.push(await collect(page));
        }
        await top();
      } else if (scn === 'item-drag' || scn === 'item-click') {
        await top();
        const its = (await items()).filter((i) => i.position && i.dimensions).sort((a, c) => c.dimensions[0] * c.dimensions[2] - a.dimensions[0] * a.dimensions[2]);
        let it = null; for (const c of its) { const p = await scr(c.position); if (inView(p)) { it = c; break; } }
        if (!it) throw new Error('không có món trong khung');
        out.item = { id: it.id, dims: it.dimensions };
        // Hướng kéo: về tâm khung nhìn, 0,8 m.
        for (let r = 0; r < REPS; r++) {
          const cur = (await items()).find((i) => i.id === it.id); const p = await scr(cur.position);
          let dx = o0[0] - p[0], dy = o0[1] - p[1]; const L = Math.hypot(dx, dy) || 1; dx = (dx / L) * pxPerM * 0.8; dy = (dy / L) * pxPerM * 0.8;
          const rec = { dir: [Math.round(dx), Math.round(dy)] };
          await mark(); await page.mouse.click(p[0], p[1]); await sleep(900); rec.select = await collect(page);
          if (scn === 'item-drag') {
            await snapPositions(); if (r === 0 && process.env.PROFILE) await profileStart(); await mark();
            // Kéo 1,4 s (> 1 s debounce tự lưu) để thấy lượt lưu giữa cú kéo nếu có.
            const a = p, bb = [p[0] + dx, p[1] + dy];
            await page.mouse.move(a[0], a[1]); await page.mouse.down(); await sleep(60);
            const ms = 1400, steps = Math.round(ms / 8), t0 = Date.now();
            for (let i = 1; i <= steps; i++) { const t = i / steps; await page.mouse.move(a[0] + (bb[0] - a[0]) * t, a[1] + (bb[1] - a[1]) * t); if (i === 12) rec.track = await pickMoved(); const left = t0 + ms * t - Date.now(); if (left > 0) await sleep(left); }
            await sleep(300); rec.lag = await lag([dx, dy]); rec.move = await collect(page);
            await mark(); await page.mouse.up(); await sleep(2000); rec.commit = await collect(page);
            if (r === 0 && process.env.PROFILE) rec.cpu = await profileStop(scn);
          } else {
            await menuMove(rec, p, [dx, dy], scn, r === 0);
          }

          const aft = (await items()).find((i) => i.id === it.id); rec.movedM = Math.round(Math.hypot(aft.position[0] - cur.position[0], aft.position[2] - cur.position[2]) * 100) / 100;
          await page.keyboard.press('Escape'); await sleep(200);
          if (r === REPS - 1) { await undoRedo(rec); rec.undoPos = (await items()).find((i) => i.id === it.id).position; }
          out.reps.push(rec); log(scn, r, 'moved', rec.movedM, 'lag', JSON.stringify(rec.lag?.lagMs), 'move p95', rec.move.frames.p95);
          if (r === 0) await page.screenshot({ path: `${OUT}/${pid}-${scn}.png` });
        }
      } else if (scn === 'wall-end' || scn === 'wall-move') {
        await top();
        // Tường dài nhất có cả hai đầu trong khung.
        const ws = (await walls()).map((w) => ({ ...w, len: Math.hypot(w.end[0] - w.start[0], w.end[1] - w.start[1]) })).sort((a, c) => c.len - a.len);
        const allIt = (await items()).filter((i) => i.position); const near = (c) => allIt.filter((i) => { const t = Math.max(0, Math.min(1, ((i.position[0] - c.start[0]) * (c.end[0] - c.start[0]) + (i.position[2] - c.start[1]) * (c.end[1] - c.start[1])) / (c.len * c.len))); return Math.hypot(c.start[0] + (c.end[0] - c.start[0]) * t - i.position[0], c.start[1] + (c.end[1] - c.start[1]) * t - i.position[2]) < 0.8; }).length;
        ws.sort((p1, p2) => near(p1) - near(p2) || p2.len - p1.len);
        let w = null; for (const c of ws) { const a = await scr([c.start[0], 0, c.start[1]]), e = await scr([c.end[0], 0, c.end[1]]); if (inView(a) && inView(e) && c.len > 1.5) { w = c; break; } }
        if (!w) throw new Error('không có tường trong khung');
        out.wall = { id: w.id, len: Math.round(w.len * 100) / 100, openings: (await openings()).filter((o) => o.wallId === w.id).length };
        for (let r = 0; r < REPS; r++) {
          const cw0 = (await walls()).find((x) => x.id === w.id); const cw = { ...cw0, len: Math.hypot(cw0.end[0] - cw0.start[0], cw0.end[1] - cw0.start[1]) };
          const a = await scr([cw.start[0], 0, cw.start[1]]), e = await scr([cw.end[0], 0, cw.end[1]]);
          const ux = (e[0] - a[0]), uy = (e[1] - a[1]); const L = Math.hypot(ux, uy); const nx = -uy / L, ny = ux / L; const sgn = r % 2 ? -1 : 1;
          // Điểm chọn trên tường xa các ô mở nhất (bấm giữa tường hay trúng cửa).
          const ops = (await openings()).filter((o) => o.wallId === w.id && o.position).map((o) => o.position[0] / cw.len);
          const its = (await items()).filter((i) => i.position);
          let bt = 0.25, bd = -1; for (let t = 0.15; t <= 0.851; t += 0.05) { const px = cw.start[0] + (cw.end[0] - cw.start[0]) * t, pz = cw.start[1] + (cw.end[1] - cw.start[1]) * t; const di = its.length ? Math.min(...its.map((i) => Math.hypot(i.position[0] - px, i.position[2] - pz))) : 9; const dd = Math.min(ops.length ? Math.min(...ops.map((u) => Math.abs(u - t) * cw.len)) : 9, di); if (dd > bd) { bd = dd; bt = t; } }
          const clearanceM = Math.round(bd * 100) / 100;
          const mid = [a[0] + (e[0] - a[0]) * bt, a[1] + (e[1] - a[1]) * bt];
          const rec = { clearanceM };
          await mark(); await page.mouse.click(mid[0], mid[1]); await sleep(900); rec.select = await collect(page);
          if (r === 0) await page.screenshot({ path: `${OUT}/${pid}-${scn}-selected.png` });
          const from = scn === 'wall-end' ? e : mid; const d = [nx * pxPerM * 0.6 * sgn, ny * pxPerM * 0.6 * sgn];
          rec.dir = d.map(Math.round);
          if (scn === 'wall-move') await menuMove(rec, mid, d, scn, r === 0);
          else {
            await snapPositions(); if (r === 0 && process.env.PROFILE) await profileStart();
            await mark();
            await page.mouse.move(from[0], from[1]); await page.mouse.down(); await sleep(60);
            const ms = 1400, steps = Math.round(ms / 8), t0 = Date.now();
            for (let i = 1; i <= steps; i++) { const t = i / steps; await page.mouse.move(from[0] + d[0] * t, from[1] + d[1] * t); const left = t0 + ms * t - Date.now(); if (left > 0) await sleep(left); }
            await sleep(300); rec.move = await collect(page);
            await page.screenshot({ path: `${OUT}/${pid}-${scn}-${r}-held.png` });
            await mark(); await page.mouse.up(); await sleep(2000); rec.commit = await collect(page);
            if (r === 0 && process.env.PROFILE) rec.cpu = await profileStop(scn);
          }
          const aw = (await walls()).find((x) => x.id === w.id);
          rec.changed = { start: [cw.start, aw.start], end: [cw.end, aw.end] };
          await page.keyboard.press('Escape'); await sleep(200);
          if (r === REPS - 1) await undoRedo(rec);
          out.reps.push(rec); log(scn, r, 'end', JSON.stringify(rec.changed.end), 'move p95', rec.move.frames.p95, 'measures', JSON.stringify(rec.move.measures).slice(0, 200));
          if (r === 0) await page.screenshot({ path: `${OUT}/${pid}-${scn}.png` });
        }
      } else if (scn === 'door-drag') {
        await top();
        const ops = await openings(); const ws = await walls();
        let pick = null;
        for (const o of ops) { const w = ws.find((x) => x.id === o.wallId); if (!w || !o.position) continue; const len = Math.hypot(w.end[0] - w.start[0], w.end[1] - w.start[1]); if (len < 2.5) continue; const t = Math.min(1, Math.max(0, o.position[0] / len)); const wp = [w.start[0] + (w.end[0] - w.start[0]) * t, 0, w.start[1] + (w.end[1] - w.start[1]) * t]; const p = await scr(wp); if (inView(p)) { pick = { o, w, wp, p, len }; break; } }
        if (!pick) throw new Error('không có cửa trong khung');
        out.opening = { id: pick.o.id, type: pick.o.type, wallLen: Math.round(pick.len * 100) / 100 };
        for (let r = 0; r < REPS; r++) {
          const o = (await openings()).find((x) => x.id === pick.o.id); const w = (await walls()).find((x) => x.id === o.wallId);
          const t = Math.min(1, Math.max(0, o.position[0] / pick.len)); const wp = [w.start[0] + (w.end[0] - w.start[0]) * t, 0, w.start[1] + (w.end[1] - w.start[1]) * t];
          const p = await scr(wp); const a = await scr([w.start[0], 0, w.start[1]]), e = await scr([w.end[0], 0, w.end[1]]);
          const L = Math.hypot(e[0] - a[0], e[1] - a[1]); const sgn = (t < 0.5 ? 1 : -1); const d = [((e[0] - a[0]) / L) * pxPerM * 0.5 * sgn, ((e[1] - a[1]) / L) * pxPerM * 0.5 * sgn];
          const rec = { dir: d.map(Math.round) };
          await mark(); await page.mouse.click(p[0], p[1]); await sleep(900); rec.select = await collect(page);
          await menuMove(rec, p, d, scn, r === 0);
          const ao = (await openings()).find((x) => x.id === pick.o.id); rec.movedAlong = Math.round(Math.hypot(...[0, 1, 2].map((k) => (ao.position?.[k] ?? 0) - (o.position?.[k] ?? 0))) * 100) / 100;
          await page.keyboard.press('Escape'); await sleep(200);
          if (r === REPS - 1) await undoRedo(rec);
          out.reps.push(rec); log(scn, r, 'along', rec.movedAlong, 'lag', JSON.stringify(rec.lag?.lagMs), 'move p95', rec.move.frames.p95);
          if (r === 0) await page.screenshot({ path: `${OUT}/${pid}-${scn}.png` });
        }
      }
    } catch (e) { out.error = String(e).slice(0, 300); log(scn, 'LỖI', out.error); await page.keyboard.press('Escape').catch(() => {}); await page.mouse.up().catch(() => {}); }
  }
  res.writes = writes;
} catch (e) { res.error = String(e).slice(0, 400); log('LỖI', res.error); await page.screenshot({ path: `${OUT}/${pid}-err.png` }).catch(() => {}); }
finally { writeFileSync(`${OUT}/${pid}.json`, JSON.stringify(res, null, 1)); await browser.close(); }
