import { z } from 'zod';

import type { ConflictResponseBody, EntityKind } from '@/lib/versioning/conflict';

import { isoInstantSchema } from './common';

/**
 * Thân của mọi phản hồi lỗi: hình dạng chung ở trên, 409 của ghi-có-version ở dưới.
 *
 * ## Một mã, không một câu
 *
 * Máy chủ gửi `code` — `VALIDATION`, `VERSION_CONFLICT` — chứ không gửi câu
 * tiếng Việt. Cùng lý lẽ đã ghi cho `SignInSchema` ở `./index.ts`: `src/api`
 * giữ hình dạng, `src/i18n/vi.json` giữ câu người đọc, và
 * `lib/errors/toAppError.ts` là chỗ nối hai thứ đó. Một thân lỗi mang sẵn câu
 * chữ thì câu ấy không dịch được, không test được, và đổi lời nghĩa là đổi máy
 * chủ.
 *
 * ## Vì sao hai schema chứ không một
 *
 * `VERSION_CONFLICT` là mã lỗi duy nhất mang thêm dữ liệu nghiệp vụ —
 * `currentVersion` và danh sách thay đổi từ xa — vì nó là mã duy nhất mà màn
 * **làm được gì đó** ngoài việc báo: `lib/versioning/conflict.ts` trộn thay đổi
 * và hỏi người dùng chọn. Nhét hai trường ấy vào thân chung dưới dạng tuỳ chọn
 * thì mọi nơi đọc lỗi đều phải tự hỏi "lần này có không", và `resolveConflict`
 * nhận được một danh sách rỗng sẽ **tự nâng base rồi ghi đè im lặng**
 * (`lib/versioning/conflict.ts:103-110`). Tách làm hai schema biến câu hỏi ấy
 * thành một phép chọn theo `code`, ở đúng một chỗ.
 *
 * ## Vì sao `step` và `resource` khai lại tại chỗ
 *
 * `PIPELINE_STAGES` của `lib/realtime/pipeline.ts` là nguồn thật của sáu id
 * bước, và nhập nó vào đây sẽ **đúng** về dữ liệu mà **sai** về hệ quả: file đó
 * nhập `i18n/vi.json` và `throw` ngay lúc nạp nếu tổng trọng số khác 100
 * (`pipeline.ts:59-61`). Một schema lỗi mà nạp được kéo theo cả bảng chuỗi và
 * một lời `throw` lúc khởi động là thứ không ai muốn đứng sau nó lúc mọi thứ
 * đang hỏng. Bản sao không trôi được: `errors.test.ts` nhập cả hai và khẳng
 * định hai danh sách bằng nhau — ở tầng test, cái giá ấy bằng không.
 *
 * `resource` cũng khai tại chỗ và **không** export: mười lăm giá trị ấy là từ
 * vựng của máy chủ (BE-00 §4), không phải một kiểu miền mà ai đó nên dựng logic
 * lên trên.
 */

/* -------------------------------------------------------------------------- */
/* Mảnh lá.                                                                    */
/* -------------------------------------------------------------------------- */

/** Mã lỗi trên dây: UPPER_SNAKE, BE-00 §4. */
const errorCodeSchema = z.string().regex(/^[A-Z][A-Z0-9_]{2,63}$/);

/**
 * Ai gây ra thay đổi: một người, hoặc chính ống pipeline.
 *
 * `system:pipeline` là literal chứ không phải một `usr_` giả, vì việc máy làm
 * không được đội lốt việc người làm — cùng lý lẽ với A5 ở `./spatial.ts`.
 */
const actorIdSchema = z.string().regex(/^(usr_[0-9A-HJKMNP-TV-Z]{26}|system:pipeline)$/);

/** Đường chấm tới trường hỏng, ví dụ `body.baseVersion`. Mẫu ở HOP-DONG-MOI §1.1. */
const errorFieldSchema = z.string().regex(/^[A-Za-z][A-Za-z0-9]*(\.[A-Za-z0-9]+)*$/);

/** Sáu bước của ống xử lý. Bản sao của `PIPELINE_STAGES` — xem docblock đầu file. */
const ERROR_STEPS = [
  'preprocess',
  'wallSegmentation',
  'openingAndFurnitureDetection',
  'dimensionReading',
  'spatialDataBuild',
  'qualityCheck',
] as const;

