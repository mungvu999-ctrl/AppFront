/**
 * Lượt kiểm của màn tải bản vẽ.
 *
 * Bốn bộ khẳng định dùng chung (`expectSevenStates`, `expectAccessible`,
 * `expectVietnamese`, `expectNoRawColor`) cộng bốn phép đo định lượng của bản
 * nghiệm thu:
 *
 * | mã | đo cái gì | ngưỡng |
 * |---|---|---|
 * | `[NGHIEM-A]` | bảy trạng thái của A11 | 7/7 |
 * | `[NGHIEM-B]` | số lần màn được cập nhật trong 1 giây lúc đang tải | ≤ 4 |
 * | `[NGHIEM-C]` | trần dung lượng viết tay trong thư mục màn | 0 |
 * | `[NGHIEM-D]` | tên tầng thiếu, và số lần cuộn tới đúng thẻ ấy | đúng 1 |
 * | `[NGHIEM-E1]` | lớp ảnh hưởng kích thước bị đổi lúc kéo tệp qua | 0 |
 *
 * Dữ liệu kịch bản lấy từ `FloorUploadScreen.stories.tsx` — một bộ duy nhất cho
 * cả story lẫn test, vì hai bộ song song là hai bộ sẽ lệch nhau (R-70).
 *
 * `[NGHIEM-E2]` — phép đo pixel thật — **không** nằm ở đây: jsdom không chạy bộ
 * dựng bố cục, nên `getBoundingClientRect()` trả toàn số 0 và một phép trừ hai
 * số 0 luôn đúng dù mã màn làm gì. Phần đo được trong jsdom là "danh sách lớp
 * ảnh hưởng hộp có bị đổi không", và đó đúng là những gì `[NGHIEM-E1]` khẳng
 * định — không hơn.
 */

