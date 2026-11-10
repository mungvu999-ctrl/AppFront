/**
 * Lượt kiểm cấp màn của `MobileViewer` (T8) — `/m/du-an/:projectId`, xem 3D
 * CHỈ ĐỌC trên điện thoại.
 *
 * `MobileViewer.tsx` CHƯA tồn tại trong worktree này — T7 đang viết nó song
 * song, từ cùng hợp đồng `mobileViewerTypes.ts`. File này vì vậy ĐỎ ngay ở
 * `import { MobileViewer } from './MobileViewer'` cho tới khi lớp gộp nối hai
 * nhánh lại; đó là kết quả ĐÚNG của lượt này (không phải `.skip`, không nới
 * điều kiện — R-70), cùng khuôn `ExplodedView.test.tsx`. View thuần: test
 * được chỉ từ props, không chạm store, không chạm mạng (mục D).
 *
 * ## Bài kiểm "chỉ đọc" là quan trọng nhất
 *
 * Đặc tả gọi việc không cho sửa dữ liệu trên điện thoại là "hạn chế có ý
 * thức", không phải phần còn thiếu. Bài kiểm ở mục dưới cùng tên khẳng định
 * đúng điều đó: chạm vào một đối tượng, tấm thông tin mở ra, và không một ô
 * nhập nào — `input`, `textarea`, `select`, `[contenteditable]` — có mặt
 * trong cây, ở CẢ BẢY trạng thái.
 *
 * ## Vùng bấm 44px — không phải phép đo pixel thật
 *
 * Khảo sát (`ui-a11y-contract.md` mục (d)) đã đo bằng chạy thật: `jsdom`
 * không có layout engine, nên `getBoundingClientRect()`/`offsetWidth` của MỌI
 * phần tử đều trả về 0×0 — không thể đo pixel thật ở đây. Bài kiểm dưới suy
 * ra kích thước từ CHÍNH LỚP CSS mà khảo sát đã quy đổi thật (không đoán từ
 * comment): `IconButton` `size="lg"` mang class `h-10 w-10` và bằng đúng 44px
 * SAU khi cộng đệm `p-0.5` hai cạnh (40 + 2 + 2); `size="md"` mặc định
 * (`h-9 w-9`) chỉ ra 40px, KHÔNG đạt. Phép đo pixel thật thuộc bộ Playwright
 * của T4 (`pnpm e2e`), không phải bài kiểm này.
 *
 * ## Esc đóng lớp trên cùng (A12) — giả định ghi rõ
 *
 * `MobileViewerProps` không có `registry`/`onEscape` riêng; hợp đồng chỉ cho
 * `onDismissSelection` và `onSelectTool`. Khảo sát mục (b).4 đã đo thật:
 * `Drawer.tsx` tự đăng ký `useShortcut({ combo: 'Escape', ... })` NGAY BÊN
 * TRONG chính nó, không chờ một container ở ngoài — và hợp đồng
 * `mobileViewerTypes.ts` mục 1 nói tấm thông tin của màn này CHÉP logic kéo
 * của `Drawer.tsx`. Hai bài kiểm dưới đây giả định tấm thông tin làm y hệt
 * cho Esc: tự bắt phím, gọi thẳng prop đóng của chính nó. Đây là giả định hợp
 * lý nhất có thể viết trước khi view tồn tại, không phải một sự thật đã đo —
 * nếu lớp gộp chọn một cơ chế khác (ví dụ đăng ký ở `useMobileViewer.ts` như
 * khuôn `MeasurementTool`/`shortcutRegistry`), người gộp sửa lại đúng hai bài
 * này, không sửa phần còn lại của file.
 *
 * ## `installFakeClock` — không cần trong file này
 *
 * Không có debounce/đồng hồ nào ở tầng view của màn này (autosave A7 không áp
 * dụng cho một màn chỉ đọc); mọi bài kiểm dưới đồng bộ, nên không có
 * `waitFor`/`installFakeClock` nào — cạm bẫy thứ tự giữa hai cái đó (đặt
 * `installFakeClock` SAU `waitFor`) không áp dụng ở đây.
 */

import { fireEvent, within } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { expectAccessible } from '@/lib/testing/expectAccessible';
import { expectNoRawColor } from '@/lib/testing/expectNoRawColor';
import { expectSevenStates } from '@/lib/testing/expectSevenStates';
import { expectVietnamese } from '@/lib/testing/expectVietnamese';
import { renderWithProviders } from '@/lib/testing/render';
import { SEVEN_STATES, SEVEN_STATE_LABELS, type SevenStateScenario } from '@/lib/testing/sevenStateScenarios';

