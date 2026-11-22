// @vitest-environment jsdom
// PERF-01/FE-11 A15: dưới happy-dom F-06 đọc `state` ra 'collapsed' thay vì
// 'success' — khác do engine xử lý tập hợp trạng thái render, không phải lỗi
// test. Giữ tệp này ở jsdom.
/**
 * Bộ kiểm của L2-W4 cho màn `ShareDialog` — bảy trạng thái, cộng năm điều cấm của đặc tả.
 *
 * ## Vì sao view và hook ở đây đi qua `import()` thay vì `import … from …`
 *
 * `./ShareDialog` (view) và `./useShareDialog` (hook) là việc của hai worker khác, viết
 * SONG SONG với worker này trên nhánh riêng — tại thời điểm file này được viết, CẢ HAI
 * CHƯA TỒN TẠI trong worktree này. Đã đo thật ở `RuleSettings.test.tsx`/`ExportPanel.test.tsx`:
 * một `import` TĨNH của một đường dẫn không tồn tại làm Vite sập lúc transform và không một
 * test nào trong cả file chạy được. Giấu đường dẫn sau một biến, kèm `/* @vite-ignore *\/`,
 * hoãn việc phân giải sang đúng lúc CHẠY, nên một import hỏng chỉ làm hỏng ĐÚNG một `it`.
 *
 * Vì thế, ở nhánh này: các bài cần view/hook thật HỎNG RIÊNG LẺ với "Failed to resolve",
 * còn các bài thuần dữ liệu (quét mã nguồn, mã màu) CHẠY VÀ XANH ngay hôm nay.
 * **Bộ này chưa được chạy trọn vẹn ở lớp W4 — nó sẽ chạy thật ở lớp gộp** (E.10: không báo
 * "đạt" cho bước chưa chạy).
 *
 * ## Ba cách né đã đo, không phải phỏng đoán
 *
 *  1. `expectAccessible` gọi trên `document.body` với `ignoreSelector: '[role="dialog"]'` —
 *     `Modal.tsx:131` tự đặt `outline-hidden` lên cái vỏ `tabIndex={-1}` của nó, và đó là
 *     component dùng chung, không phải lỗi của màn. Tiền lệ: `DangerZone.test.tsx:189`.
 *     `ignoreSelector` chỉ bỏ phần tử KHỚP chứ không bỏ cây con, nên mọi nút và ô BÊN
 *     TRONG hộp thoại vẫn bị soát đủ.
 *  2. `expectVietnamese` gọi kèm `ignore: [/^https?:\/\//]` — ô hiển thị địa chỉ chia sẻ
 *     mang một URL, mà domain/path thì không phải âm tiết tiếng Việt.
 *  3. `Select` thiếu `label` sẽ RỚT `expectAccessible`. Nếu bài (B) dưới đây bắt được điều
 *     đó thì **đó là lỗi thật của view**, phải sửa view — không nới điều kiện ở đây.
 */

import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

import { QueryClientProvider } from '@tanstack/react-query';
import { act, cleanup, fireEvent, renderHook, screen, waitFor } from '@testing-library/react';
import type { ComponentType, ReactNode } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import type { ShareLinkGateway } from '@/lib/export/shareLink';
import { expectAccessible } from '@/lib/testing/expectAccessible';
import { expectNoRawColor } from '@/lib/testing/expectNoRawColor';
import { expectSevenStates } from '@/lib/testing/expectSevenStates';
import { expectVietnamese } from '@/lib/testing/expectVietnamese';
import { createTestQueryClient, renderWithProviders } from '@/lib/testing/render';
import { createSevenStateScenarios, SEVEN_STATES } from '@/lib/testing/sevenStateScenarios';

import {
  buildLinksUnsupportedModel,
  buildShareDialogProps,
  SAMPLE_ACTIVE_LINK,
  SAMPLE_MEMBER_EMAILS,
  SAMPLE_MEMBERS,
  SAMPLE_PROJECT_ID,
} from './shareDialogFixtures';
import type { ShareDialogProps, ShareDialogResult, UseShareDialogOptions } from './types';

afterEach(() => {
  cleanup();
});

/** Thư mục màn, dùng cho cả `expectNoRawColor` lẫn bài quét mã nguồn. */
const SCREEN_DIRECTORY = 'src/screens/export/ShareDialog';

/* ==========================================================================
 * 0. Hạ tầng: nhập file cùng thư mục qua biến, không qua chuỗi tĩnh.
 * ========================================================================== */