import { Profiler } from 'react';
import { readFileSync, readdirSync } from 'node:fs';
import { act, cleanup, fireEvent, screen, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { createMockApiClient } from '@/api/__mocks__/client';
import type { DrawingsApi } from '@/api/client';
import { formatFileSize } from '@/lib/format/bytes';
import { durationMs, REDUCED_MOTION_QUERY } from '@/lib/motion';
import {
  createNetworkMonitor,
  type NetworkMonitor,
  type NetworkMonitorStatus,
  type NetworkStatusListener,
} from '@/lib/offline/networkMonitor';
import { expectAccessible } from '@/lib/testing/expectAccessible';
import { expectNoRawColor } from '@/lib/testing/expectNoRawColor';
import { expectSevenStates } from '@/lib/testing/expectSevenStates';
import { expectVietnamese } from '@/lib/testing/expectVietnamese';
import { FAKE_CLOCK_START, installFakeClock, type FakeClock } from '@/lib/testing/fakeClock';
import { renderWithProviders } from '@/lib/testing/render';
import {
  SEVEN_STATES,
  SEVEN_STATE_LABELS,
  type SevenStateScenario,
} from '@/lib/testing/sevenStateScenarios';
import {
  ACCEPTED_UPLOAD_EXTENSIONS,
  createUploadTask,
  MAX_UPLOAD_FILE_SIZE_BYTES,
  PROGRESS_EMITS_PER_SECOND,
  UPLOAD_CHUNK_SIZE_BYTES,
} from '@/lib/upload';

import { FloorUploadScreenView } from './FloorUploadScreen';
import { FloorUploadScreenContainer } from './FloorUploadScreen.container';
import { DROP_ZONE_TEST_ID, FILE_INPUT_TEST_ID } from './FloorUploadDropZone';
import { BLOCK_NOTICE_TEST_ID, COUNTER_NUMBER_TEST_ID, GATE_PANEL_ID } from './FloorUploadGatePanel';
import { createFloorUploadGateway, type FloorUploadGateway } from './floorUploadGateway';
import { blockedScenario, scenarioFor, trayScenario } from './FloorUploadScreen.stories';

/* -------------------------------------------------------------------------- */
/* Khung.                                                                      */
/* -------------------------------------------------------------------------- */

/** Thư mục màn — dùng cho lượt soát mã màu thô và lượt soát trần dung lượng. */
const SCREEN_DIRECTORY = 'src/screens/upload/FloorUploadScreen';

const PROJECT_ID = 'project-1';

/**
 * Từ cho qua: đuôi tệp và đơn vị dung lượng.
 *
 * Đây là cửa thoát mà `expectVietnamese` mở sẵn cho "tên sản phẩm, định dạng
 * tệp, một đơn vị module chưa nghe qua" — không phải một lượt nới lỏng: mọi
 * chuỗi tiếng Việt khác vẫn bị soát nguyên vẹn. Danh sách đuôi tệp lấy từ hằng
 * của `src/lib/upload` nên nó không lệch được khỏi thứ màn thật sự nhận.
 */
const FORMAT_WORDS: readonly string[] = [
  ...ACCEPTED_UPLOAD_EXTENSIONS.map((extension) => extension.replace('.', '')),
  'B',
  'kB',
  'MB',
  'GB',
  'm',
  'mm',
];

/**
 * Tên tệp mẫu là chuỗi không dấu do người dùng đặt, không phải chữ của sản phẩm.
 *
 * `expectVietnamese` soát chữ mà SẢN PHẨM viết ra. Một tên tệp là dữ liệu người
 * dùng mang tới; đòi nó có dấu là đòi sai chỗ.
 */
const FILE_NAME_PATTERN = /(?:mat-bang|ban-ve)[\w.-]*/u;

beforeEach(() => {
  Object.defineProperty(window, 'matchMedia', {
    writable: true,
    value: vi.fn().mockImplementation((query: string) => ({
      matches: false,
      media: query,
      onchange: null,
      addListener: vi.fn(),
      removeListener: vi.fn(),
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      dispatchEvent: vi.fn(),
    })),
  });
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

/** Mảng thứ hai của `expectSevenStates` chỉ để thoả kiểu; props thật đến từ `scenarioFor`. */
function scenarioIndex(): readonly SevenStateScenario[] {
  return SEVEN_STATES.map((state) => ({
    state,
    label: SEVEN_STATE_LABELS[state],
    rows: [],
    totalCount: 4,
    isLoading: state === 'loading',
    isCollapsed: state === 'collapsed',
    canView: state !== 'forbidden',
    error: null,
  }));
}

/* -------------------------------------------------------------------------- */
/* (a) Bảy trạng thái.                                                         */
/* -------------------------------------------------------------------------- */

describe('FloorUploadScreenView — bảy trạng thái (A11, R-63)', () => {
  it('vẽ đủ bảy trạng thái, không lần nào ném lỗi và không lần nào ra màn trắng', () => {
    let rendered = 0;

    expectSevenStates((scenario) => {
      const { container, unmount } = renderWithProviders(
        <FloorUploadScreenView {...scenarioFor(scenario.state)} />,
      );

      rendered += 1;

      return { container, unmount };
    }, scenarioIndex());

    console.log(`[NGHIEM-A] trang-thai-ve-duoc=${String(rendered)}/${String(SEVEN_STATES.length)}`);
    expect(rendered).toBe(SEVEN_STATES.length);
  });

  it('lỗi của một tệp ở lại trong thẻ của nó, không thành lỗi của cả màn và không mở hộp thoại', () => {
    renderWithProviders(<FloorUploadScreenView {...trayScenario()} />);

    // Thẻ tầng thứ ba mang một tệp bị từ chối; danh sách tầng vẫn đủ bốn thẻ và
    // chân trang vẫn ở đó — lỗi không chặn được ba tệp còn lại.
    expect(screen.getAllByRole('listitem').length).toBeGreaterThanOrEqual(4);
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(screen.getByRole('button', { name: /bắt đầu xử lý/iu })).toBeEnabled();
  });

  it('thẻ có tệp hỏng mời "Chọn tệp khác" ngay tại tầng (U29)', () => {
    renderWithProviders(<FloorUploadScreenView {...trayScenario()} onFilesForFloor={vi.fn()} />);

    expect(screen.getByRole('button', { name: 'Chọn tệp khác' })).toBeInTheDocument();
  });

  it('thẻ có tệp mời "Tờ này có nhiều tầng" và nút tới được hành động của màn (MULTI-FLOOR)', () => {
    const base = trayScenario();
    const index = base.floors.findIndex((row) => row.file !== null && row.error === null);
    const floors = base.floors.map((row, i) => (i === index ? { ...row, canSplitSheet: true } : row));
    const onOpenSheetRegions = vi.fn();
    renderWithProviders(<FloorUploadScreenView {...base} floors={floors} onOpenSheetRegions={onOpenSheetRegions} />);

    fireEvent.click(screen.getByRole('button', { name: 'Tờ này có nhiều tầng' }));

    expect(onOpenSheetRegions).toHaveBeenCalledWith(floors[index]?.file?.id);
  });

  it('dự án chưa có tầng: trạng thái rỗng có chữ riêng, tiêu đề vùng thả chỉ hiện một lần (BUG-100)', () => {
    const props = scenarioFor('empty');
    renderWithProviders(<FloorUploadScreenView {...props} floors={[]} />);

    expect(screen.getAllByText(props.dropZone.title)).toHaveLength(1);
    expect(screen.getByText('Dự án chưa có tầng nào')).toBeInTheDocument();
  });

  it('dự án chưa có tầng: nút "Thêm tầng" dẫn tới Quản lý tầng (BUG-298)', () => {
    const onAddFloors = vi.fn();
    renderWithProviders(
      <FloorUploadScreenView {...scenarioFor('empty')} floors={[]} onAddFloors={onAddFloors} />,
    );

    fireEvent.click(screen.getByRole('button', { name: 'Thêm tầng' }));

    expect(onAddFloors).toHaveBeenCalledTimes(1);
  });

  it('dự án không tồn tại: "Không tìm thấy dự án này" + "Về danh sách dự án", không vùng thả, không nút chính (BUG-311)', () => {
    const onBackToProjects = vi.fn();
    renderWithProviders(
      <FloorUploadScreenView
        {...scenarioFor('error')}
        canRetryLoad={false}
        isProjectMissing
        onBackToProjects={onBackToProjects}
      />,
    );

    expect(screen.getByText('Không tìm thấy dự án này')).toBeInTheDocument();
    expect(screen.queryByTestId(DROP_ZONE_TEST_ID)).toBeNull();
    expect(screen.queryByRole('button', { name: 'Bắt đầu xử lý' })).toBeNull();

    fireEvent.click(screen.getByRole('button', { name: 'Về danh sách dự án' }));

    expect(onBackToProjects).toHaveBeenCalledTimes(1);
  });

  it('lỗi đọc tầng thử lại được: dải lỗi có "Thử lại" (BUG-311)', () => {
    const onRetryLoad = vi.fn();
    renderWithProviders(<FloorUploadScreenView {...scenarioFor('error')} onRetryLoad={onRetryLoad} />);

    fireEvent.click(screen.getByRole('button', { name: 'Thử lại' }));

    expect(onRetryLoad).toHaveBeenCalledTimes(1);
  });

  it('màn chỉ đọc không vẽ vùng kéo thả, nhưng vẫn nói ra vì sao', () => {
    renderWithProviders(<FloorUploadScreenView {...scenarioFor('forbidden')} />);

    expect(screen.queryByTestId(DROP_ZONE_TEST_ID)).toBeNull();
    expect(screen.getByText(/chỉ được xem danh sách tệp/iu)).toBeInTheDocument();
  });
});

/* -------------------------------------------------------------------------- */
/* Bộ khẳng định dùng chung (R-72).                                            */
/* -------------------------------------------------------------------------- */

describe('FloorUploadScreenView — breadcrumb', () => {
  it('cấp "Dự án" về danh sách dự án khi có lối về (review-1)', () => {
    const onBackToProjects = vi.fn();
    renderWithProviders(<FloorUploadScreenView {...scenarioFor('success')} onBackToProjects={onBackToProjects} />);

    const nav = screen.getByRole('navigation', { name: 'Đường dẫn trang' });
    fireEvent.click(within(nav).getByRole('link', { name: 'Dự án' }));

    expect(onBackToProjects).toHaveBeenCalledTimes(1);
  });

  it('nêu tên dự án giữa "Dự án" và "Tải lên bản vẽ" khi biết tên (BUG-165)', () => {
    renderWithProviders(<FloorUploadScreenView {...scenarioFor('success')} projectName="Nhà phố Quận 3" />);

    const nav = screen.getByRole('navigation', { name: 'Đường dẫn trang' });
    expect(nav).toHaveTextContent('Dự án›Nhà phố Quận 3›Tải lên bản vẽ');
  });
});

describe('FloorUploadScreenView — khả năng tiếp cận và tiếng Việt (R-72)', () => {
  it('nút tuỳ chọn của thẻ nói bảng đang mở hay đóng, và chỉ có mặt khi có mục để chọn (B-V4-07)', () => {
    const scenario = scenarioFor('partial');
    renderWithProviders(<FloorUploadScreenView {...scenario} />);

    const menuButtons = screen.queryAllByRole('button', { name: /^Tuỳ chọn của tầng / });
    const rowsWithActions = scenario.floors.filter(
      (row) =>
        row.file !== null &&
        (row.canCancelUpload || row.canRetryUpload || (row.canRemoveFile && row.removeLabel !== null)),
    );

    expect(menuButtons).toHaveLength(rowsWithActions.length);

    const first = menuButtons[0];

    if (first === undefined) {
      throw new Error('kịch bản partial phải có ít nhất một thẻ có tuỳ chọn');
    }

    expect(first).toHaveAttribute('aria-expanded', 'false');
    fireEvent.click(first);
    expect(first).toHaveAttribute('aria-expanded', 'true');
    fireEvent.keyDown(first, { key: 'Escape' });
    expect(first).toHaveAttribute('aria-expanded', 'false');
  });

  it('đi qua expectAccessible ở trạng thái đầy đủ nhất', () => {
    const { container } = renderWithProviders(<FloorUploadScreenView {...trayScenario()} />);

    expectAccessible(container);
  });

  it('đi qua expectAccessible ở trạng thái chỉ đọc', () => {
    const { container } = renderWithProviders(
      <FloorUploadScreenView {...scenarioFor('forbidden')} />,
    );

    expectAccessible(container);
  });

  it('mọi chuỗi hiển thị là tiếng Việt có dấu', () => {
    const { container } = renderWithProviders(<FloorUploadScreenView {...trayScenario()} />);

    expectVietnamese(container, {
      allowWords: FORMAT_WORDS,
      ignore: [FILE_NAME_PATTERN],
    });
  });

  it('không mã màu thô trong bất kỳ file nào của thư mục màn (A1)', () => {
    for (const file of readdirSync(SCREEN_DIRECTORY)) {
      expectNoRawColor(`${SCREEN_DIRECTORY}/${file}`);
    }
  });
});

/* -------------------------------------------------------------------------- */
/* (c) Không trần dung lượng viết tay.                                         */
/* -------------------------------------------------------------------------- */

describe('FloorUploadScreen — không tự viết giới hạn dung lượng', () => {
  it('không file nào trong thư mục màn chứa trần dung lượng dưới dạng byte hay dạng chữ', () => {
    // Ba dạng viết mà lệnh soát của bản nghiệm thu tìm, dựng TỪ HẰNG chứ không
    // gõ tay: gõ tay vào đây thì chính file test này thành một kết quả của lệnh
    // soát ấy.
    const forbidden = [
      String(UPLOAD_CHUNK_SIZE_BYTES),
      String(MAX_UPLOAD_FILE_SIZE_BYTES),
      // Hai cách viết của cùng con số: bản có một chữ số thập phân mà
      // `formatFileSize` trả về mặc định, và bản tròn mà người ta hay gõ vào
      // chú thích.
      formatFileSize(MAX_UPLOAD_FILE_SIZE_BYTES),
      formatFileSize(MAX_UPLOAD_FILE_SIZE_BYTES, { fractionDigits: 0 }),
    ];

    const hits: string[] = [];

    for (const file of readdirSync(SCREEN_DIRECTORY)) {
      const source = readFileSync(`${SCREEN_DIRECTORY}/${file}`, 'utf8');

      for (const needle of forbidden) {
        if (source.includes(needle)) {
          hits.push(`${file}: ${needle}`);
        }
      }
    }

    console.log(`[NGHIEM-C] tran-dung-luong-viet-tay=${String(hits.length)}`);
    expect(hits, `thư mục màn không được viết lại trần dung lượng: ${hits.join(', ')}`).toEqual([]);
  });
});

/* -------------------------------------------------------------------------- */
/* (d) Nút chặn nêu tên tầng thiếu và cuộn tới đó.                             */
/* -------------------------------------------------------------------------- */

describe('FloorUploadScreenView — công tắc nhận diện đồ đạc (QT-FURN-TOGGLE)', () => {
  it('vẽ công tắc theo cờ dự án và gọi lưu khi bấm; chỉ đọc thì khoá', () => {
    const setDetectFurniture = vi.fn();
    const furniture = { detectFurniture: false, isSaving: false, saveError: null, setDetectFurniture };
    const { unmount } = renderWithProviders(<FloorUploadScreenView {...scenarioFor('success')} detectFurniture={furniture} />);
    const toggle = screen.getByRole('switch', { name: /Nhận diện đồ đạc/u });
    expect(toggle).toHaveAttribute('aria-checked', 'false');
    fireEvent.click(toggle);
    expect(setDetectFurniture).toHaveBeenCalledWith(true);
    unmount();

    renderWithProviders(<FloorUploadScreenView {...scenarioFor('success')} canEdit={false} detectFurniture={furniture} />);
    expect(screen.getByRole('switch', { name: /Nhận diện đồ đạc/u })).toBeDisabled();
  });

  it('không có cờ thì không vẽ công tắc', () => {
    renderWithProviders(<FloorUploadScreenView {...scenarioFor('success')} />);
    expect(screen.queryByRole('switch', { name: /Nhận diện đồ đạc/u })).toBeNull();
  });
});

describe('FloorUploadScreenView — tầng hay căn hộ riêng (K19)', () => {
  it('hỏi một câu, hai nút gọi đúng hành động', () => {
    const onSplitAsFloors = vi.fn();
    const onSplitAsApartments = vi.fn();
    renderWithProviders(
      <FloorUploadScreenView
        {...scenarioFor('success')}
        onSplitAsApartments={onSplitAsApartments}
        onSplitAsFloors={onSplitAsFloors}
        splitPrompt={{
          question: 'Các bản vẽ này là các tầng của cùng một nhà, hay là các căn hộ riêng?',
          detail: 'Bạn vừa chọn 2 bản vẽ.',
          floorsLabel: 'Các tầng của một nhà',
          apartmentsLabel: 'Các căn hộ riêng',
        }}
      />,
    );

    const prompt = screen.getByRole('region', { name: /các tầng của cùng một nhà/u });
    fireEvent.click(within(prompt).getByRole('button', { name: 'Các tầng của một nhà' }));
    fireEvent.click(within(prompt).getByRole('button', { name: 'Các căn hộ riêng' }));

    expect(onSplitAsFloors).toHaveBeenCalledTimes(1);
    expect(onSplitAsApartments).toHaveBeenCalledTimes(1);
  });

  it('liệt kê dự án vừa tạo; chỉ hàng mở được mới có nút mở', () => {
    const onOpenApartment = vi.fn();
    const row = { fileName: 'can-ho-a.png', problem: null, statusVariant: 'neutral' as const };
    renderWithProviders(
      <FloorUploadScreenView
        {...scenarioFor('success')}
        apartments={{
          title: 'Dự án vừa tạo',
          summary: 'Đã tải xong 1 / 2 bản vẽ, mỗi bản vẽ một dự án.',
          openLabel: 'Mở dự án',
          dismissLabel: 'Ẩn danh sách',
          rows: [
            {
              ...row,
              id: 'a',
              projectName: 'can-ho-a',
              statusLabel: 'Đã tải bản vẽ',
              canOpen: true,
              note: 'Đã lấy trang 1 trong 3 trang. Cần trang khác thì mở dự án và tải lại.',
            },
            { ...row, id: 'b', projectName: 'can-ho-b', statusLabel: 'Đang tải bản vẽ', canOpen: false },
          ],
        }}
        onOpenApartment={onOpenApartment}
      />,
    );

    const list = screen.getByRole('region', { name: 'Dự án vừa tạo' });
    expect(within(list).getAllByRole('button', { name: /^Mở dự án/u })).toHaveLength(1);
    expect(within(list).getByText(/Đã lấy trang 1 trong 3 trang/u)).toBeInTheDocument();
    fireEvent.click(within(list).getByRole('button', { name: 'Mở dự án can-ho-a' }));

    expect(onOpenApartment).toHaveBeenCalledWith('a');
  });
});

describe('FloorUploadScreenView — nút chính bị chặn (tiêu chí d)', () => {
  it('nêu tên tầng còn thiếu và cuộn tới đúng thẻ ấy, đúng một lần', () => {
    const scrollSpy = vi.fn();

    // jsdom không cài đặt cuộn, nên `scrollIntoView` không tồn tại cho tới khi
    // test gán nó. `mock.contexts[0]` sau đó là chính phần tử mã màn đã gọi lên.
    Element.prototype.scrollIntoView = scrollSpy;

    const missingFloorName = 'Tầng 2';
    const scenario = blockedScenario(2);

    expect(scenario.footer.canSubmit).toBe(false);

    renderWithProviders(<FloorUploadScreenView {...scenario} />);

    const submitButton = screen.getByRole('button', { name: /bắt đầu xử lý/iu });

    // Cấm "vô hiệu nút chính mà không nêu lý do": nút bấm được, lý do nằm trên
    // trang, không phải trong một thuộc tính `disabled` im lặng.
    expect(submitButton).toBeEnabled();

    const notice = screen.getByTestId(BLOCK_NOTICE_TEST_ID);

    // Nguyên câu, không phải một mẩu: `floor.name` của API đã là `Tầng 2`, nên
    // câu chỉ được mang nhãn tầng ĐÚNG MỘT LẦN. Một `RegExp` chỉ tìm `Tầng 2`
    // sẽ xanh cả với `Tầng Tầng 2 chưa có bản vẽ.`.
    const missingSentence = `${missingFloorName} chưa có bản vẽ.`;

    expect(within(notice).getByText(missingSentence)).toBeInTheDocument();

    expect(scrollSpy).toHaveBeenCalledTimes(1);

    const scrolled = scrollSpy.mock.contexts[0] as HTMLElement;

    expect(
      scrolled.textContent,
      `scrollIntoView phải gọi trên thẻ chứa tên tầng thiếu, đã gọi trên: "${String(scrolled.textContent)}"`,
    ).toContain(missingFloorName);

    console.log(
      `[NGHIEM-D] cau-chan="${missingSentence}" scroll-called=${String(scrollSpy.mock.calls.length)}`,
    );
  });

  it('không cuộn lần nào khi chưa có lời chặn nào', () => {
    const scrollSpy = vi.fn();

    Element.prototype.scrollIntoView = scrollSpy;

    renderWithProviders(<FloorUploadScreenView {...scenarioFor('partial')} />);

    expect(scrollSpy).not.toHaveBeenCalled();
  });
});

/* -------------------------------------------------------------------------- */
/* (e) phần 1 — vùng thả không đổi kích thước khi kéo tệp qua.                 */
/* -------------------------------------------------------------------------- */

/** Tiền tố của mọi lớp Tailwind có thể đổi hộp của một phần tử. */
const SIZE_AFFECTING_CLASS =
  /^(w-|h-|min-w-|min-h-|max-w-|max-h-|p-|px-|py-|pt-|pr-|pb-|pl-|m-|mx-|my-|mt-|mr-|mb-|ml-|border-[0-9]|inset-|top-|right-|bottom-|left-|gap-)/u;

const classSetOf = (element: Element): Set<string> =>
  new Set(element.className.split(/\s+/u).filter((token) => token.length > 0));

describe('FloorUploadScreenView — vùng thả lúc kéo tệp qua (tiêu chí e, phần 1)', () => {
  it('đổi màu viền và nền nhưng không đổi lớp nào ảnh hưởng kích thước', () => {
    const scenario = scenarioFor('partial');

    const { container, rerender } = renderWithProviders(
      <FloorUploadScreenView {...scenario} isDragActive={false} />,
    );

    const zone = screen.getByTestId(DROP_ZONE_TEST_ID);
    const classesBefore = classSetOf(zone);
    const styleBefore = zone.getAttribute('style');

    // Kéo tệp qua trang: view thuần không tự giữ trạng thái, nên test đóng vai
    // hook và dựng lại nó với `isDragActive` bật — đúng thứ
    // `useFloorUploadScreen` làm khi `dragDepth > 0`.
    const dataTransfer = { files: [], items: [{ kind: 'file', type: 'image/png' }], types: ['Files'] };

    fireEvent.dragEnter(zone, { dataTransfer });
    fireEvent.dragOver(zone, { dataTransfer });
    rerender(<FloorUploadScreenView {...scenario} isDragActive />);

    const zoneAfter = screen.getByTestId(DROP_ZONE_TEST_ID);
    const classesAfter = classSetOf(zoneAfter);
    const styleAfter = zoneAfter.getAttribute('style');

    const added = [...classesAfter].filter((token) => !classesBefore.has(token));
    const removed = [...classesBefore].filter((token) => !classesAfter.has(token));
    const sizeAffecting = [...added, ...removed].filter((token) =>
      SIZE_AFFECTING_CLASS.test(token),
    );

    console.log(`[NGHIEM-E1] lop-doi-kich-thuoc=${String(sizeAffecting.length)}`);

    expect(
      sizeAffecting,
      `kéo tệp qua không được đổi lớp ảnh hưởng kích thước, nhưng đã đổi: ${sizeAffecting.join(', ')}`,
    ).toEqual([]);
    expect(
      added.length + removed.length,
      'phải có ít nhất một lớp đổi, nếu không thì vùng thả không phản hồi gì cả',
    ).toBeGreaterThan(0);
    expect(styleBefore).toBeNull();
    expect(styleAfter).toBeNull();
    expect(container).toBeTruthy();
  });

  it('báo cho hook biết tệp đã vào và đã ra khỏi trang', () => {
    const onDragEnter = vi.fn();
    const onDragLeave = vi.fn();

    renderWithProviders(
      <FloorUploadScreenView
        {...scenarioFor('partial')}
        onDragEnter={onDragEnter}
        onDragLeave={onDragLeave}
      />,
    );

    const zone = screen.getByTestId(DROP_ZONE_TEST_ID);

    fireEvent.dragEnter(zone, { dataTransfer: { files: [], items: [], types: ['Files'] } });
    fireEvent.dragLeave(zone, { dataTransfer: { files: [], items: [], types: ['Files'] } });

    expect(onDragEnter).toHaveBeenCalledTimes(1);
    expect(onDragLeave).toHaveBeenCalledTimes(1);
  });
});

/* -------------------------------------------------------------------------- */
/* (b) Tốc độ cập nhật tiến trình.                                             */
/* -------------------------------------------------------------------------- */

/** Độ trễ giả của mỗi khúc, để một lượt tải kéo dài hơn cửa sổ đo một giây. */
const CHUNK_LATENCY_MS = 40;

/** Khúc nhỏ để một tệp bé sinh ra nhiều nhịp tiến trình như một tệp thật. */
const TEST_CHUNK_SIZE_BYTES = 128;

/** Dung lượng tệp mẫu: 32 khúc × 40 ms ⇒ lượt tải dài hơn một giây mô phỏng. */
const TEST_FILE_BYTES = 4096;

/** Cửa sổ đo, tính bằng mili-giây mô phỏng. */
const MEASURE_WINDOW_MS = 1000;

/** Một nhịp nhỏ để cho các lượt hẹn giờ của react-query chạy hết. */
const SETTLE_STEP_MS = 10;

function createFakeNetworkMonitor(): NetworkMonitor {
  const listeners = new Set<NetworkStatusListener>();
  const statusOf = (): NetworkMonitorStatus => ({
    browserOnline: true,
    checkedAt: 0,
    online: true,
    pingOnline: true,
  });

  return {
    checkNow: async () => statusOf(),
    getStatus: statusOf,
    start: () => undefined,
    stop: () => undefined,
    subscribe: (listener) => {
      listeners.add(listener);

      return () => {
        listeners.delete(listener);
      };
    },
  };
}

/**
 * Cổng thật, chạy trên client giả, với một lượt tải **thật** của
 * `createUploadTask`.
 *
 * Đây là điểm mấu chốt của phép đo: cái bị đo là bộ tiết chế thật trong
 * `src/lib/upload`, không phải một bản giả dựng tại chỗ. Chỉ hai thứ bị thay —
 * kích thước khúc (để một tệp 4 KiB sinh ra 32 nhịp như một tệp thật) và độ trễ
 * mạng (để thời gian mô phỏng thật sự trôi).
 */
function createChunkyGateway(): FloorUploadGateway {
  const client = createMockApiClient();

  const slowDrawings: DrawingsApi = {
    ...client.drawings,
    sendChunk: async (input) => {
      await new Promise<void>((resolve) => {
        setTimeout(resolve, CHUNK_LATENCY_MS);
      });

      return client.drawings.sendChunk(input);
    },
  };

  const real = createFloorUploadGateway(client, { networkMonitor: createFakeNetworkMonitor() });

  return {
    ...real,
    createUpload: ({ file, floorId, id, onProgress, projectId }) =>
      createUploadTask({
        api: slowDrawings,
        chunkSizeBytes: TEST_CHUNK_SIZE_BYTES,
        file,
        floorId,
        onProgress,
        projectId,
        ...(id === undefined ? {} : { id }),
      }),
  };
}

/** Phần trăm mà thẻ Tầng 2 đang đọc lên, lấy từ chính phần tử trình đọc màn hình nghe. */
function uploadPercentText(): string {
  return document.querySelector('[data-floor-id="L2"] [role="progressbar"]')?.textContent ?? '';
}

describe('FloorUploadScreen — tốc độ cập nhật tiến trình (tiêu chí b)', () => {
  let clock: FakeClock;

  beforeEach(() => {
    clock = installFakeClock();
  });

  afterEach(() => {
    clock.restore();
  });

  it(`cập nhật không quá ${String(PROGRESS_EMITS_PER_SECOND)} lần mỗi giây, và vẫn tới được 100%`, async () => {
    let commits = 0;

    renderWithProviders(
      <Profiler
        id="floor-upload"
        onRender={() => {
          commits += 1;
        }}
      >
        <FloorUploadScreenContainer gateway={createChunkyGateway()} projectId={PROJECT_ID} />
      </Profiler>,
    );

    // `renderWithProviders` không bọc Router nhưng có `QueryClientProvider`;
    // lượt đọc danh sách tầng đi qua vài vòng promise cộng một nhịp hẹn giờ của
    // react-query, nên phải cho đồng hồ giả chạy vài lượt chứ không chỉ vét
    // microtask một lần.
    await act(async () => {
      await clock.advance(SETTLE_STEP_MS);
      await clock.flushMicrotasks();
      await clock.advance(SETTLE_STEP_MS);
      await clock.flushMicrotasks();
    });

    // Bốn tầng của bộ mẫu đã đọc xong.
    expect(screen.getByText('Tầng 2')).toBeInTheDocument();

    const file = new File(['x'.repeat(TEST_FILE_BYTES)], 'mat-bang-tang-2.png', {
      type: 'image/png',
    });

    await act(async () => {
      fireEvent.change(screen.getByTestId(FILE_INPUT_TEST_ID), { target: { files: [file] } });
      await clock.flushMicrotasks();
    });

    // Bỏ qua các lần vẽ của lúc mở màn và lúc thả tệp; đo đúng cửa sổ một giây
    // sau khi lượt tải đã chạy.
    const percentBefore = uploadPercentText();

    commits = 0;

    // Tua theo từng nhịp nhỏ, mỗi nhịp một `act` riêng: gói cả giây vào MỘT
    // `act` thì React dồn mọi cập nhật lại thành đúng một lần vẽ và phép đếm
    // luôn ra 1 dù bộ tiết chế có tồn tại hay không. Chia nhỏ ra thì mỗi nhịp
    // được vẽ riêng, nên con số đếm được đúng là "màn hình được cập nhật mấy
    // lần trong một giây".
    for (let elapsed = 0; elapsed < MEASURE_WINDOW_MS; elapsed += SETTLE_STEP_MS) {
      await act(async () => {
        await clock.advance(SETTLE_STEP_MS);
      });
    }

    const percentAfter = uploadPercentText();

    // Phép đo chỉ có nghĩa nếu lượt tải thật sự chạy trong cửa sổ ấy. Không có
    // khẳng định này thì một màn đứng yên cũng "đạt" ngưỡng ≤ 4.
    expect(
      percentAfter,
      `lượt tải phải tiến trong cửa sổ đo, nhưng vẫn ở "${percentBefore}"`,
    ).not.toBe(percentBefore);

    const measured = commits;

    console.log(`[NGHIEM-B] cap-nhat-trong-1-giay=${String(measured)}`);

    expect(
      measured,
      `cập nhật tiến trình phải ≤ ${String(PROGRESS_EMITS_PER_SECOND)} lần mỗi giây, đo được ${String(measured)} lần trong cửa sổ ${String(MEASURE_WINDOW_MS)} ms mô phỏng`,
    ).toBeLessThanOrEqual(PROGRESS_EMITS_PER_SECOND);

    // Cạnh biên: mốc cuối không được bị bộ tiết chế nuốt mất.
    await act(async () => {
      await clock.runAllTimers();
    });

    // Bộ tiết chế bỏ bớt các nhịp giữa chừng, không được bỏ nhịp cuối: đúng
    // thẻ tầng vừa nhận tệp phải kết thúc ở "Đã có bản vẽ".
    const uploadedCard = document.querySelector('[data-floor-id="L2"]');

    expect(uploadedCard, 'thẻ của Tầng 2 phải còn trên trang').not.toBeNull();
    expect(uploadedCard?.textContent).toContain('Đã có bản vẽ');
  });
});

/* -------------------------------------------------------------------------- */
/* Lượt kiểm mạng đầu tiên chưa xong (NO-381).                                 */
/* -------------------------------------------------------------------------- */

describe('FloorUploadScreen — tệp chọn trước lượt kiểm mạng đầu tiên vẫn được tải (NO-381)', () => {
  let clock: FakeClock;

  beforeEach(() => {
    clock = installFakeClock();
  });

  afterEach(() => {
    clock.restore();
  });

  it('bộ giám sát thật chưa ping xong thì màn không coi là mất mạng: tệp tải lên, bộ đếm lên 2 / 4', async () => {
    // Bộ giám sát THẬT, chỉ thay lượt ping bằng một lượt chưa trả lời — đúng
    // khoảnh khắc máy chủ dev còn bận và `HEAD /` chưa về. Trước NO-390 bộ giám
    // sát báo "mất mạng" ở khoảng này; nay nó tin trình duyệt tới lượt ping đầu.
    const gateway = createFloorUploadGateway(createMockApiClient(), {
      networkMonitor: createNetworkMonitor({ ping: () => new Promise<boolean>(() => undefined) }),
    });

    renderWithProviders(<FloorUploadScreenContainer gateway={gateway} projectId={PROJECT_ID} />);

    await act(async () => {
      await clock.advance(SETTLE_STEP_MS);
      await clock.advance(SETTLE_STEP_MS);
    });

    expect(counterStatusText()).toBe('1 / 4 tầng đã có bản vẽ');

    const file = new File(['x'], 'mat-bang-tang-2.png', { type: 'image/png' });

    await act(async () => {
      fireEvent.change(screen.getByTestId(FILE_INPUT_TEST_ID), { target: { files: [file] } });
      await clock.advance(SETTLE_STEP_MS);
    });

    // Một giây mô phỏng, mỗi nhịp một `act`: đủ cho bộ tiết chế 250 ms nhả mốc
    // cuối. Không `runAllTimers` — nhịp ping 20 s của bộ giám sát lặp mãi.
    for (let elapsed = 0; elapsed < MEASURE_WINDOW_MS; elapsed += SETTLE_STEP_MS * 10) {
      await act(async () => {
        await clock.advance(SETTLE_STEP_MS * 10);
      });
    }

    expect(document.querySelector('[data-floor-id="L2"]')?.textContent).toContain('Đã có bản vẽ');
    expect(counterStatusText()).toBe('2 / 4 tầng đã có bản vẽ');
  });

  it('[11F-B-001] gỡ tệp duy nhất của tầng: bộ đếm giảm 1 và lý do chặn "chưa có bản vẽ." trở lại', async () => {
    const gateway = createFloorUploadGateway(createMockApiClient(), {
      networkMonitor: createNetworkMonitor({ ping: () => new Promise<boolean>(() => undefined) }),
    });

    renderWithProviders(<FloorUploadScreenContainer gateway={gateway} projectId={PROJECT_ID} />);

    await act(async () => {
      await clock.advance(SETTLE_STEP_MS);
      await clock.advance(SETTLE_STEP_MS);
    });

    const file = new File(['x'], 'mat-bang-tang-2.png', { type: 'image/png' });

    await act(async () => {
      fireEvent.change(screen.getByTestId(FILE_INPUT_TEST_ID), { target: { files: [file] } });
      await clock.advance(SETTLE_STEP_MS);
    });

    for (let elapsed = 0; elapsed < MEASURE_WINDOW_MS; elapsed += SETTLE_STEP_MS * 10) {
      await act(async () => {
        await clock.advance(SETTLE_STEP_MS * 10);
      });
    }

    expect(counterStatusText()).toBe('2 / 4 tầng đã có bản vẽ');

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Tuỳ chọn của tầng Tầng 2' }));
      await clock.advance(SETTLE_STEP_MS);
    });
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Xoá bản vẽ mat-bang-tang-2.png' }));
      await clock.advance(SETTLE_STEP_MS);
    });

    // UFU:985-1010 blockReasons đọc attachmentByFloor: tầng hết tệp thì bộ đếm giảm 1.
    expect(counterStatusText()).toBe('1 / 4 tầng đã có bản vẽ');
    expect(document.querySelector('[data-floor-id="L2"]')?.textContent).toContain('Chưa có bản vẽ');
  });

  it('tệp chọn lúc ngoại tuyến thật tự tải khi mạng về, bộ đếm lên 2 / 4 (NO-389)', async () => {
    let reachable = false;
    const monitor = createNetworkMonitor({
      navigatorObject: { onLine: true },
      ping: async () => reachable,
    });
    const gateway = createFloorUploadGateway(createMockApiClient(), { networkMonitor: monitor });

    renderWithProviders(<FloorUploadScreenContainer gateway={gateway} projectId={PROJECT_ID} />);

    await act(async () => {
      await clock.advance(SETTLE_STEP_MS);
      await clock.advance(SETTLE_STEP_MS);
    });

    const file = new File(['x'], 'mat-bang-tang-2.png', { type: 'image/png' });

    await act(async () => {
      fireEvent.change(screen.getByTestId(FILE_INPUT_TEST_ID), { target: { files: [file] } });
      await clock.advance(SETTLE_STEP_MS);
    });

    expect(document.querySelector('[data-floor-id="L2"]')?.textContent).toContain('Chờ xử lý');
    expect(counterStatusText()).toBe('1 / 4 tầng đã có bản vẽ');

    reachable = true;

    await act(async () => {
      await monitor.checkNow();
    });

    for (let elapsed = 0; elapsed < MEASURE_WINDOW_MS; elapsed += SETTLE_STEP_MS * 10) {
      await act(async () => {
        await clock.advance(SETTLE_STEP_MS * 10);
      });
    }

    expect(document.querySelector('[data-floor-id="L2"]')?.textContent).toContain('Đã có bản vẽ');
    expect(counterStatusText()).toBe('2 / 4 tầng đã có bản vẽ');
  });
});

