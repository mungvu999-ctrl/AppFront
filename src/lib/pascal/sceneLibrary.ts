import type { LibraryApi } from '@/api/client';
import type { DesignAddition, DesignResult } from '@/api/schemas/designConcept';

import { getSessionSnapshot } from '@/lib/auth/state';
import { interceptPlatformFetch } from '@/lib/http/platform';

import {
  absoluteUrl,
  CATALOG_MODELS,
  clearServerLibrary,
  isServerModel,
  modelSrcOf,
  replaceServerLibrary,
  serverModelIdOfUrl,
} from './furnitureCatalog';

import {
  absenceOf,
  BUNDLED_LIBRARY_VERSION,
  LIBRARY_FALLBACK_NOTICE,
  libraryReadFailed,
  loadServerLibrary,
  STALE_SOURCE,
  type LibraryLoad,
} from './serverLibrary';
import type { PascalScene } from './types';

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
  // Token chỉ ở bộ nhớ: gọi trước khi mở phiên là 401 (e2e fullstack bước 11). `startAppSession` nhớ lượt khởi động —
  // kể cả `false` của lượt chưa đăng nhập — nên đăng nhập sau đó trong cùng thẻ chỉ thấy được qua trạng thái phiên thật.
  await startAppSession().catch(() => false);
  return getSessionSnapshot().status === 'authenticated' ? createAppApiClient().library : null;
};

const withNotice = (load: LibraryLoad): SceneLibrary => ({
  ...load,
  notice: libraryReadFailed(load.source) ? LIBRARY_FALLBACK_NOTICE : null,
});

let shared: Promise<SceneLibrary> | null = null;
let settled: SceneLibrary | null = null;
/** `shared` đang chạy (chưa chốt): lượt đọc lại theo tuổi dùng chung nó thay vì mỗi lời gọi tự phát request (Codex #2). */
let sharedPending = false;
/** Người dùng của lượt đọc đã chốt (`null` = chưa có phiên). */
let settledOwner: string | null = null;
/** Lúc lượt đọc chốt (ms) — URL ký MinIO hết hạn ~2 giờ. */
let settledAt = 0;
/** Tăng mỗi lần quên lượt đọc (đổi người/đổi phiên): lượt gia hạn bắt đầu ở thế hệ cũ bị bỏ. */
let generation = 0;
/**
 * MỘT thứ tự cho MỌI đường ghi danh mục (đọc theo tuổi `ensureSceneLibrary` + đọc lại theo mẫu `refreshLibrary`):
 * mỗi request lấy số khi BẮT ĐẦU; chỉ ghi khi số ≥ số đã ghi gần nhất → phản hồi cũ về muộn không ghi đè danh mục mới
 * hơn, không khôi phục mẫu đã gỡ (review Codex-2 #1).
 */
let writeSeq = 0;
let acceptedSeq = 0;
const nextWriteSeq = (): number => {
  writeSeq += 1;
  return writeSeq;
};
const acceptWrite = (seq: number): boolean => {
  if (seq < acceptedSeq) return false;
  acceptedSeq = seq;
  return true;
};

const currentOwner = (): string | null => getSessionSnapshot().user?.id ?? null;

/** Quên lượt đọc + gỡ mẫu máy chủ đã gộp (mẫu riêng, URL ký của người trước). */
const forget = (): void => {
  shared = null;
  sharedPending = false;
  settled = null;
  generation += 1;
  refreshing = null;
  assetAttempts.clear();
  sameUrlRetried.clear();
  inflight.clear();
  // Câu báo mẫu hỏng là của người/phiên trước: đổi người thì không còn treo.
  if (assetLog.failures.length > 0) {
    assetLog.failures.length = 0;
    notify();
  }
  clearServerLibrary();
};