/** Loại tài nguyên mà một 404/403 nói tới. Không export: từ vựng của máy chủ. */
const ERROR_RESOURCES = [
  'project',
  'floor',
  'member',
  'version',
  'upload',
  'measurement',
  'template',
  'libraryItem',
  'modelFamily',
  'modelVersion',
  'dataset',
  'datasetVersion',
  'trainingJob',
  'notification',
  'user',
  'shareLink',
  'lightingBake',
  'modelExport',
] as const;

/* -------------------------------------------------------------------------- */
/* Thân lỗi chung.                                                             */
/* -------------------------------------------------------------------------- */

/**
 * Mọi phản hồi có status ≥ 400, trừ `VERSION_CONFLICT`.
 *
 * Bảy trường sau `code` và `requestId` đều tuỳ chọn vì chúng là **ngữ cảnh của
 * một loại lỗi**, không phải của mọi lỗi: `count` chỉ có nghĩa khi Pydantic đếm
 * được nhiều lỗi cùng lúc, `fileName` chỉ có nghĩa khi đang tải tệp lên. Vắng
 * khoá là vắng — không bao giờ là `null` (W2).
 */
export const ApiErrorBodySchema = z
  .object({
    code: errorCodeSchema,
    count: z.number().int().nonnegative().optional(),
    field: errorFieldSchema.optional(),
    fileName: z.string().min(1).optional(),
    floor: z.string().min(1).optional(),
    layer: z.string().min(1).optional(),
    reason: z.enum(['revoked', 'expired']).optional(),
    requestId: z.string().min(1),
    resource: z.enum(ERROR_RESOURCES).optional(),
    step: z.enum(ERROR_STEPS).optional(),
  })
  .strict()
  .transform((wireError) => ({
    code: wireError.code,
    ...(wireError.count !== undefined ? { count: wireError.count } : {}),
    ...(wireError.field !== undefined ? { field: wireError.field } : {}),
    ...(wireError.fileName !== undefined ? { fileName: wireError.fileName } : {}),
    ...(wireError.floor !== undefined ? { floor: wireError.floor } : {}),
    ...(wireError.layer !== undefined ? { layer: wireError.layer } : {}),
    ...(wireError.reason !== undefined ? { reason: wireError.reason } : {}),
    requestId: wireError.requestId,
    ...(wireError.resource !== undefined ? { resource: wireError.resource } : {}),
    ...(wireError.step !== undefined ? { step: wireError.step } : {}),
  }));

export type ApiErrorBody = z.infer<typeof ApiErrorBodySchema>;

/* -------------------------------------------------------------------------- */
/* 409 — xung đột version.                                                     */
/* -------------------------------------------------------------------------- */

/**
 * Bảy loại thực thể mà nhật ký thay đổi theo trường biết nói về.
 *
 * Danh sách này phải **bằng** `EntityKind` của
 * `lib/versioning/mergeStrategies.ts:1`, và phép so ấy là việc của
 * `pnpm typecheck` — nhưng nó cần **hai** lời khai, không một, vì một phép so
 * bằng là hai phép so bao hàm:
 *
 * - `satisfies readonly EntityKind[]` ngay dưới đây canh chiều **thừa**: thêm
 *   một chuỗi không phải `EntityKind` vào mảng thì đỏ tại chỗ.
 * - Chiều **thiếu** — ai đó thêm loại thứ tám vào `mergeStrategies.ts` mà quên
 *   file này — `satisfies` **không** bắt được: một tập con vẫn thoả
 *   `readonly EntityKind[]`, nên mã vẫn biên dịch sạch, test vẫn xanh, và
 *   schema lặng lẽ từ chối loại mới. Chiều ấy do lời khai kiểu của
 *   {@link entityTypeSchema} canh, và đó là lý do nó tồn tại.
 *
 * Hai đầu tường là `vertex`, không phải `wall`, vì kéo một đầu tường là một
 * thay đổi trộn được với việc người khác kéo đầu kia.
 */
export const VERSION_ENTITY_KINDS = [
  'vertex',
  'wall',
  'door',
  'window',
  'furniture',
  'room',
  'dimension',
  'roof',
] as const satisfies readonly EntityKind[];

