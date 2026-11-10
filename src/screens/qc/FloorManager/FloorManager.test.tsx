// @vitest-environment jsdom
// PERF-01/FE-11 A15: dưới happy-dom, `style.flexGrow` đọc ngược ra từ inline
// style chỉ giữ ~7 chữ số thập phân (khác jsdom), làm [NGHIEM-4] lệch ở
// `toBeCloseTo(…, 10)`. Giữ tệp này ở jsdom.
/**
 * Lượt kiểm của màn S-16 "Quản lý tầng" đã RÁP.
 *
 * Bốn bộ khẳng định dùng chung (`expectSevenStates`, `expectAccessible`,
 * `expectVietnamese`, `expectNoRawColor`) cộng năm phép đo của bản nghiệm thu mà
 * chỉ màn đã ráp mới trả lời được, cộng `[NGHIEM-6]` của T8 — hai thông báo mà
 * hook đã trả về nhưng trước đó không view nào vẽ ra:
 *
 * | mã | đo cái gì | ngưỡng |
 * |---|---|---|
 * | `[NGHIEM-1]` | bảy trạng thái của A11, không trạng thái nào ra màn trắng | 7/7 |
 * | `[NGHIEM-2]` | container gắn được bằng MỘT thẻ, có cổng giả (R-73) | dựng xong |
 * | `[NGHIEM-3]` | bảng cao độ CẢ BỐN TẦNG trước và sau khi Tầng trệt cao 3,9 → 4,2 m | Tầng 2 tự dịch |
 * | `[NGHIEM-4]` | bốn cặp (chiều cao thật, chiều cao dải) của lát cắt | tổng tỷ lệ = 1 |
 * | `[NGHIEM-5]` | xoá một tầng rồi hoàn tác: thứ tự VÀ cao độ về nguyên trạng | 4 → 3 → 4 dòng |
 * | `[NGHIEM-6]` | hai câu màn phải nói ra: vai Người xem, và nợ của cổng | cả hai hiện trên màn |
 *
 * ## Vì sao `[NGHIEM-3]` đi qua ô nhập thật chứ không gọi thẳng hook
 *
 * `useFloorManager.test.ts` đã lái `onFloorFieldChange` + `onFloorFieldCommit`
 * trực tiếp. Bài này đo nửa còn lại: một người thật gõ vào `NumericField` và
 * KHÔNG bấm gì nữa. `NumericField` chỉ chốt sau {@link NUMERIC_FIELD_COMMIT_MS}
 * im lặng (`useNumericField.ts:14` — `COMMIT_DEBOUNCE_MS`, không xuất ra ngoài
 * nên hằng ở đây là bản sao có chú thích, và tệp `.test.` được `no-raw-duration`
 * miễn trừ theo `eslint-rules/no-raw-duration.js:86`). Nhịp đó là NHỊP CHỐT, không
 * phải từng phím gõ — người dùng đã duyệt — nên bài kiểm chờ đúng nó thay vì sửa
 * component cho dễ đo (R-70).
 *
 * ## `getBoundingClientRect` trả 0 trên jsdom, nên `[NGHIEM-4]` đọc gì
 *
 * jsdom không bố cục, nên chiều cao *đo được* của một dải luôn là 0 và một bài
 * kiểm đọc nó chỉ đang tự lừa mình. Thứ component THẬT SỰ ghi ra là
 * `style={{ flexGrow: band.bandHeightRatio }}` trên chính thẻ dải
 * (`FloorSectionCut.tsx`, dòng duy nhất quyết định tỷ lệ). Bài kiểm đọc thuộc
 * tính đó khỏi DOM và đối chiếu với chiều cao thật của bộ mẫu — không tính lại
 * tỷ lệ ở đây, chỉ chia hai con số đã có để so.
 *
 * ## Một bộ dữ liệu, không phải hai
 *
 * Bảy trạng thái dựng từ `scenarioArgsFor` của `FloorManager.stories.tsx` — cùng
 * bảy view-model mà story dùng (R-70). Màn ĐÃ NỐI DÂY dựng từ
 * `createMockFloorManagerGateway()`, tức cùng bộ mẫu bốn tầng
 * `FLOOR_MANAGER_SAMPLE_LEVELS` mà `useFloorManager.test.ts` lái. Không một con
 * số nào viết tay ở đây (R-71).
 */

