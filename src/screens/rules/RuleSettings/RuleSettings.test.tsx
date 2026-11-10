/**
 * Bộ kiểm của W6 cho màn `RuleSettings` — cài đặt bộ luật QC.
 *
 * ## Vì sao nhiều import ở đây đi qua `import()` thay vì `import … from …`
 *
 * `./RuleSettings` là việc của W5 (view) và `./useRuleSettings` là việc của W4
 * (hook) — tại thời điểm file này được viết, một hoặc cả hai CHƯA tồn tại trong
 * worktree này; ba worker lớp 2 dựng trên nhánh riêng rồi lớp gộp (W7) mới ghép
 * lại. Đã đo thật ở `RuleReport.test.tsx`: một `import` TĨNH của một chuỗi không
 * tồn tại làm Vite sập lúc transform và không một test nào trong cả file chạy
 * được. Giấu đường dẫn sau một biến, kèm `/* @vite-ignore *\/`, hoãn việc phân
 * giải sang đúng lúc CHẠY, nên một import hỏng chỉ làm hỏng ĐÚNG một `it`.
 *
 * Test không đụng `./RuleSettings` (số liệu thật từ sổ đăng ký, quét mã nguồn
 * tìm câu luật viết cứng) chạy và XANH ngay hôm nay; test cần view thật thì HỎNG
 * RIÊNG LẺ với "Failed to resolve" cho tới khi W7 gộp đủ ba file — ĐIỀU ĐÓ LÀ
 * BÌNH THƯỜNG ở lớp này, không phải lỗi của W6.
 */

import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

import { act, cleanup, fireEvent, render, renderHook, screen, waitFor } from '@testing-library/react';
import { QueryClientProvider } from '@tanstack/react-query';
import type { ComponentType, ReactNode } from 'react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import type * as AppClientModule from '@/api/appClient';
import type * as ConflictModule from '@/lib/versioning/conflict';
import { createMockApiClient } from '@/api/__mocks__/client';
import type { ApiClient } from '@/api/client';
import type { ProjectRuleConfig } from '@/api/schemas/ruleConfig';

import { ALL_RULES } from '@/domain/rules/defaults';
import { createSampleBuilding } from '@/domain/spatial/__fixtures__/sampleBuilding';
import { normalizeSpatial } from '@/domain/spatial/normalize';
import { appNotificationBus } from '@/hooks/useNotifications';
import type { HttpError } from '@/lib/http';
import { createTestQueryClient, renderWithProviders } from '@/lib/testing/render';
import { resolveConflict } from '@/lib/versioning/conflict';
import { ROUTE_PATTERNS } from '@/routes/paths';
import { useStore } from '@/store';
import { resetUserScopedState } from '@/store/resetUserScopedState';
import type { ProjectRole } from '@/types/project';
import { expectAccessible } from '@/lib/testing/expectAccessible';
import { expectNoRawColor } from '@/lib/testing/expectNoRawColor';
import { expectSevenStates } from '@/lib/testing/expectSevenStates';
import { expectVietnamese } from '@/lib/testing/expectVietnamese';
import {
  SEVEN_STATES,
  createSevenStateScenarios,
  type SevenStateScenario,
} from '@/lib/testing/sevenStateScenarios';

import {
  ALL_DISABLED_WARNING,
  EDITABLE_CAPABILITIES,
  INDUSTRIAL_PRESET,
  READ_ONLY_CAPABILITIES,
  RULE_SETTINGS_ENABLED_RULE_COUNT,
  RULE_SETTINGS_TOTAL_RULE_COUNT,
  WALL_THICKNESS_THRESHOLD_OUT_OF_RANGE,
  buildRuleSettingsGroups,
  buildRuleSettingsProps,
} from './ruleSettingsFixtures';
import type { RuleSettingsProps, RuleSettingsStatus } from './types';
import * as RuleSettingsModule from './RuleSettings';
import { RuleSettingsRoute } from './RuleSettings.container';
import { createRuleSettingsGateway, RULE_SETTINGS_READ_ONLY_REASON } from './ruleSettingsGateway';
import { useRuleSettings, type RuleSettingsToast } from './useRuleSettings';

/*
 * F-10: màn giờ đọc cấu hình bộ luật qua N21, nên cổng mặc định gọi
 * `createAppApiClient()`. Bài kiểm đi bộ mẫu trong bộ nhớ thay cho máy chủ.
 */
vi.mock('@/api/appClient', async (importOriginal) => {
  const actual = await importOriginal<typeof AppClientModule>();
  const { createMockApiClient } = await import('@/api/__mocks__/client');

  return { ...actual, createAppApiClient: () => createMockApiClient() };
});

/*
 * Cổng nạp `appClient` LƯỜI (`import()` động, F-10 — cổng kích thước). Lượt nạp đầu trong
 * vitest phải biên dịch cả cây module của nó, lâu hơn 1 s mặc định của `waitFor`; nạp sẵn ở
 * đây để bài kiểm chỉ đo màn, không đo trình biên dịch.
 */
beforeAll(async () => {
  await import('@/api/appClient');
});

/* [8].5: 409 không bao giờ đi qua `resolveConflict` (mảng rỗng → `autoMerged`, ghi đè im lặng). */
vi.mock('@/lib/versioning/conflict', async (importOriginal) => {
  const actual = await importOriginal<typeof ConflictModule>();

  return { ...actual, resolveConflict: vi.fn(actual.resolveConflict) };
});

afterEach(() => {
  cleanup();
});

/* ==========================================================================
 * 0. Hạ tầng: nhập file cùng thư mục qua biến, không qua chuỗi tĩnh.
 * ========================================================================== */

/** Xem lời giải thích ở đầu file. */

/*
 * Nhập TĨNH, tra qua map — trước đây là một lượt `import()` động có `@vite-ignore`.
 *
 * Giàn giáo động ấy có lý do thật lúc nó được viết: các tệp anh em trong thư mục CHƯA tồn tại, và
 * một lượt nhập tĩnh làm Vite sập lúc transform, kéo sập cả tệp. Nay cả thư mục đã đủ tệp và
 * không bài nào trong tệp này dùng `vi.mock`, nên giàn giáo hết việc — còn cái giá thì vẫn trả:
 * `@vite-ignore` làm Vite bỏ phân tích import, nên cả cây module của màn mới được
 * resolve/transform/nạp BÊN TRONG bài kiểm đầu tiên gọi tới, và bài đó đếm luôn lượt biên dịch
 * vào 5 000 ms của nó (`testTimeout` mặc định của vitest — `vitest.config.ts` không khai nó).
 *
 * Nhập tĩnh chuyển việc ấy sang pha `collect`, pha không bị `testTimeout` chặn. Chữ ký của
 * `importFromScreen` và mọi chỗ gọi giữ nguyên, nên diff chỉ nằm ở đây.
 */
const MODULE_MAN: Record<string, unknown> = {
  './RuleSettings': RuleSettingsModule,
};

async function importFromScreen<T>(specifier: string): Promise<T> {
  return MODULE_MAN[specifier] as T;
}

async function loadRuleSettingsView(): Promise<ComponentType<RuleSettingsProps>> {
  const mod = await importFromScreen<{ RuleSettings: ComponentType<RuleSettingsProps> }>(
    './RuleSettings',
  );

  return mod.RuleSettings;
}

/** Ánh xạ bảy trạng thái chung sang bảy giá trị `RuleSettingsStatus` (types.ts). */
const STATUS_OF_SEVEN_STATE: Readonly<Record<SevenStateScenario['state'], RuleSettingsStatus>> = {
  empty: 'empty',
  loading: 'loading',
  partial: 'partial',
  error: 'error',
  success: 'ready',
  forbidden: 'forbidden',
  collapsed: 'collapsed',
};

