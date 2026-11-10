/**
 * Bộ kiểm của W3 cho màn `RuleReport` (S-33) — `ROUTE_PATTERNS.projectRules`.
 *
 * ## Vì sao nhiều import ở đây đi qua `import()` thay vì `import … from …`
 *
 * `./types`, `./RuleReport`, `./useRuleReport`, `./RuleReport.container` là việc
 * của ba worker khác (W1/W2/W4) và tại thời điểm viết file này CHƯA tồn tại
 * trong worktree của W3 — mỗi worker lớp 2 dựng trên nhánh riêng của mình rồi
 * lớp gộp mới ghép lại. Đã đo thật: một `import` TĨNH của một chuỗi không tồn
 * tại làm Vite sập lúc transform, và KHÔNG MỘT test nào trong cả file chạy được
 * — kể cả những test không đụng gì tới ba file đó (`Failed to resolve import
 * "./RuleReport" … Test Files 1 failed, Tests no tests`). Kể cả `import()` với
 * CHUỖI TĨNH cũng bị chặn y hệt, vì plugin phân tích import của Vite phân giải
 * cả `import()` động có chuỗi hằng ngay lúc transform.
 *
 * Cách duy nhất hoãn việc phân giải sang đúng lúc CHẠY (để một import hỏng chỉ
 * làm hỏng ĐÚNG một `it`, không kéo sập cả file) là giấu chuỗi đường dẫn sau một
 * biến, kèm `/* @vite-ignore *\/` — xem {@link importFromScreen}. Nhờ vậy các
 * test không phụ thuộc ba file kia (khẳng định số liệu thẳng từ `runRules`, quét
 * mã nguồn tìm tên luật viết cứng…) chạy và XANH ngay hôm nay; các test cần view
 * thật thì HỎNG RIÊNG LẺ với thông báo "Failed to resolve" — đúng nhóm (a) mà
 * nhiệm vụ yêu cầu tách ra, và không cần sửa gì ở đây khi lớp gộp đã có đủ ba
 * file: `import()` khi đó phân giải thật, không phải giả.
 *
 * `import type` (xoá hẳn lúc biên dịch, không để lại `import` nào lúc chạy) thì
 * an toàn dùng thẳng, kể cả trỏ vào `./types` chưa tồn tại — đã đo thật, không
 * làm sập file.
 */

import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

import { act, cleanup, fireEvent, render, renderHook, screen, waitFor, within } from '@testing-library/react';
import { QueryClientProvider } from '@tanstack/react-query';
import type { ComponentType, ReactNode } from 'react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';

import type * as AppClientModule from '@/api/appClient';
import { createMockApiClient } from '@/api/__mocks__/client';
import type { ApiClient } from '@/api/client';
import type { ProjectRuleConfig } from '@/api/schemas/ruleConfig';

import { setFlowGateSlot } from '@/components/shell/flowGateStore';
import { ALL_RULES, createDefaultRuleRegistry } from '@/domain/rules/defaults';
import { sortBySeverity } from '@/domain/rules/healthScore';
import { RULE_SEVERITY_LABELS } from '@/domain/rules/registry';
import type { Rule, RuleCode, Violation } from '@/domain/rules/registry';
import { runRules } from '@/domain/rules/runner';
import { displayCodeIn, isEntityOfKind, normalizeSpatial } from '@/domain/spatial/normalize';
import type { NormalizedSpatial } from '@/domain/spatial/normalize';
import type { LevelId } from '@/domain/spatial/types';
import { createSampleBuilding } from '@/domain/spatial/__fixtures__/sampleBuilding';
import type { HttpError } from '@/lib/http';
import { expectAccessible } from '@/lib/testing/expectAccessible';
import { expectNoRawColor } from '@/lib/testing/expectNoRawColor';
import { expectSevenStates } from '@/lib/testing/expectSevenStates';
import { expectVietnamese } from '@/lib/testing/expectVietnamese';
import {
  CLEAN_BUILDING_SCENARIO,
  EMPTY_PROJECT_SCENARIO,
  VIOLATED_BUILDING_SCENARIO,
} from '@/lib/testing/fixtures';
import { createTestQueryClient, renderWithProviders } from '@/lib/testing/render';
import {
  SEVEN_STATES,
  createSevenStateScenarios,
  type SevenStateScenario,
} from '@/lib/testing/sevenStateScenarios';
import { ROUTES } from '@/routes/paths';
import { createRuleSettingsGateway, ruleSettingsQueryKey } from '@/screens/rules/RuleSettings';
import { useStore } from '@/store';

import type {
  PassedRule,
  RuleReportCapabilities,
  RuleReportFilters,
  RuleReportGroup,
  RuleReportRow,
  RuleReportSummary,
  RuleReportViewProps,
  SkippedRuleGroup,
} from './types';
import * as RuleReportModule from './RuleReport';
import * as RuleReportContainerModule from './RuleReport.container';
import { useRuleReport } from './useRuleReport';

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
  './RuleReport': RuleReportModule,
  './RuleReport.container': RuleReportContainerModule,
};

async function importFromScreen<T>(specifier: string): Promise<T> {
  return MODULE_MAN[specifier] as T;
}

async function loadRuleReportView(): Promise<ComponentType<RuleReportViewProps>> {
  const mod = await importFromScreen<{ RuleReport: ComponentType<RuleReportViewProps> }>(
    './RuleReport',
  );

  return mod.RuleReport;
}

interface RuleReportContainerLikeProps {
  readonly projectId?: string;
}

async function loadRuleReportContainer(): Promise<ComponentType<RuleReportContainerLikeProps>> {
  const mod = await importFromScreen<{
    RuleReportContainer: ComponentType<RuleReportContainerLikeProps>;
  }>('./RuleReport.container');

  return mod.RuleReportContainer;
}

/** Bọc `MemoryRouter` — mối nối `onViewRow`/hook dùng `useNavigate()` (mục 0-BIS.9). */
function renderRuleReport(
  RuleReportView: ComponentType<RuleReportViewProps>,
  props: RuleReportViewProps,
) {
  return render(
    <MemoryRouter>
      <RuleReportView {...props} />
    </MemoryRouter>,
  );
}

/* ==========================================================================
 * A. Số đo THẬT của bộ máy luật — không đụng tới file của worker khác,
 *    nên đây là phần PHẢI XANH ngay bây giờ (tiêu chí nghiệm thu D-13).
 * ========================================================================== */

const REGISTRY = createDefaultRuleRegistry();
const ENABLED_RULES = REGISTRY.listEnabled();

const NORMALIZED_VIOLATED = normalizeSpatial(VIOLATED_BUILDING_SCENARIO.graph);
const VIOLATED_RESULT = runRules(NORMALIZED_VIOLATED, { registry: REGISTRY });

const NORMALIZED_CLEAN = normalizeSpatial(CLEAN_BUILDING_SCENARIO.graph);
const CLEAN_RESULT = runRules(NORMALIZED_CLEAN, { registry: REGISTRY });