/**
 * Nạp thư viện máy chủ một lần cho mỗi người dùng trong phiên trang; lượt gọi sau (viewer khác, đổi dự án) nhận lại
 * đúng promise ấy. Không bao giờ ném.
 * - Chưa có phiên (`fallback:no-session`) không được nhớ: đăng nhập trong cùng thẻ thì lượt sau đọc lại.
 * - Đổi người dùng (đăng xuất → người khác, phiên đã rõ) → quên kết quả cũ, gỡ mẫu máy chủ của người trước, đọc lại.
 * - Lỗi đọc (5xx/mạng/hết giờ) giữ dự phòng tới khi tải lại trang hoặc đổi người — mọi viewer trong thẻ cùng trạng thái
 *   ấy, khớp câu báo "Tải lại trang để thử lại" (editor là trang riêng nên tự đọc lượt của nó).
 */
export function ensureSceneLibrary(getApi: LibraryApiSource = defaultApi): Promise<SceneLibrary> {
  installAssetRefresh();
  const session = getSessionSnapshot();
  /** Thư viện máy chủ đã chốt nhưng URL quá tuổi: GIỮ nó (không gỡ `SERVER_FILES`) tới khi lượt đọc lại thành công. */
  let keep: SceneLibrary | null = null;
  if (settled !== null && session.status !== 'unknown' && currentOwner() !== settledOwner) forget();
  // URL ký đã quá tuổi: cảnh dựng mới (đổi dự án/phiên bản) lấy URL mới thay vì URL sắp/đã hết hạn.
  else if (!sharedPending && settled?.source === 'server' && Date.now() - settledAt > SIGNED_URL_MAX_AGE_MS) {
    keep = settled;
    shared = null;
  }
  if (shared !== null) return shared;
  /** Người của phiên mà lượt đọc này dùng (chốt sau khi có client — phiên có thể còn `unknown` lúc gọi). */
  let reqOwner: string | null = null;
  const seq = nextWriteSeq();
  const mine: Promise<SceneLibrary> = getApi()
    .then((api): Promise<LibraryLoad> | LibraryLoad => {
      reqOwner = currentOwner();
      return api === null
        ? { count: 0, source: 'fallback:no-session' as const, version: BUNDLED_LIBRARY_VERSION }
        : // Ghi danh mục chỉ khi lượt đọc này còn hiệu lực (chưa bị quên vì đổi người, chưa bị lượt mới thay): phản
          // hồi cũ về muộn không ghi đè URL mới / danh mục của người sau. Ghi = THAY cả thư viện (mẫu bị gỡ quyền rơi ra).
          // Thứ tự chung với lượt gia hạn theo mẫu (`acceptWrite`): phản hồi CŨ HƠN lượt đã ghi thì không ghi đè.
          loadServerLibrary(api, (items): number | null => {
            if (shared !== mine || currentOwner() !== reqOwner || !acceptWrite(seq)) return null;
            return replaceServerLibrary(items);
          });
    })
    .catch((): LibraryLoad => ({ count: 0, source: 'fallback:threw', version: BUNDLED_LIBRARY_VERSION }))
    .then((load) => {
      // Lượt đọc mất hiệu lực — đổi người/bị quên, hoặc thua một lượt ghi MỚI HƠN (gia hạn theo mẫu đã ghi danh mục mới
      // hơn): không ghi, không chốt nguồn/phiên bản/giờ, không đặt lại sổ thử lại (review Codex-3 N4). Cùng người thì
      // giữ kết quả đã chốt (danh mục đã mới hơn); đổi người thì lượt sau đọc lại.
      if (load.source === STALE_SOURCE || seq < acceptedSeq) {
        if (shared === mine) {
          sharedPending = false;
          shared = settled !== null && currentOwner() === settledOwner ? Promise.resolve(settled) : null;
        }
        return settled ?? withNotice({ count: 0, source: STALE_SOURCE, version: BUNDLED_LIBRARY_VERSION });
      }
      // Đọc lại vì quá tuổi mà hỏng: giữ thư viện cũ (URL cũ vẫn gia hạn được từng mẫu), lượt dựng sau thử lại.
      // Danh sách rỗng/403/404 là câu trả lời HỢP LỆ (không phải lỗi mạng): nhận nó và gỡ thư viện cũ.
      const result = keep !== null && libraryReadFailed(load.source) ? keep : withNotice(load);
      if (keep !== null && result !== keep && shared === mine) {
        if (load.source !== 'server' && acceptWrite(seq)) clearServerLibrary();
        // Lượt đọc mới thành công: trần lượt gia hạn từng mẫu tính lại từ đầu.
        assetAttempts.clear();
        sameUrlRetried.clear();
      }
      if (shared === mine) {
        sharedPending = false;
        settled = result;
        // Chủ = người của lượt đọc: đổi người giữa chừng thì lượt sau thấy lệch chủ → quên + đọc lại.
        settledOwner = reqOwner;
        if (result !== keep) settledAt = Date.now();
        if (load.source === 'fallback:no-session' || result === keep) shared = null;
      }
      return result;
    });
  shared = mine;
  sharedPending = true;
  return mine;
}

