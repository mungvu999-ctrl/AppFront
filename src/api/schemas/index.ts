import { z } from 'zod';

import { MAX_EMAIL_LENGTH } from './auth';

const idSchema = z.string().min(1);
const isoDateTimeSchema = z.string().datetime({ offset: true });
const mmIntegerSchema = z.number().int();
const positiveMmIntegerSchema = mmIntegerSchema.positive();

const userRoleByWire = {
  admin: 'admin',
  engineer: 'engineer',
  viewer: 'viewer',
} as const;

const progressStatusByWire = {
  completed: 'completed',
  failed: 'failed',
  pending: 'pending',
  running: 'running',
} as const;

const projectStatusByWire = {
  approved: 'approved',
  draft: 'draft',
  error: 'error',
  processing: 'processing',
} as const;

const wireUserRoleSchema = z.enum(['admin', 'engineer', 'viewer']);
const wireProgressStatusSchema = z.enum(['pending', 'running', 'completed', 'failed']);
const wireProjectStatusSchema = z.enum(['draft', 'processing', 'approved', 'error']);

/* -------------------------------------------------------------------------- */
/* Credentials.                                                                */
/* -------------------------------------------------------------------------- */

/**
 * What `/auth/login` and `/auth/register` post.
 *
 * These are the only schemas in this file that describe something going *out*.
 * Everything below decodes a wire payload the server sent; these two check a
 * form before it is allowed to become a request, which is the same job done in
 * the other direction — R-08 in both cases.
 *
 * **They carry no messages.** Every other rule in this file is a shape, and a
 * shape is all these are too: `src/api` owns what a valid address looks like,
 * `src/i18n/vi.json` owns the sentence a person reads when theirs is not one.
 * The screen maps an issue back to its sentence — see `useAuthScreen.ts` — so a
 * reworded complaint never means touching the data layer, and this module never
 * ends up holding Vietnamese prose it has no way to test.
 *
 * The field schemas are exported one by one because validation happens per
 * field, on the way out of it, long before there is a whole form to check.
 */

/** Shortest password the form will send. Anything shorter is a typo, not an attempt. */
export const MIN_PASSWORD_LENGTH = 8;

export { MAX_EMAIL_LENGTH };

/**
 * `.min(1)` before `.email()` on purpose. `.max()` comes last, so an address that is
 * both malformed and long is reported as malformed — the thing to fix first.
 *
 * zod collects every failing check on a string rather than stopping at the
 * first, and reports them in declaration order — so an empty box yields
 * "chưa nhập" ahead of "sai dạng", which is the complaint worth showing. The
 * order of these two lines is load-bearing.
 */
export const EmailSchema = z.string().min(1).email().max(MAX_EMAIL_LENGTH);

/**
 * Same ordering, same reason: empty reads as missing, four characters reads as short.
 * Length counts code points, like the BE `min_length` (BUG-P07-010): `z.string().min()`
 * counts UTF-16 units, so "Aaa1" + two emoji (6 code points) would slip through.
 */
export const PasswordSchema = z
  .string()
  .min(1)
  .superRefine((value, ctx) => {
    if (value !== '' && [...value].length < MIN_PASSWORD_LENGTH) {
      ctx.addIssue({
        code: z.ZodIssueCode.too_small,
        minimum: MIN_PASSWORD_LENGTH,
        type: 'string',
        inclusive: true,
      });
    }
  });

/** Trimmed first, so a name of three spaces is missing rather than present. */
export const FullNameSchema = z.string().trim().min(1);

export const SignInSchema = z
  .object({
    email: EmailSchema,
    password: PasswordSchema,
    rememberMe: z.boolean(),
  })
  .strict();

/** The register tab posts the same two credentials, plus a name to greet. */
export const RegisterSchema = SignInSchema.extend({
  fullName: FullNameSchema,
}).strict();

export type SignInInput = z.infer<typeof SignInSchema>;
export type RegisterInput = z.infer<typeof RegisterSchema>;

/* -------------------------------------------------------------------------- */
/* Resources.                                                                  */
/* -------------------------------------------------------------------------- */

export const UserSchema = z
  .object({
    avatarUrl: z.string().url().optional(),
    email: z.string().email(),
    id: idSchema,
    name: z.string().min(1),
    /** U24: vai trong dự án (chỉ ở `Project.members`, khi đã đặt); vắng = theo vai toàn hệ thống. */
    projectRole: z.enum(['engineer', 'viewer']).optional(),
    role: wireUserRoleSchema,
  })
  .strict()
  .transform((wireUser) => ({
    ...(wireUser.avatarUrl !== undefined ? { avatarUrl: wireUser.avatarUrl } : {}),
    email: wireUser.email,
    id: wireUser.id,
    name: wireUser.name,
    ...(wireUser.projectRole !== undefined ? { projectRole: wireUser.projectRole } : {}),
    role: userRoleByWire[wireUser.role],
  }));

