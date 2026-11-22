/**
 * Cờ `inputDragging` không được kẹt sau thao tác chuột thật (L7-03, chặn rủi ro của U83).
 *
 * U83 (`scripts/realism/u83-hover-outline-off-while-dragging.mjs`) tắt viền "rê chuột" khi
 * `cameraDragging || inputDragging`. Cờ `inputDragging` có hơn trăm chỗ đọc/ghi trong `vendor/pascal` + `src`
 * (bật khi kéo tay nắm tường, khi nhả cú kéo từ tường — `upstream/lib/drag-not-select.ts` …). Chỉ cần một đường
 * quên hạ cờ là viền rê chuột tắt mãi tới khi tải lại trang, và không bài nào khác thấy.
 *
 * Mỗi chu kỳ làm lần lượt bằng chuột/phím THẬT: kéo một món đồ, kéo từ giữa một bức tường (xoay camera, nhả trên
 * tường), kéo tay nắm đầu tường đang chọn, đo hai điểm bằng công cụ đo (phím M, Esc). Sau mỗi thao tác khẳng định cả
 * `inputDragging` lẫn `cameraDragging` đã về `false` — khi đó nhánh U83 gán `suppressSecondary = false` ở khung kế,
 * tức viền rê chuột trở lại. Số chu kỳ: `PASCAL_STUCK_CYCLES` (mặc định 20 — tiêu chí của L7-03 là 0 lần kẹt / 20).
 *
 * Đầu dò `?probe=1` chỉ ĐỌC cờ và lấy toạ độ màn hình (`screenOf`); `select` chỉ dùng để chọn bức tường trước khi kéo
 * tay nắm. Toạ độ đầu tường suy từ phép biến đổi affine (toạ độ tầng → màn hình) dựng từ ba món đồ đã biết vị trí, ở góc
 * nhìn từ trên xuống — xấp xỉ: trượt tay nắm thì cú kéo thành xoay camera, vẫn là một thao tác hợp lệ để kiểm cờ.
 */
import { expect, test } from '@playwright/test';
import type { Page } from '@playwright/test';

import { fixtureF1 } from '../src/lib/pascal/__fixtures__';

import { installFakeApi, type WireGraphDocument } from './fixtures/fakeApi';

const PROJECT_ID = 'P-FIXTURE0001';
const VIEWPORT = { width: 1440, height: 900 } as const;
const READY_TIMEOUT_MS = 150_000;
const CYCLES = Number(process.env.PASCAL_STUCK_CYCLES ?? 20);
/** Sau khi nhả chuột, chờ chừng này cho mọi `setTimeout(…, 0)`/rAF hạ cờ (drag-not-select hạ cờ sau một nhịp). */
const SETTLE_MS = 400;

type Vec3 = [number, number, number];
interface ProbeItem { id: string; position?: Vec3 }
interface ProbeWall { id: string; start: [number, number]; end: [number, number] }
interface Probe {
  ready(): boolean;
  counts(): Record<string, number>;
  items(): ProbeItem[];
  walls(): ProbeWall[];
  select(id: string): void;
  setCamera(pos: Vec3, target: Vec3, fov: number | 'top-ortho'): void;
  cameraDragging(): boolean | undefined;
  inputDragging(): boolean | undefined;
  screenOf(id: string): Promise<{ x: number; y: number } | null>;
}
interface ProbeWindow { __pascalProbe?: Probe }

const itemsOf = (page: Page) => page.evaluate(() => (window as unknown as ProbeWindow).__pascalProbe!.items());
const wallsOf = (page: Page) => page.evaluate(() => (window as unknown as ProbeWindow).__pascalProbe!.walls());
const screenOf = (page: Page, id: string) => page.evaluate((i) => (window as unknown as ProbeWindow).__pascalProbe!.screenOf(i), id);
const selectNode = (page: Page, id: string) => page.evaluate((i) => (window as unknown as ProbeWindow).__pascalProbe!.select(i), id);

