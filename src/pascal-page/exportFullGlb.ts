/**
 * K-22: xuất GLB ĐẦY ĐỦ của cảnh đang xem (vật liệu, đồ thật/AI) bằng bộ xuất của editor
 * (`useEditor.modelExport('glb')`, cùng đường nướng ánh sáng dùng), rồi tải về. Màn Xuất của
 * SPA chính chỉ có bản rút gọn trong worker (không vật liệu, đồ là hộp) nên dẫn sang đây qua
 * `?panel=export` (`./urlIntent`).
 *
 * Chờ cảnh dựng xong (hai lượt kiểm liên tiếp đều sẵn sàng) để tệp không thiếu node đang dựng;
 * quá hạn thì dừng, báo bằng câu tiếng Việt, và tab Cài đặt đã mở sẵn để người dùng bấm tay.
 */
export const EXPORT_READY_POLL_MS = 400;
export const EXPORT_READY_TIMEOUT_MS = 90_000;

export const EXPORT_PREPARING = 'Đang chuẩn bị tệp GLB đầy đủ…';
export const EXPORT_DONE = 'Đã xuất GLB đầy đủ. Tệp nằm trong thư mục tải về của trình duyệt.';
export const EXPORT_TIMEOUT = 'Cảnh chưa dựng xong nên chưa tự xuất được. Hãy bấm GLB trong Cài đặt khi cảnh đã hiện đủ.';
export const EXPORT_FAILED = 'Không xuất được GLB đầy đủ. Hãy thử lại trong Cài đặt, hoặc dùng bản rút gọn ở màn Xuất.';

export interface FullGlbDeps {
  /** Bộ xuất của editor đã gắn, cảnh có tường, mọi đồ đã tải xong hoặc hỏng hẳn. */
  readonly isReady: () => boolean;
  /** Gọi `modelExport('glb')` (tải về); trả `null` khi bộ xuất không ra tệp. */
  readonly exportGlb: () => Promise<unknown>;
  /** Mở tab Cài đặt của editor. */
  readonly openSettings: () => void;
  readonly notify: (message: string) => void;
}

/** Trả hàm huỷ (đóng trang / gọi lại). Gọi huỷ sau khi xuất đã bắt đầu thì không dừng được bộ xuất. */
export function runFullGlbExport(deps: FullGlbDeps): () => void {
  deps.openSettings();
  deps.notify(EXPORT_PREPARING);
  let stableChecks = 0;
  let waited = 0;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let cancelled = false;

  const start = () => {
    deps
      .exportGlb()
      .then((artifact) => deps.notify(artifact ? EXPORT_DONE : EXPORT_FAILED))
      .catch(() => deps.notify(EXPORT_FAILED));
  };
  const tick = () => {
    if (cancelled) return;
    stableChecks = deps.isReady() ? stableChecks + 1 : 0;
    if (stableChecks >= 2) return start();
    waited += EXPORT_READY_POLL_MS;
    if (waited >= EXPORT_READY_TIMEOUT_MS) return deps.notify(EXPORT_TIMEOUT);
    timer = setTimeout(tick, EXPORT_READY_POLL_MS);
  };
  tick();
  return () => {
    cancelled = true;
    if (timer !== undefined) clearTimeout(timer);
  };
}
