/**
 * AppFront → Pascal: đồ thị không gian thành cảnh `{ nodes, rootNodeIds }`.
 *
 * Chuyển **sáu** loại đối tượng — tầng, tường, cửa đi, cửa sổ, phòng, đồ đạc —
 * thành **bảy** loại node, cộng hai node tổng hợp là khu đất và công trình. Một
 * phòng ra hai node: `zone` là khối không gian, `slab` là mặt sàn thật nhìn
 * thấy được. Trục định vị, kích thước và ghi chú **không** có loại node tương
 * ứng bên Pascal, nên chúng vào danh sách bỏ qua kèm lý do đọc được, chứ không
 * biến mất im lặng.
 *
 * ## Ba luật của file này
 *
 * 1. **Không đối tượng nào rơi không dấu vết.** Mọi thứ không sang được đều có
 *    một dòng trong `skipped`. Phép đếm `skipped.length + số node đã viết` phải
 *    khớp với số đối tượng vào — đó là điều bài kiểm đối chiếu.
 * 2. **Không ném lỗi.** Dữ liệu hỏng (toạ độ vô hạn, tầng không tồn tại) là
 *    chuyện thường của một bản vẽ đang dò dở, nên nó thành một dòng bỏ qua.
 *    Các hàm đơn vị của `domain/units` ném `RangeError` trên số không hữu hạn,
 *    nên mọi giá trị đều qua `isUsable` **trước** khi đổi đơn vị.
 * 3. **Mọi quy đổi đơn vị đi qua `domain/units`** (R-44). Không có `/ 1000` nào
 *    viết tay trong file này.
 */

import type { DesignAddition } from '@/api/schemas/designConcept';
import { describeUsage } from '@/domain/rooms/classify';
import { arcApex } from '@/domain/spatial/arc';
import type {
  Axis,
  Building,
  Furniture,
  FurnitureId,
  FurnitureKind,
  Level,
  Opening,
  Room,
  RoomUsage,
  Segment,
  SpatialGraph,
  Wall,
} from '@/domain/spatial/types';
import { degrees, degreesToRadians, millimetres, millimetresToMetres } from '@/domain/units/types';
import { isGlassWall } from '@/domain/walls/glass';
import { FURNITURE_KIND_LABELS, WALL_KIND_LABELS } from '@/lib/commands/business/shared';
import { applyBuildx } from '@/pascal-page/realism/buildx';
import { EXTERIOR_SKIRTING, isDetailsEnabled } from '@/pascal-page/realism/details';

import { designAdditionsOf } from './designStyles';
import { applyFloorTransforms, floorDisplayTransformsOf } from './floorAlignment';
import { CATALOG_MODELS, VARIANT_MODEL, isServerModel, modelSrcOf, thumbnailOf } from './furnitureCatalog';
import { bodyOfPascalId, BUILDING_NODE_ID, SITE_NODE_ID, toPascalId } from './ids';
import { expandKitchenRuns, isKitchenRunHost, KITCHEN_RUN_ID_PREFIX } from './kitchenRuns';
import { libRoles2Apply, libRoles2LampOf } from './libraryRoles2';
import { loggiaOpenSpansOf } from './loggiaRailing';
import { isAutoFaced, orientDetectedFurniture } from './orientDetected';
import { roofNodesOf } from './roofs';
import { insideOutline, swingDirectionOf } from './swingDirection';
import {
  ceilingNodesOf,
  floorMaterialOf,
  adoptedFurnitureIdOf,
  ruleAdoptedIdsOf,
  isGeneratedLightId,
  isGeneratedNodeId,
  lightOffIdOf,
  itemSlotsOf,
  MODEL_FOLDER_FIELD,
  OUTLINE_PAINT_SLOT,
  lampInteractiveOf,
  GENERATED_DRESS_PREFIX,
  LOGGIA_RAILING_MM,
  RAILING_GLASS_REF,
  SCENE_MATERIALS,
  UNCONFIRMED_MATERIAL_REF,
  wallDressingOf,
} from './sceneDressing';
import { SCENE_STYLE_MATERIALS, sceneStyleOf, type SceneStyle } from './sceneStyles';
import { dressingOf, hostTopMm } from './sceneDressingRules';
import { furnishEmptyRooms } from './sceneFurnish';
import {
  PROV_FIELD,
  provenanceOf,
  REPAIR_FIELD,
  SCENE_LAYER_VERSION,
  type SceneLayerSummary,
  type SceneProvenance,
  type SceneRepair,
} from './sceneLayer';
import { furnishingUsageOf, isPlausibleStair, lShapedRunArms, orphanWallIds, weldWallEnds } from './structureFixes';
import { ROOMSET_VERSION, roomSetKeysOf } from './roomSet';
import { addRoomSetMembers, contextRolesOf, isThinHob, isThinSink, modelFolderOf, roleOf, roomSetSwapOf, setRoomSetKeys, withoutOverlaps } from './sceneVariety';
import type {
  AppFrontOrigin,
  PascalDoorNode,
  PascalItemNode,
  PascalLevelNode,
  PascalNode,
  PascalNodeId,
  PascalPoint2,
  PascalSiteNode,
  PascalSlabNode,
  PascalStairNode,
  PascalStairSegmentNode,
  PascalStructuralGridNode,
  PascalVec3,
  PascalWallNode,
  PascalWindowNode,
  PascalZoneNode,
  SkippedEntity,
  PascalSceneResult,
} from './types';

/** Số điểm tối thiểu để một đường bao là một đa giác. */
const MIN_OUTLINE_POINTS = 3;

/**
 * Khoảng lùi từ mép công trình ra mép khu đất, mét: khu đất là cái đế dưới ngôi nhà (nhận
 * bóng đổ, màu nền chủ đề `RENDER_LOOK_PALETTE.ground`), rộng hơn công trình 2,5 m mỗi phía.
 */
const SITE_MARGIN_M = 2.5;

/** Nửa cạnh khu đất khi bản vẽ chưa có hình học nào, mét — bằng mặc định của lược đồ Pascal. */
const SITE_FALLBACK_HALF_SIZE_M = 15;

/**
 * Chiều cao DANH NGHĨA của từng loại đồ đạc, milimét.
 *
 * `Furniture` của AppFront chỉ lưu hộp bao mặt bằng, không lưu chiều cao. Bản
 * đầu vì thế đặt chiều cao 0 — và 0 không phải "chưa biết", nó là một hộp dày
 * 0 mm: `PreviewModel` (`nodes/item/renderer.tsx:521`) dựng
 * `boxGeometry [w, h, d]` nên đồ đạc ra một tờ giấy không nhìn thấy.
 *
 * Bảng này là **số danh nghĩa, không phải số đo**, và nó không bao giờ đi
 * ngược về đồ thị: lượt về dựng lại hộp bao từ `metadata.appfront.boundingBox`
 * và `boxAround` chỉ đọc `dimensions[0]` với `dimensions[2]`
 * (`toSpatial.ts:294-302`), nên chiều cao bịa ở đây không thể nhiễm vào dữ
 * liệu người dùng.
 *
 * `stair` không có trong bảng: một thang chiếm trọn chiều cao tầng, và chiều
 * cao tầng thì đồ thị CÓ lưu — nên nó lấy số thật thay vì số danh nghĩa.
 */
// ponytail: chiều cao danh nghĩa theo loại. Ngày nào `Furniture` có `heightMm`
// thì bảng này biến mất và `heightOfFurniture` đọc thẳng trường ấy.
const FURNITURE_HEIGHT_MM: Readonly<Record<Exclude<FurnitureKind, 'stair'>, number>> = {
  table: 750,
  chair: 850,
  bed: 500,
  wardrobe: 2000,
  kitchenCabinet: 850,
  sanitaryFixture: 800,
  washingMachine: 850,
  shower: 2000,
  other: 800,
};

/** Bề dày tấm sàn, mét — mặc định của chính lược đồ Pascal. */
const SLAB_THICKNESS_M = 0.05;

/** Một độ dài hữu hạn — điều kiện để được đổi sang mét mà không ném lỗi. */
const isUsable = (...values: readonly number[]): boolean => values.every(Number.isFinite);

/** Milimét sang mét, qua đúng cửa của `domain/units`. */
const metresOf = (valueMm: number): number => millimetresToMetres(millimetres(valueMm));

/**
 * Góc mặt bằng của AppFront thành góc quanh trục `y` của Pascal.
 *
 * Đảo dấu: Pascal dựng tường bằng `setFromAxisAngle(yAxis, -atan2(dz, dx))`,
 * nên một góc mặt bằng θ ngược chiều kim đồng hồ là `-θ` trong hệ của nó.
 */
const yawOf = (valueDeg: number): number => -degreesToRadians(degrees(valueDeg));

/** Siêu dữ liệu gốc của một đối tượng, phần mọi loại đều có. */
const originOf = (
  entity: { confidence: number; source: Building['source']; reviewed: boolean },
  fields?: Readonly<Record<string, unknown>>,
): AppFrontOrigin => ({
  confidence: entity.confidence,
  source: entity.source,
  reviewed: entity.reviewed,
  ...(fields === undefined ? {} : { fields }),
});

const skip = (id: string, kind: string, reason: string): SkippedEntity => ({ id, kind, reason });

/** Thêm trường vào `metadata.appfront.fields` (lớp cảnh v1); node chưa có `appfront` (đèn trần) thì mang khung trung tính. */
const withFields = <N extends PascalNode>(node: N, extra: Readonly<Record<string, unknown>>): N => {
  const origin: AppFrontOrigin = node.metadata?.appfront ?? { confidence: 1, source: 'ai', reviewed: false };
  return { ...node, metadata: { ...node.metadata, appfront: { ...origin, fields: { ...origin.fields, ...extra } } } };
};

/** Món `roomset` đổi mẫu: ghi `prov.model` (đồ sinh giữ luật sinh; đồ AI mang prov hạng `ai`). */
const withRoomSetProv = <N extends PascalNode>(node: N, furnitureId: string): N => {
  const swap = roomSetSwapOf(furnitureId);
  if (swap === undefined) return node;
  const prov = (node.metadata?.appfront?.fields?.[PROV_FIELD] as SceneProvenance | undefined) ?? { cls: 'ai', rule: 'roomset', version: SCENE_LAYER_VERSION };
  return withFields(node, { [PROV_FIELD]: { ...prov, model: { rule: 'roomset', version: ROOMSET_VERSION, from: swap.from } } });
};

/** Vai nhúng trong id món sinh `DRESS-<vai>-…`. */
const roleInId = (id: string): string => id.slice(GENERATED_DRESS_PREFIX.length).split('-')[0] ?? '';

/** Id chủ dài nhất nằm trong id món sinh (`DRESS-tableLamp-DRESS-nightstand-R-1` → `DRESS-nightstand-R-1`, không phải `R-1`). */
const hostIn = (id: string, pool: readonly string[]): string | undefined =>
  pool.filter((hostId) => hostId !== id && id.includes(hostId)).sort((a, b) => b.length - a.length)[0];

/** Họ luật chạy ở MỌI lượt (không phụ thuộc `furnish`/`additions`): id của chúng vắng mặt = phần tử gốc đã mất. */
const ALWAYS_RUN_PREFIXES = [
  `${GENERATED_DRESS_PREFIX}railing-`,
  `${GENERATED_DRESS_PREFIX}runLeg-`,
  KITCHEN_RUN_ID_PREFIX,
  lightOffIdOf(''),
];
const AI_ID_PREFIX = `${GENERATED_DRESS_PREFIX}ai-`;

/* -------------------------------------------------------------------------- */
/* Tầng.                                                                       */
/* -------------------------------------------------------------------------- */

