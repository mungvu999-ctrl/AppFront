import { BRIDGE_LOAD_ERROR, BRIDGE_SESSION_ERROR, loginHrefOf } from './bridge';

const BUTTON_CLASS = 'mt-4 inline-block rounded-md border border-border bg-accent px-3 py-2 font-medium';

/** Ngoại tuyến thì câu "tải lại trang" chung chung không giúp gì: nói rõ nguyên nhân và việc cần làm. */
const OFFLINE_LOAD_ERROR = 'Đang ngoại tuyến nên chưa mở được mô hình 3D. Kết nối lại rồi bấm Thử lại.';

/** Chỉ lỗi tải chung (mạng, máy chủ) mới đáng thử lại; hết phiên/không thấy/rỗng thì thử lại cũng vô ích. */
function canRetryLoad(error: string | null | undefined): boolean {
  return error == null || error === BRIDGE_LOAD_ERROR;
}

interface LoadErrorBodyProps {
  readonly error?: string | null;
  readonly projectId: string;
  readonly backHref: string;
  readonly online?: boolean;
  readonly onRetry?: () => void;
}

/** Nội dung màn lỗi tải mô hình 3D: lý do + (đăng nhập lại | thử lại) + về dự án. */
export function LoadErrorBody({ error, projectId, backHref, online = true, onRetry = () => window.location.reload() }: LoadErrorBodyProps) {
  const retry = canRetryLoad(error);
  const message = !online && retry ? OFFLINE_LOAD_ERROR : (error ?? 'Không mở được mô hình 3D.');
  return (
    <>
      <p className="text-muted-foreground">{message}</p>
      {/* L3a-01: phiên hết thì có lối đăng nhập lại, xong quay về đúng mô hình 3D này. */}
      {error === BRIDGE_SESSION_ERROR ? (
        <a className={`${BUTTON_CLASS} mr-2`} href={loginHrefOf(projectId)}>
          Đăng nhập lại
        </a>
      ) : null}
      {retry ? (
        <button type="button" className={`${BUTTON_CLASS} mr-2`} onClick={onRetry}>
          Thử lại
        </button>
      ) : null}
      <a className={BUTTON_CLASS} href={backHref}>
        Về dự án
      </a>
    </>
  );
}
