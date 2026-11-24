/**
 * L7-04: hàng dựng BVH nền (vendor `lazy-bvh-raycast.ts`, đọc cờ toàn cục `__pascalBvhHold`) đợi hết lần nạp
 * đầu (`warm.ts` `beginFirstLoad`/`endFirstLoad`). Nó chạy trong `requestIdleCallback` đúng lúc các bản dựng
 * shader W2 còn chờ và tranh luồng chính (đo 24/11: 0,6–0,85 s CPU trong lúc nhãn nạp, mỗi cây ≤ 131 ms).
 * Tia chuột trong lúc giữ vẫn trả hit thật (dò từng tam giác hoặc dựng cây ngay tại tia, như cũ). Nhả khi nhãn
 * gỡ hoặc tới mốc `untilMs` (renderer gỡ giữa chừng không gọi `endFirstLoad`). `?disable=bvhhold` tắt để so.
 */
const OFF = typeof location !== 'undefined' && (new URLSearchParams(location.search).get('disable') ?? '').split(',').includes('bvhhold');
let release: ReturnType<typeof setTimeout> | undefined;

export function holdBvh(on: boolean, untilMs = 0): void {
  if (OFF) return;
  (globalThis as { __pascalBvhHold?: boolean }).__pascalBvhHold = on;
  clearTimeout(release);
  release = on ? setTimeout(() => holdBvh(false), Math.max(0, untilMs - performance.now())) : undefined;
}
