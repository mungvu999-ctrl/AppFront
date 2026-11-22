import { expect, test } from '@playwright/test';
import type { Page } from '@playwright/test';

import type { DEV_PUBLIC_ROUTE_PATTERNS } from '../src/routes/paths';

import { ROUTE_PATTERNS, UNKNOWN_PATH } from './fixtures/routes';
import { signInAs } from './fixtures/session';
import type { Role } from './fixtures/session';

/**
 * Chặng 1 — lưới chống màn trắng (`docs/notes/e2e/plan.md` mục 6).
 *
 * Mỗi màn có route một bài: mở đúng đường, một mốc neo RIÊNG của màn ấy hiện ra,
 * 0 `pageerror`, 0 `console.error` chưa được giải thích.
 *
 * **Lưới này là lưới an toàn cho tương lai, không phải chặng đi vá lỗ.** Đo
 * 2026-10-02: 35/35 màn tải được, 0 `pageerror`. Nó tồn tại để bắt ngày một màn
 * bắt đầu trắng, nổ, hay rơi vào NotFound.
 *
 * ## Vì sao mốc riêng, không một khẳng định chung
 *
 * Đã đo hai khẳng định chung và cả hai không đủ: "≥1 nút" đỏ ở 7 màn vốn khoẻ
 * (0 nút lúc tải), còn "thân trang có chữ" xanh cả khi màn nổ — 53 container bọc
 * `ScreenErrorBoundary`, nên màn nổ vẫn vẽ chữ dự phòng. Một khoá có trong
 * `paths.ts` mà chưa gắn router cũng rơi vào NotFound và vẫn "có chữ". Mốc riêng
 * bắt được cả ba.
 *
 * ## Bảng là `Record` trên mọi khoá sản phẩm
 *
 * Thêm một route sản phẩm mà quên thêm dòng thì `pnpm typecheck` đỏ — `e2e/` nằm
 * trong `tsconfig.json`. Đường dẫn sinh từ `ROUTE_PATTERNS`, không chép tay.
 *
 * ## `known` — màn mở được nhưng NỘI DUNG đang hỏng
 *
 * Mốc của những dòng ấy neo vào VỎ màn, không neo vào câu báo hỏng, để bài không
 * đóng đinh khiếm khuyết thành hành vi mong muốn. `known` đi vào tên bài, nên một
 * bài xanh không đọc thành "màn chạy được".
 */

type DevPattern = (typeof DEV_PUBLIC_ROUTE_PATTERNS)[number];
type RouteKey = keyof typeof ROUTE_PATTERNS;
type ProductRouteKey = {
  [K in RouteKey]: (typeof ROUTE_PATTERNS)[K] extends DevPattern ? never : K;
}[RouteKey];

type Anchor =
  | {
      readonly role:
        | 'heading'
        | 'region'
        | 'navigation'
        | 'main'
        | 'button'
        | 'list'
        | 'tree'
        | 'status';
      readonly name: string | RegExp;
    }
  | { readonly text: string }
  | { readonly label: string }
  /**
   * Route không dựng màn mà điều hướng cả trang sang tài liệu khác (`/3d…` → `editor3d.html`,
   * `viewerRedirects.tsx`, từ 29eba219). Mốc là đường hạ cánh + `?project=`; nội dung trang 3D
   * do `pascal-fixtures.spec.ts` kiểm với máy chủ giả.
   */
  | { readonly redirect: string };

interface Row {
  readonly anchor: Anchor;
  /** Vai đăng nhập trước khi mở (mặc định: vai `engineer` dự phòng của bộ mẫu, không qua biểu mẫu). */
  readonly role?: Role;
  /** Màn mở được nhưng nội dung đang hỏng — vào tên bài. */
  readonly known?: string;
  /** Mặc định `L1`. */
  readonly floorId?: string;
  readonly viewport?: { readonly width: number; readonly height: number };
  /** Một lỗi console được phép, kèm lý do. Lỗi ấy PHẢI xuất hiện — nó là ca tự kiểm của bộ thu. */
  readonly expectedConsole?: { readonly match: RegExp; readonly why: string };
}

const PROJECT_ID = 'project-1';

/** Lần tải đầu của một route bắt Vite dịch nguội; tiền lệ `app.visual.spec.ts`. */
const FIRST_PAINT_TIMEOUT_MS = 15_000;

