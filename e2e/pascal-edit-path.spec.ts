/**
 * Đường chỉnh sửa THẬT trên trang 3D Pascal (vòng 18, làn LE): chuột/phím thật, máy chủ giả có PUT thật (`installFakeApi`:
 * PUT lớp tầng kiểm schema + baseVersion, GET trả dữ liệu đã lưu → reload đọc lại thật).
 *
 * Ca: (1) mở trang không PUT; (2) click chuột vào sofa trong canvas → "Đổi mẫu" → mẫu khác → PUT có model.id mới, anh em giữ
 * mẫu; (3) co giãn bằng ô mm của thẻ món + dời bằng chuột (menu chuột phải "Di chuyển") → PUT ghi cỡ/vị trí; (4) Ctrl+Z /
 * Ctrl+Shift+Z → cảnh và PUT về trước / lại sau; (5) reload → cùng mẫu, cỡ/vị trí ±2 mm, anh em như trước, không PUT;
 * (6) món AI khác không bị ghi (không model, hộp không đổi).
 * Đầu dò `?probe=1` chỉ ĐỌC trạng thái và lấy toạ độ màn hình (`screenOf`); `select` chỉ là dự phòng khi click trượt
 * (SwiftShader) và được ghi ra log.
 */
import { expect, test } from '@playwright/test';
import type { Page } from '@playwright/test';

import { fixtureF1 } from '../src/lib/pascal/__fixtures__';

import { installFakeApi, type WireGraphDocument } from './fixtures/fakeApi';
import { CONCEPT_CLOSET, CONCEPT_FOLDER, conceptState, DEFAULT_CLOSET_FILE } from './fixtures/stabilityLibrary';

const PROJECT_ID = 'P-FIXTURE0001';
const VIEWPORT = { width: 1440, height: 900 } as const;
const READY_TIMEOUT_MS = 150_000;
const SAVE_TIMEOUT_MS = 30_000;
/** Chờ sau khi cảnh sẵn sàng để chắc không có lượt lưu trễ nào chỉ vì mở. */
const IDLE_AFTER_OPEN_MS = 8_000;

/** Ba mẫu sofa THẬT trong `libraryRoles.json` (vai sofa), cỡ gần thật; GLB đóng gói `sofa`, URL ký khác nhau. */
const SOFAS = [
  { id: 'sofa-ash-grey-3-seater-pillows', widthMm: 2100, depthMm: 900, heightMm: 850 },
  { id: 'sofa-ash-grey-loveseat-pillows', widthMm: 1500, depthMm: 880, heightMm: 850 },
  { id: 'sofa-beige-3-seater-slim-legs', widthMm: 1950, depthMm: 850, heightMm: 800 },
] as const;
const SOFA_URL = /\/pascal\/items\/sofa\/model\.glb\?sig=/u;

const libraryBody = (requestUrl: string): unknown[] =>
  SOFAS.map((sofa, index) => ({
    ...sofa,
    fileSizeBytes: 10_000 + index,
    group: 'sofa',
    modelUrl: new URL(`/pascal/items/sofa/model.glb?sig=${index + 1}`, requestUrl).href,
    name: `Sofa thử ${index + 1}`,
    source: 'catalogue',
    triangleCount: 1_000 + index,
  }));

type Vec3 = [number, number, number];
interface ProbeItem { id: string; src?: string; position?: Vec3; assetScale?: Vec3; dimensions?: Vec3 }
interface ProbeNode { asset?: { id?: string; src?: string; dimensions?: Vec3 }; scale?: Vec3; position?: Vec3 }
interface Probe {
  ready(): boolean;
  counts(): Record<string, number>;
  items(): ProbeItem[];
  node(id: string): ProbeNode | null;
  select(id: string): void;
  cameraDragging(): boolean | undefined;
  screenOf(id: string): Promise<{ x: number; y: number } | null>;
}
interface ProbeWindow { __pascalProbe?: Probe }
interface WireFurniture { id: string; model?: { id: string; src: string }; boundingBox: { min: { x: number; y: number }; max: { x: number; y: number } }; heightMm?: number; centre?: { x: number; y: number } }
interface PutBody { baseVersion: number; body: { layer?: { furniture: WireFurniture[] } } }