import { act, cleanup, fireEvent, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { createShortcutRegistry, type ShortcutRegistry } from '@/lib/input/shortcutRegistry';
import { expectAccessible } from '@/lib/testing/expectAccessible';
import { expectNoRawColor } from '@/lib/testing/expectNoRawColor';
import { expectSevenStates } from '@/lib/testing/expectSevenStates';
import { expectVietnamese } from '@/lib/testing/expectVietnamese';
import { installFakeClock } from '@/lib/testing/fakeClock';
import { renderWithProviders } from '@/lib/testing/render';
import {
  SEVEN_STATES,
  SEVEN_STATE_LABELS,
  type SevenState,
  type SevenStateScenario,
} from '@/lib/testing/sevenStateScenarios';
import { resetSelectorCaches } from '@/store/selectors';
import { useStore } from '@/store';

import { FloorManager } from './FloorManager';
import { FloorManagerContainer, FloorManagerRoute } from './FloorManager.container';
import { scenarioArgsFor } from './FloorManager.stories';
import {
  FLOOR_MANAGER_FIXTURE_UNSUPPORTED_NOTICES,
  floorManagerScenarioFor,
} from './floorManagerFixture';
import {
  createMockFloorManagerGateway,
  FLOOR_MANAGER_SAMPLE_LEVELS,
  FLOOR_MANAGER_UNSUPPORTED_NOTICES,
} from './floorManagerGateway';

const PROJECT_ID = 'project-floor-manager';
const SCREEN_ARIA_LABEL = 'Duyệt tầng';
const SECTION_ARIA_LABEL = 'Lát cắt các tầng theo đúng tỷ lệ chiều cao';
const TABLE_CAPTION_TEXT = 'Cao độ tính tự động từ chiều cao các tầng dưới.';
const TABLE_CAPTION_MANUAL = 'Cao độ đang nhập tay.';
/* Câu về ô "Ghi đè" chỉ hiện khi bảng thật sự có ô ấy (A2 #6). */
const TABLE_CAPTION_OVERRIDE = 'Cao độ đang nhập tay. Ô ghi "Ghi đè" khác cao độ tính từ các tầng dưới.';
const ADD_FLOOR_LABEL = 'Thêm tầng';
const REMOVE_FLOOR_MENU_ITEM = 'Xoá tầng';
const EXPAND_SECTION_LABEL = 'Mở lát cắt';

/** Tầng của bộ mẫu mà bản nghiệm thu chỉ đích danh — đọc ra, không gõ lại tên. */
const GROUND_FLOOR = FLOOR_MANAGER_SAMPLE_LEVELS[1];
const SECOND_FLOOR = FLOOR_MANAGER_SAMPLE_LEVELS[2];

/** Chiều cao mới của Tầng trệt, ở đúng dạng người dùng gõ (A15: dấu phẩy). */
/* Ô chiều cao nhập mm (bản Z): 4200 mm = 4,2 m. */
const NEW_GROUND_HEIGHT_DRAFT = '4200';

/**
 * Nhịp chốt của `NumericField`, milimét giây.
 *
 * Bản sao của `COMMIT_DEBOUNCE_MS` (`src/hooks/useNumericField.ts:14`), thứ
 * không được xuất ra ngoài. Đây là nhịp CHỐT của một ô số — cùng 800 ms mà A7
 * dùng cho tự lưu — chứ không phải một thời lượng chuyển động, nên nó không
 * nằm trên thang năm giá trị của mục B.
 */
const NUMERIC_FIELD_COMMIT_MS = 800;

/** Thừa nhịp để mọi promise của lượt chốt kịp lắng. */
const SETTLE_MS = 1_000;

/* -------------------------------------------------------------------------- */
/* Bộ dựng.                                                                    */
/* -------------------------------------------------------------------------- */

function renderState(state: SevenState) {
  return renderWithProviders(<FloorManager {...scenarioArgsFor(state)} />);
}

/** Mảng thứ hai của `expectSevenStates` chỉ để thoả kiểu; props thật từ `scenarioArgsFor`. */
function scenarioIndex(): readonly SevenStateScenario[] {
  return SEVEN_STATES.map((state) => {
    const scenario = floorManagerScenarioFor(state);

    return {
      state,
      label: SEVEN_STATE_LABELS[state],
      rows: [],
      totalCount: scenario.rows.length,
      isLoading: state === 'loading',
      isCollapsed: scenario.isCollapsed,
      canView: scenario.canEdit || state === 'forbidden',
      error: scenario.errorMessage,
    };
  });
}

interface MountedScreen {
  readonly registry: ShortcutRegistry;
}

/** Màn ĐÃ NỐI DÂY, dựng bằng MỘT thẻ với cổng giả — đúng thứ R-73 đòi. */
async function mountScreen(): Promise<MountedScreen> {
  const registry = createShortcutRegistry();

  renderWithProviders(
    <FloorManagerContainer
      gateway={createMockFloorManagerGateway()}
      projectId={PROJECT_ID}
      registry={registry}
      roles={['engineer']}
    />,
  );

  /* Trước lúc cổng trả lời, mọi kịch bản đều là "Đang tải" — chờ bảng thật. */
  await waitFor(() => {
    expect(screen.getByText(TABLE_CAPTION_MANUAL)).toBeInTheDocument();
  });

  return { registry };
}

/**
 * Bảng tầng ĐỌC TỪ MÀN, mỗi dòng một chuỗi.
 *
 * Nguồn là `aria-label` của chính thẻ `<tr>` — chuỗi mà `FloorTableRow.tsx`
 * sinh ra từ view-model (`"{tên}, cao độ {cao độ}, cao {chiều cao}, {tiến độ}
 * đã kiểm"`). Đọc ở đây thay vì đọc kho: bản nghiệm thu hỏi màn nói gì, không
 * hỏi kho giữ gì. Thứ tự mảng là thứ tự DOM, tức TỪ DƯỚI LÊN theo hợp đồng.
 */
function floorTableReadings(): readonly string[] {
  return screen
    .getAllByRole('row')
    .map((row) => row.getAttribute('aria-label'))
    .filter((label): label is string => label !== null);
}

/** Bốn dải lát cắt — thẻ dải có `flex-grow`, không lẫn nút thu gọn. */
function sectionBands(): readonly HTMLElement[] {
  const section = screen.getByLabelText(SECTION_ARIA_LABEL);

  return within(section)
    .getAllByRole('button')
    .filter((element) => element.style.flexGrow !== '');
}

/** Gõ một phím vào SỔ PHÍM THẬT, đúng đường một bàn phím thật đi (A12). */
async function pressKey(registry: ShortcutRegistry, key: string): Promise<void> {
  await act(async () => {
    registry.handleKeyDown({ key, ctrlKey: true }, null);
    await Promise.resolve();
  });
}

/* -------------------------------------------------------------------------- */
/* Môi trường.                                                                 */
/* -------------------------------------------------------------------------- */

afterEach(() => {
  cleanup();
  /* Kho dùng chung giữa các bài kiểm: trả nó về rỗng qua ĐÚNG hành động công khai. */
  const store = useStore.getState();

  store.setSpatial(null, null);
  store.clearSelection();
  store.setHovered(null);
  resetSelectorCaches();
  vi.useRealTimers();
  vi.restoreAllMocks();
});

/* -------------------------------------------------------------------------- */
/* [NGHIEM-1] Bảy trạng thái.                                                  */
/* -------------------------------------------------------------------------- */

describe('[NGHIEM-1] bảy trạng thái của A11', () => {
  it('dựng đủ 7/7 trạng thái, không trạng thái nào ra màn trắng', () => {
    let rendered = 0;

    expectSevenStates((scenario) => {
      const { container, unmount } = renderState(scenario.state);

      rendered += 1;

      return { container, unmount };
    }, scenarioIndex());

    /* Bản nghiệm thu đòi IN con số thật, không chỉ khẳng định nó. */
    console.log(`expectSevenStates: ${String(rendered)}/${String(SEVEN_STATES.length)}`);

    expect(rendered).toBe(SEVEN_STATES.length);
    expect(rendered).toBe(7);
  });

  it('mỗi trạng thái vẫn còn vỏ màn, nên không có màn trắng ở bất kỳ nhánh nào', () => {
    for (const state of SEVEN_STATES) {
      const { unmount } = renderState(state);

      expect(
        screen.getByRole('region', { name: SCREEN_ARIA_LABEL }),
        `trạng thái ${state} mất vỏ màn`,
      ).toBeInTheDocument();

      /* Thu gọn còn đường bung lại; lỗi đọc không có tầng nào để cắt (BUG-060). Mọi trạng thái khác có lát cắt. */
      if (state === 'collapsed') {
        expect(screen.getByRole('button', { name: EXPAND_SECTION_LABEL })).toBeInTheDocument();
      } else if (state === 'error') {
        expect(screen.queryByLabelText(SECTION_ARIA_LABEL)).not.toBeInTheDocument();
      } else {
        expect(
          screen.getAllByLabelText(SECTION_ARIA_LABEL).length,
          `trạng thái ${state} mất lát cắt`,
        ).toBeGreaterThan(0);
      }

      unmount();
    }
  });

  it('vai Người xem: bảng chỉ đọc, mọi thao tác sửa biến mất', () => {
    renderState('forbidden');

    expect(screen.queryByRole('button', { name: ADD_FLOOR_LABEL })).not.toBeInTheDocument();
    expect(screen.getAllByLabelText(SECTION_ARIA_LABEL).length).toBeGreaterThan(0);
    expect(screen.getByText(TABLE_CAPTION_TEXT)).toBeInTheDocument();
  });
});

/* -------------------------------------------------------------------------- */
/* [NGHIEM-2] Container gắn được bằng một thẻ (R-73).                          */
/* -------------------------------------------------------------------------- */

describe('[NGHIEM-2] màn đã nối dây', () => {
  it('dựng được bằng một thẻ với cổng giả, và ra khỏi trạng thái đang tải', async () => {
    await mountScreen();

    const readings = floorTableReadings();

    console.log(`[NGHIEM-2] container dựng xong, ${String(readings.length)} dòng tầng trên màn`);

    expect(screen.getByRole('region', { name: SCREEN_ARIA_LABEL })).toBeInTheDocument();
    expect(readings).toHaveLength(FLOOR_MANAGER_SAMPLE_LEVELS.length);
  });
});

/* -------------------------------------------------------------------------- */
/* [NGHIEM-3] Bảng cao độ trước và sau khi Tầng trệt cao 3,9 → 4,2 m.          */
/* -------------------------------------------------------------------------- */

describe('[NGHIEM-3] đổi chiều cao một tầng kéo cao độ tầng trên theo', () => {
  it('gõ 4,2 vào ô chiều cao rồi im lặng đủ nhịp chốt: cao độ Tầng 2 tự dịch', async () => {
    await mountScreen();

    const before = floorTableReadings();

    console.log('[NGHIEM-3] BẢNG CAO ĐỘ TRƯỚC:');
    for (const line of before) {
      console.log(`  ${line}`);
    }

    /* Bản Z: số lúc nghỉ là chữ, bấm vào mới thành ô nhập. */
    fireEvent.click(screen.getByRole('button', { name: new RegExp(`^Sửa chiều cao tầng ${GROUND_FLOOR?.name ?? ''}:`) }));
    const heightField = screen.getByLabelText(`Chiều cao tầng ${GROUND_FLOOR?.name ?? ''}`);
    const clock = installFakeClock();

    /* Gõ, rồi KHÔNG bấm gì nữa — nhịp chốt của NumericField phải tự tới. */
    await act(async () => {
      fireEvent.focus(heightField);
      fireEvent.change(heightField, { target: { value: NEW_GROUND_HEIGHT_DRAFT } });
      await clock.flushMicrotasks();
    });

    await act(async () => {
      await clock.advance(NUMERIC_FIELD_COMMIT_MS);
      await clock.flushMicrotasks();
      await clock.advance(SETTLE_MS);
      await clock.flushMicrotasks();
    });

    clock.restore();

    await waitFor(() => {
      expect(floorTableReadings()).not.toEqual(before);
    });

    const after = floorTableReadings();

    console.log('[NGHIEM-3] BẢNG CAO ĐỘ SAU:');
    for (const line of after) {
      console.log(`  ${line}`);
    }

    /* Cả bốn tầng vẫn còn — đổi chiều cao không được làm mất dòng nào. */
    expect(after).toHaveLength(FLOOR_MANAGER_SAMPLE_LEVELS.length);

    const groundName = GROUND_FLOOR?.name ?? '';
    const secondName = SECOND_FLOOR?.name ?? '';
    const groundAfter = after.find((line) => line.startsWith(groundName)) ?? '';
    const secondAfter = after.find((line) => line.startsWith(secondName)) ?? '';

    /* Tầng trệt CAO lên 4,2 m; Tầng 2 đứng ở CAO ĐỘ 4,2 m — hai chuyện khác nhau. */
    expect(groundAfter).toContain('cao 4,2 m');
    expect(secondAfter).toContain('cao độ 4,2 m');

    /* Và trước đó nó đúng là cảnh đặc tả tả: 3,9 m và cao độ 3,9 m. */
    expect(before.find((line) => line.startsWith(groundName)) ?? '').toContain('cao 3,9 m');
    expect(before.find((line) => line.startsWith(secondName)) ?? '').toContain('cao độ 3,9 m');
  });
});

/* -------------------------------------------------------------------------- */
/* [NGHIEM-4] Bốn cặp số tỷ lệ dải lát cắt.                                    */
/* -------------------------------------------------------------------------- */

describe('[NGHIEM-4] chiều cao dải tỷ lệ với chiều cao thật', () => {
  it('bốn cặp (chiều cao thật, chiều cao dải), và bốn tỷ lệ cộng lại bằng 1', async () => {
    await mountScreen();

    const bands = sectionBands();
    const totalHeightMm = FLOOR_MANAGER_SAMPLE_LEVELS.reduce(
      (total, level) => total + level.heightMm,
      0,
    );

    console.log('[NGHIEM-4] BỐN CẶP SỐ (chiều cao thật ↔ chiều cao dải):');

    let ratioSum = 0;

    bands.forEach((band, index) => {
      const level = FLOOR_MANAGER_SAMPLE_LEVELS[index];
      const writtenRatio = Number(band.style.flexGrow);

      ratioSum += writtenRatio;

      console.log(
        `  ${band.getAttribute('aria-label') ?? ''} → flex-grow ${band.style.flexGrow} ` +
          `(chiều cao thật ${String(level?.heightMm ?? 0)} mm / ${String(totalHeightMm)} mm)`,
      );

      /* Tỷ lệ dải PHẢI là chiều cao thật chia tổng — không hằng số, không làm tròn. */
      expect(writtenRatio).toBeCloseTo((level?.heightMm ?? 0) / totalHeightMm, 10);
    });

    console.log(
      `[NGHIEM-4] tổng tỷ lệ bốn dải = ${String(ratioSum)} · tổng chiều cao thật = ${String(totalHeightMm)} mm`,
    );

    expect(bands).toHaveLength(FLOOR_MANAGER_SAMPLE_LEVELS.length);
    expect(ratioSum).toBeCloseTo(1, 10);
    expect(totalHeightMm).toBe(14_100);
  });
});

/* -------------------------------------------------------------------------- */
/* [NGHIEM-5] Xoá một tầng rồi hoàn tác.                                       */
/* -------------------------------------------------------------------------- */

describe('[NGHIEM-5] xoá tầng và hoàn tác', () => {
  it('xoá ngay KHÔNG hộp thoại, rồi một lần Ctrl+Z trả thứ tự và cao độ về nguyên trạng', async () => {
    const { registry } = await mountScreen();

    const before = floorTableReadings();

    console.log('[NGHIEM-5] TRƯỚC:');
    for (const line of before) {
      console.log(`  ${line}`);
    }

    /* Mở menu ngữ cảnh của dòng, rồi chọn "Xoá tầng" — đường một người thật đi. */
    fireEvent.click(
      screen.getByLabelText(`Thao tác khác cho tầng ${SECOND_FLOOR?.name ?? ''}`),
    );

    const removeItem = screen.getByRole('menuitem', { name: REMOVE_FLOOR_MENU_ITEM });

    /* CẤM TUYỆT ĐỐI: xoá tầng không được hỏi bằng hộp thoại. */
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();

    await act(async () => {
      fireEvent.click(removeItem);
      await Promise.resolve();
    });

    await waitFor(() => {
      expect(floorTableReadings()).toHaveLength(FLOOR_MANAGER_SAMPLE_LEVELS.length - 1);
    });

    const afterRemove = floorTableReadings();

    console.log('[NGHIEM-5] SAU KHI XOÁ:');
    for (const line of afterRemove) {
      console.log(`  ${line}`);
    }

    expect(afterRemove.some((line) => line.startsWith(SECOND_FLOOR?.name ?? ''))).toBe(false);

    await pressKey(registry, 'z');

    await waitFor(() => {
      expect(floorTableReadings()).toHaveLength(FLOOR_MANAGER_SAMPLE_LEVELS.length);
    });

    const afterUndo = floorTableReadings();

    console.log('[NGHIEM-5] SAU KHI HOÀN TÁC:');
    for (const line of afterUndo) {
      console.log(`  ${line}`);
    }

    /* Thứ tự VÀ cao độ về nguyên trạng — so cả mảng, không so từng dòng rời. */
    expect(afterUndo).toEqual(before);
  });
});

/* -------------------------------------------------------------------------- */
/* [NGHIEM-6] Hai câu màn PHẢI nói ra.                                         */
/* -------------------------------------------------------------------------- */

describe('[NGHIEM-6] màn nói ra hai sự thật thay vì im lặng', () => {
  it('vai Người xem: câu giải thích vì sao mọi nút sửa biến mất có mặt trên màn', () => {
    const notice = floorManagerScenarioFor('forbidden').forbiddenNotice ?? '';

    renderState('forbidden');

    console.log(`[NGHIEM-6] câu của vai Người xem: ${notice}`);

    /* Ẩn nút là đúng; ẩn mà không nói vì sao mới là lỗi A11 mà bài này chặn. */
    expect(notice).not.toBe('');
    expect(screen.queryByRole('button', { name: ADD_FLOOR_LABEL })).not.toBeInTheDocument();
    expect(screen.getByText(notice, { exact: false })).toBeInTheDocument();
  });

  it('cổng khai khả năng chưa có: TỪNG câu nợ hiện ra, và câu chữ vẫn đi qua hai bộ soát', () => {
    const { container } = renderWithProviders(
      <FloorManager
        {...scenarioArgsFor('partial')}
        unsupportedNotices={FLOOR_MANAGER_FIXTURE_UNSUPPORTED_NOTICES}
      />,
    );

    console.log('[NGHIEM-6] CÁC CÂU NỢ CỦA CỔNG:');
    for (const notice of FLOOR_MANAGER_FIXTURE_UNSUPPORTED_NOTICES) {
      console.log(`  ${notice}`);
      expect(screen.getByText(notice, { exact: false })).toBeInTheDocument();
    }

    expect(FLOOR_MANAGER_FIXTURE_UNSUPPORTED_NOTICES.length).toBeGreaterThan(0);

    expectAccessible(container);
    expectVietnamese(container);
  });

  it('màn ĐÃ NỐI DÂY đọc câu nợ thẳng từ cổng thật; câu ẩn 3D chỉ khi có tầng ẩn (BUG-287)', async () => {
    await mountScreen();

    // G3-16: vừa mở, chưa nhân bản/xoá tầng nào thì chưa có gì "chưa lưu".
    expect(screen.queryByText(FLOOR_MANAGER_UNSUPPORTED_NOTICES.persistFloorContents, { exact: false })).not.toBeInTheDocument();
    expect(screen.queryByText(FLOOR_MANAGER_UNSUPPORTED_NOTICES.hideFloorFrom3d, { exact: false })).not.toBeInTheDocument();
  });

  it('BUG-287: mọi câu nợ gom vào MỘT dải, không tiêu đề "chỉ sống trong phiên" riêng', () => {
    renderWithProviders(
      <FloorManager {...scenarioArgsFor('partial')} unsupportedNotices={FLOOR_MANAGER_FIXTURE_UNSUPPORTED_NOTICES} />,
    );
    const strips = screen
      .getAllByRole('status')
      .filter((node) => FLOOR_MANAGER_FIXTURE_UNSUPPORTED_NOTICES.some((notice) => node.textContent?.includes(notice)));

    expect(strips).toHaveLength(1);
    expect(screen.queryByText(/chỉ sống|chỗ lưu/u)).not.toBeInTheDocument();
  });
});

/* -------------------------------------------------------------------------- */
/* Bốn bộ khẳng định dùng chung (R-72, R-67, A1).                              */
/* -------------------------------------------------------------------------- */

describe('khả năng tiếp cận và tiếng Việt', () => {
  for (const state of SEVEN_STATES) {
    it(`trạng thái "${SEVEN_STATE_LABELS[state]}" đi qua expectAccessible và expectVietnamese`, () => {
      const { container } = renderState(state);

      expectAccessible(container);
      expectVietnamese(container);
    });
  }

  it('thang cao độ là một nhóm có tên — aria-label trên role="presentation" bị trình đọc màn hình bỏ (B-V6-44)', () => {
    renderState('success');

    expect(screen.getByRole('group', { name: 'Thang cao độ' })).toBeInTheDocument();
  });

  it('màn đã nối dây cũng đi qua expectAccessible và expectVietnamese', async () => {
    const { container } = renderWithProviders(
      <FloorManagerContainer
        gateway={createMockFloorManagerGateway()}
        projectId={PROJECT_ID}
        roles={['engineer']}
      />,
    );

    await waitFor(() => {
      expect(screen.getByText(TABLE_CAPTION_MANUAL)).toBeInTheDocument();
    });

    expectAccessible(container);
    expectVietnamese(container);
  });
});

describe('màu lấy từ token (A1)', () => {
  it('không một mã màu thô nào trong cả thư mục màn', () => {
    expectNoRawColor('src/screens/qc/FloorManager');
  });
});

describe('breadcrumb chung (BUG-079)', () => {
  it('dùng breadcrumb chung: dấu "›", cấp "Dự án" không giả làm nút', () => {
    renderWithProviders(<FloorManager {...scenarioArgsFor('success')} />);

    const nav = screen.getByRole('navigation', { name: 'Đường dẫn trang' });
    expect(nav).toHaveTextContent('Dự án›Duyệt tầng');
    expect(nav.textContent).not.toContain('>');
    expect(within(nav).queryByRole('button')).toBeNull();
  });

  it('có lối về thì cấp "Dự án" là nút về danh sách dự án (review-1)', () => {
    const onBackToProjects = vi.fn();
    renderWithProviders(<FloorManager {...scenarioArgsFor('success')} onBackToProjects={onBackToProjects} />);

    const nav = screen.getByRole('navigation', { name: 'Đường dẫn trang' });
    fireEvent.click(within(nav).getByRole('link', { name: 'Dự án' }));

    expect(onBackToProjects).toHaveBeenCalledTimes(1);
  });

  it('BUG-108: cấp "Dự án" chạm được 44×44 px dưới sm — cả bề ngang, không chỉ chiều cao', () => {
    renderWithProviders(<FloorManager {...scenarioArgsFor('success')} onBackToProjects={vi.fn()} />);
    const nav = screen.getByRole('navigation', { name: 'Đường dẫn trang' });

    expect(within(nav).getByRole('link', { name: 'Dự án' })).toHaveClass('min-h-11', 'min-w-11', 'fine:min-h-6', 'fine:min-w-0');
  });
});

describe('dự án không tồn tại (BUG-032)', () => {
  it('nói không tìm thấy dự án và đưa lối về danh sách, không đưa "Thử lại"', () => {
    const onBackToProjects = vi.fn();
    renderWithProviders(
      <FloorManager {...scenarioArgsFor('error')} isProjectMissing onBackToProjects={onBackToProjects} />,
    );

    expect(screen.getByText('Không tìm thấy dự án này')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Thử lại' })).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Về danh sách dự án' }));
    expect(onBackToProjects).toHaveBeenCalledTimes(1);
  });

  it('BUG-060: không vẽ câu "chỉ sống trong phiên" và khung lát cắt trống cạnh 404', () => {
    renderWithProviders(
      <FloorManager
        {...scenarioArgsFor('error')}
        isProjectMissing
        unsupportedNotices={FLOOR_MANAGER_FIXTURE_UNSUPPORTED_NOTICES}
      />,
    );

    expect(screen.getByText('Không tìm thấy dự án này')).toBeInTheDocument();
    for (const notice of FLOOR_MANAGER_FIXTURE_UNSUPPORTED_NOTICES) {
      expect(screen.queryByText(notice, { exact: false })).not.toBeInTheDocument();
    }
    expect(screen.queryByLabelText(SECTION_ARIA_LABEL)).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: EXPAND_SECTION_LABEL })).not.toBeInTheDocument();
  });

  it('BUG-060: lỗi đọc khác 404 (mạng/5xx) cũng không vẽ câu "chỉ sống trong phiên" lẫn lát cắt', () => {
    renderWithProviders(
      <FloorManager {...scenarioArgsFor('error')} unsupportedNotices={FLOOR_MANAGER_FIXTURE_UNSUPPORTED_NOTICES} />,
    );

    for (const notice of FLOOR_MANAGER_FIXTURE_UNSUPPORTED_NOTICES) {
      expect(screen.queryByText(notice, { exact: false })).not.toBeInTheDocument();
    }
    expect(screen.queryByLabelText(SECTION_ARIA_LABEL)).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: EXPAND_SECTION_LABEL })).not.toBeInTheDocument();
  });
});

