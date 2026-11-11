/**
 * Pascal → AppFront: cảnh `{ nodes, rootNodeIds }` thành đồ thị không gian.
 *
 * Đây là lượt về của `toPascal.ts`, và nó **không** phải một phép đảo máy móc.
 * Ba chỗ nó cố ý không đối xứng:
 *
 * 1. **Dấu xác minh không đi ngược chiều tự do (A5).** Chỉ node nào dịch được
 *    id về một id AppFront hợp lệ — tức node do chính AppFront viết ra — mới
 *    được mang `reviewed` của mình về. Node Pascal tự đẻ mang id nanoid,
 *    không qua được phép kiểm, và luôn về `reviewed: false`. Người duyệt đặt
 *    dấu ấy, không phải công cụ vẽ.
 * 2. **Cao độ tầng tính lại bằng chính luật của Pascal**, không đọc lại từ
 *    siêu dữ liệu. Tầng người dùng vừa chèn trong Pascal nhờ thế cũng rơi đúng
 *    chỗ, và một lỗi trong phép tính `baseElevation` của lượt đi sẽ hiện ra ở
 *    bài kiểm vòng tròn chứ không bị siêu dữ liệu che.
 * 3. **Chỉ đi theo cây từ gốc.** Node không với tới được từ `rootNodeIds`
 *    không vào đồ thị; nó vào danh sách bỏ qua. Một node mồ côi trong cảnh là
 *    thứ người dùng không thấy, và đưa nó vào bản vẽ là thêm dữ liệu từ hư
 *    không.
 *
 * Mọi số đo về đều **làm tròn tới milimét** (`roundMeasurement`). Không có
 * dòng này thì `4,251 m × 1000` ra `4251,0000000000005 mm`, và bài kiểm 100
 * vòng đổi qua đổi lại sẽ trôi dần.
 */

import { undoFloorTransforms } from './floorAlignment';
import { computeArea } from '@/domain/rooms/area';
import { millimetresPerPixel } from '@/domain/units/scale';
import { createId, isIdOfKind, type EntityKind, type IdByKind } from '@/domain/spatial/ids';
import type {
  Axis,
  AxisDirection,
  BoundingBox,
  Building,
  Furniture,
  FurnitureKind,
  Level,
  LevelId,
  DoorStyle,
  Opening,
  OpeningId,
  Point,
  ReviewMetadata,
  MaterialRef,
  Roof,
  Room,
  RoomFinish,
  RoomId,
  RoomUsage,
  SpatialGraph,
  SwingDirection,
  Wall,
  WallId,
  WallKind,
  WallPaint,
} from '@/domain/spatial/types';
import { FURNITURE_VARIANTS, STAIR_VARIANTS } from '@/domain/spatial/types';
import {
  degrees as asDegrees,
  metres,
  metresToMillimetres,
  millimetres,
  normaliseDegrees,
  radians,
  radiansToDegrees,
  roundMeasurement,
} from '@/domain/units/types';
import { AUTHORED_BY_HAND, toPointMm } from '@/lib/commands/business/shared';

import { isServerModel, serverKindOf, serverModelPath } from './furnitureCatalog';
import { appFrontIdOf, BUILDING_NODE_ID, toPascalId } from './ids';
import { LIBRARY_MATERIAL_IDS } from './libraryMaterialIds';
import { worldBoxOf } from './orientDetected';
import { roofOf } from './roofs';
import { DRESSING_OFF_MAX } from './sceneLayer';
import { drapeSavedSrc } from './sceneDressingDrape';
import {
  CEILING_DEFAULT,
  dressNodeIdOf,
  isGeneratedLightId,
  OUTLINE_PAINT_SLOT,
  isGeneratedNodeId,
  SCENE_MATERIALS,
} from './sceneDressing';
import { SCENE_STYLE_MATERIALS, SCENE_STYLES, sceneStyleOf } from './sceneStyles';
import type {
  PascalDoorNode,
  PascalLevelNode,
  PascalNode,
  PascalNodeId,
  PascalNodeType,
  PascalScene,
  PascalItemNode,
  PascalVec3,
  PascalWallNode,
  PascalWindowNode,
  SkippedEntity,
} from './types';

/** Kết quả một lượt đổi Pascal → AppFront. */
export interface SpatialGraphResult {
  readonly graph: SpatialGraph;
  /** Node không đưa vào đồ thị được; `id` ở đây là id **phía Pascal**. */
  readonly skipped: readonly SkippedEntity[];
}

/**
 * Sổ id của một phiên gắn Pascal: id node Pascal → id AppFront đã cấp cho nó.
 *
 * Node do người dùng vẽ trong Pascal chưa có id AppFront, nên lượt đổi đầu
 * tiên cấp cho nó một cái. Không nhớ lại thì lượt đổi **sau** cấp một id khác
 * nữa, và một bức tường hoá thành hai. Sổ này là chỗ nhớ; nó sống đúng bằng
 * một lượt gắn Pascal và người gọi giữ nó.
 */
export type PascalIdBook = Map<PascalNodeId, string>;

/** Dòng bỏ qua cho đồ Pascal gắn dưới trần; `fromPascal` đọc `kind` này để từ chối lượt sửa. */
export const CEILING_FIXTURE_KIND = 'đồ gắn trần';
export const CEILING_FIXTURE_REASON = 'Đồ gắn trần chưa lưu được trong bản này. Hãy đặt đèn, quạt lên sàn hoặc tường.';

/**
 * A2-13/Y-16: câu từ chối người dùng đọc không còn "Pascal", "node" hay tên loại tiếng Anh —
 * tên thường của loại đối tượng; loại lạ thì "Đối tượng này".
 */
const NODE_TYPE_LABELS: Readonly<Record<string, string>> = {
  block: 'Khối',
  cabinet: 'Tủ',
  column: 'Cột',
  'construction-dimension': 'Đường kích thước',
  'curtain-wall': 'Vách kính',
  door: 'Cửa đi',
  elevator: 'Thang máy',
  fence: 'Hàng rào',
  guide: 'Ảnh tham chiếu',
  'imported-mesh': 'Mô hình nhập',
  item: 'Đồ vật',
  measurement: 'Số đo',
  scan: 'Bản quét',
  shelf: 'Kệ',
  skylight: 'Cửa sổ mái',
  'solar-panel': 'Tấm pin mặt trời',
  spawn: 'Điểm bắt đầu đi bộ',
  unit: 'Căn hộ',
  window: 'Cửa sổ',
};
const nodeTypeLabel = (type: string): string => NODE_TYPE_LABELS[type] ?? 'Đối tượng này';
const lower = (label: string): string => label.charAt(0).toLowerCase() + label.slice(1);

/** Số chữ số thập phân giữ lại của một góc, đủ để `độ → radian → độ` khép lại. */
const ANGLE_PRECISION = 1e6;

/** Số điểm tối thiểu để một đường bao là một đa giác. */
const MIN_OUTLINE_POINTS = 3;

/** `DEFAULT_WALL_THICKNESS` của vendor (`core/src/systems/wall/wall-footprint.ts`), mét. */
const DEFAULT_WALL_THICKNESS_M = 0.1;

const isUsable = (...values: readonly number[]): boolean => values.every(Number.isFinite);

/** Mét sang milimét, đã làm tròn về lưới một milimét. */
const millimetresOf = (valueM: number): number =>
  roundMeasurement(metresToMillimetres(metres(valueM)));

