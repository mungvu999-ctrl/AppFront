/**
 * Backend thật của renderer (WebGPU hay WebGL2 dự phòng), thay phép thử `'gpu' in navigator`:
 * trình duyệt có `navigator.gpu` vẫn có thể rơi về WebGL2 khi không lấy được adapter/device.
 * Vendor gọi qua alias `@pascal-realism/backend` (luật `scripts/realism/r1-backend.mjs`).
 */
import { useRealism, type RealismBackend } from './store';
import { emitRealism } from './telemetry';

/** Đọc từ renderer three (`WebGPURenderer.backend.isWebGPUBackend`); chưa có backend → `unknown`. */
export function backendOf(renderer: unknown): RealismBackend {
  const backend = (renderer as { backend?: { isWebGPUBackend?: boolean } } | null | undefined)?.backend;
  if (!backend) return 'unknown';
  return backend.isWebGPUBackend === true ? 'webgpu' : 'webgl';
}

/** Cho post-processing vendor: chỉ dựng chuỗi TSL khi backend THẬT là WebGPU. */
export const isWebGpuBackend = (renderer: unknown): boolean => backendOf(renderer) === 'webgpu';

/** Renderer hiện hành (đầu dò `setLook` cần đặt `toneMappingExposure` thẳng — vendor chỉ áp khi đổi chủ đề). */
export let currentRenderer: unknown;

/** Ghi backend vào store sau khi renderer init; gửi `viewer.backend` một lần mỗi lần đổi. */
export function reportBackend(renderer: unknown): RealismBackend {
  currentRenderer = renderer;
  const backend = backendOf(renderer);
  if (backend === 'unknown' || useRealism.getState().backend === backend) return backend;
  useRealism.setState({ backend });
  emitRealism({ name: 'viewer.backend', backend });
  return backend;
}

/** Vendor `GPUDeviceWatcher` gọi khi `device.lost` (GĐ3 mới tự dựng lại). */
export function reportDeviceLost(info: { reason?: string | null } | undefined): void {
  emitRealism({ name: 'viewer.device_lost', reason: info?.reason === 'destroyed' ? 'destroyed' : 'unknown' });
}