describe('bố cục gọn đo ở route (BUG-251)', () => {
  it.each([
    { matches: true, layout: 'flex-col', sectionAfterTable: true },
    { matches: false, layout: 'flex-row', sectionAfterTable: false },
  ])('(width < 1024px) = $matches → $layout, lát cắt sau bảng: $sectionAfterTable', async ({ matches, layout, sectionAfterTable }) => {
    vi.stubGlobal('fetch', () => new Promise<never>(() => undefined));
    vi.stubGlobal('matchMedia', (query: string) => ({
      matches: query === '(width < 1024px)' && matches,
      media: query,
      addEventListener: () => undefined,
      removeEventListener: () => undefined,
    }));

    renderWithProviders(
      <MemoryRouter initialEntries={[`/projects/${PROJECT_ID}/floors`]}>
        <Routes>
          <Route element={<FloorManagerRoute />} path="/projects/:projectId/floors" />
        </Routes>
      </MemoryRouter>,
    );

    const section = await screen.findByLabelText(SECTION_ARIA_LABEL);
    // Thứ tự DOM, không `order`: `order` chỉ dời hình, Tab vẫn đi theo DOM (WCAG 2.4.3, A12).
    const following = Boolean(section.compareDocumentPosition(screen.getByRole('table')) & Node.DOCUMENT_POSITION_FOLLOWING);
    expect(following).toBe(!sectionAfterTable);
    expect(section.parentElement?.parentElement).toHaveClass(layout);
    // BUG-520: route đứng một mình, khung `h-dvh` cho `h-full` của màn một chỗ bám.
    expect(screen.getByRole('region', { name: SCREEN_ARIA_LABEL }).parentElement).toHaveClass('h-dvh');
    vi.unstubAllGlobals();
  });

  it('khổ gọn: Tab tới "Thêm tầng" và bảng trước "Thu gọn lát cắt" và các dải', () => {
    renderWithProviders(<FloorManager {...scenarioArgsFor('partial')} isCompact />);
    const focusables = [...document.querySelectorAll<HTMLElement>('button, [tabindex="0"], input, a[href]')];
    const indexOf = (element: HTMLElement): number => focusables.indexOf(element);
    const collapse = indexOf(screen.getByRole('button', { name: 'Thu gọn lát cắt' }));

    expect(collapse).toBeGreaterThan(-1);
    expect(indexOf(screen.getByRole('button', { name: 'Thêm tầng' }))).toBeLessThan(collapse);
    expect(indexOf(screen.getAllByRole('button', { name: 'Tải bản vẽ' })[0]!)).toBeLessThan(collapse);
  });
});