import { MobileViewer } from './MobileViewer';
import { MOBILE_VIEWER_SCENARIOS, mobileViewerScenarioFor } from './mobileViewerScenarios';
import { MOBILE_VIEWER_TOOLS, MOBILE_VIEWER_TOOLS_COMPACT, type MobileViewerProps } from './mobileViewerTypes';

function renderMobileViewer(props: MobileViewerProps) {
  return renderWithProviders(<MobileViewer {...props} />);
}

/** Tấm thông tin là một lớp nổi (`role="dialog"`) — khoanh vùng nó ra khỏi expectAccessible (mục (b)/(c) của khảo sát). */
const INFO_SHEET_IGNORE = { ignoreSelector: '[role="dialog"]' };

/* -------------------------------------------------------------------------- */
/* [A11] Bảy trạng thái, không lần nào ra màn trắng.                           */
/* -------------------------------------------------------------------------- */

function scenarioIndex(): readonly SevenStateScenario[] {
  return SEVEN_STATES.map((state) => {
    const props = mobileViewerScenarioFor(state);

    return {
      state,
      label: SEVEN_STATE_LABELS[state],
      rows: [],
      totalCount: props.floors.length,
      isLoading: state === 'loading',
      isCollapsed: state === 'collapsed',
      canView: state !== 'forbidden',
      error: state === 'error' ? new Error('máy yếu') : null,
    };
  });
}

describe('MobileViewer — bảy trạng thái (A11)', () => {
  it('vẽ đủ bảy trạng thái, không lần nào ném lỗi và không lần nào ra màn trắng', () => {
    let rendered = 0;

    expectSevenStates((scenario) => {
      const props = mobileViewerScenarioFor(scenario.state);
      const { container, unmount } = renderMobileViewer(props);

      rendered += 1;

      return { container, unmount };
    }, scenarioIndex());

    expect(rendered).toBe(SEVEN_STATES.length);
    expect(rendered).toBe(7);
  });
});

/* -------------------------------------------------------------------------- */
/* [R-72] Khả năng tiếp cận, tiếng Việt, không mã màu thô.                     */
/* -------------------------------------------------------------------------- */

describe('MobileViewer — khả năng tiếp cận, tiếng Việt, không mã màu thô (R-72)', () => {
  it.each(MOBILE_VIEWER_SCENARIOS)('trạng thái "$state" tiếp cận được (tấm thông tin bị bỏ qua đúng cách)', ({ props }) => {
    const { container } = renderMobileViewer(props);

    expectAccessible(container, INFO_SHEET_IGNORE);
  });

  it.each(MOBILE_VIEWER_SCENARIOS)('trạng thái "$state": mọi chuỗi hiển thị là tiếng Việt có dấu', ({ props }) => {
    const { container } = renderMobileViewer(props);

    expectVietnamese(container);
  });

  it('không một mã màu thô nào trong cả thư mục màn', () => {
    expect(() => {
      expectNoRawColor('src/screens/system/MobileViewer');
    }).not.toThrow();
  });
});

/* -------------------------------------------------------------------------- */
/* Chỉ đọc — bài kiểm QUAN TRỌNG NHẤT của màn này.                             */
/* -------------------------------------------------------------------------- */

describe('MobileViewer — chỉ đọc, không một ô nhập nào (hạn chế có ý thức của đặc tả)', () => {
  it.each(MOBILE_VIEWER_SCENARIOS)(
    'trạng thái "$state": không có input, textarea, select, hay [contenteditable] nào trong cây',
    ({ props }) => {
      const { container } = renderMobileViewer(props);

      const editableNodes = container.querySelectorAll('input, textarea, select, [contenteditable]');

      expect(editableNodes.length).toBe(0);
    },
  );

  it('chạm vào một tường mở tấm thông tin (kịch bản "success" đã ở trạng thái đó) — vẫn không một ô nhập nào, kể cả bên trong tấm', () => {
    const props = mobileViewerScenarioFor('success');

    expect(props.selection).not.toBeNull();
    expect(props.selection?.needsDesktopToEdit).toBe(true);

    const { container } = renderMobileViewer(props);
    const dialog = container.querySelector('[role="dialog"]');

    expect(dialog).not.toBeNull();

    if (dialog === null) {
      throw new Error('không thể tới đây — đã khẳng định ở trên');
    }

    const editableInsideSheet = within(dialog as HTMLElement).queryAllByRole('textbox');

    expect(editableInsideSheet).toHaveLength(0);
    expect(dialog.querySelectorAll('input, textarea, select, [contenteditable]')).toHaveLength(0);
  });
});

