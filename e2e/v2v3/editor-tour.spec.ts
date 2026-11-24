import { expect, test } from '@playwright/test';
import type { Page } from '@playwright/test';

import { ROUTES } from '../fixtures/routes';
import { seedSpatial } from '../fixtures/seedSpatial';
import {
  TOUR_CHIP_NAME,
  TOUR_FINISH_NAME,
  TOUR_NEXT_NAME,
  TOUR_SKIP_NAME,
  TOUR_TITLES,
} from '../fixtures/tour';

import { DESKTOP_VIEWPORT, VIEWER_PROJECT_ID } from './viewer-helpers';

/**
 * EditorTour — lớp hướng dẫn phủ trên ba màn chủ: duyệt tường
 * (`/projects/project-1/floors/L1/layers/walls`), vỏ 3D (`/projects/project-1/3d`),
 * xuất (`/projects/project-1/export`). Kế hoạch: `docs/notes/e2e/plan.md` V2 MỤC 2,
 * trường 6 (a)–(e), 8, 10; phát hiện V2 số 1, 5, 10.
 *
 * ## Tour hiện lúc nào — đã đo, và nó khác nhau theo host
 *
 * - **Màn tường: tự hiện lúc tải** (sau bản sửa B-V2-01 — hook nghe sổ phím, nên
 *   lượt màn chủ đăng ký phím trong effect làm bốn bước sống lại). Bài đầu tiên
 *   khẳng định điều đó và KHÔNG có sự kiện cửa sổ nào.
 * - **Vỏ 3D và màn xuất: cũng tự hiện**, ngay khi neo của bước xuất
 *   hiện trong trang. Bước duy nhất của mỗi host (`view3d`, `exportResult`) không
 *   có phím, chỉ có neo DOM; bản sửa đầu của B-V2-01 chỉ nghe sổ phím nên hai host
 *   này từng phải chờ một `resize` (đo: mô hình dựng xong + 8 s vẫn 0 thẻ, rồi thẻ
 *   bật lên ở cú bấm đầu tiên). Nay hook nghe cả neo vào/rời DOM.
 * - **Màn xuất khi kho rỗng: không có tour nào** — neo `data-tour-anchor="exportResult"`
 *   chỉ có khi có thứ để xuất, nên 0 bước sống, trạng thái `empty`. Từ B-V12-01 cổng
 *   nạp kho trước khi màn vẽ, nên đường sản phẩm không còn rơi vào đây.
 *
 * ## Bấm nền tối = bỏ qua tour (đo, không có bài riêng)
 *
 * Bấm thật bằng chuột vào (5, 450) khi thẻ bước 1 đang hiện ở màn tường:
 * `elementFromPoint` trúng tấm nền `bg-bg-overlay`, thẻ biến mất, chip
 * "xem hướng dẫn" hiện, khoá thành `'true'`. Đó là thiết kế (`handleSkip`,
 * `useEditorTour.ts`: "Esc và bấm ra nền đều BỎ QUA, không hỏi lại"), đơn vị đã
 * phủ ("bỏ qua: Esc + bấm nền + chip quay lại"). Hệ quả cho nhóm khác: cú bấm đầu
 * tiên trên màn chủ khi tour đang hiện KHÔNG tới đích.
 *
 * ## KHÔNG kiểm
 *
 * Nội dung bảy trạng thái, tách khoá theo host, không-`dialog`, vai `viewer`, dạng
 * thu gọn (< 1280 px): `EditorTour.test.tsx` (16 bài) phủ. Bước 5–6 trên màn tường:
 * neo ở màn khác, luật sống sót bỏ chúng (đếm là "trên 4"). KHÔNG đặt khoá
 * `appfront:system-editor-tour-seen:*` bằng `addInitScript` — đó là kiểm một sản
 * phẩm khác; mỗi bài chạy trong ngữ cảnh mới nên localStorage trống.
 */

const PROJECT_ID = VIEWER_PROJECT_ID;
const WALLS_PATH = ROUTES.project.walls(PROJECT_ID, 'L1');
const EXPORT_PATH = ROUTES.project.export(PROJECT_ID);

/** Lần tải đầu một route bắt Vite dịch nguội — tiền lệ `smoke-grid.spec.ts`. */
const FIRST_PAINT_TIMEOUT_MS = 15_000;

/**
 * Tour được bao lâu để tự hiện SAU KHI màn chủ đã vẽ. Màn tường đăng ký phím ngay
 * trong effect đầu, nên thẻ hiện trong cùng nhịp tải; 6 s là trần rộng cho một
 * máy đang chạy hai lượt e2e, không phải thời gian chờ mong đợi.
 */
const TOUR_SELF_APPEAR_TIMEOUT_MS = 6_000;