describe('vùng chạm của nút chữ (BUG-257, BUG-270)', () => {
  it('"Tải lên", "Thu gọn lát cắt" và "Hiện lát cắt" cao 24 px, 44 px dưới sm', () => {
    const { unmount } = renderWithProviders(<FloorManager {...scenarioArgsFor('partial')} />);
    const targets = [
      ...screen.getAllByRole('button', { name: 'Tải bản vẽ' }),
      screen.getByRole('button', { name: 'Thu gọn lát cắt' }),
    ];
    unmount();
    renderWithProviders(<FloorManager {...scenarioArgsFor('collapsed')} />);
    targets.push(screen.getByRole('button', { name: EXPAND_SECTION_LABEL }));

    expect(targets.length).toBeGreaterThan(2);
    for (const target of targets) {
      expect(target).toHaveClass('min-h-11', 'fine:min-h-6');
    }
  });
});

describe('cao độ ghi đè (BUG-289)', () => {
  it('chú thích theo công tắc; ô ghi đè mang chữ "Ghi đè", ô khác thì không', () => {
    const base = scenarioArgsFor('partial');
    const rows = base.rows.map((row, index) => (index === 1 ? { ...row, isElevationOverridden: true } : row));
    const { unmount } = renderWithProviders(<FloorManager {...base} isAutoElevation={false} rows={rows} />);

    expect(screen.getByText(TABLE_CAPTION_OVERRIDE)).toBeInTheDocument();
    expect(screen.queryByText(TABLE_CAPTION_TEXT)).not.toBeInTheDocument();
    expect(screen.getAllByText('Ghi đè')).toHaveLength(1);
    expect(within(screen.getByRole('row', { name: new RegExp(`^${rows[1]!.name}, `, 'u') })).getByText('Ghi đè')).toBeInTheDocument();
    unmount();

    renderWithProviders(<FloorManager {...base} isAutoElevation />);
    expect(screen.getByText(TABLE_CAPTION_TEXT)).toBeInTheDocument();
    expect(screen.queryByText('Ghi đè')).not.toBeInTheDocument();
  });
});