/** Góc quanh trục `y` của Pascal trở lại góc mặt bằng của AppFront. */
const planDegreesOf = (yaw: number): number => {
  const raw = radiansToDegrees(radians(-yaw));

  // `+ 0` gộp -0 về 0: yaw đi vòng qua phép xoay tầng (báo cáo 2.8.2) không được thành một lần sửa.
  return normaliseDegrees(asDegrees(Math.round(raw * ANGLE_PRECISION) / ANGLE_PRECISION)) + 0;
};

/** Cấp id AppFront cho một node Pascal, nhớ lại nếu phiên này đã cấp rồi. */
const minterFor =
  (book: PascalIdBook | undefined) =>
  <K extends EntityKind>(kind: K, nodeId: PascalNodeId): IdByKind[K] => {
    const remembered = book?.get(nodeId);

    if (remembered !== undefined && isIdOfKind(kind, remembered)) {
      return remembered;
    }

    const created = createId(kind);

    book?.set(nodeId, created);

    return created;
  };

/** Cấp id như trên, dùng chung một sổ trong suốt một lượt đổi. */
type Minter = ReturnType<typeof minterFor>;

/** Lọc node theo loại, kèm thu hẹp kiểu — `filter` trần không thu hẹp được. */
const ofType =
  <T extends PascalNodeType>(type: T) =>
  (node: PascalNode): node is Extract<PascalNode, { type: T }> =>
    node.type === type;

/* -------------------------------------------------------------------------- */
/* Đọc siêu dữ liệu — dữ liệu từ bên kia tường, nên đọc là phải kiểm.          */
/* -------------------------------------------------------------------------- */

type Fields = Readonly<Record<string, unknown>>;

const fieldsOf = (node: PascalNode): Fields => node.metadata?.appfront?.fields ?? {};

const readNumber = (fields: Fields, key: string): number | null => {
  const value = fields[key];

  return typeof value === 'number' && Number.isFinite(value) ? value : null;
};

const readString = (fields: Fields, key: string): string | null => {
  const value = fields[key];

  return typeof value === 'string' ? value : null;
};

const readOneOf = <T extends string>(fields: Fields, key: string, allowed: readonly T[]): T | null => {
  const value = fields[key];

  return typeof value === 'string' && (allowed as readonly string[]).includes(value)
    ? (value as T)
    : null;
};

/** Một điểm mặt bằng (mm) trong `fields[key][side]`, hoặc `null`. */
const readPlanPoint = (fields: Fields, key: string, side: 'start' | 'end'): { x: number; y: number } | null => {
  const line = fields[key];
  const point = typeof line === 'object' && line !== null ? (line as Record<string, unknown>)[side] : undefined;
  if (typeof point !== 'object' || point === null) return null;
  const { x, y } = point as Record<string, unknown>;
  return typeof x === 'number' && typeof y === 'number' && isUsable(x, y) ? { x, y } : null;
};

/** Ngưỡng (mm): đầu tường cách điểm đã dồn trong ngưỡng này là người dùng chưa dời nó. */
const WELD_UNTOUCHED_MM = 1;

/**
 * V6 — đầu tường lúc đổi sang Pascal bị dồn (`weldWallEnds`): đầu vẫn nằm ở điểm dồn
 * (`weldedTo`) thì trả trục gốc (`weldedFrom`), để sửa sơn/chiều cao không lưu một cú dời ~25 mm.
 */
const unweldedEndOf = (wall: PascalWallNode, side: 'start' | 'end'): { x: number; y: number } => {
  const [xM, yM] = wall[side];
  const at = { x: millimetresOf(xM), y: millimetresOf(yM) };
  const fields = fieldsOf(wall);
  const to = readPlanPoint(fields, 'weldedTo', side);
  const from = readPlanPoint(fields, 'weldedFrom', side);
  return to !== null && from !== null && Math.hypot(at.x - to.x, at.y - to.y) <= WELD_UNTOUCHED_MM ? from : at;
};

/* -------------------------------------------------------------------------- */
/* W3a — sơn sàn/tường.                                                        */
/* -------------------------------------------------------------------------- */

const MATERIAL_REF = /^(library|scene):[a-z0-9_-]{1,64}$/;

/**
 * Vật liệu ghi được: vật liệu phẳng của AppFront, mọi tham chiếu các phong cách dùng, và
 * mọi vật liệu thư viện của vendor (`LIBRARY_MATERIAL_IDS`, máy chủ nhận mọi `library:<id>`).
 * Màu tự pha (`scene.materials` người dùng thêm) chưa lưu được — thông báo V3 nói ra.
 */
const SAVEABLE_REFS: ReadonlySet<string> = new Set([
  ...[...SCENE_MATERIALS, ...SCENE_STYLE_MATERIALS].map((material) => `scene:${material.id}`),
  ...Object.values(SCENE_STYLES).flatMap((style) => [
    ...Object.values(style.floor),
    style.wall.interior,
    style.wall.exterior,
    ...Object.values(style.families),
  ]),
  ...LIBRARY_MATERIAL_IDS.map((id) => `library:${id}`),
]);

export const saveableRef = (ref: string | undefined): ref is MaterialRef =>
  ref !== undefined && MATERIAL_REF.test(ref) && SAVEABLE_REFS.has(ref);

/**
 * Mặt sàn `slab_<phòng>` → trường của phòng. Bằng mặt phong cách cho: không ghi gì.
 * Trùng sàn của một `finish` trong phong cách đang dùng: ghi `finish` (đổi phong cách
 * thì sàn đổi theo). Khác nữa: ghi `floorMaterial`.
 */
const floorFieldsOf = (
  scene: PascalScene,
  roomId: RoomId,
): { finish?: RoomFinish; floorMaterial?: MaterialRef } => {
  const slab = scene.nodes[`slab_${roomId}`];
  const surface = slab?.type === 'slab' ? slab.slots['surface'] : undefined;
  const fields = slab === undefined ? {} : fieldsOf(slab);

  if (surface === readString(fields, 'styleSurface') || !saveableRef(surface)) return {};

  const style = sceneStyleOf(fields['style']);
  const finish = (Object.keys(style.floor) as RoomFinish[]).find((key) => style.floor[key] === surface);

  return finish === undefined ? { floorMaterial: surface } : { finish };
};

/**
 * H4 — kiểu cửa đi Pascal → `Opening.swing` (+ `doorStyle`, `reversed`). Trường đọc lỏng (`string`):
 * Pascal có cả french/barn/garage-* mà AppFront không ghi ra. Bản lề một cánh theo `hingesSide`;
 * french = hai cánh; barn = lùa; garage-* chưa có chỗ chứa → giữ `swing` đã lưu (`unsavedPascalEdits` báo).
 */