const NORMALIZED_EMPTY = normalizeSpatial(EMPTY_PROJECT_SCENARIO.graph);
const EMPTY_RESULT = runRules(NORMALIZED_EMPTY, { registry: REGISTRY });

describe('D-13 — số vi phạm THẬT từ runRules, không phải mảng viết tay của fixture', () => {
  it('ALL_RULES đăng ký 25 luật; createDefaultRuleRegistry() bật 23 (2 luật bị nhóm function thay thế)', () => {
    console.log(
      `[W3] ALL_RULES.length = ${String(ALL_RULES.length)} · số luật BẬT = ${String(ENABLED_RULES.length)}`,
    );

    expect(ALL_RULES.length).toBe(25);
    expect(ENABLED_RULES.length).toBe(23);
  });

  it('runRules trên VIOLATED_BUILDING_SCENARIO = 185, KHÁC mảng .violations viết tay (7) — sự thật phải ghi lại', () => {
    const runRulesCount = VIOLATED_RESULT.violations.length;
    const fixtureArrayCount = VIOLATED_BUILDING_SCENARIO.violations.length;

    console.log(
      `[W3] runRules(VIOLATED) = ${String(runRulesCount)} vi phạm · ` +
        `VIOLATED_BUILDING_SCENARIO.violations (viết tay) = ${String(fixtureArrayCount)}`,
    );

    // Con số THẬT của bộ máy luật — đây là nguồn màn RuleReport phải đọc.
    expect(runRulesCount).toBe(185);

    // Mảng viết tay trong fixture chỉ mô phỏng DUY NHẤT khiếm khuyết cố ý (7
    // tường bị làm mỏng) mà `createViolatedBuildingScenario()` thêm vào để chốt
    // health score = 44 cho test của `healthScore.ts`; nó không phải đầu ra của
    // `runRules` và KHÔNG BAO GIỜ được dùng làm nguồn hiển thị cho màn này —
    // bản thân bộ mẫu chuẩn (`createSampleBuilding()`) vốn đã tự vi phạm 182
    // luật khi chạy thật (xem test "CLEAN" bên dưới).
    expect(fixtureArrayCount).toBe(7);

    // Khẳng định tường minh: hai con số LỆCH nhau, và đó là chủ ý — nếu một
    // ngày nào đó chúng bằng nhau thì hoặc fixture đã đổi (cần cập nhật lại
    // 189/7 ở đây), hoặc RuleReport đang đọc nhầm `scenario.violations` thay vì
    // tự chạy bộ máy luật.
    expect(runRulesCount).not.toBe(fixtureArrayCount);
  });

  it('runRules trên CLEAN_BUILDING_SCENARIO = 178 (KHÔNG phải 0 — bộ mẫu chuẩn không "sạch")', () => {
    console.log(`[W3] runRules(CLEAN) = ${String(CLEAN_RESULT.violations.length)}`);

    expect(CLEAN_RESULT.violations.length).toBe(178);
  });

  it('runRules trên EMPTY_PROJECT_SCENARIO = 0', () => {
    console.log(`[W3] runRules(EMPTY) = ${String(EMPTY_RESULT.violations.length)}`);

    expect(EMPTY_RESULT.violations.length).toBe(0);
  });
});

describe('grep — không file sản phẩm nào trong thư mục màn viết cứng tên luật', () => {
  it('mọi tên luật hiển thị phải đến từ rule.name, không phải chuỗi chép tay', () => {
    const dir = 'src/screens/rules/RuleReport';
    const productionFiles = readdirSync(dir).filter(
      (name) =>
        (name.endsWith('.ts') || name.endsWith('.tsx')) &&
        !name.endsWith('.test.tsx') &&
        !name.endsWith('.stories.tsx'),
    );

    const ruleNames = ALL_RULES.map((rule) => rule.name);
    const offenders: string[] = [];

    for (const file of productionFiles) {
      const content = readFileSync(join(dir, file), 'utf8');

      for (const name of ruleNames) {
        if (
          content.includes(`'${name}'`) ||
          content.includes(`"${name}"`) ||
          content.includes(`\`${name}\``)
        ) {
          offenders.push(`${file}: "${name}"`);
        }
      }
    }

    console.log(
      `[W3] file sản phẩm quét được trong thư mục (${String(productionFiles.length)}): ` +
        `${productionFiles.length > 0 ? productionFiles.join(', ') : '(chưa có — worker khác chưa commit vào worktree này)'}`,
    );
    console.log(
      `[W3] tên luật viết cứng: ${offenders.length === 0 ? 'không có' : offenders.join(' · ')}`,
    );

    expect(offenders).toEqual([]);
  });

  it('không một mã màu thô nào trong cả thư mục màn (bao gồm chính test/stories này)', () => {
    expect(() => {
      expectNoRawColor('src/screens/rules/RuleReport');
    }).not.toThrow();
  });
});

/* ==========================================================================
 * B. Dựng props THẬT cho view thuần, từ dữ liệu runRules ở trên.
 *
 *    Đây là mã kiểm thử (giống hệt tinh thần `vmFor` của
 *    `AccountSettings.test.tsx`), không phải mã sản phẩm: gộp theo luật ở đây
 *    là để có props hợp lệ cho `RuleReport`, không phải logic mà hook (W1)
 *    phải viết lại — hook vẫn phải tự dùng `groupViolationsByLevel` /
 *    `sortBySeverity` của `healthScore.ts` như wiring.md
 *    mục 0-BIS.2 đòi hỏi.
 * ========================================================================== */

function ruleOf(code: RuleCode): Rule {
  const rule = ALL_RULES.find((candidate) => candidate.code === code);

  if (rule === undefined) {
    throw new Error(`không tìm thấy luật "${code}" trong ALL_RULES`);
  }

  return rule;
}

function levelLabelOf(levelId: LevelId | null, normalized: NormalizedSpatial): string | null {
  if (levelId === null) {
    return null;
  }

  const entity = normalized.byId[levelId];

  return entity !== undefined && isEntityOfKind('level', entity) ? entity.name : levelId;
}

function toRow(violation: Violation, normalized: NormalizedSpatial): RuleReportRow {
  return {
    key: `${violation.ruleCode}:${violation.entityId}`,
    ruleCode: violation.ruleCode,
    severity: violation.severity,
    message: violation.message,
    suggestion: violation.suggestion,
    entityId: violation.entityId,
    entityCode: displayCodeIn(normalized, violation.entityId),
    levelId: violation.levelId,
    levelLabel: levelLabelOf(violation.levelId, normalized),
    resolved: false,
  };
}