/**
 * Phần cộng thêm để tầng rơi đúng cao độ AppFront lưu.
 *
 * Pascal **không** lưu cao độ tuyệt đối. Nó xếp chồng theo số thứ tự tăng dần:
 * `baseY = (cao độ đáy của tầng dưới + chiều cao tầng dưới) + baseElevation`
 * (`services/storey.js:62-70`). Muốn `baseY` ra đúng `elevationMm` thì phần
 * cộng thêm phải là **hiệu** giữa cao độ muốn có và đỉnh của tầng ngay dưới —
 * tầng thấp nhất lấy nguyên cao độ của chính nó vì dưới nó không có gì.
 *
 * Viết cách khác cũng được, nhưng phải viết: bỏ trống `baseElevation` là ngầm
 * tuyên bố các tầng khít nhau, và một công trình có tum hay tầng lửng sẽ trôi.
 */
const baseElevationsOf = (ordered: readonly Level[]): readonly number[] => {
  const offsets: number[] = [];
  let topOfLevelBelow = 0;

  for (const level of ordered) {
    const elevation = metresOf(level.elevationMm);

    offsets.push(elevation - topOfLevelBelow);
    topOfLevelBelow = elevation + metresOf(level.heightMm);
  }

  return offsets;
};

const levelNodeOf = (
  level: Level,
  baseElevation: number,
  children: readonly PascalNodeId[],
): PascalLevelNode => ({
  object: 'node',
  id: toPascalId('level', level.id),
  type: 'level',
  name: level.name,
  parentId: BUILDING_NODE_ID,
  children,
  level: level.order,
  baseElevation,
  height: metresOf(level.heightMm),
  // Không chép `order` và `elevationMm` vào đây: `level` và `baseElevation`
  // của chính node đã mang đủ hai thứ ấy, và lượt về tính lại bằng đúng luật
  // xếp chồng của Pascal. Chép thêm một bản là dựng hai nguồn sự thật có thể
  // cãi nhau — cùng lý do `AppFrontOrigin` không có trường `id`.
  metadata: {
    appfront: originOf(level, {
      ...(level.areaM2 === undefined ? {} : { areaM2: level.areaM2 }),
      ...(level.scaleMillimetresPerPixel === undefined
        ? {}
        : { scaleMillimetresPerPixel: level.scaleMillimetresPerPixel }),
    }),
  },
});

/* -------------------------------------------------------------------------- */
/* Tường và ô mở.                                                              */
/* -------------------------------------------------------------------------- */

/** Tên node tường trên cây Pascal — thiếu `name` thì Pascal tự điền "Wall" (A6). */
// Mã tường là khoá nội bộ (vd. W-000101FIXTURE0), không hiển thị: tên là loại + số thứ tự trong tầng.
const wallNodeNameOf = (wall: Wall, ordinal: number): string => {
  const kindLabel = WALL_KIND_LABELS[wall.kind];
  return `${kindLabel.charAt(0).toUpperCase()}${kindLabel.slice(1)} ${ordinal}`;
};

/**
 * Mặt nào của tường quay ra ngoài nhà, như `resolveWallSurfaceSides` của Pascal
 * (`core/src/lib/space-detection.ts:829-875`): từ điểm giữa trục lùi `dày/2 + 80 mm` về hai
 * phía theo pháp tuyến `perp(end - start)`; đúng một phía nằm trong phòng thì phía ấy là
 * `interior`. Pascal chỉ tự tính khi tường được sửa trong phiên, cảnh vừa nạp giữ `unknown`
 * → `cutaway` không ẩn bức nào (`wall-cutout-cache.ts:83-94`) và sơn ngoài luôn dán mặt sau.
 * Vách giữa hai phòng (cả hai phía trong) để trống như Pascal: vẫn đứng nguyên. Sân decking
 * tính là ngoài nhà, như `swingDirectionOf`.
 */
const wallSidesOf = (wall: Wall, rooms: readonly Room[]): Pick<PascalWallNode, 'frontSide' | 'backSide'> => {
  const { start, end } = wall.centreline;
  const length = Math.hypot(end.x - start.x, end.y - start.y);
  if (!(length > 0)) return {};
  const normal = { x: -(end.y - start.y) / length, y: (end.x - start.x) / length };
  const reach = wall.thicknessMm / 2 + 80;
  // Tường cong dò ở đỉnh cung (trung điểm dây − s·n), không ở trung điểm dây nằm ngoài thân tường.
  const mid = arcApex(start, end, wall.curveOffsetMm);
  const inside = (sign: number): boolean => {
    const p = { x: mid.x + normal.x * reach * sign, y: mid.y + normal.y * reach * sign };
    return rooms.some((r) => r.levelId === wall.levelId && r.finish !== 'decking' && insideOutline(p, r.outline));
  };
  const front = inside(1);
  const back = inside(-1);
  if (front === back) return {};
  return { frontSide: front ? 'interior' : 'exterior', backSide: back ? 'interior' : 'exterior' };
};

/**
 * Lan can lô gia: tường bao thẳng, không ô mở, một phía là phòng `loggia`, phía kia ngoài căn (không
 * phòng nào). Dò như `wallSidesOf`. Người dùng đã chọn tường kính thì giữ tường kính cao đủ tầng.
 */
export const isLoggiaRailing = (wall: Wall, rooms: readonly Room[], hasOpenings: boolean): boolean => {
  if (wall.kind !== 'envelope' || hasOpenings || wall.curveOffsetMm || isGlassWall(wall)) return false;
  const { start, end } = wall.centreline;
  const length = Math.hypot(end.x - start.x, end.y - start.y);
  if (!(length > 0)) return false;
  const normal = { x: -(end.y - start.y) / length, y: (end.x - start.x) / length };
  const reach = wall.thicknessMm / 2 + 80;
  const mid = { x: (start.x + end.x) / 2, y: (start.y + end.y) / 2 };
  const roomsAt = (sign: number): Room[] => {
    const p = { x: mid.x + normal.x * reach * sign, y: mid.y + normal.y * reach * sign };
    return rooms.filter((r) => r.levelId === wall.levelId && insideOutline(p, r.outline));
  };
  const [front, back] = [roomsAt(1), roomsAt(-1)];
  const loggia = (side: Room[]): boolean => side.some((r) => r.usage === 'loggia');
  return (loggia(front) && back.length === 0) || (loggia(back) && front.length === 0);
};

/** Bề dày tấm lan can ở mép không có tường để lấy số. */
const OPEN_RAILING_THICKNESS_MM = 100;

/**
 * Lan can kính 1,4 m thay chỗ tường bao lô gia, chỉ ở hiển thị: node tường thật giữ nguyên số đo
 * (lượt về đọc `height` của tường) nhưng ẩn; lan can là đồ sinh ra `DRESS-`, chỉ lưu khi người dùng sửa (thành đồ thật) hoặc xoá (`dressingOff`).
 */
const railingNodeOf = (
  { anchor, levelId, start, end, thicknessMm }: { anchor: string; levelId: Wall['levelId'] } & Segment & { thicknessMm: number },
  levelNodeId: PascalNodeId,
  levelHeightMm: number,
  style: SceneStyle,
): PascalItemNode => {
  const length = Math.hypot(end.x - start.x, end.y - start.y);
  const half = { x: length / 2, y: thicknessMm / 2 };
  const node = itemNodeOf(
    {
      id: `${GENERATED_DRESS_PREFIX}railing-${anchor}` as FurnitureId,
      levelId,
      kind: 'other',
      centre: { x: (start.x + end.x) / 2, y: (start.y + end.y) / 2 },
      boundingBox: { min: { x: -half.x, y: -half.y }, max: { x: half.x, y: half.y } },
      rotationDeg: degrees((Math.atan2(end.y - start.y, end.x - start.x) * 180) / Math.PI),
      heightMm: millimetres(Math.min(LOGGIA_RAILING_MM, levelHeightMm)),
      confidence: 1,
      source: 'human',
      reviewed: true,
    } as Furniture,
    levelNodeId,
    levelHeightMm,
    style,
    undefined,
    0,
    'rectangular-carpet',
  );
  const slots = Object.fromEntries(Object.keys(node.slots ?? { a: '' }).map((key) => [key, RAILING_GLASS_REF]));
  return { ...node, name: 'Lan can lô gia', slots, metadata: { ...node.metadata, generated: 'part' } };
};

/**
 * GĐ6 bền qua tải lại: tường bao (đúng một mặt ra ngoài nhà theo `wallSidesOf`) nhận phào chân
 * ngoài như tường vẽ mới (`realismWallDefaults`), dựng lại mỗi lần nạp nên không cần lưu về BE.
 * Vách giữa hai phòng (cả hai mặt trong) và tường thấp kính (không len) giữ nguyên. Pascal mỗi tường
 * chỉ một `skirting` → giữ len trong nhà của phong cách, mở `sides: 'both'` và gắn cỡ phào ngoài vào
 * `skirting.exterior` (luật vá scripts/realism/r9u-skirt-sides.mjs). Lượt về không đọc `skirting`: sửa
 * phào của một tường trong phiên không lưu được, tải lại thì về như cũ.
 */
const exteriorSkirtingOf = (wall: Wall, style: SceneStyle, rooms: readonly Room[]): Pick<PascalWallNode, 'skirting'> => {
  const interior = wallDressingOf(wall, style).skirting;
  if (!isDetailsEnabled() || interior === undefined) return {};
  const { frontSide, backSide } = wallSidesOf(wall, rooms);
  if (frontSide !== 'exterior' && backSide !== 'exterior') return {};
  const { height, proud, profile } = EXTERIOR_SKIRTING;
  return { skirting: { ...interior, sides: 'both', exterior: { height, proud, profile } } };
};

const wallNodeOf = (
  wall: Wall,
  ordinal: number,
  levelNodeId: PascalNodeId,
  children: readonly PascalNodeId[],
  style: SceneStyle,
  rooms: readonly Room[],
): PascalWallNode => ({
  object: 'node',
  id: toPascalId('wall', wall.id),
  type: 'wall',
  name: wallNodeNameOf(wall, ordinal),
  parentId: levelNodeId,
  children,
  start: [metresOf(wall.centreline.start.x), metresOf(wall.centreline.start.y)],
  end: [metresOf(wall.centreline.end.x), metresOf(wall.centreline.end.y)],
  /* Cùng quy ước sagitta với máy chủ; mm → m là đủ vì (x, y) mặt bằng sang (x, z) Pascal không lật trục. */
  ...(wall.curveOffsetMm ? { curveOffset: metresOf(wall.curveOffsetMm) } : {}),
  thickness: metresOf(wall.thicknessMm),
  height: metresOf(wall.heightMm),
  ...wallSidesOf(wall, rooms),
  ...wallDressingOf(wall, style),
  ...exteriorSkirtingOf(wall, style, rooms),
  // W3a — khe của phong cách (chưa sơn): lượt về chỉ ghi `Wall.paint` cho mặt khác cái này.
  metadata: {
    appfront: originOf(wall, { kind: wall.kind, styleSlots: wallDressingOf({ kind: wall.kind, heightMm: wall.heightMm }, style).slots }),
  },
});

/**
 * Vị trí ô mở trong hệ toạ độ của tường.
 *
 * AppFront đo mép **trái** và mép **dưới**; Pascal đọc **tâm** ở cả hai trục.
 * Một nửa kích thước là toàn bộ chỗ khác nhau, và nó chỉ được cộng ở đây.
 */
const openingPositionOf = (opening: Opening): PascalVec3 => [
  metresOf(opening.offsetMm + opening.widthMm / 2),
  metresOf(opening.sillHeightMm + opening.heightMm / 2),
  0,
];

/**
 * Góc hé cánh bản lề (30°): đủ để cửa đọc ra là cửa, không phải mảng tường. 70° cũ để cánh 0,8 m
 * chìa ~0,75 m vào phòng; ở chế độ "Tường: cắt" (cắt 1 m) nó thành tấm đứng chéo giữa phòng —
 * lỗi "cửa xoay lệch" người chấm bench-3d r3 nêu ở 24 ca, dù phía mở đúng luật ở 399/411 cửa.
 */