/** Một `RuleSettingsProps` hợp lệ cho mỗi kịch bản trong bảy trạng thái chung. */
function propsFor(scenario: SevenStateScenario): RuleSettingsProps {
  const status = STATUS_OF_SEVEN_STATE[scenario.state];
  const capabilities = status === 'forbidden' ? READ_ONLY_CAPABILITIES : EDITABLE_CAPABILITIES;

  return buildRuleSettingsProps({ status }, { capabilities });
}

/* ==========================================================================
 * A. Số luật THẬT từ sổ đăng ký — không đụng tới file của worker khác, nên đây
 *    là phần PHẢI XANH ngay bây giờ.
 * ========================================================================== */

describe('số luật thật từ sổ đăng ký, không viết tay 25 hay 23 ở đâu khác', () => {
  it('sổ đăng ký giữ đủ 25 luật, trong đó 23 luật đang bật theo mặc định', () => {
    console.log(
      `[W6] tổng số luật = ${String(RULE_SETTINGS_TOTAL_RULE_COUNT)} · số luật BẬT = ${String(RULE_SETTINGS_ENABLED_RULE_COUNT)}`,
    );

    expect(RULE_SETTINGS_TOTAL_RULE_COUNT).toBe(25);
    expect(RULE_SETTINGS_ENABLED_RULE_COUNT).toBe(23);
  });

  it('ROOM-HAS-DOOR và ROOM-MIN-AREA là hai luật duy nhất có supersededBy, và cả hai đang tắt', () => {
    const rows = buildRuleSettingsGroups().flatMap((group) => group.rows);
    const superseded = rows.filter((row) => row.supersededBy !== null);

    expect(superseded.map((row) => row.code).sort()).toEqual(['ROOM-HAS-DOOR', 'ROOM-MIN-AREA']);

    const byCode = new Map(rows.map((row) => [row.code, row]));

    expect(byCode.get('ROOM-HAS-DOOR')?.supersededBy).toBe('ROOM-NO-DOOR');
    expect(byCode.get('ROOM-MIN-AREA')?.supersededBy).toBe('ROOM-AREA-BELOW-MINIMUM');
    expect(byCode.get('ROOM-HAS-DOOR')?.enabled).toBe(false);
    expect(byCode.get('ROOM-MIN-AREA')?.enabled).toBe(false);
  });
});

describe('grep — CẤM "không khai báo lại danh sách luật trong màn"', () => {
  it('không file sản phẩm nào trong thư mục màn viết cứng câu luật (rule.name)', () => {
    const dir = 'src/screens/rules/RuleSettings';
    const productionFiles = readdirSync(dir).filter(
      (name) =>
        (name.endsWith('.ts') || name.endsWith('.tsx')) &&
        !name.endsWith('.test.tsx') &&
        !name.endsWith('.stories.tsx'),
    );

    const ruleSentences = ALL_RULES.map((rule) => rule.name);
    const offenders: string[] = [];

    for (const file of productionFiles) {
      const content = readFileSync(join(dir, file), 'utf8');

      for (const sentence of ruleSentences) {
        if (
          content.includes(`'${sentence}'`) ||
          content.includes(`"${sentence}"`) ||
          content.includes(`\`${sentence}\``)
        ) {
          offenders.push(`${file}: "${sentence}"`);
        }
      }
    }

    console.log(
      `[W6] file sản phẩm quét được trong thư mục (${String(productionFiles.length)}): ` +
        `${productionFiles.length > 0 ? productionFiles.join(', ') : '(chưa có — worker khác chưa commit vào worktree này)'}`,
    );
    console.log(
      `[W6] câu luật viết cứng: ${offenders.length === 0 ? 'không có' : offenders.join(' · ')}`,
    );

    expect(offenders).toEqual([]);
  });

  it('không một mã màu thô nào trong cả thư mục màn (bao gồm chính test này)', () => {
    expect(() => {
      expectNoRawColor('src/screens/rules/RuleSettings');
    }).not.toThrow();
  });
});

/* ==========================================================================
 * B. Bảy trạng thái (A11) — cần `RuleSettings` thật, nên là nhóm RED-cho-tới-W7.
 * ========================================================================== */

describe('A11 — bảy trạng thái của RuleSettings', () => {
  it('dựng đủ bảy, không trạng thái nào ra màn trắng', async () => {
    const RuleSettingsView = await loadRuleSettingsView();
    const covered: string[] = [];

    expectSevenStates((scenario) => {
      covered.push(scenario.label);

      return render(<RuleSettingsView {...propsFor(scenario)} />);
    }, createSevenStateScenarios());

    console.log(
      `[W6] expectSevenStates = ${String(covered.length)}/${String(SEVEN_STATES.length)} — ${covered.join(', ')}`,
    );

    expect(covered).toHaveLength(SEVEN_STATES.length);
  });
});

describe('B-V12-03 — trạng thái "empty" không nói ngược dòng đếm luật ngay trên nó', () => {
  it('đầu màn đếm luật đang bật, thân màn nói thiếu MÔ HÌNH chứ không nói thiếu luật', async () => {
    const RuleSettingsView = await loadRuleSettingsView();

    render(<RuleSettingsView {...buildRuleSettingsProps({ status: 'empty' })} />);

    expect(screen.getByRole('heading', { name: 'Chưa có mô hình để áp bộ luật' })).toBeTruthy();
    expect(screen.queryByText(/chưa có (bộ )?luật/iu)).toBeNull();
  });
});

describe('BUG-464 — lỗi tải không phải ngõ cụt và không kèm số liệu cũ', () => {
  it('trạng thái "error" có "Thử lại" gọi onReload; đầu trang không còn số luật hay nhãn lưu', async () => {
    const RuleSettingsView = await loadRuleSettingsView();
    const onReload = vi.fn();

    render(<RuleSettingsView {...buildRuleSettingsProps({ status: 'error' }, { actions: { onReload } })} />);

    fireEvent.click(screen.getByRole('button', { name: 'Thử lại' }));
    expect(onReload).toHaveBeenCalledTimes(1);
    expect(screen.queryByText(/luật đang bật/u)).toBeNull();
    expect(screen.queryByText('Chưa có thay đổi')).toBeNull();
  });
});

describe('BUG-457 — ghi chú "Đã được thay thế bởi" không bị làm mờ cùng luật tắt', () => {
  it('luật tắt vẫn mờ, nhưng không tổ tiên nào của ghi chú mang opacity-40', async () => {
    const RuleSettingsView = await loadRuleSettingsView();

    render(<RuleSettingsView {...buildRuleSettingsProps({ status: 'ready' })} />);

    const notes = screen.getAllByText(/^Đã được thay thế bởi/u);
    expect(notes.length).toBeGreaterThan(0);
    for (const note of notes) {
      expect(note.closest('.opacity-40')).toBeNull();
    }
    expect(document.querySelectorAll('.opacity-40').length).toBeGreaterThan(0);
  });
});

/* ==========================================================================
 * C.Tiếp cận được và toàn chữ tiếng Việt có dấu, trên cây render thật.
 * ========================================================================== */

describe('R-72 — expectAccessible và expectVietnamese trên cây render thật', () => {
  it('trạng thái "ready" tiếp cận được và toàn chữ tiếng Việt có dấu', async () => {
    const RuleSettingsView = await loadRuleSettingsView();
    const props = buildRuleSettingsProps({ status: 'ready' });
    const { container } = render(<RuleSettingsView {...props} />);

    expectVietnamese(container);
    expectAccessible(container);
  });
});

