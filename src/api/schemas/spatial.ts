import { z } from 'zod';

import type {
  Axis,
  BoundingBox,
  Building,
  Dimension,
  EntityId,
  Furniture,
  Level,
  MaterialRef,
  Note,
  Opening,
  Point,
  ReviewMetadata,
  Roof,
  Room,
  Segment,
  Wall,
} from '@/domain/spatial/types';
import { FURNITURE_VARIANTS, STAIR_VARIANTS } from '@/domain/spatial/types';
import { millimetresPerPixel } from '@/domain/units/scale';

import { isoInstantSchema } from './common';

/**
 * Hợp đồng dây của lớp không gian một tầng — tường, ô mở, phòng, đồ đạc.
 *
 * ## Vì sao file này tồn tại, sau khi `client.ts` từng lập luận ngược lại
 *
 * Khối chú thích của `SpatialLayer` trong `../client.ts` nêu lý do KHÔNG dựng
 * schema: hình dạng miền đã phẳng và an toàn với JSON, nên "một bản sao thứ hai
 * của cùng danh sách trường chỉ tạo thêm một chỗ để hai bên trôi ra xa nhau".
 * Lập luận ấy đúng về **kiểu**, và sai về **thời điểm**.
 *
 * `readonly Wall[]` là một lời hứa của trình biên dịch về dữ liệu chỉ tồn tại
 * lúc chạy. Nguồn của dữ liệu ấy là ba mô hình AI — SegFormer, YOLO,
 * PaddleOCR — và đầu ra của chúng là **xác suất**, không phải hợp đồng. Một
 * tầng dò sót, một chuỗi OCR đọc `4800` thành `48OO`, một độ dày tường bằng 0:
 * cả ba đều là phản hồi HTTP hợp lệ và đều làm vỡ màn. R-08 nói dữ liệu ngoài
 * đi qua `zod` chính vì lý do đó.
 *
 * Nỗi lo "hai bên trôi ra xa nhau" thì xử lý bằng kiểu, không bằng cách bỏ
 * kiểm: mỗi schema dưới đây **khai kiểu trả về là chính interface của miền**.
 * Thêm một trường bắt buộc vào `Wall` mà quên sửa `WallSchema` thì
 * `pnpm typecheck` đỏ ngay tại dòng khai báo, chứ không đợi tới lúc chạy. Đó là
 * điều một bản sao viết tay không có.
 *
 * ## Ranh giới với `domain/spatial/integrity.ts` — hai việc khác nhau
 *
 * File này hỏi **"JSON này có đúng hình dạng không"**: khoá nào có mặt, kiểu
 * gì, nằm trong khoảng nào. Nó chạy trên payload thô, từng đối tượng một, và
 * không biết gì về các đối tượng khác.
 *
 * `checkIntegrity` (D-13) hỏi **"các mã có trỏ đúng vào nhau không"**: một cửa
 * gắn lên bức tường chưa từng được gửi, một phòng có đường bao rỗng. Nó cần cả
 * đồ thị đã chuẩn hoá mới trả lời được.
 *
 * Hai câu hỏi đó không thay được cho nhau, và **không** câu nào nên lấn sang
 * câu kia: nhét phép kiểm tham chiếu chéo vào `zod` thì một cửa mồ côi làm hỏng
 * cả lượt giải mã thay vì hiện thành một dòng cảnh báo đọc được.
 *
 * ## Vì sao mã thực thể ở đây chỉ là "chuỗi không rỗng"
 *
 * `domain/spatial/ids.ts` có sẵn `isIdOfKind`, và dùng nó ở đây trông rất hợp
 * lý cho tới lúc đối chiếu với dữ liệu thật. `isIdOfKind` mô tả **bộ sinh mã
 * của chính chúng ta** — tiền tố một chữ, rồi ít nhất mười ký tự base36 in hoa.
 * Nó từ chối:
 *
 * - `M-001` … `M-034`, bộ mã mà `screens/qc/DimensionOcrReview/dimensionOcrFixture.ts`
 *   đang dùng;
 * - `w1`, `d1`, `win1`, `r1`, `f1`, `v0` — mã trong **chính hợp đồng Spatial
 *   JSON** của đặc tả nghiên cứu (Phần IV), vốn không có tiền tố nào.
 *
 * Một máy chủ tự sinh mã theo lệ của nó là chuyện bình thường; ép nó theo lệ
 * của bộ sinh nội bộ là nhầm "mã do ta tạo" với "mã hợp lệ". Nên biên giới chỉ
 * đòi **chuỗi không rỗng**, và việc quy đổi mã của hợp đồng ngoài sang không
 * gian mã của miền là việc của tầng chuyển đổi, không phải của schema.
 *
 * Nhãn kiểu (`WallId` = `` `W-${string}` ``) vì thế được **gán** ở đây, đúng
 * vai trò mà `millimetres()` của `domain/units/types.ts` giữ cho số: biên giới
 * là nơi duy nhất một giá trị chưa có nhãn được nhận nhãn, và nó phải nhìn
 * thấy được.
 *
 * ## Không câu chữ nào trong file này
 *
 * Cùng lệ với `./index.ts`: schema giữ **hình dạng**, `src/i18n/vi.json` giữ
 * câu người đọc. Một `.refine()` hỏng cho ra mã `custom`, và `./decode.ts` dịch
 * nó thành "Trường '…' không đúng hợp đồng."
 *
 * ## Ba phép kiểm không suy ra được từ kiểu
 *
 * Kiểu nói `thicknessMm` là `number`. Nó không nói `0` là vô nghĩa, không nói
 * một bức tường dài 0 mm là rác, và **không** nói điều quan trọng nhất:
 *
 * - **A5 — máy không được tự nhận đã duyệt.** `reviewed: true` chỉ đánh dấu
 *   việc người duyệt. Mã trong repo đã theo lệ ấy: nơi đặt `reviewed: true`
 *   luôn đặt kèm `source: 'human'`
 *   (`screens/qc/DimensionOcrReview/dimensionOcrReviewGateway.ts:28,796`). Ở
 *   đây lệ ấy thành **luật của biên giới**: payload nói
 *   `{ source: 'ai', reviewed: true }` bị từ chối, chứ không lặng lẽ tô xanh
 *   một đối tượng chưa ai nhìn.
 * - **Đoạn thẳng phải có chiều dài.** `start` trùng `end` là một bức tường
 *   không tồn tại; đùn khối từ nó cho ra một tấm dày 0.
 * - **Hộp bao phải đúng chiều.** `max` nhỏ hơn `min` ở bất kỳ trục nào là hộp
 *   lộn trong ra ngoài.
 *
 * ## Phạm vi: cả chín thực thể của đồ thị
 *
 * Bốn thực thể của lớp một tầng — tường, ô mở, phòng, đồ đạc — nằm ở khối
 * giữa. Năm thực thể còn lại của `SpatialGraph` — `Building`, `Level`, `Axis`,
 * `Dimension`, `Note` — nằm ở khối cuối file, vì `GET /api/projects/{id}/spatial`
 * (N15) và `GET …/floors/{id}/spatial/layer` (N16) chở chúng thật
 * (HOP-DONG-MOI §4). Cho tới lượt hợp đồng mới thì đúng là chưa nhóm API nào
 * chở chúng, và khối chú thích này từng ghi lý do không dựng sẵn — R-69. Giờ có
 * nơi gọi, nên chúng vào đây theo đúng khuôn của bốn thực thể kia.
 *
 * Chúng ở **cùng file** chứ không ở `spatialGraph.ts` vì ba mảnh chúng cần —
 * `entityId`, `reviewMetadataShape`, `humanOnlyReview` — cố ý không export:
 * đó là lệ của biên giới này, và export chúng ra để dùng ở file khác là mở
 * đúng cái cửa mà A5 đóng.
 */

