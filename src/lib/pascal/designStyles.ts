/**
 * AID-01 — 12 phong cách nội thất mà AI dựng thành một `SceneStyle` riêng cho căn
 * (`docs/ai-design-director/HOP-DONG-AID-01.md`). Kết quả AI không ghi vào bản vẽ: trường người
 * dùng đã đặt (`Room.floorMaterial`, `Wall.paint`, `Furniture.model`) vẫn thắng phong cách ở `toPascal`.
 */

import type { DesignAddition, DesignResult, DesignStyleId } from '@/api/schemas/designConcept';
import type { Furniture, FurnitureId, LevelId, RoomId } from '@/domain/spatial/types';
import { degrees, millimetres } from '@/domain/units/types';

import { CATALOG_MODELS } from './furnitureCatalog';
import { rectOfFurniture, rectsOverlap } from './placement';
import { GENERATED_DRESS_PREFIX } from './sceneDressing';
import type { SceneStyle } from './sceneStyles';
import { roleOf, type FurnitureRole } from './sceneVariety';

const isRug = (f: Furniture): boolean => {
  const role = roleOf(f);
  return role === 'rug' || role === 'roundRug';
};

/**
 * Đồ AI bổ sung → `Furniture` sinh ra (id `DRESS-ai-<roomId>-<n>`, `isGeneratedNodeId` giữ chúng ngoài lượt
 * lưu). Món đè lên đồ đã có hoặc món AI trước nó (cùng tầng) bị bỏ im lặng; thảm nằm dưới đồ nên không
 * chặn và không bị chặn. `modelId` có trong danh mục → mẫu ấy, không thì mẫu theo vai trò như đồ tự bày.
 */
export const designAdditionsOf = (
  additions: readonly DesignAddition[],
  existing: readonly Furniture[],
): Furniture[] => {
  const out: Furniture[] = [];
  const perRoom = new Map<string, number>();
  for (const addition of additions) {
    const n = (perRoom.get(addition.roomId) ?? 0) + 1;
    perRoom.set(addition.roomId, n);
    const { x, y } = addition.centre;
    const mm = (dx: number, dy: number) => ({ x: millimetres(x + dx), y: millimetres(y + dy) });
    const [hw, hd] = [addition.widthMm / 2, addition.depthMm / 2];
    const item: Furniture = {
      id: `${GENERATED_DRESS_PREFIX}ai-${addition.roomId}-${String(n)}` as FurnitureId,
      levelId: addition.levelId as LevelId,
      roomId: addition.roomId as RoomId,
      kind: addition.kind,
      ...(addition.variant == null ? {} : { variant: addition.variant }),
      ...(addition.modelId != null &&
      Object.prototype.hasOwnProperty.call(CATALOG_MODELS, addition.modelId)
        ? { model: { id: addition.modelId, src: `/items/${addition.modelId}/model.glb` } }
        : {}),
      centre: mm(0, 0),
      boundingBox: { min: mm(-hw, -hd), max: mm(hw, hd) },
      rotationDeg: degrees(addition.rotationDeg),
      source: 'ai',
      reviewed: false,
      confidence: 1,
    };
    const rect = rectOfFurniture(item);
    const blocked =
      !isRug(item) &&
      [...existing, ...out].some(
        (other) =>
          other.levelId === item.levelId &&
          !isRug(other) &&
          rectsOverlap(rect, rectOfFurniture(other)),
      );
    if (!blocked) out.push(item);
  }
  return out;
};

export const DESIGN_STYLE_LABELS: Readonly<Record<DesignStyleId, string>> = {
  japandi: 'Japandi',
  scandinavian: 'Scandinavian',
  'modern-min': 'Hiện đại tối giản',
  'modern-lux': 'Hiện đại sang trọng',
  indochine: 'Indochine',
  'wabi-sabi': 'Wabi-sabi',
  industrial: 'Industrial',
  tropical: 'Nhiệt đới hiện đại',
  'korean-min': 'Hàn Quốc tối giản',
  neoclassic: 'Tân cổ điển',
  midcentury: 'Mid-century',
  rustic: 'Rustic',
};

/**
 * `SceneStyle` của một concept đã xong: sàn trộn lên `base`, sơn tường theo AI (mặt ngoài vắng = của
 * `base`), mẫu đồ AI chọn đứng đầu `prefer` của vai trò — chỉ mẫu có trong danh mục (đóng gói hoặc
 * thư viện máy chủ đã gộp), mẫu lạ bỏ qua và vai trò giữ ưu tiên của `base`.
 */
export const sceneStyleFromConcept = (result: DesignResult, base: SceneStyle, styleId?: DesignStyleId): SceneStyle => {
  const prefer: Partial<Record<FurnitureRole, readonly string[]>> = { ...base.prefer };
  for (const [role, modelId] of Object.entries(result.models)) {
    if (Object.prototype.hasOwnProperty.call(CATALOG_MODELS, modelId))
      prefer[role as FurnitureRole] = [modelId];
  }

  return {
    ...base,
    label: result.nameVi,
    // ponytail: phần còn lại (đèn, họ vật liệu đồ) theo `base`; AI chưa chọn chúng.
    floor: { ...base.floor, ...result.floor },
    wall: { interior: result.wall.interior, exterior: result.wall.exterior ?? base.wall.exterior },
    prefer,
    // Kiểu AI chọn đứng đầu: mọi món thư viện còn lại của căn theo cùng kiểu, không chỉ các vai trò AI chọn mẫu.
    ...(styleId === undefined ? {} : { libraryStyles: [styleId, ...(base.libraryStyles ?? [])] }),
  };
};