const doorSwingOf = (
  door: PascalDoorNode,
  fields: Fields,
): Pick<Opening, 'swing'> & { doorStyle?: DoorStyle; reversed?: boolean } => {
  const stored = readOneOf(fields, 'swing', SWING_DIRECTIONS) ?? 'left';

  if (door.openingKind === 'opening') return { swing: 'fixed' };

  const type: string = door.doorType ?? 'hinged';

  if (type === 'sliding' || type === 'pocket' || type === 'barn' || type === 'folding') {
    return {
      swing: 'sliding',
      ...(type === 'pocket' || type === 'folding' ? { doorStyle: type } : {}),
      ...(type !== 'folding' && door.slideDirection === 'right' ? { reversed: true } : {}),
    };
  }

  if (type !== 'hinged' && type !== 'double' && type !== 'french') return { swing: stored };

  const rule = readOneOf(fields, 'ruleSwing', ['inward', 'outward'] as const);
  const reversed = rule !== null && door.swingDirection !== undefined && door.swingDirection !== rule;
  const swing =
    type !== 'hinged' || (door.leafCount ?? 1) >= 2 ? 'double' : door.hingesSide === 'right' ? 'right' : 'left';

  return { swing, ...(reversed ? { reversed: true } : {}) };
};

/** H4 — kiểu cửa sổ Pascal → `Opening.swing`; kiểu dây chưa chứa (hất, chớp…) → `null` (giữ `swing` đã lưu). */
const windowSwingOf = (node: PascalWindowNode): Opening['swing'] | null => {
  const type: string = node.windowType ?? 'fixed';

  if (type === 'fixed') return 'fixed';
  if (type === 'sliding') return 'sliding';
  if (type !== 'casement') return null;

  return node.casementStyle === 'french' ? 'double' : node.hingesSide === 'right' ? 'right' : 'left';
};

/** H4 — mặt trần `ceiling_<phòng>` → `Room.ceilingMaterial`; thạch cao mặc định hay tham chiếu lạ thì vắng. */
const ceilingFieldsOf = (scene: PascalScene, roomId: RoomId): { ceilingMaterial?: MaterialRef } => {
  const ceiling = scene.nodes[`ceiling_${roomId}`];
  const surface = ceiling?.type === 'ceiling' ? ceiling.slots['surface'] : undefined;

  return surface !== CEILING_DEFAULT && saveableRef(surface) ? { ceilingMaterial: surface } : {};
};

const readStrings = (fields: Fields, key: string): string[] => {
  const value = fields[key];

  return Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string') : [];
};

/** Câu cho tấm sàn người dùng tự vẽ trong Pascal (bản vẽ chưa có chỗ chứa). */
export const SLAB_NOT_SAVED = 'Không thêm sàn riêng được. Muốn đổi sàn: chọn phòng → Vật liệu sàn.';

/**
 * Sàn/trần Pascal TỰ đặt khi tường khép một khoảng chưa có sàn khớp (`space-detection.ts`
 * `planAutoSlabsForLevel`, id ngẫu nhiên, `autoFromWalls: true`) — vd. xoá một vách gộp hai phòng.
 * Sàn/trần AppFront luôn `autoFromWalls: false` (toPascal). Không phải thứ người dùng vẽ: bỏ qua im
 * lặng ở mọi đường (lượt về, khai lượt sửa), không thì cả lượt xoá cửa/tường bị từ chối oan.
 */
export const isAutoSurface = (node: PascalNode | undefined): boolean =>
  (node?.type === 'slab' || node?.type === 'ceiling') && (node as { readonly autoFromWalls?: unknown }).autoFromWalls === true;

/** H4 — mọi node món tự bày mà zone khai (`dressIds`, toPascal): có trong đây thì xoá nó lưu được. */
export const dismissableNodeIdsOf = (scene: PascalScene): Set<PascalNodeId> =>
  new Set(
    Object.values(scene.nodes).flatMap((node) =>
      node.type === 'zone' ? readStrings(fieldsOf(node), 'dressIds').map(dressNodeIdOf) : [],
    ),
  );

/**
 * H4 — `Room.dressingOff` của một zone: danh sách đã lưu cộng món tự bày (`dressIds`) không còn trong
 * cảnh hoặc vừa thành đồ thật (`adopted`). Tính lại từ cảnh mỗi lượt nên hoàn tác
 * thì món rời danh sách (trừ khi đã lưu từ lượt mở trước). Đèn mất theo trần (xoá trần) không phải xoá đèn.
 */
const dressingOffOf = (scene: PascalScene, fields: Fields, roomId: string, adopted: ReadonlySet<string>): { dressingOff?: string[] } => {
  const removed = readStrings(fields, 'dressIds').filter((id) => {
    const nodeId = dressNodeIdOf(id);

    if (adopted.has(nodeId)) return true;
    if (scene.nodes[nodeId] !== undefined) return false;

    return !isGeneratedLightId(nodeId) || scene.nodes[toPascalId('ceiling', roomId)] !== undefined;
  });
  // Trần lược đồ: tràn thì giữ những món bỏ mới nhất (món cũ nhất có thể hiện lại) thay vì cả lượt lưu bị từ chối.
  const off = [...new Set([...readStrings(fields, 'dressingOff'), ...removed])].slice(-DRESSING_OFF_MAX);

  return off.length === 0 ? {} : { dressingOff: off };
};

/** Khe mặt tường → `Wall.paint`, chỉ những mặt khác khe phong cách cho. */
const paintOf = (wall: PascalWallNode): WallPaint | null => {
  const styleSlots = fieldsOf(wall)['styleSlots'];
  const base = (typeof styleSlots === 'object' && styleSlots !== null ? styleSlots : {}) as Fields;
  const paint: { interior?: MaterialRef; exterior?: MaterialRef } = {};

  for (const side of ['interior', 'exterior'] as const) {
    const ref = wall.slots?.[side];

    if (ref !== readString(base, side) && saveableRef(ref)) paint[side] = ref;
  }

  return Object.keys(paint).length === 0 ? null : paint;
};

/* -------------------------------------------------------------------------- */
/* W3b — đồ đạc giữ màu, mẫu, loại và độ cao.                                  */
/* -------------------------------------------------------------------------- */

const SLOT_KEY = /^[a-z][a-z0-9_]{0,23}$/;
const MODEL_SRC = /^\/items\/[a-z0-9_-]+\/model\.glb$/;

/** `src` mẫu đồ ghi được vào `Furniture.model` (cùng luật với `itemFieldsOf`). */
export const saveableModelSrc = (src: unknown): src is string => typeof src === 'string' && MODEL_SRC.test(src);

/** Khe đã sơn khác khe phong cách cho (≤ 8, chỉ tham chiếu ghi được), hoặc `null`. */
const itemSlotsFieldOf = (item: PascalItemNode): Readonly<Record<string, MaterialRef>> | null => {
  const styleSlots = fieldsOf(item)['styleSlots'];
  const base = (typeof styleSlots === 'object' && styleSlots !== null ? styleSlots : {}) as Fields;
  // Sơn từ tấm viền ("cả món một màu", xem `OUTLINE_PAINT_SLOT`): còn nguyên thì giữ một khoá, sơn lại từng khe thì bỏ khoá.
  const whole = OUTLINE_PAINT_SLOT in base ? undefined : item.slots?.[OUTLINE_PAINT_SLOT];
  if (whole !== undefined && saveableRef(whole) && Object.keys(base).every((slot) => item.slots?.[slot] === whole)) {
    return { [OUTLINE_PAINT_SLOT]: whole };
  }
  const painted = Object.entries(item.slots ?? {}).filter(
    (entry): entry is [string, MaterialRef] =>
      (whole === undefined || entry[0] !== OUTLINE_PAINT_SLOT) &&
      SLOT_KEY.test(entry[0]) &&
      entry[1] !== readString(base, entry[0]) &&
      saveableRef(entry[1]),
  );

  return painted.length === 0 ? null : Object.fromEntries(painted.slice(0, 8));
};

