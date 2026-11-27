/**
 * NHA-10 — đường người dùng "duyệt bộ hồ sơ → xác nhận → thấy mái → duyệt mái", hai nửa:
 *
 * 1. Màn bộ hồ sơ trên bộ mẫu (`VITE_USE_MOCK_API`): tải một PDF, khối "Ngôi nhà" đưa đề xuất tầng và mái, cảnh báo
 *    chưa xem thì chưa xác nhận được, xác nhận xong sang màn xử lý.
 * 2. Trang 3D trên máy chủ giả (`installFakeApi`): mái do tác vụ ráp nhà của BE dựng (`roof_golden.json`, bản chép
 *    nguyên văn từ AppBack) hiện trong cảnh với nhãn "cần duyệt"; bấm "Duyệt mái" thì lượt tự lưu ghi
 *    `source: human`, và tải lại vẫn là "Bạn đã duyệt".
 *
 * CHỖ NỐI KHÔNG ĐƯỢC KIỂM Ở ĐÂY: sau khi xác nhận, chính AppBack ráp nhà rồi ghi mái vào đồ thị (NHA-07a). Bộ mẫu
 * của FE không ráp nhà, và trang 3D không dùng bộ mẫu (xem `fixtures/fakeApi.ts`), nên nửa 2 nhận mái từ fixture chứ
 * không từ lượt xác nhận của nửa 1. Chỗ nối đó chỉ kiểm được bằng chuỗi `e2e/fullstack` trên AppBack thật.
 *
 * Cũng không kiểm: chọn mái bằng chuột khi bộ dựng hình phần mềm bấm trượt (khi đó chọn qua đầu dò và ghi chú thích
 * `select-fallback`, như `pascal-edit-path.spec.ts`); thẻ duyệt mái khi đang cầm công cụ, xem thử hay đi bộ; màn hẹp.
 */
import { readFileSync } from 'node:fs';

import { expect, test } from '@playwright/test';
import type { Page } from '@playwright/test';

import { fixtureF1 } from '../../src/lib/pascal/__fixtures__';
import { installFakeApi, type WireGraphDocument } from '../fixtures/fakeApi';
import { ROUTES, pathOf } from '../fixtures/routes';
import { FIRST_PAINT_TIMEOUT_MS, PROJECT_ID, pdfFile } from '../v4v5/files';

/** Đọc bằng `fs` như `src/lib/pascal/__fixtures__/index.ts`: Playwright chạy ESM thuần. */
const golden = JSON.parse(
  readFileSync(
    new URL('../../src/pascal-page/__tests__/roof_golden.json', import.meta.url),
    'utf8',
  ),
) as readonly { name: string; nodes: readonly { id: string; type: string }[] }[];

const VIEWPORT = { width: 1440, height: 900 } as const;
const READ_TIMEOUT_MS = 30_000;