const flags = (page: Page) =>
  page.evaluate(() => {
    const p = (window as unknown as ProbeWindow).__pascalProbe!;
    return { input: p.inputDragging() === true, camera: p.cameraDragging() === true };
  });

/** Affine 2D toạ độ tầng (x, z) → màn hình, giải từ ba điểm không thẳng hàng. */
type Affine = (x: number, z: number) => { x: number; y: number };
const solveAffine = (pairs: readonly { w: [number, number]; s: { x: number; y: number } }[]): Affine | null => {
  const [p, q, r] = pairs;
  if (!p || !q || !r) return null;
  const det = (q.w[0] - p.w[0]) * (r.w[1] - p.w[1]) - (r.w[0] - p.w[0]) * (q.w[1] - p.w[1]);
  if (Math.abs(det) < 1e-6) return null;
  const coef = (k: 'x' | 'y') => {
    const a = ((q.s[k] - p.s[k]) * (r.w[1] - p.w[1]) - (r.s[k] - p.s[k]) * (q.w[1] - p.w[1])) / det;
    const b = ((r.s[k] - p.s[k]) * (q.w[0] - p.w[0]) - (q.s[k] - p.s[k]) * (r.w[0] - p.w[0])) / det;
    return { a, b, c: p.s[k] - a * p.w[0] - b * p.w[1] };
  };
  const cx = coef('x');
  const cy = coef('y');
  return (x, z) => ({ x: cx.a * x + cx.b * z + cx.c, y: cy.a * x + cy.b * z + cy.c });
};

/** Số lần thấy cờ `inputDragging` BẬT giữa cú kéo — chứng cứ bài thật sự đi qua đường bật cờ (in ra, không chặn). */
const seenDuringDrag = { input: 0, drags: 0 };

async function pressDrag(page: Page, from: { x: number; y: number }, to: { x: number; y: number }, steps = 24): Promise<void> {
  await page.mouse.move(from.x, from.y);
  await page.mouse.down();
  await page.waitForTimeout(80);
  await page.mouse.move(to.x, to.y, { steps });
  await page.waitForTimeout(80);
  seenDuringDrag.drags += 1;
  if ((await flags(page)).input) seenDuringDrag.input += 1;
  await page.mouse.up();
}