/**
 * Trường I1 của món đồ: `variant` / `heightMm` / `liftMm` từ siêu dữ liệu lượt đi (đồ sinh
 * ra được nhận nuôi cũng mang theo), đè bằng lần kéo giãn (`scale` trục nào ≠ 1) hay nâng (y lệch
 * quá 1 mm) vừa rồi; `slots` khác phong cách; `model` khi mẫu không phải mẫu AppFront chọn
 * và `src` là một mẫu `/items/…` (ngoài ra không lưu được).
 */
const itemFieldsOf = (item: PascalItemNode, kind: FurnitureKind): Partial<Furniture> => {
  const fields = fieldsOf(item);
  const variant = readOneOf(fields, 'variant', FURNITURE_VARIANTS);
  const styleLiftMm = readNumber(fields, 'styleLiftMm') ?? 0;
  const liftNowMm = millimetresOf(item.position[1]);
  /* Kéo giãn trục nào cũng ghi chiều cao đang thấy: lượt về `toPascal` (`heightOf`) đoán cao từ tỷ lệ
     rộng/sâu, nên kéo riêng bề rộng mà không ghi `heightMm` thì mở lại món cao lên. */
  const heightMm =
    item.scale.some((axis) => Math.abs(axis - 1) >= SCALE_EPSILON)
      ? Math.max(1, Math.round(millimetresOf(item.asset.dimensions[1]) * item.scale[1]))
      : readNumber(fields, 'heightMm');
  const liftMm = Math.abs(liftNowMm - styleLiftMm) > 1 ? Math.max(0, Math.round(liftNowMm)) : readNumber(fields, 'liftMm');
  const slots = itemSlotsFieldOf(item);
  // Mẫu thư viện máy chủ: `src` là URL ký hết hạn — lưu đường `/items/<id>/…` cố định thay vào.
  const server = isServerModel(item.asset.id);
  const swapped = server || (item.asset.id !== `appfront-${kind}` && MODEL_SRC.test(item.asset.src));

  return {
    ...(variant === null ? {} : { variant }),
    ...(heightMm === null ? {} : { heightMm: millimetres(heightMm) }),
    ...(liftMm === null ? {} : { liftMm: millimetres(liftMm) }),
    ...(slots === null ? {} : { slots }),
    ...(swapped
      ? { model: { id: item.asset.id.slice(0, 120), src: server ? serverModelPath(item.asset.id) : drapeSavedSrc(item.asset.src) } }
      : {}),
  };
};

const readCorner = (fields: Fields, corner: 'min' | 'max'): Point | null => {
  const box = fields['boundingBox'];

  if (typeof box !== 'object' || box === null) {
    return null;
  }

  const value = (box as Record<string, unknown>)[corner];

  if (typeof value !== 'object' || value === null) {
    return null;
  }

  const { x, y } = value as { x?: unknown; y?: unknown };

  return typeof x === 'number' && typeof y === 'number' && isUsable(x, y) ? { x, y } : null;
};

const AXIS_DIRECTIONS: readonly AxisDirection[] = ['horizontal', 'vertical'];
const WALL_KINDS: readonly WallKind[] = ['loadBearing', 'partition', 'envelope'];
const ROOM_USAGES: readonly RoomUsage[] = [
  'livingRoom',
  'bedroom',
  'kitchen',
  'bathroom',
  'corridor',
  'stairwell',
  'utility',
  'loggia',
  'other',
];
const FURNITURE_KINDS: readonly FurnitureKind[] = [
  'table',
  'chair',
  'bed',
  'wardrobe',
  'kitchenCabinet',
  'sanitaryFixture',
  'washingMachine',
  'shower',
  'stair',
  'other',
];
const SWING_DIRECTIONS: readonly SwingDirection[] = ['left', 'right', 'double', 'sliding', 'fixed'];

/**
 * Siêu dữ liệu duyệt của một node.
 *
 * `trusted` là câu trả lời cho "node này có phải do AppFront viết ra không".
 * Sai thì mọi thứ trong `metadata.appfront` bị bỏ, kể cả `confidence`: một đối
 * tượng vừa được vẽ trong Pascal là tác phẩm của người dùng, chưa ai duyệt, và
 * đó đúng là `AUTHORED_BY_HAND`.
 */
const reviewOf = (node: PascalNode, trusted: boolean): ReviewMetadata => {
  // Chỉ `metadata.appfront`: Pascal gốc không có trường `review` hạng nhất (zod bỏ khoá lạ).
  const origin = node.metadata?.appfront;

  if (!trusted || origin === undefined) {
    return { ...AUTHORED_BY_HAND };
  }

  const confidence =
    typeof origin.confidence === 'number' && Number.isFinite(origin.confidence)
      ? Math.min(1, Math.max(0, origin.confidence))
      : 1;

  return {
    confidence,
    source: origin.source === 'ai' ? 'ai' : 'human',
    reviewed: origin.reviewed === true,
  };
};

/* -------------------------------------------------------------------------- */
/* Đi theo cây.                                                                */
/* -------------------------------------------------------------------------- */

const childIdsOf = (node: PascalNode): readonly PascalNodeId[] =>
  'children' in node ? node.children : [];

const childrenOf = (scene: PascalScene, node: PascalNode): readonly PascalNode[] => {
  const found: PascalNode[] = [];

  for (const childId of childIdsOf(node)) {
    const child = scene.nodes[childId];

    if (child !== undefined) {
      found.push(child);
    }
  }

  return found;
};

/**
 * Cao độ đáy của từng tầng, theo đúng luật xếp chồng của Pascal.
 *
 * `services/storey.js:62-70`: duyệt theo số thứ tự tăng dần, cao độ đáy là
 * đỉnh của tầng dưới cộng `baseElevation` của chính nó.
 */
const stackedElevationsOf = (levels: readonly PascalLevelNode[]): readonly number[] => {
  const elevations: number[] = [];
  let topOfLevelBelow = 0;

  for (const level of levels) {
    const baseY = topOfLevelBelow + level.baseElevation;

    elevations.push(baseY);
    topOfLevelBelow = baseY + level.height;
  }

  return elevations;
};

/* -------------------------------------------------------------------------- */
/* Gom con của một tầng, rồi con của một tường.                                */
/* -------------------------------------------------------------------------- */

/** Mọi thứ hai hàm gom ghi vào, gom một chỗ để không phải truyền bảy tham số. */
interface Collector {
  readonly skip: (id: string, kind: string, reason: string) => void;
  readonly walls: Wall[];
  readonly openings: Opening[];
  readonly rooms: Room[];
  readonly furniture: Furniture[];
  readonly axes: Axis[];
  readonly roofs: Roof[];
  /** Id tường phía Pascal → id tường phía AppFront, để phòng nối lại được. */
  readonly wallIdOfNode: Map<PascalNodeId, WallId>;
  /** Id phòng → id tường **phía Pascal** của nó, giải ở lượt cuối. */
  readonly boundaryNodeIdsOf: Map<RoomId, readonly PascalNodeId[]>;
  /** Cấp id cho node Pascal chưa có id AppFront. */
  readonly mint: Minter;
  /** Phòng có đồ bày biện sinh ra được "nhận nuôi" trong lượt này (V4). */
  readonly adoptRoomIds: ReadonlySet<string>;
}

