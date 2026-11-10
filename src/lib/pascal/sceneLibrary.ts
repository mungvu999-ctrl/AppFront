import type { LibraryApi } from '@/api/client';

import {
  BUNDLED_LIBRARY_VERSION,
  LIBRARY_FALLBACK_NOTICE,
  libraryReadFailed,
  loadServerLibrary,
  type LibraryLoad,
} from './serverLibrary';

/**
 * Điểm vào CHUNG của thư viện mẫu/vật liệu cho mọi viewer (editor `/3d/pascal`, lịch sử phiên bản, viewer di động).
 * Một lượt đọc mỗi phiên trang (promise dùng chung, không đua đồng hồ): mọi viewer dựng cảnh trên CÙNG danh mục,
 * cùng `version`, cùng fallback. `notice` = câu báo tiếng Việt khi lượt đọc hỏng (5xx/mạng/hết giờ); 403/404/trống
 * là dự phòng im lặng (`serverLibrary.ts`).
 */
export interface SceneLibrary extends LibraryLoad {
  readonly notice: string | null;
}

/** Trả client thư viện khi có phiên, `null` khi chưa có phiên. */
export type LibraryApiSource = () => Promise<Pick<LibraryApi, 'list'> | null>;

const defaultApi: LibraryApiSource = async () => {
  const [{ createAppApiClient }, { startAppSession }] = await Promise.all([
    import('@/api/appClient'),
    import('@/routes/sessionSetup'),
  ]);
  // Token chỉ ở bộ nhớ: gọi trước khi mở phiên là 401 (e2e fullstack bước 11). `startAppSession` nhớ lượt đang chạy.
  return (await startAppSession()) ? createAppApiClient().library : null;
};

const withNotice = (load: LibraryLoad): SceneLibrary => ({
  ...load,
  notice: libraryReadFailed(load.source) ? LIBRARY_FALLBACK_NOTICE : null,
});

let shared: Promise<SceneLibrary> | null = null;
let settled: SceneLibrary | null = null;

/**
 * Nạp thư viện máy chủ một lần cho cả phiên trang; lượt gọi sau (viewer khác, đổi dự án) nhận lại đúng promise ấy.
 * Không bao giờ ném. Hỏng thì giữ dự phòng tới khi tải lại trang — khớp câu báo "Tải lại trang để thử lại".
 */
export function ensureSceneLibrary(getApi: LibraryApiSource = defaultApi): Promise<SceneLibrary> {
  shared ??= getApi()
    .then((api) =>
      api === null
        ? { count: 0, source: 'fallback:no-session' as const, version: BUNDLED_LIBRARY_VERSION }
        : loadServerLibrary(api),
    )
    .catch((): LibraryLoad => ({ count: 0, source: 'fallback:threw', version: BUNDLED_LIBRARY_VERSION }))
    .then((load) => (settled = withNotice(load)));
  return shared;
}

/** Thư viện đã chốt của phiên (đầu dò, chẩn đoán); `null` khi lượt đọc chưa xong. */
export const sceneLibraryNow = (): SceneLibrary | null => settled;

/** Chỉ cho test: quên lượt đọc của phiên. */
export const resetSceneLibraryForTests = (): void => {
  shared = null;
  settled = null;
};