/** Thư viện đã chốt của phiên (đầu dò, chẩn đoán); `null` khi lượt đọc chưa xong. */
export const sceneLibraryNow = (): SceneLibrary | null => settled;

/** Chỉ cho test: quên lượt đọc của phiên. */
export const resetSceneLibraryForTests = (): void => {
  forget();
  settledOwner = null;
  assetLog.refreshed = 0;
  assetLog.retriedSame = 0;
  assetLog.dropped = 0;
  assetLog.failures.length = 0;
};

/* -------------------------------------------------------------------------- */
/* Gia hạn URL ký của mẫu thư viện (MinIO, hạn ~2 giờ)                         */
/* -------------------------------------------------------------------------- */

/** Coi URL ký là quá tuổi sau 100 phút (hạn máy chủ ~120 phút): lượt `ensureSceneLibrary` sau đó đọc lại. */
export const SIGNED_URL_MAX_AGE_MS = 100 * 60_000;
/** Mỗi mẫu gia hạn tối đa 2 lần trong một lượt đọc thư viện, chờ lùi dần trước mỗi lần. */
export const ASSET_REFRESH_BACKOFF_MS: readonly number[] = [400, 2_000];
/** Câu báo khi một mẫu không tải lại được sau khi gia hạn: món ấy hiện hình thay thế, các món khác không đổi. */
export const ASSET_EXPIRED_NOTICE =
  'Một số mẫu nội thất hết hạn truy cập và không tải lại được, đang hiện hình thay thế. Tải lại trang để thử lại.';

export type AssetRefreshFailure = 'no-session' | 'no-permission' | 'failed' | 'exhausted' | 'stale' | 'unchanged';

interface AssetFailure {
  readonly modelId: string;
  readonly reason: AssetRefreshFailure;
}

/** Số liệu gia hạn (đề nghị nối `__pascalProbe.assetRefresh()` vào `assetRefreshStatus`). */
const assetLog: { refreshed: number; retriedSame: number; dropped: number; failureId: number; readonly failures: AssetFailure[] } = {
  failureId: 0,
  refreshed: 0,
  retriedSame: 0,
  dropped: 0,
  failures: [],
};
const assetAttempts = new Map<string, number>();
/** Mẫu đã dùng lượt "thử lại đúng URL cũ" (máy chủ ký theo mốc giờ tròn: đọc lại cùng mốc trả URL y hệt). */
const sameUrlRetried = new Set<string>();
/** Gia hạn đang chạy theo mẫu: nhiều lời gọi cùng mẫu (FileLoader gọi onError của TỪNG người gọi) dùng chung một lượt. */
const inflight = new Map<string, Promise<string | null>>();
let refreshing: Promise<AssetRefreshFailure | 'aborted' | null> | null = null;

export interface AssetRefreshStatus {
  /** Lượt thử lại bằng URL ký MỚI. */
  readonly refreshed: number;
  /** Lượt thử lại đúng URL cũ (đọc lại thư viện trả URL y hệt). */
  readonly retriedSame: number;
  /** Lượt gia hạn bị bỏ vì phiên/người đã đổi (`stale`) — có chủ ý, KHÔNG tính là lỗi mẫu, không vào `failures`. */
  readonly dropped: number;
  readonly failures: readonly AssetFailure[];
  /** Số thứ tự TĂNG DẦN của lỗi mẫu gần nhất (không đặt lại khi xoá danh sách): câu báo đã đóng theo dõi theo số này. */
  readonly failureId: number;
  /** `ASSET_EXPIRED_NOTICE` khi có mẫu hỏng hẳn. */
  readonly notice: string | null;
}

