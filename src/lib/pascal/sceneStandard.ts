/**
 * Cảnh chuẩn — một bộ luật cho mọi đường vào 3D (editor3d, di động `/m/du-an/:id`, so phiên bản trực quan): tự bày bật
 * như editor3d khi dự án chưa có concept (`furnishModeOf(undefined) === 'on'` ở bridge) và sửa cảnh cho đồ AI chưa xác
 * nhận (`repairScene`). Tách khỏi `toPascal.ts` để tránh import vòng toPascal ↔ sceneRepair.
 */

import type { SpatialGraph } from '@/domain/spatial/types';

import { ruleAdoptedIdsOf } from './sceneDressing';
import { ALL_SCENE_RULES_OFF, SCENE_RULES_OFF, type SceneRepair } from './sceneLayer';
import { repairScene, repairsById } from './sceneRepair';
import { sceneStyleOf } from './sceneStyles';
import { woodToneOf, type LayerStyle } from './sceneVariety';
import { furnishingUsageOf } from './structureFixes';
import { toPascalScene } from './toPascal';

/**
 * `repairs` truyền sẵn (bridge: đã chạy `repairScene` + chốt) thì đồ thị coi như đã sửa, không sửa lại;
 * không truyền thì tự chạy `repairScene`. Trả thêm danh sách sửa đã áp. `raw` ("Hiện dữ liệu gốc") tắt sửa cảnh và
 * mọi luật lớp cảnh vòng 6 (`SCENE_RULES`); ngoài ra từng luật tắt riêng bằng `?disable=`.
 */
export const standardSceneOf = (
  graph: SpatialGraph,
  options: Parameters<typeof toPascalScene>[1] & { readonly raw?: boolean } = {},
): ReturnType<typeof toPascalScene> & { readonly repairs: readonly SceneRepair[] } => {
  const { raw = false, ...sceneOptions } = options;
  const fixed =
    sceneOptions.repairs !== undefined ? { graph, repairs: [...sceneOptions.repairs.values()] } : raw ? { graph, repairs: [] } : repairScene(graph);
  const base = sceneOptions.style ?? sceneStyleOf(undefined);
  const rulesOff = raw ? ALL_SCENE_RULES_OFF : SCENE_RULES_OFF;
  // Luật `tone` (C): tông gỗ của căn tính MỘT lần từ đồ có sẵn (đã sửa cảnh), chỉ áp cho đồ sinh.
  const usageOf = new Map(fixed.graph.rooms.map((r) => [r.id as string, furnishingUsageOf(r)]));
  const adoptedRule = ruleAdoptedIdsOf(fixed.graph.rooms, fixed.graph.furniture);
  const woodTone = rulesOff.has('tone')
    ? undefined
    : woodToneOf(
        fixed.graph.furniture
          // Món đã nhận còn mẫu luật chọn (cặp chắc chắn): vẫn là đồ dẫn xuất với tông căn, như trước khi nhận.
          .filter((f) => f.suggested !== true && !adoptedRule.has(f.id))
          .map((f) => {
            const usage = f.roomId === undefined ? undefined : usageOf.get(f.roomId);
            return usage === undefined ? { f } : { f, usage };
          }),
        base,
      );
  // "Hiện dữ liệu gốc" tắt cả bộ nội thất theo phòng (`roomset`), như bốn luật lớp cảnh.
  const style: LayerStyle = { ...base, rulesOff, ...(woodTone === undefined ? {} : { woodTone }), ...(raw ? { roomSet: false } : {}) };

  return { ...toPascalScene(fixed.graph, { furnish: 'on', ...sceneOptions, style, repairs: repairsById(fixed.repairs) }), repairs: fixed.repairs };
};
