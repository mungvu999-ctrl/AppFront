// node scripts/perf/gpu-vs-cpu.mjs <label> <projectId> [combo] — khung bị GPU chặn hay CPU chặn?
// Dùng mốc riêng của vendor (`?perf`): `render-encode` = CPU mã hoá lệnh vẽ,
// `gpu-render` = thời gian GPU thật (timestamp query), `gpu-queue` = tồn đọng hàng đợi.
// Chạy kèm `?disable=` để so cùng một thước đo giữa các tổ hợp hậu kỳ.
import { writeFileSync } from 'node:fs';
import { start, openEditor, gpuInfo, outDir, sleep } from './lib.mjs';

const [label, pid, combo = 'none'] = process.argv.slice(2);
const OUT = outDir('gpu-vs-cpu', label);
const log = (...a) => console.log(new Date().toISOString().slice(11, 19), ...a);
const flags = combo === 'none' ? '' : combo.split('+').join(',');

const scr = (page, p) => page.evaluate((q) => {
  const ix = window.__ix; const rect = ix.renderer.domElement.getBoundingClientRect();
  const V = (ix.mainScene ?? ix.scene).position.constructor;
  const v = new V(q[0], q[1], q[2]).project(ix.cam);
  return [rect.left + ((v.x + 1) / 2) * rect.width, rect.top + ((1 - v.y) / 2) * rect.height];
}, p);

const { browser, page } = await start();
const res = { label, pid, combo, at: new Date().toISOString() };
try {
  res.load = (await openEditor(page, pid, `perf=1${flags ? `&disable=${flags}` : ''}`)).loadMs;
  res.gpu = await gpuInfo(page);
  log('gpu', JSON.stringify(res.gpu));
  const b = await page.evaluate(() => {
    const ws = window.__pascalProbe.walls();
    const bb = { minX: 1e9, maxX: -1e9, minZ: 1e9, maxZ: -1e9 };
    for (const w of ws) for (const [x, z] of [w.start, w.end]) {
      bb.minX = Math.min(bb.minX, x); bb.maxX = Math.max(bb.maxX, x);
      bb.minZ = Math.min(bb.minZ, z); bb.maxZ = Math.max(bb.maxZ, z);
    }
    return bb;
  });
  const cx = (b.minX + b.maxX) / 2, cz = (b.minZ + b.maxZ) / 2;
  const span = Math.max(b.maxX - b.minX, b.maxZ - b.minZ, 4);
  await page.evaluate((c) => window.__pascalProbe.setCamera([c[0], c[2] * 11, c[1] + 0.05], [c[0], 0, c[1]], 7.5), [cx, cz, span]);
  await sleep(1800);

  const ok = await page.evaluate(() => {
    const sub = window.__pascalPerfSamples;
    if (typeof sub !== 'function') return false;
    const S = { rows: new Map(), frames: 0 };
    window.__gc2 = S;
    S.off = sub((track, ms) => {
      let r = S.rows.get(track);
      if (!r) { r = []; S.rows.set(track, r); }
      r.push(ms);
    });
    const tick = () => { S.frames += 1; requestAnimationFrame(tick); };
    requestAnimationFrame(tick);
    return true;
  });
  if (!ok) throw new Error('khong co window.__pascalPerfSamples — can ?perf');

  const phase = async (name, fn) => {
    await page.evaluate(() => { const S = window.__gc2; S.rows.clear(); S.frames = 0; S.t0 = performance.now(); });
    await fn();
    const s = await page.evaluate(() => {
      const S = window.__gc2;
      const q = (a, p) => { const s2 = [...a].sort((x, y) => x - y); return s2.length ? Math.round(s2[Math.min(s2.length - 1, Math.floor(s2.length * p))] * 100) / 100 : null; };
      const out = { windowMs: Math.round(performance.now() - S.t0), rafFrames: S.frames, tracks: {} };
      for (const [k, v] of S.rows) {
        out.tracks[k] = { n: v.length, p50: q(v, 0.5), p95: q(v, 0.95), sum: Math.round(v.reduce((a, c) => a + c, 0)) };
      }
      return out;
    });
    const top = Object.entries(s.tracks).sort((a, c) => c[1].sum - a[1].sum).slice(0, 8);
    log(`${name}: ${s.windowMs}ms, ${s.rafFrames} khung rAF`);
    for (const [k, v] of top) log(`   ${k.padEnd(20)} n=${String(v.n).padStart(4)}  p50=${String(v.p50).padStart(7)}  p95=${String(v.p95).padStart(7)}  Σ=${v.sum}ms`);
    return s;
  };

  res.idle = await phase('DUNG YEN 3s', () => sleep(3000));

  const walls = (await page.evaluate(() => window.__pascalProbe.walls()))
    .map((w) => ({ ...w, len: Math.hypot(w.end[0] - w.start[0], w.end[1] - w.start[1]) }))
    .sort((a, c) => c.len - a.len);
  const w = walls[0];
  const cur = await page.evaluate((id) => window.__pascalProbe.walls().find((x) => x.id === id), w.id);
  const a = await scr(page, [cur.start[0], 0, cur.start[1]]);
  const e = await scr(page, [cur.end[0], 0, cur.end[1]]);
  const L = Math.hypot(e[0] - a[0], e[1] - a[1]);
  const nx = -(e[1] - a[1]) / L, ny = (e[0] - a[0]) / L;
  const mid = [a[0] + (e[0] - a[0]) * 0.3, a[1] + (e[1] - a[1]) * 0.3];
  await page.mouse.click(mid[0], mid[1]); await sleep(900);

  res.orbit = await phase('XOAY CAMERA', async () => {
    await page.mouse.move(960, 540); await page.mouse.down({ button: 'right' });
    for (let i = 1; i <= 60; i += 1) await page.mouse.move(960 + i * 3, 540 + Math.sin(i / 7) * 25, { button: 'right' });
    await page.mouse.up({ button: 'right' }); await sleep(200);
  });

  res.drag = await phase('KEO TUONG', async () => {
    await page.mouse.move(e[0], e[1]); await page.mouse.down(); await sleep(60);
    for (let i = 1; i <= 120; i += 1) await page.mouse.move(e[0] + nx * 70 * (i / 120), e[1] + ny * 70 * (i / 120));
    await sleep(250);
  });
  await page.mouse.up(); await sleep(1500);
  const aft = await page.evaluate((id) => window.__pascalProbe.walls().find((x) => x.id === id), w.id);
  res.moved = +Math.hypot(aft.end[0] - cur.end[0], aft.end[1] - cur.end[1]).toFixed(3);
  log('tuong doi', res.moved, 'm');
  writeFileSync(`${OUT}/${pid}-${combo}-gpu-cpu.json`, JSON.stringify(res, null, 1));
} catch (err) {
  res.error = String(err).slice(0, 400); log('LOI', res.error);
  writeFileSync(`${OUT}/${pid}-${combo}-gpu-cpu.json`, JSON.stringify(res, null, 1));
} finally { await browser.close(); }