/** Xem lời giải thích ở đầu file. */
async function importFromScreen<T>(specifier: string): Promise<T> {
  return import(/* @vite-ignore */ specifier) as Promise<T>;
}

async function loadShareDialogView(): Promise<ComponentType<ShareDialogProps>> {
  const mod = await importFromScreen<{ ShareDialog: ComponentType<ShareDialogProps> }>(
    './ShareDialog',
  );

  return mod.ShareDialog;
}

async function loadUseShareDialog(): Promise<(options: UseShareDialogOptions) => ShareDialogResult> {
  const mod = await importFromScreen<{
    useShareDialog: (options: UseShareDialogOptions) => ShareDialogResult;
  }>('./useShareDialog');

  return mod.useShareDialog;
}

/**
 * Bọc `renderHook` trong đúng bộ nhớ đệm mà sản phẩm chạy trên.
 *
 * `useShareDialog` đọc danh sách liên kết bằng `useQuery` (R-64), nên nó đòi một
 * `QueryClientProvider` phía trên — `renderHook` trần ném "No QueryClient set". Ở lớp W4
 * hook chưa tồn tại nên điều đó chưa đo được; đây là chỗ lớp gộp nối lại. Không một điều
 * kiện nào của bài bị nới: chỉ có cái provider mà container thật cũng có.
 * Tiền lệ: `useFloorUploadScreen.test.ts:205`, `ViewerShell.test.tsx:554`.
 */
function withQueryClient(): ({ children }: { readonly children: ReactNode }) => React.JSX.Element {
  const client = createTestQueryClient();

  return function QueryWrapper({ children }: { readonly children: ReactNode }) {
    return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
  };
}

/** Một cổng không chạm mạng, mặc định `supported: true` (máy chủ v2): `list` rỗng, `create` trả đúng bản ghi mẫu, `revoke` xong. */
function buildFakeGateway(overrides: Partial<ShareLinkGateway> = {}): ShareLinkGateway {
  return {
    supported: true,
    list: () => Promise.resolve({ ok: true, data: [] }),
    create: () => Promise.resolve({ ok: true, data: SAMPLE_ACTIVE_LINK }),
    revoke: () => Promise.resolve({ ok: true, data: undefined }),
    ...overrides,
  };
}

/**
 * Hạn thời gian của **riêng tệp này**, và vì sao nó phải có.
 *
 * Bốn bài trong tệp render cả bảy trạng thái của hộp thoại, mỗi bài một lượt
 * nhập động phần view. Đo trên máy này khi chạy RIÊNG cả tệp: `tests 4 059 ms`
 * cho 17 bài — sát hạn **5 000 ms** mặc định của vitest. Chạy cùng cả bộ có
 * `--coverage`, nơi mọi tệp đều bị đo, nó vượt hạn, và **bài vượt đổi theo từng
 * lượt** (đo được hai bài khác nhau ở hai lượt liền nhau). Đó là dấu của một
 * tệp ngồi sẵn ở mép hạn, không phải của một bài hỏng.
 *
 * Thứ làm nó đổ trong đợt này: thêm bốn tệp kiểm của `src/lib/pascal`. Bốn tệp
 * ấy chỉ tốn 0,19 s — chúng không thêm tải, chúng đổi cách vitest xếp tệp vào
 * worker. Phép thử đối chứng: cùng `--coverage`, bỏ bốn tệp ra thì 7 196/7 196
 * xanh, để vào thì tệp này đỏ ở 3/3 lượt.
 *
 * Hạn này **không** nới một cổng chất lượng nào — mọi khẳng định giữ nguyên
 * từng dòng. Nó chỉ thôi lấy tốc độ máy làm điều kiện đạt, và chỉ trong tệp này
 * chứ không phải cả repo: `vitest.config.ts` là cổng chung, và bản nâng
 * `testTimeout` cho toàn repo đã có ở nhánh `mungvu2004/debt-share` — chốt nó
 * là việc của người duyệt.
 */
vi.setConfig({ testTimeout: 20_000 });

/* ==========================================================================
 * A. Bảy trạng thái (A11 / R-63).
 * ========================================================================== */

describe('A11 — bảy trạng thái của ShareDialog', () => {
  it('dựng đủ bảy, không trạng thái nào ra màn trắng', async () => {
    const ShareDialogView = await loadShareDialogView();
    const covered: string[] = [];

    expectSevenStates((scenario) => {
      covered.push(scenario.label);

      return renderWithProviders(<ShareDialogView {...buildShareDialogProps(scenario.state)} />);
    }, createSevenStateScenarios());

    expect(covered).toHaveLength(SEVEN_STATES.length);
  });
});

