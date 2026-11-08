/**
 * M2 — logic của mục "Lớp đề xuất" (menu "Xem" trang 3D): đọc lớp đề xuất từng tầng trong kho, bật/tắt lớp của
 * tầng (`suggestionsEnabled`), bật/tắt từng món (kho đánh dấu bẩn → bộ tự lưu gửi `suggestionState`). Tên luật
 * lấy từ bảng gói kèm (chưa nối `GET /api/suggestion-rules` vào giao diện).
 */
import { useMemo } from 'react';

import { DEFAULT_RULESET } from '@/lib/suggestions/ruleset';
import { useStore } from '@/store';

import { floorSuggestionsView, type FloorSuggestionsView } from './suggestionLayer';

export interface SuggestionLayerView {
  readonly floors: readonly FloorSuggestionsView[];
  readonly readOnly: boolean;
  readonly onToggleVisible: (floorId: string) => void;
  readonly onToggleItem: (floorId: string, id: string, on: boolean) => void;
}

export function useSuggestionLayer(readOnly: boolean): SuggestionLayerView {
  const floorSuggestions = useStore((state) => state.floorSuggestions);
  const levels = useStore((state) => state.floors);
  const spatial = useStore((state) => state.spatial);

  const floors = useMemo(
    () =>
      levels.map((level) =>
        floorSuggestionsView({
          floorId: level.id,
          floorName: level.name,
          entry: floorSuggestions[level.id] ?? { suggestions: [] },
          ruleset: DEFAULT_RULESET,
          spatial,
        }),
      ),
    [floorSuggestions, levels, spatial],
  );

  return {
    floors,
    readOnly,
    onToggleVisible: (floorId) =>
      useStore.getState().setSuggestionsEnabled(floorId, useStore.getState().floorSuggestions[floorId]?.enabled !== true),
    onToggleItem: (floorId, id, on) => {
      const target = useStore.getState().floorSuggestions[floorId]?.suggestions.find((s) => s.id === id);
      if (target === undefined || target.state === 'adopted') return;
      useStore.getState().changeSuggestionState(floorId, id, on ? (target.override === undefined ? 'active' : 'overridden') : 'disabled');
    },
  };
}
