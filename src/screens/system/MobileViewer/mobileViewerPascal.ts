/**
 * Cảnh của màn di động: mount Pascal `view` (F-15 S15).
 *
 * Camera một/hai ngón, chọn và đo hai điểm đều do Pascal lo; file này chỉ nối
 * `MobileViewerSceneOptions` vào gói `pascal-mount.js` qua đúng cửa nạp mà
 * `/3d/pascal` dùng, nên không nhập `three` hay `@pascal-app/*`.
 */

import { defaultLoadMount, type MountModule } from '@/screens/viewer/PascalViewer/usePascalViewer';

import type { MobileViewerSceneMount, MobileViewerSceneOptions } from './mobileViewerTypes';

/** Phần mở rộng của `mount` mà `MountModule` của màn Pascal chưa khai (S1, S2, S3). */
type ViewMount = (
  element: HTMLElement,
  options: Parameters<MountModule['mount']>[1] & {
    readonly cameraControls: boolean;
    readonly lite: boolean;
    readonly measure: boolean;
    readonly onPick: (nodeId: string | null) => void;
    readonly onMeasure: (result: { readonly distanceM: number }) => void;
  },
) => { readonly dispose: () => void };

export function mountMobileViewerPascal(
  element: HTMLElement,
  options: MobileViewerSceneOptions,
): MobileViewerSceneMount {
  let disposed = false;
  let handle: { readonly dispose: () => void } | null = null;

  Promise.all([defaultLoadMount(), import('@/lib/pascal/sceneStandard')])
    .then(([module, { standardSceneOf }]) => {
      if (disposed) {
        return;
      }

      handle = (module.mount as ViewMount)(element, {
        scene: standardSceneOf(options.graph).scene,
        mode: 'view',
        readOnly: true,
        cameraControls: true,
        lite: true,
        measure: options.measure,
        onPick: options.onPick,
        onMeasure: ({ distanceM }) => options.onMeasure(distanceM),
        onReadyChange: (ready) => {
          if (ready && !disposed) {
            options.onReady();
          }
        },
        onFatal: () => {
          if (!disposed) {
            options.onFailure('deviceTooWeak');
          }
        },
        onRendererUnavailable: () => {
          if (!disposed) {
            options.onFailure('webglUnavailable');
          }
        },
      });
    })
    .catch(() => {
      if (!disposed) {
        options.onFailure('deviceTooWeak');
      }
    });

  return {
    ok: true,
    handle: {
      dispose: () => {
        disposed = true;
        handle?.dispose();
      },
    },
  };
}