describe('cao độ bị chặn (BUG-306)', () => {
  it('chỉ ô cao độ của tầng bị chặn mang dấu lỗi', () => {
    const base = scenarioArgsFor('partial');
    const rows = base.rows.map((row, index) => (index === 1 ? { ...row, isElevationRefused: true } : row));
    renderWithProviders(<FloorManager {...base} isAutoElevation={false} rows={rows} />);

    const invalid = screen.getAllByRole('textbox').filter((box) => box.getAttribute('aria-invalid') === 'true');
    expect(invalid).toHaveLength(1);
    expect(invalid[0]).toHaveAccessibleName(`Cao độ tầng ${rows[1]!.name}`);
  });
});

describe('bảng tầng vừa khung (BUG-250)', () => {
  it('lát cắt mở: vẫn MỘT hàng theo cột (bản Z, 6 cột), không lặp "Chưa có bản vẽ"', () => {
    renderWithProviders(<FloorManager {...scenarioArgsFor('partial')} />);
    const table = screen.getByRole('table');
    const roof = within(table).getByRole('row', { name: /^Tầng mái, / });

    expect(table.querySelector('thead')).not.toHaveClass('hidden');
    expect(roof).not.toHaveClass('flex');
    expect(within(roof).queryByText('Tiến độ')).not.toBeInTheDocument();
    expect(within(roof).getAllByText('Chưa có bản vẽ')).toHaveLength(1);
  });

  it('lát cắt thu gọn ở khổ rộng: đủ hàng tiêu đề, dòng không xếp chồng', () => {
    renderWithProviders(<FloorManager {...scenarioArgsFor('collapsed')} />);
    const table = screen.getByRole('table');

    expect(table.querySelector('thead')).not.toHaveClass('hidden');
    expect(within(table).getAllByRole('columnheader')).toHaveLength(6);
    for (const row of within(table).getAllByRole('row', { name: /, cao độ / })) {
      expect(row).not.toHaveClass('flex');
    }
  });
});