function toGroups(
  violations: readonly Violation[],
  normalized: NormalizedSpatial,
): readonly RuleReportGroup[] {
  const byRule = new Map<RuleCode, Violation[]>();

  for (const violation of sortBySeverity(violations)) {
    const bucket = byRule.get(violation.ruleCode);

    if (bucket === undefined) {
      byRule.set(violation.ruleCode, [violation]);
    } else {
      bucket.push(violation);
    }
  }

  return [...byRule.entries()].map(([ruleCode, ruleViolations]) => {
    const rule = ruleOf(ruleCode);

    return {
      ruleCode,
      ruleName: rule.name,
      group: rule.group,
      severity: rule.severity,
      rows: ruleViolations.map((violation) => toRow(violation, normalized)),
      openCount: ruleViolations.length,
      resolvedCount: 0,
    };
  });
}

/** Bốn ô cùng đếm LUẬT, như `useRuleReport` (BUG-460). */
function toSummary(violations: readonly Violation[]): RuleReportSummary {
  const rulesWithFindings = new Set(violations.map((violation) => violation.ruleCode));
  const criticalRules = new Set(
    violations.filter((violation) => violation.severity === 'critical').map((violation) => violation.ruleCode),
  );

  const warningRules = new Set(
    violations
      .filter((violation) => violation.severity === 'warning' && !criticalRules.has(violation.ruleCode))
      .map((violation) => violation.ruleCode),
  );

  return {
    evaluated: ENABLED_RULES.length,
    passed: ENABLED_RULES.length - rulesWithFindings.size,
    warnings: warningRules.size,
    violations: criticalRules.size,
    suggestions: rulesWithFindings.size - criticalRules.size - warningRules.size,
  };
}

function toPassedRules(violations: readonly Violation[]): readonly PassedRule[] {
  const rulesWithFindings = new Set(violations.map((violation) => violation.ruleCode));

  return ENABLED_RULES.filter((rule) => !rulesWithFindings.has(rule.code)).map((rule) => ({
    ruleCode: rule.code,
    ruleName: rule.name,
    group: rule.group,
  }));
}

const BASE_FILTERS: RuleReportFilters = { level: 'all', group: 'all', levelId: 'all' };

/** Sự thật hôm nay (mục 0-BIS.8): cả ba năng lực đều bị gỡ. */
const BASE_CAPABILITIES: RuleReportCapabilities = {
  canAutoFix: false,
  canDismiss: false,
  canEdit: true,
  canPreview3d: false,
};

const SAMPLE_SKIPPED: SkippedRuleGroup = {
  group: 'circulation',
  reason: 'Chưa đủ dữ liệu cửa đi ở tầng này để chạy nhóm luật lưu thông.',
  remedyPath: ROUTES.project.upload('P-000001'),
  remedyLabel: 'bổ sung bản vẽ',
};

/** Một `RuleReportViewProps` hợp lệ cho mỗi kịch bản trong bảy trạng thái chung. */
function propsFor(scenario: SevenStateScenario): RuleReportViewProps {
  const base: RuleReportViewProps = {
    status: 'empty',
    summary: { evaluated: 0, passed: 0, warnings: 0, violations: 0, suggestions: 0 },
    groups: [],
    resolvedRows: [],
    passedRules: [],
    skipped: [],
    filters: BASE_FILTERS,
    capabilities: BASE_CAPABILITIES,
    // 0-BIS.6: không có API tiến độ theo luật đã chạy — trường này LUÔN null.
    progress: null,
    lastRunLabel: null,
    selectedRowKey: null,
    expandedRuleCodes: [],
    isFiltered: false,
    isCompact: false,
    errorMessage: null,
    onFilterChange: vi.fn(),
    onToggleGroup: vi.fn(),
    onSelectRow: vi.fn(),
    onViewRow: vi.fn(),
    onRerun: vi.fn(),
    onConfirmResolved: vi.fn(),
    previewRef: vi.fn(),
  };

  if (scenario.state === 'empty') {
    return base;
  }

  if (scenario.state === 'loading') {
    return { ...base, status: 'loading' };
  }

  if (scenario.state === 'forbidden') {
    return {
      ...base,
      status: 'forbidden',
      capabilities: { ...BASE_CAPABILITIES, canEdit: false },
    };
  }

  if (scenario.state === 'error') {
    return {
      ...base,
      status: 'error',
      errorMessage: 'Không chạy được kiểm tra luật. Thử lại sau ít phút.',
    };
  }

  if (scenario.state === 'partial') {
    const groups = toGroups(VIOLATED_RESULT.violations, NORMALIZED_VIOLATED);

    return {
      ...base,
      status: 'partial',
      summary: toSummary(VIOLATED_RESULT.violations),
      groups,
      passedRules: toPassedRules(VIOLATED_RESULT.violations),
      skipped: [SAMPLE_SKIPPED],
      expandedRuleCodes: groups.slice(0, 1).map((group) => group.ruleCode),
      lastRunLabel: 'vừa xong',
    };
  }

  // 'success' và 'collapsed' dùng chung một kết quả đầy đủ ('ready' vì
  // VIOLATED_RESULT còn vi phạm); 'collapsed' chỉ khác ở isCompact (mục
  // 0-BIS.8 — trạng thái 7 ẩn panel xem trước, bảng thành thẻ).
  const groups = toGroups(VIOLATED_RESULT.violations, NORMALIZED_VIOLATED);

  return {
    ...base,
    status: 'ready',
    summary: toSummary(VIOLATED_RESULT.violations),
    groups,
    passedRules: toPassedRules(VIOLATED_RESULT.violations),
    lastRunLabel: 'vừa xong',
    expandedRuleCodes: groups.slice(0, 1).map((group) => group.ruleCode),
    isCompact: scenario.state === 'collapsed',
  };
}

function scenarioOf(state: SevenStateScenario['state']): SevenStateScenario {
  const found = createSevenStateScenarios().find((candidate) => candidate.state === state);

  if (found === undefined) {
    throw new Error(`bộ kịch bản không có trạng thái "${state}"`);
  }

  return found;
}

/* ==========================================================================
 * C. Bảy trạng thái (A11 / R-63) — cần `RuleReport` thật, nên nhóm (a) hôm nay.
 * ========================================================================== */

describe('A11 — bảy trạng thái của RuleReport', () => {
  it('dựng đủ bảy, không trạng thái nào ra màn trắng', async () => {
    const RuleReportView = await loadRuleReportView();
    const covered: string[] = [];

    expectSevenStates((scenario) => {
      covered.push(scenario.label);

      return renderRuleReport(RuleReportView, propsFor(scenario));
    }, createSevenStateScenarios());

    console.log(
      `[W3] expectSevenStates = ${String(covered.length)}/${String(SEVEN_STATES.length)} — ${covered.join(', ')}`,
    );

    expect(covered).toHaveLength(SEVEN_STATES.length);
  });

  it('trạng thái "Đang tải" và "Thành công" không vẽ ra cùng một cây', async () => {
    const RuleReportView = await loadRuleReportView();

    const loading = renderRuleReport(RuleReportView, propsFor(scenarioOf('loading')));
    const loadingHtml = loading.container.innerHTML;

    loading.unmount();

    const success = renderRuleReport(RuleReportView, propsFor(scenarioOf('success')));

    expect(success.container.innerHTML).not.toEqual(loadingHtml);
  });
});

