/**
 * "Trang phục" của cảnh Pascal: vật liệu sàn, mặt tường, len chân tường và phào trần.
 *
 * Bản đầu để Pascal tự chọn mặc định, và cảnh ra xám trơn — kém hẳn nhà 3D ở trang
 * đăng nhập. File này là quy tắc gán vật liệu theo phòng, theo loại tường, theo khe
 * mô hình; vật liệu cụ thể lấy từ phong cách đang chọn (`sceneStyles.ts`, J8).
 *
 * Tham chiếu vật liệu theo mô hình khe của Pascal (`viewer/src/lib/materials.ts`):
 * `scene:<id>` trỏ vào `PascalScene.materials`, `library:<id>` trỏ vào thư viện dựng
 * sẵn — chỉ dùng những cái có đủ tệp (`.ktx2` của repo hoặc `.webp` tự dựng, J2).
 */

import type { Furniture, FurnitureId, Room, RoomFinish, RoomUsage, Wall } from '@/domain/spatial/types';
import { millimetres, millimetresToMetres } from '@/domain/units/types';
import { GLASS_MATERIAL_REF, isGlassWall } from '@/domain/walls/glass';
import { INTERIOR_SKIRTING } from '@/pascal-page/realism/details';

import { CATALOG_MODELS, modelHasSlots, modelSrcOf, thumbnailOf } from './furnitureCatalog';
import { bodyOfPascalId, toPascalId } from './ids';
import { RENDER_LOOK_PALETTE, SCENE_PALETTE } from './scenePalette';
import { sceneStyleOf, type SceneStyle, type SlotFamily } from './sceneStyles';
import type {
  PascalCeilingNode,
  PascalItemNode,
  PascalNodeId,
  PascalPoint2,
  PascalSceneMaterial,
  PascalVec3,
  PascalWallNode,
} from './types';

/** Độ đục kính cửa sổ (`mat_appfront_glass`): < 0,6 để Pascal phủ fresnel. */
export const GLASS_OPACITY = 0.25;

const flat = (id: PascalSceneMaterial['id'], name: string, color: string, roughness: number): PascalSceneMaterial => ({
  id,
  name,
  material: {
    preset: 'custom',
    properties: { color, roughness, metalness: 0, opacity: 1, transparent: false, side: 'front' },
  },
});

/**
 * Vật liệu phẳng không theo phong cách, đúng hình `SceneMaterial`
 * (`core/src/schema/scene-material.ts`). Sàn/tường/đồ gỗ nay lấy từ phong cách.
 */
export const SCENE_MATERIALS: readonly PascalSceneMaterial[] = [
  flat('mat_appfront_plaster', 'Trần vữa', SCENE_PALETTE.plaster, 0.9),
  flat('mat_appfront_bark', 'Thân cây', SCENE_PALETTE.bark, 0.9),
  // Kính cửa sổ: trong (đục 0,25) với màu xanh xám nhạt. Dưới ngưỡng 0,6 của Pascal
  // (`viewer/src/lib/materials.ts` GLASS_OPACITY_THRESHOLD) nên được fresnel: nhìn thẳng thấy
  // xuyên, nhìn xiên phản chiếu môi trường. 0,6 cũ ra tấm xám đục. Giữ nguyên id (khe đã lưu trỏ vào).
  {
    id: 'mat_appfront_glass',
    name: 'Kính cửa sổ',
    material: {
      preset: 'custom',
      properties: {
        color: RENDER_LOOK_PALETTE.clayGlazing,
        roughness: 0.02,
        metalness: 0,
        opacity: GLASS_OPACITY,
        transparent: true,
        side: 'front',
      },
    },
  },
  // C6 — viền đồ chưa xác nhận: cam nhạt, đục 0,35 để vẫn thấy sàn bên dưới.
  {
    id: 'mat_appfront_unconfirmed',
    name: 'Đồ chưa xác nhận',
    material: {
      preset: 'custom',
      properties: { color: SCENE_PALETTE.unconfirmed, roughness: 0.8, metalness: 0, opacity: 0.35, transparent: true, side: 'front' },
    },
  },
];

/** Khe của tấm viền đồ chưa xác nhận (C6, `toPascal.suggestedOutlineOf`). */
export const UNCONFIRMED_MATERIAL_REF = 'scene:mat_appfront_unconfirmed';