/* -------------------------------------------------------------------------- */
/* (f) Bộ đếm chân trang chạy số khi đổi.                                      */
/* -------------------------------------------------------------------------- */

/**
 * Bộ giả riêng cho lượt chạy số.
 *
 * `toFake` mặc định của Vitest **không** giả `performance` và
 * `requestAnimationFrame`, mà `useCountUp` chạy trên đúng hai thứ đó. Để nguyên
 * thì mọi khung hình mang cùng một dấu thời gian đông cứng, con số không nhích
 * bước nào, và bài kiểm "bộ đếm chạy số" sẽ xanh mà không khẳng định gì — đúng
 * thứ E.10 tồn tại để chặn. Đồng hồ giả vẫn neo vào `FAKE_CLOCK_START` để mọi
 * file định dạng cùng một mốc ra cùng một chuỗi.
 */
function installCountUpClock(): void {
  vi.useFakeTimers({
    now: FAKE_CLOCK_START,
    toFake: [
      'setTimeout',
      'clearTimeout',
      'setInterval',
      'clearInterval',
      'Date',
      'performance',
      'requestAnimationFrame',
      'cancelAnimationFrame',
    ],
  });
}

/** Một khung hình của jsdom, và số khung phủ trọn một lượt chạy 260 ms. */
const FRAME_MS = 16;
const RUN_FRAMES = Math.ceil(durationMs('standard') / FRAME_MS) * 2;

