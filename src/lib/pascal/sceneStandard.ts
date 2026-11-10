/**
 * Cảnh chuẩn — một bộ luật cho mọi đường vào 3D (editor3d, di động `/m/du-an/:id`, so phiên bản trực quan): tự bày bật
 * như editor3d khi dự án chưa có concept (`furnishModeOf(undefined) === 'on'` ở bridge) và sửa cảnh cho đồ AI chưa xác
 * nhận (`repairScene`). Tách khỏi `toPascal.ts` để tránh import vòng toPascal ↔ sceneRepair.
 */

import type { SpatialGraph } from '@/domain/spatial/types';

import { ALL_SCENE_RULES_OFF, SCENE_RULES_OFF, type SceneRepair } from './sceneLayer';
import { repairScene, repairsById } from './sceneRepair';
import { sceneStyleOf } from './sceneStyles';
import type { LayerStyle } from './sceneVariety';
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
  const style: LayerStyle = { ...(sceneOptions.style ?? sceneStyleOf(undefined)), rulesOff: raw ? ALL_SCENE_RULES_OFF : SCENE_RULES_OFF };

  return { ...toPascalScene(fixed.graph, { furnish: 'on', ...sceneOptions, style, repairs: repairsById(fixed.repairs) }), repairs: fixed.repairs };
};
