import { expect, test } from '@playwright/test';
import type { Page } from '@playwright/test';

import { ROUTES } from '../fixtures/routes';

import { QCB_FLOOR, QCB_PROJECT, seedQcb } from './seedQcb';

/**
 * Nhóm V7 — `projectRooms` "Duyệt phòng" (`plan.md` V7 mục 1).
 *
 * Hai loại bài, tên bài nói ra mình thuộc loại nào:
 * - **đường nạp thật** — KHÔNG bơm. Từ B-V6-01 (phần V7) màn đọc N16 khi kho rỗng; bộ
 *   mẫu dev phục vụ tầng A14 `L-LEVEL000001` (4 phòng, mã `R-ROOM00000n0`) và lớp rỗng
 *   cho tầng khác. Ca mồi của `plan.md` 6.1 đỏ đúng thiết kế ngày ấy, nên chúng thành
 *   bài khẳng định đường thật.
 * - **bơm bộ mẫu** — bộ riêng của màn (14 phòng, 248,60 m², `roomLabelFixture.ts`), vì
 *   các ca ấy đếm trên đúng bộ ấy (chưa đặt tên, gộp bị từ chối vì không kèm tường).
 *
 * Đơn vị (30 bài) đã phủ: bảy trạng thái, diện tích, chuẩn hoá tên, vé hoàn tác của
 * chuẩn hoá, vai Người xem. Ở đây chỉ đi những gì trình duyệt thật mới chứng minh.
 */

/** Lần tải đầu của một route bắt Vite dịch nguội; tiền lệ `smoke-grid.spec.ts`. */
const FIRST_PAINT_TIMEOUT_MS = 15_000;

const ROOM_COUNT = 14;

/** Tầng 2 của bộ mẫu A14 qua N16: Room 1, 5, 9, 13. */
const A14_FLOOR = 'L-LEVEL000001';
const A14_ROOMS = ['Room 1', 'Room 5', 'Room 9', 'Room 13'] as const;

/**
 * Hàng phòng theo tên truy cập "#R-… · <TÊN IN HOA> · …" — chữ hiện của hàng dính tên với
 * diện tích ("Room 117,00 m²") nên không lọc bằng chữ được.
 */
const roomOption = (page: Page, name: string, code = '#R-\\S+') =>
  roomList(page).getByRole('option', { name: new RegExp(`^${code} · ${name} · `, 'iu') });
const FIRST_ROOM = { code: '#R-001', name: 'Phòng khách chung' } as const;
const NEW_NAME = 'Phòng thử e2e';

function roomList(page: Page) {
  return page.getByRole('listbox', { name: 'Danh sách phòng' });
}

function roomOptions(page: Page) {
  return roomList(page).getByRole('option');
}

function toast(page: Page) {
  return page.getByRole('region', { name: 'Thông báo' });
}

/** `getByLabel('Tên phòng')` khớp 6 phần tử (đo) — bám vai trò. */
function nameField(page: Page) {
  return page.getByRole('textbox', { name: 'Tên phòng' });
}

async function open(page: Page, floorId: string = QCB_FLOOR.rooms): Promise<void> {
  await page.goto(ROUTES.project.rooms(QCB_PROJECT, floorId));
  /* P14 (N2-08, G4a-29): bỏ tiêu đề hiện "Duyệt phòng"; tên ấy còn là nhãn vùng màn. */
  await expect(page.getByRole('region', { name: 'Duyệt phòng', exact: true })).toBeVisible({
    timeout: FIRST_PAINT_TIMEOUT_MS,
  });
}

async function openSeeded(page: Page): Promise<void> {
  await open(page);
  await seedQcb(page, 'rooms');
  await expect(roomOptions(page)).toHaveCount(ROOM_COUNT);
}

/** Mở thẳng tầng A14, không bơm: đồ thị đến từ N16. */
async function openReal(page: Page): Promise<void> {
  await open(page, A14_FLOOR);
  await expect(roomOptions(page)).toHaveCount(A14_ROOMS.length);
}

/** Chọn phòng đầu, đổi tên, Enter — đường ghi thật của người duyệt. */
async function renameFirstRoom(page: Page): Promise<void> {
  await roomOptions(page).filter({ hasText: FIRST_ROOM.code }).click();
  await nameField(page).fill(NEW_NAME);
  await nameField(page).press('Enter');
  await expect(roomOptions(page).filter({ hasText: FIRST_ROOM.code })).toContainText(NEW_NAME);
}