/** Số liệu của RIÊNG bó này (gộp vào `assetRefreshStatus` qua hub). */
const localStatus = (): AssetRefreshStatus => ({
  refreshed: assetLog.refreshed,
  retriedSame: assetLog.retriedSame,
  dropped: assetLog.dropped,
  failures: [...assetLog.failures],
  failureId: assetLog.failureId,
  notice: assetLog.failures.length > 0 ? ASSET_EXPIRED_NOTICE : null,
});

/**
 * Số liệu gia hạn của CẢ TÀI LIỆU (gộp mọi bó JS): bó nào xử lý request thì câu báo/đầu dò của mọi bó đều thấy —
 * không còn câu hỏi "bó nào sở hữu mẫu" (review Codex-3 #5).
 */
export const assetRefreshStatus = (): AssetRefreshStatus => {
  const all = statusSources().map((status) => status());
  const failures = all.flatMap((x) => x.failures);
  return {
    refreshed: all.reduce((n, x) => n + x.refreshed, 0),
    retriedSame: all.reduce((n, x) => n + x.retriedSame, 0),
    dropped: all.reduce((n, x) => n + x.dropped, 0),
    failures,
    failureId: all.reduce((n, x) => n + x.failureId, 0),
    notice: failures.length > 0 ? ASSET_EXPIRED_NOTICE : null,
  };
};

/** Nghe thay đổi `assetRefreshStatus` (viewer hiện câu báo) — người nghe chung của tài liệu; trả hàm gỡ. */
export const subscribeAssetRefresh = (listener: () => void): (() => void) => {
  hub().listeners.add(listener);
  return () => {
    hub().listeners.delete(listener);
  };
};

const notify = (): void => hub().listeners.forEach((l) => l());

const fail = (modelId: string, reason: AssetRefreshFailure): null => {
  // `stale` không phải lỗi mẫu: không vào danh sách, không báo người nghe (câu báo đã đóng không hiện lại).
  if (reason === 'stale') {
    assetLog.dropped += 1;
    return null;
  }
  assetLog.failures.push({ modelId, reason });
  assetLog.failureId += 1;
  notify();
  return null;
};

/** Một lượt đọc lại thư viện dùng chung cho mọi mẫu hết hạn cùng lúc; chỉ gộp khi vẫn đúng người + thế hệ. */
const refreshLibrary = (getApi: LibraryApiSource, signal?: AbortSignal): Promise<AssetRefreshFailure | 'aborted' | null> => {
  if (refreshing !== null) return refreshing;
  const gen = generation;
  // Chủ của danh mục đang nạp (không phải người đang đăng nhập lúc này): đổi tài khoản mà chưa qua `ensureSceneLibrary`
  // thì lượt này là stale — không nạp thư viện của người mới vào danh mục của người cũ (Codex #1).
  const owner = settledOwner;
  const isStale = (): boolean => gen !== generation || currentOwner() !== owner;
  const seq = nextWriteSeq();
  // Hàm (không phải biểu thức) để TS không thu hẹp `aborted` qua các await.
  const aborted = (): boolean => signal?.aborted === true;
  const mine = (async (): Promise<AssetRefreshFailure | 'aborted' | null> => {
    if (isStale()) return 'stale';
    if (aborted()) return 'aborted';
    const api = await getApi().catch(() => null);
    if (isStale()) return 'stale';
    if (aborted()) return 'aborted';
    if (api === null) return 'no-session';
    const result = await api.list().catch(() => null);
    if (isStale()) return 'stale';
    if (aborted()) return 'aborted';
    if (result === null) return 'failed';
    if (!result.ok) return absenceOf(result.error) === undefined ? 'failed' : 'no-permission';
    // Có lượt ghi mới hơn đã về (đọc theo tuổi bắt đầu sau): giữ danh mục mới hơn, URL lấy từ đó.
    if (acceptWrite(seq)) {
      replaceServerLibrary(result.data);
      settledAt = Date.now();
    }
    return null;
  })().finally(() => {
    if (refreshing === mine) refreshing = null;
  });
  refreshing = mine;
  return mine;
};

const defaultSleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Mẫu thư viện tải hỏng vì URL ký hết hạn (401/403): đọc lại thư viện theo QUYỀN của người đang đăng nhập, trả URL ký
 * mới để thử lại; `null` = không thử lại (không phải mẫu thư viện, lỗi khác, hết quyền, hết lượt, request cũ đã đổi
 * phiên/người). Mỗi mẫu tối đa `ASSET_REFRESH_BACKOFF_MS.length` lần mỗi lượt đọc thư viện. Không ném.
 */
export function refreshAssetUrl(
  url: string,
  status: number,
  getApi: LibraryApiSource = defaultApi,
  sleep: (ms: number) => Promise<void> = defaultSleep,
  /** Huỷ của người gọi: dừng luôn việc gia hạn (không gọi API, không ghi danh mục sau khi huỷ). */
  signal?: AbortSignal,
): Promise<string | null> {
  if (status !== 401 && status !== 403) return Promise.resolve(null);
  const modelId = serverModelIdOfUrl(url);
  if (modelId === undefined) return Promise.resolve(null);
  const running = inflight.get(modelId);
  if (running !== undefined) return running;
  const mine = refreshOnce(modelId, url, getApi, sleep, signal).finally(() => {
    if (inflight.get(modelId) === mine) inflight.delete(modelId);
  });
  inflight.set(modelId, mine);
  return mine;
}

async function refreshOnce(
  modelId: string,
  url: string,
  getApi: LibraryApiSource,
  sleep: (ms: number) => Promise<void>,
  signal: AbortSignal | undefined,
): Promise<string | null> {
  // Phiên đã đổi người mà chưa qua `ensureSceneLibrary` (vd. đăng nhập người khác ở thẻ khác): không gộp thư viện
  // của người mới vào danh mục của người cũ.
  if (currentOwner() !== settledOwner) return fail(modelId, 'stale');
  const used = assetAttempts.get(modelId) ?? 0;
  const wait = ASSET_REFRESH_BACKOFF_MS[used];
  if (wait === undefined) return fail(modelId, 'exhausted');
  assetAttempts.set(modelId, used + 1);
  const gen = generation;
  const owner = settledOwner;
  // Kiểm cả thế hệ, chủ lẫn huỷ sau MỖI await: đổi tài khoản trong lúc chờ lùi không làm đổi `generation` (Codex #1);
  // người gọi đã huỷ thì không gọi API, không ghi danh mục (review Codex-3 #3/#10).
  const isStale = (): boolean => gen !== generation || currentOwner() !== owner || signal?.aborted === true;
  await sleep(wait);
  if (isStale()) return fail(modelId, 'stale');
  let failure = await refreshLibrary(getApi, signal);
  // Lượt đọc chung bị huỷ bởi NGƯỜI KHỞI TẠO nó, còn mình chưa huỷ: tự đọc lại một lần.
  if (failure === 'aborted' && !isStale()) failure = await refreshLibrary(getApi, signal);
  if (failure === 'aborted' || (failure === null && isStale())) return fail(modelId, 'stale');
  if (failure !== null) return fail(modelId, failure);
  // Danh mục (đã THAY bằng lượt đọc mới nhất) không còn mẫu này = người dùng mất quyền với nó.
  if (!isServerModel(modelId)) return fail(modelId, 'no-permission');
  const fresh = modelSrcOf(modelId);
  if (absoluteUrl(fresh) === absoluteUrl(url)) {
    // URL y hệt: thử lại ĐÚNG MỘT lần URL cũ (403 thoáng qua/proxy), vẫn trong trần lượt của mẫu; lần sau thì dừng.
    if (sameUrlRetried.has(modelId)) return fail(modelId, 'unchanged');
    sameUrlRetried.add(modelId);
    assetLog.retriedSame += 1;
    notify();
    return url;
  }
  assetLog.refreshed += 1;
  notify();
  return fresh;
}