const positionIsUsable = (position: PascalVec3): boolean => isUsable(...position);

/**
 * Hộp bao về lưới 1 mm. Kéo `scale` (kể cả "Giữ tỉ lệ" 1902 → 2102, k = 1,10515…), nửa cạnh lẻ hay
 * quay hộp ¼ vòng đều ra phần lẻ — `FurnitureSchema` đòi số nguyên, bộ lưu chặn cả tầng trước khi gửi.
 */
const wholeBox = (box: BoundingBox): BoundingBox => {
  const mm = (value: number): number => Math.round(value) + 0;

  return {
    min: { x: mm(box.min.x), y: mm(box.min.y) },
    max: { x: mm(box.max.x), y: mm(box.max.y) },
  };
};

/** Hộp bao dựng quanh tâm, cho đồ đạc mà Pascal vừa đặt và AppFront chưa biết. */
const boxAround = (centre: Point, dimensions: PascalVec3, scale: PascalVec3): BoundingBox => {
  const halfWidth = (millimetresOf(dimensions[0]) * scale[0]) / 2;
  const halfDepth = (millimetresOf(dimensions[2]) * scale[2]) / 2;

  return {
    min: { x: centre.x - halfWidth, y: centre.y - halfDepth },
    max: { x: centre.x + halfWidth, y: centre.y + halfDepth },
  };
};

/**
 * Một tỉ lệ coi như "chưa ai kéo". Pascal ghi `[1, 1, 1]` cho mọi món đồ lượt
 * đi gắn, nên lệch khỏi 1 nghĩa là người dùng vừa kéo tay cầm.
 *
 * Dung sai `1e-9` là để chống sai số dấu phẩy động của chính Pascal, không
 * phải để bỏ qua một lần kéo thật: tay cầm nhỏ nhất của nó đổi tỉ lệ ở bậc
 * phần nghìn, lớn hơn ngưỡng này sáu bậc.
 */
const SCALE_EPSILON = 1e-9;

const isUnscaled = (scale: PascalVec3): boolean =>
  Math.abs(scale[0] - 1) < SCALE_EPSILON && Math.abs(scale[2] - 1) < SCALE_EPSILON;

/**
 * Hộp bao của một món đồ Pascal, mm — **có tính `scale`**.
 *
 * Người dùng đổi bề rộng một món đồ trong Pascal bằng cách kéo `scale`, chứ
 * không phải bằng cách nhập mm: `dimensions` của `asset` là số danh nghĩa của
 * mẫu và không đổi. Nên bề rộng thật là `dimensions × scale`, và lượt về phải
 * nhân vào — đọc thẳng `metadata.appfront.boundingBox` là đọc lại cái hộp
 * AppFront gắn ở lượt ĐI, tức **mất trắng** lần kéo vừa rồi, im lặng.
 *
 * Khi tỉ lệ còn là 1 thì hộp đã lưu được dùng nguyên văn: nó giữ đúng số mm
 * gốc (kể cả hộp không cân quanh tâm), không qua mét rồi về mm nên không có
 * sai số làm mọi món đồ chưa ai chạm tới lệch đi một phần nghìn mỗi vòng.
 */
const itemBoxOf = (
  centre: Point,
  stored: { readonly min: Point; readonly max: Point } | null,
  dimensions: PascalVec3,
  scale: PascalVec3,
): BoundingBox => {
  if (stored === null) {
    return boxAround(centre, dimensions, scale);
  }

  if (isUnscaled(scale)) {
    return stored;
  }

  // Kéo quanh tâm món đồ: giãn khoảng cách từ tâm tới từng cạnh, nên một hộp
  // không cân vẫn giữ được độ không cân của nó sau khi kéo.
  return {
    min: {
      x: centre.x + (stored.min.x - centre.x) * scale[0],
      y: centre.y + (stored.min.y - centre.y) * scale[2],
    },
    max: {
      x: centre.x + (stored.max.x - centre.x) * scale[0],
      y: centre.y + (stored.max.y - centre.y) * scale[2],
    },
  };
};

/**
 * V4 — phòng của một món đồ bày biện sinh ra (`item_DRESS-…`) mà người dùng
 * nhận nuôi được, hoặc `null`. Đèn trần không bao giờ được nhận nuôi.
 */
export const adoptableRoomOf = (node: PascalNode | undefined): string | null => {
  if (node?.type !== 'item' || !isGeneratedNodeId(node.id) || isGeneratedLightId(node.id)) return null;

  const roomId = node.metadata?.appfront?.fields?.['roomId'];

  return typeof roomId === 'string' && isIdOfKind('room', roomId) ? roomId : null;
};

/**
 * Món `DRESS-` không phòng nào nhận nuôi (lan can, dãy tủ, nhánh chữ L, đồ trang trí): sửa thì riêng nó thành đồ
 * thật (`createPascalEditCommand.adoptNodeIds`). Không tính đèn trần và tấm viền gợi ý: chúng có đường riêng.
 */
export const isLooseGenerated = (node: PascalNode | undefined): boolean =>
  node?.type === 'item' &&
  isGeneratedNodeId(node.id) &&
  !isGeneratedLightId(node.id) &&
  node.metadata?.unconfirmed !== true &&
  adoptableRoomOf(node) === null;

/**
 * V4 — món bày biện sinh ra đã bị người dùng dời / kéo / xoay chưa, so với
 * chính siêu dữ liệu lượt đi: tâm khác tâm hộp bao quá 1 mm, tỉ lệ khác 1, hoặc
 * góc khác `fields.rotationDeg` (chỉ khi lượt đi có ghi trường này), hoặc đã đổi mẫu.
 * Lượt nạp đầu khai mọi node là "đã đổi" nên không được nhận nuôi gì ở đó.
 */
export const isEditedGenerated = (node: PascalNode | undefined): boolean => {
  if (node?.type !== 'item' || adoptableRoomOf(node) === null) return false;

  const fields = fieldsOf(node);
  const min = readCorner(fields, 'min');
  const max = readCorner(fields, 'max');
  const rotationDeg = readNumber(fields, 'rotationDeg');
  const moved =
    min === null ||
    max === null ||
    Math.abs(millimetresOf(node.position[0]) - (min.x + max.x) / 2) > 1 ||
    Math.abs(millimetresOf(node.position[2]) - (min.y + max.y) / 2) > 1;

  return (
    moved ||
    !isUnscaled(node.scale) ||
    // W3b: kéo cao, nâng, sơn khe cũng là sửa.
    Math.abs(node.scale[1] - 1) >= SCALE_EPSILON ||
    Math.abs(millimetresOf(node.position[1]) - (readNumber(fields, 'styleLiftMm') ?? 0)) > 1 ||
    itemSlotsFieldOf(node) !== null ||
    // F-02: "Đổi mẫu" đặt `asset.id` sang id catalog (mẫu AppFront chọn luôn là `appfront-…`).
    (!node.asset.id.startsWith('appfront-') && saveableModelSrc(node.asset.src)) ||
    (rotationDeg !== null && planDegreesOf(node.rotation[1]) !== normaliseDegrees(asDegrees(rotationDeg)))
  );
};

/** Cùng cỡ, đặt quanh tâm: hộp lượt đi của món rời có thể ở khung riêng (lan can quanh gốc toạ độ); màn 2D đọc hộp thế giới. */
const boxAtCentre = ({ min, max }: BoundingBox, centre: Point): BoundingBox => {
  const halfX = (max.x - min.x) / 2;
  const halfY = (max.y - min.y) / 2;

  return { min: { x: centre.x - halfX, y: centre.y - halfY }, max: { x: centre.x + halfX, y: centre.y + halfY } };
};

