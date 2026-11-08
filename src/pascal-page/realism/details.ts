/**
 * GĐ6 (thẻ R6): chi tiết hình khối bật sẵn cho node MỚI do công cụ vẽ tạo ra.
 *
 * Cách phân biệt node mới/cũ: theo ĐƯỜNG TẠO, không theo dữ liệu. Các hàm dưới
 * chỉ được gọi ở chỗ công cụ vẽ dựng node (luật `scripts/realism/r6-details.mjs`
 * chèn vào roof/tool.tsx, wall-drafting.ts, rectangle-command.ts), và được trải
 * TRƯỚC `...defaults` của công cụ nên preset người dùng chọn vẫn thắng.
 * Schema `core` không đổi, nên dự án cũ nạp lại (node thiếu trường) giữ nguyên.
 *
 * Không nhập store: `main.tsx` (thẻ R1) gọi `setDetailsEnabled(flags.details)`.
 */

import { SKIRTING_MM } from '@/lib/suggestions/ruleset'

let enabled = false

export function setDetailsEnabled(value: boolean): void {
  enabled = value
}

export function isDetailsEnabled(): boolean {
  return enabled
}

/** Mặc định cho roof-segment mới: ván diềm (fascia) + máng xối tự động. */
export function realismRoofSegmentDefaults(): Record<string, unknown> {
  if (!enabled) return {}
  return { fascia: true, metadata: { autoGutter: true } }
}

/** Phào chân ngoài tường (thay bệ chân nhà) cho tường mới vẽ. */
export const EXTERIOR_SKIRTING = {
  enabled: true,
  sides: 'exterior',
  height: 0.25,
  proud: 0.02,
  profile: 'flat',
} as const

/**
 * Len chân trong nhà (mọi phong cách cùng cỡ). `wallDressingOf` (src/lib/pascal/sceneDressing.ts)
 * dùng chung hằng này để tường vẽ mới và tường dựng lúc nạp không lệch nhau. Cỡ lấy từ bảng luật R1
 * của lớp đề xuất (M2, G1: 90 × 12 mm như compiler), không còn 100 × 15 viết tay.
 */
export const INTERIOR_SKIRTING = {
  enabled: true,
  sides: 'interior',
  height: SKIRTING_MM.height / 1000,
  proud: SKIRTING_MM.thickness / 1000,
  profile: 'flat',
} as const

/**
 * Mặc định cho tường mới: len trong nhà + phào ngoài (`skirting.exterior`, luật r9u), giống
 * `exteriorSkirtingOf` (toPascal.ts) dựng cho tường bao lúc nạp.
 * Vách mới giữa hai phòng: Pascal để frontSide/backSide 'unknown' (cả hai mặt trong), nên luật
 * r9v-partition-skirt.mjs (space detection, chạy sau mỗi lần tường/phòng đổi) bỏ `exterior` và để
 * `sides: 'interior'` cho tường có hai mặt trong phòng, khớp `exteriorSkirtingOf` lúc nạp.
 */
export function realismWallDefaults(): Record<string, unknown> {
  if (!enabled) return {}
  const { height, proud, profile } = EXTERIOR_SKIRTING
  return { skirting: { ...INTERIOR_SKIRTING, sides: 'both', exterior: { height, proud, profile } } }
}
