import { expect, test } from '@playwright/test';
import type { Page, Worker } from '@playwright/test';

import { fixtureF1 } from '../src/lib/pascal/__fixtures__';

import { installFakeApi, type WireGraphDocument } from './fixtures/fakeApi';
import {
  findOffMachineRequests,
  serveDocumentsWithCsp,
  trackBadAssetResponses,
  trackRequestUrls,
} from './fixtures/pascalGuards';
import { ROUTE_PATTERNS } from './fixtures/routes';
import { EMAIL_BY_ROLE, submitSignInForm } from './fixtures/session';

/**
 * Trang 3D Pascal — mắt xích trình duyệt thật của cả đợt tích hợp Pascal.
 *
 * Từ 29eba219 (2026-10-18) `/projects/:id/3d` không còn dựng khung Pascal nhúng
 * (`PascalViewer`, vùng "Mô hình 3D", nút thu khung, gói vách ngăn `pascal-mount.js`):
 * nó chuyển CẢ TRANG sang tài liệu riêng `public/editor3d.html?project=…`
 * (`src/routes/viewerRedirects.tsx` › `Pascal3dPage`). Trang ấy không đi qua bộ giả lập
 * của app, nên các bài dựng cảnh dùng máy chủ giả `installFakeApi` (cùng khuôn
 * `pascal-fixtures.spec.ts`).
 *
 * ## Bài này chứng minh gì
 * 1. Đăng nhập rồi vào `/3d` thì trình duyệt sang `editor3d.html` của đúng dự án.
 * 2. Trang dựng ra một `<canvas>` THẬT: kích thước thật, chiếm phần lớn cửa sổ, khung
 *    hình có hình học (PNG không nén xuống như một mảng màu trơn).
 * 3. Suốt lượt dựng không request nào rời máy (`editor.pascal.app`, `cdn.jsdelivr.net`)
 *    và không tệp tự host nào hỏng.
 * 4. Dưới CSP của nginx, bộ giải Basis thật sự khởi động trong worker (FIX-380).
 *
 * ## Không chứng minh
 * - Chất lượng hình, hiệu năng (xem `pascal-perf.spec.ts`), số node (xem `pascal-fixtures.spec.ts`).
 * - Lưu: `pascal-evidence.spec.ts` (qua giao diện) và `pascal-fixtures.spec.ts` C13 (qua đầu dò).
 */

const PROJECT_ID = 'P-FIXTURE0001';
const VIEWPORT = { width: 1440, height: 900 } as const;
const RENDER_TIMEOUT_MS = 90_000;
const HEAVY_TEST_TIMEOUT_MS = 150_000;
/** Canvas một màu nén PNG xuống vài trăm byte đến 2 KiB; cảnh thật lớn hơn nhiều. */
const FRAME_MIN_PNG_BYTES = 8_000;
const WORKER_PROBE_TIMEOUT_MS = 2_000;
/**
 * Worker KTX2 của three nạp `basis_transcoder.js` bằng `importScripts`: hàm nhà máy `BASIS` có
 * trên `self` (thể hiện `BasisModule` nằm trong bao đóng, không dò được). Cùng với lượt `.wasm`
 * về đủ và 0 vi phạm CSP, đó là bằng chứng bộ giải đã chạy dưới CSP (FIX-380).
 */
const BASIS_READY_PROBE = "typeof BASIS === 'function'";

/** Mở trang 3D với bộ F1 qua máy chủ giả, chờ đầu dò báo cảnh đã có tường. */
async function openEditor3d(page: Page): Promise<{ unexpected: string[] }> {
  await page.setViewportSize(VIEWPORT);
  const api = await installFakeApi(page, {
    projectId: PROJECT_ID,
    graphDoc: fixtureF1({ ext: false }).doc as unknown as WireGraphDocument,
  });
  await page.goto(`/editor3d.html?project=${PROJECT_ID}&probe=1`);
  /* `expect.poll` + `evaluate` chứ không `waitForFunction`: bài "dưới CSP" cấm `unsafe-eval`. */
  await expect
    .poll(
      () =>
        page.evaluate(() => {
          const probe = (window as unknown as { __pascalProbe?: { ready(): boolean; counts(): Record<string, number> } }).__pascalProbe;
          return probe?.ready() === true && (probe.counts()['wall'] ?? 0) > 0;
        }),
      { timeout: RENDER_TIMEOUT_MS, message: 'đầu dò chưa báo cảnh có tường' },
    )
    .toBe(true);
  return api;
}