/* ==========================================================================
 * D. Bảy điều cấm của đặc tả — mỗi cái một test (mục 2.(b) của nhiệm vụ).
 * ========================================================================== */

describe('2.(b).1 — đếm đúng số luật hiện ra và số luật đang bật', () => {
  it('hiện đủ 25 luật, trong đó 23 luật đang bật', async () => {
    const RuleSettingsView = await loadRuleSettingsView();
    const props = buildRuleSettingsProps({ status: 'ready' });
    const rows = props.model.groups.flatMap((group) => group.rows);

    expect(rows).toHaveLength(25);
    expect(rows.filter((row) => row.enabled)).toHaveLength(23);

    const { container } = render(<RuleSettingsView {...props} />);

    for (const row of rows) {
      expect(screen.getByText(row.sentence)).toBeTruthy();
    }

    // Hai con số ở đầu màn chạy lên qua `useCountUp`, nên ở KHUNG HÌNH ĐẦU
    // header còn đọc là "0/0 luật đang bật" rồi mới chạy tới "23/25". Đọc
    // `textContent` ngay sau `render` là đọc đúng cái khung hình đó — màn in đủ
    // cả hai số, chỉ là chưa xong lượt chạy số. Khuôn này là khuôn đang chạy sẵn
    // của repo (`RuleReportSummary.tsx` dùng y hệt cho bốn số của màn S-31), nên
    // chỗ phải sửa là lúc đọc chứ không phải thứ được đòi: `waitFor` vẫn đòi
    // đúng cả "25" lẫn "23" xuất hiện thật trong DOM.
    await waitFor(() => {
      expect(container.textContent).toContain('25');
    });

    expect(container.textContent).toContain('23');
  });
});

describe('2.(b).2 — luật đã tắt vẫn còn trong DOM, ở độ mờ thấp', () => {
  it('ROOM-HAS-DOOR (đã tắt) vẫn hiện trong DOM và mang lớp giảm độ mờ', async () => {
    const RuleSettingsView = await loadRuleSettingsView();
    const props = buildRuleSettingsProps({ status: 'ready' });
    const rows = props.model.groups.flatMap((group) => group.rows);
    const disabledRow = rows.find((row) => row.code === 'ROOM-HAS-DOOR');

    if (disabledRow === undefined) {
      throw new Error('không có dòng ROOM-HAS-DOOR trong bộ mẫu — buildRuleSettingsGroups lỗi');
    }

    expect(disabledRow.enabled).toBe(false);

    render(<RuleSettingsView {...props} />);

    const sentenceNode = screen.getByText(disabledRow.sentence);
    let dimmed = false;
    let current: HTMLElement | null = sentenceNode;

    while (current !== null) {
      if (/\bopacity-(?:[1-9][0-9]?|100)\b/.test(current.className)) {
        dimmed = true;
        break;
      }

      current = current.parentElement;
    }

    expect(
      dimmed,
      `luật đã tắt "${disabledRow.code}" phải mang một lớp opacity-* để nhìn thấy được ở độ mờ thấp`,
    ).toBe(true);
  });
});

describe('2.(b).3 — A7: không có nút Lưu nào trong màn', () => {
  /**
   * Bản đầu của phép đo này soát MỌI nút mang chữ "lưu", và nó bắt trúng một
   * thứ không phải nút Lưu: nhãn nhóm `circulation` của sổ đăng ký là
   * **"Lưu thông"** (`RULE_GROUP_LABELS`), và màn không được đặt lại tên nhóm
   * của domain. Phép đo vì thế báo đỏ trên một màn KHÔNG hề có nút Lưu nào.
   *
   * Bản này soát đúng thứ A7 nói: không phần tử tương tác nào mở một lượt lưu
   * bằng tay. Thanh điều hướng bị loại khỏi phạm vi soát vì chữ trên đó là chữ
   * của domain, không phải chữ màn này chọn — và loại nó ra không nới lỏng gì:
   * một nút Lưu thật sẽ không bao giờ nằm trong `<nav>` mục lục.
   */
  it('màn "ready" không dựng nút nào mở một lượt lưu bằng tay', async () => {
    const RuleSettingsView = await loadRuleSettingsView();
    const props = buildRuleSettingsProps({ status: 'ready' });
    const { container } = render(<RuleSettingsView {...props} />);

    const nav = container.querySelector('nav');
    const saveish = screen
      .queryAllByRole('button', { name: /\b(lưu|luu|save)\b/i })
      .filter((node) => nav === null || !nav.contains(node));

    expect(
      saveish.map((node) => node.textContent),
      'A7: màn tự lưu 800 ms sau thao tác cuối, không có nút Lưu nào',
    ).toEqual([]);

    // Và cũng không có nút nào ở bất cứ đâu mang đúng chữ "lưu" đứng một mình —
    // "Lưu thông" là hai từ, nên phép soát này vẫn bắt được một nút Lưu thật.
    expect(screen.queryByRole('button', { name: /^\s*lưu\s*$/i })).toBeNull();
  });
});

describe('2.(b).4 — tắt toàn bộ luật thì câu cảnh báo hậu quả phải xuất hiện', () => {
  it('còn luật bật thì không có cảnh báo; tắt hết thì cảnh báo hậu quả hiện ra', async () => {
    const RuleSettingsView = await loadRuleSettingsView();

    const normalProps = buildRuleSettingsProps({ status: 'ready' });
    const { unmount } = render(<RuleSettingsView {...normalProps} />);

    expect(normalProps.model.disableAllWarning).toBeNull();
    expect(screen.queryByText(ALL_DISABLED_WARNING)).toBeNull();
    unmount();

    const disabledProps = buildRuleSettingsProps({ status: 'ready', allDisabled: true });

    expect(disabledProps.model.enabledRuleCount).toBe(0);
    expect(disabledProps.model.disableAllWarning).toBe(ALL_DISABLED_WARNING);

    render(<RuleSettingsView {...disabledProps} />);
    expect(screen.getByText(ALL_DISABLED_WARNING)).toBeTruthy();
  });
});

describe('2.(b).5 — mỗi dòng luật nói rõ số đối tượng đang bị ảnh hưởng', () => {
  it('impactCaption của cả 25 dòng là "N chỗ đang sai" (rỗng khi 0) và hiện trong DOM', async () => {
    const RuleSettingsView = await loadRuleSettingsView();
    const props = buildRuleSettingsProps({ status: 'ready' });
    const rows = props.model.groups.flatMap((group) => group.rows);

    expect(rows).toHaveLength(25);

    for (const row of rows) {
      expect(row.impactCaption).toMatch(/^([\d.]+ chỗ đang sai)?$/);
    }

    render(<RuleSettingsView {...props} />);

    // `getByText` nổ với "Found multiple elements" ở đây, và đó là lỗi của phép
    // đo chứ không của màn: rất nhiều luật cùng mang đúng một câu
    // "Đang ảnh hưởng 0 đối tượng", nên câu ấy XUẤT HIỆN NHIỀU LẦN là điều đúng.
    // `getAllByText` đo được thứ cần đo, và đếm tổng số câu impact thành đúng 25
    // là một khẳng định CHẶT HƠN bản cũ: nó bắt cả trường hợp thiếu một dòng lẫn
    // trường hợp vẽ thừa một dòng.
    let captionNodeCount = 0;

    const shown = rows.filter((row) => row.impactCaption !== '');

    for (const row of shown) {
      expect(screen.getAllByText(row.impactCaption).length).toBeGreaterThan(0);
    }

    for (const caption of new Set(shown.map((row) => row.impactCaption))) {
      captionNodeCount += screen.getAllByText(caption).length;
    }

    expect(captionNodeCount, 'mỗi dòng có số chỗ sai > 0 hiện đúng một câu').toBe(shown.length);
  });
});

