/**
 * Bài kiểm của màn Sơ đồ xử lý.
 *
 * Bốn nhóm, đúng thứ tự Phần 5 của `LUAT_MAN_HINH.md`:
 *
 * 1. **Bảy trạng thái (R-63)** — `expectSevenStates` trên chính bộ kịch bản của
 *    story, không dựng bộ thứ hai (R-70).
 * 2. **Tiếp cận, tiếng Việt, màu (R-72, A1)**.
 * 3. **Mục [CẤM TUYỆT ĐỐI]** — chế độ Tổng quan không được lộ tên thư viện kỹ
 *    thuật, và gói của màn không được kéo theo thư viện vẽ đồ thị nào.
 * 4. **Nghiệm thu** — vai Kỹ sư không thấy chế độ chi tiết; cảnh báo chạy lại nêu
 *    ĐÚNG số tường đã duyệt.
 *
 * Nhóm 4 dựng cả container: nó là chỗ duy nhất kiểm được rằng hook đọc số đã
 * duyệt từ `src/store` qua P-03 chứ không từ một hằng số viết sẵn.
 */

import { readdirSync } from 'node:fs';

import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, screen, waitFor, within } from '@testing-library/react';

import { createMockApiClient, MOCK_MISSING_PROJECT_ID } from '@/api/__mocks__/client';
import { normalizeSpatial } from '@/domain/spatial/normalize';
import { expectAccessible } from '@/lib/testing/expectAccessible';
import { expectNoRawColor } from '@/lib/testing/expectNoRawColor';
import { expectSevenStates } from '@/lib/testing/expectSevenStates';
import { expectVietnamese } from '@/lib/testing/expectVietnamese';
import { getPipelineStages } from '@/lib/realtime/pipeline';
import { createCleanBuildingScenario } from '@/lib/testing/fixtures';
import { renderWithProviders } from '@/lib/testing/render';
import {
  SEVEN_STATES,
  SEVEN_STATE_LABELS,
  type SevenStateScenario,
} from '@/lib/testing/sevenStateScenarios';
import { createProcessingGateway } from '@/screens/pipeline/ProcessingScreen/processingGateway';
import { useStore } from '@/store';

import { PipelineGraph } from './PipelineGraph';
import { PipelineGraphContainer } from './PipelineGraph.container';
import {
  APPROVED_WALL_COUNT,
  detailScenario,
  failedBranchScenario,
  rerunWarningScenario,
  scenarioFor,
} from './PipelineGraph.stories';
import { createMockPipelineGraphGateway, createPipelineGraphGateway } from './pipelineGraphGateway';
import { PIPELINE_GRAPH_TEXT, PIPELINE_NODE_TEXT } from './pipelineGraphText';

const SCREEN_DIRECTORY = 'src/screens/pipeline/PipelineGraph';

/**
 * jsdom không có `matchMedia`; `matches: false` là khung rộng.
 *
 * Cùng bộ giả `ProcessingScreen.test.tsx:167` dùng. Hook có nhánh phòng thân khi
 * `matchMedia` vắng mặt, nhưng bộ giả này là cách kiểm ĐƯỜNG THẬT — nhánh phòng
 * thân không được là đường duy nhất test đi qua.
 */
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

/**
 * Từ khoá máy đọc được phép đứng nguyên văn.
 *
 * Ba nhóm: tên định dạng tệp và đơn vị máy (`png`, `dpi`), tên viết tắt của
 * ngành (`CAD`), và mã lỗi kỹ thuật. Tên thư viện kỹ thuật KHÔNG có trong danh
 * sách này — chúng nằm trong `<code>`, thẻ mà `expectVietnamese` bỏ qua sẵn.
 */
const ALLOWED_WORDS = ['CAD', 'png', 'dpi', 'Gauss', 'Canny'];

const MACHINE_ERROR_CODE = /^[A-Z_]+$/;

/** Chỉ để thoả kiểu; props thật đến từ `scenarioFor` của story. */
function scenarioIndex(): readonly SevenStateScenario[] {
  return SEVEN_STATES.map((state) => ({
    state,
    label: SEVEN_STATE_LABELS[state],
    rows: [],
    totalCount: scenarioFor(state).model.overview.comparisonRows.length,
    isLoading: state === 'loading',
    isCollapsed: state === 'collapsed',
    canView: state !== 'forbidden',
    error: null,
  }));
}