/* -------------------------------------------------------------------------- */
/* Mảnh dùng lại.                                                              */
/* -------------------------------------------------------------------------- */

/**
 * Mọi toạ độ và kích thước hình học là **số nguyên milimét** — quy ước viết
 * ngay đầu `domain/spatial/types.ts`. Một giá trị thập phân ở đây nghĩa là ai
 * đó đã quy đổi đơn vị ngoài `domain/units`, và đó là lớp lỗi mà kiểu có nhãn
 * của mô-đun ấy tồn tại để chặn (R-44).
 */
const millimetresSchema = z.number().int();
const positiveMillimetresSchema = millimetresSchema.positive();
const nonNegativeMillimetresSchema = millimetresSchema.nonnegative();

/** Diện tích lưu bằng mét vuông, không bao giờ âm. */
const squareMetresSchema = z.number().nonnegative();

/** Góc trong `[0, 360)` — `domain/spatial/types.ts`, kiểu `Degrees`. */
const degreesSchema = z.number().min(0).lt(360);

/** Độ tin cậy của mô hình AI, trong `[0, 1]`. */
const confidenceSchema = z.number().min(0).max(1);

/**
 * Mã thực thể trên dây: chuỗi không rỗng, nhận nhãn kiểu tại biên giới.
 *
 * Lý do không gọi `isIdOfKind` nằm ở khối chú thích đầu file. Phép gán nhãn là
 * cố ý và là chỗ **duy nhất** trong file này có `as`.
 */
