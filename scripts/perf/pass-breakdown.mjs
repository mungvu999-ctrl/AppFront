// node scripts/perf/pass-breakdown.mjs <projectId> — một khung vẽ MẤY lượt pass, và mỗi lượt là gì.
// Renderer là WebGPU; `info.calls` đếm render pass. Móc vào renderAsync/render để gắn nhãn
// từng pass theo (scene, camera, render target) rồi đếm theo khung rAF.
import { start, openEditor, gpuInfo, sleep } from './lib.mjs';

const pid = process.argv[2];
const { browser, page } = await start();
try {
  await openEditor(page, pid, '');
  await sleep(1500);
  console.log('gpu:', JSON.stringify(await gpuInfo(page)));

  const info = await page.evaluate(() => {
    const R = window.__ix.renderer;
    const out = { protos: [], post: null, scenes: [] };
    let p = Object.getPrototypeOf(R), d = 0;
    while (p && d < 4) {
      const fns = Object.getOwnPropertyNames(p).filter((k) => {
        const dsc = Object.getOwnPropertyDescriptor(p, k);
        return dsc && typeof dsc.value === 'function';
      });
      out.protos.push({ ctor: p.constructor && p.constructor.name, fns });
      p = Object.getPrototypeOf(p); d += 1;
    }
    return out;
  });
  console.log('render-ish methods:', JSON.stringify(info.protos.map((x) => ({
    c: x.ctor, f: x.fns.filter((n) => /render|pass|bundle|shadow|compose|post/i.test(n)),
  })), null, 1));

  await page.evaluate(() => {
    const R = window.__ix.renderer;
    const S = { frames: 0, passes: [], perFrame: [], labels: {}, t0: performance.now() };
    window.__pb = S;
    let inFrame = [];
    // Tên pass: kích thước + loại render target + scene uuid rút gọn.
    const label = (scene, camera, rt) => {
      const s = scene && scene.isScene ? (scene.name || scene.uuid.slice(0, 6)) : 'none';
      const c = camera ? (camera.isOrthographicCamera ? 'ortho' : 'persp') : '-';
      let t = 'canvas';
      if (rt) {
        const tex = Array.isArray(rt.texture) ? rt.texture[0] : rt.texture;
        t = `rt ${rt.width}x${rt.height}${rt.depth > 1 ? 'x' + rt.depth : ''}${tex && tex.isDepthTexture ? ' depth' : ''}${rt.count > 1 ? ' mrt' + rt.count : ''}`;
      }
      return `${s}|${c}|${t}`;
    };
    const wrap = (proto, name) => {
      const orig = proto[name];
      if (typeof orig !== 'function') return false;
      proto[name] = function patched(scene, camera, ...rest) {
        const t0 = performance.now();
        const rt = this._renderTarget || this.getRenderTarget ? (this._renderTarget || null) : null;
        const out = orig.call(this, scene, camera, ...rest);
        const l = name + ' ' + label(scene, camera, rt);
        inFrame.push(l);
        S.labels[l] = (S.labels[l] || 0) + 1;
        S.passes.push(performance.now() - t0);
        return out;
      };
      return true;
    };
    const chain = [];
    let p = Object.getPrototypeOf(R), d = 0;
    while (p && d < 4) { chain.push(p); p = Object.getPrototypeOf(p); d += 1; }
    S.wrapped = [];
    for (const proto of chain) {
      for (const n of ['render', '_renderScene', 'renderAsync', '_renderObjects']) {
        if (Object.getOwnPropertyDescriptor(proto, n) && wrap(proto, n)) S.wrapped.push((proto.constructor && proto.constructor.name) + '.' + n);
      }
    }
    const tick = () => {
      S.frames += 1; S.perFrame.push(inFrame.length);
      if (inFrame.length > 5 && !S.sample) S.sample = inFrame.slice();
      inFrame = []; requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  });

  const snap = async (name, fn) => {
    await page.evaluate(() => {
      const S = window.__pb;
      S.frames = 0; S.perFrame.length = 0; S.passes.length = 0; S.labels = {}; S.sample = null;
      S.c0 = window.__ix.renderer.info.calls; S.t0 = performance.now();
    });
    await fn();
    const s = await page.evaluate(() => {
      const S = window.__pb, R = window.__ix.renderer;
      const hist = {};
      for (const n of S.perFrame) hist[n] = (hist[n] || 0) + 1;
      const ms = [...S.passes].sort((a, b) => a - b);
      return {
        ms: Math.round(performance.now() - S.t0), frames: S.frames,
        infoCalls: R.info.calls - S.c0,
        callsPerFrame: S.frames ? +((R.info.calls - S.c0) / S.frames).toFixed(2) : null,
        hookedPasses: S.passes.length,
        perFrameHist: hist,
        passMs: { p50: ms.length ? +ms[Math.floor(ms.length / 2)].toFixed(2) : null, total: Math.round(ms.reduce((a, c) => a + c, 0)) },
        labels: Object.entries(S.labels).sort((a, c) => c[1] - a[1]).slice(0, 40),
        wrapped: S.wrapped,
        sample: S.sample || null,
      };
    });
    console.log('\n### ' + name + '\n' + JSON.stringify(s, null, 1));
  };

  await snap('DUNG YEN 3s', () => sleep(3000));
  await snap('XOAY CAMERA', async () => {
    await page.mouse.move(960, 540); await page.mouse.down({ button: 'right' });
    for (let i = 1; i <= 60; i += 1) await page.mouse.move(960 + i * 3, 540 + Math.sin(i / 7) * 25, { button: 'right' });
    await page.mouse.up({ button: 'right' }); await sleep(200);
  });
} finally { await browser.close(); }