describe('PipelineGraph — bảy trạng thái (A11, R-63)', () => {
  it('vẽ đủ bảy trạng thái, không lần nào ném lỗi và không lần nào ra màn trắng', () => {
    let rendered = 0;

    expectSevenStates((scenario) => {
      const { container, unmount } = renderWithProviders(
        <PipelineGraph {...scenarioFor(scenario.state)} />,
      );
      rendered += 1;
      return { container, unmount };
    }, scenarioIndex());

    expect(rendered).toBe(SEVEN_STATES.length);
    expect(rendered).toBe(7);
  });

  it('trạng thái không có quyền giấu hẳn khối gấp và nút đổi nhánh, kèm một câu giải thích', () => {
    renderWithProviders(<PipelineGraph {...scenarioFor('forbidden')} />);

    expect(screen.getByText(PIPELINE_GRAPH_TEXT.forbiddenLine)).toBeTruthy();
    expect(screen.queryByText(PIPELINE_GRAPH_TEXT.detailDisclosureLabel)).toBeNull();
    expect(screen.queryByText(PIPELINE_GRAPH_TEXT.switchLabel)).toBeNull();
  });

  it('trạng thái thu gọn xếp sơ đồ thành danh sách dọc', () => {
    renderWithProviders(<PipelineGraph {...scenarioFor('collapsed')} />);

    expect(screen.getByRole('list', { name: PIPELINE_GRAPH_TEXT.title }).tagName).toBe('OL');
  });
});

describe('PipelineGraph — breadcrumb (BUG-546, BUG-558)', () => {
  it('cấp "Dự án" là nút về danh sách; nav tên "Đường dẫn trang", không trùng tên nhóm sơ đồ', () => {
    const scenario = scenarioFor('success');
    const onBackToProjects = vi.fn();
    renderWithProviders(
      <PipelineGraph actions={{ ...scenario.actions, onBackToProjects }} model={scenario.model} />,
    );

    const nav = screen.getByRole('navigation', { name: 'Đường dẫn trang' });
    expect(screen.queryByRole('navigation', { name: PIPELINE_GRAPH_TEXT.title })).toBeNull();
    fireEvent.click(within(nav).getByRole('link', { name: 'Dự án' }));
    expect(onBackToProjects).toHaveBeenCalledTimes(1);
  });
});

describe('PipelineGraph — khả năng tiếp cận, tiếng Việt, màu (R-72, A1)', () => {
  it('đi qua expectAccessible ở trạng thái đầy đủ nhất', () => {
    const { container } = renderWithProviders(<PipelineGraph {...scenarioFor('success')} />);

    expectAccessible(container);
  });

  it('đi qua expectAccessible khi chế độ chi tiết đã mở', () => {
    const { container } = renderWithProviders(<PipelineGraph {...detailScenario()} />);

    expectAccessible(container);
  });

  it('mọi chuỗi hiển thị của chế độ Tổng quan là tiếng Việt có dấu', () => {
    const { container } = renderWithProviders(<PipelineGraph {...scenarioFor('success')} />);

    expectVietnamese(container, { allowWords: ALLOWED_WORDS, ignore: [MACHINE_ERROR_CODE] });
  });

  it('mọi chuỗi hiển thị của chế độ Chi tiết kỹ thuật là tiếng Việt có dấu', () => {
    const { container } = renderWithProviders(<PipelineGraph {...detailScenario()} />);

    expectVietnamese(container, { allowWords: ALLOWED_WORDS, ignore: [MACHINE_ERROR_CODE] });
  });

  it('mọi chuỗi hiển thị của trạng thái lỗi cũng là tiếng Việt có dấu', () => {
    const { container } = renderWithProviders(<PipelineGraph {...scenarioFor('error')} />);

    expectVietnamese(container, { allowWords: ALLOWED_WORDS, ignore: [MACHINE_ERROR_CODE] });
  });

  it('không mã màu thô trong bất kỳ file nào của thư mục màn (A1)', () => {
    for (const file of readdirSync(SCREEN_DIRECTORY)) {
      expectNoRawColor(`${SCREEN_DIRECTORY}/${file}`);
    }
  });
});