/** Khoá "đã xem" của một host — `useEditorTour.ts` (`userId` của bộ mẫu là `user-mock`). */
function seenKey(hostId: string): string {
  return `appfront:system-editor-tour-seen:user-mock:${hostId}`;
}

/** Nút chính ở bước cuối của tour (`EditorTour.tsx`). */
const TOUR_LAST_NEXT_NAME = 'Xong';

const WALL_STEPS = [
  TOUR_TITLES.switchTool,
  TOUR_TITLES.reviewWall,
  TOUR_TITLES.editThickness,
  TOUR_TITLES.undo,
] as const;

/** Thẻ của một bước: `<section aria-labelledby>` — vai `region`, KHÔNG phải `dialog`. */
function tourCard(page: Page, title: string) {
  return page.getByRole('region', { name: title, exact: true });
}

/** Câu `aria-live` của tour — `Bước N trên M: <tiêu đề>`. */
function tourAnnouncement(page: Page, text: string) {
  return page.getByText(text, { exact: true });
}

/**
 * Mọi thẻ tour đang hiện, nhận ra qua nút bỏ tour chỉ thẻ bước mới có. `exact`: một
 * regex phân biệt hoa thường từng làm phép đếm 0 ở `expectNoTourAfterReload` xanh rỗng
 * khi chữ nút đổi.
 */
function anyTourSkip(page: Page) {
  return page.getByRole('region').getByRole('button', { name: TOUR_SKIP_NAME, exact: true });
}

/**
 * Nới khung nhìn thêm 1 px và ĐỂ NGUYÊN — gọi một `resize`.
 *
 * Khác khuôn `nudge` của `e2e/fixtures/tour.ts` (nới rồi trả lại) có chủ ý: hook
 * nghe `resize` qua `useSyncExternalStore` với ảnh chụp `innerWidth:innerHeight…`.
 * Chromium gộp hai lượt đổi cỡ liền nhau vào một sự kiện, và nếu lúc ấy cỡ đã về
 * như cũ thì ảnh chụp không đổi, hook không vẽ lại, tour không hiện — đo được:
 * bài màn xuất đỏ 1/2 lượt với khuôn nới-rồi-trả.
 */
async function nudgeViewport(page: Page): Promise<void> {
  const size = page.viewportSize();
  if (size === null) throw new Error('khung nhìn chưa đặt cỡ');
  await page.setViewportSize({ width: size.width + 1, height: size.height });
}

async function readKey(page: Page, hostId: string): Promise<string | null> {
  return page.evaluate((key) => localStorage.getItem(key), seenKey(hostId));
}

/** Mở màn tường và chờ chính màn (không phải tour) đã vẽ. */
async function openWalls(page: Page): Promise<void> {
  await page.setViewportSize(DESKTOP_VIEWPORT);
  await page.goto(WALLS_PATH);
  await expect(page.getByRole('region', { name: 'Duyệt lớp tường' })).toBeVisible({
    timeout: FIRST_PAINT_TIMEOUT_MS,
  });
}

/**
 * Sau tải lại, khẳng định tour KHÔNG hiện. Một khẳng định vắng mặt ngay sau tải
 * thì rỗng nghĩa, nên kích đủ mọi đường hook có thể render lại: màn chủ đã vẽ
 * (sổ phím đã đầy) VÀ một `resize`, rồi đợi một khung hình.
 */
async function expectNoTourAfterReload(page: Page): Promise<void> {
  await page.reload();
  await expect(page.getByRole('region', { name: 'Duyệt lớp tường' })).toBeVisible({
    timeout: FIRST_PAINT_TIMEOUT_MS,
  });
  await nudgeViewport(page);
  await page.evaluate(() => new Promise<void>((done) => requestAnimationFrame(() => done())));
  await expect(anyTourSkip(page)).toHaveCount(0);
  await expect(tourCard(page, WALL_STEPS[0])).toHaveCount(0);
}

test('tour tự hiện khi người dùng lần đầu mở màn tường, không cần sự kiện cửa sổ nào (B-V2-01)', async ({
  page,
}) => {
  await openWalls(page);

  await expect(tourCard(page, WALL_STEPS[0])).toBeVisible({ timeout: TOUR_SELF_APPEAR_TIMEOUT_MS });
  await expect(tourAnnouncement(page, `Bước 1 trên 4: ${WALL_STEPS[0]}`)).toBeAttached();
});