const collectWallChildren = (
  scene: PascalScene,
  wallNode: PascalWallNode,
  wallId: WallId,
  openingIds: OpeningId[],
  collector: Collector,
): void => {
  for (const child of childrenOf(scene, wallNode)) {
    if (child.type !== 'door' && child.type !== 'window') {
      collector.skip(
        child.id,
        lower(nodeTypeLabel(child.type)),
        `${nodeTypeLabel(child.type)} gắn trên tường chưa lưu được trong bản này. Trên tường chỉ lưu được cửa đi và cửa sổ.`,
      );
      continue;
    }

    if (!positionIsUsable(child.position) || !isUsable(child.width, child.height)) {
      collector.skip(child.id, 'ô mở', 'Vị trí hoặc kích thước ô mở không phải một số đo được.');
      continue;
    }

    const knownId = appFrontIdOf('opening', child.id);
    const openingId = knownId ?? collector.mint('opening', child.id);
    const widthMm = millimetresOf(child.width);
    const heightMm = millimetresOf(child.height);

    openingIds.push(openingId);
    collector.openings.push({
      ...reviewOf(child, knownId !== null),
      id: openingId,
      wallId,
      kind: child.type,
      // Pascal đọc tâm ở cả hai trục; AppFront lưu mép trái và mép dưới.
      offsetMm: roundMeasurement(millimetres(millimetresOf(child.position[0]) - widthMm / 2)),
      widthMm,
      heightMm,
      sillHeightMm: roundMeasurement(millimetres(millimetresOf(child.position[1]) - heightMm / 2)),
      ...(child.type === 'door'
        ? doorSwingOf(child, fieldsOf(child))
        : { swing: windowSwingOf(child) ?? readOneOf(fieldsOf(child), 'swing', SWING_DIRECTIONS) ?? 'left' }),
    });
  }
};

/**
 * Một món đồ, rồi mọi món đặt LÊN nó (N1): Pascal gắn đồ thả trên mặt bàn làm con của bàn,
 * toạ độ cục bộ theo bàn. Không đi xuống thì đồ ấy biến khỏi đồ thị và lượt về ghi một lần xoá.
 * Con đổi sang toạ độ thế giới: vị trí = vị trí bàn + R_y(yaw bàn)·cục bộ, yaw = yaw bàn + yaw con.
 * ponytail: bỏ qua `scale` của món chủ khi đổi toạ độ con; thêm khi đồ chủ kéo giãn mang con.
 */
const collectItem = (scene: PascalScene, item: PascalItemNode, levelId: LevelId, collector: Collector): void => {
  if (!positionIsUsable(item.position) || !positionIsUsable(item.rotation)) {
    collector.skip(item.id, 'đồ đạc', 'Vị trí hoặc góc quay của đồ đạc không phải một số đo được.');
    return;
  }

  // Đồ bày biện / đèn AppFront tự sinh (J10): dựng lại mỗi lần mở, không thành đồ đạc —
  // trừ khi người dùng vừa sửa một món của phòng ấy: cả bộ của phòng thành đồ thật, id `F-` mới (V4); món rời thì riêng nó.
  // Đồ người dùng đặt LÊN món sinh ra thì vẫn đi xuống bên dưới.
  const looseAdopted = collector.adoptRoomIds.has(item.id);

  if (!isGeneratedNodeId(item.id) || looseAdopted || collector.adoptRoomIds.has(adoptableRoomOf(item) ?? '')) {
    const fields = fieldsOf(item);
    const knownId = appFrontIdOf('furniture', item.id);
    const centre: Point = {
      x: millimetresOf(item.position[0]),
      y: millimetresOf(item.position[2]),
    };
    const min = readCorner(fields, 'min');
    const max = readCorner(fields, 'max');
    const roomId = readString(fields, 'roomId');
    const kind = readOneOf(fields, 'kind', FURNITURE_KINDS) ?? serverKindOf(item.asset.id) ?? 'other';
    const box = itemBoxOf(centre, min !== null && max !== null ? { min, max } : null, item.asset.dimensions, item.scale);
    const rotationDeg = planDegreesOf(item.rotation[1]);
    // Hướng tự đoán (`orientDetected`, góc gốc 0) mà người dùng chưa xoay: trả lại góc 0 + hộp gốc, để món
    // không thành "đã sửa" chỉ vì cách hiển thị. Xoay rồi thì góc mới là của người dùng.
    const shownDeg = readNumber(fields, 'rotationDeg');
    const autoKept = fields['autoFacing'] === true && shownDeg !== null && rotationDeg === normaliseDegrees(asDegrees(shownDeg));

    collector.furniture.push({
      ...reviewOf(item, knownId !== null),
      id: knownId ?? collector.mint('furniture', item.id),
      levelId,
      kind,
      centre,
      boundingBox: wholeBox(autoKept ? worldBoxOf(box, rotationDeg) : looseAdopted ? boxAtCentre(box, centre) : box),
      rotationDeg: autoKept ? asDegrees(0) : rotationDeg,
      ...(roomId !== null && isIdOfKind('room', roomId) ? { roomId } : {}),
      ...itemFieldsOf(item, kind),
      // Món rời thành đồ thật giữ đúng mẫu và độ nâng lượt đi tự chọn (lan can, mặt bếp…), không đoán lại theo `kind`.
      ...(looseAdopted && MODEL_SRC.test(item.asset.src) ? { model: { id: item.asset.id.slice(0, 120), src: drapeSavedSrc(item.asset.src) } } : {}),
      ...(looseAdopted && item.position[1] > 0.001 ? { liftMm: millimetres(Math.round(millimetresOf(item.position[1]))) } : {}),
    });
  }

  const yaw = item.rotation[1];

  for (const child of childrenOf(scene, item)) {
    if (child.type !== 'item') {
      collector.skip(
        child.id,
        lower(nodeTypeLabel(child.type)),
        `${nodeTypeLabel(child.type)} đặt trên đồ đạc chưa lưu được trong bản này. Trên đồ đạc chỉ đặt được đồ vật khác.`,
      );
      continue;
    }

    const [x, y, z] = child.position;

    collectItem(
      scene,
      {
        ...child,
        position: [
          item.position[0] + x * Math.cos(yaw) + z * Math.sin(yaw),
          item.position[1] + y,
          item.position[2] - x * Math.sin(yaw) + z * Math.cos(yaw),
        ],
        rotation: [child.rotation[0], yaw + child.rotation[1], child.rotation[2]],
      },
      levelId,
      collector,
    );
  }
};