const entityId = <TId extends string>(): z.ZodType<TId, z.ZodTypeDef, unknown> =>
  z
    .string()
    .min(1)
    .transform((value) => value as TId);

const wallIdSchema = entityId<Wall['id']>();
const openingIdSchema = entityId<Opening['id']>();
const roomIdSchema = entityId<Room['id']>();
const furnitureIdSchema = entityId<Furniture['id']>();
const levelIdSchema = entityId<Wall['levelId']>();

const pointSchema: z.ZodType<Point, z.ZodTypeDef, unknown> = z
  .object({
    x: millimetresSchema,
    y: millimetresSchema,
  })
  .strict();

/** Một đoạn thẳng thật sự có chiều dài — xem khối chú thích đầu file. */
const segmentSchema: z.ZodType<Segment, z.ZodTypeDef, unknown> = z
  .object({
    end: pointSchema,
    start: pointSchema,
  })
  .strict()
  .refine((segment) => segment.start.x !== segment.end.x || segment.start.y !== segment.end.y);

/** Hộp bao đúng chiều: `max` không nhỏ hơn `min` trên cả hai trục. */
const boundingBoxSchema: z.ZodType<BoundingBox, z.ZodTypeDef, unknown> = z
  .object({
    max: pointSchema,
    min: pointSchema,
  })
  .strict()
  .refine((box) => box.max.x >= box.min.x && box.max.y >= box.min.y);

/**
 * Ba trường soát duyệt mà mọi thực thể trong đồ thị đều mang.
 *
 * Không phải một schema độc lập: nó được trộn vào từng `z.object()` bên dưới
 * bằng phép trải, vì `.strict()` phải nhìn thấy trọn bộ khoá của một đối tượng
 * thì mới từ chối được khoá lạ.
 */
const reviewMetadataShape = {
  confidence: confidenceSchema,
  reviewed: z.boolean(),
  source: z.enum(['ai', 'human']),
  /** BE đặt khi người sửa mục AI (FIX-P0-04); FE không bao giờ gửi. */
  edited: z.boolean().optional(),
} as const;

/** J-v3: vật liệu từ thư viện hoặc từ cảnh, ví dụ `library:oak`. */
export const materialRefSchema = z.custom<MaterialRef>(
  (value) => typeof value === 'string' && /^(library|scene):[a-z0-9_-]{1,64}$/.test(value),
);

/** Sơn hai mặt tường; mặt vắng là vắng khoá. */
const wallPaintSchema = z
  .object({ exterior: materialRefSchema.optional(), interior: materialRefSchema.optional() })
  .strict()
  .transform(({ exterior, interior }) => ({
    ...(exterior !== undefined ? { exterior } : {}),
    ...(interior !== undefined ? { interior } : {}),
  }));