/* ==========================================================================
 * D. Tiếp cận được, tiếng Việt có dấu, nhãn mức độ đúng RULE_SEVERITY_LABELS.
 * ========================================================================== */

describe('R-72 — expectAccessible và expectVietnamese trên cây render thật', () => {
  it('trạng thái "ready" tiếp cận được và toàn chữ tiếng Việt có dấu', async () => {
    const RuleReportView = await loadRuleReportView();
    const props = propsFor(scenarioOf('success'));
    const { container } = renderRuleReport(RuleReportView, props);

    // Mã đối tượng (#W-001…) là mã kỹ thuật viết hoa, được
    // `expectVietnamese` chấp nhận (xem ui.md mục A về Table) — đó không phải
    // một từ tiếng Anh.
    //
    // `Level 0`…`Level 3` thì có. Chúng KHÔNG phải chữ của màn: `levelLabel` là
    // TÊN TẦNG đọc nguyên văn từ đồ thị (`levelNamesOf` → `entity.name`), và bộ
    // mẫu dùng chung của repo sinh tên tầng bằng tiếng Anh
    // (`src/lib/testing/fixtures.ts:186` — `name: ` + backtick + `Level ${index}`).
    // Màn không được tự đặt tên tầng, y như không được viết lại câu mô tả; dữ
    // liệu thật có tên tầng tiếng Việt thì màn hiện tiếng Việt. Nên bỏ qua ĐÚNG
    // chuỗi đó, neo hai đầu — không nới rộng hơn một ký tự nào.
    expectVietnamese(container, { ignore: [/^Level \d+$/] });
    expectAccessible(container);
  });

  it('chip mức độ dùng nguyên văn RULE_SEVERITY_LABELS, không tự đặt nhãn khác', async () => {
    const RuleReportView = await loadRuleReportView();
    const props = propsFor(scenarioOf('success'));
    const { container } = renderRuleReport(RuleReportView, props);
    const text = container.textContent ?? '';
    const usedSeverities = new Set(props.groups.map((group) => group.severity));

    expect(usedSeverities.size).toBeGreaterThan(0);

    for (const severity of usedSeverities) {
      expect(text).toContain(RULE_SEVERITY_LABELS[severity]);
    }
  });
});

/* ==========================================================================
 * E. Điều hướng — hook dùng useNavigate(), nên container đòi Router thật.
 * ========================================================================== */

describe('mục 0-BIS.9 — hook dùng useNavigate(), bắt buộc bọc MemoryRouter', () => {
  /**
   * Ngoài Router, `useNavigate()` trong hook ném lỗi — nhưng lỗi đó KHÔNG nổi
   * ra ngoài `render()`, vì R-62 buộc container bọc `ScreenErrorBoundary` và
   * ranh giới bắt lại đúng lỗi này. Nên phép kiểm là: ngoài Router thì ra phần
   * dự phòng của ranh giới lỗi, KHÔNG ra báo cáo. Điều cần chứng minh (hook đòi
   * Router thật) vẫn được chứng minh, và chứng minh thêm rằng ranh giới lỗi làm
   * đúng việc. Gỡ `ScreenErrorBoundary` để phép cũ (`toThrow()`) xanh lại là vi
   * phạm R-62, nên không làm.
   */
  it('dựng RuleReportContainer ngoài Router thì ra phần dự phòng của ranh giới lỗi, không ra báo cáo', async () => {
    const RuleReportContainer = await loadRuleReportContainer();

    // React in lỗi đã bắt được ra console; im nó đi để bảng kết quả đọc được.
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => undefined);

    try {
      render(<RuleReportContainer projectId="P-000001" />);
    } finally {
      consoleError.mockRestore();
    }

    // Không có báo cáo: đầu đề của màn không được dựng.
    expect(screen.queryByRole('heading', { name: 'Kiểm tra quy chuẩn' })).toBeNull();
    // Mà có phần dự phòng của ranh giới lỗi, dựng bằng `EmptyState` từ
    // `report.description` (R-62). Lỗi này không thử lại được nên phần dự phòng
    // KHÔNG có nút — cái nhìn thấy được là đầu đề của nó.
    expect(screen.getByRole('heading', { name: 'Có trục trặc' })).toBeTruthy();
  });

  it('B-V12-02: kho chưa có mô hình thì màn nói thẳng điều đó và không mời bấm một lượt chạy chắc chắn hỏng', async () => {
    const RuleReportContainer = await loadRuleReportContainer();

    renderWithProviders(
      <MemoryRouter>
        <RuleReportContainer projectId="P-000001" />
      </MemoryRouter>,
    );

    expect(
      await screen.findByRole('heading', { name: 'Chưa có mô hình để kiểm tra luật' }),
    ).toBeTruthy();
    expect(screen.queryByRole('button', { name: /^Chạy kiểm tra/u })).toBeNull();
    expect(screen.queryByRole('heading', { name: 'Không chạy được lượt kiểm tra' })).toBeNull();
  });

  it('B-V12-11 / B-V12-06: liên kết "cài đặt bộ luật" đi qua router, không nạp lại trang', async () => {
    const RuleReportContainer = await loadRuleReportContainer();

    renderWithProviders(
      <MemoryRouter initialEntries={[ROUTES.project.rules('P-000001')]}>
        <Routes>
          <Route
            path={ROUTES.project.rules('P-000001')}
            element={<RuleReportContainer projectId="P-000001" />}
          />
          <Route
            path={ROUTES.project.ruleSettings('P-000001')}
            element={<p>màn cài đặt bộ luật</p>}
          />
        </Routes>
      </MemoryRouter>,
    );

    const link = await screen.findByRole('link', { name: 'Cài đặt bộ luật' });
    expect(link.getAttribute('href')).toBe(ROUTES.project.ruleSettings('P-000001'));

    // `fireEvent` trả `false` khi lượt bấm đã bị `preventDefault()` — router đi thay trình duyệt.
    expect(fireEvent.click(link)).toBe(false);
    expect(await screen.findByText('màn cài đặt bộ luật')).toBeTruthy();
  });

  it('bọc trong MemoryRouter thì dựng được, không rơi vào ranh giới lỗi', async () => {
    const RuleReportContainer = await loadRuleReportContainer();

    // Có cả QueryClient: `render` trần trước đây làm hook ném "No QueryClient", ranh giới
    // lỗi nuốt lỗi đó, và `not.toThrow()` xanh dù màn không dựng được.
    renderWithProviders(
      <MemoryRouter>
        <RuleReportContainer projectId="P-000001" />
      </MemoryRouter>,
    );

    expect(screen.queryByRole('heading', { name: 'Có trục trặc' })).toBeNull();
  });
});

/* ==========================================================================
 * F. Ba năng lực bị gỡ (0-BIS.1, 0-BIS.2, 0-BIS.8) — không nút, không panel.
 * ========================================================================== */