const collectLevelChildren = (
  scene: PascalScene,
  levelNode: PascalLevelNode,
  levelId: LevelId,
  collector: Collector,
): void => {
  for (const child of childrenOf(scene, levelNode)) {
    /*
     * G-9 / B3b-1 — vạch đo của công cụ thước là chú thích để xem, không phải đối tượng của bản vẽ:
     * báo "bỏ qua" (toast đỏ) mỗi lần đo thì người dùng tưởng lưu hỏng. `PascalNode` không liệt kê
     * loại này nên so trên chuỗi.
     * ponytail: vạch đo không được lưu, tải lại trang là mất; cần giữ thì thêm chỗ chứa ở máy chủ.
     */
    if ((child.type as string) === 'measurement') {
      continue;
    }

    switch (child.type) {
      case 'wall': {
        /* N2 — tường công cụ vẽ ra không mang `thickness`/`height` (lược đồ để tuỳ chọn): lấy
           bề dày mặc định của vendor (`DEFAULT_WALL_THICKNESS`) và chiều cao tầng, như Pascal vẽ. */
        const thickness = (child.thickness as number | undefined) ?? DEFAULT_WALL_THICKNESS_M;
        const height = (child.height as number | undefined) ?? levelNode.height;

        if (!isUsable(...child.start, ...child.end, thickness, height)) {
          collector.skip(child.id, 'tường', 'Trục tường hoặc kích thước tường không phải một số đo được.');
          break;
        }

        const knownId = appFrontIdOf('wall', child.id);
        const wallId = knownId ?? collector.mint('wall', child.id);
        const openingIds: OpeningId[] = [];

        const paint = paintOf(child);
        const curveOffsetMm = millimetresOf((child.curveOffset as number | undefined) ?? 0);

        collector.wallIdOfNode.set(child.id, wallId);
        collector.walls.push({
          ...reviewOf(child, knownId !== null),
          id: wallId,
          levelId,
          centreline: {
            start: unweldedEndOf(child, 'start'),
            end: unweldedEndOf(child, 'end'),
          },
          ...(curveOffsetMm === 0 ? {} : { curveOffsetMm }),
          thicknessMm: millimetresOf(thickness),
          heightMm: millimetresOf(height),
          kind: readOneOf(fieldsOf(child), 'kind', WALL_KINDS) ?? 'partition',
          openingIds,
          ...(paint === null ? {} : { paint }),
        });

        collectWallChildren(scene, child, wallId, openingIds, collector);
        break;
      }

      case 'zone': {
        if (!child.polygon.every((point) => isUsable(...point))) {
          collector.skip(child.id, 'phòng', 'Đường bao phòng có điểm không phải một toạ độ đo được.');
          break;
        }

        if (child.polygon.length < MIN_OUTLINE_POINTS) {
          collector.skip(child.id, 'phòng', 'Đường bao phòng có ít hơn ba điểm nên không thành đa giác.');
          break;
        }

        const fields = fieldsOf(child);
        const knownId = appFrontIdOf('room', child.id);
        const roomId = knownId ?? collector.mint('room', child.id);
        const outline = child.polygon.map(
          (point): Point => ({ x: millimetresOf(point[0]), y: millimetresOf(point[1]) }),
        );

        collector.boundaryNodeIdsOf.set(roomId, child.boundaryWallIds);
        collector.rooms.push({
          ...reviewOf(child, knownId !== null),
          id: roomId,
          levelId,
          name: child.name,
          usage: readOneOf(fields, 'usage', ROOM_USAGES) ?? 'other',
          outline,
          areaM2: readNumber(fields, 'areaM2') ?? computeArea(outline.map(toPointMm)),
          wallIds: [],
          ...(knownId === null ? {} : floorFieldsOf(scene, knownId)),
          ...(knownId === null ? {} : ceilingFieldsOf(scene, knownId)),
          ...dressingOffOf(scene, fields, roomId, collector.adoptRoomIds),
        });
        break;
      }

      case 'item': {
        collectItem(scene, child, levelId, collector);
        break;
      }

      case 'stair': {
        // Thang thật (toPascal `stairNodesOf`): đoạn con không bao giờ thành đối tượng riêng.
        const segment = childrenOf(scene, child).find((node) => node.type === 'stair-segment');
        const length = segment?.type === 'stair-segment' ? segment.length : null;

        if (length === null || !positionIsUsable(child.position) || !isUsable(child.rotation, child.width, length)) {
          collector.skip(child.id, 'đồ đạc', 'Vị trí, góc quay hoặc kích thước thang không phải một số đo được.');
          break;
        }

        const fields = fieldsOf(child);
        const knownId = appFrontIdOf('furniture', child.id);
        const min = readCorner(fields, 'min');
        const max = readCorner(fields, 'max');
        const roomId = readString(fields, 'roomId');
        // Kiểu thang lượt đi (`curved`/`spiral` của M1-01): ghi trả nguyên, `PUT` thay cả lớp nên bỏ là mất trên máy chủ.
        const variant = readOneOf(fields, 'variant', [...STAIR_VARIANTS, ...FURNITURE_VARIANTS]);
        // Thân thang chạy theo +z cục bộ từ `position` (chân thang) → tâm ở giữa thân.
        const centre: Point = {
          x: millimetresOf(child.position[0] + (Math.sin(child.rotation) * length) / 2),
          y: millimetresOf(child.position[2] + (Math.cos(child.rotation) * length) / 2),
        };
        // Hướng hộp bao giữ như lượt đi: cạnh dài theo x cục bộ thì yaw đã cộng π/2.
        const runAlongX = min !== null && max !== null && max.x - min.x > max.y - min.y;
        const sizeX = millimetresOf(runAlongX ? length : child.width);
        const sizeY = millimetresOf(runAlongX ? child.width : length);
        const stored =
          min !== null &&
          max !== null &&
          Math.abs(max.x - min.x - sizeX) <= 1 &&
          Math.abs(max.y - min.y - sizeY) <= 1 &&
          Math.abs((min.x + max.x) / 2 - centre.x) <= 1 &&
          Math.abs((min.y + max.y) / 2 - centre.y) <= 1;

        collector.furniture.push({
          ...reviewOf(child, knownId !== null),
          id: knownId ?? collector.mint('furniture', child.id),
          levelId,
          kind: 'stair',
          centre,
          boundingBox: wholeBox(
            stored
              ? { min, max }
              : {
                  min: { x: centre.x - sizeX / 2, y: centre.y - sizeY / 2 },
                  max: { x: centre.x + sizeX / 2, y: centre.y + sizeY / 2 },
                },
          ),
          // Viết −(bù − yaw) chứ không phải yaw − bù: yaw 0 phải ra 0° chứ không phải −0° (diff so giá trị).
          rotationDeg: planDegreesOf(-((runAlongX ? Math.PI / 2 : 0) - child.rotation)),
          ...(roomId !== null && isIdOfKind('room', roomId) ? { roomId } : {}),
          ...(variant === null ? {} : { variant }),
        });
        break;
      }

      case 'roof': {
        // Mái đi nguyên dạng node Pascal (`roofs.ts`); mặt mái con đi cùng, không thành đối tượng riêng.
        const knownId = appFrontIdOf('roof', child.id);
        const roof = roofOf(scene, child, knownId ?? collector.mint('roof', child.id), levelId, reviewOf(child, knownId !== null));

        if (typeof roof === 'string') {
          collector.skip(child.id, 'mái', roof);
        } else {
          collector.roofs.push(roof);
        }
        break;
      }

      case 'structural-grid': {
        if (!isUsable(...child.start, ...child.end)) {
          collector.skip(child.id, 'trục định vị', 'Toạ độ hai đầu trục không phải một số đo được.');
          break;
        }

        const fields = fieldsOf(child);
        const knownId = appFrontIdOf('axis', child.id);
        const start: Point = { x: millimetresOf(child.start[0]), y: millimetresOf(child.start[1]) };
        const end: Point = { x: millimetresOf(child.end[0]), y: millimetresOf(child.end[1]) };

        collector.axes.push({
          ...reviewOf(child, knownId !== null),
          id: knownId ?? collector.mint('axis', child.id),
          levelId,
          label: readString(fields, 'label') ?? child.label,
          direction:
            readOneOf(fields, 'direction', AXIS_DIRECTIONS) ??
            (Math.abs(end.x - start.x) >= Math.abs(end.y - start.y) ? 'horizontal' : 'vertical'),
          line: { start, end },
        });
        break;
      }

      case 'slab': {
        /*
         * Sàn dựng RA từ đường bao phòng ở lượt đi, nên lượt về không mang gì
         * mới: `zone` cùng phòng đã chở đủ đường bao, công năng và dấu xác
         * minh. Bỏ qua trong im lặng là đúng — báo "bỏ qua" cho một tấm sàn mà
         * chính AppFront vừa sinh ra thì mỗi vòng lại thêm một dòng nhiễu.
         *
         * Tấm sàn NGƯỜI DÙNG vẽ trong Pascal thì khác: id của nó là nanoid nên
         * `appFrontIdOf` trả `null`, và nó được nói ra.
         */
        if (appFrontIdOf('room', child.id) === null && !isAutoSurface(child)) {
          collector.skip(
            child.id,
            'sàn',
            SLAB_NOT_SAVED,
          );
        }
        break;
      }

      /*
       * Trần (và đèn con của nó) sinh ra từ phòng như sàn; lượt về không mang gì
       * mới. Nhưng Pascal gắn đồ `attachTo: 'ceiling'` (đèn, quạt, đầu báo khói…)
       * làm con của chính trần ấy, và bản vẽ chưa có chỗ chứa chúng: phải nói ra,
       * không được rơi im lặng (R3-F2). Trần người dùng vẽ cũng nói ra, như sàn.
       */
      case 'ceiling': {
        if (appFrontIdOf('room', child.id) === null && !isAutoSurface(child)) {
          collector.skip(child.id, 'trần', 'Trần chưa vẽ thêm được trong bản này. Trần tự có theo từng phòng.');
        }

        for (const fixture of childrenOf(scene, child)) {
          if (!isGeneratedNodeId(fixture.id)) {
            collector.skip(fixture.id, CEILING_FIXTURE_KIND, CEILING_FIXTURE_REASON);
          }
        }
        break;
      }

      default:
        collector.skip(
          child.id,
          lower(nodeTypeLabel(child.type)),
          `${nodeTypeLabel(child.type)} chưa vẽ thêm được trong bản này nên không được lưu.`,
        );
    }
  }
};