/* ==========================================================================
 * B. Tiếp cận được, toàn chữ tiếng Việt có dấu, không mã màu thô (R-72, R-67, A1).
 * ========================================================================== */

describe('R-72 — expectAccessible và expectVietnamese trên cây render thật', () => {
  it('trạng thái "thành công" tiếp cận được và toàn chữ tiếng Việt có dấu', async () => {
    const ShareDialogView = await loadShareDialogView();
    const { container } = renderWithProviders(
      <ShareDialogView {...buildShareDialogProps('success')} />,
    );

    // Ngoại lệ, không cái nào là chữ của màn:
    //
    // - `^https?://` — ô địa chỉ chia sẻ mang một URL do máy chủ cấp. Cách né số 2.
    // - `^Level \d+$` — TÊN TẦNG đọc nguyên văn từ `SAMPLE_BUILDING` (`sampleBuilding.ts:85`).
    //   Màn không được tự đặt lại tên tầng, y như nó không được viết lại tên phòng. Neo y
    //   hệt `ExportPanel.test.tsx:110`.
    // - ba địa chỉ thư của thành viên. Đo được ở lớp gộp: một địa chỉ thư KHÔNG THỂ qua
    //   phép soát này — nó không mang nổi một dấu tiếng Việt, nên hoặc rớt vì một từ tiếng
    //   Anh, hoặc rớt vì "cả chuỗi là tiếng Việt không dấu". Đây là cách repo đã xử đúng
    //   tình huống ấy hai lần: `ProfileSection.test.tsx:273`, `AccountSettings.test.tsx:517`.
    //   Danh sách đọc từ fixture, không chép tay, nên nó không nới ra quá ba chuỗi đó.
    expectVietnamese(container, {
      ignore: [/^https?:\/\//u, /^Level \d+$/u, ...SAMPLE_MEMBER_EMAILS],
    });

    // Hộp thoại dựng NGOÀI `container` của lượt render (`Modal.Root` vẽ ở lớp cố định),
    // nên soát cả `body`; bỏ đúng một phần tử là cái vỏ `role="dialog"`. Cách né số 1.
    expectAccessible(document.body, { ignoreSelector: '[role="dialog"]' });
  });

  it('cả bảy trạng thái đều tiếp cận được', async () => {
    const ShareDialogView = await loadShareDialogView();

    for (const state of SEVEN_STATES) {
      const { unmount } = renderWithProviders(<ShareDialogView {...buildShareDialogProps(state)} />);

      expect(() => {
        expectAccessible(document.body, { ignoreSelector: '[role="dialog"]' });
      }, `trạng thái: ${state}`).not.toThrow();
      unmount();
    }
  });
});

describe('A1 — không một mã màu thô nào trong cả thư mục màn', () => {
  it('expectNoRawColor("src/screens/export/ShareDialog") không ném lỗi', () => {
    expect(() => {
      expectNoRawColor(SCREEN_DIRECTORY);
    }).not.toThrow();
  });
});

/* ==========================================================================
 * C. Chống ghép chuỗi — tiêu chí nghiệm thu của đặc tả.
 *
 * "Không tự ghép URL chia sẻ, không tự sinh mã nhúng bằng chuỗi." Bài này đọc
 * MÃ NGUỒN của thư mục màn thay vì đọc DOM, vì lệnh cấm là lệnh cấm về cách viết:
 * một view ghép đúng chuỗi hôm nay vẫn ghép sai vào ngày `EMBED_PARAM_KEYS` đổi.
 * Có tiền lệ đọc file trong test màn: `RuleSettings.test.tsx:124`.
 * ========================================================================== */

/**
 * File CHẠY ĐƯỢC của màn: bỏ test, bỏ story, và bỏ `shareDialogFixtures.ts`.
 *
 * Fixture đóng vai câu trả lời của máy chủ — một `ShareLink` đến kèm địa chỉ đã thành
 * hình — nên nó được phép mang một URL viết sẵn. Lệnh cấm nhắm vào view và hook: hai
 * thứ đó phải nhận URL và mã nhúng từ `model`, không được tự dựng.
 */
function listRunnableScreenFiles(): readonly string[] {
  return readdirSync(SCREEN_DIRECTORY).filter(
    (name) =>
      (name.endsWith('.ts') || name.endsWith('.tsx')) &&
      !name.endsWith('.test.tsx') &&
      !name.endsWith('.stories.tsx') &&
      name !== 'shareDialogFixtures.ts',
  );
}

/**
 * Bỏ chú thích trước khi quét, vì lệnh cấm nói về mã CHẠY ĐƯỢC.
 *
 * Chỉ bỏ khối `/* … *\/` và những dòng MỞ ĐẦU bằng `//`. Cố tình không bỏ `//` giữa
 * dòng: `const url = 'https://' + host` là đúng thứ bài này đi tìm, và một phép bỏ chú
 * thích ngây thơ sẽ xoá mất nó.
 */
function stripComments(source: string): string {
  return source
    .replace(/\/\*[\s\S]*?\*\//gu, '')
    .split('\n')
    .filter((line) => !/^\s*\/\//u.test(line))
    .join('\n');
}

describe('CẤM — màn không tự ghép URL chia sẻ và không tự sinh mã nhúng', () => {
  it('không file chạy được nào của màn chứa một địa chỉ http, hay một thẻ <iframe>', () => {
    const files = listRunnableScreenFiles();
    const offenders: string[] = [];

    for (const file of files) {
      const source = stripComments(readFileSync(join(SCREEN_DIRECTORY, file), 'utf8'));

      if (/https?:\/\//u.test(source)) {
        offenders.push(`${file}: một địa chỉ http trong mã chạy được`);
      }
      if (/<iframe/iu.test(source)) {
        offenders.push(`${file}: một thẻ <iframe> trong mã chạy được`);
      }
    }

    // In ra để lớp gộp thấy rõ bài này đã soi những file nào — ở nhánh W4 danh sách
    // mới chỉ có `types.ts`, vì view và hook chưa được ghép vào.
    console.log(`[W4] file chạy được đã quét (${String(files.length)}): ${files.join(', ')}`);
    console.log(`[W4] vi phạm ghép chuỗi: ${offenders.length === 0 ? 'không có' : offenders.join(' · ')}`);

    expect(files).toContain('types.ts');
    expect(offenders).toEqual([]);
  });
});

/* ==========================================================================
 * D. Không chào mời thứ chưa hoạt động: mật khẩu, nhúng, góc nhìn, quyền "góp ý".
 * ========================================================================== */

describe('CẤM — hộp thoại không hứa thứ máy chủ và trang chia sẻ không làm', () => {
  it('biểu mẫu tạo liên kết chỉ có hạn dùng: không mật khẩu, không nhúng, không góc nhìn, không chọn quyền', async () => {
    const ShareDialogView = await loadShareDialogView();
    renderWithProviders(<ShareDialogView {...buildShareDialogProps('success')} />);

    expect(document.body.querySelectorAll('input[type="password"]')).toHaveLength(0);
    expect(screen.queryByRole('switch')).toBeNull();
    expect(screen.queryByRole('region', { name: /nhúng/iu })).toBeNull();
    const text = document.body.textContent;
    expect(text).not.toMatch(/mật khẩu|nhúng|góc nhìn/iu);
    expect(screen.queryByRole('combobox', { name: /quyền truy cập/iu })).toBeNull();
    expect(screen.getByRole('combobox', { name: /hạn dùng/iu })).toBeInTheDocument();
  });

  it('liên kết cũ mang quyền "góp ý" vẫn hiện đúng nhãn trong danh sách', async () => {
    const ShareDialogView = await loadShareDialogView();
    const props = buildShareDialogProps('success');
    renderWithProviders(<ShareDialogView {...props} />);

    expect(props.model.rows.map((row) => row.permissionLabel)).toContain('Góp ý');
    expect(document.body.textContent).toContain('Góp ý');
  });

  it('tạo liên kết gửi quyền xem, không mật khẩu, không góc nhìn', async () => {
    const useShareDialog = await loadUseShareDialog();
    const create = vi.fn<ShareLinkGateway['create']>(() =>
      Promise.resolve({ ok: true, data: SAMPLE_ACTIVE_LINK }),
    );
    const { result } = renderHook(
      () =>
        useShareDialog({
          gateway: buildFakeGateway({ create }),
          projectId: SAMPLE_PROJECT_ID,
          roles: ['admin'],
          members: SAMPLE_MEMBERS,
        }),
      { wrapper: withQueryClient() },
    );

    await waitFor(() => {
      expect(result.current[0].form.canSubmit).toBe(true);
    });
    act(() => result.current[1].createLink());
    await waitFor(() => {
      expect(create).toHaveBeenCalledTimes(1);
    });

    const sent = create.mock.calls[0]?.[0].body as unknown as Record<string, unknown>;
    expect(sent.permission).toBe('view');
    expect(sent).not.toHaveProperty('password');
    expect(sent.viewpointCode ?? null).toBeNull();
  });
});

describe('B-V3-09 — hộp thoại đóng thì không đọc danh sách liên kết', () => {
  it('isOpen=false: list không được gọi; mở ra thì đọc', async () => {
    const useShareDialog = await loadUseShareDialog();
    const list = vi.fn(() => Promise.resolve({ ok: true as const, data: [] }));
    const { rerender } = renderHook(
      ({ isOpen }: { isOpen: boolean }) =>
        useShareDialog({
          gateway: buildFakeGateway({ list }),
          projectId: SAMPLE_PROJECT_ID,
          roles: ['admin'],
          isOpen,
        }),
      { wrapper: withQueryClient(), initialProps: { isOpen: false } },
    );

    await Promise.resolve();
    expect(list).not.toHaveBeenCalled();

    rerender({ isOpen: true });
    await waitFor(() => {
      expect(list).toHaveBeenCalledTimes(1);
    });
  });
});

describe('A9 — thu hồi không hoàn tác được nên hỏi trước (B-V3-06)', () => {
  it('"thu hồi" chỉ mở câu hỏi; "để nguyên" không gửi gì; xác nhận mới gửi lệnh thu hồi', async () => {
    const useShareDialog = await loadUseShareDialog();
    const revoke = vi.fn(() => Promise.resolve({ ok: true as const, data: undefined }));
    const { result } = renderHook(
      () =>
        useShareDialog({
          gateway: buildFakeGateway({
            list: () => Promise.resolve({ ok: true, data: [SAMPLE_ACTIVE_LINK] }),
            revoke,
          }),
          projectId: SAMPLE_PROJECT_ID,
          roles: ['admin'],
          members: SAMPLE_MEMBERS,
        }),
      { wrapper: withQueryClient() },
    );

    await waitFor(() => {
      expect(result.current[0].rows).toHaveLength(1);
    });
    const linkId = result.current[0].rows[0]?.id ?? '';

    act(() => result.current[1].revokeLink(linkId));
    expect(result.current[0].pendingRevokeUrl).toBe(result.current[0].rows[0]?.url);
    act(() => result.current[1].cancelRevoke());
    expect(result.current[0].pendingRevokeUrl).toBeNull();
    expect(revoke).not.toHaveBeenCalled();

    act(() => result.current[1].revokeLink(linkId));
    act(() => result.current[1].confirmRevoke());
    await waitFor(() => {
      expect(revoke).toHaveBeenCalledTimes(1);
    });
    expect(result.current[0].pendingRevokeUrl).toBeNull();
  });
});

/* ==========================================================================
 * G. Không nút Lưu, không nút Huỷ (A7 và lệnh cấm của đặc tả).
 * ========================================================================== */

/** Hỏi cả hai ngôn ngữ cùng lúc — một nút "Save" lọt vào cũng vi phạm đúng bất biến ấy. */
const SAVE_BUTTON_NAMES = /^\s*(l[uư]u|save)\s*$/iu;
const CANCEL_BUTTON_NAMES = /^\s*(hu[ỷy]|cancel)\s*$/iu;

describe('A7 — không nút lưu, và không nút huỷ, ở bất kỳ trạng thái nào', () => {
  it('bảy trạng thái, không trạng thái nào mọc ra nút lưu hay nút huỷ', async () => {
    const ShareDialogView = await loadShareDialogView();

    for (const state of SEVEN_STATES) {
      const { unmount } = renderWithProviders(<ShareDialogView {...buildShareDialogProps(state)} />);

      expect(
        screen.queryAllByRole('button', { name: SAVE_BUTTON_NAMES }),
        `nút lưu ở trạng thái: ${state}`,
      ).toHaveLength(0);
      expect(
        screen.queryAllByRole('button', { name: CANCEL_BUTTON_NAMES }),
        `nút huỷ ở trạng thái: ${state}`,
      ).toHaveLength(0);
      unmount();
    }
  });

  it('trạng thái "thành công" vẫn nói ra mốc tự lưu, vì không có nút lưu để bấm', async () => {
    const ShareDialogView = await loadShareDialogView();
    const props = buildShareDialogProps('success');

    expect(props.model.savedAtLabel).not.toBeNull();
    renderWithProviders(<ShareDialogView {...props} />);

    expect(document.body.textContent).toContain(props.model.savedAtLabel ?? '');
  });
});

/* ==========================================================================
 * H. Esc đóng lớp trên cùng (A12).
 *
 * `Modal.Root` TỰ xử Esc (`Modal.tsx:59-72,77-80`), nên bài này đo HÀNH VI — bấm Esc thì
 * `actions.dismiss` được gọi — chứ không đo cài đặt. Màn không được gọi `createFocusTrap`
 * lần nữa; nếu nó gọi, hai lớp bẫy chồng nhau và bài này vẫn xanh, nên chuyện đó thuộc
 * phần soát mã của lớp gộp, không phải phần đo được ở đây.
 * ========================================================================== */

describe('A12 — Esc đóng hộp thoại', () => {
  it('bấm Esc trong hộp thoại gọi actions.dismiss', async () => {
    const ShareDialogView = await loadShareDialogView();
    const dismiss = vi.fn();

    renderWithProviders(<ShareDialogView {...buildShareDialogProps('success', {}, { dismiss })} />);

    const dialog = await screen.findByRole('dialog');

    // Bẫy tiêu điểm gắn listener bên trong một `requestAnimationFrame`, nên phép bấm
    // được thử lại cho tới khi listener có mặt — `waitFor` chạy lại CẢ callback.
    await waitFor(() => {
      fireEvent.keyDown(dialog, { key: 'Escape' });
      expect(dismiss).toHaveBeenCalled();
    });
  });

  it('isOpen=false thì không dựng hộp thoại nào', async () => {
    const ShareDialogView = await loadShareDialogView();
    const props: ShareDialogProps = { ...buildShareDialogProps('success'), isOpen: false };

    renderWithProviders(<ShareDialogView {...props} />);

    expect(screen.queryByRole('dialog')).toBeNull();
  });
});

/* ==========================================================================
 * F-06 — máy chủ v1 không phục vụ liên kết chia sẻ (BE-BIND #47–#49 là v2).
 * ========================================================================== */

describe('F-06 — liên kết chia sẻ tắt (cổng `supported: false`)', () => {
  it('vai kỹ sư: không lượt gọi nào tới cổng; trạng thái không forbidden, không loading treo', async () => {
    const useShareDialog = await loadUseShareDialog();
    const list = vi.fn(() => Promise.resolve({ ok: true as const, data: [] }));
    const create = vi.fn(() => Promise.resolve({ ok: true as const, data: SAMPLE_ACTIVE_LINK }));
    const revoke = vi.fn(() => Promise.resolve({ ok: true as const, data: undefined }));
    const { result } = renderHook(
      () =>
        useShareDialog({
          gateway: buildFakeGateway({ supported: false, list, create, revoke }),
          projectId: SAMPLE_PROJECT_ID,
          roles: ['engineer'],
          members: SAMPLE_MEMBERS,
        }),
      { wrapper: withQueryClient() },
    );

    act(() => result.current[1].createLink());
    act(() => result.current[1].revokeLink(SAMPLE_ACTIVE_LINK.id));
    act(() => result.current[1].confirmRevoke());
    // `mutate` qua vài nhịp `await` rồi mới gọi `mutationFn`: chờ hết hàng vi tác vụ và
    // một vòng macrotask, để bỏ chặn của `createLink` thì `create` kịp chạy và bài đỏ.
    await act(async () => {
      await new Promise<void>((resolve) => {
        setTimeout(resolve, 0);
      });
    });

    const [model] = result.current;
    expect(model.linksSupported).toBe(false);
    expect(model.state).toBe('success');
    expect(model.noPermissionReason).toBeNull();
    expect(model.form.canSubmit).toBe(false);
    expect(model.pendingRevokeUrl).toBeNull();
    expect(list).not.toHaveBeenCalled();
    expect(create).not.toHaveBeenCalled();
    expect(revoke).not.toHaveBeenCalled();
  });

  it('view: không vùng liên kết; "người có quyền" vẫn hiện', async () => {
    const ShareDialogView = await loadShareDialogView();
    renderWithProviders(
      <ShareDialogView {...buildShareDialogProps('success', buildLinksUnsupportedModel())} />,
    );

    expect(screen.getByRole('region', { name: /người có quyền/iu })).toBeInTheDocument();
    expect(screen.queryByRole('region', { name: /liên kết chia sẻ/iu })).not.toBeInTheDocument();
  });
});
