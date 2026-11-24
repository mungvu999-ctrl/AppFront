import { expect, test } from '@playwright/test';
import type { Page } from '@playwright/test';

import { ROUTES } from '../fixtures/routes';
import { signInAs } from '../fixtures/session';

/** S-02: the tile's one action reads "{động từ của bước} {tên}" (WCAG 2.5.3), e.g. "Xem 3D Nhà máy Bắc Ninh". */
const openButton = (page: Page, name: string) =>
  page.getByRole('button', { name: new RegExp(`^(Duyệt tường|Xem tiến độ|Xem 3D|Mở dự án|Tải bản vẽ) ${name.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&')}$`, 'u') });

/**
 * Nhóm V3 — bảng điều khiển "Dự án của tôi" (`ROUTES.dashboard`, `/`).
 * Kế hoạch: `docs/notes/e2e/plan.md` mục V3.1 (V3-DASH-1…4, ca bàn phím A12,
 * A8/A9, A15) và phát hiện F1, F6.
 *
 * KHÔNG kiểm, và vì sao:
 * - Độ bền của xoá / đổi tên / nhân bản qua `reload`: danh sách là bộ mẫu viết
 *   cứng (`projectsGateway.ts`, plan.md mục 0.1) — reload luôn trả lại ba thẻ.
 * - Nội dung màn đích của "Mở": mã dự án của dashboard không có trong bộ mẫu
 *   API, màn đích vẽ ca rỗng — chỉ khẳng định URL.
 * - `loading` / `error` / `empty`: không có lượt mạng để chặn — tầng đơn vị.
 * - Chống màn trắng: `smoke-grid.spec.ts` đã có. Ảnh toàn trang: `app.visual`.
 * - Thứ tự Tab đầy đủ (trường 8d): xem chú thích trên bài Tab.
 */

/** Lần tải đầu một route bắt Vite dịch nguội; tiền lệ `smoke-grid.spec.ts`. */
const FIRST_PAINT_TIMEOUT_MS = 15_000;

/**
 * Ba dự án của client giả N1 (`src/api/__mocks__/client.ts` `MOCK_PROJECT_SUMMARIES`). Id là ULID
 * vì `ProjectSummarySchema` (HOP-DONG-MOI §0.1, N1) bắt `prj_` + 26 ký tự Crockford — F-07.
 */
const HQ = 'Toà nhà HQ Renovation';
const SUNRISE = 'Chung cư Sunrise Block B';
const BAC_NINH = 'Nhà máy Bắc Ninh';

/** Bảy khoá `SevenState` thô — thứ trình đọc màn hình KHÔNG được đọc ra (F1). */
const RAW_STATE_KEY = /^(empty|loading|partial|error|success|forbidden|collapsed)$/u;

async function openDashboard(page: Page): Promise<void> {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto(ROUTES.dashboard);
  await expect(projectList(page).getByRole('listitem').first()).toBeVisible({
    timeout: FIRST_PAINT_TIMEOUT_MS,
  });
}

function projectList(page: Page) {
  return page.getByRole('list', { name: 'Danh sách dự án' });
}

function card(page: Page, name: string) {
  return projectList(page).getByRole('listitem', { name, exact: true });
}

async function openCardMenu(page: Page, name: string) {
  await page.getByRole('button', { name: `Tuỳ chọn cho ${name}`, exact: true }).click();
  const menu = page.getByRole('menu');
  await expect(menu).toBeVisible();
  return menu;
}

/**
 * Vùng `role="status"` sr-only của màn. Trang có nhiều `status` (mỗi toast là
 * một), nên lọc bằng chữ khớp TRỌN — không `first()`.
 */
function screenStatus(page: Page, label: string) {
  return page.getByRole('status').filter({ hasText: new RegExp(`^${label}$`, 'u') });
}

test.describe('V3-DASH-1 — "Mở" đưa tới màn dự án', () => {
  const DESTINATIONS = [
    { name: SUNRISE, path: ROUTES.project.upload('prj_01HZX3K9M2Q4R6T8V0W1Y3A5C8') },
    { name: HQ, path: ROUTES.project.walls('prj_01HZX3K9M2Q4R6T8V0W1Y3A5C7', 'floor-01') },
    // "Xem 3D" đi `/3d`, rồi `/3d` điều hướng cả trang sang trang Pascal riêng (`viewerRedirects.tsx`, 29eba219).
    { name: BAC_NINH, path: '/editor3d.html' },
  ] as const;

  for (const { name, path } of DESTINATIONS) {
    test(`bấm nút việc tiếp của "${name}" điều hướng tới đúng màn của dự án ấy`, async ({ page }) => {
      await openDashboard(page);
      await openButton(page, name).click();
      await expect.poll(() => new URL(page.url()).pathname).toBe(path);
    });
  }
});