describe('kéo thả tới cuối bảng (BUG-518)', () => {
  it('thả vào nửa dưới dòng cuối thì hàng kéo xuống CUỐI, không chèn trước dòng cuối', () => {
    const base = scenarioArgsFor('partial');
    const onReorderFloors = vi.fn();
    renderWithProviders(<FloorManager {...base} onReorderFloors={onReorderFloors} />);
    const ids = base.rows.map((row) => row.id);
    const first = base.rows[0]!;
    const rows = screen.getAllByRole('row', { name: /, cao độ / });
    const last = rows[rows.length - 1]!;

    fireEvent.dragStart(screen.getByRole('button', { name: `Đổi thứ tự tầng ${first.name}` }));
    /* jsdom không có DragEvent: MouseEvent mang được clientY. Khung jsdom cao 0 nên 10 px là nửa dưới. */
    fireEvent(last, new MouseEvent('dragover', { bubbles: true, cancelable: true, clientY: 10 }));
    expect(last).toHaveClass('border-accent');
    fireEvent.drop(last);

    expect(onReorderFloors).toHaveBeenCalledWith([...ids.slice(1), first.id]);
  });
});

describe('đổi thứ tự bằng bàn phím ở nút kéo (G3-20)', () => {
  it('mũi tên xuống trên nút kéo dời tầng một bậc, gọi đúng một lần', () => {
    const base = scenarioArgsFor('partial');
    const onReorderFloors = vi.fn();
    renderWithProviders(<FloorManager {...base} onReorderFloors={onReorderFloors} />);
    const ids = base.rows.map((row) => row.id);

    fireEvent.keyDown(screen.getByRole('button', { name: `Đổi thứ tự tầng ${base.rows[0]!.name}` }), { key: 'ArrowDown' });

    expect(onReorderFloors).toHaveBeenCalledTimes(1);
    expect(onReorderFloors).toHaveBeenCalledWith([ids[1], ids[0], ...ids.slice(2)]);
  });
});