test('bộ hồ sơ: tải lên, khối "Ngôi nhà" có tầng và mái, xem hết cảnh báo rồi xác nhận', async ({
  page,
}) => {
  await page.setViewportSize(VIEWPORT);
  await page.goto(ROUTES.project.drawingSets(PROJECT_ID));
  await page
    .getByTestId('drawing-set-file-input')
    .setInputFiles([pdfFile('nha-pho-6-trang.pdf', 6)], { timeout: FIRST_PAINT_TIMEOUT_MS });
  await page.getByRole('button', { name: 'Tải lên', exact: true }).click();

  const house = page.getByRole('region', { name: 'Ngôi nhà' });
  await expect(house).toBeVisible({ timeout: READ_TIMEOUT_MS });
  await expect(house.getByText('Các tầng', { exact: true })).toBeVisible();
  // Đúng một thẻ mái (mỗi thẻ có một ô "không dựng mái").
  await expect(house.getByLabel('Không dựng mái, tôi tự vẽ')).toHaveCount(1);

  // Mỗi mặt bằng phải có tầng đích: ở đây mỗi hình một tầng mới.
  const targets = page.getByLabel('Tầng của hình này');
  const plans = await targets.count();
  expect(plans).toBeGreaterThan(0);
  for (let index = 0; index < plans; index += 1) {
    await targets.nth(index).selectOption({ label: 'Tạo tầng mới' });
    await page
      .getByLabel('Tên tầng mới')
      .nth(index)
      .fill(`Tầng thử ${index + 1}`);
  }

  // Cảnh báo T-07 (chiều cao tầng trên cùng và dạng mái đều là mặc định) chưa xem thì chưa xác nhận được.
  const confirm = page.getByRole('button', { name: 'Xác nhận và dựng', exact: true });
  const seen = house.getByRole('button', { name: /^Đã xem: / });
  await expect(seen.first()).toBeVisible();
  await expect(confirm).toBeDisabled();

  // Mỗi lượt bấm đánh dấu một cảnh báo; nút đã bấm rời danh sách.
  const warnings = await seen.count();
  for (let index = 0; index < warnings; index += 1) await seen.first().click();
  await expect(seen).toHaveCount(0);
  await expect(confirm).toBeEnabled({ timeout: READ_TIMEOUT_MS });

  await confirm.click();
  await page
    .getByRole('dialog')
    .getByRole('button', { name: 'Xác nhận và dựng', exact: true })
    .click();

  const done = page.getByRole('region', { name: 'Bộ hồ sơ đã xác nhận' });
  await expect(done).toBeVisible({ timeout: READ_TIMEOUT_MS });
  await done.getByRole('button', { name: 'Xem tiến độ xử lý' }).click();
  await expect.poll(() => pathOf(page.url())).toBe(ROUTES.project.pipeline(PROJECT_ID));
});

const PASCAL_PROJECT_ID = 'P-FIXTURE0001';
const READY_TIMEOUT_MS = 150_000;
const SAVE_TIMEOUT_MS = 30_000;
const NEEDS_REVIEW = 'Mái do máy dựng — cần duyệt';
const APPROVED = 'Bạn đã duyệt';

interface Probe {
  ready(): boolean;
  counts(): Record<string, number>;
  select(id: string): void;
  screenOf(id: string): Promise<{ x: number; y: number } | null>;
}
interface ProbeWindow {
  __pascalProbe?: Probe;
}
interface WireRoof {
  id: string;
  source?: string;
  reviewed?: boolean;
}
interface PutBody {
  body: { layer?: { roofs?: WireRoof[] } };
}

const roofCase = golden.find((entry) => entry.name === 'rect_gable_turned')!;
const roofNodeId = roofCase.nodes.find((node) => node.type === 'roof')!.id;
const segmentNodeId = roofCase.nodes.find((node) => node.type === 'roof-segment')!.id;
const roofId = roofNodeId.replace(/^roof_/u, '');

/** F1-ext + một mái như tác vụ ráp nhà của BE ghi: nguồn AI, chưa duyệt. */
const graphDoc = ((): WireGraphDocument => {
  const doc = fixtureF1({ ext: true }).doc as unknown as WireGraphDocument;
  const roof = {
    id: roofId,
    levelId: doc.graph.levels[0]!.id,
    nodes: roofCase.nodes,
    confidence: 0.6,
    source: 'ai',
    reviewed: false,
  };

  return { ...doc, graph: { ...doc.graph, roofs: [roof] } };
})();

const waitRoofBuilt = (page: Page) =>
  page.waitForFunction(
    () => {
      const probe = (window as unknown as ProbeWindow).__pascalProbe;

      return (
        probe?.ready() === true &&
        (probe.counts()['roof'] ?? 0) === 1 &&
        (probe.counts()['roof-segment'] ?? 0) >= 1
      );
    },
    null,
    { timeout: READY_TIMEOUT_MS },
  );

