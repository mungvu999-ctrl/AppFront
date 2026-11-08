import type { FloorLayerSaver, FloorLayerSaverPorts } from '../lib/autosave/spatialLayerSave';
import { storeReceived, suggestionBodyOf, watchSuggestions } from '../lib/suggestions/state';
import { useStore } from './index';
import { useSuggestionStore } from './suggestionStore';

/**
 * M2 — phần lớp đề xuất của bộ tự lưu. `commit.ts` tái xuất nó nên nó nằm trong chunk nạp lười của `commit`
 * (`useAutosave.loadPipes` đã nạp chunk ấy): không thêm `import()` hay chunk dùng chung nào vào chunk vào.
 *
 * `withSuggestions(create)`: bọc `createFloorLayerSaver` — thân #35 mang phần lớp đề xuất của tầng
 * (`readSuggestionBody`), kết quả #35 vào kho lớp đề xuất (bản tại máy còn sửa chưa gửi thì giữ); theo dõi kho tới
 * khi `dispose`: tầng có sửa lớp đề xuất → `ports.onSuggestionTouched`, sửa đồ thị → đánh dấu món nhận nuôi.
 */
export const withSuggestions =
  (create: (projectId: string, ports: FloorLayerSaverPorts) => FloorLayerSaver) =>
  (projectId: string, ports: FloorLayerSaverPorts): FloorLayerSaver => {
      const saver = create(projectId, {
        ...ports,
        readSuggestionBody: (floorId) => suggestionBodyOf(useSuggestionStore.getState().floorSuggestions[floorId]),
        onSaved(floorId, result, info) {
          // Lượt xả muộn sau khi đổi dự án: kho lớp đề xuất giờ là của dự án khác, không ghi vào.
          if (useStore.getState().spatialProjectId === projectId) storeReceived(useSuggestionStore, floorId, result, !info.redirtied);
          ports.onSaved(floorId, result, info);
        },
      });
      const stop = watchSuggestions(useStore, useSuggestionStore, (floorIds) => ports.onSuggestionTouched?.(floorIds));
      return {
        ...saver,
        dispose() {
          stop();
          saver.dispose();
        },
      };
    };