test.describe('V3-DASH-2 — phím N chỉ mở hộp thoại tạo khi có quyền', () => {
  test('kỹ sư bấm N mở hộp thoại "tạo dự án mới"', async ({ page }) => {
    await openDashboard(page);
    await page.keyboard.press('n');
    await expect(page.getByRole('dialog', { name: 'Tạo dự án mới' })).toBeVisible();
  });

  test('người xem: không có nút "Dự án mới", có dòng vai người xem, bấm N không mở gì', async ({
    page,
  }) => {
    await signInAs(page, 'viewer');
    await expect(card(page, BAC_NINH)).toBeVisible();
    await expect(
      page.getByText('Vai người xem: chỉ có thể mở dự án, không tạo hoặc xoá được.', {
        exact: true,
      }),
    ).toBeVisible();
    await expect(page.getByRole('button', { name: /^Tạo dự án$/u })).toHaveCount(0);

    await page.keyboard.press('n');
    // Trạng thái dương để chờ: phím đã đi qua bộ đăng ký mà màn vẫn nguyên.
    await expect(card(page, BAC_NINH)).toBeVisible();
    await expect(page.getByRole('dialog')).toHaveCount(0);
  });
});

test.describe('V3-DASH-3 — xoá hỏi trước (A9), đổi tên hoàn tác được (A8), không nhân bản (R4)', () => {
  /** "Xoá" chỉ dành cho quản trị viên (`projectMenuGroups.ts`, BE projects/access.py:95); vai dự phòng là kỹ sư. */
  async function openDashboardAsAdmin(page: Page): Promise<void> {
    await signInAs(page, 'admin');
    await expect(projectList(page).getByRole('listitem').first()).toBeVisible({ timeout: FIRST_PAINT_TIMEOUT_MS });
  }

  test('"Xoá" mở hộp thoại "Xoá dự án?"; "Để nguyên" giữ thẻ', async ({ page }) => {
    await openDashboardAsAdmin(page);
    const menu = await openCardMenu(page, SUNRISE);
    await menu.getByRole('menuitem', { name: 'Xoá' }).click();

    const dialog = page.getByRole('dialog', { name: 'Xoá dự án?' });
    await expect(dialog).toBeVisible();
    await dialog.getByRole('button', { name: 'Để nguyên' }).click();

    await expect(dialog).toHaveCount(0);
    await expect(card(page, SUNRISE)).toBeVisible();
  });

  test('Escape đóng đúng hộp thoại xoá, thẻ còn nguyên (A12)', async ({ page }) => {
    await openDashboardAsAdmin(page);
    const menu = await openCardMenu(page, SUNRISE);
    await menu.getByRole('menuitem', { name: 'Xoá' }).click();
    const dialog = page.getByRole('dialog', { name: 'Xoá dự án?' });
    await expect(dialog).toBeVisible();

    await page.keyboard.press('Escape');

    await expect(dialog).toHaveCount(0);
    await expect(card(page, SUNRISE)).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Chọn dự án để làm tiếp' })).toBeVisible();
  });

  test('"Xoá dự án" trong hộp thoại làm thẻ biến mất', async ({ page }) => {
    await openDashboardAsAdmin(page);
    const menu = await openCardMenu(page, SUNRISE);
    await menu.getByRole('menuitem', { name: 'Xoá' }).click();
    await page
      .getByRole('dialog', { name: 'Xoá dự án?' })
      .getByRole('button', { name: 'Xoá dự án' })
      .click();

    await expect(card(page, SUNRISE)).toHaveCount(0);
    await expect(card(page, HQ)).toBeVisible();
  });

  test('đổi tên tại chỗ: Enter đổi tên, toast có "Hoàn tác", bấm nó trả tên cũ', async ({
    page,
  }) => {
    await openDashboard(page);
    const menu = await openCardMenu(page, SUNRISE);
    await menu.getByRole('menuitem', { name: 'Đổi tên' }).click();

    const field = card(page, SUNRISE).getByRole('textbox', { name: `đổi tên ${SUNRISE}` });
    await expect(field).toBeFocused();
    await field.fill('Chung cư đổi tên');
    await field.press('Enter');

    await expect(card(page, 'Chung cư đổi tên')).toBeVisible();
    await expect(card(page, SUNRISE)).toHaveCount(0);
    const toast = page
      .getByRole('status')
      .filter({ hasText: 'Đã đổi tên thành "Chung cư đổi tên"' });
    await toast.getByRole('button', { name: 'Hoàn tác' }).click();

    await expect(card(page, SUNRISE)).toBeVisible();
    await expect(card(page, 'Chung cư đổi tên')).toHaveCount(0);
  });

  test('Escape trong ô đổi tên huỷ: tên cũ giữ nguyên, không toast', async ({ page }) => {
    await openDashboard(page);
    const menu = await openCardMenu(page, SUNRISE);
    await menu.getByRole('menuitem', { name: 'Đổi tên' }).click();

    const field = card(page, SUNRISE).getByRole('textbox', { name: `đổi tên ${SUNRISE}` });
    await field.fill('Tên bỏ đi');
    await field.press('Escape');

    await expect(field).toHaveCount(0);
    await expect(card(page, SUNRISE)).toBeVisible();
    await expect(card(page, 'Tên bỏ đi')).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'Hoàn tác' })).toHaveCount(0);
  });

  /*
   * R4 (F-07): nhân bản không có hợp đồng BE, nên mục "Nhân bản" rời DOM thay vì vẽ một nút chết
   * (A2). Bài cũ khẳng định thẻ "(bản sao)" của lượt `setQueryData` không lưu — lưu giả mà F-07 gỡ.
   */
  test('menu thẻ không có "Nhân bản" (R4: chưa có hợp đồng)', async ({ page }) => {
    await openDashboard(page);
    const menu = await openCardMenu(page, SUNRISE);

    await expect(menu.getByRole('menuitem', { name: 'Đổi tên' })).toBeVisible();
    await expect(menu.getByRole('menuitem', { name: 'Nhân bản' })).toHaveCount(0);
  });
});

