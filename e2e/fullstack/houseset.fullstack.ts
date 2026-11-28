/**
 * Bộ hồ sơ → ngôi nhà có mái trên BE thật và ML thật (NO-619 của AppBack). Không mock:
 * tải cả bộ → máy đọc → mỗi mặt bằng chưa có tầng nhận một tầng mới, chọn bên cho mâu thuẫn, xem hết cảnh báo
 * → xác nhận → các tầng chạy xong, tác vụ ráp dựng mái → trang 3D: chọn mái AI, bấm "Duyệt mái", lượt tự lưu
 * ghi `source: human`.
 *
 * `E2E_SET_FILES`: các tệp của MỘT bộ hồ sơ (PDF/PNG/JPG), ngăn bằng `;`. Trống thì bỏ qua cả tệp.
 * BE cần `DRAWING_SET_ENABLED=true` và `ML_BACKEND=onnx`: bộ ML giả không tách ra mặt bằng nào nên không có mái.
 * Chạy cùng điều kiện với `chain.fullstack.ts` (README cùng thư mục).
 */
import { expect, test } from '@playwright/test';
import type { Page } from '@playwright/test';

import { ROUTES, editor3dHref } from '@/routes/paths';

import { EMAIL_LABEL, PASSWORD_LABEL, SIGN_IN_LABEL } from '../fixtures/session';
import { dismissTour } from '../fixtures/tour';
import { waitForApi } from './apiWatch';
import { AUTOSAVE_TIMEOUT_MS, PASCAL_RENDER_TIMEOUT_MS, readFullstackEnv } from './env';

const FILES = (process.env.E2E_SET_FILES ?? '')
  .split(';')
  .map((item) => item.trim())
  .filter(Boolean);
/** Máy đọc cả bộ bằng OCR thật trên CPU: mỗi trang cỡ A3 mất hàng chục giây. */
const READ_TIMEOUT_MS = 900_000;
/** Mọi tầng chạy pipeline thật (vài phút mỗi tầng trên CPU). */
const BUILD_TIMEOUT_MS = 1_800_000;
/** Tác vụ ráp nhà chạy theo lịch 60 giây một lần sau khi các tầng xong. */
const ASSEMBLY_TIMEOUT_MS = 180_000;
const ROOF_RETRY_MS = 30_000;
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
  nodes: { id: string; type: string }[];
}

const idOf = (body: unknown): string => {
  const id = (body as { id?: unknown } | null)?.id;

  if (typeof id !== 'string' || id === '') throw new Error('thân không có "id"');
  return id;
};

async function login(page: Page): Promise<void> {
  const env = readFullstackEnv();

  await page.goto(ROUTES.login);
  await page.getByLabel(EMAIL_LABEL, { exact: true }).fill(env.adminEmail);
  await page.getByLabel(PASSWORD_LABEL, { exact: true }).fill(env.adminPassword);
  await page.getByRole('button', { name: SIGN_IN_LABEL, exact: true }).click();
  await expect.poll(() => new URL(page.url()).pathname).toBe(ROUTES.dashboard);
}

async function createProject(page: Page, name: string): Promise<string> {
  await page.getByRole('button', { name: /^Tạo dự án$/u }).click();
  const dialog = page.getByRole('dialog');

  await dialog.getByLabel('Tên dự án').fill(name);
  await dialog.getByRole('button', { name: /^Tiếp: /u }).click();
  await dialog.getByLabel('Chiều cao áp cho mọi tầng').fill('3');
  await dialog.getByRole('button', { name: 'Áp cho mọi tầng', exact: true }).click();
  await dialog.getByRole('button', { name: /^Tiếp: /u }).click();
  const created = waitForApi(page, 'POST', /^\/api\/projects$/u, [200, 201]);

  await dialog.getByRole('button', { name: 'Tạo dự án', exact: true }).click();
  return idOf((await created).json);
}