export type User = z.infer<typeof UserSchema>;
export type UserWire = z.input<typeof UserSchema>;
export type UserRole = User['role'];

export const DrawingSchema = z
  .object({
    /** SHA-256 hex của tệp gốc (UX41 P01); vắng với lượt tải cũ. */
    contentSha256: z.string().regex(/^[0-9a-f]{64}$/u).optional(),
    heightMm: positiveMmIntegerSchema,
    id: idSchema,
    name: z.string().min(1),
    scale: z.number().positive().optional(),
    uploadedAt: isoDateTimeSchema,
    uploaderId: idSchema,
    url: z.string().url(),
    widthMm: positiveMmIntegerSchema,
  })
  .strict()
  .transform((wireDrawing) => ({
    ...(wireDrawing.contentSha256 !== undefined ? { contentSha256: wireDrawing.contentSha256 } : {}),
    heightMm: wireDrawing.heightMm,
    id: wireDrawing.id,
    name: wireDrawing.name,
    ...(wireDrawing.scale !== undefined ? { scale: wireDrawing.scale } : {}),
    uploadedAt: wireDrawing.uploadedAt,
    uploaderId: wireDrawing.uploaderId,
    url: wireDrawing.url,
    widthMm: wireDrawing.widthMm,
  }));

export type Drawing = z.infer<typeof DrawingSchema>;
export type DrawingWire = z.input<typeof DrawingSchema>;

export const FloorSchema = z
  .object({
    areaM2: z.number().nonnegative().optional(),
    drawings: z.array(DrawingSchema),
    elevationMm: mmIntegerSchema,
    heightMm: positiveMmIntegerSchema,
    // FE3D-FIX-003 R1: chỉ đọc; tuỳ chọn tới khi BE (B3) luôn phát `floors.hidden_in_3d`.
    hiddenIn3d: z.boolean().optional(),
    id: idSchema,
    // K-31 (HS-03): BE chỉ gửi `true` khi dòng được đánh dấu mặt cắt, vắng khi không — không có `false`.
    isSection: z.literal(true).optional(),
    name: z.string().min(1),
    order: z.number().int(),
  })
  .strict()
  .transform((wireFloor) => ({
    ...(wireFloor.areaM2 !== undefined ? { areaM2: wireFloor.areaM2 } : {}),
    drawings: wireFloor.drawings,
    elevationMm: wireFloor.elevationMm,
    heightMm: wireFloor.heightMm,
    ...(wireFloor.hiddenIn3d !== undefined ? { hiddenIn3d: wireFloor.hiddenIn3d } : {}),
    id: wireFloor.id,
    ...(wireFloor.isSection === true ? { isSection: true as const } : {}),
    name: wireFloor.name,
    order: wireFloor.order,
  }));

export type Floor = z.infer<typeof FloorSchema>;
export type FloorWire = z.input<typeof FloorSchema>;

export const ProgressSchema = z
  .object({
    endedAt: isoDateTimeSchema.optional(),
    // BE gửi `error_code or ""` (apps/api/drawings/progress.py): `""` là "không mã", không phải gói hỏng —
    // loại cả lượt đọc thì lượt hỏng không bao giờ tới màn lỗi (BUG-549).
    error: z.string().optional(),
    id: idSchema,
    progressPercent: z.number().int().min(0).max(100),
    // Số lượt xử lý đang chờ trước lượt này; BE cũ không gửi, `null` là chưa biết.
    queueAhead: z.number().int().min(0).nullable().optional(),
    startedAt: isoDateTimeSchema.optional(),
    status: wireProgressStatusSchema,
    step: z.string().min(1),
  })
  .strict()
  .transform((wireProgress) => ({
    ...(wireProgress.endedAt !== undefined ? { endedAt: wireProgress.endedAt } : {}),
    ...(wireProgress.error !== undefined && wireProgress.error !== '' ? { error: wireProgress.error } : {}),
    id: wireProgress.id,
    progressPercent: wireProgress.progressPercent,
    ...(typeof wireProgress.queueAhead === 'number' ? { queueAhead: wireProgress.queueAhead } : {}),
    ...(wireProgress.startedAt !== undefined ? { startedAt: wireProgress.startedAt } : {}),
    status: progressStatusByWire[wireProgress.status],
    step: wireProgress.step,
  }));

export type Progress = z.infer<typeof ProgressSchema>;
export type ProgressWire = z.input<typeof ProgressSchema>;
export type ProgressStatus = Progress['status'];

