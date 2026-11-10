import { wallStrokeToken } from '@/components/canvas/materialMap';

import type { ThicknessGroup } from './thicknessTypes';

/** Bậc dày hơn trong mỗi cặp token chung (150, 220, 400) — đậm hơn bậc mỏng một nấc. */
const DEEPER_STEPS: ReadonlySet<ThicknessGroup> = new Set([150, 220, 400]);

/**
 * Màu một nhóm độ dày: sáu bậc sáu màu. `wallStrokeToken` chỉ có ba token (100/150, 200/220, 300/400
 * dùng chung), nên bậc dày hơn của mỗi cặp pha thêm chữ-chính để đậm hơn, vẫn từ token.
 */
export function thicknessGroupToken(group: ThicknessGroup): string {
  const base = wallStrokeToken(group);
  return DEEPER_STEPS.has(group) ? `color-mix(in srgb, ${base} 70%, var(--text-primary))` : base;
}