const DOOR_SWING_ANGLE = Math.PI / 6;

/**
 * Cách mở cánh của AppFront, diễn sang các trường rời của Pascal. Mọi trường
 * khai đích danh vì `setScene` không áp mặc định của lược đồ. Cửa bản lề hé
 * bằng `swingAngle`; `operationState` chỉ cửa trượt đọc (R1-5c). Swing
 * `'fixed'` trên cửa đi là ô trống bộ chuyển đổi để lại → `openingKind:'opening'`.
 */
const doorLeafOf = (
  opening: Opening,
  swingDirection: 'inward' | 'outward' = 'inward',
): Pick<
  PascalDoorNode,
  | 'doorType'
  | 'hingesSide'
  | 'leafCount'
  | 'openingKind'
  | 'swingAngle'
  | 'swingDirection'
  | 'operationState'
  | 'slideDirection'
> => {
  // H4 — "Đổi hướng mở" đã lưu: cánh bản lề sang mặt kia của luật, cửa lùa lùa sang phải.
  const flipped = opening.reversed === true;
  const hinged = {
    doorType: 'hinged',
    leafCount: 1,
    hingesSide: 'left',
    openingKind: 'door',
    swingAngle: DOOR_SWING_ANGLE,
    swingDirection: flipped ? (swingDirection === 'inward' ? 'outward' : 'inward') : swingDirection,
    operationState: 0,
  } as const;
  switch (opening.swing) {
    case 'double':
      // Pascal chỉ vẽ hai cánh khi `doorType` là `double`/`french` (`door-system.tsx`); `hinged` bỏ qua `leafCount`.
      return { ...hinged, doorType: 'double', leafCount: 2 };
    case 'sliding':
      return opening.doorStyle === 'folding'
        ? { ...hinged, doorType: 'folding', leafCount: 4, swingAngle: 0, operationState: 0.65 }
        : {
            ...hinged,
            doorType: opening.doorStyle ?? 'sliding',
            swingAngle: 0,
            operationState: 0.5,
            slideDirection: flipped ? 'right' : 'left',
          };
    case 'right':
      return { ...hinged, hingesSide: 'right' };
    case 'fixed':
      return { ...hinged, openingKind: 'opening', swingAngle: 0 };
    default:
      return hinged;
  }
};

/** Cách mở cánh cửa sổ: trượt, cánh đơn theo bên bản lề, hai cánh kiểu Pháp, hoặc kính cố định. */
const windowStyleOf = (
  opening: Opening,
): Pick<PascalWindowNode, 'openingKind' | 'windowType' | 'casementStyle' | 'hingesSide'> => {
  const fixed = { openingKind: 'window', windowType: 'fixed', casementStyle: 'single', hingesSide: 'left' } as const;
  switch (opening.swing) {
    case 'sliding':
      return { ...fixed, windowType: 'sliding' };
    case 'left':
    case 'right':
      return { ...fixed, windowType: 'casement', hingesSide: opening.swing };
    case 'double':
      return { ...fixed, windowType: 'casement', casementStyle: 'french' };
    default:
      return fixed;
  }
};

/**
 * Khung sáng + kính sáng (`mat_appfront_glass`, `sceneDressing.ts`) để cửa sổ đọc ra là kính, không
 * phải tấm màu (V5 D5). Không dùng `preset-glass`: xanh trời 0,3 nên Pascal phủ fresnel phản chiếu
 * môi trường tối của `night` → ô kính xanh két sẫm.
 */
const WINDOW_SLOTS = { frame: 'library:preset-white', glass: 'scene:mat_appfront_glass' } as const;

export const openingNodeOf = (
  opening: Opening,
  wallNodeId: PascalNodeId,
  swingDirection: 'inward' | 'outward' = 'inward',
): PascalDoorNode | PascalWindowNode => {
  const shared = {
    object: 'node',
    id: toPascalId(opening.kind, opening.id),
    parentId: wallNodeId,
    wallId: wallNodeId,
    position: openingPositionOf(opening),
    rotation: [0, 0, 0],
    width: metresOf(opening.widthMm),
    height: metresOf(opening.heightMm),
    // `ruleSwing`: hướng luật cho (`swingDirectionOf`) — lượt về so với nó để biết người dùng có đảo không (H4).
    metadata: { appfront: originOf(opening, { swing: opening.swing, ruleSwing: swingDirection }) },
  } as const;

  return opening.kind === 'door'
    ? { ...shared, type: 'door', ...doorLeafOf(opening, swingDirection) }
    : { ...shared, type: 'window', ...windowStyleOf(opening), slots: WINDOW_SLOTS };
};

/* -------------------------------------------------------------------------- */
/* Phòng và đồ đạc.                                                            */
/* -------------------------------------------------------------------------- */

/**
 * Tấm sàn của một phòng, dựng từ đúng đường bao mà `zone` dùng.
 *
 * Hai node cho một phòng không phải trùng lặp: `zone` là khối không gian —
 * Pascal đọc nó để đếm phòng, gán công năng, tính thể tích — còn `slab` là vật
 * thể có mặt để nhìn và để đặt đồ lên. Bỏ `slab` thì bản vẽ có phòng mà không
 * có nền.
 */
const slabNodeOf = (room: Room, levelNodeId: PascalNodeId, style: SceneStyle): PascalSlabNode => ({
  object: 'node',
  id: toPascalId('slab', room.id),
  type: 'slab',
  parentId: levelNodeId,
  polygon: room.outline.map((point): PascalPoint2 => [metresOf(point.x), metresOf(point.y)]),
  holes: [],
  holeMetadata: [],
  elevation: 0,
  thickness: SLAB_THICKNESS_M,
  recessed: false,
  autoFromWalls: false,
  // Khai đích danh — xem `PascalSlabNode.slots`; quy tắc chọn ở `sceneDressing.ts`.
  slots: { surface: floorMaterialOf(room, style) },
  // W3a — phong cách + mặt sàn nó cho (chưa đè): lượt về chỉ ghi `finish`/`floorMaterial` khi sàn khác cái này.
  metadata: {
    appfront: originOf(room, {
      usage: room.usage,
      style: style.id,
      styleSurface: floorMaterialOf({ usage: room.usage, ...(room.finish === undefined ? {} : { finish: room.finish }) }, style),
    }),
  },
});

/**
 * Phòng thành `zone`. `occupancy`/`ceilingHeight` phải ghi tay: vắng thì lược đồ
 * Pascal điền `''`/2,7 m, và bảng "Diện tích phòng" gom mọi phòng vào "Chưa đặt
 * công năng" với chiều cao sai (23R-A-014/020). `Room` không có số phòng nên
 * `roomNumber` để mặc định.
 */
const zoneNodeOf = (room: Room, levelNodeId: PascalNodeId, levelHeightMm: number): PascalZoneNode => ({
  object: 'node',
  id: toPascalId('zone', room.id),
  type: 'zone',
  name: room.name,
  parentId: levelNodeId,
  polygon: room.outline.map((point): PascalPoint2 => [metresOf(point.x), metresOf(point.y)]),
  spaceRole: 'room',
  boundaryWallIds: room.wallIds.map((wallId) => toPascalId('wall', wallId)),
  occupancy: describeUsage(room.usage),
  ceilingHeight: metresOf(levelHeightMm),
  metadata: {
    appfront: originOf(room, { usage: room.usage, areaM2: room.areaM2 }),
  },
});

/** Độ dài tối đa của nhãn trục trong lược đồ Pascal (`structural-grid.ts`). */
const GRID_LABEL_MAX = 12;

const gridNodeOf = (axis: Axis, levelNodeId: PascalNodeId): PascalStructuralGridNode => ({
  object: 'node',
  id: toPascalId('structural-grid', axis.id),
  type: 'structural-grid',
  parentId: levelNodeId,
  start: [metresOf(axis.line.start.x), metresOf(axis.line.start.y)],
  end: [metresOf(axis.line.end.x), metresOf(axis.line.end.y)],
  label: axis.label.trim().slice(0, GRID_LABEL_MAX) || '?',
  showStartBubble: true,
  showEndBubble: true,
  metadata: { appfront: originOf(axis, { direction: axis.direction, label: axis.label }) },
});

/** Chiều cao dựng hình của một món đồ, mét: thang lấy chiều cao tầng, còn lại lấy bảng. */
const heightOfFurniture = (furniture: Furniture, levelHeightMm: number): number =>
  furniture.kind === 'stair'
    ? metresOf(levelHeightMm)
    : metresOf(furniture.heightMm ?? FURNITURE_HEIGHT_MM[furniture.kind]);

/** Phòng mà tủ thiết bị (`kitchenCabinet`/`cabinet`: máy giặt, máy sấy…) dựng thành máy giặt; bếp giữ mô hình cũ. */
const WASHER_ROOM_USAGES: ReadonlySet<RoomUsage> = new Set(['bathroom', 'utility']);

/**
 * Thư mục mô hình Pascal cho một món đồ theo phong cách (J7, `sceneVariety.ts`);
 * `null` = không có mô hình (thang) → chỗ giữ chỗ `asset://`.
 */
const furnitureFolderOf = (furniture: Furniture, style: SceneStyle, usage: RoomUsage | undefined): string | null =>
  furniture.kind === 'kitchenCabinet' &&
  furniture.variant === 'cabinet' &&
  usage !== undefined &&
  WASHER_ROOM_USAGES.has(usage)
    ? 'washing-machine'
    : modelFolderOf(furniture, style, usage);

/** Cây mà catalog dựng cao hơn trần (cọ 4,5 m, thông 3 m): trong nhà chặn ở 2,2 m. */
const TALL_PLANT_FOLDERS: ReadonlySet<string> = new Set(['palm', 'fir-tree']);
const TALL_PLANT_MAX_M = 2.2;

/** Thảm: phủ đúng mặt bằng hộp bao; dày theo `heightMm` hoặc nửa catalog (10 mm từng làm `s` chung = 0,25). */
const RUG_FOLDERS: ReadonlySet<string> = new Set(['rectangular-carpet', 'round-carpet']);

/**
 * Thảm phải nằm trong phòng của nó: có `roomId` thì phòng ấy phải dựng được và chứa tâm thảm; không có thì
 * tâm phải trong một phòng cùng tầng. Phòng thiếu (BE chưa dò ra phòng khách) / AI đặt lệch → thảm "lạc"
 * nằm trên nền trống ngoài nhà (04/11, ba tấm quanh f-22).
 */
const isStrayRug = (f: Furniture, rooms: readonly Room[]): boolean => {
  const role = roleOf(f);
  if (role !== 'rug' && role !== 'roundRug') return false;
  const homes = f.roomId === undefined ? rooms.filter((r) => r.levelId === f.levelId) : rooms.filter((r) => r.id === f.roomId);
  return !homes.some((r) => insideOutline(f.centre, r.outline));
};
const RUG_SCALE_Y = 0.5;
/**
 * Đồ kéo dài được theo từng trục (dãy tủ, kệ, chậu rửa liền tủ, bồn cây…): một tỉ lệ chung
 * thu cả dãy 3 m về một mô-đun. Kéo hết theo trục dài của hộp (không trần — tủ áo 3 m ra 3 m),
 * trục kia trong `[FIT_AXIS_MIN; FIT_AXIS_MAX]` × mẫu nhưng không quá hộp, cao giữ thật.
 */