/** Mẫu Pascal đã chọn cho món đồ. */
const furnitureModelSchema = z
  .object({ id: z.string().max(120), src: z.string().regex(/^\/items\/[a-z0-9_-]+\/model\.glb$/) })
  .strict();

/** Vật liệu theo từng ô của mẫu, tối đa 8 ô. */
const furnitureSlotsSchema = z
  .record(z.string().regex(/^[a-z][a-z0-9_]{0,23}$/), materialRefSchema)
  .refine((slots) => Object.keys(slots).length <= 8);

/** Id đồ tự bày (`sceneDressingRules.ts`): `DRESS-<vai>-<id neo>[-<n>]`; khớp `DressingId` của AppBack. */
const DRESSING_ID = /^DRESS-[A-Za-z0-9_.:-]{1,160}$/;
const DRESSING_OFF_MAX = 200;

/** A5: đầu ra của máy không bao giờ được tự nhận là đã có người duyệt. */
const humanOnlyReview = (entity: ReviewMetadata): boolean =>
  !(entity.source === 'ai' && entity.reviewed);

/* -------------------------------------------------------------------------- */
/* Bốn thực thể của lớp không gian.                                            */
/* -------------------------------------------------------------------------- */

export const WallSchema: z.ZodType<Wall, z.ZodTypeDef, unknown> = z
  .object({
    ...reviewMetadataShape,
    centreline: segmentSchema,
    /** Tường cong: sagitta có dấu (mm) theo quy ước `curveOffset` của Pascal; vắng/`0` = thẳng. */
    curveOffsetMm: millimetresSchema.optional(),
    /** Độ dày máy đo, không đổi theo sửa của người (U48); `null`/vắng = không có. */
    detectedThicknessMm: positiveMillimetresSchema.nullish(),
    heightMm: positiveMillimetresSchema,
    id: wallIdSchema,
    kind: z.enum(['loadBearing', 'partition', 'envelope']),
    levelId: levelIdSchema,
    openingIds: z.array(openingIdSchema),
    paint: wallPaintSchema.optional(),
    thicknessMm: positiveMillimetresSchema,
  })
  .strict()
  .refine(humanOnlyReview)
  /* `paint` vắng là vắng khoá (xem chú thích của `FurnitureSchema` bên dưới). */
  .transform(({ paint, detectedThicknessMm, curveOffsetMm, ...wireWall }) => ({
    ...wireWall,
    ...(curveOffsetMm ? { curveOffsetMm } : {}),
    ...(detectedThicknessMm != null ? { detectedThicknessMm } : {}),
    ...(paint !== undefined ? { paint } : {}),
  }));

export const OpeningSchema: z.ZodType<Opening, z.ZodTypeDef, unknown> = z
  .object({
    ...reviewMetadataShape,
    heightMm: positiveMillimetresSchema,
    id: openingIdSchema,
    kind: z.enum(['door', 'window']),
    offsetMm: nonNegativeMillimetresSchema,
    sillHeightMm: nonNegativeMillimetresSchema,
    swing: z.enum(['left', 'right', 'double', 'sliding', 'fixed']),
    wallId: wallIdSchema,
    widthMm: positiveMillimetresSchema,
    /** H4: cửa lùa âm tường / cửa xếp (chỉ khi `swing: 'sliding'`). */
    doorStyle: z.enum(['pocket', 'folding']).optional(),
    /** H4: "Đổi hướng mở" — cánh mở phía kia (bản lề) hay lùa sang phải. */
    reversed: z.boolean().optional(),
  })
  .strict()
  .refine(humanOnlyReview)
  // Cùng luật với AppBack `Opening._door_style_on_sliding_door` (review EDITOR3D-DOT2 #1).
  .refine((opening) => opening.doorStyle === undefined || (opening.kind === 'door' && opening.swing === 'sliding'), {
    path: ['doorStyle'],
  })
  .transform(({ doorStyle, reversed, ...wireOpening }) => ({
    ...wireOpening,
    ...(doorStyle !== undefined ? { doorStyle } : {}),
    ...(reversed === true ? { reversed } : {}),
  }));

