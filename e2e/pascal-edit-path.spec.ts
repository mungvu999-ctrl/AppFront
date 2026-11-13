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
const srcKey = (src: string | undefined) => String(src).split('?')[0];
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
      expect(edited[0]!.model!.id.replace(/~seen$/u, '')).toBe(modelB);
      expect(edited[0]!.model!.src).not.toMatch(/sig=/u);
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
      await card.locator('span.font-medium').first().click(); // rời ô nhập (phím tắt Pascal bỏ qua ô nhập)

      // 4 — Ctrl+Z: về cỡ trước; Ctrl+Z: về mẫu trước. Ctrl+Shift+Z ×2: lại như sau sửa.
      n = putStatus.length;
      await page.keyboard.press('Control+z');
      await expect.poll(async () => shownMm(await nodeOf(page, sofaId))[0]).toBe(size1[0]);
      expect((await nodeOf(page, sofaId))?.asset?.id).toBe(modelB);
      put = await nextSave(n, 'undo cỡ');
      expect(Math.abs(boxW(put.body.layer!.furniture.find((f) => f.id === wireId)!) - size1[0])).toBeLessThanOrEqual(2);
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
      expect(wireRedo.model?.id.replace(/~seen$/u, '')).toBe(modelB);
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
      expect(wireMove.model?.id.replace(/~seen$/u, '')).toBe(modelB);

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
});