/**
 * Nhích đồng hồ đúng `count` khung hình, mỗi khung một lượt vẽ của React.
 *
 * Nhảy một phát cả 260 ms thì mọi khung rơi hết TRƯỚC khi React kịp vẽ, số nằm
 * im, và phép đo mất nghĩa. Mỗi `act` là một vòng sự kiện thật.
 */
async function runFrames(count: number, onFrame?: () => void): Promise<void> {
  for (let frame = 0; frame < count; frame += 1) {
    await act(async () => {
      await vi.advanceTimersByTimeAsync(FRAME_MS);
    });

    onFrame?.();
  }
}

/** Con số nhìn thấy được, tách khỏi vùng sống mà trình đọc màn hình nghe. */
function counterNumberText(): string {
  return screen.getByTestId(COUNTER_NUMBER_TEST_ID).textContent ?? '';
}

/** Chuỗi vùng sống: luôn phải là giá trị CUỐI, không phải khung giữa chừng. */
function counterStatusText(): string {
  // Lọc theo chữ: bộ thông báo toàn cục (`data-announcer`) cũng là `role="status"`
  // và sống qua các bài, nên một câu báo của bài trước không được làm lệch bài này.
  return screen.getByText(/tầng đã có bản vẽ$/u, { selector: '[role="status"]' }).textContent ?? '';
}