const GLASS = GLASS_MATERIAL_REF;
/** Kính lan can lô gia (cùng kính tường thấp). */
export const RAILING_GLASS_REF = GLASS;
const PLASTER = 'scene:mat_appfront_plaster';
/** Mặt trần mặc định; `Room.ceilingMaterial` khác cái này thì mới ghi (H4, `toSpatial`). */
export const CEILING_DEFAULT = PLASTER;
const BARK = 'scene:mat_appfront_bark';

/** Phong cách mặc định — tham số mặc định của mọi hàm dưới đây (J8). */
const DEFAULT_STYLE = sceneStyleOf(undefined);

/**
 * Phòng chưa khai `finish`: đoán theo công năng, như căn hộ Việt Nam điển hình (bench-3d P2) —
 * khu sinh hoạt chung (khách, bếp, hành lang) gạch khổ lớn của phong cách nên khách + bếp mở
 * chung một mặt sàn; phòng ngủ và phòng chưa rõ công năng gỗ; WC và lô gia gạch nhỏ chống trơn
 * (`mosaic`). Lô gia KHÔNG đoán `decking`: `decking` khai tường minh mới là sân ngoài trời
 * (không trần, không bày đồ — `ceilingNodesOf`, `sceneFurnish.isOutdoor`).
 */
const USAGE_FINISH: Readonly<Record<RoomUsage, RoomFinish>> = {
  livingRoom: 'tile',
  bedroom: 'wood',
  corridor: 'tile',
  other: 'wood',
  kitchen: 'tile',
  utility: 'tile',
  bathroom: 'mosaic',
  stairwell: 'concrete',
  loggia: 'mosaic',
};

/** Tham chiếu vật liệu mặt sàn của một phòng: `floorMaterial` (W3a) trước, rồi `finish`, rồi công năng. */
export const floorMaterialOf = (
  room: Pick<Room, 'usage' | 'finish' | 'floorMaterial'>,
  style: SceneStyle = DEFAULT_STYLE,
): string => room.floorMaterial ?? style.floor[room.finish ?? USAGE_FINISH[room.usage]];

/** Tường thấp hơn mức này là lan can/vách kính, không phải tường phòng. */
const LOW_WALL_MAX_MM = 1200;
/** Lan can lô gia (QCVN 04:2021/BXD, nhà cao tầng): cao 1,4 m, kính như tường thấp (`toPascal.railingNodeOf`). */
export const LOGGIA_RAILING_MM = 1400;

/**
 * Khe mặt tường + len chân + phào. Mọi trường viết đủ: `setScene` không áp mặc định
 * zod (xem `types.ts`). Mặt `exterior` của tường bao/chịu lực theo sơn ngoài của phong
 * cách; vách ngăn sơn trong cả hai mặt. Tường thấp và tường kính người dùng chọn: không len không phào.
 */
export const wallDressingOf = (
  wall: Pick<Wall, 'kind' | 'heightMm' | 'paint'>,
  style: SceneStyle = DEFAULT_STYLE,
): Pick<PascalWallNode, 'slots' | 'skirting' | 'crown'> => {
  // W3a — sơn người dùng chọn (`Wall.paint`) đè lên phong cách, từng mặt.
  const painted = (interior: string, exterior: string): Readonly<Record<string, string>> => ({
    interior: wall.paint?.interior ?? interior,
    exterior: wall.paint?.exterior ?? exterior,
  });
  if (wall.heightMm <= LOW_WALL_MAX_MM || isGlassWall(wall)) return { slots: painted(GLASS, GLASS) };
  const { interior, exterior } = style.wall;
  return {
    slots: painted(interior, wall.kind === 'partition' ? interior : exterior),
    skirting: { ...INTERIOR_SKIRTING },
    crown: { enabled: true, sides: 'interior', height: 0.09, proud: 0.035, profile: 'crown-cove' },
  };
};

/**
 * Khe `slot_*` của mô hình đồ đạc (tên khe như GLB, `extras.pascal_material`) → họ vật
 * liệu của phong cách. Phủ mọi khe GLB trỏ vào gỗ/gạch (`wood-*`, `flooring-*`) để đồ gỗ
 * đổi theo phong cách, cộng vải/kim loại/tủ/mặt đá/sứ/thảm/chậu cho phong cách khác hẳn.
 * Thân cây (`bark`) không theo phong cách: vân sàn gỗ làm thân cây trông như tấm ván.
 * Chỉ các thư mục `furnitureCatalog.ts` dùng; bài kiểm quét GLB thật để bắt thư mục mới.
 */