const ROWS = {
  login: { anchor: { role: 'button', name: 'Đăng nhập' } },
  forgotPassword: { anchor: { role: 'heading', name: 'Quên mật khẩu' } },
  // `/welcome` là bản kết hợp v6 (5be42f2a); H1 ba dòng, mỗi dòng một khối.
  welcome: { anchor: { role: 'heading', name: /^Bản vẽ của bạn,\s*đọc như một cuốn sách,\s*dựng như một ngôi nhà\.$/u } },
  invitationAccept: { anchor: { role: 'heading', name: 'Nhận lời mời' } },
  passwordReset: { anchor: { role: 'heading', name: 'Đặt lại mật khẩu' } },
  onboarding: { anchor: { role: 'button', name: 'Tạo dự án' } },
  accessDenied: { anchor: { role: 'heading', name: 'Bạn chưa có quyền truy cập' } },
  notFound: { anchor: { role: 'heading', name: 'Không tìm thấy trang này' } },
  mobileViewer: {
    anchor: { role: 'region', name: 'Xem mô hình 3D trên điện thoại' },
    viewport: { width: 390, height: 844 },
  },
  // Chuông (B-V3-08) không mở luồng SSE thông báo khi chạy bộ mẫu dev (không có máy chủ SSE):
  // trước kia lỗi 500 của luồng ấy rơi vào mọi màn có chuông tuỳ nhịp tải, nay không màn nào được có.
  notifications: { anchor: { role: 'heading', name: 'Xem việc mới từ thông báo' } },
  dashboard: { anchor: { role: 'heading', name: 'Chọn dự án để làm tiếp' } },
  projectSettings: { anchor: { role: 'heading', name: 'Đặt thông tin, đơn vị đo và thành viên của dự án' } },
  account: { anchor: { role: 'heading', name: 'Đổi thông tin và tuỳ chọn tài khoản' } },
  // Khu Quản trị chỉ mở cho vai admin (`AdminGate`, 10a4db04); vai dự phòng `engineer` chỉ thấy màn chặn.
  // Ma trận quyền nay nằm sau nút "Xem ma trận quyền"; mốc là H1 của màn.
  adminUsers: { anchor: { role: 'heading', name: 'Phân vai người dùng' }, role: 'admin' },
  adminModels: { anchor: { label: 'Tìm mẫu 3D' }, role: 'admin' },
  adminTrainingJobs: { anchor: { role: 'heading', name: 'Theo dõi huấn luyện' }, role: 'admin' },
  adminTrainingModels: { anchor: { role: 'heading', name: 'Chọn mô hình AI đang dùng' }, role: 'admin' },
  // FIX-775 (BUG-079): breadcrumb dùng chung, `nav` tên "Đường dẫn trang"; chữ của cấp cuối mới nói đây là màn nào.
  projectUpload: { anchor: { text: 'Tải lên bản vẽ' } },
  projectQuality: { anchor: { role: 'region', name: 'Báo cáo chất lượng' } },
  // F-05b: màn chỉ mở SSE cho tầng đang xem chưa xong sau lượt #8 mồi; bộ mẫu dev không có
  // lượt nào đang chạy nên không còn lượt mở luồng 404 (B-V4-10) để chờ.
  projectPipeline: { anchor: { role: 'navigation', name: 'Xử lý' } },
  projectPipelineGraph: { anchor: { role: 'heading', name: 'Bản vẽ được xử lý theo đường nào' } },
  // Cột việc dựng lại (09b6f31d): H1 của các bước duyệt tầng nằm ở đầu cột (`QcStepColumn`, STEP_H1).
  projectScale: { anchor: { role: 'heading', name: 'Kiểm tỷ lệ' } },
  projectWalls: { anchor: { role: 'region', name: 'Duyệt lớp tường' } },
  projectObjects: { anchor: { role: 'region', name: 'Lớp đối tượng' } },
  projectDimensions: { anchor: { role: 'region', name: 'Kích thước' } },
  projectGrids: { anchor: { role: 'heading', name: 'Trục và gốc toạ độ' } },
  projectRooms: { anchor: { role: 'heading', name: 'Đặt tên phòng' } },
  projectFloors: { anchor: { role: 'heading', name: 'Duyệt từng tầng' } },
  projectThickness: { anchor: { role: 'heading', name: 'Độ dày tường' } },
  projectOverlay: { anchor: { role: 'region', name: 'So với bản vẽ' } },
  projectViewer: { anchor: { redirect: '/editor3d.html' } },
  projectExploded: { anchor: { redirect: '/editor3d.html' } },
  projectMeasure: { anchor: { redirect: '/editor3d.html' } },
  projectViewerPascal: { anchor: { redirect: '/editor3d.html' } },
  projectRules: { anchor: { role: 'heading', name: 'Kiểm tra quy chuẩn' } },
  projectRuleSettings: { anchor: { role: 'heading', name: 'Chọn luật áp dụng' } },
  projectExport: { anchor: { role: 'heading', name: 'Xuất mô hình' } },
  // Ô tìm chỉ có khi đã có dữ liệu (không vẽ ô chết trên ca rỗng); bộ mẫu dev chưa có tường nào, nên mốc là H1.
  projectData: { anchor: { role: 'heading', name: 'Xem trước dữ liệu xuất (.json)' } },
  projectVersions: { anchor: { role: 'navigation', name: 'Danh sách phiên bản' } },
  sharedModel: { anchor: { role: 'heading', name: 'Liên kết không còn hiệu lực' } },
} as const satisfies Record<ProductRouteKey, Row>;

