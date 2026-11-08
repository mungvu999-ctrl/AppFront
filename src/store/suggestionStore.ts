import { create } from 'zustand';

import type { FloorSuggestions } from '../lib/suggestions/state';

/**
 * M2 — lớp đề xuất theo tầng, kho RIÊNG (không nằm trong `useStore`, không vào lịch sử hoàn tác). Đi kèm chunk của
 * `commit.ts` (tái xuất qua `suggestionSave`), nạp lười, nên màn hình đầu tiên không mang nó (ngân sách gói).
 * Chuyển trạng thái là hàm thuần ở `lib/suggestions/state.ts`; kho chỉ giữ dữ liệu và hai hàm thay.
 */
export interface SuggestionStoreState {
  readonly floorSuggestions: Readonly<Record<string, FloorSuggestions>>;
  /** Thay mục của một tầng. */
  readonly putFloorSuggestions: (floorId: string, entry: FloorSuggestions) => void;
  /** Thay cả bản đồ (nạp dự án N15). */
  readonly replaceFloorSuggestions: (floors: Readonly<Record<string, FloorSuggestions>>) => void;
}

export const useSuggestionStore = create<SuggestionStoreState>()((set) => ({
  floorSuggestions: {},
  putFloorSuggestions: (floorId, entry) => set((state) => ({ floorSuggestions: { ...state.floorSuggestions, [floorId]: entry } })),
  replaceFloorSuggestions: (floorSuggestions) => set({ floorSuggestions }),
}));
