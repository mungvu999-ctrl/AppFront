import React, { Suspense } from 'react';
import ReactDOM from 'react-dom/client';
import { RouterProvider } from 'react-router-dom';
import { QueryClientProvider } from '@tanstack/react-query';

import { MotionProvider } from './components/motion';
import { ServerFeatureFlagSync } from './components/shell/ServerFeatureFlagSync';
import { ThemeSync } from './hooks/useTheme';
import { queryClient } from './lib/query/queryClient';
import { installFeatureFlagDevPanel } from './lib/telemetry/flags';
import { router } from './routes';
import { NotificationHostLazy as NotificationHost } from './components/feedback/NotificationHost.lazy';
import './styles/globals.css';

// `__featureFlags.list()` in the browser console — see
// `src/lib/telemetry/flags.ts`. Installed before render so a flag can be
// flipped and the page reloaded without touching any code.
//
// The guard is for the bundler, not for correctness: the function already
// refuses to install outside a development build, but Vite replaces
// `import.meta.env.DEV` with `false` here, so the panel and its help text are
// dropped from the production bundle rather than shipped switched off.
if (import.meta.env.DEV) {
  installFeatureFlagDevPanel();
}

/**
 * The application shell: navigation, data, motion — three things, one place.
 *
 * This file used to render `<App />` directly, which is the nine-screen demo
 * picker, while `src/routes.tsx` declared 28 routes that nothing ever mounted.
 * That meant the first real screen had no way to be reached, `useNavigate` had
 * no router to call, and `src/lib/query` had no provider to run under.
 *
 * The nesting order is deliberate:
 *
 * - `QueryClientProvider` outermost because it draws nothing — it holds the
 *   cache, and the cache has to outlive every route change.
 * - `MotionProvider` wraps the WHOLE shell rather than each screen: it sets
 *   `reducedMotion="user"` once for every framer-motion animation in the tree.
 *   Per-screen leaves room for a screen to forget (R-39).
 * - `RouterProvider` innermost, because it is the only part that changes with
 *   the URL.
 * - `NotificationHost` is a SIBLING of `RouterProvider`, not a parent and not a
 *   child, and that follows from the same three reasons rather than bending
 *   them. A notification outlives the route that published it — a run that
 *   finishes after the user has walked away still has to be able to say so — so
 *   it cannot live under the part that changes with the URL. It draws, so it
 *   belongs inside `MotionProvider` where `reducedMotion="user"` is already set
 *   once for the whole shell (R-39). It uses no router hook and no query, so
 *   standing outside `RouterProvider` costs it nothing.
 *
 *   Before this, `notificationBus` had every rule of a notification and full
 *   tests but no caller anywhere in `src`, and `Toast.tsx` was only ever mounted
 *   by `src/App.tsx` — the demo picker this file stopped rendering. On the real
 *   route tree there was no place for a notification to appear at all. There is
 *   now, and it is one line.
 *
 *   It is loaded lazily (09/11/2026): the host only draws what `notificationBus`
 *   already holds, so a notification published before its chunk arrives is not
 *   lost — it is shown on mount. This keeps `Toast`, `offlineNotice` and the
 *   host out of the first-screen chunk, which had hit the 175 KiB budget
 *   (`scripts/check-bundle-size.mjs`); the fallback is `null` because a toast
 *   that is not yet mounted should draw nothing, not a placeholder.
 *
 * The demo picker is not lost: it is the `/demo` route, and only in a
 * development build. `/` is the real dashboard route, `ProjectDashboardRoute`
 * (`src/screens/dashboard/ProjectDashboard/ProjectDashboard.container.tsx`).
 */
ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <QueryClientProvider client={queryClient}>
      <MotionProvider>
        <ServerFeatureFlagSync />
        <ThemeSync />
        <RouterProvider router={router} />
        <Suspense fallback={null}>
          <NotificationHost />
        </Suspense>
      </MotionProvider>
    </QueryClientProvider>
  </React.StrictMode>,
);