describe('năng lực bị gỡ thì bị gỡ khỏi DOM, không render nút vô hiệu hoá', () => {
  it('canAutoFix=false: không nút "sửa tự động" nào trong DOM', async () => {
    const RuleReportView = await loadRuleReportView();
    const props = propsFor(scenarioOf('success'));
    renderRuleReport(RuleReportView, props);

    expect(screen.queryByRole('button', { name: /sửa tự động/i })).toBeNull();
  });

  it('canDismiss=false: không nút "Bỏ qua" nào trong DOM', async () => {
    const RuleReportView = await loadRuleReportView();
    const props = propsFor(scenarioOf('success'));
    renderRuleReport(RuleReportView, props);

    expect(screen.queryByRole('button', { name: /bỏ qua/i })).toBeNull();
  });

  it('canPreview3d=false: không panel xem trước 3D (không canvas nào trong DOM)', async () => {
    const RuleReportView = await loadRuleReportView();
    const props = propsFor(scenarioOf('success'));
    const { container } = renderRuleReport(RuleReportView, props);

    expect(container.querySelector('canvas')).toBeNull();
  });
});

describe('K5 — đường dẫn "Dự án › <tên dự án> › …" như các màn dự án khác', () => {
  it('vẽ breadcrumb khi nơi gọi đưa vào, cấp "Dự án" bấm được', async () => {
    const RuleReportView = await loadRuleReportView();
    const onBack = vi.fn();
    renderRuleReport(RuleReportView, {
      ...propsFor(scenarioOf('success')),
      breadcrumb: [
        { id: 'projects', label: 'Dự án', onClick: onBack },
        { id: 'project', label: 'Nhà mẫu' },
        { id: 'current', label: 'Kiểm tra luật không gian' },
      ],
    });

    const nav = screen.getByRole('navigation', { name: 'Đường dẫn trang' });
    expect(within(nav).getByText('Nhà mẫu')).toBeTruthy();
    fireEvent.click(within(nav).getByRole('link', { name: 'Dự án' }));
    expect(onBack).toHaveBeenCalledTimes(1);
  });
});