export const RoomSchema: z.ZodType<Room, z.ZodTypeDef, unknown> = z
  .object({
    ...reviewMetadataShape,
    areaM2: squareMetresSchema,
    /** Diện tích thông thủy (lùi nửa bề dày tường bao); máy chủ tính, chỉ đọc — không gửi lại khi ghi. */
    clearAreaM2: squareMetresSchema.optional(),
    id: roomIdSchema,
    levelId: levelIdSchema,
    name: z.string().min(1),
    /** Đường bao khép kín; điểm đầu không lặp lại ở cuối, nên ba điểm là ít nhất. */
    outline: z.array(pointSchema).min(3),
    usage: z.enum([
      'livingRoom',
      'bedroom',
      'kitchen',
      'bathroom',
      'corridor',
      'stairwell',
      'utility',
      'loggia',
      'other',
    ]),
    wallIds: z.array(wallIdSchema),
    finish: z.enum(['wood', 'tile', 'mosaic', 'decking', 'concrete']).optional(),
    floorMaterial: materialRefSchema.optional(),
    /** Đồ AppFront tự bày (`DRESS-…`) người dùng đã xoá trong 3D — không bày lại (H4). */
    dressingOff: z.array(z.string().regex(DRESSING_ID)).max(DRESSING_OFF_MAX).optional(),
    /** H4: vật liệu trần; vắng = thạch cao mặc định. */
    ceilingMaterial: materialRefSchema.optional(),
  })
  .strict()
  .refine(humanOnlyReview)
  /* `finish` vắng là vắng khoá (xem chú thích của `FurnitureSchema` bên dưới). */
  .transform(({ clearAreaM2, finish, floorMaterial, dressingOff, ceilingMaterial, ...wireRoom }) => ({
    ...wireRoom,
    ...(clearAreaM2 !== undefined ? { clearAreaM2 } : {}),
    ...(ceilingMaterial !== undefined ? { ceilingMaterial } : {}),
    ...(finish !== undefined ? { finish } : {}),
    ...(floorMaterial !== undefined ? { floorMaterial } : {}),
    ...(dressingOff !== undefined && dressingOff.length > 0 ? { dressingOff } : {}),
  }));

/**
 * `roomId` vắng mặt là vắng **khoá**, không phải khoá mang `undefined`.
 *
 * `tsconfig.json` bật `exactOptionalPropertyTypes`, nên `{ roomId: undefined }`
 * không gán được vào `Furniture`. Đó là lý do mọi schema trong thư mục này dựng
 * lại đối tượng trong `.transform()` thay vì trả thẳng kết quả phân tích.
 */
export const FurnitureSchema: z.ZodType<Furniture, z.ZodTypeDef, unknown> = z
  .object({
    ...reviewMetadataShape,
    boundingBox: boundingBoxSchema,
    centre: pointSchema,
    id: furnitureIdSchema,
    kind: z.enum([
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
    ]),
    levelId: levelIdSchema,
    roomId: roomIdSchema.optional(),
    rotationDeg: degreesSchema,
    variant: z.enum([...FURNITURE_VARIANTS, ...STAIR_VARIANTS]).optional(),
    heightMm: positiveMillimetresSchema.optional(),
    liftMm: nonNegativeMillimetresSchema.optional(),
    model: furnitureModelSchema.optional(),
    slots: furnitureSlotsSchema.optional(),
    suggested: z.boolean().optional(),
    /** M2 — đồ nhận nuôi từ một đề xuất (`DRESS-…`): giữ dấu luật nguồn (hợp đồng M2 §2.4). */
    origin: z
      .object({ suggestionId: z.string().regex(DRESSING_ID), rule: z.string().regex(/^[A-Z][A-Z0-9]{0,5}$/), ruleVersion: z.number().int().min(1) })
      .strict()
      .optional(),
  })
  .strict()
  .refine(humanOnlyReview)
  /* Liệt kê tường minh: trường nào quên chép ở đây sẽ bị bỏ rơi mà không báo. */
  .transform((wireFurniture) => ({
    boundingBox: wireFurniture.boundingBox,
    centre: wireFurniture.centre,
    confidence: wireFurniture.confidence,
    ...(wireFurniture.edited !== undefined ? { edited: wireFurniture.edited } : {}),
    id: wireFurniture.id,
    kind: wireFurniture.kind,
    levelId: wireFurniture.levelId,
    reviewed: wireFurniture.reviewed,
    ...(wireFurniture.roomId !== undefined ? { roomId: wireFurniture.roomId } : {}),
    rotationDeg: wireFurniture.rotationDeg,
    source: wireFurniture.source,
    ...(wireFurniture.variant !== undefined ? { variant: wireFurniture.variant } : {}),
    ...(wireFurniture.heightMm !== undefined ? { heightMm: wireFurniture.heightMm } : {}),
    ...(wireFurniture.liftMm !== undefined ? { liftMm: wireFurniture.liftMm } : {}),
    ...(wireFurniture.model !== undefined ? { model: wireFurniture.model } : {}),
    ...(wireFurniture.slots !== undefined ? { slots: wireFurniture.slots } : {}),
    ...(wireFurniture.suggested === true ? { suggested: true } : {}),
    ...(wireFurniture.origin !== undefined ? { origin: wireFurniture.origin } : {}),
  }));