describe('rê lên dòng bảng làm sáng dải lát cắt (BUG-519)', () => {
  it('dải của tầng đang được rê mang nền hover; dải khác thì không', () => {
    const base = scenarioArgsFor('partial');
    const bands = base.bands.map((band, index) => ({ ...band, isHovered: index === 1 }));
    renderWithProviders(<FloorManager {...base} bands={bands} />);

    const hovered = sectionBands().filter((band) => band.classList.contains('bg-bg-hover'));

    expect(hovered).toHaveLength(1);
    expect(hovered[0]).toHaveAccessibleName(bands[1]!.label);
  });
});

describe('khung bảng có chiều cao xác định (BUG-520)', () => {
  it('vùng nội dung là cột flex lấp phần còn lại, nên khung bảng tự cuộn thay vì kéo dài trang', () => {
    renderWithProviders(<FloorManager {...scenarioArgsFor('partial')} />);
    const frame = screen.getByRole('table').parentElement?.closest('[class~="min-h-0"][class~="overflow-auto"]');
    const content = frame?.closest('[class~="max-w-[1280px]"][class~="flex-1"]');

    // `min-h-0` + `overflow-auto`: co lại và tự cuộn khi nhiều tầng; không `flex-1`, nên một
    // tầng không để lại ~400 px khung trống bên dưới (K5).
    expect(frame).toHaveClass('min-h-0', 'overflow-auto');
    expect(frame).not.toHaveClass('flex-1');
    expect(content).toHaveClass('flex', 'flex-col');
    expect(content?.firstElementChild).toHaveClass('flex-1');
  });
});

describe('người xem ở dự án rỗng (BUG-522)', () => {
  it('"Chưa có tầng nào" hiện, nhưng không có nút "Thêm tầng"', () => {
    renderWithProviders(<FloorManager {...scenarioArgsFor('empty')} canEdit={false} />);

    expect(screen.getByText('Chưa có tầng nào')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: ADD_FLOOR_LABEL })).not.toBeInTheDocument();
  });
});