describe('BUG-465 — chưa có kết quả thì không có gì để xác nhận, và chỉ một nút thử lại', () => {
  it.each([['error'], ['loading']] as const)('%s: không nút "Sang Xuất"', async (state) => {
    const RuleReportView = await loadRuleReportView();
    renderRuleReport(RuleReportView, propsFor(scenarioOf(state)));

    expect(screen.queryByRole('button', { name: 'Sang Xuất' })).toBeNull();
  });

  it('error: "Thử lại" ở thân là nút chạy lại duy nhất', async () => {
    const RuleReportView = await loadRuleReportView();
    const props = propsFor(scenarioOf('error'));
    renderRuleReport(RuleReportView, props);

    expect(screen.queryByRole('button', { name: 'Kiểm tra lại' })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Thử lại' }));
    expect(props.onRerun).toHaveBeenCalledTimes(1);
  });
});

/* ==========================================================================
 * G. Màu chỉ là chip nhỏ và chấm — CẤM TUYỆT ĐỐI dải đỏ lớn.
 *
 *    jsdom không dựng layout thật nên không đo được diện tích theo px (mọi
 *    `getBoundingClientRect()` trả về 0). Phép đo dưới đây là GIÁN TIẾP: đếm số
 *    phần tử mang token màu vi phạm và kiểm lớp của chúng có hình dạng chip/
 *    chấm (`h-[22px]` của Badge, hoặc `rounded-full` của chấm) — không khẳng
 *    định đã đo diện tích thật. Đã ghi rõ điều này trong `worker_done`.
 * ========================================================================== */

describe('CẤM TUYỆT ĐỐI — đỏ chỉ xuất hiện dưới dạng chip nhỏ và chấm', () => {
  it('phần tử mang token màu vi phạm ít, và đều có hình dạng chip/chấm (phép đo gián tiếp)', async () => {
    const RuleReportView = await loadRuleReportView();
    const props = propsFor(scenarioOf('success'));
    const { container } = renderRuleReport(RuleReportView, props);

    /* V-10 (chủ ý): số KPI "Nghiêm trọng" ở dải tổng kết tô chữ đỏ khi > 0. Đó là chữ số,
       không phải mảng/dải đỏ, nên tách riêng: đúng một ô số, còn lại vẫn phải là chip/chấm. */
    const allViolationColored = [
      ...container.querySelectorAll<HTMLElement>('[class*="state-violation"]'),
    ];
    const kpiNumbers = allViolationColored.filter((element) => element.tagName === 'DD');
    expect(kpiNumbers.length).toBeLessThanOrEqual(1);
    const violationColored = allViolationColored.filter((element) => element.tagName !== 'DD');
    const criticalRowCount = VIOLATED_RESULT.violations.filter(
      (violation) => violation.severity === 'critical',
    ).length;

    console.log(
      `[W3] phần tử mang màu "state-violation" trong DOM = ${String(violationColored.length)} · ` +
        `số hàng critical thật = ${String(criticalRowCount)} (phép đo gián tiếp qua tên lớp, không phải diện tích px)`,
    );

    expect(violationColored.length).toBeGreaterThan(0);
    // Nhỏ: tối đa một chip + một chấm cho mỗi hàng nghiêm trọng, không phải một
    // dải phủ độc lập với số hàng.
    expect(violationColored.length).toBeLessThanOrEqual(criticalRowCount * 2);

    for (const element of violationColored) {
      // `\b` ở CUỐI không bao giờ khớp được: sau `]` là dấu cách, cả hai đều
      // không phải ký tự từ, nên không có ranh giới từ ở đó — biểu thức cũ
      // không thể xanh dù mã đúng hay sai. Bỏ đúng dấu `\b` cuối, giữ nguyên
      // điều đang cần chứng minh: phần tử mang màu vi phạm phải là chip
      // (`h-[22px]` của `Badge`) hoặc chấm (`rounded-full`).
      const looksLikeChipOrDot =
        /\bh-\[22px\]/.test(element.className) || /\brounded-full\b/.test(element.className);

      expect(
        looksLikeChipOrDot,
        `phần tử mang màu vi phạm không giống chip/chấm: class="${element.className}"`,
      ).toBe(true);
    }

    // Không dải đỏ lớn ngang trang: không phần tử nào vừa mang màu vi phạm vừa
    // trải hết chiều ngang.
    expect(container.querySelectorAll('[class*="state-violation"][class*="w-full"]').length).toBe(
      0,
    );
  });
});

/* ==========================================================================
 * H. Câu mô tả không bị viết lại (0-BIS.2 + types.ts: "CẤM viết lại, CẤM định
 *    dạng lại"), và mục đã xử lý còn nhìn thấy trong nhóm gộp (CẤM TUYỆT ĐỐI).
 * ========================================================================== */

describe('câu mô tả lấy nguyên văn từ violation.message, không bị viết lại', () => {
  it('row.message xuất hiện NGUYÊN VĂN trong DOM', async () => {
    const RuleReportView = await loadRuleReportView();
    const props = propsFor(scenarioOf('success'));
    const sampleMessage = props.groups[0]?.rows[0]?.message;

    if (sampleMessage === undefined) {
      throw new Error('không có hàng mẫu để kiểm — propsFor lỗi');
    }

    renderRuleReport(RuleReportView, props);

    /* Bộ mẫu A14 lặp cùng mặt bằng ở bốn tầng, và câu luật gọi thực thể bằng mã theo tầng
       (#D-001…, B-V7-05) — nên cùng một câu có thể đứng ở nhiều hàng. */
    expect(screen.getAllByText(sampleMessage).length).toBeGreaterThan(0);
  });
});

describe('mục đã xử lý phải còn nhìn thấy trong nhóm gộp (CẤM TUYỆT ĐỐI)', () => {
  it('hàng resolved=true trong resolvedRows vẫn xuất hiện trong DOM', async () => {
    const RuleReportView = await loadRuleReportView();
    const props = propsFor(scenarioOf('success'));
    const firstGroup = props.groups[0];
    const firstRow = firstGroup?.rows[0];

    if (firstGroup === undefined || firstRow === undefined) {
      throw new Error('không có hàng mẫu để kiểm — propsFor lỗi');
    }

    const resolvedRow: RuleReportRow = { ...firstRow, resolved: true };
    const withResolved: RuleReportViewProps = {
      ...props,
      groups: props.groups.map((group) =>
        group.ruleCode === firstGroup.ruleCode
          ? { ...group, rows: group.rows.slice(1), resolvedCount: 1 }
          : group,
      ),
      resolvedRows: [resolvedRow],
    };

    renderRuleReport(RuleReportView, withResolved);

    expect(screen.getAllByText(resolvedRow.message).length).toBeGreaterThan(0);
  });
});

/* ==========================================================================
 * I. R-73 — "Chọn" một vi phạm mở `ViolationDetailContainer` dạng tấm trượt.
 *
 *    Đây là container THẬT (không phải view thuần), nên `useRuleReport` chạy
 *    `useQuery` thật và cần `QueryClientProvider` — `renderWithProviders`
 *    của `@/lib/testing/render`, không phải `render()` trần của mục E. Kho
 *    được nạp bằng đúng hành động công khai của slice (`setSpatial`,
 *    `setActiveFloor`), cùng khuôn `ViolationDetail.test.tsx` mục "[NGHIỆM
 *    THU]" — không gọi `useStore.setState` tay.
 * ========================================================================== */

describe('R-73 — chọn một vi phạm mở ViolationDetailContainer dạng tấm trượt', () => {
  it('bấm câu mô tả của một hàng mở đúng tấm trượt của vi phạm đó; Esc đóng lại (A12)', async () => {
    const RuleReportContainer = await loadRuleReportContainer();
    const firstLevelEntityId = NORMALIZED_VIOLATED.byKind.level[0];
    const firstLevelEntity =
      firstLevelEntityId === undefined ? undefined : NORMALIZED_VIOLATED.byId[firstLevelEntityId];

    if (firstLevelEntity === undefined || !isEntityOfKind('level', firstLevelEntity)) {
      throw new Error(
        'VIOLATED_BUILDING_SCENARIO không có tầng nào — không dựng được lượt kiểm R-73',
      );
    }

    const firstLevelId = firstLevelEntity.id;

    // `renderWithProviders` đặt kho về ban đầu TRƯỚC mỗi lượt render (mục
    // "Vì sao kho được hạ tay" của `render.tsx`), nên lượt nạp đồ thị phải
    // nằm SAU render — cùng thứ tự `ViolationDetail.test.tsx` mục "[NGHIỆM
    // THU]" dùng, không phải trước.
    const { container } = renderWithProviders(
      <MemoryRouter>
        <RuleReportContainer projectId="P-000001" />
      </MemoryRouter>,
    );

    await act(async () => {
      useStore.getState().setSpatial(NORMALIZED_VIOLATED, 'w3-r73-version');
      useStore.getState().setActiveFloor(firstLevelId);
      await Promise.resolve();
    });

    // Chưa chọn gì: tấm trượt không có trong cây.
    expect(screen.queryByRole('complementary', { name: 'Chi tiết vi phạm' })).toBeNull();

    // Đợi lượt chạy xong rồi mở nhóm luật đầu tiên (mọi nhóm bắt đầu đóng —
    // `expandedRuleCodes` của `useRuleReport` rỗng lúc mở màn thật, khác
    // `propsFor` ở mục B vốn tự mở sẵn cho các phép kiểm view thuần). Neo vào
    // `h3 button` — `RuleReportSection` là nút DUY NHẤT bọc trong `<h3>`; bộ lọc
    // "Nhóm luật" ở `RuleReportFilterBar` cũng mang `aria-expanded` (nó là một
    // ô chọn) nên một selector không neo `h3` bắt nhầm đúng cái đó trước.
    const groupToggle = await waitFor(() => {
      const toggle = container.querySelector<HTMLButtonElement>('h3 button[aria-expanded="false"]');

      if (toggle === null) {
        throw new Error('chưa có nhóm luật nào để mở — lượt chạy chưa xong');
      }

      return toggle;
    });

    fireEvent.click(groupToggle);

    const messageButton = await waitFor(() => {
      const button = container.querySelector<HTMLButtonElement>('tbody button');

      if (button === null) {
        throw new Error('chưa có hàng nào trong nhóm vừa mở');
      }

      return button;
    });

    const clickedMessage = messageButton.textContent ?? '';

    // B-V7-31 — chip mã đối tượng là mã người đọc, cùng mã câu luật gọi, không phải
    // mã máy `D-DOOR0000000`.
    const chips = [...container.querySelectorAll('tbody code')].map((chip) => chip.textContent);

    expect(chips.length).toBeGreaterThan(0);
    for (const chip of chips) {
      expect(chip).toMatch(/^#[A-Z]-\d{3}$/u);
    }

    expect(clickedMessage.length).toBeGreaterThan(0);

    fireEvent.click(messageButton);

    const panel = await waitFor(() => screen.getByRole('complementary', { name: 'Chi tiết vi phạm' }));

    // Đúng vi phạm vừa bấm — không phải hàng đầu tiên của một danh sách khác.
    // Chứng minh `initialIndex` trỏ đúng chỗ trong `violations`, không lệch
    // do khác thứ tự giữa `allRows` (nguồn của tấm trượt) và DOM.
    expect(within(panel).getByRole('heading', { level: 2 })).toHaveTextContent(clickedMessage);

    // A12 — Esc đóng lớp trên cùng.
    fireEvent.keyDown(window, { key: 'Escape' });

    await waitFor(() => {
      expect(screen.queryByRole('complementary', { name: 'Chi tiết vi phạm' })).toBeNull();
    });
  });
});

describe('BUG-433 — route đo mốc thu gọn: dưới 1024 hàng là thẻ, không phải bảng năm cột', () => {
  afterEach(() => {
    Reflect.deleteProperty(window, 'matchMedia');
  });

  it('khổ hẹp → nhóm mở ra là danh sách thẻ, không có <table>', async () => {
    window.matchMedia = ((query: string) => ({
      matches: true,
      media: query,
      addEventListener: () => undefined,
      removeEventListener: () => undefined,
    })) as unknown as typeof window.matchMedia;
    const { RulesRoute } = RuleReportContainerModule;
    act(() => {
      useStore.getState().setProject({ created_at: '', id: 'P-1', members: [], name: 'P-1', updated_at: '' });
      useStore.getState().setSpatial(NORMALIZED_VIOLATED, 'bug-433');
      useStore.getState().setUserRoles(['admin']);
    });
    const { container } = renderWithProviders(
      <MemoryRouter initialEntries={[ROUTES.project.rules('P-1')]}>
        <Routes>
          <Route path="/projects/:projectId/rules" element={<RulesRoute />} />
        </Routes>
      </MemoryRouter>,
      { keepStore: true },
    );

    const groupToggle = await waitFor(() => {
      const toggle = container.querySelector<HTMLButtonElement>('h3 button[aria-expanded="false"]');
      if (toggle === null) {
        throw new Error('chưa có nhóm luật nào để mở — lượt chạy chưa xong');
      }
      return toggle;
    });
    fireEvent.click(groupToggle);

    await waitFor(() => {
      expect(container.querySelector('section li button')).not.toBeNull();
    });
    expect(container.querySelector('table')).toBeNull();
  });
});

/* ==========================================================================
 * F-10 — báo cáo chạy luật với cấu hình của dự án (N21), không với sổ mặc định.
 * ========================================================================== */

type RuleConfigReadResult = Awaited<ReturnType<ApiClient['ruleConfig']['read']>>;

/** Luật nổ nhiều nhất trên bộ mẫu A14 (96 vi phạm) — tắt nó thì kết quả đổi thấy rõ. */
const NOISY_RULE_CODE = 'WALL-DANGLING-END';

const configRead = (revision: number, overrides: ProjectRuleConfig['overrides'] = {}): RuleConfigReadResult => ({
  ok: true,
  data: { overrides, revision },
});

function setupReport(options: {
  readonly read: ApiClient['ruleConfig']['read'];
  readonly canEdit?: boolean;
}) {
  const read = vi.fn(options.read);
  const client: ApiClient = {
    ...createMockApiClient(),
    ruleConfig: { read, replace: vi.fn<ApiClient['ruleConfig']['replace']>() },
  };
  const ruleConfigGateway = createRuleSettingsGateway({ client });
  const queryClient = createTestQueryClient();
  const wrapper = ({ children }: { readonly children: ReactNode }) => (
    <QueryClientProvider client={queryClient}>
      <MemoryRouter>{children}</MemoryRouter>
    </QueryClientProvider>
  );

  act(() => {
    useStore.getState().setSpatial(normalizeSpatial(createSampleBuilding()), 'f10-report');
  });

  const view = renderHook(
    () =>
      useRuleReport({
        projectId: 'P-F10',
        ruleConfigGateway,
        ...(options.canEdit !== undefined ? { canEdit: options.canEdit } : {}),
      }),
    { wrapper },
  );

  return { ...view, read, queryClient };
}

const openCountOf = (
  groups: readonly { readonly ruleCode: RuleCode; readonly openCount: number }[],
  code: RuleCode,
): number => groups.find((group) => group.ruleCode === code)?.openCount ?? 0;

const ruleCodesOf = (groups: readonly { readonly ruleCode: RuleCode }[]): RuleCode[] =>
  groups.map((group) => group.ruleCode);

describe('F-10 — useRuleReport đọc cấu hình N21', () => {
  it('28-B-005: 0 luật critical nhưng còn cảnh báo → không phải `done`, nhóm cảnh báo vẫn liệt kê', async () => {
    const sample = runRules(normalizeSpatial(createSampleBuilding()), { registry: createDefaultRuleRegistry() });
    const criticalCodes = [...new Set(sample.violations.filter((v) => v.severity === 'critical').map((v) => v.ruleCode))];
    const overrides = Object.fromEntries(criticalCodes.map((code) => [code, { enabled: false }]));
    const { result } = setupReport({ read: async () => configRead(1, overrides) });

    await waitFor(() => {
      expect(result.current.summary.evaluated).toBeGreaterThan(0);
    });

    expect(result.current.summary.violations).toBe(0);
    expect(result.current.summary.warnings + result.current.summary.suggestions).toBeGreaterThan(0);
    expect(result.current.status).toBe('ready');
    expect(result.current.groups.length).toBeGreaterThan(0);
  });

  it('N21 tắt một luật → luật đó vắng khỏi kết quả', async () => {
    const { result } = setupReport({ read: async () => configRead(1, { [NOISY_RULE_CODE]: { enabled: false } }) });

    await waitFor(() => {
      expect(result.current.status).not.toBe('loading');
    });

    expect(result.current.summary.evaluated).toBeGreaterThan(0);
    expect(ruleCodesOf(result.current.groups)).not.toContain(NOISY_RULE_CODE);
  });

  it('BUG-460: bốn ô cùng đếm luật — Tổng = Đạt + Cảnh báo + Vi phạm, khớp số nhóm của tab', async () => {
    const { result } = setupReport({ read: async () => configRead(1) });

    await waitFor(() => {
      expect(result.current.status).not.toBe('loading');
    });

    const { evaluated, passed, warnings, violations, suggestions } = result.current.summary;
    const groups = result.current.groups;
    expect(passed + warnings + violations + suggestions).toBe(evaluated);
    expect(violations).toBe(groups.filter((group) => group.rows.some((row) => row.severity === 'critical')).length);
    expect(warnings + violations + suggestions).toBe(groups.length);
  });

  it('đổi revision (lượt lưu ở màn cài đặt) → báo cáo chạy lại với cấu hình mới', async () => {
    const { result, queryClient } = setupReport({ read: async () => configRead(1) });

    await waitFor(() => {
      expect(openCountOf(result.current.groups, NOISY_RULE_CODE)).toBeGreaterThan(0);
    });

    act(() => {
      queryClient.setQueryData(ruleSettingsQueryKey('P-F10'), {
        revision: 2,
        config: { overrides: { [NOISY_RULE_CODE]: { enabled: false } }, version: 0 },
      });
    });

    // Hàng biến mất giữa hai lượt chạy hiện lại dạng "đã xử lý", nên đếm hàng còn MỞ.
    await waitFor(() => {
      expect(openCountOf(result.current.groups, NOISY_RULE_CODE)).toBe(0);
    });
  });

  it('28-C-014: luật bị tắt ở phiên khác không hiện dưới "Đã xử lý"', async () => {
    const { result, queryClient } = setupReport({ read: async () => configRead(1) });

    await waitFor(() => {
      expect(openCountOf(result.current.groups, NOISY_RULE_CODE)).toBeGreaterThan(0);
    });

    act(() => {
      queryClient.setQueryData(ruleSettingsQueryKey('P-F10'), {
        revision: 2,
        config: { overrides: { [NOISY_RULE_CODE]: { enabled: false } }, version: 0 },
      });
    });

    await waitFor(() => {
      expect(openCountOf(result.current.groups, NOISY_RULE_CODE)).toBe(0);
    });
    expect(result.current.resolvedRows.filter((row) => row.ruleCode === NOISY_RULE_CODE)).toHaveLength(0);
    expect(ruleCodesOf(result.current.groups)).not.toContain(NOISY_RULE_CODE);
  });

  it('versionId đổi sau một lượt sửa → khoá query đổi nhưng nhóm không biến mất giữa chừng', async () => {
    const { result } = setupReport({ read: async () => configRead(1) });

    await waitFor(() => {
      expect(openCountOf(result.current.groups, NOISY_RULE_CODE)).toBeGreaterThan(0);
    });
    const before = result.current.groups.length;

    act(() => {
      useStore.getState().setVersionId('v-sau-khi-luu');
    });

    expect(result.current.groups.length).toBe(before);
    expect(result.current.status).not.toBe('loading');
  });

  it('canEdit: false không tắt truy vấn', async () => {
    const { result, read } = setupReport({ read: async () => configRead(1), canEdit: false });

    await waitFor(() => {
      expect(result.current.summary.evaluated).toBeGreaterThan(0);
    });
    expect(read).toHaveBeenCalledTimes(1);
  });

  it('N21 hỏng → `error`, kèm câu riêng về cấu hình', async () => {
    const error: HttpError = { kind: 'http', status: 500, code: 'INTERNAL', raw: {}, requestId: 'req-f10', retryable: false };
    const { result } = setupReport({ read: async () => ({ ok: false, error }) });

    await waitFor(() => {
      expect(result.current.status).toBe('error');
    });
    expect(result.current.errorMessage).toBe('Không tải được cấu hình bộ luật của dự án.');
  });

  it('N21 hỏng rồi bấm "Thử lại" → đọc lại N21, màn rời `error`', async () => {
    const error: HttpError = { kind: 'http', status: 503, code: 'DEPENDENCY_UNAVAILABLE', raw: {}, requestId: 'req-f10', retryable: true };
    let reads = 0;
    const { result, read } = setupReport({
      read: async () => {
        reads += 1;

        return reads === 1 ? { ok: false, error } : configRead(1);
      },
    });

    await waitFor(() => {
      expect(result.current.status).toBe('error');
    });

    act(() => result.current.onRerun());

    await waitFor(() => {
      expect(result.current.summary.evaluated).toBeGreaterThan(0);
    });
    expect(read).toHaveBeenCalledTimes(2);
    expect(result.current.status).not.toBe('error');
  });

  it('N21 đang chờ → `loading`', () => {
    const { result } = setupReport({ read: () => new Promise<RuleConfigReadResult>(() => undefined) });

    expect(result.current.status).toBe('loading');
  });
});

describe('QA-06b F10 #1 — viewer đi qua đủ trạng thái, chỉ khoá hành động', () => {
  it('viewer + N21 đang chờ → `loading` (không phải `forbidden`)', () => {
    const { result } = setupReport({ read: () => new Promise<RuleConfigReadResult>(() => undefined), canEdit: false });

    expect(result.current.status).toBe('loading');
    expect(result.current.capabilities.canEdit).toBe(false);
  });

  it('viewer + N21 lỗi → `error` (lỗi không bị nuốt)', async () => {
    const error: HttpError = { kind: 'http', status: 503, code: 'DEPENDENCY_UNAVAILABLE', raw: {}, requestId: 'req-f10v', retryable: true };
    const { result } = setupReport({ read: async () => ({ ok: false, error }), canEdit: false });

    await waitFor(() => {
      expect(result.current.status).toBe('error');
    });
  });

  it('viewer + chưa có mô hình → `empty`', async () => {
    const { result } = setupReport({ read: async () => configRead(1), canEdit: false });

    act(() => {
      useStore.getState().setSpatial(null, null);
    });

    await waitFor(() => {
      expect(result.current.status).toBe('empty');
    });
  });

  it('viewer + có vi phạm → `ready`, capabilities.canEdit vẫn false', async () => {
    const { result } = setupReport({ read: async () => configRead(1), canEdit: false });

    await waitFor(() => {
      expect(result.current.status).toBe('ready');
    });
    expect(result.current.summary.violations).toBeGreaterThan(0);
    expect(result.current.capabilities.canEdit).toBe(false);
  });

  it('không truyền canEdit → mặc định an toàn: không quyền sửa (#6)', () => {
    const { result } = setupReport({ read: () => new Promise<RuleConfigReadResult>(() => undefined) });

    expect(result.current.capabilities.canEdit).toBe(false);
  });
});

describe('UX-R1 K50/K51 — tỷ lệ tạm và "Sang Xuất" khi còn lỗi nghiêm trọng', () => {
  it('K51: còn luật nghiêm trọng thì "Sang Xuất" hỏi trước, đồng ý mới đi', async () => {
    const RuleReportView = await loadRuleReportView();
    const onConfirmResolved = vi.fn();
    const base = propsFor(scenarioOf('success'));
    // Nút cổng bay vào khe của thanh bước (portal) — dựng khe như header thật.
    const slot = document.createElement('div');
    document.body.append(slot);
    act(() => setFlowGateSlot(slot));
    try {
      renderRuleReport(RuleReportView, {
        ...base,
        status: 'ready',
        summary: { ...base.summary, violations: 2 },
        onConfirmResolved,
      });

      fireEvent.click(screen.getByRole('button', { name: 'Sang Xuất' }));
      expect(onConfirmResolved).not.toHaveBeenCalled();
      fireEvent.click(await screen.findByRole('button', { name: 'Vẫn sang Xuất' }));
      expect(onConfirmResolved).toHaveBeenCalledTimes(1);
      // UX-25: đã đồng ý ở đây thì màn Xuất nhận cờ, không hỏi lại.
      expect(onConfirmResolved).toHaveBeenCalledWith(true);
    } finally {
      cleanup();
      act(() => setFlowGateSlot(null));
      slot.remove();
    }
  });

  it('K50: dự án còn tầng tỷ lệ tạm thì có dải nói kết quả là tạm', async () => {
    const RuleReportView = await loadRuleReportView();
    const notice = 'Có 6 tầng chưa có tỷ lệ: kết quả về diện tích, độ dài, lưu thông là tạm.';
    renderRuleReport(RuleReportView, { ...propsFor(scenarioOf('success')), provisionalScaleNotice: notice });

    expect(screen.getByText(notice)).toBeTruthy();
  });
});