/* -------------------------------------------------------------------------- */
/* Cả lớp không gian của một tầng.                                             */
/* -------------------------------------------------------------------------- */

/** Bốn danh sách thực thể của một tầng, đúng hình dạng `SpatialLayer`. */
export interface SpatialLayerShape {
  furniture: readonly Furniture[];
  openings: readonly Opening[];
  rooms: readonly Room[];
  walls: readonly Wall[];
  /** Mái của tầng; vắng = không có mái (roof-contract.md). */
  roofs?: readonly Roof[];
}

/** Số node tối đa của một mái: node `roof` + 32 `roof-segment` (roof-contract.md). */
export const ROOF_MAX_NODES = 33;

/**
 * Một mái. Máy chủ không đọc gì trong `nodes` (node Pascal bỏ `parentId`/`children`), nên ở
 * đây chỉ kiểm khung; `lib/pascal/roofs.ts` kiểm phần còn lại lúc dựng cảnh.
 */
export const RoofSchema: z.ZodType<Roof, z.ZodTypeDef, unknown> = z
  .object({
    ...reviewMetadataShape,
    id: entityId<Roof['id']>(),
    levelId: levelIdSchema,
    nodes: z.array(z.record(z.string(), z.unknown())).min(1).max(ROOF_MAX_NODES),
  })
  .strict()
  .refine(humanOnlyReview, { path: ['reviewed'] });

/**
 * Bốn danh sách mà `spatial.writeLayer` gửi đi và nhận về.
 *
 * Kiểu khai tại chỗ thay vì nhập `SpatialLayer` từ `../client.ts`: schema nhập
 * ngược từ chính file gọi nó là một vòng nhập, mà `pnpm cycles` chạy
 * `import/no-cycle` ở độ sâu không giới hạn và là bước thứ ba của `pnpm verify`.
 * Hai hình dạng trùng nhau về cấu trúc, nên `client.ts` dùng được schema này mà
 * không phải đổi một chữ ký công khai nào.
 */
export const SpatialLayerSchema: z.ZodType<SpatialLayerShape, z.ZodTypeDef, unknown> = z
  .object({
    furniture: z.array(FurnitureSchema),
    openings: z.array(OpeningSchema),
    rooms: z.array(RoomSchema),
    walls: z.array(WallSchema),
    roofs: z.array(RoofSchema).optional(),
  })
  .strict()
  // Vắng khi rỗng: lớp không mái giữ đúng hình cũ (máy chủ cũ không biết khoá này).
  .transform(({ roofs, ...layer }) => (roofs === undefined || roofs.length === 0 ? layer : { ...layer, roofs }));

/* -------------------------------------------------------------------------- */
/* Năm thực thể còn lại của đồ thị.                                            */
/* -------------------------------------------------------------------------- */

