import { z } from 'zod';

import type { LevelId, SpatialGraph } from '@/domain/spatial/types';

import {
  AxisSchema,
  BuildingSchema,
  DimensionSchema,
  FurnitureSchema,
  LevelSchema,
  NoteSchema,
  OpeningSchema,
  RoofSchema,
  RoomSchema,
  WallSchema,
} from './spatial';
import { floorSuggestionsShape } from './suggestions';

/**
 * `GET /api/projects/{project_id}/spatial` — cả đồ thị của một công trình, kèm
 * `revision` hiện tại của từng tầng.
 *
 * ## Vì sao `floorRevisions` đi cùng đồ thị chứ không phải một lượt gọi khác
 *
 * Đồ thị là thứ để **đọc**; `floorRevisions` là thứ để **ghi lại**: mỗi lượt
 * `PUT …/spatial/layer` (#35) gửi `baseVersion` của đúng tầng nó sửa, và
 * `ScaleCalibration` khi "áp cho mọi tầng" cần `baseVersion` của **tất cả** các
 * tầng cùng lúc. Hai lượt gọi riêng thì giữa chúng có một khe thời gian, và
 * lượt ghi sau đó dựa trên một số `revision` có thể đã cũ — tức là đúng cái
 * xung đột mà version tồn tại để chặn, chỉ khác là lần này do chính client gây
 * ra.
 *
 * F-04a băm danh sách cặp `floorId:revision` đã sắp để làm `versionId` của kho.
 *
 * ## Refine một-một, và nó KHÔNG kiểm tham chiếu chéo
 *
 * Phép kiểm duy nhất ở đây là "mỗi tầng có đúng một `floorRevisions`, và ngược
 * lại". Nó nằm trong `zod` được vì nó nói về **đúng tài liệu này**, không về
 * nội dung của nó: đếm hai danh sách, so hai tập mã.
 *
 * Những thứ nghe có vẻ cùng loại — `levels` sắp theo `order`, mọi `levelId`
 * của tường trỏ tới một tầng có thật — **không** ở đây. Chúng là "H1 ngữ cảnh"
 * của HOP-DONG-MOI §0.2 bảng B, và lý do đã ghi ở `./spatial.ts`: một tường mồ
 * côi lọt vào `zod` sẽ làm hỏng cả lượt giải mã của cả công trình, thay vì hiện
 * thành một dòng cảnh báo mà màn vẫn vẽ được phần còn lại.
 */

/**
 * Mã tầng trên dây: chuỗi không rỗng, không regex — luật id của HOP-DONG-MOI §0.1.
 *
 * ## Vì sao khai lại thay vì dùng chung
 *
 * `entityId` của `./spatial.ts:150-154` làm đúng việc này, và nó cố ý **không
 * export** — cùng lệ với `reviewMetadataShape` và `humanOnlyReview`. Ba mảnh ấy
 * là lệ nội bộ của biên giới không gian; mở chúng ra để tiết kiệm bốn dòng ở
 * đây là mở đúng cái cửa mà A5 đóng. Nên bản sao, không phải lời nhập.
 *
 * ## Vì sao vẫn phải gán nhãn `LevelId`
 *
 * Bản đầu của file này dừng ở `z.string().min(1)`, và hệ quả là
 * `FloorRevision.floorId` ra kiểu `string`. Mọi nơi gọi — F-04a băm cặp
 * `floorId:revision`, F-04c gửi một PUT cho mỗi tầng, F-08 so với `revision`
 * hiện tại — đều làm việc với `LevelId`, nên chúng sẽ phải ép kiểu ở biên. Ép
 * kiểu ở nơi gọi là đúng thứ mà một biên giới có nhãn tồn tại để khỏi phải làm:
 * biên giới là chỗ **duy nhất** một giá trị chưa có nhãn được nhận nhãn (R-44),
 * và nó phải nhìn thấy được. Nên phép gán nhãn nằm ở đây, đúng một chỗ, đúng
 * khuôn `entityId`.
 */
const floorIdSchema: z.ZodType<LevelId, z.ZodTypeDef, unknown> = z
  .string()
  .min(1)
  .transform((value) => value as LevelId);

/** Số hiệu bản ghi của một tài liệu tầng. Bắt đầu từ 0 và chỉ tăng. */
const revisionSchema = z.number().int().nonnegative();

/**
 * Cả đồ thị: công trình, các tầng, và chín họ thực thể.
 *
 * `axes` và `notes` là `[]` ở v1 — pipeline chưa sinh trục, và không màn nào
 * đọc ghi chú. Chúng vẫn có mặt trong hợp đồng vì `SpatialGraph` của miền có
 * chúng, và một danh sách rỗng là câu trả lời đúng cho "chưa có", trong khi một
 * khoá vắng sẽ bắt mọi nơi đọc tự đoán.
 */
export const SpatialGraphSchema: z.ZodType<SpatialGraph, z.ZodTypeDef, unknown> = z
  .object({
    axes: z.array(AxisSchema),
    building: BuildingSchema,
    dimensions: z.array(DimensionSchema),
    furniture: z.array(FurnitureSchema),
    levels: z.array(LevelSchema),
    notes: z.array(NoteSchema),
    openings: z.array(OpeningSchema),
    rooms: z.array(RoomSchema),
    walls: z.array(WallSchema),
    roofs: z.array(RoofSchema).optional(),
  })
  .strict()
  .transform(({ roofs, ...graph }) => (roofs === undefined || roofs.length === 0 ? graph : { ...graph, roofs }));

/** `revision` hiện tại của một tầng, đủ để mở một lượt ghi có version lên nó. */
export const FloorRevisionSchema = z
  .object({
    floorId: floorIdSchema,
    revision: revisionSchema,
    /** M2 — lớp đề xuất của tầng ở N15 (đề xuất tới BE: cùng chỗ với `revision`); vắng khi rỗng. */
    ...floorSuggestionsShape,
  })
  .strict();

export type FloorRevision = z.infer<typeof FloorRevisionSchema>;

/**
 * Đồ thị cộng bảng `revision` — thân đầy đủ của N15.
 *
 * Bốn vế của `.refine()` cùng nói một câu: hai danh sách là **song ánh**. Viết
 * rời ra vì mỗi vế hỏng theo một cách khác nhau và một bài test chỉ nên vi phạm
 * đúng một vế:
 *
 * 1. `floorRevisions` không có mã trùng;
 * 2. `levels` không có mã trùng;
 * 3. hai danh sách cùng độ dài;
 * 4. mọi mã tầng có một dòng `revision`.
 *
 * Gộp thành "hai tập bằng nhau" thì một `floorRevisions` có hai dòng cho cùng
 * một tầng vẫn lọt — và đó chính là hình dạng mà một lượt ghi đua nhau tạo ra.
 */
export const SpatialGraphDocumentSchema = z
  .object({
    floorRevisions: z.array(FloorRevisionSchema),
    graph: SpatialGraphSchema,
  })
  .strict()
  .refine(
    (document) => {
      const floorIds = new Set(document.floorRevisions.map((revision) => revision.floorId));
      const levelIds = new Set(document.graph.levels.map((level) => level.id));

      return (
        floorIds.size === document.floorRevisions.length &&
        levelIds.size === document.graph.levels.length &&
        floorIds.size === levelIds.size &&
        [...levelIds].every((levelId) => floorIds.has(levelId))
      );
    },
    { path: ['floorRevisions'] },
  );

export type SpatialGraphDocument = z.infer<typeof SpatialGraphDocumentSchema>;