describe('PipelineGraph — mục [CẤM TUYỆT ĐỐI]', () => {
  it('chế độ Tổng quan không hiện một tên thư viện kỹ thuật nào', () => {
    const { container } = renderWithProviders(<PipelineGraph {...scenarioFor('success')} />);

    for (const libraryName of ['SegFormer', 'YOLOv8', 'PaddleOCR', 'Zhang-Suen', 'Douglas-Peucker']) {
      expect(container.textContent).not.toContain(libraryName);
    }
  });

  it('chế độ Chi tiết kỹ thuật thì có, và đặt chúng trong thẻ chữ đều', () => {
    const { container } = renderWithProviders(<PipelineGraph {...detailScenario()} />);

    const codeText = Array.from(container.querySelectorAll('code'))
      .map((element) => element.textContent ?? '')
      .join(' ');

    for (const libraryName of ['SegFormer MIT-B5', 'YOLOv8m', 'PaddleOCR']) {
      expect(codeText).toContain(libraryName);
    }
  });

  it('công thức trích xuất độ dày hiện nguyên văn, bằng chữ đều', () => {
    const { container } = renderWithProviders(<PipelineGraph {...detailScenario()} />);

    const codeText = Array.from(container.querySelectorAll('code'))
      .map((element) => element.textContent ?? '')
      .join(' ');

    expect(codeText).toContain('W_pixel = 2 × Distance_max');
  });

  it('nhánh đang dùng có badge, nhánh không dùng chỉ mờ đi chứ không đổi màu', () => {
    const { model } = scenarioFor('success');
    const active = model.overview.branches.find((branch) => branch.isActive);
    const inactive = model.overview.branches.find((branch) => !branch.isActive);

    expect(active?.activeBadgeLabel).toBe(PIPELINE_GRAPH_TEXT.activeBadge);
    expect(inactive?.activeBadgeLabel).toBeUndefined();

    renderWithProviders(<PipelineGraph {...scenarioFor('success')} />);

    expect(screen.getAllByText(PIPELINE_GRAPH_TEXT.activeBadge).length).toBe(1);
  });

  it('một nhánh lỗi thì nhánh còn lại vẫn vẽ nét thường', () => {
    const { model } = failedBranchScenario();
    const failed = model.overview.branches.filter((branch) => branch.hasFailed);

    expect(failed.map((branch) => branch.id)).toEqual(['ai']);
  });
});

/** Cổng thật nhưng không có lượt xử lý nào: jsdom không có EventSource để mở dòng tiến độ. */
const noRunGateway = () => ({
  ...createPipelineGraphGateway(createProcessingGateway(createMockApiClient())),
  readLatestRun: () => Promise.resolve(null),
});