/* -------------------------------------------------------------------------- */
/* Vùng bấm >= 44px — suy từ lớp CSS, không phải phép đo pixel (jsdom 0x0).    */
/* -------------------------------------------------------------------------- */

/**
 * `size="lg"` của `IconButton` cho `h-10 w-10` (40px nội dung, `box-content`)
 * cộng đệm `p-0.5` hai cạnh (2px × 2) = 44px thật — số đã đo trong khảo sát
 * mục (d), không phải suy đoán.
 */
function hasAdequateHitTarget(element: Element): boolean {
  if (element.classList.contains('h-10') && element.classList.contains('w-10')) {
    return true;
  }

  for (let ancestor: Element | null = element; ancestor !== null; ancestor = ancestor.parentElement) {
    if (ancestor.classList.contains('min-h-11') || ancestor.classList.contains('min-w-11')) {
      return true;
    }
  }

  return false;
}

describe('MobileViewer — vùng bấm >= 44px, ở mức suy ra được từ jsdom (A9/đặc tả "Vùng bấm không dưới 44px")', () => {
  it('mọi nút chỉ mang icon (không chữ, có aria-label) đạt size="lg" hoặc được bọc trong khung min-h-11/min-w-11', () => {
    const { container } = renderMobileViewer(mobileViewerScenarioFor('success'));

    const iconOnlyButtons = Array.from(container.querySelectorAll('button')).filter(
      (button) => (button.textContent ?? '').trim() === '' && button.hasAttribute('aria-label'),
    );

    // Thanh trên (chia sẻ) + thanh dưới (bốn công cụ) đủ để danh sách này khác rỗng —
    // một khẳng định trên tập rỗng không kiểm được gì.
    expect(iconOnlyButtons.length).toBeGreaterThan(0);

    for (const button of iconOnlyButtons) {
      expect(
        hasAdequateHitTarget(button),
        `nút "${button.getAttribute('aria-label') ?? ''}" (class="${button.className}") không đạt 44px — dùng size="lg" hoặc bọc min-h-11 min-w-11`,
      ).toBe(true);
    }
  });
});

/* -------------------------------------------------------------------------- */
/* Thu gọn ở 320.                                                              */
/* -------------------------------------------------------------------------- */

describe('MobileViewer — `partial` nói đúng lý do (B-V1-11)', () => {
  const MISSING_ROOMS_NOTE = 'Mô hình mới có một phần: một số tầng chưa có phòng nào được dựng từ bản vẽ.';
  const WEAK_NETWORK_NOTE = 'Mạng đang yếu. Mô hình đã tải xong vẫn xem được.';

  it('thiếu phòng: câu thiếu phòng, không câu mạng; hàng tầng mang "chưa có phòng"', () => {
    const props = { ...mobileViewerScenarioFor('partial'), activeTool: 'floors' as const };
    const { getByText, queryByText, getAllByText } = renderMobileViewer(props);

    expect(getByText(MISSING_ROOMS_NOTE)).toBeInTheDocument();
    expect(queryByText(WEAK_NETWORK_NOTE)).toBeNull();
    expect(getAllByText('Chưa có phòng')).toHaveLength(2);
    expect(queryByText(/^chưa tải$/iu)).toBeNull();
  });

  it('mạng yếu: câu mạng, không câu thiếu phòng', () => {
    const props = { ...mobileViewerScenarioFor('partial'), partialReason: 'weak-network' as const };
    const { getByText, queryByText } = renderMobileViewer(props);

    expect(getByText(WEAK_NETWORK_NOTE)).toBeInTheDocument();
    expect(queryByText(MISSING_ROOMS_NOTE)).toBeNull();
  });

  it('`partial` không bao giờ đọc "Mô hình đã dựng xong.", kể cả khi thiếu lý do và không có nhãn mức chi tiết', () => {
    const props = { ...mobileViewerScenarioFor('partial'), partialReason: null, detailLabel: null };
    const { queryAllByText, getByText } = renderMobileViewer(props);

    expect(queryAllByText(/^mô hình đã dựng xong\.$/iu)).toHaveLength(0);
    expect(getByText(MISSING_ROOMS_NOTE)).toBeInTheDocument();
  });
});