const SLOT_FAMILY: Readonly<Record<string, Readonly<Record<string, SlotFamily | 'bark'>>>> = {
  bathtub: { tub: 'ceramic' },
  'bedside-table': { cabinet: 'wood', handle: 'metal' },
  bookshelf: { body: 'wood', shelf: 'wood' },
  // Thân tủ áo vân gỗ: màu sơn tủ phẳng làm tủ cao thành khối be trơn (V5 D2).
  closet: { body: 'wood' },
  // Đồ trang trí AppFront (gen-decor-models.mjs): vải + kim loại theo phong cách.
  curtain: { fabric: 'fabric', metal: 'metal' },
  'curtain-uv': { fabric: 'fabric', metal: 'metal' },
  'coffee-table': { top: 'wood' },
  'dining-chair': { legs: 'wood', seat: 'fabric', headrest: 'fabric' },
  'dining-table': { top: 'wood' },
  dresser: { body: 'wood', drawers: 'wood', handle: 'metal' },
  'fir-tree': { trunk: 'bark' },
  'indoor-plant': { trunk: 'bark', pot: 'pot' },
  'kitchen-cabinet': { cabinet: 'cabinetry', countertop: 'countertop', handle: 'metal' },
  // Mẫu Pascal `kitchen` một vật liệu không có khe; khe dành cho bản realism `kitchen-sink-gen`.
  kitchen: { cabinet: 'cabinetry', countertop: 'countertop', handle: 'metal' },
  'kitchen-counter': { cabinet: 'cabinetry', countertop: 'countertop' },
  'kitchen-shelf': { cabinet: 'cabinetry', handle: 'metal' },
  'livingroom-chair': { pillow: 'fabric', cushion: 'fabric' },
  'office-table': { cabinet: 'wood', handle: 'metal' },
  pillow: { fabric: 'fabric' },
  'pillow-uv': { fabric: 'fabric' },
  palm: { trunk: 'bark' },
  // Tranh: vải dệt treo tường — sứ/đá phẳng làm tranh thành tấm trắng trơn.
  picture: { picture: 'rug' },
  'rectangular-carpet': { a: 'rug' },
  'round-carpet': { a: 'rug' },
  'single-bed': { frame: 'wood' },
  'small-indoor-plant': { pot: 'pot' },
  shelf: { shelf: 'wood' },
  sofa: { pillow: 'fabric', cushion: 'fabric' },
  toilet: { toilet: 'ceramic' },
  'throw-blanket': { fabric: 'fabric' },
  'throw-blanket-uv': { fabric: 'fabric' },
  'tv-stand': { body: 'wood' },
  // Chân đèn cây GLB `preset-espresso` đen → kim loại của phong cách (bench-3d P5); chao be giữ nguyên.
  'floor-lamp': { legs: 'metal' },
  'wall-sconce': { metal: 'metal' },
};

/** Khe đè cho mô hình ở `/items/<folder>/` theo phong cách; `undefined` = để nguyên vật liệu của GLB. */
export const itemSlotsOf = (
  folder: string,
  style: SceneStyle = DEFAULT_STYLE,
): Readonly<Record<string, string>> | undefined => {
  const families = SLOT_FAMILY[folder];
  if (families === undefined || !modelHasSlots(folder)) return undefined;
  return Object.fromEntries(
    Object.entries(families).map(([slot, family]) => [slot, family === 'bark' ? BARK : style.families[family]]),
  );
};

/** Thân id của đèn trần sinh ra: `item_LIGHT-<id phòng>`. Không phải id AppFront hợp lệ. */
const GENERATED_LIGHT_PREFIX = 'LIGHT-';

/** Node này (còn hay đã xoá) là đèn trần AppFront tự sinh — không bao giờ thành đồ đạc. */
export const isGeneratedLightId = (nodeId: PascalNodeId): boolean =>
  bodyOfPascalId(nodeId).startsWith(GENERATED_LIGHT_PREFIX);

/** Thân id của đồ đạc sinh ra (J10): `item_DRESS-<vai trò>-<id neo>[-<n>]`. */
export const GENERATED_DRESS_PREFIX = 'DRESS-';

/** Node AppFront tự sinh (đèn trần hoặc đồ bày biện) — không bao giờ thành dữ liệu của bản vẽ. */
export const isGeneratedNodeId = (nodeId: PascalNodeId): boolean => {
  const body = bodyOfPascalId(nodeId);
  return body.startsWith(GENERATED_LIGHT_PREFIX) || body.startsWith(GENERATED_DRESS_PREFIX);
};