describe('PipelineGraph — nghiệm thu', () => {
  it('chưa có báo cáo nhánh thì không nói "mỗi tầng một nhánh" (B-V5-03)', async () => {
    // Cổng THẬT của route: `branchReport` không được hỗ trợ ⇒ không có báo cáo nào.
    renderWithProviders(
      <PipelineGraphContainer
        gateway={noRunGateway()}
        projectId="project-1"
        roles={['admin']}
      />,
    );

    expect(await screen.findByText(PIPELINE_GRAPH_TEXT.reasonNoReport)).toBeTruthy();
    expect(screen.queryByText(PIPELINE_GRAPH_TEXT.reasonUnknown)).toBeNull();
  });

  it('trạng thái rỗng (cổng thật): PageHead nói việc + chip "Chưa xử lý" + câu lý do, khối việc tiếp trong khung', async () => {
    renderWithProviders(
      <PipelineGraphContainer gateway={noRunGateway()} projectId="project-1" roles={['admin']} />,
    );

    expect(await screen.findByRole('heading', { level: 1, name: PIPELINE_GRAPH_TEXT.heading })).toBeTruthy();
    expect(screen.getByText(PIPELINE_GRAPH_TEXT.chipNotRun)).toBeTruthy();
    expect(screen.getAllByText(PIPELINE_GRAPH_TEXT.reasonNoReport)).toHaveLength(1);
    expect(screen.getByRole('heading', { level: 2, name: PIPELINE_GRAPH_TEXT.emptyTitle })).toBeTruthy();
    expect(screen.getByRole('heading', { level: 2, name: PIPELINE_GRAPH_TEXT.diagramSectionTitle })).toBeTruthy();
  });

  // BUG-313: an unknown project drew the normal empty diagram, with no error and no way back.
  it('an unknown project says "Không tìm thấy dự án này" with a way back to the list, not an empty diagram (BUG-313)', async () => {
    const onBackToProjects = vi.fn();
    renderWithProviders(
      <PipelineGraphContainer
        gateway={noRunGateway()}
        onBackToProjects={onBackToProjects}
        projectId={MOCK_MISSING_PROJECT_ID}
        roles={['admin']}
      />,
    );

    expect(await screen.findByText('Không tìm thấy dự án này')).toBeTruthy();
    expect(screen.queryByText(PIPELINE_GRAPH_TEXT.emptyTitle)).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Về danh sách dự án' }));
    expect(onBackToProjects).toHaveBeenCalledTimes(1);
  });

  it('#24 còn đang đọc thì là skeleton, không thoáng hiện câu rỗng trước dải không tìm thấy (BUG-556)', async () => {
    const gateway = {
      ...noRunGateway(),
      readProjectExists: () => new Promise<boolean>(() => undefined),
    };
    const { container } = renderWithProviders(
      <PipelineGraphContainer gateway={gateway} projectId="project-1" roles={['admin']} />,
    );

    // Hai lượt đọc kia đã xong; chỉ #24 còn treo.
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(screen.queryByText(PIPELINE_GRAPH_TEXT.emptyTitle)).toBeNull();
    expect(container.querySelector('.animate-pulse')).not.toBeNull();
  });

  it('#24 trả 5xx thì báo lỗi đọc kèm "Thử lại", không coi như dự án tồn tại (BUG-557)', async () => {
    const base = createMockApiClient();
    const failing = vi.fn(() =>
      Promise.resolve({
        ok: false as const,
        error: { code: 'INTERNAL', kind: 'http' as const, raw: { code: 'INTERNAL' }, requestId: 'r', retryable: true, status: 500 },
      }),
    );
    const client = { ...base, projects: { ...base.projects, read: failing } };
    const gateway = {
      ...createPipelineGraphGateway(createProcessingGateway(client)),
      readLatestRun: () => Promise.resolve(null),
    };

    await expect(gateway.readProjectExists({ projectId: 'project-1' })).rejects.toBeTruthy();

    renderWithProviders(<PipelineGraphContainer gateway={gateway} projectId="project-1" roles={['admin']} />);

    const retry = await screen.findByRole('button', { name: PIPELINE_GRAPH_TEXT.retryLabel });
    expect(screen.queryByText(PIPELINE_GRAPH_TEXT.emptyTitle)).toBeNull();
    const callsBefore = failing.mock.calls.length;
    fireEvent.click(retry);
    await waitFor(() => {
      expect(failing.mock.calls.length).toBeGreaterThan(callsBefore);
    });
  });

  // Expectation changed per questions.md Q1 (QA-09, 2026-10-16): engineer MAY open detail mode; viewer stays blocked.
  it('vai Xem không thấy chế độ chi tiết kỹ thuật', async () => {
    renderWithProviders(
      <PipelineGraphContainer
        gateway={createMockPipelineGraphGateway()}
        projectId="project-1"
        roles={['viewer']}
      />,
    );

    expect(
      await screen.findByText(PIPELINE_GRAPH_TEXT.forbiddenLine),
    ).toBeTruthy();
    expect(screen.queryByText(PIPELINE_GRAPH_TEXT.detailDisclosureLabel)).toBeNull();
    expect(screen.queryByText(PIPELINE_GRAPH_TEXT.switchLabel)).toBeNull();
  });

  // F9U-3 (questions.md Q1): engineer opens detail mode.
  it('[F9U-3] vai Kỹ sư thấy khối gấp chi tiết, không bị chặn', async () => {
    renderWithProviders(
      <PipelineGraphContainer
        gateway={createMockPipelineGraphGateway()}
        projectId="project-1"
        roles={['engineer']}
      />,
    );

    expect(
      await screen.findByRole('button', { name: PIPELINE_GRAPH_TEXT.detailDisclosureLabel }),
    ).toBeTruthy();
    expect(screen.queryByText(PIPELINE_GRAPH_TEXT.forbiddenLine)).toBeNull();
  });

  it('có lượt xử lý mà cổng chưa báo nhánh: tô nhánh ảnh quét, không nói "chưa báo nhánh"', async () => {
    renderWithProviders(
      <PipelineGraphContainer
        gateway={{
          ...createMockPipelineGraphGateway({ supports: { branchReport: false } }),
          readLatestRun: () => Promise.resolve({ floorId: 'floor-1', uploadId: 'upload-1' }),
        }}
        projectId="project-1"
        roles={['admin']}
      />,
    );

    expect(await screen.findByText(PIPELINE_GRAPH_TEXT.reasonInferredFromRun)).toBeTruthy();
  });

  // F9U-4 (questions.md Q4): empty wins over forbidden.
  it('[F9U-4] chưa có lượt xử lý thì nói rỗng, kể cả khi vai không có quyền chi tiết', async () => {
    renderWithProviders(
      <PipelineGraphContainer
        gateway={createMockPipelineGraphGateway({
          supports: { branchReport: false, stageBreakdown: false },
        })}
        projectId="project-1"
        roles={['viewer']}
      />,
    );

    expect(await screen.findByText(PIPELINE_GRAPH_TEXT.emptyTitle)).toBeTruthy();
  });

  it('vai Quản trị thấy khối gấp, và mở được nó', async () => {
    renderWithProviders(
      <PipelineGraphContainer
        gateway={createMockPipelineGraphGateway()}
        projectId="project-1"
        roles={['admin']}
      />,
    );

    const disclosure = await screen.findByRole('button', {
      name: PIPELINE_GRAPH_TEXT.detailDisclosureLabel,
    });

    expect(disclosure.getAttribute('aria-expanded')).toBe('false');

    fireEvent.click(disclosure);

    expect(disclosure.getAttribute('aria-expanded')).toBe('true');
  });

  it('rerunFromNode tắt thì không có nút "Chạy lại từ bước này" (FIX-P0-13)', async () => {
    renderWithProviders(
      <PipelineGraphContainer
        gateway={createMockPipelineGraphGateway({ supports: { rerunFromNode: false } })}
        projectId="project-1"
        roles={['admin']}
      />,
    );

    fireEvent.click(
      await screen.findByRole('button', { name: PIPELINE_GRAPH_TEXT.detailDisclosureLabel }),
    );

    expect(await screen.findByText(PIPELINE_GRAPH_TEXT.panelOutputHeader)).toBeTruthy();
    expect(screen.queryByRole('button', { name: PIPELINE_GRAPH_TEXT.rerunLabel })).toBeNull();
  });

  it(`cảnh báo chạy lại nêu đúng ${String(APPROVED_WALL_COUNT)} tường đã duyệt`, async () => {
    const scenario = createCleanBuildingScenario();
    const walls = scenario.graph.walls.map((wall, index) => ({
      ...wall,
      reviewed: index < APPROVED_WALL_COUNT,
    }));

    // `setSpatial` là hành động của chính slice, không phải `setState()` trần —
    // `local/no-direct-set` (A10) chặn lối thứ hai, kể cả trong test.
    useStore.getState().setSpatial(normalizeSpatial({ ...scenario.graph, walls }), 'version-1');

    renderWithProviders(
      <PipelineGraphContainer
        gateway={createMockPipelineGraphGateway()}
        projectId="project-1"
        roles={['admin']}
      />,
      { keepStore: true },
    );

    fireEvent.click(
      await screen.findByRole('button', { name: PIPELINE_GRAPH_TEXT.detailDisclosureLabel }),
    );

    fireEvent.click(
      await screen.findByRole('button', { name: PIPELINE_GRAPH_TEXT.rerunLabel }),
    );

    await waitFor(() => {
      expect(screen.getByText(PIPELINE_GRAPH_TEXT.rerunWarningTitle)).toBeTruthy();
    });

    const warning = screen.getByText(/tường đã duyệt/);

    expect(warning.textContent).toContain(String(APPROVED_WALL_COUNT));
  });

  it('cảnh báo chạy lại có sẵn lựa chọn giữ lại phần đã duyệt', () => {
    renderWithProviders(<PipelineGraph {...rerunWarningScenario()} />);

    expect(screen.getByLabelText(PIPELINE_GRAPH_TEXT.keepApprovedLabel)).toBeTruthy();
  });

  it('xác nhận chạy lại thì các nút phía sau mờ xuống cho tới khi chúng xong', async () => {
    renderWithProviders(
      <PipelineGraphContainer
        gateway={createMockPipelineGraphGateway()}
        projectId="project-1"
        roles={['admin']}
      />,
    );

    fireEvent.click(
      await screen.findByRole('button', { name: PIPELINE_GRAPH_TEXT.detailDisclosureLabel }),
    );

    const downstream = await screen.findByRole('button', {
      name: new RegExp(PIPELINE_NODE_TEXT.wallSegmentation.name),
    });

    expect(downstream.style.opacity).toBe('');

    fireEvent.click(screen.getByRole('button', { name: PIPELINE_GRAPH_TEXT.rerunLabel }));
    fireEvent.click(screen.getByRole('button', { name: PIPELINE_GRAPH_TEXT.rerunConfirmLabel }));

    await waitFor(() => {
      expect(downstream.style.opacity).not.toBe('');
    });
  });

  it('dưới 1024 thì sơ đồ tự xếp dọc, không cần ai truyền forceCollapsed', async () => {
    Object.defineProperty(window, 'matchMedia', {
      writable: true,
      value: vi.fn().mockImplementation((query: string) => ({
        matches: query === '(width < 1024px)',
        media: query,
        onchange: null,
        addListener: vi.fn(),
        removeListener: vi.fn(),
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
        dispatchEvent: vi.fn(),
      })),
    });

    renderWithProviders(
      <PipelineGraphContainer
        gateway={createMockPipelineGraphGateway()}
        projectId="project-1"
        roles={['admin']}
      />,
    );

    const list = await screen.findByRole('list', { name: PIPELINE_GRAPH_TEXT.title });

    expect(list.tagName).toBe('OL');
  });

  it('không một thư viện vẽ đồ thị nào trong phụ thuộc của gói', async () => {
    const packageJson = (await import('../../../../package.json')) as unknown as {
      readonly default: {
        readonly dependencies?: Readonly<Record<string, string>>;
        readonly devDependencies?: Readonly<Record<string, string>>;
      };
    };

    const names = Object.keys({
      ...packageJson.default.dependencies,
      ...packageJson.default.devDependencies,
    });

    for (const forbidden of ['d3', 'reactflow', 'cytoscape', 'vis-network', 'dagre', 'elkjs']) {
      expect(names).not.toContain(forbidden);
    }
  });
});