describe('[SCR-22] lối vào Đối chiếu lớp phủ', () => {
  it('dòng tầng có bản vẽ có "Đối chiếu lớp phủ" trong menu … và bắn mã tầng', async () => {
    const onOpenOverlay = vi.fn();

    renderWithProviders(<FloorManager {...scenarioArgsFor('success')} onOpenOverlay={onOpenOverlay} />);

    /* Bản Z: "Đối chiếu lớp phủ" là hành động phụ, nằm trong menu "…" của dòng. */
    const [more] = screen.getAllByRole('button', { name: /^Thao tác khác cho tầng/ });

    fireEvent.click(more!);
    fireEvent.click(await screen.findByRole('menuitem', { name: /Đối chiếu lớp phủ/ }));
    expect(onOpenOverlay).toHaveBeenCalledTimes(1);
  });
});

describe('lối vào các màn duyệt lớp của tầng', () => {
  it('nút "Duyệt" mở menu năm lớp + hai công cụ; chọn một mục bắn mã tầng và mã màn', async () => {
    const onOpenFloorScreen = vi.fn();

    renderWithProviders(<FloorManager {...scenarioArgsFor('success')} onOpenFloorScreen={onOpenFloorScreen} />);

    const [first] = screen.getAllByRole('button', { name: /^Duyệt tầng/ });

    expect(first).toBeDefined();
    fireEvent.click(first!);

    const items = await screen.findAllByRole('menuitem');

    // Cùng tên, cùng thứ tự với dải lớp (FLOOR_LAYERS); công cụ "Hiệu chỉnh tỷ lệ" ở nhóm cuối.
    expect(items.map((item) => item.textContent)).toEqual([
      'Tường',
      'Cửa và nội thất',
      'Phòng',
      'Kích thước',
      'Độ dày tường',
      'Hiệu chỉnh tỷ lệ',
      'Trục',
    ]);
    fireEvent.click(screen.getByRole('menuitem', { name: 'Phòng' }));
    expect(onOpenFloorScreen).toHaveBeenCalledWith(expect.any(String), 'rooms');
  });

  it('UX-R2 K14: "Trục" mở màn Trục của tầng; căn hộ riêng thì không có "Trục"', async () => {
    const onOpenFloorScreen = vi.fn();
    const { rerender } = renderWithProviders(
      <FloorManager {...scenarioArgsFor('success')} onOpenFloorScreen={onOpenFloorScreen} />,
    );

    fireEvent.click(screen.getAllByRole('button', { name: /^Duyệt tầng/ })[0]!);
    fireEvent.click(await screen.findByRole('menuitem', { name: 'Trục' }));
    expect(onOpenFloorScreen).toHaveBeenCalledWith(expect.any(String), 'grids');

    rerender(<FloorManager {...scenarioArgsFor('success')} onOpenFloorScreen={onOpenFloorScreen} separateUnits />);
    fireEvent.click(screen.getAllByRole('button', { name: /^Duyệt tầng/ })[0]!);
    await screen.findAllByRole('menuitem');
    expect(screen.queryByRole('menuitem', { name: 'Trục' })).toBeNull();
  });
});

describe('màn không lặp menu dự án của header', () => {
  it('không còn nút "Màn dự án" (các màn phụ ở menu dự án trên header)', () => {
    renderWithProviders(<FloorManager {...scenarioArgsFor('success')} />);
    expect(screen.queryByRole('button', { name: 'Các màn của dự án' })).toBeNull();
  });
});

describe('lối sang 3D', () => {
  it('màn không vẽ nút chính thứ hai cùng đích với "Bước tiếp theo: Mô hình 3D" của thanh bước (K5)', () => {
    renderWithProviders(<FloorManager {...scenarioArgsFor('success')} />);
    expect(screen.queryByRole('button', { name: /mô hình 3D/u })).toBeNull();
  });
});

describe('[K34] công tắc "Các tầng là các căn hộ riêng"', () => {
  it('bật thì bỏ lát cắt, cột cao độ, thêm tầng và tự tính cao độ; bấm công tắc gửi giá trị mới', async () => {
    const onToggleSeparateUnits = vi.fn();

    renderWithProviders(
      <FloorManager {...scenarioArgsFor('success')} onToggleSeparateUnits={onToggleSeparateUnits} separateUnits />,
    );

    const toggle = screen.getByRole('switch', { name: 'Các tầng là các căn hộ riêng' });
    expect(toggle).toHaveAttribute('aria-checked', 'true');
    expect(screen.queryByLabelText(SECTION_ARIA_LABEL)).toBeNull();
    expect(screen.queryByRole('columnheader', { name: 'Cao độ (m)' })).toBeNull();
    expect(screen.queryByRole('button', { name: ADD_FLOOR_LABEL })).toBeNull();
    expect(screen.queryByRole('switch', { name: 'Tự tính cao độ' })).toBeNull();

    await act(async () => {
      fireEvent.click(toggle);
    });
    expect(onToggleSeparateUnits).toHaveBeenCalledWith(false);
  });

  it('[K09] dải "không có trục chung" mời bật công tắc và ẩn khi đã bật', () => {
    const onToggleSeparateUnits = vi.fn();
    const notice = { title: 'Các tầng không có trục chung', message: 'Phần lớn bản vẽ không khớp trục với nhau.' };
    const { rerender } = renderWithProviders(
      <FloorManager {...scenarioArgsFor('success')} axisMismatchNotice={notice} onToggleSeparateUnits={onToggleSeparateUnits} />,
    );

    fireEvent.click(screen.getByRole('button', { name: 'Đánh dấu là căn hộ riêng' }));
    expect(onToggleSeparateUnits).toHaveBeenCalledWith(true);

    rerender(
      <FloorManager {...scenarioArgsFor('success')} axisMismatchNotice={notice} onToggleSeparateUnits={onToggleSeparateUnits} separateUnits />,
    );
    expect(screen.queryByText(notice.title)).toBeNull();
  });
});
