/**
 * Chấm màu (tương phản quanh xám 18 %, bão hoà) dưới dạng uniform TSL để đổi lúc chạy
 * (`__pascalProbe.setLook({ grade })`) thay vì tải lại trang theo từng `?look=`.
 * Luật `r12-look-override.mjs` nối `GRADE_U` vào chuỗi hậu kỳ của vendor; mặc định = `DEFAULT_LOOK` (+ `?look=`).
 */
import { uniform } from 'three/tsl';

import { DEFAULT_LOOK, withLookOverride } from './lookOverride';

const L = withLookOverride(DEFAULT_LOOK);
export const GRADE_U = { contrast: uniform(L.contrast), saturation: uniform(L.saturation) };

export function setGrade(v: { contrast?: number; saturation?: number }): void {
  if (v.contrast !== undefined && v.contrast > 0) GRADE_U.contrast.value = v.contrast;
  if (v.saturation !== undefined && v.saturation >= 0) GRADE_U.saturation.value = v.saturation;
}