/** Bắt `matchMedia` trả lời "có, tôi muốn giảm chuyển động". */
function preferReducedMotion(): void {
  Object.defineProperty(window, 'matchMedia', {
    writable: true,
    value: vi.fn().mockImplementation((query: string) => ({
      matches: query === REDUCED_MOTION_QUERY,
      media: query,
      onchange: null,
      addListener: vi.fn(),
      removeListener: vi.fn(),
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      dispatchEvent: vi.fn(),
    })),
  });
}

describe('FloorUploadGatePanel — bộ đếm "3 / 4" chạy số khi đổi', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it('hiện thẳng lúc vừa vẽ ra, rồi CHẠY khi con số đổi', async () => {
    installCountUpClock();

    const before = scenarioFor('partial');
    const after = scenarioFor('success');

    expect(before.footer.doneCount).not.toBe(after.footer.doneCount);

    const { rerender } = renderWithProviders(<FloorUploadScreenView {...before} />);

    // Lúc HIỆN RA thì không chạy: người đọc chưa từng thấy con số nào khác để
    // mà chạy từ đó, và một lượt quét 0 → 2 lúc mở màn là chuyển động thừa.
    expect(counterNumberText()).toBe(before.footer.counterLabel);

    rerender(<FloorUploadScreenView {...after} />);

    const firstFrame = counterNumberText();

    // Lúc ĐỔI thì chạy: khung ngay sau lượt đổi chưa được là giá trị cuối, nếu
    // không thì con số đã NHẢY và phần còn lại của bài kiểm xanh vô nghĩa.
    expect(firstFrame, 'khung đầu sau lượt đổi không được đã là giá trị cuối').not.toBe(
      after.footer.counterLabel,
    );

    const seen = new Set<string>([firstFrame]);

    await runFrames(RUN_FRAMES, () => {
      seen.add(counterNumberText());
    });

    console.log(
      `[NGHIEM-F] khung-dau="${firstFrame}" so-khung-khac-nhau=${String(seen.size)} khung-cuoi="${counterNumberText()}"`,
    );

    // Chạy, không nhảy: một cú nhảy thẳng chỉ để lại hai chuỗi.
    expect(
      seen.size,
      `bộ đếm phải đi qua ít nhất một bước giữa chừng, chỉ thấy: ${[...seen].join(' | ')}`,
    ).toBeGreaterThan(2);

    expect(counterNumberText()).toBe(after.footer.counterLabel);
  });

  it('trình đọc màn hình nghe giá trị cuối, không nghe khung giữa chừng', async () => {
    installCountUpClock();

    const before = scenarioFor('partial');
    const after = scenarioFor('success');

    const { rerender } = renderWithProviders(<FloorUploadScreenView {...before} />);

    rerender(<FloorUploadScreenView {...after} />);

    // Ngay khung đầu, lúc con số nhìn thấy được vẫn đang ở đầu lượt chạy.
    expect(counterNumberText()).not.toBe(after.footer.counterLabel);
    expect(counterStatusText()).toBe(after.footer.counterLabel);

    await runFrames(RUN_FRAMES, () => {
      expect(counterStatusText()).toBe(after.footer.counterLabel);
    });
  });

  it('người dùng chọn giảm chuyển động thì con số hiện luôn, không chạy', async () => {
    preferReducedMotion();
    installCountUpClock();

    const before = scenarioFor('partial');
    const after = scenarioFor('success');

    const { rerender } = renderWithProviders(<FloorUploadScreenView {...before} />);

    rerender(<FloorUploadScreenView {...after} />);

    expect(counterNumberText()).toBe(after.footer.counterLabel);

    await runFrames(2);

    expect(counterNumberText()).toBe(after.footer.counterLabel);
  });
});