export const VersionSchema = z
  .object({
    createdAt: isoDateTimeSchema,
    creatorId: idSchema,
    id: idSchema,
    note: z.string().min(1).optional(),
    projectId: idSchema,
    sequence: z.number().int().positive(),
  })
  .strict()
  .transform((wireVersion) => ({
    createdAt: wireVersion.createdAt,
    creatorId: wireVersion.creatorId,
    id: wireVersion.id,
    ...(wireVersion.note !== undefined ? { note: wireVersion.note } : {}),
    projectId: wireVersion.projectId,
    sequence: wireVersion.sequence,
  }));

export type Version = z.infer<typeof VersionSchema>;
export type VersionWire = z.input<typeof VersionSchema>;

export const ProjectSchema = z
  .object({
    address: z.string().min(1).optional(),
    code: z.string().min(1).optional(),
    createdAt: isoDateTimeSchema,
    currentVersion: VersionSchema.optional(),
    floors: z.array(FloorSchema),
    id: idSchema,
    members: z.array(UserSchema),
    name: z.string().min(1),
    ownerId: idSchema.optional(),
    progress: ProgressSchema.optional(),
    status: wireProjectStatusSchema,
    updatedAt: isoDateTimeSchema,
  })
  .strict()
  .transform((wireProject) => ({
    ...(wireProject.address !== undefined ? { address: wireProject.address } : {}),
    ...(wireProject.code !== undefined ? { code: wireProject.code } : {}),
    createdAt: wireProject.createdAt,
    ...(wireProject.currentVersion !== undefined ? { currentVersion: wireProject.currentVersion } : {}),
    floors: wireProject.floors,
    id: wireProject.id,
    members: wireProject.members,
    name: wireProject.name,
    ...(wireProject.ownerId !== undefined ? { ownerId: wireProject.ownerId } : {}),
    ...(wireProject.progress !== undefined ? { progress: wireProject.progress } : {}),
    status: projectStatusByWire[wireProject.status],
    updatedAt: wireProject.updatedAt,
  }));

export type Project = z.infer<typeof ProjectSchema>;
export type ProjectWire = z.input<typeof ProjectSchema>;
export type ProjectStatus = Project['status'];

/* -------------------------------------------------------------------------- */
/* Chất lượng ảnh đầu vào.                                                     */
/* -------------------------------------------------------------------------- */

/**
 * Nhóm schema T-04, ở file riêng vì nó là nhóm duy nhất mượn một kiểu của
 * `src/domain` — xem đầu `./quality.ts`. Nối lại qua đây để `./contracts.ts`
 * và `./client.ts` vẫn chỉ biết đúng một cửa vào cho mọi schema.
 */
export * from './quality';

/**
 * Nhom schema thu vien model — D-01/D-02/D-03. Cung ly do tach file voi
 * `./quality.ts`: no muon `FurnitureKind` cua `src/domain`. Noi lai qua day de
 * `./contracts.ts` va `./client.ts` van chi biet dung mot cua vao.
 */
export * from './library';

/**
 * Nhóm schema quản trị người dùng — T-04. Cùng lý do tách file với
 * `./quality.ts` và `./library.ts`: nó mượn `ProjectRole` của `src/types`, và
 * ranh giới ấy đáng nhìn thấy ở đầu một file. Nối lại qua đây để
 * `./contracts.ts` và `./client.ts` vẫn chỉ biết đúng một cửa vào.
 */
export * from './users';

/**
 * Nhóm schema trung tâm thông báo — T-09. Tách file cùng lý do với ba nhóm
 * trên: nó giữ hai bảng của hợp đồng dây — `NOTIFICATION_KINDS` và
 * `NOTIFICATION_PLACES` — và ranh giới ấy đáng nhìn thấy ở đầu một file thay
 * vì lẫn vào `index.ts`.
 *
 * Hai bảng ấy nằm ở ĐÂY chứ không ở màn, và màn nhập lại từ đây: mục 0.4 cấm
 * `src/api` nhập ngược từ `src/screens`, nên tầng dưới phải là tầng giữ. Trước
 * lượt nối dây, `NOTIFICATION_KINDS` có hai bản — một ở đây, một ở
 * `screens/system/NotificationCenter/notificationModel.ts` — và bản của màn đã
 * bị gỡ; R-71 không cho một quyết định có hai nguồn.
 */
export * from './notifications';

/**
 * Nhóm schema lớp không gian một tầng — tường, ô mở, phòng, đồ đạc. Tách file
 * cùng lý do với bốn nhóm trên: nó mượn kiểu của `src/domain`, và ranh giới ấy
 * đáng nhìn thấy ở đầu một file.
 *
 * Đây là nhóm duy nhất kiểm dữ liệu do **mô hình AI** sinh ra, nên khối chú
 * thích của nó nói kỹ hơn về chỗ nó dừng lại và chỗ `domain/spatial/integrity.ts`
 * tiếp tục.
 */
export * from './spatial';