test('đường nạp thật: mở thẳng ở một tầng có lớp thì danh sách hiện các phòng đọc từ máy chủ (V7-ROOMS-01, B-V6-01)', async ({
  page,
}) => {
  await openReal(page);

  for (const name of A14_ROOMS) {
    await expect(roomOption(page, name)).toHaveCount(1);
  }
});

/*
 * Mã A14 `R-ROOM0000010`… có chỉ số ĐỨNG SAU: quy tắc cũ đọc sáu ký tự đầu thân mã làm số
 * đếm, nên cả bốn phòng cùng nhãn "#R-ROOM00" (B-V6-09). Mã ULID của BE hỏng y như vậy.
 */
/* P14 (N2-08): breadcrumb chung `QcFloorNav` "Dự án › <tầng> › Phòng" thay chữ "Dự án > Nhãn phòng". */
test('đường dẫn đầu màn không gõ cứng "Tầng 01": "Dự án › Tầng › Phòng" (B-V6-43, N2-08)', async ({ page }) => {
  await open(page);

  const breadcrumb = page.getByRole('navigation', { name: 'Đường dẫn trang', exact: true });
  /* UX 26/10: breadcrumb là "Tầng ▾ › <tên màn>", không còn tên dự án: đo hai mục. */
  await expect(breadcrumb).toHaveText(/^Tầng.*›Duyệt phòng$/u);
  await expect(breadcrumb.locator('[aria-current="page"]')).toHaveText('Duyệt phòng');
  await expect(breadcrumb).not.toContainText('Tầng 01');
});

test('đường nạp thật: mỗi phòng một mã hiển thị riêng, theo thứ tự tạo (B-V6-09)', async ({ page }) => {
  await openReal(page);

  for (const [index, name] of A14_ROOMS.entries()) {
    await expect(roomOption(page, name, `#R-${String(index + 1).padStart(3, '0')}`)).toHaveCount(1);
  }
});