const STRETCH_FOLDERS: ReadonlySet<string> = new Set([
  'closet',
  'kitchen-cabinet',
  'kitchen-counter',
  'kitchen-shelf',
  'kitchen',
  'bookshelf',
  'shelf',
  'bush',
  'bathroom-sink',
  'dresser',
  'tv-stand',
  // Bàn trà chữ nhật vào ô vuông 0,9 × 0,9 (F1): co đều thì chỉ còn sâu 0,5 m.
  'coffee-table',
]);
/** Biên co giãn một trục mặt bằng quanh tỉ lệ chung (C3, GIAI-PHAP 3.4): lệch hơn thì mẫu méo dáng. */
const FIT_AXIS_MIN = 0.8;
const FIT_AXIS_MAX = 1.25;
/** Biên hệ số cao khi bản vẽ không cho `heightMm`: giữ cao thật của mẫu (bàn ăn không còn 0,30 m). */
const FIT_HEIGHT_MIN = 0.9;
const FIT_HEIGHT_MAX = 1.1;
const clampTo = (v: number, lo: number, hi: number): number => Math.min(hi, Math.max(lo, v));
/** `heightMm` là bề dày tấm trên bản vẽ (mặt bếp 20 mm), không phải cao mẫu: khớp theo mặt bằng, giữ cao thật. */
const OWN_HEIGHT_FOLDERS: ReadonlySet<string> = new Set(['hob-sf']);

/** Tâm `p` nằm trong mặt bằng (đã xoay) của `host`. */
const coversPoint = (host: Furniture, p: { readonly x: number; readonly y: number }): boolean => {
  const t = (host.rotationDeg * Math.PI) / 180;
  const dx = p.x - host.centre.x;
  const dy = p.y - host.centre.y;
  const b = host.boundingBox;
  return (
    Math.abs(dx * Math.cos(t) + dy * Math.sin(t)) <= (b.max.x - b.min.x) / 2 &&
    Math.abs(-dx * Math.sin(t) + dy * Math.cos(t)) <= (b.max.y - b.min.y) / 2
  );
};

/**
 * Dãy tủ bếp dưới (vai trò `counter`) có chậu mỏng nằm trên → dựng bằng mẫu của variant `sink` (dãy bếp
 * có chậu; realism: `kitchen-sink-gen` khoét lỗ mặt đá). Chỉ đổi mẫu, không đổi variant (variant lưu
 * ngược ra). Chậu mỏng tự nó co về 20 mm, nằm khuất trong tủ.
 * ponytail: chậu luôn ở giữa mô-đun, không theo tâm chậu trên bản vẽ — tách mô-đun nếu bản vẽ đặt chậu lệch.
 */
const sinkFolderOf = (
  counter: Furniture,
  all: readonly Furniture[],
  usageOf: (f: Furniture) => RoomUsage | undefined,
): string | undefined =>
  counter.kind === 'kitchenCabinet' &&
  roleOf(counter, usageOf(counter)) === 'counter' &&
  all.some((s) => s !== counter && s.levelId === counter.levelId && isThinSink(s) && coversPoint(counter, s.centre))
    ? VARIANT_MODEL.sink?.folder
    : undefined;

/** Mặt bếp mỏng: độ nâng = mặt đá của tủ bếp dưới (vai trò `counter`) chứa tâm nó; không có tủ thì 0 (sàn). */
const counterTopMmOf = (
  hob: Furniture,
  all: readonly Furniture[],
  style: SceneStyle,
  usageOf: (f: Furniture) => RoomUsage | undefined,
): number => {
  if (!isThinHob(hob)) return 0;
  const host = all.find(
    (h) =>
      h !== hob &&
      h.levelId === hob.levelId &&
      h.kind === 'kitchenCabinet' &&
      roleOf(h, usageOf(h)) === 'counter' &&
      coversPoint(h, hob.centre),
  );
  return host === undefined ? 0 : Math.round(hostTopMm(host, style, usageOf(host)));
};

/** Chiều cao một bậc mục tiêu, mét — số bậc = max(3, round(chiều cao tầng / số này)). */
const STAIR_RISER_M = 0.175;
/** Vật liệu thành thang: vữa trát (đã giải được hôm nay, J6). */
const STAIR_SIDE_MATERIAL = 'library:concrete-plaster';
/** Thang rộng từ chừng này (mét) thì lan can hai bên, hẹp hơn chỉ bên phải (V5 D12). */
const STAIR_BOTH_RAILS_M = 1.2;

/**
 * Đồ đạc `stair` thành thang Pascal thật: một `stair` + một `stair-segment`.
 *
 * Bộ vẽ dựng đoạn thang từ GỐC của nó theo +z cục bộ, bề rộng cân quanh x = 0
 * (`viewer/systems/stair/stair-system.tsx:166-169,209-210`), đoạn đầu ở gốc của thang
 * (`:476-486`), và nhóm thang đặt ở `position`/`rotation` (`parametric-node-renderer.tsx:71-88`).
 * Nên `position` = tâm hộp bao lùi nửa thân thang. Thân chạy theo cạnh DÀI của hộp bao
 * (K1, cục bộ): cạnh dài là y cục bộ → yaw = −rotationDeg; là x cục bộ → yaw + π/2.
 */
const stairNodesOf = (
  furniture: Furniture,
  levelNodeId: PascalNodeId,
  levelHeightMm: number,
  style: SceneStyle,
): readonly [PascalStairNode, PascalStairSegmentNode] => {
  const sizeX = metresOf(furniture.boundingBox.max.x - furniture.boundingBox.min.x);
  const sizeY = metresOf(furniture.boundingBox.max.y - furniture.boundingBox.min.y);
  const runAlongX = sizeX > sizeY;
  const width = runAlongX ? sizeY : sizeX;
  const length = runAlongX ? sizeX : sizeY;
  const rotation = yawOf(furniture.rotationDeg) + (runAlongX ? Math.PI / 2 : 0);
  const rise = metresOf(levelHeightMm);
  const stepCount = Math.max(3, Math.round(rise / STAIR_RISER_M));
  const stairId = toPascalId('stair', furniture.id);
  const segmentId: PascalNodeId = `sseg_${furniture.id}`;

  return [
    {
      object: 'node',
      id: stairId,
      type: 'stair',
      name: FURNITURE_KIND_LABELS.stair,
      parentId: levelNodeId,
      children: [segmentId],
      position: [
        metresOf(furniture.centre.x) - (Math.sin(rotation) * length) / 2,
        0,
        metresOf(furniture.centre.y) - (Math.cos(rotation) * length) / 2,
      ],
      rotation,
      stairType: 'straight',
      fromLevelId: levelNodeId,
      toLevelId: null,
      slabOpeningMode: 'none',
      openingOffset: 0,
      width,
      totalRise: rise,
      stepCount,
      thickness: 0.25,
      fillToFloor: true,
      innerRadius: 0.9,
      sweepAngle: Math.PI / 2,
      topLandingMode: 'none',
      topLandingDepth: 0.9,
      showCenterColumn: true,
      showStepSupports: true,
      railingMode: width >= STAIR_BOTH_RAILS_M ? 'both' : 'right',
      railingHeight: 0.92,
      treadMaterialPreset: style.floor.wood,
      sideMaterialPreset: STAIR_SIDE_MATERIAL,
      metadata: {
        appfront: originOf(furniture, {
          kind: furniture.kind,
          boundingBox: furniture.boundingBox,
          ...(furniture.roomId === undefined ? {} : { roomId: furniture.roomId }),
          // Chỉ để ghi trả (`toSpatial`): nhánh này luôn dựng thang thẳng.
          ...(furniture.variant === undefined ? {} : { variant: furniture.variant }),
        }),
      },
    },
    {
      object: 'node',
      id: segmentId,
      type: 'stair-segment',
      parentId: stairId,
      position: [0, 0, 0],
      rotation: 0,
      segmentType: 'stair',
      width,
      length,
      height: rise,
      stepCount,
      attachmentSide: 'front',
      fillToFloor: true,
      thickness: 0.25,
    },
  ];
};

const SWAPPED_MODEL_SRC = /^\/items\/([a-z0-9_-]+)\/model\.glb$/;

/** Bản sao món bỏ `model` (exactOptionalPropertyTypes không cho gán `undefined`). */
const withoutModel = (f: Furniture): Furniture => {
  const copy = { ...f };
  delete copy.model;
  return copy;
};