describe('PipelineGraph — giả định C3 dùng chung với màn Xử lý (NO-364)', () => {
  it('lượt còn pending có step thật thì không bước nào hiện xong hay đang chạy', async () => {
    const base = createMockApiClient();
    const client = {
      ...base,
      drawings: {
        ...base.drawings,
        progress: () =>
          Promise.resolve({
            ok: true as const,
            data: { id: 'upload-1', progressPercent: 0, status: 'pending' as const, step: getPipelineStages()[2]!.id },
          }),
      },
    };
    const gateway = {
      ...createPipelineGraphGateway(createProcessingGateway(client)),
      readLatestRun: () => Promise.resolve(null),
    };

    const run = await gateway.readRunOnce({ projectId: 'project-1', uploadId: 'upload-1' });

    expect(run.supported && run.value.length).toBe(getPipelineStages().length);
    expect(run.supported ? run.value.map((stage) => stage.status) : []).not.toContain('running');
    expect(run.supported ? run.value.map((stage) => stage.status) : []).not.toContain('done');
  });
});

describe('PipelineGraph — lượt mới nhất (RV2#4)', () => {
  it('lấy lượt đầu N7b (mới nhất trước), không phải tầng cuối N7', async () => {
    const run = (floorId: string) => ({ floorId, uploadId: `u-${floorId}` });
    const processing = {
      ...createProcessingGateway(createMockApiClient()),
      readLatestUploads: () => Promise.resolve({ ok: true as const, data: [run('f1'), run('f3')] as never }),
      readPipelineRuns: () =>
        Promise.resolve({ ok: true as const, data: { items: [run('f1'), run('f3')] } as never }),
    };

    await expect(createPipelineGraphGateway(processing).readLatestRun?.({ projectId: 'p' })).resolves.toEqual(run('f1'));
  });
});