/** Tải cả bộ, chờ máy đọc xong, duyệt tới khi "Xác nhận và dựng" bấm được rồi xác nhận. */
async function uploadAndConfirm(page: Page, projectId: string): Promise<void> {
  await page.goto(ROUTES.project.drawingSets(projectId));
  await page.getByTestId('drawing-set-file-input').setInputFiles(FILES);
  await page.getByRole('button', { name: 'Tải lên', exact: true }).click();

  const house = page.getByRole('region', { name: 'Ngôi nhà' });
  const failed = page.getByText('Bộ hồ sơ chưa dùng được', { exact: true });

  await expect(house.or(failed).first()).toBeVisible({ timeout: READ_TIMEOUT_MS });
  await expect(failed, 'máy không đọc được bộ hồ sơ').toHaveCount(0);

  // Mặt bằng nào máy chưa gán tầng thì nhận một tầng mới.
  const cards = page.getByRole('list', { name: 'Các hình máy tách được' }).getByRole('listitem');
  const count = await cards.count();
  let plans = 0;

  for (let index = 0; index < count; index += 1) {
    const target = cards.nth(index).getByLabel('Tầng của hình này');

    if ((await target.count()) === 0) continue;
    plans += 1;
    if ((await target.locator('option:checked').innerText()) !== 'Chưa chọn tầng') continue;
    await target.selectOption({ label: 'Tạo tầng mới' });
    await cards.nth(index).getByLabel('Tên tầng mới').fill(`Tầng thử ${plans}`);
  }
  expect(plans, 'máy không tách ra mặt bằng nào').toBeGreaterThan(0);

  // Mâu thuẫn giữa các nguồn: người duyệt phải chọn một bên; bài này lấy bên đầu. Nhóm chọn của thẻ mái
  // (đổi dạng mái) cũng là radiogroup nhưng không bắt buộc, nên chỉ xét các nhóm đứng sau tiêu đề mâu thuẫn.
  const conflicts = house.locator(
    'xpath=.//h3[normalize-space()="Mâu thuẫn giữa các nguồn"]/following-sibling::div//*[@role="radiogroup"]',
  );

  for (const group of await conflicts.all()) {
    if ((await group.getByRole('radio', { checked: true }).count()) === 0)
      await group.locator('label').first().click();
  }

  // Mỗi lượt bấm đánh dấu một cảnh báo; nút đã bấm rời danh sách.
  const seen = house.getByRole('button', { name: /^Đã xem: /u });

  const warnings = await seen.count();

  for (let index = 0; index < warnings; index += 1) await seen.first().click();
  await expect(seen).toHaveCount(0);

  const confirm = page.getByRole('button', { name: 'Xác nhận và dựng', exact: true });

  await expect(confirm).toBeEnabled({ timeout: PASCAL_RENDER_TIMEOUT_MS });
  await confirm.click();
  await page
    .getByRole('dialog')
    .getByRole('button', { name: 'Xác nhận và dựng', exact: true })
    .click();
  const confirmed = page.getByRole('region', { name: 'Bộ hồ sơ đã xác nhận' });

  await expect(confirmed).toBeVisible({ timeout: PASCAL_RENDER_TIMEOUT_MS });

  // Một tầng hỏng (thường là `NOT_A_FLOOR_PLAN` ở tầng trên cùng ít tường) thì không có mái: dừng ngay kèm câu lỗi của màn.
  await confirmed.getByRole('button', { name: 'Xem tiến độ xử lý' }).click();
  const done = page.getByText(/^Đã (?:xử lý )?xong ([1-9]\d*)\/\1 tầng/u);
  // Màn "một bước AI hỏng": nút này luôn có mặt (nút chép mã lỗi thì nằm trong phần đang gấp).
  const failure = page.getByRole('button', { name: 'Chi tiết kỹ thuật', exact: true });

  const deadline = Date.now() + BUILD_TIMEOUT_MS;

  // Tải lại theo nhịp: trang đọc trạng thái lúc gắn, một sự kiện SSE lỡ mất thì nó đứng yên tới hết giờ.
  for (;;) {
    const settled = await done
      .or(failure)
      .first()
      .waitFor({ timeout: ROOF_RETRY_MS })
      .then(
        () => true,
        () => false,
      );

    if (settled) break;
    if (Date.now() > deadline) throw new Error('hết giờ chờ các tầng chạy xong');
    await page.reload();
  }
  if (await failure.first().isVisible()) {
    const text = await page.locator('main').first().innerText();
    const summary = /[^\n]*(?:không hoàn tất được|bước hỏng)[^\n]*/u.exec(text);

    throw new Error(`pipeline hỏng: ${summary?.[0] ?? '(không đọc được câu lỗi)'}`);
  }
}