const itemNodeOf = (
  furniture: Furniture,
  levelNodeId: PascalNodeId,
  levelHeightMm: number,
  style: SceneStyle,
  usage?: RoomUsage,
  /** Độ nâng khi cả món lẫn variant không có `liftMm` (mặt bếp trên mặt đá). */
  baseLiftMm = 0,
  /** Mẫu thay cho mẫu tự chọn (dãy tủ có chậu mỏng nằm trên). */
  folderOverride?: string,
): PascalItemNode => {
  const label = FURNITURE_KIND_LABELS[furniture.kind];
  const widthM = metresOf(furniture.boundingBox.max.x - furniture.boundingBox.min.x);
  const depthM = metresOf(furniture.boundingBox.max.y - furniture.boundingBox.min.y);
  // Mẫu đã đổi (thẻ "Đổi mẫu") vẫn khớp hộp bao theo thư mục của nó; `asset.id/src` giữ `model`.
  const swappedFolder = furniture.model?.src.match(SWAPPED_MODEL_SRC)?.[1];
  const folder =
    furniture.model === undefined
      ? (folderOverride ?? furnitureFolderOf(furniture, style, usage))
      : swappedFolder !== undefined && Object.prototype.hasOwnProperty.call(CATALOG_MODELS, swappedFolder)
        ? swappedFolder
        : null;
  const model =
    folder === null
      ? null
      : { folder, liftMm: furniture.variant === undefined ? undefined : VARIANT_MODEL[furniture.variant]?.liftMm };
  const catalog = model === null ? undefined : CATALOG_MODELS[model.folder];

  // Khớp mô hình vào hộp bao CỤC BỘ bằng `asset.scale` — `node.scale` phải giữ
  // [1, 1, 1] vì lượt về đọc lệch khỏi 1 là "người dùng vừa kéo" (toSpatial `isUnscaled`).
  // `asset.id` cũng giữ nguyên `appfront-<kind>`: đổi nó là lượt về sinh `model` (R1-3b).
  const fit = (() => {
    if (model === null || catalog === undefined) {
      return null;
    }

    const [cw, ch, cd] = catalog.dimensions;
    const fixedH =
      furniture.heightMm === undefined || OWN_HEIGHT_FOLDERS.has(model.folder) ? undefined : metresOf(furniture.heightMm);
    // Không có `heightMm` (bản quét AI) thì chỉ hộp bao quyết định `s` — món đồ có thể
    // phình cao vô lý. Chặn: ≤ 1,25× cỡ catalog, cây cao ≤ 2,2 m, và không quá trần tầng.
    const maxH =
      fixedH ??
      Math.min(metresOf(levelHeightMm), TALL_PLANT_FOLDERS.has(model.folder) ? TALL_PLANT_MAX_M : ch * 1.25);
    // Tỉ lệ từng trục [sx, sy, sz] theo nhóm: thảm phủ mặt bằng, đồ kéo dài kéo theo chiều dài,
    // đồ cứng co giãn từng trục có chặn lệch. Chỉ `asset.scale` lệch trục — lượt về
    // chỉ đọc `node.scale` nên không đổi gì.
    // Hộp bao là khung riêng của món (K1: `orientDetected` đã đổi cạnh khi quay 90/270), node
    // quay theo `rotationDeg` — nên `rx`/`rz` so trục riêng với trục mẫu, không đụng `asset.rotation`.
    const rx = widthM / cw;
    const rz = depthM / cd;
    const heightOf = (ref: number): number =>
      fixedH === undefined ? Math.min(clampTo(ref, FIT_HEIGHT_MIN, FIT_HEIGHT_MAX), maxH / ch) : fixedH / ch;
    // Không trục mặt bằng nào vượt hộp bao (FE-H): biên [0,8; 1,25] chỉ chống co thiếu — mẫu khác dáng
    // hộp (chậu, tủ đầu giường, kệ nông) từng phình gấp đôi hộp ở trục bị chặn.
    const [ax, sy, az] = ((): PascalVec3 => {
      if (RUG_FOLDERS.has(model.folder)) return [rx, fixedH === undefined ? RUG_SCALE_Y : fixedH / ch, rz];
      if (STRETCH_FOLDERS.has(model.folder)) {
        // Kéo hết theo trục dài của hộp (so với mẫu), trục kia giữ gần chiều sâu mẫu.
        const alongX = rx >= rz;
        const deep = clampTo(alongX ? rz : rx, FIT_AXIS_MIN, FIT_AXIS_MAX);
        return alongX ? [rx, heightOf(deep), deep] : [deep, heightOf(deep), rz];
      }
      // Đồ cứng: mỗi trục co giãn riêng trong [0,8; 1,25] × trung bình nhân hai trục.
      const g = Math.sqrt(rx * rz);
      return [clampTo(rx, g * FIT_AXIS_MIN, g * FIT_AXIS_MAX), heightOf(g), clampTo(rz, g * FIT_AXIS_MIN, g * FIT_AXIS_MAX)];
    })();
    const sx = Math.min(ax, rx);
    const sz = Math.min(az, rz);
    // `asset.scale` nhân thẳng vào GLB gốc; catalog nào có scale riêng thì `dimensions`
    // là cỡ sau scale đó (cọ: GLB cao 11,9 m × 0,37) — phải nhân lại, không thì cao gấp đôi tường.
    const [kx, ky, kz] = catalog.scale ?? [1, 1, 1];
    // Đồ treo tường: mô hình mỏng hơn hộp bao thì áp lưng nó vào mép sau (−z cục
    // bộ, phía tường) thay vì treo lơ lửng giữa hộp. Dời bằng `asset.offset` chứ
    // không dời `position`: tâm món đồ phải giữ đúng `centre` để lượt về không trôi.
    // `attachTo` không ghi ra — Pascal sẽ đòi một bức tường cha mà node này không có.
    const backShift = catalog.attachTo === 'wall-side' ? -(depthM - cd * sz) / 2 : 0;
    const [ox, oy, oz] = catalog.offset;

    return {
      folder: model.folder,
      heightM: fixedH ?? ch * sy,
      scale: [sx * kx, sy * ky, sz * kz] as PascalVec3,
      offset: [ox * sx, oy * sy, oz * sz + backShift] as PascalVec3,
      rotation: [...catalog.rotation] as PascalVec3,
    };
  })();
  const heightM = fit?.heightM ?? heightOfFurniture(furniture, levelHeightMm);
  const liftMm = furniture.liftMm ?? model?.liftMm ?? baseLiftMm;
  const liftM = metresOf(liftMm);
  // Khe phong cách cho, rồi khe người dùng đã sơn đè lên (W3b `Furniture.slots`).
  const styleSlots = fit === null ? {} : itemSlotsOf(fit.folder, style);
  const wholePaint = styleSlots?.[OUTLINE_PAINT_SLOT] === undefined ? furniture.slots?.[OUTLINE_PAINT_SLOT] : undefined;
  const slots = {
    ...styleSlots,
    ...(wholePaint === undefined ? {} : Object.fromEntries(Object.keys(styleSlots ?? {}).map((slot) => [slot, wholePaint]))),
    ...furniture.slots,
  };
  const lampOf = fit === null ? undefined : (libRoles2LampOf(furniture, style) ?? lampInteractiveOf(fit.folder, style));

  return {
    object: 'node',
    id: toPascalId('item', furniture.id),
    type: 'item',
    name: label,
    parentId: levelNodeId,
    ...(Object.keys(slots).length === 0 ? {} : { slots }),
    // Đồ trần (pendant) tạm đặt dưới tầng ở độ cao `lift`; T16 lo trần.
    position: [metresOf(furniture.centre.x), liftM, metresOf(furniture.centre.y)],
    rotation: [0, yawOf(furniture.rotationDeg), 0],
    scale: [1, 1, 1],
    asset: {
      id: furniture.model?.id ?? `appfront-${furniture.kind}`,
      category: furniture.kind,
      name: label,
      thumbnail: fit === null ? '' : thumbnailOf(fit.folder),
      // `asset://…` là dạng nội bộ mà `AssetUrl` nhận (`schema/asset-url.js`);
      // chỉ còn `stair` dùng nó làm chỗ giữ chỗ — chưa có mô hình thang (ngoài C2).
      // Mẫu máy chủ lưu đường `/items/<id>/…`; URL thật là URL ký mới của lượt mở này.
      src:
        fit !== null && isServerModel(fit.folder)
          ? modelSrcOf(fit.folder)
          : (furniture.model?.src ?? (fit === null ? `asset://appfront/${furniture.kind}` : modelSrcOf(fit.folder))),
      dimensions: [widthM, heightM, depthM],
      ...(fit === null ? {} : { offset: fit.offset, rotation: fit.rotation, scale: fit.scale }),
      // Đèn của bản vẽ (cây/bàn/trần/tường) phát sáng thật, bật sẵn, theo phong cách.
      ...(lampOf === undefined ? {} : { interactive: lampOf }),
    },
    metadata: {
      appfront: originOf(furniture, {
        kind: furniture.kind,
        boundingBox: furniture.boundingBox,
        ...(furniture.roomId === undefined ? {} : { roomId: furniture.roomId }),
        // W3b: lượt về chỉ ghi khe / độ cao / độ nâng khác những số này — cảnh chưa chạm thì không đổi.
        rotationDeg: furniture.rotationDeg,
        ...(isAutoFaced(furniture) ? { autoFacing: true } : {}),
        styleSlots,
        styleLiftMm: liftMm,
        ...(furniture.variant === undefined ? {} : { variant: furniture.variant }),
        ...(furniture.heightMm === undefined ? {} : { heightMm: furniture.heightMm }),
        ...(furniture.liftMm === undefined ? {} : { liftMm: furniture.liftMm }),
        // Món sinh: mẫu đang dựng, để lượt về lưu đúng mẫu ấy khi món được nhận (`toSpatial` `shownModelOf`).
        ...(fit !== null && furniture.model === undefined && furniture.id.startsWith(GENERATED_DRESS_PREFIX)
          ? { [MODEL_FOLDER_FIELD]: fit.folder }
          : {}),
      }),
    },
  };
};

/** C6 — viền đồ chưa xác nhận: tấm phẳng 4 mm, vật liệu bán trong suốt. */
const SUGGESTED_OUTLINE_MM = 4;
export const SUGGESTED_OUTLINE_PREFIX = `${GENERATED_DRESS_PREFIX}suggested-`;

/**
 * C6 — đồ `suggested` không dựng khối 3D: thay bằng tấm phẳng mờ phủ mặt bằng hộp bao để người dùng
 * thấy chỗ máy chưa nhận ra. Id `DRESS-` (lượt về bỏ qua), không `roomId` (không nhận nuôi được).
 */
const suggestedOutlineOf = (
  furniture: Furniture,
  levelNodeId: PascalNodeId | undefined,
  levelHeightMm: number | undefined,
  style: SceneStyle,
): PascalItemNode | null => {
  if (levelNodeId === undefined || levelHeightMm === undefined) return null;
  const { centre, rotationDeg, boundingBox: b } = furniture;
  if (!isUsable(centre.x, centre.y, rotationDeg, b.min.x, b.min.y, b.max.x, b.max.y)) return null;
  const { levelId, kind, confidence, source, reviewed } = furniture;
  const node = itemNodeOf(
    {
      ...{ levelId, kind, centre, rotationDeg, boundingBox: b, confidence, source, reviewed },
      id: `${SUGGESTED_OUTLINE_PREFIX}${furniture.id}` as FurnitureId,
      heightMm: millimetres(SUGGESTED_OUTLINE_MM),
    },
    levelNodeId,
    levelHeightMm,
    style,
    undefined,
    0,
    'rectangular-carpet',
  );
  const slots = Object.fromEntries(Object.keys(node.slots ?? { a: '' }).map((key) => [key, UNCONFIRMED_MATERIAL_REF]));
  const [widthM, , depthM] = node.asset.dimensions;
  return {
    ...node,
    name: `${node.name} (chưa xác nhận)`,
    slots,
    // Tấm mỏng do `asset.scale`; `dimensions` mang chiều cao thật để ô Cao của thẻ đọc đúng món đồ, không phải 4 mm.
    asset: { ...node.asset, dimensions: [widthM, heightOfFurniture(furniture, levelHeightMm), depthM] },
    metadata: { ...node.metadata, generated: 'part', unconfirmed: true },
  };
};

/**
 * V1 — node thật của dãy tủ chữ L dựng theo nhánh dài: mô hình dời bằng `asset.offset` (hộp không
 * xoay nên khung riêng = mặt bằng), còn `position` và hộp bao trong metadata giữ đúng món đồ gốc
 * để lượt về không thấy gì đổi.
 */
const longArmNodeOf = (
  furniture: Furniture,
  arm: Pick<Furniture, 'centre'>,
  armNode: PascalItemNode,
): PascalItemNode => {
  const [ox, oy, oz] = armNode.asset.offset ?? [0, 0, 0];
  const origin = armNode.metadata?.appfront;

  return {
    ...armNode,
    position: [metresOf(furniture.centre.x), armNode.position[1], metresOf(furniture.centre.y)],
    asset: {
      ...armNode.asset,
      offset: [
        ox + metresOf(arm.centre.x - furniture.centre.x),
        oy,
        oz + metresOf(arm.centre.y - furniture.centre.y),
      ],
    },
    ...(origin === undefined
      ? {}
      : { metadata: { ...armNode.metadata, appfront: { ...origin, fields: { ...origin.fields, boundingBox: furniture.boundingBox } } } }),
  };
};

/* -------------------------------------------------------------------------- */
/* Lượt đổi.                                                                   */
/* -------------------------------------------------------------------------- */

/**
 * Đổi cả đồ thị sang một cảnh Pascal.
 *
 * Không đọc store, không chạm mạng, không ném lỗi: cùng một đồ thị vào thì
 * cùng một cảnh ra, kể cả khi đồ thị có tham chiếu gãy.
 */
/**
 * Đường bao khu đất, tính từ chính hình học đã dựng.
 *
 * Bắt buộc phải có: `setScene` không parse qua zod nên mặc định `.default()`
 * của lược đồ không bao giờ được áp, và bộ vẽ khu đất trả `null` — **bỏ luôn
 * cả cây con, im lặng** — khi không dựng được đường bao
 * (`nodes/dist/site/renderer.js:293`). Mặc định của lược đồ là ô vuông 30×30
 * quanh gốc, nhỏ hơn nhiều công trình thật, nên không mượn được.
 */
const sitePolygonOf = (nodes: Record<PascalNodeId, PascalNode>): PascalSiteNode['polygon'] => {
  const xs: number[] = [];
  const zs: number[] = [];

  for (const node of Object.values(nodes)) {
    if (node.type === 'wall') {
      xs.push(node.start[0], node.end[0]);
      zs.push(node.start[1], node.end[1]);
    } else if (node.type === 'zone') {
      for (const [x, z] of node.polygon) {
        xs.push(x);
        zs.push(z);
      }
    }
  }

  if (xs.length === 0 || zs.length === 0) {
    const half = SITE_FALLBACK_HALF_SIZE_M;
    return {
      type: 'polygon',
      points: [
        [-half, -half],
        [half, -half],
        [half, half],
        [-half, half],
      ],
    };
  }

  const minX = Math.min(...xs) - SITE_MARGIN_M;
  const maxX = Math.max(...xs) + SITE_MARGIN_M;
  const minZ = Math.min(...zs) - SITE_MARGIN_M;
  const maxZ = Math.max(...zs) + SITE_MARGIN_M;

  return {
    type: 'polygon',
    points: [
      [minX, minZ],
      [maxX, minZ],
      [maxX, maxZ],
      [minX, maxZ],
    ],
  };
};