/**
 * Rời dự án/màn dựng cảnh (SPA: lịch sử phiên bản): lượt gia hạn đang chạy bị bỏ (`stale`, đếm `dropped`), không gộp
 * kết quả, không tải lại GLB cho cảnh đã gỡ. Không gỡ thư viện, không tính lại trần lượt (trần vẫn giữ qua lần mở lại).
 */
const abandonLocal = (): void => {
  generation += 1;
  refreshing = null;
  inflight.clear();
};

/** Gọi từ BẤT KỲ bó nào: vô hiệu mọi lượt gia hạn đang chạy của mọi bó trên tài liệu (review Codex-3 #5). */
export const abandonAssetRefresh = (): void => {
  const bundles = hub().bundles;
  if (bundle === null || !bundles.includes(bundle)) abandonLocal();
  bundles.forEach((b) => b.abandon());
};

/**
 * Một URL tải THÀNH CÔNG: mẫu ấy (nếu đã từng gia hạn) được tính lại trần lượt — phiên dài không báo `exhausted` mãi
 * cho mẫu đã tải lại được. Chỉ xoá khi tải được (không xoá khi chỉ nhận URL mới): mẫu 403 mãi vẫn dừng ở trần.
 */
export const assetLoadedOk = (url: string): void => {
  if (assetAttempts.size === 0) return;
  const modelId = serverModelIdOfUrl(url);
  if (modelId === undefined) return;
  assetAttempts.delete(modelId);
  sameUrlRetried.delete(modelId);
};

let installed = false;

const isRequest = (input: RequestInfo | URL): input is Request => typeof input === 'object' && !(input instanceof URL);
const urlOfRequest = (input: RequestInfo | URL): string =>
  typeof input === 'string' ? input : isRequest(input) ? input.url : input.href;

/**
 * Chỉ gia hạn request tải mẫu: GET/HEAD không thân (FileLoader). Request khác đi thẳng — thử lại một POST/thân stream
 * là đổi nghĩa request (review Codex-2 #2).
 */
const refreshable = (input: RequestInfo | URL, init: RequestInit | undefined): boolean => {
  const method = (init?.method ?? (isRequest(input) ? input.method : 'GET')).toUpperCase();
  return (method === 'GET' || method === 'HEAD') && init?.body == null;
};

/** Request lặp lại với URL mới, GIỮ NGUYÊN mọi tuỳ chọn (mode/redirect/cache/integrity/credentials/headers/signal…). */
const retryInputOf = (input: RequestInfo | URL, fresh: string): RequestInfo => (isRequest(input) ? new Request(fresh, input) : fresh);

/** Promise về `null` khi `signal` huỷ — người gọi đã huỷ không phải chờ lượt gia hạn (chờ lùi tới 2 s). */
const unlessAborted = <T>(work: Promise<T>, signal: AbortSignal | null | undefined): Promise<T | null> => {
  if (signal == null) return work;
  if (signal.aborted) return Promise.resolve(null);
  let onAbort: () => void = () => undefined;
  const aborted = new Promise<null>((resolve) => {
    onAbort = () => resolve(null);
    signal.addEventListener('abort', onAbort, { once: true });
  });
  // Nhánh nào thắng cũng gỡ người nghe: signal sống lâu không tích người nghe (review Codex-3 N3).
  return Promise.race([work, aborted]).finally(() => signal.removeEventListener('abort', onAbort));
};

/**
 * Lớp chặn fetch: 401/403 của URL mẫu thư viện → `refreshAssetUrl` → tải lại bằng URL mới NGAY TRONG lời gọi fetch ấy
 * (người gọi — FileLoader của bất kỳ bản three nào — chỉ thấy phản hồi cuối). Hết lượt/không phải mẫu → trả nguyên phản
 * hồi lỗi: Pascal hiện hình thay thế + `assetRefreshStatus().notice`. Vòng lặp hữu hạn nhờ trần của `refreshAssetUrl`.
 * Vòng đời chụp LÚC VÀO fetch: rời dự án (`abandonAssetRefresh`) hoặc huỷ `signal` trong lúc chờ phản hồi đầu/gia hạn
 * → trả phản hồi đang có, không gia hạn/thử lại cho cảnh đã gỡ (review Codex-2 #3).
 */