const f1Ext = fixtureF1({ ext: true }).doc as unknown as WireGraphDocument;
const originalFurniture = new Map((f1Ext.graph.furniture as unknown as WireFurniture[]).map((f) => [f.id, f]));

const itemsOf = (page: Page) => page.evaluate(() => (window as unknown as ProbeWindow).__pascalProbe!.items());
const nodeOf = (page: Page, id: string) => page.evaluate((i) => (window as unknown as ProbeWindow).__pascalProbe!.node(i), id);
const screenOf = (page: Page, id: string) => page.evaluate((i) => (window as unknown as ProbeWindow).__pascalProbe!.screenOf(i), id);
const selectFallback = (page: Page, id: string) => page.evaluate((i) => (window as unknown as ProbeWindow).__pascalProbe!.select(i), id);

const waitBuilt = (page: Page) =>
  page.waitForFunction(
    () => {
      const probe = (window as unknown as ProbeWindow).__pascalProbe;
      return probe?.ready() === true && (probe.counts()['wall'] ?? 0) > 0 && probe.items().length > 0;
    },
    null,
    { timeout: READY_TIMEOUT_MS },
  );

/** Cỡ đang thấy (mm) = asset.dimensions × scale. */
const shownMm = (n: ProbeNode | null): Vec3 => {
  const d = n?.asset?.dimensions ?? [0, 0, 0];
  const s = n?.scale ?? [1, 1, 1];
  return [0, 1, 2].map((k) => Math.round(d[k]! * s[k]! * 1000)) as Vec3;
};
const srcKey = (src: string | undefined) => String(src).split('?')[0] ?? '';
const srcMap = (items: ProbeItem[]) => Object.fromEntries(items.map((i) => [i.id, `${srcKey(i.src)}|${(i.src ?? '').match(/sig=\d+/u)?.[0] ?? ''}`]));