const axisIdSchema = entityId<Axis['id']>();
const dimensionIdSchema = entityId<Dimension['id']>();
const levelOwnIdSchema = entityId<Level['id']>();

/**
 * Mã của bất kỳ thực thể nào — `Dimension.referenceIds` và `Note.entityId` trỏ
 * tới cả bảy họ, nên nhãn của chúng là hợp của cả bảy.
 */
const anyEntityIdSchema = entityId<EntityId>();

/**
 * Công trình mà đồ thị mô tả. Đúng một cái cho mỗi dự án.
 *
 * `datumElevationMm` là cao độ `+0.000` đặt trong hệ toạ độ dự án, nên nó **có
 * dấu**: một tầng hầm nằm dưới mốc là số âm, và `positiveMillimetresSchema` ở
 * đây sẽ từ chối đúng những công trình có tầng hầm.
 */
export const BuildingSchema: z.ZodType<Building, z.ZodTypeDef, unknown> = z
  .object({
    ...reviewMetadataShape,
    address: z.string().min(1).optional(),
    datumElevationMm: millimetresSchema,
    grossFloorAreaM2: squareMetresSchema.optional(),
    name: z.string().min(1),
  })
  .strict()
  .refine(humanOnlyReview, { path: ['reviewed'] })
  .transform((wireBuilding) => ({
    ...(wireBuilding.address !== undefined ? { address: wireBuilding.address } : {}),
    confidence: wireBuilding.confidence,
    datumElevationMm: wireBuilding.datumElevationMm,
    ...(wireBuilding.grossFloorAreaM2 !== undefined
      ? { grossFloorAreaM2: wireBuilding.grossFloorAreaM2 }
      : {}),
    name: wireBuilding.name,
    reviewed: wireBuilding.reviewed,
    source: wireBuilding.source,
  }));

/**
 * Một tầng, kèm tỉ lệ bản vẽ của chính nó.
 *
 * `scaleMillimetresPerPixel` nhận nhãn `MillimetresPerPixel` bằng lời gọi
 * `millimetresPerPixel()` của `domain/units/scale.ts:85-88`, **không** bằng
 * `as`. Khác biệt không phải thẩm mỹ: hàm ấy còn `assertFinite`, nên một
 * `Infinity` lọt qua JSON bị chặn ở đây thay vì thành một phép chia cho vô cực
 * ở chỗ vẽ. `.positive().finite()` phía trên đã lọc trước, nên lời gọi kia
 * không bao giờ `throw` trên dữ liệu đã qua schema — nó là lớp thứ hai, và là
 * chỗ duy nhất một số chưa nhãn nhận được nhãn (R-44).
 *
 * Tầng chưa hiệu chỉnh thì **vắng** khoá này. Tỉ lệ "tạm" mà pipeline suy ra
 * vẫn đi kèm `scaleStatus: 'unresolved'` ở N16 (`spatialLayer.ts`), nên chỗ đọc
 * phân biệt được "chưa có" với "có nhưng chưa ai xác nhận".
 */
export const LevelSchema: z.ZodType<Level, z.ZodTypeDef, unknown> = z
  .object({
    ...reviewMetadataShape,
    areaM2: squareMetresSchema.optional(),
    elevationMm: millimetresSchema,
    heightMm: positiveMillimetresSchema,
    id: levelOwnIdSchema,
    name: z.string().min(1),
    order: z.number().int(),
    scaleMillimetresPerPixel: z.number().positive().finite().optional(),
  })
  .strict()
  .refine(humanOnlyReview, { path: ['reviewed'] })
  .transform((wireLevel) => ({
    ...(wireLevel.areaM2 !== undefined ? { areaM2: wireLevel.areaM2 } : {}),
    confidence: wireLevel.confidence,
    elevationMm: wireLevel.elevationMm,
    heightMm: wireLevel.heightMm,
    id: wireLevel.id,
    name: wireLevel.name,
    order: wireLevel.order,
    reviewed: wireLevel.reviewed,
    ...(wireLevel.scaleMillimetresPerPixel !== undefined
      ? { scaleMillimetresPerPixel: millimetresPerPixel(wireLevel.scaleMillimetresPerPixel) }
      : {}),
    source: wireLevel.source,
  }));