/**
 * Chiều còn lại của phép so bằng: **mọi** `EntityKind` phải nằm trong mảng.
 *
 * `z.ZodEnum<T>` phơi ra `enum: { [k in T[number]]: k }`, nên gán một
 * `ZodEnum` bảy giá trị vào `ZodEnum<[EntityKind, ...EntityKind[]]>` bắt
 * TypeScript đòi đủ **khoá** cho từng `EntityKind`. Thiếu một loại thì đỏ ngay
 * dòng này, với câu "Property 'x' is missing" gọi đúng tên loại bị bỏ quên.
 *
 * Nó là một lời khai kiểu chứ không phải một phép kiểm lúc chạy, và nó được
 * **dùng** ngay bên dưới — một hằng canh gác không ai đọc thì chính nó là thứ
 * bị xoá trong lượt dọn dẹp tiếp theo.
 */
const entityTypeSchema: z.ZodEnum<[EntityKind, ...EntityKind[]]> = z.enum(VERSION_ENTITY_KINDS);

/**
 * Một trường mà người khác đã đổi trong lúc mình đang sửa.
 *
 * ## `value` là ngoại lệ **duy nhất** của luật "vắng vẫn vắng"
 *
 * Trên dây, **vắng khoá `value` nghĩa là trường đó bị gỡ** — không phải là
 * "không biết". Ở miền, `FieldChange.value: unknown` là khoá **bắt buộc**
 * (`lib/versioning/mergeStrategies.ts:3-8`), và repo bật
 * `exactOptionalPropertyTypes`, nên một đối tượng thiếu hẳn khoá ấy không gán
 * được vào `FieldChange`. Hai điều đó không hoà được bằng cách bỏ khoá, nên
 * `.transform()` dưới đây **luôn** đặt `value: wireChange.value`: đầu ra có khoá
 * `value` kể cả khi dây không có, và giá trị của nó là `undefined`.
 *
 * `null` thì khác hẳn: nó là một giá trị JSON hợp lệ mà máy chủ không bao giờ
 * được gửi (W2), nên nó bị `.refine()` chặn. "Trường bị gỡ" và "trường mang giá
 * trị rỗng" phải phân biệt được, nếu không thì bộ trộn không biết nên xoá hay
 * nên ghi.
 */
export const RemoteFieldChangeSchema = z
  .object({
    changedAt: isoInstantSchema,
    changedBy: actorIdSchema,
    changedByName: z.string().min(1),
    entityId: z.string().min(1),
    entityType: entityTypeSchema,
    field: z.string().min(1),
    value: z.unknown(),
  })
  .strict()
  .refine((wireChange) => wireChange.value !== null, { path: ['value'] })
  .transform((wireChange) => ({
    changedAt: wireChange.changedAt,
    changedBy: wireChange.changedBy,
    changedByName: wireChange.changedByName,
    entityId: wireChange.entityId,
    entityType: wireChange.entityType,
    field: wireChange.field,
    value: wireChange.value,
  }));

export type RemoteFieldChangeBody = z.infer<typeof RemoteFieldChangeSchema>;

/**
 * Thân 409 của mọi lượt ghi có version.
 *
 * `code` và `requestId` **có** trên dây và **không** có ở đầu ra: chúng đã làm
 * xong việc của mình lúc `toAppError` chọn nhánh theo mã, và
 * `ConflictResponseBody` (`lib/versioning/conflict.ts:21-24`) chỉ gồm hai
 * trường mà bộ trộn thật sự cần. Giữ lại hai khoá đã dùng rồi là mời người sau
 * đọc `requestId` từ một chỗ không phải `AppError`.
 *
 * `remoteChanges` **được rỗng** ở đây, dù ba đường #35, N19 và cấu hình luật
 * luôn gửi ít nhất một mục: siết `.min(1)` trong schema thì một máy chủ đúng mà
 * hơi khác sẽ làm hỏng cả lượt giải mã, và cái rào thật cho danh sách rỗng nằm
 * ở chỗ gọi (HOP-DONG-MOI §1.1, "Rào của C1"), nơi biết mình đang ở đường nào.
 */
export const VersionConflictBodySchema: z.ZodType<ConflictResponseBody, z.ZodTypeDef, unknown> = z
  .object({
    code: z.literal('VERSION_CONFLICT'),
    currentVersion: z.number().int().nonnegative(),
    remoteChanges: z.array(RemoteFieldChangeSchema),
    requestId: z.string().min(1),
  })
  .strict()
  .transform((wireConflict) => ({
    currentVersion: wireConflict.currentVersion,
    remoteChanges: wireConflict.remoteChanges,
  }));