test('đường nạp thật: tầng chưa có lớp thì màn nói thật "Chưa dò ra phòng nào" (V7-ROOMS-01, B-V7-10)', async ({
  page,
}) => {
  await open(page, 'L1');

  await expect(page.getByRole('heading', { name: 'Chưa dò ra phòng nào' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Kiểm tra lại vòng hở' })).toBeVisible();
  /* Câu hướng dẫn gọi đúng tên nút người dùng thấy (B-V7-10). */
  await expect(page.getByText('rồi bấm "Kiểm tra lại vòng hở" để dò lại')).toBeVisible();
  await expect(roomList(page)).toHaveCount(0);
});

test('bơm bộ mẫu: 14 phòng, tổng 248,60 m², không phòng nào chưa đặt tên, số thập phân dùng dấu phẩy (V7-ROOMS-02, A15)', async ({
  page,
}) => {
  await openSeeded(page);

  await expect(page.getByText('248,60 m²')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Chưa đặt tên 0' })).toBeVisible();
  await expect(roomOptions(page).filter({ hasText: '#R-005' })).toHaveAccessibleName(
    '#R-005 · PHÒNG NGỦ 1 · 18,40 m² · AI đề xuất, chưa duyệt',
  );

  /* A15 trên danh sách: không một số thập phân nào dùng dấu chấm. */
  const listText = await roomList(page).innerText();
  expect(listText).toMatch(/\d,\d{2} m²/u);
  expect(listText).not.toMatch(/\d\.\d/u);
});

test('bơm bộ mẫu: đổi tên phòng có toast hoàn tác, bấm hoàn tác thì tên về cũ (V7-ROOMS-03, A8)', async ({
  page,
}) => {
  await openSeeded(page);

  await renameFirstRoom(page);
  await expect(toast(page)).toContainText(`thành "${NEW_NAME}", diện tích 17,00 m².`);

  await toast(page).getByRole('button', { name: 'Hoàn tác' }).click();

  await expect(roomOptions(page).filter({ hasText: FIRST_ROOM.code })).toContainText(FIRST_ROOM.name);
});

test('bơm bộ mẫu: rời ô nhập rồi Ctrl+Z thì tên về cũ (V7-ROOMS-04, A12)', async ({ page }) => {
  await openSeeded(page);

  await renameFirstRoom(page);
  /* Trong ô nhập, Ctrl+Z là hoàn tác chữ của chính ô (đúng quy ước nền tảng) — xem
     B-V7-06. Lối bàn phím của hoàn tác thao tác là sau khi rời ô. */
  await nameField(page).blur();
  await page.keyboard.press('Control+z');

  await expect(roomOptions(page).filter({ hasText: FIRST_ROOM.code })).toContainText(FIRST_ROOM.name);
  await expect(roomOptions(page)).toHaveCount(ROOM_COUNT);
});

/*
 * Trước B-V6-03 cổng phòng khai `persistRoomLabels: false`: engine thử lại 5/15/45 s rồi
 * nói "Lưu thất bại" — không lượt đổi tên nào rời khỏi máy. Nay lưu qua #35 (`PUT` lớp
 * tầng). Máy chủ dev là mock trong tiến trình nên không có lượt HTTP để đếm; điều quan sát
 * được là lời trình đọc màn hình nghe (vùng `role="status"` của bộ đọc dùng chung).
 */
test('đường nạp thật: đổi tên phòng thì hệ thống tự lưu và trình đọc màn hình nghe "Đã lưu lúc …" (A7, B-V6-03, B-V7-01)', async ({
  page,
}) => {
  await openReal(page);

  const room = roomOptions(page).filter({ hasText: '#R-001' });
  await room.click();
  await nameField(page).fill(NEW_NAME);
  await nameField(page).press('Enter');
  await expect(room).toContainText(NEW_NAME);

  await expect(page.getByRole('status').filter({ hasText: /^Đã lưu lúc \d{2}:\d{2}$/u })).toHaveCount(1);
});

/* -------------------------------------------------------------------------- */
/* A9 — gộp phòng hỏi trước bằng hộp thoại.                                    */
/* -------------------------------------------------------------------------- */

const SECOND_ROOM = { code: '#R-002', name: 'Phòng ngủ 3' } as const;

/**
 * `ROOM_LABEL_TEXT.wallsNotReadable` (`roomLabelReviewGateway.ts`) — chép, không nhập:
 * tệp cổng kéo theo kho và `fitText`, không chạy được phía Node của Playwright.
 */
const WALLS_NOT_READABLE =
  'Chưa đọc được đồ thị tường của tầng này. Sang lớp tường kiểm tra các đoạn tường lỗi rồi quay lại.';

function mergeDialog(page: Page) {
  return page.getByRole('dialog', { name: 'Gộp hai phòng' });
}

async function openMergeFor(page: Page, code: string): Promise<void> {
  await roomOptions(page).filter({ hasText: code }).click();
  await page.getByRole('button', { name: 'Gộp phòng' }).click();
  await expect(mergeDialog(page)).toBeVisible();
}

/** Chọn ứng viên trong `Select` tự dựng (`role="combobox"` + `role="listbox"`). */
async function pickCandidate(page: Page, room: { code: string; name: string }): Promise<void> {
  await mergeDialog(page).getByRole('combobox', { name: 'Phòng sẽ gộp vào' }).click();
  await page.getByRole('option', { name: `${room.code} · ${room.name}`, exact: true }).click();
}

test('bơm bộ mẫu: gộp phòng hỏi trước — Huỷ thì không gì đổi, Esc chỉ đóng hộp thoại (V7-ROOMS-05, A9, A12)', async ({
  page,
}) => {
  await openSeeded(page);
  const url = page.url();

  await openMergeFor(page, FIRST_ROOM.code);
  await expect(mergeDialog(page).getByRole('button', { name: 'Gộp hai phòng' })).toBeDisabled();
  await pickCandidate(page, SECOND_ROOM);
  await mergeDialog(page).getByRole('button', { name: 'Huỷ' }).click();

  await expect(mergeDialog(page)).toHaveCount(0);
  await expect(roomOptions(page)).toHaveCount(ROOM_COUNT);
  await expect(toast(page).getByRole('button', { name: 'Hoàn tác' })).toHaveCount(0);

  await page.getByRole('button', { name: 'Gộp phòng' }).click();
  await expect(mergeDialog(page)).toBeVisible();
  await page.keyboard.press('Escape');

  await expect(mergeDialog(page)).toHaveCount(0);
  await expect(roomOptions(page)).toHaveCount(ROOM_COUNT);
  expect(page.url()).toBe(url);
});

/*
 * Gộp THÀNH CÔNG không đi được với bộ mẫu: `roomLabelFixture.ts` chủ ý không kèm tường,
 * và gộp dò lại vùng từ tường. Ca này đi nhánh còn lại — lệnh bị từ chối — và đó chính
 * là chỗ đã vỡ (B-V7-08): trước bản sửa, bấm xác nhận xong không có gì xảy ra, không một
 * chữ nào.
 */
test('bơm bộ mẫu: xác nhận gộp mà lệnh bị từ chối thì toast nói lý do, không phòng nào mất (V7-ROOMS-05, B-V7-08)', async ({
  page,
}) => {
  await openSeeded(page);

  await openMergeFor(page, FIRST_ROOM.code);
  await pickCandidate(page, SECOND_ROOM);
  await mergeDialog(page).getByRole('button', { name: 'Gộp hai phòng' }).click();

  await expect(toast(page)).toContainText(WALLS_NOT_READABLE);
  await expect(roomOptions(page)).toHaveCount(ROOM_COUNT);
  await expect(toast(page).getByRole('button', { name: 'Hoàn tác' })).toHaveCount(0);
});

test('bơm bộ mẫu: mở lại hộp thoại gộp ở phòng khác thì không còn chọn sẵn ứng viên cũ (B-V7-03, A9)', async ({
  page,
}) => {
  await openSeeded(page);

  /* Hỏi ở #R-001, chọn #R-002, Huỷ… */
  await openMergeFor(page, FIRST_ROOM.code);
  await pickCandidate(page, SECOND_ROOM);
  await mergeDialog(page).getByRole('button', { name: 'Huỷ' }).click();

  /* …rồi hỏi ở CHÍNH #R-002: trước bản sửa, ứng viên cũ (là chính nó) vẫn được chọn
     ngầm và nút xác nhận bật. */
  await openMergeFor(page, SECOND_ROOM.code);

  await expect(mergeDialog(page).getByRole('combobox', { name: 'Phòng sẽ gộp vào' })).toHaveText(/Chọn phòng/u);
  await expect(mergeDialog(page).getByRole('button', { name: 'Gộp hai phòng' })).toBeDisabled();
});

/* -------------------------------------------------------------------------- */
/* Lượt nạp không phải một bước hoàn tác.                                      */
/* -------------------------------------------------------------------------- */

test('đường nạp thật: Ctrl+Z ngay sau lượt nạp không trả màn về rỗng (B-V7-04)', async ({ page }) => {
  await openReal(page);

  /* Ngoài ô nhập, để phím đi tới `global.undo` của vỏ (`router.tsx`). */
  /* Z/S-20: H1 đầu panel làm chỗ bấm ngoài ô nhập (dòng tiến độ của thanh lớp đã bỏ). */
  await page.getByRole('heading', { level: 1, name: 'Duyệt phòng' }).click();
  await page.keyboard.press('Control+z');

  await expect(roomOptions(page)).toHaveCount(A14_ROOMS.length);
  await expect(page.getByRole('heading', { name: 'Chưa dò ra phòng nào' })).toHaveCount(0);
});

/* -------------------------------------------------------------------------- */
/* Câu lệnh gọi phòng bằng mã của danh sách; hoàn tác giữ vùng chọn.            */
/* -------------------------------------------------------------------------- */

/*
 * Trước bản sửa câu lệnh dựng từ `room.id` (`roomFloorCommands.ts`): toast nói
 * "Đổi tên phòng R-000001ROOM…" trong khi hàng gọi phòng ấy là #R-001 (B-V7-05).
 */
test('bơm bộ mẫu: toast đổi tên gọi phòng bằng mã hiển thị #R-001, không lộ mã máy R-000001ROOM (B-V7-05, A6)', async ({
  page,
}) => {
  await openSeeded(page);

  await renameFirstRoom(page);

  await expect(toast(page)).toContainText(`Đổi tên phòng ${FIRST_ROOM.code} từ`);
  await expect(toast(page)).not.toContainText('R-000001ROOM');
});

/*
 * Trước bản sửa vé hoàn tác trả vùng chọn TRƯỚC lần chọn phòng gần nhất, không phải
 * vùng chọn lúc chạy lệnh: tên về đúng nhưng #R-001 bị bỏ chọn, thanh tra đóng (B-V7-09).
 */
test('bơm bộ mẫu: hoàn tác đổi tên bằng toast giữ nguyên phòng đang chọn (B-V7-09)', async ({ page }) => {
  await openSeeded(page);

  await renameFirstRoom(page);
  await toast(page).getByRole('button', { name: 'Hoàn tác' }).click();

  await expect(nameField(page)).toHaveValue(FIRST_ROOM.name);
});