test.describe('V3-DASH-4 — tìm và thu gọn', () => {
  test('tìm "zzzz" ra "Không tìm thấy dự án phù hợp"; "Xoá bộ lọc" trả lưới', async ({ page }) => {
    await openDashboard(page);
    await page.getByRole('searchbox', { name: 'Tìm dự án' }).fill('zzzz');

    await expect(page.getByText('Không tìm thấy dự án phù hợp', { exact: true })).toBeVisible();
    await expect(projectList(page)).toHaveCount(0);
    await page.getByRole('button', { name: 'Xoá bộ lọc' }).click();

    await expect(projectList(page).getByRole('listitem')).toHaveCount(3);
    await expect(page.getByRole('searchbox', { name: 'Tìm dự án' })).toHaveValue('');
  });

  test('khung 700 px thu gọn: hiện thanh "Lọc theo trạng thái"', async ({ page }) => {
    await page.setViewportSize({ width: 700, height: 900 });
    await page.goto(ROUTES.dashboard);
    await expect(page.getByRole('radiogroup', { name: 'Lọc theo trạng thái' })).toBeVisible({
      timeout: FIRST_PAINT_TIMEOUT_MS,
    });
    await expect(screenStatus(page, 'thu gọn')).toHaveCount(1);
  });
});

/*
 * B-V3-08 (đã sửa): nút chuông "Thông báo" từng là một `<button>` không `onClick` —
 * điều khiển chết trong thứ tự Tab (A2). Nay container cắm `NotificationBellContainer`
 * vào khe của view: chuông mở tấm trượt, Esc đóng và trả tiêu điểm về chuông (A12).
 * Đã kiểm đỏ trước sửa.
 */
test.describe('chuông "Thông báo" ở danh sách dự án (B-V3-08)', () => {
  function bell(page: Page) {
    return page.getByRole('button', { name: 'Thông báo', exact: true });
  }

  test('bấm chuông mở tấm trượt thông báo; Esc đóng và trả tiêu điểm về chuông', async ({ page }) => {
    await openDashboard(page);

    await bell(page).click();

    const drawer = page.getByRole('dialog', { name: 'Thông báo' });
    await expect(drawer).toBeVisible();
    await expect(bell(page)).toHaveAttribute('aria-expanded', 'true');

    await page.keyboard.press('Escape');

    await expect(drawer).toHaveCount(0);
    await expect(bell(page)).toBeFocused();
    await expect(bell(page)).toHaveAttribute('aria-expanded', 'false');
  });

  test('chuông → "Xem tất cả" tới trang /thong-bao (G1-15), lùi lại về danh sách dự án', async ({ page }) => {
    await openDashboard(page);

    await bell(page).click();
    await page.getByRole('dialog', { name: 'Thông báo' }).getByRole('button', { name: 'Xem tất cả' }).click();

    await expect.poll(() => new URL(page.url()).pathname).toBe(ROUTES.notifications);
    await expect(page.getByRole('heading', { level: 1, name: 'Xem việc mới từ thông báo' })).toBeVisible();
    await expect(page.getByRole('dialog', { name: 'Thông báo' })).toHaveCount(0);

    await page.goBack();

    await expect.poll(() => new URL(page.url()).pathname).toBe(ROUTES.dashboard);
    await expect(projectList(page)).toBeVisible();
  });
});