/** Một trục định vị. `line` đi qua `segmentSchema`, nên trục dài 0 mm bị chặn. */
export const AxisSchema: z.ZodType<Axis, z.ZodTypeDef, unknown> = z
  .object({
    ...reviewMetadataShape,
    direction: z.enum(['horizontal', 'vertical']),
    id: axisIdSchema,
    label: z.string().min(1),
    levelId: levelIdSchema,
    line: segmentSchema,
  })
  .strict()
  .refine(humanOnlyReview, { path: ['reviewed'] });

/**
 * Một chuỗi kích thước đọc được trên bản vẽ.
 *
 * Hai phép kiểm không suy ra được từ kiểu, và chúng đi theo thứ tự đó:
 *
 * - **A5**, như mọi thực thể khác;
 * - **`valueMm > 0` trừ khi `kind === 'elevation'`.** Một chiều dài bằng 0 là
 *   một chuỗi OCR đọc hỏng. Cao độ thì khác hẳn: `±0.000` là cốt nền, và một
 *   tầng hầm có cao độ âm — nên đúng loại ấy được miễn, chứ không phải mọi loại
 *   được nới.
 *
 * `referenceIds` **được rỗng**: một kích thước người dùng tự vẽ chưa gắn vào
 * thực thể nào là chuyện bình thường (`lib/commands/business/wallCommands.ts:1138`),
 * và B3-03 còn gỡ mã của thực thể đã xoá khỏi danh sách này.
 */
export const DimensionSchema: z.ZodType<Dimension, z.ZodTypeDef, unknown> = z
  .object({
    ...reviewMetadataShape,
    id: dimensionIdSchema,
    kind: z.enum(['linear', 'chain', 'radial', 'angular', 'elevation']),
    levelId: levelIdSchema,
    line: segmentSchema,
    overrideValueMm: millimetresSchema.optional(),
    referenceIds: z.array(anyEntityIdSchema),
    valueMm: millimetresSchema,
  })
  .strict()
  .refine(humanOnlyReview, { path: ['reviewed'] })
  .refine((dimension) => dimension.kind === 'elevation' || dimension.valueMm > 0, {
    path: ['valueMm'],
  })
  .transform((wireDimension) => ({
    confidence: wireDimension.confidence,
    ...(wireDimension.edited !== undefined ? { edited: wireDimension.edited } : {}),
    id: wireDimension.id,
    kind: wireDimension.kind,
    levelId: wireDimension.levelId,
    line: wireDimension.line,
    ...(wireDimension.overrideValueMm !== undefined
      ? { overrideValueMm: wireDimension.overrideValueMm }
      : {}),
    referenceIds: wireDimension.referenceIds,
    reviewed: wireDimension.reviewed,
    source: wireDimension.source,
    valueMm: wireDimension.valueMm,
  }));

/**
 * Một ghi chú gắn vào bất kỳ thực thể nào.
 *
 * `id` là chuỗi tự do, không phải `entityId`: `NoteId` không nằm trong bảng
 * tiền tố của `domain/spatial/types.ts:85-87`. `entityId` — thứ nó trỏ tới —
 * thì có, nên nó đi qua `anyEntityIdSchema`.
 *
 * `createdAt` dùng `isoInstantSchema`, chặt hơn `isoDateTimeSchema` của hợp
 * đồng cũ: UTC `Z`, đúng ba chữ số mili giây.
 */
export const NoteSchema: z.ZodType<Note, z.ZodTypeDef, unknown> = z
  .object({
    ...reviewMetadataShape,
    authorId: z.string().min(1),
    body: z.string().min(1),
    createdAt: isoInstantSchema,
    entityId: anyEntityIdSchema,
    id: z.string().min(1),
  })
  .strict()
  .refine(humanOnlyReview, { path: ['reviewed'] });