/* -------------------------------------------------------------------------- */
/* Lượt đổi.                                                                   */
/* -------------------------------------------------------------------------- */

/**
 * Đổi một cảnh Pascal thành đồ thị không gian.
 *
 * Không đọc store, không chạm mạng, không ném lỗi. Trục định vị, kích thước và
 * ghi chú về rỗng: lượt đi không mang chúng sang nên lượt về không có gì để
 * dựng lại — người gọi giữ bản cũ của ba danh sách ấy nếu cần.
 */
export const toSpatialGraph = (
  shownScene: PascalScene,
  idBook?: PascalIdBook,
  adoptRoomIds: ReadonlySet<string> = new Set(),
): SpatialGraphResult => {
  /* Tầng căn chỉ là phép biến đổi hiển thị: gỡ ra trước khi đọc, dữ liệu giữ toạ độ đã lưu. */
  const scene = undoFloorTransforms(shownScene);
  const mint = minterFor(idBook);
  const skipped: SkippedEntity[] = [];
  const skip = (id: string, kind: string, reason: string): void => {
    skipped.push({ id, kind, reason });
  };

  const roots = scene.rootNodeIds
    .map((id) => scene.nodes[id])
    .filter((node): node is PascalNode => node !== undefined);

  const buildings = roots.flatMap((root) =>
    root.type === 'building' ? [root] : childrenOf(scene, root).filter(ofType('building')),
  );

  const [buildingNode, ...extraBuildings] = buildings;

  for (const extra of extraBuildings) {
    skip(extra.id, 'công trình', 'Bản đầu chỉ dựng lại một công trình; công trình này bị bỏ qua.');
  }

  const buildingFields = buildingNode === undefined ? {} : fieldsOf(buildingNode);
  const address = readString(buildingFields, 'address');
  const grossFloorAreaM2 = readNumber(buildingFields, 'grossFloorAreaM2');

  const building: Building = {
    ...(buildingNode === undefined
      ? { ...AUTHORED_BY_HAND }
      : reviewOf(buildingNode, buildingNode.id === BUILDING_NODE_ID)),
    name: buildingNode?.name ?? readString(buildingFields, 'name') ?? 'Công trình',
    datumElevationMm: readNumber(buildingFields, 'datumElevationMm') ?? 0,
    ...(address === null ? {} : { address }),
    ...(grossFloorAreaM2 === null ? {} : { grossFloorAreaM2 }),
  };

  const levelNodes =
    buildingNode === undefined
      ? []
      : [...childrenOf(scene, buildingNode).filter(ofType('level'))].sort(
          (left, right) => left.level - right.level,
        );

  const usableLevels = levelNodes.filter((node) => {
    if (isUsable(node.level, node.baseElevation, node.height)) {
      return true;
    }

    skip(node.id, 'tầng', 'Số thứ tự, cao độ hoặc chiều cao tầng không phải một số đo được.');

    return false;
  });

  const elevations = stackedElevationsOf(usableLevels);
  const levels: Level[] = [];
  const collector: Collector = {
    skip,
    walls: [],
    openings: [],
    rooms: [],
    furniture: [],
    axes: [],
    roofs: [],
    wallIdOfNode: new Map(),
    boundaryNodeIdsOf: new Map(),
    mint,
    adoptRoomIds,
  };

  usableLevels.forEach((node, index) => {
    const fields = fieldsOf(node);
    const knownId = appFrontIdOf('level', node.id);
    const levelId = knownId ?? mint('level', node.id);
    const areaM2 = readNumber(fields, 'areaM2');
    const scale = readNumber(fields, 'scaleMillimetresPerPixel');

    levels.push({
      ...reviewOf(node, knownId !== null),
      id: levelId,
      name: node.name ?? `Tầng ${String(node.level)}`,
      order: node.level,
      elevationMm: millimetresOf(elevations[index] ?? 0),
      heightMm: millimetresOf(node.height),
      ...(areaM2 === null ? {} : { areaM2 }),
      ...(scale === null ? {} : { scaleMillimetresPerPixel: millimetresPerPixel(scale) }),
    });

    collectLevelChildren(scene, node, levelId, collector);
  });

  const rooms = collector.rooms.map((room) => ({
    ...room,
    wallIds: (collector.boundaryNodeIdsOf.get(room.id) ?? [])
      .map((nodeId) => collector.wallIdOfNode.get(nodeId))
      .filter((wallId): wallId is WallId => wallId !== undefined),
  }));

  return {
    graph: {
      building,
      levels,
      walls: collector.walls,
      openings: collector.openings,
      furniture: collector.furniture,
      rooms,
      axes: collector.axes,
      dimensions: [],
      notes: [],
      ...(collector.roofs.length === 0 ? {} : { roofs: collector.roofs }),
    },
    skipped,
  };
};
