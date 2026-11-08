import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { normalizeSpatial } from '@/domain/spatial/normalize';
import { withSuggestionState } from '@/lib/suggestions/state';
import { CH04, goldenGraphOf, storedSuggestionsOf } from '@/lib/suggestions/__fixtures__/golden';
import { DEFAULT_RULESET } from '@/lib/suggestions/ruleset';
import { expectAccessible } from '@/lib/testing/expectAccessible';

import { floorSuggestionsView, visibleSuggestionsOf } from '../suggestionLayer';
import { SuggestionsPanel } from '../SuggestionsPanel';
import * as stories from '../SuggestionsPanel.stories';
import type { SuggestionLayerView } from '../useSuggestionLayer';

const STORED = storedSuggestionsOf(CH04);
const FLOOR = 'L-01M6GEZPRRGMBWR8D13KAF6YE6';

describe('SuggestionsPanel (M2 "Lớp đề xuất")', () => {
  const cases = Object.entries(stories).filter(([name]) => name !== 'default') as [string, { args: { view: SuggestionLayerView } }][];

  it.each(cases)('story %s: tiếp cận được', (_name, story) => {
    const { container } = render(<SuggestionsPanel view={story.args.view} />);
    expectAccessible(container);
  });

  it('save__server_without_m2_does_not_block_geometry: máy chủ chưa có M2 thì panel báo, thân #35 không mang khoá lớp đề xuất', () => {
    render(<SuggestionsPanel view={stories.Unsupported.args.view} />);
    expect(screen.getByText('Máy chủ chưa hỗ trợ lớp đề xuất.')).toBeTruthy();
    expect(screen.queryByRole('checkbox')).toBeNull();
  });

  it('bật/tắt món và lớp gọi đúng hàm; món đã nhận nuôi không bật/tắt được', () => {
    const view = { ...stories.Floor.args.view, onToggleItem: vi.fn(), onToggleVisible: vi.fn() };
    render(<SuggestionsPanel view={view} />);
    fireEvent.click(screen.getAllByRole('checkbox', { name: 'Len chân tường — Phòng khách' })[1]!);
    expect(view.onToggleItem).toHaveBeenCalledWith('L-01', 'DRESS-R1-R-1-W-2', true);
    fireEvent.click(screen.getByRole('checkbox', { name: 'Bật lớp đề xuất của tầng' }));
    expect(view.onToggleVisible).toHaveBeenCalledWith('L-01');
    expect((screen.getByRole('checkbox', { name: /đã nhận làm đồ thật/ }) as HTMLInputElement).disabled).toBe(true);
    expect(screen.getByText('đồ chủ đã bị xoá khỏi bản vẽ')).toBeTruthy();
  });

  it('view model từ ca vàng: nhóm theo tên luật, đếm đang bật, gợi ý cũ tách riêng kèm lý do', () => {
    const r1 = STORED.find((s) => s.rule === 'R1')!;
    const suggestions = withSuggestionState(STORED, r1.id, 'disabled').map((s) =>
      s.rule === 'L1' && s.id.endsWith('BAE') ? { ...s, stale: { since: 2, reasonVi: 'đồ chủ đã bị xoá khỏi bản vẽ' } } : s,
    );
    const view = floorSuggestionsView({
      floorId: FLOOR,
      floorName: 'Tầng 1',
      entry: { suggestions, enabled: true },
      ruleset: DEFAULT_RULESET,
      spatial: normalizeSpatial(goldenGraphOf(CH04)),
    });
    expect(view.visible).toBe(true);
    const r1Group = view.groups.find((g) => g.rule === 'R1')!;
    const total = STORED.filter((s) => s.rule === 'R1').length;
    expect(r1Group).toMatchObject({ title: 'Len chân tường', countLabel: `${total - 1}/${total} đang bật`, listOnly: false });
    expect(view.groups.find((g) => g.rule === 'R3')?.listOnly).toBe(true);
    expect(view.groups.map((g) => g.rule)).toEqual(Object.keys(DEFAULT_RULESET.rules).filter((rule) => view.groups.some((g) => g.rule === rule)));
    expect(view.stale).toEqual([expect.objectContaining({ reason: 'đồ chủ đã bị xoá khỏi bản vẽ' })]);
  });

  it('tầng tắt lớp (`suggestionsEnabled` vắng): cảnh không nhận đề xuất của tầng ấy', () => {
    expect(visibleSuggestionsOf({ [FLOOR]: { suggestions: STORED, enabled: true } })).toHaveLength(STORED.length);
    expect(visibleSuggestionsOf({ [FLOOR]: { suggestions: STORED } })).toEqual([]);
  });
});