/* -------------------------------------------------------------------------- */
/* QA-03e — SCR-10 view (BUG-525, BUG-526, BUG-527, BUG-533, BUG-536).         */
/* -------------------------------------------------------------------------- */

describe('FloorUploadScreenView — QA-03e', () => {
  /** Khay hai tệp: `tray-1` và một bản sao `tray-2`. */
  function twoItemTray(onRemoveFile = vi.fn()) {
    const base = trayScenario();
    const first = base.tray.items[0];

    if (first === undefined) {
      throw new Error('trayScenario phải có một tệp trong khay');
    }

    const second = { ...first, id: 'tray-2', removeLabel: 'Xoá bản vẽ tep-hai.png' };

    return { ...base, onRemoveFile, tray: { ...base.tray, items: [first, second] } };
  }

  // BUG-525: the trash in the tray removed the row and dropped focus on <body>.
  it('thùng rác ở khay chuyển tiêu điểm sang tệp kế, hết tệp thì về "Chọn tệp" (BUG-525)', () => {
    const scenario = twoItemTray();
    const view = renderWithProviders(<FloorUploadScreenView {...scenario} />);

    fireEvent.click(screen.getByRole('button', { name: 'Xoá bản vẽ ban-ve-khong-ro-tang.dwg' }));
    expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Xoá bản vẽ tep-hai.png' }));
    expect(scenario.onRemoveFile).toHaveBeenCalledWith('tray-1');

    view.unmount();
    renderWithProviders(<FloorUploadScreenView {...trayScenario()} />);
    fireEvent.click(screen.getByRole('button', { name: 'Xoá bản vẽ ban-ve-khong-ro-tang.dwg' }));
    expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Chọn tệp' }));
  });

  // S-08 (Z): chân trang dính đã bỏ — nút và lời chặn nằm trong khung "Điều kiện để xử lý" cạnh danh sách.
  it('nút "Bắt đầu xử lý" và lời chặn nằm trong khung điều kiện, cùng một nguồn với thanh bước', () => {
    const view = renderWithProviders(<FloorUploadScreenView {...trayScenario()} />);
    expect(screen.getByRole('button', { name: 'Bắt đầu xử lý' }).closest(`#${GATE_PANEL_ID}`)).not.toBeNull();
    view.unmount();
    renderWithProviders(<FloorUploadScreenView {...blockedScenario(2)} />);
    const notice = screen.getByTestId(BLOCK_NOTICE_TEST_ID);
    const panel = notice.closest(`#${GATE_PANEL_ID}`);
    expect(panel).not.toBeNull();
    // Chưa đủ điều kiện: nút phụ, bấm được, tiêu đề khung đếm n/3.
    expect(within(panel as HTMLElement).getByRole('heading', { level: 2 })).toHaveTextContent(/^Điều kiện để xử lý · [0-2]\/3$/u);
    expect(screen.getByRole('button', { name: 'Bắt đầu xử lý' })).toBeEnabled();
  });

  // R1-02: a Select option (portal) took focus on mousedown, the page scrolled mid-click and the
  // listbox moved away from the pointer — the floor choice was lost. A mouse focus inside the
  // screen must not jolt the page either.
  it('chọn tầng bằng chuột trong khay không cuộn trang và giữ lựa chọn (R1-02)', () => {
    const onReassign = vi.fn();
    renderWithProviders(<FloorUploadScreenView {...trayScenario()} onReassign={onReassign} />);
    const scrollBy = vi.spyOn(window, 'scrollBy').mockImplementation(() => undefined);
    const trayRow = screen.getByRole('button', { name: 'Xoá bản vẽ ban-ve-khong-ro-tang.dwg' }).closest('li') as HTMLElement;

    vi.spyOn(Element.prototype, 'getBoundingClientRect').mockReturnValue(new DOMRect(0, 720, 32, 32));

    fireEvent.click(within(trayRow).getByRole('combobox', { name: 'Gán cho tầng' }));
    const option = screen.getAllByRole('option')[1] as HTMLElement;

    // The option lives in a portal outside the screen: its focus never scrolls the page.
    act(() => option.focus());
    expect(scrollBy).not.toHaveBeenCalled();

    // Pointer modality: nothing matches :focus-visible, so the focus going back to the trigger
    // after the click does not jolt the page either.
    const matches = Element.prototype.matches;
    vi.spyOn(Element.prototype, 'matches').mockImplementation(function (this: Element, selector: string) {
      return selector === ':focus-visible' ? false : matches.call(this, selector);
    });
    fireEvent.click(option);

    expect(scrollBy).not.toHaveBeenCalled();
    expect(onReassign).toHaveBeenCalledTimes(1);
    expect(onReassign).toHaveBeenCalledWith('tray-1', expect.any(String));
  });

  it('bảng tuỳ chọn đang mở nâng thẻ lên trên chân trang dính (BUG-526)', () => {
    renderWithProviders(<FloorUploadScreenView {...scenarioFor('partial')} />);
    const menuButton = screen.getAllByRole('button', { name: /^Tuỳ chọn của tầng / })[0];

    fireEvent.click(menuButton as HTMLElement);

    expect(menuButton?.closest('li')).toHaveClass('z-30');
  });

  // BUG-527: the card rise ignored prefers-reduced-motion.
  it('thẻ tắt hoạt ảnh trồi lên khi người dùng chọn giảm chuyển động (BUG-527)', () => {
    renderWithProviders(<FloorUploadScreenView {...scenarioFor('partial')} />);

    for (const card of document.querySelectorAll('li[data-floor-id]')) {
      expect(card).toHaveClass('motion-reduce:animate-none');
    }
  });

  // BUG-533: the upload progressbar carried no value.
  it('thanh tiến độ tải lên có aria-valuenow/min/max (BUG-533)', () => {
    renderWithProviders(<FloorUploadScreenView {...scenarioFor('partial')} />);
    const bar = screen.getByRole('progressbar');

    expect(bar).toHaveAttribute('aria-valuenow', '45');
    expect(bar).toHaveAttribute('aria-valuemin', '0');
    expect(bar).toHaveAttribute('aria-valuemax', '100');
  });

  // BUG-536: the viewer's "Bắt đầu xử lý" did nothing.
  it('người xem không thấy nút "Bắt đầu xử lý" (BUG-536)', () => {
    renderWithProviders(<FloorUploadScreenView {...scenarioFor('forbidden')} />);

    expect(screen.queryByRole('button', { name: 'Bắt đầu xử lý' })).toBeNull();
  });
});