test.describe('Đường chỉnh sửa thật trang 3D', () => {
  test.describe.configure({ timeout: 420_000 });

  test('đổi mẫu → co giãn → dời → undo/redo → lưu → tải lại', async ({ browser }) => {
    const page = await browser.newPage({ viewport: VIEWPORT });
    const backend = await installFakeApi(page, { projectId: PROJECT_ID, graphDoc: f1Ext });
    await page.route((url) => url.pathname === '/api/library', (route) => route.fulfill({ status: 200, json: libraryBody(route.request().url()) }));
    const putStatus: number[] = [];
    const writes: string[] = [];
    page.on('request', (r) => {
      const { pathname } = new URL(r.url());
      if (pathname.startsWith('/api/') && !pathname.startsWith('/api/auth/') && r.method() !== 'GET') writes.push(`${r.method()} ${pathname}`);
    });
    page.on('response', (r) => {
      if (r.request().method() === 'PUT' && new URL(r.url()).pathname.endsWith('/spatial/layer')) putStatus.push(r.status());
    });
    const lastPut = () => backend.puts.at(-1) as PutBody;
    /** Chờ có PUT mới (sau mốc `n`) đã trả 200, rồi lặng 1,5 s (gộp loạt ghi); trả thân PUT cuối. */
    const nextSave = async (n: number, why: string): Promise<PutBody> => {
      await expect.poll(() => putStatus.length, { timeout: SAVE_TIMEOUT_MS, message: `chờ PUT: ${why}` }).toBeGreaterThan(n);
      let seen = -1;
      await expect.poll(() => { const same = seen === putStatus.length; seen = putStatus.length; return same; }, { timeout: SAVE_TIMEOUT_MS, intervals: [1_500] }).toBe(true);
      expect(putStatus.slice(n), why).toEqual(putStatus.slice(n).map(() => 200));
      return lastPut();
    };
    const usedSelectFallback: string[] = [];

    try {
      // 1 — mở trang: không PUT nào.
      await page.goto(`/editor3d.html?project=${PROJECT_ID}&probe=1`);
      await waitBuilt(page);
      await page.waitForTimeout(IDLE_AFTER_OPEN_MS);
      expect(writes, 'mở trang không được ghi').toEqual([]);

      const items0 = await itemsOf(page);
      const sofas = items0.filter((i) => SOFA_URL.test(i.src ?? ''));
      expect(sofas.length, JSON.stringify(items0.map((i) => i.src))).toBe(1);
      const sofaId = sofas[0]!.id;
      const src0 = srcMap(items0);
      const modelA = (await nodeOf(page, sofaId))!.asset!.src!.match(/sig=(\d+)/u)![1]!;

      // 2 — click chuột thật vào sofa trong canvas.
      const swap = page.getByTestId('swap-model');
      const at = await screenOf(page, sofaId);
      console.log(`sofa ${sofaId} mẫu sig=${modelA} tại màn hình ${JSON.stringify(at)}`);
      expect(at, 'screenOf phải ra toạ độ').not.toBeNull();
      await page.mouse.click(at!.x, at!.y);
      if (!(await swap.isVisible().catch(() => false))) await swap.waitFor({ state: 'visible', timeout: 10_000 }).catch(() => {});
      if (!(await swap.isVisible())) {
        usedSelectFallback.push('chọn sofa');
        await selectFallback(page, sofaId);
      }
      await expect(swap).toBeVisible({ timeout: 10_000 });
      console.log(`đường chọn: ${usedSelectFallback.length === 0 ? 'click chuột thật' : 'DỰ PHÒNG select()'}`);
      await swap.click();
      const option = page.locator('[data-testid="swap-model-option"]:not([disabled])').first();
      await expect(option).toBeVisible();
      const modelB = (await option.getAttribute('data-model-id'))!;
      expect(SOFAS.map((s) => s.id)).toContain(modelB);
      let n = putStatus.length;
      await option.click();
      await expect.poll(async () => (await nodeOf(page, sofaId))?.asset?.id).toBe(modelB);
      let put = await nextSave(n, 'đổi mẫu');
      const edited = put.body.layer!.furniture.filter((f) => f.model !== undefined);
      expect(edited.length, 'chỉ món đã đổi có model').toBe(1);
      const wireId = edited[0]!.id;
      // LF2: chỉ đổi mẫu → model.id + '~seen' (không '~fit'), hộp/cao/góc giữ đúng bản gốc (đầu vào bộ chọn không đổi).
      expect(edited[0]!.model!.id).toBe(`${modelB}~seen`);
      expect(edited[0]!.model!.src).not.toMatch(/sig=/u);
      const orig = originalFurniture.get(wireId)!;
      expect(edited[0]!.boundingBox, 'đổi mẫu không đổi hộp').toEqual(orig.boundingBox);
      expect(edited[0]!.heightMm, 'đổi mẫu không ghi heightMm').toBe(orig.heightMm);
      const siblingsKept = async () => {
        const now = srcMap(await itemsOf(page));
        return Object.keys(src0).filter((id) => id !== sofaId && now[id] !== src0[id]);
      };
      expect(await siblingsKept(), 'món khác giữ mẫu').toEqual([]);
      const afterSwap = await nodeOf(page, sofaId);
      const size1 = shownMm(afterSwap);

      // 3a — co giãn: ô Dài (mm) của thẻ món, +300 mm (giữ tỉ lệ mặc định).
      const card = page.locator('[data-appfront-homeowner-card]');
      const lengthInput = card.getByLabel('Dài (mm)');
      await expect(lengthInput).toBeVisible();
      const wantMm = size1[0] + 300;
      n = putStatus.length;
      await lengthInput.fill(String(wantMm));
      await lengthInput.press('Enter');
      await expect.poll(async () => shownMm(await nodeOf(page, sofaId))[0]).toBe(wantMm);
      const size2 = shownMm(await nodeOf(page, sofaId));
      put = await nextSave(n, 'co giãn');
      const wire2 = put.body.layer!.furniture.find((f) => f.id === wireId)!;
      const boxW = (f: WireFurniture) => f.boundingBox.max.x - f.boundingBox.min.x;
      expect(Math.abs(boxW(wire2) - size2[0]), `hộp PUT ${boxW(wire2)} vs thấy ${size2[0]}`).toBeLessThanOrEqual(2);
      expect(Math.abs((wire2.heightMm ?? 0) - size2[1])).toBeLessThanOrEqual(2);
      expect(wire2.model?.id, 'co giãn: hộp lưu = cỡ đang thấy').toBe(`${modelB}~fit~seen`);
      await card.locator('span.font-medium').first().click(); // rời ô nhập (phím tắt Pascal bỏ qua ô nhập)

      // 4 — Ctrl+Z: về cỡ trước; Ctrl+Z: về mẫu trước. Ctrl+Shift+Z ×2: lại như sau sửa.
      n = putStatus.length;
      await page.keyboard.press('Control+z');
      await expect.poll(async () => shownMm(await nodeOf(page, sofaId))[0]).toBe(size1[0]);
      expect((await nodeOf(page, sofaId))?.asset?.id).toBe(modelB);
      put = await nextSave(n, 'undo cỡ');
      // LF2: về "chỉ đổi mẫu" → hộp đã lưu = hộp gốc (cỡ thấy = userModelFitOf(hộp gốc, mẫu B) = size1).
      const wireUndo = put.body.layer!.furniture.find((f) => f.id === wireId)!;
      expect(wireUndo.boundingBox).toEqual(originalFurniture.get(wireId)!.boundingBox);
      expect(wireUndo.model?.id).toBe(`${modelB}~seen`);
      n = putStatus.length;
      await page.keyboard.press('Control+z');
      await expect.poll(async () => (await nodeOf(page, sofaId))?.asset?.src?.match(/sig=(\d+)/u)?.[1]).toBe(modelA);
      put = await nextSave(n, 'undo đổi mẫu');
      expect(put.body.layer!.furniture.find((f) => f.id === wireId)!.model, 'undo đổi mẫu: không còn model').toBeUndefined();
      n = putStatus.length;
      await page.keyboard.press('Control+Shift+z');
      await expect.poll(async () => (await nodeOf(page, sofaId))?.asset?.id).toBe(modelB);
      await page.keyboard.press('Control+Shift+z');
      await expect.poll(async () => shownMm(await nodeOf(page, sofaId))[0]).toBe(size2[0]);
      put = await nextSave(n, 'redo');
      const wireRedo = put.body.layer!.furniture.find((f) => f.id === wireId)!;
      expect(wireRedo.model?.id).toBe(`${modelB}~fit~seen`);
      expect(Math.abs(boxW(wireRedo) - size2[0])).toBeLessThanOrEqual(2);

      // 3b — dời: inspector Pascal của trang không có ô số vị trí → chuột phải lên sofa → "Di chuyển" → rê chuột tới sàn trống →
      // bấm đặt. Đỏ nếu không ghi (lỗi M18: cờ cameraDragging kẹt sau cú chuột phải nuốt grid:click — runMenuAction).
      const before = (await nodeOf(page, sofaId))!;
      const p0 = (await screenOf(page, sofaId))!;
      n = putStatus.length;
      await page.mouse.click(p0.x, p0.y, { button: 'right' });
      const moveItem = page.getByRole('menuitem', { name: 'Di chuyển' });
      await expect(moveItem).toBeVisible({ timeout: 10_000 });
      await moveItem.click();
      await page.waitForTimeout(500);
      const to = { x: p0.x + 50, y: p0.y + 135 };
      for (let k = 1; k <= 15; k += 1) {
        await page.mouse.move(p0.x + ((to.x - p0.x) * k) / 15, p0.y + ((to.y - p0.y) * k) / 15);
        await page.waitForTimeout(40);
      }
      await page.waitForTimeout(500);
      await page.mouse.click(to.x, to.y);
      const planShift = async () => {
        const q = (await nodeOf(page, sofaId))!.position!;
        return Math.hypot(q[0] - before.position![0], q[2] - before.position![2]);
      };
      await expect.poll(planShift, { timeout: 10_000, message: 'dời bằng chuột phải ghi position' }).toBeGreaterThan(0.02);
      const afterMove = (await nodeOf(page, sofaId))!;
      put = await nextSave(n, 'dời');
      const wireMove = put.body.layer!.furniture.find((f) => f.id === wireId)!;
      const cx = (f: WireFurniture) => (f.boundingBox.max.x + f.boundingBox.min.x) / 2;
      const cy = (f: WireFurniture) => (f.boundingBox.max.y + f.boundingBox.min.y) / 2;
      const dMm = Math.hypot(cx(wireMove) - cx(wireRedo), cy(wireMove) - cy(wireRedo));
      const dScene = Math.hypot(afterMove.position![0] - before.position![0], afterMove.position![2] - before.position![2]) * 1000;
      console.log(`dời: cảnh ${dScene.toFixed(1)} mm, PUT ${dMm.toFixed(1)} mm`);
      expect(Math.abs(dMm - dScene)).toBeLessThanOrEqual(2);
      expect(wireMove.model?.id).toBe(`${modelB}~fit~seen`);

      // 6 — món AI khác: không model, hộp như bản gốc.
      const others = put.body.layer!.furniture.filter((f) => f.id !== wireId);
      expect(others.filter((f) => f.model !== undefined).map((f) => f.id)).toEqual([]);
      const boxChanged = others.filter((f) => {
        const o = originalFurniture.get(f.id);
        return o !== undefined && JSON.stringify(o.boundingBox) !== JSON.stringify(f.boundingBox);
      });
      expect(boxChanged.map((f) => f.id), 'món chưa sửa không đổi hộp').toEqual([]);
      expect(await siblingsKept(), 'món khác giữ mẫu sau sửa').toEqual([]);

      // 5 — reload: cùng mẫu, cỡ/vị trí ±2 mm, anh em như trước, không PUT khi mở lại.
      const keepSize = shownMm(afterMove);
      const srcBefore = srcMap(await itemsOf(page));
      n = putStatus.length;
      const writesBefore = writes.length;
      await page.reload();
      await waitBuilt(page);
      await page.waitForTimeout(IDLE_AFTER_OPEN_MS);
      expect(writes.slice(writesBefore), 'mở lại không được ghi').toEqual([]);
      const reloaded = (await nodeOf(page, sofaId))!;
      expect(reloaded.asset?.id).toBe(modelB);
      const sizeR = shownMm(reloaded);
      console.log(`cỡ trước reload ${keepSize.join('×')} · sau ${sizeR.join('×')} · vị trí ${afterMove.position} → ${reloaded.position}`);
      for (const k of [0, 1, 2]) expect(Math.abs(sizeR[k]! - keepSize[k]!), `trục ${k}`).toBeLessThanOrEqual(2);
      for (const k of [0, 2]) expect(Math.abs(reloaded.position![k]! - afterMove.position![k]!) * 1000, `vị trí trục ${k}`).toBeLessThanOrEqual(2);
      const srcAfter = srcMap(await itemsOf(page));
      const drift = Object.keys(srcBefore).filter((id) => id !== sofaId && srcAfter[id] !== srcBefore[id]);
      expect(drift, 'món khác cùng mẫu như trước reload').toEqual([]);
      expect(putStatus.length).toBe(n);
      console.log(`xong: ${backend.puts.length} PUT · dự phòng select: ${usedSelectFallback.join(',') || 'không'}`);
    } finally {
      await page.context().close();
    }
  });

  /*
   * Vòng 18 (làn LE2) — NHẬN ĐỀ XUẤT + MẪU GHIM: người dùng đổi mẫu + co giãn sofa (ghim: Furniture.model) → menu "Xem" →
   * "AI đề xuất cho căn này" (DesignConceptList.choose: N48 → done → saveNow → flushAutosaves → reload) → sau tải lại:
   * sofa giữ mẫu + cỡ người dùng dù concept ưu tiên sofa KHÁC; tủ áo (AI, chưa xác nhận) theo concept; mở lại không ghi;
   * Ctrl+Z / Ctrl+Shift+Z sau tải lại không đổi gì, không ghi. N47/N48 giả ngay trong spec (không gọi API thật).
   */
  test('đổi mẫu (ghim) → AI đề xuất cho căn này → tải lại: ghim giữ, món AI theo concept', async ({ browser }) => {
    const page = await browser.newPage({ viewport: VIEWPORT });
    const backend = await installFakeApi(page, { projectId: PROJECT_ID, graphDoc: f1Ext });
    const closetEntry = (requestUrl: string) => ({
      ...CONCEPT_CLOSET,
      fileSizeBytes: 20_000,
      group: 'storage',
      modelUrl: new URL(`/pascal/items/${CONCEPT_FOLDER}/model.glb`, requestUrl).href,
      name: 'Tủ áo thử',
      source: 'catalogue',
      triangleCount: 2_000,
    });
    await page.route(
      (url) => url.pathname === '/api/library',
      (route) => route.fulfill({ status: 200, json: [...libraryBody(route.request().url()), closetEntry(route.request().url())] }),
    );
    // N47/N48 giả: trước khi bấm = bật, chưa có lượt; POST = lượt AI-tự-chọn xong ngay; sau đó GET trả lượt đó.
    const done = conceptState() as { enabled: boolean; suggestedStyleId: string; active: { suggested: boolean; result: { models: Record<string, string> } } };
    done.active.suggested = true;
    let accepted = false;
    const conceptCalls: string[] = [];
    await page.route(
      (url) => url.pathname.endsWith('/design-concept'),
      (route) => {
        const method = route.request().method();
        conceptCalls.push(method);
        if (method === 'POST') {
          accepted = true;
          return route.fulfill({ status: 200, json: done.active });
        }
        return route.fulfill({ status: 200, json: accepted ? done : { enabled: true, suggestedStyleId: done.suggestedStyleId } });
      },
    );
    const putStatus: number[] = [];
    const writes: string[] = [];
    page.on('request', (r) => {
      const { pathname } = new URL(r.url());
      if (pathname.startsWith('/api/') && !pathname.startsWith('/api/auth/') && r.method() !== 'GET') writes.push(`${r.method()} ${pathname}`);
    });
    page.on('response', (r) => {
      if (r.request().method() === 'PUT' && new URL(r.url()).pathname.endsWith('/spatial/layer')) putStatus.push(r.status());
    });
    const nextSave = async (n: number, why: string): Promise<PutBody> => {
      await expect.poll(() => putStatus.length, { timeout: SAVE_TIMEOUT_MS, message: `chờ PUT: ${why}` }).toBeGreaterThan(n);
      let seen = -1;
      await expect.poll(() => { const same = seen === putStatus.length; seen = putStatus.length; return same; }, { timeout: SAVE_TIMEOUT_MS, intervals: [1_500] }).toBe(true);
      expect(putStatus.slice(n), why).toEqual(putStatus.slice(n).map(() => 200));
      return backend.puts.at(-1) as PutBody;
    };
    const conceptOf = () => page.evaluate(() => (window as unknown as { __pascalProbe: { sceneState(): { concept?: string } } }).__pascalProbe.sceneState().concept);
    const usedSelectFallback: string[] = [];

    try {
      // 1 — mở trang: concept bật nhưng chưa có lượt → không áp; 0 lượt ghi.
      await page.goto(`/editor3d.html?project=${PROJECT_ID}&probe=1`);
      await waitBuilt(page);
      await page.waitForTimeout(IDLE_AFTER_OPEN_MS);
      expect(writes, 'mở trang không được ghi').toEqual([]);
      expect(await conceptOf()).toBe('none');
      const items0 = await itemsOf(page);
      const sofaId = items0.find((i) => SOFA_URL.test(i.src ?? ''))!.id;
      const closetIds = items0.filter((i) => srcKey(i.src).includes(DEFAULT_CLOSET_FILE)).map((i) => i.id);
      console.log(`mở: sofa ${sofaId} · tủ áo mặc định ${closetIds.join(',')} · concept ${await conceptOf()}`);
      expect(closetIds.length, JSON.stringify(items0.map((i) => i.src))).toBeGreaterThan(0);

      // 2 — click chuột thật vào sofa → "Đổi mẫu" → mẫu B (ghim).
      const swap = page.getByTestId('swap-model');
      const at = await screenOf(page, sofaId);
      expect(at, 'screenOf phải ra toạ độ').not.toBeNull();
      await page.mouse.click(at!.x, at!.y);
      await swap.waitFor({ state: 'visible', timeout: 10_000 }).catch(() => {});
      if (!(await swap.isVisible())) {
        usedSelectFallback.push('chọn sofa');
        await selectFallback(page, sofaId);
      }
      await expect(swap).toBeVisible({ timeout: 10_000 });
      console.log(`đường chọn: ${usedSelectFallback.length === 0 ? 'click chuột thật' : 'DỰ PHÒNG select()'}`);
      await swap.click();
      const option = page.locator('[data-testid="swap-model-option"]:not([disabled])').first();
      await expect(option).toBeVisible();
      const modelB = (await option.getAttribute('data-model-id'))!;
      // Concept ưu tiên một sofa KHÁC B: ghim phải thắng.
      const conceptSofa = SOFAS.map((s) => s.id).find((id) => id !== modelB)!;
      done.active.result.models['sofa'] = conceptSofa;
      let n = putStatus.length;
      await option.click();
      await expect.poll(async () => (await nodeOf(page, sofaId))?.asset?.id).toBe(modelB);
      await nextSave(n, 'đổi mẫu');

      // 3 — co giãn bằng ô Dài (mm): +300 mm → cỡ người dùng.
      const card = page.locator('[data-appfront-homeowner-card]');
      const lengthInput = card.getByLabel('Dài (mm)');
      await expect(lengthInput).toBeVisible();
      const wantMm = shownMm(await nodeOf(page, sofaId))[0] + 300;
      n = putStatus.length;
      await lengthInput.fill(String(wantMm));
      await lengthInput.press('Enter');
      await expect.poll(async () => shownMm(await nodeOf(page, sofaId))[0]).toBe(wantMm);
      const userSize = shownMm(await nodeOf(page, sofaId));
      const putUser = await nextSave(n, 'co giãn');
      const wireId = putUser.body.layer!.furniture.find((f) => f.model !== undefined)!.id;
      expect(putUser.body.layer!.furniture.find((f) => f.id === wireId)!.model?.id).toBe(`${modelB}~fit~seen`);
      await card.locator('span.font-medium').first().click(); // rời ô nhập

      // 4 — menu "Xem" → "AI đề xuất cho căn này" → N48 → lưu → xả → trang tự tải lại.
      const writesBefore = writes.length;
      n = putStatus.length;
      await page.locator('summary[aria-label^="Xem"]').click();
      const suggest = page.getByRole('button', { name: /^AI đề xuất cho căn này/u });
      await expect(suggest).toBeVisible();
      const reloaded = page.waitForEvent('load', { timeout: 60_000 });
      await suggest.click();
      await reloaded;
      const acceptWrites = writes.slice(writesBefore);
      const acceptPuts = backend.puts.slice(n) as PutBody[];
      console.log(`nhận đề xuất: ghi ${JSON.stringify(acceptWrites)} · concept gọi ${conceptCalls.join(',')} · concept ưu tiên sofa ${conceptSofa}`);
      expect(acceptWrites.filter((w) => !w.endsWith('/design-concept') && !w.endsWith('/spatial/layer')), 'nhận đề xuất chỉ ghi N48 + lớp tầng').toEqual([]);
      expect(putStatus.slice(n), 'lượt lưu trước tải lại 200').toEqual(putStatus.slice(n).map(() => 200));
      for (const p of acceptPuts) {
        const pinned = p.body.layer!.furniture.find((f) => f.id === wireId)!;
        expect(pinned.model?.id, 'lượt lưu lúc nhận đề xuất giữ ghim').toBe(`${modelB}~fit~seen`);
        expect(p.body.layer!.furniture.filter((f) => f.id !== wireId && f.model !== undefined).map((f) => f.id)).toEqual([]);
      }

      // 5 — sau tải lại: concept áp; 0 lượt ghi khi mở; ghim giữ mẫu + cỡ; tủ áo AI theo concept.
      const writesAfterLoad = writes.length;
      const putsAfterLoad = putStatus.length;
      await waitBuilt(page);
      await page.waitForTimeout(IDLE_AFTER_OPEN_MS);
      expect(writes.slice(writesAfterLoad), 'mở lại sau nhận đề xuất không được ghi').toEqual([]);
      expect(await conceptOf()).toBe('done');
      const pinnedNode = (await nodeOf(page, sofaId))!;
      const sizeR = shownMm(pinnedNode);
      console.log(`ghim: mẫu ${pinnedNode.asset?.id} (concept muốn ${conceptSofa}) · cỡ ${userSize.join('×')} → ${sizeR.join('×')}`);
      expect(pinnedNode.asset?.id, 'concept không đè mẫu người dùng').toBe(modelB);
      for (const k of [0, 1, 2]) expect(Math.abs(sizeR[k]! - userSize[k]!), `cỡ ghim trục ${k}`).toBeLessThanOrEqual(2);
      const items1 = await itemsOf(page);
      const closetsNow = closetIds.map((id) => `${id}|${srcKey(items1.find((i) => i.id === id)?.src)}`);
      console.log(`tủ áo sau concept: ${closetsNow.join(', ')}`);
      for (const id of closetIds) expect(srcKey(items1.find((i) => i.id === id)?.src), `tủ áo ${id} theo concept`).toContain(`/${CONCEPT_FOLDER}/`);

      // 6 — Ctrl+Z / Ctrl+Shift+Z sau tải lại: lịch sử phiên trước không quay lại, không ghi.
      const stateNow = async () => ({ src: srcMap(await itemsOf(page)), sofa: shownMm(await nodeOf(page, sofaId)), asset: (await nodeOf(page, sofaId))?.asset?.id });
      const s0 = await stateNow();
      for (const key of ['Control+z', 'Control+Shift+z']) {
        await page.keyboard.press(key);
        await page.waitForTimeout(3_000);
        expect(await stateNow(), `${key} sau tải lại không đổi cảnh`).toEqual(s0);
      }
      expect(writes.slice(writesAfterLoad), 'undo/redo sau tải lại không ghi').toEqual([]);
      expect(putStatus.length).toBe(putsAfterLoad);
      console.log(`xong: ${backend.puts.length} PUT · dự phòng select: ${usedSelectFallback.join(',') || 'không'}`);
    } finally {
      await page.context().close();
    }
  });
});