/** Mở trang 3D lặp lại tới khi N15 mang mái: mái chỉ có sau khi tác vụ ráp (chạy theo lịch) tới lượt. */
async function openEditorWithRoof(page: Page, projectId: string): Promise<WireRoof> {
  const deadline = Date.now() + ASSEMBLY_TIMEOUT_MS;
  const graphPath = new RegExp(`^/api/projects/${projectId}/spatial$`, 'u');

  for (;;) {
    const graph = waitForApi(page, 'GET', graphPath, [200, 404], PASCAL_RENDER_TIMEOUT_MS);

    await page.goto(editor3dHref(projectId, 'probe=1'), { waitUntil: 'commit' });
    const body = (await graph).json as { graph?: { roofs?: WireRoof[] } } | null;
    const roof = body?.graph?.roofs?.[0];

    if (roof !== undefined) return roof;
    if (Date.now() > deadline) throw new Error('hết giờ chờ mái: N15 chưa mang mái nào');
    await page.waitForTimeout(ROOF_RETRY_MS);
  }
}

/** Chọn mái: bấm chuột thật vào mặt mái; trượt thì chọn qua đầu dò và ghi chú vào báo cáo. */
async function selectRoof(page: Page, roof: WireRoof, label: string): Promise<void> {
  const nodeOf = (type: string): string => {
    const node = roof.nodes.find((item) => item.type === type);

    if (node === undefined) throw new Error(`mái không có nút "${type}"`);
    return node.id;
  };
  const status = page.getByRole('status').filter({ hasText: label });

  await page.waitForFunction(
    () => {
      const probe = (window as unknown as ProbeWindow).__pascalProbe;

      return probe?.ready() === true && (probe.counts()['roof-segment'] ?? 0) >= 1;
    },
    null,
    { timeout: PASCAL_RENDER_TIMEOUT_MS },
  );
  await dismissTour(page, { waitMs: 3_000 });
  const at = await page.evaluate(
    (id) => (window as unknown as ProbeWindow).__pascalProbe!.screenOf(id),
    nodeOf('roof-segment'),
  );

  if (at !== null) await page.mouse.click(at.x, at.y);
  try {
    await expect(status).toBeVisible({ timeout: 5_000 });
  } catch {
    test.info().annotations.push({ type: 'select-fallback', description: label });
    await page.evaluate(
      (id) => (window as unknown as ProbeWindow).__pascalProbe!.select(id),
      nodeOf('roof'),
    );
    await expect(status).toBeVisible();
  }
}

test.describe('Bộ hồ sơ thật → ngôi nhà có mái', () => {
  test.skip(FILES.length === 0, 'chưa đặt E2E_SET_FILES');

  test('tải cả bộ, xác nhận, thấy mái máy dựng và duyệt mái', async ({ page }) => {
    test.setTimeout(READ_TIMEOUT_MS + BUILD_TIMEOUT_MS + ASSEMBLY_TIMEOUT_MS + 300_000);
    await login(page);
    const projectId = await createProject(page, `e2e-bo-ho-so-${Date.now()}`);

    await uploadAndConfirm(page, projectId);

    const roof = await openEditorWithRoof(page, projectId);

    expect([roof.source, roof.reviewed]).toEqual(['ai', false]);
    await selectRoof(page, roof, NEEDS_REVIEW);

    const saved = waitForApi(
      page,
      'PUT',
      /\/floors\/[^/]+\/spatial\/layer$/u,
      [200],
      AUTOSAVE_TIMEOUT_MS * 2,
    );

    await page.getByRole('button', { name: 'Duyệt mái', exact: true }).click();
    await expect(page.getByRole('status').filter({ hasText: APPROVED })).toBeVisible();
    await saved;

    // Tải lại: mái vẫn là của người duyệt, lấy từ BE chứ không từ trạng thái trong trang.
    const kept = await openEditorWithRoof(page, projectId);

    expect([kept.id, kept.source, kept.reviewed]).toEqual([roof.id, 'human', true]);
    await selectRoof(page, kept, APPROVED);
    await expect(page.getByRole('button', { name: 'Duyệt mái', exact: true })).toHaveCount(0);
  });
});
