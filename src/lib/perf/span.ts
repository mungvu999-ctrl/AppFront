/**
 * Mốc đo `?perf` cho tầng thuần (`src/lib/**`), không nhập gói Pascal (cổng nhập) và không nhập React.
 *
 * Cùng đường ra với `timeSpan` của gói viewer: một `performance.measure` mỗi lượt, nên bộ đo ngoài
 * (`docs/editor-3d-performance-ux-audit/impl-tools`) và Performance của DevTools đọc được như nhau.
 * Không có `?perf` thì chỉ tốn một phép kiểm boolean.
 */
const ON = typeof window !== 'undefined' && new URLSearchParams(window.location.search).has('perf');

export const span = <T>(name: string, fn: () => T): T => {
  if (!ON) return fn();
  const start = performance.now();
  try {
    return fn();
  } finally {
    try {
      performance.measure(name, { start, end: performance.now() });
    } catch {
      // Trình duyệt cũ từ chối dạng tham số này — bỏ qua, không ảnh hưởng kết quả.
    }
  }
};