test('đăng nhập rồi vào /3d thì sang trang Pascal riêng của đúng dự án', async ({ page }) => {
  const viewerPath = ROUTE_PATTERNS.projectViewer.replace(':projectId', 'P-01');
  await page.setViewportSize(VIEWPORT);
  await page.goto(`${ROUTE_PATTERNS.login}?next=${encodeURIComponent(viewerPath)}`);
  await submitSignInForm(page, EMAIL_BY_ROLE.engineer);

  await expect.poll(() => new URL(page.url()).pathname, { timeout: 30_000 }).toBe('/editor3d.html');
  expect(new URL(page.url()).searchParams.get('project')).toBe('P-01');
});

test('trang 3D dựng ra một cảnh thật chiếm phần lớn cửa sổ, không request nào rời máy (việc 2+3+4, B-V10-02)', async ({
  page,
}) => {
  test.setTimeout(HEAVY_TEST_TIMEOUT_MS);
  const requestUrls = trackRequestUrls(page);
  const badResponses = trackBadAssetResponses(page);

  const api = await openEditor3d(page);

  const canvas = page.locator('canvas').first();
  const box = await canvas.boundingBox();
  expect(box).not.toBeNull();
  // Khung dựng chiếm quá nửa cửa sổ, không phải một dải hẹp (B-V10-02).
  expect(box!.width * box!.height).toBeGreaterThan((VIEWPORT.width * VIEWPORT.height) / 2);

  const drawBuffer = await canvas.evaluate((element) => {
    const node = element as HTMLCanvasElement;
    return { width: node.width, height: node.height };
  });
  expect(drawBuffer.width).toBeGreaterThan(300);
  expect(drawBuffer.height).toBeGreaterThan(150);

  await expect
    .poll(async () => (await canvas.screenshot()).length, {
      timeout: RENDER_TIMEOUT_MS,
      message: 'khung hình Pascal vẫn nén xuống như một mảng màu trơn',
    })
    .toBeGreaterThan(FRAME_MIN_PNG_BYTES);

  expect(findOffMachineRequests(requestUrls)).toEqual([]);
  expect(badResponses).toEqual([]);
  expect(api.unexpected).toEqual([]);
});