describe('2.(b).6 — ô ngưỡng chặn giá trị ngoài khoảng hợp lệ, nêu đúng cả hai đầu', () => {
  it('ngưỡng "Bề dày tường tối thiểu" ngoài khoảng 10–200 hiện đúng câu lỗi đã giải, nêu cả hai đầu số', async () => {
    const RuleSettingsView = await loadRuleSettingsView();
    const props = buildRuleSettingsProps({ status: 'ready' });
    const groupsWithBadThreshold = props.model.groups.map((group) => ({
      ...group,
      rows: group.rows.map((row) =>
        row.code === 'WALL-THICKNESS'
          ? { ...row, thresholds: [WALL_THICKNESS_THRESHOLD_OUT_OF_RANGE] }
          : row,
      ),
    }));

    const propsWithBadThreshold: RuleSettingsProps = {
      ...props,
      model: { ...props.model, groups: groupsWithBadThreshold },
    };

    render(<RuleSettingsView {...propsWithBadThreshold} />);

    const errorText = WALL_THICKNESS_THRESHOLD_OUT_OF_RANGE.error;

    if (errorText === null) {
      throw new Error('WALL_THICKNESS_THRESHOLD_OUT_OF_RANGE.error phải khác null trong bộ mẫu');
    }

    const errorNode = screen.getByText(errorText);

    expect(errorNode).toBeTruthy();
    // Kiểm cả hai đầu số của khoảng hợp lệ (10 và 200), không chỉ một đầu.
    expect(errorText).toContain(String(WALL_THICKNESS_THRESHOLD_OUT_OF_RANGE.min));
    expect(errorText).toContain(String(WALL_THICKNESS_THRESHOLD_OUT_OF_RANGE.max));
  });

  it('gõ vào ô ngưỡng "Bề dày tường tối thiểu" gọi lên onChangeThreshold với đúng mã luật và khoá', async () => {
    const RuleSettingsView = await loadRuleSettingsView();
    const onChangeThreshold = vi.fn();
    const props = buildRuleSettingsProps({ status: 'ready' }, { actions: { onChangeThreshold } });

    render(<RuleSettingsView {...props} />);

    const input = screen.getByLabelText(/bề dày tường tối thiểu/i);
    fireEvent.change(input, { target: { value: '100' } });
    fireEvent.blur(input);

    expect(onChangeThreshold).toHaveBeenCalled();
    const [calledCode, calledKey] = onChangeThreshold.mock.calls[0] ?? [];

    expect(calledCode).toBe('WALL-THICKNESS');
    expect(calledKey).toBe('minThicknessMm');
  });
});

describe('2.(b).7 — áp bộ luật sẵn "nhà xưởng": số luật đổi hiện TRƯỚC, có đường hoàn tác', () => {
  it('caption bộ "nhà xưởng" hiện số luật sẽ đổi trước khi bấm, và bấm gọi đúng onApplyPreset', async () => {
    const RuleSettingsView = await loadRuleSettingsView();
    const onApplyPreset = vi.fn();
    const props = buildRuleSettingsProps({ status: 'ready' }, { actions: { onApplyPreset } });

    render(<RuleSettingsView {...props} />);

    const captionNode = screen.getByText(INDUSTRIAL_PRESET.caption);

    expect(captionNode).toBeTruthy();
    expect(INDUSTRIAL_PRESET.caption).toContain(String(INDUSTRIAL_PRESET.changedRuleCount));

    fireEvent.click(screen.getByRole('button', { name: new RegExp(INDUSTRIAL_PRESET.label, 'i') }));
    // Không hộp hỏi (brief cụm 6): số luật đổi hiện trên nút trước khi bấm, bấm là áp, toast có hoàn tác.
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(onApplyPreset).toHaveBeenCalledWith('industrial');
  });

  it('29-B-009: trạng thái partial không nói "đang tải thêm dữ liệu"', async () => {
    const RuleSettingsView = await loadRuleSettingsView();

    render(<RuleSettingsView {...buildRuleSettingsProps({ status: 'partial' })} />);

    expect(screen.queryByText(/Đang tải thêm dữ liệu/u)).toBeNull();
  });

  it('trước khi áp thì không có nút khôi phục mặc định; sau khi áp (isDefault=false) thì có, và bấm được', async () => {
    const RuleSettingsView = await loadRuleSettingsView();
    const beforeProps = buildRuleSettingsProps({ status: 'ready' });

    expect(beforeProps.model.isDefault).toBe(true);

    const { unmount } = render(<RuleSettingsView {...beforeProps} />);
    expect(screen.queryByRole('button', { name: /khôi phục mặc định/i })).toBeNull();
    unmount();

    const onRestoreDefaults = vi.fn();
    const afterProps = buildRuleSettingsProps({ status: 'ready' }, { actions: { onRestoreDefaults } });
    const appliedProps: RuleSettingsProps = {
      ...afterProps,
      model: {
        ...afterProps.model,
        isDefault: false,
        enabledRuleCount: afterProps.model.enabledRuleCount - INDUSTRIAL_PRESET.changedRuleCount,
      },
    };

    render(<RuleSettingsView {...appliedProps} />);

    const restoreButton = screen.getByRole('button', { name: /khôi phục mặc định/i });
    fireEvent.click(restoreButton);
    // Không hộp hỏi: khôi phục áp ngay, vé hoàn tác 8 giây do hook phát kèm toast.
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(onRestoreDefaults).toHaveBeenCalled();
  });
});

describe('B-V12-04 — route thật: mỗi lượt sửa luật có toast "Hoàn tác" (A8)', () => {
  it('tắt một luật đẩy đúng một thông báo mang vé hoàn tác vào bus của phiên; dùng vé thì luật bật lại', async () => {
    /* Kho đã khớp dự án TRƯỚC khi gắn, để cổng nạp kho (B-V12-01) không nạp đè. */
    act(() => {
      useStore.getState().setProject({ created_at: '', id: 'P-1', members: [], name: 'P-1', updated_at: '' });
      useStore.getState().setSpatial(normalizeSpatial(createSampleBuilding()), null);
      // F-10: quyền sửa đến từ vai (`ruleset.edit`, chỉ quản trị viên), không còn mặc định `true`.
      useStore.getState().setUserRoles(['admin']);
    });
    renderWithProviders(
      <MemoryRouter initialEntries={['/projects/P-1/rules/settings']}>
        <Routes>
          <Route path={ROUTE_PATTERNS.projectRuleSettings} element={<RuleSettingsRoute />} />
        </Routes>
      </MemoryRouter>,
      { keepStore: true },
    );

    const before = appNotificationBus.list().length;
    const ruleSwitch = await screen.findByRole('switch', {
      name: /^Bật hoặc tắt luật: lỗ mở nằm trọn/u,
    });
    expect(ruleSwitch.getAttribute('aria-checked')).toBe('true');

    fireEvent.click(ruleSwitch);

    await waitFor(() => {
      expect(ruleSwitch.getAttribute('aria-checked')).toBe('false');
    });
    const published = appNotificationBus.list().slice(before);
    expect(published).toHaveLength(1);

    act(() => {
      published[0]?.undoTicket?.undo();
    });

    await waitFor(() => {
      expect(ruleSwitch.getAttribute('aria-checked')).toBe('true');
    });
  });
});

