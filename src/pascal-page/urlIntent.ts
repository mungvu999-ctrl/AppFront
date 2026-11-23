/**
 * Ý định mở trang 3D từ đường dẫn cũ: `/3d/exploded` và `/3d/measure` chuyển tiếp sang
 * `editor3d.html?view=exploded` / `?tool=measure` (`src/routes/viewerRedirects.tsx`). Trang Pascal
 * áp ý định ấy MỘT lần, khi cảnh của dự án đã có tường (cảnh mặc định của editor chưa có), để lượt
 * nạp cảnh không xoá mất nó. Không có tham số thì không làm gì.
 *
 * K-22: `?panel=export` là lối từ thẻ GLB của màn Xuất — mở tab Cài đặt và xuất GLB đầy đủ bằng bộ
 * xuất của editor (thân ở `./exportFullGlb`). K-23: `?panel=snapshot` (Ảnh) và `?panel=settings` (OBJ) là
 * lối từ thẻ Ảnh/OBJ của màn Xuất — không xuất hộ, chỉ đưa tới đúng nút và nói bấm gì.
 */
type SceneNodes = Readonly<Record<string, { readonly type?: string } | undefined>>;

export interface UrlIntentStores {
  readonly scene: {
    getState(): { readonly nodes: SceneNodes };
    subscribe(listener: () => void): () => void;
  };
  readonly explodeLevels: () => void;
  readonly startMeasure: () => void;
  /** `?panel=export`: mở tab Cài đặt rồi xuất GLB đầy đủ khi cảnh sẵn sàng. */
  readonly openExport: () => void;
  /** `?panel=settings`: mở tab Cài đặt (nơi có nút Xuất OBJ). */
  readonly openSettings: () => void;
  /** Câu báo lên toast của cầu (UX audit #29). */
  readonly notify?: (message: string) => void;
}

export const NEED_TWO_LEVELS = 'Cần ít nhất 2 tầng để xem tách tầng';
export const SNAPSHOT_HINT = 'Chỉnh góc nhìn rồi bấm "Ảnh" trên thanh công cụ để tải ảnh PNG.';
export const SETTINGS_HINT = 'Bấm "Xuất OBJ" trong tab Cài đặt. OBJ chỉ có hình khối, không có vật liệu.';

export function applyUrlIntent(search: string, stores: UrlIntentStores): () => void {
  const query = new URLSearchParams(search);
  const exploded = query.get('view') === 'exploded';
  const measure = query.get('tool') === 'measure';
  const panel = query.get('panel');
  const exportPanel = panel === 'export';
  const snapshot = panel === 'snapshot';
  const settings = panel === 'settings';
  if (!exploded && !measure && !exportPanel && !snapshot && !settings) return () => {};

  let done = false;
  let unsubscribe: () => void = () => {};
  const apply = () => {
    if (done) return;
    if (!Object.values(stores.scene.getState().nodes).some((node) => node?.type === 'wall')) return;
    done = true;
    unsubscribe();
    if (exploded) {
      const levels = Object.values(stores.scene.getState().nodes).filter((node) => node?.type === 'level').length;
      if (levels < 2) stores.notify?.(NEED_TWO_LEVELS);
      stores.explodeLevels();
    }
    if (measure) stores.startMeasure();
    if (exportPanel) stores.openExport();
    if (snapshot) stores.notify?.(SNAPSHOT_HINT);
    if (settings) {
      stores.openSettings();
      stores.notify?.(SETTINGS_HINT);
    }
  };
  unsubscribe = stores.scene.subscribe(apply);
  apply();
  return () => {
    done = true;
    unsubscribe();
  };
}
