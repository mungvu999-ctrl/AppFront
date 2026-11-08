/**
 * M2 — logic của mục "Lớp đề xuất" (menu "Xem" trang 3D): đọc lớp đề xuất từng tầng trong kho, công tắc hiện lớp
 * theo tầng, bật/tắt từng món (kho đánh dấu bẩn → bộ tự lưu gửi `suggestionState`), "Cập nhật gợi ý"
 * (`refreshSuggestions`). Tên luật lấy từ bảng gói kèm (`GET /suggestion-rules` chưa có ở máy chủ).
 */
import { useMemo, useSyncExternalStore } from 'react';

import { DEFAULT_RULESET } from '@/lib/suggestions/ruleset';
import { useStore } from '@/store';

import {
  floorSuggestionsView,
  isFloorLayerHidden,
  layerVisibilitySnapshot,
  setFloorLayerHidden,
  subscribeLayerVisibility,
  type FloorSuggestionsView,
} from './suggestionLayer';

export interface SuggestionLayerView {
  readonly floors: readonly FloorSuggestionsView[];
  readonly readOnly: boolean;
  readonly onToggleVisible: (floorId: string) => void;
  readonly onToggleItem: (floorId: string, id: string, on: boolean) => void;
  readonly onRefresh: (floorId: string) => void;
}

export function useSuggestionLayer(projectId: string, readOnly: boolean): SuggestionLayerView {
  const floorSuggestions = useStore((state) => state.floorSuggestions);
  const levels = useStore((state) => state.floors);
  const spatial = useStore((state) => state.spatial);
  const hidden = useSyncExternalStore(subscribeLayerVisibility, layerVisibilitySnapshot, layerVisibilitySnapshot);

  const floors = useMemo(
    () =>
      Object.entries(floorSuggestions)
        .filter(([, entry]) => entry.suggestions.length > 0)
        .map(([floorId, entry]) =>
          floorSuggestionsView({
            floorId,
            floorName: levels.find((level) => level.id === floorId)?.name ?? 'Tầng',
            entry,
            ruleset: DEFAULT_RULESET,
            spatial,
            visible: !hidden.has(`${projectId}:${floorId}`),
          }),
        ),
    [floorSuggestions, hidden, levels, projectId, spatial],
  );

  return {
    floors,
    readOnly,
    onToggleVisible: (floorId) => setFloorLayerHidden(projectId, floorId, !isFloorLayerHidden(projectId, floorId)),
    onToggleItem: (floorId, id, on) => {
      const target = useStore.getState().floorSuggestions[floorId]?.suggestions.find((s) => s.id === id);
      if (target === undefined || target.state === 'adopted') return;
      useStore.getState().changeSuggestionState(floorId, id, on ? (target.override === undefined ? 'active' : 'overridden') : 'disabled');
    },
    onRefresh: (floorId) => useStore.getState().requestSuggestionRefresh(floorId),
  };
}