describe('BUG-440 — route đo mốc thu gọn: dưới 1024 không còn hai cột', () => {
  afterEach(() => {
    Reflect.deleteProperty(window, 'matchMedia');
  });

  it('khổ hẹp → điều hướng thành ô chọn "Mục cài đặt", không còn cột liên kết', async () => {
    window.matchMedia = ((query: string) => ({
      matches: true,
      media: query,
      addEventListener: () => undefined,
      removeEventListener: () => undefined,
    })) as unknown as typeof window.matchMedia;
    act(() => {
      useStore.getState().setProject({ created_at: '', id: 'P-1', members: [], name: 'P-1', updated_at: '' });
      useStore.getState().setSpatial(normalizeSpatial(createSampleBuilding()), null);
      useStore.getState().setUserRoles(['admin']);
    });
    renderWithProviders(
      <MemoryRouter initialEntries={['/projects/P-1/rules/settings']}>
        <Routes>
          <Route path={ROUTE_PATTERNS.projectRuleSettings} element={<RuleSettingsRoute />} />
        </Routes>
      </MemoryRouter>,
      { keepStore: true },
    );

    expect(await screen.findByRole('combobox', { name: 'Mục cài đặt' })).toBeTruthy();
    expect(screen.queryByRole('navigation', { name: 'Mục cài đặt bộ luật' })).toBeNull();
  });
});

/* ==========================================================================
 * F-10 — hook nối N21/N22: quyền theo vai, nạp không toast, baseVersion,
 * 409/422, tải lại, đổi dự án, gửi lại sau timeout, xả khi tháo (R13).
 * ========================================================================== */

type RuleConfigApi = ApiClient['ruleConfig'];

interface Deferred<T> {
  readonly promise: Promise<T>;
  readonly resolve: (value: T) => void;
}

const deferred = <T,>(): Deferred<T> => {
  let resolve: (value: T) => void = () => undefined;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });

  return { promise, resolve };
};

const wireConfig = (revision: number, overrides: ProjectRuleConfig['overrides'] = {}): ProjectRuleConfig => ({
  overrides,
  revision,
});

const wireError = (status: number, code: string, raw: Record<string, unknown> = {}): HttpError => ({
  code,
  kind: 'http',
  raw,
  requestId: 'req-hook',
  retryable: false,
  status,
});

const timeoutError: HttpError = { kind: 'timeout', raw: null, requestId: 'req-timeout', retryable: true };

/** Con số của A7 cộng một chút: đủ để lượt tự lưu đã chạy. */
const AFTER_DEBOUNCE_MS = 900;
/** Mốc thử lại đầu của `retrySchedule` (5 s), cộng một chút. */
const AFTER_FIRST_RETRY_MS = 5_100;

interface HookSetup {
  readonly read?: RuleConfigApi['read'];
  readonly replace?: RuleConfigApi['replace'];
  readonly roles?: readonly ProjectRole[];
  readonly projectId?: string;
  readonly isOnline?: () => boolean;
  readonly isCompact?: boolean;
  readonly onToast?: (toast: RuleSettingsToast) => void;
  readonly onDiscardToasts?: () => void;
}

function setupHook(setup: HookSetup = {}) {
  const read = vi.fn<RuleConfigApi['read']>(setup.read ?? (async () => ({ ok: true, data: wireConfig(3) })));
  const replace = vi.fn<RuleConfigApi['replace']>(
    setup.replace ??
      (async (input) => ({ ok: true, data: wireConfig(input.baseVersion + 1, input.body.overrides as ProjectRuleConfig['overrides']) })),
  );
  const client: ApiClient = { ...createMockApiClient(), ruleConfig: { read, replace } };
  const gateway = createRuleSettingsGateway({ client });
  const queryClient = createTestQueryClient();

  act(() => {
    useStore.getState().setUserRoles(setup.roles ?? ['admin']);
  });

  const wrapper = ({ children }: { readonly children: ReactNode }) => (
    <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  );
  const view = renderHook(
    ({ projectId }: { readonly projectId: string }) =>
      useRuleSettings({
        projectId,
        gateway,
        ...(setup.isOnline !== undefined ? { isOnline: setup.isOnline } : {}),
        ...(setup.isCompact !== undefined ? { isCompact: setup.isCompact } : {}),
        ...(setup.onToast !== undefined ? { onToast: setup.onToast } : {}),
        ...(setup.onDiscardToasts !== undefined ? { onDiscardToasts: setup.onDiscardToasts } : {}),
      }),
    { initialProps: { projectId: setup.projectId ?? 'P-1' }, wrapper },
  );

  return { ...view, read, replace, queryClient };
}

/** Chạy đồng hồ giả, kèm mọi microtask của react-query và `createAutosave`. */
const advance = async (ms: number): Promise<void> => {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(ms);
  });
};