test('dưới CSP của nginx: 0 vi phạm, dựng xong, và bộ giải Basis thật sự khởi động (FIX-380)', async ({ page }) => {
  test.setTimeout(HEAVY_TEST_TIMEOUT_MS);
  await serveDocumentsWithCsp(page);

  const violations: string[] = [];
  page.on('pageerror', (error) => violations.push(`pageerror: ${error.message}`));
  page.on('console', (message) => {
    if (message.text().includes('Refused to')) violations.push(`console: ${message.text()}`);
  });
  await page.addInitScript(() => {
    document.addEventListener('securitypolicyviolation', (event) => {
      console.error(`Refused to (securitypolicyviolation) ${event.violatedDirective} ${event.blockedURI}`);
    });
  });
  const workers: Worker[] = [];
  page.on('worker', (worker) => workers.push(worker));
  const ktx2 = { requested: 0, answered: 0, wasm: false };
  page.on('request', (request) => {
    if (request.url().endsWith('.ktx2')) ktx2.requested += 1;
  });
  page.on('requestfinished', (request) => {
    if (request.url().endsWith('.ktx2')) ktx2.answered += 1;
    if (request.url().endsWith('/basis/basis_transcoder.wasm')) ktx2.wasm = true;
  });

  await openEditor3d(page);

  /* Lỗi Basis chỉ nổ khi texture đầu tiên vào worker, sau lúc cảnh báo xong. */
  await expect
    .poll(() => ktx2.requested > 0 && ktx2.answered === ktx2.requested, {
      timeout: RENDER_TIMEOUT_MS,
      message: 'chưa có hoặc chưa về hết lượt .ktx2',
    })
    .toBe(true);

  const probeWorkers = async (): Promise<boolean> => {
    const answers = await Promise.all(
      workers.map((worker) =>
        Promise.race([
          worker.evaluate(BASIS_READY_PROBE).then(Boolean),
          new Promise<boolean>((resolve) => setTimeout(() => resolve(false), WORKER_PROBE_TIMEOUT_MS)),
        ]).catch(() => false),
      ),
    );
    return answers.some(Boolean);
  };
  console.log(`[đo] vi phạm CSP tới lúc này: ${JSON.stringify(violations)}`);
  await expect
    .poll(probeWorkers, {
      timeout: RENDER_TIMEOUT_MS,
      message: 'không worker nào nạp được basis_transcoder.js — bộ giải Basis không khởi động',
    })
    .toBe(true);
  expect(ktx2.wasm, 'basis_transcoder.wasm chưa về').toBe(true);
  expect(violations).toEqual([]);
});

/*
 * Xuất mặt bằng PDF (Cài đặt › Mặt bằng đầy đủ) dưới CSP của nginx. Trước BUNDLE-GATE (2026-10-27)
 * nút này ném "Cannot read properties of undefined (reading 'call')": `blob-stream` cần `stream`
 * của Node mà Vite dựng thành rỗng — nay alias sang `src/pascal-page/blobStream.ts`. pdfkit được
 * cổng quét eval miễn hẹp (`scripts/check-bundle-size.mjs`); bài này là bằng chứng nó chạy được
 * dưới CSP thật: tệp tải về là PDF, không báo lỗi, 0 vi phạm.
 */
test('dưới CSP của nginx: Cài đặt › Mặt bằng đầy đủ tải về một tệp PDF, không lỗi, 0 vi phạm', async ({ page }) => {
  test.setTimeout(HEAVY_TEST_TIMEOUT_MS);
  await serveDocumentsWithCsp(page);
  const violations: string[] = [];
  page.on('pageerror', (error) => violations.push(`pageerror: ${error.message}`));
  page.on('console', (message) => {
    if (message.text().includes('Refused to')) violations.push(`console: ${message.text()}`);
  });
  await page.addInitScript(() => {
    document.addEventListener('securitypolicyviolation', (event) => {
      console.error(`Refused to (securitypolicyviolation) ${event.violatedDirective} ${event.blockedURI}`);
    });
  });

  await openEditor3d(page);
  await page.getByRole('button', { name: 'Cài đặt', exact: true }).click();

  const download = page.waitForEvent('download', { timeout: RENDER_TIMEOUT_MS });
  await page.getByRole('button', { name: 'Mặt bằng đầy đủ' }).click();
  const file = await download;
  const stream = await file.createReadStream();
  const chunks: Buffer[] = [];
  for await (const chunk of stream) chunks.push(chunk as Buffer);
  const pdf = Buffer.concat(chunks);

  expect(file.suggestedFilename()).toMatch(/\.pdf$/);
  expect(pdf.subarray(0, 5).toString('latin1')).toBe('%PDF-');
  expect(pdf.length).toBeGreaterThan(1_000);
  // Phông nhúng tự host (`/pascal/pdf-fonts/`), không rơi về Helvetica WinAnsi làm hỏng chữ có dấu.
  expect(pdf.toString('latin1')).toContain('/FontFile2');
  await expect(page.getByRole('alert').filter({ hasText: /floor plan|mặt bằng/i })).toHaveCount(0);
  expect(violations).toEqual([]);
});