/** Chọn mái: bấm chuột thật vào mặt mái; trượt (SwiftShader) thì chọn qua đầu dò và ghi lại. */
async function selectRoof(page: Page, label: string, usedFallback: string[]): Promise<void> {
  const status = page.getByRole('status').filter({ hasText: label });
  const at = await page.evaluate(
    (id) => (window as unknown as ProbeWindow).__pascalProbe!.screenOf(id),
    segmentNodeId,
  );

  if (at !== null) await page.mouse.click(at.x, at.y);

  try {
    await expect(status).toBeVisible({ timeout: 5_000 });
  } catch {
    usedFallback.push(label);
    await page.evaluate(
      (id) => (window as unknown as ProbeWindow).__pascalProbe!.select(id),
      roofNodeId,
    );
    await expect(status).toBeVisible();
  }
}

test.describe('Trang 3D: mái do máy dựng', () => {
  test.describe.configure({ timeout: 420_000 });

  test('thấy mái kèm nhãn cần duyệt, "Duyệt mái" ghi nguồn người duyệt, tải lại vẫn đã duyệt', async ({
    browser,
  }, testInfo) => {
    const page = await browser.newPage({ viewport: VIEWPORT });
    const backend = await installFakeApi(page, { projectId: PASCAL_PROJECT_ID, graphDoc });
    const usedFallback: string[] = [];
    const savedRoof = () =>
      (backend.puts.at(-1) as PutBody | undefined)?.body.layer?.roofs?.find(
        (roof) => roof.id === roofId,
      );

    try {
      await page.goto(`/editor3d.html?project=${PASCAL_PROJECT_ID}&probe=1`);
      await waitRoofBuilt(page);

      await selectRoof(page, NEEDS_REVIEW, usedFallback);
      await page.getByRole('button', { name: 'Duyệt mái', exact: true }).click();
      await expect(page.getByRole('status').filter({ hasText: APPROVED })).toBeVisible();
      await expect(page.getByRole('button', { name: 'Duyệt mái', exact: true })).toHaveCount(0);

      // Lượt tự lưu ghi mái với nguồn người duyệt (zod và BE đều cấm `ai` đi cùng `reviewed: true`). Chờ đúng lượt
      // ghi mang mái đã duyệt, không chờ "có một PUT". Máy chủ giả từ chối lượt ghi thì bước tải lại bên dưới sẽ đỏ.
      await expect
        .poll(savedRoof, { timeout: SAVE_TIMEOUT_MS, message: 'chờ lượt tự lưu mang mái đã duyệt' })
        .toMatchObject({ source: 'human', reviewed: true });

      await page.reload();
      await waitRoofBuilt(page);
      await selectRoof(page, APPROVED, usedFallback);
      await expect(page.getByRole('button', { name: 'Duyệt mái', exact: true })).toHaveCount(0);
      // Trang còn hỏi vài tuyến đọc mà máy chủ giả không có (bối cảnh thiết kế, nướng ánh sáng); chỉ cấm lượt GHI lạ.
      expect(
        backend.unexpected.filter((call) => !call.startsWith('GET ')),
        'lượt ghi máy chủ giả không biết trả lời',
      ).toEqual([]);
    } finally {
      if (usedFallback.length > 0)
        testInfo.annotations.push({
          type: 'select-fallback',
          description: usedFallback.join(' | '),
        });
      await page.close();
    }
  });

  test('người xem thấy nhãn cần duyệt nhưng không có nút "Duyệt mái"', async ({
    browser,
  }, testInfo) => {
    const page = await browser.newPage({ viewport: VIEWPORT });
    const backend = await installFakeApi(page, {
      projectId: PASCAL_PROJECT_ID,
      graphDoc,
      role: 'viewer',
    });
    const usedFallback: string[] = [];

    try {
      await page.goto(`/editor3d.html?project=${PASCAL_PROJECT_ID}&probe=1`);
      await waitRoofBuilt(page);
      await selectRoof(page, NEEDS_REVIEW, usedFallback);
      await expect(page.getByRole('button', { name: 'Duyệt mái', exact: true })).toHaveCount(0);
      expect(backend.puts, 'người xem không được ghi').toEqual([]);
    } finally {
      if (usedFallback.length > 0)
        testInfo.annotations.push({
          type: 'select-fallback',
          description: usedFallback.join(' | '),
        });
      await page.close();
    }
  });
});