export async function fetchWithAssetRefresh(
  input: RequestInfo | URL,
  init: RequestInit | undefined,
  next: typeof fetch,
  getApi: LibraryApiSource = defaultApi,
  sleep: (ms: number) => Promise<void> = defaultSleep,
): Promise<Response> {
  if (!refreshable(input, init)) return next(input, init);
  const gen = generation;
  const signal = init?.signal ?? (isRequest(input) ? input.signal : undefined);
  const gone = (): boolean => gen !== generation || signal?.aborted === true;
  let url = urlOfRequest(input);
  let response = await next(input, init);
  while (response.status === 401 || response.status === 403) {
    if (serverModelIdOfUrl(url) === undefined) return response;
    if (gone()) {
      assetLog.dropped += 1;
      return response;
    }
    const fresh = await unlessAborted(refreshAssetUrl(url, response.status, getApi, sleep, signal ?? undefined), signal);
    if (fresh === null) return response;
    if (gone()) {
      assetLog.dropped += 1;
      return response;
    }
    url = fresh;
    response = await next(retryInputOf(input, fresh), init);
  }
  if (response.ok) assetLoadedOk(url);
  return response;
}

/**
 * Trạng thái dùng chung MỌI bó JS trên cùng tài liệu (SPA + pascal-mount, khoá `Symbol.for`): MỘT lớp chặn fetch, mỗi
 * bó đăng ký phần của mình (danh mục, vòng đời, bộ đếm). Lớp chặn giao request cho một bó có danh mục chứa URL ấy;
 * vòng đời (`abandonAssetRefresh`), câu báo (người nghe chung) và số liệu (`assetRefreshStatus`) là của CẢ tài liệu —
 * nên hai bó cùng có một mẫu thì bó nào xử lý cũng như nhau (review Codex-2 #5, Codex-3 #5). Bó đọc trạng thái của mình
 * qua tham chiếu sống (không chụp danh mục): `forget()` gỡ danh mục thì bó thôi nhận URL ấy.
 */
interface AssetRefreshBundle {
  readonly owns: (url: string) => boolean;
  readonly handle: (input: RequestInfo | URL, init: RequestInit | undefined, next: typeof fetch) => Promise<Response>;
  readonly status: () => AssetRefreshStatus;
  readonly abandon: () => void;
}
interface AssetRefreshHub {
  readonly bundles: AssetRefreshBundle[];
  /** Người nghe câu báo của MỌI bó: lỗi do bó nào ghi cũng báo tới mọi viewer. */
  readonly listeners: Set<() => void>;
  restore: (() => void) | null;
}
const HUB_KEY = Symbol.for('appfront.assetRefresh.hub');
const hub = (): AssetRefreshHub => {
  const root = globalThis as unknown as Record<symbol, AssetRefreshHub | undefined>;
  root[HUB_KEY] ??= { bundles: [], listeners: new Set(), restore: null };
  return root[HUB_KEY];
};

let bundle: AssetRefreshBundle | null = null;

/** Nguồn số liệu để gộp: mọi bó đã đăng ký, cộng bó này nếu chưa đăng ký (tắt cờ/chưa cài). */
const statusSources = (): (() => AssetRefreshStatus)[] => {
  const bundles = hub().bundles;
  const sources = bundles.map((b) => b.status);
  return bundle !== null && bundles.includes(bundle) ? sources : [...sources, localStatus];
};

/**
 * Nối gia hạn vào `fetch` của tài liệu (`interceptPlatformFetch`): mọi bản three — gói editor3d, gói pascal-mount mà
 * lịch sử phiên bản/viewer SPA nạp, three của SPA — tải GLB qua `FileLoader` → `fetch(req)` tự do, nên một lớp chặn phủ
 * hết, không vá prototype từng bản, không vá mã vendor. Mỗi bó đăng ký vào trạng thái dùng chung (`hub`).
 * Tắt: `?disable=assetrefresh`. `?probe=1` → `window.__assetRefreshStatus()` (gộp mọi bó).
 */