export const toPascalScene = (
  graph: SpatialGraph,
  {
    style = sceneStyleOf(undefined),
    furnish = 'off',
    additions = [],
    repairs,
  }: {
    readonly style?: SceneStyle;
    /** Đồ tự bày (bày phòng trống + bày biện) — mặc định tắt: cảnh chỉ có đồ của bản vẽ (C1). */
    readonly furnish?: 'off' | 'on';
    /** AID-01 — đồ AI bổ sung của concept đang dùng: đồ sinh ra như đồ tự bày, chạy cả khi `furnish: 'off'`. */
    readonly additions?: readonly DesignAddition[];
    /** Sửa cảnh cho đồ AI chưa xác nhận (làn sửa cảnh tính): chỉ GHI lên node đồ (`fields.repair`), không tính ở đây. */
    readonly repairs?: ReadonlyMap<FurnitureId, SceneRepair>;
  } = {},
): PascalSceneResult & { readonly layer: SceneLayerSummary } => {
  const nodes: Record<PascalNodeId, PascalNode> = {};
  const skipped: SkippedEntity[] = [];
  const childrenOf = new Map<PascalNodeId, PascalNodeId[]>();

  /**
   * Mảng con của một node, **dùng chung**: node giữ đúng mảng này, nên một
   * đứa con thêm vào sau khi node đã dựng vẫn có mặt. Nhờ vậy không cần lượt
   * quét thứ hai để vá lại `children`.
   */
  /* H4 — món tự bày / đèn người dùng đã xoá hoặc đã thành đồ thật: không sinh lại ở bất kỳ đường nào dưới đây. */
  const offIds = new Set(graph.rooms.flatMap((room) => room.dressingOff ?? []));
  /** Chỗ đèn trần tự chọn của từng phòng (m), để lượt về biết đèn đã dời chưa. */
  const roomsWithLight = new Set<string>();

  const childrenFor = (nodeId: PascalNodeId): PascalNodeId[] => {
    const existing = childrenOf.get(nodeId);

    if (existing !== undefined) {
      return existing;
    }

    const created: PascalNodeId[] = [];

    childrenOf.set(nodeId, created);

    return created;
  };

  const adopt = (parentId: PascalNodeId, childId: PascalNodeId): void => {
    childrenFor(parentId).push(childId);
  };

  const orderedLevels = [...graph.levels].sort((left, right) => left.order - right.order);
  const baseElevations = baseElevationsOf(
    orderedLevels.filter((level) => isUsable(level.elevationMm, level.heightMm)),
  );
  const levelNodeIdOf = new Map<string, PascalNodeId>();
  /* Chiều cao tầng: cái thang dựng cao trọn tầng, và trần của phòng. */
  const levelHeightMmOf = new Map<string, number>();
  /* Công năng để BÀY ĐỒ (V2): phòng `other` đoán theo tên; zone/slab/metadata vẫn giữ `room.usage`. */
  const roomUsageOf = new Map<string, RoomUsage>(graph.rooms.map((room) => [room.id, furnishingUsageOf(room)]));
  /* Phòng và đồ thật đã dựng được: đồ sinh ra chỉ suy từ chúng (toạ độ hỏng thì không vào). */
  const builtWalls: Wall[] = [];
  const builtOpenings: Opening[] = [];
  const builtRooms: Room[] = [];
  const builtFurniture: Furniture[] = [];
  let elevationIndex = 0;

  for (const level of orderedLevels) {
    if (!isUsable(level.elevationMm, level.heightMm)) {
      skipped.push(skip(level.id, 'tầng', 'Cao độ hoặc chiều cao tầng không phải một số đo được.'));
      continue;
    }

    const node = levelNodeOf(
      level,
      baseElevations[elevationIndex] ?? 0,
      childrenFor(toPascalId('level', level.id)),
    );

    elevationIndex += 1;
    nodes[node.id] = node;
    levelNodeIdOf.set(level.id, node.id);
    levelHeightMmOf.set(level.id, level.heightMm);
    adopt(BUILDING_NODE_ID, node.id);
  }

  const wallNodeIdOf = new Map<string, PascalNodeId>();
  const wallCountOfLevel = new Map<string, number>();
  /* V6 — đầu tường gần nhau dồn một điểm để vendor nối góc (tường cong dò thành chuỗi đoạn). Chỉ
     node mang toạ độ dồn; `builtWalls` (cửa, bày đồ) giữ tường gốc. */
  const weldedWallOf = weldWallEnds(
    graph.walls.filter(
      (w) =>
        levelNodeIdOf.has(w.levelId) &&
        isUsable(w.centreline.start.x, w.centreline.start.y, w.centreline.end.x, w.centreline.end.y, w.thicknessMm, w.heightMm),
    ),
  );

  /* Tường trôi ngoài nhà: node vẫn có (thiếu = lượt lưu đọc thành xoá) nhưng ẩn, và không vào
     `builtWalls` để không ảnh hưởng bày đồ, cửa, khung bóng. */
  const orphanWalls = orphanWallIds(graph);
  const addRailing = (span: Parameters<typeof railingNodeOf>[0], levelNodeId: PascalNodeId, levelHeightMm: number, hostId: string): void => {
    const rail = railingNodeOf(span, levelNodeId, levelHeightMm, style);
    if (offIds.has(bodyOfPascalId(rail.id))) return;
    nodes[rail.id] = withFields(rail, { [PROV_FIELD]: provenanceOf('railing', hostId) });
    adopt(levelNodeId, rail.id);
  };

  for (const wall of graph.walls) {
    const levelNodeId = levelNodeIdOf.get(wall.levelId);

    if (levelNodeId === undefined) {
      skipped.push(skip(wall.id, 'tường', `Tường thuộc tầng ${wall.levelId} mà tầng ấy không có trong bản vẽ.`));
      continue;
    }

    if (
      !isUsable(
        wall.centreline.start.x,
        wall.centreline.start.y,
        wall.centreline.end.x,
        wall.centreline.end.y,
        wall.thicknessMm,
        wall.heightMm,
      )
    ) {
      skipped.push(skip(wall.id, 'tường', 'Trục tường hoặc kích thước tường không phải một số đo được.'));
      continue;
    }

    const ordinal = (wallCountOfLevel.get(wall.levelId) ?? 0) + 1;
    wallCountOfLevel.set(wall.levelId, ordinal);
    const welded = weldedWallOf.get(wall.id);
    const built = wallNodeOf(welded ?? wall, ordinal, levelNodeId, childrenFor(toPascalId('wall', wall.id)), style, graph.rooms);
    const origin = built.metadata?.appfront;
    /* Trục gốc + trục đã dồn (mm) để lượt về trả lại trục gốc khi người dùng chưa dời tường. */
    const node: PascalWallNode =
      welded === undefined || origin === undefined
        ? built
        : {
            ...built,
            metadata: {
              ...built.metadata,
              appfront: { ...origin, fields: { ...origin.fields, weldedFrom: wall.centreline, weldedTo: welded.centreline } },
            },
          };

    if (orphanWalls.has(wall.id)) {
      nodes[node.id] = { ...node, visible: false };
      wallNodeIdOf.set(wall.id, node.id);
      adopt(levelNodeId, node.id);
      continue;
    }

    builtWalls.push(wall);
    const railing = isLoggiaRailing(wall, graph.rooms, graph.openings.some((o) => o.wallId === wall.id));
    nodes[node.id] = railing ? { ...node, visible: false } : node;
    wallNodeIdOf.set(wall.id, node.id);
    adopt(levelNodeId, node.id);
    const levelHeightMm = levelHeightMmOf.get(wall.levelId);
    if (railing && levelHeightMm !== undefined) {
      const source = welded ?? wall;
      addRailing({ anchor: wall.id, levelId: wall.levelId, ...source.centreline, thicknessMm: source.thicknessMm }, levelNodeId, levelHeightMm, wall.id);
    }
  }

  const builtWallOf = new Map(builtWalls.map((w) => [w.id, w]));
  for (const opening of graph.openings) {
    const wallNodeId = wallNodeIdOf.get(opening.wallId);

    if (wallNodeId === undefined) {
      skipped.push(
        skip(opening.id, 'ô mở', `Ô mở nằm trên tường ${opening.wallId} mà tường ấy không sang được.`),
      );
      continue;
    }

    if (!isUsable(opening.offsetMm, opening.widthMm, opening.heightMm, opening.sillHeightMm)) {
      skipped.push(skip(opening.id, 'ô mở', 'Vị trí hoặc kích thước ô mở không phải một số đo được.'));
      continue;
    }

    const wall = builtWallOf.get(opening.wallId);
    const node = openingNodeOf(opening, wallNodeId, swingDirectionOf(opening, wall, graph.rooms));

    builtOpenings.push(opening);
    nodes[node.id] = node;
    adopt(wallNodeId, node.id);
  }

  for (const room of graph.rooms) {
    const levelNodeId = levelNodeIdOf.get(room.levelId);
    const levelHeightMm = levelHeightMmOf.get(room.levelId);

    if (levelNodeId === undefined || levelHeightMm === undefined) {
      skipped.push(skip(room.id, 'phòng', `Phòng thuộc tầng ${room.levelId} mà tầng ấy không có trong bản vẽ.`));
      continue;
    }

    if (room.outline.length < MIN_OUTLINE_POINTS) {
      skipped.push(skip(room.id, 'phòng', 'Đường bao phòng có ít hơn ba điểm nên không thành đa giác.'));
      continue;
    }

    if (!room.outline.every((point) => isUsable(point.x, point.y))) {
      skipped.push(skip(room.id, 'phòng', 'Đường bao phòng có điểm không phải một toạ độ đo được.'));
      continue;
    }

    builtRooms.push(room);

    for (const node of [zoneNodeOf(room, levelNodeId, levelHeightMm), slabNodeOf(room, levelNodeId, style)]) {
      nodes[node.id] = node;
      adopt(levelNodeId, node.id);
    }

    /* Trần + đèn sinh từ phòng (sân ngoài trời thì không); đèn là con của trần (trần tự giữ `children`). */
    const generated = ceilingNodesOf(room, levelNodeId, style);

    if (generated !== undefined) {
      const [ceiling, light] = generated;
      const lightOn = !offIds.has(lightOffIdOf(room.id));

      nodes[ceiling.id] = lightOn ? ceiling : { ...ceiling, children: [] };
      adopt(levelNodeId, ceiling.id);
      if (lightOn) {
        nodes[light.id] = withFields(light, { [PROV_FIELD]: provenanceOf('light:ceiling', room.id) });
        roomsWithLight.add(room.id);
      }
    }
  }

  /* Mép lô gia máy chủ cố ý để hở (không có tường): cùng kiểu lan can với tường bao lô gia ở trên. */
  for (const room of builtRooms) {
    const levelNodeId = levelNodeIdOf.get(room.levelId);
    const levelHeightMm = levelHeightMmOf.get(room.levelId);
    if (room.usage !== 'loggia' || levelNodeId === undefined || levelHeightMm === undefined) continue;
    for (const { key, start, end } of loggiaOpenSpansOf(room, builtWalls, graph.rooms)) {
      addRailing({ anchor: `${room.id}-${key}`, levelId: room.levelId, start, end, thicknessMm: OPEN_RAILING_THICKNESS_MM }, levelNodeId, levelHeightMm, room.id);
    }
  }

  /* Đồ AI chưa duyệt còn góc 0 quay theo bàn/tường (`orientDetected`); quầy bếp cỡ khối đặc tách thành dãy tủ
     sát tường (`kitchenRuns`) — cả hai chỉ ở cảnh, không ghi về BE khi chưa sửa. */
  const expanded = expandKitchenRuns(orientDetectedFurniture(graph.furniture, graph.walls), builtWalls);
  const furnitureToBuild = expanded.filter((f) => !offIds.has(f.id));
  const graphFurnitureIds = graph.furniture.map((f) => f.id as string);
  /* V4 — món sinh đã thành đồ thật RIÊNG LẺ (`dressingOff` có `DRESS-x` + đồ thật id `adoptedFurnitureIdOf(x)`): lớp
     dẫn xuất tính như khi nó còn là đồ sinh — đồ thật ấy không chặn bày phòng, bản sinh ("twin") vẫn dự phần đăng ký
     bộ/chủ trang trí nhưng không dựng (đồ thật dựng thay). Nhờ vậy anh em giữ chỗ và mẫu sau khi lưu. Dữ liệu cũ (cả
     phòng đã nhận, id ngẫu nhiên) không có cặp nào: đọc y như trước. */
  const graphIdSet = new Set<string>(graphFurnitureIds);
  const twinIds = new Set([...offIds].filter((id) => graphIdSet.has(adoptedFurnitureIdOf(id))));
  const adoptedIds = new Set<string>([...twinIds].map(adoptedFurnitureIdOf));
  const ruleAdopted = ruleAdoptedIdsOf(graph.rooms, graph.furniture);
  /** Mẫu LUẬT CHỌN của món đã nhận (cặp chắc chắn, `ruleAdoptedIdsOf`; không phải mẫu người dùng đổi): thư mục, hoặc undefined. */
  const ruleFolderOf = (f: Furniture): string | undefined => {
    if (!ruleAdopted.has(f.id) || f.model === undefined) return undefined;
    const folder = SWAPPED_MODEL_SRC.exec(f.model.src)?.[1];
    return folder !== undefined && Object.prototype.hasOwnProperty.call(CATALOG_MODELS, folder) ? folder : undefined;
  };

  /* Vai trò theo ngữ cảnh phòng (bồn cầu thừa → lavabo, bàn nhỏ xa giường → bàn phụ): chỉ đổi mẫu. */
  const contextUsageOf = (f: Pick<Furniture, 'roomId'>) => (f.roomId === undefined ? undefined : roomUsageOf.get(f.roomId));
  // `roomset` băm theo nội dung phòng, không theo id (chép sang dự án khác giữ nguyên nội thất).
  // Trần phòng = chiều cao tầng dựng tường (`roomset` chừa hở trần cho món cao).
  setRoomSetKeys(
    roomSetKeysOf(builtRooms.map((room) => ({ id: room.id, levelId: room.levelId, usage: roomUsageOf.get(room.id), outline: room.outline }))),
    new Map(builtRooms.flatMap((room) => {
      const mm = levelHeightMmOf.get(room.levelId);
      return mm === undefined ? [] : [[room.id as string, mm / 1000] as const];
    })),
  );
  // Món đã nhận còn mẫu luật chọn: twin đại diện trong sổ bộ (như trước khi nhận), không thành đồ cố định của bảng màu.
  const contextRoles = contextRolesOf(
    furnitureToBuild.filter((f) => f.suggested !== true && ruleFolderOf(f) === undefined),
    contextUsageOf,
  );

  for (const furniture of furnitureToBuild) {
    /* Gợi ý của máy chưa được nhận thì chưa vào cảnh 3D (B3, C6): chỉ một viền mỏng trên sàn,
       đồ sinh ra (`DRESS-`) nên không bao giờ lưu, không tính là đồ. */
    if (furniture.suggested === true) {
      skipped.push(skip(furniture.id, 'đồ đạc', 'Gợi ý của máy chưa được nhận.'));
      const outlineLevel = levelNodeIdOf.get(furniture.levelId);
      const outline = suggestedOutlineOf(furniture, outlineLevel, levelHeightMmOf.get(furniture.levelId), style);
      if (outline !== null && outlineLevel !== undefined) {
        nodes[outline.id] = withFields(outline, { [PROV_FIELD]: provenanceOf('suggested', furniture.id) });
        adopt(outlineLevel, outline.id);
      }
      continue;
    }

    const levelNodeId = levelNodeIdOf.get(furniture.levelId);
    /* Hai bảng luôn được đặt cùng lúc, nên `undefined` ở đây nghĩa là tầng đã bị
       bỏ qua — cùng một lý do, không phải hai. */
    const levelHeightMm = levelHeightMmOf.get(furniture.levelId);

    if (levelNodeId === undefined || levelHeightMm === undefined) {
      skipped.push(
        skip(furniture.id, 'đồ đạc', `Đồ đạc thuộc tầng ${furniture.levelId} mà tầng ấy không có trong bản vẽ.`),
      );
      continue;
    }

    if (
      !isUsable(
        furniture.centre.x,
        furniture.centre.y,
        furniture.rotationDeg,
        furniture.boundingBox.min.x,
        furniture.boundingBox.min.y,
        furniture.boundingBox.max.x,
        furniture.boundingBox.max.y,
      )
    ) {
      skipped.push(skip(furniture.id, 'đồ đạc', 'Vị trí, góc quay hoặc hộp bao không phải một số đo được.'));
      continue;
    }

    builtFurniture.push(furniture);

    if (furniture.kind === 'stair') {
      const [stair, segment] = stairNodesOf(furniture, levelNodeId, levelHeightMm, style);

      /* V5 — ký hiệu dò nhầm (0,25 × 0,84 m) không dựng cột thang, nhưng node vẫn phải có:
         thiếu node là lượt lưu đọc thành xoá. Ẩn đi; lượt về không đọc `visible`. */
      nodes[stair.id] = isPlausibleStair(furniture) ? stair : { ...stair, visible: false };
      nodes[segment.id] = segment;
      adopt(levelNodeId, stair.id);
      continue;
    }

    const usage = furniture.roomId === undefined ? undefined : roomUsageOf.get(furniture.roomId);
    const room =
      builtRooms.find((r) => r.id === furniture.roomId) ??
      builtRooms.find((r) => r.levelId === furniture.levelId && insideOutline(furniture.centre, r.outline));
    const arms = lShapedRunArms(furniture, room, { ...graph, walls: builtWalls, openings: builtOpenings });
    const usageOf = (f: Furniture) => (f.roomId === undefined ? undefined : roomUsageOf.get(f.roomId));
    const contextRole = contextRoles.get(furniture.id);
    const sinkFolder =
      sinkFolderOf(furniture, furnitureToBuild, usageOf) ??
      (contextRole === undefined ? undefined : (modelFolderOf(furniture, style, usage, contextRole) ?? undefined));
    // Mẫu luật chọn của món đã nhận dựng như đồ sinh (cùng đường hoán đổi hiển thị) + ghi lại thư mục để lượt về giữ.
    const ruleFolder = ruleFolderOf(furniture);
    const built = ruleFolder === undefined ? furniture : withoutModel(furniture);
    const folderFor = ruleFolder ?? sinkFolder;
    const rawNode =
      arms === null
        ? itemNodeOf(built, levelNodeId, levelHeightMm, style, usage, counterTopMmOf(furniture, furnitureToBuild, style, usageOf), folderFor)
        : longArmNodeOf(
            built,
            arms.long,
            itemNodeOf({ ...built, ...arms.long }, levelNodeId, levelHeightMm, style, usage, 0, folderFor),
          );
    const node = ruleFolder === undefined ? rawNode : withFields(rawNode, { [MODEL_FOLDER_FIELD]: ruleFolder });

    /* Hộp quầy gốc vẫn phải có node (thiếu = lượt lưu đọc thành xoá) nhưng ẩn; dãy tủ thay nó là đồ sinh ra.
       Thảm lạc ngoài phòng (`isStrayRug`) cũng vậy: giữ node để lưu không xoá, chỉ không trải ra sân trống. */
    const shown = isKitchenRunHost(furniture) || isStrayRug(furniture, builtRooms)
      ? { ...node, visible: false }
      : isGeneratedNodeId(node.id)
        ? withFields(
            { ...node, metadata: { ...node.metadata, generated: 'dressing' } },
            { [PROV_FIELD]: provenanceOf(roleInId(furniture.id), hostIn(furniture.id, graphFurnitureIds)) },
          )
        : node;
    const repair = repairs?.get(furniture.id);
    const provShown = withRoomSetProv(shown, furniture.id);
    nodes[node.id] = repair === undefined ? provShown : withFields(provShown, { [REPAIR_FIELD]: repair });
    adopt(levelNodeId, node.id);

    /* V1 — nhánh thứ hai của dãy tủ chữ L: đồ sinh ra (`isGeneratedNodeId`). */
    if (arms !== null && !offIds.has(arms.leg.id)) {
      const leg = itemNodeOf(arms.leg, levelNodeId, levelHeightMm, style, usage);

      nodes[leg.id] = withFields({ ...leg, metadata: { ...leg.metadata, generated: 'dressing' } }, { [PROV_FIELD]: provenanceOf('runLeg', furniture.id) });
      adopt(levelNodeId, leg.id);
    }
  }

  /*
   * Đồ sinh ra (J10): bày phòng trống rồi bày biện, cùng đường `itemNodeOf` với đồ thật, sau
   * đồ thật. Không bao giờ được lưu (`isGeneratedNodeId`), không tính vào `skipped`: món nào
   * không dựng được thì bỏ im lặng. Chỉ chạy khi `furnish: 'on'` — mặc định cảnh không tự thêm đồ.
   */
  const baseFurniture = builtFurniture.filter((f) => !adoptedIds.has(f.id));
  const usable = {
    ...graph,
    walls: builtWalls,
    openings: builtOpenings,
    rooms: builtRooms.map((room) => ({ ...room, usage: furnishingUsageOf(room) })),
    furniture: baseFurniture,
  };
  /* H4 — món tự bày người dùng đã xoá (`offIds`) không bày lại; lọc trước `dressingOf`
     để gối/đèn không bày lên một cái giường đã xoá. Twin thì giữ tới lúc dựng (`notOff`). */
  const notOff = (furniture: Furniture): boolean => !offIds.has(furniture.id);
  const inLayer = (furniture: Furniture): boolean => notOff(furniture) || twinIds.has(furniture.id);
  const furnishedAll = furnish === 'on' ? furnishEmptyRooms(usable, style) : [];
  const builtById = new Map<string, Furniture>(builtFurniture.map((f) => [f.id, f]));
  /* Twin đứng ở chỗ/góc của đồ thật (giữ cỡ gốc: chữ ký bộ không đổi) → chăn, thảm, đèn trên mặt đi theo món đã dời/xoay. */
  const atAdopted = (f: Furniture): Furniture => {
    const real = twinIds.has(f.id) ? builtById.get(adoptedFurnitureIdOf(f.id)) : undefined;
    if (real === undefined) return f;
    const dx = real.centre.x - f.centre.x;
    const dy = real.centre.y - f.centre.y;
    const { min, max } = f.boundingBox;
    return {
      ...f,
      centre: real.centre,
      rotationDeg: real.rotationDeg,
      boundingBox: { min: { x: min.x + dx, y: min.y + dy }, max: { x: max.x + dx, y: max.y + dy } },
    };
  };
  const furnished = furnishedAll.filter(inLayer).map(atAdopted);
  // `roomset`: đồ bày phòng trống vào sổ bộ của phòng trước lớp trang trí (đèn bàn/chăn đọc mẫu món chủ).
  addRoomSetMembers(furnished, (f) => (f.roomId === undefined ? undefined : roomUsageOf.get(f.roomId)));
  const dressedAll = furnish === 'on' ? dressingOf({ ...usable, furniture: [...baseFurniture, ...furnished] }, style) : [];
  const dressed = dressedAll.filter(inLayer);
  const builtRoomIds = new Set(builtRooms.map((room) => room.id));
  const aiAll = designAdditionsOf(
    additions.filter((addition) => builtRoomIds.has(addition.roomId as Room['id'])),
    [...baseFurniture, ...furnished],
  );
  const aiAdded = aiAll.filter(inLayer);
  /* Provenance: bày phòng trống = vai + phòng; đồ AI = phòng; trang trí = vai + món/ô mở/phòng chủ (id dài nhất khớp). */
  const furnishedIds = new Set<string>(furnishedAll.map((f) => f.id));
  const aiIds = new Set<string>(aiAll.map((f) => f.id));
  const hostPool = [...builtFurniture, ...furnished, ...builtOpenings, ...builtRooms].map((e) => e.id as string);
  const provOfGenerated = (f: Furniture): SceneProvenance =>
    furnishedIds.has(f.id)
      ? provenanceOf(`furnish:${roleInId(f.id)}`, f.roomId)
      : aiIds.has(f.id)
        ? provenanceOf('ai', f.roomId)
        : provenanceOf(`dress:${roleInId(f.id)}`, hostIn(f.id, hostPool));
  const dressIdsOf = new Map<string, string[]>();
  // AI (designAdditionsOf) đặt thảm theo tâm nó tự chọn và thảm không bị chặn chồng: tâm ngoài phòng → bỏ.
  /* Chặn chồng: twin không dự (đồ thật dựng thay; anh em giữ nguyên dù người dùng dời món sát chúng). Món đã nhận mà
     twin không còn sinh (đổi công năng phòng…) là đồ thật thường: đồ sinh mới không được chồng lên nó. */
  // Twin còn được sinh ở đâu đó lượt này: lớp dẫn xuất hoặc dãy tủ tách từ quầy (`expanded`).
  const layerIds = new Set<string>([...furnished, ...dressed, ...aiAdded, ...expanded].map((f) => f.id));
  const orphans = builtFurniture.filter((f) => adoptedIds.has(f.id) && ![...twinIds].some((id) => layerIds.has(id) && adoptedFurnitureIdOf(id) === f.id));
  const generatedAll = withoutOverlaps(
    [...furnished, ...dressed, ...aiAdded].filter((f) => notOff(f) && !isStrayRug(f, builtRooms)),
    [...baseFurniture, ...orphans],
  );
  /* Chậu/mặt bếp sinh ra nằm trên mặt đá dãy tủ sinh ra (hoặc thật), như đường đồ thật ở trên. */
  const counterPool = [...builtFurniture, ...generatedAll];
  const usageOfGenerated = (f: Furniture) => (f.roomId === undefined ? undefined : roomUsageOf.get(f.roomId));

  // Vòng 11 b2 `?enable=libroles2`: đèn sinh dựng bằng mẫu thư viện có texture lọt chỗ đặt (`libraryRoles2.ts`).
  for (const furniture of libRoles2Apply(generatedAll, style)) {
    const levelNodeId = levelNodeIdOf.get(furniture.levelId);
    const levelHeightMm = levelHeightMmOf.get(furniture.levelId);

    if (levelNodeId === undefined || levelHeightMm === undefined) continue;

    const usage = furniture.roomId === undefined ? undefined : roomUsageOf.get(furniture.roomId);
    const node = itemNodeOf(
      furniture,
      levelNodeId,
      levelHeightMm,
      style,
      usage,
      counterTopMmOf(furniture, counterPool, style, usageOfGenerated),
      sinkFolderOf(furniture, counterPool, usageOfGenerated),
    );

    nodes[node.id] = withRoomSetProv(
      withFields({ ...node, metadata: { ...node.metadata, generated: 'dressing' } }, { [PROV_FIELD]: provOfGenerated(furniture) }),
      furniture.id,
    );
    adopt(levelNodeId, node.id);
    if (furniture.roomId !== undefined) dressIdsOf.set(furniture.roomId, [...(dressIdsOf.get(furniture.roomId) ?? []), furniture.id]);
  }

  /* Món sinh ra không `roomId` (lan can, dãy tủ, nhánh chữ L, đồ trang trí) cũng phải có phòng khai hộ, không
     thì xoá/sửa nó không nhớ được: phòng chứa tâm món, không có thì phòng đầu của tầng. Tầng không có phòng nào
     thì không ai khai (`usePascalEdits` chặn). */
  const declared = new Set([...builtRoomIds].flatMap((roomId) => dressIdsOf.get(roomId) ?? []));

  for (const node of Object.values(nodes)) {
    if (node.type !== 'item' || !isGeneratedNodeId(node.id) || isGeneratedLightId(node.id) || node.metadata?.unconfirmed === true) continue;
    const dressId = bodyOfPascalId(node.id);
    if (declared.has(dressId)) continue;
    const onLevel = builtRooms.filter((room) => levelNodeIdOf.get(room.levelId) === node.parentId);
    const centre = { x: node.position[0] * 1000, y: node.position[2] * 1000 };
    const holder = onLevel.find((room) => insideOutline(centre, room.outline)) ?? onLevel[0];
    if (holder !== undefined) dressIdsOf.set(holder.id, [...(dressIdsOf.get(holder.id) ?? []), dressId]);
  }

  /* H4 — zone mang danh sách món tự bày của phòng (`dressIds`, kể cả đèn trần) và danh sách đã bỏ (`dressingOff`):
     lượt về thấy món nào trong `dressIds` vắng khỏi cảnh thì thêm vào `dressingOff` (`toSpatial`).
     `dressingOff` tự dọn theo SỰ TỒN TẠI của đầu vào luật, không theo kết quả bố trí lượt này: id bị bỏ khi họ luật
     của nó có chạy mà không còn phần tử gốc nào (phòng, ô mở, tường, đồ) nằm trong id. Món chủ đã tắt (thảm theo giường
     đã tắt) hay món bị đồ khác chặn tạm vẫn giữ trạng thái tắt. Họ luật không chạy lượt này (tự bày tắt vì có concept,
     không có đồ AI) thì giữ nguyên: vắng mặt không có nghĩa là gốc đã mất. */
  const ranFor = (id: string): boolean =>
    id.startsWith(AI_ID_PREFIX) ? additions.length > 0 : furnish === 'on' || ALWAYS_RUN_PREFIXES.some((prefix) => id.startsWith(prefix));
  const sourceIds = new Set<string>([...graph.rooms, ...graph.openings, ...graph.walls, ...graph.furniture].map((e) => e.id));
  /** Có phần tử gốc nào trong đồ thị nằm trong id (khớp trọn đoạn giữa các dấu `-`, nên `R-1` không khớp `R-10`). */
  const hasSource = (id: string): boolean => {
    const parts = id.split('-');
    for (let from = 0; from < parts.length; from += 1) {
      for (let to = from + 1; to <= parts.length; to += 1) if (sourceIds.has(parts.slice(from, to).join('-'))) return true;
    }
    return false;
  };
  for (const room of builtRooms) {
    const zoneId = toPascalId('zone', room.id);
    const zone = nodes[zoneId];
    const origin = zone?.metadata?.appfront;

    if (zone === undefined || origin === undefined) continue;
    nodes[zoneId] = {
      ...zone,
      metadata: {
        ...zone.metadata,
        appfront: {
          ...origin,
          fields: {
            ...origin.fields,
            dressIds: [...(dressIdsOf.get(room.id) ?? []), ...(roomsWithLight.has(room.id) ? [lightOffIdOf(room.id)] : [])],
            dressingOff: (room.dressingOff ?? []).filter((id) => !ranFor(id) || hasSource(id)),
          },
        },
      },
    };
  }

  for (const axis of graph.axes) {
    const levelNodeId = levelNodeIdOf.get(axis.levelId);

    if (levelNodeId === undefined) {
      skipped.push(skip(axis.id, 'trục định vị', `Trục thuộc tầng ${axis.levelId} mà tầng ấy không có trong bản vẽ.`));
      continue;
    }

    const { start, end } = axis.line;

    if (!isUsable(start.x, start.y, end.x, end.y)) {
      skipped.push(skip(axis.id, 'trục định vị', 'Toạ độ hai đầu trục không phải một số đo được.'));
      continue;
    }

    const node = gridNodeOf(axis, levelNodeId);

    nodes[node.id] = node;
    adopt(levelNodeId, node.id);
  }

  /* Mái: node Pascal nguyên dạng từ `Roof.nodes` (`roofs.ts`), gắn dưới tầng của nó. */
  for (const roof of graph.roofs ?? []) {
    const levelNodeId = levelNodeIdOf.get(roof.levelId);

    if (levelNodeId === undefined) {
      skipped.push(skip(roof.id, 'mái', `Mái thuộc tầng ${roof.levelId} mà tầng ấy không có trong bản vẽ.`));
      continue;
    }

    const built = roofNodesOf(roof, levelNodeId);

    if (typeof built === 'string') {
      skipped.push(skip(roof.id, 'mái', built));
      continue;
    }

    for (const node of built) nodes[node.id] = node;
    adopt(levelNodeId, toPascalId('roof', roof.id));
  }

  for (const dimension of graph.dimensions) {
    skipped.push(skip(dimension.id, 'kích thước', 'Kích thước của bản vẽ chưa được chuyển sang Pascal ở bản đầu.'));
  }

  for (const note of graph.notes) {
    skipped.push(skip(note.id, 'ghi chú', 'Ghi chú gắn với đối tượng chưa được chuyển sang Pascal ở bản đầu.'));
  }

  nodes[BUILDING_NODE_ID] = {
    object: 'node',
    id: BUILDING_NODE_ID,
    type: 'building',
    name: graph.building.name,
    parentId: SITE_NODE_ID,
    children: childrenFor(BUILDING_NODE_ID),
    position: [0, 0, 0],
    rotation: [0, 0, 0],
    metadata: {
      appfront: originOf(graph.building, {
        name: graph.building.name,
        datumElevationMm: graph.building.datumElevationMm,
        ...(graph.building.address === undefined ? {} : { address: graph.building.address }),
        ...(graph.building.grossFloorAreaM2 === undefined
          ? {}
          : { grossFloorAreaM2: graph.building.grossFloorAreaM2 }),
      }),
    },
  };

  nodes[SITE_NODE_ID] = {
    object: 'node',
    id: SITE_NODE_ID,
    type: 'site',
    name: 'Khu đất',
    parentId: null,
    children: [BUILDING_NODE_ID],
    polygon: sitePolygonOf(nodes),
    // Khu đất HIỆN để có nền đỡ + bóng đổ; đường ranh vàng bị tắt lúc dựng
    // (`scripts/pascal-render.mjs` luật 5) — nhà mẫu trang đăng nhập không có ranh đất.
  };


  const materials = Object.fromEntries([...SCENE_MATERIALS, ...SCENE_STYLE_MATERIALS].map((material) => [material.id, material]));
  /* Báo cáo 2.8.2: tầng căn được theo lưới trục chung thì xoay + dời khi HIỂN THỊ; lượt về gỡ ra. */
  applyFloorTransforms(nodes, floorDisplayTransformsOf(graph), (levelId) => toPascalId('level', levelId));
  /* M5 làn 3c — thử nghiệm `?buildx=trim|win` (mặc định không đổi gì). */
  applyBuildx(nodes);

  const generatedByRule: Record<string, number> = {};
  let repaired = 0;
  for (const node of Object.values(nodes)) {
    const fields = node.metadata?.appfront?.fields;
    const prov = fields?.[PROV_FIELD] as SceneProvenance | undefined;
    if (prov !== undefined && prov.cls === 'generated') generatedByRule[prov.rule] = (generatedByRule[prov.rule] ?? 0) + 1;
    if (fields?.[REPAIR_FIELD] !== undefined) repaired += 1;
  }

  return {
    scene: { nodes, rootNodeIds: [SITE_NODE_ID], materials },
    skipped,
    layer: { version: SCENE_LAYER_VERSION, generatedByRule, repairs: repaired },
  };
};