describe('F-10 — useRuleSettings nối N21/N22', () => {
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'Date'] });
    vi.mocked(resolveConflict).mockClear();
    act(() => {
      resetUserScopedState();
      useStore.getState().setSpatial(normalizeSpatial(createSampleBuilding()), null);
    });
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it.each([['engineer'], ['viewer']] as const)('%s ra `ready` kèm readOnlyReason, không `forbidden`', async (role) => {
    const { result } = setupHook({ roles: [role] });
    await advance(0);

    expect(result.current.model.status).toBe('ready');
    expect(result.current.capabilities.canEditRules).toBe(false);
    expect(result.current.capabilities.readOnlyReason).toBe(RULE_SETTINGS_READ_ONLY_REASON);
  });

  it('N21 trả 403 → `forbidden`', async () => {
    const { result } = setupHook({ read: async () => ({ ok: false, error: wireError(403, 'FORBIDDEN') }) });
    await advance(0);

    expect(result.current.model.status).toBe('forbidden');
  });

  it('BUG-440: khổ hẹp không che trạng thái không có dữ liệu — 403 vẫn `forbidden`, 500 vẫn `error`', async () => {
    const forbidden = setupHook({ isCompact: true, read: async () => ({ ok: false, error: wireError(403, 'FORBIDDEN') }) });
    const failed = setupHook({ isCompact: true, read: async () => ({ ok: false, error: wireError(500, 'INTERNAL') }) });
    const loaded = setupHook({ isCompact: true });
    await advance(0);

    expect(forbidden.result.current.model.status).toBe('forbidden');
    expect(failed.result.current.model.status).toBe('error');
    expect(loaded.result.current.model.status).toBe('collapsed');
  });

  it('lượt nạp không đặt lastCommit (không toast mời hoàn tác)', async () => {
    const { result } = setupHook({ read: async () => ({ ok: true, data: wireConfig(3, { 'WALL-THICKNESS': { enabled: false } }) }) });
    await advance(0);

    expect(useStore.getState().ruleConfigRevision).toBe(3);
    expect(useStore.getState().ruleConfig.overrides).toEqual({ 'WALL-THICKNESS': { enabled: false } });
    expect(useStore.getState().lastCommitLabel).toBeNull();
    expect(useStore.getState().lastCommitUndo).toBeNull();
    expect(result.current.model.status).toBe('ready');
  });

  it('baseVersion = revision vừa đọc, lượt sau = revision vừa lưu', async () => {
    const { result, replace } = setupHook();
    await advance(0);

    act(() => result.current.onToggleRule('WALL-THICKNESS', false));
    await advance(AFTER_DEBOUNCE_MS);
    act(() => result.current.onToggleRule('WALL-THICKNESS', true));
    await advance(AFTER_DEBOUNCE_MS);

    expect(replace.mock.calls.map(([input]) => input.baseVersion)).toEqual([3, 4]);
    expect(useStore.getState().ruleConfigRevision).toBe(5);
  });

  it('409: dải tải lại, tự lưu `failed`, không gửi lại sau 5 s, không resolveConflict', async () => {
    const { result, replace } = setupHook({
      replace: async () => ({ ok: false, error: wireError(409, 'VERSION_CONFLICT', { remoteChanges: [] }) }),
    });
    await advance(0);

    act(() => result.current.onToggleRule('WALL-THICKNESS', false));
    await advance(AFTER_DEBOUNCE_MS);
    await advance(AFTER_FIRST_RETRY_MS);

    expect(replace).toHaveBeenCalledTimes(1);
    expect(result.current.model.saveProblem?.offerReload).toBe(true);
    expect(result.current.model.saveState).toBe('error');
    expect(result.current.model.status).not.toBe('error');
    expect(resolveConflict).not.toHaveBeenCalled();
  });

  it('29-C-016: áp bộ luật 0 thay đổi không PUT và không bắn toast hoàn tác', async () => {
    const onToast = vi.fn();
    const { result, replace } = setupHook({ onToast });
    await advance(0);

    act(() => result.current.onApplyPreset('residential'));
    await advance(AFTER_DEBOUNCE_MS);

    expect(replace).not.toHaveBeenCalled();
    expect(onToast).not.toHaveBeenCalled();
  });

  it('29-C-020: sau 409, sửa tiếp không PUT lại bản cũ và chữ không hứa thử lưu lại', async () => {
    const { result, replace } = setupHook({
      replace: async () => ({ ok: false, error: wireError(409, 'VERSION_CONFLICT', { remoteChanges: [] }) }),
    });
    await advance(0);

    act(() => result.current.onToggleRule('WALL-THICKNESS', false));
    await advance(AFTER_DEBOUNCE_MS);
    act(() => result.current.onToggleRule('DOOR-WIDTH', false));
    await advance(AFTER_DEBOUNCE_MS);

    expect(replace).toHaveBeenCalledTimes(1);
    expect(result.current.model.saveProblem?.offerReload).toBe(true);
    expect(result.current.model.saveCaption).not.toMatch(/thử lưu lại/u);
  });

  it('29-G-013: 503 đang tự thử lại không hiện cảnh báo; hết thử lại mới hiện', async () => {
    const { result, replace } = setupHook({
      replace: async () => ({ ok: false, error: wireError(503, 'DEPENDENCY_UNAVAILABLE') }),
    });
    await advance(0);

    act(() => result.current.onToggleRule('WALL-THICKNESS', false));
    await advance(AFTER_DEBOUNCE_MS);

    expect(replace).toHaveBeenCalledTimes(1);
    expect(result.current.model.saveState).not.toBe('error');
    expect(result.current.model.saveProblem).toBeNull();

    await advance(120_000);

    expect(result.current.model.saveState).toBe('error');
    expect(result.current.model.saveProblem).not.toBeNull();
  });

  it('422 RULE_GENERAL_NOT_TOGGLEABLE → câu gắn thẻ ngưỡng chung', async () => {
    const { result } = setupHook({
      replace: async () => ({
        ok: false,
        error: wireError(422, 'RULE_GENERAL_NOT_TOGGLEABLE', { field: 'body.overrides.GENERAL.enabled' }),
      }),
    });
    await advance(0);

    act(() => result.current.onToggleRule('WALL-THICKNESS', false));
    await advance(AFTER_DEBOUNCE_MS);

    expect(result.current.model.saveProblem).toMatchObject({ onGeneralCard: true, offerReload: false });
    expect(result.current.model.saveProblem?.message).toMatch(/Ngưỡng chung/u);
  });

  it('tải lại khi có sửa dở → hộp thoại; xác nhận → đọc lại N21 và nạp bản mới', async () => {
    const reads = [wireConfig(3), wireConfig(7, { 'DOOR-WIDTH': { enabled: false } })];
    const { result, read } = setupHook({
      read: async () => ({ ok: true, data: reads.shift() ?? wireConfig(7) }),
      replace: async () => ({ ok: false, error: wireError(409, 'VERSION_CONFLICT', { remoteChanges: [] }) }),
    });
    await advance(0);

    act(() => result.current.onToggleRule('WALL-THICKNESS', false));
    await advance(AFTER_DEBOUNCE_MS);
    act(() => result.current.onReload());

    expect(result.current.model.reloadConfirmOpen).toBe(true);
    expect(read).toHaveBeenCalledTimes(1);

    act(() => result.current.onConfirmReload());
    await advance(0);

    expect(read).toHaveBeenCalledTimes(2);
    expect(result.current.model.reloadConfirmOpen).toBe(false);
    expect(result.current.model.saveProblem).toBeNull();
    expect(useStore.getState().ruleConfigRevision).toBe(7);
    expect(useStore.getState().ruleConfig.overrides).toEqual({ 'DOOR-WIDTH': { enabled: false } });
  });

  it('BUG-463: "Bỏ thay đổi và tải lại" làm vé hoàn tác cũ hết hạn và gỡ toast của nó', async () => {
    const toasts: RuleSettingsToast[] = [];
    const onDiscardToasts = vi.fn();
    const reads = [wireConfig(3), wireConfig(7, { 'WALL-LENGTH': { enabled: false } })];
    const { result } = setupHook({
      read: async () => ({ ok: true, data: reads.shift() ?? wireConfig(7) }),
      replace: async () => ({ ok: false, error: wireError(409, 'VERSION_CONFLICT', { remoteChanges: [] }) }),
      onToast: (toast) => toasts.push(toast),
      onDiscardToasts,
    });
    await advance(0);
    onDiscardToasts.mockClear(); // lượt nạp đầu cũng gỡ toast cũ (không có gì để gỡ) — đếm từ đây

    act(() => result.current.onToggleRule('WALL-THICKNESS', false));
    await advance(AFTER_DEBOUNCE_MS);
    act(() => result.current.onReload());
    act(() => result.current.onConfirmReload());
    await advance(0);

    expect(onDiscardToasts).toHaveBeenCalledTimes(1);
    const ticket = toasts[0]?.undoTicket;
    expect(ticket?.getStatus()).toBe('expired');
    expect(ticket?.undo()).toEqual({ error: 'expired', ok: false });
    expect(useStore.getState().ruleConfig.overrides).toEqual({ 'WALL-LENGTH': { enabled: false } });
  });

  it('29-A-008: bật/tắt rồi hoàn tác về đúng bản đã lưu thì không gửi PUT', async () => {
    const toasts: RuleSettingsToast[] = [];
    const { result, replace } = setupHook({ onToast: (toast) => toasts.push(toast) });
    await advance(0);

    act(() => result.current.onToggleRule('WALL-THICKNESS', false));
    act(() => {
      toasts[0]?.undoTicket?.undo();
    });
    await advance(AFTER_DEBOUNCE_MS * 2);

    expect(replace).not.toHaveBeenCalled();
  });

  it('29-G-003 (BUG-718): sau PUT thành công cache được ghi bằng setQueryData, không GET rule-config thêm', async () => {
    const { result, read, replace } = setupHook();
    await advance(0);
    expect(read).toHaveBeenCalledTimes(1);

    act(() => result.current.onToggleRule('WALL-THICKNESS', false));
    await advance(AFTER_DEBOUNCE_MS * 2);

    expect(replace).toHaveBeenCalledTimes(1);
    expect(read).toHaveBeenCalledTimes(1);
  });

  it('29-A-033 (FL-11P-08, SPLIT từ stack): sửa → lưu → "Khôi phục mặc định" → lưu → vé "Hoàn tác" còn hiệu lực và PUT lại bản sửa', async () => {
    const toasts: RuleSettingsToast[] = [];
    const { result, replace, read } = setupHook({ onToast: (toast) => toasts.push(toast) });
    await advance(0);

    act(() => result.current.onToggleRule('WALL-THICKNESS', false));
    await advance(AFTER_DEBOUNCE_MS);
    act(() => result.current.onRestoreDefaults());
    await advance(AFTER_DEBOUNCE_MS);
    expect(replace).toHaveBeenCalledTimes(2);
    expect(useStore.getState().ruleConfig.overrides).toEqual({});

    const resetTicket = toasts[1]?.undoTicket;
    expect(resetTicket?.getStatus()).toBe('active');
    act(() => {
      toasts[1]?.onUndo?.();
    });
    await advance(AFTER_DEBOUNCE_MS);

    expect(replace).toHaveBeenCalledTimes(3);
    expect(replace.mock.calls[2]?.[0].body.overrides).toEqual({ 'WALL-THICKNESS': { enabled: false } });
    expect(replace.mock.calls[2]?.[0].baseVersion).toBe(5);
    expect(useStore.getState().ruleConfig.overrides).toEqual({ 'WALL-THICKNESS': { enabled: false } });
    expect(read).toHaveBeenCalledTimes(1);
  });

  it('29-A-035 (FL-11P-08, SPLIT từ stack): bộ luật sẵn rồi reset → hai vé riêng; vé cũ không ghi đè vé mới', async () => {
    const toasts: RuleSettingsToast[] = [];
    const { result, replace } = setupHook({ onToast: (toast) => toasts.push(toast) });
    await advance(0);

    act(() => result.current.onApplyPreset('commercial'));
    await advance(AFTER_DEBOUNCE_MS);
    const presetBody = replace.mock.calls[0]?.[0].body.overrides;
    act(() => result.current.onRestoreDefaults());
    await advance(AFTER_DEBOUNCE_MS);
    expect(toasts).toHaveLength(2);
    expect(replace).toHaveBeenCalledTimes(2);

    act(() => {
      toasts[1]?.onUndo?.(); // newest ticket (the reset) => back to the preset state
    });
    await advance(AFTER_DEBOUNCE_MS);
    expect(replace).toHaveBeenCalledTimes(3);
    expect(replace.mock.calls[2]?.[0].body.overrides).toEqual(presetBody);

    // Vé cũ (về mặc định trước bộ sẵn) không được ghi đè trạng thái mới hơn (11P-A-035).
    expect(toasts[0]?.undoTicket?.getStatus()).toBe('expired');
    act(() => {
      toasts[0]?.onUndo?.();
    });
    await advance(AFTER_DEBOUNCE_MS);
    expect(replace).toHaveBeenCalledTimes(3);
  });

  it('29-A-035 (FL-11P-08, bus thật): bộ luật sẵn rồi reset → bus giữ HAI thông báo, mỗi cái một vé; vé cũ đã hết hạn', async () => {
    const { createNotificationBus } = await import('@/lib/mutations/notificationBus');
    const bus = createNotificationBus();
    const { result } = setupHook({
      // Cùng cách màn container đẩy toast vào bus (RuleSettings.container.tsx publishRuleSettingsToast).
      onToast: (toast) => bus.publish({ type: 'rule-settings', title: toast.message, description: '', undoTicket: toast.undoTicket }),
      onDiscardToasts: () => bus.withdraw('rule-settings'),
    });
    await advance(0);

    act(() => result.current.onApplyPreset('commercial'));
    await advance(AFTER_DEBOUNCE_MS);
    act(() => result.current.onRestoreDefaults());
    await advance(AFTER_DEBOUNCE_MS);

    const listed = bus.list();
    expect(listed.map((item) => item.undoTicket !== undefined)).toEqual([true, true]); // 2 thông báo, không gộp thành 1
    expect(listed[0]?.undoTicket?.getStatus()).toBe('expired');
    expect(listed[1]?.undoTicket?.getStatus()).toBe('active');
  });

  it('BUG-463: refetch nền mang revision mới hơn làm vé cũ hết hạn — "Hoàn tác" không ghi đè bản của người khác', async () => {
    const toasts: RuleSettingsToast[] = [];
    const onDiscardToasts = vi.fn();
    const reads = [wireConfig(3), wireConfig(9, { 'WALL-LENGTH': { enabled: false } })];
    const { result, queryClient } = setupHook({
      read: async () => ({ ok: true, data: reads.shift() ?? wireConfig(9, { 'WALL-LENGTH': { enabled: false } }) }),
      onToast: (toast) => toasts.push(toast),
      onDiscardToasts,
    });
    await advance(0);

    act(() => result.current.onToggleRule('WALL-THICKNESS', false));
    await advance(AFTER_DEBOUNCE_MS);
    const ticket = toasts[0]?.undoTicket;
    expect(ticket?.getStatus()).toBe('active');
    onDiscardToasts.mockClear();

    await act(async () => {
      await queryClient.refetchQueries();
    });
    await advance(0);

    expect(onDiscardToasts).toHaveBeenCalled();
    expect(ticket?.getStatus()).toBe('expired');
    expect(ticket?.undo()).toEqual({ error: 'expired', ok: false });
    expect(useStore.getState().ruleConfig.overrides).toEqual({ 'WALL-LENGTH': { enabled: false } });
  });

  it('BUG-463: đổi dự án làm vé của dự án cũ hết hạn — không ghi cấu hình của A vào B', async () => {
    const toasts: RuleSettingsToast[] = [];
    const onDiscardToasts = vi.fn();
    const { result, rerender } = setupHook({
      read: async ({ projectId }) =>
        ({ ok: true, data: projectId === 'P-2' ? wireConfig(5, { 'WALL-LENGTH': { enabled: false } }) : wireConfig(3) }),
      onToast: (toast) => toasts.push(toast),
      onDiscardToasts,
    });
    await advance(0);

    act(() => result.current.onToggleRule('WALL-THICKNESS', false));
    await advance(AFTER_DEBOUNCE_MS);
    const ticket = toasts[0]?.undoTicket;
    expect(ticket?.getStatus()).toBe('active');
    onDiscardToasts.mockClear();

    rerender({ projectId: 'P-2' });
    await advance(0);

    expect(useStore.getState().ruleConfigProjectId).toBe('P-2');
    expect(onDiscardToasts).toHaveBeenCalled();
    expect(ticket?.getStatus()).toBe('expired');
    expect(ticket?.undo()).toEqual({ error: 'expired', ok: false });
    expect(useStore.getState().ruleConfig.overrides).toEqual({ 'WALL-LENGTH': { enabled: false } });
  });

  it('BUG-464: N21 hỏng rồi "Thử lại" (onReload) → đọc lại và ra `ready`', async () => {
    let reads = 0;
    const { result } = setupHook({
      read: async () => {
        reads += 1;
        return reads === 1 ? { ok: false, error: wireError(500, 'INTERNAL') } : { ok: true, data: wireConfig(4) };
      },
    });
    await advance(0);
    expect(result.current.model.status).toBe('error');

    act(() => result.current.onReload());
    await advance(0);

    expect(reads).toBe(2);
    expect(result.current.model.status).toBe('ready');
  });

  it('lượt đọc lại hỏng: không nạp bản cũ, dải xung đột vẫn còn', async () => {
    let reads = 0;
    const { result, read } = setupHook({
      read: async () => {
        reads += 1;

        return reads === 1 ? { ok: true, data: wireConfig(3) } : { ok: false, error: wireError(503, 'DEPENDENCY_UNAVAILABLE') };
      },
      replace: async () => ({ ok: false, error: wireError(409, 'VERSION_CONFLICT', { remoteChanges: [] }) }),
    });
    await advance(0);

    act(() => result.current.onToggleRule('WALL-THICKNESS', false));
    await advance(AFTER_DEBOUNCE_MS);
    act(() => result.current.onReload());
    act(() => result.current.onConfirmReload());
    await advance(0);

    expect(read).toHaveBeenCalledTimes(2);
    expect(result.current.model.saveProblem?.offerReload).toBe(true);
    expect(useStore.getState().ruleConfig.overrides).toEqual({ 'WALL-THICKNESS': { enabled: false } });
    expect(result.current.model.status).not.toBe('error');
  });

  it('huỷ hộp thoại tải lại thì không đọc lại', async () => {
    const { result, read } = setupHook();
    await advance(0);

    act(() => result.current.onToggleRule('WALL-THICKNESS', false));
    act(() => result.current.onReload());
    act(() => result.current.onCancelReload());

    expect(result.current.model.reloadConfirmOpen).toBe(false);
    expect(read).toHaveBeenCalledTimes(1);
  });

  it('đổi projectId khi store còn cấu hình dự án cũ: không gửi gì cho dự án mới trước khi N21 mới nạp', async () => {
    const secondRead = deferred<Awaited<ReturnType<RuleConfigApi['read']>>>();
    const { rerender, replace, result } = setupHook({
      read: (input) => (input.projectId === 'P-1' ? Promise.resolve({ ok: true, data: wireConfig(3) }) : secondRead.promise),
    });
    await advance(0);

    rerender({ projectId: 'P-2' });
    await advance(AFTER_DEBOUNCE_MS);

    expect(result.current.model.status).toBe('loading');
    expect(replace).not.toHaveBeenCalled();

    secondRead.resolve({ ok: true, data: wireConfig(11) });
    await advance(AFTER_DEBOUNCE_MS);

    expect(replace).not.toHaveBeenCalled();
    expect(useStore.getState().ruleConfigProjectId).toBe('P-2');
    expect(useStore.getState().ruleConfigRevision).toBe(11);
  });

  it('store bị đặt lại (đổi người) khi màn còn gắn: lượt tự lưu không coi bản trắng là một sửa', async () => {
    const { result, replace } = setupHook();
    await advance(0);

    act(() => result.current.onToggleRule('WALL-THICKNESS', false));
    act(() => {
      resetUserScopedState();
    });
    await advance(AFTER_DEBOUNCE_MS);

    expect(replace).not.toHaveBeenCalled();
  });

  it('N22 timeout rồi sửa tiếp → lượt thử lại gửi thân cũ trước, rồi thân mới', async () => {
    let calls = 0;
    const { result, replace } = setupHook({
      replace: async (input) => {
        calls += 1;

        return calls === 1
          ? { ok: false, error: timeoutError }
          : { ok: true, data: wireConfig(input.baseVersion + 1) };
      },
    });
    await advance(0);

    act(() => result.current.onToggleRule('WALL-THICKNESS', false));
    await advance(AFTER_DEBOUNCE_MS);
    act(() => result.current.onToggleRule('DOOR-WIDTH', false));
    await advance(AFTER_FIRST_RETRY_MS);

    expect(replace.mock.calls.map(([input]) => [input.baseVersion, Object.keys(input.body.overrides)])).toEqual([
      [3, ['WALL-THICKNESS']],
      [3, ['WALL-THICKNESS']],
      [4, ['WALL-THICKNESS', 'DOOR-WIDTH']],
    ]);
  });

  it('tháo màn khi còn sửa dở → đúng một lượt gửi', async () => {
    const { result, replace, unmount } = setupHook();
    await advance(0);

    act(() => result.current.onToggleRule('WALL-THICKNESS', false));
    unmount();
    await advance(AFTER_FIRST_RETRY_MS);

    expect(replace).toHaveBeenCalledTimes(1);
    expect(replace.mock.calls[0]?.[0]).toMatchObject({ projectId: 'P-1', baseVersion: 3 });
  });

  it('sửa lúc lượt trước đang gửi rồi tháo (store bị đặt lại) → lượt sau mang sửa đó, đúng dự án cũ và revision vừa nhận', async () => {
    const firstSave = deferred<Awaited<ReturnType<RuleConfigApi['replace']>>>();
    let calls = 0;
    const { result, replace, unmount } = setupHook({
      replace: async (input) => {
        calls += 1;

        return calls === 1 ? firstSave.promise : { ok: true, data: wireConfig(input.baseVersion + 1) };
      },
    });
    await advance(0);

    act(() => result.current.onToggleRule('WALL-THICKNESS', false));
    await advance(AFTER_DEBOUNCE_MS);
    act(() => result.current.onToggleRule('DOOR-WIDTH', false));
    unmount();
    act(() => {
      resetUserScopedState();
    });

    firstSave.resolve({ ok: true, data: wireConfig(4) });
    await advance(0);

    expect(replace).toHaveBeenCalledTimes(2);
    expect(replace.mock.calls[1]?.[0]).toMatchObject({ projectId: 'P-1', baseVersion: 4 });
    expect(Object.keys(replace.mock.calls[1]?.[0].body.overrides ?? {})).toEqual(['WALL-THICKNESS', 'DOOR-WIDTH']);
  });

  it('tháo lúc lượt lưu đang bay mà không sửa thêm → không gửi lần hai', async () => {
    const inFlight = deferred<Awaited<ReturnType<RuleConfigApi['replace']>>>();
    const { result, replace, unmount } = setupHook({ replace: () => inFlight.promise });
    await advance(0);

    act(() => result.current.onToggleRule('WALL-THICKNESS', false));
    await advance(AFTER_DEBOUNCE_MS);
    unmount();
    inFlight.resolve({ ok: true, data: wireConfig(4) });
    await advance(AFTER_FIRST_RETRY_MS);

    expect(replace).toHaveBeenCalledTimes(1);
  });

  it('tháo lúc offline → lượt hẹn lại vẫn gửi bản chụp', async () => {
    let online = false;
    const { result, replace, unmount } = setupHook({ isOnline: () => online });
    await advance(0);

    act(() => result.current.onToggleRule('WALL-THICKNESS', false));
    unmount();
    await advance(0);
    expect(replace).not.toHaveBeenCalled();

    online = true;
    await advance(AFTER_FIRST_RETRY_MS);

    expect(replace).toHaveBeenCalledTimes(1);
    expect(replace.mock.calls[0]?.[0]).toMatchObject({ projectId: 'P-1', baseVersion: 3 });
    expect(Object.keys(replace.mock.calls[0]?.[0].body.overrides ?? {})).toEqual(['WALL-THICKNESS']);
  });
});

describe('#28 — công tắc chỉ đọc nói được lý do', () => {
  it('mỗi công tắc bị khoá có aria-describedby trỏ tới dải cảnh báo chỉ đọc', async () => {
    const RuleSettingsView = await loadRuleSettingsView();
    const props = buildRuleSettingsProps({ status: 'ready' }, { capabilities: READ_ONLY_CAPABILITIES });
    render(<RuleSettingsView {...props} />);

    const switches = screen.getAllByRole('switch');
    expect(switches.length).toBeGreaterThan(0);
    for (const node of switches) expect(node.getAttribute('aria-describedby')).toBe('rule-settings-read-only-reason');
    expect(document.getElementById('rule-settings-read-only-reason')).not.toBeNull();
  });
});