/*
 * Đèn trần không có bản ghi riêng. `Room.dressingOff` (chỉ nhận id `DRESS-…`, không đổi hợp đồng) nhớ hộ:
 * xoá = `DRESS-ceilingLight-<phòng>`. Đèn trần không dời được (`usePascalEdits` chặn).
 */
const LIGHT_OFF_PREFIX = `${GENERATED_DRESS_PREFIX}ceilingLight-`;

export const lightOffIdOf = (roomId: string): string => `${LIGHT_OFF_PREFIX}${roomId}`;

/**
 * Khe duy nhất của tấm viền gợi ý (`rectangular-carpet`). Sơn tấm viền ghi vào `Furniture.slots` dưới khoá này;
 * mẫu thật không có khe đó thì `a` nghĩa là "cả món một màu" (`toPascal` trải ra, `toSpatial` gộp lại).
 */
export const OUTLINE_PAINT_SLOT = 'a';

/** FNV-1a 32 bit, hạt `seed`. */
const fnv = (text: string, seed: number): number => {
  let hash = seed;
  for (let i = 0; i < text.length; i += 1) hash = Math.imul(hash ^ text.charCodeAt(i), 0x01000193) >>> 0;
  return hash;
};

/**
 * Id đồ thật của MỘT món sinh đã nhận (`DRESS-…` của phòng): suy tất định từ id món sinh. Cặp "`dressingOff` có
 * `DRESS-x`" + "đồ thật mang `adoptedFurnitureIdOf('DRESS-x')`" = món ấy đã thành đồ thật, khác với xoá; lớp dẫn xuất
 * của phòng vẫn tính như khi món còn là đồ sinh (`toPascal`). Không đổi hợp đồng dữ liệu. 14 ký tự base36 (~64 bit).
 */
export const adoptedFurnitureIdOf = (dressId: string): FurnitureId => {
  const part = (seed: number): string => fnv(dressId, seed).toString(36).toUpperCase().padStart(7, '0');
  return `F-${part(0x811c9dc5)}${part(0x2b6c1a93)}` as FurnitureId;
};

/**
 * Id các món đã nhận RIÊNG LẺ còn mang mẫu luật chọn, nhận diện chắc chắn: id = `adoptedFurnitureIdOf(d)` với `d` nằm
 * trong `dressingOff` của CHÍNH phòng món ấy, và `model.id` = `appfront-<loại>`. Món đã lưu khác (kể cả `appfront-<loại>`
 * không có cặp) không thuộc tập này.
 */
export const ruleAdoptedIdsOf = (
  rooms: readonly Pick<Room, 'id' | 'dressingOff'>[],
  furniture: readonly Pick<Furniture, 'id' | 'roomId' | 'kind' | 'model'>[],
): Set<string> => {
  const paired = new Map(rooms.flatMap((room) => (room.dressingOff ?? []).map((d) => [adoptedFurnitureIdOf(d) as string, room.id as string] as const)));
  return new Set(
    furniture.filter((f) => paired.get(f.id) === f.roomId && f.model?.id === `appfront-${f.kind}`).map((f) => f.id as string),
  );
};

/** Trường siêu dữ liệu của node món sinh: thư mục mẫu đang dựng (lượt về lưu khi món được nhận). */
export const MODEL_FOLDER_FIELD = 'modelFolder';

/** Node của một id trong `dressIds`/`dressingOff`. */
export const dressNodeIdOf = (dressId: string): PascalNodeId =>
  toPascalId('item', dressId.startsWith(LIGHT_OFF_PREFIX) ? `${GENERATED_LIGHT_PREFIX}${dressId.slice(LIGHT_OFF_PREFIX.length)}` : dressId);

const metresOf = (valueMm: number): number => millimetresToMetres(millimetres(valueMm));

/**
 * Đèn âm trần: màu và cường độ theo phong cách (`lampColour`/`lampIntensity`; mặc định ấm
 * như `--scene-lamp` của trang đăng nhập, 6 cd). Pascal dựng nó thành đèn điểm
 * (`use-item-light-pool.ts`): mặc định trắng, 2 cd, không giới hạn tầm — trên nền `night`
 * gần như không thấy. 6 cd ở trần 2,4 m cho sàn ≈ 1,1 — ngang đèn chính của chủ đề (1,2),
 * đủ thành vũng sáng mà không cháy; tầm 6 m như đèn trần trang đăng nhập.
 */
export const LIGHT_DISTANCE_M = 6;