describe('FloorUploadScreenView — ảnh nhỏ một tờ nhiều tầng', () => {
  it('tệp có crop: ảnh nhỏ chỉ hiện vùng đã khoanh', () => {
    const base = scenarioFor('success');
    const crop = { xRatio: 0.5, yRatio: 0.06, widthRatio: 0.48, heightRatio: 0.49 };
    const floors = base.floors.map((row, index) =>
      index === 0 && row.file !== null
        ? { ...row, file: { ...row.file, previewUrl: 'blob:to-mat-bang', crop } }
        : row,
    );
    renderWithProviders(<FloorUploadScreenView {...base} floors={floors} />);

    const thumbs = screen.getAllByTestId('floor-upload-crop-thumb');
    expect(thumbs).toHaveLength(1);
    const image = thumbs[0]?.querySelector('img');
    const percent = (value: string | undefined): number => Number.parseFloat(value ?? '');
    expect(image?.getAttribute('src')).toBe('blob:to-mat-bang');
    expect(percent(image?.style.width)).toBeCloseTo(100 / 0.48, 3);
    expect(percent(image?.style.height)).toBeCloseTo(100 / 0.49, 3);
    expect(percent(image?.style.left)).toBeCloseTo((-0.5 / 0.48) * 100, 3);
    expect(percent(image?.style.top)).toBeCloseTo((-0.06 / 0.49) * 100, 3);
  });
});