test.describe('F1 — trình đọc màn hình nghe trạng thái màn bằng tiếng Việt (A6)', () => {
  test('lúc tải đọc "thành công", không đọc khoá tiếng Anh', async ({ page }) => {
    await openDashboard(page);
    await expect(screenStatus(page, 'thành công')).toHaveCount(1);
    await expect(page.getByRole('status').filter({ hasText: RAW_STATE_KEY })).toHaveCount(0);
  });

  test('tìm không khớp đọc "một phần", không đọc khoá tiếng Anh', async ({ page }) => {
    await openDashboard(page);
    await page.getByRole('searchbox', { name: 'Tìm dự án' }).fill('zzzz');
    await expect(screenStatus(page, 'một phần')).toHaveCount(1);
    await expect(page.getByRole('status').filter({ hasText: RAW_STATE_KEY })).toHaveCount(0);
  });
});

test.describe('bàn phím và định dạng', () => {
  test('menu thẻ mở rồi Escape đóng đúng menu, màn còn nguyên (A12)', async ({ page }) => {
    await openDashboard(page);
    const menu = await openCardMenu(page, HQ);

    await page.keyboard.press('Escape');

    await expect(menu).toHaveCount(0);
    await expect(card(page, HQ)).toBeVisible();
    await expect(page.getByRole('dialog')).toHaveCount(0);
  });

  /*
   * Thứ tự Tab (đo lại 2026-10-25, S-02), từ đầu trang tới hết thẻ đầu tiên: header
   * chung, rồi PageHead ("Tạo dự án"), rồi khung "Dự án" (tìm, sắp, kiểu xem, lọc).
   * Hai nhóm radio "Lưới/Bảng" và lọc trạng thái mỗi nhóm MỘT điểm dừng (chọn bằng
   * mũi tên), nên chỉ radio đang chọn nhận Tab.
   */
  test('mọi điều khiển trên đầu màn tới được bằng Tab, theo thứ tự đọc (A12)', async ({ page }) => {
    await openDashboard(page);
    const stops = [
      page.getByRole('link', { name: 'Bỏ qua tới nội dung', exact: true }),
      page.getByRole('link', { name: 'AppFront', exact: true }),
      page.getByRole('navigation', { name: 'Điều hướng chính' }).getByRole('link', { name: 'Dự án', exact: true }),
      page.getByRole('button', { name: 'Thông báo', exact: true }),
      page.getByRole('link', { name: 'Tài khoản của bạn', exact: true }),
      page.getByRole('button', { name: 'Đăng xuất', exact: true }),
      page.getByRole('button', { name: /dự án cần duyệt$/u }), // UX 26/10: chip nhắc việc đứng trước nút tạo
      page.getByRole('button', { name: /^Tạo dự án$/u }),
      page.getByRole('searchbox', { name: 'Tìm dự án' }),
      page.getByRole('combobox'),
      page.getByRole('radio', { name: 'Lưới' }),
      page.getByRole('radio', { name: 'Tất cả' }),
      // Danh sách xếp theo `updatedAt` mới nhất trước: Sunrise (2026-09-04) trước HQ (2026-09-03).
      card(page, SUNRISE),
      page.getByRole('button', { name: `Tuỳ chọn cho ${SUNRISE}`, exact: true }),
      openButton(page, SUNRISE),
      card(page, HQ),
      page.getByRole('button', { name: `Tuỳ chọn cho ${HQ}`, exact: true }),
      openButton(page, HQ),
    ];
    for (const stop of stops) {
      await page.keyboard.press('Tab');
      await expect(stop).toBeFocused();
    }
  });

  test('diện tích trên thẻ dùng dấu phẩy thập phân (A15)', async ({ page }) => {
    await openDashboard(page);
    // Thẻ chỉ ghi diện tích khi đã có mặt bằng (`hasPlan`); Sunrise chưa có bản vẽ nên không có số để đo.
    for (const name of [HQ, BAC_NINH]) {
      await expect(card(page, name)).toContainText(/\d,\d{2} m²/u);
    }
  });
});

test.describe('F6 — người xem không xoá được dự án', () => {
  test('mục "Xoá" trong menu thẻ bị vô hiệu với người xem, bấm không mở hộp thoại xoá', async ({
    page,
  }) => {
    await signInAs(page, 'viewer');
    const menu = await openCardMenu(page, SUNRISE);
    const remove = menu.getByRole('menuitem', { name: 'Xoá' });

    await expect(remove).toBeDisabled();
    await expect(remove).toHaveAttribute('aria-disabled', 'true');
    // `force`: bỏ qua kiểm "enabled" của Playwright để thử đúng cú bấm người dùng làm.
    await remove.click({ force: true });

    await expect(page.getByRole('dialog', { name: 'Xoá dự án?' })).toHaveCount(0);
    await expect(card(page, SUNRISE)).toBeVisible();
  });
});