describe('MobileViewer — thu gọn ở 320 (MOBILE_VIEWER_COMPACT_WIDTH_PX)', () => {
  it('MOBILE_VIEWER_TOOLS_COMPACT gộp còn ba — "view" là cái bị gộp vào, không phải cái bị bỏ (dữ liệu hợp đồng, không phụ thuộc view)', () => {
    expect(MOBILE_VIEWER_TOOLS).toHaveLength(4);
    expect(MOBILE_VIEWER_TOOLS).toContain('view');
    expect(MOBILE_VIEWER_TOOLS_COMPACT).toHaveLength(3);
    expect(MOBILE_VIEWER_TOOLS_COMPACT).toEqual(['floors', 'measure', 'info']);
    expect(MOBILE_VIEWER_TOOLS_COMPACT).not.toContain('view');
  });

  it('isCompact=true: chức năng "Chế độ xem" vẫn tới được — nó chuyển thành một hàng trong tấm "tầng" đang mở, không biến mất', () => {
    const props = mobileViewerScenarioFor('collapsed');

    expect(props.isCompact).toBe(true);
    expect(props.activeTool).toBe('floors');

    const { getByRole } = renderMobileViewer(props);

    expect(getByRole('button', { name: 'Chế độ xem' })).toBeInTheDocument();
  });
});

/* -------------------------------------------------------------------------- */
/* Esc đóng lớp trên cùng (A12).                                               */
/* -------------------------------------------------------------------------- */

describe('MobileViewer — Esc đóng lớp trên cùng (A12)', () => {
  it('tấm thông tin đang mở: Esc gọi onDismissSelection — tấm thông tin luôn là lớp nổi trên cùng khi nó có mặt', () => {
    const onDismissSelection = vi.fn();
    const props: MobileViewerProps = { ...mobileViewerScenarioFor('success'), onDismissSelection };

    renderMobileViewer(props);
    fireEvent.keyDown(document.body, { key: 'Escape' });

    expect(onDismissSelection).toHaveBeenCalledTimes(1);
  });

  it('không có tấm thông tin, chỉ một tấm công cụ đang mở: Esc gọi onSelectTool(null)', () => {
    const onSelectTool = vi.fn();
    const props: MobileViewerProps = {
      ...mobileViewerScenarioFor('collapsed'),
      selection: null,
      activeTool: 'floors',
      onSelectTool,
    };

    renderMobileViewer(props);
    fireEvent.keyDown(document.body, { key: 'Escape' });

    expect(onSelectTool).toHaveBeenCalledWith(null);
  });
});

/* -------------------------------------------------------------------------- */
/* F-06 — liên kết chia sẻ tắt (v1): nút rời DOM, câu mời sửa trên máy tính giữ. */
/* -------------------------------------------------------------------------- */

describe('MobileViewer — liên kết chia sẻ tắt thì hai nút chia sẻ rời DOM (F-06)', () => {
  it('onShare và onSendDesktopLink là null: không nút "Chia sẻ dự án", không nút gửi; câu nhắc vẫn còn', () => {
    const props = { ...mobileViewerScenarioFor('success'), onShare: null, onSendDesktopLink: null };
    const { getByText, queryByRole } = renderMobileViewer(props);

    expect(props.selection?.needsDesktopToEdit).toBe(true);
    expect(queryByRole('button', { name: 'Chia sẻ dự án' })).toBeNull();
    expect(queryByRole('button', { name: 'Gửi liên kết sang máy tính' })).toBeNull();
    expect(getByText('Sửa trên máy tính để chính xác hơn')).toBeInTheDocument();
  });

  it('có hai hành động thì hai nút có mặt', () => {
    const props = { ...mobileViewerScenarioFor('success'), onShare: vi.fn(), onSendDesktopLink: vi.fn() };
    const { getByRole } = renderMobileViewer(props);

    expect(getByRole('button', { name: 'Chia sẻ dự án' })).toBeInTheDocument();
    expect(getByRole('button', { name: 'Gửi liên kết sang máy tính' })).toBeInTheDocument();
  });
});

describe('câu báo dự phòng thư viện/concept', () => {
  it('hiện câu báo trong vùng role="status"; vắng thì không có', async () => {
    const { LIBRARY_FALLBACK_NOTICE } = await import('@/lib/pascal/serverLibrary');
    const base = mobileViewerScenarioFor('success');
    const shown = renderMobileViewer({ ...base, sceneNotice: LIBRARY_FALLBACK_NOTICE });
    expect(within(shown.container).getByText(LIBRARY_FALLBACK_NOTICE)).toHaveAttribute('role', 'status');
    shown.unmount();
    const hidden = renderMobileViewer(base);
    expect(within(hidden.container).queryByText(LIBRARY_FALLBACK_NOTICE)).toBeNull();
  });
});