test.describe('Cờ inputDragging không kẹt (U83)', () => {
  test.describe.configure({ timeout: 300_000 + CYCLES * 30_000 });

  test(`kéo đồ, kéo từ tường, kéo tay nắm, đo — ${CYCLES} chu kỳ, cờ luôn về false`, async ({ page }) => {
    await page.setViewportSize(VIEWPORT);
    await installFakeApi(page, { projectId: PROJECT_ID, graphDoc: fixtureF1({ ext: false }).doc as unknown as WireGraphDocument });
    await page.goto(`/editor3d.html?project=${PROJECT_ID}&probe=1`);
    await page.waitForFunction(
      () => {
        const p = (window as unknown as ProbeWindow).__pascalProbe;
        return p?.ready() === true && (p.counts()['wall'] ?? 0) > 0 && p.items().length >= 3;
      },
      null,
      { timeout: READY_TIMEOUT_MS },
    );

    // Nhìn thẳng từ trên xuống, khung đủ rộng cho cả tầng.
    const walls = await wallsOf(page);
    const xs = walls.flatMap((w) => [w.start[0], w.end[0]]);
    const zs = walls.flatMap((w) => [w.start[1], w.end[1]]);
    const cx = (Math.min(...xs) + Math.max(...xs)) / 2;
    const cz = (Math.min(...zs) + Math.max(...zs)) / 2;
    const extent = Math.max(Math.max(...xs) - Math.min(...xs), Math.max(...zs) - Math.min(...zs), 4);
    await page.evaluate(
      ([x, z, e]) => (window as unknown as ProbeWindow).__pascalProbe!.setCamera([x, e * 1.6, z + 0.01], [x, 0, z], 'top-ortho'),
      [cx, cz, extent] as const,
    );
    await page.waitForTimeout(2_000);

    // Ba món làm mốc affine + một món để kéo.
    const items = (await itemsOf(page)).filter((i) => i.position !== undefined);
    const pairs: { w: [number, number]; s: { x: number; y: number } }[] = [];
    for (const item of items) {
      const s = await screenOf(page, item.id);
      if (s !== null) pairs.push({ w: [item.position![0], item.position![2]], s });
      if (pairs.length >= 3) break;
    }
    const toScreen = solveAffine(pairs);
    console.log(`mốc affine: ${pairs.length} món; ${toScreen === null ? 'không giải được (bỏ kéo tay nắm)' : 'đã giải'}`);

    const dragItemId = items[0]!.id;
    const wall = [...walls].sort((a, b) => Math.hypot(b.end[0] - b.start[0], b.end[1] - b.start[1]) - Math.hypot(a.end[0] - a.start[0], a.end[1] - a.start[1]))[0]!;
    const stuck: string[] = [];
    const check = async (cycle: number, gesture: string) => {
      await page.waitForTimeout(SETTLE_MS);
      const f = await flags(page);
      if (f.input || f.camera) stuck.push(`chu kỳ ${cycle}, ${gesture}: inputDragging=${f.input} cameraDragging=${f.camera}`);
    };

    for (let cycle = 1; cycle <= CYCLES; cycle += 1) {
      // 1 — kéo một món đồ (bấm chọn rồi kéo; hướng đổi mỗi chu kỳ để món không trôi khỏi tầng).
      const at = await screenOf(page, dragItemId);
      if (at !== null) {
        const dx = cycle % 2 === 0 ? -40 : 40;
        await page.mouse.click(at.x, at.y);
        await pressDrag(page, at, { x: at.x + dx, y: at.y });
      }
      await check(cycle, 'kéo đồ');

      // 2 — kéo từ giữa bức tường dài nhất (xoay camera, nhả trên tường: drag-not-select bật cờ một nhịp).
      const mid = await screenOf(page, wall.id);
      if (mid !== null) await pressDrag(page, mid, { x: mid.x + 60, y: mid.y + 20 });
      await check(cycle, 'kéo từ tường');
      await page.evaluate(
        ([x, z, e]) => (window as unknown as ProbeWindow).__pascalProbe!.setCamera([x, e * 1.6, z + 0.01], [x, 0, z], 'top-ortho'),
        [cx, cz, extent] as const,
      );
      await page.waitForTimeout(300);

      // 3 — kéo tay nắm đầu tường đang chọn (đi rồi về, để tường giữ nguyên chiều dài qua các chu kỳ).
      if (toScreen !== null) {
        await selectNode(page, wall.id);
        await page.waitForTimeout(300);
        const end = toScreen(wall.end[0], wall.end[1]);
        const out = { x: end.x + 25, y: end.y + 25 };
        await pressDrag(page, end, out, 16);
        await check(cycle, 'kéo tay nắm tường (đi)');
        await pressDrag(page, out, end, 16);
        await check(cycle, 'kéo tay nắm tường (về)');
        await page.keyboard.press('Escape');
      }

      // 4 — đo hai điểm (phím M bật công cụ đo, Esc tắt).
      await page.keyboard.press('m');
      await page.mouse.click(VIEWPORT.width * 0.4, VIEWPORT.height * 0.5);
      await page.mouse.click(VIEWPORT.width * 0.6, VIEWPORT.height * 0.5);
      await page.keyboard.press('Escape');
      await page.keyboard.press('Escape');
      await check(cycle, 'đo');
    }

    console.log(`cờ inputDragging bật giữa cú kéo: ${seenDuringDrag.input}/${seenDuringDrag.drags} cú kéo`);
    expect(stuck, 'cờ kéo phải về false sau mỗi thao tác').toEqual([]);
  });
});