function pathFor(key: ProductRouteKey, row: Row): string {
  const pattern: string = ROUTE_PATTERNS[key];
  if (pattern === '*') return UNKNOWN_PATH;
  return pattern.replace(':projectId', PROJECT_ID).replace(':floorId', row.floorId ?? 'L1');
}

function locate(page: Page, anchor: Exclude<Anchor, { readonly redirect: string }>) {
  if ('role' in anchor) return page.getByRole(anchor.role, { name: anchor.name, exact: true });
  if ('text' in anchor) return page.getByText(anchor.text, { exact: true });
  return page.getByLabel(anchor.label, { exact: true });
}

for (const [key, row] of Object.entries(ROWS) as [ProductRouteKey, Row][]) {
  const title =
    row.known === undefined
      ? `màn ${key} mở được, không trắng, không lỗi`
      : `màn ${key} mở được (đã biết: ${row.known})`;

  test(title, async ({ page }) => {
    const consoleErrors: string[] = [];
    const pageErrors: string[] = [];
    page.on('console', (message) => {
      /* Không lọc gì cho mọi màn: lỗi `/favicon.ico` 404 từng phải lọc ở đây đã được
         chữa ở gốc — `index.html` có thẻ icon (B-G-03). */
      if (message.type() !== 'error') return;
      consoleErrors.push(`${message.text()} @ ${message.location().url}`);
    });
    page.on('pageerror', (error) => pageErrors.push(error.message));

    const anchor = row.anchor;
    if ('redirect' in anchor) {
      await page.goto(pathFor(key, row));
      await expect
        .poll(() => new URL(page.url()).pathname, { timeout: FIRST_PAINT_TIMEOUT_MS })
        .toBe(anchor.redirect);
      expect(new URL(page.url()).searchParams.get('project')).toBe(PROJECT_ID);
      // Trang 3D gọi HTTP thật (không có bộ mẫu), nên lỗi mạng của nó không thuộc lưới này; chỉ lỗi trang.
      expect(pageErrors).toEqual([]);
      return;
    }

    if (row.role === undefined) {
      await page.setViewportSize(row.viewport ?? { width: 1440, height: 900 });
      await page.goto(pathFor(key, row));
    } else {
      await signInAs(page, row.role, pathFor(key, row));
    }

    await expect(locate(page, anchor).first()).toBeVisible({ timeout: FIRST_PAINT_TIMEOUT_MS });

    const expected = row.expectedConsole;
    if (expected !== undefined) {
      await expect
        .poll(() => consoleErrors.some((line) => expected.match.test(line)), {
          message: `chờ lỗi đã biết (${expected.why}) — không thấy nghĩa là bộ thu console hỏng`,
        })
        .toBe(true);
    }

    expect(pageErrors).toEqual([]);
    expect(
      consoleErrors.filter((line) => expected === undefined || !expected.match.test(line)),
    ).toEqual([]);
  });
}

/*
 * Lưới 2 — lớp không có route. Phần trên màn 3D nằm ở `viewer3d.spec.ts` (dùng
 * lại `openViewer`); ở đây là lớp duy nhất mở từ bảng điều khiển. Đơn vị có 0
 * bài `Escape` cho hộp thoại này (plan.md V3 mục 2).
 */
test('hộp thoại tạo dự án mở từ nút "Dự án mới", Escape đóng nó và chỉ nó (A12)', async ({
  page,
}) => {
  await page.goto(ROUTE_PATTERNS.dashboard);
  await page.getByRole('button', { name: /^Tạo dự án$/u }).click({ timeout: FIRST_PAINT_TIMEOUT_MS });

  const dialog = page.getByRole('dialog');
  await expect(dialog).toHaveCount(1);

  await page.keyboard.press('Escape');

  await expect(dialog).toHaveCount(0);
  expect(new URL(page.url()).pathname).toBe(ROUTE_PATTERNS.dashboard);
  await expect(page.getByRole('heading', { name: 'Chọn dự án để làm tiếp', exact: true })).toBeVisible();
});