/**
 * Thu nhỏ vỏ đèn còn 1% (mức nhỏ nhất bảng thuộc tính Pascal cho): nhìn từ trên xuống, trần
 * không vẽ nên vòng đèn 23 cm hiện thành cung trắng ở mọi phòng (V5 D6). Ẩn (`visible: false`)
 * thì tắt luôn đèn (item-light-system.tsx `isRendered`); còn thu nhỏ thì không đổi gì ánh sáng —
 * vị trí đèn = vị trí thế giới của vật + `offset` không nhân tỉ lệ (glb-interactive.tsx), độ
 * sáng/tầm đặt trên đèn của bể chung, không phải con của vật.
 */
export const LIGHT_NODE_SCALE: PascalVec3 = [0.01, 0.01, 0.01];

/**
 * C1 — đèn âm trần là nguồn sáng, không phải món đồ: co thêm riêng mô hình GLB (`asset.scale`,
 * không đụng vị trí/ánh sáng) để lưới không hiện cả khi người dùng phóng tỉ lệ node lên 100%.
 * Không dùng 0: ma trận suy biến. Đèn đã nằm ngoài dữ liệu đồ đạc (`isGeneratedLightId`).
 */
export const LIGHT_MESH_SCALE: PascalVec3 = [0.001, 0.001, 0.001];

/** Bật sẵn đèn: khối `interactive` chép sâu, công tắc `default: true`, ánh sáng theo phong cách. */
const lightInteractiveOf = (interactive: unknown, style: SceneStyle): unknown => {
  const copy = structuredClone(interactive) as {
    controls?: { kind: string; default?: unknown }[];
    effects?: { kind: string; color?: string; intensityRange?: [number, number]; distance?: number }[];
  };

  for (const control of copy.controls ?? []) {
    if (control.kind === 'toggle') control.default = true;
  }

  for (const effect of copy.effects ?? []) {
    if (effect.kind !== 'light') continue;
    effect.color = style.lampColour;
    effect.intensityRange = [0, style.lampIntensity];
    effect.distance = LIGHT_DISTANCE_M;
  }

  return copy;
};

/** Đèn bàn: catalog không khai `interactive` — mượn khối của đèn cây, nguồn sáng ở chụp đèn. */
const TABLE_LAMP_LIGHT_Y_M = 0.55;
/**
 * Đèn bàn/đèn ngủ là đèn hắt dịu, không phải đèn chính (bench-3d P8): cùng cường độ đèn trần
 * và tầm 6 m mà đặt cách tường ~0,3 m thì cháy trắng mảng tường đầu giường. Phần của đèn trần
 * và tầm riêng (m) — núm chỉnh tay.
 */
export const TABLE_LAMP_INTENSITY_SHARE = 0.25;
export const TABLE_LAMP_DISTANCE_M = 2.5;

/**
 * Khối `interactive` (đèn bật sẵn, sáng theo phong cách) cho đồ đạc là đèn; `undefined` = không
 * phải đèn. Chỉ đèn âm trần sinh ra có ánh sáng trước đây — đèn cây/bàn/trần của bản vẽ tối om.
 */
export const lampInteractiveOf = (folder: string, style: SceneStyle = DEFAULT_STYLE): unknown => {
  if (folder === 'table-lamp') {
    const base = structuredClone(CATALOG_MODELS['floor-lamp']?.interactive) as
      | { effects?: { kind: string; offset?: number[] }[] }
      | undefined;
    for (const effect of base?.effects ?? []) if (effect.kind === 'light') effect.offset = [0, TABLE_LAMP_LIGHT_Y_M, 0];
    if (base === undefined) return undefined;
    const lamp = lightInteractiveOf(base, style) as { effects?: { kind: string; intensityRange?: number[]; distance?: number }[] };
    for (const effect of lamp.effects ?? []) {
      if (effect.kind !== 'light') continue;
      effect.intensityRange = [0, style.lampIntensity * TABLE_LAMP_INTENSITY_SHARE];
      effect.distance = TABLE_LAMP_DISTANCE_M;
    }
    return lamp;
  }
  const interactive = CATALOG_MODELS[folder]?.interactive;
  return interactive === undefined ? undefined : lightInteractiveOf(interactive, style);
};

