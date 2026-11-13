/**
 * AppFront (04/11): menu chuột phải của vật trong trình dựng. Bấm phải không kéo mở menu; kéo vẫn xoay (3D, 2D).
 * `NodeActionMenu` (thanh nổi) là nguồn thao tác duy nhất: nó công bố các nút đang có qua đây, menu chỉ hiện lại
 * đúng các nút ấy, nên không có hành động mới và menu tự theo luật của từng loại vật.
 */
import { useEffect, type MouseEventHandler } from 'react';

/** Dưới ngưỡng này (px) coi là bấm tại chỗ. */
export const CLICK_SLOP_PX = 4;

export interface ScreenPoint {
  readonly x: number;
  readonly y: number;
}

/** Bấm hay kéo: `down` là lúc nhấn nút phải (null nếu không nhấn trong trang), `up` là lúc nhả. */
export function isPlainClick(down: ScreenPoint | null, up: ScreenPoint, slop: number = CLICK_SLOP_PX): boolean {
  return down !== null && Math.hypot(up.x - down.x, up.y - down.y) < slop;
}

type Action = MouseEventHandler<HTMLButtonElement> | undefined;

export interface NodeActions {
  readonly onFind?: Action;
  readonly onMove?: Action;
  readonly onEditMesh?: Action;
  readonly onGroup?: Action;
  readonly onUngroup?: Action;
  readonly onCurve?: Action;
  readonly onDuplicate?: Action;
  readonly onAddHole?: Action;
  readonly onDelete?: Action;
}

let current: NodeActions | null = null;
const listeners = new Set<() => void>();

function publish(next: NodeActions | null): void {
  current = next;
  for (const listener of listeners) listener();
}

export const getNodeActions = (): NodeActions | null => current;

export function subscribeNodeActions(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/** Gọi trong `NodeActionMenu` (luật `scripts/realism/u47-node-context-menu.mjs`): thanh nổi đang hiện cấp thao tác cho menu. */
export function usePublishNodeActions(actions: NodeActions): void {
  useEffect(() => {
    publish(actions);
    return () => {
      if (current === actions) publish(null);
    };
  });
}

/**
 * Chạy một mục menu chuột phải (M18 LE). Cú chuột phải mở menu cũng là `controlstart` của camera-controls (nút phải = xoay)
 * → `useViewer.cameraDragging = true`; nhả chuột không xoay thì `onControlEnd` bỏ qua khi camera chưa "nghỉ"
 * (`custom-camera-controls.tsx` onControlEnd) nên cờ kẹt `true`, và `use-grid-events.ts` bỏ mọi `grid:click` khi cờ bật —
 * "Di chuyển" bám chuột nhưng cú bấm đặt bị nuốt. Menu đã mở nghĩa là cú chuột phải KHÔNG phải kéo camera: hạ cờ trước khi chạy.
 */
export function runMenuAction(run: () => void, viewer: { setCameraDragging?: (dragging: boolean) => void }): void {
  viewer.setCameraDragging?.(false);
  run();
}