test('màn tường: đi hết bốn bước bằng "Tiếp theo", thẻ tổng kết, "Bắt đầu làm việc" ghi khoá đã xem và tải lại không hiện lại', async ({
  page,
}) => {
  await openWalls(page);

  for (const [index, title] of WALL_STEPS.entries()) {
    const card = tourCard(page, title);
    await expect(card).toBeVisible({ timeout: TOUR_SELF_APPEAR_TIMEOUT_MS });
    await expect(tourAnnouncement(page, `Bước ${index + 1} trên 4: ${title}`)).toBeAttached();
    // Bước cuối mang nút "Xong" thay cho "Tiếp theo" (EditorTour.tsx, 3c8e7ee6).
    const next = index === WALL_STEPS.length - 1 ? TOUR_LAST_NEXT_NAME : TOUR_NEXT_NAME;
    await card.getByRole('button', { name: next, exact: true }).click();
  }

  const summary = tourCard(page, TOUR_TITLES.summary);
  await expect(summary).toBeVisible();
  await summary.getByRole('button', { name: TOUR_FINISH_NAME, exact: true }).click();

  await expect(summary).toHaveCount(0);
  expect(await readKey(page, 'wall-layer-review')).toBe('true');

  await expectNoTourAfterReload(page);
});

test('màn tường: Escape bỏ tour, chip "Xem hướng dẫn" hiện, khoá ghi đã xem và tải lại không hiện lại (A12)', async ({
  page,
}) => {
  await openWalls(page);
  await expect(tourCard(page, WALL_STEPS[0])).toBeVisible({ timeout: TOUR_SELF_APPEAR_TIMEOUT_MS });

  await page.keyboard.press('Escape');

  await expect(tourCard(page, WALL_STEPS[0])).toHaveCount(0);
  await expect(page.getByRole('button', { name: TOUR_CHIP_NAME, exact: true })).toBeVisible();
  expect(await readKey(page, 'wall-layer-review')).toBe('true');
  // Escape chỉ đóng tour: màn chủ vẫn còn, URL không đổi.
  await expect(page.getByRole('region', { name: 'Duyệt lớp tường' })).toBeVisible();
  expect(new URL(page.url()).pathname).toBe(WALLS_PATH);

  await expectNoTourAfterReload(page);
});

test('màn tường: bấm chip "Xem hướng dẫn" sau khi bỏ qua mở lại tour ở đúng bước đã dừng', async ({
  page,
}) => {
  await openWalls(page);
  const first = tourCard(page, WALL_STEPS[0]);
  await expect(first).toBeVisible({ timeout: TOUR_SELF_APPEAR_TIMEOUT_MS });

  // Sang bước 2 trước, để "đúng bước đã dừng" là một khẳng định chứ không phải trùng hợp.
  await first.getByRole('button', { name: TOUR_NEXT_NAME, exact: true }).click();
  const second = tourCard(page, WALL_STEPS[1]);
  await expect(second).toBeVisible();

  await page.keyboard.press('Escape');
  const chip = page.getByRole('button', { name: TOUR_CHIP_NAME, exact: true });
  await expect(chip).toBeVisible();

  await chip.click();

  // Mở lại ở bước đã dừng; chỉ lượt đã đi hết mới quay về bước 1 (useEditorTour `onReopen`, 195a3382).
  await expect(second).toBeVisible();
  await expect(tourAnnouncement(page, `Bước 2 trên 4: ${WALL_STEPS[1]}`)).toBeAttached();
  await expect(chip).toHaveCount(0);
});

test('màn xuất (cổng nạp kho): nút xuất vừa có là tour tự hiện đúng một bước "Lấy tệp mang đi", không cần sự kiện cửa sổ', async ({
  page,
}) => {
  await page.setViewportSize(DESKTOP_VIEWPORT);
  await page.goto(EXPORT_PATH);
  // Chưa có mô hình thì màn xuất hiện trạng thái rỗng (cụm 6, cố ý): bơm bộ mẫu A14 sau khi cổng
  // nạp xong, cùng khuôn `v12a/export.spec.ts` › `seedAndSettle`.
  await expect(page.getByRole('heading', { name: 'Xuất mô hình' })).toBeVisible({ timeout: FIRST_PAINT_TIMEOUT_MS });
  await seedSpatial(page, { projectId: PROJECT_ID });

  // Nút "xuất" mang neo `data-tour-anchor="exportResult"` và chỉ có khi có thứ để
  // xuất — nó xuất hiện SAU lượt bơm kho, và neo vào trang là đủ để bước sống lại (B-V2-01).
  await expect(page.getByRole('button', { name: /^Xuất (\.glb|\.json|PDF|ảnh)$/u })).toBeVisible({
    timeout: FIRST_PAINT_TIMEOUT_MS,
  });

  await expect(tourCard(page, TOUR_TITLES.exportResult)).toBeVisible({
    timeout: TOUR_SELF_APPEAR_TIMEOUT_MS,
  });
  await expect(tourAnnouncement(page, `Bước 1 trên 1: ${TOUR_TITLES.exportResult}`)).toBeAttached();
});
