/**
 * Chữ ký đầu vào của `repairScene` trong một phiên sửa cảnh (`sessionRepairs`, `sceneRepair.ts`).
 *
 * L7-07: chữ ký cũ là `JSON.stringify` thô, nên mỗi lượt thả chạy luật HAI lần trên cùng hình học — lượt sửa vào kho,
 * rồi bản máy chủ trả về sau PUT: khoá xếp thứ tự khác (đi qua schema) và `clearAreaM2` được tính lại. Chữ ký này không
 * phụ thuộc thứ tự khoá và bỏ các trường luật sửa cảnh không đọc (`KEY_IGNORED`). Trường mới mà luật ĐỌC thì không được
 * thêm vào đây — bỏ nhầm là chip/cảnh hiện kết quả cũ.
 */
import type { Furniture, SpatialGraph } from '@/domain/spatial/types';

/** `clearAreaM2`: diện tích thông thủy máy chủ tính từ đường bao + tường; cầu nối không gửi đi, lượt về mang số mới. */
const KEY_IGNORED: ReadonlySet<string> = new Set(['clearAreaM2']);

const canonicalField = (_key: string, value: unknown): unknown => {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return value;
  const record = value as Record<string, unknown>;
  const out: Record<string, unknown> = {};
  for (const key of Object.keys(record).sort()) if (!KEY_IGNORED.has(key)) out[key] = record[key];
  return out;
};

export const repairKeyOf = (stored: SpatialGraph, furniture: readonly Furniture[]): string =>
  JSON.stringify([stored.walls, stored.openings, stored.rooms, furniture], canonicalField);
