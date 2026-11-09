/**
 * Bản nạp trễ của {@link NotificationHost} cho `src/main.tsx`: host chỉ vẽ những gì `notificationBus`
 * đang giữ, nên thông báo phát trước khi chunk về không mất — hiện khi host gắn. Tách để `Toast`,
 * `offlineNotice` và host ra khỏi chunk màn hình đầu tiên (đã chạm cổng 175 KiB, 09/11/2026).
 * Để ở tệp riêng vì luật `react-refresh/only-export-components` không cho `lazy()` nằm trong `main.tsx`.
 */
import { lazy } from 'react';

export const NotificationHostLazy = lazy(() =>
  import('./NotificationHost').then((module) => ({ default: module.NotificationHost })),
);