/** Các x nơi cạnh đa giác cắt đường ngang `y`, tăng dần (quy tắc nửa mở: đỉnh không đếm hai lần). */
const crossingsAt = (polygon: readonly PascalPoint2[], y: number): number[] =>
  polygon
    .flatMap(([x1, y1], i) => {
      const [x2, y2] = polygon[(i + 1) % polygon.length]!;
      return y1 <= y === y2 <= y ? [] : [x1 + ((y - y1) * (x2 - x1)) / (y2 - y1)];
    })
    .sort((a, b) => a - b);

/**
 * Một điểm chắc chắn nằm trong đa giác: trọng tâm diện tích nếu nó ở trong, không thì
 * giữa đoạn trong dài nhất của đường ngang qua trọng tâm (phòng chữ L/chữ U).
 */
export const interiorPointOf = (polygon: readonly PascalPoint2[]): PascalPoint2 => {
  let area = 0;
  let cx = 0;
  let cy = 0;

  polygon.forEach(([x1, y1], i) => {
    const [x2, y2] = polygon[(i + 1) % polygon.length]!;
    const cross = x1 * y2 - x2 * y1;
    area += cross;
    cx += (x1 + x2) * cross;
    cy += (y1 + y2) * cross;
  });

  if (area === 0) return polygon[0]!;
  cx /= 3 * area;
  cy /= 3 * area;

  const xs = crossingsAt(polygon, cy);
  let best: PascalPoint2 = [cx, cy];
  let bestWidth = 0;

  // Chẵn-lẻ: cặp (xs[0], xs[1]), (xs[2], xs[3])… là các đoạn nằm trong đa giác.
  for (let i = 0; i + 1 < xs.length; i += 2) {
    const [left, right] = [xs[i]!, xs[i + 1]!];
    if (cx > left && cx < right) return [cx, cy];
    if (right - left > bestWidth) [best, bestWidth] = [[(left + right) / 2, cy], right - left];
  }

  return best;
};

/**
 * Trần + một đèn âm trần cho mỗi phòng, như nhà mẫu ở trang đăng nhập có trần và đèn ấm.
 * Trần là con của tầng, cao theo đỉnh tầng (không khai `height`); đèn là con của trần,
 * `y = 0` trong khung trần, `x/z` theo toạ độ tầng (`placement-strategies.ts:740-757`).
 * Cả hai sinh ra từ phòng nên lượt về bỏ qua chúng (`toSpatial` chỉ đọc con của tầng,
 * `fromPascal` coi chúng là kết cấu). Phòng sàn `decking` là sân ngoài trời: không trần,
 * không đèn — trần che nắng làm sân tối đen. Chưa khai `finish` thì không biết phòng nào
 * ngoài trời (`RoomUsage` không có ban công) nên phòng nào cũng có trần.
 */
export const ceilingNodesOf = (
  room: Pick<Room, 'id' | 'outline' | 'finish' | 'ceilingMaterial'>,
  levelNodeId: PascalNodeId,
  style: SceneStyle = DEFAULT_STYLE,
): readonly [PascalCeilingNode, PascalItemNode] | undefined => {
  if (room.finish === 'decking') return undefined;

  const ceilingId = toPascalId('ceiling', room.id);
  const lightId = toPascalId('item', `${GENERATED_LIGHT_PREFIX}${room.id}`);
  const polygon = room.outline.map((point): PascalPoint2 => [metresOf(point.x), metresOf(point.y)]);
  const [lightX, lightZ] = interiorPointOf(polygon);
  const model = CATALOG_MODELS['recessed-light'];

  if (model === undefined) throw new Error('bảng mô hình thiếu recessed-light');

  return [
    {
      object: 'node',
      id: ceilingId,
      type: 'ceiling',
      parentId: levelNodeId,
      children: [lightId],
      polygon,
      holes: [],
      holeMetadata: [],
      autoFromWalls: false,
      slots: { surface: room.ceilingMaterial ?? PLASTER },
    },
    {
      object: 'node',
      id: lightId,
      type: 'item',
      parentId: ceilingId,
      metadata: { generated: 'light' },
      position: [lightX, 0, lightZ],
      rotation: [0, 0, 0],
      scale: LIGHT_NODE_SCALE,
      asset: {
        id: model.folder,
        category: 'lighting',
        name: 'Đèn âm trần',
        thumbnail: thumbnailOf(model.folder),
        src: modelSrcOf(model.folder),
        dimensions: model.dimensions,
        offset: model.offset,
        rotation: model.rotation,
        scale: LIGHT_MESH_SCALE,
        attachTo: 'ceiling',
        recessed: true,
        interactive: lightInteractiveOf(model.interactive, style),
      },
    },
  ];
};