export function installAssetRefresh(
  getApi: LibraryApiSource = defaultApi,
  sleep: (ms: number) => Promise<void> = defaultSleep,
): void {
  if (installed) return;
  const params = new URLSearchParams(globalThis.location?.search ?? '');
  if (params.getAll('disable').some((v) => v.split(',').includes('assetrefresh'))) return;
  installed = true;
  const shared = hub();
  bundle = {
    owns: (url) => serverModelIdOfUrl(url) !== undefined,
    handle: (input, init, next) => fetchWithAssetRefresh(input, init, next, getApi, sleep),
    status: localStatus,
    abandon: abandonLocal,
  };
  shared.bundles.push(bundle);
  shared.restore ??= interceptPlatformFetch((input, init, next) => {
    const url = urlOfRequest(input);
    const owner = hub().bundles.find((b) => b.owns(url));
    return owner === undefined ? next(input, init) : owner.handle(input, init, next);
  });
  if (params.get('probe') === '1') {
    (globalThis as { __assetRefreshStatus?: () => AssetRefreshStatus }).__assetRefreshStatus = assetRefreshStatus;
  }
}

/** Gỡ phần của bó này; bó cuối cùng gỡ lớp chặn fetch (test; bản dựng không gọi). */
export const uninstallAssetRefreshForTests = (): void => {
  const shared = hub();
  const at = bundle === null ? -1 : shared.bundles.indexOf(bundle);
  if (at >= 0) shared.bundles.splice(at, 1);
  bundle = null;
  if (shared.bundles.length === 0) {
    shared.restore?.();
    shared.restore = null;
  }
  installed = false;
};

/** Một `modelId` không có trong danh mục (đóng gói + thư viện máy chủ đã gộp) và thứ dựng thay nó. */
export interface UnresolvedModel {
  readonly modelId: string;
  /** Node món (`item_…`), `concept:<vai trò>` hoặc `addition:<chỉ số>`. */
  readonly where: string;
  /**
   * `role`: mẫu theo vai trò như đồ tự bày (concept/đồ AI bổ sung — `designStyles.ts` lọc trước khi dựng).
   * `saved-src`: món lưu `model` lạ — cảnh giữ nguyên đường lưu, không khớp hộp bao (`toPascal.ts` `itemNodeOf`).
   */
  readonly substitute: 'role' | 'saved-src';
}

const SAVED_MODEL_SRC = /^\/items\/([a-z0-9_-]+)\/model\.glb$/;
const known = (id: string): boolean => Object.prototype.hasOwnProperty.call(CATALOG_MODELS, id);

/**
 * `modelId` thiếu trong thư viện ĐANG nạp (chẩn đoán, đầu dò): đọc cảnh đã dựng + concept, không ném, không đổi dữ liệu.
 * Cùng cảnh + cùng thư viện + cùng concept → cùng danh sách ở mọi viewer (thứ tự theo `where`).
 */
export function unresolvedModelIds(
  scene: PascalScene,
  concept?: { readonly models?: DesignResult['models']; readonly additions?: readonly DesignAddition[] },
): UnresolvedModel[] {
  const out: UnresolvedModel[] = [];
  for (const node of Object.values(scene.nodes)) {
    const src = (node as { type?: string; asset?: { src?: string } }).type === 'item' ? (node as { asset?: { src?: string } }).asset?.src : undefined;
    const folder = src === undefined ? undefined : SAVED_MODEL_SRC.exec(src)?.[1];
    if (folder !== undefined && !known(folder)) out.push({ modelId: folder, where: node.id, substitute: 'saved-src' });
  }
  for (const [role, id] of Object.entries(concept?.models ?? {})) {
    if (!known(id)) out.push({ modelId: id, where: `concept:${role}`, substitute: 'role' });
  }
  (concept?.additions ?? []).forEach((addition, i) => {
    if (addition.modelId != null && !known(addition.modelId)) out.push({ modelId: addition.modelId, where: `addition:${i}`, substitute: 'role' });
  });
  return out.sort((a, b) => (a.where < b.where ? -1 : a.where > b.where ? 1 : 0));
}
